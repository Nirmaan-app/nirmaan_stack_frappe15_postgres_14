# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What the Cashbook plan does with a Collect payment (#1595, spec #1585 "Planning (pure module)").

PURE MODULE -- no `frappe`, no database. `cashbook.plan_statement` asks it of every line whose statement Type is
`Collect Payment`.

A *Collect payment* (GLOSSARY) is a line where a shop asked for money and the employee approved it. Money left
the company, so it is never "own balances"; it may not be a company spend, so it is never created on its own.
A successful one is an OPEN line: staged at `Mismatched`, which the job never takes, highlighted on Review,
and decided by a person on the main table (Create expense or Skip by hand). It carries the plan's placement
(ledger, expense type, project) so Create opens pre-filled like a wallet spend.

One refunded in full on the same statement needs no decision: the refund pairing (`cashbook_refunds`, #1594)
skips both lines, and that runs after this rule.
"""

from __future__ import annotations

__all__ = ["COLLECT_ROW_KIND", "COLLECT_PAYMENT_NOTE", "is_collect_payment"]

# The statement's `Type` for a Collect payment.
COLLECT_ROW_KIND = "Collect Payment"

# The open line's note: what Review highlights and what the main table shows on the line.
COLLECT_PAYMENT_NOTE = "Shop-requested payment, check it."


def is_collect_payment(raw) -> bool:
    """Whether a parsed line (`parser.RawRow`) is a Collect payment, by its statement Type."""
    return (getattr(raw, "row_kind", "") or "").strip() == COLLECT_ROW_KIND
