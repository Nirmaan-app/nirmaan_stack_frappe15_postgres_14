# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Turn every line skipped before spec #1619, under a kind that is now an Internal Transfer, into an Internal
Transfer line with its record, so the Internal Transfers tab is complete for past months (#1627, ADR-0044).

WHAT IT DECIDES, AND WHERE
    `services/outflow_import/internal_transfer_backfill.place_old_skip`, which places a line with the SAME table
    the imports use: the bank rules re-read the line's text (the bounced-top-up test included), Cashbook lines go
    by their stored Type or, with none, by their Txn Id (`VALOAD-`, `BUSINESS_USER-`, `C2B-`), and a card payment
    only when its words are the bank's auto-debit. A Cashbook `REF-` line, a bounced vendor payment, a UPI card
    payment and every other skip are LEFT as they are. A Cashbook move the wallet did not complete is re-filed as
    Bank refused, as the import files it (owner decision 3, #1619). No line is reopened here: the old Cashbook lines
    wrongly skipped as own balances come back through the #1596 reopen rule on re-upload (owner decision 1).

IT NEVER GUESSES
    A line of a moved kind today's rules do not read as internal is left Skipped and PRINTED, with its kind and why,
    for a person to check (spec #1619 story 45). #1628 decides those lines and only then retires the moved Skip Types.
    Every line it reads and does not convert -- left, re-filed as Bank refused, or not placed -- is printed, one per
    line, with its Skip Type and why.

IDEMPOTENT
    Only Skipped lines are read; a converted line is `Internal Transfer` and never read again. EVERY INTERNAL
    TRANSFER LINE HOLDS EXACTLY ONE RECORD (owner decision 3, #1619): a second line of a move that already holds one
    (an old import could stage a move twice) stays skipped and is printed, and a not-successful repeat is Bank
    refused, its sentence naming the move's earlier line, as the import files it.

WHAT IT CANNOT KNOW, STATED
    An old card auto-debit line kept no card heading, so its record names no card digits. An old Cashbook top-up
    staged its Debit (0) as its amount -- its money was in the statement's Credit column, never stored -- so its
    record's amount is the line's, 0, until a re-upload of that statement fills it (owner decision 2, #1619).

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
    earlier_line_of_move,
    record_for_line,
    recorded_line_of_move,
)
from nirmaan_stack.services.outflow_import.cashbook import (
    SKIP_ALREADY_IMPORTED_STATUS_CHANGED,
    SKIP_REPEATED_IN_FILE_STATUS_CHANGED,
    refused_move_reason,
)
from nirmaan_stack.services.outflow_import.duplicates import bank_status_key
from nirmaan_stack.services.outflow_import.internal_transfer_backfill import (
    LEFT,
    PLACED,
    REFUSED,
    UNPLACED,
    place_old_skip,
)
from nirmaan_stack.services.outflow_import.internal_transfers import (
    CARD_AUTO_DEBIT_RULE,
    cashbook_direction,
    transfer_sentence,
)
from nirmaan_stack.services.outflow_import.row_settlement import refresh_batch_rollup
from nirmaan_stack.services.outflow_import.skip_kinds import (
    SKIP_KIND_BANK_REFUSED,
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
    "added_by_raw, beneficiary_name, amount, added_on, settlement_reference, creation"
)


@dataclass
class Report:
    """What the run did. Each list holds `(line, Skip Type it had, why)`, one entry per line, in the order read."""

    converted: int = 0
    #: Lines of a moved kind today's import keeps skipped too: left exactly as they are.
    left: list = field(default_factory=list)
    #: Cashbook moves the wallet did not complete: re-filed as Bank refused (owner decision 3, #1619).
    refused: list = field(default_factory=list)
    #: Lines of a moved kind that could not be placed: left Skipped for a person to check.
    unplaced: list = field(default_factory=list)

    def text(self) -> str:
        """The summary, then every line it did not convert, one per line: `line | Skip Type | why`."""
        lines = [
            f"internal_transfers_from_old_skips: {self.converted} lines converted to Internal Transfers; "
            f"{len(self.left)} left as they are; {len(self.refused)} re-filed as {SKIP_KIND_BANK_REFUSED}; "
            f"{len(self.unplaced)} could not be placed."
        ]
        for heading, entries in (
            ("left as they are", self.left),
            (f"re-filed as {SKIP_KIND_BANK_REFUSED}", self.refused),
            ("could not place", self.unplaced),
        ):
            if entries:
                lines.append(f"  {heading} (line | Skip Type | why):")
                lines += [f"    {line} | {kind} | {why}" for line, kind, why in entries]
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
            report.left.append((line.name, line.skip_kind, placement.why))
            continue
        if placement.outcome == REFUSED:
            _refuse(line)
            touched.add(line.import_batch)
            report.refused.append((line.name, line.skip_kind, placement.why))
            continue
        if placement.outcome == UNPLACED:
            report.unplaced.append((line.name, line.skip_kind, placement.why))
            continue
        assert placement.outcome == PLACED
        # Lines are read oldest first: a second line of a move whose record exists stays skipped, so every Internal
        # Transfer line holds exactly one record (owner decision 3, #1619).
        recorded_on = recorded_line_of_move(line)
        if recorded_on:
            report.left.append((line.name, line.skip_kind, f"repeats a move already recorded, on line {recorded_on}"))
            continue
        _convert(line, placement)
        touched.add(line.import_batch)
        report.converted += 1
    for batch in sorted(touched):
        refresh_batch_rollup(batch)
    return report


def _refuse(line) -> None:
    """A Cashbook move the wallet did not complete keeps its skip, re-filed as the import files it (owner decision 3,
    #1619): Bank refused, whatever an earlier line of the move said, with the import's sentence naming that line.
    ⚠️ RAW, AND SAFE, as `_convert` says."""
    frappe.db.set_value(
        ROW_DOCTYPE,
        line.name,
        {"skip_kind": SKIP_KIND_BANK_REFUSED, "skip_reason": refused_move_reason(_repeat_sentence(line))},
        update_modified=False,
    )


def _repeat_sentence(line) -> str:
    """The status change from the move's earlier line, as the import words it: in this import, or in an earlier one."""
    earlier = earlier_line_of_move(line)
    if not earlier:
        return ""
    statuses = {"earlier": bank_status_key(earlier.status_raw), "now": bank_status_key(line.status_raw)}
    if earlier.import_batch == line.import_batch:
        return SKIP_REPEATED_IN_FILE_STATUS_CHANGED.format(**statuses)
    return SKIP_ALREADY_IMPORTED_STATUS_CHANGED.format(batch=earlier.import_batch, **statuses)


def _convert(line, placement) -> None:
    """The line becomes an Internal Transfer line with the move's record (none of its lines holds one yet)."""
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
    # A Cashbook line states no direction: its stored amount is its Debit, read as the import reads it (#1623).
    direction = cashbook_direction(line.amount) if is_cashbook else None
    record_for_line(line, placement.ends, placement.rule, direction=direction)
