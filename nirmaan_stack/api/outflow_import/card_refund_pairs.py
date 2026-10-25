# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Unskipping a *Card refund pair* (#1567, spec #1565, ADR-0039 decision 4, README ruling 5).

A merchant credit on a Credit Card Statement that cancels a spend of the same merchant and amount is staged
with that spend as a pair: both lines Skipped, kind *Card refund pair*, each linking the other through
`Outflow Import Row.card_refund_partner`. A person who disagrees with the pairing unskips EITHER line, and
both come back in one transaction:

    the credit   -> `Mismatched`: an unpaired card credit, decided on the main table (README ruling 4)
    the spend    -> `Pending match run`: Create's work again; its Create plan was kept while it was skipped

`review.unskip_row` routes here, after `skip_origin.unskip_refusal` and under its row lock and
concurrent-writer wrapper. This commits for it.
"""

import frappe

from nirmaan_stack.services.outflow_import.parser import DIRECTION_CREDIT
from nirmaan_stack.services.outflow_import.row_settlement import refresh_batch_rollup
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_CARD_REFUND_PAIR
from nirmaan_stack.services.outflow_import.status import (
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SKIPPED,
    derive_batch_status,
)

ROW_DOCTYPE = "Outflow Import Row"

PAIR_BROKEN = (
    "This line's refund pair cannot be found whole (its other line is no longer skipped with it), so it "
    "can't be unskipped. Ask an Admin to check both lines."
)


def unskip_refund_pair(row: str, batch: str, actor: str, reason: str) -> dict:
    """Bring back `row` and the other line of its refund pair. Returns what `review.unskip_row` returns."""
    partner = frappe.db.get_value(ROW_DOCTYPE, row, "card_refund_partner")
    other = (
        frappe.db.get_value(
            ROW_DOCTYPE,
            partner,
            ["name", "row_status", "skip_kind", "card_refund_partner"],
            as_dict=True,
            for_update=True,
        )
        if partner
        else None
    )
    if not (
        other
        and other.row_status == ROW_SKIPPED
        and other.skip_kind == SKIP_KIND_CARD_REFUND_PAIR
        and other.card_refund_partner == row
    ):
        frappe.throw(PAIR_BROKEN, title="Cannot unskip this transfer")

    docs = [_reopen(name, actor, reason) for name in (row, other.name)]
    statuses = refresh_batch_rollup(batch)
    frappe.db.commit()
    doc = docs[0]
    return {
        "row": row,
        "status": doc.row_status,
        "outcome_note": doc.outcome_note or "",
        "suggested_doctype": "",
        "suggested_name": "",
        "batch_status": derive_batch_status(statuses),
        # The other line of the pair, back with it.
        "partner": other.name,
    }


def _reopen(name: str, actor: str, reason: str):
    doc = frappe.get_doc(ROW_DOCTYPE, name)
    doc.update(
        {
            "row_status": ROW_MISMATCHED if doc.direction == DIRECTION_CREDIT else ROW_PENDING_MATCH,
            "skip_origin": None,
            "skip_kind": None,
            "skip_reason": None,
            "outcome_note": None,
            "decided_at": None,
            "decided_by": None,
            "card_refund_partner": None,
        }
    )
    # ⚠️ `ignore_version=False` IS EXPLICIT, for the reason `review.skip_row` gives.
    doc.save(ignore_permissions=True, ignore_version=False)
    doc.add_comment("Comment", text=f"Unskipped by {actor} (card refund pair, both lines): {reason}")
    return doc
