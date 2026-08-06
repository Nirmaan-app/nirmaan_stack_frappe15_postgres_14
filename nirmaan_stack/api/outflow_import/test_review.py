# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the outflow match/review pass (Bulk Import Outflow, slices S4 / V0 / V1).

The suite builds its OWN payments and expenses so the assertions do not depend on whatever the
live ledger happens to contain. Everything it creates is tracked and purged in `tearDownClass`.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. The purge is scoped to rows this suite created.

⚠️ THE FIXTURE'S PLANTED STATUSES ARE THE TEST. Under v2 every planted payment was `Paid`, because
the payment branch only ever looked. Under the v3 spine `Paid` means "somebody already recorded
this" and `Approved` means "settle it" -- so the same fixture with the same statuses would test the
opposite thing while still passing something. Read `_plant_targets` before changing any assertion
here.

Two negative properties matter most, and both are the kind that stay true right up until someone
adds a convenient line:

  * A MATCH PASS WRITES NOTHING to any `Project Payments` row. v3 lets the import settle, but only
    an explicit per-row confirmation may do it -- "nothing settles itself, ever".
  * A MATCH PASS WRITES NO `Outflow Row Match` ROWS. That table records settlements only; a
    suggestion recorded there would take the (transfer, target) unique key before the settlement
    that needs it.
"""

import unittest
from dataclasses import replace
from datetime import datetime

import frappe

from nirmaan_stack.api.outflow_import.review import (
    MATCH_DOCTYPE,
    get_batch_rows,
    get_reconciliation_report,
    get_row_candidates,
    match_batch,
    skip_row,
)
from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE, _stage_batch
from nirmaan_stack.services.outflow_import.parser import parse_statement

FIXTURE = (
    frappe.get_app_path("nirmaan_stack")
    + "/services/outflow_import/tests/fixtures/cashfree_sample.csv"
)


def _pending_count(batch: str) -> int:
    return frappe.db.count(ROW_DOCTYPE, {"import_batch": batch, "row_status": "Pending match run"})


def _fresh_parse():
    """Re-parse the fixture into a private transfer-id namespace (staging is not idempotent)."""
    with open(FIXTURE, "rb") as handle:
        parsed = parse_statement(handle.read(), source="Cashfree")
    prefix = frappe.generate_hash(length=10)
    return replace(
        parsed,
        rows=tuple(replace(r, transfer_id=f"{prefix}-{r.transfer_id}") for r in parsed.rows),
    )


class OutflowReviewFixture(unittest.TestCase):
    """Stages a batch and plants targets for a few of its rows."""

    batches: list = []
    payments: list = []
    project: str | None = None

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # PER-CLASS lists, rebound here on purpose. Declared on the base class they would be ONE
        # shared list object across every subclass, so the first tearDownClass to run would delete
        # rows the later classes still need -- and their assertions would read None.
        cls.batches = []
        cls.payments = []
        cls.parsed = _fresh_parse()
        cls.batch = _stage_batch(
            cls.parsed,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        cls.batches.append(cls.batch.name)
        cls.project = frappe.db.get_value("Projects", {}, "name")
        cls._plant_targets()
        frappe.db.commit()

    @classmethod
    def _row(cls, suffix):
        return next(r for r in cls.parsed.rows if r.transfer_id.endswith(suffix))

    @classmethod
    def _insert_payment_row(cls, *, amount, status, utr, payment_date, project=None):
        """Insert a `Project Payments` ROW directly, bypassing the document lifecycle.

        DELIBERATE, and it is not a shortcut. Going through `frappe.new_doc(...).insert()` would:
          * require a real Procurement Order / Service Request, because `before_insert` resolves
            `document_type` + `document_name` to build the name; and
          * fire `on_update`, which on a `Paid` payment recomputes the PARENT PO's `amount_paid`
            and issues its own `frappe.db.commit()`, plus the notification cascade.

        This suite runs against the LIVE development database. Mutating a real PO's financials and
        emailing people, to obtain a row the matcher only ever reads back out of
        `tabProject Payments` with raw SQL, would be a poor trade. A raw insert gives exactly the
        row under test and touches nothing else -- which is also what makes
        `test_nothing_on_any_payment_changed` mean something.
        """
        name = f"TEST-OFI-{frappe.generate_hash(length=12)}"
        frappe.db.sql(
            """
            INSERT INTO "tabProject Payments"
                (name, creation, modified, modified_by, owner, docstatus, idx,
                 project, amount, status, utr, payment_date)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s)
            """,
            (name, "Administrator", "Administrator", project or cls.project,
             float(amount), status, utr, payment_date),
        )
        cls.payments.append(name)
        return name

    @classmethod
    def _make_payment(cls, row, status="Paid", utr=None, amount=None):
        return cls._insert_payment_row(
            amount=amount if amount is not None else row.amount,
            status=status,
            utr=utr if utr is not None else row.bank_reference_no,
            payment_date=row.added_on.date() if row.added_on else None,
        )

    @classmethod
    def _plant_targets(cls):
        """The v3 target set. Every planted status is load-bearing -- see each comment.

        ⚠️ REWRITTEN AT V0/V1. Under v2 every target here was `Paid`, because the payment branch
        only ever looked. Under v3 `Paid` means "somebody already recorded this" and `Approved`
        means "settle it", so the SAME fixture with the SAME statuses would now test the opposite
        thing while still passing something.
        """
        # 0001 -- APPROVED, exact amount: the clean settle candidate. -> Matched
        cls.pay_clean = cls._make_payment(cls._row("0001"), status="Approved")
        # 0003 -- PAID, exact amount: somebody ticked it by hand before this upload. Owner ruling
        # Q14, and the reason it exists: without this the row reads Unmatched and the obvious next
        # click books the same money twice. -> Skipped
        cls.pay_already = cls._make_payment(cls._row("0003"), status="Paid")
        # 0004 + 0005 -- a FAN-OUT of APPROVED payments: one bank reference, two payments whose
        # total equals the row. -> Matched, as one group
        fan = cls._row("0004")
        cls.pay_fan_a = cls._make_payment(fan, amount=float(fan.amount) / 2, status="Approved")
        cls.pay_fan_b = cls._make_payment(fan, amount=float(fan.amount) / 2, status="Approved")
        # 0006 -- CEO PENDING. The reversal: v2 called this a `Control exception` and nudged
        # somebody to approve it. v3 offers nothing that cannot be settled, so the payment is not
        # in the pool at all. -> Unmatched
        cls.pay_unapproved = cls._make_payment(cls._row("0006"), status="CEO Pending")
        # 0007 -- PAID but for MORE than left the bank: the classic deduction shape, and the only
        # route to Mismatched now that both candidate passes match on an exact amount.
        seven = cls._row("0007")
        cls.pay_short = cls._make_payment(
            seven, amount=float(seven.amount) + 100, status="Paid"
        )
        # 0008 -- REQUESTED. Proves the narrowing is not CEO-Pending-specific: nothing below
        # Approved is settleable, on any ledger (owner ruling Q3). -> Unmatched
        cls.pay_requested = cls._make_payment(cls._row("0008"), status="Requested")

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete(MATCH_DOCTYPE, {"import_batch": ["in", cls.batches]})
        for name in cls.batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        for name in cls.payments:
            frappe.db.delete("Project Payments", {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _rows_by_transfer_suffix(self):
        rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch.name},
            fields=["name", "transfer_id", "row_status", "outcome_note", "resolved_vendor"],
        )
        return {r["transfer_id"][-4:]: r for r in rows}


class TestMatchBatch(OutflowReviewFixture):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.result = match_batch(cls.batch.name)

    def test_an_approved_payment_at_the_same_amount_is_matched(self):
        row = self._rows_by_transfer_suffix()["0001"]
        self.assertEqual(row["row_status"], "Matched")
        self.assertIn(self.pay_clean, row["outcome_note"])

    def test_an_already_paid_payment_is_skipped_and_names_the_record(self):
        """Owner ruling Q14. The row that stops the same money being booked twice.

        Under Q12 mixed usage is normal -- half a statement ticked by hand before upload -- so this
        is the COMMON case. Delete the duplicate query and this row reads `Unmatched`, whose
        obvious next click is "create a new expense".
        """
        row = self._rows_by_transfer_suffix()["0003"]
        self.assertEqual(row["row_status"], "Skipped")
        self.assertIn("Already recorded as Paid", row["outcome_note"])
        self.assertIn(self.pay_already, row["outcome_note"])

    def test_fan_out_matches_as_one_group(self):
        row = self._rows_by_transfer_suffix()["0004"]
        self.assertEqual(row["row_status"], "Matched")
        self.assertIn("2 approved payments", row["outcome_note"])
        self.assertIn(self.pay_fan_a, row["outcome_note"])
        self.assertIn(self.pay_fan_b, row["outcome_note"])

    def test_a_ceo_pending_payment_is_unmatched_with_no_nudge(self):
        """THE REVERSAL, pinned. v2 called this a `Control exception` and pointed at an approval
        queue. v3 offers nothing that cannot be settled: the payment is not in the candidate pool,
        so the row is plainly `Unmatched` and the note mentions neither approval nor the CEO.

        This reverses an earlier stated goal -- surfacing the 111 CEO-Pending payments -- which was
        removed deliberately. A failure here most likely means the candidate query was widened back.
        """
        row = self._rows_by_transfer_suffix()["0006"]
        self.assertEqual(row["row_status"], "Unmatched")
        self.assertNotIn("CEO", row["outcome_note"])
        self.assertNotIn("approval", row["outcome_note"].lower())

    def test_a_requested_payment_is_unmatched_too(self):
        """The narrowing is not CEO-Pending-specific: nothing below Approved settles, on any
        ledger (owner ruling Q3, which also removed v2's Requested exception for non-project
        expenses)."""
        row = self._rows_by_transfer_suffix()["0008"]
        self.assertEqual(row["row_status"], "Unmatched")

    def test_amount_disagreement_is_mismatched_with_the_implied_rate(self):
        """The ONLY route to Mismatched: an already-Paid record whose amount disagrees. Both
        candidate passes match on an EXACT amount, so a disagreement is impossible there."""
        row = self._rows_by_transfer_suffix()["0007"]
        self.assertEqual(row["row_status"], "Mismatched")
        self.assertIn("%", row["outcome_note"])
        self.assertIn("TDS", row["outcome_note"])
        self.assertIn(self.pay_short, row["outcome_note"])

    def test_rows_with_no_target_are_unmatched(self):
        row = self._rows_by_transfer_suffix()["0009"]
        self.assertEqual(row["row_status"], "Unmatched")

    def test_a_skipped_row_is_never_re_matched(self):
        # The FAILED transfer was skipped at upload. Matching must leave that decision alone --
        # it carries a bank reference and would otherwise match a payment perfectly well.
        row = self._rows_by_transfer_suffix()["0002"]
        self.assertEqual(row["row_status"], "Skipped")

    def test_a_match_run_writes_no_match_records_at_all(self):
        """⚠️ v3: `Outflow Row Match` records SETTLEMENTS ONLY, and this pass settles nothing.

        v2 minted a `Reconciled` row per matched target here. That never collided with a settlement
        because v2's payment branch could not write, so the two always addressed different targets.
        Under the v3 spine they address the SAME target, and the suggestion would take the
        `(transfer_id, target_doctype, target_name)` unique key before the settlement that needs
        it -- failing the confirm on exactly the happy path.

        So a row in that table means money was written. Re-adding a suggestion insert here brings
        the collision back, and it would only show up when someone confirms a matched payment.
        """
        matches = frappe.get_all(
            MATCH_DOCTYPE, filters={"import_batch": self.batch.name}, fields=["match_kind"]
        )
        self.assertEqual(matches, [])

    def test_the_suggestion_survives_in_the_note_instead(self):
        """The corollary of the test above: dropping the suggestion rows must not lose the
        suggestion. It lives in `outcome_note`, and the decision dialog loads full candidate detail
        on demand through `get_row_candidates` -- which is what the signed-off screen specifies."""
        row = self._rows_by_transfer_suffix()["0001"]
        self.assertEqual(row["row_status"], "Matched")
        self.assertTrue(row["outcome_note"])
        self.assertIn(self.pay_clean, row["outcome_note"])

    def test_in_file_duplicate_transfer_is_skipped_at_upload(self):
        # The fixture repeats row 1's transfer id. Both copies would match the same payment, and
        # the second Outflow Row Match insert would violate the (transfer_id, target) unique
        # constraint and abort the whole pass with a database error.
        rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch.name},
            fields=["transfer_id", "row_status", "skip_reason"],
            order_by="creation asc",
        )
        repeated = [r for r in rows if r["transfer_id"].endswith("0001")]
        self.assertEqual(len(repeated), 2)
        self.assertEqual(repeated[0]["row_status"], "Matched")
        self.assertEqual(repeated[1]["row_status"], "Skipped")
        self.assertIn("earlier in the same statement", repeated[1]["skip_reason"])

    def test_batch_rollup_is_derived(self):
        batch = frappe.get_doc(BATCH_DOCTYPE, self.batch.name)
        # v3: `reconciled_rows` and `exception_rows` were removed with the statuses they counted.
        self.assertFalse(batch.get("reconciled_rows"))
        self.assertFalse(batch.get("exception_rows"))
        # Counts are asserted as a PARTITION rather than as fixed numbers: the matcher also runs
        # against the live vendor master and ledger, so pinning an exact exception count would make
        # this test fail on unrelated data changes.
        self.assertEqual(
            batch.total_rows,
            batch.reviewed_rows + _pending_count(self.batch.name),
        )
        self.assertGreater(batch.reviewed_rows, 0)

    def test_re_running_the_match_is_idempotent(self):
        before = frappe.db.count(MATCH_DOCTYPE, {"import_batch": self.batch.name})
        match_batch(self.batch.name)
        after = frappe.db.count(MATCH_DOCTYPE, {"import_batch": self.batch.name})
        self.assertEqual(before, after)

    def test_the_match_pass_still_changes_nothing_on_any_payment(self):
        """⚠️ RE-READ THE NAME. Under v2 this pinned the payment branch's entire contract -- it
        never wrote, ever. Under v3 it pins something narrower and still important: MATCHING is
        read-only, and only an explicit per-row confirmation writes.

        If a planted payment's status has moved here, a match run has started settling on its own,
        which is the one thing the design says can never happen ("every settle is a per-row human
        confirmation; nothing settles itself, ever").
        """
        planted = {
            self.pay_clean: "Approved",
            self.pay_already: "Paid",
            self.pay_fan_a: "Approved",
            self.pay_fan_b: "Approved",
            self.pay_unapproved: "CEO Pending",
            self.pay_short: "Paid",
            self.pay_requested: "Requested",
        }
        for name, expected in planted.items():
            doc = frappe.db.get_value(
                "Project Payments", name, ["status", "utr", "amount", "tds"], as_dict=True
            )
            self.assertIsNone(doc.tds)
            self.assertEqual(doc.status, expected, f"{name} moved to {doc.status}")


class TestAmbiguityIsNotResolved(OutflowReviewFixture):
    def test_an_ambiguous_vendor_is_left_blank_rather_than_guessed(self):
        match_batch(self.batch.name)
        rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch.name},
            fields=["resolved_vendor", "beneficiary_name"],
        )
        # The synthetic beneficiaries resolve to no vendor at all, which is the honest answer --
        # what must never happen is a top-ranked guess being recorded as a decision.
        self.assertTrue(all(r["resolved_vendor"] is None for r in rows))


class TestSkipRow(OutflowReviewFixture):
    def test_a_manual_skip_requires_a_reason(self):
        row = self._rows_by_transfer_suffix()["0009"]
        with self.assertRaises(frappe.ValidationError):
            skip_row(row["name"], "   ")

    def test_a_manual_skip_records_the_reason_and_clears_matches(self):
        match_batch(self.batch.name)
        row = self._rows_by_transfer_suffix()["0001"]
        skip_row(row["name"], "Paid from the other account")
        after = frappe.db.get_value(
            ROW_DOCTYPE, row["name"], ["row_status", "skip_reason", "decided_by"], as_dict=True
        )
        self.assertEqual(after.row_status, "Skipped")
        self.assertEqual(after.skip_reason, "Paid from the other account")
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)


class TestReadEndpoints(OutflowReviewFixture):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)

    def test_get_batch_rows_returns_every_row_and_a_matched_row_carries_its_note(self):
        """v3: a `Matched` row carries NO match records -- those mean "settled" now -- so the
        assertion moved to the note, which is where the suggestion actually lives."""
        payload = get_batch_rows(self.batch.name)
        self.assertEqual(len(payload["rows"]), len(self.parsed.rows))
        matched = [r for r in payload["rows"] if r["row_status"] == "Matched"]
        self.assertTrue(matched)
        self.assertTrue(all(r["outcome_note"] for r in matched))
        self.assertTrue(all(not r["matches"] for r in matched))

    def test_get_row_candidates_ranks_without_deciding(self):
        row = self._rows_by_transfer_suffix()["0001"]
        payload = get_row_candidates(row["name"])
        self.assertTrue(payload["payment_groups"])
        self.assertEqual(payload["payment_groups"][0]["targets"][0]["name"], self.pay_clean)

    def test_report_lists_the_mismatches_it_found(self):
        """v3 collapsed three exception statuses into one. `Reference mismatch` was deleted
        outright and `Control exception` became a plain `Unmatched`, so `Mismatched` is all that
        is left to report. This endpoint is retired entirely at V5 in favour of the three tabs.
        """
        report = get_reconciliation_report(self.batch.name)
        statuses = {e["row_status"] for e in report["exceptions"]}
        # Subset, not equality -- the matcher also sees the live ledger, so an extra finding is
        # possible and is not this test's business. What must be present is what we planted.
        self.assertIn("Mismatched", statuses)
        self.assertNotIn("Control exception", statuses)
        self.assertNotIn("Reference mismatch", statuses)
        self.assertTrue(all(e["outcome_note"] for e in report["exceptions"]))

    def test_report_lists_payments_the_statement_does_not_account_for(self):
        # The reverse view: a payment recorded inside the period with no bank row behind it.
        # Informational -- another channel may legitimately have paid it.
        orphan = self._insert_payment_row(
            amount=4321.0,
            status="Paid",
            utr=f"NOBANKROW{frappe.generate_hash(length=6)}",
            payment_date=self.parsed.period_from,
        )
        frappe.db.commit()

        report = get_reconciliation_report(self.batch.name)
        self.assertIn(orphan, [p["name"] for p in report["unmatched_payments"]])
        self.assertNotIn(self.pay_clean, [p["name"] for p in report["unmatched_payments"]])


if __name__ == "__main__":
    unittest.main()
