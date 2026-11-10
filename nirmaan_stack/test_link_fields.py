# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A pasted outside link of any real length is stored whole in each of the five link fields (#1680).

THE BUG THIS EXISTS TO PREVENT
    The five fields were Data fields, which hold 140 characters. A Google Drive link with its sharing parameters
    runs past that, and stored values were found cut at 138 characters, ending in `&`: a link that no longer opens.

Each test saves its parent the way the field's screen does (the Projects doc for Drive links and Customer POs,
the tracker doc for Design Tracker and Commission Report tasks, `save_bill` for Project Billing), with a made-up
link of more than 200 characters, then reads the stored value back.

Run:  devenv.sh test --module nirmaan_stack.test_link_fields
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.project_billing.bills import save_bill

# A made-up Drive link of 230 characters, shaped like a shared folder link with its resource key and parameters.
LONG_LINK = (
    "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"
    "?resourcekey=0-ZyXwVuTsRqPoNmLkJiHgFe&usp=sharing&authuser=0"
    "&ouid=000000000000000000000&rtpof=true&sd=true&pli=1&made_up=for_tests_only"
)


class TestLinkFieldsHoldLongLinks(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        assert len(LONG_LINK) > 200, len(LONG_LINK)
        cls._made = []  # (doctype, name), deleted in reverse order

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        for doctype, name in reversed(cls._made):
            try:
                frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
                frappe.db.commit()
            except Exception as e:  # report, do not strand the rest
                frappe.db.rollback()
                print(f"test_link_fields: could not delete {doctype} {name}: {e}")
        super().tearDownClass()

    def _keep(self, doctype, name):
        self._made.append((doctype, name))

    def _project(self):
        doc = frappe.new_doc("Projects")
        doc.project_name = f"TEST_LINKS_{frappe.generate_hash(length=6)}"
        doc.project_start_date = frappe.utils.now()[:19]
        doc.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
        doc.project_scopes = {"scopes": []}
        doc.tendering_status = "Won"  # a billing tracker refuses a project that is not Won
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        self._keep("Projects", doc.name)
        return doc

    def test_a_project_drive_link_is_stored_whole(self):
        project = self._project()
        project.append("drive_links", {"drive_name": "Site photos", "drive_link": LONG_LINK})
        project.save(ignore_permissions=True)

        stored = frappe.get_all(
            "Project Drive Link Child Table", filters={"parent": project.name}, pluck="drive_link"
        )
        self.assertEqual(stored, [LONG_LINK])

    def test_a_customer_po_link_is_stored_whole(self):
        project = self._project()
        project.append(
            "customer_po_details",
            {"customer_po_number": "TEST-CPO-1", "customer_po_link": LONG_LINK},
        )
        project.save(ignore_permissions=True)

        stored = frappe.get_all(
            "Customer PO Child Table", filters={"parent": project.name}, pluck="customer_po_link"
        )
        self.assertEqual(stored, [LONG_LINK])

    def test_a_design_tracker_task_file_link_is_stored_whole(self):
        tracker = frappe.new_doc("Project Design Tracker")
        tracker.project_name = f"TEST_LINKS_{frappe.generate_hash(length=6)}"
        tracker.append(
            "design_tracker_task",
            {"task_name": "Made-up layout", "task_status": "Submitted", "file_link": LONG_LINK},
        )
        tracker.insert(ignore_permissions=True)
        self._keep("Project Design Tracker", tracker.name)

        stored = frappe.get_all(
            "Design Tracker Task Child Table", filters={"parent": tracker.name}, pluck="file_link"
        )
        self.assertEqual(stored, [LONG_LINK])

    def test_a_commission_report_task_file_link_is_stored_whole(self):
        report = frappe.new_doc("Project Commission Report")
        report.project_name = f"TEST_LINKS_{frappe.generate_hash(length=6)}"
        report.append(
            "commission_report_task",
            {"task_name": "Made-up test", "task_status": "Client Accepted", "file_link": LONG_LINK},
        )
        report.insert(ignore_permissions=True)
        self._keep("Project Commission Report", report.name)

        stored = frappe.get_all(
            "Commission Report Task Child Table", filters={"parent": report.name}, pluck="file_link"
        )
        self.assertEqual(stored, [LONG_LINK])

    def _billing_tracker(self):
        project = self._project()
        package = frappe.get_doc(
            {"doctype": "Project Billing Packages", "package_name": f"TEST LINKS {frappe.generate_hash(length=6)}"}
        ).insert(ignore_permissions=True)
        self._keep("Project Billing Packages", package.name)
        tracker = frappe.get_doc(
            {
                "doctype": "Project Billing Tracker",
                "project": project.name,
                "package": package.name,
                "po_value": 1000,
            }
        ).insert(ignore_permissions=True)
        self._keep("Project Billing Tracker", tracker.name)
        return tracker

    def test_a_bill_document_link_is_stored_whole(self):
        tracker = self._billing_tracker()
        bill = save_bill(
            {"billing_tracker": tracker.name, "bill_type": "NA", "status": "NA", "bill_document_link": LONG_LINK}
        )
        self._keep("Project Billing", bill["name"])

        self.assertEqual(frappe.db.get_value("Project Billing", bill["name"], "bill_document_link"), LONG_LINK)

    def test_a_bill_document_link_without_a_scheme_is_refused(self):
        # As a Data field with options URL, Frappe refused a link with no `https://`; Small Text checks nothing, so
        # the bill keeps that check itself. A link with no scheme would open inside the app as a relative path.
        tracker = self._billing_tracker()
        with self.assertRaises(frappe.ValidationError):
            save_bill(
                {
                    "billing_tracker": tracker.name,
                    "bill_type": "NA",
                    "status": "NA",
                    "bill_document_link": LONG_LINK.removeprefix("https://"),
                }
            )
        self.assertFalse(frappe.db.exists("Project Billing", {"billing_tracker": tracker.name}))
