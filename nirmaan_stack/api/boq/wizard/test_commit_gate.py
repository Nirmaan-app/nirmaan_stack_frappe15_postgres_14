# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""
Tests for the BoQ commit gate (Phase 5 Slice 2).

Two layers:
  TestComputeCommittableSheets -- the PURE helper, injected dicts, no DB. Drives
    the full status table incl. blank "" (which a reqd Select column cannot hold
    as a real row, so the pure layer is the authoritative blank check).
  TestGetCommittableSheetsEndpoint -- the whitelisted endpoint end-to-end against
    a real BoQ with mixed sheet_drafts + a general_specs_sheets pointer; proves
    the read pattern, the pointer-based general-specs designation, the
    parse-vs-commit distinction, and the overlap precedence.

The gate is READ-ONLY: these tests assert the returned eligibility list only;
nothing here commits, writes BOQ Nodes, or changes wizard_status.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.commit_gate import (
    compute_committable_sheets,
    get_committable_sheets,
)

_TEST_PROJECT = "_TEST_BOQ_PROJECT_COMMIT_GATE"

# Every wizard_status that must be NOT commit-eligible (incl. blank "").
_INELIGIBLE_STATUSES = [
    "",
    "Pending",
    "Hidden",
    "Config Done",
    "Skip",
    "Parse failed",
    "Parsed",
]


class TestComputeCommittableSheets(FrappeTestCase):
    """The pure eligibility rule -- injected sheet data, no DB."""

    # T1 (positive -- Finalized).
    def test_finalized_is_eligible_disposition_finalized(self):
        result = compute_committable_sheets(
            [{"sheet_name": "S1", "wizard_status": "Finalized"}],
            general_specs_sheet_names=set(),
        )
        self.assertEqual(result, [{"sheet_name": "S1", "disposition": "finalized"}])

    # T2 (positive -- general specs via the pointer, NOT wizard_status).
    def test_general_specs_pointer_is_eligible_disposition_general_specs(self):
        # The designated sheet's stored wizard_status is "Skip" -- a real-data case
        # (designation is a pointer overlay that never writes wizard_status). It must
        # STILL be eligible as general_specs purely from pointer membership.
        result = compute_committable_sheets(
            [{"sheet_name": "GS", "wizard_status": "Skip"}],
            general_specs_sheet_names={"GS"},
        )
        self.assertEqual(result, [{"sheet_name": "GS", "disposition": "general_specs"}])

    # T3 (negative -- every ineligible status, table-driven).
    def test_each_ineligible_status_is_not_eligible(self):
        for status in _INELIGIBLE_STATUSES:
            with self.subTest(status=status or "<blank>"):
                result = compute_committable_sheets(
                    [{"sheet_name": "X", "wizard_status": status}],
                    general_specs_sheet_names=set(),
                )
                self.assertEqual(result, [], f"status {status!r} must NOT be eligible")

    # T4 (mixed -- exactly the eligible subset, in input order, nothing more/less).
    def test_mixed_returns_exact_eligible_subset(self):
        drafts = [
            {"sheet_name": "Fin", "wizard_status": "Finalized"},
            {"sheet_name": "Cfg", "wizard_status": "Config Done"},
            {"sheet_name": "GS", "wizard_status": "Skip"},   # designated below
            {"sheet_name": "Par", "wizard_status": "Parsed"},
            {"sheet_name": "Pen", "wizard_status": "Pending"},
            {"sheet_name": "Hid", "wizard_status": "Hidden"},
        ]
        result = compute_committable_sheets(drafts, general_specs_sheet_names={"GS"})
        self.assertEqual(result, [
            {"sheet_name": "Fin", "disposition": "finalized"},
            {"sheet_name": "GS", "disposition": "general_specs"},
        ])

    # T5 (the parse-vs-commit distinction -- regression guard).
    def test_finalized_commit_eligible_despite_parse_not_eligible(self):
        # assemble_mapping_config treats "Finalized" as not_eligible by default
        # (parses only under force_reparse). The COMMIT gate is the opposite:
        # "Finalized" IS commit-eligible here, with NO force_reparse / parse logic
        # consulted. This proves the two gates stay distinct.
        result = compute_committable_sheets(
            [{"sheet_name": "F", "wizard_status": "Finalized"}],
            general_specs_sheet_names=set(),
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["disposition"], "finalized")

    # T6 (overlap precedence -- general_specs wins over Finalized).
    def test_finalized_and_general_specs_overlap_resolves_to_general_specs(self):
        result = compute_committable_sheets(
            [{"sheet_name": "Both", "wizard_status": "Finalized"}],
            general_specs_sheet_names={"Both"},
        )
        self.assertEqual(
            result, [{"sheet_name": "Both", "disposition": "general_specs"}],
            "a Finalized + general-specs-designated sheet must commit as general_specs",
        )

    # #152 -- pointer membership is verbatim (trailing space not trimmed).
    def test_general_specs_pointer_matched_verbatim(self):
        # "Elec " (trailing space) is designated; "Elec" (no space) is a different
        # sheet and must NOT pick up the designation.
        drafts = [
            {"sheet_name": "Elec ", "wizard_status": "Parsed"},
            {"sheet_name": "Elec", "wizard_status": "Parsed"},
        ]
        result = compute_committable_sheets(drafts, general_specs_sheet_names={"Elec "})
        self.assertEqual(result, [{"sheet_name": "Elec ", "disposition": "general_specs"}])


class TestGetCommittableSheetsEndpoint(FrappeTestCase):
    """The whitelisted endpoint end-to-end against a real mixed BoQ."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT
        boq.boq_name = "Shared Test BoQ for Commit Gate"

        # Mixed sheet_drafts: 2 directly eligible + 1 overlap + 5 ineligible.
        drafts = [
            ("Sheet_Finalized", "Finalized"),
            ("Sheet_GenSpecs", "Skip"),        # designated via pointer below
            ("Sheet_Overlap", "Finalized"),    # ALSO designated below (overlap)
            ("Sheet_ConfigDone", "Config Done"),
            ("Sheet_Parsed", "Parsed"),
            ("Sheet_Skip", "Skip"),            # NOT designated
            ("Sheet_Hidden", "Hidden"),
            ("Sheet_Pending", "Pending"),
            ("Sheet_ParseFailed", "Parse failed"),
        ]
        for order, (name, status) in enumerate(drafts, start=1):
            boq.append("sheet_drafts", {
                "sheet_name": name,
                "sheet_order": order,
                "wizard_status": status,
            })

        # General-specs pointer overlay (NOT wizard_status): two designated sheets.
        for name in ("Sheet_GenSpecs", "Sheet_Overlap"):
            boq.append("general_specs_sheets", {"source_sheet_name": name})

        boq.insert(ignore_permissions=True, ignore_links=True)
        cls.boq_name = boq.name
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "boq_name"):
            frappe.db.delete("BOQs", {"name": cls.boq_name})
        frappe.db.commit()
        super().tearDownClass()

    def _committable(self):
        result = get_committable_sheets(self.boq_name)
        return result["committable_sheets"]

    # T4 end-to-end: exactly the eligible subset, nothing more/less.
    def test_endpoint_returns_exact_eligible_subset(self):
        rows = self._committable()
        as_pairs = {(r["sheet_name"], r["disposition"]) for r in rows}
        self.assertEqual(as_pairs, {
            ("Sheet_Finalized", "finalized"),
            ("Sheet_GenSpecs", "general_specs"),
            ("Sheet_Overlap", "general_specs"),  # overlap precedence
        })
        self.assertEqual(len(rows), 3, "no ineligible sheet may leak in")

    # T1 end-to-end.
    def test_endpoint_finalized_eligible(self):
        rows = {r["sheet_name"]: r["disposition"] for r in self._committable()}
        self.assertEqual(rows.get("Sheet_Finalized"), "finalized")

    # T2 end-to-end (pointer-designated sheet stored as Skip).
    def test_endpoint_general_specs_eligible(self):
        rows = {r["sheet_name"]: r["disposition"] for r in self._committable()}
        self.assertEqual(rows.get("Sheet_GenSpecs"), "general_specs")

    # T3 end-to-end: none of the ineligible statuses appear.
    def test_endpoint_excludes_ineligible_statuses(self):
        names = {r["sheet_name"] for r in self._committable()}
        for ineligible in (
            "Sheet_ConfigDone", "Sheet_Parsed", "Sheet_Skip",
            "Sheet_Hidden", "Sheet_Pending", "Sheet_ParseFailed",
        ):
            self.assertNotIn(ineligible, names)

    # T6 end-to-end: overlap commits as general_specs.
    def test_endpoint_overlap_resolves_to_general_specs(self):
        rows = {r["sheet_name"]: r["disposition"] for r in self._committable()}
        self.assertEqual(rows.get("Sheet_Overlap"), "general_specs")

    def test_endpoint_unknown_boq_throws(self):
        with self.assertRaises(frappe.exceptions.ValidationError):
            get_committable_sheets("BOQ-DOES-NOT-EXIST-999")
