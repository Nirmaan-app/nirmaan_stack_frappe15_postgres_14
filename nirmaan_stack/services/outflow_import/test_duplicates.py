# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for `duplicates.py` -- owner ruling Q2, Option B (slice V3).

Two behaviours over one threshold, and the tests exist mostly to keep them from merging into one:
a refusal is a different OUTCOME from a warning, not a louder one. A caller that treated both as
"show a message" would import a batch with nothing new in it.
"""

import unittest
from datetime import date
from decimal import Decimal

from nirmaan_stack.services.outflow_import.duplicates import (
    DUPLICATE_WARN_RATIO,
    assess_duplicates,
    dates_agree,
    row_identity,
)


class TestRowIdentity(unittest.TestCase):
    """`(transfer_id, amount, date)` -- the widened duplicate key (slice D3)."""

    def test_the_same_transfer_has_the_same_identity(self):
        a = row_identity("TXN-1", Decimal("1000.00"), date(2026, 8, 1))
        b = row_identity("TXN-1", Decimal("1000.00"), date(2026, 8, 1))
        self.assertEqual(a, b)
        # Hashable, because both duplicate checks use it as a dict/set key.
        self.assertEqual(len({a, b}), 1)

    def test_a_different_amount_is_a_different_transfer(self):
        self.assertNotEqual(
            row_identity("TXN-1", Decimal("1000.00"), date(2026, 8, 1)),
            row_identity("TXN-1", Decimal("1001.00"), date(2026, 8, 1)),
        )

    def test_a_different_date_is_a_different_transfer(self):
        self.assertNotEqual(
            row_identity("TXN-1", Decimal("1000.00"), date(2026, 8, 1)),
            row_identity("TXN-1", Decimal("1000.00"), date(2026, 8, 2)),
        )

    def test_the_amount_is_compared_EXACTLY_with_no_tolerance(self):
        # ⚠️ THE SETTLE WINDOW HAS NO BUSINESS HERE. At Rs 5 two genuinely different Rs 3
        # transfers would collapse into one identity and the second would never import.
        one_rupee_apart = (
            row_identity("TXN-1", Decimal("1000.00"), date(2026, 8, 1)),
            row_identity("TXN-1", Decimal("1001.00"), date(2026, 8, 1)),
        )
        self.assertEqual(len(set(one_rupee_apart)), 2)
        one_paisa_apart = (
            row_identity("TXN-1", Decimal("1000.00"), date(2026, 8, 1)),
            row_identity("TXN-1", Decimal("1000.01"), date(2026, 8, 1)),
        )
        self.assertEqual(len(set(one_paisa_apart)), 2)

    def test_decimal_scale_does_not_split_one_transfer_in_two(self):
        # ⚠️ THE QUIET ONE. `Decimal("1000") == Decimal("1000.00")` is True and both hash the
        # same, so a Currency column read back as 1000.0 still matches a sheet that wrote 1000.
        # If this ever became a string compare, every re-upload would import again.
        self.assertEqual(
            row_identity("TXN-1", Decimal("1000"), date(2026, 8, 1)),
            row_identity("TXN-1", Decimal("1000.00"), date(2026, 8, 1)),
        )
        self.assertEqual(
            len(
                {
                    row_identity("TXN-1", Decimal("1000"), date(2026, 8, 1)),
                    row_identity("TXN-1", Decimal("1000.00"), date(2026, 8, 1)),
                }
            ),
            1,
        )


class TestDatesAgree(unittest.TestCase):
    """The missing-date fallback (owner ruling, slice D3)."""

    def test_equal_dates_agree_and_different_ones_do_not(self):
        self.assertTrue(dates_agree(date(2026, 8, 1), date(2026, 8, 1)))
        self.assertFalse(dates_agree(date(2026, 8, 1), date(2026, 8, 2)))

    def test_a_MISSING_date_falls_back_to_id_plus_amount(self):
        # ⚠️ DELIBERATELY NOT SQL `NULL = NULL`. The parser stages a row whose Added On it could
        # not read, so under NULL semantics a sheet with unreadable dates would stop being
        # recognised on re-upload and import a SECOND time, silently. A missing date is our
        # failure to read the sheet, not evidence of a different transfer.
        self.assertTrue(dates_agree(None, date(2026, 8, 1)))
        self.assertTrue(dates_agree(date(2026, 8, 1), None))
        self.assertTrue(dates_agree(None, None))

    def test_it_is_symmetric(self):
        # Either side may be the unreadable one -- the stored row went through this same tolerant
        # parser on some earlier day.
        for left, right in (
            (None, date(2026, 8, 1)),
            (date(2026, 8, 1), date(2026, 8, 1)),
            (date(2026, 8, 1), date(2026, 8, 2)),
        ):
            self.assertEqual(dates_agree(left, right), dates_agree(right, left))


class TestRefusal(unittest.TestCase):
    def test_every_row_already_imported_is_refused(self):
        verdict = assess_duplicates(total=43, duplicates=43, earliest_batch="OFI-26-00007")
        self.assertTrue(verdict.refuse)
        self.assertFalse(verdict.warn)
        self.assertEqual(verdict.new, 0)

    def test_the_refusal_names_the_earlier_batch_and_says_nothing_was_created(self):
        """The reader's next move is to go and look at the real batch, so the message has to say
        which one. And it must state that nothing was written -- otherwise the natural reading of
        a refusal is that a half-import happened."""
        verdict = assess_duplicates(
            total=43, duplicates=43, earliest_batch="OFI-26-00007", filename="aug.xlsx"
        )
        self.assertIn("OFI-26-00007", verdict.message)
        self.assertIn("aug.xlsx", verdict.message)
        self.assertIn("no records were created", verdict.message)

    def test_the_message_stays_honest_when_no_batch_could_be_identified(self):
        """A vague 'already imported' beats naming the wrong batch."""
        verdict = assess_duplicates(total=5, duplicates=5)
        self.assertTrue(verdict.refuse)
        self.assertNotIn("batch None", verdict.message)
        self.assertNotIn("in batch", verdict.message)

    def test_one_new_row_out_of_a_thousand_is_NOT_refused(self):
        """⚠️ THE REFUSAL IS A COUNT, NOT A RATIO. A sheet 99.9% duplicated still has a transfer
        worth importing, and discarding it because the percentage looked high would lose real
        money from the ledger."""
        verdict = assess_duplicates(total=1000, duplicates=999, earliest_batch="OFI-26-00007")
        self.assertFalse(verdict.refuse)
        self.assertTrue(verdict.warn)
        self.assertEqual(verdict.new, 1)


class TestWarning(unittest.TestCase):
    def test_at_the_threshold_it_warns_without_blocking(self):
        verdict = assess_duplicates(total=10, duplicates=9, earliest_batch="OFI-26-00007")
        self.assertTrue(verdict.warn)
        self.assertFalse(verdict.refuse)

    def test_just_below_the_threshold_it_neither_warns_nor_blocks(self):
        verdict = assess_duplicates(total=100, duplicates=89)
        self.assertFalse(verdict.warn)
        self.assertFalse(verdict.refuse)

    def test_the_warning_leads_with_how_few_are_new(self):
        """It is the number the reader decides on -- 'only 3 of 43 are new' answers "is this worth
        importing", where '40 duplicates' makes them do the subtraction."""
        verdict = assess_duplicates(total=43, duplicates=40, earliest_batch="OFI-26-00007")
        self.assertTrue(verdict.message.startswith("Only 3 of 43"))

    def test_refuse_and_warn_are_never_both_set(self):
        for total, dupes in ((43, 43), (43, 40), (43, 1), (43, 0), (1, 1), (0, 0)):
            verdict = assess_duplicates(total=total, duplicates=dupes)
            self.assertFalse(
                verdict.refuse and verdict.warn, f"{dupes}/{total} set both flags"
            )


class TestOrdinaryStatements(unittest.TestCase):
    def test_no_duplicates_is_silent(self):
        verdict = assess_duplicates(total=43, duplicates=0)
        self.assertFalse(verdict.refuse)
        self.assertFalse(verdict.warn)
        self.assertEqual(verdict.message, "")

    def test_a_few_duplicates_explain_what_will_happen_to_them(self):
        verdict = assess_duplicates(total=43, duplicates=3, earliest_batch="OFI-26-00007")
        self.assertIn("staged and skipped", verdict.message)
        self.assertIn("OFI-26-00007", verdict.message)

    def test_an_empty_statement_is_not_a_hundred_percent_duplicated(self):
        """0/0 is not 100%. An empty file is a FORMAT problem, reported by the parser -- reading it
        as fully duplicated would refuse it with an explanation that is simply untrue."""
        verdict = assess_duplicates(total=0, duplicates=0)
        self.assertFalse(verdict.refuse)
        self.assertEqual(verdict.ratio, 0.0)


class TestTheThresholdIsOneConstant(unittest.TestCase):
    def test_the_documented_number_is_the_one_in_force(self):
        """Owner: "say a different number and it moves". Pinned so the constant and the behaviour
        cannot drift apart -- the docstring is not the enforcement."""
        self.assertEqual(DUPLICATE_WARN_RATIO, 0.90)
        just_under = assess_duplicates(total=100, duplicates=89)
        at_it = assess_duplicates(total=100, duplicates=90)
        self.assertFalse(just_under.warn)
        self.assertTrue(at_it.warn)


class TestDefensiveCounts(unittest.TestCase):
    def test_more_duplicates_than_rows_is_clamped_rather_than_going_negative(self):
        """A caller that double-counted must not produce a negative `new`, which would read as a
        warning about a statement with -3 new rows."""
        verdict = assess_duplicates(total=5, duplicates=9)
        self.assertEqual(verdict.duplicates, 5)
        self.assertEqual(verdict.new, 0)
        self.assertTrue(verdict.refuse)

    def test_none_counts_are_treated_as_zero(self):
        verdict = assess_duplicates(total=None, duplicates=None)
        self.assertFalse(verdict.refuse)
        self.assertFalse(verdict.warn)


class TestPurity(unittest.TestCase):
    def test_the_module_imports_neither_frappe_nor_anything_from_this_package(self):
        import inspect

        from nirmaan_stack.services.outflow_import import duplicates

        for line in inspect.getsource(duplicates).splitlines():
            stripped = line.strip()
            if stripped.startswith(("import ", "from ")):
                self.assertNotIn("frappe", stripped)
                self.assertNotIn("nirmaan_stack", stripped)


if __name__ == "__main__":
    unittest.main()
