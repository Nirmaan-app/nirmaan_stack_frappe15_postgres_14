# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Payees list (#1422, #1434, spec #1420): rows with how many vendors link to each Payee, the
All / "No vendor" tabs with counts, and search.

Drives `api/payees/list_payees.get_payees` the way the Payees page's table does. Every test narrows
the list with a search on its own holder-name tag, so Payees already on the site never count.

⚠️ RUNS AGAINST THE ENV DATABASE. Vendors come from `TaxedWorkOrderFixture`, Payees from `PayeeFixture`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.list_payees import get_payees
from nirmaan_stack.api.payees.payee_fixture import PayeeFixture
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

U = "Administrator"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"


class TestListPayees(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.payees = PayeeFixture.attach(self)
        self.tag = frappe.generate_hash(length=6)

        # Shared by two vendors.
        self.shared = self.payees.payee(holder=self._holder("Kaveri Ductfab"))
        self.vendor_a, self.vendor_b = self.fx.vendor(), self.fx.vendor()
        for vendor in (self.vendor_a, self.vendor_b):
            frappe.db.set_value("Vendors", vendor, "payee", self.shared, update_modified=False)

        # No vendor: used only for expenses, or not at all.
        self.landlord_number = "0036147100982211"
        self.landlord = self.payees.payee(holder=self._holder("Sunrise Properties"), account_number=self.landlord_number)
        self.orphan = self.payees.payee(holder=self._holder("Mahalaxmi Hardware"))
        frappe.db.commit()

    def tearDown(self):
        frappe.set_user(U)

    # -- helpers --------------------------------------------------------------------------------
    def _holder(self, name):
        return f"{self.payees.holder(name)} {self.tag}"

    def _list(self, tab="all", search=None, field="account_name", **kwargs):
        return get_payees(
            search_term=search if search is not None else self.tag,
            current_search_fields=[field],
            filters=[["tab", "=", tab]],
            **kwargs,
        )

    def _row(self, result, name):
        return next(r for r in result["data"] if r["name"] == name)

    # -- tests ----------------------------------------------------------------------------------
    def test_rows_say_how_many_vendors_link_to_each_payee(self):
        result = self._list()
        self.assertEqual(self._row(result, self.shared)["vendors"], 2)
        landlord = self._row(result, self.landlord)
        self.assertEqual(landlord["vendors"], 0)
        self.assertEqual(landlord["account_number"], "0036147100982211")
        self.assertEqual((landlord["bank_name"], landlord["bank_branch"]), ("Test Bank", "Test Branch"))

    def test_rows_carry_no_status_expense_count_or_last_paid(self):
        row = self._row(self._list(), self.shared)
        for gone in ("status", "expenses", "last_paid"):
            with self.subTest(field=gone):
                self.assertNotIn(gone, row)

    def test_tabs_are_all_and_no_vendor_and_count_each(self):
        every = self._list("all")
        self.assertEqual({r["name"] for r in every["data"]}, {self.shared, self.landlord, self.orphan})
        self.assertEqual(every["total_count"], 3)
        self.assertEqual((every["aggregates"]["all_count"], every["aggregates"]["no_vendor_count"]), (3, 2))

        no_vendor = self._list("no_vendor")
        self.assertEqual({r["name"] for r in no_vendor["data"]}, {self.landlord, self.orphan})
        self.assertEqual(no_vendor["total_count"], 2)

    def test_an_old_tab_is_refused(self):
        for tab in ("active", "inactive", "unlinked"):
            with self.subTest(tab=tab), self.assertRaises(frappe.ValidationError):
                self._list(tab)

    def test_search_by_account_number_ignores_leading_zeros_and_spaces(self):
        for typed in ("36147100982211", "0036 1471 0098 2211", "1471009822"):
            with self.subTest(typed=typed):
                rows = self._list(search=typed, field="account_number")["data"]
                self.assertIn(self.landlord, [r["name"] for r in rows])

    def test_search_by_linked_vendor(self):
        vendor_name = frappe.db.get_value("Vendors", self.vendor_b, "vendor_name")
        rows = self._list(search=vendor_name, field="vendor_name")["data"]
        self.assertEqual([r["name"] for r in rows], [self.shared])

    def test_export_returns_every_row_of_the_tab(self):
        result = self._list("all", for_export="true", limit_page_length=0)
        self.assertEqual(len(result["data"]), 3)

    def test_only_accounts_and_admin_may_list_payees(self):
        users = frappe.get_all("Nirmaan Users", filters={"role_profile": PROJECT_MANAGER}, pluck="name", limit=5)
        user = next((u for u in users if u != U and frappe.db.exists("User", u)), None)
        if not user:
            self.skipTest("no Project Manager on this site")
        frappe.set_user(user)
        with self.assertRaises(frappe.PermissionError):
            self._list()
