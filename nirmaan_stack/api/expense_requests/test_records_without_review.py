# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Records without review (spec #1494, #1498): a listed raiser's request is approved on submit.

Tests go through the request-creating call (seam 1), the Expense Settings save and the seed
patch, and assert what a user would see: the request's status and marker, the Expense and its
status, a refusal.

⚠️ These run against a live site. The Records without review list is captured in `setUpClass`
and put back in `tearDownClass`; every other fixture is namespaced `exr_rwr_` and removed.

Run:
  bench --site <site> run-tests --module nirmaan_stack.api.expense_requests.test_records_without_review
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.access import records_without_review
from nirmaan_stack.api.expense_requests.create import create_expense_request
from nirmaan_stack.api.expense_requests.expense_settings import (
	get_records_without_review,
	set_records_without_review,
)
from nirmaan_stack.api.expense_requests.masters import update_expense_type
from nirmaan_stack.api.expense_requests.read import get_my_expense_requests, get_request_catalog
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.patches.v3_0 import seed_records_without_review as seed_patch
from nirmaan_stack.services import expense_request_routing as routing

PM_USER = "exr_rwr_pm@example.com"
HR_USER = "exr_rwr_hr@example.com"
IDLE_USER = "exr_rwr_idle@example.com"
USERS = (PM_USER, HR_USER, IDLE_USER)

PM_PROFILE = "Nirmaan Project Manager Profile"
HR_PROFILE = "Nirmaan HR Executive Profile"
ADMIN_PROFILE = "Nirmaan Admin Profile"
SEEDED = (
	"Nirmaan Accountant Profile",
	"Nirmaan Accountant Lead Profile",
	"Nirmaan HR Executive Profile",
	"Nirmaan HR Lead Profile",
)
NON_PROJECT_TYPE = "Travel Expenses (Bus)"     # project=0, non_project=1
# Raised by HR in the fixture, never by IDLE_PROFILE; a test lends it to IDLE_PROFILE and puts its roles back.
SPARE_TYPE = "Postage & Courier"
# A profile made for these tests, allowed to raise no type at all.
IDLE_PROFILE = "exr_rwr Idle Profile"

SETTINGS = "Expense Settings"
FIELD = "records_without_review"


def _listed() -> list[str]:
	return [r.role_profile for r in frappe.get_single(SETTINGS).get(FIELD)]


def _write_list(profiles) -> None:
	"""Put the list back exactly, past the eligibility check: a restore must never be refused."""
	doc = frappe.get_single(SETTINGS)
	doc.set(FIELD, [{"role_profile": p} for p in profiles])
	doc.flags.ignore_validate = True
	doc.save(ignore_permissions=True)


class TestRecordsWithoutReview(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.original_list = _listed()
		_make_user(PM_USER, PM_PROFILE, ("Nirmaan Project Manager",))
		_make_user(HR_USER, HR_PROFILE, ("Nirmaan HR Executive",))

		# Who may raise a type is master data; grant the PM and HR profiles on one type for the
		# run and remove exactly the rows added.
		cls.granted_roles = []
		for profile in (PM_PROFILE, HR_PROFILE):
			if frappe.db.exists("Expense Type Role", {"parent": NON_PROJECT_TYPE,
			                                          "parenttype": "Expense Type",
			                                          "role_profile": profile}):
				continue
			row = frappe.get_doc({
				"doctype": "Expense Type Role", "name": frappe.generate_hash(length=10),
				"parent": NON_PROJECT_TYPE, "parenttype": "Expense Type",
				"parentfield": "allowed_roles", "role_profile": profile, "idx": 99,
			})
			row.db_insert()
			cls.granted_roles.append(row.name)

		if not frappe.db.exists("Role Profile", IDLE_PROFILE):
			frappe.get_doc({"doctype": "Role Profile", "role_profile": IDLE_PROFILE}).insert(
				ignore_permissions=True)
		_make_user(IDLE_USER, IDLE_PROFILE, ())
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.db.rollback()
		frappe.set_user("Administrator")
		_write_list(cls.original_list)
		frappe.db.commit()
		for n in cls.granted_roles:
			frappe.db.delete("Expense Type Role", {"name": n})
		owners = list(USERS) + ["Administrator"]
		for r in frappe.get_all("Expense Request", filters={"owner": ["in", owners],
		                                                    "comment": "exr_rwr"}):
			for dt in ("Project Expenses", "Non Project Expenses"):
				for e in frappe.get_all(dt, filters={"request_id": r.name}):
					frappe.delete_doc(dt, e.name, force=True, ignore_permissions=True)
			if frappe.db.exists("Expense Request", r.name):
				frappe.delete_doc("Expense Request", r.name, force=True, ignore_permissions=True)
		frappe.db.commit()
		for email in USERS:
			for dt in ("Nirmaan Users", "User"):
				if frappe.db.exists(dt, email):
					frappe.delete_doc(dt, email, force=True, ignore_permissions=True)
		if frappe.db.exists("Role Profile", IDLE_PROFILE):
			frappe.delete_doc("Role Profile", IDLE_PROFILE, force=True, ignore_permissions=True)
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		frappe.set_user("Administrator")
		routing.clear_cache()
		# The list the spec ships with: the four seeded profiles (Admin is implicit).
		_write_list(SEEDED)

	def tearDown(self):
		routing.clear_cache()
		frappe.set_user("Administrator")

	# --- helpers -------------------------------------------------------------

	def _raise_as(self, user, amount):
		frappe.set_user(user)
		try:
			return create_expense_request(
				expense_type=NON_PROJECT_TYPE, amount=amount, comment="exr_rwr",
				source_data={"responses": {"detail": {"description": "exr_rwr bus"}}},
			)
		finally:
			frappe.set_user("Administrator")

	def _expense(self, res):
		return frappe.get_doc(res["created_expense_doctype"], res["created_expense"])

	# --- the request-creating call (seam 1) ----------------------------------

	def test_an_admins_40000_expense_is_approved_on_submit(self):
		res = self._raise_as("Administrator", 40000)
		self.assertEqual(res["status"], "Approved")
		self.assertEqual(self._expense(res).status, "Approved")
		self.assertEqual(res["expense_status"], "Approved")

	def test_an_admins_60000_expense_waits_for_the_ceo_with_l1_done(self):
		res = self._raise_as("Administrator", 60000)
		self.assertEqual(res["status"], "Approved")
		expense = self._expense(res)
		self.assertEqual(expense.status, "CEO Pending")
		self.assertTrue(expense.approval_date)       # L1 is done
		self.assertFalse(expense.ceo_approval_date)

	def test_an_hr_executives_10000_expense_is_approved(self):
		res = self._raise_as(HR_USER, 10000)
		self.assertEqual(res["status"], "Approved")
		self.assertEqual(self._expense(res).status, "Approved")

	def test_an_hr_executives_40000_expense_waits_for_an_admin(self):
		"""It skips the Reviewer, never the amount rule: HR is not L1."""
		res = self._raise_as(HR_USER, 40000)
		self.assertEqual(res["status"], "Approved")
		expense = self._expense(res)
		self.assertEqual(expense.status, "Requested")
		self.assertFalse(expense.approval_date)

	def test_a_project_managers_request_still_waits_for_review(self):
		res = self._raise_as(PM_USER, 10000)
		self.assertEqual(res["status"], "Pending Approval")
		self.assertIsNone(res["created_expense"])
		self.assertFalse(frappe.db.exists("Non Project Expenses", {"request_id": res["name"]}))
		self.assertFalse(frappe.db.get_value("Expense Request", res["name"], "approved_on_submit"))

	def test_a_profile_taken_off_the_list_waits_for_review(self):
		_write_list([p for p in SEEDED if p != HR_PROFILE])
		res = self._raise_as(HR_USER, 10000)
		self.assertEqual(res["status"], "Pending Approval")
		self.assertIsNone(res["created_expense"])

	def test_the_request_shows_approved_on_submit_with_no_reviewer(self):
		res = self._raise_as(HR_USER, 10000)
		frappe.set_user(HR_USER)
		try:
			row = next(r for r in get_my_expense_requests()["requests"] if r["name"] == res["name"])
		finally:
			frappe.set_user("Administrator")
		self.assertEqual(row["approved_on_submit"], 1)
		self.assertFalse(row["reviewed_by"])

	# --- who records without review ------------------------------------------

	def test_the_dialog_is_told_who_records_without_review(self):
		for user, expected in (("Administrator", True), (HR_USER, True), (PM_USER, False)):
			with self.subTest(user=user):
				frappe.set_user(user)
				try:
					self.assertEqual(get_request_catalog()["records_without_review"], expected)
					self.assertEqual(records_without_review(), expected)
				finally:
					frappe.set_user("Administrator")

	# --- the list (Expense Settings) ------------------------------------------

	def test_the_list_offers_only_profiles_that_can_raise_a_type(self):
		out = get_records_without_review()
		self.assertIn(HR_PROFILE, out["role_profiles"])
		self.assertNotIn(IDLE_PROFILE, out["role_profiles"])
		self.assertNotIn(ADMIN_PROFILE, out["role_profiles"])
		self.assertIn(HR_PROFILE, out["records_without_review"])

	def test_a_profile_that_can_raise_no_type_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			set_records_without_review([HR_PROFILE, IDLE_PROFILE])
		frappe.db.rollback()
		self.assertNotIn(IDLE_PROFILE, _listed())

	def test_the_admin_profile_is_never_stored(self):
		with self.assertRaises(frappe.ValidationError):
			set_records_without_review([ADMIN_PROFILE])

	def test_a_listed_profile_that_loses_its_types_drops_off_the_list(self):
		_write_list([HR_PROFILE, IDLE_PROFILE])
		self.assertEqual(get_records_without_review()["records_without_review"], [HR_PROFILE])

	def test_a_stored_profile_that_raises_no_type_does_not_record_without_review(self):
		"""Story 28: a row left on the list for a profile that can raise nothing is never honoured."""
		_write_list([HR_PROFILE, IDLE_PROFILE])
		self.assertFalse(records_without_review(IDLE_USER))
		self.assertTrue(records_without_review(HR_USER))

	def test_a_profile_that_loses_every_type_leaves_the_list_and_does_not_come_back_ticked(self):
		"""Story 28: taking a listed profile off its last type drops it from the stored list, so
		giving it a type again later neither ticks it nor approves its requests on submit."""
		original = frappe.get_all("Expense Type Role", pluck="role_profile", order_by="idx asc",
		                          filters={"parent": SPARE_TYPE, "parenttype": "Expense Type"})
		self.addCleanup(self._set_type_roles, SPARE_TYPE, original)
		self._set_type_roles(SPARE_TYPE, original + [IDLE_PROFILE])
		set_records_without_review(list(SEEDED) + [IDLE_PROFILE])

		self._set_type_roles(SPARE_TYPE, original)
		self.assertNotIn(IDLE_PROFILE, _listed())
		self.assertEqual(sorted(_listed()), sorted(SEEDED))

		self._set_type_roles(SPARE_TYPE, original + [IDLE_PROFILE])
		self.assertNotIn(IDLE_PROFILE, get_records_without_review()["records_without_review"])
		frappe.set_user(IDLE_USER)
		try:
			res = create_expense_request(
				expense_type=SPARE_TYPE, amount=1000, comment="exr_rwr",
				source_data={"responses": {"detail": {"description": "exr_rwr courier"}}})
		finally:
			frappe.set_user("Administrator")
		self.assertEqual(res["status"], "Pending Approval")
		self.assertIsNone(res["created_expense"])

	def test_a_desk_save_that_takes_a_profile_off_its_last_type_drops_it_from_the_list(self):
		"""Story 28 by any path: an Expense Type saved through Desk, REST or a fixture sync prunes
		the list as Expense Packages does."""
		original = frappe.get_all("Expense Type Role", pluck="role_profile", order_by="idx asc",
		                          filters={"parent": SPARE_TYPE, "parenttype": "Expense Type"})
		self.addCleanup(self._set_type_roles, SPARE_TYPE, original)
		self._set_type_roles(SPARE_TYPE, original + [IDLE_PROFILE])
		set_records_without_review(list(SEEDED) + [IDLE_PROFILE])

		doc = frappe.get_doc("Expense Type", SPARE_TYPE)
		doc.set("allowed_roles", [{"role_profile": r.role_profile} for r in doc.allowed_roles
		                          if r.role_profile != IDLE_PROFILE])
		doc.save()

		self.assertEqual(sorted(_listed()), sorted(SEEDED))

	def _set_type_roles(self, expense_type, profiles):
		"""Change who may raise `expense_type` the way Expense Packages does, keeping its flags."""
		t = frappe.db.get_value("Expense Type", expense_type,
		                        ["project", "non_project", "expense_category"], as_dict=True)
		update_expense_type(expense_type, project=t.project, non_project=t.non_project,
		                    expense_category=t.expense_category, allowed_roles=list(profiles))
		routing.clear_cache()

	def test_only_an_admin_may_change_the_list(self):
		frappe.set_user(HR_USER)
		try:
			with self.assertRaises(frappe.PermissionError):
				set_records_without_review([HR_PROFILE])
		finally:
			frappe.set_user("Administrator")

	def test_an_admin_saves_the_list(self):
		out = set_records_without_review([HR_PROFILE])
		self.assertEqual(out["records_without_review"], [HR_PROFILE])
		self.assertEqual(_listed(), [HR_PROFILE])

	# --- the seed patch -------------------------------------------------------

	def test_the_seed_patch_is_idempotent(self):
		_write_list([])
		seed_patch.execute()
		seed_patch.execute()
		self.assertEqual(sorted(_listed()), sorted(SEEDED))

	def test_the_seed_patch_keeps_what_an_admin_already_listed(self):
		_write_list([HR_PROFILE])
		seed_patch.execute()
		self.assertEqual(sorted(_listed()), sorted(SEEDED))
