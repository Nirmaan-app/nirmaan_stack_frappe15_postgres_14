# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for PO Payment Vouchers in Bulk Download (`bulk_download._po_voucher_payments`,
`download_selected_po_payment_vouchers`, and the job's generated voucher).

PO payments carry no uploaded voucher: the job GENERATES each one. What must hold:

  1. ONLY PAID PO PAYMENTS GET A VOUCHER, oldest payment first -- checked against independent SQL,
     in both scopes. A selected payment that is not Paid, is a WO payment, or belongs to another
     vendor is dropped.
  2. EACH VOUCHER IS RENDERED THE WAY THE PO PAGE RENDERS IT: print format "SR Payment", no
     letterhead. Payments travel as names, an empty selection is refused, and the file-URL
     endpoint refuses the type.
  3. THE JOB GETS AN HOUR: generating ~450 vouchers takes ~12 min, too close to the `long` queue's
     25-minute default. Every other type keeps the default.
  4. A USER HELD TO ONE PROJECT gets only that project's vouchers from a vendor.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Read-only on live rows: nothing is queued (the module's start
is recorded), the work runs in-process, and `frappe.get_print` is replaced except in the one test that
renders a real voucher. The restricted user is the scope tests' throwaway (db_insert, never
committed).
"""

import io
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from pypdf import PdfWriter

from nirmaan_stack.api.pdf_helper import bulk_download as bd
from nirmaan_stack.api.pdf_helper import test_bulk_download_job as job_tests
# Imported as a module, not the class: the test loader would otherwise run the scope tests here too.
from nirmaan_stack.api.pdf_helper import test_bulk_download_scope as scope_tests

PAID_PO_PAYMENTS = """select name from "tabProject Payments" where {field} = %s
    and document_type = 'Procurement Orders' and status = 'Paid' {extra} order by payment_date asc, creation asc"""


def _sql_list(query, *values):
    return [r[0] for r in frappe.db.sql(query, values)]


def _tiny_pdf():
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


class TestBulkDownloadPOVouchers(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # A vendor with 3+ Paid PO payments in 2+ projects AND unpaid ones, so every rule has rows to bite on.
        rows = frappe.db.sql(
            """select vendor from "tabProject Payments" where document_type = 'Procurement Orders'
            group by vendor
            having count(distinct case when status = 'Paid' then project end) >= 2
               and sum(case when status = 'Paid' then 1 else 0 end) >= 3
               and sum(case when status <> 'Paid' then 1 else 0 end) >= 1
            order by count(*) asc limit 1"""
        )
        cls.vendor = rows[0][0] if rows else None

    _restricted_user = scope_tests.TestBulkDownloadScope._restricted_user
    tearDown = scope_tests.TestBulkDownloadScope.tearDown

    def setUp(self):
        if not self.vendor:
            self.skipTest("this site has no vendor with 3+ Paid PO payments in 2+ projects and an unpaid one")
        self.users, self.prints = [], []
        self.enqueued = job_tests.record_starts(self)

    def _record_print(self, doctype, name, print_format=None, as_pdf=False, no_letterhead=0, **_):
        self.prints.append((doctype, name, print_format, no_letterhead))
        return _tiny_pdf()

    def _run_last_job(self):
        with patch.object(frappe, "get_print", side_effect=self._record_print):
            return job_tests.run_work(self.enqueued[-1])

    def _project_with_paid(self):
        return frappe.db.sql("""select project from "tabProject Payments" where vendor = %s and document_type = 'Procurement Orders'
            and status = 'Paid' group by project order by count(*) asc limit 1""", (self.vendor,))[0][0]

    # --- 1. only Paid PO payments, oldest first ----------------------------------------------------

    def test_the_vouchers_are_the_scopes_paid_po_payments_oldest_first(self):
        v, p = self.vendor, self._project_with_paid()
        self.assertEqual(bd._po_voucher_payments("vendor", v), _sql_list(PAID_PO_PAYMENTS.format(field="vendor", extra=""), v))
        self.assertEqual(bd._po_voucher_payments("project", p), _sql_list(PAID_PO_PAYMENTS.format(field="project", extra=""), p))
        self.assertTrue(bd._po_voucher_payments("vendor", v), "the chosen vendor should have paid PO payments")

    def test_a_selected_unpaid_wo_or_other_vendors_payment_is_dropped(self):
        v = self.vendor
        paid = _sql_list(PAID_PO_PAYMENTS.format(field="vendor", extra=""), v)[:2]
        unpaid = frappe.db.get_value("Project Payments", {"vendor": v, "document_type": "Procurement Orders", "status": ["!=", "Paid"]}, "name")
        wo_paid = frappe.db.get_value("Project Payments", {"vendor": v, "document_type": "Service Requests", "status": "Paid"}, "name")
        other = frappe.db.get_value("Project Payments", {"vendor": ["!=", v], "document_type": "Procurement Orders", "status": "Paid"}, "name")
        picked = [unpaid, *paid, *(n for n in (wo_paid, other) if n)]
        self.assertEqual(bd._po_voucher_payments("vendor", v, picked), paid)
        self.assertEqual(bd._po_voucher_payments("vendor", v, [unpaid]), [])
        self.assertEqual(bd._po_voucher_payments("vendor", v, []), [])

    # --- 2. generated like the PO page's voucher ---------------------------------------------------

    def test_the_job_generates_each_selected_paid_voucher_with_the_po_pages_print_format(self):
        v = self.vendor
        paid = _sql_list(PAID_PO_PAYMENTS.format(field="vendor", extra=""), v)[:3]
        unpaid = frappe.db.get_value("Project Payments", {"vendor": v, "document_type": "Procurement Orders", "status": ["!=", "Paid"]}, "name")
        bd.download_selected_po_payment_vouchers(names=frappe.as_json([unpaid, *reversed(paid)]), vendor=v, op_id=job_tests.new_op_id())
        run = self._run_last_job()

        self.assertEqual(self.prints, [("Project Payments", n, "SR Payment", 1) for n in paid])
        self.assertEqual(len(paid), 3)
        # One progress report per voucher, one for the merge, then the file.
        self.assertEqual(len(run.progress), 4)
        self.assertEqual(run.progress[0]["message"], "Processing PO Payment Vouchers 1 of 3...")
        self.assertTrue(run.file[1].endswith("_Selected_PO_Payment_Vouchers.pdf"))
        self.assertEqual(run.result, {"included": 3, "total": 3})

    def test_download_all_generates_every_paid_po_payment_of_the_scope(self):
        p = self._project_with_paid()
        bd.download_project_attachments(doc_type=bd.PO_PAYMENT_VOUCHERS, project=p, op_id=job_tests.new_op_id())
        self._run_last_job()
        self.assertEqual([n for _, n, _, _ in self.prints], _sql_list(PAID_PO_PAYMENTS.format(field="project", extra=""), p))

    def test_a_real_voucher_renders_from_the_sr_payment_print_format(self):
        # The one real render (~1.6 s): the format exists and renders a PO payment as a PDF.
        name = _sql_list(PAID_PO_PAYMENTS.format(field="vendor", extra=""), self.vendor)[0]
        pdf = frappe.get_print("Project Payments", name, print_format=bd.VOUCHER_PRINT_FORMAT, as_pdf=True, no_letterhead=1)
        self.assertTrue(pdf.startswith(b"%PDF"))

    def test_payments_travel_as_names_and_an_empty_selection_or_a_file_link_is_refused(self):
        for empty in ("[]", "", "not json"):
            with self.assertRaises(frappe.ValidationError):
                bd.download_selected_po_payment_vouchers(names=empty, vendor=self.vendor)
        with self.assertRaises(frappe.ValidationError):
            bd.download_selected_attachments(attachment_names='["/files/x.pdf"]', doc_type=bd.PO_PAYMENT_VOUCHERS, vendor=self.vendor)
        self.assertEqual(self.enqueued, [])

    # --- 3. an hour for generated vouchers, the default for the rest --------------------------------

    def test_po_voucher_jobs_get_an_hour_and_every_other_type_keeps_the_queue_default(self):
        v, op = self.vendor, job_tests.new_op_id
        bd.download_selected_po_payment_vouchers(names='["PAY-X"]', vendor=v, op_id=op())
        bd.download_project_attachments(doc_type=bd.PO_PAYMENT_VOUCHERS, vendor=v, op_id=op())
        self.assertEqual([j["timeout"] for j in self.enqueued], [3600, 3600])
        self.enqueued.clear()
        bd.download_selected_pos(names='["PO-X"]', vendor=v, op_id=op())
        bd.download_selected_wo_payment_vouchers(names='["PAY-X"]', vendor=v, op_id=op())
        bd.download_project_attachments(doc_type="DC", vendor=v, op_id=op())
        # The `long` queue's own default, which these types always had.
        self.assertEqual([j["timeout"] for j in self.enqueued], [1500, 1500, 1500])

    # --- 4. user permissions ------------------------------------------------------------------------

    def test_a_project_scoped_user_gets_only_their_projects_po_vouchers_from_a_vendor(self):
        v = self.vendor
        p = self._project_with_paid()
        everything = bd._po_voucher_payments("vendor", v)
        own = _sql_list(PAID_PO_PAYMENTS.format(field="vendor", extra="and project = %s"), v, p)
        frappe.set_user(self._restricted_user(["Nirmaan Project Lead"], [p]))
        self.assertEqual(bd._po_voucher_payments("vendor", v), own)
        self.assertLess(len(own), len(everything))
