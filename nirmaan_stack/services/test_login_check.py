"""The read-only check the owner runs on production after deploy.

All people here are made up (`*@example.com`).
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.integrations.controllers.test_nirmaan_users import (
	make_user,
	remove_user,
	set_role_copy_for_test,
)
from nirmaan_stack.services import login_check

PM_PROFILE = "Nirmaan Project Manager Profile"
DRIFTED = "check-drifted@example.com"
LEFT = "check-left@example.com"
FINE = "check-fine@example.com"


class TestLoginCheck(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		for email in (DRIFTED, LEFT, FINE):
			make_user(email, PM_PROFILE)
		set_role_copy_for_test(DRIFTED, "Nirmaan Admin Profile")
		frappe.db.delete("Nirmaan Users", {"name": LEFT})
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		for email in (DRIFTED, LEFT, FINE):
			remove_user(email)
		super().tearDownClass()

	def test_it_lists_both_kinds_of_drift(self):
		drift = {row.name: row for row in login_check.role_copy_drift()}
		self.assertEqual(
			(drift[DRIFTED].copy_on_nirmaan_users, drift[DRIFTED].on_user), ("Nirmaan Admin Profile", PM_PROFILE)
		)
		self.assertNotIn(FINE, drift)
		self.assertNotIn("Administrator", drift)

		still_on = {row.name: row for row in login_check.logins_still_on()}
		self.assertIn(LEFT, still_on)
		self.assertNotIn(FINE, still_on)
		self.assertNotIn(DRIFTED, still_on)

	def test_run_prints_both_lists_and_writes_nothing(self):
		statements = []
		real_sql = frappe.db.sql

		def record(query, *args, **kwargs):
			statements.append(str(query).strip().split()[0].upper())
			return real_sql(query, *args, **kwargs)

		with patch.object(frappe.db, "sql", record), patch("builtins.print") as printed:
			login_check.run()

		out = "\n".join(" ".join(map(str, call.args)) for call in printed.call_args_list)
		self.assertIn(DRIFTED, out)
		self.assertIn(LEFT, out)
		self.assertTrue(statements)
		self.assertEqual(set(statements), {"SELECT"})
