# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Turn every line skipped before spec #1619, under a kind that is now an Internal Transfer, into an Internal
Transfer line with its record, so the Internal Transfers tab is complete for past months (#1627, ADR-0044).

WHAT IT DECIDES, AND WHERE
    `services/outflow_import/internal_transfer_backfill.place_old_skip`, which places a line with the SAME table
    the imports use: the bank rules re-read the line's text (the bounced-top-up test included), Cashbook lines go
    by their stored Type or, with none, by their Txn Id (`VALOAD-`, `BUSINESS_USER-`, `C2B-`), and a card payment
    only when its words are the bank's auto-debit. A Cashbook `REF-` line, a bounced vendor payment, a UPI card
    payment and every other skip are LEFT as they are.

IT NEVER GUESSES
    A line of a moved kind today's rules do not read as internal is left Skipped and PRINTED, with its kind and why,
    for a person to check (spec #1619 story 45). #1628 decides those lines and only then retires the moved Skip Types.

IDEMPOTENT
    Only Skipped lines are read; a converted line is `Internal Transfer` and never read again, and a line that
    already has a record gets no second one. A STATUS-CHANGED REPEAT of a Cashbook move (two lines, one Txn Id and
    amount) becomes an Internal Transfer line with no record of its own, as the import would make it.

WHAT IT CANNOT KNOW, STATED
    An old card auto-debit line kept no card heading, so its record names no card digits. An old Cashbook top-up
    staged its Debit (0) as its amount -- its money was in the statement's Credit column, never stored -- so its
    record's amount is the line's, 0.

RAW LINE UPDATE, NOT `doc.save` -- AND WHY SKIPPING THE LIFECYCLE IS CORRECT HERE (CODING_STANDARDS rule 1)
    `Outflow Import Row` has no `doc_events`; its controller validates two identity fields. Re-saving historical
    lines would stamp a Version row and `modified` on each. The one derived value the status feeds, the batch's
    counters and status, is recomputed from source for every touched batch (`refresh_batch_rollup`). The records
    are inserted through the document layer (`record_for_line`).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import frappe

from nirmaan_stack.api.outflow_import.internal_transfers import (
    INTERNAL_TRANSFER_DOCTYPE,
    move_already_recorded,
    record_for_line,
)
from nirmaan_stack.services.outflow_import.internal_transfer_backfill import LEFT, PLACED, UNPLACED, place_old_skip
from nirmaan_stack.services.outflow_import.internal_transfers import CARD_AUTO_DEBIT_RULE, transfer_sentence
from nirmaan_stack.services.outflow_import.row_settlement import refresh_batch_rollup
from nirmaan_stack.services.outflow_import.skip_kinds import (
    SKIP_KIND_BY_EXCLUSION_CATEGORY,
    SKIP_KIND_CARD_PAYMENT,
    SKIP_KIND_CASHBOOK_INTERNAL,
)
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE
from nirmaan_stack.services.outflow_import.status import (
    ROW_INTERNAL_TRANSFER,
    ROW_SKIPPED,
    STAGED_NOTE_INTERNAL_TRANSFER,
)

ROW_DOCTYPE = "Outflow Import Row"

#: The Skip Types a line of which may now be an Internal Transfer. Every other Skipped line is not read at all.
CANDIDATE_KINDS = tuple(
    sorted(
        set(SKIP_KIND_BY_EXCLUSION_CATEGORY.values()) | {SKIP_KIND_CASHBOOK_INTERNAL, SKIP_KIND_CARD_PAYMENT}
    )
)

_FIELDS = (
    "name, import_batch, source, skip_kind, remarks, direction, transfer_id, row_kind, status_raw, "
    "added_by_raw, beneficiary_name, amount, added_on, settlement_reference"
)


@dataclass
class Report:
    converted: int = 0
    left: dict = field(default_factory=dict)
    #: (line, kind, why) for every line of a moved kind that could not be placed.
    unplaced: list = field(default_factory=list)

    def text(self) -> str:
        lines = [
            f"internal_transfers_from_old_skips: {self.converted} lines converted to Internal Transfers; "
            f"{sum(self.left.values())} left as they are; {len(self.unplaced)} could not be placed."
        ]
        lines += [f"  left: {count} -- {why}" for why, count in sorted(self.left.items())]
        if self.unplaced:
            lines.append("  could not place (line, Skip Type, why):")
            lines += [f"    {line} | {kind} | {why}" for line, kind, why in self.unplaced]
        return "\n".join(lines)


def execute():
    if not frappe.db.table_exists(INTERNAL_TRANSFER_DOCTYPE):
        print("internal_transfers_from_old_skips: the Internal Transfer doctype is not synced yet, skipping")
        return
    report = convert_old_skips()
    frappe.db.commit()
    print(report.text())
    frappe.logger("outflow_import").info(report.text())


def convert_old_skips(rows: list[str] | None = None) -> Report:
    """Convert every Skipped line of a moved kind (or only `rows`, which is what the tests pass). Does not commit."""
    scope, params = "", [ROW_SKIPPED, CANDIDATE_KINDS]
    if rows is not None:
        scope, params = " AND name IN %s", params + [tuple(rows) or ("",)]
    lines = frappe.db.sql(
        f"""SELECT {_FIELDS} FROM "tabOutflow Import Row"
            WHERE row_status = %s AND skip_kind IN %s{scope}
            ORDER BY creation, name""",
        tuple(params),
        as_dict=True,
    )
    report = Report()
    touched = set()
    for line in lines:
        placement = place_old_skip(
            source=line.source or "",
            skip_kind=line.skip_kind or "",
            remarks=line.remarks or "",
            direction=line.direction or "",
            transfer_id=line.transfer_id or "",
            row_kind=line.row_kind or "",
            status_raw=line.status_raw or "",
            added_by_raw=line.added_by_raw or "",
            beneficiary_name=line.beneficiary_name or "",
        )
        if placement.outcome == LEFT:
            report.left[placement.why] = report.left.get(placement.why, 0) + 1
            continue
        if placement.outcome == UNPLACED:
            report.unplaced.append((line.name, line.skip_kind, placement.why))
            continue
        assert placement.outcome == PLACED
        _convert(line, placement)
        touched.add(line.import_batch)
        report.converted += 1
    for batch in sorted(touched):
        refresh_batch_rollup(batch)
    return report


def _convert(line, placement) -> None:
    """The line becomes an Internal Transfer line; it gets the move's record unless a line of the same move (its
    repeat identity, `move_already_recorded`) already holds one -- a status-changed repeat, or a run before."""
    is_cashbook = (line.source or "").strip() == CASHBOOK_SOURCE
    note = (
        transfer_sentence(placement.ends)
        if is_cashbook or placement.rule == CARD_AUTO_DEBIT_RULE
        else STAGED_NOTE_INTERNAL_TRANSFER.format(category=placement.rule)
    )
    # ⚠️ RAW, AND SAFE: the row has no `doc_events`; the batch rollup is recomputed after the loop.
    frappe.db.set_value(
        ROW_DOCTYPE,
        line.name,
        {
            "row_status": ROW_INTERNAL_TRANSFER,
            "skip_kind": None,
            "skip_reason": None,
            "skip_origin": None,
            "outcome_note": note,
        },
        update_modified=False,
    )
    if frappe.db.exists(INTERNAL_TRANSFER_DOCTYPE, {"import_row": line.name}):
        return
    if move_already_recorded(line):
        return
    # A Cashbook line states no direction: its stored amount is its Debit, so a line with one is money out, and a
    # top-up (its money in the Credit column, stored as 0) is money in -- as the import decides it (#1623).
    direction = ("Out" if float(line.amount or 0) > 0 else "In") if is_cashbook else None
    record_for_line(line, placement.ends, placement.rule, direction=direction)
