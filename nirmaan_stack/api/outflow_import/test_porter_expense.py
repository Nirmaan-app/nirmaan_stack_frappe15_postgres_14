# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Porter Expense in the expense screens (#1450, spec #1442, ADR-0032).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_porter_expense

Each test builds real Porter Expenses the way the import does (`test_porter_create`: upload, validation
with Gemini and the download faked, Create), then reads them through the endpoints the expense dialogs
call: the read-only Porter section and its invoice PDF. It also pins that deleting one is refused.

⚠️ Every test removes what it made (`test_porter_create._purge_created` and the batch purge), and the
test users at class end.
"""

import frappe

from nirmaan_stack.api.approvals.expense_bank_lines import get_expense_bank_lines
from nirmaan_stack.api.approvals.expense_detail import get_expense_approval_detail
from nirmaan_stack.api.outflow_import import porter_expense
from nirmaan_stack.api.outflow_import.test_porter_create import (
    NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE,
    PorterCreateCase,
)
from nirmaan_stack.api.outflow_import.test_porter_import import INVOICE_DOCTYPE

ORDER_DOCTYPE = "Porter Order"


class PorterExpenseCase(PorterCreateCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Reads Project Expenses but not Porter Invoice (Admin and the Accountants only).
        cls.manager = cls._user("Nirmaan Project Manager")
        # Reads no expense at all.
        cls.outsider = cls._user(None)

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        for user in (cls.manager, cls.outsider):
            for doctype in ("Nirmaan Users", "User"):
                try:
                    if frappe.db.exists(doctype, user):
                        frappe.delete_doc(doctype, user, force=True, ignore_permissions=True)
                    frappe.db.commit()
                except Exception:
                    frappe.db.rollback()
                    print(f"porter expense test purge: could not delete {doctype} {user}")
        super().tearDownClass()

    @classmethod
    def _user(cls, role: str | None) -> str:
        email = f"porter_exp_{frappe.generate_hash(length=8)}@example.com"
        user = frappe.new_doc("User")
        user.email = email
        user.first_name = "Porter Expense"
        user.send_welcome_email = 0
        user.enabled = 1
        user.insert(ignore_permissions=True)
        if role:
            user.add_roles(role)
        frappe.db.commit()
        return email

    def setUp(self):
        super().setUp()
        self.addCleanup(frappe.set_user, "Administrator")
        self._validate()
        self._press_create()
        self._run_create()


    def _hand_keyed(self):
        expense = frappe.get_doc({
            "doctype": NON_PROJECT_EXPENSE, "type": self._expense_of("003").type, "amount": 10,
            "description": "keyed in by hand",
        }).insert(ignore_permissions=True)
        frappe.db.commit()

        def _remove():
            frappe.db.rollback()
            frappe.db.delete(NON_PROJECT_EXPENSE, {"name": expense.name})
            frappe.db.commit()

        self.addCleanup(_remove)
        return expense


class TestThePorterSection(PorterExpenseCase):
    def test_a_project_expense_shows_its_order_and_its_invoice(self):
        expense = self._expense_of("004")  # Kavya Menon, "zephyr tower project", Bangalore
        order = frappe.get_doc(ORDER_DOCTYPE, self._crn("004"))
        invoice = frappe.get_doc(INVOICE_DOCTYPE, self.numbers["29SS27A0900001"])

        section = porter_expense.get_porter_expense(PROJECT_EXPENSE, expense.name)

        self.assertEqual(section["crn"], self._crn("004"))
        self.assertEqual(section["booked_by"], "Kavya Menon")
        self.assertEqual(section["from_address"], order.from_address)
        self.assertEqual(section["to_address"], order.to_address)
        self.assertTrue(section["from_address"] and section["to_address"])
        self.assertEqual(section["city"], "Bangalore")
        self.assertEqual(section["fare"], 1616.0)
        self.assertAlmostEqual(section["rcm_gst"], 80.8, places=2)
        self.assertEqual(section["invoice_number"], invoice.invoice_number)
        self.assertEqual(section["billing_entity"], invoice.billing_entity)
        self.assertTrue(section["billing_entity"])
        self.assertEqual(section["project"], self.zephyr)
        self.assertEqual(section["project_name"], "Zephyr Tower")
        self.assertIn("porter_invoice_pdf", section["pdf_url"])
        self.assertIn(expense.name, section["pdf_url"])

    def test_a_non_project_expense_shows_it_too_with_no_project(self):
        expense = self._expense_of("003")  # Ravi Testkumar, no remark

        section = porter_expense.get_porter_expense(NON_PROJECT_EXPENSE, expense.name)

        self.assertEqual(section["crn"], self._crn("003"))
        self.assertEqual(section["booked_by"], "Ravi Testkumar")
        self.assertEqual(section["fare"], 382.0)
        self.assertIsNone(section["project"])
        self.assertIsNone(section["project_name"])

    def test_an_expense_keyed_in_by_hand_has_no_porter_section(self):
        expense = self._hand_keyed()

        self.assertIsNone(porter_expense.get_porter_expense(NON_PROJECT_EXPENSE, expense.name))

    def test_a_user_who_cannot_read_the_expense_is_refused(self):
        expense = self._expense_of("004")
        frappe.set_user(self.outsider)

        with self.assertRaises(frappe.PermissionError):
            porter_expense.get_porter_expense(PROJECT_EXPENSE, expense.name)
        with self.assertRaises(frappe.PermissionError):
            porter_expense.porter_invoice_pdf(PROJECT_EXPENSE, expense.name)

    def test_the_detail_cards_know_it_is_a_porter_expense(self):
        """The approval detail and the bank-lines card render the section only when they are told the
        expense has a Porter Order; a hand-keyed expense tells them it has none."""
        expense = self._expense_of("004")
        hand_keyed = self._hand_keyed()

        self.assertEqual(
            get_expense_approval_detail(PROJECT_EXPENSE, expense.name)["porter_order"], self._crn("004")
        )
        self.assertEqual(
            get_expense_bank_lines(PROJECT_EXPENSE, expense.name)["details"]["porter_order"], self._crn("004")
        )
        self.assertEqual(get_expense_approval_detail(NON_PROJECT_EXPENSE, hand_keyed.name)["porter_order"], "")
        self.assertEqual(
            get_expense_bank_lines(NON_PROJECT_EXPENSE, hand_keyed.name)["details"]["porter_order"], ""
        )

    def test_a_payment_or_other_doctype_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            porter_expense.get_porter_expense("Project Payments", "anything")


class TestTheInvoicePdfOpens(PorterExpenseCase):
    def test_for_a_role_that_reads_the_expense_but_not_porter_invoices(self):
        expense = self._expense_of("004")
        invoice = self.numbers["29SS27A0900001"]
        frappe.set_user(self.manager)
        self.assertFalse(frappe.has_permission(INVOICE_DOCTYPE, "read", invoice))
        self.assertTrue(frappe.has_permission(PROJECT_EXPENSE, "read", expense.name))

        frappe.local.response = frappe._dict()
        porter_expense.porter_invoice_pdf(PROJECT_EXPENSE, expense.name)

        self.assertEqual(frappe.local.response.type, "pdf")
        self.assertTrue(frappe.local.response.filecontent.startswith(b"%PDF-"))
        self.assertTrue(frappe.local.response.filename.endswith(".pdf"))

    def test_an_expense_with_no_porter_order_has_no_porter_pdf(self):
        expense = self._hand_keyed()

        with self.assertRaises(frappe.DoesNotExistError):
            porter_expense.porter_invoice_pdf(NON_PROJECT_EXPENSE, expense.name)


class TestDeletingAPorterExpense(PorterExpenseCase):
    def test_is_refused_on_both_ledgers_while_its_import_match_is_live(self):
        """Rule 3 of `expense_bank_links` (ADR-0027): Create inserts a Settled match per expense, so
        deleting one is refused. ⚠️ `force=True` turns Frappe's own link check off, so what refuses is
        rule 3 and nothing else (as `test_expense_document_rules.TestRuleThreeDelete`)."""
        for suffix, doctype in (("004", PROJECT_EXPENSE), ("003", NON_PROJECT_EXPENSE)):
            with self.subTest(doctype=doctype):
                expense = self._expense_of(suffix)
                self.assertEqual(expense.doctype, doctype)

                with self.assertRaises(frappe.ValidationError) as caught:
                    frappe.delete_doc(doctype, expense.name, force=True, ignore_permissions=True)

                self.assertIn("Unreconcile", str(caught.exception))
                frappe.db.rollback()
                self.assertTrue(frappe.db.exists(doctype, expense.name))
