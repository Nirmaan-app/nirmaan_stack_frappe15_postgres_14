# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the PAYMENT write path (Bulk Import Outflow, slice V2).

⚠️ THIS IS THE HALF v2 DELETED, so there is no prior suite to inherit assumptions from. v2's spine
was "the payment branch never writes"; the owner reversed it, and everything here exercises the
reversal.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every payment and PO this suite touches is one it created,
tracked and purged in `tearDown` -- per TEST, not per class, because every test here moves money.
See the fixture's docstring.

The properties that matter, in the order they would hurt if they broke:

  1. SAVEPOINT ISOLATION. Bulk confirm is the selling point, so "Confirm 8" must never leave four
     rows written and four not. A payment save fires two hooks that each committed mid-save until
     V2, and a commit inside the savepoint makes the rollback a silent no-op -- the failure mode is
     a HALF-WRITTEN settlement that looks fine.
  2. ONLY `Approved` SETTLES, re-asserted under a row lock rather than trusting the screen.
  3. `amount_paid` RECOMPUTED EXACTLY ONCE, and inside the transaction, so a rolled-back settlement
     takes the total with it.
  4. NO DOUBLE SETTLE, guarded twice over: the status re-assertion and the `Outflow Row Match`
     unique constraint.
"""

import unittest
from dataclasses import replace

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    settle_expense,
    settle_row,
    settle_row_partial,
)
from nirmaan_stack.services.outflow_import.partial_settle import (
    INTENT_DEDUCTION,
    INTENT_PART_PAYMENT,
)
from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE, match_batch
from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE, _stage_batch
from nirmaan_stack.services.outflow_import.parser import parse_statement
from nirmaan_stack.services.outflow_import.settle import (
    AlreadyPaidError,
    AmountMismatchError,
    DuplicateReferenceError,
    WrongStatusError,
)

PAYMENT = "Project Payments"
FIXTURE = (
    frappe.get_app_path("nirmaan_stack")
    + "/services/outflow_import/tests/fixtures/cashfree_sample.csv"
)


def _fresh_parse():
    with open(FIXTURE, "rb") as handle:
        parsed = parse_statement(handle.read(), source="Cashfree")
    prefix = frappe.generate_hash(length=10)
    return replace(
        parsed,
        rows=tuple(replace(r, transfer_id=f"{prefix}-{r.transfer_id}") for r in parsed.rows),
    )


class PaymentSettlementFixture(unittest.TestCase):
    """Stages a batch, plants one APPROVED payment per settleable row, and runs the match.

    ⚠️ PER TEST, NOT PER CLASS, AND THAT IS NOT AN OVERSIGHT. Every test here MOVES MONEY: it flips
    payments to Paid and drives a Procurement Order's `amount_paid`. A class-level fixture makes
    those mutations leak between tests in alphabetical order, and the symptom is not a clean error
    -- the first draft of this suite read `amount_paid` as 37,000 instead of 5,000 and looked
    exactly like the recompute being wrong. A financial assertion that depends on which test ran
    first is worse than no assertion, because it will eventually pass for the wrong reason.

    The cost is one batch stage plus a match run per test. Measured at a few seconds for the suite,
    which is the right trade for assertions about money.
    """

    def setUp(self):
        super().setUp()
        self.batches, self.payments, self.pos = [], [], []
        self.parsed = _fresh_parse()
        self.batch = _stage_batch(
            self.parsed,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        self.batches.append(self.batch.name)
        self.project = frappe.db.get_value("Projects", {}, "name")
        self.po = self._insert_po()
        self.planted = {}
        for suffix in ("0001", "0003", "0004", "0006", "0007", "0008"):
            row = self._row(suffix)
            self.planted[suffix] = self._insert_payment(
                amount=float(row.amount), status="Approved",
                utr=row.bank_reference_no, payment_date=row.added_on.date(),
            )
        frappe.db.commit()
        match_batch(self.batch.name)

    def _row(self, suffix):
        return next(r for r in self.parsed.rows if r.transfer_id.endswith(suffix))

    def _insert_po(self):
        """A Procurement Order to hang `amount_paid` off, inserted raw for the same reason the
        payments are: going through the document lifecycle would need a PR, a vendor and a category
        tree to obtain a column this suite only ever reads back."""
        name = f"TEST-OFI-PO-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabProcurement Orders"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    project, amount_paid)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 0)""",
            (name, "Administrator", "Administrator", self.project),
        )
        self.pos.append(name)
        return name

    def _insert_payment(self, *, amount, status, utr, payment_date, link_po=True):
        """Raw insert, bypassing the document lifecycle.

        Going through `new_doc(...).insert()` fires `before_insert`, which resolves a real PO to
        validate the running total, and `on_update`, which recomputes that PO's `amount_paid` and
        commits. This suite runs against the live development database, and it exists to observe
        those very hooks -- planting the fixture through them would mean the arrangement and the
        assertion share a mechanism.
        """
        name = f"TEST-OFI-PAY-{frappe.generate_hash(length=12)}"
        frappe.db.sql(
            """INSERT INTO "tabProject Payments"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    project, amount, status, utr, payment_date,
                    document_type, document_name)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s, %s)""",
            (name, "Administrator", "Administrator", self.project, float(amount), status,
             utr, payment_date,
             "Procurement Orders" if link_po else None, self.po if link_po else None),
        )
        self.payments.append(name)
        return name

    def tearDown(self):
        frappe.db.delete(MATCH_DOCTYPE, {"import_batch": ["in", self.batches]})
        for name in self.batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        if self.payments:
            # X1 routes the settle through `doc.save()` on a `track_changes` doctype, so each
            # settlement now mints a Version row. This suite writes to the LIVE database, so its
            # audit residue is purged with the payments it describes.
            frappe.db.delete(
                "Version", {"ref_doctype": PAYMENT, "docname": ["in", self.payments]}
            )
        for name in self.payments:
            frappe.db.delete(PAYMENT, {"name": name})
        for name in self.pos:
            frappe.db.delete("Procurement Orders", {"name": name})
        frappe.db.commit()
        super().tearDown()

    def _po_amount_paid(self) -> float:
        return float(frappe.db.get_value("Procurement Orders", self.po, "amount_paid") or 0)

    def _import_row(self, suffix):
        """The FIRST staged row for this transfer suffix.

        ⚠️ ORDERED, and it has to be. The fixture statement repeats transfer 0001 deliberately, so
        two rows carry that id -- the second is auto-skipped as an in-file duplicate. An unordered
        lookup returns either, which made this suite fail against a `Skipped` row and look like a
        settlement bug rather than an ambiguous fixture query.
        """
        rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch.name, "transfer_id": ["like", f"%{suffix}"]},
            fields=["name", "row_status", "amount"],
            order_by="creation asc",
            limit=1,
        )
        self.assertTrue(rows, f"no staged row for transfer suffix {suffix}")
        return frappe._dict(rows[0])


class TestTheHappyPath(PaymentSettlementFixture):
    def test_an_approved_payment_settles_to_paid(self):
        row = self._import_row("0001")
        self.assertEqual(row.row_status, "Matched")

        settle_row(row.name, PAYMENT, self.planted["0001"])

        after = frappe.db.get_value(
            PAYMENT, self.planted["0001"], ["status", "utr", "tds"], as_dict=True
        )
        self.assertEqual(after.status, "Paid")
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, row.name, "row_status"), "Settled"
        )

    def test_no_tds_figure_is_ever_written(self):
        """`tds` is recorded at fulfilment by a human who knows the deduction. This import does not
        know it, and inventing one would corrupt a number the finance team reconciles against."""
        row = self._import_row("0003")
        settle_row(row.name, PAYMENT, self.planted["0003"])
        self.assertFalse(frappe.db.get_value(PAYMENT, self.planted["0003"], "tds"))

    def test_the_settlement_records_a_match_row(self):
        row = self._import_row("0004")
        settle_row(row.name, PAYMENT, self.planted["0004"])
        matches = frappe.get_all(
            MATCH_DOCTYPE,
            filters={"import_row": row.name},
            fields=["match_kind", "target_doctype", "target_name"],
        )
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["match_kind"], "Settled")
        self.assertEqual(matches[0]["target_doctype"], PAYMENT)
        self.assertEqual(matches[0]["target_name"], self.planted["0004"])


class TestAmountPaidIsRecomputedExactlyOnce(PaymentSettlementFixture):
    def test_the_parent_total_lands_and_counts_only_paid_payments(self):
        """The hook still runs -- only its COMMIT is suppressed. If this reads 0 the suppression
        went too far and every PO's paid total silently stops tracking reality."""
        row = self._import_row("0001")
        amount = float(frappe.db.get_value(PAYMENT, self.planted["0001"], "amount"))

        settle_row(row.name, PAYMENT, self.planted["0001"])

        total = self._po_amount_paid()
        self.assertEqual(total, amount)

    def test_a_second_settlement_on_the_same_po_accumulates_rather_than_replaces(self):
        first = self._import_row("0003")
        second = self._import_row("0004")
        settle_row(first.name, PAYMENT, self.planted["0003"])
        settle_row(second.name, PAYMENT, self.planted["0004"])

        expected = sum(
            float(frappe.db.get_value(PAYMENT, self.planted[s], "amount"))
            for s in ("0003", "0004")
        )
        total = self._po_amount_paid()
        self.assertEqual(total, expected)


class TestTheAmountIsCorrectedToTheBank(PaymentSettlementFixture):
    """Slice X1 -- the record takes the amount the bank actually moved (owner ruling 2026-08-09).

    This REVERSES the earlier accepted position that "the paise difference is not recorded". Both
    directions, and the audit is the Version log, which is why the write goes through `doc.save()`.
    """

    def _shift_planted(self, suffix, delta):
        """Move the planted payment off the bank amount by `delta`, still inside the settle window.

        ⚠️ IT MOVES THE PLANTED PAYMENT RATHER THAN PLANTING A SECOND ONE, and the reason is the
        reference guard: the fixture already put this row's UTR on this payment, so settling the
        row against any OTHER payment is refused by `_assert_reference_is_free` before an amount is
        ever compared. A second payment would test the UTR guard, not the rewrite.
        """
        row = self._import_row(suffix)
        shifted = round(float(row.amount) + delta, 2)
        frappe.db.set_value(
            PAYMENT, self.planted[suffix], "amount", shifted, update_modified=False
        )
        frappe.db.commit()
        return row, shifted

    def test_a_payment_short_by_paise_takes_the_bank_amount(self):
        """The owner's own example: an 18,678.69 payment settled from an 18,679.00 transfer ends up
        at 18,679.00. Before X1 it stayed at 18,678.69 and the 31 paise was absorbed."""
        row, shifted = self._shift_planted("0001", -0.31)
        self.assertNotEqual(shifted, float(row.amount))  # precondition, not the assertion

        settle_row(row.name, PAYMENT, self.planted["0001"])

        after = frappe.db.get_value(
            PAYMENT, self.planted["0001"], ["amount", "status"], as_dict=True
        )
        self.assertEqual(float(after.amount), float(row.amount))
        self.assertEqual(after.status, "Paid")

    def test_a_payment_the_bank_OVERPAID_also_takes_the_bank_amount(self):
        """⚠️ THE DELIBERATE HALF. The bank moved MORE than was approved and the record takes the
        larger figure, so this import can record spending above an approval. Owner ruling, made
        with that consequence stated. If this test is ever "fixed" to assert the approved amount
        survived, the ruling changed -- check before believing the test."""
        row, _ = self._shift_planted("0003", -4.00)  # record LOW, bank HIGH

        settle_row(row.name, PAYMENT, self.planted["0003"])

        self.assertEqual(
            float(frappe.db.get_value(PAYMENT, self.planted["0003"], "amount")),
            float(row.amount),
        )

    def test_an_equal_amount_is_left_exactly_as_it_was(self):
        """The ordinary case must stay a no-op. `rewrite_amount` returns None on an equal pair
        precisely so an unchanged settlement does not mint a Version row claiming a change."""
        row = self._import_row("0004")
        before = float(frappe.db.get_value(PAYMENT, self.planted["0004"], "amount"))
        self.assertEqual(before, float(row.amount))  # precondition

        settle_row(row.name, PAYMENT, self.planted["0004"])

        self.assertEqual(
            float(frappe.db.get_value(PAYMENT, self.planted["0004"], "amount")), before
        )

    def test_the_correction_is_recorded_in_the_version_log(self):
        """⚠️ THE AUDIT IS THE WHOLE REASON THIS IS SAFE TO DO. An amount rewritten with no record
        of who changed it or what it had been is an unattributable edit to an approved figure. The
        Version row exists only because the write goes through `doc.save()` on a `track_changes`
        doctype -- a `set_value` write would leave nothing."""
        row, _ = self._shift_planted("0006", -0.68)

        settle_row(row.name, PAYMENT, self.planted["0006"])

        versions = frappe.get_all(
            "Version",
            filters={"ref_doctype": PAYMENT, "docname": self.planted["0006"]},
            fields=["data"],
        )
        self.assertTrue(versions, "no Version row recorded the amount correction")
        self.assertTrue(
            any("amount" in (v.get("data") or "") for v in versions),
            "a Version exists but does not mention the amount",
        )

    def test_the_parent_total_uses_the_CORRECTED_amount(self):
        """`update_parent_amount_paid` SUMS the paid payments, so it picks the rewrite up on its
        own. Pinned rather than reasoned about: if it ever incremented instead, the PO's paid total
        would carry the pre-correction figure and disagree with the payment beneath it."""
        row, _ = self._shift_planted("0007", -0.90)

        settle_row(row.name, PAYMENT, self.planted["0007"])

        self.assertEqual(self._po_amount_paid(), float(row.amount))

    def test_the_row_note_says_the_amount_was_corrected(self):
        """The import's own screen is where somebody asks "why is this 31 paise off what I
        approved". The Version log holds the fact durably; the note is what surfaces it."""
        row, shifted = self._shift_planted("0008", -0.14)

        settle_row(row.name, PAYMENT, self.planted["0008"])

        note = frappe.db.get_value(ROW_DOCTYPE, row.name, "outcome_note") or ""
        self.assertIn("corrected", note.lower())
        self.assertIn(str(shifted), note.replace(",", ""))

    def test_the_result_reports_what_was_written_not_what_was_found(self):
        """`SettleResult.amount` changed meaning at X1. The bulk-confirm surface shows the delta per
        row, so a result still reporting the pre-settle figure would report the number it just
        replaced -- on the one screen that most needs the truth."""
        row, shifted = self._shift_planted("0001", -0.31)

        summary = settle_row(row.name, PAYMENT, self.planted["0001"])

        self.assertEqual(summary["settled"]["amount"], float(row.amount))
        self.assertEqual(summary["settled"]["original_amount"], shifted)
        self.assertTrue(summary["settled"]["amount_changed"])


class TestRefusals(PaymentSettlementFixture):
    def test_a_ceo_pending_payment_is_refused_by_name(self):
        """Re-asserted UNDER THE LOCK, not trusted from the screen. The screen's snapshot can be
        minutes old, and it is not the authority on what may be paid."""
        row = self._import_row("0006")
        frappe.db.set_value(PAYMENT, self.planted["0006"], "status", "CEO Pending")
        with self.assertRaises(WrongStatusError):
            settle_row(row.name, PAYMENT, self.planted["0006"])
        self.assertEqual(
            frappe.db.get_value(PAYMENT, self.planted["0006"], "status"), "CEO Pending"
        )

    def test_an_already_paid_payment_is_refused_DISTINCTLY(self):
        """A distinct error type, not a shared sentence. A bulk confirm has to tell "somebody beat
        me to it" (retry pointless, refresh) from "this was never settleable" (a different fix),
        and the canonical fulfil path throws one message for both."""
        row = self._import_row("0007")
        frappe.db.set_value(PAYMENT, self.planted["0007"], "status", "Paid")
        with self.assertRaises(AlreadyPaidError):
            settle_row(row.name, PAYMENT, self.planted["0007"])

    def test_an_amount_that_disagrees_is_refused(self):
        """A TDS payment reaches here -- the bank sent `amount - tds` -- and is refused, which is
        the accepted cost of deferring the tolerance pass (Q11). It goes through the existing
        payments screen, unchanged and always available (Q12)."""
        row = self._import_row("0008")
        frappe.db.set_value(
            PAYMENT, self.planted["0008"], "amount", float(row.amount) + 100
        )
        with self.assertRaises(AmountMismatchError):
            settle_row(row.name, PAYMENT, self.planted["0008"])
        self.assertEqual(
            frappe.db.get_value(PAYMENT, self.planted["0008"], "status"), "Approved"
        )

    def test_a_reference_already_on_another_payment_is_refused(self):
        """Owner ruling Q4: a fan-out is report-only, settled by hand, which is exactly why this
        guard is never legitimately challenged and stays as it is."""
        row = self._import_row("0001")
        other = self._insert_payment(
            amount=float(row.amount), status="Approved",
            utr=self._row("0001").bank_reference_no, payment_date=None, link_po=False,
        )
        frappe.db.commit()
        with self.assertRaises(DuplicateReferenceError):
            settle_row(row.name, PAYMENT, self.planted["0001"])
        self.assertEqual(frappe.db.get_value(PAYMENT, other, "status"), "Approved")

    def test_the_deprecated_alias_cannot_settle_a_payment(self):
        """`settle_expense` predates the payment path. A caller still on that name has not opted
        into paying payments, and silently widening what it writes is the surprise this feature
        must not produce."""
        row = self._import_row("0003")
        with self.assertRaises(frappe.ValidationError):
            settle_expense(row.name, PAYMENT, self.planted["0003"])


class TestSavepointIsolation(PaymentSettlementFixture):
    def test_a_failure_leaves_earlier_rows_written_and_later_rows_attemptable(self):
        """⚠️ THE ONE THAT JUSTIFIES THE WHOLE HOOK-SUPPRESSION CHANGE.

        Settles four rows in order, arranging the THIRD to fail. Afterwards rows 1-2 must be
        written, row 3 untouched, and row 4 must still settle -- "Confirm 8" must never leave four
        written and four not, with no record of which.

        Before V2 this could not hold: `update_parent_amount_paid` and the notification cascade
        each committed inside the save, so the rollback of row 3 would have been a silent no-op and
        left a half-written settlement behind.
        """
        order = ["0001", "0003", "0004", "0006"]
        rows = {s: self._import_row(s) for s in order}

        # Row 3 of 4 is made unsettleable AFTER the screen saw it -- the realistic shape of the
        # failure, and the one the lock exists to catch.
        frappe.db.set_value(PAYMENT, self.planted["0004"], "status", "Rejected")
        frappe.db.commit()

        settle_row(rows["0001"].name, PAYMENT, self.planted["0001"])
        settle_row(rows["0003"].name, PAYMENT, self.planted["0003"])
        with self.assertRaises(WrongStatusError):
            settle_row(rows["0004"].name, PAYMENT, self.planted["0004"])
        settle_row(rows["0006"].name, PAYMENT, self.planted["0006"])

        for settled in ("0001", "0003", "0006"):
            self.assertEqual(
                frappe.db.get_value(PAYMENT, self.planted[settled], "status"), "Paid", settled
            )
            self.assertEqual(
                frappe.db.get_value(ROW_DOCTYPE, rows[settled].name, "row_status"), "Settled"
            )

        # The failed row: nothing written anywhere, not even a match record.
        self.assertEqual(frappe.db.get_value(PAYMENT, self.planted["0004"], "status"), "Rejected")
        self.assertNotEqual(
            frappe.db.get_value(ROW_DOCTYPE, rows["0004"].name, "row_status"), "Settled"
        )
        self.assertEqual(
            frappe.db.count(MATCH_DOCTYPE, {"import_row": rows["0004"].name}), 0
        )

    def test_the_parent_total_reflects_the_survivors_only(self):
        """The corollary: a rolled-back settlement must take its share of `amount_paid` with it.
        This is what makes recomputing INSIDE the transaction stronger than the normal path, where
        the hook's own commit would have banked the total before the row failed."""
        rows = {s: self._import_row(s) for s in ("0001", "0004")}
        frappe.db.set_value(PAYMENT, self.planted["0004"], "status", "Rejected")
        frappe.db.commit()

        settle_row(rows["0001"].name, PAYMENT, self.planted["0001"])
        with self.assertRaises(WrongStatusError):
            settle_row(rows["0004"].name, PAYMENT, self.planted["0004"])

        expected = float(frappe.db.get_value(PAYMENT, self.planted["0001"], "amount"))
        total = self._po_amount_paid()
        self.assertEqual(total, expected)


class TestDoubleSettleIsRefused(PaymentSettlementFixture):
    def test_settling_the_same_row_twice_is_refused_and_writes_once(self):
        """Guarded twice over, and both guards matter: the status re-assertion catches the second
        attempt first, and the `Outflow Row Match` unique key on
        (transfer_id, target_doctype, target_name) is the backstop if it ever does not."""
        row = self._import_row("0001")
        settle_row(row.name, PAYMENT, self.planted["0001"])

        with self.assertRaises(frappe.ValidationError):
            settle_row(row.name, PAYMENT, self.planted["0001"])

        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row.name}), 1)
        self.assertEqual(
            frappe.db.get_value(PAYMENT, self.planted["0001"], "status"), "Paid"
        )

    def test_a_settled_row_is_never_re_matched(self):
        """`Settled` is terminal and frozen. A re-run of the match must not reconsider it, or the
        row would leave `Settled` and become confirmable a second time."""
        row = self._import_row("0003")
        settle_row(row.name, PAYMENT, self.planted["0003"])
        match_batch(self.batch.name)
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, row.name, "row_status"), "Settled"
        )
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row.name}), 1)


class TestTheStatementIsAttachedToWhatItSettled(PaymentSettlementFixture):
    """The settled payment carries the statement it was settled from (owner ruling 2026-08-10).

    ⚠️ THE FIXTURE'S `source_file` IS WHAT MAKES THIS TESTABLE AT ALL. `_stage_batch` is called with
    `file_url="/private/files/test-statement.csv"`, so the batch has something to copy. A fixture
    that staged without one would let every assertion here pass vacuously -- there would be nothing
    to attach, and "no attachment written" is exactly what the blank case looks like.
    """

    STATEMENT = "/private/files/test-statement.csv"

    def test_a_blank_payment_attachment_takes_the_statement(self):
        row = self._import_row("0001")
        payment = self.planted["0001"]
        self.assertFalse(frappe.db.get_value(PAYMENT, payment, "payment_attachment"))

        settle_row(row.name, PAYMENT, payment)

        self.assertEqual(
            frappe.db.get_value(PAYMENT, payment, "payment_attachment"), self.STATEMENT
        )

    def test_an_existing_payment_attachment_is_never_overwritten(self):
        """The blank-only rule, which is the whole of the owner's ruling on this write.

        `payment_attachment` is where an accountant puts the proof of THIS payment -- a signed
        receipt, a screenshot of the transfer. Replacing that with a thousand-row statement swaps
        specific evidence for general evidence, on a field nobody asked us to touch.
        """
        row = self._import_row("0003")
        payment = self.planted["0003"]
        proof = "/private/files/the-real-receipt.pdf"
        frappe.db.set_value(PAYMENT, payment, "payment_attachment", proof, update_modified=False)
        frappe.db.commit()

        settle_row(row.name, PAYMENT, payment)

        self.assertEqual(frappe.db.get_value(PAYMENT, payment, "payment_attachment"), proof)
        # And the settlement itself still happened -- the attachment rule must never gate the money.
        self.assertEqual(frappe.db.get_value(PAYMENT, payment, "status"), "Paid")

    def test_the_attachment_rides_the_same_save_as_the_settlement(self):
        """One write, one Version, one savepoint.

        The attachment is set on the document BEFORE `doc.save()` rather than written afterwards,
        so a settlement that rolls back cannot leave an attachment pointing at a payment it never
        settled. Asserting it lands in the same audit entry as the status flip is the cheapest
        available proof that it was not a second write.
        """
        row = self._import_row("0004")
        payment = self.planted["0004"]
        settle_row(row.name, PAYMENT, payment)

        versions = frappe.get_all(
            "Version",
            filters={"ref_doctype": PAYMENT, "docname": payment},
            fields=["data"],
        )
        self.assertTrue(versions, "the settle must be audited at all")
        changed = "\n".join(v["data"] or "" for v in versions)
        self.assertIn("payment_attachment", changed)
        self.assertIn("status", changed)


class PartialSettlementFixture(PaymentSettlementFixture):
    """The base fixture plus a PO that can actually carry a split: items, and one payment term.

    ⚠️ THE ITEM ROW IS NOT DECORATION -- the same trap `test_payment_split` documents.
    `ProcurementOrders.validate` recomputes `total_amount` from the `items` child table on EVERY
    save, and a partial settlement SAVES the PO (that is the whole point of the term surgery). A PO
    planted without items has its total silently rewritten to 0 the first time this code touches it,
    and the next payment insert then trips `ProjectPayments.before_insert`. That failure looks
    exactly like a bug in the split.
    """

    PO_TOTAL = 900000.0
    RECORD = 500000.0
    BANK = 200000.0
    BALANCE = 300000.0

    def setUp(self):
        super().setUp()

        # ⚠️ THE INHERITED FIXTURE PLANTS EACH ROW'S PAYMENT CARRYING THAT ROW'S OWN BANK REFERENCE,
        # which is exactly right for the ordinary settle it was written for -- and fatal here. The
        # UTR guard refuses a reference already sitting on another payment (it is what makes a
        # fan-out settle by hand, ruling Q4), so a partial settlement of a DIFFERENT payment would
        # be refused by a decoy the fixture planted rather than by anything under test. Clearing the
        # references leaves those payments intact for the base class's own tests and removes the
        # interference from this one; the rollback test below plants its own decoy deliberately.
        if self.payments:
            frappe.db.sql(
                """UPDATE "tabProject Payments" SET utr = NULL WHERE name IN %(names)s""",
                {"names": tuple(self.payments)},
            )

        self.split_po = self._insert_po_with_items(self.PO_TOTAL)
        self.big_payment = self._insert_payment(
            amount=self.RECORD, status="Approved", utr=None, payment_date=None, link_po=False
        )
        frappe.db.set_value(
            PAYMENT, self.big_payment,
            {"document_type": "Procurement Orders", "document_name": self.split_po},
            update_modified=False,
        )
        self.term = self._insert_split_term(
            self.split_po, amount=self.RECORD, label="Advance Payment",
            project_payment=self.big_payment,
        )
        # The transfer that pays only part of it.
        self.partial_row = self._import_row("0001")
        frappe.db.set_value(
            ROW_DOCTYPE, self.partial_row.name, "amount", self.BANK, update_modified=False
        )
        frappe.db.commit()

    def tearDown(self):
        # Children minted by the split are not in `self.payments`, so purge by the link.
        children = frappe.get_all(
            PAYMENT, filters={"split_from": ["in", self.payments or [""]]}, pluck="name"
        )
        for name in children:
            frappe.db.delete("Version", {"ref_doctype": PAYMENT, "docname": name})
            frappe.db.delete(PAYMENT, {"name": name})
        frappe.db.delete("PO Payment Terms", {"parent": self.split_po})
        frappe.db.delete("Purchase Order Item", {"parent": self.split_po})
        frappe.db.delete("Procurement Orders", {"name": self.split_po})
        super().tearDown()

    def _insert_po_with_items(self, total):
        name = f"TEST-OFI-SPO-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabProcurement Orders"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    project, total_amount, amount, tax_amount, amount_paid, status)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, 0, 0, '')""",
            (name, "Administrator", "Administrator", self.project, float(total), float(total)),
        )
        frappe.db.sql(
            """INSERT INTO "tabPurchase Order Item"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    parent, parenttype, parentfield,
                    item_name, unit, category, quantity, quote, amount, tax_amount, total_amount)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 1, %s, 'Procurement Orders', 'items',
                       'Test Line', 'Nos', 'Test Category', 1, %s, %s, 0, %s)""",
            (frappe.generate_hash(length=10), "Administrator", "Administrator",
             name, float(total), float(total), float(total)),
        )
        return name

    def _insert_split_term(self, po_name, *, amount, label, project_payment):
        name = frappe.generate_hash(length=10)
        frappe.db.sql(
            """INSERT INTO "tabPO Payment Terms"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    parent, parenttype, parentfield,
                    label, amount, percentage, payment_type, due_date,
                    term_status, project_payment, project, vendor)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 1, %s, 'Procurement Orders', 'payment_terms',
                       %s, %s, %s, 'Delivery against Payment', NULL,
                       'Approved', %s, %s, NULL)""",
            (name, "Administrator", "Administrator", po_name, label, float(amount),
             str(float(amount) / float(self.PO_TOTAL) * 100), project_payment, self.project),
        )
        return name

    def _terms(self):
        return frappe.get_all(
            "PO Payment Terms",
            filters={"parent": self.split_po, "parenttype": "Procurement Orders"},
            fields=["label", "amount", "term_status", "project_payment"],
            order_by="idx asc",
        )

    def _balance_of(self, parent):
        return frappe.get_all(PAYMENT, filters={"split_from": parent}, pluck="name")


class TestPartialSettlementHappyPath(PartialSettlementFixture):
    """One approved payment, two bank transfers. The case the whole slice exists for."""

    def test_the_record_is_split_and_only_the_bank_half_is_paid(self):
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)

        kept = frappe.db.get_value(
            PAYMENT, self.big_payment, ["amount", "status"], as_dict=True
        )
        self.assertEqual(float(kept.amount), self.BANK)
        self.assertEqual(kept.status, "Paid")

        balance_names = self._balance_of(self.big_payment)
        self.assertEqual(len(balance_names), 1, "exactly one balance payment")
        balance = frappe.db.get_value(
            PAYMENT, balance_names[0], ["amount", "status", "ceo_approval_date"], as_dict=True
        )
        self.assertEqual(float(balance.amount), self.BALANCE)
        self.assertEqual(balance.status, "Approved", "already sanctioned money stays sanctioned")

    def test_the_two_halves_sum_to_what_was_approved(self):
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)
        balance = self._balance_of(self.big_payment)[0]
        total = float(frappe.db.get_value(PAYMENT, self.big_payment, "amount")) + float(
            frappe.db.get_value(PAYMENT, balance, "amount")
        )
        self.assertAlmostEqual(total, self.RECORD, places=2)

    def test_the_po_records_only_the_money_that_actually_moved(self):
        """⚠️ THE REASON THE SPLIT SHAPE WORKS AT ALL. `update_parent_amount_paid` SUMS the Paid
        payments rather than incrementing, so a PO paid in two halves reports the right total with
        no new code. If it ever starts incrementing, this is what goes red."""
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)
        self.assertAlmostEqual(
            float(frappe.db.get_value("Procurement Orders", self.split_po, "amount_paid") or 0),
            self.BANK,
            places=2,
        )

    def test_the_po_terms_split_and_still_add_up(self):
        """⚠️ TRAP T3, AND THE ONE JOINT REASONING COULD NOT SETTLE. TWO writers want this PO: the
        split writes both term rows and saves it, then `settle_payment` flips the status to Paid,
        which fires `_find_and_update_po_term` -- a FRESH `frappe.get_doc` and a second save, inside
        the same transaction. This asserts the second read saw the first write instead of
        overwriting it.
        """
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)
        terms = self._terms()
        self.assertEqual(len(terms), 2)

        kept, balance = terms[0], terms[1]
        self.assertAlmostEqual(float(kept.amount), self.BANK, places=2)
        self.assertEqual(kept.term_status, "Paid", "the settled half's term followed its payment")
        self.assertEqual(kept.project_payment, self.big_payment)

        self.assertAlmostEqual(float(balance.amount), self.BALANCE, places=2)
        self.assertEqual(balance.term_status, "Approved")
        self.assertEqual(balance.label, "Advance Payment (Balance)")
        self.assertEqual(balance.project_payment, self._balance_of(self.big_payment)[0])

        self.assertAlmostEqual(
            sum(float(t.amount) for t in terms), self.RECORD, places=2,
            msg="the PO card warns when its terms stop summing",
        )

    def test_the_import_row_settles_against_the_half_that_was_paid(self):
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, self.partial_row.name, "row_status"), "Settled"
        )
        matches = frappe.get_all(
            MATCH_DOCTYPE,
            filters={"import_row": self.partial_row.name},
            fields=["target_doctype", "target_name", "target_amount"],
        )
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["target_name"], self.big_payment)
        self.assertAlmostEqual(float(matches[0]["target_amount"]), self.BANK, places=2)

    def test_the_balance_is_findable_from_the_response(self):
        summary = settle_row_partial(
            self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT
        )
        self.assertEqual(
            summary["partial"]["remainder_payment"], self._balance_of(self.big_payment)[0]
        )
        self.assertAlmostEqual(summary["partial"]["remainder_amount"], self.BALANCE, places=2)
        self.assertAlmostEqual(summary["partial"]["original_amount"], self.RECORD, places=2)

    def test_both_halves_say_what_the_reviewer_declared(self):
        """⚠️ THE JUDGEMENT IS WRITTEN DOWN, not implied by a balance existing. The alternative
        reading -- a deduction -- would have produced no balance at all, so someone reading this
        payment later needs to see that a person asserted the rest is still owed."""
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)
        balance = self._balance_of(self.big_payment)[0]
        for name in (self.big_payment, balance):
            comments = frappe.get_all(
                "Comment",
                filters={"reference_doctype": PAYMENT, "reference_name": name,
                         "comment_type": "Comment"},
                pluck="content",
            )
            self.assertTrue(comments, f"{name} carries no provenance")
            self.assertIn("balance", " ".join(comments).lower())


class TestPartialSettlementRefusals(PartialSettlementFixture):
    def _assert_nothing_happened(self):
        frappe.db.commit()
        row = frappe.db.get_value(
            PAYMENT, self.big_payment, ["amount", "status"], as_dict=True
        )
        self.assertEqual(float(row.amount), self.RECORD)
        self.assertEqual(row.status, "Approved")
        self.assertEqual(self._balance_of(self.big_payment), [], "a refusal must mint nothing")
        self.assertEqual(len(self._terms()), 1, "a refusal must add no PO term")

    def test_no_intent_is_refused(self):
        """⚠️ THE ABSENCE OF A DEFAULT IS THE PRODUCT. A part payment and a TDS deduction are
        indistinguishable in the data; assuming either one creates or destroys a balance that a
        person never asked for."""
        for bad in ("", "   ", "maybe", "PART_PAYMENT"):
            with self.subTest(intent=bad):
                with self.assertRaises(frappe.ValidationError):
                    settle_row_partial(self.partial_row.name, self.big_payment, bad)
        self._assert_nothing_happened()

    def test_a_declared_deduction_is_routed_away_rather_than_split(self):
        """The record was paid in full and something was withheld. Splitting it would invent a
        balance that is not owed -- the exact phantom this slice must not create."""
        with self.assertRaises(frappe.ValidationError) as caught:
            settle_row_partial(self.partial_row.name, self.big_payment, INTENT_DEDUCTION)
        self.assertIn("payments screen", str(caught.exception))
        self._assert_nothing_happened()

    def test_a_gap_inside_the_settle_window_is_refused_as_an_ordinary_settle(self):
        frappe.db.set_value(
            ROW_DOCTYPE, self.partial_row.name, "amount", self.RECORD - 2, update_modified=False
        )
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError) as caught:
            settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)
        self.assertIn("Confirm", str(caught.exception))
        self._assert_nothing_happened()

    def test_an_overpayment_is_refused(self):
        frappe.db.set_value(
            ROW_DOCTYPE, self.partial_row.name, "amount", self.RECORD + 50000,
            update_modified=False,
        )
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError):
            settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)
        self._assert_nothing_happened()

    def test_a_payment_that_is_not_approved_is_refused(self):
        for status in ("CEO Pending", "Requested", "Paid", "Rejected"):
            with self.subTest(status=status):
                frappe.db.set_value(
                    PAYMENT, self.big_payment, "status", status, update_modified=False
                )
                frappe.db.commit()
                with self.assertRaises(frappe.ValidationError):
                    settle_row_partial(
                        self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT
                    )
        frappe.db.set_value(
            PAYMENT, self.big_payment, "status", "Approved", update_modified=False
        )
        self._assert_nothing_happened()

    def test_the_ordinary_settle_still_refuses_this_payment(self):
        """⚠️ PROOF THAT NOTHING WAS WIDENED. `settle_row` must still refuse an out-of-window
        payment -- the partial path is a separate, human-opened door, not a relaxation of the
        settle window that gates every other write in this feature."""
        with self.assertRaises(AmountMismatchError):
            settle_row(self.partial_row.name, PAYMENT, self.big_payment)
        self._assert_nothing_happened()


class TestPartialSettlementIsAllOrNothing(PartialSettlementFixture):
    def test_a_failed_settle_rolls_the_split_back_and_leaves_no_orphan(self):
        """⚠️ THE STATE THIS MAKES UNREACHABLE: a payment partitioned for a settlement that never
        happened. Recoverable, but a document nobody asked for -- and nothing on any screen would
        say where it came from.

        Forced through the UTR guard: another payment already holds this transfer's reference, so
        the split succeeds and `settle_payment` then refuses.
        """
        reference = frappe.db.get_value(
            ROW_DOCTYPE, self.partial_row.name, "bank_reference_no"
        )
        self.assertTrue(reference, "fixture precondition: the transfer carries a reference")
        self._insert_payment(
            amount=1234.0, status="Paid", utr=reference, payment_date=None, link_po=False
        )
        frappe.db.commit()

        with self.assertRaises(DuplicateReferenceError):
            settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)

        frappe.db.commit()
        self.assertEqual(
            self._balance_of(self.big_payment), [], "the split must not survive the failed settle"
        )
        self.assertEqual(
            float(frappe.db.get_value(PAYMENT, self.big_payment, "amount")), self.RECORD
        )
        self.assertEqual(
            frappe.db.get_value(PAYMENT, self.big_payment, "status"), "Approved"
        )
        self.assertEqual(len(self._terms()), 1)


class DeductionFixture(PartialSettlementFixture):
    """A SERVICE payment whose transfer is exactly 1% short — the shape the live ledger shows.

    Measured 2026-08-12 over 671 Paid payments carrying a TDS figure: 505 sit at exactly 1.00% and
    60 at exactly 2.00%. The fixture is those numbers, not invented ones.
    """

    RECORD = 100000.0
    BANK = 99000.0     # 1% short
    TDS = 1000.0

    def setUp(self):
        super().setUp()
        # The base fixture links the big payment to a PO. A deduction is service-only, so point it
        # at a Service Request instead -- and SRs carry no payment terms, which is why nothing here
        # touches the term machinery.
        self.sr = self._insert_service_request(self.RECORD)
        frappe.db.set_value(
            PAYMENT, self.big_payment,
            {"document_type": "Service Requests", "document_name": self.sr,
             "amount": self.RECORD},
            update_modified=False,
        )
        frappe.db.set_value(
            ROW_DOCTYPE, self.partial_row.name, "amount", self.BANK, update_modified=False
        )
        frappe.db.commit()

    def tearDown(self):
        frappe.db.delete("Service Requests", {"name": self.sr})
        super().tearDown()

    def _insert_service_request(self, total):
        name = f"TEST-OFI-SR-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabService Requests"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    project, total_amount, amount_paid, status, gst)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 0, 'Approved', 'false')""",
            (name, "Administrator", "Administrator", self.project, float(total)),
        )
        return name

    def _pay(self):
        return frappe.db.get_value(
            PAYMENT, self.big_payment, ["amount", "status", "tds", "utr"], as_dict=True
        )


class TestTheDeductionSettles(DeductionFixture):
    def test_the_tds_is_written_and_the_payment_goes_paid(self):
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_DEDUCTION)
        after = self._pay()
        self.assertEqual(after.status, "Paid")
        self.assertEqual(float(after.tds), self.TDS)

    def test_the_amount_is_NOT_rewritten_to_the_bank_figure(self):
        """⚠️ THE LOAD-BEARING ASSERTION OF THIS SLICE. X1 makes an ordinary settle take the bank's
        number; a deduction settle must not, or the invoiced figure the tax was computed from is
        destroyed and `tds` ends up describing a gap that no longer exists."""
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_DEDUCTION)
        self.assertEqual(float(self._pay().amount), self.RECORD)

    def test_amount_minus_tds_reconciles_the_transfer_exactly(self):
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_DEDUCTION)
        after = self._pay()
        self.assertAlmostEqual(float(after.amount) - float(after.tds), self.BANK, places=2)

    def test_no_balance_payment_is_created(self):
        """A deduction means the payment was settled IN FULL and something was withheld. Creating a
        balance would be the phantom the partial-settlement slice exists to avoid, pointed the
        other way."""
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_DEDUCTION)
        self.assertEqual(self._balance_of(self.big_payment), [])

    def test_the_stored_tds_matches_the_manual_fulfil_path_shape(self):
        """⚠️ THE COLUMN IS `Data`, SO NOTHING DEFENDS ITS FORMAT. `_fulfil_payment` writes
        `flt(...)`, which Frappe stores as '1000.0'. A third shape ('1,000', '1000.00') would make
        the column unreadable by the numeric CAST the reports rely on."""
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_DEDUCTION)
        self.assertEqual(frappe.db.get_value(PAYMENT, self.big_payment, "tds"), "1000.0")

    def test_the_row_settles_and_the_response_reports_the_deduction(self):
        summary = settle_row_partial(self.partial_row.name, self.big_payment, INTENT_DEDUCTION)
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, self.partial_row.name, "row_status"), "Settled"
        )
        self.assertAlmostEqual(summary["deduction"]["tds"], self.TDS, places=2)
        self.assertAlmostEqual(summary["deduction"]["implied_pct"], 1.0, places=4)

    def test_a_two_percent_deduction_also_settles(self):
        frappe.db.set_value(
            ROW_DOCTYPE, self.partial_row.name, "amount", 98000.0, update_modified=False
        )
        frappe.db.commit()
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_DEDUCTION)
        self.assertEqual(float(self._pay().tds), 2000.0)

    def test_the_payment_says_what_the_reviewer_declared_and_at_what_rate(self):
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_DEDUCTION)
        comments = " ".join(frappe.get_all(
            "Comment",
            filters={"reference_doctype": PAYMENT, "reference_name": self.big_payment,
                     "comment_type": "Comment"},
            pluck="content",
        )).lower()
        self.assertIn("deduction", comments)
        self.assertIn("1.00%", comments)

    def test_residue_on_an_approved_payment_is_replaced_not_reconciled(self):
        """⚠️ THE OWNER'S INVARIANT, EXERCISED. `tds` is empty on an approved payment by rule; the 39
        live rows that carry one are residue from an un-fulfil that bypassed the document lifecycle.
        The gate never reads the field, so a stale figure is simply overwritten by the one this
        transfer implies -- and `track_changes` records the replacement."""
        frappe.db.set_value(PAYMENT, self.big_payment, "tds", "77777.0", update_modified=False)
        frappe.db.commit()
        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_DEDUCTION)
        self.assertEqual(float(self._pay().tds), self.TDS)


class TestTheDeductionRefusals(DeductionFixture):
    def _assert_nothing_happened(self):
        frappe.db.commit()
        after = self._pay()
        self.assertEqual(after.status, "Approved")
        self.assertEqual(float(after.amount), self.RECORD)
        self.assertFalse((after.tds or "").strip() not in ("", "0", "0.0"),
                         "a refusal must write no TDS")

    def test_a_procurement_order_payment_is_refused_and_says_where_to_go(self):
        """⚠️ THE SERVER READS THE PARENT DOCTYPE ITSELF. The screen mirrors this rule for UX, but a
        payload field is not evidence -- this is the only thing standing between the path and a
        materials PO."""
        frappe.db.set_value(
            PAYMENT, self.big_payment,
            {"document_type": "Procurement Orders", "document_name": self.split_po},
            update_modified=False,
        )
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError) as caught:
            settle_row_partial(self.partial_row.name, self.big_payment, INTENT_DEDUCTION)
        self.assertIn("service payments", str(caught.exception))
        self._assert_nothing_happened()

    def test_a_rate_outside_the_band_is_refused(self):
        for bank, label in ((60000.0, "40%"), (95000.0, "5%"), (99900.0, "0.1%")):
            with self.subTest(rate=label):
                frappe.db.set_value(
                    ROW_DOCTYPE, self.partial_row.name, "amount", bank, update_modified=False
                )
                frappe.db.commit()
                with self.assertRaises(frappe.ValidationError) as caught:
                    settle_row_partial(
                        self.partial_row.name, self.big_payment, INTENT_DEDUCTION
                    )
                self.assertIn("1-2%", str(caught.exception))
        self._assert_nothing_happened()

    def test_an_expense_cannot_carry_a_deduction(self):
        expense = self._insert_project_expense_row(self.RECORD)
        with self.assertRaises(frappe.ValidationError):
            settle_row_partial(self.partial_row.name, expense, INTENT_DEDUCTION)

    def _insert_project_expense_row(self, amount):
        name = f"TEST-OFI-EXP-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """INSERT INTO "tabProject Expenses"
                   (name, creation, modified, modified_by, owner, docstatus, idx,
                    projects, status, amount, description)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 'Approved', %s, 'test')""",
            (name, "Administrator", "Administrator", self.project, str(amount)),
        )
        self.addCleanup(lambda: frappe.db.delete("Project Expenses", {"name": name}))
        return name

    def test_the_ordinary_settle_still_refuses_this_payment(self):
        """Proof the settle window was pointed at a different number, not widened."""
        with self.assertRaises(AmountMismatchError):
            settle_row(self.partial_row.name, PAYMENT, self.big_payment)
        self._assert_nothing_happened()


class TestTheOrdinarySettleIsUntouchedByTheTdsParameter(PaymentSettlementFixture):
    """`settle_payment(tds=None)` must be BYTE-IDENTICAL to before slice TD.

    The 39 tests around this one already cover the ordinary path; these two assert the thing those
    cannot see — that adding an optional parameter did not quietly change the default behaviour.
    """

    def test_an_ordinary_settle_writes_no_tds(self):
        row = self._import_row("0001")
        settle_row(row.name, PAYMENT, self.planted["0001"])
        self.assertFalse(
            (frappe.db.get_value(PAYMENT, self.planted["0001"], "tds") or "").strip()
        )

    def test_an_ordinary_settle_still_rewrites_the_amount_to_the_bank_figure(self):
        """X1's rule, which the deduction path deliberately skips. If this ever stops firing, the
        `tds is None` branch has been mis-wired."""
        # ⚠️ NUDGE THE FIXTURE'S OWN PAYMENT RATHER THAN PLANTING A SECOND ONE. The fixture plants
        # each row's payment carrying that row's bank reference, so a rival payment trips the
        # fan-out UTR guard before the amount rule is ever reached -- and the failure reads as a
        # settle bug. The target itself is exempt from that guard.
        row = self._import_row("0007")
        payment = self.planted["0007"]
        frappe.db.set_value(
            PAYMENT, payment, "amount", float(row.amount) + 0.31, update_modified=False
        )
        frappe.db.commit()
        settle_row(row.name, PAYMENT, payment)
        self.assertAlmostEqual(
            float(frappe.db.get_value(PAYMENT, payment, "amount")), float(row.amount), places=2
        )


class TestTheWindowsStayInTheirRelation(unittest.TestCase):
    """⚠️ PINNED HERE BECAUSE THIS IS THE ONE LAYER THAT MAY IMPORT BOTH.

    `partial_settle` is a PURE module and cannot see `payment_split`, which imports frappe. Its gate
    relies on a numeric relation across that boundary: a gap greater than the settle window is
    always greater than the split's own floor, which is what makes `payment_split`'s
    `MIN_SPLIT_AMOUNT` refusals unreachable from the partial path. Drop the settle window below a
    rupee and that stops being true -- silently, because both modules would still be internally
    consistent.
    """

    def test_the_settle_window_is_at_least_the_split_floor(self):
        from decimal import Decimal

        from nirmaan_stack.services.outflow_import.amounts import AMOUNT_TOLERANCE
        from nirmaan_stack.services.payment_split import MIN_SPLIT_AMOUNT

        self.assertGreaterEqual(AMOUNT_TOLERANCE, Decimal(str(MIN_SPLIT_AMOUNT)))


if __name__ == "__main__":
    unittest.main()
