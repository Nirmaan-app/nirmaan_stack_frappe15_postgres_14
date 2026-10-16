# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Convert to Cheque, Link a new cheque and Switch to Online from Transaction Details (#1416, spec #1407).

Drives the card's endpoints against the database the way its buttons do
(`payment_cheque_actions.put_payment_on_new_cheque`, `payment_cheque_actions.switch_payment_to_online`)
and reads back what a user sees: the payment's mode, Cheque and status, the new Cheque and its one
line, the replaced Cheque and its history, or the refusal and that nothing changed.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Projects, vendors, Work Orders and payments
come from `TaxedWorkOrderFixture`; every Cheque carries a TESTCHQ number and is purged by `ChequeFixture`.
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.cheque_status import change_cheque_status
from nirmaan_stack.api.cheques.payment_cheque_actions import put_payment_on_new_cheque, switch_payment_to_online
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments.payment_hold import set_payment_hold
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services.cheques.writer import DuplicateChequeError

U = "Administrator"
PAYMENT = "Project Payments"
SR = "Service Requests"
RECON = "Reconciliation Pending"
PHOTO = "https://storage.example.invalid/private/files/cheque-convert-test.jpg"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"
PROCUREMENT = (
    "Nirmaan Procurement Executive Profile",
    "Nirmaan Procurement Lead Profile",
    "Nirmaan Material Procurement Executive Profile",
    "Nirmaan Service Procurement Executive Profile",
)
PROJECT_MANAGER = ("Nirmaan Project Manager Profile",)


class TestPaymentChequeActions(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor(2.0)
        self.project = self.fx.project()
        self.sr = self.fx.service_request(self.project, self.vendor)
        frappe.db.commit()  # a refusal below rolls back; the planted rows must outlive it
        # The admin note reaches every real admin, and a push reaches real phones: keep both off.
        for target in ("_notify_admins_auto_approved", "PrNotification"):
            quiet = patch(f"{CONTROLLER}.{target}")
            quiet.start()
            self.addCleanup(quiet.stop)

    def tearDown(self):
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _plant(self, status, *, amount=20000, on_hold=0, cheque_no=None):
        """An Online payment already sitting at `status` (raw insert: no approval hook runs). With
        `cheque_no`, a Cheque payment on no Cheque, as the backfill leaves one whose number it refused."""
        return self.cheques.plant_payment(
            self.fx, status, project=self.project, vendor=self.vendor, document=(SR, self.sr), amount=amount,
            cheque_no=cheque_no, on_hold=on_hold,
        )

    # -- driving --------------------------------------------------------------------------------
    def _new_cheque(self, payment, *, amount=20000, **overrides):
        """What the Convert / Link a new cheque dialog sends: the cheque as read off its photo."""
        args = {
            "payment": payment,
            "bank": "ICICI Bank",
            "cheque_no": self.cheques.number(),
            "cheque_date": nowdate(),
            "cheque_amount": amount,
            "cheque_attachment": PHOTO,
        }
        args.update(overrides)
        out = put_payment_on_new_cheque(**args)
        self.cheques.track(out["cheque"])
        return out

    def _cancel(self, cheque):
        change_cheque_status(cheque, "Cancelled", note="bounced")

    def _refused(self, phrase, fn, *args, exc=frappe.ValidationError, **kwargs):
        with self.assertRaisesRegex(exc, phrase):
            fn(*args, **kwargs)
        frappe.db.rollback()

    def _user(self, profiles):
        for user in frappe.get_all(
            "Nirmaan Users", filters={"role_profile": ["in", list(profiles)]}, pluck="name", limit=20
        ):
            if user and user != U and frappe.db.exists("User", user):
                return user
        self.skipTest(f"no user with {profiles} on this site")

    def _as(self, user, fn, *args, **kwargs):
        previous = frappe.session.user
        frappe.set_user(user)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user(previous)

    # -- reading --------------------------------------------------------------------------------
    def _payment(self, name):
        return frappe.db.get_value(
            PAYMENT, name, ["status", "mode_of_payment", "cheque", "cheque_no", "cheque_date"], as_dict=True
        )

    def _history(self, cheque):
        return [
            (h.from_status, h.to_status)
            for h in frappe.get_all(
                "Cheque Status History",
                filters={"parent": cheque, "parenttype": "Cheques"},
                fields=["from_status", "to_status"],
                order_by="idx asc",
            )
        ]

    def _lines(self, cheque):
        return [
            (l.line_type, l.project, l.record_doctype, l.record_name, l.payment_doctype, l.payment_name, flt(l.amount))
            for l in frappe.get_doc("Cheques", cheque).lines
        ]

    def _assert_on_cheque(self, payment, cheque, *, amount=20000.0, status="Pending"):
        """`status`: the new Cheque is Pending until its payment has moved on to Reconciliation Pending,
        then Issued (#1479)."""
        doc = frappe.get_doc("Cheques", cheque)
        self.assertEqual((doc.status, doc.made_from, doc.vendor, doc.attachment), (status, "PO/WO Page", self.vendor, PHOTO))
        self.assertEqual(self._lines(cheque), [("PO/WO Payment", self.project, SR, self.sr, PAYMENT, payment, amount)])
        pay = self._payment(payment)
        self.assertEqual(
            (pay.mode_of_payment, pay.cheque, pay.cheque_no, str(pay.cheque_date)),
            ("Cheque", cheque, doc.cheque_no, str(doc.cheque_date)),
        )

    # -- Convert to Cheque: the status table ----------------------------------------------------
    def test_an_approved_payment_converts_and_moves_to_reconciliation_pending_now(self):
        payment = self._plant("Approved")
        out = self._new_cheque(payment)
        self.assertEqual(out["status"], RECON)
        self.assertEqual(self._payment(payment).status, RECON)
        self._assert_on_cheque(payment, out["cheque"], status="Issued")

    def test_a_waiting_payment_converts_and_keeps_its_status(self):
        for status in ("Requested", "CEO Pending"):
            payment = self._plant(status)
            out = self._new_cheque(payment)
            self.assertEqual((out["status"], self._payment(payment).status), (status, status))
            self._assert_on_cheque(payment, out["cheque"])

    def test_a_held_payment_stays_approved_and_moves_once_released(self):
        payment = self._plant("Approved", on_hold=1)
        out = self._new_cheque(payment)
        self.assertEqual(out["status"], "Approved")

        released = set_payment_hold(payment, False)
        self.assertTrue(released["moved"])
        self.assertEqual(self._payment(payment).status, RECON)

    def test_a_settled_payment_converts_and_stays_where_it_is(self):
        # A Paid payment's cheque is not issued: only a payment at Reconciliation Pending issues one.
        # Convert to Cheque goes with #1487.
        for status, cheque_status in ((RECON, "Issued"), ("Paid", "Pending")):
            payment = self._plant(status)
            out = self._new_cheque(payment)
            self.assertEqual(self._payment(payment).status, status)
            self._assert_on_cheque(payment, out["cheque"], status=cheque_status)

    def test_the_line_is_for_the_cheque_amount(self):
        payment = self._plant("Requested")
        out = self._new_cheque(payment, amount=19600)
        self._assert_on_cheque(payment, out["cheque"], amount=19600.0)

    # -- Convert to Cheque: refusals ------------------------------------------------------------
    def test_a_rejected_payment_cannot_be_converted(self):
        payment = self._plant("Rejected")
        self._refused(f"Payment {payment} is Rejected and cannot be put on a cheque", self._new_cheque, payment)
        self.assertEqual(self._payment(payment).mode_of_payment, "Online")
        self.assertEqual(frappe.get_all("Cheques", filters={"cheque_no": ["like", "TESTCHQ%"]}), [])

    def test_a_recorded_bank_and_number_is_refused_and_the_payment_stays_online(self):
        number = self.cheques.number()
        recorded = save_cheque(
            bank="ICICI Bank", cheque_no=number, cheque_date=nowdate(), amount=5000, vendor=self.vendor,
            description="Advance", attachment=PHOTO,
        )["cheque"]
        self.cheques.track(recorded)
        payment = self._plant("Approved")
        self._refused(
            f"Cheque {number} \\(ICICI Bank\\) already exists. This makes a new cheque for the payment. "
            f"To put this payment on {number}, add it to the cheque in the Cheque Tracker.",
            self._new_cheque, payment, cheque_no=number, exc=DuplicateChequeError,
        )
        self.assertEqual(self._payment(payment).status, "Approved")
        self.assertEqual(self._payment(payment).mode_of_payment, "Online")
        self.assertEqual(frappe.get_all("Cheques", filters={"cheque_no": number}, pluck="name"), [recorded])

    def test_no_photo_is_refused(self):
        payment = self._plant("Approved")
        self._refused("Upload the photo of the cheque", self._new_cheque, payment, cheque_attachment="")
        self.assertEqual(self._payment(payment).mode_of_payment, "Online")

    def test_a_payment_on_a_live_cheque_gets_no_second_one(self):
        payment = self._plant("Requested")
        first = self._new_cheque(payment)["cheque"]
        number = frappe.db.get_value("Cheques", first, "cheque_no")
        self._refused(
            f"Payment {payment} is on cheque {number} \\(Pending\\). A new cheque can be linked only once that "
            "cheque is Cancelled.",
            self._new_cheque, payment,
        )
        self.assertEqual(self._payment(payment).cheque, first)

    # -- Link a new cheque ----------------------------------------------------------------------
    def test_a_cancelled_cheques_payment_gets_a_new_cheque_and_the_old_one_stays(self):
        payment = self._plant("Requested")
        old = self._new_cheque(payment)["cheque"]
        self._cancel(old)

        new = self._new_cheque(payment)["cheque"]

        self.assertNotEqual(new, old)
        self._assert_on_cheque(payment, new)
        self.assertEqual(frappe.db.get_value("Cheques", old, "status"), "Cancelled")
        self.assertEqual(self._history(old), [(None, "Pending"), ("Pending", "Cancelled")])
        self.assertEqual([line[5] for line in self._lines(old)], [payment])

    def test_a_new_cheque_on_an_approved_payment_moves_it_on(self):
        payment = self._plant("Approved", on_hold=1)
        old = self._new_cheque(payment)["cheque"]
        self._cancel(old)
        frappe.db.set_value(PAYMENT, payment, "on_hold", 0)  # test-only: released by hand, no move
        frappe.db.commit()

        out = self._new_cheque(payment)
        self.assertEqual(out["status"], RECON)

    # -- a Cheque payment on no Cheque (the backfill refused its number) -------------------------
    def test_a_cheque_payment_on_no_cheque_gets_a_new_cheque(self):
        payment = self._plant("Requested", cheque_no=self.cheques.number())
        out = self._new_cheque(payment)
        self._assert_on_cheque(payment, out["cheque"])

    def test_a_cheque_payment_on_no_cheque_switches_to_online(self):
        payment = self._plant(RECON, cheque_no=self.cheques.number())
        out = switch_payment_to_online(payment)
        self.assertEqual(out, {"payment": payment, "mode_of_payment": "Online", "status": RECON})
        pay = self._payment(payment)
        self.assertEqual((pay.mode_of_payment, pay.cheque, pay.cheque_no), ("Online", None, None))

    def test_a_rejected_cheque_payment_on_no_cheque_is_refused_both(self):
        payment = self._plant("Rejected", cheque_no=self.cheques.number())
        self._refused(f"Payment {payment} is Rejected and cannot be put on a cheque", self._new_cheque, payment)
        self._refused(f"Payment {payment} is Rejected", switch_payment_to_online, payment)
        self.assertEqual(self._payment(payment).mode_of_payment, "Cheque")

    # -- Switch to Online -----------------------------------------------------------------------
    def test_switch_to_online_is_refused_while_the_cheque_is_not_cancelled(self):
        payment = self._plant(RECON)
        cheque = self._new_cheque(payment)["cheque"]
        number = frappe.db.get_value("Cheques", cheque, "cheque_no")
        for cheque_status in ("Issued", "Cleared"):
            if cheque_status == "Cleared":
                change_cheque_status(cheque, "Cleared")
            self._refused(
                f"Payment {payment} goes back to Online only once its cheque is Cancelled; it is on cheque "
                f"{number} \\({cheque_status}\\)",
                switch_payment_to_online, payment,
            )
            pay = self._payment(payment)
            self.assertEqual((pay.mode_of_payment, pay.cheque, pay.status), ("Cheque", cheque, RECON))

    def test_switch_to_online_unlinks_and_leaves_the_status(self):
        payment = self._plant(RECON)
        cheque = self._new_cheque(payment)["cheque"]
        self._cancel(cheque)

        out = switch_payment_to_online(payment)

        self.assertEqual(out, {"payment": payment, "mode_of_payment": "Online", "status": RECON})
        pay = self._payment(payment)
        self.assertEqual((pay.mode_of_payment, pay.cheque, pay.cheque_no, pay.cheque_date, pay.status),
                         ("Online", None, None, None, RECON))
        self.assertEqual(frappe.db.get_value("Cheques", cheque, "status"), "Cancelled")
        self.assertEqual([line[5] for line in self._lines(cheque)], [payment])

    def test_an_online_payment_is_already_online(self):
        payment = self._plant("Approved")
        self._refused(f"Payment {payment} is already Online", switch_payment_to_online, payment)

    def test_a_switched_payment_can_be_converted_again(self):
        payment = self._plant("Requested")
        old = self._new_cheque(payment)["cheque"]
        self._cancel(old)
        switch_payment_to_online(payment)

        new = self._new_cheque(payment)["cheque"]
        self._assert_on_cheque(payment, new)

    # -- who ------------------------------------------------------------------------------------
    def test_procurement_may_convert_and_switch(self):
        user = self._user(PROCUREMENT)
        payment = self._plant("Requested")
        out = self._as(user, self._new_cheque, payment)
        self._assert_on_cheque(payment, out["cheque"])
        self._cancel(out["cheque"])
        self.assertEqual(self._as(user, switch_payment_to_online, payment)["mode_of_payment"], "Online")

    def test_a_project_manager_is_refused_both(self):
        user = self._user(PROJECT_MANAGER)
        payment = self._plant("Approved")
        with self.assertRaises(frappe.PermissionError):
            self._as(user, self._new_cheque, payment)
        frappe.db.rollback()
        self.assertEqual(self._payment(payment).mode_of_payment, "Online")

        cheque = self._new_cheque(payment)["cheque"]
        self._cancel(cheque)
        with self.assertRaises(frappe.PermissionError):
            self._as(user, switch_payment_to_online, payment)
        frappe.db.rollback()
        self.assertEqual(self._payment(payment).mode_of_payment, "Cheque")
