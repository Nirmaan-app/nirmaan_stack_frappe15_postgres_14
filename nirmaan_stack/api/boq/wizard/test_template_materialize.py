"""
Unit tests for the BoQ seed-materialize slice (ADR-0013 Amendment A1, A-T2).

Covers set_as_master_template + get_master_template_admin against a programmatically-built
COMMITTED seed BoQ (a project-less `is_template_source` BoQ with committed BoQ Sheets +
surviving BoQ Review Rows):
  - template rows are STRUCTURAL-ONLY (no qty/rate/amount fields on the doctype) and carry
    the structural subset verbatim
  - EFFECTIVE classification/parent folded in via resolve_effective (human override wins)
  - sentinels preserved: parent_index -1 (root / human_is_root fold), attached_to_index 0
    (not attached) vs a positive real target
  - is_excluded=1 seed rows are SKIPPED
  - sheet_config collapsed multi-area -> single-area (one qty_total, no *_by_area, dims [])
  - WP grandchildren + general-specs preamble carried; disposition derived
  - re-run REPLACES the master IN PLACE (same docname, no dupes) and PRESERVES is_active
  - get_master_template_admin returns the master + per-sheet row counts; {} when none
  - role gate rejects a non-Admin/Estimates user

Run via the bench runner (NOT raw unittest -- see CLAUDE.md BoQ test-runner note):
  bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.test_template_materialize
"""
import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.template_materialize import (
    _collapse_to_single_area,
    get_master_template_admin,
    set_as_master_template,
)

_SHEET_A = "Sheet A"
_SHEET_SPECS = "Specs"

# Area-split (multi-area) column_role_map on the committed seed's Sheet A -- materialize
# must land it single-area.
_SHEET_A_ROLE_MAP = {
    "A": {"role": "sl_no"},
    "B": {"role": "description"},
    "C": {"role": "unit"},
    "D": {"role": "make_model"},
    "E": {"role": "qty", "area": "B1"},
    "F": {"role": "qty", "area": "B3"},
    "G": {"role": "rate_combined_by_area", "area": "B1"},
    "H": {"role": "rate_combined_by_area", "area": "B3"},
    "I": {"role": "amount_total_by_area", "area": "B1"},
    "J": {"role": "amount_total_by_area", "area": "B3"},
}
_SHEET_A_AREA_DIMS = ["B1", "B3"]
_GS_PREAMBLE = "General preamble for the specifications sheet."


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------

def _make_work_header():
    name = f"TPLM_WH_{frappe.generate_hash(length=5)}"
    wh = frappe.new_doc("Work Headers")
    wh.work_header_name = name  # autoname field:work_header_name -> docname == name
    wh.insert(ignore_permissions=True)
    frappe.db.commit()
    return name


def _make_committed_boq_sheet(boq, sheet_name, sheet_order, sheet_label, treat_as,
                              role_map, area_dims):
    """A committed (is_current=1) BoQ Sheet with its column snapshot. area_dimensions is a
    LIST-JSON field -> json.dumps; the dict maps are dumped too for uniformity."""
    bs = frappe.new_doc("BoQ Sheet")
    bs.boq = boq
    bs.sheet_name = sheet_name
    bs.sheet_order = sheet_order
    bs.sheet_label = sheet_label
    bs.treat_as = treat_as
    bs.header_row = 1
    bs.header_row_count = 1
    bs.column_role_map = json.dumps(role_map)
    bs.column_headers = json.dumps({})
    bs.area_dimensions = json.dumps(area_dims)
    bs.commit_version = 1
    bs.is_current = 1
    bs.committed_at = frappe.utils.now()
    bs.insert(ignore_permissions=True)
    return bs.name


def _add_wp_grandchild(boq_sheet_name, work_header):
    pkg = frappe.new_doc("BoQ Sheet Work Package")
    pkg.parent = boq_sheet_name
    pkg.parenttype = "BoQ Sheet"
    pkg.parentfield = "work_packages"
    pkg.work_header = work_header
    pkg.insert(ignore_permissions=True)


def _add_review_row(boq, sheet, row_index, classification, parent_index, **kw):
    doc = frappe.new_doc("BoQ Review Row")
    doc.boq = boq
    doc.sheet_name = sheet
    doc.row_index = row_index
    doc.source_row_number = kw.get("source_row_number", row_index + 1)
    doc.classification = classification
    doc.parent_index = parent_index
    doc.human_parent = kw.get("human_parent", -1)
    doc.is_excluded = kw.get("is_excluded", 0)
    for f in (
        "human_classification", "human_is_root",
        "sl_no_value", "description", "unit", "make_model", "is_rate_only",
        "level", "attached_to_index", "path",
        "qty_total", "rate_supply", "rate_combined", "amount_total",
    ):
        if f in kw:
            setattr(doc, f, kw[f])
    if "attached_notes" in kw:  # LIST-JSON -- pre-serialize (a Python list is rejected)
        doc.attached_notes = json.dumps(kw["attached_notes"])
    doc.insert(ignore_permissions=True)
    return doc


def _build_seed():
    """A project-less `is_template_source` committed seed BoQ: a data sheet (area-split
    config, WP, 4 surviving review rows + 1 excluded) + a general-specs sheet."""
    boq = frappe.new_doc("BOQs")
    boq.boq_name = f"TPLM_SEED_{frappe.generate_hash(length=5)}"
    boq.is_template_source = 1  # project-less allowance (boqs.before_insert)
    boq.origin = "upload"
    boq.tax_treatment = "Post-tax"
    # Commitment is represented by BoQ Sheet.is_current=1 (added below), NOT by a BOQs
    # wizard_state value -- the wizard_state Select has no "Committed" option.
    boq.wizard_state = "Parsed"
    boq.append("general_specs_sheets", {
        "source_sheet_name": _SHEET_SPECS,
        "preamble_text": _GS_PREAMBLE,
    })
    boq.insert(ignore_permissions=True)

    # Committed data sheet (area-split) + WP grandchild.
    bs_a = _make_committed_boq_sheet(
        boq.name, _SHEET_A, 1, "HVAC", "data", _SHEET_A_ROLE_MAP, _SHEET_A_AREA_DIMS
    )
    _add_wp_grandchild(bs_a, _WORK_HEADER)

    # Committed general-specs sheet (master_preamble; empty role map).
    _make_committed_boq_sheet(
        boq.name, _SHEET_SPECS, 2, "General Specs", "master_preamble", {}, []
    )

    # Sheet A review rows (survive commit):
    #  0 preamble root
    #  1 line_item under 0 -- populated qty/rate/amount + attached_notes (structure-only clone)
    #  2 note w/ human override -> line_item; attached_to_index=1 (positive real target)
    #  3 preamble whose parser parent is 1 BUT human_is_root=1 -> effective root
    #  4 EXCLUDED (is_excluded=1) -> must be skipped
    _add_review_row(boq.name, _SHEET_A, 0, "preamble", -1, level=1,
                    sl_no_value="1", description="Section One")
    _add_review_row(boq.name, _SHEET_A, 1, "line_item", 0, level=2,
                    sl_no_value="1.1", description="Supply duct", unit="Rmt",
                    make_model="ACME", is_rate_only=0, path="0/1",
                    attached_to_index=0, attached_notes=["carried-note"],
                    qty_total=5.0, rate_combined=120.0, amount_total=600.0)
    _add_review_row(boq.name, _SHEET_A, 2, "note", 0,
                    human_classification="line_item",
                    sl_no_value="1.2", description="Was a note, now an item",
                    unit="Nos", attached_to_index=1)
    _add_review_row(boq.name, _SHEET_A, 3, "preamble", 1, human_is_root=1, level=2,
                    sl_no_value="2", description="Section Two (human root)")
    _add_review_row(boq.name, _SHEET_A, 4, "line_item", -1,
                    description="Excluded row", is_excluded=1)

    frappe.db.commit()
    return boq.name


# Module-level work header (referenced inside _build_seed's WP grandchild).
_WORK_HEADER = None


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSetAsMasterTemplate(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        global _WORK_HEADER
        _WORK_HEADER = _make_work_header()
        cls.work_header = _WORK_HEADER
        cls.seed = _build_seed()

    @classmethod
    def tearDownClass(cls):
        # Masters seeded from this test's seed (raw-delete -- attached_notes/work_packages
        # list-JSON wall forbids delete_doc).
        masters = [
            t.name
            for t in frappe.get_all(
                "BoQ Template", filters={"seeded_from_boq": cls.seed}, fields=["name"]
            )
        ]
        for m in masters:
            frappe.db.delete("BoQ Template Row", {"template": m})
            frappe.db.delete(
                "BoQ Template Sheet", {"parent": m, "parenttype": "BoQ Template"}
            )
        frappe.db.delete("BoQ Template", {"seeded_from_boq": cls.seed})

        bs_names = [
            b.name
            for b in frappe.get_all("BoQ Sheet", filters={"boq": cls.seed}, fields=["name"])
        ]
        if bs_names:
            frappe.db.delete(
                "BoQ Sheet Work Package",
                {"parent": ("in", bs_names), "parenttype": "BoQ Sheet"},
            )
        frappe.db.delete("BoQ Sheet", {"boq": cls.seed})
        frappe.db.delete("BoQ Review Row", {"boq": cls.seed})
        frappe.delete_doc("BOQs", cls.seed, force=True, ignore_permissions=True)
        frappe.delete_doc("Work Headers", cls.work_header, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    # -- helpers -----------------------------------------------------------
    def _materialize(self, template_name=None):
        return set_as_master_template(seed_boq=self.seed, template_name=template_name)

    def _template_rows(self, template, sheet):
        return frappe.get_all(
            "BoQ Template Row",
            filters={"template": template, "sheet_name": sheet},
            fields=[
                "row_index", "classification", "parent_index", "attached_to_index",
                "unit", "make_model", "description", "level", "path", "is_rate_only",
                "attached_notes",
            ],
            order_by="row_index asc",
        )

    def _sheet_from_admin(self, sheet_name):
        admin = get_master_template_admin()
        return next(s for s in admin["sheets"] if s["sheet_name"] == sheet_name)

    # -- tests -------------------------------------------------------------
    def test_materialize_returns_summary(self):
        res = self._materialize()
        self.assertEqual(res["status"], "materialized")
        self.assertTrue(res["template"])
        self.assertEqual(res["sheets"], 2)  # Sheet A + Specs
        self.assertEqual(res["rows"], 4)    # 4 surviving Sheet A rows (excluded skipped)

    def test_effective_classification_and_sentinels(self):
        res = self._materialize()
        rows = self._template_rows(res["template"], _SHEET_A)
        by_idx = {r.row_index: r for r in rows}
        # Only the 4 surviving rows -- the is_excluded=1 row is skipped.
        self.assertEqual(set(by_idx), {0, 1, 2, 3})
        # row 2 was a parser "note" with a human override to "line_item".
        self.assertEqual(by_idx[2].classification, "line_item")
        # parser rows keep their classification.
        self.assertEqual(by_idx[0].classification, "preamble")
        self.assertEqual(by_idx[1].classification, "line_item")
        # parent_index sentinels: root = -1; row 1's parser parent 0 preserved.
        self.assertEqual(by_idx[0].parent_index, -1)
        self.assertEqual(by_idx[1].parent_index, 0)
        # row 3 parser parent was 1 but human_is_root=1 -> effective root -> -1 sentinel.
        self.assertEqual(by_idx[3].parent_index, -1)
        # attached_to_index sentinel: 0 = not attached (rows 0/1), positive = real target (row 2).
        self.assertEqual(by_idx[1].attached_to_index, 0)
        self.assertEqual(by_idx[2].attached_to_index, 1)

    def test_carries_structural_fields(self):
        res = self._materialize()
        by_idx = {r.row_index: r for r in self._template_rows(res["template"], _SHEET_A)}
        r1 = by_idx[1]
        self.assertEqual(r1.unit, "Rmt")
        self.assertEqual(r1.make_model, "ACME")
        self.assertEqual(r1.description, "Supply duct")
        self.assertEqual(r1.level, 2)
        self.assertEqual(r1.path, "0/1")
        # attached_notes JSON carried verbatim (parsed list in v15; tolerate raw string).
        notes = r1.attached_notes
        if isinstance(notes, str):
            notes = json.loads(notes)
        self.assertEqual(notes, ["carried-note"])

    def test_no_qty_rate_amount_on_template_row(self):
        # Structural-only: the BoQ Template Row doctype has NO qty/rate/amount fields, so a
        # strip is definitional. Assert the schema really lacks them (regression tripwire).
        meta_fields = {f.fieldname for f in frappe.get_meta("BoQ Template Row").fields}
        for banned in ("qty_total", "rate_supply", "rate_combined", "amount_total",
                       "qty_by_area", "rate_by_area", "amount_by_area"):
            self.assertNotIn(banned, meta_fields)

    def test_sheet_config_collapsed_single_area(self):
        res = self._materialize()
        cfg = self._sheet_from_admin(_SHEET_A)["sheet_config"]
        self.assertEqual(cfg["area_dimensions"], [])
        role_map = cfg["column_role_map"]
        roles = {col: e.get("role") for col, e in role_map.items()}
        # Exactly one quantity column, re-homed to single-area qty_total (no per-area "qty").
        qty_cols = [c for c, r in roles.items() if r == "qty_total"]
        self.assertEqual(len(qty_cols), 1)
        self.assertNotIn("qty", roles.values())
        # No per-area role survives -- each family is RE-HOMED to its single-area scalar
        # (keeping the sheet priceable), not dropped.
        for r in roles.values():
            self.assertFalse(r and r.endswith("_by_area"), f"per-area role {r} leaked")
        role_counts: dict = {}
        for r in roles.values():
            role_counts[r] = role_counts.get(r, 0) + 1
        # rate_combined_by_area x2 -> exactly one rate_combined; amount_total_by_area x2 ->
        # exactly one amount_total. Priceable surface preserved (a rate cell + amount target).
        self.assertEqual(role_counts.get("rate_combined"), 1)
        self.assertEqual(role_counts.get("amount_total"), 1)
        # Structural roles preserved.
        self.assertEqual(roles.get("A"), "sl_no")
        self.assertEqual(roles.get("B"), "description")
        self.assertEqual(roles.get("C"), "unit")
        self.assertEqual(roles.get("D"), "make_model")

    def test_carries_work_packages(self):
        res = self._materialize()
        sheet_a = self._sheet_from_admin(_SHEET_A)
        self.assertEqual(sheet_a["work_packages"], [self.work_header])
        # Specs sheet had no WP -> [].
        specs = self._sheet_from_admin(_SHEET_SPECS)
        self.assertEqual(specs["work_packages"], [])

    def test_disposition_and_general_specs_preamble(self):
        res = self._materialize()
        sheet_a = self._sheet_from_admin(_SHEET_A)
        specs = self._sheet_from_admin(_SHEET_SPECS)
        self.assertEqual(sheet_a["disposition"], "data")
        self.assertEqual(specs["disposition"], "general_specs")
        self.assertEqual(specs["preamble_text"], _GS_PREAMBLE)
        # general-specs sheet has no review rows -> 0 template rows.
        self.assertEqual(specs["row_count"], 0)
        self.assertEqual(sheet_a["row_count"], 4)

    def test_idempotent_replace_in_place(self):
        first = self._materialize()
        second = self._materialize()
        # Same master docname reused (source_template links on prior clones stay valid).
        self.assertEqual(first["template"], second["template"])
        # No duplicate rows / sheets.
        self.assertEqual(len(self._template_rows(second["template"], _SHEET_A)), 4)
        admin = get_master_template_admin()
        self.assertEqual(len(admin["sheets"]), 2)
        self.assertEqual(
            len(frappe.get_all("BoQ Template", filters={"seeded_from_boq": self.seed})), 1
        )

    def test_is_active_preserved_on_re_materialize(self):
        res = self._materialize()
        # First create lands inactive.
        self.assertEqual(get_master_template_admin()["is_active"], 0)
        # An admin activates the master, then re-seeds -> is_active must survive.
        frappe.db.set_value("BoQ Template", res["template"], "is_active", 1)
        frappe.db.commit()
        self._materialize()
        self.assertEqual(get_master_template_admin()["is_active"], 1)
        # restore for other tests
        frappe.db.set_value("BoQ Template", res["template"], "is_active", 0)
        frappe.db.commit()

    def test_provenance_stamped(self):
        res = self._materialize()
        admin = get_master_template_admin()
        self.assertEqual(admin["seeded_from_boq"], self.seed)
        self.assertIsNotNone(admin["seeded_at"])
        self.assertEqual(admin["last_updated_by"], frappe.session.user)
        self.assertIsNotNone(admin["last_updated_on"])

    def test_rejects_non_template_source_seed(self):
        # A non-template-source BoQ cannot seed the master.
        other = frappe.new_doc("BOQs")
        other.boq_name = f"TPLM_NOTSRC_{frappe.generate_hash(length=5)}"
        other.is_template_source = 1  # allow the project-less insert, then flip off
        other.origin = "upload"
        other.insert(ignore_permissions=True)
        frappe.db.set_value("BOQs", other.name, "is_template_source", 0)
        frappe.db.commit()
        try:
            with self.assertRaises(frappe.ValidationError):
                set_as_master_template(seed_boq=other.name)
        finally:
            frappe.db.delete("BoQ Review Row", {"boq": other.name})
            frappe.delete_doc("BOQs", other.name, force=True, ignore_permissions=True)
            frappe.db.commit()

    def test_rejects_uncommitted_seed(self):
        # A template-source BoQ with NO committed BoQ Sheet cannot be materialized.
        other = frappe.new_doc("BOQs")
        other.boq_name = f"TPLM_UNCOMMIT_{frappe.generate_hash(length=5)}"
        other.is_template_source = 1
        other.origin = "upload"
        other.insert(ignore_permissions=True)
        frappe.db.commit()
        try:
            with self.assertRaises(frappe.ValidationError):
                set_as_master_template(seed_boq=other.name)
        finally:
            frappe.delete_doc("BOQs", other.name, force=True, ignore_permissions=True)
            frappe.db.commit()

    def test_rejects_unknown_seed(self):
        with self.assertRaises(frappe.ValidationError):
            set_as_master_template(seed_boq="BOQ-99-99999")

    def test_role_gate_rejects_non_admin_estimates(self):
        original = frappe.session.user
        try:
            frappe.set_user("Guest")  # no Nirmaan Users row -> role_profile None
            with self.assertRaises(frappe.PermissionError):
                set_as_master_template(seed_boq=self.seed)
            with self.assertRaises(frappe.PermissionError):
                get_master_template_admin()
        finally:
            frappe.set_user(original)


class TestCollapsePure(FrappeTestCase):
    """Pure-unit coverage of the multi-area -> single-area collapse (no DB)."""

    def test_collapse_rehomes_per_area_to_scalar(self):
        cfg = {
            "header_row": 1,
            "area_dimensions": ["B1", "B3"],
            "column_role_map": dict(_SHEET_A_ROLE_MAP),
        }
        out = _collapse_to_single_area(cfg)
        self.assertEqual(out["area_dimensions"], [])
        roles = [e.get("role") for e in out["column_role_map"].values()]
        # Each per-area family re-homes to exactly ONE single-area scalar (keep-first-drop-rest);
        # dropping instead would leave a purely area-split sheet with no rate cell -> unpriceable.
        self.assertEqual(roles.count("qty_total"), 1)
        self.assertEqual(roles.count("rate_combined"), 1)   # from rate_combined_by_area (G, H)
        self.assertEqual(roles.count("amount_total"), 1)    # from amount_total_by_area (I, J)
        self.assertNotIn("qty", roles)
        self.assertFalse(any(r.endswith("_by_area") for r in roles))

    def test_collapse_prefers_existing_qty_total(self):
        cfg = {
            "area_dimensions": ["B1"],
            "column_role_map": {
                "A": {"role": "description"},
                "K": {"role": "qty_total"},
                "E": {"role": "qty", "area": "B1"},
            },
        }
        out = _collapse_to_single_area(cfg)
        role_map = out["column_role_map"]
        # The existing qty_total wins; the per-area qty column is dropped (not re-homed).
        self.assertEqual(role_map.get("K", {}).get("role"), "qty_total")
        self.assertNotIn("E", role_map)
        qty_total_cols = [c for c, e in role_map.items() if e.get("role") == "qty_total"]
        self.assertEqual(qty_total_cols, ["K"])

    def test_get_master_template_admin_empty_when_none(self):
        # No master exists in this pristine class -> {}.
        # (Defensive: clear any stray master first so the assertion is order-independent.)
        for m in frappe.get_all("BoQ Template", fields=["name"]):
            frappe.db.delete("BoQ Template Row", {"template": m.name})
            frappe.db.delete(
                "BoQ Template Sheet", {"parent": m.name, "parenttype": "BoQ Template"}
            )
        frappe.db.delete("BoQ Template", {})
        frappe.db.commit()
        self.assertEqual(get_master_template_admin(), {})
