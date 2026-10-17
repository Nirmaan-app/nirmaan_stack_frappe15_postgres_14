# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rejecting one payment on a Payment cheque rejects every payment on it and cancels the cheque (#1481,
spec #1477, ADR-0035).

Driven through the routes that reject: the approval dialog's single reject
(`cheque_approval.reject_cheque_payments`, L1 and CEO), a payment saved straight to Rejected (the browser's
old write, REST, Desk), and the bulk lead and CEO rejects (`bulk_actions`). Checked through what a user
sees: each payment's status and the reason on it, the PO terms, the Cheque's status, lines and history.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Rows are planted by `PendingChequeCase` and purged
by its fixtures.
"""

from unittest.mock import patch

import frappe

from nirmaan_stack.api.payments.cheque_approval import approve_cheque_payments, reject_cheque_payments
from nirmaan_stack.api.payments.test_cheque_approval import PAYMENT, PendingChequeCase

REASON = "Vendor delivered short; to be re-raised after GRN."


class TestRejectAChequeTogether(PendingChequeCase):
    # -- reading ------------------------------------------------------------------------------------
    def _lines(self, cheque):
        return frappe.get_all(
            "Cheque Line", filters={"parent": cheque, "parenttype": "Cheques"}, pluck="payment_name", order_by="idx asc"
        )

    def _history(self, cheque):
        return [
            (h.from_status, h.to_status, h.note)
            for h in frappe.get_all(
                "Cheque Status History",
                filters={"parent": cheque, "parenttype": "Cheques"},
                fields=["from_status", "to_status", "note"],
                order_by="idx asc",
            )
        ]

    def _reasons(self, payment):
        return frappe.get_all(
            "Comment",
            filters={"reference_doctype": PAYMENT, "reference_name": payment, "comment_type": "Comment"},
            pluck="content",
        )

    # -- single reject ---------------------------------------------------------------------------------
    def test_l1_rejecting_one_payment_rejects_all_and_cancels_the_cheque(self):
        a, b, c = self._payment(15000), self._payment(15000), self._payment(10000)
        cheque = self._cheque((a, 15000), (b, 15000), (c, 10000))

        out = reject_cheque_payments(b, REASON)

        self.assertEqual(sorted(out["payments"]), sorted([a, b, c]))
        self.assertEqual(self._statuses(a, b, c), ["Rejected"] * 3)
        self.assertEqual(self._terms(a, b, c), ["Rejected"] * 3)
        self.assertEqual(frappe.db.get_value("Cheques", cheque, "status"), "Cancelled")
        self.assertEqual(self._history(cheque)[-1], ("Pending", "Cancelled", REASON))
        # A Cancelled cheque keeps its lines: it stays the record of what it would have paid.
        self.assertEqual(self._lines(cheque), [a, b, c])
        for p in (a, b, c):
            self.assertEqual(self._reasons(p), [f"Rejected: {REASON}"])

    def test_the_ceo_rejecting_one_payment_rejects_all_across_pos(self):
        a, b = self._payment(30000, "CEO Pending"), self._payment(40000, "CEO Pending")
        cheque = self._cheque((a, 30000), (b, 40000))

        out = self._as_ceo(reject_cheque_payments, a, REASON, "ceo")

        self.assertIn("All 2 payments", out["message"])
        self.assertEqual(self._statuses(a, b), ["Rejected"] * 2)
        self.assertEqual(self._terms(a, b), ["Rejected"] * 2)
        self.assertEqual(self._history(cheque)[-1], ("Pending", "Cancelled", REASON))

    def test_a_reason_is_required(self):
        a = self._payment(20000)
        cheque = self._cheque((a, 20000))
        with self.assertRaisesRegex(frappe.ValidationError, "reason is required"):
            reject_cheque_payments(a, "   ")
        self.assertEqual(self._statuses(a), ["Requested"])
        self.assertEqual(frappe.db.get_value("Cheques", cheque, "status"), "Pending")

    def test_a_payment_no_longer_at_the_step_is_refused(self):
        a = self._payment(30000, "CEO Pending")
        self._cheque((a, 30000))
        with self.assertRaisesRegex(frappe.ValidationError, f"{a} is CEO Pending, not Requested"):
            reject_cheque_payments(a, REASON, "lead")
        self.assertEqual(self._statuses(a), ["CEO Pending"])

    def test_only_the_ceo_rejects_at_the_ceo_step(self):
        a = self._payment(30000, "CEO Pending")
        self._cheque((a, 30000))
        with self.assertRaises(frappe.PermissionError):
            reject_cheque_payments(a, REASON, "ceo")
        self.assertEqual(self._statuses(a), ["CEO Pending"])

    # -- any other save path --------------------------------------------------------------------------
    def _save_rejected(self, payment):
        """The browser's old write, REST, Desk: the status saved straight to Rejected, no reason asked."""
        doc = frappe.get_doc(PAYMENT, payment)
        doc.status = "Rejected"
        doc.save()

    def test_saving_one_payment_to_rejected_rejects_the_rest_and_cancels_the_cheque(self):
        a, b = self._payment(20000), self._payment(25000)
        cheque = self._cheque((a, 20000), (b, 25000))

        self._save_rejected(a)
        frappe.db.commit()

        note = f"Payment {a} was rejected, so every payment on the cheque is rejected and the cheque is cancelled."
        self.assertEqual(self._statuses(a, b), ["Rejected"] * 2)
        self.assertEqual(self._terms(a, b), ["Rejected"] * 2)
        self.assertEqual(frappe.db.get_value("Cheques", cheque, "status"), "Cancelled")
        self.assertEqual(self._history(cheque)[-1], ("Pending", "Cancelled", note))
        self.assertEqual(self._lines(cheque), [a, b])
        self.assertEqual(self._reasons(b), [f"Rejected: {note}"])

    def test_the_cascade_stays_inside_the_callers_savepoint(self):
        a, b = self._payment(20000), self._payment(25000)
        cheque = self._cheque((a, 20000), (b, 25000))

        frappe.db.savepoint("caller")
        self._save_rejected(a)
        frappe.db.rollback(save_point="caller")
        frappe.db.commit()

        # Nothing in the cascade committed, so rolling the caller back undoes all of it.
        self.assertEqual(self._statuses(a, b), ["Requested"] * 2)
        self.assertEqual(frappe.db.get_value("Cheques", cheque, "status"), "Pending")

    def test_rejecting_a_payment_of_an_issued_cheque_cancels_it_too(self):
        a, b = self._payment(20000), self._payment(25000)
        cheque = self._cheque((a, 20000), (b, 25000))
        approve_cheque_payments(a)
        self.assertEqual(frappe.db.get_value("Cheques", cheque, "status"), "Issued")

        self._save_rejected(b)
        frappe.db.commit()

        self.assertEqual(self._statuses(a, b), ["Rejected"] * 2)
        self.assertEqual(self._terms(a, b), ["Rejected"] * 2)
        self.assertEqual(self._history(cheque)[-1][:2], ("Issued", "Cancelled"))

    def test_an_old_type_cheque_still_drops_the_rejected_line(self):
        a, b = self._payment(20000), self._payment(25000)
        cheque = self._cheque((a, 20000), (b, 25000))
        frappe.db.set_value("Cheques", cheque, {"old_type": 1, "status": "Issued"})  # raw: test setup
        frappe.db.commit()

        self._save_rejected(a)
        frappe.db.commit()

        self.assertEqual(self._statuses(a, b), ["Rejected", "Requested"])
        self.assertEqual(self._lines(cheque), [b])
        self.assertEqual(frappe.db.get_value("Cheques", cheque, "status"), "Issued")
