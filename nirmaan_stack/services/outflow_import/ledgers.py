# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The three ledgers this feature settles, and what it may settle them from (slice V1).

PURE MODULE -- no `frappe`, no database, no request context. It holds vocabulary, not behaviour.

WHY IT EXISTS. `candidates.py` decides what a bank row may be OFFERED and `settle.py` decides what
it may WRITE, and until v3 each carried its own copy of the settleable-status list. Two copies of
one rule is how one gets tightened and the other does not -- and here the failure mode is that the
screen refuses to offer a record the write path would happily have paid, or worse, the reverse.
ADR-0010 B1/B2: a rule the business names gets ONE owner.

THE RULE, and it is an owner ruling, not an implementation detail (Q3, 2026-08-06):

    APPROVED ONLY. All three ledgers. No exception.

⚠️ THE NON-PROJECT EXCEPTION IS GONE. v2 accepted `Requested` on `Non Project Expenses`, reasoning
that the doctype has no separate approval step in practice so an Approved-only pool would be empty.
The owner overruled it: the import PAYS what someone has already approved, and "the queue is empty"
is not a reason to pay something nobody approved. An empty pool is the correct answer when nothing
is approved -- 7 live `Requested` non-project expenses now stay out of reach of this import, and
they are approved in the expense screen exactly as they always were.

⚠️ NOTHING HERE FILTERS BY `Paid`. An already-Paid record is not a settle candidate at all; it is a
DUPLICATE FINDING, loaded by a separate query (`candidates.load_paid_payments_by_reference`) and
turned into a Skip by `status.derive_row_outcome`. Keeping the two apart is deliberate -- see
owner ruling Q14 -- and a `Paid` entry appearing in the map below would silently make this import
able to re-pay money that has already gone out.
"""

from __future__ import annotations

__all__ = [
    "PAYMENT_DOCTYPE",
    "PROJECT_EXPENSE_DOCTYPE",
    "NON_PROJECT_EXPENSE_DOCTYPE",
    "EXPENSE_DOCTYPES",
    "LEDGER_DOCTYPES",
    "SETTLEABLE_STATUSES",
    "PAID",
    "APPROVED",
    "settleable_statuses",
    "is_expense_doctype",
]

PAYMENT_DOCTYPE = "Project Payments"
PROJECT_EXPENSE_DOCTYPE = "Project Expenses"
NON_PROJECT_EXPENSE_DOCTYPE = "Non Project Expenses"

APPROVED = "Approved"
PAID = "Paid"

# The two ledgers the import may CREATE a record in. A `Project Payment` is born from a PO or SR
# request and the import must never mint one -- that is half the v3 spine, and the reason this
# tuple is not simply "every ledger".
EXPENSE_DOCTYPES = (PROJECT_EXPENSE_DOCTYPE, NON_PROJECT_EXPENSE_DOCTYPE)

# Every ledger the import may SETTLE. All three, since the v3 reversal.
LEDGER_DOCTYPES = (PAYMENT_DOCTYPE, *EXPENSE_DOCTYPES)

# THE single source of the Approved-only rule. Read by `candidates.py` (what may be offered) and by
# `settle.py` (what may be written), so the two can never disagree about the same record.
SETTLEABLE_STATUSES: dict[str, tuple[str, ...]] = {
    PAYMENT_DOCTYPE: (APPROVED,),
    PROJECT_EXPENSE_DOCTYPE: (APPROVED,),
    NON_PROJECT_EXPENSE_DOCTYPE: (APPROVED,),
}


def settleable_statuses(doctype: str) -> tuple[str, ...]:
    """The statuses this import may settle a record of `doctype` from.

    Returns an empty tuple for anything that is not one of the three ledgers, so a caller that
    forgets to check gets "nothing is settleable" rather than a KeyError in a write path.
    """
    return SETTLEABLE_STATUSES.get(doctype, ())


def is_expense_doctype(doctype: str) -> bool:
    """Whether the import may CREATE a record here. Never true for `Project Payments`."""
    return doctype in EXPENSE_DOCTYPES
