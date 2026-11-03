# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the match trigger, job and endpoints (DEV2-B4 S2, T1; api/boq/rate_match.py + the trigger call in
rate_master._suggest_worker). Mocks only: no model call, no job is really enqueued, the database and the cache are
reached only through patched seams (nothing is written).

  the trigger      a COMPLETE Suggest run with the switch ON -> exactly one match job, its run doc, marker  /
                   switch OFF -> None, nothing read but the switch, nothing enqueued  /  a live match run on the
                   sheet -> none started (one run per sheet)
  the worker hook  _suggest_worker: complete -> the trigger is called once with the pass's scope and the payload
                   carries "match"  /  partial (halted) -> never called  /  switch OFF -> the payload is EXACTLY the
                   pre-B4 payload (no "match" key)  /  a trigger that raises never fails the Suggest run
  the job          success -> the done payload in the status cache + "boq:match_sheet_done"  /  a failure -> the
                   run marked failed with the reason; the Suggest run is never written
  the clocks       job timeout < stale threshold < marker TTL; the stale threshold clears rq's kill grace
  the endpoints    login only; switch OFF -> {"match_enabled": False} only  /  running / done / idle; the results
                   are the ACTIVE run's, in the stored (display) order
  the 06:00 entry  hooks cron "0 6 * * *" names daily_pool_rebuild; it enqueues pool.rebuild_pool on long with its own
                   timeout (a Cron job runs on default at 300 s)  /  the */5 list carries the match healer
"""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq import rate_match as RM
from nirmaan_stack.api.boq import rate_master


class _Cache:
    def __init__(self):
        self.d = {}

    def get_value(self, k):
        return self.d.get(k)

    def set_value(self, k, v, expires_in_sec=None):
        self.d[k] = v

    def delete_value(self, k):
        self.d.pop(k, None)


class TestClocks(FrappeTestCase):

    def test_the_three_move_together_in_order(self):
        self.assertLess(RM._MATCH_JOB_TIMEOUT_SEC, RM._STALE_MATCH_SECONDS)
        self.assertLess(RM._STALE_MATCH_SECONDS, RM._M_MARKER_TTL_SEC)
        self.assertGreaterEqual(RM._STALE_MATCH_SECONDS, RM._MATCH_JOB_TIMEOUT_SEC + RM._RQ_KILL_GRACE_SEC)

    def test_the_paces_are_the_measured_p90s(self):
        # DEV2-B4: Suggest from 188 stored runs (p90 3.12 s a row); matching from S4's 9 sheets (65 s + 0.45 s a row)
        self.assertEqual(RM.PACES, {"suggest_seconds_per_row": 3.12, "match_fixed_seconds": 65.0, "match_seconds_per_row": 0.45})
        self.assertTrue(all(isinstance(v, float) and v > 0 for v in RM.PACES.values()))

    def test_the_time_left_never_goes_below_zero(self):
        total = RM.PACES["match_fixed_seconds"] + RM.PACES["match_seconds_per_row"] * 10
        self.assertEqual(RM.estimate_left_seconds(10, 0), int(round(total)))
        self.assertEqual(RM.estimate_left_seconds(10, total + 500), 0)


class TestTrigger(FrappeTestCase):

    def setUp(self):
        frappe.utils.now()          # warm the system settings before frappe.db is patched
        self.cache = _Cache()
        self.p = [patch.object(frappe, "cache", return_value=self.cache),
                  patch.object(frappe.db, "commit"),
                  patch.object(frappe, "log_error")]
        for p in self.p:
            p.start()

    def tearDown(self):
        for p in reversed(self.p):
            p.stop()

    def test_the_switch_is_the_stored_value_whatever_the_cache_holds(self):
        # a mocked or stale cache never turns matching on (DEV2-B4 C2 fix loop: test_rate_master's harness mocks
        # frappe.cache, and a meta-based read then read the switch as ON)
        from unittest.mock import MagicMock as MM
        with patch.object(frappe, "cache", return_value=MM()):
            with patch.object(frappe.db, "get_single_value", return_value=None):
                self.assertFalse(RM.match_enabled())
            with patch.object(frappe.db, "get_single_value", return_value="0"):
                self.assertFalse(RM.match_enabled())
            with patch.object(frappe.db, "get_single_value", return_value="1"):
                self.assertTrue(RM.match_enabled())
            with patch.object(frappe.db, "get_single_value", side_effect=RuntimeError("db gone")):
                self.assertFalse(RM.match_enabled())

    def test_switch_off_returns_none_and_enqueues_nothing(self):
        with patch.object(RM, "match_enabled", return_value=False), patch.object(frappe, "enqueue") as enq, \
                patch.object(frappe.db, "get_value") as gv:
            self.assertIsNone(RM.start_after_suggest("B", "S", "run1"))
        enq.assert_not_called()
        gv.assert_not_called()

    def test_switch_on_enqueues_exactly_one_job_with_its_own_marker(self):
        doc = MagicMock()
        doc.name = "BRMR-9"
        with patch.object(RM, "match_enabled", return_value=True), patch.object(frappe, "enqueue") as enq, \
                patch.object(frappe.db, "get_value", return_value={"name": "BRSR-1", "committed_version": 4}), \
                patch.object(frappe, "get_doc", return_value=doc) as gd:
            out = RM.start_after_suggest("B", "S", "run1", only_rows=[5, 3], user="u@x")
        self.assertEqual(out, {"queued": True, "run": "BRMR-9"})
        self.assertEqual(enq.call_count, 1)
        args, kw = enq.call_args
        self.assertEqual(args[0], RM.WORKER)
        self.assertEqual((kw["queue"], kw["timeout"], kw["run_name"], kw["only_rows"]), ("long", RM._MATCH_JOB_TIMEOUT_SEC, "BRMR-9", [5, 3]))
        made = gd.call_args[0][0]
        self.assertEqual((made["status"], made["active"], made["suggest_run"], made["commit_version"]), ("queued", 0, "BRSR-1", 4))
        self.assertEqual(made["job_id"], kw["job_id"])
        m = self.cache.d[RM._marker_key("B", "S")]
        self.assertEqual((m["job_id"], m["run"]), (kw["job_id"], "BRMR-9"))

    def test_one_run_per_sheet_a_live_match_starts_none(self):
        self.cache.set_value(RM._marker_key("B", "S"), {"job_id": "j", "enqueued_at": frappe.utils.now()})
        with patch.object(RM, "match_enabled", return_value=True), patch.object(frappe, "enqueue") as enq, \
                patch.object(RM, "get_job_status", return_value="started"):
            out = RM.start_after_suggest("B", "S", "run1")
        self.assertEqual(out["queued"], False)
        enq.assert_not_called()

    def test_an_error_is_logged_and_never_raised(self):
        with patch.object(RM, "match_enabled", return_value=True), \
                patch.object(frappe.db, "get_value", side_effect=RuntimeError("db gone")), patch.object(frappe.db, "rollback"):
            out = RM.start_after_suggest("B", "S", "run1")
        self.assertEqual(out, {"queued": False, "reason": "matching could not be started"})


def _env(complete=True):
    return {"committed_version": 4, "ai_status": "ran", "results": [{"excel_row": 7, "attributes": {}}],
            "attempted_rows": [7], "population_rows": [7] if complete else [7, 8], "complete": complete,
            "halt_reason": None if complete else "usage limit"}


class TestSuggestWorkerHook(FrappeTestCase):
    """rate_master._suggest_worker calls the trigger only for a COMPLETE run; with the switch OFF its payload is the
    pre-B4 payload exactly."""

    def _run(self, env, trigger_return=None, trigger_raises=False):
        cache = _Cache()
        published = []
        calls = []

        def trig(*a, **k):
            calls.append((a, k))
            if trigger_raises:
                raise RuntimeError("boom")
            return trigger_return

        with patch.object(frappe, "cache", return_value=cache), \
                patch.object(rate_master, "_resolve_committed_version", return_value=4), \
                patch.object(rate_master, "_open_run_doc", return_value=("BRSR-1", "run1", [], [], None)), \
                patch.object(rate_master.extraction, "run_extraction", return_value=env), \
                patch.object(rate_master, "_finalise_run"), patch.object(rate_master, "_write_run_progress"), \
                patch.object(frappe.db, "commit"), patch.object(frappe, "log_error"), \
                patch.object(frappe, "publish_realtime", side_effect=lambda ev, p, **k: published.append((ev, p))), \
                patch("nirmaan_stack.api.boq.rate_match.start_after_suggest", side_effect=trig):
            rate_master._suggest_worker(boq="B", sheet_name="S", user="u@x")
        return calls, published[-1], cache

    def test_complete_calls_the_trigger_once_and_the_payload_carries_it(self):
        calls, (ev, payload), _c = self._run(_env(True), trigger_return={"queued": True, "run": "BRMR-1"})
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0][:3], ("B", "S", "run1"))
        self.assertEqual(ev, "boq:suggest_sheet_done")
        self.assertEqual(payload["match"], {"queued": True, "run": "BRMR-1"})
        self.assertEqual(payload["status"], "success")

    def test_a_halted_run_starts_no_match(self):
        calls, (_ev, payload), _c = self._run(_env(False), trigger_return={"queued": True, "run": "X"})
        self.assertEqual(calls, [])
        self.assertEqual(payload["status"], "partial")
        self.assertNotIn("match", payload)

    def test_switch_off_leaves_the_payload_exactly_as_before(self):
        calls, (_ev, payload), _c = self._run(_env(True), trigger_return=None)
        self.assertEqual(len(calls), 1)
        self.assertEqual(sorted(payload), sorted(["status", "boq", "sheet_name", "committed_version", "run_id", "ai_status",
                                                 "run_status", "results", "attempted_count", "population_count",
                                                 "halt_reason", "scoped_row_count", "pass_attempted_count"]))

    def test_a_trigger_that_raises_never_fails_the_suggest_run(self):
        calls, (_ev, payload), _c = self._run(_env(True), trigger_raises=True)
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["run_status"], "complete")
        self.assertNotIn("match", payload)


class TestMatchWorker(FrappeTestCase):

    def test_success_records_the_done_payload_and_publishes(self):
        cache, pub = _Cache(), []
        with patch.object(frappe, "cache", return_value=cache), \
                patch("nirmaan_stack.services.boq_rate_match.match_run.run_match",
                      return_value={"status": "complete", "halt_reason": None, "rows_total": 3, "rows_done": 3}), \
                patch.object(frappe, "publish_realtime", side_effect=lambda ev, p, **k: pub.append((ev, p))):
            out = RM._match_worker(run_name="BRMR-1", boq="B", sheet_name="S", suggest_run_id="run1")
        self.assertEqual((out["status"], out["run"], out["suggest_run_id"]), ("success", "BRMR-1", "run1"))
        self.assertEqual(cache.d[RM._status_key("B", "S")]["status"], "success")
        self.assertEqual(pub[-1][0], "boq:match_sheet_done")

    def test_a_failure_marks_the_match_run_failed_and_never_writes_the_suggest_run(self):
        from nirmaan_stack.services.boq_rate_match import match_run as MR
        writes = []
        with patch.object(frappe, "cache", return_value=_Cache()), \
                patch("nirmaan_stack.services.boq_rate_match.match_run.run_match", side_effect=MR.MatchRefused("switched off")), \
                patch.object(frappe.db, "set_value", side_effect=lambda *a, **k: writes.append(a)), \
                patch.object(frappe.db, "commit"), patch.object(frappe.db, "rollback"), patch.object(frappe, "log_error"), \
                patch.object(frappe, "publish_realtime"):
            out = RM._match_worker(run_name="BRMR-1", boq="B", sheet_name="S", suggest_run_id="run1")
        self.assertEqual((out["status"], out["halt_reason"]), ("error", "switched off"))
        self.assertEqual(writes, [(RM.MATCH_DOCTYPE, "BRMR-1", {"status": "failed", "halt_reason": "switched off"})])


class TestEndpoints(FrappeTestCase):

    def setUp(self):
        self.cache = _Cache()
        self.p = patch.object(frappe, "cache", return_value=self.cache)
        self.p.start()

    def tearDown(self):
        self.p.stop()

    def test_login_is_required(self):
        with patch.object(frappe.local, "session", frappe._dict(user="Guest")):
            with self.assertRaises(frappe.PermissionError):
                RM.get_match_status("B", "S")
            with self.assertRaises(frappe.PermissionError):
                RM.get_match_results("B", "S")

    def test_switch_off_says_so_and_nothing_else(self):
        with patch.object(RM, "match_enabled", return_value=False):
            self.assertEqual(RM.get_match_status("B", "S"), {"match_enabled": False})

    def test_running_done_and_idle(self):
        with patch.object(RM, "match_enabled", return_value=True):
            self.assertEqual(RM.get_match_status("B", "S")["state"], "idle")
            self.cache.set_value(RM._marker_key("B", "S"), {"job_id": "j", "enqueued_at": frappe.utils.now(), "phase": "judge",
                                                            "done": 4, "total": 10, "run": "BRMR-1", "suggest_run_id": "r"})
            with patch.object(RM, "get_job_status", return_value="started"):
                st = RM.get_match_status("B", "S")
            self.assertEqual((st["state"], st["phase"], st["done"], st["total"], st["suggest_run_id"]), ("running", "judge", 4, 10, "r"))
            self.assertIn("estimate_left_s", st)
            self.assertEqual(st["paces"], RM.PACES)
            self.cache.set_value(RM._status_key("B", "S"), {"status": "success", "run": "BRMR-1"})
            self.assertEqual(RM.get_match_status("B", "S")["state"], "done")

    def test_results_are_the_active_runs_rows_as_stored(self):
        rows = [{"excel_row": 3, "matches": [{"key": "g", "colour": "green"}, {"key": "a", "colour": "amber"}]}]
        got = [{"name": "BRMR-2", "status": "complete", "commit_version": 4, "suggest_run": "BRSR-1", "run_at": None,
                "results": json.dumps({"rows": rows}), "usage": json.dumps({"judge": {"spent_usd": 0.1}})}]
        with patch.object(frappe, "get_all", return_value=got) as ga:
            out = RM.get_match_results("B", "S")
        self.assertEqual(ga.call_args.kwargs["filters"], {"boq": "B", "sheet_name": "S", "active": 1})
        self.assertEqual(out["run"]["rows"], rows)
        self.assertEqual(out["run"]["usage"]["judge"]["spent_usd"], 0.1)
        with patch.object(frappe, "get_all", return_value=[]):
            self.assertEqual(RM.get_match_results("B", "S"), {"run": None})


class TestSchedulerEntries(FrappeTestCase):

    def test_the_0600_cron_names_the_daily_rebuild_and_the_healer_is_in_the_five_minute_list(self):
        cron = frappe.get_hooks("scheduler_events")["cron"]
        self.assertIn("nirmaan_stack.api.boq.rate_match.daily_pool_rebuild", cron["0 6 * * *"])
        self.assertIn("nirmaan_stack.tasks.match_run_healer.heal_stale_match_runs", cron["*/5 * * * *"])
        self.assertIn("nirmaan_stack.tasks.suggest_run_healer.heal_stale_suggestion_runs", cron["*/5 * * * *"])

    def test_the_daily_rebuild_enqueues_rebuild_pool_on_long_with_its_own_timeout(self):
        with patch.object(frappe, "enqueue") as enq:
            self.assertTrue(RM.daily_pool_rebuild())
        args, kw = enq.call_args
        self.assertEqual(args[0], "nirmaan_stack.services.boq_rate_match.pool.rebuild_pool")
        self.assertEqual((kw["queue"], kw["timeout"], kw["deduplicate"]), ("long", RM.POOL_REBUILD_TIMEOUT_SEC, True))
        self.assertGreater(RM.POOL_REBUILD_TIMEOUT_SEC, 300)
        frappe.get_attr(args[0])       # the target resolves to pool.rebuild_pool (it is not called here)
