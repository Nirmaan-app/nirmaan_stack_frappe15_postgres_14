"""IS_SET custom aggregate (data-table aggregates) -- counts filled vs empty rows of any field.

Runs against ToDo (no project hooks). Every row it creates is deleted in tearDown.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.data_table.aggregations import get_aggregates
from nirmaan_stack.api.data_table.utils import _build_safe_sql_expression


class TestIsSetAggregate(FrappeTestCase):
	def setUp(self):
		self.names = []
		# 2 filled, 1 NULL, 1 blank "" (what the UI leaves after clearing an Attach field).
		for ref in ("REF-A", "REF-B", None, ""):
			doc = frappe.get_doc({"doctype": "ToDo", "description": "is_set test"})
			doc.insert(ignore_permissions=True)
			# Raw write on purpose: skips the Dynamic Link check; ToDo carries no doc_events we rely on.
			frappe.db.set_value("ToDo", doc.name, "reference_name", ref, update_modified=False)
			self.names.append(doc.name)

	def tearDown(self):
		for name in self.names:
			frappe.delete_doc("ToDo", name, force=True, ignore_permissions=True)

	def _agg(self, config):
		return get_aggregates("ToDo", self.names, json.dumps(config))

	def test_is_set_counts_filled_rows_only(self):
		res = self._agg([{"alias": "filled", "aggregate": "SUM",
						  "expression": {"function": "IS_SET", "args": ["reference_name"]}}])
		self.assertEqual(int(res["filled"]), 2)

	def test_is_set_nests_inside_multiply(self):
		res = self._agg([{"alias": "weighted", "aggregate": "SUM",
						  "expression": {"function": "MULTIPLY",
										 "args": [10, {"function": "IS_SET", "args": ["reference_name"]}]}}])
		self.assertEqual(float(res["weighted"]), 20.0)

	def test_existing_simple_aggregate_unchanged(self):
		res = self._agg([{"field": "reference_name", "function": "count"}])
		# COUNT counts non-NULL, so the blank "" row is counted -- this is exactly why IS_SET exists.
		self.assertEqual(int(res["count_of_reference_name"]), 3)

	def test_is_set_refuses_unknown_field(self):
		meta = frappe.get_meta("ToDo")
		with self.assertRaises(frappe.ValidationError):
			_build_safe_sql_expression({"function": "IS_SET", "args": ["no_such_field"]}, meta)

	def test_is_set_refuses_wrong_arity(self):
		meta = frappe.get_meta("ToDo")
		with self.assertRaises(frappe.ValidationError):
			_build_safe_sql_expression({"function": "IS_SET", "args": ["reference_name", "status"]}, meta)

	def test_unknown_function_still_refused(self):
		meta = frappe.get_meta("ToDo")
		with self.assertRaises(frappe.ValidationError):
			_build_safe_sql_expression({"function": "DROP", "args": []}, meta)
