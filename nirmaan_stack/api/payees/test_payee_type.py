# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Payee Type (owner, 2026-10-23): where a Payee was created, set once and never changed.

Users -- a person's own account from Raise Reimbursement (pinned in `test_reimbursements`
`test_a_new_account_becomes_a_payee_and_yours`); Vendors -- a vendor's new bank details; Others -- anywhere
else. Payees made before the field are typed once by `patches/v3_0/backfill_payee_type` from their links.

Every Payee here is the fixture's own (`PayeeFixture`), purged after each test. The patch is exercised
through `plan()` only, which reads; `backfill()` would retype every Payee on the site.

Run:
  bench --site localhost run-tests --module nirmaan_stack.api.payees.test_payee_type

⚠️ RUNS AGAINST THE ENV DATABASE (the fixture commits).
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.list_payees import get_payees
from nirmaan_stack.api.payees.payee_fixture import PayeeFixture, TEST_IFSC
from nirmaan_stack.patches.v3_0.backfill_payee_type import plan
from nirmaan_stack.services.payees.choosing import choose_payee
from nirmaan_stack.services.payees.rules import (
	PAYEE_DOCTYPE,
	PAYEE_TYPE_OTHERS,
	PAYEE_TYPE_USERS,
	PAYEE_TYPE_VENDORS,
	PAYEE_TYPES,
	payee_type_from_links,
)
from nirmaan_stack.services.payees.writer import create_payee


class TestPayeeTypeField(FrappeTestCase):
	def test_the_options_are_the_rules_types_set_once_and_read_only(self):
		field = frappe.get_meta(PAYEE_DOCTYPE).get_field("payee_type")
		self.assertEqual(tuple(field.options.split("\n")), PAYEE_TYPES)
		self.assertEqual(field.default, PAYEE_TYPE_OTHERS)
		self.assertTrue(field.read_only)
		self.assertTrue(field.set_only_once)

	def test_the_backfill_rule_reads_the_links(self):
		self.assertEqual(payee_type_from_links(True, 0), PAYEE_TYPE_USERS)
		self.assertEqual(payee_type_from_links(True, 3), PAYEE_TYPE_USERS)
		self.assertEqual(payee_type_from_links(False, 1), PAYEE_TYPE_VENDORS)
		self.assertEqual(payee_type_from_links(False, 0), PAYEE_TYPE_OTHERS)


class TestPayeeTypeOnCreate(FrappeTestCase):
	def setUp(self):
		self.payees = PayeeFixture.attach(self)

	def type_of(self, name: str) -> str:
		return frappe.db.get_value(PAYEE_DOCTYPE, name, "payee_type")

	def test_a_payee_made_anywhere_else_is_others(self):
		self.assertEqual(self.type_of(self.payees.payee()), PAYEE_TYPE_OTHERS)

	def test_a_vendors_new_bank_details_make_a_vendors_payee(self):
		name = choose_payee(bank={
			"account_name": PayeeFixture.holder("Vendor"),
			"account_number": PayeeFixture.account_number(),
			"ifsc": TEST_IFSC,
		})
		frappe.db.commit()
		self.assertEqual(self.type_of(name), PAYEE_TYPE_VENDORS)

	def test_an_unknown_type_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			create_payee(PayeeFixture.holder(), PayeeFixture.account_number(), TEST_IFSC, "Staff")
		frappe.db.rollback()

	def test_the_type_never_changes_after_creation(self):
		doc = frappe.get_doc(PAYEE_DOCTYPE, self.payees.payee())
		doc.payee_type = PAYEE_TYPE_USERS
		with self.assertRaises(frappe.ValidationError):
			doc.save(ignore_permissions=True)
		frappe.db.rollback()
		self.assertEqual(self.type_of(doc.name), PAYEE_TYPE_OTHERS)

	def test_an_edit_of_the_details_keeps_the_type(self):
		name = self.payees.payee()
		doc = frappe.get_doc(PAYEE_DOCTYPE, name)
		doc.account_name = PayeeFixture.holder("Renamed")
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		self.assertEqual(self.type_of(name), PAYEE_TYPE_OTHERS)


class TestPayeeTypeOnTheList(FrappeTestCase):
	def setUp(self):
		self.payees = PayeeFixture.attach(self)

	def test_the_list_returns_the_type_and_filters_on_it(self):
		others = self.payees.payee()
		vendors = choose_payee(bank={
			"account_name": PayeeFixture.holder("Vendor"),
			"account_number": PayeeFixture.account_number(),
			"ifsc": TEST_IFSC,
		})
		frappe.db.commit()
		mine = ["name", "in", [others, vendors]]
		rows = get_payees(filters=[mine, ["payee_type", "=", PAYEE_TYPE_VENDORS]])["data"]
		self.assertEqual([r["name"] for r in rows], [vendors])
		self.assertEqual(rows[0]["payee_type"], PAYEE_TYPE_VENDORS)
		rows = get_payees(filters=[mine, ["payee_type", "in", [PAYEE_TYPE_OTHERS, PAYEE_TYPE_USERS]]])["data"]
		self.assertEqual([r["name"] for r in rows], [others])


class TestBackfillPlan(FrappeTestCase):
	def setUp(self):
		self.payees = PayeeFixture.attach(self)

	def test_old_payees_are_typed_from_what_links_to_them(self):
		linked = self.payees.payee()
		self.payees.vendor(linked)
		plain = self.payees.payee()
		changes = plan()
		# A row made before the field read the default, Others; a vendor is paid into it, so Vendors.
		self.assertIn(linked, changes[PAYEE_TYPE_VENDORS])
		# Already Others with nothing linked: nothing to write.
		self.assertFalse(any(plain in names for names in changes.values()))
