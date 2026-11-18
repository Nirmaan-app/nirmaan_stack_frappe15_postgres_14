# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""An unpaired wallet refund is planned as a *Wallet refund expense* (#1709, spec #1711, ADR-0015 Amendment D).

Seam: the pure plan step, `plan_statement`, and Review's payload (`cashbook_review.preview_payload`).

Run: DEVENV unit nirmaan_stack.services.outflow_import.test_cashbook_refund_expense
"""

import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from nirmaan_stack.services.outflow_import.cashbook import ACTION_CREATE, ACTION_OPEN, ACTION_SKIP, SKIP_ALREADY_BOOKED
from nirmaan_stack.services.outflow_import.cashbook_refund_expense import (
    RefundPlacement,
    SpendExpense,
    refund_description,
    refund_placement,
)
from nirmaan_stack.services.outflow_import.cashbook_review import group_plan, invoice_counts, preview_payload
from nirmaan_stack.services.outflow_import.duplicates import DuplicateVerdict
from nirmaan_stack.services.outflow_import.parser import DIRECTION_CREDIT
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_CASHBOOK_REFUND_PAIR, SKIP_KIND_OUTFLOW_RECORDED
from nirmaan_stack.services.outflow_import.test_cashbook import (
    ALIASES,
    PROJECTS,
    RULES,
    TELUS,
    _row,
    _sightings,
)
from nirmaan_stack.services.outflow_import.cashbook import plan_statement
from nirmaan_stack.services.outflow_import.project_match import build_project_index

PROJECT_LEDGER = "Project Expenses"
NON_PROJECT_LEDGER = "Non Project Expenses"
SPEND = "OBO1781597449301W2WH9D"
REFUND = "REF-" + SPEND


def _plan(rows, spends=None, booked=None):
    return plan_statement(
        rows,
        build_project_index(PROJECTS, aliases=ALIASES),
        RULES,
        already_booked=booked,
        refunded_spends=spends or {},
    )


def _refund(amount="11248", transfer_id=REFUND, remarks="Credit Adj - Orig Amount: 17446.0", number=2, **kw):
    return _row(
        number=number, transfer_id=transfer_id, amount="0", credit=amount, kind="Credit Adjustment",
        status="REFUNDED", remarks=remarks, payee="MakemytripIndia Pvt Ltd", added_on=date(2026, 6, 22), **kw,
    )


def _line(plan, transfer_id):
    (line,) = [r for r in plan.rows if r.transfer_id == transfer_id]
    return line


class TestAnUnpairedRefundBooksOnItsSpendsExpense(unittest.TestCase):
    def test_a_refund_whose_spend_has_an_expense_goes_on_that_expense_as_it_is_now(self):
        spends = {SPEND: SpendExpense(PROJECT_LEDGER, "PE-0042", TELUS, "Telus GIFT City", "Travel Expenses")}
        refund = _line(_plan([_refund()], spends), REFUND)
        self.assertEqual(refund.action, ACTION_CREATE)
        self.assertEqual(
            (refund.ledger, refund.project, refund.project_name, refund.expense_type),
            (PROJECT_LEDGER, TELUS, "Telus GIFT City", "Travel Expenses"),
        )
        self.assertEqual((refund.refund_of, refund.reduces), (SPEND, "PE-0042"))
        # The line keeps its Credit as its money (its identity); the Expense is written at minus it by the job.
        self.assertEqual((refund.amount, refund.direction), (Decimal("11248"), DIRECTION_CREDIT))

    def test_a_part_refund_of_a_spend_on_the_same_statement_goes_where_that_spend_goes(self):
        spend = _row(number=1, transfer_id=SPEND, amount="17446", remarks="Flight tickets Telus GIFT City")
        plan = _plan([spend, _refund()])
        refund = _line(plan, REFUND)
        self.assertEqual(refund.action, ACTION_CREATE)
        self.assertEqual((refund.ledger, refund.project, refund.expense_type), (PROJECT_LEDGER, TELUS, "Petty Cash"))
        self.assertEqual((refund.refund_of, refund.reduces, refund.spend_on_statement), (SPEND, "", True))
        self.assertEqual(_line(plan, SPEND).action, ACTION_CREATE)

    def test_the_spends_existing_expense_wins_whatever_the_spends_date(self):
        """Owner (2026-11-18): "has an Expense" is the only test; a spend before 1 Apr 2026 with one counts."""
        spends = {SPEND: SpendExpense(NON_PROJECT_LEDGER, "9surl50t7h", None, "", "Travel Expenses")}
        refund = _line(_plan([_refund()], spends), REFUND)
        self.assertEqual((refund.ledger, refund.expense_type, refund.reduces), (NON_PROJECT_LEDGER, "Travel Expenses", "9surl50t7h"))

    def test_a_refund_whose_spend_has_no_expense_is_a_non_project_expense_typed_from_its_remark(self):
        refund = _line(_plan([_refund(remarks="Refund for business card printing Telus GIFT City")]), REFUND)
        self.assertEqual(refund.action, ACTION_CREATE)
        # Never on a project, though its remark names one (owner decision 2).
        self.assertEqual((refund.ledger, refund.project, refund.expense_type), (NON_PROJECT_LEDGER, None, "Printing & Stationery"))
        self.assertEqual((refund.refund_of, refund.reduces, refund.spend_on_statement), (SPEND, "", False))

    def test_a_refund_naming_no_spend_is_a_petty_cash_non_project_expense(self):
        refund = _line(_plan([_refund(transfer_id="CRADJ-77", remarks="Adjustment")]), "CRADJ-77")
        self.assertEqual((refund.action, refund.ledger, refund.expense_type), (ACTION_CREATE, NON_PROJECT_LEDGER, "Petty Cash"))
        self.assertEqual(refund.refund_of, "")


class TestWhatStaysAsItWas(unittest.TestCase):
    def test_a_full_refund_on_the_same_statement_still_pairs_and_skips_both_lines(self):
        spend = _row(number=1, transfer_id=SPEND, amount="11248")
        plan = _plan([spend, _refund()], {SPEND: SpendExpense(NON_PROJECT_LEDGER, "X", None, "", "Petty Cash")})
        for line in plan.rows:
            self.assertEqual((line.action, line.skip_kind), (ACTION_SKIP, SKIP_KIND_CASHBOOK_REFUND_PAIR))

    def test_a_wallet_credit_stays_open(self):
        credit = _row(transfer_id="PTM9", amount="0", credit="9000", kind="Wallet Credit")
        self.assertEqual(_plan([credit]).rows[0].action, ACTION_OPEN)

    def test_a_refund_already_booked_as_its_negative_expense_is_skipped(self):
        booked = _sightings((REFUND, "-11248", date(2026, 6, 22), "Non Project Expenses NPE-9"))
        refund = _line(_plan([_refund()], booked=booked), REFUND)
        self.assertEqual((refund.action, refund.skip_kind), (ACTION_SKIP, SKIP_KIND_OUTFLOW_RECORDED))
        self.assertEqual(refund.reason, SKIP_ALREADY_BOOKED.format(record="Non Project Expenses NPE-9"))


class TestReviewListsRefundsApart(unittest.TestCase):
    def setUp(self):
        spend = _row(number=1, transfer_id="OBO1", amount="500", remarks="Courier", links=("https://x/1",))
        spends = {SPEND: SpendExpense(NON_PROJECT_LEDGER, "9surl50t7h", None, "", "Travel Expenses")}
        self.plan = _plan([spend, _refund()], spends)

    def test_the_refund_is_created_but_never_in_a_spend_group_nor_the_spend_total_nor_the_bill_counts(self):
        self.assertEqual(len(self.plan.creating), 2)
        self.assertEqual([r.transfer_id for r in self.plan.refunding], [REFUND])
        self.assertEqual([r.transfer_id for g in group_plan(self.plan) for r in g.rows], ["OBO1"])
        self.assertEqual(self.plan.total_value, Decimal("500"))
        counts = invoice_counts(self.plan)
        self.assertEqual((counts.one_file, counts.merged, counts.waiting), (1, 0, 0))

    def test_the_payload_lists_each_refund_with_the_spend_it_reduces(self):
        parsed = SimpleNamespace(rows=[None, None], period_from=None, period_to=None, warnings=[])
        verdict = DuplicateVerdict(total=2, duplicates=0, new=2, refuse=False, warn=False, message="")
        payload = preview_payload(parsed, self.plan, "s.xlsx", verdict, [])
        (refund,) = payload["refunds"]
        self.assertEqual(
            {k: refund[k] for k in ("transfer_id", "amount", "refund_of", "reduces", "ledger", "expense_type")},
            {
                "transfer_id": REFUND,
                "amount": 11248.0,
                "refund_of": SPEND,
                "reduces": "9surl50t7h",
                "ledger": NON_PROJECT_LEDGER,
                "expense_type": "Travel Expenses",
            },
        )
        self.assertEqual(payload["creating"], 2)
        # The headline's count is the spends only, as `total_value` sums them; the refund is under `refunds`.
        self.assertEqual((payload["spending"], payload["total_value"]), (1, 500.0))
        self.assertEqual(payload["open_lines"], [])


class TestThePlacementHasOneShape(unittest.TestCase):
    """`refund_placement` answers with the same fields on every branch, so no reader has to ask which keys it got."""

    RULES = {"Non Project": (("flight", "Travel Expenses"),)}

    def test_booked_planned_and_neither_each_fill_every_field(self):
        booked = refund_placement(REFUND, "", SpendExpense(PROJECT_LEDGER, "PE-1", "P-1", "Telus", "Tools"), None, {})
        self.assertEqual(
            booked, RefundPlacement(PROJECT_LEDGER, "P-1", "Telus", "Tools", "", SPEND, "PE-1", False)
        )
        planned = {"ledger": NON_PROJECT_LEDGER, "project": None, "project_name": "", "expense_type": "Petty Cash"}
        self.assertEqual(
            refund_placement(REFUND, "", None, planned, {}),
            RefundPlacement(NON_PROJECT_LEDGER, None, "", "Petty Cash", "", SPEND, "", True),
        )
        self.assertEqual(
            refund_placement("CRADJ-7", "flight refund", None, None, self.RULES),
            RefundPlacement(NON_PROJECT_LEDGER, None, "", "Travel Expenses", "flight", "", "", False),
        )


class TestTheDescription(unittest.TestCase):
    def test_it_names_the_spend_and_the_payee(self):
        self.assertEqual(
            refund_description(REFUND, "MakemytripIndia Pvt Ltd"),
            f"Wallet refund of {SPEND} from MakemytripIndia Pvt Ltd",
        )

    def test_without_a_spend_or_a_payee_it_still_reads(self):
        self.assertEqual(refund_description("CRADJ-77", ""), "Wallet refund")
