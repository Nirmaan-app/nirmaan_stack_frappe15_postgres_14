# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Mark as Internal Transfer and Send back to Mismatched, by hand (#1626, spec #1619, ADR-0044).

Admin and Accountant Lead only (`require_outflow_undo_access`), each needing a typed reason. The rules are
`services/outflow_import/internal_transfer_rules`, asked under the line's row lock, so a concurrent action cannot
slip a line past them. Each writes the line through the document layer (a Version row) and a comment, refreshes the
import's rollup and commits.

Send back is neither Unskip nor Unreconcile: it deletes the line's Internal Transfer record (whichever rule or
person made it) and reopens the line as Mismatched, keeping who, when and why on the line.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.api.outflow_import.internal_transfers import (
    INTERNAL_TRANSFER_DOCTYPE,
    record_for_line,
)
from nirmaan_stack.api.outflow_import.permissions import require_outflow_undo_access
from nirmaan_stack.services.outflow_import.internal_transfer_rules import (
    hand_mark_ends,
    mark_refusal,
    other_end_refusal,
    send_back_refusal,
)
from nirmaan_stack.services.outflow_import.internal_transfers import MADE_BY_HAND
from nirmaan_stack.services.outflow_import.row_settlement import (
    ROW_DOCTYPE,
    refresh_batch_rollup,
)
from nirmaan_stack.services.outflow_import.status import (
    ROW_INTERNAL_TRANSFER,
    ROW_MISMATCHED,
    derive_batch_status,
)

MARK_REASON_REQUIRED = "A reason is required to mark a line as an Internal Transfer."
SEND_BACK_REASON_REQUIRED = "A reason is required to send a line back to Mismatched."
#: The line's note after a hand mark and after a send back: who, when and why stay on the line.
MARKED_NOTE = "Marked as Internal Transfer by {actor} on {day}: {reason}"
SENT_BACK_NOTE = "Sent back to Mismatched by {actor} on {day}: {reason}"

_LINE_FIELDS = ["name", "import_batch", "row_status", "source", "row_kind", "direction", "match_basis", "amount",
                "added_on", "remarks", "settlement_reference", "transfer_id"]


@frappe.whitelist(methods=["POST"])
def mark_internal_transfer(row: str, other_end: str, reason: str, detail: str | None = None) -> dict:
    """Mark an open ICICI, Cashfree or Cashbook line as an Internal Transfer, with a reason.

    URL: /api/method/nirmaan_stack.api.outflow_import.internal_transfer_actions.mark_internal_transfer
    (POST `row`, `other_end`, `reason`, optional `detail`)

    The line's own side is its source's place (`internal_transfer_rules.own_place`); `other_end` is the far end,
    one of `internal_transfers.PLACES`. Money out of the line runs from its own side to `other_end`; money in runs
    the other way. The record is made "by hand", with the person, the time and the reason.
    """
    # A FUNCTION-LOCAL IMPORT: `expenses.py` imports `review.py`, which this module must not pull in at load.
    from nirmaan_stack.api.outflow_import.expenses import concurrent_writer_refusal_as_sentence

    actor = require_outflow_undo_access()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw(MARK_REASON_REQUIRED, title="Missing reason")

    with concurrent_writer_refusal_as_sentence("mark_internal_transfer", row):
        line = _locked_line(row)
        refusal = mark_refusal(
            row_status=line.row_status,
            source=line.source,
            direction=line.direction,
            import_batch=line.import_batch,
            match_basis=line.match_basis,
        ) or other_end_refusal(line.source, other_end)
        if refusal:
            frappe.throw(refusal, title="Cannot mark as Internal Transfer")

        ends = hand_mark_ends(line.source, line.direction, other_end, detail)
        now = frappe.utils.now_datetime()
        record_for_line(line, ends, MADE_BY_HAND, marked_by=actor, marked_at=now, reason=reason)
        note = MARKED_NOTE.format(actor=actor, day=frappe.utils.formatdate(now), reason=reason)
        _save_line(row, {"row_status": ROW_INTERNAL_TRANSFER, "outcome_note": note}, actor, now)
        statuses = refresh_batch_rollup(line.import_batch)
        frappe.db.commit()
    return {"row": row, "status": ROW_INTERNAL_TRANSFER, "batch_status": derive_batch_status(statuses)}


@frappe.whitelist(methods=["POST"])
def send_back_to_mismatched(row: str, reason: str) -> dict:
    """Send an Internal Transfer line back to Mismatched, with a reason: its record is deleted, the line reopens.
    Every Internal Transfer line holds its own record (owner decision 3, #1619), so no other line goes with it.
    A Cashbook line whose own Type is one of our moves is refused (`internal_transfer_rules.send_back_refusal`).

    URL: /api/method/nirmaan_stack.api.outflow_import.internal_transfer_actions.send_back_to_mismatched
    (POST `row`, `reason`)
    """
    from nirmaan_stack.api.outflow_import.expenses import concurrent_writer_refusal_as_sentence

    actor = require_outflow_undo_access()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw(SEND_BACK_REASON_REQUIRED, title="Missing reason")

    with concurrent_writer_refusal_as_sentence("send_back_to_mismatched", row):
        line = _locked_line(row)
        refusal = send_back_refusal(
            row_status=line.row_status, source=line.source, row_kind=line.row_kind, transfer_id=line.transfer_id
        )
        if refusal:
            frappe.throw(refusal, title="Cannot send back")
        for name in frappe.get_all(INTERNAL_TRANSFER_DOCTYPE, filters={"import_row": row}, pluck="name"):
            frappe.delete_doc(INTERNAL_TRANSFER_DOCTYPE, name, ignore_permissions=True, force=True)
        now = frappe.utils.now_datetime()
        note = SENT_BACK_NOTE.format(actor=actor, day=frappe.utils.formatdate(now), reason=reason)
        _save_line(row, {"row_status": ROW_MISMATCHED, "outcome_note": note}, actor, now)
        statuses = refresh_batch_rollup(line.import_batch)
        frappe.db.commit()
    return {"row": row, "status": ROW_MISMATCHED, "batch_status": derive_batch_status(statuses)}


def _locked_line(row: str):
    line = frappe.db.get_value(ROW_DOCTYPE, row, _LINE_FIELDS, as_dict=True, for_update=True)
    if not line:
        frappe.throw(f"Import row '{row}' not found.", title="Not found")
    return line


def _save_line(row: str, values: dict, actor: str, now) -> None:
    """The line's new status and note, who and when, through the document layer (a Version row) and a comment."""
    doc = frappe.get_doc(ROW_DOCTYPE, row)
    doc.update(
        {
            **values,
            "skip_origin": None,
            "skip_kind": None,
            "skip_reason": None,
            "decided_by": actor,
            "decided_at": now,
        }
    )
    # ⚠️ `ignore_version=False` IS EXPLICIT, as at `review.skip_row`: Frappe defaults it to `frappe.flags.in_test`.
    doc.save(ignore_permissions=True, ignore_version=False)
    doc.add_comment("Comment", text=values["outcome_note"])
