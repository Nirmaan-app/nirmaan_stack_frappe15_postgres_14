# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Is this payment's split one this import's partial settle made, and is its leftover untouched? (#1279)

PURE MODULE -- no frappe, no DB (ADR-0010 B1). The split questions `unreconcile.leg_verdict` asks on a
payment leg, kept apart so that module stays one concern per file. It answers in facts and sentences;
the verdict is still `leg_verdict`'s.

WHICH SPLIT IS "THIS SETTLE'S" IS DECIDED ON TIME. `expenses.settle_row_partial` writes the balance and
the leg in ONE request, balance first, so the balance is created no more than `CREATED_WINDOW_SECONDS`
before the leg's `matched_at`. A CEO partial approval's balance is days older; a split minted after the
match cannot be this settle's. ⚠️ EVERY DOUBT (a missing time) IS "NOT THIS SETTLE'S", which keeps the old
refusal -- joining a CEO decision's two halves back together on a guess is the one mistake to avoid.
`api/outflow_import/test_unreconcile_part_payment` pins the real settle landing inside the window.

"UNTOUCHED" IS FOUR FACTS, ASKED IN THIS ORDER: no Settled leg on the leftover; no TDS (the legacy figure
or a deduction row, which nets the amount with no Version); still Approved; and nothing edited since its
creation -- a Version touching a field outside `LEFTOVER_WRITTEN_FIELDS`, or an amount that is not the one
it was created with. ⚠️ THE AMOUNT IS JUDGED BY VALUE, NOT BY VERSION: a transfer that part-settled the
leftover and was then unreconciled leaves `amount` Versions behind while putting the figure back exactly,
and refusing that would make "Unreconcile that transfer first" a dead end. An X1 rewrite that stayed
(Ruling O) is a different figure, and is refused -- restoring it would break the sum the split kept.
"""

from dataclasses import dataclass
from datetime import datetime

from nirmaan_stack.services.outflow_import.normalize import normalize_amount

#: A record minted in the same request as its leg is written within this many seconds before it. Shared
#: by the back-fill rule for created expenses (#1278) and the split questions here (#1279). On the local
#: database every created leg was 0-5 s apart and every hand Link minutes to days (2026-09-15).
CREATED_WINDOW_SECONDS = 60

#: The fields a settle of a payment and the revert that undoes it write (`settle.settle_payment`,
#: `api/outflow_import/unreconcile._revert_payment`). A leftover's Version touching only these is a
#: transfer paying it and being unreconciled -- never a person editing it.
LEFTOVER_WRITTEN_FIELDS = frozenset({"status", "utr", "payment_date", "payment_attachment"})

#: The refusal title a screen shows as "Can't be undone yet." -- it becomes undoable once the other
#: transfer is unreconciled. `unreconcileView.ts` mirrors it.
LEFTOVER_PAID_TITLE = "Leftover paid"

_APPROVED = "Approved"
_FIX_ON_PAYMENTS_SCREEN = "the Payments screen"

__all__ = [
    "CREATED_WINDOW_SECONDS",
    "LEFTOVER_PAID_TITLE",
    "LEFTOVER_WRITTEN_FIELDS",
    "SplitChild",
    "is_balance_of_a_part_settle",
    "leftover_of_this_settle",
    "leftover_refusal",
    "minted_for_the_match",
]


@dataclass(frozen=True)
class SplitChild:
    """A payment whose `split_from` is the leg's target, as the un-split question reads it."""

    name: str
    created: datetime | None = None
    amount: object = None
    # Its amount when it was created: the oldest `amount` Version's old value, else `amount`.
    created_amount: object = None
    status: str | None = None
    # The legacy `Project Payments.tds` figure.
    tds: object = None
    # A `Payment TDS Deduction` row names it.
    tds_deducted: bool = False
    # When the earliest Settled leg on it was matched, or `None` when nothing settles it now.
    paid_on: datetime | None = None
    # `(when, fieldnames)` per Version row, any order.
    versions: tuple = ()
    # A PO payment term links to it -- the one the un-split folds back into the original's.
    has_term: bool = False


def minted_for_the_match(created: datetime | None, matched_at: datetime | None) -> bool:
    """Whether a record created at `created` was written in the same request as a leg matched at
    `matched_at`. Unknown either side is `False`."""
    if created is None or matched_at is None:
        return False
    return 0 <= (matched_at - created).total_seconds() <= CREATED_WINDOW_SECONDS


def leftover_of_this_settle(matched_at: datetime | None, children) -> SplitChild | None:
    """The split child the leg's own partial settle minted, or `None`."""
    return next((c for c in children if minted_for_the_match(c.created, matched_at)), None)


def is_balance_of_a_part_settle(created: datetime | None, parent_settled_at) -> bool:
    """Whether a payment carrying `split_from` is the leftover of a partial settle of its parent that
    still stands: a Settled leg on the parent was matched in the request that created it.

    ⚠️ ONLY SUCH A BALANCE REVERTS LIKE ANY PAYMENT. "Unreconcile that transfer first" sends the reviewer
    here, and refusing would be a dead end; every other balance (a CEO partial approval's) keeps the old
    "Part of a split payment" refusal.
    """
    return any(minted_for_the_match(created, when) for when in parent_settled_at)


def leftover_refusal(leftover: SplitChild) -> tuple | None:
    """`(title, reason, fix_at)` for a leftover that is not untouched, or `None` when it is."""
    name = leftover.name
    if leftover.paid_on is not None:
        return (
            LEFTOVER_PAID_TITLE,
            f"Its leftover {name} was paid by another transfer on "
            f"{leftover.paid_on.strftime('%d-%b-%Y')}. Unreconcile that transfer first.",
            None,
        )
    if normalize_amount(leftover.tds) or leftover.tds_deducted:
        return (
            "Leftover taxed",
            f"Its leftover {name} has TDS on it. Fix the tax on the Payments screen first.",
            _FIX_ON_PAYMENTS_SCREEN,
        )
    if (leftover.status or "").strip() != _APPROVED:
        return (
            "Leftover changed",
            f"Its leftover {name} is '{leftover.status}', not Approved. Fix it on the Payments "
            f"screen first.",
            _FIX_ON_PAYMENTS_SCREEN,
        )
    edited_on = _first_edit(leftover)
    if edited_on is not None:
        return (
            "Leftover edited",
            f"Its leftover {name} was edited on {edited_on.strftime('%d-%b-%Y')}, after the split. "
            f"Fix it on the Payments screen first.",
            _FIX_ON_PAYMENTS_SCREEN,
        )
    return None


def _first_edit(leftover: SplitChild) -> datetime | None:
    """The earliest Version after creation that counts as an edit -- see the module docstring."""
    created_amount = leftover.amount if leftover.created_amount is None else leftover.created_amount
    same_amount = normalize_amount(leftover.amount) == normalize_amount(created_amount)
    ignored = LEFTOVER_WRITTEN_FIELDS | ({"amount"} if same_amount else frozenset())
    edits = sorted(
        when
        for when, fields in leftover.versions
        if (leftover.created is None or when > leftover.created)
        and any(field not in ignored for field in fields)
    )
    return edits[0] if edits else None
