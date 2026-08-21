# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Expense Request API — create, the server-side review gate, and the ledger row it mints.

⚠️ These run against the LIVE localhost site, so every fixture is namespaced `exr_test_` and
torn down. Nothing here may touch a production row.

Run:
  bench --site localhost run-tests --app nirmaan_stack \
    --module nirmaan_stack.api.expense_requests.test_expense_requests
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.create import create_expense_request
from nirmaan_stack.api.expense_requests.read import (
	get_my_expense_requests,
	get_request_catalog,
)
from nirmaan_stack.api.expense_requests.review import (
	approve_expense_request,
	reject_expense_request,
)
from nirmaan_stack.services import expense_request_routing as routing

PM_USER = "exr_test_pm@example.com"
PM2_USER = "exr_test_pm2@example.com"
HR_USER = "exr_test_hr@example.com"

PROJECT_TYPE = "Staff Accommodation Rent"      # project=1, non_project=0
NON_PROJECT_TYPE = "Travel Expenses (Bus)"     # project=0, non_project=1
BOTH_TYPE = "Petty Cash"                       # project=1, non_project=1
HOTEL_CATEGORY = "Hotel & Accommodation"


def _make_user(email: str, profile: str, roles: tuple[str, ...]):
	"""Create a test actor on BOTH axes, because they are genuinely separate.

	`Nirmaan Users.role_profile` is what this feature's gates read; Frappe's DocPerms read
	the User's ROLES. Nothing syncs them, so a fixture that sets only one passes every check
	on that axis and fails on the other.

	⚠️ Inserting the User ALSO creates the `Nirmaan Users` row — `create_user_profile` is
	wired to User `after_insert`. Never insert that row here (PK collision); set the profile
	on the auto-created one, AFTER `add_roles` (which saves the User and fires
	`on_user_update`).
	"""
	if not frappe.db.exists("User", email):
		u = frappe.new_doc("User")
		u.update({"email": email, "first_name": email.split("@")[0], "send_welcome_email": 0})
		u.flags.no_welcome_mail = True
		u.insert(ignore_permissions=True)
	frappe.get_doc("User", email).add_roles(*roles)
	frappe.db.set_value("Nirmaan Users", email, "role_profile", profile, update_modified=False)


class TestExpenseRequests(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		for email, profile, roles in (
			(PM_USER, "Nirmaan Project Manager Profile", ("Nirmaan Project Manager",)),
			(PM2_USER, "Nirmaan Project Manager Profile", ("Nirmaan Project Manager",)),
			# DELIBERATELY without System Manager. The real HR Executive Profile carries it
			# but HR LEAD does not, and the domain doc warns HR's write access on the
			# ledgers only works via that accident. Testing the strict case proves this
			# feature's own DocPerms stand alone.
			(HR_USER, "Nirmaan HR Executive Profile", ("Nirmaan HR Executive",)),
		):
			_make_user(email, profile, roles)

		p = frappe.new_doc("Projects")
		p.project_name = f"exr_test_{frappe.generate_hash(length=6)}"
		p.project_start_date = frappe.utils.now()[:19]
		p.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
		p.project_scopes = {"scopes": []}
		p.insert(ignore_permissions=True)
		cls.project = p.name
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		for r in frappe.get_all("Expense Request",
		                        filters={"owner": ["in", [PM_USER, PM2_USER, HR_USER]]}):
			for n in frappe.get_all("Nirmaan Notifications",
			                        filters={"document": "Expense Request", "docname": r.name}):
				frappe.delete_doc("Nirmaan Notifications", n.name, force=True,
				                  ignore_permissions=True)
			frappe.delete_doc("Expense Request", r.name, force=True, ignore_permissions=True)
		# Ledger rows are owned by whoever approved, so they are found by the request id the
		# composed description carries -- the only durable link back on the non-project side.
		for dt in ("Project Expenses", "Non Project Expenses"):
			for r in frappe.get_all(dt, filters={"description": ["like", "%[EXR-%"]}):
				frappe.delete_doc(dt, r.name, force=True, ignore_permissions=True)
		frappe.delete_doc("Projects", cls.project, force=True, ignore_permissions=True)
		for email in (PM_USER, PM2_USER, HR_USER):
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

	# --- helpers -------------------------------------------------------------

	def _raise_as(self, user, **kw):
		"""Raise a request the way the DIALOG does.

		The doctype has NO `description` field -- a format-less description is folded into
		`source_data` under the synthetic `detail.description` key. This helper does the
		same, so `description=` still reads naturally in a test and still exercises the one
		path the product uses. An explicit `source_data=` wins.
		"""
		frappe.set_user(user)
		payload = {"expense_type": NON_PROJECT_TYPE, "amount": 4300}
		desc = kw.pop("description", "test req")
		if desc and "source_data" not in kw:
			kw["source_data"] = {"responses": {"detail": {"description": desc}}}
		payload.update(kw)
		try:
			return create_expense_request(**payload)
		finally:
			frappe.set_user("Administrator")

	def _set_format(self, expense_type: str, fmt: str | None):
		"""Set a type's format for one test, restoring the ORIGINAL afterwards.

		⚠️ NOT `addCleanup(..., None)`. These suites run against the LIVE site, and the
		shipped accommodation/travel formats live on these very types -- resetting to a
		hardcoded None silently wiped one of them, which is precisely the failure the
		capture-the-original rule exists to prevent.
		"""
		original = frappe.db.get_value("Expense Type", expense_type, "source_format")
		frappe.db.set_value("Expense Type", expense_type, "source_format", fmt)
		self.addCleanup(
			frappe.db.set_value, "Expense Type", expense_type, "source_format", original
		)

	def _route_hotel_to(self, role_profile):
		"""Point the Hotel & Accommodation category at a reviewer, restoring the ORIGINAL.

		Routing is master DATA now, so a test that changes it mutates a live row -- capture
		and restore, never a hardcoded reset.
		"""
		original = frappe.db.get_value("Expense Category", HOTEL_CATEGORY, "reviewer_role")
		frappe.db.set_value("Expense Category", HOTEL_CATEGORY, "reviewer_role", role_profile)
		routing.clear_cache()
		def _restore():
			frappe.db.set_value("Expense Category", HOTEL_CATEGORY, "reviewer_role", original)
			routing.clear_cache()
		self.addCleanup(_restore)

	# --- create --------------------------------------------------------------

	def test_create_lands_at_pending_approval(self):
		res = self._raise_as(PM_USER)
		self.assertEqual(res["status"], "Pending Approval")
		self.assertIsNone(res["projects"])

	def test_unknown_type_is_refused(self):
		frappe.set_user(PM_USER)
		with self.assertRaises(frappe.PermissionError):
			create_expense_request(expense_type="Definitely Not A Type", amount=100)
		frappe.set_user("Administrator")

	def test_project_type_requires_a_project(self):
		with self.assertRaises(frappe.ValidationError):
			self._raise_as(PM_USER, expense_type=PROJECT_TYPE, amount=5000)

	def test_non_project_type_refuses_a_project(self):
		with self.assertRaises(frappe.ValidationError):
			self._raise_as(PM_USER, expense_type=NON_PROJECT_TYPE, projects=self.project)

	def test_both_flag_type_accepts_either(self):
		a = self._raise_as(PM_USER, expense_type=BOTH_TYPE, amount=200)
		b = self._raise_as(PM_USER, expense_type=BOTH_TYPE, amount=200, projects=self.project)
		self.assertIsNone(a["projects"])
		self.assertEqual(b["projects"], self.project)

	def test_source_data_accepts_an_object_and_stores_json(self):
		res = self._raise_as(PM_USER, source_data={"responses": {"stay": {"nights": 2}}})
		stored = frappe.db.get_value("Expense Request", res["name"], "source_data")
		self.assertIn('"nights"', stored)

	def test_source_data_is_optional(self):
		res = self._raise_as(PM_USER, description=None)
		self.assertIsNone(frappe.db.get_value("Expense Request", res["name"], "source_data"))

	def test_a_format_less_request_stores_its_description_in_source_data(self):
		"""`source_data` is the ONLY home for the detail, format or not."""
		res = self._raise_as(PM_USER, description="Bus to site",
		                     source_data={"responses": {"detail": {"description": "Bus to site"}}})
		stored = frappe.db.get_value("Expense Request", res["name"], "source_data")
		self.assertIn("Bus to site", stored)

	def test_a_format_less_request_is_described_by_its_values_alone(self):
		"""No format means no labels: the ledger reads exactly what the requester typed.

		The `detail.description` key is OURS, not something they filled in, so printing it
		would put the word "Description:" on the ledger as if they had written it.
		"""
		self._set_format(NON_PROJECT_TYPE, None)
		res = self._raise_as(PM_USER, description="Bus to site",
		                     source_data={"responses": {"detail": {"description": "Bus to site"}}})
		out = approve_expense_request(res["name"])
		desc = frappe.db.get_value("Non Project Expenses", out["created_expense"], "description")
		self.assertEqual(desc, f"Bus to site · [{res['name']}]")
		self.assertNotIn("Description:", desc)

	# --- the review gate -----------------------------------------------------

	def test_pm_cannot_approve(self):
		res = self._raise_as(PM_USER)
		frappe.set_user(PM_USER)
		with self.assertRaises(frappe.PermissionError):
			approve_expense_request(res["name"])
		frappe.set_user("Administrator")
		self.assertEqual(frappe.db.get_value("Expense Request", res["name"], "status"),
		                 "Pending Approval")

	def test_unrouted_role_cannot_approve(self):
		# HR reviews nothing by default -- every category ships unrouted, so all of it is Admin's.
		res = self._raise_as(PM_USER)
		frappe.set_user(HR_USER)
		with self.assertRaises(frappe.PermissionError):
			approve_expense_request(res["name"])
		frappe.set_user("Administrator")

	def test_routed_reviewer_can_approve(self):
		self._route_hotel_to("Nirmaan HR Executive Profile")
		res = self._raise_as(PM_USER, expense_type="Hotel Expenses", amount=6000)
		frappe.set_user(HR_USER)
		out = approve_expense_request(res["name"])
		frappe.set_user("Administrator")
		self.assertEqual(out["status"], "Approved")

	def test_reviewer_cannot_approve_their_own_request(self):
		"""Self-review is blocked even when the caller IS the routed reviewer.

		Routed to the PM profile deliberately: HR has no `create` DocPerm (reviewers do not
		raise requests), so HR could never reach this state. A category misconfigured onto
		the requesting role is the reachable version of it.
		"""
		self._route_hotel_to("Nirmaan Project Manager Profile")
		res = self._raise_as(PM_USER, expense_type="Hotel Expenses", amount=6000)
		frappe.set_user(PM_USER)
		with self.assertRaises(frappe.PermissionError):
			approve_expense_request(res["name"])
		frappe.set_user("Administrator")

	def test_a_refused_approval_mutates_nothing(self):
		res = self._raise_as(PM_USER)
		before = frappe.db.count("Non Project Expenses")
		frappe.set_user(PM_USER)
		with self.assertRaises(frappe.PermissionError):
			approve_expense_request(res["name"])
		frappe.set_user("Administrator")
		self.assertEqual(frappe.db.count("Non Project Expenses"), before)

	# --- what approval creates ----------------------------------------------

	def test_ledger_row_is_created_at_approved_not_requested(self):
		"""The load-bearing one. `Approved` is what bypasses the < 5,000 auto-approve AND
		what keeps the row out of the `Requested` queue nothing drains."""
		res = self._raise_as(PM_USER, amount=1000)  # deliberately under the limit
		out = approve_expense_request(res["name"])
		self.assertEqual(
			frappe.db.get_value("Non Project Expenses", out["created_expense"], "status"),
			"Approved",
		)

	def test_no_project_targets_the_non_project_ledger(self):
		out = approve_expense_request(self._raise_as(PM_USER)["name"])
		self.assertEqual(out["created_expense_doctype"], "Non Project Expenses")

	def test_a_project_targets_the_project_ledger_and_carries_it(self):
		res = self._raise_as(PM_USER, expense_type=PROJECT_TYPE, amount=5000,
		                     projects=self.project)
		out = approve_expense_request(res["name"])
		self.assertEqual(out["created_expense_doctype"], "Project Expenses")
		row = frappe.get_doc("Project Expenses", out["created_expense"])
		self.assertEqual(row.projects, self.project)
		# ₹5,000 EXACTLY is not below the limit -- the rule is a strict `<`.
		self.assertEqual(row.status, "Requested")

	def test_the_ledger_rule_decides_the_status_not_the_approval(self):
		"""Owner ruling 2026-08-20: approval no longer forces `Approved`.

		The row is born at the ledger default and each doctype's own `validate` applies the
		SAME threshold it applies to a directly-entered row.
		"""
		for amount, expected in ((900, "Approved"), (4999, "Approved"),
		                         (5000, "Requested"), (20000, "Requested")):
			with self.subTest(amount=amount):
				out = approve_expense_request(self._raise_as(PM_USER, amount=amount)["name"])
				self.assertEqual(
					frappe.db.get_value(out["created_expense_doctype"],
					                    out["created_expense"], "status"),
					expected)

	def test_amount_is_formatted_per_target_ledger(self):
		npo = approve_expense_request(self._raise_as(PM_USER, amount=7500)["name"])
		# Non Project Expenses.amount is Currency -> numeric
		self.assertEqual(
			float(frappe.db.get_value("Non Project Expenses", npo["created_expense"], "amount")),
			7500.0)
		po = approve_expense_request(
			self._raise_as(PM_USER, expense_type=PROJECT_TYPE, amount=7500,
			               projects=self.project)["name"])
		# Project Expenses.amount is Data -> a bare numeric string, no ".0" tail
		self.assertEqual(
			frappe.db.get_value("Project Expenses", po["created_expense"], "amount"), "7500")

	def test_comment_and_detail_reach_the_ledger(self):
		res = self._raise_as(PM_USER, description="Bus to site", comment="reimburse Anil")
		out = approve_expense_request(res["name"])
		row = frappe.get_doc("Non Project Expenses", out["created_expense"])
		self.assertIn("Bus to site", row.description)
		self.assertIn(res["name"], row.description)   # the only link back on this ledger
		self.assertEqual(row.comment, "reimburse Anil")

	def test_ledger_row_links_back_to_the_request(self):
		"""The link points BACKWARDS: the expense names its request, not the reverse.

		A ledger row may be raised directly with no request at all, so the side that may or
		may not have a counterpart is the side that carries the field.
		"""
		res = self._raise_as(PM_USER)
		out = approve_expense_request(res["name"])
		self.assertEqual(
			frappe.db.get_value(out["created_expense_doctype"], out["created_expense"],
			                    "request_id"),
			res["name"])

	def test_paid_on_the_ledger_carries_back_to_the_request(self):
		"""Marking the expense Paid is what makes the request Paid. Nothing else does."""
		res = self._raise_as(PM_USER)
		out = approve_expense_request(res["name"])
		self.assertEqual(
			frappe.db.get_value("Expense Request", res["name"], "status"), "Approved")

		row = frappe.get_doc(out["created_expense_doctype"], out["created_expense"])
		row.status = "Paid"
		row.save(ignore_permissions=True)
		frappe.db.commit()

		self.assertEqual(
			frappe.db.get_value("Expense Request", res["name"], "status"), "Paid")

	def test_deleting_the_expense_deletes_its_request(self):
		"""The cascade the framework will NOT do: a Link is a reference, not ownership."""
		res = self._raise_as(PM_USER)
		out = approve_expense_request(res["name"])
		self.assertTrue(frappe.db.exists("Expense Request", res["name"]))

		frappe.delete_doc(out["created_expense_doctype"], out["created_expense"],
		                  ignore_permissions=True)
		frappe.db.commit()

		self.assertFalse(frappe.db.exists("Expense Request", res["name"]))

	def test_deleting_a_PAID_expense_deletes_its_request_and_its_notifications(self):
		"""The case a naive cascade FAILS on.

		`Nirmaan Notifications.docname` is a Dynamic Link, and Frappe's delete guard walks
		dynamic links -- so a paid request (which always carries a Paid notification) cannot
		be deleted until those notifications are cleared.
		"""
		res = self._raise_as(PM_USER)
		out = approve_expense_request(res["name"])
		row = frappe.get_doc(out["created_expense_doctype"], out["created_expense"])
		row.status = "Paid"
		row.save(ignore_permissions=True)
		frappe.db.commit()
		self.assertEqual(len(self._notes_for(res["name"])), 1)   # the guard's trigger

		frappe.delete_doc(out["created_expense_doctype"], out["created_expense"],
		                  ignore_permissions=True)
		frappe.db.commit()

		self.assertFalse(frappe.db.exists("Expense Request", res["name"]))
		self.assertEqual(self._notes_for(res["name"]), [])

	def test_deleting_an_unrelated_expense_deletes_no_request(self):
		"""Fires on EVERY delete of both ledgers; no `request_id` means no-op."""
		res = self._raise_as(PM_USER)
		approve_expense_request(res["name"])

		row = frappe.new_doc("Non Project Expenses")
		row.update({"type": NON_PROJECT_TYPE, "status": "Approved", "amount": 700,
		            "description": "exr_test_ direct expense"})
		row.insert(ignore_permissions=True)
		frappe.db.commit()
		frappe.delete_doc("Non Project Expenses", row.name, ignore_permissions=True)
		frappe.db.commit()

		self.assertTrue(frappe.db.exists("Expense Request", res["name"]))

	def test_paid_on_an_unrelated_expense_touches_no_request(self):
		"""The hook fires on EVERY save of both ledgers; no `request_id` means no-op."""
		res = self._raise_as(PM_USER)
		approve_expense_request(res["name"])

		row = frappe.new_doc("Non Project Expenses")
		row.update({"type": NON_PROJECT_TYPE, "status": "Approved", "amount": 900,
		            "description": "exr_test_ direct expense"})
		row.insert(ignore_permissions=True)
		row.status = "Paid"
		row.save(ignore_permissions=True)
		frappe.db.commit()

		self.assertEqual(
			frappe.db.get_value("Expense Request", res["name"], "status"), "Approved")

	def test_double_approval_is_refused(self):
		res = self._raise_as(PM_USER)
		approve_expense_request(res["name"])
		before = frappe.db.count("Non Project Expenses")
		with self.assertRaises(frappe.ValidationError):
			approve_expense_request(res["name"])
		# A second ledger row for one ask would be real duplicated money.
		self.assertEqual(frappe.db.count("Non Project Expenses"), before)

	# --- the flatten on approve ---------------------------------------------

	def test_source_data_flattens_into_the_ledger_description(self):
		fmt = json.dumps({
			"templateId": "exr-test", "templateVersion": 1,
			"sections": [{"id": "stay", "type": "fields", "fields": [
				{"key": "occupant_name", "label": "Occupant Name", "type": "text"},
				{"key": "nights", "label": "Nights", "type": "number"},
			]}],
		})
		self._set_format(NON_PROJECT_TYPE, fmt)
		if True:
			res = self._raise_as(PM_USER, source_data={"responses": {"stay": {
				"occupant_name": "Wasim Alam", "nights": 2}}})
			out = approve_expense_request(res["name"])
			desc = frappe.db.get_value("Non Project Expenses", out["created_expense"], "description")
			self.assertIn("Occupant Name: Wasim Alam", desc)
			self.assertIn("Nights: 2", desc)
			self.assertIn(res["name"], desc)
			# Envelope metadata must never reach the accountant.
			self.assertNotIn("templateId", desc)

	def test_a_format_less_request_description_is_unchanged(self):
		"""The parity guarantee: no format means exactly the pre-formats description.

		Forces the type format-less for the duration, so the assertion holds whether or not
		this type happens to ship one.
		"""
		self._set_format(NON_PROJECT_TYPE, None)
		res = self._raise_as(PM_USER, description="Plain one")
		out = approve_expense_request(res["name"])
		desc = frappe.db.get_value("Non Project Expenses", out["created_expense"], "description")
		self.assertEqual(desc, f"Plain one · [{res['name']}]")

	def test_a_maps_to_slot_lands_on_invoice_attachment(self):
		fmt = json.dumps({
			"templateId": "exr-test-att", "templateVersion": 1,
			"sections": [{"id": "proof", "type": "image_attachments", "slots": [
				{"key": "bill", "label": "Bill", "maps_to": "invoice_attachment"}]}],
		})
		self._set_format(NON_PROJECT_TYPE, fmt)
		if True:
			res = self._raise_as(PM_USER, source_data={
				"responses": {}, "attachments": {"bill": ["/private/files/x.pdf"]}})
			out = approve_expense_request(res["name"])
			self.assertEqual(
				frappe.db.get_value("Non Project Expenses", out["created_expense"],
				                    "invoice_attachment"),
				"/private/files/x.pdf")

	# --- reject --------------------------------------------------------------

	def test_reject_requires_a_comment(self):
		res = self._raise_as(PM_USER)
		with self.assertRaises(frappe.ValidationError):
			reject_expense_request(res["name"], "   ")
		self.assertEqual(frappe.db.get_value("Expense Request", res["name"], "status"),
		                 "Pending Approval")

	def test_reject_is_terminal_and_creates_no_ledger_row(self):
		res = self._raise_as(PM_USER)
		before = frappe.db.count("Non Project Expenses")
		reject_expense_request(res["name"], "duplicate")
		doc = frappe.get_doc("Expense Request", res["name"])
		self.assertEqual(doc.status, "Rejected")
		self.assertEqual(doc.review_comment, "duplicate")
		self.assertFalse(frappe.db.exists("Non Project Expenses", {"request_id": res["name"]}))
		self.assertEqual(frappe.db.count("Non Project Expenses"), before)
		with self.assertRaises(frappe.ValidationError):
			approve_expense_request(res["name"])

	# --- notifications --------------------------------------------------------

	def _notes_for(self, request_name):
		return frappe.get_all("Nirmaan Notifications",
		                      filters={"document": "Expense Request", "docname": request_name},
		                      fields=["title", "recipient", "event_id", "action_url", "type"])

	def test_approval_notifies_nobody(self):
		"""Approval is DELIBERATELY SILENT -- only Rejected and Paid reach the requester.

		Approve and Paid are one story to a requester and the money has not moved yet, so the
		approval message was noise that cost attention from the one that matters.
		"""
		res = self._raise_as(PM_USER)
		approve_expense_request(res["name"])
		self.assertEqual(self._notes_for(res["name"]), [])

	def test_rejection_notifies_with_the_reason(self):
		res = self._raise_as(PM_USER)
		reject_expense_request(res["name"], "over budget this month")
		notes = self._notes_for(res["name"])
		self.assertEqual(len(notes), 1)
		self.assertEqual(notes[0].event_id, "expense_request:rejected")
		self.assertEqual(notes[0].type, "warning")

	def test_marking_the_expense_paid_notifies_the_requester(self):
		res = self._raise_as(PM_USER)
		out = approve_expense_request(res["name"])
		row = frappe.get_doc("Non Project Expenses", out["created_expense"])
		row.status = "Paid"
		row.save(ignore_permissions=True)
		frappe.db.commit()
		# The ONLY notification this request ever produces -- approval said nothing.
		notes = self._notes_for(res["name"])
		self.assertEqual(len(notes), 1)
		self.assertEqual(notes[0].event_id, "expense_request:paid")
		self.assertEqual(notes[0].recipient, PM_USER)
		# The requester can only see the Requests tab -- never link them at the ledger row.
		self.assertEqual(notes[0].action_url, "expense/requests")

	def test_editing_an_already_paid_expense_does_not_re_notify(self):
		"""Fires on the TRANSITION into Paid, not on the state."""
		res = self._raise_as(PM_USER)
		out = approve_expense_request(res["name"])
		row = frappe.get_doc("Non Project Expenses", out["created_expense"])
		row.status = "Paid"; row.save(ignore_permissions=True)
		row.reload(); row.comment = "touched again"; row.save(ignore_permissions=True)
		frappe.db.commit()
		paid = [n for n in self._notes_for(res["name"]) if n.event_id == "expense_request:paid"]
		self.assertEqual(len(paid), 1)

	def test_an_ordinary_expense_paid_notifies_nobody(self):
		"""The hook fires on EVERY save of both ledgers -- it must stay silent for the ~3,300
		rows that were never born from a request."""
		before = frappe.db.count("Nirmaan Notifications")
		row = frappe.new_doc("Non Project Expenses")
		row.update({"type": NON_PROJECT_TYPE, "amount": 100, "status": "Approved",
		            "description": "exr_test ordinary row"})
		row.insert(ignore_permissions=True)
		row.status = "Paid"; row.save(ignore_permissions=True)
		frappe.db.commit()
		self.addCleanup(frappe.delete_doc, "Non Project Expenses", row.name,
		                force=True, ignore_permissions=True)
		self.assertEqual(frappe.db.count("Nirmaan Notifications"), before)

	# --- vendor: the native field the dialog actually uses --------------------

	def test_a_vendor_is_stored_and_reaches_the_project_ledger(self):
		vendor = self._a_vendor()
		res = self._raise_as(PM_USER, expense_type=PROJECT_TYPE, projects=self.project,
		                     vendor=vendor)
		self.assertEqual(frappe.db.get_value("Expense Request", res["name"], "vendor"), vendor)
		out = approve_expense_request(res["name"])
		self.assertEqual(
			frappe.db.get_value("Project Expenses", out["created_expense"], "vendor"), vendor)

	def test_a_vendor_without_a_project_is_REFUSED(self):
		"""`Non Project Expenses` has no vendor column, so it could only vanish at approval.

		Refusing is the honest half: the requester is told, rather than discovering it later.
		"""
		with self.assertRaises(frappe.ValidationError):
			self._raise_as(PM_USER, expense_type=NON_PROJECT_TYPE, vendor=self._a_vendor())

	def test_an_explicit_vendor_outranks_a_promoted_one(self):
		"""The requester chose one on screen; a format only inferred one."""
		rows = frappe.get_all("Vendors", limit=2)
		if len(rows) < 2:
			self.skipTest("needs two Vendors")
		chosen, inferred = rows[0].name, rows[1].name
		self._set_format(PROJECT_TYPE, json.dumps(self.VENDOR_FORMAT))
		res = self._raise_as(PM_USER, expense_type=PROJECT_TYPE, projects=self.project,
			vendor=chosen,
			source_data={"responses": {"detail": {"what": "cement", "supplier": inferred}}})
		self.assertEqual(frappe.db.get_value("Expense Request", res["name"], "vendor"), chosen)

	# --- maps_to: a format field that owns a real column ----------------------

	VENDOR_FORMAT = {
		"templateId": "test-vendor", "templateVersion": 1, "title": "T",
		"sections": [{"id": "detail", "type": "fields", "fields": [
			{"key": "what", "label": "Material", "type": "text"},
			# THE DECLARATION -- the same one the bill already uses, on a FIELD
			{"key": "supplier", "label": "Vendor", "type": "link",
			 "options": "Vendors", "maps_to": "vendor"},
		]}],
	}

	def _a_vendor(self):
		rows = frappe.get_all("Vendors", limit=1)
		if not rows:
			self.skipTest("no Vendors on this site")
		return rows[0].name

	def test_a_mapped_answer_is_promoted_to_the_request_column(self):
		vendor = self._a_vendor()
		self._set_format(PROJECT_TYPE, json.dumps(self.VENDOR_FORMAT))
		res = self._raise_as(PM_USER, expense_type=PROJECT_TYPE, projects=self.project,
			source_data={"responses": {"detail": {"what": "cement", "supplier": vendor}}})
		self.assertEqual(frappe.db.get_value("Expense Request", res["name"], "vendor"), vendor)

	def test_a_promoted_answer_is_NOT_repeated_in_the_description(self):
		"""It owns a column now. Printing it too is how the prose and the link disagree."""
		vendor = self._a_vendor()
		self._set_format(PROJECT_TYPE, json.dumps(self.VENDOR_FORMAT))
		res = self._raise_as(PM_USER, expense_type=PROJECT_TYPE, projects=self.project,
			source_data={"responses": {"detail": {"what": "cement", "supplier": vendor}}})
		out = approve_expense_request(res["name"])
		desc = frappe.db.get_value(out["created_expense_doctype"], out["created_expense"],
		                           "description")
		self.assertIn("cement", desc)
		self.assertNotIn(vendor, desc)

	def test_the_vendor_reaches_the_project_ledger(self):
		vendor = self._a_vendor()
		self._set_format(PROJECT_TYPE, json.dumps(self.VENDOR_FORMAT))
		res = self._raise_as(PM_USER, expense_type=PROJECT_TYPE, projects=self.project,
			source_data={"responses": {"detail": {"what": "cement", "supplier": vendor}}})
		out = approve_expense_request(res["name"])
		self.assertEqual(out["created_expense_doctype"], "Project Expenses")
		self.assertEqual(
			frappe.db.get_value("Project Expenses", out["created_expense"], "vendor"), vendor)

	def test_a_maps_to_naming_an_unlisted_column_is_ignored(self):
		"""`maps_to` is read from admin-edited data, so the allowlist is the boundary --
		without it a format could aim at `status` or `amount`."""
		fmt = json.loads(json.dumps(self.VENDOR_FORMAT))
		fmt["sections"][0]["fields"][1]["maps_to"] = "status"
		self._set_format(PROJECT_TYPE, json.dumps(fmt))
		res = self._raise_as(PM_USER, expense_type=PROJECT_TYPE, projects=self.project,
			source_data={"responses": {"detail": {"what": "cement", "supplier": "Paid"}}})
		self.assertEqual(
			frappe.db.get_value("Expense Request", res["name"], "status"), "Pending Approval")

	def test_a_blank_mapped_answer_writes_no_link(self):
		self._set_format(PROJECT_TYPE, json.dumps(self.VENDOR_FORMAT))
		res = self._raise_as(PM_USER, expense_type=PROJECT_TYPE, projects=self.project,
			source_data={"responses": {"detail": {"what": "cement", "supplier": "  "}}})
		self.assertFalse(frappe.db.get_value("Expense Request", res["name"], "vendor"))

	# --- duplicate detection -------------------------------------------------

	def _travel(self, user, traveller, depart):
		return self._raise_as(user, source_data={
			"responses": {"detail": {"traveller_name": traveller, "depart_date": depart}}})

	def _travel_direct(self, traveller, depart):
		"""Insert a request BYPASSING the endpoint, so a duplicate pair can exist to display.

		The submission guard refuses the second one, which is the point of it -- but the
		reviewer's panel must still render a pair raised before the guard existed.
		"""
		doc = frappe.new_doc("Expense Request")
		doc.update({
			"type": NON_PROJECT_TYPE, "amount": 4300, "status": "Pending Approval",
			# ⚠️ OWNER must be a test user: `tearDownClass` cleans by ownership, so a row
			# inserted as Administrator survives the run and accumulates into the next one --
			# which is exactly how this test started seeing five hits instead of one.
			"owner": PM_USER,
			"source_data": json.dumps({
				"responses": {"detail": {"traveller_name": traveller, "depart_date": depart}}}),
		})
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		return doc

	def test_overlap_is_a_shared_day_not_an_equal_range(self):
		"""1--31 Aug against 15 Aug--14 Sep is still a double payment for the shared days."""
		from nirmaan_stack.api.expense_requests.duplicates import overlaps
		from frappe.utils import getdate as d
		aug = (d("2026-08-01"), d("2026-08-31"))
		self.assertTrue(overlaps(aug, (d("2026-08-15"), d("2026-09-14"))))   # partial
		self.assertTrue(overlaps(aug, aug))                                   # identical
		self.assertTrue(overlaps(aug, (d("2026-08-31"), d("2026-09-30"))))   # one shared day
		self.assertFalse(overlaps(aug, (d("2026-09-01"), d("2026-09-30"))))  # adjacent
		# An unknown period is NOT an overlap -- absence is not evidence, and this decides
		# a refusal.
		self.assertFalse(overlaps(aug, (None, None)))

	def test_subject_ignores_spacing_and_case_but_never_spelling(self):
		from nirmaan_stack.api.expense_requests.duplicates import normalise, subject_of
		rule = {"match_on": ["a"]}
		self.assertEqual(normalise("  Sri Sai   Annapoorana PG "), "sri sai annapoorana pg")
		self.assertEqual(subject_of({"a": "Shahbaj Khan"}, rule),
		                 subject_of({"a": " shahbaj  KHAN "}, rule))
		# Two DIFFERENT spellings of one building stay different -- that is a judgement,
		# not a normalisation, which is why the property is shown and never matched.
		self.assertNotEqual(subject_of({"a": "Sri Sai Annapoorana PG"}, rule),
		                    subject_of({"a": "Sri Sai"}, rule))
		# A blank subject can never match: two unnamed requests are not the same person.
		self.assertIsNone(subject_of({"a": "  "}, rule))
		self.assertIsNone(subject_of({}, rule))

	def _check(self, expense_type, answers):
		from nirmaan_stack.api.expense_requests.similar import check_new_request
		return check_new_request(expense_type, json.dumps({"responses": {"detail": answers}}))

	def test_a_duplicate_is_WARNED_ABOUT_and_never_refused(self):
		"""Owner ruling 2026-08-20, REVERSING the submission block.

		A duplicate cannot be told from a legitimate repeat with certainty, so the judgement
		belongs to a human -- and a refusal the requester disagrees with has nowhere to go.
		"""
		first = self._travel(PM_USER, "Asha Traveller", "2026-09-01")
		warned = self._check(NON_PROJECT_TYPE,
		                     {"traveller_name": "Asha Traveller", "depart_date": "2026-09-01"})
		self.assertEqual([h["name"] for h in warned["overlapping"]], [first["name"]])
		self.assertEqual(warned["subject"], "Asha Traveller")
		# ...and the second one still goes through.
		second = self._travel(PM_USER, "Asha Traveller", "2026-09-01")
		self.assertTrue(frappe.db.exists("Expense Request", second["name"]))

	def test_the_warning_fires_on_an_overlap_not_only_an_exact_match(self):
		"""Hotel: 18--19 Aug against 19--20 Aug shares a night."""
		frappe.set_user(PM_USER)
		first = create_expense_request(expense_type="Hotel Expenses", amount=3000, source_data={
			"responses": {"detail": {"guest_name": "Ivy Guest",
			                         "check_in": "2026-09-18", "check_out": "2026-09-19"}}})
		frappe.set_user("Administrator")
		warned = self._check("Hotel Expenses", {"guest_name": "Ivy Guest",
		                                        "check_in": "2026-09-19", "check_out": "2026-09-20"})
		self.assertEqual([h["name"] for h in warned["overlapping"]], [first["name"]])

	def test_a_later_trip_raises_no_warning(self):
		"""The monthly-recurring case: same subject, different period, must stay SILENT."""
		self._travel(PM_USER, "Bela Traveller", "2026-09-02")
		self.assertEqual(self._check(NON_PROJECT_TYPE, {
			"traveller_name": "Bela Traveller", "depart_date": "2026-10-02"})["overlapping"], [])

	def test_a_different_person_raises_no_warning(self):
		self._travel(PM_USER, "Chandra Traveller", "2026-09-03")
		self.assertEqual(self._check(NON_PROJECT_TYPE, {
			"traveller_name": "Divya Traveller", "depart_date": "2026-09-03"})["overlapping"], [])

	def test_a_rejected_request_raises_no_warning(self):
		"""It never became money, so it cannot be double-paid."""
		first = self._travel(PM_USER, "Esha Traveller", "2026-09-04")
		reject_expense_request(first["name"], "not needed")
		self.assertEqual(self._check(NON_PROJECT_TYPE, {
			"traveller_name": "Esha Traveller", "depart_date": "2026-09-04"})["overlapping"], [])

	def test_a_type_with_no_rule_is_never_warned_about(self):
		"""34 of 40 types have no answers to compare -- a guess would nag on real work."""
		self._raise_as(PM_USER, expense_type=BOTH_TYPE)
		self.assertEqual(self._check(BOTH_TYPE, {"description": "x"})["overlapping"], [])

	def test_an_unanswered_form_is_never_warned_about(self):
		"""No subject and no period means nothing to compare -- a half-filled form never nags."""
		self._travel(PM_USER, "", "")
		self.assertEqual(self._check(NON_PROJECT_TYPE,
		                             {"traveller_name": "", "depart_date": ""})["overlapping"], [])

	def test_the_reviewer_panel_shows_an_existing_pair(self):
		"""`get_similar` is DISPLAY -- it must still render a pair raised before the guard."""
		from nirmaan_stack.api.expense_requests.similar import get_similar
		# A subject unique to THIS run: the assertion is about the pair just created, and
		# must not depend on the table being empty.
		who = f"Farah Traveller {frappe.generate_hash(length=6)}"
		first = self._travel_direct(who, "2026-09-05")
		second = self._travel_direct(who, "2026-09-05")
		res = get_similar(second.name)
		self.assertEqual([e["name"] for e in res["overlapping"]], [first.name])
		self.assertEqual(res["subject"], who)
		self.assertTrue(res["has_period_check"])

	# --- read visibility -----------------------------------------------------

	def test_a_pm_sees_another_pms_request(self):
		"""There is NO row scoping: the `permission_query_conditions` hook was removed.

		Read is the role's read DocPerm and nothing narrower, so a PM sees requests they did
		not raise. This asserts the CURRENT behaviour deliberately -- if scoping is ever
		wanted back, re-wiring the hook flips this test, which is the point of pinning it.
		"""
		mine = self._raise_as(PM_USER)
		theirs = self._raise_as(PM2_USER)
		frappe.set_user(PM_USER)
		names = [r["name"] for r in get_my_expense_requests()["requests"]]
		frappe.set_user("Administrator")
		self.assertIn(mine["name"], names)
		self.assertIn(theirs["name"], names)

	def test_routed_reviewer_sees_it_and_can_review(self):
		self._route_hotel_to("Nirmaan HR Executive Profile")
		res = self._raise_as(PM_USER, expense_type="Hotel Expenses", amount=6000)
		frappe.set_user(HR_USER)
		rows = get_my_expense_requests()["requests"]
		frappe.set_user("Administrator")
		row = next(r for r in rows if r["name"] == res["name"])
		self.assertTrue(row["can_review"])
		self.assertEqual(row["request_category"], HOTEL_CATEGORY)

	def test_requester_sees_own_but_cannot_review(self):
		res = self._raise_as(PM_USER)
		frappe.set_user(PM_USER)
		rows = get_my_expense_requests()["requests"]
		frappe.set_user("Administrator")
		row = next(r for r in rows if r["name"] == res["name"])
		self.assertFalse(row["can_review"])

	# --- catalog -------------------------------------------------------------

	def test_catalog_reports_flags_and_format_state(self):
		cats = {c["category"]: c for c in get_request_catalog()["categories"]}
		by_type = {t["expense_type"]: t
		           for c in cats.values() for t in c["types"]}
		self.assertTrue(by_type[PROJECT_TYPE]["project_required"])
		self.assertTrue(by_type[PROJECT_TYPE]["project_allowed"])
		self.assertFalse(by_type[NON_PROJECT_TYPE]["project_allowed"])
		# both-flag type: allowed but not required
		self.assertTrue(by_type[BOTH_TYPE]["project_allowed"])
		self.assertFalse(by_type[BOTH_TYPE]["project_required"])
		# `has_format` reports the real state per type. Asserted as a SHAPE, not as
		# "none exist" -- the shipped accommodation/travel formats made that stale.
		self.assertTrue(by_type[PROJECT_TYPE]["has_format"])       # Staff Accommodation Rent
		self.assertTrue(by_type[NON_PROJECT_TYPE]["has_format"])   # Travel (Bus)
		self.assertFalse(by_type["GST Payment"]["has_format"])     # plain form


class TestExpenseTypeMasters(FrappeTestCase):
	"""The Expense Packages tab writes through admin-gated endpoints.

	This matters because `Expense Type` carries `write = 1` for ~15 roles, Project Manager
	among them — so without a server gate a requester could edit the scope and the form
	governing their own requests.
	"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_make_user(PM_USER, "Nirmaan Project Manager Profile", ("Nirmaan Project Manager",))
		frappe.db.commit()
		cls.made: list[str] = []

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		for n in cls.made:
			if frappe.db.exists("Expense Type", n):
				frappe.delete_doc("Expense Type", n, force=True, ignore_permissions=True)
		if frappe.db.exists("Nirmaan Users", PM_USER):
			frappe.delete_doc("Nirmaan Users", PM_USER, force=True, ignore_permissions=True)
		if frappe.db.exists("User", PM_USER):
			frappe.delete_doc("User", PM_USER, force=True, ignore_permissions=True)
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		frappe.set_user("Administrator")

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_pm_cannot_create_an_expense_type(self):
		from nirmaan_stack.api.expense_requests.masters import create_expense_type
		frappe.set_user(PM_USER)
		with self.assertRaises(frappe.PermissionError):
			create_expense_type(expense_name="exr_test_hack", project=1, expense_category="Uncategorized")
		frappe.set_user("Administrator")
		self.assertFalse(frappe.db.exists("Expense Type", "exr_test_hack"))

	def test_pm_cannot_edit_a_format(self):
		"""The refused write must leave the format EXACTLY as it was.

		Compared against the before-value rather than None: Hotel Expenses ships the
		accommodation format, and asserting None would only pass on an unseeded site.
		"""
		from nirmaan_stack.api.expense_requests.masters import save_expense_format
		before = frappe.db.get_value("Expense Type", "Hotel Expenses", "source_format")
		frappe.set_user(PM_USER)
		with self.assertRaises(frappe.PermissionError):
			save_expense_format(name="Hotel Expenses", source_format='{"a":1}')
		frappe.set_user("Administrator")
		self.assertEqual(
			frappe.db.get_value("Expense Type", "Hotel Expenses", "source_format"), before)

	def test_admin_can_create_and_rescope(self):
		from nirmaan_stack.api.expense_requests.masters import (
			create_expense_type, update_expense_type,
		)
		name = f"exr_test_type_{frappe.generate_hash(length=5)}"
		out = create_expense_type(expense_name=name, project=1, non_project=0, expense_category="Uncategorized")
		self.made.append(out["name"])
		self.assertEqual(frappe.db.get_value("Expense Type", name, "project"), 1)
		update_expense_type(name=name, project=1, non_project=1, expense_category="Uncategorized")
		row = frappe.db.get_value("Expense Type", name, ["project", "non_project"], as_dict=True)
		self.assertEqual((row.project, row.non_project), (1, 1))

		# Category is assignable from the app; categories themselves are created in Desk.
		update_expense_type(name=name, project=1, non_project=1, expense_category="Travel")
		self.assertEqual(frappe.db.get_value("Expense Type", name, "expense_category"), "Travel")
		with self.assertRaises(frappe.ValidationError):
			update_expense_type(name=name, project=1, expense_category="Not A Category")

	def test_a_type_with_no_category_is_refused(self):
		"""Every type belongs to a category; 'Uncategorized' is the answer when none of the
		named ones fit. Blank produced a type that appeared in no category list and routed to
		a reviewer nobody had chosen."""
		from nirmaan_stack.api.expense_requests.masters import create_expense_type
		with self.assertRaises(frappe.ValidationError):
			create_expense_type(expense_name="exr_test_nocat", project=1)
		self.assertFalse(frappe.db.exists("Expense Type", "exr_test_nocat"))

	def test_the_runtime_still_tolerates_an_uncategorised_type(self):
		"""The app REQUIRES a category; the runtime must not. A type created directly in Desk
		must never become silently un-requestable."""
		from nirmaan_stack.services import expense_request_routing as r
		name = f"exr_test_desk_{frappe.generate_hash(length=5)}"
		d = frappe.new_doc("Expense Type")
		d.update({"expense_name": name, "non_project": 1})  # no category, as Desk allows
		d.insert(ignore_permissions=True)
		self.made.append(name)
		frappe.db.commit()
		r.clear_cache()
		self.assertTrue(r.is_requestable(name))
		self.assertIsNone(r.category_for_type(name))
		self.assertEqual(r.reviewer_role_for_type(name), r.DEFAULT_REVIEWER_ROLE)
		r.clear_cache()

	def test_a_type_with_neither_scope_is_refused(self):
		from nirmaan_stack.api.expense_requests.masters import create_expense_type
		with self.assertRaises(frappe.ValidationError):
			create_expense_type(expense_name="exr_test_noscope", project=0, non_project=0, expense_category="Uncategorized")
		self.assertFalse(frappe.db.exists("Expense Type", "exr_test_noscope"))

	def test_format_must_be_a_json_object_and_empty_clears_it(self):
		from nirmaan_stack.api.expense_requests.masters import (
			create_expense_type, save_expense_format,
		)
		name = f"exr_test_fmt_{frappe.generate_hash(length=5)}"
		self.made.append(create_expense_type(expense_name=name, non_project=1, expense_category="Uncategorized")["name"])

		with self.assertRaises(frappe.ValidationError):
			save_expense_format(name=name, source_format="{not json")
		with self.assertRaises(frappe.ValidationError):
			save_expense_format(name=name, source_format='["an array"]')

		save_expense_format(name=name, source_format='{"templateId":"x","templateVersion":1}')
		self.assertTrue(frappe.db.get_value("Expense Type", name, "source_format"))

		# EMPTY IS LEGITIMATE -- it clears the format and the type stays fully requestable.
		save_expense_format(name=name, source_format="")
		self.assertIsNone(frappe.db.get_value("Expense Type", name, "source_format"))
