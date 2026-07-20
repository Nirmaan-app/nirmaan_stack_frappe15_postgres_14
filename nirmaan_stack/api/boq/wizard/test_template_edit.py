# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""
Tests for template_edit.* -- the master-template CRUD editor endpoints (ADR-0013 A1, task A-T5).

Defends the SAME identity-preservation invariant as test_template_rows.py, but on the
`BoQ Template Row` doctype (keyed by template + sheet_name, no human overlay): after a
renumber-on-insert or reverse-renumber rewrites the row_index keyspace, every parent link
(resolved by row IDENTITY, not raw index) must be exactly what it was, and the index space
must stay contiguous 0..N-1 in visual order. Plus: edit patches, sheet add/remove/reorder,
per-sheet WP set, and the Admin+Estimates role gate.

The master template is project-less, so no Projects fixture is needed. Each test gets a FRESH
master (setUp) + full raw teardown so sheet-mutating tests stay isolated.

Run via the bench runner (NOT raw unittest -- see CLAUDE.md BoQ test-runner note):
  bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.test_template_edit
"""
import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.template_edit import (
    get_template_rows,
    template_add_sheet,
    template_create_row,
    template_delete_row,
    template_edit_row,
    template_remove_sheet,
    template_reorder_sheets,
    template_set_sheet_wp,
)

_TSHEET = "TSheet"

# (row_index, description, classification, parent_index) -- mirrors test_template_rows.py.
_SEED = [
    (0, "P1", "preamble", -1),
    (1, "L1a", "line_item", 0),
    (2, "P2", "preamble", -1),
    (3, "L2a", "line_item", 2),
    (4, "L2b", "line_item", 2),
]

# The identity invariant: description -> parent's description (or "ROOT").
_SEED_LINKS = {
    "P1": "ROOT",
    "L1a": "P1",
    "P2": "ROOT",
    "L2a": "P2",
    "L2b": "P2",
}


class TestTemplateEdit(FrappeTestCase):

    def setUp(self):
        # Fresh master per test -- sheet ops mutate the `sheets` child.
        master = frappe.new_doc("BoQ Template")
        master.template_name = f"TEST_TPL_EDIT_{frappe.generate_hash(length=6)}"
        master.is_active = 1
        master.append("sheets", {
            "sheet_name": _TSHEET,
            "sheet_order": 1,
            "disposition": "data",
            "sheet_config": {"header_row": 1, "area_dimensions": []},
        })
        master.insert(ignore_permissions=True)
        self.template = master.name
        self._seed_rows(_SEED)
        frappe.db.commit()

    def tearDown(self):
        # Raw deletes for the list-JSON carriers, then delete the (childless) master.
        frappe.db.delete("BoQ Template Row", {"template": self.template})
        frappe.db.delete(
            "BoQ Template Sheet", {"parent": self.template, "parenttype": "BoQ Template"}
        )
        frappe.delete_doc("BoQ Template", self.template, force=True, ignore_permissions=True)
        frappe.db.commit()

    # -- fixtures / helpers -------------------------------------------------

    def _seed_rows(self, seed, sheet=_TSHEET):
        frappe.db.delete("BoQ Template Row", {"template": self.template, "sheet_name": sheet})
        for row in seed:
            ridx, desc, cls_, parent = row[0], row[1], row[2], row[3]
            doc = frappe.new_doc("BoQ Template Row")
            doc.update({
                "template": self.template,
                "sheet_name": sheet,
                "row_index": ridx,
                "source_row_number": ridx + 2,
                "classification": cls_,
                "description": desc,
                "parent_index": parent,
                "attached_to_index": 0,
            })
            doc.insert(ignore_permissions=True)

    def _rows(self, sheet=_TSHEET):
        return frappe.db.get_all(
            "BoQ Template Row",
            filters={"template": self.template, "sheet_name": sheet},
            fields=["name", "row_index", "parent_index", "attached_to_index",
                    "description", "classification", "unit", "make_model", "is_rate_only"],
            order_by="row_index asc",
        )

    def _links(self, sheet=_TSHEET):
        rows = self._rows(sheet)
        by_idx = {r.row_index: r for r in rows}
        links = {}
        for r in rows:
            p = r.parent_index
            links[r.description] = "ROOT" if (p is None or p < 0) else by_idx[p].description
        return links

    def _indices(self, sheet=_TSHEET):
        return [r.row_index for r in self._rows(sheet)]

    def _descs_in_order(self, sheet=_TSHEET):
        return [r.description for r in self._rows(sheet)]

    def _assert_contiguous(self, sheet=_TSHEET):
        idxs = self._indices(sheet)
        self.assertEqual(idxs, list(range(len(idxs))),
                         f"row_index must be contiguous 0..N-1, got {idxs}")

    def _srns(self, sheet=_TSHEET):
        """source_row_number ("Excel Row") ordered by row_index."""
        return [
            r.source_row_number
            for r in frappe.db.get_all(
                "BoQ Template Row",
                filters={"template": self.template, "sheet_name": sheet},
                fields=["row_index", "source_row_number"],
                order_by="row_index asc",
            )
        ]

    def _assert_srn_ok(self, sheet=_TSHEET):
        """After any edit the Excel-row numbering must be: no 0 / None (openpyxl rejects row
        0), all positive, and contiguous step-1 (== row_index + offset for a single offset)."""
        srns = self._srns(sheet)
        self.assertNotIn(0, srns, f"source_row_number must never be 0, got {srns}")
        self.assertNotIn(None, srns, f"source_row_number must never be None, got {srns}")
        self.assertTrue(all(s >= 1 for s in srns),
                        f"every source_row_number must be >= 1, got {srns}")
        offset = srns[0]
        self.assertEqual(srns, [offset + i for i in range(len(srns))],
                         f"source_row_number must be contiguous row_index+offset, got {srns}")

    def _sheets(self):
        return frappe.db.get_all(
            "BoQ Template Sheet",
            filters={"parent": self.template, "parenttype": "BoQ Template"},
            fields=["sheet_name", "sheet_order", "disposition", "sheet_config",
                    "work_packages", "sheet_label"],
            order_by="sheet_order asc",
        )

    # -- create: renumber + parent-link preservation ------------------------

    def test_create_below_preserves_order_and_links(self):
        res = template_create_row(
            template=self.template, sheet_name=_TSHEET,
            anchor_row_index=1, position="below",
            classification="line_item", parent_index=0, description="NEW",
        )
        self.assertEqual(res["status"], "saved")
        self.assertEqual(res["new_row_index"], 2)
        self._assert_contiguous()
        self.assertEqual(self._descs_in_order(),
                         ["P1", "L1a", "NEW", "P2", "L2a", "L2b"])
        self.assertEqual(self._links(), {**_SEED_LINKS, "NEW": "P1"})

    def test_create_above_as_root(self):
        res = template_create_row(
            template=self.template, sheet_name=_TSHEET,
            anchor_row_index=2, position="above",
            classification="preamble", parent_index=-1, description="NEW",
        )
        self.assertEqual(res["new_row_index"], 2)
        self._assert_contiguous()
        self.assertEqual(self._descs_in_order(),
                         ["P1", "L1a", "NEW", "P2", "L2a", "L2b"])
        self.assertEqual(self._links(), {**_SEED_LINKS, "NEW": "ROOT"})

    def test_create_remaps_parent_when_parent_shifts(self):
        # Parent NEW to P2 (idx2) while inserting ABOVE P2 -> P2 shifts to idx3; NEW.parent
        # must remap 2 -> 3 and still resolve to P2 by identity.
        template_create_row(
            template=self.template, sheet_name=_TSHEET,
            anchor_row_index=2, position="above",
            classification="line_item", parent_index=2, description="NEW",
        )
        self.assertEqual(self._links(), {**_SEED_LINKS, "NEW": "P2"})
        new_row = frappe.db.get_value(
            "BoQ Template Row",
            {"template": self.template, "sheet_name": _TSHEET, "description": "NEW"},
            ["row_index", "parent_index"], as_dict=True,
        )
        self.assertEqual(new_row.row_index, 2)
        self.assertEqual(new_row.parent_index, 3)

    def test_create_row_sentinels_and_defaults(self):
        template_create_row(
            template=self.template, sheet_name=_TSHEET,
            anchor_row_index=0, position="below",
            classification="preamble", parent_index=-1,
            description="NEW", unit="nos", make_model="ACME",
        )
        row = frappe.db.get_value(
            "BoQ Template Row",
            {"template": self.template, "sheet_name": _TSHEET, "description": "NEW"},
            ["parent_index", "attached_to_index", "is_rate_only", "unit", "make_model",
             "source_row_number", "level"], as_dict=True,
        )
        self.assertEqual(row.parent_index, -1)     # root -> -1 sentinel (never Int-default 0)
        self.assertEqual(row.attached_to_index, 0)  # not attached
        self.assertEqual(row.is_rate_only, 0)
        self.assertEqual(row.unit, "nos")
        self.assertEqual(row.make_model, "ACME")
        # Hand-built row has no source workbook row, but the positional recompute stamps it a
        # real Excel row (row_index 1 + offset 2 = 3); it is NEVER left at the crash-inducing 0.
        self.assertEqual(row.source_row_number, 3)

    def test_create_rejects_non_assignable_classification(self):
        with self.assertRaises(frappe.ValidationError):
            template_create_row(
                template=self.template, sheet_name=_TSHEET,
                anchor_row_index=0, position="below",
                classification="subtotal_marker", parent_index=-1,
            )

    def test_create_rejects_missing_anchor(self):
        with self.assertRaises(frappe.ValidationError):
            template_create_row(
                template=self.template, sheet_name=_TSHEET,
                anchor_row_index=99, position="below",
                classification="line_item", parent_index=-1,
            )

    def test_create_rejects_nonexistent_parent(self):
        with self.assertRaises(frappe.ValidationError):
            template_create_row(
                template=self.template, sheet_name=_TSHEET,
                anchor_row_index=0, position="below",
                classification="line_item", parent_index=42,
            )

    # -- delete: reverse renumber + orphan re-point -------------------------

    def test_delete_restores_indices_and_links(self):
        template_create_row(
            template=self.template, sheet_name=_TSHEET,
            anchor_row_index=1, position="below",
            classification="line_item", parent_index=0, description="NEW",
        )
        new_idx = frappe.db.get_value(
            "BoQ Template Row",
            {"template": self.template, "sheet_name": _TSHEET, "description": "NEW"},
            "row_index",
        )
        res = template_delete_row(
            template=self.template, sheet_name=_TSHEET, row_index=new_idx,
        )
        self.assertEqual(res["status"], "deleted")
        self._assert_contiguous()
        self.assertEqual(self._descs_in_order(), ["P1", "L1a", "P2", "L2a", "L2b"])
        self.assertEqual(self._links(), _SEED_LINKS)

    def test_delete_repoints_orphans_to_grandparent(self):
        # P1(root) -> MID(preamble, parent P1) -> C(line, parent MID). Delete MID -> C re-points
        # to P1 (tree continuity), never orphaned.
        self._seed_rows([
            (0, "P1", "preamble", -1),
            (1, "MID", "preamble", 0),
            (2, "C", "line_item", 1),
        ])
        frappe.db.commit()
        template_delete_row(template=self.template, sheet_name=_TSHEET, row_index=1)
        self._assert_contiguous()
        self.assertEqual(self._descs_in_order(), ["P1", "C"])
        self.assertEqual(self._links(), {"P1": "ROOT", "C": "P1"})

    def test_delete_root_makes_children_roots(self):
        self._seed_rows([
            (0, "ROOTP", "preamble", -1),
            (1, "C1", "line_item", 0),
            (2, "C2", "line_item", 0),
        ])
        frappe.db.commit()
        template_delete_row(template=self.template, sheet_name=_TSHEET, row_index=0)
        self._assert_contiguous()
        self.assertEqual(self._links(), {"C1": "ROOT", "C2": "ROOT"})

    def test_delete_rejects_missing_row(self):
        with self.assertRaises(frappe.ValidationError):
            template_delete_row(template=self.template, sheet_name=_TSHEET, row_index=99)

    # -- source_row_number ("Excel Row") positional recompute ---------------
    # Regression for the row_number=0 bug: a hand-built row (create) landed with
    # source_row_number None -> Int 0, existing rows were never shifted, and the from-scratch
    # priced export HARD-CRASHED (openpyxl rejects row 0). The recompute pass wired into both
    # endpoints re-derives srn = row_index + offset for the whole sheet after every edit.
    # Seed carries source_row_number = row_index + 2 (offset 2), the real header_row=1 shape.

    def test_create_middle_recomputes_source_rows(self):
        # Insert BELOW anchor 1 -> insertion_index 2; the new row (srn None->0) and the shifted
        # rows are all renumbered. No 0 survives; numbering stays contiguous.
        template_create_row(
            template=self.template, sheet_name=_TSHEET,
            anchor_row_index=1, position="below",
            classification="line_item", parent_index=0, description="NEW",
        )
        self._assert_contiguous()
        self._assert_srn_ok()
        # The insert keeps the sheet's offset (2) STABLE (it must not erode) -> [2..7].
        self.assertEqual(self._srns(), [2, 3, 4, 5, 6, 7])
        new_srn = frappe.db.get_value(
            "BoQ Template Row",
            {"template": self.template, "sheet_name": _TSHEET, "description": "NEW"},
            "source_row_number",
        )
        self.assertEqual(new_srn, 4)   # the once-0 new row (row_index 2) now carries Excel row 4

    def test_create_above_recomputes_source_rows(self):
        template_create_row(
            template=self.template, sheet_name=_TSHEET,
            anchor_row_index=2, position="above",
            classification="preamble", parent_index=-1, description="NEW",
        )
        self._assert_contiguous()
        self._assert_srn_ok()
        new_srn = frappe.db.get_value(
            "BoQ Template Row",
            {"template": self.template, "sheet_name": _TSHEET, "description": "NEW"},
            "source_row_number",
        )
        self.assertGreater(new_srn, 0)

    def test_create_at_end_recomputes_source_rows(self):
        # Insert BELOW the last row (anchor 4) -> insertion_index 5. No existing row shifts, so
        # the offset (2) is preserved and the new tail row gets the next Excel row.
        template_create_row(
            template=self.template, sheet_name=_TSHEET,
            anchor_row_index=4, position="below",
            classification="line_item", parent_index=-1, description="NEW",
        )
        self._assert_contiguous()
        self._assert_srn_ok()
        self.assertEqual(self._srns(), [2, 3, 4, 5, 6, 7])
        new_srn = frappe.db.get_value(
            "BoQ Template Row",
            {"template": self.template, "sheet_name": _TSHEET, "description": "NEW"},
            "source_row_number",
        )
        self.assertEqual(new_srn, 7)

    def test_delete_recomputes_source_rows(self):
        # Delete P2 (row 2). Reverse-renumber then recompute -> contiguous, zero-free.
        template_delete_row(template=self.template, sheet_name=_TSHEET, row_index=2)
        self._assert_contiguous()
        self._assert_srn_ok()
        self.assertEqual(self._srns(), [2, 3, 4, 5])

    def test_create_then_delete_never_leaves_zero_srn(self):
        # Full round-trip: create a middle row (would-be srn 0) then delete it -> at no point
        # does a persisted row keep source_row_number 0.
        template_create_row(
            template=self.template, sheet_name=_TSHEET,
            anchor_row_index=1, position="below",
            classification="line_item", parent_index=0, description="NEW",
        )
        self._assert_srn_ok()
        new_idx = frappe.db.get_value(
            "BoQ Template Row",
            {"template": self.template, "sheet_name": _TSHEET, "description": "NEW"},
            "row_index",
        )
        template_delete_row(template=self.template, sheet_name=_TSHEET, row_index=new_idx)
        self._assert_contiguous()
        self._assert_srn_ok()

    def test_two_consecutive_middle_inserts_offset_stays_stable(self):
        # REGRESSION: two interior inserts must NOT erode the sheet offset. The pre-fix formula
        # derived the offset from post-shift rows and dropped it by 1 per insert -> a real row
        # back at source_row_number 0 (which crashes the openpyxl priced export). Offset holds.
        for i in range(2):
            template_create_row(
                template=self.template, sheet_name=_TSHEET,
                anchor_row_index=1, position="below",
                classification="line_item", parent_index=0, description=f"NEW{i}",
            )
            self._assert_srn_ok()
        # 5 seed rows + 2 inserts, offset held at 2 -> contiguous [2..8].
        self.assertEqual(self._srns(), [2, 3, 4, 5, 6, 7, 8])

    # -- edit: field patch + reparent validation ----------------------------

    def test_edit_patches_content_fields(self):
        l1a = frappe.db.get_value(
            "BoQ Template Row",
            {"template": self.template, "sheet_name": _TSHEET, "description": "L1a"}, "name",
        )
        res = template_edit_row(
            row_name=l1a, description="L1a edited", unit="Rmt",
            make_model="XYZ", classification="preamble",
        )
        self.assertEqual(res["status"], "saved")
        row = frappe.db.get_value(
            "BoQ Template Row", l1a,
            ["description", "unit", "make_model", "classification"], as_dict=True,
        )
        self.assertEqual(row.description, "L1a edited")
        self.assertEqual(row.unit, "Rmt")
        self.assertEqual(row.make_model, "XYZ")
        self.assertEqual(row.classification, "preamble")
        # provenance stamped on the master.
        self.assertTrue(frappe.db.get_value("BoQ Template", self.template, "last_updated_on"))

    def test_edit_reparent_valid(self):
        # Reparent L1a (idx1) from P1 (idx0) to P2 (idx2).
        l1a = frappe.db.get_value(
            "BoQ Template Row",
            {"template": self.template, "sheet_name": _TSHEET, "description": "L1a"}, "name",
        )
        template_edit_row(row_name=l1a, parent_index=2)
        self.assertEqual(self._links()["L1a"], "P2")

    def test_edit_reparent_to_root(self):
        l1a = frappe.db.get_value(
            "BoQ Template Row",
            {"template": self.template, "sheet_name": _TSHEET, "description": "L1a"}, "name",
        )
        template_edit_row(row_name=l1a, parent_index=-1)
        self.assertEqual(self._links()["L1a"], "ROOT")

    def test_edit_reparent_rejects_nonexistent(self):
        l1a = frappe.db.get_value(
            "BoQ Template Row",
            {"template": self.template, "sheet_name": _TSHEET, "description": "L1a"}, "name",
        )
        with self.assertRaises(frappe.ValidationError):
            template_edit_row(row_name=l1a, parent_index=42)

    def test_edit_reparent_rejects_self(self):
        l1a = frappe.db.get_value(
            "BoQ Template Row",
            {"template": self.template, "sheet_name": _TSHEET, "description": "L1a"},
            ["name", "row_index"], as_dict=True,
        )
        with self.assertRaises(frappe.ValidationError):
            template_edit_row(row_name=l1a.name, parent_index=l1a.row_index)

    def test_edit_rejects_missing_row(self):
        with self.assertRaises(frappe.ValidationError):
            template_edit_row(row_name="NO-SUCH-ROW", description="x")

    # -- sheet ops ----------------------------------------------------------

    def test_add_sheet_appends_with_next_order(self):
        res = template_add_sheet(
            template=self.template, sheet_name="Sheet 2",
            sheet_label="Electrical", disposition="data",
        )
        self.assertEqual(res["status"], "saved")
        self.assertEqual(res["sheet_order"], 2)  # TSheet is 1
        sheets = self._sheets()
        names = [s.sheet_name for s in sheets]
        self.assertEqual(names, [_TSHEET, "Sheet 2"])
        s2 = next(s for s in sheets if s.sheet_name == "Sheet 2")
        self.assertEqual(s2.sheet_label, "Electrical")
        self.assertEqual(s2.disposition, "data")
        # default single-area config landed as a dict.
        cfg = s2.sheet_config
        if isinstance(cfg, str):
            cfg = json.loads(cfg)
        self.assertIn("column_role_map", cfg)

    def test_add_sheet_rejects_duplicate(self):
        with self.assertRaises(frappe.ValidationError):
            template_add_sheet(template=self.template, sheet_name=_TSHEET)

    def test_add_sheet_rejects_bad_disposition(self):
        with self.assertRaises(frappe.ValidationError):
            template_add_sheet(
                template=self.template, sheet_name="Sheet X", disposition="bogus",
            )

    def test_remove_sheet_deletes_child_and_rows(self):
        template_add_sheet(template=self.template, sheet_name="Sheet 2")
        # seed one row on Sheet 2 so we can assert row removal.
        d = frappe.new_doc("BoQ Template Row")
        d.update({"template": self.template, "sheet_name": "Sheet 2", "row_index": 0,
                  "classification": "line_item", "description": "S2R", "parent_index": -1,
                  "attached_to_index": 0})
        d.insert(ignore_permissions=True)
        frappe.db.commit()

        res = template_remove_sheet(template=self.template, sheet_name="Sheet 2")
        self.assertEqual(res["status"], "deleted")
        self.assertEqual([s.sheet_name for s in self._sheets()], [_TSHEET])
        self.assertEqual(
            frappe.db.count("BoQ Template Row",
                            {"template": self.template, "sheet_name": "Sheet 2"}),
            0,
        )
        # TSheet rows untouched.
        self.assertEqual(len(self._rows()), 5)

    def test_remove_sheet_rejects_missing(self):
        with self.assertRaises(frappe.ValidationError):
            template_remove_sheet(template=self.template, sheet_name="No Such Sheet")

    def test_reorder_sheets(self):
        template_add_sheet(template=self.template, sheet_name="Sheet 2")
        template_add_sheet(template=self.template, sheet_name="Sheet 3")
        # Reverse the order.
        res = template_reorder_sheets(
            template=self.template,
            ordered_sheet_names=["Sheet 3", "Sheet 2", _TSHEET],
        )
        self.assertEqual(res["status"], "saved")
        sheets = self._sheets()  # ordered by sheet_order asc
        self.assertEqual([s.sheet_name for s in sheets], ["Sheet 3", "Sheet 2", _TSHEET])
        self.assertEqual([s.sheet_order for s in sheets], [1, 2, 3])

    def test_reorder_accepts_json_string(self):
        template_add_sheet(template=self.template, sheet_name="Sheet 2")
        template_reorder_sheets(
            template=self.template,
            ordered_sheet_names=json.dumps(["Sheet 2", _TSHEET]),
        )
        self.assertEqual([s.sheet_name for s in self._sheets()], ["Sheet 2", _TSHEET])

    def test_reorder_rejects_unknown_sheet(self):
        with self.assertRaises(frappe.ValidationError):
            template_reorder_sheets(
                template=self.template, ordered_sheet_names=[_TSHEET, "Ghost"],
            )

    def test_reorder_rejects_subset(self):
        # A partial list (omitting a sheet) would leave a stale sheet_order colliding with the
        # reassigned 1..N -> reject as an incomplete permutation (adversarial finding).
        template_add_sheet(template=self.template, sheet_name="Sheet 2")
        template_add_sheet(template=self.template, sheet_name="Sheet 3")
        with self.assertRaises(frappe.ValidationError):
            template_reorder_sheets(
                template=self.template, ordered_sheet_names=["Sheet 3", "Sheet 2"],
            )

    def test_reorder_rejects_duplicate(self):
        template_add_sheet(template=self.template, sheet_name="Sheet 2")
        with self.assertRaises(frappe.ValidationError):
            template_reorder_sheets(
                template=self.template, ordered_sheet_names=[_TSHEET, _TSHEET],
            )

    def test_edit_row_rejects_reparent_cycle(self):
        # Reparent P1 (row 0) under its OWN child L1a (row 1) -> would loop (adversarial: the
        # editor must have the create-flow's cycle guard). The tree must stay unchanged.
        by_idx = {r.row_index: r for r in self._rows()}
        with self.assertRaises(frappe.ValidationError):
            template_edit_row(row_name=by_idx[0].name, parent_index=1)
        self.assertEqual(self._links()["P1"], "ROOT")

    def test_get_template_rows(self):
        res = get_template_rows(template=self.template, sheet_name=_TSHEET)
        rows = res["rows"]
        self.assertEqual([r.row_index for r in rows], [0, 1, 2, 3, 4])
        self.assertEqual([r.description for r in rows], ["P1", "L1a", "P2", "L2a", "L2b"])
        self.assertEqual([r.parent_index for r in rows], [-1, 0, -1, 2, 2])

    def test_set_sheet_wp_stores_list(self):
        res = template_set_sheet_wp(
            template=self.template, sheet_name=_TSHEET,
            work_headers=["WH_A", "WH_B"],
        )
        self.assertEqual(res["status"], "saved")
        self.assertEqual(res["work_packages"], ["WH_A", "WH_B"])
        stored = frappe.db.get_value(
            "BoQ Template Sheet",
            {"parent": self.template, "parenttype": "BoQ Template", "sheet_name": _TSHEET},
            "work_packages",
        )
        if isinstance(stored, str):
            stored = json.loads(stored)
        self.assertEqual(stored, ["WH_A", "WH_B"])

    def test_set_sheet_wp_accepts_json_string_and_clears(self):
        template_set_sheet_wp(
            template=self.template, sheet_name=_TSHEET,
            work_headers=json.dumps(["WH_A"]),
        )
        # Now clear.
        res = template_set_sheet_wp(
            template=self.template, sheet_name=_TSHEET, work_headers=[],
        )
        self.assertEqual(res["work_packages"], [])
        stored = frappe.db.get_value(
            "BoQ Template Sheet",
            {"parent": self.template, "parenttype": "BoQ Template", "sheet_name": _TSHEET},
            "work_packages",
        )
        if isinstance(stored, str):
            stored = json.loads(stored)
        self.assertEqual(stored, [])

    def test_set_sheet_wp_rejects_missing_sheet(self):
        with self.assertRaises(frappe.ValidationError):
            template_set_sheet_wp(
                template=self.template, sheet_name="Ghost", work_headers=["WH_A"],
            )

    # -- role gate ----------------------------------------------------------

    def test_role_gate_rejects_non_editor(self):
        original = frappe.session.user
        try:
            frappe.set_user("Guest")  # no Nirmaan Users row -> role_profile None
            with self.assertRaises(frappe.PermissionError):
                template_create_row(
                    template=self.template, sheet_name=_TSHEET,
                    anchor_row_index=0, position="below",
                    classification="line_item", parent_index=0, description="NEW",
                )
        finally:
            frappe.set_user(original)
        # Role gate runs FIRST -> nothing mutated.
        self.assertEqual(self._descs_in_order(), ["P1", "L1a", "P2", "L2a", "L2b"])

    def test_role_gate_rejects_non_editor_on_sheet_op(self):
        original = frappe.session.user
        try:
            frappe.set_user("Guest")
            with self.assertRaises(frappe.PermissionError):
                template_add_sheet(template=self.template, sheet_name="Sheet 2")
        finally:
            frappe.set_user(original)
        self.assertEqual([s.sheet_name for s in self._sheets()], [_TSHEET])
