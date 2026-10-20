# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Duplicate staff stays (spec #1494, #1504): flagged to whoever approves, never refused.

Tests go through the request-creating call (seam 1), the dialog's check and the reviewer's
`similar.get_similar`, and assert what a user would see: the matches, the request's status, and
that nothing is refused.

⚠️ These run against a live site. Every fixture is namespaced (`exr_dup` comment, a random person
name, dates in 2031) and removed; the Records without review list is put back in `tearDownClass`.

Run:
  bench --site <site> run-tests --module nirmaan_stack.api.expense_requests.test_duplicate_stay
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.create import create_expense_request
from nirmaan_stack.api.expense_requests.duplicates import check_duplicate_stay
from nirmaan_stack.api.expense_requests.review import reject_expense_request
from nirmaan_stack.api.expense_requests.similar import get_similar
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.expense_requests.update import update_expense_request
from nirmaan_stack.services import expense_request_routing as routing
from nirmaan_stack.services.expense_decision import decide

PM_USER = "exr_dup_pm@example.com"
HR_USER = "exr_dup_hr@example.com"
USERS = (PM_USER, HR_USER)
PM_PROFILE = "Nirmaan Project Manager Profile"
HR_PROFILE = "Nirmaan HR Executive Profile"

STAY_TYPE = "Rent/PG for Staff"   # project only; its form is `staff-accommodation`
MARK = "exr_dup"

SETTINGS = "Expense Settings"
FIELD = "records_without_review"


def _write_list(profiles) -> None:
	doc = frappe.get_single(SETTINGS)
	doc.set(FIELD, [{"role_profile": p} for p in profiles])
	doc.flags.ignore_validate = True
	doc.save(ignore_permissions=True)


def _stay(person, start, end, accommodation="PG"):
	return {
		"templateId": "staff-accommodation",
		"templateVersion": 8,
		"responses": {"detail": {
			"person_name": person, "accommodation_type": accommodation, "city": "Pune",
			"rent_period_from": start, "rent_period_to": end,
		}},
	}


def _project(label):
	p = frappe.new_doc("Projects")
	p.project_name = f"exr_dup_{label}_{frappe.generate_hash(length=6)}"
	p.project_start_date = frappe.utils.now()[:19]
	p.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
	p.project_scopes = {"scopes": []}
	p.insert(ignore_permissions=True)
	return p.name


class TestDuplicateStay(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		_make_user(PM_USER, PM_PROFILE, ("Nirmaan Project Manager",))
		_make_user(HR_USER, HR_PROFILE, ("Nirmaan HR Executive",))

		# Who may raise the stay type is master data: grant both profiles for the run and remove
		# exactly the rows added.
		cls.granted_roles = []
		for profile in (PM_PROFILE, HR_PROFILE):
			if frappe.db.exists("Expense Type Role", {"parent": STAY_TYPE, "parenttype": "Expense Type",
			                                          "role_profile": profile}):
				continue
			row = frappe.get_doc({
				"doctype": "Expense Type Role", "name": frappe.generate_hash(length=10),
				"parent": STAY_TYPE, "parenttype": "Expense Type", "parentfield": "allowed_roles",
				"role_profile": profile, "idx": 99,
			})
			row.db_insert()
			cls.granted_roles.append(row.name)

		# HR records without review; the PM is reviewed.
		cls.original_list = [r.role_profile for r in frappe.get_single(SETTINGS).get(FIELD)]
		_write_list(sorted(set(cls.original_list) | {HR_PROFILE}))

		cls.project = _project("a")
		cls.other_project = _project("b")
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.db.rollback()
		frappe.set_user("Administrator")
		_write_list(cls.original_list)
		for n in cls.granted_roles:
			frappe.db.delete("Expense Type Role", {"name": n})
		for r in frappe.get_all("Expense Request", filters={"comment": MARK}):
			for dt in ("Project Expenses", "Non Project Expenses"):
				for e in frappe.get_all(dt, filters={"request_id": r.name}):
					# Deleting the Expense deletes its request too (`on_expense_deleted`).
					frappe.delete_doc(dt, e.name, force=True, ignore_permissions=True)
			if frappe.db.exists("Expense Request", r.name):
				frappe.delete_doc("Expense Request", r.name, force=True, ignore_permissions=True)
		for p in (cls.project, cls.other_project):
			frappe.delete_doc("Projects", p, force=True, ignore_permissions=True)
		for email in USERS:
			for dt in ("Nirmaan Users", "User"):
				if frappe.db.exists(dt, email):
					frappe.delete_doc(dt, email, force=True, ignore_permissions=True)
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		frappe.set_user("Administrator")
		routing.clear_cache()
		# A person no other run, and no real request, can share.
		self.person = f"Dup Person {frappe.generate_hash(length=8)}"

	def tearDown(self):
		routing.clear_cache()
		frappe.set_user("Administrator")

	# --- helpers -------------------------------------------------------------

	def _raise(self, user, stay, project=None, amount=4000):
		frappe.set_user(user)
		try:
			return create_expense_request(
				expense_type=STAY_TYPE, amount=amount, comment=MARK,
				projects=project or self.project, source_data=stay,
			)
		finally:
			frappe.set_user("Administrator")

	def _check(self, user, stay, exclude=None):
		frappe.set_user(user)
		try:
			return check_duplicate_stay(source_data=stay, exclude=exclude)["matches"]
		finally:
			frappe.set_user("Administrator")

	@staticmethod
	def _names(matches):
		return {m["request"] for m in matches}

	# --- the rule ---------------------------------------------------------------

	def test_an_overlapping_stay_returns_matches_from_requests_and_expenses_and_is_not_refused(self):
		pending = self._raise(PM_USER, _stay(self.person, "2031-08-01", "2031-08-31"))
		recorded = self._raise(HR_USER, _stay(self.person, "2031-08-10", "2031-09-10"),
		                       project=self.other_project)
		self.assertTrue(recorded["created_expense"])

		# Case and spacing ignored; a different project still matches.
		res = self._raise(PM_USER, _stay(f"  {self.person.upper()} ", "2031-08-20", "2031-08-25"))

		self.assertEqual(res["status"], "Pending Approval")   # never refused
		by_request = {m["request"]: m for m in res["duplicates"]}
		self.assertEqual(set(by_request), {pending["name"], recorded["name"]})
		self.assertIsNone(by_request[pending["name"]]["expense"])
		self.assertEqual(by_request[pending["name"]]["status"], "Pending Approval")
		expense = by_request[recorded["name"]]["expense"]
		self.assertEqual(expense["name"], recorded["created_expense"])
		self.assertEqual(expense["doctype"], "Project Expenses")
		self.assertEqual(by_request[recorded["name"]]["status"], "Approved")
		self.assertEqual(by_request[recorded["name"]]["period_from"], "2031-08-10")
		self.assertEqual(by_request[recorded["name"]]["period_to"], "2031-09-10")

	def test_one_shared_day_is_an_overlap(self):
		first = self._raise(PM_USER, _stay(self.person, "2031-03-01", "2031-03-10"))
		matches = self._check(PM_USER, _stay(self.person, "2031-03-09", "2031-03-20"))
		self.assertEqual(self._names(matches), {first["name"]})

	def test_a_stay_that_starts_the_day_another_ends_returns_no_match(self):
		self._raise(PM_USER, _stay(self.person, "2031-04-01", "2031-05-01"))
		self.assertEqual(self._check(PM_USER, _stay(self.person, "2031-05-01", "2031-06-01")), [])

	def test_a_different_person_returns_no_match(self):
		self._raise(PM_USER, _stay(self.person, "2031-06-01", "2031-06-30"))
		self.assertEqual(self._check(PM_USER, _stay(f"{self.person} Jr", "2031-06-01", "2031-06-30")), [])

	def test_a_rejected_request_is_not_a_match(self):
		req = self._raise(PM_USER, _stay(self.person, "2031-07-01", "2031-07-31"))
		reject_expense_request(req["name"], comment="exr_dup no")
		self.assertEqual(self._check(PM_USER, _stay(self.person, "2031-07-05", "2031-07-06")), [])

	def test_a_request_whose_expense_was_rejected_is_not_a_match(self):
		"""The Expense's own status decides, even where the request still reads Approved."""
		# Rs 20,000 from HR is approved on submit and its Expense waits for an Admin, who rejects it.
		req = self._raise(HR_USER, _stay(self.person, "2031-10-01", "2031-10-31"), amount=20000)
		decide(req["created_expense_doctype"], req["created_expense"], "reject", "Administrator",
		       reason="exr_dup same stay")
		self.assertEqual(frappe.db.get_value("Expense Request", req["name"], "status"), "Rejected")
		self.assertEqual(self._check(PM_USER, _stay(self.person, "2031-10-05", "2031-10-06")), [])

	def test_a_stay_the_raiser_left_unfinished_returns_no_match(self):
		self._raise(PM_USER, _stay(self.person, "2031-11-01", "2031-11-30"))
		self.assertEqual(self._check(PM_USER, _stay(self.person, "2031-11-05", "")), [])
		self.assertEqual(self._check(PM_USER, _stay("", "2031-11-05", "2031-11-06")), [])

	# --- who sees it ------------------------------------------------------------

	def test_the_reviewer_sees_the_other_stays_and_never_the_request_itself(self):
		first = self._raise(PM_USER, _stay(self.person, "2031-01-01", "2031-01-31"))
		second = self._raise(PM_USER, _stay(self.person, "2031-01-15", "2031-02-15"))
		self.assertEqual(self._names(get_similar(second["name"])["stays"]), {first["name"]})
		self.assertEqual(self._names(get_similar(first["name"])["stays"]), {second["name"]})

	# --- re-checked only when the stay changes ------------------------------------

	def test_an_edit_that_keeps_the_stay_is_not_re_checked(self):
		self._raise(PM_USER, _stay(self.person, "2031-12-01", "2031-12-31"))
		mine = self._raise(PM_USER, _stay(self.person, "2031-12-10", "2031-12-20"))
		same = _stay(self.person, "2031-12-10", "2031-12-20")
		self.assertEqual(self._check(PM_USER, same, exclude=mine["name"]), [])

		frappe.set_user(PM_USER)
		try:
			saved = update_expense_request(
				name=mine["name"], expense_type=STAY_TYPE, amount=4500, comment=MARK,
				projects=self.project, source_data=same,
			)
		finally:
			frappe.set_user("Administrator")
		self.assertEqual(saved["duplicates"], [])

	def test_an_edit_that_changes_the_stay_is_re_checked_and_saved(self):
		other = self._raise(PM_USER, _stay(self.person, "2031-02-01", "2031-02-28"))
		mine = self._raise(PM_USER, _stay(self.person, "2031-05-01", "2031-05-10"))
		moved = _stay(self.person, "2031-02-20", "2031-03-05")
		self.assertEqual(self._names(self._check(PM_USER, moved, exclude=mine["name"])), {other["name"]})

		frappe.set_user(PM_USER)
		try:
			saved = update_expense_request(
				name=mine["name"], expense_type=STAY_TYPE, amount=4000, comment=MARK,
				projects=self.project, source_data=moved,
			)
		finally:
			frappe.set_user("Administrator")
		self.assertEqual(self._names(saved["duplicates"]), {other["name"]})
		self.assertEqual(saved["status"], "Pending Approval")
