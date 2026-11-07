# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Collect payment's bill is checked at import and shown when deciding the line (#1642, spec #1637 stories
19-21).

Seam: the Cashbook job run inline (`cashbook._cashbook_worker`) with the bill download faked
(`cashbook_bills.fetch_bill`), the line's reading run inline with the reader faked (`expense_bills.reading.read_bill`),
then the main-table endpoints a person decides the line with (`expenses.create_expense`, `review.skip_row`) and the
row the main table ships (`review.get_master_rows`). `frappe.enqueue` is captured; no test touches the network.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_collect_bill_check
"""

from decimal import Decimal
from unittest.mock import patch

import frappe

from nirmaan_stack.api.expenses.test_expense_bill_approval import keeping_versions
from nirmaan_stack.api.expenses.test_expense_bills import FakeReader, bills_of, readings_queued
from nirmaan_stack.api.outflow_import.expenses import create_expense
from nirmaan_stack.api.outflow_import.review import get_outflow_rows, skip_row
from nirmaan_stack.api.outflow_import.unreconcile import plan_of_line
from nirmaan_stack.api.outflow_import.test_cashbook_collect_payments import COLLECT_WITH_LINK, CollectPaymentCase
from nirmaan_stack.services.expense_bills import line_check, reading
from nirmaan_stack.services.expense_bills.bill_check import BillRead, ReadFailed

LINE_READING_JOB = "nirmaan_stack.services.expense_bills.line_check.check_collect_line"
LINE_AMOUNT = Decimal("480.00")  # COLLECT_WITH_LINK's amount in the fixture


def line_readings_queued(jobs: list) -> list[tuple[str, str]]:
    return [(kw["queue"], kw["line"]) for method, kw in jobs if method == LINE_READING_JOB]


def run_line_reading(line: str, reader: FakeReader) -> None:
    with patch.object(reading, "read_bill", reader):
        line_check.check_collect_line(line=line)


class TestTheStoredBillIsCheckedAtImport(CollectPaymentCase):
    def test_the_stored_bill_is_checking_with_its_reading_queued_and_a_matching_total_makes_it_matched(self):
        self._run()
        line = self._line(COLLECT_WITH_LINK)
        self.assertEqual(line.bill_check, "Checking")
        self.assertIn(("long", line.name), line_readings_queued(self.jobs))

        reader = FakeReader(BillRead(total=LINE_AMOUNT + Decimal("0.60"), invoice_no="SHOP-7"))
        run_line_reading(line.name, reader)

        line = self._line(COLLECT_WITH_LINK)
        self.assertEqual(reader.files, [line.stored_bill])
        self.assertEqual((line.bill_check, line.read_invoice_no), ("Matched", "SHOP-7"))
        self.assertEqual(Decimal(str(line.read_total)), LINE_AMOUNT + Decimal("0.60"))


class TestSeveralBillsAreNotChecked(CollectPaymentCase):
    def test_a_line_with_two_bill_links_is_not_checked_and_never_read(self):
        line = self._line(COLLECT_WITH_LINK)
        (link,) = frappe.parse_json(line.bill_links)["links"]
        two = [link, link.replace("1.jpeg", "2.pdf")]
        # Raw: the fixture's line staged with one link; the statement could carry two.
        frappe.db.set_value("Outflow Import Row", line.name, "bill_links", frappe.as_json({"links": two}))
        frappe.db.commit()

        self._run()

        line = self._line(COLLECT_WITH_LINK)
        self.assertTrue(line.stored_bill)
        self.assertEqual(line.bill_check, "Not checked")
        self.assertEqual(line_readings_queued(self.jobs), [])
        reader = FakeReader(BillRead(total=Decimal("1")))
        run_line_reading(line.name, reader)
        self.assertEqual(reader.files, [])


class TestCreateMovesTheKeptCheckToTheExpenseBill(CollectPaymentCase):
    def _checked_line(self, reader: FakeReader):
        self._run()
        line = self._line(COLLECT_WITH_LINK)
        run_line_reading(line.name, reader)
        return self._line(COLLECT_WITH_LINK)

    def _create(self, line):
        create_expense(row=line.name, doctype=line.suggested_doctype, expense_type=line.suggested_expense_type)
        [match] = self._expenses_of(COLLECT_WITH_LINK)
        return frappe.get_doc(match.target_doctype, match.target_name)

    def test_a_matched_line_makes_an_auto_approved_expense_bill_without_reading_again(self):
        line = self._checked_line(FakeReader(BillRead(total=LINE_AMOUNT, invoice_no="SHOP-7"), {"entities": []}))
        queued_before = list(self.jobs)
        reader = FakeReader(BillRead(total=Decimal("1")))
        with patch.object(reading, "read_bill", reader):
            expense = self._create(line)

        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.bill_check, bill.status, bill.auto_approved), ("Matched", "Approved", 1))
        self.assertEqual((bill.bill_file, bill.statement_line), (line.stored_bill, line.name))
        self.assertEqual(Decimal(str(bill.line_amount)), LINE_AMOUNT)
        self.assertEqual(bill.read_invoice_no, "SHOP-7")
        self.assertEqual(frappe.parse_json(bill.reader_output), {"entities": []})
        self.assertEqual((expense.invoice_attachment, expense.invoice_ref), (line.stored_bill, "SHOP-7"))
        self.assertEqual(readings_queued(self.jobs), readings_queued(queued_before))
        self.assertEqual(reader.files, [])
        # The bill's one File stays with the line: an undo deletes the Expense with every File attached to it.
        self.assertEqual(
            frappe.db.count("File", {"file_url": line.stored_bill, "attached_to_doctype": "Outflow Import Row",
                                     "attached_to_name": line.name, "attached_to_field": "stored_bill"}),
            1,
        )
        self.assertEqual(
            frappe.db.count("File", {"attached_to_doctype": expense.doctype, "attached_to_name": expense.name,
                                     "attached_to_field": "invoice_attachment"}),
            0,
        )
        self.assertEqual(frappe.db.count("File", {"attached_to_doctype": "Expense Bill"}), 0)

    def test_a_mismatched_line_makes_a_pending_expense_bill_and_fills_nothing(self):
        line = self._checked_line(FakeReader(BillRead(total=LINE_AMOUNT + 50, invoice_no="SHOP-8")))
        expense = self._create(line)

        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.bill_check, bill.status, bill.auto_approved), ("Mismatched", "Pending", 0))
        self.assertFalse(expense.invoice_ref)

    def test_a_not_read_line_makes_a_pending_expense_bill_with_its_reason(self):
        line = self._checked_line(FakeReader(ReadFailed("The reader timed out.")))
        expense = self._create(line)

        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.bill_check, bill.status), ("Not read", "Pending"))
        self.assertEqual(bill.bill_check_reason, "The reader timed out.")

    def test_a_line_still_checking_makes_a_checking_expense_bill_whose_reading_is_queued(self):
        self._run()
        line = self._line(COLLECT_WITH_LINK)
        expense = self._create(line)

        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.bill_check, bill.status), ("Checking", "Pending"))
        self.assertIn(("long", bill.name), readings_queued(self.jobs))
        # The line's own reading, should it still run, reads nothing: the line is decided.
        reader = FakeReader(BillRead(total=LINE_AMOUNT))
        run_line_reading(line.name, reader)
        self.assertEqual(reader.files, [])


class TestOnlyCreateMakesAnExpenseBill(CollectPaymentCase):
    def test_skipping_a_checked_line_makes_no_expense_bill(self):
        self._run()
        line = self._line(COLLECT_WITH_LINK)
        run_line_reading(line.name, FakeReader(BillRead(total=LINE_AMOUNT)))
        before = frappe.db.count("Expense Bill")

        skip_row(row=line.name, reason="personal, employee repaid")

        self.assertEqual(self._line(COLLECT_WITH_LINK).row_status, "Skipped")
        self.assertEqual(frappe.db.count("Expense Bill"), before)
        self.assertEqual(frappe.db.count("Expense Bill", {"statement_line": line.name}), 0)


class TestTheMainTableCarriesTheKeptCheck(CollectPaymentCase):
    def test_an_open_collect_payment_row_ships_its_stored_bill_and_bill_check(self):
        self._run()
        line = self._line(COLLECT_WITH_LINK)
        run_line_reading(line.name, FakeReader(BillRead(total=LINE_AMOUNT)))

        page = get_outflow_rows(scope="not_matched_outflow", batch=self.batch, limit=500)
        (row,) = [row for row in page["rows"] if row["name"] == line.name]
        self.assertEqual((row["stored_bill"], row["bill_check"]), (line.stored_bill, "Matched"))


class TestAMatchedCreateCanStillBeUndone(CollectPaymentCase):
    def test_the_matched_number_and_date_are_no_edit_after_the_match_so_unreconcile_still_deletes_the_expense(self):
        self._run()
        line = self._line(COLLECT_WITH_LINK)
        run_line_reading(line.name, FakeReader(BillRead(total=LINE_AMOUNT, invoice_no="SHOP-9")))
        line = self._line(COLLECT_WITH_LINK)

        with keeping_versions(), patch.object(reading, "read_bill", FakeReader(BillRead(total=Decimal("1")))):
            create_expense(row=line.name, doctype=line.suggested_doctype, expense_type=line.suggested_expense_type)
        [match] = self._expenses_of(COLLECT_WITH_LINK)
        self.assertEqual(frappe.db.get_value(match.target_doctype, match.target_name, "invoice_ref"), "SHOP-9")

        (leg,) = plan_of_line(line.name)["legs"]
        self.assertEqual((leg["verdict"], leg["reason"]), ("delete_created", None))
