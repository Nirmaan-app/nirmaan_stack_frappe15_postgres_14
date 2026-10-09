# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for Material Test Certificates in Bulk Download (`bulk_download._mtc_files`,
`download_selected_mtcs`, and the vendor scope of `mtc_api.get_mtcs`).

What must hold:

  1. ONE ROW PER CERTIFICATE, OLDEST CERTIFICATE FIRST. A vendor's (or project's) certificates are
     exactly its MTCs, and the merged PDF takes them in certificate-date order.
  2. CERTIFICATES TRAVEL AS MTC NAMES, never file URLs. Only the given ones are merged, an empty
     selection is refused, and the file-URL endpoint refuses the type.
  3. THE MTC PAGE'S PROJECT RULE APPLIES. A PM / PL sees only their assigned projects, and NONE
     assigned means nothing -- stricter than Frappe's default. The rule itself is pinned by the MTC
     module's tests; here it is forced through `mtc_allowed_projects` to prove Bulk Download obeys it.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE, read-only: nothing is enqueued (`frappe.enqueue` replaced),
no file is fetched (`_fetch_attachment_content` replaced), events are captured. A site with no
MTCs skips these tests with the reason.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.material_test_certificates import mtc_api
from nirmaan_stack.api.pdf_helper import bulk_download as bd

ORDER = "order by certificate_date asc, creation asc"


def _sql_list(query, *values):
    return [r[0] for r in frappe.db.sql(query, values)]


class TestBulkDownloadMTC(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        row = frappe.db.sql(
            """select vendor, project from "tabMaterial Test Certificate" where coalesce(attachment, '') <> ''
            group by vendor, project order by count(*) desc limit 1"""
        )
        cls.vendor, cls.project = row[0] if row else (None, None)

    def setUp(self):
        if not self.vendor:
            self.skipTest("this site has no Material Test Certificate with a file")
        self.enqueued, self.events = [], []
        for target, attr, fn in (
            (frappe, "enqueue", lambda method, **kw: self.enqueued.append(kw)),
            (frappe, "publish_realtime", lambda event, data=None, **kw: event.startswith("bulk_download") and self.events.append((event, data))),
        ):
            p = patch.object(target, attr, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()

    # --- 1. the lists ----------------------------------------------------------------------------

    def test_a_vendors_certificates_are_its_mtcs_with_items_and_project_names(self):
        rows = mtc_api.get_mtcs(vendor=self.vendor)
        self.assertEqual(
            sorted(r["name"] for r in rows),
            sorted(_sql_list('''select name from "tabMaterial Test Certificate" where vendor = %s''', self.vendor)),
        )
        for r in rows:
            self.assertTrue(r["items"], r["name"])
            self.assertEqual(r["project_name"], frappe.db.get_value("Projects", r["project"], "project_name"))

    def test_get_mtcs_still_takes_exactly_one_scope(self):
        for kwargs in ({}, {"vendor": self.vendor, "project": self.project}, {"vendor": self.vendor, "procurement_order": "PO-X"}):
            with self.assertRaises(frappe.ValidationError, msg=str(kwargs)):
                mtc_api.get_mtcs(**kwargs)

    def test_the_merged_pdf_takes_certificates_oldest_first(self):
        for field, value in (("vendor", self.vendor), ("project", self.project)):
            self.assertEqual(
                bd._mtc_files(field, value),
                _sql_list(f'''select attachment from "tabMaterial Test Certificate"
                    where {field} = %s and coalesce(attachment, '') <> '' {ORDER}''', value),
                field,
            )

    def test_undated_certificates_merge_last_like_the_wizard_lists_them(self):
        # Older rows have no certificate_date. The wizard (`compareMtcs`) lists them last; the merge
        # must agree, or the screen and the PDF disagree about the order.
        dates = [frappe.db.get_value("Material Test Certificate", {"attachment": url}, "certificate_date")
                 for url in bd._mtc_files("vendor", self.vendor)]
        seen_undated = False
        for d in dates:
            if d is None:
                seen_undated = True
            else:
                self.assertFalse(seen_undated, f"a dated certificate merges after an undated one: {dates}")

    # --- 2. by MTC name ---------------------------------------------------------------------------

    def test_only_the_selected_certificates_are_merged(self):
        names = _sql_list(f'''select name from "tabMaterial Test Certificate" where vendor = %s {ORDER}''', self.vendor)
        picked = names[-1:]
        self.assertEqual(
            bd._mtc_files("vendor", self.vendor, picked),
            _sql_list('''select attachment from "tabMaterial Test Certificate" where name = %s''', picked[0]),
        )
        self.assertEqual(bd._mtc_files("vendor", self.vendor, []), [])
        other = frappe.db.get_value("Material Test Certificate", {"vendor": ["!=", self.vendor]}, "name")
        if other:
            self.assertEqual(bd._mtc_files("vendor", self.vendor, [other]), [])

    def test_the_endpoint_refuses_an_empty_selection_and_queues_names(self):
        for empty in ("[]", "", "not json"):
            with self.assertRaises(frappe.ValidationError):
                bd.download_selected_mtcs(names=empty, vendor=self.vendor)
        self.assertEqual(self.enqueued, [])
        out = bd.download_selected_mtcs(names='["MTC-X"]', vendor=self.vendor, download_id="mtc-download-01")
        job = self.enqueued[-1]
        self.assertEqual((job["doc_type"], job["names"], job["download_id"], out["download_id"]), (bd.MTCS, '["MTC-X"]', "mtc-download-01", "mtc-download-01"))
        self.assertTrue(job["custom_filename"].endswith("_Selected_MTCs.pdf"))

    def test_the_file_url_endpoint_refuses_mtcs(self):
        with self.assertRaises(frappe.ValidationError):
            bd.download_selected_attachments(attachment_names='["/files/x.png"]', doc_type=bd.MTCS, vendor=self.vendor)
        self.assertEqual(self.enqueued, [])

    def test_the_job_fetches_the_certificates_in_order_and_stamps_the_download_id(self):
        names = _sql_list(f'''select name from "tabMaterial Test Certificate" where vendor = %s {ORDER}''', self.vendor)
        fetched = []
        with patch.object(bd, "_fetch_attachment_content", side_effect=lambda url: fetched.append(url)):
            bd.run_bulk_download_job(doc_type=bd.MTCS, vendor=self.vendor, names=frappe.as_json(names), user="Administrator", download_id="mtc-job-0001")
        self.assertEqual(fetched, bd._mtc_files("vendor", self.vendor, names))
        self.assertTrue(self.events and all(d["download_id"] == "mtc-job-0001" for _, d in self.events))

    # --- 3. the MTC project rule ------------------------------------------------------------------

    def test_a_pm_with_no_projects_gets_nothing_and_one_with_projects_gets_only_those(self):
        with patch.object(bd, "mtc_allowed_projects", return_value=set()):
            self.assertEqual(bd._mtc_files("vendor", self.vendor), [])
            self.assertEqual(bd._mtc_files("project", self.project), [])
        with patch.object(bd, "mtc_allowed_projects", return_value={"SOME-OTHER-PROJECT"}):
            self.assertEqual(bd._mtc_files("project", self.project), [])
            self.assertEqual(bd._mtc_files("vendor", self.vendor), [])
        with patch.object(bd, "mtc_allowed_projects", return_value={self.project}):
            self.assertEqual(
                bd._mtc_files("vendor", self.vendor),
                _sql_list(f'''select attachment from "tabMaterial Test Certificate"
                    where vendor = %s and project = %s and coalesce(attachment, '') <> '' {ORDER}''', self.vendor, self.project),
            )
        with patch.object(mtc_api, "mtc_allowed_projects", return_value=set()):
            self.assertEqual(mtc_api.get_mtcs(vendor=self.vendor), [])
