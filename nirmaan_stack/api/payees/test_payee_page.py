# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One Payee's page (#1423, spec #1420, ADR-0033): what it is linked to, the lock, the holder-name
edit and Inactive.

Drives `api/payees/payee_page` the way the Payee page does, and a plain document save the way Desk,
REST or any other code would, and reads back what the user sees: the page's figures, a refusal and
its message, or the saved record.

⚠️ RUNS AGAINST THE ENV DATABASE. Vendors and payments come from `TaxedWorkOrderFixture`, Payees from
`PayeeFixture`; the expenses planted here are deleted by the test's own cleanup.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.payees.payee_fixture import TEST_IFSC, PayeeFixture, shown_to_client
from nirmaan_stack.api.payees.payee_page import edit_holder_name, get_payee, set_payee_status
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services.payees.rules import ACTIVE, HOLDER_NAME_ROLE_PROBLEM, INACTIVE, PAYEE_DOCTYPE

U = "Administrator"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"
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

    def _expense(self, doctype, status, *, payee=None, payment_date=None, amount=500, project=None, type_=None):
        name = f"TEST-PYE-EXP-{frappe.generate_hash(length=10)}"
        project_column = ", projects" if doctype == "Project Expenses" else ""
        project_value = ", %s" if doctype == "Project Expenses" else ""
        params = [name, U, U, amount, status, payment_date, payee, type_]
        if doctype == "Project Expenses":
            params.append(project)
        frappe.db.sql(
            f"""INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner, docstatus, idx,
                    amount, status, payment_date, payee, type{project_column})
                VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s{project_value})""",
            tuple(params),
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
        """Change a Payee through a plain document save: the path Desk and REST take."""
        doc = frappe.get_doc(PAYEE_DOCTYPE, name)
        doc.update(changes)
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        return doc


class TestPayeeLock(PayeePageCase):
    def test_a_payee_locks_once_a_linked_vendors_payment_reaches_reconciliation_pending(self):
        payee = self.payees.payee()
        vendor = self._linked_vendor(payee)
        payment = self._payment(vendor, "Approved")

        self.assertFalse(get_payee(payee)["locked"])
        new_number = self.payees.account_number()
        self._save_payee(payee, account_number=new_number)
        self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, payee, "account_number"), new_number)

        frappe.db.set_value("Project Payments", payment, "status", "Reconciliation Pending", update_modified=False)
        frappe.db.commit()

        self.assertTrue(get_payee(payee)["locked"])
        for change in ({"account_number": self.payees.account_number()}, {"ifsc": "TEST0PYE002"}):
            with self.subTest(change=change), self.assertRaisesRegex(frappe.ValidationError, "locked"):
                self._save_payee(payee, **change)
        frappe.db.rollback()
        self.assertEqual(
            frappe.db.get_value(PAYEE_DOCTYPE, payee, ["account_number", "ifsc"]), (new_number, TEST_IFSC)
        )

    def test_a_paid_linked_expense_locks_the_payee_too(self):
        payee = self.payees.payee()
        self._expense("Non Project Expenses", "Paid", payee=payee, payment_date="2026-10-11")
        with self.assertRaisesRegex(frappe.ValidationError, "locked"):
            self._save_payee(payee, ifsc="TEST0PYE002")

    def test_a_locked_payee_still_takes_a_holder_name_fix_and_a_status_change(self):
        payee = self.payees.payee()
        self._expense("Project Expenses", "Paid", payee=payee, payment_date="2026-10-11")
        new_name = self.payees.holder("Kaveri Ductfab Systems Private Limited")
        edit_holder_name(payee, new_name)
        set_payee_status(payee, INACTIVE)
        self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, payee, ["account_name", "status"]), (new_name, INACTIVE))


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

    def test_any_other_role_is_refused_on_every_path(self):
        payee = self.payees.payee()
        before = frappe.db.get_value(PAYEE_DOCTYPE, payee, "account_name")
        frappe.set_user(self._user(PROJECT_MANAGER))

        with self.assertRaises(frappe.PermissionError):
            edit_holder_name(payee, self.payees.holder("Endpoint"))
        # Any other code that saves the Payee as this user, permissions or not.
        with self.assertRaises(frappe.PermissionError):
            self._save_payee(payee, account_name=self.payees.holder("Plain save"))

        frappe.db.rollback()
        frappe.set_user(U)
        self.assertEqual(frappe.db.get_value(PAYEE_DOCTYPE, payee, "account_name"), before)

    def test_the_holder_name_refusal_tells_the_client_why(self):
        payee = self.payees.payee()
        frappe.set_user(self._user(PROJECT_MANAGER))
        try:
            with shown_to_client() as shown, self.assertRaises(frappe.PermissionError):
                self._save_payee(payee, account_name=self.payees.holder("Desk save"))
        finally:
            frappe.db.rollback()
            frappe.set_user(U)
        self.assertIn(HOLDER_NAME_ROLE_PROBLEM, shown)

    def test_a_blank_holder_name_is_refused(self):
        payee = self.payees.payee()
        with self.assertRaisesRegex(frappe.ValidationError, "holder name"):
            edit_holder_name(payee, "   ")


class TestInactivePayee(PayeePageCase):
    def test_an_inactive_payee_cant_be_picked_and_existing_links_are_kept(self):
        payee = self.payees.payee()
        kept = self._linked_vendor(payee)
        kept_expense = self._expense("Non Project Expenses", "Approved", payee=payee)

        set_payee_status(payee, INACTIVE)
        self.assertEqual(get_payee(payee)["status"], INACTIVE)

        # A new link is refused: a vendor, an expense.
        newcomer = self.fx.vendor()
        frappe.db.commit()
        vendor = frappe.get_doc("Vendors", newcomer)
        vendor.vendor_category = {"categories": []}
        vendor.payee = payee
        with self.assertRaisesRegex(frappe.ValidationError, "Inactive"):
            vendor.save(ignore_permissions=True)
        frappe.db.rollback()
        expense = frappe.get_doc("Non Project Expenses", self._expense("Non Project Expenses", "Approved"))
        expense.payee = payee
        with self.assertRaisesRegex(frappe.ValidationError, "Inactive"):
            expense.save(ignore_permissions=True)
        frappe.db.rollback()

        # Records already pointing at it keep it, through later saves.
        for doctype, name in (("Vendors", kept), ("Non Project Expenses", kept_expense)):
            doc = frappe.get_doc(doctype, name)
            if doctype == "Vendors":
                doc.vendor_category = {"categories": []}
            doc.save(ignore_permissions=True)
            self.assertEqual(frappe.db.get_value(doctype, name, "payee"), payee)
        frappe.db.commit()

        # Marked Active again, it can be picked again.
        set_payee_status(payee, ACTIVE)
        vendor = frappe.get_doc("Vendors", newcomer)
        vendor.vendor_category = {"categories": []}
        vendor.payee = payee
        vendor.save(ignore_permissions=True)
        frappe.db.commit()
        self.assertEqual(frappe.db.get_value("Vendors", newcomer, "payee"), payee)

    def test_marking_a_payee_its_own_status_is_refused(self):
        payee = self.payees.payee()
        with self.assertRaisesRegex(frappe.ValidationError, "already Active"):
            set_payee_status(payee, ACTIVE)

    def test_only_accounts_and_admin_may_change_the_status(self):
        payee = self.payees.payee()
        frappe.set_user(self._user(PROJECT_MANAGER))
        with self.assertRaises(frappe.PermissionError):
            set_payee_status(payee, INACTIVE)
        with self.assertRaises(frappe.PermissionError):
            get_payee(payee)


class TestPayeeLinks(PayeePageCase):
    def test_the_page_lists_linked_vendors_and_expenses_with_counts_and_last_paid(self):
        payee = self.payees.payee()
        vendor = self._linked_vendor(
            payee, vendor_name="Kaveri Ductfab (Rohtak)", vendor_type="Material", vendor_city="Rohtak",
            vendor_status="Active",
        )
        self._payment(vendor, "Paid", "2026-10-08")
        project = self.fx.project()
        project_expense = self._expense(
            "Project Expenses", "Paid", payee=payee, payment_date="2026-09-22", amount=18400, project=project,
        )
        non_project = self._expense("Non Project Expenses", "Approved", payee=payee, amount=6250)
        self._expense("Non Project Expenses", "Paid", payment_date="2026-10-20")  # another Payee's: not counted

        page = get_payee(payee)

        self.assertEqual((page["vendors"], page["expenses"], page["last_paid"]), (1, 2, "2026-10-08"))
        self.assertEqual(page["status"], ACTIVE)
        self.assertTrue(page["locked"])
        self.assertEqual(page["bank_name"], "Test Bank")
        self.assertEqual(len(page["linked_vendors"]), 1)
        row = page["linked_vendors"][0]
        self.assertEqual(
            (row["name"], row["vendor_name"], row["vendor_type"], row["vendor_city"], row["vendor_status"]),
            (vendor, "Kaveri Ductfab (Rohtak)", "Material", "Rohtak", "Active"),
        )
        self.assertEqual(row["linked_since"], frappe.utils.today())

        expenses = {e["name"]: e for e in page["linked_expenses"]}
        self.assertEqual(set(expenses), {project_expense, non_project})
        pe = expenses[project_expense]
        self.assertEqual(
            (pe["kind"], pe["project"], pe["amount"], pe["status"], pe["paid_on"]),
            ("Project", project, 18400, "Paid", "2026-09-22"),
        )
        npe = expenses[non_project]
        self.assertEqual((npe["kind"], npe["project"], npe["status"], npe["paid_on"]), ("Non Project", None, "Approved", None))

    def test_an_unknown_payee_is_refused(self):
        with self.assertRaises(frappe.DoesNotExistError):
            get_payee("PYE-NOPE")
