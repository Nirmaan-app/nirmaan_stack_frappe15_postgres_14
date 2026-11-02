# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Hand actions on a Cashbook line its import job still owns (#1587, spec #1585 gap B, ADR-0015 Amendment A).

    DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_pending_guard

A Cashbook line at `Pending match run` is the Cashbook job's work in progress: the worker reads its line
list once and writes each line from it. Every main-table write -- Create, Link (one line or many),
Allocate, Split / Part payment, Skip -- refuses such a line with one sentence naming the Cashbook import.
The same line at any other open status (`Mismatched` after Unreconcile or Unskip, `Error`) stays workable
by hand. Porter and card lines keep their own guard (`test_porter_import`, `test_card_credits`).

⚠️ THIS SUITE CREATES REAL EXPENSES on the site, like `test_cashbook_import`, and tears down every one.
"""

import json
from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.expenses import (
    MATCH_DOCTYPE,
    allocate_row,
    create_expense,
    settle_expense,
    settle_row_partial,
)
from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.review import skip_row
from nirmaan_stack.api.outflow_import.test_allocate_row import AllocationFixture
from nirmaan_stack.api.outflow_import.test_cashbook_import import CashbookImportCase
from nirmaan_stack.api.outflow_import.test_link_rows_to_expense import LinkFixture
from nirmaan_stack.api.outflow_import.test_settle_payment import PartialSettlementFixture
from nirmaan_stack.services.outflow_import.partial_settle import INTENT_PART_PAYMENT
from nirmaan_stack.services.outflow_import.skip_origin import cashbook_pending_line_refusal
from nirmaan_stack.services.outflow_import.status import (
    ROW_ERROR,
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
)

ROW_DOCTYPE = "Outflow Import Row"


def _won_project():
    return frappe.db.get_value(
        "Projects", {"tendering_status": "Won", "status": ["!=", "CEO Hold"]}, "name", order_by="creation asc"
    )


def _project_expense_type():
    return frappe.db.get_value("Expense Type", {"project": 1, "non_project": 0}, "name")


def _make_cashbook(row: str, status: str) -> None:
    frappe.db.set_value(ROW_DOCTYPE, row, {"source": "Cashbook", "row_status": status}, update_modified=False)
    frappe.db.commit()


class TestAPendingCashbookLineBelongsToItsImport(CashbookImportCase):
    """The committed `cashbook_sample.csv`, staged and NOT yet run: its planned lines sit Pending."""

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.line = self._row("AAAAAA")
        self.assertEqual(self.line.row_status, ROW_PENDING_MATCH)  # fixture precondition

    def _expenses_carrying(self, transfer_id):
        return sum(
            frappe.db.count(doctype, {"payment_ref": transfer_id})
            for doctype in ("Project Expenses", "Non Project Expenses")
        )

    def _hand_create(self, row):
        return create_expense(
            row=row, doctype="Project Expenses", expense_type=_project_expense_type(), project=_won_project()
        )

    def test_a_hand_create_while_the_job_runs_leaves_one_expense(self):
        """Gap B: the worker has read its line list; a person Creates the same line before the worker
        reaches it. Before #1587 the hand Create succeeded and the job created the spend again."""
        refusals = []
        real_write_one = cb._write_one

        def a_person_acts_first(row_name, *args, **kwargs):
            if row_name == self.line.name:
                try:
                    self._hand_create(row_name)
                except frappe.ValidationError as refused:
                    refusals.append(str(refused))
                    frappe.db.rollback()
            return real_write_one(row_name, *args, **kwargs)

        with patch.object(cb, "_write_one", side_effect=a_person_acts_first):
            cb._cashbook_worker(self.batch, "Administrator")

        self.assertEqual(self._expenses_carrying(self.line.transfer_id), 1)
        self.assertEqual(len(refusals), 1)
        self.assertIn(cashbook_pending_line_refusal(self.batch), refusals[0])
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, self.line.name, "row_status"), ROW_SETTLED)

    def test_every_main_table_write_is_refused_with_the_cashbook_sentence(self):
        row = self.line.name
        attempts = {
            "create": lambda: self._hand_create(row),
            "link one": lambda: settle_expense(row, "Non Project Expenses", "no-such-expense"),
            "link many": lambda: link_rows_to_expense(json.dumps([row]), "Non Project Expenses", "no-such-expense"),
            "allocate": lambda: allocate_row(
                row=row, targets=json.dumps([{"target_doctype": "Project Payments", "target_name": "no-such"}])
            ),
            "part payment": lambda: settle_row_partial(row, "no-such-payment", INTENT_PART_PAYMENT),
            "skip": lambda: skip_row(row, "not ours"),
        }
        for action, attempt in attempts.items():
            with self.subTest(action=action):
                with self.assertRaises(frappe.ValidationError) as caught:
                    attempt()
                # Spec #1585 B: the sentence names the line's import.
                self.assertIn(cashbook_pending_line_refusal(self.batch), str(caught.exception))
                self.assertIn(f"Cashbook import {self.batch} ", str(caught.exception))
                frappe.db.rollback()
                self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_PENDING_MATCH)
                self.assertFalse(frappe.db.exists(MATCH_DOCTYPE, {"import_row": row}))

    def test_create_still_works_on_a_cashbook_line_at_error(self):
        """A line the job failed to write is the person's to finish."""
        row = self.line.name
        frappe.db.set_value(ROW_DOCTYPE, row, "row_status", ROW_ERROR, update_modified=False)
        frappe.db.commit()

        self._hand_create(row)

        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_SETTLED)
        self.assertEqual(self._expenses_carrying(self.line.transfer_id), 1)


class TestAReopenedCashbookLineIsAllocatedByHand(AllocationFixture):
    def test_allocate_settles_a_mismatched_cashbook_line(self):
        row = self._staged_row(amount="100")
        _make_cashbook(row, ROW_MISMATCHED)
        pays = self._three_payments()

        result = allocate_row(row=row, targets=self._targets(pays))

        self.assertEqual(result["row_status"], ROW_SETTLED)


class TestAReopenedCashbookLineIsPartPaidByHand(PartialSettlementFixture):
    def test_part_payment_settles_a_mismatched_cashbook_line(self):
        _make_cashbook(self.partial_row.name, ROW_MISMATCHED)

        settle_row_partial(self.partial_row.name, self.big_payment, INTENT_PART_PAYMENT)

        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, self.partial_row.name, "row_status"), ROW_SETTLED)


class TestReopenedCashbookLinesAreLinkedByHand(LinkFixture):
    def test_link_settles_mismatched_cashbook_lines(self):
        lines = self._lines(2)
        for line in lines:
            _make_cashbook(line["name"], ROW_MISMATCHED)
        expense = self._expense(amount=self._total(lines))

        link_rows_to_expense(self._names(lines), "Non Project Expenses", expense)

        for line in lines:
            self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, line["name"], "row_status"), ROW_SETTLED)
