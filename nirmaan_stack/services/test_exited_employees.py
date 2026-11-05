"""Exited employees: removing a person's Nirmaan Users record switches their login off and strips it.

All people here are made up (`*@example.com`).
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.integrations.controllers.test_nirmaan_users import make_user, remove_user

PM_PROFILE = "Nirmaan Project Manager Profile"
LEAVER = "exit-leaver@example.com"


def give_api_key(email: str) -> None:
	user = frappe.get_doc("User", email)
	user.api_key = frappe.generate_hash(length=15)
	user.api_secret = frappe.generate_hash(length=15)
	user.save(ignore_permissions=True)


def open_session(email: str) -> str:
	sid = frappe.generate_hash()
	frappe.db.sql(
		"""INSERT INTO "tabSessions" (sid, "user", sessiondata, lastupdate, status)
		VALUES (%s, %s, '{}', NOW(), 'Active')""",
		(sid, email),
	)
	return sid


def session_count(email: str) -> int:
	return frappe.db.sql('SELECT COUNT(*) FROM "tabSessions" WHERE "user" = %s', (email,))[0][0]


def api_secret_count(email: str) -> int:
	return frappe.db.sql(
		"""SELECT COUNT(*) FROM "__Auth" WHERE doctype = 'User' AND name = %s AND fieldname = 'api_secret'""",
		(email,),
	)[0][0]


def nirmaan_roles(email: str) -> list[str]:
	return frappe.get_all(
		"Has Role",
		filters={"parent": email, "parenttype": "User", "role": ("like", "Nirmaan %")},
		pluck="role",
	)


class TestExitSwitchesLoginOff(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		make_user(LEAVER, PM_PROFILE)
		give_api_key(LEAVER)
		open_session(LEAVER)
		frappe.db.commit()

	def tearDown(self):
		remove_user(LEAVER)

	def test_removing_the_record_switches_the_login_off_and_keeps_it(self):
		self.assertTrue(nirmaan_roles(LEAVER))
		self.assertEqual(session_count(LEAVER), 1)

		frappe.delete_doc("Nirmaan Users", LEAVER, ignore_permissions=True)
		frappe.db.commit()

		self.assertFalse(frappe.db.exists("Nirmaan Users", LEAVER))
		user = frappe.db.get_value("User", LEAVER, ["enabled", "api_key", "role_profile_name"], as_dict=True)
		self.assertIsNotNone(user, "the login record is kept")
		self.assertEqual(user.enabled, 0)
		self.assertFalse(user.api_key)
		self.assertFalse(user.role_profile_name)
		self.assertEqual(nirmaan_roles(LEAVER), [])
		self.assertEqual(api_secret_count(LEAVER), 0)
		self.assertEqual(session_count(LEAVER), 0)
