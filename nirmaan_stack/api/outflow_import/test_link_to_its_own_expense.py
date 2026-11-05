# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""A Link to the Expense that already holds the line's Txn Id is refused in words (#1606, follows #1601).

    DEVENV test --module nirmaan_stack.api.outflow_import.test_link_to_its_own_expense

`ofm_match_settled_target_unique` (every source) refuses a second Settled match row of one transfer on one record.
A person meets it when two lines carry the same Txn Id -- an overlapping statement staged again -- and both are
Linked to the same Expense. This file drives that through both Link endpoints on a NON-Cashbook source (Cashfree),
where that index is the only one that can refuse; the Cashbook case is in `test_cashbook_link_holds_txn_id`.

The second line is given the first line's Txn Id by hand (test data only), and a different amount, so the
recorded-money guard (it matches on the amount too) lets it through and the index is what decides.

Fixtures and teardown are `test_link_rows_to_expense.LinkFixture`'s: every line, match row and expense is this
test's own and is deleted after it.
"""

import json

from psycopg2.errors import UniqueViolation

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    AlreadyLinkedError,
    refuse_link_of_a_held_txn_id,
    settle_row,
)
from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.link_refusal_fixture import assert_refused_in_words
from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.api.outflow_import.test_link_rows_to_expense import LinkFixture
from nirmaan_stack.services.outflow_import.settle import NON_PROJECT_EXPENSE
from nirmaan_stack.services.outflow_import.settled_target_index import is_settled_target_refusal
from nirmaan_stack.services.outflow_import.status import OPEN_ROW_STATUSES, ROW_SETTLED


class TestALinkToTheExpenseThatHoldsTheTransfer(LinkFixture):
    def setUp(self):
        super().setUp()
        self.first, self.second = self._lines(2)
        self.txn = frappe.db.get_value(ROW_DOCTYPE, self.first["name"], "transfer_id")
        # TEST DATA ONLY, HOOKS SKIPPED ON PURPOSE: the second line stands in for the same transfer staged again
        # from an overlapping statement, at a figure that disagrees.
        frappe.db.set_value(ROW_DOCTYPE, self.second["name"], "transfer_id", self.txn, update_modified=False)
        frappe.db.commit()
        self.expense = self._expense(amount=self._total([self.first, self.second]))
        link_rows_to_expense(
            rows=json.dumps([self.first["name"]]), target_doctype=NON_PROJECT_EXPENSE, target_name=self.expense
        )
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, self.first["name"], "row_status"), ROW_SETTLED)

    def _assert_refused_in_words_and_nothing_linked(self, attempt):
        assert_refused_in_words(
            self, attempt, AlreadyLinkedError, [self.txn, self.expense, self.first["name"], self.batch.name]
        )
        self.assertIn(frappe.db.get_value(ROW_DOCTYPE, self.second["name"], "row_status"), OPEN_ROW_STATUSES)
        self.assertEqual([slip["import_row"] for slip in self._slips(self.expense)], [self.first["name"]])
        self.assertFalse(frappe.db.exists(MATCH_DOCTYPE, {"import_row": self.second["name"]}))

    def test_a_link_of_many_lines_is_refused_naming_the_expense_and_the_line_that_hold_it(self):
        self._assert_refused_in_words_and_nothing_linked(
            lambda: link_rows_to_expense(
                rows=json.dumps([self.second["name"]]), target_doctype=NON_PROJECT_EXPENSE, target_name=self.expense
            )
        )

    def test_a_one_line_link_from_decide_is_refused_the_same_way(self):
        self._assert_refused_in_words_and_nothing_linked(
            lambda: settle_row(self.second["name"], NON_PROJECT_EXPENSE, self.expense)
        )


class TestOnlyThatIndexIsRelabelled(LinkFixture):
    """Any other database error stays as it was: recognised by the index's name only."""

    def _another_unique_violation(self) -> Exception:
        """A real refusal by ANOTHER unique key: a second match row with the name of an existing one."""
        line = self._lines(1)[0]
        expense = self._expense(amount=self._total([line]))
        link_rows_to_expense(
            rows=json.dumps([line["name"]]), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )
        existing = frappe.get_all(MATCH_DOCTYPE, filters={"import_row": line["name"]}, pluck="name")[0]
        frappe.db.savepoint("ofi_1606_other_unique")
        try:
            frappe.db.sql(
                """INSERT INTO "tabOutflow Row Match" (name, transfer_id, target_doctype, target_name, match_kind,
                   creation, modified) VALUES (%s, 'TXN-1606-OTHER', 'Non Project Expenses', 'NPE-1606-OTHER',
                   'Reversed', NOW(), NOW())""",
                (existing,),
            )
        except Exception as exc:  # noqa: BLE001 -- the error itself is what is under test
            frappe.db.rollback(save_point="ofi_1606_other_unique")
            return exc
        self.fail("the duplicate name was not refused")

    def test_a_refusal_by_another_unique_key_is_not_recognised(self):
        exc = self._another_unique_violation()
        self.assertFalse(is_settled_target_refusal(exc))

    def test_a_bare_unique_violation_or_another_error_is_not_recognised(self):
        self.assertFalse(is_settled_target_refusal(UniqueViolation("duplicate key")))
        self.assertFalse(is_settled_target_refusal(frappe.ValidationError("More than is left")))
        self.assertFalse(is_settled_target_refusal(ValueError("bad")))

    def test_the_link_refusal_leaves_another_error_to_its_caller(self):
        exc = self._another_unique_violation()
        self.assertIsNone(refuse_link_of_a_held_txn_id(["TXN-1606-OTHER"], NON_PROJECT_EXPENSE, "NPE-1606-OTHER", exc))
        self.assertIsNone(
            refuse_link_of_a_held_txn_id(["TXN-1606-OTHER"], NON_PROJECT_EXPENSE, "NPE-1606-OTHER", ValueError("bad"))
        )

    def test_another_error_is_left_to_its_caller_even_when_two_ticked_lines_share_a_txn_id(self):
        """#1611: the ticked-twice sentence is told only for a refusal by one of the two match indexes."""
        exc = self._another_unique_violation()
        twice = ["TXN-1611-TWICE", "TXN-1611-TWICE"]
        self.assertIsNone(refuse_link_of_a_held_txn_id(twice, NON_PROJECT_EXPENSE, "NPE-1611-TWICE", exc))
        self.assertIsNone(
            refuse_link_of_a_held_txn_id(twice, NON_PROJECT_EXPENSE, "NPE-1611-TWICE", ValueError("bad"))
        )
