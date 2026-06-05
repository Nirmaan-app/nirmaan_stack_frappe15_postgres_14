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
    append_edit_log_entry,
    check_structural_integrity,
    get_review_rows,
    mark_sheet_parsed_check_done,
    resolve_effective,
    save_review_edit,
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
):
    """Return a minimal BoQ Review Row field dict for _insert_rows.

    parent_index=None means root row -> stored as -1 (Frappe coerces Int None->0
    and 0 is a valid non-root index; -1 is the unambiguous "no parent" sentinel).
    human_parent=None means no override -> stored as -1 for the same reason.
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
    }


# ===========================================================================
# Group 1: resolve_effective -- pure Python
# ===========================================================================

class TestResolveEffective(unittest.TestCase):
    """Verify human > parser precedence for classification and parent_index."""

    def _row(self, classification=None, human_classification=None,
             parent_index=None, human_parent=None):
        return {
            "classification": classification,
            "human_classification": human_classification,
            "parent_index": parent_index,
            "human_parent": human_parent,
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


# ===========================================================================
# Group 6: mark_sheet_parsed_check_done -- DB
# ===========================================================================

class TestMarkSheetParsedCheckDone(FrappeTestCase):
    """
    Verifies the confirm-gate (ok:False when breaks + confirm=False) and the
    status transition to "Parsed Check Done" with correct overridden flag.

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
        self.assertEqual(result["status"], "Parsed Check Done")
        self.assertFalse(result["overridden"],
                         "overridden must be False when there are no breaks")
        self.assertEqual(self._get_wizard_status("CleanSheet"), "Parsed Check Done",
                         "wizard_status must be written to 'Parsed Check Done'")

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
        self.assertEqual(result["status"], "Parsed Check Done")
        self.assertTrue(result["overridden"],
                        "overridden must be True when breaks existed and user confirmed past them")
        self.assertEqual(self._get_wizard_status("BreakSheet"), "Parsed Check Done",
                         "wizard_status must be written to 'Parsed Check Done' when confirmed")
