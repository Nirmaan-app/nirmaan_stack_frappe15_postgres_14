"""
Tests for the Claude review run log, its health check and the automatic run after a parse (S2).

NO live AI call anywhere: the Anthropic client is a fake, frappe.enqueue is a mock, and the
health check is ALWAYS called for the test BoQ only -- a call with no arguments would heal the
site's real runs and clear its real stuck flags.

  TestRunLogWrites        create / begin / heartbeat / finish / fail / superseded, the key scrub
  TestHealthCheck         the 6-minute and 22-minute rules, the queued rule, orphan flags, heal on read
  TestTimedCheck          the ONE scheduler entry and the task behind it
  TestAutoRunAfterParse   one Claude job per "Parsed" sheet; who is skipped; Gemini never
  TestWorkerRunLog        the worker's record: heartbeats, tokens, superseded, late answers
  TestFailureCategories   every failure category, each with a linked Error Log and no key in it
"""
import datetime
from unittest.mock import MagicMock, patch

import anthropic
import frappe
import httpx
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_to_date, now_datetime
from rq.timeouts import JobTimeoutException

from nirmaan_stack.api.boq.wizard import ai_assist, ai_run_log
from nirmaan_stack.services import boq_ai_assist

_RUN_LOG = "BoQ AI Run Log"
_CLAUDE_WORKER = "nirmaan_stack.api.boq.wizard.ai_assist._run_ai_pass_worker"
_GEMINI_WORKER = "nirmaan_stack.api.boq.wizard.gemini_assist._run_gemini_pass_worker"
_SETTINGS = "nirmaan_stack.api.boq.wizard.ai_assist.get_boq_ai_settings"
_API_KEY = "nirmaan_stack.api.boq.wizard.ai_assist.get_boq_ai_api_key"
_LOG_SETTINGS = "nirmaan_stack.api.boq.wizard.ai_run_log.get_boq_ai_settings"
_LOG_API_KEY = "nirmaan_stack.api.boq.wizard.ai_run_log.get_boq_ai_api_key"
_GUIDANCE = "nirmaan_stack.services.boq_ai_guidance.build_guidance"
_SERVICE = "nirmaan_stack.services.boq_ai_assist.run_ai_pass"

# Shaped like a real key so the pattern scrub is exercised too. Not a key.
_FAKE_KEY = "sk-ant-" + "T" * 24

_SHEET = "RunSheet"
_OTHER = "OtherSheet"
_SHEETS = {
    _SHEET: "Parsed",
    _OTHER: "Parsed",
    "HiddenSheet": "Hidden",
    "SkipSheet": "Skip",
    "FailedSheet": "Parse failed",
    "SpecsSheet": "General specs",
    "SpecsButParsed": "Parsed",      # listed as a general-specs sheet: never checked
}
_PARSED_AT = datetime.datetime(2026, 1, 5, 10, 0, 0)


def _settings():
    return {
        "enabled": True, "provider": "Anthropic", "model": "claude-test",
        "max_tokens": 8000, "request_timeout_seconds": 120,
    }


def _make_project():
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_S2RUNLOG_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


class _RunLogCase(FrappeTestCase):
    """One BoQ with a sheet in every wizard status; fresh rows, flags and run log per test."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "S2 Run Log Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("general_specs_sheets", {"source_sheet_name": "SpecsButParsed", "preamble_text": ""})
        for order, (sheet, status) in enumerate(_SHEETS.items(), start=1):
            boq.append("sheet_drafts", {
                "sheet_name": sheet, "sheet_order": order, "wizard_status": status,
            })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        for b in frappe.get_all("BOQs", filters={"project": cls.test_project.name}, pluck="name"):
            frappe.db.delete(_RUN_LOG, {"boq": b})
            frappe.db.delete("BoQ Review Row", {"boq": b})
            frappe.delete_doc("BOQs", b, force=True, ignore_permissions=True)
        frappe.delete_doc("Projects", cls.test_project.name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        frappe.db.rollback()
        frappe.db.delete(_RUN_LOG, {"boq": self.boq_name})
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name})
        for sheet, status in _SHEETS.items():
            self._set_draft(sheet, {
                "wizard_status": status, "ai_in_progress": 0, "gemini_in_progress": 0,
                "last_parsed_at": _PARSED_AT, "has_prior_parse": 0,
            })
        frappe.db.set_value("BOQs", self.boq_name, "origin", "upload")
        for ridx, cls_ in [(0, "preamble"), (1, "line_item"), (2, "line_item")]:
            frappe.get_doc({
                "doctype": "BoQ Review Row", "boq": self.boq_name, "sheet_name": _SHEET,
                "row_index": ridx, "source_row_number": ridx + 2, "classification": cls_,
                "parent_index": -1, "human_parent": -1, "human_is_root": 0,
                "ai_suggested_parent": -1, "ai_suggested_level": -1,
            }).insert(ignore_permissions=True)
        for sheet in _SHEETS:
            frappe.cache().delete_value(ai_assist._ai_status_key(self.boq_name, sheet))
        frappe.db.commit()

    # -- helpers ------------------------------------------------------------

    def _draft(self, sheet, field):
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq_name, "parenttype": "BOQs", "sheet_name": sheet}, field,
        )

    def _set_draft(self, sheet, values):
        name = self._draft(sheet, "name")
        frappe.db.set_value("BoQ Sheet Draft", name, values)

    def _flag(self, sheet=_SHEET, field="ai_in_progress"):
        return int(self._draft(sheet, field) or 0)

    def _make_run(self, status="Queued", sheet=_SHEET, **fields):
        """A committed run record. Time fields are written after create_run (which stamps now)."""
        name = ai_run_log.create_run(
            self.boq_name, sheet, ai_run_log.TRIGGER_MANUAL, status=status,
            job_id=fields.pop("job_id", "job-" + frappe.generate_hash(length=8)),
            last_parsed_at=fields.pop("last_parsed_at", _PARSED_AT),
        )
        if fields:
            frappe.db.set_value(_RUN_LOG, name, fields)
        frappe.db.commit()
        return name

    def _run(self, name):
        frappe.db.rollback()        # read what is COMMITTED, nothing this connection still holds
        return frappe.get_doc(_RUN_LOG, name)

    def _runs(self, sheet=None):
        frappe.db.rollback()
        filters = {"boq": self.boq_name}
        if sheet:
            filters["sheet_name"] = sheet
        return [frappe.get_doc(_RUN_LOG, n)
                for n in frappe.get_all(_RUN_LOG, filters=filters, pluck="name", order_by="creation")]

    def _heal(self, sheet=None):
        # ALWAYS scoped to the test BoQ (see the module docstring).
        return ai_run_log.heal_stale_runs(self.boq_name, sheet)


# ===========================================================================
# Writes
# ===========================================================================

class TestRunLogWrites(_RunLogCase):

    def test_create_run_records_what_the_run_is(self):
        name = ai_run_log.create_run(
            self.boq_name, _SHEET, ai_run_log.TRIGGER_AUTO, job_id="job-1", last_parsed_at=_PARSED_AT
        )
        frappe.db.commit()
        run = self._run(name)
        self.assertEqual((run.boq, run.sheet_name, run.trigger, run.status, run.job_id),
                         (self.boq_name, _SHEET, "auto-after-parse", "Queued", "job-1"))
        self.assertEqual(run.prompt_version, boq_ai_assist.PROMPT_VERSION)
        self.assertEqual(run.sheet_last_parsed_at, _PARSED_AT)
        self.assertIsNotNone(run.queued_at)
        self.assertIsNone(run.started_at)

    def test_begin_run_moves_queued_to_running_with_the_first_heartbeat(self):
        name = self._make_run()
        self.assertTrue(ai_run_log.begin_run(name, self.boq_name, _SHEET))
        run = self._run(name)
        self.assertEqual(run.status, "Running")
        self.assertIsNotNone(run.started_at)
        self.assertEqual(run.last_heartbeat, run.started_at)

    def test_begin_run_refuses_a_run_that_is_no_longer_queued(self):
        name = self._make_run(status="Failed")
        self.assertFalse(ai_run_log.begin_run(name, self.boq_name, _SHEET))
        self.assertEqual(self._run(name).status, "Failed")

    def test_begin_run_without_a_record_never_blocks_the_pass(self):
        self.assertTrue(ai_run_log.begin_run(None, self.boq_name, _SHEET))
        self.assertTrue(ai_run_log.begin_run("no-such-run", self.boq_name, _SHEET))

    def test_begin_run_marks_a_run_for_an_older_parse_superseded(self):
        name = self._make_run()
        self._set_draft(_SHEET, {"last_parsed_at": add_to_date(_PARSED_AT, minutes=5), "ai_in_progress": 1})
        frappe.db.commit()
        self.assertFalse(ai_run_log.begin_run(name, self.boq_name, _SHEET))
        run = self._run(name)
        self.assertEqual(run.status, "Superseded")
        self.assertIn("superseded", run.failure_message)
        self.assertIsNotNone(run.finished_at)
        self.assertEqual(self._flag(), 0, "no newer run owns the flag, so it is cleared")

    def test_a_superseded_run_leaves_the_flag_to_a_newer_live_run(self):
        old = self._make_run()
        self._set_draft(_SHEET, {"last_parsed_at": add_to_date(_PARSED_AT, minutes=5), "ai_in_progress": 1})
        frappe.db.commit()
        self._make_run(last_parsed_at=add_to_date(_PARSED_AT, minutes=5))    # the re-parse's own run
        self.assertFalse(ai_run_log.begin_run(old, self.boq_name, _SHEET))
        self.assertEqual(self._run(old).status, "Superseded")
        self.assertEqual(self._flag(), 1, "the newer run is live: the flag is still its own")

    def test_heartbeat_commits_the_stamp_and_the_progress(self):
        name = self._make_run(status="Running")
        ai_run_log.heartbeat(name, chunks_done=2, input_tokens=900)
        run = self._run(name)       # _run rolls back first: only a committed write survives
        self.assertIsNotNone(run.last_heartbeat)
        self.assertEqual((run.chunks_done, run.input_tokens), (2, 900))

    def test_heartbeat_never_raises(self):
        ai_run_log.heartbeat(None)
        with patch.object(ai_run_log, "_update", side_effect=RuntimeError("db down")), \
             patch("frappe.log_error") as log:
            ai_run_log.heartbeat("some-run")
        self.assertTrue(log.called)

    def test_progress_recorder_keeps_only_the_run_log_fields(self):
        name = self._make_run(status="Running")
        record = ai_run_log.progress_recorder(name)
        record("start", chunks_total=3)
        record("attempt", chunk=1, attempt=2)
        record("chunk", chunks_done=1, input_tokens=120, output_tokens=30)
        run = self._run(name)
        self.assertEqual((run.chunks_total, run.chunks_done, run.input_tokens, run.output_tokens),
                         (3, 1, 120, 30))

    def test_still_running(self):
        self.assertTrue(ai_run_log.still_running(None))
        self.assertTrue(ai_run_log.still_running(self._make_run(status="Running")))
        self.assertFalse(ai_run_log.still_running(self._make_run(status="Failed")))

    def test_fail_run_stores_the_category_and_a_scrubbed_capped_message(self):
        name = self._make_run(status="Running")
        ai_run_log.fail_run(
            name, boq_ai_assist.CATEGORY_API_ERROR,
            f"bad key {_FAKE_KEY} and my-other-secret " + "x" * 3000,
            secrets=["my-other-secret"],
        )
        frappe.db.commit()
        run = self._run(name)
        self.assertEqual((run.status, run.failure_category), ("Failed", "API error"))
        self.assertNotIn(_FAKE_KEY, run.failure_message)
        self.assertNotIn("my-other-secret", run.failure_message)
        self.assertIn("[key removed]", run.failure_message)
        self.assertEqual(len(run.failure_message), ai_run_log.FAILURE_MESSAGE_MAX)
        self.assertIsNotNone(run.finished_at)

    def test_same_parse(self):
        later = add_to_date(_PARSED_AT, seconds=1)
        self.assertTrue(ai_run_log.same_parse(_PARSED_AT, _PARSED_AT))
        self.assertTrue(ai_run_log.same_parse(str(_PARSED_AT), _PARSED_AT), "text and datetime compare equal")
        self.assertFalse(ai_run_log.same_parse(_PARSED_AT, later))
        self.assertFalse(ai_run_log.same_parse(_PARSED_AT, None), "the sheet draft is gone")
        self.assertTrue(ai_run_log.same_parse(None, later), "a run with no recorded parse is never refused")


# ===========================================================================
# Health check
# ===========================================================================

class TestHealthCheck(_RunLogCase):

    def _ago(self, **kw):
        return add_to_date(now_datetime(), **{k: -v for k, v in kw.items()})

    def test_the_limits_are_six_and_twenty_two_minutes_and_the_job_limit_twenty(self):
        self.assertEqual(ai_run_log.HEARTBEAT_STALE_SEC, 6 * 60)
        self.assertEqual(ai_run_log.RUN_STALE_SEC, 22 * 60)
        self.assertEqual(ai_run_log.CLAUDE_JOB_TIMEOUT_SEC, 20 * 60)

    def test_no_heartbeat_for_six_minutes_fails_the_run_and_clears_the_flag(self):
        name = self._make_run(status="Running", started_at=self._ago(minutes=8),
                              last_heartbeat=self._ago(minutes=7))
        self._set_draft(_SHEET, {"ai_in_progress": 1})
        frappe.db.commit()
        with patch("frappe.publish_realtime") as publish:
            result = self._heal()
        run = self._run(name)
        self.assertEqual(result["failed_runs"], 1)
        self.assertEqual((run.status, run.failure_category), ("Failed", "worker stopped or timed out"))
        self.assertIn("no heartbeat", run.failure_message)
        self.assertIsNotNone(run.finished_at)
        self.assertEqual(self._flag(), 0)
        event, payload = publish.call_args.args[:2]
        self.assertEqual(event, "boq:ai_pass_done")
        self.assertEqual((payload["status"], payload["error_code"]), ("error", "stale"))
        # The page's poll fallback gets the same answer.
        status = frappe.cache().get_value(ai_assist._ai_status_key(self.boq_name, _SHEET))
        self.assertEqual(status["error_code"], "stale")

    def test_a_heartbeat_five_minutes_old_is_healthy(self):
        name = self._make_run(status="Running", started_at=self._ago(minutes=10),
                              last_heartbeat=self._ago(minutes=5))
        self._set_draft(_SHEET, {"ai_in_progress": 1})
        frappe.db.commit()
        self.assertEqual(self._heal()["failed_runs"], 0)
        self.assertEqual(self._run(name).status, "Running")
        self.assertEqual(self._flag(), 1, "the flag of a live run is never cleared")

    def test_a_run_started_more_than_twenty_two_minutes_ago_fails_even_with_a_fresh_heartbeat(self):
        name = self._make_run(status="Running", started_at=self._ago(minutes=23),
                              last_heartbeat=self._ago(seconds=10))
        with patch("frappe.publish_realtime"):
            self._heal()
        run = self._run(name)
        self.assertEqual((run.status, run.failure_category), ("Failed", "worker stopped or timed out"))
        self.assertIn("started more than", run.failure_message)

    def test_a_run_started_twenty_one_minutes_ago_with_a_fresh_heartbeat_is_healthy(self):
        name = self._make_run(status="Running", started_at=self._ago(minutes=21),
                              last_heartbeat=self._ago(seconds=10))
        self._heal()
        self.assertEqual(self._run(name).status, "Running")

    def test_a_queued_run_fails_only_when_its_job_has_left_the_queue(self):
        gone = self._make_run(queued_at=self._ago(minutes=3), job_id="job-gone")
        with patch("frappe.utils.background_jobs.get_job_status", return_value=None), \
             patch("frappe.publish_realtime"):
            self._heal()
        run = self._run(gone)
        self.assertEqual((run.status, run.failure_category), ("Failed", "worker stopped or timed out"))
        self.assertIn("no longer in the queue", run.failure_message)

    def test_a_queued_run_whose_job_is_waiting_is_never_failed_by_time(self):
        waiting = self._make_run(queued_at=self._ago(hours=5), job_id="job-waiting")
        self._set_draft(_SHEET, {"ai_in_progress": 1})
        frappe.db.commit()
        for state in ("queued", "started", "deferred", "scheduled"):
            with patch("frappe.utils.background_jobs.get_job_status", return_value=state):
                self._heal()
            self.assertEqual(self._run(waiting).status, "Queued", state)
        self.assertEqual(self._flag(), 1)

    def test_a_finished_or_failed_job_counts_as_gone(self):
        for state in ("finished", "failed", "canceled", "stopped"):
            name = self._make_run(queued_at=self._ago(minutes=3))
            with patch("frappe.utils.background_jobs.get_job_status", return_value=state), \
                 patch("frappe.publish_realtime"):
                self._heal()
            self.assertEqual(self._run(name).status, "Failed", state)

    def test_a_just_queued_run_is_given_time_to_reach_the_queue(self):
        name = self._make_run()     # queued now
        with patch("frappe.utils.background_jobs.get_job_status", return_value=None):
            self._heal()
        self.assertEqual(self._run(name).status, "Queued")

    def test_a_stale_run_leaves_the_flag_to_another_live_run_of_the_same_sheet(self):
        stale = self._make_run(status="Running", started_at=self._ago(minutes=30),
                               last_heartbeat=self._ago(minutes=30))
        self._make_run()            # a newer run, just queued
        self._set_draft(_SHEET, {"ai_in_progress": 1})
        frappe.db.commit()
        with patch("frappe.publish_realtime") as publish:
            self._heal()
        self.assertEqual(self._run(stale).status, "Failed")
        self.assertEqual(self._flag(), 1)
        self.assertFalse(publish.called, "the page is still waiting for the newer run")

    def test_the_check_is_scoped_to_the_sheet_it_is_given(self):
        other = self._make_run(status="Running", sheet=_OTHER, started_at=self._ago(minutes=30),
                               last_heartbeat=self._ago(minutes=30))
        self._heal(_SHEET)
        self.assertEqual(self._run(other).status, "Running")
        with patch("frappe.publish_realtime"):
            self._heal(_OTHER)
        self.assertEqual(self._run(other).status, "Failed")

    # -- stuck flags with no run record ---------------------------------------

    def test_a_stuck_flag_with_no_run_and_no_job_is_cleared_for_claude_and_gemini(self):
        self._set_draft(_SHEET, {"ai_in_progress": 1, "gemini_in_progress": 1})
        frappe.db.commit()
        with patch.object(ai_run_log, "_live_sheet_jobs", return_value=set()):
            result = self._heal()
        self.assertEqual((result["ai_flags_cleared"], result["gemini_flags_cleared"]), (1, 1))
        frappe.db.rollback()
        self.assertEqual((self._flag(), self._flag(field="gemini_in_progress")), (0, 0))

    def test_a_flag_whose_job_is_alive_is_never_cleared(self):
        self._set_draft(_SHEET, {"ai_in_progress": 1, "gemini_in_progress": 1})
        frappe.db.commit()
        alive = {(_CLAUDE_WORKER, self.boq_name, _SHEET), (_GEMINI_WORKER, self.boq_name, _SHEET)}
        with patch.object(ai_run_log, "_live_sheet_jobs", return_value=alive):
            result = self._heal()
        self.assertEqual((result["ai_flags_cleared"], result["gemini_flags_cleared"]), (0, 0))
        self.assertEqual((self._flag(), self._flag(field="gemini_in_progress")), (1, 1))

    def test_a_job_of_another_sheet_does_not_protect_this_flag(self):
        self._set_draft(_SHEET, {"ai_in_progress": 1})
        frappe.db.commit()
        with patch.object(ai_run_log, "_live_sheet_jobs",
                          return_value={(_CLAUDE_WORKER, self.boq_name, _OTHER)}):
            self.assertEqual(self._heal()["ai_flags_cleared"], 1)

    def test_nothing_is_cleared_when_the_queue_cannot_be_read(self):
        self._set_draft(_SHEET, {"ai_in_progress": 1, "gemini_in_progress": 1})
        frappe.db.commit()
        with patch.object(ai_run_log, "_live_sheet_jobs", return_value=None):
            result = self._heal()
        self.assertEqual((result["ai_flags_cleared"], result["gemini_flags_cleared"]), (0, 0))
        self.assertEqual((self._flag(), self._flag(field="gemini_in_progress")), (1, 1))

    def test_live_sheet_jobs_reads_queued_and_started_jobs_of_this_site_only(self):
        def job(site, method, **kwargs):
            j = MagicMock()
            j.kwargs = {"site": site, "method": method, "kwargs": kwargs}
            return j

        queue = MagicMock()
        queue.job_ids = ["a", "b"]
        queue.started_job_registry.get_job_ids.return_value = ["c", "d"]
        jobs = [
            job(frappe.local.site, _CLAUDE_WORKER, boq_name="B1", sheet_name="S1"),
            job("another.site", _CLAUDE_WORKER, boq_name="B2", sheet_name="S2"),
            job(frappe.local.site, _GEMINI_WORKER, boq_name="B3", sheet_name="S3"),
            None,       # a job that expired between the two reads
        ]
        with patch("frappe.utils.background_jobs.get_queue", return_value=queue), \
             patch("rq.job.Job.fetch_many", return_value=jobs) as fetch:
            live = ai_run_log._live_sheet_jobs()
        self.assertEqual(fetch.call_args.args[0], ["a", "b", "c", "d"])
        self.assertEqual(live, {(_CLAUDE_WORKER, "B1", "S1"), (_GEMINI_WORKER, "B3", "S3")})

    def test_live_sheet_jobs_returns_none_when_the_queue_read_fails(self):
        with patch("frappe.utils.background_jobs.get_queue", side_effect=RuntimeError("redis down")), \
             patch("frappe.log_error"):
            self.assertIsNone(ai_run_log._live_sheet_jobs())

    # -- heal on read ---------------------------------------------------------

    def test_the_status_read_heals_a_dead_run(self):
        name = self._make_run(status="Running", started_at=self._ago(minutes=9),
                              last_heartbeat=self._ago(minutes=9))
        self._set_draft(_SHEET, {"ai_in_progress": 1})
        frappe.db.commit()
        with patch("frappe.publish_realtime"):
            status = ai_assist.get_ai_pass_status(boq_name=self.boq_name, sheet_name=_SHEET)
        self.assertEqual((status["status"], status["error_code"]), ("error", "stale"))
        self.assertEqual(self._run(name).status, "Failed")
        self.assertEqual(self._flag(), 0)

    def test_a_run_start_heals_first_so_a_stuck_sheet_can_be_run_again(self):
        self._make_run(status="Running", started_at=self._ago(minutes=9),
                       last_heartbeat=self._ago(minutes=9))
        self._set_draft(_SHEET, {"ai_in_progress": 1})
        frappe.db.commit()
        with patch(_SETTINGS, return_value=_settings()), patch(_API_KEY, return_value="k"), \
             patch("frappe.publish_realtime"), \
             patch("frappe.enqueue", return_value=MagicMock()) as enqueue:
            result = ai_assist.run_ai_pass(boq_name=self.boq_name, sheet_name=_SHEET)
        self.assertTrue(result.get("enqueued"), result)
        self.assertTrue(enqueue.called)
        self.assertEqual([r.status for r in self._runs()], ["Failed", "Queued"])

    def test_a_parse_start_heals_the_boq_and_reports_the_sheets_parsed_before(self):
        name = self._make_run(status="Running", started_at=self._ago(minutes=9),
                              last_heartbeat=self._ago(minutes=9))
        self._set_draft(_OTHER, {"has_prior_parse": 1})
        frappe.db.commit()
        with patch("frappe.publish_realtime"):
            prior = ai_run_log.on_parse_start(self.boq_name)
        self.assertEqual(prior, frozenset({_OTHER}))
        self.assertEqual(self._run(name).status, "Failed")

    def test_a_health_check_problem_never_fails_the_read_or_the_parse(self):
        with patch.object(ai_run_log, "heal_stale_runs", side_effect=RuntimeError("boom")), \
             patch("frappe.log_error") as log:
            ai_run_log.heal_on_read(self.boq_name, _SHEET)
            self.assertEqual(ai_run_log.on_parse_start(self.boq_name), frozenset())
        self.assertEqual(log.call_count, 2)


# ===========================================================================
# The timed check
# ===========================================================================

class TestTimedCheck(FrappeTestCase):
    _TASK = "nirmaan_stack.api.boq.wizard.ai_run_log.heal_stale_runs_task"

    def test_exactly_one_scheduler_entry_every_five_minutes(self):
        events = frappe.get_hooks("scheduler_events")
        self.assertEqual(events["cron"]["*/5 * * * *"], [self._TASK])
        every_entry = [
            method
            for group in events.values()
            for methods in (group.values() if isinstance(group, dict) else [group])
            for method in methods
        ]
        self.assertEqual([m for m in every_entry if "ai_run_log" in m or "boq_ai" in m], [self._TASK],
                         "S2 adds ONE timed job and nothing else (no scheduled library rebuild)")
        self.assertTrue(callable(frappe.get_attr(self._TASK)))

    def test_the_task_checks_every_live_run(self):
        # The real call is NOT made here: with no arguments it would heal the site's own runs.
        with patch.object(ai_run_log, "heal_stale_runs") as heal:
            ai_run_log.heal_stale_runs_task()
        heal.assert_called_once_with()

    def test_the_task_makes_no_ai_call_and_loads_no_library(self):
        import inspect
        source = inspect.getsource(ai_run_log)
        self.assertNotIn("boq_ai_guidance", source)
        self.assertNotIn("anthropic", source)


# ===========================================================================
# The automatic run after a parse
# ===========================================================================

class TestAutoRunAfterParse(_RunLogCase):

    def _enqueue(self, sheets, prior=frozenset(), settings=None, key="k", enqueue=None, allowed=True):
        enqueue = enqueue or MagicMock()
        with patch.object(ai_run_log, "_auto_run_allowed", return_value=allowed), \
             patch(_LOG_SETTINGS, return_value=settings or _settings()), \
             patch(_LOG_API_KEY, return_value=key), \
             patch("frappe.enqueue", enqueue):
            runs = ai_run_log.enqueue_after_parse(self.boq_name, sheets, "Administrator", prior)
        return runs, enqueue

    def test_one_claude_job_per_parsed_sheet(self):
        runs, enqueue = self._enqueue(list(_SHEETS))
        self.assertEqual(enqueue.call_count, 2)
        queued = {}
        for call in enqueue.call_args_list:
            self.assertEqual(call.args, (_CLAUDE_WORKER,), "only the Claude worker; Gemini is never auto-run")
            kw = call.kwargs
            self.assertEqual((kw["queue"], kw["timeout"], kw["boq_name"], kw["user"]),
                             ("long", 1200, self.boq_name, "Administrator"))
            queued[kw["sheet_name"]] = kw
        self.assertEqual(sorted(queued), sorted([_SHEET, _OTHER]))
        records = {r.sheet_name: r for r in self._runs()}
        self.assertEqual(sorted(records), sorted([_SHEET, _OTHER]))
        self.assertEqual(sorted(runs), sorted(r.name for r in records.values()))
        for sheet, run in records.items():
            self.assertEqual((run.status, run.trigger), ("Queued", "auto-after-parse"))
            self.assertEqual(run.sheet_last_parsed_at, _PARSED_AT)
            self.assertEqual((queued[sheet]["run_name"], queued[sheet]["job_id"]), (run.name, run.job_id))
            self.assertEqual(self._flag(sheet), 1)

    def test_no_job_for_a_failed_hidden_skip_or_general_specs_sheet(self):
        skipped = ["HiddenSheet", "SkipSheet", "FailedSheet", "SpecsSheet", "SpecsButParsed"]
        runs, enqueue = self._enqueue(skipped)
        self.assertEqual(runs, [])
        self.assertFalse(enqueue.called)
        self.assertEqual(self._runs(), [])
        self.assertEqual([self._flag(s) for s in skipped], [0] * 5)

    def test_a_sheet_the_parse_did_not_touch_gets_no_job(self):
        runs, enqueue = self._enqueue([_OTHER])
        self.assertEqual([c.kwargs["sheet_name"] for c in enqueue.call_args_list], [_OTHER])
        self.assertEqual(self._flag(_SHEET), 0)

    def test_a_re_parsed_sheet_is_logged_as_re_parse(self):
        self._enqueue([_SHEET, _OTHER], prior=frozenset({_SHEET}))
        self.assertEqual({r.sheet_name: r.trigger for r in self._runs()},
                         {_SHEET: "re-parse", _OTHER: "auto-after-parse"})

    def test_no_job_for_a_template_boq(self):
        frappe.db.set_value("BOQs", self.boq_name, "origin", "template")
        frappe.db.commit()
        runs, enqueue = self._enqueue([_SHEET])
        self.assertEqual((runs, enqueue.called, self._runs()), ([], False, []))

    def test_a_revision_boq_is_checked_like_an_upload(self):
        frappe.db.set_value("BOQs", self.boq_name, "origin", "revision")
        frappe.db.commit()
        _, enqueue = self._enqueue([_SHEET])
        self.assertEqual(enqueue.call_count, 1)

    def test_ai_disabled_or_no_key_records_the_reason_and_queues_nothing(self):
        for settings, key, words in (
            ({**_settings(), "enabled": False}, "k", "disabled"),
            (_settings(), None, "no API key"),
        ):
            frappe.db.delete(_RUN_LOG, {"boq": self.boq_name})
            frappe.db.commit()
            _, enqueue = self._enqueue([_SHEET], settings=settings, key=key)
            self.assertFalse(enqueue.called)
            (run,) = self._runs()
            self.assertEqual((run.status, run.failure_category), ("Failed", "no key / disabled"))
            self.assertIn(words, run.failure_message)
            self.assertIsNotNone(run.finished_at)
            self.assertEqual(self._flag(), 0)

    def test_a_failed_enqueue_is_recorded_and_sets_no_flag(self):
        enqueue = MagicMock(side_effect=RuntimeError(f"redis refused {_FAKE_KEY}"))
        self._enqueue([_SHEET], enqueue=enqueue)
        (run,) = self._runs()
        self.assertEqual((run.status, run.failure_category), ("Failed", "internal error"))
        self.assertIn("RuntimeError", run.failure_message)
        self.assertNotIn(_FAKE_KEY, run.failure_message)
        self.assertEqual(self._flag(), 0)

    def test_the_record_is_committed_before_the_job_is_queued(self):
        seen = {}

        def enqueue(*args, **kwargs):
            frappe.db.rollback()        # whatever is not committed yet is gone now
            seen["status"] = frappe.db.get_value(_RUN_LOG, kwargs["run_name"], "status")

        self._enqueue([_SHEET], enqueue=MagicMock(side_effect=enqueue))
        self.assertEqual(seen["status"], "Queued")

    def test_the_previous_outcome_does_not_answer_the_new_runs_first_poll(self):
        key = ai_assist._ai_status_key(self.boq_name, _SHEET)
        frappe.cache().set_value(key, {"status": "error", "error_code": "internal"})
        self._enqueue([_SHEET])
        self.assertIsNone(frappe.cache().get_value(key))

    def test_under_a_test_run_nothing_is_ever_queued(self):
        """A parse inside a test must never put a real, paid job on the site's queue."""
        self.assertTrue(frappe.flags.in_test)
        self.assertFalse(ai_run_log._auto_run_allowed())
        with patch("frappe.enqueue") as enqueue:
            runs = ai_run_log.enqueue_after_parse(self.boq_name, [_SHEET], "Administrator")
        self.assertEqual((runs, enqueue.called, self._runs()), ([], False, []))

    def test_it_never_raises_into_the_parse(self):
        with patch.object(ai_run_log, "_enqueue_after_parse", side_effect=RuntimeError("boom")), \
             patch("frappe.log_error") as log:
            self.assertEqual(ai_run_log.enqueue_after_parse(self.boq_name, [_SHEET]), [])
        self.assertTrue(log.called)


# ===========================================================================
# The worker's record
# ===========================================================================

def _fake_guidance(boq_name, rows, info=None):
    if info is not None:
        info.update({"library_status": "ok", "library_seconds": 0.5, "lookup_seconds": 0.25,
                     "library_memory_peak_mib": 123.4})
    return {}


_SUGGESTION = {
    "row_index": 1, "ai_suggested_classification": "preamble",
    "ai_classification_confidence": "High", "ai_suggested_parent": None,
    "ai_parent_confidence": None, "ai_explanation": "looks like a header",
}


class TestWorkerRunLog(_RunLogCase):

    def _ai_fields(self):
        frappe.db.rollback()
        return frappe.get_all(
            "BoQ Review Row", filters={"boq": self.boq_name, "sheet_name": _SHEET},
            fields=["row_index", "ai_suggested_classification", "ai_explanation"], order_by="row_index",
        )

    def _work(self, run_name, service):
        self._set_draft(_SHEET, {"ai_in_progress": 1})
        frappe.db.commit()
        with patch(_SETTINGS, return_value=_settings()), patch(_API_KEY, return_value=_FAKE_KEY), \
             patch(_GUIDANCE, side_effect=_fake_guidance), \
             patch(_SERVICE, side_effect=service) as svc, \
             patch("frappe.publish_realtime") as publish:
            ai_assist._run_ai_pass_worker(self.boq_name, _SHEET, user=None, run_name=run_name)
        return svc, publish

    def test_a_successful_run_is_recorded_with_its_heartbeats(self):
        name = self._make_run()
        seen = []

        def service(sheet_name, rows, settings, api_key, guidance=None, progress=None):
            def committed():
                frappe.db.rollback()
                return frappe.db.get_value(
                    _RUN_LOG, name,
                    ["status", "library_status", "chunks_total", "chunks_done", "input_tokens"],
                    as_dict=True,
                )
            seen.append(("library", committed()))
            progress("start", chunks_total=2)
            progress("attempt", chunk=1, attempt=1)
            progress("chunk", chunks_done=1, input_tokens=100, output_tokens=10)
            seen.append(("chunk 1", committed()))
            progress("attempt", chunk=2, attempt=1)
            progress("chunk", chunks_done=2, input_tokens=250, output_tokens=25)
            return [_SUGGESTION]

        real_heartbeat = ai_run_log.heartbeat
        with patch.object(ai_run_log, "heartbeat", side_effect=real_heartbeat) as beat:
            _, publish = self._work(name, service)

        # Heartbeats: after the library step, at the service's start, before each of the 2
        # requests, after each of the 2 chunks. (Job start and end stamp it in begin / finish.)
        self.assertEqual(beat.call_count, 6)
        self.assertEqual(seen[0][1], {"status": "Running", "library_status": "ok", "chunks_total": 0,
                                      "chunks_done": 0, "input_tokens": 0})
        self.assertEqual((seen[1][1].chunks_total, seen[1][1].chunks_done, seen[1][1].input_tokens),
                         (2, 1, 100), "progress is committed while the job is still running")

        run = self._run(name)
        self.assertEqual(run.status, "Done")
        self.assertEqual((run.chunks_total, run.chunks_done, run.input_tokens, run.output_tokens),
                         (2, 2, 250, 25))
        self.assertEqual((run.library_status, run.library_seconds, run.lookup_seconds,
                          run.library_memory_peak_mib), ("ok", 0.5, 0.25, 123.4))
        self.assertEqual(run.suggestion_count, 1)
        self.assertIsNotNone(run.ai_seconds)
        self.assertTrue(run.queued_at <= run.started_at <= run.finished_at)
        self.assertEqual(run.last_heartbeat, run.finished_at)
        self.assertFalse(run.failure_category)
        self.assertEqual(self._ai_fields()[1].ai_suggested_classification, "preamble")
        self.assertEqual(self._flag(), 0)
        self.assertEqual(publish.call_args.args[1]["status"], "success")

    def test_a_run_for_an_older_parse_makes_no_ai_call(self):
        name = self._make_run()
        self._set_draft(_SHEET, {"last_parsed_at": add_to_date(_PARSED_AT, minutes=1)})
        frappe.db.commit()
        svc, publish = self._work(name, MagicMock(return_value=[_SUGGESTION]))
        self.assertFalse(svc.called)
        self.assertFalse(publish.called)
        self.assertEqual(self._run(name).status, "Superseded")

    def test_a_re_parse_during_the_run_discards_the_answers(self):
        name = self._make_run()

        def service(*args, **kwargs):
            # The sheet is re-parsed while Claude is answering.
            self._set_draft(_SHEET, {"last_parsed_at": add_to_date(_PARSED_AT, minutes=1)})
            frappe.db.commit()
            return [_SUGGESTION]

        svc, publish = self._work(name, service)
        self.assertTrue(svc.called)
        run = self._run(name)
        self.assertEqual(run.status, "Superseded")
        self.assertIn("superseded", run.failure_message)
        self.assertTrue(all(r.ai_suggested_classification is None and not r.ai_explanation
                            for r in self._ai_fields()), "nothing from the old run is written")
        self.assertFalse(publish.called, "a superseded run tells the page nothing")
        self.assertEqual(self._flag(), 0, "no newer run is live here, so the flag is cleared")

    def test_a_superseded_run_does_not_touch_the_newer_runs_flag(self):
        name = self._make_run()

        def service(*args, **kwargs):
            later = add_to_date(_PARSED_AT, minutes=1)
            self._set_draft(_SHEET, {"last_parsed_at": later})
            self._make_run(last_parsed_at=later)      # the re-parse queued its own run
            return [_SUGGESTION]

        self._work(name, service)
        self.assertEqual([r.status for r in self._runs()], ["Superseded", "Queued"])
        self.assertEqual(self._flag(), 1)

    def test_write_back_refuses_directly_when_the_parse_time_no_longer_matches(self):
        rows = ai_assist._fetch_review_rows_for_ai(self.boq_name, _SHEET)
        with self.assertRaises(ai_run_log.RunSuperseded):
            ai_assist._apply_ai_suggestions(
                self.boq_name, _SHEET, rows, [_SUGGESTION],
                expected_last_parsed_at=add_to_date(_PARSED_AT, minutes=-1),
            )
        self.assertIsNone(self._ai_fields()[1].ai_suggested_classification)
        # The same call for the CURRENT parse writes (the refusal is the only change).
        self.assertEqual(ai_assist._apply_ai_suggestions(
            self.boq_name, _SHEET, rows, [_SUGGESTION], expected_last_parsed_at=_PARSED_AT), 1)

    def test_answers_that_arrive_after_the_health_check_failed_the_run_are_discarded(self):
        name = self._make_run()

        def service(*args, **kwargs):
            # The health check gives up on this run while its worker is still busy.
            ai_run_log.fail_run(name, ai_run_log.CATEGORY_STALE, "worker stopped or timed out")
            ai_assist._publish_ai_event(self.boq_name, _SHEET, "error", error_code="stale")
            return [_SUGGESTION]

        self._work(name, service)
        run = self._run(name)
        self.assertEqual((run.status, run.failure_category), ("Failed", "worker stopped or timed out"))
        self.assertIsNone(self._ai_fields()[1].ai_suggested_classification)

    def test_a_worker_without_a_run_record_works_as_before(self):
        self._work(None, MagicMock(return_value=[_SUGGESTION]))
        self.assertEqual(self._ai_fields()[1].ai_suggested_classification, "preamble")
        self.assertEqual(self._runs(), [])

    def test_a_manual_run_writes_a_record(self):
        with patch(_SETTINGS, return_value=_settings()), patch(_API_KEY, return_value="k"), \
             patch("frappe.enqueue", return_value=MagicMock()) as enqueue:
            ai_assist.run_ai_pass(boq_name=self.boq_name, sheet_name=_SHEET)
        (run,) = self._runs()
        self.assertEqual((run.trigger, run.status, run.cached), ("manual", "Queued", 0))
        self.assertEqual(enqueue.call_args.kwargs["run_name"], run.name)
        self.assertEqual(enqueue.call_args.kwargs["job_id"], run.job_id)
        self.assertEqual(run.sheet_last_parsed_at, _PARSED_AT)

    def test_a_manual_cache_hit_is_logged_as_done_cached(self):
        key = ai_assist._ai_cache_key(self.boq_name, _SHEET, self._draft(_SHEET, "last_parsed_at"))
        frappe.cache().set_value(key, [_SUGGESTION])
        self.addCleanup(frappe.cache().delete_value, key)
        with patch(_SETTINGS, return_value=_settings()), patch(_API_KEY, return_value="k"), \
             patch("frappe.enqueue") as enqueue:
            result = ai_assist.run_ai_pass(boq_name=self.boq_name, sheet_name=_SHEET)
        self.assertTrue(result.get("cached"), result)
        self.assertFalse(enqueue.called)
        (run,) = self._runs()
        self.assertEqual((run.trigger, run.status, run.cached, run.suggestion_count),
                         ("manual", "Done", 1, 1))
        self.assertFalse(run.input_tokens)

    def test_a_manual_enqueue_failure_is_recorded(self):
        with patch(_SETTINGS, return_value=_settings()), patch(_API_KEY, return_value="k"), \
             patch("frappe.enqueue", side_effect=RuntimeError("redis refused")):
            with self.assertRaises(RuntimeError):
                ai_assist.run_ai_pass(boq_name=self.boq_name, sheet_name=_SHEET)
        (run,) = self._runs()
        self.assertEqual((run.status, run.failure_category), ("Failed", "internal error"))
        self.assertEqual(self._flag(), 0)


# ===========================================================================
# Failure categories (fake Anthropic client; the REAL service and worker)
# ===========================================================================

_REQUEST = httpx.Request("POST", "https://api.anthropic.com/v1/messages")


def _status_error(cls, code):
    # The provider's own wording ("Error code: 429 - ..."): the retry rule reads the code from it.
    return cls(f"Error code: {code} - provider said no, key {_FAKE_KEY}",
               response=httpx.Response(code, request=_REQUEST), body=None)


class _Usage:
    input_tokens = 10
    output_tokens = 5


class _Block:
    type = "text"

    def __init__(self, text):
        self.text = text


class _Response:
    stop_reason = "end_turn"
    usage = _Usage()

    def __init__(self, text):
        self.content = [_Block(text)]


class _FakeClient:
    """Stands in for anthropic.Anthropic: every create() raises `outcome`, or returns it as text."""
    outcome = None
    calls = 0
    init_kwargs = None

    def __init__(self, **kwargs):
        _FakeClient.init_kwargs = kwargs
        self.messages = self

    def create(self, **kwargs):
        _FakeClient.calls += 1
        if isinstance(_FakeClient.outcome, BaseException):
            raise _FakeClient.outcome
        return _Response(_FakeClient.outcome)


class TestFailureCategories(_RunLogCase):

    def _fail(self, outcome=None, service=None, expect=Exception):
        name = self._make_run()
        self._set_draft(_SHEET, {"ai_in_progress": 1})
        frappe.db.commit()
        _FakeClient.outcome, _FakeClient.calls = outcome, 0
        patches = [
            patch(_SETTINGS, return_value=_settings()), patch(_API_KEY, return_value=_FAKE_KEY),
            patch(_GUIDANCE, side_effect=_fake_guidance), patch("anthropic.Anthropic", _FakeClient),
            patch.object(boq_ai_assist.time, "sleep"), patch("frappe.publish_realtime"),
        ]
        if service is not None:
            patches.append(patch(_SERVICE, side_effect=service))
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        with self.assertRaises(expect):
            ai_assist._run_ai_pass_worker(self.boq_name, _SHEET, user=None, run_name=name)
        run = self._run(name)
        self.assertEqual(run.status, "Failed")
        self.assertIsNotNone(run.finished_at)
        self.assertEqual(self._flag(), 0)
        # The Error Log entry exists (it is written AFTER the rollback) and is linked.
        self.assertTrue(run.error_log, "the Error Log entry must be linked")
        error_text = frappe.db.get_value("Error Log", run.error_log, "error")
        self.assertIsNotNone(error_text, "the linked Error Log entry must exist")
        self.assertIn("Traceback", error_text)
        # No key anywhere.
        for text in (run.failure_message, error_text):
            self.assertNotIn(_FAKE_KEY, text)
            self.assertNotIn("sk-ant-", text)
        return run

    def test_job_timeout(self):
        run = self._fail(JobTimeoutException("Task exceeded maximum timeout value (1200 seconds)"))
        self.assertEqual(run.failure_category, "job timeout")
        self.assertIn("1200", run.failure_message)
        self.assertEqual(_FakeClient.calls, 1, "the job's own limit is never retried")

    def test_request_timeout(self):
        run = self._fail(anthropic.APITimeoutError(request=_REQUEST))
        self.assertEqual(run.failure_category, "request timeout")
        self.assertEqual(_FakeClient.calls, 3, "the app's own 3 attempts stay")

    def test_rate_limit(self):
        run = self._fail(_status_error(anthropic.RateLimitError, 429))
        self.assertEqual(run.failure_category, "rate limit")
        self.assertIn("429", run.failure_message)
        self.assertEqual(_FakeClient.calls, 3)

    def test_service_overloaded(self):
        for code in (529, 503):
            run = self._fail(_status_error(anthropic.InternalServerError, code))
            self.assertEqual(run.failure_category, "service overloaded", code)
            self.assertIn(str(code), run.failure_message)

    def test_api_error_carries_the_status_code(self):
        run = self._fail(_status_error(anthropic.BadRequestError, 400))
        self.assertEqual(run.failure_category, "API error")
        self.assertIn("status 400", run.failure_message)
        self.assertEqual(_FakeClient.calls, 1, "a 400 is not retried")

    def test_unreadable_answer(self):
        run = self._fail("this is not JSON")
        self.assertEqual(run.failure_category, "unreadable answer")
        self.assertIn("not valid JSON", run.failure_message)

    def test_internal_error_names_the_exception_class(self):
        run = self._fail(service=MagicMock(side_effect=KeyError("row_index")))
        self.assertEqual(run.failure_category, "internal error")
        self.assertIn("KeyError", run.failure_message)

    def test_an_internal_fault_inside_a_request_is_not_called_an_unreadable_answer(self):
        run = self._fail(ZeroDivisionError("division by zero"))
        self.assertEqual(run.failure_category, "internal error")
        self.assertIn("ZeroDivisionError", run.failure_message)

    def test_the_clients_own_retries_are_off(self):
        self._fail(_status_error(anthropic.BadRequestError, 400))
        self.assertEqual(_FakeClient.init_kwargs["max_retries"], 0)

    def test_a_failure_before_any_request_is_recorded_too(self):
        run = self._fail(service=MagicMock(side_effect=RuntimeError("settings missing a model")))
        self.assertEqual(run.failure_category, "internal error")
        self.assertFalse(run.chunks_total)

    def test_every_category_is_a_choice_of_the_doctype_field(self):
        options = frappe.get_meta(_RUN_LOG).get_field("failure_category").options.split("\n")
        produced = [
            boq_ai_assist.CATEGORY_JOB_TIMEOUT, boq_ai_assist.CATEGORY_REQUEST_TIMEOUT,
            boq_ai_assist.CATEGORY_API_ERROR, boq_ai_assist.CATEGORY_RATE_LIMIT,
            boq_ai_assist.CATEGORY_OVERLOADED, boq_ai_assist.CATEGORY_UNAVAILABLE,
            boq_ai_assist.CATEGORY_UNREADABLE, boq_ai_assist.CATEGORY_INTERNAL,
            ai_run_log.CATEGORY_STALE,
        ]
        self.assertEqual(sorted(produced), sorted(o for o in options if o))


# ===========================================================================
# S3: the state of the check for a sheet's current parse, and retention
# ===========================================================================

class TestCheckState(_RunLogCase):

    def _state(self, sheet=_SHEET):
        frappe.db.rollback()
        return ai_run_log.check_state(self.boq_name, sheet)

    def test_no_record_means_not_run(self):
        self.assertEqual(self._state(), {"status": "not_run", "running": False})

    def test_a_finished_run_means_done(self):
        self._make_run(status="Done")
        self.assertEqual(self._state(), {"status": "done", "running": False})

    def test_a_queued_or_running_run_means_running(self):
        for status in ("Queued", "Running"):
            frappe.db.delete(_RUN_LOG, {"boq": self.boq_name})
            self._make_run(status=status)
            self.assertEqual(self._state(), {"status": "running", "running": True}, status)

    def test_only_failed_runs_mean_incomplete(self):
        self._make_run(status="Failed")
        self.assertEqual(self._state(), {"status": "incomplete", "running": False})

    def test_a_finished_run_outranks_a_failed_one_and_a_live_one_is_still_reported(self):
        self._make_run(status="Failed")
        self._make_run(status="Done")
        self.assertEqual(self._state(), {"status": "done", "running": False})
        self._make_run(status="Queued")
        self.assertEqual(self._state(), {"status": "done", "running": True})

    def test_a_record_for_an_older_parse_does_not_count(self):
        self._make_run(status="Done", last_parsed_at=datetime.datetime(2025, 12, 1, 8, 0, 0))
        self.assertEqual(self._state(), {"status": "not_run", "running": False})

    def test_a_superseded_run_checked_nothing(self):
        self._make_run(status="Superseded")
        self.assertEqual(self._state(), {"status": "not_run", "running": False})

    def test_a_sheet_never_parsed_is_not_run(self):
        self._set_draft(_SHEET, {"last_parsed_at": None})
        frappe.db.commit()
        self._make_run(status="Done", last_parsed_at=None)
        self.assertEqual(self._state(), {"status": "not_run", "running": False})

    def test_each_sheet_has_its_own_state(self):
        self._make_run(status="Done")
        self._make_run(status="Failed", sheet=_OTHER)
        frappe.db.rollback()
        states = ai_run_log.check_states(self.boq_name)
        self.assertEqual(states[_SHEET]["status"], "done")
        self.assertEqual(states[_OTHER]["status"], "incomplete")
        self.assertEqual(states["HiddenSheet"]["status"], "not_run")
        self.assertEqual(self._state("NoSuchSheet"), {"status": "not_run", "running": False})


class TestRetention(_RunLogCase):
    """Run records are kept 6 months and pruned at most once a day by the EXISTING timed task.
    Every prune here is narrowed to the test BoQ, so it can never delete a real record."""

    def _aged(self, months, status="Done"):
        name = self._make_run(status=status)
        frappe.db.set_value(_RUN_LOG, name, "creation",
                            frappe.utils.add_months(now_datetime(), -months), update_modified=False)
        frappe.db.commit()
        return name

    def _exists(self, name):
        frappe.db.rollback()
        return bool(frappe.db.exists(_RUN_LOG, name))

    def test_records_older_than_six_months_are_deleted_and_newer_ones_kept(self):
        old, older, recent, new = self._aged(7), self._aged(13, "Failed"), self._aged(5), self._make_run("Done")
        self.assertEqual(ai_run_log.prune_old_runs(force=True, boq_name=self.boq_name), 2)
        self.assertEqual([self._exists(n) for n in (old, older, recent, new)], [False, False, True, True])
        self.assertEqual(ai_run_log.RUN_LOG_KEEP_MONTHS, 6)

    def test_a_run_that_is_still_live_is_never_pruned(self):
        queued, running = self._aged(7, "Queued"), self._aged(7, "Running")
        self.assertEqual(ai_run_log.prune_old_runs(force=True, boq_name=self.boq_name), 0)
        self.assertTrue(self._exists(queued) and self._exists(running))

    def test_it_prunes_at_most_once_a_day(self):
        cache = frappe.cache()
        saved = cache.get_value(ai_run_log._PRUNE_CACHE_KEY, expires=True)
        try:
            cache.delete_value(ai_run_log._PRUNE_CACHE_KEY)
            with patch.dict(frappe.flags, {"in_test": False}), \
                 patch.object(frappe.db, "count", return_value=0) as count, \
                 patch.object(frappe.db, "delete") as delete:
                self.assertEqual(ai_run_log.prune_old_runs(), 0)             # first call of the day
                self.assertTrue(cache.get_value(ai_run_log._PRUNE_CACHE_KEY, expires=True),
                                "it remembers the prune")
                self.assertIsNone(ai_run_log.prune_old_runs())              # the next: skipped
                self.assertIsNone(ai_run_log.prune_old_runs())
            self.assertEqual(count.call_count, 1)
            delete.assert_not_called()
            self.assertEqual(ai_run_log.PRUNE_EVERY_SEC, 24 * 3600)
        finally:
            if saved:
                cache.set_value(ai_run_log._PRUNE_CACHE_KEY, saved, expires_in_sec=ai_run_log.PRUNE_EVERY_SEC)
            else:
                cache.delete_value(ai_run_log._PRUNE_CACHE_KEY)

    def test_under_a_test_run_a_prune_with_no_boq_deletes_nothing(self):
        old = self._aged(7)
        self.assertIsNone(ai_run_log.prune_old_runs(force=True))
        self.assertTrue(self._exists(old))

    def test_the_existing_timed_task_does_the_pruning(self):
        with patch.object(ai_run_log, "heal_stale_runs") as heal, \
             patch.object(ai_run_log, "prune_old_runs") as prune:
            ai_run_log.heal_stale_runs_task()
        heal.assert_called_once_with()
        prune.assert_called_once_with()

    def test_a_prune_failure_never_fails_the_timed_check(self):
        with patch.object(ai_run_log, "heal_stale_runs"), \
             patch.object(ai_run_log, "prune_old_runs", side_effect=RuntimeError("boom")), \
             patch("frappe.log_error") as log_error:
            ai_run_log.heal_stale_runs_task()
        log_error.assert_called_once()

    def test_no_scheduler_entry_was_added_for_it(self):
        events = frappe.get_hooks("scheduler_events")
        every_entry = [
            method
            for group in events.values()
            for methods in (group.values() if isinstance(group, dict) else [group])
            for method in methods
        ]
        self.assertEqual([m for m in every_entry if "ai_run_log" in m],
                         ["nirmaan_stack.api.boq.wizard.ai_run_log.heal_stale_runs_task"])
