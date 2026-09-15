# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Can this leg be undone, and what happens? -- one table of fact snapshots per verdict (#1271).

Every refusal below is one `reverse_allocation` already made before the decision moved here, and
the sentence it asserts is the one that endpoint printed. A reworded sentence must fail here first.
"""

import dataclasses
import unittest

from nirmaan_stack.services.outflow_import import unreconcile
from nirmaan_stack.services.outflow_import.unreconcile import (
    FIX_ON_PAYMENTS_SCREEN,
    VERDICT_REFUSED,
    VERDICT_REVERT_PAYMENT,
    LegFacts,
    first_refusal,
    leg_verdict,
)

PAY = "PAY-1"
REF = "UTR123"

# A plain allocation leg that CAN be reversed: every refusal below changes exactly one fact of it.
REVERSIBLE = LegFacts(
    leg="MATCH-1",
    match_kind="Settled",
    target_doctype="Project Payments",
    target_name=PAY,
    leg_amount=60.0,
    target_exists=True,
    target_status="Paid",
    target_amount=60.0,
    target_reference=REF,
    tds=0,
    split_from="",
    split_balance=None,
    settlement_references=(REF, "UTR123-OLD"),
)


def facts(**changes) -> LegFacts:
    return dataclasses.replace(REVERSIBLE, **changes)


class TestTheReversibleLeg(unittest.TestCase):
    def test_a_plain_paid_payment_leg_reverts(self):
        verdict = leg_verdict(REVERSIBLE)
        self.assertEqual(verdict.verdict, VERDICT_REVERT_PAYMENT)
        self.assertEqual(verdict.leg, "MATCH-1")
        self.assertIsNone(verdict.reason)
        self.assertIsNone(verdict.title)
        self.assertIsNone(verdict.fix_at)

    def test_the_same_leg_under_every_shape_that_should_still_revert(self):
        for label, change in [
            ("reference matches the OTHER settlement reference", {"target_reference": "UTR123-OLD"}),
            ("a blank stored reference is not a re-point", {"target_reference": ""}),
            ("whitespace around the stored reference", {"target_reference": f"  {REF} "}),
            ("status with whitespace", {"target_status": " Paid "}),
            ("amounts equal as text and number", {"leg_amount": "60", "target_amount": 60.0}),
            ("a blank split_from", {"split_from": "   "}),
            ("tds None", {"tds": None}),
            ("tds blank string", {"tds": ""}),
        ]:
            with self.subTest(label):
                self.assertEqual(leg_verdict(facts(**change)).verdict, VERDICT_REVERT_PAYMENT)


class TestEveryRefusal(unittest.TestCase):
    """(label, changed facts, title, exact sentence, where to fix it)."""

    TABLE = [
        (
            "already reversed",
            {"match_kind": "Reversed"},
            "Already reversed",
            "This allocation was already reversed. A correction supersedes rather than un-happens.",
            None,
        ),
        (
            "not a Project Payments leg",
            {"target_doctype": "Project Expenses"},
            "Not a payment",
            "Only a Project Payments allocation can be reversed here.",
            None,
        ),
        (
            "the payment no longer exists",
            {"target_exists": False},
            "Not found",
            "Payment 'PAY-1' not found.",
            None,
        ),
        (
            "non-zero TDS",
            {"tds": 1.5},
            "Settled with TDS",
            "PAY-1 carries a TDS figure -- withheld tax that this reversal does not clear -- "
            "putting it back to Approved would leave a tax figure on a payment that is waiting to "
            "be paid again. Reverse it on the payments screen, where both the status and the TDS "
            "can be corrected together.",
            FIX_ON_PAYMENTS_SCREEN,
        ),
        (
            "the carried-forward balance half of a split",
            {"split_from": "PAY-0"},
            "Part of a split payment",
            "PAY-1 is the carried-forward balance of a payment that was split, so reversing it "
            "here would leave that split half-undone. Correct it on the payments screen, where "
            "both halves are visible.",
            FIX_ON_PAYMENTS_SCREEN,
        ),
        (
            "the settled half of a split",
            {"split_balance": "PAY-2"},
            "Split by a partial settlement",
            "PAY-1 was settled by a PARTIAL settlement, which split the record and left PAY-2 "
            "standing as its Approved balance. Reversing only the settled half would turn one "
            "sanction into two. Undo the split on the payments screen instead.",
            FIX_ON_PAYMENTS_SCREEN,
        ),
        (
            "the amount differs from the leg",
            {"target_amount": 61.0},
            "Changed elsewhere",
            "PAY-1 now reads 61.0, but this allocation wrote 60.0 against it. Somebody has changed "
            "the record since, so this reversal cannot know what to put back. Correct the payment "
            "by hand.",
            FIX_ON_PAYMENTS_SCREEN,
        ),
        (
            "status is not Paid",
            {"target_status": "Approved"},
            "Changed elsewhere",
            "PAY-1 is 'Approved', not Paid. Somebody has already changed it.",
            FIX_ON_PAYMENTS_SCREEN,
        ),
        (
            "status is blank",
            {"target_status": None},
            "Changed elsewhere",
            "PAY-1 is 'None', not Paid. Somebody has already changed it.",
            FIX_ON_PAYMENTS_SCREEN,
        ),
        (
            "reference is not one of the line's settlement references",
            {"target_reference": "SOMEONE-ELSE"},
            "Changed elsewhere",
            "PAY-1 carries reference 'SOMEONE-ELSE', not this transfer's. Somebody has re-pointed "
            "it, so this allocation cannot be safely reversed.",
            FIX_ON_PAYMENTS_SCREEN,
        ),
    ]

    def test_each_refusal_reproduces_its_sentence(self):
        for label, change, title, sentence, fix_at in self.TABLE:
            with self.subTest(label):
                verdict = leg_verdict(facts(**change))
                self.assertEqual(verdict.verdict, VERDICT_REFUSED)
                self.assertEqual(verdict.title, title)
                self.assertEqual(verdict.reason, sentence)
                self.assertEqual(verdict.fix_at, fix_at)
                self.assertEqual(verdict.leg, "MATCH-1")


class TestTheOrderTheRefusalsAreAskedIn(unittest.TestCase):
    """⚠️ A leg can be wrong in several ways at once, and the sentence names only ONE. The order is
    the endpoint's historical order, so a leg that used to be refused with one sentence is not now
    refused with another."""

    def test_already_reversed_wins_over_everything(self):
        verdict = leg_verdict(
            facts(match_kind="Reversed", target_doctype="Project Expenses", tds=5)
        )
        self.assertEqual(verdict.title, "Already reversed")

    def test_a_non_payment_leg_is_never_judged_on_payment_facts(self):
        verdict = leg_verdict(facts(target_doctype="Project Expenses", target_exists=False))
        self.assertEqual(verdict.title, "Not a payment")

    def test_tds_is_named_before_a_split(self):
        self.assertEqual(
            leg_verdict(facts(tds=2, split_from="PAY-0")).title, "Settled with TDS"
        )

    def test_the_balance_half_is_named_before_the_settled_half(self):
        self.assertEqual(
            leg_verdict(facts(split_from="PAY-0", split_balance="PAY-2")).title,
            "Part of a split payment",
        )

    def test_a_split_is_named_before_an_amount_change(self):
        self.assertEqual(
            leg_verdict(facts(split_balance="PAY-2", target_amount=1)).title,
            "Split by a partial settlement",
        )

    def test_an_amount_change_is_named_before_a_status_change(self):
        verdict = leg_verdict(facts(target_amount=61.0, target_status="Approved"))
        self.assertIn("now reads", verdict.reason)

    def test_a_status_change_is_named_before_a_re_point(self):
        verdict = leg_verdict(facts(target_status="Approved", target_reference="ELSE"))
        self.assertIn("not Paid", verdict.reason)


class TestFirstRefusal(unittest.TestCase):
    def test_none_when_every_leg_is_reversible(self):
        verdicts = [leg_verdict(REVERSIBLE), leg_verdict(facts(leg="MATCH-2"))]
        self.assertIsNone(first_refusal(verdicts))

    def test_the_first_refused_leg_in_the_order_given(self):
        verdicts = [
            leg_verdict(REVERSIBLE),
            leg_verdict(facts(leg="MATCH-2", tds=1)),
            leg_verdict(facts(leg="MATCH-3", match_kind="Reversed")),
        ]
        refused = first_refusal(verdicts)
        self.assertEqual(refused.leg, "MATCH-2")
        self.assertEqual(refused.title, "Settled with TDS")


class TestItIsPure(unittest.TestCase):
    def test_the_module_imports_no_frappe(self):
        """The decision is a function of a snapshot. A database read in here would make the verdict
        depend on WHEN it ran -- and the write path recomputes it under a lock precisely so that
        cannot happen."""
        with open(unreconcile.__file__) as handle:
            source = handle.read()
        self.assertNotIn("import frappe", source)
        self.assertNotIn("from frappe", source)


if __name__ == "__main__":
    unittest.main()
