# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""An unpaired wallet refund becomes a negative Expense where its spend is booked (#1709, spec #1711, ADR-0015
Amendment D). GLOSSARY: *Wallet refund expense*.

Seam 1: the Cashbook import (staging, the job run inline) on the real-file fixture (`cashbook_statement.xlsx`), with
per-test Txn Ids; the bill downloader is faked. Then what reads the Expense: the Cashbook invoice queue, Bill check's
Cashbook pill, Unreconcile.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_refund_expenses
"""

import dataclasses
from datetime import date
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expenses.cashbook_invoices import get_cashbook_invoice_queue
from nirmaan_stack.api.expenses.expense_bill_fixture import capture_jobs
from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import cashbook_bills as bills
from nirmaan_stack.api.outflow_import.cashbook_refund_spends import spend_expenses
from nirmaan_stack.api.outflow_import.test_cashbook_bills import STATEMENT, _fake_bills
from nirmaan_stack.api.outflow_import.test_cashbook_import import _purge
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.services.expense_bills.bill_rows import KINDS
from nirmaan_stack.services.outflow_import.parser import parse_statement

PART_SPEND = "OBO9000000000004PARTSP"  # Wallet spend Rs 17,446 ("Flight tickets site visit"), Rs 11,248 refunded
EARLIER_SPEND = "OBO9000000000008EARLYR"  # not on the statement; its refund is Rs 640
MERCHANT = "Testtravel Bookings"  # the part refund's From: the merchant paying back
HOLDER = "Asha Menon"  # the part refund's To: the wallet holder


class RefundExpenseCase(FrappeTestCase):
    """Stages the fixture with per-test Txn Ids; `_stage_and_run` runs the job inline. `before_stage` books
    anything the plan must find first."""

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.jobs = capture_jobs(self)
        self.suffix = "R" + frappe.generate_hash(length=6).upper()
        parsed = parse_statement(STATEMENT.read_bytes(), source="Cashbook")
        self.parsed = dataclasses.replace(
            parsed,
            rows=[dataclasses.replace(r, transfer_id=r.transfer_id + self.suffix) for r in parsed.rows],
        )
        self.extra: list[tuple[str, str]] = []
        self.batch = None
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        frappe.db.rollback()
        for doctype, name in self.extra:
            frappe.db.delete(doctype, name)
        frappe.db.commit()
        if self.batch:
            _purge(self.batch)

    def _stage_and_run(self, before_run=None):
        self.batch = cb._stage(
            self.parsed,
            cb._build_plan(self.parsed),
            file_url="/private/files/test-statement.xlsx",
            filename="test-statement.xlsx",
            user="Administrator",
        ).name
        frappe.db.commit()
        if before_run:
            before_run()
        with patch.object(bills, "fetch_bill", _fake_bills()):
            cb._cashbook_worker(self.batch, "Administrator")

    def _id(self, txn: str) -> str:
        return txn + self.suffix

    def _line(self, txn: str):
        return frappe.get_doc("Outflow Import Row", {"import_batch": self.batch, "transfer_id": self._id(txn)})

    def _leg(self, txn: str):
        [leg] = frappe.get_all(
            "Outflow Row Match",
            filters={"transfer_id": self._id(txn), "match_kind": "Settled"},
            fields=["name", "target_doctype", "target_name", "target_amount"],
        )
        return leg

    def _expense(self, txn: str):
        leg = self._leg(txn)
        return frappe.get_doc(leg.target_doctype, leg.target_name)

    def _hand_project_expense(self, spend: str, expense_type: str, amount: float = 640, when=date(2026, 7, 1)) -> str:
        """A Paid Project Expense keyed in by hand for `spend` (its `payment_ref`), on a live Won project."""
        project = frappe.db.get_value(
            "Projects", {"tendering_status": "Won", "status": ["!=", "CEO Hold"]}, "name", order_by="creation asc"
        )
        doc = frappe.new_doc("Project Expenses")
        doc.update(
            {
                "projects": project,
                "type": expense_type,
                "status": "Paid",
                "amount": amount,
                "payment_date": when,
                "payment_ref": self._id(spend),
                "description": "Hand-keyed wallet spend",
            }
        )
        doc.flags.ignore_permissions = True
        doc.insert()
        frappe.db.commit()
        self.extra.append(("Project Expenses", doc.name))
        return doc.name


class TestTheJobBooksAnUnpairedRefund(RefundExpenseCase):
    def test_a_part_refund_is_a_paid_negative_expense_where_its_spend_was_booked(self):
        self._stage_and_run()
        spend, refund = self._expense(PART_SPEND), self._expense("REF-" + PART_SPEND)
        self.assertEqual((refund.doctype, refund.type), (spend.doctype, spend.type))
        self.assertEqual(float(refund.amount), -11248.0)
        self.assertEqual(refund.status, "Paid")
        self.assertEqual(refund.payment_ref, self._id("REF-" + PART_SPEND))
        self.assertEqual(str(refund.payment_date), str(self._line("REF-" + PART_SPEND).added_on.date()))
        self.assertEqual(refund.cashbook_batch, self.batch)
        self.assertEqual(refund.description, f"Wallet refund of {self._id(PART_SPEND)} from {MERCHANT}")
        # The match record carries the Expense's own amount, or the Expense's amount guard refuses every later edit.
        self.assertEqual(self._leg("REF-" + PART_SPEND).target_amount, -11248.0)
        self.assertEqual(self._line("REF-" + PART_SPEND).row_status, "Settled")

    def test_a_refund_whose_spend_has_a_project_expense_goes_on_that_project_and_type(self):
        expense_type = frappe.db.get_value("Expense Type", {"project": 1, "non_project": 0}, "name")
        spend_expense = self._hand_project_expense(EARLIER_SPEND, expense_type)
        self._stage_and_run()
        refund = self._expense("REF-" + EARLIER_SPEND)
        self.assertEqual(
            (refund.doctype, refund.projects, refund.type, float(refund.amount)),
            ("Project Expenses", frappe.db.get_value("Project Expenses", spend_expense, "projects"), expense_type, -640.0),
        )
        self.assertEqual(refund.payment_by, HOLDER)

    def test_a_refund_whose_spend_has_no_expense_is_a_non_project_expense(self):
        self._stage_and_run()
        refund = self._expense("REF-" + EARLIER_SPEND)
        self.assertEqual((refund.doctype, refund.type, float(refund.amount)), ("Non Project Expenses", "Petty Cash", -640.0))


class TestTheSpendsExpenseIsReadAsItIsNow(RefundExpenseCase):
    def test_the_expense_the_import_created_for_the_spend_with_its_type_as_changed_since(self):
        self._stage_and_run()
        spend = self._expense(PART_SPEND)
        retyped = frappe.db.get_value("Expense Type", {"non_project": 1, "name": ["!=", spend.type]}, "name")
        frappe.db.set_value(spend.doctype, spend.name, "type", retyped)  # raw: a test fixture; nothing derives from type
        found = spend_expenses([self._id(PART_SPEND)])[self._id(PART_SPEND)]
        self.assertEqual((found.doctype, found.name, found.expense_type), (spend.doctype, spend.name, retyped))


class TestARefundNeedsNoBill(RefundExpenseCase):
    def test_it_is_not_in_the_cashbook_invoice_queue_nor_the_bill_check_pill(self):
        self._stage_and_run()
        refund = self._expense("REF-" + PART_SPEND)
        waiting = {row["name"] for row in get_cashbook_invoice_queue()}
        self.assertFalse(refund.name in waiting)
        pill = frappe.db.sql(
            f"""SELECT e.name FROM "tab{refund.doctype}" e WHERE e.name = %s AND {KINDS["cashbook"].condition}""",
            (refund.name,),
        )
        self.assertFalse(pill)


class TestUnreconcile(RefundExpenseCase):
    def test_it_deletes_the_refund_expense_and_reopens_the_line(self):
        self._stage_and_run()
        line = self._line("REF-" + PART_SPEND).name
        refund = self._expense("REF-" + PART_SPEND)
        unreconcile_row(row=line, legs="all", reason="Booked on the wrong spend")
        self.assertFalse(frappe.db.exists(refund.doctype, refund.name))
        self.assertEqual(frappe.db.get_value("Outflow Import Row", line, "row_status"), "Mismatched")


class TestThePatchBooksTheRefundsLeftOpen(RefundExpenseCase):
    """`patches/v3_0/create_open_cashbook_refund_expenses`: the refund lines an import staged open before #1709."""

    def _open_the_refunds(self):
        """The two refund lines as an import before #1709 staged them: open, with no placement (raw: a test fixture;
        the lines carry no doc_events)."""
        self.refunds = [self._line("REF-" + PART_SPEND).name, self._line("REF-" + EARLIER_SPEND).name]
        frappe.db.set_value(
            "Outflow Import Row",
            {"name": ["in", self.refunds]},
            {
                "row_status": "Mismatched", "suggested_doctype": None, "suggested_expense_type": None,
                "match_basis": None, "auto_matched": 0, "outcome_note": "Unpaired wallet refund: decide what it is.",
            },
        )
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        self._stage_and_run(before_run=self._open_the_refunds)

    def test_each_open_refund_gets_its_expense_and_a_second_run_writes_nothing(self):
        from nirmaan_stack.patches.v3_0.create_open_cashbook_refund_expenses import create_open_refund_expenses

        self.assertEqual(self._line("REF-" + PART_SPEND).row_status, "Mismatched")
        first = create_open_refund_expenses(self.refunds)
        self.assertEqual((first.created["Non Project Expenses"], first.failed), (2, []))
        spend, refund = self._expense(PART_SPEND), self._expense("REF-" + PART_SPEND)
        self.assertEqual((refund.doctype, refund.type, float(refund.amount)), (spend.doctype, spend.type, -11248.0))
        self.assertEqual(refund.cashbook_batch, self.batch)
        self.assertEqual(self._line("REF-" + PART_SPEND).row_status, "Settled")

        second = create_open_refund_expenses(self.refunds)
        self.assertEqual((sum(second.created.values()), second.failed), (0, []))

    def test_a_line_a_person_decided_is_left_alone(self):
        from nirmaan_stack.patches.v3_0.create_open_cashbook_refund_expenses import create_open_refund_expenses

        frappe.db.set_value("Outflow Import Row", self.refunds[0], "confirm_by_hand", 1)  # raw: a test fixture
        frappe.db.commit()
        report = create_open_refund_expenses(self.refunds)
        self.assertEqual(sum(report.created.values()), 1)
        self.assertEqual(frappe.db.get_value("Outflow Import Row", self.refunds[0], "row_status"), "Mismatched")


    def test_a_refund_already_booked_is_counted_once_not_listed_and_left_open(self):
        from nirmaan_stack.patches.v3_0.create_open_cashbook_refund_expenses import create_open_refund_expenses

        line = self._line("REF-" + EARLIER_SPEND)
        expense_type = frappe.db.get_value("Expense Type", {"project": 1, "non_project": 0}, "name")
        self._hand_project_expense("REF-" + EARLIER_SPEND, expense_type, -line.amount, line.added_on.date())
        report = create_open_refund_expenses(self.refunds)
        self.assertEqual((report.created["Non Project Expenses"], report.already_booked, report.failed), (1, 1, []))
        self.assertIn("Already booked: 1", report.text())
        self.assertNotIn(line.name, report.text())
        self.assertEqual(frappe.db.get_value("Outflow Import Row", line.name, "row_status"), "Mismatched")


    def test_a_zero_line_is_not_selected_so_it_never_prints_on_a_run(self):
        from nirmaan_stack.patches.v3_0.create_open_cashbook_refund_expenses import create_open_refund_expenses

        frappe.db.set_value("Outflow Import Row", self.refunds[1], "amount", 0)  # raw: a test fixture
        frappe.db.commit()
        report = create_open_refund_expenses(self.refunds)
        self.assertEqual((sum(report.created.values()), report.failed), (1, []))
        self.assertEqual(frappe.db.get_value("Outflow Import Row", self.refunds[1], "row_status"), "Mismatched")

    def test_a_ledger_outside_the_expense_ledgers_is_refused_before_any_write_and_the_run_goes_on(self):
        from nirmaan_stack.api.outflow_import.cashbook_open_lines import LinePlace, create_open_lines, open_lines

        lines = open_lines(("Credit Adjustment", "Refund to Wallet"), self.refunds)
        report = create_open_lines(lines, lambda line: LinePlace("Bogus Ledger", None, "Petty Cash"))
        self.assertEqual(sum(report.created.values()), 0)
        self.assertEqual(sorted(line for line, _ in report.failed), sorted(self.refunds))
        for line in self.refunds:
            self.assertEqual(frappe.db.get_value("Outflow Import Row", line, "row_status"), "Mismatched")


class TestAReUpload(RefundExpenseCase):
    def test_the_same_statement_again_books_no_second_refund(self):
        self._stage_and_run()
        plan = cb._build_plan(self.parsed)
        self.assertNotIn(self._id("REF-" + PART_SPEND), {row.transfer_id for row in plan.creating})
