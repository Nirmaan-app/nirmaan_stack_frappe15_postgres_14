# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for Porter Invoices in Report Bulk Download (`api/pdf_helper/porter_invoices.py` and
`bulk_download.download_selected_porter_invoices`).

What must hold:

  1. ONE ROW PER PORTER INVOICE, ANY VALIDATION STATUS, ONLY WITH A PDF. Porter Invoice data only, oldest
     invoice date first, undated last.
  2. EACH PDF ONCE. The merge takes each selected invoice's own PDF exactly once, in invoice-date order,
     whatever order or duplicates the browser sends; unknown and PDF-less numbers are dropped.
  3. REPORT BULK DOWNLOAD ONLY, ADMIN / ACCOUNTANT ONLY. No all_scope -> refused; another profile -> refused on
     the list, the download and the job; a project scope never yields a Porter PDF; the file-link endpoint
     refuses the type; 500 at most.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. The only writes are this suite's own Porter Invoice rows (and the
scope suite's throwaway users), inserted with `db_insert`, never committed, rolled back in tearDown. Nothing
is enqueued (`frappe.enqueue` is replaced) and no file is fetched.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.pdf_helper import bulk_download as bd
from nirmaan_stack.api.pdf_helper import porter_invoices as pi
from nirmaan_stack.api.pdf_helper import test_bulk_download_scope as scope_suite
from nirmaan_stack.services import role_profiles


class TestBulkDownloadPorterInvoices(FrappeTestCase):
    def setUp(self):
        self.enqueued, self.events, self.users = [], [], []
        for target, attr, fn in (
            (frappe, "enqueue", lambda method, **kw: self.enqueued.append(kw)),
            (frappe, "publish_realtime", lambda event, data=None, **kw: event.startswith("bulk_download") and self.events.append((event, data))),
        ):
            p = patch.object(target, attr, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)
        tag = frappe.generate_hash(length=6).upper()
        # name -> (status, invoice date, has PDF)
        self.spec = {
            f"TEST-PRT-{tag}-A": ("Passed", "2025-10-31", True),
            f"TEST-PRT-{tag}-B": ("Failed", "2025-09-30", True),
            f"TEST-PRT-{tag}-C": ("Passed", None, True),
            f"TEST-PRT-{tag}-D": ("Passed", "2025-08-31", False),
            f"TEST-PRT-{tag}-E": ("Error", "2025-11-30", True),
        }
        now = frappe.utils.now()
        for name, (status, date, has_pdf) in self.spec.items():
            doc = frappe.get_doc({
                "doctype": "Porter Invoice", "invoice_number": name, "import_batch": f"OFI-TEST-{tag}",
                "validation_status": status, "city": "Bengaluru", "completed_orders": 3,
                "read_invoice_date": date, "fare_total": 1000, "tax_total": 180,
                "invoice_file": f"/private/files/{name}.pdf" if has_pdf else None,
            })
            doc.name, doc.creation, doc.modified = name, now, now
            doc.owner = doc.modified_by = "Administrator"
            doc.db_insert()
        self.a, self.b, self.c, self.d, self.e = self.spec

    # The scope suite's teardown (rollback, then remove throwaway users) and its user helper, shared.
    tearDown = scope_suite.TestBulkDownloadScope.tearDown
    _restricted_user = scope_suite.TestBulkDownloadScope._restricted_user

    def _as_profile(self, profile):
        user = self._restricted_user([], [])
        real = role_profiles.get_role_profile
        p = patch.object(role_profiles, "get_role_profile", side_effect=lambda u: profile if u == user else real(u))
        p.start()
        self.addCleanup(p.stop)
        return user

    def _mine(self, rows):
        return [r["name"] for r in rows if r["name"] in self.spec]

    # --- 1. the list -----------------------------------------------------------------------------------

    def test_lists_every_status_with_a_pdf_oldest_first_undated_last(self):
        rows = pi.get_porter_invoices()
        # B (09-30, Failed) -> A (10-31, Passed) -> E (11-30, Error) -> C (no date); D has no PDF.
        self.assertEqual(self._mine(rows), [self.b, self.a, self.e, self.c])
        row = next(r for r in rows if r["name"] == self.a)
        self.assertEqual(
            (row["import_batch"], row["validation_status"], row["city"], row["completed_orders"], row["fare_total"], row["tax_total"]),
            (f"OFI-TEST-{self.a.split('-')[2]}", "Passed", "Bengaluru", 3, 1000, 180),
        )
        self.assertNotIn("invoice_file", row)  # the browser never gets file links

    def test_the_list_is_admin_and_accountant_only(self):
        for profile in ("Nirmaan Project Manager Profile", "Nirmaan PMO Executive Profile", "Nirmaan Procurement Executive Profile", None):
            frappe.set_user(self._as_profile(profile))
            with self.assertRaises(frappe.PermissionError, msg=str(profile)):
                pi.get_porter_invoices()
            frappe.set_user("Administrator")
        for profile in ("Nirmaan Accountant Profile", "Nirmaan Accountant Lead Profile", "Nirmaan Admin Profile"):
            frappe.set_user(self._as_profile(profile))
            self.assertEqual(self._mine(pi.get_porter_invoices()), [self.b, self.a, self.e, self.c], profile)
            frappe.set_user("Administrator")

    # --- 2. each PDF once ------------------------------------------------------------------------------------

    def test_each_selected_pdf_once_in_invoice_date_order(self):
        sent = [self.c, self.a, self.d, "TEST-PRT-DOES-NOT-EXIST", self.a, self.b]
        self.assertEqual(
            pi.porter_invoice_files(sent),
            [f"/private/files/{self.b}.pdf", f"/private/files/{self.a}.pdf", f"/private/files/{self.c}.pdf"],
        )
        self.assertEqual(pi.porter_invoice_files([]), [])
        self.assertEqual(pi.porter_invoice_files([self.d]), [])

    def test_the_job_merges_each_invoice_once_end_to_end(self):
        fetched = []
        with patch.object(bd, "_fetch_attachment_content", side_effect=lambda url: fetched.append(url)):
            bd.download_selected_porter_invoices(names=frappe.as_json([self.c, self.a, self.a, self.b]), all_scope="1", download_id="porter-job-0001")
            job = {k: v for k, v in self.enqueued[-1].items() if k not in ("queue", "timeout")}
            bd.run_bulk_download_job(**job)
        self.assertEqual(fetched, [f"/private/files/{self.b}.pdf", f"/private/files/{self.a}.pdf", f"/private/files/{self.c}.pdf"])

    # --- 3. Report Bulk Download only, Admin / Accountant only -------------------------------------------------

    def test_the_download_queues_the_all_scope_job(self):
        bd.download_selected_porter_invoices(names=frappe.as_json([self.a]), all_scope="1")
        job = self.enqueued[0]
        self.assertEqual((job["doc_type"], job["all_scope"], job["custom_filename"], job["timeout"]),
                         (bd.PORTER_INVOICES, 1, "All_Projects_Selected_Porter_Invoices.pdf", bd.ALL_SCOPE_TIMEOUT_SECONDS))
        self.assertNotIn("project", job)
        self.assertNotIn("vendor", job)

    def test_refused_outside_report_bulk_download_and_above_the_limit(self):
        for flag in (None, "0", ""):
            with self.assertRaises(frappe.ValidationError, msg=repr(flag)):
                bd.download_selected_porter_invoices(names=frappe.as_json([self.a]), all_scope=flag)
        # Through the HTTP call path a project is not even a parameter, so it is dropped and refused the same.
        with self.assertRaises(frappe.ValidationError):
            frappe.call(bd.download_selected_porter_invoices, names=frappe.as_json([self.a]), project="P-X")
        with self.assertRaises(frappe.ValidationError):
            bd.download_selected_porter_invoices(names=frappe.as_json([f"X-{i}" for i in range(501)]), all_scope=1)
        for empty in ("[]", "", "not json"):
            with self.assertRaises(frappe.ValidationError):
                bd.download_selected_porter_invoices(names=empty, all_scope=1)
        with self.assertRaises(frappe.ValidationError):
            bd.download_selected_attachments(attachment_names='["/private/files/x.pdf"]', doc_type=bd.PORTER_INVOICES, all_scope=1)
        self.assertEqual(self.enqueued, [])

    def test_another_profile_is_refused_on_the_download_and_in_the_job(self):
        user = self._as_profile("Nirmaan Project Manager Profile")
        frappe.set_user(user)
        with self.assertRaises(frappe.PermissionError):
            bd.download_selected_porter_invoices(names=frappe.as_json([self.a]), all_scope=1)
        frappe.set_user("Administrator")
        with patch.object(bd, "_fetch_attachment_content") as fetch:
            bd.run_bulk_download_job(doc_type=bd.PORTER_INVOICES, names=frappe.as_json([self.a]), all_scope=1, user=user, download_id="porter-job-0002")
            fetch.assert_not_called()
        self.assertEqual([e for e, _ in self.events], ["bulk_download_failed"])
        self.assertIn("do not have access", self.events[0][1]["message"])

    def test_a_project_scope_never_yields_a_porter_pdf(self):
        project = frappe.db.sql('''select project from "tabProcurement Orders" group by project order by count(*) desc limit 1''')[0][0]
        with patch.object(bd, "_fetch_attachment_content") as fetch:
            bd.run_bulk_download_job(doc_type=bd.PORTER_INVOICES, project=project, names=frappe.as_json([self.a]), user="Administrator", download_id="porter-job-0003")
            bd.run_bulk_download_job(doc_type=bd.PORTER_INVOICES, project=project, user="Administrator", download_id="porter-job-0004")
            fetch.assert_not_called()  # with or without invoice numbers: a project run merges no Porter PDF
        self.assertEqual([e for e, _ in self.events], ["bulk_download_failed", "bulk_download_failed"])
