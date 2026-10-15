# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One Payee's page (#1423, #1434, spec #1420, ADR-0033): its overview and linked vendors, the
holder-name edit, and that a Payee is an address book entry: no lock once paid, no holder-name role.

Drives `api/payees/payee_page` the way the Payee page does, and a plain document save the way Desk,
REST or any other code would, and reads back what the user sees: the page's figures, a refusal, or
the saved record.

⚠️ RUNS AGAINST THE ENV DATABASE. Vendors and payments come from `TaxedWorkOrderFixture`, Payees from
`PayeeFixture`; the expenses planted here are deleted by the test's own cleanup.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.payee_fixture import PayeeFixture
from nirmaan_stack.api.payees.payee_page import edit_holder_name, get_payee
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services.payees.rules import PAYEE_DOCTYPE

U = "Administrator"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"
PROCUREMENT = "Nirmaan Procurement Executive Profile"
ACCOUNTANT = "Nirmaan Accountant Profile"


class PayeePageCase(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.payees = PayeeFixture.attach(self)
        self.expenses: list[tuple[str, str]] = []
        self.addCleanup(self._purge_expenses)

    def tearDown(self):
        frappe.set_user(U)

    # -- helpers --------------------------------------------------------------------------------
    def _user(self, profile):
        for user in frappe.get_all("Nirmaan Users", filters={"role_profile": profile}, pluck="name", limit=20):
            if user and user != U and frappe.db.exists("User", user):
                return user
        self.skipTest(f"no user with {profile} on this site")

    def _linked_vendor(self, payee, **fields):
        vendor = self.fx.vendor()
        frappe.db.set_value("Vendors", vendor, {"payee": payee, **fields}, update_modified=False)
        frappe.db.commit()
        return vendor

    def _payment(self, vendor, status, payment_date=None):
        name = self.fx._name("PAY")
        frappe.db.sql(
            """INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner, docstatus, idx,
                   vendor, amount, status, payment_date, document_type, document_name)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 1000, %s, %s, 'Procurement Orders', %s)""",
            (name, U, U, vendor, status, payment_date, name),
        )
        self.fx.payments.append(name)
        frappe.db.commit()
        return name

    def _expense(self, doctype, status, *, payee=None, payment_date=None):
        name = f"TEST-PYE-EXP-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            f"""INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner, docstatus, idx,
                    amount, status, payment_date, payee)
                VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, 500, %s, %s, %s)""",
            (name, U, U, status, payment_date, payee),
        )
        self.expenses.append((doctype, name))
        frappe.db.commit()
        return name

    def _purge_expenses(self):
        frappe.db.rollback()
        for doctype, name in self.expenses:
            frappe.db.delete(doctype, {"name": name})
        frappe.db.commit()

    def _save_payee(self, name, **changes):
        """Change a Payee through a plain document save: the path every screen's endpoint, Desk and
        REST take."""
        doc = frappe.get_doc(PAYEE_DOCTYPE, name)
        doc.update(changes)
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        return doc


class TestAPaidPayeeIsEditedInPlace(PayeePageCase):
    def test_a_paid_payees_account_number_and_ifsc_change(self):
        payee = self.payees.payee()
        vendor = self._linked_vendor(payee)
        self._payment(vendor, "Paid", "2026-10-08")
        self._expense("Non Project Expenses", "Paid", payee=payee, payment_date="2026-10-11")

        new_number = self.payees.account_number()
        self._save_payee(payee, account_number=new_number, ifsc="TEST0PYE002")

        self.assertEqual(
            frappe.db.get_value(PAYEE_DOCTYPE, payee, ["account_number", "ifsc"]), (new_number, "TEST0PYE002")
        )

    def test_the_page_shows_no_lock(self):
        payee = self.payees.payee()
        self._payment(self._linked_vendor(payee), "Paid", "2026-10-08")
        self.assertNotIn("locked", get_payee(payee))


class TestHolderNameEdit(PayeePageCase):
    def test_accounts_change_the_holder_name_and_the_page_says_when(self):
        payee = self.payees.payee()
        self.assertIsNone(get_payee(payee)["holder_name_changed_on"])

        new_name = self.payees.holder("Respelt")
        result = edit_holder_name(payee, f"  {new_name}  ")

        self.assertEqual(result["payee"]["account_name"], new_name)
        self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, payee, "account_name"), new_name)
        self.assertEqual(get_payee(payee)["holder_name_changed_on"], frappe.utils.today())

    def test_an_accountant_may_edit_the_holder_name(self):
        payee = self.payees.payee()
        frappe.set_user(self._user(ACCOUNTANT))
        new_name = self.payees.holder("By accountant")
        edit_holder_name(payee, new_name)
        frappe.set_user(U)
        self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, payee, "account_name"), new_name)

    def test_any_role_allowed_to_save_a_payee_may_change_its_holder_name(self):
        for profile in (PROCUREMENT, PROJECT_MANAGER):
            with self.subTest(profile=profile):
                payee = self.payees.payee()
                new_name = self.payees.holder(f"Saved by {profile}")
                frappe.set_user(self._user(profile))
                try:
                    self._save_payee(payee, account_name=new_name)
                finally:
                    frappe.set_user(U)
                self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, payee, "account_name"), new_name)

    def test_the_payees_page_endpoints_stay_accounts_only(self):
        payee = self.payees.payee()
        frappe.set_user(self._user(PROJECT_MANAGER))
        with self.assertRaises(frappe.PermissionError):
            edit_holder_name(payee, self.payees.holder("Endpoint"))
        with self.assertRaises(frappe.PermissionError):
            get_payee(payee)

    def test_a_blank_holder_name_is_refused(self):
        payee = self.payees.payee()
        with self.assertRaisesRegex(frappe.ValidationError, "holder name"):
            edit_holder_name(payee, "   ")


class TestPayeeLinks(PayeePageCase):
    def test_the_page_lists_linked_vendors_with_their_count(self):
        payee = self.payees.payee()
        vendor = self._linked_vendor(
            payee, vendor_name="Kaveri Ductfab (Rohtak)", vendor_type="Material", vendor_city="Rohtak",
            vendor_status="Active",
        )
        self._payment(vendor, "Paid", "2026-10-08")

        page = get_payee(payee)

        self.assertEqual(page["vendors"], 1)
        self.assertEqual(page["bank_name"], "Test Bank")
        self.assertEqual(len(page["linked_vendors"]), 1)
        row = page["linked_vendors"][0]
        self.assertEqual(
            (row["name"], row["vendor_name"], row["vendor_type"], row["vendor_city"], row["vendor_status"]),
            (vendor, "Kaveri Ductfab (Rohtak)", "Material", "Rohtak", "Active"),
        )
        self.assertEqual(row["linked_since"], frappe.utils.today())

    def test_the_page_carries_no_status_expenses_or_last_paid(self):
        payee = self.payees.payee()
        self._expense("Project Expenses", "Paid", payee=payee, payment_date="2026-09-22")
        page = get_payee(payee)
        for gone in ("status", "expenses", "last_paid", "linked_expenses"):
            with self.subTest(field=gone):
                self.assertNotIn(gone, page)

    def test_an_unknown_payee_is_refused(self):
        with self.assertRaises(frappe.DoesNotExistError):
            get_payee("PYE-NOPE")
