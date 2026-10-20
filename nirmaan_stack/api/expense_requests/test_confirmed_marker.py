# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""`Expense Type.confirmed_as_request`, "Confirmed as Expense Request" (spec #1494, owner 2026-10-20).

A label only: it changes no behaviour. Only Admin may change it, on every path -- the Expense
Packages Edit dialog (`update_expense_type`) and a direct save through Desk or REST, which ~15 roles
may make because `Expense Type` carries `write` for them.

⚠️ Runs against a live site. Every record is namespaced `exr_conf` and removed.

Run:
  bench --site <site> run-tests --module nirmaan_stack.api.expense_requests.test_confirmed_marker
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.masters import update_expense_type
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user

PM_USER = "exr_conf_pm@example.com"
PM_PROFILE = "Nirmaan Project Manager Profile"
TYPE = "exr_conf Test Type"
NEW_TYPE = "exr_conf New Type"
FIELD = "confirmed_as_request"


def _confirmed(name: str = TYPE) -> int:
	return frappe.db.get_value("Expense Type", name, FIELD)


class TestConfirmedMarker(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		_make_user(PM_USER, PM_PROFILE, ("Nirmaan Project Manager",))
		if not frappe.db.exists("Expense Type", TYPE):
			frappe.get_doc({
				"doctype": "Expense Type", "expense_name": TYPE, "project": 1,
				"expense_category": "Uncategorized",
			}).insert(ignore_permissions=True)
		frappe.db.commit()

	@classmethod
	def tearDownClass(cls):
		frappe.db.rollback()
		frappe.set_user("Administrator")
		for name in (TYPE, NEW_TYPE):
			try:
				if frappe.db.exists("Expense Type", name):
					frappe.delete_doc("Expense Type", name, force=True, ignore_permissions=True)
				frappe.db.commit()
			except Exception as e:  # report, never strand the rest
				frappe.db.rollback()
				print(f"tearDown: could not delete {name}: {e}")
		for dt in ("Nirmaan Users", "User"):
			try:
				if frappe.db.exists(dt, PM_USER):
					frappe.delete_doc(dt, PM_USER, force=True, ignore_permissions=True)
				frappe.db.commit()
			except Exception as e:
				frappe.db.rollback()
				print(f"tearDown: could not delete {dt} {PM_USER}: {e}")
		super().tearDownClass()

	def setUp(self):
		frappe.db.rollback()
		frappe.set_user("Administrator")
		frappe.db.set_value("Expense Type", TYPE, FIELD, 0, update_modified=False)
		frappe.db.commit()
		self.addCleanup(frappe.set_user, "Administrator")

	def _update(self, **kw):
		return update_expense_type(name=TYPE, project=1, non_project=0,
		                           expense_category="Uncategorized", **kw)

	def test_a_new_type_starts_unconfirmed(self):
		self.assertEqual(_confirmed(), 0)

	def test_admin_confirms_and_unconfirms_through_the_edit_dialog(self):
		self._update(confirmed_as_request=1)
		self.assertEqual(_confirmed(), 1)
		self._update(confirmed_as_request=0)
		self.assertEqual(_confirmed(), 0)

	def test_an_edit_that_does_not_send_the_marker_leaves_it(self):
		self._update(confirmed_as_request=1)
		self._update(payee_rule="Optional")
		self.assertEqual(_confirmed(), 1)

	def test_a_non_admin_saving_the_type_directly_may_not_confirm_it(self):
		frappe.set_user(PM_USER)
		doc = frappe.get_doc("Expense Type", TYPE)
		doc.set(FIELD, 1)
		with self.assertRaises(frappe.PermissionError):
			doc.save()
		frappe.db.rollback()
		frappe.set_user("Administrator")
		self.assertEqual(_confirmed(), 0)

	def test_a_non_admin_may_not_unconfirm_it_either(self):
		self._update(confirmed_as_request=1)
		frappe.set_user(PM_USER)
		doc = frappe.get_doc("Expense Type", TYPE)
		doc.set(FIELD, 0)
		with self.assertRaises(frappe.PermissionError):
			doc.save()
		frappe.db.rollback()
		frappe.set_user("Administrator")
		self.assertEqual(_confirmed(), 1)

	def test_a_non_admin_may_not_create_a_type_already_confirmed(self):
		frappe.set_user(PM_USER)
		doc = frappe.get_doc({
			"doctype": "Expense Type", "expense_name": NEW_TYPE, "project": 1,
			"expense_category": "Uncategorized", FIELD: 1,
		})
		with self.assertRaises(frappe.PermissionError):
			doc.insert()
		frappe.db.rollback()
		frappe.set_user("Administrator")
		self.assertFalse(frappe.db.exists("Expense Type", NEW_TYPE))

	def test_a_non_admin_save_that_leaves_the_marker_alone_is_not_refused_for_it(self):
		self._update(confirmed_as_request=1)
		frappe.set_user(PM_USER)
		doc = frappe.get_doc("Expense Type", TYPE)
		doc.non_project = 1
		doc.save()
		frappe.db.commit()
		frappe.set_user("Administrator")
		self.assertEqual(_confirmed(), 1)
		self.assertEqual(frappe.db.get_value("Expense Type", TYPE, "non_project"), 1)
		frappe.db.set_value("Expense Type", TYPE, "non_project", 0, update_modified=False)
		frappe.db.commit()

	def test_a_non_admin_may_not_use_the_edit_dialog_endpoint(self):
		frappe.set_user(PM_USER)
		with self.assertRaises(frappe.PermissionError):
			self._update(confirmed_as_request=1)
		frappe.set_user("Administrator")
		self.assertEqual(_confirmed(), 0)
