# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Expense bills from the two Pending Invoices Upload tabs (#1639, spec #1637, GLOSSARY *Expense bills*).

DB tests: `DEVENV test --module nirmaan_stack.api.expenses.test_expense_bills`. Attaching in the Credit Card or
the Cashbook tab records an Expense bill (Checking) and queues its reading; the reading job then gives the Bill
check. The reader is replaced (`expense_bills.reading.read_bill`), so no test touches the network, and
`frappe.enqueue` is captured (`expense_bill_fixture.capture_jobs`): the queue is shared with the main bench.
"""

from datetime import date
from decimal import Decimal
from unittest.mock import patch

import frappe

from nirmaan_stack.api.expenses.card_invoices import attach_card_invoice, get_card_invoice_queue
from nirmaan_stack.api.expenses.cashbook_invoices import attach_cashbook_invoice
from nirmaan_stack.api.expenses.expense_bill_fixture import cloud_url, purge_expense_bills
from nirmaan_stack.api.expenses.test_card_invoices import CardInvoiceCase
from nirmaan_stack.api.expenses.test_cashbook_invoices import NPE, PE, CashbookInvoiceCase
from nirmaan_stack.api.outflow_import.test_card_import import purge_records
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE as BILL
from nirmaan_stack.services.expense_bills import reading
from nirmaan_stack.services.expense_bills.bill_check import BillRead, ReadFailed
from nirmaan_stack.services.expense_bills.receive import receive_bill

READING_JOB = "nirmaan_stack.services.expense_bills.reading.check_expense_bill"
SETTINGS = "Document AI Settings"


def bills_of(doctype: str, expense: str) -> list[dict]:
    """Every Expense bill of `expense`, oldest first."""
    return frappe.get_all(
        BILL, filters={"expense_doctype": doctype, "expense": expense}, fields=["*"], order_by="creation asc"
    )


class FakeReader:
    """Stands in for `reading.read_bill`: answers `answer` and counts the bills it was asked to read."""

    def __init__(self, answer: BillRead | ReadFailed, output: dict | None = None):
        self.answer, self.output, self.files = answer, output, []

    def __call__(self, file_url: str) -> reading.Reading:
        self.files.append(file_url)
        return reading.Reading(self.answer, self.output)


def readings_queued(jobs: list) -> list[tuple[str, str]]:
    """(queue, bill) of each reading job among the captured `jobs` (saving an Expense queues others)."""
    return [(kw["queue"], kw["bill"]) for method, kw in jobs if method == READING_JOB]


def run_reading(bill: str, reader: FakeReader) -> None:
    with patch.object(reading, "read_bill", reader):
        reading.check_expense_bill(bill=bill)


class CardBillCase(CardInvoiceCase):
    """A card spend with its statement line, as the card import makes it (line, Settled match)."""

    def setUp(self):
        super().setUp()
        self.batch = frappe.get_doc(
            {"doctype": "Outflow Import Batch", "source": "ICICI Credit Card Statement"}
        ).insert(ignore_permissions=True).name
        self.addCleanup(self._purge_line)
        self.spend = self._expense(self.statement, amount=1180)
        self.line = frappe.get_doc(
            {"doctype": "Outflow Import Row", "import_batch": self.batch, "transfer_id": "70000000001",
             "amount": 1180, "row_status": "Settled", "direction": "Debit"}
        ).insert(ignore_permissions=True).name
        frappe.get_doc(
            {"doctype": "Outflow Row Match", "import_row": self.line, "import_batch": self.batch,
             "transfer_id": "70000000001", "target_doctype": NPE, "target_name": self.spend, "target_amount": 1180,
             "match_kind": "Settled", "match_basis": "card statement", "created_by_import": 1}
        ).insert(ignore_permissions=True)
        frappe.db.commit()

    def _purge_line(self):
        frappe.db.rollback()
        purge_expense_bills(self.expenses)
        for doctype, field in (("Outflow Row Match", "import_batch"), ("Outflow Import Row", "import_batch"),
                               ("Outflow Import Batch", "name")):
            purge_records(doctype, frappe.get_all(doctype, filters={field: self.batch}, pluck="name"))

    def _attach(self, **kwargs) -> tuple[str, str]:
        """Attach a bill (`self.bill_url`) to the spend as an Accountant; (the user, the Expense bill)."""
        user = self.users.make(ACCOUNTANT)
        self.bill_url = cloud_url("bill.pdf")
        self._as(user, attach_card_invoice, self.spend, self.bill_url, **kwargs)
        return user, bills_of(NPE, self.spend)[-1].name


class TestAttachingInTheCreditCardTab(CardBillCase):
    def test_attaching_records_a_checking_bill_against_its_statement_line_and_queues_its_reading(self):
        user, name = self._attach()

        bill = frappe.get_doc(BILL, name)
        self.assertEqual((bill.bill_check, bill.status, bill.is_latest), ("Checking", "Pending", 1))
        self.assertEqual(bill.bill_file, self.bill_url)
        self.assertEqual(bill.uploaded_by, user)
        self.assertEqual(bill.statement_line, self.line)
        self.assertEqual(float(bill.line_amount), 1180.0)
        self.assertEqual(readings_queued(self.jobs), [("long", name)])
        # The spend leaves the queue as it does today.
        self.assertNotIn(self.spend, {r["name"] for r in get_card_invoice_queue()})
        self.assertEqual(frappe.db.get_value(NPE, self.spend, "invoice_attachment"), self.bill_url)

    def test_a_mismatched_bill_stays_pending_and_writes_nothing_to_the_expense(self):
        _, name = self._attach()

        run_reading(name, FakeReader(BillRead(Decimal("1250.00"), "INV-9", date(2026, 9, 9))))

        bill = frappe.get_doc(BILL, name)
        self.assertEqual((bill.bill_check, bill.status, bill.auto_approved), ("Mismatched", "Pending", 0))
        self.assertEqual(bill.bill_check_reason, "The bill's total is ₹1,250.00; the statement line is ₹1,180.00.")
        # What was read is kept on the bill, never on the Expense.
        self.assertEqual((float(bill.read_total), bill.read_invoice_no), (1250.0, "INV-9"))
        self.assertEqual(frappe.db.get_value(NPE, self.spend, ["invoice_ref", "invoice_date"]), (None, None))

    def test_a_reader_error_is_not_read_with_its_reason_and_stays_pending(self):
        _, name = self._attach()

        run_reading(name, FakeReader(ReadFailed("The reader timed out.")))

        bill = frappe.get_doc(BILL, name)
        self.assertEqual((bill.bill_check, bill.bill_check_reason, bill.status), ("Not read", "The reader timed out.", "Pending"))
        self.assertEqual(frappe.db.get_value(NPE, self.spend, ["invoice_ref", "invoice_date"]), (None, None))

    def test_a_reader_that_raises_leaves_the_bill_not_read_never_stuck_checking(self):
        _, name = self._attach()

        def broken_reader(file_url):
            raise OSError("storage unreachable")

        run_reading(name, broken_reader)

        self.assertEqual(
            frappe.db.get_value(BILL, name, ["bill_check", "bill_check_reason", "status"]),
            ("Not read", "The reader failed (OSError).", "Pending"),
        )

    def test_a_bill_decided_by_a_person_while_it_was_read_keeps_that_decision(self):
        _, name = self._attach()

        def reader_while_a_person_rejects(file_url):
            frappe.db.set_value(BILL, name, {"status": "Rejected", "rejection_reason": "Wrong shop"})
            frappe.db.commit()
            return reading.Reading(BillRead(Decimal("1180.00"), "INV-1", date(2026, 9, 9)))

        run_reading(name, reader_while_a_person_rejects)

        self.assertEqual(frappe.db.get_value(BILL, name, ["status", "auto_approved"]), ("Rejected", 0))
        self.assertEqual(frappe.db.get_value(NPE, self.spend, ["invoice_ref", "invoice_date"]), (None, None))

    def test_a_result_that_cannot_be_saved_leaves_the_bill_not_read_never_stuck_checking(self):
        _, name = self._attach()

        with patch.object(reading, "_fill_expense", side_effect=frappe.ValidationError("expense refused the save")):
            run_reading(name, FakeReader(BillRead(Decimal("1180.00"), "INV-1", date(2026, 9, 9))))

        self.assertEqual(
            frappe.db.get_value(BILL, name, ["bill_check", "bill_check_reason", "status"]),
            ("Not read", "The Bill check could not be saved (ValidationError).", "Pending"),
        )

    def test_reading_switched_off_in_settings_is_not_read_without_calling_the_reader(self):
        _, name = self._attach()
        was = frappe.db.get_single_value(SETTINGS, "enabled")
        self.addCleanup(lambda: (frappe.db.set_single_value(SETTINGS, "enabled", was), frappe.db.commit()))
        frappe.db.set_single_value(SETTINGS, "enabled", 0)
        frappe.db.commit()

        reading.check_expense_bill(bill=name)  # the real reader

        bill = frappe.get_doc(BILL, name)
        self.assertEqual(
            (bill.bill_check, bill.bill_check_reason), ("Not read", "Reading is switched off in Document AI Settings.")
        )

    def test_queuing_the_reading_twice_reads_the_bill_once(self):
        _, name = self._attach()
        reader = FakeReader(BillRead(Decimal("1180.00"), "INV-1", date(2026, 9, 9)))

        run_reading(name, reader)
        run_reading(name, reader)

        self.assertEqual(reader.files, [self.bill_url])
        self.assertEqual(frappe.db.get_value(BILL, name, "bill_check"), "Matched")

    def test_a_bill_claimed_by_a_running_reading_is_not_read_by_a_second_job(self):
        _, name = self._attach()
        reader = FakeReader(BillRead(Decimal("1180.00")))

        def first_reader(file_url):
            # While the first job reads, a second job for the same bill starts.
            run_reading(name, second)
            return reading.Reading(BillRead(Decimal("1180.00")))

        second = reader
        run_reading(name, first_reader)

        self.assertEqual(reader.files, [])
        self.assertEqual(frappe.db.get_value(BILL, name, "bill_check"), "Matched")


class TestAttachingInTheCashbookTab(CashbookInvoiceCase):
    def _attach(self, invoice_ref=None, invoice_date=None) -> str:
        self._as(self.users.make(ACCOUNTANT), attach_cashbook_invoice, self.pe, PE, cloud_url("wallet.pdf"),
                 invoice_ref=invoice_ref, invoice_date=invoice_date)
        return bills_of(PE, self.pe)[-1].name

    def test_attaching_records_a_checking_bill_with_its_wallet_line_and_queues_its_reading(self):
        name = self._attach()

        bill = frappe.get_doc(BILL, name)
        line = frappe.db.get_value(
            "Outflow Row Match", {"target_doctype": PE, "target_name": self.pe, "match_kind": "Settled"}, "import_row"
        )
        self.assertEqual((bill.bill_check, bill.status, bill.statement_line), ("Checking", "Pending", line))
        self.assertEqual(float(bill.line_amount), float(frappe.db.get_value("Outflow Import Row", line, "amount")))
        self.assertEqual(readings_queued(self.jobs), [("long", name)])
        self.assertNotIn(self.pe, self._queue())

    def test_a_matched_bill_fills_number_and_date_and_is_auto_approved(self):
        name = self._attach()
        line_amount = Decimal(str(frappe.db.get_value(BILL, name, "line_amount")))
        output = {"entities": [{"type": "total_amount", "mention_text": "x", "normalized_text": "x", "confidence": 1.0}]}

        run_reading(name, FakeReader(BillRead(line_amount + Decimal("1"), "WB-501", date(2026, 9, 20)), output))

        bill = frappe.get_doc(BILL, name)
        self.assertEqual((bill.bill_check, bill.status, bill.auto_approved), ("Matched", "Approved", 1))
        self.assertEqual(bill.approved_by, "System")
        self.assertTrue(bill.approved_on)
        self.assertEqual((bill.invoice_no, str(bill.invoice_date)), ("WB-501", "2026-09-20"))
        self.assertEqual(Decimal(str(bill.invoice_amount)), line_amount + Decimal("1"))
        self.assertEqual(frappe.parse_json(bill.reader_output), output)
        self.assertEqual(
            frappe.db.get_value(PE, self.pe, ["invoice_ref", "invoice_date"]), ("WB-501", date(2026, 9, 20))
        )

    def test_a_typed_number_and_date_are_on_the_bill_from_the_start(self):
        name = self._attach(invoice_ref=" TYPED-1 ", invoice_date="2026-09-01")

        self.assertEqual(
            frappe.db.get_value(BILL, name, ["invoice_no", "invoice_date", "bill_check"]),
            ("TYPED-1", date(2026, 9, 1), "Checking"),
        )

    def test_a_matched_bill_never_replaces_a_number_or_date_a_person_typed(self):
        name = self._attach(invoice_ref="TYPED-1")
        line_amount = Decimal(str(frappe.db.get_value(BILL, name, "line_amount")))

        run_reading(name, FakeReader(BillRead(line_amount, "WB-501", date(2026, 9, 20))))

        # The typed number stands; the read date fills the empty one, on the bill and on the Expense alike.
        self.assertEqual(
            frappe.db.get_value(PE, self.pe, ["invoice_ref", "invoice_date"]), ("TYPED-1", date(2026, 9, 20))
        )
        self.assertEqual(
            frappe.db.get_value(BILL, name, ["invoice_no", "invoice_date", "status"]),
            ("TYPED-1", date(2026, 9, 20), "Approved"),
        )

    def test_a_reading_that_does_not_match_leaves_a_typed_number_and_date_on_the_bill(self):
        name = self._attach(invoice_ref="TYPED-2", invoice_date="2026-09-01")
        line_amount = Decimal(str(frappe.db.get_value(BILL, name, "line_amount")))

        run_reading(name, FakeReader(BillRead(line_amount + 50, "WB-501", date(2026, 9, 20))))

        self.assertEqual(
            frappe.db.get_value(BILL, name, ["bill_check", "invoice_no", "invoice_date"]),
            ("Mismatched", "TYPED-2", date(2026, 9, 1)),
        )

    def test_a_reading_with_no_total_is_not_read_and_writes_nothing_to_the_expense(self):
        name = self._attach()

        run_reading(name, FakeReader(BillRead(None, "WB-501", date(2026, 9, 20))))

        self.assertEqual(
            frappe.db.get_value(BILL, name, ["bill_check", "bill_check_reason", "status"]),
            ("Not read", "No total was read on the bill.", "Pending"),
        )
        self.assertEqual(frappe.db.get_value(PE, self.pe, ["invoice_ref", "invoice_date"]), (None, None))
        self.assertNotIn(self.pe, self._queue())


class TestABillUrlOfRealLength(CardBillCase):
    """The cloud storage app's bill URLs run 200 to 270 characters (spec #1637 review: every Project Expenses bill
    link in the 2026-10-28 data is over 140, the longest 269). An Expense bill keeps the whole of one however the
    bill lands: attached by hand, copied by the Cashbook import, approved at once from Payment Done, a Collect
    payment's with its kept reading, or a file merged from several bills."""

    def setUp(self):
        super().setUp()
        self.url = cloud_url("Made Up Stores Private Limited tax invoice 2026-09-20 at 11.16.42 rev.pdf")
        self.assertGreaterEqual(len(self.url), 250)
        self.user = self.users.make(ACCOUNTANT)

    def _spend(self):
        return frappe.get_doc(NPE, self.spend, for_update=True)

    def _kept_whole(self):
        """The spend's latest bill; its file and the spend's attachment both hold the whole URL."""
        self.assertEqual(frappe.db.get_value(NPE, self.spend, "invoice_attachment"), self.url)
        bill = bills_of(NPE, self.spend)[-1]
        self.assertEqual(bill.bill_file, self.url)
        return bill

    def test_attached_by_hand(self):
        self._as(self.user, attach_card_invoice, self.spend, self.url)

        self.assertEqual(self._kept_whole().bill_check, "Checking")

    def test_copied_by_the_cashbook_import(self):
        receive_bill(self._spend(), self.url, None, None, self.user)

        self.assertEqual(self._kept_whole().bill_check, "Checking")

    def test_approved_at_once_from_payment_done(self):
        receive_bill(self._spend(), self.url, "TYPED-5", "2026-09-20", self.user, approve=True)

        bill = self._kept_whole()
        self.assertEqual((bill.status, bill.approved_by, bill.invoice_no), ("Approved", self.user, "TYPED-5"))

    def test_a_collect_payments_bill_with_the_reading_kept_on_its_line(self):
        kept = reading.Reading(BillRead(Decimal("1180.00"), "SHOP-5", date(2026, 9, 20)), {"entities": []})

        receive_bill(self._spend(), self.url, None, None, self.user, kept=kept, file_stays=True)

        bill = self._kept_whole()
        self.assertEqual((bill.bill_check, bill.status, bill.invoice_no), ("Matched", "Approved", "SHOP-5"))
        self.assertEqual(frappe.db.count("File", {"attached_to_doctype": NPE, "attached_to_name": self.spend}), 0)

    def test_a_file_merged_from_several_bills(self):
        receive_bill(self._spend(), self.url, None, None, self.user, bill_count=2)

        self.assertEqual(self._kept_whole().bill_check, "Not checked")
