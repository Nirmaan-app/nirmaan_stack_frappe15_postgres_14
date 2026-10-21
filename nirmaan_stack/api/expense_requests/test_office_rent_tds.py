# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""An Office Rent expense withholds 10% TDS (section 194-I) when it is approved (spec #1522, #1525).

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not a Technical Data Sheet.

Driven through the real endpoints: an HR Executive raises Office Rent with the form's answers
(`create_expense_request`; HR is put on Records without review, so the request becomes its Expense at
once, at the status the amount rule gives), Admin and the CEO decide it (`decide_expenses`), Accounts
mark it done, a bank line settles it (`link_rows_to_expense`) and is unreconciled (`unreconcile_row`).
Each test reads what a person would see: the Expense's status and amount, its request's amount, and
its tax record.

Runs inside ONE transaction whose commits are stubbed and which `tearDown` rolls back (as
`api/approvals/test_expense_decisions`), so no user, request, expense, record or bank line outlives
a test. ⚠️ Needs the site's real Office Rent type with its form (`bench migrate`).

Run:
  devenv.sh test --module nirmaan_stack.api.expense_requests.test_office_rent_tds
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import nowdate

from nirmaan_stack.api.approvals.expense_actions import decide_expenses
from nirmaan_stack.api.expense_requests.create import create_expense_request
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.expense_requests.test_records_without_review import _write_list
from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.review import ROW_DOCTYPE
from nirmaan_stack.api.outflow_import.test_expenses import _fresh_parse
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.api.outflow_import.upload import _stage_batch
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services import expense_request_routing as routing
from nirmaan_stack.services.expense_tds import withhold_expense_tds
from nirmaan_stack.services.outflow_import.status import OPEN_ROW_STATUSES

NPE = "Non Project Expenses"
TDS = "Payment TDS Deduction"
OFFICE_RENT = "Office Rent"

HR = "xrtds_hr@example.com"
HR_PROFILE = "Nirmaan HR Executive Profile"
ADMIN = "xrtds_admin@example.com"
ACCOUNTANT = "xrtds_accountant@example.com"

RECORD_FIELDS = ["name", "non_project_expense", "project_payment", "gross_amount", "tds_percentage",
                 "tds_amount", "tds_section", "borne_by", "deductee_name", "deductee_pan", "status",
                 "payment_approved_on", "tds_challan"]


def _rent_answers(**overrides):
    fmt = json.loads(frappe.db.get_value("Expense Type", OFFICE_RENT, "source_format"))
    detail = {"rent_month": "2026-10", "office_location": "Bengaluru HQ",
              "landlord_name": "Asha Rao", "landlord_pan": "abcpk1234d", **overrides}
    return {"templateId": fmt["templateId"], "templateVersion": fmt["templateVersion"],
            "responses": {"detail": detail}}


class OfficeRentCase(FrappeTestCase):
    """The fixture and helpers of the Office Rent tax suites; holds no test of its own."""

    def setUp(self):
        self._commit = frappe.db.commit
        self._publish = frappe.publish_realtime
        frappe.db.commit = lambda *a, **k: None
        frappe.publish_realtime = lambda *a, **k: None
        frappe.set_user("Administrator")
        routing.clear_cache()
        _make_user(HR, HR_PROFILE, ("Nirmaan HR Executive",))
        _make_user(ADMIN, "Nirmaan Admin Profile", ("System Manager",))
        _make_user(ACCOUNTANT, "Nirmaan Accountant Profile", ("Nirmaan Accountant",))
        if not frappe.db.exists("User", CEO_AUTHORIZED_USER):
            _make_user(CEO_AUTHORIZED_USER, "Nirmaan Admin Profile", ("System Manager",))
        # HR's request becomes its Expense on submit, born at the status the amount rule gives an HR
        # raiser: Requested from Rs 15,000, Approved below it.
        _write_list([HR_PROFILE])

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.commit = self._commit
        frappe.publish_realtime = self._publish
        frappe.db.rollback()
        routing.clear_cache()

    # -- helpers --------------------------------------------------------------------------------
    def _raise(self, amount, **answers) -> tuple[str, str]:
        """HR raises Office Rent of `amount`; returns (request, expense)."""
        frappe.set_user(HR)
        try:
            res = create_expense_request(expense_type=OFFICE_RENT, amount=amount,
                                         source_data=_rent_answers(**answers))
        finally:
            frappe.set_user("Administrator")
        self.assertTrue(res["created_expense"], "HR records without review: the Expense is created on submit")
        return res["name"], res["created_expense"]

    def _decide(self, user, name, action, **kwargs) -> dict:
        frappe.set_user(user)
        try:
            return decide_expenses(expense_ids=frappe.as_json([name]), action=action, **kwargs)["data"]
        finally:
            frappe.set_user("Administrator")

    def _approve_by_admin_then_ceo(self, name):
        self.assertEqual(self._decide(ADMIN, name, "l1_approve")["statuses"], {name: "CEO Pending"})
        self.assertEqual(self._decide(CEO_AUTHORIZED_USER, name, "ceo_approve")["statuses"], {name: "Approved"})

    def _expense(self, name):
        return frappe.db.get_value(NPE, name, ["status", "amount"], as_dict=True)

    def _records(self, name):
        return frappe.get_all(TDS, filters={"non_project_expense": name}, fields=RECORD_FIELDS)

    def _bank_line(self, amount) -> str:
        """One open money-out line of a freshly staged statement, carrying `amount`."""
        batch = _stage_batch(_fresh_parse(), file_url="/private/files/test-statement.csv",
                             filename="test-statement.csv", user="Administrator")
        rows = frappe.get_all(ROW_DOCTYPE, fields=["name", "direction"], order_by="creation asc",
                              filters={"import_batch": batch.name, "row_status": ["in", list(OPEN_ROW_STATUSES)]})
        line = next(r.name for r in rows if (r.direction or "") != "Credit")
        # A fixture write: the staged statement's own figures are not the rent's.
        frappe.db.set_value(ROW_DOCTYPE, line, "amount", amount, update_modified=False)
        return line


class TestOfficeRentTds(OfficeRentCase):
    # -- withholding at approval ----------------------------------------------------------------
    def test_full_rent_approved_by_admin_then_the_ceo_is_paid_net_with_one_record(self):
        request, name = self._raise(100000)
        self.assertEqual(self._expense(name), {"status": "Requested", "amount": 100000})

        self._approve_by_admin_then_ceo(name)

        self.assertEqual(self._expense(name), {"status": "Approved", "amount": 90000})
        [record] = self._records(name)
        self.assertEqual(
            {k: record[k] for k in RECORD_FIELDS if k != "name"},
            {"non_project_expense": name, "project_payment": None, "gross_amount": 100000,
             "tds_percentage": 10, "tds_amount": 10000, "tds_section": "194-I", "borne_by": "Vendor",
             "deductee_name": "Asha Rao", "deductee_pan": "ABCPK1234D", "status": "Pending",
             "payment_approved_on": frappe.utils.getdate(nowdate()), "tds_challan": None})
        # The request keeps the full rent it asked for; its Expense carries the net.
        self.assertEqual(frappe.db.get_value("Expense Request", request, "amount"), 100000)

    def test_the_tiers_read_the_full_rent_so_55000_waits_for_the_ceo(self):
        _request, name = self._raise(55000)

        self.assertEqual(self._decide(ADMIN, name, "l1_approve")["statuses"], {name: "CEO Pending"})

        self.assertEqual(self._expense(name), {"status": "CEO Pending", "amount": 55000})
        self.assertEqual(self._records(name), [], "nothing is withheld before the approval")

    def test_rent_under_15000_is_born_approved_and_withheld_at_once(self):
        _request, name = self._raise(12000)

        self.assertEqual(self._expense(name), {"status": "Approved", "amount": 10800})
        [record] = self._records(name)
        self.assertEqual((record.gross_amount, record.tds_amount, record.tds_section), (12000, 1200, "194-I"))
        self.assertEqual((record.deductee_name, record.deductee_pan), ("Asha Rao", "ABCPK1234D"))

    # -- once only ------------------------------------------------------------------------------
    def test_a_resave_or_a_retry_writes_no_second_record_and_does_not_re_net(self):
        _request, name = self._raise(100000)
        self._approve_by_admin_then_ceo(name)
        [record] = self._records(name)

        doc = frappe.get_doc(NPE, name)
        doc.comment = "re-saved"
        doc.save(ignore_permissions=True)
        retry = self._decide(CEO_AUTHORIZED_USER, name, "ceo_approve")
        self.assertEqual(retry["succeeded"], [])
        self.assertEqual(withhold_expense_tds(frappe.get_doc(NPE, name)), record.name)

        self.assertEqual(self._expense(name), {"status": "Approved", "amount": 90000})
        self.assertEqual([r.name for r in self._records(name)], [record.name])
        self.assertEqual(frappe.db.get_value(TDS, record.name, ["gross_amount", "tds_amount"]), (100000, 10000))

    def test_a_bank_line_for_the_net_settles_it_and_unreconciling_withholds_nothing_new(self):
        _request, name = self._raise(100000)
        self._approve_by_admin_then_ceo(name)
        self.assertEqual(self._decide(ACCOUNTANT, name, "mark_done")["statuses"], {name: "Reconciliation Pending"})
        line = self._bank_line(90000)

        link_rows_to_expense(rows=json.dumps([line]), target_doctype=NPE, target_name=name)
        self.assertEqual(self._expense(name), {"status": "Paid", "amount": 90000})

        unreconcile_row(row=line, legs="all", reason="test: wrong line")
        self.assertEqual(self._expense(name), {"status": "Reconciliation Pending", "amount": 90000})
        [record] = self._records(name)
        self.assertEqual((record.gross_amount, record.tds_amount), (100000, 10000))

    # -- what never withholds -------------------------------------------------------------------
    def test_any_other_type_withholds_nothing(self):
        other = frappe.db.get_value("Expense Type", {"non_project": 1, "name": ["!=", OFFICE_RENT]}, "name")
        for amount, born in ((12000, "Approved"), (100000, "CEO Pending")):
            with self.subTest(amount=amount):
                # Raised by Administrator (L1): born Approved below Rs 50,000, CEO Pending above it.
                doc = frappe.new_doc(NPE)
                doc.update({"type": other, "amount": amount, "description": "xrtds other type"})
                doc.insert(ignore_permissions=True)
                self.assertEqual(doc.status, born)
                if born == "CEO Pending":
                    self._decide(CEO_AUTHORIZED_USER, doc.name, "ceo_approve")
                self.assertEqual(self._expense(doc.name), {"status": "Approved", "amount": amount})
                self.assertEqual(self._records(doc.name), [])

    def test_an_office_rent_approved_before_this_shipped_keeps_no_record(self):
        name = f"XRTDS-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabNon Project Expenses" (name, creation, modified, modified_by, owner,
                   docstatus, idx, type, amount, status, description)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, 100000, 'Approved',
                   'xrtds old rent')""",
            (name, OFFICE_RENT),
        )
        doc = frappe.get_doc(NPE, name)
        doc.comment = "re-saved"
        doc.save(ignore_permissions=True)
        self._decide(ACCOUNTANT, name, "mark_done")

        self.assertEqual(self._expense(name), {"status": "Reconciliation Pending", "amount": 100000})
        self.assertEqual(self._records(name), [])
