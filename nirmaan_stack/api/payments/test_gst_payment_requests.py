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
from nirmaan_stack.integrations.controllers.project_payments import _auto_approved_note, _notify_admins_auto_approved
from nirmaan_stack.integrations.controllers.service_requests import (
    validate_gst_not_switched_off_with_gst_payments,
)
from nirmaan_stack.services import gst_payment_requests as gpr
from nirmaan_stack.services.order_payments import work_order_summary
from nirmaan_stack.services.role_profiles import (
    ACCOUNTANT_LEAD_PROFILE,
    ACCOUNTANT_PROFILE,
    ADMIN_PROFILE,
    PROCUREMENT_EXECUTIVE_PROFILE,
    PROJECT_MANAGER_PROFILE,
)

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

    def test_a_reason_over_250_characters_is_refused(self):
        name = self._ask(self._wo(), 10000)
        with self.assertRaisesRegex(frappe.ValidationError, "at most 250"):
            self._as(self.accountant, reject_gst_payment_request, name, "x" * 251)
        frappe.db.rollback()
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, "status"), gpr.PENDING)

    def test_a_long_reason_rejects_and_the_requesters_bell_is_cut_to_fit(self):
        name = self._ask(self._wo(), 10000)
        reason = "x" * 250
        self._as(self.accountant, reject_gst_payment_request, name, reason)
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, ["status", "review_comment"]),
                         (gpr.REJECTED, reason))
        bell = frappe.db.get_value("Nirmaan Notifications", {"docname": name, "recipient": self.pm}, "description")
        self.assertIsNotNone(bell, "the requester got no bell row")
        self.assertLessEqual(len(bell), 140)
        self.assertTrue(bell.endswith("…"), bell)

    def test_a_failed_bell_leaves_the_rejection_and_logs_the_failure(self):
        name = self._ask(self._wo(), 10000)
        new_doc = frappe.new_doc

        def failing_bell(doctype, *args, **kwargs):
            if doctype == "Nirmaan Notifications":
                raise frappe.ValidationError("bell down")
            return new_doc(doctype, *args, **kwargs)

        title = f"GST request notification failed: {name}"
        self.addCleanup(self._delete_error_logs, title)
        with patch("frappe.new_doc", side_effect=failing_bell):
            result = self._as(self.accountant, reject_gst_payment_request, name, "Invoice GST is wrong")
        self.assertEqual(result["status"], gpr.REJECTED)
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, "status"), gpr.REJECTED)
        self.assertTrue(frappe.db.exists("Error Log", {"method": title}), "the failure was not logged")

    @staticmethod
    def _delete_error_logs(title):
        frappe.db.rollback()
        frappe.db.delete("Error Log", {"method": title})
        frappe.db.commit()

    # -- the approval ---------------------------------------------------------------------------
    def test_approval_creates_the_payment_as_the_requester(self):
        sr = self._wo()
        name = self._ask(sr, 10000)
        out = self._approve(name)
        pay = frappe.get_doc(PAYMENT, out["project_payment"])
        # Amendment B (owner, 2026-11-18): the Accountant approved it, so it is NOT auto-approved, even below
        # ₹15,000 (it used to be: `auto_approved` 1).
        self.assertEqual((pay.owner, pay.is_gst_payment, flt(pay.amount), pay.status, pay.auto_approved),
                         (self.pm, 1, 10000, "Approved", 0))
        req = frappe.get_doc(gpr.DOCTYPE, name)
        self.assertEqual((req.status, req.project_payment, req.reviewed_by), (gpr.APPROVED, pay.name, self.accountant))
        self.assertEqual(self._gst_left(sr), 8000)  # the payment holds what the request held, once

    # -- Amendment B: the decider's approval is the only one ------------------------------------
    def _big_wo(self):
        """Base 15,00,000 + GST 2,70,000, all invoiced: room for every amount below on one Work Order."""
        return self._wo(total=1770000, gst_invoiced=270000)

    def _assert_ready_to_pay(self, pay_name, amount):
        pay = frappe.get_doc(PAYMENT, pay_name)
        self.assertEqual((pay.status, flt(pay.amount), pay.auto_approved, bool(pay.approval_date),
                          bool(pay.ceo_approval_date)), ("Approved", amount, 0, True, True),
                         f"₹{amount:,} GST payment")

    def test_every_amount_is_ready_to_pay(self):
        # Amendment B (owner, 2026-11-18) REPLACES "the approval routes by amount": ₹15,000 to ₹50,000 used to
        # be born Requested (L1) and above ₹50,000 Requested (L1, then the CEO).
        sr = self._big_wo()
        for amount in (14999, 15000, 30000, 50000, 50001, 70000):
            out = self._approve(self._ask(sr, amount))
            self.assertEqual(out["payment_status"], "Approved", f"₹{amount:,}")
            self._assert_ready_to_pay(out["project_payment"], amount)

    def test_who_raised_the_request_does_not_matter(self):
        # Administrator holds L1: its own ₹70,000 payment would be born CEO Pending. Its approved request's is not.
        sr = self._big_wo()
        out = self._approve(request_gst_payment(sr, 70000)["name"])  # raised as Administrator
        self._assert_ready_to_pay(out["project_payment"], 70000)
        self.assertEqual(frappe.db.get_value(PAYMENT, out["project_payment"], "owner"), U)

    def test_an_accountant_lead_or_admin_approval_is_ready_to_pay_too(self):  # B1
        sr = self._big_wo()
        for profile in (ACCOUNTANT_LEAD_PROFILE, ADMIN_PROFILE):
            decider = self._user(profile)
            out = self._as(decider, approve_gst_payment_request, self._ask(sr, 70000))
            self._assert_ready_to_pay(out["project_payment"], 70000)
            self.assertEqual(frappe.db.get_value(PAYMENT, out["project_payment"], "owner"), self.pm)

    def test_a_base_payment_keeps_the_amount_rule(self):
        # The same Work Order, a Procurement Executive (raises payments, holds no L1): ₹70,000 of BASE is still
        # born Requested, for L1 then the CEO.
        sr = self._big_wo()
        raiser = self._user(PROCUREMENT_EXECUTIVE_PROFILE)
        payload = json.dumps({"doctype": SR, "docname": sr, "amount": 70000, "is_gst_payment": 0})
        pay = json.loads(self._as(raiser, create_payment_request_for_service, payload))["name"]
        self.assertEqual(frappe.db.get_value(PAYMENT, pay, ["status", "is_gst_payment"]), ("Requested", 0))

    def test_no_one_is_asked_to_approve_it(self):
        sr = self._big_wo()
        pay = self._approve(self._ask(sr, 70000))["project_payment"]
        asked = frappe.get_all("Nirmaan Notifications", filters={"docname": pay}, pluck="event_id")
        self.assertNotIn("payment:new", asked)  # the admins' "approve this" bell
        self.assertNotIn("payment:approved", asked)  # the CEO's "waiting for you" bell
        # The Accountants' "ready to fulfil" bell (its event name is shared with the CEO's approval).
        self.assertIn("payment:ceo_approved", asked)
        comments = frappe.get_all("Comment", filters={"reference_doctype": PAYMENT, "reference_name": pay,
                                                      "comment_type": "Comment"}, pluck="content")
        self.assertTrue(any("needs no L1 or CEO approval" in (c or "") for c in comments), comments)
        self.assertFalse([c for c in comments if "Approved at request" in (c or "")], comments)

    def test_the_admins_note_names_the_accountant_and_the_request(self):
        doc = frappe._dict(name="PAY-X", document_name="SR-X", auto_approved=0,
                           flags=frappe._dict({gpr.FROM_GST_REQUEST: "GPR-26-99999"}))
        title, description = self._as(self.accountant, _auto_approved_note, doc)
        self.assertEqual(title, "GST Payment Approved")
        self.assertIn(frappe.utils.get_fullname(self.accountant), description)
        self.assertIn("GPR-26-99999", description)
        self.assertNotIn("L1", description)
        self.assertNotIn("CEO", description)
        self.assertNotIn("holds the approval", description)
        self.assertLessEqual(len(description), 140)

    def test_the_admins_note_always_fits_the_bell(self):
        # Browser walk-through, 2026-11-18: a 150-character note made `Nirmaan Notifications` refuse its insert
        # ("will get truncated, as max characters allowed is 140"), which failed the whole approval. The muted
        # fan-out in `setUp` hid it from every other test here.
        doc = frappe._dict(name="PAY-00058-303", document_name="SR-00058-000314", auto_approved=0,
                           flags=frappe._dict({gpr.FROM_GST_REQUEST: "GPR-26-00003"}))
        with patch(f"{CONTROLLER}.get_user_name", return_value="A Very Long Accountant Name " * 6):
            _title, description = _auto_approved_note(doc)
        self.assertLessEqual(len(description), 140, description)
        self.assertTrue(description.startswith("GST payment PAY-00058-303 approved by"), description)

    def test_a_bell_that_cannot_be_saved_never_fails_the_approval(self):
        # The admins' bell goes to a recipient that does not exist, so `Nirmaan Notifications` refuses it (its
        # `recipient` is a Link). Before `_insert_bell` that refusal rolled back the whole approval; now the
        # approval stands and the refusal goes to the Error Log.
        sr = self._big_wo()
        name = self._ask(sr, 70000)
        ghost = [{"name": "no-such-user@example.invalid", "role_profile": "Nirmaan Admin Profile", "full_name": "Ghost"}]
        self.addCleanup(self._delete_skipped_bell_logs)
        with patch(f"{CONTROLLER}._notify_admins_auto_approved", new=_notify_admins_auto_approved), \
                patch(f"{CONTROLLER}.get_admin_users", return_value=ghost):
            out = self._approve(name)
        self._assert_ready_to_pay(out["project_payment"], 70000)
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, "status"), gpr.APPROVED)
        self.assertFalse(frappe.db.exists("Nirmaan Notifications", {"recipient": ghost[0]["name"]}))
        self.assertTrue(frappe.db.exists("Error Log", {"method": ["like", f"Payment notification skipped: {out['project_payment']}%"]}))

    # -- B2: the one-time patch for GST payments still waiting at L1 / CEO -------------------------
    def test_b2_patch_moves_only_waiting_gst_payments_with_an_approved_request(self):
        # Scoped to this test's own payments: it reads `find_waiting` / `find_left_alone` and moves only its rows,
        # never `run()`, which would touch every waiting GST payment on the live site.
        from nirmaan_stack.patches.v3_0 import gst_payments_waiting_to_approved as b2

        sr = self._big_wo()
        a, b, c, d = (self._approve(self._ask(sr, amount))["project_payment"] for amount in (12000, 40000, 5000, 7000))
        req = {p: frappe.db.get_value(gpr.DOCTYPE, {"project_payment": p}, "name") for p in (a, b, c, d)}
        self.addCleanup(self._delete_comments, [a, b, c, d])
        # Make them look like payments approved before Amendment B (raw, as the patch's real rows were born).
        frappe.db.set_value(PAYMENT, a, {"status": "Requested", "approval_date": None, "ceo_approval_date": None},
                            update_modified=False)
        frappe.db.set_value(PAYMENT, b, {"status": "CEO Pending", "approval_date": "2026-11-10", "ceo_approval_date": None},
                            update_modified=False)
        frappe.db.set_value(PAYMENT, c, {"status": "Rejected"}, update_modified=False)  # rejected on purpose
        frappe.db.set_value(PAYMENT, d, {"status": "Requested", "approval_date": None, "ceo_approval_date": None},
                            update_modified=False)
        frappe.db.set_value(gpr.DOCTYPE, req[d], "project_payment", None, update_modified=False)  # no request
        frappe.db.set_value(gpr.DOCTYPE, req[a], "reviewed_on", "2026-11-12 10:00:00", update_modified=False)
        frappe.db.set_value(gpr.DOCTYPE, req[b], "reviewed_on", "2026-11-13 10:00:00", update_modified=False)
        frappe.db.commit()
        modified_before = {p: frappe.db.get_value(PAYMENT, p, "modified") for p in (a, b, c, d)}

        def mine(rows):
            return sorted(r.payment for r in rows if r.payment in modified_before)

        self.assertEqual(mine(b2.find_waiting()), sorted([a, b]))   # Requested + CEO Pending with an approved request
        self.assertEqual(mine(b2.find_left_alone()), [d])            # waiting, but no request: listed, not moved
        for row in b2.find_waiting():
            if row.payment in modified_before:
                b2.move(row)
        frappe.db.commit()

        after = {p: frappe.db.get_value(PAYMENT, p, ["status", "approval_date", "ceo_approval_date", "modified"],
                                        as_dict=True) for p in modified_before}
        day = frappe.utils.getdate
        self.assertEqual((after[a].status, after[a].approval_date, after[a].ceo_approval_date),
                         ("Approved", day("2026-11-12"), day("2026-11-12")))
        self.assertEqual((after[b].status, after[b].approval_date, after[b].ceo_approval_date),
                         ("Approved", day("2026-11-13"), day("2026-11-13")))  # the old L1 date gives way (owner)
        self.assertEqual((after[c].status, after[d].status), ("Rejected", "Requested"))
        for p in modified_before:
            self.assertEqual(after[p].modified, modified_before[p], f"{p}: `modified` must not move")
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, req[a], "status"), gpr.APPROVED)  # requests untouched
        comments = {p: frappe.db.count("Comment", {"reference_name": p, "content": ["like", "%one-time patch%"]})
                    for p in modified_before}
        self.assertEqual(comments, {a: 1, b: 1, c: 0, d: 0})
        self.assertEqual(mine(b2.find_waiting()), [])  # a second run finds nothing to move

    @staticmethod
    def _delete_comments(payments):
        frappe.db.rollback()
        frappe.db.delete("Comment", {"reference_doctype": PAYMENT, "reference_name": ["in", payments]})
        frappe.db.commit()

    @staticmethod
    def _delete_skipped_bell_logs():
        frappe.db.rollback()
        frappe.db.delete("Error Log", {"method": ["like", "Payment notification skipped:%TEST%"]})
        frappe.db.delete("Error Log", {"method": ["like", "Payment notification skipped:%no-such-user@example.invalid"]})
        frappe.db.commit()

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
        # Within the auto band, so the payment-step raise rule (L1 from ₹15,000) stays out of the way and the
        # GST rule is what refuses it. The payment is Approved (Amendment B; it used to be Requested at ₹20,000).
        sr = self._wo()
        pay = frappe.get_doc(PAYMENT, self._approve(self._ask(sr, 10000))["project_payment"])
        pay.amount = 11000
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
        pay = self._approve(name)["project_payment"]  # Approved
        self._move(pay, "Reconciliation Pending")
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, "status"), gpr.APPROVED)
        self._move(pay, "Paid")
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, "status"), gpr.PAID)
        self._move(pay, "Reconciliation Pending")  # un-reconciled
        self.assertEqual(frappe.db.get_value(gpr.DOCTYPE, name, "status"), gpr.APPROVED)

    def test_a_payment_rejected_afterwards_leaves_its_request_approved(self):
        sr = self._wo(total=236000, gst_invoiced=36000)
        name = self._ask(sr, 20000)
        pay = self._approve(name)["project_payment"]  # Approved (Amendment B)
        self._move(pay, "Rejected")  # an Admin's correction
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
