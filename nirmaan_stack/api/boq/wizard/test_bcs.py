# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for the BCS (cost & margin) foundation -- slices BCS-S1 / S1a / S1b / S1c / S2b.

BCS is the COST side of a committed BoQ row: hand-typed rates representing what the work
costs US, sitting against the BoQ amount we charge the CLIENT. This layer is STORAGE +
ENDPOINTS only -- nothing renders, and Total Amount / % Profit are NEVER stored (they are
always computed downstream from the stored rates + the confirmed quantity and amount
columns).

Coverage:
  Group 1   doctype identity -- per-ROW (no col_letter), sheet_name VERBATIM (#152), and
            the three stored cost inputs (S2b added combined_rate).
  Group 2   freeze-and-supersede -- a re-save supersedes; exactly ONE current row, ever.
  Group 3   enable / disable + the confirmation of the two columns, validated against the
            sheet's REAL column_descriptors (a column the sheet does not have is REFUSED
            and NOTHING is stored).
  Group 3b  (S1a) the AMOUNT source has the SAME two shapes as quantity -- a scalar total
            OR the per-area combined amounts, SUMMED. Same refusals, same reasons.
  Group 3c  (S2b) SPLIT amount sheets reach the store -- Supply + Installation summed, and
            a one-sided sheet accepted with the formula disclosed in the stored `mode`.
            What survived: a TOTAL picked together with a half is still refused.
  Group 3d  (S2b) the combined_rate input -- the one undifferentiated cost a combined-rate
            sheet quotes, accepted exactly as the two halves are.
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
    apply_copy_forward,
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
#   H     -- Zone A's SUPPLY half, sitting BESIDE Zone A's combined amount. What this is
#            FOR changed at BCS-S2b: it used to prove a half was refused OUTRIGHT, and it
#            now proves the narrower rule that survived the owner's reversal -- F already
#            CONTAINS H, so picking them together counts Zone A's supply twice. A half with
#            no total beside it is perfectly acceptable; see Group 3c's split sheets.
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


def _seed_sheet(boq_name, sheet_name, commit_version, role_map, area_dims, sheet_order,
                is_current=1):
    """Insert one committed BoQ Sheet + a Preamble root + 2 Line Item children.
    sheet_name stored VERBATIM (#152). Mirrors build_committed_sheet_fixture's shape but
    with the role maps this slice needs (a scalar-qty sheet and a per-area-qty sheet).

    `is_current` defaults to 1, so every pre-BCS-S6 caller is byte-identical. BCS-S6 needs a
    SUPERSEDED version too (a carry has an older source and a current destination), and the
    within-BoQ row match reads nodes by sheet DOCNAME with no is_current filter -- so a
    superseded source still matches, which is exactly the case the carry exists for."""
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
    bs.is_current = is_current
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
    pre.is_current = is_current
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
        li.is_current = is_current
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
    committed_version). There is deliberately NO col_letter: the BCS columns are
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
        """OWNER-LOCKED: only the INPUT rates persist. Total Amount and % Profit are
        ALWAYS computed downstream -- a stored copy could disagree with the live sheet."""
        meta = frappe.get_meta(_BCS)
        for banned in ("total_amount", "profit_percent", "percent_profit", "profit"):
            self.assertIsNone(
                meta.get_field(banned),
                f"{banned} must never be stored -- it is always computed",
            )

    def test_a_combined_rate_field_exists_beside_the_two_halves(self):
        """BCS-S2b: not every sheet splits supply from installation. A combined-rate sheet
        quotes ONE undifferentiated cost, and it needs an honest home rather than being
        shoved into a field named "supply" -- a name that would lie about what the number
        is and would strand anyone later trying to read the split back out."""
        field = frappe.get_meta(_BCS).get_field("combined_rate")
        self.assertIsNotNone(
            field, "BoQ Row BCS Rate must carry combined_rate (BCS-S2b)")
        self.assertEqual(field.fieldtype, "Currency",
                         "combined_rate is money, like the two halves beside it")

    def test_the_combined_rate_is_not_a_total_of_the_other_two(self):
        """The load-bearing thing about this field, pinned so a later reader cannot assume
        otherwise: it is a THIRD, INDEPENDENT input, not a derived sum. Stored alone it
        stays alone -- nothing computes it from supply + install, and nothing splits it
        back into them."""
        doc = frappe.new_doc(_BCS)
        doc.boq = self.boq
        doc.sheet_name = self.sheet
        doc.excel_row = 10
        doc.committed_version = self.cv
        doc.combined_rate = 250.75
        doc.bcs_version = 1
        doc.is_current = 1
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        row = frappe.db.get_value(
            _BCS, doc.name, ["supply_rate", "install_rate", "combined_rate"],
            as_dict=True)
        self.assertEqual(row.combined_rate, 250.75)
        self.assertEqual(row.supply_rate, 0.0, "a combined rate does not populate a half")
        self.assertEqual(row.install_rate, 0.0)


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
            fields=["name", "supply_rate", "install_rate", "combined_rate",
                    "bcs_version", "node", "is_filled"],
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

    def test_two_columns_holding_the_same_value_are_refused_and_nothing_is_stored(self):
        """BCS-S1c: the refusal above, keyed on what the pick RESOLVES TO rather than on
        the letter that was picked.

        S1b de-duplicated the LETTER, which two DIFFERENT letters carrying the same number
        walk straight past -- and summing them is the very double-count the rule exists to
        prevent. This is reachable from a real sheet: _build_column_descriptors imposes no
        uniqueness on (role, area) across columns, so the role map below (Zone A quantity
        on BOTH D and E, the Zone A combined amount on BOTH F and G) is something a
        duplicated export column or a mid-migration remap produces.

        The endpoint's job here is the usual one -- that the pure module's refusal SURFACES
        as a clean named error and leaves the confirmation untouched. Which refusal it is,
        and why, is pinned in services/boq_bcs/test_sources.py."""
        _seed_sheet(self.boq, "Aliased BCS ", self.cv, {
            "A": {"role": "description", "area": None},
            "D": {"role": "qty", "area": "Zone A"},
            "E": {"role": "qty", "area": "Zone A"},
            "F": {"role": "amount_total_by_area", "area": "Zone A"},
            "G": {"role": "amount_total_by_area", "area": "Zone A"},
            "H": {"role": "amount_total", "area": None},
        }, ["Zone A"], 7)

        # two letters, ONE quantity (the amount pick is valid, so only the qty can refuse).
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name="Aliased BCS ", committed_version=self.cv,
                qty_cols=json.dumps(["D", "E"]), amount_cols=json.dumps(["H"]),
            )
        state = get_bcs_state(boq_name=self.boq, sheet_name="Aliased BCS ",
                              committed_version=self.cv)
        self.assertIsNone(state["bcs_qty_source"], "a refused confirmation stores NOTHING")
        self.assertIsNone(state["bcs_amount_source"])
        self.assertIsNone(state["bcs_confirmed_by"])

        # two letters, ONE amount (the qty pick is valid, so only the amount can refuse).
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name="Aliased BCS ", committed_version=self.cv,
                qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F", "G"]),
            )
        state = get_bcs_state(boq_name=self.boq, sheet_name="Aliased BCS ",
                              committed_version=self.cv)
        self.assertIsNone(state["bcs_amount_source"], "a refused confirmation stores NOTHING")
        self.assertIsNone(state["bcs_qty_source"])
        self.assertIsNone(state["bcs_confirmed_by"])

        # ... and the sheet is still confirmable once each value is picked ONCE, so the
        # rule refuses the double-count without refusing the sheet.
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name="Aliased BCS ", committed_version=self.cv,
            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F"]),
        )
        state = get_bcs_state(boq_name=self.boq, sheet_name="Aliased BCS ",
                              committed_version=self.cv)
        self.assertEqual(state["bcs_qty_source"]["mode"], "qty_by_area")
        self.assertEqual(state["bcs_amount_source"]["mode"], "amount_by_area")


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

    def test_a_per_area_half_picked_WITH_its_own_combined_amount_is_refused(self):
        """WAS: "a per-area supply half is refused as the amount source" (BCS-S1).

        The owner reversed the half-refusal on 2026-08-02 -- a lone half is accepted now,
        and BCS-S2b's endpoint tests below cost a split sheet end to end. What survived is
        the double-count underneath it: F is Zone A's COMBINED amount and H is Zone A's
        SUPPLY half, so F already contains H and the pair counts Zone A's supply twice.

        The endpoint's job here is the usual one -- that the pure module's refusal SURFACES
        as a clean named error and leaves the confirmation untouched. WHY the rule exists
        is pinned in services/boq_bcs/test_sources.py; that WHICH refusal arrived is
        checked here too, corrected at BCS-S2c. Asserting the type alone could not tell
        this refusal from any other in the module -- they all raise the one ValidationError
        -- so a message drifting onto a neighbour's words left it green. Surfacing the pure
        module's WORDS INTACT is the endpoint's actual contract here: the card shows the
        server's sentence verbatim when its own mirror thought the pick was fine, so a
        refusal that arrives mis-voiced is what the user reads."""
        with self.assertRaises(frappe.ValidationError) as ctx:
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name=self.area_amount_sheet,
                committed_version=self.cv,
                qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F", "H"]),
            )
        self.assertIn("already includes the supply and installation", str(ctx.exception))
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
# Group 3c: SPLIT amount sheets reach the store (BCS-S2b)
# ===========================================================================
class TestBcsSplitAmountSource(_BcsEndpointBase):
    """OWNER RULING 2026-08-02, reversing a BCS-S1 decision.

    Most real sheets have no single "Amount (Total)" column -- they carry Amount (Supply)
    and Amount (Installation) separately -- so refusing the halves left the confirmation
    card's Amount list EMPTY on most real sheets. Where there is no scalar total the
    denominator is the two halves SUMMED; and a sheet carrying only ONE half is ACCEPTED
    with the formula disclosed, because a one-sided package is a genuine commercial shape
    rather than a data gap.

    These are the ENDPOINT's half of that: that a split sheet can be confirmed, stored and
    then actually COSTED end to end -- the thing S1a's strictness made impossible. What the
    refusals ARE is pinned in services/boq_bcs/test_sources.py."""

    # A sheet with NO combined amount anywhere: each area carries its supply and install
    # amounts separately, so the row's amount sums across BOTH axes at once.
    _SPLIT_ROLE_MAP = {
        "A": {"role": "description", "area": None},
        "D": {"role": "qty_total", "area": None},
        "E": {"role": "amount_supply_by_area", "area": "Zone A"},
        "F": {"role": "amount_install_by_area", "area": "Zone A"},
        "G": {"role": "amount_supply_by_area", "area": "Zone B"},
        "H": {"role": "amount_install_by_area", "area": "Zone B"},
    }

    # A scalar sheet that splits: no amount_total, just the two scalar halves.
    _SCALAR_SPLIT_ROLE_MAP = {
        "A": {"role": "description", "area": None},
        "D": {"role": "qty_total", "area": None},
        "E": {"role": "amount_supply", "area": None},
        "F": {"role": "amount_install", "area": None},
    }

    def test_a_sheet_with_only_scalar_halves_can_be_confirmed_and_says_which_formula(self):
        _seed_sheet(self.boq, "ScalarSplit BCS ", self.cv,
                    self._SCALAR_SPLIT_ROLE_MAP, [], 11)
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name="ScalarSplit BCS ", committed_version=self.cv,
            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["E", "F"]),
        )
        amt = get_bcs_state(boq_name=self.boq, sheet_name="ScalarSplit BCS ",
                            committed_version=self.cv)["bcs_amount_source"]
        self.assertEqual(amt["mode"], "amount_supply_plus_install")
        self.assertEqual([c["col"] for c in amt["columns"]], ["E", "F"])

    def test_a_split_per_area_sheet_sums_across_both_axes(self):
        """The shape S1a could not express at ALL -- every column on this sheet was
        refused, so it could not enable BCS. Four columns, two areas x two kinds."""
        _seed_sheet(self.boq, "Split BCS ", self.cv, self._SPLIT_ROLE_MAP,
                    ["Zone A", "Zone B"], 12)
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name="Split BCS ", committed_version=self.cv,
            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["E", "F", "G", "H"]),
        )
        amt = get_bcs_state(boq_name=self.boq, sheet_name="Split BCS ",
                            committed_version=self.cv)["bcs_amount_source"]
        self.assertEqual(amt["mode"], "amount_by_area_supply_plus_install")
        self.assertEqual([c["area"] for c in amt["columns"]],
                         ["Zone A", "Zone A", "Zone B", "Zone B"])
        self.assertEqual([c["rate_subkey"] for c in amt["columns"]],
                         ["supply", "install", "supply", "install"])

    def test_a_one_sided_sheet_is_accepted_and_the_stored_mode_discloses_it(self):
        """ADAPT AND DISCLOSE. A sheet with only an installation amount is confirmable,
        and the stored mode is what tells S2c to say so out loud instead of implying a
        whole amount was used."""
        _seed_sheet(self.boq, "OneSided BCS ", self.cv, {
            "A": {"role": "description", "area": None},
            "D": {"role": "qty_total", "area": None},
            "E": {"role": "amount_install", "area": None},
        }, [], 13)
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name="OneSided BCS ", committed_version=self.cv,
            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["E"]),
        )
        amt = get_bcs_state(boq_name=self.boq, sheet_name="OneSided BCS ",
                            committed_version=self.cv)["bcs_amount_source"]
        self.assertEqual(amt["mode"], "amount_install_only")

    def test_a_split_sheet_can_actually_be_costed_end_to_end(self):
        """The end-to-end the strictness blocked: confirm a split sheet, then write a cost
        against it. Confirming without being able to cost would be half a fix."""
        _seed_sheet(self.boq, "SplitCost BCS ", self.cv,
                    self._SCALAR_SPLIT_ROLE_MAP, [], 14)
        set_bcs_enabled(boq_name=self.boq, sheet_name="SplitCost BCS ",
                        committed_version=self.cv, enabled=1)
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name="SplitCost BCS ", committed_version=self.cv,
            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["E", "F"]),
        )
        self.assertTrue(bcs_is_ready(self.boq, "SplitCost BCS ", self.cv))
        res = save_row_bcs_rates(
            boq_name=self.boq, sheet_name="SplitCost BCS ", excel_row=10,
            committed_version=self.cv, supply_rate=60.0, install_rate=15.0,
        )
        self.assertTrue(res["ok"])
        cur = self._current(10, sheet="SplitCost BCS ")
        self.assertEqual(len(cur), 1)
        self.assertEqual(cur[0]["supply_rate"], 60.0)

    def test_a_scalar_total_picked_with_a_scalar_half_is_still_refused(self):
        """The surviving refusal at the endpoint: the combined Amount already contains the
        supply half, so picking both counts it twice. Widening the kind axis must not
        reopen this."""
        _seed_sheet(self.boq, "TotalAndHalf BCS ", self.cv, {
            "A": {"role": "description", "area": None},
            "D": {"role": "qty_total", "area": None},
            "E": {"role": "amount_total", "area": None},
            "F": {"role": "amount_supply", "area": None},
        }, [], 15)
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name="TotalAndHalf BCS ",
                committed_version=self.cv,
                qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["E", "F"]),
            )
        self.assertIsNone(
            get_bcs_state(boq_name=self.boq, sheet_name="TotalAndHalf BCS ",
                          committed_version=self.cv)["bcs_amount_source"],
            "a refused confirmation stores NOTHING",
        )


# ===========================================================================
# Group 3d: the combined_rate input (BCS-S2b)
# ===========================================================================
class TestBcsCombinedRate(_BcsEndpointBase):
    """Not every sheet splits supply from installation -- some quote ONE undifferentiated
    combined rate. That cost needs an honest home, so it gets its own field rather than
    riding in `supply_rate` under a name that lies about what the number is.

    It is accepted EXACTLY as the other two are (owner ruling: not stricter) -- optional,
    defaulting to 0.0 on absent or empty. WHICH input a sheet offers is the SCREEN's
    decision (BCS-S2c / S3); storage deliberately imposes no cross-field rule, so a sheet
    that changes shape never strands a number it already holds."""

    def _ready(self):
        set_bcs_enabled(boq_name=self.boq, sheet_name=self.sheet,
                        committed_version=self.cv, enabled=1)
        confirm_bcs_columns(boq_name=self.boq, sheet_name=self.sheet,
                            committed_version=self.cv,
                            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F"]))

    def test_save_accepts_and_stores_a_combined_rate(self):
        self._ready()
        save_row_bcs_rates(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
            committed_version=self.cv, combined_rate=310.5,
        )
        cur = self._current(10)
        self.assertEqual(len(cur), 1)
        self.assertEqual(cur[0]["combined_rate"], 310.5)

    def test_an_absent_combined_rate_defaults_to_zero_like_the_other_two(self):
        """Absent means 0.0, exactly as supply_rate and install_rate already behave --
        NOT required, NOT an error. Every pre-S2b caller omits it, and must keep working
        unchanged."""
        self._ready()
        save_row_bcs_rates(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
            committed_version=self.cv, supply_rate=5.0, install_rate=2.0,
        )
        cur = self._current(10)
        self.assertEqual(cur[0]["combined_rate"], 0.0)
        self.assertEqual(cur[0]["supply_rate"], 5.0)

    def test_an_empty_string_combined_rate_is_zero_not_an_error(self):
        """The HTTP shape: a cleared input arrives as "". The two halves already coerce it
        to 0.0 and this must not be stricter."""
        self._ready()
        save_row_bcs_rates(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
            committed_version=self.cv, combined_rate="",
        )
        self.assertEqual(self._current(10)[0]["combined_rate"], 0.0)

    def test_a_non_numeric_combined_rate_is_refused_by_name(self):
        """The same named refusal the halves get -- a number field says so, rather than
        failing later as a database error."""
        self._ready()
        with self.assertRaises(frappe.ValidationError):
            save_row_bcs_rates(
                boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                committed_version=self.cv, combined_rate="abc",
            )
        self.assertEqual(self._current(10), [], "a refused BCS write stores nothing")

    def test_the_combined_rate_rides_freeze_and_supersede_like_the_halves(self):
        """It is a stored value on the same record, so it must inherit the lifecycle
        rather than being special-cased: a re-save supersedes and the new current carries
        the new number."""
        self._ready()
        save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                           committed_version=self.cv, combined_rate=100.0)
        save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                           committed_version=self.cv, combined_rate=175.0)
        cur = self._current(10)
        self.assertEqual(len(cur), 1, "exactly one current row, ever")
        self.assertEqual(cur[0]["combined_rate"], 175.0)
        self.assertEqual(cur[0]["bcs_version"], 2)

    def test_the_sheet_read_returns_the_combined_rate(self):
        """A stored value nobody can read back is not stored for any purpose. S3 renders
        from this read, so the field has to be in its explicit field list."""
        self._ready()
        save_row_bcs_rates(boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
                           committed_version=self.cv, combined_rate=42.0)
        rows = get_sheet_bcs_rates(boq_name=self.boq, sheet_name=self.sheet,
                                   committed_version=self.cv)["rows"]
        self.assertEqual(len(rows), 1)
        self.assertIn("combined_rate", rows[0],
                      "get_sheet_bcs_rates must surface combined_rate")
        self.assertEqual(rows[0]["combined_rate"], 42.0)

    def test_all_three_rates_can_coexist_on_one_record(self):
        """Storage imposes no cross-field rule ON PURPOSE. A sheet that switches from a
        combined quote to a split one must not strand the number it already holds, and a
        write path that silently blanked the other field would do exactly that."""
        self._ready()
        save_row_bcs_rates(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
            committed_version=self.cv, supply_rate=10.0, install_rate=3.0,
            combined_rate=13.0,
        )
        cur = self._current(10)[0]
        self.assertEqual((cur["supply_rate"], cur["install_rate"], cur["combined_rate"]),
                         (10.0, 3.0, 13.0))


# ===========================================================================
# Group 4: the readiness gate -- BCS writes ONLY
# ===========================================================================
class TestBcsReadinessGate(_BcsEndpointBase):

    def test_ready_is_exactly_enabled(self):
        """BCS-S12 (owner 2026-08-07): readiness IS enablement.

        ⚠️ THIS TEST REPLACED `test_not_ready_until_both_enabled_and_confirmed`, which asserted
        the OPPOSITE -- that enabling alone was not enough and both columns had to be confirmed
        first. The two column pickers were removed in the same ruling (the quantity and amount a
        sheet measures against are chosen in the BCS Total / % Margin formula dialogs now), and
        the condition had to go WITH them: with no UI writing those confirmations, requiring
        them would leave readiness permanently FALSE, and `save_row_bcs_rates` refuses every
        cost write while it is -- so BCS would switch on and stay silently read-only forever.

        Anyone re-adding the confirmation requirement must re-add the pickers in the same edit."""
        self.assertFalse(bcs_is_ready(self.boq, self.sheet, self.cv))
        set_bcs_enabled(boq_name=self.boq, sheet_name=self.sheet,
                        committed_version=self.cv, enabled=1)
        self.assertTrue(bcs_is_ready(self.boq, self.sheet, self.cv),
                        "enabling is the whole of readiness since BCS-S12")

    def test_ready_without_any_confirmation_at_all(self):
        """The S12 shape end to end: switch BCS on, and a cost write lands -- no confirmation
        step anywhere. This is the regression that would fire if the old condition came back."""
        set_bcs_enabled(boq_name=self.boq, sheet_name=self.sheet,
                        committed_version=self.cv, enabled=1)
        res = save_row_bcs_rates(
            boq_name=self.boq, sheet_name=self.sheet, excel_row=10,
            committed_version=self.cv, supply_rate=10.0, install_rate=2.0,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(len(self._current(10)), 1)

    def test_a_stored_confirmation_does_not_change_readiness(self):
        """Confirmations made BEFORE S12 are still stored and still read as the formula
        defaults' seed -- but they are no longer a GATE. Enabled decides, either way."""
        confirm_bcs_columns(boq_name=self.boq, sheet_name=self.sheet,
                            committed_version=self.cv,
                            qty_cols=json.dumps(["D"]), amount_cols=json.dumps(["F"]))
        self.assertFalse(bcs_is_ready(self.boq, self.sheet, self.cv),
                         "confirmed but disabled is still not ready")
        set_bcs_enabled(boq_name=self.boq, sheet_name=self.sheet,
                        committed_version=self.cv, enabled=1)
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

    # `test_rate_write_refused_while_columns_are_unconfirmed` was DELETED at BCS-S12 -- it
    # asserted the behaviour that ruling removed. Its replacement is
    # `test_ready_without_any_confirmation_at_all` above, which pins the opposite and is the
    # regression guard if the confirmation requirement is ever reinstated without its pickers.
    # `test_rate_write_refused_while_bcs_is_disabled` (above) still covers the surviving gate.

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
        """OWNER-LOCKED: a BCS section that is switched off must leave ordinary client-facing
        pricing fully editable. The BCS readiness predicate must therefore have NO caller
        inside pricing.py -- structurally, not by convention.

        ⚠️ READS THE MODULE THROUGH `ast`, NEVER A SUBSTRING GREP, and that distinction is
        EARNED -- this test was a grep until BCS-S12 and it went red against a COMMENT that
        merely named the BCS doctype while explaining where cost operands come from. A
        presence-side grep fires on the prose warning against the thing, and the only way back
        to green is to delete the explanation. `ast` asks the real questions -- does this module
        IMPORT bcs? does it NAME the predicate? does it address the cost doctype in CODE? -- and
        is blind to comments in both directions. This is the shape the domain doc already
        prescribed for the next such tripwire; it is now this one too.

        ⚠️ NOTE WHAT IS *NOT* ASSERTED, because S9 changed it: pricing.py legitimately knows the
        BCS formula TARGET tokens now (`bcs_total`, `boq_total`, `bcs_margin_cost`) and their
        operand vocabulary. Knowing a target name is not calling the readiness gate. Blanket
        "no BCS strings anywhere" would forbid the formula layer that the owner asked for."""
        import ast
        import inspect

        from nirmaan_stack.api.boq.wizard import pricing

        tree = ast.parse(inspect.getsource(pricing))

        imported: set = set()
        named: set = set()
        code_strings: set = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.add(node.module or "")
                imported.update(f"{node.module}.{a.name}" for a in node.names)
            elif isinstance(node, ast.Name):
                named.add(node.id)
            elif isinstance(node, ast.Attribute):
                named.add(node.attr)
            elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                code_strings.add(node.value)

        self.assertFalse(
            [m for m in imported if m.endswith(".bcs") or m == "bcs"],
            "pricing.py must not import the bcs endpoint module -- the BCS gate guards BCS "
            "cells ONLY and must never reach the client-facing rate gate",
        )
        for fn in ("bcs_is_ready", "_guard_bcs_ready"):
            self.assertNotIn(
                fn, named,
                f"pricing.py must not call {fn!r} -- the BCS readiness gate must never reach "
                f"the client-facing rate gate",
            )
        self.assertNotIn(
            "BoQ Row BCS Rate", code_strings,
            "pricing.py must not address the BCS cost doctype in code (a comment naming it is "
            "fine -- this check is deliberately blind to prose)",
        )


# ===========================================================================
# Group 7 (BCS-S6): BCS costs as the fifth opt-in CARRY layer
# ===========================================================================
class TestBcsCostCarryLayer(FrappeTestCase):
    """The owner's ask, closed: "Carry Rate from original gets a new option to copy the BCS
    Section; precondition: BCS enabled on the destination sheet AND its formulas confirmed."

    `bcs_costs` is registered in `committed_carry.LAYER_KEYS`, so ONE registration lights BOTH
    carry surfaces -- the cross-BoQ revision carry and the within-BoQ copy-forward share
    `walk_layers`. This class drives the WITHIN-BoQ endpoint because it is the cheaper fixture
    (one BoQ, two versions); `test_pricing.TestCopyForwardLayers` owns the NOT-READY half and
    `test_cross_boq_carry` owns the cross-BoQ plan.

    Fixture: sheet "BCS Carry " at v1 (SUPERSEDED, the source) and v2 (CURRENT, the destination),
    both on the scalar role map -- D qty_total, E rate_combined, F amount_total. The destination
    is made BCS-ready THROUGH the live endpoints; v2's amount formula is declared through
    `save_amount_formula`, because the mandatory amount-formula gate is ABSOLUTE on this path and
    a fixture that bypassed it would not be testing the shipped carry.

    Source costs are inserted directly (v1 is superseded, so `save_row_bcs_rates` cannot reach
    it -- readiness resolves the CURRENT sheet row). That mirrors how every other layer seeds its
    source side in `test_pricing.TestCopyForwardLayers._seed_source_layers`.
    """

    SHEET = "BCS Carry "  # VERBATIM trailing space (#152)
    _OLD_RATED_AT = "2020-01-01 00:00:00"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "BCS Carry Layer BoQ"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name

        # v2 CURRENT (destination) first, v1 SUPERSEDED (source) second -- the same order the
        # copy-forward fixtures use, so `is_current` is never briefly true on two versions.
        _seed_sheet(cls.boq, cls.SHEET, 2, _SCALAR_ROLE_MAP, [], 1, is_current=1)
        _seed_sheet(cls.boq, cls.SHEET, 1, _SCALAR_ROLE_MAP, [], 1, is_current=0)
        cls.dest_sheet_v2 = frappe.db.get_value(
            _BOQ_SHEET, {"boq": cls.boq, "sheet_name": cls.SHEET, "commit_version": 2}, "name")
        # The mandatory amount-formula gate is ABSOLUTE on the carry path -- satisfy it through
        # the live endpoint rather than writing the record.
        _declare_scalar_amount_formula(cls.boq, cls.SHEET, 2)
        # One CLIENT rate on the source, so every carry in this class moves a rate AND a cost.
        # That pairing is the point: the two axes ride one transaction, and a test that carried
        # costs with no rate in flight could not see one axis break the other.
        rate = frappe.new_doc(_PRICING)
        rate.boq = cls.boq
        rate.sheet_name = cls.SHEET  # VERBATIM (#152)
        rate.excel_row = 10
        rate.col_letter = "E"
        rate.committed_version = 1
        rate.area = None
        rate.rate_kind = "combined_rate"
        rate.rate = 500.0
        rate.is_filled = 1
        rate.pricing_version = 1
        rate.is_current = 1
        rate.priced_at = frappe.utils.now()
        rate.insert(ignore_permissions=True)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        _cleanup_committed(cls.boq)
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        """Reset to: destination v2 BCS-READY and completely uncosted; source v1 carrying two
        cost rows with a deliberately OLD `bcs_rated_at`."""
        frappe.db.delete(_BCS, {"boq": self.boq})
        frappe.db.delete(_PRICING, {"boq": self.boq, "committed_version": 2})
        frappe.db.delete(_LOCK_DT, {"boq": self.boq})
        set_bcs_enabled(boq_name=self.boq, sheet_name=self.SHEET,
                        committed_version=2, enabled=1)
        confirm_bcs_columns(boq_name=self.boq, sheet_name=self.SHEET, committed_version=2,
                            qty_cols='["D"]', amount_cols='["F"]')
        self._seed_source_costs()
        frappe.db.commit()

    # ── helpers ──────────────────────────────────────────────────────────────────────
    def _seed_source_costs(self):
        """Two cost rows on the SUPERSEDED v1, at the two Line Item Excel addresses (10, 11)."""
        for excel_row, supply, install, combined in ((10, 90.0, 10.0, 0.0),
                                                     (11, 0.0, 0.0, 77.5)):
            d = frappe.new_doc(_BCS)
            d.boq = self.boq
            d.sheet_name = self.SHEET  # VERBATIM (#152)
            d.excel_row = excel_row
            d.committed_version = 1
            d.description = f"cable {'1.1' if excel_row == 10 else '1.2'}"
            d.supply_rate = supply
            d.install_rate = install
            d.combined_rate = combined
            d.is_filled = 1
            d.rate_source = "Manual"
            d.bcs_version = 1
            d.is_current = 1
            d.bcs_rated_at = self._OLD_RATED_AT
            d.insert(ignore_permissions=True)

    @staticmethod
    def _choices(*keys, overwrite=False):
        return {k: {"carry": True, "overwrite": overwrite} for k in keys}

    def _apply(self, layers=None, rows=(10,)):
        kwargs = {
            "boq_name": self.boq, "sheet_name": self.SHEET, "from_version": 1,
            "decisions": json.dumps([
                {"excel_row": r, "area": None, "rate_kind": "combined_rate"} for r in rows]),
        }
        if layers is not None:
            kwargs["layers"] = json.dumps(layers)
        return apply_copy_forward(**kwargs)

    def _dest_costs(self):
        return frappe.get_all(
            _BCS,
            filters={"boq": self.boq, "sheet_name": self.SHEET,
                     "committed_version": 2, "is_current": 1},
            fields=["name", "excel_row", "node", "description", "supply_rate", "install_rate",
                    "combined_rate", "is_filled", "rate_source", "bcs_version", "bcs_rated_at",
                    "carried_from_boq", "carried_from_version", "carried_at"],
            order_by="excel_row asc",
        )

    # ── the carry ────────────────────────────────────────────────────────────────────
    def test_a_ready_destination_takes_the_costs(self):
        res = self._apply(self._choices("bcs_costs"))
        self.assertEqual(res["layers"]["bcs_costs"]["carried"], 2)
        rows = self._dest_costs()
        self.assertEqual([r.excel_row for r in rows], [10, 11])
        self.assertEqual((rows[0].supply_rate, rows[0].install_rate, rows[0].combined_rate),
                         (90.0, 10.0, 0.0))
        self.assertEqual((rows[1].supply_rate, rows[1].install_rate, rows[1].combined_rate),
                         (0.0, 0.0, 77.5))

    def test_all_three_rates_move_independently_and_none_is_derived_from_the_others(self):
        """`combined_rate` is NOT a total of the two halves (owner-locked, BCS-S2b). Row 10 is a
        split-rate row and row 11 a combined-rate row; each must arrive with the OTHER field(s)
        at zero and nothing summed, derived or cross-validated."""
        self._apply(self._choices("bcs_costs"))
        by_row = {r.excel_row: r for r in self._dest_costs()}
        self.assertEqual(by_row[10].combined_rate, 0.0, "a split row gains no combined rate")
        self.assertEqual(by_row[11].supply_rate, 0.0, "a combined row gains no supply half")
        self.assertEqual(by_row[11].install_rate, 0.0)

    def test_every_carried_cost_is_provenance_stamped(self):
        """Amendment E's attribution half, which BCS-S6 inherits. The three fields shipped with
        the doctype at BCS-S1 marked UNUSED; this is what uses them."""
        self._apply(self._choices("bcs_costs"))
        rows = self._dest_costs()
        self.assertTrue(rows, "carried nothing -- the assertions below would be vacuous")
        for r in rows:
            self.assertEqual(r.carried_from_boq, self.boq)
            self.assertEqual(r.carried_from_version, 1)
            self.assertIsNotNone(r.carried_at)

    def test_bcs_rated_at_keeps_the_sources_older_value_and_is_never_restamped(self):
        """⚠️ OWNER-LOCKED, and instructed on the field itself (boq_row_bcs_rate.json): the
        carried record keeps the SOURCE's `bcs_rated_at`, which is therefore OLDER than the carry.
        `carried_at` is the fresh stamp. Mirrors the `human_verdict_at` precedent, where keeping
        the carried timestamp old is what makes a decision taken ON this version outrank an
        inherited one with no precedence code anywhere.

        HONEST CAVEAT recorded at BCS-S6: no live reader tie-breaks on `bcs_rated_at` today, so
        this is forward-looking rather than load-bearing right now. It is still pinned, because
        the cheapest moment to get an age right is before anything depends on it."""
        self._apply(self._choices("bcs_costs"))
        for r in self._dest_costs():
            self.assertEqual(str(r.bcs_rated_at), self._OLD_RATED_AT)
            self.assertNotEqual(str(r.carried_at), self._OLD_RATED_AT)

    def test_the_carried_row_points_at_the_DESTINATION_node_not_the_sources(self):
        """`node` is a PER-VERSION pointer (its own field description says node names change on
        re-commit), so copying the source's would point a v2 cost row at a v1 node. The
        destination's description travels with it, for the same reason the rate carry writes the
        DEST description: the field is a carry-forward MATCH GUARD against the row it sits on."""
        self._apply(self._choices("bcs_costs"))
        for r in self._dest_costs():
            self.assertTrue(r.node, "a carried cost with no node pointer")
            self.assertEqual(
                frappe.db.get_value("BOQ Nodes", r.node, "sheet"), self.dest_sheet_v2,
                "the node pointer must belong to the DESTINATION version's sheet",
            )

    def test_a_fresh_destination_record_starts_at_bcs_version_1(self):
        self._apply(self._choices("bcs_costs"))
        self.assertEqual([r.bcs_version for r in self._dest_costs()], [1, 1])

    def test_rate_source_travels_verbatim(self):
        """Provenance of the NUMBERS (where they came from) is a property of the values and
        survives a copy -- unlike the carry stamp, which is provenance of the RECORD."""
        self._apply(self._choices("bcs_costs"))
        self.assertEqual({r.rate_source for r in self._dest_costs()}, {"Manual"})

    # ── opt-in ───────────────────────────────────────────────────────────────────────
    def test_omitting_layers_carries_rates_only_and_no_cost_lands(self):
        """The backend default is "no layers at all": a client that never learned about
        `bcs_costs` keeps getting exactly the pre-S6 behaviour."""
        res = self._apply()
        self.assertEqual(res["copied"], 1)
        self.assertEqual(res["layers"], {})
        self.assertEqual(self._dest_costs(), [])

    def test_ticking_another_layer_does_not_drag_costs_in(self):
        res = self._apply(self._choices("remarks"))
        self.assertEqual(set(res["layers"]), {"remarks"})
        self.assertEqual(self._dest_costs(), [])

    # ── presence / overwrite ─────────────────────────────────────────────────────────
    def test_an_existing_destination_cost_is_kept_by_default(self):
        """Keep is the default on every layer. A cost typed ON the current version must not be
        superseded by an inherited one just because the user ticked the box."""
        self._apply(self._choices("bcs_costs"))
        first = self._dest_costs()
        res = self._apply(self._choices("bcs_costs"))
        self.assertEqual(res["layers"]["bcs_costs"]["kept"], 2)
        self.assertEqual(res["layers"]["bcs_costs"]["carried"], 0)
        self.assertEqual([r.name for r in self._dest_costs()], [r.name for r in first],
                         "the replay changed nothing -- same records, not new ones")

    def test_overwrite_supersedes_and_leaves_exactly_one_current(self):
        self._apply(self._choices("bcs_costs"))
        res = self._apply(self._choices("bcs_costs", overwrite=True))
        self.assertEqual(res["layers"]["bcs_costs"]["replaced"], 2)
        self.assertEqual(len(self._dest_costs()), 2, "still exactly one current per row")
        self.assertEqual([r.bcs_version for r in self._dest_costs()], [2, 2],
                         "max(prior) + 1, never a hardcoded 1")
        self.assertEqual(
            frappe.db.count(_BCS, {"boq": self.boq, "committed_version": 2, "is_current": 0}), 2,
            "the prior records are FROZEN, never deleted",
        )

    def test_a_source_row_with_no_twin_lands_nothing(self):
        """Row 11's destination node is reworded, so the D6 match cannot pair it. Its cost is
        reported `unmatched` and the sheet keeps a genuinely blank cost cell -- never a value
        landed on a row it was not entered against."""
        node = frappe.db.get_value("BOQ Nodes", {
            "boq": self.boq, "sheet": self.dest_sheet_v2, "source_row_number": 11}, "name")
        frappe.db.set_value("BOQ Nodes", node, "description", "something else entirely",
                            update_modified=False)
        frappe.db.commit()
        try:
            res = self._apply(self._choices("bcs_costs"))
            self.assertEqual(res["layers"]["bcs_costs"]["carried"], 1)
            self.assertEqual(res["layers"]["bcs_costs"]["unmatched"], 1)
            self.assertEqual([r.excel_row for r in self._dest_costs()], [10])
        finally:
            frappe.db.set_value("BOQ Nodes", node, "description", "cable 1.2",
                                update_modified=False)
            frappe.db.commit()

    # ── R4: the write must NOT go through save_row_bcs_rates ─────────────────────────
    def test_a_partial_carry_never_zeroes_a_rate_the_destination_already_held(self):
        """⚠️ THE REASON THE CARRY INSERTS DIRECTLY (BCS-S6 R4). `save_row_bcs_rates` is a
        WHOLE-ROW SNAPSHOT: it coerces every absent rate to 0.0 and writes all three
        unconditionally. Routing the carry through it would mean a source row carrying only a
        combined rate silently ZEROED a supply/install pair the destination already held.

        Here the destination row 11 holds a SPLIT pair; the source row 11 holds a combined rate
        only. With Overwrite armed the carry supersedes it -- and the superseded record must
        still be readable with its original numbers intact, which is what proves nothing was
        blanked in place."""
        d = frappe.new_doc(_BCS)
        d.boq = self.boq
        d.sheet_name = self.SHEET
        d.excel_row = 11
        d.committed_version = 2
        d.supply_rate = 55.0
        d.install_rate = 5.0
        d.combined_rate = 0.0
        d.is_filled = 1
        d.bcs_version = 1
        d.is_current = 1
        d.bcs_rated_at = frappe.utils.now()
        d.insert(ignore_permissions=True)
        frappe.db.commit()

        self._apply(self._choices("bcs_costs", overwrite=True))
        frozen = frappe.get_all(
            _BCS,
            filters={"boq": self.boq, "committed_version": 2, "excel_row": 11, "is_current": 0},
            fields=["supply_rate", "install_rate", "combined_rate"],
        )
        self.assertEqual(len(frozen), 1)
        self.assertEqual((frozen[0].supply_rate, frozen[0].install_rate), (55.0, 5.0),
                         "the superseded record kept its own numbers -- nothing overwrote it")
        current = {r.excel_row: r for r in self._dest_costs()}[11]
        self.assertEqual(current.combined_rate, 77.5, "the carried combined rate landed")

    def test_the_carry_does_not_route_through_the_whole_row_snapshot_writer(self):
        """The structural half of the test above: `committed_carry` must not call
        `save_row_bcs_rates` at all. A future refactor reaching for it "to reuse the write" is
        exactly the mistake the test above measures the cost of.

        ⚠️ Read through `ast`, NOT a substring grep. A plain grep would also match the module's
        own docstring stating the prohibition -- so the tripwire would fire on the very comment
        warning against the thing, and the only way to keep it green would be to DELETE the
        explanation. (Measured: that is exactly what happened when this test was first written
        as `assertNotIn`.) The sibling grep tripwire on `pricing.py` is safe as a substring only
        because `pricing.py` genuinely names none of its tokens in prose either."""
        import ast
        import inspect

        from nirmaan_stack.api.boq.wizard import committed_carry

        tree = ast.parse(inspect.getsource(committed_carry))
        referenced = {
            node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)
        } | {
            node.id for node in ast.walk(tree) if isinstance(node, ast.Name)
        }
        self.assertNotIn(
            "save_row_bcs_rates", referenced,
            "committed_carry must not reach the whole-row snapshot writer -- a partial carry "
            "through it would silently zero rates the destination already held",
        )

    # ── R6: provenance is keyword-REQUIRED, not a runtime None check ─────────────────
    def test_the_cost_writer_cannot_be_called_without_provenance(self):
        """Mirrors `persist.carry_row_categories`: `source_boq` / `source_version` sit after a
        bare `*` and have no defaults, so an unstamped carried record is a TypeError at the call
        site rather than a None discovered in the database later. A stamp a caller MAY omit is a
        stamp that eventually WILL be omitted."""
        from nirmaan_stack.api.boq.wizard import committed_carry

        with self.assertRaises(TypeError):
            committed_carry.carry_bcs_rows(self.boq, self.SHEET, 2, [])
        with self.assertRaises(TypeError):
            committed_carry.carry_bcs_rows(self.boq, self.SHEET, 2, [], source_boq=self.boq)
