# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Wallet Credit is planned as a *Wallet credit expense* (#1720, ADR-0015 Amendment E), placed from its remark the
way a spend is; an unpaired refund whose spend has no Expense is placed the same way.

Seam: the pure plan step, `plan_statement`, and Review's payload (`cashbook_review.preview_payload`).

Run: DEVENV unit nirmaan_stack.services.outflow_import.test_cashbook_wallet_credit
"""

import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from nirmaan_stack.services.outflow_import.cashbook import ACTION_CREATE, plan_statement
from nirmaan_stack.services.outflow_import.cashbook_review import group_plan, invoice_counts, preview_payload
from nirmaan_stack.services.outflow_import.duplicates import DuplicateVerdict
from nirmaan_stack.services.outflow_import.parser import DIRECTION_CREDIT
from nirmaan_stack.services.outflow_import.project_match import build_project_index
from nirmaan_stack.services.outflow_import.test_cashbook import ALIASES, PROJECTS, RULES, TELUS, _row

PROJECT_LEDGER = "Project Expenses"
NON_PROJECT_LEDGER = "Non Project Expenses"
CREDIT = "PTM9000000006"


def _plan(rows, booked=None):
    return plan_statement(rows, build_project_index(PROJECTS, aliases=ALIASES), RULES, already_booked=booked)


def _credit(amount="9000", remarks="Paytm site scrap amount", transfer_id=CREDIT, number=1):
    return _row(
        number=number, transfer_id=transfer_id, amount="0", credit=amount, kind="Wallet Credit",
        remarks=remarks, payee="A Wallet Holder", spender="A Staff Member", added_on=date(2026, 8, 17),
    )


def _line(plan, transfer_id):
    (line,) = [r for r in plan.rows if r.transfer_id == transfer_id]
    return line


class TestAWalletCreditIsPlacedFromItsRemark(unittest.TestCase):
    def test_a_remark_naming_one_project_makes_a_project_expense_on_it(self):
        credit = _line(_plan([_credit(remarks="Scrap sold at Telus GIFT City, transport back")]), CREDIT)
        self.assertEqual(credit.action, ACTION_CREATE)
        self.assertEqual(
            (credit.ledger, credit.project, credit.project_name, credit.expense_type),
            (PROJECT_LEDGER, TELUS, "Telus GIFT City", "Material Transportation Charges"),
        )
        # The line keeps its Credit as its money (its identity); the job writes the Expense at minus it.
        self.assertEqual((credit.amount, credit.direction), (Decimal("9000"), DIRECTION_CREDIT))

    def test_any_other_remark_makes_a_non_project_expense_typed_from_it_else_petty_cash(self):
        typed = _line(_plan([_credit(remarks="Courier charges paid back")]), CREDIT)
        self.assertEqual((typed.action, typed.ledger, typed.project, typed.expense_type),
                         (ACTION_CREATE, NON_PROJECT_LEDGER, None, "Postage & Courier"))
        plain = _line(_plan([_credit(remarks="UPI")]), CREDIT)
        self.assertEqual((plain.ledger, plain.expense_type), (NON_PROJECT_LEDGER, "Petty Cash"))


class TestARefundWhoseSpendHasNoExpenseIsPlacedTheSameWay(unittest.TestCase):
    """Owner decision 3 (#1720): one rule for both money-in kinds."""

    def _refund(self, remarks):
        refund = _row(
            number=2, transfer_id="REF-OBO77", amount="0", credit="400", kind="Refund to Wallet", status="REFUNDED",
            remarks=remarks, added_on=date(2026, 8, 17),
        )
        return _line(_plan([refund]), "REF-OBO77")

    def test_a_remark_naming_one_project_puts_it_on_that_project(self):
        refund = self._refund("Refund for printout Telus GIFT City")
        self.assertEqual(
            (refund.action, refund.ledger, refund.project, refund.project_name, refund.expense_type),
            (ACTION_CREATE, PROJECT_LEDGER, TELUS, "Telus GIFT City", "Project Printing Charges"),
        )
        self.assertEqual((refund.refund_of, refund.reduces, refund.spend_on_statement), ("OBO77", "", False))

    def test_any_other_remark_stays_non_project(self):
        refund = self._refund("Refund for business card printing")
        self.assertEqual((refund.ledger, refund.project, refund.expense_type),
                         (NON_PROJECT_LEDGER, None, "Printing & Stationery"))


class TestReviewListsCreditsInTheirOwnGroup(unittest.TestCase):
    """Owner decision 4 (#1720): each credit with where it goes, apart from the spends; the header counts spends."""

    def setUp(self):
        spend = _row(number=2, transfer_id="OBO1", amount="500", remarks="Courier", links=("https://x/1",))
        self.plan = _plan([_credit(remarks="Scrap sold at Telus GIFT City"), spend])

    def test_the_credit_is_in_no_spend_group_nor_the_spend_total_nor_the_bill_counts(self):
        self.assertEqual([r.transfer_id for r in self.plan.crediting], [CREDIT])
        self.assertEqual([r.transfer_id for g in group_plan(self.plan) for r in g.rows], ["OBO1"])
        self.assertEqual(self.plan.total_value, Decimal("500"))
        counts = invoice_counts(self.plan)
        self.assertEqual((counts.one_file, counts.merged, counts.waiting), (1, 0, 0))

    def test_the_payload_lists_each_credit_with_where_it_goes(self):
        parsed = SimpleNamespace(rows=[None, None], period_from=None, period_to=None, warnings=[])
        verdict = DuplicateVerdict(total=2, duplicates=0, new=2, refuse=False, warn=False, message="")
        payload = preview_payload(parsed, self.plan, "s.xlsx", verdict, [])
        (credit,) = payload["credits"]
        self.assertEqual(
            {k: credit[k] for k in ("transfer_id", "amount", "row_kind", "ledger", "project_name", "expense_type")},
            {
                "transfer_id": CREDIT,
                "amount": 9000.0,
                "row_kind": "Wallet Credit",
                "ledger": PROJECT_LEDGER,
                "project_name": "Telus GIFT City",
                "expense_type": "Petty Cash",
            },
        )
        self.assertEqual((payload["creating"], payload["spending"], payload["total_value"]), (2, 1, 500.0))
        self.assertEqual((payload["refunds"], payload["open_lines"]), ([], []))
