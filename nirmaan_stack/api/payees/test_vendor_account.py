# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The vendor page's Account Details card (#1426, #1435, spec #1420, ADR-0033).

Drives `api/payees/vendor_payee` the way the vendor page does: `get_vendor_account` for the card,
`edit_vendor_payee` for Edit bank details and the rename prompt's "Update the holder name" (the
vendor's Payee edited in place), `change_vendor_payee` for Use a different payee and Add bank details
(an existing Payee through the confirmation, or new bank details). Reads back what the user sees: the
card's Payee and how many other vendors share it, the vendor's Payee after the change, the refusal.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Vendors planted by `TaxedWorkOrderFixture`,
Payees by `PayeeFixture`; both purge after each test.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.payee_fixture import TEST_IFSC, PayeeFixture
from nirmaan_stack.api.payees.vendor_payee import change_vendor_payee, edit_vendor_payee, get_vendor_account
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services.payees.rules import PAYEE_DOCTYPE

U = "Administrator"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"
PROCUREMENT_EXECUTIVE = "Nirmaan Procurement Executive Profile"
OLD_BANK_FIELDS = ("account_name", "account_number", "ifsc", "bank_name", "bank_branch")


class TestVendorAccount(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.payees = PayeeFixture.attach(self)

    def tearDown(self):
        frappe.set_user(U)

    def _vendor(self, payee=None):
        """A vendor as the app makes one (with its empty category list), paid into `payee`."""
        name = self.fx.vendor()
        frappe.db.set_value(
            "Vendors", name, {"payee": payee, "vendor_category": '{"categories": []}'}, update_modified=False
        )
        frappe.db.commit()
        return name

    def _user(self, profile):
        for user in frappe.get_all("Nirmaan Users", filters={"role_profile": profile}, pluck="name", limit=20):
            if user and user != U and frappe.db.exists("User", user):
                return user
        self.skipTest(f"no user with {profile} on this site")

    def _payee_of(self, vendor):
        return frappe.db.get_value("Vendors", vendor, "payee")

    # -- the card -------------------------------------------------------------------------------
    def test_the_card_shows_the_payee_and_how_many_vendors_share_it(self):
        payee = self.payees.payee()
        vendor = self._vendor(payee)
        self._vendor(payee)
        self._vendor(payee)

        account = get_vendor_account(vendor)
        self.assertEqual(account["payee"]["name"], payee)
        self.assertEqual(account["payee"]["vendors"], 3)
        self.assertEqual(account["other_vendors"], 2)

    def test_a_vendor_with_no_payee_has_no_account(self):
        account = get_vendor_account(self._vendor())
        self.assertEqual((account["payee"], account["other_vendors"]), (None, 0))

    # -- Edit bank details (#1435) -----------------------------------------------------------------
    def _account_of(self, payee):
        return frappe.db.get_value(PAYEE_DOCTYPE, payee, ["account_name", "account_number", "ifsc"])

    def test_edit_bank_details_edits_the_vendors_payee_in_place_for_every_vendor_on_it(self):
        payee = self.payees.payee()
        vendor = self._vendor(payee)
        sibling = self._vendor(payee)
        holder = self.payees.holder("Moved banks")
        number = self.payees.account_number()

        result = edit_vendor_payee(vendor, holder, number, "TEST0PYE002")

        self.assertEqual(result["payee"]["name"], payee)
        self.assertEqual((self._payee_of(vendor), self._payee_of(sibling)), (payee, payee))
        self.assertEqual(self._account_of(payee), (holder, number, "TEST0PYE002"))
        self.assertEqual(get_vendor_account(sibling)["payee"]["account_number"], number)

    def test_a_procurement_user_may_update_the_holder_name_from_the_rename_prompt(self):
        payee = self.payees.payee()
        vendor = self._vendor(payee)
        _, number, ifsc = self._account_of(payee)
        holder = self.payees.holder("Kaveri Airtech")
        frappe.set_user(self._user(PROCUREMENT_EXECUTIVE))
        try:
            edit_vendor_payee(vendor, holder, number, ifsc)
        finally:
            frappe.set_user(U)
        self.assertEqual(self._account_of(payee), (holder, number, ifsc))

    def test_editing_to_another_payees_account_is_refused_naming_it(self):
        payee = self.payees.payee()
        vendor = self._vendor(payee)
        number = self.payees.account_number()
        other = self.payees.payee(account_number=number)
        before = self._account_of(payee)

        result = edit_vendor_payee(vendor, before[0], number, TEST_IFSC)

        self.assertEqual(result["duplicate"]["name"], other)
        self.assertIn(other, result["message"])
        self.assertEqual(self._account_of(payee), before)

    def test_a_vendor_with_no_payee_has_no_bank_details_to_edit(self):
        vendor = self._vendor()
        with self.assertRaisesRegex(frappe.ValidationError, "no bank account"):
            edit_vendor_payee(vendor, self.payees.holder(), self.payees.account_number(), TEST_IFSC)

    def test_only_the_vendor_screens_roles_may_edit_bank_details(self):
        payee = self.payees.payee()
        vendor = self._vendor(payee)
        before = self._account_of(payee)
        frappe.set_user(self._user(PROJECT_MANAGER))
        with self.assertRaises(frappe.PermissionError):
            edit_vendor_payee(vendor, self.payees.holder(), self.payees.account_number(), TEST_IFSC)
        frappe.set_user(U)
        self.assertEqual(self._account_of(payee), before)

    # -- Use a different payee ----------------------------------------------------------------------
    def test_change_account_to_an_existing_payee_links_the_vendor_and_writes_no_old_bank_fields(self):
        old = self.payees.payee()
        vendor = self._vendor(old)
        sibling = self._vendor(old)
        new = self.payees.payee()

        result = change_vendor_payee(vendor, payee=new)

        self.assertEqual(result["payee"]["name"], new)
        self.assertEqual(self._payee_of(vendor), new)
        self.assertEqual(self._payee_of(sibling), old, "the other vendor on the old account keeps it")
        doc = frappe.get_doc("Vendors", vendor)
        self.assertEqual([doc.get(f) for f in OLD_BANK_FIELDS], [None] * len(OLD_BANK_FIELDS))

    def test_add_bank_details_creates_a_payee_and_links_the_vendor(self):
        vendor = self._vendor()
        holder = self.payees.holder("Kaveri Airtech")
        number = self.payees.account_number()

        result = change_vendor_payee(
            vendor, bank={"account_name": holder, "account_number": number, "ifsc": TEST_IFSC.lower()}
        )

        payee = frappe.get_doc(PAYEE_DOCTYPE, self._payee_of(vendor))
        self.assertEqual(result["payee"]["name"], payee.name)
        self.assertEqual((payee.account_name, payee.account_number, payee.ifsc), (holder, number, TEST_IFSC))

    def test_bank_details_of_a_payee_on_record_are_refused_naming_it_and_the_vendor_keeps_its_payee(self):
        old = self.payees.payee()
        vendor = self._vendor(old)
        number = self.payees.account_number()
        existing = self.payees.payee(account_number=number)

        result = change_vendor_payee(
            vendor, bank={"account_name": "Someone", "account_number": "00" + number, "ifsc": TEST_IFSC}
        )

        self.assertEqual(result["duplicate"]["name"], existing)
        self.assertIn(existing, result["message"])
        self.assertNotIn("payee", result)
        self.assertEqual(self._payee_of(vendor), old)

    def test_a_payee_that_does_not_exist_cannot_be_picked(self):
        vendor = self._vendor()
        with self.assertRaisesRegex(frappe.DoesNotExistError, "PYE-NOPE"):
            change_vendor_payee(vendor, payee="PYE-NOPE")
        frappe.db.rollback()
        self.assertIsNone(self._payee_of(vendor))

    def test_the_payee_the_vendor_already_has_is_refused(self):
        payee = self.payees.payee()
        vendor = self._vendor(payee)
        with self.assertRaisesRegex(frappe.ValidationError, f"already paid into {payee}"):
            change_vendor_payee(vendor, payee=payee)

    def test_only_the_vendor_screens_roles_may_change_the_account(self):
        vendor = self._vendor()
        payee = self.payees.payee()
        frappe.set_user(self._user(PROJECT_MANAGER))
        with self.assertRaises(frappe.PermissionError):
            change_vendor_payee(vendor, payee=payee)
        frappe.set_user(U)
        self.assertIsNone(self._payee_of(vendor))

    def test_procurement_may_change_the_account(self):
        payee = self.payees.payee()
        vendor = self._vendor()
        frappe.set_user(self._user(PROCUREMENT_EXECUTIVE))
        try:
            change_vendor_payee(vendor, payee=payee)
        finally:
            frappe.set_user(U)
        self.assertEqual(self._payee_of(vendor), payee)
