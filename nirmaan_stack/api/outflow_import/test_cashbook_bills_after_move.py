# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A bill the Cashbook job still owes reaches the expense a Move put its Txn Id on (spec #1753 story 18: "no invoice
is lost by a move"; story 27: on Internal Transfer it is the record's proof).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_cashbook_bills_after_move

Seam: two uploads at the Cashbook import endpoints (`test_cashbook_late_bills.LateBillsCase`) and the Move write call
(`rectify.rectify_lines`). Only the transport is faked: the queue (held, then run as the queue would run it) and the
bill downloader (`cashbook_bills.fetch_bill`). Read back the way the screens read it: the expense of the Txn Id, its
bills, the Internal Transfer record, the import summary's bills not copied.
"""

import json
from unittest.mock import patch

import frappe

from nirmaan_stack.api.expenses.test_expense_bills import bills_of
from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import cashbook_bills as bills
from nirmaan_stack.api.outflow_import import rectify
from nirmaan_stack.api.outflow_import.test_cashbook_bills import _fake_bills
from nirmaan_stack.api.outflow_import.test_cashbook_late_bills import LATE, LINKED, LateBillsCase
from nirmaan_stack.api.outflow_import.test_porter_rectify import _purge_history
from nirmaan_stack.services.expense_type_ledger import ledger_types

REASON = "The remark names the site"
INTERNAL_TRANSFER = "Internal Transfer"


class MoveCase(LateBillsCase):
    """One made-up Won project to move to."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        doc = frappe.new_doc("Projects")
        doc.project_name = f"Testmove Bills {frappe.generate_hash(length=4)}"
        doc.tendering_status = "Won"
        doc.project_start_date = frappe.utils.now()[:19]
        doc.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
        doc.project_scopes = {"scopes": []}
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.project = doc.name
        cls.project_type = ledger_types()["Project Expenses"][0]

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        frappe.delete_doc("Projects", cls.project, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        # Last in, first out: runs before the batches' purge, while the matches still name the moved expenses.
        self.addCleanup(self._purge_move_leftovers)

    def _purge_move_leftovers(self):
        frappe.db.rollback()
        rows = frappe.get_all("Outflow Import Row", filters={"import_batch": ["in", self.batches or [""]]}, pluck="name")
        records = frappe.get_all(INTERNAL_TRANSFER, filters={"import_row": ["in", rows or [""]]}, pluck="name")
        if records:
            frappe.db.delete("File", {"attached_to_doctype": INTERNAL_TRANSFER, "attached_to_name": ["in", records]})
            frappe.db.commit()
        for batch in self.batches:
            _purge_history(batch)

    def _settled_line(self, txn: str) -> str:
        return frappe.db.get_value("Outflow Import Row", {"transfer_id": txn, "row_status": "Settled"}, "name")

    def _move_to_project(self, txn: str) -> dict:
        result = rectify.rectify_lines(json.dumps([self._settled_line(txn)]), self.project, REASON, self.project_type)
        [line] = result["lines"]
        self.assertTrue(line["rectified"], line)
        return line

    def _move_to_transfer(self, txn: str) -> dict:
        result = rectify.rectify_lines(
            json.dumps([self._settled_line(txn)]), reason=REASON, destination=INTERNAL_TRANSFER,
            other_end="ICICI Credit Card", detail="Card ending 4321",
        )
        [line] = result["lines"]
        self.assertTrue(line["rectified"], line)
        return line

    def _confirm_and_hold(self, content: bytes) -> str:
        """Confirm `content` with its job held in the queue. Returns the batch."""
        with patch.object(cb, "_enqueue_worker"):
            result = self._post(cb.confirm_cashbook_import, content)
        self.batches.append(result["batch"])
        return result["batch"]

    def _run_job(self, batch: str):
        with patch.object(bills, "fetch_bill", _fake_bills()):
            cb._cashbook_worker(batch, "Administrator")


class TestALateBillFollowsAMoveMadeBeforeTheJob(MoveCase):
    def test_the_moved_expense_gets_the_bill_and_nothing_is_listed_not_copied(self):
        waiting = self._first_upload()
        batch = self._confirm_and_hold(self._second_file())

        moved = self._move_to_project(LATE)
        self._run_job(batch)

        self.assertFalse(frappe.db.exists(waiting.doctype, waiting.name))
        after = self._expense(LATE)
        self.assertEqual((after.doctype, after.name), (moved["to"]["doctype"], moved["to"]["name"]))
        self.assertTrue(after.invoice_attachment)
        [bill] = bills_of(after.doctype, after.name)
        self.assertEqual(bill.bill_file, after.invoice_attachment)
        self.assertTrue(frappe.db.exists(
            "File", {"file_url": after.invoice_attachment, "attached_to_doctype": after.doctype, "attached_to_name": after.name}
        ))
        self.assertEqual(bills.bills_not_copied(batch), [])
        self.assertEqual(bills.bills_waiting(batch), 0)

    def test_moved_to_internal_transfer_the_bill_is_the_records_proof(self):
        waiting = self._first_upload()
        batch = self._confirm_and_hold(self._second_file())

        moved = self._move_to_transfer(LATE)
        self._run_job(batch)

        self.assertFalse(frappe.db.exists(waiting.doctype, waiting.name))
        self.assertEqual(self._expenses_of(LATE), [])
        record = frappe.get_doc(INTERNAL_TRANSFER, moved["to"]["name"])
        self.assertTrue(record.proof)
        self.assertTrue(frappe.db.exists(
            "File", {"file_url": record.proof, "attached_to_doctype": INTERNAL_TRANSFER, "attached_to_name": record.name}
        ))
        self.assertEqual(bills.bills_not_copied(batch), [])


class TestACreatedLinesBillFollowsAMoveMadeDuringItsDownload(MoveCase):
    def test_the_moved_expense_gets_the_bill(self):
        moves = []
        fake = _fake_bills()

        def fetch_while_moving(url: str):
            # The line is created and committed before its bills are fetched; a Move lands during the download.
            if LINKED in url and not moves:
                moves.append(self._move_to_project(LINKED))
            return fake(url)

        def run_now(batch, actor, **kwargs):
            cb._cashbook_worker(batch, actor, **kwargs)

        with patch.object(bills, "fetch_bill", fetch_while_moving), \
                patch.object(cb, "_enqueue_worker", side_effect=run_now):
            result = self._post(cb.confirm_cashbook_import, self._file(self.data[:3]))
        self.batches.append(result["batch"])

        [moved] = moves
        self.assertFalse(frappe.db.exists(moved["from"]["doctype"], moved["from"]["name"]))
        after = self._expense(LINKED)
        self.assertEqual((after.doctype, after.name), (moved["to"]["doctype"], moved["to"]["name"]))
        self.assertTrue(after.invoice_attachment)
        [bill] = bills_of(after.doctype, after.name)
        self.assertEqual(bill.bill_file, after.invoice_attachment)
        self.assertEqual(bills.bills_not_copied(result["batch"]), [])
