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
    get_committed_state,
    get_sheet_versions,
)

_TEST_PROJECT = "_TEST_BOQ_PROJECT_COMMIT_GATE"
_TEST_PROJECT_COMMITTED = "_TEST_BOQ_PROJECT_COMMITTED_STATE"

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


class TestGetCommittedState(FrappeTestCase):
    """The READ-ONLY committed-state endpoint over the BoQ Committed Sheet Grid tier.

    Seeds grid rows directly (no commit pipeline run): a current + a prior frozen
    version per sheet proves is_current filtering; a trailing-space sheet name proves
    the #152 verbatim guard; a separate empty BoQ proves the empty case. Nothing here
    writes through commit_boq -- it asserts the read shape only.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # BoQ WITH committed grid rows.
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT_COMMITTED
        boq.boq_name = "Shared Test BoQ for Committed State"
        boq.insert(ignore_permissions=True, ignore_links=True)
        cls.boq_name = boq.name

        # A SECOND BoQ with NO committed grid rows (the empty case).
        empty = frappe.new_doc("BOQs")
        empty.project = _TEST_PROJECT_COMMITTED
        empty.boq_name = "Shared Test BoQ for Committed State (empty)"
        empty.insert(ignore_permissions=True, ignore_links=True)
        cls.empty_boq_name = empty.name

        # Grid rows on cls.boq_name:
        #  Sheet_A -- a prior frozen v1 (is_current=0) + a current v2 (is_current=1)
        #             => only v2 may surface.
        #  Sheet_B -- a single current v1.
        #  "Elec " -- a current v1 with a trailing space (the #152 verbatim key).
        cls._make_grid_row(cls.boq_name, "Sheet_A", 1, 0, "2026-06-16 09:00:00")
        cls._make_grid_row(cls.boq_name, "Sheet_A", 2, 1, "2026-06-17 10:30:00")
        cls._make_grid_row(cls.boq_name, "Sheet_B", 1, 1, "2026-06-17 11:15:00")
        cls._make_grid_row(cls.boq_name, "Elec ", 1, 1, "2026-06-17 12:00:00")
        frappe.db.commit()

    @staticmethod
    def _make_grid_row(boq, sheet_name, version, is_current, committed_at):
        doc = frappe.new_doc("BoQ Committed Sheet Grid")
        doc.boq = boq
        doc.source_sheet_name = sheet_name
        doc.commit_version = version
        doc.is_current = is_current
        doc.committed_at = committed_at  # read_only on the form; settable server-side
        doc.insert(ignore_permissions=True, ignore_links=True)
        return doc.name

    @classmethod
    def tearDownClass(cls):
        for name in (getattr(cls, "boq_name", None), getattr(cls, "empty_boq_name", None)):
            if name:
                frappe.db.delete("BoQ Committed Sheet Grid", {"boq": name})
                frappe.db.delete("BOQs", {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _state(self, boq_name):
        return get_committed_state(boq_name)["committed_state"]

    def test_returns_current_committed_state(self):
        by_sheet = {r["sheet_name"]: r for r in self._state(self.boq_name)}
        # Sheet_B -- a single current version, committed_at + commit_version present.
        self.assertIn("Sheet_B", by_sheet)
        self.assertEqual(by_sheet["Sheet_B"]["commit_version"], 1)
        self.assertEqual(
            frappe.utils.get_datetime(by_sheet["Sheet_B"]["committed_at"]),
            frappe.utils.get_datetime("2026-06-17 11:15:00"),
        )

    def test_excludes_superseded_versions(self):
        rows = [r for r in self._state(self.boq_name) if r["sheet_name"] == "Sheet_A"]
        # Exactly the current row -- the frozen v1 (is_current=0) must NOT surface.
        self.assertEqual(len(rows), 1, "only the is_current=1 row may surface")
        self.assertEqual(rows[0]["commit_version"], 2)
        self.assertEqual(
            frappe.utils.get_datetime(rows[0]["committed_at"]),
            frappe.utils.get_datetime("2026-06-17 10:30:00"),
        )

    def test_sheet_name_verbatim_trailing_space(self):
        names = {r["sheet_name"] for r in self._state(self.boq_name)}
        # The trailing-space key round-trips verbatim; the trimmed form is absent.
        self.assertIn("Elec ", names)
        self.assertNotIn("Elec", names)

    def test_empty_boq_returns_empty(self):
        self.assertEqual(
            get_committed_state(self.empty_boq_name), {"committed_state": []}
        )

    def test_unknown_boq_throws(self):
        with self.assertRaises(frappe.exceptions.ValidationError):
            get_committed_state("BOQ-DOES-NOT-EXIST-999")


class TestGetCommittedStateOrdering(FrappeTestCase):
    """Slice 3d: get_committed_state now carries sheet_order (sourced from the committed
    BoQ Sheet tier, NOT the grid tier) and returns the sheets in WORKBOOK ORDER.

    Seeds committed grid rows (the committed-state source) AND the matching current
    BoQ Sheet rows (the sheet_order source) with sheet_order OUT of natural order, then
    asserts every entry carries sheet_order and the list comes back ordered by it.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT_COMMITTED
        boq.boq_name = "Shared Test BoQ for Committed State Ordering"
        boq.insert(ignore_permissions=True, ignore_links=True)
        cls.boq_name = boq.name

        # Three committed sheets seeded OUT of natural order: Gamma(3), Alpha(1), Beta(2).
        # Grid rows = the committed-state source; BoQ Sheet rows = the sheet_order source.
        seed = [("Gamma", 3), ("Alpha", 1), ("Beta", 2)]
        for name, order in seed:
            grid = frappe.new_doc("BoQ Committed Sheet Grid")
            grid.boq = cls.boq_name
            grid.source_sheet_name = name
            grid.commit_version = 1
            grid.is_current = 1
            grid.committed_at = "2026-06-17 10:00:00"
            grid.insert(ignore_permissions=True, ignore_links=True)

            sheet = frappe.new_doc("BoQ Sheet")
            sheet.boq = cls.boq_name
            sheet.sheet_name = name
            sheet.sheet_order = order
            sheet.commit_version = 1
            sheet.is_current = 1
            sheet.insert(ignore_permissions=True, ignore_links=True)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        name = getattr(cls, "boq_name", None)
        if name:
            frappe.db.delete("BoQ Committed Sheet Grid", {"boq": name})
            frappe.db.delete("BoQ Sheet", {"boq": name})
            frappe.db.delete("BOQs", {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def test_shape_includes_sheet_order_and_result_is_ordered(self):
        rows = get_committed_state(self.boq_name)["committed_state"]
        # Every entry now carries sheet_order.
        for r in rows:
            self.assertIn("sheet_order", r)
        # Out-of-order seed -> returned in workbook order (sheet_order ascending).
        self.assertEqual([r["sheet_name"] for r in rows], ["Alpha", "Beta", "Gamma"])
        self.assertEqual([r["sheet_order"] for r in rows], [1, 2, 3])


class TestGetCommittedStateDisposition(FrappeTestCase):
    """get_committed_state surfaces the sheet_disposition discriminator (grid_only /
    grid_and_nodes) so the pricing editor can fork a grid-only general-specs sheet to a
    read-only faithful-grid view. Seeds one grid_only + one grid_and_nodes current grid
    row and asserts each surfaces its own disposition."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT_COMMITTED
        boq.boq_name = "Shared Test BoQ for Committed State Disposition"
        boq.insert(ignore_permissions=True, ignore_links=True)
        cls.boq_name = boq.name

        for name, disp in (("Specs", "grid_only"), ("Electrical", "grid_and_nodes")):
            grid = frappe.new_doc("BoQ Committed Sheet Grid")
            grid.boq = cls.boq_name
            grid.source_sheet_name = name
            grid.sheet_disposition = disp
            grid.commit_version = 1
            grid.is_current = 1
            grid.committed_at = "2026-06-21 10:00:00"
            grid.insert(ignore_permissions=True, ignore_links=True)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        name = getattr(cls, "boq_name", None)
        if name:
            frappe.db.delete("BoQ Committed Sheet Grid", {"boq": name})
            frappe.db.delete("BOQs", {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def test_disposition_surfaces_per_sheet(self):
        by_sheet = {
            r["sheet_name"]: r for r in get_committed_state(self.boq_name)["committed_state"]
        }
        self.assertEqual(by_sheet["Specs"]["sheet_disposition"], "grid_only")
        self.assertEqual(by_sheet["Electrical"]["sheet_disposition"], "grid_and_nodes")


class TestGetCommittedStateStaleness(FrappeTestCase):
    """Slice 5b: get_committed_state additionally returns last_exported_at + a computed
    pricing_changed_since_export boolean. Seeds, per scenario, a current grid row + a matching
    current BoQ Sheet (carrying last_exported_at) + pricing/color/remark rows (carrying
    priced_at/colored_at/remarked_at), and asserts the boolean -- including version isolation
    (an OLD commit_version's timestamp must NOT mark the CURRENT version stale)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT_COMMITTED
        boq.boq_name = "Shared Test BoQ for Committed State Staleness"
        boq.insert(ignore_permissions=True, ignore_links=True)
        cls.boq_name = boq.name

        T_EARLY = "2026-06-20 10:00:00"
        T_LATE = "2026-06-21 10:00:00"
        T_LATER = "2026-06-22 10:00:00"

        # Stale: exported EARLY, priced LATE -> changed since export.
        cls._seed(cls.boq_name, "Stale", 1, last_exported=T_EARLY, priced_at=T_LATE)
        # Fresh: priced LATE, exported LATER -> not stale.
        cls._seed(cls.boq_name, "Fresh", 1, last_exported=T_LATER, priced_at=T_LATE)
        # NeverExported: content exists, never exported -> stale.
        cls._seed(cls.boq_name, "NeverExported", 1, last_exported=None, priced_at=T_LATE)
        # NoContent: exported, but nothing priced/colored/remarked -> not stale.
        cls._seed(cls.boq_name, "NoContent", 1, last_exported=T_EARLY)
        # ColorDriven: a COLOR after export drives staleness (not just rates).
        cls._seed(cls.boq_name, "ColorDriven", 1, last_exported=T_EARLY, colored_at=T_LATE)
        # OldVer: current version 2 exported EARLY; a priced row on the OLD version 1 (is_current=1
        # for ITS identity) at T_LATE must NOT mark version 2 stale.
        cls._seed(cls.boq_name, "OldVer", 2, last_exported=T_EARLY)
        cls._price(cls.boq_name, "OldVer", 1, T_LATE)  # old-version content, current for its id
        frappe.db.commit()

    @staticmethod
    def _grid(boq, sheet, version):
        d = frappe.new_doc("BoQ Committed Sheet Grid")
        d.boq = boq
        d.source_sheet_name = sheet
        d.commit_version = version
        d.is_current = 1
        d.committed_at = "2026-06-19 09:00:00"
        d.insert(ignore_permissions=True, ignore_links=True)

    @staticmethod
    def _boqsheet(boq, sheet, version, last_exported):
        d = frappe.new_doc("BoQ Sheet")
        d.boq = boq
        d.sheet_name = sheet
        d.sheet_order = 1
        d.treat_as = "data"
        d.commit_version = version
        d.is_current = 1
        d.committed_at = "2026-06-19 09:00:00"
        if last_exported:
            d.last_exported_at = last_exported
        d.insert(ignore_permissions=True, ignore_links=True)

    @staticmethod
    def _price(boq, sheet, version, priced_at):
        d = frappe.new_doc("BoQ Cell Pricing")
        d.boq = boq
        d.sheet_name = sheet
        d.excel_row = 10
        d.col_letter = "E"
        d.committed_version = version
        d.rate = 100.0
        d.is_filled = 1
        d.pricing_version = 1
        d.is_current = 1
        d.priced_at = priced_at
        d.insert(ignore_permissions=True, ignore_links=True)

    @staticmethod
    def _color(boq, sheet, version, colored_at):
        d = frappe.new_doc("BoQ Cell Color")
        d.boq = boq
        d.sheet_name = sheet
        d.excel_row = 10
        d.col_letter = "B"
        d.committed_version = version
        d.color = "red"
        d.color_version = 1
        d.is_current = 1
        d.colored_at = colored_at
        d.insert(ignore_permissions=True, ignore_links=True)

    @classmethod
    def _seed(cls, boq, sheet, version, last_exported=None, priced_at=None, colored_at=None):
        cls._grid(boq, sheet, version)
        cls._boqsheet(boq, sheet, version, last_exported)
        if priced_at:
            cls._price(boq, sheet, version, priced_at)
        if colored_at:
            cls._color(boq, sheet, version, colored_at)

    @classmethod
    def tearDownClass(cls):
        name = getattr(cls, "boq_name", None)
        if name:
            for dt in ("BoQ Cell Pricing", "BoQ Cell Color", "BoQ Cell Remark",
                       "BoQ Sheet", "BoQ Committed Sheet Grid"):
                frappe.db.delete(dt, {"boq": name})
            frappe.db.delete("BOQs", {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _by_sheet(self):
        return {r["sheet_name"]: r for r in get_committed_state(self.boq_name)["committed_state"]}

    def test_last_exported_at_surfaces(self):
        bs = self._by_sheet()
        self.assertIsNotNone(bs["Stale"]["last_exported_at"], "exported sheet carries the timestamp")
        self.assertIsNone(bs["NeverExported"]["last_exported_at"], "never-exported sheet is None")

    def test_stale_true_when_change_after_export(self):
        self.assertTrue(self._by_sheet()["Stale"]["pricing_changed_since_export"])

    def test_fresh_false_when_export_after_change(self):
        self.assertFalse(self._by_sheet()["Fresh"]["pricing_changed_since_export"])

    def test_never_exported_with_content_is_true(self):
        self.assertTrue(self._by_sheet()["NeverExported"]["pricing_changed_since_export"])

    def test_no_content_is_false(self):
        self.assertFalse(self._by_sheet()["NoContent"]["pricing_changed_since_export"])

    def test_color_change_also_marks_stale(self):
        self.assertTrue(self._by_sheet()["ColorDriven"]["pricing_changed_since_export"],
                        "a color edit after export marks the sheet stale, not just rates")

    def test_version_isolation_old_version_not_stale(self):
        # OldVer current = v2 (exported early); the only content is on v1 -> NOT stale.
        self.assertFalse(self._by_sheet()["OldVer"]["pricing_changed_since_export"],
                         "an old version's timestamp must not mark the current version stale")


class TestGetSheetVersions(FrappeTestCase):
    """get_sheet_versions -- the READ-ONLY version-dropdown list (Phase 5 version-view). Seeds ONE
    sheet with three committed grid versions: v1 (committed early, NEVER priced), v2 (priced ->
    last_change_at set), v3 (current, never priced). Asserts the list is version-desc, carries the
    is_current / committed_at / sheet_disposition fields, and that last_change_at is the max pricing
    change (None -> the never-priced committed_at-fallback case the client handles). sheet_name
    carries a trailing space (#152)."""

    _PROJECT = "_TEST_BOQ_PROJECT_SHEET_VERSIONS"
    SHEET = "Ver List "  # VERBATIM trailing space (#152)
    T1 = "2026-06-17 09:00:00"
    T2 = "2026-06-18 09:00:00"
    T3 = "2026-06-19 09:00:00"
    T_PRICED = "2026-06-18 15:30:00"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = cls._PROJECT
        boq.boq_name = "Shared Test BoQ for Sheet Versions"
        boq.insert(ignore_permissions=True, ignore_links=True)
        cls.boq_name = boq.name

        # Three committed grid versions of the SAME sheet (v3 current). v2 is priced.
        cls._grid(cls.boq_name, cls.SHEET, 1, is_current=0, committed_at=cls.T1,
                  disposition="grid_and_nodes")
        cls._grid(cls.boq_name, cls.SHEET, 2, is_current=0, committed_at=cls.T2,
                  disposition="grid_and_nodes")
        cls._grid(cls.boq_name, cls.SHEET, 3, is_current=1, committed_at=cls.T3,
                  disposition="grid_and_nodes")
        cls._price(cls.boq_name, cls.SHEET, 2, cls.T_PRICED)
        frappe.db.commit()

    @staticmethod
    def _grid(boq, sheet, version, is_current, committed_at, disposition):
        d = frappe.new_doc("BoQ Committed Sheet Grid")
        d.boq = boq
        d.source_sheet_name = sheet
        d.commit_version = version
        d.is_current = is_current
        d.committed_at = committed_at
        d.sheet_disposition = disposition
        d.insert(ignore_permissions=True, ignore_links=True)

    @staticmethod
    def _price(boq, sheet, version, priced_at):
        d = frappe.new_doc("BoQ Cell Pricing")
        d.boq = boq
        d.sheet_name = sheet
        d.excel_row = 10
        d.col_letter = "E"
        d.committed_version = version
        d.rate = 100.0
        d.is_filled = 1
        d.pricing_version = 1
        d.is_current = 1
        d.priced_at = priced_at
        d.insert(ignore_permissions=True, ignore_links=True)

    @classmethod
    def tearDownClass(cls):
        name = getattr(cls, "boq_name", None)
        if name:
            for dt in ("BoQ Cell Pricing", "BoQ Committed Sheet Grid"):
                frappe.db.delete(dt, {"boq": name})
            frappe.db.delete("BOQs", {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _versions(self):
        return get_sheet_versions(boq_name=self.boq_name, sheet_name=self.SHEET)["versions"]

    def test_returns_all_versions_desc(self):
        vs = self._versions()
        self.assertEqual([v["commit_version"] for v in vs], [3, 2, 1],
                         "every committed version, sorted version-descending")

    def test_is_current_flag(self):
        by_v = {v["commit_version"]: v for v in self._versions()}
        self.assertTrue(by_v[3]["is_current"], "v3 is the current version")
        self.assertFalse(by_v[2]["is_current"])
        self.assertFalse(by_v[1]["is_current"])

    def test_last_change_at_for_priced_version(self):
        by_v = {v["commit_version"]: v for v in self._versions()}
        self.assertEqual(frappe.utils.get_datetime(by_v[2]["last_change_at"]),
                         frappe.utils.get_datetime(self.T_PRICED),
                         "a priced version's last_change_at = its max pricing change")

    def test_never_priced_versions_have_no_change(self):
        by_v = {v["commit_version"]: v for v in self._versions()}
        self.assertIsNone(by_v[1]["last_change_at"], "v1 was never priced -> None (committed_at fallback)")
        self.assertIsNone(by_v[3]["last_change_at"], "v3 was never priced -> None")

    def test_committed_at_and_disposition_surface(self):
        by_v = {v["commit_version"]: v for v in self._versions()}
        self.assertEqual(frappe.utils.get_datetime(by_v[1]["committed_at"]),
                         frappe.utils.get_datetime(self.T1))
        self.assertEqual(by_v[3]["sheet_disposition"], "grid_and_nodes")

    def test_missing_args_and_unknown_boq_throw(self):
        with self.assertRaises(frappe.ValidationError):
            get_sheet_versions(boq_name=self.boq_name)  # no sheet
        with self.assertRaises(frappe.ValidationError):
            get_sheet_versions(boq_name="NO_SUCH_BOQ", sheet_name=self.SHEET)
