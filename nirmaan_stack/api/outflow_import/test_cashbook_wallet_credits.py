# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Wallet Credit becomes a negative Expense, on a project when its remark names one (#1720, ADR-0015 Amendment E).
GLOSSARY: *Wallet credit expense*.

Seam 1: the Cashbook import (staging, the job run inline) on the real-file fixture (`cashbook_statement.xlsx`, its
Wallet Credit `PTM9000000006`, Rs 9,000 "site scrap amount"), with per-test Txn Ids. Then what reads the Expense: the
Cashbook invoice queue, Bill check's Cashbook pill, the approval queue's Tier, Unreconcile, a re-upload.
Seam 2: the patch `v3_0.create_open_wallet_credit_expenses`.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_wallet_credits
"""

import dataclasses

import frappe

from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue
from nirmaan_stack.api.expenses.cashbook_invoices import get_cashbook_invoice_queue
from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.test_cashbook_refund_expenses import EARLIER_SPEND, HOLDER, RefundExpenseCase
from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row
from nirmaan_stack.services.expense_bills.bill_rows import KINDS

CREDIT = "PTM9000000006"


class WalletCreditCase(RefundExpenseCase):
    def _remark(self, txn: str, remarks: str, payer: str = "") -> None:
        """Give the fixture's line `txn` this remark and From before it is staged."""
        self.parsed = dataclasses.replace(
            self.parsed,
            rows=[
                dataclasses.replace(r, remarks=remarks, added_by_raw=payer or r.added_by_raw)
                if r.transfer_id == self._id(txn)
                else r
                for r in self.parsed.rows
            ],
        )

    def _won_project(self):
        return frappe.db.get_value(
            "Projects",
            {"tendering_status": "Won", "status": ["!=", "CEO Hold"], "project_name": ["like", "%_ %"]},
            ["name", "project_name"],
            as_dict=True,
            order_by="creation asc",
        )


class TestTheJobBooksAWalletCredit(WalletCreditCase):
    def test_a_credit_whose_remark_names_no_project_is_a_paid_negative_non_project_expense(self):
        self._remark(CREDIT, "UPI", payer="Test Payer Staff")
        self._stage_and_run()
        credit = self._expense(CREDIT)
        self.assertEqual((credit.doctype, credit.type, credit.status), ("Non Project Expenses", "Petty Cash", "Paid"))
        self.assertEqual(float(credit.amount), -9000.0)
        self.assertEqual(credit.payment_ref, self._id(CREDIT))
        self.assertEqual(str(credit.payment_date), "2026-10-26")
        self.assertEqual(credit.cashbook_batch, self.batch)
        self.assertEqual(credit.description, "Wallet credit from Test Payer Staff")
        self.assertEqual(self._leg(CREDIT).target_amount, -9000.0)
        self.assertEqual(self._line(CREDIT).row_status, "Settled")

    def test_a_credit_whose_remark_names_one_project_is_a_negative_project_expense_on_it(self):
        project = self._won_project()
        self._remark(CREDIT, f"Scrap sold at {project.project_name} site")
        self._stage_and_run()
        credit = self._expense(CREDIT)
        self.assertEqual((credit.doctype, credit.projects, float(credit.amount)), ("Project Expenses", project.name, -9000.0))
        self.assertEqual(credit.status, "Paid")
        # Who spent it is the wallet holder, the line's To (`payment_by` is a Project Expenses field only).
        self.assertEqual(credit.payment_by, HOLDER)

    def test_an_unpaired_refund_whose_spend_has_no_expense_goes_on_the_project_its_remark_names(self):
        """Decision 3: one rule for both money-in kinds."""
        project = self._won_project()
        self._remark("REF-" + EARLIER_SPEND, f"Refund for {project.project_name} site")
        self._stage_and_run()
        refund = self._expense("REF-" + EARLIER_SPEND)
        self.assertEqual((refund.doctype, refund.projects, float(refund.amount)), ("Project Expenses", project.name, -640.0))


class TestWhatReadsTheCreditExpense(WalletCreditCase):
    def setUp(self):
        super().setUp()
        self._stage_and_run()
        self.credit = self._expense(CREDIT)

    def test_it_waits_for_no_bill(self):
        self.assertNotIn(self.credit.name, {row["name"] for row in get_cashbook_invoice_queue()})
        pill = frappe.db.sql(
            f"""SELECT e.name FROM "tab{self.credit.doctype}" e WHERE e.name = %s AND {KINDS["cashbook"].condition}""",
            (self.credit.name,),
        )
        self.assertFalse(pill)

    def test_it_reads_the_system_tier(self):
        rows = get_approval_queue(
            filters=[["name", "=", self.credit.name], ["status", "=", "Paid"]], limit_page_length=5
        )["data"]
        self.assertEqual([(r["name"], r["tier"]) for r in rows], [(self.credit.name, "system")])

    def test_unreconcile_deletes_the_expense_and_reopens_the_line(self):
        line = self._line(CREDIT).name
        unreconcile_row(row=line, legs="all", reason="Not money in from outside")
        self.assertFalse(frappe.db.exists(self.credit.doctype, self.credit.name))
        self.assertEqual(frappe.db.get_value("Outflow Import Row", line, "row_status"), "Mismatched")

    def test_a_re_upload_of_the_same_statement_creates_nothing_new(self):
        plan = cb._build_plan(self.parsed)
        self.assertNotIn(self._id(CREDIT), {row.transfer_id for row in plan.creating})

    def test_a_credit_already_booked_at_minus_its_credit_is_skipped_as_already_booked(self):
        """The repeat check with the negative amount: an Expense holding the Txn Id at minus its Credit, with no earlier
        import line (here: the first import's line is gone), is found."""
        frappe.db.delete("Outflow Import Row", {"import_batch": self.batch, "transfer_id": self._id(CREDIT)})
        frappe.db.commit()
        [credit] = [row for row in cb._build_plan(self.parsed).rows if row.transfer_id == self._id(CREDIT)]
        self.assertEqual((credit.action, credit.reason), ("skip", f"Already booked as Non Project Expenses {self.credit.name}"))
