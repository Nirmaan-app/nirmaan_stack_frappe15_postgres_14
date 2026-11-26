# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The one-off patch that stores a card statement's Previous Balance as negative where the statement printed it in
credit (#1771).

Each statement is seeded as the card upload stores one, with made-up figures, and the patch runs on this test's
statements only. ⚠️ It calls `correct_previous_balances(statements=...)`, never `execute()`, which would correct
every such statement on the site. Nothing here commits, so the rollback after each test removes the statements.

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_card_previous_balance_patch
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.outflow_import.card_upload import STATEMENT_DOCTYPE
from nirmaan_stack.patches.v3_0.card_statement_previous_balance_in_credit import correct_previous_balances

FIGURES = ("previous_balance", "purchases_charges", "cash_advances", "payments_credits", "total_amount_due")


class TestThePreviousBalancePatch(FrappeTestCase):
    def setUp(self):
        super().setUp()
        self.holder = f"TEST HOLDER {frappe.generate_hash(length=6).upper()}"
        self.statements: list[str] = []
        self.addCleanup(frappe.db.rollback)

        # The statement printed ₹1,500.25 CR: -1,500.25 + 9,000.50 + 0.00 - 500.00 = 7,000.25. Stored before #1771.
        self.credit_stored_as_owed = self._statement(3, 1500.25, 9000.50, 0, 500, 7000.25)
        # 2,000.00 + 3,000.00 + 100.00 - 1,000.00 = 4,100.00.
        self.adds_up = self._statement(4, 2000, 3000, 100, 1000, 4100)
        # Adds up neither as stored (11,000.00) nor with the Previous Balance negative (7,000.00).
        self.adds_up_neither_way = self._statement(5, 2000, 10000, 0, 1000, 9999)

    def _statement(self, month: int, *figures: float) -> str:
        record = frappe.new_doc(STATEMENT_DOCTYPE)
        record.update(
            {
                "holder": self.holder,
                "period_from": f"2026-{month:02d}-02",
                "period_to": f"2026-{month + 1:02d}-01",
                **dict(zip(FIGURES, figures)),
            }
        )
        record.insert(ignore_permissions=True)
        self.statements.append(record.name)
        return record.name

    def _stored(self, name: str) -> dict:
        return frappe.db.get_value(STATEMENT_DOCTYPE, name, [*FIGURES, "modified"], as_dict=True)

    def test_only_the_credit_stored_as_owed_is_negated_and_only_once(self):
        before = {name: self._stored(name) for name in self.statements}

        self.assertEqual(correct_previous_balances(statements=self.statements), [self.credit_stored_as_owed])

        corrected = self._stored(self.credit_stored_as_owed)
        self.assertEqual(corrected.previous_balance, -1500.25)
        for figure in FIGURES[1:]:
            self.assertEqual(corrected[figure], before[self.credit_stored_as_owed][figure], figure)
        for name in (self.adds_up, self.adds_up_neither_way):
            self.assertEqual(self._stored(name), before[name], name)

        # A second run finds the corrected statement adding up, and changes nothing.
        after_first_run = {name: self._stored(name) for name in self.statements}
        self.assertEqual(correct_previous_balances(statements=self.statements), [])
        self.assertEqual({name: self._stored(name) for name in self.statements}, after_first_run)
