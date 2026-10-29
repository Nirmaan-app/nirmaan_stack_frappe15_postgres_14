# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The claimants' month totals the approve screens show (owner, 2026-10-28, ADR-0040 Amendment B).

Read by the Reimbursements approve dialog (by claim) and by Payments' single and bulk approve (by expense). The
total itself is `services/reimbursements/month_total.py`; what it means is `rules.over_monthly_limit`. Every
approver who sees it -- HR, Admin (L1, the CEO) -- already sees every claim, so this is open to exactly those who
see every claim (`access.sees_all_claims`: Admin, HR, Accounts).
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.api.reimbursements.claims import as_list
from nirmaan_stack.services.reimbursements.access import sees_all_claims
from nirmaan_stack.services.reimbursements.month_total import month_totals, month_totals_of_expenses

#: The most names one call may ask about: a bulk approve's selection, with room to spare.
MAX_NAMES = 500


def _names(value) -> list[str]:
    names = [str(v) for v in as_list(value)]
    if len(names) > MAX_NAMES:
        frappe.throw(_("Ask about at most {0} at a time.").format(MAX_NAMES))
    return names


@frappe.whitelist()
def get_month_totals(claims=None, expenses=None) -> list[dict]:
    """The month total of each named claim, or of each named Non-Project Expense's claim.

    Args:
        claims: JSON list of Reimbursement names.
        expenses: JSON list of Non-Project Expense names; an expense not created from a claim is left out.

    Returns one row per claim (or expense) found:
        `{claim, expense, claimant, claimant_name, month, amount, month_total, claims, over_limit}` --
        `month` is the first day of the claim's month (`YYYY-MM-DD`), `amount` the claim's own, `claims` how many
        claims make up `month_total` (this one included). `expense` is null for a row asked about by claim.
    """
    if not sees_all_claims(frappe.session.user):
        frappe.throw(_("Only HR, Admin and Accounts can see reimbursement totals."), frappe.PermissionError)
    rows = [{**row, "expense": None} for row in month_totals(_names(claims)).values()]
    rows += list(month_totals_of_expenses(_names(expenses)).values())
    return rows
