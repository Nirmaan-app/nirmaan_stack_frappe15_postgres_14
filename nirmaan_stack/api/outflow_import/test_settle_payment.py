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

from nirmaan_stack.api.outflow_import.expenses import settle_expense, settle_row
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


if __name__ == "__main__":
    unittest.main()
