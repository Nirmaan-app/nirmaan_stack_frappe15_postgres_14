# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Can this leg be undone, and what happens? -- one table of fact snapshots per verdict (#1271).

Every refusal below is one `reverse_allocation` already made before the decision moved here, and
the sentence it asserts is the one that endpoint printed. A reworded sentence must fail here first.
"""

import dataclasses
import unittest
from datetime import datetime, timedelta
from decimal import Decimal

from nirmaan_stack.services.outflow_import import unreconcile
from nirmaan_stack.services.outflow_import.unreconcile import (
    CASHBOOK_REFUSAL,
    CREATED_WINDOW_SECONDS,
    FIX_ON_EXPENSES_SCREEN,
    FIX_ON_PAYMENTS_SCREEN,
    IMPORT_WRITTEN_FIELDS,
    LEFTOVER_PAID_TITLE,
    LEFTOVER_WRITTEN_FIELDS,
    VERDICT_DELETE_CREATED,
    VERDICT_REFUSED,
    VERDICT_REVERT_EXPENSE,
    VERDICT_REVERT_PAYMENT,
    VERDICT_UNSPLIT_PAYMENT,
    WHAT_HAPPENS_DELETE,
    WHAT_HAPPENS_DELETE_PROJECT_INFLOW,
    WHAT_HAPPENS_UNSPLIT,
    LegFacts,
    SplitChild,
    first_refusal,
    leg_created_the_record,
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
    split_from="",
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
            # #1279: the balance a partial settle of its parent left -- a Settled leg on the parent was
            # matched in the request that created it. "Unreconcile that transfer first" points here.
            (
                "the balance a partial settle of its parent left",
                {
                    "split_from": "PAY-0",
                    "target_created": datetime(2026, 9, 15, 9, 59, 59),
                    "parent_settled_at": (datetime(2026, 9, 15, 10, 0, 0),),
                },
            ),
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
            # revert (see `TestAnExistingExpense`). ⚠️ INVERTED AGAIN AT #1278: an inflow is now
            # deleted (see `TestACreatedRecord`), so the fall-through is pinned on a doctype no
            # settle ever writes a leg against.
            "a leg on a ledger with no undo",
            {"target_doctype": "Vendor Invoices"},
            "Can't be undone yet",
            "A Vendor Invoices record can't be unreconciled here yet.",
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
            "the carried-forward balance half of a split",
            {"split_from": "PAY-0"},
            "Part of a split payment",
            "PAY-1 is the carried-forward balance of a payment that was split, so reversing it "
            "here would leave that split half-undone. Correct it on the payments screen, where "
            "both halves are visible.",
            FIX_ON_PAYMENTS_SCREEN,
        ),
        (
            # A CEO partial approval's balance: its parent has a Settled leg, but not one matched in
            # the request that created the balance.
            "the balance of a split no partial settle made",
            {
                "split_from": "PAY-0",
                "target_created": datetime(2026, 9, 1, 10, 0, 0),
                "parent_settled_at": (datetime(2026, 9, 15, 10, 0, 0),),
            },
            "Part of a split payment",
            "PAY-1 is the carried-forward balance of a payment that was split, so reversing it "
            "here would leave that split half-undone. Correct it on the payments screen, where "
            "both halves are visible.",
            FIX_ON_PAYMENTS_SCREEN,
        ),
        (
            "the settled half of a split",
            {"split_children": (SplitChild(name="PAY-2"),)},
            "Split by a partial settlement",
            "PAY-1 was settled by a PARTIAL settlement, which split the record and left PAY-2 "
            "standing as its unpaid balance. Reversing only the settled half would turn one "
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
            facts(match_kind="Reversed", target_doctype="Project Inflows", target_exists=False)
        )
        self.assertEqual(verdict.title, "Already reversed")

    def test_an_unsupported_leg_is_never_judged_on_payment_facts(self):
        verdict = leg_verdict(facts(target_doctype="Vendor Invoices", target_exists=False))
        self.assertEqual(verdict.title, "Can't be undone yet")

    def test_a_payment_leg_carries_no_legacy_tds_fact(self):
        # ⚠️ INVERTED when `Project Payments.tds` was retired: the "Settled with TDS" refusal went
        # with the field, so a leg has no tax figure to be refused on. A split is now the first
        # payment fact asked about.
        self.assertNotIn("tds", {f.name for f in dataclasses.fields(LegFacts)})
        self.assertEqual(leg_verdict(facts(split_from="PAY-0")).title, "Part of a split payment")

    def test_the_balance_half_is_named_before_the_settled_half(self):
        self.assertEqual(
            leg_verdict(
                facts(split_from="PAY-0", split_children=(SplitChild(name="PAY-2"),))
            ).title,
            "Part of a split payment",
        )

    def test_a_split_is_named_before_an_amount_change(self):
        self.assertEqual(
            leg_verdict(facts(split_children=(SplitChild(name="PAY-2"),), target_amount=1)).title,
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
            "Goes back to Reconciliation Pending. Its UTR and payment date are cleared.",
        )

    def test_a_refused_leg_has_no_what_happens_sentence(self):
        for _, change, *_ in TestEveryRefusal.TABLE:
            with self.subTest(change=change):
                self.assertIsNone(leg_verdict(facts(**change)).what_happens)


EXP = "EXP-1"

# An expense leg that CAN be reverted: a hand Link to an expense this import did not create.
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
    """#1277: a leg on an expense the import did not create goes back to where a settle takes it."""

    def test_a_project_expense_reverts_and_says_paid_by_is_cleared(self):
        verdict = leg_verdict(REVERTIBLE_EXPENSE)
        self.assertEqual(verdict.verdict, VERDICT_REVERT_EXPENSE)
        self.assertIsNone(verdict.reason)
        self.assertEqual(
            verdict.what_happens,
            "Goes back to Reconciliation Pending. Payment date, reference and 'paid by' are cleared.",
        )

    def test_a_non_project_expense_reverts_and_has_no_paid_by_to_mention(self):
        verdict = leg_verdict(expense(target_doctype="Non Project Expenses", target_amount=500.0))
        self.assertEqual(verdict.verdict, VERDICT_REVERT_EXPENSE)
        self.assertEqual(
            verdict.what_happens,
            "Goes back to Reconciliation Pending. Payment date and reference are cleared.",
        )

    def test_payment_only_facts_never_refuse_an_expense(self):
        # An expense has no split; stray values must not borrow the payment refusals.
        self.assertEqual(
            leg_verdict(expense(split_from="X", split_children=(SplitChild(name="Y"),))).verdict,
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
        verdict = leg_verdict(expense(target_status="Approved", created_by_import=True))
        self.assertIn("not Paid", verdict.reason)

    def test_an_unflagged_expense_reverts_whatever_its_history(self):
        """⚠️ INVERTED AT #1278. Until the stored flag, an expense with no proof it existed was refused
        as "can't be undone yet". The flag now decides, and unresolved is "not created" -- the safe
        revert path (#1270). So an unflagged expense with no history at all reverts."""
        verdict = leg_verdict(expense(created_by_import=False, versions=()))
        self.assertEqual(verdict.verdict, VERDICT_REVERT_EXPENSE)
        self.assertIsNone(verdict.reason)

    def test_cashbook_and_already_reversed_still_come_first(self):
        self.assertEqual(leg_verdict(expense(source="Cashbook")).reason, CASHBOOK_REFUSAL)
        self.assertEqual(
            leg_verdict(expense(match_kind="Reversed", target_exists=False)).title,
            "Already reversed",
        )


MATCHED_AT = datetime(2026, 9, 15, 10, 0, 0)
BEFORE = datetime(2026, 9, 15, 9, 59, 59)
AFTER = datetime(2026, 9, 16, 11, 30, 0)

# A leg whose settle CREATED its record, untouched since: every refusal below changes one fact of it.
CREATED_INFLOW = LegFacts(
    leg="MATCH-20",
    match_kind="Settled",
    target_doctype="Project Inflows",
    target_name="PI-1",
    leg_amount=900.0,
    target_exists=True,
    target_amount=900.0,
    source="ICICI",
    matched_at=MATCHED_AT,
)


def created(**changes) -> LegFacts:
    return dataclasses.replace(CREATED_INFLOW, **changes)


class TestACreatedRecord(unittest.TestCase):
    """#1278 (ADR-0022 reverses ADR-0016 AR3): a record the import created is deleted on unreconcile."""

    def test_a_project_inflow_is_deleted_and_says_the_cash_position_moves(self):
        verdict = leg_verdict(CREATED_INFLOW)
        self.assertEqual(verdict.verdict, VERDICT_DELETE_CREATED)
        self.assertIsNone(verdict.reason)
        self.assertEqual(
            verdict.what_happens,
            "Will be deleted. The project's cash position updates straight away.",
        )
        self.assertEqual(WHAT_HAPPENS_DELETE_PROJECT_INFLOW, verdict.what_happens)

    def test_an_inflow_is_created_whatever_its_leg_flag_says(self):
        # Inflow legs are ALWAYS treated as created: the import has no other way to reach one.
        for doctype in ("Project Inflows", "Non Project Inflows"):
            with self.subTest(doctype=doctype):
                verdict = leg_verdict(created(target_doctype=doctype, created_by_import=False))
                self.assertEqual(verdict.verdict, VERDICT_DELETE_CREATED)

    def test_a_non_project_inflow_just_says_it_will_be_deleted(self):
        verdict = leg_verdict(created(target_doctype="Non Project Inflows"))
        self.assertEqual(verdict.what_happens, "Will be deleted.")
        self.assertEqual(WHAT_HAPPENS_DELETE, verdict.what_happens)

    def test_a_flagged_expense_is_deleted(self):
        for doctype in ("Project Expenses", "Non Project Expenses"):
            with self.subTest(doctype=doctype):
                verdict = leg_verdict(
                    expense(target_doctype=doctype, created_by_import=True, matched_at=MATCHED_AT)
                )
                self.assertEqual(verdict.verdict, VERDICT_DELETE_CREATED)
                self.assertEqual(verdict.what_happens, "Will be deleted.")

    def test_edits_before_or_at_the_match_and_attachment_only_edits_are_not_edits(self):
        for label, edits in [
            ("no history", ()),
            ("a Version at the match", ((MATCHED_AT, ("amount",)),)),
            ("a Version before the match", ((BEFORE, ("description",)),)),
            ("the statement attachment", ((AFTER, ("payment_attachment",)),)),
            ("the inflow attachment", ((AFTER, ("inflow_attachment",)),)),
            ("an empty Version", ((AFTER, ()),)),
        ]:
            with self.subTest(label):
                self.assertEqual(
                    leg_verdict(created(versions=edits)).verdict, VERDICT_DELETE_CREATED
                )

    def test_a_record_edited_after_the_match_is_refused_naming_the_first_edit(self):
        edits = (
            (AFTER, ("inflow_attachment",)),
            (datetime(2026, 9, 17, 8, 0), ("amount", "inflow_attachment")),
            (datetime(2026, 9, 18, 8, 0), ("utr",)),
        )
        verdict = leg_verdict(created(versions=edits))
        self.assertEqual(verdict.verdict, VERDICT_REFUSED)
        self.assertEqual(verdict.title, "Edited since")
        self.assertEqual(
            verdict.reason,
            "Someone edited it on 17-Sep-2026, after the import made it. Delete or fix it on its own "
            "screen.",
        )
        self.assertIsNone(verdict.fix_at)
        self.assertIsNone(verdict.what_happens)

    def test_a_flagged_expense_edited_since_is_refused_too(self):
        verdict = leg_verdict(
            expense(
                created_by_import=True,
                matched_at=MATCHED_AT,
                versions=((AFTER, ("description",)),),
            )
        )
        self.assertEqual(verdict.title, "Edited since")

    def test_an_edit_with_no_known_match_time_counts(self):
        # A leg with no `matched_at` cannot place an edit before it; guessing "before" would delete.
        verdict = leg_verdict(created(matched_at=None, versions=((BEFORE, ("amount",)),)))
        self.assertEqual(verdict.title, "Edited since")

    def test_a_missing_inflow_is_not_found(self):
        verdict = leg_verdict(created(target_exists=False))
        self.assertEqual((verdict.title, verdict.reason), ("Not found", "Project Inflows 'PI-1' not found."))

    def test_cashbook_and_already_reversed_still_come_first(self):
        self.assertEqual(leg_verdict(created(source="Cashbook")).reason, CASHBOOK_REFUSAL)
        self.assertEqual(
            leg_verdict(created(match_kind="Reversed", target_exists=False)).title, "Already reversed"
        )

    def test_the_attachment_fields_are_the_ones_the_import_writes(self):
        self.assertEqual(IMPORT_WRITTEN_FIELDS, frozenset({"payment_attachment", "inflow_attachment"}))


class TestTheBackfillRule(unittest.TestCase):
    """Which EXISTING expense legs created their record (#1278 back-fill patch).

    Measured on the local database (2026-09-15, 237 expense legs): every import-created leg was
    written 0-5 s after its expense, by the expense's owner, with no Version before the match; every
    hand Link was minutes to days older. Any doubt is "not created" -- the safe revert path.
    """

    CREATED = dict(
        seconds_from_creation_to_match=2.0,
        same_user=True,
        created_before_import=False,
        status_changes_before_match=(),
    )

    def test_a_record_minted_in_the_settle_request_by_the_same_user_was_created(self):
        self.assertIs(leg_created_the_record(**self.CREATED), True)
        self.assertIs(
            leg_created_the_record(**{**self.CREATED, "seconds_from_creation_to_match": 0}), True
        )
        self.assertIs(
            leg_created_the_record(
                **{**self.CREATED, "seconds_from_creation_to_match": CREATED_WINDOW_SECONDS}
            ),
            True,
        )

    def test_every_doubt_is_not_created(self):
        for label, change in [
            ("older than the window", {"seconds_from_creation_to_match": CREATED_WINDOW_SECONDS + 1}),
            ("a record younger than its match", {"seconds_from_creation_to_match": -1}),
            ("no time at all", {"seconds_from_creation_to_match": None}),
            ("another user", {"same_user": False}),
            ("older than the statement upload", {"created_before_import": True}),
            ("once Approved before the match", {"status_changes_before_match": [("Approved", "Paid")]}),
        ]:
            with self.subTest(label):
                self.assertIs(leg_created_the_record(**{**self.CREATED, **change}), False)

    def test_a_paid_to_paid_version_is_no_proof_of_an_earlier_state(self):
        self.assertIs(
            leg_created_the_record(
                **{**self.CREATED, "status_changes_before_match": [(" Paid", "Paid")]}
            ),
            True,
        )


MATCHED = datetime(2026, 9, 15, 10, 0, 0)

# The balance `settle_row_partial` minted in the same request as the leg: untouched, and waiting at
# the settleable status for its OWN bank line.
#
# ⚠️ IT WAS `Approved` UNTIL #1289. `unsplit` reads the leftover's expected status out of
# `ledgers.SETTLEABLE_STATUSES` now rather than spelling it, precisely so this fixture and the
# production write cannot drift: a stale `Approved` here would have gone green against a rule that
# refuses every leftover the import actually creates.
LEFTOVER = SplitChild(
    name="PAY-2",
    created=MATCHED - timedelta(seconds=1),
    amount=40.0,
    status="Reconciliation Pending",
    has_term=True,
)

# PAY-1 was Rs 100 until a Rs 60 transfer part-settled it, carrying Rs 40 forward as PAY-2.
PART_PAYMENT = facts(matched_at=MATCHED, split_children=(LEFTOVER,))


def part(**changes) -> LegFacts:
    return dataclasses.replace(PART_PAYMENT, **changes)


def with_leftover(**changes) -> LegFacts:
    return part(split_children=(dataclasses.replace(LEFTOVER, **changes),))


class TestAPartPayment(unittest.TestCase):
    """#1279: a payment split by the partial settle this leg made is un-split while its leftover is
    untouched, and refused -- naming the leftover -- otherwise."""

    def test_an_untouched_leftover_is_un_split(self):
        verdict = leg_verdict(PART_PAYMENT)
        self.assertEqual(verdict.verdict, VERDICT_UNSPLIT_PAYMENT)
        self.assertEqual(verdict.what_happens, WHAT_HAPPENS_UNSPLIT)
        self.assertEqual(WHAT_HAPPENS_UNSPLIT, "The split is undone:")
        self.assertEqual(verdict.leftover, "PAY-2")
        self.assertEqual(verdict.leftover_amount, Decimal("40.0"))
        self.assertEqual(verdict.restored_amount, Decimal("100.0"))
        self.assertTrue(verdict.joins_terms)
        self.assertIsNone(verdict.reason)

    def test_a_leftover_with_no_po_term_promises_no_terms(self):
        # A Service Request payment, or a split whose terms never synced.
        self.assertFalse(leg_verdict(with_leftover(has_term=False)).joins_terms)

    def test_every_shape_of_an_untouched_leftover_is_un_split(self):
        for label, change in [
            ("status with whitespace", {"status": " Reconciliation Pending "}),
            # ⚠️ EVERY LEFTOVER MINTED BEFORE #1289 SITS HERE, and nothing migrates them. Refusing
            # it would tell a reviewer to "fix it on the Payments screen", about a record nobody has
            # touched and with no control on that screen that would set the new status on a balance
            # -- a dead end. The 60-second creation window above is what keeps this safe: a CEO
            # part-approval's balance, which reaches `Approved` at its own later approval, is days
            # older and can never arrive here.
            ("the status a pre-#1289 part settle left it at", {"status": "Approved"}),
            ("minted in the same instant as the leg", {"created": MATCHED}),
            (
                "minted at the edge of the window",
                {"created": MATCHED - timedelta(seconds=CREATED_WINDOW_SECONDS)},
            ),
            # Paid by another transfer, then that transfer unreconciled: only settle-written fields.
            (
                "paid and unreconciled since",
                {"versions": (
                    (MATCHED + timedelta(days=1), ("status", "utr", "payment_date", "payment_attachment")),
                    (MATCHED + timedelta(days=2), ("status", "utr", "payment_date")),
                )},
            ),
            # Part-settled by another transfer, then un-split by that transfer's unreconcile: the
            # figure is back, so its `amount` Versions are not an edit.
            (
                "part-settled and un-split since",
                {
                    "amount": 40.0,
                    "created_amount": "40",
                    "versions": (
                        (MATCHED + timedelta(days=1), ("amount", "status", "utr")),
                        (MATCHED + timedelta(days=2), ("amount", "status", "utr")),
                    ),
                },
            ),
        ]:
            with self.subTest(label):
                self.assertEqual(
                    leg_verdict(with_leftover(**change)).verdict, VERDICT_UNSPLIT_PAYMENT
                )

    TABLE = [
        (
            "the leftover was paid by another transfer",
            {"paid_on": datetime(2026, 9, 14, 18, 30), "status": "Paid"},
            "Leftover paid",
            "Its leftover PAY-2 was paid by another transfer on 14-Sep-2026. Unreconcile that "
            "transfer first.",
            None,
        ),
        (
            "the leftover has a TDS deduction",
            {"tds_deducted": True},
            "Leftover taxed",
            "Its leftover PAY-2 has TDS on it. Fix the tax on the Payments screen first.",
            FIX_ON_PAYMENTS_SCREEN,
        ),
        (
            "the leftover is no longer waiting for its own bank line",
            {"status": "Paid"},
            "Leftover changed",
            "Its leftover PAY-2 is 'Paid', not Reconciliation Pending. Fix it on the Payments "
            "screen first.",
            FIX_ON_PAYMENTS_SCREEN,
        ),
        (
            "the leftover was edited after the split",
            {"versions": (
                (MATCHED + timedelta(days=2), ("vendor",)),
                (MATCHED + timedelta(days=1), ("status", "remarks")),
            )},
            "Leftover edited",
            "Its leftover PAY-2 was edited on 16-Sep-2026, after the split. Fix it on the Payments "
            "screen first.",
            FIX_ON_PAYMENTS_SCREEN,
        ),
        (
            "the leftover's amount is not the one it was created with",
            {
                "amount": 39.0,
                "created_amount": 40.0,
                "versions": ((MATCHED + timedelta(days=3), ("amount",)),),
            },
            "Leftover edited",
            "Its leftover PAY-2 was edited on 18-Sep-2026, after the split. Fix it on the Payments "
            "screen first.",
            FIX_ON_PAYMENTS_SCREEN,
        ),
    ]

    def test_each_refusal_names_the_leftover(self):
        for label, change, title, sentence, fix_at in self.TABLE:
            with self.subTest(label):
                verdict = leg_verdict(with_leftover(**change))
                self.assertEqual(verdict.verdict, VERDICT_REFUSED)
                self.assertEqual(verdict.title, title)
                self.assertEqual(verdict.reason, sentence)
                self.assertEqual(verdict.fix_at, fix_at)
                self.assertIsNone(verdict.what_happens)
                self.assertIsNone(verdict.leftover)

    def test_paid_is_named_before_taxed_before_changed_before_edited(self):
        everything = {
            "paid_on": MATCHED + timedelta(days=1),
            "tds_deducted": True,
            "status": "Paid",
            "versions": ((MATCHED + timedelta(days=1), ("remarks",)),),
        }
        self.assertEqual(leg_verdict(with_leftover(**everything)).title, "Leftover paid")
        del everything["paid_on"]
        self.assertEqual(leg_verdict(with_leftover(**everything)).title, "Leftover taxed")
        del everything["tds_deducted"]
        self.assertEqual(leg_verdict(with_leftover(**everything)).title, "Leftover changed")
        del everything["status"]
        self.assertEqual(leg_verdict(with_leftover(**everything)).title, "Leftover edited")

    def test_the_original_is_still_judged_on_its_own_facts(self):
        for change in ({"target_amount": 61.0}, {"target_status": "Approved"}, {"target_reference": "ELSE"}):
            with self.subTest(change=change):
                self.assertEqual(leg_verdict(part(**change)).title, "Changed elsewhere")

    def test_a_split_this_settle_did_not_make_keeps_the_old_refusal(self):
        """A CEO partial approval, or any split minted outside this leg's request, is not undone
        here: nothing says the two halves were ever one sanction the import may join."""
        for label, child in [
            ("minted after the match", dataclasses.replace(LEFTOVER, created=MATCHED + timedelta(seconds=1))),
            ("minted long before the match", dataclasses.replace(
                LEFTOVER, created=MATCHED - timedelta(seconds=CREATED_WINDOW_SECONDS + 1)
            )),
            ("no creation time", dataclasses.replace(LEFTOVER, created=None)),
        ]:
            with self.subTest(label):
                verdict = leg_verdict(part(split_children=(child,)))
                self.assertEqual(verdict.title, "Split by a partial settlement")
                self.assertIn("left PAY-2 standing", verdict.reason)
        verdict = leg_verdict(part(matched_at=None))
        self.assertEqual(verdict.title, "Split by a partial settlement")

    def test_an_older_split_beside_this_settles_leftover_does_not_block_the_un_split(self):
        ceo_half = dataclasses.replace(LEFTOVER, name="PAY-0", created=MATCHED - timedelta(days=30))
        verdict = leg_verdict(part(split_children=(ceo_half, LEFTOVER)))
        self.assertEqual(verdict.verdict, VERDICT_UNSPLIT_PAYMENT)
        self.assertEqual(verdict.leftover, "PAY-2")

    def test_a_leftover_refusal_is_named_before_an_amount_change(self):
        verdict = leg_verdict(part(
            target_amount=1, split_children=(dataclasses.replace(LEFTOVER, tds_deducted=True),)
        ))
        self.assertEqual(verdict.title, "Leftover taxed")

    def test_the_fields_a_settle_and_its_undo_write_are_not_edits(self):
        self.assertEqual(
            LEFTOVER_WRITTEN_FIELDS, {"status", "utr", "payment_date", "payment_attachment"}
        )

    def test_the_paid_refusal_carries_the_title_the_screen_reads_as_not_yet(self):
        verdict = leg_verdict(with_leftover(paid_on=MATCHED + timedelta(days=1)))
        self.assertEqual(verdict.title, LEFTOVER_PAID_TITLE)
        self.assertEqual(LEFTOVER_PAID_TITLE, "Leftover paid")

    def test_the_balance_whose_parent_was_part_settled_in_its_request_reverts(self):
        balance = facts(
            split_from="PAY-0",
            target_created=MATCHED - timedelta(seconds=1),
            parent_settled_at=(MATCHED - timedelta(days=5), MATCHED),
        )
        self.assertEqual(leg_verdict(balance).verdict, VERDICT_REVERT_PAYMENT)
        for label, change in [
            ("no creation time", {"target_created": None}),
            ("no Settled leg on the parent", {"parent_settled_at": ()}),
            ("parent settled long after", {"parent_settled_at": (MATCHED + timedelta(days=1),)}),
        ]:
            with self.subTest(label):
                self.assertEqual(
                    leg_verdict(dataclasses.replace(balance, **change)).title,
                    "Part of a split payment",
                )


class TestFirstRefusal(unittest.TestCase):
    def test_none_when_every_leg_is_reversible(self):
        verdicts = [leg_verdict(REVERSIBLE), leg_verdict(facts(leg="MATCH-2"))]
        self.assertIsNone(first_refusal(verdicts))

    def test_the_first_refused_leg_in_the_order_given(self):
        verdicts = [
            leg_verdict(REVERSIBLE),
            leg_verdict(facts(leg="MATCH-2", target_exists=False)),
            leg_verdict(facts(leg="MATCH-3", match_kind="Reversed")),
        ]
        refused = first_refusal(verdicts)
        self.assertEqual(refused.leg, "MATCH-2")
        self.assertEqual(refused.title, "Not found")


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
