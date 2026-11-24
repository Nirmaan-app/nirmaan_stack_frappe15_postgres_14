# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cashbook plan's rule for a Collect payment (#1708, ADR-0015 Amendment C; was #1595).

A Collect payment is a wallet spend like any other: a successful one that passes the spend skip tests is created by
the job, with the placement a Wallet Spend gets. Seam 3, the pure plan step.
Run: DEVENV unit nirmaan_stack.services.outflow_import.test_cashbook_collect
"""

import unittest
from decimal import Decimal

from nirmaan_stack.services.outflow_import.cashbook import (
    ACTION_CREATE,
    ACTION_SKIP,
    SKIP_NOT_SUCCESSFUL,
    plan_statement,
)
from nirmaan_stack.services.outflow_import.duplicates import index_prior_sightings
from nirmaan_stack.services.outflow_import.project_match import build_project_index
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_OUTFLOW_RECORDED
from nirmaan_stack.services.outflow_import.test_cashbook import ALIASES, PROJECTS, RULES, TELUS, _row

COLLECT = "Collect Payment"


def _plan(*rows, booked=None):
    return plan_statement(list(rows), build_project_index(PROJECTS, aliases=ALIASES), RULES, already_booked=booked)


class TestACollectPaymentIsCreatedLikeAWalletSpend(unittest.TestCase):
    def test_a_successful_collect_payment_is_created_with_no_note(self):
        [line] = _plan(_row(kind=COLLECT, remarks="Collect request approved")).rows
        self.assertEqual((line.action, line.reason, line.skip_kind), (ACTION_CREATE, "", None))
        self.assertEqual(line.row_kind, COLLECT)

    def test_it_is_counted_with_the_spends_the_import_creates(self):
        plan = _plan(_row(kind=COLLECT, amount="480"), _row(number=2, transfer_id="OBO2", amount="20"))
        self.assertEqual([r.transfer_id for r in plan.creating], ["OBO1", "OBO2"])
        self.assertEqual(plan.skipping, ())
        self.assertEqual(plan.total_value, Decimal("500"))

    def test_it_gets_the_placement_a_wallet_spend_would_get(self):
        [line] = _plan(_row(kind=COLLECT, remarks="Courier charges Telus GIFT City")).rows
        self.assertEqual((line.ledger, line.project, line.expense_type),
                         ("Project Expenses", TELUS, "Material Transportation Charges"))
        self.assertEqual(_plan(_row(kind=COLLECT, remarks="Courier charges Telus GIFT City")).for_ledger(
            "Project Expenses"), (line,))

    def test_a_collect_payment_that_did_not_succeed_is_skipped_as_a_wallet_failure(self):
        [line] = _plan(_row(kind=COLLECT, status="FAILED")).rows
        self.assertEqual((line.action, line.reason), (ACTION_SKIP, SKIP_NOT_SUCCESSFUL))

    def test_a_collect_payment_already_booked_is_skipped_as_a_spend_would_be(self):
        raw = _row(kind=COLLECT, amount="480")
        booked = index_prior_sightings([(raw.transfer_id, Decimal("480"), raw.added_on_date, "Non Project Expenses NPE-1")])
        [line] = _plan(raw, booked=booked).rows
        self.assertEqual((line.action, line.skip_kind), (ACTION_SKIP, SKIP_KIND_OUTFLOW_RECORDED))


if __name__ == "__main__":
    unittest.main()
