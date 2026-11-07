# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Credit Card sub-tab of Vendor Invoice Recon -> Pending Invoices Upload (spec #1565, #1570, ADR-0039 ruling 8).

URLs: /api/method/nirmaan_stack.api.expenses.card_invoices.<get_card_invoice_queue | attach_card_invoice |
mark_card_no_invoice>

A card spend (a `Non Project Expenses` row with `credit_card_statement` set) waits here until its invoice file is
attached or it is marked *No invoice*. Gates: the list and attach follow the Pending Invoices Upload tab
(`role_profiles.PENDING_INVOICE_UPLOAD_PROFILES`); No invoice is Admin and Accountant Lead
(`CARD_NO_INVOICE_PROFILES`). The rules are `services/card_invoices.py`. Both writes re-read the expense
`FOR UPDATE` and save through the document layer (its `doc_events` run, and `track_changes` keeps a Version).
The gates and the two writes (`require_profile`, `save_invoice`, `save_no_invoice`) are shared with the Cashbook
sub-tab (`cashbook_invoices.py`, #1592) and live in `services/expense_invoices.py`.
"""

import frappe

from nirmaan_stack.services.card_invoices import CardExpenseFacts, card_line_details, statement_months
from nirmaan_stack.services.expense_bills.approval import last_rejection_sql
from nirmaan_stack.services.expense_invoices import (
    require_profile,
    require_upload_access,
    save_invoice,
    save_no_invoice,
)
from nirmaan_stack.services.outflow_import.card_statement import merchant_key
from nirmaan_stack.services.role_profiles import CARD_NO_INVOICE_PROFILES

EXPENSE_DOCTYPE = "Non Project Expenses"


@frappe.whitelist()
def get_card_invoice_queue() -> list[dict]:
    """Every card spend still waiting for its invoice: no invoice file, not marked No invoice. Newest first.

    Each row: `name`, `payment_date`, `amount`, `expense_type`, `details` (the statement line), `merchant` (its
    merchant key), `holder`, `credit_card_statement`, `statement_date`, `period_from`, `period_to` and
    `last_bill_rejected` (the reason its latest Expense bill was rejected, else None) and `statement_months` (every "YYYY-MM" its period overlaps, GLOSSARY *Statement month*; a statement always
    has both period dates, the doctype requires them). The screen filters by holder and statement month itself: the list is one or two statements' worth of spends.
    """
    require_upload_access()
    rows = frappe.db.sql(
        """
        SELECT e.name, e.payment_date, e.amount, e.type AS expense_type, e.payment_ref,
               e.credit_card_statement, s.holder, s.statement_date, s.period_from, s.period_to,
               {last_bill_rejected} AS last_bill_rejected
        FROM "tabNon Project Expenses" e
        JOIN "tabCredit Card Statement" s ON s.name = e.credit_card_statement
        WHERE COALESCE(e.invoice_attachment, '') = ''
          AND COALESCE(e.no_invoice_by, '') = ''
        ORDER BY e.payment_date DESC, e.name DESC
        """.format(last_bill_rejected=last_rejection_sql("e", f"'{EXPENSE_DOCTYPE}'")),
        as_dict=True,
    )
    for row in rows:
        row["details"] = card_line_details(row.pop("payment_ref"))
        row["merchant"] = merchant_key(row["details"]) if row["details"] else ""
        row["statement_months"] = statement_months(row["period_from"], row["period_to"])
    return rows


def _locked_facts(expense: str):
    doc = frappe.get_doc(EXPENSE_DOCTYPE, expense, for_update=True)
    facts = CardExpenseFacts(
        name=doc.name,
        is_card=bool(doc.credit_card_statement),
        invoice_attachment=doc.invoice_attachment,
        no_invoice_by=doc.no_invoice_by,
    )
    return doc, facts


@frappe.whitelist(methods=["POST"])
def attach_card_invoice(
    expense: str, invoice_attachment: str, invoice_ref: str | None = None, invoice_date: str | None = None
) -> dict:
    """File `invoice_attachment` (a File URL already uploaded against the expense) as card spend `expense`'s
    invoice; `invoice_ref` and `invoice_date` are optional (a food receipt may have neither). The spend then
    leaves the list. Refused: no file, a future date, not a card spend, already invoiced or marked No invoice.

    Example: `{"expense": "NPE-0042", "invoice_attachment": "/private/files/zomato.pdf"}` -> `{"name": "NPE-0042"}`.
    """
    user = require_upload_access()
    doc, facts = _locked_facts(expense)
    return save_invoice(doc, facts, invoice_attachment, invoice_ref, invoice_date, user)


@frappe.whitelist(methods=["POST"])
def mark_card_no_invoice(expense: str, reason: str) -> dict:
    """Mark card spend `expense` *No invoice*: it will never have one, for the typed `reason`. Records who and
    when on the expense, which then leaves the list. Admin and Accountant Lead only.

    Example: `{"expense": "NPE-0042", "reason": "Toll booth, no receipt"}` -> `{"name": "NPE-0042"}`.
    """
    user = require_profile(CARD_NO_INVOICE_PROFILES, "Only an Admin or an Accountant Lead can mark a card spend No invoice.")
    doc, facts = _locked_facts(expense)
    return save_no_invoice(doc, facts, reason, user)
