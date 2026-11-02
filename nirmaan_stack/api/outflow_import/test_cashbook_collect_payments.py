# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A person decides each Collect payment (#1595, spec #1585 "Phase 2 stages new open lines away from the job",
"A Collect payment's bill", "Open Cashbook lines", "If someone picks Create expense on a Collect payment").

Seam 1: the Cashbook import (preview, staging, the job run inline) on the real-file fixture
(`cashbook_statement.xlsx`), with the bill downloader (`cashbook._fetch_bill`) faked. Seam 2: the main-table
endpoints a person decides the open line with (`expenses.create_expense`, `review.skip_row`), and the Cashbook
invoice queue the Expense waits in. No test touches the network.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_collect_payments
"""

import dataclasses
from datetime import timedelta
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expenses.cashbook_invoices import get_cashbook_invoice_queue
from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.expenses import create_expense
from nirmaan_stack.api.outflow_import.review import skip_row
from nirmaan_stack.api.outflow_import.test_cashbook_bills import PORTRAIT_JPEG, STATEMENT, _fake_bills
from nirmaan_stack.api.outflow_import.test_cashbook_import import _purge
from nirmaan_stack.api.outflow_import.test_cashbook_statement_upload import EARLIEST_EXPIRY, _post
from nirmaan_stack.services.outflow_import.bill_download import BillRefused
from nirmaan_stack.services.outflow_import.parser import parse_statement

COLLECT_WITH_LINK = "OBO9000000000001CPLINK"  # Rs 480, one bill (1.jpeg)
COLLECT_NO_LINK = "OBO9000000000002CPNONE"  # Rs 199, no bill
HIGHLIGHT = "Shop-requested payment, check it."


class CollectPaymentCase(FrappeTestCase):
    """Stages the fixture with per-test Txn Ids (the dev DB is a copy of production) and runs the job inline."""

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.suffix = "C" + frappe.generate_hash(length=6).upper()
        parsed = parse_statement(STATEMENT.read_bytes(), source="Cashbook")
        self.parsed = dataclasses.replace(
            parsed,
            rows=[dataclasses.replace(r, transfer_id=r.transfer_id + self.suffix) for r in parsed.rows],
        )
        self.batch = cb._stage(
            self.parsed,
            cb._build_plan(self.parsed),
            file_url="/private/files/test-statement.xlsx",
            filename="test-statement.xlsx",
            user="Administrator",
        ).name
        frappe.db.commit()
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        frappe.db.rollback()
        for match in frappe.get_all(
            "Outflow Row Match", filters={"import_batch": self.batch}, fields=["target_doctype", "target_name"]
        ):
            frappe.db.delete("File", {"attached_to_doctype": match.target_doctype, "attached_to_name": match.target_name})
        lines = frappe.get_all("Outflow Import Row", filters={"import_batch": self.batch}, pluck="name")
        if lines:
            frappe.db.delete("File", {"attached_to_doctype": "Outflow Import Row", "attached_to_name": ["in", lines]})
        frappe.db.commit()
        _purge(self.batch)

    def _run(self, fetch=None):
        with patch.object(cb, "_fetch_bill", fetch or _fake_bills()):
            cb._cashbook_worker(self.batch, "Administrator")

    def _line(self, txn: str):
        return frappe.get_doc(
            "Outflow Import Row", {"import_batch": self.batch, "transfer_id": txn + self.suffix}
        )

    def _expenses_of(self, txn: str) -> list:
        return frappe.get_all(
            "Outflow Row Match",
            filters={"transfer_id": txn + self.suffix, "match_kind": "Settled"},
            fields=["target_doctype", "target_name"],
        )


class TestTheImportLeavesCollectPaymentsOpen(CollectPaymentCase):
    def test_each_unpaired_collect_payment_is_an_open_line_the_job_never_creates(self):
        self._run()
        for txn in (COLLECT_WITH_LINK, COLLECT_NO_LINK):
            line = self._line(txn)
            self.assertEqual(line.row_status, "Mismatched", txn)
            self.assertEqual(line.outcome_note, HIGHLIGHT, txn)
            self.assertEqual(self._expenses_of(txn), [], txn)
        self.assertEqual(frappe.db.count("Outflow Import Row", {"import_batch": self.batch, "row_status": "Error"}), 0)

    def test_an_open_collect_payment_carries_the_wallet_spend_placement_for_create(self):
        line = self._line(COLLECT_NO_LINK)
        self.assertEqual(line.suggested_doctype, "Non Project Expenses")
        self.assertEqual(line.suggested_expense_type, "Petty Cash")
        self.assertEqual(line.row_kind, "Collect Payment")

    def test_the_linked_collect_payment_has_its_bill_copied_onto_the_line_at_import(self):
        self._run()
        line = self._line(COLLECT_WITH_LINK)
        self.assertTrue(line.stored_bill)
        stored = frappe.get_doc("File", {"file_url": line.stored_bill})
        self.assertEqual(stored.get_content(), PORTRAIT_JPEG)
        self.assertEqual((stored.attached_to_doctype, stored.attached_to_name), ("Outflow Import Row", line.name))
        self.assertTrue(stored.is_private)
        self.assertFalse(self._line(COLLECT_NO_LINK).stored_bill)

    def test_a_failed_download_leaves_the_line_open_with_no_bill_and_named_in_the_summary(self):
        fetch = _fake_bills({(COLLECT_WITH_LINK, "1.jpeg"): BillRefused("the server answered 403")})
        self._run(fetch)
        line = self._line(COLLECT_WITH_LINK)
        self.assertEqual(line.row_status, "Mismatched")
        self.assertFalse(line.stored_bill)
        named = {
            entry["transfer_id"]: entry["reason"]
            for entry in cb.get_cashbook_status(self.batch)["bills_not_copied"]
        }
        self.assertEqual(named[COLLECT_WITH_LINK + self.suffix], "Bill not copied: the server answered 403.")


class TestReviewHighlightsCollectPayments(FrappeTestCase):
    def test_review_lists_each_unpaired_collect_payment_highlighted(self):
        with patch.object(cb, "_utc_now", return_value=EARLIEST_EXPIRY - timedelta(days=3)):
            preview = _post(cb.preview_cashbook_statement, STATEMENT.read_bytes(), "statement.xlsx")
        highlighted = {line["transfer_id"]: line for line in preview["collect_payments"]}
        self.assertEqual(set(highlighted), {COLLECT_WITH_LINK, COLLECT_NO_LINK})
        self.assertEqual(highlighted[COLLECT_WITH_LINK]["reason"], HIGHLIGHT)
        self.assertEqual(highlighted[COLLECT_WITH_LINK]["amount"], 480.0)
        created = {row["transfer_id"] for group in preview["groups"] for row in group["rows"]}
        self.assertFalse(created & set(highlighted))


class TestAPersonDecidesACollectPayment(CollectPaymentCase):
    def _create(self, txn: str):
        line = self._line(txn)
        return create_expense(
            row=line.name, doctype=line.suggested_doctype, expense_type=line.suggested_expense_type
        )

    def test_create_expense_gives_the_expense_the_stored_bill_as_its_invoice(self):
        self._run()
        stored = self._line(COLLECT_WITH_LINK).stored_bill
        self._create(COLLECT_WITH_LINK)
        [match] = self._expenses_of(COLLECT_WITH_LINK)
        expense = frappe.get_doc(match.target_doctype, match.target_name)
        self.assertEqual(expense.invoice_attachment, stored)
        self.assertEqual(expense.cashbook_batch, self.batch)
        self.assertEqual(float(expense.amount), 480.0)
        self.assertNotIn(expense.name, {row["name"] for row in get_cashbook_invoice_queue()})
        self.assertEqual(self._line(COLLECT_WITH_LINK).row_status, "Settled")

    def test_create_expense_without_a_bill_waits_in_the_cashbook_tab(self):
        self._run()
        self._create(COLLECT_NO_LINK)
        [match] = self._expenses_of(COLLECT_NO_LINK)
        expense = frappe.get_doc(match.target_doctype, match.target_name)
        self.assertFalse(expense.invoice_attachment)
        waiting = {row["name"]: row for row in get_cashbook_invoice_queue()}
        self.assertIn(expense.name, waiting)
        self.assertEqual(waiting[expense.name]["paid_by"], "Asha Menon")

    def test_skip_by_hand_needs_a_reason_and_records_who_and_when(self):
        self._run()
        line = self._line(COLLECT_NO_LINK)
        with self.assertRaises(frappe.ValidationError):
            skip_row(row=line.name, reason="  ")
        self.assertEqual(self._line(COLLECT_NO_LINK).row_status, "Mismatched")

        skip_row(row=line.name, reason="personal, employee repaid")
        line = self._line(COLLECT_NO_LINK)
        self.assertEqual(line.row_status, "Skipped")
        self.assertEqual(line.skip_reason, "personal, employee repaid")
        self.assertEqual(line.decided_by, "Administrator")
        self.assertTrue(line.decided_at)
        self.assertEqual(self._expenses_of(COLLECT_NO_LINK), [])
