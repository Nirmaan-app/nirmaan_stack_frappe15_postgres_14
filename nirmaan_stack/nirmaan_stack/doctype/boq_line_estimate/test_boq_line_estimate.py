# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""The shape of BOQ Line Estimate and its item rows, as the site has them (meta AND database), so a site that was not
migrated after this branch fails here by name instead of misbehaving later. Reads only: no record is written.

Owner rulings pinned: one estimate per BOQ line item; a material row keeps item, category, package and make as plain
text, not links (2026-11-11: deleting an Items record never blocks or breaks an estimate); `settled` is a hidden,
read-only flag set by the server (2026-11-12, option B). The behaviour lives in `api/estimations/test_*`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

PARENT = "BOQ Line Estimate"
CHILD = "BOQ Line Estimate Item"


def _column_type(doctype: str, column: str) -> str | None:
    row = frappe.db.sql(
        """select data_type from information_schema.columns
           where table_schema = current_schema() and table_name = %s and column_name = %s""",
        (f"tab{doctype}", column))
    return row[0][0] if row else None


def _index_def(index_name: str) -> str | None:
    row = frappe.db.sql("select indexdef from pg_indexes where indexname = %s", (index_name,))
    return row[0][0] if row else None


class TestBOQLineEstimate(FrappeTestCase):
    def test_both_doctypes_live_in_the_nirmaan_stack_module(self):
        self.assertEqual(frappe.db.get_value("DocType", PARENT, "module"), "Nirmaan Stack")
        self.assertEqual(frappe.db.get_value("DocType", CHILD, ["module", "istable"]), ("Nirmaan Stack", 1))

    def test_one_estimate_per_line_item(self):
        field = frappe.get_meta(PARENT).get_field("boq_node")
        self.assertEqual((field.fieldtype, field.options, field.reqd, field.unique), ("Link", "BOQ Nodes", 1, 1))
        unique = frappe.db.sql(
            """select indexdef from pg_indexes where tablename = %s and indexdef ilike 'create unique index%%'
               and indexdef ilike '%%(boq_node)%%'""", (f"tab{PARENT}",))
        self.assertTrue(unique, "no unique index on boq_node in the database")

    def test_boq_and_sheet_are_filled_by_the_server_and_indexed(self):
        meta = frappe.get_meta(PARENT)
        for fieldname, target, index in (("boq", "BOQs", "BOQ_Line_Estimate_boq_idx"),
                                         ("boq_sheet", "BoQ Sheet", "BOQ_Line_Estimate_boq_sheet_idx")):
            with self.subTest(field=fieldname):
                field = meta.get_field(fieldname)
                self.assertEqual((field.fieldtype, field.options, field.read_only), ("Link", target, 1))
                self.assertIsNotNone(_index_def(index), f"index {index} missing")
        self.assertIsNotNone(_index_def("BOQ_Line_Estimate_Item_parent_idx"), "child rows have no parent index")

    def test_item_count_and_settled_are_read_only(self):
        meta = frappe.get_meta(PARENT)
        count = meta.get_field("item_count")
        self.assertEqual((count.fieldtype, count.read_only), ("Int", 1))
        settled = meta.get_field("settled")
        self.assertEqual((settled.fieldtype, settled.hidden, settled.read_only, str(settled.default)), ("Check", 1, 1, "0"))
        self.assertIsNotNone(_column_type(PARENT, "settled"), "the settled column is not in the database (migrate)")

    def test_material_rows_hold_text_not_links(self):
        meta = frappe.get_meta(CHILD)
        for fieldname in ("item_id", "category", "procurement_package", "make", "unit"):
            with self.subTest(field=fieldname):
                self.assertEqual(meta.get_field(fieldname).fieldtype, "Data")
                self.assertIn(_column_type(CHILD, fieldname), ("character varying", "text"))
        self.assertFalse([f.fieldname for f in meta.fields if f.fieldtype in ("Link", "Dynamic Link")])

    def test_a_row_is_normal_or_custom_and_needs_a_quantity(self):
        meta = frappe.get_meta(CHILD)
        item_type = meta.get_field("item_type")
        self.assertEqual((item_type.options.split("\n"), item_type.default, item_type.reqd), (["Normal", "Custom"], "Normal", 1))
        quantity = meta.get_field("quantity")
        self.assertEqual((quantity.fieldtype, quantity.reqd), ("Float", 1))

    def test_changes_are_tracked(self):
        self.assertEqual(frappe.get_meta(PARENT).track_changes, 1)
