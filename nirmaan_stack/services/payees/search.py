# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Find a Payee to pick (spec #1420 ticket #1429, ADR-0033). Read-only.

`search_active_payees` backs the Expense Request's payee picker: Active Payees only (an Inactive
one can't be newly picked), matched on the holder name or the account number, each with how many
times it has been paid. An account number is compared in its identity form (spaces, dashes and
leading zeros ignored), as everywhere else in the Payee module.
"""

from __future__ import annotations

import re

import frappe

from nirmaan_stack.services.outflow_import.normalize import normalize_account
from nirmaan_stack.services.payees.links import PAID_ROWS_SQL
from nirmaan_stack.services.payees.rules import ACTIVE

_LIKE_SPECIALS = re.compile(r"([\\%_])")

#: Shortest text worth searching: one letter matches half the Payees.
MIN_SEARCH_LENGTH = 2

#: Times paid = how many payments have paid the Payee (`links.PAID_ROWS_SQL`): the same meaning as
#: `links.is_paid` and "last paid".
_SEARCH_SQL = f"""
    SELECT p.name, p.account_name, p.account_number, p.ifsc, p.bank_name, p.bank_branch, p.status,
           (SELECT COUNT(*) FROM ({PAID_ROWS_SQL}) paid WHERE paid.payee = p.name) AS times_paid
    FROM "tabPayee" p
    WHERE p.status = %(active)s AND ({{match}})
    ORDER BY times_paid DESC, p.account_name ASC
    LIMIT %(limit)s
"""


def _like(text: str) -> str:
    return "%" + _LIKE_SPECIALS.sub(r"\\\1", text) + "%"


def search_active_payees(text: str | None, limit: int = 8) -> list[dict]:
    """Active Payees whose holder name contains `text`, or whose account number contains it (in
    identity form), most-paid first: `[{name, account_name, account_number, ifsc, bank_name,
    bank_branch, status, times_paid}]`. Text shorter than `MIN_SEARCH_LENGTH` finds nothing."""
    text = " ".join(str(text or "").split())
    if len(text) < MIN_SEARCH_LENGTH:
        return []
    params = {"active": ACTIVE, "limit": max(1, min(int(limit or 8), 25)), "name": _like(text)}
    match = ["p.account_name ILIKE %(name)s"]
    account = normalize_account(text)
    if account and account != "0" and re.fullmatch(r"[0-9A-Za-z]+", account):
        params["account"] = _like(account.upper())
        match.append("p.normalized_account LIKE %(account)s")
    rows = frappe.db.sql(_SEARCH_SQL.format(match=" OR ".join(match)), params, as_dict=True)
    return [{**row, "times_paid": int(row.times_paid or 0)} for row in rows]
