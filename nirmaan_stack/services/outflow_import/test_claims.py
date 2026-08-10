"""Unit tests for `claims` -- a record is claimed once.

No bench needed:
    python -m unittest discover -s nirmaan_stack/services/outflow_import -t . -p "test_*.py"
"""

import unittest

from nirmaan_stack.services.outflow_import.claims import (
    Claim,
    claim_note,
    resolve_claims,
)

PAY = "Project Payments"


def _c(row, record, added_on="", releasable=True):
    return Claim(row=row, record=(PAY, record), added_on=added_on, releasable=releasable)


class TestNothingToDo(unittest.TestCase):
    def test_no_claims_at_all(self):
        self.assertEqual(resolve_claims([]).releases, ())

    def test_every_record_wanted_by_one_row_releases_nothing(self):
        out = resolve_claims([_c("R1", "PAY-1"), _c("R2", "PAY-2"), _c("R3", "PAY-3")])
        self.assertEqual(out.releases, ())
        self.assertEqual(out.rivals, {})

    def test_a_blank_record_or_row_is_ignored_rather_than_grouped(self):
        """A row with no suggestion is not a contender. Grouping blanks together would make every
        unsuggested row in the batch fight every other one for the empty record."""
        out = resolve_claims(
            [Claim(row="R1", record=("", "")), Claim(row="", record=(PAY, "PAY-1"))]
        )
        self.assertEqual(out.releases, ())


class TestTheContest(unittest.TestCase):
    def test_two_rows_on_one_record_leaves_exactly_one_holding_it(self):
        out = resolve_claims([_c("R1", "PAY-1", "2026-08-01"), _c("R2", "PAY-1", "2026-08-02")])
        self.assertEqual(out.releases, ("R2",))

    def test_the_earliest_transfer_keeps_it(self):
        """Deterministic by (added_on, row). A reshuffle between runs would move a suggestion out
        from under a reviewer mid-decision -- the same reason `pair_stack` re-sorts both sides."""
        out = resolve_claims([_c("R2", "PAY-1", "2026-08-09"), _c("R1", "PAY-1", "2026-08-02")])
        self.assertEqual(out.releases, ("R2",))

    def test_the_row_name_breaks_a_tie_so_query_order_never_decides(self):
        out = resolve_claims([_c("RB", "PAY-1", "2026-08-01"), _c("RA", "PAY-1", "2026-08-01")])
        self.assertEqual(out.releases, ("RB",))

    def test_a_blank_date_sorts_first_rather_than_crashing(self):
        out = resolve_claims([_c("R1", "PAY-1", ""), _c("R2", "PAY-1", "2026-08-02")])
        self.assertEqual(out.releases, ("R2",))

    def test_the_live_shape_five_transfers_one_record_releases_four(self):
        """PAY-00103-074 on the first real statement: five transfers, four of them to entirely
        different beneficiaries. Four must let go, and each must know it was one of five."""
        claims = [_c(f"R{i}", "PAY-00103-074", f"2026-08-0{i}") for i in range(1, 6)]
        out = resolve_claims(claims)
        self.assertEqual(len(out.releases), 4)
        self.assertNotIn("R1", out.releases)
        for row in out.releases:
            self.assertEqual(out.rivals[row], 5)

    def test_contests_over_different_records_do_not_interfere(self):
        out = resolve_claims(
            [
                _c("R1", "PAY-1", "2026-08-01"),
                _c("R2", "PAY-1", "2026-08-02"),
                _c("R3", "PAY-2", "2026-08-01"),
            ]
        )
        self.assertEqual(out.releases, ("R2",))

    def test_the_same_record_id_in_two_ledgers_is_two_records(self):
        """The record identity is (doctype, name). Two ledgers may reuse a name, and treating them
        as one would release a row that was never in a contest."""
        out = resolve_claims(
            [
                Claim(row="R1", record=(PAY, "X-1")),
                Claim(row="R2", record=("Project Expenses", "X-1")),
            ]
        )
        self.assertEqual(out.releases, ())


class TestTheScopeFence(unittest.TestCase):
    def test_a_row_this_run_may_not_touch_always_wins(self):
        """A row in another batch was not re-derived by this run. Stripping its pre-selection would
        change a screen for a reason nobody could discover from it."""
        out = resolve_claims(
            [
                _c("MINE", "PAY-1", "2026-08-01", releasable=True),
                _c("THEIRS", "PAY-1", "2026-08-09", releasable=False),
            ]
        )
        self.assertEqual(out.releases, ("MINE",))

    def test_it_wins_even_when_it_sorts_last(self):
        out = resolve_claims(
            [
                _c("MINE", "PAY-1", "2026-01-01", releasable=True),
                _c("THEIRS", "PAY-1", "2026-12-31", releasable=False),
            ]
        )
        self.assertEqual(out.releases, ("MINE",))

    def test_two_untouchable_claims_are_left_alone_and_ours_still_gives_way(self):
        """A pre-existing conflict outside this run's scope cannot be fixed here. Ours could not
        have won either way, so it still releases -- reporting a conflict by creating one would be
        a strange trade."""
        out = resolve_claims(
            [
                _c("THEIRS-A", "PAY-1", "2026-08-01", releasable=False),
                _c("THEIRS-B", "PAY-1", "2026-08-02", releasable=False),
                _c("MINE", "PAY-1", "2026-08-03", releasable=True),
            ]
        )
        self.assertEqual(out.releases, ("MINE",))


class TestItReleasesRatherThanReassigns(unittest.TestCase):
    def test_a_loser_is_named_once_and_carries_no_replacement(self):
        """The outcome names rows to CLEAR. There is no second-best record in the payload, because
        losing a contest does not show a transfer belongs to something else."""
        out = resolve_claims([_c("R1", "PAY-1", "2026-08-01"), _c("R2", "PAY-1", "2026-08-02")])
        self.assertEqual(out.releases, ("R2",))
        self.assertEqual(set(out.rivals), {"R2"})


class TestTheNote(unittest.TestCase):
    def test_it_names_the_record_so_the_reviewer_can_go_and_look(self):
        note = claim_note("PAY-00103-074", 5)
        self.assertIn("PAY-00103-074", note)
        self.assertIn("4 other transfers", note)

    def test_one_rival_reads_as_singular(self):
        self.assertIn("1 other transfer at this amount", claim_note("PAY-1", 2))

    def test_it_does_not_name_the_winning_transfer(self):
        """Naming it would read as a verdict about the other transfer, which this module has no
        basis for -- it ordered contenders, it did not investigate them."""
        note = claim_note("PAY-1", 3)
        self.assertNotIn("OFR-", note)

    def test_it_says_what_to_do_next(self):
        self.assertIn("Choose", claim_note("PAY-1", 2))


if __name__ == "__main__":
    unittest.main()
