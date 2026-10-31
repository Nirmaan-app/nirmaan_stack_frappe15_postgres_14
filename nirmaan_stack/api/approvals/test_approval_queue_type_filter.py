# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Type filter's flat list (owner, 2026-10-31): the four types and Non Project – Reimbursement, and the
narrower options "<type>:<detail>" (WO – GST, PO – Cheque, an expense type). The list and the facet build their
WHERE in the same place (`_type_clause`), and the facet counts each narrower option (`_type_detail_counts`).

Every query is scoped to the rows planted here (`name in [...]`), so live rows never move a count.
"""

import json
import unittest

import frappe
from frappe.utils import flt

from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue, get_approval_queue_facets
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

U = "Administrator"


class TestTheTypeFilter(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		frappe.set_user(U)
		cls.fx = TaxedWorkOrderFixture()
		cls.expenses = {"Project Expenses": [], "Non Project Expenses": []}
		try:
			project = cls.fx.project()
			vendor = cls.fx.vendor(2.0)
			sr = cls.fx.service_request(project, vendor)
			cls.wo = cls._payment(project, vendor, "Service Requests", sr, gst=False, mode="Online")
			cls.wo_gst = cls._payment(project, vendor, "Service Requests", sr, gst=True, mode="Online")
			cls.po = cls._payment(project, vendor, "Procurement Orders", "PO/TEST/TYPE/1", gst=False, mode="Online")
			cls.po_cheque = cls._payment(project, vendor, "Procurement Orders", "PO/TEST/TYPE/2", gst=False, mode="Cheque")
			cls.petty = cls._expense("Project Expenses", "Petty Cash", project=project)
			cls.labour = cls._expense("Project Expenses", "Labour Charges", project=project)
			cls.rent = cls._expense("Non Project Expenses", "Office Rent")
			# A reimbursement's expense of the same type: Non Project – Office Rent must leave it out.
			cls.claim = cls._expense("Non Project Expenses", "Office Rent", reimbursement="RB-TEST-TYPE-FILTER")
			frappe.db.commit()
		except Exception:
			cls.tearDownClass()
			raise
		cls.all = [cls.wo, cls.wo_gst, cls.po, cls.po_cheque, cls.petty, cls.labour, cls.rent, cls.claim]

	@classmethod
	def tearDownClass(cls):
		frappe.db.rollback()
		for doctype, names in cls.expenses.items():
			try:
				if names:
					frappe.db.delete(doctype, {"name": ["in", names]})
				frappe.db.commit()
			except Exception as exc:
				frappe.db.rollback()
				print(f"type filter test purge: could not delete {doctype}: {exc}")
		cls.fx.purge()

	@classmethod
	def _payment(cls, project, vendor, parent_type, parent, *, gst, mode):
		name = cls.fx._name("PAY")
		frappe.db.sql(
			"""INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner, docstatus, idx,
				   project, vendor, amount, status, document_type, document_name, is_gst_payment, mode_of_payment)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, 'Requested', %s, %s, %s, %s)""",
			(name, U, U, project, vendor, flt(20000), parent_type, parent, 1 if gst else 0, mode),
		)
		cls.fx.payments.append(name)
		return name

	@classmethod
	def _expense(cls, doctype, expense_type, *, project=None, reimbursement=None):
		name = cls.fx._name("EXP")
		cols = ["name", "creation", "modified", "modified_by", "owner", "docstatus", "idx", "status", "amount",
				"description", "type"]
		vals = [name, "NOW()", "NOW()", U, U, 0, 0, "Requested", 1500.0, "Type filter test", expense_type]
		if project:
			cols.append("projects")
			vals.append(project)
		if reimbursement:
			cols.append("reimbursement")
			vals.append(reimbursement)
		marks = ", ".join("NOW()" if v == "NOW()" else "%s" for v in vals)
		frappe.db.sql(
			f'INSERT INTO "tab{doctype}" ({", ".join(cols)}) VALUES ({marks})',
			tuple(v for v in vals if v != "NOW()"),
		)
		cls.expenses[doctype].append(name)
		return name

	def _names(self, op, value):
		filters = [["name", "in", self.all], ["source_type", op, value]]
		return {r["name"] for r in get_approval_queue(filters=filters, limit_page_length=50)["data"]}

	def test_a_type_lists_all_its_rows_and_a_narrower_option_only_its_own(self):
		self.assertEqual(self._names("in", ["SR Payment"]), {self.wo, self.wo_gst})
		self.assertEqual(self._names("in", ["SR Payment:GST"]), {self.wo_gst})
		self.assertEqual(self._names("in", ["PO Payment"]), {self.po, self.po_cheque})
		self.assertEqual(self._names("in", ["PO Payment:Cheque"]), {self.po_cheque})

	def test_an_expense_type_option_lists_that_ledger_and_that_type_only(self):
		self.assertEqual(self._names("in", ["Project Expense:Petty Cash"]), {self.petty})
		self.assertEqual(self._names("in", ["Non-Project:Office Rent"]), {self.rent})
		self.assertEqual(self._names("in", ["Project Expense:Office Rent"]), set())

	def test_non_project_expense_includes_the_reimbursements_and_reimbursement_alone_narrows_to_them(self):
		self.assertEqual(self._names("in", ["Non-Project"]), {self.rent, self.claim})
		self.assertEqual(self._names("in", ["Reimbursement"]), {self.claim})

	def test_picked_options_combine_as_either(self):
		self.assertEqual(
			self._names("in", ["SR Payment:GST", "Project Expense:Petty Cash", "PO Payment"]),
			{self.wo_gst, self.petty, self.po, self.po_cheque},
		)

	def test_not_in_leaves_out_exactly_what_in_lists(self):
		picked = ["SR Payment:GST", "Non-Project"]
		self.assertEqual(self._names("not in", picked), set(self.all) - self._names("in", picked))

	def test_a_single_value_with_equals_reads_the_same(self):
		self.assertEqual(self._names("=", "PO Payment:Cheque"), {self.po_cheque})

	def test_an_option_the_server_does_not_know_is_refused_never_ignored(self):
		with self.assertRaises(frappe.ValidationError):
			self._names("in", ["SR Payment:Cheque"])

	def test_the_facet_counts_each_type_and_each_narrower_option(self):
		facet = get_approval_queue_facets("source_type", filters=json.dumps([["name", "in", self.all]]))
		self.assertEqual({v["value"]: v["count"] for v in facet["values"]}, {
			"SR Payment": 2,
			"PO Payment": 2,
			"Project Expense": 2,
			"Non-Project": 2,
			"Reimbursement": 1,
			"SR Payment:GST": 1,
			"PO Payment:Cheque": 1,
			"Project Expense:Petty Cash": 1,
			"Project Expense:Labour Charges": 1,
			"Non-Project:Office Rent": 1,
		})

	def test_the_facet_counts_follow_the_other_filters(self):
		facet = get_approval_queue_facets("source_type", filters=json.dumps([["name", "in", [self.wo_gst, self.petty]]]))
		self.assertEqual({v["value"]: v["count"] for v in facet["values"]}, {
			"SR Payment": 1, "Project Expense": 1, "SR Payment:GST": 1, "Project Expense:Petty Cash": 1,
		})
