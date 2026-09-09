# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Undoing one leg of an allocation (ADR-0020 D3/D4)."""

import frappe

from nirmaan_stack.api.outflow_import.expenses import allocate_row, reverse_allocation, settle_row
from nirmaan_stack.api.outflow_import.test_allocate_row import AllocationFixture
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
)

MATCH_DOCTYPE = "Outflow Row Match"
ROW_DOCTYPE = "Outflow Import Row"


class TestReversingALeg(AllocationFixture):
    def _allocated(self, amount="100"):
        row = self._staged_row(amount=amount)
        pays = self._three_payments()
        allocate_row(row=row, targets=self._targets(pays))
        return row, pays

    def test_the_payment_returns_to_approved_with_no_utr(self):
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        reverse_allocation(match=leg, reason="wrong PO")
        self.assertEqual(frappe.db.get_value("Project Payments", a, "status"), "Approved")
        self.assertFalse((frappe.db.get_value("Project Payments", a, "utr") or "").strip())
        self.assertIsNone(frappe.db.get_value("Project Payments", a, "payment_date"))

    def test_the_record_is_kept_and_stamped(self):
        """SOFT reverse. The mistake stays auditable -- that is the whole difference from a delete."""
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        reverse_allocation(match=leg, reason="wrong PO")
        doc = frappe.db.get_value(
            MATCH_DOCTYPE, leg, ["match_kind", "reversed_by", "reversal_reason"], as_dict=True
        )
        self.assertEqual(doc.match_kind, "Reversed")
        self.assertEqual(doc.reversal_reason, "wrong PO")
        self.assertTrue(doc.reversed_by)

    def test_the_row_drops_from_settled_back_to_partially_allocated(self):
        row, (a, _, _) = self._allocated()
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_SETTLED)
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        result = reverse_allocation(match=leg, reason="wrong PO")
        self.assertEqual(result["row_status"], ROW_PARTIALLY_ALLOCATED)
        self.assertEqual(float(result["remaining"]), 60.0)

    def test_reversing_every_leg_returns_the_row_to_an_open_status(self):
        row, pays = self._allocated()
        for p in pays:
            leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": p}, "name")
            result = reverse_allocation(match=leg, reason="all wrong")
        self.assertIn(result["row_status"], (ROW_MATCHED, ROW_MISMATCHED))
        self.assertEqual(float(result["allocated"]), 0.0)

    def test_the_same_payment_can_be_allocated_again_afterwards(self):
        """⚠️ THE PARTIAL UNIQUE INDEX EARNING ITS KEEP. With a plain unique key the reversed row
        would still hold (transfer, target) and this would fail with an IntegrityError."""
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        reverse_allocation(match=leg, reason="mis-clicked")
        allocate_row(row=row, targets=self._targets([a]))
        self.assertEqual(frappe.db.get_value("Project Payments", a, "status"), "Paid")
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_SETTLED
        )
        # Both records survive: one Reversed, one Settled.
        self.assertEqual(
            frappe.db.count(MATCH_DOCTYPE, {"import_row": row, "target_name": a}), 2
        )


class TestRefusals(AllocationFixture):
    def _allocated(self, amount="100"):
        row = self._staged_row(amount=amount)
        pays = self._three_payments()
        allocate_row(row=row, targets=self._targets(pays))
        return row, pays

    def test_a_reason_is_required(self):
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        with self.assertRaises(frappe.ValidationError):
            reverse_allocation(match=leg, reason="   ")

    def test_an_already_reversed_leg_cannot_be_reversed_twice(self):
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        reverse_allocation(match=leg, reason="wrong PO")
        with self.assertRaises(frappe.ValidationError):
            reverse_allocation(match=leg, reason="again")

    def test_a_payment_someone_else_changed_is_refused_and_writes_nothing(self):
        """The payment is no longer the one that was settled. Refuse rather than guess."""
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        frappe.db.set_value("Project Payments", a, "utr", "SOMEONE-ELSE")
        with self.assertRaises(frappe.ValidationError):
            reverse_allocation(match=leg, reason="wrong PO")
        self.assertEqual(
            frappe.db.get_value(MATCH_DOCTYPE, leg, "match_kind"), "Settled"
        )


class TestRulingOKnownLimit(AllocationFixture):
    """⚠️ RULING O, PINNED. `reverse_allocation` accepts ANY match record, including one written
    by the ordinary 1:1 `settle_row` -- and THAT path rewrites the payment's amount to the bank's
    figure when the two differ within the settle window (slice X1), unlike the allocation path
    (`allocate_row`, `rewrite_amount_to_bank=False`), which never touches it. The two are
    indistinguishable after the fact -- `leg.target_amount == payment.amount` either way -- so a
    reversal cannot know which happened and cannot restore a pre-settle figure it was never given.
    This documents the behaviour rather than pretending it does not exist: the CORRECTED amount
    survives a reversal of a `settle_row` leg. The pre-settle figure lives only in the payment's
    `Version` log, which `reversed_amount` in the response exists to point a human at."""

    def test_reversing_a_settle_row_leg_leaves_the_corrected_amount_in_place(self):
        row = self._staged_row(amount="103")
        payment = self._approved_payment("100")
        settle_row(row=row, target_doctype="Project Payments", target_name=payment)
        # The settle window (Rs 5) rewrote the payment's amount to the bank's figure.
        self.assertEqual(float(frappe.db.get_value("Project Payments", payment, "amount")), 103.0)

        leg = frappe.db.get_value(
            MATCH_DOCTYPE, {"import_row": row, "target_name": payment}, "name"
        )
        result = reverse_allocation(match=leg, reason="wrong pick")

        # The payment returns to Approved, but its amount is NOT restored to 100 -- that figure
        # was never stored anywhere reversal can read it back from.
        self.assertEqual(frappe.db.get_value("Project Payments", payment, "status"), "Approved")
        self.assertEqual(float(frappe.db.get_value("Project Payments", payment, "amount")), 103.0)
        self.assertEqual(float(result["reversed_amount"]), 103.0)
