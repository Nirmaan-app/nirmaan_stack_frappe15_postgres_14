# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Every status change on an Expense goes through one call (spec #1494 seam 2, ticket #1497).

Each test calls `decide_expenses` as a user and asserts what that user would see: the Expense's
status and stamps, or the refusal. Runs inside ONE transaction whose commits are stubbed and which
`tearDown` rolls back, so the fixture users and expenses never outlive the test.

Run:
  devenv.sh test --module nirmaan_stack.api.approvals.test_expense_decisions
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.approvals.expense_actions import decide_expenses
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER

PE = "Project Expenses"
NPE = "Non Project Expenses"

ADMIN = "xdec_test_admin@example.com"
ACCOUNTANT = "xdec_test_accountant@example.com"
PM = "xdec_test_pm@example.com"
HR = "xdec_test_hr@example.com"
PMO = "xdec_test_pmo@example.com"


class TestExpenseDecisions(FrappeTestCase):
	def setUp(self):
		self._commit = frappe.db.commit
		self._publish = frappe.publish_realtime
		frappe.db.commit = lambda *a, **k: None
		frappe.publish_realtime = lambda *a, **k: None
		frappe.set_user("Administrator")
		_make_user(ADMIN, "Nirmaan Admin Profile", ("System Manager",))
		_make_user(ACCOUNTANT, "Nirmaan Accountant Profile", ("Nirmaan Accountant",))
		_make_user(PM, "Nirmaan Project Manager Profile", ("Nirmaan Project Manager",))
		_make_user(HR, "Nirmaan HR Executive Profile", ("Nirmaan HR Executive", "System Manager"))
		_make_user(PMO, "Nirmaan PMO Executive Profile", ("Nirmaan PMO Executive",))
		if not frappe.db.exists("User", CEO_AUTHORIZED_USER):
			_make_user(CEO_AUTHORIZED_USER, "Nirmaan Admin Profile", ("System Manager",))

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.commit = self._commit
		frappe.publish_realtime = self._publish
		frappe.db.rollback()

	# -- helpers --------------------------------------------------------------------------------
	def _expense(self, amount, status="Requested", doctype=NPE, **fields) -> str:
		"""An existing Expense a Project Manager raised, sitting at `status`."""
		doc = frappe.new_doc(doctype)
		doc.update({"amount": amount, "status": status, "description": "xdec test", **fields})
		doc.name = f"XDEC-{frappe.generate_hash(length=10)}"
		doc.owner = PM
		doc.db_insert()
		return doc.name

	def _decide(self, user, names, action, **kwargs) -> dict:
		frappe.set_user(user)
		try:
			return decide_expenses(expense_ids=frappe.as_json(names), action=action, **kwargs)["data"]
		finally:
			frappe.set_user("Administrator")

	def _row(self, name, doctype=NPE):
		# Only Project Expenses carries `payment_by`.
		fields = ["status", "approval_date", "ceo_approval_date", "payment_ref"]
		return frappe.db.get_value(doctype, name, fields + (["payment_by"] if doctype == PE else []), as_dict=True)

	def _status(self, name, doctype=NPE):
		return frappe.db.get_value(doctype, name, "status")

	def _refused(self, result, name) -> str:
		self.assertEqual(result["succeeded"], [])
		[failure] = [f for f in result["failed"] if f["name"] == name]
		return failure["reason"]

	# -- L1 and the CEO -------------------------------------------------------------------------
	def test_approving_one_and_approving_in_bulk_give_the_same_status(self):
		for amount, expected in ((30000, "Approved"), (80000, "CEO Pending")):
			with self.subTest(amount=amount):
				alone = self._expense(amount)
				batch = [self._expense(amount, doctype=PE), self._expense(amount), self._expense(5000)]
				one = self._decide(ADMIN, [alone], "l1_approve")
				many = self._decide(ADMIN, batch, "l1_approve")
				self.assertEqual(one["statuses"], {alone: expected})
				self.assertEqual(many["statuses"][batch[0]], expected)
				self.assertEqual(many["statuses"][batch[1]], expected)
				self.assertEqual(self._status(alone), expected)
				self.assertEqual(self._status(batch[0], PE), expected)
				row = self._row(alone)
				self.assertTrue(row.approval_date)
				self.assertFalse(row.ceo_approval_date, "an L1 approval never stamps the CEO's date")

	def test_an_accountants_l1_approve_is_refused(self):
		name = self._expense(30000)
		reason = self._refused(self._decide(ACCOUNTANT, [name], "l1_approve"), name)
		self.assertIn("Accountants are not first-level approvers", reason)
		self.assertEqual(self._status(name), "Requested")

	def test_the_ceo_approves_what_waits_for_the_ceo_and_nobody_else_does(self):
		name = self._expense(80000, status="CEO Pending")
		self._refused(self._decide(ADMIN, [name], "ceo_approve"), name)
		self.assertEqual(self._status(name), "CEO Pending")
		self.assertEqual(self._decide(CEO_AUTHORIZED_USER, [name], "ceo_approve")["statuses"], {name: "Approved"})
		self.assertTrue(self._row(name).ceo_approval_date)

	def test_an_action_refuses_a_status_it_does_not_start_from(self):
		name = self._expense(30000, status="Approved")
		reason = self._refused(self._decide(ADMIN, [name], "l1_approve"), name)
		self.assertIn("Approved", reason)
		self.assertEqual(self._status(name), "Approved")

	def test_approval_is_refused_while_the_project_is_on_ceo_hold(self):
		project = f"XDEC-PRJ-{frappe.generate_hash(length=8)}"
		frappe.db.sql(
			"""INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner, docstatus, idx,
			                              project_name, status)
			   VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, 'CEO Hold')""",
			(project, project),
		)
		name = self._expense(30000, doctype=PE, projects=project)
		self.assertIn("CEO Hold", self._refused(self._decide(ADMIN, [name], "l1_approve"), name))
		self.assertEqual(self._status(name, PE), "Requested")

	def test_a_name_that_is_no_expense_is_not_found(self):
		result = self._decide(ADMIN, ["NOT-AN-EXPENSE-xdec"], "l1_approve")
		self.assertEqual(result["failed"], [{"name": "NOT-AN-EXPENSE-xdec", "reason": "Expense not found"}])

	# -- reject ---------------------------------------------------------------------------------
	def test_a_reject_needs_a_reason(self):
		name = self._expense(30000)
		frappe.set_user(ADMIN)
		try:
			with self.assertRaises(frappe.ValidationError):
				decide_expenses(expense_ids=[name], action="reject", reason="  ")
		finally:
			frappe.set_user("Administrator")
		self.assertEqual(self._status(name), "Requested")

	def test_l1_rejects_what_waits_for_l1_and_the_ceo_what_waits_for_the_ceo(self):
		requested, ceo_pending = self._expense(30000), self._expense(80000, status="CEO Pending")
		self.assertEqual(self._decide(ADMIN, [requested], "reject", reason="duplicate")["statuses"],
		                 {requested: "Rejected"})
		self.assertTrue(frappe.db.exists("Comment", {
			"reference_doctype": NPE, "reference_name": requested, "content": ["like", "%duplicate%"],
		}))
		self._refused(self._decide(ADMIN, [ceo_pending], "reject", reason="no"), ceo_pending)
		self._decide(CEO_AUTHORIZED_USER, [ceo_pending], "reject", reason="no")
		self.assertEqual(self._status(ceo_pending), "Rejected")

	# -- paying ---------------------------------------------------------------------------------
	def test_mark_as_paid_by_a_role_without_the_right_is_refused(self):
		for user in (PM, HR):
			with self.subTest(user=user):
				name = self._expense(30000, status="Approved")
				done = self._decide(user, [name], "mark_done")
				self.assertIn("Admin or Accounts", self._refused(done, name))
				paid = self._decide(user, [name], "mark_paid", payment=frappe.as_json({
					"payment_date": "2026-10-19", "payment_ref": "UTR1", "payment_attachment": "/files/x.pdf"}))
				self._refused(paid, name)
				self.assertEqual(self._status(name), "Approved")

	def test_an_accountant_marks_an_approved_expense_done(self):
		name = self._expense(30000, status="Approved")
		self.assertEqual(self._decide(ACCOUNTANT, [name], "mark_done")["statuses"], {name: "Reconciliation Pending"})

	def test_mark_as_paid_needs_the_payment_details_and_records_who_paid(self):
		name = self._expense(30000, status="Approved", doctype=PE)
		reason = self._refused(self._decide(ACCOUNTANT, [name], "mark_paid"), name)
		self.assertIn("Mark as Paid needs", reason)
		self.assertEqual(self._status(name, PE), "Approved")
		payment = {"payment_date": "2026-10-19", "payment_ref": "UTR-xdec", "payment_attachment": "/files/r.pdf"}
		result = self._decide(ACCOUNTANT, [name], "mark_paid", payment=payment)
		self.assertEqual(result["statuses"], {name: "Paid"})
		row = self._row(name, PE)
		self.assertEqual((row.payment_ref, row.payment_by), ("UTR-xdec", ACCOUNTANT))

	def test_a_reconciliation_pending_expense_is_marked_paid_too(self):
		name = self._expense(30000, status="Reconciliation Pending")
		payment = {"payment_date": "2026-10-19", "payment_ref": "UTR-2", "payment_attachment": "/files/r.pdf"}
		self.assertEqual(self._decide(ADMIN, [name], "mark_paid", payment=payment)["statuses"], {name: "Paid"})

	# -- nobody sets a status by hand (story 42) ------------------------------------------------
	def _save_as(self, user, doctype, name, **changes):
		"""Save the Expense the way Desk, REST and `frappe.client` do: a plain `doc.save()`."""
		frappe.set_user(user)
		try:
			doc = frappe.get_doc(doctype, name)
			doc.update(changes)
			doc.save()
		finally:
			frappe.set_user("Administrator")

	def test_a_status_set_through_a_document_save_is_refused(self):
		for user in (PM, PMO, ACCOUNTANT, ADMIN, "Administrator"):
			for doctype in (PE, NPE):
				with self.subTest(user=user, doctype=doctype):
					name = self._expense(30000, status="Approved", doctype=doctype)
					with self.assertRaises(frappe.ValidationError) as refused:
						self._save_as(user, doctype, name, status="Paid", payment_ref="UTR-hand")
					self.assertIn("Mark as Paid", str(refused.exception))
					self.assertEqual(self._status(name, doctype), "Approved")

	def test_a_document_save_that_leaves_the_status_alone_still_saves(self):
		name = self._expense(30000, status="Approved")
		self._save_as(ACCOUNTANT, NPE, name, description="xdec corrected")
		self.assertEqual(frappe.db.get_value(NPE, name, ["status", "description"]),
		                 ("Approved", "xdec corrected"))

	def test_a_new_expense_carrying_a_status_through_a_document_insert_is_refused(self):
		doc = frappe.new_doc(NPE)
		doc.update({"amount": 30000, "status": "Paid", "description": "xdec hand-made paid"})
		with self.assertRaises(frappe.ValidationError):
			doc.insert()
		self.assertFalse(frappe.db.exists(NPE, {"description": "xdec hand-made paid"}))
