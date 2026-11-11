# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The import re-opens lines an earlier Cashbook import wrongly skipped as own balances (#1596).

Spec #1585 "Re-opening old wrong skips", ADR-0015 Amendment B decision 8. The rule is pure
(`services/outflow_import/cashbook_reopen`, run inside `cashbook.plan_statement`); this module holds its two
database halves:

  * **what the plan is handed** (`wrong_skips`): every earlier Cashbook line carrying one of the statement's Txn Ids
    and skipped with the own-balances reason (`cashbook.SKIP_NOT_A_SPEND`). No other skip reason is read, so no
    other skip can come back;
  * **the claim** (`claim_reopens`, called by `cashbook._plan_claiming_reopens` before confirm saves anything):
    each earlier line the plan re-opens is locked and re-checked; one another import or a person changed meanwhile
    is handed back, and confirm plans again without it, so its line follows the ordinary rule (code review S6);
  * **the write** (`reopen_lines`, called by `cashbook._stage` inside confirm's transaction): each planned line that
    re-opens one is written onto THAT earlier line, still under the claim's row lock, with the same values a new line of the plan
    gets (`cashbook_lines.line_values`). The line stays in its own import, whose rollup is refreshed. Nothing is staged
    anew, so no second line for the same Txn Id is left.

⚠️ RECORDED AS AN UNSKIP IS (`review._unskip_cashbook_line`): one save through the document layer, so the
doctype's `track_changes` keeps a Version of every field it changed, and a Comment on the line naming the import that
re-opened it. The decision fields an unskip clears are cleared too.

⚠️ IT NEVER CREATES AN EXPENSE. A re-opened line is open (`Mismatched`, which the job never takes) or one line of a
*Paired wallet refund* (Skipped); `Pending match run` is never written. A person decides an open line on the main
table. A re-opened Collect payment's bill is copied by the job like a new one's (`cashbook_bills.store_collect_bills`).
"""

from __future__ import annotations

import frappe

from nirmaan_stack.api.outflow_import.cashbook_lines import ROW_DOCTYPE, line_values, lock_line_if
from nirmaan_stack.services.outflow_import.cashbook import SKIP_NOT_A_SPEND, CashbookPlan
from nirmaan_stack.services.outflow_import.cashbook_reopen import EarlierWrongSkip
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.row_settlement import refresh_batch_rollup
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE
from nirmaan_stack.services.outflow_import.status import ROW_SKIPPED

# The decision fields a re-open clears, as an unskip does (`review._unskip_cashbook_line`).
_CLEARED = {"decided_at": None, "decided_by": None, "settlement_origin": None, "duplicate_basis": None}


def wrong_skips(transfer_ids) -> list[EarlierWrongSkip]:
    """Every earlier Cashbook line with one of `transfer_ids`, skipped with the own-balances reason, oldest first."""
    ids = sorted({tid for tid in transfer_ids if tid})
    if not ids:
        return []
    placeholders = ", ".join(["%s"] * len(ids))
    rows = frappe.db.sql(
        f"""
        SELECT r.name, r.import_batch, r.transfer_id, r.amount, r.added_on, r.row_kind
        FROM "tabOutflow Import Row" r
        JOIN "tabOutflow Import Batch" b ON b.name = r.import_batch
        WHERE b.source = %s AND r.row_status = %s AND r.skip_reason = %s AND r.transfer_id IN ({placeholders})
        ORDER BY r.creation ASC, r.name ASC
        """,
        (CASHBOOK_SOURCE, ROW_SKIPPED, SKIP_NOT_A_SPEND, *ids),
        as_dict=True,
    )
    return [
        EarlierWrongSkip(
            line=row.name,
            batch=row.import_batch,
            transfer_id=row.transfer_id,
            amount=normalize_amount(row.amount),
            added_on_date=row.added_on.date() if row.added_on else None,
            row_kind=(row.row_kind or "").strip(),
        )
        for row in rows
    ]


def reopen_lines(plan: CashbookPlan, kept_rows, batch: str, actor: str) -> list[str]:
    """Write each re-opening line of `plan` onto the earlier line it re-opens. Returns the lines re-opened.

    `kept_rows` are the parsed lines behind `plan.rows`, in the same order. Runs in confirm's transaction and does
    not commit.

    ⚠️ NO SECOND CHECK, AND NO REFUSAL (code review R4). Every earlier line in `plan` was claimed by `claim_reopens`
    in this same transaction, after confirm's `store_file` commit (`cashbook._plan_claiming_reopens`), and its row
    lock is held to confirm's commit; a line taken before that claim was planned again without the re-open. So each
    is still an own-balances skip here, and there is no case left in which to tell the user to confirm again.
    """
    reopened: list[str] = []
    batches: set[str] = set()
    for raw, planned in zip(kept_rows, plan.rows, strict=True):
        earlier = planned.reopens
        if not earlier:
            continue
        doc = frappe.get_doc(ROW_DOCTYPE, earlier.line)
        doc.update({**_CLEARED, **line_values(raw, planned)})
        # ⚠️ `ignore_version=False` IS EXPLICIT, for the reason `review.skip_row` gives: the Version is the record.
        doc.save(ignore_permissions=True, ignore_version=False)
        doc.add_comment("Comment", text=reopen_comment(batch, actor, planned))
        reopened.append(earlier.line)
        batches.add(earlier.batch)
    for earlier_batch in sorted(batches):
        refresh_batch_rollup(earlier_batch)
    return reopened


def claim_reopens(plan: CashbookPlan) -> set[str]:
    """Lock every earlier line `plan` re-opens and return those that are no longer own-balances skips. The locks are
    held to confirm's commit, so `reopen_lines` writes exactly what was claimed. A serialization failure (the line
    changed after this transaction's snapshot) propagates; the caller rolls back and plans again."""
    return {
        planned.reopens.line
        for planned in plan.rows
        if planned.reopens and not _still_wrongly_skipped(planned.reopens.line)
    }


def reopen_comment(batch: str, actor: str, planned) -> str:
    """The Comment a re-opened line carries: which import re-opened it, who ran it, and what it is now."""
    now = f"Open: {planned.reason}" if planned.opens else f"Skipped: {planned.reason}"
    return (
        f"Re-opened by the Cashbook import {batch} ({actor}). An earlier import skipped this "
        f"{planned.row_kind or 'line'} as moving money between our own balances. {now}"
    )


def _still_wrongly_skipped(line: str) -> bool:
    """Lock the earlier line and check it is still an own-balances skip."""
    return (
        lock_line_if(
            line,
            lambda row: row.row_status == ROW_SKIPPED and row.skip_reason == SKIP_NOT_A_SPEND,
            columns="row_status, skip_reason",
        )
        is not None
    )
