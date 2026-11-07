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

from nirmaan_stack.api.expenses.test_expense_bills import FakeReader, bills_of
from nirmaan_stack.api.outflow_import.test_cashbook_collect_payments import COLLECT_WITH_LINK, CollectPaymentCase
from nirmaan_stack.services.expense_bills import line_check, reading
from nirmaan_stack.services.expense_bills.bill_check import BillRead

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
