# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Payees page's list: one row per Payee, with how many vendors link to it (#1422, #1434, spec
#1420, ADR-0033).

Matches the data-table contract (`useServerDataTable`'s `apiEndpoint`, prior art
`api/cheques/list_cheques.py`): it takes the hook's `filters`, `order_by`, paging and search arguments
and returns `{data, total_count, aggregates, group_by_result}`.

Rows come from `services/payees/links.PAYEES_WITH_LINKS_SQL`, the Payee module's one definition of
a Payee's links. The page's tab comes as the filter `["tab", "=", <key>]` (the hook refetches on a
filter change, not on a custom parameter): `all`, or `no_vendor` (no vendor links to it: used only for
expenses, or not at all). `aggregates` holds each tab's count over the same search and filters
(`all_count`, `no_vendor_count`), so the pills always agree with the rows.

Search: holder name, account number (also matched with spaces, dashes and leading zeros ignored),
IFSC, Payee ID, or the name or ID of a linked vendor.

Who: `PAYEE_MANAGE_PROFILES` (Admin, Accountant, Accountant Lead).
"""

import json

import frappe
from frappe import _
from frappe.utils import cint

from nirmaan_stack.services.outflow_import.normalize import normalize_account
from nirmaan_stack.services.payees.links import PAYEES_WITH_LINKS_SQL, summary_row
from nirmaan_stack.services.role_profiles import assert_payee_manager

MAX_PAGE_LENGTH = 500
#: The hook asks for every row with `for_export=true` plus `limit_page_length=0`.
EXPORT_MAX_PAGE_LENGTH = 100_000

#: Each tab's condition over a `PAYEES_WITH_LINKS_SQL` row `q`.
TABS = {
    "all": "TRUE",
    "no_vendor": "q.vendors = 0",
}

FILTERABLE = {"name"}
SEARCHABLE = {"account_name", "account_number", "ifsc", "name", "vendor_name"}
SORTABLE = {"name", "creation", "account_name", "account_number", "ifsc", "bank_name", "vendors"}


def _coerce(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def _filter_clauses(filters) -> tuple[str | None, list[str], list]:
    """`(tab, clauses, params)` from the table's filters. The page sends its tab as the filter
    `["tab", "=", <key>]` (the hook refetches on a filter change). The column filter is only `name`,
    with `=`, `!=`, `in` or `not in`; anything else is refused rather than ignored, which
    would show more rows than asked for."""
    filters = _coerce(filters) or []
    if isinstance(filters, dict):
        filters = [[k, "=", v] for k, v in filters.items()]
    tab, clauses, params = None, [], []
    for f in filters:
        if not isinstance(f, (list, tuple)) or len(f) < 3:
            continue
        field, op, value = f[-3], str(f[-2]).lower().strip(), f[-1]
        if field == "tab":
            if op != "=" or value not in TABS:
                frappe.throw(_("Unknown tab: {0}").format(value))
            tab = value
            continue
        if field not in FILTERABLE:
            frappe.throw(_("Unsupported filter field: {0}").format(field))
        if op in ("in", "not in"):
            values = list(value) if isinstance(value, (list, tuple)) else [value]
            if not values:
                clauses.append("1=0" if op == "in" else "1=1")
                continue
            clauses.append(f'q."{field}" {"IN" if op == "in" else "NOT IN"} ({", ".join(["%s"] * len(values))})')
            params.extend(values)
        elif op in ("=", "!="):
            clauses.append(f'q."{field}" {op} %s')
            params.append(value)
        else:
            frappe.throw(_("Unsupported filter operator: {0}").format(op))
    return tab, clauses, params


def _search_clause(search_term, current_search_fields) -> tuple[list[str], list]:
    term = (search_term or "").strip()
    if not term:
        return [], []
    fields = _coerce(current_search_fields) or []
    if isinstance(fields, str):
        fields = [fields]
    fields = [f for f in fields if f in SEARCHABLE] or ["account_name"]
    like = f"%{term}%"
    parts, params = [], []
    for field in fields:
        if field == "vendor_name":
            parts.append(
                'EXISTS (SELECT 1 FROM "tabVendors" sv WHERE sv.payee = q.name '
                "AND (sv.vendor_name ILIKE %s OR sv.name ILIKE %s))"
            )
            params += [like, like]
        elif field == "account_number":
            parts.append("(q.account_number ILIKE %s OR q.normalized_account ILIKE %s)")
            params += [like, f"%{normalize_account(term).upper()}%"]
        else:
            parts.append(f'q."{field}" ILIKE %s')
            params.append(like)
    return ["(" + " OR ".join(parts) + ")"], params


def _build_order(order_by) -> str:
    default = 'q."creation" DESC, q."name" ASC'
    parts = str(order_by or "").replace("`", "").split(",")[0].strip().split()
    if not parts:
        return default
    col = parts[0].split(".")[-1].strip('"')
    if col not in SORTABLE:
        return default
    direction = "DESC" if len(parts) > 1 and parts[1].lower() == "desc" else "ASC"
    return f'q."{col}" {direction} NULLS LAST, q."name" ASC'


def _where(clauses: list[str]) -> str:
    return (" WHERE " + " AND ".join(clauses)) if clauses else ""


@frappe.whitelist()
def get_payees(
    doctype=None,
    fields=None,
    filters=None,
    order_by=None,
    limit_start=0,
    limit_page_length=None,
    search_term=None,
    current_search_fields=None,
    for_export=False,
    **kwargs,
):
    """One page of Payees in the tab `filters` names (`["tab", "=", "all" | "no_vendor"]`; no tab
    means every Payee).

    `doctype`, `fields` and the hook's other arguments are accepted and ignored: the row shape is
    fixed here, as `services/payees/links.summary_row`. `aggregates` holds `count` (every Payee) and
    `<all|no_vendor>_count`, over the search and filters but not the tab.
    """
    assert_payee_manager(frappe.session.user)

    tab, filter_clauses, filter_params = _filter_clauses(filters)
    search_clauses, search_params = _search_clause(search_term, current_search_fields)
    base_clauses, base_params = filter_clauses + search_clauses, filter_params + search_params
    source = f"({PAYEES_WITH_LINKS_SQL}) q"

    counts = frappe.db.sql(
        f"SELECT COUNT(*), {', '.join(f'COUNT(*) FILTER (WHERE {cond})' for cond in TABS.values())} "
        f"FROM {source}{_where(base_clauses)}",
        tuple(base_params),
    )[0]
    aggregates = {"count": cint(counts[0])}
    for i, key in enumerate(TABS):
        aggregates[f"{key}_count"] = cint(counts[1 + i])

    exporting = for_export is True or (isinstance(for_export, str) and for_export.lower() == "true")
    if exporting and cint(limit_page_length) == 0:
        page_length = EXPORT_MAX_PAGE_LENGTH
    else:
        page_length = min(cint(limit_page_length) or 50, EXPORT_MAX_PAGE_LENGTH if exporting else MAX_PAGE_LENGTH)

    clauses = base_clauses + ([TABS[tab]] if tab else [])
    rows = frappe.db.sql(
        f"SELECT q.* FROM {source}{_where(clauses)} ORDER BY {_build_order(order_by)} LIMIT %s OFFSET %s",
        tuple(base_params) + (page_length, max(cint(limit_start), 0)),
        as_dict=True,
    )
    return {
        "data": [summary_row(row) for row in rows],
        "total_count": aggregates[f"{tab}_count"] if tab else aggregates["count"],
        "aggregates": aggregates,
        "group_by_result": None,
    }
