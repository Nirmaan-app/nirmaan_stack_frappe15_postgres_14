# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the all scope of Bulk Download (Reports > Bulk Download, `all_scope=1`).

The tab lists every project's documents with no project or vendor picked first. What must hold:

  1. THE FLAG IS EXPLICIT. `all_scope` with neither project nor vendor is the all scope; with
     either it is refused; leaving out project, vendor AND the flag is still refused, so the old
     "exactly one scope" guard of the project and vendor tabs is unchanged.
  2. ONLY "SELECTED" DOWNLOADS. Every Selected endpoint takes the flag; no "download all"
     endpoint does (through the HTTP call path the flag is dropped and the guard refuses), and the
     job refuses an all-scope run without a list -- it would be every document of every project.
  3. AT MOST 500 ITEMS, in the all scope only (a project or vendor keeps no limit).
  4. THE USER'S PERMISSIONS ARE THE SCOPE. With no project or vendor filter, the read-back lists
     (PO / WO vouchers, MTCs) read with `get_list` as the user, so a user held to one project by
     User Permission gets nothing from another project, whatever names the browser sends.
  5. `get_mtcs(all_projects=1)` lists every certificate the user may see, items attached.
  6. ADMIN AND ACCOUNTANT ONLY (owner, 2026-10-28; Accountant Lead mirrors Accountant). Every all-scope
     endpoint, the job and `get_mtcs(all_projects=1)` refuse every other profile -- the tab's hiding is
     not the only gate.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Reads live rows; the only writes are the throwaway
restricted users (the scope suite's `_restricted_user`: bare `User`, `Has Role`, `User Permission`
via `db_insert`, never committed), removed in tearDown. Nothing is enqueued (`frappe.enqueue` is
replaced) and no file is fetched.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.material_test_certificates import mtc_api
from nirmaan_stack.api.pdf_helper import bulk_download as bd
from nirmaan_stack.api.pdf_helper import test_bulk_download_scope as scope_suite
from nirmaan_stack.services import role_profiles

SELECTED_CALLS = (
    (bd.download_selected_pos, {"names": '["PO-X"]', "with_rate": 0}, "Selected_POs"),
    (bd.download_selected_wos, {"names": '["WO-X"]'}, "Selected_WOs"),
    (bd.download_selected_dns, {"names": '["PO-X"]'}, "Selected_DNs"),
    (bd.download_selected_wo_payment_vouchers, {"names": '["PAY-X"]'}, "Selected_WO_Payment_Vouchers"),
    (bd.download_selected_po_payment_vouchers, {"names": '["PAY-X"]'}, "Selected_PO_Payment_Vouchers"),
    (bd.download_selected_mtcs, {"names": '["MTC-X"]'}, "Selected_MTCs"),
    (bd.download_selected_attachments, {"attachment_names": '["/files/x.pdf"]', "doc_type": "All Invoices"}, "Selected_All_Invoices"),
    # Client invoices belong to projects, so the all scope (unlike a vendor) may take them.
    (bd.download_selected_attachments, {"attachment_names": '["/files/x.pdf"]', "doc_type": "Client Invoices"}, "Selected_Client_Invoices"),
)


def _sql_list(query, *values):
    return [r[0] for r in frappe.db.sql(query, values)]


def _names(n):
    return frappe.as_json([f"X-{i}" for i in range(n)])


class TestBulkDownloadAllScope(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Two projects with Paid PO payments, and two with Paid WO payments that have a voucher:
        # what the permission tests need. A site without them SKIPS those tests (`_need`).
        cls.po_pay_projects = _sql_list(
            """select project from "tabProject Payments" where document_type = 'Procurement Orders' and status = 'Paid'
            group by project order by count(*) desc limit 2"""
        )
        # A project and a vendor that have POs: the scope tests only need ids that exist.
        cls.project = _sql_list(
            """select project from "tabProcurement Orders" group by project order by count(*) desc limit 1"""
        )[0]
        cls.vendor = _sql_list(
            """select vendor from "tabProcurement Orders" group by vendor order by count(*) desc limit 1"""
        )[0]
        cls.wo_pay_projects = _sql_list(
            """select project from "tabProject Payments" where document_type = 'Service Requests' and status = 'Paid'
            and coalesce(voucher_attachment, '') <> '' group by project order by count(*) desc limit 2"""
        )

    def setUp(self):
        self.enqueued, self.events, self.users = [], [], []
        for target, attr, fn in (
            (frappe, "enqueue", lambda method, **kw: self.enqueued.append(kw)),
            (frappe, "publish_realtime", lambda event, data=None, **kw: event.startswith("bulk_download") and self.events.append((event, data))),
        ):
            p = patch.object(target, attr, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)

    # The scope suite's teardown and throwaway-user helper, shared rather than copied.
    tearDown = scope_suite.TestBulkDownloadScope.tearDown
    _restricted_user = scope_suite.TestBulkDownloadScope._restricted_user

    def _need(self, rows, what):
        if len(rows) < 2:
            self.skipTest(f"this site has no two projects {what}")
        return rows

    # --- 1. the flag ------------------------------------------------------------------------------

    def test_the_all_scope_is_an_explicit_flag_with_neither_project_nor_vendor(self):
        for flag in (1, "1", True, "true", "TRUE", "yes"):
            self.assertEqual(bd._scope(all_scope=flag), (None, None, bd.ALL_SCOPE_LABEL), flag)
        project, vendor = self.project, self.vendor
        for kwargs in ({"project": project}, {"vendor": vendor}, {"project": project, "vendor": vendor}):
            with self.assertRaises(frappe.ValidationError, msg=str(kwargs)):
                bd._scope(all_scope=1, **kwargs)
        # Off in every spelling a form or a caller might send: back to "exactly one", which refuses neither.
        for flag in (None, 0, "0", "", "false", "no"):
            with self.assertRaises(frappe.ValidationError, msg=repr(flag)):
                bd._scope(all_scope=flag)

    # --- 2. Selected endpoints only ------------------------------------------------------------------

    def test_every_selected_endpoint_queues_the_all_scope_with_no_project_or_vendor(self):
        for fn, kwargs, file_part in SELECTED_CALLS:
            self.enqueued.clear()
            fn(all_scope="1", **kwargs)
            job = self.enqueued[0]
            self.assertEqual(job["all_scope"], 1, fn.__name__)
            self.assertNotIn("project", job, fn.__name__)
            self.assertNotIn("vendor", job, fn.__name__)
            self.assertEqual(job["custom_filename"], f"All_Projects_{file_part}.pdf")
            self.assertEqual(job["timeout"], bd.ALL_SCOPE_TIMEOUT_SECONDS, fn.__name__)

    def test_the_project_scope_keeps_its_own_timeout_and_no_flag(self):
        bd.download_selected_pos(names='["PO-X"]', project=self.project)
        job = self.enqueued[0]
        self.assertEqual(job["project"], self.project)
        self.assertNotIn("all_scope", job)
        self.assertIsNone(job["timeout"])

    def test_no_download_all_endpoint_takes_the_all_scope(self):
        # Through `frappe.call` -- the HTTP path -- an argument the function does not take is
        # dropped, so the endpoint sees neither scope and refuses.
        for fn, kwargs in (
            (bd.download_all_pos, {}),
            (bd.download_all_wos, {}),
            (bd.download_all_dns, {}),
            (bd.download_project_attachments, {"doc_type": "All Invoices"}),
            (bd.download_project_attachments, {"doc_type": bd.PO_PAYMENT_VOUCHERS}),
        ):
            with self.assertRaises(frappe.ValidationError, msg=fn.__name__):
                frappe.call(fn, all_scope="1", **kwargs)
        self.assertEqual(self.enqueued, [])

    def test_the_job_refuses_an_all_scope_run_without_a_list(self):
        for doc_type in ("PO", "DN", bd.WO_PAYMENT_VOUCHERS, bd.PO_PAYMENT_VOUCHERS, bd.MTCS, "All Invoices"):
            self.events.clear()
            with patch.object(bd, "_fetch_attachment_content") as fetch, patch.object(frappe, "get_print") as get_print:
                bd.run_bulk_download_job(doc_type=doc_type, all_scope=1, user="Administrator", download_id="all-scope-0001")
                fetch.assert_not_called()
                get_print.assert_not_called()
            self.assertEqual([e for e, _ in self.events], ["bulk_download_failed"], doc_type)
            self.assertIn("Select the documents", self.events[0][1]["message"])

    # --- 3. the limit ----------------------------------------------------------------------------------

    def test_at_most_500_items_in_the_all_scope(self):
        self.assertEqual(bd.ALL_SCOPE_MAX_ITEMS, 500)  # = ALL_SCOPE_MAX_ITEMS in bulkDownloadTypes.ts
        bd.download_selected_pos(names=_names(500), all_scope=1)
        self.assertEqual(len(self.enqueued), 1)
        for fn, kwargs in (
            (bd.download_selected_pos, {"names": _names(501)}),
            (bd.download_selected_po_payment_vouchers, {"names": _names(501)}),
            (bd.download_selected_attachments, {"attachment_names": _names(501), "doc_type": "DC"}),
        ):
            with self.assertRaises(frappe.ValidationError, msg=fn.__name__) as raised:
                fn(all_scope=1, **kwargs)
            self.assertIn("up to 500", str(raised.exception))
        for empty in ("[]", "", "not json"):
            with self.assertRaises(frappe.ValidationError):
                bd.download_selected_pos(names=empty, all_scope=1)
        self.assertEqual(len(self.enqueued), 1)

    def test_a_project_or_vendor_keeps_no_limit(self):
        bd.download_selected_pos(names=_names(501), project=self.project)
        self.assertEqual(len(self.enqueued), 1)

    # --- 4. the user's permissions are the scope -------------------------------------------------------------

    def test_po_vouchers_keep_only_paid_po_payments_of_the_selection_in_payment_order(self):
        projects = self._need(self.po_pay_projects, "with paid PO payments")
        paid = _sql_list("""select name from "tabProject Payments" where document_type = 'Procurement Orders'
            and status = 'Paid' and project in %s order by payment_date desc limit 4""", tuple(projects))
        not_paid = _sql_list("""select name from "tabProject Payments" where document_type = 'Procurement Orders'
            and status <> 'Paid' limit 1""")
        wo_paid = _sql_list("""select name from "tabProject Payments" where document_type = 'Service Requests'
            and status = 'Paid' limit 1""")
        got = bd._po_voucher_payments(None, None, paid + not_paid + wo_paid + ["PAY-DOES-NOT-EXIST"])
        expected = _sql_list("""select name from "tabProject Payments" where name in %s
            order by payment_date asc, creation asc""", tuple(paid))
        self.assertEqual(got, expected)
        self.assertEqual(bd._po_voucher_payments(None, None, []), [])

    def test_a_project_scoped_user_gets_only_their_projects_vouchers_whatever_names_are_sent(self):
        po_projects = self._need(self.po_pay_projects, "with paid PO payments")
        own, other = po_projects
        own_pay = _sql_list("""select name from "tabProject Payments" where document_type = 'Procurement Orders'
            and status = 'Paid' and project = %s order by payment_date asc, creation asc limit 3""", own)
        other_pay = _sql_list("""select name from "tabProject Payments" where document_type = 'Procurement Orders'
            and status = 'Paid' and project = %s limit 3""", other)

        user = self._restricted_user(["Nirmaan Project Lead"], [own])
        frappe.set_user(user)
        got = bd._po_voucher_payments(None, None, own_pay + other_pay)
        self.assertEqual(sorted(got), sorted(own_pay))
        self.assertTrue(own_pay and other_pay)

        wo_projects = self.wo_pay_projects
        if len(wo_projects) == 2:
            frappe.set_user("Administrator")
            wo_rows = frappe.db.sql("""select name, voucher_attachment, project from "tabProject Payments"
                where document_type = 'Service Requests' and status = 'Paid' and coalesce(voucher_attachment, '') <> ''
                and project in %s order by payment_date asc, creation asc""", (tuple(wo_projects),))
            wo_user = self._restricted_user(["Nirmaan Project Lead"], [wo_projects[0]])
            frappe.set_user(wo_user)
            got = bd._wo_voucher_files(None, None, [r[0] for r in wo_rows])
            self.assertEqual(got, [r[1] for r in wo_rows if r[2] == wo_projects[0]])

    def test_mtcs_follow_the_mtc_project_rule_in_the_all_scope(self):
        rows = frappe.db.sql("""select name, attachment, project from "tabMaterial Test Certificate"
            where coalesce(attachment, '') <> '' order by certificate_date asc, creation asc""")
        if not rows:
            self.skipTest("this site has no Material Test Certificate with a file")
        names = [r[0] for r in rows]
        self.assertEqual(bd._mtc_files(None, None, names), [r[1] for r in rows])
        one = rows[0][2]
        with patch.object(bd, "mtc_allowed_projects", return_value={one}):
            self.assertEqual(bd._mtc_files(None, None, names), [r[1] for r in rows if r[2] == one])
        with patch.object(bd, "mtc_allowed_projects", return_value=set()):
            self.assertEqual(bd._mtc_files(None, None, names), [])

    def test_the_job_runs_the_all_scope_end_to_end(self):
        rows = frappe.db.sql("""select name, voucher_attachment from "tabProject Payments"
            where document_type = 'Service Requests' and status = 'Paid' and coalesce(voucher_attachment, '') <> ''
            order by payment_date asc, creation asc limit 2""")
        if len(rows) < 2:
            self.skipTest("this site has no two paid WO payments with a voucher")
        fetched = []
        with patch.object(bd, "_fetch_attachment_content", side_effect=lambda url: fetched.append(url)):
            bd.download_selected_wo_payment_vouchers(names=frappe.as_json([r[0] for r in reversed(rows)]), all_scope="1", download_id="all-scope-0002")
            job = {k: v for k, v in self.enqueued[-1].items() if k not in ("queue", "timeout")}
            bd.run_bulk_download_job(**job)
        self.assertEqual(fetched, [r[1] for r in rows])  # payment order, not the order sent

    # --- 5. get_mtcs(all_projects=1) ----------------------------------------------------------------------

    def test_get_mtcs_lists_every_certificate_with_its_items(self):
        expected = _sql_list('''select name from "tabMaterial Test Certificate" order by creation desc''')
        rows = mtc_api.get_mtcs(all_projects=1)
        self.assertEqual([r["name"] for r in rows], expected)
        for r in rows:
            by_project = {x["name"]: x for x in mtc_api.get_mtcs(project=r["project"])}
            self.assertEqual(r["items"], by_project[r["name"]]["items"], r["name"])
            self.assertEqual(r["procurement_request"], by_project[r["name"]]["procurement_request"], r["name"])

    def test_get_mtcs_all_projects_follows_the_project_rule_and_takes_no_other_scope(self):
        rows = mtc_api.get_mtcs(all_projects="1")
        if rows:
            one = rows[0]["project"]
            with patch.object(mtc_api, "mtc_allowed_projects", return_value={one}):
                self.assertEqual({r["project"] for r in mtc_api.get_mtcs(all_projects=1)}, {one})
            with patch.object(mtc_api, "mtc_allowed_projects", return_value=set()):
                self.assertEqual(mtc_api.get_mtcs(all_projects=1), [])
        for kwargs in ({"all_projects": 1, "project": "P-X"}, {"all_projects": 1, "vendor": "V-X"}, {"all_projects": "0"}):
            with self.assertRaises(frappe.ValidationError, msg=str(kwargs)):
                mtc_api.get_mtcs(**kwargs)

    # --- 6. Admin and Accountant only -----------------------------------------------------------------------

    def _as_profile(self, profile):
        """A throwaway user whose role profile reads as `profile` (the profile lives on a Nirmaan Users row,
        which the bare test user has not got, so the lookup is answered here)."""
        user = self._restricted_user([], [])
        real = role_profiles.get_role_profile
        p = patch.object(role_profiles, "get_role_profile", side_effect=lambda u: profile if u == user else real(u))
        p.start()
        self.addCleanup(p.stop)
        frappe.set_user(user)
        return user

    def test_every_other_profile_is_refused_by_every_all_scope_call(self):
        refused = ("Nirmaan PMO Executive Profile", "Nirmaan Project Manager Profile", "Nirmaan Project Lead Profile",
                   "Nirmaan Procurement Executive Profile", "Nirmaan Procurement Lead Profile", "Nirmaan Estimates Executive Profile",
                   "Nirmaan Sales Executive Profile", None)
        for profile in refused:
            self._as_profile(profile)
            for fn, kwargs, _part in SELECTED_CALLS:
                with self.assertRaises(frappe.PermissionError, msg=f"{profile} {fn.__name__}"):
                    fn(all_scope="1", **kwargs)
            with self.assertRaises(frappe.PermissionError, msg=f"{profile} get_mtcs"):
                mtc_api.get_mtcs(all_projects=1)
            frappe.set_user("Administrator")
        self.assertEqual(self.enqueued, [])

    def test_admin_accountant_and_accountant_lead_may_use_it(self):
        for profile in ("Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Accountant Lead Profile"):
            self.enqueued.clear()
            self._as_profile(profile)
            bd.download_selected_pos(names='["PO-X"]', all_scope="1")
            self.assertEqual(len(self.enqueued), 1, profile)
            # The gate get_mtcs(all_projects=1) runs first (the bare test user has no doctype read
            # permission of its own, so the list itself is not read here).
            role_profiles.assert_reports_bulk_download_access(frappe.session.user)
            frappe.set_user("Administrator")

    def test_the_job_refuses_a_user_who_may_not_use_the_all_scope(self):
        user = self._as_profile("Nirmaan Project Manager Profile")
        frappe.set_user("Administrator")
        with patch.object(frappe, "get_print") as get_print:
            bd.run_bulk_download_job(doc_type="PO", names='["PO-X"]', all_scope=1, user=user, download_id="all-scope-0003")
            get_print.assert_not_called()
        self.assertEqual([e for e, _ in self.events], ["bulk_download_failed"])
        self.assertIn("do not have access", self.events[0][1]["message"])

    def test_the_project_and_vendor_tabs_keep_their_own_rules(self):
        # A PM may still use the project tab: the new gate is the all scope's alone.
        self._as_profile("Nirmaan Project Manager Profile")
        bd.download_selected_pos(names='["PO-X"]', project=self.project)
        bd.download_selected_pos(names='["PO-X"]', vendor=self.vendor)
        self.assertEqual(len(self.enqueued), 2)
