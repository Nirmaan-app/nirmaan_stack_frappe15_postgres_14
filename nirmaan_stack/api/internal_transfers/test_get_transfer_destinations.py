# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for `get_transfer_destinations`: who may pick a transfer destination project, and what
they get.

What must hold:
  1. EVERY WON PROJECT for the profiles allowed to send material to a project (Admin, PMO,
     Material Procurement), checked against independent SQL.
  2. PROJECT ASSIGNMENTS DO NOT NARROW IT. A Procurement Executive held to one project by a User
     Permission row still gets every Won project (rule set by Abhishek, 2026-10-16), while
     frappe.get_list as the same user sees only that one -- proving the scoping is real and the
     endpoint steps past it on purpose.
  3. EVERYONE ELSE IS REFUSED: Project Manager and Project Lead (they only return stock to the
     warehouse), another profile, and a user with no role profile.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Reads live Projects; the only writes are throwaway users (a
bare `User`, its `Has Role` and `User Permission` rows) inserted with `db_insert` and never
committed: tearDown rolls back, then deletes by the generated user name as a backstop.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.internal_transfers import get_transfer_destinations as gtd


def _won_projects_sql():
	return {r[0] for r in frappe.db.sql("""SELECT name FROM "tabProjects" WHERE tendering_status = 'Won'""")}


class TestGetTransferDestinations(FrappeTestCase):
	def setUp(self):
		self.users = []

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()
		for user in self.users:
			frappe.db.delete("User Permission", {"user": user})
			frappe.db.delete("Has Role", {"parent": user, "parenttype": "User"})
			frappe.db.delete("User", {"name": user})
			frappe.cache.hdel("user_permissions", user)
			frappe.cache.hdel("roles", user)
		frappe.db.commit()

	def _user(self, profile, projects=()):
		"""A throwaway user on `profile` (with that profile's roles), held to `projects` by User
		Permission rows. Written with `db_insert`: a normal insert runs our Nirmaan Users / User
		Permission hooks."""
		user = f"itm-dest-{frappe.generate_hash(length=8)}@example.com"
		self.users.append(user)
		now = frappe.utils.now()

		def insert(doc, name):
			doc.name = name
			doc.creation = doc.modified = now
			doc.owner = doc.modified_by = "Administrator"
			doc.db_insert()

		insert(
			frappe.get_doc({
				"doctype": "User", "email": user, "first_name": "ITM destination test", "enabled": 1,
				"user_type": "System User", "send_welcome_email": 0, "role_profile_name": profile,
			}),
			user,
		)
		roles = [r.role for r in frappe.get_doc("Role Profile", profile).roles] if profile else []
		for i, role in enumerate(roles):
			insert(
				frappe.get_doc({"doctype": "Has Role", "role": role, "parent": user, "parenttype": "User",
				                "parentfield": "roles", "idx": i + 1}),
				frappe.generate_hash(length=10),
			)
		for project in projects:
			insert(
				frappe.get_doc({"doctype": "User Permission", "user": user, "allow": "Projects", "for_value": project}),
				f"itm-dest-{frappe.generate_hash(length=10)}",
			)
		frappe.cache.hdel("user_permissions", user)
		frappe.cache.hdel("roles", user)
		return user

	def _names(self):
		return [r["name"] for r in gtd.get_transfer_destinations()]

	# --- 1. every Won project for the allowed profiles --------------------------------------------

	def test_allowed_profiles_get_every_won_project(self):
		won = _won_projects_sql()
		self.assertGreater(len(won), 1, "needs 2+ Won projects on the site")
		frappe.set_user("Administrator")
		self.assertEqual(set(self._names()), won)
		checked = 0
		for profile in gtd.DESTINATION_PROFILES:
			if not frappe.db.exists("Role Profile", profile):
				continue
			frappe.set_user(self._user(profile))
			names = self._names()
			frappe.set_user("Administrator")
			self.assertEqual(set(names), won, profile)
			self.assertEqual(len(names), len(set(names)), f"{profile}: duplicate projects")
			checked += 1
		self.assertGreaterEqual(checked, 3, "Admin, PMO and at least one Procurement profile must exist")

	# --- 2. a project assignment does not narrow Procurement -------------------------------------

	def test_project_assignment_does_not_narrow_procurement(self):
		won = sorted(_won_projects_sql())
		own = won[0]
		frappe.set_user(self._user("Nirmaan Procurement Executive Profile", projects=[own]))
		scoped = frappe.get_list("Projects", filters={"tendering_status": "Won"}, pluck="name", limit_page_length=0)
		names = self._names()
		frappe.set_user("Administrator")
		self.assertEqual(scoped, [own], "the User Permission row must scope get_list, or this test proves nothing")
		self.assertEqual(set(names), set(won))

	# --- 3. everyone else is refused --------------------------------------------------------------

	def test_other_profiles_are_refused(self):
		refused = [
			p for p in ("Nirmaan Project Manager Profile", "Nirmaan Project Lead Profile", "Nirmaan Accountant Profile")
			if frappe.db.exists("Role Profile", p)
		]
		self.assertIn("Nirmaan Project Manager Profile", refused)
		for profile in [*refused, None]:
			frappe.set_user(self._user(profile))
			with self.assertRaises(frappe.PermissionError, msg=str(profile)):
				gtd.get_transfer_destinations()
			frappe.set_user("Administrator")
