# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Wallet refunds pair with their spend, and wallet credits stay open (#1594, spec #1585, ADR-0015 Amendment B
decision 7). GLOSSARY: *Paired wallet refund*, *Unpaired wallet refund*, *Wallet credit*.

Seam 1: the Cashbook import run inline on the real-file fixture (`cashbook_statement.xlsx`), with the bill
downloader replaced (`test_cashbook_bills._fake_bills`); then the open lines worked at the main-table endpoints,
as an Unpaired card credit is (`test_card_credits` is the prior art). The fixture's Txn Ids get a per-test
suffix before staging (the `test_cashbook_bills` harness): a refund's `REF-<Txn Id>` keeps naming its spend.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_refunds
"""

from datetime import datetime, timezone
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.expenses import guard_not_an_own_import_line
from nirmaan_stack.api.outflow_import.inflows import create_non_project_inflow, create_vendor_refund
from nirmaan_stack.api.outflow_import.review import (
    SCOPE_NOT_MATCHED_INFLOW,
    get_outflow_rows,
    get_outflow_summary,
    skip_row,
)
from nirmaan_stack.api.outflow_import.test_cashbook_bills import STATEMENT, CashbookBillsCase
from nirmaan_stack.api.outflow_import.test_cashbook_statement_upload import _post
from nirmaan_stack.services.outflow_import.cashbook_refunds import REFUND_MOVED_STATUSES, REFUND_ROW_KINDS
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_CASHBOOK_REFUND_PAIR

ROW_DOCTYPE = "Outflow Import Row"
COLLECT_FULL = "OBO9000000000003CPFULL"
PART_SPEND = "OBO9000000000004PARTSP"
ADJUSTED_SPEND = "OBO9000000000005ADJFUL"
EARLIER_REFUND = "REF-OBO9000000000008EARLYR"
WALLET_CREDIT = "PTM9000000006"
INTERNAL = ("BUSINESS_USER-900001-0", "VALOAD-9000001", "BUSINESS_USER-900007-1")
OWN_BALANCES = "Moves money between our own balances, not a spend"

_FIELDS = [
    "name", "transfer_id", "amount", "direction", "row_status", "skip_kind", "skip_origin", "skip_reason",
    "outcome_note", "suggested_doctype", "suggested_name",
]


class CashbookRefundsCase(CashbookBillsCase):
    def setUp(self):
        super().setUp()
        self._run()

    def _line(self, txn: str):
        return frappe.db.get_value(
            ROW_DOCTYPE, {"import_batch": self.batch, "transfer_id": txn + self.suffix}, _FIELDS, as_dict=True
        )


class TestPairedWalletRefunds(CashbookRefundsCase):
    def test_each_refund_and_its_spend_are_skipped_each_naming_the_other(self):
        for spend_id in (COLLECT_FULL, ADJUSTED_SPEND):
            refund, spend = self._line("REF-" + spend_id), self._line(spend_id)
            with self.subTest(spend=spend_id):
                for line in (refund, spend):
                    self.assertEqual(
                        (line.row_status, line.skip_kind, line.skip_origin),
                        ("Skipped", "Paired wallet refund", "System"),
                    )
                self.assertIn(spend.transfer_id, refund.skip_reason)
                self.assertIn(refund.transfer_id, spend.skip_reason)

    def test_the_paired_spend_creates_no_expense(self):
        spend = self._line(ADJUSTED_SPEND)
        self.assertFalse(spend.suggested_name)
        self.assertFalse(
            frappe.db.exists("Non Project Expenses", {"payment_ref": ADJUSTED_SPEND + self.suffix})
        )

    def test_the_paired_refund_is_stored_as_money_in_for_its_credit(self):
        refund = self._line("REF-" + ADJUSTED_SPEND)
        self.assertEqual((refund.amount, refund.direction), (2600.0, "Credit"))


class TestOpenLines(CashbookRefundsCase):
    def test_the_part_refund_is_open_and_its_spend_still_creates_its_expense(self):
        refund = self._line("REF-" + PART_SPEND)
        self.assertEqual((refund.row_status, refund.skip_kind or None), ("Mismatched", None))
        self.assertEqual((refund.amount, refund.direction), (11248.0, "Credit"))
        self.assertIn("gives back ₹11,248 of the ₹17,446 spend", refund.outcome_note)
        spend = self._line(PART_SPEND)
        self.assertEqual(spend.row_status, "Settled")
        self.assertTrue(frappe.db.exists(spend.suggested_doctype, spend.suggested_name))

    def test_a_refund_whose_spend_is_not_on_the_statement_is_open(self):
        refund = self._line(EARLIER_REFUND)
        self.assertEqual((refund.row_status, refund.amount, refund.direction), ("Mismatched", 640.0, "Credit"))
        self.assertIn("is not on this statement", refund.outcome_note)

    def test_the_wallet_credit_is_open_with_its_credit_amount(self):
        credit = self._line(WALLET_CREDIT)
        self.assertEqual((credit.row_status, credit.amount, credit.direction), ("Mismatched", 9000.0, "Credit"))
        self.assertTrue(credit.outcome_note.startswith("Wallet credit"))

    def test_the_job_leaves_every_open_line_open(self):
        status = cb.get_cashbook_status(self.batch)
        # 3 money-in lines and the 2 unpaired Collect payments (#1595).
        self.assertEqual((status["open"], status["pending"], status["failed"]), (5, 0, 0))

    def test_the_batch_summary_counts_every_open_money_in_line_as_received_and_undecided(self):
        """Story 42: an Unpaired wallet refund's raw status is REFUNDED, which on this statement is money that moved."""
        totals = get_outflow_summary(batch=self.batch)["totals"]
        # The part refund (11,248), the earlier statement's refund (640) and the wallet credit (9,000).
        self.assertEqual((totals["received_rows"], float(totals["received_value"])), (3, 20888.0))
        self.assertEqual((totals["open_received_rows"], float(totals["open_received_value"])), (3, 20888.0))
        listed = get_outflow_rows(scope=SCOPE_NOT_MATCHED_INFLOW, batch=self.batch)["rows"]
        self.assertEqual(totals["open_received_rows"], len(listed))

    def test_a_paired_refund_is_a_skipped_line_not_a_failed_transfer(self):
        """Only a Cashbook refund kind moves money on REFUNDED; any other line still needs SUCCESS."""
        lines = frappe.get_all(
            ROW_DOCTYPE,
            filters={"import_batch": self.batch},
            fields=["row_kind", "status_raw", "row_status", "skip_kind"],
        )

        def moved(line):
            status = (line.status_raw or "").strip().upper()
            return status == "SUCCESS" or (line.row_kind in REFUND_ROW_KINDS and status in REFUND_MOVED_STATUSES)

        paired = [line for line in lines if line.skip_kind == SKIP_KIND_CASHBOOK_REFUND_PAIR]
        self.assertTrue(paired, "the fixture pairs a wallet refund with its spend")
        self.assertTrue(all(moved(line) for line in paired))
        totals = get_outflow_summary(batch=self.batch)["totals"]
        self.assertEqual(totals["failed_rows"], sum(not moved(line) for line in lines))
        self.assertEqual(
            totals["skipped_rows"], sum(moved(line) and line.row_status == "Skipped" for line in lines)
        )

    def test_internal_movements_are_still_skipped_as_own_balances(self):
        for txn in INTERNAL:
            line = self._line(txn)
            with self.subTest(txn=txn):
                self.assertEqual(
                    (line.row_status, line.skip_kind, line.skip_reason),
                    ("Skipped", "Cashbook internal movement", OWN_BALANCES),
                )


class TestAnOpenMoneyInLineHasTheUnpairedCardCreditChoices(CashbookRefundsCase):
    """An open Cashbook money-in line is worked on the main table exactly as an Unpaired card credit is."""

    def test_the_open_lines_are_listed_as_money_in_not_matched(self):
        listed = {row["transfer_id"] for row in get_outflow_rows(scope=SCOPE_NOT_MATCHED_INFLOW, batch=self.batch)["rows"]}
        self.assertEqual(listed, {t + self.suffix for t in ("REF-" + PART_SPEND, EARLIER_REFUND, WALLET_CREDIT)})

    def test_no_main_table_write_is_refused_as_the_jobs_work(self):
        guard_not_an_own_import_line(frappe.db.get_value(ROW_DOCTYPE, self._line(WALLET_CREDIT).name, "*", as_dict=True))

    def test_it_may_be_recorded_as_money_in(self):
        line = self._line(WALLET_CREDIT)
        summary = create_non_project_inflow(row=line.name, inflow_type="Others", description="Site scrap sale")
        self.assertEqual((summary["settled"]["doctype"], summary["settled"]["amount"]), ("Non Project Inflows", 9000.0))
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, line.name, "row_status"), "Settled")

    def test_it_may_be_recorded_as_a_vendor_refund_against_a_misc_expense(self):
        line = self._line("REF-" + PART_SPEND)
        vendor = frappe.db.get_value("Vendors", {"vendor_name": ["is", "set"]}, "name", order_by="name asc")
        summary = create_vendor_refund(
            row=line.name,
            vendor=vendor,
            allocations=[{"document_type": "Misc. Expense", "document_name": "", "amount": "11248"}],
        )
        self.assertEqual([r["amount"] for r in summary["records"]], [11248.0])
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, line.name, "row_status"), "Settled")

    def test_it_may_be_skipped_by_hand(self):
        line = self._line(EARLIER_REFUND)
        skip_row(line.name, "Refund of a spend booked by hand last month")
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, line.name, ["row_status", "skip_kind"]), ("Skipped", "Skipped by hand")
        )


class TestReviewShowsThePairsAndTheOpenLines(FrappeTestCase):
    def setUp(self):
        # No staging: the preview writes nothing. The fixture's links are live until 2026-11-06 09:00 UTC.
        with patch.object(cb, "_utc_now", return_value=datetime(2026, 11, 1, tzinfo=timezone.utc)):
            self.payload = _post(cb.preview_cashbook_statement, STATEMENT.read_bytes(), STATEMENT.name)

    def test_each_pair_is_listed_refund_first(self):
        self.assertEqual(
            [(p["refund"]["transfer_id"], p["spend"]["transfer_id"], p["spend"]["row_kind"]) for p in self.payload["pairs"]],
            [("REF-" + COLLECT_FULL, COLLECT_FULL, "Collect Payment"), ("REF-" + ADJUSTED_SPEND, ADJUSTED_SPEND, "Wallet Spend")],
        )

    def test_the_lines_that_stay_open_are_listed_with_their_credit(self):
        self.assertEqual(
            [(line["transfer_id"], line["amount"]) for line in self.payload["open_lines"]],
            [("REF-" + PART_SPEND, 11248.0), (WALLET_CREDIT, 9000.0), (EARLIER_REFUND, 640.0)],
        )
        # Every open line: these 3, and the 2 unpaired Collect payments Review lists under `collect_payments` (#1595).
        self.assertEqual(self.payload["opening"], 5)

    def test_a_pairs_lines_are_not_listed_again_as_not_importing(self):
        skipped = {line["transfer_id"] for line in self.payload["skipped"]}
        self.assertFalse(skipped & {COLLECT_FULL, "REF-" + COLLECT_FULL, ADJUSTED_SPEND, "REF-" + ADJUSTED_SPEND})
