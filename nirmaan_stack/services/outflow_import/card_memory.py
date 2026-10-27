# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Merchant memory: the expense type a person last confirmed for a card merchant (#1569, ADR-0039 ruling 5).

One `Card Merchant Memory` record per merchant key (`card_statement.merchant_key`, the record's name): its
type, who confirmed it last and when. The type suggestion reads it first (`recall`); it is written when Create
records a spend (`card_create._create_one`) and when a card Expense's type is edited
(`integrations/controllers/card_merchant_memory`). The latest confirmation wins.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.card_statement import merchant_key

MEMORY_DOCTYPE = "Card Merchant Memory"


def recall(merchants) -> dict[str, str]:
    """`{merchant: type}` for each of `merchants` the memory holds. The caller asks whether the type is
    still live (`card_types.choose_type`)."""
    merchants = list(merchants)
    if not merchants:
        return {}
    rows = frappe.get_all(MEMORY_DOCTYPE, filters={"name": ["in", merchants]}, fields=["name", "expense_type"])
    return {row.name: row.expense_type for row in rows}


def remember(merchant: str, expense_type: str, user: str) -> None:
    """Record `expense_type` as the merchant's type, confirmed now by `user`. No commit: the caller's
    transaction holds it (Create commits per spend; an Expense save commits with the request)."""
    if not merchant or not expense_type:
        return
    values = {"expense_type": expense_type, "confirmed_by": user, "confirmed_at": frappe.utils.now_datetime()}
    if not frappe.db.exists(MEMORY_DOCTYPE, merchant):
        savepoint = "card_merchant_memory"
        frappe.db.savepoint(savepoint)
        try:
            frappe.get_doc({"doctype": MEMORY_DOCTYPE, "merchant": merchant, **values}).insert(
                ignore_permissions=True
            )
            return
        except frappe.DuplicateEntryError:
            # Another Create inserted it first: update theirs below.
            frappe.db.rollback(save_point=savepoint)
    doc = frappe.get_doc(MEMORY_DOCTYPE, merchant, for_update=True)
    doc.update(values)
    doc.save(ignore_permissions=True)


def merchant_of_expense(expense: str) -> str | None:
    """The merchant key of the card line a Non Project Expense was created from; None for any other
    Expense. Read through its Settled match record, the one link from an Expense back to its line."""
    remarks = frappe.db.sql(
        """
        SELECT r.remarks FROM "tabOutflow Row Match" m
        JOIN "tabOutflow Import Row" r ON r.name = m.import_row
        WHERE m.target_doctype = 'Non Project Expenses' AND m.target_name = %s AND m.match_kind = %s
        LIMIT 1
        """,
        (expense, MATCH_SETTLED),
        pluck=True,
    )
    return merchant_key(remarks[0]) if remarks else None
