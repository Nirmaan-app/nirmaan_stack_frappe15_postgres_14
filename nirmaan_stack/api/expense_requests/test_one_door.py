# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""One door (spec #1494, #1506): every expense a person raises starts as an Expense Request.

* No human role creates a `Project Expenses` or `Non Project Expenses` row directly, System Manager
  included; Administrator bypasses permissions. The request intake writes the Expense with
  elevated permission.
* The retired Direct Expense suite's cases, moved to the request-creating call (seam 1): who gets
  paid reaches the Expense, the amount rule decides its status, PMO and Procurement raise on their
  own roles, an unknown Payee leaves nothing behind.
* Who opens the Expenses page: someone who can raise at least one type, or who reviews.

⚠️ Runs against a live site. The Records without review list is captured and put back; every other
fixture is namespaced `exr_1d` and removed.

Run:
  devenv.sh test --module nirmaan_stack.api.expense_requests.test_one_door
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.create import create_expense_request
from nirmaan_stack.api.expense_requests.read import get_expense_access
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.expense_requests.test_records_without_review import SEEDED, _listed, _write_list
from nirmaan_stack.api.payees.payee_fixture import PayeeFixture, delete_each
from nirmaan_stack.services import expense_request_routing as routing
from nirmaan_stack.services.payees.pay_to import PAY_TO_FIELDS
from nirmaan_stack.services.payees.rules import ACCOUNT_FIELDS

U = "Administrator"
PE = "Project Expenses"
NPE = "Non Project Expenses"
LEDGERS = (PE, NPE)
TAG = "exr_1d"

ACCOUNTANT_PROFILE = "Nirmaan Accountant Profile"
PMO_PROFILE = "Nirmaan PMO Executive Profile"
PROCUREMENT_PROFILE = "Nirmaan Procurement Executive Profile"
HR_LEAD_PROFILE = "Nirmaan HR Lead Profile"
# A profile made for these tests: it may raise no type and reviews nothing.
IDLE_PROFILE = "exr_1d Idle Profile"

ACCOUNTANT = "exr_1d_accountant@example.com"
# The PMO profile on the PMO Executive role alone: no System Manager, which the real profile also
# carries (#1475).
PMO = "exr_1d_pmo@example.com"
PROCUREMENT = "exr_1d_procurement@example.com"
HR_LEAD = "exr_1d_hrlead@example.com"
IDLE = "exr_1d_idle@example.com"
# Every role any role profile grants, System Manager included, on one user.
EVERY_ROLE = "exr_1d_every_role@example.com"
USERS = (ACCOUNTANT, PMO, PROCUREMENT, HR_LEAD, IDLE, EVERY_ROLE)


def _every_human_role() -> tuple[str, ...]:
	"""Every role a person can hold here: each role profile's roles, every role named in either
	ledger's permissions, and System Manager."""
	roles = set(frappe.get_all("Has Role", filters={"parenttype": "Role Profile"}, pluck="role"))
	for doctype in LEDGERS:
		roles.update(p.role for p in frappe.get_meta(doctype).permissions)
	roles.add("System Manager")
	return tuple(sorted(roles - {"Administrator", "Guest", "All"}))


class TestOneDoor(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user(U)
		cls.original_list = _listed()
		if not frappe.db.exists("Role Profile", IDLE_PROFILE):
			frappe.get_doc({"doctype": "Role Profile", "role_profile": IDLE_PROFILE}).insert(
				ignore_permissions=True)
		_make_user(ACCOUNTANT, ACCOUNTANT_PROFILE, ("Nirmaan Accountant",))
		_make_user(PMO, PMO_PROFILE, ("Nirmaan PMO Executive",))
		_make_user(PROCUREMENT, PROCUREMENT_PROFILE, ("Nirmaan Procurement Executive",))
		_make_user(HR_LEAD, HR_LEAD_PROFILE, ("Nirmaan HR Lead", "Nirmaan HR Executive"))
		_make_user(IDLE, IDLE_PROFILE, ("Nirmaan Design Executive",))
		_make_user(EVERY_ROLE, None, _every_human_role())

		# Two types of our own, raisable by the profiles under test (Admin raises every type).
		cls.types = {}
		for ledger, project in ((PE, 1), (NPE, 0)):
			doc = frappe.new_doc("Expense Type")
			doc.update({"expense_name": f"{TAG}_{'pe' if project else 'npe'}_{frappe.generate_hash(length=5)}",
			            "project": project, "non_project": 1 - project,
			            "payee_rule": "Optional"})
			doc.set("allowed_roles", [{"role_profile": p}
			                          for p in (ACCOUNTANT_PROFILE, PMO_PROFILE, PROCUREMENT_PROFILE)])
			doc.insert(ignore_permissions=True)
			cls.types[ledger] = doc.name
		# Raw, like the Payee suites: `Projects.after_insert` builds work milestones.
		cls.project = f"TEST-EXR1D-{frappe.generate_hash(length=8)}"
		frappe.db.sql(
			"""INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner, docstatus, idx,
			                              project_name)
			   VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s)""",
			(cls.project, U, U, cls.project),
		)
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.db.rollback()
		frappe.set_user(U)
		try:
			_write_list(cls.original_list)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
		requests = frappe.get_all("Expense Request", filters={"comment": ["like", f"{TAG}%"]}, pluck="name")
		# ⚠️ NEVER `requests or [""]`: `request_id` is a nullable Link, so `["in", [""]]` renders as
		# `ifnull(request_id, '') in ('')` and matches every expense raised without a request.
		scopes = [(dt, name) for dt in LEDGERS if requests
		          for name in frappe.get_all(dt, filters={"request_id": ["in", requests]}, pluck="name")]
		scopes += [("Expense Request", name) for name in requests]
		scopes += [("Expense Type", name) for name in cls.types.values()]
		scopes += [("Projects", cls.project)]
		scopes += [(dt, email) for email in USERS for dt in ("Nirmaan Users", "User")]
		scopes += [("Role Profile", IDLE_PROFILE)]
		try:
			delete_each(scopes, raw={"Projects"})
		finally:
			super().tearDownClass()

	def setUp(self):
		frappe.set_user(U)
		routing.clear_cache()
		_write_list(SEEDED)
		frappe.db.commit()
		self.payees = PayeeFixture.attach(self)

	def tearDown(self):
		routing.clear_cache()
		frappe.set_user(U)

	# -- helpers --------------------------------------------------------------------------------
	def _raise(self, ledger=NPE, user=ACCOUNTANT, amount=2500, payee=None, vendor=None, comment=TAG) -> dict:
		"""Raise a request as `user` through the request-creating call, the way New Expense sends it."""
		frappe.set_user(user)
		try:
			return create_expense_request(
				expense_type=self.types[ledger], amount=amount, comment=comment,
				projects=self.project if ledger == PE else None, vendor=vendor, payee=payee,
				source_data={"responses": {"detail": {"description": f"{TAG} expense"}}},
			)
		finally:
			frappe.set_user(U)

	def _pay_to(self, doctype, name):
		return tuple(frappe.db.get_value(doctype, name, list(PAY_TO_FIELDS)))

	def _account_of(self, payee):
		return tuple(frappe.db.get_value("Payee", payee, list(ACCOUNT_FIELDS)))

	def _access(self, user) -> dict:
		frappe.set_user(user)
		try:
			return get_expense_access()
		finally:
			frappe.set_user(U)

	# -- no human role creates a ledger row ------------------------------------------------------
	def test_no_human_role_holds_create_on_either_ledger(self):
		"""Every role a person can hold, System Manager included, on one user: still no create."""
		for doctype in LEDGERS:
			with self.subTest(doctype=doctype):
				self.assertFalse(frappe.has_permission(doctype, "create", user=EVERY_ROLE))

	def test_a_ledger_row_inserted_with_every_human_role_is_refused(self):
		for doctype in LEDGERS:
			values = {"doctype": doctype, "type": self.types[doctype], "amount": 2500,
			          "description": f"{TAG} direct", **({"projects": self.project} if doctype == PE else {})}
			with self.subTest(doctype=doctype):
				frappe.set_user(EVERY_ROLE)
				try:
					with self.assertRaises(frappe.PermissionError):
						frappe.get_doc(values).insert()
				finally:
					frappe.set_user(U)
				frappe.db.rollback()
				self.assertFalse(frappe.db.exists(doctype, {"description": f"{TAG} direct"}))

	def test_the_intake_still_records_the_expense_for_a_raiser_without_create(self):
		for ledger in LEDGERS:
			with self.subTest(ledger=ledger):
				self.assertFalse(frappe.has_permission(ledger, "create", user=ACCOUNTANT))
				out = self._raise(ledger)
				self.assertEqual(out["created_expense_doctype"], ledger)
				self.assertEqual(frappe.db.get_value(ledger, out["created_expense"], "owner"), ACCOUNTANT)

	# -- who gets paid reaches the Expense (from the Direct Expense suite) ------------------------
	def test_a_non_project_expense_with_a_payee_holds_its_account(self):
		payee = self.payees.payee()
		out = self._raise(NPE, payee=payee)
		self.assertEqual(self._pay_to(NPE, out["created_expense"]), self._account_of(payee))

	def test_a_project_expense_naming_a_vendor_gets_the_vendors_account_and_ignores_the_payee_sent(self):
		vendor_payee, other = self.payees.payee(), self.payees.payee()
		vendor = self.payees.vendor(vendor_payee)
		out = self._raise(PE, payee=other, vendor=vendor)
		self.assertEqual(self._pay_to(PE, out["created_expense"]), self._account_of(vendor_payee))

	def test_a_project_expense_with_no_vendor_holds_the_payee_picked(self):
		payee = self.payees.payee()
		out = self._raise(PE, payee=payee)
		self.assertEqual(self._pay_to(PE, out["created_expense"]), self._account_of(payee))

	def test_an_expense_with_no_payee_is_saved_with_no_account(self):
		for ledger in LEDGERS:
			with self.subTest(ledger=ledger):
				out = self._raise(ledger)
				self.assertEqual(self._pay_to(ledger, out["created_expense"]), (None,) * len(PAY_TO_FIELDS))

	def test_an_unknown_payee_leaves_no_request_and_no_expense_behind(self):
		for ledger in LEDGERS:
			with self.subTest(ledger=ledger):
				marker = f"{TAG} {frappe.generate_hash(length=8)}"
				with self.assertRaises(frappe.DoesNotExistError):
					self._raise(ledger, payee="PYE-NO-SUCH-PAYEE", comment=marker)
				frappe.db.rollback()
				self.assertFalse(frappe.db.exists("Expense Request", {"comment": marker}))
				self.assertFalse(frappe.db.exists(ledger, {"comment": marker}))

	# -- the amount rule decides the Expense's status ----------------------------------------------
	def test_the_expense_status_follows_the_amount_rule_and_the_raisers_step(self):
		"""Below 15,000 lands Approved; an Accountant's 20,000 waits at Requested for an Admin; an
		Admin's 20,000 has its own step cleared."""
		for user, amount, status in ((ACCOUNTANT, 5000, "Approved"), (ACCOUNTANT, 20000, "Requested"),
		                             (U, 20000, "Approved")):
			for ledger in LEDGERS:
				with self.subTest(user=user, amount=amount, ledger=ledger):
					out = self._raise(ledger, user=user, amount=amount)
					self.assertEqual(out["expense_status"], status)
					self.assertEqual(frappe.db.get_value(ledger, out["created_expense"], "status"), status)

	# -- PMO and Procurement raise through New Expense ---------------------------------------------
	def test_pmo_and_procurement_raise_requests_on_their_own_roles(self):
		"""Neither user holds System Manager; each raises both kinds, which wait for a Reviewer."""
		for user in (PMO, PROCUREMENT):
			self.assertNotIn("System Manager", frappe.get_roles(user))
			for ledger in LEDGERS:
				with self.subTest(user=user, ledger=ledger):
					out = self._raise(ledger, user=user)
					self.assertEqual(out["status"], "Pending Approval")
					self.assertEqual(frappe.db.get_value("Expense Request", out["name"], "owner"), user)

	# -- who opens the Expenses page ---------------------------------------------------------------
	def test_the_expenses_page_opens_for_a_raiser_or_a_reviewer_only(self):
		# The page opens for a raiser or a reviewer; its New Expense button only for a raiser.
		# The types the site ships may list the HR Lead: take it off every one, so it reviews and
		# raises nothing. Raw, inside this test's transaction and rolled back after: a read needs no
		# Expense Type hook, and the rollback puts every row back.
		frappe.db.sql(
			"""DELETE FROM "tabExpense Type Role"
			   WHERE parenttype = 'Expense Type' AND parentfield = 'allowed_roles' AND role_profile = %s""",
			HR_LEAD_PROFILE,
		)
		self.addCleanup(routing.clear_cache)
		self.addCleanup(frappe.db.rollback)
		routing.clear_cache()
		cases = (
			(U, True, True),              # Admin: raises every type, reviews every request
			(ACCOUNTANT, True, True),     # raises a type
			(PROCUREMENT, True, True),    # raises a type, reviews nothing
			(HR_LEAD, True, False),       # reviews a Project Manager's requests, raises nothing
			(IDLE, False, False),         # raises nothing, reviews nothing
		)
		for user, opens, raises in cases:
			with self.subTest(user=user):
				self.assertEqual(self._access(user), {"opens_expenses": opens, "can_raise": raises})
