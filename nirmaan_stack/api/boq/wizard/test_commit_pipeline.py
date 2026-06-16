# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Tests for the Phase 5 Slice 3a/3b commit pipeline (commit_pipeline.py).

Strategy
  The grid/sheet write-body (_commit_one_sheet / _write_grid /
  _write_committed_boq_sheet) is tested DIRECTLY with synthetic grid_rows + a real
  BoQ Sheet Draft.  The NODE tree (3b) is tested by SEEDING BoQ Review Rows for a
  finalized sheet then committing -- no S3 fetch / workbook open is needed.
  commit_boq's server-side gate re-check is tested via its negative path (an
  ineligible sheet throws BEFORE any file fetch or write).  The single-open happy
  path over a real workbook is exercised by the in-container scripted live test on
  BOQ-26-00145 (flat) + BOQ-26-00166 VRF System (nested), not here.

  _commit_one_sheet ends with frappe.db.commit(), so committed rows survive
  FrappeTestCase's per-test rollback -- they are cleaned explicitly in tearDown.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import commit_pipeline

_GRID = "BoQ Committed Sheet Grid"
_SHEET = "BoQ Sheet"
_NODE = "BOQ Nodes"
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
        for n in frappe.get_all(_NODE, filters={"boq": boq_name}, pluck="name"):
            frappe.db.delete("BOQ Node Qty By Area", {"parent": n})
        frappe.db.delete(_NODE, {"boq": boq_name})
        for g in frappe.get_all(_GRID, filters={"boq": boq_name}, pluck="name"):
            frappe.db.delete("BoQ Committed Sheet Grid Row", {"parent": g})
        frappe.db.delete(_GRID, {"boq": boq_name})
        for s in frappe.get_all(_SHEET, filters={"boq": boq_name}, pluck="name"):
            frappe.db.delete("BoQ Sheet Work Package", {"parent": s})
        frappe.db.delete(_SHEET, {"boq": boq_name})
        frappe.db.delete("BoQ Review Row", {"boq": boq_name})

    @staticmethod
    def _pj(value):
        """Frappe parses JSON fields to Python objects on load; tolerate either form."""
        return frappe.parse_json(value) if isinstance(value, str) else value

    # ----- helpers ------------------------------------------------------ #

    def _seed_review_row(self, sheet, row_index, classification, **kw):
        """Insert one BoQ Review Row for the node-tree tests. dict-JSON fields
        (qty_by_area / rate_by_area / amount_by_area / append_notes_raw) pass as dicts;
        list-JSON fields (attached_notes / edit_log) are json.dumps'd (Frappe rejects a
        raw list on insert)."""
        doc = frappe.new_doc("BoQ Review Row")
        doc.boq = self.boq_name
        doc.sheet_name = sheet
        doc.row_index = row_index
        doc.source_row_number = kw.get("source_row_number", row_index + 1)
        doc.classification = classification
        doc.parent_index = kw.get("parent_index", -1)
        doc.human_parent = kw.get("human_parent", -1)
        for f in ("level", "preamble_level_override", "description", "sl_no_value",
                  "unit", "make_model", "qty_total", "rate_supply", "rate_install",
                  "rate_combined", "amount_total", "amount_supply", "amount_install",
                  "row_notes", "human_classification", "is_rate_only", "is_synthetic",
                  "human_is_root"):
            if f in kw:
                setattr(doc, f, kw[f])
        for f in ("qty_by_area", "rate_by_area", "amount_by_area", "append_notes_raw"):
            if f in kw:
                setattr(doc, f, kw[f])
        for f in ("attached_notes", "edit_log"):
            if f in kw:
                setattr(doc, f, json.dumps(kw[f]))
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return doc.name

    def _nodes_for_sheet(self, boq_sheet_name, current_only=True):
        filt = {"boq": self.boq_name, "sheet": boq_sheet_name}
        if current_only:
            filt["is_current"] = 1
        return frappe.get_all(_NODE, filters=filt,
                              fields=["name", "node_type", "level", "code", "description",
                                      "parent_node", "qty", "supply_rate", "install_rate",
                                      "combined_rate", "supply_amount", "install_amount",
                                      "total_amount", "is_rate_only", "is_synthetic",
                                      "commit_version", "is_current", "sort_order",
                                      "review_row_name", "commit_provenance_id"],
                              order_by="sort_order asc")

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

    # ----- T7. BoQ Sheet VERSIONED (not deleted) on re-commit (3b fold) -- #

    def test_boq_sheet_versioned_not_deleted_on_recommit(self):
        """Slice 3b fold: re-commit FREEZES the prior BoQ Sheet via set_value (no
        delete). Both versions persist; exactly one is_current."""
        self._commit("HVAC", "finalized")
        self._commit("HVAC", "finalized")
        sheets = frappe.get_all(
            _SHEET, filters={"boq": self.boq_name, "sheet_name": "HVAC"},
            fields=["name", "commit_version", "is_current"])
        self.assertEqual(len(sheets), 2, "prior sheet is frozen, NOT deleted")
        current = [s for s in sheets if s.is_current]
        self.assertEqual(len(current), 1, "exactly one current BoQ Sheet")
        self.assertEqual(current[0].commit_version, 2)
        self.assertEqual(sorted(s.commit_version for s in sheets), [1, 2])

    # ================================================================== #
    # Slice 3b -- node tree                                               #
    # ================================================================== #

    def _seed_node_sheet(self, sheet="HVAC"):
        """A small finalized tree: 1 preamble (root) + 2 line items under it + a NOTE
        and a SPACER (grid-only, must NOT become nodes)."""
        self._seed_review_row(sheet, 0, "preamble", level=1, description="EARTHWORK",
                              sl_no_value="A")
        self._seed_review_row(sheet, 1, "line_item", parent_index=0, description="Excavation",
                              sl_no_value="1", unit="cum", make_model="N/A",
                              qty_total=100.0, rate_supply=50.0, rate_install=20.0,
                              rate_combined=70.0, amount_total=7000.0,
                              amount_supply=5000.0, amount_install=2000.0,
                              is_rate_only=0, is_synthetic=0)
        self._seed_review_row(sheet, 2, "line_item", parent_index=0, description="Backfill",
                              sl_no_value="2", unit="cum", qty_total=0.0,
                              rate_combined=35.0, is_rate_only=1)
        self._seed_review_row(sheet, 3, "note", parent_index=0, description="Site note")
        self._seed_review_row(sheet, 4, "spacer", description="")

    def test_node_tree_built_preamble_and_line_items_only(self):
        """note/spacer/subtotal/header_repeat are grid-only -> NOT nodes; preamble +
        line_items become nodes; the parent tree is wired by the row_index->node map;
        money is preserved verbatim (Float->Currency) and qty stays Float."""
        self._seed_node_sheet("HVAC")
        res = self._commit("HVAC", "finalized")
        self.assertEqual(res["node_count"], 3, "1 preamble + 2 line items (note/spacer skipped)")

        nodes = self._nodes_for_sheet(res["boq_sheet_name"])
        by_code = {n.code: n for n in nodes}
        self.assertEqual(set(by_code), {"A", "1", "2"})

        preamble = by_code["A"]
        self.assertEqual(preamble.node_type, "Preamble")
        self.assertEqual(preamble.level, 1)
        self.assertIsNone(preamble.parent_node)  # root

        li1 = by_code["1"]
        self.assertEqual(li1.node_type, "Line Item")
        self.assertEqual(li1.parent_node, preamble.name)  # wired to the preamble
        # money preserved verbatim (word-order reversal landed)
        self.assertEqual(li1.qty, 100.0)
        self.assertEqual(li1.supply_rate, 50.0)
        self.assertEqual(li1.install_rate, 20.0)
        self.assertEqual(li1.combined_rate, 70.0)
        self.assertEqual(li1.supply_amount, 5000.0)
        self.assertEqual(li1.install_amount, 2000.0)
        self.assertEqual(li1.total_amount, 7000.0)

        li2 = by_code["2"]
        self.assertEqual(li2.parent_node, preamble.name)
        self.assertEqual(li2.is_rate_only, 1)
        self.assertEqual(li2.qty, 0.0)  # rate-only line item

    def test_provenance_and_flags_carried(self):
        """review_row_name + commit_provenance_id set; is_rate_only/is_synthetic carried."""
        rr = self._seed_review_row("HVAC", 0, "line_item", description="Item", sl_no_value="1",
                                   qty_total=1.0, is_rate_only=0, is_synthetic=1)
        res = self._commit("HVAC", "finalized")
        nodes = self._nodes_for_sheet(res["boq_sheet_name"])
        self.assertEqual(len(nodes), 1)
        n = nodes[0]
        self.assertEqual(n.review_row_name, rr)
        self.assertTrue(n.commit_provenance_id)  # minted, non-empty
        self.assertEqual(n.is_synthetic, 1)      # carried verbatim (insurance field)

    def test_human_layer_and_notes_carried_as_provenance(self):
        """human_classification/human_parent/human_is_root + attached_notes + edit_log +
        append_notes_raw + row_notes carried verbatim (provenance-only)."""
        self._seed_review_row(
            "HVAC", 0, "line_item", description="Item", sl_no_value="1", qty_total=1.0,
            human_classification="line_item", human_parent=-1, human_is_root=0,
            row_notes="a row note", append_notes_raw={"Z": "extra"},
            attached_notes=["n1", "n2"], edit_log=[{"field": "qty_total", "from": 1, "to": 2}],
        )
        res = self._commit("HVAC", "finalized")
        nm = self._nodes_for_sheet(res["boq_sheet_name"])[0].name
        node = frappe.get_doc(_NODE, nm)
        self.assertEqual(node.human_classification, "line_item")
        self.assertEqual(node.human_is_root, 0)
        self.assertEqual(node.notes, "a row note")
        self.assertEqual(self._pj(node.append_notes_raw), {"Z": "extra"})
        self.assertEqual(self._pj(node.attached_notes), ["n1", "n2"])
        self.assertEqual(self._pj(node.edit_log), [{"field": "qty_total", "from": 1, "to": 2}])

    def test_per_area_children_nested_preserves_granularity(self):
        """NESTED rate/amount per area -> each kind preserved on its own child column
        (NEVER downgraded). qty flat -> child.qty."""
        self._seed_review_row(
            "HVAC", 0, "line_item", description="VRF", sl_no_value="1", qty_total=1.0,
            qty_by_area={"L1": 1.0, "L2": 0.0},
            rate_by_area={"L1": {"supply_rate": 152400.0, "install_rate": 6000.0,
                                 "combined_rate": 158400.0}},
            amount_by_area={"L1": {"supply": 152400.0, "install": 6000.0, "total": 158400.0}},
        )
        res = self._commit("HVAC", "finalized")
        nm = self._nodes_for_sheet(res["boq_sheet_name"])[0].name
        node = frappe.get_doc(_NODE, nm)
        kids = {k.area_name: k for k in node.qty_by_area}
        self.assertEqual(set(kids), {"L1", "L2"})
        self.assertEqual(kids["L1"].qty, 1.0)
        self.assertEqual(kids["L2"].qty, 0.0)
        # nested rate granularity survives -- each kind on its own column
        self.assertEqual(kids["L1"].supply_rate, 152400.0)
        self.assertEqual(kids["L1"].install_rate, 6000.0)
        self.assertEqual(kids["L1"].combined_rate, 158400.0)
        # nested amount granularity survives
        self.assertEqual(kids["L1"].supply_amount, 152400.0)
        self.assertEqual(kids["L1"].install_amount, 6000.0)
        self.assertEqual(kids["L1"].total_amount, 158400.0)

    def test_per_area_children_flat_maps_to_total_and_combined(self):
        """FLAT bare scalar per area -> amount->total_amount only, rate->combined_rate
        only (deliberate defaults; supply/install left empty, not invented)."""
        self._seed_review_row(
            "HVAC", 0, "line_item", description="Flat", sl_no_value="1", qty_total=1.0,
            qty_by_area={"Phase -1": 220.0},
            amount_by_area={"Phase -1": 5000.0, "Phase -2": 0.0},
        )
        res = self._commit("HVAC", "finalized")
        nm = self._nodes_for_sheet(res["boq_sheet_name"])[0].name
        node = frappe.get_doc(_NODE, nm)
        kids = {k.area_name: k for k in node.qty_by_area}
        self.assertEqual(set(kids), {"Phase -1", "Phase -2"})
        self.assertEqual(kids["Phase -1"].qty, 220.0)
        self.assertEqual(kids["Phase -1"].total_amount, 5000.0)  # flat amount -> total ONLY
        # flat scalar did NOT go to supply/install (Currency defaults to 0.0 when unset --
        # there is no null Currency; 0.0 proves the value was not duplicated there)
        self.assertEqual(kids["Phase -1"].supply_amount, 0.0)
        self.assertEqual(kids["Phase -1"].install_amount, 0.0)

    def test_combined_rate_mismatch_warns_node_commits(self):
        """A line_item whose combined_rate != supply+install now WARNS (not throws) --
        the node still commits with values verbatim."""
        self._seed_review_row("HVAC", 0, "line_item", description="Bad rate", sl_no_value="1",
                              qty_total=1.0, rate_supply=400.0, rate_install=200.0,
                              rate_combined=700.0)
        res = self._commit("HVAC", "finalized")
        self.assertEqual(res["node_count"], 1)
        node = self._nodes_for_sheet(res["boq_sheet_name"])[0]
        self.assertEqual(node.combined_rate, 700.0)  # verbatim, not reconciled

    def test_three_tier_versioning_on_recommit(self):
        """Re-commit: grid + BoQ Sheet + nodes ALL freeze v1 and land v2 under ONE
        shared commit_version; v1 nodes stay attached to frozen sheet v1; exactly one
        current per tier."""
        self._seed_node_sheet("HVAC")
        first = self._commit("HVAC", "finalized")
        v1_sheet = first["boq_sheet_name"]
        v1_nodes = self._nodes_for_sheet(v1_sheet)  # current at this point
        self.assertEqual(first["commit_version"], 1)
        self.assertEqual(len(v1_nodes), 3)

        second = self._commit("HVAC", "finalized")
        v2_sheet = second["boq_sheet_name"]
        self.assertEqual(second["commit_version"], 2)
        self.assertEqual(second["froze_nodes"], 3, "the 3 v1 nodes were frozen")

        # shared version across all three tiers
        self.assertEqual(
            frappe.db.get_value(_GRID, second["grid_name"], "commit_version"), 2)
        self.assertEqual(frappe.db.get_value(_SHEET, v2_sheet, "commit_version"), 2)
        v2_nodes = self._nodes_for_sheet(v2_sheet)
        self.assertEqual(len(v2_nodes), 3)
        self.assertTrue(all(n.commit_version == 2 for n in v2_nodes))

        # v1 nodes frozen + STILL attached to frozen sheet v1 (coherent snapshot)
        v1_all = self._nodes_for_sheet(v1_sheet, current_only=False)
        self.assertEqual(len(v1_all), 3)
        self.assertTrue(all(n.is_current == 0 for n in v1_all))
        self.assertEqual(frappe.db.get_value(_SHEET, v1_sheet, "is_current"), 0)

        # exactly one current per tier
        self.assertEqual(len(self._current_grids("HVAC")), 1)
        self.assertEqual(
            len(commit_pipeline._current_names(_SHEET, self.boq_name, "sheet_name", "HVAC")), 1)
        cur_nodes = frappe.get_all(_NODE, filters={"boq": self.boq_name, "is_current": 1})
        self.assertEqual(len(cur_nodes), 3, "only the v2 nodes are current")

    def test_is_current_accessor_per_tier(self):
        """The centralized accessor returns the current row per tier, keyed by the
        tier's identity field."""
        self._seed_review_row("HVAC", 0, "line_item", description="Item", sl_no_value="1",
                              qty_total=1.0)
        res = self._commit("HVAC", "finalized")
        self.assertEqual(
            commit_pipeline._current_names(_GRID, self.boq_name, "source_sheet_name", "HVAC"),
            [res["grid_name"]])
        self.assertEqual(
            commit_pipeline._current_names(_SHEET, self.boq_name, "sheet_name", "HVAC"),
            [res["boq_sheet_name"]])
        node_names = commit_pipeline._current_names(
            _NODE, self.boq_name, "sheet", res["boq_sheet_name"])
        self.assertEqual(len(node_names), 1)
