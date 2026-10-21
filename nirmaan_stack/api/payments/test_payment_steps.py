# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Who may move a payment a step (#1530, spec #1528 stories 5-7).

Each test acts as a real user of a role profile and moves a payment the way that role does it: a plain
`doc.save()` as Desk and `updateDoc` do, or the endpoint the screen calls. It asserts the refusal and its
message, or the status stored.

⚠️ RUNS AGAINST THE SITE DATABASE. The project, vendor and Work Order are planted by
`TaxedWorkOrderFixture` (`TEST-TWO-*`), whose purge sweeps every payment under its projects.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowdate

from nirmaan_stack.api.outflow_import.expenses import settle_row_partial
from nirmaan_stack.api.outflow_import.test_settle_payment import PartialSettlementFixture
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.api.payments.bulk_actions import bulk_lead_approve_payments
from nirmaan_stack.api.payments.project_payments import (
    ceo_approve_payment,
    create_payment_request_for_service,
    update_payment_request,
)
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.api.po_adjustments._payment_utils import _create_project_payment
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services.cheque_payments import move_to_reconciliation
from nirmaan_stack.services.outflow_import.partial_settle import INTENT_PART_PAYMENT
from nirmaan_stack.services.role_profiles import (
    ACCOUNTANT_LEAD_PROFILE,
    ACCOUNTANT_PROFILE,
    ADMIN_PROFILE,
    PROCUREMENT_EXECUTIVE_PROFILE,
)

PAYMENT = "Project Payments"
SR = "Service Requests"
U = "Administrator"

ABOVE_L1 = 60000  # needs L1, then the CEO
WITHIN_L1 = 30000  # L1 finishes it


class PaymentStepCase(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.project = self.fx.project()
        self.vendor = self.fx.vendor(2.0)
        self.sr = self.fx.service_request(self.project, self.vendor)

    def tearDown(self):
        frappe.set_user(U)

    # -- who ------------------------------------------------------------------------------------
    def _user(self, profile):
        """A real user of `profile` who is not the CEO, put on the fixture's project for this test."""
        user = frappe.db.get_value(
            "Nirmaan Users", {"role_profile": profile, "name": ["!=", CEO_AUTHORIZED_USER]}, "name"
        )
        if not user:
            self.skipTest(f"no {profile} user on this site")
        return self._on_project(user)

    def _ceo(self):
        if not frappe.db.exists("User", CEO_AUTHORIZED_USER):
            self.skipTest("no CEO user on this site")
        return self._on_project(CEO_AUTHORIZED_USER)

    def _on_project(self, user):
        perm = frappe.get_doc({"doctype": "User Permission", "user": user, "allow": "Projects",
            "for_value": self.project}).insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(self._remove_permission, perm.name)
        return user

    @staticmethod
    def _remove_permission(name):
        frappe.db.rollback()
        frappe.db.delete("User Permission", {"name": name})
        frappe.db.commit()

    # -- what -----------------------------------------------------------------------------------
    def _plant(self, amount, status):
        """A Work Order payment at `status`, planted by raw SQL (its creation is not under test)."""
        name = self.fx._name("PAY")
        frappe.db.sql(
            """INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner, docstatus,
                   idx, project, vendor, amount, status, document_type, document_name)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s)""",
            (name, U, U, self.project, self.vendor, flt(amount), status, SR, self.sr),
        )
        self.fx.payments.append(name)
        frappe.db.commit()
        return name

    def _as(self, user, fn, *args, **kwargs):
        """Call `fn` as `user`, committing what it wrote as the request would."""
        frappe.set_user(user)
        try:
            result = fn(*args, **kwargs)
            frappe.db.commit()
            return result
        finally:
            frappe.db.rollback()
            frappe.set_user(U)

    def _move_as(self, user, payment, status):
        """Save `payment` at `status` as `user`, the way Desk and the screens' `updateDoc` do."""
        def move():
            doc = frappe.get_doc(PAYMENT, payment)
            doc.status = status
            doc.save()

        self._as(user, move)

    def _status(self, payment):
        return frappe.db.get_value(PAYMENT, payment, "status")

    def assertRefused(self, user, payment, status, message):
        before = self._status(payment)
        with self.assertRaisesRegex(frappe.ValidationError, message):
            self._move_as(user, payment, status)
        self.assertEqual(self._status(payment), before)


class TestTheCeoTier(PaymentStepCase):
    def test_an_accountant_cannot_approve_a_payment_above_the_l1_limit(self):
        accountant = self._user(ACCOUNTANT_PROFILE)
        pay = self._plant(ABOVE_L1, "Requested")
        self.assertRefused(accountant, pay, "Approved", "CEO")

    def test_an_admin_cannot_approve_it_past_the_ceo(self):
        admin = self._user(ADMIN_PROFILE)
        pay = self._plant(ABOVE_L1, "Requested")
        self.assertRefused(admin, pay, "Approved", "Only the CEO can move a payment from Requested to Approved")

    def test_l1_sends_it_to_the_ceo_and_the_ceo_approves_it(self):
        admin, ceo = self._user(ADMIN_PROFILE), self._ceo()
        pay = self._plant(ABOVE_L1, "Requested")
        self._move_as(admin, pay, "CEO Pending")
        self.assertEqual(self._status(pay), "CEO Pending")
        self._as(ceo, ceo_approve_payment, pay)
        self.assertEqual(self._status(pay), "Approved")

    def test_an_admin_cannot_approve_or_reject_a_ceo_pending_payment(self):
        admin = self._user(ADMIN_PROFILE)
        pay = self._plant(WITHIN_L1, "CEO Pending")
        self.assertRefused(admin, pay, "Approved", "Only the CEO can move a payment from CEO Pending to Approved")
        self.assertRefused(admin, pay, "Rejected", "Only the CEO can move a payment from CEO Pending to Rejected")

    def test_the_ceo_rejects_by_a_plain_save(self):
        pay = self._plant(ABOVE_L1, "CEO Pending")
        self._move_as(self._ceo(), pay, "Rejected")
        self.assertEqual(self._status(pay), "Rejected")

    def test_the_ceo_part_approves_and_the_balance_waits_for_the_ceo(self):
        pay = self._plant(ABOVE_L1, "CEO Pending")
        result = self._as(self._ceo(), ceo_approve_payment, pay, approved_amount=40000)
        self.assertEqual(self._status(pay), "Approved")
        self.assertEqual(self._status(result["data"]["remainder_payment"]), "CEO Pending")


class TestTheL1Step(PaymentStepCase):
    def test_an_accountant_cannot_approve_or_reject_a_requested_payment(self):
        accountant = self._user(ACCOUNTANT_PROFILE)
        pay = self._plant(WITHIN_L1, "Requested")
        self.assertRefused(accountant, pay, "Approved", "Only an Admin can move a payment from Requested to Approved")
        self.assertRefused(accountant, pay, "Rejected", "Only an Admin can move a payment from Requested to Rejected")

    def test_an_admin_approves_within_the_l1_limit(self):
        pay = self._plant(WITHIN_L1, "Requested")
        self._move_as(self._user(ADMIN_PROFILE), pay, "Approved")
        self.assertEqual(self._status(pay), "Approved")

    def test_an_admin_rejects(self):
        pay = self._plant(ABOVE_L1, "Requested")
        self._move_as(self._user(ADMIN_PROFILE), pay, "Rejected")
        self.assertEqual(self._status(pay), "Rejected")


class TestSettling(PaymentStepCase):
    def test_procurement_cannot_mark_a_payment_paid(self):
        pay = self._plant(WITHIN_L1, "Approved")
        self.assertRefused(
            self._user(PROCUREMENT_EXECUTIVE_PROFILE), pay, "Reconciliation Pending",
            "Only an Admin, Accountant or Accountant Lead can move a payment from Approved to Reconciliation Pending",
        )

    def test_an_accountant_marks_it_paid_and_fulfils_it(self):
        accountant = self._user(ACCOUNTANT_PROFILE)
        pay = self._plant(WITHIN_L1, "Approved")
        self._move_as(accountant, pay, "Reconciliation Pending")
        self.assertEqual(self._status(pay), "Reconciliation Pending")
        self._move_as(accountant, pay, "Paid")
        self.assertEqual(self._status(pay), "Paid")

    def test_procurement_cannot_fulfil_by_a_save_or_by_the_endpoint(self):
        procurement = self._user(PROCUREMENT_EXECUTIVE_PROFILE)
        pay = self._plant(WITHIN_L1, "Reconciliation Pending")
        refusal = "Only an Admin, Accountant or Accountant Lead can move a payment from Reconciliation Pending to Paid"
        self.assertRefused(procurement, pay, "Paid", refusal)
        with self.assertRaisesRegex(frappe.ValidationError, refusal):
            self._as(procurement, update_payment_request, json.dumps(
                {"action": "fulfil", "name": pay, "utr": f"UTR-{frappe.generate_hash(length=8)}"}
            ))
        self.assertEqual(self._status(pay), "Reconciliation Pending")


class TestBulkApprove(PaymentStepCase):
    def test_an_accountant_is_refused(self):
        pay = self._plant(WITHIN_L1, "Requested")
        with self.assertRaisesRegex(frappe.PermissionError, "Only an Admin can approve or reject payments in bulk"):
            self._as(self._user(ACCOUNTANT_PROFILE), bulk_lead_approve_payments, [pay], "approve")
        self.assertEqual(self._status(pay), "Requested")

    def test_an_admin_approves(self):
        pay = self._plant(WITHIN_L1, "Requested")
        self._as(self._user(ADMIN_PROFILE), bulk_lead_approve_payments, [pay], "approve")
        self.assertEqual(self._status(pay), "Approved")


class TestANewPayment(PaymentStepCase):
    def _request(self, amount):
        return json.loads(create_payment_request_for_service(json.dumps(
            {"doctype": SR, "docname": self.sr, "amount": amount}
        )))["name"]

    def test_a_small_request_is_born_approved_whoever_raises_it(self):
        pay = self._as(self._user(PROCUREMENT_EXECUTIVE_PROFILE), self._request, 10000)
        self.assertEqual(self._status(pay), "Approved")

    def test_an_admin_raising_one_clears_their_own_step(self):
        admin = self._user(ADMIN_PROFILE)
        self.assertEqual(self._status(self._as(admin, self._request, WITHIN_L1)), "Approved")
        self.assertEqual(self._status(self._as(admin, self._request, ABOVE_L1)), "CEO Pending")

    def test_a_desk_insert_cannot_be_born_past_its_approval(self):
        def insert(status):
            frappe.get_doc({"doctype": PAYMENT, "document_type": SR, "document_name": self.sr,
                "project": self.project, "vendor": self.vendor, "amount": WITHIN_L1, "status": status}).insert()

        procurement = self._user(PROCUREMENT_EXECUTIVE_PROFILE)
        with self.assertRaisesRegex(frappe.ValidationError, "Only an Admin can create a payment at Approved"):
            self._as(procurement, insert, "Approved")
        with self.assertRaisesRegex(frappe.ValidationError, "Only an Admin can create a payment at CEO Pending"):
            self._as(procurement, insert, "CEO Pending")
        self.assertFalse(frappe.db.exists(PAYMENT, {"document_name": self.sr}))


class TestTheSystemsOwnMoves(PaymentStepCase):
    def test_an_approved_cheque_payment_moves_on_whoever_set_it_going(self):
        pay = self._plant(WITHIN_L1, "Approved")
        frappe.db.set_value(PAYMENT, pay, {"mode_of_payment": "Cheque", "cheque_no": "004521",
            "cheque_date": nowdate()}, update_modified=False)
        frappe.db.commit()
        self.assertTrue(self._as(self._user(PROCUREMENT_EXECUTIVE_PROFILE), move_to_reconciliation, pay))
        self.assertEqual(self._status(pay), "Reconciliation Pending")

    def test_a_po_adjustment_writes_its_payment(self):
        po = self.fx._name("PO")
        frappe.db.sql(
            """INSERT INTO "tabProcurement Orders" (name, creation, modified, modified_by, owner, docstatus,
                   idx, project, vendor, amount_paid) VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 0)""",
            (po, U, U, self.project, self.vendor),
        )
        self.addCleanup(self._drop_po, po)
        frappe.db.commit()
        pay = self._as(self._user(PROCUREMENT_EXECUTIVE_PROFILE), _create_project_payment,
            po, self.project, self.vendor, 5000, "Paid")
        self.assertEqual(self._status(pay.name), "Paid")

    @staticmethod
    def _drop_po(po):
        frappe.db.rollback()
        frappe.db.delete("Procurement Orders", {"name": po})
        frappe.db.commit()


class TestBulkImportSettlesAndUndoes(PartialSettlementFixture):
    """A part settle and its Unreconcile, as the Accountant Lead who runs them: Paid back to
    Reconciliation Pending is a step no one makes by hand, but the import may."""

    def test_a_part_settle_and_its_unreconcile(self):
        lead = frappe.db.get_value("Nirmaan Users", {"role_profile": ACCOUNTANT_LEAD_PROFILE}, "name")
        if not lead:
            self.skipTest("no Accountant Lead on this site")
        frappe.set_user(lead)
        try:
            settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)
            frappe.db.commit()
            self.assertEqual(frappe.db.get_value(PAYMENT, self.big_payment, "status"), "Paid")
            unreconcile_row(row=self.partial_row.name, legs="all", reason="wrong payment picked")
            frappe.db.commit()
        finally:
            frappe.set_user(U)
        self.assertEqual(frappe.db.get_value(PAYMENT, self.big_payment, "status"), "Reconciliation Pending")
