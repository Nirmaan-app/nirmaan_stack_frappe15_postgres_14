# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Tests for the browse-list similarity ranking.

Every project fixture is a REAL name from the live master (2026-08-07), for the reason
`test_project_match` gives: the project axis leans on `ProjectIndex`, whose whole rule is "a token
identifies a project only if exactly one project uses it". A made-up list would test arithmetic and
prove nothing.

The vendor fixtures are shaped after real pairs from the vendor master -- a trading name that is a
subset of the registered name, a nickname that is not the name, and a contact person who is a
different human being entirely.
"""

import unittest
from decimal import Decimal
from pathlib import Path

from nirmaan_stack.services.outflow_import.project_match import build_project_index
from nirmaan_stack.services.outflow_import.similarity import (
    DEFAULT_SIMILARITY_POLICY,
    RecordSignals,
    SimilarityPolicy,
    build_row_signals,
    ranked_records,
    score_record,
)

LIVE_PROJECTS = [
    ("GANDHI_NAGAR-PROJ-00187", "Telus GIFT City"),
    # ⚠️ TWO IDENTICALLY NAMED FIDELITY PROJECTS. They are real, and they are what makes the
    # PARTIAL project reading testable at all: with the name claimed by two projects, neither
    # `fidelity` nor `chennai` is a distinctive keyword, so `projects_mentioned` names nothing and
    # the fallback token overlap is the only thing that can score.
    ("CHENNAI-PROJ-00200", "Fidelity Chennai"),
    ("CHENNAI-PROJ-00199", "Fidelity Chennai"),
    ("BENGALURU-PROJ-00196", "Toshiba"),
    ("LUCKNOW-PROJ-00181", "SEBI Lucknow"),
    ("BENGALURU-PROJ-00104", "Material Depot - HSR"),
    ("Hyderabad-PROJ-00189", "BOQ MEP SITE 3 TABLESPACE"),
]

INDEX = build_project_index(LIVE_PROJECTS)


def record(**over) -> RecordSignals:
    """A settleable Project Payment with nothing on it, so each test states only its own axis."""
    base = dict(
        doctype="Project Payments",
        name="PAY-00105-001",
        amount=Decimal("10000"),
        settleable=True,
    )
    base.update(over)
    return RecordSignals(**base)


class TestTheProjectAxis(unittest.TestCase):
    def test_a_named_project_scores_the_full_weight(self):
        """The strong reading: a keyword unique to one project names it outright."""
        row = build_row_signals("SOME BENEFICIARY", "payment for telus works", 10000, INDEX)
        scored = score_record(row, record(project="GANDHI_NAGAR-PROJ-00187",
                                          project_name="Telus GIFT City"))
        self.assertEqual(scored.project, DEFAULT_SIMILARITY_POLICY.PROJECT_NAMED)
        self.assertIn("the transfer names Telus GIFT City", scored.reasons)

    def test_a_shared_word_scores_the_partial_weight_and_not_the_full_one(self):
        """The partial reading, on the one shape that can produce it.

        ⚠️ THE DUPLICATE-NAME CASE IS WHAT MAKES THIS REACHABLE, and it took a failing test to see
        it. Any project whose words are unique gets NAMED outright by `ProjectIndex`, so the
        partial branch never runs for it. `Fidelity Chennai` exists TWICE in the live master, which
        means neither of its words identifies anything -- and a remark carrying only one of them
        can then score by overlap alone.
        """
        row = build_row_signals("VENDOR", "fidelity invoice settlement", 10000, INDEX)
        scored = score_record(row, record(project="CHENNAI-PROJ-00200",
                                          project_name="Fidelity Chennai"))
        self.assertGreater(scored.project, 0)
        self.assertLess(scored.project, DEFAULT_SIMILARITY_POLICY.PROJECT_NAMED)

    def test_an_unrelated_project_scores_nothing(self):
        row = build_row_signals("VENDOR", "payment against invoice 4471", 10000, INDEX)
        scored = score_record(row, record(project="BENGALURU-PROJ-00196", project_name="Toshiba"))
        self.assertEqual(scored.project, 0.0)

    def test_ambiguity_is_kept_rather_than_discarded(self):
        """⚠️ THE DELIBERATE ASYMMETRY WITH TIER 2.

        `sole_project` abstains when two projects fit; ranking boosts BOTH and lets the reviewer
        choose. Reversing this to `sole_project` would silently stop ranking every ambiguous row --
        which is the population this dialog exists for.
        """
        row = build_row_signals("VENDOR", "covering toshiba and sebi lucknow", 10000, INDEX)
        toshiba = score_record(row, record(project="BENGALURU-PROJ-00196", project_name="Toshiba"))
        sebi = score_record(row, record(project="LUCKNOW-PROJ-00181", project_name="SEBI Lucknow"))
        self.assertEqual(toshiba.project, DEFAULT_SIMILARITY_POLICY.PROJECT_NAMED)
        self.assertEqual(sebi.project, DEFAULT_SIMILARITY_POLICY.PROJECT_NAMED)


class TestTheVendorAxis(unittest.TestCase):
    def test_an_exact_name_scores_the_exact_weight(self):
        row = build_row_signals("Hakimi Hardware", "", 10000, INDEX)
        scored = score_record(row, record(vendor_name="HAKIMI HARDWARE"))
        self.assertEqual(scored.vendor, DEFAULT_SIMILARITY_POLICY.VENDOR_NAME_EXACT)
        self.assertIn("the vendor name matches exactly", scored.reasons)

    def test_a_subset_name_scores_partially(self):
        """The live shape: the statement carries a shorter form of the registered name."""
        row = build_row_signals("Md Arsad Alam", "invoice settlement", 10000, INDEX)
        scored = score_record(row, record(vendor_name="Md Arsad Alam Electrical Work"))
        self.assertGreater(scored.vendor, 0)
        self.assertLess(scored.vendor, DEFAULT_SIMILARITY_POLICY.VENDOR_NAME_EXACT)

    def test_a_missing_vendor_scores_zero_and_is_never_a_penalty(self):
        """All 68 approved Non Project Expenses have no vendor at all."""
        row = build_row_signals("SOME VENDOR", "some remark", 10000, INDEX)
        scored = score_record(row, record(doctype="Non Project Expenses", vendor_name=""))
        self.assertEqual(scored.vendor, 0.0)
        self.assertGreaterEqual(scored.total, 0.0)

    def test_the_remark_can_carry_the_vendor(self):
        """Owner decision Q3: both bank fields feed both text axes."""
        row = build_row_signals("RTGS TRANSFER", "paid to hakimi hardware", 10000, INDEX)
        scored = score_record(row, record(vendor_name="Hakimi Hardware"))
        self.assertGreater(scored.vendor, 0)


class TestTheAliasAxis(unittest.TestCase):
    def test_a_nickname_hit_scores(self):
        row = build_row_signals("SRIRAM TRADERS", "sriram traders payment", 10000, INDEX)
        scored = score_record(row, record(vendor_name="S R Enterprises",
                                          vendor_nickname="Sriram Traders"))
        self.assertGreater(scored.alias, 0)

    def test_the_better_of_the_two_is_taken_never_the_sum(self):
        """⚠️ SUMMING WOULD INVERT THE OWNER'S PRIORITY ORDER.

        A vendor whose nickname AND contact person both appear would otherwise beat a vendor whose
        real name matched exactly -- putting tier 3 above tier 2.
        """
        row = build_row_signals("RAVI KUMAR SRIRAM TRADERS", "ravi kumar sriram traders",
                                10000, INDEX)
        both = score_record(row, record(vendor_nickname="Sriram Traders",
                                        contact_person="Ravi Kumar"))
        self.assertLessEqual(both.alias, DEFAULT_SIMILARITY_POLICY.ALIAS_TOKEN_WEIGHT)


class TestTheAmountAxis(unittest.TestCase):
    def test_an_identical_amount_scores_the_exact_weight(self):
        row = build_row_signals("V", "r", Decimal("18679.00"), INDEX)
        scored = score_record(row, record(amount=Decimal("18679.00")))
        self.assertEqual(scored.amount, DEFAULT_SIMILARITY_POLICY.AMOUNT_EXACT)

    def test_the_live_rounding_case_scores_the_window_weight(self):
        """bank 18,679.00 against payment 18,678.69 -- off by 0.31, the real case from `amounts.py`."""
        row = build_row_signals("V", "r", Decimal("18679.00"), INDEX)
        scored = score_record(row, record(amount=Decimal("18678.69")))
        self.assertEqual(scored.amount, DEFAULT_SIMILARITY_POLICY.AMOUNT_WITHIN_WINDOW)

    def test_a_tds_sized_gap_scores_nothing(self):
        row = build_row_signals("V", "r", Decimal("100000"), INDEX)
        scored = score_record(row, record(amount=Decimal("98000")))
        self.assertEqual(scored.amount, 0.0)


class TestThePriorityOrder(unittest.TestCase):
    """The owner's order, and the Q1b ruling that it is weighted rather than a strict ladder."""

    def test_a_named_project_outranks_a_partial_vendor_hit(self):
        row = build_row_signals("SRI SAI ENTERPRISES", "telus works invoice", 10000, INDEX)
        by_project = score_record(row, record(name="A", project="GANDHI_NAGAR-PROJ-00187",
                                              project_name="Telus GIFT City"))
        by_vendor = score_record(row, record(name="B", vendor_name="Sri Sai Roadlines"))
        self.assertGreater(by_project.total, by_vendor.total)

    def test_a_strong_vendor_case_can_outrank_a_weak_project_hit(self):
        """⚠️ THIS IS THE WHOLE OF Q1b, AND A STRICT LADDER WOULD FAIL IT.

        The project signal comes from free-typed remark text. An exact vendor name plus a nickname
        plus an identical amount must be allowed to beat a single loose shared project word.
        """
        row = build_row_signals("Hakimi Hardware", "boq mep hakimi hardware sriram", 10000, INDEX)
        strong_vendor = score_record(row, record(name="A", vendor_name="Hakimi Hardware",
                                                 vendor_nickname="Sriram",
                                                 amount=Decimal("10000")))
        weak_project = score_record(row, record(name="B", project="Hyderabad-PROJ-00189",
                                                project_name="BOQ MEP SITE 3 TABLESPACE",
                                                amount=Decimal("10000")))
        self.assertGreater(strong_vendor.total, weak_project.total)


class TestTheSettleableSplit(unittest.TestCase):
    """Owner decision Q2. The hard split sits ABOVE the score and is not one of the axes."""

    def test_an_unsettleable_record_never_outranks_a_settleable_one(self):
        row = build_row_signals("Hakimi Hardware", "telus works", 10000, INDEX)
        looks_perfect = record(name="TDS", settleable=False, vendor_name="Hakimi Hardware",
                               project="GANDHI_NAGAR-PROJ-00187", project_name="Telus GIFT City")
        looks_like_nothing = record(name="PLAIN", settleable=True, vendor_name="", project="")

        order = [r.name for r, _ in ranked_records(row, [looks_perfect, looks_like_nothing])]
        self.assertEqual(order, ["PLAIN", "TDS"])

    def test_unsettleable_records_are_returned_and_ranked_among_themselves(self):
        """Never filtered out -- a TDS hunter must SEE the record that cannot be settled."""
        row = build_row_signals("Hakimi Hardware", "", 10000, INDEX)
        good = record(name="TDS-MATCH", settleable=False, vendor_name="Hakimi Hardware")
        poor = record(name="TDS-OTHER", settleable=False, vendor_name="Totally Different Co")

        order = [r.name for r, _ in ranked_records(row, [poor, good])]
        self.assertEqual(order, ["TDS-MATCH", "TDS-OTHER"])


class TestTheGuards(unittest.TestCase):
    def test_a_one_word_transfer_does_not_token_score(self):
        """⚠️ `MIN_SIGNIFICANT_TOKENS`, on the TRANSFER's side. A one-word transfer has nothing to
        be specific with and would score against half the ledger."""
        row = build_row_signals("Hakimi", "", 10000, INDEX)
        scored = score_record(row, record(vendor_name="Hakimi Hardware"))
        self.assertEqual(scored.vendor, 0.0)

    def test_a_one_word_record_still_scores(self):
        """The mirror case, and it must NOT be guarded: `Toshiba` is a real single-word project."""
        row = build_row_signals("TOSHIBA INDIA", "payment toshiba india", 10000, INDEX)
        scored = score_record(row, record(project="BENGALURU-PROJ-00196", project_name="Toshiba"))
        self.assertGreater(scored.project, 0)

    def test_no_project_index_falls_back_to_the_partial_reading(self):
        row = build_row_signals("V", "telus gift city payment", 10000, None)
        scored = score_record(row, record(project="GANDHI_NAGAR-PROJ-00187",
                                          project_name="Telus GIFT City"))
        self.assertGreater(scored.project, 0)
        self.assertLess(scored.project, DEFAULT_SIMILARITY_POLICY.PROJECT_NAMED)


class TestTheOrderIsTotal(unittest.TestCase):
    """⚠️ THE SORT KEY ENDS IN A UNIQUE FIELD, so the same input always gives the same list."""

    def test_equal_scores_break_deterministically_by_doctype_then_name(self):
        row = build_row_signals("NOTHING IN COMMON", "nothing at all", 10000, INDEX)
        records = [
            record(doctype="Project Payments", name="PAY-2"),
            record(doctype="Non Project Expenses", name="NPE-1"),
            record(doctype="Project Payments", name="PAY-1"),
        ]
        first = [r.name for r, _ in ranked_records(row, records)]
        shuffled = [r.name for r, _ in ranked_records(row, list(reversed(records)))]
        self.assertEqual(first, shuffled)
        self.assertEqual(first, ["NPE-1", "PAY-1", "PAY-2"])

    def test_nothing_is_filtered_out(self):
        row = build_row_signals("V", "r", 10000, INDEX)
        records = [record(name=f"PAY-{i}") for i in range(7)]
        self.assertEqual(len(ranked_records(row, records)), 7)

    def test_amount_closeness_breaks_a_score_tie_before_the_name_does(self):
        row = build_row_signals("NOTHING IN COMMON", "nothing at all", Decimal("10000"), INDEX)
        far = record(name="AAA-FAR", amount=Decimal("10004"))
        near = record(name="ZZZ-NEAR", amount=Decimal("10000"))
        order = [r.name for r, _ in ranked_records(row, [far, near])]
        self.assertEqual(order, ["ZZZ-NEAR", "AAA-FAR"])


class TestThePolicyIsSeparateFromTheMatchers(unittest.TestCase):
    """⚠️ THE RULE THIS WHOLE MODULE IS BUILT AROUND.

    These weights exist to be tuned against reviewer feedback. If they could reach the modules that
    decide what SETTLES, a tweak made because a list felt wrongly ordered would change which
    transfers move money unattended.
    """

    def test_similarity_does_not_import_a_module_that_decides_what_settles(self):
        import nirmaan_stack.services.outflow_import.similarity as similarity

        source = Path(similarity.__file__).read_text()
        for forbidden in ("import matcher", "import disambiguate", "import status",
                          "matcher import", "disambiguate import", "status import"):
            self.assertNotIn(forbidden, source, f"similarity.py must not import {forbidden!r}")

    def test_the_deciding_modules_do_not_import_similarity(self):
        from nirmaan_stack.services.outflow_import import disambiguate, matcher, status

        for module in (matcher, disambiguate, status):
            self.assertNotIn(
                "similarity",
                Path(module.__file__).read_text(),
                f"{module.__name__} must not reach the browse-list ranking",
            )

    def test_it_carries_its_own_policy_rather_than_the_matchers(self):
        from nirmaan_stack.services.outflow_import.matcher import VendorScoringPolicy

        self.assertIsNot(SimilarityPolicy, VendorScoringPolicy)
        self.assertFalse(issubclass(SimilarityPolicy, VendorScoringPolicy))


class TestPurity(unittest.TestCase):
    def test_it_runs_with_no_bench_and_no_database(self):
        """Same property `matcher.py` and `project_match.py` protect."""
        row = build_row_signals("Hakimi Hardware", "telus works", 10000, INDEX)
        self.assertGreater(score_record(row, record(vendor_name="Hakimi Hardware")).total, 0)


if __name__ == "__main__":
    unittest.main()
