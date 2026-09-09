# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for `services.outflow_import.sources` -- what a statement SOURCE can do (slice B4).

Pure: no bench, no fixtures, no database. The DB-level behaviour these answers drive lives in
`api/outflow_import/test_review.py` (the duplicate-guard-only match run) and
`api/outflow_import/test_upload.py` (the landing status at staging).
"""

import unittest

from nirmaan_stack.services.outflow_import.duplicates import WIDE_IDENTITY_SOURCES
from nirmaan_stack.services.outflow_import.parser import SUPPORTED_SOURCES
from nirmaan_stack.services.outflow_import.sources import (
    BANK_STATEMENT_SOURCES,
    source_has_preamble,
    source_has_settlement_path,
)


class TestTheSettlementPathQuestion(unittest.TestCase):
    def test_a_gateway_export_has_one(self):
        self.assertTrue(source_has_settlement_path("Cashfree"))

    def test_a_bank_passbook_does_not(self):
        self.assertFalse(source_has_settlement_path("ICICI Bank Statement"))

    def test_every_member_of_the_set_answers_no_and_every_other_source_answers_yes(self):
        """The predicate IS the set, read the one way callers read it. Pinned both directions so a
        member added to the set without the predicate agreeing cannot pass."""
        self.assertTrue(BANK_STATEMENT_SOURCES)
        for source in SUPPORTED_SOURCES:
            self.assertEqual(
                source_has_settlement_path(source), source not in BANK_STATEMENT_SOURCES, source
            )

    def test_an_unknown_source_is_treated_as_having_one(self):
        """⚠️ THE DIRECTION OF THE DEFAULT IS THE TEST, NOT AN ACCIDENT. It keeps every gateway
        import -- and every legacy row staged before `source` was denormalised at all -- on the path
        it has always been on. Defaulting the other way would silently switch an unrecognised source
        off the tier ladder, which is a change to where money lands, announced nowhere."""
        for source in ("", "   ", None, "Some Future Gateway"):
            self.assertTrue(source_has_settlement_path(source), repr(source))

    def test_whitespace_around_a_real_source_does_not_smuggle_a_settlement_path_back_in(self):
        """The mirror of the test above, and the reason the predicate strips. A `source` read back
        out of the database is whatever was stored; a padded one must not answer `True` and quietly
        put a passbook back on the tier ladder."""
        self.assertFalse(source_has_settlement_path("  ICICI Bank Statement  "))


class TestTheSetIsSpelledTheWayEverythingElseSpellsIt(unittest.TestCase):
    def test_every_member_is_a_supported_parser_source(self):
        """⚠️ THE STRINGS ARE ALSO THE `Outflow Import Batch.source` SELECT OPTIONS. A rename that
        reaches only one of the three fails Frappe's own Select validation at upload, with nothing
        on screen explaining why."""
        self.assertTrue(set(BANK_STATEMENT_SOURCES) <= set(SUPPORTED_SOURCES))

    def test_the_api_layer_reads_this_set_rather_than_holding_a_second_one(self):
        """⚠️ THE WHOLE REASON THIS MODULE EXISTS. Until slice B4 the set was a private constant in
        `api/outflow_import/upload.py`, and `review.match_batch` needed the same answer -- so the
        alternatives were a second literal frozenset, free to drift the day a source is added, or
        one owner both may import. This asserts the fold actually happened and was not quietly
        re-forked into two copies later."""
        from nirmaan_stack.api.outflow_import import review, upload

        self.assertIs(upload._BANK_STATEMENT_SOURCES, BANK_STATEMENT_SOURCES)
        self.assertIs(review.BANK_STATEMENT_SOURCES, BANK_STATEMENT_SOURCES)

    def test_it_is_NOT_the_wide_identity_set_even_though_they_agree_today(self):
        """⚠️ THEY MUST NOT BE MERGED "because they hold the same string". `WIDE_IDENTITY_SOURCES`
        answers "what makes two lines of this statement the same line?"; this one answers "what can
        this statement's rows DO?". A source could plausibly need the wide identity without being a
        passbook, or the reverse -- and a merge would make one ruling silently change the other."""
        self.assertIsNot(BANK_STATEMENT_SOURCES, WIDE_IDENTITY_SOURCES)


class TestThePreambleQuestion(unittest.TestCase):
    """Does this source's export wrap its table in rows that are not the table? (slice C2)

    ⚠️ A SECOND CAPABILITY OVER THE SAME SET, NOT A SECOND NAME FOR THE FIRST. It happens to
    partition `SUPPORTED_SOURCES` identically today, and the two answer different questions: one is
    "what can this statement's rows DO once staged", the other is "where in the sheet IS the
    table". They are pinned separately for the same reason `WIDE_IDENTITY_SOURCES` is kept apart --
    so a future source can need one without silently acquiring the other.
    """

    def test_a_bank_passbook_has_one(self):
        self.assertTrue(source_has_preamble("ICICI Bank Statement"))

    def test_a_gateway_export_does_not(self):
        self.assertFalse(source_has_preamble("Cashfree"))
        self.assertFalse(source_has_preamble("Cashbook"))

    def test_the_predicate_is_the_set_read_both_directions(self):
        for source in SUPPORTED_SOURCES:
            self.assertEqual(
                source_has_preamble(source), source in BANK_STATEMENT_SOURCES, source
            )

    def test_an_unknown_source_keeps_the_row_one_behaviour(self):
        """⚠️ THE DIRECTION OF THIS DEFAULT IS THE OPPOSITE OF `source_has_settlement_path`'s, AND
        BOTH LEAN THE SAME WAY IN SUBSTANCE: an unrecognised source keeps doing what every source
        has always done. Here that means the header is row 1 and a blank row is skipped -- so a new
        source cannot be silently switched onto an end-at-the-first-blank-row rule that would
        truncate it with nothing on screen to say so."""
        for source in ("", "   ", None, "Some Future Gateway"):
            self.assertFalse(source_has_preamble(source), repr(source))

    def test_whitespace_around_a_real_source_does_not_lose_its_preamble(self):
        """A `source` read back out of the database is whatever was stored. A padded one that
        answered `False` would read a passbook's sixteen preamble lines as its header row."""
        self.assertTrue(source_has_preamble("  ICICI Bank Statement  "))

    def test_it_is_a_separate_question_from_the_settlement_path(self):
        """Pinned as two calls rather than one alias so that a source can later answer them
        differently without either call site quietly following the other."""
        for source in SUPPORTED_SOURCES:
            self.assertEqual(
                source_has_preamble(source), not source_has_settlement_path(source), source
            )
