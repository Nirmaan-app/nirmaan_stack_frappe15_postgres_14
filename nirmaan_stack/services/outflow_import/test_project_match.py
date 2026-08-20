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


# The three live projects that made the petty-cash statement misread, plus the ones they collided
# with. Real names, read from the live master on 2026-08-13.
CASHBOOK_PROJECTS = [
    ("BENGALURU-PROJ-00091", "VR Mall Food Court"),
    ("Gurugram-PROJ-00010", "Wakefit - Airia Mall"),
    ("BENGALURU-PROJ-00103", "Paytm Bangalore"),
    ("Bengaluru-PROJ-00007", "Adept Pro"),
    ("GANDHI_NAGAR-PROJ-00187", "Telus GIFT City"),
    ("BENGALURU-PROJ-00072", "Other Old Projects"),
    ("BENGALURU-PROJ-00098", "Ernst & Young"),
    ("THRISSUR-PROJ-00105", "Qburst"),
]

VR_MALL = "BENGALURU-PROJ-00091"
PAYTM = "BENGALURU-PROJ-00103"
TELUS = "GANDHI_NAGAR-PROJ-00187"
QBURST = "THRISSUR-PROJ-00105"
ERNST = "BENGALURU-PROJ-00098"


class TestTheWordsAddedForPettyCash(unittest.TestCase):
    """`food`, `pro` and `old` (2026-08-13).

    A wallet statement's free text is far looser than a bank export's, and three ordinary English
    words turned out to be owned by exactly one project each -- so each of them was quietly
    identifying that project on remarks that had nothing to do with it.
    """

    def setUp(self):
        self.index = build_project_index(CASHBOOK_PROJECTS)

    def test_food_no_longer_drags_in_the_food_court(self):
        """"Food expenses paytm project" named Paytm AND `VR Mall Food Court`, so it named neither.

        Five rows in a 115-row statement were lost to this one word.
        """
        self.assertEqual(self.index.sole_project("Food expenses paytm project"), PAYTM)

    def test_pro_no_longer_drags_in_adept_pro(self):
        """"pro" is how people abbreviate "project" halfway through typing a remark."""
        self.assertEqual(
            self.index.sole_project("Locally purchased sample cabletray Telus pro"), TELUS
        )

    def test_old_no_longer_books_an_office_errand_to_a_real_project(self):
        """⚠️ THIS ONE REMOVES A MATCH, AND THAT IS THE IMPROVEMENT.

        "Rapido charges new office to old" was being booked to `Other Old Projects` on the strength
        of the word "old". A count of matches cannot tell a right match from a wrong one, so this
        change reads as a loss in every aggregate and is the most valuable of the three.
        """
        self.assertIsNone(self.index.sole_project("Rapido charges new office to old"))

    def test_court_was_considered_and_deliberately_left_out(self):
        """⚠️ A NEGATIVE PIN, so nobody "completes the set" later.

        `court` was proposed alongside the other three and measured at +0 matched, +0 ambiguous --
        no remark says it. Adding a word that changes nothing still suppresses a keyword that might
        one day matter, and still costs the next reader the time to work out why it is there.
        """
        self.assertNotIn("court", GENERIC_PROJECT_TOKENS)

    def test_a_project_named_after_a_now_generic_word_is_still_reachable_by_its_full_name(self):
        """Step 1 does not consult the generic list, which is what keeps these projects findable."""
        self.assertEqual(self.index.sole_project("purchase for vr mall food court"), VR_MALL)


class TestCuratedAliases(unittest.TestCase):
    """Step 1.5: a hand-written statement that a phrase means a project.

    It exists for the three things no rule over the project master can reach -- a project known by
    a name it is not recorded under, an initialism shorter than a token, and a habitual
    misspelling. All three are facts about how people write, not about the master.
    """

    def setUp(self):
        self.aliases = [
            ("VR Mall", VR_MALL),
            ("EY", ERNST),
            ("tekus", TELUS),
            ("Qubest", QBURST),
        ]
        self.index = build_project_index(CASHBOOK_PROJECTS, aliases=self.aliases)

    def test_no_aliases_is_the_default_and_changes_nothing(self):
        plain = build_project_index(CASHBOOK_PROJECTS)
        self.assertEqual(plain.aliases, {})
        self.assertIsNone(plain.sole_project("Locally purchased for VR mall"))

    def test_a_project_known_by_a_shorter_name_is_reached(self):
        """`VR Mall Food Court` is written "VR mall" by everyone who spends money on it.

        No rule over the master can get there: "mall" is shared with `Wakefit - Airia Mall`, and
        "vr" is below `MIN_TOKEN_LENGTH`. Six rows in one statement.
        """
        for remark in ("Locally purchased for VR mall", "Local purchase VR MALL", "Vr mall local purchase"):
            self.assertEqual(self.index.sole_project(remark), VR_MALL, remark)

    def test_an_initialism_shorter_than_a_token_is_reached(self):
        self.assertEqual(self.index.sole_project("EY site transportation"), ERNST)

    def test_a_habitual_misspelling_is_reached(self):
        self.assertEqual(
            self.index.sole_project("Material unloading and shifting charges tekus"), TELUS
        )
        self.assertEqual(self.index.sole_project("Qubest site printout"), QBURST)

    def test_an_alias_matches_on_word_boundaries_not_anywhere_in_the_text(self):
        """⚠️ THE REASON SHORT ALIASES ARE SAFE AT ALL.

        "ey" sits inside "they", "money", "survey" and "journey". Padding both sides with a space
        is what stops a two-letter alias claiming a quarter of the English language.
        """
        for remark in ("they collected it", "money paid at site", "survey charges", "journey fare"):
            self.assertIsNone(self.index.sole_project(remark), remark)

    def test_an_alias_is_matched_as_a_phrase_rather_than_as_tokens(self):
        """⚠️ TOKENISING AN ALIAS WOULD SILENTLY WIDEN IT.

        `comparable_tokens("VR Mall")` is `{mall}` -- "vr" is too short to survive -- and `{mall}`
        is inside any remark about `Wakefit - Airia Mall` too. The alias would then mean something
        its author never wrote: this remark would be booked to the food court.
        """
        self.assertEqual(self.index.sole_project("purchase for airia mall"), "Gurugram-PROJ-00010")
        self.assertNotEqual(self.index.sole_project("purchase for airia mall"), VR_MALL)

    def test_punctuation_between_the_words_does_not_break_it(self):
        self.assertEqual(self.index.sole_project("purchase for VR-Mall"), VR_MALL)

    def test_a_full_project_name_in_the_remark_still_wins(self):
        """Step 1 keeps precedence: an actual recorded name is at least as specific as an alias."""
        index = build_project_index(CASHBOOK_PROJECTS, aliases=[("VR Mall", PAYTM)])
        self.assertEqual(index.sole_project("spend at vr mall food court"), VR_MALL)

    def test_an_alias_beats_a_bare_keyword(self):
        """Somebody wrote the alias down deliberately; a unique keyword is only an accident of the
        master. Here "qburst" would answer on its own, and the alias agrees -- the ordering is what
        matters, and it is pinned by the precedence test above and this one together."""
        self.assertEqual(self.index.sole_project("Qubest site printout"), QBURST)

    def test_two_aliases_naming_two_projects_name_neither(self):
        index = build_project_index(
            CASHBOOK_PROJECTS, aliases=[("VR Mall", VR_MALL), ("tekus", TELUS)]
        )
        self.assertIsNone(index.sole_project("VR mall and tekus materials"))

    def test_one_phrase_claimed_by_two_projects_is_dropped_entirely(self):
        """The same rule a contested keyword follows -- not weighted, not tie-broken, dropped."""
        index = build_project_index(
            CASHBOOK_PROJECTS, aliases=[("northside", VR_MALL), ("northside", TELUS)]
        )
        self.assertEqual(index.aliases, {})
        self.assertIsNone(index.sole_project("northside materials"))

    def test_an_alias_for_a_project_outside_the_list_is_dropped(self):
        """⚠️ THE CALLER'S SCOPE WINS.

        The project list is already filtered -- to `Won` projects, for the petty-cash import -- so
        an alias pointing outside it would let a phrase reach a project the caller deliberately
        excluded.
        """
        index = build_project_index(CASHBOOK_PROJECTS, aliases=[("somewhere", "NOT-A-PROJECT")])
        self.assertEqual(index.aliases, {})
        self.assertIsNone(index.sole_project("somewhere materials"))

    def test_a_blank_alias_phrase_is_ignored(self):
        index = build_project_index(CASHBOOK_PROJECTS, aliases=[("   ", VR_MALL), ("", TELUS)])
        self.assertEqual(index.aliases, {})

    def test_the_ambiguity_is_visible_rather_than_swallowed(self):
        index = build_project_index(
            CASHBOOK_PROJECTS, aliases=[("VR Mall", VR_MALL), ("tekus", TELUS)]
        )
        self.assertEqual(
            index.projects_mentioned("VR mall and tekus materials"), frozenset({VR_MALL, TELUS})
        )


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
