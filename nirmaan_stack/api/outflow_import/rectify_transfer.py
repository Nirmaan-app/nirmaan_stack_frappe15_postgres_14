# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Move's third destination: Internal Transfer (#1762, spec #1753 stories 13, 27-28, ADR-0044).

A created wallet spend that was really one of our own moves (a card bill paid from a wallet) stops being spend. The
person chooses the far end and the detail as Mark as Internal Transfer asks (`internal_transfer_rules.hand_mark_ends`:
the line's own side is its source's place). Run by the Rectify core (`porter_rectify.rectify_line`) inside its
savepoint, after the line's Settled match is stamped Reversed and before its comments:

    1. the line's Internal Transfer record, made by hand, with the person, the time and the reason
    2. every File of the expense moves to the record; the latest bill's File is the record's `proof`
    3. the expense is deleted as Unreconcile deletes a created record (`delete_created`); its Expense bills stay as
       history (its `on_trash` retires them)
    4. the line becomes Internal Transfer, through the document layer, and the import's rollup is refreshed

⚠️ MARK AS INTERNAL TRANSFER STILL REFUSES A SETTLED LINE (`internal_transfer_rules.mark_refusal`). This path is not
a loosening of it: the core has already taken the line off its expense under its locks, so no money is recorded twice.
"""

from __future__ import annotations

from dataclasses import dataclass

import frappe

from nirmaan_stack.api.outflow_import.internal_transfer_actions import MARKED_NOTE, save_line
from nirmaan_stack.api.outflow_import.internal_transfers import INTERNAL_TRANSFER_DOCTYPE, record_for_line
from nirmaan_stack.api.outflow_import.unreconcile_created import delete_created
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE
from nirmaan_stack.services.outflow_import.internal_transfer_rules import (
    hand_mark_detail,
    hand_mark_ends,
    other_end_refusal,
    own_place,
)
from nirmaan_stack.services.outflow_import.internal_transfers import MADE_BY_HAND, PLACES
from nirmaan_stack.services.outflow_import.row_settlement import refresh_batch_rollup
from nirmaan_stack.services.outflow_import.status import ROW_INTERNAL_TRANSFER
from nirmaan_stack.services.stored_files import reattach_files

#: The `destination` a Move write names for this one; any other value is a project or Non Project.
INTERNAL_TRANSFER_DESTINATION = INTERNAL_TRANSFER_DOCTYPE

NO_OWN_PLACE = "A {source} line cannot be moved to Internal Transfer: its statement is not one of our own places."
UNKNOWN_DESTINATION = "Move to a project, to No project, or to Internal Transfer; '{destination}' is none of these."


@dataclass(frozen=True)
class TransferTo:
    """Where the money went (or came from) as the person chose it: the far end and the detail."""

    other_end: str
    detail: str = ""


def transfer_offer(source: str) -> dict | None:
    """What the Move dialog offers for this destination on `source`'s lines, or `None` when they cannot move there:
    the line's `own_place` and the `other_ends` to choose from (every place but that one), as Mark offers them."""
    own = own_place(source)
    if own is None:
        return None
    return {"own_place": own, "other_ends": [place for place in PLACES if place != own]}


def transfer_detail(line) -> str:
    """The detail the dialog starts with for `line`, as Mark starts it (`hand_mark_detail`: the wallet holder)."""
    return hand_mark_detail(line.source, line.direction, line.get("added_by_raw"), line.get("beneficiary_name"))


def refuse_unless_transferable(source: str, transfer: TransferTo) -> None:
    """Refuse the whole write, writing nothing, when `source`'s lines have no own place to move from, or `other_end`
    is not a place other than that one (Mark's own rule, `other_end_refusal`)."""
    if own_place(source) is None:
        frappe.throw(NO_OWN_PLACE.format(source=source or "blank-source"), title="Cannot move to Internal Transfer")
    refusal = other_end_refusal(source, transfer.other_end)
    if refusal:
        frappe.throw(refusal, title="Cannot move to Internal Transfer")


def move_to_internal_transfer(line, old, transfer: TransferTo, reason: str, actor: str, kept_file_url) -> str:
    """Steps 1-4 above for `line` (read with `amount`, `direction`, `settlement_reference`), whose created expense
    `old` is held under lock and whose Settled match is already Reversed. Returns the record's name. Never commits."""
    now = frappe.utils.now_datetime()
    ends = hand_mark_ends(line.source, line.direction, transfer.other_end, transfer.detail)
    record = record_for_line(line, ends, MADE_BY_HAND, marked_by=actor, marked_at=now, reason=reason)
    proof = frappe.db.get_value(
        BILL_DOCTYPE, {"expense_doctype": old.doctype, "expense": old.name, "is_latest": 1}, "bill_file"
    )
    # Every File of the expense goes to the record before the delete would take it; the bill's is its `proof`.
    reattach_files(
        old.doctype, old.name, INTERNAL_TRANSFER_DOCTYPE, record, except_url=kept_file_url, field_url=proof,
        field="proof",
    )
    if proof:
        # ⚠️ `set_value`, after the insert: the record refuses every save after insert (`NEVER_EDITED`), and a save
        # would make Frappe's attach hook mint a second File row for it. Nothing is derived from the field.
        frappe.db.set_value(INTERNAL_TRANSFER_DOCTYPE, record, "proof", proof, update_modified=False)
    delete_created(old.doctype, old.name, None)
    note = MARKED_NOTE.format(actor=actor, day=frappe.utils.formatdate(now), reason=reason)
    save_line(line.name, {"row_status": ROW_INTERNAL_TRANSFER, "outcome_note": note}, actor, now)
    refresh_batch_rollup(line.import_batch)
    return record
