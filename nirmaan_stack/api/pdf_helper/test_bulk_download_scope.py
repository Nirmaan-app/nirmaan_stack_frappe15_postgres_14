# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the vendor scope of Bulk Download (`bulk_download._scope` and friends).

The same endpoints serve the project page's Bulk Download tab and the vendor page's. What must
hold:

  1. EXACTLY ONE SCOPE. Both or neither of `project` / `vendor` is refused before anything is
     queued.
  2. A VENDOR'S LISTS ARE THE VENDOR'S DOCUMENTS, in the order the PDF merges them -- checked
     against independent SQL, not against the code under test.
  3. A VENDOR SPANS PROJECTS, SO THE VENDOR LISTS RESPECT USER PERMISSIONS. Fetching an attachment
     checks nothing, so a user held to one project by a User Permission row must get only that
     project's documents. The project scope keeps its `get_all` (unchanged).
  4. CLIENT INVOICES ARE PROJECT-ONLY (Project Invoices carry no vendor).

The project scope's equivalence with the code before this change was proved separately, path by
path, against the old module (DIFF: 0); these tests pin the vendor side.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Everything here reads live rows; the only writes are the
restricted test user (a bare `User`, its `Has Role` and `User Permission` rows), inserted with
`db_insert` and never committed: tearDown rolls back, then deletes by the generated user name as a
backstop. Nothing is enqueued -- `frappe.enqueue` is replaced for every test.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.pdf_helper import bulk_download as bd

PO_EXCLUDED_STATUSES = ("Merged", "Cancelled", "PO Amendment", "Inactive")


def _sql_list(query, *values):
    return [r[0] for r in frappe.db.sql(query, values)]


def _first(query, values=()):
    rows = frappe.db.sql(query, values)
    return rows[0][0] if rows else None


class TestBulkDownloadScope(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Live vendors chosen for exactly what each test needs, so the suite follows the data. A kind
        # of vendor this site does not have leaves its tests SKIPPED with the reason (`_need`), never
        # failed: a missing precondition is not a regression.
        cls.material_vendor = _first(
            """select po.vendor from "tabProcurement Orders" po where po.status not in %s
            and exists (select 1 from "tabPO Delivery Documents" d where d.vendor = po.vendor
                        and d.parent_doctype = 'Procurement Orders' and d.type = 'Delivery Challan'
                        and coalesce(d.nirmaan_attachment, '') <> '')
            group by po.vendor having count(distinct po.project) >= 2
            order by count(distinct po.project) desc, count(*) desc limit 1""",
            (PO_EXCLUDED_STATUSES,),
        )
        cls.service_vendor = _first(
            """select vendor from "tabService Requests" where status = 'Approved'
            group by vendor order by count(*) desc limit 1"""
        )

    def _need(self, vendor, what):
        if not vendor:
            self.skipTest(f"this site has no vendor {what}")
        return vendor

    @property
    def material(self):
        return self._need(self.material_vendor, "with live POs in 2+ projects and a DC")

    @property
    def service(self):
        return self._need(self.service_vendor, "with approved Work Orders")

    def setUp(self):
        self.enqueued = []
        enqueue = patch.object(frappe, "enqueue", side_effect=lambda method, **kw: self.enqueued.append(kw))
        enqueue.start()
        self.addCleanup(enqueue.stop)
        self.users = []

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        for user in self.users:
            frappe.db.delete("User Permission", {"user": user})
            frappe.db.delete("Has Role", {"parent": user, "parenttype": "User"})
            frappe.db.delete("User", {"name": user})
            frappe.cache.hdel("user_permissions", user)
            frappe.cache.hdel("roles", user)
        frappe.db.commit()

    def _restricted_user(self, roles, projects):
        """A throwaway user with `roles`, held to `projects` by User Permission rows. Written with
        `db_insert` (a normal insert runs our Nirmaan Users / User Permission hooks) and never
        committed."""
        user = f"bulk-scope-{frappe.generate_hash(length=8)}@example.com"
        self.users.append(user)
        now = frappe.utils.now()

        def insert(doc, name):
            doc.name = name
            doc.creation = doc.modified = now
            doc.owner = doc.modified_by = "Administrator"
            doc.db_insert()

        insert(frappe.get_doc({"doctype": "User", "email": user, "first_name": "Bulk scope test", "enabled": 1,
                               "user_type": "System User", "send_welcome_email": 0}), user)
        for i, role in enumerate(roles):
            row = frappe.get_doc({"doctype": "Has Role", "role": role, "parent": user, "parenttype": "User",
                                  "parentfield": "roles", "idx": i + 1})
            insert(row, frappe.generate_hash(length=10))
        for project in projects:
            insert(frappe.get_doc({"doctype": "User Permission", "user": user, "allow": "Projects", "for_value": project}),
                   f"bulk-scope-{frappe.generate_hash(length=10)}")
        frappe.cache.hdel("user_permissions", user)
        frappe.cache.hdel("roles", user)
        return user

    # --- 1. exactly one scope -------------------------------------------------------------------

    def test_both_or_neither_scope_is_refused_before_anything_is_queued(self):
        project = frappe.db.get_value("Procurement Orders", {"vendor": self.material}, "project")
        for kwargs in ({}, {"project": project, "vendor": self.material}):
            with self.assertRaises(frappe.ValidationError):
                bd.download_all_pos(**kwargs)
            with self.assertRaises(frappe.ValidationError):
                bd.download_selected_dns(names="[]", **kwargs)
        self.assertEqual(self.enqueued, [])

    def test_file_is_named_after_the_vendor_and_the_job_carries_the_vendor_only(self):
        bd.download_all_wos(vendor=self.service, with_rate=0)
        job = self.enqueued[0]
        name = frappe.db.get_value("Vendors", self.service, "vendor_name")
        self.assertEqual(job["custom_filename"], f"{name}_All_WOs.pdf")
        self.assertEqual(job["vendor"], self.service)
        self.assertNotIn("project", job)

    # --- 2. the vendor's lists, against independent SQL ------------------------------------------

    def test_vendor_document_lists_match_sql(self):
        v = self.material
        self.assertEqual(
            bd._all_doc_names("PO", "vendor", v),
            _sql_list("""select name from "tabProcurement Orders" where vendor = %s and status not in %s
                order by creation asc""", v, PO_EXCLUDED_STATUSES),
        )
        self.assertEqual(
            bd._all_doc_names("DN", "vendor", v),
            _sql_list("""select name from "tabProcurement Orders" where vendor = %s
                and status in ('Delivered', 'Partially Delivered', 'Partially Dispatched') order by creation asc""", v),
        )
        self.assertEqual(
            bd._all_doc_names("WO", "vendor", self.service),
            _sql_list("""select name from "tabService Requests" where vendor = %s and status = 'Approved'
                order by creation asc""", self.service),
        )

    def test_vendor_attachment_lists_match_sql(self):
        v = self.material
        invoices = """select invoice_attachment from "tabVendor Invoices" where vendor = %s and status = 'Approved'
            and coalesce(invoice_attachment, '') <> '' {} order by creation asc"""
        self.assertEqual(bd._all_attachments("All Invoices", "vendor", v), _sql_list(invoices.format(""), v))
        self.assertEqual(
            bd._all_attachments("PO Invoices", "vendor", v),
            _sql_list(invoices.format("and document_type = 'Procurement Orders'"), v),
        )
        for doc_type, pdd_type in (("DC", "Delivery Challan"), ("MIR", "Material Inspection Report")):
            self.assertEqual(
                bd._all_attachments(doc_type, "vendor", v),
                _sql_list("""select nirmaan_attachment from "tabPO Delivery Documents" where vendor = %s
                    and parent_doctype = 'Procurement Orders' and type = %s and coalesce(nirmaan_attachment, '') <> ''
                    order by creation asc""", v, pdd_type),
                doc_type,
            )
        self.assertTrue(bd._all_attachments("DC", "vendor", v), "the chosen vendor should have DCs to compare")

    # --- 3. user permissions -----------------------------------------------------------------------

    def test_a_project_scoped_user_gets_only_their_projects_documents_from_a_vendor(self):
        v = self.material
        project = frappe.db.sql("""select project from "tabProcurement Orders" where vendor = %s and status not in %s
            group by project order by count(*) desc limit 1""", (v, PO_EXCLUDED_STATUSES))[0][0]
        everything = bd._all_doc_names("PO", "vendor", v)
        own = _sql_list("""select name from "tabProcurement Orders" where vendor = %s and project = %s
            and status not in %s order by creation asc""", v, project, PO_EXCLUDED_STATUSES)
        own_dcs = _sql_list("""select nirmaan_attachment from "tabPO Delivery Documents" where vendor = %s and project = %s
            and parent_doctype = 'Procurement Orders' and type = 'Delivery Challan' and coalesce(nirmaan_attachment, '') <> ''
            order by creation asc""", v, project)

        frappe.set_user(self._restricted_user(["Nirmaan Project Lead"], [project]))
        self.assertEqual(bd._all_doc_names("PO", "vendor", v), own)
        self.assertEqual(bd._all_attachments("DC", "vendor", v), own_dcs)
        self.assertLess(len(own), len(everything), "the vendor should span more than this one project")

    def test_a_user_who_cannot_read_the_doctype_gets_a_failure_event_not_a_silent_hang(self):
        user = self._restricted_user([], [])
        published = []
        with patch.object(frappe, "publish_realtime", side_effect=lambda event, data, **kw: published.append((event, data))):
            bd.run_bulk_download_job(doc_type="PO", vendor=self.material, user=user)
        self.assertEqual([e for e, _ in published], ["bulk_download_failed"])
        self.assertIn("do not have access", published[0][1]["message"])

    # --- 4. client invoices are project-only ---------------------------------------------------------

    def test_client_invoices_are_refused_for_a_vendor(self):
        with self.assertRaises(frappe.ValidationError):
            bd.download_project_attachments(doc_type="Client Invoices", vendor=self.material)
        with self.assertRaises(frappe.ValidationError):
            bd.download_selected_attachments(attachment_names="[]", doc_type="Client Invoices", vendor=self.material)
        self.assertEqual(self.enqueued, [])
        self.assertEqual(bd._all_attachments("Client Invoices", "vendor", self.material), [])
