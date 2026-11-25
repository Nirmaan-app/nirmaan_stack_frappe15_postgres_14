# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The one-off back-fill that approves the Cashbook import's waiting and rejected bills (#1755, spec #1753
stories 67-69, "Back-fill").

Each test runs the Cashbook job inline (`test_cashbook_bills.CashbookBillsCase`), puts the import's bills back the way
the code before #1755 left them (Pending, or rejected by a person), adds a person's uploads, and runs the back-fill
on this test's Expenses only. ⚠️ It calls `approve_import_bills(expenses=...)`, never `execute()`, which would approve
every such bill on the site.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_approve_cashbook_import_bills_patch
"""

import io
import random
from decimal import Decimal

import frappe
from PIL import Image

from nirmaan_stack.api.expenses.cashbook_invoices import attach_cashbook_invoice
from nirmaan_stack.api.expenses.expense_bill_approval import reject_expense_bill
from nirmaan_stack.api.expenses.test_expense_bill_approval import _as
from nirmaan_stack.api.expenses.test_expense_bills import FakeReader, bills_of, run_reading
from nirmaan_stack.api.outflow_import.test_cashbook_bills import (
    FOUR_LINKS,
    NO_LINK,
    NON_PROJECT_ONE_LINK,
    ONE_LINK,
    CashbookBillsCase,
    _fake_bills,
)
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, _Users
from nirmaan_stack.cloud_file_fixture import cloud_url
from nirmaan_stack.patches.v3_0.approve_cashbook_import_bills import approve_import_bills
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE as BILL
from nirmaan_stack.services.expense_bills.bill_check import BillRead
from nirmaan_stack.services.outflow_import.bill_download import BillFile

#: What the back-fill must leave as it found it on a bill.
KEPT = ("bill_check", "bill_check_reason", "read_total", "read_invoice_no", "read_invoice_date", "invoice_no",
        "invoice_date", "invoice_amount", "bill_file", "is_latest")
#: ... and on its Expense.
EXPENSE_KEPT = ("invoice_attachment", "invoice_ref", "invoice_date", "modified")


def _unique_bills() -> dict:
    """Bills whose bytes no earlier test stored: the local file store gives a file with the same bytes as a stored one
    that file's URL, which would then carry an earlier test's Txn Id (the cloud store, as on production, names every
    file afresh)."""
    def image(fmt: str) -> BillFile:
        out = io.BytesIO()
        Image.new("RGB", (300, 400), tuple(random.randrange(256) for _ in range(3))).save(out, format=fmt)
        return BillFile(out.getvalue(), fmt.lower())

    return {
        (ONE_LINK, "1.jpeg"): image("JPEG"),
        (FOUR_LINKS, "1.jpeg"): image("JPEG"),
        (NON_PROJECT_ONE_LINK, "1.pdf"): image("PNG"),
    }


def _line_amount(expense) -> Decimal:
    return Decimal(str(expense.amount)).quantize(Decimal("0.01"))


def _as_before_1755(bill: str) -> None:
    """The import's bill as the code before #1755 left it: Pending, no approval. Raw: `Expense Bill` has no
    doc_events; a seeded state."""
    frappe.db.set_value(
        BILL, bill, {"status": "Pending", "auto_approved": 0, "approved_by": None, "approved_on": None},
        update_modified=False,
    )
    frappe.db.commit()


class TestTheBackFill(CashbookBillsCase):
    def setUp(self):
        super().setUp()
        self.users = _Users()
        self.addCleanup(self.users.purge)
        self.accountant = self.users.make(ACCOUNTANT)
        self._run(_fake_bills(_unique_bills()))
        self.mismatched, self.rejected, self.replaced, self.no_link = (
            self._expense(txn) for txn in (ONE_LINK, FOUR_LINKS, NON_PROJECT_ONE_LINK, NO_LINK)
        )

        # The import's bill, waiting with a Mismatched reading.
        (bill,) = bills_of(self.mismatched.doctype, self.mismatched.name)
        _as_before_1755(bill.name)
        run_reading(bill.name, FakeReader(BillRead(_line_amount(self.mismatched) + 50, "IMP-7")))
        self.waiting_bill = bill.name

        # The import's bill, rejected by a person (its Expense's attachment cleared by the rejection).
        (bill,) = bills_of(self.rejected.doctype, self.rejected.name)
        _as_before_1755(bill.name)
        _as(self.accountant, reject_expense_bill, bill.name, reason="Blurred photo")
        self.rejected_bill = bill.name

        # The import's bill rejected, then replaced by a person's upload: the rejected one is history.
        (bill,) = bills_of(self.replaced.doctype, self.replaced.name)
        _as_before_1755(bill.name)
        run_reading(bill.name, FakeReader(BillRead(_line_amount(self.replaced) + 50)))
        _as(self.accountant, reject_expense_bill, bill.name, reason="Wrong shop")
        self.old_rejected_bill = bill.name
        self.persons_upload = self._upload(self.replaced, "person-upload.pdf")

        # A person's upload named after its Txn Id, on a line that had no bill link: not the import's.
        txn = frappe.db.get_value(
            "Outflow Import Row", {"import_batch": self.batch, "suggested_name": self.no_link.name}, "transfer_id"
        )
        self.named_upload = self._upload(self.no_link, f"{txn}.pdf")

        self.ours = [e.name for e in (self.mismatched, self.rejected, self.replaced, self.no_link)]

    def _upload(self, expense, file_name: str) -> str:
        _as(self.accountant, attach_cashbook_invoice, expense.name, expense.doctype, cloud_url(file_name))
        bill = bills_of(expense.doctype, expense.name)[-1].name
        run_reading(bill, FakeReader(BillRead(_line_amount(expense) + 50)))
        return bill

    def _bill(self, name):
        return frappe.db.get_value(BILL, name, ["*"], as_dict=True)

    def _expense_state(self, expense):
        return frappe.db.get_value(expense.doctype, expense.name, list(EXPENSE_KEPT), as_dict=True)

    def test_it_approves_the_imports_waiting_and_rejected_bills_and_nothing_else(self):
        before = {name: self._bill(name) for name in (self.waiting_bill, self.rejected_bill)}
        expenses_before = {e.name: self._expense_state(e) for e in (self.mismatched, self.rejected)}

        approved = approve_import_bills(expenses=self.ours)

        self.assertEqual(sorted(approved), sorted([self.waiting_bill, self.rejected_bill]))
        for name in (self.waiting_bill, self.rejected_bill):
            bill = self._bill(name)
            self.assertEqual((bill.status, bill.auto_approved, bill.approved_by), ("Approved", 1, "System"))
            self.assertTrue(bill.approved_on)
            self.assertEqual((bill.rejection_reason, bill.rejected_by, bill.rejected_on), (None, None, None))
            self.assertEqual({f: bill[f] for f in KEPT}, {f: before[name][f] for f in KEPT})
            # Saved through the document layer: the change is in the bill's history.
            self.assertTrue(frappe.db.exists("Version", {"ref_doctype": BILL, "docname": name, "data": ["like", '%"System"%']}))
        self.assertEqual(self._bill(self.waiting_bill).bill_check, "Mismatched")
        for expense in (self.mismatched, self.rejected):
            self.assertEqual(self._expense_state(expense), expenses_before[expense.name])

        # A person's uploads still wait; the import's rejected bill a person since replaced stays rejected.
        self.assertEqual(self._bill(self.persons_upload).status, "Pending")
        self.assertEqual(self._bill(self.named_upload).status, "Pending")
        self.assertEqual(self._bill(self.old_rejected_bill).status, "Rejected")

    def test_a_second_run_changes_nothing(self):
        approve_import_bills(expenses=self.ours)
        after_first = {b.name: b.modified for e in (self.mismatched, self.rejected, self.replaced, self.no_link)
                       for b in bills_of(e.doctype, e.name)}

        self.assertEqual(approve_import_bills(expenses=self.ours), [])
        after_second = {b.name: b.modified for e in (self.mismatched, self.rejected, self.replaced, self.no_link)
                        for b in bills_of(e.doctype, e.name)}
        self.assertEqual(after_second, after_first)
