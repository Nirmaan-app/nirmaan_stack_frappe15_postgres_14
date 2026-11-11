# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""An open Collect payment offers exactly two choices, and Skip by hand is an Admin's or an Accountant Lead's
(spec #1585 "Open Cashbook lines": "An open Collect payment offers Create expense and Skip by hand"; story 39:
"As an Admin or Accountant Lead, I want to Skip by hand an open Collect payment with a typed reason").

Seam 2: the main-table endpoints, on the real-file fixture staged and run as `test_cashbook_collect_payments` does
(`CollectPaymentCase`). Create expense on such a line is pinned there.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_collect_choices
"""

import json

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    allocate_row,
    check_partial_settle,
    settle_expense,
    settle_row_partial,
)
from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.review import get_outflow_rows, skip_row
from nirmaan_stack.api.outflow_import.test_cashbook_collect_payments import (
    COLLECT_NO_LINK,
    CollectPaymentCase,
)
from nirmaan_stack.api.outflow_import.test_skip_row import (
    ACCOUNTANT,
    ACCOUNTANT_LEAD,
    ADMIN,
    _Users,
)
from nirmaan_stack.services.outflow_import.cashbook_collect import (
    COLLECT_PAYMENT_CHOICES_REFUSAL,
    COLLECT_PAYMENT_SKIP_REFUSAL,
)
from nirmaan_stack.services.outflow_import.partial_settle import INTENT_PART_PAYMENT

WALLET_CREDIT = "PTM9000000006"  # an open money-in line of the same statement


class CollectChoicesCase(CollectPaymentCase):
    def setUp(self):
        super().setUp()
        self.users = _Users()
        self.addCleanup(self.users.purge)
        self._run()

    def _skip_as(self, profile: str, txn: str, reason: str = "personal, employee repaid"):
        user = self.users.make(profile)
        frappe.set_user(user)
        try:
            return skip_row(row=self._line(txn).name, reason=reason)
        finally:
            frappe.set_user("Administrator")


class TestSkipByHandOnACollectPayment(CollectChoicesCase):
    def test_an_accountant_is_refused_and_the_line_stays_open(self):
        with self.assertRaises(frappe.PermissionError) as caught:
            self._skip_as(ACCOUNTANT, COLLECT_NO_LINK)
        self.assertIn(COLLECT_PAYMENT_SKIP_REFUSAL, str(caught.exception))
        frappe.db.rollback()
        self.assertEqual(self._line(COLLECT_NO_LINK).row_status, "Mismatched")

    def test_an_accountant_lead_skips_it_with_a_typed_reason(self):
        self._skip_as(ACCOUNTANT_LEAD, COLLECT_NO_LINK)
        line = self._line(COLLECT_NO_LINK)
        self.assertEqual((line.row_status, line.skip_reason), ("Skipped", "personal, employee repaid"))

    def test_an_admin_skips_it(self):
        self._skip_as(ADMIN, COLLECT_NO_LINK)
        self.assertEqual(self._line(COLLECT_NO_LINK).row_status, "Skipped")

    def test_an_accountant_still_skips_any_other_open_cashbook_line(self):
        """Only the Collect payment is gated; ADR-0022 Amendment E still holds for every other open line."""
        self._skip_as(ACCOUNTANT, WALLET_CREDIT, reason="moved to the owner's own account")
        self.assertEqual(self._line(WALLET_CREDIT).row_status, "Skipped")


class TestACollectPaymentOffersOnlyCreateAndSkip(CollectChoicesCase):
    def test_link_allocate_and_split_are_refused_with_a_sentence(self):
        row = self._line(COLLECT_NO_LINK).name
        attempts = {
            "link one": lambda: settle_expense(row, "Non Project Expenses", "no-such-expense"),
            "link many": lambda: link_rows_to_expense(json.dumps([row]), "Non Project Expenses", "no-such-expense"),
            "allocate": lambda: allocate_row(
                row=row, targets=json.dumps([{"target_doctype": "Project Payments", "target_name": "no-such"}])
            ),
            "part payment": lambda: settle_row_partial(row, "no-such-payment", INTENT_PART_PAYMENT),
            "split check": lambda: check_partial_settle(row, "no-such-payment"),
        }
        for action, attempt in attempts.items():
            with self.subTest(action=action):
                with self.assertRaises(frappe.ValidationError) as caught:
                    attempt()
                self.assertIn(COLLECT_PAYMENT_CHOICES_REFUSAL, str(caught.exception))
                frappe.db.rollback()
                self.assertEqual(self._line(COLLECT_NO_LINK).row_status, "Mismatched")

    def test_the_main_table_row_carries_its_statement_type(self):
        """The screen offers the two choices by the line's Type, so the row must carry it."""
        page = get_outflow_rows(scope="not_matched_outflow", batch=self.batch, limit=500)
        rows = page["rows"] if isinstance(page, dict) else page
        kinds = {row["transfer_id"]: row.get("row_kind") for row in rows}
        self.assertEqual(kinds.get(COLLECT_NO_LINK + self.suffix), "Collect Payment")
