# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What the Cashbook plan does with a Collect payment (#1595, spec #1585 "Planning (pure module)").

PURE MODULE -- no `frappe`, no database. The rule itself is one branch of `cashbook._decide`; this module holds its
sentence, and re-exports the kind (`cashbook_refunds.COLLECT_ROW_KIND`) for the import-side half
(`api/outflow_import/cashbook_collect`).

A *Collect payment* (GLOSSARY) is a line where a shop asked for money and the employee approved it. Money left
the company, so it is never "own balances"; it may not be a company spend, so it is never created on its own.
A successful one is an OPEN line: staged at `Mismatched`, which the job never takes, highlighted on Review,
and decided by a person on the main table (Create expense or Skip by hand). It carries the plan's placement
(ledger, expense type, project) so Create opens pre-filled like a wallet spend.

One refunded in full on the same statement needs no decision: the refund pairing (`cashbook_refunds`, #1594)
skips both lines, and that runs after this rule.
"""

from __future__ import annotations

from nirmaan_stack.services.outflow_import.cashbook_refunds import COLLECT_ROW_KIND

__all__ = ["COLLECT_ROW_KIND", "COLLECT_PAYMENT_NOTE"]

# The open line's note: what Review highlights and what the main table shows on the line.
COLLECT_PAYMENT_NOTE = "Shop-requested payment, check it."

