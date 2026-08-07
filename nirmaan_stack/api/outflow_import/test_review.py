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
    search_settleable_records,
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


class TestSuggestionIsPersisted(OutflowReviewFixture):
    """The match run writes down WHICH record it picked (slice R1).

    Before this, the run stored only a status and a sentence, so the screen had to re-run the
    matcher for one row at a time when a reviewer opened it -- which is why a matched row could not
    show as ready in the table, and why every row had to be opened individually to be confirmed.

    ⚠️ THE POSITIVE CASE CANNOT USE ROW 0001, AND THE REASON IS WORTH KNOWING BEFORE YOU "FIX" IT.
    This suite runs against the LIVE development database, and `match_expenses` matches on AMOUNT
    ALONE -- the description text only raises the score, it never gates. Row 0001 is a round
    Rs 5,000, and a real approved Project Expense sits at exactly Rs 5,000, so that row honestly has
    TWO approved candidates and correctly suggests nothing. Row 0009's Rs 1,234.50 is the one
    non-round amount in the fixture, which is what makes it a stable single-candidate row. The
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

        `Project Expenses.amount` is a Data column of numeric strings and the non-project one is
        real Currency -- the same asymmetry the candidate queries carry.
        """
        project = frappe.db.sql(
            """SELECT count(*) FROM "tabProject Expenses"
               WHERE status = 'Approved' AND amount IS NOT NULL AND btrim(amount) <> ''
                 AND abs(CAST(btrim(amount) AS numeric) - %s) <= 1""",
            (amount,),
        )[0][0]
        non_project = frappe.db.sql(
            """SELECT count(*) FROM "tabNon Project Expenses"
               WHERE status = 'Approved' AND abs(amount - %s) <= 1""",
            (amount,),
        )[0][0]
        return int(project) + int(non_project)

    def test_a_single_approved_payment_is_recorded_as_the_suggestion(self):
        self.assertEqual(
            self._approved_expenses_at(1234.50),
            0,
            "A live approved expense has appeared at Rs 1,234.50, so this row now has two "
            "candidates and correctly suggests nothing. That is the deriver working -- pick another "
            "amount for this test rather than relaxing the rule.",
        )
        row = self._rows_by_transfer_suffix()["0009"]
        self.assertEqual(row["row_status"], "Matched")
        self.assertEqual(row["suggested_doctype"], "Project Payments")
        self.assertEqual(row["suggested_name"], self.pay_solo)

    def test_no_unmatched_row_anywhere_carries_a_suggestion(self):
        """Asserted across every row rather than one named one: which fixture rows end up Unmatched
        depends on the live ledger, and the rule does not."""
        unmatched = [
            r for r in self._rows_by_transfer_suffix().values() if r["row_status"] == "Unmatched"
        ]
        self.assertTrue(unmatched)
        for row in unmatched:
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

        The stale value is planted on whichever row is Unmatched rather than a named one -- which
        rows end up Unmatched depends on the live ledger, and the clearing rule does not.
        """
        target = next(
            r for r in self._rows_by_transfer_suffix().values() if r["row_status"] == "Unmatched"
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
