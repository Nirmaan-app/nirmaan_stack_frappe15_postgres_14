# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Once approved, an Expense's type is not changed to or from Office Rent (spec #1522 review, S3).

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not a Technical Data Sheet.

The tax follows the type at approval, so before approval the type may change freely; from Approved on
(Reconciliation Pending and Paid included) a change to or from Office Rent is refused on every save:
an Accountant's and an Admin's edit through `frappe.client.set_value` (the save Desk and the app's
`updateDoc` make) and a system save.

Runs on the fixture of `test_office_rent_tds` (one transaction, commits stubbed, rolled back).

Run:
  devenv.sh test --module nirmaan_stack.api.expense_requests.test_office_rent_type_lock
"""

import frappe
from frappe.client import set_value as client_set_value

from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.expense_requests.test_office_rent_tds import (
    ACCOUNTANT,
    ADMIN,
    NPE,
    OFFICE_RENT,
    OfficeRentCase,
)

ACCOUNTANT_LEAD = "xrtds_accountant_lead@example.com"
PAYMENT = {"payment_date": "2026-10-21", "payment_ref": "UTR-xrtds", "payment_attachment": "/files/xrtds.pdf"}
REFUSED = "type can no longer be changed to or from Office Rent"


class TestTheTypeIsLockedOnceApproved(OfficeRentCase):
    def setUp(self):
        super().setUp()
        _make_user(ACCOUNTANT_LEAD, "Nirmaan Accountant Lead Profile", ("Nirmaan Accountant Lead",))
        self.other = frappe.db.get_value("Expense Type", {"non_project": 1, "name": ["!=", OFFICE_RENT]}, "name")

    # -- helpers --------------------------------------------------------------------------------
    def _set_type(self, user, name, expense_type):
        frappe.set_user(user)
        try:
            return client_set_value(NPE, name, "type", expense_type)
        finally:
            frappe.set_user("Administrator")

    def _other_expense(self, amount) -> str:
        """An Expense of another type, inserted by Administrator (L1): born Approved below Rs 15,000."""
        doc = frappe.new_doc(NPE)
        doc.update({"type": self.other, "amount": amount, "description": "xrtds other type"})
        doc.insert(ignore_permissions=True)
        return doc.name

    def _withheld_rent(self) -> str:
        _request, name = self._raise(100000)
        self._approve_by_admin_then_ceo(name)
        return name

    def _assert_refused(self, user, name, expense_type, stays):
        with self.assertRaises(frappe.ValidationError) as refused:
            self._set_type(user, name, expense_type)
        self.assertIn(REFUSED, str(refused.exception))
        self.assertEqual(frappe.db.get_value(NPE, name, "type"), stays)

    # -- refused once approved --------------------------------------------------------------------
    def test_a_withheld_office_rent_keeps_its_type_at_every_status_for_every_editor(self):
        name = self._withheld_rent()
        for status, editors in (("Approved", (ACCOUNTANT,)),
                                ("Reconciliation Pending", (ACCOUNTANT,)),
                                ("Paid", (ADMIN, ACCOUNTANT_LEAD, "Administrator"))):
            if status == "Reconciliation Pending":
                self._decide(ACCOUNTANT, name, "mark_done")
            if status == "Paid":
                self._decide(ACCOUNTANT, name, "mark_paid", payment=frappe.as_json(PAYMENT))
            self.assertEqual(self._expense(name)["status"], status)
            for user in editors:
                with self.subTest(status=status, user=user):
                    self._assert_refused(user, name, self.other, stays=OFFICE_RENT)

    def test_an_approved_expense_of_another_type_cannot_become_office_rent(self):
        name = self._other_expense(12000)
        self.assertEqual(self._expense(name)["status"], "Approved")
        self._assert_refused(ACCOUNTANT, name, OFFICE_RENT, stays=self.other)

        self._decide(ACCOUNTANT, name, "mark_paid", payment=frappe.as_json(PAYMENT))
        for user in (ADMIN, ACCOUNTANT_LEAD):
            with self.subTest(user=user):
                self._assert_refused(user, name, OFFICE_RENT, stays=self.other)

    def test_a_system_save_cannot_change_it_either(self):
        name = self._withheld_rent()
        doc = frappe.get_doc(NPE, name)
        doc.type = self.other
        with self.assertRaises(frappe.ValidationError) as refused:
            doc.save(ignore_permissions=True)
        self.assertIn(REFUSED, str(refused.exception))
        self.assertEqual(frappe.db.get_value(NPE, name, "type"), OFFICE_RENT)

    def test_other_fields_and_other_type_changes_still_save(self):
        name = self._other_expense(12000)
        third = frappe.db.get_value("Expense Type", {"non_project": 1, "name": ["not in", [OFFICE_RENT, self.other]]},
                                    "name")
        self._set_type(ACCOUNTANT, name, third)
        self.assertEqual(frappe.db.get_value(NPE, name, "type"), third)

    # -- free before approval -------------------------------------------------------------------
    def test_before_approval_the_type_changes_both_ways(self):
        _request, rent = self._raise(100000)
        self.assertEqual(self._expense(rent)["status"], "Requested")
        self._set_type(ACCOUNTANT, rent, self.other)
        self.assertEqual(frappe.db.get_value(NPE, rent, "type"), self.other)

        # Born CEO Pending (Administrator's own L1 step on Rs 1,00,000): still before approval.
        other = self._other_expense(100000)
        self.assertEqual(self._expense(other)["status"], "CEO Pending")
        self._set_type(ACCOUNTANT, other, OFFICE_RENT)
        self.assertEqual(frappe.db.get_value(NPE, other, "type"), OFFICE_RENT)
