# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""The invoice of an expense (spec #1494, #1502): asked once for every type, carried onto the
Expense at approval, and added later until the Expense is Paid.

Each test raises through the intake call and reads what a user would see: the warnings in the
response, and the invoice columns on the created Expense.

Run:
  DEVENV test --module nirmaan_stack.api.expense_requests.test_request_invoice
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.create import create_expense_request
from nirmaan_stack.api.expense_requests.invoice import add_request_invoice
from nirmaan_stack.api.expense_requests.read import get_expense_request
from nirmaan_stack.api.expense_requests.review import approve_expense_request, reject_expense_request
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.services import expense_request_routing as routing
from nirmaan_stack.services.expense_decision import decide

PM_USER = "exr_inv_test_pm@example.com"
PM2_USER = "exr_inv_test_pm2@example.com"
PM_PROFILE = "Nirmaan Project Manager Profile"

FILE = "/private/files/exr_inv_test_bill.pdf"
LATER_FILE = "/private/files/exr_inv_test_later.pdf"

# A type with its own short form, like Hotel Expenses after #1503: no upload slot of its own.
FORMAT = json.dumps({
	"templateId": "exr-inv-test", "templateVersion": 1,
	"sections": [{"id": "detail", "type": "fields", "fields": [
		{"key": "guest", "label": "Guest Name", "type": "text", "required": True}]}],
})


def _answers(invoice=None, files=None):
	"""The envelope the New Expense dialog sends for this test's form."""
	data = {"templateId": "exr-inv-test", "templateVersion": 1,
	        "responses": {"detail": {"guest": "Asha"}}}
	if invoice is not None:
		data["responses"]["invoice"] = invoice
	if files is not None:
		data["attachments"] = {"invoice": files}
	return data


def _pay(expense):
	"""Mark the Expense Paid the way Accounts does, so its request follows (the mirror)."""
	decide("Non Project Expenses", expense, "mark_paid", "Administrator", payment={
		"payment_date": "2026-10-19", "payment_ref": "UTR-exr-inv", "payment_attachment": FILE})


def _make_type(fmt):
	name = f"exr_inv_test_et_{frappe.generate_hash(length=6)}"
	d = frappe.new_doc("Expense Type")
	d.update({"expense_name": name, "project": 0, "non_project": 1,
	          "expense_category": "Uncategorized", "source_format": fmt,
	          "source_format_enabled": 1 if fmt else 0})
	d.set("allowed_roles", [{"role_profile": PM_PROFILE}])
	d.insert(ignore_permissions=True)
	return name


class TestRequestInvoice(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		for email in (PM_USER, PM2_USER):
			_make_user(email, PM_PROFILE, ("Nirmaan Project Manager",))
		cls.expense_type = _make_type(FORMAT)
		# A type with no form of its own: Description + Comment (#1501).
		cls.standard_type = _make_type(None)
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		types = [cls.expense_type, cls.standard_type]
		for r in frappe.get_all("Expense Request", filters={"type": ["in", types]}, pluck="name"):
			frappe.db.delete("Nirmaan Notifications", {"document": "Expense Request", "docname": r})
			for row in frappe.get_all("Non Project Expenses", filters={"request_id": r}, pluck="name"):
				frappe.delete_doc("Non Project Expenses", row, force=True, ignore_permissions=True)
			if frappe.db.exists("Expense Request", r):
				frappe.delete_doc("Expense Request", r, force=True, ignore_permissions=True)
		for t in types:
			frappe.delete_doc("Expense Type", t, force=True, ignore_permissions=True)
		for email in (PM_USER, PM2_USER):
			for dt in ("Nirmaan Users", "User"):
				if frappe.db.exists(dt, email):
					frappe.delete_doc(dt, email, force=True, ignore_permissions=True)
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		frappe.set_user("Administrator")
		routing.clear_cache()

	def tearDown(self):
		routing.clear_cache()
		frappe.set_user("Administrator")

	def _raise(self, source_data, user=PM_USER, amount=4300, expense_type=None):
		frappe.set_user(user)
		try:
			return create_expense_request(expense_type=expense_type or self.expense_type,
			                              amount=amount, source_data=source_data)
		finally:
			frappe.set_user("Administrator")

	def _add_later(self, name, user=PM_USER, **invoice):
		frappe.set_user(user)
		try:
			return add_request_invoice(name, **invoice)
		finally:
			frappe.set_user("Administrator")

	def _expense(self, created):
		return frappe.db.get_value(
			"Non Project Expenses", created,
			["invoice_attachment", "invoice_date", "invoice_ref", "description"], as_dict=True)

	# --- raised with the request ---------------------------------------------------------

	def test_an_invoice_raised_with_the_request_appears_on_the_expense(self):
		res = self._raise(_answers({"invoice_date": "2026-10-01", "invoice_ref": "GN/24/118"}, [FILE]))
		out = approve_expense_request(res["name"])

		row = self._expense(out["created_expense"])
		self.assertEqual(row.invoice_attachment, FILE)
		self.assertEqual(str(row.invoice_date), "2026-10-01")
		self.assertEqual(row.invoice_ref, "GN/24/118")
		# The invoice has its own columns; the description is the form's answers alone.
		self.assertEqual(row.description, f"Guest Name: Asha · [{res['name']}]")

	def test_submitting_with_an_unread_invoice_number_succeeds_and_returns_the_warning(self):
		res = self._raise(_answers({"invoice_date": "2026-10-01"}, [FILE]))

		self.assertEqual(frappe.db.get_value("Expense Request", res["name"], "status"),
		                 "Pending Approval")
		self.assertEqual(res["warnings"], ["The invoice number is missing. Add it if you can."])

	def test_an_invoice_with_its_date_and_number_raises_no_warning(self):
		res = self._raise(_answers({"invoice_date": "2026-10-01", "invoice_ref": "A-1"}, [FILE]))
		self.assertEqual(res["warnings"], [])

	def test_a_type_with_no_form_takes_an_invoice_missing_its_details_with_warnings(self):
		"""Its invoice date and number were required until #1502; now they only warn."""
		res = self._raise(
			{"responses": {"detail": {"description": "Diesel"}}, "attachments": {"invoice": [FILE]}},
			expense_type=self.standard_type)

		self.assertEqual(res["warnings"], [
			"The invoice date is missing. Add it if you can.",
			"The invoice number is missing. Add it if you can.",
		])
		out = approve_expense_request(res["name"])
		self.assertEqual(self._expense(out["created_expense"]).invoice_attachment, FILE)

	# --- added later ----------------------------------------------------------------------

	def test_an_invoice_added_after_approval_updates_the_expense(self):
		res = self._raise(_answers())
		out = approve_expense_request(res["name"])

		later = self._add_later(res["name"], invoice_attachment=LATER_FILE,
		                        invoice_date="2026-10-05", invoice_ref="GN/24/120")

		row = self._expense(out["created_expense"])
		self.assertEqual(row.invoice_attachment, LATER_FILE)
		self.assertEqual(str(row.invoice_date), "2026-10-05")
		self.assertEqual(row.invoice_ref, "GN/24/120")
		self.assertEqual(later["warnings"], [])

	def test_adding_an_invoice_to_a_paid_expense_is_refused(self):
		res = self._raise(_answers())
		out = approve_expense_request(res["name"])
		_pay(out["created_expense"])

		with self.assertRaises(frappe.ValidationError):
			self._add_later(res["name"], invoice_attachment=LATER_FILE, invoice_ref="X-1",
			                invoice_date="2026-10-05")
		self.assertIsNone(self._expense(out["created_expense"]).invoice_attachment)

	def test_an_invoice_added_before_approval_is_carried_onto_the_expense(self):
		res = self._raise(_answers())
		later = self._add_later(res["name"], invoice_attachment=LATER_FILE)
		self.assertEqual(later["warnings"], [
			"The invoice date is missing. Add it if you can.",
			"The invoice number is missing. Add it if you can.",
		])

		out = approve_expense_request(res["name"])
		self.assertEqual(self._expense(out["created_expense"]).invoice_attachment, LATER_FILE)

	def test_only_the_raiser_or_an_admin_adds_the_invoice(self):
		res = self._raise(_answers())
		with self.assertRaises(frappe.PermissionError):
			self._add_later(res["name"], user=PM2_USER, invoice_attachment=LATER_FILE)
		self.assertTrue(self._add_later(res["name"], user="Administrator",
		                                invoice_attachment=LATER_FILE)["name"])

	def test_a_rejected_request_takes_no_invoice(self):
		res = self._raise(_answers())
		reject_expense_request(res["name"], "duplicate")
		with self.assertRaises(frappe.ValidationError):
			self._add_later(res["name"], invoice_attachment=LATER_FILE)

	# --- the request page -----------------------------------------------------------------

	def _page(self, name, user=PM_USER):
		frappe.set_user(user)
		try:
			return get_expense_request(name)
		finally:
			frappe.set_user("Administrator")

	def test_the_request_page_shows_the_invoice_and_offers_to_add_one_until_paid(self):
		res = self._raise(_answers())
		page = self._page(res["name"])
		self.assertEqual(page["invoice"], {})
		self.assertTrue(page["can_add_invoice"])
		self.assertIsNone(page["expense"])

		out = approve_expense_request(res["name"])
		self._add_later(res["name"], invoice_attachment=LATER_FILE, invoice_ref="R-9")
		_pay(out["created_expense"])

		page = self._page(res["name"])
		self.assertEqual(page["invoice"], {"invoice_attachment": LATER_FILE, "invoice_ref": "R-9"})
		self.assertFalse(page["can_add_invoice"])
		self.assertIn("already paid", page["invoice_refusal"])
		self.assertEqual(page["expense"], {"doctype": "Non Project Expenses",
		                                   "name": out["created_expense"], "status": "Paid"})
