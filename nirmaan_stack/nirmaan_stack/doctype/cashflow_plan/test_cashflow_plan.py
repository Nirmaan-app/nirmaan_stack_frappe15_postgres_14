# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Only Admin and PMO may change a saved Cashflow Plan entry's PO / WO (owner, 2026-11-27, "like material plan").

Pure: the entries are built in memory (never inserted) and the role lookup is patched, so nothing here reads or
writes a real entry, PO, WO or user.

Run: bench --site localhost run-tests --module nirmaan_stack.nirmaan_stack.doctype.cashflow_plan.test_cashflow_plan
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services import role_profiles

GUARD = "nirmaan_stack.nirmaan_stack.doctype.cashflow_plan.cashflow_plan.can_change_cashflow_plan_link"


def _entry(**fields):
	return frappe.get_doc({"doctype": "Cashflow Plan", "name": "cf-test", **fields})


def _saved_entry(before: dict, after: dict):
	"""A saved entry whose stored values are `before` and whose edit sets `after` (not new, no DB)."""
	doc = _entry(**{**before, **after})
	doc._doc_before_save = _entry(**before)
	return doc


NEW_PO = {"type": "New PO", "id_link": "", "planned_amount": 40000}
EXISTING_PO = {"type": "Existing PO", "id_link": "PO/149/00107/26-27", "planned_amount": 10350}
NEW_WO = {"type": "New WO", "id_link": "", "planned_amount": 18000}
EXISTING_WO = {"type": "Existing WO", "id_link": "SR-00107-001158", "planned_amount": 7670}


class TestCashflowLinkChangeGuard(FrappeTestCase):
	def _validate(self, doc, allowed: bool):
		with patch(GUARD, return_value=allowed) as check:
			doc.validate()
		return check

	def test_link_and_change_refused_for_other_roles(self):
		for before, after in (
			(NEW_PO, {"type": "Existing PO", "id_link": "PO/140/00107/26-27"}),
			(EXISTING_PO, {"id_link": "PO/145/00107/26-27"}),
			(NEW_WO, {"type": "Existing WO", "id_link": "SR-00107-001159"}),
			(EXISTING_WO, {"id_link": "SR-00107-001159"}),
			(NEW_PO, {"type": "Existing PO"}),  # a type change alone is a change
		):
			with self.subTest(before=before["type"], after=after):
				with self.assertRaises(frappe.PermissionError):
					self._validate(_saved_entry(before, after), allowed=False)

	def test_allowed_for_admin_and_pmo(self):
		check = self._validate(_saved_entry(EXISTING_WO, {"id_link": "SR-00107-001159"}), allowed=True)
		check.assert_called_once_with(frappe.session.user)

	def test_other_edits_are_not_checked(self):
		check = self._validate(_saved_entry(EXISTING_PO, {"planned_amount": 12000}), allowed=False)
		check.assert_not_called()

	def test_creating_an_entry_is_not_a_change(self):
		doc = _entry(**EXISTING_WO)
		doc.set("__islocal", 1)
		check = self._validate(doc, allowed=False)
		check.assert_not_called()


class TestCanChangeCashflowPlanLink(FrappeTestCase):
	def _can(self, profile, user="someone@example.com"):
		with patch.object(role_profiles, "get_role_profile", return_value=profile), patch.object(
			frappe, "get_roles", return_value=[]
		):
			return role_profiles.can_change_cashflow_plan_link(user)

	def test_admin_pmo_and_administrator_may(self):
		self.assertTrue(self._can(role_profiles.ADMIN_PROFILE))
		self.assertTrue(self._can(role_profiles.PMO_EXECUTIVE_PROFILE))
		self.assertTrue(self._can(None, user="Administrator"))

	def test_others_may_not(self):
		for profile in (role_profiles.PROCUREMENT_EXECUTIVE_PROFILE, role_profiles.MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE, None):
			with self.subTest(profile=profile):
				self.assertFalse(self._can(profile))
