# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Candidate retrieval for the outflow matcher (Bulk Import Outflow, slice S2).

THE ONLY MODULE IN THIS PACKAGE THAT TOUCHES THE DATABASE, and it READS ONLY. It exists so that
`matcher.py` can stay pure: this file turns rows into the plain value objects the matcher consumes,
and the matcher never learns where they came from. Nothing here may write, and nothing here may
import from `api/` -- api -> service is the one legal direction.

WHY THE LOOKUPS ARE SHAPED THIS WAY

Pass A cannot be a Python-side scan. The strong key is a NORMALISED reference comparison, and 226
live `Project Payments.utr` values are whitespace-padded, so `utr = %s` misses them. The comparison
is therefore pushed into SQL as `upper(btrim(utr))`, which matches exactly what
`normalize_reference` computes on the other side. Loading all 7,421 Paid payments to filter in
Python would work but would scale with the ledger rather than with the batch.

Pass A ALSO DELIBERATELY IGNORES STATUS. It must return a payment whatever state it is in, because
finding a bank transfer against a payment that is NOT Paid is one of the outcomes this feature
exists to report -- money that left the bank before its approval completed. Filtering to Paid here
would silently convert that finding into "no record found", which is the opposite of the truth.

⚠️ POSTGRES: table names are double-quoted, and Frappe converts a list parameter to a tuple, so an
`IN` clause is built with explicit placeholders rather than `= ANY(%s)` (which fails with
"op ANY/ALL (array) requires array on right side").
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Sequence

import frappe

from nirmaan_stack.services.outflow_import.matcher import TargetRef, VendorIndex, VendorRef, build_vendor_index
from nirmaan_stack.services.outflow_import.normalize import normalize_amount, normalize_reference

__all__ = [
    "load_vendor_index",
    "load_payments_by_reference",
    "load_payments_for_vendors",
    "load_expense_targets",
    "find_earlier_batches_for_transfers",
    "PAYMENT_DOCTYPE",
    "PROJECT_EXPENSE_DOCTYPE",
    "NON_PROJECT_EXPENSE_DOCTYPE",
]

PAYMENT_DOCTYPE = "Project Payments"
PROJECT_EXPENSE_DOCTYPE = "Project Expenses"
NON_PROJECT_EXPENSE_DOCTYPE = "Non Project Expenses"

# Expenses that are still waiting for money. Non-project expenses are included at `Requested` too:
# unlike the project side they have no separate approval step in practice, and a settleable pool of
# `Approved` only would be empty.
_SETTLEABLE_PROJECT_EXPENSE_STATUSES = ("Approved",)
_SETTLEABLE_NON_PROJECT_EXPENSE_STATUSES = ("Approved", "Requested")


def load_vendor_index() -> VendorIndex:
    """Build the vendor index once per batch. ~1,077 rows; normalising per row would be 50x this."""
    rows = frappe.db.sql(
        """
        SELECT name, vendor_name, account_name, account_number, ifsc
        FROM "tabVendors"
        """,
        as_dict=True,
    )
    return build_vendor_index(
        [
            VendorRef(
                name=r["name"],
                vendor_name=r.get("vendor_name") or "",
                account_name=r.get("account_name") or "",
                account_number=r.get("account_number") or "",
                ifsc=r.get("ifsc") or "",
            )
            for r in rows
        ]
    )


def load_payments_by_reference(references: Sequence[str]) -> tuple[TargetRef, ...]:
    """Pass A: payments whose normalised UTR equals one of these normalised bank references.

    Returns payments in EVERY status on purpose -- see the module docstring.
    """
    wanted = sorted({normalize_reference(r) for r in references if normalize_reference(r)})
    if not wanted:
        return ()

    placeholders = ", ".join(["%s"] * len(wanted))
    rows = frappe.db.sql(
        f"""
        SELECT name, amount, status, vendor, utr, payment_date, project, document_type, document_name
        FROM "tabProject Payments"
        WHERE utr IS NOT NULL AND utr <> ''
          AND upper(btrim(utr)) IN ({placeholders})
        """,
        tuple(wanted),
        as_dict=True,
    )
    return tuple(_payment_target(r) for r in rows)


def load_payments_for_vendors(
    vendor_names: Sequence[str],
    amounts: Sequence[Decimal],
    period_from: date | None,
    period_to: date | None,
    window_days: int = 3,
) -> tuple[TargetRef, ...]:
    """Pass B: payments for these vendors, at these exact amounts, near this period.

    Scoped by all three axes because the fallback pass has no strong key -- widening any one of them
    turns a suggestion list into a haystack.
    """
    vendors = sorted({v for v in vendor_names if v})
    values = sorted({normalize_amount(a) for a in amounts})
    if not vendors or not values:
        return ()

    vendor_ph = ", ".join(["%s"] * len(vendors))
    amount_ph = ", ".join(["%s"] * len(values))
    params: list = [*vendors, *[float(v) for v in values]]

    date_clause = ""
    if period_from and period_to:
        date_clause = " AND (payment_date IS NULL OR payment_date BETWEEN %s AND %s)"
        params.extend([period_from - timedelta(days=window_days), period_to + timedelta(days=window_days)])

    rows = frappe.db.sql(
        f"""
        SELECT name, amount, status, vendor, utr, payment_date, project, document_type, document_name
        FROM "tabProject Payments"
        WHERE vendor IN ({vendor_ph})
          AND amount IN ({amount_ph})
          {date_clause}
        """,
        tuple(params),
        as_dict=True,
    )
    return tuple(_payment_target(r) for r in rows)


def load_expense_targets(amounts: Sequence[Decimal]) -> tuple[TargetRef, ...]:
    """Expenses still awaiting payment, at these exact amounts, from BOTH expense doctypes.

    ⚠️ The two doctypes disagree about storage and the query has to as well:
    `Project Expenses.amount` is a Data field -- PG `varchar(140)` holding bare numeric strings like
    '2935' -- while `Non Project Expenses.amount` is a real `Currency` column. The project side is
    therefore cast, not compared as text; a text compare would miss '2935.0' against 2935.
    """
    values = sorted({normalize_amount(a) for a in amounts})
    if not values:
        return ()
    amount_ph = ", ".join(["%s"] * len(values))
    floats = [float(v) for v in values]

    out: list[TargetRef] = []

    project_ph = ", ".join(["%s"] * len(_SETTLEABLE_PROJECT_EXPENSE_STATUSES))
    project_rows = frappe.db.sql(
        f"""
        SELECT name, amount, status, projects, description, payment_ref, payment_date, type, vendor
        FROM "tabProject Expenses"
        WHERE status IN ({project_ph})
          AND amount IS NOT NULL AND btrim(amount) <> ''
          AND CAST(NULLIF(btrim(amount), '') AS numeric) IN ({amount_ph})
        """,
        (*_SETTLEABLE_PROJECT_EXPENSE_STATUSES, *floats),
        as_dict=True,
    )
    for r in project_rows:
        out.append(
            TargetRef(
                doctype=PROJECT_EXPENSE_DOCTYPE,
                name=r["name"],
                amount=normalize_amount(r.get("amount")),
                status=r.get("status") or "",
                vendor=r.get("vendor") or None,
                reference=r.get("payment_ref") or "",
                txn_date=r.get("payment_date"),
                project=r.get("projects") or None,
                description=r.get("description") or "",
            )
        )

    non_project_ph = ", ".join(["%s"] * len(_SETTLEABLE_NON_PROJECT_EXPENSE_STATUSES))
    non_project_rows = frappe.db.sql(
        f"""
        SELECT name, amount, status, description, payment_ref, payment_date, type
        FROM "tabNon Project Expenses"
        WHERE status IN ({non_project_ph})
          AND amount IN ({amount_ph})
        """,
        (*_SETTLEABLE_NON_PROJECT_EXPENSE_STATUSES, *floats),
        as_dict=True,
    )
    for r in non_project_rows:
        out.append(
            TargetRef(
                doctype=NON_PROJECT_EXPENSE_DOCTYPE,
                name=r["name"],
                amount=normalize_amount(r.get("amount")),
                status=r.get("status") or "",
                vendor=None,
                reference=r.get("payment_ref") or "",
                txn_date=r.get("payment_date"),
                project=None,
                description=r.get("description") or "",
            )
        )

    return tuple(out)


def find_earlier_batches_for_transfers(
    transfer_ids: Sequence[str],
    exclude_batch: str | None = None,
) -> dict[str, str]:
    """Map transfer_id -> the earliest OTHER batch that already staged it.

    This is the precise duplicate guard. The batch-level Added-On overlap only warns; two exports
    can carry the same transfer without their periods overlapping at all, and can carry different
    transfers with periods that do.
    """
    wanted = sorted({t for t in transfer_ids if t})
    if not wanted:
        return {}

    placeholders = ", ".join(["%s"] * len(wanted))
    params: list = list(wanted)
    exclude_clause = ""
    if exclude_batch:
        exclude_clause = " AND import_batch <> %s"
        params.append(exclude_batch)

    rows = frappe.db.sql(
        f"""
        SELECT transfer_id, import_batch, creation
        FROM "tabOutflow Import Row"
        WHERE transfer_id IN ({placeholders})
          {exclude_clause}
        ORDER BY creation ASC
        """,
        tuple(params),
        as_dict=True,
    )
    seen: dict[str, str] = {}
    for r in rows:
        seen.setdefault(r["transfer_id"], r["import_batch"])
    return seen


def _payment_target(row: dict) -> TargetRef:
    return TargetRef(
        doctype=PAYMENT_DOCTYPE,
        name=row["name"],
        amount=normalize_amount(row.get("amount")),
        status=row.get("status") or "",
        vendor=row.get("vendor") or None,
        reference=row.get("utr") or "",
        txn_date=row.get("payment_date"),
        project=row.get("project") or None,
        description="",
    )
