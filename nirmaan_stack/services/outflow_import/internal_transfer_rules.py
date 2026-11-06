# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Mark as Internal Transfer and Send back to Mismatched, by hand: the rules (#1626, spec #1619). Pure.

Each refusal is the sentence the screen shows, or `None` when the action may go ahead. The endpoints
(`api/outflow_import/internal_transfer_actions`) ask these under the line's row lock.
"""

from __future__ import annotations

from nirmaan_stack.services.outflow_import.internal_transfers import (
    PLACE_CASHBOOK_WALLET,
    PLACE_CASHFREE,
    PLACE_ICICI_CURRENT,
    PLACES,
    TRANSFER_IN,
    TransferEnds,
    record_direction,
)
from nirmaan_stack.services.outflow_import.skip_origin import own_import_refusal
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE, CASHFREE_SOURCE, ICICI_STATEMENT_SOURCE
from nirmaan_stack.services.outflow_import.status import (
    OPEN_ROW_STATUSES,
    ROW_INTERNAL_TRANSFER,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
    ROW_SKIPPED,
)

#: The line's own side when marked by hand: where the statement's account is. A Cashbook line's own side is an
#: employee's wallet, where the statement's spends, refunds and collect payments sit (decision, #1626).
OWN_PLACE_BY_SOURCE = {
    ICICI_STATEMENT_SOURCE: PLACE_ICICI_CURRENT,
    CASHFREE_SOURCE: PLACE_CASHFREE,
    CASHBOOK_SOURCE: PLACE_CASHBOOK_WALLET,
}

MARK_REFUSED_SOURCE = (
    "Only an ICICI, Cashfree or Cashbook line can be marked as an Internal Transfer. A {source} line is decided "
    "by its own import."
)
MARK_REFUSED_SETTLED = (
    "This line has already settled a record, so it can't be marked as an Internal Transfer. Unreconcile it first."
)
MARK_REFUSED_PARTLY = (
    "Part of this line is already allocated to records, so it can't be marked as an Internal Transfer. Reverse "
    "its allocations first."
)
MARK_REFUSED_SKIPPED = "This line is skipped. Unskip it first, then mark it as an Internal Transfer."
MARK_REFUSED_ALREADY = "This line is already an Internal Transfer."
MARK_REFUSED_NOT_OPEN = "This line is {status}, so it can't be marked as an Internal Transfer."
OTHER_END_REFUSED = "Choose where the money came from or went to: one of {places}, other than the line's own {own}."
SEND_BACK_REFUSED = "This line is not an Internal Transfer, so there is nothing to send back."


def own_place(source: str | None) -> str | None:
    """The place a line's own statement account is, or `None` for a source that cannot be marked by hand."""
    return OWN_PLACE_BY_SOURCE.get((source or "").strip())


def mark_refusal(
    *, row_status: str | None, source: str | None, direction: str | None, import_batch: str | None = None
) -> str | None:
    """Why this line may NOT be marked as an Internal Transfer by hand, or `None` when it may.

    Open lines only (Pending match run, Matched, Mismatched, Error), so money is never recorded twice. A Porter line
    and a card spend wait for their own import, and a Cashbook line its job still owns is refused with the same
    sentences every main-table write uses (`skip_origin.own_import_refusal`). Any other source but ICICI, Cashfree
    and Cashbook (a card credit) is refused by name.
    """
    status = (row_status or "").strip()
    if status not in OPEN_ROW_STATUSES:
        return {
            ROW_SETTLED: MARK_REFUSED_SETTLED,
            ROW_PARTIALLY_ALLOCATED: MARK_REFUSED_PARTLY,
            ROW_SKIPPED: MARK_REFUSED_SKIPPED,
            ROW_INTERNAL_TRANSFER: MARK_REFUSED_ALREADY,
        }.get(status, MARK_REFUSED_NOT_OPEN.format(status=status or "in no known state"))
    owned = own_import_refusal(source=source, direction=direction, row_status=status, import_batch=import_batch)
    if owned:
        return owned
    if own_place(source) is None:
        return MARK_REFUSED_SOURCE.format(source=(source or "").strip() or "blank-source")
    return None


def other_end_refusal(source: str | None, other_end: str | None) -> str | None:
    """Why `other_end` cannot be the far end of this line's transfer, or `None` when it can."""
    own = own_place(source)
    if (other_end or "") not in PLACES or other_end == own:
        return OTHER_END_REFUSED.format(places=", ".join(PLACES), own=own)
    return None


def send_back_refusal(row_status: str | None) -> str | None:
    """Why this line may NOT be sent back to Mismatched, or `None` when it may: only an Internal Transfer line."""
    return None if (row_status or "").strip() == ROW_INTERNAL_TRANSFER else SEND_BACK_REFUSED


def hand_mark_ends(source: str | None, line_direction: str | None, other_end: str, detail: str = "") -> TransferEnds:
    """A hand mark's From and To: money out of the line runs from its own side to `other_end`, money in the other way."""
    own = own_place(source)
    if record_direction(line_direction) == TRANSFER_IN:
        return TransferEnds(other_end, own, (detail or "").strip())
    return TransferEnds(own, other_end, (detail or "").strip())


def hand_mark_detail(
    source: str | None, line_direction: str | None, added_by_raw: str | None, beneficiary_name: str | None
) -> str:
    """The Detail the Mark dialog starts with (owner decision 8a, #1619): on a Cashbook line, the wallet holder --
    the statement's From for money out, its To for money in. Blank on any other line. The person may change it."""
    if (source or "").strip() != CASHBOOK_SOURCE:
        return ""
    holder = beneficiary_name if record_direction(line_direction) == TRANSFER_IN else added_by_raw
    return (holder or "").strip()


def hand_mark_offer(
    *,
    row_status: str | None,
    source: str | None,
    direction: str | None,
    import_batch: str | None,
    added_by_raw: str | None,
    beneficiary_name: str | None,
) -> dict | None:
    """What the Mark dialog offers on this line, or `None` when it may not be marked (`mark_refusal`).

    The server sends it with each row (review finding F1, #1619), so the screen keeps no copy of the places, the
    own-side table or the may-mark rule: `own_place`, the `other_ends` to choose from (every place but the line's own,
    in `PLACES` order) and the `detail` to start with (`hand_mark_detail`). The endpoint asks the same rules again
    under the line's row lock.
    """
    if mark_refusal(row_status=row_status, source=source, direction=direction, import_batch=import_batch):
        return None
    own = own_place(source)
    return {
        "own_place": own,
        "other_ends": [place for place in PLACES if place != own],
        "detail": hand_mark_detail(source, direction, added_by_raw, beneficiary_name),
    }
