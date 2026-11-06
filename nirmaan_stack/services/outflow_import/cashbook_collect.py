# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What the Cashbook plan does with a Collect payment (#1595, spec #1585 "Planning (pure module)").

PURE MODULE -- no `frappe`, no database. The rule itself is one branch of `cashbook._decide`; this module holds its
sentence, and re-exports the kind (`cashbook_refunds.COLLECT_ROW_KIND`) for the import-side half
(`api/outflow_import/cashbook_collect`).

A *Collect payment* (GLOSSARY) is a line where a shop asked for money and the employee approved it. Money left
the company, so it is never "own balances"; it may not be a company spend, so it is never created on its own.
A successful one is an OPEN line: staged at `Mismatched`, which the job never takes, highlighted on Review,
and decided by a person on the main table with one of exactly two choices (spec #1585 "Open Cashbook lines"):
Create expense, or Skip by hand -- the latter an Admin's or Accountant Lead's only (story 39). Link, Allocate and
Split are refused on it (`COLLECT_PAYMENT_CHOICES_REFUSAL`); the main table tells such a line by its stored
statement Type (`is_collect_payment_line`). It carries the plan's placement (ledger, expense type, project) so
Create opens pre-filled like a wallet spend.

One refunded in full on the same statement needs no decision: the refund pairing (`cashbook_refunds`, #1594)
skips both lines, and that runs after this rule.
"""

from __future__ import annotations

from nirmaan_stack.services.outflow_import.cashbook_refunds import COLLECT_ROW_KIND
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE

__all__ = [
    "COLLECT_ROW_KIND",
    "COLLECT_PAYMENT_NOTE",
    "COLLECT_PAYMENT_CHOICES_REFUSAL",
    "COLLECT_PAYMENT_SKIP_REFUSAL",
    "is_collect_payment_line",
]

# The open line's note: what Review highlights and what the main table shows on the line.
COLLECT_PAYMENT_NOTE = "Shop-requested payment, check it."

#: What Link, Allocate and Split / Part payment say on a Collect payment: it is created or skipped, never linked.
COLLECT_PAYMENT_CHOICES_REFUSAL = (
    "A Collect payment is decided by Create expense or Skip by hand. It can't be linked to a record, allocated or split."
)

#: What Skip by hand says to anyone but an Admin or an Accountant Lead on a Collect payment (story 39).
COLLECT_PAYMENT_SKIP_REFUSAL = "Only an Admin or an Accountant Lead can skip a Collect payment by hand."


def is_collect_payment_line(source: str | None, row_kind: str | None) -> bool:
    """Whether a staged line is a Collect payment: a Cashbook line whose stored statement Type (`row_kind`) says so.
    Mirrored by the frontend's `outflowImportStatus.isCollectPaymentLine`."""
    return (source or "").strip() == CASHBOOK_SOURCE and (row_kind or "").strip() == COLLECT_ROW_KIND

