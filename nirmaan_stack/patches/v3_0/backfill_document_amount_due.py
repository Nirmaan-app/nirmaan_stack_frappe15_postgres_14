# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Seed `amount_due` on every Procurement Order / Service Request.

The field is maintained going forward by the three places that write its operands
(`api/invoices/_item_billing_sync.recompute_document_amount_due` is called from the
invoice recompute, from Project Payments' `update_parent_amount_paid`, and from the
Service Requests controller). Those only fire when something moves, so history would
sit at the column default of 0.

THE TWO DOCTYPES USE DIFFERENT FORMULAS, deliberately (owner decision):

    Procurement Orders   amount_due = amount_invoiced - amount_paid
    Service Requests     amount_due = total_amount    - amount_paid

The SR screens have always shown ordered-minus-paid and print it in their own footnote
("Amount Due = Total WO Value - Amt Paid"). Do not unify them here.

ONE UPDATE per doctype, not a row loop. IDEMPOTENT — it derives from the current
operand values and its IS DISTINCT FROM guard skips rows already correct, so a
re-run writes nothing. Safe to re-run any time the values are suspected stale.
"""

import frappe

# doctype -> (minuend, subtrahend). Mirrors _AMOUNT_DUE_OPERANDS in
# api/invoices/_item_billing_sync.py — keep the two in step.
_OPERANDS = {
    "Procurement Orders": ("amount_invoiced", "amount_paid"),
    "Service Requests": ("total_amount", "amount_paid"),
}


def execute():
    for doctype, (minuend, subtrahend) in _OPERANDS.items():
        table = f"tab{doctype}"

        # COALESCE on both operands: a NULL on either side would otherwise make the
        # whole difference NULL, which is not the same statement as "nothing is due".
        frappe.db.sql(
            f"""
            UPDATE "{table}"
               SET amount_due = COALESCE("{minuend}", 0) - COALESCE("{subtrahend}", 0)
             WHERE COALESCE(amount_due, 0)
                   IS DISTINCT FROM COALESCE("{minuend}", 0) - COALESCE("{subtrahend}", 0)
            """
        )
        nonzero = frappe.db.sql(
            f"""SELECT COUNT(*) FROM "{table}" WHERE COALESCE(amount_due, 0) <> 0"""
        )[0][0]
        print(f"  {doctype}: amount_due = {minuend} - {subtrahend} | {nonzero} non-zero rows")

    frappe.db.commit()
