# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Payees list (#1422, spec #1420): rows with what each Payee is linked to and when it was last
paid, the Active / Inactive / "Not linked to anything" tabs with counts, and search.

Drives `api/payees/list_payees.get_payees` the way the Payees page's table does. Every test narrows
the list with a search on its own holder-name tag, so Payees already on the site never count.

⚠️ RUNS AGAINST THE ENV DATABASE. Vendors and payments come from `TaxedWorkOrderFixture`, Payees from
`PayeeFixture`; the expenses planted here are deleted by the test's own cleanup.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.list_payees import get_payees
from nirmaan_stack.api.payees.payee_fixture import PayeeFixture
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services.payees.links import is_paid
from nirmaan_stack.services.payees.rules import INACTIVE, PAYEE_DOCTYPE

U = "Administrator"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"


class TestListPayees(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.payees = PayeeFixture.attach(self)
        self.expenses: list[tuple[str, str]] = []
        self.addCleanup(self._purge_expenses)
        self.tag = frappe.generate_hash(length=6)

        # Shared: two vendors, one paid on 2026-10-08 (and one Approved payment, which is not paid).
        self.shared = self.payees.payee(holder=self._holder("Kaveri Ductfab"))
        self.vendor_a, self.vendor_b = self.fx.vendor(), self.fx.vendor()
        for vendor in (self.vendor_a, self.vendor_b):
            frappe.db.set_value("Vendors", vendor, "payee", self.shared, update_modified=False)
        self._payment(self.vendor_a, "Paid", "2026-10-08")
        self._payment(self.vendor_b, "Approved", "2026-10-12")

        # Expense-only: a Paid Non Project Expense on 2026-10-11 and an Approved Project Expense.
        self.landlord_number = "0036147100982211"
        self.landlord = self.payees.payee(holder=self._holder("Sunrise Properties"), account_number=self.landlord_number)
        self._expense("Non Project Expenses", "Paid", "2026-10-11")
        self._expense("Project Expenses", "Approved", None)

        self.orphan = self.payees.payee(holder=self._holder("Mahalaxmi Hardware"))
        self.moved = self.payees.payee(holder=self._holder("Anil Verma old account"))
        frappe.db.set_value(PAYEE_DOCTYPE, self.moved, "status", INACTIVE)
        frappe.db.commit()

    def tearDown(self):
        frappe.set_user(U)

    # -- helpers --------------------------------------------------------------------------------
    def _holder(self, name):
        return f"{self.payees.holder(name)} {self.tag}"

    def _payment(self, vendor, status, payment_date):
        name = self.fx._name("PAY")
        frappe.db.sql(
            """INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner, docstatus, idx,
                   vendor, amount, status, payment_date, document_type, document_name)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 1000, %s, %s, 'Procurement Orders', %s)""",
            (name, U, U, vendor, status, payment_date, name),
        )
        self.fx.payments.append(name)

    def _expense(self, doctype, status, payment_date):
        name = f"TEST-PYE-EXP-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner, docstatus, idx,
                    amount, status, payment_date, payee)
                VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, 500, %s, %s, %s)""",
            (name, U, U, status, payment_date, self.landlord),
        )
        self.expenses.append((doctype, name))

    def _purge_expenses(self):
        frappe.db.rollback()
        for doctype, name in self.expenses:
            frappe.db.delete(doctype, {"name": name})
        frappe.db.commit()

    def _list(self, tab="active", search=None, field="account_name", **kwargs):
        return get_payees(
            search_term=search if search is not None else self.tag,
            current_search_fields=[field],
            filters=[["tab", "=", tab]],
            **kwargs,
        )

    def _row(self, result, name):
        return next(r for r in result["data"] if r["name"] == name)

    # -- tests ----------------------------------------------------------------------------------
    def test_rows_say_what_each_payee_is_linked_to_and_when_it_was_last_paid(self):
        result = self._list()
        shared = self._row(result, self.shared)
        self.assertEqual((shared["vendors"], shared["expenses"], shared["last_paid"]), (2, 0, "2026-10-08"))
        landlord = self._row(result, self.landlord)
        self.assertEqual((landlord["vendors"], landlord["expenses"], landlord["last_paid"]), (0, 2, "2026-10-11"))
        orphan = self._row(result, self.orphan)
        self.assertEqual((orphan["vendors"], orphan["expenses"], orphan["last_paid"]), (0, 0, None))
        self.assertEqual(landlord["account_number"], "0036147100982211")
        self.assertEqual((landlord["bank_name"], landlord["bank_branch"]), ("Test Bank", "Test Branch"))

    def test_tabs_split_active_inactive_and_not_linked_and_count_each(self):
        active = self._list("active")
        self.assertEqual({r["name"] for r in active["data"]}, {self.shared, self.landlord, self.orphan})
        self.assertEqual(active["total_count"], 3)
        self.assertEqual(
            (active["aggregates"]["active_count"], active["aggregates"]["inactive_count"],
             active["aggregates"]["unlinked_count"]),
            (3, 1, 2),
        )
        self.assertEqual({r["name"] for r in self._list("inactive")["data"]}, {self.moved})
        self.assertEqual({r["name"] for r in self._list("unlinked")["data"]}, {self.orphan, self.moved})

    def test_search_by_account_number_ignores_leading_zeros_and_spaces(self):
        for typed in ("36147100982211", "0036 1471 0098 2211", "1471009822"):
            with self.subTest(typed=typed):
                rows = self._list(search=typed, field="account_number")["data"]
                self.assertIn(self.landlord, [r["name"] for r in rows])

    def test_search_by_linked_vendor(self):
        vendor_name = frappe.db.get_value("Vendors", self.vendor_b, "vendor_name")
        rows = self._list(search=vendor_name, field="vendor_name")["data"]
        self.assertEqual([r["name"] for r in rows], [self.shared])

    def test_a_payee_is_paid_once_money_left_approved_for_it(self):
        self.assertTrue(is_paid(self.shared))
        self.assertTrue(is_paid(self.landlord))
        self.assertFalse(is_paid(self.orphan))

    def test_export_returns_every_row_of_the_tab(self):
        result = self._list("active", for_export="true", limit_page_length=0)
        self.assertEqual(len(result["data"]), 3)

    def test_only_accounts_and_admin_may_list_payees(self):
        users = frappe.get_all("Nirmaan Users", filters={"role_profile": PROJECT_MANAGER}, pluck="name", limit=5)
        user = next((u for u in users if u != U and frappe.db.exists("User", u)), None)
        if not user:
            self.skipTest("no Project Manager on this site")
        frappe.set_user(user)
        with self.assertRaises(frappe.PermissionError):
            self._list()
