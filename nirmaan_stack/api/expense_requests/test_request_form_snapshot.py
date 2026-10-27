# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""A request in flight reads against the form it was filled with (spec #1494, #1503).

#1503 trims the per-type forms: fields come off, every upload slot goes, and 25 types lose their
form. A request raised before that and decided after must still show its answers under the labels
it was asked with, still write the sentence it was filled for, and still carry the bill from the
slot it was uploaded to (ADR-0016 decision 1, the template snapshot).

Each test raises through the intake call, changes the type's form, and reads what a user sees:
the request page's detail, and the Expense created on approval.

Run:
  DEVENV test --module nirmaan_stack.api.expense_requests.test_request_form_snapshot
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.create import create_expense_request
from nirmaan_stack.api.expense_requests.read import get_expense_request, get_my_expense_requests
from nirmaan_stack.api.expense_requests.review import approve_expense_request
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.expense_requests.update import update_expense_request
from nirmaan_stack.services import expense_request_routing as routing

PM_USER = "exr_snap_test_pm@example.com"
PM_PROFILE = "Nirmaan Project Manager Profile"
BILL = "/private/files/exr_snap_test_bill.pdf"

# Today's shape: two fields and a Proof slot that carries the bill onto the Expense.
BEFORE = {
	"templateId": "exr-snap-test", "templateVersion": 1,
	"description_template": "Stay for {guest} at {hotel}.",
	"sections": [
		{"id": "detail", "type": "fields", "fields": [
			{"key": "guest", "label": "Guest Name", "type": "text", "required": True},
			{"key": "hotel", "label": "Hotel", "type": "text", "required": True}]},
		{"id": "proof", "type": "image_attachments", "slots": [
			{"key": "bill", "label": "Bill / Receipt", "maps_to": "invoice_attachment"}]},
	],
}
# The trimmed shape: one field, no slot, another sentence.
AFTER = {
	"templateId": "exr-snap-test", "templateVersion": 2,
	"description_template": "Stay for {guest}.",
	"sections": [{"id": "detail", "type": "fields", "fields": [
		{"key": "guest", "label": "Guest", "type": "text", "required": True}]}],
}


def _answers(fmt, **detail):
	return {"templateId": fmt["templateId"], "templateVersion": fmt["templateVersion"],
	        "responses": {"detail": detail}}


class TestARequestReadsAgainstItsOwnForm(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_make_user(PM_USER, PM_PROFILE, ("Nirmaan Project Manager",))
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		for r in frappe.get_all("Expense Request", filters={"owner": PM_USER}, pluck="name"):
			frappe.db.delete("Nirmaan Notifications", {"document": "Expense Request", "docname": r})
			for row in frappe.get_all("Non Project Expenses", filters={"request_id": r}, pluck="name"):
				frappe.delete_doc("Non Project Expenses", row, force=True, ignore_permissions=True)
			frappe.delete_doc("Expense Request", r, force=True, ignore_permissions=True)
		for dt in ("Nirmaan Users", "User"):
			if frappe.db.exists(dt, PM_USER):
				frappe.delete_doc(dt, PM_USER, force=True, ignore_permissions=True)
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		frappe.set_user("Administrator")
		routing.clear_cache()
		self.expense_type = self._make_type(BEFORE)

	def tearDown(self):
		routing.clear_cache()
		frappe.set_user("Administrator")

	def _make_type(self, fmt):
		name = f"exr_snap_test_et_{frappe.generate_hash(length=6)}"
		d = frappe.new_doc("Expense Type")
		d.update({"expense_name": name, "project": 0, "non_project": 1,
		          "source_format": json.dumps(fmt),
		          "source_format_enabled": 1})
		d.set("allowed_roles", [{"role_profile": PM_PROFILE}])
		d.insert(ignore_permissions=True)
		frappe.db.commit()
		routing.clear_cache()
		self.addCleanup(self._drop_type, name)
		return name

	def _drop_type(self, name):
		frappe.set_user("Administrator")
		for r in frappe.get_all("Expense Request", filters={"type": name}, pluck="name"):
			for row in frappe.get_all("Non Project Expenses", filters={"request_id": r}, pluck="name"):
				frappe.delete_doc("Non Project Expenses", row, force=True, ignore_permissions=True)
			frappe.db.delete("Nirmaan Notifications", {"document": "Expense Request", "docname": r})
			frappe.delete_doc("Expense Request", r, force=True, ignore_permissions=True)
		frappe.delete_doc("Expense Type", name, force=True, ignore_permissions=True)
		frappe.db.commit()

	def _raise(self, **detail):
		data = _answers(BEFORE, **detail)
		data["attachments"] = {"bill": [BILL]}
		frappe.set_user(PM_USER)
		try:
			return create_expense_request(expense_type=self.expense_type, amount=4300,
			                              source_data=data)["name"]
		finally:
			frappe.set_user("Administrator")

	def _change_form(self, fmt):
		"""The fixture's migrate, as it lands on the type: the format replaced or cleared."""
		frappe.db.set_value("Expense Type", self.expense_type, {
			"source_format": json.dumps(fmt) if fmt else None,
			"source_format_enabled": 1 if fmt else 0})
		frappe.db.commit()

	def _expense(self, name):
		created = approve_expense_request(name)["created_expense"]
		return frappe.db.get_value("Non Project Expenses", created,
		                           ["description", "invoice_attachment"], as_dict=True)

	def test_a_trimmed_form_leaves_the_request_page_showing_what_was_asked(self):
		name = self._raise(guest="Asha", hotel="Taj")
		self._change_form(AFTER)

		detail = get_expense_request(name)["detail"]
		self.assertEqual([(d["label"], d["value"]) for d in detail],
		                 [("Guest Name", "Asha"), ("Hotel", "Taj")])

	def test_the_request_page_shows_the_bill_from_the_slot_it_was_uploaded_to(self):
		name = self._raise(guest="Asha", hotel="Taj")
		self._change_form(None)

		self.assertEqual(get_expense_request(name)["invoice"], {"invoice_attachment": BILL})

	def test_a_trimmed_form_leaves_the_reviewer_list_showing_what_was_asked(self):
		name = self._raise(guest="Asha", hotel="Taj")
		self._change_form(AFTER)

		row = next(r for r in get_my_expense_requests()["requests"] if r["name"] == name)
		self.assertEqual([(d["label"], d["value"]) for d in row["detail"]],
		                 [("Guest Name", "Asha"), ("Hotel", "Taj")])

	def test_approved_after_the_trim_it_writes_its_own_sentence_and_carries_its_bill(self):
		name = self._raise(guest="Asha", hotel="Taj")
		self._change_form(AFTER)

		row = self._expense(name)
		self.assertEqual(row.description, f"Stay for Asha at Taj. · [{name}]")
		self.assertEqual(row.invoice_attachment, BILL)

	def test_a_type_that_lost_its_form_still_reads_the_request_against_it(self):
		name = self._raise(guest="Asha", hotel="Taj")
		self._change_form(None)

		detail = get_expense_request(name)["detail"]
		self.assertEqual([(d["label"], d["value"]) for d in detail],
		                 [("Guest Name", "Asha"), ("Hotel", "Taj")])
		row = self._expense(name)
		self.assertEqual(row.description, f"Stay for Asha at Taj. · [{name}]")
		self.assertEqual(row.invoice_attachment, BILL)

	def test_an_edit_refills_the_request_against_todays_form(self):
		name = self._raise(guest="Asha", hotel="Taj")
		self._change_form(AFTER)

		frappe.set_user(PM_USER)
		try:
			update_expense_request(name, expense_type=self.expense_type, amount=4300,
			                       source_data=_answers(AFTER, guest="Ravi"))
		finally:
			frappe.set_user("Administrator")

		detail = get_expense_request(name)["detail"]
		self.assertEqual([(d["label"], d["value"]) for d in detail], [("Guest", "Ravi")])
		self.assertEqual(self._expense(name).description, f"Stay for Ravi. · [{name}]")

	def _raised_before_snapshots(self, **detail):
		"""A request as one raised before #1503 is stored: its answers carry no snapshot."""
		name = self._raise(**detail)
		data = json.loads(frappe.db.get_value("Expense Request", name, "source_data"))
		data.pop("snapshotHash", None)
		frappe.db.set_value("Expense Request", name, "source_data", json.dumps(data),
		                    update_modified=False)
		frappe.db.commit()
		return name

	def test_the_migration_freezes_the_form_of_a_request_raised_before_snapshots(self):
		from nirmaan_stack.patches.v3_0 import freeze_expense_request_forms

		name = self._raised_before_snapshots(guest="Asha", hotel="Taj")
		freeze_expense_request_forms.execute()
		self._change_form(None)

		detail = get_expense_request(name)["detail"]
		self.assertEqual([(d["label"], d["value"]) for d in detail],
		                 [("Guest Name", "Asha"), ("Hotel", "Taj")])
		row = self._expense(name)
		self.assertEqual(row.description, f"Stay for Asha at Taj. · [{name}]")
		self.assertEqual(row.invoice_attachment, BILL)

	def test_the_migration_run_twice_leaves_a_request_as_the_first_run_did(self):
		from nirmaan_stack.patches.v3_0 import freeze_expense_request_forms

		name = self._raised_before_snapshots(guest="Asha", hotel="Taj")
		freeze_expense_request_forms.execute()
		first = frappe.db.get_value("Expense Request", name, "source_data")
		self._change_form(AFTER)
		freeze_expense_request_forms.execute()

		self.assertEqual(frappe.db.get_value("Expense Request", name, "source_data"), first)
		self.assertEqual([(d["label"], d["value"]) for d in get_expense_request(name)["detail"]],
		                 [("Guest Name", "Asha"), ("Hotel", "Taj")])
