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
    CASHBOOK_REFUSAL,
    FIX_ON_EXPENSES_SCREEN,
    FIX_ON_PAYMENTS_SCREEN,
    VERDICT_REFUSED,
    VERDICT_REVERT_EXPENSE,
    VERDICT_REVERT_PAYMENT,
    LegFacts,
    expense_created_by_import,
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
            # ⚠️ INVERTED AT #1277: this was "Not a payment" for ANY other ledger. Expenses now
            # revert (see `TestAnExistingExpense`); an inflow is still refused, until `delete_created`.
            "an inflow leg",
            {"target_doctype": "Project Inflows"},
            "Can't be undone yet",
            "A Project Inflows record can't be unreconciled here yet.",
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
            facts(match_kind="Reversed", target_doctype="Project Inflows", tds=5)
        )
        self.assertEqual(verdict.title, "Already reversed")

    def test_an_unsupported_leg_is_never_judged_on_payment_facts(self):
        verdict = leg_verdict(facts(target_doctype="Project Inflows", target_exists=False))
        self.assertEqual(verdict.title, "Can't be undone yet")

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


class TestCashbook(unittest.TestCase):
    """#1275, parent #1270 Q13: a Cashbook line cannot be unreconciled yet, whatever its legs."""

    def test_a_cashbook_leg_is_refused_with_the_screen_sentence(self):
        verdict = leg_verdict(facts(source="Cashbook"))
        self.assertEqual(verdict.verdict, VERDICT_REFUSED)
        self.assertEqual(verdict.title, "Cashbook line")
        self.assertEqual(verdict.reason, CASHBOOK_REFUSAL)
        self.assertEqual(CASHBOOK_REFUSAL, "Cashbook rows can't be unreconciled yet.")
        self.assertIsNone(verdict.what_happens)

    def test_cashbook_is_named_before_every_other_refusal(self):
        verdict = leg_verdict(
            facts(source=" Cashbook ", match_kind="Reversed", target_doctype="Project Inflows")
        )
        self.assertEqual(verdict.reason, CASHBOOK_REFUSAL)

    def test_every_other_source_is_judged_as_before(self):
        for source in ("Cashfree", "ICICI", "", None):
            with self.subTest(source=source):
                self.assertEqual(leg_verdict(facts(source=source)).verdict, VERDICT_REVERT_PAYMENT)


class TestWhatHappens(unittest.TestCase):
    """The one-line sentence the Unreconcile dialog shows beside each record (#1275, mockup scene 2)."""

    def test_a_reverted_payment_says_it_goes_back_to_approved(self):
        self.assertEqual(
            leg_verdict(REVERSIBLE).what_happens,
            "Goes back to Approved. Its UTR and payment date are cleared.",
        )

    def test_a_refused_leg_has_no_what_happens_sentence(self):
        for _, change, *_ in TestEveryRefusal.TABLE:
            with self.subTest(change=change):
                self.assertIsNone(leg_verdict(facts(**change)).what_happens)


EXP = "EXP-1"

# An expense leg that CAN be reverted: a hand Link to an Approved expense this import did not create.
REVERTIBLE_EXPENSE = LegFacts(
    leg="MATCH-9",
    match_kind="Settled",
    target_doctype="Project Expenses",
    target_name=EXP,
    leg_amount=500.0,
    target_exists=True,
    target_status="Paid",
    target_amount="500",
    target_reference=REF,
    settlement_references=(REF,),
    source="Cashfree",
    created_by_import=False,
)


def expense(**changes) -> LegFacts:
    return dataclasses.replace(REVERTIBLE_EXPENSE, **changes)


class TestAnExistingExpense(unittest.TestCase):
    """#1277: a leg on an expense the import did not create goes back to Approved."""

    def test_a_project_expense_reverts_and_says_paid_by_is_cleared(self):
        verdict = leg_verdict(REVERTIBLE_EXPENSE)
        self.assertEqual(verdict.verdict, VERDICT_REVERT_EXPENSE)
        self.assertIsNone(verdict.reason)
        self.assertEqual(
            verdict.what_happens,
            "Goes back to Approved. Payment date, reference and 'paid by' are cleared.",
        )

    def test_a_non_project_expense_reverts_and_has_no_paid_by_to_mention(self):
        verdict = leg_verdict(expense(target_doctype="Non Project Expenses", target_amount=500.0))
        self.assertEqual(verdict.verdict, VERDICT_REVERT_EXPENSE)
        self.assertEqual(
            verdict.what_happens, "Goes back to Approved. Payment date and reference are cleared."
        )

    def test_payment_only_facts_never_refuse_an_expense(self):
        # An expense has no TDS and no split; stray values must not borrow the payment refusals.
        self.assertEqual(
            leg_verdict(expense(tds=5, split_from="X", split_balance="Y")).verdict,
            VERDICT_REVERT_EXPENSE,
        )

    def test_a_blank_stored_reference_is_not_a_re_point(self):
        self.assertEqual(leg_verdict(expense(target_reference=None)).verdict, VERDICT_REVERT_EXPENSE)

    TABLE = [
        (
            "the expense no longer exists",
            {"target_exists": False},
            "Not found",
            "Expense 'EXP-1' not found.",
            None,
        ),
        (
            "the amount differs from the leg",
            {"target_amount": "450"},
            "Changed elsewhere",
            "EXP-1 now reads 450, but this allocation wrote 500.0 against it. Somebody has changed "
            "the record since, so this reversal cannot know what to put back. Correct the expense "
            "by hand.",
            FIX_ON_EXPENSES_SCREEN,
        ),
        (
            "status is not Paid",
            {"target_status": "Approved"},
            "Changed elsewhere",
            "EXP-1 is 'Approved', not Paid. Somebody has already changed it.",
            FIX_ON_EXPENSES_SCREEN,
        ),
        (
            "reference is not one of the line's settlement references",
            {"target_reference": "SOMEONE-ELSE"},
            "Changed elsewhere",
            "EXP-1 carries reference 'SOMEONE-ELSE', not this transfer's. Somebody has re-pointed "
            "it, so this allocation cannot be safely reversed.",
            FIX_ON_EXPENSES_SCREEN,
        ),
        (
            "not proven to be an expense the import did not create",
            {"created_by_import": None},
            "Can't be undone yet",
            "EXP-1 may have been recorded by this import, and a record the import created can't be "
            "undone yet.",
            None,
        ),
        (
            "an expense the import created",
            {"created_by_import": True},
            "Can't be undone yet",
            "EXP-1 may have been recorded by this import, and a record the import created can't be "
            "undone yet.",
            None,
        ),
    ]

    def test_each_refusal_reproduces_its_sentence(self):
        for label, change, title, sentence, fix_at in self.TABLE:
            with self.subTest(label):
                verdict = leg_verdict(expense(**change))
                self.assertEqual(verdict.verdict, VERDICT_REFUSED)
                self.assertEqual(verdict.title, title)
                self.assertEqual(verdict.reason, sentence)
                self.assertEqual(verdict.fix_at, fix_at)
                self.assertIsNone(verdict.what_happens)

    def test_changed_elsewhere_is_named_before_the_created_question(self):
        # What is true of the record NOW is what a person can act on; the created question is ours.
        verdict = leg_verdict(expense(target_status="Approved", created_by_import=None))
        self.assertIn("not Paid", verdict.reason)

    def test_cashbook_and_already_reversed_still_come_first(self):
        self.assertEqual(leg_verdict(expense(source="Cashbook")).reason, CASHBOOK_REFUSAL)
        self.assertEqual(
            leg_verdict(expense(match_kind="Reversed", target_exists=False)).title,
            "Already reversed",
        )


class TestProvingTheImportDidNotCreateAnExpense(unittest.TestCase):
    """Until the created-by-import flag exists, `created_by_import` is False ONLY on proof.

    A created expense is inserted already Paid, and an insert leaves no Version row, so its history
    before the match holds no status that was ever anything but Paid. Either proof below is therefore
    impossible for a record the import created; anything else stays unknown (`None`) and is refused.
    """

    def test_a_record_older_than_the_statement_upload_was_not_created_by_it(self):
        self.assertIs(
            expense_created_by_import(created_before_import=True, status_changes_before_match=()),
            False,
        )

    def test_a_record_that_was_once_not_paid_before_the_match_was_not_created_by_it(self):
        for changes in ([("Approved", "Paid")], [("Requested", "Approved"), ("Approved", "Paid")]):
            with self.subTest(changes=changes):
                self.assertIs(
                    expense_created_by_import(
                        created_before_import=False, status_changes_before_match=changes
                    ),
                    False,
                )

    def test_no_proof_is_unknown_never_a_guess(self):
        for changes in ((), [("Paid", "Paid ")], [(" Paid", "Approved")]):
            with self.subTest(changes=changes):
                self.assertIsNone(
                    expense_created_by_import(
                        created_before_import=False, status_changes_before_match=changes
                    )
                )


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
