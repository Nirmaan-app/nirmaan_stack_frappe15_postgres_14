# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Adding a Payee from the Payees page (#1422, spec #1420, ADR-0033).

Drives `api/payees/add_payee` against the database the way the Add Payee dialog does, and reads back
what the user sees: the new Payee, the existing Payee a duplicate names, or the refusal.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoint commits). IFSC lookups are answered offline and every
Payee is purged by `PayeeFixture`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.add_payee import add_payee, check_payee, lookup_ifsc
from nirmaan_stack.api.payees.payee_fixture import TEST_IFSC, PayeeFixture, shown_to_client
from nirmaan_stack.services.payees.rules import ACTIVE, PAYEE_DOCTYPE, PAYEE_STATUSES
from nirmaan_stack.services.payees.writer import DuplicatePayeeError

U = "Administrator"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"


class TestAddPayee(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.payees = PayeeFixture.attach(self)

    def tearDown(self):
        frappe.set_user(U)

    def _user(self, profile):
        for user in frappe.get_all("Nirmaan Users", filters={"role_profile": profile}, pluck="name", limit=20):
            if user and user != U and frappe.db.exists("User", user):
                return user
        self.skipTest(f"no user with {profile} on this site")

    def test_adds_an_active_payee_with_the_bank_and_branch_from_the_ifsc(self):
        holder = self.payees.holder("Kaveri Ductfab")
        result = add_payee(holder, "5020 0061-234567", "test0pye001")

        payee = result["payee"]
        self.assertRegex(payee["name"], r"^PYE-\d{4,}$")
        doc = frappe.get_doc(PAYEE_DOCTYPE, payee["name"])
        self.assertEqual(
            (doc.account_name, doc.account_number, doc.ifsc, doc.bank_name, doc.bank_branch, doc.status),
            (holder, "50200061234567", TEST_IFSC, "Test Bank", "Test Branch", ACTIVE),
        )

    def test_the_same_account_and_ifsc_is_refused_and_names_the_existing_payee(self):
        existing = self.payees.payee(holder=self.payees.holder("Original"), account_number="0050200061234567")

        for typed in ("50200061234567", "0050 2000 6123 4567", "005-020-006-123-4567", "00050200061234567"):
            with self.subTest(typed=typed):
                result = add_payee(self.payees.holder("Copy"), typed, TEST_IFSC)
                self.assertNotIn("payee", result)
                self.assertEqual(result["duplicate"]["name"], existing)
                self.assertIn(existing, result["message"])

        self.assertEqual(frappe.db.count(PAYEE_DOCTYPE, {"normalized_account": "50200061234567", "ifsc": TEST_IFSC}), 1)

    def test_the_same_account_at_another_ifsc_is_another_payee(self):
        number = self.payees.account_number()
        self.payees.payee(account_number=number)
        result = add_payee(self.payees.holder("Other branch"), number, "TEST0PYE002")
        self.assertIn("payee", result)

    def test_check_payee_reports_the_duplicate_before_submit(self):
        number = self.payees.account_number()
        existing = self.payees.payee(account_number=number)
        self.assertEqual(check_payee("0" + number, TEST_IFSC)["duplicate"]["name"], existing)
        self.assertIsNone(check_payee(self.payees.account_number(), TEST_IFSC)["duplicate"])

    def test_no_other_write_path_can_save_a_duplicate(self):
        number = self.payees.account_number()
        existing = self.payees.payee(account_number=number)
        dup = frappe.get_doc({
            "doctype": PAYEE_DOCTYPE,
            "account_name": self.payees.holder("Desk copy"),
            "account_number": f"00{number}",
            "ifsc": TEST_IFSC,
        })
        with self.assertRaisesRegex(frappe.ValidationError, existing):
            dup.insert(ignore_permissions=True)
        frappe.db.rollback()

    def test_a_refused_duplicate_tells_every_client_why(self):
        """Desk showed nothing on a duplicate save (#1420 walk A15): the refusal must carry its
        message to the client, and still name the existing Payee for the screens that offer it."""
        number = self.payees.account_number()
        existing = self.payees.payee(account_number=number)
        dup = frappe.get_doc({"doctype": PAYEE_DOCTYPE, "account_name": self.payees.holder("Desk copy"),
                              "account_number": number, "ifsc": TEST_IFSC})
        with shown_to_client() as shown, self.assertRaises(DuplicatePayeeError) as refused:
            dup.insert(ignore_permissions=True)
        frappe.db.rollback()
        self.assertEqual(refused.exception.existing, existing)
        self.assertTrue(any(existing in m and "already a payee" in m for m in shown), shown)

    def test_an_ifsc_the_lookup_cannot_find_is_refused(self):
        self.payees.fail_ifsc_lookup()
        number = self.payees.account_number()
        with self.assertRaisesRegex(frappe.ValidationError, "TEST0PYE001"):
            add_payee(self.payees.holder(), number, TEST_IFSC)
        frappe.db.rollback()
        with self.assertRaisesRegex(frappe.ValidationError, "TEST0PYE001"):
            lookup_ifsc(TEST_IFSC)
        self.assertFalse(frappe.db.exists(PAYEE_DOCTYPE, {"account_number": number}))

    def test_incomplete_details_are_refused(self):
        with self.assertRaisesRegex(frappe.ValidationError, "holder name"):
            add_payee("  ", self.payees.account_number(), TEST_IFSC)
        with self.assertRaisesRegex(frappe.ValidationError, "11 characters"):
            add_payee(self.payees.holder(), self.payees.account_number(), "TEST0PYE")
        frappe.db.rollback()

    def test_only_accounts_and_admin_may_add_from_the_payees_page(self):
        user = self._user(PROJECT_MANAGER)
        frappe.set_user(user)
        with self.assertRaises(frappe.PermissionError):
            add_payee(self.payees.holder(), self.payees.account_number(), TEST_IFSC)
        frappe.set_user(U)
        frappe.db.rollback()

    def test_status_options_match_the_doctype(self):
        options = frappe.get_meta(PAYEE_DOCTYPE).get_field("status").options.split("\n")
        self.assertEqual(tuple(options), PAYEE_STATUSES)
