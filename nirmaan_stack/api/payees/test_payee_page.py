# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One Payee's page (#1423, #1434, #1435, spec #1420, ADR-0033): its overview and linked vendors, Edit
(holder name, account number, IFSC, in place) and Delete, and that a Payee is an address book entry: no
lock once paid, no holder-name role.

Drives `api/payees/payee_page` the way the Payee page does, and a plain document save the way Desk,
REST or any other code would, and reads back what the user sees: the page's figures, a refusal, or
the saved record.

⚠️ RUNS AGAINST THE ENV DATABASE. Vendors and payments come from `TaxedWorkOrderFixture`, Payees from
`PayeeFixture`; the expenses planted here are deleted by the test's own cleanup.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.add_payee import check_payee
from nirmaan_stack.api.payees.payee_fixture import TEST_IFSC, PayeeFixture
from nirmaan_stack.api.payees.payee_page import delete_payee, edit_payee, get_payee
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


class TestEditPayee(PayeePageCase):
    """Edit on the Payees page (#1435): holder name, account number and IFSC, edited in place."""

    def _full_name(self, user):
        return frappe.db.get_value("User", user, "full_name") or user

    def test_editing_the_account_saves_it_and_the_page_says_who_and_when(self):
        payee = self.payees.payee()
        self.assertIsNone(get_payee(payee)["account_changed"])
        holder = frappe.db.get_value(PAYEE_DOCTYPE, payee, "account_name")
        new_number = self.payees.account_number()

        result = edit_payee(payee, holder, new_number, "test0pye002")

        self.assertEqual(result["payee"]["account_number"], new_number)
        saved = frappe.db.get_value(PAYEE_DOCTYPE, payee, ["account_number", "ifsc", "bank_name"])
        self.assertEqual(saved, (new_number, "TEST0PYE002", "Test Bank"))
        page = get_payee(payee)
        self.assertEqual(page["account_changed"], {"on": frappe.utils.today(), "by": self._full_name(U)})
        self.assertIsNone(page["holder_name_changed"], "only the account changed")

    def test_an_accountants_holder_name_edit_is_recorded_with_their_name(self):
        payee = self.payees.payee()
        number, ifsc = frappe.db.get_value(PAYEE_DOCTYPE, payee, ["account_number", "ifsc"])
        accountant = self._user(ACCOUNTANT)
        new_name = self.payees.holder("By accountant")

        frappe.set_user(accountant)
        try:
            edit_payee(payee, f"  {new_name}  ", number, ifsc)
        finally:
            frappe.set_user(U)

        self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, payee, "account_name"), new_name)
        page = get_payee(payee)
        self.assertEqual(page["holder_name_changed"], {"on": frappe.utils.today(), "by": self._full_name(accountant)})
        self.assertIsNone(page["account_changed"])

    def test_an_account_another_payee_has_is_refused_naming_it(self):
        number = self.payees.account_number()
        other = self.payees.payee(account_number=number)
        payee = self.payees.payee()
        before = frappe.db.get_value(PAYEE_DOCTYPE, payee, ["account_name", "account_number", "ifsc"])

        result = edit_payee(payee, before[0], "00" + number, TEST_IFSC)

        self.assertEqual(result["duplicate"]["name"], other)
        self.assertIn(other, result["message"])
        self.assertNotIn("payee", result)
        self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, payee, ["account_name", "account_number", "ifsc"]), before)

    def test_the_duplicate_check_before_saving_does_not_flag_the_payee_being_edited(self):
        payee = self.payees.payee()
        number = frappe.db.get_value(PAYEE_DOCTYPE, payee, "account_number")
        self.assertEqual(check_payee(number, TEST_IFSC)["duplicate"]["name"], payee)
        self.assertIsNone(check_payee(number, TEST_IFSC, exclude=payee)["duplicate"])

    def test_an_ifsc_the_lookup_cannot_find_is_refused(self):
        payee = self.payees.payee()
        holder, number = frappe.db.get_value(PAYEE_DOCTYPE, payee, ["account_name", "account_number"])
        self.payees.fail_ifsc_lookup()
        with self.assertRaises(frappe.ValidationError):
            edit_payee(payee, holder, number, "TEST0PYE009")
        frappe.db.rollback()
        self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, payee, "ifsc"), TEST_IFSC)

    def test_a_blank_holder_name_is_refused(self):
        payee = self.payees.payee()
        number = frappe.db.get_value(PAYEE_DOCTYPE, payee, "account_number")
        with self.assertRaisesRegex(frappe.ValidationError, "holder name"):
            edit_payee(payee, "   ", number, TEST_IFSC)

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
        number = frappe.db.get_value(PAYEE_DOCTYPE, payee, "account_number")
        frappe.set_user(self._user(PROJECT_MANAGER))
        with self.assertRaises(frappe.PermissionError):
            edit_payee(payee, self.payees.holder("Endpoint"), number, TEST_IFSC)
        with self.assertRaises(frappe.PermissionError):
            delete_payee(payee)
        with self.assertRaises(frappe.PermissionError):
            get_payee(payee)


class TestDeletePayee(PayeePageCase):
    """Delete on the Payee page (#1435): only a Payee no vendor links to."""

    def test_a_payee_no_vendor_links_to_is_deleted(self):
        payee = self.payees.payee()
        delete_payee(payee)
        self.assertFalse(frappe.db.exists(PAYEE_DOCTYPE, payee))

    def test_a_payee_a_vendor_links_to_is_refused_naming_every_vendor(self):
        payee = self.payees.payee()
        first = self._linked_vendor(payee, vendor_name="Kaveri Ductfab (Rohtak)")
        second = self._linked_vendor(payee, vendor_name="Kaveri Ductfab (Pune)")

        with self.assertRaises(frappe.LinkExistsError) as refused:
            delete_payee(payee)

        message = str(refused.exception)
        for vendor in ("Kaveri Ductfab (Rohtak)", "Kaveri Ductfab (Pune)", first, second):
            self.assertIn(vendor, message)
        frappe.db.rollback()
        self.assertTrue(frappe.db.exists(PAYEE_DOCTYPE, payee))


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
