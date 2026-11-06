# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""GST Payment Request: an Accountant approves a Work Order's GST before any payment exists.

Tries to break it: every way a GST payment could be born without the Accountant, asking for the same GST
twice, approving twice, and a rejection freeing exactly what it held.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Work Orders, projects and vendors are planted by
`TaxedWorkOrderFixture` (`TEST-TWO-*`); the requests on them are purged here, and the naming series
counter is put back as it was. Pushes are stubbed; bell rows sit on the fixture's projects and go with them.
"""

import json
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.payments.gst_payment_requests import (
    approve_gst_payment_request,
    delete_gst_payment_request,
    get_gst_payment_requests,
    reject_gst_payment_request,
    request_gst_payment,
)
from nirmaan_stack.api.payments.project_payments import create_payment_request_for_service
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.integrations.controllers.service_requests import (
    validate_gst_not_switched_off_with_gst_payments,
)
from nirmaan_stack.services import gst_payment_requests as gpr
from nirmaan_stack.services.order_payments import work_order_summary
from nirmaan_stack.services.role_profiles import ACCOUNTANT_PROFILE, PROJECT_MANAGER_PROFILE

PAYMENT = "Project Payments"
SR = "Service Requests"
U = "Administrator"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"
PUSH = "nirmaan_stack.integrations.Notifications.pr_notifications.send_firebase_notification"


class TestGstPaymentRequests(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.addCleanup(self._purge_requests)
        # No push, no realtime event and no auto-approve fan-out reaches the real users on the live site.
        for target in (PUSH, "frappe.publish_realtime", f"{CONTROLLER}._notify_admins_auto_approved"):
            quiet = patch(target)
            quiet.start()
            self.addCleanup(quiet.stop)
        self.project = self.fx.project()
        self.vendor = self.fx.vendor(2.0)
        self.pm = self._user(PROJECT_MANAGER_PROFILE)
        self.accountant = self._user(ACCOUNTANT_PROFILE)

    def tearDown(self):
        frappe.set_user(U)

    # -- fixtures -------------------------------------------------------------------------------
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.series_key = f"GPR-{frappe.utils.nowdate()[2:4]}-"
        # Raw SQL: `tabSeries` has no `modified`, which `get_value` / `set_value` order and stamp by.
        row = frappe.db.sql('SELECT "current" FROM "tabSeries" WHERE name = %s', cls.series_key)
        cls.series_before = row[0][0] if row else None

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        if cls.series_before is None:
            frappe.db.delete("Series", {"name": cls.series_key})
        else:
            frappe.db.sql('UPDATE "tabSeries" SET "current" = %s WHERE name = %s', (cls.series_before, cls.series_key))
        frappe.db.commit()
        super().tearDownClass()

    def _purge_requests(self):
        frappe.db.rollback()
        try:
            names = frappe.get_all(gpr.DOCTYPE, filters={"work_order": ["in", self.fx.service_requests or [""]]},
                                   pluck="name")
            if names:
                frappe.db.delete("Version", {"ref_doctype": gpr.DOCTYPE, "docname": ["in", names]})
                frappe.db.delete("Nirmaan Notifications", {"docname": ["in", names]})
                frappe.db.delete(gpr.DOCTYPE, {"name": ["in", names]})
            frappe.db.commit()
        except Exception as e:  # report, never strand the rest of the clean-up
            frappe.db.rollback()
            print(f"GST request purge failed: {e}")

    def _user(self, profile):
        user = frappe.db.get_value("Nirmaan Users", {"role_profile": profile}, "name")
        if not user or not frappe.db.exists("User", user):
            self.skipTest(f"no {profile} user on this site")
        perm = frappe.get_doc({"doctype": "User Permission", "user": user, "allow": "Projects",
                               "for_value": self.project}).insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(self._remove_permission, perm.name)
        return user

    @staticmethod
    def _remove_permission(name):
        frappe.db.rollback()
        frappe.delete_doc("User Permission", name, force=True, ignore_permissions=True, ignore_missing=True)
        frappe.db.commit()

    def _wo(self, total=118000, gst_invoiced=18000):
        """Base 1,00,000 + GST 18,000, all of it invoiced and approved unless said otherwise."""
        return self.fx.service_request(self.project, self.vendor, total=total, gst=True, gst_invoiced=gst_invoiced)

    def _as(self, user, fn, *args, **kwargs):
        frappe.set_user(user)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user(U)

    def _ask(self, sr, amount, user=None):
        return self._as(user or self.pm, request_gst_payment, sr, amount)["name"]

    def _approve(self, name):
        return self._as(self.accountant, approve_gst_payment_request, name)

    def _gst_left(self, sr):
        return work_order_summary(frappe.get_doc(SR, sr))["limit"]["gst_left"]

    def _payments(self, sr):
        return frappe.db.count(PAYMENT, {"document_type": SR, "document_name": sr})

    # -- no GST payment without the Accountant --------------------------------------------------
    def test_a_request_creates_no_payment(self):
        sr = self._wo()
        name = self._ask(sr, 10000)
        req = frappe.get_doc(gpr.DOCTYPE, name)
        self.assertEqual((req.status, req.owner, flt(req.amount), req.vendor), (gpr.PENDING, self.pm, 10000, self.vendor))
        self.assertEqual(self._payments(sr), 0)

    def test_request_payment_refuses_gst_from_a_non_accountant(self):
        sr = self._wo()
        payload = json.dumps({"doctype": SR, "docname": sr, "amount": 5000, "is_gst_payment": 1})
        with self.assertRaisesRegex(frappe.ValidationError, "approved in GST Requests first"):
            self._as(self.pm, create_payment_request_for_service, payload)
        self.assertEqual(self._payments(sr), 0)

    def test_a_hand_made_gst_payment_is_refused_for_a_non_accountant(self):
        sr = self._wo()
        pay = frappe.get_doc({"doctype": PAYMENT, "document_type": SR, "document_name": sr, "project": self.project,
                              "vendor": self.vendor, "amount": 5000, "status": "Paid", "is_gst_payment": 1})
        with self.assertRaisesRegex(frappe.ValidationError, "approved in GST Requests first"):
            self._as(self.pm, pay.insert)
        frappe.db.rollback()
        self.assertEqual(self._payments(sr), 0)

    def test_a_request_is_never_written_by_hand(self):
        sr = self._wo()
        name = self._ask(sr, 10000)
        req = frappe.get_doc(gpr.DOCTYPE, name)
        req.status = gpr.APPROVED
        with self.assertRaises(gpr.GstRequestRefused):
            req.save(ignore_permissions=True)
        frappe.db.rollback()
        with self.assertRaises(gpr.GstRequestRefused):
            frappe.get_doc({"doctype": gpr.DOCTYPE, "work_order": sr, "amount": 1, "status": gpr.PENDING}).insert(
                ignore_permissions=True)
        frappe.db.rollback()

    def test_only_a_decider_approves_or_rejects(self):
        name = self._ask(self._wo(), 10000)
        with self.assertRaises(frappe.PermissionError):
            self._as(self.pm, approve_gst_payment_request, name)
        with self.assertRaises(frappe.PermissionError):
            self._as(self.pm, reject_gst_payment_request, name, "no")
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, "status"), gpr.PENDING)

    # -- the same GST is never asked for twice -------------------------------------------------
    def test_only_the_remaining_gst_can_be_asked_for(self):
        sr = self._wo()
        self._ask(sr, 10000)
        self.assertEqual(self._gst_left(sr), 8000)
        with self.assertRaisesRegex(frappe.ValidationError, r"GST left.*waiting for the Accountant"):
            self._ask(sr, 18000)
        self._ask(sr, 8000)
        self.assertEqual(self._gst_left(sr), 0)
        with self.assertRaisesRegex(frappe.ValidationError, "GST left"):
            self._ask(sr, 11)  # past the ₹10 tolerance

    def test_a_rejection_frees_exactly_its_amount(self):
        sr = self._wo()
        self._ask(sr, 10000)
        second = self._ask(sr, 8000)
        self._as(self.accountant, reject_gst_payment_request, second, "Invoice GST is wrong")
        req = frappe.get_doc(gpr.DOCTYPE, second)
        self.assertEqual((req.status, req.reviewed_by, req.review_comment),
                         (gpr.REJECTED, self.accountant, "Invoice GST is wrong"))
        self.assertEqual(self._gst_left(sr), 8000)
        with self.assertRaisesRegex(frappe.ValidationError, "GST left"):
            self._ask(sr, 8011)
        self._ask(sr, 8000)

    def test_a_rejection_needs_a_reason(self):
        name = self._ask(self._wo(), 10000)
        with self.assertRaisesRegex(frappe.ValidationError, "reason"):
            self._as(self.accountant, reject_gst_payment_request, name, "  ")

    # -- the approval ---------------------------------------------------------------------------
    def test_approval_creates_the_payment_as_the_requester(self):
        sr = self._wo()
        name = self._ask(sr, 10000)
        out = self._approve(name)
        pay = frappe.get_doc(PAYMENT, out["project_payment"])
        self.assertEqual((pay.owner, pay.is_gst_payment, flt(pay.amount), pay.status, pay.auto_approved),
                         (self.pm, 1, 10000, "Approved", 1))  # below ₹15,000: auto-approved, as any payment
        req = frappe.get_doc(gpr.DOCTYPE, name)
        self.assertEqual((req.status, req.project_payment, req.reviewed_by), (gpr.APPROVED, pay.name, self.accountant))
        self.assertEqual(self._gst_left(sr), 8000)  # the payment holds what the request held, once

    def test_approval_routes_by_amount(self):
        sr = self._wo(total=236000, gst_invoiced=36000)
        out = self._approve(self._ask(sr, 20000))
        self.assertEqual(out["payment_status"], "Requested")  # ₹15,000 to ₹50,000: L1

    def test_a_request_is_approved_once(self):
        sr = self._wo()
        name = self._ask(sr, 10000)
        self._approve(name)
        with self.assertRaisesRegex(frappe.ValidationError, "already approved"):
            self._approve(name)
        self.assertEqual(self._payments(sr), 1)

    def test_approval_pays_exactly_the_amount_asked(self):
        sr = self._wo()
        out = self._approve(self._ask(sr, 10000))
        self.assertEqual(flt(frappe.db.get_value(PAYMENT, out["project_payment"], "amount")), 10000)
        self.assertEqual(self._gst_left(sr), 8000)

    def test_approval_rechecks_the_gst_left(self):
        sr = self._wo()
        name = self._ask(sr, 10000)
        frappe.db.set_value(SR, sr, "gst_invoiced", 5000, update_modified=False)  # an invoice was rejected
        frappe.db.commit()
        with self.assertRaisesRegex(frappe.ValidationError, "GST left"):
            self._approve(name)
        self.assertEqual((frappe.db.get_value(gpr.DOCTYPE, name, "status"), self._payments(sr)), (gpr.PENDING, 0))

    def test_only_an_accountant_raises_a_gst_payment_afterwards(self):
        sr = self._wo(total=236000, gst_invoiced=36000)
        pay = frappe.get_doc(PAYMENT, self._approve(self._ask(sr, 20000))["project_payment"])  # Requested
        pay.amount = 21000
        with self.assertRaisesRegex(frappe.ValidationError, "Only an Accountant may raise"):
            self._as(self.pm, pay.save)
        frappe.db.rollback()

    # -- the Work Order -------------------------------------------------------------------------
    def test_gst_cannot_go_off_while_a_request_waits(self):
        sr = self._wo()
        name = self._ask(sr, 10000)
        doc = SimpleNamespace(name=sr, gst="false", get_doc_before_save=lambda: SimpleNamespace(gst="true"))
        with self.assertRaisesRegex(frappe.ValidationError, name):
            validate_gst_not_switched_off_with_gst_payments(doc)

    # -- the rows the screens list --------------------------------------------------------------
    def test_the_rows_carry_the_vendor_and_the_names(self):
        sr = self._wo()
        first = self._ask(sr, 10000)
        second = self._ask(sr, 5000)
        self._as(self.accountant, reject_gst_payment_request, second, "Wrong figure")
        rows = {r["name"]: r for r in self._as(self.accountant, get_gst_payment_requests, work_order=sr)}
        self.assertEqual(set(rows), {first, second})
        self.assertEqual((rows[first]["vendor_name"], rows[first]["status"], rows[second]["review_comment"]),
                         (self.vendor, gpr.PENDING, "Wrong figure"))
        self.assertEqual(rows[first]["raised_by_name"], frappe.utils.get_fullname(self.pm) or self.pm)
        pending = self._as(self.accountant, get_gst_payment_requests, status=gpr.PENDING)
        self.assertIn(first, [r["name"] for r in pending])
        self.assertNotIn(second, [r["name"] for r in pending])

    # -- deleting --------------------------------------------------------------------------------
    def test_only_a_decider_deletes_and_only_pending_or_rejected(self):
        sr = self._wo()
        pending = self._ask(sr, 5000)
        with self.assertRaises(frappe.PermissionError):
            self._as(self.pm, delete_gst_payment_request, pending)
        self._as(self.accountant, delete_gst_payment_request, pending)
        self.assertFalse(frappe.db.exists(gpr.DOCTYPE, pending))
        rejected = self._ask(sr, 5000)
        self._as(self.accountant, reject_gst_payment_request, rejected, "Wrong figure")
        self._as(self.accountant, delete_gst_payment_request, rejected)
        self.assertFalse(frappe.db.exists(gpr.DOCTYPE, rejected))
        approved = self._ask(sr, 5000)
        self._approve(approved)
        with self.assertRaisesRegex(frappe.ValidationError, "goes only with its payment"):
            self._as(self.accountant, delete_gst_payment_request, approved)
        frappe.db.rollback()
        self.assertTrue(frappe.db.exists(gpr.DOCTYPE, approved))

    def test_deleting_the_payment_deletes_its_request_and_frees_the_gst(self):
        sr = self._wo()
        name = self._ask(sr, 10000)
        pay = self._approve(name)["project_payment"]
        frappe.delete_doc(PAYMENT, pay, ignore_permissions=True)
        frappe.db.commit()
        self.assertFalse(frappe.db.exists(PAYMENT, pay))
        self.assertFalse(frappe.db.exists(gpr.DOCTYPE, name))
        self.assertEqual(self._gst_left(sr), 18000)

    # -- the request follows its payment ---------------------------------------------------------
    def _move(self, pay, status):
        doc = frappe.get_doc(PAYMENT, pay)
        doc.status = status
        doc.save(ignore_permissions=True)
        frappe.db.commit()

    def test_paid_only_while_its_payment_is_paid(self):
        sr = self._wo()
        name = self._ask(sr, 10000)
        pay = self._approve(name)["project_payment"]  # auto-approved: Approved
        self._move(pay, "Reconciliation Pending")
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, "status"), gpr.APPROVED)
        self._move(pay, "Paid")
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, "status"), gpr.PAID)
        self._move(pay, "Reconciliation Pending")  # un-reconciled
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, "status"), gpr.APPROVED)

    def test_a_payment_l1_rejects_leaves_its_request_approved(self):
        sr = self._wo(total=236000, gst_invoiced=36000)
        name = self._ask(sr, 20000)
        pay = self._approve(name)["project_payment"]  # Requested: L1
        self._move(pay, "Rejected")
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, "status"), gpr.APPROVED)
        self.assertEqual(self._gst_left(sr), 16000)  # the rejected payment still holds it, until deleted

    # -- a decider's own GST payment ------------------------------------------------------------
    def test_an_accountants_own_gst_waits_in_gst_requests_too(self):
        sr = self._wo()
        payload = json.dumps({"doctype": SR, "docname": sr, "amount": 5000, "is_gst_payment": 1})
        with self.assertRaisesRegex(frappe.ValidationError, "approved in GST Requests first"):
            self._as(self.accountant, create_payment_request_for_service, payload)
        name = self._ask(sr, 5000, user=self.accountant)
        self.assertEqual((frappe.db.get_value(gpr.DOCTYPE, name, "status"), self._payments(sr)), (gpr.PENDING, 0))

    def test_an_accountant_cannot_hand_make_an_approved_gst_payment(self):
        sr = self._wo()
        pay = frappe.get_doc({"doctype": PAYMENT, "document_type": SR, "document_name": sr, "project": self.project,
                              "vendor": self.vendor, "amount": 5000, "status": "Approved", "is_gst_payment": 1})
        with self.assertRaisesRegex(frappe.ValidationError, "approved in GST Requests first"):
            self._as(self.accountant, pay.insert, ignore_permissions=True)
        frappe.db.rollback()
        self.assertEqual(self._payments(sr), 0)

    def test_the_administrator_accounts_gst_payment_records_its_request(self):
        sr = self._wo()
        payload = json.dumps({"doctype": SR, "docname": sr, "amount": 5000, "is_gst_payment": 1})
        pay = json.loads(create_payment_request_for_service(payload))["name"]  # as Administrator
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, {"project_payment": pay}, "status"), gpr.APPROVED)

    def test_an_accountants_paid_entry_records_its_request_paid(self):
        sr = self._wo()
        pay = frappe.get_doc({"doctype": PAYMENT, "document_type": SR, "document_name": sr, "project": self.project,
                              "vendor": self.vendor, "amount": 4000, "status": "Paid", "is_gst_payment": 1,
                              "payment_date": frappe.utils.nowdate(), "utr": "TEST-UTR-GST"})
        self._as(self.accountant, pay.insert, ignore_permissions=True)
        frappe.db.commit()
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, {"project_payment": pay.name}, "status"), gpr.PAID)

    def test_an_approved_request_gets_no_second_one(self):
        sr = self._wo()
        name = self._ask(sr, 10000)
        pay = self._approve(name)["project_payment"]
        self.assertEqual(frappe.get_all(gpr.DOCTYPE, filters={"project_payment": pay}, pluck="name"), [name])

    # -- review round: project scope, owner and link without a user switch ----------------------
    def test_a_decider_without_the_project_cannot_decide_or_delete(self):
        other = self.fx.project()  # the accountant's User Permission is on `self.project` only
        sr = self.fx.service_request(other, self.vendor, total=118000, gst=True, gst_invoiced=18000)
        name = request_gst_payment(sr, 5000)["name"]  # as Administrator
        for call in (lambda: approve_gst_payment_request(name), lambda: reject_gst_payment_request(name, "no"),
                     lambda: delete_gst_payment_request(name)):
            with self.assertRaises(frappe.PermissionError):
                self._as(self.accountant, call)
            frappe.db.rollback()
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, "status"), gpr.PENDING)

    def test_the_approval_leaves_the_deciders_session_alone(self):
        sr = self._wo()
        name = self._ask(sr, 10000)
        frappe.set_user(self.accountant)
        try:
            out = approve_gst_payment_request(name)
            self.assertEqual(frappe.session.user, self.accountant)
        finally:
            frappe.set_user(U)
        self.assertEqual(frappe.db.get_value(PAYMENT, out["project_payment"], "owner"), self.pm)
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, "project_payment"), out["project_payment"])
