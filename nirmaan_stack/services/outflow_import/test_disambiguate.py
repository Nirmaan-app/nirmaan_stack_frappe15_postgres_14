"""Unit tests for `disambiguate` -- Option B, the three rules that separate several records.

No bench needed:
    python -m unittest discover -s nirmaan_stack/services/outflow_import -t . -p "test_*.py"
"""

import unittest
from datetime import date, timedelta
from decimal import Decimal

from nirmaan_stack.services.outflow_import import disambiguate as _disambiguate
from nirmaan_stack.services.outflow_import.disambiguate import (
    NEAREST_DATE_WINDOW_DAYS,
    RULE_INTERCHANGEABLE,
    RULE_NEAREST_AMOUNT,
    RULE_NEAREST_DATE,
    RULE_PROJECT_IN_REMARK,
    Candidate,
    pick_from_several,
    pick_note,
)

PAY = "Project Payments"
EXP = "Project Expenses"
D = Decimal

MOVED = date(2026, 8, 11)


def _on(days: int) -> date:
    """A decision date `days` away from the day the money moved."""
    return MOVED + timedelta(days=days)


class _Index:
    """A stand-in for `ProjectIndex` -- the real one is covered by `test_project_match`."""

    def __init__(self, mapping=None):
        self.mapping = mapping or {}

    def sole_project(self, remark):
        return self.mapping.get((remark or "").strip())


def _c(name, amount, project="PROJ-1"):
    return Candidate(doctype=PAY, name=name, amount=D(str(amount)), project=project)


def _dc(name, amount, gap_days, project="PROJ-1", doctype=PAY):
    """A candidate carrying a decision date `gap_days` from the day the money moved."""
    return Candidate(
        doctype=doctype,
        name=name,
        amount=D(str(amount)),
        project=project,
        decided_on=_on(gap_days),
    )


def _pick(candidates, *, bank="1000", remark="", index=None, claimed=frozenset(),
          allow_interchangeable=True, transfer_date=None):
    return pick_from_several(
        bank_amount=D(bank),
        candidates=candidates,
        remark=remark,
        project_index=index,
        claimed=claimed,
        allow_interchangeable=allow_interchangeable,
        transfer_date=transfer_date,
    )


class TestItAbstains(unittest.TestCase):
    def test_no_candidates(self):
        self.assertIsNone(_pick([]))

    def test_every_candidate_already_claimed(self):
        cands = [_c("A", 1000), _c("B", 1000)]
        self.assertIsNone(_pick(cands, claimed={(PAY, "A"), (PAY, "B")}))

    def test_candidates_on_different_projects_with_no_remark_evidence(self):
        """The honest 11. Nothing here says which job the money was for."""
        cands = [_c("A", 1000, "PROJ-1"), _c("B", 1000, "PROJ-2")]
        self.assertIsNone(_pick(cands))

    def test_a_blank_project_fails_the_single_project_fence(self):
        """⚠️ A missing value must never stand in for evidence. Two candidates that agree only in
        having no project are not "on the same project"."""
        cands = [_c("A", 1000, ""), _c("B", 1000, "")]
        self.assertIsNone(_pick(cands))

    def test_one_blank_among_several_also_fails_it(self):
        cands = [_c("A", 1000, "PROJ-1"), _c("B", 1000, "")]
        self.assertIsNone(_pick(cands))

    def test_equidistant_amounts_on_one_project_are_not_a_nearest(self):
        """1,000.50 and 999.50 are both 50 paise from 1,000. Neither is nearer."""
        cands = [_c("A", "1000.50"), _c("B", "999.50")]
        self.assertIsNone(_pick(cands, bank="1000"))


class TestM1ProjectInRemark(unittest.TestCase):
    INDEX = _Index({"Zephyrline services": "PROJ-2"})

    def test_it_picks_the_only_candidate_on_the_named_project(self):
        cands = [_c("A", 1000, "PROJ-1"), _c("B", 1000, "PROJ-2")]
        pick = _pick(cands, remark="Zephyrline services", index=self.INDEX)
        self.assertEqual((pick.name, pick.rule), ("B", RULE_PROJECT_IN_REMARK))

    def test_it_is_the_only_rule_allowed_to_cross_projects(self):
        """M2 and M3 are fenced to one project. M1 holds evidence about WHICH project, so it is the
        one rule that may act when they differ."""
        cands = [_c("A", "1000.00", "PROJ-1"), _c("B", "1000.90", "PROJ-2")]
        self.assertIsNotNone(_pick(cands, remark="Zephyrline services", index=self.INDEX))

    def test_two_candidates_on_the_named_project_stops_it(self):
        """Naming the project narrows the set; it does not choose within it."""
        cands = [_c("A", 1000, "PROJ-2"), _c("B", 1000, "PROJ-2"), _c("C", 1000, "PROJ-2")]
        pick = _pick(cands, remark="Zephyrline services", index=self.INDEX)
        # Falls through to the single-project rules, which is correct -- but NOT via M1.
        self.assertNotEqual(pick.rule, RULE_PROJECT_IN_REMARK)

    def test_a_remark_naming_no_project_does_not_fire_it(self):
        cands = [_c("A", 1000, "PROJ-1"), _c("B", 1000, "PROJ-2")]
        self.assertIsNone(_pick(cands, remark="nothing recognisable", index=self.INDEX))

    def test_it_does_not_fire_without_a_project_index(self):
        """The wiring guard: no index, no M1, rather than a crash or a silent guess."""
        cands = [_c("A", 1000, "PROJ-1"), _c("B", 1000, "PROJ-2")]
        self.assertIsNone(_pick(cands, remark="Zephyrline services", index=None))

    def test_it_skips_a_claimed_candidate_on_the_named_project(self):
        cands = [_c("A", 1000, "PROJ-2"), _c("B", 1000, "PROJ-2")]
        pick = _pick(cands, remark="Zephyrline services", index=self.INDEX,
                     claimed={(PAY, "A")})
        # One free candidate on the named project -> M1 fires on it.
        self.assertEqual((pick.name, pick.rule), ("B", RULE_PROJECT_IN_REMARK))


class TestM2NearestAmount(unittest.TestCase):
    def test_it_picks_the_candidate_closest_to_what_the_bank_moved(self):
        """The live shape: bank Rs 14,094.00 against 14,093.92 (8 paise) and 14,089.20 (Rs 4.80)."""
        cands = [_c("FAR", "14089.20"), _c("NEAR", "14093.92")]
        pick = _pick(cands, bank="14094.00")
        self.assertEqual((pick.name, pick.rule), ("NEAR", RULE_NEAREST_AMOUNT))

    def test_it_is_fenced_to_a_single_project(self):
        """⚠️ THE FENCE IS THE SAFETY. Across projects, 8 paise closer is not evidence about which
        job the money was for -- and a wrong pick there bills the wrong job."""
        cands = [_c("NEAR", "14093.92", "PROJ-1"), _c("FAR", "14089.20", "PROJ-2")]
        self.assertIsNone(_pick(cands, bank="14094.00"))

    def test_it_works_when_the_bank_paid_more_than_the_record(self):
        cands = [_c("NEAR", "999.90"), _c("FAR", "995.00")]
        self.assertEqual(_pick(cands, bank="1000").name, "NEAR")

    def test_a_claimed_nearest_hands_the_pick_to_the_next_one(self):
        cands = [_c("NEAR", "999.90"), _c("MID", "999.50"), _c("FAR", "995.00")]
        pick = _pick(cands, bank="1000", claimed={(PAY, "NEAR")})
        self.assertEqual((pick.name, pick.rule), ("MID", RULE_NEAREST_AMOUNT))

    def test_one_free_candidate_from_a_non_twin_set_is_left_to_a_person(self):
        """⚠️ "Nearest" is vacuous with nothing to be nearer than. Picking it anyway would dress a
        leftover up as a measurement."""
        cands = [_c("A", "999.90"), _c("B", "995.00")]
        self.assertIsNone(_pick(cands, bank="1000", claimed={(PAY, "A")}))


class TestM3Interchangeable(unittest.TestCase):
    def test_same_project_same_amount_picks_deterministically(self):
        cands = [_c("B", 9000), _c("A", 9000)]
        pick = _pick(cands, bank="9000")
        self.assertEqual((pick.name, pick.rule), ("A", RULE_INTERCHANGEABLE))

    def test_the_pick_is_stable_across_runs(self):
        cands = [_c("B", 9000), _c("A", 9000), _c("C", 9000)]
        self.assertEqual(_pick(cands, bank="9000").name, _pick(list(reversed(cands)), bank="9000").name)

    def test_seven_transfers_against_eight_twins_each_take_a_different_record(self):
        """⚠️ THE ROUND-ROBIN IS WHAT MAKES M3 WORTH HAVING. Without feeding the claim back, every
        transfer picks the same record and the claim pass releases all but one."""
        cands = [_c(f"P{i}", 9000) for i in range(8)]
        claimed = set()
        picked = []
        for _ in range(7):
            pick = _pick(cands, bank="9000", claimed=claimed)
            self.assertIsNotNone(pick)
            picked.append(pick.name)
            claimed.add(pick.key)
        self.assertEqual(len(set(picked)), 7)

    def test_the_last_free_twin_is_still_picked(self):
        """The fence reads ALL candidates, so eight twins with seven taken is still a twin set."""
        cands = [_c(f"P{i}", 9000) for i in range(8)]
        claimed = {(PAY, f"P{i}") for i in range(7)}
        pick = _pick(cands, bank="9000", claimed=claimed)
        self.assertEqual((pick.name, pick.rule), ("P7", RULE_INTERCHANGEABLE))

    def test_a_leftover_from_a_CROSS_PROJECT_set_is_never_called_interchangeable(self):
        """⚠️ THE ASYMMETRY THAT MAKES THIS CORRECT. Judged on the residue, a single survivor
        trivially shares one project and one amount -- so M3 would stamp `interchangeable` on a set
        that spanned three. The fence describes what the matcher found, not who got there first."""
        cands = [_c("A", 1000, "PROJ-1"), _c("B", 1000, "PROJ-2"), _c("C", 1000, "PROJ-3")]
        pick = _pick(cands, bank="1000", claimed={(PAY, "A"), (PAY, "B")})
        self.assertIsNone(pick)


class TestItNeverWidensWhatMayBeMatched(unittest.TestCase):
    def test_it_only_ever_returns_a_candidate_it_was_given(self):
        cands = [_c("A", 1000), _c("B", 1000)]
        pick = _pick(cands, bank="1000")
        self.assertIn(pick.key, {c.key for c in cands})

    def test_it_never_returns_a_claimed_candidate(self):
        cands = [_c("A", 1000), _c("B", 1000), _c("C", 1000)]
        claimed = {(PAY, "A"), (PAY, "B")}
        self.assertNotIn(_pick(cands, bank="1000", claimed=claimed).key, claimed)


class TestTheNote(unittest.TestCase):
    def test_the_twin_note_says_the_pick_was_arbitrary_and_what_to_check(self):
        cands = [_c("A", 9000), _c("B", 9000)]
        note = pick_note(_pick(cands, bank="9000"), cands, D("9000"))
        self.assertIn("arbitrarily", note)
        self.assertIn("Check the project", note)

    def test_the_nearest_note_states_the_gap(self):
        cands = [_c("NEAR", "14093.92"), _c("FAR", "14089.20")]
        note = pick_note(_pick(cands, bank="14094.00"), cands, D("14094.00"))
        self.assertIn("0.08", note)
        self.assertIn("same project", note)

    def test_the_remark_note_says_which_evidence_was_used(self):
        index = _Index({"Zephyrline": "PROJ-2"})
        cands = [_c("A", 1000, "PROJ-1"), _c("B", 1000, "PROJ-2")]
        note = pick_note(_pick(cands, remark="Zephyrline", index=index), cands, D("1000"))
        self.assertIn("remark names its project", note)

    def test_every_note_counts_the_records_so_the_row_is_not_read_as_a_sole_match(self):
        cands = [_c("A", 9000), _c("B", 9000), _c("C", 9000)]
        note = pick_note(_pick(cands, bank="9000"), cands, D("9000"))
        self.assertIn("3 approved records", note)


if __name__ == "__main__":
    unittest.main()


class TestM3IsFencedOffStacks(unittest.TestCase):
    """⚠️ AN OWNER RULING, AND M3 BREAKS IT IN SILENCE WITHOUT THIS SWITCH.

    An UNBALANCED stack pairs NOTHING -- not even partially. With 7 transfers and 6 identical
    records some transfer settles nothing, and choosing which one is a judgement about money that
    belongs to a person. M3 applied row by row does exactly that partial pairing: the first six take
    a record each and the seventh finds them all claimed.

    Measured when this shipped unfenced against the real statement: 62 of 65 interchangeable picks
    landed on stack members, and the leftovers screen fell from 6 stacks to 3 -- the pass had quietly
    consumed the difference. The caller switches M3 off for any row belonging to a stack.
    """

    def test_it_refuses_the_arbitrary_pick_for_a_stack_member(self):
        cands = [_c("A", 9000), _c("B", 9000)]
        self.assertIsNone(_pick(cands, bank="9000", allow_interchangeable=False))

    def test_the_same_row_would_be_picked_if_it_were_not_in_a_stack(self):
        """Pins that the switch is the ONLY difference -- so a reader can see the fence is a policy
        choice about stacks, not a symptom of the candidates."""
        cands = [_c("A", 9000), _c("B", 9000)]
        self.assertIsNotNone(_pick(cands, bank="9000", allow_interchangeable=True))

    def test_M1_still_fires_for_a_stack_member(self):
        """⚠️ THE DISTINCTION THE RULING RESTS ON. M1 acts on EVIDENCE about one specific transfer --
        the project its remark names -- rather than choosing arbitrarily between things nothing
        distinguishes. Arbitrary-among-interchangeable is what the stack machinery owns; evidence is
        not, and switching it off too would throw away the rows most worth resolving."""
        index = _Index({"Zephyrline": "PROJ-2"})
        cands = [_c("A", 9000, "PROJ-1"), _c("B", 9000, "PROJ-2")]
        pick = _pick(cands, bank="9000", remark="Zephyrline", index=index,
                     allow_interchangeable=False)
        self.assertEqual((pick.name, pick.rule), ("B", RULE_PROJECT_IN_REMARK))

    def test_M2_still_fires_for_a_stack_member(self):
        """Also evidence -- the paise the bank actually moved."""
        cands = [_c("NEAR", "9000.10"), _c("FAR", "8995.00")]
        pick = _pick(cands, bank="9000.00", allow_interchangeable=False)
        self.assertEqual((pick.name, pick.rule), ("NEAR", RULE_NEAREST_AMOUNT))


class TestM4NearestDecisionDate(unittest.TestCase):
    """M4: the candidate decided strictly nearest the day the money actually moved."""

    def test_it_picks_the_strictly_nearest(self):
        cands = [_dc("NEAR", 1000, 0), _dc("FAR", 1000, 7)]
        pick = _pick(cands, allow_interchangeable=False, transfer_date=MOVED)
        self.assertEqual((pick.name, pick.rule), ("NEAR", RULE_NEAREST_DATE))

    def test_a_tie_abstains(self):
        """⚠️ A COMMON OUTCOME ON REAL DATA, not a corner case: a batch approved on one day gives
        every candidate the identical gap. The rule stays silent rather than breaking the tie on
        something that is not evidence."""
        cands = [_dc("A", 1000, 1), _dc("B", 1000, 1)]
        self.assertIsNone(_pick(cands, allow_interchangeable=False, transfer_date=MOVED))

    def test_it_reads_the_window_either_side(self):
        for gap in (-NEAREST_DATE_WINDOW_DAYS, NEAREST_DATE_WINDOW_DAYS):
            cands = [_dc("IN", 1000, gap), _dc("OUT", 1000, 40)]
            pick = _pick(cands, allow_interchangeable=False, transfer_date=MOVED)
            self.assertEqual(pick.name, "IN", f"gap {gap} should be inside the window")

    def test_nearest_but_outside_the_window_abstains(self):
        cands = [_dc("A", 1000, NEAREST_DATE_WINDOW_DAYS + 1), _dc("B", 1000, 60)]
        self.assertIsNone(_pick(cands, allow_interchangeable=False, transfer_date=MOVED))

    def test_the_window_is_checked_on_the_winner_not_used_to_filter_first(self):
        """⚠️ FILTERING FIRST WOULD LET A LONE IN-WINDOW CANDIDATE WIN UNOPPOSED. The runner-up has
        to stay visible or "strictly nearest" is a comparison against an empty set. Here A is inside
        and B outside, so a filter-first implementation would return A against nothing; the correct
        answer is still A, but it must be reached by BEATING B."""
        cands = [_dc("A", 1000, 1), _dc("B", 1000, 9)]
        pick = _pick(cands, allow_interchangeable=False, transfer_date=MOVED)
        self.assertEqual(pick.name, "A")

    def test_no_transfer_date_abstains(self):
        cands = [_dc("A", 1000, 0), _dc("B", 1000, 9)]
        self.assertIsNone(_pick(cands, allow_interchangeable=False, transfer_date=None))

    def test_an_undated_candidate_is_dropped_not_ranked_last(self):
        """"We do not know when this was decided" is not "this was decided far away". Ranking an
        undated candidate as distant would let a missing value lose a contest it never entered --
        so with only ONE dated candidate there is nothing to be nearer than, and M4 abstains."""
        cands = [_dc("DATED", 1000, 0), _c("UNDATED", 1000)]
        self.assertIsNone(_pick(cands, allow_interchangeable=False, transfer_date=MOVED))

    def test_a_claimed_nearer_candidate_does_not_hand_its_place_over(self):
        """The nearest record is held by another transfer. What is left is a single free candidate,
        which is not a measurement -- M4 abstains rather than awarding the runner-up by default."""
        cands = [_dc("TAKEN", 1000, 0), _dc("FREE", 1000, 2)]
        self.assertIsNone(
            _pick(cands, claimed={(PAY, "TAKEN")}, allow_interchangeable=False,
                  transfer_date=MOVED)
        )


class TestM4RunsLastAndIsAdditive(unittest.TestCase):
    """⚠️ THE PROPERTY THAT LET M4 SHIP WITHOUT RE-MEASURING M1/M2/M3. It fires only where the
    function previously returned None, so no pick already in the database moves because of it."""

    def test_M1_wins_over_a_nearer_date(self):
        index = _Index({"Zephyrline": "PROJ-2"})
        cands = [_dc("NEAR", 1000, 0, "PROJ-1"), _dc("NAMED", 1000, 8, "PROJ-2")]
        pick = _pick(cands, remark="Zephyrline", index=index, transfer_date=MOVED)
        self.assertEqual((pick.name, pick.rule), ("NAMED", RULE_PROJECT_IN_REMARK))

    def test_M2_wins_over_a_nearer_date(self):
        """An exact amount is near-identity; a date is circumstantial. Amount keeps precedence."""
        cands = [_dc("NEARDATE", "8995.00", 0), _dc("NEARAMOUNT", "1000.10", 8)]
        pick = _pick(cands, bank="1000.00", transfer_date=MOVED)
        self.assertEqual((pick.name, pick.rule), ("NEARAMOUNT", RULE_NEAREST_AMOUNT))

    def test_M3_wins_over_a_nearer_date_when_it_is_allowed_to_fire(self):
        cands = [_dc("A", 1000, 0), _dc("B", 1000, 8)]
        pick = _pick(cands, allow_interchangeable=True, transfer_date=MOVED)
        self.assertEqual(pick.rule, RULE_INTERCHANGEABLE)


class TestM4IsNotBlockedByTheStackFence(unittest.TestCase):
    """⚠️ A LIVE BUG FOR THE LENGTH OF ONE SLICE, and the regression guard for it.

    M3's fence used to `return None` for a stack member, which short-circuited before M4 could run.
    Declining M3 says ONE thing -- do not pick ARBITRARILY between interchangeable records -- and
    says nothing about evidence. Measured cost: two rows whose candidates were decided SEVEN DAYS
    apart were handed to a person as though nothing distinguished them.
    """

    def test_a_stack_member_still_reaches_M4(self):
        cands = [_dc("NEAR", 9000, 0), _dc("FAR", 9000, 7)]
        pick = _pick(cands, bank="9000", allow_interchangeable=False, transfer_date=MOVED)
        self.assertEqual((pick.name, pick.rule), ("NEAR", RULE_NEAREST_DATE))

    def test_and_still_abstains_where_the_ruling_says_it_must(self):
        """The ruling is untouched: interchangeable records with nothing to separate them are the
        stack machinery's business, and M4 does not quietly take that over."""
        cands = [_dc("A", 9000, 2), _dc("B", 9000, 2)]
        self.assertIsNone(
            _pick(cands, bank="9000", allow_interchangeable=False, transfer_date=MOVED)
        )


class TestM4IsUnfenced(unittest.TestCase):
    """The owner ruling, pinned in both directions so flipping the constant is a one-line change
    with a test that says what it costs."""

    def test_it_fires_across_projects(self):
        cands = [_dc("NEAR", 1000, 0, "PROJ-1"), _dc("FAR", 1000, 9, "PROJ-2")]
        pick = _pick(cands, transfer_date=MOVED)
        self.assertEqual((pick.name, pick.rule), ("NEAR", RULE_NEAREST_DATE))

    def test_the_fence_constant_restores_the_M2_behaviour(self):
        cands = [_dc("NEAR", 1000, 0, "PROJ-1"), _dc("FAR", 1000, 9, "PROJ-2")]
        original = _disambiguate.NEAREST_DATE_FENCE_TO_ONE_PROJECT
        _disambiguate.NEAREST_DATE_FENCE_TO_ONE_PROJECT = True
        try:
            self.assertIsNone(_pick(cands, transfer_date=MOVED))
        finally:
            _disambiguate.NEAREST_DATE_FENCE_TO_ONE_PROJECT = original

    def test_a_blank_project_does_not_block_it(self):
        """Unlike M2 and M3, which fail the single-project fence on any blank."""
        cands = [_dc("NEAR", 1000, 0, ""), _dc("FAR", 1000, 9, "")]
        self.assertEqual(_pick(cands, transfer_date=MOVED).name, "NEAR")


class TestTheM4Note(unittest.TestCase):
    def _note(self, pick, cands):
        return pick_note(pick, cands, D("1000"), MOVED)

    def test_it_names_the_gap_and_the_runner_up(self):
        cands = [_dc("NEAR", 1000, 1), _dc("FAR", 1000, 6)]
        pick = _pick(cands, allow_interchangeable=False, transfer_date=MOVED)
        note = self._note(pick, cands)
        self.assertIn("1 day apart", note)
        self.assertIn("against 6 for the next nearest", note)
        self.assertIn("Check the project", note)

    def test_a_payment_says_approved(self):
        cands = [_dc("NEAR", 1000, 0), _dc("FAR", 1000, 6)]
        pick = _pick(cands, allow_interchangeable=False, transfer_date=MOVED)
        note = self._note(pick, cands)
        self.assertIn("approved closest to the day", note)
        self.assertIn("the same day", note)

    def test_an_expense_says_last_updated_and_never_approved(self):
        """⚠️ LOAD-BEARING, NOT WORDING. Neither expense doctype has an approval date, an approver
        or an approval step -- `decided_on` is `modified` there. Calling that "approved" on the
        screen where money is authorised states something false about the record, and it is the one
        thing that keeps the merged matching value compatible with the display rule."""
        cands = [
            _dc("NEAR", 1000, 0, doctype=EXP),
            _dc("FAR", 1000, 6, doctype=EXP),
        ]
        pick = _pick(cands, allow_interchangeable=False, transfer_date=MOVED)
        note = self._note(pick, cands)
        self.assertIn("last updated closest to the day", note)
        # ⚠️ THE ASSERTION IS ABOUT THE DATE PHRASE, NOT THE WORD. The note's opening sentence says
        # "N approved records match this amount", which is true of any ledger -- Approved is the
        # only status this import may settle from. What must never appear on an expense is the
        # claim that the DATE is an approval.
        self.assertNotIn("approved closest", note)
        self.assertNotIn("approved nearest", note)
