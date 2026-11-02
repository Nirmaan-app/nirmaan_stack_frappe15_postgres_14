# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A staged Cashbook line: the values it holds of the plan's decision, and its row lock.

Shared by the import (`cashbook._stage`, the job's `_lock_pending_line`), the re-open of earlier lines
(`cashbook_reopen`, #1596) and the bill copy (`cashbook_bills`, #1591 / #1595), so none of them reaches into
another's private names.
"""

from __future__ import annotations

from collections.abc import Callable

import frappe

from nirmaan_stack.services.outflow_import.cashbook import ACTION_CREATE, ACTION_OPEN
from nirmaan_stack.services.outflow_import.ledgers import PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.outflow_import.settlement_reference import resolve_settlement_reference
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE
from nirmaan_stack.services.outflow_import.status import (
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SKIPPED,
    SKIP_ORIGIN_SYSTEM,
)

ROW_DOCTYPE = "Outflow Import Row"

# The tier this source matches on, in `Outflow Row Match.match_basis`'s own vocabulary. NOT
# "Manual" -- no person chose these -- and not "project in remark", which belongs to the settlement
# matcher's tier 2 and would make a created expense look like a settled one in every report.
MATCH_BASIS = "cashbook remark"


def lock_line_if(row_name: str, still: Callable[[dict], bool], columns: str = "*"):
    """The line read under its row lock (`SELECT ... FOR UPDATE`), or `None` when it is gone or `still(line)`
    says it is no longer what the caller may write.

    The one lock-then-check shape every Cashbook writer of a line uses: the job's pending line
    (`cashbook._lock_pending_line`), a Collect payment's stored bill (`cashbook_bills._set_stored_bill`) and an
    earlier own-balances skip a new statement re-opens (`cashbook_reopen`). The check is made on the row the lock
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


def line_values(raw, planned) -> dict:
    """What a staged Cashbook line holds of the plan's decision, whichever batch it is in: `cashbook._stage` writes
    it on a new line, `cashbook_reopen.reopen_lines` on an earlier line it re-opens (#1596)."""
    creating = planned.action == ACTION_CREATE
    # An open line (#1594: an unpaired wallet refund, a wallet credit; #1595: an unpaired Collect payment) is
    # staged at `Mismatched`, a status the job never takes, so it is a person's to decide on the main table from
    # the start (spec #1585 "Phase 2 stages new open lines away from the job"). Its note says what it is. A
    # Collect payment keeps the plan's placement, so Create opens pre-filled (`newExpenseSeed`).
    opening = planned.action == ACTION_OPEN
    skipping = not creating and not opening
    placed = creating or (opening and bool(planned.ledger))
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
            ROW_PENDING_MATCH if creating else ROW_MISMATCHED if opening else ROW_SKIPPED
        ),
        "skip_reason": planned.reason if skipping else None,
        # A Cashbook skip is the import plan's decision, never a person's (#1273).
        "skip_origin": SKIP_ORIGIN_SYSTEM if skipping else None,
        "skip_kind": planned.skip_kind if skipping else None,
        "outcome_note": planned.reason if opening else None,
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
        # #1595: the statement's Type. Only this import writes it, so it also marks the line as staged
        # from a Cashbook Statement (`cashbook_collect.statement_line_create_extras`).
        "row_kind": (raw.row_kind or "").strip() or None,
    }
