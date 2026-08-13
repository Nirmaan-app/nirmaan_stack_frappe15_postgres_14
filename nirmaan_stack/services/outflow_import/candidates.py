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

⚠️ THE TWO REFERENCE QUERIES ARE SEPARATE ON PURPOSE, AND MUST STAY SEPARATE (owner, slice V1).
They look almost identical and they mean opposite things:

    load_payments_by_reference        -> APPROVED payments. These are SETTLE CANDIDATES. A row that
                                         matches one is offered to a reviewer to confirm.
    load_paid_payments_by_reference   -> PAID payments. These are a DUPLICATE GUARD. A row that
                                         matches one is SKIPPED, never offered.

Merging them into one status-agnostic query -- which is exactly what v2 did, deliberately, to
report money that left before approval completed -- would make an already-Paid payment look like a
settle candidate and let the same money be recorded twice. v3 removed the finding that justified
the merge (`Control exception` is retired; a `Requested` or `CEO Pending` payment is now simply
`Unmatched`, owner ruling), so nothing is lost by keeping them apart and a great deal is risked by
joining them.

WHAT ELSE CHANGED AT V1: every pool here is now `Approved` only, on all three ledgers, sourced from
`ledgers.SETTLEABLE_STATUSES` rather than from a local copy. `settle.py` reads the same map, so the
screen can never offer a record the write path would refuse, or the reverse.

⚠️ POSTGRES: table names are double-quoted, and Frappe converts a list parameter to a tuple, so an
`IN` clause is built with explicit placeholders rather than `= ANY(%s)` (which fails with
"op ANY/ALL (array) requires array on right side").
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Sequence

import frappe
from frappe.utils import getdate

from nirmaan_stack.services.outflow_import.amounts import tolerance_bounds
from nirmaan_stack.services.outflow_import.duplicates import (
    RowIdentity,
    dates_agree,
    row_identity,
)
from nirmaan_stack.services.outflow_import.ledgers import (
    NON_PROJECT_EXPENSE_DOCTYPE,
    PAID,
    PAYMENT_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
    decided_on_sql,
    settleable_statuses,
)
from nirmaan_stack.services.outflow_import.matcher import TargetRef, VendorIndex, VendorRef, build_vendor_index
from nirmaan_stack.services.outflow_import.normalize import normalize_amount, normalize_reference
from nirmaan_stack.services.outflow_import.project_match import ProjectIndex, build_project_index

__all__ = [
    "load_vendor_index",
    "load_project_index",
    "load_payments_by_reference",
    "load_paid_payments_by_reference",
    "load_payments_by_amount",
    "load_expense_targets",
    # ⚠️ RENAMED FROM `find_earlier_batches_for_transfers` AT SLICE D3. It takes ROWS now, because
    # duplicate identity is `(transfer_id, amount, date)` and a list of ids can no longer express
    # the question. The old name is deliberately not kept as an alias -- see the function.
    "find_earlier_batches_for_rows",
    "amount_window_sql",
    "PAYMENT_DOCTYPE",
    "PROJECT_EXPENSE_DOCTYPE",
    "NON_PROJECT_EXPENSE_DOCTYPE",
]

# Re-exported so existing callers keep importing the doctype names from here; `ledgers.py` owns
# them now. The settleable-status lists that used to sit beside them are GONE from this module --
# there is one map, in `ledgers.SETTLEABLE_STATUSES`, and both this file and `settle.py` read it.
_PAYMENT_STATUSES = settleable_statuses(PAYMENT_DOCTYPE)
_PROJECT_EXPENSE_STATUSES = settleable_statuses(PROJECT_EXPENSE_DOCTYPE)
_NON_PROJECT_EXPENSE_STATUSES = settleable_statuses(NON_PROJECT_EXPENSE_DOCTYPE)

# The M4 nearest-date input, selected under one alias on every ledger so the target builders read
# one key. The EXPRESSIONS live in `ledgers.DECIDED_ON_SQL` -- see the warning there about why this
# value may be matched on but must never be displayed as an approval.
_PAYMENT_DECIDED_ON = f"{decided_on_sql(PAYMENT_DOCTYPE)} AS decided_on"
_PROJECT_EXPENSE_DECIDED_ON = f"{decided_on_sql(PROJECT_EXPENSE_DOCTYPE)} AS decided_on"
_NON_PROJECT_EXPENSE_DECIDED_ON = f"{decided_on_sql(NON_PROJECT_EXPENSE_DOCTYPE)} AS decided_on"


def amount_window_sql(column: str, amounts: Sequence[Decimal]) -> tuple[str, list]:
    """A SQL predicate matching `column` against any of `amounts` WITHIN THE TOLERANCE.

    Replaces `column IN (...)`, which was exact and therefore matched almost nothing: 31.4% of
    payments carry paise while the bank sends whole rupees. The bounds come from
    `amounts.tolerance_bounds`, so the number lives in one place even though the comparison happens
    in the database and cannot call `amounts_match`.

    Returns `("(col BETWEEN %s AND %s OR col BETWEEN %s AND %s ...)", params)`. OR-ed BETWEENs
    rather than one wide `MIN(lows) .. MAX(highs)` span: a batch spanning Rs 5,000 to Rs 5,00,000
    would otherwise sweep the entire ledger into the pool and let the in-memory pass do the real
    work, which is the shape that scales with the ledger instead of the batch.
    """
    if not amounts:
        return "1=0", []
    clauses, params = [], []
    for amount in amounts:
        low, high = tolerance_bounds(amount)
        clauses.append(f"{column} BETWEEN %s AND %s")
        params.extend([float(low), float(high)])
    return "(" + " OR ".join(clauses) + ")", params


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


def load_project_index() -> ProjectIndex:
    """Build the tier 2 project index once per batch. ~194 rows.

    Same shape and the same reason as `load_vendor_index`: tokenising every project name for each of
    ~50 rows would be redundant work, and the index is a derived value rather than a cache.

    ⚠️ EVERY PROJECT IS LOADED, not just active or Won ones. The index's whole job is to decide which
    tokens are DISTINCTIVE, and that is a property of the full set of names -- filtering the list
    would make a word look unique that is not, which is the one way this rule produces a wrong
    answer rather than no answer.
    """
    rows = frappe.db.sql(
        """
        SELECT name, project_name
        FROM "tabProjects"
        """,
        as_dict=True,
    )
    return build_project_index([(r["name"], r.get("project_name") or "") for r in rows])


def load_payments_by_reference(references: Sequence[str]) -> tuple[TargetRef, ...]:
    """Pass A, SETTLE CANDIDATES: APPROVED payments whose normalised UTR is one of these.

    ⚠️ v3 narrowed this to `Approved`. v2 returned every status on purpose, so that a transfer
    against a payment nobody had approved could be reported as a `Control exception`. That status
    is retired -- such a row is now simply `Unmatched`, and nothing that cannot be settled is
    offered (owner ruling). Widening this back re-opens the door to settling an unapproved payment.

    For the already-Paid duplicate guard, use `load_paid_payments_by_reference`. It is a separate
    function for a reason; see the module docstring.
    """
    return _payments_by_reference(references, _PAYMENT_STATUSES)


def load_paid_payments_by_reference(references: Sequence[str]) -> tuple[TargetRef, ...]:
    """DUPLICATE GUARD, not a candidate pool: PAID payments already carrying one of these
    references.

    A hit means the transfer was recorded by hand before this statement was uploaded, which under
    owner ruling Q12 (mixed usage is normal) is the COMMON case, not an edge case. The row is
    Skipped with the record named, or -- if the amounts disagree -- Mismatched. Neither is a settle.

    ⚠️ Only PAID payments carry a reference at all: `utr` is written at fulfilment, so every
    non-Paid payment in the database has a blank one (measured: 0 of 133 across Approved, CEO
    Pending and Requested). The status filter is therefore belt-and-braces over a key that already
    cannot match anything unpaid -- and it stays, because it is the line that says out loud what
    this query is for.
    """
    return _payments_by_reference(references, (PAID,))


def _payments_by_reference(
    references: Sequence[str], statuses: Sequence[str]
) -> tuple[TargetRef, ...]:
    """Shared body for the two reference lookups. The STATUS FILTER is the whole difference, so it
    is a parameter rather than a branch -- a branch invites a third caller to pass no filter."""
    wanted = sorted({normalize_reference(r) for r in references if normalize_reference(r)})
    if not wanted or not statuses:
        return ()

    reference_ph = ", ".join(["%s"] * len(wanted))
    status_ph = ", ".join(["%s"] * len(statuses))
    rows = frappe.db.sql(
        f"""
        SELECT name, amount, status, vendor, utr, payment_date, project, document_type,
               document_name, {_PAYMENT_DECIDED_ON}
        FROM "tabProject Payments"
        WHERE utr IS NOT NULL AND utr <> ''
          AND upper(btrim(utr)) IN ({reference_ph})
          AND status IN ({status_ph})
        """,
        (*wanted, *statuses),
        as_dict=True,
    )
    return tuple(_payment_target(r) for r in rows)


def load_payments_by_amount(amounts: Sequence[Decimal]) -> tuple[TargetRef, ...]:
    """TIERS 1 AND 2, SETTLE CANDIDATES: APPROVED payments inside these amount windows.

    ⚠️ ONE POOL SERVES BOTH TIERS, AND THE AMOUNT IS THE ONLY AXIS IT SCOPES BY. Tier 1 then filters
    it in memory by vendor and the strict Re 1 window; tier 2 filters it by project. Pushing either
    of those into SQL would build a pool that is narrower than one of the tiers -- and a pool
    narrower than a tier hides matches without leaving a trace, which is worse than a pool that is
    slightly too wide.

    ⚠️ IT REPLACED A VENDOR-SCOPED, DATE-SCOPED QUERY, AND LOSING BOTH AXES IS DELIBERATE. The old
    "Pass B" needed them because it matched on a NAME-scored vendor and had no other strong signal,
    so a wide pool became a haystack. Tier 1 matches on the bank account, which is an identity form,
    and consults no date at all (owner ruling 2026-08-07: the money either went to that account or
    it did not). The amount windows still bound this to the batch rather than to the ledger, which
    is the property that actually mattered.

    `Approved` only, from `ledgers.SETTLEABLE_STATUSES`: without it this returns Paid payments, which
    are duplicates rather than candidates, and CEO Pending ones, which cannot be settled at all.
    """
    values = sorted({normalize_amount(a) for a in amounts})
    if not values:
        return ()

    status_ph = ", ".join(["%s"] * len(_PAYMENT_STATUSES))
    amount_clause, amount_params = amount_window_sql("amount", values)

    rows = frappe.db.sql(
        f"""
        SELECT name, amount, status, vendor, utr, payment_date, project, document_type,
               document_name, {_PAYMENT_DECIDED_ON}
        FROM "tabProject Payments"
        WHERE {amount_clause}
          AND status IN ({status_ph})
        """,
        tuple([*amount_params, *_PAYMENT_STATUSES]),
        as_dict=True,
    )
    return tuple(_payment_target(r) for r in rows)


def load_expense_targets(amounts: Sequence[Decimal]) -> tuple[TargetRef, ...]:
    """APPROVED expenses at these exact amounts, from BOTH expense doctypes.

    ⚠️ v3 TIGHTENED THE NON-PROJECT SIDE. v2 also accepted `Requested` there, reasoning that the
    doctype has no separate approval step in practice so an Approved-only pool would be empty. The
    owner overruled it (Q3): the import pays what is already approved, and an empty pool is the
    correct answer when nothing is approved. Both lists now come from `ledgers.SETTLEABLE_STATUSES`.

    ⚠️ The two doctypes disagree about storage and the query has to as well:
    `Project Expenses.amount` is a Data field -- PG `varchar(140)` holding bare numeric strings like
    '2935' -- while `Non Project Expenses.amount` is a real `Currency` column. The project side is
    therefore cast, not compared as text; a text compare would miss '2935.0' against 2935.
    """
    values = sorted({normalize_amount(a) for a in amounts})
    if not values:
        return ()

    # ⚠️ The project side is a Data column holding numeric STRINGS, so it is CAST before the
    # window is applied; the non-project side is a real Currency column. Same tolerance, two
    # expressions, because the two doctypes disagree about storage.
    project_amount_clause, project_amount_params = amount_window_sql(
        "CAST(NULLIF(btrim(amount), '') AS numeric)", values
    )
    non_project_amount_clause, non_project_amount_params = amount_window_sql("amount", values)

    out: list[TargetRef] = []

    project_ph = ", ".join(["%s"] * len(_PROJECT_EXPENSE_STATUSES))
    project_rows = frappe.db.sql(
        f"""
        SELECT name, amount, status, projects, description, payment_ref, payment_date, type,
               vendor, {_PROJECT_EXPENSE_DECIDED_ON}
        FROM "tabProject Expenses"
        WHERE status IN ({project_ph})
          AND amount IS NOT NULL AND btrim(amount) <> ''
          AND {project_amount_clause}
        """,
        (*_PROJECT_EXPENSE_STATUSES, *project_amount_params),
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
                decided_on=_decided_on(r),
            )
        )

    non_project_ph = ", ".join(["%s"] * len(_NON_PROJECT_EXPENSE_STATUSES))
    non_project_rows = frappe.db.sql(
        f"""
        SELECT name, amount, status, description, payment_ref, payment_date, type,
               {_NON_PROJECT_EXPENSE_DECIDED_ON}
        FROM "tabNon Project Expenses"
        WHERE status IN ({non_project_ph})
          AND {non_project_amount_clause}
        """,
        (*_NON_PROJECT_EXPENSE_STATUSES, *non_project_amount_params),
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
                decided_on=_decided_on(r),
            )
        )

    return tuple(out)


def find_earlier_batches_for_rows(
    rows: Sequence,
    exclude_batch: str | None = None,
    period_from: date | None = None,
    period_to: date | None = None,
) -> dict[RowIdentity, str]:
    """Map each row's `RowIdentity` -> the earliest OTHER batch that already staged that transfer.

    This is the precise duplicate guard. The batch-level Added-On overlap only warns; two exports
    can carry the same transfer without their periods overlapping at all, and can carry different
    transfers with periods that do.

    ⚠️ IT TAKES ROWS, NOT TRANSFER IDS (slice D3), AND THE RENAME IS THE POINT. Identity is now
    `(transfer_id, amount, date)` -- see `duplicates.row_identity` -- so a caller handing over a
    list of ids can no longer ask this question at all. Leaving the old name and signature in place
    would have let a caller keep passing ids and quietly get the OLD, looser answer.

    ⚠️ THE SQL STILL NARROWS ON `transfer_id` ONLY, AND THE TRIPLE IS APPLIED IN PYTHON. That is
    deliberate twice over: `transfer_id` is the indexed column and remains the cheap first cut, and
    `amount` is a **Currency** column -- a float in Postgres -- so an `=` against it in SQL is the
    binary-floating-point comparison that `normalize_amount` returning `Decimal` exists to avoid.
    Both sides go through `normalize_amount` here, so the comparison is exact and symmetric.

    ⚠️ PERIOD NARROWING IS OPT-IN AND IS ERGONOMICS, NOT SAFETY (owner-directed, slice V3). Supply
    both dates and the search is restricted to batches whose recorded period overlaps this sheet's,
    instead of every import row ever recorded. Omit them and it behaves exactly as before.

    It CAN in principle miss a duplicate living in a batch with an odd recorded period, and that is
    accepted, because it cannot cause double payment: the real backstop is the DB unique constraint
    on `Outflow Row Match (transfer_id, target_doctype, target_name)`. The same transfer physically
    cannot settle the same record twice whatever this pre-filter does. What a miss costs is a
    clearer message, which is what this lookup is for.

    ⚠️ A BATCH WITH NO RECORDED PERIOD IS ALWAYS SEARCHED. It cannot be excluded on evidence we do
    not have, and dropping it would turn "we could not date this batch" into "this batch contains
    nothing".
    """
    wanted = sorted({row.transfer_id for row in rows if row.transfer_id})
    if not wanted:
        return {}

    placeholders = ", ".join(["%s"] * len(wanted))
    params: list = list(wanted)
    exclude_clause = ""
    if exclude_batch:
        exclude_clause = " AND import_batch <> %s"
        params.append(exclude_batch)

    period_clause = ""
    if period_from and period_to:
        period_clause = """
          AND import_batch IN (
                SELECT name FROM "tabOutflow Import Batch"
                 WHERE period_from IS NULL OR period_to IS NULL
                    OR (period_from <= %s AND period_to >= %s)
              )
        """
        params.extend([period_to, period_from])

    stored = frappe.db.sql(
        f"""
        SELECT transfer_id, amount, added_on, import_batch, creation
        FROM "tabOutflow Import Row"
        WHERE transfer_id IN ({placeholders})
          {exclude_clause}
          {period_clause}
        ORDER BY creation ASC
        """,
        tuple(params),
        as_dict=True,
    )

    # Grouped by the two axes that must match EXACTLY, so the only per-row work left is the date
    # rule -- which cannot be a dict lookup, because a missing date has to match a present one.
    by_id_amount: dict[tuple[str, Decimal], list] = {}
    for r in stored:
        key = (r["transfer_id"], normalize_amount(r.get("amount")))
        by_id_amount.setdefault(key, []).append(r)

    seen: dict[RowIdentity, str] = {}
    for row in rows:
        if not row.transfer_id:
            continue
        identity = row_identity(row.transfer_id, row.amount, row.added_on_date)
        if identity in seen:
            continue
        for r in by_id_amount.get((row.transfer_id, row.amount), ()):
            if dates_agree(row.added_on_date, _stored_date(r.get("added_on"))):
                # `stored` is already ordered by `creation ASC`, so the first agreeing row is the
                # EARLIEST batch -- which is the one the message names.
                seen[identity] = r["import_batch"]
                break
    return seen


def _stored_date(value) -> date | None:
    """The DATE of a stored `added_on`, tolerating the shapes the DB layer hands back.

    Frappe returns a Datetime column as `datetime`, but a raw SQL read can hand back a `date` or a
    string depending on driver and column, and this comparison must not depend on which. A value it
    cannot read becomes `None`, which `dates_agree` then treats as "cannot compare on this axis" --
    the same fallback an unreadable Added On gets at parse time, and for the same reason.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    parsed = getdate(value) if value else None
    return parsed or None


def _decided_on(row: dict) -> date | None:
    """The `decided_on` column as a plain `date`.

    ⚠️ THE COERCION IS NOT COSMETIC. On a payment this is a `Date` column and arrives as a `date`;
    on either expense it is `modified`, a `Datetime`, and arrives as a `datetime`. M4 subtracts this
    from the transfer's date, and `date - datetime` raises `TypeError` -- so without this the rule
    would work on payments and blow up on the first expense candidate it ever saw.
    """
    value = row.get("decided_on")
    if value is None:
        return None
    return value.date() if hasattr(value, "date") else value


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
        decided_on=_decided_on(row),
    )
