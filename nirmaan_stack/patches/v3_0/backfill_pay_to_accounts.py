# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Fill the pay-to account on records raised before it existed (#1441, spec #1420, ADR-0033).

WHY THIS PATCH EXISTS
    Every PO / Work Order payment, Expense Request and Expense now holds its own pay-to account
    (`services/payees/pay_to.PAY_TO_FIELDS`), copied when it is raised (#1436, #1437). Records raised
    before that have none. This patch fills what can be known and guesses nothing.

WHAT IT FILLS (blank copies only: a record whose account number is set is never read or written)
    1. From the vendor's Payee, every UNPAID record that names a vendor: a `Project Payments` row or
       a `Project Expenses` row not at Reconciliation Pending / Paid (`rules.PAID_STATUSES`), and an
       open `Expense Request` (Pending Approval). The copy is `pay_to.copy_vendor_account`'s, the same
       one the save hooks make. A vendor with no Payee leaves its records blank.
    2. From the bank line, every PAID `Project Payments`, `Project Expenses` and `Non Project
       Expenses` row that a Bulk Import line settled (a `Settled` `Outflow Row Match`): the line's
       account number, IFSC and beneficiary name (`Outflow Import Row.bank_account` / `ifsc` /
       `beneficiary_name`). Only lines that hold an account number count; when several settled one
       record, the latest (`added_on`, then the match's `matched_at`) wins. Bank and branch stay
       blank: the patch asks no outside IFSC service.
    3. Everything else stays blank: a paid record with no settled line (paid by hand, or by a line
       with no account), a Non Project Expense not yet paid, an Expense Request already decided.
       A paid record is never filled from its vendor: that would guess where the money went.

THE LOG
    How many records of each doctype were filled from a vendor's Payee, how many from a bank line,
    and how many stay blank.

IDEMPOTENT
    Every write is guarded by "the account number is blank", so a second run writes nothing.

HOOKS
    The writes are raw UPDATEs that skip `doc_events` and leave `modified` alone. That is correct: the
    only hooks that touch a pay-to account (`pay_to.fill_from_vendor`, `pay_to.fill_payment_from_vendor`)
    fill it, and step 1 makes that same copy; step 2 is a copy no hook makes (a paid record is never
    re-copied). No hook derives anything from the pay-to fields, and no money figure moves. No Version
    row is written either, so "who set the account" reads the raiser, else "from the vendor".

The `patches.txt` line sits under [post_model_sync], after `move_vendor_bank_details_to_payees`, which
links the vendors to their Payees first.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.ledgers import LEDGER_DOCTYPES
from nirmaan_stack.services.payees.pay_to import PAY_TO_FIELDS, copy_vendor_account
from nirmaan_stack.services.payees.rules import PAID_STATUSES, parse_details

PATCH = "backfill_pay_to_accounts"

#: Unpaid records that name a vendor, by doctype: the statuses that make one "unpaid" or "open".
#: `(statuses, True)` means "status IN statuses"; `(statuses, False)` means "status NOT IN statuses".
VENDOR_COPY_SCOPES = {
    "Project Payments": (PAID_STATUSES, False),
    "Project Expenses": (PAID_STATUSES, False),
    "Expense Request": (("Pending Approval",), True),
}
#: Every doctype that holds a pay-to account, in the log's order.
PAY_TO_DOCTYPES = ("Project Payments", "Project Expenses", "Non Project Expenses", "Expense Request")


def execute():
    missing = [d for d in PAY_TO_DOCTYPES if not frappe.db.has_column(d, "pay_to_account_number")]
    if missing:
        print(f"{PATCH}: no pay-to account on {', '.join(missing)}, skipping")
        return
    result = backfill_pay_to_accounts()
    frappe.db.commit()
    for line in summary(result):
        print(f"{PATCH}: {line}")
        frappe.logger("payees").info(f"{PATCH}: {line}")


def backfill_pay_to_accounts(records: list[str] | None = None) -> dict:
    """Fill blank pay-to accounts (see the module docstring), or only on `records` (names), which is
    what the tests pass so they never touch a record they did not plant. Commits nothing.

    Returns `{from_vendor: {doctype: n}, from_bank_line: {doctype: n}, blank: {doctype: n}}`."""
    result = {key: dict.fromkeys(PAY_TO_DOCTYPES, 0) for key in ("from_vendor", "from_bank_line", "blank")}
    if records is not None and not records:
        return result
    for doctype, (statuses, inside) in VENDOR_COPY_SCOPES.items():
        result["from_vendor"][doctype] = _copy_from_vendors(doctype, statuses, inside, records)
    for doctype in LEDGER_DOCTYPES:
        result["from_bank_line"][doctype] = _copy_from_bank_lines(doctype, records)
    for doctype in PAY_TO_DOCTYPES:
        result["blank"][doctype] = frappe.db.sql(
            f"""SELECT COUNT(*) FROM "tab{doctype}" x WHERE {_blank()} {_scope("x.name", records)}""",
            {"records": tuple(records or ())},
        )[0][0]
    return result


def summary(result: dict) -> list[str]:
    """What the patch logs: one line per doctype."""
    return [
        f"{doctype}: {result['from_vendor'][doctype]} from the vendor's Payee, "
        f"{result['from_bank_line'][doctype]} from a bank line, {result['blank'][doctype]} left blank"
        for doctype in PAY_TO_DOCTYPES
    ]


def _blank(alias: str = "x") -> str:
    return f"COALESCE({alias}.pay_to_account_number, '') = ''"


def _scope(column: str, records: list[str] | None) -> str:
    return f"AND {column} IN %(records)s" if records is not None else ""


def _copy_from_vendors(doctype: str, statuses: tuple, inside: bool, records: list[str] | None) -> int:
    """Copy each vendor's Payee onto its blank records of `doctype` in scope. Returns how many."""
    status = f"COALESCE(x.status, '') {'IN' if inside else 'NOT IN'} %(statuses)s"
    where = f"""COALESCE(x.vendor, '') <> '' AND {status} AND {_blank()} {_scope("x.name", records)}"""
    params = {"statuses": tuple(statuses), "records": tuple(records or ())}
    vendors = frappe.db.sql_list(f'SELECT DISTINCT x.vendor FROM "tab{doctype}" x WHERE {where} ORDER BY 1', params)
    written = 0
    for vendor in vendors:
        copy = frappe.new_doc(doctype)
        copy.vendor = vendor
        copy_vendor_account(copy)
        if not copy.get("pay_to_account_number"):
            continue
        assignments = ", ".join(f"{field} = %({field})s" for field in PAY_TO_FIELDS)
        # Raw, guarded by the blank copy: see HOOKS in the module docstring.
        written += len(frappe.db.sql(
            f"""UPDATE "tab{doctype}" x SET {assignments}
                WHERE x.vendor = %(vendor)s AND {where}
                RETURNING x.name""",
            {**params, "vendor": vendor, **{field: copy.get(field) for field in PAY_TO_FIELDS}},
        ))
    return written


def _copy_from_bank_lines(doctype: str, records: list[str] | None) -> int:
    """Copy onto each blank paid record of `doctype` in scope the account of the latest settled bank
    line that holds an account number. Returns how many."""
    params = {
        "doctype": doctype, "settled": MATCH_SETTLED, "paid": tuple(PAID_STATUSES),
        "records": tuple(records or ()),
    }
    lines = frappe.db.sql(
        f"""SELECT DISTINCT ON (x.name) x.name, r.beneficiary_name, r.bank_account, r.ifsc
            FROM "tab{doctype}" x
            JOIN "tabOutflow Row Match" m
              ON m.target_doctype = %(doctype)s AND m.target_name = x.name AND m.match_kind = %(settled)s
            JOIN "tabOutflow Import Row" r ON r.name = m.import_row
            WHERE x.status IN %(paid)s AND {_blank()} AND COALESCE(TRIM(r.bank_account), '') <> ''
              {_scope("x.name", records)}
            ORDER BY x.name, r.added_on DESC NULLS LAST, m.matched_at DESC NULLS LAST, m.name DESC""",
        params,
        as_dict=True,
    )
    written = 0
    for line in lines:
        details = parse_details(line.beneficiary_name, line.bank_account, line.ifsc)
        if not details.account_number:  # separators only
            continue
        # Raw, guarded by the blank copy: see HOOKS in the module docstring.
        written += len(frappe.db.sql(
            f"""UPDATE "tab{doctype}" x
                SET pay_to_account_name = %(name)s, pay_to_account_number = %(number)s, pay_to_ifsc = %(ifsc)s
                WHERE x.name = %(record)s AND {_blank()}
                RETURNING x.name""",
            {
                "record": line.name, "name": details.account_name or None,
                "number": details.account_number, "ifsc": details.ifsc or None,
            },
        ))
    return written
