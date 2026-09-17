# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""One late bank line completes a part-linked expense from Decide (#1299, ADR-0027 Q13/Q17).

Driven from what the Decide dialog calls: `search_settleable_records` for the picker and `settle_row`
for Confirm. The part-linked expense is set up through `link_rows_to_expense`, the way a run's first
lines really arrive. Fixtures and per-test teardown are `test_link_rows_to_expense.LinkFixture`'s.
"""

from decimal import Decimal

import frappe

from nirmaan_stack.api.outflow_import.expenses import settle_row
from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE, ROW_DOCTYPE, search_settleable_records
from nirmaan_stack.api.outflow_import.test_link_rows_to_expense import (
    RECONCILIATION_PENDING,
    LinkFixture,
)
from nirmaan_stack.services.outflow_import.candidates import load_expense_targets
from nirmaan_stack.services.outflow_import.ledger_read import approved_rows
from nirmaan_stack.services.outflow_import.settle import (
    NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE,
    AmountMismatchError,
)
from nirmaan_stack.services.outflow_import.status import OPEN_ROW_STATUSES, ROW_SETTLED


def _amount(line) -> Decimal:
    return Decimal(str(line["amount"]))


class DecideFixture(LinkFixture):
    def _part_linked(self, first, amount):
        """A Reconciliation Pending expense of `amount` with `first` already linked to it."""
        expense = self._expense(amount=amount)
        link_rows_to_expense(
            rows=self._names([first]), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )
        self.assertEqual(
            self._state(NON_PROJECT_EXPENSE, expense).status,
            RECONCILIATION_PENDING,
            "fixture precondition: the first line only part-fills",
        )
        return expense

    def _picker(self, line):
        return {
            (r["target_doctype"], r["name"]): r
            for r in search_settleable_records(row=line["name"])
        }


class TestThePickerMeasuresWhatIsLeft(DecideFixture):
    def test_a_part_linked_expense_with_room_is_listed_with_what_is_left(self):
        first, second, third = self._lines(3)
        expense = self._part_linked(first, self._total([first, second, third]))

        listed = self._picker(second)[(NON_PROJECT_EXPENSE, expense)]

        self.assertEqual(Decimal(str(listed["linked_total"])), _amount(first))
        self.assertEqual(listed["line_count"], 1)
        self.assertEqual(Decimal(str(listed["remaining"])), _amount(second) + _amount(third))
        # The line fits what is left, so the picker may offer it.
        self.assertTrue(listed["suggested"])

    def test_a_line_that_fills_what_is_left_is_offered(self):
        first, second = self._lines(2)
        expense = self._part_linked(first, self._total([first, second]))

        self.assertTrue(self._picker(second)[(NON_PROJECT_EXPENSE, expense)]["suggested"])

    def test_a_line_bigger_than_what_is_left_plus_five_is_not_offered(self):
        first, second = self._lines(2)
        expense = self._part_linked(first, self._total([first, second]) - Decimal("5.01"))

        self.assertFalse(self._picker(second)[(NON_PROJECT_EXPENSE, expense)]["suggested"])

    def test_a_fresh_expense_is_still_compared_with_its_whole_amount(self):
        """No slips yet: a line smaller than the expense is not offered (today's 1:1 rule)."""
        (line,) = self._lines(1)
        smaller = self._expense(amount=_amount(line) + 100)
        same = self._expense(amount=_amount(line))

        picker = self._picker(line)
        self.assertFalse(picker[(NON_PROJECT_EXPENSE, smaller)]["suggested"])
        self.assertTrue(picker[(NON_PROJECT_EXPENSE, same)]["suggested"])
        self.assertEqual(picker[(NON_PROJECT_EXPENSE, same)]["line_count"], 0)
        self.assertEqual(Decimal(str(picker[(NON_PROJECT_EXPENSE, same)]["remaining"])), _amount(line))

    def test_the_matcher_pool_compares_with_what_is_left(self):
        first, second = self._lines(2)
        expense = self._part_linked(first, self._total([first, second]))

        by_remaining = {t.name for t in load_expense_targets([_amount(second)])}
        by_whole = {t.name for t in load_expense_targets([self._total([first, second])])}
        self.assertIn(expense, by_remaining)
        self.assertNotIn(expense, by_whole)

    def test_the_ledger_read_carries_what_is_linked_and_what_is_left(self):
        first, second = self._lines(2)
        expense = self._part_linked(first, self._total([first, second]))

        (row,) = [
            r for r in approved_rows([NON_PROJECT_EXPENSE], search=expense, limit=5000)
            if r["name"] == expense
        ]
        self.assertEqual(Decimal(str(row["linked_total"])), _amount(first))
        self.assertEqual(row["line_count"], 1)
        self.assertEqual(Decimal(str(row["remaining"])), _amount(second))


class TestConfirmLinksTheLateLine(DecideFixture):
    def test_a_line_that_fills_the_remainder_makes_it_paid_on_the_latest_lines_date(self):
        first, second = self._lines(2)
        expense = self._part_linked(first, self._total([first, second]))

        settle_row(row=second["name"], target_doctype=NON_PROJECT_EXPENSE, target_name=expense)

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, "Paid")
        self.assertEqual(after.payment_date, max(first["added_on"], second["added_on"]).date())
        # One slip per line, each its own amount; the record's figure is never snapped.
        by_row = {s["import_row"]: Decimal(str(s["target_amount"])) for s in self._slips(expense)}
        self.assertEqual(by_row, {first["name"]: _amount(first), second["name"]: _amount(second)})
        self.assertEqual(Decimal(str(after.amount)), self._total([first, second]))
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, second["name"], "row_status"), ROW_SETTLED)

    def test_a_line_that_part_fills_keeps_it_reconciliation_pending(self):
        first, second, third = self._lines(3)
        amount = self._total([first, second, third])
        expense = self._part_linked(first, amount)

        result = settle_row(
            row=second["name"], target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, RECONCILIATION_PENDING)
        self.assertIsNone(after.payment_date)
        self.assertEqual(Decimal(str(after.amount)), amount)
        self.assertEqual(len(self._slips(expense)), 2)
        # The row reads settled, not Partially Allocated: its slip covers the whole line.
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, second["name"], "row_status"), ROW_SETTLED)
        self.assertEqual(Decimal(str(result["settled"]["amount"])), _amount(second))
        self.assertFalse(result["settled"]["amount_changed"])

    def test_a_line_bigger_than_what_is_left_plus_five_is_refused_and_nothing_is_written(self):
        first, second = self._lines(2)
        expense = self._part_linked(first, self._total([first, second]) - Decimal("5.01"))

        with self.assertRaises(AmountMismatchError) as caught:
            settle_row(row=second["name"], target_doctype=NON_PROJECT_EXPENSE, target_name=expense)

        self.assertIn(f"{expense} has only ₹", str(caught.exception))
        self.assertEqual(len(self._slips(expense)), 1)
        self.assertEqual(self._state(NON_PROJECT_EXPENSE, expense).status, RECONCILIATION_PENDING)
        self.assertIn(
            frappe.db.get_value(ROW_DOCTYPE, second["name"], "row_status"), OPEN_ROW_STATUSES
        )
        self.assertFalse(frappe.db.exists(MATCH_DOCTYPE, {"import_row": second["name"]}))


class TestAFreshExpenseSettlesOneToOneAsToday(DecideFixture):
    def test_one_line_within_five_rupees_snaps_the_amount_and_writes_its_reference(self):
        (line,) = self._lines(1)
        expense = self._expense(PROJECT_EXPENSE, amount=_amount(line) - 3)

        result = settle_row(row=line["name"], target_doctype=PROJECT_EXPENSE, target_name=expense)

        after = self._state(PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, "Paid")
        self.assertEqual(Decimal(str(after.amount)), _amount(line))
        self.assertEqual(after.payment_date, line["added_on"].date())
        self.assertEqual(
            after.payment_ref,
            frappe.db.get_value(ROW_DOCTYPE, line["name"], "settlement_reference") or None,
        )
        self.assertTrue(result["settled"]["amount_changed"])
        (slip,) = self._slips(expense)
        self.assertEqual(Decimal(str(slip["target_amount"])), _amount(line))

    def test_a_line_smaller_than_a_fresh_expense_is_refused_with_todays_sentence(self):
        """Decide does not start a run: a part-fill of an expense with no lines yet goes through
        "Link N to one expense". The refusal is the one a 1:1 settle has always given."""
        (line,) = self._lines(1)
        expense = self._expense(amount=_amount(line) + 100)

        with self.assertRaises(AmountMismatchError) as caught:
            settle_row(row=line["name"], target_doctype=NON_PROJECT_EXPENSE, target_name=expense)

        self.assertIn(f"{expense} is for ", str(caught.exception))
        self.assertIn("left the bank, a difference of", str(caught.exception))
        self.assertEqual(self._slips(expense), [])
        self.assertEqual(self._state(NON_PROJECT_EXPENSE, expense).status, RECONCILIATION_PENDING)
