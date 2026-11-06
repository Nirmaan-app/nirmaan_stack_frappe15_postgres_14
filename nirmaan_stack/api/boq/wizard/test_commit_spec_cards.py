# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""The spec-card job at commit (DEV2-B1, T1; R-H2W, B0 G10 (a)).

commit_boq is driven exactly as test_commit_pipeline's partial-commit tests drive it (no S3 fetch, no workbook: the
fetch, the open and the grid extraction are patched) over a fixture BoQ with two finalized sheets and one
general-specs sheet. frappe.enqueue is patched, so no job is ever queued.

  OFF   either switch off (or both): commit returns exactly as before, nothing is queued, the card module's store
        and planner are never reached
  ON    both switches on: exactly one card job per committed FINALIZED sheet, on queue long, after its commit
        (the grid-only general-specs sheet gets none)
  SAFE  a failing enqueue never fails or changes the commit
"""
import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import ai_settings, commit_pipeline
# A module import, never `from ... import TestCommitPipeline`: a TestCase class in this module's namespace would be
# collected and run here a second time.
from nirmaan_stack.api.boq.wizard import test_commit_pipeline as tcp
from nirmaan_stack.services.boq_fixture_teardown import fixture_boq_name, purge_boq
from nirmaan_stack.services.boq_rate_match import cards

_TEST_PROJECT = "_TEST_BOQ_PROJECT_COMMIT_SPEC_CARDS"
_RESULT_KEYS = {"sheet_name", "disposition", "sheet_disposition", "grid_name", "boq_sheet_name", "commit_version",
                "row_count", "froze_prior", "froze_prior_sheet", "node_count", "froze_nodes"}


class TestCommitSpecCardJob(FrappeTestCase):

    _SHEETS = ["F1", "F2", "GS"]

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT
        boq.boq_name = "Shared Test BoQ for Commit Spec Cards"
        boq.append("sheet_drafts", {"sheet_name": "F1", "sheet_order": 1, "wizard_status": "Finalized",
                                    "sheet_config": json.dumps(tcp._CFG)})
        boq.append("sheet_drafts", {"sheet_name": "F2", "sheet_order": 2, "wizard_status": "Finalized",
                                    "sheet_config": json.dumps(tcp._CFG)})
        boq.append("sheet_drafts", {"sheet_name": "GS", "sheet_order": 3, "wizard_status": "Skip",
                                    "sheet_config": json.dumps(tcp._CFG)})
        boq.append("general_specs_sheets", {"source_sheet_name": "GS"})
        boq.insert(set_name=fixture_boq_name("COMMIT_SPEC_CARDS"), ignore_permissions=True, ignore_links=True)
        cls.boq_name = boq.name
        frappe.db.set_value("BOQs", cls.boq_name, "source_file_url", "/fake/boq.xlsx")
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "boq_name"):
            tcp.TestCommitPipeline._purge(cls.boq_name)
            purge_boq(cls.boq_name)
            frappe.db.commit()
        super().tearDownClass()

    def tearDown(self):
        tcp.TestCommitPipeline._purge(self.boq_name)
        frappe.db.commit()
        super().tearDown()

    def _commit(self, gate_on, enqueue=None):
        with patch.object(commit_pipeline, "_fetch_boq_file_to_tempfile", return_value="/tmp/fake_boq.xlsx"), \
             patch.object(commit_pipeline.openpyxl, "load_workbook", return_value=tcp._FakeWB(self._SHEETS)), \
             patch.object(commit_pipeline, "_extract_grid_rows", return_value=list(tcp._GRID_ROWS)), \
             patch.object(ai_settings, "match_cards_at_commit_on", return_value=gate_on), \
             patch("frappe.enqueue", side_effect=enqueue) as enq, \
             patch.object(cards, "plan_sheet") as plan, \
             patch.object(cards, "existing_cards") as existing, \
             patch.object(cards, "card_sheet") as card:
            res = commit_pipeline.commit_boq(self.boq_name, list(self._SHEETS))
        return res, enq, (plan, existing, card)

    def test_switched_off_nothing_is_queued_and_commit_is_as_before(self):
        res, enq, untouched = self._commit(gate_on=False)
        enq.assert_not_called()
        for m in untouched:
            m.assert_not_called()
        self.assertEqual(set(res), {"boq_name", "committed", "failed"})
        self.assertEqual([c["sheet_name"] for c in res["committed"]], self._SHEETS)
        self.assertEqual(res["failed"], [])
        for c in res["committed"]:
            self.assertEqual(set(c), _RESULT_KEYS)

    def test_both_switches_on_queue_one_job_per_finalized_sheet_on_long(self):
        res, enq, (plan, existing, card) = self._commit(gate_on=True)
        self.assertEqual(res["failed"], [])
        self.assertEqual(enq.call_count, 2)
        by_sheet = {c.kwargs["sheet_name"]: c for c in enq.call_args_list}
        self.assertEqual(sorted(by_sheet), ["F1", "F2"])
        versions = {c["sheet_name"]: c["commit_version"] for c in res["committed"]}
        for sheet, c in by_sheet.items():
            self.assertEqual(c.args[0], "nirmaan_stack.services.boq_rate_match.cards.card_committed_sheet")
            self.assertEqual(c.kwargs["queue"], "long")
            self.assertEqual(c.kwargs["boq"], self.boq_name)
            self.assertEqual(c.kwargs["commit_version"], versions[sheet])
        # the job is only queued: nothing is planned, read or carded in the request
        for m in (plan, existing, card):
            m.assert_not_called()

    def test_the_job_is_queued_after_the_sheets_commit(self):
        seen = []

        def at_enqueue(*a, **kw):
            # the sheet's rows are already durable when the job is queued
            seen.append(frappe.db.get_value("BoQ Sheet", {"boq": self.boq_name, "sheet_name": kw["sheet_name"],
                                                          "is_current": 1}, "commit_version"))

        self._commit(gate_on=True, enqueue=at_enqueue)
        self.assertEqual(len(seen), 2)
        self.assertTrue(all(v is not None for v in seen))

    def test_a_failing_enqueue_never_fails_the_commit(self):
        with patch("frappe.log_error") as logged:   # no Error Log row is left behind by the test
            res, enq, _ = self._commit(gate_on=True, enqueue=RuntimeError("redis down"))
        self.assertEqual(enq.call_count, 2)
        self.assertEqual(logged.call_count, 2)
        self.assertEqual(res["failed"], [])
        self.assertEqual([c["sheet_name"] for c in res["committed"]], self._SHEETS)
