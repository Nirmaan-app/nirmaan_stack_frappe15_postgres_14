"""S4 (#1101, ADR-0014 D5) -- config column-diff CARRY (seeding integration).

The pure disposition logic is pinned in `services/boq_revision/test_column_diff.py`. These
tests exercise the WIRING in `confirm_revision_mapping`: a mapped DATA sheet is seeded with
the original's rectified `column_role_map` and lands `Config Done` when the revised columns
are structurally clean vs the committed grid, else `Pending`. Both the workbook tab read
(`_read_revised_tab_names`) and the workbook column read (`_read_revised_columns`) are
stubbed so the revised structure is deterministic.

Cases: clean -> Config Done + seed; shift/append/removed-mapped -> Pending + seed (map kept,
"flag never auto-clear"); removed-unmapped / blank-header -> still clean; New sheet + gs +
no-committed-BoQ-Sheet -> Pending, no config; workbook read failure + no-header-baseline ->
Pending WHILE still carrying the map (the safe degrade).
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.revision import confirm_revision_mapping
from nirmaan_stack.api.boq.wizard.test_revision_entry import (
    _cleanup_project,
    _make_boq,
    _make_project,
    _make_xlsx_tempfile,
)
from nirmaan_stack.api.boq.wizard.test_revision_mapping import (
    _commit_gs_sheet,
    _make_revision,
)

_READ_TABS = "nirmaan_stack.api.boq.wizard.revision._read_revised_tab_names"
_READ_COLS = "nirmaan_stack.api.boq.wizard.revision_carry._read_revised_columns"

# A small original DATA sheet: A=S.No (UNMAPPED clean label), B..F mapped.
_ROLE_MAP = {
    "B": {"role": "description", "area": None},
    "C": {"role": "unit", "area": None},
    "D": {"role": "qty", "area": None},
    "E": {"role": "rate_combined", "area": None},
    "F": {"role": "amount_total", "area": None},
}
_HEADER = {"A": "S.No", "B": "Description", "C": "Unit", "D": "Qty", "E": "Rate", "F": "Amount"}
_UNIVERSE = set("ABCDEF")


def _commit_data_sheet(
    boq, sheet, role_map=_ROLE_MAP, header_cells=_HEADER,
    header_row=1, header_row_count=1, column_headers=None, area_dimensions=None,
    with_header_row=True, version=1,
):
    """Commit a DATA sheet: a current grid (+ header grid row) AND a current BoQ Sheet.

    `with_header_row=False` mimics a template-origin original whose committed grid was
    inverted from the role map and carries NO header row (no D5 text baseline).
    """
    grid = frappe.new_doc("BoQ Committed Sheet Grid")
    grid.boq = boq
    grid.source_sheet_name = sheet
    grid.sheet_disposition = "grid_and_nodes"
    grid.commit_version = version
    grid.is_current = 1
    grid.committed_at = frappe.utils.now()
    if with_header_row:
        grid.append("rows", {"row_number": header_row, "row_order": 0, "cells": dict(header_cells)})
    grid.insert(ignore_permissions=True)

    bs = frappe.new_doc("BoQ Sheet")
    bs.boq = boq
    bs.sheet_name = sheet
    bs.sheet_order = 1
    bs.treat_as = "data"
    bs.header_row = header_row
    bs.header_row_count = header_row_count
    bs.column_role_map = frappe.as_json(role_map)
    bs.column_headers = frappe.as_json(column_headers or {})
    bs.area_dimensions = frappe.as_json(area_dimensions or [])
    bs.is_current = 1
    bs.commit_version = version
    bs.committed_at = frappe.utils.now()
    bs.insert(ignore_permissions=True)
    frappe.db.commit()
    return grid, bs


class TestConfigColumnCarry(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        cls.original = _make_boq(cls.project.name, origin="upload", boq_name="ORIG BoQ")
        _commit_data_sheet(cls.original.name, "Data")
        _commit_gs_sheet(cls.original.name, "Make List", version=1)

    @classmethod
    def tearDownClass(cls):
        # Raw delete: BoQ Sheet.area_dimensions is a list-valued JSON field, so delete_doc's
        # as_dict() would trip the "cannot be a list" wall (CLAUDE.md). frappe.db.delete skips
        # the doc load entirely. The grid + BOQs + project are dropped by _cleanup_project.
        for boq in frappe.get_all("BOQs", filters={"project": cls.project.name}, fields=["name"]):
            frappe.db.delete("BoQ Sheet", {"boq": boq.name})
        frappe.db.commit()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def _confirm(self, tabs, mapping, revised_cols=None, cols_side_effect=None):
        rev = _make_revision(self.project.name, self.original.name)
        cols_patch = (
            patch(_READ_COLS, side_effect=cols_side_effect)
            if cols_side_effect is not None
            else patch(_READ_COLS, return_value=revised_cols or {})
        )
        with patch(_READ_TABS, return_value=tabs), cols_patch:
            confirm_revision_mapping(rev.name, mapping)
        doc = frappe.get_doc("BOQs", rev.name)
        return {d.sheet_name: d for d in doc.sheet_drafts}, doc

    def _map_data(self, revised_header, revised_universe, cols_side_effect=None):
        """Confirm a single mapped 'Data' sheet with the given revised columns; return its draft."""
        drafts, _ = self._confirm(
            tabs=["Data"],
            mapping=[{"sheet_name": "Data", "source_sheet_name": "Data"}],
            revised_cols={"Data": {"header_cells": revised_header, "universe": revised_universe}},
            cols_side_effect=cols_side_effect,
        )
        return drafts["Data"]

    # ── clean -> Config Done + rectified seed ────────────────────────────────
    def test_clean_matched_sheet_config_done_with_rectified_seed(self):
        d = self._map_data(dict(_HEADER), set("ABCDEF"))
        self.assertEqual(d.wizard_status, "Config Done")
        cfg = frappe.parse_json(d.sheet_config)
        self.assertEqual(cfg["column_role_map"], _ROLE_MAP)  # rectified map, not auto-guess
        self.assertEqual(cfg["header_row"], 1)
        self.assertNotIn("sheet_name", cfg)  # 6-key shape; parser injects sheet_name

    def test_n2_drift_still_config_done(self):
        drifted = {"A": " s.no ", "B": "DESCRIPTION", "C": "unit",
                   "D": "Qty", "E": "rate", "F": "amount"}
        self.assertEqual(self._map_data(drifted, set("ABCDEF")).wizard_status, "Config Done")

    def test_removed_unmapped_column_still_config_done(self):
        rev = {k: v for k, v in _HEADER.items() if k != "A"}  # unmapped S.No gone
        self.assertEqual(self._map_data(rev, set("BCDEF")).wizard_status, "Config Done")

    def test_blank_header_column_still_config_done(self):
        rev = dict(_HEADER)
        rev["E"] = ""  # blank header, still present in universe
        self.assertEqual(self._map_data(rev, set("ABCDEF")).wizard_status, "Config Done")

    # ── unsafe -> Pending, but the rectified map is STILL seeded ──────────────
    def test_shifted_columns_pending_but_map_carried(self):
        shifted = {"A": "S.No", "B": "Description", "C": "NEW",
                   "D": "Unit", "E": "Qty", "F": "Rate", "G": "Amount"}
        d = self._map_data(shifted, set("ABCDEFG"))
        self.assertEqual(d.wizard_status, "Pending")
        self.assertEqual(frappe.parse_json(d.sheet_config)["column_role_map"], _ROLE_MAP)

    def test_appended_column_pending(self):
        rev = dict(_HEADER)
        rev["G"] = "Remarks"
        self.assertEqual(self._map_data(rev, set("ABCDEFG")).wizard_status, "Pending")

    def test_removed_mapped_column_pending_and_map_not_cleared(self):
        # F (amount) gone from the revised universe -> Pending; the seed KEEPS F (flag, never
        # auto-clear) so the human resolves the dangling role on the config screen.
        rev = {k: v for k, v in _HEADER.items() if k != "F"}
        d = self._map_data(rev, set("ABCDE"))
        self.assertEqual(d.wizard_status, "Pending")
        self.assertIn("F", frappe.parse_json(d.sheet_config)["column_role_map"])

    # ── degrade-to-safe branches ─────────────────────────────────────────────
    def test_no_header_baseline_degrades_to_pending(self):
        # A template-origin original: committed BoQ Sheet exists, but the grid has NO header
        # row -> no D5 text baseline -> cannot certify clean -> Pending (map still carried).
        rev = _make_boq(self.project.name, origin="upload", boq_name="TMPL ORIG")
        _commit_data_sheet(rev.name, "Data", with_header_row=False)
        revision = _make_revision(self.project.name, rev.name)
        with patch(_READ_TABS, return_value=["Data"]), patch(
            _READ_COLS, return_value={"Data": {"header_cells": dict(_HEADER), "universe": set("ABCDEF")}}
        ):
            confirm_revision_mapping(revision.name, [{"sheet_name": "Data", "source_sheet_name": "Data"}])
        d = frappe.get_doc("BOQs", revision.name).sheet_drafts[0]
        self.assertEqual(d.wizard_status, "Pending")
        self.assertEqual(frappe.parse_json(d.sheet_config)["column_role_map"], _ROLE_MAP)

    def test_workbook_read_failure_pending_with_seed(self):
        d = self._map_data(None, None, cols_side_effect=RuntimeError("boom"))
        self.assertEqual(d.wizard_status, "Pending")
        self.assertEqual(frappe.parse_json(d.sheet_config)["column_role_map"], _ROLE_MAP)

    # ── dispositions diagnostics returned (D5 flag + warning surfacing) ──────
    def _confirm_response(self, tabs, mapping, revised_cols):
        rev = _make_revision(self.project.name, self.original.name)
        with patch(_READ_TABS, return_value=tabs), patch(_READ_COLS, return_value=revised_cols):
            return confirm_revision_mapping(rev.name, mapping)

    def test_dispositions_surface_dangling_and_reasons(self):
        # F (amount) removed -> Pending; the response carries the dangling role + reasons so
        # the caller can surface the flag (the data is NOT thrown away).
        revised = {"Data": {"header_cells": {k: v for k, v in _HEADER.items() if k != "F"},
                            "universe": set("ABCDE")}}
        res = self._confirm_response(
            ["Data"], [{"sheet_name": "Data", "source_sheet_name": "Data"}], revised
        )
        disp = {d["sheet_name"]: d for d in res["dispositions"]}
        self.assertEqual(disp["Data"]["status"], "Pending")
        self.assertEqual(disp["Data"]["dangling_roles"], ["F"])
        self.assertTrue(disp["Data"]["reasons"])

    def test_dispositions_clean_sheet_no_flags(self):
        revised = {"Data": {"header_cells": dict(_HEADER), "universe": set("ABCDEF")}}
        res = self._confirm_response(
            ["Data"], [{"sheet_name": "Data", "source_sheet_name": "Data"}], revised
        )
        disp = {d["sheet_name"]: d for d in res["dispositions"]}
        self.assertEqual(disp["Data"]["status"], "Config Done")
        self.assertEqual(disp["Data"]["dangling_roles"], [])
        self.assertFalse(disp["Data"]["description_set_changed"])

    def test_dispositions_description_warning_surfaced(self):
        revised_header = dict(_HEADER)
        revised_header["B"] = "Item Particulars"  # description header changed
        revised = {"Data": {"header_cells": revised_header, "universe": set("ABCDEF")}}
        res = self._confirm_response(
            ["Data"], [{"sheet_name": "Data", "source_sheet_name": "Data"}], revised
        )
        disp = {d["sheet_name"]: d for d in res["dispositions"]}
        self.assertTrue(disp["Data"]["description_set_changed"])

    def test_dispositions_excludes_new_and_general_specs(self):
        # Only mapped DATA sheets appear in dispositions; a New sheet + a gs sheet do not.
        revised = {"Data": {"header_cells": dict(_HEADER), "universe": set("ABCDEF")}}
        res = self._confirm_response(
            ["Data", "Fresh", "Make List"],
            [
                {"sheet_name": "Data", "source_sheet_name": "Data"},
                {"sheet_name": "Fresh", "source_sheet_name": None, "declared_new": True},
                {"sheet_name": "Make List", "source_sheet_name": "Make List", "general_specs": True},
            ],
            revised,
        )
        self.assertEqual([d["sheet_name"] for d in res["dispositions"]], ["Data"])

    # ── no data config to carry -> unchanged S3 behaviour (Pending, no config) ─
    def test_new_sheet_pending_no_config(self):
        drafts, _ = self._confirm(
            tabs=["Data", "Fresh"],
            mapping=[
                {"sheet_name": "Data", "source_sheet_name": "Data"},
                {"sheet_name": "Fresh", "source_sheet_name": None, "declared_new": True},
            ],
            revised_cols={"Data": {"header_cells": dict(_HEADER), "universe": set("ABCDEF")}},
        )
        self.assertEqual(drafts["Fresh"].wizard_status, "Pending")
        self.assertIn(drafts["Fresh"].sheet_config or "", ("", "null", None))

    def test_general_specs_sheet_no_data_config(self):
        drafts, doc = self._confirm(
            tabs=["Make List"],
            mapping=[{"sheet_name": "Make List", "source_sheet_name": "Make List", "general_specs": True}],
        )
        self.assertEqual(drafts["Make List"].wizard_status, "Pending")
        self.assertIn(drafts["Make List"].sheet_config or "", ("", "null", None))
        self.assertEqual([g.source_sheet_name for g in doc.general_specs_sheets], ["Make List"])

    # ── REAL workbook read (no stub on the column read) ──────────────────────
    def test_real_workbook_read_clean_config_done(self):
        # End-to-end over the REAL openpyxl read: the fixture 'Sheet1' header is
        # Sl.No. | Description | Unit | Qty | Rate | Amount | Formula (test) (cols A..G, G
        # header-only/blank data). A committed sheet whose config matches -> Config Done.
        fixture_header = {
            "A": "Sl.No.", "B": "Description", "C": "Unit", "D": "Qty",
            "E": "Rate", "F": "Amount", "G": "Formula (test)",
        }
        fixture_role_map = {
            "B": {"role": "description", "area": None},
            "C": {"role": "unit", "area": None},
            "D": {"role": "qty", "area": None},
            "E": {"role": "rate_combined", "area": None},
            "F": {"role": "amount_total", "area": None},
        }
        orig = _make_boq(self.project.name, origin="upload", boq_name="REAL ORIG")
        _commit_data_sheet(orig.name, "Sheet1", role_map=fixture_role_map, header_cells=fixture_header)
        rev = _make_revision(self.project.name, orig.name)
        # Both the tab-name read and the column read hit the real fixture via the tempfile stub.
        with patch(
            "nirmaan_stack.api.boq.wizard.sheet_preview._fetch_boq_file_to_tempfile",
            side_effect=lambda url: _make_xlsx_tempfile(),
        ):
            confirm_revision_mapping(
                rev.name, [{"sheet_name": "Sheet1", "source_sheet_name": "Sheet1"}]
            )
        d = frappe.get_doc("BOQs", rev.name).sheet_drafts[0]
        self.assertEqual(d.wizard_status, "Config Done")
        self.assertEqual(frappe.parse_json(d.sheet_config)["column_role_map"], fixture_role_map)

    def test_mapped_grid_only_sheet_without_boq_sheet_stays_pending(self):
        # 'Make List' has a grid row but no BoQ Sheet -> no carryable data config (S3 behaviour).
        drafts, _ = self._confirm(
            tabs=["Make List"],
            mapping=[{"sheet_name": "Make List", "source_sheet_name": "Make List", "general_specs": False}],
        )
        self.assertEqual(drafts["Make List"].wizard_status, "Pending")
        self.assertIn(drafts["Make List"].sheet_config or "", ("", "null", None))
