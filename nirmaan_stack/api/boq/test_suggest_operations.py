# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rate suggest and the rate match it queues are each their own background operation (spec #1654, #1667, ADR 0047).

The screen follows each through its own status record (`api/background_ops.get_status`), so no other run's outcome
can reach it: a duplicate or older run ends in its own record, and frees no sheet it does not hold. The queue is faked
(`frappe.enqueue` records each operation) and the test runs the queued wrapper itself, as a worker would; the AI edges
(the extraction and the match run) are the other edges faked. Runs against the live site DB with its own made-up BoQ.
"""

import datetime
import uuid
from contextlib import contextmanager
from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.background_ops import get_status
from nirmaan_stack.api.boq import rate_master, rate_match
from nirmaan_stack.api.boq.test_rate_suggest import _insert_cat
from nirmaan_stack.api.boq.wizard.test_classify import _new_boq, _new_sheet, _node
from nirmaan_stack.api.boq.wizard.test_pricing import _categorise_fixture_eligible_rows
from nirmaan_stack.api.boq.wizard.test_review_screen import _cleanup_project, _make_project
from nirmaan_stack.services import background_ops
from nirmaan_stack.services.boq_rate_master import extraction
from nirmaan_stack.services.boq_rate_match import match_run
from nirmaan_stack.services.test_operation_marker import new_request

_RUN = "BoQ Rate Suggestion Run"
_MATCH_RUN = "BoQ Rate Match Run"
_POPULATION = [2, 3]


def _extract(boq, sheet_name, only_rows=None, **kwargs):
    """The extraction edge: every row it is asked for read, with one attribute naming the row."""
    rows = only_rows or _POPULATION
    return {
        "committed_version": 1, "ai_status": "ran", "halt_reason": None, "complete": True,
        "results": [{"excel_row": r, "description": "d", "attributes": {"tag": {"value": f"r{r}"}}} for r in rows],
        "attempted_rows": list(rows), "population_rows": list(_POPULATION),
    }


@contextmanager
def _ai_on():
    with mock.patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_settings", return_value={"enabled": 1}), \
            mock.patch("nirmaan_stack.api.boq.wizard.ai_settings.get_boq_ai_api_key", return_value="made-up-key"):
        yield


class TestSuggestAndMatchAsBackgroundOperations(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.boq = _new_boq(cls.project.name, f"SuggestOps_{frappe.generate_hash(length=6)}")
        cls.sheet = "Suggest Ops "  # VERBATIM trailing space (#152)
        sheet_doc = _new_sheet(cls.boq, cls.sheet, commit_version=1)
        header = _node(cls.boq, sheet_doc, "Preamble", 1, None, "MADE-UP CABLE SECTION", 1)
        _node(cls.boq, sheet_doc, "Line Item", 2, header, "3C x 2.5 sqmm cable", 2, qty=1)
        _node(cls.boq, sheet_doc, "Line Item", 3, header, "4C x 16 sqmm cable", 3, qty=1)
        frappe.db.commit()
        _insert_cat(cls.boq, cls.sheet, 1, 2, "wiring_cabling")
        _insert_cat(cls.boq, cls.sheet, 1, 3, "wiring_cabling")
        _categorise_fixture_eligible_rows(cls.boq, cls.sheet, 1)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        for dt in (_MATCH_RUN, _RUN, "BoQ Row Category", "BOQ Nodes", "BoQ Sheet"):
            try:
                frappe.db.delete(dt, {"boq": cls.boq})
                frappe.db.commit()
            except Exception as e:  # noqa: BLE001 -- report, keep cleaning the other scopes
                frappe.db.rollback()
                print(f"cleanup of {dt} failed: {e}")
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.set_user("Administrator")
        self.queued = []

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.cache().delete_value(rate_master._s_marker_key(self.boq, self.sheet))
        frappe.cache().delete_value(rate_match._marker_key(self.boq, self.sheet))
        new_request()

    # ── the edges ────────────────────────────────────────────────────────────────────────────────────────────────
    def _press(self, **kwargs):
        """One Suggest rates press as the page makes it: `start_suggest` with a browser-made id, then the request's
        own commit, which queues the operation. Returns the op id."""
        op_id = str(uuid.uuid4())
        new_request()
        with mock.patch.object(frappe, "enqueue", side_effect=lambda method, **kw: self.queued.append(kw)):
            rate_master.start_suggest(boq=self.boq, sheet_name=self.sheet, op_id=op_id, **kwargs)
            frappe.db.commit()
        return op_id

    def _work(self, op_id, match_enabled=False, extract=_extract, match_outcome=None):
        """Run the queued operation `op_id` as a worker does (as Guest until the wrapper sets its owner). An
        operation it queues (the match) is recorded in `self.queued`."""
        job = next(j for j in self.queued if j["op_id"] == op_id)
        outcome = match_outcome or {"status": "complete", "halt_reason": None, "rows_total": 2, "rows_done": 2}

        def run_match(run_name, **kwargs):
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        with mock.patch.object(extraction, "run_extraction", side_effect=extract), \
                mock.patch.object(rate_match, "match_enabled", return_value=match_enabled), \
                mock.patch.object(match_run, "run_match", side_effect=run_match), \
                mock.patch.object(frappe, "enqueue", side_effect=lambda method, **kw: self.queued.append(kw)), \
                mock.patch("frappe.log_error"):
            frappe.set_user("Guest")
            new_request()
            background_ops.run(op_id=job["op_id"], work=job["work"], work_kwargs=job["work_kwargs"])
        frappe.set_user("Administrator")
        new_request()
        return get_status(op_id=op_id)

    # ── the tests ────────────────────────────────────────────────────────────────────────────────────────────────
    def test_a_suggest_waits_in_the_queue_as_its_own_operation(self):
        op_id = self._press()
        status = get_status(op_id=op_id)
        self.assertEqual((status["kind"], status["state"]), ("boq_rate_suggest", "queued"))

    def test_the_suggest_result_carries_the_sr1_reply_keys(self):
        with _ai_on():
            op_id = self._press(only_rows="[3]")
        status = self._work(op_id)
        self.assertEqual(status["state"], "finished", status.get("error"))
        result = status["result"]
        self.assertEqual((result["status"], result["run_status"]), ("success", "complete"))
        self.assertEqual(result["only_rows"], [3])
        self.assertEqual(result["scoped_row_count"], 1)
        self.assertIn("resumed_run_id", result)
        self.assertIsNone(result["resumed_run_id"])

    def test_a_duplicate_suggest_that_ends_late_cannot_replace_the_shown_run(self):
        """An older start's operation (its marker since healed away) ends while the shown run waits in the queue: the
        shown run's record is untouched, the sheet stays held for it, and the run it ends in is its own."""
        older = self._press()
        frappe.cache().delete_value(rate_master._s_marker_key(self.boq, self.sheet))  # healed as stale
        shown = self._press()

        older_status = self._work(older)
        self.assertEqual(older_status["state"], "finished", older_status.get("error"))
        self.assertEqual(get_status(op_id=shown)["state"], "queued", "the duplicate's end must not reach the shown run")
        with self.assertRaises(frappe.ValidationError):
            self._press()  # the sheet is still held for the shown run

        shown_status = self._work(shown)
        self.assertEqual(shown_status["state"], "finished", shown_status.get("error"))
        self.assertNotEqual(shown_status["result"]["run_id"], older_status["result"]["run_id"])
        active = rate_master.get_active_suggestion_run(boq=self.boq, sheet_name=self.sheet)["run"]
        self.assertEqual(active["run_id"], shown_status["result"]["run_id"])
        self.assertEqual(get_status(op_id=older)["result"]["run_id"], older_status["result"]["run_id"])

    def test_a_second_suggest_is_refused_while_the_first_is_queued_or_running(self):
        """Two suggests of one sheet never overlap, so a run started earlier can never finish after one started later
        (#1667 review): while rq holds the first (queued, or running inside its time limit) the marker is not healed
        and the second start is refused, however old the claim is."""
        first = self._press()
        key = rate_master._s_marker_key(self.boq, self.sheet)
        marker = frappe.cache().get_value(key)
        an_hour_ago = frappe.utils.add_to_date(frappe.utils.now(), hours=-1)
        frappe.cache().set_value(key, {**marker, "enqueued_at": an_hour_ago})  # past the claim's enqueue grace
        for state in ("queued", "started"):
            with self.subTest(state=state):
                job = mock.Mock(started_at=datetime.datetime.utcnow() if state == "started" else None)  # rq stamps UTC
                job.get_status.return_value = state
                with mock.patch("frappe.utils.background_jobs.get_job", return_value=job), \
                        self.assertRaises(frappe.ValidationError):
                    self._press()
                self.assertEqual(frappe.cache().get_value(key)["job_id"], first, "the first still holds the sheet")
        self.assertEqual(get_status(op_id=first)["state"], "queued")

    def test_a_failed_suggest_ends_failed_in_its_own_words_and_frees_the_sheet(self):
        def db_error(*args, **kwargs):
            frappe.db.sql("select 1/0")

        op_id = self._press()
        status = self._work(op_id, extract=db_error)
        self.assertEqual(status["state"], "failed")
        self.assertIn("stopped unexpectedly", status["error"])
        self.assertEqual(get_status(op_id=self._press())["state"], "queued")

    def test_a_complete_suggest_queues_its_match_as_its_own_operation_shown_queued(self):
        op_id = self._press()
        status = self._work(op_id, match_enabled=True)
        self.assertEqual(status["state"], "finished", status.get("error"))
        match = status["result"]["match"]
        self.assertTrue(match["queued"], match)
        queued_match = get_status(op_id=match["op_id"])
        self.assertEqual((queued_match["kind"], queued_match["state"]), ("boq_rate_match", "queued"))

        ended = self._work(match["op_id"])
        self.assertEqual(ended["state"], "finished", ended.get("error"))
        self.assertEqual((ended["result"]["status"], ended["result"]["run"]), ("success", match["run"]))
        self.assertEqual(frappe.db.get_value(_MATCH_RUN, match["run"], "job_id"), match["op_id"])

    def test_an_older_match_that_ends_late_cannot_replace_the_shown_match(self):
        first = self._work(self._press(), match_enabled=True)["result"]["match"]
        frappe.cache().delete_value(rate_match._marker_key(self.boq, self.sheet))  # healed as stale
        shown = self._work(self._press(), match_enabled=True)["result"]["match"]
        self.assertTrue(shown["queued"], shown)

        older = self._work(first["op_id"], match_outcome=match_run.MatchRefused("made-up refusal"))
        self.assertEqual((older["state"], older["error"]), ("failed", "made-up refusal"))
        self.assertEqual(get_status(op_id=shown["op_id"])["state"], "queued")
        self.assertIsNotNone(rate_match._get_marker(self.boq, self.sheet), "the shown match still holds the sheet")
