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
"""
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import ai_assist
from nirmaan_stack.api.boq.wizard.ai_assist import (
    _ai_cache_key,
    get_ai_pass_status,
    run_ai_pass,
)
from nirmaan_stack.api.boq.wizard.review_screen import resolve_effective
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
