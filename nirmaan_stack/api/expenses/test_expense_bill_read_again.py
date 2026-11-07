# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read again on a Not read Expense bill in Pending Approval -> Cashbook / Credit Card (#1645, spec #1637,
GLOSSARY *Expense bills*).

DB tests: `DEVENV test --module nirmaan_stack.api.expenses.test_expense_bill_read_again`. A card bill is attached and
read Not read through the replaced reader (`expense_bills.reading.read_bill`), so no test touches the network, and
`frappe.enqueue` is captured: the queue is shared with the main bench.
"""

from datetime import date
from decimal import Decimal

import frappe
from frappe.utils import add_to_date, now_datetime

from nirmaan_stack.api.expenses.expense_bill_approval import (
    approve_expense_bill,
    get_pending_expense_bills,
    read_expense_bill_again,
)
from nirmaan_stack.api.expenses.test_expense_bills import CardBillCase, FakeReader, readings_queued, run_reading
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE as BILL
from nirmaan_stack.services.expense_bills.bill_check import BillRead, ReadFailed


class NotReadCardBillCase(CardBillCase):
    """A card spend whose bill could not be read: it waits in Pending Approval -> Credit Card as Not read."""

    def setUp(self):
        super().setUp()
        _, self.bill = self._attach()
        run_reading(self.bill, FakeReader(ReadFailed("The reader failed (ClientError).")))
        self.jobs.clear()


class TestReadAgain(NotReadCardBillCase):
    def test_an_accountant_lead_puts_a_not_read_bill_back_to_checking_and_its_reading_is_queued(self):
        self._as(self.users.make(ACCOUNTANT_LEAD), read_expense_bill_again, self.bill)

        self.assertEqual(
            frappe.db.get_value(BILL, self.bill, ["bill_check", "bill_check_reason", "read_claimed_at"]),
            ("Checking", None, None),
        )
        self.assertEqual(readings_queued(self.jobs), [("long", self.bill)])

    def test_an_accountant_cannot_read_a_bill_again(self):
        with self.assertRaises(frappe.PermissionError):
            self._as(self.users.make(ACCOUNTANT), read_expense_bill_again, self.bill)

        self.assertEqual(frappe.db.get_value(BILL, self.bill, "bill_check"), "Not read")
        self.assertEqual(readings_queued(self.jobs), [])

    def test_a_bill_whose_check_is_not_not_read_cannot_be_read_again(self):
        frappe.db.set_value(BILL, self.bill, {"bill_check": "Mismatched", "bill_check_reason": None})
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError):
            self._as(self.users.make(ACCOUNTANT_LEAD), read_expense_bill_again, self.bill)

        self.assertEqual(frappe.db.get_value(BILL, self.bill, "bill_check"), "Mismatched")
        self.assertEqual(readings_queued(self.jobs), [])

    def test_pressing_twice_reads_the_bill_once(self):
        lead = self.users.make(ACCOUNTANT_LEAD)
        self._as(lead, read_expense_bill_again, self.bill)
        self._as(lead, read_expense_bill_again, self.bill)  # a double click, or a second tab: no error
        reader = FakeReader(BillRead(Decimal("1250.00")))

        for _, queued in readings_queued(self.jobs):
            run_reading(queued, reader)

        self.assertEqual(len(reader.files), 1)
        self.assertEqual(frappe.db.get_value(BILL, self.bill, "bill_check"), "Mismatched")

    def test_a_matched_reading_is_auto_approved_and_leaves_pending_approval(self):
        self._as(self.users.make(ACCOUNTANT_LEAD), read_expense_bill_again, self.bill)

        run_reading(self.bill, FakeReader(BillRead(Decimal("1180.00"), "INV-77", date(2026, 9, 9))))

        self.assertEqual(
            frappe.db.get_value(BILL, self.bill, ["bill_check", "status", "auto_approved", "approved_by"]),
            ("Matched", "Approved", 1, "System"),
        )
        self.assertNotIn(self.bill, self._listed())

    def test_any_other_reading_stays_in_pending_approval(self):
        lead = self.users.make(ACCOUNTANT_LEAD)
        for answer, result in ((BillRead(Decimal("1250.00")), "Mismatched"),
                               (ReadFailed("The reader timed out."), "Not read")):
            with self.subTest(result):
                frappe.db.set_value(BILL, self.bill, "bill_check", "Not read")
                frappe.db.commit()
                self._as(lead, read_expense_bill_again, self.bill)

                run_reading(self.bill, FakeReader(answer))

                self.assertEqual(self._listed()[self.bill]["bill_check"], result)
                self.assertEqual(frappe.db.get_value(BILL, self.bill, "status"), "Pending")

    def _listed(self) -> dict:
        rows = self._as(self.users.make(ACCOUNTANT), get_pending_expense_bills, "card")
        return {r["name"]: r for r in rows}


class TestAReadingThatStopped(NotReadCardBillCase):
    """A worker killed mid-read (past the job limit) leaves its bill Checking with its claim set (#1639)."""

    def _stop_reading(self, minutes_ago: int):
        frappe.db.set_value(BILL, self.bill, {
            "bill_check": "Checking", "bill_check_reason": None,
            "read_claimed_at": add_to_date(now_datetime(), minutes=-minutes_ago),
        })
        frappe.db.commit()

    def _listed(self) -> dict:
        rows = self._as(self.users.make(ACCOUNTANT), get_pending_expense_bills, "card")
        return {r["name"]: r for r in rows}

    def test_a_bill_claimed_longer_ago_than_the_job_limit_shows_as_not_read_because_the_reading_stopped(self):
        self._stop_reading(minutes_ago=16)

        row = self._listed()[self.bill]

        self.assertEqual((row["bill_check"], row["bill_check_reason"]), ("Not read", "The reading stopped."))

    def test_a_bill_still_inside_the_job_limit_is_not_listed(self):
        self._stop_reading(minutes_ago=5)

        self.assertNotIn(self.bill, self._listed())

    def test_read_again_reaches_a_bill_whose_reading_stopped(self):
        self._stop_reading(minutes_ago=16)

        self._as(self.users.make(ACCOUNTANT_LEAD), read_expense_bill_again, self.bill)
        run_reading(self.bill, FakeReader(BillRead(Decimal("1250.00"))))

        self.assertEqual(frappe.db.get_value(BILL, self.bill, "bill_check"), "Mismatched")

    def test_read_again_on_a_bill_still_being_read_reads_it_once(self):
        self._stop_reading(minutes_ago=5)

        self._as(self.users.make(ACCOUNTANT_LEAD), read_expense_bill_again, self.bill)

        self.assertEqual(readings_queued(self.jobs), [])
        self.assertEqual(frappe.db.get_value(BILL, self.bill, "bill_check"), "Checking")

    def test_a_bill_whose_reading_stopped_can_be_approved_and_keeps_why_it_was_not_read(self):
        self._stop_reading(minutes_ago=16)

        self._as(self.users.make(ACCOUNTANT), approve_expense_bill, self.bill)

        self.assertEqual(
            frappe.db.get_value(BILL, self.bill, ["status", "bill_check", "bill_check_reason"]),
            ("Approved", "Not read", "The reading stopped."),
        )
