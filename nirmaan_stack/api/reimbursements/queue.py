# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Reimbursements page's tabs (ADR-0040 Amendment C): one list call and one count call.

Each step of a claim has its own tab. The claim keeps its four statuses, so an Approved claim's tab is its
Non-Project Expense's status (`rules.claim_tab`; no field or status was added). The tab rules are pure, in
`services/reimbursements/rules.py`; this module only reads.

* `get_claims(tab, ...)` -- one page of a tab, for the shared server data table (`useServerDataTable`'s
  `apiEndpoint`). It adds the tab's condition to the table's own filters and hands the rest -- search, sort,
  paging, export, totals -- to the generic list call, which applies the claim's own read scoping
  (`integrations/controllers/reimbursement`). Each row also carries its expense's ID, status and creation.
* `get_claim_tab_counts()` -- every tab's badge: the number of rows the tab shows (owner, 2026-11-18).

Pending CEO Approval is the CEO's alone (`rules.tab_problem`): anyone else is refused the list and never sent the
count.
"""

from __future__ import annotations

import json

import frappe

from nirmaan_stack.api.data_table.search import get_list_with_count_enhanced_impl
from nirmaan_stack.integrations.controllers.reimbursement import get_permission_query_conditions
from nirmaan_stack.services.expense_decision import is_ceo
from nirmaan_stack.services.reimbursements.convert import LINK_FIELD
from nirmaan_stack.services.reimbursements.rules import (
    APPROVED,
    EXPENSE_STATUS_OF_TAB,
    PAID,
    PENDING,
    TAB_ALL,
    TAB_MINE,
    TAB_PAID,
    TAB_PENDING,
    count_tabs,
    tab_problem,
)

DOCTYPE = "Reimbursement"
NPE = "Non Project Expenses"


@frappe.whitelist()
def get_claims(
    tab,
    doctype=None,
    fields=None,
    filters=None,
    order_by=None,
    limit_start=0,
    limit_page_length=None,
    search_term=None,
    current_search_fields=None,
    aggregates_config=None,
    group_by_config=None,
    for_export=False,
    **kwargs,
) -> dict:
    """One page of the Reimbursements tab `tab`, in the shape the data table reads (`data`, `total_count`,
    `aggregates`, `group_by_result`). `doctype` is accepted and ignored: it is always the claim."""
    user = frappe.session.user
    problem = tab_problem(tab, viewer_is_ceo=is_ceo(user))
    if problem:
        frappe.throw(problem, frappe.PermissionError)

    condition = _tab_condition(tab, user)
    if condition is None:
        return {"data": [], "total_count": 0, "aggregates": {}, "group_by_result": None}

    result = get_list_with_count_enhanced_impl(
        doctype=DOCTYPE,
        fields=fields or ["name"],
        filters=_as_filter_list(filters) + condition,
        order_by=order_by,
        limit_start=limit_start,
        limit_page_length=limit_page_length,
        search_term=search_term,
        current_search_fields=current_search_fields,
        aggregates_config=aggregates_config,
        group_by_config=group_by_config,
        for_export=for_export,
    )
    _attach_expenses(result.get("data") or [])
    return result


@frappe.whitelist()
def get_claim_tab_counts() -> dict:
    """Every tab's badge for the logged-in person, over the claims they may read: `{tab: count}`. The CEO's tab
    is in it only for the CEO."""
    user = frappe.session.user
    scope = get_permission_query_conditions(user)
    # The scoping names `"tabReimbursement"` itself, so the table keeps its own name here (no alias).
    rows = frappe.db.sql(
        f"""
        SELECT "tabReimbursement"."status" AS claim_status,
               e."status" AS expense_status,
               ("tabReimbursement"."owner" = %(user)s) AS mine,
               COUNT(*) AS n
        FROM "tabReimbursement"
        LEFT JOIN "tab{NPE}" e ON e."{LINK_FIELD}" = "tabReimbursement"."name"
        {f"WHERE {scope}" if scope else ""}
        GROUP BY 1, 2, 3
        """,
        {"user": user},
        as_dict=True,
    )
    return count_tabs(rows, viewer_is_ceo=is_ceo(user))


def _tab_condition(tab: str, user: str) -> list | None:
    """The filters that make the list `tab`, or None when no claim can be in it (so nothing is queried)."""
    if tab == TAB_ALL:
        return []
    if tab == TAB_MINE:
        return [["owner", "=", user]]
    if tab == TAB_PENDING:
        return [["status", "=", PENDING]]
    if tab == TAB_PAID:
        return [["status", "=", PAID]]
    names = _approved_claims_whose_expense_is(EXPENSE_STATUS_OF_TAB[tab])
    if not names:
        return None
    return [["status", "=", APPROVED], ["name", "in", names]]


def _approved_claims_whose_expense_is(expense_status: str) -> list[str]:
    """The Approved claims whose expense has `expense_status`. Only claims still in flight are ever here (an
    expense-led tab ends at Paid), so the list stays short; the read scoping is applied afterwards by the list
    call, on the claims themselves."""
    return frappe.db.sql_list(
        f"""
        SELECT e."{LINK_FIELD}"
        FROM "tab{NPE}" e
        JOIN "tab{DOCTYPE}" r ON r."name" = e."{LINK_FIELD}"
        WHERE e."status" = %(expense_status)s AND r."status" = %(approved)s
        """,
        {"expense_status": expense_status, "approved": APPROVED},
    )


def _attach_expenses(rows: list[dict]) -> None:
    """Give each row its expense's ID, status and creation (None before the first approval). One query a page.
    The rows are claims this person may read, so the expense is read for them, as `claims.get_claim_payments`
    does: most claimants can't read Non-Project Expenses."""
    names = [r["name"] for r in rows if r.get("name")]
    # ⚠️ Never query with an empty list: `["in", []]` on the nullable link matches ordinary expenses.
    expenses = {}
    if names:
        for e in frappe.get_all(NPE, filters={LINK_FIELD: ["in", names]},
                                fields=["name", LINK_FIELD, "status", "creation"]):
            expenses[e[LINK_FIELD]] = e
    for r in rows:
        e = expenses.get(r.get("name"))
        r["expense"] = e.name if e else None
        r["expense_status"] = e.status if e else None
        r["expense_created"] = e.creation if e else None


def _as_filter_list(filters) -> list:
    """The table's filters as a list of `[field, op, value]`: it sends a JSON string, a list or a dict."""
    if not filters:
        return []
    if isinstance(filters, str):
        filters = json.loads(filters)
    if isinstance(filters, dict):
        return [[k, "=", v] for k, v in filters.items()]
    return list(filters)
