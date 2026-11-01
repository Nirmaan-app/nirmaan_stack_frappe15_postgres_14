# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A claimant's MONTH TOTAL (owner, 2026-10-28, ADR-0040 Amendment B): the one query that adds it up.

The month total of a claim is the claim itself plus the claimant's OTHER claims that are Approved or Paid and were
raised in the same calendar month as it (the claim's `creation` month). Pending and Rejected claims don't count.
The claim in hand counts whatever its own status: pending when HR or Admin decide it, Approved when L1 or the CEO
approve its expense in Payments.

Worked out on every read, never stored, so a claim later rejected or deleted simply drops out. What the total
means -- above `rules.MONTHLY_LIMIT` or not -- is `rules.over_monthly_limit`.

* `month_totals(claims)` -- one row per claim found, keyed by claim.
* `month_totals_of_expenses(expenses)` -- the same rows for the Non-Project Expenses created from claims, keyed by
  expense; an expense with no claim is left out.
"""

from __future__ import annotations

import frappe
from frappe.utils import flt

from nirmaan_stack.services.outflow_import.ledgers import NON_PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.reimbursements.rules import APPROVED, PAID, over_monthly_limit

#: The statuses of the OTHER claims that count toward a month total.
COUNTED_STATUSES = (APPROVED, PAID)


def month_totals(claims) -> dict[str, dict]:
    """`{claim: row}` for every named claim that exists. Each row holds:

    `claim`, `claimant` (the owner), `claimant_name`, `month` (the first day of the claim's month, `YYYY-MM-DD`),
    `amount` (this claim's), `month_total`, `claims` (how many claims make up the total, this one included) and
    `over_limit`. One query, however many claims are asked about.
    """
    names = sorted({c for c in (claims or []) if c})
    if not names:
        return {}
    rows = frappe.db.sql(
        """
        SELECT c.name AS claim, c.owner AS claimant,
               COALESCE(c.claimant_name, nu.full_name, c.owner) AS claimant_name,
               TO_CHAR(DATE_TRUNC('month', c.creation), 'YYYY-MM-DD') AS month,
               c.amount AS amount,
               c.amount + COALESCE(SUM(o.amount), 0) AS month_total,
               1 + COUNT(o.name) AS claims
        FROM "tabReimbursement" c
        LEFT JOIN "tabNirmaan Users" nu ON nu.name = c.owner
        LEFT JOIN "tabReimbursement" o
               ON o.owner = c.owner
              AND o.name <> c.name
              AND o.status IN %(counted)s
              AND DATE_TRUNC('month', o.creation) = DATE_TRUNC('month', c.creation)
        WHERE c.name IN %(names)s
        GROUP BY c.name, c.owner, c.claimant_name, nu.full_name, c.creation, c.amount
        """,
        {"names": tuple(names), "counted": COUNTED_STATUSES},
        as_dict=True,
    )
    out = {}
    for row in rows:
        row["amount"] = flt(row.amount)
        row["month_total"] = flt(row.month_total)
        row["claims"] = int(row.claims)
        row["over_limit"] = over_monthly_limit(row.month_total)
        out[row.claim] = row
    return out


def month_totals_of_expenses(expenses) -> dict[str, dict]:
    """`{expense: row}` for every named Non-Project Expense created from a claim: `month_totals`' row for its claim,
    plus `expense`."""
    names = sorted({e for e in (expenses or []) if e})
    if not names:
        return {}
    links = frappe.get_all(
        NON_PROJECT_EXPENSE_DOCTYPE,
        filters={"name": ["in", names], "reimbursement": ["is", "set"]},
        fields=["name", "reimbursement"],
    )
    totals = month_totals([link.reimbursement for link in links])
    out = {}
    for link in links:
        row = totals.get(link.reimbursement)
        if row:
            out[link.name] = {**row, "expense": link.name}
    return out
