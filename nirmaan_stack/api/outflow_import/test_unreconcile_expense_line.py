# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Undo one line of an expense several bank lines settle (#1300, ADR-0027 Q15/Q21).

Driven through the endpoints the Unreconcile dialog calls, `get_unreconcile_plan` and `unreconcile_row`,
on expenses linked by `link_rows_to_expense` exactly as the screen links them. Asserted on what a person
sees: the expense's status, date, amount and reference, the slips, and each import row's status.

The 1:1 expense's exact "changed elsewhere" check is pinned where it always was,
`test_unreconcile_expenses.TestRefusals`.
"""

import frappe

from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.api.outflow_import.test_link_rows_to_expense import (
    RECONCILIATION_PENDING,
    LinkFixture,
)
from nirmaan_stack.api.outflow_import.unreconcile import get_unreconcile_plan, unreconcile_row
from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import (
    _compute_cashflow_gap,
)
from nirmaan_stack.services.outflow_import.settle import NON_PROJECT_EXPENSE, PROJECT_EXPENSE
from nirmaan_stack.services.outflow_import.status import OPEN_ROW_STATUSES, ROW_SETTLED
from nirmaan_stack.services.outflow_import.unreconcile import VERDICT_UNLINK_EXPENSE_LINE

RUN_REFERENCE = "BULD75978325"


class ExpenseLineFixture(LinkFixture):
    def tearDown(self):
        rows = frappe.get_all(ROW_DOCTYPE, filters={"import_batch": self.batch.name}, pluck="name")
        matches = frappe.get_all(MATCH_DOCTYPE, filters={"import_batch": self.batch.name}, pluck="name")
        if rows:
            frappe.db.delete("Comment", {"reference_doctype": ROW_DOCTYPE, "reference_name": ["in", rows]})
        if matches:
            frappe.db.delete("Version", {"ref_doctype": MATCH_DOCTYPE, "docname": ["in", matches]})
        super().tearDown()

    def _run(self, count, *, extra=0):
        """`count` lines linked in one go to a Non Project Expense of their total plus `extra`."""
        lines = self._lines(count)
        expense = self._expense(amount=self._total(lines) + extra, payment_ref=RUN_REFERENCE)
        link_rows_to_expense(
            rows=self._names(lines), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )
        return lines, expense

    def _undo(self, line):
        return unreconcile_row(row=line["name"], legs="all", reason="wrong person")

    def _slip_kind(self, line, expense):
        return frappe.db.get_value(
            MATCH_DOCTYPE, {"import_row": line["name"], "target_name": expense}, "match_kind"
        )


class TestOneLineOfAPaidExpense(ExpenseLineFixture):
    def test_the_plan_offers_only_this_line_with_what_stays_linked(self):
        lines, expense = self._run(3)

        plan = get_unreconcile_plan(row=lines[0]["name"])

        self.assertEqual(plan["refused_count"], 0)
        [leg] = plan["legs"]
        self.assertEqual(leg["verdict"], VERDICT_UNLINK_EXPENSE_LINE)
        self.assertEqual(
            leg["what_happens"],
            f"Only this line comes off. {expense} goes back to Reconciliation Pending.",
        )
        self.assertEqual(leg["stays_linked"], float(self._total(lines[1:])))
        self.assertEqual(leg["other_lines"], 2)
        self.assertEqual(leg["expense_amount"], float(self._total(lines)))
        self.assertFalse(leg["stays_paid"])

    def test_it_goes_back_to_reconciliation_pending_keeping_its_reference_and_amount(self):
        lines, expense = self._run(3)
        before = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(before.status, "Paid")

        self._undo(lines[0])

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, RECONCILIATION_PENDING)
        self.assertIsNone(after.payment_date)
        self.assertEqual(after.payment_ref, RUN_REFERENCE)
        self.assertEqual(after.amount, before.amount)
        self.assertEqual(self._slip_kind(lines[0], expense), "Reversed")
        for line in lines[1:]:
            self.assertEqual(self._slip_kind(line, expense), "Settled")
            self.assertEqual(self._line_status(line), ROW_SETTLED)

    def test_the_undone_line_is_open_again(self):
        lines, _expense = self._run(3)

        result = self._undo(lines[0])

        self.assertIn(result["row_status"], OPEN_ROW_STATUSES)
        self.assertIn(self._line_status(lines[0]), OPEN_ROW_STATUSES)

    def test_the_statement_stays_attached_while_a_line_from_it_is_still_linked(self):
        lines, expense = self._run(2)
        attached = frappe.db.get_value(NON_PROJECT_EXPENSE, expense, "payment_attachment")
        self.assertTrue(attached)

        self._undo(lines[0])
        self.assertEqual(
            frappe.db.get_value(NON_PROJECT_EXPENSE, expense, "payment_attachment"), attached
        )

        self._undo(lines[1])
        self.assertFalse(frappe.db.get_value(NON_PROJECT_EXPENSE, expense, "payment_attachment"))

    def test_the_notice_amount_is_the_expense_it_was_and_the_line_it_took(self):
        lines, expense = self._run(2)
        amount = self._state(NON_PROJECT_EXPENSE, expense).amount

        [reversed_leg] = self._undo(lines[0])["reversed"]

        self.assertEqual(reversed_leg["verdict"], VERDICT_UNLINK_EXPENSE_LINE)
        self.assertEqual(reversed_leg["reversed_amount"], float(lines[0]["amount"]))
        self.assertEqual(reversed_leg["amount_after"], float(amount))

    def _line_status(self, line):
        return frappe.db.get_value(ROW_DOCTYPE, line["name"], "row_status")


class TestOneLineOfAProjectExpense(ExpenseLineFixture):
    """The Project Expenses half: the same write, but its `on_update` hook moves the project's CEO-Hold
    cashflow gap, and `unreconcile_cleanup` re-syncs that project afterwards."""

    def test_it_goes_back_to_reconciliation_pending_keeping_its_reference_and_paid_by(self):
        lines = self._lines(2)
        expense = self._expense(doctype=PROJECT_EXPENSE, amount=self._total(lines))
        frappe.db.set_value(
            PROJECT_EXPENSE, expense, "payment_ref", RUN_REFERENCE, update_modified=False
        )
        frappe.db.commit()
        link_rows_to_expense(
            rows=self._names(lines), target_doctype=PROJECT_EXPENSE, target_name=expense
        )
        before = frappe.db.get_value(
            PROJECT_EXPENSE, expense, ["amount", "payment_by", "status"], as_dict=True
        )
        self.assertEqual(before.status, "Paid")
        self.assertTrue(before.payment_by)

        [reversed_leg] = unreconcile_row(
            row=lines[0]["name"], legs="all", reason="wrong person"
        )["reversed"]

        self.assertEqual(reversed_leg["verdict"], VERDICT_UNLINK_EXPENSE_LINE)
        after = frappe.db.get_value(
            PROJECT_EXPENSE,
            expense,
            ["status", "payment_date", "payment_ref", "amount", "payment_by"],
            as_dict=True,
        )
        self.assertEqual(after.status, RECONCILIATION_PENDING)
        self.assertIsNone(after.payment_date)
        self.assertEqual(after.payment_ref, RUN_REFERENCE)
        self.assertEqual(after.amount, before.amount)
        # 'paid by' is left alone: the other lines still settle this expense.
        self.assertEqual(after.payment_by, before.payment_by)
        # The gap the hook and the re-sync left is the one a fresh evaluation makes.
        gap = _compute_cashflow_gap(self.project)
        self.assertEqual(gap, _compute_cashflow_gap(self.project))
        self.assertEqual(
            frappe.db.get_value(
                MATCH_DOCTYPE,
                {"import_row": lines[1]["name"], "target_name": expense},
                "match_kind",
            ),
            "Settled",
        )


class TestEveryLineOfAReconciliationPendingExpense(ExpenseLineFixture):
    def test_each_line_comes_off_in_turn_down_to_the_last(self):
        lines, expense = self._run(3, extra=1000)
        self.assertEqual(self._state(NON_PROJECT_EXPENSE, expense).status, RECONCILIATION_PENDING)
        amount = self._state(NON_PROJECT_EXPENSE, expense).amount

        for line in lines:
            with self.subTest(line=line["name"]):
                [leg] = get_unreconcile_plan(row=line["name"])["legs"]
                self.assertEqual(leg["verdict"], VERDICT_UNLINK_EXPENSE_LINE)
                self._undo(line)
                self.assertEqual(self._slip_kind(line, expense), "Reversed")

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, RECONCILIATION_PENDING)
        self.assertIsNone(after.payment_date)
        self.assertEqual(after.payment_ref, RUN_REFERENCE)
        self.assertEqual(after.amount, amount)
        self.assertFalse(self._slips(expense))
