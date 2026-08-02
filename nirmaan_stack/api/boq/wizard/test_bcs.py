# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for the BCS (cost & margin) foundation -- slices BCS-S1 + BCS-S1a.

BCS is the COST side of a committed BoQ row: two hand-typed rates (Supply + Install)
representing what the work costs US, sitting against the BoQ amount we charge the CLIENT.
S1 is STORAGE + ENDPOINTS only -- nothing renders, and Total Amount / % Profit are NEVER
stored (they are always computed downstream from the two rates + the confirmed quantity
and amount columns).

Coverage:
  Group 1   doctype identity -- per-ROW (no col_letter), sheet_name VERBATIM (#152).
  Group 2   freeze-and-supersede -- a re-save supersedes; exactly ONE current row, ever.
  Group 3   enable / disable + the confirmation of the two columns, validated against the
            sheet's REAL column_descriptors (a column the sheet does not have is REFUSED
            and NOTHING is stored).
  Group 3b  (S1a) the AMOUNT source has the SAME two shapes as quantity -- a scalar total
            OR the per-area combined amounts, SUMMED. Same refusals, same reasons.
  Group 4   the readiness gate -- a rate write is refused while BCS is disabled or the
            columns are unconfirmed.
  Group 5   the single-editor pricing lock -- a lock rejection mutates NOTHING.
  Group 6a  (S1a) the BCS write path is INDEPENDENT of the three client-facing gates
            (amount-formula, priceability, category) -- one pin per skip.
  Group 6b  BCS gates its OWN cells only: the positive control (an ordinary client rate
            write succeeds with BCS off) plus the pricing.py source-grep tripwire.

sheet_name carries a trailing space (#152) throughout.
"""
import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.bcs import (
    bcs_is_ready,
    confirm_bcs_columns,
    get_bcs_state,
    get_sheet_bcs_rates,
    save_row_bcs_rates,
    set_bcs_enabled,
)
from nirmaan_stack.api.boq.wizard.pricing import (
    _categories_gate_ok,
    _node_priceable_without_override,
    _sheet_formulas_complete,
    save_amount_formula,
    save_cell_price,
)
from nirmaan_stack.api.boq.wizard.pricing_lock import (
    _LOCK_HELD_MARKER,
    _lock_identity,
    acquire_or_refresh,
)
from nirmaan_stack.api.boq.wizard.test_review_screen import (
    _cleanup_project,
    _make_project,
)
# The ONE established way a test satisfies the category gate -- write REAL category
# records through the normal persistence path rather than bypassing with the admin
# override (owner ruling, recorded on the helper itself). Imported, never re-copied.
from nirmaan_stack.api.boq.wizard.test_pricing import _categorise_fixture_eligible_rows

_BCS = "BoQ Row BCS Rate"
_BOQ_SHEET = "BoQ Sheet"
_LOCK_DT = "BoQ Sheet Pricing Lock"
_PRICING = "BoQ Cell Pricing"
_FORMULA = "BoQ Cell Amount Formula"
_ROW_CATEGORY = "BoQ Row Category"

# A structurally-valid leaf formula for a SCALAR amount column: amount = the row's total
# quantity. Shape is all the gate checks; the value is never evaluated here.
_SCALAR_FORMULA_LEAF = json.dumps(
    {"ref": {"value_field": "qty_total", "value_key": None, "rate_subkey": None}}
)


def _declare_scalar_amount_formula(boq_name, sheet_name, commit_version):
    """Make a SCALAR-amount sheet formula-COMPLETE, so save_cell_price's MANDATORY
    amount-formula gate is satisfied. The local twin of test_pricing.
    _declare_fixture_amount_formulas, which does the same for the per-area fixture: setup
    drives THROUGH the live gate rather than bypassing it. sheet_name VERBATIM (#152)."""
    save_amount_formula(
        boq_name=boq_name, sheet_name=sheet_name, committed_version=commit_version,
        target_value_field="amount_total", target_value_key=None,
        target_rate_subkey=None, formula=_SCALAR_FORMULA_LEAF,
    )

# A realistic SCALAR-quantity committed sheet: one qty_total column (D) and one
# amount_total column (F) -- the "Amount (Combined)" the owner names.
_SCALAR_ROLE_MAP = {
    "A": {"role": "sl_no", "area": None},
    "B": {"role": "description", "area": None},
    "C": {"role": "unit", "area": None},
    "D": {"role": "qty_total", "area": None},
    "E": {"role": "rate_combined", "area": None},
    "F": {"role": "amount_total", "area": None},
}

# A realistic PER-AREA quantity committed sheet: quantity is mapped per area (D + E) with
# NO scalar qty_total, so the BCS quantity source is the SUMMED SET of those two columns.
# It still carries a scalar amount_total (H).
_AREA_ROLE_MAP = {
    "A": {"role": "sl_no", "area": None},
    "B": {"role": "description", "area": None},
    "C": {"role": "unit", "area": None},
    "D": {"role": "qty", "area": "Zone A"},
    "E": {"role": "qty", "area": "Zone B"},
    "G": {"role": "rate_combined", "area": None},
    "H": {"role": "amount_total", "area": None},
}

# A sheet whose AMOUNT is mapped PER AREA and has NO scalar amount_total -- the shape the
# SHARED committed fixture (test_review_screen.COMMITTED_FIXTURE_ROLE_MAP) actually has,
# so this is not hypothetical. S1 accepted the scalar amount shape ONLY, which meant this
# sheet could not enable BCS at all; S1a sums the per-area amounts exactly as quantity is
# already summed (owner ruling 2026-08-02).
#   F + G -- the per-area COMBINED amounts, whose SUM is the row's amount;
#   H     -- a per-area SUPPLY half, present on purpose: a half is NOT the amount charged
#            to the client, so picking it must be refused (the per-area twin of refusing
#            the scalar amount_supply).
_AREA_AMOUNT_ROLE_MAP = {
    "A": {"role": "sl_no", "area": None},
    "B": {"role": "description", "area": None},
    "C": {"role": "unit", "area": None},
    "D": {"role": "qty_total", "area": None},
    "E": {"role": "rate_combined", "area": None},
    "F": {"role": "amount_total_by_area", "area": "Zone A"},
    "G": {"role": "amount_total_by_area", "area": "Zone B"},
    "H": {"role": "amount_supply_by_area", "area": "Zone A"},
}


def _seed_sheet(boq_name, sheet_name, commit_version, role_map, area_dims, sheet_order):
    """Insert one current committed BoQ Sheet + a Preamble root + 2 Line Item children.
    sheet_name stored VERBATIM (#152). Mirrors build_committed_sheet_fixture's shape but
    with the role maps this slice needs (a scalar-qty sheet and a per-area-qty sheet)."""
    now = frappe.utils.now()
    bs = frappe.new_doc(_BOQ_SHEET)
    bs.boq = boq_name
    bs.sheet_name = sheet_name  # VERBATIM (#152)
    bs.sheet_order = sheet_order
    bs.treat_as = "data"
    bs.header_row = 1
    bs.header_row_count = 1
    bs.column_role_map = role_map           # dict JSON -- safe at insert
    bs.column_headers = {}
    bs.area_dimensions = json.dumps(area_dims)   # list JSON -> json.dumps
    bs.commit_version = commit_version
    bs.is_current = 1
    bs.committed_at = now
    bs.insert(ignore_permissions=True)

    pre = frappe.new_doc("BOQ Nodes")
    pre.sheet = bs.name
    pre.node_type = "Preamble"
    pre.row_class = "preamble"
    pre.level = 1
    pre.description = "CABLING"
    pre.code = "1.0"
    pre.sort_order = 0
    pre.source_row_number = 5
    pre.commit_version = commit_version
    pre.is_current = 1
    pre.committed_at = now
    pre.insert(ignore_permissions=True)

    line_items = []
    for sort_order, source_row, code, qty in [(1, 10, "1.1", 220.0), (2, 11, "1.2", 40.0)]:
        li = frappe.new_doc("BOQ Nodes")
        li.sheet = bs.name
        li.node_type = "Line Item"
        li.row_class = "line_item"
        li.description = f"cable {code}"
        li.code = code
        li.parent_node = pre.name
        li.qty = qty
        li.unit = "Mtr"
        li.source_row_number = source_row
        li.sort_order = sort_order
        li.commit_version = commit_version
        li.is_current = 1
        li.committed_at = now
        li.insert(ignore_permissions=True)
        line_items.append(li.name)

    frappe.db.commit()
    return {"bqsh": bs.name, "preamble": pre.name, "line_items": line_items}


def _cleanup_committed(boq_name):
    node_names = frappe.get_all("BOQ Nodes", filters={"boq": boq_name}, pluck="name")
    if node_names:
        frappe.db.delete("BOQ Node Qty By Area", {"parent": ["in", node_names]})
    frappe.db.delete(_BCS, {"boq": boq_name})
    frappe.db.delete(_LOCK_DT, {"boq": boq_name})
    # The client-facing layers the gate-independence tests exercise (BCS-S1a). Deleted
    # here so a BCS fixture never leaves ordinary pricing rows behind.
    frappe.db.delete(_PRICING, {"boq": boq_name})
    frappe.db.delete(_FORMULA, {"boq": boq_name})
    frappe.db.delete(_ROW_CATEGORY, {"boq": boq_name})
    frappe.db.delete("BOQ Nodes", {"boq": boq_name})
    frappe.db.delete(_BOQ_SHEET, {"boq": boq_name})
    frappe.db.commit()


# ===========================================================================
# Group 1: the doctype -- per-ROW identity, VERBATIM sheet_name
# ===========================================================================
class TestBcsRateDoctypeIdentity(FrappeTestCase):
    """The BCS rate row is addressed PER ROW -- (boq, sheet_name, excel_row,
    committed_version). There is deliberately NO col_letter: the two BCS columns are
    screen-only and have no Excel origin, so inventing a sentinel letter would be a lie.
    BoQ Row Category / BoQ Cell Remark are the established no-column precedent."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "BCS Identity Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        cls.sheet = "BCS Fix "  # VERBATIM trailing space (#152)
        cls.cv = 1
        cls.fixture = _seed_sheet(cls.boq, cls.sheet, cls.cv, _SCALAR_ROLE_MAP, [], 1)

    @classmethod
    def tearDownClass(cls):
        _cleanup_committed(cls.boq)
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        frappe.db.delete(_BCS, {"boq": self.boq})
        frappe.db.commit()

    def test_doctype_has_no_col_letter_field(self):
        """BCS is PER-ROW. A col_letter field would invite a sentinel value for a column
        that does not exist in the workbook."""
        meta = frappe.get_meta(_BCS)
        self.assertIsNone(
            meta.get_field("col_letter"),
            "BoQ Row BCS Rate must NOT carry col_letter -- BCS columns are screen-only",
        )

    def test_stores_and_reads_back_both_rates_at_the_row_address(self):
        doc = frappe.new_doc(_BCS)
        doc.boq = self.boq
        doc.sheet_name = self.sheet
        doc.excel_row = 10
        doc.committed_version = self.cv
        doc.supply_rate = 120.5
        doc.install_rate = 30.25
        doc.bcs_version = 1
        doc.is_current = 1
        doc.insert(ignore_permissions=True)
        frappe.db.commit()

        row = frappe.db.get_value(
            _BCS,
            {"boq": self.boq, "sheet_name": self.sheet, "excel_row": 10,
             "committed_version": self.cv, "is_current": 1},
            ["supply_rate", "install_rate"],
            as_dict=True,
        )
        self.assertEqual(row.supply_rate, 120.5)
        self.assertEqual(row.install_rate, 30.25)

    def test_sheet_name_round_trips_verbatim_with_its_trailing_space(self):
        """#152: real sheet names carry leading/trailing spaces. The stored name must be
        byte-identical, and the STRIPPED name must NOT match the stored row."""
        doc = frappe.new_doc(_BCS)
        doc.boq = self.boq
        doc.sheet_name = self.sheet          # "BCS Fix " -- trailing space
        doc.excel_row = 11
        doc.committed_version = self.cv
        doc.supply_rate = 10.0
        doc.install_rate = 5.0
        doc.bcs_version = 1
        doc.is_current = 1
        doc.insert(ignore_permissions=True)
        frappe.db.commit()

        stored = frappe.db.get_value(_BCS, doc.name, "sheet_name")
        self.assertEqual(stored, "BCS Fix ", "trailing space must survive the round-trip")
        self.assertTrue(stored.endswith(" "))
        # The stripped name is a DIFFERENT address -- verbatim matching, never trimmed.
        self.assertEqual(
            frappe.get_all(_BCS, filters={"boq": self.boq, "sheet_name": "BCS Fix"},
                           pluck="name"),
            [],
            "the stripped sheet name must not resolve the verbatim-stored row",
        )

    def test_carry_attribution_fields_exist_and_default_empty(self):
        """S6 (the revision carry) stamps these. They must exist NOW so S6 costs no
        second production migration; nothing in S1 writes them."""
        doc = frappe.new_doc(_BCS)
        doc.boq = self.boq
        doc.sheet_name = self.sheet
        doc.excel_row = 10
        doc.committed_version = self.cv
        doc.supply_rate = 1.0
        doc.install_rate = 2.0
        doc.bcs_version = 1
        doc.is_current = 1
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        row = frappe.db.get_value(
            _BCS, doc.name,
            ["carried_from_boq", "carried_from_version", "carried_at"], as_dict=True,
        )
        self.assertIsNone(row.carried_from_boq)
        self.assertIn(row.carried_from_version, (0, None))
        self.assertIsNone(row.carried_at)

    def test_rate_source_defaults_to_manual_entry(self):
        """The provenance seam: a LATER slice must be able to record that a rate was
        DERIVED from the Rate Master rather than hand-typed, with no further migration.
        S1 ships the field defaulted to manual; nothing in this arc reads it."""
        doc = frappe.new_doc(_BCS)
        doc.boq = self.boq
        doc.sheet_name = self.sheet
        doc.excel_row = 10
        doc.committed_version = self.cv
        doc.supply_rate = 1.0
        doc.install_rate = 2.0
        doc.bcs_version = 1
        doc.is_current = 1
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        self.assertEqual(frappe.db.get_value(_BCS, doc.name, "rate_source"), "Manual")

    def test_no_stored_total_amount_or_profit_column(self):
        """OWNER-LOCKED: only the two input rates persist. Total Amount and % Profit are
        ALWAYS computed downstream -- a stored copy could disagree with the live sheet."""
        meta = frappe.get_meta(_BCS)
        for banned in ("total_amount", "profit_percent", "percent_profit", "profit"):
            self.assertIsNone(
                meta.get_field(banned),
                f"{banned} must never be stored -- it is always computed",
            )


# ===========================================================================
# Shared base: a committed BoQ with a scalar-qty sheet AND a per-area-qty sheet
# ===========================================================================
class _BcsEndpointBase(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "BCS Endpoint Test BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        cls.cv = 1
        cls.sheet = "Elec BCS "        # VERBATIM trailing space (#152)
        cls.area_sheet = "HVAC BCS "   # per-area quantity sheet
        cls.area_amount_sheet = "Areas BCS "   # per-area AMOUNT sheet (no scalar total)
        cls.fixture = _seed_sheet(cls.boq, cls.sheet, cls.cv, _SCALAR_ROLE_MAP, [], 1)
        cls.area_fixture = _seed_sheet(
            cls.boq, cls.area_sheet, cls.cv, _AREA_ROLE_MAP, ["Zone A", "Zone B"], 2
        )
        cls.area_amount_fixture = _seed_sheet(
            cls.boq, cls.area_amount_sheet, cls.cv, _AREA_AMOUNT_ROLE_MAP,
            ["Zone A", "Zone B"], 4,
        )

    @classmethod
    def tearDownClass(cls):
        _cleanup_committed(cls.boq)
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        # Reset the BCS layer + the BCS sheet config + the single-editor lock per test.
        frappe.db.delete(_BCS, {"boq": self.boq})
        frappe.db.delete(_LOCK_DT, {"boq": self.boq})
        for sheet_row in (self.fixture["bqsh"], self.area_fixture["bqsh"],
                          self.area_amount_fixture["bqsh"]):
            frappe.db.set_value(
                _BOQ_SHEET, sheet_row,
                {"bcs_enabled": 0, "bcs_qty_source": None, "bcs_amount_source": None,
                 "bcs_confirmed_by": None, "bcs_confirmed_at": None},
                update_modified=False,
            )
        frappe.db.commit()

    # -- helpers -----------------------------------------------------------
    def _make_ready(self, sheet=None, qty_cols=None, amount_cols=None):
        """Drive the sheet THROUGH the real endpoints to a ready state (never by a raw
        set_value) -- so setup exercises the same gate production does."""
        sheet = sheet or self.sheet
        set_bcs_enabled(boq_name=self.boq, sheet_name=sheet,
                        committed_version=self.cv, enabled=1)
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name=sheet, committed_version=self.cv,
            qty_cols=json.dumps(qty_cols or ["D"]),
            amount_cols=json.dumps(amount_cols or ["F"]),
        )

    def _current(self, excel_row, sheet=None):
        return frappe.get_all(
            _BCS,
            filters={"boq": self.boq, "sheet_name": sheet or self.sheet,
                     "excel_row": excel_row, "committed_version": self.cv, "is_current": 1},
            fields=["name", "supply_rate", "install_rate", "bcs_version", "node", "is_filled"],
        )

    def _all_versions(self, excel_row, sheet=None):
        return frappe.get_all(
            _BCS,
            filters={"boq": self.boq, "sheet_name": sheet or self.sheet,
                     "excel_row": excel_row, "committed_version": self.cv},
            fields=["bcs_version", "is_current", "supply_rate"],
            order_by="bcs_version asc",
        )


# ===========================================================================
# Group 3: enable / disable + the two confirmations
# ===========================================================================
class TestBcsEnableAndConfirm(_BcsEndpointBase):

    def test_a_fresh_committed_sheet_starts_disabled_and_unconfirmed(self):
        """A re-commit mints a FRESH BoQ Sheet row; BCS must not carry forward into it."""
        state = get_bcs_state(boq_name=self.boq, sheet_name=self.sheet,
                              committed_version=self.cv)
        self.assertEqual(state["bcs_enabled"], 0)
        self.assertIsNone(state["bcs_qty_source"])
        self.assertIsNone(state["bcs_amount_source"])
        self.assertIsNone(state["bcs_confirmed_by"])
        self.assertFalse(state["is_ready"])

    def test_enable_then_disable_round_trips(self):
        set_bcs_enabled(boq_name=self.boq, sheet_name=self.sheet,
                        committed_version=self.cv, enabled=1)
        self.assertEqual(
            get_bcs_state(boq_name=self.boq, sheet_name=self.sheet,
                          committed_version=self.cv)["bcs_enabled"], 1)
        set_bcs_enabled(boq_name=self.boq, sheet_name=self.sheet,
                        committed_version=self.cv, enabled=0)
        self.assertEqual(
            get_bcs_state(boq_name=self.boq, sheet_name=self.sheet,
                          committed_version=self.cv)["bcs_enabled"], 0)

    def test_confirm_stores_a_re_resolvable_scalar_qty_and_amount_source(self):
        res = confirm_bcs_columns(
            boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv,
            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F"]),
        )
        self.assertTrue(res["ok"])
        state = get_bcs_state(boq_name=self.boq, sheet_name=self.sheet,
                              committed_version=self.cv)
        qty = state["bcs_qty_source"]
        self.assertEqual(qty["mode"], "qty_total")
        self.assertEqual([c["col"] for c in qty["columns"]], ["D"])
        # RE-RESOLVABLE: the stored entry carries enough to resolve the value later
        # without re-deriving it from the role map.
        self.assertEqual(qty["columns"][0]["role"], "qty_total")
        self.assertEqual(qty["columns"][0]["value_field"], "qty_total")
        amt = state["bcs_amount_source"]
        self.assertEqual(amt["mode"], "amount_total")
        self.assertEqual([c["col"] for c in amt["columns"]], ["F"])
        self.assertEqual(amt["columns"][0]["value_field"], "amount_total")

    def test_confirm_stores_the_summed_set_when_quantity_is_mapped_per_area(self):
        """The owner's second quantity shape: a sheet with NO scalar qty_total, whose
        Total Quantity is the SUM of its per-area quantity columns."""
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name=self.area_sheet, committed_version=self.cv,
            qty_cols=json.dumps(["D", "E"]), amount_cols=json.dumps(["H"]),
        )
        qty = get_bcs_state(boq_name=self.boq, sheet_name=self.area_sheet,
                            committed_version=self.cv)["bcs_qty_source"]
        self.assertEqual(qty["mode"], "qty_by_area")
        self.assertEqual([c["col"] for c in qty["columns"]], ["D", "E"])
        self.assertEqual([c["area"] for c in qty["columns"]], ["Zone A", "Zone B"])
        self.assertTrue(all(c["value_field"] == "qty_by_area" for c in qty["columns"]))

    def test_confirm_records_who_and_when(self):
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv,
            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F"]),
        )
        state = get_bcs_state(boq_name=self.boq, sheet_name=self.sheet,
                              committed_version=self.cv)
        self.assertEqual(state["bcs_confirmed_by"], frappe.session.user)
        self.assertIsNotNone(state["bcs_confirmed_at"])

    # -- REFUSALS: a pick the sheet does not have is refused, nothing stored ----

    def test_qty_column_absent_from_the_sheet_is_refused_and_nothing_is_stored(self):
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv,
                qty_cols=json.dumps(["Z"]), amount_cols=json.dumps(["F"]),   # Z is not mapped
            )
        state = get_bcs_state(boq_name=self.boq, sheet_name=self.sheet,
                              committed_version=self.cv)
        self.assertIsNone(state["bcs_qty_source"], "a refused confirmation stores NOTHING")
        self.assertIsNone(state["bcs_amount_source"])
        self.assertIsNone(state["bcs_confirmed_by"])

    def test_amount_column_absent_from_the_sheet_is_refused_and_nothing_is_stored(self):
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv,
                qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["Z"]),
            )
        state = get_bcs_state(boq_name=self.boq, sheet_name=self.sheet,
                              committed_version=self.cv)
        self.assertIsNone(state["bcs_qty_source"])
        self.assertIsNone(state["bcs_amount_source"])

    def test_a_mapped_column_of_the_wrong_class_is_refused(self):
        """C is a real mapped column on this sheet -- but it is the Unit column, not a
        quantity. Existing is not enough; it must be a quantity column."""
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv,
                qty_cols=json.dumps(["C"]), amount_cols=json.dumps(["F"]),
            )
        # ... and the amount pick must be the combined amount, not the rate column.
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv,
                qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["E"]),   # E is rate_combined
            )
        self.assertIsNone(
            get_bcs_state(boq_name=self.boq, sheet_name=self.sheet,
                          committed_version=self.cv)["bcs_qty_source"])

    def test_mixing_a_scalar_total_with_per_area_quantity_columns_is_refused(self):
        """Summing a scalar total AND its per-area parts would double-count."""
        _seed_sheet(self.boq, "Mixed BCS ", self.cv, {
            "A": {"role": "description", "area": None},
            "D": {"role": "qty", "area": "Zone A"},
            "E": {"role": "qty_total", "area": None},
            "F": {"role": "amount_total", "area": None},
        }, ["Zone A"], 3)
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name="Mixed BCS ", committed_version=self.cv,
                qty_cols=json.dumps(["D", "E"]), amount_cols=json.dumps(["F"]),
            )

    def test_empty_qty_selection_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv,
                qty_cols=json.dumps([]), amount_cols=json.dumps(["F"]),
            )

    def test_the_same_column_picked_twice_is_refused_and_nothing_is_stored(self):
        """The SIXTH refusal (BCS-S1b): one column picked twice would store two identical
        entries, and summing them double-counts the row -- the same harm the mixed
        total-and-parts refusal names.

        Both shapes are exercised because only ONE of them was ever a hole: a repeated
        SCALAR pick already fell foul of the one-scalar-column rule, so it was refused by
        accident; a repeated PER-AREA pick reached the store, which is the gap this slice
        closes. The endpoint's job here is that the pure module's refusal SURFACES as a
        clean named error and leaves the confirmation untouched -- the rule itself is
        pinned in services/boq_bcs/test_sources.py."""
        # per-area QUANTITY, repeated -- the real hole.
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name=self.area_sheet, committed_version=self.cv,
                qty_cols=json.dumps(["D", "D"]), amount_cols=json.dumps(["H"]),
            )
        state = get_bcs_state(boq_name=self.boq, sheet_name=self.area_sheet,
                              committed_version=self.cv)
        self.assertIsNone(state["bcs_qty_source"], "a refused confirmation stores NOTHING")
        self.assertIsNone(state["bcs_amount_source"])
        self.assertIsNone(state["bcs_confirmed_by"])

        # per-area AMOUNT, repeated -- the same hole on the other source.
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name=self.area_amount_sheet,
                committed_version=self.cv,
                qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F", "F"]),
            )
        state = get_bcs_state(boq_name=self.boq, sheet_name=self.area_amount_sheet,
                              committed_version=self.cv)
        self.assertIsNone(state["bcs_amount_source"], "a refused confirmation stores NOTHING")
        self.assertIsNone(state["bcs_qty_source"])


# ===========================================================================
# Group 3b: the AMOUNT source has the same TWO shapes as quantity (BCS-S1a)
# ===========================================================================
class TestBcsPerAreaAmountSource(_BcsEndpointBase):
    """OWNER RULING 2026-08-02: per-area amounts SUM into a row total, exactly as
    quantity already does.

    S1 implemented the amount confirmation STRICTLY -- scalar amount_total only -- which
    meant a sheet mapping ONLY per-area amount columns could not enable BCS at all. That
    is the shape of the shared committed fixture, so it was never hypothetical. The two
    sources now read as ONE idea: same two shapes, same refusals, same reasons."""

    def test_a_sheet_with_only_per_area_amounts_can_be_confirmed(self):
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name=self.area_amount_sheet,
            committed_version=self.cv,
            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F", "G"]),
        )
        amt = get_bcs_state(boq_name=self.boq, sheet_name=self.area_amount_sheet,
                            committed_version=self.cv)["bcs_amount_source"]
        self.assertEqual(amt["mode"], "amount_by_area")
        self.assertEqual([c["col"] for c in amt["columns"]], ["F", "G"])
        self.assertEqual([c["area"] for c in amt["columns"]], ["Zone A", "Zone B"])
        self.assertTrue(all(c["value_field"] == "amount_by_area" for c in amt["columns"]))

    def test_the_per_area_amount_entry_stays_re_resolvable(self):
        """A per-area amount is a THREE-hop resolve -- amount_by_area[area][kind] -- so
        the stored entry must carry the kind (rate_subkey) as well as the area. Without
        it a later reader cannot resolve the number, which is the whole point of storing
        the confirmation rather than re-deriving it from column_role_map."""
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name=self.area_amount_sheet,
            committed_version=self.cv,
            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F", "G"]),
        )
        amt = get_bcs_state(boq_name=self.boq, sheet_name=self.area_amount_sheet,
                            committed_version=self.cv)["bcs_amount_source"]
        for entry in amt["columns"]:
            self.assertEqual(entry["value_key"], entry["area"])
            self.assertEqual(entry["rate_subkey"], "total")

    def test_a_bcs_rate_write_succeeds_on_a_sheet_with_only_per_area_amounts(self):
        """The end-to-end the strictness blocked: confirm, then actually cost a row."""
        set_bcs_enabled(boq_name=self.boq, sheet_name=self.area_amount_sheet,
                        committed_version=self.cv, enabled=1)
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name=self.area_amount_sheet,
            committed_version=self.cv,
            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F", "G"]),
        )
        self.assertTrue(bcs_is_ready(self.boq, self.area_amount_sheet, self.cv))
        res = save_row_bcs_rates(
            boq_name=self.boq, sheet_name=self.area_amount_sheet, excel_row=10,
            committed_version=self.cv, supply_rate=80.0, install_rate=20.0,
        )
        self.assertTrue(res["ok"])
        cur = self._current(10, sheet=self.area_amount_sheet)
        self.assertEqual(len(cur), 1)
        self.assertEqual(cur[0]["supply_rate"], 80.0)

    def test_the_stored_amount_confirmation_is_dict_valued_at_its_top_level(self):
        """A list-valued JSON field throws in base_document.get_valid_dict. S1 avoided
        that by nesting the column list INSIDE a dict; summing must not flatten it back
        out to a bare list."""
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name=self.area_amount_sheet,
            committed_version=self.cv,
            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F", "G"]),
        )
        raw = frappe.db.get_value(
            _BOQ_SHEET, self.area_amount_fixture["bqsh"], "bcs_amount_source"
        )
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        self.assertIsInstance(parsed, dict, "the stored confirmation must be a DICT")
        self.assertIsInstance(parsed["columns"], list)

    def test_a_per_area_supply_half_is_refused_as_the_amount_source(self):
        """H is a real, mapped per-area amount column -- but it is the SUPPLY half, not
        what we charge the client. Accepting it would silently compare our cost against a
        fraction of the charged amount. The per-area twin of refusing scalar
        amount_supply."""
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name=self.area_amount_sheet,
                committed_version=self.cv,
                qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F", "H"]),
            )
        self.assertIsNone(
            get_bcs_state(boq_name=self.boq, sheet_name=self.area_amount_sheet,
                          committed_version=self.cv)["bcs_amount_source"],
            "a refused confirmation stores NOTHING",
        )

    def test_mixing_a_scalar_amount_with_per_area_amount_columns_is_refused(self):
        """The exact mirror of the quantity rule: summing a total together with its own
        parts counts every amount twice."""
        _seed_sheet(self.boq, "MixedAmt BCS ", self.cv, {
            "A": {"role": "description", "area": None},
            "D": {"role": "qty_total", "area": None},
            "E": {"role": "amount_total", "area": None},
            "F": {"role": "amount_total_by_area", "area": "Zone A"},
        }, ["Zone A"], 5)
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name="MixedAmt BCS ", committed_version=self.cv,
                qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["E", "F"]),
            )

    def test_more_than_one_scalar_amount_column_is_refused(self):
        """A sheet has exactly one scalar combined Amount column; the quantity source
        refuses two scalar totals and the amount source must refuse them identically."""
        _seed_sheet(self.boq, "TwoAmt BCS ", self.cv, {
            "A": {"role": "description", "area": None},
            "D": {"role": "qty_total", "area": None},
            "E": {"role": "amount_total", "area": None},
            "F": {"role": "amount_total", "area": None},
        }, [], 6)
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name="TwoAmt BCS ", committed_version=self.cv,
                qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["E", "F"]),
            )

    def test_empty_amount_selection_is_refused(self):
        """The mirror of test_empty_qty_selection_is_refused."""
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name=self.area_amount_sheet,
                committed_version=self.cv,
                qty_cols=json.dumps(["D"]), amount_cols=json.dumps([]),
            )

    def test_the_scalar_amount_shape_still_works_unchanged(self):
        """Widening must not cost the shape that already worked."""
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv,
            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F"]),
        )
        amt = get_bcs_state(boq_name=self.boq, sheet_name=self.sheet,
                            committed_version=self.cv)["bcs_amount_source"]
        self.assertEqual(amt["mode"], "amount_total")
        self.assertEqual([c["col"] for c in amt["columns"]], ["F"])


# ===========================================================================
# Group 4: the readiness gate -- BCS writes ONLY
# ===========================================================================
class TestBcsReadinessGate(_BcsEndpointBase):

    def test_not_ready_until_both_enabled_and_confirmed(self):
        self.assertFalse(bcs_is_ready(self.boq, self.sheet, self.cv))
        set_bcs_enabled(boq_name=self.boq, sheet_name=self.sheet,
                        committed_version=self.cv, enabled=1)
        self.assertFalse(bcs_is_ready(self.boq, self.sheet, self.cv),
                         "enabled alone is not ready -- the columns are unconfirmed")
        confirm_bcs_columns(boq_name=self.boq, sheet_name=self.sheet,
                            committed_version=self.cv,
                            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F"]))
        self.assertTrue(bcs_is_ready(self.boq, self.sheet, self.cv))

    def test_confirmed_but_disabled_is_not_ready(self):
        confirm_bcs_columns(boq_name=self.boq, sheet_name=self.sheet,
                            committed_version=self.cv,
                            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F"]))
        self.assertFalse(bcs_is_ready(self.boq, self.sheet, self.cv))

    def test_rate_write_refused_while_bcs_is_disabled(self):
        with self.assertRaises(frappe.ValidationError):
            save_row_bcs_rates(
                boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                committed_version=self.cv, supply_rate=10.0, install_rate=2.0,
            )
        self.assertEqual(self._current(10), [], "a refused BCS write stores nothing")

    def test_rate_write_refused_while_columns_are_unconfirmed(self):
        set_bcs_enabled(boq_name=self.boq, sheet_name=self.sheet,
                        committed_version=self.cv, enabled=1)
        with self.assertRaises(frappe.ValidationError):
            save_row_bcs_rates(
                boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                committed_version=self.cv, supply_rate=10.0, install_rate=2.0,
            )
        self.assertEqual(self._current(10), [])

    def test_rate_write_succeeds_once_ready(self):
        self._make_ready()
        res = save_row_bcs_rates(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
            committed_version=self.cv, supply_rate=120.0, install_rate=30.0,
        )
        self.assertTrue(res["ok"])
        cur = self._current(10)
        self.assertEqual(len(cur), 1)
        self.assertEqual(cur[0]["supply_rate"], 120.0)
        self.assertEqual(cur[0]["install_rate"], 30.0)
        self.assertEqual(cur[0]["is_filled"], 1)
        self.assertEqual(cur[0]["node"], self.fixture["line_items"][0],
                         "the resolved committed node is stored as the re-resolvable pointer")

    def test_rate_write_refused_on_a_row_that_is_not_in_the_committed_tier(self):
        self._make_ready()
        with self.assertRaises(frappe.ValidationError):
            save_row_bcs_rates(
                boq_name=self.boq, sheet_name=self.sheet, excel_row=9999,
                committed_version=self.cv, supply_rate=1.0, install_rate=1.0,
            )
        self.assertEqual(self._current(9999), [])

    def test_a_re_commit_starts_bcs_disabled_and_unconfirmed(self):
        """RE-COMMIT INVALIDATES, exactly like is_locked / classification_frozen /
        category_gate_override. commit_pipeline._write_committed_boq_sheet mints a FRESH
        BoQ Sheet row via frappe.new_doc and never touches the BCS fields, so the new
        version takes the JSON defaults. Verified here rather than assumed: a sheet made
        ready at v1 must NOT be ready at v2."""
        self._make_ready(sheet=self.sheet)
        self.assertTrue(bcs_is_ready(self.boq, self.sheet, self.cv))

        # Insert v2 the way the commit pipeline does -- BCS fields untouched.
        v2 = self.cv + 1
        frappe.db.set_value(_BOQ_SHEET, self.fixture["bqsh"], "is_current", 0,
                            update_modified=False)
        bs = frappe.new_doc(_BOQ_SHEET)
        bs.boq = self.boq
        bs.sheet_name = self.sheet
        bs.sheet_order = 1
        bs.treat_as = "data"
        bs.header_row = 1
        bs.header_row_count = 1
        bs.column_role_map = json.dumps(_SCALAR_ROLE_MAP)
        bs.column_headers = json.dumps({})
        bs.area_dimensions = json.dumps([])
        bs.commit_version = v2
        bs.is_current = 1
        bs.committed_at = frappe.utils.now()
        bs.insert(ignore_permissions=True)
        frappe.db.commit()
        try:
            state = get_bcs_state(boq_name=self.boq, sheet_name=self.sheet,
                                  committed_version=v2)
            self.assertEqual(state["bcs_enabled"], 0, "BCS must not carry into a re-commit")
            self.assertIsNone(state["bcs_qty_source"])
            self.assertIsNone(state["bcs_amount_source"])
            self.assertIsNone(state["bcs_confirmed_by"])
            self.assertFalse(bcs_is_ready(self.boq, self.sheet, v2))
        finally:
            frappe.db.delete(_BOQ_SHEET, {"name": bs.name})
            frappe.db.set_value(_BOQ_SHEET, self.fixture["bqsh"], "is_current", 1,
                                update_modified=False)
            frappe.db.commit()

    def test_the_gate_is_per_sheet_not_per_boq(self):
        """Readiness on one sheet must not unlock BCS on a sibling sheet."""
        self._make_ready(sheet=self.sheet)
        self.assertTrue(bcs_is_ready(self.boq, self.sheet, self.cv))
        self.assertFalse(bcs_is_ready(self.boq, self.area_sheet, self.cv))
        with self.assertRaises(frappe.ValidationError):
            save_row_bcs_rates(
                boq_name=self.boq, sheet_name=self.area_sheet, excel_row=10,
                committed_version=self.cv, supply_rate=1.0, install_rate=1.0,
            )


# ===========================================================================
# Group 2: freeze-and-supersede through the write endpoint
# ===========================================================================
class TestBcsFreezeAndSupersede(_BcsEndpointBase):

    def setUp(self):
        super().setUp()
        self._make_ready()

    def test_first_save_is_version_1_and_freezes_nothing(self):
        res = save_row_bcs_rates(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
            committed_version=self.cv, supply_rate=100.0, install_rate=10.0,
        )
        self.assertEqual(res["bcs_version"], 1)
        self.assertEqual(res["froze_prior"], 0)

    def test_resave_supersedes_and_leaves_exactly_one_current(self):
        save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                           committed_version=self.cv, supply_rate=100.0, install_rate=10.0)
        res2 = save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                                  committed_version=self.cv, supply_rate=175.0,
                                  install_rate=25.0)
        self.assertEqual(res2["bcs_version"], 2)
        self.assertEqual(res2["froze_prior"], 1)
        cur = self._current(10)
        self.assertEqual(len(cur), 1, "exactly ONE current after re-save")
        self.assertEqual(cur[0]["supply_rate"], 175.0)
        versions = self._all_versions(10)
        self.assertEqual([v["bcs_version"] for v in versions], [1, 2])
        self.assertEqual([v["is_current"] for v in versions], [0, 1],
                         "v1 frozen, v2 current -- never overwritten in place")

    def test_one_current_invariant_after_many_resaves(self):
        for r in (10.0, 20.0, 30.0, 40.0):
            save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=11,
                               committed_version=self.cv, supply_rate=r, install_rate=1.0)
        cur = self._current(11)
        self.assertEqual(len(cur), 1)
        self.assertEqual(cur[0]["bcs_version"], 4)
        self.assertEqual(cur[0]["supply_rate"], 40.0)

    def test_two_rows_on_one_sheet_do_not_freeze_each_other(self):
        save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                           committed_version=self.cv, supply_rate=1.0, install_rate=1.0)
        save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=11,
                           committed_version=self.cv, supply_rate=2.0, install_rate=2.0)
        self.assertEqual(len(self._current(10)), 1)
        self.assertEqual(len(self._current(11)), 1)

    def test_get_sheet_bcs_rates_returns_only_the_current_set(self):
        save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                           committed_version=self.cv, supply_rate=1.0, install_rate=1.0)
        save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                           committed_version=self.cv, supply_rate=9.0, install_rate=9.0)
        save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=11,
                           committed_version=self.cv, supply_rate=2.0, install_rate=2.0)
        read = get_sheet_bcs_rates(boq_name=self.boq, sheet_name=self.sheet,
                                   committed_version=self.cv)
        rows = read["rows"]
        self.assertEqual(len(rows), 2, "one row per Excel row -- superseded versions excluded")
        by_row = {r["excel_row"]: r for r in rows}
        self.assertEqual(by_row[10]["supply_rate"], 9.0)
        self.assertEqual(by_row[11]["supply_rate"], 2.0)

    def test_read_is_scoped_to_the_verbatim_sheet_name(self):
        save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                           committed_version=self.cv, supply_rate=5.0, install_rate=5.0)
        stripped = get_sheet_bcs_rates(boq_name=self.boq, sheet_name=self.sheet.strip(),
                                       committed_version=self.cv)
        self.assertEqual(stripped["rows"], [],
                         "the stripped sheet name is a DIFFERENT address (#152)")


# ===========================================================================
# Group 5: the single-editor pricing lock -- a rejection mutates NOTHING
# ===========================================================================
class TestBcsRespectsTheSingleEditorLock(_BcsEndpointBase):

    def setUp(self):
        super().setUp()
        self._make_ready()

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # BoQ Sheet Pricing Lock.locked_by is a Link to User, so the competing holder must
        # be a REAL enabled user -- the house pattern in test_pricing.py.
        cls.me = frappe.session.user
        cls.other = frappe.db.get_value(
            "User", {"name": ["not in", [cls.me, "Guest"]], "enabled": 1}, "name"
        )
        assert cls.other, "need a second real User to play the competing lock holder"

    def _seed_fresh_lock_for_another_user(self):
        acquire_or_refresh(self.boq, self.sheet, self.cv, self.other,
                           frappe.utils.now_datetime())
        frappe.db.commit()

    def test_write_rejected_while_another_user_holds_a_fresh_lock(self):
        self._seed_fresh_lock_for_another_user()
        with self.assertRaises(frappe.ValidationError) as ctx:
            save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                               committed_version=self.cv, supply_rate=50.0, install_rate=5.0)
        self.assertIn(_LOCK_HELD_MARKER, str(ctx.exception))

    def test_a_lock_rejection_mutates_nothing(self):
        # A pre-existing cost the rejected save must not disturb.
        save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                           committed_version=self.cv, supply_rate=11.0, install_rate=1.0)
        frappe.db.delete(_LOCK_DT, {"boq": self.boq})
        frappe.db.commit()
        self._seed_fresh_lock_for_another_user()

        before = self._all_versions(10)
        with self.assertRaises(frappe.ValidationError):
            save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                               committed_version=self.cv, supply_rate=99.0, install_rate=9.0)
        after = self._all_versions(10)
        self.assertEqual(before, after, "the rejected save wrote NOTHING and froze nothing")
        cur = self._current(10)
        self.assertEqual(len(cur), 1)
        self.assertEqual(cur[0]["supply_rate"], 11.0, "the prior cost is untouched")

    def test_the_holder_may_keep_writing(self):
        acquire_or_refresh(self.boq, self.sheet, self.cv, frappe.session.user,
                           frappe.utils.now_datetime())
        frappe.db.commit()
        res = save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                                 committed_version=self.cv, supply_rate=7.0, install_rate=3.0)
        self.assertTrue(res["ok"])

    def test_write_rejected_on_a_deliberately_locked_sheet(self):
        """The per-sheet read-only lock (BoQ Sheet.is_locked) rejects BCS writes too --
        it is what 'this sheet is read-only' means for every save path."""
        frappe.db.set_value(_BOQ_SHEET, self.fixture["bqsh"], "is_locked", 1,
                            update_modified=False)
        frappe.db.commit()
        try:
            with self.assertRaises(frappe.ValidationError):
                save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                                   committed_version=self.cv, supply_rate=1.0,
                                   install_rate=1.0)
            self.assertEqual(self._current(10), [])
        finally:
            frappe.db.set_value(_BOQ_SHEET, self.fixture["bqsh"], "is_locked", 0,
                                update_modified=False)
            frappe.db.commit()


# ===========================================================================
# Group 6a: the BCS write path is INDEPENDENT of the client-facing gates
# ===========================================================================
class TestBcsWritesAreIndependentOfTheClientGates(_BcsEndpointBase):
    """OWNER-CONFIRMED 2026-08-02: the BCS write path runs ONLY committed-cell ->
    sheet-lock -> BCS-readiness -> pricing-lock. It DELIBERATELY skips the mandatory
    amount-formula gate, the priceability gate and the category gate.

    Cost is a SEPARATE AXIS with its own two-column confirmation; it must not wait on the
    client-facing side being finished. Someone should be able to cost a job while the
    amount formulas are still being declared and the rows are still being categorised.

    Until BCS-S1a this independence was undocumented AND untested -- exactly the shape a
    later slice 'fixes' into consistency. Each skip is pinned here separately, and each
    test asserts its PRECONDITION first so it can never pass vacuously. Do NOT delete
    these to restore symmetry with save_cell_price."""

    def setUp(self):
        super().setUp()
        self._make_ready()

    def test_a_bcs_write_succeeds_while_the_amount_formulas_are_incomplete(self):
        """save_cell_price would refuse here ('Formulas incomplete'); BCS does not."""
        self.assertFalse(
            _sheet_formulas_complete(self.boq, self.sheet, self.cv),
            "precondition: this sheet has an amount column and NO declared formula",
        )
        res = save_row_bcs_rates(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
            committed_version=self.cv, supply_rate=90.0, install_rate=10.0,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(len(self._current(10)), 1)

    def test_a_bcs_write_succeeds_while_every_category_is_blank(self):
        """save_cell_price would refuse here ('Categories incomplete'); BCS does not."""
        self.assertFalse(
            _categories_gate_ok(self.boq, self.sheet, self.cv),
            "precondition: no eligible row on this sheet has a category yet",
        )
        res = save_row_bcs_rates(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
            committed_version=self.cv, supply_rate=70.0, install_rate=30.0,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(len(self._current(10)), 1)

    def test_a_bcs_write_succeeds_on_a_zero_qty_preamble_row(self):
        """The ASYMMETRIC priceability rule makes a qty-less Preamble read-only for a
        CLIENT rate. It still costs us something to do, so BCS may cost it."""
        self.assertFalse(
            _node_priceable_without_override("Preamble", self.fixture["preamble"], None),
            "precondition: the fixture Preamble is qty-less, so NOT client-priceable",
        )
        res = save_row_bcs_rates(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=5,   # the Preamble row
            committed_version=self.cv, supply_rate=15.0, install_rate=5.0,
        )
        self.assertTrue(res["ok"])
        cur = self._current(5)
        self.assertEqual(len(cur), 1)
        self.assertEqual(cur[0]["node"], self.fixture["preamble"])


# ===========================================================================
# Group 6b: BCS gates its OWN cells only -- owner-locked
# ===========================================================================
class TestBcsDoesNotGateOrdinaryPricing(_BcsEndpointBase):

    def test_an_ordinary_client_rate_write_succeeds_while_bcs_is_off(self):
        """THE POSITIVE CONTROL for owner rule 2, and the assertion the whole design
        turns on: on a sheet where BCS is disabled AND unconfirmed, ordinary client-facing
        pricing is completely unaffected.

        Its sibling below greps pricing.py for BCS tokens. That is a good tripwire but it
        is not proof of BEHAVIOUR -- it is blind to indirection, and it would keep passing
        if the gate arrived through a helper that never names BCS. This test exercises the
        real endpoint instead."""
        _declare_scalar_amount_formula(self.boq, self.sheet, self.cv)
        _categorise_fixture_eligible_rows(self.boq, self.sheet, self.cv)

        # The state under test: BCS off, nothing confirmed, not ready.
        state = get_bcs_state(boq_name=self.boq, sheet_name=self.sheet,
                              committed_version=self.cv)
        self.assertEqual(state["bcs_enabled"], 0)
        self.assertIsNone(state["bcs_qty_source"])
        self.assertIsNone(state["bcs_amount_source"])
        self.assertFalse(bcs_is_ready(self.boq, self.sheet, self.cv))

        res = save_cell_price(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=10, col_letter="E",
            committed_version=self.cv, rate=175.0,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["pricing_version"], 1)
        self.assertEqual(
            frappe.db.get_value(
                _PRICING,
                {"boq": self.boq, "sheet_name": self.sheet, "excel_row": 10,
                 "col_letter": "E", "committed_version": self.cv, "is_current": 1},
                "rate",
            ),
            175.0,
            "the client rate landed normally with BCS switched off",
        )

    def test_bcs_module_never_touches_the_client_facing_rate_gate(self):
        """OWNER-LOCKED: an unconfirmed BCS section must leave ordinary client-facing
        pricing fully editable. The BCS readiness predicate must therefore have NO caller
        inside pricing.py -- structurally, not by convention."""
        import inspect

        from nirmaan_stack.api.boq.wizard import pricing

        src = inspect.getsource(pricing)
        for token in ("bcs_is_ready", "_guard_bcs_ready", "BoQ Row BCS Rate",
                      "import bcs", "wizard.bcs"):
            self.assertNotIn(
                token, src,
                f"pricing.py must not reference {token!r} -- the BCS gate guards BCS "
                f"cells ONLY and must never reach the client-facing rate gate",
            )
