# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Bulk approve and bulk reject decide a Payment cheque as one, across POs (#1481, spec #1477, ADR-0035).

Driven through the bulk endpoints the approval tabs call (`bulk_actions.bulk_lead_approve_payments`,
`bulk_ceo_approve_payments`) and the bulk dialog's read (`cheque_approval.get_cheque_groups`). Checked
through what a user sees: the endpoint's succeeded / failed lists, each payment's status and the reason on
it, the PO terms, and the Cheque's status and history.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Rows are planted by `PendingChequeCase` and purged
by its fixtures.
"""

from unittest.mock import patch

import frappe

from nirmaan_stack.api.payments import bulk_actions
from nirmaan_stack.api.payments.cheque_approval import get_cheque_groups
from nirmaan_stack.api.payments.test_cheque_approval import PAYMENT, RECON, PendingChequeCase

REASON = "Duplicate of the earlier request."


class TestBulkDecidesAChequeAsOne(PendingChequeCase):
    def setUp(self):
        super().setUp()
        # The run's summary note reaches real users: keep it off.
        quiet = patch.object(bulk_actions, "_emit_approve_summary")
        quiet.start()
        self.addCleanup(quiet.stop)

    def _lead(self, payments, action="approve", reason=None):
        return bulk_actions.bulk_lead_approve_payments(list(payments), action, reason)["data"]

    def _cheque_status(self, cheque):
        return frappe.db.get_value("Cheques", cheque, "status")

    # -- approve --------------------------------------------------------------------------------------
    def test_one_ticked_payment_approves_its_siblings_across_pos(self):
        a, b, c = self._payment(15000), self._payment(15000), self._payment(10000)  # three POs
        cheque = self._cheque((a, 15000), (b, 15000), (c, 10000))
        online = self._payment(20000)

        res = self._lead([b, online])

        self.assertEqual(sorted(res["succeeded"]), sorted([a, b, c, online]))
        self.assertEqual(res["failed"], [])
        self.assertEqual(self._statuses(a, b, c), [RECON] * 3)
        self.assertEqual(self._terms(a, b, c), [RECON] * 3)
        self.assertEqual(self._cheque_state(cheque)[:2], ("Issued", frappe.utils.nowdate()))
        self.assertEqual(self._statuses(online), ["Approved"])

    def test_ticking_every_sibling_still_decides_the_cheque_once(self):
        a, b = self._payment(20000), self._payment(40000)
        cheque = self._cheque((a, 20000), (b, 40000))

        res = self._lead([a, b])

        # The cheque total (₹60,000) sends both to the CEO, though each is under ₹50,000.
        self.assertEqual(sorted(res["succeeded"]), sorted([a, b]))
        self.assertEqual(self._statuses(a, b), ["CEO Pending"] * 2)
        self.assertEqual(self._cheque_status(cheque), "Approval Pending")

    def test_a_cheque_that_cannot_be_approved_fails_once_and_the_rest_goes_through(self):
        a, b = self._payment(20000), self._payment(25000)
        self._cheque((a, 20000), (b, 25000), amount=45006)
        online = self._payment(20000)

        res = self._lead([a, b, online])

        self.assertEqual(res["succeeded"], [online])
        self.assertEqual(len(res["failed"]), 1)
        self.assertIn("add up to ₹45,000, but the cheque is for ₹45,006", res["failed"][0]["reason"])
        self.assertEqual(sorted(res["failed"][0]["payments"]), sorted([a, b]))
        self.assertEqual(self._statuses(a, b), ["Requested"] * 2)

    def test_a_failure_on_one_sibling_rolls_the_whole_cheque_back(self):
        a, b, c = self._payment(15000), self._payment(15000), self._payment(10000)
        cheque = self._cheque((a, 15000), (b, 15000), (c, 10000))
        online = self._payment(20000)
        from nirmaan_stack.services import cheque_payments

        real, moves = cheque_payments.move_to_reconciliation, []

        def third_fails(name, **kwargs):
            moves.append(name)
            if len(moves) == 3:
                raise RuntimeError("boom")
            return real(name, **kwargs)

        with patch("nirmaan_stack.services.cheques.decide.move_to_reconciliation", side_effect=third_fails):
            res = self._lead([a, online])

        self.assertEqual(res["succeeded"], [online])
        self.assertEqual(len(res["failed"]), 1)
        self.assertEqual(self._statuses(a, b, c), ["Requested"] * 3)
        self.assertEqual(self._terms(a, b, c), ["Requested"] * 3)
        self.assertEqual(self._cheque_state(cheque), ("Approval Pending", None, [(None, "Approval Pending")]))
        self.assertEqual(self._statuses(online), ["Approved"])

    def test_the_ceo_approves_a_cheques_payments_together(self):
        a, b = self._payment(30000, "CEO Pending"), self._payment(40000, "CEO Pending")
        cheque = self._cheque((a, 30000), (b, 40000))

        res = self._as_ceo(bulk_actions.bulk_ceo_approve_payments, [a], "approve")["data"]

        self.assertEqual(sorted(res["succeeded"]), sorted([a, b]))
        self.assertEqual(self._statuses(a, b), [RECON] * 2)
        self.assertEqual(self._cheque_status(cheque), "Issued")

    # -- reject ---------------------------------------------------------------------------------------
    def test_bulk_reject_rejects_the_siblings_and_cancels_the_cheque(self):
        a, b = self._payment(20000), self._payment(25000)
        cheque = self._cheque((a, 20000), (b, 25000))
        online = self._payment(20000)

        res = self._lead([a, online], "reject", REASON)

        self.assertEqual(sorted(res["succeeded"]), sorted([a, b, online]))
        self.assertEqual(self._statuses(a, b, online), ["Rejected"] * 3)
        self.assertEqual(self._terms(a, b), ["Rejected"] * 2)
        self.assertEqual(self._cheque_status(cheque), "Cancelled")
        history = frappe.get_all(
            "Cheque Status History", filters={"parent": cheque}, fields=["from_status", "to_status", "note"],
            order_by="idx asc",
        )
        self.assertEqual((history[-1].from_status, history[-1].to_status, history[-1].note), ("Approval Pending", "Cancelled", REASON))
        for p in (a, b, online):  # the reason once on each, not twice on the cheque's payments
            self.assertEqual(
                frappe.get_all(
                    "Comment", filters={"reference_doctype": PAYMENT, "reference_name": p, "comment_type": "Comment"},
                    pluck="content",
                ),
                [f"Rejected: {REASON}"],
            )

    def test_bulk_ceo_reject_cancels_the_cheque(self):
        a, b = self._payment(30000, "CEO Pending"), self._payment(40000, "CEO Pending")
        cheque = self._cheque((a, 30000), (b, 40000))

        res = self._as_ceo(bulk_actions.bulk_ceo_approve_payments, [b], "reject", REASON)["data"]

        self.assertEqual(sorted(res["succeeded"]), sorted([a, b]))
        self.assertEqual(self._statuses(a, b), ["Rejected"] * 2)
        self.assertEqual(self._cheque_status(cheque), "Cancelled")

    # -- what the dialog reads ------------------------------------------------------------------------
    def test_the_dialog_reads_each_ticked_cheque_once_with_every_line(self):
        a, b = self._payment(20000), self._payment(25000)
        cheque = self._cheque((a, 20000), (b, 25000))
        online = self._payment(20000)

        groups = get_cheque_groups([a, online, b])

        self.assertEqual([g["cheque"] for g in groups], [cheque])
        self.assertEqual([line["payment"] for line in groups[0]["lines"]], [a, b])
