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
from contextlib import contextmanager
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import commit_pipeline

_GRID = "BoQ Committed Sheet Grid"
_SHEET = "BoQ Sheet"
_NODE = "BOQ Nodes"


# Fakes for driving commit_boq's per-sheet loop WITHOUT an S3 fetch / real workbook.
# The loop only needs wb.sheetnames + wb[name] + wb.close(); _extract_grid_rows is
# patched to return synthetic rows, so the worksheet object itself is never read.
class _FakeWS:
    pass


class _FakeWB:
    def __init__(self, names):
        self._names = list(names)

    @property
    def sheetnames(self):
        return self._names

    def __getitem__(self, key):
        return _FakeWS()

    def close(self):
        pass
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
                              fields=["name", "node_type", "row_class", "level", "code",
                                      "description",
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
        (X: now committed as an Other node, parented to the preamble) + a SPACER
        (grid-only, the one class that must NOT become a node)."""
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

    def test_node_tree_priceable_unchanged_note_committed_spacer_skipped(self):
        """X: every classified row EXCEPT spacer becomes a node. preamble + line_items
        commit UNCHANGED (node_type/level/money/qty -- regression); the NOTE now commits
        as an Other node (row_class note) wired to its preamble parent; the SPACER stays
        grid-only. node_count = all-except-spacer = 4."""
        self._seed_node_sheet("HVAC")
        res = self._commit("HVAC", "finalized")
        self.assertEqual(res["node_count"], 4,
                         "1 preamble + 2 line items + 1 note (spacer skipped)")

        nodes = self._nodes_for_sheet(res["boq_sheet_name"])
        # spacer must NOT have become a node
        self.assertNotIn("spacer", {n.row_class for n in nodes})

        priceable = {n.code: n for n in nodes if n.node_type in ("Preamble", "Line Item")}
        self.assertEqual(set(priceable), {"A", "1", "2"})

        preamble = priceable["A"]
        self.assertEqual(preamble.node_type, "Preamble")
        self.assertEqual(preamble.row_class, "preamble")
        self.assertEqual(preamble.level, 1)
        self.assertIsNone(preamble.parent_node)  # root

        li1 = priceable["1"]
        self.assertEqual(li1.node_type, "Line Item")
        self.assertEqual(li1.row_class, "line_item")
        self.assertEqual(li1.parent_node, preamble.name)  # wired to the preamble
        # money preserved verbatim (word-order reversal landed)
        self.assertEqual(li1.qty, 100.0)
        self.assertEqual(li1.supply_rate, 50.0)
        self.assertEqual(li1.install_rate, 20.0)
        self.assertEqual(li1.combined_rate, 70.0)
        self.assertEqual(li1.supply_amount, 5000.0)
        self.assertEqual(li1.install_amount, 2000.0)
        self.assertEqual(li1.total_amount, 7000.0)

        li2 = priceable["2"]
        self.assertEqual(li2.parent_node, preamble.name)
        self.assertEqual(li2.is_rate_only, 1)
        self.assertEqual(li2.qty, 0.0)  # rate-only line item

        # the NOTE -> an Other node, row_class note, wired under the preamble
        note_nodes = [n for n in nodes if n.node_type == "Other"]
        self.assertEqual(len(note_nodes), 1)
        self.assertEqual(note_nodes[0].row_class, "note")
        self.assertEqual(note_nodes[0].description, "Site note")
        self.assertEqual(note_nodes[0].parent_node, preamble.name)

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
        self.assertEqual(len(v1_nodes), 4)  # X: preamble + 2 line items + note

        second = self._commit("HVAC", "finalized")
        v2_sheet = second["boq_sheet_name"]
        self.assertEqual(second["commit_version"], 2)
        self.assertEqual(second["froze_nodes"], 4, "the 4 v1 nodes were frozen")

        # shared version across all three tiers
        self.assertEqual(
            frappe.db.get_value(_GRID, second["grid_name"], "commit_version"), 2)
        self.assertEqual(frappe.db.get_value(_SHEET, v2_sheet, "commit_version"), 2)
        v2_nodes = self._nodes_for_sheet(v2_sheet)
        self.assertEqual(len(v2_nodes), 4)
        self.assertTrue(all(n.commit_version == 2 for n in v2_nodes))

        # v1 nodes frozen + STILL attached to frozen sheet v1 (coherent snapshot)
        v1_all = self._nodes_for_sheet(v1_sheet, current_only=False)
        self.assertEqual(len(v1_all), 4)
        self.assertTrue(all(n.is_current == 0 for n in v1_all))
        self.assertEqual(frappe.db.get_value(_SHEET, v1_sheet, "is_current"), 0)

        # exactly one current per tier
        self.assertEqual(len(self._current_grids("HVAC")), 1)
        self.assertEqual(
            len(commit_pipeline._current_names(_SHEET, self.boq_name, "sheet_name", "HVAC")), 1)
        cur_nodes = frappe.get_all(_NODE, filters={"boq": self.boq_name, "is_current": 1})
        self.assertEqual(len(cur_nodes), 4, "only the v2 nodes are current")

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

    # ================================================================== #
    # Level derivation from the effective tree (ADR-0009)                #
    # ================================================================== #
    # level is now DERIVED (nesting depth: preamble = 1 + preamble-ancestor count;
    # any non-preamble is level-less / None). The frozen parser `level` is IGNORED.
    # Re-parenting a preamble cascades the level of that row AND every descendant.

    def _nodes_by_sort(self, boq_sheet_name):
        return {n.sort_order: n for n in self._nodes_for_sheet(boq_sheet_name)}

    def test_derived_levels_ignore_stored_parser_level(self):
        """A root preamble + two preamble children commit at the DERIVED depths (root 1,
        children 2) -- the stored parser levels (0 / 1) are IGNORED."""
        self._seed_review_row("HVAC", 0, "preamble", level=0, description="root")
        self._seed_review_row("HVAC", 1, "preamble", level=1, parent_index=0,
                              description="child A", sl_no_value="1")
        self._seed_review_row("HVAC", 2, "preamble", level=1, parent_index=0,
                              description="child B", sl_no_value="2")
        self._seed_review_row("HVAC", 3, "line_item", level=0, parent_index=1,
                              description="item", sl_no_value="1.1", qty_total=5.0)
        res = self._commit("HVAC", "finalized")
        n = self._nodes_by_sort(res["boq_sheet_name"])
        self.assertEqual(n[0].node_type, "Preamble")
        self.assertEqual(n[0].level, 1)   # root preamble -> derived 1 (stored 0 ignored)
        self.assertEqual(n[1].level, 2)   # preamble under a preamble -> 2 (stored 1 ignored)
        self.assertEqual(n[2].level, 2)
        self.assertEqual(n[3].node_type, "Line Item")
        self.assertIn(n[3].level, (None, 0), "a line_item node is level-less (None)")

    def test_derived_levels_skip_non_preamble_ancestors(self):
        """A level-less root preamble with line-item children AND a preamble child:
        the line items don't affect the preamble depths -> root 1, sub-preamble 2."""
        self._seed_review_row("HVAC", 0, "preamble", level=0, description="DX UNIT")
        self._seed_review_row("HVAC", 1, "line_item", level=0, parent_index=0,
                              description="li a", sl_no_value="a", qty_total=1.0)
        self._seed_review_row("HVAC", 2, "line_item", level=0, parent_index=0,
                              description="li b", sl_no_value="b", qty_total=2.0)
        self._seed_review_row("HVAC", 3, "preamble", level=1, parent_index=0,
                              description="sub preamble", sl_no_value="1")
        res = self._commit("HVAC", "finalized")
        n = self._nodes_by_sort(res["boq_sheet_name"])
        self.assertEqual(n[0].level, 1)   # root preamble -> 1
        self.assertEqual(n[3].level, 2)   # preamble under the root -> 2

    def test_childless_root_preamble_derives_level_one(self):
        """A CHILDLESS root preamble (no ancestors) derives level 1 (root), regardless of
        any line items elsewhere on the sheet."""
        self._seed_review_row("HVAC", 0, "line_item", level=0, description="li",
                              sl_no_value="1", qty_total=1.0)
        self._seed_review_row("HVAC", 1, "preamble", level=0, description="promoted",
                              sl_no_value="5")
        res = self._commit("HVAC", "finalized")
        n = self._nodes_by_sort(res["boq_sheet_name"])
        self.assertEqual(n[1].node_type, "Preamble")
        self.assertEqual(n[1].level, 1)   # childless root preamble -> 1

    def test_normal_multilevel_preamble_levels_unchanged(self):
        """Control / regression: a real, consistent multi-level preamble tree (L1 -> L2)
        derives the SAME levels it was stored with -- derivation is a no-op when the stored
        levels already match the tree depth."""
        self._seed_review_row("HVAC", 0, "preamble", level=1, description="L1", sl_no_value="1")
        self._seed_review_row("HVAC", 1, "preamble", level=2, parent_index=0,
                              description="L2", sl_no_value="1.1")
        self._seed_review_row("HVAC", 2, "line_item", level=0, parent_index=1,
                              description="item", sl_no_value="a", qty_total=3.0)
        res = self._commit("HVAC", "finalized")
        n = self._nodes_by_sort(res["boq_sheet_name"])
        self.assertEqual(n[0].level, 1)
        self.assertEqual(n[1].level, 2)
        self.assertEqual(n[2].node_type, "Line Item")

    def test_deep_four_tier_preamble_chain_derives_increasing_levels(self):
        """A 4-tier preamble chain (the VALVES repro shape) commits with strictly
        increasing derived levels 1->2->3->4, and the committed tree passes the controller
        #7 backstop at every tier (no frappe.throw)."""
        self._seed_review_row("HVAC", 0, "preamble", level=1, description="CHILLD WATER",
                              sl_no_value="A")
        self._seed_review_row("HVAC", 1, "preamble", level=1, parent_index=0,
                              description="VALVES", sl_no_value="A.1")
        self._seed_review_row("HVAC", 2, "preamble", level=1, parent_index=1,
                              description="BTU METER", sl_no_value="A.1.1")
        self._seed_review_row("HVAC", 3, "preamble", level=1, parent_index=2,
                              description="Ultrasonic BTUH", sl_no_value="A.1.1.1")
        self._seed_review_row("HVAC", 4, "line_item", parent_index=3,
                              description="meter item", sl_no_value="1", qty_total=2.0)
        res = self._commit("HVAC", "finalized")
        n = self._nodes_by_sort(res["boq_sheet_name"])
        self.assertEqual([n[i].level for i in range(4)], [1, 2, 3, 4])
        self.assertEqual(n[4].node_type, "Line Item")
        self.assertIn(n[4].level, (None, 0), "the line item is level-less")

    # ================================================================== #
    # X -- commit ALL classified rows except spacer as semantic nodes    #
    # ================================================================== #

    def test_commit_all_classified_except_spacer(self):
        """X: a sheet with preamble + line_item + note(under preamble) + subtotal_marker
        (root) + spacer -> the note & subtotal commit as Other nodes (correct row_class),
        the note wires to its preamble parent, the subtotal is root, and the SPACER alone
        stays grid-only. node_count = all-except-spacer = 4."""
        self._seed_review_row("HVAC", 0, "preamble", level=1, description="GROUP",
                              sl_no_value="A")
        self._seed_review_row("HVAC", 1, "line_item", parent_index=0, description="Item",
                              sl_no_value="1", qty_total=1.0)
        self._seed_review_row("HVAC", 2, "note", parent_index=0, description="Site note")
        self._seed_review_row("HVAC", 3, "subtotal_marker", description="TOTAL")  # root
        self._seed_review_row("HVAC", 4, "spacer", description="")
        res = self._commit("HVAC", "finalized")
        self.assertEqual(res["node_count"], 4, "preamble + line_item + note + subtotal "
                                               "(spacer skipped)")

        nodes = self._nodes_for_sheet(res["boq_sheet_name"])
        by_class = {}
        for n in nodes:
            by_class.setdefault(n.row_class, []).append(n)
        # spacer is the ONLY class that did not become a node
        self.assertNotIn("spacer", by_class)
        self.assertEqual(set(by_class), {"preamble", "line_item", "note", "subtotal_marker"})

        preamble = by_class["preamble"][0]

        note = by_class["note"][0]
        self.assertEqual(note.node_type, "Other")
        self.assertEqual(note.parent_node, preamble.name)  # wired under the preamble

        subtotal = by_class["subtotal_marker"][0]
        self.assertEqual(subtotal.node_type, "Other")
        self.assertEqual(subtotal.description, "TOTAL")
        self.assertIsNone(subtotal.parent_node)  # root marker

    def test_other_note_node_carries_description_no_money(self):
        """A note commits as Other with its description text and NO qty/rate/amount
        (notes carry none on the review row)."""
        self._seed_review_row("HVAC", 0, "preamble", level=1, description="GROUP",
                              sl_no_value="A")
        self._seed_review_row("HVAC", 1, "note", parent_index=0,
                              description="rates inclusive of taxes")
        res = self._commit("HVAC", "finalized")
        note = [n for n in self._nodes_for_sheet(res["boq_sheet_name"])
                if n.node_type == "Other"][0]
        self.assertEqual(note.row_class, "note")
        self.assertEqual(note.description, "rates inclusive of taxes")
        # no money carried (Currency/Float default to 0/None when unset)
        self.assertIn(note.qty, (None, 0.0))
        self.assertIn(note.supply_rate, (None, 0.0))
        self.assertIn(note.combined_rate, (None, 0.0))
        self.assertIn(note.total_amount, (None, 0.0))

    def test_attached_notes_not_doubled_by_X(self):
        """The parser ALREADY rolls descendant note text onto the nearest preamble's
        attached_notes (carried verbatim by 3b). X commits the note as its OWN node but
        must NOT re-attach -- the preamble node's attached_notes stays exactly what the
        review row had, NOT doubled."""
        self._seed_review_row("HVAC", 0, "preamble", level=1, description="LT CABLES",
                              sl_no_value="A", attached_notes=["Aluminium Cables"])
        self._seed_review_row("HVAC", 1, "note", parent_index=0,
                              description="Aluminium Cables")
        res = self._commit("HVAC", "finalized")
        nodes = self._nodes_for_sheet(res["boq_sheet_name"])
        preamble = [n for n in nodes if n.node_type == "Preamble"][0]
        pre_doc = frappe.get_doc(_NODE, preamble.name)
        # unchanged carry -- exactly the one element, NOT ["Aluminium Cables"] * 2
        self.assertEqual(self._pj(pre_doc.attached_notes), ["Aluminium Cables"])
        # the note ALSO exists as its own discrete node
        note_nodes = [n for n in nodes if n.node_type == "Other" and n.row_class == "note"]
        self.assertEqual(len(note_nodes), 1)
        self.assertEqual(note_nodes[0].description, "Aluminium Cables")

    def test_preamble_with_note_child_derives_levels_from_depth(self):
        """ADR-0009: a root preamble whose children are a sub-preamble AND a note derives
        its level from TREE DEPTH (root -> 1), not from its children. The note is level-less
        (None) and never affects the preamble depths; the sub-preamble derives 2."""
        self._seed_review_row("HVAC", 0, "preamble", level=0, description="root")
        self._seed_review_row("HVAC", 1, "preamble", level=2, parent_index=0,
                              description="sub", sl_no_value="1")
        self._seed_review_row("HVAC", 2, "note", parent_index=0, description="a note")
        res = self._commit("HVAC", "finalized")
        n = self._nodes_by_sort(res["boq_sheet_name"])
        self.assertEqual(n[0].node_type, "Preamble")
        self.assertEqual(n[0].level, 1, "root preamble -> derived 1")
        self.assertEqual(n[1].level, 2, "sub preamble under the root -> 2")
        self.assertIn(n[2].level, (None, 0), "the note node is level-less")

    # ================================================================== #
    # Slice 2 -- commit round-trip reconciliation (output-fidelity)
    # ================================================================== #
    # The reconciliation runs at the tail of _commit_node_tree (node tier) and inside
    # _commit_one_sheet (grid tier), BEFORE the per-sheet commit. To prove a divergence
    # FIRES, the stored side is corrupted AFTER the writes but BEFORE the real reconcile
    # reads it -- a wrapper around the reconcile helper tampers one written value then
    # delegates to the REAL helper, so the real reconcile reads the corrupted stored rows.
    # No production code is altered. (A reconcile raise propagates exactly like any other
    # per-sheet exception, so commit_boq's Slice-5 isolation routes it to failed[] -- that
    # raise->failed[] routing is already proven by TestCommitBoqPartialFailure; here we
    # prove the reconcile itself fires/stays-silent correctly.)

    def _corrupt_then(self, helper_name, corruptor):
        """Patch commit_pipeline.<helper_name> with a wrapper that runs corruptor(*args)
        (tampering the stored side) then calls the REAL helper with the same args."""
        orig = getattr(commit_pipeline, helper_name)

        def wrapper(*args, **kwargs):
            corruptor(*args, **kwargs)
            return orig(*args, **kwargs)

        return patch.object(commit_pipeline, helper_name, wrapper)

    # ----- MUST FIRE ---------------------------------------------------- #

    def test_reconcile_fires_on_corrupted_money(self):
        """A stored money field tampered to differ from the produced value (beyond 2dp)."""
        self._seed_node_sheet("HVAC")

        def corrupt(sheet_name, boq_sheet_name, commit_version, node_rows,
                    eff_parent_by_idx, name_by_idx, docs_by_idx):
            frappe.db.set_value(_NODE, name_by_idx[1], "total_amount", 999999.0,
                                update_modified=False)

        with self._corrupt_then("_reconcile_node_tree", corrupt):
            with self.assertRaises(frappe.ValidationError):
                self._commit("HVAC", "finalized")

    def test_reconcile_fires_on_dropped_per_area_child(self):
        """Source row has 2 area children; one stored child deleted -> count divergence."""
        self._seed_review_row("HVAC", 0, "line_item", description="Multi", sl_no_value="1",
                              qty_total=30.0, qty_by_area={"Zone A": 10.0, "Zone B": 20.0})

        def corrupt(sheet_name, boq_sheet_name, commit_version, node_rows,
                    eff_parent_by_idx, name_by_idx, docs_by_idx):
            frappe.db.delete("BOQ Node Qty By Area",
                             {"parent": name_by_idx[0], "area_name": "Zone B"})

        with self._corrupt_then("_reconcile_node_tree", corrupt):
            with self.assertRaises(frappe.ValidationError):
                self._commit("HVAC", "finalized")

    def test_reconcile_fires_on_zero_node_finalized_sheet(self):
        """Non-spacer review rows exist but no current node persisted -> count divergence."""
        self._seed_node_sheet("HVAC")

        def corrupt(sheet_name, boq_sheet_name, commit_version, node_rows,
                    eff_parent_by_idx, name_by_idx, docs_by_idx):
            for nm in name_by_idx.values():
                frappe.db.set_value(_NODE, nm, "is_current", 0, update_modified=False)

        with self._corrupt_then("_reconcile_node_tree", corrupt):
            with self.assertRaises(frappe.ValidationError):
                self._commit("HVAC", "finalized")

    def test_reconcile_fires_on_wrong_parent_node(self):
        """A child's stored parent_node tampered away from the captured eff-parent."""
        self._seed_review_row("HVAC", 0, "preamble", level=1, description="P", sl_no_value="A")
        self._seed_review_row("HVAC", 1, "line_item", parent_index=0, description="child",
                              sl_no_value="1", qty_total=1.0)

        def corrupt(sheet_name, boq_sheet_name, commit_version, node_rows,
                    eff_parent_by_idx, name_by_idx, docs_by_idx):
            frappe.db.set_value(_NODE, name_by_idx[1], "parent_node", None,
                                update_modified=False)

        with self._corrupt_then("_reconcile_node_tree", corrupt):
            with self.assertRaises(frappe.ValidationError):
                self._commit("HVAC", "finalized")

    def test_reconcile_fires_on_mutated_level(self):
        """The thin tripwire: a stored level tampered away from the produced doc value."""
        self._seed_review_row("HVAC", 0, "preamble", level=1, description="P", sl_no_value="A")

        def corrupt(sheet_name, boq_sheet_name, commit_version, node_rows,
                    eff_parent_by_idx, name_by_idx, docs_by_idx):
            frappe.db.set_value(_NODE, name_by_idx[0], "level", 99, update_modified=False)

        with self._corrupt_then("_reconcile_node_tree", corrupt):
            with self.assertRaises(frappe.ValidationError):
                self._commit("HVAC", "finalized")

    def test_reconcile_fires_on_corrupted_grid(self):
        """Grid tier: a stored grid-row cell tampered to differ from the extracted grid."""
        def corrupt(sheet_name, grid_name, grid_rows):
            row = frappe.get_all("BoQ Committed Sheet Grid Row",
                                 filters={"parent": grid_name, "row_order": 1},
                                 pluck="name")[0]
            frappe.db.set_value("BoQ Committed Sheet Grid Row", row, "cells",
                                json.dumps({"A": "TAMPERED"}), update_modified=False)

        with self._corrupt_then("_reconcile_grid", corrupt):
            with self.assertRaises(frappe.ValidationError):
                self._commit("HVAC", "finalized")  # no seed needed; grid always written

    # ----- MUST NOT FIRE (suppress-set: faithful commits pass clean) ---- #

    def test_reconcile_silent_flat_rate_stays_flat(self):
        """FLAT rate_by_area scalar -> child combined_rate ONLY; supply/install ABSENT,
        not invented -> faithful, no fire."""
        self._seed_review_row("HVAC", 0, "line_item", description="Flat", sl_no_value="1",
                              qty_total=5.0, qty_by_area={"Zone A": 5.0},
                              rate_by_area={"Zone A": 70.0})
        res = self._commit("HVAC", "finalized")  # must NOT raise
        nm = self._nodes_for_sheet(res["boq_sheet_name"])[0]["name"]
        ch = frappe.get_all("BOQ Node Qty By Area", filters={"parent": nm},
                            fields=["combined_rate", "supply_rate", "install_rate"])
        self.assertEqual(len(ch), 1)
        self.assertEqual(ch[0]["combined_rate"], 70.0)
        self.assertIn(ch[0]["supply_rate"], (None, 0, 0.0))  # absent, not invented

    def test_reconcile_silent_blank_qty_and_placeholder_desc(self):
        """blank qty -> 0 (Line Item); empty description -> sl_no_value cascade -> no fire."""
        self._seed_review_row("HVAC", 0, "line_item", sl_no_value="X")  # no qty, no description
        res = self._commit("HVAC", "finalized")  # must NOT raise
        n = self._nodes_for_sheet(res["boq_sheet_name"])[0]
        self.assertEqual(n["qty"], 0.0)
        self.assertEqual(n["description"], "X")  # desc empty -> sl_no_value

    def test_reconcile_silent_general_specs_zero_nodes(self):
        """A general-specs (grid-only) commit produces 0 nodes; node reconcile not run,
        grid reconcile passes -> no fire."""
        res = self._commit("SOW", "general_specs")  # must NOT raise
        self.assertEqual(res["node_count"], 0)

    def test_reconcile_silent_note_other_money_null_and_dropped_spacer_parent(self):
        """note -> Other (money null); a line item whose parent is a SPACER (skipped) ->
        committed as root (expected parent None == stored None) -> no fire."""
        self._seed_review_row("HVAC", 0, "spacer", description="")
        self._seed_review_row("HVAC", 1, "line_item", parent_index=0, description="orphan",
                              sl_no_value="1", qty_total=1.0)
        self._seed_review_row("HVAC", 2, "note", description="a note")
        res = self._commit("HVAC", "finalized")  # must NOT raise
        nodes = {n["row_class"]: n for n in self._nodes_for_sheet(res["boq_sheet_name"])}
        self.assertIsNone(nodes["line_item"]["parent_node"])  # spacer parent dropped -> root
        self.assertEqual(nodes["note"]["node_type"], "Other")
        self.assertIn(nodes["note"]["total_amount"], (None, 0, 0.0))  # money null on Other

    def test_reconcile_silent_recommit_versioning_excluded(self):
        """Re-commit (v2): versioning triple + minted commit_provenance_id differ but are
        EXCLUDED from the compare -> neither commit fires."""
        self._seed_review_row("HVAC", 0, "line_item", description="Item", sl_no_value="1",
                              qty_total=1.0)
        r1 = self._commit("HVAC", "finalized")
        r2 = self._commit("HVAC", "finalized")  # must NOT raise (re-commit, v2)
        self.assertEqual(r1["commit_version"], 1)
        self.assertEqual(r2["commit_version"], 2)


class TestCommitBoqPartialFailure(FrappeTestCase):
    """Slice 5 -- the per-sheet partial-failure contract of commit_boq.

    commit_boq commits per sheet (each _commit_one_sheet ends with frappe.db.commit())
    and, on a mid-batch sheet failure, ROLLS BACK that sheet, records it in failed[],
    and CONTINUES -- so committed[] + failed[] together describe a mixed outcome.

    MECHANISM: these tests drive commit_boq (the public loop) but PATCH its file path
    -- _fetch_boq_file_to_tempfile + openpyxl.load_workbook (-> _FakeWB) +
    _extract_grid_rows (-> synthetic _GRID_ROWS) -- so no S3 fetch / real workbook is
    needed (the same reason the rest of the suite tests _commit_one_sheet directly).
    A per-sheet failure is induced by monkeypatching _commit_one_sheet (or, for the
    post-freeze orphan case, _commit_node_tree) to raise for ONE sheet_name while
    letting the others run for real. _commit_one_sheet commits, so committed rows are
    cleaned in tearDown.
    """

    _SHEETS = ["S1", "S2", "S3"]

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT
        boq.boq_name = "Shared Test BoQ for Partial Commit"
        for i, s in enumerate(cls._SHEETS, start=1):
            boq.append("sheet_drafts", {
                "sheet_name": s, "sheet_order": i,
                "wizard_status": "Finalized", "sheet_config": json.dumps(_CFG),
            })
        boq.insert(ignore_permissions=True, ignore_links=True)
        cls.boq_name = boq.name
        # commit_boq reads source_file_url before the loop (throws if blank); the
        # value is never dereferenced because the fetch/open are patched.
        frappe.db.set_value("BOQs", cls.boq_name, "source_file_url", "/fake/boq.xlsx")
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "boq_name"):
            TestCommitPipeline._purge(cls.boq_name)
            frappe.db.delete("BOQs", {"name": cls.boq_name})
            frappe.db.commit()
        super().tearDownClass()

    def tearDown(self):
        TestCommitPipeline._purge(self.boq_name)
        # Slice F1: commit-failure stamps are committed by commit_boq's except block, so
        # they survive FrappeTestCase's per-test rollback. Clear them here or they leak
        # into the next test (the draft rows are shared, created once in setUpClass).
        for s in self._SHEETS:
            cn = frappe.db.get_value(
                "BoQ Sheet Draft",
                {"parent": self.boq_name, "parenttype": "BOQs", "sheet_name": s}, "name")
            if cn:
                frappe.db.set_value(
                    "BoQ Sheet Draft", cn,
                    {"commit_failure_reason": None, "commit_failure_at": None},
                    update_modified=False)
        frappe.db.commit()
        super().tearDown()

    # ----- helpers ------------------------------------------------------ #

    def _failure_fields(self, sheet_name):
        """Read the persisted per-sheet commit-failure stamp from the BoQ Sheet Draft
        (verbatim sheet_name match, #152)."""
        return frappe.db.get_value(
            "BoQ Sheet Draft",
            {"parent": self.boq_name, "parenttype": "BOQs", "sheet_name": sheet_name},
            ["commit_failure_reason", "commit_failure_at"], as_dict=True)

    @contextmanager
    def _patched_filepath(self, sheetnames):
        """Patch commit_boq's file path so its loop runs without S3 / a real workbook."""
        with patch.object(commit_pipeline, "_fetch_boq_file_to_tempfile",
                          return_value="/tmp/fake_boq_partial.xlsx"), \
             patch.object(commit_pipeline.openpyxl, "load_workbook",
                          return_value=_FakeWB(sheetnames)), \
             patch.object(commit_pipeline, "_extract_grid_rows",
                          return_value=list(_GRID_ROWS)):
            yield

    def _draft(self, sheet_name):
        boq = frappe.get_doc("BOQs", self.boq_name)
        for d in boq.sheet_drafts:
            if d.sheet_name == sheet_name:
                return d
        raise AssertionError(f"draft {sheet_name!r} not found")

    def _current_grids(self, sheet_name):
        return frappe.get_all(
            _GRID,
            filters={"boq": self.boq_name, "source_sheet_name": sheet_name,
                     "is_current": 1},
            pluck="name",
        )

    # ----- T1. partial-success durability ------------------------------- #

    def test_partial_success_earlier_sheets_durable(self):
        """A 3-sheet subset where sheet #2 fails -> committed[] = [#1, #3], failed[] =
        [#2 with a reason]; #1 and #3 are actually persisted (is_current=1 grid) while
        #2 left NOTHING new (no current grid)."""
        real_one = commit_pipeline._commit_one_sheet

        def one_side(boq_name, sheet_name, disposition, grid_rows, draft):
            if sheet_name == "S2":
                raise RuntimeError("induced failure on S2")
            return real_one(boq_name, sheet_name, disposition, grid_rows, draft)

        with self._patched_filepath(["S1", "S2", "S3"]), \
             patch.object(commit_pipeline, "_commit_one_sheet", side_effect=one_side):
            res = commit_pipeline.commit_boq(self.boq_name, ["S1", "S2", "S3"])

        self.assertEqual([c["sheet_name"] for c in res["committed"]], ["S1", "S3"])
        self.assertEqual([f["sheet_name"] for f in res["failed"]], ["S2"])
        self.assertTrue(res["failed"][0]["reason"])

        # #1 and #3 durable; #2 wrote nothing.
        self.assertEqual(len(self._current_grids("S1")), 1)
        self.assertEqual(len(self._current_grids("S3")), 1)
        self.assertEqual(self._current_grids("S2"), [])

    # ----- T2. ORPHAN PREVENTION (the load-bearing safety test) --------- #

    def test_orphan_prevention_rollback_restores_prior_on_failed_recommit(self):
        """THE load-bearing test. A RE-COMMIT whose new write fails AFTER the
        freeze-before-write point must leave the PRIOR committed version intact
        (is_current=1) -- the except's frappe.db.rollback() discards the freeze.

        Induction: S1 is committed once (real) -> it has a prior is_current=1 grid.
        Then commit_boq([S1, S2]) runs with _commit_node_tree patched to RAISE for S1
        -- but only AFTER the REAL tier-1 (_write_grid) + tier-2 (_write_committed_boq_sheet)
        freezes have already set S1's prior rows is_current=0 and inserted the new ones.
        S2 (after S1 in the subset) then commits for real.

        *** This test FAILS if the frappe.db.rollback() line in the except is removed ***
        Without it, S2's frappe.db.commit() flushes S1's pending freeze: S1's prior grid
        is left is_current=0 and a NODE-LESS new version becomes current (orphaned prior +
        half-written new). With the rollback, S1's freeze is undone and its prior grid
        stays is_current=1 at commit_version 1.
        """
        first = commit_pipeline._commit_one_sheet(
            self.boq_name, "S1", "finalized", list(_GRID_ROWS), self._draft("S1"))
        v1_grid = first["grid_name"]
        self.assertEqual(frappe.db.get_value(_GRID, v1_grid, "is_current"), 1)
        self.assertEqual(first["commit_version"], 1)

        real_node_tree = commit_pipeline._commit_node_tree

        def node_side(boq_name, sheet_name, *args, **kwargs):
            # By the time _commit_node_tree is called, the REAL _write_grid +
            # _write_committed_boq_sheet have already frozen S1's prior grid + sheet
            # (is_current -> 0) and inserted the new ones -- the post-freeze failure state.
            if sheet_name == "S1":
                raise RuntimeError("induced node-tree failure on S1 (post-freeze)")
            return real_node_tree(boq_name, sheet_name, *args, **kwargs)

        with self._patched_filepath(["S1", "S2"]), \
             patch.object(commit_pipeline, "_commit_node_tree", side_effect=node_side):
            res = commit_pipeline.commit_boq(self.boq_name, ["S1", "S2"])

        # S1 failed (rolled back), S2 committed.
        self.assertEqual([f["sheet_name"] for f in res["failed"]], ["S1"])
        self.assertEqual([c["sheet_name"] for c in res["committed"]], ["S2"])

        # THE assertion: the prior S1 grid is STILL current -- the rollback discarded
        # the freeze. (Remove frappe.db.rollback() in the except and this becomes 0.)
        self.assertEqual(
            frappe.db.get_value(_GRID, v1_grid, "is_current"), 1,
            "prior version must survive a failed re-commit (rollback discarded the freeze)")
        # exactly one current grid for S1, and it is the pre-committed v1 (no failed v2).
        self.assertEqual(self._current_grids("S1"), [v1_grid])
        self.assertEqual(frappe.db.get_value(_GRID, v1_grid, "commit_version"), 1)

    # ----- T3. all-success: failed[] present + empty -------------------- #

    def test_all_success_failed_is_empty_list(self):
        with self._patched_filepath(["S1", "S2", "S3"]):
            res = commit_pipeline.commit_boq(self.boq_name, ["S1", "S2", "S3"])
        self.assertIn("failed", res)                 # key present, not missing
        self.assertEqual(res["failed"], [])           # and empty
        self.assertEqual(
            sorted(c["sheet_name"] for c in res["committed"]), ["S1", "S2", "S3"])
        for s in ("S1", "S2", "S3"):
            self.assertEqual(len(self._current_grids(s)), 1)

    # ----- T4. envelope shape ------------------------------------------- #

    def test_envelope_shape_always_boq_committed_failed(self):
        real_one = commit_pipeline._commit_one_sheet

        def one_side(boq_name, sheet_name, disposition, grid_rows, draft):
            if sheet_name == "S2":
                raise RuntimeError("boom")
            return real_one(boq_name, sheet_name, disposition, grid_rows, draft)

        with self._patched_filepath(["S1", "S2", "S3"]), \
             patch.object(commit_pipeline, "_commit_one_sheet", side_effect=one_side):
            res = commit_pipeline.commit_boq(self.boq_name, ["S1", "S2", "S3"])

        self.assertEqual(set(res), {"boq_name", "committed", "failed"})
        self.assertEqual(res["boq_name"], self.boq_name)
        self.assertTrue(res["failed"])
        for f in res["failed"]:
            self.assertEqual(set(f), {"sheet_name", "reason"})
            self.assertIsInstance(f["reason"], str)
            self.assertTrue(f["reason"])

    # ----- T5. reason fallback (message-less exception) ----------------- #

    def test_reason_fallback_when_exception_has_no_message(self):
        """A failure whose exception str() is empty -> reason is the safe fallback
        (proves _commit_failure_reason never returns empty)."""
        real_one = commit_pipeline._commit_one_sheet

        def one_side(boq_name, sheet_name, disposition, grid_rows, draft):
            if sheet_name == "S1":
                raise RuntimeError()  # no message -> str(e) == ""
            return real_one(boq_name, sheet_name, disposition, grid_rows, draft)

        with self._patched_filepath(["S1"]), \
             patch.object(commit_pipeline, "_commit_one_sheet", side_effect=one_side):
            res = commit_pipeline.commit_boq(self.boq_name, ["S1"])

        self.assertEqual([f["sheet_name"] for f in res["failed"]], ["S1"])
        self.assertEqual(
            res["failed"][0]["reason"],
            "Commit failed for this sheet -- see server logs.")

    # ----- T6. sheet-not-in-workbook is a per-sheet failure ------------- #

    def test_sheet_absent_from_workbook_is_per_sheet_failure(self):
        """A sheet that is commit-eligible (passes the gate) but ABSENT from the actual
        workbook lands in failed[] (loop continues), NOT a whole-call throw -- consistent
        with the new per-sheet contract. (An INELIGIBLE sheet is still rejected upfront by
        the gate re-check; that path is covered by TestCommitPipeline.)"""
        with self._patched_filepath(["S1"]):  # S2 eligible but absent from the workbook
            res = commit_pipeline.commit_boq(self.boq_name, ["S1", "S2"])
        self.assertEqual([c["sheet_name"] for c in res["committed"]], ["S1"])
        self.assertEqual([f["sheet_name"] for f in res["failed"]], ["S2"])
        self.assertIn("not found", res["failed"][0]["reason"].lower())

    # ================================================================== #
    # Slice F1 -- DURABLE per-sheet commit-failure persistence            #
    # ================================================================== #

    def test_f1_commit_failure_persisted_on_last_sheet_failure(self):
        """PERSIST-ON-FAILURE: the FAILING sheet is LAST in the subset, so no later
        _commit_one_sheet commit could flush the stamp -- it persists ONLY because of the
        except block's OWN explicit commit. Proves both persistence and that the explicit
        commit is load-bearing (non-vacuous). reason == the returned failed[] reason."""
        real_one = commit_pipeline._commit_one_sheet

        def one_side(boq_name, sheet_name, disposition, grid_rows, draft):
            if sheet_name == "S3":  # LAST in [S1, S2, S3]
                raise RuntimeError("induced failure on the last sheet")
            return real_one(boq_name, sheet_name, disposition, grid_rows, draft)

        with self._patched_filepath(["S1", "S2", "S3"]), \
             patch.object(commit_pipeline, "_commit_one_sheet", side_effect=one_side):
            res = commit_pipeline.commit_boq(self.boq_name, ["S1", "S2", "S3"])

        self.assertEqual([f["sheet_name"] for f in res["failed"]], ["S3"])
        stamp = self._failure_fields("S3")
        self.assertEqual(stamp.commit_failure_reason, res["failed"][0]["reason"])
        self.assertEqual(stamp.commit_failure_reason, "induced failure on the last sheet")
        self.assertTrue(stamp.commit_failure_at, "the failure timestamp must be set")

    def test_f1_stamp_survives_rollback_and_no_orphan(self):
        """KEYSTONE: a POST-FREEZE re-commit failure on the LAST sheet. The except block's
        frappe.db.rollback() discards the freeze (orphan-prevention) AND the failure stamp
        -- written AFTER the rollback + committed by the except's own commit -- SURVIVES
        that very rollback. Combined proof: the new failure-commit does NOT re-flush the
        rolled-back tier writes (prior version stays current) yet the stamp is durable.

        S1 is pre-committed once (real). Then commit_boq([S2, S1]) runs with
        _commit_node_tree patched to RAISE for S1 -- only AFTER the real _write_grid +
        _write_committed_boq_sheet have already frozen S1's prior rows. S1 is LAST, so the
        stamp persists ONLY via the except's explicit commit (no later sheet)."""
        first = commit_pipeline._commit_one_sheet(
            self.boq_name, "S1", "finalized", list(_GRID_ROWS), self._draft("S1"))
        v1_grid = first["grid_name"]
        self.assertEqual(frappe.db.get_value(_GRID, v1_grid, "is_current"), 1)

        real_node_tree = commit_pipeline._commit_node_tree

        def node_side(boq_name, sheet_name, *args, **kwargs):
            if sheet_name == "S1":  # post-freeze failure, LAST in [S2, S1]
                raise RuntimeError("induced post-freeze failure on S1")
            return real_node_tree(boq_name, sheet_name, *args, **kwargs)

        with self._patched_filepath(["S2", "S1"]), \
             patch.object(commit_pipeline, "_commit_node_tree", side_effect=node_side):
            res = commit_pipeline.commit_boq(self.boq_name, ["S2", "S1"])

        self.assertEqual([f["sheet_name"] for f in res["failed"]], ["S1"])
        self.assertEqual([c["sheet_name"] for c in res["committed"]], ["S2"])

        # ORPHAN-PREVENTION still holds: the failure-commit did NOT flush the rolled-back
        # freeze -- the prior S1 grid is still current, exactly one current, at version 1.
        self.assertEqual(
            frappe.db.get_value(_GRID, v1_grid, "is_current"), 1,
            "prior version must survive; the new failure-commit must not flush the freeze")
        self.assertEqual(self._current_grids("S1"), [v1_grid])
        self.assertEqual(frappe.db.get_value(_GRID, v1_grid, "commit_version"), 1)

        # And the stamp SURVIVED the rollback that discarded the freeze.
        stamp = self._failure_fields("S1")
        self.assertEqual(stamp.commit_failure_reason, "induced post-freeze failure on S1")
        self.assertTrue(stamp.commit_failure_at)

    def test_f1_cleared_on_successful_recommit(self):
        """CLEAR-ON-RE-COMMIT-SUCCESS: a sheet carrying a prior commit_failure stamp ->
        a subsequent SUCCESSFUL commit clears both fields to None."""
        # Pre-stamp S1 directly (committed, as the real failure path would leave it).
        commit_pipeline._record_commit_failure(self.boq_name, "S1", "an earlier failure")
        frappe.db.commit()
        pre = self._failure_fields("S1")
        self.assertEqual(pre.commit_failure_reason, "an earlier failure")  # guard: it is set

        with self._patched_filepath(["S1"]):
            res = commit_pipeline.commit_boq(self.boq_name, ["S1"])
        self.assertEqual([c["sheet_name"] for c in res["committed"]], ["S1"])

        post = self._failure_fields("S1")
        self.assertIsNone(post.commit_failure_reason)
        self.assertIsNone(post.commit_failure_at)

    def test_f1_clean_first_commit_leaves_fields_null(self):
        """NEVER-FAILED = NULL: a clean first commit leaves both failure fields None
        (the additive nullable default = 'no commit failure')."""
        with self._patched_filepath(["S1"]):
            res = commit_pipeline.commit_boq(self.boq_name, ["S1"])
        self.assertEqual([c["sheet_name"] for c in res["committed"]], ["S1"])
        stamp = self._failure_fields("S1")
        self.assertIsNone(stamp.commit_failure_reason)
        self.assertIsNone(stamp.commit_failure_at)

    def test_f1_mixed_outcome_only_failed_sheet_stamped(self):
        """MIXED OUTCOME: one sheet fails (stamped) + the others succeed (clean, no
        stamp) in the SAME call -- both the returned envelope AND the persisted per-sheet
        state are correct."""
        real_one = commit_pipeline._commit_one_sheet

        def one_side(boq_name, sheet_name, disposition, grid_rows, draft):
            if sheet_name == "S2":
                raise RuntimeError("induced failure on S2")
            return real_one(boq_name, sheet_name, disposition, grid_rows, draft)

        with self._patched_filepath(["S1", "S2", "S3"]), \
             patch.object(commit_pipeline, "_commit_one_sheet", side_effect=one_side):
            res = commit_pipeline.commit_boq(self.boq_name, ["S1", "S2", "S3"])

        self.assertEqual([c["sheet_name"] for c in res["committed"]], ["S1", "S3"])
        self.assertEqual([f["sheet_name"] for f in res["failed"]], ["S2"])

        # S2 stamped; S1 + S3 (clean successes) carry NO stamp.
        self.assertEqual(self._failure_fields("S2").commit_failure_reason,
                         "induced failure on S2")
        self.assertTrue(self._failure_fields("S2").commit_failure_at)
        self.assertIsNone(self._failure_fields("S1").commit_failure_reason)
        self.assertIsNone(self._failure_fields("S3").commit_failure_reason)
