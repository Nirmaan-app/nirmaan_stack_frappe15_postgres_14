# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for the BoQ pricing layer (Phase 5 Slice 1b): the BoQ Cell Pricing doctype +
the save_cell_price / get_sheet_pricing endpoints.

Coverage matrix:
  POS  save -> a current, is_filled=1 pricing record at the Excel-address key, pricing_version=1.
  POS  re-save the same cell -> prior frozen (is_current=0), new current pricing_version=2
       (freeze-and-supersede), exactly ONE current (the invariant).
  POS  multi-area -> two prices at the same excel_row, different col_letter, both current + distinct.
  POS  read -> get_sheet_pricing returns the current set for (boq, sheet, committed_version).
  NEG  save to a non-existent cell / sheet / committed_version -> throws (no price for a non-cell).
  NEG  missing required args -> throws.

The committed-node fixture (build_committed_sheet_fixture) is the SHARED hermetic builder
(defined in test_review_screen.py) -- the committed tier is read-only here; the pricing layer
sits on top of it. sheet_name carries a trailing space (#152) throughout.
"""
import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.pricing import (
    get_priced_rows,
    get_sheet_pricing,
    save_cell_price,
)
from nirmaan_stack.api.boq.wizard.review_screen import get_committed_rows
from nirmaan_stack.api.boq.wizard.test_review_screen import (
    _cleanup_project,
    _make_project,
    build_committed_sheet_fixture,
    cleanup_committed_fixture,
)

_PRICING = "BoQ Cell Pricing"


class TestCellPricing(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Pricing Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        cls.sheet = "Pricing Fix "  # VERBATIM trailing space (#152)
        cls.cv = 1
        cls.fixture = build_committed_sheet_fixture(cls.boq, cls.sheet, commit_version=cls.cv)
        # fixture line items: source_row 34 (li[0]) + 35 (li[1]); rate cols E (Phase 1) / H (Phase 2)
        cls.li_34 = cls.fixture["line_items"][0]

    @classmethod
    def tearDownClass(cls):
        cleanup_committed_fixture(cls.boq)
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        # Each test starts with a clean pricing layer (the committed fixture persists).
        frappe.db.delete(_PRICING, {"boq": self.boq})
        frappe.db.commit()

    # -- helpers ------------------------------------------------------------

    def _current(self, excel_row, col_letter):
        return frappe.get_all(
            _PRICING,
            filters={"boq": self.boq, "sheet_name": self.sheet, "excel_row": excel_row,
                     "col_letter": col_letter, "committed_version": self.cv, "is_current": 1},
            fields=["name", "rate", "is_filled", "pricing_version", "node", "area", "rate_kind"],
        )

    def _all_versions(self, excel_row, col_letter):
        return frappe.get_all(
            _PRICING,
            filters={"boq": self.boq, "sheet_name": self.sheet, "excel_row": excel_row,
                     "col_letter": col_letter, "committed_version": self.cv},
            fields=["pricing_version", "is_current", "rate"],
            order_by="pricing_version asc",
        )

    # -- POSITIVE -----------------------------------------------------------

    def test_save_creates_current_filled_record_v1(self):
        res = save_cell_price(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
            committed_version=self.cv, rate=150.0, area="Phase 1", rate_kind="combined",
            description="cable 1.1.2",
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["pricing_version"], 1)
        self.assertEqual(res["froze_prior"], 0, "first save freezes nothing")
        cur = self._current(34, "E")
        self.assertEqual(len(cur), 1, "exactly one current pricing record")
        self.assertEqual(cur[0]["rate"], 150.0)
        self.assertEqual(cur[0]["is_filled"], 1, "the layer's own filled-flag is set (node 0.0 is not it)")
        self.assertEqual(cur[0]["node"], self.li_34, "the resolved committed node is stored as the pointer")
        self.assertEqual(cur[0]["area"], "Phase 1")

    def test_resave_freezes_prior_and_supersedes(self):
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                        committed_version=self.cv, rate=150.0)
        res2 = save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                               committed_version=self.cv, rate=175.0)
        self.assertEqual(res2["pricing_version"], 2)
        self.assertEqual(res2["froze_prior"], 1, "the re-save froze the prior current")
        cur = self._current(34, "E")
        self.assertEqual(len(cur), 1, "exactly ONE current after re-save (freeze-and-supersede)")
        self.assertEqual(cur[0]["pricing_version"], 2)
        self.assertEqual(cur[0]["rate"], 175.0)
        versions = self._all_versions(34, "E")
        self.assertEqual([v["pricing_version"] for v in versions], [1, 2])
        self.assertEqual([v["is_current"] for v in versions], [0, 1], "v1 frozen, v2 current")

    def test_one_current_invariant_after_multiple_resaves(self):
        for r in (10.0, 20.0, 30.0):
            save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=35, col_letter="H",
                            committed_version=self.cv, rate=r)
        cur = self._current(35, "H")
        self.assertEqual(len(cur), 1, "exactly one current per cell identity after N re-saves")
        self.assertEqual(cur[0]["pricing_version"], 3)
        self.assertEqual(cur[0]["rate"], 30.0)

    def test_multi_area_two_cells_same_row_distinct(self):
        # Same excel_row 34, different col_letter (E = Phase 1, H = Phase 2) -> two distinct
        # current records that do NOT freeze each other.
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                        committed_version=self.cv, rate=100.0, area="Phase 1")
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="H",
                        committed_version=self.cv, rate=200.0, area="Phase 2")
        self.assertEqual(len(self._current(34, "E")), 1)
        self.assertEqual(len(self._current(34, "H")), 1)
        self.assertEqual(self._current(34, "E")[0]["rate"], 100.0)
        self.assertEqual(self._current(34, "H")[0]["rate"], 200.0)

    def test_get_sheet_pricing_returns_current_set(self):
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                        committed_version=self.cv, rate=100.0)
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="H",
                        committed_version=self.cv, rate=200.0)
        # a re-save of one cell -> still only the CURRENT shows in the read
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                        committed_version=self.cv, rate=125.0)
        res = get_sheet_pricing(boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv)
        prices = res["pricing"]
        self.assertEqual(len(prices), 2, "two current cells (E re-saved once, H once)")
        by_col = {p["col_letter"]: p for p in prices}
        self.assertEqual(by_col["E"]["rate"], 125.0)
        self.assertEqual(by_col["E"]["pricing_version"], 2)
        self.assertEqual(by_col["H"]["rate"], 200.0)
        for p in prices:
            self.assertEqual(p["is_current"], 1)

    def test_get_sheet_pricing_empty_when_unpriced(self):
        res = get_sheet_pricing(boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv)
        self.assertEqual(res, {"pricing": []})

    # -- NEGATIVE -----------------------------------------------------------

    def test_save_to_nonexistent_excel_row_throws(self):
        with self.assertRaises(frappe.ValidationError):
            save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=9999,
                            col_letter="E", committed_version=self.cv, rate=10.0)
        self.assertEqual(self._current(9999, "E"), [], "no price created for a non-existent cell")

    def test_save_to_nonexistent_version_throws(self):
        with self.assertRaises(frappe.ValidationError):
            save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                            col_letter="E", committed_version=99, rate=10.0)

    def test_save_to_nonexistent_sheet_throws(self):
        with self.assertRaises(frappe.ValidationError):
            save_cell_price(boq_name=self.boq, sheet_name="No Such Sheet ", excel_row=34,
                            col_letter="E", committed_version=self.cv, rate=10.0)

    def test_save_nonexistent_boq_throws(self):
        with self.assertRaises(frappe.ValidationError):
            save_cell_price(boq_name="NOPE-DOES-NOT-EXIST", sheet_name=self.sheet, excel_row=34,
                            col_letter="E", committed_version=self.cv, rate=10.0)

    def test_save_missing_args_throw(self):
        with self.assertRaises(frappe.ValidationError):
            save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                            committed_version=self.cv, rate=10.0)  # no col_letter
        with self.assertRaises(frappe.ValidationError):
            save_cell_price(boq_name=self.boq, sheet_name=self.sheet, col_letter="E",
                            committed_version=self.cv, rate=10.0)  # no excel_row

    def test_read_missing_args_throw(self):
        with self.assertRaises(frappe.ValidationError):
            get_sheet_pricing(boq_name=self.boq, sheet_name=self.sheet)  # no committed_version


def _build_scalar_rate_committed_sheet(boq_name: str, sheet_name: str, commit_version: int = 1) -> str:
    """Insert a minimal committed sheet whose rate column is SCALAR (area=None) -- the branch
    the per-area shared fixture (all rate cols are *_by_area) does NOT exercise. 1 BoQ Sheet
    (role D = scalar rate_combined) + 1 Preamble root + 1 Line Item child carrying a scalar
    combined_rate at Excel row 10. Returns the line-item node name. sheet_name VERBATIM (#152).
    Cleaned up by cleanup_committed_fixture (deletes all committed rows for the boq)."""
    now = frappe.utils.now()
    bs = frappe.new_doc("BoQ Sheet")
    bs.boq = boq_name
    bs.sheet_name = sheet_name  # VERBATIM (#152)
    bs.sheet_order = 2
    bs.treat_as = "data"
    bs.header_row = 1
    bs.header_row_count = 1
    bs.column_role_map = {
        "A": {"role": "sl_no", "area": None},
        "B": {"role": "description", "area": None},
        "C": {"role": "qty_total", "area": None},
        "D": {"role": "rate_combined", "area": None},  # SCALAR rate (area=None)
    }
    bs.column_headers = {}
    bs.area_dimensions = json.dumps([])
    bs.commit_version = commit_version
    bs.is_current = 1
    bs.committed_at = now
    bs.insert(ignore_permissions=True)

    pre = frappe.new_doc("BOQ Nodes")
    pre.sheet = bs.name
    pre.node_type = "Preamble"
    pre.row_class = "preamble"
    pre.level = 1
    pre.description = "SCALAR PREAMBLE"
    pre.code = "S.0"
    pre.sort_order = 0
    pre.source_row_number = 8
    pre.commit_version = commit_version
    pre.is_current = 1
    pre.committed_at = now
    pre.insert(ignore_permissions=True)

    li = frappe.new_doc("BOQ Nodes")
    li.sheet = bs.name
    li.node_type = "Line Item"
    li.row_class = "line_item"
    li.description = "scalar item"
    li.code = "S.1"
    li.parent_node = pre.name
    li.qty = 5.0
    li.unit = "Nos"
    li.combined_rate = 999.0  # the committed scalar rate (the un-priced baseline)
    li.source_row_number = 10
    li.sort_order = 1
    li.commit_version = commit_version
    li.is_current = 1
    li.committed_at = now
    li.insert(ignore_permissions=True)

    frappe.db.commit()
    return li.name


class TestGetPricedRows(FrappeTestCase):
    """get_priced_rows -- the pricing-overlay read (committed rows + current prices merged).

    Reuses the shared per-area committed fixture (build_committed_sheet_fixture: line items
    at excel_row 34/35; rate cols E [Phase 1] / H [Phase 2]) + a local SCALAR-rate committed
    sheet (rate col D, area=None) so both descriptor branches are covered. sheet_name carries
    a trailing space (#152) throughout. The committed tier is read-only here; each test starts
    with a clean pricing layer.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Priced-Rows Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        cls.cv = 1
        cls.sheet = "Priced Fix "  # VERBATIM trailing space (#152)
        cls.fixture = build_committed_sheet_fixture(cls.boq, cls.sheet, commit_version=cls.cv)
        cls.scalar_sheet = "Scalar Fix "  # VERBATIM trailing space (#152)
        cls.scalar_node = _build_scalar_rate_committed_sheet(cls.boq, cls.scalar_sheet, cls.cv)

    @classmethod
    def tearDownClass(cls):
        cleanup_committed_fixture(cls.boq)
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete(_PRICING, {"boq": self.boq})
        frappe.db.commit()

    # -- helpers ------------------------------------------------------------

    def _row(self, res, excel_row):
        return next((r for r in res["rows"] if r.get("source_row_number") == excel_row), None)

    # -- POSITIVE -----------------------------------------------------------

    def test_priced_and_unpriced_in_one_row(self):
        # Price col E (Phase 1 combined); leave col H (Phase 2 combined) un-priced.
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                        committed_version=self.cv, rate=150.0, area="Phase 1", rate_kind="combined")
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        row = self._row(res, 34)
        self.assertIsNotNone(row, "row at excel_row 34 must be present")
        # E priced: saved rate stamped + marked priced.
        self.assertEqual(row["rate_by_area"]["Phase 1"]["combined_rate"], 150.0)
        self.assertTrue(row["priced_by_area"]["Phase 1"]["combined_rate"], "E is marked priced")
        # H un-priced: committed value (0.0) untouched + NO priced marker.
        self.assertEqual(row["rate_by_area"]["Phase 2"]["combined_rate"], 0.0,
                         "un-priced H keeps its committed value")
        self.assertNotIn("combined_rate", row.get("priced_by_area", {}).get("Phase 2", {}),
                         "H carries no priced marker")

    def test_zero_rate_is_priced_not_unpriced(self):
        # The load-bearing correctness case: a saved rate of 0.0 is PRICED (record present +
        # is_filled), NOT un-priced. A zero-check marker would fail this.
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                        committed_version=self.cv, rate=0.0, area="Phase 1", rate_kind="combined")
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        row = self._row(res, 34)
        self.assertEqual(row["rate_by_area"]["Phase 1"]["combined_rate"], 0.0)
        self.assertTrue(row["priced_by_area"]["Phase 1"]["combined_rate"],
                        "a 0.0 saved rate is PRICED (presence + is_filled), not un-priced")

    def test_multi_area_independence(self):
        # Price BOTH E and H on row 34 with different rates -> each stamped to its own cell,
        # both marked priced, neither bleeds into the other.
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                        committed_version=self.cv, rate=111.0, area="Phase 1", rate_kind="combined")
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="H",
                        committed_version=self.cv, rate=222.0, area="Phase 2", rate_kind="combined")
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        row = self._row(res, 34)
        self.assertEqual(row["rate_by_area"]["Phase 1"]["combined_rate"], 111.0)
        self.assertEqual(row["rate_by_area"]["Phase 2"]["combined_rate"], 222.0)
        self.assertTrue(row["priced_by_area"]["Phase 1"]["combined_rate"])
        self.assertTrue(row["priced_by_area"]["Phase 2"]["combined_rate"])

    def test_commit_version_passthrough(self):
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                        committed_version=self.cv, rate=150.0, area="Phase 1", rate_kind="combined")
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        self.assertEqual(res["commit_version"], self.cv,
                         "the overlay surfaces the committed version it priced")
        # And the price from THAT version is what merged.
        self.assertEqual(self._row(res, 34)["rate_by_area"]["Phase 1"]["combined_rate"], 150.0)

    def test_reserved_lock_placeholders(self):
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        self.assertIs(res["editable"], True, "editable is the reserved always-true placeholder")
        self.assertIsNone(res["lock_info"], "lock_info is the reserved null placeholder")

    def test_scalar_rate_cell_priced(self):
        # Un-priced baseline: the committed scalar rate (999.0) shows, no marker.
        res0 = get_priced_rows(boq_name=self.boq, sheet_name=self.scalar_sheet)
        row0 = self._row(res0, 10)
        self.assertIsNotNone(row0, "scalar sheet must return its row")
        self.assertEqual(row0["rate_combined"], 999.0)
        self.assertNotIn("priced_rate_combined", row0, "un-priced scalar carries no marker")
        # Price the scalar rate cell (col D, area=None).
        save_cell_price(boq_name=self.boq, sheet_name=self.scalar_sheet, excel_row=10,
                        col_letter="D", committed_version=self.cv, rate=750.0, rate_kind="combined")
        res1 = get_priced_rows(boq_name=self.boq, sheet_name=self.scalar_sheet)
        row1 = self._row(res1, 10)
        self.assertEqual(row1["rate_combined"], 750.0, "scalar saved rate stamped in place")
        self.assertTrue(row1["priced_rate_combined"], "scalar priced cell is marked")

    def test_descriptors_pass_through_unchanged(self):
        committed = get_committed_rows(boq_name=self.boq, sheet_name=self.sheet)
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        self.assertEqual(res["column_descriptors"], committed["column_descriptors"],
                         "column_descriptors pass through from get_committed_rows unchanged")

    def test_no_amount_or_qty_stamping(self):
        # A saved price must land ONLY on a rate cell -- never amount / qty.
        baseline = get_committed_rows(boq_name=self.boq, sheet_name=self.sheet)
        base_row = self._row({"rows": baseline["rows"]}, 34)
        base_amount = base_row["amount_by_area"]
        base_qty = base_row["qty_by_area"]
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                        committed_version=self.cv, rate=150.0, area="Phase 1", rate_kind="combined")
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        row = self._row(res, 34)
        self.assertEqual(row["amount_by_area"], base_amount, "amount cells untouched")
        self.assertEqual(row["qty_by_area"], base_qty, "qty cells untouched")
        self.assertNotIn("priced_amount_total", row)
        self.assertNotIn("priced_qty_total", row)
        # priced_by_area carries ONLY rate kinds (never amount kinds supply/install/total).
        for area, kinds in row.get("priced_by_area", {}).items():
            self.assertTrue(
                set(kinds).issubset({"supply_rate", "install_rate", "combined_rate"}),
                "priced_by_area carries only rate kinds",
            )

    # -- NEGATIVE / edge ----------------------------------------------------

    def test_uncommitted_sheet_returns_empty_merged_shape(self):
        res = get_priced_rows(boq_name=self.boq, sheet_name="No Such Sheet ZZ ")
        self.assertEqual(res["rows"], [])
        self.assertEqual(res["column_descriptors"], [])
        self.assertIsNone(res["commit_version"])
        self.assertIs(res["editable"], True)
        self.assertIsNone(res["lock_info"])

    def test_missing_args_and_unknown_boq_throw(self):
        with self.assertRaises(frappe.ValidationError):
            get_priced_rows(sheet_name=self.sheet)  # no boq_name
        with self.assertRaises(frappe.ValidationError):
            get_priced_rows(boq_name=self.boq)  # no sheet_name
        with self.assertRaises(frappe.ValidationError):
            get_priced_rows(boq_name="NOPE-DOES-NOT-EXIST", sheet_name="X")
