# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""
Tests for template_rows.create_review_row / delete_review_row (ADR-0013 D6, task T4).

The load-bearing invariant these tests defend is IDENTITY PRESERVATION across the
renumber: after an insert or delete rewrites the row_index keyspace, every parent link
(resolved by row identity, NOT by raw index) must be exactly what it was, and the index
space must stay contiguous 0..N-1 in the original visual order.

Fixture sheet "TSheet" (5 rows, two little groups):
    idx0  P1   preamble  root
    idx1  L1a  line_item parent P1 (idx0)
    idx2  P2   preamble  root
    idx3  L2a  line_item parent P2 (idx2)
    idx4  L2b  line_item parent P2 (idx2)
Descriptions are unique, so a description->parent-description map is a stable identity
view of the tree that survives renumbering.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.template_rows import (
    create_review_row,
    delete_review_row,
)

_TSHEET = "TSheet"

# (row_index, description, classification, parent_index) for the template-origin fixture.
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


def _make_project():
    proj = frappe.new_doc("Projects")
    proj.project_name = f"TEST_TPLROWS_{frappe.generate_hash(length=6)}"
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj


class TestTemplateRows(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()

        # Template-origin BoQ (create/delete allowed).
        tpl = frappe.new_doc("BOQs")
        tpl.project = cls.test_project.name
        tpl.boq_name = "Template Rows Test BoQ"
        tpl.tax_treatment = "Pre-tax"
        tpl.origin = "template"          # read_only in UI; settable in Python
        tpl.append("sheet_drafts", {
            "sheet_name": _TSHEET, "sheet_order": 1, "wizard_status": "Parsed",
        })
        tpl.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.tpl_boq = tpl.name

        # Upload-origin BoQ (create/delete must be REFUSED). origin defaults to "upload".
        up = frappe.new_doc("BOQs")
        up.project = cls.test_project.name
        up.boq_name = "Upload Origin Test BoQ"
        up.tax_treatment = "Pre-tax"
        up.append("sheet_drafts", {
            "sheet_name": _TSHEET, "sheet_order": 1, "wizard_status": "Parsed",
        })
        up.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.upload_boq = up.name

    @classmethod
    def tearDownClass(cls):
        for b in frappe.get_all("BOQs", filters={"project": cls.test_project.name}, fields=["name"]):
            frappe.db.delete("BoQ Review Row", {"boq": b.name})
            frappe.db.delete("BoQ Sheet Pricing Lock", {"boq": b.name})
            frappe.delete_doc("BOQs", b.name, force=True, ignore_permissions=True)
        frappe.delete_doc("Projects", cls.test_project.name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        self._seed(self.tpl_boq)
        self._seed(self.upload_boq)
        frappe.db.commit()

    # -- fixtures / helpers -------------------------------------------------

    def _seed(self, boq, overrides=None):
        """Recreate the 5-row fixture on TSheet for `boq`. `overrides` maps
        description -> dict of extra field values (e.g. a human_parent override)."""
        overrides = overrides or {}
        frappe.db.delete("BoQ Review Row", {"boq": boq, "sheet_name": _TSHEET})
        for ridx, desc, cls_, parent in _SEED:
            doc = frappe.new_doc("BoQ Review Row")
            doc.update({
                "boq": boq,
                "sheet_name": _TSHEET,
                "row_index": ridx,
                "source_row_number": ridx + 2,
                "classification": cls_,
                "description": desc,
                "parent_index": parent,
                "human_parent": -1,
                "human_is_root": 0,
                "is_synthetic": 0,   # seed rows are template/parser rows
                "is_excluded": 0,
            })
            doc.update(overrides.get(desc, {}))
            doc.insert(ignore_permissions=True)

    def _rows(self, boq, sheet=_TSHEET):
        return frappe.db.get_all(
            "BoQ Review Row",
            filters={"boq": boq, "sheet_name": sheet},
            fields=["row_index", "parent_index", "human_parent", "description",
                    "is_synthetic", "is_excluded", "classification"],
            order_by="row_index asc",
        )

    def _links(self, boq, channel="parent_index"):
        """description -> parent-description via the given pointer channel (identity view)."""
        rows = self._rows(boq)
        by_idx = {r.row_index: r for r in rows}
        links = {}
        for r in rows:
            p = r.get(channel)
            links[r.description] = "ROOT" if (p is None or p < 0) else by_idx[p].description
        return links

    def _indices(self, boq):
        return [r.row_index for r in self._rows(boq)]

    def _descs_in_order(self, boq):
        return [r.description for r in self._rows(boq)]

    def _assert_contiguous(self, boq):
        idxs = self._indices(boq)
        self.assertEqual(idxs, list(range(len(idxs))),
                         f"row_index must be contiguous 0..N-1, got {idxs}")

    # -- create: order + parent-link preservation ---------------------------

    def test_insert_below_preserves_order_and_links(self):
        # Insert a NEW line item below L1a (idx1), parented to P1 (idx0).
        res = create_review_row(
            boq_name=self.tpl_boq, sheet_name=_TSHEET,
            anchor_row_index=1, position="below",
            classification="line_item", parent_index=0,
            description="NEW",
        )
        self.assertEqual(res["status"], "saved")
        self.assertEqual(res["new_row_index"], 2)  # below idx1 -> insertion_index 2

        self._assert_contiguous(self.tpl_boq)
        # Visual order: NEW lands between L1a and P2.
        self.assertEqual(self._descs_in_order(self.tpl_boq),
                         ["P1", "L1a", "NEW", "P2", "L2a", "L2b"])
        # EVERY original link preserved by identity + the new row parented to P1.
        expected = {**_SEED_LINKS, "NEW": "P1"}
        self.assertEqual(self._links(self.tpl_boq), expected)

    def test_insert_above_preserves_order_and_links(self):
        # Insert a NEW preamble above P2 (idx2), as a root.
        res = create_review_row(
            boq_name=self.tpl_boq, sheet_name=_TSHEET,
            anchor_row_index=2, position="above",
            classification="preamble", parent_index=-1,
            description="NEW",
        )
        self.assertEqual(res["new_row_index"], 2)  # above idx2 -> insertion_index 2

        self._assert_contiguous(self.tpl_boq)
        self.assertEqual(self._descs_in_order(self.tpl_boq),
                         ["P1", "L1a", "NEW", "P2", "L2a", "L2b"])
        expected = {**_SEED_LINKS, "NEW": "ROOT"}
        self.assertEqual(self._links(self.tpl_boq), expected)

    def test_insert_at_end_below_last_row(self):
        res = create_review_row(
            boq_name=self.tpl_boq, sheet_name=_TSHEET,
            anchor_row_index=4, position="below",
            classification="line_item", parent_index=2,
            description="NEW",
        )
        self.assertEqual(res["new_row_index"], 5)  # appended at the tail
        self._assert_contiguous(self.tpl_boq)
        self.assertEqual(self._descs_in_order(self.tpl_boq),
                         ["P1", "L1a", "P2", "L2a", "L2b", "NEW"])
        self.assertEqual(self._links(self.tpl_boq), {**_SEED_LINKS, "NEW": "P2"})

    def test_new_row_parent_remapped_when_parent_shifts(self):
        # Parent the NEW row to P2 (idx2) while inserting ABOVE P2 (insertion_index 2).
        # P2 shifts to idx3, so the new row's stored parent_index must remap 2 -> 3 and
        # still resolve to P2 by identity.
        create_review_row(
            boq_name=self.tpl_boq, sheet_name=_TSHEET,
            anchor_row_index=2, position="above",
            classification="line_item", parent_index=2,
            description="NEW",
        )
        self.assertEqual(self._links(self.tpl_boq), {**_SEED_LINKS, "NEW": "P2"})
        new_row = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.tpl_boq, "sheet_name": _TSHEET, "description": "NEW"},
            ["row_index", "parent_index"], as_dict=True,
        )
        self.assertEqual(new_row.row_index, 2)
        self.assertEqual(new_row.parent_index, 3)  # remapped through the shift

    def test_insert_remaps_human_parent_pointer(self):
        # Give L1a a human_parent override pointing at L2a (idx3). Insert above P2
        # (insertion_index 2): L2a shifts 3 -> 4, so L1a.human_parent must remap 3 -> 4
        # and still resolve to L2a by identity.
        self._seed(self.tpl_boq, overrides={"L1a": {"human_parent": 3}})
        frappe.db.commit()
        create_review_row(
            boq_name=self.tpl_boq, sheet_name=_TSHEET,
            anchor_row_index=2, position="above",
            classification="note", parent_index=-1,
            description="NEW",
        )
        human_links = self._links(self.tpl_boq, channel="human_parent")
        self.assertEqual(human_links["L1a"], "L2a")  # override survives the renumber
        l1a = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.tpl_boq, "sheet_name": _TSHEET, "description": "L1a"},
            "human_parent",
        )
        self.assertEqual(l1a, 4)

    def test_new_row_flags_synthetic_selected_no_source(self):
        create_review_row(
            boq_name=self.tpl_boq, sheet_name=_TSHEET,
            anchor_row_index=0, position="below",
            classification="line_item", parent_index=0,
            description="NEW", unit="nos",
        )
        row = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.tpl_boq, "sheet_name": _TSHEET, "description": "NEW"},
            ["is_synthetic", "is_excluded", "human_parent", "unit",
             "chosen_source", "source_row_number"], as_dict=True,
        )
        self.assertEqual(row.is_synthetic, 1)     # user-created -> deletable
        self.assertEqual(row.is_excluded, 0)      # auto-selected
        self.assertEqual(row.human_parent, -1)    # no human override
        self.assertEqual(row.unit, "nos")
        self.assertEqual(row.chosen_source, "parser")

    # -- create: validation -------------------------------------------------

    def test_create_rejects_non_assignable_classification(self):
        with self.assertRaises(frappe.ValidationError):
            create_review_row(
                boq_name=self.tpl_boq, sheet_name=_TSHEET,
                anchor_row_index=0, position="below",
                classification="subtotal_marker", parent_index=-1,
            )

    def test_create_rejects_bad_position(self):
        with self.assertRaises(frappe.ValidationError):
            create_review_row(
                boq_name=self.tpl_boq, sheet_name=_TSHEET,
                anchor_row_index=0, position="sideways",
                classification="line_item", parent_index=-1,
            )

    def test_create_rejects_missing_anchor(self):
        with self.assertRaises(frappe.ValidationError):
            create_review_row(
                boq_name=self.tpl_boq, sheet_name=_TSHEET,
                anchor_row_index=99, position="below",
                classification="line_item", parent_index=-1,
            )

    def test_create_rejects_nonexistent_parent(self):
        with self.assertRaises(frappe.ValidationError):
            create_review_row(
                boq_name=self.tpl_boq, sheet_name=_TSHEET,
                anchor_row_index=0, position="below",
                classification="line_item", parent_index=42,
            )

    def test_create_refuses_upload_origin(self):
        with self.assertRaises(frappe.ValidationError):
            create_review_row(
                boq_name=self.upload_boq, sheet_name=_TSHEET,
                anchor_row_index=0, position="below",
                classification="line_item", parent_index=0,
            )
        # And nothing was mutated on the upload BoQ.
        self.assertEqual(self._descs_in_order(self.upload_boq),
                         ["P1", "L1a", "P2", "L2a", "L2b"])

    # -- delete: reverse renumber + link continuity -------------------------

    def test_delete_synthetic_restores_indices_and_links(self):
        # Insert then delete the same synthetic row -> back to the pristine fixture.
        create_review_row(
            boq_name=self.tpl_boq, sheet_name=_TSHEET,
            anchor_row_index=1, position="below",
            classification="line_item", parent_index=0,
            description="NEW",
        )
        new_idx = frappe.db.get_value(
            "BoQ Review Row",
            {"boq": self.tpl_boq, "sheet_name": _TSHEET, "description": "NEW"},
            "row_index",
        )
        res = delete_review_row(
            boq_name=self.tpl_boq, sheet_name=_TSHEET, row_index=new_idx,
        )
        self.assertEqual(res["status"], "deleted")
        self._assert_contiguous(self.tpl_boq)
        self.assertEqual(self._descs_in_order(self.tpl_boq),
                         ["P1", "L1a", "P2", "L2a", "L2b"])
        self.assertEqual(self._links(self.tpl_boq), _SEED_LINKS)

    def test_delete_repoints_orphaned_children_to_grandparent(self):
        # Build: P1(root) -> MID(synthetic preamble, parent P1) -> C(line, parent MID).
        # Deleting MID must re-point C to P1 (tree continuity), not orphan it.
        frappe.db.delete("BoQ Review Row", {"boq": self.tpl_boq, "sheet_name": _TSHEET})
        seed = [
            (0, "P1", "preamble", -1, 0),
            (1, "MID", "preamble", 0, 1),   # synthetic
            (2, "C", "line_item", 1, 0),
        ]
        for ridx, desc, cls_, parent, synth in seed:
            d = frappe.new_doc("BoQ Review Row")
            d.update({
                "boq": self.tpl_boq, "sheet_name": _TSHEET, "row_index": ridx,
                "classification": cls_, "description": desc, "parent_index": parent,
                "human_parent": -1, "human_is_root": 0, "is_synthetic": synth,
                "is_excluded": 0,
            })
            d.insert(ignore_permissions=True)
        frappe.db.commit()

        delete_review_row(boq_name=self.tpl_boq, sheet_name=_TSHEET, row_index=1)

        self._assert_contiguous(self.tpl_boq)
        self.assertEqual(self._descs_in_order(self.tpl_boq), ["P1", "C"])
        # C re-pointed from MID up to P1 (grandparent).
        self.assertEqual(self._links(self.tpl_boq), {"P1": "ROOT", "C": "P1"})

    def test_delete_root_synthetic_makes_children_roots(self):
        # A synthetic ROOT (parent -1) deleted -> its children become roots.
        frappe.db.delete("BoQ Review Row", {"boq": self.tpl_boq, "sheet_name": _TSHEET})
        seed = [
            (0, "ROOTSYN", "preamble", -1, 1),  # synthetic root
            (1, "C1", "line_item", 0, 0),
            (2, "C2", "line_item", 0, 0),
        ]
        for ridx, desc, cls_, parent, synth in seed:
            d = frappe.new_doc("BoQ Review Row")
            d.update({
                "boq": self.tpl_boq, "sheet_name": _TSHEET, "row_index": ridx,
                "classification": cls_, "description": desc, "parent_index": parent,
                "human_parent": -1, "human_is_root": 0, "is_synthetic": synth,
                "is_excluded": 0,
            })
            d.insert(ignore_permissions=True)
        frappe.db.commit()

        delete_review_row(boq_name=self.tpl_boq, sheet_name=_TSHEET, row_index=0)
        self._assert_contiguous(self.tpl_boq)
        self.assertEqual(self._links(self.tpl_boq), {"C1": "ROOT", "C2": "ROOT"})

    def test_delete_refuses_non_synthetic(self):
        # L1a (idx1) is a template/parser row (is_synthetic=0) -> delete must throw.
        with self.assertRaises(frappe.ValidationError):
            delete_review_row(boq_name=self.tpl_boq, sheet_name=_TSHEET, row_index=1)
        # Untouched.
        self.assertEqual(self._descs_in_order(self.tpl_boq),
                         ["P1", "L1a", "P2", "L2a", "L2b"])
        self.assertEqual(self._links(self.tpl_boq), _SEED_LINKS)

    def test_delete_refuses_missing_row(self):
        with self.assertRaises(frappe.ValidationError):
            delete_review_row(boq_name=self.tpl_boq, sheet_name=_TSHEET, row_index=99)

    def test_delete_refuses_upload_origin(self):
        # Even a (hypothetically) synthetic row on an upload BoQ is refused at the origin gate.
        frappe.db.set_value(
            "BoQ Review Row",
            {"boq": self.upload_boq, "sheet_name": _TSHEET, "row_index": 4},
            "is_synthetic", 1,
        )
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError):
            delete_review_row(boq_name=self.upload_boq, sheet_name=_TSHEET, row_index=4)
        self.assertEqual(self._descs_in_order(self.upload_boq),
                         ["P1", "L1a", "P2", "L2a", "L2b"])
