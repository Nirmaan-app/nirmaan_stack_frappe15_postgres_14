# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Payment Source column (owner, 2026-11-06): the statement a record was reconciled from -- the source of
its live `Settled` bank-line slip linked LAST -- or "Unknown" when no live slip reaches it. The list, its
filter and its facet all read the one union column, so they agree.

Every query is scoped to the rows planted here (`name in [...]`), so live rows never move a count.
"""

import unittest

import frappe
from frappe.utils import flt

from nirmaan_stack.api.approvals.get_approval_queue import (
    PAYMENT_SOURCE_NONE,
    get_approval_queue,
    get_approval_queue_facets,
)
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

U = "Administrator"


class TestPaymentSource(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		frappe.set_user(U)
		cls.fx = TaxedWorkOrderFixture()
		cls.expenses = {"Project Expenses": [], "Non Project Expenses": []}
		cls.matches = []
		try:
			# Two live slips from two statements: the one linked LAST names the source.
			cls.two_sources = cls._expense("Non Project Expenses")
			cls._match("Non Project Expenses", cls.two_sources, "Cashfree", "2026-10-01 10:00:00")
			cls._match("Non Project Expenses", cls.two_sources, "Cashbook", "2026-10-05 10:00:00")
			# A later slip that was unlinked (Reversed) never names the source.
			cls._match("Non Project Expenses", cls.two_sources, "ICICI Bank Statement", "2026-10-09 10:00:00",
					   kind="Reversed")
			# Only a Reversed slip: not reconciled.
			cls.only_reversed = cls._expense("Project Expenses")
			cls._match("Project Expenses", cls.only_reversed, "Porter Statement", "2026-10-02 10:00:00",
					   kind="Reversed")
			# A PO / WO payment reconciled from one statement.
			cls.payment = cls._payment()
			cls._match("Project Payments", cls.payment, "ICICI Credit Card Statement", "2026-10-03 10:00:00")
			# No slip at all.
			cls.none = cls._expense("Project Expenses")
			frappe.db.commit()
		except Exception:
			cls.tearDownClass()
			raise
		cls.all = [cls.two_sources, cls.only_reversed, cls.payment, cls.none]

	@classmethod
	def tearDownClass(cls):
		frappe.db.rollback()
		for doctype, names in [*cls.expenses.items(), ("Outflow Row Match", cls.matches)]:
			try:
				if names:
					frappe.db.delete(doctype, {"name": ["in", names]})
				frappe.db.commit()
			except Exception as exc:
				frappe.db.rollback()
				print(f"payment source test purge: could not delete {doctype}: {exc}")
		cls.fx.purge()

	@classmethod
	def _payment(cls):
		name = cls.fx._name("PAY")
		frappe.db.sql(
			"""INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner, docstatus, idx,
				   amount, status, document_type, document_name)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 'Paid', 'Procurement Orders', 'PO/TEST/SOURCE/1')""",
			(name, U, U, flt(20000)),
		)
		cls.fx.payments.append(name)
		return name

	@classmethod
	def _expense(cls, doctype):
		name = cls.fx._name("EXP")
		frappe.db.sql(
			f"""INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner, docstatus, idx, status,
				   amount, description, type)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, 'Paid', 1500, 'Payment source test', 'Petty Cash')""",
			(name, U, U),
		)
		cls.expenses[doctype].append(name)
		return name

	@classmethod
	def _match(cls, doctype, target, source, matched_at, *, kind="Settled"):
		name = cls.fx._name("ORM")
		frappe.db.sql(
			"""INSERT INTO "tabOutflow Row Match" (name, creation, modified, modified_by, owner, docstatus, idx,
				   target_doctype, target_name, target_amount, match_kind, matched_at, source)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 100, %s, %s, %s)""",
			(name, U, U, doctype, target, kind, matched_at, source),
		)
		cls.matches.append(name)
		return name

	def _rows(self, *extra):
		filters = [["name", "in", self.all], *extra]
		return {r["name"]: r for r in get_approval_queue(filters=filters, limit_page_length=50)["data"]}

	def test_each_row_names_the_statement_of_its_last_live_slip(self):
		rows = self._rows()
		self.assertEqual(len(rows), 4, "a record with several slips is still one row")
		self.assertEqual(rows[self.two_sources]["payment_source"], "Cashbook")
		self.assertEqual(rows[self.payment]["payment_source"], "ICICI Credit Card Statement")
		self.assertEqual(rows[self.only_reversed]["payment_source"], PAYMENT_SOURCE_NONE)
		self.assertEqual(rows[self.none]["payment_source"], PAYMENT_SOURCE_NONE)

	def test_the_filter_lists_exactly_the_rows_showing_the_picked_sources(self):
		self.assertEqual(set(self._rows(["payment_source", "in", ["Cashbook"]])), {self.two_sources})
		# The earlier statement of a two-source record does not list it.
		self.assertEqual(set(self._rows(["payment_source", "in", ["Cashfree"]])), set())
		self.assertEqual(set(self._rows(["payment_source", "in", [PAYMENT_SOURCE_NONE]])),
						 {self.only_reversed, self.none})
		self.assertEqual(set(self._rows(["payment_source", "not in", [PAYMENT_SOURCE_NONE]])),
						 {self.two_sources, self.payment})

	def test_the_facet_counts_what_the_filter_lists(self):
		facet = get_approval_queue_facets("payment_source", filters=[["name", "in", self.all]])
		counts = {v["value"]: v["count"] for v in facet["values"]}
		self.assertEqual(counts, {PAYMENT_SOURCE_NONE: 2, "Cashbook": 1, "ICICI Credit Card Statement": 1})
		self.assertEqual(facet["blank_count"], 0)
