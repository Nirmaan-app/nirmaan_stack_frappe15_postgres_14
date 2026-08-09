# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Tests for the tier 2 project-corroboration rule.

Every fixture below is a REAL project name, read from the live master on 2026-08-07. That matters
more than usual here: the whole rule is "a token identifies a project only if exactly one project
uses it", so a made-up project list would test the arithmetic and prove nothing about whether the
rule can actually identify anything on this company's data.
"""

import unittest

from nirmaan_stack.services.outflow_import.project_match import (
    GENERIC_PROJECT_TOKENS,
    MIN_TOKEN_LENGTH,
    build_project_index,
    distinctive_tokens,
)

# A slice of the live master. Note the two IDENTICALLY named Fidelity projects -- they are real, and
# they are the reason the "no distinctive token" case is a live concern rather than a hypothetical.
LIVE_PROJECTS = [
    ("ERNAKULAM-PROJ-00203", "EXL Kochi"),
    ("Hyderabad-PROJ-00202", "HYDERABAD Project"),
    ("Bangalore-PROJ-00201", "Style Work SGL"),
    ("RANGAREDDY-PROJ-00097", "Material Depot - Kompally"),
    ("CHENNAI-PROJ-00200", "Fidelity Chennai"),
    ("CHENNAI-PROJ-00199", "Fidelity Chennai"),
    ("GANDHI_NAGAR-PROJ-00187", "Telus GIFT City"),
    ("BENGALURU-PROJ-00192", "Cygnus 2F"),
    ("LUCKNOW-PROJ-00181", "SEBI Lucknow"),
    ("BENGALURU-PROJ-00196", "Toshiba"),
    ("BENGALURU-PROJ-00104", "Material Depot - HSR"),
    ("BENGALURU-PROJ-00098", "Ernst & Young"),
    ("Chennai-PROJ-00194", " DLF Downtown @ Chennai Project"),
    ("CHENNAI-PROJ-00198", "Upcoming project-09-Chennai-HVAC BOQ"),
    ("THIRUVANANTHAPURAM-PROJ-00193", "Upcoming Trivandrum"),
    ("LUCKNOW-PROJ-00195", "Lucknow MEP BOQ"),
    ("Hyderabad-PROJ-00189", "BOQ MEP SITE 3 TABLESPACE"),
]


class TestADistinctiveTokenIdentifiesItsProject(unittest.TestCase):
    def setUp(self):
        self.index = build_project_index(LIVE_PROJECTS)

    def test_a_one_word_project_name_is_found(self):
        self.assertEqual(self.index.sole_project("Payment to vendor for Toshiba"), "BENGALURU-PROJ-00196")

    def test_it_is_case_and_punctuation_insensitive(self):
        """The remark is free text typed by whoever made the transfer. `name_tokens` folds case and
        reduces punctuation on BOTH sides, which is the only reason these meet at all."""
        for remark in ("SEBI LUCKNOW", "sebi lucknow site", "material - sebi/lucknow"):
            self.assertEqual(self.index.sole_project(remark), "LUCKNOW-PROJ-00181", remark)

    def test_one_distinctive_word_is_enough_even_when_the_rest_is_shared(self):
        """`Material Depot - Kompally` shares "material" and "depot" with the HSR depot, so only
        "kompally" can answer -- and it is enough on its own. Requiring two distinctive words would
        make every single-word project name unreachable."""
        self.assertEqual(
            self.index.sole_project("cash for material depot kompally"), "RANGAREDDY-PROJ-00097"
        )
        self.assertEqual(
            self.index.sole_project("material depot HSR"), "BENGALURU-PROJ-00104"
        )

    def test_an_ampersand_name_resolves(self):
        # `normalize_name` turns "&" into the word "and", which is noise -- so this rests on
        # "ernst" / "young", exactly as it should.
        self.assertEqual(self.index.sole_project("ERNST & YOUNG - final"), "BENGALURU-PROJ-00098")

    def test_the_project_name_is_recoverable_for_a_note(self):
        project = self.index.sole_project("Toshiba")
        self.assertEqual(self.index.name_of(project), "Toshiba")


class TestASharedTokenIdentifiesNothing(unittest.TestCase):
    def setUp(self):
        self.index = build_project_index(LIVE_PROJECTS)

    def test_a_city_shared_by_several_projects_is_not_an_answer(self):
        """⚠️ THE CASE THE WHOLE RULE EXISTS FOR. Four of these projects say "Chennai". A remark
        saying "Chennai" names none of them, and an auto-match at Rs 5 tolerance on that basis would
        be money settled against the wrong project."""
        self.assertIsNone(self.index.sole_project("payment chennai"))
        self.assertEqual(self.index.projects_mentioned("payment chennai"), frozenset())

    def test_filler_words_from_the_names_themselves_are_not_answers(self):
        for remark in ("project", "upcoming project", "material depot", "boq payment"):
            self.assertIsNone(self.index.sole_project(remark), remark)

    def test_a_token_stops_being_an_answer_the_moment_a_second_project_uses_it(self):
        """⚠️ THE SELF-TUNING PROPERTY, AND THE REASON CITIES ARE NOT ON A HARDCODED LIST. With one
        Kochi project, "kochi" identifies it. Open a second (both of these are live) and the word
        answers nothing -- no edit, no deploy, no stale vocabulary -- while "exl" still does. Both
        halves are asserted, because the first alone would also pass against a list that simply
        never learned the word."""
        one = build_project_index([("P-1", "EXL Kochi")])
        self.assertEqual(one.sole_project("kochi"), "P-1")

        two = build_project_index([("P-1", "EXL Kochi"), ("P-2", "Madre Janus Kochi")])
        self.assertIsNone(two.sole_project("kochi"))
        self.assertEqual(two.sole_project("exl kochi"), "P-1")
        self.assertEqual(two.sole_project("madre kochi"), "P-2")

    def test_legal_form_noise_is_dropped(self):
        self.assertIsNone(self.index.sole_project("private limited company"))

    def test_two_identically_named_projects_are_both_unreachable(self):
        """⚠️ REAL DATA, NOT A HYPOTHETICAL: two live projects are both called `Fidelity Chennai`.
        Neither token can say which, so tier 2 declines and a person decides. Inventing an answer
        here would settle money against a coin flip."""
        self.assertIsNone(self.index.sole_project("Fidelity Chennai"))
        self.assertEqual(distinctive_tokens(self.index, "CHENNAI-PROJ-00200"), frozenset())
        self.assertEqual(distinctive_tokens(self.index, "CHENNAI-PROJ-00199"), frozenset())


class TestAmbiguityYieldsNothing(unittest.TestCase):
    def setUp(self):
        self.index = build_project_index(LIVE_PROJECTS)

    def test_a_remark_naming_two_projects_corroborates_neither(self):
        """⚠️ AND THE LONGER NAME DOES NOT WIN. `SEBI Lucknow` is the longer of the two names here,
        but it does not CONTAIN `Toshiba` -- preferring it would silently drop a project the remark
        plainly names. Only a name that accounts for the other may win; see the nesting test."""
        remark = "settlement covering Toshiba and SEBI Lucknow"
        self.assertEqual(
            self.index.projects_mentioned(remark),
            frozenset({"BENGALURU-PROJ-00196", "LUCKNOW-PROJ-00181"}),
        )
        self.assertIsNone(self.index.sole_project(remark))

    def test_a_nested_name_does_win_because_it_accounts_for_the_other(self):
        """The other side of the same rule, and both projects are live: `Fujitsu` and
        `Fujitsu Chennai`. A remark naming both words means the more specific one, because every
        word that made the shorter name match is still accounted for by the longer."""
        index = build_project_index([("P-SHORT", "Fujitsu"), ("P-LONG", "Fujitsu Chennai")])
        self.assertEqual(index.sole_project("payment fujitsu chennai"), "P-LONG")
        # And the bare word still means the project actually called that.
        self.assertEqual(index.sole_project("payment fujitsu"), "P-SHORT")

    def test_the_ambiguity_is_visible_rather_than_swallowed(self):
        """`projects_mentioned` reports what it found so a caller can explain itself; `sole_project`
        applies the rule. Two functions because "I found two" and "I have no answer" are different
        facts, and collapsing them would hide the first."""
        self.assertEqual(len(self.index.projects_mentioned("Toshiba, Cygnus")), 2)


class TestTheGenericWordList(unittest.TestCase):
    """⚠️ THE EXCEPTION TO "COUNTING IS ENOUGH", AND THE CASE THAT PROVED IT NECESSARY.

    Uniqueness measures rarity in the MASTER, never commonness in ENGLISH. `BOQ MEP SITE 3
    TABLESPACE` is the only live project naming "site", so counting alone promoted a prose word to
    an identifier -- and the two failures below both showed up on the first run against real names.
    """

    def setUp(self):
        self.index = build_project_index(LIVE_PROJECTS)

    def test_a_generic_word_does_not_poison_a_remark_that_names_a_real_project(self):
        # Before the list: "site" hit BOQ MEP SITE, "sebi" hit SEBI Lucknow, two projects were
        # named, and a perfectly clear remark corroborated nothing.
        self.assertEqual(self.index.sole_project("sebi lucknow site"), "LUCKNOW-PROJ-00181")

    def test_a_remark_of_generic_words_alone_names_nothing(self):
        # And the dangerous half: this would otherwise have corroborated BOQ MEP SITE outright.
        for remark in ("payment for site work", "new office", "material for the tower"):
            self.assertIsNone(self.index.sole_project(remark), remark)

    def test_the_list_holds_no_place_names(self):
        """The list is generic NOUNS only. Cities are handled by counting, better and for free --
        adding one here would be maintenance that buys nothing and would suppress a genuinely
        single-city name."""
        for place in ("chennai", "kochi", "lucknow", "bengaluru", "hyderabad", "trivandrum"):
            self.assertNotIn(place, GENERIC_PROJECT_TOKENS)

    def test_a_project_named_entirely_from_generic_words_has_no_keyword(self):
        """`New Office` can never be named by a KEYWORD -- neither word may identify anything on its
        own, which is the whole point of the list. Step 1 can still find it, but only from a remark
        containing the name in full, which is a much higher bar than the word "office"."""
        index = build_project_index([("P-1", "New Office"), ("P-2", "Toshiba")])
        self.assertEqual(distinctive_tokens(index, "P-1"), frozenset())
        self.assertIsNone(index.sole_project("office"))
        self.assertIsNone(index.sole_project("new furniture"))
        self.assertEqual(index.sole_project("payment for the new office"), "P-1")


class TestTokensThatMustNeverMatch(unittest.TestCase):
    def setUp(self):
        self.index = build_project_index(LIVE_PROJECTS)

    def test_a_short_fragment_is_dropped(self):
        """"2F" is a real part of `Cygnus 2F` and far too collidable to stake a match on."""
        self.assertIsNone(self.index.sole_project("2F"))
        self.assertNotIn("2f", distinctive_tokens(self.index, "BENGALURU-PROJ-00192"))
        self.assertEqual(self.index.sole_project("cygnus"), "BENGALURU-PROJ-00192")

    def test_a_bare_number_is_dropped(self):
        """A remark carries invoice numbers, PO numbers and amounts. A digit run agreeing with the
        "09" in a project name is a coincidence, not evidence."""
        self.assertIsNone(self.index.sole_project("inv 09 dated 12-07"))

    def test_the_minimum_length_is_stated_once(self):
        self.assertEqual(MIN_TOKEN_LENGTH, 3)


class TestEdges(unittest.TestCase):
    def test_an_empty_remark_names_nothing(self):
        index = build_project_index(LIVE_PROJECTS)
        for remark in ("", "   ", None):
            self.assertIsNone(index.sole_project(remark), repr(remark))

    def test_an_empty_index_names_nothing_rather_than_raising(self):
        index = build_project_index([])
        self.assertIsNone(index.sole_project("Toshiba"))
        self.assertEqual(index.projects_mentioned("Toshiba"), frozenset())

    def test_a_project_with_a_blank_name_is_carried_but_unreachable(self):
        index = build_project_index([("PROJ-1", ""), ("PROJ-2", "Toshiba")])
        self.assertEqual(distinctive_tokens(index, "PROJ-1"), frozenset())
        self.assertEqual(index.sole_project("Toshiba"), "PROJ-2")

    def test_a_project_with_no_id_is_skipped(self):
        index = build_project_index([("", "Toshiba")])
        self.assertIsNone(index.sole_project("Toshiba"))

    def test_name_of_falls_back_to_the_id_and_tolerates_none(self):
        index = build_project_index(LIVE_PROJECTS)
        self.assertEqual(index.name_of("NOT-A-PROJECT"), "NOT-A-PROJECT")
        self.assertEqual(index.name_of(None), "")


class TestPurity(unittest.TestCase):
    def test_it_imports_no_frappe_and_only_the_normalize_leaf(self):
        """Same property `matcher.py` protects: this stays callable from a plain unittest with no
        bench, no site and no fixtures."""
        import inspect

        from nirmaan_stack.services.outflow_import import project_match

        for line in inspect.getsource(project_match).splitlines():
            stripped = line.strip()
            if stripped.startswith(("import ", "from ")):
                self.assertNotIn("frappe", stripped)
                if "nirmaan_stack" in stripped:
                    self.assertIn("outflow_import.normalize", stripped)


if __name__ == "__main__":
    unittest.main()
