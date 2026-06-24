# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for ai_assist.py (Slice AI-2c) -- the AI-pass endpoint + worker + write-back.

The AI-2b service (boq_ai_assist.run_ai_pass) and frappe.enqueue are MOCKED -- NO live
Anthropic API call is made anywhere in this suite.

  T1  endpoint rejects when the sheet has no review rows         (not_parsed)
  T2  endpoint rejects when AI is disabled                       (ai_disabled)
  T3  endpoint rejects when no API key is configured             (no_api_key)
  T4  endpoint enqueues + sets ai_in_progress=1 after enqueue
  T5  worker writes back classification + real-parent suggestions (status Pending)
  T6  worker derives ai_suggested_level for a real-parent / NO_CHANGE suggestion
  T7  worker clears stale prior suggestions before applying new ones
  T8  publish clears ai_in_progress on success
  T9  publish clears ai_in_progress on error + worker re-raises
  T10 cache hit applies cached suggestions + skips enqueue
  T11 cache miss after a re-parse (bumped last_parsed_at) enqueues fresh
  T12 classification-only suggestion leaves ai_suggested_parent at the -1 default
  T13 ROOT suggestion interim: parent dropped to -1, classification preserved (gap)

R2 (ADR-0005) chunking, pure service tests + a FAKE Anthropic client (no live call):
  TestClaudeChunkingPure  chunk_rows boundary placement (cut before a preamble,
                          hard-max), update_spine carry (open section + last sl_no,
                          level-pop), render_context first-vs-later.
  TestRunAiPassChunking   run_ai_pass single-call path unchanged for a small sheet;
                          multi-chunk accumulates suggestions + cross-chunk parent
                          resolves; a forward-reference parent is dropped.
"""
import json
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import ai_assist
from nirmaan_stack.api.boq.wizard.ai_assist import (
    _ai_cache_key,
    accept_ai_suggestion,
    get_ai_pass_status,
    reject_ai_suggestion,
    revert_ai_acceptance,
    run_ai_pass,
)
from nirmaan_stack.api.boq.wizard.review_screen import (
    get_review_rows,
    resolve_effective,
    save_review_edit,
)
from nirmaan_stack.services.boq_ai_assist import _NonRetryable

_SERVICE = "nirmaan_stack.services.boq_ai_assist.run_ai_pass"
_SETTINGS = "nirmaan_stack.api.boq.wizard.ai_assist.get_boq_ai_settings"
_API_KEY = "nirmaan_stack.api.boq.wizard.ai_assist.get_boq_ai_api_key"

_AI_SHEET = "AISheet"
_EMPTY_SHEET = "EmptySheet"


def _make_project():
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_AI2C_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


def _enabled_settings():
    return {
        "enabled": True,
        "provider": "Anthropic",
        "model": "claude-sonnet-4-6",
        "max_tokens": 8000,
        "request_timeout_seconds": 120,
    }


class TestAIAssist(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "AI Pass Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": _AI_SHEET, "sheet_order": 1, "wizard_status": "Parsed",
        })
        boq.append("sheet_drafts", {
            "sheet_name": _EMPTY_SHEET, "sheet_order": 2, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        for b in frappe.get_all("BOQs", filters={"project": cls.test_project.name}, fields=["name"]):
            frappe.db.delete("BoQ Review Row", {"boq": b.name})
            frappe.delete_doc("BOQs", b.name, force=True, ignore_permissions=True)
        frappe.delete_doc("Projects", cls.test_project.name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        # Fresh row set for the parsed sheet each test (3 rows: root preamble + 2 line items).
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name, "sheet_name": _AI_SHEET})
        self.names = {}
        for ridx, cls_, parent in [(0, "preamble", -1), (1, "line_item", -1), (2, "line_item", -1)]:
            doc = frappe.new_doc("BoQ Review Row")
            doc.update({
                "boq": self.boq_name,
                "sheet_name": _AI_SHEET,
                "row_index": ridx,
                "source_row_number": ridx + 2,
                "classification": cls_,
                "parent_index": parent,
                "human_parent": -1,
                "human_is_root": 0,
                "ai_suggested_parent": -1,
                "ai_suggested_level": -1,
            })
            doc.insert(ignore_permissions=True)
            self.names[ridx] = doc.name
        # Reset draft transient state.
        self._set_draft(_AI_SHEET, {"ai_in_progress": 0, "last_parsed_at": None})
        self._set_draft(_EMPTY_SHEET, {"ai_in_progress": 0, "last_parsed_at": None})
        frappe.db.commit()

    # --- helpers -----------------------------------------------------------

    def _set_draft(self, sheet, fields):
        child = frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq_name, "parenttype": "BOQs", "sheet_name": sheet},
            "name",
        )
        frappe.db.set_value("BoQ Sheet Draft", child, fields)

    def _row(self, ridx):
        return frappe.db.get_value(
            "BoQ Review Row", self.names[ridx],
            ["ai_suggested_classification", "ai_classification_confidence",
             "ai_suggested_parent", "ai_suggested_is_root", "ai_parent_confidence",
             "ai_suggested_level", "ai_explanation", "ai_suggestion_status"],
            as_dict=True,
        )

    def _ai_in_progress(self, sheet):
        return ai_assist._get_ai_in_progress(self.boq_name, sheet)

    # --- T1-T3: endpoint guards -------------------------------------------

    def test_endpoint_rejects_when_not_parsed(self):
        result = run_ai_pass(boq_name=self.boq_name, sheet_name=_EMPTY_SHEET)
        self.assertEqual(result, {"ok": False, "error": "not_parsed"})

    def test_endpoint_rejects_when_ai_disabled(self):
        disabled = {**_enabled_settings(), "enabled": False}
        with patch(_SETTINGS, return_value=disabled):
            result = run_ai_pass(boq_name=self.boq_name, sheet_name=_AI_SHEET)
        self.assertEqual(result, {"ok": False, "error": "ai_disabled"})

    def test_endpoint_rejects_when_no_api_key(self):
        with patch(_SETTINGS, return_value=_enabled_settings()), \
             patch(_API_KEY, return_value=None):
            result = run_ai_pass(boq_name=self.boq_name, sheet_name=_AI_SHEET)
        self.assertEqual(result, {"ok": False, "error": "no_api_key"})

    # --- T4: enqueue + flag ------------------------------------------------

    def test_endpoint_enqueues_and_sets_in_progress(self):
        fake_job = MagicMock()
        fake_job.id = "job-xyz"
        with patch(_SETTINGS, return_value=_enabled_settings()), \
             patch(_API_KEY, return_value="sk-test"), \
             patch("frappe.enqueue", return_value=fake_job) as mock_enq:
            result = run_ai_pass(boq_name=self.boq_name, sheet_name=_AI_SHEET)

        self.assertTrue(result["ok"])
        self.assertTrue(result["enqueued"])
        self.assertTrue(mock_enq.called, "the worker must be enqueued")
        kwargs = mock_enq.call_args.kwargs
        self.assertEqual(kwargs["boq_name"], self.boq_name)
        self.assertEqual(kwargs["sheet_name"], _AI_SHEET)
        self.assertEqual(kwargs["user"], frappe.session.user)
        self.assertEqual(kwargs["queue"], "long")
        self.assertEqual(self._ai_in_progress(_AI_SHEET), 1,
                         "ai_in_progress must be set to 1 after a successful enqueue")

    # --- T5/T6/T12/T13: write-back ----------------------------------------

    def _run_worker_with(self, suggestions):
        with patch(_SERVICE, return_value=suggestions) as mock_svc:
            ai_assist._run_ai_pass_worker(self.boq_name, _AI_SHEET, user=None)
        return mock_svc

    def test_worker_writes_back_suggestions(self):
        suggestions = [
            {"row_index": 1, "ai_suggested_classification": "preamble",
             "ai_classification_confidence": "High", "ai_suggested_parent": None,
             "ai_parent_confidence": None, "ai_explanation": "looks like a header"},
            {"row_index": 2, "ai_suggested_classification": None,
             "ai_classification_confidence": None, "ai_suggested_parent": 0,
             "ai_parent_confidence": "Medium", "ai_explanation": "belongs under section 0"},
        ]
        self._run_worker_with(suggestions)

        r1 = self._row(1)
        self.assertEqual(r1["ai_suggested_classification"], "preamble")
        self.assertEqual(r1["ai_classification_confidence"], "High")
        self.assertEqual(r1["ai_suggestion_status"], "Pending")

        r2 = self._row(2)
        self.assertEqual(r2["ai_suggested_parent"], 0)
        self.assertEqual(r2["ai_parent_confidence"], "Medium")
        self.assertEqual(r2["ai_suggestion_status"], "Pending")

    def test_worker_derives_level_for_real_parent(self):
        suggestions = [
            # NO_CHANGE parent -> level = this row's current effective level (root -> 1)
            {"row_index": 1, "ai_suggested_classification": "preamble",
             "ai_classification_confidence": "High", "ai_suggested_parent": None,
             "ai_parent_confidence": None, "ai_explanation": "x"},
            # real parent row 0 (a root preamble, level 1) -> child level = 2
            {"row_index": 2, "ai_suggested_classification": None,
             "ai_classification_confidence": None, "ai_suggested_parent": 0,
             "ai_parent_confidence": "Medium", "ai_explanation": "y"},
        ]
        self._run_worker_with(suggestions)
        self.assertEqual(self._row(1)["ai_suggested_level"], 1,
                         "NO_CHANGE parent -> the row's current effective level (root=1)")
        self.assertEqual(self._row(2)["ai_suggested_level"], 2,
                         "real parent (root preamble level 1) -> child level 2")

    def test_classification_only_suggestion_leaves_parent_default(self):
        suggestions = [
            {"row_index": 1, "ai_suggested_classification": "note",
             "ai_classification_confidence": "Low", "ai_suggested_parent": None,
             "ai_parent_confidence": None, "ai_explanation": "a note"},
        ]
        self._run_worker_with(suggestions)
        r1 = self._row(1)
        self.assertEqual(r1["ai_suggested_classification"], "note")
        self.assertEqual(r1["ai_suggested_parent"], -1,
                         "a NO_CHANGE (classification-only) suggestion leaves parent at -1")

    def test_writeback_root_suggestion_sets_flag_and_level(self):
        # AI_A1 (AI-2d): a root suggestion is now fully represented -- the flag is
        # stored, parent stays the -1 no-index sentinel, level is the genuine root 1.
        suggestions = [
            {"row_index": 2, "ai_suggested_classification": "preamble",
             "ai_classification_confidence": "High", "ai_suggested_parent": -1,
             "ai_suggested_is_root": True,
             "ai_parent_confidence": "High", "ai_explanation": "should be a root section"},
        ]
        self._run_worker_with(suggestions)
        r2 = self._row(2)
        self.assertEqual(r2["ai_suggested_is_root"], 1,
                         "the root flag must be stored as 1")
        self.assertEqual(r2["ai_suggested_parent"], -1,
                         "ai_suggested_parent stays -1 (no parent-index suggestion)")
        self.assertEqual(r2["ai_suggested_level"], 1,
                         "a root suggestion's level is 1 (genuine root level)")
        self.assertEqual(r2["ai_suggested_classification"], "preamble",
                         "the classification suggestion is preserved")
        self.assertEqual(r2["ai_suggestion_status"], "Pending")

    def test_writeback_root_then_resolve_effective_is_root(self):
        # AI_A2 (AI-2d, end-to-end): write a root suggestion, Accept it, and confirm
        # resolve_effective resolves the row to effective-root through the stored flag.
        suggestions = [
            {"row_index": 2, "ai_suggested_classification": None,
             "ai_classification_confidence": None, "ai_suggested_parent": -1,
             "ai_suggested_is_root": True,
             "ai_parent_confidence": "High", "ai_explanation": "root"},
        ]
        self._run_worker_with(suggestions)
        frappe.db.set_value("BoQ Review Row", self.names[2],
                            "ai_suggestion_status", "Accepted")
        frappe.db.commit()
        stored = frappe.db.get_value(
            "BoQ Review Row", self.names[2],
            ["classification", "parent_index", "human_classification", "human_parent",
             "human_is_root", "ai_suggestion_status", "ai_suggested_classification",
             "ai_suggested_parent", "ai_suggested_is_root"],
            as_dict=True,
        )
        eff = resolve_effective(stored)
        self.assertIsNone(eff["effective_parent_index"],
                          "an Accepted stored root suggestion must resolve to effective-root")

    def test_stale_clear_resets_is_root(self):
        # AI_A3 (AI-2d): a prior root suggestion on a row the new pass does NOT flag
        # must be reset to 0 by the stale-clear.
        frappe.db.set_value("BoQ Review Row", self.names[0], {
            "ai_suggested_classification": None,
            "ai_suggested_parent": -1,
            "ai_suggested_is_root": 1,
            "ai_suggested_level": 1,
            "ai_explanation": "stale root",
            "ai_suggestion_status": "Pending",
        })
        frappe.db.commit()

        # New pass flags only row 1.
        self._run_worker_with([
            {"row_index": 1, "ai_suggested_classification": "preamble",
             "ai_classification_confidence": "High", "ai_suggested_parent": None,
             "ai_suggested_is_root": False,
             "ai_parent_confidence": None, "ai_explanation": "fresh"},
        ])

        r0 = self._row(0)
        self.assertEqual(r0["ai_suggested_is_root"], 0,
                         "a stale prior root flag must be reset to 0")
        self.assertIsNone(r0["ai_suggestion_status"],
                          "the stale prior suggestion must be cleared")

    # --- T7: stale-clear ---------------------------------------------------

    def test_worker_clears_stale_prior_suggestions(self):
        # Pre-seed a prior suggestion on row 0, which the NEW pass does NOT flag.
        frappe.db.set_value("BoQ Review Row", self.names[0], {
            "ai_suggested_classification": "note",
            "ai_classification_confidence": "Low",
            "ai_suggested_parent": 1,
            "ai_suggested_level": 3,
            "ai_explanation": "stale",
            "ai_suggestion_status": "Pending",
        })
        frappe.db.commit()

        # New pass flags only row 1.
        self._run_worker_with([
            {"row_index": 1, "ai_suggested_classification": "preamble",
             "ai_classification_confidence": "High", "ai_suggested_parent": None,
             "ai_parent_confidence": None, "ai_explanation": "fresh"},
        ])

        r0 = self._row(0)
        self.assertIsNone(r0["ai_suggestion_status"],
                          "the stale prior suggestion on row 0 must be cleared")
        self.assertEqual(r0["ai_suggested_parent"], -1)
        self.assertIsNone(r0["ai_suggested_classification"])
        # the freshly-flagged row 1 is present
        self.assertEqual(self._row(1)["ai_suggestion_status"], "Pending")

    # --- T8/T9: in-progress lifecycle -------------------------------------

    def test_publish_clears_in_progress_on_success(self):
        self._set_draft(_AI_SHEET, {"ai_in_progress": 1})
        frappe.db.commit()
        self._run_worker_with([])
        self.assertEqual(self._ai_in_progress(_AI_SHEET), 0,
                         "a successful pass must clear ai_in_progress")

    def test_publish_clears_in_progress_on_error(self):
        self._set_draft(_AI_SHEET, {"ai_in_progress": 1})
        frappe.db.commit()
        with patch(_SERVICE, side_effect=_NonRetryable("boom")):
            with self.assertRaises(_NonRetryable):
                ai_assist._run_ai_pass_worker(self.boq_name, _AI_SHEET, user=None)
        self.assertEqual(self._ai_in_progress(_AI_SHEET), 0,
                         "an errored pass must still clear ai_in_progress")

    # --- T10/T11: caching --------------------------------------------------

    def test_cache_hit_skips_enqueue(self):
        self._set_draft(_AI_SHEET, {"last_parsed_at": frappe.utils.now()})
        frappe.db.commit()
        lpa = ai_assist._get_last_parsed_at(self.boq_name, _AI_SHEET)
        key = _ai_cache_key(self.boq_name, _AI_SHEET, lpa)
        cached = [
            {"row_index": 1, "ai_suggested_classification": "preamble",
             "ai_classification_confidence": "High", "ai_suggested_parent": None,
             "ai_parent_confidence": None, "ai_explanation": "cached"},
        ]
        frappe.cache().set_value(key, cached, expires_in_sec=600)
        self.addCleanup(lambda: frappe.cache().delete_value(key))

        with patch(_SETTINGS, return_value=_enabled_settings()), \
             patch(_API_KEY, return_value="sk-test"), \
             patch("frappe.enqueue") as mock_enq:
            result = run_ai_pass(boq_name=self.boq_name, sheet_name=_AI_SHEET)

        self.assertFalse(mock_enq.called, "a cache hit must NOT enqueue a fresh pass")
        self.assertTrue(result["ok"])
        self.assertTrue(result["cached"])
        self.assertEqual(result["count"], 1)
        self.assertEqual(self._row(1)["ai_suggested_classification"], "preamble",
                         "the cached suggestion must be applied to the row")

    def test_cache_miss_after_reparse(self):
        # Seed the cache for an OLD last_parsed_at, then bump last_parsed_at (re-parse).
        old_lpa = "2026-01-01 00:00:00"
        old_key = _ai_cache_key(self.boq_name, _AI_SHEET, old_lpa)
        frappe.cache().set_value(old_key, [{"row_index": 1}], expires_in_sec=600)
        self.addCleanup(lambda: frappe.cache().delete_value(old_key))

        self._set_draft(_AI_SHEET, {"last_parsed_at": frappe.utils.now()})
        frappe.db.commit()

        with patch(_SETTINGS, return_value=_enabled_settings()), \
             patch(_API_KEY, return_value="sk-test"), \
             patch("frappe.enqueue", return_value=MagicMock()) as mock_enq:
            result = run_ai_pass(boq_name=self.boq_name, sheet_name=_AI_SHEET)

        self.assertTrue(mock_enq.called,
                        "a bumped last_parsed_at must miss the stale cache and enqueue fresh")
        self.assertTrue(result.get("enqueued"))

    # --- status endpoint (recovery) ---------------------------------------

    def test_status_returns_idle_shape_when_no_fallback(self):
        # No fallback recorded -> idle shape with the live flag.
        frappe.cache().delete_value(ai_assist._ai_status_key(self.boq_name, _AI_SHEET))
        status = get_ai_pass_status(boq_name=self.boq_name, sheet_name=_AI_SHEET)
        self.assertEqual(status["status"], "idle_or_unknown")
        self.assertIn("ai_in_progress", status)

    # --- AI-3c-2d: run_ai_pass freeze + parsing pre-flight gates -----------

    def _restore_draft(self, sheet, fields):
        self._set_draft(sheet, fields)
        frappe.db.commit()

    def test_Z1_frozen_sheet_rejected_no_mutation(self):
        # AI-3c-2d core fix: a "Finalized" sheet is read-only. run_ai_pass must reject
        # BEFORE the cache/enqueue paths (both run _apply_ai_suggestions's stale-clear),
        # so an already-Accepted row's ai_suggestion_status is left UNTOUCHED.
        self._set_draft(_AI_SHEET, {"wizard_status": "Finalized"})
        self.addCleanup(self._restore_draft, _AI_SHEET, {"wizard_status": "Parsed"})
        frappe.db.set_value("BoQ Review Row", self.names[1], {
            "ai_suggestion_status": "Accepted",
            "ai_suggested_classification": "preamble",
        })
        frappe.db.commit()
        with patch(_SETTINGS, return_value=_enabled_settings()), \
             patch(_API_KEY, return_value="sk-test"), \
             patch("frappe.enqueue") as mock_enq:
            result = run_ai_pass(boq_name=self.boq_name, sheet_name=_AI_SHEET)
        self.assertEqual(result, {"ok": False, "error": "frozen"})
        self.assertFalse(mock_enq.called, "a frozen sheet must NOT enqueue an AI pass")
        self.assertEqual(self._row(1)["ai_suggestion_status"], "Accepted",
                         "the stale-clear must NOT run -> the Accepted status is preserved")

    def test_Z2_nonfinalized_sheet_still_proceeds(self):
        # Regression: the guard must NOT over-fire -- a normal "Parsed" sheet still enqueues.
        fake_job = MagicMock()
        fake_job.id = "job-z2"
        with patch(_SETTINGS, return_value=_enabled_settings()), \
             patch(_API_KEY, return_value="sk-test"), \
             patch("frappe.enqueue", return_value=fake_job) as mock_enq:
            result = run_ai_pass(boq_name=self.boq_name, sheet_name=_AI_SHEET)
        self.assertTrue(result["ok"])
        self.assertTrue(result.get("enqueued"))
        self.assertTrue(mock_enq.called,
                        "a non-finalized parsed sheet must still enqueue an AI pass")

    def test_Z3_parsing_sheet_rejected(self):
        # AI-3c-2d secondary: an AI pass must not start while the parse worker is rebuilding rows.
        self._set_draft(_AI_SHEET, {"parse_in_progress": 1})
        self.addCleanup(self._restore_draft, _AI_SHEET, {"parse_in_progress": 0})
        frappe.db.commit()
        with patch(_SETTINGS, return_value=_enabled_settings()), \
             patch(_API_KEY, return_value="sk-test"), \
             patch("frappe.enqueue") as mock_enq:
            result = run_ai_pass(boq_name=self.boq_name, sheet_name=_AI_SHEET)
        self.assertEqual(result, {"ok": False, "error": "parsing"})
        self.assertFalse(mock_enq.called, "a parsing sheet must NOT enqueue an AI pass")


# ===========================================================================
# AI-3b-1: accept / reject (non-modal -- classification + childless parent)
# ===========================================================================

_AR_SHEET = "ARSheet"


class TestAcceptRejectAiSuggestion(FrappeTestCase):
    """accept_ai_suggestion / reject_ai_suggestion -- the NON-MODAL accept/reject paths.

    Row layout (rebuilt each test): row 0 preamble root WITH a child (row 1); row 1
    line_item child of row 0 (itself childless); row 2 line_item root (childless).
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "AI Accept/Reject Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": _AR_SHEET, "sheet_order": 1, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        for b in frappe.get_all("BOQs", filters={"project": cls.test_project.name}, fields=["name"]):
            frappe.db.delete("BoQ Review Row", {"boq": b.name})
            frappe.delete_doc("BOQs", b.name, force=True, ignore_permissions=True)
        frappe.delete_doc("Projects", cls.test_project.name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name, "sheet_name": _AR_SHEET})
        self.names = {}
        # (row_index, classification, parent_index)
        for ridx, cls_, parent in [(0, "preamble", -1), (1, "line_item", 0), (2, "line_item", -1)]:
            doc = frappe.new_doc("BoQ Review Row")
            doc.update({
                "boq": self.boq_name,
                "sheet_name": _AR_SHEET,
                "row_index": ridx,
                "source_row_number": ridx + 2,
                "classification": cls_,
                "parent_index": parent,
                "human_parent": -1,
                "human_is_root": 0,
                "ai_suggested_parent": -1,
                "ai_suggested_level": -1,
            })
            doc.insert(ignore_permissions=True)
            self.names[ridx] = doc.name
        frappe.db.commit()

    # -- helpers ------------------------------------------------------------

    def _seed_ai(self, ridx, **fields):
        frappe.db.set_value("BoQ Review Row", self.names[ridx], fields)
        frappe.db.commit()

    def _row(self, ridx):
        return frappe.db.get_value(
            "BoQ Review Row", self.names[ridx],
            ["human_classification", "human_parent", "human_is_root",
             "ai_suggestion_status", "edited_at", "classification", "parent_index",
             "ai_suggested_classification", "ai_suggested_parent", "ai_suggested_is_root"],
            as_dict=True,
        )

    # -- T1: accept classification only -------------------------------------

    def test_accept_classification_only(self):
        self._seed_ai(2, ai_suggestion_status="Pending",
                      ai_suggested_classification="preamble")
        res = accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                                   row_index=2, accept_classification=True)
        self.assertTrue(res["ok"])
        self.assertEqual(res["ai_suggestion_status"], "Accepted")
        r = self._row(2)
        self.assertEqual(r["human_classification"], "preamble")
        self.assertEqual(r["ai_suggestion_status"], "Accepted")
        self.assertIsNotNone(r["edited_at"], "accept stamps edited_at (it IS a human edit)")

    # -- T2: accept parent (childless, real index) --------------------------

    def test_accept_parent_childless_real_index(self):
        self._seed_ai(2, ai_suggestion_status="Pending", ai_suggested_parent=0)
        res = accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                                   row_index=2, accept_parent=True)
        self.assertEqual(res["ai_suggestion_status"], "Accepted")
        r = self._row(2)
        self.assertEqual(r["human_parent"], 0)
        self.assertEqual(r["human_is_root"], 0)
        self.assertEqual(r["ai_suggestion_status"], "Accepted")

    # -- T3: accept parent (childless, root suggestion) ---------------------

    def test_accept_parent_childless_root(self):
        self._seed_ai(2, ai_suggestion_status="Pending",
                      ai_suggested_is_root=1, ai_suggested_parent=-1)
        res = accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                                   row_index=2, accept_parent=True)
        self.assertEqual(res["ai_suggestion_status"], "Accepted")
        r = self._row(2)
        self.assertEqual(r["human_is_root"], 1)
        self.assertEqual(r["human_parent"], -1)
        self.assertIsNone(res["effective_parent_index"],
                          "an accepted root suggestion resolves to effective-root")

    # -- T4: accept BOTH on a childless row ---------------------------------

    def test_accept_both_childless(self):
        self._seed_ai(2, ai_suggestion_status="Pending",
                      ai_suggested_classification="note", ai_suggested_parent=0)
        res = accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                                   row_index=2, accept_classification=True, accept_parent=True)
        self.assertEqual(res["ai_suggestion_status"], "Accepted")
        r = self._row(2)
        self.assertEqual(r["human_classification"], "note")
        self.assertEqual(r["human_parent"], 0)
        self.assertEqual(r["ai_suggestion_status"], "Accepted")

    # -- T5: accept parent on a row WITH children -> guard throws -----------

    def test_accept_parent_with_children_throws(self):
        # row 0 is the effective parent of row 1 -> it HAS children.
        self._seed_ai(0, ai_suggestion_status="Pending", ai_suggested_parent=2)
        with self.assertRaises(frappe.ValidationError):
            accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                                 row_index=0, accept_parent=True)
        # Unchanged: still Pending, human_parent untouched.
        r = self._row(0)
        self.assertEqual(r["ai_suggestion_status"], "Pending")
        self.assertEqual(r["human_parent"], -1)

    # -- G1 (AI-3c-3): accept CLASSIFICATION on a row WITH children -> guard throws --

    def test_G1_accept_classification_with_children_throws(self):
        # row 0 is the effective parent of row 1 -> it HAS children. Reclassifying it to a
        # non-parent class (note) would silently orphan row 1 under a note (uncaught by
        # check_structural_integrity), so the classification accept must be refused here and
        # routed through the restructure modal (mirrors the accept_parent guard, T5).
        self._seed_ai(0, ai_suggestion_status="Pending", ai_suggested_classification="note")
        with self.assertRaises(frappe.ValidationError):
            accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                                 row_index=0, accept_classification=True)
        # Unchanged: still Pending, human_classification untouched (no silent break).
        r = self._row(0)
        self.assertEqual(r["ai_suggestion_status"], "Pending")
        self.assertIsNone(r["human_classification"])

    # -- G2 (AI-3c-3): accept CLASSIFICATION on a CHILDLESS row -> still works -------

    def test_G2_accept_classification_childless_still_works(self):
        # The new guard must NOT over-fire: row 2 is a childless line_item root.
        self._seed_ai(2, ai_suggestion_status="Pending",
                      ai_suggested_classification="preamble")
        res = accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                                   row_index=2, accept_classification=True)
        self.assertEqual(res["ai_suggestion_status"], "Accepted")
        r = self._row(2)
        self.assertEqual(r["human_classification"], "preamble")
        self.assertEqual(r["ai_suggestion_status"], "Accepted")

    # -- T6: accept with neither flag -> throws -----------------------------

    def test_accept_nothing_throws(self):
        self._seed_ai(2, ai_suggestion_status="Pending", ai_suggested_classification="note")
        with self.assertRaises(frappe.ValidationError):
            accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET, row_index=2)

    # -- T7: reject ---------------------------------------------------------

    def test_reject_sets_status_only(self):
        self._seed_ai(2, ai_suggestion_status="Pending",
                      ai_suggested_classification="preamble")
        res = reject_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET, row_index=2)
        self.assertEqual(res["ai_suggestion_status"], "Rejected")
        r = self._row(2)
        self.assertEqual(r["ai_suggestion_status"], "Rejected")
        self.assertIsNone(r["human_classification"], "reject must NOT touch human_*")
        self.assertEqual(r["human_parent"], -1)
        self.assertIsNone(r["edited_at"], "reject is not an edit -- edited_at stays unset")
        # The suggested value is preserved (only the status changed).
        self.assertEqual(r["ai_suggested_classification"], "preamble")

    # -- T8: accept -> resolve_effective folds the accepted value -----------

    def test_accept_then_resolve_effective_renders_accepted(self):
        self._seed_ai(2, ai_suggestion_status="Pending",
                      ai_suggested_classification="preamble")
        accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                             row_index=2, accept_classification=True)
        stored = frappe.db.get_value(
            "BoQ Review Row", self.names[2],
            ["classification", "parent_index", "human_classification", "human_parent",
             "human_is_root", "ai_suggestion_status", "ai_suggested_classification",
             "ai_suggested_parent", "ai_suggested_is_root"],
            as_dict=True,
        )
        eff = resolve_effective(stored)
        self.assertEqual(eff["effective_classification"], "preamble",
                         "the accepted classification (now in human_classification) is effective")

    # -- AI-3c-1: edit_log from-value must be the TRUE pre-accept effective value -----

    def _edit_log(self, ridx):
        raw = frappe.db.get_value("BoQ Review Row", self.names[ridx], "edit_log")
        if isinstance(raw, str):
            return json.loads(raw) if raw else []
        return raw or []

    def test_C1_accept_parent_from_is_pre_accept_root_not_ai_value(self):
        # Row 2 is a line_item ROOT (parent_index=-1 -> effective root). Accepting an AI
        # parent=0 must log from = None (root), to = 0 -- the premature-flip bug logged "0 -> 0".
        self._seed_ai(2, ai_suggestion_status="Pending", ai_suggested_parent=0)
        accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                             row_index=2, accept_parent=True)
        entries = [e for e in self._edit_log(2) if e["field"] == "human_parent"]
        self.assertEqual(len(entries), 1, "exactly one human_parent entry")
        self.assertIsNone(entries[0]["from"],
                          "from must be the TRUE pre-accept effective parent (root), NOT the AI value")
        self.assertEqual(entries[0]["to"], 0)

    def test_C2_accept_classification_from_is_prior_effective_not_ai_value(self):
        # Row 2 is a line_item. Accepting AI 'preamble' must log from='line_item', to='preamble'
        # -- the premature-flip bug logged "preamble -> preamble" (a no-op).
        self._seed_ai(2, ai_suggestion_status="Pending",
                      ai_suggested_classification="preamble")
        accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                             row_index=2, accept_classification=True)
        entries = [e for e in self._edit_log(2) if e["field"] == "human_classification"]
        self.assertEqual(len(entries), 1, "exactly one human_classification entry")
        self.assertEqual(entries[0]["from"], "line_item",
                         "from must be the prior effective class, NOT the AI class")
        self.assertEqual(entries[0]["to"], "preamble")

    def test_C3_flip_still_happens_after_capture(self):
        # The flip is DEFERRED but MUST still happen: status Accepted + effective values
        # correct + persisted (not just in-memory). Also proves the deferred from-values.
        self._seed_ai(2, ai_suggestion_status="Pending",
                      ai_suggested_classification="note", ai_suggested_parent=0)
        res = accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                                   row_index=2, accept_classification=True, accept_parent=True)
        self.assertEqual(res["ai_suggestion_status"], "Accepted")
        self.assertEqual(res["effective_classification"], "note")
        self.assertEqual(res["effective_parent_index"], 0)
        r = self._row(2)
        self.assertEqual(r["ai_suggestion_status"], "Accepted",
                         "the flip is persisted via set_value in the same commit")
        cls_entries = [e for e in self._edit_log(2) if e["field"] == "human_classification"]
        par_entries = [e for e in self._edit_log(2) if e["field"] == "human_parent"]
        self.assertEqual(cls_entries[0]["from"], "line_item")
        self.assertIsNone(par_entries[0]["from"])

    # -- AI-3c-2a: row-level revert (childless accept capture + restore + invalidation) -----

    def _snapshot(self, ridx):
        return frappe.db.get_value("BoQ Review Row", self.names[ridx], "ai_accept_snapshot")

    def _revert_available(self, ridx):
        rows = get_review_rows(boq_name=self.boq_name, sheet_name=_AR_SHEET)["rows"]
        match = [r for r in rows if r["row_index"] == ridx]
        self.assertEqual(len(match), 1)
        # the raw blob must NOT be shipped -- only the boolean
        self.assertNotIn("ai_accept_snapshot", match[0],
                         "the raw snapshot blob must never reach the client")
        return match[0]["revert_available"]

    def test_V1_accept_childless_captures_snapshot_survives_chokepoint(self):
        # The self-clear trap: the accept writes human_* via the chokepoint (which CLEARS the
        # snapshot on every human edit), so the snapshot must be written LAST and SURVIVE.
        self._seed_ai(2, ai_suggestion_status="Pending", ai_suggested_parent=0)
        accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                             row_index=2, accept_parent=True)
        self.assertIsNotNone(self._snapshot(2),
                             "ai_accept_snapshot must SURVIVE the accept's own chokepoint clears")
        self.assertTrue(self._revert_available(2),
                        "revert_available must be true immediately after an accept")

    def test_V2_revert_restores_parent_status_and_appends_entry(self):
        self._seed_ai(2, ai_suggestion_status="Pending", ai_suggested_parent=0)
        accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                             row_index=2, accept_parent=True)
        # sanity: the accept applied + snapshot present
        self.assertEqual(self._row(2)["human_parent"], 0)
        res = revert_ai_acceptance(boq_name=self.boq_name, sheet_name=_AR_SHEET, row_index=2)
        self.assertTrue(res["ok"])
        self.assertEqual(res["ai_suggestion_status"], "Pending")
        r = self._row(2)
        self.assertEqual(r["human_parent"], -1, "human_parent restored to the pre-accept root sentinel")
        self.assertEqual(r["human_is_root"], 0)
        self.assertEqual(r["ai_suggestion_status"], "Pending",
                         "revert re-offers the suggestion (status -> Pending)")
        self.assertIsNone(self._snapshot(2), "the snapshot must be cleared after a revert")
        # the accept's entry stays AND a reverted entry is appended (append-only history)
        par_entries = [e for e in self._edit_log(2) if e["field"] == "human_parent"]
        self.assertEqual(len(par_entries), 2,
                         "the accept's human_parent entry stays + a reverted entry is appended")
        self.assertEqual(par_entries[0]["to"], 0, "first (accept) entry: -> 0")
        self.assertEqual(par_entries[-1]["from"], 0,
                         "second (reverted) entry: from the accepted value (0)")
        self.assertIsNone(par_entries[-1]["to"], "reverted to root/None")

    def test_V3_revert_without_snapshot_throws(self):
        # row 2 has no accept (no snapshot) -> revert must throw.
        with self.assertRaises(frappe.ValidationError):
            revert_ai_acceptance(boq_name=self.boq_name, sheet_name=_AR_SHEET, row_index=2)

    def test_V4_later_human_edit_invalidates_snapshot(self):
        # accept classification, then a LATER human_classification edit on the SAME row must
        # discard the snapshot (rule c-ii) -> revert no longer available.
        self._seed_ai(2, ai_suggestion_status="Pending", ai_suggested_classification="preamble")
        accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                             row_index=2, accept_classification=True)
        self.assertIsNotNone(self._snapshot(2), "snapshot present right after accept")
        # a later human edit on the accepted row
        save_review_edit(boq_name=self.boq_name, sheet_name=_AR_SHEET,
                         row_index=2, field="human_classification", value="note")
        self.assertIsNone(self._snapshot(2),
                          "a later human_classification edit must clear the snapshot")
        self.assertFalse(self._revert_available(2),
                         "revert is no longer available after an invalidating edit")


# ===========================================================================
# R2 / ADR-0005: Claude classifier chunking + carried hierarchy spine.
#
# Pure service-level tests (no DB) -- chunk_rows boundary placement, update_spine
# carry across a cut, render_context, and a multi-chunk run_ai_pass with a FAKE
# Anthropic client (anthropic.Anthropic is patched; NO live API call). Asserts the
# single-call path is unchanged for a small sheet and forward references are dropped.
# ===========================================================================

from nirmaan_stack.services import boq_ai_assist as _svc  # noqa: E402


def _payload(excel, cls="line_item", level=None, parent=None, sl_no=None, desc=""):
    """One model-input element matching _build_row_payload's shape."""
    return {
        "excel_row": excel,
        "classification": cls,
        "level": level,
        "parent_excel_row": parent,
        "sl_no": sl_no,
        "description": desc,
        "unit": None,
    }


class _FakeUsage:
    def __init__(self, input_tokens=10, output_tokens=5):
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


class _FakeTextBlock:
    type = "text"

    def __init__(self, text):
        self.text = text


class _FakeResp:
    stop_reason = "end_turn"

    def __init__(self, text):
        self.content = [_FakeTextBlock(text)]
        self.usage = _FakeUsage()


class _FakeMessages:
    """Records each create() call's prompt and returns a scripted JSON array per call."""

    def __init__(self, scripted):
        self._scripted = list(scripted)
        self.calls: list[str] = []

    def create(self, *, model, max_tokens, messages, timeout):
        self.calls.append(messages[0]["content"])
        body = self._scripted.pop(0) if self._scripted else "[]"
        return _FakeResp(body)


class _FakeAnthropic:
    last_instance = None

    def __init__(self, api_key=None):
        self.messages = _FakeMessages(_FakeAnthropic.scripted)
        _FakeAnthropic.last_instance = self


def _settings():
    return {"model": "claude-sonnet-4-6", "max_tokens": 8000, "request_timeout_seconds": 120}


class TestClaudeChunkingPure(FrappeTestCase):
    """chunk_rows / update_spine / render_context -- the pure chunking core."""

    # --- chunk_rows --------------------------------------------------------

    def test_small_sheet_is_one_chunk(self):
        payloads = [_payload(i + 2) for i in range(_svc._CHUNK_THRESHOLD)]
        chunks = _svc.chunk_rows(payloads)
        self.assertEqual(len(chunks), 1, "<= threshold -> a single chunk (single-call path)")
        self.assertEqual(len(chunks[0]), _svc._CHUNK_THRESHOLD)

    def test_empty_sheet_no_chunks(self):
        self.assertEqual(_svc.chunk_rows([]), [])

    def test_chunk_cuts_just_before_a_preamble(self):
        # 250 rows: a preamble at index 130 (past target=100) must be the cut point so
        # chunk 0 ends right before it and chunk 1 STARTS with that preamble.
        payloads = []
        for i in range(250):
            cls = "preamble" if i == 130 else "line_item"
            payloads.append(_payload(i + 2, cls=cls, level=1 if cls == "preamble" else None))
        chunks = _svc.chunk_rows(payloads)
        self.assertGreaterEqual(len(chunks), 2)
        # The first cut lands on the preamble: chunk 1 begins with excel_row 132 (i=130).
        self.assertEqual(chunks[0][-1]["excel_row"], 131,
                         "chunk 0 ends on the row JUST BEFORE the preamble")
        self.assertEqual(chunks[1][0]["excel_row"], 132,
                         "chunk 1 STARTS with the preamble (clean section boundary)")
        self.assertEqual(chunks[1][0]["classification"], "preamble")

    def test_chunk_respects_hard_max_without_a_boundary(self):
        # No preamble anywhere -> the hard ceiling forces a cut at _CHUNK_HARD_MAX.
        payloads = [_payload(i + 2) for i in range(_svc._CHUNK_HARD_MAX + 50)]
        chunks = _svc.chunk_rows(payloads)
        self.assertEqual(len(chunks[0]), _svc._CHUNK_HARD_MAX,
                         "a section-less run still terminates at the hard max")
        for c in chunks:
            self.assertLessEqual(len(c), _svc._CHUNK_HARD_MAX)
        # Order + completeness preserved.
        flat = [p["excel_row"] for c in chunks for p in c]
        self.assertEqual(flat, [p["excel_row"] for p in payloads])

    # --- update_spine ------------------------------------------------------

    def test_spine_carries_open_section_and_last_sl_no(self):
        # Chunk 0 opens a level-1 section (excel 10) then advances sl_no to "7".
        chunk0 = [
            _payload(10, cls="preamble", level=1, desc="LT CABLES"),
            _payload(11, sl_no="5"),
            _payload(12, sl_no="6"),
            _payload(13, sl_no="7"),
        ]
        spine = _svc.update_spine({"open_sections": [], "last_sl_no": None}, chunk0)
        self.assertEqual(len(spine["open_sections"]), 1)
        self.assertEqual(spine["open_sections"][0]["excel_row"], 10)
        self.assertEqual(spine["open_sections"][0]["description"], "LT CABLES")
        self.assertEqual(spine["last_sl_no"], "7",
                         "the running sl_no carries the LAST seen value across the cut")

    def test_spine_pops_section_at_equal_or_deeper_level(self):
        # Open a level-1, then a level-2 under it, then a NEW level-1 sibling: the new
        # level-1 must pop BOTH the previous level-1 and the level-2 (>= its level).
        spine = {"open_sections": [], "last_sl_no": None}
        spine = _svc.update_spine(spine, [_payload(10, cls="preamble", level=1, desc="A")])
        spine = _svc.update_spine(spine, [_payload(20, cls="preamble", level=2, desc="A.1")])
        self.assertEqual([s["excel_row"] for s in spine["open_sections"]], [10, 20])
        spine = _svc.update_spine(spine, [_payload(30, cls="preamble", level=1, desc="B")])
        self.assertEqual([s["excel_row"] for s in spine["open_sections"]], [30],
                         "a new level-1 closes the prior level-1 + its level-2 child")

    # --- render_context ----------------------------------------------------

    def test_render_context_first_chunk_is_sentinel(self):
        ctx = _svc.render_context({"open_sections": [], "last_sl_no": None}, is_first_chunk=True)
        self.assertIn("first slice", ctx.lower())

    def test_render_context_later_chunk_lists_sections_and_sl_no(self):
        spine = {
            "open_sections": [{"excel_row": 10, "level": 1, "description": "LT CABLES"}],
            "last_sl_no": "7",
        }
        ctx = _svc.render_context(spine, is_first_chunk=False)
        self.assertIn("excel_row 10", ctx)
        self.assertIn("LT CABLES", ctx)
        self.assertIn("7", ctx)
        self.assertIn("OPEN SECTIONS", ctx)


class TestRunAiPassChunking(FrappeTestCase):
    """run_ai_pass with a FAKE Anthropic client (anthropic.Anthropic patched).

    review_rows here are plain dicts carrying the fields _build_row_payload reads
    (row_index, source_row_number, classification, level, parent_index, sl_no_value,
    description, unit) -- the same shape the worker passes after resolve_effective.
    """

    def _rows(self, n, preamble_at=None):
        rows = []
        for i in range(n):
            is_pre = (preamble_at is not None and i == preamble_at)
            rows.append({
                "row_index": i,
                "source_row_number": i + 2,   # excel_row
                "classification": "preamble" if is_pre else "line_item",
                "level": 1 if is_pre else None,
                "parent_index": -1,
                "sl_no_value": str(i + 1),
                "description": f"row {i}",
                "unit": None,
            })
        return rows

    def _run(self, rows, scripted):
        _FakeAnthropic.scripted = scripted
        with patch("anthropic.Anthropic", _FakeAnthropic):
            out = _svc.run_ai_pass("Sheet1", rows, _settings(), "sk-test")
        return out, _FakeAnthropic.last_instance.messages

    def test_small_sheet_single_call_path_unchanged(self):
        # <= threshold -> exactly ONE create() call, and its prompt carries the
        # "first slice" sentinel (the single-call path still fills {CONTEXT}).
        rows = self._rows(3)
        scripted = ['[{"excel_row": 3, "suggested_classification": "preamble", '
                    '"classification_confidence": "High", "suggested_parent": "NO_CHANGE", '
                    '"explanation": "header"}]']
        out, msgs = self._run(rows, scripted)
        self.assertEqual(len(msgs.calls), 1, "a small sheet must be ONE API call")
        ctx0 = msgs.calls[0].split("CARRIED CONTEXT:", 1)[1]
        self.assertIn("first slice", ctx0.lower(),
                      "the single-call path still fills {CONTEXT} with the first-slice sentinel")
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["row_index"], 1)             # excel 3 -> row_index 1
        self.assertEqual(out[0]["ai_suggested_classification"], "preamble")

    def test_multi_chunk_accumulates_suggestions(self):
        # 250 rows with a preamble at index 130 -> 2 chunks. Each chunk returns one
        # suggestion; run_ai_pass must MERGE both into the returned list.
        rows = self._rows(250, preamble_at=130)
        scripted = [
            # chunk 0 flags excel 5 (row_index 3)
            '[{"excel_row": 5, "suggested_classification": "note", '
            '"classification_confidence": "Low", "suggested_parent": "NO_CHANGE", '
            '"explanation": "a note"}]',
            # chunk 1 flags excel 140 (row_index 138)
            '[{"excel_row": 140, "suggested_classification": null, '
            '"suggested_parent": 132, "parent_confidence": "High", '
            '"explanation": "under the new section"}]',
        ]
        out, msgs = self._run(rows, scripted)
        self.assertEqual(len(msgs.calls), 2, "250 rows with a mid preamble -> 2 chunks")
        # The filled CARRIED CONTEXT block distinguishes a later chunk from the first.
        # (The static instruction paragraph mentions "first slice" in BOTH prompts, so we
        # assert on the dynamic block after the "CARRIED CONTEXT:" marker.)
        ctx0 = msgs.calls[0].split("CARRIED CONTEXT:", 1)[1]
        ctx1 = msgs.calls[1].split("CARRIED CONTEXT:", 1)[1]
        self.assertIn("first slice", ctx0.lower(),
                      "chunk 0's carried context is the first-slice sentinel")
        self.assertIn("LAST sl_no", ctx1,
                      "chunk 1's carried context carries the running sl_no (a later slice)")
        self.assertNotIn("first slice", ctx1.lower(),
                         "chunk 1 is NOT the first slice")
        idxs = sorted(s["row_index"] for s in out)
        self.assertEqual(idxs, [3, 138], "suggestions from BOTH chunks are accumulated")
        # the cross-chunk parent (excel 132, the carried-section preamble) resolved
        s140 = next(s for s in out if s["row_index"] == 138)
        self.assertEqual(s140["ai_suggested_parent"], 130, "excel 132 -> row_index 130")

    def test_forward_reference_parent_is_dropped(self):
        # A chunk-0 row suggests a parent excel_row that lives in chunk 1 (unseen) ->
        # the parent suggestion is dropped, the classification suggestion is kept.
        rows = self._rows(250, preamble_at=130)
        scripted = [
            # chunk 0: row excel 5 points at excel 200 (a chunk-1 row) -- forward ref
            '[{"excel_row": 5, "suggested_classification": "line_item", '
            '"classification_confidence": "High", "suggested_parent": 200, '
            '"parent_confidence": "High", "explanation": "forward ref"}]',
            '[]',
        ]
        out, _ = self._run(rows, scripted)
        s = next(x for x in out if x["row_index"] == 3)
        self.assertIsNone(s["ai_suggested_parent"],
                          "a forward-reference parent (unseen later chunk) is dropped")
        self.assertFalse(s["ai_suggested_is_root"])
        self.assertEqual(s["ai_suggested_classification"], "line_item",
                         "the classification suggestion is KEPT when only the parent is dropped")

    def test_cross_chunk_backward_parent_resolves(self):
        # The complement of the forward-ref test: a chunk-1 row pointing at a chunk-0
        # preamble (carried in OPEN SECTIONS) resolves normally.
        rows = self._rows(250, preamble_at=130)
        scripted = [
            '[]',
            '[{"excel_row": 145, "suggested_classification": null, '
            '"suggested_parent": 132, "parent_confidence": "High", '
            '"explanation": "backward to the carried section"}]',
        ]
        out, _ = self._run(rows, scripted)
        s = next(x for x in out if x["row_index"] == 143)  # excel 145 -> row_index 143
        self.assertEqual(s["ai_suggested_parent"], 130,
                         "a backward parent to a carried section (excel 132) resolves")
