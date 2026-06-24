# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for gemini_assist.py + boq_gemini_assist.py -- the GEMINI half of the dual-AI
feature (ADR-0003). The faithful mirror of test_ai_assist.py with the ai_* namespace
swapped for gemini_*, the Gemini service (build_gemini_client / build_row_payload /
classify_sheet) MOCKED -- NO live Gemini / Vertex / network call anywhere in this suite.

Groups:
  TestGeminiAssistPure       -- service mapping (map_suggestion incl. is_root),
                                derive_levels, normalize_confidence, build_row_payload.
  TestRunGeminiPass          -- run_gemini_pass guards (gemini_disabled / not_parsed /
                                frozen / parsing) + enqueue sets gemini_in_progress;
                                get_gemini_pass_status recovery shape.
  TestGeminiWorker           -- worker write-back (Pending + level + is_root derivation),
                                re-run stale-clear + chosen_source demote-to-manual,
                                in-progress lifecycle on success/error.
  TestAcceptRejectGemini     -- accept (clean) -> chosen_source=gemini + effective;
                                accept-4 rule throws on subtotal_marker/header_repeat;
                                reject; revert -> baseline + Pending; the R3a / ADR-0006
                                BLOCK on a standing Claude acceptance (the SWITCH, gemini
                                direction; the prior pre-revert is retired).
"""
import json
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import gemini_assist
from nirmaan_stack.api.boq.wizard.gemini_assist import (
    accept_gemini_suggestion,
    get_gemini_pass_status,
    reject_gemini_suggestion,
    revert_gemini_acceptance,
    run_gemini_pass,
)
from nirmaan_stack.api.boq.wizard.ai_assist import accept_ai_suggestion
from nirmaan_stack.api.boq.wizard.review_screen import (
    get_review_rows,
    resolve_effective,
)
from nirmaan_stack.services import boq_gemini_assist as svc
from nirmaan_stack.services.boq_gemini_assist import _NonRetryable

# The enable gate + the worker's settings read both go through this symbol (imported
# into gemini_assist). Patch it there to flip boq_ai_enabled.
_SETTINGS = "nirmaan_stack.api.boq.wizard.gemini_assist.get_boq_classifier_settings"

_G_SHEET = "GeminiSheet"
_EMPTY_SHEET = "GeminiEmptySheet"

_ENABLED_SETTINGS = {
    "boq_ai_enabled": True,
    "provider": "gemini",
    "auth_mode": "Vertex AI",
    "gcp_project_id": "test-proj",
    "gcp_location": "asia-south1",
    "gemini_model": "gemini-test",
    "gemini_thinking_level": "low",
    "request_timeout_seconds": 90,
}


def _make_project():
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_GEMINI_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


# ===========================================================================
# Group 1: service pure logic (mapping incl. is_root)
# ===========================================================================

class TestGeminiAssistPure(FrappeTestCase):
    """The Gemini service's pure output-mapping core (delta 2: gemini_suggested_is_root)."""

    def test_map_suggestion_null_parent_is_root(self):
        m = svc.map_suggestion({"id": 4, "classification": "preamble", "parent_id": None})
        self.assertEqual(m["gemini_suggested_parent"], -1,
                         "a null parent_id -> the -1 no-parent sentinel")
        self.assertEqual(m["gemini_suggested_is_root"], 1,
                         "delta 2: a null parent_id sets the root flag")
        self.assertEqual(m["gemini_suggested_classification"], "preamble")
        self.assertEqual(m["gemini_suggestion_status"], "Pending")

    def test_map_suggestion_real_parent_not_root(self):
        m = svc.map_suggestion({"id": 7, "classification": "line_item", "parent_id": 4})
        self.assertEqual(m["gemini_suggested_parent"], 4)
        self.assertEqual(m["gemini_suggested_is_root"], 0,
                         "a real int parent_id -> is_root 0")

    def test_map_suggestion_noninteger_parent_falls_back_to_root(self):
        m = svc.map_suggestion({"id": 1, "classification": "note", "parent_id": "abc"})
        self.assertEqual(m["gemini_suggested_parent"], -1)
        self.assertEqual(m["gemini_suggested_is_root"], 1,
                         "a non-int parent_id is treated as root (sentinel + is_root 1)")

    def test_map_suggestion_offvocab_classification_dropped(self):
        self.assertIsNone(svc.map_suggestion({"id": 1, "classification": "widget"}))

    def test_map_suggestion_missing_id_dropped(self):
        self.assertIsNone(svc.map_suggestion({"classification": "line_item"}))

    def test_map_suggestion_all_six_classes_accepted(self):
        # DISPLAY SIX: the service maps all 6 parser classes (accept-4 is a higher gate).
        for cls in ("line_item", "preamble", "note", "spacer",
                    "subtotal_marker", "header_repeat"):
            with self.subTest(cls=cls):
                m = svc.map_suggestion({"id": 0, "classification": cls, "parent_id": None})
                self.assertIsNotNone(m, f"{cls} must be a valid suggestion")
                self.assertEqual(m["gemini_suggested_classification"], cls)

    def test_normalize_confidence(self):
        self.assertEqual(svc.normalize_confidence(None), "Low")
        self.assertEqual(svc.normalize_confidence("garbage"), "Low")
        self.assertEqual(svc.normalize_confidence("high"), "High")
        self.assertEqual(svc.normalize_confidence("Medium"), "Medium")

    def test_derive_levels_root_and_chain(self):
        levels = svc.derive_levels({0: -1, 1: 0, 2: 1})
        self.assertEqual(levels, {0: 0, 1: 1, 2: 2})

    def test_derive_levels_cycle_safe(self):
        levels = svc.derive_levels({1: 2, 2: 1})
        self.assertTrue(all(isinstance(v, int) for v in levels.values()))

    def test_build_row_payload_excludes_parser_verdict(self):
        row = {
            "row_index": 3, "source_row_number": 12, "description": "Excavation",
            "sl_no_value": "1.1", "unit": "cum", "qty_total": 10, "rate_supply": 100,
            "amount_total": 1000, "preamble_candidate_score": 0, "level": 2,
            "is_rate_only": 0, "is_synthetic": 0,
            "classification": "line_item", "parent_index": 1,
        }
        p = svc.build_row_payload(row)
        self.assertEqual(p["id"], 3)
        self.assertTrue(p["has_qty"])
        self.assertTrue(p["has_rate"])
        self.assertNotIn("classification", p, "the parser verdict must NOT leak into the payload")
        self.assertNotIn("parent_index", p)


# ===========================================================================
# Shared DB base: a parsed sheet (3 rows) + an empty sheet, with helpers.
# ===========================================================================

class _GeminiDBBase(FrappeTestCase):
    SHEET = _G_SHEET

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Gemini Pass Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": _G_SHEET, "sheet_order": 1, "wizard_status": "Parsed",
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

    def _set_draft(self, sheet, fields):
        child = frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq_name, "parenttype": "BOQs", "sheet_name": sheet},
            "name",
        )
        frappe.db.set_value("BoQ Sheet Draft", child, fields)

    def _restore_draft(self, sheet, fields):
        self._set_draft(sheet, fields)
        frappe.db.commit()

    def _seed_rows(self, layout):
        """layout: list of (row_index, classification, parent_index). Resets the sheet."""
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name, "sheet_name": self.SHEET})
        self.names = {}
        for ridx, cls_, parent in layout:
            doc = frappe.new_doc("BoQ Review Row")
            doc.update({
                "boq": self.boq_name,
                "sheet_name": self.SHEET,
                "row_index": ridx,
                "source_row_number": ridx + 2,
                "classification": cls_,
                "parent_index": parent,
                "human_parent": -1,
                "human_is_root": 0,
                "gemini_suggested_parent": -1,
                "gemini_snapshot_owner": -1,
                "ai_suggested_parent": -1,
            })
            doc.insert(ignore_permissions=True)
            self.names[ridx] = doc.name
        frappe.db.commit()


# ===========================================================================
# Group 2: run_gemini_pass guards + enqueue + status
# ===========================================================================

class TestRunGeminiPass(_GeminiDBBase):

    def setUp(self):
        self._seed_rows([(0, "preamble", -1), (1, "line_item", -1), (2, "line_item", -1)])
        self._set_draft(_G_SHEET, {"gemini_in_progress": 0, "parse_in_progress": 0,
                                   "wizard_status": "Parsed"})
        self._set_draft(_EMPTY_SHEET, {"gemini_in_progress": 0, "parse_in_progress": 0,
                                       "wizard_status": "Parsed"})
        frappe.db.commit()

    def _gemini_in_progress(self, sheet):
        return gemini_assist._get_gemini_in_progress(self.boq_name, sheet)

    def test_endpoint_rejects_when_not_parsed(self):
        result = run_gemini_pass(boq_name=self.boq_name, sheet_name=_EMPTY_SHEET)
        self.assertEqual(result, {"ok": False, "error": "not_parsed"})

    def test_endpoint_rejects_when_gemini_disabled(self):
        disabled = {**_ENABLED_SETTINGS, "boq_ai_enabled": False}
        with patch(_SETTINGS, return_value=disabled):
            result = run_gemini_pass(boq_name=self.boq_name, sheet_name=_G_SHEET)
        self.assertEqual(result, {"ok": False, "error": "gemini_disabled"})

    def test_endpoint_rejects_when_frozen(self):
        # A "Finalized" sheet is read-only: the guard fires BEFORE any enqueue/apply.
        self._set_draft(_G_SHEET, {"wizard_status": "Finalized"})
        self.addCleanup(self._restore_draft, _G_SHEET, {"wizard_status": "Parsed"})
        frappe.db.commit()
        with patch(_SETTINGS, return_value=_ENABLED_SETTINGS), \
             patch("frappe.enqueue") as mock_enq:
            result = run_gemini_pass(boq_name=self.boq_name, sheet_name=_G_SHEET)
        self.assertEqual(result, {"ok": False, "error": "frozen"})
        self.assertFalse(mock_enq.called, "a frozen sheet must NOT enqueue a Gemini pass")

    def test_endpoint_rejects_when_parsing(self):
        self._set_draft(_G_SHEET, {"parse_in_progress": 1})
        self.addCleanup(self._restore_draft, _G_SHEET, {"parse_in_progress": 0})
        frappe.db.commit()
        with patch(_SETTINGS, return_value=_ENABLED_SETTINGS), \
             patch("frappe.enqueue") as mock_enq:
            result = run_gemini_pass(boq_name=self.boq_name, sheet_name=_G_SHEET)
        self.assertEqual(result, {"ok": False, "error": "parsing"})
        self.assertFalse(mock_enq.called, "a parsing sheet must NOT enqueue a Gemini pass")

    def test_endpoint_rejects_when_already_in_progress(self):
        self._set_draft(_G_SHEET, {"gemini_in_progress": 1})
        self.addCleanup(self._restore_draft, _G_SHEET, {"gemini_in_progress": 0})
        frappe.db.commit()
        with patch(_SETTINGS, return_value=_ENABLED_SETTINGS), \
             patch("frappe.enqueue") as mock_enq:
            result = run_gemini_pass(boq_name=self.boq_name, sheet_name=_G_SHEET)
        self.assertEqual(result, {"ok": False, "error": "in_progress"})
        self.assertFalse(mock_enq.called)

    def test_start_over_bypasses_in_progress_guard(self):
        self._set_draft(_G_SHEET, {"gemini_in_progress": 1})
        self.addCleanup(self._restore_draft, _G_SHEET, {"gemini_in_progress": 0})
        frappe.db.commit()
        fake_job = MagicMock()
        fake_job.id = "job-start-over"
        with patch(_SETTINGS, return_value=_ENABLED_SETTINGS), \
             patch("frappe.enqueue", return_value=fake_job) as mock_enq:
            result = run_gemini_pass(boq_name=self.boq_name, sheet_name=_G_SHEET,
                                     mode="start_over")
        self.assertTrue(result["ok"])
        self.assertTrue(mock_enq.called, "start_over must bypass the in-progress guard")

    def test_endpoint_enqueues_and_sets_in_progress(self):
        fake_job = MagicMock()
        fake_job.id = "job-gemini"
        with patch(_SETTINGS, return_value=_ENABLED_SETTINGS), \
             patch("frappe.enqueue", return_value=fake_job) as mock_enq:
            result = run_gemini_pass(boq_name=self.boq_name, sheet_name=_G_SHEET)

        self.assertTrue(result["ok"])
        self.assertTrue(result["enqueued"])
        self.assertTrue(mock_enq.called, "the gemini worker must be enqueued")
        kwargs = mock_enq.call_args.kwargs
        self.assertEqual(kwargs["boq_name"], self.boq_name)
        self.assertEqual(kwargs["sheet_name"], _G_SHEET)
        self.assertEqual(kwargs["user"], frappe.session.user)
        self.assertEqual(kwargs["queue"], "long")
        self.assertEqual(
            mock_enq.call_args.args[0],
            "nirmaan_stack.api.boq.wizard.gemini_assist._run_gemini_pass_worker",
        )
        self.assertEqual(self._gemini_in_progress(_G_SHEET), 1,
                         "gemini_in_progress must be set to 1 after a successful enqueue")

    def test_enqueue_clears_stale_status_payload(self):
        # Regression: a re-run after a failure must NOT re-show the previous run's error banner.
        # The enqueue invalidates the cached terminal payload so the frontend's Layer-2 poll
        # (get_gemini_pass_status) resolves THIS pass, not the last one's outcome. Repro: seed a
        # stale "error" payload (as _publish_gemini_event records after a failure), then re-enqueue.
        key = gemini_assist._gemini_status_key(self.boq_name, _G_SHEET)
        frappe.cache().set_value(
            key,
            {"status": "error", "boq_name": self.boq_name,
             "sheet_name": _G_SHEET, "error_code": "gemini_failed"},
        )
        self.addCleanup(frappe.cache().delete_value, key)
        self.addCleanup(self._restore_draft, _G_SHEET, {"gemini_in_progress": 0})

        # Sanity: before the re-run the stale payload is readable (this is what re-showed the error).
        self.assertEqual(
            get_gemini_pass_status(boq_name=self.boq_name, sheet_name=_G_SHEET)["status"],
            "error",
        )

        fake_job = MagicMock()
        fake_job.id = "job-gemini-rerun"
        with patch(_SETTINGS, return_value=_ENABLED_SETTINGS), \
             patch("frappe.enqueue", return_value=fake_job):
            result = run_gemini_pass(boq_name=self.boq_name, sheet_name=_G_SHEET)

        self.assertTrue(result["ok"])
        self.assertIsNone(
            frappe.cache().get_value(key),
            "enqueue must invalidate the prior run's cached status payload",
        )
        # The poll now sees an in-progress idle shape, NOT the stale error.
        status = get_gemini_pass_status(boq_name=self.boq_name, sheet_name=_G_SHEET)
        self.assertEqual(status["status"], "idle_or_unknown")
        self.assertEqual(status["gemini_in_progress"], 1)

    def test_status_returns_idle_shape_when_no_fallback(self):
        frappe.cache().delete_value(gemini_assist._gemini_status_key(self.boq_name, _G_SHEET))
        status = get_gemini_pass_status(boq_name=self.boq_name, sheet_name=_G_SHEET)
        self.assertEqual(status["status"], "idle_or_unknown")
        self.assertIn("gemini_in_progress", status)


# ===========================================================================
# Group 3: worker write-back + re-run stale-clear + chosen_source demote
# ===========================================================================

class TestGeminiWorker(_GeminiDBBase):
    SHEET = _G_SHEET

    def setUp(self):
        self._seed_rows([(0, "preamble", -1), (1, "line_item", -1), (2, "line_item", -1)])
        self._set_draft(_G_SHEET, {"gemini_in_progress": 0, "parse_in_progress": 0,
                                   "wizard_status": "Parsed"})
        frappe.db.commit()

    def _row(self, ridx):
        return frappe.db.get_value(
            "BoQ Review Row", self.names[ridx],
            ["gemini_suggested_classification", "gemini_classification_confidence",
             "gemini_suggested_parent", "gemini_suggested_is_root", "gemini_parent_confidence",
             "gemini_suggested_level", "gemini_explanation", "gemini_suggestion_status",
             "chosen_source", "human_classification", "human_parent"],
            as_dict=True,
        )

    def _gemini_in_progress(self):
        return gemini_assist._get_gemini_in_progress(self.boq_name, _G_SHEET)

    def _run_worker_with(self, suggestions, token_total=42):
        """Patch the 3 Gemini service entry points the worker calls, then run it."""
        with patch.object(svc, "build_gemini_client", return_value=object()), \
             patch.object(svc, "build_row_payload", side_effect=lambda r: {"id": r.get("row_index")}), \
             patch.object(svc, "classify_sheet", return_value=(suggestions, token_total)), \
             patch(_SETTINGS, return_value=_ENABLED_SETTINGS), \
             patch("frappe.publish_realtime", MagicMock()):
            gemini_assist._run_gemini_pass_worker(self.boq_name, _G_SHEET, user=None)

    def test_worker_writes_back_pending_and_derives_level_and_is_root(self):
        # row 0 -> preamble root; row 1 -> line_item under 0; row 2 -> line_item root.
        suggestions = [
            {"id": 0, "gemini_suggested_classification": "preamble",
             "gemini_suggested_parent": -1, "gemini_suggested_is_root": 1,
             "gemini_classification_confidence": "High", "gemini_parent_confidence": "High",
             "gemini_explanation": "section header"},
            {"id": 1, "gemini_suggested_classification": "line_item",
             "gemini_suggested_parent": 0, "gemini_suggested_is_root": 0,
             "gemini_classification_confidence": "Medium", "gemini_parent_confidence": "Medium",
             "gemini_explanation": "item under 0"},
            {"id": 2, "gemini_suggested_classification": "line_item",
             "gemini_suggested_parent": -1, "gemini_suggested_is_root": 1,
             "gemini_classification_confidence": "Low", "gemini_parent_confidence": "Low",
             "gemini_explanation": "root item"},
        ]
        self._run_worker_with(suggestions)

        r0 = self._row(0)
        self.assertEqual(r0["gemini_suggested_classification"], "preamble")
        self.assertEqual(r0["gemini_suggestion_status"], "Pending")
        self.assertEqual(r0["gemini_suggested_is_root"], 1)
        self.assertEqual(r0["gemini_suggested_level"], 0, "a root -> derived level 0")

        r1 = self._row(1)
        self.assertEqual(r1["gemini_suggested_parent"], 0)
        self.assertEqual(r1["gemini_suggested_is_root"], 0)
        self.assertEqual(r1["gemini_suggested_level"], 1,
                         "child of a root -> derived level 1")
        self.assertEqual(r1["gemini_suggestion_status"], "Pending")

    def test_worker_clears_stale_prior_suggestions(self):
        # Pre-seed a Pending gemini suggestion on row 0, which the NEW pass does NOT flag.
        frappe.db.set_value("BoQ Review Row", self.names[0], {
            "gemini_suggested_classification": "note",
            "gemini_suggested_parent": 1,
            "gemini_suggested_is_root": 0,
            "gemini_suggested_level": 3,
            "gemini_explanation": "stale",
            "gemini_suggestion_status": "Pending",
        })
        frappe.db.commit()

        # New pass flags only row 1.
        self._run_worker_with([
            {"id": 1, "gemini_suggested_classification": "preamble",
             "gemini_suggested_parent": -1, "gemini_suggested_is_root": 1,
             "gemini_classification_confidence": "High", "gemini_parent_confidence": "High",
             "gemini_explanation": "fresh"},
        ])

        r0 = self._row(0)
        self.assertIsNone(r0["gemini_suggestion_status"],
                          "the stale prior gemini suggestion on row 0 must be cleared")
        self.assertEqual(r0["gemini_suggested_parent"], -1)
        self.assertIsNone(r0["gemini_suggested_classification"])
        self.assertEqual(self._row(1)["gemini_suggestion_status"], "Pending")

    def test_rerun_demotes_chosen_source_gemini_to_manual_but_keeps_human(self):
        # ADR-0003 sec 7: a row whose chosen_source was "gemini" AND that carries a live
        # gemini suggestion (so it is stale-cleared) demotes chosen_source to "manual" on
        # the re-run wipe; human_* is sticky (untouched).
        frappe.db.set_value("BoQ Review Row", self.names[2], {
            "gemini_suggested_classification": "preamble",
            "gemini_suggested_parent": -1,
            "gemini_suggested_is_root": 1,
            "gemini_suggestion_status": "Accepted",
            "human_classification": "preamble",
            "human_parent": -1,
            "human_is_root": 1,
            "chosen_source": "gemini",
        })
        frappe.db.commit()

        # New pass re-flags only row 1 (row 2 is wiped by the stale-clear).
        self._run_worker_with([
            {"id": 1, "gemini_suggested_classification": "line_item",
             "gemini_suggested_parent": 0, "gemini_suggested_is_root": 0,
             "gemini_classification_confidence": "Medium", "gemini_parent_confidence": "Medium",
             "gemini_explanation": "fresh"},
        ])

        r2 = self._row(2)
        self.assertIsNone(r2["gemini_suggestion_status"],
                          "the prior gemini suggestion is wiped by the re-run")
        self.assertEqual(r2["chosen_source"], "manual",
                         "chosen_source 'gemini' demotes to 'manual' on a re-run wipe")
        self.assertEqual(r2["human_classification"], "preamble",
                         "human_* is sticky -- the accepted decision survives the wipe")
        self.assertEqual(r2["human_parent"], -1)

    def test_publish_clears_in_progress_on_success(self):
        self._set_draft(_G_SHEET, {"gemini_in_progress": 1})
        frappe.db.commit()
        self._run_worker_with([])
        self.assertEqual(self._gemini_in_progress(), 0,
                         "a successful pass must clear gemini_in_progress")

    def test_publish_clears_in_progress_on_error_and_reraises(self):
        self._set_draft(_G_SHEET, {"gemini_in_progress": 1})
        frappe.db.commit()
        with patch.object(svc, "build_gemini_client", return_value=object()), \
             patch.object(svc, "build_row_payload", side_effect=lambda r: {"id": r.get("row_index")}), \
             patch.object(svc, "classify_sheet", side_effect=_NonRetryable("boom")), \
             patch(_SETTINGS, return_value=_ENABLED_SETTINGS), \
             patch("frappe.publish_realtime", MagicMock()):
            with self.assertRaises(_NonRetryable):
                gemini_assist._run_gemini_pass_worker(self.boq_name, _G_SHEET, user=None)
        self.assertEqual(self._gemini_in_progress(), 0,
                         "an errored pass must still clear gemini_in_progress")


# ===========================================================================
# Group 4: accept / reject / revert (clean rows) + accept-4 + the SWITCH
# ===========================================================================

_GAR_SHEET = "GeminiARSheet"


class TestAcceptRejectGemini(FrappeTestCase):
    """accept_gemini_suggestion / reject / revert -- the NON-MODAL childless paths,
    PLUS the dual-AI accept-4 rule and the R3a / ADR-0006 BLOCK on a standing override
    (the prior cross-provider pre-revert is retired).

    Row layout (rebuilt each test): row 0 preamble root WITH a child (row 1); row 1
    line_item child of row 0 (childless); row 2 line_item root (childless)."""

    SHEET = _GAR_SHEET

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Gemini Accept/Reject Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": _GAR_SHEET, "sheet_order": 1, "wizard_status": "Parsed",
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
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name, "sheet_name": _GAR_SHEET})
        self.names = {}
        for ridx, cls_, parent in [(0, "preamble", -1), (1, "line_item", 0), (2, "line_item", -1)]:
            doc = frappe.new_doc("BoQ Review Row")
            doc.update({
                "boq": self.boq_name,
                "sheet_name": _GAR_SHEET,
                "row_index": ridx,
                "source_row_number": ridx + 2,
                "classification": cls_,
                "parent_index": parent,
                "human_parent": -1,
                "human_is_root": 0,
                "gemini_suggested_parent": -1,
                "gemini_snapshot_owner": -1,
                "ai_suggested_parent": -1,
                "ai_snapshot_owner": -1,
            })
            doc.insert(ignore_permissions=True)
            self.names[ridx] = doc.name
        frappe.db.commit()

    def _seed_gemini(self, ridx, **fields):
        frappe.db.set_value("BoQ Review Row", self.names[ridx], fields)
        frappe.db.commit()

    def _row(self, ridx):
        return frappe.db.get_value(
            "BoQ Review Row", self.names[ridx],
            ["human_classification", "human_parent", "human_is_root",
             "gemini_suggestion_status", "ai_suggestion_status", "chosen_source",
             "classification", "parent_index", "gemini_suggested_classification",
             "gemini_suggested_parent", "gemini_suggested_is_root", "edited_at"],
            as_dict=True,
        )

    def _snapshot(self, ridx):
        return frappe.db.get_value("BoQ Review Row", self.names[ridx], "gemini_accept_snapshot")

    # -- accept (clean): classification -> chosen_source=gemini + effective ----

    def test_accept_classification_clean_sets_gemini_chosen_source_and_effective(self):
        # row 2 is a childless line_item root. Accept a Gemini 'preamble' classification.
        self._seed_gemini(2, gemini_suggestion_status="Pending",
                          gemini_suggested_classification="preamble")
        res = accept_gemini_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET,
                                       row_index=2, accept_classification=True)
        self.assertTrue(res["ok"])
        self.assertEqual(res["gemini_suggestion_status"], "Accepted")
        self.assertEqual(res["effective_classification"], "preamble",
                         "the accepted gemini class is now the effective class")
        self.assertNotIn("claude_reverted", res,
                         "R3a / ADR-0006: the cross-provider pre-revert (and its claude_reverted "
                         "field) is retired")

        r = self._row(2)
        self.assertEqual(r["human_classification"], "preamble",
                         "accept folds gemini value into the human layer (Option A)")
        self.assertEqual(r["gemini_suggestion_status"], "Accepted")
        self.assertEqual(r["chosen_source"], "gemini",
                         "the chokepoint sets chosen_source=gemini from the reason string")
        self.assertIsNotNone(r["edited_at"], "accept stamps edited_at (it IS a human edit)")
        self.assertIsNotNone(self._snapshot(2),
                             "gemini_accept_snapshot must SURVIVE the accept's own chokepoint clears")

    def test_accept_parent_clean_childless_real_index(self):
        self._seed_gemini(2, gemini_suggestion_status="Pending", gemini_suggested_parent=0,
                          gemini_suggested_is_root=0)
        res = accept_gemini_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET,
                                       row_index=2, accept_parent=True)
        self.assertEqual(res["gemini_suggestion_status"], "Accepted")
        r = self._row(2)
        self.assertEqual(r["human_parent"], 0)
        self.assertEqual(r["chosen_source"], "gemini")

    def test_accept_parent_clean_childless_root(self):
        self._seed_gemini(2, gemini_suggestion_status="Pending",
                          gemini_suggested_is_root=1, gemini_suggested_parent=-1)
        res = accept_gemini_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET,
                                       row_index=2, accept_parent=True)
        self.assertEqual(res["gemini_suggestion_status"], "Accepted")
        r = self._row(2)
        self.assertEqual(r["human_is_root"], 1)
        self.assertEqual(r["human_parent"], -1)
        self.assertIsNone(res["effective_parent_index"],
                          "an accepted gemini root suggestion resolves to effective-root")

    def test_accept_then_resolve_effective_renders_gemini_value(self):
        self._seed_gemini(2, gemini_suggestion_status="Pending",
                          gemini_suggested_classification="note")
        accept_gemini_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET,
                                 row_index=2, accept_classification=True)
        stored = frappe.db.get_value(
            "BoQ Review Row", self.names[2],
            ["classification", "parent_index", "human_classification", "human_parent",
             "human_is_root", "ai_suggestion_status", "ai_suggested_classification",
             "ai_suggested_parent", "ai_suggested_is_root"],
            as_dict=True,
        )
        eff = resolve_effective(stored)
        self.assertEqual(eff["effective_classification"], "note",
                         "the accepted gemini class (now in human_classification) is effective")

    # -- accept-4 rule: subtotal_marker / header_repeat throw --------------

    def test_accept_classification_subtotal_marker_throws(self):
        self._seed_gemini(2, gemini_suggestion_status="Pending",
                          gemini_suggested_classification="subtotal_marker")
        with self.assertRaises(frappe.ValidationError):
            accept_gemini_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET,
                                     row_index=2, accept_classification=True)
        r = self._row(2)
        self.assertEqual(r["gemini_suggestion_status"], "Pending",
                         "a rejected accept-4 must leave the suggestion Pending")
        self.assertIsNone(r["human_classification"], "no human write on an accept-4 throw")

    def test_accept_classification_header_repeat_throws(self):
        self._seed_gemini(2, gemini_suggestion_status="Pending",
                          gemini_suggested_classification="header_repeat")
        with self.assertRaises(frappe.ValidationError):
            accept_gemini_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET,
                                     row_index=2, accept_classification=True)
        self.assertEqual(self._row(2)["gemini_suggestion_status"], "Pending")

    # -- with-children scope guard -> route to modal -----------------------

    def test_accept_parent_with_children_throws(self):
        # row 0 has child row 1 -> a parent accept must route through the modal.
        self._seed_gemini(0, gemini_suggestion_status="Pending", gemini_suggested_parent=2)
        with self.assertRaises(frappe.ValidationError):
            accept_gemini_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET,
                                     row_index=0, accept_parent=True)
        r = self._row(0)
        self.assertEqual(r["gemini_suggestion_status"], "Pending")
        self.assertEqual(r["human_parent"], -1)

    def test_accept_nothing_throws(self):
        self._seed_gemini(2, gemini_suggestion_status="Pending",
                          gemini_suggested_classification="note")
        with self.assertRaises(frappe.ValidationError):
            accept_gemini_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET, row_index=2)

    # -- reject -------------------------------------------------------------

    def test_reject_sets_status_only(self):
        self._seed_gemini(2, gemini_suggestion_status="Pending",
                          gemini_suggested_classification="preamble")
        res = reject_gemini_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET, row_index=2)
        self.assertEqual(res["gemini_suggestion_status"], "Rejected")
        r = self._row(2)
        self.assertEqual(r["gemini_suggestion_status"], "Rejected")
        self.assertIsNone(r["human_classification"], "reject must NOT touch human_*")
        self.assertEqual(r["human_parent"], -1)
        self.assertIsNone(r["edited_at"], "reject is not an edit -- edited_at stays unset")
        self.assertEqual(r["gemini_suggested_classification"], "preamble",
                         "the suggested value is preserved (only the status changed)")
        self.assertEqual(r["chosen_source"], "parser",
                         "reject must NOT change chosen_source (stays the parser default)")

    # -- revert -> baseline + Pending --------------------------------------

    def test_revert_restores_baseline_and_reoffers(self):
        self._seed_gemini(2, gemini_suggestion_status="Pending", gemini_suggested_parent=0,
                          gemini_suggested_is_root=0)
        accept_gemini_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET,
                                 row_index=2, accept_parent=True)
        self.assertEqual(self._row(2)["human_parent"], 0)
        self.assertIsNotNone(self._snapshot(2))

        res = revert_gemini_acceptance(boq_name=self.boq_name, sheet_name=_GAR_SHEET, row_index=2)
        self.assertTrue(res["ok"])
        self.assertEqual(res["gemini_suggestion_status"], "Pending")
        r = self._row(2)
        self.assertEqual(r["human_parent"], -1,
                         "human_parent restored to the pre-accept root sentinel")
        self.assertEqual(r["human_is_root"], 0)
        self.assertEqual(r["gemini_suggestion_status"], "Pending",
                         "revert re-offers the suggestion (status -> Pending)")
        self.assertIsNone(self._snapshot(2), "the snapshot must be cleared after a revert")
        self.assertEqual(r["chosen_source"], "parser",
                         "revert to a no-human baseline -> chosen_source 'parser'")

    def test_revert_without_snapshot_throws(self):
        with self.assertRaises(frappe.ValidationError):
            revert_gemini_acceptance(boq_name=self.boq_name, sheet_name=_GAR_SHEET, row_index=2)

    def test_accept_on_prior_manual_edit_BLOCKS(self):
        # R3a / ADR-0006: a row with a pre-existing manual human override is a standing change,
        # so a gemini accept on it is BLOCKED (the prior auto-stack-then-revert-to-manual model
        # is retired). The manual edit is untouched; the user must revert_to_parser first.
        self._seed_gemini(2, human_classification="spacer",
                          gemini_suggestion_status="Pending",
                          gemini_suggested_classification="note")
        with self.assertRaises(frappe.ValidationError):
            accept_gemini_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET,
                                     row_index=2, accept_classification=True)
        r = self._row(2)
        self.assertEqual(r["human_classification"], "spacer",
                         "the prior manual edit must survive the blocked accept (no overwrite)")
        self.assertNotEqual(r["gemini_suggestion_status"], "Accepted",
                            "the gemini apply must not have landed")

    # -- the SWITCH (gemini direction): accept gemini on a Claude-accepted row -

    def test_accept_gemini_on_claude_accepted_row_BLOCKS(self):
        # R3a / ADR-0006: row 2 has a standing Claude acceptance. Accepting the Gemini one must
        # now BLOCK (the prior pre-revert is retired) -- the user reverts to parser first.
        frappe.db.set_value("BoQ Review Row", self.names[2], {
            "ai_suggested_classification": "preamble",
            "ai_suggestion_status": "Pending",
        })
        frappe.db.commit()
        # Accept the Claude suggestion first (real path -> captures its snapshot, flips status).
        accept_ai_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET,
                             row_index=2, accept_classification=True)
        self.assertEqual(self._row(2)["ai_suggestion_status"], "Accepted")
        self.assertEqual(self._row(2)["human_classification"], "preamble")

        # Now TRY to accept a DIFFERENT Gemini classification on the same row -> BLOCKED.
        self._seed_gemini(2, gemini_suggestion_status="Pending",
                          gemini_suggested_classification="note")
        with self.assertRaises(frappe.ValidationError):
            accept_gemini_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET,
                                     row_index=2, accept_classification=True)

        r = self._row(2)
        self.assertEqual(r["ai_suggestion_status"], "Accepted",
                         "the standing Claude acceptance must be untouched by the blocked gemini apply")
        self.assertNotEqual(r["gemini_suggestion_status"], "Accepted",
                            "the gemini apply must NOT have landed")
        self.assertEqual(r["human_classification"], "preamble",
                         "the Claude value must still own the human layer (no silent overwrite)")

    # -- revert_available surfaced on get_review_rows ----------------------

    def test_gemini_revert_available_surfaced_not_raw_blob(self):
        self._seed_gemini(2, gemini_suggestion_status="Pending", gemini_suggested_parent=0)
        accept_gemini_suggestion(boq_name=self.boq_name, sheet_name=_GAR_SHEET,
                                 row_index=2, accept_parent=True)
        rows = get_review_rows(boq_name=self.boq_name, sheet_name=_GAR_SHEET)["rows"]
        match = [r for r in rows if r["row_index"] == 2]
        self.assertEqual(len(match), 1)
        self.assertNotIn("gemini_accept_snapshot", match[0],
                         "the raw gemini snapshot blob must never reach the client")
        self.assertTrue(match[0]["gemini_revert_available"],
                        "gemini_revert_available must be true immediately after an accept")
