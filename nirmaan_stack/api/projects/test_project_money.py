# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A project's outflow, Current Liabilities, inflow and cashflow gap: one server figure (#1456, ADR-0034).

`GLOSSARY.md` *Project outflow* and *Current Liabilities*: outflow is cash (every Paid payment on the
project by its payment date, less Received Vendor Refunds by the refund's own date, plus Paid expenses,
plus the TDS on Paid Work Order payments by the payment's date, ADR-0034 Amendment A);
liabilities are max(0, delivered - Amount Paid) over the project's POs except Merged, Cancelled and
Inactive. CEO Hold and the Projects list read the same function, so their gaps agree.

Fixtures are raw inserts (`db_insert`, no hooks) on a scratch project, purged by project in
`tearDownClass`, each scope in its own `try` after a rollback.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.projects.project_aggregates import get_projects_financial_rollup
from nirmaan_stack.api.projects.project_money import get_project_money, get_projects_money
from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import (
    _compute_cashflow_gap,
    sync_cashflow_reason,
)
from nirmaan_stack.services.ceo_hold import core as ceo_hold
from nirmaan_stack.services.payment_tds import BORNE_BY_COMPANY, BORNE_BY_VENDOR

PO = "Procurement Orders"


def _raw(doctype, name=None, **fields):
    """Insert a row with only the given fields, skipping every hook and validation."""
    doc = frappe.new_doc(doctype)
    doc.update(fields)
    doc.name = name or f"TEST-1456-{frappe.generate_hash(length=10)}"
    doc.db_insert()
    return doc.name


def _rounded(money):
    return {key: flt(value, 2) for key, value in money.items()}


class TestProjectMoney(FrappeTestCase):
    """One project with every case the rule names, worked out by hand:

    - live PO A: delivered 1,000, Amount Paid 300 (a Paid 400 on 10-Apr less a Received 100 refund on
      15-Jun); created 05-May. Liability 700.
    - Inactive PO B: delivered 500, Amount Paid 300 (a Paid 300 on 10-May). Its payment is outflow; its
      would-be liability of 200 is left out.
    - Merged PO C: delivered 2,000, nothing paid. Its would-be liability of 2,000 is left out.
    - a waiting refund of 50 and a Requested payment of 5,000: nothing.
    - a Paid expense of 70 on 20-Apr and a Requested one of 999: 70.
    - an inflow of 800 on 01-May.

    All time: outflow 400 + 300 - 100 + 70 = 670, liabilities 700, inflow 800, gap 570.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.P = _raw("Projects", project_name="TEST-1456-MONEY", status="WIP")
        cls.A = _raw(PO, project=cls.P, status="PO Approved", po_amount_delivered=1000, amount_paid=300,
                     creation="2026-05-05 10:00:00")
        cls.B = _raw(PO, project=cls.P, status="Inactive", po_amount_delivered=500, amount_paid=300,
                     creation="2026-03-01 10:00:00")
        cls.C = _raw(PO, project=cls.P, status="Merged", po_amount_delivered=2000, amount_paid=0,
                     creation="2026-05-06 10:00:00")
        for order, amount, status, date in (
            (cls.A, 400, "Paid", "2026-04-10"),
            (cls.B, 300, "Paid", "2026-05-10"),
            (cls.A, 5000, "Requested", "2026-05-11"),
        ):
            _raw("Project Payments", project=cls.P, document_type=PO, document_name=order, amount=amount,
                 status=status, payment_date=date)
        for amount, status, date in ((100, "Received", "2026-06-15"), (50, "Reconciliation Pending", "2026-05-20")):
            _raw("Vendor Refunds", project=cls.P, document_type=PO, document_name=cls.A, amount=amount,
                 status=status, payment_date=date)
        _raw("Project Expenses", projects=cls.P, amount=70, status="Paid", payment_date="2026-04-20")
        _raw("Project Expenses", projects=cls.P, amount=999, status="Requested", payment_date="2026-05-02")
        _raw("Project Inflows", project=cls.P, amount=800, payment_date="2026-05-01")
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        failures = []
        for doctype, field in (
            ("Project Payments", "project"),
            ("Vendor Refunds", "project"),
            ("Project Expenses", "projects"),
            ("Project Inflows", "project"),
            (PO, "project"),
            ("CEO Hold Reason", "project"),
            ("Projects", "name"),
        ):
            try:
                frappe.db.delete(doctype, {field: cls.P})
                frappe.db.commit()
            except Exception as error:  # noqa: BLE001 - report every scope, strand none silently
                frappe.db.rollback()
                failures.append(f"{doctype}: {error}")
        super().tearDownClass()
        if failures:
            raise AssertionError(f"test_project_money left rows behind: {failures}")

    def test_all_time_figures(self):
        self.assertEqual(
            _rounded(get_project_money(self.P)),
            {"po_outflow": 600.0, "wo_outflow": 0.0, "expense_outflow": 70.0,
             "outflow": 670.0, "liabilities": 700.0, "inflow": 800.0, "cashflow_gap": 570.0,
             "refunds": 100.0, "tds": 0.0},
        )

    def test_a_refund_counts_on_its_own_date(self):
        # May-June: B's payment (10-May), the refund (15-Jun), the inflow; PO A was created in range.
        self.assertEqual(
            _rounded(get_project_money(self.P, from_date="2026-05-01", to_date="2026-06-30")),
            {"po_outflow": 200.0, "wo_outflow": 0.0, "expense_outflow": 0.0,
             "outflow": 200.0, "liabilities": 700.0, "inflow": 800.0, "cashflow_gap": 100.0,
             "refunds": 100.0, "tds": 0.0},
        )
        # April-May: both payments and the expense, but not the 15-Jun refund on the same PO.
        self.assertEqual(
            _rounded(get_project_money(self.P, from_date="2026-04-01", to_date="2026-05-31"))["outflow"],
            770.0,
        )

    def test_several_projects_in_one_call(self):
        money = get_projects_money([self.P, "TEST-1456-NO-SUCH-PROJECT"])
        self.assertEqual(_rounded(money[self.P])["cashflow_gap"], 570.0)
        self.assertEqual(
            _rounded(money["TEST-1456-NO-SUCH-PROJECT"]),
            {"po_outflow": 0.0, "wo_outflow": 0.0, "expense_outflow": 0.0,
             "outflow": 0.0, "liabilities": 0.0, "inflow": 0.0, "cashflow_gap": 0.0,
             "refunds": 0.0, "tds": 0.0},
        )

    def test_ceo_hold_and_the_projects_list_agree(self):
        rollup = get_projects_financial_rollup()[self.P]
        self.assertEqual(flt(_compute_cashflow_gap(self.P), 2), 570.0)
        self.assertEqual(flt(rollup["cashflow_gap"], 2), 570.0)
        self.assertEqual(
            (flt(rollup["outflow"], 2), flt(rollup["liabilities"], 2), flt(rollup["inflow"], 2)),
            (670.0, 700.0, 800.0),
        )

    def test_the_hold_reads_the_gap_without_merged_or_inactive_liabilities(self):
        # 570 is under a 600 limit; counting the Merged and Inactive POs' 2,200 would put it over.
        frappe.db.set_value("Projects", self.P, "cashflow_gap_limit", 600, update_modified=False)
        sync_cashflow_reason(self.P)
        frappe.db.commit()
        self.assertNotIn(ceo_hold.SOURCE_CASHFLOW, ceo_hold.active_sources(self.P))

    def test_a_reader_without_payment_access_is_refused(self):
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                get_project_money(self.P)
            with self.assertRaises(frappe.PermissionError):
                get_projects_money([self.P])
        finally:
            frappe.set_user("Administrator")


WO = "Service Requests"


class TestProjectOutflowCountsWorkOrderTds(FrappeTestCase):
    """Project outflow counts the TDS on the project's Paid Work Order payments, both kinds, on the
    payment's own date (ADR-0034 Amendment A, `GLOSSARY.md` *Project outflow*, #1510):

    - WO V (vendor-borne): a Paid payment on 10-Apr, ₹10,000 gross cut to ₹9,800 with ₹200 withheld.
    - WO C (company-borne): a Paid payment on 10-Jun of ₹800 kept whole, ₹16 paid by the company on top.
    - WO V: an Approved payment of ₹4,900 with ₹100 recorded: not Paid, so neither it nor its tax counts.
    - a Paid *TDS Payment* Non-Project Expense of ₹216 on 07-Jul (the challan): not project outflow.

    The deductions name no project of their own: the payment says whose they are.

    All time: wo_outflow = 9,800 + 200 + 800 + 16 = 10,816, the whole outflow and the gap.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.P = _raw("Projects", project_name="TEST-1510-WO-TDS", status="WIP")
        cls.payments = []
        for order, amount, status, date, tds, borne_by in (
            ("TEST-1510-WO-V", 9800, "Paid", "2026-04-10", 200, BORNE_BY_VENDOR),
            ("TEST-1510-WO-C", 800, "Paid", "2026-06-10", 16, BORNE_BY_COMPANY),
            ("TEST-1510-WO-V", 4900, "Approved", "2026-05-12", 100, BORNE_BY_VENDOR),
        ):
            payment = _raw("Project Payments", project=cls.P, document_type=WO, document_name=order,
                           amount=amount, status=status, payment_date=date)
            cls.payments.append(payment)
            gross = amount + tds if borne_by == BORNE_BY_VENDOR else amount
            _raw("Payment TDS Deduction", project_payment=payment, document_type=WO, document_name=order,
                 gross_amount=gross, tds_percentage=2, tds_amount=tds, borne_by=borne_by, status="Pending")
        cls.challan = _raw("Non Project Expenses", type="TDS Payment", amount=216, status="Paid",
                           payment_date="2026-07-07")
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        failures = []
        for doctype, filters in (
            ("Payment TDS Deduction", {"project_payment": ["in", cls.payments]}),
            ("Project Payments", {"project": cls.P}),
            ("Non Project Expenses", {"name": cls.challan}),
            ("CEO Hold Reason", {"project": cls.P}),
            ("Projects", {"name": cls.P}),
        ):
            try:
                frappe.db.delete(doctype, filters)
                frappe.db.commit()
            except Exception as error:  # noqa: BLE001 - report every scope, strand none silently
                frappe.db.rollback()
                failures.append(f"{doctype}: {error}")
        super().tearDownClass()
        if failures:
            raise AssertionError(f"test_project_money left rows behind: {failures}")

    def test_outflow_counts_both_kinds_of_tax_once(self):
        self.assertEqual(
            _rounded(get_project_money(self.P)),
            {"po_outflow": 0.0, "wo_outflow": 10816.0, "expense_outflow": 0.0,
             "outflow": 10816.0, "liabilities": 0.0, "inflow": 0.0, "cashflow_gap": 10816.0,
             "refunds": 0.0, "tds": 216.0},
        )

    def test_the_tax_counts_on_its_payments_date(self):
        # April: the vendor-borne payment and its withheld ₹200.
        self.assertEqual(
            _rounded(get_project_money(self.P, from_date="2026-04-01", to_date="2026-04-30"))["wo_outflow"],
            10000.0,
        )
        # May: only the Approved payment, which adds neither cash nor tax.
        self.assertEqual(
            _rounded(get_project_money(self.P, from_date="2026-05-01", to_date="2026-05-31"))["wo_outflow"],
            0.0,
        )
        # June-July: the company-borne payment and its ₹16; the July challan expense is not project outflow.
        self.assertEqual(
            _rounded(get_project_money(self.P, from_date="2026-06-01", to_date="2026-07-31"))["outflow"],
            816.0,
        )

    def test_ceo_hold_and_the_projects_list_agree(self):
        rollup = get_projects_financial_rollup()[self.P]
        self.assertEqual(flt(_compute_cashflow_gap(self.P), 2), 10816.0)
        self.assertEqual(flt(rollup["cashflow_gap"], 2), 10816.0)
        self.assertEqual(flt(rollup["outflow"], 2), 10816.0)
