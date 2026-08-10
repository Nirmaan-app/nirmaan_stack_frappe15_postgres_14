# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for nirmaan_stack.services.outflow_import.stacks (chunk E1).

WHAT IS ACTUALLY AT RISK HERE, and therefore what most of these tests are about:

  * DETERMINISM. The pairing is arbitrary by owner ruling, which is exactly why it must be STABLE.
    A pairing that reshuffles between two runs would move a suggestion out from under a reviewer
    mid-decision, and the reviewer would have no way to tell that it had moved.
  * THE BALANCED GATE. Pairing an unbalanced stack would silently decide which transfer settles
    nothing -- the one judgement this module has no basis for making.
  * THE ACCOUNT-LESS ROW. Grouping on amount alone puts unrelated vendors who happen to share a
    figure into one stack, and a "balanced" stack of those auto-pairs strangers to each other's
    payments. It is the worst failure this module could produce, and it is one missing guard away.
"""

import unittest
from datetime import datetime
from decimal import Decimal

from nirmaan_stack.services.outflow_import.stacks import (
    Stack,
    StackKey,
    group_into_stacks,
    pair_stack,
    stack_key,
    stack_note,
)


class _Row:
    def __init__(self, name, account="ACC1", amount="9000", added_on="2026-05-05 10:00:00"):
        self.name = name
        self.normalized_account = account
        self.amount = Decimal(str(amount))
        self.added_on = datetime.strptime(added_on, "%Y-%m-%d %H:%M:%S") if added_on else None


class _Target:
    def __init__(self, name, doctype="Project Payments", amount="9000"):
        self.name = name
        self.doctype = doctype
        self.amount = Decimal(str(amount))


def _stack(transfers, records):
    return Stack(
        key=StackKey(account="ACC1", amount=Decimal("9000")),
        transfers=tuple(transfers),
        records=tuple(records),
    )


def _records_for(records):
    """A `records_for` callback that hands the same set to every stack."""
    return lambda key, transfers: records


class TestStackKey(unittest.TestCase):
    def test_same_account_and_amount_is_one_stack(self):
        a, b = _Row("A"), _Row("B")
        self.assertEqual(stack_key(a), stack_key(b))

    def test_a_different_amount_is_a_different_stack(self):
        self.assertNotEqual(stack_key(_Row("A")), stack_key(_Row("B", amount="9001")))

    def test_a_different_account_is_a_different_stack(self):
        self.assertNotEqual(stack_key(_Row("A")), stack_key(_Row("B", account="ACC2")))

    def test_amounts_are_compared_EXACTLY_not_within_the_tolerance_window(self):
        """⚠️ A DELIBERATE NARROWING away from the +-Re 1 window used everywhere else.

        A window is not an equivalence relation -- 1.00, 1.90 and 2.80 overlap pair-wise but do not
        form a group -- so grouping by one has no single correct answer and depends on iteration
        order. And there is nothing for it to absorb: the window exists for bank rounding between a
        transfer and a RECORD, while two transfers of the same repeated payment carry the same
        figure to the paise.
        """
        self.assertNotEqual(stack_key(_Row("A", amount="9000")), stack_key(_Row("B", amount="9000.50")))

    def test_a_row_with_no_account_cannot_be_stacked(self):
        """⚠️ THE WORST FAILURE THIS MODULE COULD PRODUCE, pinned. An empty-string key would group
        every account-less row of the same amount together -- transfers to unrelated parties that
        happen to share a figure -- and a balanced stack of those would auto-pair strangers to each
        other's payments."""
        self.assertIsNone(stack_key(_Row("A", account="")))
        self.assertIsNone(stack_key(_Row("A", account="   ")))


class TestGrouping(unittest.TestCase):
    def test_a_lone_transfer_is_not_a_stack(self):
        """Not ambiguous in the way this module exists to resolve -- the per-row matcher already
        either found it a sole candidate or deliberately declined to choose."""
        stacks = group_into_stacks([_Row("A")], _records_for([_Target("PAY-1")]))
        self.assertEqual(stacks, ())

    def test_transfers_sharing_an_account_and_amount_form_one_stack(self):
        stacks = group_into_stacks(
            [_Row("A"), _Row("B"), _Row("C")], _records_for([_Target("PAY-1")])
        )
        self.assertEqual(len(stacks), 1)
        self.assertEqual([r.name for r in stacks[0].transfers], ["A", "B", "C"])

    def test_different_accounts_form_separate_stacks(self):
        stacks = group_into_stacks(
            [_Row("A"), _Row("B"), _Row("C", account="ACC2"), _Row("D", account="ACC2")],
            _records_for([_Target("PAY-1")]),
        )
        self.assertEqual(len(stacks), 2)

    def test_account_less_rows_are_dropped_entirely(self):
        stacks = group_into_stacks(
            [_Row("A", account=""), _Row("B", account="")], _records_for([_Target("PAY-1")])
        )
        self.assertEqual(stacks, ())

    def test_the_candidate_set_is_fetched_ONCE_PER_STACK_not_per_row(self):
        """The set is shared by construction -- every member has the same account and the same
        amount, and those are the only axes the pool is filtered on. Asking per row would be N
        identical queries."""
        calls = []

        def records_for(key, transfers):
            calls.append(key)
            return [_Target("PAY-1")]

        group_into_stacks([_Row("A"), _Row("B"), _Row("C")], records_for)
        self.assertEqual(len(calls), 1)

    def test_stacks_come_back_in_a_stable_order(self):
        rows = [_Row("A", account="ACC2"), _Row("B", account="ACC2"), _Row("C"), _Row("D")]
        first = [s.key for s in group_into_stacks(rows, _records_for([]))]
        second = [s.key for s in group_into_stacks(list(reversed(rows)), _records_for([]))]
        self.assertEqual(first, second)


class TestBalance(unittest.TestCase):
    def test_equal_counts_is_balanced(self):
        self.assertTrue(_stack([_Row("A"), _Row("B")], [_Target("P1"), _Target("P2")]).is_balanced)

    def test_more_transfers_than_records_is_not(self):
        stack = _stack([_Row("A"), _Row("B"), _Row("C")], [_Target("P1"), _Target("P2")])
        self.assertFalse(stack.is_balanced)
        self.assertEqual(stack.surplus_transfers, 1)
        self.assertEqual(stack.surplus_records, 0)

    def test_more_records_than_transfers_is_not(self):
        stack = _stack([_Row("A")], [_Target("P1"), _Target("P2")])
        self.assertFalse(stack.is_balanced)
        self.assertEqual(stack.surplus_records, 1)

    def test_a_stack_with_no_records_at_all_is_not_balanced(self):
        """Zero and zero would satisfy a bare length comparison. Nothing to pair is not a pairing."""
        self.assertFalse(_stack([], []).is_balanced)


class TestPairing(unittest.TestCase):
    def test_a_balanced_stack_pairs_one_to_one(self):
        pairs = pair_stack(
            _stack(
                [_Row("A", added_on="2026-05-05 10:00:00"), _Row("B", added_on="2026-05-06 10:00:00")],
                [_Target("PAY-2"), _Target("PAY-1")],
            )
        )
        self.assertEqual([(t.name, r.name) for t, r in pairs], [("A", "PAY-1"), ("B", "PAY-2")])

    def test_an_unbalanced_stack_pairs_NOTHING_not_partially(self):
        """⚠️ A PARTIAL PAIRING WOULD DECIDE THE ONE QUESTION THIS MODULE CANNOT ANSWER. With 3
        transfers and 2 records, SOME transfer settles nothing; choosing which is a judgement about
        money. Returning nothing leaves all three for a person, and the leftover reads as a
        decision rather than an oversight."""
        pairs = pair_stack(_stack([_Row("A"), _Row("B"), _Row("C")], [_Target("P1"), _Target("P2")]))
        self.assertEqual(pairs, ())

    def test_no_record_is_handed_to_two_transfers(self):
        pairs = pair_stack(
            _stack(
                [_Row("A"), _Row("B"), _Row("C")],
                [_Target("P1"), _Target("P2"), _Target("P3")],
            )
        )
        assigned = [r.name for _, r in pairs]
        self.assertEqual(len(assigned), len(set(assigned)))

    def test_every_transfer_gets_exactly_one_record(self):
        transfers = [_Row("A"), _Row("B"), _Row("C")]
        pairs = pair_stack(_stack(transfers, [_Target("P1"), _Target("P2"), _Target("P3")]))
        self.assertEqual([t.name for t, _ in pairs], ["A", "B", "C"])

    def test_the_pairing_is_IDENTICAL_across_runs_whatever_the_input_order(self):
        """⚠️ THE LOAD-BEARING TEST OF THIS MODULE. The pairing is arbitrary by owner ruling, which
        is precisely why it must be stable: a reshuffle between two match runs moves a suggestion
        out from under a reviewer mid-decision, and nothing on the screen would say it had moved.

        Both sort keys end in a UNIQUE field (`name`), so no tie can survive to be broken by dict
        or query order -- which is the property this asserts, by feeding the same set in reversed.
        """
        transfers = [
            _Row("A", added_on="2026-05-07 10:00:00"),
            _Row("B", added_on="2026-05-05 10:00:00"),
            _Row("C", added_on="2026-05-06 10:00:00"),
        ]
        records = [_Target("PAY-3"), _Target("PAY-1"), _Target("PAY-2")]

        forward = pair_stack(_stack(transfers, records))
        backward = pair_stack(_stack(list(reversed(transfers)), list(reversed(records))))
        self.assertEqual(
            [(t.name, r.name) for t, r in forward],
            [(t.name, r.name) for t, r in backward],
        )

    def test_identical_timestamps_still_pair_deterministically(self):
        """The realistic shape: a bank limit split sends several transfers in the same second. The
        timestamp ties, so `name` is the only thing left to order by -- which is why it is in the
        key."""
        transfers = [_Row(n, added_on="2026-05-05 10:00:00") for n in ("C", "A", "B")]
        pairs = pair_stack(_stack(transfers, [_Target("P1"), _Target("P2"), _Target("P3")]))
        self.assertEqual([t.name for t, _ in pairs], ["A", "B", "C"])

    def test_a_row_with_no_timestamp_does_not_raise(self):
        """`None` cannot be compared to a datetime. One such row would otherwise take down the
        whole match run with a TypeError."""
        transfers = [_Row("A", added_on=None), _Row("B")]
        pairs = pair_stack(_stack(transfers, [_Target("P1"), _Target("P2")]))
        self.assertEqual(len(pairs), 2)
        # The timestamped row sorts first; the one with nothing to sort by goes last.
        self.assertEqual([t.name for t, _ in pairs], ["B", "A"])

    def test_records_of_different_doctypes_order_deterministically(self):
        """A stack's candidates can span ledgers. `(doctype, name)` is total across the mix."""
        records = [
            _Target("PE-1", doctype="Project Expenses"),
            _Target("PAY-1", doctype="Project Payments"),
        ]
        pairs = pair_stack(_stack([_Row("A"), _Row("B")], records))
        self.assertEqual([r.name for _, r in pairs], ["PE-1", "PAY-1"])


class TestTheNote(unittest.TestCase):
    def test_it_says_the_pairing_is_arbitrary(self):
        """⚠️ THE MITIGATION FOR THE ACCEPTED RISK, and it is the whole reason the note is not the
        matcher's ordinary confident sentence. Six payments of one amount may sit on six different
        projects; a note that read like a normal match would hide the one fact a reviewer needs in
        order to catch that."""
        note = stack_note(
            _stack([_Row("A"), _Row("B")], [_Target("PAY-1"), _Target("PAY-2")]), "PAY-1"
        )
        self.assertIn("arbitrary", note)
        self.assertIn("Check the project before confirming", note)

    def test_it_names_the_record_and_the_stack_size(self):
        note = stack_note(
            _stack([_Row("A"), _Row("B")], [_Target("PAY-1"), _Target("PAY-2")]), "PAY-1"
        )
        self.assertIn("PAY-1", note)
        self.assertIn("2 identical transfers", note)


if __name__ == "__main__":
    unittest.main()
