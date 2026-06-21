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
    get_committed_sheet_grid,
    get_priced_rows,
    get_sheet_colors,
    get_sheet_pricing,
    get_sheet_remarks,
    save_cell_color,
    save_cell_price,
    save_row_remark,
)
from nirmaan_stack.api.boq.wizard import pricing_lock
from nirmaan_stack.api.boq.wizard.pricing_lock import (
    LOCK_STALE_SECONDS,
    _LOCK_HELD_MARKER,
    _lock_identity,
    acquire_or_refresh,
    read_lock_info,
)
from nirmaan_stack.api.boq.wizard.review_screen import get_committed_rows
from nirmaan_stack.api.boq.wizard.test_review_screen import (
    _cleanup_project,
    _make_project,
    build_committed_sheet_fixture,
    cleanup_committed_fixture,
)

_PRICING = "BoQ Cell Pricing"
_LOCK_DT = "BoQ Sheet Pricing Lock"
_REMARK_DT = "BoQ Cell Remark"
_COLOR_DT = "BoQ Cell Color"


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
        # Each test starts with a clean pricing layer + lock (the committed fixture persists).
        # save_cell_price now acquires a single-editor lock, so clear it for isolation.
        frappe.db.delete(_PRICING, {"boq": self.boq})
        frappe.db.delete(_LOCK_DT, {"boq": self.boq})
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
        frappe.db.delete(_LOCK_DT, {"boq": self.boq})  # save_cell_price acquires a lock now
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

    def test_free_sheet_editable_and_no_lock(self):
        # A committed sheet with NO lock (no one has edited it) -> free: editable True,
        # lock_info None. (Slice A: lock_info is no longer ALWAYS None -- see
        # TestSingleEditorLock for the locked shapes.)
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        self.assertIs(res["editable"], True, "a free sheet is editable")
        self.assertIsNone(res["lock_info"], "a free sheet (no lock) has lock_info None")

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


class TestSingleEditorLock(FrappeTestCase):
    """Single-editor pricing lock (slice A): acquire-on-first-edit, refresh, reject,
    stale takeover, the ATOMIC exactly-one-winner guarantee, and the get_priced_rows
    lock_info shapes. Reuses the shared per-area committed fixture so save_cell_price's
    committed-cell check passes. sheet_name carries a trailing space (#152).

    `me` = the session user (the saver in save_cell_price); `other` = a DIFFERENT real
    User used to stand up a competing lock holder.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Pricing Lock Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        cls.sheet = "Lock Fix "  # VERBATIM trailing space (#152)
        cls.cv = 1
        cls.fixture = build_committed_sheet_fixture(cls.boq, cls.sheet, commit_version=cls.cv)
        cls.me = frappe.session.user
        cls.other = frappe.db.get_value(
            "User", {"name": ["not in", [cls.me, "Guest"]], "enabled": 1}, "name"
        )
        assert cls.other, "need a second real User to play the competing lock holder"

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete(_LOCK_DT, {"boq": cls.boq})
        cleanup_committed_fixture(cls.boq)
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete(_PRICING, {"boq": self.boq})
        frappe.db.delete(_LOCK_DT, {"boq": self.boq})
        frappe.db.commit()

    # -- helpers ------------------------------------------------------------

    def _lock_row(self):
        name = _lock_identity(self.boq, self.sheet, self.cv)
        return frappe.db.get_value(
            _LOCK_DT, name, ["locked_by", "last_edit_at"], as_dict=True
        )

    def _lock_count(self):
        return frappe.db.count(
            _LOCK_DT,
            {"boq": self.boq, "sheet_name": self.sheet, "committed_version": self.cv},
        )

    def _seed_lock(self, user, last_edit_at):
        """Stand up a lock row owned by `user` with a controlled last_edit_at."""
        acquire_or_refresh(self.boq, self.sheet, self.cv, user, frappe.utils.now_datetime())
        name = _lock_identity(self.boq, self.sheet, self.cv)
        frappe.db.set_value(_LOCK_DT, name, "last_edit_at", last_edit_at, update_modified=False)
        frappe.db.commit()

    # -- acquire / refresh --------------------------------------------------

    def test_first_save_acquires_lock(self):
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                        committed_version=self.cv, rate=150.0)
        lock = self._lock_row()
        self.assertIsNotNone(lock, "the first save acquires a lock")
        self.assertEqual(lock["locked_by"], self.me, "holder is the saver (session user)")
        self.assertIsNotNone(lock["last_edit_at"], "last_edit_at is stamped")
        self.assertEqual(self._lock_count(), 1)

    def test_second_save_by_holder_refreshes_and_keeps_holder(self):
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                        committed_version=self.cv, rate=150.0)
        name = _lock_identity(self.boq, self.sheet, self.cv)
        # Backdate so the refresh is observable.
        old = frappe.utils.add_to_date(frappe.utils.now_datetime(), minutes=-2)
        frappe.db.set_value(_LOCK_DT, name, "last_edit_at", old, update_modified=False)
        frappe.db.commit()
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                        committed_version=self.cv, rate=175.0)
        lock = self._lock_row()
        self.assertEqual(lock["locked_by"], self.me, "holder unchanged on a refresh")
        self.assertGreater(
            frappe.utils.get_datetime(lock["last_edit_at"]),
            frappe.utils.get_datetime(old),
            "last_edit_at advanced on the holder's save",
        )
        self.assertEqual(self._lock_count(), 1)

    # -- reject (held fresh by another) -------------------------------------

    def test_save_by_other_while_fresh_is_rejected_and_mutates_nothing(self):
        # `other` holds a FRESH lock; `me` (session user) tries to save -> reject.
        self._seed_lock(self.other, frappe.utils.now_datetime())
        before = self._lock_row()
        with self.assertRaises(frappe.ValidationError) as ctx:
            save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                            committed_version=self.cv, rate=150.0)
        msg = str(ctx.exception)
        self.assertIn(_LOCK_HELD_MARKER, msg, "reject carries the stable lock marker")
        self.assertIn(
            pricing_lock._get_user_full_name(self.other), msg,
            "reject names the current holder",
        )
        # REJECT MUTATES NOTHING: no pricing row was written...
        self.assertEqual(
            frappe.get_all(_PRICING, filters={"boq": self.boq, "excel_row": 34, "col_letter": "E"}),
            [], "a rejected save creates no pricing record",
        )
        # ...and the lock holder + timestamp are untouched.
        after = self._lock_row()
        self.assertEqual(after["locked_by"], self.other, "holder unchanged after a reject")
        self.assertEqual(
            frappe.utils.get_datetime(after["last_edit_at"]),
            frappe.utils.get_datetime(before["last_edit_at"]),
            "the holder's last_edit_at is untouched by a rejected save",
        )

    # -- stale takeover -----------------------------------------------------

    def test_stale_lock_taken_over_by_new_user(self):
        # `other` holds a STALE lock (last edit > 5 min ago); `me` saves -> takeover.
        stale = frappe.utils.add_to_date(
            frappe.utils.now_datetime(), seconds=-(LOCK_STALE_SECONDS + 60)
        )
        self._seed_lock(self.other, stale)
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
                        committed_version=self.cv, rate=150.0)
        lock = self._lock_row()
        self.assertEqual(lock["locked_by"], self.me, "a stale lock flips to the new saver")
        self.assertGreater(
            frappe.utils.get_datetime(lock["last_edit_at"]),
            frappe.utils.get_datetime(stale),
            "last_edit_at refreshed on takeover",
        )
        self.assertEqual(self._lock_count(), 1, "takeover overwrites in place (no second row)")
        # The price WAS written (takeover proceeds).
        cur = frappe.get_all(_PRICING, filters={"boq": self.boq, "excel_row": 34,
                             "col_letter": "E", "is_current": 1}, pluck="rate")
        self.assertEqual(cur, [150.0])

    # -- THE ATOMICITY TEST (exactly one winner) ----------------------------

    def test_atomicity_concurrent_first_edit_exactly_one_winner(self):
        """Deterministically exercise the PK-collision path: a winner A already holds a
        FRESH lock; we force B's acquire to BELIEVE the sheet is free (patch the FIRST
        _read_lock to None) so B attempts the INSERT -- which COLLIDES on the deterministic
        primary key. The collision must RAISE (DuplicateEntryError), be caught, B re-reads
        the winner, and B is rejected. Proves exactly-one-winner: the duplicate insert does
        NOT create a second row, and the holder stays A."""
        now = frappe.utils.now_datetime()
        # A wins first (fresh holder).
        acquire_or_refresh(self.boq, self.sheet, self.cv, self.other, now)
        frappe.db.commit()
        name = _lock_identity(self.boq, self.sheet, self.cv)

        real_read = pricing_lock._read_lock
        calls = {"n": 0}

        def fake_read(boq, sheet_name, version):
            calls["n"] += 1
            if calls["n"] == 1:
                return None  # B's acquire sees "free" -> attempts the colliding insert
            return real_read(boq, sheet_name, version)  # re-read after collision -> finds A

        pricing_lock._read_lock = fake_read
        try:
            with self.assertRaises(frappe.ValidationError) as ctx:
                acquire_or_refresh(self.boq, self.sheet, self.cv, self.me, now)
        finally:
            pricing_lock._read_lock = real_read

        # The collision RAISED + was HANDLED (re-read A, rejected) -- not swallowed: if the
        # duplicate insert had been silently allowed, acquire would have returned (B holder),
        # not thrown the reject below.
        self.assertGreaterEqual(calls["n"], 2, "B re-read after the collision")
        self.assertIn(_LOCK_HELD_MARKER, str(ctx.exception), "B was rejected (collision handled)")
        # EXACTLY ONE row survived -- the duplicate insert collided, it did not duplicate.
        self.assertEqual(self._lock_count(), 1, "exactly one winner -- no duplicate row")
        # The holder is still A (the winner); B never overwrote.
        self.assertEqual(frappe.db.get_value(_LOCK_DT, name, "locked_by"), self.other)

    # -- lock_info shapes out of get_priced_rows (PURE READ) ----------------

    def test_lock_info_free(self):
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        self.assertIsNone(res["lock_info"], "free sheet -> lock_info None")
        self.assertIs(res["editable"], True)

    def test_lock_info_mine(self):
        self._seed_lock(self.me, frappe.utils.now_datetime())
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        li = res["lock_info"]
        self.assertIsNotNone(li)
        self.assertTrue(li["is_locked_by_me"], "session user holds it")
        self.assertFalse(li["is_stale"])
        self.assertEqual(li["locked_by_user"], self.me)
        self.assertIs(res["editable"], True, "editable when I hold it")

    def test_lock_info_other_fresh_blocks(self):
        self._seed_lock(self.other, frappe.utils.now_datetime())
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        li = res["lock_info"]
        self.assertFalse(li["is_locked_by_me"], "another user holds it")
        self.assertEqual(li["locked_by_user"], self.other)
        self.assertEqual(li["locked_by_name"], pricing_lock._get_user_full_name(self.other))
        self.assertFalse(li["is_stale"])
        self.assertIs(res["editable"], False, "NOT editable when held fresh by another")
        # PURE READ: the read did not mutate the lock (still exactly one, holder unchanged).
        self.assertEqual(self._lock_count(), 1)
        self.assertEqual(self._lock_row()["locked_by"], self.other)

    def test_lock_info_other_stale_allows(self):
        stale = frappe.utils.add_to_date(
            frappe.utils.now_datetime(), seconds=-(LOCK_STALE_SECONDS + 60)
        )
        self._seed_lock(self.other, stale)
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        li = res["lock_info"]
        self.assertFalse(li["is_locked_by_me"])
        self.assertTrue(li["is_stale"], "another user's lock is stale")
        self.assertIs(res["editable"], True, "a stale lock is acquirable -> editable")
        # get_priced_rows did NOT take over (still held by other; only save_cell_price acquires).
        self.assertEqual(self._lock_row()["locked_by"], self.other)


class TestLockPerSheetIsolation(FrappeTestCase):
    """Single-editor pricing lock -- PER-SHEET isolation (the MIRROR of slice A's same-sheet
    guarantee). Two users editing two DIFFERENT sheets of the SAME BoQ acquire two
    INDEPENDENT locks and never contend.

    TRUE BY CONSTRUCTION: the lock identity is name = sha1(boq \\x00 sheet_name \\x00 version),
    so a different sheet_name => a different primary key => a different lock row => no
    collision. These tests CERTIFY that deterministically (a substitute for a two-user live
    cert, which is not possible on a single local machine) AND guard against a regression
    that drops sheet_name from the identity. They drive BOTH layers: acquire_or_refresh (the
    lock core) AND save_cell_price (the real entry point the frontend calls). A same-sheet
    contrast test proves the lock DOES block -- so the different-sheet passes are meaningful.

    TWO committed sheets on ONE boq; sheet A carries a trailing space (#152). me = the
    session user (the real save_cell_price saver); other = a second real User holding the
    OTHER sheet via acquire_or_refresh -- mirroring the existing lock suite, which never
    frappe.set_user()s (so the suite is never left on a switched user). Driving me's save
    through the real save_cell_price endpoint still proves isolation at the layer the
    frontend calls; other-as-holder via acquire_or_refresh is permission-agnostic.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Pricing Lock Isolation Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        cls.cv = 1
        cls.sheet_a = "Iso Sheet A "  # VERBATIM trailing space (#152)
        cls.sheet_b = "Iso Sheet B"
        # TWO committed sheets on the SAME boq -- the helper keys on (boq, sheet_name), so two
        # distinct names build two distinct committed sheets + node sets on the one BOQs.
        cls.fixture_a = build_committed_sheet_fixture(cls.boq, cls.sheet_a, commit_version=cls.cv)
        cls.fixture_b = build_committed_sheet_fixture(cls.boq, cls.sheet_b, commit_version=cls.cv)
        cls.me = frappe.session.user
        cls.other = frappe.db.get_value(
            "User", {"name": ["not in", [cls.me, "Guest"]], "enabled": 1}, "name"
        )
        assert cls.other, "need a second real User to play the competing lock holder"

    @classmethod
    def tearDownClass(cls):
        # cleanup_committed_fixture deletes ALL nodes/sheets/pricing for the boq -> BOTH sheets.
        frappe.db.delete(_LOCK_DT, {"boq": cls.boq})
        cleanup_committed_fixture(cls.boq)
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete(_PRICING, {"boq": self.boq})
        frappe.db.delete(_LOCK_DT, {"boq": self.boq})
        frappe.db.commit()

    # -- helpers ------------------------------------------------------------

    def _lock_row(self, sheet_name):
        name = _lock_identity(self.boq, sheet_name, self.cv)
        return frappe.db.get_value(
            _LOCK_DT, name, ["locked_by", "last_edit_at"], as_dict=True
        )

    def _boq_lock_count(self):
        return frappe.db.count(_LOCK_DT, {"boq": self.boq})

    # -- Test 1: identity is per-(sheet, version) ---------------------------

    def test_lock_identity_is_per_sheet_and_per_version(self):
        """The construction proof: the deterministic lock name is keyed on sheet_name AND
        committed_version -- a one-liner guard against a regression dropping either."""
        ia = _lock_identity(self.boq, self.sheet_a, self.cv)
        ib = _lock_identity(self.boq, self.sheet_b, self.cv)
        ia_v2 = _lock_identity(self.boq, self.sheet_a, self.cv + 1)
        self.assertNotEqual(ia, ib, "different sheet_name -> different lock identity")
        self.assertNotEqual(ia, ia_v2, "different committed_version -> different lock identity")
        self.assertNotEqual(ib, ia_v2)

    # -- Test 2: two users, two sheets, both acquire, no contention ---------

    def test_two_users_two_sheets_both_acquire_no_contention(self):
        """acquire_or_refresh layer: me holds A, other holds B -- two independent rows, and
        neither acquire touched/blocked the other."""
        now = frappe.utils.now_datetime()
        # me acquires sheet A.
        acquire_or_refresh(self.boq, self.sheet_a, self.cv, self.me, now)
        frappe.db.commit()
        row_a = self._lock_row(self.sheet_a)
        self.assertIsNotNone(row_a, "sheet A lock acquired")
        self.assertEqual(row_a["locked_by"], self.me)
        a_edit_at = row_a["last_edit_at"]

        # other acquires sheet B -- must SUCCEED (no throw) despite me holding A.
        acquire_or_refresh(self.boq, self.sheet_b, self.cv, self.other, now)
        frappe.db.commit()
        row_b = self._lock_row(self.sheet_b)
        self.assertIsNotNone(row_b, "sheet B lock acquired independently (me holding A did not block)")
        self.assertEqual(row_b["locked_by"], self.other)

        # TWO distinct lock rows for this boq, with distinct identities.
        self.assertEqual(self._boq_lock_count(), 2, "two independent locks -- no collision")
        self.assertNotEqual(
            _lock_identity(self.boq, self.sheet_a, self.cv),
            _lock_identity(self.boq, self.sheet_b, self.cv),
        )

        # NO CONTENTION: other's sheet-B acquire did NOT touch sheet A (holder + timestamp).
        row_a_after = self._lock_row(self.sheet_a)
        self.assertEqual(row_a_after["locked_by"], self.me, "sheet A holder unchanged by B's acquire")
        self.assertEqual(
            frappe.utils.get_datetime(row_a_after["last_edit_at"]),
            frappe.utils.get_datetime(a_edit_at),
            "sheet A last_edit_at untouched by sheet B's acquire",
        )

    def test_read_lock_info_is_independent_per_sheet(self):
        """Cross-check via read_lock_info: each user sees their OWN sheet as theirs and the
        OTHER's sheet as not-theirs -- the locks are independent per sheet."""
        now = frappe.utils.now_datetime()
        acquire_or_refresh(self.boq, self.sheet_a, self.cv, self.me, now)
        acquire_or_refresh(self.boq, self.sheet_b, self.cv, self.other, now)
        frappe.db.commit()

        # other looking at sheet A: held by me, NOT by other.
        li_a = read_lock_info(self.boq, self.sheet_a, self.cv, self.other, now)
        self.assertIsNotNone(li_a)
        self.assertFalse(li_a["is_locked_by_me"], "sheet A is not other's")
        self.assertEqual(li_a["locked_by_user"], self.me)

        # me looking at sheet B: held by other, NOT by me.
        li_b = read_lock_info(self.boq, self.sheet_b, self.cv, self.me, now)
        self.assertIsNotNone(li_b)
        self.assertFalse(li_b["is_locked_by_me"], "sheet B is not mine")
        self.assertEqual(li_b["locked_by_user"], self.other)

        # Each user sees their OWN sheet as theirs.
        self.assertTrue(
            read_lock_info(self.boq, self.sheet_a, self.cv, self.me, now)["is_locked_by_me"],
            "me sees sheet A as mine",
        )
        self.assertTrue(
            read_lock_info(self.boq, self.sheet_b, self.cv, self.other, now)["is_locked_by_me"],
            "other sees sheet B as theirs",
        )

    # -- Test 3: same isolation at the save_cell_price entry point ----------

    def test_save_cell_price_isolation_across_sheets(self):
        """The real frontend path: me drives save_cell_price on sheet A while other holds
        sheet B -- the save succeeds (acquires A for me), and sheet B's lock is undisturbed."""
        now = frappe.utils.now_datetime()
        # other independently holds sheet B (fresh) via the lock core.
        acquire_or_refresh(self.boq, self.sheet_b, self.cv, self.other, now)
        frappe.db.commit()
        b_before = self._lock_row(self.sheet_b)

        # me drives the REAL endpoint on sheet A -- must SUCCEED despite other holding B.
        save_cell_price(boq_name=self.boq, sheet_name=self.sheet_a, excel_row=34,
                        col_letter="E", committed_version=self.cv, rate=150.0)

        # me's save acquired sheet A's lock for me...
        row_a = self._lock_row(self.sheet_a)
        self.assertIsNotNone(row_a, "save_cell_price acquired sheet A's lock")
        self.assertEqual(row_a["locked_by"], self.me, "holder is the saver (session user)")
        # ...and wrote a current pricing row on sheet A (the save was NOT blocked by B's lock).
        cur = frappe.get_all(
            _PRICING,
            filters={"boq": self.boq, "sheet_name": self.sheet_a, "excel_row": 34,
                     "col_letter": "E", "is_current": 1},
            pluck="rate",
        )
        self.assertEqual(cur, [150.0], "sheet A price written -- not blocked by sheet B's lock")

        # sheet B's lock is UNDISTURBED by me's save on sheet A (holder + timestamp).
        b_after = self._lock_row(self.sheet_b)
        self.assertEqual(b_after["locked_by"], self.other, "sheet B still held by other")
        self.assertEqual(
            frappe.utils.get_datetime(b_after["last_edit_at"]),
            frappe.utils.get_datetime(b_before["last_edit_at"]),
            "sheet B last_edit_at untouched by the sheet A save",
        )
        # TWO independent locks now exist (A=me via the endpoint, B=other).
        self.assertEqual(self._boq_lock_count(), 2)

    # -- Test 4: same-sheet STILL contends (the contrast guard) -------------

    def test_same_sheet_still_contends_contrast_guard(self):
        """CONTRAST: the SAME sheet (A) DOES still contend -- proves the different-sheet tests
        pass BECAUSE the sheets differ, not because the lock never blocks. Driven through the
        real save_cell_price endpoint: other holds A fresh -> me's save on A is rejected."""
        now = frappe.utils.now_datetime()
        acquire_or_refresh(self.boq, self.sheet_a, self.cv, self.other, now)  # other holds A fresh
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError) as ctx:
            save_cell_price(boq_name=self.boq, sheet_name=self.sheet_a, excel_row=34,
                            col_letter="E", committed_version=self.cv, rate=150.0)
        self.assertIn(
            _LOCK_HELD_MARKER, str(ctx.exception),
            "same-sheet save by another user is REJECTED -- the lock DOES block",
        )
        # The reject mutated nothing: sheet A is still held by other (unchanged).
        self.assertEqual(self._lock_row(self.sheet_a)["locked_by"], self.other)


class TestGetCommittedSheetGrid(FrappeTestCase):
    """The faithful committed-grid read for the read-only general-specs view.

    Seeds two committed grids DIRECTLY (no commit pipeline run): a CONFIGURED data sheet
    (non-empty column_role_map etc.) and an EMPTY-CONFIG general-specs sheet (empty
    column_role_map -- the SOW shape) -- proving the row return is NEVER gated on config.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        cls.cv = 1

        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "TEST faithful grid BoQ"
        boq.insert(ignore_permissions=True, ignore_links=True)
        cls.boq = boq.name

        # (1) CONFIGURED sheet -- a non-empty column-config snapshot + 2 grid rows.
        cls.cfg_sheet = "Electrical"
        cls._make_grid(
            cls.cfg_sheet,
            rows=[
                {"row_number": 5, "cells": {"A": "1.1", "B": "Cabling", "C": 12}},
                {"row_number": 6, "cells": {"A": "1.2", "B": "Trunking", "C": 8}},
            ],
        )
        cls._make_boq_sheet(
            cls.cfg_sheet,
            column_role_map={"A": {"role": "sl_no", "area": None},
                             "B": {"role": "description", "area": None}},
            column_headers={"A": "Sl.No", "B": "Description"},
            area_dimensions=["Phase 1"],
            header_row=2,
            header_row_count=1,
        )

        # (2) EMPTY-CONFIG general-specs sheet -- the SOW shape (empty maps), rows still present.
        cls.gen_sheet = "SOW"
        cls._make_grid(
            cls.gen_sheet,
            rows=[
                {"row_number": 1, "cells": {"A": "Scope of Work"}},
                {"row_number": 2, "cells": {"A": "1. General", "B": "All works as per drawings"}},
                {"row_number": 3, "cells": {"A": "2. Exclusions"}},
            ],
        )
        cls._make_boq_sheet(
            cls.gen_sheet,
            column_role_map={},
            column_headers={},
            area_dimensions=[],
            header_row=0,
            header_row_count=1,
        )
        frappe.db.commit()

    @classmethod
    def _make_grid(cls, sheet_name, rows):
        grid = frappe.new_doc("BoQ Committed Sheet Grid")
        grid.boq = cls.boq
        grid.source_sheet_name = sheet_name
        grid.commit_version = cls.cv
        grid.is_current = 1
        grid.committed_at = "2026-06-21 10:00:00"
        # Seed rows OUT of row_order to prove the order_by row_order asc.
        for order, r in reversed(list(enumerate(rows))):
            grid.append("rows", {
                "row_number": r["row_number"],
                "row_order": order,
                "cells": r["cells"],
            })
        grid.insert(ignore_permissions=True, ignore_links=True)
        return grid.name

    @classmethod
    def _make_boq_sheet(cls, sheet_name, column_role_map, column_headers,
                        area_dimensions, header_row, header_row_count):
        bs = frappe.new_doc("BoQ Sheet")
        bs.boq = cls.boq
        bs.sheet_name = sheet_name
        bs.sheet_order = 0
        bs.commit_version = cls.cv
        bs.is_current = 1
        # JSON fields stored as json.dumps strings (the commit pipeline's pattern).
        bs.column_role_map = json.dumps(column_role_map)
        bs.column_headers = json.dumps(column_headers)
        bs.area_dimensions = json.dumps(area_dimensions)
        bs.header_row = header_row
        bs.header_row_count = header_row_count
        bs.insert(ignore_permissions=True, ignore_links=True)
        return bs.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Committed Sheet Grid", {"boq": cls.boq})
        frappe.db.delete("BoQ Sheet", {"boq": cls.boq})
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def test_configured_sheet_returns_rows_and_config(self):
        res = get_committed_sheet_grid(self.boq, self.cfg_sheet, self.cv)
        # Rows returned in row_order (seeded reversed) -> ascending by row_number here.
        self.assertEqual([r["row_number"] for r in res["rows"]], [5, 6])
        self.assertEqual(res["rows"][0]["cells"], {"A": "1.1", "B": "Cabling", "C": 12})
        # Config snapshot parsed back to Python objects.
        self.assertEqual(res["column_role_map"]["A"], {"role": "sl_no", "area": None})
        self.assertEqual(res["column_headers"], {"A": "Sl.No", "B": "Description"})
        self.assertEqual(res["area_dimensions"], ["Phase 1"])
        self.assertEqual(res["header_row"], 2)
        self.assertEqual(res["header_row_count"], 1)

    def test_empty_config_general_specs_returns_rows(self):
        """THE empty-config case: a general-specs sheet (SOW shape) with an empty
        column_role_map STILL returns its grid rows -- the return is never config-gated."""
        res = get_committed_sheet_grid(self.boq, self.gen_sheet, self.cv)
        self.assertEqual(len(res["rows"]), 3, "all 3 grid rows returned despite empty config")
        self.assertEqual([r["row_number"] for r in res["rows"]], [1, 2, 3])
        self.assertEqual(res["rows"][1]["cells"], {"A": "1. General", "B": "All works as per drawings"})
        # Config is empty -- and that is fine, not an error.
        self.assertEqual(res["column_role_map"], {})
        self.assertEqual(res["column_headers"], {})
        self.assertEqual(res["area_dimensions"], [])

    def test_missing_args_throw(self):
        with self.assertRaises(frappe.ValidationError):
            get_committed_sheet_grid(None, self.gen_sheet, self.cv)
        with self.assertRaises(frappe.ValidationError):
            get_committed_sheet_grid(self.boq, None, self.cv)
        with self.assertRaises(frappe.ValidationError):
            get_committed_sheet_grid(self.boq, self.gen_sheet, None)

    def test_unknown_boq_throws(self):
        with self.assertRaises(frappe.ValidationError):
            get_committed_sheet_grid("BOQ-DOES-NOT-EXIST-999", self.gen_sheet, self.cv)

    def test_unknown_sheet_or_version_throws(self):
        with self.assertRaises(frappe.ValidationError):
            get_committed_sheet_grid(self.boq, "Nonexistent Sheet", self.cv)
        with self.assertRaises(frappe.ValidationError):
            get_committed_sheet_grid(self.boq, self.gen_sheet, 999)


class TestPriceabilityGuard(FrappeTestCase):
    """Slice 3e: save_cell_price rejects a rate on a NON-priceable committed row (node_type
    'Other') by default, and ACCEPTS it only when allow_non_priceable is asserted. Reuses the
    shared committed fixture (Preamble row 6 + Line Items 34/35) and ADDS one 'Other' node
    (a note row) at source_row 50 -- seeded in THIS class's own setup (the shared builder is
    untouched). Also asserts node_type now rides the delivered committed/priced row."""

    OTHER_ROW = 50  # the Other node's Excel source_row_number

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Priceability Guard Test BoQ"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        cls.sheet = "Guard Fix "  # VERBATIM trailing space (#152)
        cls.cv = 1
        cls.fixture = build_committed_sheet_fixture(cls.boq, cls.sheet, commit_version=cls.cv)

        # ADD an 'Other' (non-priceable) node to the SAME committed sheet -- a note row.
        # boq auto-fills from sheet (P4-2); Other carries no qty/level/parent requirement.
        other = frappe.new_doc("BOQ Nodes")
        other.sheet = cls.fixture["bqsh"]
        other.node_type = "Other"
        other.row_class = "note"
        other.description = "NOTE: rates are exclusive of taxes"
        other.sort_order = 3
        other.source_row_number = cls.OTHER_ROW
        other.commit_version = cls.cv
        other.is_current = 1
        other.committed_at = frappe.utils.now()
        other.insert(ignore_permissions=True)
        cls.other_node = other.name
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        cleanup_committed_fixture(cls.boq)
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete(_PRICING, {"boq": self.boq})
        frappe.db.delete(_LOCK_DT, {"boq": self.boq})
        frappe.db.commit()

    def _price_count(self, excel_row):
        return frappe.db.count(
            _PRICING, {"boq": self.boq, "sheet_name": self.sheet, "excel_row": excel_row}
        )

    def _lock_count(self):
        return frappe.db.count(_LOCK_DT, {"boq": self.boq})

    # -- the guard: non-priceable rejected without override --------------------

    def test_non_priceable_rejected_without_override(self):
        with self.assertRaises(frappe.ValidationError) as ctx:
            save_cell_price(
                boq_name=self.boq, sheet_name=self.sheet, excel_row=self.OTHER_ROW,
                col_letter="E", committed_version=self.cv, rate=99.0,
            )
        self.assertIn("not priceable", str(ctx.exception).lower())
        # A rejected write mutated NOTHING -- no price row AND the lock was never acquired
        # (the guard sits BEFORE acquire_or_refresh).
        self.assertEqual(self._price_count(self.OTHER_ROW), 0, "no price row written")
        self.assertEqual(self._lock_count(), 0, "the lock was not acquired on a rejected write")

    # -- the override: non-priceable accepted with allow_non_priceable ---------

    def test_non_priceable_accepted_with_override(self):
        res = save_cell_price(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=self.OTHER_ROW,
            col_letter="E", committed_version=self.cv, rate=99.0,
            allow_non_priceable=True,
        )
        self.assertTrue(res["ok"])
        cur = frappe.get_all(
            _PRICING,
            filters={"boq": self.boq, "sheet_name": self.sheet, "excel_row": self.OTHER_ROW,
                     "col_letter": "E", "committed_version": self.cv, "is_current": 1},
            fields=["rate", "node", "is_filled"],
        )
        self.assertEqual(len(cur), 1, "the override accepted the write -> one current price row")
        self.assertEqual(cur[0]["rate"], 99.0)
        self.assertEqual(cur[0]["node"], self.other_node, "stores the resolved Other node pointer")

    def test_override_accepts_http_string_true(self):
        # HTTP coercion: the whitelisted endpoint receives a STRING. "true" must read truthy.
        res = save_cell_price(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=self.OTHER_ROW,
            col_letter="E", committed_version=self.cv, rate=12.0,
            allow_non_priceable="true",
        )
        self.assertTrue(res["ok"])
        self.assertEqual(self._price_count(self.OTHER_ROW), 1)

    # -- priceable rows save normally either way (regression) ------------------

    def test_priceable_saves_without_override(self):
        res = save_cell_price(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
            committed_version=self.cv, rate=150.0, area="Phase 1",
        )
        self.assertTrue(res["ok"])
        self.assertEqual(self._price_count(34), 1)

    def test_priceable_saves_with_override_too(self):
        # The override does not break a priceable save (it just isn't needed there).
        res = save_cell_price(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=34, col_letter="E",
            committed_version=self.cv, rate=150.0, area="Phase 1", allow_non_priceable=True,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(self._price_count(34), 1)

    # -- node_type rides the delivered row (the gate's data dependency) --------

    def test_node_type_on_committed_and_priced_rows(self):
        committed = get_committed_rows(boq_name=self.boq, sheet_name=self.sheet)
        by_row = {r["source_row_number"]: r for r in committed["rows"]}
        self.assertIn("node_type", by_row[6], "node_type is surfaced on the committed row")
        self.assertEqual(by_row[6]["node_type"], "Preamble")
        self.assertEqual(by_row[34]["node_type"], "Line Item")
        self.assertEqual(by_row[self.OTHER_ROW]["node_type"], "Other")
        # get_priced_rows passes the committed rows through -> node_type rides it too.
        priced = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        p_by_row = {r["source_row_number"]: r for r in priced["rows"]}
        self.assertEqual(p_by_row[self.OTHER_ROW]["node_type"], "Other")


class TestRowRemark(FrappeTestCase):
    """Slice 4a: the per-ROW remark layer (BoQ Cell Remark) -- save_row_remark + the
    get_priced_rows merge. Reuses the shared per-area committed fixture (line items at
    excel_row 34/35). sheet_name carries a trailing space (#152). Each test starts with a
    clean remark layer + lock (the committed fixture persists)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Row-Remark Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        cls.sheet = "Remark Fix "  # VERBATIM trailing space (#152)
        cls.cv = 1
        cls.fixture = build_committed_sheet_fixture(cls.boq, cls.sheet, commit_version=cls.cv)
        cls.me = frappe.session.user
        cls.other = frappe.db.get_value(
            "User", {"name": ["not in", [cls.me, "Guest"]], "enabled": 1}, "name"
        )
        assert cls.other, "need a second real User to play the competing lock holder"

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete(_LOCK_DT, {"boq": cls.boq})
        frappe.db.delete(_REMARK_DT, {"boq": cls.boq})
        cleanup_committed_fixture(cls.boq)
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete(_REMARK_DT, {"boq": self.boq})
        frappe.db.delete(_LOCK_DT, {"boq": self.boq})
        frappe.db.commit()

    # -- helpers ------------------------------------------------------------

    def _current(self, excel_row):
        return frappe.get_all(
            _REMARK_DT,
            filters={"boq": self.boq, "sheet_name": self.sheet, "excel_row": excel_row,
                     "committed_version": self.cv, "is_current": 1},
            fields=["name", "remark", "remark_version", "description"],
        )

    def _seed_lock(self, user):
        acquire_or_refresh(self.boq, self.sheet, self.cv, user, frappe.utils.now_datetime())
        frappe.db.commit()

    # -- POSITIVE -----------------------------------------------------------

    def test_save_creates_current_remark_v1(self):
        res = save_row_remark(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                              committed_version=self.cv, remark="check the quantity",
                              description="cable 1.1.2")
        self.assertTrue(res["ok"])
        self.assertEqual(res["remark_version"], 1)
        self.assertEqual(res["froze_prior"], 0, "first save freezes nothing")
        self.assertFalse(res["cleared"])
        cur = self._current(34)
        self.assertEqual(len(cur), 1, "exactly one current remark record")
        self.assertEqual(cur[0]["remark"], "check the quantity")
        self.assertEqual(cur[0]["description"], "cable 1.1.2", "guard carried, not branched on")

    def test_resave_freezes_prior_and_supersedes(self):
        save_row_remark(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                        committed_version=self.cv, remark="first")
        res2 = save_row_remark(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                               committed_version=self.cv, remark="second")
        self.assertEqual(res2["remark_version"], 2)
        self.assertEqual(res2["froze_prior"], 1, "the re-save froze the prior current")
        cur = self._current(34)
        self.assertEqual(len(cur), 1, "exactly ONE current after re-save (freeze-and-supersede)")
        self.assertEqual(cur[0]["remark"], "second")
        self.assertEqual(cur[0]["remark_version"], 2)

    def test_clear_blank_reads_as_no_remark(self):
        save_row_remark(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                        committed_version=self.cv, remark="to be cleared")
        res = save_row_remark(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                              committed_version=self.cv, remark="   ")
        self.assertTrue(res["cleared"], "blank/whitespace clears the remark")
        self.assertEqual(res["froze_prior"], 1)
        self.assertEqual(self._current(34), [], "no current remark after a clear")
        got = get_sheet_remarks(boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv)
        self.assertEqual(got["remarks"], [], "a cleared remark does not surface")

    def test_cap_250_ok_251_throws(self):
        ok = save_row_remark(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                             committed_version=self.cv, remark="x" * 250)
        self.assertTrue(ok["ok"], "exactly 250 chars is allowed")
        with self.assertRaises(frappe.ValidationError):
            save_row_remark(boq_name=self.boq, sheet_name=self.sheet, excel_row=35,
                            committed_version=self.cv, remark="y" * 251)
        self.assertEqual(self._current(35), [], "the over-cap remark wrote nothing")

    # -- NEGATIVE -----------------------------------------------------------

    def test_nonexistent_row_throws(self):
        with self.assertRaises(frappe.ValidationError):
            save_row_remark(boq_name=self.boq, sheet_name=self.sheet, excel_row=9999,
                            committed_version=self.cv, remark="orphan")
        self.assertEqual(self._current(9999), [], "no remark for a non-existent row")

    def test_lock_held_by_other_rejects_and_mutates_nothing(self):
        self._seed_lock(self.other)  # other holds a FRESH lock
        with self.assertRaises(frappe.ValidationError) as ctx:
            save_row_remark(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                            committed_version=self.cv, remark="blocked")
        self.assertIn(_LOCK_HELD_MARKER, str(ctx.exception), "reject carries the lock marker")
        self.assertEqual(self._current(34), [], "a lock-rejected remark wrote nothing")

    # -- MERGE into get_priced_rows -----------------------------------------

    def test_get_priced_rows_surfaces_remark(self):
        save_row_remark(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                        committed_version=self.cv, remark="see drawing rev B")
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        by_row = {r["source_row_number"]: r for r in res["rows"]}
        self.assertEqual(by_row[34]["remark"], "see drawing rev B", "remark merged onto its row")
        self.assertIsNone(by_row[35]["remark"], "a row with no remark surfaces remark None")


class TestCellColor(FrappeTestCase):
    """Slice 4a: the per-CELL color layer (BoQ Cell Color) -- save_cell_color + the
    get_priced_rows merge. Reuses the shared committed fixture (line items 34/35) and ADDS
    one 'Other' (non-priceable) node at source_row 50 to prove color is allowed where a
    PRICE would be rejected. sheet_name carries a trailing space (#152)."""

    OTHER_ROW = 50

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Cell-Color Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        cls.sheet = "Color Fix "  # VERBATIM trailing space (#152)
        cls.cv = 1
        cls.fixture = build_committed_sheet_fixture(cls.boq, cls.sheet, commit_version=cls.cv)

        # An 'Other' (non-priceable) node -- a note row at source_row 50.
        other = frappe.new_doc("BOQ Nodes")
        other.sheet = cls.fixture["bqsh"]
        other.node_type = "Other"
        other.row_class = "note"
        other.description = "NOTE: rates exclusive of taxes"
        other.sort_order = 3
        other.source_row_number = cls.OTHER_ROW
        other.commit_version = cls.cv
        other.is_current = 1
        other.committed_at = frappe.utils.now()
        other.insert(ignore_permissions=True)
        cls.other_node = other.name
        frappe.db.commit()

        cls.me = frappe.session.user
        cls.other_user = frappe.db.get_value(
            "User", {"name": ["not in", [cls.me, "Guest"]], "enabled": 1}, "name"
        )
        assert cls.other_user, "need a second real User to play the competing lock holder"

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete(_LOCK_DT, {"boq": cls.boq})
        frappe.db.delete(_COLOR_DT, {"boq": cls.boq})
        cleanup_committed_fixture(cls.boq)
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete(_COLOR_DT, {"boq": self.boq})
        frappe.db.delete(_PRICING, {"boq": self.boq})
        frappe.db.delete(_LOCK_DT, {"boq": self.boq})
        frappe.db.commit()

    # -- helpers ------------------------------------------------------------

    def _current(self, excel_row, col_letter):
        return frappe.get_all(
            _COLOR_DT,
            filters={"boq": self.boq, "sheet_name": self.sheet, "excel_row": excel_row,
                     "col_letter": col_letter, "committed_version": self.cv, "is_current": 1},
            fields=["name", "color", "color_version"],
        )

    def _seed_lock(self, user):
        acquire_or_refresh(self.boq, self.sheet, self.cv, user, frappe.utils.now_datetime())
        frappe.db.commit()

    # -- POSITIVE -----------------------------------------------------------

    def test_save_creates_current_color_v1(self):
        res = save_cell_color(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                              col_letter="E", committed_version=self.cv, color="red",
                              description="cable 1.1.2")
        self.assertTrue(res["ok"])
        self.assertEqual(res["color_version"], 1)
        self.assertFalse(res["cleared"])
        cur = self._current(34, "E")
        self.assertEqual(len(cur), 1)
        self.assertEqual(cur[0]["color"], "red")

    def test_resave_freezes_prior_and_supersedes(self):
        save_cell_color(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                        col_letter="E", committed_version=self.cv, color="red")
        res2 = save_cell_color(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                               col_letter="E", committed_version=self.cv, color="blue")
        self.assertEqual(res2["color_version"], 2)
        self.assertEqual(res2["froze_prior"], 1)
        cur = self._current(34, "E")
        self.assertEqual(len(cur), 1, "exactly ONE current after re-save")
        self.assertEqual(cur[0]["color"], "blue")

    def test_all_8_tokens_accepted(self):
        for token in ("red", "orange", "yellow", "green", "blue", "purple", "pink", "grey"):
            res = save_cell_color(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                                  col_letter="E", committed_version=self.cv, color=token)
            self.assertTrue(res["ok"], f"token {token} accepted")
        self.assertEqual(self._current(34, "E")[0]["color"], "grey", "last token is current")

    def test_invalid_color_throws(self):
        with self.assertRaises(frappe.ValidationError):
            save_cell_color(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                            col_letter="E", committed_version=self.cv, color="teal")
        self.assertEqual(self._current(34, "E"), [], "an invalid color wrote nothing")

    def test_color_allowed_on_non_priceable_cell(self):
        # THE contrast: a PRICE on the Other row is rejected without the override...
        with self.assertRaises(frappe.ValidationError):
            save_cell_price(boq_name=self.boq, sheet_name=self.sheet, excel_row=self.OTHER_ROW,
                            col_letter="E", committed_version=self.cv, rate=10.0)
        # ...but a COLOR on the SAME non-priceable cell is accepted (no priceability gate).
        res = save_cell_color(boq_name=self.boq, sheet_name=self.sheet, excel_row=self.OTHER_ROW,
                              col_letter="E", committed_version=self.cv, color="green")
        self.assertTrue(res["ok"])
        cur = self._current(self.OTHER_ROW, "E")
        self.assertEqual(len(cur), 1, "color saved on a non-priceable cell")
        self.assertEqual(cur[0]["color"], "green")

    def test_clear_blank_no_current(self):
        save_cell_color(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                        col_letter="E", committed_version=self.cv, color="red")
        res = save_cell_color(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                              col_letter="E", committed_version=self.cv, color="  ")
        self.assertTrue(res["cleared"])
        self.assertEqual(self._current(34, "E"), [], "no current color after a clear")
        got = get_sheet_colors(boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv)
        self.assertEqual(got["colors"], [])

    # -- NEGATIVE -----------------------------------------------------------

    def test_nonexistent_row_throws(self):
        with self.assertRaises(frappe.ValidationError):
            save_cell_color(boq_name=self.boq, sheet_name=self.sheet, excel_row=9999,
                            col_letter="E", committed_version=self.cv, color="red")

    def test_lock_held_by_other_rejects_and_mutates_nothing(self):
        self._seed_lock(self.other_user)
        with self.assertRaises(frappe.ValidationError) as ctx:
            save_cell_color(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                            col_letter="E", committed_version=self.cv, color="red")
        self.assertIn(_LOCK_HELD_MARKER, str(ctx.exception))
        self.assertEqual(self._current(34, "E"), [], "a lock-rejected color wrote nothing")

    # -- MERGE into get_priced_rows -----------------------------------------

    def test_get_priced_rows_surfaces_color_by_cell(self):
        save_cell_color(boq_name=self.boq, sheet_name=self.sheet, excel_row=34,
                        col_letter="E", committed_version=self.cv, color="yellow")
        res = get_priced_rows(boq_name=self.boq, sheet_name=self.sheet)
        by_row = {r["source_row_number"]: r for r in res["rows"]}
        self.assertEqual(by_row[34]["color_by_cell"], {"E": "yellow"}, "color merged per cell")
        self.assertNotIn("color_by_cell", by_row[35], "a row with no color carries no color_by_cell")
