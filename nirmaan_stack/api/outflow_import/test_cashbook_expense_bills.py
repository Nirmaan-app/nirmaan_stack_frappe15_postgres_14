# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The bills the Cashbook import copies get the Bill check (#1641, spec #1637 stories 6, 8, 15, 16).

Seam: the Cashbook job run inline (`cashbook._cashbook_worker`, and the two-upload endpoints for a late bill), with
both transports replaced: the bill download (`cashbook_bills.fetch_bill`) and the reader
(`expense_bills.reading.read_bill`). `frappe.enqueue` is captured (`expense_bill_fixture.capture_jobs`): each
captured reading is then run inline, as the `long` queue would run it.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_expense_bills
"""

from decimal import Decimal
from unittest.mock import patch

import frappe

from nirmaan_stack.api.expenses.test_expense_bills import (
    READING_JOB,
    FakeReader,
    bills_of,
    readings_queued,
    run_reading,
)
from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import cashbook_bills as bills
from nirmaan_stack.api.outflow_import.test_cashbook_bills import FOUR_LINKS, ONE_LINK, CashbookBillsCase, _fake_bills
from nirmaan_stack.api.outflow_import.test_cashbook_late_bills import LATE, LateBillsCase
from nirmaan_stack.services.expense_bills import reading
from nirmaan_stack.services.expense_bills.bill_check import BillRead


def _line_amount(expense) -> Decimal:
    return Decimal(str(expense.amount)).quantize(Decimal("0.01"))


class TestACopiedBillIsChecked(CashbookBillsCase):
    def test_a_created_line_with_one_bill_gets_a_checking_expense_bill_whose_reading_then_matches(self):
        self._run()
        expense = self._expense(ONE_LINK)

        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.bill_check, bill.status, bill.is_latest), ("Checking", "Pending", 1))
        self.assertEqual(bill.bill_file, expense.invoice_attachment)
        self.assertEqual(bill.uploaded_by, "Administrator")
        self.assertIn(("long", bill.name), readings_queued(self.jobs))

        reader = FakeReader(BillRead(total=_line_amount(expense), invoice_no="WALLET-1"))
        run_reading(bill.name, reader)
        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.bill_check, bill.status, bill.auto_approved), ("Matched", "Approved", 1))
        self.assertEqual(frappe.db.get_value(expense.doctype, expense.name, "invoice_ref"), "WALLET-1")


class TestAReadingFailureNeverFailsTheImport(CashbookBillsCase):
    def test_a_reading_the_queue_refuses_leaves_every_line_created_the_bill_kept_and_the_bill_not_read(self):
        def queue_down(method, **kwargs):
            if method == READING_JOB:
                raise ConnectionError("the queue is down")
            self.jobs.append((method, kwargs))

        with patch.object(frappe, "enqueue", side_effect=queue_down):
            self._run()

        status = cb.get_cashbook_status(self.batch)
        self.assertEqual((status["failed"], status["pending"], status["bills_not_copied"]), (0, 0, []))
        expense = self._expense(ONE_LINK)
        self.assertTrue(frappe.db.exists("File", {"file_url": expense.invoice_attachment}))
        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.bill_check, bill.status), ("Not read", "Pending"))
        self.assertEqual(bill.bill_check_reason, "The reading could not be queued.")

    def test_a_reader_that_raises_leaves_the_bill_not_read_and_its_expense_with_its_bill(self):
        self._run()
        expense = self._expense(ONE_LINK)
        (bill,) = bills_of(expense.doctype, expense.name)

        def broken(file_url):
            raise RuntimeError("the reader fell over")

        with patch.object(reading, "read_bill", broken):
            reading.check_expense_bill(bill=bill.name)

        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual(bill.bill_check, "Not read")
        self.assertEqual(frappe.db.get_value(expense.doctype, expense.name, "invoice_attachment"), bill.bill_file)
        status = cb.get_cashbook_status(self.batch)
        self.assertEqual((status["failed"], status["pending"]), (0, 0))


class TestALateBillIsChecked(LateBillsCase):
    def test_a_late_bill_gets_a_checking_expense_bill_whose_reading_then_mismatches(self):
        waiting = self._first_upload()
        self.assertEqual(bills_of(waiting.doctype, waiting.name), [])
        self._upload(self._second_file())

        expense = frappe.get_doc(waiting.doctype, waiting.name)
        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.bill_check, bill.status), ("Checking", "Pending"))
        self.assertEqual(bill.bill_file, expense.invoice_attachment)
        self.assertEqual(bill.uploaded_by, "Administrator")
        self.assertIn(("long", bill.name), readings_queued(self.jobs))

        run_reading(bill.name, FakeReader(BillRead(total=_line_amount(expense) + 50, invoice_no="LATE-1")))
        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.bill_check, bill.status, bill.auto_approved), ("Mismatched", "Pending", 0))
        self.assertFalse(frappe.db.get_value(expense.doctype, expense.name, "invoice_ref"))

    def test_a_late_bill_for_an_expense_from_before_the_cashbook_marker_is_recorded_like_any_other(self):
        waiting = self._first_upload()
        frappe.db.set_value(waiting.doctype, waiting.name, "cashbook_batch", None)
        frappe.db.commit()
        self._upload(self._second_file())

        (bill,) = bills_of(waiting.doctype, waiting.name)
        self.assertEqual((bill.bill_check, bill.status), ("Checking", "Pending"))
        self.assertIn(("long", bill.name), readings_queued(self.jobs))


class _WorkerKilled(BaseException):
    """The worker died: not an `Exception`, so no error path of the job sees it."""


class TestResumeNeverReadsACheckedBillAgain(LateBillsCase):
    def test_a_job_killed_after_the_late_bill_was_filed_is_resumed_without_a_second_bill_or_reading(self):
        waiting = self._first_upload()
        attach_then_die = bills._store_and_attach

        def killed_after_attaching(*args):
            attach_then_die(*args)
            raise _WorkerKilled

        with patch.object(bills, "_store_and_attach", side_effect=killed_after_attaching), self.assertRaises(
            _WorkerKilled
        ):
            self._upload(self._second_file())
        frappe.db.rollback()
        batch = frappe.get_all(
            "Outflow Import Batch", filters={"source": "Cashbook"}, order_by="creation desc", limit=1, pluck="name"
        )[0]
        self.batches.append(batch)

        (bill,) = bills_of(waiting.doctype, waiting.name)
        reader = FakeReader(BillRead(total=_line_amount(frappe.get_doc(waiting.doctype, waiting.name))))
        run_reading(bill.name, reader)
        self.assertEqual(bills_of(waiting.doctype, waiting.name)[0].bill_check, "Matched")
        self.assertEqual(cb.get_cashbook_status(batch)["bills_waiting"], 1)  # the job died before marking it done

        queued_before = len(readings_queued(self.jobs))
        with patch.object(bills, "fetch_bill", _fake_bills()):
            cb.resume_cashbook_import(batch)
            cb._cashbook_worker(batch, "Administrator")
        run_reading(bill.name, reader)  # the reading job, should it run again, finds the bill already checked

        (after,) = bills_of(waiting.doctype, waiting.name)
        self.assertEqual((after.name, after.bill_check, after.status), (bill.name, "Matched", "Approved"))
        self.assertEqual(len(reader.files), 1)
        self.assertEqual(len(readings_queued(self.jobs)), queued_before)
        self.assertEqual(cb.get_cashbook_status(batch)["bills_waiting"], 0)


class TestResumeAfterACreatedLinesBillWasChecked(CashbookBillsCase):
    def test_running_the_job_again_files_no_second_bill_and_queues_no_reading(self):
        self._run()
        expense = self._expense(ONE_LINK)
        (bill,) = bills_of(expense.doctype, expense.name)
        reader = FakeReader(BillRead(total=_line_amount(expense)))
        run_reading(bill.name, reader)
        queued_before = len(readings_queued(self.jobs))

        self._run()  # what Resume queues: the same job on the same batch

        (after,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((after.name, after.bill_check), (bill.name, "Matched"))
        self.assertEqual(len(readings_queued(self.jobs)), queued_before)
        self.assertEqual(len(reader.files), 1)


class TestALateBillOfSeveralBillsIsNotChecked(LateBillsCase):
    def test_a_late_bill_with_two_links_is_not_checked_and_never_read(self):
        waiting = self._first_upload()
        late_link = next(part for part in self.late_line.split('"') if part.startswith("https://"))
        two_links = self.late_line.replace(
            f'"{late_link}","","",""', f'"{late_link}","{late_link.replace("1.jpeg", "2.pdf")}","",""'
        )
        self._upload(self._file([self.data[0], two_links, *self.data[2:]]))

        (bill,) = bills_of(waiting.doctype, waiting.name)
        line_amount = _line_amount(frappe.get_doc(waiting.doctype, waiting.name))
        self.assertEqual((bill.bill_check, bill.status), ("Not checked", "Pending"))
        self.assertEqual(Decimal(str(bill.invoice_amount)), line_amount)
        self.assertNotIn(("long", bill.name), readings_queued(self.jobs))


class TestASpendWithSeveralBillsIsNotChecked(CashbookBillsCase):
    def test_four_bill_links_make_a_pending_not_checked_bill_whose_total_is_the_line_amount_and_nothing_is_read(self):
        self._run()
        expense = self._expense(FOUR_LINKS)

        (bill,) = bills_of(expense.doctype, expense.name)
        self.assertEqual((bill.bill_check, bill.status, bill.auto_approved), ("Not checked", "Pending", 0))
        self.assertEqual(Decimal(str(bill.invoice_amount)), _line_amount(expense))
        self.assertEqual((bill.invoice_no, bill.invoice_date), (None, None))
        self.assertEqual(bill.bill_file, expense.invoice_attachment)
        self.assertEqual(readings_queued(self.jobs).count(("long", bill.name)), 0)
        # Even a reading job run for it by mistake reads nothing: it is not Checking.
        reader = FakeReader(BillRead(total=Decimal("1")))
        run_reading(bill.name, reader)
        self.assertEqual(reader.files, [])
        self.assertEqual(bills_of(expense.doctype, expense.name)[0].bill_check, "Not checked")
