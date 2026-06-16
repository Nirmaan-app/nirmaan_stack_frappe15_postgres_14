# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Tests for the Phase 5 Slice 3a commit pipeline (commit_pipeline.py).

Strategy
  The grid write-body (_commit_one_sheet / _write_grid / _write_committed_boq_sheet)
  is tested DIRECTLY with synthetic grid_rows + a real BoQ Sheet Draft, so no S3
  fetch / workbook open is needed -- grid_rows is exactly the shape
  sheet_preview._extract_grid_rows produces.  commit_boq's server-side gate re-check
  is tested via its negative path (an ineligible sheet throws BEFORE any file fetch
  or write).  The single-open happy path over a real workbook is exercised by the
  in-container scripted live test on BOQ-26-00145, not here.

  _commit_one_sheet ends with frappe.db.commit(), so committed rows survive
  FrappeTestCase's per-test rollback -- they are cleaned explicitly in tearDown.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import commit_pipeline

_GRID = "BoQ Committed Sheet Grid"
_SHEET = "BoQ Sheet"
# BOQs.before_insert requires a non-empty project; a dummy string + ignore_links
# satisfies it without a real Projects row (mirrors the Slice-1 doctype test).
_TEST_PROJECT = "_TEST_BOQ_PROJECT_COMMIT_PIPELINE"

# A draft sheet_config blob -- the snapshot source pinned onto the committed BoQ Sheet.
_CFG = {
    "header_row": 5,
    "header_row_count": 2,
    "column_role_map": {
        "A": {"role": "sl_no", "area": None},
        "C": {"role": "description", "area": None},
    },
    "column_headers": {"A": "Sl. No", "C": "Description"},
    "area_dimensions": ["Zone A", "Zone B"],
}

# Synthetic faithful grid rows -- one per source classification family, in order.
# The grid is classification-AGNOSTIC (it stores raw cells); "all 6 kept" means the
# write-body drops NO row it is handed.  _extract_grid_rows would already have
# filtered fully-empty padding rows, so every row here carries at least one cell.
_GRID_ROWS = [
    {"row_number": 1, "cells": {"A": "Sl", "B": "Description", "C": "Qty"}},  # header_repeat
    {"row_number": 2, "cells": {"A": 1, "B": "Cement OPC 53", "C": 50}},      # line_item
    {"row_number": 3, "cells": {"B": "Note: rates inclusive of taxes"}},       # note
    {"row_number": 4, "cells": {"A": None, "B": "", "C": None}},               # spacer
    {"row_number": 5, "cells": {"B": "Sub Total", "C": 50000}},                # subtotal_marker
    {"row_number": 6, "cells": {"B": "EARTHWORK"}},                            # preamble
]


class TestCommitPipeline(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT
        boq.boq_name = "Shared Test BoQ for Commit Pipeline"
        # Finalized line-item sheet.
        boq.append("sheet_drafts", {
            "sheet_name": "HVAC", "sheet_order": 1,
            "wizard_status": "Finalized", "sheet_config": json.dumps(_CFG),
        })
        # General-specs designated sheet (pointer membership outranks wizard_status).
        boq.append("sheet_drafts", {
            "sheet_name": "SOW", "sheet_order": 2,
            "wizard_status": "Skip", "sheet_config": json.dumps(_CFG),
        })
        # Finalized sheet whose name carries a trailing space (#152 vehicle).
        boq.append("sheet_drafts", {
            "sheet_name": "Electrical ", "sheet_order": 3,
            "wizard_status": "Finalized", "sheet_config": json.dumps(_CFG),
        })
        # Ineligible (Pending) sheet -- the gate-recheck negative target.
        boq.append("sheet_drafts", {
            "sheet_name": "Pending Sheet", "sheet_order": 4,
            "wizard_status": "Pending",
        })
        # Designate SOW as general-specs via the pointer overlay.
        boq.append("general_specs_sheets", {"source_sheet_name": "SOW"})
        boq.insert(ignore_permissions=True, ignore_links=True)
        cls.boq_name = boq.name
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "boq_name"):
            cls._purge(cls.boq_name)
            frappe.db.delete("BOQs", {"name": cls.boq_name})
            frappe.db.commit()
        super().tearDownClass()

    def tearDown(self):
        # _commit_one_sheet commits, so committed grids/sheets must be cleaned here.
        self._purge(self.boq_name)
        frappe.db.commit()
        super().tearDown()

    @staticmethod
    def _purge(boq_name):
        # RAW deletes: BoQ Sheet.area_dimensions is a list-valued JSON field, which
        # delete_doc's as_json archiving rejects ("cannot be a list"). frappe.db.delete
        # bypasses that; child rows are removed explicitly to avoid orphans.
        for g in frappe.get_all(_GRID, filters={"boq": boq_name}, pluck="name"):
            frappe.db.delete("BoQ Committed Sheet Grid Row", {"parent": g})
        frappe.db.delete(_GRID, {"boq": boq_name})
        for s in frappe.get_all(_SHEET, filters={"boq": boq_name}, pluck="name"):
            frappe.db.delete("BoQ Sheet Work Package", {"parent": s})
        frappe.db.delete(_SHEET, {"boq": boq_name})

    @staticmethod
    def _pj(value):
        """Frappe parses JSON fields to Python objects on load; tolerate either form."""
        return frappe.parse_json(value) if isinstance(value, str) else value

    # ----- helpers ------------------------------------------------------ #

    def _draft(self, sheet_name):
        boq = frappe.get_doc("BOQs", self.boq_name)
        for d in boq.sheet_drafts:
            if d.sheet_name == sheet_name:
                return d
        raise AssertionError(f"draft {sheet_name!r} not found")

    def _commit(self, sheet_name, disposition, grid_rows=None):
        return commit_pipeline._commit_one_sheet(
            self.boq_name, sheet_name, disposition,
            grid_rows if grid_rows is not None else _GRID_ROWS,
            self._draft(sheet_name),
        )

    def _current_grids(self, sheet_name):
        return frappe.get_all(
            _GRID,
            filters={"boq": self.boq_name, "source_sheet_name": sheet_name,
                     "is_current": 1},
            pluck="name",
        )

    # ----- T1. faithful grid round-trip (all rows kept, in order) ------- #

    def test_grid_round_trip_all_rows_kept_in_order(self):
        res = self._commit("HVAC", "finalized")
        self.assertEqual(res["row_count"], 6)

        grid = frappe.get_doc(_GRID, res["grid_name"])
        self.assertEqual(len(grid.rows), 6, "no row may be dropped from the grid")

        ordered = sorted(grid.rows, key=lambda r: r.row_order)
        self.assertEqual([r.row_number for r in ordered], [1, 2, 3, 4, 5, 6])
        self.assertEqual([r.row_order for r in ordered], [0, 1, 2, 3, 4, 5])
        # cells round-trip faithfully, keyed by column letter
        self.assertEqual(ordered[1].cells, {"A": 1, "B": "Cement OPC 53", "C": 50})
        self.assertEqual(ordered[2].cells, {"B": "Note: rates inclusive of taxes"})
        self.assertEqual(ordered[5].cells, {"B": "EARTHWORK"})

    # ----- T2. column-config snapshot, BOTH dispositions ---------------- #

    def test_snapshot_on_finalized_sheet(self):
        res = self._commit("HVAC", "finalized")
        bs = frappe.get_doc(_SHEET, res["boq_sheet_name"])
        self.assertEqual(bs.treat_as, "data")
        self.assertEqual(bs.header_row, 5)
        self.assertEqual(bs.header_row_count, 2)
        self.assertEqual(self._pj(bs.column_role_map), _CFG["column_role_map"])
        self.assertEqual(self._pj(bs.column_headers), _CFG["column_headers"])
        self.assertEqual(self._pj(bs.area_dimensions), _CFG["area_dimensions"])

    def test_snapshot_on_grid_only_general_specs_sheet(self):
        # The case the node path never created before: a grid-only sheet still gets
        # a committed BoQ Sheet WITH the snapshot.
        res = self._commit("SOW", "general_specs")
        self.assertTrue(res["boq_sheet_name"])
        bs = frappe.get_doc(_SHEET, res["boq_sheet_name"])
        self.assertEqual(bs.treat_as, "master_preamble")
        self.assertEqual(self._pj(bs.area_dimensions), _CFG["area_dimensions"])
        self.assertEqual(self._pj(bs.column_role_map), _CFG["column_role_map"])

    # ----- T3. discriminator mapping ------------------------------------ #

    def test_discriminator_mapping(self):
        fin = self._commit("HVAC", "finalized")
        self.assertEqual(fin["sheet_disposition"], "grid_and_nodes")
        self.assertEqual(
            frappe.db.get_value(_GRID, fin["grid_name"], "sheet_disposition"),
            "grid_and_nodes")

        gs = self._commit("SOW", "general_specs")
        self.assertEqual(gs["sheet_disposition"], "grid_only")
        self.assertEqual(
            frappe.db.get_value(_GRID, gs["grid_name"], "sheet_disposition"),
            "grid_only")

    # ----- T4. versioning + freeze (exactly one current) ---------------- #

    def test_versioning_and_freeze(self):
        first = self._commit("HVAC", "finalized")
        self.assertEqual(first["commit_version"], 1)
        self.assertFalse(first["froze_prior"])
        self.assertEqual(
            frappe.db.get_value(_GRID, first["grid_name"], "is_current"), 1)

        second = self._commit("HVAC", "finalized")
        self.assertEqual(second["commit_version"], 2)
        self.assertTrue(second["froze_prior"])
        # prior version frozen
        self.assertEqual(
            frappe.db.get_value(_GRID, first["grid_name"], "is_current"), 0)
        self.assertEqual(
            frappe.db.get_value(_GRID, second["grid_name"], "is_current"), 1)
        # exactly one current grid for the sheet
        self.assertEqual(self._current_grids("HVAC"), [second["grid_name"]])

    def test_committed_at_is_set(self):
        res = self._commit("HVAC", "finalized")
        self.assertTrue(frappe.db.get_value(_GRID, res["grid_name"], "committed_at"))

    # ----- T5. gate re-check (negative) --------------------------------- #

    def test_commit_boq_rejects_ineligible_sheet(self):
        with self.assertRaises(frappe.ValidationError):
            commit_pipeline.commit_boq(self.boq_name, ["Pending Sheet"])
        # nothing written for the ineligible sheet
        self.assertEqual(
            frappe.get_all(_GRID, filters={"boq": self.boq_name,
                                           "source_sheet_name": "Pending Sheet"}),
            [])

    def test_commit_boq_rejects_unknown_sheet(self):
        with self.assertRaises(frappe.ValidationError):
            commit_pipeline.commit_boq(self.boq_name, ["No Such Sheet"])

    def test_commit_boq_requires_subset(self):
        with self.assertRaises(frappe.ValidationError):
            commit_pipeline.commit_boq(self.boq_name, [])

    # ----- T6. verbatim trailing-space identity (#152) ------------------ #

    def test_trailing_space_name_matched_verbatim_on_recommit(self):
        name = "Electrical "  # trailing space is intentional (#152)
        first = self._commit(name, "finalized")
        second = self._commit(name, "finalized")

        # verbatim re-commit found the prior version and froze it -> v2, one current
        self.assertEqual(second["commit_version"], 2)
        self.assertTrue(second["froze_prior"])
        current = self._current_grids(name)
        self.assertEqual(current, [second["grid_name"]],
                         "a trimmed lookup would leave TWO current grids; verbatim "
                         "match must leave exactly one")
        # the stored name kept its trailing space
        self.assertTrue(
            frappe.db.get_value(_GRID, second["grid_name"],
                                "source_sheet_name").endswith(" "))
        # the trimmed name has no grids at all (proves no trimming happened)
        self.assertEqual(
            frappe.get_all(_GRID, filters={"boq": self.boq_name,
                                           "source_sheet_name": "Electrical"}),
            [])

    # ----- T7. one committed BoQ Sheet per sheet across re-commit ------- #

    def test_one_committed_boq_sheet_per_sheet_after_recommit(self):
        self._commit("HVAC", "finalized")
        self._commit("HVAC", "finalized")
        sheets = frappe.get_all(_SHEET, filters={"boq": self.boq_name,
                                                 "sheet_name": "HVAC"})
        self.assertEqual(len(sheets), 1,
                         "re-commit must replace, not duplicate, the committed BoQ Sheet")
