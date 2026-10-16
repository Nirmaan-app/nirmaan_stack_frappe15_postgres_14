# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Cheque's status by hand: single and bulk change, Cancel, history, the detail view (#1412, spec #1407).

Drives the report's endpoints against the database the way the Change status dialogs and the detail
view do (`cheque_status.change_cheque_status`, `cheque_status.change_cheque_statuses`,
`cheque_detail.get_cheque`) and reads back what a user sees: the Cheque's status and history, each
linked payment's status, or the refusal.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Projects, vendors, Work Orders and payments
come from `TaxedWorkOrderFixture`; every Cheque carries a TESTCHQ number and is purged by `ChequeFixture`.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, nowdate

from nirmaan_stack.api.cheques.cheque_detail import get_cheque
from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.cheque_status import change_cheque_status, change_cheque_statuses
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture

U = "Administrator"
PAYMENT = "Project Payments"
SR = "Service Requests"
LINE = "PO/WO Payment"
PHOTO = "https://storage.example.invalid/private/files/cheque-test.jpg"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"
PROCUREMENT = (
    "Nirmaan Procurement Executive Profile",
    "Nirmaan Procurement Lead Profile",
    "Nirmaan Material Procurement Executive Profile",
    "Nirmaan Service Procurement Executive Profile",
)
ACCOUNTANT = "Nirmaan Accountant Profile"


class TestChequeStatus(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor(2.0)
        self.project = self.fx.project()
        self.sr = self.fx.service_request(self.project, self.vendor)
        frappe.db.commit()  # a refusal below rolls back; the planted rows must outlive it
        quiet = patch(f"{CONTROLLER}._notify_admins_auto_approved")
        quiet.start()
        self.addCleanup(quiet.stop)

    def tearDown(self):
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _plant(self, status, *, amount=20000):
        """A payment already sitting at `status` (raw insert: no approval hook runs)."""
        return self.cheques.plant_payment(
            self.fx, status, project=self.project, vendor=self.vendor, document=(SR, self.sr), amount=amount
        )

    def _cheque(self, *payments, cheque_no=None):
        """A Cheque from the report with one line per payment (an Ad-hoc cheque when none)."""
        lines = [
            {"line_type": LINE, "project": self.project, "record_doctype": SR, "record_name": self.sr,
             "payment_name": p}
            for p in payments
        ]
        result = save_cheque(
            bank="ICICI Bank",
            cheque_no=cheque_no or self.cheques.number(),
            cheque_date=nowdate(),
            amount=50000,
            vendor=self.vendor,
            attachment=PHOTO,
            description=None if payments else "Office rent",
            lines=json.dumps(lines),
        )
        return self.cheques.track(result["cheque"])

    def _history(self, cheque):
        return [
            (h.from_status, h.to_status, h.changed_by, h.note)
            for h in frappe.get_all(
                "Cheque Status History",
                filters={"parent": cheque, "parenttype": "Cheques"},
                fields=["from_status", "to_status", "changed_by", "note"],
                order_by="idx asc",
            )
        ]

    def _status(self, cheque):
        return frappe.db.get_value("Cheques", cheque, "status")

    def _refused(self, phrase, fn, *args, **kwargs):
        with self.assertRaisesRegex(frappe.ValidationError, phrase):
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

    # -- single change ---------------------------------------------------------------------------
    def test_all_six_moves_work_each_writing_a_history_row(self):
        cheque = self._cheque()
        moves = [("Issued", "Cleared"), ("Cleared", "Issued"), ("Issued", "Cancelled"),
                 ("Cancelled", "Issued"), ("Issued", "Cancelled"), ("Cancelled", "Cleared"),
                 ("Cleared", "Cancelled")]
        for n, (_from, to) in enumerate(moves):
            result = change_cheque_status(cheque, to, note=f"move {n}")
            self.assertEqual(result["status"], to)
            self.assertEqual(self._status(cheque), to)
        self.assertEqual(
            self._history(cheque),
            [(None, "Issued", U, None)] + [(f, t, U, f"move {n}") for n, (f, t) in enumerate(moves)],
        )

    def test_cancel_without_a_note_is_refused(self):
        cheque = self._cheque()
        self._refused("Write a note saying why the cheque is cancelled", change_cheque_status, cheque, "Cancelled")
        self._refused("Write a note", change_cheque_status, cheque, "Cancelled", note="   ")
        self.assertEqual(self._status(cheque), "Issued")
        self.assertEqual(len(self._history(cheque)), 1)

    def test_no_hand_move_reaches_pending(self):
        # #1478: a Payment cheque is Pending only while its payments wait for approval.
        cheque = self._cheque()
        self._refused("Choose Issued, Cleared or Cancelled", change_cheque_status, cheque, "Pending")
        self.assertEqual(self._status(cheque), "Issued")

    def test_a_move_to_the_status_it_has_is_refused(self):
        cheque = self._cheque()
        self._refused("cannot be moved to Issued: already Issued", change_cheque_status, cheque, "Issued")

    def test_cancel_is_refused_while_a_lines_payment_is_paid(self):
        paid = self._plant("Paid")
        cheque = self._cheque(paid, self._plant("Approved"))
        self._refused(f"cannot be moved to Cancelled: payment {paid} is Paid", change_cheque_status, cheque,
                      "Cancelled", note="bounced")
        self.assertEqual(self._status(cheque), "Issued")

    def test_cancelling_leaves_every_linked_payment_as_it_was(self):
        requested = self._plant("Requested")
        pending = self._plant("Reconciliation Pending")
        cheque = self._cheque(requested, pending)
        fields = ["status", "mode_of_payment", "cheque"]
        before = {p: frappe.db.get_value(PAYMENT, p, fields) for p in (requested, pending)}

        change_cheque_status(cheque, "Cancelled", note="torn up")

        self.assertEqual(self._status(cheque), "Cancelled")
        for p, was in before.items():
            self.assertEqual(frappe.db.get_value(PAYMENT, p, fields), was)
        self.assertEqual(before[pending][0], "Reconciliation Pending")

    def test_un_cancelling_is_refused_when_a_payment_is_on_another_live_cheque(self):
        payment = self._plant("Requested")
        old = self._cheque(payment)
        change_cheque_status(old, "Cancelled", note="bounced")
        new = self._cheque(payment)
        new_no = frappe.db.get_value("Cheques", new, "cheque_no")

        for target in ("Issued", "Cleared"):
            self._refused(
                f"payment {payment} is already on cheque {new_no} \\(Issued\\)", change_cheque_status, old, target
            )
        self.assertEqual(self._status(old), "Cancelled")

    def test_un_cancelling_is_refused_once_a_payment_went_back_to_online(self):
        payment = self._plant("Requested")
        cheque = self._cheque(payment)
        change_cheque_status(cheque, "Cancelled", note="bounced")
        pay = frappe.get_doc(PAYMENT, payment)
        pay.mode_of_payment = "Online"
        pay.save()
        frappe.db.commit()

        self._refused(
            f"payment {payment} has left this cheque \\(it is Online now\\)", change_cheque_status, cheque, "Issued"
        )

    def test_un_cancelling_with_its_payments_still_on_it_works(self):
        payment = self._plant("Requested")
        cheque = self._cheque(payment)
        change_cheque_status(cheque, "Cancelled", note="by mistake")
        change_cheque_status(cheque, "Issued")
        self.assertEqual(self._status(cheque), "Issued")

    # -- bulk ------------------------------------------------------------------------------------
    def test_bulk_changes_the_movable_and_skips_the_rest_with_reasons(self):
        a, b, done = self._cheque(), self._cheque(), self._cheque()
        change_cheque_status(done, "Cleared")
        done_no = frappe.db.get_value("Cheques", done, "cheque_no")

        result = change_cheque_statuses(json.dumps([a, b, done]), "Cleared", note="ICICI statement 12 Oct")

        self.assertEqual([c["cheque"] for c in result["changed"]], [a, b])
        self.assertEqual(result["skipped"], [{"cheque": done, "cheque_no": done_no, "reason": "already Cleared"}])
        for c in (a, b):
            self.assertEqual(self._status(c), "Cleared")
            self.assertEqual(self._history(c)[1:], [("Issued", "Cleared", U, "ICICI statement 12 Oct")])
        self.assertEqual(len(self._history(done)), 2)  # created + its own single move; nothing from the bulk

    def test_bulk_cancel_skips_a_cheque_with_a_paid_payment_and_lists_pending_payments(self):
        paid = self._plant("Paid")
        pending = self._plant("Reconciliation Pending")
        blocked, ok = self._cheque(paid), self._cheque(pending)

        result = change_cheque_statuses([blocked, ok], "Cancelled", note="stopped")

        self.assertEqual([(c["cheque"], c["reconciliation_pending"]) for c in result["changed"]], [(ok, [pending])])
        self.assertEqual(
            [(s["cheque"], s["reason"]) for s in result["skipped"]], [(blocked, f"payment {paid} is Paid")]
        )
        self.assertEqual((self._status(blocked), self._status(ok)), ("Issued", "Cancelled"))
        self.assertEqual(frappe.db.get_value(PAYMENT, pending, "status"), "Reconciliation Pending")

    def test_bulk_cancel_without_a_note_is_refused_but_its_preview_is_not(self):
        cheque = self._cheque()
        self._refused("Write a note", change_cheque_statuses, [cheque], "Cancelled")

        preview = change_cheque_statuses([cheque], "Cancelled", dry_run="true")

        self.assertEqual([c["cheque"] for c in preview["changed"]], [cheque])
        self.assertEqual(self._status(cheque), "Issued")  # a preview writes nothing
        self.assertEqual(len(self._history(cheque)), 1)

    # -- access ----------------------------------------------------------------------------------
    def test_a_procurement_user_cannot_change_status(self):
        cheque = self._cheque()
        user = self._user(PROCUREMENT)
        with self.assertRaises(frappe.PermissionError):
            self._as(user, change_cheque_status, cheque, "Cleared")
        with self.assertRaises(frappe.PermissionError):
            self._as(user, change_cheque_statuses, [cheque], "Cleared")
        self.assertEqual(self._status(cheque), "Issued")

    def test_an_accountant_can_change_status(self):
        cheque = self._cheque()
        user = self._user((ACCOUNTANT,))
        self._as(user, change_cheque_status, cheque, "Cleared", note="banked")
        self.assertEqual(self._history(cheque)[-1], ("Issued", "Cleared", user, "banked"))

    # -- detail view -----------------------------------------------------------------------------
    def test_the_detail_view_shows_photo_lines_and_full_history(self):
        payment = self._plant("Requested", amount=30000)
        cheque = self._cheque(payment)
        change_cheque_status(cheque, "Cleared", note="banked")
        change_cheque_status(cheque, "Issued", note="bank returned it")
        # The fixture names a project by its ID; give it a name of its own. No hook reads project_name.
        frappe.db.set_value("Projects", self.project, "project_name", "Cheque Detail Tower")

        detail = get_cheque(cheque)

        self.assertEqual(detail["attachment"], PHOTO)
        self.assertEqual((detail["status"], detail["bank_label"]), ("Issued", "ICICI Bank"))
        self.assertEqual(
            [(l["record_name"], l["payment_name"], l["payment_status"], flt(l["amount"])) for l in detail["lines"]],
            [(self.sr, payment, "Requested", 30000.0)],
        )
        # The project by name, as the report row shows it, not its ID.
        self.assertEqual([(l["project"], l["project_name"]) for l in detail["lines"]], [(self.project, "Cheque Detail Tower")])
        self.assertEqual(
            [(h["from_status"], h["to_status"], h["note"]) for h in detail["history"]],
            [(None, "Issued", None), ("Issued", "Cleared", "banked"), ("Cleared", "Issued", "bank returned it")],
        )
        self.assertTrue(all(h["changed_by"] == U and h["changed_at"] for h in detail["history"]))

    def test_a_project_manager_cannot_open_the_detail_view(self):
        cheque = self._cheque()
        pm = self._user(("Nirmaan Project Manager Profile",))
        with self.assertRaises(frappe.PermissionError):
            self._as(pm, get_cheque, cheque)
