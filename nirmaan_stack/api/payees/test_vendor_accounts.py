# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Screens read a vendor's bank account from its Payee (#1428, spec #1420, ADR-0033).

Drives the two endpoints the screens call: `get_vendor_payee_accounts` (hover card, detail popover,
the payment-request gate, the bank file) and `get_vendor_list` (the vendor list's bank columns).
Reads back what a screen shows: the Payee's details, or nothing for a vendor with no Payee.

⚠️ RUNS AGAINST THE ENV DATABASE (the fixtures commit). Vendors by `TaxedWorkOrderFixture`, Payees
by `PayeeFixture`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.payee_fixture import TEST_IFSC, PayeeFixture
from nirmaan_stack.api.payees.vendor_accounts import get_vendor_list, get_vendor_payee_accounts
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

U = "Administrator"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"


class TestVendorAccounts(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.payees = PayeeFixture.attach(self)
        self.holder = self.payees.holder("Acme Traders")
        self.number = self.payees.account_number()
        self.payee = self.payees.payee(holder=self.holder, account_number=self.number)
        self.with_payee = self._vendor(payee=self.payee)
        self.without_payee = self._vendor(payee=None)
        frappe.db.commit()

    def tearDown(self):
        frappe.set_user(U)

    def _vendor(self, payee):
        name = self.fx.vendor()
        # The old vendor bank fields still hold something else: a screen must not show them.
        frappe.db.set_value(
            "Vendors", name,
            {"payee": payee, "account_name": "OLD HOLDER", "account_number": "111", "ifsc": "OLDB0000001"},
            update_modified=False,
        )
        return name

    def _user(self, profile):
        for user in frappe.get_all("Nirmaan Users", filters={"role_profile": profile}, pluck="name", limit=20):
            if user and user != U and frappe.db.exists("User", user):
                return user
        self.skipTest(f"no user with {profile} on this site")

    def test_a_vendor_reads_its_payees_account(self):
        accounts = get_vendor_payee_accounts([self.with_payee, self.without_payee])

        self.assertEqual(accounts, {
            self.with_payee: {
                "payee": self.payee,
                "account_name": self.holder,
                "account_number": self.number,
                "ifsc": TEST_IFSC,
                "bank_name": "Test Bank",
                "bank_branch": "Test Branch",
                "status": "Active",
            },
        })

    def test_vendors_arrive_as_json_from_the_browser(self):
        accounts = get_vendor_payee_accounts(frappe.as_json([self.with_payee]))

        self.assertEqual(list(accounts), [self.with_payee])

    def test_no_vendors_reads_nothing(self):
        self.assertEqual(get_vendor_payee_accounts([]), {})

    def test_anyone_who_reads_vendors_reads_their_accounts_without_payee_access(self):
        user = self._user(PROJECT_MANAGER)
        self.assertFalse(frappe.has_permission("Payee", "read", user=user))
        frappe.set_user(user)

        accounts = get_vendor_payee_accounts([self.with_payee])

        self.assertEqual(accounts[self.with_payee]["account_number"], self.number)

    def test_someone_who_cannot_read_vendors_is_refused(self):
        frappe.set_user("Guest")

        with self.assertRaises(frappe.PermissionError):
            get_vendor_payee_accounts([self.with_payee])

    def test_the_vendor_list_carries_each_vendors_payee_columns(self):
        result = get_vendor_list(
            doctype="Vendors",
            fields=frappe.as_json(["name", "vendor_name"]),
            filters=frappe.as_json([["name", "in", [self.with_payee, self.without_payee]]]),
            order_by="name asc",
        )

        rows = {row["name"]: row for row in result["data"]}
        self.assertEqual(result["total_count"], 2)
        self.assertEqual(
            {k: v for k, v in rows[self.with_payee].items() if k.startswith("payee_")},
            {
                "payee_account_name": self.holder,
                "payee_account_number": self.number,
                "payee_ifsc": TEST_IFSC,
                "payee_bank_name": "Test Bank",
                "payee_bank_branch": "Test Branch",
            },
        )
        self.assertEqual(
            {k: v for k, v in rows[self.without_payee].items() if k.startswith("payee_")},
            {
                "payee_account_name": None,
                "payee_account_number": None,
                "payee_ifsc": None,
                "payee_bank_name": None,
                "payee_bank_branch": None,
            },
        )

    def test_the_vendor_list_lists_only_vendors(self):
        with self.assertRaises(frappe.ValidationError):
            get_vendor_list(doctype="Payee", fields=frappe.as_json(["name"]))
