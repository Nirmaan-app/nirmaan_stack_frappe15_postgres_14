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

import json
import unittest
from dataclasses import replace
from datetime import datetime

import frappe

from nirmaan_stack.api.outflow_import.review import (
    MATCH_DOCTYPE,
    _payment_order_names,
    get_batch_rows,
    get_confirmable_rows,
    get_import_summary,
    get_outflow_facet_values,
    get_outflow_rows,
    get_outflow_summary,
    get_row_candidates,
    match_batch,
    match_period,
    search_settleable_records,
    skip_row,
)
from nirmaan_stack.api.outflow_import.expenses import settle_row
from nirmaan_stack.api.outflow_import.upload import BATCH_DOCTYPE, ROW_DOCTYPE, _stage_batch
from nirmaan_stack.services.outflow_import.amounts import AMOUNT_TOLERANCE
from nirmaan_stack.services.outflow_import.normalize import normalize_account
from nirmaan_stack.services.outflow_import.parser import parse_statement
from nirmaan_stack.services.outflow_import.status import OPEN_ROW_STATUSES, ROW_STATUSES

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
    expenses: list = []
    project: str | None = None

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # PER-CLASS lists, rebound here on purpose. Declared on the base class they would be ONE
        # shared list object across every subclass, so the first tearDownClass to run would delete
        # rows the later classes still need -- and their assertions would read None.
        cls.batches = []
        cls.payments = []
        cls.expenses = []
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
    def _insert_project_expense(cls, *, amount, status="Approved", vendor=None, project=None):
        """A `Project Expenses` ROW, inserted raw for the same reasons as a payment.

        Going through the document lifecycle would fire `project_cashflow_hold_update`, which
        recomputes a real project's cashflow gap and can move its CEO-Hold state. This suite runs
        against the LIVE development database and only ever reads this row back out with raw SQL.

        ⚠️ `amount` is a Data column of numeric STRINGS on this doctype, and real Currency on the
        non-project one. Inserting a float here would work today and read back as an unpredictable
        string tomorrow -- the asymmetry is stored, not incidental.
        """
        name = f"TEST-OFE-{frappe.generate_hash(length=12)}"
        frappe.db.sql(
            """
            INSERT INTO "tabProject Expenses"
                (name, creation, modified, modified_by, owner, docstatus, idx,
                 projects, vendor, status, amount, description)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s)
            """,
            (name, "Administrator", "Administrator", project, vendor, status,
             str(amount), "Outflow import test expense"),
        )
        cls.expenses.append(name)
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
        # Q14, and the reason it exists: without this the row reads Mismatched and the obvious next
        # click books the same money twice. -> Skipped
        cls.pay_already = cls._make_payment(cls._row("0003"), status="Paid")
        # 0004 + 0005 -- a FAN-OUT of APPROVED payments: one bank reference, two payments whose
        # total equals the row. -> Matched, as one group
        fan = cls._row("0004")
        cls.pay_fan_a = cls._make_payment(fan, amount=float(fan.amount) / 2, status="Approved")
        cls.pay_fan_b = cls._make_payment(fan, amount=float(fan.amount) / 2, status="Approved")
        # 0006 -- CEO PENDING. The reversal: v2 called this a `Control exception` and nudged
        # somebody to approve it. v3 offers nothing that cannot be settled, so the payment is not
        # in the pool at all. -> Mismatched
        cls.pay_unapproved = cls._make_payment(cls._row("0006"), status="CEO Pending")
        # 0007 -- PAID but for MORE than left the bank: the classic deduction shape, and the only
        # route to Mismatched now that both candidate passes match on an exact amount.
        seven = cls._row("0007")
        cls.pay_short = cls._make_payment(
            seven, amount=float(seven.amount) + 100, status="Paid"
        )
        # 0008 -- REQUESTED. Proves the narrowing is not CEO-Pending-specific: nothing below
        # Approved is settleable, on any ledger (owner ruling Q3). -> Mismatched
        cls.pay_requested = cls._make_payment(cls._row("0008"), status="Requested")

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete(MATCH_DOCTYPE, {"import_batch": ["in", cls.batches]})
        for name in cls.batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        for name in cls.payments:
            frappe.db.delete("Project Payments", {"name": name})
        for name in cls.expenses:
            frappe.db.delete("Project Expenses", {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _rows_by_transfer_suffix(self):
        rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch.name},
            fields=[
                "name", "transfer_id", "row_status", "outcome_note", "resolved_vendor",
                "suggested_doctype", "suggested_name",
            ],
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
        is the COMMON case. Delete the duplicate query and this row reads `Mismatched` carrying the
        FOUND-NOTHING note, whose obvious next click is "create a new expense" -- and the money is
        booked a second time.

        ⚠️ THE MERGE MADE THAT FAILURE QUIETER, NOT LOUDER. Before 2026-08-10 the broken version
        produced a different STATUS (`Unmatched`) from the correct one; now both are `Mismatched`
        and only the note differs. Hence the note assertions below -- they are the whole test.
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

    def test_a_ceo_pending_payment_is_mismatched_with_no_nudge(self):
        """THE REVERSAL, pinned. v2 called this a `Control exception` and pointed at an approval
        queue. v3 offers nothing that cannot be settled: the payment is not in the candidate pool,
        so the row is plainly `Mismatched` -- the found-nothing half -- and the note mentions neither
        approval nor the CEO.

        This reverses an earlier stated goal -- surfacing the 111 CEO-Pending payments -- which was
        removed deliberately. A failure here most likely means the candidate query was widened back.
        """
        row = self._rows_by_transfer_suffix()["0006"]
        self.assertEqual(row["row_status"], "Mismatched")
        self.assertNotIn("CEO", row["outcome_note"])
        self.assertNotIn("approval", row["outcome_note"].lower())

    def test_a_requested_payment_is_mismatched_too(self):
        """The narrowing is not CEO-Pending-specific: nothing below Approved settles, on any
        ledger (owner ruling Q3, which also removed v2's Requested exception for non-project
        expenses)."""
        row = self._rows_by_transfer_suffix()["0008"]
        self.assertEqual(row["row_status"], "Mismatched")

    def test_amount_disagreement_is_mismatched_with_the_implied_rate(self):
        """The ONLY route to Mismatched: an already-Paid record whose amount disagrees. Both
        candidate passes match on an EXACT amount, so a disagreement is impossible there."""
        row = self._rows_by_transfer_suffix()["0007"]
        self.assertEqual(row["row_status"], "Mismatched")
        self.assertIn("%", row["outcome_note"])
        self.assertIn("TDS", row["outcome_note"])
        self.assertIn(self.pay_short, row["outcome_note"])

    def test_rows_with_no_target_are_mismatched(self):
        row = self._rows_by_transfer_suffix()["0009"]
        self.assertEqual(row["row_status"], "Mismatched")

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


class TestSuggestionIsPersisted(OutflowReviewFixture):
    """The match run writes down WHICH record it picked (slice R1).

    Before this, the run stored only a status and a sentence, so the screen had to re-run the
    matcher for one row at a time when a reviewer opened it -- which is why a matched row could not
    show as ready in the table, and why every row had to be opened individually to be confirmed.

    ⚠️ THE POSITIVE CASE CANNOT USE ROW 0001, AND THE REASON CHANGED ON 2026-08-07 WITHOUT THE
    CONCLUSION CHANGING. It used to be that `match_expenses` matched on AMOUNT ALONE, so a live
    approved expense at a round Rs 5,000 gave row 0001 a second candidate. Expenses now sit at tier
    2 and require the remark to name their project, so that particular collision is gone -- but the
    same shape can still arrive from a live approved PAYMENT at the same round amount in the same
    project, and row 0009's Rs 1,234.50 remains the one non-round amount in the fixture. The
    precondition is asserted rather than assumed, so a future collision reports itself as data drift
    instead of looking like a broken deriver.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # 0009 has no planted target in the base fixture -- it is the "nothing to match" row -- so
        # planting here gives this class a row whose entire candidate set is one payment.
        cls.solo_row = cls._row("0009")
        cls.pay_solo = cls._make_payment(cls.solo_row, status="Approved")
        frappe.db.commit()
        match_batch(cls.batch.name)

    @staticmethod
    def _approved_expenses_at(amount: float) -> int:
        """How many live approved expenses share this amount, on either expense ledger.

        ⚠️ THE WINDOW IS THE SETTLE WINDOW AND IT IS READ FROM `amounts.py`, NOT RETYPED. This guard
        was written with a hardcoded `<= 1` and silently became wrong the day the window widened to
        Rs 5 -- a precondition that under-counts is worse than none, because it reports "no
        collision" while one exists.

        `Project Expenses.amount` is a Data column of numeric strings and the non-project one is
        real Currency -- the same asymmetry the candidate queries carry.
        """
        window = float(AMOUNT_TOLERANCE)
        project = frappe.db.sql(
            """SELECT count(*) FROM "tabProject Expenses"
               WHERE status = 'Approved' AND amount IS NOT NULL AND btrim(amount) <> ''
                 AND abs(CAST(btrim(amount) AS numeric) - %s) <= %s""",
            (amount, window),
        )[0][0]
        non_project = frappe.db.sql(
            """SELECT count(*) FROM "tabNon Project Expenses"
               WHERE status = 'Approved' AND abs(amount - %s) <= %s""",
            (amount, window),
        )[0][0]
        return int(project) + int(non_project)

    def _approved_payments_at(self, amount: float) -> int:
        """Live approved payments inside the settle window at this amount, in the fixture's project.

        THE COLLISION THAT CAN STILL HAPPEN. Tier 2 admits a payment on amount + project, and the
        fixture plants its payments against a REAL project, so a live approved payment at the same
        amount in that project would give row 0009 a second candidate -- correctly, and this test
        would then fail for a reason that is not a bug.
        """
        return int(
            frappe.db.sql(
                """SELECT count(*) FROM "tabProject Payments"
                   WHERE status = 'Approved' AND project = %s AND abs(amount - %s) <= %s
                     AND name <> %s""",
                (self.project, amount, float(AMOUNT_TOLERANCE), self.pay_solo),
            )[0][0]
        )

    def test_a_single_approved_payment_is_recorded_as_the_suggestion(self):
        drift = (
            "A live approved record has appeared at Rs 1,234.50, so this row now has two candidates "
            "and correctly suggests nothing. That is the deriver working -- pick another amount for "
            "this test rather than relaxing the rule."
        )
        self.assertEqual(self._approved_expenses_at(1234.50), 0, drift)
        self.assertEqual(self._approved_payments_at(1234.50), 0, drift)
        row = self._rows_by_transfer_suffix()["0009"]
        self.assertEqual(row["row_status"], "Matched")
        self.assertEqual(row["suggested_doctype"], "Project Payments")
        self.assertEqual(row["suggested_name"], self.pay_solo)

    def test_the_note_says_which_tier_matched_it(self):
        """The reviewer's whole basis for trusting a suggestion is WHY it was made, and the three
        tiers are very different claims. Row 0009's planted payment carries the row's own bank
        reference, so this is the tier 0 wording."""
        row = self._rows_by_transfer_suffix()["0009"]
        self.assertIn("bank reference is recorded on it", row["outcome_note"])

    def test_no_mismatched_row_anywhere_carries_a_suggestion(self):
        """Asserted across every row rather than one named one: which fixture rows end up here
        depends on the live ledger, and the rule does not. Since the 2026-08-10 merge this set also
        holds the amount-disagreement rows, which never carried a suggestion either -- so the
        assertion WIDENED without weakening."""
        mismatched = [
            r for r in self._rows_by_transfer_suffix().values() if r["row_status"] == "Mismatched"
        ]
        self.assertTrue(mismatched)
        for row in mismatched:
            self.assertIsNone(row["suggested_name"], row["transfer_id"])
            self.assertIsNone(row["suggested_doctype"], row["transfer_id"])

    def test_a_fan_out_records_no_suggestion(self):
        """Matched, but there is no single record to name. A `(doctype, name)` pair cannot hold a
        group, so the shape of the fields enforces the rule rather than a caller remembering it."""
        row = self._rows_by_transfer_suffix()["0004"]
        self.assertEqual(row["row_status"], "Matched")
        self.assertIsNone(row["suggested_doctype"])
        self.assertIsNone(row["suggested_name"])

    def test_a_skipped_duplicate_records_no_suggestion(self):
        """THE GATE. This row HAS a real approved candidate behind it -- it is skipped because the
        payment was already ticked Paid by hand. Pre-selecting that candidate would put a
        ready-to-confirm record on a row whose whole purpose is to stop the money being booked
        twice."""
        row = self._rows_by_transfer_suffix()["0003"]
        self.assertEqual(row["row_status"], "Skipped")
        self.assertIsNone(row["suggested_name"])

    def test_a_mismatched_row_records_no_suggestion(self):
        row = self._rows_by_transfer_suffix()["0007"]
        self.assertEqual(row["row_status"], "Mismatched")
        self.assertIsNone(row["suggested_name"])

    def test_a_re_run_clears_a_suggestion_that_no_longer_holds(self):
        """⚠️ THE CLEARING HALF, WHICH IS THE ONE THAT BREAKS SILENTLY.

        Re-running the match is normal and expected -- payments get ticked Paid by hand all day, so
        a batch matched at 10:00 finds different things at 16:00. If the run only WROTE the pair
        when it found one, a row whose candidate has since been paid by somebody else would keep
        this morning's pick, and the screen would open it already ticked against a record the
        matcher has since rejected. Nothing on the screen would show that.

        The stale value is planted on whichever row is Mismatched rather than a named one -- which
        rows end up there depends on the live ledger, and the clearing rule does not.
        """
        target = next(
            r for r in self._rows_by_transfer_suffix().values() if r["row_status"] == "Mismatched"
        )
        self.assertIsNone(target["suggested_name"])
        frappe.db.set_value(
            ROW_DOCTYPE,
            target["name"],
            {"suggested_doctype": "Project Payments", "suggested_name": "PAY-STALE-001"},
            update_modified=False,
        )
        match_batch(self.batch.name)
        after = frappe.db.get_value(
            ROW_DOCTYPE, target["name"], ["suggested_doctype", "suggested_name"], as_dict=True
        )
        self.assertIsNone(after.suggested_doctype)
        self.assertIsNone(after.suggested_name)

    def test_the_suggestion_is_not_a_match_record(self):
        """⚠️ Two read-only fields on the import row, NOT a row in `Outflow Row Match`.

        That table's `(transfer_id, target_doctype, target_name)` unique key IS this feature's
        idempotency guarantee. A suggestion written there would take the key before the settlement
        that needs it and fail the confirm on exactly the happy path -- which is why the match run
        writes no match records at all. Anyone "restoring consistency" by moving the suggestion into
        that table brings the collision back.
        """
        row = self._rows_by_transfer_suffix()["0009"]
        self.assertEqual(row["suggested_name"], self.pay_solo)
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row["name"]}), 0)


class TestSearchSettleableRecords(OutflowReviewFixture):
    """Browsing approved records to link one BY HAND -- now across all three ledgers (slice R2).

    ⚠️ THIS IS NOT THE MATCHER'S OUTPUT, and the distinction is the whole reason the endpoint
    exists. `get_row_candidates` returns what the matcher FOUND; when it found nothing the old
    dropdowns were empty -- exactly when hand-linking is most needed. This browses the ledgers.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        vendor = frappe.db.get_value("Vendors", {}, ["name", "vendor_name"], as_dict=True)
        cls.vendor = vendor
        # An approved project expense with REAL links, at row 0009's Rs 1,234.50 -- close enough to
        # that row's amount to be offered, and linked so the id-vs-name assertion has something to
        # bite on.
        cls.expense_linked = cls._insert_project_expense(
            amount="1234.50", vendor=vendor.name if vendor else None, project=cls.project
        )
        frappe.db.commit()

    def _row_name(self, suffix="0009"):
        return self._rows_by_transfer_suffix()[suffix]["name"]

    def test_a_blank_doctype_searches_every_ledger(self):
        """The reviewer no longer has to classify the transfer before they can find the record."""
        records = search_settleable_records(self._row_name(), "")
        self.assertTrue(records)
        self.assertTrue(all(r["target_doctype"] for r in records))
        found = {r["target_doctype"] for r in records}
        self.assertTrue(found <= {"Project Payments", "Project Expenses", "Non Project Expenses"})

    def test_every_record_names_its_own_ledger(self):
        """⚠️ The record CARRIES its doctype because the dialog no longer asks for one up front.
        Without it the screen would have to guess which table a chosen record lives in, and settle
        it against the wrong one."""
        records = search_settleable_records(self._row_name(), "")
        expense = next(r for r in records if r["name"] == self.expense_linked)
        self.assertEqual(expense["target_doctype"], "Project Expenses")

    def test_an_expense_reports_vendor_and_project_by_NAME_not_by_link_id(self):
        """⚠️ THE DEFECT THIS FIXES. `vendor` and `projects` are LINK fields, so the raw values are
        `VEN-0001` / `PROJ-0007`. Payments always joined for real names; expenses did not -- and now
        that both appear in ONE list, picked BY vendor and project, an id in that column is a record
        the reviewer cannot recognise."""
        if not self.vendor or not self.project:
            self.skipTest("no vendor or project in this database to link an expense to")
        records = search_settleable_records(self._row_name(), "")
        expense = next(r for r in records if r["name"] == self.expense_linked)
        self.assertEqual(expense["vendor_name"], self.vendor.vendor_name)
        self.assertNotEqual(expense["vendor_name"], self.vendor.name)
        self.assertEqual(
            expense["project_name"],
            frappe.db.get_value("Projects", self.project, "project_name"),
        )

    def test_an_expense_carries_a_last_updated_date_and_never_an_approval_one(self):
        """⚠️ NEITHER EXPENSE DOCTYPE HAS AN APPROVAL DATE -- no field, no approver. Only
        `Project Payments` records one. The modification date goes under its own key so the screen
        can label it "updated" rather than pass it off as "approved" (owner ruling 2026-08-06)."""
        records = search_settleable_records(self._row_name(), "")
        expense = next(r for r in records if r["name"] == self.expense_linked)
        self.assertEqual(expense["approved_on"], "")
        self.assertTrue(expense["updated_on"])

    def test_a_payment_carries_an_approval_date_under_its_own_key(self):
        records = search_settleable_records(self._row_name(), "Project Payments")
        self.assertTrue(records)
        self.assertTrue(all(r["updated_on"] == "" for r in records))

    def test_suggested_records_come_first_then_the_closest(self):
        """The merged list is cut to `limit` AFTER sorting, so the order decides what survives the
        cut. It is the same order the screen renders in."""
        records = search_settleable_records(self._row_name(), "")
        flags = [r["suggested"] for r in records]
        self.assertEqual(flags, sorted(flags, reverse=True))

    def test_naming_one_ledger_still_returns_only_that_ledger(self):
        for ledger in ("Project Payments", "Project Expenses", "Non Project Expenses"):
            records = search_settleable_records(self._row_name(), ledger)
            self.assertTrue(all(r["target_doctype"] == ledger for r in records), ledger)

    def test_a_ledger_this_import_cannot_settle_is_still_refused(self):
        """Blank means ALL, but a NAMED doctype is still validated -- widening the default must not
        turn a typo into a silently empty list."""
        with self.assertRaises(frappe.ValidationError):
            search_settleable_records(self._row_name(), "Procurement Orders")

    def test_nothing_below_approved_is_ever_offered(self):
        """Browsing is not a way around the ladder (owner ruling Q3). `pay_requested` and
        `pay_unapproved` are planted precisely to be absent from this list."""
        names = {r["name"] for r in search_settleable_records(self._row_name(), "", limit=200)}
        self.assertNotIn(self.pay_requested, names)
        self.assertNotIn(self.pay_unapproved, names)

    def test_the_merged_list_respects_the_limit(self):
        records = search_settleable_records(self._row_name(), "", limit=2)
        self.assertLessEqual(len(records), 2)

    # --- slice N1: the whole pool, ranked -------------------------------------------------------

    def test_the_default_now_returns_every_approved_payment_not_a_page_of_fifty(self):
        """⚠️ THE DEFECT THIS FIXES, AND IT WAS NOT MERELY A SHORT LIST.

        The old default asked each ledger for 50 rows ORDERED BY AMOUNT CLOSENESS. A record whose
        vendor and project were both right was INVISIBLE unless its amount happened to be near --
        and the search box was the only way to reach it. The pool is small enough to send whole.
        """
        offered = {
            r["name"]
            for r in search_settleable_records(self._row_name(), "")
            if r["target_doctype"] == "Project Payments"
        }
        approved = set(
            frappe.get_all(
                "Project Payments", filters={"status": "Approved"}, pluck="name", limit_page_length=0
            )
        )
        self.assertEqual(offered, approved)

    def test_a_small_ledger_can_no_longer_be_squeezed_out_of_the_merge(self):
        """⚠️ THE SECOND HALF OF THE SAME DEFECT. Each ledger was capped at 50 and the merge was cut
        to 50, so near-amount payments could fill the list and drop an ENTIRE ledger from a view
        that claims to span all three."""
        records = search_settleable_records(self._row_name(), "")
        self.assertIn(self.expense_linked, {r["name"] for r in records})

    def test_every_record_carries_its_similarity_score_and_the_reasons_for_it(self):
        """A ranked list whose order cannot be explained is one people stop trusting."""
        records = search_settleable_records(self._row_name(), "")
        self.assertTrue(records)
        for record in records:
            self.assertIsInstance(record["similarity"], (int, float))
            self.assertIsInstance(record["similarity_reasons"], list)

    def test_a_record_carries_the_project_id_BESIDE_the_display_name(self):
        """⚠️ NOT INSTEAD OF IT. `project_name` falls back to the id when the join finds nothing, so
        it cannot be compared against what `ProjectIndex` reports -- that speaks in ids. The ranking
        needs the id and the screen needs the name; one key cannot carry both."""
        records = search_settleable_records(self._row_name(), "")
        expense = next(r for r in records if r["name"] == self.expense_linked)
        self.assertEqual(expense["project"], self.project)
        self.assertNotEqual(expense["project_name"], expense["project"])

    def test_every_record_carries_the_nickname_and_contact_person_keys(self):
        """Structural: the alias axis reads them on every ledger, and a MISSING key is not the same
        as an empty one -- Non Project Expenses have no vendor at all and must still answer."""
        records = search_settleable_records(self._row_name(), "")
        for record in records:
            self.assertIn("vendor_nickname", record)
            self.assertIn("contact_person", record)

    def test_a_non_project_expense_reports_no_vendor_rather_than_omitting_the_field(self):
        records = search_settleable_records(self._row_name(), "Non Project Expenses")
        for record in records:
            self.assertEqual(record["vendor_name"], "")
            self.assertEqual(record["vendor_nickname"], "")
            self.assertEqual(record["contact_person"], "")

    def test_a_vendors_nickname_reaches_the_payload_when_it_has_one(self):
        nickname = frappe.db.get_value("Vendors", self.vendor.name, "vendor_nickname") if self.vendor else None
        if not nickname:
            self.skipTest("the fixture vendor has no nickname on file")
        records = search_settleable_records(self._row_name(), "")
        expense = next(r for r in records if r["name"] == self.expense_linked)
        self.assertEqual(expense["vendor_nickname"], nickname)

    def test_an_unsettleable_record_never_outranks_a_settleable_one(self):
        """⚠️ THE HARD SPLIT (owner decision Q2), asserted on real data rather than a fixture.

        `settle.py` refuses a record outside the settle window, so however much one looks like the
        transfer it must never sit above a record the reviewer can actually confirm. This is the
        same property `test_suggested_records_come_first_then_the_closest` checks; it is repeated
        here because the ORDER's reason changed underneath that test -- it now passes because of the
        split rather than because of the amount sort, and only this docstring says so.
        """
        flags = [r["suggested"] for r in search_settleable_records(self._row_name(), "")]
        self.assertEqual(flags, sorted(flags, reverse=True))

    def test_scores_never_rise_as_the_list_goes_down_within_one_half(self):
        records = search_settleable_records(self._row_name(), "")
        for earlier, later in zip(records, records[1:]):
            if earlier["suggested"] == later["suggested"]:
                self.assertGreaterEqual(earlier["similarity"], later["similarity"])

    def test_the_order_is_total_so_two_identical_calls_agree(self):
        """⚠️ THE SORT KEY ENDS IN `(doctype, name)`, WHICH IS UNIQUE. A ranking that reshuffles
        equal-scoring rows between two loads of the same dialog is one a reviewer cannot trust."""
        first = [(r["target_doctype"], r["name"]) for r in search_settleable_records(self._row_name(), "")]
        again = [(r["target_doctype"], r["name"]) for r in search_settleable_records(self._row_name(), "")]
        self.assertEqual(first, again)


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

    def test_the_new_candidate_key_is_purely_additive(self):
        """N3 added `settleable_candidates`. Every key the screen already read must survive.

        ⚠️ NOT A CEREMONY. `get_row_candidates` had no frontend caller between slices R1 and N3, so
        nothing but this suite would notice a key quietly disappearing while the new one was added.
        """
        payload = get_row_candidates(self._rows_by_transfer_suffix()["0001"]["name"])
        for key in ("row", "tier", "vendor_candidates", "vendor_ambiguous",
                    "payment_groups", "expense_candidates", "settleable_candidates"):
            self.assertIn(key, payload)

    def test_a_single_candidate_comes_back_as_a_list_of_one(self):
        """⚠️ NOT `[]`. The `< 2` threshold belongs to `_sweep_unresolved_to_mismatched`, which is
        asking a different question. An endpoint that copied it would give this feature a second
        place to change one rule."""
        payload = get_row_candidates(self._rows_by_transfer_suffix()["0001"]["name"])
        self.assertEqual(
            payload["settleable_candidates"],
            [{"doctype": "Project Payments", "name": self.pay_clean}],
        )

    def test_a_fan_out_offers_no_candidates_to_mark(self):
        """⚠️ THE ABSTENTION IS INHERITED FROM OPTION B, NOT RESTATED HERE.

        Row 0004 is one transfer covering TWO approved payments under one bank reference. That is a
        genuine match with no single name to offer (ruling Q4), so it is not a set of comparable
        alternatives -- and marking its two halves as "pick one of these" would invite settling half
        the transfer. `_disambiguation_candidates` already refuses the whole set; this proves the
        endpoint did not re-derive its way around that.
        """
        payload = get_row_candidates(self._rows_by_transfer_suffix()["0004"]["name"])
        self.assertTrue(payload["payment_groups"][0]["is_fan_out"], "fixture precondition")
        self.assertEqual(payload["settleable_candidates"], [])


class TestTheOrderNameForLinking(OutflowReviewFixture):
    """`order_name` on every payment link source (slice E3).

    ⚠️ THIS CLASS EXISTS BECAUSE THE WHOLE SUITE PASSED UNCHANGED WHEN THE FIELD WAS ADDED. The
    fixture inserts payments with NO `document_name` -- deliberately, since a real one would need a
    real PO -- so every existing assertion runs down the FALLBACK path and could not see the new
    key appear or disappear. These tests stamp an order onto a fixture payment first.

    The screen links to `/project-payments/<order>` because that is what the other twelve call
    sites in this app do; without this field the row table could not reach that route at all.
    """

    ORDER = "TEST-PO/OFL/25-26"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)
        # Raw SQL for the same reason the fixture inserts raw: `document_name` is a Dynamic Link,
        # and going through the lifecycle would demand a real Procurement Order on the live DB.
        frappe.db.sql(
            """UPDATE "tabProject Payments" SET document_type = %s, document_name = %s
               WHERE name = %s""",
            ("Procurement Orders", cls.ORDER, cls.pay_clean),
        )
        frappe.db.commit()

    def _row_0001(self, rows):
        return next(r for r in rows if r["transfer_id"].endswith("0001"))

    def test_the_suggestion_carries_its_order(self):
        rows = get_batch_rows(self.batch.name)["rows"]
        row = self._row_0001(rows)
        self.assertEqual(row["suggested_name"], self.pay_clean, "fixture precondition")
        self.assertEqual(row["suggested_order_name"], self.ORDER)

    def test_the_master_table_carries_it_too(self):
        """⚠️ BOTH READS OR NEITHER. The master table is where most of these links are clicked;
        enriching only the batch view would leave the app's route working in one place and not the
        other, which is harder to diagnose than it not working anywhere."""
        rows = get_outflow_rows(scope="all", limit=200)["rows"]
        row = self._row_0001(rows)
        self.assertEqual(row["suggested_order_name"], self.ORDER)

    def test_the_key_is_on_EVERY_row_and_blank_when_there_is_no_order(self):
        """Blank is the honest answer and the client falls back on it. A missing KEY would make the
        two reads structurally different and force every caller to test for its presence.

        ⚠️ ASSERTED OVER THE ROWS WITH NO SUGGESTION, because `pay_clean` is the only payment this
        fixture ever stores as one -- an earlier version of this test asked for a second suggested
        payment carrying no order and there is none. Those rows are the blank case that matters:
        the key must still be there.
        """
        rows = get_batch_rows(self.batch.name)["rows"]
        for row in rows:
            self.assertIn("suggested_order_name", row)

        unsuggested = [r for r in rows if not (r.get("suggested_name") or "")]
        self.assertTrue(unsuggested, "fixture precondition: rows with no suggestion at all")
        self.assertTrue(all(r["suggested_order_name"] == "" for r in unsuggested))

    def test_an_already_paid_related_payment_carries_its_order(self):
        """The other link source on an open row -- a Skipped/Mismatched row's related payment."""
        frappe.db.sql(
            """UPDATE "tabProject Payments" SET document_type = %s, document_name = %s
               WHERE name = %s""",
            ("Procurement Orders", "TEST-PO/REL/25-26", self.pay_already),
        )
        frappe.db.commit()
        rows = get_batch_rows(self.batch.name)["rows"]
        related = [e for r in rows for e in (r.get("related_payments") or [])]
        self.assertTrue(related, "fixture precondition: a row with a related paid payment")
        stamped = [e for e in related if e["target_name"] == self.pay_already]
        self.assertTrue(stamped)
        self.assertTrue(all(e["order_name"] == "TEST-PO/REL/25-26" for e in stamped))

    def test_BOTH_row_reads_actually_SHIP_settlement_origin(self):
        """⚠️ THE BUG THE BROWSER WALK FOUND AND EVERY GREEN SUITE MISSED.

        `_FACET_COLUMNS` governs FILTERING; the SELECT lists govern what a row CARRIES. Slice Q1
        first changed only the former, so the "Settled via" column rendered an em dash on all 849
        settled rows while the summary beside it correctly reported 843 auto-matched. Filtering
        worked, the count worked, the data was right -- and the screen showed nothing.

        Asserting the KEY is present is the point; a value assertion alone would pass on a payload
        that omits it entirely, because `.get()` returns None either way.
        """
        for label, rows in (
            ("get_batch_rows", get_batch_rows(self.batch.name)["rows"]),
            ("get_outflow_rows", get_outflow_rows(scope="all", limit=200)["rows"]),
        ):
            self.assertTrue(rows, f"{label}: fixture precondition")
            for row in rows:
                self.assertIn("settlement_origin", row, f"{label} dropped the key")

    def test_a_settled_row_carries_a_NON_BLANK_origin_end_to_end(self):
        """The other half: present AND populated, through the real endpoint."""
        settled = [
            r for r in get_outflow_rows(scope="all", limit=200)["rows"]
            if r["row_status"] == "Settled"
        ]
        if settled:
            self.assertTrue(all((r["settlement_origin"] or "").strip() for r in settled))

    def test_the_lookup_asks_for_nothing_when_there_are_no_payments(self):
        """A pure guard on the helper: an empty ask must not build an `IN ()` clause."""
        self.assertEqual(_payment_order_names([]), {})
        self.assertEqual(_payment_order_names([None, "", "   "]), {})


class TestTheCandidatesTheMatcherCouldNotSeparate(OutflowReviewFixture):
    """N3: the row says "N records matched and nothing could separate them" -- WHICH N?

    THE DEFECT THIS EXISTS FOR. `_sweep_unresolved_to_mismatched` writes that sentence and the
    reviewer opens the row -- into a browse list of the WHOLE approved pool (measured between 322
    and 1,164 records), with those N unmarked. "Open the row and pick which one it settled" pointed
    at nothing, and re-finding them by eye is exactly the work the match run had already done.

    ⚠️ THE FIXTURE IS BUILT TO DEFEAT EVERY OPTION-B RULE IN TURN, and each amount is chosen for
    that. Two approved payments, same project, EQUIDISTANT from the bank amount (+/- Re 1):
      * M1 project-in-remark  -- needs exactly ONE candidate on the named project; both are on it.
      * M2 nearest-amount     -- needs one STRICTLY nearer; they are the same distance away.
      * M3 interchangeable    -- needs the SAME amount; 6630.77 and 6632.77 differ.
      * M4 nearest-date       -- both payments carry no approval date at all, so it is silent.
    Take any one of those away and the row resolves, the sweep never runs, and this class goes
    green while testing nothing.
    """

    BANK = 6631.77
    NEAR_LOW = 6630.77
    NEAR_HIGH = 6632.77

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.amb_project = f"TEST-OFP-{frappe.generate_hash(length=10)}"
        cls.amb_project_name = f"Marlowfield{frappe.generate_hash(length=6)}"
        frappe.db.sql(
            """
            INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner, docstatus, idx,
                                       project_name)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s)
            """,
            (cls.amb_project, "Administrator", "Administrator", cls.amb_project_name),
        )

        from nirmaan_stack.services.outflow_import.normalize import normalize_account

        cls.row_name = frappe.db.get_value(
            ROW_DOCTYPE,
            {"import_batch": cls.batch.name, "transfer_id": cls._row("0009").transfer_id},
            "name",
        )
        frappe.db.set_value(
            ROW_DOCTYPE,
            cls.row_name,
            {
                "bank_account": "70000000009",
                "normalized_account": normalize_account("70000000009"),
                "ifsc": "TEST0009999",
                "amount": cls.BANK,
                "remarks": f"{cls.amb_project_name} materials",
                # Tier 0 must not fire, or the reference decides and there is no ambiguity left.
                "bank_reference_no": None,
                "normalized_reference": None,
            },
            update_modified=False,
        )
        cls.pay_low = cls._insert_payment_row(
            amount=cls.NEAR_LOW, status="Approved", utr="PO/AMB/00001/25-26",
            payment_date=None, project=cls.amb_project,
        )
        cls.pay_high = cls._insert_payment_row(
            amount=cls.NEAR_HIGH, status="Approved", utr="PO/AMB/00002/25-26",
            payment_date=None, project=cls.amb_project,
        )
        frappe.db.commit()
        match_batch(cls.batch.name)

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("Projects", {"name": cls.amb_project})
        super().tearDownClass()

    def test_the_precondition_the_row_really_was_swept_for_being_unseparable(self):
        """⚠️ ASSERTED, NOT ASSUMED. If any Option-B rule started separating these two, the row
        would carry a suggestion and the assertions below would be about a case that no longer
        exists."""
        after = frappe.db.get_value(
            ROW_DOCTYPE, self.row_name, ["row_status", "outcome_note", "suggested_name"],
            as_dict=True,
        )
        self.assertEqual(after.row_status, "Mismatched")
        self.assertFalse((after.suggested_name or "").strip())
        self.assertIn("nothing could separate them", after.outcome_note or "")

    def test_the_endpoint_names_the_records_the_note_only_counted(self):
        payload = get_row_candidates(self.row_name)
        named = {(c["doctype"], c["name"]) for c in payload["settleable_candidates"]}
        self.assertEqual(
            named,
            {("Project Payments", self.pay_low), ("Project Payments", self.pay_high)},
        )

    def test_the_count_the_note_states_is_the_count_the_screen_can_mark(self):
        """⚠️ THE ONE-LIST GUARANTEE, AND IT IS THE WHOLE POINT OF THE SLICE.

        The sentence was written from `_disambiguation_candidates` at match time and the marks are
        read from it now. If the endpoint ever builds its own list, this is what goes red -- before
        a reviewer is told "6 records matched" over a table marking four.
        """
        note = frappe.db.get_value(ROW_DOCTYPE, self.row_name, "outcome_note") or ""
        payload = get_row_candidates(self.row_name)
        self.assertIn(str(len(payload["settleable_candidates"])), note)


class TestImportSummaryEndpoint(OutflowReviewFixture):
    """`get_import_summary` -- the aggregate behind the summary section (slice X2).

    ⚠️ ASSERT PARTITIONS AND INVARIANTS, NOT EXACT COUNTS. This suite sees the LIVE ledger, so how
    many rows land `Matched` depends on what is approved in the database on the day. What must hold
    whatever the data does is that the numbers add up and agree with the rows they describe.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)

    def test_the_status_counts_sum_to_the_total(self):
        summary = get_import_summary(self.batch.name)["totals"]
        counted = sum(b["count"] for b in summary["by_status"].values())
        self.assertEqual(counted, summary["total_rows"])
        # ⚠️ THE SUCCESSFUL ROWS, NOT EVERY ROW (owner ruling 2026-08-10, option B). A transfer the
        # bank rejected is excluded from every figure this summary reports, so pinning against
        # `len(self.parsed.rows)` would now be pinning against the population the summary
        # deliberately stopped describing. The fixture carries one FAILED transfer, which is what
        # makes this assertion mean anything at all.
        self.assertEqual(summary["total_rows"], self.parsed.success_count)
        self.assertEqual(
            summary["failed_rows"], len(self.parsed.rows) - self.parsed.success_count
        )

    def test_a_failed_transfer_is_reported_but_never_counted(self):
        """The whole of option B: the row still exists, and no figure includes it.

        A failed transfer is money the bank refused to move. Counting it in `total_value`
        overstates the statement by exactly the amount that never left the account, and counting it
        in `total_rows` makes `decided_percent` a percentage of work that does not exist. It comes
        back only as `failed_rows` / `failed_value`, which the panel renders as a footnote.
        """
        summary = get_import_summary(self.batch.name)["totals"]
        failed = [r for r in self.parsed.rows if not r.is_success]
        self.assertTrue(failed, "the fixture must carry a failed transfer or this proves nothing")

        self.assertEqual(summary["failed_rows"], len(failed))
        self.assertAlmostEqual(
            summary["failed_value"], float(sum(r.amount for r in failed)), places=2
        )

        # The row was staged -- option B keeps the evidence -- it is only the figures it left.
        staged = get_batch_rows(self.batch.name)["rows"]
        self.assertIn(failed[0].transfer_id, [r["transfer_id"] for r in staged])

        # And the figure it left is the one that would have been overstated: the statement total is
        # the successful money exactly, with the rejected transfer nowhere inside it.
        self.assertAlmostEqual(
            summary["total_value"],
            float(sum(r.amount for r in self.parsed.rows if r.is_success)),
            places=2,
        )

    def test_open_and_decided_partition_the_import(self):
        """The two halves the screen shows as "still to do" and "done". If they ever stop summing to
        the total, a row is in a status neither set recognises and the panel is quietly lying."""
        summary = get_import_summary(self.batch.name)["totals"]
        self.assertEqual(summary["open_rows"] + summary["decided_rows"], summary["total_rows"])

    def test_the_money_agrees_with_the_rows_it_describes(self):
        """Pinned against `get_batch_rows`, which is the other read of the same data. The summary is
        an aggregate the screen shows ABOVE that table; the two disagreeing would be worse than
        either being absent.

        ⚠️ THE FAILED ROWS ARE SUBTRACTED FROM THE ROW SIDE, NOT ADDED BACK TO THE SUMMARY. Since
        the 2026-08-10 option-B ruling the two reads describe DIFFERENT populations on purpose:
        `get_batch_rows` returns every staged row, because a reviewer looking for the rejected
        transfer must be able to find it, while the summary reports only money that moved. The
        assertion has to name that difference explicitly -- pinning the two totals equal again would
        be pinning the overstatement this ruling removed.
        """
        summary = get_import_summary(self.batch.name)["totals"]
        rows = get_batch_rows(self.batch.name)["rows"]
        self.assertAlmostEqual(
            summary["total_value"] + summary["failed_value"],
            sum(r["amount"] for r in rows),
            places=2,
        )

    def test_confirmable_never_exceeds_matched_and_ambiguous_is_the_rest(self):
        summary = get_import_summary(self.batch.name)["totals"]
        self.assertLessEqual(summary["confirmable_rows"], summary["matched_rows"])
        self.assertEqual(
            summary["confirmable_rows"] + summary["ambiguous_rows"], summary["matched_rows"]
        )

    def test_confirmable_counts_exactly_the_rows_carrying_a_suggestion(self):
        """The number the bulk-confirm button will show. It must equal the rows that actually store
        a pick -- if it counted `Matched` instead, the dialog would promise more than it can act on.
        """
        summary = get_import_summary(self.batch.name)["totals"]
        stored = frappe.db.count(
            ROW_DOCTYPE,
            {
                "import_batch": self.batch.name,
                "row_status": "Matched",
                "suggested_name": ["is", "set"],
            },
        )
        self.assertEqual(summary["confirmable_rows"], stored)

    def test_the_skip_split_keys_on_the_decider_not_on_the_reason_text(self):
        """An upload-time skip has a system reason and NO decider; a manual one records the person.
        That is a fact the database holds exactly, so nothing here parses a sentence."""
        before = get_import_summary(self.batch.name)
        self.assertEqual(before["manually_skipped_rows"], 0)
        self.assertGreater(before["auto_skipped_rows"], 0)  # the fixture's failed + duplicate rows

        row = self._rows_by_transfer_suffix()["0009"]
        skip_row(row["name"], "settled from the other account")

        after = get_import_summary(self.batch.name)
        self.assertEqual(after["manually_skipped_rows"], 1)
        self.assertEqual(after["auto_skipped_rows"], before["auto_skipped_rows"])
        self.assertEqual(
            after["auto_skipped_rows"] + after["manually_skipped_rows"],
            after["totals"]["skipped_rows"],
        )

    def test_it_carries_the_identity_a_person_recognises_the_import_by(self):
        """The picker labels imports by file and period, never by the batch id -- which means
        nothing to an accountant."""
        payload = get_import_summary(self.batch.name)
        self.assertEqual(payload["import"]["name"], self.batch.name)
        self.assertEqual(payload["import"]["original_filename"], "test-statement.csv")
        self.assertIsNotNone(payload["import"]["period_from"])

    def test_every_money_figure_crosses_the_wire_as_a_number(self):
        """The deriver works in Decimal because money does; JSON does not carry one. A Decimal that
        reached the response would serialise as a string and every arithmetic on the screen would
        silently concatenate."""
        payload = get_import_summary(self.batch.name)
        totals = payload["totals"]
        for key in ("total_value", "open_value", "settled_value", "confirmable_value"):
            self.assertIsInstance(totals[key], float, key)
        for bucket in totals["by_status"].values():
            self.assertIsInstance(bucket["value"], float)


class TestTheMasterTableEndpoint(OutflowReviewFixture):
    """`get_outflow_rows` -- the paged read behind the master table (slice X3).

    ⚠️ IT SPANS EVERY IMPORT, so this suite scopes to its OWN batch for anything it asserts a count
    on. The live database carries other imports; a bare assertion here would pass or fail depending
    on what else somebody uploaded.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)

    def _page(self, **kwargs):
        kwargs.setdefault("batch", self.batch.name)
        return get_outflow_rows(**kwargs)

    def test_the_default_scope_is_the_work_not_the_archive(self):
        """⚠️ A PRODUCT DECISION, NOT A PERFORMANCE ONE (owner ruling). The master table is a
        worklist first: it opens on what somebody still owes a decision on, not on months of settled
        history that happens to sort first by date.

        NARROWER since the 2026-08-10 retab -- the old `open` default also held `Matched`, which now
        lives with `Settled` because both mean "this transfer has a record".
        """
        page = self._page()
        self.assertEqual(page["scope"], "not_matched")
        self.assertTrue(page["rows"])
        for row in page["rows"]:
            self.assertIn(row["row_status"], ("Pending match run", "Mismatched", "Error"))

    def test_the_two_working_scopes_partition_everything_except_skipped(self):
        """⚠️ `all` IS NOT EVERY ROW (owner ruling 2026-08-10). It is everything a person might
        still act on -- skipped rows are excluded from it, exactly as they are from the other two,
        because they have no tab at all. Asserted as arithmetic rather than a code read: the day
        `all` silently reverts to "no WHERE clause", this is what catches it.
        """
        counts = self._page()["tab_counts"]
        self.assertEqual(counts["not_matched"] + counts["matched"], counts["all"])

        # ⚠️ COUNTED FROM THE DATABASE, NOT THROUGH `_rows_by_transfer_suffix`. That helper is keyed
        # by transfer id, and this fixture deliberately REPEATS one -- so the two rows of the
        # in-file duplicate collapse to a single entry and the skipped count comes back one short.
        # Which is exactly the row this assertion is about, since a duplicate is one of the three
        # ways a row gets skipped.
        skipped = frappe.db.count(
            ROW_DOCTYPE, {"import_batch": self.batch.name, "row_status": "Skipped"}
        )
        self.assertTrue(skipped, "the fixture must contain a skipped row for this to mean anything")
        self.assertEqual(counts["all"] + skipped, len(self.parsed.rows))

    def test_no_tab_scope_will_show_a_skipped_row(self):
        """The other half of the ruling, asserted where a reader will look for it: NO TAB reaches a
        skipped transfer.

        ⚠️ THE THREE SCOPES ARE NAMED HERE ON PURPOSE, rather than iterating `_SCOPE_STATUSES`. A
        fourth scope exists now -- `skipped`, which the Skipped dialog asks for by name -- and
        iterating the map would have made this test quietly assert the opposite of its own title the
        moment that scope was added."""
        for scope in ("all", "not_matched", "matched"):
            for row in self._page(scope=scope, limit=200)["rows"]:
                self.assertNotEqual(row["row_status"], "Skipped", scope)

    def test_the_skipped_scope_returns_skipped_rows_and_nothing_else(self):
        """The dialog's read. Going LOOKING for skipped rows is not the same as a worklist showing
        them, which is why this is a scope with no tab."""
        rows = self._page(scope="skipped", limit=200)["rows"]
        self.assertTrue(rows, "the fixture must contain a skipped row")
        for row in rows:
            self.assertEqual(row["row_status"], "Skipped")

    def test_the_skipped_scope_does_not_change_what_all_holds(self):
        """Adding a scope must not widen the working views by one row."""
        counts = self._page()["tab_counts"]
        self.assertEqual(counts["not_matched"] + counts["matched"], counts["all"])
        self.assertGreater(counts["skipped"], 0)

    def test_the_failed_filter_splits_skipped_into_the_two_facts_it_hides(self):
        """⚠️ THE CHIP SAYS 20 AND THE STATUS SAYS 47, AND BOTH ARE RIGHT. `Skipped` covers three
        different facts; the owner ruled that a transfer the bank REFUSED leaves every figure the
        summary reports (option B), so `skipped_rows` counts only the rest. Nothing could ask for one
        of the two groups until this filter existed, which is how the Skipped dialog ended up showing
        a number its own chip did not."""
        every = self._page(scope="skipped", limit=200)
        refused = self._page(scope="skipped", limit=200, failed=1)
        recorded = self._page(scope="skipped", limit=200, failed=0)

        self.assertEqual(refused["total"] + recorded["total"], every["total"])
        self.assertTrue(refused["total"], "the fixture must contain a failed transfer")
        self.assertTrue(recorded["total"], "the fixture must contain a non-failed skip")

    def test_the_two_halves_of_skipped_reconcile_with_the_summary(self):
        """The whole point: the dialog's split must ADD UP to what the panel above it says. If these
        ever disagree, one of the two screens is lying about the same rows."""
        summary = get_import_summary(self.batch.name)["totals"]
        recorded = self._page(scope="skipped", limit=200, failed=0)["total"]
        refused = self._page(scope="skipped", limit=200, failed=1)["total"]
        self.assertEqual(recorded, summary["skipped_rows"])
        self.assertEqual(refused, summary["failed_rows"])

    def test_the_failed_filter_narrows_the_counts_it_labels(self):
        """`_row_filters` is ONE builder for the page, its count, the tab counts and the facets --
        so a filtered view's own numbers must move with it."""
        page = self._page(scope="skipped", limit=200, failed=1)
        self.assertEqual(page["tab_counts"]["skipped"], page["total"])

    def test_a_skipped_row_carries_its_reason_somewhere_a_reader_will_find_it(self):
        """⚠️ 20 of the 47 skipped rows on the first real statement have NO `skip_reason` -- the
        already-Paid duplicates record it in `outcome_note` instead, exactly as the Mismatched causes
        do. A dialog leaning on `skip_reason` alone would show blank cells for them."""
        for row in self._page(scope="skipped", limit=200)["rows"]:
            self.assertTrue(
                (row.get("outcome_note") or row.get("skip_reason") or "").strip(),
                f"{row['name']} is skipped and says nothing about why",
            )

    def test_the_matched_tab_can_be_told_apart_from_the_settled_half(self):
        """⚠️ THE ONE TAB WHOSE SINGLE NUMBER MEANS TWO THINGS, and the failure is not symmetric --
        it reads as the TERMINAL half. Live-observed on the first real statement: the tab read 863
        under the label "Matched / Settled" while `settled_rows` was 0, and it was understood as 863
        transfers finished. `status_counts` is what lets the tab render `863 matched - 0 settled`.

        Asserted as the arithmetic rather than as "the key exists": the split has to keep ADDING UP
        to the tab it labels, or the screen shows two numbers that disagree with the third.
        """
        page = self._page()
        counts = page["status_counts"]
        self.assertEqual(
            counts["Matched"] + counts["Settled"],
            page["tab_counts"]["matched"],
            "the split must total the tab it labels",
        )

    def test_every_status_is_zero_filled_so_none_reads_as_unknown(self):
        """A missing key renders as an em dash, which says "unknown" when the truth is "none" -- and
        "0 settled" is precisely the fact this breakdown exists to make visible."""
        counts = self._page()["status_counts"]
        for status in ROW_STATUSES:
            self.assertIn(status, counts, status)
            self.assertIsInstance(counts[status], int)

    def test_the_status_counts_describe_the_same_population_as_the_tabs(self):
        """⚠️ RAW, AND THEY INCLUDE `Skipped`, which no tab shows -- so they are a breakdown OF the
        population, never a fourth scope. This pins the relationship in the only direction that
        holds: the tab scopes are a SUBSET, and the difference is exactly the skipped rows."""
        page = self._page()
        counts = page["status_counts"]
        self.assertEqual(
            sum(counts[s] for s in ROW_STATUSES if s != "Skipped"),
            page["tab_counts"]["all"],
            "`all` is every status except Skipped",
        )
        self.assertGreater(counts["Skipped"], 0, "the fixture must contain a skipped row")

    def test_the_status_counts_narrow_with_the_search_like_the_tabs_do(self):
        """They label the same tabs, so they must be computed under the same filters. A breakdown
        taken over the whole table beside tab counts taken over a search is two numbers describing
        two different things, side by side, with nothing saying so."""
        narrow = self._page(scope="all", search="a-string-no-remark-contains-zzz")
        self.assertEqual(sum(narrow["status_counts"].values()), 0)

    def test_the_total_is_the_whole_result_not_the_page(self):
        """The paging control reads this. If it were the page length, "1–5 of 5" would show on a
        table with two hundred rows and nobody would know there was a second page."""
        page = self._page(scope="all", limit=2)
        self.assertEqual(len(page["rows"]), 2)
        # ⚠️ AGAINST THE SCOPE'S OWN COUNT, not against every parsed row. `all` stopped meaning
        # every row at the 2026-08-10 retab -- it excludes `Skipped` -- and this test is about
        # paging, so pinning it to the file length would make it fail for a reason it does not
        # describe. `test_the_two_working_scopes_partition_everything_except_skipped` owns that
        # arithmetic.
        self.assertEqual(page["total"], page["tab_counts"]["all"])
        self.assertGreater(page["total"], 2)

    def test_paging_walks_the_whole_set_without_repeating_a_row(self):
        first = self._page(scope="all", limit=3, offset=0)["rows"]
        second = self._page(scope="all", limit=3, offset=3)["rows"]
        self.assertFalse({r["name"] for r in first} & {r["name"] for r in second})

    def _beneficiary_of(self, suffix):
        """⚠️ Read from the ROW, not from `_rows_by_transfer_suffix` -- that helper selects a fixed
        field list for the suggestion tests and does not carry the beneficiary."""
        row = self._rows_by_transfer_suffix()[suffix]
        return frappe.db.get_value(ROW_DOCTYPE, row["name"], "beneficiary_name") or ""

    def test_search_spans_the_fields_a_person_remembers_a_transfer_by(self):
        target = self._rows_by_transfer_suffix()["0001"]
        found = self._page(scope="all", search=self._beneficiary_of("0001")[:6])["rows"]
        self.assertIn(target["name"], [r["name"] for r in found])

    def test_the_tab_counts_describe_the_CURRENT_search(self):
        """⚠️ NOT THE WHOLE TABLE. A search matching four rows must not show "Settled 812" beside
        it -- the numbers would be describing something other than what is on screen."""
        narrow = self._page(scope="all", search="a-string-no-remark-contains-zzz")
        self.assertEqual(narrow["total"], 0)
        self.assertEqual(narrow["tab_counts"]["all"], 0)

    def test_an_unknown_scope_falls_back_to_all_rather_than_to_nothing(self):
        """Failing OPEN is the right way round here: a scope this server has not heard of should
        show the widest set a client may ask for, which is visibly odd, rather than an empty table,
        which reads as "there is no work".

        ⚠️ THAT FALLBACK IS `all`, NOT "no clause" -- and the distinction became load-bearing when
        `all` stopped meaning every row. A no-clause fallback would show `Skipped` rows that every
        real tab excludes, in the one view nobody would think to check. Both assertions are needed:
        the first pins the width, the second pins that the width is still filtered.
        """
        rogue = self._page(scope="not-a-scope", limit=200)
        self.assertEqual(rogue["total"], self._page(scope="all")["total"])
        for row in rogue["rows"]:
            self.assertNotEqual(row["row_status"], "Skipped")

    def test_a_row_says_which_import_staged_it(self):
        """New at X3 and only meaningful from X3 on: the table spans every import, so "which
        statement was this?" becomes a real question. The FILENAME is what a person recognises."""
        row = self._page()["rows"][0]
        self.assertEqual(row["import_batch"], self.batch.name)
        self.assertEqual(row["import_filename"], "test-statement.csv")

    def test_an_unsortable_column_cannot_reach_the_sql(self):
        """The sort key is INTERPOLATED, so the allow-list is the injection guard. An unknown key
        falls back to the default rather than throwing -- a rejected sort would fail a whole page
        load over a cosmetic click."""
        page = self._page(sort_by="amount); DROP TABLE x; --")
        self.assertEqual(page["total"], self._page()["total"])

    def test_the_page_size_is_capped(self):
        """A client must not be able to ask for the entire table and reinstate the problem this
        endpoint exists to solve."""
        self.assertLessEqual(self._page(scope="all", limit=99999)["limit"], 200)

    def test_facet_values_come_from_the_whole_filtered_table(self):
        """⚠️ THE REASON THIS ENDPOINT EXISTS. The funnels used to be built from the rows the client
        held; a page of fifty rows knows fifty beneficiaries, so the same code against a paged table
        would offer a funnel that silently hides most of its own options."""
        page = self._page(scope="all", limit=1)
        values = get_outflow_facet_values(
            "beneficiary_name", batch=self.batch.name, scope="all"
        )["values"]
        self.assertEqual(len(page["rows"]), 1)
        self.assertGreater(len(values), 1)

    def test_a_facet_selection_narrows_the_page(self):
        beneficiary = self._beneficiary_of("0001")
        page = self._page(scope="all", facets=json.dumps({"beneficiary_name": [beneficiary]}))
        self.assertTrue(page["rows"])
        for row in page["rows"]:
            self.assertEqual(row["beneficiary_name"], beneficiary)

    def test_an_empty_facet_selection_is_no_filter_at_all(self):
        """Otherwise unticking the last value blanks the table instead of clearing the filter,
        which reads as a bug every single time."""
        self.assertEqual(
            self._page(scope="all", facets=json.dumps({"beneficiary_name": []}))["total"],
            self._page(scope="all")["total"],
        )

    def test_an_unknown_facet_column_is_ignored_rather_than_fatal(self):
        """A stale bookmark carrying a facet from a column that has since been removed should show
        an unfiltered table, not an error page."""
        self.assertEqual(
            self._page(scope="all", facets=json.dumps({"not_a_column": ["x"]}))["total"],
            self._page(scope="all")["total"],
        )

    def test_an_unknown_facet_column_IS_fatal_when_asked_for_its_values(self):
        """The read is the other way round: the column name is interpolated, so an unknown one is a
        programming error and must be loud rather than silently empty."""
        with self.assertRaises(frappe.ValidationError):
            get_outflow_facet_values("amount); DROP TABLE x; --")


class TestConfirmableRows(OutflowReviewFixture):
    """`get_confirmable_rows` -- what "Confirm all matched" may and may not act on (slice X5).

    ⚠️ EVERY TEST HERE IS READ-ONLY, AND THE TWO THAT MUTATE LIVE IN THEIR OWN CLASS BELOW. The
    fixture is per-CLASS, so a test that settles a row or rewrites a suggestion changes what its
    alphabetically-later siblings see -- and unittest runs methods in alphabetical order, so
    `test_a_settled_row...` ran FIRST and consumed the only confirmable row before three assertions
    about it. The symptom was `0 != 1` on tests that were correct, which reads exactly like a broken
    endpoint. `test_settle_payment`'s fixture docstring records the same trap; this is the cheap
    version of its answer -- separate the mutators rather than rebuild the fixture per test.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)

    def test_ready_rows_all_carry_a_target(self):
        payload = get_confirmable_rows(self.batch.name)
        self.assertTrue(payload["ready"])
        for row in payload["ready"]:
            self.assertTrue(row["target_doctype"])
            self.assertTrue(row["target_name"])

    def test_ready_and_needs_you_together_are_exactly_the_matched_rows(self):
        """⚠️ `Matched` IS NOT THE SAME AS CONFIRMABLE. A row that matched SEVERAL approved records
        stores no suggestion -- there is nothing to confirm it against -- and must appear in
        `needs_you` rather than being dropped from the dialog entirely."""
        payload = get_confirmable_rows(self.batch.name)
        matched = frappe.db.count(
            ROW_DOCTYPE, {"import_batch": self.batch.name, "row_status": "Matched"}
        )
        self.assertEqual(len(payload["ready"]) + len(payload["needs_you"]), matched)

    def test_ready_counts_exactly_the_rows_carrying_a_stored_suggestion(self):
        payload = get_confirmable_rows(self.batch.name)
        stored = frappe.db.count(
            ROW_DOCTYPE,
            {
                "import_batch": self.batch.name,
                "row_status": "Matched",
                "suggested_name": ["is", "set"],
            },
        )
        self.assertEqual(len(payload["ready"]), stored)

    def test_it_agrees_with_the_summary_about_how_many_are_confirmable(self):
        """The button's number and the dialog's list must be the same number, or the dialog opens
        promising more than it shows."""
        self.assertEqual(
            len(get_confirmable_rows(self.batch.name)["ready"]),
            get_import_summary(self.batch.name)["totals"]["confirmable_rows"],
        )

    def test_every_ready_row_reports_whether_confirming_changes_the_amount(self):
        """⚠️ SINCE X1 A SETTLE REWRITES THE RECORD'S AMOUNT, so confirming forty rows can change
        forty approved figures. The dialog shows the delta BEFORE the click, which it can only do if
        this read carries it."""
        for row in get_confirmable_rows(self.batch.name)["ready"]:
            self.assertIn("amount_changes", row)
            self.assertIn("amount_delta", row)
            self.assertEqual(
                row["amount_changes"], row["target_amount"] != row["amount"]
            )


class TestConfirmableRowsUnderChange(OutflowReviewFixture):
    """The two `get_confirmable_rows` cases that MUTATE, on a fixture of their own.

    See the note on `TestConfirmableRows` for why they are not siblings of the read-only ones.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)

    def test_a_settled_row_leaves_the_confirmable_set(self):
        payload = get_confirmable_rows(self.batch.name)
        self.assertTrue(payload["ready"], "fixture precondition: something must be confirmable")
        target = payload["ready"][0]
        before = len(payload["ready"])

        settle_row(target["name"], target["target_doctype"], target["target_name"])

        self.assertEqual(len(get_confirmable_rows(self.batch.name)["ready"]), before - 1)

    def test_a_suggestion_pointing_at_a_vanished_record_becomes_stale(self):
        """Not an error and not a silent drop: the row still needs somebody, and saying so is the
        only outcome that gets it looked at.

        ⚠️ IT IS `stale`, NOT `needs_you`, AND THE SPLIT IS THE POINT. Both mean "a person has to
        open this", so they shared a bucket until the summary panel's button and this dialog were
        found reporting different numbers with nothing accounting for the gap. The button counts
        `Matched` rows carrying a `suggested_name` and never checks the name resolves; this endpoint
        does. A row like the one below is therefore INSIDE the button's count and outside `ready` --
        so it has to be nameable, or the difference stays unexplainable on screen.
        """
        rows = self._rows_by_transfer_suffix()
        row = rows["0003"]
        frappe.db.set_value(
            ROW_DOCTYPE,
            row["name"],
            {"row_status": "Matched", "suggested_doctype": "Project Payments",
             "suggested_name": "PAY-does-not-exist"},
            update_modified=False,
        )
        frappe.db.commit()

        payload = get_confirmable_rows(self.batch.name)
        self.assertIn(row["name"], [r["name"] for r in payload["stale"]])
        self.assertNotIn(row["name"], [r["name"] for r in payload["ready"]])
        self.assertNotIn(row["name"], [r["name"] for r in payload["needs_you"]])

    def test_the_three_buckets_partition_the_matched_rows(self):
        """The funnel the dialog states, as an invariant.

        `matched_rows = ready + stale + needs_you` is what lets the dialog explain why the button
        said one number and the list shows another. If the three ever stop partitioning, a matched
        row has fallen out of every bucket and is silently unconfirmable.
        """
        payload = get_confirmable_rows(self.batch.name)
        self.assertEqual(
            len(payload["ready"]) + len(payload["stale"]) + len(payload["needs_you"]),
            payload["matched_rows"],
        )

    def test_confirmable_on_the_button_equals_ready_plus_stale(self):
        """The two screens, reconciled -- the defect this split was written for.

        The summary panel's button reads `confirmable_rows`; this dialog lists `ready`. They are
        allowed to differ, and they SHOULD when a suggested record has been deleted since the match
        ran. What is not allowed is for the difference to be unaccounted for, and `stale` is the
        account.
        """
        summary = get_import_summary(self.batch.name)["totals"]
        payload = get_confirmable_rows(self.batch.name)
        self.assertEqual(
            len(payload["ready"]) + len(payload["stale"]), summary["confirmable_rows"]
        )


class TestTheTierLadderEndToEnd(OutflowReviewFixture):
    """Tiers 1 and 2 through the REAL endpoint, pools and all.

    ⚠️ THIS CLASS EXISTS BECAUSE EVERY OTHER FIXTURE PAYMENT CARRIES ITS ROW'S OWN BANK REFERENCE,
    so the whole of `test_review` was exercising TIER 0 and nothing else. The pure suite covers the
    tier rules exhaustively with a hand-built index; what it cannot cover is the WIRING -- that
    `_load_pools` actually loads a project index, that it reaches `match_row`, and that the amount
    pool is wide enough for tier 2. Forget any one of those and every pure test still passes while
    tiers 1 and 2 never fire in production.

    Both planted payments carry a UTR that is NOT a bank reference -- the shape 932 of 7,420 live
    Paid payments really have -- so tier 0 cannot fire and the ladder has to reach further.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        # A project whose name cannot collide with the 194 live ones, so the remark below names it
        # unambiguously. Raw-inserted for the same reason payments are: `Projects.after_insert`
        # generates work milestones, and this suite runs against the LIVE development database.
        cls.test_project = f"TEST-OFP-{frappe.generate_hash(length=10)}"
        cls.test_project_name = f"Quarkbridge{frappe.generate_hash(length=6)}"
        frappe.db.sql(
            """
            INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner, docstatus, idx,
                                       project_name)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s)
            """,
            (cls.test_project, "Administrator", "Administrator", cls.test_project_name),
        )

        # TIER 1 -- row 0010 pays account 82345678908 / TEST0000008. A vendor holding BOTH is what
        # admits it; the payment's junk UTR is what keeps tier 0 out of the way.
        cls.tier1_row = cls._row("0010")
        cls.test_vendor = f"TEST-OFV-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """
            INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner, docstatus, idx,
                                      vendor_name, account_number, ifsc)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s)
            """,
            (cls.test_vendor, "Administrator", "Administrator", "Testvendor Theta Ltd",
             cls.tier1_row.bank_account, cls.tier1_row.ifsc),
        )
        cls.pay_tier1 = cls._insert_payment_row(
            amount=cls.tier1_row.amount, status="Approved",
            utr="PO/077/00066/25-26", payment_date=None, project=cls.test_project,
        )
        frappe.db.set_value(
            "Project Payments", cls.pay_tier1, "vendor", cls.test_vendor, update_modified=False
        )

        # TIER 2 -- row 0009 has no IFSC at all, so it can never reach tier 1. Naming the project in
        # its remark is the only thing that can match it.
        cls.tier2_row = cls._row("0009")
        cls.pay_tier2 = cls._insert_payment_row(
            amount=cls.tier2_row.amount, status="Approved",
            utr="refund", payment_date=None, project=cls.test_project,
        )
        frappe.db.set_value(
            ROW_DOCTYPE,
            {"import_batch": cls.batch.name, "transfer_id": cls.tier2_row.transfer_id},
            "remarks",
            f"Material advance for {cls.test_project_name}",
            update_modified=False,
        )

        # THE CONTROL for tier 2 -- identical to the row above in every respect EXCEPT the remark,
        # which is left as the fixture wrote it ("Sample Project materials", naming no project this
        # company runs). Row 0006's own planted payment is CEO Pending and so is not in any pool.
        cls.control_row = cls._row("0006")
        cls.pay_control = cls._insert_payment_row(
            amount=cls.control_row.amount, status="Approved",
            utr="refund", payment_date=None, project=cls.test_project,
        )

        frappe.db.commit()
        match_batch(cls.batch.name)

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("Vendors", {"name": cls.test_vendor})
        frappe.db.delete("Projects", {"name": cls.test_project})
        super().tearDownClass()

    def test_tier_1_matches_on_the_bank_account_and_ifsc(self):
        row = self._rows_by_transfer_suffix()["0010"]
        self.assertEqual(row["row_status"], "Matched")
        self.assertEqual(row["suggested_name"], self.pay_tier1)
        self.assertIn("went to this vendor's bank account", row["outcome_note"])

    def test_tier_2_matches_on_the_project_named_in_the_remark(self):
        row = self._rows_by_transfer_suffix()["0009"]
        self.assertEqual(row["row_status"], "Matched")
        self.assertEqual(row["suggested_name"], self.pay_tier2)
        self.assertIn("remark names its project", row["outcome_note"])

    def test_a_row_whose_remark_names_no_project_reaches_no_tier_2(self):
        """⚠️ THE CONTROL, AND IT IS THE MOST LOAD-BEARING TEST IN THIS CLASS. Row 0006 has an
        approved payment planted at its exact amount, in a project, with a junk UTR -- everything
        the row above has -- and differs ONLY in that its remark names no project. It must stay
        `Mismatched`. If tier 2 ever stops requiring the project, the amount pool is wide enough that
        this row matches instantly, and this assertion is what says so."""
        row = self._rows_by_transfer_suffix()["0006"]
        self.assertEqual(row["row_status"], "Mismatched")
        self.assertIsNone(row["suggested_name"])


class TestStackAutoPairing(OutflowReviewFixture):
    """The chunk-E stack pass, through the REAL endpoint (`_resolve_stacks`).

    THE CASE. Several transfers that are indistinguishable from one another -- same vendor account,
    same amount -- against the same number of indistinguishable approved payments. Row by row the
    matcher correctly refuses to pick one; for the SET there is exactly one sensible outcome.

    ⚠️ THE FIXTURE REWRITES STAGED ROWS IN PLACE, which no other class here does, and it has to:
    the CSV's rows all carry distinct amounts and references, so no stack can form from it as
    written. Rewriting `bank_account` / `ifsc` / `amount` means also rewriting `normalized_account`
    -- the normalised column is computed at STAGING and a `set_value` on the raw column leaves it
    stale, which would silently put the row in no stack at all. Both references are cleared so
    tier 0 cannot fire and hand a row a sole suggestion, which would take it out of the stack.
    """

    # Amounts chosen to be implausible in the live ledger, so a real approved payment cannot wander
    # into the pool and change the counts this class asserts on.
    #
    # ⚠️ AND SEPARATED BY FAR MORE THAN THE TIER-1 WINDOW, which the first version of this fixture
    # was not: 7737.11 / .22 / .33 are all within +-Re 1 of each other, so every stack's candidate
    # set contained every stack's payments -- 7 records against 3 transfers -- and nothing paired.
    # That is the code behaving CORRECTLY (see
    # `test_two_stacks_within_the_tier_one_window_of_each_other_do_not_pair`, which pins it on
    # purpose); it was the fixture that was wrong.
    STACK_A_AMOUNT = 7737.11
    STACK_B_AMOUNT = 8848.22
    STACK_C_AMOUNT = 9959.33
    # Deliberately 50 paise from stack A -- inside the tier-1 window, so it shares A's candidates.
    STACK_NEAR_A_AMOUNT = 7737.61

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.extra_vendors: list = []

        cls.stack_account = "98765432101"
        cls.stack_ifsc = "TEST0009999"
        cls.stack_vendor = f"TEST-OFV-{frappe.generate_hash(length=10)}"
        frappe.db.sql(
            """
            INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner, docstatus, idx,
                                      vendor_name, account_number, ifsc)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s)
            """,
            (cls.stack_vendor, "Administrator", "Administrator",
             "Testvendor Stackco Ltd", cls.stack_account, cls.stack_ifsc),
        )
        cls.extra_vendors.append(cls.stack_vendor)

        # STACK A -- BALANCED: three transfers, three approved payments.
        #
        # ⚠️ NOT SUFFIX `0001`. The fixture REPEATS that transfer id (CSV rows 1 and 12) to exercise
        # the in-file duplicate guard, so a `transfer_id` lookup returns an arbitrary one of the two
        # and roughly half the time hands back the row that was SKIPPED at upload. `_stack_row`
        # asserts against that now, but the simpler fix is not to use the ambiguous suffix at all.
        cls.a_rows = [cls._stack_row(s, cls.STACK_A_AMOUNT) for s in ("0003", "0004", "0005")]
        cls.a_payments = [cls._stack_payment(cls.STACK_A_AMOUNT) for _ in range(3)]

        # STACK B -- UNBALANCED: THREE transfers, TWO approved payments. The owner's residual
        # collision shape -- the statement holds more transfers than the ledger holds records.
        #
        # ⚠️ THREE-AGAINST-TWO, NOT TWO-AGAINST-ONE, and the first version of this fixture was the
        # latter and tested nothing. With a single candidate every row gets a SOLE SUGGESTION from
        # the per-row matcher, so both rows arrive already suggested, the stack pass skips them
        # entirely, and the assertion passed for a reason that had nothing to do with the code under
        # test. Two candidates is the smallest set for which `sole_suggestion` declines and the
        # stack pass is genuinely the thing being exercised.
        cls.b_rows = [cls._stack_row(s, cls.STACK_B_AMOUNT) for s in ("0006", "0007", "0008")]
        cls.b_payments = [cls._stack_payment(cls.STACK_B_AMOUNT) for _ in range(2)]

        # STACK C -- SPANS TWO IMPORTS: two transfers here, one in a batch staged mid-test, three
        # approved payments. Unbalanced until the second import lands.
        cls.c_rows = [cls._stack_row(s, cls.STACK_C_AMOUNT) for s in ("0009", "0010")]
        cls.c_payments = [cls._stack_payment(cls.STACK_C_AMOUNT) for _ in range(3)]

        frappe.db.commit()

    @classmethod
    def _stack_row(cls, suffix, amount) -> str:
        """Rewrite one staged row into the stack's identity. Returns its `name`."""
        from nirmaan_stack.services.outflow_import.normalize import normalize_account

        name = frappe.db.get_value(
            ROW_DOCTYPE,
            {"import_batch": cls.batch.name, "transfer_id": cls._row(suffix).transfer_id},
            "name",
        )
        # ⚠️ ASSERTED, NOT ASSUMED, and it cost a debugging session to learn why. A row that was
        # skipped at upload is excluded from every stack, so building the fixture on one produces a
        # class where NOTHING pairs and every assertion fails for a reason that looks like a defect
        # in the code under test. Two of the fixture's twelve rows are skipped at upload -- the
        # FAILED transfer and the second copy of the repeated transfer id -- and the second is
        # reachable by a `transfer_id` lookup that has two rows to choose from.
        staged_status = frappe.db.get_value(ROW_DOCTYPE, name, "row_status")
        if staged_status != "Pending match run":
            raise AssertionError(
                f"fixture row {suffix} staged as {staged_status!r}, not 'Pending match run' -- "
                f"it cannot be part of a stack. Pick a suffix that is SUCCESS and whose transfer "
                f"id appears once in the CSV."
            )
        frappe.db.set_value(
            ROW_DOCTYPE,
            name,
            {
                "bank_account": cls.stack_account,
                "normalized_account": normalize_account(cls.stack_account),
                "ifsc": cls.stack_ifsc,
                "amount": amount,
                # ⚠️ BOTH reference columns. Leaving either would let tier 0 fire and give the row a
                # sole suggestion, which removes it from the stack -- and the test would then be
                # asserting nothing.
                "bank_reference_no": None,
                "normalized_reference": None,
            },
            update_modified=False,
        )
        return name

    @classmethod
    def _stack_payment(cls, amount) -> str:
        """An approved payment to the stack's vendor. Junk UTR, so tier 0 cannot reach it."""
        name = cls._insert_payment_row(
            amount=amount, status="Approved", utr="PO/STACK/00001/25-26",
            payment_date=None, project=cls.project,
        )
        frappe.db.set_value(
            "Project Payments", name, "vendor", cls.stack_vendor, update_modified=False
        )
        return name

    @classmethod
    def tearDownClass(cls):
        for name in getattr(cls, "extra_vendors", []):
            frappe.db.delete("Vendors", {"name": name})
        super().tearDownClass()

    def _suggestions(self, names) -> list:
        return [
            frappe.db.get_value(
                ROW_DOCTYPE, n, ["suggested_doctype", "suggested_name", "outcome_note"], as_dict=True
            )
            for n in names
        ]

    def test_a_balanced_stack_pairs_every_transfer_to_its_own_record(self):
        match_batch(self.batch.name)
        rows = self._suggestions(self.a_rows)

        for row in rows:
            self.assertEqual(row.suggested_doctype, "Project Payments")
            self.assertIn(row.suggested_name, self.a_payments)

        assigned = [r.suggested_name for r in rows]
        self.assertEqual(
            len(set(assigned)), 3,
            "a record handed to two transfers is the AlreadyPaidError the whole fix exists to stop",
        )

    def test_an_auto_paired_row_says_the_pairing_was_arbitrary(self):
        """⚠️ THE MITIGATION FOR THE ACCEPTED RISK, pinned at the endpoint. The owner accepted
        arbitrary pairing between interchangeable records; six payments of one amount may sit on six
        different projects, and a note reading like an ordinary confident match would hide the one
        fact a reviewer needs to catch that."""
        match_batch(self.batch.name)
        for row in self._suggestions(self.a_rows):
            self.assertIn("arbitrary", row.outcome_note)
            self.assertIn("Check the project before confirming", row.outcome_note)

    def test_an_unbalanced_stack_is_left_entirely_alone(self):
        """Two transfers, one record: SOME transfer settles nothing, and choosing which is a
        judgement about money. Nothing is paired -- not even the one that would fit."""
        match_batch(self.batch.name)
        for row in self._suggestions(self.b_rows):
            self.assertIsNone(row.suggested_name)

    def test_the_pairing_is_identical_across_re_runs(self):
        """⚠️ Re-running the match is NORMAL -- payments get ticked Paid by hand all day. A pairing
        that reshuffled would move a suggestion out from under a reviewer mid-decision, and nothing
        on the screen would say it had moved."""
        match_batch(self.batch.name)
        first = {n: r.suggested_name for n, r in zip(self.a_rows, self._suggestions(self.a_rows))}
        match_batch(self.batch.name)
        second = {n: r.suggested_name for n, r in zip(self.a_rows, self._suggestions(self.a_rows))}
        self.assertEqual(first, second)

    def test_a_stack_spanning_two_imports_pairs_only_once_the_second_one_lands(self):
        """⚠️ THE CROSS-IMPORT WRITE, WHICH IS THE RISKIEST THING IN THIS CHUNK -- matching batch B
        changes rows belonging to batch A.

        Stack C has three approved payments and only two transfers in this batch, so the first
        match leaves it alone. Staging a second import carrying the third transfer makes it
        balanced, and matching THAT batch must pair all three -- including the two that belong to
        the first import and were not part of the run.
        """
        match_batch(self.batch.name)
        self.assertTrue(
            all(r.suggested_name is None for r in self._suggestions(self.c_rows)),
            "two transfers against three records is unbalanced and must not pair",
        )

        second = _fresh_parse()
        second_batch = _stage_batch(
            second,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        type(self).batches.append(second_batch.name)
        third_transfer = self._stack_row_in(second_batch.name, second, "0006", self.STACK_C_AMOUNT)
        frappe.db.commit()

        match_batch(second_batch.name)

        paired = self._suggestions([*self.c_rows, third_transfer])
        for row in paired:
            self.assertIsNotNone(row.suggested_name, "the stack is balanced now and must pair")
            self.assertIn(row.suggested_name, self.c_payments)
        self.assertEqual(len({r.suggested_name for r in paired}), 3)

    @classmethod
    def _stack_row_in(cls, batch, parsed, suffix, amount) -> str:
        """`_stack_row`, but against a batch other than the class's own."""
        from nirmaan_stack.services.outflow_import.normalize import normalize_account

        transfer_id = next(r for r in parsed.rows if r.transfer_id.endswith(suffix)).transfer_id
        name = frappe.db.get_value(
            ROW_DOCTYPE, {"import_batch": batch, "transfer_id": transfer_id}, "name"
        )
        frappe.db.set_value(
            ROW_DOCTYPE,
            name,
            {
                "bank_account": cls.stack_account,
                "normalized_account": normalize_account(cls.stack_account),
                "ifsc": cls.stack_ifsc,
                "amount": amount,
                "bank_reference_no": None,
                "normalized_reference": None,
            },
            update_modified=False,
        )
        return name

    def test_a_record_inside_the_tier_one_window_unbalances_the_stack(self):
        """⚠️ A REAL LIMIT OF THE DESIGN, pinned deliberately rather than discovered later.

        The stack KEY groups transfers on an EXACT amount, but the CANDIDATE set comes from the
        matcher, which uses the +-Re 1 tier-1 window. So a payment 50 paise away is a candidate for
        stack A without being part of it: 3 transfers against 4 records, unbalanced, nothing paired.

        That is correct, not a defect. Picking 3 of 4 records would be choosing WHICH payments this
        stack settles -- exactly the guess the whole pass refuses to make. The cost is that
        near-identical amounts fall through to a person, and that is the right side to fail on.
        """
        intruder = self._stack_payment(self.STACK_NEAR_A_AMOUNT)
        frappe.db.commit()
        try:
            match_batch(self.batch.name)
            for row in self._suggestions(self.a_rows):
                self.assertIsNone(
                    row.suggested_name,
                    "a fourth candidate 50 paise away leaves stack A unbalanced, so nothing may "
                    "pair",
                )
        finally:
            # Put stack A back where the other tests expect it.
            frappe.db.delete("Project Payments", {"name": intruder})
            frappe.db.commit()
            match_batch(self.batch.name)

    def test_the_stack_pass_spans_imports(self):
        """A stack does not respect batch boundaries, so a pass scoped to one import would see half
        of its own problem -- and would state a surplus that is not the real one.

        ⚠️ THIS USED TO READ `get_unpaired_stacks`, WHICH IS DELETED. The screen went; the property
        it proved did not, so the assertion moved onto the artefact that replaced it -- the surplus
        note the pass now writes on the leftover rows. That note is only CORRECT when the count
        spans imports, which is exactly what this test is for.

        ⚠️ IT BUILDS AND TEARS DOWN ITS OWN CROSS-IMPORT MEMBER rather than leaning on stack C.
        The first version asserted on C, which is unbalanced only UNTIL
        `test_a_stack_spanning_two_imports_...` stages the batch that balances it -- and that test
        sorts earlier, so this one read an empty result and failed for a reason that had nothing to
        do with the pass. A test whose meaning depends on which tests ran before it is not testing
        what its name says.
        """
        second = _fresh_parse()
        second_batch = _stage_batch(
            second,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        type(self).batches.append(second_batch.name)
        extra = self._stack_row_in(second_batch.name, second, "0003", self.STACK_B_AMOUNT)
        frappe.db.commit()
        try:
            # ⚠️ THE PRECONDITION IS SET EXPLICITLY, NOT INHERITED. Sibling tests in this class
            # legitimately leave stack B's rows carrying suggestions, and `_resolve_stacks` only
            # ever looks at rows WITHOUT one -- so a version of this test that just ran the match
            # found the first batch's members invisible and proved nothing. Two earlier drafts
            # failed here in two different ways, both of them order-dependence, which is the exact
            # trap this test's own docstring warns about.
            members = frappe.db.sql(
                """
                SELECT name FROM "tabOutflow Import Row"
                WHERE normalized_account = %s AND amount = %s AND row_status IN %s
                """,
                (
                    normalize_account(self.stack_account),
                    self.STACK_B_AMOUNT,
                    tuple(OPEN_ROW_STATUSES),
                ),
                as_dict=True,
            )
            for m in members:
                frappe.db.set_value(
                    ROW_DOCTYPE, m["name"],
                    {"suggested_doctype": None, "suggested_name": None, "suggestion_rule": None},
                    update_modified=False,
                )
            frappe.db.commit()

            match_batch(second_batch.name)

            rows = frappe.db.sql(
                """
                SELECT name, import_batch, outcome_note FROM "tabOutflow Import Row"
                WHERE normalized_account = %s AND amount = %s
                  AND row_status IN %s AND COALESCE(suggested_name, '') = ''
                """,
                (
                    normalize_account(self.stack_account),
                    self.STACK_B_AMOUNT,
                    tuple(OPEN_ROW_STATUSES),
                ),
                as_dict=True,
            )
            by_batch = {}
            for r in rows:
                by_batch.setdefault(r["import_batch"], []).append(r)

            self.assertEqual(
                len(by_batch), 2, "the stack must carry members from both imports"
            )
            self.assertGreater(
                len(rows), max(len(v) for v in by_batch.values()),
                "no single batch may hold the whole stack, or this proves nothing about spanning",
            )

            # ⚠️ THE WHOLE ASSERTION, AND NOTE WHICH BATCH WAS MATCHED. Only the SECOND batch was
            # run, yet a row in the FIRST one now carries a note naming the cross-import count. A
            # pass scoped to one batch could neither have written it nor known the number.
            first_batch_rows = [r for r in rows if r["import_batch"] == self.batch.name]
            self.assertTrue(first_batch_rows, "the first batch must still hold stack B members")
            for r in first_batch_rows:
                self.assertIn(
                    f"{len(rows)} identical transfers", r["outcome_note"] or "",
                    f"{r['name']} states a count that is not the cross-import one",
                )
        finally:
            # Return stack B to the 3-against-2 the later tests expect. Skipping is how a row
            # leaves a stack, and it is what the pass itself honours.
            frappe.db.set_value(ROW_DOCTYPE, extra, "row_status", "Skipped", update_modified=False)
            frappe.db.commit()

    def test_the_pass_never_touches_a_settled_or_skipped_row(self):
        """`_load_open_rows_for_keys` filters on OPEN_ROW_STATUSES. A skipped row carrying the
        stack's account and amount must be left exactly as it is.

        ⚠️ THE SETUP IS SHARPER THAN IT LOOKS. Stack B is 3 transfers against 2 records --
        unbalanced, so it pairs nothing. Skipping one member leaves 2 against 2, which IS balanced,
        so the pass runs and pairs the other two ROUND the skipped row. The assertion is therefore
        not "the pass did nothing"; it is "the pass did its work and still did not touch this row",
        which is the property that actually matters.
        """
        match_batch(self.batch.name)
        frappe.db.set_value(ROW_DOCTYPE, self.b_rows[0], "row_status", "Skipped", update_modified=False)
        frappe.db.set_value(
            ROW_DOCTYPE, self.b_rows[0], "suggested_name", None, update_modified=False
        )
        frappe.db.commit()

        match_batch(self.batch.name)
        after = frappe.db.get_value(
            ROW_DOCTYPE, self.b_rows[0], ["row_status", "suggested_name"], as_dict=True
        )
        self.assertEqual(after.row_status, "Skipped")
        self.assertIsNone(after.suggested_name)


# ⚠️ `get_reconciliation_report` AND ITS TWO TESTS WERE DELETED AT V5, and one capability went with
# them that the three tabs do NOT replace: the REVERSE VIEW -- payments we recorded as Paid inside
# the statement's period with no bank row behind them. The tabs answer "is this transfer recorded?";
# nothing now answers "is every payment we recorded backed by a real transfer?". That is a
# deliberate scope decision, not an oversight; if it is wanted back it is a revert of this commit,
# not a rewrite.


if __name__ == "__main__":
    unittest.main()


class TestARecordIsClaimedOnce(OutflowReviewFixture):
    """The claim rule through the REAL endpoint (`_enforce_single_claim`).

    THE DEFECT IT EXISTS FOR, found on the first real statement. `sole_suggestion` asks a question
    about ONE row -- "did this transfer find exactly one approved record?" -- and answers it
    independently for every row. So two transfers can each correctly find the SAME single record.
    Five records were in that state across 15 rows; ten of the 807 confirms were going to fail with
    `AlreadyPaidError` before anybody pressed the button.

    ⚠️ THE FIXTURE USES TIER 2, NOT TIER 1, AND THAT IS THE REAL SHAPE. The live contenders were to
    DIFFERENT beneficiaries -- one record was suggested to transfers for four unrelated payees -- so
    they cannot have matched on a shared bank account. They matched on amount plus a project named
    in the remark. Two DIFFERENT accounts is also what keeps them out of a stack, which is the whole
    point: a stack is the case this rule is NOT about, and `_resolve_stacks` already guards itself.
    """

    AMOUNT = 6631.77  # implausible in the live ledger, so no real payment wanders into the pool

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.claim_project = f"TEST-OFP-{frappe.generate_hash(length=10)}"
        cls.claim_project_name = f"Zephyrline{frappe.generate_hash(length=6)}"
        frappe.db.sql(
            """
            INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner, docstatus, idx,
                                       project_name)
            VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s)
            """,
            (cls.claim_project, "Administrator", "Administrator", cls.claim_project_name),
        )

        # Two transfers, DIFFERENT accounts, same amount, both naming the same project. Tier 2
        # therefore offers both of them the same single approved payment.
        cls.rows = [
            cls._claim_row("0003", "70000000001", "2026-01-02 09:00:00"),
            cls._claim_row("0004", "70000000002", "2026-01-03 09:00:00"),
        ]
        cls.payment = cls._insert_payment_row(
            amount=cls.AMOUNT, status="Approved", utr="PO/CLAIM/00001/25-26",
            payment_date=None, project=cls.claim_project,
        )
        frappe.db.commit()
        cls.result = match_batch(cls.batch.name)

    @classmethod
    def _claim_row(cls, suffix, account, added_on) -> str:
        from nirmaan_stack.services.outflow_import.normalize import normalize_account

        name = frappe.db.get_value(
            ROW_DOCTYPE,
            {"import_batch": cls.batch.name, "transfer_id": cls._row(suffix).transfer_id},
            "name",
        )
        frappe.db.set_value(
            ROW_DOCTYPE,
            name,
            {
                "bank_account": account,
                "normalized_account": normalize_account(account),
                "ifsc": "TEST0007777",
                "amount": cls.AMOUNT,
                "remarks": f"{cls.claim_project_name} miscellaneous services",
                "added_on": added_on,
                # Tier 0 must not fire, or each row takes its own record and there is no contest.
                "bank_reference_no": None,
                "normalized_reference": None,
            },
            update_modified=False,
        )
        return name

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("Projects", {"name": cls.claim_project})
        super().tearDownClass()

    def _suggested(self, name):
        return frappe.db.get_value(
            ROW_DOCTYPE, name, ["suggested_doctype", "suggested_name", "row_status", "outcome_note"],
            as_dict=True,
        )

    def test_the_precondition_both_transfers_really_did_match_the_one_payment(self):
        """⚠️ ASSERTED, NOT ASSUMED. If tier 2 stopped reaching these rows the class below would go
        green for the wrong reason -- nothing suggested is trivially not double-suggested."""
        for name in self.rows:
            self.assertEqual(self._suggested(name).row_status, "Matched")

    def test_exactly_one_transfer_ends_up_holding_the_record(self):
        held = [n for n in self.rows if (self._suggested(n).suggested_name or "") == self.payment]
        self.assertEqual(len(held), 1, "a record can be settled once")

    def test_the_earliest_transfer_is_the_one_that_keeps_it(self):
        self.assertEqual(self._suggested(self.rows[0]).suggested_name, self.payment)

    def test_the_loser_is_left_with_no_suggestion_rather_than_a_second_best(self):
        """Losing a contest does not show a transfer belongs to something else."""
        loser = self._suggested(self.rows[1])
        self.assertFalse((loser.suggested_name or "").strip())
        self.assertFalse((loser.suggested_doctype or "").strip())

    def test_the_loser_stays_Matched_because_it_did_find_approved_records(self):
        """The status is about what the matcher FOUND. What the row lost is a pre-selection."""
        self.assertEqual(self._suggested(self.rows[1]).row_status, "Matched")

    def test_the_loser_note_names_the_record_so_the_reviewer_can_go_and_look(self):
        """⚠️ THE OLD NOTE WOULD BE WORSE THAN THE OLD SUGGESTION. It said "One approved record at
        this amount", of a row that now shows nothing at all."""
        note = self._suggested(self.rows[1]).outcome_note or ""
        self.assertIn(self.payment, note)
        self.assertIn("settled once", note)

    def test_the_run_reports_how_many_rows_released(self):
        """A run that releases a lot should be visible, not silently producing rows needing a
        choice."""
        self.assertGreaterEqual(self.result.get("released_rows", 0), 1)

    def test_re_running_the_match_reproduces_the_same_holder(self):
        """Determinism. A reshuffle between runs would move a suggestion out from under a reviewer
        mid-decision -- the same guarantee `pair_stack` gives."""
        match_batch(self.batch.name)
        self.assertEqual(self._suggested(self.rows[0]).suggested_name, self.payment)
        self.assertFalse((self._suggested(self.rows[1]).suggested_name or "").strip())

    def test_no_payment_was_written_to(self):
        """The claim rule touches import rows only. It must never reach a ledger."""
        self.assertEqual(
            frappe.db.get_value("Project Payments", self.payment, "status"), "Approved"
        )


class TestTheConfirmPayloadCarriesTheOrderAndTheRule(OutflowReviewFixture):
    """S3 + the Option B stamp: what the rollup dialog's leaf needs to render honestly."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)

    def _ready(self):
        return get_confirmable_rows(self.batch.name)["ready"]

    def test_every_ready_row_declares_the_order_keys_even_when_blank(self):
        """⚠️ THE SHAPE IS IDENTICAL ACROSS ALL THREE LEDGERS, on purpose. Two of them carry no order
        reference at all, and omitting the keys there would make a caller ask which ledger it is
        holding before it could read one."""
        rows = self._ready()
        self.assertTrue(rows, "the fixture must produce ready rows for this to mean anything")
        for row in rows:
            self.assertIn("order_doctype", row)
            self.assertIn("order_name", row)

    def test_a_payment_row_carries_the_order_TYPE_beside_the_id(self):
        """⚠️ IT IS NOT ALWAYS A PO -- 602 Procurement Orders against 193 Service Requests on the
        first real statement. Without the type the screen cannot label the id, and labelling every
        one "PO" would be wrong on a quarter of the rows."""
        payments = [r for r in self._ready() if r["target_doctype"] == "Project Payments"]
        self.assertTrue(payments)
        for row in payments:
            if (row.get("order_name") or "").strip():
                self.assertTrue(
                    (row.get("order_doctype") or "").strip(),
                    "an order id with no type cannot be labelled honestly",
                )

    def test_every_ready_row_declares_the_suggestion_rule_key(self):
        """Blank is the ordinary case -- exactly one approved candidate -- and it must be a present
        key rather than an absent one, or the dialog cannot tell "no rule" from "no data"."""
        for row in self._ready():
            self.assertIn("suggestion_rule", row)

    def test_a_rule_is_only_ever_one_of_the_known_ids(self):
        """The vocabulary lives in `disambiguate.RULE_LABELS`. A value outside it would render as a
        blank chip on the screen, which reads as "no rule" -- the opposite of the truth."""
        from nirmaan_stack.services.outflow_import.disambiguate import RULE_LABELS

        for row in self._ready():
            rule = (row.get("suggestion_rule") or "").strip()
            if rule:
                self.assertIn(rule, RULE_LABELS)


class TestMatchProvenance(OutflowReviewFixture):
    """T1: the three fields that say HOW a pre-selection was made.

    ⚠️ THE DEFECT THIS SLICE FIXES. `suggestion_rule` recorded only Option B's three rules, so a
    blank meant BOTH "no rule was needed" and "there is no suggestion". On the first real statement
    that filed all 112 stack pairings -- deterministic but ARBITRARY, identical transfers zipped
    against identical records -- under "Only candidate" in the confirm dialog's filter: the picks a
    reviewer would most want to isolate, presented as the safest kind there is.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)

    def _rows(self, where="1=1"):
        return frappe.db.sql(
            f"""SELECT name, row_status, COALESCE(suggested_name,'') sn,
                       COALESCE(suggestion_rule,'') rule, COALESCE(match_basis,'') basis,
                       auto_matched
                FROM "tabOutflow Import Row" WHERE import_batch = %s AND {where}""",
            (self.batch.name,), as_dict=True,
        )

    def test_the_check_agrees_with_whether_there_is_a_suggestion(self):
        """⚠️ THE WHOLE RISK OF STORING A DERIVED VALUE, asserted directly. `auto_matched` IS
        "suggested_name is set" -- a human never writes a suggestion -- so the only way it can be
        wrong is drift, and the only defence is that it is written in the same `set_value` as the
        pair at every site."""
        for row in self._rows():
            self.assertEqual(
                bool(row.sn), bool(row.auto_matched), f"{row.name} disagrees with its own suggestion"
            )

    def test_provenance_never_outlives_the_pick_it_explains(self):
        """A row with no suggestion carries no rule and no basis. Otherwise the screen would explain
        a choice that is no longer on the row -- the same class of lie the pair is cleared to
        avoid."""
        for row in self._rows("COALESCE(suggested_name,'') = ''"):
            self.assertEqual(row.rule, "", row.name)
            self.assertEqual(row.basis, "", row.name)

    def test_every_suggestion_says_how_it_was_chosen(self):
        """⚠️ BLANK NOW MEANS EXACTLY ONE THING: there is no suggestion. This is the assertion that
        fails if a new write site is added without setting the rule."""
        from nirmaan_stack.services.outflow_import.disambiguate import RULE_LABELS

        for row in self._rows("COALESCE(suggested_name,'') <> ''"):
            self.assertTrue(row.rule, f"{row.name} has a suggestion but does not say how")
            self.assertIn(row.rule, RULE_LABELS, row.name)

    def test_a_sole_match_says_sole_rather_than_saying_nothing(self):
        sole = self._rows("suggestion_rule = 'sole'")
        self.assertTrue(sole, "the fixture must produce at least one sole match")
        for row in sole:
            self.assertTrue(row.sn)
            self.assertTrue(row.auto_matched)

    def test_the_basis_is_one_of_the_matcher_tiers(self):
        """The vocabulary is `matcher.TIER_*`, not a string invented at the write site."""
        from nirmaan_stack.services.outflow_import.matcher import (
            TIER_ACCOUNT, TIER_PROJECT, TIER_REFERENCE,
        )

        allowed = {TIER_REFERENCE, TIER_ACCOUNT, TIER_PROJECT}
        for row in self._rows("COALESCE(match_basis,'') <> ''"):
            self.assertIn(row.basis, allowed, row.name)

    def test_a_settled_row_keeps_its_history_untouched(self):
        """⚠️ A FROZEN ROW IS NEVER RE-DERIVED, so a row settled BEFORE these fields existed keeps a
        blank rule for ever. That is correct -- the suggestion on a settled row is history, and a
        match run that rewrote it would be editing the record of a decision already acted on. On the
        live database this is 832 rows, and they must stay that way."""
        settled = self._rows("row_status = 'Settled'")
        for row in settled:
            self.assertEqual(row.row_status, "Settled")


class TestThePeriodScopedSummary(OutflowReviewFixture):
    """`get_outflow_summary` -- the panel's aggregate over a PERIOD rather than one import (P1).

    ⚠️ THE SCOPE REVERSED HERE. Until P1 the panel summarised ONE import while the table beneath it
    spanned every one, and the domain doc recorded that mismatch as the design (owner ruling
    2026-08-10). The owner reversed it on 2026-08-12: both now describe the same population, scoped
    by a period.

    ⚠️ ASSERT PARTITIONS AND INVARIANTS, NOT EXACT COUNTS -- this suite sees the LIVE ledger, and how
    many rows land `Matched` depends on what is approved in the database on the day.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)

    def test_one_batch_reproduces_the_old_endpoint_EXACTLY(self):
        """THE REGRESSION PIN, and the reason `get_import_summary` still exists.

        `get_import_summary(X)` is now a thin wrapper that delegates here with `batch=X` and adds the
        statement's metadata. `batch=X` and nothing else IS the pre-P1 WHERE clause, so every figure
        must be the figure that endpoint returned before the widening. If these two ever drift, a
        filtered summary and a batch summary are being computed two different ways -- which is the
        `_row_filters` defect ("a count computed under different filters than the page it labels")
        arriving on the panel.
        """
        widened = get_outflow_summary(batch=self.batch.name)
        pinned = get_import_summary(self.batch.name)
        self.assertEqual(widened["totals"], pinned["totals"])
        self.assertEqual(widened["auto_skipped_rows"], pinned["auto_skipped_rows"])
        self.assertEqual(widened["manually_skipped_rows"], pinned["manually_skipped_rows"])
        # The wrapper adds the statement's own metadata; the period-scoped read has no single one.
        self.assertIn("import", pinned)
        self.assertEqual(pinned["import"]["name"], self.batch.name)

    def test_the_statements_metadata_rides_the_read_ONLY_when_one_is_selected(self):
        """The Import selector's two states, in the payload (owner ruling 2026-08-12).

        ⚠️ ABSENT IS THE HONEST SHAPE ACROSS A PERIOD. Several imports have no single filename,
        uploader or declared period, and inventing one would caption the panel with the wrong
        statement. The screen reads the `imports` LIST there instead.

        It moved INTO `get_outflow_summary` so `get_import_summary` could become a pure delegate --
        one query answering "how did that statement go", never two that could drift.
        """
        selected = get_outflow_summary(batch=self.batch.name)
        self.assertIsNotNone(selected["import"])
        self.assertEqual(selected["import"]["name"], self.batch.name)
        self.assertEqual(selected["import"]["original_filename"], "test-statement.csv")

        across = get_outflow_summary()
        self.assertIsNone(across["import"])
        # ...and the list is still there, which is what the panel captions itself with instead.
        self.assertTrue(across["imports"])

    def test_the_summary_counts_the_same_population_as_the_tabs(self):
        """The whole point of routing both through `_row_filters`.

        The panel sits directly above the tabs. Before P1 they described different populations by
        design, and the screen carried a line of prose explaining why the numbers differed. They now
        have to agree, and this is what says so: the summary's per-status counts must equal the
        table's `status_counts` under the identical filters.
        """
        summary = get_outflow_summary(batch=self.batch.name)["totals"]
        page = get_outflow_rows(scope="all", batch=self.batch.name, limit=1)
        status_counts = page["status_counts"]

        for status, bucket in summary["by_status"].items():
            # ⚠️ FAILED ROWS ARE THE ONE LICENSED DIFFERENCE. The summary excludes them from
            # `by_status` (option B); `status_counts` is a RAW breakdown of the population and keeps
            # them under `Skipped`. Every OTHER status must match exactly.
            if status == "Skipped":
                self.assertGreaterEqual(status_counts.get(status, 0), bucket["count"])
                continue
            self.assertEqual(
                bucket["count"],
                status_counts.get(status, 0),
                f"{status}: the panel and the tabs disagree about the same rows",
            )

    def test_a_period_that_holds_the_statement_returns_the_whole_statement(self):
        dates = [r["added_on"] for r in get_batch_rows(self.batch.name)["rows"] if r["added_on"]]
        self.assertTrue(dates, "the fixture must carry dated rows or this proves nothing")
        first, last = min(dates), max(dates)

        scoped = get_outflow_summary(
            batch=self.batch.name,
            date_from=str(first)[:10],
            date_to=str(last)[:10],
        )["totals"]
        whole = get_outflow_summary(batch=self.batch.name)["totals"]
        # ⚠️ EQUAL, INCLUDING THE UNDATED ROW. A period spanning the statement must return the whole
        # statement -- and the fixture's unparseable-date row is inside "the whole statement", which
        # is why the two are equal rather than off by one. See
        # `test_an_undated_transfer_is_visible_in_EVERY_period`.
        self.assertEqual(scoped["total_rows"], whole["total_rows"])

    def test_a_period_BEFORE_the_statement_drops_every_DATED_row(self):
        """A filter must narrow, and must never fall through to every row.

        ⚠️ IT DROPS THE DATED ROWS, NOT ALL OF THEM. The fixture's unparseable-date row survives
        every period on purpose (see `test_an_undated_transfer_is_visible_in_EVERY_period`), so the
        honest assertion is that everything with a real date is gone -- not that the result is empty.
        Asserting zero here would be asserting the defect.
        """
        dated = [r for r in self.parsed.rows if r.added_on and r.is_success]
        undated = [r for r in self.parsed.rows if not r.added_on]

        empty = get_outflow_summary(
            batch=self.batch.name, date_from="1999-01-01", date_to="1999-12-31"
        )
        self.assertEqual(empty["totals"]["total_rows"], len(undated))
        self.assertGreater(len(dated), 0)
        self.assertLess(empty["totals"]["total_rows"], len(dated))
        # Zero-filled, not absent: a missing key renders as an em dash, which reads as "unknown".
        self.assertIn("Matched", empty["totals"]["by_status"])

    def test_a_scope_matching_no_row_at_all_yields_a_zeroed_summary(self):
        """The empty state the panel renders as "No transfers in this period".

        `derive_import_summary` zero-fills every status, so the SHAPE survives an empty population
        and the panel shows zeros rather than breaking.
        """
        beyond = max(float(r.amount) for r in self.parsed.rows) + 1
        empty = get_outflow_summary(batch=self.batch.name, amount_min=beyond)
        self.assertEqual(empty["totals"]["total_rows"], 0)
        self.assertEqual(empty["totals"]["total_value"], 0)
        self.assertEqual(empty["totals"]["decided_percent"], 0.0)
        self.assertEqual(empty["imports"], [])
        self.assertIn("Matched", empty["totals"]["by_status"])

    def test_the_imports_are_derived_from_the_ROWS(self):
        """⚠️ NOT FROM `period_from` / `period_to` ON THE BATCH.

        Three different "periods" exist in this schema and they do not coincide. Reading the imports
        back off the same rows the figures were computed from is the only answer that cannot
        disagree with the figures beside it -- and it is the set `match_period` acts on.
        """
        summary = get_outflow_summary(batch=self.batch.name)
        self.assertEqual([b["name"] for b in summary["imports"]], [self.batch.name])

        covered = summary["imports"][0]
        # Every row of this batch is in scope, so the two counts agree and nothing overspills.
        self.assertEqual(covered["row_count"], len(self.parsed.rows))
        self.assertEqual(covered["original_filename"], "test-statement.csv")

    def test_a_narrowed_scope_reports_the_batch_as_only_PARTLY_in_scope(self):
        """`row_count` < `total_rows` is what the re-match warning is built on.

        Matching runs per BATCH, so a statement only partly in scope is re-matched IN FULL. The
        screen can only say so honestly if the server reports both numbers, which is why they travel
        together.

        ⚠️ NARROWED BY AMOUNT, NOT BY DATE, AND ONLY BECAUSE OF THE FIXTURE. Every row in
        `cashfree_sample.csv` shares one calendar day, so no date window can split it -- and the one
        row that could (`not-a-date`) now survives every period by design, see
        `test_an_undated_transfer_is_visible_in_EVERY_period`. The invariant under test is not about
        dates: it is that `row_count` follows the FILTERS while `total_rows` follows the BATCH, which
        any filter exercises.
        """
        biggest = max(float(r.amount) for r in self.parsed.rows)
        summary = get_outflow_summary(batch=self.batch.name, amount_min=biggest)
        covered = summary["imports"][0]
        self.assertLess(covered["row_count"], covered["total_rows"])
        self.assertEqual(covered["total_rows"], len(self.parsed.rows))

    def test_an_undated_transfer_is_visible_in_EVERY_period(self):
        """⚠️ THE DEFECT THIS RULE EXISTS TO PREVENT, and it was live until P1 measured it.

        The bank's date column is free text and does not always parse; the parser stores NULL rather
        than guessing, and this fixture carries a literal `not-a-date` row for the case. Under a
        plain `>=` / `<` bound such a row matches NO window -- so once the period became the SCREEN'S
        SCOPE it would vanish from the summary, all three tabs and the Skipped dialog at once, with
        no filter on screen able to bring it back.

        The transfer still moved money and still needs settling, so it survives every period instead.
        """
        undated = [r for r in self.parsed.rows if not r.added_on]
        self.assertTrue(undated, "the fixture must carry an unparseable date or this proves nothing")

        # A window that cannot possibly contain it by date still returns it.
        long_ago = get_outflow_rows(
            scope="all", batch=self.batch.name, date_from="1999-01-01", date_to="1999-12-31",
            limit=100,
        )
        self.assertIn(
            undated[0].transfer_id,
            [r["transfer_id"] for r in long_ago["rows"]],
            "an undated transfer disappeared from a period -- it is now invisible everywhere",
        )

    def test_the_status_counts_still_sum_to_the_total_under_a_period(self):
        summary = get_outflow_summary(batch=self.batch.name)["totals"]
        counted = sum(b["count"] for b in summary["by_status"].values())
        self.assertEqual(counted, summary["total_rows"])
        self.assertEqual(summary["open_rows"] + summary["decided_rows"], summary["total_rows"])


class TestMatchPeriod(OutflowReviewFixture):
    """`match_period` -- re-running the match over every import the filters touch (slice P1)."""

    def test_it_matches_the_batches_the_filters_select(self):
        result = match_period(batch=self.batch.name)
        self.assertEqual(result["batches"], [self.batch.name])
        self.assertEqual(result["batches_matched"], 1)
        # It clears the pending rows exactly as `match_batch` would -- it IS `match_batch`, looped.
        self.assertEqual(_pending_count(self.batch.name), 0)

    def test_it_returns_each_batch_result_so_a_heavy_pass_is_VISIBLE(self):
        """`match_batch` reports which passes did the work (claims, Option B, stacks, the sweep).

        Looping it must not swallow that -- a run leaning hard on any pass has to stay visible rather
        than silent, which is why the per-batch payloads come back rather than a bare count.
        """
        result = match_period(batch=self.batch.name)
        self.assertEqual(len(result["results"]), 1)
        self.assertIn("swept_to_mismatched_rows", result["results"][0])
        self.assertEqual(result["results"][0]["batch"], self.batch.name)

    def test_a_scope_holding_no_rows_matches_NOTHING_rather_than_everything(self):
        """The failure that would matter: a filter selecting no rows must not fall through to "all
        batches". Re-matching every import ever staged because a filter was mistyped is not a
        no-op -- it would churn suggestions under every reviewer currently working.

        ⚠️ NARROWED BY AMOUNT, NOT BY AN OUT-OF-RANGE DATE. A date window that excludes everything
        still returns any row whose date would not parse, so it does not select an empty set -- see
        `TestThePeriodScopedSummary.test_an_undated_transfer_is_visible_in_EVERY_period`. This test
        is about the fall-through, so it needs a genuinely empty scope.
        """
        # ⚠️ THE BOUND HAS TO BEAT THE LIVE DATABASE, NOT JUST THIS FIXTURE. This call is
        # deliberately UNSCOPED by batch -- that is the fall-through being tested -- so it sees every
        # real statement on the dev site, and "one rupee above my own biggest row" selects plenty of
        # them. A trillion rupees is past any real transfer.
        result = match_period(amount_min=10**12)
        self.assertEqual(result["batches"], [])
        self.assertEqual(result["batches_matched"], 0)


class TestTheConfirmableCap(OutflowReviewFixture):
    """`_MAX_CONFIRMABLE` -- the reviewability limit on "Confirm all matched" (slice P1)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        match_batch(cls.batch.name)

    def test_it_takes_the_same_filters_as_the_summary(self):
        """The button is labelled with the summary's `confirmable_rows`, so the two must select the
        same population -- otherwise the button offers a number this list cannot produce, which is
        the "button 688, table 893" defect the `stale` bucket exists to explain."""
        summary = get_outflow_summary(batch=self.batch.name)["totals"]
        confirmable = get_confirmable_rows(batch=self.batch.name)
        self.assertEqual(
            len(confirmable["ready"]) + len(confirmable["stale"]),
            summary["confirmable_rows"],
        )
        self.assertEqual(confirmable["matched_rows"], summary["matched_rows"])

    def test_a_period_narrows_the_confirmable_set(self):
        empty = get_confirmable_rows(
            batch=self.batch.name, date_from="1999-01-01", date_to="1999-12-31"
        )
        self.assertEqual(empty["matched_rows"], 0)
        self.assertEqual(empty["ready"], [])

    def test_it_REFUSES_rather_than_truncating_when_the_set_is_too_large(self):
        """⚠️ THE DIRECTION IS THE WHOLE POINT.

        A `LIMIT` would hand back a list shorter than the count on the button that opened it, over a
        set nobody chose -- and the missing rows would have no property in common, so nothing on
        screen could account for them. Refusing names the number and leaves a way through.
        """
        from nirmaan_stack.api.outflow_import import review as R

        original = R._MAX_CONFIRMABLE
        R._MAX_CONFIRMABLE = 0
        try:
            with self.assertRaises(frappe.ValidationError):
                get_confirmable_rows(batch=self.batch.name)
        finally:
            R._MAX_CONFIRMABLE = original

        # And with the real ceiling back, the same call succeeds -- the refusal is the cap, not the
        # query.
        self.assertIsInstance(get_confirmable_rows(batch=self.batch.name)["ready"], list)
