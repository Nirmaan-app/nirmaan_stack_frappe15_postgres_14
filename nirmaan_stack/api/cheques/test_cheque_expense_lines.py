# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Expense lines and typed-payee cheques (#1411, spec #1407): the rules every write still holds.

Since #1482 (spec #1477) the Cheque Tracker makes Payment cheques only, so no new cheque takes an
expense line or a typed payee (`test_save_cheque` covers that refusal). The cheques recorded before
stay readable as Old-type cheques, and every save of one still runs the `validate` controller's
expense-line rules. This suite plants such cheques through the Cheque document
(`ChequeFixture.plant_cheque`) and reads back what a user sees: the Cheque's lines, the expense
itself, or the refusal.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Projects, vendors and Work Orders come from
`TaxedWorkOrderFixture`; expenses are planted and purged here; every Cheque carries a TESTCHQ number
and is purged by `ChequeFixture`.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

U = "Administrator"
PE = "Project Expenses"
NPE = "Non Project Expenses"
PE_LINE = "Project Expense"
NPE_LINE = "Non-project Expense"
PO_WO_LINE = "PO/WO Payment"
SR = "Service Requests"
PHOTO = "https://storage.example.invalid/private/files/cheque-test.jpg"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class TestChequeExpenseLines(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor(2.0)
        self.project = self.fx.project()
        self.other_project = self.fx.project()
        self.sr = self.fx.service_request(self.project, self.vendor)
        frappe.db.commit()  # a refusal below rolls back; the planted rows must outlive it
        quiet = patch(f"{CONTROLLER}._notify_admins_auto_approved")
        quiet.start()
        self.addCleanup(quiet.stop)

    def tearDown(self):
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _expense(self, doctype, *, amount=4000, project=None, status="Approved"):
        """A bare expense (raw insert: no expense hook runs). A Project Expense names its `projects`."""
        name = f"TEST-CHQX-{frappe.generate_hash(length=10)}"
        columns = "name, creation, modified, modified_by, owner, docstatus, idx, amount, status, description"
        values = [name, U, U, flt(amount), status, f"cheque expense test {name}"]
        if doctype == PE:
            columns += ", projects"
            values.append(project or self.project)
        placeholders = ", ".join(["%s", "NOW()", "NOW()", "%s", "%s", "0", "0"] + ["%s"] * (len(values) - 3))
        frappe.db.sql(f'INSERT INTO "tab{doctype}" ({columns}) VALUES ({placeholders})', tuple(values))
        self.addCleanup(
            ChequeFixture.purge_rows, [("Version", {"ref_doctype": doctype, "docname": name}), (doctype, {"name": name})]
        )
        frappe.db.commit()
        return name

    # -- driving --------------------------------------------------------------------------------
    def _pe_line(self, expense=None, *, project=None, amount=None):
        line = {"line_type": PE_LINE, "project": project or self.project}
        if expense:
            line["payment_name"] = expense
        if amount is not None:
            line["amount"] = amount
        return line

    @staticmethod
    def _npe_line(expense=None, *, amount=None, **extra):
        line = {"line_type": NPE_LINE, **extra}
        if expense:
            line["payment_name"] = expense
        if amount is not None:
            line["amount"] = amount
        return line

    def _save(self, lines, **overrides):
        values = {
            "bank": "ICICI Bank",
            "cheque_no": self.cheques.number(),
            "cheque_date": nowdate(),
            "amount": 10000,
            "payee_name": "Tata Power",
            "attachment": PHOTO,
            "lines": json.dumps(lines),
        }
        values.update(overrides)
        return self.cheques.plant_cheque(**{k: v for k, v in values.items() if v is not None})

    def _refused(self, phrase, lines, **overrides):
        with self.assertRaisesRegex(frappe.ValidationError, phrase):
            self._save(lines, **overrides)
        frappe.db.rollback()

    def _lines(self, cheque):
        return [
            (l.line_type, l.project, l.record_doctype, l.record_name, l.payment_doctype, l.payment_name, flt(l.amount))
            for l in frappe.get_all(
                "Cheque Line",
                filters={"parent": cheque, "parenttype": "Cheques"},
                fields=["line_type", "project", "record_doctype", "record_name", "payment_doctype", "payment_name", "amount"],
                order_by="idx asc",
            )
        ]

    def _cancel(self, cheque):
        """Plant a Cancelled Cheque. The status change itself is #1412's; this is only its outcome."""
        # Raw on purpose: it skips the Cheque's `validate` and writes no history row, because this suite
        # tests what a Cancelled Cheque's lines may do, not the status change (`test_cheque_status` does).
        # No derived figure reads a Cheque's status, so nothing needs recomputing.
        frappe.db.set_value("Cheques", cheque, "status", "Cancelled")
        frappe.db.commit()

    # -- saving expense lines -------------------------------------------------------------------
    def test_a_typed_payee_cheque_saves_with_a_non_project_and_a_project_expense_line(self):
        office = self._expense(NPE, amount=6000)
        site = self._expense(PE, amount=4000)
        name = self._save([self._npe_line(office), self._pe_line(site)])

        self.assertEqual(
            self._lines(name),
            [
                (NPE_LINE, None, None, None, NPE, office, 6000.0),  # the amount comes from the expense
                (PE_LINE, self.project, None, None, PE, site, 4000.0),
            ],
        )

    def test_a_typed_amount_is_kept_and_a_non_project_line_needs_no_project_or_po_wo(self):
        office = self._expense(NPE, amount=6000)
        name = self._save([
            self._npe_line(office, amount=2500, project=self.project, record_doctype=SR, record_name=self.sr),
        ])
        self.assertEqual(self._lines(name), [(NPE_LINE, None, None, None, NPE, office, 2500.0)])

    def test_a_vendor_cheque_takes_expense_lines_beside_its_po_wo_lines(self):
        site = self._expense(PE, amount=3000)
        name = self._save(
            [
                {"line_type": PO_WO_LINE, "project": self.project, "record_doctype": SR, "record_name": self.sr, "amount": 7000},
                self._pe_line(site),
            ],
            payee_name=None,
            vendor=self.vendor,
        )
        self.assertEqual([l[0] for l in self._lines(name)], [PO_WO_LINE, PE_LINE])

    def test_an_expense_line_without_an_expense_is_refused(self):
        self._refused("Line 1: pick the Non-Project Expense", [self._npe_line(amount=500)])
        self._refused("Line 1: pick the Project Expense", [self._pe_line(amount=500)])

    def test_a_project_expense_line_needs_its_project(self):
        site = self._expense(PE)
        self._refused("Line 1: pick the project", [{"line_type": PE_LINE, "payment_name": site}])

    def test_a_project_expense_must_belong_to_the_lines_project(self):
        site = self._expense(PE, project=self.other_project)
        self._refused(f"Line 1: expense {site} is not in project {self.project}", [self._pe_line(site)])

    def test_an_expense_of_the_wrong_kind_or_missing_is_refused(self):
        """Frappe's own link check refuses these first ("Could not find Row #1: Payment: ...")."""
        office = self._expense(NPE)
        self._refused(office, [self._pe_line(office)])
        self._refused("TEST-CHQX-nope", [self._npe_line("TEST-CHQX-nope")])

    def test_a_po_wo_line_on_a_typed_payee_cheque_is_refused(self):
        self._refused(
            "Line 1: a PO or Work Order payment needs a cheque made out to a Vendor",
            [{"line_type": PO_WO_LINE, "project": self.project, "record_doctype": SR, "record_name": self.sr, "amount": 100}],
        )

    def test_an_expense_sits_on_at_most_one_live_cheque(self):
        office = self._expense(NPE)
        first = self._save([self._npe_line(office)])
        number = frappe.db.get_value("Cheques", first, "cheque_no")
        self._refused(f"Line 1: expense {office} is already on cheque {number} \\(Issued\\)", [self._npe_line(office)])
        self._refused("is on two lines", [self._npe_line(office), self._npe_line(office)])

        self._cancel(first)
        second = self._save([self._npe_line(office)])
        self.assertEqual(self._lines(second)[0][5], office)

    def test_the_expense_is_unchanged_after_linking(self):
        office = self._expense(NPE, amount=6000)
        site = self._expense(PE, amount=4000)
        before = {e: frappe.db.get_value(dt, e, "*", as_dict=True) for dt, e in ((NPE, office), (PE, site))}
        self._save([self._npe_line(office), self._pe_line(site)])
        after = {e: frappe.db.get_value(dt, e, "*", as_dict=True) for dt, e in ((NPE, office), (PE, site))}
        self.assertEqual(after, before)

