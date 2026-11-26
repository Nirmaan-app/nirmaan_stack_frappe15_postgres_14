# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Store a card statement's Previous Balance as negative where the statement printed it in credit (#1771).

Until #1771 the card statement reader dropped the `CR` the bank prints after a summary figure in credit, so a
Previous Balance in credit was stored as money owed. Expected on production (2026-11-26): 1 of 16 statements,
CCS-26-00005, 52,423.55 to -52,423.55.

WHICH STATEMENTS
    A statement's own summary adds up: Previous Balance + Purchases / Charges + Cash Advances - Payments / Credits
    = Total Amount Due. A statement is corrected when its stored figures do not add up to its Total Amount Due, and
    do add up to it, to the paisa, once the Previous Balance is negative. One that adds up neither way is left as
    it is.

WHAT IS WRITTEN
    `previous_balance` alone, negated. `modified` is stamped, so the record shows when it changed.

IDEMPOTENT
    A corrected statement adds up, so a second run reads nothing. It prints and returns what it changed.

RAW `set_value`, NOT `doc.save` -- AND WHY SKIPPING THE LIFECYCLE IS CORRECT HERE (CODING_STANDARDS rule 1)
    `Credit Card Statement` has no `doc_events` and an empty controller, and no stored field is derived from the
    Previous Balance: its one reader is the import's Review (`card_import.get_card_import`). A save would add only
    Frappe's own handlers for every doctype (notifications, assignment rules, the Attach field's File check), and
    none of them concerns this figure.
"""

from __future__ import annotations

import frappe

# ⚠️ The doctype and the sum are spelled here, as they were on 2026-11-26 (#1771): a patch is history, and a later
# change to the live card code must not change what it corrects on a site that runs it late.
STATEMENT_DOCTYPE = "Credit Card Statement"

_CREDIT_STORED_AS_OWED_SQL = """
    SELECT name, previous_balance
    FROM "tabCredit Card Statement"
    WHERE ROUND(previous_balance + purchases_charges + cash_advances - payments_credits, 2)
              <> ROUND(total_amount_due, 2)
      AND ROUND(-previous_balance + purchases_charges + cash_advances - payments_credits, 2)
              = ROUND(total_amount_due, 2)
      {only}
    ORDER BY name
"""


def execute():
    correct_previous_balances()


def correct_previous_balances(statements: list[str] | None = None) -> list[str]:
    """Negate the Previous Balance of every statement the module docstring's WHICH STATEMENTS names (only those of
    `statements` when given). Prints each change and returns the statements changed. Does not commit."""
    only = "AND name IN %(statements)s" if statements else ""
    rows = frappe.db.sql(
        _CREDIT_STORED_AS_OWED_SQL.format(only=only), {"statements": tuple(statements or ())}, as_dict=True
    )
    print(f"Card statements whose Previous Balance in credit was stored as owed: {len(rows)}")
    for row in rows:
        # Raw, and safe: no doc_events, and nothing is derived from this figure (the module docstring).
        frappe.db.set_value(STATEMENT_DOCTYPE, row.name, "previous_balance", -row.previous_balance)
        print(f"  {row.name}: {row.previous_balance:.2f} -> {-row.previous_balance:.2f}")
    return [row.name for row in rows]
