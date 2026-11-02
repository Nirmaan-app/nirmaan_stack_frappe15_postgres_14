# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The writes and gates every expense sub-tab of Pending Invoices Upload shares (ADR-0010 B4).

Credit Card (`api/expenses/card_invoices.py`, spec #1565, #1570) and Cashbook (`api/expenses/cashbook_invoices.py`,
spec #1585, #1592) both file an invoice on an expense, or mark it *No invoice*, through the two writes below. Each
caller reads the expense `FOR UPDATE` and hands over its facts; the refusals are the pure rules in
`services/card_invoices.py`. Both writes save through the document layer (its `doc_events` run, and `track_changes`
keeps a Version) and commit.
"""

import frappe
from frappe.utils import now_datetime, nowdate

from nirmaan_stack.services.card_invoices import attach_problem, no_invoice_problem
from nirmaan_stack.services.role_profiles import PENDING_INVOICE_UPLOAD_PROFILES, has_role_profile


def require_profile(profiles, sentence: str) -> str:
    """The session user, or a PermissionError with `sentence` when they hold none of `profiles`."""
    user = frappe.session.user
    if not has_role_profile(user, profiles):
        frappe.throw(sentence, frappe.PermissionError, title="Not permitted")
    return user


def require_upload_access() -> str:
    """The Pending Invoices Upload gate: the list and attach of every sub-tab that queues expenses."""
    return require_profile(PENDING_INVOICE_UPLOAD_PROFILES, "You do not have permission to view pending invoice uploads.")


def save_invoice(doc, facts, invoice_attachment: str, invoice_ref: str | None, invoice_date: str | None) -> dict:
    """File the invoice on `doc` (read `FOR UPDATE`, `facts` read from it), refused by `attach_problem`; commits."""
    problem = attach_problem(facts, invoice_attachment, invoice_date or None, today=nowdate())
    if problem:
        frappe.throw(problem)
    doc.invoice_attachment = invoice_attachment.strip()
    doc.invoice_ref = (invoice_ref or "").strip() or None
    doc.invoice_date = invoice_date or None
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"name": doc.name}


def save_no_invoice(doc, facts, reason: str | None, user: str) -> dict:
    """Mark `doc` (read `FOR UPDATE`) *No invoice* by `user`, refused by `no_invoice_problem`; commits."""
    problem = no_invoice_problem(facts, reason)
    if problem:
        frappe.throw(problem)
    doc.no_invoice_reason = reason.strip()
    doc.no_invoice_by = user
    doc.no_invoice_at = now_datetime()
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"name": doc.name}
