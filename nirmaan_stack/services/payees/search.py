# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Find a Payee to pick (spec #1420 tickets #1429, #1434, ADR-0033). Read-only.

`find_payees` backs every Payee picker (the Expense Request's, Record Payment's Change payee):
Payees whose holder name or account number matches, by holder name. An account number is compared in
its identity form (spaces, dashes and leading zeros ignored), as everywhere else in the Payee module.
A Payee has no status and nothing paid points at it, so every Payee is offered and none is ranked by
how often it was paid.
"""

from __future__ import annotations

import re

import frappe

from nirmaan_stack.services.outflow_import.normalize import normalize_account

_LIKE_SPECIALS = re.compile(r"([\\%_])")

#: Shortest text worth searching: one letter matches half the Payees.
MIN_SEARCH_LENGTH = 2

_SEARCH_SQL = """
    SELECT p.name, p.account_name, p.account_number, p.ifsc, p.bank_name, p.bank_branch, p.payee_type
    FROM "tabPayee" p
    WHERE ({match}){types}
    ORDER BY p.account_name ASC, p.name ASC
    LIMIT %(limit)s
"""


def _like(text: str) -> str:
    return "%" + _LIKE_SPECIALS.sub(r"\\\1", text) + "%"


def find_payees(text: str | None, limit: int = 8, exclude_type: str | None = None) -> list[dict]:
    """Payees whose holder name contains `text`, or whose account number contains it (in identity
    form), by holder name: `[{name, account_name, account_number, ifsc, bank_name, bank_branch, payee_type}]`.
    Text shorter than `MIN_SEARCH_LENGTH` finds nothing. `exclude_type` leaves out Payees of that
    `payee_type` (a Payee with no type is kept)."""
    text = " ".join(str(text or "").split())
    if len(text) < MIN_SEARCH_LENGTH:
        return []
    params = {"limit": max(1, min(int(limit or 8), 25)), "name": _like(text)}
    match = ["p.account_name ILIKE %(name)s"]
    account = normalize_account(text)
    if account and account != "0" and re.fullmatch(r"[0-9A-Za-z]+", account):
        params["account"] = _like(account.upper())
        match.append("p.normalized_account LIKE %(account)s")
    types = ""
    if exclude_type:
        params["exclude_type"] = exclude_type
        types = " AND COALESCE(p.payee_type, '') <> %(exclude_type)s"
    return frappe.db.sql(_SEARCH_SQL.format(match=" OR ".join(match), types=types), params, as_dict=True)
