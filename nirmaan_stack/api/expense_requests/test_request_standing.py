# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""An Expense Request always shows its Expense's live status (spec #1494, ticket #1500).

Each test moves an Expense through one of the real doors (the decision call, an Accounts edit, a
bank-line unreconcile) and asserts what the raiser would see: the request's status, and the live
status and amount `get_request_standing` serves the Expenses list (and `read.get_expense_request`
the request page, through the same `standing_of`).

Run:
  devenv.sh test --module nirmaan_stack.api.expense_requests.test_request_standing
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.approvals.expense_actions import decide_expenses
from nirmaan_stack.api.expense_requests.create import create_expense_request
from nirmaan_stack.api.expense_requests.read import get_expense_request
from nirmaan_stack.api.expense_requests.standing import get_request_standing
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.outflow_import.expenses import settle_row
from nirmaan_stack.api.outflow_import.test_unreconcile_expenses import (
	NON_PROJECT_EXPENSE,
	ExpenseUnreconcileFixture,
)
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER

NPE = "Non Project Expenses"
NON_PROJECT_TYPE = "Travel Expenses (Bus)"     # project=0, non_project=1, in the fixture
ADMIN = "xstand_test_admin@example.com"
ACCOUNTANT = "xstand_test_accountant@example.com"
PM = "xstand_test_pm@example.com"


def _request(status="Approved", amount=30000, owner=PM) -> str:
	"""A request already reviewed, as the review step leaves it before its Expense moves on."""
	doc = frappe.new_doc("Expense Request")
	doc.update({
		"type": NON_PROJECT_TYPE,
		"amount": amount, "status": status,
		"source_data": frappe.as_json({"responses": {"detail": {"description": "xstand test"}}}),
	})
	doc.name = f"XSTAND-{frappe.generate_hash(length=10)}"
	doc.db_insert()
	# `db_insert` stamps the session user as owner; the raiser is who the steps are worked out for.
	frappe.db.set_value("Expense Request", doc.name, "owner", owner, update_modified=False)
	return doc.name


class TestTheRequestFollowsItsExpense(FrappeTestCase):
	"""Inside one transaction whose commits are stubbed; `tearDown` rolls it all back."""

	def setUp(self):
		self._commit = frappe.db.commit
		self._publish = frappe.publish_realtime
		frappe.db.commit = lambda *a, **k: None
		frappe.publish_realtime = lambda *a, **k: None
		frappe.set_user("Administrator")
		_make_user(ADMIN, "Nirmaan Admin Profile", ("System Manager",))
		_make_user(ACCOUNTANT, "Nirmaan Accountant Profile", ("Nirmaan Accountant",))
		_make_user(PM, "Nirmaan Project Manager Profile", ("Nirmaan Project Manager",))
		if not frappe.db.exists("User", CEO_AUTHORIZED_USER):
			_make_user(CEO_AUTHORIZED_USER, "Nirmaan Admin Profile", ("System Manager",))

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.commit = self._commit
		frappe.publish_realtime = self._publish
		frappe.db.rollback()

	def _expense_of(self, request, status="Requested", amount=None) -> str:
		"""The Expense the review created from `request`, sitting at `status`."""
		doc = frappe.new_doc(NPE)
		doc.update({
			"type": frappe.db.get_value("Expense Request", request, "type"),
			"amount": amount or frappe.db.get_value("Expense Request", request, "amount"),
			"status": status, "description": "xstand test", "request_id": request,
		})
		doc.name = f"XSTAND-{frappe.generate_hash(length=10)}"
		doc.owner = ADMIN
		doc.db_insert()
		return doc.name

	def _decide(self, user, name, action, **kwargs):
		frappe.set_user(user)
		try:
			result = decide_expenses(expense_ids=[name], action=action, **kwargs)["data"]
		finally:
			frappe.set_user("Administrator")
		self.assertEqual(result["failed"], [])

	def _seen_by(self, user, request) -> dict:
		frappe.set_user(user)
		try:
			return get_request_standing(names=[request])[request]
		finally:
			frappe.set_user("Administrator")

	def _request_status(self, request) -> str:
		return frappe.db.get_value("Expense Request", request, "status")

	def test_an_l1_reject_of_the_expense_shows_rejected_on_the_request(self):
		request = _request()
		expense = self._expense_of(request)
		self._decide(ADMIN, expense, "reject", reason="duplicate bill")
		self.assertEqual(self._request_status(request), "Rejected")
		self.assertEqual(self._seen_by(PM, request)["status"], "Rejected")

	def test_a_ceo_reject_shows_rejected_on_the_request(self):
		request = _request(amount=80000)
		expense = self._expense_of(request, status="CEO Pending")
		self._decide(CEO_AUTHORIZED_USER, expense, "reject", reason="not this quarter")
		self.assertEqual(self._request_status(request), "Rejected")
		self.assertEqual(self._seen_by(PM, request)["status"], "Rejected")

	def test_the_request_shows_every_status_its_expense_moves_through(self):
		request = _request(amount=80000)
		expense = self._expense_of(request)
		self.assertEqual(self._seen_by(PM, request)["status"], "Waiting for Admin")
		payment = {"payment_date": "2026-10-19", "payment_ref": "UTR-xstand", "payment_attachment": "/files/r.pdf"}
		for user, action, kwargs, seen, stored in (
			(ADMIN, "l1_approve", {}, "CEO Pending", "Approved"),
			(CEO_AUTHORIZED_USER, "ceo_approve", {}, "Approved", "Approved"),
			(ACCOUNTANT, "mark_done", {}, "Reconciliation Pending", "Approved"),
			(ACCOUNTANT, "mark_paid", {"payment": payment}, "Paid", "Paid"),
		):
			with self.subTest(action=action):
				self._decide(user, expense, action, **kwargs)
				self.assertEqual(self._seen_by(PM, request)["status"], seen)
				self.assertEqual(self._request_status(request), stored)

	def test_an_accounts_edit_of_the_amount_shows_on_the_request(self):
		request = _request(amount=30000)
		expense = self._expense_of(request, status="Approved")
		frappe.set_user(ACCOUNTANT)
		try:
			doc = frappe.get_doc(NPE, expense)
			doc.amount = 27500
			doc.save()
		finally:
			frappe.set_user("Administrator")
		seen = self._seen_by(PM, request)
		self.assertEqual(seen["amount"], 27500)
		self.assertEqual(seen["status"], "Approved")
		frappe.set_user(PM)
		try:
			page = get_expense_request(request)["standing"]
		finally:
			frappe.set_user("Administrator")
		self.assertEqual((page["amount"], page["status"]), (27500, "Approved"))

	def test_a_request_without_an_expense_shows_its_own_status(self):
		seen = self._seen_by(PM, _request(status="Pending Approval"))
		self.assertEqual((seen["status"], seen["amount"], seen["expense"]), ("Pending Approval", 30000, None))
		self.assertEqual([(s["key"], s["state"]) for s in seen["steps"]],
		                 [("raised", "done"), ("review", "current"), ("admin", "upcoming"), ("paid", "upcoming")])

	def test_a_request_approved_on_submit_says_so_on_its_page(self):
		raised = create_expense_request(
			expense_type="Travel Expenses (Bus)", amount=40000,
			source_data={"responses": {"detail": {"description": "xstand approved on submit"}}},
		)
		steps = get_expense_request(raised["name"])["standing"]["steps"]
		self.assertEqual(steps[1]["label"], "Approved on submit (no review)")
		self.assertEqual([s["key"] for s in steps], ["raised", "review", "paid"],
		                 "an Admin's own Rs 40,000 expense needs no further approval")

	def test_the_steps_show_who_acts_next(self):
		request = _request(amount=80000)
		expense = self._expense_of(request)
		self._decide(ADMIN, expense, "l1_approve")
		steps = {s["key"]: s["state"] for s in self._seen_by(PM, request)["steps"]}
		self.assertEqual(steps, {"raised": "done", "review": "done", "admin": "done", "ceo": "current",
		                         "paid": "upcoming"})


class TestUnreconcilingMovesTheRequestBack(ExpenseUnreconcileFixture):
	"""Through the bank-statement unreconcile, which commits: the request is purged in tearDown."""

	def setUp(self):
		super().setUp()
		self.requests = []

	def tearDown(self):
		for name in self.requests:
			frappe.db.delete("Nirmaan Notifications", {"document": "Expense Request", "docname": name})
			frappe.db.delete("Expense Request", {"name": name})
		frappe.db.commit()
		super().tearDown()

	def test_unreconciling_a_paid_expense_moves_the_request_back_from_paid(self):
		expense = self._expense(NON_PROJECT_EXPENSE, "500")
		request = _request(amount=500, owner="Administrator")
		self.requests.append(request)
		frappe.db.set_value(NON_PROJECT_EXPENSE, expense, "request_id", request, update_modified=False)
		frappe.db.commit()
		row = self._staged_row(amount="500")
		settle_row(row=row, target_doctype=NON_PROJECT_EXPENSE, target_name=expense)
		self.assertEqual(frappe.db.get_value("Expense Request", request, "status"), "Paid")

		unreconcile_row(row=row, legs="all", reason="wrong expense")

		self.assertEqual(frappe.db.get_value("Expense Request", request, "status"), "Approved")
		self.assertEqual(get_request_standing(names=[request])[request]["status"], "Reconciliation Pending")
