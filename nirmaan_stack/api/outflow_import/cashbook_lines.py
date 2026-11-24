# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A staged Cashbook line: the values it holds of the plan's decision, and its row lock.

Shared by the import (`cashbook._stage`, the job's `_lock_pending_line`), the re-open of earlier lines
(`cashbook_reopen`, #1596) and the open Collect payments' patch (#1708), so none of them reaches into another's
private names.
"""

from __future__ import annotations

from collections.abc import Callable

import frappe

from nirmaan_stack.services.outflow_import.cashbook import ACTION_CREATE, ACTION_INTERNAL
from nirmaan_stack.services.outflow_import.ledgers import PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.outflow_import.settlement_reference import resolve_settlement_reference
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE
from nirmaan_stack.services.outflow_import.status import (
    ROW_INTERNAL_TRANSFER,
    ROW_PENDING_MATCH,
    ROW_SKIPPED,
    SKIP_ORIGIN_SYSTEM,
)

ROW_DOCTYPE = "Outflow Import Row"
BATCH_DOCTYPE = "Outflow Import Batch"

# The tier this source matches on, in `Outflow Row Match.match_basis`'s own vocabulary. NOT
# "Manual" -- no person chose these -- and not "project in remark", which belongs to the settlement
# matcher's tier 2 and would make a created expense look like a settled one in every report.
MATCH_BASIS = "cashbook remark"


def lock_line_if(row_name: str, still: Callable[[dict], bool], columns: str = "*"):
    """The line read under its row lock (`SELECT ... FOR UPDATE`), or `None` when it is gone or `still(line)`
    says it is no longer what the caller may write.

    The one lock-then-check shape every Cashbook writer of a line uses: the job's pending line
    (`cashbook._lock_pending_line`), an earlier own-balances skip a new statement re-opens (`cashbook_reopen`), and
    an open Collect payment the #1708 patch hands to the job's write. The check is made on the row the lock
    returned, never on an earlier read. A serialization failure (the line changed after a REPEATABLE READ
    snapshot) propagates; the caller decides what it means.
    """
    rows = frappe.db.sql(
        f"""SELECT {columns} FROM "tabOutflow Import Row" WHERE name = %s FOR UPDATE""",
        (row_name,),
        as_dict=True,
    )
    if not rows or not still(rows[0]):
        return None
    return rows[0]


def hand_create_marker(line, source: str | None) -> dict:
    """What a hand Create on the main table (`expenses.create_expense`) adds for a line the Cashbook Statement
    import staged: the Cashbook marker (`cashbook_batch` = the line's import), so its Expense waits in Pending
    Invoices Upload -> Cashbook like the job's (an Unreconciled or Error spend line created again by hand). Empty for
    any other line. Such a line is told apart by its stored statement Type (`row_kind`), which only that import
    writes: an older Cashbook line has none, and its Expense must never wait (spec #1585 "Which Expenses wait")."""
    if source == CASHBOOK_SOURCE and (line.get("row_kind") or "").strip():
        return {"cashbook_batch": line["import_batch"]}
    return {}


def line_values(raw, planned) -> dict:
    """What a staged Cashbook line holds of the plan's decision, whichever batch it is in: `cashbook._stage` writes
    it on a new line, `cashbook_reopen.reopen_lines` on an earlier line it re-opens (#1596)."""
    # The plan stages no open line since #1720: a refund (#1709), a wallet credit (#1720) and a Collect payment
    # (#1708) create like a spend.
    creating = planned.action == ACTION_CREATE
    # #1623: one of Cashbook's own moves -- an Internal Transfer line; its record is written by the stage.
    internal = planned.action == ACTION_INTERNAL
    skipping = not creating and not internal
    placed = creating
    return {
        "source": CASHBOOK_SOURCE,
        "transfer_id": raw.transfer_id,
        "added_on": raw.added_on,
        # The line's money: its Debit, or its Credit on a refund or a wallet credit (#1594), which
        # is then money IN (`direction`), so the main table offers it the choices a bank credit has.
        "amount": float(planned.amount),
        "direction": planned.direction or None,
        "status_raw": raw.status_raw,
        "beneficiary_name": raw.beneficiary_name,
        "remarks": raw.remarks,
        "added_by_raw": raw.added_by_raw,
        # ⚠️ THE SAME ONE RESOLUTION THE GATEWAY PATH USES (ADR-0020 B9), called here rather
        # than assumed away. A wallet row carries neither reference field -- `_CASHBOOK_COLUMNS`
        # maps neither, deliberately and permanently -- so the ladder always lands on the
        # third rung and this is always `transfer_id`. Writing `raw.transfer_id` directly
        # would produce the identical string today and would be the SECOND definition of
        # the ladder: the per-path divergence this slice exists to remove, reintroduced at
        # the very source that made it necessary.
        "settlement_reference": resolve_settlement_reference(
            bank_reference_no=raw.bank_reference_no,
            reference_id=raw.reference_id,
            transfer_id=raw.transfer_id,
            remarks=raw.remarks,
            source=CASHBOOK_SOURCE,
        )
        or None,
        "row_status": (
            ROW_PENDING_MATCH
            if creating
            else ROW_INTERNAL_TRANSFER
            if internal
            else ROW_SKIPPED
        ),
        "skip_reason": planned.reason if skipping else None,
        # A Cashbook skip is the import plan's decision, never a person's (#1273).
        "skip_origin": SKIP_ORIGIN_SYSTEM if skipping else None,
        "skip_kind": planned.skip_kind if skipping else None,
        # #1602: a *Paired wallet refund* keeps the other line's Txn Id, so the Skipped list names it without
        # reading the sentence. Blank on every other line, and cleared on an earlier line a re-open makes open.
        "cashbook_refund_partner": (planned.partner or None) if skipping else None,
        "outcome_note": planned.reason if internal else None,
        "suggested_doctype": planned.ledger if placed else None,
        "suggested_expense_type": planned.expense_type if placed else None,
        "resolved_project": (
            planned.project
            if placed and planned.ledger == PROJECT_EXPENSE_DOCTYPE
            else None
        ),
        "match_basis": MATCH_BASIS if creating else None,
        "auto_matched": 1 if creating else 0,
        # #1590: the line's bill links, in the statement's order, whatever the plan decided.
        # ⚠️ A DICT, NEVER A BARE LIST: Postgres hands a jsonb list back as a Python list,
        # and Frappe refuses to save a document holding a list in a non-table field.
        "bill_links": {"links": list(raw.bill_links)} if raw.bill_links else None,
        # #1595: the statement's Type, as the statement printed it. Only this import writes it.
        "row_kind": (raw.row_kind or "").strip() or None,
    }
