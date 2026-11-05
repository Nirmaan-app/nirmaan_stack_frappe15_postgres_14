"""Creating users and resetting passwords: only User admins (Admin, PMO Executive, HR Executive, Administrator).

All people here are made up (`*@example.com`).
"""

from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import frappe
from frappe.core.doctype.user.user import User, _get_user_for_update_password
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.users import create_user, reset_password
from nirmaan_stack.integrations.controllers.test_nirmaan_users import make_user, remove_user
from nirmaan_stack.services.role_profiles import (
	ADMIN_PROFILE,
	HR_EXECUTIVE_PROFILE,
	PMO_EXECUTIVE_PROFILE,
)

PM_PROFILE = "Nirmaan Project Manager Profile"
ACTORS = {
	"admin": ("ua-admin@example.com", ADMIN_PROFILE),
	"pmo": ("ua-pmo@example.com", PMO_EXECUTIVE_PROFILE),
	"hr": ("ua-hr@example.com", HR_EXECUTIVE_PROFILE),
	"pm": ("ua-pm@example.com", PM_PROFILE),
}
TARGET = "ua-target@example.com"
NEW = "ua-new-{}@example.com"


class _UsersBase(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		for email, profile in ACTORS.values():
			make_user(email, profile)
		make_user(TARGET, PM_PROFILE)
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		for email, _ in ACTORS.values():
			remove_user(email)
		remove_user(TARGET)
		for key in ACTORS:
			remove_user(NEW.format(key))
		super().tearDownClass()

	def tearDown(self):
		frappe.set_user("Administrator")

	def as_actor(self, key, fn, *args, **kwargs):
		frappe.set_user(ACTORS[key][0])
		try:
			return fn(*args, **kwargs)
		finally:
			frappe.set_user("Administrator")


@patch.object(User, "send_welcome_mail_to_user", lambda self: None)
class TestCreateUser(_UsersBase):
	def _create(self, key):
		return self.as_actor(
			key, create_user, first_name="New", email=NEW.format(key), role_profile_name=ADMIN_PROFILE
		)

	def test_project_manager_may_not_create_a_user(self):
		with self.assertRaises(frappe.PermissionError):
			self._create("pm")
		self.assertFalse(frappe.db.exists("User", NEW.format("pm")))

	def test_user_admins_may_create_an_admin(self):
		for key in ("admin", "pmo", "hr"):
			with self.subTest(key):
				self.assertTrue(self._create(key)["success"])
				self.assertEqual(
					frappe.db.get_value("Nirmaan Users", NEW.format(key), "role_profile"), ADMIN_PROFILE
				)


class TestResetPassword(_UsersBase):
	def _reset(self, key, mail=None):
		"""Reset TARGET's password as `key`; return (response, the link the mail carried)."""
		sent = []

		def capture(*args, **kwargs):
			sent.append(kwargs["args"]["link"])
			if mail:
				mail()

		with patch("frappe.sendmail", capture):
			response = self.as_actor(key, reset_password, TARGET)
		return response, (sent[0] if sent else None)

	def test_project_manager_may_not_reset_a_password(self):
		with self.assertRaises(frappe.PermissionError):
			self._reset("pm")

	def test_user_admins_send_a_link_frappe_accepts(self):
		for key in ("admin", "pmo", "hr"):
			with self.subTest(key):
				response, link = self._reset(key)
				self.assertTrue(response["email_sent"])
				reset_key = parse_qs(urlparse(link).query)["key"][0]
				self.assertEqual(_get_user_for_update_password(reset_key, None).user, TARGET)

	def test_the_link_is_never_returned(self):
		def fail():
			raise frappe.OutgoingEmailError("no mail server")

		for mail in (None, fail):
			with self.subTest(mail_fails=bool(mail)):
				response, link = self._reset("admin", mail)
				self.assertNotIn("reset_link", response)
				self.assertNotIn(link, str(response))
				self.assertEqual(response["email_sent"], mail is None)
