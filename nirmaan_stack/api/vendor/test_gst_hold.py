# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""GST Hold (ADR-0028): the daily job, the new-WO guard and the Admin removal.

Run:  bench --site localhost run-tests --module nirmaan_stack.api.vendor.test_gst_hold

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every row planted here is `TEST-GSTH-*` and is purged after
each test (`remove_gst_hold` commits, so a rollback alone would not clean up). The job's two
all-vendor reads (totals, vendors on hold) are filtered to the fixtures: unfiltered, it would put
every real qualifying vendor on GST Hold, and the purge's commit would make that permanent.
"""

from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, getdate, now_datetime

from nirmaan_stack.api.service_requests import vendor_fy_limit
from nirmaan_stack.api.vendor.gst_hold import remove_gst_hold
from nirmaan_stack.integrations.controllers import service_requests as sr_controller
from nirmaan_stack.services.wo_vendor_limit import financial_year_bounds
from nirmaan_stack.tasks import vendor_gst_hold as job

PREFIX = "TEST-GSTH-"
U = "Administrator"
SR = "Service Requests"


class _Fixture:
    def __init__(self):
        self.projects, self.vendors, self.srs = [], [], []

    def _name(self, kind):
        return f"{PREFIX}{kind}-{frappe.generate_hash(length=8)}"

    def project(self):
        name = self._name("PROJ")
        frappe.db.sql(
            """INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner, docstatus, idx,
                   project_name, status, tendering_status)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 'Created', 'Won')""",
            (name, U, U, name),
        )
        self.projects.append(name)
        return name

    def vendor(self, *, gst_number="", held=0, vendor_type="Service"):
        name = self._name("VEN")
        frappe.db.sql(
            """INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner, docstatus, idx,
                   vendor_name, vendor_type, vendor_gst, gst_hold)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s)""",
            (name, U, U, name, vendor_type, gst_number, held),
        )
        self.vendors.append(name)
        return name

    def work_order(self, project, vendor, amount, *, gst="false", status="Approved", created=None):
        """One WO with one line of `amount`. `total_amount` is stored the way the controller would."""
        name = self._name("SR")
        created = created or now_datetime()
        total = flt(amount) * (1.18 if gst == "true" else 1)
        frappe.db.sql(
            """INSERT INTO "tabService Requests" (name, creation, modified, modified_by, owner, docstatus,
                   idx, project, vendor, status, gst, total_amount, amount_paid)
               VALUES (%s, %s, %s, %s, %s, 0, 0, %s, %s, %s, %s, %s, 0)""",
            (name, created, created, U, U, project, vendor, status, gst, total),
        )
        frappe.db.sql(
            """INSERT INTO "tabWork Order Items" (name, creation, modified, modified_by, owner, docstatus,
                   idx, parent, parenttype, parentfield, item_name, category, uom, quantity, rate)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 1, %s, 'Service Requests', 'work_order_items',
                   'Test work', 'Test', 'Nos', 1, %s)""",
            (self._name("WOI"), U, U, name, flt(amount)),
        )
        self.srs.append(name)
        return name

    def purge(self):
        if self.srs:
            frappe.db.delete("Work Order Items", {"parent": ("in", self.srs)})
            frappe.db.delete("Version", {"ref_doctype": SR, "docname": ("in", self.srs)})
            frappe.db.delete(SR, {"name": ("in", self.srs)})
        if self.vendors:
            frappe.db.delete("Comment", {"reference_doctype": "Vendors", "reference_name": ("in", self.vendors)})
            frappe.db.delete("Vendors", {"name": ("in", self.vendors)})
        if self.projects:
            frappe.db.delete("Projects", {"name": ("in", self.projects)})
        frappe.db.commit()


def _hold(vendor):
    return frappe.db.get_value("Vendors", vendor, "gst_hold")


def _last_fy():
    return financial_year_bounds(getdate())[0] - timedelta(days=10)


class GstHoldTestCase(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user(U)
        self.fx = _Fixture()
        self.addCleanup(self.fx.purge)
        self.project = self.fx.project()

    @contextmanager
    def _job_sees_only_fixtures(self):
        """Keep the real all-vendor reads, but hand the job only this test's vendors."""
        real_totals, real_held = vendor_fy_limit.vendor_fy_totals, job.held_vendors
        mine = set(self.fx.vendors)
        with patch.object(job, "vendor_fy_totals", lambda: {v: t for v, t in real_totals().items() if v in mine}), \
             patch.object(job, "held_vendors", lambda: [v for v in real_held() if v in mine]):
            yield


class TestCountedWorkOrders(GstHoldTestCase):
    def test_only_gst_off_not_rejected_this_fy_counts(self):
        v = self.fx.vendor()
        self.fx.work_order(self.project, v, 1_000_000)
        self.fx.work_order(self.project, v, 400_000, status="Rejected")
        self.fx.work_order(self.project, v, 300_000, gst="true")
        self.fx.work_order(self.project, v, 700_000, created=_last_fy())

        self.assertEqual(vendor_fy_limit.vendor_fy_totals()[v], 1_000_000)
        summary = vendor_fy_limit.vendor_fy_wo_total(v)
        self.assertEqual((summary["total"], summary["wo_count"]), (1_000_000, 1))


class TestDailyJob(GstHoldTestCase):
    def _run_job(self):
        with self._job_sees_only_fixtures():
            return job.update_gst_holds()

    def test_exactly_the_limit_is_not_held_one_rupee_over_is(self):
        at_limit, over = self.fx.vendor(), self.fx.vendor()
        self.fx.work_order(self.project, at_limit, 1_500_000)
        self.fx.work_order(self.project, over, 1_000_000)
        self.fx.work_order(self.project, over, 500_001)

        self.assertEqual(self._run_job(), {"held": [over]})
        self.assertEqual((_hold(at_limit), _hold(over)), (0, 1))

    def test_only_service_and_material_and_service_vendors_are_held(self):
        service = self.fx.vendor(vendor_type="Service")
        both = self.fx.vendor(vendor_type="Material & Service")
        material = self.fx.vendor(vendor_type="Material")
        for v in (service, both, material):
            self.fx.work_order(self.project, v, 2_000_000)

        self.assertEqual(self._run_job(), {"held": sorted([service, both])})
        self.assertEqual((_hold(service), _hold(both), _hold(material)), (1, 1, 0))

    def test_a_vendor_with_a_gst_number_is_never_held(self):
        v = self.fx.vendor(gst_number="29ABCDE1234F1Z5")
        self.fx.work_order(self.project, v, 2_000_000)
        self.assertEqual(self._run_job(), {"held": []})
        self.assertEqual(_hold(v), 0)

    def test_a_blank_gst_number_counts_as_none(self):
        v = self.fx.vendor(gst_number="   ")
        self.fx.work_order(self.project, v, 2_000_000)
        self.assertEqual(self._run_job(), {"held": [v]})

    def test_last_years_wos_do_not_put_a_vendor_on_hold(self):
        v = self.fx.vendor()
        self.fx.work_order(self.project, v, 2_000_000, created=_last_fy())
        self.assertEqual(self._run_job(), {"held": []})
        self.assertEqual(_hold(v), 0)

    # The job never releases (owner, 19/09/2026) -- only an Admin does. Each case below was a release
    # before that ruling; each now proves the hold survives the run.

    def test_a_held_vendor_back_under_the_limit_stays_held(self):
        v = self.fx.vendor(held=1)
        self.fx.work_order(self.project, v, 1_500_000)
        self.assertEqual(self._run_job(), {"held": []})
        self.assertEqual(_hold(v), 1)

    def test_a_held_vendor_still_over_the_limit_stays_held(self):
        v = self.fx.vendor(held=1)
        self.fx.work_order(self.project, v, 1_600_000)
        self.assertEqual(self._run_job(), {"held": []})
        self.assertEqual(_hold(v), 1)

    def test_a_held_vendor_with_no_counted_wo_stays_held(self):
        v = self.fx.vendor(held=1)
        self.fx.work_order(self.project, v, 2_000_000, gst="true")
        self._run_job()
        self.assertEqual(_hold(v), 1)

    def test_a_hold_carries_into_the_new_financial_year(self):
        v = self.fx.vendor(held=1)
        self.fx.work_order(self.project, v, 2_000_000, created=_last_fy())
        self._run_job()
        self.assertEqual(_hold(v), 1)

    def test_a_held_vendor_that_gets_a_gst_number_stays_held(self):
        v = self.fx.vendor(held=1, gst_number="29ABCDE1234F1Z5")
        self.fx.work_order(self.project, v, 2_000_000)
        self._run_job()
        self.assertEqual(_hold(v), 1)

    def test_a_material_vendor_held_by_hand_stays_held(self):
        v = self.fx.vendor(held=1, vendor_type="Material")
        self.fx.work_order(self.project, v, 2_000_000)
        self._run_job()
        self.assertEqual(_hold(v), 1)


class TestNewWorkOrderGuard(GstHoldTestCase):
    def test_a_new_wo_for_a_held_vendor_is_refused(self):
        held = self.fx.vendor(held=1)
        doc = frappe.new_doc(SR)
        doc.update({"project": self.project, "vendor": held})
        with self.assertRaises(frappe.ValidationError):
            sr_controller.validate(doc, "validate")

    def test_a_new_wo_for_a_vendor_not_on_hold_passes(self):
        doc = frappe.new_doc(SR)
        doc.update({"project": self.project, "vendor": self.fx.vendor()})
        sr_controller.validate(doc, "validate")

    def test_editing_an_existing_wo_of_a_held_vendor_passes(self):
        held = self.fx.vendor(held=1)
        existing = frappe.get_doc(SR, self.fx.work_order(self.project, held, 1000))
        sr_controller.validate(existing, "validate")


class TestRemoveGstHold(GstHoldTestCase):
    def test_only_an_admin_can_remove(self):
        v = self.fx.vendor(gst_number="29ABCDE1234F1Z5", held=1)
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                remove_gst_hold(v)
        finally:
            frappe.set_user(U)
        self.assertEqual(_hold(v), 1)

    def test_a_vendor_without_a_gst_number_is_refused_and_nothing_changes(self):
        v = self.fx.vendor(held=1)
        wo = self.fx.work_order(self.project, v, 100_000)
        with self.assertRaises(frappe.ValidationError):
            remove_gst_hold(v)
        self.assertEqual(_hold(v), 1)
        self.assertEqual(frappe.db.get_value(SR, wo, "gst"), "false")

    def test_a_vendor_not_on_hold_is_refused(self):
        v = self.fx.vendor(gst_number="29ABCDE1234F1Z5")
        with self.assertRaises(frappe.ValidationError):
            remove_gst_hold(v)

    def test_switches_this_years_approved_wos_skips_the_rest_and_clears_the_hold(self):
        v = self.fx.vendor(gst_number="29ABCDE1234F1Z5", held=1)
        approved = self.fx.work_order(self.project, v, 100_000)
        in_amendment = self.fx.work_order(self.project, v, 50_000, status="Amendment")
        last_year = self.fx.work_order(self.project, v, 70_000, created=_last_fy())

        result = remove_gst_hold(v)

        self.assertEqual(result, {"switched": [approved], "skipped": [in_amendment]})
        self.assertEqual(frappe.db.get_value(SR, approved, "gst"), "true")
        self.assertEqual(flt(frappe.db.get_value(SR, approved, "total_amount")), 118_000)
        self.assertEqual(frappe.db.get_value(SR, in_amendment, "gst"), "false")
        self.assertEqual(frappe.db.get_value(SR, last_year, "gst"), "false")
        self.assertEqual(_hold(v), 0)
        self.assertTrue(frappe.db.exists("Comment", {"reference_doctype": "Vendors", "reference_name": v}))
