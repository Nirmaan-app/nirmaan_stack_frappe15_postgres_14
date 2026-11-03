"""DEV2-B4 S2 (T1): tasks/match_run_healer.py. Mocks only: the queue read, the run query, the row lock and the write
are patched seams, so the database is never written.

  heals      a queued or running run past its clocks with no live job -> halted, "stale - worker gone"
  spares     a run whose job is still queued / started (by its job id, or any live match job on its sheet)
             a run inside its clocks (the query's cutoff is the match run's own stale threshold)
             a run the worker finished meanwhile (the row-lock re-read sees complete)
             everything when the queues cannot be read
  wiring     the */5 cron lists it; the cutoff is api/boq/rate_match._STALE_MATCH_SECONDS
"""
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils.background_jobs import create_job_id

from nirmaan_stack.tasks import match_run_healer as H


def _run(name, status="running", job_id="j1", boq="B", sheet="S"):
    return frappe._dict(name=name, boq=boq, sheet_name=sheet, job_id=job_id, status=status)


class TestHeal(FrappeTestCase):

    def _heal(self, runs, live, locked_status="running"):
        writes, queries = [], []

        real_get_all, real_sql = frappe.get_all, frappe.db.sql

        def get_all(dt, *a, filters=None, fields=None, order_by=None, **k):
            if dt != H.MATCH_DOCTYPE:
                return real_get_all(dt, *a, filters=filters, fields=fields, order_by=order_by, **k)
            queries.append(filters)
            return runs

        def sql(query, *a, **k):
            if H.MATCH_DOCTYPE in query:       # the row lock; every other query is the real one
                return [(locked_status, None)]
            return real_sql(query, *a, **k)

        frappe.utils.now_datetime()             # warm the system settings before frappe.db is patched
        with patch.object(frappe, "get_all", side_effect=get_all), \
                patch.object(H, "_live_match_jobs", return_value=live), \
                patch.object(frappe.db, "sql", side_effect=sql), \
                patch.object(frappe.db, "set_value", side_effect=lambda *a, **k: writes.append((a, k))), \
                patch.object(frappe.db, "commit"), patch.object(frappe.db, "rollback"):
            healed = H.heal_stale_match_runs(boqs=["B"])
        return healed, writes, queries

    def test_a_dead_running_or_queued_run_is_halted(self):
        healed, writes, _q = self._heal([_run("R1"), _run("R2", status="queued", job_id="j2", sheet="S2")], (set(), set()))
        self.assertEqual(healed, ["R1", "R2"])
        self.assertEqual(writes[0][0], (H.MATCH_DOCTYPE, "R1", {"status": "halted", "halt_reason": H.REASON}))
        self.assertEqual(writes[0][1], {"update_modified": False})

    def test_a_live_job_by_id_or_by_sheet_is_spared(self):
        healed, writes, _q = self._heal([_run("R1", job_id="j1"), _run("R2", job_id="j9", sheet="S2")],
                                        ({create_job_id("j1")}, {("B", "S2")}))
        self.assertEqual((healed, writes), ([], []))

    def test_the_query_uses_the_match_runs_own_clocks_and_live_statuses(self):
        from nirmaan_stack.api.boq.rate_match import _STALE_MATCH_SECONDS
        self.assertEqual(H.stale_after_sec(), _STALE_MATCH_SECONDS)
        _h, _w, queries = self._heal([], (set(), set()))
        self.assertEqual(queries[0]["status"], ["in", ["queued", "running"]])
        cutoff = queries[0]["modified"][1]
        age = frappe.utils.time_diff_in_seconds(frappe.utils.now_datetime(), cutoff)
        self.assertAlmostEqual(age, _STALE_MATCH_SECONDS, delta=5)

    def test_a_run_finished_meanwhile_is_not_touched(self):
        healed, writes, _q = self._heal([_run("R1")], (set(), set()), locked_status="complete")
        self.assertEqual((healed, writes), ([], []))

    def test_unreadable_queues_heal_nothing(self):
        healed, writes, _q = self._heal([_run("R1")], None)
        self.assertEqual((healed, writes), ([], []))

    def test_the_five_minute_cron_lists_it(self):
        cron = frappe.get_hooks("scheduler_events")["cron"]["*/5 * * * *"]
        self.assertIn("nirmaan_stack.tasks.match_run_healer.heal_stale_match_runs", cron)
