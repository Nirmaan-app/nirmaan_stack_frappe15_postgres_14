# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""A Direct Expense names who gets paid (spec #1470 ticket #1471, ADR-0033 decision 5).

`create_direct_expense` records a Project Expense or Non-Project Expense from the Add Expense dialogs
and copies the Payee picked into its pay-to account, in one save. The status stays the doctype's
(auto-approval, the Raiser's own step), and nothing about who gets paid is refused.

Run:
  devenv.sh test --module nirmaan_stack.api.expenses.test_direct_expense
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.expenses.direct_expense import create_direct_expense
from nirmaan_stack.api.payees.payee_fixture import PayeeFixture, delete_each
from nirmaan_stack.services.payees.pay_to import PAY_TO_FIELDS
from nirmaan_stack.services.payees.rules import ACCOUNT_FIELDS

U = "Administrator"
PE = "Project Expenses"
NPE = "Non Project Expenses"
ACCOUNTANT = "dxe_test_accountant@example.com"
# Holds no create right on either expense doctype, and no role profile (so it raises no request).
NO_CREATE = "dxe_test_hrlead@example.com"
USERS = (ACCOUNTANT, NO_CREATE)


class TestCreateDirectExpense(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _make_user(ACCOUNTANT, "Nirmaan Accountant Profile", ("Nirmaan Accountant",))
        _make_user(NO_CREATE, None, ("Nirmaan HR Lead",))
        cls.types = {}
        for rule, project in (("Required", 0), ("Optional", 1)):
            name = f"dxe_test_{rule.lower()}_{frappe.generate_hash(length=5)}"
            doc = frappe.new_doc("Expense Type")
            doc.update({"expense_name": name, "project": project, "non_project": 1 - project,
                        "expense_category": "Uncategorized", "payee_rule": rule})
            doc.insert(ignore_permissions=True)
            cls.types[rule] = doc.name
        # Raw, like the Payee guard suite: `Projects.after_insert` builds work milestones.
        cls.project = f"TEST-DXE-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            """INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner, docstatus, idx,
                                          project_name)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s)""",
            (cls.project, U, U, cls.project),
        )
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user(U)
        scopes = [("Expense Type", name) for name in cls.types.values()]
        scopes += [("Projects", cls.project)]
        scopes += [(dt, email) for email in USERS for dt in ("Nirmaan Users", "User")]
        try:
            delete_each(scopes, raw={"Projects"})
        finally:
            super().tearDownClass()

    def setUp(self):
        frappe.set_user(U)
        self.payees = PayeeFixture.attach(self)
        self.tag = f"dxe test {frappe.generate_hash(length=8)}"
        self.addCleanup(self._purge)

    def tearDown(self):
        frappe.set_user(U)

    # -- helpers --------------------------------------------------------------------------------
    def _purge(self):
        """Every expense this test made: they all carry its tag in their description."""
        scopes = [(doctype, name) for doctype in (PE, NPE)
                  for name in frappe.get_all(doctype, {"description": ["like", f"{self.tag}%"]}, pluck="name")]
        delete_each(scopes, raw={PE, NPE})

    def _create(self, doctype=NPE, user=ACCOUNTANT, payee=None, **values) -> dict:
        """Record a Direct Expense through the endpoint as `user`, the way the dialogs send it."""
        expense = {"type": self.types["Optional" if doctype == PE else "Required"], "amount": 2500,
                   "description": self.tag, **({"projects": self.project} if doctype == PE else {}), **values}
        frappe.set_user(user)
        try:
            return create_direct_expense(doctype=doctype, expense=expense, payee=payee)
        finally:
            frappe.set_user(U)

    def _pay_to(self, doctype, name):
        return tuple(frappe.db.get_value(doctype, name, list(PAY_TO_FIELDS)))

    def _account_of(self, payee):
        return tuple(frappe.db.get_value("Payee", payee, list(ACCOUNT_FIELDS)))

    # -- who gets paid --------------------------------------------------------------------------
    def test_a_non_project_expense_with_a_payee_holds_its_account(self):
        payee = self.payees.payee()
        created = self._create(NPE, payee=payee)
        self.assertEqual(self._pay_to(NPE, created["name"]), self._account_of(payee))
        self.assertEqual(frappe.db.get_value(NPE, created["name"], "owner"), ACCOUNTANT)

    def test_a_project_expense_naming_a_vendor_gets_the_vendors_account_and_ignores_the_payee_sent(self):
        vendor_payee, other = self.payees.payee(), self.payees.payee()
        vendor = self.payees.vendor(vendor_payee)
        created = self._create(PE, payee=other, vendor=vendor)
        self.assertEqual(self._pay_to(PE, created["name"]), self._account_of(vendor_payee))

    def test_a_project_expense_with_others_no_vendor_holds_the_payee_picked(self):
        """The Project Expense dialog sends "Others (No Vendor)" as an empty vendor (#1474)."""
        payee = self.payees.payee()
        created = self._create(PE, payee=payee, vendor="")
        self.assertEqual(self._pay_to(PE, created["name"]), self._account_of(payee))

    def test_an_expense_with_no_payee_is_saved_with_no_account(self):
        """Nothing about who gets paid is refused on the server, not even a Required type with none."""
        for doctype in (PE, NPE):
            with self.subTest(doctype=doctype):
                created = self._create(doctype)
                self.assertEqual(self._pay_to(doctype, created["name"]), (None,) * len(PAY_TO_FIELDS))

    # -- status stays the doctype's ---------------------------------------------------------------
    def test_naming_a_payee_changes_no_status(self):
        """Below 15,000 lands Approved; above lands Requested; an Admin raiser's own step is cleared."""
        payee = self.payees.payee()
        for user, amount, status in ((ACCOUNTANT, 5000, "Approved"), (ACCOUNTANT, 20000, "Requested"),
                                     (U, 20000, "Approved")):
            for doctype in (PE, NPE):
                with self.subTest(user=user, amount=amount, doctype=doctype):
                    created = self._create(doctype, user=user, payee=payee, amount=amount)
                    self.assertEqual(created["status"], status)
                    self.assertEqual(frappe.db.get_value(doctype, created["name"], "status"), status)
                    self.assertEqual(self._pay_to(doctype, created["name"]), self._account_of(payee))

    def test_a_status_sent_by_the_caller_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            self._create(NPE, amount=20000, status="Approved")
        self.assertFalse(frappe.db.exists(NPE, {"description": self.tag}))

    # -- refusals ---------------------------------------------------------------------------------
    def test_an_unknown_payee_leaves_no_expense_behind(self):
        for doctype in (PE, NPE):
            with self.subTest(doctype=doctype):
                with self.assertRaises(frappe.DoesNotExistError):
                    self._create(doctype, payee="PYE-NO-SUCH-PAYEE")
                frappe.db.rollback()
                self.assertFalse(frappe.db.exists(doctype, {"description": self.tag}))

    def test_a_user_without_create_on_the_doctype_is_refused(self):
        payee = self.payees.payee()
        for doctype in (PE, NPE):
            with self.subTest(doctype=doctype):
                with self.assertRaises(frappe.PermissionError):
                    self._create(doctype, user=NO_CREATE, payee=payee)
                self.assertFalse(frappe.db.exists(doctype, {"description": self.tag}))

    def test_only_an_expense_doctype_is_recorded(self):
        with self.assertRaises(frappe.ValidationError):
            self._create("Expense Request")
