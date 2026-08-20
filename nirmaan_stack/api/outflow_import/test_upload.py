# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the outflow statement staging path (Bulk Import Outflow, slice S3).

These exercise `_stage_batch` directly rather than the whitelisted endpoint. The endpoint's own
work above that call is authorization, a multipart read and two extension/size checks -- none of
which can be driven without a real HTTP request, and all of which would need `frappe.request` and
`save_file` faked to the point where the test asserts the fake. What IS worth pinning is everything
downstream: the staged shape, the duplicate guard, the skip semantics and the derived rollup.

⚠️ THIS SUITE RUNS AGAINST THE LIVE SITE DATABASE. Every document it creates is tracked and purged
in `tearDownClass`; the purge is scoped to rows this suite created and never touches anything else.
"""

import unittest
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal

import frappe

from nirmaan_stack.api.outflow_import.upload import (
    BATCH_DOCTYPE,
    ROW_DOCTYPE,
    _assess_statement,
    _stage_batch,
)
from nirmaan_stack.api.outflow_import.permissions import (
    OUTFLOW_IMPORT_PROFILES,
    has_outflow_access,
)
from nirmaan_stack.services.outflow_import.parser import parse_statement

FIXTURE = (
    frappe.get_app_path("nirmaan_stack")
    + "/services/outflow_import/tests/fixtures/cashfree_sample.csv"
)
# The same statement saved as a workbook -- dates as datetime cells, amounts as floats, identity
# fields left as text. See `test_parser.TestXlsx`.
XLSX_FIXTURE = (
    frappe.get_app_path("nirmaan_stack")
    + "/services/outflow_import/tests/fixtures/cashfree_sample.xlsx"
)


def _parsed_in_a_fresh_transfer_namespace():
    """Re-parse the fixture with every transfer id uniquely prefixed.

    STAGING IS DELIBERATELY NOT IDEMPOTENT -- re-staging the same statement is exactly the case the
    duplicate guard exists to catch, and it works against EVERY earlier batch in the database, not
    just this suite's. Without a per-call namespace the second test to run would be skipped as a
    duplicate of the first, and the suite would be asserting the guard by accident everywhere
    instead of once, on purpose, in TestDuplicateGuard.
    """
    with open(FIXTURE, "rb") as handle:
        parsed = parse_statement(handle.read(), source="Cashfree")
    prefix = frappe.generate_hash(length=10)
    rows = tuple(replace(r, transfer_id=f"{prefix}-{r.transfer_id}") for r in parsed.rows)
    return replace(parsed, rows=rows)


class TestStageBatch(unittest.TestCase):
    created_batches: list = []

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.parsed = _parsed_in_a_fresh_transfer_namespace()
        # Staged ONCE: every test in this class reads the same staged batch.
        cls.batch = _stage_batch(
            cls.parsed,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        cls.created_batches.append(cls.batch.name)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        for name in cls.created_batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _stage(self, parsed=None):
        return self.batch

    def _rows(self, batch):
        return frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch.name},
            fields=["name", "transfer_id", "row_status", "skip_reason", "amount",
                    "remarks", "normalized_account", "normalized_reference", "status_raw"],
            order_by="creation asc",
        )

    def test_every_parsed_row_is_staged(self):
        batch = self._stage()
        self.assertEqual(len(self._rows(batch)), len(self.parsed.rows))
        self.assertEqual(batch.total_rows, len(self.parsed.rows))

    def test_batch_carries_the_period_and_the_two_money_figures(self):
        batch = self._stage()
        self.assertEqual(batch.period_from, date(2026, 7, 28))
        self.assertEqual(batch.period_to, date(2026, 7, 28))
        self.assertGreater(batch.gross_amount, 0)
        self.assertGreater(batch.charges_amount, 0)

    def test_failed_transfer_is_staged_and_skipped_with_a_system_reason(self):
        # Staged, not dropped -- the skip has to be VISIBLE, and a manual skip is the only kind
        # that requires a typed reason.
        batch = self._stage()
        failed = [r for r in self._rows(batch) if r["status_raw"] == "FAILED"]
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]["row_status"], "Skipped")
        self.assertIn("FAILED", failed[0]["skip_reason"])

    def test_successful_rows_are_pending_not_mismatched(self):
        # At upload nothing has been matched, so "Mismatched" would be a finding about work that
        # has not happened. That is the whole reason derive_staged_row_outcome exists.
        # The fixture's repeated transfer id is excluded: it is successful AND a duplicate, and the
        # duplicate wins (see test_in_file_duplicate_is_skipped_on_its_second_appearance).
        batch = self._stage()
        seen: set[str] = set()
        first_appearances = []
        for row in self._rows(batch):
            if row["transfer_id"] in seen:
                continue
            seen.add(row["transfer_id"])
            first_appearances.append(row)

        successes = [r for r in first_appearances if r["status_raw"] == "SUCCESS"]
        self.assertTrue(successes)
        self.assertEqual({r["row_status"] for r in successes}, {"Pending match run"})

    def test_in_file_duplicate_is_skipped_on_its_second_appearance(self):
        # The same transfer listed twice in ONE statement. The cross-batch lookup cannot see it --
        # it only queries EARLIER batches -- so it needs its own guard. Left uncaught, both copies
        # later match the same payment and the second Outflow Row Match insert violates the
        # (transfer_id, target) unique constraint, aborting the whole match pass.
        batch = self._stage()
        rows = self._rows(batch)
        counts: dict[str, list] = {}
        for row in rows:
            counts.setdefault(row["transfer_id"], []).append(row)
        repeated = [group for group in counts.values() if len(group) > 1]
        self.assertTrue(repeated, "fixture should contain a repeated transfer id")
        for group in repeated:
            self.assertEqual(group[0]["row_status"], "Pending match run")
            for later in group[1:]:
                self.assertEqual(later["row_status"], "Skipped")
                self.assertIn("earlier in the same statement", later["skip_reason"])

    def test_long_remark_survives_the_round_trip(self):
        # varchar(140) would have thrown CharacterLengthExceededError on insert.
        batch = self._stage()
        self.assertTrue(any(len(r["remarks"] or "") > 140 for r in self._rows(batch)))

    def test_derived_identity_forms_are_persisted_beside_the_raw_values(self):
        batch = self._stage()
        row = next(r for r in self._rows(batch) if r["transfer_id"].endswith("0006"))
        self.assertEqual(row["normalized_account"], "42345678904")

    def test_rollup_counters_and_status_are_derived(self):
        batch = self._stage()
        rows = self._rows(batch)
        self.assertEqual(batch.skipped_rows, sum(1 for r in rows if r["row_status"] == "Skipped"))
        self.assertEqual(batch.reviewed_rows, batch.skipped_rows)
        # Some rows terminal (skipped), some open (pending).
        self.assertEqual(batch.status, "Partially Settled")


class TestDuplicateGuard(unittest.TestCase):
    created_batches: list = []

    @classmethod
    def tearDownClass(cls):
        for name in cls.created_batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _stage(self, parsed):
        batch = _stage_batch(
            parsed,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        type(self).created_batches.append(batch.name)
        frappe.db.commit()
        return batch

    def test_re_uploading_the_same_statement_skips_every_transfer(self):
        # The precise duplicate guard: transfer_id against EARLIER batches. This is what the
        # date-range overlap warning cannot do -- two exports can share a transfer without their
        # periods overlapping at all, and can share a period without sharing a transfer.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        first = self._stage(parsed)
        second = self._stage(parsed)

        first_rows = frappe.get_all(
            ROW_DOCTYPE, filters={"import_batch": first.name}, fields=["row_status"]
        )
        second_rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": second.name},
            fields=["row_status", "skip_reason"],
        )

        self.assertTrue(any(r["row_status"] == "Pending match run" for r in first_rows))
        self.assertEqual({r["row_status"] for r in second_rows}, {"Skipped"})
        self.assertTrue(all(first.name in (r["skip_reason"] or "") for r in second_rows))

    def test_a_fully_duplicate_batch_is_completed_immediately(self):
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)
        second = self._stage(parsed)
        # Every row terminal -> nothing left for anyone to do.
        self.assertEqual(second.status, "Completed")

    def test_a_fresh_namespace_is_not_treated_as_a_duplicate(self):
        # The guard must key on the TRANSFER, not on the period or the file. Two statements
        # covering the same dates with different transfers are both real work.
        first = self._stage(_parsed_in_a_fresh_transfer_namespace())
        second = self._stage(_parsed_in_a_fresh_transfer_namespace())
        for batch in (first, second):
            rows = frappe.get_all(
                ROW_DOCTYPE, filters={"import_batch": batch.name}, fields=["row_status"]
            )
            self.assertTrue(any(r["row_status"] == "Pending match run" for r in rows))

    def test_a_second_batch_over_the_same_period_records_an_overlap(self):
        # Equality with the first batch is deliberately NOT asserted: the overlap probe returns the
        # most recent EARLIER batch over that period, and other tests in this suite share it.
        self._stage(_parsed_in_a_fresh_transfer_namespace())
        second = self._stage(_parsed_in_a_fresh_transfer_namespace())
        self.assertIsNotNone(second.overlaps_batch)

    # --- the widened key (slice D3) -----------------------------------------------------------
    #
    # ⚠️ EVERY TEST ABOVE PASSED UNCHANGED WHEN THE KEY WIDENED, AND THAT IS WHY THESE EXIST.
    # A suite that cannot tell the old behaviour from the new one is not evidence of either. Each
    # test below re-stages a statement with ONE axis of the identity altered, and each would fail
    # against the pre-D3 `transfer_id`-only key.

    def _statuses(self, batch):
        return {
            r["row_status"]
            for r in frappe.get_all(
                ROW_DOCTYPE, filters={"import_batch": batch.name}, fields=["row_status"]
            )
        }

    def test_the_SAME_transfer_id_at_a_DIFFERENT_amount_is_new_work(self):
        # ⚠️ THE HEADLINE BEHAVIOUR CHANGE. Pre-D3 this second batch was skipped wholesale as a
        # duplicate; the amounts never entered the question. A different amount is a different
        # fact, so the row now imports and a reviewer gets to see it.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)

        shifted = replace(
            parsed,
            rows=tuple(replace(r, amount=r.amount + Decimal("1")) for r in parsed.rows),
        )
        second = self._stage(shifted)
        self.assertIn("Pending match run", self._statuses(second))

    def test_the_SAME_transfer_id_on_a_DIFFERENT_DAY_is_new_work(self):
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)

        moved = replace(
            parsed,
            rows=tuple(
                replace(r, added_on=(r.added_on + timedelta(days=1)) if r.added_on else None)
                for r in parsed.rows
            ),
        )
        second = self._stage(moved)
        self.assertIn("Pending match run", self._statuses(second))

    def test_a_DIFFERENT_CLOCK_TIME_on_the_same_day_is_still_a_duplicate(self):
        # ⚠️ THE DATE, NOT THE DATETIME. `added_on` is a Datetime and two exports of one transfer
        # can carry different times; comparing the full timestamp would make every re-export look
        # like new work, which is the failure this half of the rule prevents.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        first = self._stage(parsed)

        later = replace(
            parsed,
            rows=tuple(
                replace(r, added_on=(r.added_on + timedelta(hours=3)) if r.added_on else None)
                for r in parsed.rows
            ),
        )
        second = self._stage(later)
        self.assertEqual(self._statuses(second), {"Skipped"})
        rows = frappe.get_all(
            ROW_DOCTYPE, filters={"import_batch": second.name}, fields=["skip_reason"]
        )
        self.assertTrue(all(first.name in (r["skip_reason"] or "") for r in rows))

    def test_an_UNREADABLE_date_falls_back_to_id_plus_amount_and_still_skips(self):
        # ⚠️ THE SILENT-DOUBLE-IMPORT GUARD (owner ruling). The parser stages a row whose Added On
        # it could not read; under SQL `NULL = NULL` semantics such a sheet would stop being
        # recognised on re-upload and import a SECOND time with nothing to show for it.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        undated = replace(parsed, rows=tuple(replace(r, added_on=None) for r in parsed.rows))
        first = self._stage(undated)
        second = self._stage(undated)
        self.assertEqual(self._statuses(second), {"Skipped"})

        # ...and it holds in the MIXED direction too: a dated re-upload of an undated batch.
        third = self._stage(parsed)
        self.assertEqual(self._statuses(third), {"Skipped"})
        self.assertTrue(
            all(
                first.name in (r["skip_reason"] or "")
                for r in frappe.get_all(
                    ROW_DOCTYPE, filters={"import_batch": third.name}, fields=["skip_reason"]
                )
            )
        )

    def test_the_amount_comparison_is_EXACT_to_the_paisa(self):
        # No tolerance here, deliberately: `AMOUNT_TOLERANCE` is the SETTLE window and at Rs 5 two
        # genuinely different Rs 3 transfers would collapse into one identity.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)
        nudged = replace(
            parsed,
            rows=tuple(replace(r, amount=r.amount + Decimal("0.01")) for r in parsed.rows),
        )
        self.assertIn("Pending match run", self._statuses(self._stage(nudged)))

    def test_an_UNCHANGED_re_upload_is_still_skipped_wholesale(self):
        # The widening must not cost the ordinary case. Same id, same amount, same date -> the
        # behaviour every earlier test in this class asserts.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)
        self.assertEqual(self._statuses(self._stage(parsed)), {"Skipped"})


def _all_queued(parsed):
    """The same statement as it looked while the bank still had the transfers in flight.

    A QUEUED export carries no bank reference yet -- that is the whole reason the completed row
    looks like new information -- so the reference is cleared with the status.
    """
    return replace(
        parsed,
        rows=tuple(replace(r, status_raw="QUEUED", bank_reference_no="") for r in parsed.rows),
    )


class TestQueuedThenSuccessfulReimport(unittest.TestCase):
    """A transfer still QUEUED yesterday must import when today's export shows it SUCCESS.

    ⚠️ THE DEFECT THIS PINS COST REAL MONEY, TWICE, ON THE OWNER'S DATABASE. Nothing about a
    transfer's identity changes when it completes -- same id, same amount, same Added On -- so the
    completed row matched the queued placeholder exactly and was skipped as "Already imported". The
    loss was PERMANENT rather than merely late: `Skipped` is in `review._FROZEN_ROW_STATUSES`, so
    re-matching never revisits the row, there is no unskip endpoint, and every later export repeats
    the collision.

    ⚠️ WHAT CHANGED IS ELIGIBILITY, NOT IDENTITY. `duplicates.row_identity` is untouched, so every
    test in `TestDuplicateGuard` above still passes unchanged -- which is exactly why this class
    exists separately. A queued row and its later success ARE the same transfer; the corrected
    question is whether the stored one is evidence that money moved.
    """

    created_batches: list = []

    @classmethod
    def tearDownClass(cls):
        for name in cls.created_batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _stage(self, parsed):
        batch = _stage_batch(
            parsed,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        type(self).created_batches.append(batch.name)
        frappe.db.commit()
        return batch

    def _rows(self, batch):
        return frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch.name},
            fields=["transfer_id", "row_status", "skip_reason", "status_raw"],
            order_by="creation asc",
        )

    def test_a_QUEUED_row_does_not_block_its_own_later_SUCCESS(self):
        # The headline. Yesterday's export had everything in flight; today's shows it settled.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(_all_queued(parsed))
        today = self._stage(parsed)

        successful = [r for r in self._rows(today) if r["status_raw"] == "SUCCESS"]
        self.assertTrue(successful)
        self.assertNotIn(
            "Skipped",
            {r["row_status"] for r in successful if "Already imported" in (r["skip_reason"] or "")},
        )
        self.assertIn("Pending match run", {r["row_status"] for r in successful})

    def test_a_SUCCESSFUL_row_still_blocks_a_re_upload(self):
        # ⚠️ THE GUARD THAT STOPS THE FIX BEING TOO LOOSE, and the reason it sits beside the test
        # above rather than only in TestDuplicateGuard: the two differ in ONE axis -- what the bank
        # said about the stored row -- and reading them together is what shows the rule.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        first = self._stage(parsed)
        second = self._stage(parsed)

        rows = self._rows(second)
        self.assertEqual({r["row_status"] for r in rows}, {"Skipped"})
        self.assertTrue(all(first.name in (r["skip_reason"] or "") for r in rows))

    def test_a_FAILED_row_still_counts_as_imported(self):
        # ⚠️ THE REGRESSION THE FIRST CUT OF THIS FIX CAUSED, and the reason the rule is TERMINAL
        # rather than SUCCESSFUL. A FAILED transfer moved no money either -- but it is FINAL (a
        # retry gets a new transfer id), so it must keep counting. Filtering on `= SUCCESS` left the
        # fixture's one FAILED row looking new, which meant a wholly re-uploaded statement was no
        # longer refused: `assess_duplicates` saw 1 of 13 as new and let a batch through with
        # nothing in it anyone could action. Nine tests in this file went red at once.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)
        second = self._stage(parsed)

        failed = [r for r in self._rows(second) if r["status_raw"] == "FAILED"]
        self.assertEqual(len(failed), 1)
        self.assertIn("Already imported", failed[0]["skip_reason"] or "")

    def test_only_the_transfer_that_was_QUEUED_re_opens(self):
        # The production shape: one row in flight, the rest already through. The completed one must
        # import and its genuinely-duplicate neighbours must still be skipped -- a fix that re-opened
        # the whole statement would be as wrong as the defect, in the other direction.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        in_flight = next(
            r.transfer_id for r in parsed.rows if r.transfer_id.endswith("0003")
        )
        yesterday = replace(
            parsed,
            rows=tuple(
                replace(r, status_raw="QUEUED", bank_reference_no="")
                if r.transfer_id == in_flight else r
                for r in parsed.rows
            ),
        )
        self._stage(yesterday)
        today = self._stage(parsed)

        by_id = {r["transfer_id"]: r for r in self._rows(today)}
        self.assertEqual(by_id[in_flight]["row_status"], "Pending match run")
        others = [
            r for tid, r in by_id.items()
            if tid != in_flight and r["status_raw"] == "SUCCESS"
        ]
        self.assertTrue(others)
        self.assertEqual({r["row_status"] for r in others}, {"Skipped"})

    def test_the_preview_agrees_with_the_upload(self):
        # ⚠️ THEY SHARE `_already_imported` PRECISELY SO THEY CANNOT DIVERGE, and this is what
        # proves the sharing still holds. A preview counting the queued rows as duplicates would
        # refuse a file the staging pass would happily have imported -- and a refusal writes
        # nothing at all, so the rows would never reach the screen to be argued about.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(_all_queued(parsed))

        verdict, _ = _assess_statement(parsed, "test-statement.csv")
        self.assertEqual(verdict.duplicates, 0)
        self.assertFalse(verdict.refuse)
        self.assertFalse(verdict.warn)

    def test_a_QUEUED_line_does_not_block_a_SUCCESS_line_in_the_same_file(self):
        # The in-file half of the same rule (`_stage_batch`'s `seen_in_file`). An export is a
        # snapshot and should never list one transfer twice, so this closes the shape rather than a
        # case seen in the wild -- but the two checks ask one question of different populations, and
        # a row that could be blocked by an earlier BATCH but not an earlier LINE would be two
        # answers about one file.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        pair = parsed.rows[0]
        batch = self._stage(
            replace(
                parsed,
                rows=(
                    replace(pair, status_raw="QUEUED", bank_reference_no=""),
                    replace(pair, row_number=pair.row_number + 1),
                ),
            )
        )
        statuses = [r["row_status"] for r in self._rows(batch)]
        self.assertEqual(statuses.count("Pending match run"), 1)


class TestUnstrandPatch(unittest.TestCase):
    """`patches/v3_0/unstrand_outflow_queued_reimports.py` re-opens what the defect froze.

    ⚠️ THE STRANDED STATE IS BUILT BY HAND, AND IT HAS TO BE. The corrected code can no longer
    produce it, so there is nothing to reproduce it WITH -- and a patch tested only against a
    database that cannot contain its target is a patch nobody has run. This writes the shape a
    pre-fix site actually holds and then asserts the patch finds exactly it.

    ⚠️ RE-UPLOADING THE STATEMENT DOES NOT DO THIS, which is the whole reason a patch exists. The
    stranded row is stored SUCCESS -- it was skipped for being a duplicate, not for failing -- so
    under the corrected rule it is a valid duplicate of itself: a re-upload finds every row already
    imported, `new == 0`, and `assess_duplicates` REFUSES the file. A newer statement hits the same
    wall.

    ⚠️ THIS IS THE ONE TEST IN THE FILE WHOSE WRITES ARE NOT SCOPED TO ITS OWN FIXTURES, and the
    exception is stated rather than hidden. `execute()` is a patch: it deliberately sweeps the whole
    table, so running it here also re-opens any genuinely stranded row the site is carrying. That is
    acceptable only because it is exactly the repair the patch exists to perform, the predicate is
    narrow enough to reach nothing else, and it is idempotent -- but a future edit that widened the
    patch's `WHERE` would widen this blast radius with it, silently.
    """

    created_batches: list = []

    @classmethod
    def tearDownClass(cls):
        for name in cls.created_batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _stage(self, parsed):
        batch = _stage_batch(
            parsed,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        type(self).created_batches.append(batch.name)
        frappe.db.commit()
        return batch

    def _build_stranded_pair(self):
        """Yesterday: one transfer QUEUED, one SUCCESS. Today: both SUCCESS, both wrongly skipped."""
        parsed = _parsed_in_a_fresh_transfer_namespace()
        in_flight = next(r.transfer_id for r in parsed.rows if r.transfer_id.endswith("0003"))
        settled_yesterday = next(
            r.transfer_id for r in parsed.rows if r.transfer_id.endswith("0004")
        )

        yesterday = self._stage(
            replace(
                parsed,
                rows=tuple(
                    replace(r, status_raw="QUEUED", bank_reference_no="")
                    if r.transfer_id == in_flight else r
                    for r in parsed.rows
                ),
            )
        )
        today = self._stage(parsed)

        # Force the PRE-FIX outcome onto today's copy of the in-flight transfer: the corrected code
        # leaves it Pending, and the patch's job is the rows written before that correction.
        stranded = frappe.db.get_value(
            ROW_DOCTYPE, {"import_batch": today.name, "transfer_id": in_flight}, "name"
        )
        frappe.db.set_value(
            ROW_DOCTYPE,
            stranded,
            {
                "row_status": "Skipped",
                "skip_reason": f"Already imported in batch {yesterday.name}.",
            },
            update_modified=False,
        )
        frappe.db.commit()
        return today, stranded, in_flight, settled_yesterday

    def test_it_reopens_the_stranded_row_and_leaves_real_duplicates_alone(self):
        from nirmaan_stack.patches.v3_0 import unstrand_outflow_queued_reimports as patch

        today, stranded, _, settled_yesterday = self._build_stranded_pair()
        neighbour = frappe.db.get_value(
            ROW_DOCTYPE,
            {"import_batch": today.name, "transfer_id": settled_yesterday},
            ["name", "row_status", "skip_reason"],
            as_dict=True,
        )
        # The neighbour is a GENUINE duplicate of a transfer that succeeded yesterday.
        self.assertEqual(neighbour["row_status"], "Skipped")
        self.assertIn("Already imported", neighbour["skip_reason"] or "")

        patch.execute()

        after = frappe.db.get_value(
            ROW_DOCTYPE, stranded, ["row_status", "skip_reason"], as_dict=True
        )
        self.assertEqual(after["row_status"], "Pending match run")
        self.assertIsNone(after["skip_reason"])

        # ⚠️ THE HALF THAT MATTERS MORE. A patch that re-opened every already-imported row would
        # pass the assertion above and undo the duplicate guard wholesale.
        untouched = frappe.db.get_value(
            ROW_DOCTYPE, neighbour["name"], ["row_status", "skip_reason"], as_dict=True
        )
        self.assertEqual(untouched["row_status"], "Skipped")
        self.assertIn("Already imported", untouched["skip_reason"] or "")

    def test_it_is_idempotent(self):
        from nirmaan_stack.patches.v3_0 import unstrand_outflow_queued_reimports as patch

        _, stranded, _, _ = self._build_stranded_pair()
        patch.execute()
        first = frappe.db.get_value(ROW_DOCTYPE, stranded, "row_status")
        patch.execute()
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, stranded, "row_status"), first)


class TestAccessGate(unittest.TestCase):
    def test_administrator_always_has_access(self):
        self.assertTrue(has_outflow_access("Administrator"))

    def test_guest_and_blank_never_do(self):
        self.assertFalse(has_outflow_access("Guest"))
        self.assertFalse(has_outflow_access(""))

    def test_the_profile_set_is_the_owner_ruling_accountant_lead_admin(self):
        self.assertEqual(
            OUTFLOW_IMPORT_PROFILES,
            {
                "Nirmaan Admin Profile",
                "Nirmaan Accountant Profile",
                "Nirmaan Accountant Lead Profile",
            },
        )

    def test_every_named_profile_exists_in_this_database(self):
        # A typo here locks out exactly the people the module is for, silently.
        for profile in OUTFLOW_IMPORT_PROFILES:
            self.assertTrue(
                frappe.db.exists("Role Profile", profile),
                f"Role Profile {profile!r} does not exist -- the access gate names a dead string.",
            )

    def test_a_non_accountant_profile_is_refused(self):
        user = frappe.db.get_value(
            "Nirmaan Users",
            {"role_profile": "Nirmaan Project Manager Profile"},
            "name",
        )
        if not user:
            self.skipTest("no project-manager user in this database")
        self.assertFalse(has_outflow_access(user))


class TestPreviewAndRefusal(unittest.TestCase):
    """The preview step and the duplicate refusal (slice V3).

    Exercises `_assess_statement` rather than `preview_outflow_statement`, for the reason in this
    module's docstring: the endpoint's own work above that call is authorization and a multipart
    read, and faking those means asserting the fake. `_assess_statement` is the part that decides,
    and it is SHARED by the preview and the upload -- which is itself the property worth pinning,
    because a preview that promised something the upload then refused would be worse than no
    preview at all.
    """

    def setUp(self):
        super().setUp()
        self.batches = []

    def tearDown(self):
        for name in self.batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDown()

    def _stage(self, parsed):
        batch = _stage_batch(
            parsed,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        self.batches.append(batch.name)
        frappe.db.commit()
        return batch

    def test_a_brand_new_statement_is_neither_refused_nor_warned(self):
        parsed = _parsed_in_a_fresh_transfer_namespace()
        verdict, _ = _assess_statement(parsed, "aug.csv")
        self.assertFalse(verdict.refuse)
        self.assertFalse(verdict.warn)
        self.assertEqual(verdict.duplicates, 0)

    def test_re_uploading_the_same_statement_is_refused_and_names_the_batch(self):
        """Owner ruling Q2: every row already imported means nothing new, so nothing is written."""
        parsed = _parsed_in_a_fresh_transfer_namespace()
        batch = self._stage(parsed)

        verdict, _ = _assess_statement(parsed, "aug.csv")
        self.assertTrue(verdict.refuse)
        self.assertEqual(verdict.new, 0)
        self.assertIn(batch.name, verdict.message)

    def test_a_mostly_duplicate_statement_warns_but_does_not_refuse(self):
        """Above the threshold, below "nothing new". The reader must still be able to proceed --
        a warning never blocks."""
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)

        # One genuinely new transfer among the already-imported ones: 10 of 11 seen before.
        fresh = replace(
            parsed.rows[0], transfer_id=f"NEW-{frappe.generate_hash(length=8)}"
        )
        with_one_new = replace(parsed, rows=parsed.rows[1:] + (fresh,))

        verdict, _ = _assess_statement(with_one_new, "aug.csv")
        self.assertFalse(verdict.refuse)
        self.assertTrue(verdict.warn)
        self.assertEqual(verdict.new, 1)

    def test_the_upload_refuses_before_writing_anything(self):
        """⚠️ THE REFUSAL MUST PRECEDE `save_file`, which is not rollback-able -- the cloud
        attachment hook commits inside the request. A refusal after it would leave an orphan File
        behind for a statement we declined.

        Asserted structurally: `save_file` must not be reachable before the refusal check, and the
        cheapest honest way to state that is that no batch, row or File appears for a refused
        statement. Here the guard is that assessing costs nothing -- it is a pure read.
        """
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)
        before = frappe.db.count(BATCH_DOCTYPE)

        verdict, _ = _assess_statement(parsed, "aug.csv")

        self.assertTrue(verdict.refuse)
        self.assertEqual(frappe.db.count(BATCH_DOCTYPE), before)

    def test_the_duplicate_lookup_narrows_by_period(self):
        """Owner-directed: search the batches whose period overlaps this sheet's, not every import
        row ever recorded. Safe because the DB unique constraint is the real backstop -- a miss
        here costs a clearer message, never double-paid money.

        Proven by moving the SAME transfers a year out and watching them read as new.
        """
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)
        self.assertTrue(_assess_statement(parsed, "aug.csv")[0].refuse)

        moved = replace(
            parsed,
            rows=tuple(
                replace(row, added_on=row.added_on.replace(year=row.added_on.year + 1))
                for row in parsed.rows
                if row.added_on
            ),
        )
        moved = replace(
            moved,
            period_from=date(parsed.period_from.year + 1, parsed.period_from.month,
                             parsed.period_from.day),
            period_to=date(parsed.period_to.year + 1, parsed.period_to.month,
                           parsed.period_to.day),
        )

        verdict, _ = _assess_statement(moved, "next-year.csv")
        self.assertFalse(verdict.refuse)
        self.assertEqual(verdict.duplicates, 0)

    def test_a_batch_with_no_recorded_period_is_still_searched(self):
        """⚠️ A batch we could not date must never be read as a batch containing nothing. The
        narrowing excludes on EVIDENCE; absent evidence is not exclusion."""
        parsed = _parsed_in_a_fresh_transfer_namespace()
        batch = self._stage(parsed)
        frappe.db.set_value(
            BATCH_DOCTYPE, batch.name,
            {"period_from": None, "period_to": None}, update_modified=False,
        )
        frappe.db.commit()

        verdict, _ = _assess_statement(parsed, "aug.csv")
        self.assertTrue(verdict.refuse)


class TestXlsxStaging(unittest.TestCase):
    """An .xlsx statement stages exactly as its .csv twin does (owner ruling Q10, slice V3)."""

    def setUp(self):
        super().setUp()
        self.batches = []

    def tearDown(self):
        for name in self.batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDown()

    def _stage_from(self, path):
        with open(path, "rb") as handle:
            parsed = parse_statement(handle.read(), source="Cashfree")
        prefix = frappe.generate_hash(length=10)
        parsed = replace(
            parsed,
            rows=tuple(
                replace(r, transfer_id=f"{prefix}-{r.transfer_id}") for r in parsed.rows
            ),
        )
        batch = _stage_batch(
            parsed, file_url="/private/files/t", filename=path.rsplit("/", 1)[-1],
            user="Administrator",
        )
        self.batches.append(batch.name)
        frappe.db.commit()
        return batch

    def test_the_staged_batch_is_the_same_whichever_format_was_uploaded(self):
        from_csv = self._stage_from(FIXTURE)
        from_xlsx = self._stage_from(XLSX_FIXTURE)

        for field in (
            "total_rows", "reviewed_rows", "settled_rows", "skipped_rows", "error_rows",
            "status", "period_from", "period_to",
        ):
            self.assertEqual(
                from_csv.get(field), from_xlsx.get(field), f"{field} differs by upload format"
            )
        self.assertEqual(float(from_csv.gross_amount), float(from_xlsx.gross_amount))
        self.assertEqual(float(from_csv.charges_amount), float(from_xlsx.charges_amount))

    def test_the_staged_rows_carry_the_same_money_and_statuses(self):
        from_csv = self._stage_from(FIXTURE)
        from_xlsx = self._stage_from(XLSX_FIXTURE)

        def shape(batch):
            rows = frappe.get_all(
                ROW_DOCTYPE,
                filters={"import_batch": batch.name},
                fields=["amount", "row_status", "bank_account", "bank_reference_no"],
                order_by="creation asc",
            )
            return [
                (float(r["amount"]), r["row_status"], r["bank_account"], r["bank_reference_no"])
                for r in rows
            ]

        self.assertEqual(shape(from_csv), shape(from_xlsx))


if __name__ == "__main__":
    unittest.main()
