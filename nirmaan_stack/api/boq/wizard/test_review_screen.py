"""
Tests for review_screen.py (Slice A).

Six test groups:
  TestResolveEffective          -- pure Python: resolve_effective precedence rules
  TestCheckStructuralIntegrity  -- pure Python: integrity check (orphan/cycle/line-item-as-parent)
  TestAppendEditLogEntry        -- pure Python: edit-log append helper
  TestGetReviewRows             -- DB: endpoint returns ordered rows + effective values + work_packages
  TestSaveReviewEdit            -- DB: endpoint validation, write, log, cycle guard
  TestMarkSheetParsedCheckDone  -- DB: status transition + confirm gate
"""
import json
import unittest

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.review_screen import (
    _build_column_descriptors,
    _compute_advisory_flags,
    _has_price_signal,
    append_edit_log_entry,
    check_structural_integrity,
    dismiss_row_flags,
    get_review_rows,
    get_structural_breaks,
    mark_sheet_parsed_check_done,
    resolve_effective,
    save_review_edit,
    save_review_remark,
    save_review_restructure,
    unmark_sheet_parsed_check_done,
)


# ---------------------------------------------------------------------------
# Shared list-JSON fields for the _insert_rows helper.
# Combines the 4 parser-output list fields (from parse_run._LIST_JSON_FIELDS)
# and the new edit_log field added in Slice A.  All must be pre-serialized via
# json.dumps() before doc.insert() per the Frappe list-JSON quirk.
# ---------------------------------------------------------------------------
_ALL_LIST_JSON_FIELDS: frozenset[str] = frozenset({
    "attached_notes",
    "validation_warnings",
    "classifier_warnings",
    "preamble_candidate_signals",
    "edit_log",
})


# ---------------------------------------------------------------------------
# DB helpers (shared by DB test groups)
# ---------------------------------------------------------------------------

def _make_project():
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_REVIEW_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


def _cleanup_project(project_name: str):
    for boq in frappe.get_all("BOQs", filters={"project": project_name}, fields=["name"]):
        frappe.db.delete("BoQ Review Row", {"boq": boq.name})
        frappe.delete_doc("BOQs", boq.name, force=True, ignore_permissions=True)
    frappe.delete_doc("Projects", project_name, force=True, ignore_permissions=True)
    frappe.db.commit()


def _insert_rows(boq_name: str, row_dicts: list) -> list:
    """Insert BoQ Review Row docs, pre-serializing list-JSON fields. Returns inserted names."""
    names = []
    for orig in row_dicts:
        d = dict(orig)
        d.setdefault("boq", boq_name)
        for key in _ALL_LIST_JSON_FIELDS:
            if isinstance(d.get(key), list):
                d[key] = json.dumps(d[key])
        doc = frappe.new_doc("BoQ Review Row")
        doc.update(d)
        doc.insert(ignore_permissions=True)
        names.append(doc.name)
    frappe.db.commit()
    return names


def _minimal_row(
    sheet_name,
    row_index,
    classification,
    parent_index=None,
    human_classification=None,
    human_parent=None,
    source_row_number=None,
    ai_suggested_classification=None,
    ai_classification_confidence=None,
    ai_suggested_parent=-1,
    ai_parent_confidence=None,
    ai_suggested_level=-1,
    ai_explanation=None,
    ai_suggestion_status=None,
):
    """Return a minimal BoQ Review Row field dict for _insert_rows.

    parent_index=None means root row -> stored as -1 (Frappe coerces Int None->0
    and 0 is a valid non-root index; -1 is the unambiguous "no parent" sentinel).
    human_parent=None means no override -> stored as -1 for the same reason.

    The 7 ai_* fields (Phase 4 P4-1) default to "no AI suggestion": ai_suggested_parent
    and ai_suggested_level default to the -1 sentinel; the rest to None; status None.
    Existing callers are unaffected -- a row with these defaults resolves to the parser
    layer exactly as before.
    """
    return {
        "sheet_name": sheet_name,
        "row_index": row_index,
        "source_row_number": source_row_number if source_row_number is not None else (row_index + 2),
        "classification": classification,
        "parent_index": parent_index if parent_index is not None else -1,
        "human_classification": human_classification,
        "human_parent": human_parent if human_parent is not None else -1,
        "attached_notes": [],
        "validation_warnings": [],
        "classifier_warnings": [],
        "preamble_candidate_signals": [],
        "edit_log": [],
        "ai_suggested_classification": ai_suggested_classification,
        "ai_classification_confidence": ai_classification_confidence,
        "ai_suggested_parent": ai_suggested_parent,
        "ai_parent_confidence": ai_parent_confidence,
        "ai_suggested_level": ai_suggested_level,
        "ai_explanation": ai_explanation,
        "ai_suggestion_status": ai_suggestion_status,
    }


# ===========================================================================
# Group 1: resolve_effective -- pure Python
# ===========================================================================

class TestResolveEffective(unittest.TestCase):
    """Verify human > parser precedence for classification and parent_index."""

    def _row(self, classification=None, human_classification=None,
             parent_index=None, human_parent=None,
             ai_suggestion_status=None, ai_suggested_classification=None,
             ai_suggested_parent=None):
        return {
            "classification": classification,
            "human_classification": human_classification,
            "parent_index": parent_index,
            "human_parent": human_parent,
            "ai_suggestion_status": ai_suggestion_status,
            "ai_suggested_classification": ai_suggested_classification,
            "ai_suggested_parent": ai_suggested_parent,
        }

    def test_human_classification_overrides_parser(self):
        eff = resolve_effective(self._row(classification="preamble",
                                          human_classification="line_item"))
        self.assertEqual(eff["effective_classification"], "line_item")
        self.assertEqual(eff["classification"], "preamble",
                         "parser classification must still be present in result")

    def test_parser_classification_used_when_no_human_override(self):
        eff = resolve_effective(self._row(classification="preamble",
                                          human_classification=None))
        self.assertEqual(eff["effective_classification"], "preamble")
        self.assertIsNone(eff["human_classification"])

    def test_empty_string_human_classification_is_no_override(self):
        """An empty string human_classification must fall back to the parser value."""
        eff = resolve_effective(self._row(classification="note",
                                          human_classification=""))
        self.assertEqual(eff["effective_classification"], "note",
                         "'' must not override parser classification")

    def test_human_parent_overrides_parser_parent_index(self):
        # human_parent=3 (>= 0) is unambiguously a real override -- no sentinel needed.
        eff = resolve_effective(self._row(parent_index=5, human_parent=3))
        self.assertEqual(eff["effective_parent_index"], 3)
        self.assertEqual(eff["parent_index"], 5,
                         "parser parent_index must still be present in result")

    def test_parser_parent_index_used_when_no_human_override(self):
        eff = resolve_effective(self._row(parent_index=5, human_parent=None))
        self.assertEqual(eff["effective_parent_index"], 5)

    def test_human_parent_zero_is_valid_override(self):
        """
        human_parent=0 refers to the row at index 0 -- a real, valid parent.
        Under the -1 sentinel convention: 0 is NOT in (None, -1), so it is
        treated as a genuine override without any separate flag field.
        """
        eff = resolve_effective(self._row(parent_index=5, human_parent=0))
        self.assertEqual(eff["effective_parent_index"], 0,
                         "human_parent=0 is an override to row 0, not a sentinel for None")

    def test_preserves_all_originals_alongside_effective(self):
        # human_parent=1 (>= 0) is a real override under the -1 sentinel convention.
        eff = resolve_effective(self._row(classification="preamble",
                                          human_classification="line_item",
                                          parent_index=2,
                                          human_parent=1))
        self.assertEqual(eff["classification"], "preamble")
        self.assertEqual(eff["human_classification"], "line_item")
        self.assertEqual(eff["parent_index"], 2)
        self.assertEqual(eff["human_parent"], 1)
        self.assertEqual(eff["effective_classification"], "line_item")
        self.assertEqual(eff["effective_parent_index"], 1)

    def test_frappe_dict_input_works(self):
        """resolve_effective must accept a frappe._dict (attribute-access style)."""
        d = frappe._dict(
            classification="spacer",
            human_classification=None,
            parent_index=None,
            human_parent=None,
        )
        eff = resolve_effective(d)
        self.assertEqual(eff["effective_classification"], "spacer")
        self.assertIsNone(eff["effective_parent_index"])


# ===========================================================================
# Group 1b: resolve_effective AI layer -- pure Python (Phase 4 P4-1)
# ===========================================================================

class TestResolveEffectiveAILayer(unittest.TestCase):
    """Verify the three-layer chain human > AI-accepted > parser.

    The AI layer applies ONLY when ai_suggestion_status == "Accepted"; the human
    layer always wins when present; ai_suggested_parent=-1 is the no-suggestion
    sentinel (same convention as human_parent)."""

    def _row(self, classification=None, human_classification=None,
             parent_index=None, human_parent=None, human_is_root=None,
             ai_suggestion_status=None, ai_suggested_classification=None,
             ai_suggested_parent=None, ai_suggested_is_root=None):
        return {
            "classification": classification,
            "human_classification": human_classification,
            "parent_index": parent_index,
            "human_parent": human_parent,
            "human_is_root": human_is_root,
            "ai_suggestion_status": ai_suggestion_status,
            "ai_suggested_classification": ai_suggested_classification,
            "ai_suggested_parent": ai_suggested_parent,
            "ai_suggested_is_root": ai_suggested_is_root,
        }

    # -- classification layer --

    def test_ai_accepted_classification_used_when_no_human_override(self):
        eff = resolve_effective(self._row(
            classification="preamble", human_classification=None,
            ai_suggestion_status="Accepted", ai_suggested_classification="line_item",
        ))
        self.assertEqual(eff["effective_classification"], "line_item")

    def test_human_classification_beats_ai_accepted(self):
        eff = resolve_effective(self._row(
            classification="preamble", human_classification="note",
            ai_suggestion_status="Accepted", ai_suggested_classification="line_item",
        ))
        self.assertEqual(eff["effective_classification"], "note",
                         "human classification must beat an accepted AI suggestion")

    def test_ai_pending_does_not_apply(self):
        eff = resolve_effective(self._row(
            classification="preamble", human_classification=None,
            ai_suggestion_status="Pending", ai_suggested_classification="line_item",
        ))
        self.assertEqual(eff["effective_classification"], "preamble",
                         "a Pending AI suggestion must be ignored")

    def test_ai_rejected_does_not_apply(self):
        eff = resolve_effective(self._row(
            classification="preamble", human_classification=None,
            ai_suggestion_status="Rejected", ai_suggested_classification="line_item",
        ))
        self.assertEqual(eff["effective_classification"], "preamble",
                         "a Rejected AI suggestion must be ignored")

    # -- parent layer --

    def test_ai_accepted_parent_used_when_no_human_override(self):
        eff = resolve_effective(self._row(
            parent_index=7, human_parent=-1, human_is_root=0,
            ai_suggestion_status="Accepted", ai_suggested_parent=3,
        ))
        self.assertEqual(eff["effective_parent_index"], 3)

    def test_human_parent_beats_ai_accepted(self):
        eff = resolve_effective(self._row(
            parent_index=7, human_parent=5, human_is_root=0,
            ai_suggestion_status="Accepted", ai_suggested_parent=3,
        ))
        self.assertEqual(eff["effective_parent_index"], 5,
                         "human parent override must beat an accepted AI suggestion")

    def test_human_is_root_beats_ai_accepted(self):
        eff = resolve_effective(self._row(
            parent_index=7, human_parent=-1, human_is_root=1,
            ai_suggestion_status="Accepted", ai_suggested_parent=3,
        ))
        self.assertIsNone(eff["effective_parent_index"],
                          "human root must beat an accepted AI suggestion")

    def test_ai_parent_pending_does_not_apply(self):
        eff = resolve_effective(self._row(
            parent_index=7, human_parent=-1, human_is_root=0,
            ai_suggestion_status="Pending", ai_suggested_parent=3,
        ))
        self.assertEqual(eff["effective_parent_index"], 7,
                         "a Pending AI parent suggestion must be ignored (parser used)")

    def test_ai_parent_negative_sentinel_is_not_applied(self):
        eff = resolve_effective(self._row(
            parent_index=7, human_parent=-1, human_is_root=0,
            ai_suggestion_status="Accepted", ai_suggested_parent=-1,
        ))
        self.assertEqual(eff["effective_parent_index"], 7,
                         "ai_suggested_parent=-1 is 'no suggestion', not a root suggestion")

    # -- returned-dict shape + robustness --

    def test_ai_fields_present_in_returned_dict(self):
        eff = resolve_effective(self._row(
            classification="line_item",
            ai_suggestion_status="Accepted", ai_suggested_classification="preamble",
            ai_suggested_parent=2,
        ))
        self.assertIn("ai_suggestion_status", eff)
        self.assertIn("ai_suggested_classification", eff)
        self.assertIn("ai_suggested_parent", eff)
        self.assertEqual(eff["ai_suggestion_status"], "Accepted")
        self.assertEqual(eff["ai_suggested_classification"], "preamble")
        self.assertEqual(eff["ai_suggested_parent"], 2)

    def test_no_ai_fields_on_row_still_works(self):
        # No ai_* args -> all None; falls back to the parser layer cleanly.
        eff = resolve_effective(self._row(classification="preamble", parent_index=4))
        self.assertEqual(eff["effective_classification"], "preamble")
        self.assertEqual(eff["effective_parent_index"], 4)
        self.assertIsNone(eff["ai_suggestion_status"])
        self.assertIsNone(eff["ai_suggested_classification"])
        self.assertIsNone(eff["ai_suggested_parent"])

    def test_ai_accepted_both_classification_and_parent(self):
        eff = resolve_effective(self._row(
            classification="line_item", parent_index=5,
            human_classification=None, human_parent=-1, human_is_root=0,
            ai_suggestion_status="Accepted",
            ai_suggested_classification="preamble", ai_suggested_parent=2,
        ))
        self.assertEqual(eff["effective_classification"], "preamble")
        self.assertEqual(eff["effective_parent_index"], 2)

    # -- AI root suggestion (AI-2d) --

    def test_ai_accepted_root_suggestion_sets_effective_root(self):
        # AI_13: an accepted root suggestion forces effective_parent_index to None,
        # regardless of the parser parent_index and the -1 no-suggestion sentinel.
        eff = resolve_effective(self._row(
            parent_index=7, human_parent=-1, human_is_root=0,
            ai_suggestion_status="Accepted",
            ai_suggested_is_root=1, ai_suggested_parent=-1,
        ))
        self.assertIsNone(eff["effective_parent_index"],
                          "an accepted ai_suggested_is_root must make the row effective-root")

    def test_human_parent_beats_ai_root(self):
        # AI_14: a human row-override beats an accepted AI root suggestion.
        eff = resolve_effective(self._row(
            parent_index=7, human_parent=5, human_is_root=0,
            ai_suggestion_status="Accepted",
            ai_suggested_is_root=1, ai_suggested_parent=-1,
        ))
        self.assertEqual(eff["effective_parent_index"], 5,
                         "human_parent must beat an accepted AI root suggestion")

    def test_human_is_root_and_ai_root_both_root(self):
        # AI_15: human root + AI root -> None (human wins; same result either way).
        eff = resolve_effective(self._row(
            parent_index=7, human_parent=-1, human_is_root=1,
            ai_suggestion_status="Accepted",
            ai_suggested_is_root=1, ai_suggested_parent=-1,
        ))
        self.assertIsNone(eff["effective_parent_index"])

    def test_ai_root_pending_not_applied(self):
        # AI_16: a Pending root suggestion is ignored -> parser parent_index used.
        eff = resolve_effective(self._row(
            parent_index=7, human_parent=-1, human_is_root=0,
            ai_suggestion_status="Pending",
            ai_suggested_is_root=1, ai_suggested_parent=-1,
        ))
        self.assertEqual(eff["effective_parent_index"], 7,
                         "a Pending AI root suggestion must be ignored (parser used)")

    def test_ai_root_in_returned_dict(self):
        # AI_17: the flag is echoed in the returned dict, coerced to 1/0.
        eff = resolve_effective(self._row(
            classification="preamble",
            ai_suggestion_status="Accepted", ai_suggested_is_root=1,
        ))
        self.assertIn("ai_suggested_is_root", eff)
        self.assertEqual(eff["ai_suggested_is_root"], 1)
        eff0 = resolve_effective(self._row(classification="preamble"))
        self.assertEqual(eff0["ai_suggested_is_root"], 0,
                         "absent/None flag must coerce to 0 in the returned dict")

    def test_ai_real_parent_still_works_with_root_flag_false(self):
        # AI_18 (regression): the new branch must not break the real-parent path.
        eff = resolve_effective(self._row(
            parent_index=7, human_parent=-1, human_is_root=0,
            ai_suggestion_status="Accepted",
            ai_suggested_is_root=0, ai_suggested_parent=3,
        ))
        self.assertEqual(eff["effective_parent_index"], 3,
                         "a real AI parent (root flag false) must still apply")


# ===========================================================================
# Group 2: check_structural_integrity -- pure Python
# ===========================================================================

class TestCheckStructuralIntegrity(unittest.TestCase):
    """Verify the three structural integrity checks operate on EFFECTIVE values."""

    def _row(self, row_index, cls, parent=None, human_cls=None, human_parent=None):
        return {
            "row_index": row_index,
            "source_row_number": row_index + 2,
            "classification": cls,
            "human_classification": human_cls,
            "parent_index": parent,
            "human_parent": human_parent,
        }

    def test_clean_sheet_returns_empty(self):
        rows = [
            self._row(0, "preamble", parent=None),
            self._row(1, "line_item", parent=0),
            self._row(2, "line_item", parent=0),
        ]
        self.assertEqual(check_structural_integrity(rows), [])

    def test_orphan_line_item_flagged(self):
        rows = [self._row(0, "line_item", parent=None)]
        breaks = check_structural_integrity(rows)
        self.assertEqual(len(breaks), 1)
        self.assertEqual(breaks[0]["type"], "orphan")
        self.assertEqual(breaks[0]["row_index"], 0)

    def test_preamble_with_no_parent_is_not_orphan(self):
        """Root preambles (no parent) are valid top-level groups -- NOT flagged as orphans."""
        rows = [self._row(0, "preamble", parent=None)]
        self.assertEqual(check_structural_integrity(rows), [],
                         "A preamble with no parent must not be flagged as an orphan")

    def test_non_line_item_with_no_parent_is_not_orphan(self):
        """Only line_item classification triggers the orphan check."""
        for cls in ("note", "spacer", "subtotal_marker", "header_repeat"):
            with self.subTest(cls=cls):
                rows = [self._row(0, cls, parent=None)]
                self.assertEqual(check_structural_integrity(rows), [],
                                 f"{cls} with no parent must not be flagged as an orphan")

    def test_line_item_as_parent_flagged(self):
        rows = [
            self._row(0, "preamble", parent=None),
            self._row(1, "line_item", parent=0),
            self._row(2, "line_item", parent=1),  # parent is a line_item -> LINE_ITEM_AS_PARENT
        ]
        breaks = check_structural_integrity(rows)
        types = [b["type"] for b in breaks]
        self.assertIn("line_item_as_parent", types)
        lp = next(b for b in breaks if b["type"] == "line_item_as_parent")
        self.assertEqual(lp["row_index"], 2)
        self.assertEqual(lp["parent_row_index"], 1)

    def test_cycle_detected_for_all_cycle_members(self):
        """A 2-node cycle (0->1, 1->0) produces CYCLE breaks for both nodes."""
        rows = [
            self._row(0, "preamble", parent=1),
            self._row(1, "preamble", parent=0),
        ]
        breaks = check_structural_integrity(rows)
        cycle_row_indices = {b["row_index"] for b in breaks if b["type"] == "cycle"}
        self.assertIn(0, cycle_row_indices)
        self.assertIn(1, cycle_row_indices)

    def test_human_override_resolves_orphan(self):
        """
        A line_item that would be an orphan by parser values but has a valid
        human_parent -> effective parent is non-None -> not flagged as orphan.
        Under the -1 sentinel convention, human_parent=0 (>= 0) is unambiguously
        a real override without needing a separate flag field.
        """
        rows = [
            self._row(0, "preamble", parent=None),
            self._row(1, "line_item", parent=None, human_parent=0),
        ]
        self.assertEqual(check_structural_integrity(rows), [],
                         "human_parent override must prevent the orphan flag")

    def test_empty_rows_returns_empty(self):
        self.assertEqual(check_structural_integrity([]), [])


# ===========================================================================
# Group 3: append_edit_log_entry -- pure Python
# ===========================================================================

class TestAppendEditLogEntry(unittest.TestCase):
    """Verify append semantics for all input shapes."""

    def test_append_to_none_creates_single_entry_log(self):
        log = append_edit_log_entry(None, "human_classification",
                                    "preamble", "line_item", "admin@test")
        self.assertIsInstance(log, list)
        self.assertEqual(len(log), 1)
        entry = log[0]
        self.assertEqual(entry["field"], "human_classification")
        self.assertEqual(entry["from"], "preamble")
        self.assertEqual(entry["to"], "line_item")
        self.assertEqual(entry["by"], "admin@test")
        self.assertIn("at", entry)

    def test_append_to_existing_list_preserves_prior_entries(self):
        existing = [{"field": "qty_total", "from": 10.0, "to": 12.0,
                     "by": "x", "at": "2026-01-01 00:00:00"}]
        log = append_edit_log_entry(existing, "rate_supply", 100.0, 150.0, "user@test")
        self.assertEqual(len(log), 2)
        self.assertEqual(log[0]["field"], "qty_total", "prior entry must be preserved")
        self.assertEqual(log[1]["field"], "rate_supply")
        self.assertEqual(log[1]["to"], 150.0)

    def test_append_to_json_string_input(self):
        """existing_log as a JSON-encoded string must be parsed then appended."""
        existing_str = json.dumps([{
            "field": "human_parent", "from": None, "to": 2, "by": "u", "at": "t"
        }])
        log = append_edit_log_entry(existing_str, "human_parent", 2, 3, "u2")
        self.assertEqual(len(log), 2)
        self.assertEqual(log[0]["field"], "human_parent")
        self.assertEqual(log[1]["to"], 3)

    def test_does_not_mutate_input_list(self):
        """The input list must not be modified in place."""
        original = [{"field": "a", "from": 1, "to": 2, "by": "u",
                     "at": "2026-01-01 00:00:00"}]
        append_edit_log_entry(original, "b", 3, 4, "u")
        self.assertEqual(len(original), 1,
                         "append_edit_log_entry must return a new list, not mutate the input")

    def test_reason_stored_as_sixth_key_when_supplied(self):
        """Slice C-v1: a supplied reason is carried as the 6th entry key."""
        log = append_edit_log_entry(None, "qty_total", 10.0, 12.0, "u",
                                    "corrected from drawing")
        entry = log[0]
        self.assertEqual(entry["reason"], "corrected from drawing")
        # The other five keys are unchanged.
        self.assertEqual(entry["field"], "qty_total")
        self.assertEqual(entry["from"], 10.0)
        self.assertEqual(entry["to"], 12.0)
        self.assertEqual(entry["by"], "u")
        self.assertIn("at", entry)

    def test_reason_key_present_and_none_when_absent(self):
        """Uniform entry shape: the reason key is always present, None when not supplied."""
        log = append_edit_log_entry(None, "qty_total", 10.0, 12.0, "u")
        entry = log[0]
        self.assertIn("reason", entry, "reason key must always be present (uniform shape)")
        self.assertIsNone(entry["reason"], "reason must be None when not supplied")


# ===========================================================================
# Group 4: get_review_rows -- DB
# ===========================================================================

class TestGetReviewRows(FrappeTestCase):
    """
    Verifies that get_review_rows returns rows in row_index order, attaches
    effective values, parses JSON list fields to Python objects, and includes
    the work_packages key.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Review Rows Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "GRSheet", "sheet_order": 1, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name
        cls.sheet_name = "GRSheet"

        # Insert 3 rows in REVERSE order to confirm the endpoint sorts by row_index.
        # Row 0 has a human_classification override to verify effective values.
        _insert_rows(cls.boq_name, [
            _minimal_row(cls.sheet_name, 2, "line_item", parent_index=0),
            _minimal_row(cls.sheet_name, 0, "preamble", parent_index=None,
                         human_classification="line_item"),
            {
                **_minimal_row(cls.sheet_name, 1, "preamble", parent_index=None),
                "validation_warnings": ["warn_on_row1"],
            },
        ])

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def test_rows_returned_in_row_index_order(self):
        result = get_review_rows(boq_name=self.boq_name, sheet_name=self.sheet_name)
        indices = [r["row_index"] for r in result["rows"]]
        self.assertEqual(indices, sorted(indices),
                         "rows must be sorted by row_index (Excel order)")
        self.assertEqual(indices, [0, 1, 2])

    def test_effective_values_attached(self):
        result = get_review_rows(boq_name=self.boq_name, sheet_name=self.sheet_name)
        row0 = next(r for r in result["rows"] if r["row_index"] == 0)
        self.assertEqual(row0["effective_classification"], "line_item",
                         "human_classification override must be reflected in effective_classification")
        self.assertEqual(row0["classification"], "preamble",
                         "parser classification must still be present")

    def test_json_list_fields_returned_as_python_lists(self):
        result = get_review_rows(boq_name=self.boq_name, sheet_name=self.sheet_name)
        row1 = next(r for r in result["rows"] if r["row_index"] == 1)
        vw = row1.get("validation_warnings")
        if isinstance(vw, str):
            vw = json.loads(vw)
        self.assertIsInstance(vw, list)
        self.assertIn("warn_on_row1", vw)

    def test_work_packages_key_present_and_is_list(self):
        """The response must include a work_packages list (empty when none assigned)."""
        result = get_review_rows(boq_name=self.boq_name, sheet_name=self.sheet_name)
        self.assertIn("work_packages", result,
                      "response must contain a 'work_packages' key")
        self.assertIsInstance(result["work_packages"], list,
                              "work_packages must be a list")

    def test_flags_key_present_and_contains_known_flag(self):
        """get_review_rows response includes 'flags' (Slice B2a single-source fix).
        Row 0 has human_classification='line_item' + no parent -> orphan advisory flag."""
        result = get_review_rows(boq_name=self.boq_name, sheet_name=self.sheet_name)
        self.assertIn("flags", result, "response must contain a 'flags' key")
        self.assertIsInstance(result["flags"], list, "flags must be a list")
        orphan_flags = [f for f in result["flags"] if f["type"] == "orphan" and f["row_index"] == 0]
        self.assertEqual(len(orphan_flags), 1,
                         "row 0 (human_classification=line_item, no parent) must produce an orphan flag")


# ===========================================================================
# Group 5: save_review_edit -- DB
# ===========================================================================

class TestSaveReviewEdit(FrappeTestCase):
    """
    Verifies field-level validation, edit_log accumulation, edited_by/at stamping,
    and the cycle + self-parent guards on human_parent.

    Fixture rows per test (reset by setUp):
      Row 0 -- preamble, parent=None      (root)
      Row 1 -- preamble, parent=0         (child of 0)
      Row 2 -- line_item, parent=1        (child of 1)

    Cycle case: setting row 0's parent to 2 creates 0->2->1->0.
    Valid case: setting row 2's parent to 0 gives 2->0->None (no cycle).
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Save Edit Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "EditSheet", "sheet_order": 1, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name
        cls.sheet_name = "EditSheet"

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name})
        frappe.db.commit()
        _insert_rows(self.boq_name, [
            _minimal_row(self.sheet_name, 0, "preamble", parent_index=None),
            _minimal_row(self.sheet_name, 1, "preamble", parent_index=0),
            _minimal_row(self.sheet_name, 2, "line_item", parent_index=1),
        ])

    def _get_doc(self, row_index: int):
        name = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.boq_name, "sheet_name": self.sheet_name, "row_index": row_index},
            "name",
        )
        return frappe.get_doc("BoQ Review Row", name)

    def test_valid_human_classification_set(self):
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="human_classification", value="line_item",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["field"], "human_classification")
        doc = self._get_doc(0)
        self.assertEqual(doc.human_classification, "line_item")
        self.assertEqual(result["effective"]["effective_classification"], "line_item")

    def test_edit_log_grows_on_each_edit(self):
        save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="human_classification", value="line_item",
        )
        doc = self._get_doc(0)
        log = doc.edit_log
        if isinstance(log, str):
            log = json.loads(log)
        self.assertIsInstance(log, list)
        self.assertEqual(len(log), 1)
        self.assertEqual(log[0]["field"], "human_classification")
        self.assertEqual(log[0]["to"], "line_item")

    def test_edited_by_and_at_stamped(self):
        save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="human_classification", value="note",
        )
        doc = self._get_doc(0)
        self.assertIsNotNone(doc.edited_by, "edited_by must be stamped after an edit")
        self.assertIsNotNone(doc.edited_at, "edited_at must be stamped after an edit")

    def test_reason_persisted_into_latest_edit_log_entry(self):
        """Slice C-v1: a reason passed to save_review_edit lands on the new edit_log entry."""
        save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="human_classification", value="line_item",
            reason="reclassified per spec review",
        )
        doc = self._get_doc(0)
        log = doc.edit_log
        if isinstance(log, str):
            log = json.loads(log)
        self.assertEqual(log[-1]["reason"], "reclassified per spec review")

    def test_reason_none_when_omitted(self):
        """Slice C-v1: omitting reason stores None (uniform shape, no writer yet)."""
        save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="human_classification", value="line_item",
        )
        doc = self._get_doc(0)
        log = doc.edit_log
        if isinstance(log, str):
            log = json.loads(log)
        self.assertIn("reason", log[-1])
        self.assertIsNone(log[-1]["reason"])

    def test_blank_reason_normalized_to_none(self):
        """Slice C-v1: a whitespace-only reason is normalized to None."""
        save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="human_classification", value="line_item",
            reason="   ",
        )
        doc = self._get_doc(0)
        log = doc.edit_log
        if isinstance(log, str):
            log = json.loads(log)
        self.assertIsNone(log[-1]["reason"])

    def test_return_includes_non_empty_edited_at(self):
        """Slice C-v1: the save return dict now carries a server edited_at timestamp."""
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="human_classification", value="line_item",
        )
        self.assertIn("edited_at", result, "save return must include edited_at")
        self.assertTrue(result["edited_at"], "edited_at must be non-empty after a save")

    def test_invalid_classification_rejected(self):
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, field="human_classification", value="totally_invalid_class",
            )
        # Document must be unchanged
        doc = self._get_doc(0)
        self.assertFalse(doc.human_classification,
                         "invalid classification must leave the doc unchanged")

    def test_human_parent_self_parent_rejected(self):
        """A row cannot be its own parent (row 0 -> human_parent=0)."""
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, field="human_parent", value=0,
            )

    def test_human_parent_cycle_rejected(self):
        """
        Setting row 0's human_parent to 2 creates chain 0->2->1->0 (cycle).
        The cycle guard must hard-reject this.
        """
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, field="human_parent", value=2,
            )
        # Row 0 must remain unmodified: no human-parent override in place.
        # -1 is the no-override sentinel (written by _minimal_row on insert).
        doc = self._get_doc(0)
        self.assertEqual(doc.human_parent, -1,
                         "human_parent must be -1 (no override) when cycle is rejected")

    def test_valid_human_parent_accepted(self):
        """
        Set row 2's human_parent to 0 -- chain: 2->0->None (no cycle).
        Effective parent_index must update accordingly.
        """
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=2, field="human_parent", value=0,
        )
        self.assertTrue(result["ok"])
        doc = self._get_doc(2)
        self.assertEqual(doc.human_parent, 0)
        self.assertEqual(result["effective"]["effective_parent_index"], 0)

    # -- Slice C-v2b: inline text-editing for unit + make_model --

    def test_edit_unit_persists_string_verbatim(self):
        """Editing `unit` stores the string verbatim (NO float coercion),
        stamps edited_at, and appends an edit_log entry with field='unit'."""
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="unit", value="sqm",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["field"], "unit")
        self.assertEqual(result["to"], "sqm",
                         "the string must be returned verbatim, not coerced")
        doc = self._get_doc(0)
        self.assertEqual(doc.unit, "sqm",
                         "unit must persist the string verbatim")
        self.assertIsNotNone(doc.edited_at, "edited_at must be stamped on a text edit")
        log = doc.edit_log
        if isinstance(log, str):
            log = json.loads(log)
        self.assertEqual(log[-1]["field"], "unit")
        self.assertEqual(log[-1]["to"], "sqm")

    def test_edit_make_model_persists_string(self):
        """Editing `make_model` persists the string, stamps edited_at, and logs."""
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, field="make_model", value="Havells / X200",
        )
        self.assertTrue(result["ok"])
        doc = self._get_doc(1)
        self.assertEqual(doc.make_model, "Havells / X200")
        self.assertIsNotNone(doc.edited_at)
        log = doc.edit_log
        if isinstance(log, str):
            log = json.loads(log)
        self.assertEqual(log[-1]["field"], "make_model")
        self.assertEqual(log[-1]["to"], "Havells / X200")

    def test_text_blank_clears_to_none(self):
        """A blank string clears a text field to None (mirrors numeric blank-clear)."""
        # First set a value, then clear it with "".
        save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="unit", value="kg",
        )
        self.assertEqual(self._get_doc(0).unit, "kg")
        save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="unit", value="",
        )
        self.assertIsNone(self._get_doc(0).unit,
                          "blank string must clear the text field to None")

    def test_description_edit_still_rejected(self):
        """description is NOT in the allowed-edit set -- editing it must throw."""
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, field="description", value="should not work",
            )

    def test_row_notes_edit_still_rejected(self):
        """row_notes is NOT in the allowed-edit set -- editing it must throw."""
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, field="row_notes", value="should not work",
            )

    def test_numeric_field_still_rejects_non_numeric_string(self):
        """The float() path for numeric fields is unchanged: a non-numeric string
        must still throw 'must be a number' (text path must not catch these)."""
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, field="qty_total", value="not_a_number",
            )


# ===========================================================================
# Group 5b: save_review_remark -- DB (Slice C-v2c)
# ===========================================================================

class TestSaveReviewRemark(FrappeTestCase):
    """
    Verifies the SEPARATE remark write path (Slice C-v2c):
      - a remark persists to the remarks field;
      - it does NOT set edited_at and does NOT append to edit_log (row stays "Original");
      - blank/whitespace clears to None;
      - the 250-char cap is enforced (251 rejected, exactly-250 accepted);
      - save_review_edit still stamps edited_at (the two paths are independent).

    Fixture rows per test (reset by setUp):
      Row 0 -- preamble, parent=None  (root)
      Row 1 -- preamble, parent=0     (child of 0)
      Row 2 -- line_item, parent=1    (child of 1)
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Remark Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "RemarkSheet", "sheet_order": 1, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name
        cls.sheet_name = "RemarkSheet"

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name})
        frappe.db.commit()
        _insert_rows(self.boq_name, [
            _minimal_row(self.sheet_name, 0, "preamble", parent_index=None),
            _minimal_row(self.sheet_name, 1, "preamble", parent_index=0),
            _minimal_row(self.sheet_name, 2, "line_item", parent_index=1),
        ])

    def _get_doc(self, row_index: int):
        name = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.boq_name, "sheet_name": self.sheet_name, "row_index": row_index},
            "name",
        )
        return frappe.get_doc("BoQ Review Row", name)

    def test_remark_persists_and_does_not_touch_provenance(self):
        """THE key test: a remark persists but leaves the row 'Original' --
        edited_at stays None and edit_log stays empty (no edit_log entry)."""
        result = save_review_remark(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, remark="Check this quantity against the drawing.",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["row_index"], 0)
        self.assertEqual(result["remarks"], "Check this quantity against the drawing.")

        doc = self._get_doc(0)
        self.assertEqual(doc.remarks, "Check this quantity against the drawing.",
                         "the remark must persist verbatim to the remarks field")
        self.assertIsNone(doc.edited_at,
                          "a remark must NOT stamp edited_at (row stays Original)")
        log = doc.edit_log
        if isinstance(log, str):
            log = json.loads(log) if log else []
        self.assertIn(log, ([], None),
                      "a remark must NOT append an edit_log entry")

    def test_blank_remark_clears_to_none(self):
        """A blank/whitespace-only remark clears the field to None."""
        save_review_remark(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, remark="temporary note",
        )
        self.assertEqual(self._get_doc(0).remarks, "temporary note")
        save_review_remark(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, remark="   ",
        )
        self.assertIsNone(self._get_doc(0).remarks,
                          "a whitespace-only remark must clear the field to None")

    def test_remark_exactly_250_accepted(self):
        """A remark of exactly 250 chars is accepted and persisted."""
        text = "x" * 250
        result = save_review_remark(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, remark=text,
        )
        self.assertTrue(result["ok"])
        doc = self._get_doc(1)
        self.assertEqual(len(doc.remarks), 250)
        self.assertEqual(doc.remarks, text)

    def test_remark_251_rejected_and_not_written(self):
        """A remark of 251 chars is rejected (throw) and the field is not written."""
        with self.assertRaises(frappe.ValidationError):
            save_review_remark(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=1, remark="y" * 251,
            )
        self.assertIsNone(self._get_doc(1).remarks,
                          "an over-cap remark must leave the field unwritten")

    def test_value_edit_still_stamps_edited_at(self):
        """Sanity / separation: save_review_edit still stamps edited_at, proving the
        remark path and the edit path are independent."""
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=2, field="qty_total", value=7,
        )
        self.assertTrue(result["ok"])
        doc = self._get_doc(2)
        self.assertIsNotNone(doc.edited_at,
                             "a value edit must still stamp edited_at (path is separate from remarks)")
        self.assertEqual(doc.qty_total, 7.0)


# ===========================================================================
# Group 5b2: dismiss_row_flags -- DB (C-flag-dismissal)
# ===========================================================================

class TestDismissRowFlags(FrappeTestCase):
    """
    Verifies the per-row "Looks OK" flag-dismissal path (C-flag-dismissal):
      - dismiss sets flags_dismissed=1 + by/at, and the row STAYS "Original"
        (edited_at None, edit_log empty -- mirrors the remark contract);
      - un-dismiss (falsy) clears all three fields;
      - a subsequent save_review_edit on a dismissed row CLEARS the dismissal
        (the _apply_and_save_row_edit chokepoint -- decision 3a, edit re-opens);
      - a save_review_restructure on a dismissed row clears it (same chokepoint);
      - a save_review_remark on a dismissed row does NOT clear it (the bypass --
        a remark must not re-open);
      - get_review_rows carries the 3 fields on the row payload.

    Fixture rows per test (reset by setUp):
      Row 0 -- preamble, parent=None  (root)
      Row 1 -- preamble, parent=0     (child of 0)
      Row 2 -- line_item, parent=1    (child of 1)
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Dismiss Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "DismissSheet", "sheet_order": 1, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name
        cls.sheet_name = "DismissSheet"

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name})
        frappe.db.commit()
        _insert_rows(self.boq_name, [
            _minimal_row(self.sheet_name, 0, "preamble", parent_index=None),
            _minimal_row(self.sheet_name, 1, "preamble", parent_index=0),
            _minimal_row(self.sheet_name, 2, "line_item", parent_index=1),
        ])

    def _get_doc(self, row_index: int):
        name = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.boq_name, "sheet_name": self.sheet_name, "row_index": row_index},
            "name",
        )
        return frappe.get_doc("BoQ Review Row", name)

    def _edit_log_list(self, doc):
        log = doc.edit_log
        if isinstance(log, str):
            log = json.loads(log) if log else []
        return log or []

    def test_dismiss_sets_fields_and_row_stays_original(self):
        """THE key test: dismissing stamps flags_dismissed + by/at but leaves the row
        'Original' -- edited_at stays None and edit_log stays empty."""
        result = dismiss_row_flags(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=2, dismissed=True,
        )
        self.assertEqual(result, {"flags_dismissed": 1})

        doc = self._get_doc(2)
        self.assertEqual(doc.flags_dismissed, 1, "flags_dismissed must be set to 1")
        self.assertTrue(doc.flags_dismissed_by, "flags_dismissed_by must be stamped")
        self.assertTrue(doc.flags_dismissed_at, "flags_dismissed_at must be stamped")
        self.assertIsNone(doc.edited_at,
                          "a dismissal must NOT stamp edited_at (row stays Original)")
        self.assertEqual(self._edit_log_list(doc), [],
                         "a dismissal must NOT append an edit_log entry")

    def test_undismiss_clears_all_three(self):
        """Un-dismiss (dismissed falsy) clears flags_dismissed + by + at."""
        dismiss_row_flags(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=2, dismissed=True,
        )
        self.assertEqual(self._get_doc(2).flags_dismissed, 1)

        result = dismiss_row_flags(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=2, dismissed=False,
        )
        self.assertEqual(result, {"flags_dismissed": 0})
        doc = self._get_doc(2)
        self.assertEqual(doc.flags_dismissed, 0, "flags_dismissed must clear to 0")
        self.assertIsNone(doc.flags_dismissed_by, "flags_dismissed_by must clear")
        self.assertIsNone(doc.flags_dismissed_at, "flags_dismissed_at must clear")

    def test_value_edit_reopens_dismissal(self):
        """decision 3a: a save_review_edit on a dismissed row CLEARS flags_dismissed
        (the shared _apply_and_save_row_edit chokepoint)."""
        dismiss_row_flags(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=2, dismissed=True,
        )
        self.assertEqual(self._get_doc(2).flags_dismissed, 1)

        save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=2, field="qty_total", value=9,
        )
        doc = self._get_doc(2)
        self.assertEqual(doc.flags_dismissed, 0,
                         "an edit must re-open the dismissal (chokepoint clear)")
        self.assertIsNone(doc.flags_dismissed_by)
        self.assertIsNone(doc.flags_dismissed_at)
        self.assertIsNotNone(doc.edited_at, "the edit itself still stamps edited_at")

    def test_restructure_reopens_dismissal(self):
        """A save_review_restructure (reclassify) on a dismissed row clears the
        dismissal -- it funnels through the SAME chokepoint."""
        dismiss_row_flags(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, dismissed=True,
        )
        self.assertEqual(self._get_doc(0).flags_dismissed, 1)

        # Reclassify row 0 (assignable target); empty child_moves leaves children put.
        save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, new_classification="line_item", child_moves={},
        )
        doc = self._get_doc(0)
        self.assertEqual(doc.flags_dismissed, 0,
                         "a restructure must re-open the dismissal (same chokepoint)")
        self.assertIsNone(doc.flags_dismissed_by)
        self.assertIsNone(doc.flags_dismissed_at)

    def test_remark_does_not_reopen_dismissal(self):
        """THE bypass test: a save_review_remark on a dismissed row does NOT clear the
        dismissal (a remark must not re-open it -- it skips the chokepoint)."""
        dismiss_row_flags(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=2, dismissed=True,
        )
        self.assertEqual(self._get_doc(2).flags_dismissed, 1)

        save_review_remark(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=2, remark="a note that must not re-open the dismissal",
        )
        doc = self._get_doc(2)
        self.assertEqual(doc.flags_dismissed, 1,
                         "a remark must NOT re-open the dismissal (chokepoint bypassed)")
        self.assertTrue(doc.flags_dismissed_by, "the dismissal attribution must survive a remark")
        self.assertEqual(doc.remarks, "a note that must not re-open the dismissal")

    def test_get_review_rows_carries_dismissal_fields(self):
        """get_review_rows must return the 3 dismissal fields on each row payload."""
        dismiss_row_flags(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, dismissed=True,
        )
        resp = get_review_rows(boq_name=self.boq_name, sheet_name=self.sheet_name)
        rows_by_idx = {r["row_index"]: r for r in resp["rows"]}
        for idx in (0, 1, 2):
            self.assertIn("flags_dismissed", rows_by_idx[idx])
            self.assertIn("flags_dismissed_by", rows_by_idx[idx])
            self.assertIn("flags_dismissed_at", rows_by_idx[idx])
        self.assertEqual(rows_by_idx[1]["flags_dismissed"], 1,
                         "the dismissed row reports flags_dismissed=1 in the payload")
        self.assertEqual(rows_by_idx[0]["flags_dismissed"], 0,
                         "an un-dismissed row reports flags_dismissed=0")


# ===========================================================================
# Group 5c: save_review_edit per-area editing -- DB (Slice C-v2d)
# ===========================================================================

class TestSaveReviewEditPerArea(FrappeTestCase):
    """
    Verifies the per-area JSON write path on save_review_edit (Slice C-v2d; amount made
    nested in Slice 2b):
      - FLAT one-hop field (qty_by_area): set one area cell, key stays;
      - NESTED two-hop fields (rate_by_area + amount_by_area, with rate_subkey carrying the
        inner kind): set one inner kind, the area's other kinds + other areas stay intact;
      - blank value -> 0.0 with the key kept (NEVER deleted);
      - structured edit_log entry carries area (+ rate_subkey for the nested fields);
      - provenance (edited_at) is stamped exactly like a flat edit;
      - validation: nonexistent area / missing subkey / illegal subkey rejected
        (per-field legal-kind set: rate kinds for rate, amount kinds for amount);
      - the flat-field path (area=None) is unchanged (regression) and its edit_log entry
        carries NO area / rate_subkey keys (old entries stay valid).

    Fixture rows per test (reset by setUp):
      Row 0 -- line_item, parent=None, with qty_by_area / amount_by_area / rate_by_area.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Per-Area Edit Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "AreaSheet", "sheet_order": 1, "wizard_status": "Parsed",
            # C-v2d-fix: per-area edits now validate the sent area against this sheet's
            # defined area_dimensions (sheet_config), so the fixture must declare them.
            "sheet_config": json.dumps({"area_dimensions": ["Zone A", "Zone B"]}),
        })
        boq.append("sheet_drafts", {
            # No sheet_config -> no defined areas -> per-area edits must be rejected.
            "sheet_name": "NoDimSheet", "sheet_order": 2, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name
        cls.sheet_name = "AreaSheet"
        cls.no_dim_sheet = "NoDimSheet"

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name})
        frappe.db.commit()
        row = _minimal_row(self.sheet_name, 0, "line_item", parent_index=None)
        # Per-area JSON dict fields (passed as Python dicts -- NOT pre-serialized;
        # they are dict-JSON, not list-JSON, so _insert_rows leaves them alone).
        row["qty_by_area"] = {"Zone A": 10.0, "Zone B": 20.0}
        # amount_by_area is NESTED two-hop (field-set Slice 2b), mirroring rate_by_area.
        row["amount_by_area"] = {
            "Zone A": {"supply": 40.0, "install": 60.0, "total": 100.0},
            "Zone B": {"total": 200.0},
        }
        row["rate_by_area"] = {
            "Zone A": {"supply_rate": 5.0, "install_rate": 3.0, "combined_rate": 8.0},
            "Zone B": {"combined_rate": 12.0},
        }
        _insert_rows(self.boq_name, [row])

    def _get_doc(self, row_index: int):
        name = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.boq_name, "sheet_name": self.sheet_name, "row_index": row_index},
            "name",
        )
        return frappe.get_doc("BoQ Review Row", name)

    @staticmethod
    def _as_dict(v):
        return json.loads(v) if isinstance(v, str) else v

    # -- flat per-area (qty / amount) --

    def test_qty_by_area_sets_one_cell_key_stays(self):
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="qty_by_area", value=15, area="Zone A",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["field"], "qty_by_area")
        self.assertEqual(result["area"], "Zone A")
        self.assertIsNone(result["rate_subkey"])
        self.assertEqual(result["to"], 15.0)
        self.assertEqual(result["from"], 10.0, "from must be the per-area value before the edit")
        doc = self._get_doc(0)
        qba = self._as_dict(doc.qty_by_area)
        self.assertEqual(qba["Zone A"], 15.0, "edited cell updated")
        self.assertEqual(qba["Zone B"], 20.0, "other area must be untouched")
        self.assertIsNotNone(doc.edited_at, "a per-area edit must stamp edited_at")
        log = self._as_dict(doc.edit_log)
        self.assertEqual(log[-1]["field"], "qty_by_area")
        self.assertEqual(log[-1]["area"], "Zone A")
        self.assertNotIn("rate_subkey", log[-1],
                         "a flat per-area entry must not carry rate_subkey")
        self.assertEqual(log[-1]["to"], 15.0)

    def test_amount_by_area_sets_one_subkey_others_intact(self):
        """Slice 2b: a per-area amount edit is two-hop -- it writes ONE kind and leaves the
        area's OTHER kinds AND the OTHER areas intact. This is the B2 anti-corruption proof
        (the old flat one-hop write clobbered the whole nested area dict with a bare float)."""
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="amount_by_area", value=250,
            area="Zone A", rate_subkey="supply",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["area"], "Zone A")
        self.assertEqual(result["rate_subkey"], "supply")
        self.assertEqual(result["from"], 40.0, "from must be the inner kind value before the edit")
        doc = self._get_doc(0)
        aba = self._as_dict(doc.amount_by_area)
        self.assertEqual(aba["Zone A"]["supply"], 250.0, "edited kind updated")
        self.assertEqual(aba["Zone A"]["install"], 60.0, "other kind in the area intact")
        self.assertEqual(aba["Zone A"]["total"], 100.0, "other kind in the area intact")
        self.assertEqual(aba["Zone B"]["total"], 200.0, "other area intact")
        log = self._as_dict(doc.edit_log)
        self.assertEqual(log[-1]["field"], "amount_by_area")
        self.assertEqual(log[-1]["area"], "Zone A")
        self.assertEqual(log[-1]["rate_subkey"], "supply")

    # -- nested per-area (rate) --

    def test_rate_by_area_sets_one_subkey_others_intact(self):
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="rate_by_area", value=9.5,
            area="Zone A", rate_subkey="combined_rate",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["area"], "Zone A")
        self.assertEqual(result["rate_subkey"], "combined_rate")
        self.assertEqual(result["from"], 8.0, "from must be the inner value before the edit")
        doc = self._get_doc(0)
        rba = self._as_dict(doc.rate_by_area)
        self.assertEqual(rba["Zone A"]["combined_rate"], 9.5, "edited subkey updated")
        self.assertEqual(rba["Zone A"]["supply_rate"], 5.0, "other subkey intact")
        self.assertEqual(rba["Zone A"]["install_rate"], 3.0, "other subkey intact")
        self.assertEqual(rba["Zone B"]["combined_rate"], 12.0, "other area intact")
        log = self._as_dict(doc.edit_log)
        self.assertEqual(log[-1]["field"], "rate_by_area")
        self.assertEqual(log[-1]["area"], "Zone A")
        self.assertEqual(log[-1]["rate_subkey"], "combined_rate")

    # -- blank -> 0.0 key stays --

    def test_blank_sets_zero_key_not_deleted(self):
        save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="qty_by_area", value="", area="Zone A",
        )
        doc = self._get_doc(0)
        qba = self._as_dict(doc.qty_by_area)
        self.assertIn("Zone A", qba, "blank must NOT delete the area key")
        self.assertEqual(qba["Zone A"], 0.0, "blank must set the value to 0.0")

    def test_blank_rate_subkey_sets_zero_key_stays(self):
        save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="rate_by_area", value="",
            area="Zone A", rate_subkey="supply_rate",
        )
        doc = self._get_doc(0)
        rba = self._as_dict(doc.rate_by_area)
        self.assertEqual(rba["Zone A"]["supply_rate"], 0.0)
        self.assertEqual(rba["Zone A"]["combined_rate"], 8.0, "other subkey untouched")

    # -- validation --

    def test_nonexistent_area_rejected(self):
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, field="qty_by_area", value=5, area="Zone Z",
            )
        doc = self._get_doc(0)
        qba = self._as_dict(doc.qty_by_area)
        self.assertNotIn("Zone Z", qba, "a rejected edit must not create the area")
        self.assertIsNone(doc.edited_at, "a rejected edit must not stamp edited_at")

    def test_rate_without_rate_subkey_rejected(self):
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, field="rate_by_area", value=9.5, area="Zone A",
            )

    def test_illegal_rate_subkey_rejected(self):
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, field="rate_by_area", value=9.5,
                area="Zone A", rate_subkey="bogus_rate",
            )

    def test_amount_without_subkey_rejected(self):
        """Slice 2b: amount_by_area is now nested -- an edit with NO subkey is rejected."""
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, field="amount_by_area", value=250, area="Zone A",
            )

    def test_illegal_amount_subkey_rejected(self):
        """A subkey not in {supply, install, total} is rejected for amount_by_area.
        Uses 'combined_rate' -- a legal RATE kind but NOT a legal amount kind, proving the
        per-field legal-subkey selection (rate set is not accepted for amount)."""
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, field="amount_by_area", value=250,
                area="Zone A", rate_subkey="combined_rate",
            )

    def test_non_area_field_with_area_rejected(self):
        """A non-per-area field passed WITH an area is rejected (qty_total is flat-only)."""
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, field="qty_total", value=5, area="Zone A",
            )

    # -- flat-field regression (area=None) --

    def test_flat_field_path_unchanged_when_area_none(self):
        """With area=None the flat numeric path is unchanged; its edit_log entry
        carries NO area / rate_subkey keys (old flat entries stay valid)."""
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="qty_total", value=42,
        )
        self.assertTrue(result["ok"])
        self.assertIsNone(result["area"])
        self.assertIsNone(result["rate_subkey"])
        doc = self._get_doc(0)
        self.assertEqual(doc.qty_total, 42.0)
        log = self._as_dict(doc.edit_log)
        self.assertEqual(log[-1]["field"], "qty_total")
        self.assertNotIn("area", log[-1], "a flat-field entry must omit the area key")
        self.assertNotIn("rate_subkey", log[-1], "a flat-field entry must omit rate_subkey")

    # -- C-v2d-fix: key creation on a DEFINED-but-empty area (validate against
    #    sheet_config.area_dimensions, not the row's existing dict keys) --

    def _reset_row_with_empty_areas(self):
        """Reset row 0 on AreaSheet with EMPTY per-area dicts (no keys present)."""
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name})
        frappe.db.commit()
        row = _minimal_row(self.sheet_name, 0, "line_item", parent_index=None)
        row["qty_by_area"] = {}
        row["amount_by_area"] = {}
        row["rate_by_area"] = {}
        _insert_rows(self.boq_name, [row])

    def test_qty_create_key_on_defined_empty_area(self):
        """qty_by_area={}, area IS in area_dimensions -> write SUCCEEDS, key created,
        edited_at stamped, structured entry has area + from=None."""
        self._reset_row_with_empty_areas()
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="qty_by_area", value=15, area="Zone A",
        )
        self.assertTrue(result["ok"])
        self.assertIsNone(result["from"], "from must be None for a newly-created key")
        self.assertEqual(result["to"], 15.0)
        doc = self._get_doc(0)
        qba = self._as_dict(doc.qty_by_area)
        self.assertEqual(qba["Zone A"], 15.0, "key created + value set")
        self.assertIsNotNone(doc.edited_at, "a per-area edit must stamp edited_at")
        log = self._as_dict(doc.edit_log)
        self.assertEqual(log[-1]["area"], "Zone A")
        self.assertIsNone(log[-1]["from"], "newly-created key records from=None")

    def test_amount_create_key_on_defined_area(self):
        """amount_by_area={}, area IS in area_dimensions -> nested key path created (Slice 2b)."""
        self._reset_row_with_empty_areas()
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="amount_by_area", value=250,
            area="Zone B", rate_subkey="total",
        )
        self.assertTrue(result["ok"])
        self.assertIsNone(result["from"], "from must be None for a newly-created nested key")
        doc = self._get_doc(0)
        aba = self._as_dict(doc.amount_by_area)
        self.assertEqual(aba["Zone B"]["total"], 250.0, "nested key created + value set")

    def test_rate_create_path_on_defined_area(self):
        """rate_by_area has Zone A only; creating Zone B's combined_rate builds the
        nested path and leaves the existing area/subkey intact."""
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name})
        frappe.db.commit()
        row = _minimal_row(self.sheet_name, 0, "line_item", parent_index=None)
        row["qty_by_area"] = {}
        row["amount_by_area"] = {}
        row["rate_by_area"] = {"Zone A": {"supply_rate": 5.0}}
        _insert_rows(self.boq_name, [row])
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, field="rate_by_area", value=9.5,
            area="Zone B", rate_subkey="combined_rate",
        )
        self.assertTrue(result["ok"])
        self.assertIsNone(result["from"], "newly-created subkey -> from=None")
        doc = self._get_doc(0)
        rba = self._as_dict(doc.rate_by_area)
        self.assertEqual(rba["Zone B"]["combined_rate"], 9.5, "nested path created")
        self.assertEqual(rba["Zone A"]["supply_rate"], 5.0, "other area preserved")
        log = self._as_dict(doc.edit_log)
        self.assertEqual(log[-1]["area"], "Zone B")
        self.assertEqual(log[-1]["rate_subkey"], "combined_rate")

    def test_reject_area_not_in_area_dimensions(self):
        """An area NOT in the sheet's area_dimensions is rejected even with an EMPTY
        dict -- proving the guard validates against area_dimensions, not row keys."""
        self._reset_row_with_empty_areas()
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, field="qty_by_area", value=5, area="Zone Z",
            )
        doc = self._get_doc(0)
        qba = self._as_dict(doc.qty_by_area)
        self.assertNotIn("Zone Z", qba, "a rejected edit must not create the area")
        self.assertIsNone(doc.edited_at, "a rejected edit must not stamp edited_at")

    def test_reject_when_no_area_dimensions(self):
        """A sheet whose draft has no sheet_config (no area_dimensions) rejects any
        per-area edit with a clear error; nothing is written."""
        frappe.db.delete(
            "BoQ Review Row", {"boq": self.boq_name, "sheet_name": self.no_dim_sheet})
        frappe.db.commit()
        row = _minimal_row(self.no_dim_sheet, 0, "line_item", parent_index=None)
        row["qty_by_area"] = {"Zone A": 10.0}
        _insert_rows(self.boq_name, [row])
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.no_dim_sheet,
                row_index=0, field="qty_by_area", value=5, area="Zone A",
            )
        name = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.boq_name, "sheet_name": self.no_dim_sheet, "row_index": 0},
            "name",
        )
        doc = frappe.get_doc("BoQ Review Row", name)
        self.assertIsNone(doc.edited_at, "a rejected edit must not stamp edited_at")
        frappe.db.delete(
            "BoQ Review Row", {"boq": self.boq_name, "sheet_name": self.no_dim_sheet})
        frappe.db.commit()


# ===========================================================================
# Group 6: mark_sheet_parsed_check_done -- DB
# ===========================================================================

class TestMarkSheetParsedCheckDone(FrappeTestCase):
    """
    Verifies the confirm-gate (ok:False when breaks + confirm=False) and the
    status transition to "Finalized" with correct overridden flag.

    CleanSheet: preamble (row 0) + line_item with parent=0 (row 1) -> no breaks.
    BreakSheet: orphan line_item (row 0, parent=None) -> ORPHAN break.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "CheckDone Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "CleanSheet", "sheet_order": 1, "wizard_status": "Parsed",
        })
        boq.append("sheet_drafts", {
            "sheet_name": "BreakSheet", "sheet_order": 2, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name

        # CleanSheet: valid preamble + child line_item
        _insert_rows(cls.boq_name, [
            _minimal_row("CleanSheet", 0, "preamble", parent_index=None),
            _minimal_row("CleanSheet", 1, "line_item", parent_index=0),
        ])

        # BreakSheet: orphan line_item (no parent)
        _insert_rows(cls.boq_name, [
            _minimal_row("BreakSheet", 0, "line_item", parent_index=None),
        ])

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        """Reset both sheet statuses to 'Parsed' before each test."""
        for sheet_name in ("CleanSheet", "BreakSheet"):
            child = frappe.db.get_value(
                "BoQ Sheet Draft",
                {"parent": self.boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
                "name",
            )
            if child:
                frappe.db.set_value("BoQ Sheet Draft", child, "wizard_status", "Parsed")
        frappe.db.commit()

    def _get_wizard_status(self, sheet_name: str) -> str:
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
            "wizard_status",
        ) or ""

    def test_clean_sheet_ok_true_status_set(self):
        result = mark_sheet_parsed_check_done(
            boq_name=self.boq_name, sheet_name="CleanSheet",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "Finalized")
        self.assertFalse(result["overridden"],
                         "overridden must be False when there are no breaks")
        self.assertEqual(self._get_wizard_status("CleanSheet"), "Finalized",
                         "wizard_status must be written to 'Finalized'")

    def test_break_no_confirm_returns_ok_false_status_unchanged(self):
        result = mark_sheet_parsed_check_done(
            boq_name=self.boq_name, sheet_name="BreakSheet", confirm=False,
        )
        self.assertFalse(result["ok"])
        self.assertIn("breaks", result)
        self.assertGreater(len(result["breaks"]), 0)
        self.assertEqual(result["breaks"][0]["type"], "orphan",
                         "BreakSheet has an orphan line_item -- expect an orphan break")
        self.assertEqual(self._get_wizard_status("BreakSheet"), "Parsed",
                         "Status must NOT change when breaks exist and confirm=False")

    def test_break_confirm_true_ok_true_overridden_true(self):
        """Calling with confirm=True overrides the integrity warning and sets the status."""
        result = mark_sheet_parsed_check_done(
            boq_name=self.boq_name, sheet_name="BreakSheet", confirm=True,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "Finalized")
        self.assertTrue(result["overridden"],
                        "overridden must be True when breaks existed and user confirmed past them")
        self.assertEqual(self._get_wizard_status("BreakSheet"), "Finalized",
                         "wizard_status must be written to 'Finalized' when confirmed")

    # -- Slice D1 mark precondition (M1/M2) ----------------------------------

    def test_mark_already_checked_rejected_status_unchanged(self):
        """M1: marking an already-'Finalized' sheet throws; status stays checked."""
        mark_sheet_parsed_check_done(boq_name=self.boq_name, sheet_name="CleanSheet")
        self.assertEqual(self._get_wizard_status("CleanSheet"), "Finalized")
        with self.assertRaises(frappe.ValidationError):
            mark_sheet_parsed_check_done(boq_name=self.boq_name, sheet_name="CleanSheet")
        self.assertEqual(
            self._get_wizard_status("CleanSheet"), "Finalized",
            "status must remain 'Finalized' after a rejected re-mark",
        )

    def test_mark_non_parsed_status_rejected(self):
        """M2: marking a 'Config Done' (non-Parsed) sheet throws; status unchanged."""
        child = frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq_name, "parenttype": "BOQs", "sheet_name": "CleanSheet"},
            "name",
        )
        frappe.db.set_value("BoQ Sheet Draft", child, "wizard_status", "Config Done")
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError):
            mark_sheet_parsed_check_done(boq_name=self.boq_name, sheet_name="CleanSheet")
        self.assertEqual(
            self._get_wizard_status("CleanSheet"), "Config Done",
            "status must remain 'Config Done' after a rejected mark",
        )


# ===========================================================================
# Group 7: get_structural_breaks -- DB (Slice B1)
# ===========================================================================

class TestGetStructuralBreaks(FrappeTestCase):
    """
    Verifies the read-only get_structural_breaks endpoint.

    Fixtures:
      CleanSheet2: preamble (row 0) + line_item with parent=0 (row 1) -> no breaks.
      OrphanSheet2: orphan line_item (row 0, parent=None, source_row_number=5) -> ORPHAN break.

    Naming is distinct from TestMarkSheetParsedCheckDone fixtures (CleanSheet / BreakSheet)
    so both test classes can coexist in the same test database run without interference.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "StructBreaks Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "CleanSheet2", "sheet_order": 1, "wizard_status": "Parsed",
        })
        boq.append("sheet_drafts", {
            "sheet_name": "OrphanSheet2", "sheet_order": 2, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name

        # CleanSheet2: valid preamble + child line_item (no structural breaks)
        _insert_rows(cls.boq_name, [
            _minimal_row("CleanSheet2", 0, "preamble", parent_index=None),
            _minimal_row("CleanSheet2", 1, "line_item", parent_index=0),
        ])

        # OrphanSheet2: orphan line_item (no parent -> ORPHAN break)
        _insert_rows(cls.boq_name, [
            _minimal_row("OrphanSheet2", 0, "line_item", parent_index=None,
                         source_row_number=5),
        ])

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def _get_wizard_status(self, sheet_name: str) -> str:
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
            "wizard_status",
        ) or ""

    def test_orphan_sheet_returns_break_of_type_orphan(self):
        """A sheet with an orphan line_item returns exactly one break of type orphan."""
        result = get_structural_breaks(boq_name=self.boq_name, sheet_name="OrphanSheet2")
        self.assertIn("breaks", result)
        self.assertEqual(len(result["breaks"]), 1,
                         "expect exactly one break for the single orphan line_item")
        brk = result["breaks"][0]
        self.assertEqual(brk["type"], "orphan")
        self.assertEqual(brk["row_index"], 0,
                         "break row_index must match the inserted orphan row")
        self.assertEqual(brk["source_row_number"], 5,
                         "source_row_number must match the fixture value passed at insert")

    def test_clean_sheet_returns_empty_breaks(self):
        """A structurally clean sheet returns {"breaks": []}."""
        result = get_structural_breaks(boq_name=self.boq_name, sheet_name="CleanSheet2")
        self.assertIn("breaks", result)
        self.assertEqual(result["breaks"], [],
                         "clean sheet must return an empty breaks list")

    def test_does_not_mutate_wizard_status(self):
        """get_structural_breaks must never modify wizard_status on any sheet."""
        status_before = self._get_wizard_status("OrphanSheet2")
        get_structural_breaks(boq_name=self.boq_name, sheet_name="OrphanSheet2")
        status_after = self._get_wizard_status("OrphanSheet2")
        self.assertEqual(status_before, status_after,
                         "get_structural_breaks must not write wizard_status")


# ===========================================================================
# Group 8: get_review_rows column_descriptors -- DB + pure Python (Slice B1.1a)
# ===========================================================================

# 2-area sheet_config fixture (mirrors the real Electrical sheet shape).
_COLUMN_DESCRIPTORS_SHEET_CONFIG = {
    "header_row": 1,
    "header_row_count": 1,
    "area_dimensions": ["Area1", "Area2"],
    "column_role_map": {
        "A": {"role": "sl_no", "area": None},
        "B": {"role": "description", "area": None},
        "C": {"role": "unit", "area": None},
        "D": {"role": "qty", "area": "Area1"},
        "E": {"role": "rate_combined_by_area", "area": "Area1"},
        "F": {"role": "amount_total_by_area", "area": "Area1"},
        "G": {"role": "qty", "area": "Area2"},
        "H": {"role": "rate_combined_by_area", "area": "Area2"},
        "I": {"role": "amount_total_by_area", "area": "Area2"},
        "J": {"role": "append_to_notes", "area": None},   # DISPLAYS now (in-position)
        "K": {"role": "ignore", "area": None},             # non-display
    },
}
_EXPECTED_DISPLAY_COUNT = 10   # 11 mapped - 1 non-display (ignore); append_to_notes now displays


class TestBuildColumnDescriptors(unittest.TestCase):
    """Pure-Python unit tests for _build_column_descriptors."""

    def test_empty_config_returns_empty(self):
        self.assertEqual(_build_column_descriptors(None), [])
        self.assertEqual(_build_column_descriptors({}), [])
        self.assertEqual(_build_column_descriptors({"column_role_map": {}}), [])

    def test_non_display_roles_excluded(self):
        # append-to-notes-as-columns: append_to_notes now DISPLAYS (in-position column);
        # only ignore / reference_images remain non-display.
        descs = _build_column_descriptors(_COLUMN_DESCRIPTORS_SHEET_CONFIG)
        roles = [d["role"] for d in descs]
        self.assertIn("append_to_notes", roles)
        self.assertNotIn("ignore", roles)

    def test_ignore_and_reference_images_still_excluded(self):
        """Control: the two remaining non-display roles are still dropped."""
        cfg = {
            "column_role_map": {
                "A": {"role": "description", "area": None},
                "B": {"role": "ignore", "area": None},
                "C": {"role": "reference_images", "area": None},
                "D": {"role": "append_to_notes", "area": None},
            }
        }
        roles = [d["role"] for d in _build_column_descriptors(cfg)]
        self.assertNotIn("ignore", roles)
        self.assertNotIn("reference_images", roles)
        self.assertIn("append_to_notes", roles)
        self.assertIn("description", roles)

    def test_append_to_notes_descriptor_shape_letter_fallback(self):
        """No column_headers -> value_key falls back to the Excel letter (the parser's
        column_headers.get(col, col) rule). value_field is the storage dict; one-hop."""
        descs = _build_column_descriptors(_COLUMN_DESCRIPTORS_SHEET_CONFIG)
        j_desc = next(d for d in descs if d["col"] == "J")
        self.assertEqual(j_desc["role"], "append_to_notes")
        self.assertEqual(j_desc["value_field"], "append_notes_raw")
        self.assertEqual(j_desc["value_key"], "J")   # letter fallback (no column_headers)
        self.assertIsNone(j_desc["area"])
        self.assertIsNone(j_desc["rate_subkey"])

    def test_append_to_notes_value_key_uses_header_when_mapped(self):
        """column_headers maps the letter -> value_key is the header text, matching the
        parser-stored append_notes_raw key (header-else-letter)."""
        cfg = {
            "column_headers": {"J": "Remarks", "K": "Make"},
            "column_role_map": {
                "J": {"role": "append_to_notes", "area": None},
                "K": {"role": "append_to_notes", "area": None},
                "L": {"role": "append_to_notes", "area": None},   # not in column_headers
            },
        }
        descs = _build_column_descriptors(cfg)
        by_col = {d["col"]: d for d in descs}
        self.assertEqual(by_col["J"]["value_key"], "Remarks")
        self.assertEqual(by_col["K"]["value_key"], "Make")
        self.assertEqual(by_col["L"]["value_key"], "L")   # absent in column_headers -> letter

    def test_count_and_excel_order(self):
        descs = _build_column_descriptors(_COLUMN_DESCRIPTORS_SHEET_CONFIG)
        self.assertEqual(len(descs), _EXPECTED_DISPLAY_COUNT)
        cols = [d["col"] for d in descs]
        # append_to_notes (J) now interleaves in Excel position; only ignore (K) dropped.
        self.assertEqual(cols, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"])

    def test_singleton_descriptor_shape(self):
        descs = _build_column_descriptors(_COLUMN_DESCRIPTORS_SHEET_CONFIG)
        a_desc = next(d for d in descs if d["col"] == "A")
        self.assertEqual(a_desc["role"], "sl_no")
        self.assertEqual(a_desc["value_field"], "sl_no_value")
        self.assertIsNone(a_desc["area"])
        self.assertIsNone(a_desc["value_key"])
        self.assertIsNone(a_desc["rate_subkey"])

    def test_rate_by_area_descriptor_shape(self):
        descs = _build_column_descriptors(_COLUMN_DESCRIPTORS_SHEET_CONFIG)
        e_desc = next(d for d in descs if d["col"] == "E")
        self.assertEqual(e_desc["role"], "rate_combined_by_area")
        self.assertEqual(e_desc["area"], "Area1")
        self.assertEqual(e_desc["value_field"], "rate_by_area")
        self.assertEqual(e_desc["value_key"], "Area1")
        self.assertEqual(e_desc["rate_subkey"], "combined_rate")

    def test_qty_by_area_descriptor_shape(self):
        descs = _build_column_descriptors(_COLUMN_DESCRIPTORS_SHEET_CONFIG)
        d_desc = next(d for d in descs if d["col"] == "D")
        self.assertEqual(d_desc["role"], "qty")
        self.assertEqual(d_desc["value_field"], "qty_by_area")
        self.assertEqual(d_desc["value_key"], "Area1")
        self.assertIsNone(d_desc["rate_subkey"])

    def test_amount_by_area_descriptor_shape(self):
        """Per-area amount role (field-set Slice 2a): nested descriptor mirroring rate.
        value_field is the kept storage field `amount_by_area`; the generic third-hop key
        (`rate_subkey`) carries the amount kind ("total")."""
        descs = _build_column_descriptors(_COLUMN_DESCRIPTORS_SHEET_CONFIG)
        f_desc = next(d for d in descs if d["col"] == "F")
        self.assertEqual(f_desc["role"], "amount_total_by_area")
        self.assertEqual(f_desc["value_field"], "amount_by_area")
        self.assertEqual(f_desc["value_key"], "Area1")
        self.assertEqual(f_desc["rate_subkey"], "total")

    def test_multi_col_excel_sort(self):
        """Multi-letter columns sort after single-letter ones: Z < AA < AB."""
        cfg = {
            "column_role_map": {
                "AA": {"role": "qty", "area": "X"},
                "Z": {"role": "qty", "area": "X"},
                "AB": {"role": "qty", "area": "X"},
            }
        }
        descs = _build_column_descriptors(cfg)
        self.assertEqual([d["col"] for d in descs], ["Z", "AA", "AB"])

    def test_unknown_role_skipped_silently(self):
        cfg = {
            "column_role_map": {
                "A": {"role": "description", "area": None},
                "B": {"role": "future_unknown_role", "area": None},
            }
        }
        descs = _build_column_descriptors(cfg)
        self.assertEqual(len(descs), 1)
        self.assertEqual(descs[0]["col"], "A")


class TestGetReviewRowsColumnDescriptors(FrappeTestCase):
    """
    DB tests: get_review_rows returns column_descriptors alongside rows + work_packages.

    ConfigSheet   -- has the 2-area sheet_config fixture.
    NoConfigSheet -- no sheet_config; must return column_descriptors: [].
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "ColDesc Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "ConfigSheet",
            "sheet_order": 1,
            "wizard_status": "Parsed",
            "sheet_config": json.dumps(_COLUMN_DESCRIPTORS_SHEET_CONFIG),
        })
        boq.append("sheet_drafts", {
            "sheet_name": "NoConfigSheet",
            "sheet_order": 2,
            "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name

        _insert_rows(cls.boq_name, [
            _minimal_row("ConfigSheet", 0, "preamble", parent_index=None),
            _minimal_row("ConfigSheet", 1, "line_item", parent_index=0),
        ])

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def test_column_descriptors_ordered_and_shaped(self):
        """2-area config: descriptors in Excel order, correct field/key/rate_subkey."""
        result = get_review_rows(boq_name=self.boq_name, sheet_name="ConfigSheet")
        self.assertIn("column_descriptors", result)
        descs = result["column_descriptors"]
        self.assertEqual(len(descs), _EXPECTED_DISPLAY_COUNT)
        self.assertEqual([d["col"] for d in descs],
                         ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"])
        e_desc = next(d for d in descs if d["col"] == "E")
        self.assertEqual(e_desc["value_field"], "rate_by_area")
        self.assertEqual(e_desc["value_key"], "Area1")
        self.assertEqual(e_desc["rate_subkey"], "combined_rate")
        a_desc = next(d for d in descs if d["col"] == "A")
        self.assertEqual(a_desc["value_field"], "sl_no_value")
        self.assertIsNone(a_desc["value_key"])
        self.assertIsNone(a_desc["rate_subkey"])

    def test_append_displays_ignore_excluded_from_endpoint(self):
        """append-to-notes-as-columns: append_to_notes now appears in column_descriptors
        from the endpoint (in-position); ignore is still excluded."""
        result = get_review_rows(boq_name=self.boq_name, sheet_name="ConfigSheet")
        descs = result["column_descriptors"]
        roles = [d["role"] for d in descs]
        self.assertIn("append_to_notes", roles)
        self.assertNotIn("ignore", roles)
        j_desc = next(d for d in descs if d["col"] == "J")
        self.assertEqual(j_desc["value_field"], "append_notes_raw")
        self.assertEqual(j_desc["value_key"], "J")
        self.assertIsNone(j_desc["rate_subkey"])

    def test_append_notes_raw_shipped_parsed(self):
        """Regression: get_review_rows still ships append_notes_raw as a parsed object
        (a dict) on every row, never a raw JSON string."""
        result = get_review_rows(boq_name=self.boq_name, sheet_name="ConfigSheet")
        for r in result["rows"]:
            self.assertIn("append_notes_raw", r)
            self.assertTrue(
                r["append_notes_raw"] is None or isinstance(r["append_notes_raw"], dict),
                f"append_notes_raw must be dict|None, got {type(r['append_notes_raw'])}",
            )

    def test_no_sheet_config_returns_empty_descriptors(self):
        """Sheet with no sheet_config must return column_descriptors: []."""
        result = get_review_rows(boq_name=self.boq_name, sheet_name="NoConfigSheet")
        self.assertIn("column_descriptors", result)
        self.assertEqual(result["column_descriptors"], [])

    def test_rows_and_work_packages_unchanged_by_extension(self):
        """rows and work_packages must still be present and correctly shaped."""
        result = get_review_rows(boq_name=self.boq_name, sheet_name="ConfigSheet")
        self.assertIn("rows", result)
        self.assertIn("work_packages", result)
        self.assertIsInstance(result["rows"], list)
        self.assertIsInstance(result["work_packages"], list)
        row0 = next(r for r in result["rows"] if r["row_index"] == 0)
        self.assertIn("effective_classification", row0)
        self.assertIn("effective_parent_index", row0)


# ===========================================================================
# Group 9: _has_price_signal + _compute_advisory_flags -- pure Python (B2a)
# ===========================================================================

class TestAdvisoryFlagHelpers(unittest.TestCase):
    """
    Pure-Python unit tests for the four B2a advisory flag sources.

    All rows are constructed as plain dicts; no DB access needed.
    _minimal_advisory_row() provides only the fields the helpers read.
    """

    def _row(
        self,
        row_index,
        classification,
        parent_index=None,
        human_classification=None,
        human_parent=None,
        source_row_number=None,
        amount_total=None,
        amount_supply=None,
        amount_install=None,
        rate_supply=None,
        rate_install=None,
        rate_combined=None,
        qty_total=None,
        needs_classification_review=0,
        review_reason=None,
    ):
        """Minimal row dict for advisory-flag tests."""
        return {
            "row_index": row_index,
            "source_row_number": source_row_number if source_row_number is not None else row_index + 2,
            "classification": classification,
            "human_classification": human_classification,
            "parent_index": parent_index if parent_index is not None else -1,
            "human_parent": human_parent if human_parent is not None else -1,
            "amount_total": amount_total,
            "amount_supply": amount_supply,
            "amount_install": amount_install,
            "rate_supply": rate_supply,
            "rate_install": rate_install,
            "rate_combined": rate_combined,
            "qty_total": qty_total,
            "needs_classification_review": needs_classification_review,
            "review_reason": review_reason,
        }

    # -- _has_price_signal --

    def test_has_price_signal_amount_total(self):
        row = self._row(0, "preamble", amount_total=100.0)
        self.assertTrue(_has_price_signal(row))

    def test_has_price_signal_rate_combined(self):
        row = self._row(0, "preamble", rate_combined=250.0)
        self.assertTrue(_has_price_signal(row))

    def test_no_price_signal_all_none(self):
        row = self._row(0, "preamble")
        self.assertFalse(_has_price_signal(row))

    def test_no_price_signal_all_zero(self):
        row = self._row(0, "preamble", amount_total=0, rate_supply=0, qty_total=0)
        self.assertFalse(_has_price_signal(row))

    # -- flag (i): priced_preamble_no_children --

    def test_flag_i_fires_on_childless_priced_preamble(self):
        """
        A childless preamble with amount_total > 0 must receive flag (i).
        NOTE: this scenario can only arise via human_classification override after
        parse time (the parser demotes all childless priced preambles to line_items
        during the post-pass).  The test constructs one directly to verify the
        computation even though it is expected-dormant on real parse output.
        """
        rows = [self._row(0, "preamble", parent_index=None, amount_total=500.0)]
        flags = _compute_advisory_flags(rows, [])
        types = [f["type"] for f in flags]
        self.assertIn("priced_preamble_no_children", types)

    def test_flag_i_does_not_fire_when_preamble_has_children(self):
        rows = [
            self._row(0, "preamble", parent_index=None, amount_total=500.0),
            self._row(1, "line_item", parent_index=0, amount_total=500.0),
        ]
        flags = _compute_advisory_flags(rows, [])
        types = [f["type"] for f in flags]
        self.assertNotIn("priced_preamble_no_children", types)

    def test_flag_i_does_not_fire_when_preamble_has_no_price(self):
        rows = [self._row(0, "preamble", parent_index=None)]
        flags = _compute_advisory_flags(rows, [])
        types = [f["type"] for f in flags]
        self.assertNotIn("priced_preamble_no_children", types)

    def test_flag_i_fires_via_effective_classification(self):
        """
        A row with parser classification=line_item but human_classification=preamble
        (no children, has price) must be flagged -- effective_classification is used.
        """
        rows = [
            self._row(0, "line_item", parent_index=None,
                      human_classification="preamble", amount_total=100.0)
        ]
        flags = _compute_advisory_flags(rows, [])
        types = [f["type"] for f in flags]
        self.assertIn("priced_preamble_no_children", types)

    # -- flag (ii): zero_amount_line_item --

    def test_flag_ii_fires_on_zero_amount_with_rate(self):
        # New rule (B2a-fix): fires when amount_zero AND has_rate (scalar rate fields).
        rows = [self._row(0, "line_item", parent_index=0, amount_total=0, rate_supply=150.0)]
        flags = _compute_advisory_flags(rows, [])
        types = [f["type"] for f in flags]
        self.assertIn("zero_amount_line_item", types)

    def test_flag_ii_fires_when_amount_zero_and_rate_combined_present(self):
        # Amount zero + non-zero combined rate -> fires regardless of qty.
        rows = [self._row(0, "line_item", parent_index=0, amount_total=0,
                          qty_total=5.0, rate_combined=200.0)]
        flags = _compute_advisory_flags(rows, [])
        types = [f["type"] for f in flags]
        self.assertIn("zero_amount_line_item", types)

    def test_flag_ii_qty_zero_alone_does_not_fire(self):
        # qty-zero trigger dropped (B2a-fix): amount non-zero -> no flag regardless of qty.
        rows = [self._row(0, "line_item", parent_index=0, amount_total=100.0, qty_total=0)]
        flags = _compute_advisory_flags(rows, [])
        types = [f["type"] for f in flags]
        self.assertNotIn("zero_amount_line_item", types)

    def test_flag_ii_zero_amount_without_rate_does_not_fire(self):
        # No rate present -> flag does not fire even with zero/None amount.
        rows = [self._row(0, "line_item", parent_index=0, amount_total=0)]
        flags = _compute_advisory_flags(rows, [])
        types = [f["type"] for f in flags]
        self.assertNotIn("zero_amount_line_item", types)

    def test_flag_ii_does_not_fire_on_non_zero_line_item(self):
        rows = [self._row(0, "line_item", parent_index=0, amount_total=100.0, qty_total=2.0)]
        flags = _compute_advisory_flags(rows, [])
        types = [f["type"] for f in flags]
        self.assertNotIn("zero_amount_line_item", types)

    def test_flag_ii_respects_effective_classification(self):
        """
        A preamble reclassified to line_item via human_classification=line_item with
        zero amount AND a non-zero rate must receive flag (ii) -- effective_classification used.
        """
        rows = [
            self._row(0, "preamble", parent_index=0,
                      human_classification="line_item",
                      amount_total=0, rate_install=100.0)
        ]
        flags = _compute_advisory_flags(rows, [])
        types = [f["type"] for f in flags]
        self.assertIn("zero_amount_line_item", types)

    def test_flag_ii_not_fired_for_non_line_item(self):
        """A preamble with zero amounts must NOT receive the zero-amount flag."""
        rows = [self._row(0, "preamble", parent_index=None, amount_total=0, qty_total=0)]
        flags = _compute_advisory_flags(rows, [])
        types = [f["type"] for f in flags]
        self.assertNotIn("zero_amount_line_item", types)

    # -- flag (iii): orphan (composed from structural_breaks) --

    def test_orphan_composed_not_recomputed(self):
        """
        Orphan flags must come from the structural_breaks input, not be recomputed.
        Passing a synthetic orphan break must surface the flag even if rows would not
        independently trigger it (non-line_item row used to prove composition).
        """
        rows = [self._row(0, "preamble", parent_index=None)]
        # Inject a synthetic orphan break for row 0 (would not fire on a preamble normally)
        synthetic_break = {"type": "orphan", "row_index": 0, "source_row_number": 2,
                           "reason": "injected for test"}
        flags = _compute_advisory_flags(rows, [synthetic_break])
        orphan_flags = [f for f in flags if f["type"] == "orphan"]
        self.assertEqual(len(orphan_flags), 1, "orphan flag must surface from structural_breaks")
        self.assertEqual(orphan_flags[0]["reason"], "Line item with no parent group — check its parenting.",
                         "orphan flag reason must use the canonical phrase, not the break reason")

    def test_real_orphan_line_item_surfaces(self):
        """
        A genuine orphan line_item: structural_breaks will contain the orphan entry
        (from check_structural_integrity), which _compute_advisory_flags then reuses.
        """
        rows = [self._row(0, "line_item", parent_index=None)]
        breaks = check_structural_integrity(rows)
        flags = _compute_advisory_flags(rows, breaks)
        orphan_flags = [f for f in flags if f["type"] == "orphan"]
        self.assertEqual(len(orphan_flags), 1)
        self.assertEqual(orphan_flags[0]["row_index"], 0)

    # -- flag (iv): parser needs_classification_review --

    def test_parser_flag_surfaces_verbatim(self):
        review_text = "Scored borderline: check preamble vs line-item."
        rows = [self._row(0, "preamble", parent_index=None,
                          needs_classification_review=1, review_reason=review_text)]
        flags = _compute_advisory_flags(rows, [])
        parser_flags = [f for f in flags if f["type"] == "parser"]
        self.assertEqual(len(parser_flags), 1)
        self.assertEqual(parser_flags[0]["reason"], review_text,
                         "parser flag reason must be the verbatim review_reason string")

    def test_parser_flag_does_not_fire_without_reason(self):
        rows = [self._row(0, "preamble", parent_index=None,
                          needs_classification_review=1, review_reason=None)]
        flags = _compute_advisory_flags(rows, [])
        parser_flags = [f for f in flags if f["type"] == "parser"]
        self.assertEqual(len(parser_flags), 0, "no review_reason -> parser flag must not fire")

    def test_clean_sheet_no_flags(self):
        """A structurally clean sheet with priced non-preamble rows returns no flags."""
        rows = [
            self._row(0, "preamble", parent_index=None),
            self._row(1, "line_item", parent_index=0, amount_total=500.0, qty_total=2.0),
        ]
        flags = _compute_advisory_flags(rows, [])
        self.assertEqual(flags, [], "clean sheet must return no advisory flags")

    # -- canonical reason text --

    def test_canonical_reasons_verbatim(self):
        """Verify the four canonical reason strings are pinned verbatim."""
        rows = [
            self._row(0, "preamble", parent_index=None, amount_total=100.0),
        ]
        breaks = check_structural_integrity(rows)
        flags = _compute_advisory_flags(rows, breaks)
        i_flag = next((f for f in flags if f["type"] == "priced_preamble_no_children"), None)
        self.assertIsNotNone(i_flag)
        self.assertEqual(
            i_flag["reason"],
            "Preamble carrying a price with no sub-items — check if it's a line item.",
        )

        rows_ii = [self._row(1, "line_item", parent_index=0, amount_total=0, rate_supply=150.0)]
        flags_ii = _compute_advisory_flags(rows_ii, [])
        ii_flag = next((f for f in flags_ii if f["type"] == "zero_amount_line_item"), None)
        self.assertIsNotNone(ii_flag)
        self.assertEqual(
            ii_flag["reason"],
            "Has a rate but the amount is zero — check the quantity or amount.",
        )

        rows_iii = [self._row(2, "line_item", parent_index=None)]
        breaks_iii = check_structural_integrity(rows_iii)
        flags_iii = _compute_advisory_flags(rows_iii, breaks_iii)
        iii_flag = next((f for f in flags_iii if f["type"] == "orphan"), None)
        self.assertIsNotNone(iii_flag)
        self.assertEqual(
            iii_flag["reason"],
            "Line item with no parent group — check its parenting.",
        )


# ===========================================================================
# Group 10: get_structural_breaks extended (flags key) -- DB (Slice B2a)
# ===========================================================================

class TestGetStructuralBreaksB2a(FrappeTestCase):
    """
    Verifies the Slice B2a extension of get_structural_breaks: the endpoint now
    returns both "breaks" (unchanged) and "flags" (advisory flags).

    FlagSheet: preamble (row 0, amount_total=500, no children) + orphan line_item
               (row 1, parent=None) + parser-flagged preamble (row 2, needs_review=1).
    CleanSheet3: preamble (row 0) + line_item with parent=0 (row 1, amount=100, qty=2).
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "B2a Flags Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "FlagSheet", "sheet_order": 1, "wizard_status": "Parsed",
        })
        boq.append("sheet_drafts", {
            "sheet_name": "CleanSheet3", "sheet_order": 2, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name

        def _row_with_amounts(sheet_name, row_index, classification, parent_index,
                              amount_total=None, qty_total=None,
                              needs_classification_review=0, review_reason=None):
            d = _minimal_row(sheet_name, row_index, classification,
                             parent_index=parent_index)
            if amount_total is not None:
                d["amount_total"] = amount_total
            if qty_total is not None:
                d["qty_total"] = qty_total
            d["needs_classification_review"] = needs_classification_review
            if review_reason is not None:
                d["review_reason"] = review_reason
            return d

        # FlagSheet:
        #   row 0 -- preamble, no parent, amount_total=500, no children -> priced_preamble_no_children
        #   row 1 -- line_item, no parent -> orphan + zero_amount_line_item
        #   row 2 -- preamble, no parent, needs_review=1, review_reason set -> parser flag
        #   (row 2 must have parent=None so row 0 truly has no children; a root preamble
        #    is not an ORPHAN -- the orphan check is line_item-only.)
        _insert_rows(cls.boq_name, [
            _row_with_amounts("FlagSheet", 0, "preamble", None, amount_total=500.0),
            _row_with_amounts("FlagSheet", 1, "line_item", None),
            _row_with_amounts("FlagSheet", 2, "preamble", None,
                              needs_classification_review=1,
                              review_reason="borderline preamble vs line_item"),
        ])

        # CleanSheet3: no flags expected
        _insert_rows(cls.boq_name, [
            _row_with_amounts("CleanSheet3", 0, "preamble", None),
            _row_with_amounts("CleanSheet3", 1, "line_item", 0,
                              amount_total=100.0, qty_total=2.0),
        ])

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def test_flags_key_present_in_response(self):
        result = get_structural_breaks(boq_name=self.boq_name, sheet_name="FlagSheet")
        self.assertIn("flags", result, "'flags' key must be present in get_structural_breaks response")
        self.assertIsInstance(result["flags"], list)

    def test_breaks_key_still_present_and_unchanged(self):
        """The existing 'breaks' key must still be present and contain orphan for FlagSheet."""
        result = get_structural_breaks(boq_name=self.boq_name, sheet_name="FlagSheet")
        self.assertIn("breaks", result)
        orphan_breaks = [b for b in result["breaks"] if b["type"] == "orphan"]
        self.assertGreater(len(orphan_breaks), 0, "orphan break must still surface in 'breaks'")

    def test_priced_preamble_no_children_flag_in_response(self):
        result = get_structural_breaks(boq_name=self.boq_name, sheet_name="FlagSheet")
        types = [f["type"] for f in result["flags"]]
        self.assertIn("priced_preamble_no_children", types)

    def test_orphan_advisory_flag_in_response(self):
        result = get_structural_breaks(boq_name=self.boq_name, sheet_name="FlagSheet")
        types = [f["type"] for f in result["flags"]]
        self.assertIn("orphan", types)

    def test_parser_flag_verbatim_in_response(self):
        result = get_structural_breaks(boq_name=self.boq_name, sheet_name="FlagSheet")
        parser_flags = [f for f in result["flags"] if f["type"] == "parser"]
        self.assertEqual(len(parser_flags), 1)
        self.assertEqual(parser_flags[0]["reason"], "borderline preamble vs line_item")

    def test_clean_sheet_empty_flags(self):
        result = get_structural_breaks(boq_name=self.boq_name, sheet_name="CleanSheet3")
        self.assertEqual(result["flags"], [], "clean sheet must return empty flags list")
        self.assertEqual(result["breaks"], [], "clean sheet must return empty breaks list")


# ===========================================================================
# Group 11: save_review_restructure -- DB (Slice 1b-alpha)
# ===========================================================================

class TestSaveReviewRestructure(FrappeTestCase):
    """
    Slice 1b-alpha: save_review_restructure -- atomic reclassify + reparent.

    Fixture rows per test (reset by setUp):
      Row 0 -- preamble,  parent=None  (root)
      Row 1 -- preamble,  parent=0     (reclassified in most tests; parent of 2,3)
      Row 2 -- line_item, parent=1     (child of 1)
      Row 3 -- line_item, parent=1     (child of 1)
      Row 4 -- preamble,  parent=0     (sibling of 1; a candidate new parent, NOT a child of 1)

    Batch-cycle case: reclassify row 1 with child_moves={2:3, 3:2}. Each move alone is
    acyclic (2->3->1->0 / 3->2->1->0) but together they form 2<->3 -- the batch guard
    must reject and write NOTHING (all-or-nothing).
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Restructure Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "RestructureSheet", "sheet_order": 1, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name
        cls.sheet_name = "RestructureSheet"

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name})
        frappe.db.commit()
        _insert_rows(self.boq_name, [
            _minimal_row(self.sheet_name, 0, "preamble", parent_index=None),
            _minimal_row(self.sheet_name, 1, "preamble", parent_index=0),
            _minimal_row(self.sheet_name, 2, "line_item", parent_index=1),
            _minimal_row(self.sheet_name, 3, "line_item", parent_index=1),
            _minimal_row(self.sheet_name, 4, "preamble", parent_index=0),
        ])

    def _get_doc(self, row_index):
        name = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.boq_name, "sheet_name": self.sheet_name, "row_index": row_index},
            "name",
        )
        return frappe.get_doc("BoQ Review Row", name)

    @staticmethod
    def _as_list(v):
        if isinstance(v, str):
            return json.loads(v) if v else []
        return v or []

    # -- HAPPY: reclassify with children moved to a new parent --

    def test_reclassify_with_children_to_new_parent(self):
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",
            child_moves={2: 4, 3: 4},
            reason="row 1 is really a note",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["new_classification"], "note")
        self.assertEqual(result["children_moved"], [2, 3])
        self.assertTrue(result["edited_at"], "edited_at must be non-empty after a restructure")

        # target reclassified, with a human_classification entry carrying the reason
        r1 = self._get_doc(1)
        self.assertEqual(r1.human_classification, "note")
        log1 = self._as_list(r1.edit_log)
        self.assertEqual(log1[-1]["field"], "human_classification")
        self.assertEqual(log1[-1]["to"], "note")
        self.assertEqual(log1[-1]["reason"], "row 1 is really a note")

        # each child reparented + carries its OWN human_parent entry with the tie reason
        tie = "parent moved: row 1 reclassified to note"
        for ci in (2, 3):
            c = self._get_doc(ci)
            self.assertEqual(c.human_parent, 4, f"child {ci} reparented to 4")
            logc = self._as_list(c.edit_log)
            self.assertEqual(logc[-1]["field"], "human_parent")
            self.assertEqual(logc[-1]["to"], 4)
            self.assertEqual(logc[-1]["reason"], tie)

    def test_all_children_to_root(self):
        """Slice 1b-alpha (human_is_root, Option B): a -1 move re-roots the child via
        the SEPARATE human_is_root flag. The consistency invariant holds (human_is_root=1
        AND human_parent=-1), and effective_parent_index is None -- the assertion the
        old -1-sentinel encoding could not satisfy."""
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="line_item",
            child_moves={2: -1, 3: -1},
        )
        self.assertTrue(result["ok"])
        for ci in (2, 3):
            c = self._get_doc(ci)
            self.assertEqual(c.human_is_root, 1, "a root move sets human_is_root=1")
            self.assertEqual(c.human_parent, -1,
                             "invariant: a rooted row keeps human_parent=-1 (no row override)")
            self.assertIsNone(
                resolve_effective(c)["effective_parent_index"],
                "effective parent of a rooted child is None",
            )

    def test_all_children_to_one_new_parent(self):
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="preamble",
            child_moves={2: 4, 3: 4},
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self._get_doc(2).human_parent, 4)
        self.assertEqual(self._get_doc(3).human_parent, 4)

    def test_promote_children_to_old_parent(self):
        # row 1's old parent is 0; promoting its children to 0 is just another map.
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",
            child_moves={2: 0, 3: 0},
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self._get_doc(2).human_parent, 0)
        self.assertEqual(self._get_doc(3).human_parent, 0)

    # -- HAPPY: childless reclassify (leaf row, empty child_moves) --

    def test_childless_reclassify_only_classification_written(self):
        # row 2 is a leaf line_item (no children of its own). Reclassify with empty moves.
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=2, new_classification="note",
            child_moves={},
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["children_moved"], [])
        r2 = self._get_doc(2)
        self.assertEqual(r2.human_classification, "note")
        log2 = self._as_list(r2.edit_log)
        self.assertEqual(log2[-1]["field"], "human_classification")
        # an unrelated row must not be touched
        r3 = self._get_doc(3)
        self.assertEqual(r3.human_parent, -1, "an unrelated row must not be reparented")
        self.assertIsNone(r3.edited_at, "an unrelated row must not be stamped")

    # -- REJECT: FROM-but-not-TO (parser-only classes rejected as targets) --

    def test_reject_subtotal_marker_target(self):
        with self.assertRaises(frappe.ValidationError):
            save_review_restructure(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=1, new_classification="subtotal_marker",
                child_moves={2: 4},
            )
        self.assertFalse(self._get_doc(1).human_classification,
                         "a rejected reclassify must not write the target")
        self.assertEqual(self._get_doc(2).human_parent, -1,
                         "a rejected reclassify must not move any child")

    def test_reject_header_repeat_target(self):
        with self.assertRaises(frappe.ValidationError):
            save_review_restructure(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=1, new_classification="header_repeat",
                child_moves={},
            )
        self.assertFalse(self._get_doc(1).human_classification)

    # -- REJECT: a non-child named in the map --

    def test_reject_non_child_in_moves(self):
        # row 4 is a child of 0, NOT of 1 -- it cannot be moved by reclassifying row 1.
        with self.assertRaises(frappe.ValidationError):
            save_review_restructure(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=1, new_classification="note",
                child_moves={4: 0},
            )
        self.assertFalse(self._get_doc(1).human_classification,
                         "nothing written when a non-child is in the map")
        self.assertEqual(self._get_doc(4).human_parent, -1)

    # -- REJECT: a nonexistent proposed parent --

    def test_reject_nonexistent_parent(self):
        with self.assertRaises(frappe.ValidationError):
            save_review_restructure(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=1, new_classification="note",
                child_moves={2: 999},
            )
        self.assertFalse(self._get_doc(1).human_classification)
        self.assertEqual(self._get_doc(2).human_parent, -1)

    # -- REJECT: the headline batch-cycle case (all-or-nothing rollback) --

    def test_reject_batch_cycle_nothing_written(self):
        """Two moves each individually acyclic (2->3->1->0 / 3->2->1->0) but TOGETHER
        a cycle (2<->3). The batch guard must reject and write NOTHING."""
        with self.assertRaises(frappe.ValidationError):
            save_review_restructure(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=1, new_classification="note",
                child_moves={2: 3, 3: 2},
            )
        # target class unchanged
        self.assertFalse(self._get_doc(1).human_classification,
                         "batch-cycle rejection must leave the target classification unchanged")
        # both children's parents unchanged (no human override stored)
        self.assertEqual(self._get_doc(2).human_parent, -1,
                         "batch-cycle rejection must not move child 2")
        self.assertEqual(self._get_doc(3).human_parent, -1,
                         "batch-cycle rejection must not move child 3")
        # provenance not stamped on any of the three involved rows
        for ri in (1, 2, 3):
            self.assertIsNone(self._get_doc(ri).edited_at,
                              f"row {ri} must not be stamped on a rejected restructure")

    # -- child_moves accepts a JSON string (frappe may pass either) --

    def test_child_moves_accepts_json_string(self):
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",
            child_moves=json.dumps({"2": 4, "3": 4}),
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["children_moved"], [2, 3])
        self.assertEqual(self._get_doc(2).human_parent, 4)

    # -- Slice 1b-alpha human_is_root: invariant + provenance --

    def test_root_move_sets_invariant_and_logs_to_none(self):
        """A root move sets human_is_root=1 AND human_parent=-1 (invariant), and the
        child's human_parent edit_log entry records to=None (root reads as 'no parent',
        Deliverable 4), from=1 (the effective parent before the move)."""
        save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",
            child_moves={2: -1},
        )
        c = self._get_doc(2)
        self.assertEqual(c.human_is_root, 1)
        self.assertEqual(c.human_parent, -1, "invariant: rooted row keeps human_parent=-1")
        log = self._as_list(c.edit_log)
        self.assertEqual(log[-1]["field"], "human_parent")
        self.assertIsNone(log[-1]["to"], "a root move logs to=None (root, not the -1 sentinel)")
        self.assertEqual(log[-1]["from"], 1, "from is the effective parent (row 1) before the move")

    def test_subsequent_real_parent_move_clears_root(self):
        """After rooting child 2, moving it to a REAL parent (>=0) via save_review_edit
        clears human_is_root back to 0 (case a clears rooting -- the chokepoint invariant)."""
        save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",
            child_moves={2: -1},
        )
        self.assertEqual(self._get_doc(2).human_is_root, 1, "precondition: child 2 is rooted")
        # Now give it a real parent via the single-row edit endpoint.
        save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=2, field="human_parent", value=4,
        )
        c = self._get_doc(2)
        self.assertEqual(c.human_is_root, 0, "a real parent override must clear human_is_root")
        self.assertEqual(c.human_parent, 4, "the real parent override is stored")
        self.assertEqual(resolve_effective(c)["effective_parent_index"], 4,
                         "effective parent follows the real override, not root")

    def test_mixed_batch_some_root_some_parent(self):
        """ONE restructure call moving some children to a real parent and others to root.
        Each child lands in the correct state and the single commit covered all."""
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",
            child_moves={2: 4, 3: -1},
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["children_moved"], [2, 3])
        # child 2 -> real parent 4 (not rooted)
        c2 = self._get_doc(2)
        self.assertEqual(c2.human_parent, 4)
        self.assertEqual(c2.human_is_root, 0)
        self.assertEqual(resolve_effective(c2)["effective_parent_index"], 4)
        # child 3 -> root (rooted, no row override)
        c3 = self._get_doc(3)
        self.assertEqual(c3.human_is_root, 1)
        self.assertEqual(c3.human_parent, -1)
        self.assertIsNone(resolve_effective(c3)["effective_parent_index"])

    # ===================================================================
    # Slice 1b-beta2: row_new_parent -- place the RECLASSIFIED ROW itself.
    #
    # T1 / T2 are the EMPTY-child_moves corruption guard (the check-loop
    # iterates child moves only; without row_index as a check start-point a
    # pure row move runs ZERO cycle checks). T7 is the NON-empty corruption
    # guard (the check runs, but over the wrong start-points: the moved child
    # is innocent, the cycle is via the row). Together they make the
    # start-point extension impossible to silently regress.
    # ===================================================================

    def test_reject_row_self_move_cycle_nothing_written(self):
        """KEYSTONE (LC10 backend half). Move row 1 UNDER its own child (row 2):
        chain 1->2->1 is a cycle. child_moves omitted (empty) -- so the check-loop
        iterates ZERO child moves; the throw can only happen if row_index was added
        to the cycle-check start-points. All-or-nothing: nothing is written."""
        with self.assertRaises(frappe.ValidationError):
            save_review_restructure(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=1, new_classification="note",
                row_new_parent=2,  # row 2 is row 1's own child -> 1->2->1
            )
        r1 = self._get_doc(1)
        self.assertFalse(r1.human_classification,
                         "a rejected row-self-move must not write the classification")
        self.assertEqual(r1.human_parent, -1,
                         "a rejected row-self-move must not move the row")
        self.assertEqual(r1.human_is_root, 0)
        self.assertIsNone(r1.edited_at, "the target row must not be stamped")
        # the children are untouched
        self.assertEqual(self._get_doc(2).human_parent, -1)
        self.assertIsNone(self._get_doc(2).edited_at)
        self.assertEqual(self._get_doc(3).human_parent, -1)
        self.assertIsNone(self._get_doc(3).edited_at)

    def test_reject_pure_row_move_cycle_empty_child_moves(self):
        """THE zero-checks trap, made explicit: identical cycle to the keystone but
        with child_moves={} passed explicitly. The check-loop iterates an EMPTY moves
        dict -- this throws ONLY because row_index is a check start-point. This is the
        test that fails if the check-step (b) extension was forgotten."""
        with self.assertRaises(frappe.ValidationError):
            save_review_restructure(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=1, new_classification="note",
                child_moves={},
                row_new_parent=2,
            )
        r1 = self._get_doc(1)
        self.assertFalse(r1.human_classification)
        self.assertEqual(r1.human_parent, -1)
        self.assertEqual(r1.human_is_root, 0)
        self.assertIsNone(r1.edited_at)

    def test_row_moved_to_new_parent(self):
        """Reclassify row 1 AND move it under sibling row 4, with children also moved
        to 4. The row lands under 4 (human_parent=4, not rooted); edit_log on row 1
        carries BOTH the classification entry AND the human_parent entry; response
        row_moved is True."""
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",
            child_moves={2: 4, 3: 4},
            row_new_parent=4,
        )
        self.assertTrue(result["ok"])
        self.assertTrue(result["row_moved"], "row_moved must be True when the row was moved")
        self.assertEqual(result["children_moved"], [2, 3])

        r1 = self._get_doc(1)
        self.assertEqual(r1.human_classification, "note", "classification applied")
        self.assertEqual(r1.human_parent, 4, "the row landed under its new parent")
        self.assertEqual(r1.human_is_root, 0)
        self.assertEqual(resolve_effective(r1)["effective_parent_index"], 4)
        # row 1's edit_log carries BOTH a classification entry AND a human_parent entry
        log1 = self._as_list(r1.edit_log)
        fields = [e["field"] for e in log1]
        self.assertIn("human_classification", fields)
        self.assertIn("human_parent", fields)
        # the human_parent entry records the move to 4
        hp_entry = [e for e in log1 if e["field"] == "human_parent"][-1]
        self.assertEqual(hp_entry["to"], 4)
        # children landed under 4
        self.assertEqual(self._get_doc(2).human_parent, 4)
        self.assertEqual(self._get_doc(3).human_parent, 4)

    def test_row_moved_to_root(self):
        """row_new_parent=-1 re-roots the reclassified row via the human_is_root flag
        (Option B invariant: human_is_root=1 AND human_parent=-1). The read-back through
        get_review_rows reports effective_parent_index None."""
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",
            child_moves={},
            row_new_parent=-1,
        )
        self.assertTrue(result["ok"])
        self.assertTrue(result["row_moved"])
        r1 = self._get_doc(1)
        self.assertEqual(r1.human_is_root, 1, "a root move sets human_is_root=1")
        self.assertEqual(r1.human_parent, -1, "invariant: a rooted row keeps human_parent=-1")
        # read-back through the endpoint: effective parent is None (root)
        payload = get_review_rows(boq_name=self.boq_name, sheet_name=self.sheet_name)
        row1 = next(r for r in payload["rows"] if r["row_index"] == 1)
        self.assertIsNone(row1["effective_parent_index"],
                          "effective parent of a rooted row is None via get_review_rows")

    def test_row_parent_untouched_when_param_omitted(self):
        """Backwards-compat: the existing call shape (NO row_new_parent) must behave
        byte-for-byte as before -- the reclassified row's own parent is left untouched
        (human_parent stays -1, human_is_root 0), and response row_moved is False."""
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",
            child_moves={2: 4, 3: 4},
        )
        self.assertTrue(result["ok"])
        self.assertFalse(result["row_moved"],
                         "row_moved must be False when row_new_parent is omitted")
        r1 = self._get_doc(1)
        self.assertEqual(r1.human_parent, -1, "the row's own parent must be untouched")
        self.assertEqual(r1.human_is_root, 0)
        # row 1's edit_log carries ONLY the classification entry (no human_parent entry)
        log1 = self._as_list(r1.edit_log)
        self.assertEqual([e["field"] for e in log1], ["human_classification"])

    def test_row_new_parent_self_rejected(self):
        """row_new_parent == row_index is a self-parent -- rejected before any write."""
        with self.assertRaises(frappe.ValidationError):
            save_review_restructure(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=1, new_classification="note",
                row_new_parent=1,
            )
        self.assertFalse(self._get_doc(1).human_classification,
                         "a rejected self-parent must not write anything")

    def test_row_move_cycle_with_nonempty_child_moves_rejected(self):
        """T7 -- the SHARED-SIM keystone (non-empty child_moves trap).

        IMPOSSIBILITY NOTE: the prompt's original T7 asked for a cycle formed ONLY by
        the row-move + a child-move together, each INDIVIDUALLY acyclic. That is
        mathematically impossible here: every child in child_moves is validated to
        currently have effective parent == row_index, so any cycle using both the
        row edge (row->X) and a child edge (C->Y) contains the path row->X->...->C->Y
        ->...->row; reverting the child edge restores C->row, and the prefix
        row->X->...->C still closes the loop via the row edge ALONE -- i.e. the
        row-move alone is already cyclic, so it was never individually acyclic. QED.

        This substitute is strictly stronger as a guard test: a cycle via the ROW
        (1->2->1) is paired with a non-empty, individually-VALID child move (3->4,
        acyclic, and row 3 is in NO cycle). The check-loop therefore RUNS (moves is
        non-empty) but over the wrong start-points -- iterating moves={3} alone would
        MISS the cycle. It throws ONLY because row_index was added to the start-points
        AND the row's move shares the same sim map as the child move. All-or-nothing:
        nothing is written, including the innocent child move."""
        with self.assertRaises(frappe.ValidationError):
            save_review_restructure(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=1, new_classification="note",
                child_moves={3: 4},   # individually valid + acyclic; row 3 is innocent
                row_new_parent=2,      # row 1 under its own child 2 -> 1->2->1 cycle
            )
        # nothing written: target row unchanged
        r1 = self._get_doc(1)
        self.assertFalse(r1.human_classification)
        self.assertEqual(r1.human_parent, -1)
        self.assertEqual(r1.human_is_root, 0)
        self.assertIsNone(r1.edited_at)
        # the innocent child move was rolled back too (all-or-nothing)
        r3 = self._get_doc(3)
        self.assertEqual(r3.human_parent, -1, "the innocent child move must not persist")
        self.assertIsNone(r3.edited_at)

    # -- AI-3b-2: mark_ai_accepted (the cancel-safe ai_suggestion_status flip) --

    def _set_status(self, row_index, status):
        name = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.boq_name, "sheet_name": self.sheet_name, "row_index": row_index},
            "name",
        )
        frappe.db.set_value("BoQ Review Row", name, "ai_suggestion_status", status)
        frappe.db.commit()

    def test_mark_ai_accepted_parent_with_children(self):
        """R1: mark_ai_accepted=True on a with-children row (real parent change +
        child_moves) -> human_parent set AND ai_suggestion_status == 'Accepted'."""
        self._set_status(1, "Pending")
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="preamble",  # no-op class (row 1 is preamble)
            child_moves={2: 4, 3: 4},
            row_new_parent=4,
            mark_ai_accepted=True,
        )
        self.assertTrue(result["ok"])
        r1 = self._get_doc(1)
        self.assertEqual(r1.human_parent, 4, "the AI parent must be applied")
        self.assertEqual(r1.ai_suggestion_status, "Accepted", "the flip must land in the same commit")

    def test_mark_ai_accepted_both_class_and_parent(self):
        """R2: mark_ai_accepted=True with BOTH a new_classification AND row_new_parent ->
        both human fields set AND status 'Accepted' (accept-both folds into one call)."""
        self._set_status(1, "Pending")
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",  # real class change
            child_moves={2: 4, 3: 4},
            row_new_parent=4,
            mark_ai_accepted=True,
        )
        self.assertTrue(result["ok"])
        r1 = self._get_doc(1)
        self.assertEqual(r1.human_classification, "note")
        self.assertEqual(r1.human_parent, 4)
        self.assertEqual(r1.ai_suggestion_status, "Accepted")

    def test_mark_ai_accepted_root(self):
        """R3: mark_ai_accepted=True with row_new_parent=-1 (root accept) ->
        human_is_root=1 + human_parent=-1 + status 'Accepted'."""
        self._set_status(1, "Pending")
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="preamble",
            child_moves={2: 4, 3: 4},
            row_new_parent=-1,
            mark_ai_accepted=True,
        )
        self.assertTrue(result["ok"])
        r1 = self._get_doc(1)
        self.assertEqual(r1.human_is_root, 1)
        self.assertEqual(r1.human_parent, -1)
        self.assertEqual(r1.ai_suggestion_status, "Accepted")

    def test_mark_ai_accepted_omitted_leaves_status_pending(self):
        """R4 (cancel-safety semantic): WITHOUT mark_ai_accepted, ai_suggestion_status is
        UNCHANGED. The flip is opt-in and the flag is only ever sent on the modal's Save,
        so any non-save path (which never calls this endpoint) leaves status Pending."""
        self._set_status(1, "Pending")
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",
            child_moves={2: 4, 3: 4},
            # mark_ai_accepted omitted
        )
        self.assertTrue(result["ok"])
        r1 = self._get_doc(1)
        self.assertEqual(r1.human_classification, "note", "the reclassify still applies")
        self.assertEqual(r1.ai_suggestion_status, "Pending",
                         "without the flag the status must NOT flip (cancel-safety)")

    def test_restructure_without_flag_leaves_status_unflipped(self):
        """R5 (regression): the existing no-flag shape writes NOTHING to
        ai_suggestion_status -- it stays at its prior falsy default (Frappe stores an
        unset Select as ""), never flipped to "Accepted"."""
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",
            child_moves={2: 4, 3: 4},
        )
        self.assertTrue(result["ok"])
        status = self._get_doc(1).ai_suggestion_status
        self.assertFalse(status, "a plain restructure must leave ai_suggestion_status falsy")
        self.assertNotEqual(status, "Accepted",
                            "a plain restructure must NOT flip the status (opt-in flag only)")

    # -- AI-3c-1: edit_log from-value must be the TRUE pre-accept effective value -----
    # The live bug: mark_ai_accepted flipped the status BEFORE the helpers captured their
    # from-values, so resolve_effective (which the helper reads for the from-value) returned
    # the AI value the helper was about to write -> from == to (the user's "26 -> 26"). These
    # seed ai_suggested_* == the values applied (the real flow: row_new_parent = presetRowParent
    # = ai_suggested_parent), so they ONLY pass once the flip is deferred to after capture.

    def _seed(self, row_index, **fields):
        name = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.boq_name, "sheet_name": self.sheet_name, "row_index": row_index},
            "name",
        )
        frappe.db.set_value("BoQ Review Row", name, fields)
        frappe.db.commit()

    def test_R_fix1_parent_from_is_pre_accept_root_not_ai_value(self):
        """R-fix1: row 1 made a PARSER root (parent_index=-1) with children; AI suggests
        parent=4. The human_parent entry must log from = None (root), to = 4 -- the user's
        expected 'root -> 4', NOT '4 -> 4'."""
        self._seed(1, parent_index=-1, ai_suggestion_status="Pending", ai_suggested_parent=4)
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="preamble",  # no-op class (row 1 is preamble)
            child_moves={2: 4, 3: 4},
            row_new_parent=4,
            mark_ai_accepted=True,
        )
        self.assertTrue(result["ok"])
        r1 = self._get_doc(1)
        self.assertEqual(r1.human_parent, 4, "the AI parent is applied (write is correct)")
        entries = [e for e in self._as_list(r1.edit_log) if e["field"] == "human_parent"]
        self.assertEqual(len(entries), 1, "exactly one human_parent entry")
        self.assertIsNone(entries[0]["from"],
                          "from must be the TRUE pre-accept effective parent (root), NOT the AI value")
        self.assertEqual(entries[0]["to"], 4)

    def test_R_fix2_class_from_is_prior_effective_not_ai_value(self):
        """R-fix2 (accept-both): AI suggests class 'note' + parent 4. The
        human_classification entry must log from = 'preamble' (row 1's prior effective
        class), to = 'note' -- NOT 'note -> note'."""
        self._seed(1, ai_suggestion_status="Pending",
                   ai_suggested_classification="note", ai_suggested_parent=4)
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",  # real class change
            child_moves={2: 4, 3: 4},
            row_new_parent=4,
            mark_ai_accepted=True,
        )
        self.assertTrue(result["ok"])
        r1 = self._get_doc(1)
        entries = [e for e in self._as_list(r1.edit_log) if e["field"] == "human_classification"]
        self.assertEqual(len(entries), 1, "exactly one human_classification entry")
        self.assertEqual(entries[0]["from"], "preamble",
                         "from must be the prior effective class, NOT the AI class")
        self.assertEqual(entries[0]["to"], "note")

    def test_R_fix3_flip_still_happens_after_capture(self):
        """R-fix3: the flip is DEFERRED but MUST still happen -- status Accepted + the human
        writes + effective values all correct (capture-then-flip preserves the outcome)."""
        self._seed(1, ai_suggestion_status="Pending",
                   ai_suggested_classification="note", ai_suggested_parent=4)
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",
            child_moves={2: 4, 3: 4},
            row_new_parent=4,
            mark_ai_accepted=True,
        )
        self.assertTrue(result["ok"])
        r1 = self._get_doc(1)
        self.assertEqual(r1.human_classification, "note")
        self.assertEqual(r1.human_parent, 4)
        self.assertEqual(r1.ai_suggestion_status, "Accepted",
                         "the flip is persisted via set_value in the same commit")
        eff = resolve_effective(r1)
        self.assertEqual(eff["effective_classification"], "note")
        self.assertEqual(eff["effective_parent_index"], 4)

    def test_R_fix4_classification_only_with_children_keeps_own_parent(self):
        """AI-3c-3: the path the frontend now routes a classification-ONLY accept on a
        with-children row to -- mark_ai_accepted + new_classification + child_moves but NO
        row_new_parent. The class is applied, the children are dispositioned, the status
        flips to Accepted, and the row's OWN parent is left UNCHANGED (no override -> still
        resolves to its parser parent). This is the manual reclassify-with-children case."""
        self._seed(1, ai_suggestion_status="Pending",
                   ai_suggested_classification="note")
        result = save_review_restructure(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=1, new_classification="note",
            child_moves={2: 4, 3: 4},
            # NO row_new_parent -- the row keeps its own parent (child-disposition only).
            mark_ai_accepted=True,
        )
        self.assertTrue(result["ok"])
        self.assertFalse(result["row_moved"], "no row_new_parent -> the row is not moved")
        r1 = self._get_doc(1)
        self.assertEqual(r1.human_classification, "note", "the AI class is applied")
        self.assertEqual(r1.human_parent, -1,
                         "the row's OWN parent is untouched (no override written)")
        self.assertEqual(r1.human_is_root, 0)
        self.assertEqual(r1.ai_suggestion_status, "Accepted")
        eff = resolve_effective(r1)
        self.assertEqual(eff["effective_classification"], "note")
        self.assertEqual(eff["effective_parent_index"], 0,
                         "with no override the row still resolves to its parser parent (0)")
        # the children were dispositioned to row 4 by child_moves
        for ci in (2, 3):
            self.assertEqual(self._get_doc(ci).human_parent, 4, f"child {ci} reparented to 4")


# ===========================================================================
# Group 12: Finalized read-only freeze (Slice D1)
# ===========================================================================

class TestParsedCheckDoneFreeze(FrappeTestCase):
    """
    Verifies the Slice D1 read-only freeze: a sheet at "Finalized" rejects
    ALL FOUR write endpoints (save_review_edit, save_review_restructure,
    save_review_remark, dismiss_row_flags) before any write, and the freeze lifts
    once the status is restored to "Parsed".

    Fixture (reset per test, then restored to "Parsed"):
      Row 0 -- preamble,  parent=None  (root)
      Row 1 -- preamble,  parent=0     (child of 0)
      Row 2 -- line_item, parent=1     (leaf)
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Freeze Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "FreezeSheet", "sheet_order": 1, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name
        cls.sheet_name = "FreezeSheet"

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name})
        frappe.db.commit()
        _insert_rows(self.boq_name, [
            _minimal_row(self.sheet_name, 0, "preamble", parent_index=None),
            _minimal_row(self.sheet_name, 1, "preamble", parent_index=0),
            _minimal_row(self.sheet_name, 2, "line_item", parent_index=1),
        ])
        # Start every test from "Parsed" (a prior test may have frozen the sheet).
        self._set_status("Parsed")

    def _draft_name(self):
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq_name, "parenttype": "BOQs", "sheet_name": self.sheet_name},
            "name",
        )

    def _set_status(self, status):
        frappe.db.set_value("BoQ Sheet Draft", self._draft_name(), "wizard_status", status)
        frappe.db.commit()

    def _get_doc(self, row_index):
        name = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.boq_name, "sheet_name": self.sheet_name, "row_index": row_index},
            "name",
        )
        return frappe.get_doc("BoQ Review Row", name)

    def _edit_log(self, doc):
        if isinstance(doc.edit_log, str):
            return json.loads(doc.edit_log) if doc.edit_log else []
        return doc.edit_log or []

    def test_F1_edit_frozen_rejected_no_change(self):
        """F1: save_review_edit on a checked sheet throws; value + edit_log unchanged."""
        self._set_status("Finalized")
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=2, field="qty_total", value="99",
            )
        doc = self._get_doc(2)
        self.assertIn(doc.qty_total, (None, 0, 0.0), "value must be unchanged")
        self.assertEqual(len(self._edit_log(doc)), 0, "no edit_log entry on a frozen edit")
        self.assertIsNone(doc.edited_at, "edited_at must not be stamped on a frozen edit")

    def test_F2_restructure_frozen_rejected_no_change(self):
        """F2: save_review_restructure on a checked sheet throws; classification unchanged."""
        self._set_status("Finalized")
        before = self._get_doc(2).classification
        with self.assertRaises(frappe.ValidationError):
            save_review_restructure(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=2, new_classification="note", child_moves={},
            )
        doc = self._get_doc(2)
        self.assertEqual(doc.classification, before, "classification must be unchanged")
        self.assertFalse(doc.human_classification, "no human override may be written")
        self.assertIsNone(doc.edited_at)

    def test_F3_remark_frozen_rejected_no_change(self):
        """F3: save_review_remark on a checked sheet throws; remarks unchanged."""
        self._set_status("Finalized")
        with self.assertRaises(frappe.ValidationError):
            save_review_remark(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, remark="frozen remark",
            )
        self.assertFalse(self._get_doc(0).remarks, "remarks must be unchanged (empty)")

    def test_F4_dismiss_frozen_rejected_no_change(self):
        """F4: dismiss_row_flags on a checked sheet throws; flags_dismissed unchanged."""
        self._set_status("Finalized")
        with self.assertRaises(frappe.ValidationError):
            dismiss_row_flags(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, dismissed=True,
            )
        self.assertIn(self._get_doc(0).flags_dismissed, (0, None, False),
                      "flags_dismissed must be unchanged")

    def test_F5_edit_succeeds_after_status_restored(self):
        """F5: the SAME endpoint succeeds again once status is restored to 'Parsed'."""
        self._set_status("Finalized")
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=2, field="qty_total", value="50",
            )
        # Lift the freeze.
        self._set_status("Parsed")
        result = save_review_edit(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=2, field="qty_total", value="50",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self._get_doc(2).qty_total, 50.0, "the write must land after unfreeze")


# ===========================================================================
# Group 13: unmark_sheet_parsed_check_done (Slice D1)
# ===========================================================================

class TestUnmarkSheetParsedCheckDone(FrappeTestCase):
    """
    Verifies unmark_sheet_parsed_check_done (Slice D1 Un-mark):
      U1 -- a checked sheet reverts to "Parsed";
      U2 -- a non-checked ("Parsed") sheet is rejected; status unchanged;
      U3 -- round-trip: mark (clean) -> a write is freeze-blocked -> unmark ->
            the same write now succeeds.

    Fixture (CleanSheet-shaped so mark produces no breaks):
      Row 0 -- preamble,  parent=None
      Row 1 -- line_item, parent=0
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Unmark Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "UnmarkSheet", "sheet_order": 1, "wizard_status": "Parsed",
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name
        cls.sheet_name = "UnmarkSheet"

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name})
        frappe.db.commit()
        _insert_rows(self.boq_name, [
            _minimal_row(self.sheet_name, 0, "preamble", parent_index=None),
            _minimal_row(self.sheet_name, 1, "line_item", parent_index=0),
        ])
        self._set_status("Parsed")

    def _draft_name(self):
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq_name, "parenttype": "BOQs", "sheet_name": self.sheet_name},
            "name",
        )

    def _set_status(self, status):
        frappe.db.set_value("BoQ Sheet Draft", self._draft_name(), "wizard_status", status)
        frappe.db.commit()

    def _get_status(self):
        return frappe.db.get_value("BoQ Sheet Draft", self._draft_name(), "wizard_status") or ""

    def _get_remark(self, row_index):
        name = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.boq_name, "sheet_name": self.sheet_name, "row_index": row_index},
            "name",
        )
        return frappe.db.get_value("BoQ Review Row", name, "remarks")

    def test_U1_unmark_checked_reverts_to_parsed(self):
        """U1: un-marking a checked sheet returns ok:True + status 'Parsed'."""
        self._set_status("Finalized")
        result = unmark_sheet_parsed_check_done(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "Parsed")
        self.assertEqual(self._get_status(), "Parsed")

    def test_U2_unmark_non_checked_rejected(self):
        """U2: un-marking a 'Parsed' (not checked) sheet throws; status unchanged."""
        with self.assertRaises(frappe.ValidationError):
            unmark_sheet_parsed_check_done(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
            )
        self.assertEqual(self._get_status(), "Parsed", "status must be unchanged")

    def test_U3_round_trip_mark_freeze_unmark_unfreezes(self):
        """U3: mark (clean) -> a write is blocked -> unmark -> the write succeeds."""
        mark_res = mark_sheet_parsed_check_done(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
        )
        self.assertTrue(mark_res["ok"])
        self.assertEqual(self._get_status(), "Finalized")
        # Freeze: a remark write is blocked.
        with self.assertRaises(frappe.ValidationError):
            save_review_remark(
                boq_name=self.boq_name, sheet_name=self.sheet_name,
                row_index=0, remark="should be blocked",
            )
        # Un-mark -> back to "Parsed".
        unmark_res = unmark_sheet_parsed_check_done(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
        )
        self.assertEqual(unmark_res["status"], "Parsed")
        # The same write now succeeds.
        ok = save_review_remark(
            boq_name=self.boq_name, sheet_name=self.sheet_name,
            row_index=0, remark="now allowed",
        )
        self.assertTrue(ok["ok"])
        self.assertEqual(self._get_remark(0), "now allowed", "the write must land after unmark")


# ===========================================================================
# Group: parse-in-progress write guard (#164 A3-backend)
# ===========================================================================

class TestParseInProgressWriteGuard(FrappeTestCase):
    """All four BoQ Review Row write endpoints reject a write to a sheet whose
    parse is in flight, and pass through when it is not.

    GuardSheet (wizard_status='Parsed', parse_in_progress=1) is the parsing sheet;
    OpenSheet (wizard_status='Parsed', parse_in_progress=0) is the unmarked control.
    GuardSheet is deliberately NOT 'Finalized' so the frozen guard cannot
    fire first -- only the parse-in-progress guard can reject."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Parse Guard Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.append("sheet_drafts", {
            "sheet_name": "GuardSheet", "sheet_order": 1,
            "wizard_status": "Parsed", "parse_in_progress": 1,
        })
        boq.append("sheet_drafts", {
            "sheet_name": "OpenSheet", "sheet_order": 2,
            "wizard_status": "Parsed", "parse_in_progress": 0,
        })
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq_name = boq.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq_name})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete("BoQ Review Row", {"boq": self.boq_name})
        for sheet in ("GuardSheet", "OpenSheet"):
            _insert_rows(self.boq_name, [
                _minimal_row(sheet, 0, "preamble", parent_index=None),
                _minimal_row(sheet, 1, "line_item", parent_index=0),
            ])

    # -- rejections (parse_in_progress == 1) -----------------------------

    def test_save_review_edit_rejected(self):
        with self.assertRaises(frappe.ValidationError):
            save_review_edit(
                boq_name=self.boq_name, sheet_name="GuardSheet",
                row_index=1, field="qty_total", value=5,
            )

    def test_save_review_restructure_rejected(self):
        with self.assertRaises(frappe.ValidationError):
            save_review_restructure(
                boq_name=self.boq_name, sheet_name="GuardSheet",
                row_index=1, new_classification="line_item",
            )

    def test_save_review_remark_rejected(self):
        with self.assertRaises(frappe.ValidationError):
            save_review_remark(
                boq_name=self.boq_name, sheet_name="GuardSheet",
                row_index=1, remark="nope",
            )

    def test_dismiss_row_flags_rejected(self):
        with self.assertRaises(frappe.ValidationError):
            dismiss_row_flags(
                boq_name=self.boq_name, sheet_name="GuardSheet",
                row_index=1, dismissed=True,
            )

    # -- pass-through (parse_in_progress == 0) ---------------------------

    def test_unmarked_sheet_edit_passes_through(self):
        res = save_review_edit(
            boq_name=self.boq_name, sheet_name="OpenSheet",
            row_index=1, field="qty_total", value=7,
        )
        self.assertTrue(res["ok"], "edit on a non-parsing sheet must succeed")
