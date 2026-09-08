# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""One transfer, many payments, allocated over several calls (ADR-0020)."""

import json

import frappe

from nirmaan_stack.api.outflow_import.expenses import allocate_row
from nirmaan_stack.api.outflow_import.test_settle_payment import PaymentSettlementFixture
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
)

MATCH_DOCTYPE = "Outflow Row Match"
ROW_DOCTYPE = "Outflow Import Row"


class AllocationFixture(PaymentSettlementFixture):
    """A Rs 100 transfer and three approved payments of Rs 60 / Rs 30 / Rs 10.

    Deliberately NOT the real Rs 2,13,396 group: round numbers make an assertion legible, and the
    real group is exercised in the pure `test_allocation` suite where no fixtures are needed.
    """

    def _three_payments(self):
        return [self._approved_payment(amount) for amount in ("60", "30", "10")]

    def _targets(self, payments):
        return json.dumps(
            [{"target_doctype": "Project Payments", "target_name": p} for p in payments]
        )


class TestAllocatingInOneGo(AllocationFixture):
    def test_three_payments_in_one_call_settle_the_row(self):
        row = self._staged_row(amount="100")
        pays = self._three_payments()
        result = allocate_row(row=row, targets=self._targets(pays))
        self.assertEqual(result["row_status"], ROW_SETTLED)
        self.assertEqual(float(result["remaining"]), 0.0)
        for p in pays:
            self.assertEqual(frappe.db.get_value("Project Payments", p, "status"), "Paid")

    def test_every_leg_gets_its_own_match_record(self):
        row = self._staged_row(amount="100")
        allocate_row(row=row, targets=self._targets(self._three_payments()))
        self.assertEqual(
            frappe.db.count(MATCH_DOCTYPE, {"import_row": row, "match_kind": "Settled"}), 3
        )

    def test_every_leg_carries_the_RAW_bank_reference(self):
        """⚠️ NOT decorated. ADR-0020 D2 -- the re-import duplicate guard and tier 0 both compare
        the raw string, so a "(part 1/3)" suffix is invisible to them."""
        row = self._staged_row(amount="100")
        reference = frappe.db.get_value(ROW_DOCTYPE, row, "bank_reference_no")
        pays = self._three_payments()
        allocate_row(row=row, targets=self._targets(pays))
        for p in pays:
            self.assertEqual(frappe.db.get_value("Project Payments", p, "utr"), reference)

    def test_no_payment_amount_is_rewritten_to_the_transfer(self):
        """⚠️ THE RED EDGE. Without `rewrite_amount_to_bank=False` leg 1 would become Rs 100."""
        row = self._staged_row(amount="100")
        pays = self._three_payments()
        allocate_row(row=row, targets=self._targets(pays))
        amounts = sorted(
            float(frappe.db.get_value("Project Payments", p, "amount")) for p in pays
        )
        self.assertEqual(amounts, [10.0, 30.0, 60.0])


class TestAllocatingOverSeveralSittings(AllocationFixture):
    def test_the_row_reads_partially_allocated_between_calls(self):
        row = self._staged_row(amount="100")
        a, b, c = self._three_payments()
        first = allocate_row(row=row, targets=self._targets([a]))
        self.assertEqual(first["row_status"], ROW_PARTIALLY_ALLOCATED)
        self.assertEqual(float(first["remaining"]), 40.0)
        second = allocate_row(row=row, targets=self._targets([b, c]))
        self.assertEqual(second["row_status"], ROW_SETTLED)
        self.assertEqual(float(second["remaining"]), 0.0)

    def test_a_partially_allocated_row_is_frozen_against_a_re_match(self):
        """⚠️ THE SAFETY ARGUMENT FOR ADR-0020. `_persist_row_outcome` ends with
        `frappe.db.delete(MATCH_DOCTYPE, {"import_row": ...})`. If the status were not frozen, a
        re-run would delete the settlement evidence while the payments stayed Paid."""
        from nirmaan_stack.api.outflow_import.review import match_batch

        row = self._staged_row(amount="100")
        a, _, _ = self._three_payments()
        allocate_row(row=row, targets=self._targets([a]))
        batch = frappe.db.get_value(ROW_DOCTYPE, row, "import_batch")
        match_batch(batch=batch)
        self.assertEqual(
            frappe.db.count(MATCH_DOCTYPE, {"import_row": row, "match_kind": "Settled"}), 1
        )
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_PARTIALLY_ALLOCATED
        )

    def test_a_partially_allocated_row_cannot_be_skipped(self):
        from nirmaan_stack.api.outflow_import.review import skip_row

        row = self._staged_row(amount="100")
        a, _, _ = self._three_payments()
        allocate_row(row=row, targets=self._targets([a]))
        with self.assertRaises(frappe.ValidationError):
            skip_row(row=row, reason="changed my mind")


class TestRefusals(AllocationFixture):
    def test_over_allocation_is_refused_and_writes_nothing(self):
        row = self._staged_row(amount="50")
        pays = self._three_payments()  # 60 + 30 + 10
        with self.assertRaises(frappe.ValidationError):
            allocate_row(row=row, targets=self._targets(pays))
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row}), 0)
        for p in pays:
            self.assertEqual(
                frappe.db.get_value("Project Payments", p, "status"), "Approved"
            )
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_MATCHED)

    def test_a_failing_leg_rolls_back_every_earlier_leg_in_the_same_call(self):
        """⚠️ ONE SAVEPOINT OVER ALL N. A half-landed tick-set leaves a remaining balance nobody
        can explain -- which is why this is one call taking N targets, not N calls."""
        row = self._staged_row(amount="100")
        a, b, _ = self._three_payments()
        frappe.db.set_value("Project Payments", b, "status", "Paid")
        with self.assertRaises(frappe.ValidationError):
            allocate_row(row=row, targets=self._targets([a, b]))
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row}), 0)
        self.assertEqual(frappe.db.get_value("Project Payments", a, "status"), "Approved")

    def test_a_credit_row_is_refused(self):
        row = self._staged_row(amount="100", direction="Credit")
        with self.assertRaises(Exception):
            allocate_row(row=row, targets=self._targets(self._three_payments()[:1]))

    def test_the_same_payment_twice_in_one_call_is_refused(self):
        row = self._staged_row(amount="100")
        a, _, _ = self._three_payments()
        with self.assertRaises(frappe.ValidationError):
            allocate_row(row=row, targets=self._targets([a, a]))

    def test_an_empty_target_list_is_refused(self):
        row = self._staged_row(amount="100")
        with self.assertRaises(frappe.ValidationError):
            allocate_row(row=row, targets=json.dumps([]))

    def test_a_settled_row_cannot_be_allocated_again(self):
        row = self._staged_row(amount="100")
        allocate_row(row=row, targets=self._targets(self._three_payments()))
        extra = self._approved_payment("5")
        with self.assertRaises(frappe.ValidationError):
            allocate_row(row=row, targets=self._targets([extra]))


class TestTheOrdinarySettleIsUntouched(AllocationFixture):
    def test_settle_row_still_refuses_a_payment_that_does_not_match_the_transfer(self):
        """`settle_row` keeps its STRICT guard. Only `allocate_row` bounds against the remainder."""
        from nirmaan_stack.api.outflow_import.expenses import settle_row
        from nirmaan_stack.services.outflow_import.settle import AmountMismatchError

        row = self._staged_row(amount="100")
        small = self._approved_payment("10")
        with self.assertRaises(AmountMismatchError):
            settle_row(row=row, target_doctype="Project Payments", target_name=small)
