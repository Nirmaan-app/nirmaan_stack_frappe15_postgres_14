# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The All Payments badge counts what the All Payments tab lists (spec #1470 ticket #1476).

The tab lists every row of all three money-out ledgers (PO / WO payments, Project Expenses, Non-Project
Expenses) in every status: `get_approval_queue` with no filter. Its badge is the `all` count of
`get_approval_queue_counts`, the endpoint every other tab badge reads. The two must agree for the
viewer, so both are read here as the same user, after planting one row per ledger in three statuses.

Runs against the env DB: the rows are planted inside one transaction whose commits are stubbed and
rolled back in `tearDown`. The HR Lead user is committed in `setUpClass` and deleted in
`tearDownClass`.

Run:
  devenv.sh test --module nirmaan_stack.api.approvals.test_approval_queue_counts
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue, get_approval_queue_counts
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.payees.payee_fixture import delete_each

U = "Administrator"
# The HR Lead profile's two roles, and no System Manager: the strict view-only case.
HR_LEAD = "apq_counts_test_hrlead@example.com"


def _raw(doctype, **fields):
	"""A row inserted with no hooks, so it lands at exactly the status given."""
	doc = frappe.new_doc(doctype)
	doc.update(fields)
	doc.name = f"APQC-{frappe.generate_hash(length=10)}"
	doc.db_insert()
	return doc.name


class TestAllPaymentsBadgeMatchesItsRows(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_make_user(HR_LEAD, "Nirmaan HR Lead Profile", ("Nirmaan HR Lead", "Nirmaan HR Executive"))
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.set_user(U)
		try:
			delete_each([(dt, HR_LEAD) for dt in ("Nirmaan Users", "User")])
		finally:
			super().tearDownClass()

	def setUp(self):
		frappe.set_user(U)
		self._commit = frappe.db.commit
		frappe.db.commit = lambda *a, **k: None

	def tearDown(self):
		frappe.set_user(U)
		frappe.db.commit = self._commit
		frappe.db.rollback()

	def _all(self):
		return get_approval_queue_counts()["all"]

	def _rows_listed(self):
		"""The All Payments tab's row total: the queue with no filter (`getApprovalsStaticFilters`)."""
		return get_approval_queue(filters=[], limit_page_length=1)["total_count"]

	def _plant_one_per_ledger(self):
		_raw("Project Payments", amount=1234, status="Approved")
		_raw("Project Expenses", amount=1234, status="Paid", description="apq counts test")
		_raw("Non Project Expenses", amount=1234, status="Rejected", description="apq counts test")

	def test_all_counts_every_ledger_in_every_status(self):
		before = self._all()
		self._plant_one_per_ledger()
		self.assertEqual(self._all(), before + 3)

	def test_all_equals_the_all_payments_row_total_for_each_viewer(self):
		self._plant_one_per_ledger()
		for user in (U, HR_LEAD):
			with self.subTest(user=user):
				frappe.set_user(user)
				self.assertEqual(self._all(), self._rows_listed())
