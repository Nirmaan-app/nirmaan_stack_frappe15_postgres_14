# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Screens read a vendor's bank account from its Payee (#1428, spec #1420, ADR-0033).

Drives `get_vendor_list` (the vendor list's bank columns).
Reads back what a screen shows: the Payee's details, or nothing for a vendor with no Payee.

⚠️ RUNS AGAINST THE ENV DATABASE (the fixtures commit). Vendors by `TaxedWorkOrderFixture`, Payees
by `PayeeFixture`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.payee_fixture import TEST_IFSC, PayeeFixture
from nirmaan_stack.api.payees.vendor_accounts import get_vendor_list
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

U = "Administrator"


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
        frappe.db.set_value("Vendors", name, "payee", payee, update_modified=False)
        return name

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
