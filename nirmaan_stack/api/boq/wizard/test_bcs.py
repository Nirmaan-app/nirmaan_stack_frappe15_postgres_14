# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for the BCS (cost & margin) foundation -- slice BCS-S1.

BCS is the COST side of a committed BoQ row: two hand-typed rates (Supply + Install)
representing what the work costs US, sitting against the BoQ amount we charge the CLIENT.
S1 is STORAGE + ENDPOINTS only -- nothing renders, and Total Amount / % Profit are NEVER
stored (they are always computed downstream from the two rates + the confirmed quantity
and amount columns).

Coverage:
  Group 1  doctype identity -- per-ROW (no col_letter), sheet_name VERBATIM (#152).
  Group 2  freeze-and-supersede -- a re-save supersedes; exactly ONE current row, ever.
  Group 3  enable / disable + the confirmation of the two columns, validated against the
           sheet's REAL column_descriptors (a column the sheet does not have is REFUSED
           and NOTHING is stored).
  Group 4  the readiness gate -- a rate write is refused while BCS is disabled or the
           columns are unconfirmed.
  Group 5  the single-editor pricing lock -- a lock rejection mutates NOTHING.

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
from nirmaan_stack.api.boq.wizard.pricing_lock import (
    _LOCK_HELD_MARKER,
    _lock_identity,
    acquire_or_refresh,
)
from nirmaan_stack.api.boq.wizard.test_review_screen import (
    _cleanup_project,
    _make_project,
)

_BCS = "BoQ Row BCS Rate"
_BOQ_SHEET = "BoQ Sheet"
_LOCK_DT = "BoQ Sheet Pricing Lock"

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
        cls.fixture = _seed_sheet(cls.boq, cls.sheet, cls.cv, _SCALAR_ROLE_MAP, [], 1)
        cls.area_fixture = _seed_sheet(
            cls.boq, cls.area_sheet, cls.cv, _AREA_ROLE_MAP, ["Zone A", "Zone B"], 2
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
        for sheet_row in (self.fixture["bqsh"], self.area_fixture["bqsh"]):
            frappe.db.set_value(
                _BOQ_SHEET, sheet_row,
                {"bcs_enabled": 0, "bcs_qty_source": None, "bcs_amount_source": None,
                 "bcs_confirmed_by": None, "bcs_confirmed_at": None},
                update_modified=False,
            )
        frappe.db.commit()

    # -- helpers -----------------------------------------------------------
    def _make_ready(self, sheet=None, qty_cols=None, amount_col="F"):
        """Drive the sheet THROUGH the real endpoints to a ready state (never by a raw
        set_value) -- so setup exercises the same gate production does."""
        sheet = sheet or self.sheet
        set_bcs_enabled(boq_name=self.boq, sheet_name=sheet,
                        committed_version=self.cv, enabled=1)
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name=sheet, committed_version=self.cv,
            qty_cols=json.dumps(qty_cols or ["D"]), amount_col=amount_col,
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
            qty_cols=json.dumps(["D"]), amount_col="F",
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
            qty_cols=json.dumps(["D", "E"]), amount_col="H",
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
            qty_cols=json.dumps(["D"]), amount_col="F",
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
                qty_cols=json.dumps(["Z"]), amount_col="F",   # Z is not mapped
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
                qty_cols=json.dumps(["D"]), amount_col="Z",
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
                qty_cols=json.dumps(["C"]), amount_col="F",
            )
        # ... and the amount pick must be the combined amount, not the rate column.
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv,
                qty_cols=json.dumps(["D"]), amount_col="E",   # E is rate_combined
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
                qty_cols=json.dumps(["D", "E"]), amount_col="F",
            )

    def test_empty_qty_selection_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            confirm_bcs_columns(
                boq_name=self.boq, sheet_name=self.sheet, committed_version=self.cv,
                qty_cols=json.dumps([]), amount_col="F",
            )


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
                            qty_cols=json.dumps(["D"]), amount_col="F")
        self.assertTrue(bcs_is_ready(self.boq, self.sheet, self.cv))

    def test_confirmed_but_disabled_is_not_ready(self):
        confirm_bcs_columns(boq_name=self.boq, sheet_name=self.sheet,
                            committed_version=self.cv,
                            qty_cols=json.dumps(["D"]), amount_col="F")
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
# Group 6: BCS gates its OWN cells only -- owner-locked
# ===========================================================================
class TestBcsDoesNotGateOrdinaryPricing(_BcsEndpointBase):

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
