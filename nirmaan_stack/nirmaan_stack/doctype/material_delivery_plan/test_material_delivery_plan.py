# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Only Admin and PMO may change a saved Material Delivery Plan's PO (owner, 2026-11-27).

Pure: the plans are built in memory (never inserted) and the role lookup is patched, so nothing here reads
or writes a real plan, PO or user.

Run: bench --site localhost run-tests --module nirmaan_stack.nirmaan_stack.doctype.material_delivery_plan.test_material_delivery_plan
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services import role_profiles

GUARD = "nirmaan_stack.nirmaan_stack.doctype.material_delivery_plan.material_delivery_plan.can_change_material_plan_po"


def _plan(**fields):
	return frappe.get_doc({"doctype": "Material Delivery Plan", "name": "mdp-test", **fields})


def _saved_plan(before: dict, after: dict):
	"""A saved plan whose stored values are `before` and whose edit sets `after` (not new, no DB)."""
	doc = _plan(**{**before, **after})
	doc._doc_before_save = _plan(**before)
	return doc


NEW_PO_PLAN = {"po_type": "New PO", "po_link": None, "delivery_status": "Not Delivered"}
PO_105_PLAN = {"po_type": "Existing PO", "po_link": "PO/105/00107/26-27", "delivery_status": "Not Delivered"}


class TestMaterialPlanPOChangeGuard(FrappeTestCase):
	def _validate(self, doc, allowed: bool):
		with patch(GUARD, return_value=allowed) as check:
			doc.validate()
		return check

	def test_change_po_refused_for_other_roles(self):
		doc = _saved_plan(PO_105_PLAN, {"po_link": "PO/012/00107/26-27"})
		with self.assertRaises(frappe.PermissionError):
			self._validate(doc, allowed=False)

	def test_link_po_on_new_po_plan_refused_for_other_roles(self):
		doc = _saved_plan(NEW_PO_PLAN, {"po_type": "Existing PO", "po_link": "PO/137/00107/26-27"})
		with self.assertRaises(frappe.PermissionError):
			self._validate(doc, allowed=False)

	def test_po_type_change_alone_is_a_po_change(self):
		doc = _saved_plan(NEW_PO_PLAN, {"po_type": "Existing PO"})
		with self.assertRaises(frappe.PermissionError):
			self._validate(doc, allowed=False)

	def test_change_po_allowed_for_admin_and_pmo(self):
		doc = _saved_plan(PO_105_PLAN, {"po_link": "PO/012/00107/26-27"})
		check = self._validate(doc, allowed=True)
		check.assert_called_once_with(frappe.session.user)

	def test_other_edits_are_not_checked(self):
		# Procurement's own edit (delivery status) on the same PO never reaches the role check.
		doc = _saved_plan(PO_105_PLAN, {"delivery_status": "Delivered"})
		check = self._validate(doc, allowed=False)
		check.assert_not_called()

	def test_creating_a_plan_is_not_a_change(self):
		doc = _plan(**PO_105_PLAN)
		doc.set("__islocal", 1)
		check = self._validate(doc, allowed=False)
		check.assert_not_called()


class TestCanChangeMaterialPlanPO(FrappeTestCase):
	def _can(self, profile, user="someone@example.com"):
		with patch.object(role_profiles, "get_role_profile", return_value=profile), patch.object(
			frappe, "get_roles", return_value=[]
		):
			return role_profiles.can_change_material_plan_po(user)

	def test_admin_and_pmo_may(self):
		self.assertTrue(self._can(role_profiles.ADMIN_PROFILE))
		self.assertTrue(self._can(role_profiles.PMO_EXECUTIVE_PROFILE))

	def test_administrator_may(self):
		self.assertTrue(self._can(None, user="Administrator"))

	def test_others_may_not(self):
		for profile in (
			role_profiles.MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE,
			role_profiles.PROCUREMENT_EXECUTIVE_PROFILE,
			role_profiles.PROCUREMENT_LEAD_PROFILE,
			None,
		):
			with self.subTest(profile=profile):
				self.assertFalse(self._can(profile))
