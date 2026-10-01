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
    _BANK_STATEMENT_SOURCES,
    _assess_statement,
    _posted_header_row,
    _sheet_payload,
    _stage_batch,
)
from nirmaan_stack.api.outflow_import.permissions import (
    OUTFLOW_IMPORT_PROFILES,
    has_outflow_access,
)
# Aliased at the import so a bare `execute()` in a test body cannot be read as anything but this
# patch -- `patches/` is full of functions with that name.
from nirmaan_stack.patches.v3_0.backfill_outflow_row_direction import execute as backfill_direction
from nirmaan_stack.patches.v3_0.backfill_outflow_settlement_reference import (
    execute as backfill_settlement_reference,
)
from nirmaan_stack.services.outflow_import.parser import (
    DIRECTION_DEBIT,
    SUPPORTED_SOURCES,
    is_success_status,
    parse_statement,
)

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


#: The Cashfree fixture lists one transfer twice with the same bank status (its first and last lines).
#: Since ADR-0031 that in-file EXACT repeat is counted as already imported on every upload of it,
#: fresh or not -- so a "brand new" statement's repeat count is this, not 0.
FIXTURE_IN_FILE_REPEATS = 1


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

    def test_every_parsed_row_is_staged_except_the_exact_repeat_which_is_counted(self):
        """ADR-0031. The fixture's last line repeats its first -- same transfer, same bank status --
        so it is not saved; the batch counts it instead, and `total_rows` counts only stored rows."""
        batch = self._stage()
        self.assertEqual(len(self._rows(batch)), len(self.parsed.rows) - 1)
        self.assertEqual(batch.total_rows, len(self.parsed.rows) - 1)
        self.assertEqual(batch.repeats_not_saved, 1)

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

    def test_a_staged_skip_is_marked_system_and_a_staged_line_is_not(self):
        """#1273: upload staging is a system skip path. Only a Manual skip can ever be unskipped."""
        batch = self._stage()
        rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch.name},
            fields=["row_status", "skip_origin"],
        )
        skipped = [r for r in rows if r["row_status"] == "Skipped"]
        self.assertTrue(skipped)
        self.assertEqual({r["skip_origin"] for r in skipped}, {"System"})
        # Blank either way: an insert lands a Select's None as '', a set_value as NULL.
        self.assertEqual(
            {r["skip_origin"] or None for r in rows if r["row_status"] != "Skipped"}, {None}
        )

    def test_a_staged_skip_stores_its_kind_and_a_staged_line_does_not(self):
        """Skip Type: every staged skip lands a kind beside its sentence; nothing else carries one."""
        batch = self._stage()
        rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch.name},
            fields=["row_status", "status_raw", "skip_kind"],
        )
        skipped = [r for r in rows if r["row_status"] == "Skipped"]
        self.assertTrue(skipped)
        self.assertNotIn(None, [r["skip_kind"] or None for r in skipped])
        refused = [r for r in skipped if r["status_raw"] == "FAILED"]
        self.assertTrue(refused)
        self.assertEqual({r["skip_kind"] for r in refused}, {"Bank refused"})
        self.assertEqual(
            {r["skip_kind"] or None for r in rows if r["row_status"] != "Skipped"}, {None}
        )

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

    def test_an_in_file_exact_repeat_stores_no_row_and_is_counted(self):
        # The same transfer listed twice in ONE statement. The cross-batch lookup cannot see it --
        # it only queries EARLIER batches -- so it needs its own guard. Left uncaught, both copies
        # later match the same payment and the second Outflow Row Match insert violates the
        # (transfer_id, target) unique constraint, aborting the whole match pass.
        #
        # ⚠️ INVERTED BY ADR-0031: the second appearance used to be staged Skipped. With the same
        # bank status it is now not saved at all -- only the first appearance has a row.
        tids = [r.transfer_id for r in self.parsed.rows]
        repeated = {tid for tid in tids if tids.count(tid) > 1}
        self.assertTrue(repeated, "fixture should contain a repeated transfer id")
        batch = self._stage()
        for tid in repeated:
            stored = [r for r in self._rows(batch) if r["transfer_id"] == tid]
            self.assertEqual([r["row_status"] for r in stored], ["Pending match run"])
        self.assertEqual(batch.repeats_not_saved, len(repeated))

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

    def test_re_uploading_the_same_statement_saves_no_transfer_and_counts_every_one(self):
        # The precise duplicate guard: transfer_id against EARLIER batches. This is what the
        # date-range overlap warning cannot do -- two exports can share a transfer without their
        # periods overlapping at all, and can share a period without sharing a transfer.
        #
        # ⚠️ INVERTED BY ADR-0031: every line used to be staged Skipped. Each is an exact repeat
        # now, so none is saved. (The endpoint refuses such a file outright; `_stage_batch` is
        # called directly here to pin what staging itself does.)
        parsed = _parsed_in_a_fresh_transfer_namespace()
        first = self._stage(parsed)
        second = self._stage(parsed)

        first_rows = frappe.get_all(
            ROW_DOCTYPE, filters={"import_batch": first.name}, fields=["row_status"]
        )
        self.assertTrue(any(r["row_status"] == "Pending match run" for r in first_rows))
        self.assertEqual(frappe.db.count(ROW_DOCTYPE, {"import_batch": second.name}), 0)
        self.assertEqual(second.repeats_not_saved, len(parsed.rows))

    def test_a_fully_duplicate_batch_stores_no_rows_and_counts_none_of_them(self):
        """⚠️ INVERTED BY ADR-0031: this was "is completed immediately", when every repeat was a
        stored Skipped row. Now nothing is stored, so every row counter is zero."""
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)
        second = self._stage(parsed)
        self.assertEqual(second.total_rows, 0)
        self.assertEqual(second.skipped_rows, 0)

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
        self._stage(parsed)

        later = replace(
            parsed,
            rows=tuple(
                replace(r, added_on=(r.added_on + timedelta(hours=3)) if r.added_on else None)
                for r in parsed.rows
            ),
        )
        second = self._stage(later)
        # ADR-0031: an exact repeat is not saved -- no row, one count per line.
        self.assertEqual(self._statuses(second), set())
        self.assertEqual(second.repeats_not_saved, len(parsed.rows))

    def test_an_UNREADABLE_date_falls_back_to_id_plus_amount_and_still_skips(self):
        # ⚠️ THE SILENT-DOUBLE-IMPORT GUARD (owner ruling). The parser stages a row whose Added On
        # it could not read; under SQL `NULL = NULL` semantics such a sheet would stop being
        # recognised on re-upload and import a SECOND time with nothing to show for it.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        undated = replace(parsed, rows=tuple(replace(r, added_on=None) for r in parsed.rows))
        self._stage(undated)
        second = self._stage(undated)
        # ADR-0031: recognised as repeats, so nothing is saved and every line is counted.
        self.assertEqual(self._statuses(second), set())
        self.assertEqual(second.repeats_not_saved, len(parsed.rows))

        # ...and it holds in the MIXED direction too: a dated re-upload of an undated batch.
        third = self._stage(parsed)
        self.assertEqual(self._statuses(third), set())
        self.assertEqual(third.repeats_not_saved, len(parsed.rows))

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
        second = self._stage(parsed)
        self.assertEqual(self._statuses(second), set())
        self.assertEqual(second.repeats_not_saved, len(parsed.rows))


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
        self._stage(parsed)
        second = self._stage(parsed)

        # ADR-0031: blocked means not saved at all now -- no row, and counted.
        self.assertEqual(self._rows(second), [])
        self.assertEqual(second.repeats_not_saved, len(parsed.rows))

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

        # ADR-0031: counted as an exact repeat (FAILED again), so it has no row in the re-upload.
        self.assertEqual([r for r in self._rows(second) if r["status_raw"] == "FAILED"], [])
        self.assertEqual(second.repeats_not_saved, len(parsed.rows))

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
        # ADR-0031: the genuinely-duplicate neighbours are exact repeats -- not saved, counted.
        self.assertEqual(list(by_id), [in_flight])
        self.assertEqual(today.repeats_not_saved, len(parsed.rows) - 1)

    def test_the_preview_agrees_with_the_upload(self):
        # ⚠️ THEY SHARE `_already_imported` PRECISELY SO THEY CANNOT DIVERGE, and this is what
        # proves the sharing still holds. A preview counting the queued rows as duplicates would
        # refuse a file the staging pass would happily have imported -- and a refusal writes
        # nothing at all, so the rows would never reach the screen to be argued about.
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(_all_queued(parsed))

        verdict = _assess_statement(parsed, "test-statement.csv")
        # None of the queued lines counts -- only the fixture's in-file repeat (ADR-0031).
        self.assertEqual(verdict.duplicates, FIXTURE_IN_FILE_REPEATS)
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
        # ⚠️ AND THE NEIGHBOUR IS BUILT BY HAND TOO (ADR-0031). A genuine repeat is no longer saved,
        # so today's copy of the settled transfer has no row -- but a pre-ADR-0031 site holds one,
        # Skipped "Already imported", and that is the row the patch must leave alone.
        original = frappe.get_doc(
            ROW_DOCTYPE,
            frappe.db.get_value(
                ROW_DOCTYPE, {"import_batch": yesterday.name, "transfer_id": settled_yesterday}
            ),
        )
        neighbour = frappe.copy_doc(original)
        neighbour.update(
            {
                "import_batch": today.name,
                "row_status": "Skipped",
                "skip_reason": f"Already imported in batch {yesterday.name}.",
                "skip_origin": "System",
                "skip_kind": "Already imported",
                "outcome_note": None,
            }
        )
        neighbour.insert(ignore_permissions=True)
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
        verdict = _assess_statement(parsed, "aug.csv")
        self.assertFalse(verdict.refuse)
        self.assertFalse(verdict.warn)
        # Nothing from an earlier import -- only the fixture's in-file repeat (ADR-0031).
        self.assertEqual(verdict.duplicates, FIXTURE_IN_FILE_REPEATS)

    def test_re_uploading_the_same_statement_is_refused_and_names_the_batch(self):
        """Owner ruling Q2: every row already imported means nothing new, so nothing is written."""
        parsed = _parsed_in_a_fresh_transfer_namespace()
        batch = self._stage(parsed)

        verdict = _assess_statement(parsed, "aug.csv")
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

        verdict = _assess_statement(with_one_new, "aug.csv")
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

        verdict = _assess_statement(parsed, "aug.csv")

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
        self.assertTrue(_assess_statement(parsed, "aug.csv").refuse)

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

        verdict = _assess_statement(moved, "next-year.csv")
        self.assertFalse(verdict.refuse)
        # Nothing found in the earlier batch -- only the fixture's in-file repeat (ADR-0031).
        self.assertEqual(verdict.duplicates, FIXTURE_IN_FILE_REPEATS)

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

        verdict = _assess_statement(parsed, "aug.csv")
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


ICICI_FIXTURE = (
    frappe.get_app_path("nirmaan_stack")
    + "/services/outflow_import/tests/fixtures/icici_sample.csv"
)


def _parsed_icici_in_a_fresh_transfer_namespace():
    """The ICICI fixture, every transfer id uniquely prefixed. Same reason as the Cashfree one.

    ⚠️ THE PREFIX MUST NOT TOUCH `remarks` OR `direction`. Those two are the axes the widened
    identity turns on, and this fixture reproduces both real collision shapes -- an SGST/CGST pair
    and both legs of a general-ledger transfer, each sharing a transfer id. Namespacing the id keeps
    the collisions intact while making them unique against every earlier batch in the database,
    which is exactly what these tests need.
    """
    with open(ICICI_FIXTURE, "rb") as handle:
        parsed = parse_statement(handle.read(), source="ICICI Bank Statement")
    prefix = frappe.generate_hash(length=10)
    rows = tuple(replace(r, transfer_id=f"{prefix}-{r.transfer_id}") for r in parsed.rows)
    return replace(parsed, rows=rows)


class TestStageBankStatement(unittest.TestCase):
    """Staging an ICICI bank statement (slice B3): direction, exclusions, and the landing status.

    ⚠️ THIS SUITE RUNS AGAINST THE LIVE SITE DATABASE, like the ones above. Every document it
    creates is purged in `tearDownClass`, and the purge is scoped to rows it created.

    The fixture's expected shape is pinned as NUMBERS so a drift in the ruleset shows up as a count
    rather than as a vague failure: 20 rows, 5 excluded (`platform_cashfree` x3,
    `internal_gl_transfer`, `internal_gl_transfer_in`), 15 landing `Mismatched`.
    """

    EXPECTED_ROWS = 20
    EXPECTED_EXCLUDED = 5

    created_batches: list = []

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.parsed = _parsed_icici_in_a_fresh_transfer_namespace()
        cls.batch = _stage_batch(
            cls.parsed,
            file_url="/private/files/test-icici.csv",
            filename="test-icici.csv",
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

    def _rows(self):
        return frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch.name},
            fields=["transfer_id", "row_status", "skip_reason", "outcome_note", "direction",
                    "amount", "remarks", "source"],
            order_by="creation asc",
        )

    def test_the_batch_records_the_new_source(self):
        """If the Select option and `parser.SUPPORTED_SOURCES` disagreed by one character, this
        insert would fail Frappe's own Select validation. This is that check, end to end."""
        self.assertEqual(self.batch.source, "ICICI Bank Statement")

    def test_the_stored_gross_is_the_withdrawals_alone(self):
        """⚠️ THE STORED FIGURE IS NOW OUTFLOW-ONLY (ticket #1287).

        Rs 37,27,536 is the fixture's `Withdrawal Amt (INR)` column. It used to store Rs 90,81,923 --
        withdrawals plus deposits -- because a passbook has no status column to tell the old
        every-successful-row sum apart from a deposit. The pre-#1287 number is asserted ABSENT so the
        old rule cannot come back quietly, and `v3_0.recompute_icici_gross_outflow` is what corrects
        the batches staged before this.
        """
        self.assertEqual(float(self.batch.gross_amount), 3727536.0)
        self.assertNotEqual(float(self.batch.gross_amount), 9081923.0)

    def test_the_money_that_came_IN_is_not_stored_anywhere_on_the_batch(self):
        """⚠️ DELIBERATELY NO SCHEMA CHANGE. Gross inflow rides the preview payload only. A stored
        second figure for the same statement is the two-keys-for-one-money shape `status.py` warns
        about, and there would be no history to correct it on."""
        self.assertFalse(frappe.db.has_column(BATCH_DOCTYPE, "gross_inflow_amount"))
        self.assertEqual(float(self.parsed.gross_inflow_amount), 5354387.0)

    def test_every_row_is_staged_including_the_ones_already_known_not_to_be_work(self):
        """405 of the real 1,274 rows are excluded, and every one of them is still STAGED.

        A dropped row is an absence, and nobody can review, count or argue with an absence. Same
        contract the parser already keeps for a FAILED transfer.
        """
        self.assertEqual(len(self._rows()), self.EXPECTED_ROWS)
        self.assertEqual(self.batch.total_rows, self.EXPECTED_ROWS)

    def test_direction_is_persisted_from_the_statement(self):
        self.assertEqual(
            {r["direction"] for r in self._rows() if r["direction"]}, {"Debit", "Credit"}
        )

    def test_direction_is_a_field_and_the_amount_stays_a_positive_magnitude(self):
        """⚠️ NEVER A SIGNED AMOUNT. `amounts_match`, both SQL pool queries, the settle guard and
        every summary sum assume a positive magnitude; a negative credit would pass all of them and
        do the wrong thing with nothing reporting it."""
        credits = [r for r in self._rows() if r["direction"] == "Credit"]
        self.assertTrue(credits)
        for row in credits:
            self.assertGreater(float(row["amount"]), 0)

    def test_a_row_the_statement_could_not_place_carries_a_blank_direction(self):
        """The fixture's one row with a figure in BOTH money columns. The parser refused to guess
        which was the transaction and blanked amount and direction together; the blank has to
        survive to the database rather than being filled in with a default."""
        self.assertEqual(len([r for r in self._rows() if not r["direction"]]), 1)

    def test_the_excluded_lines_are_skipped_and_each_names_the_rule_that_fired(self):
        excluded = [
            r for r in self._rows()
            if r["row_status"] == "Skipped" and "bank-statement rule" in (r["skip_reason"] or "")
        ]
        self.assertEqual(len(excluded), self.EXPECTED_EXCLUDED)
        self.assertEqual(
            sorted((r["skip_reason"] or "").split("'")[1] for r in excluded),
            [
                "internal_gl_transfer",
                "internal_gl_transfer_in",
                "platform_cashfree",
                "platform_cashfree",
                "platform_cashfree",
            ],
        )

    def test_each_excluded_line_stores_its_rule_s_skip_kind(self):
        """Skip Type: one kind per rule, and the two ledger-transfer legs share one."""
        excluded = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch.name, "row_status": "Skipped"},
            fields=["skip_reason", "skip_kind"],
        )
        kinds = sorted(
            r["skip_kind"] for r in excluded if "bank-statement rule" in (r["skip_reason"] or "")
        )
        self.assertEqual(
            kinds,
            [
                "Bank internal transfer",
                "Bank internal transfer",
                "Cashfree wallet top-up",
                "Cashfree wallet top-up",
                "Cashfree wallet top-up",
            ],
        )

    def test_both_legs_of_the_ledger_transfer_are_excluded_under_their_own_categories(self):
        """⚠️ THE DIRECTION IS PART OF THE TEST, NOT DECORATION (`bank_exclusions` design rule (b)).

        The two legs carry BYTE-IDENTICAL narration and differ only in which money column the bank
        filled in. A direction-blind rule files one as the other.
        """
        legs = [r for r in self._rows() if "Ac xfr from gl" in (r["remarks"] or "")]
        self.assertEqual(len(legs), 2)
        by_direction = {r["direction"]: r["skip_reason"] for r in legs}
        self.assertIn("internal_gl_transfer'", by_direction["Debit"])
        self.assertIn("internal_gl_transfer_in'", by_direction["Credit"])

    def test_a_blank_direction_fails_open_and_the_row_is_ingested(self):
        """⚠️ `bank_exclusions` DESIGN RULE (a), ONE LAYER UP -- AND THIS ROW PROVES IT BITES.

        The fixture's both-columns row carries `IDFB0020101`, Cashfree's IFSC, so it WOULD be
        skipped as a wallet top-up if a direction had been assumed for it. With no direction there
        is no honest way to evaluate a rule that leads with one, so it is ingested and a person sees
        it. A wrongly ingested row is visible; a wrongly dropped one is invisible forever.
        """
        row = next(r for r in self._rows() if not r["direction"])
        self.assertNotEqual(row["row_status"], "Skipped")

    def test_everything_not_excluded_lands_mismatched_for_a_person(self):
        """Owner ruling Q31. `Pending match run` would offer a run that settles nothing here."""
        landed = [r for r in self._rows() if r["row_status"] != "Skipped"]
        self.assertEqual(len(landed), self.EXPECTED_ROWS - self.EXPECTED_EXCLUDED)
        self.assertEqual({r["row_status"] for r in landed}, {"Mismatched"})

    def test_a_landed_row_explains_itself_in_the_outcome_note_not_the_skip_reason(self):
        landed = next(r for r in self._rows() if r["row_status"] == "Mismatched")
        self.assertTrue(landed["outcome_note"])
        self.assertIsNone(landed["skip_reason"])

    def test_a_landed_row_is_not_frozen_against_a_later_match_run(self):
        """⚠️ THE INTERACTION THAT DECIDED THE LANDING STATUS, PINNED AGAINST THE REAL SET.

        The already-recorded-as-Paid duplicate guard is KEPT on this source (owner ruling Q31a; it
        catches 41 of 711 real debits) and lives in `review.match_batch`, which filters out
        `_FROZEN_ROW_STATUSES`. `Mismatched` is not in that set, so every row staged here stays
        reachable. Landing them `Skipped` would have deleted the guard silently, and no other test
        would have noticed.
        """
        from nirmaan_stack.api.outflow_import.review import _FROZEN_ROW_STATUSES

        for row in self._rows():
            if row["row_status"] != "Skipped":
                self.assertNotIn(row["row_status"], _FROZEN_ROW_STATUSES)

    def test_the_widened_identity_keeps_the_colliding_pairs_apart(self):
        """The whole point of the source-aware key, measured end to end.

        Both an SGST/CGST pair and the two ledger legs share a transfer id, a date and an amount.
        On the old triple the second of each pair stages as an in-file repeat and is skipped; on the
        wide key both survive. Two rows in this fixture -- five per real statement.
        """
        self.assertEqual(
            [r for r in self._rows() if "earlier in the same statement" in (r["skip_reason"] or "")],
            [],
        )
        # ADR-0031: and neither leg of a pair is dropped as an in-file exact repeat.
        self.assertEqual(self.batch.repeats_not_saved, 0)

    def test_the_source_is_denormalised_onto_every_row(self):
        self.assertEqual({r["source"] for r in self._rows()}, {"ICICI Bank Statement"})


class TestExactRepeatsAreNotSaved(unittest.TestCase):
    """ADR-0031: a line the system already holds WITH THE SAME BANK STATUS is not saved, only counted.

    Through `_assess_statement` (the preview's and the upload's shared decision) and `_stage_batch`
    (what the upload writes) -- the same seam as the classes above, for the reason in the module
    docstring. Every fixture is namespaced and purged.
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

    def _rows(self, batch):
        return frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch.name},
            fields=["name", "transfer_id", "status_raw", "row_status", "skip_reason",
                    "skip_origin", "skip_kind"],
            order_by="creation asc",
        )

    @staticmethod
    def _with_status(parsed, transfer_id, status):
        return replace(
            parsed,
            rows=tuple(
                replace(r, status_raw=status) if r.transfer_id == transfer_id else r
                for r in parsed.rows
            ),
        )

    def _overlapping(self):
        """Yesterday's statement, and today's: the same lines plus two new transfers."""
        parsed = _parsed_in_a_fresh_transfer_namespace()
        fresh = tuple(
            replace(parsed.rows[i], transfer_id=f"NEW-{frappe.generate_hash(length=8)}")
            for i in (0, 3)
        )
        return parsed, replace(parsed, rows=parsed.rows + fresh)

    def test_an_overlapping_statement_stores_only_the_new_lines(self):
        yesterday, today = self._overlapping()
        self._stage(yesterday)
        batch = self._stage(today)

        rows = self._rows(batch)
        self.assertEqual(
            sorted(r["transfer_id"] for r in rows),
            sorted(r.transfer_id for r in today.rows[-2:]),
        )
        self.assertEqual(batch.repeats_not_saved, len(yesterday.rows))
        # Counters describe only the rows stored.
        self.assertEqual(batch.total_rows, 2)
        self.assertEqual(batch.skipped_rows, 0)

    def test_the_preview_and_the_upload_agree_on_the_repeat_count(self):
        """⚠️ The preview's `duplicate_rows` must be exactly what the upload leaves out, in-file
        repeat included -- a preview that promised one number and an upload that did another is
        the failure the shared decision exists to prevent."""
        yesterday, today = self._overlapping()
        self._stage(yesterday)
        # One more in-file exact repeat of a NEW line, so both kinds of repeat are in the count.
        today = replace(today, rows=today.rows + (today.rows[-1],))

        verdict = _assess_statement(today, "today.csv")
        batch = self._stage(today)
        self.assertEqual(verdict.duplicates, batch.repeats_not_saved)
        self.assertEqual(verdict.new, batch.total_rows)
        self.assertFalse(verdict.refuse)
        self.assertIn("will not be saved", verdict.message)

    def test_a_status_changed_repeat_is_saved_skipped_locked_and_names_both_statuses(self):
        from nirmaan_stack.services.outflow_import.skip_origin import unskip_refusal

        parsed = _parsed_in_a_fresh_transfer_namespace()
        first = self._stage(parsed)
        tid = next(r.transfer_id for r in parsed.rows if r.transfer_id.endswith("0004"))
        batch = self._stage(self._with_status(parsed, tid, "REVERSED"))

        rows = self._rows(batch)
        self.assertEqual([r["transfer_id"] for r in rows], [tid])
        row = rows[0]
        self.assertEqual(row["row_status"], "Skipped")
        self.assertEqual(row["skip_origin"], "System")
        self.assertEqual(row["skip_kind"], "Already imported")
        self.assertEqual(
            row["skip_reason"],
            f"Already imported in batch {first.name}, bank status changed SUCCESS → REVERSED.",
        )
        self.assertTrue(
            unskip_refusal(
                row_status=row["row_status"], skip_kind=row["skip_kind"], source="Cashfree"
            )
        )
        self.assertEqual(batch.repeats_not_saved, len(parsed.rows) - 1)

    def test_a_file_whose_only_new_content_is_a_status_change_is_accepted(self):
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)
        tid = next(r.transfer_id for r in parsed.rows if r.transfer_id.endswith("0004"))

        verdict = _assess_statement(self._with_status(parsed, tid, "REVERSED"), "t.csv")
        self.assertFalse(verdict.refuse)
        self.assertEqual(verdict.new, 1)
        self.assertEqual(verdict.duplicates, len(parsed.rows) - 1)

    def test_a_file_of_nothing_but_exact_repeats_is_refused(self):
        parsed = _parsed_in_a_fresh_transfer_namespace()
        first = self._stage(parsed)
        verdict = _assess_statement(parsed, "t.csv")
        self.assertTrue(verdict.refuse)
        self.assertEqual(verdict.duplicates, len(parsed.rows))
        self.assertIn(first.name, verdict.message)

    def test_a_status_changed_line_already_held_is_an_exact_repeat_on_the_next_upload(self):
        """SUCCESS, then REVERSED (saved), then REVERSED again: the system now holds a REVERSED
        line, so the third sighting is not saved -- it is not a status change against the first."""
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)
        tid = next(r.transfer_id for r in parsed.rows if r.transfer_id.endswith("0004"))
        reversed_ = self._with_status(parsed, tid, "REVERSED")
        self._stage(reversed_)

        verdict = _assess_statement(reversed_, "t.csv")
        self.assertTrue(verdict.refuse)
        third = self._stage(reversed_)
        self.assertEqual(self._rows(third), [])

    def test_an_in_file_status_changed_repeat_is_saved_and_names_both_statuses(self):
        parsed = _parsed_in_a_fresh_transfer_namespace()
        line = parsed.rows[0]
        batch = self._stage(
            replace(
                parsed,
                rows=(line, replace(line, status_raw="REVERSED", row_number=line.row_number + 1)),
            )
        )
        rows = self._rows(batch)
        self.assertEqual([r["status_raw"] for r in rows], ["SUCCESS", "REVERSED"])
        self.assertEqual(rows[1]["skip_kind"], "Repeated in same file")
        self.assertIn("same statement", rows[1]["skip_reason"])
        self.assertIn("SUCCESS → REVERSED", rows[1]["skip_reason"])
        self.assertEqual(batch.repeats_not_saved, 0)

    def test_the_upload_result_reports_the_count(self):
        from nirmaan_stack.api.outflow_import.upload import _summarize

        yesterday, today = self._overlapping()
        self._stage(yesterday)
        batch = self._stage(today)
        summary = _summarize(batch, today)
        self.assertEqual(summary["repeats_not_saved"], len(yesterday.rows))
        self.assertEqual(summary["total_rows"], 2)

    def test_import_history_returns_the_count(self):
        from nirmaan_stack.api.outflow_import.review import list_imports

        yesterday, today = self._overlapping()
        self._stage(yesterday)
        batch = self._stage(today)
        frappe.set_user("Administrator")
        listed = {r["name"]: r for r in list_imports(limit=200)}
        self.assertEqual(listed[batch.name]["repeats_not_saved"], len(yesterday.rows))

    def test_an_icici_re_upload_saves_nothing_and_keeps_the_pairs_apart_first_time(self):
        """The widened identity still keeps a tax pair and a GL transfer's two legs apart on the
        first upload (nothing counted), and a re-upload recognises every line, both legs included."""
        parsed = _parsed_icici_in_a_fresh_transfer_namespace()
        first = self._stage(parsed)
        self.assertEqual(first.repeats_not_saved, 0)
        self.assertEqual(first.total_rows, len(parsed.rows))

        verdict = _assess_statement(parsed, "icici.csv")
        self.assertTrue(verdict.refuse)
        second = self._stage(parsed)
        self.assertEqual(self._rows(second), [])
        self.assertEqual(second.repeats_not_saved, len(parsed.rows))


    @staticmethod
    def _icici_leg_pairs(parsed):
        """The fixture's lines that share a transfer id with exactly one other line -- the SGST/CGST
        pair (same direction, different narration) and the GL transfer (same narration, opposite
        direction). Each pair shares its amount and date too, so only the wide fields tell them apart."""
        by_id = {}
        for row in parsed.rows:
            by_id.setdefault(row.transfer_id, []).append(row)
        pairs = [legs for legs in by_id.values() if len(legs) == 2]
        for a, b in pairs:
            assert (a.amount, a.added_on_date) == (b.amount, b.added_on_date), a.transfer_id
        return pairs

    def test_an_icici_line_whose_only_earlier_sighting_is_the_other_leg_is_stored(self):
        """#1358: an earlier sighting counts only when it matches the FULL identity. The other leg
        shares id, amount and date but not direction or remarks, so it is a different line."""
        parsed = _parsed_icici_in_a_fresh_transfer_namespace()
        pairs = self._icici_leg_pairs(parsed)
        self.assertTrue(any(a.direction != b.direction for a, b in pairs))
        self.assertTrue(any(a.direction == b.direction and a.remarks != b.remarks for a, b in pairs))
        first_legs = replace(parsed, rows=tuple(a for a, _ in pairs))
        other_legs = replace(parsed, rows=tuple(b for _, b in pairs))
        self._stage(first_legs)

        verdict = _assess_statement(other_legs, "icici.csv")
        self.assertEqual(verdict.duplicates, 0)
        second = self._stage(other_legs)
        self.assertEqual(second.repeats_not_saved, 0)
        rows = self._rows(second)
        self.assertEqual(len(rows), len(pairs))
        self.assertNotIn("Already imported", [r["skip_kind"] for r in rows])

    def test_a_true_re_upload_of_both_icici_legs_is_still_left_out(self):
        parsed = _parsed_icici_in_a_fresh_transfer_namespace()
        both = replace(parsed, rows=tuple(leg for pair in self._icici_leg_pairs(parsed) for leg in pair))
        self._stage(both)
        again = self._stage(both)
        self.assertEqual(self._rows(again), [])
        self.assertEqual(again.repeats_not_saved, len(both.rows))


class TestOneUploadAsksOnce(unittest.TestCase):
    """#1358: an upload plans its lines ONCE -- one earlier-sightings query, one overlap query --
    and the refusal check and the staging both read that one plan.

    Through the real endpoint (the multipart read faked with a `werkzeug` `FileStorage`, `save_file`
    stubbed), because the two calls sit in the endpoint and nowhere else."""

    def setUp(self):
        super().setUp()
        # Unique per run, and purged BY NAME: an upload that raises after inserting its batch never
        # returns the batch's id, and must still leave nothing behind.
        self.filename = f"once-{frappe.generate_hash(length=8)}.csv"
        self.addCleanup(self._purge)

    def _purge(self):
        frappe.db.rollback()
        for name in frappe.get_all(BATCH_DOCTYPE, filters={"original_filename": self.filename}, pluck="name"):
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()

    def test_the_sightings_and_overlap_queries_run_once_per_upload(self):
        import io as _io
        from types import SimpleNamespace
        from unittest.mock import patch

        from werkzeug.datastructures import FileStorage, MultiDict

        from nirmaan_stack.api.outflow_import import upload

        prefix = frappe.generate_hash(length=8)
        with open(FIXTURE, "r", encoding="utf-8") as handle:
            text = handle.read()
        # A fresh transfer namespace in the FILE ITSELF, so nothing in the database already holds it.
        content = text.replace("TID", f"TID{prefix}").encode()
        filename = self.filename

        class _Request:
            files = MultiDict({"file": FileStorage(stream=_io.BytesIO(content), filename=filename)})

        previous_request = getattr(frappe.local, "request", None)
        previous_form = dict(frappe.form_dict)
        frappe.set_user("Administrator")
        frappe.local.request = _Request()
        frappe.form_dict["source"] = "Cashfree"
        frappe.form_dict.pop("header_row", None)
        try:
            with patch.object(
                upload, "find_earlier_sightings_for_rows",
                wraps=upload.find_earlier_sightings_for_rows,
            ) as sightings, patch.object(
                upload, "_find_overlapping_batch", wraps=upload._find_overlapping_batch
            ) as overlaps, patch.object(
                upload, "save_file",
                return_value=SimpleNamespace(name="no-such-file", file_url=f"/private/files/{filename}"),
            ):
                result = upload.upload_outflow_statement()
        finally:
            frappe.local.request = previous_request
            frappe.local.form_dict = frappe._dict(previous_form)

        self.assertEqual(sightings.call_count, 1)
        self.assertEqual(overlaps.call_count, 1)
        self.assertGreater(result["total_rows"], 0)


class TestOneMoneyRule(unittest.TestCase):
    """#1358: "money over the stored lines" is ONE helper, `parser.stored_money`, read by the
    Cashfree/ICICI staging, the Cashbook staging and the cleanup patch -- never three spellings."""

    def test_every_writer_of_an_imports_money_reads_the_one_helper(self):
        import inspect

        from nirmaan_stack.api.outflow_import import cashbook, upload
        from nirmaan_stack.patches.v3_0 import delete_stored_exact_repeats
        from nirmaan_stack.services.outflow_import import parser

        for module in (upload, cashbook, delete_stored_exact_repeats):
            with self.subTest(module=module.__name__):
                self.assertIs(module.stored_money, parser.stored_money)
                source = inspect.getsource(module)
                self.assertNotIn("gross_by_direction(", source)
                self.assertNotIn("charges_of(", source)

    def test_the_helper_is_successful_debits_and_every_lines_charges(self):
        from types import SimpleNamespace

        from nirmaan_stack.services.outflow_import.parser import stored_money

        def line(amount, success, direction, charge):
            return SimpleNamespace(
                amount=Decimal(amount), is_success=success, direction=direction,
                service_charge=Decimal(charge), service_tax=Decimal("0"),
            )

        gross, charges = stored_money([
            line("100", True, "Debit", "1"),
            line("200", False, "Debit", "2"),
            line("300", True, "Credit", "3"),
            line("400", True, "", "4"),
        ])
        self.assertEqual((gross, charges), (Decimal("100"), Decimal("10")))


class TestMoneyTotalsCoverOnlySavedLines(unittest.TestCase):
    """#1354: an import's `gross_amount` / `charges_amount` describe the rows it STORED (ADR-0031).

    The expected figures are summed from the stored rows under each total's own rule -- gross =
    successful DEBITS, charges = every line -- so the assertion is "the batch's money equals its
    rows' money", which is exactly what import history pairs `successful_rows` against. Every
    fixture is namespaced and purged.
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

    def _stored_totals(self, batch):
        rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": batch.name},
            fields=["amount", "status_raw", "direction", "service_charge", "service_tax"],
        )
        gross = sum(
            Decimal(str(r["amount"]))
            for r in rows
            if is_success_status(r["status_raw"]) and r["direction"] == DIRECTION_DEBIT
        )
        charges = sum(
            Decimal(str(r["service_charge"])) + Decimal(str(r["service_tax"])) for r in rows
        )
        return gross, charges

    def assertMoneyIsTheStoredRows(self, batch):
        gross, charges = self._stored_totals(batch)
        self.assertEqual(Decimal(str(batch.gross_amount)), gross)
        self.assertEqual(Decimal(str(batch.charges_amount)), charges)

    @staticmethod
    def _plus_new(parsed, indexes):
        """`parsed` again, plus fresh copies of the lines at `indexes` -- an overlapping statement."""
        fresh = tuple(
            replace(parsed.rows[i], transfer_id=f"NEW-{frappe.generate_hash(length=8)}")
            for i in indexes
        )
        return replace(parsed, rows=parsed.rows + fresh)

    def test_a_cashfree_overlap_totals_only_the_new_lines(self):
        yesterday = _parsed_in_a_fresh_transfer_namespace()
        self._stage(yesterday)
        # Index 0 is a successful Rs 5,000 line, index 1 the FAILED Rs 22,000 one.
        today = self._plus_new(yesterday, (0, 1))
        batch = self._stage(today)

        self.assertEqual(batch.total_rows, 2)
        self.assertEqual(float(batch.gross_amount), 5000.0)
        self.assertEqual(float(batch.charges_amount), 9.44)
        self.assertMoneyIsTheStoredRows(batch)
        # The whole file's figures are what this must NOT store any more.
        self.assertNotEqual(float(batch.gross_amount), float(today.gross_amount))

    def test_a_cashfree_in_file_repeat_is_left_out_of_the_money(self):
        """The fixture's last line repeats its first (Rs 5,000, Rs 9.44 charges) -- not saved, so not
        counted. The whole-file figures are Rs 57,727.50 and Rs 94.40."""
        parsed = _parsed_in_a_fresh_transfer_namespace()
        batch = self._stage(parsed)
        self.assertEqual(batch.repeats_not_saved, 1)
        self.assertEqual(float(batch.gross_amount), 52727.5)
        self.assertEqual(float(batch.charges_amount), 84.96)
        self.assertMoneyIsTheStoredRows(batch)

    def test_a_cashfree_upload_with_no_repeats_totals_exactly_as_the_parser_does(self):
        no_repeats = _parsed_cashfree_without_its_in_file_repeat()
        batch = self._stage(no_repeats)
        self.assertEqual(batch.repeats_not_saved, 0)
        self.assertEqual(float(batch.gross_amount), float(no_repeats.gross_amount))
        self.assertEqual(float(batch.charges_amount), float(no_repeats.charges_amount))

    def test_an_icici_upload_with_no_repeats_totals_exactly_as_the_parser_does(self):
        parsed = _parsed_icici_in_a_fresh_transfer_namespace()
        batch = self._stage(parsed)
        self.assertEqual(batch.repeats_not_saved, 0)
        self.assertEqual(float(batch.gross_amount), float(parsed.gross_amount))
        self.assertEqual(float(batch.gross_amount), 3727536.0)
        self.assertEqual(float(batch.charges_amount), float(parsed.charges_amount))

    def test_an_icici_overlap_totals_only_the_new_lines_and_keeps_credits_out_of_gross(self):
        yesterday = _parsed_icici_in_a_fresh_transfer_namespace()
        self._stage(yesterday)
        debit = next(i for i, r in enumerate(yesterday.rows) if r.direction == "Debit")
        credit = next(i for i, r in enumerate(yesterday.rows) if r.direction == "Credit")
        today = self._plus_new(yesterday, (debit, credit))
        batch = self._stage(today)

        self.assertEqual(batch.total_rows, 2)
        self.assertEqual(float(batch.gross_amount), float(yesterday.rows[debit].amount))
        self.assertMoneyIsTheStoredRows(batch)

    def test_a_status_changed_repeat_is_in_charges_but_not_in_gross(self):
        """Stored REVERSED, so it is not a successful debit; its charges still count (every line)."""
        parsed = _parsed_in_a_fresh_transfer_namespace()
        self._stage(parsed)
        tid = next(r.transfer_id for r in parsed.rows if r.transfer_id.endswith("0004"))
        changed = replace(
            parsed,
            rows=tuple(
                replace(r, status_raw="REVERSED") if r.transfer_id == tid else r
                for r in parsed.rows
            ),
        )
        batch = self._stage(changed)

        self.assertEqual(batch.total_rows, 1)
        self.assertEqual(float(batch.gross_amount), 0.0)
        self.assertEqual(float(batch.charges_amount), 9.44)
        self.assertMoneyIsTheStoredRows(batch)

    def test_the_upload_result_reports_the_stored_totals(self):
        from nirmaan_stack.api.outflow_import.upload import _summarize

        yesterday = _parsed_in_a_fresh_transfer_namespace()
        self._stage(yesterday)
        today = self._plus_new(yesterday, (0,))
        batch = self._stage(today)
        summary = _summarize(batch, today)
        self.assertEqual(summary["gross_amount"], 5000.0)
        self.assertEqual(summary["charges_amount"], 9.44)

    def test_import_history_pairs_the_count_and_the_gross_over_the_same_rows(self):
        from nirmaan_stack.api.outflow_import.review import list_imports

        yesterday = _parsed_in_a_fresh_transfer_namespace()
        self._stage(yesterday)
        today = self._plus_new(yesterday, (0, 1, 3))
        batch = self._stage(today)

        frappe.set_user("Administrator")
        listed = {r["name"]: r for r in list_imports(limit=200)}[batch.name]
        # Two successful debits (Rs 5,000 + Rs 10,000) and one FAILED line.
        self.assertEqual(listed["successful_rows"], 2)
        self.assertEqual(float(listed["gross_amount"]), 15000.0)


def _parsed_cashfree_without_its_in_file_repeat():
    """The Cashfree fixture minus its last line (a repeat of its first), PARSED as a real file --
    so its money totals are the parser's own over a file with no repeat in it. Namespaced."""
    with open(FIXTURE, "rb") as handle:
        lines = handle.read().splitlines(keepends=True)
    parsed = parse_statement(b"".join(lines[:-1]), source="Cashfree")
    prefix = frappe.generate_hash(length=10)
    rows = tuple(replace(r, transfer_id=f"{prefix}-{r.transfer_id}") for r in parsed.rows)
    return replace(parsed, rows=rows)


class TestGatewaySourcesAreUnmoved(unittest.TestCase):
    """Cashfree and Cashbook stage EXACTLY as they did before slice B3.

    ⚠️ ORDERING NOTE: `unittest` loads classes alphabetically, so `TestDirectionBackfillPatch` runs
    BEFORE this one and its live-table write cannot reach rows this class has not staged yet. A new
    class that runs the patch and sorts after `TestGateway...` would stamp `Debit` on these rows and
    break the assertion below -- which would be the test doing its job, not a flake.

    ⚠️ THIS IS THE HALF OF THE SLICE THAT IS EASIEST TO BREAK AND HARDEST TO NOTICE. Both carry live
    settled data. Were the exclusion ruleset run over a Cashfree export it would match that export's
    OWN rows -- `CASHFREEID` and `cash\\s*free` appear in the ruleset as the names of wallet top-ups
    seen from the BANK's side -- and skip real disbursements as noise.
    """

    created_batches: list = []

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.parsed = _parsed_in_a_fresh_transfer_namespace()
        cls.batch = _stage_batch(
            cls.parsed,
            file_url="/private/files/test-unmoved.csv",
            filename="test-unmoved.csv",
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

    def _rows(self):
        return frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch.name},
            fields=["row_status", "skip_reason", "outcome_note", "direction", "status_raw"],
            order_by="creation asc",
        )

    def test_no_row_is_excluded_by_a_bank_statement_rule(self):
        for row in self._rows():
            self.assertNotIn("bank-statement rule", row["skip_reason"] or "")

    def test_a_successful_row_still_lands_pending_match_run(self):
        """NOT `Mismatched`. The landing is a fact about the SOURCE, and this one has a match run
        that really does settle."""
        rows = self._rows()
        self.assertTrue([r for r in rows if r["row_status"] == "Pending match run"])
        self.assertNotIn("Mismatched", {r["row_status"] for r in rows})

    def test_a_gateway_row_states_debit_because_its_one_column_is_a_debit_column(self):
        """⚠️ THE INVERTED PIN. This asserted `{""}` until slice B3a; the reasoning is kept so that
        nobody reverses it back by accident.

        It used to say blank is not "Debit by default", and that a statement which did not say is
        not the same as one that said Debit. THAT PRINCIPLE SURVIVES -- it merely turned out the
        gateway statements DO say. B3a taught the adapter table `_StatesWhenPopulated`: a source
        whose amount comes from a single DEBIT column states `Debit` whenever that cell carried a
        figure. Cashfree's export is payouts-only, so every row genuinely is a debit; Cashbook's
        column is literally named `Debit`.

        ⚠️ THE PRINCIPLE IS STILL PINNED, just elsewhere and more sharply -- a Cashbook wallet
        top-up stays BLANK (its `Credit` column is deliberately unmapped, so we truly do not know),
        and an ICICI row with BOTH money columns populated stays blank rather than being guessed.
        See `test_parser.TestSingleDebitColumnDirection`.

        ⚠️ A BLANK SELECT PERSISTS AS `''`, NOT NULL -- the `direction` column carries the empty
        string that heads its options list. `outcome_note` beside it really is NULL, because it is a
        Text written as `None`. The two are different shapes of "nothing" and the patch's
        `IS NULL OR = ''` covers both deliberately."""
        self.assertEqual({r["direction"] for r in self._rows()}, {"Debit"})

    def test_a_pending_row_carries_no_note_in_either_field(self):
        """`outcome_note` is written from the same `outcome.note` as `skip_reason` from B3 on, and
        an empty note must stay NULL rather than becoming `''` -- otherwise every pre-existing
        Cashfree row would differ from a newly staged one by an empty string."""
        pending = [r for r in self._rows() if r["row_status"] == "Pending match run"]
        self.assertTrue(pending)
        for row in pending:
            self.assertIsNone(row["outcome_note"])
            self.assertIsNone(row["skip_reason"])


class TestSourceVocabulary(unittest.TestCase):
    """One source name, spelled the same in THREE places, pinned so a rename cannot reach only two.

    `_read_and_parse` validates the posted source against `parser.SUPPORTED_SOURCES`; `_stage_batch`
    writes that same string into the `Outflow Import Batch.source` Select. A one-character drift
    between them makes every upload of that source fail Frappe's Select validation, and nothing on
    the screen says why.
    """

    def test_every_bank_statement_source_is_a_source_the_parser_knows(self):
        self.assertTrue(_BANK_STATEMENT_SOURCES)
        for source in _BANK_STATEMENT_SOURCES:
            with self.subTest(source=source):
                self.assertIn(source, SUPPORTED_SOURCES)

    def test_every_parser_source_is_an_option_on_the_batch_doctype(self):
        """The other direction too: an adapter nobody can select is an adapter nobody can use."""
        options = frappe.get_meta(BATCH_DOCTYPE).get_field("source").options.split("\n")
        for source in SUPPORTED_SOURCES:
            with self.subTest(source=source):
                self.assertIn(source, options)

    def test_direction_is_a_select_that_admits_a_blank(self):
        """A blank direction is a real value -- "the statement did not say" -- on every gateway row,
        and on a bank row the parser refused to guess about. The leading empty option is the house
        way of saying so (see `settlement_origin`)."""
        options = frappe.get_meta(ROW_DOCTYPE).get_field("direction").options.split("\n")
        self.assertEqual(options, ["", "Debit", "Credit"])


class TestDirectionBackfillPatch(unittest.TestCase):
    """`patches/v3_0/backfill_outflow_row_direction.py` -- and above all what it must NOT touch.

    ⚠️ IT RUNS AGAINST THE LIVE SITE TABLE, because that is what the patch does and there is no
    honest way to scope an `UPDATE ... FROM` to one suite's rows. The write is the migration the
    maintainer will run anyway, it is idempotent, and it only ever fills a blank -- so executing it
    here costs nothing that the next migrate would not do. What is ASSERTED is this suite's own
    rows, plus the one negative that matters.
    """

    created_batches: list = []

    @classmethod
    def tearDownClass(cls):
        for name in cls.created_batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _stage(self, parsed, filename):
        batch = _stage_batch(
            parsed, file_url=f"/private/files/{filename}", filename=filename, user="Administrator"
        )
        self.created_batches.append(batch.name)
        frappe.db.commit()
        return batch

    def _directions(self, batch):
        return [
            r["direction"]
            for r in frappe.get_all(
                ROW_DOCTYPE, filters={"import_batch": batch.name}, fields=["direction"]
            )
        ]

    def test_it_fills_a_gateway_row_that_predates_the_column(self):
        """Cashfree and Cashbook are outflow-ONLY exports, so `Debit` is a fact about every row
        already staged rather than a guess. That is the patch's whole licence.

        ⚠️ THE SETUP HAD TO CHANGE AT B3a, AND THE REASON IS THE POINT OF THE TEST. Staging alone
        used to leave these rows blank, so the fixture WAS a pre-column row. Since B3a the parser
        states `Debit` on a gateway row at parse time, so a freshly staged row is already filled and
        the patch would correctly no-op on it -- proving nothing. The blanking below MANUFACTURES
        the historical shape the patch exists for: a row staged before the column existed.

        ⚠️ Do NOT "simplify" this by deleting the blanking and asserting the rows are already
        `Debit`. That would assert the PARSER's behaviour through the patch's test, and the patch
        could then be gutted entirely without a single test going red."""
        batch = self._stage(_parsed_in_a_fresh_transfer_namespace(), "test-backfill.csv")

        # Simulate a row staged before `direction` existed -- what the patch is actually for.
        for row in frappe.get_all(
            ROW_DOCTYPE, filters={"import_batch": batch.name}, fields=["name"]
        ):
            frappe.db.set_value(ROW_DOCTYPE, row["name"], "direction", "", update_modified=False)
        frappe.db.commit()
        self.assertEqual(set(self._directions(batch)), {""})

        backfill_direction()
        self.assertEqual(set(self._directions(batch)), {"Debit"})

    def test_it_is_idempotent_and_never_overwrites_a_direction_already_set(self):
        batch = self._stage(_parsed_in_a_fresh_transfer_namespace(), "test-backfill-2.csv")
        one = frappe.get_all(
            ROW_DOCTYPE, filters={"import_batch": batch.name}, fields=["name"], limit=1
        )[0]["name"]
        # A hand correction the patch must leave alone.
        frappe.db.set_value(ROW_DOCTYPE, one, "direction", "Credit", update_modified=False)
        frappe.db.commit()

        backfill_direction()
        backfill_direction()
        directions = self._directions(batch)
        self.assertEqual(directions.count("Credit"), 1)
        self.assertEqual(set(directions), {"Debit", "Credit"})

    def test_it_never_stamps_debit_on_a_bank_statement_row(self):
        """⚠️ THE NEGATIVE THE SCOPE EXISTS FOR, AND WHY IT IS NOT A BARE `WHERE direction = ''`.

        On a bank statement a blank direction does not mean "this format has one money column"; it
        means the parser found a figure in BOTH and refused to guess which was the transaction.
        Stamping `Debit` there manufactures the exact answer it declined to invent, and does it
        invisibly -- the row would then look like every ordinary debit beside it. An unscoped update
        reads as harmless and is one migrate away from that lie.
        """
        batch = self._stage(_parsed_icici_in_a_fresh_transfer_namespace(), "test-backfill-3.csv")
        before = self._directions(batch)
        self.assertIn("", before, "fixture should carry the both-columns row")

        backfill_direction()
        self.assertEqual(sorted(before, key=str), sorted(self._directions(batch), key=str))


class TestSettlementReferenceIsResolvedAtIngest(unittest.TestCase):
    """`Outflow Import Row.settlement_reference` -- the ONE value every write site reads (B9).

    ⚠️ THE RESOLUTION IS PINNED HERE, AT THE INGEST, BECAUSE THAT IS WHERE IT HAPPENS. The five
    write sites' behaviour is pinned in `test_settle_payment.TestTheResolvedSettlementReference`;
    what this asserts is that the value ARRIVES on the staged row in the first place, per source
    and per rung. A ladder that resolves correctly in a unit test and is never written would leave
    every one of those suites green and every settlement blank.
    """

    created_batches: list = []

    @classmethod
    def tearDownClass(cls):
        for name in cls.created_batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _stage_one(self, *, source="Cashfree", **reference_fields):
        parsed = _parsed_in_a_fresh_transfer_namespace()
        parsed = replace(
            parsed, source=source, rows=(replace(parsed.rows[0], **reference_fields),)
        )
        batch = _stage_batch(
            parsed,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        self.created_batches.append(batch.name)
        frappe.db.commit()
        return frappe._dict(
            frappe.db.get_value(
                ROW_DOCTYPE,
                {"import_batch": batch.name},
                ["name", "bank_reference_no", "reference_id", "transfer_id",
                 "settlement_reference"],
                as_dict=True,
            )
        )

    def test_rung_one_the_bank_reference_wins(self):
        row = self._stage_one(bank_reference_no="UTR-RUNG-1", reference_id="GW-1")
        self.assertEqual(row.settlement_reference, "UTR-RUNG-1")

    def test_rung_two_the_gateway_reference_when_the_bank_gave_none(self):
        """The 61 live rows in this shape are all `Skipped`, so nothing on the ledger is wrong
        today -- this is what stops it going wrong the day one of them is re-decided."""
        row = self._stage_one(bank_reference_no="", reference_id="GW-RUNG-2")
        self.assertEqual(row.settlement_reference, "GW-RUNG-2")

    def test_rung_three_is_the_wallet_transfer_id_and_only_the_wallet(self):
        """⚠️ BOTH HALVES IN ONE TEST, because the scope is the load-bearing part. Every source has
        a `transfer_id`; only the wallet has nothing else, which is what makes its transaction id a
        settlement reference rather than a fourth identifier nobody reconciles against. An
        unscoped third rung would stamp a gateway's own transfer id into `Project Payments.utr` on
        2,237 Cashfree rows nobody asked for."""
        wallet = self._stage_one(source="Cashbook", bank_reference_no="", reference_id="")
        self.assertEqual(wallet.settlement_reference, wallet.transfer_id)

        gateway = self._stage_one(source="Cashfree", bank_reference_no="", reference_id="")
        self.assertTrue(gateway.transfer_id, "fixture precondition: it HAS a transfer id")
        self.assertIn(gateway.settlement_reference, (None, ""))

    def test_the_matchers_own_column_is_untouched_by_any_of_this(self):
        """⚠️ THE GUARDED SURFACE, PINNED FROM THE INGEST SIDE. `normalized_reference` is derived
        from `bank_reference_no` ALONE and feeds reference matching and the duplicate guard. A row
        with no bank reference must still store a BLANK there, however much
        `settlement_reference` now has to offer -- deriving it from the resolved value would make a
        gateway id matchable against `Project Payments.utr`, a column already holding hundreds of
        non-bank strings.

        ⚠️ `normalized_reference` IS BLANKED IN THE FIXTURE ALONGSIDE `bank_reference_no`, and it
        has to be: `dataclasses.replace` copies the derived field rather than re-deriving it, so
        clearing only the bank column leaves a `RawRow` no parser could ever produce. The parser
        computes `normalize_reference("")` for a row with no bank reference, which is what this
        reproduces -- the earlier draft asserted against a fixture that lied.
        """
        row = self._stage_one(
            bank_reference_no="", normalized_reference="", reference_id="GW-NOT-A-BANK-REF"
        )
        self.assertEqual(row.settlement_reference, "GW-NOT-A-BANK-REF")
        self.assertIn(
            frappe.db.get_value(ROW_DOCTYPE, row.name, "normalized_reference"), (None, "")
        )


class TestSettlementReferenceBackfillPatch(unittest.TestCase):
    """`patches/v3_0/backfill_outflow_settlement_reference.py`.

    ⚠️ IT RUNS AGAINST THE LIVE SITE TABLE, for the reason `TestDirectionBackfillPatch` gives: that
    is what the patch does, there is no honest way to scope an `UPDATE ... FROM` to one suite's
    rows, and it is idempotent and only ever fills a blank. What is ASSERTED is this suite's own
    rows.
    """

    created_batches: list = []

    @classmethod
    def tearDownClass(cls):
        for name in cls.created_batches:
            frappe.db.delete(ROW_DOCTYPE, {"import_batch": name})
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _stage_blanked(self, *, source="Cashfree", **reference_fields):
        """Stage a batch, then BLANK `settlement_reference` -- manufacturing the historical shape
        the patch exists for: a row staged before the column existed.

        ⚠️ Do NOT "simplify" this by deleting the blanking and asserting the rows already carry the
        value. That asserts the INGEST's behaviour through the patch's test, and the patch could
        then be gutted entirely without a single test going red -- the trap
        `TestDirectionBackfillPatch` records having fallen into once already.
        """
        parsed = _parsed_in_a_fresh_transfer_namespace()
        parsed = replace(
            parsed, source=source, rows=(replace(parsed.rows[0], **reference_fields),)
        )
        batch = _stage_batch(
            parsed,
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        self.created_batches.append(batch.name)
        name = frappe.db.get_value(ROW_DOCTYPE, {"import_batch": batch.name}, "name")
        frappe.db.set_value(ROW_DOCTYPE, name, "settlement_reference", "", update_modified=False)
        frappe.db.commit()
        self.assertIn(
            frappe.db.get_value(ROW_DOCTYPE, name, "settlement_reference"), (None, "")
        )
        return name

    def _resolved(self, name):
        return frappe.db.get_value(ROW_DOCTYPE, name, "settlement_reference")

    def test_it_fills_each_rung_on_a_row_that_predates_the_column(self):
        bank = self._stage_blanked(bank_reference_no="UTR-OLD-1", reference_id="GW-OLD-1")
        gateway = self._stage_blanked(bank_reference_no="", reference_id="GW-OLD-2")
        wallet = self._stage_blanked(source="Cashbook", bank_reference_no="", reference_id="")

        backfill_settlement_reference()

        self.assertEqual(self._resolved(bank), "UTR-OLD-1")
        self.assertEqual(self._resolved(gateway), "GW-OLD-2")
        self.assertEqual(
            self._resolved(wallet),
            frappe.db.get_value(ROW_DOCTYPE, wallet, "transfer_id"),
        )

    def test_it_never_gives_a_gateway_row_its_own_transfer_id(self):
        """⚠️ THE NEGATIVE THE SCOPE EXISTS FOR. A bare `COALESCE(bank, gateway, transfer)` reads
        as harmless and would stamp a gateway's transfer id into `Project Payments.utr` on every
        such row -- invisibly, in a column that already holds hundreds of non-bank strings."""
        gateway = self._stage_blanked(bank_reference_no="", reference_id="")
        self.assertTrue(frappe.db.get_value(ROW_DOCTYPE, gateway, "transfer_id"))

        backfill_settlement_reference()

        self.assertIn(self._resolved(gateway), (None, ""))

    def test_the_sql_restatement_agrees_with_the_resolver_on_every_rung(self):
        """⚠️ THE SEAM NOTHING ELSE CROSSES. The patch RESTATES the ladder in SQL rather than
        importing it, deliberately -- a patch is append-only history and must keep meaning what it
        meant on the day it ran. Restating means the two CAN disagree, and they never meet at
        runtime: the resolver runs at ingest, the SQL runs once at migrate. Each side's own tests
        would stay green through a divergence.

        Verified separately against all 2,511 live rows on 2026-09-11 (0 mismatches); this pins the
        same comparison on rows the suite owns, per rung and per source.
        """
        from nirmaan_stack.services.outflow_import.settlement_reference import (
            resolve_settlement_reference,
        )

        cases = [
            self._stage_blanked(bank_reference_no="UTR-P", reference_id="GW-P"),
            self._stage_blanked(bank_reference_no="", reference_id="GW-P2"),
            self._stage_blanked(bank_reference_no="", reference_id=""),
            self._stage_blanked(source="Cashbook", bank_reference_no="", reference_id=""),
        ]

        backfill_settlement_reference()

        for name in cases:
            row = frappe.db.get_value(
                ROW_DOCTYPE,
                name,
                ["bank_reference_no", "reference_id", "transfer_id", "settlement_reference"],
                as_dict=True,
            )
            source = frappe.db.get_value(
                BATCH_DOCTYPE,
                frappe.db.get_value(ROW_DOCTYPE, name, "import_batch"),
                "source",
            )
            self.assertEqual(
                (row["settlement_reference"] or "").strip(),
                resolve_settlement_reference(
                    bank_reference_no=row["bank_reference_no"],
                    reference_id=row["reference_id"],
                    transfer_id=row["transfer_id"],
                    # Every case here is a gateway or the wallet; the patch predates the passbook
                    # rung (#1259), which resolves at read time and needs no backfill.
                    remarks="",
                    source=source,
                ),
                f"{name} ({source}) -- the patch's SQL and the resolver disagree",
            )

    def test_it_is_idempotent_and_never_overwrites_a_value_already_there(self):
        row = self._stage_blanked(bank_reference_no="UTR-OLD-3", reference_id="GW-OLD-3")
        # A hand correction the patch must leave alone.
        frappe.db.set_value(ROW_DOCTYPE, row, "settlement_reference", "HAND", update_modified=False)
        frappe.db.commit()

        backfill_settlement_reference()
        backfill_settlement_reference()

        self.assertEqual(self._resolved(row), "HAND")


# --- slice C5: what the Check step is told about the SHEET -----------------------------------------

ICICI_PREAMBLE_FIXTURE = (
    frappe.get_app_path("nirmaan_stack")
    + "/services/outflow_import/tests/fixtures/icici_preamble_sample.csv"
)
ICICI_SOURCE = "ICICI Bank Statement"


def _preamble_bytes() -> bytes:
    with open(ICICI_PREAMBLE_FIXTURE, "rb") as handle:
        return handle.read()


def _sheet_of(content: bytes, **kwargs):
    return _sheet_payload(parse_statement(content, source=ICICI_SOURCE, **kwargs))


class TestSheetPreviewBlock(unittest.TestCase):
    """The `sheet` block `preview_outflow_statement` adds for a statement with a preamble.

    Exercises `_sheet_payload` rather than the endpoint, for the reason in this module's docstring:
    the endpoint's own work above it is authorization and a multipart read, and faking those means
    asserting the fake. This is the part that decides what the picker can show.

    ⚠️ IT IS DISPLAY, AND DISPLAY ONLY. Nothing in the parse reads these numbers back. What makes
    them worth pinning is that a person CONFIRMS an import against them -- a grid that disagrees
    with the rows that were staged is worse than no preview at all.
    """

    def test_a_gateway_source_gets_no_sheet_block_at_all(self):
        """⚠️ ABSENT, NOT EMPTY, AND NOT FILLED WITH TRUE-BY-CONSTRUCTION NUMBERS. Cashfree and
        Cashbook have no layout question on their screen, and their preview payload must stay
        byte-identical to before this slice."""
        with open(FIXTURE, "rb") as handle:
            cashfree = parse_statement(handle.read(), source="Cashfree")
        self.assertIsNone(_sheet_payload(cashfree))

    def test_it_reports_where_the_table_was_found(self):
        sheet = _sheet_of(_preamble_bytes())
        self.assertEqual(sheet["detected_header_row"], 17)
        self.assertEqual(sheet["header_row_used"], 17)
        self.assertFalse(sheet["was_overridden"])
        self.assertEqual(sheet["total_sheet_rows"], 31)
        self.assertEqual(sheet["table_start_row"], 18)
        self.assertEqual(sheet["table_end_row"], 21)
        self.assertEqual(sheet["trailing_rows_ignored"], 8)

    def test_grid_index_zero_is_sheet_row_one(self):
        """⚠️ NO OFFSET FIELD, EVER. The client's whole job is mapping a row it can see to a row
        number it can post back; a second convention is how a picker selects the row above the one
        the user clicked."""
        sheet = _sheet_of(_preamble_bytes())
        self.assertEqual(sheet["grid"][0][0], "Detailed Statement")
        self.assertEqual(sheet["grid"][sheet["header_row_used"] - 1][1], "Tran. Id")

    def test_the_grid_always_contains_the_header_row_however_deep_it_is(self):
        """⚠️ THE INVARIANT THE PICKER IS BUILT ON, AND THE ONE A FIXED CAP BREAKS. A hard 60-row
        ceiling would cut a sheet whose header sits at row 70 down to 60 -- so the ONE row the whole
        screen is about would be missing from it, on precisely the sheet that needed the picker.
        There is deliberately no bound other than the sheet's own length."""
        sheet = _sheet_of(_deep_header_statement(header_row=70, data_rows=3))
        self.assertEqual(sheet["header_row_used"], 70)
        self.assertGreaterEqual(len(sheet["grid"]), 70)
        self.assertEqual(sheet["grid"][69][1], "Tran. Id")
        # The header plus a few rows of the table under it, so the choice is checkable on sight.
        self.assertEqual(len(sheet["grid"]), 73)
        self.assertFalse(sheet["grid_truncated"])

    def test_a_long_sheet_is_truncated_and_says_so(self):
        sheet = _sheet_of(_deep_header_statement(header_row=3, data_rows=200))
        self.assertEqual(len(sheet["grid"]), 60)
        self.assertTrue(sheet["grid_truncated"])
        self.assertEqual(sheet["total_sheet_rows"], 203)

    def test_a_short_sheet_is_not_truncated(self):
        sheet = _sheet_of(_preamble_bytes())
        self.assertEqual(len(sheet["grid"]), 31)
        self.assertFalse(sheet["grid_truncated"])

    def test_every_row_is_the_same_length_and_every_cell_is_a_string(self):
        """The client renders this straight into a table. A ragged grid there is an off-by-one
        column on exactly the short rows -- which, on this statement, are the preamble and the
        trailer, the two things the reader is looking at."""
        sheet = _sheet_of(_preamble_bytes())
        widths = {len(row) for row in sheet["grid"]}
        self.assertEqual(widths, {10})
        for row in sheet["grid"]:
            for cell in row:
                self.assertIsInstance(cell, str)

    def test_the_column_count_is_capped(self):
        sheet = _sheet_of(_wide_statement(columns=40))
        self.assertEqual({len(row) for row in sheet["grid"]}, {12})

    def test_a_long_cell_is_truncated_visibly_rather_than_silently(self):
        """A silent truncation would have the screen claim a cell is shorter than it is, which on a
        narration column is the difference between two similar-looking transfers."""
        long_remark = "X" * 500
        sheet = _sheet_of(_deep_header_statement(header_row=3, data_rows=1, remark=long_remark))
        cell = sheet["grid"][3][6]
        self.assertEqual(len(cell), 80)
        self.assertTrue(cell.endswith("…"))

    def test_columns_read_is_derived_from_the_adapter_and_names_both_date_columns(self):
        """⚠️ DERIVED, NEVER A SECOND HAND-WRITTEN LIST -- the screen and the parser must not be
        able to disagree about which column the date comes from. Shape is pinned in
        `test_parser.TestDescribeMappedColumns`; this is the endpoint carrying it."""
        sheet = _sheet_of(_preamble_bytes())
        date_entry = [e for e in sheet["columns_read"] if e["label"] == "Date"][0]
        self.assertEqual(
            date_entry["columns"],
            [{"header": "Transaction Date", "letter": "D"},
             {"header": "Value Date", "letter": "C"}],
        )
        self.assertEqual(date_entry["note"], "the first one that has a value")

    def test_an_override_is_reported_as_one(self):
        sheet = _sheet_of(_preamble_bytes(), header_row=17)
        self.assertTrue(sheet["was_overridden"])
        self.assertEqual(sheet["detected_header_row"], 17)
        self.assertEqual(sheet["header_row_used"], 17)


class TestPostedHeaderRow(unittest.TestCase):
    """The optional `header_row` multipart field (slice C3).

    ⚠️ IT IS READ ONCE, INSIDE THE SHARED `_read_and_parse`, AND THAT SHARING IS THE SAFETY
    PROPERTY. The preview and the upload are two requests over the same bytes, and the person
    confirming has looked at a grid rendered from ONE header row. An upload that auto-detected
    while the preview had been overridden would stage a different table from the one approved, and
    every count on the confirm screen would be about rows nobody imported.
    """

    def setUp(self):
        super().setUp()
        self.addCleanup(frappe.form_dict.pop, "header_row", None)

    def _posted(self, value):
        if value is None:
            frappe.form_dict.pop("header_row", None)
        else:
            frappe.form_dict["header_row"] = value
        return _posted_header_row()

    def test_absent_and_empty_both_mean_auto_detect(self):
        """A present-but-blank field is what a browser sends for "I did not pick one". Treating it
        as junk would refuse the ordinary case."""
        self.assertIsNone(self._posted(None))
        self.assertIsNone(self._posted(""))
        self.assertIsNone(self._posted("   "))

    def test_a_row_number_arrives_as_an_integer(self):
        self.assertEqual(self._posted("17"), 17)
        self.assertEqual(self._posted(" 17 "), 17)

    def test_junk_is_refused_by_name_rather_than_coerced(self):
        """⚠️ A SILENT `int()` FAILURE WOULD FALL BACK TO AUTO-DETECTION, which is the one outcome
        a caller who bothered to send a row number did not ask for."""
        for bad in ("0", "-4", "abc", "17.5", "seventeen"):
            with self.subTest(bad=bad):
                with self.assertRaises(frappe.ValidationError):
                    self._posted(bad)


def _deep_header_statement(header_row: int, data_rows: int, remark: str = "a payment") -> bytes:
    """A fabricated statement with its header on an arbitrary row. NOT a committed fixture.

    The real files put their header on row 17; this exists only to exercise the rules at row
    numbers no real export reaches, and building it here keeps the assertion and the shape it is
    about in one place.
    """
    import csv as _csv
    import io as _io

    buffer = _io.StringIO()
    writer = _csv.writer(buffer, quoting=_csv.QUOTE_ALL, lineterminator="\n")
    for index in range(header_row - 1):
        writer.writerow([f"Preamble line {index + 1}"])
    writer.writerow(
        ["S.N.", "Tran. Id", "Value Date", "Transaction Date", "Transaction Posted Date",
         "Cheque. No./Ref. No.", "Transaction Remarks", "Withdrawal Amt (INR)",
         "Deposit Amt (INR)", "Balance (INR)"]
    )
    for index in range(data_rows):
        writer.writerow(
            [str(index + 1), f"S9{index:07d}", "01/Jan/2026", "01/Jan/2026", "01/Jan/2026", "",
             remark, "1,000.00", "", "-1,000.00"]
        )
    return buffer.getvalue().encode()


def _wide_statement(columns: int) -> bytes:
    """A statement with more columns than the preview shows, to pin the column cap."""
    import csv as _csv
    import io as _io

    header = ["S.N.", "Tran. Id", "Value Date", "Transaction Date", "Transaction Posted Date",
              "Cheque. No./Ref. No.", "Transaction Remarks", "Withdrawal Amt (INR)",
              "Deposit Amt (INR)", "Balance (INR)"]
    header += [f"Spare {i}" for i in range(columns - len(header))]
    buffer = _io.StringIO()
    writer = _csv.writer(buffer, quoting=_csv.QUOTE_ALL, lineterminator="\n")
    writer.writerow(header)
    writer.writerow(
        ["1", "S9000001", "01/Jan/2026", "01/Jan/2026", "01/Jan/2026", "", "a payment",
         "1,000.00", "", "-1,000.00"] + ["x"] * (columns - 10)
    )
    return buffer.getvalue().encode()


class TestPreviewPayloadCarriesBothDirections(unittest.TestCase):
    """The preview payload's two gross figures, through the REAL endpoint (ticket #1287).

    ⚠️ THIS IS THE ONE CLASS HERE THAT CALLS `preview_outflow_statement` ITSELF, and it has to.
    Everything else in this module exercises `_stage_batch` for the reason in the module docstring --
    the endpoint's extra work is authorization and a multipart read. But the payload's KEYS are built
    inline in the endpoint and nowhere else, so a test one layer down would assert what the parser
    returned and never that it ARRIVES: the producer's pin and the consumer's pin can both be green
    while the join is broken (the standing cross-seam rule in `CLAUDE.md`). The multipart read is
    faked with a real `werkzeug` `FileStorage`, which is the type the endpoint actually receives, so
    the only fake is the transport.

    WRITES NOTHING -- the preview is read-only by contract, so there is nothing to purge.
    """

    def _preview(self, path: str, source: str, filename: str) -> dict:
        import io as _io

        from werkzeug.datastructures import FileStorage, MultiDict

        from nirmaan_stack.api.outflow_import.upload import preview_outflow_statement

        with open(path, "rb") as handle:
            content = handle.read()

        class _Request:
            """Only `.files` is read by `_read_and_parse`; everything else comes off form_dict."""

            files = MultiDict(
                {"file": FileStorage(stream=_io.BytesIO(content), filename=filename)}
            )

        previous_request = getattr(frappe.local, "request", None)
        previous_form = dict(frappe.form_dict)
        frappe.set_user("Administrator")
        frappe.local.request = _Request()
        frappe.form_dict["source"] = source
        frappe.form_dict.pop("header_row", None)
        try:
            return preview_outflow_statement()
        finally:
            frappe.local.request = previous_request
            frappe.local.form_dict = frappe._dict(previous_form)

    def test_an_icici_preview_reports_the_two_directions_separately(self):
        payload = self._preview(ICICI_FIXTURE, "ICICI Bank Statement", "icici.csv")
        self.assertEqual(payload["gross_amount"], 3727536.0)
        self.assertEqual(payload["gross_inflow_amount"], 5354387.0)
        # The pre-#1287 single total, asserted ABSENT from both keys.
        self.assertNotEqual(payload["gross_amount"], 9081923.0)
        self.assertNotEqual(payload["gross_inflow_amount"], 9081923.0)

    def test_an_icici_preview_reports_how_many_lines_were_money_in(self):
        """⚠️ A COUNT, NOT A DERIVATION FROM THE MONEY. The screen shows its money-in section only
        when the statement HAS money-in lines, and `gross_inflow_amount > 0` is a different question
        -- see the comment at the payload."""
        payload = self._preview(ICICI_FIXTURE, "ICICI Bank Statement", "icici.csv")
        self.assertEqual(payload["inflow_rows"], 7)

    def test_a_cashfree_preview_reports_no_money_in_at_all(self):
        """⚠️ THE UNCHANGED-SCREEN CRITERION. Cashfree cannot state a credit, so both keys are zero
        and the upload screen looks exactly as it does today. The keys are still PRESENT -- a real 0
        and an absent key are different facts, and the client checks for the key, not for truthiness.
        """
        payload = self._preview(FIXTURE, "Cashfree", "cashfree.csv")
        self.assertEqual(payload["gross_inflow_amount"], 0.0)
        self.assertEqual(payload["inflow_rows"], 0)
        # The WHOLE file, its in-file repeat included: the preview reports what the file contains,
        # while the stored batch totals only the lines it saves (#1354).
        self.assertEqual(payload["gross_amount"], 57727.5)
        self.assertEqual(payload["charges_amount"], 94.4)


if __name__ == "__main__":
    unittest.main()
