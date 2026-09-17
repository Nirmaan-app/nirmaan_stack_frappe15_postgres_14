# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Many bank lines settle one expense, in one call (#1298, ADR-0027).

Driven from the endpoint the screen calls, `link_rows_to_expense`, and asserted on what a person
can see: the expense's status, date, amount and reference, the slips, each import row's status, the
export, and the refusal sentences. Fixtures and teardown are `test_expenses.SettlementFixture`'s.

⚠️ EACH TEST STAGES ITS OWN BATCH. Linking consumes lines, and a test that shared one batch with its
siblings would depend on the order unittest runs them in.
"""

import json
from decimal import Decimal

import frappe

from nirmaan_stack.api.outflow_import.link_lines import link_rows_to_expense
from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE, ROW_DOCTYPE, export_outflow_rows
from nirmaan_stack.api.outflow_import.test_expenses import SettlementFixture, _fresh_parse
from nirmaan_stack.api.outflow_import.upload import _stage_batch
from nirmaan_stack.services.outflow_import.settle import (
    NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE,
    AmountMismatchError,
    ExpenseSettlementError,
)
from nirmaan_stack.services.outflow_import.status import OPEN_ROW_STATUSES, ROW_SETTLED

RECONCILIATION_PENDING = "Reconciliation Pending"


class LinkFixture(SettlementFixture):
    def setUp(self):
        batch = _stage_batch(
            _fresh_parse(),
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        )
        self.batches.append(batch.name)
        self.batch = batch
        frappe.db.commit()

    def tearDown(self):
        """⚠️ PER TEST, NOT PER CLASS. Every batch stages the SAME fixture lines, so a Paid expense
        one test leaves behind is "already recorded" money to the next test's identical line, and the
        duplicate guard would refuse it."""
        frappe.db.rollback()
        frappe.db.delete(MATCH_DOCTYPE, {"import_batch": self.batch.name})
        frappe.db.delete(ROW_DOCTYPE, {"import_batch": self.batch.name})
        frappe.db.delete("Outflow Import Batch", {"name": self.batch.name})
        # The link attaches the statement to the expense through a `File` row; it is this test's too.
        for doctype, names in (
            (PROJECT_EXPENSE, self.project_expenses),
            (NON_PROJECT_EXPENSE, self.non_project_expenses),
        ):
            for name in names:
                frappe.db.delete("File", {"attached_to_doctype": doctype, "attached_to_name": name})
        self.batches.remove(self.batch.name)
        for doctype, names in (
            (PROJECT_EXPENSE, self.project_expenses),
            (NON_PROJECT_EXPENSE, self.non_project_expenses),
        ):
            for name in names:
                frappe.db.delete("Version", {"ref_doctype": doctype, "docname": name})
                frappe.db.delete(doctype, {"name": name})
            names.clear()
        frappe.db.commit()

    def _lines(self, count):
        """`count` open, money-out lines of this test's batch, oldest first.

        ⚠️ MONEY OUT IS THE `direction` COLUMN, never the amount's sign -- amounts are magnitudes.
        """
        rows = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch.name, "row_status": ["in", list(OPEN_ROW_STATUSES)]},
            fields=["name", "amount", "added_on", "direction"],
            order_by="creation asc",
        )
        rows = [r for r in rows if (r["direction"] or "") != "Credit" and Decimal(str(r["amount"])) > 0]
        self.assertGreaterEqual(len(rows), count, "fixture precondition: enough open lines")
        return rows[:count]

    @staticmethod
    def _total(lines):
        return sum((Decimal(str(line["amount"])) for line in lines), Decimal("0"))

    @staticmethod
    def _names(lines):
        return json.dumps([line["name"] for line in lines])

    def _expense(self, doctype=NON_PROJECT_EXPENSE, amount=0, payment_ref=None):
        name = self._make_expense(doctype, amount, status=RECONCILIATION_PENDING)
        if payment_ref:
            frappe.db.set_value(doctype, name, "payment_ref", payment_ref, update_modified=False)
            frappe.db.commit()
        return name

    def _state(self, doctype, name):
        return frappe.db.get_value(
            doctype, name, ["status", "amount", "payment_ref", "payment_date"], as_dict=True
        )

    def _slips(self, name):
        return frappe.get_all(
            MATCH_DOCTYPE,
            filters={"target_name": name, "match_kind": "Settled"},
            fields=["import_row", "target_amount"],
        )


class TestLinkingFillsOrPartFills(LinkFixture):
    def test_lines_that_fill_the_expense_make_it_paid_on_the_latest_lines_date(self):
        lines = self._lines(3)
        expense = self._expense(amount=self._total(lines))

        result = link_rows_to_expense(
            rows=self._names(lines), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, "Paid")
        self.assertEqual(after.payment_date, max(line["added_on"] for line in lines).date())
        self.assertEqual(result["expense"]["status"], "Paid")
        self.assertEqual(result["expense"]["line_count"], 3)

    def test_each_slip_carries_its_own_lines_amount_and_each_row_reads_settled(self):
        lines = self._lines(3)
        expense = self._expense(amount=self._total(lines) + 1000)

        link_rows_to_expense(
            rows=self._names(lines), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )

        by_row = {s["import_row"]: Decimal(str(s["target_amount"])) for s in self._slips(expense)}
        self.assertEqual(
            by_row, {line["name"]: Decimal(str(line["amount"])) for line in lines}
        )
        for line in lines:
            self.assertEqual(
                frappe.db.get_value(ROW_DOCTYPE, line["name"], "row_status"), ROW_SETTLED
            )

    def test_part_fill_stays_pending_with_no_date_and_a_second_go_fills_it(self):
        first, second = self._lines(2)
        expense = self._expense(amount=self._total([first, second]))

        link_rows_to_expense(
            rows=self._names([first]), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )
        after_first = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after_first.status, RECONCILIATION_PENDING)
        self.assertIsNone(after_first.payment_date)

        link_rows_to_expense(
            rows=self._names([second]), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )
        after_second = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after_second.status, "Paid")
        self.assertEqual(
            after_second.payment_date, max(first["added_on"], second["added_on"]).date()
        )

    def test_lines_up_to_five_rupees_over_what_is_left_still_link(self):
        lines = self._lines(2)
        expense = self._expense(PROJECT_EXPENSE, amount=self._total(lines) - 5)

        link_rows_to_expense(
            rows=self._names(lines), target_doctype=PROJECT_EXPENSE, target_name=expense
        )

        after = self._state(PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, "Paid")
        # Many lines never snap the amount: nothing is written back to the record's figure.
        self.assertEqual(Decimal(str(after.amount)), self._total(lines) - 5)


class TestAllOrNothing(LinkFixture):
    def test_lines_over_what_is_left_plus_five_are_refused_and_nothing_is_written(self):
        lines = self._lines(3)
        expense = self._expense(amount=self._total(lines) - Decimal("5.01"))
        before = self._state(NON_PROJECT_EXPENSE, expense)

        with self.assertRaises(AmountMismatchError) as caught:
            link_rows_to_expense(
                rows=self._names(lines), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
            )

        # Money in the refusal reads as money: rupee sign and Indian grouping, never `21480.00`.
        self.assertRegex(str(caught.exception), r"These 3 lines total ₹[\d,]+(\.\d\d)?, but ")
        self.assertIn(f"{expense} has only ₹", str(caught.exception))
        self.assertEqual(self._slips(expense), [])
        self.assertEqual(self._state(NON_PROJECT_EXPENSE, expense), before)
        for line in lines:
            self.assertIn(
                frappe.db.get_value(ROW_DOCTYPE, line["name"], "row_status"), OPEN_ROW_STATUSES
            )

    def test_the_refusal_measures_against_what_is_left_after_an_earlier_go(self):
        first, second, third = self._lines(3)
        expense = self._expense(amount=self._total([first, second]))
        link_rows_to_expense(
            rows=self._names([first]), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )

        with self.assertRaises(AmountMismatchError):
            link_rows_to_expense(
                rows=self._names([second, third]),
                target_doctype=NON_PROJECT_EXPENSE,
                target_name=expense,
            )
        self.assertEqual(len(self._slips(expense)), 1)

    def test_a_money_in_line_refuses_the_whole_request(self):
        lines = self._lines(2)
        expense = self._expense(amount=self._total(lines))
        frappe.db.set_value(ROW_DOCTYPE, lines[1]["name"], "direction", "Credit")
        frappe.db.commit()

        with self.assertRaises(ExpenseSettlementError):
            link_rows_to_expense(
                rows=self._names(lines), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
            )
        self.assertEqual(self._slips(expense), [])
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, lines[0]["name"], "row_status") in OPEN_ROW_STATUSES,
            True,
        )

    def test_a_line_that_is_not_open_refuses_the_whole_request(self):
        lines = self._lines(2)
        expense = self._expense(amount=self._total(lines))
        frappe.db.set_value(ROW_DOCTYPE, lines[0]["name"], "row_status", "Skipped")
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError):
            link_rows_to_expense(
                rows=self._names(lines), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
            )
        self.assertEqual(self._slips(expense), [])

    def test_a_paid_expense_is_refused(self):
        lines = self._lines(1)
        expense = self._expense(amount=self._total(lines))
        frappe.db.set_value(NON_PROJECT_EXPENSE, expense, "status", "Paid", update_modified=False)
        frappe.db.commit()

        with self.assertRaises(ExpenseSettlementError):
            link_rows_to_expense(
                rows=self._names(lines), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
            )
        self.assertEqual(self._slips(expense), [])


class TestTheReference(LinkFixture):
    def _give_lines_a_bulk_id(self, lines, bulk_id):
        for line in lines:
            frappe.db.set_value(
                ROW_DOCTYPE,
                line["name"],
                "remarks",
                f"MMT/IMPS/6230{line['name'][-4:]}/{bulk_id}/Some Name/ICIC0000001",
            )
        frappe.db.commit()

    def test_an_existing_reference_is_kept(self):
        lines = self._lines(2)
        self._give_lines_a_bulk_id(lines, "BULD76992401")
        expense = self._expense(amount=self._total(lines), payment_ref="SALARY-JULY")

        link_rows_to_expense(
            rows=self._names(lines), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )

        self.assertEqual(self._state(NON_PROJECT_EXPENSE, expense).payment_ref, "SALARY-JULY")

    def test_a_blank_reference_receives_the_bulk_id(self):
        lines = self._lines(2)
        self._give_lines_a_bulk_id(lines, "BULD76992401")
        expense = self._expense(amount=self._total(lines))

        link_rows_to_expense(
            rows=self._names(lines), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )

        self.assertEqual(self._state(NON_PROJECT_EXPENSE, expense).payment_ref, "BULD76992401")

    def test_one_line_that_only_part_fills_a_fresh_expense_keeps_the_run_rules(self):
        """The first go of a run is not a 1:1 settle: the amount is untouched and a blank reference
        gets the bulk id, so later lines of the same run find the right reference already there."""
        first, second = self._lines(2)
        self._give_lines_a_bulk_id([first, second], "BULD76992401")
        amount = self._total([first, second])
        expense = self._expense(amount=amount)

        link_rows_to_expense(
            rows=self._names([first]), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )

        after = self._state(NON_PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, RECONCILIATION_PENDING)
        self.assertEqual(Decimal(str(after.amount)), amount)
        self.assertEqual(after.payment_ref, "BULD76992401")

    def test_one_line_that_fills_a_fresh_expense_settles_one_to_one(self):
        """Q13: the N=1 case keeps today's extras -- the line's reference, the amount snapped."""
        (line,) = self._lines(1)
        expense = self._expense(PROJECT_EXPENSE, amount=Decimal(str(line["amount"])) - 3)

        link_rows_to_expense(
            rows=self._names([line]), target_doctype=PROJECT_EXPENSE, target_name=expense
        )

        after = self._state(PROJECT_EXPENSE, expense)
        self.assertEqual(after.status, "Paid")
        self.assertEqual(Decimal(str(after.amount)), Decimal(str(line["amount"])))
        self.assertTrue(after.payment_ref)
        self.assertNotEqual(after.payment_ref, "BULD76992401")


class TestTheExport(LinkFixture):
    def test_the_export_shows_each_lines_own_linked_amount(self):
        lines = self._lines(2)
        expense = self._expense(amount=self._total(lines))

        link_rows_to_expense(
            rows=self._names(lines), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )

        exported = {
            r["name"]: r for r in export_outflow_rows(scope="all", batch=self.batch.name)["rows"]
        }
        for line in lines:
            row = exported[line["name"]]
            self.assertEqual(row["settled_target_names"], expense)
            self.assertEqual(
                Decimal(row["settled_target_amounts"]),
                Decimal(str(line["amount"])).quantize(Decimal("0.01")),
            )


class TestTheLinkableExpenseList(LinkFixture):
    def _listed(self):
        from nirmaan_stack.api.outflow_import.link_lines import get_linkable_expenses

        return {r["name"]: r for r in get_linkable_expenses()}

    def test_a_part_linked_expense_is_listed_with_what_it_has_and_what_is_left(self):
        first, second = self._lines(2)
        expense = self._expense(amount=self._total([first, second]))
        link_rows_to_expense(
            rows=self._names([first]), target_doctype=NON_PROJECT_EXPENSE, target_name=expense
        )

        listed = self._listed()[expense]
        self.assertEqual(Decimal(str(listed["linked_total"])), Decimal(str(first["amount"])))
        self.assertEqual(listed["line_count"], 1)
        self.assertEqual(Decimal(str(listed["remaining"])), Decimal(str(second["amount"])))

    def test_a_filled_expense_and_an_approved_one_are_not_listed(self):
        lines = self._lines(1)
        filled = self._expense(amount=self._total(lines))
        link_rows_to_expense(
            rows=self._names(lines), target_doctype=NON_PROJECT_EXPENSE, target_name=filled
        )
        approved = self._make_expense(PROJECT_EXPENSE, 500, status="Approved")

        listed = self._listed()
        self.assertNotIn(filled, listed)
        self.assertNotIn(approved, listed)
