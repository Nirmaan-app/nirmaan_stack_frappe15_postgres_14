# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Collect payment becomes an Expense like any wallet spend (#1708, ADR-0015 Amendment C; was #1595).

Seam 1: the Cashbook import (preview, staging, the job run inline) on the real-file fixture
(`cashbook_statement.xlsx`), with the bill downloader (`cashbook_bills.fetch_bill`) faked. The Expense then waits in
the Cashbook invoice queue like any wallet spend without a bill. No test touches the network.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_collect_payments
"""

import dataclasses
from datetime import timedelta
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.expenses.cashbook_invoices import get_cashbook_invoice_queue
from nirmaan_stack.api.expenses.expense_bill_fixture import capture_jobs
from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import cashbook_bills as bills
from nirmaan_stack.api.outflow_import.test_cashbook_bills import PORTRAIT_JPEG, STATEMENT, _fake_bills
from nirmaan_stack.api.outflow_import.test_cashbook_import import _purge
from nirmaan_stack.api.outflow_import.test_cashbook_statement_upload import EARLIEST_EXPIRY, _post
from nirmaan_stack.services.outflow_import.bill_download import BillRefused
from nirmaan_stack.services.outflow_import.parser import parse_statement

COLLECT_WITH_LINK = "OBO9000000000001CPLINK"  # Rs 480, one bill (1.jpeg)
COLLECT_NO_LINK = "OBO9000000000002CPNONE"  # Rs 199, no bill
COLLECT_PAID_BY = "Asha Menon"  # the statement's From on both


class CollectPaymentCase(FrappeTestCase):
    """Stages the fixture with per-test Txn Ids (the dev DB is a copy of production); `_run` runs the job inline."""

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        # #1641: a copied bill queues its reading; the queue is shared with the main bench.
        self.jobs = capture_jobs(self)
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
        with patch.object(bills, "fetch_bill", fetch or _fake_bills()):
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

    def _expense_of(self, txn: str):
        [match] = self._expenses_of(txn)
        return frappe.get_doc(match.target_doctype, match.target_name)


class TestTheJobCreatesEachCollectPayment(CollectPaymentCase):
    def test_each_collect_payment_is_staged_for_the_job_with_its_placement(self):
        line = self._line(COLLECT_NO_LINK)
        self.assertEqual(line.row_status, "Pending match run")
        self.assertEqual((line.suggested_doctype, line.suggested_expense_type), ("Non Project Expenses", "Petty Cash"))
        self.assertEqual(line.row_kind, "Collect Payment")
        self.assertFalse(line.outcome_note)

    def test_the_job_creates_its_expense_as_it_creates_any_wallet_spend(self):
        self._run()
        for txn, amount in ((COLLECT_WITH_LINK, 480.0), (COLLECT_NO_LINK, 199.0)):
            with self.subTest(txn=txn):
                self.assertEqual(self._line(txn).row_status, "Settled")
                expense = self._expense_of(txn)
                self.assertEqual(float(expense.amount), amount)
                self.assertEqual(expense.cashbook_batch, self.batch)
                self.assertEqual(expense.payment_ref, txn + self.suffix)

    def test_its_bills_are_copied_onto_the_expense_as_its_invoice(self):
        self._run()
        expense = self._expense_of(COLLECT_WITH_LINK)
        self.assertTrue(expense.invoice_attachment)
        stored = frappe.get_doc("File", {"file_url": expense.invoice_attachment})
        self.assertEqual(stored.get_content(), PORTRAIT_JPEG)
        self.assertFalse(self._line(COLLECT_WITH_LINK).stored_bill)

    def test_one_without_a_bill_waits_in_the_cashbook_tab(self):
        self._run()
        expense = self._expense_of(COLLECT_NO_LINK)
        self.assertFalse(expense.invoice_attachment)
        waiting = {row["name"]: row for row in get_cashbook_invoice_queue()}
        self.assertEqual(waiting[expense.name]["paid_by"], COLLECT_PAID_BY)

    def test_a_failed_download_is_named_in_the_summary_with_its_expense(self):
        self._run(_fake_bills({(COLLECT_WITH_LINK, "1.jpeg"): BillRefused("the server answered 403")}))
        expense = self._expense_of(COLLECT_WITH_LINK)
        self.assertFalse(expense.invoice_attachment)
        named = {entry["transfer_id"]: entry for entry in cb.get_cashbook_status(self.batch)["bills_not_copied"]}
        entry = named[COLLECT_WITH_LINK + self.suffix]
        self.assertEqual((entry["expense"], entry["reason"]), (expense.name, "Bill not copied: the server answered 403."))


class TestReviewListsCollectPaymentsWithTheSpends(FrappeTestCase):
    def test_review_counts_each_unpaired_collect_payment_among_what_it_creates(self):
        with patch.object(cb, "_utc_now", return_value=EARLIEST_EXPIRY - timedelta(days=3)):
            preview = _post(cb.preview_cashbook_statement, STATEMENT.read_bytes(), "statement.xlsx")
        self.assertNotIn("collect_payments", preview)
        created = {row["transfer_id"] for group in preview["groups"] for row in group["rows"]}
        self.assertLessEqual({COLLECT_WITH_LINK, COLLECT_NO_LINK}, created)
        self.assertNotIn(COLLECT_NO_LINK, {line["transfer_id"] for line in preview["open_lines"]})
