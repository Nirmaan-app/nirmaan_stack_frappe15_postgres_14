# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""The site-wide limit on AI calls in flight (#1718, spec #1654). Real Redis (the site's cache), a fake model client.

  two runners     two runs at once, each under its own calls-at-once ceiling, never hold more calls in flight
                  together than the site-wide limit, and the limit is reached
  dead worker     a slot whose holder stopped renewing it (its worker died) is free again once its lease runs out,
                  while a slot that is renewed stays held
  judge thread    the match judge, on its own thread, takes site slots too
  provider 429    two runs under one provider limit: no 429 under the site limit, a 429 stop without it
"""
import threading

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_match import call_runner as cr
from nirmaan_stack.services.boq_rate_match import site_ai_slots as slots
from nirmaan_stack.services.boq_rate_match.test_call_runner import FakeClient, HttpErr, _req


def _limits(calls, site):
    return cr.Limits(calls_at_once=calls, retry_wait_s=0, burst_failures=10, burst_window_s=60,
                     max_request_tokens=100000, site_calls_at_once=site)


class _SlotsCase(FrappeTestCase):

    def setUp(self):
        frappe.cache.delete(slots.slot_key())

    def tearDown(self):
        frappe.cache.delete(slots.slot_key())


class TestTwoRunnersShareTheSiteLimit(_SlotsCase):

    def test_two_runs_at_once_never_pass_the_site_limit_together(self):
        client = FakeClient(delay=0.05)        # one client: max_now is the total in flight across both runs
        outs = {}
        site, sites_path = frappe.local.site, frappe.local.sites_path

        def one_run(tag):             # each thread stands for one worker: its own site context, no shared state
            frappe.init(site=site, sites_path=sites_path)
            try:
                reqs = [_req(f"{tag}{i}") for i in range(30)]
                outs[tag] = cr.run(reqs, limits=_limits(calls=5, site=6), client=client)
            finally:
                frappe.destroy()

        threads = [threading.Thread(target=one_run, args=(t,)) for t in ("A", "B")]
        for t in threads:
            t.start()
        for t in threads:
            t.join(60)

        self.assertEqual(client.max_now, 6, "the site-wide total must reach the limit and never pass it")
        for tag in ("A", "B"):
            self.assertIsNone(outs[tag].stop_reason, outs[tag].stop_detail)
            self.assertEqual(len(outs[tag].results), 30)
            self.assertTrue(all(r.ok for r in outs[tag].results.values()))
            self.assertLessEqual(outs[tag].max_in_flight, 5, "each run's own calls at once stays its ceiling")
        self.assertEqual(slots.SiteSlots(6).in_flight(), 0, "every slot is given back when the runs end")

    def test_a_run_alone_is_held_to_the_lower_of_its_ceiling_and_the_site_limit(self):
        client = FakeClient(delay=0.05)
        out = cr.run([_req(f"C{i}") for i in range(12)], limits=_limits(calls=8, site=3), client=client)
        self.assertIsNone(out.stop_reason, out.stop_detail)
        self.assertEqual(client.max_now, 3)


class TestADeadWorkersSlotIsFreed(_SlotsCase):

    def test_a_slot_nobody_renews_is_free_once_its_lease_runs_out(self):
        now = [1_000_000.0]
        site = slots.SiteSlots(2, clock=lambda: now[0])
        self.assertTrue(site.try_take())
        self.assertTrue(site.try_take())     # a worker took both slots, then died: nothing renews or gives them back
        self.assertIsNone(site.try_take(), "the site is full while the leases run")

        now[0] += slots.LEASE_S + 1
        self.assertTrue(site.try_take(), "a dead worker's slot is free once its lease has run out")
        self.assertEqual(site.in_flight(), 1)

    def test_a_renewed_slot_stays_held_past_its_first_lease(self):
        now = [1_000_000.0]
        site = slots.SiteSlots(1, clock=lambda: now[0])
        token = site.try_take()
        for _ in range(4):                    # a live call renews its slot while it waits on the model
            now[0] += slots.LEASE_S / 2
            site.renew([token])
        self.assertIsNone(site.try_take(), "a renewed slot is still held")
        site.give_back(token)
        self.assertTrue(site.try_take())

    def test_a_run_whose_slots_a_dead_worker_held_still_finishes(self):
        now = [1_000_000.0]
        dead = slots.SiteSlots(2, clock=lambda: now[0])
        dead.try_take()
        dead.try_take()                       # the whole site limit, held by a worker that died
        later = now[0] + slots.LEASE_S + 1
        out = cr.run([_req("D1"), _req("D2")], limits=_limits(calls=2, site=2), client=FakeClient(),
                     slot_clock=lambda: later)
        self.assertIsNone(out.stop_reason, out.stop_detail)
        self.assertTrue(all(r.ok for r in out.results.values()))


class TestTheMatchJudgeTakesSiteSlots(_SlotsCase):

    def test_the_judge_on_its_own_thread_runs_under_the_site_limit(self):
        # run_match runs the judge on a thread of its own while the job's thread reports progress
        from nirmaan_stack.services.boq_rate_match.match_run import _judge_with_progress

        client = FakeClient(delay=0.02)
        out = _judge_with_progress(
            lambda: cr.run([_req(f"J{i}") for i in range(6)], limits=_limits(calls=4, site=2), client=client),
            None, lambda phase, done: None)
        self.assertIsNone(out.stop_reason, out.stop_detail)
        self.assertEqual(len(out.results), 6)
        self.assertEqual(client.max_now, 2)


class _ProviderWithALimit(FakeClient):
    """A fake provider that answers 429 to any call sent while `limit` calls are already in flight across every
    caller, as the model provider's own limit does."""

    def __init__(self, limit):
        super().__init__(delay=0.03)
        self.limit = limit
        self.sent_429 = 0

    def _create(self, **kw):
        with self.lock:
            over = self.now >= self.limit
            if over:
                self.sent_429 += 1
        if over:
            raise HttpErr(429, "rate limited")
        return super()._create(**kw)


class TestTwoMatchesUnderOneProviderLimit(_SlotsCase):
    """Stands in for #1718's N-worker AC until the N-worker check (#1656) exists: two runs at once, each with calls at
    once 5, against one provider limit of 5. Under a site-wide limit of 5 neither stops on a 429; with no site-wide
    limit (as before #1718) the same two runs together pass the provider limit and a 429 stops a run."""

    def _two_runs(self, site):
        client = _ProviderWithALimit(5)
        outs = {}
        site_name, sites_path = frappe.local.site, frappe.local.sites_path

        def one_run(tag):
            frappe.init(site=site_name, sites_path=sites_path)
            try:
                outs[tag] = cr.run([_req(f"{tag}{i}") for i in range(25)], limits=_limits(calls=5, site=site),
                                   client=client)
            finally:
                frappe.destroy()

        threads = [threading.Thread(target=one_run, args=(t,)) for t in ("M", "N")]
        for t in threads:
            t.start()
        for t in threads:
            t.join(60)
        return client, outs

    def test_neither_run_stops_on_a_429_under_the_site_limit(self):
        client, outs = self._two_runs(site=5)
        self.assertEqual(client.sent_429, 0)
        for tag in ("M", "N"):
            self.assertIsNone(outs[tag].stop_reason, outs[tag].stop_detail)
            self.assertEqual(len(outs[tag].results), 25)

    def test_without_the_site_limit_a_429_stops_a_run(self):
        client, outs = self._two_runs(site=None)
        self.assertGreater(client.sent_429, 0)
        self.assertIn(cr.STOP_RATE_LIMIT, [outs[t].stop_reason for t in ("M", "N")])
