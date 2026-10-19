"""CU-A AC4: tasks/suggest_run_healer.py.

Every heal call passes `boqs=` the fixture BoQs, so the real dev runs (BRSR-26-00766 and the sixteen
restored production runs, which AC6's scheduled run heals) are never touched by a test. Fixture runs
are named TEST_CUA_HEAL_* (no naming series consumed) and removed in cleanup.
"""
import os
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_to_date, now_datetime
from frappe.utils.background_jobs import create_job_id

from nirmaan_stack.tasks import suggest_run_healer as healer

PREFIX = "TEST_CUA_HEAL_"


class TestSuggestRunHealer(FrappeTestCase):

    def setUp(self):
        frappe.db.rollback()
        self.h = frappe.generate_hash(length=8)
        self.boq = f"{PREFIX}BOQ_{self.h}"
        self.names = []
        self.addCleanup(self._purge)

    def _purge(self):
        frappe.db.rollback()
        try:
            frappe.db.delete(healer.RUN_DOCTYPE, {"name": ["in", self.names or ["-"]]})
            frappe.db.commit()
        except Exception as e:
            frappe.db.rollback()
            raise AssertionError(f"cleanup failed: {e}")

    def _run(self, tag, status="running", age_hours=3, sheet="Sheet A", halt_reason=None, active=0):
        name = f"{PREFIX}{tag}_{self.h}"
        doc = frappe.get_doc({"doctype": healer.RUN_DOCTYPE, "boq": self.boq, "sheet_name": sheet,
                              "committed_version": 1, "run_id": f"{tag.lower()}{self.h}", "status": status,
                              "results": "[]", "attempted_rows": "[]", "active": active,
                              "halt_reason": halt_reason})
        doc.insert(ignore_permissions=True, ignore_links=True, set_name=name)
        old = add_to_date(now_datetime(), hours=-age_hours)
        frappe.db.sql(f'update "tab{healer.RUN_DOCTYPE}" set modified = %s where name = %s', (old, name))
        frappe.db.commit()
        self.names.append(name)
        return name

    def _get(self, name):
        return frappe.db.get_value(healer.RUN_DOCTYPE, name, ["status", "halt_reason", "active", "modified"],
                                   as_dict=True)

    def _heal(self, live=(set(), set())):
        with patch.object(healer, "_live_suggest_jobs", return_value=live):
            return healer.heal_stale_suggestion_runs(boqs=[self.boq])

    def test_a_stale_jobless_running_run_is_healed(self):
        name = self._run("STALE", active=0)
        before = self._get(name)
        self.assertEqual(self._heal(), [name])
        after = self._get(name)
        self.assertEqual(after.status, "failed")
        self.assertEqual(after.halt_reason, healer.REASON)
        self.assertEqual(after.active, before.active, "active is never changed")
        self.assertEqual(after.modified, before.modified, "written like _mark_run_failed: modified kept")

    def test_an_existing_halt_reason_keeps_its_text_and_gains_the_line(self):
        name = self._run("REASON", halt_reason="AI unavailable")
        self._heal()
        self.assertEqual(self._get(name).halt_reason, f"AI unavailable\n{healer.REASON}")

    def test_a_running_run_with_a_live_job_is_untouched(self):
        name = self._run("LIVEJOB")
        run_id = frappe.db.get_value(healer.RUN_DOCTYPE, name, "run_id")
        self.assertEqual(self._heal(live=({create_job_id(run_id)}, set())), [])
        self.assertEqual(self._get(name).status, "running")

    def test_a_resumed_run_whose_new_job_is_live_on_its_sheet_is_untouched(self):
        # A resume runs under a NEW job id; only (boq, sheet_name) ties that job to the run.
        name = self._run("RESUMED", sheet="Sheet R")
        self.assertEqual(self._heal(live=({"localhost::someotherjob"}, {(self.boq, "Sheet R")})), [])
        self.assertEqual(self._get(name).status, "running")

    def test_a_running_run_younger_than_two_hours_is_untouched(self):
        name = self._run("YOUNG", age_hours=1)
        self.assertEqual(self._heal(), [])
        self.assertEqual(self._get(name).status, "running")

    def test_other_statuses_are_untouched(self):
        names = {s: self._run(f"S{s.upper()}", status=s, sheet=f"Sheet {s}") for s in ("partial", "complete", "failed")}
        self.assertEqual(self._heal(), [])
        for status, name in names.items():
            self.assertEqual(self._get(name).status, status)
            self.assertIsNone(self._get(name).halt_reason)

    def test_an_unreadable_queue_heals_nothing(self):
        name = self._run("NOQUEUE")
        self.assertEqual(self._heal(live=None), [])
        self.assertEqual(self._get(name).status, "running")

    def test_the_queue_reader_matches_this_sites_suggest_jobs_only(self):
        def job(jid, method, site="localhost", boq="B1", sheet="S1"):
            return SimpleNamespace(id=jid, kwargs={"site": site, "method": method,
                                                   "kwargs": {"boq": boq, "sheet_name": sheet}})
        jobs = [job("localhost::a", healer.SUGGEST_WORKER),
                job("other::b", healer.SUGGEST_WORKER, site="other", boq="B2"),
                job("localhost::c", "nirmaan_stack.api.boq.wizard.ai_assist._run_ai_pass_worker", boq="B3"),
                None]
        reg = SimpleNamespace(get_job_ids=lambda: [])
        queue = SimpleNamespace(job_ids=["x"], started_job_registry=reg, deferred_job_registry=reg, connection=None)
        with patch("frappe.utils.background_jobs.get_queue", return_value=queue), \
                patch("rq.job.Job.fetch_many", return_value=jobs), \
                patch.object(frappe.local, "site", "localhost"):
            ids, keys = healer._live_suggest_jobs()
        self.assertEqual(ids, {"localhost::a"})
        self.assertEqual(keys, {("B1", "S1")})

    def test_the_real_queue_read_heals_a_run_with_no_job(self):
        # No mock: the live rq queues are read (nothing on them names this fixture's sheet).
        name = self._run("REALQ", sheet="Sheet Q")
        self.assertEqual(healer.heal_stale_suggestion_runs(boqs=[self.boq]), [name])

    def test_the_heal_line_reaches_the_log_file(self):
        name = self._run("LOGLINE")
        path = os.path.join(frappe.utils.get_bench_path(), "logs", "nirmaan_suggest_healer.log")
        start = os.path.getsize(path) if os.path.exists(path) else 0
        self._heal()
        with open(path, encoding="utf-8") as fh:
            fh.seek(start)
            self.assertIn(name, fh.read())

    def test_the_scheduler_entry_is_wired_every_five_minutes(self):
        cron = frappe.get_hooks("scheduler_events")["cron"]["*/5 * * * *"]
        self.assertIn("nirmaan_stack.tasks.suggest_run_healer.heal_stale_suggestion_runs", cron)
