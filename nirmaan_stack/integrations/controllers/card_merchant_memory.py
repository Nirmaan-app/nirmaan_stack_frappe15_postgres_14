# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A card Expense's type, changed by an edit, becomes its merchant's remembered type (#1569, ADR-0039 ruling 5).

`Non Project Expenses` on_update. Exits at once unless the Expense is a card spend (`credit_card_statement`
set) whose saved type differs from the one before the save. The insert itself is not an edit: Create
remembers the type it writes (`card_create._create_one`).
"""

import frappe

from nirmaan_stack.services.outflow_import.card_memory import merchant_of_expense, remember


def on_expense_update(doc, method=None):
    if not doc.get("credit_card_statement"):
        return
    before = doc.get_doc_before_save()
    if before is None or before.get("type") == doc.get("type"):
        return
    merchant = merchant_of_expense(doc.name)
    if merchant:
        remember(merchant, doc.get("type"), frappe.session.user)
