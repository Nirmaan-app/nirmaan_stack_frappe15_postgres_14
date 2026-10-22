# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""The screens are served an Office Rent expense's withheld tax by its own APIs (spec #1522, #1527).

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not a Technical Data Sheet.

`Payment TDS Deduction` is read by the Accountant roles (and System Manager); an HR approver cannot
read it. So the approval queue, the approve dialog's detail, the request page and the Expenses list's
standing, and the edit dialog's lookup each serve the stored split themselves, as `withheld_tds`. The
caller here is an HR Lead, who reads the Expense and its request but not the tax record.

BEFORE APPROVAL THEY SERVE NOTHING (`withheld_tds` None), by decision: nothing has been withheld, and
the Expense's amount is still the full rent, so the screens forecast from it with the frontend's one
rule (`utils/expenses/expenseTds.shownExpenseTds`). What these tests pin before approval is that the
inputs of that forecast arrive: the type, the gross amount and a status before approval.

AFTER APPROVAL they serve the record's gross, rate, tax and section, which stay as withheld after
Bulk Import's few-rupee correction of the amount.

Run:
  devenv.sh test --module nirmaan_stack.api.expense_requests.test_office_rent_tds_shown
"""

import json

import frappe

from nirmaan_stack.api.approvals.expense_detail import get_expense_approval_detail
from nirmaan_stack.api.approvals.expense_tds import get_withheld_tds
from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue
from nirmaan_stack.api.expense_requests.read import get_expense_request
from nirmaan_stack.api.expense_requests.standing import get_request_standing
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.expense_requests.test_office_rent_tds import (
    ACCOUNTANT,
    ADMIN,
    NPE,
    OFFICE_RENT,
    TDS,
    OfficeRentCase,
)
from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense

HR_LEAD = "xrtds_hr_lead@example.com"
NOBODY = "xrtds_nobody@example.com"

WITHHELD = {"gross_amount": 100000, "tds_percentage": 10, "tds_amount": 10000, "tds_section": "194-I"}


class TestTheWithheldTaxIsServed(OfficeRentCase):
    def setUp(self):
        super().setUp()
        _make_user(HR_LEAD, "Nirmaan HR Lead Profile", ("Nirmaan HR Lead",))
        _make_user(NOBODY, "Nirmaan HR Lead Profile", ())
        # The premise: the caller reads the Expense and its request, never the tax record.
        self.assertFalse(frappe.has_permission(TDS, "read", user=HR_LEAD))
        self.assertTrue(frappe.has_permission(NPE, "read", user=HR_LEAD))

    # -- helpers --------------------------------------------------------------------------------
    def _as_hr_lead(self, fn, *args, **kwargs):
        frappe.set_user(HR_LEAD)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user("Administrator")

    def _served(self, request, name) -> dict:
        """What each API hands the HR Lead for this expense."""
        [row] = self._as_hr_lead(get_approval_queue, filters=json.dumps([["name", "=", name]]))["data"]
        detail = self._as_hr_lead(get_expense_approval_detail, doctype=NPE, name=name)
        page = self._as_hr_lead(get_expense_request, name=request)
        standing = self._as_hr_lead(get_request_standing, names=json.dumps([request]))[request]
        lookup = self._as_hr_lead(get_withheld_tds, names=json.dumps([name]))
        return {"row": row, "detail": detail, "page": page["standing"], "standing": standing, "lookup": lookup}

    def _assert_none_withheld(self, served):
        for screen in ("row", "detail", "page", "standing"):
            self.assertIsNone(served[screen]["withheld_tds"], screen)
        self.assertEqual(served["lookup"], {})

    def _assert_withheld(self, served, name, expected=WITHHELD):
        for screen in ("row", "detail", "page", "standing"):
            self.assertEqual(served[screen]["withheld_tds"], expected, screen)
        self.assertEqual(served["lookup"], {name: expected})

    # -- before approval: the inputs of the forecast, and nothing withheld ------------------------
    def test_before_approval_nothing_is_served_as_withheld_and_the_amount_is_the_full_rent(self):
        request, name = self._raise(100000)

        served = self._served(request, name)
        self._assert_none_withheld(served)
        row = served["row"]
        self.assertEqual((row["expense_type"], row["status"], row["amount"]), (OFFICE_RENT, "Requested", 100000))
        self.assertEqual((served["detail"]["type"], served["detail"]["status"], served["detail"]["amount"]),
                         (OFFICE_RENT, "Requested", 100000))
        self.assertEqual(served["page"]["amount"], 100000)
        self.assertEqual(served["standing"]["expense"]["status"], "Requested")

        self.assertEqual(self._decide(ADMIN, name, "l1_approve")["statuses"], {name: "CEO Pending"})
        served = self._served(request, name)
        self._assert_none_withheld(served)
        self.assertEqual((served["row"]["status"], served["row"]["amount"]), ("CEO Pending", 100000))

    # -- after approval: the stored split, to a caller who cannot read it -------------------------
    def test_after_approval_the_stored_split_is_served_and_the_amount_is_the_net(self):
        request, name = self._raise(100000)
        self._approve_by_admin_then_ceo(name)

        served = self._served(request, name)
        self._assert_withheld(served, name)
        self.assertEqual((served["row"]["status"], served["row"]["amount"]), ("Approved", 90000))
        self.assertEqual(served["detail"]["amount"], 90000)
        self.assertEqual(served["page"]["amount"], 90000)

    def test_its_req_amount_is_the_full_rent_and_sorts_and_filters_as_it(self):
        """"Req. Amount" is the full bill (story 60): a withheld Office Rent expense reads the rent before
        withholding, not the net it is now stored at."""
        _, name = self._raise(100000)
        self._approve_by_admin_then_ceo(name)
        [row] = self._as_hr_lead(get_approval_queue, filters=json.dumps([["name", "=", name]]))["data"]
        self.assertEqual((row["requested_amount"], row["amount"]), (100000, 90000))
        found = self._as_hr_lead(get_approval_queue, filters=json.dumps([["name", "=", name], ["amount", ">=", 95000]]))
        self.assertEqual([r["name"] for r in found["data"]], [name])

    def test_a_bank_line_a_little_short_leaves_the_served_split_as_withheld(self):
        request, name = self._raise(100000)
        self._approve_by_admin_then_ceo(name)
        self._decide(ACCOUNTANT, name, "mark_done")
        line = self._bank_line(89998)
        link_rows_to_expense(rows=json.dumps([line]), target_doctype=NPE, target_name=name)

        served = self._served(request, name)
        self._assert_withheld(served, name)
        self.assertEqual((served["row"]["status"], served["row"]["amount"]), ("Paid", 89998))

    # -- what serves nothing --------------------------------------------------------------------
    def test_any_other_type_is_served_no_tax(self):
        other = frappe.db.get_value("Expense Type", {"non_project": 1, "name": ["!=", OFFICE_RENT]}, "name")
        doc = frappe.new_doc(NPE)
        doc.update({"type": other, "amount": 12000, "description": "xrtds other type"})
        doc.insert(ignore_permissions=True)
        self.assertEqual(doc.status, "Approved")

        [row] = self._as_hr_lead(get_approval_queue, filters=json.dumps([["name", "=", doc.name]]))["data"]
        self.assertIsNone(row["withheld_tds"])
        self.assertIsNone(self._as_hr_lead(get_expense_approval_detail, doctype=NPE, name=doc.name)["withheld_tds"])
        self.assertEqual(self._as_hr_lead(get_withheld_tds, names=json.dumps([doc.name])), {})

    def test_the_lookup_is_refused_to_someone_who_cannot_read_expenses(self):
        _request, name = self._raise(12000)
        frappe.set_user(NOBODY)
        try:
            with self.assertRaises(frappe.PermissionError):
                get_withheld_tds(names=json.dumps([name]))
        finally:
            frappe.set_user("Administrator")
