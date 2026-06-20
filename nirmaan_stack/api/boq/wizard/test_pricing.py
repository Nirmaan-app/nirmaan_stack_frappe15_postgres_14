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
import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.pricing import get_sheet_pricing, save_cell_price
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
