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
    PriorSighting,
    assess_duplicates,
    dates_agree,
    WIDE_IDENTITY_SOURCES,
    find_prior_sighting,
    index_prior_sightings,
    row_identity,
    row_identity_of,
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


class TestPriorSightings(unittest.TestCase):
    """The lookup both Cashbook duplicate checks run through (slice CB-DUP).

    It replaced an exact-triple `dict` on the Cashbook path, and the whole reason it exists is that
    a `dict` can only compare the date with `==` -- which is precisely what `dates_agree` refuses.
    """

    def _index(self, *entries):
        return index_prior_sightings(entries)

    def test_an_exact_triple_is_found(self):
        index = self._index(("OBO1", Decimal("250"), date(2026, 8, 1), "BATCH-A"))
        self.assertEqual(
            find_prior_sighting(index, "OBO1", Decimal("250"), date(2026, 8, 1)), "BATCH-A"
        )

    def test_a_stored_row_with_no_date_still_matches_a_dated_one(self):
        """GAP 1. The parser tolerates an unreadable Added On, so the stored side may be `None`.

        Under `NULL = NULL is false` this row would import a SECOND time, silently.
        """
        index = self._index(("OBO1", Decimal("250"), None, "BATCH-A"))
        self.assertEqual(
            find_prior_sighting(index, "OBO1", Decimal("250"), date(2026, 8, 1)), "BATCH-A"
        )

    def test_an_incoming_row_with_no_date_still_matches_a_stored_dated_one(self):
        """GAP 1, the other side. Either may be the unreadable one -- `dates_agree` is symmetric."""
        index = self._index(("OBO1", Decimal("250"), date(2026, 8, 1), "BATCH-A"))
        self.assertEqual(find_prior_sighting(index, "OBO1", Decimal("250"), None), "BATCH-A")

    def test_two_missing_dates_still_match(self):
        index = self._index(("OBO1", Decimal("250"), None, "BATCH-A"))
        self.assertEqual(find_prior_sighting(index, "OBO1", Decimal("250"), None), "BATCH-A")

    def test_a_different_amount_is_a_different_transfer(self):
        """No tolerance, ever. At Rs 5 two genuinely different Rs 3 transfers would collapse."""
        index = self._index(("OBO1", Decimal("250"), date(2026, 8, 1), "BATCH-A"))
        self.assertIsNone(
            find_prior_sighting(index, "OBO1", Decimal("251"), date(2026, 8, 1))
        )

    def test_a_different_date_is_a_different_transfer_when_both_are_known(self):
        """The fallback rescues a MISSING date. It does not make the date stop mattering."""
        index = self._index(("OBO1", Decimal("250"), date(2026, 8, 1), "BATCH-A"))
        self.assertIsNone(
            find_prior_sighting(index, "OBO1", Decimal("250"), date(2026, 8, 2))
        )

    def test_the_first_agreeing_sighting_wins(self):
        """GAP 3. The caller hands them over earliest-first, so the message names the ORIGIN."""
        index = self._index(
            ("OBO1", Decimal("250"), date(2026, 8, 1), "BATCH-EARLY"),
            ("OBO1", Decimal("250"), date(2026, 8, 1), "BATCH-LATE"),
        )
        self.assertEqual(
            find_prior_sighting(index, "OBO1", Decimal("250"), date(2026, 8, 1)), "BATCH-EARLY"
        )

    def test_a_non_agreeing_sighting_is_stepped_over_to_reach_an_agreeing_one(self):
        """Same bucket, different dates -- the walk must not stop at the first entry."""
        index = self._index(
            ("OBO1", Decimal("250"), date(2026, 7, 1), "BATCH-OTHER"),
            ("OBO1", Decimal("250"), date(2026, 8, 1), "BATCH-RIGHT"),
        )
        self.assertEqual(
            find_prior_sighting(index, "OBO1", Decimal("250"), date(2026, 8, 1)), "BATCH-RIGHT"
        )

    def test_a_blank_transfer_id_is_never_indexed_and_never_matches(self):
        """Otherwise every reference-less record shares one bucket keyed on the amount alone, and a
        duplicate verdict would rest on no identity at all."""
        index = index_prior_sightings([("", Decimal("250"), date(2026, 8, 1), "BATCH-A")])
        self.assertEqual(index, {})
        self.assertIsNone(find_prior_sighting(index, "", Decimal("250"), date(2026, 8, 1)))

    def test_an_empty_corpus_finds_nothing(self):
        self.assertIsNone(
            find_prior_sighting({}, "OBO1", Decimal("250"), date(2026, 8, 1))
        )

    def test_the_sighting_carries_its_label_verbatim(self):
        """The label is opaque -- a batch id from one corpus, a ledger and record name from another.
        This module must not parse it."""
        index = index_prior_sightings(
            [("OBO1", Decimal("250"), None, "Non Project Expenses 7u93vm8hhe")]
        )
        self.assertEqual(
            index[("OBO1", Decimal("250"))],
            (PriorSighting(added_on_date=None, label="Non Project Expenses 7u93vm8hhe"),),
        )


class _Row:
    """A `RawRow`-shaped stand-in. The identity reads by ATTRIBUTE and never by type."""

    def __init__(self, transfer_id, amount, added_on_date, direction="", remarks=""):
        self.transfer_id = transfer_id
        self.amount = amount
        self.added_on_date = added_on_date
        self.direction = direction
        self.remarks = remarks


class TestSourceAwareIdentity(unittest.TestCase):
    """The identity WIDENS for a bank passbook and stays the proven triple elsewhere (slice B3).

    Two halves, and the second is the one that matters most: the widening is worth nothing if it
    also moved Cashfree and Cashbook, which carry live settled data whose duplicate behaviour is
    proven in production.
    """

    DATE = date(2026, 3, 18)

    def test_a_gateway_source_keeps_the_triple_byte_for_byte(self):
        """Cashfree and Cashbook are UNMOVED, even when handed the extra fields.

        Passing `direction` and `remarks` for a source outside `WIDE_IDENTITY_SOURCES` must be
        INERT, not merely unusual -- a caller that threads them uniformly (as `row_identity_of`
        does) would otherwise change the key for every source at once.
        """
        triple = ("TXN-1", Decimal("1000.00"), self.DATE)
        for source in ("Cashfree", "Cashbook", ""):
            with self.subTest(source=source):
                self.assertEqual(
                    row_identity("TXN-1", Decimal("1000.00"), self.DATE, source=source),
                    triple,
                )
                self.assertEqual(
                    row_identity(
                        "TXN-1", Decimal("1000.00"), self.DATE,
                        source=source, direction="Debit", remarks="anything at all",
                    ),
                    triple,
                )

    def test_the_default_source_is_the_triple(self):
        """No source argument at all is the legacy key -- what every pre-B3 caller gets."""
        self.assertEqual(
            row_identity("TXN-1", Decimal("1000.00"), self.DATE),
            ("TXN-1", Decimal("1000.00"), self.DATE),
        )

    def test_the_wide_key_extends_the_triple_rather_than_reordering_it(self):
        """The first three positions stay the triple, in order, so the two shapes read side by side.

        Only the SET of fields was measured -- a tuple's distinct count does not depend on member
        order -- so the extension form is chosen for legibility and costs nothing.
        """
        wide = row_identity(
            "TXN-1", Decimal("1000.00"), self.DATE,
            source="ICICI Bank Statement", direction="Debit", remarks="SGST Coll",
        )
        self.assertEqual(len(wide), 5)
        self.assertEqual(wide[:3], ("TXN-1", Decimal("1000.00"), self.DATE))
        self.assertEqual(wide[3:], ("Debit", "SGST Coll"))

    def test_remarks_separate_the_sgst_and_cgst_legs(self):
        """THE MEASURED `remarks` FAILURE: four pairs, Rs 18,630 each, on the real statement.

        Same id, same date, same amount, same direction -- differing only in narration. Both legs
        are an INGEST category, so on the triple the second is swallowed as an in-file repeat and
        the money it represents never reaches a reviewer.
        """
        sgst = ("S742905000271", Decimal("18630.00"), self.DATE, "Debit", "742905000271:SGST Coll")
        cgst = ("S742905000271", Decimal("18630.00"), self.DATE, "Debit", "742905000271:CGST Coll")
        self.assertNotEqual(
            row_identity(*sgst[:3], source="ICICI Bank Statement", direction=sgst[3], remarks=sgst[4]),
            row_identity(*cgst[:3], source="ICICI Bank Statement", direction=cgst[3], remarks=cgst[4]),
        )
        # And on the triple they collapse -- which is the failure, stated as a fact.
        self.assertEqual(
            row_identity(*sgst[:3], source="Cashfree", direction=sgst[3], remarks=sgst[4]),
            row_identity(*cgst[:3], source="Cashfree", direction=cgst[3], remarks=cgst[4]),
        )

    def test_direction_separates_the_two_legs_of_a_general_ledger_transfer(self):
        """THE MEASURED `direction` FAILURE: Rs 3.19 Cr out and Rs 3.19 Cr back, same narration.

        `Ac xfr from gl 05051 to 60010` is BYTE-IDENTICAL on both legs, so remarks cannot separate
        them. Only which money column the bank filled in can. This is why neither extra field is
        padding for the other.
        """
        narration = "Ac xfr from gl 05051 to 60010"
        self.assertNotEqual(
            row_identity(
                "S63876527", Decimal("31900000.00"), self.DATE,
                source="ICICI Bank Statement", direction="Debit", remarks=narration,
            ),
            row_identity(
                "S63876527", Decimal("31900000.00"), self.DATE,
                source="ICICI Bank Statement", direction="Credit", remarks=narration,
            ),
        )

    def test_row_identity_of_reads_the_row_and_delegates(self):
        row = _Row("TXN-1", Decimal("5.00"), self.DATE, direction="Credit", remarks="narration")
        self.assertEqual(
            row_identity_of(row, "ICICI Bank Statement"),
            row_identity(
                "TXN-1", Decimal("5.00"), self.DATE,
                source="ICICI Bank Statement", direction="Credit", remarks="narration",
            ),
        )
        self.assertEqual(row_identity_of(row, "Cashfree"), ("TXN-1", Decimal("5.00"), self.DATE))

    def test_row_identity_of_tolerates_a_row_that_predates_direction(self):
        """Every caller that builds a `RawRow`-shaped object by hand predates the field."""

        class Legacy:
            transfer_id = "TXN-1"
            amount = Decimal("5.00")
            added_on_date = None
            remarks = ""

        self.assertEqual(
            row_identity_of(Legacy(), "ICICI Bank Statement"),
            ("TXN-1", Decimal("5.00"), None, "", ""),
        )

    def test_a_none_direction_or_remark_reads_as_blank_rather_than_none(self):
        """`None` and `""` must not be two different identities for the same absent fact."""
        row = _Row("TXN-1", Decimal("5.00"), self.DATE, direction=None, remarks=None)
        self.assertEqual(row_identity_of(row, "ICICI Bank Statement"), ("TXN-1", Decimal("5.00"), self.DATE, "", ""))


class TestSourceVocabulary(unittest.TestCase):
    """`WIDE_IDENTITY_SOURCES` holds `parser.SUPPORTED_SOURCES` members, spelled the parser's way.

    ⚠️ THIS PIN IS THE WHOLE SAFETY OF THE CONSTANT. `duplicates` cannot import `parser` -- the
    arrow runs the other way -- so the source name is a bare string here, and a rename that reaches
    only one file would silently revert that source to the narrow triple: no error, no failing
    import, just five rows a statement quietly lost again. The test can import both, so it does.
    """

    def test_every_wide_source_is_a_source_the_parser_knows(self):
        from nirmaan_stack.services.outflow_import.parser import SUPPORTED_SOURCES

        self.assertTrue(WIDE_IDENTITY_SOURCES)
        for source in WIDE_IDENTITY_SOURCES:
            with self.subTest(source=source):
                self.assertIn(source, SUPPORTED_SOURCES)

    def test_the_gateway_sources_are_deliberately_absent(self):
        """Their duplicate behaviour is proven on live settled data; this slice must not move it."""
        self.assertNotIn("Cashfree", WIDE_IDENTITY_SOURCES)
        self.assertNotIn("Cashbook", WIDE_IDENTITY_SOURCES)


class TestIdentityAgainstTheRealStatementShape(unittest.TestCase):
    """The measurement, re-run over the ICICI fixture: the triple loses rows, the wide key does not.

    The fixture reproduces both collision shapes from the real 1,274-row statement -- an SGST/CGST
    pair and both legs of a general-ledger transfer -- so this is the end-to-end form of the table
    in `row_identity`'s docstring rather than a restatement of it.
    """

    @classmethod
    def setUpClass(cls):
        import os

        from nirmaan_stack.services.outflow_import.parser import parse_statement

        fixture = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "tests", "fixtures", "icici_sample.csv"
        )
        with open(fixture, "rb") as handle:
            cls.parsed = parse_statement(handle.read(), source="ICICI Bank Statement")

    def test_the_wide_key_keeps_every_row_distinct(self):
        identities = {row_identity_of(row, "ICICI Bank Statement") for row in self.parsed.rows}
        self.assertEqual(len(identities), len(self.parsed.rows))

    def test_the_triple_would_lose_two_of_this_fixture_s_rows(self):
        """Stated as a LOSS, not as a count. Each collision is a real line a reviewer never sees."""
        identities = {row_identity_of(row, "Cashfree") for row in self.parsed.rows}
        self.assertEqual(len(self.parsed.rows) - len(identities), 2)


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
