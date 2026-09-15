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


class TestLegsThisReversalCannotCorrectlyUndo(AllocationFixture):
    """⚠️ WHOLE-BRANCH REVIEW F5 -- THE TARGET DOCTYPE WAS THE ONLY TARGET GUARD, AND IT IS NOT
    ENOUGH. `_revert_payment` clears status / `utr` / `payment_date` and nothing else, but two of
    the other settle paths also write `Project Payments` legs and each leaves something durable
    behind: a `tds` figure on the record (the payments screen writes one; the import's old
    `_settle_as_deduction` path is REMOVED, ADR-0021), and `settle_row_partial` SPLITS it.
    Ruling O documented only the third case (an amount rewritten by `settle_row`), which is the one
    that is genuinely undetectable and is accepted.

    Today's UI never offers either -- the Reverse button renders only inside
    `AlreadyAllocatedSection` -- but this endpoint is whitelisted and must refuse them itself. Each
    refusal NAMES the rule and points at the payments screen, which is where both are repaired.
    """

    def test_a_payment_carrying_TDS_is_refused_and_writes_nothing(self):
        """The marker is `tds` on the record, whatever path put it there -- a reversal that put this
        payment back to `Approved` would leave a withheld-tax figure on money waiting to be paid
        again. Planted directly (no import path writes `tds` any more): the guard reads
        the payment's own state, and this pins the guard."""
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        frappe.db.set_value("Project Payments", a, "tds", 1.5, update_modified=False)
        with self.assertRaises(frappe.ValidationError):
            reverse_allocation(match=leg, reason="wrong PO")
        self.assertEqual(frappe.db.get_value(MATCH_DOCTYPE, leg, "match_kind"), "Settled")
        self.assertEqual(frappe.db.get_value("Project Payments", a, "status"), "Paid")

    def test_the_settled_half_of_a_SPLIT_payment_is_refused(self):
        """⚠️ THE MARKER IS A CHILD, NOT A FIELD ON THE RECORD ITSELF. `settle_row_partial` trims
        the ORIGINAL to the settled part and mints the balance as a fresh payment whose `split_from`
        points back -- so the settled half carries nothing, and only the existence of that sibling
        says what happened. Reversing it would not un-split anything: one sanction would silently
        become two Approved payments."""
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        balance = self._approved_payment("40")
        frappe.db.set_value("Project Payments", balance, "split_from", a, update_modified=False)
        with self.assertRaises(frappe.ValidationError):
            reverse_allocation(match=leg, reason="wrong PO")
        self.assertEqual(frappe.db.get_value(MATCH_DOCTYPE, leg, "match_kind"), "Settled")

    def test_the_carried_forward_BALANCE_half_is_refused_too(self):
        """Both directions. A balance half whose sibling is Paid is just as entangled as the half
        that was settled, and this one DOES carry the marker on itself.

        #1279 lets ONE kind of balance revert -- the leftover of a partial settle of its parent that
        still stands (`test_unreconcile_part_payment`). This parent has no settle at all."""
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        origin = self._approved_payment("40")
        frappe.db.set_value("Project Payments", a, "split_from", origin, update_modified=False)
        with self.assertRaises(frappe.ValidationError):
            reverse_allocation(match=leg, reason="wrong PO")
        self.assertEqual(frappe.db.get_value(MATCH_DOCTYPE, leg, "match_kind"), "Settled")

    def test_a_payment_whose_amount_moved_since_the_settle_is_refused(self):
        """⚠️ EXACT, NO TOLERANCE WINDOW (registered in `amounts.py` as the one comparison here that
        uses none). Both figures were written by the same settle from the same source, so ANY
        difference means the record was edited afterwards -- the same class of fact the existing
        utr/status guard refuses on."""
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        frappe.db.set_value("Project Payments", a, "amount", 61.0, update_modified=False)
        with self.assertRaises(frappe.ValidationError):
            reverse_allocation(match=leg, reason="wrong PO")
        self.assertEqual(frappe.db.get_value(MATCH_DOCTYPE, leg, "match_kind"), "Settled")

    def test_an_ordinary_allocation_leg_is_still_reversible(self):
        """⚠️ THE GUARD MUST NOT NARROW THE THING IT GUARDS. Every refusal above is planted state;
        the shape the screen actually produces has to keep working, or F5 would have closed the
        endpoint rather than fenced it."""
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        reverse_allocation(match=leg, reason="wrong PO")
        self.assertEqual(frappe.db.get_value(MATCH_DOCTYPE, leg, "match_kind"), "Reversed")


class TestAReversedLegIsNeverHardDeleted(AllocationFixture):
    """⚠️ WHOLE-BRANCH REVIEW F4 -- THE ADR'S OWN GUARANTEE, BROKEN BY A ROUTE IT DID NOT CONSIDER.
    "A wrong leg is soft-reversed, never deleted" is the entire justification for ADR-0020 D3 and
    for the partial unique index. Once EVERY leg is reversed, `_refresh_row_allocation` returns the
    row to `Matched`/`Mismatched` -- deliberately, so it can be reconsidered -- and both
    `match_batch` and `skip_row` then reach it and used to `frappe.db.delete` every match record on
    it, unscoped. The most natural next action after a reversal destroyed exactly the fact the
    reversal existed to keep."""

    def _reverse_everything(self):
        row, pays = self._allocated()
        for p in pays:
            leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": p}, "name")
            reverse_allocation(match=leg, reason="all wrong")
        self.assertEqual(
            frappe.db.count(MATCH_DOCTYPE, {"import_row": row, "match_kind": "Reversed"}), 3
        )
        return row

    def test_a_re_match_keeps_them(self):
        """⚠️ THE ROUTE F4 IS ACTUALLY ABOUT. A fully-reversed row is back to `Matched`/`Mismatched`,
        so it is MATCHABLE again and `_persist_row_outcome`'s delete reaches it -- unlike the
        `Partially Allocated` row `test_allocate_row` pins, which is frozen out of the run entirely.

        ⚠️ THIS RAN UNDER A `try: ... except TypeError` UNTIL THE REVIEW, AND IT NO LONGER DOES.
        `match_batch` on a single-row batch reaches `_resolve_stacks`'s abstain path (`stack_key`
        is `None` for a row with no `normalized_account`), which returned a bare `0` against a
        caller unpacking a 2-tuple. That defect is PRE-EXISTING -- 2026-08-11, `a5ff7bdc`, already
        on `develop` -- and was found only because this test had to swallow its `TypeError` to
        assert anything. It is fixed at `_resolve_stacks`, so the endpoint now runs to completion
        here, and this case pins BOTH facts at once: the whole match completes, and it leaves the
        `Reversed` legs alone.
        """
        from nirmaan_stack.api.outflow_import.review import match_batch

        row = self._reverse_everything()
        batch = frappe.db.get_value(ROW_DOCTYPE, row, "import_batch")
        match_batch(batch=batch)
        self.assertEqual(
            frappe.db.count(MATCH_DOCTYPE, {"import_row": row, "match_kind": "Reversed"}), 3
        )

    def test_a_skip_keeps_them(self):
        from nirmaan_stack.api.outflow_import.review import skip_row

        row = self._reverse_everything()
        skip_row(row=row, reason="not ours after all")
        self.assertEqual(
            frappe.db.count(MATCH_DOCTYPE, {"import_row": row, "match_kind": "Reversed"}), 3
        )

    def test_the_batch_screen_no_longer_reports_a_reversed_leg_as_settled(self):
        """⚠️ F3. `get_batch_rows` had no `match_kind` filter, and `rowSettlementLinks` maps every
        entry it returns to a "Payments Done" link -- so after a reversal the payment was back to
        `Approved` while the screen still showed this transfer as having paid it."""
        from nirmaan_stack.api.outflow_import.review import get_batch_rows

        row = self._reverse_everything()
        batch = frappe.db.get_value(ROW_DOCTYPE, row, "import_batch")
        rows = get_batch_rows(batch=batch)
        mine = [r for r in rows["rows"] if r["name"] == row]
        self.assertTrue(mine, "the staged row is missing from the batch read")
        self.assertEqual(mine[0].get("matches") or [], [])


class TestReversingALegSettledWithAResolvedReference(AllocationFixture):
    """⚠️ THE SIXTH SITE (ADR-0020 B9). `reverse_allocation` READS BACK what the payment write site
    wrote, and `_revert_payment` refuses to unwind a payment whose `utr` is not this transfer's.

    Since B9 the settle writes the resolved `settlement_reference`, which on a row with no bank
    reference is the GATEWAY's own. Left comparing `bank_reference_no`, that guard would see a
    stored `GW-...` against an expected `""` and refuse -- so exactly the 61 rows this slice exists
    for would settle and then be PERMANENTLY UN-REVERSIBLE, with a message blaming a third party
    for re-pointing the payment.

    B9 was specified as five WRITE sites. It is five writers and one reader of what they wrote, and
    no suite covered the pair until this one: settling such a row and then reversing it.
    """

    GATEWAY_REF = "GW-REV-7788"

    def _row_with_no_bank_reference(self, amount="100"):
        return self._staged_row(
            amount=amount,
            references={
                "bank_reference_no": "",
                "reference_id": self.GATEWAY_REF,
                "settlement_reference": self.GATEWAY_REF,
            },
        )

    def test_a_leg_settled_with_the_gateway_reference_reverses(self):
        row = self._row_with_no_bank_reference()
        pays = self._three_payments()
        allocate_row(row=row, targets=self._targets(pays))
        # Precondition: the settle really did write the resolved value, not a blank.
        self.assertEqual(
            frappe.db.get_value("Project Payments", pays[0], "utr"), self.GATEWAY_REF
        )

        leg = frappe.db.get_value(
            MATCH_DOCTYPE, {"import_row": row, "target_name": pays[0]}, "name"
        )
        reverse_allocation(match=leg, reason="wrong PO")

        self.assertEqual(
            frappe.db.get_value("Project Payments", pays[0], "status"), "Approved"
        )
        self.assertFalse(
            (frappe.db.get_value("Project Payments", pays[0], "utr") or "").strip()
        )
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_PARTIALLY_ALLOCATED
        )

    def test_the_re_pointed_guard_still_fires(self):
        """The positive control. The guard must still refuse a payment somebody else re-pointed --
        widening what it compares against must not have switched it off."""
        row = self._row_with_no_bank_reference()
        pays = self._three_payments()
        allocate_row(row=row, targets=self._targets(pays))
        frappe.db.set_value(
            "Project Payments", pays[0], "utr", "SOMEBODY-ELSE", update_modified=False
        )
        frappe.db.commit()

        leg = frappe.db.get_value(
            MATCH_DOCTYPE, {"import_row": row, "target_name": pays[0]}, "name"
        )
        with self.assertRaises(frappe.ValidationError):
            reverse_allocation(match=leg, reason="wrong PO")


class TestReversingAnICICILeg(AllocationFixture):
    """#1259: an ICICI settle writes the whole narration as `utr`, and the reversal must still
    recognise what it wrote -- AND what a settle made before #1259 wrote (the short reference), or
    every earlier ICICI settle becomes un-reversible with a message blaming somebody else."""

    ICICI = "ICICI Bank Statement"

    def _icici_row(self):
        reference = "7" + str(int(frappe.generate_hash(length=10), 16))[-11:].rjust(11, "0")
        narration = f"MMT/IMPS/{reference}/TEST VENDOR/UTIB0000052"
        row = self._staged_row(
            amount="100",
            references={
                "source": self.ICICI,
                "bank_reference_no": reference,
                "reference_id": "",
                "remarks": narration,
            },
        )
        return row, reference, narration

    def _leg(self, row, payment):
        return frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": payment}, "name")

    def test_a_leg_settled_with_the_narration_reverses(self):
        row, _, narration = self._icici_row()
        pays = self._three_payments()
        allocate_row(row=row, targets=self._targets(pays))
        self.assertEqual(frappe.db.get_value("Project Payments", pays[0], "utr"), narration)

        reverse_allocation(match=self._leg(row, pays[0]), reason="wrong PO")

        self.assertEqual(frappe.db.get_value("Project Payments", pays[0], "status"), "Approved")
        self.assertFalse((frappe.db.get_value("Project Payments", pays[0], "utr") or "").strip())

    def test_a_leg_settled_before_1259_with_the_short_reference_still_reverses(self):
        row, reference, _ = self._icici_row()
        pays = self._three_payments()
        allocate_row(row=row, targets=self._targets(pays))
        # What an earlier import wrote: the short reference, on the row's column and the payment.
        frappe.db.set_value(ROW_DOCTYPE, row, "settlement_reference", reference, update_modified=False)
        frappe.db.set_value("Project Payments", pays[0], "utr", reference, update_modified=False)
        frappe.db.commit()

        reverse_allocation(match=self._leg(row, pays[0]), reason="wrong PO")

        self.assertEqual(frappe.db.get_value("Project Payments", pays[0], "status"), "Approved")

    def test_a_re_pointed_icici_payment_is_still_refused(self):
        row, _, _ = self._icici_row()
        pays = self._three_payments()
        allocate_row(row=row, targets=self._targets(pays))
        frappe.db.set_value("Project Payments", pays[0], "utr", "SOMEBODY-ELSE", update_modified=False)
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError):
            reverse_allocation(match=self._leg(row, pays[0]), reason="wrong PO")
