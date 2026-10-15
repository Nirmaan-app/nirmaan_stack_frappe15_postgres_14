# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Paying an expense shows who to pay (spec #1420 ticket #1431, ADR-0033).

Drives `api/payees/expense_payee` and the approval queue the way "Payment need to paid", Export for
Payment and Record Payment do, and reads back what the accountant sees: each row's Paid to, the
"Pay ₹X to" box, and Change payee's refusals.

⚠️ RUNS AGAINST THE ENV DATABASE. Payees come from `PayeeFixture`; every vendor, payment, expense,
request and expense type planted here is deleted by the test's own cleanup.

Run:
  devenv.sh test --module nirmaan_stack.api.payees.test_paid_to
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import today

from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.payees.expense_payee import (
    change_expense_payee,
    get_expense_payee,
    get_paid_to,
)
from nirmaan_stack.api.payees.payee_fixture import PayeeFixture, delete_each

U = "Administrator"
PM_USER = "pye_paidto_pm@example.com"
PM_PROFILE = "Nirmaan Project Manager Profile"
PE = "Project Expenses"
NPE = "Non Project Expenses"


class TestPaidTo(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _make_user(PM_USER, PM_PROFILE, ("Nirmaan Project Manager",))
        cls.types = {}
        for rule in ("Required", "Optional", "Not asked"):
            name = f"pye_paidto_{rule.replace(' ', '_').lower()}_{frappe.generate_hash(length=5)}"
            doc = frappe.new_doc("Expense Type")
            doc.update({"expense_name": name, "non_project": 1, "expense_category": "Uncategorized",
                        "payee_rule": rule})
            doc.insert(ignore_permissions=True)
            cls.types[rule] = doc.name
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user(U)
        scopes = [("Expense Type", name) for name in cls.types.values()]
        scopes += [("Nirmaan Users", PM_USER), ("User", PM_USER)]
        try:
            delete_each(scopes)
        finally:
            super().tearDownClass()

    def setUp(self):
        frappe.set_user(U)
        self.payees = PayeeFixture.attach(self)
        self.planted: list[tuple[str, str]] = []
        self.addCleanup(self._purge)

    def tearDown(self):
        frappe.set_user(U)

    # -- helpers --------------------------------------------------------------------------------
    def _purge(self):
        delete_each(reversed(self.planted), raw={doctype for doctype, _ in self.planted})

    def _insert(self, doctype, values, owner=U):
        name = f"TEST-PAIDTO-{frappe.generate_hash(length=10)}"
        columns = ", ".join(f'"{c}"' for c in values)
        marks = ", ".join(["%s"] * len(values))
        frappe.db.sql(
            f"""INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner, docstatus, idx,
                    {columns})
                VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, {marks})""",
            (name, owner, owner, *values.values()),
        )
        self.planted.append((doctype, name))
        frappe.db.commit()
        return name

    def _vendor(self, payee=None):
        return self._insert("Vendors", {"vendor_name": f"TESTPYE Vendor {frappe.generate_hash(length=5)}",
                                        "payee": payee})

    def _payment(self, vendor):
        return self._insert("Project Payments", {"vendor": vendor, "amount": 78000, "status": "Approved",
                                                 "document_type": "Procurement Orders",
                                                 "document_name": "PO/TEST/PAIDTO"})

    def _expense(self, doctype=NPE, *, rule="Optional", payee=None, vendor=None, request_id=None,
                 status="Approved"):
        values = {"type": self.types[rule], "amount": 25000, "status": status, "payee": payee,
                  "request_id": request_id, "description": "Advance for shuttering labour"}
        if vendor:
            values["vendor"] = vendor
        return self._insert(doctype, values)

    def _request(self, payee, owner=PM_USER):
        return self._insert("Expense Request", {"type": self.types["Required"], "amount": 25000,
                                                "payee": payee, "status": "Approved"}, owner=owner)

    def _as(self, user, fn, **kw):
        frappe.set_user(user)
        try:
            return fn(**kw)
        finally:
            frappe.set_user(U)

    # -- Paid to on "Payment need to paid" and in the bank file -----------------------------------
    def test_each_row_is_paid_to_its_vendors_payee_or_its_own(self):
        vendor_payee = self.payees.payee(self.payees.holder("Kaveri Ductfab"))
        expense_payee = self.payees.payee(self.payees.holder("Ramesh Kumar Yadav"))
        payment = self._payment(self._vendor(vendor_payee))
        expense = self._expense(payee=expense_payee)

        paid_to = get_paid_to([{"doctype": "Project Payments", "name": payment},
                               {"doctype": NPE, "name": expense}])

        self.assertEqual([row["account"]["payee"] for row in paid_to], [vendor_payee, expense_payee])
        self.assertEqual([row["missing"] for row in paid_to], [None, None])
        holder, number, ifsc = frappe.db.get_value("Payee", expense_payee,
                                                   ["account_name", "account_number", "ifsc"])
        self.assertEqual(
            {k: paid_to[1]["account"][k] for k in ("account_name", "account_number", "ifsc")},
            {"account_name": holder, "account_number": number, "ifsc": ifsc},
        )

    def test_a_row_with_no_payee_says_why(self):
        payment = self._payment(self._vendor(payee=None))
        optional = self._expense(rule="Optional")
        required = self._expense(rule="Required")

        paid_to = get_paid_to([{"doctype": "Project Payments", "name": payment},
                               {"doctype": NPE, "name": optional},
                               {"doctype": NPE, "name": required}])

        self.assertEqual(
            [(row["account"], row["missing"], row.get("payee_rule")) for row in paid_to],
            [(None, "vendor_has_no_payee", None),
             (None, "expense_has_no_payee", "Optional"),
             (None, "expense_has_no_payee", "Required")],
        )

    def test_a_payment_whose_vendors_payee_is_inactive_is_shown_but_not_paid(self):
        """Owner decision (walk bug 7c/d): Paid to still names the account, with its status, and the
        bank file leaves the row out for this reason."""
        payee = self.payees.payee()
        payment = self._payment(self._vendor(payee))
        frappe.db.set_value("Payee", payee, "status", "Inactive")
        frappe.db.commit()

        (row,) = get_paid_to([{"doctype": "Project Payments", "name": payment}])

        self.assertEqual((row["account"]["payee"], row["account"]["status"], row["missing"]),
                         (payee, "Inactive", "vendor_payee_inactive"))

    def test_the_queue_rows_carry_paid_to(self):
        payee = self.payees.payee()
        expense = self._expense(PE, payee=payee)
        no_payee = self._expense(PE, rule="Not asked")

        result = get_approval_queue(filters=[["name", "in", [expense, no_payee]]], limit_page_length=10)

        by_name = {row["name"]: row["paid_to"] for row in result["data"]}
        self.assertEqual(by_name[expense]["account"]["payee"], payee)
        self.assertEqual((by_name[no_payee]["missing"], by_name[no_payee]["payee_rule"]),
                         ("expense_has_no_payee", "Not asked"))

    # -- the "Pay ₹X to" box -----------------------------------------------------------------------
    def test_the_pay_to_box_names_the_raiser_who_named_the_payee_on_the_request(self):
        payee = self.payees.payee()
        expense = self._expense(payee=payee, request_id=self._request(payee))

        box = get_expense_payee(NPE, expense)

        self.assertEqual(box["payee"]["name"], payee)
        self.assertEqual(box["payee"]["bank_name"], "Test Bank")
        self.assertEqual((box["named_by"]["how"], box["named_by"]["user"]), ("request", PM_USER))
        self.assertEqual(box["named_by"]["on"], today())

    def test_change_payee_points_the_expense_at_another_payee_and_names_who_changed_it(self):
        first, second = self.payees.payee(), self.payees.payee()
        expense = self._expense(rule="Required", payee=first, request_id=self._request(first))

        box = change_expense_payee(NPE, expense, second)

        self.assertEqual(frappe.db.get_value(NPE, expense, "payee"), second)
        self.assertEqual(box["payee"]["name"], second)
        self.assertEqual((box["named_by"]["how"], box["named_by"]["user"], box["named_by"]["on"]),
                         ("changed", U, today()))
        self.assertEqual(get_expense_payee(NPE, expense)["named_by"]["how"], "changed")

    def test_change_payee_keeps_ticket_9s_rules(self):
        first, other = self.payees.payee(), self.payees.payee()
        required = self._expense(rule="Required", payee=first)
        with self.assertRaisesRegex(frappe.ValidationError, "needs a payee"):
            change_expense_payee(NPE, required, None)

        vendor = self._vendor(first)
        with_vendor = self._expense(PE, payee=first, vendor=vendor)
        with self.assertRaisesRegex(frappe.ValidationError, "is paid into payee"):
            change_expense_payee(PE, with_vendor, other)
        self.assertTrue(get_expense_payee(PE, with_vendor)["vendor_fixed"])

        paid = self._expense(payee=first, status="Paid")
        with self.assertRaisesRegex(frappe.ValidationError, "already paid"):
            change_expense_payee(NPE, paid, other)

        frappe.db.rollback()
        self.assertEqual(frappe.db.get_value(NPE, required, "payee"), first)
        self.assertEqual(frappe.db.get_value(NPE, paid, "payee"), first)

    def test_the_box_says_paid_once_money_has_left_approved(self):
        """Paid means one thing: the box closes Change payee at the statuses the server refuses it."""
        payee = self.payees.payee()
        for status, paid in (("Approved", False), ("Reconciliation Pending", True), ("Paid", True)):
            with self.subTest(status=status):
                self.assertEqual(get_expense_payee(NPE, self._expense(payee=payee, status=status))["paid"], paid)

    def test_an_optional_expense_can_be_left_without_a_payee(self):
        payee = self.payees.payee()
        expense = self._expense(rule="Optional", payee=payee)

        box = change_expense_payee(NPE, expense, None)

        self.assertIsNone(box["payee"])
        self.assertIsNone(frappe.db.get_value(NPE, expense, "payee"))

    def test_only_accounts_change_an_expenses_payee(self):
        first, second = self.payees.payee(), self.payees.payee()
        expense = self._expense(payee=first)
        with self.assertRaises(frappe.PermissionError):
            self._as(PM_USER, change_expense_payee, doctype=NPE, name=expense, payee=second)
        self.assertEqual(frappe.db.get_value(NPE, expense, "payee"), first)

    def test_the_endpoints_refuse_a_doctype_that_is_not_an_expense(self):
        payment = self._payment(self._vendor(self.payees.payee()))
        with self.assertRaises(frappe.ValidationError):
            get_expense_payee("Project Payments", payment)
        with self.assertRaises(frappe.ValidationError):
            get_paid_to([{"doctype": "Vendors", "name": "x"}])
