# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The expense's Bank lines card, read from the endpoint the card calls (#1303, ADR-0027 R5).

Driven through `get_expense_bank_lines` on expenses linked by `link_rows_to_expense` exactly as the
screen links them, and asserted on what the card puts on screen: the lines, their figures, the linked
total, what is left, and whether there is anything to open a card for at all.

The queue's `bank_line_count` is asserted here too, because it is the OTHER half of "an expense with
no slips shows no card trigger" -- the card's own emptiness is never seen if that number is wrong.

Fixtures and teardown are `test_link_rows_to_expense.LinkFixture`'s.
"""

import frappe

from nirmaan_stack.api.approvals.expense_bank_lines import get_expense_bank_lines
from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue
from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.api.outflow_import.test_link_rows_to_expense import (
    RECONCILIATION_PENDING,
    LinkFixture,
)
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.services.outflow_import.settle import NON_PROJECT_EXPENSE, PROJECT_EXPENSE

RUN_REFERENCE = "BULD75978325"


class BankLinesFixture(LinkFixture):
    def tearDown(self):
        rows = frappe.get_all(ROW_DOCTYPE, filters={"import_batch": self.batch.name}, pluck="name")
        matches = frappe.get_all(
            MATCH_DOCTYPE, filters={"import_batch": self.batch.name}, pluck="name"
        )
        if rows:
            frappe.db.delete(
                "Comment", {"reference_doctype": ROW_DOCTYPE, "reference_name": ["in", rows]}
            )
        if matches:
            frappe.db.delete("Version", {"ref_doctype": MATCH_DOCTYPE, "docname": ["in", matches]})
        super().tearDown()

    def _run(self, count, *, extra=0, doctype=NON_PROJECT_EXPENSE):
        """`count` lines linked in one go to an expense of their total plus `extra` still to link."""
        lines = self._lines(count)
        expense = self._expense(
            doctype=doctype, amount=self._total(lines) + extra, payment_ref=RUN_REFERENCE
        )
        link_rows_to_expense(
            rows=self._names(lines), target_doctype=doctype, target_name=expense
        )
        return lines, expense


class TestTheCardReadsTheRun(BankLinesFixture):
    def test_a_filled_expense_lists_every_line_with_its_own_figures(self):
        lines, expense = self._run(3)

        card = get_expense_bank_lines(doctype=NON_PROJECT_EXPENSE, name=expense)

        self.assertEqual(card["status"], "Paid")
        self.assertEqual(card["line_count"], 3)
        self.assertEqual(card["linked_total"], float(self._total(lines)))
        self.assertEqual(card["amount"], float(self._total(lines)))
        self.assertEqual(card["remaining"], 0.0)
        self.assertEqual(len(card["lines"]), 3)
        self.assertEqual(
            {line["import_row"] for line in card["lines"]},
            {line["name"] for line in lines},
        )

    def test_each_line_carries_the_five_facts_the_card_renders(self):
        lines, expense = self._run(2)

        card = get_expense_bank_lines(doctype=NON_PROJECT_EXPENSE, name=expense)

        for entry in card["lines"]:
            self.assertTrue(entry["added_on"])
            self.assertTrue(entry["import_batch"])
            self.assertGreater(entry["amount"], 0)
            # Beneficiary and reference come off the bank row verbatim; the fixture statement
            # carries both, so a blank here means the join, not the data.
            self.assertTrue(entry["beneficiary_name"])
            self.assertTrue(entry["reference"])

    def test_the_lines_add_up_to_the_linked_total(self):
        """The column must sum to the headline, or the card argues with itself."""
        lines, expense = self._run(3, extra=500)

        card = get_expense_bank_lines(doctype=NON_PROJECT_EXPENSE, name=expense)

        self.assertAlmostEqual(
            sum(entry["amount"] for entry in card["lines"]), card["linked_total"], places=2
        )

    def test_the_oldest_line_is_listed_first(self):
        lines, expense = self._run(3)

        card = get_expense_bank_lines(doctype=NON_PROJECT_EXPENSE, name=expense)

        dates = [entry["added_on"] for entry in card["lines"]]
        self.assertEqual(dates, sorted(dates))


class TestAPartLinkedExpense(BankLinesFixture):
    def test_it_reads_reconciliation_pending_with_what_is_still_to_link(self):
        lines, expense = self._run(2, extra=21480)

        card = get_expense_bank_lines(doctype=NON_PROJECT_EXPENSE, name=expense)

        self.assertEqual(card["status"], RECONCILIATION_PENDING)
        self.assertIsNone(card["payment_date"])
        self.assertEqual(card["line_count"], 2)
        self.assertEqual(card["linked_total"], float(self._total(lines)))
        self.assertEqual(card["remaining"], 21480.0)

    def test_a_project_expense_reads_the_same_way(self):
        lines, expense = self._run(2, doctype=PROJECT_EXPENSE)

        card = get_expense_bank_lines(doctype=PROJECT_EXPENSE, name=expense)

        self.assertEqual(card["doctype"], PROJECT_EXPENSE)
        self.assertEqual(card["line_count"], 2)
        self.assertEqual(len(card["lines"]), 2)


class TestWhatTheCardDoesNotShow(BankLinesFixture):
    def test_an_expense_no_line_has_reached_has_nothing_to_open(self):
        expense = self._expense(amount=5000)

        card = get_expense_bank_lines(doctype=NON_PROJECT_EXPENSE, name=expense)

        self.assertEqual(card["line_count"], 0)
        self.assertEqual(card["linked_total"], 0.0)
        self.assertEqual(card["lines"], [])

    def test_a_reversed_line_is_not_listed_and_does_not_count(self):
        lines, expense = self._run(3)

        unreconcile_row(row=lines[0]["name"], legs="all", reason="wrong person")

        card = get_expense_bank_lines(doctype=NON_PROJECT_EXPENSE, name=expense)
        self.assertEqual(card["line_count"], 2)
        self.assertEqual(card["linked_total"], float(self._total(lines[1:])))
        self.assertNotIn(lines[0]["name"], [entry["import_row"] for entry in card["lines"]])
        # And the card now explains why the expense is no longer Paid.
        self.assertEqual(card["status"], RECONCILIATION_PENDING)
        self.assertAlmostEqual(card["remaining"], float(lines[0]["amount"]), places=2)

    def test_a_payment_is_refused_by_name(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            get_expense_bank_lines(doctype="Project Payments", name="whatever")
        self.assertIn("Project Payments", str(caught.exception))

    def test_an_expense_that_does_not_exist_is_refused(self):
        with self.assertRaises(frappe.DoesNotExistError):
            get_expense_bank_lines(doctype=NON_PROJECT_EXPENSE, name="no-such-expense")


class TestWhoMayRead(BankLinesFixture):
    """Someone who may not read the expense may not see which bank lines paid it.

    ⚠️ AND THE REFUSAL MUST COME BEFORE THE "NOT FOUND" ONE. Checked after, the not-found sentence
    answers "does this expense exist?" for somebody who may not read a single one of them.
    """

    def _as_guest(self, fn):
        frappe.set_user("Guest")
        self.addCleanup(frappe.set_user, "Administrator")
        return fn()

    def test_a_reader_without_permission_gets_nothing(self):
        lines, expense = self._run(2)

        with self.assertRaises(frappe.PermissionError):
            self._as_guest(
                lambda: get_expense_bank_lines(doctype=NON_PROJECT_EXPENSE, name=expense)
            )

    def test_a_name_that_does_not_exist_is_refused_the_same_way(self):
        """Same sentence for a real expense and an invented one — no enumeration oracle."""
        with self.assertRaises(frappe.PermissionError):
            self._as_guest(
                lambda: get_expense_bank_lines(
                    doctype=NON_PROJECT_EXPENSE, name="no-such-expense"
                )
            )


class TestTheQueueSaysWhichRowsHaveACard(BankLinesFixture):
    def _row_in_queue(self, name):
        result = get_approval_queue(
            filters=[["name", "=", name]], limit_page_length=5
        )
        rows = [r for r in result["data"] if r["name"] == name]
        self.assertEqual(len(rows), 1, f"{name} should appear exactly once in the queue")
        return rows[0]

    def test_a_linked_expense_carries_its_line_count(self):
        lines, expense = self._run(3)

        self.assertEqual(self._row_in_queue(expense)["bank_line_count"], 3)

    def test_an_unlinked_expense_carries_zero(self):
        expense = self._expense(amount=5000)

        self.assertEqual(self._row_in_queue(expense)["bank_line_count"], 0)

    def test_the_join_never_duplicates_a_row(self):
        """A LEFT JOIN onto a per-expense aggregate must add columns, never rows."""
        lines, expense = self._run(3)

        result = get_approval_queue(filters=[["name", "=", expense]], limit_page_length=5)
        self.assertEqual(result["total_count"], 1)
        self.assertEqual(len(result["data"]), 1)
