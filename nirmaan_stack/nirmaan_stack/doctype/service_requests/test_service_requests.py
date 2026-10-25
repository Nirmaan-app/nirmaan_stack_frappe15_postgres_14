# Copyright (c) 2024, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""GST follows the vendor (ADR-0028 Amendment A, #1538): approval and an accepted amendment that changed
the vendor set the GST flag from the vendor's GST number; no save changes it by hand. Approval also fills a
blank Nirmaan GST from the project. The only other way the flag moves, Match GST to vendor, and the GST
payment guard it meets are in `api/service_requests/test_match_gst_to_vendor`.

Run:  bench --site localhost run-tests --module nirmaan_stack.nirmaan_stack.doctype.service_requests.test_service_requests

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Rows are planted with the GST Hold test fixture (`TEST-GSTH-*`)
and purged after each test. The approval notifications hook is patched out: it inserts a Nirmaan
Notification per real Procurement / Accountant / Admin user and commits each one.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.vendor.test_gst_hold import U, _Fixture

SR = "Service Requests"
NOTIFY_ON_UPDATE = "nirmaan_stack.integrations.controllers.service_requests.on_update"


class TestGstFromVendorOnApproval(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user(U)
        self.fx = _Fixture()
        self.addCleanup(self.fx.purge)
        self.project = self.fx.project()

    def _approve(self, vendor, *, gst="true"):
        """Plant a Vendor Selected WO of Rs 1,00,000 and approve it with a real save."""
        name = self.fx.work_order(self.project, vendor, 100_000, gst=gst, status="Vendor Selected")
        doc = frappe.get_doc(SR, name)
        doc.status = "Approved"
        with patch(NOTIFY_ON_UPDATE):
            doc.save()
        return frappe.db.get_value(SR, name, ["gst", "total_amount"], as_dict=True)

    def test_a_vendor_with_a_gst_number_is_approved_gst_on(self):
        sr = self._approve(self.fx.vendor(gst_number="29AADCU7527Q1ZG"), gst="false")
        self.assertEqual((sr.gst, flt(sr.total_amount)), ("true", 118_000))

    def test_a_vendor_without_a_gst_number_is_approved_gst_off(self):
        sr = self._approve(self.fx.vendor())
        self.assertEqual((sr.gst, flt(sr.total_amount)), ("false", 100_000))

    def test_a_blank_gst_number_counts_as_none(self):
        sr = self._approve(self.fx.vendor(gst_number="   "))
        self.assertEqual(sr.gst, "false")

    def test_amendment_approval_with_no_history_leaves_gst_alone(self):
        v = self.fx.vendor(gst_number="29AADCU7527Q1ZG")
        name = self.fx.work_order(self.project, v, 100_000, gst="false", status="Amendment")
        doc = frappe.get_doc(SR, name)
        doc.status = "Approved"
        with patch(NOTIFY_ON_UPDATE):
            doc.save()
        self.assertEqual(frappe.db.get_value(SR, name, "gst"), "false")

    def test_approval_fills_a_blank_nirmaan_gst_from_the_project(self):
        frappe.db.set_value("Projects", self.project, "project_gst", "29ABFCS9095N1Z9")
        name = self.fx.work_order(self.project, self.fx.vendor(), 100_000, status="Vendor Selected")
        doc = frappe.get_doc(SR, name)
        doc.update({"status": "Approved", "project_gst": ""})  # what the approve screens send for a blank
        with patch(NOTIFY_ON_UPDATE):
            doc.save()
        self.assertEqual(frappe.db.get_value(SR, name, "project_gst"), "29ABFCS9095N1Z9")

    def test_approval_keeps_a_nirmaan_gst_already_chosen(self):
        frappe.db.set_value("Projects", self.project, "project_gst", "29ABFCS9095N1Z9")
        name = self.fx.work_order(self.project, self.fx.vendor(), 100_000, status="Vendor Selected")
        doc = frappe.get_doc(SR, name)
        doc.update({"status": "Approved", "project_gst": "06ABFCS9095N1ZH"})
        with patch(NOTIFY_ON_UPDATE):
            doc.save()
        self.assertEqual(frappe.db.get_value(SR, name, "project_gst"), "06ABFCS9095N1ZH")


class TestGstFromVendorOnAcceptedAmendment(FrappeTestCase):
    """An accepted amendment that changed the vendor sets the flag from the new vendor; one that kept
    the vendor, or a revert back to it, leaves the flag alone (an old WO never changes by itself)."""

    def setUp(self):
        super().setUp()
        frappe.set_user(U)
        self.fx = _Fixture()
        self.addCleanup(self.fx.purge)
        # The Approved -> Amendment save writes the amendment snapshot (`controllers/nirmaan_versions`).
        self.addCleanup(lambda: frappe.db.delete("Nirmaan Versions", {"docname": ("in", self.fx.srs)}))
        self.project = self.fx.project()
        self.gst_vendor = self.fx.vendor(gst_number="29AADCU7527Q1ZG")
        self.no_gst_vendor = self.fx.vendor()

    def _save(self, name, **changes):
        doc = frappe.get_doc(SR, name)
        doc.update(changes)
        with patch(NOTIFY_ON_UPDATE):
            # The amend sheet's save is versioned in the app; Frappe skips Version rows in tests by default.
            doc.save(ignore_version=False)
        return frappe.db.get_value(SR, name, ["gst", "total_amount"], as_dict=True)

    def test_accepting_a_vendor_change_sets_gst_from_the_new_vendor(self):
        wo = self.fx.work_order(self.project, self.no_gst_vendor, 100_000, gst="false")
        self._save(wo, vendor=self.gst_vendor, status="Amendment")
        sr = self._save(wo, status="Approved")
        self.assertEqual((sr.gst, flt(sr.total_amount)), ("true", 118_000))

    def test_accepting_a_change_to_a_vendor_without_a_gst_number_sets_gst_off(self):
        wo = self.fx.work_order(self.project, self.gst_vendor, 100_000, gst="true")
        self._save(wo, vendor=self.no_gst_vendor, status="Amendment")
        sr = self._save(wo, status="Approved")
        self.assertEqual((sr.gst, flt(sr.total_amount)), ("false", 100_000))

    def test_accepting_an_amendment_that_kept_the_vendor_leaves_gst_alone(self):
        # GST-off although the vendor has a GST number: an old WO, left for Match GST to vendor.
        wo = self.fx.work_order(self.project, self.gst_vendor, 100_000, gst="false")
        self._save(wo, status="Amendment", notes={"list": [{"id": "1", "note": "scope"}]})
        self.assertEqual(self._save(wo, status="Approved").gst, "false")

    def test_reverting_a_vendor_change_leaves_gst_alone(self):
        wo = self.fx.work_order(self.project, self.gst_vendor, 100_000, gst="false")
        self._save(wo, vendor=self.no_gst_vendor, status="Amendment")
        # Revert puts the old vendor back in the same save that returns it to Approved.
        self.assertEqual(self._save(wo, vendor=self.gst_vendor, status="Approved").gst, "false")


class TestGstFlagIsLocked(FrappeTestCase):
    """The GST flag can't be changed by hand: the page switch, Desk and the REST API all save the doc."""

    def setUp(self):
        super().setUp()
        frappe.set_user(U)
        self.fx = _Fixture()
        self.addCleanup(self.fx.purge)
        self.project = self.fx.project()

    def _save(self, wo, **changes):
        doc = frappe.get_doc(SR, wo)
        doc.update(changes)
        with patch(NOTIFY_ON_UPDATE):
            doc.save()
        return frappe.db.get_value(SR, wo, ["gst", "total_amount"], as_dict=True)

    def test_switching_on_by_hand_is_refused(self):
        # Even towards the vendor: only Match GST to vendor may move an existing WO.
        wo = self.fx.work_order(self.project, self.fx.vendor(gst_number="29AADCU7527Q1ZG"), 100_000, gst="false")
        with self.assertRaisesRegex(frappe.ValidationError, "Match GST to vendor"):
            self._save(wo, gst="true")
        self.assertEqual(frappe.db.get_value(SR, wo, "gst"), "false")

    def test_switching_off_by_hand_is_refused(self):
        wo = self.fx.work_order(self.project, self.fx.vendor(), 100_000, gst="true")
        with self.assertRaisesRegex(frappe.ValidationError, "Match GST to vendor"):
            self._save(wo, gst="false")
        self.assertEqual(frappe.db.get_value(SR, wo, "gst"), "true")

    def test_switching_by_hand_is_refused_through_an_amendment_too(self):
        wo = self.fx.work_order(self.project, self.fx.vendor(), 100_000, gst="true")
        with self.assertRaises(frappe.ValidationError):
            self._save(wo, gst="false", status="Amendment")

    def test_a_save_that_leaves_gst_alone_passes(self):
        wo = self.fx.work_order(self.project, self.fx.vendor(), 100_000, gst="true")
        sr = self._save(wo, project_gst="29ABFCS9095N1Z9")
        self.assertEqual((sr.gst, flt(sr.total_amount)), ("true", 118_000))


class TestEveryApprovalSetsGstAndNirmaanGst(FrappeTestCase):
    """Any save that approves a Work Order (`work_order_lifecycle.is_approval`) sets the GST flag from the
    vendor, fills a blank Nirmaan GST and stamps the approval: from Rejected or Created too, and a Work
    Order inserted already Approved through Desk or REST."""

    def setUp(self):
        super().setUp()
        frappe.set_user(U)
        self.fx = _Fixture()
        self.addCleanup(self.fx.purge)
        self.project = self.fx.project()
        frappe.db.set_value("Projects", self.project, "project_gst", "29ABFCS9095N1Z9")
        self.vendor = self.fx.vendor(gst_number="29AADCU7527Q1ZG")

    def _stored(self, name):
        return frappe.db.get_value(SR, name, ["gst", "project_gst", "approved_on", "total_amount"], as_dict=True)

    def assertApprovedFromTheVendor(self, sr):
        self.assertEqual((sr.gst, sr.project_gst, flt(sr.total_amount)), ("true", "29ABFCS9095N1Z9", 118_000))
        self.assertIsNotNone(sr.approved_on)

    def test_approving_from_rejected_or_created(self):
        for status in ("Rejected", "Created"):
            with self.subTest(status=status):
                name = self.fx.work_order(self.project, self.vendor, 100_000, gst="false", status=status)
                doc = frappe.get_doc(SR, name)
                doc.status = "Approved"
                with patch(NOTIFY_ON_UPDATE):
                    doc.save()
                self.assertApprovedFromTheVendor(self._stored(name))

    def test_inserting_an_approved_work_order(self):
        doc = frappe.get_doc({
            "doctype": SR, "project": self.project, "vendor": self.vendor, "status": "Approved", "gst": "false",
            "work_order_items": [{"item_name": "Test work", "category": "Test", "uom": "Nos",
                                  "quantity": 1, "rate": 100_000}],
        })
        with patch(NOTIFY_ON_UPDATE):
            doc.insert()
        self.fx.srs.append(doc.name)
        self.assertApprovedFromTheVendor(self._stored(doc.name))
