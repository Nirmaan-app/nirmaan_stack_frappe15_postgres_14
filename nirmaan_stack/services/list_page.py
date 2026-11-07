# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One page of a list that is a SQL query, not a doctype, in the data-table contract (`useServerDataTable`'s
`apiEndpoint`, prior art `api/payees/list_payees.py`): the hook's `filters`, `order_by`, paging and search in,
`{data, total_count, aggregates, group_by_result}` out.

The query's columns are read as `q."<column>"`. `ListSpec` names which columns may be filtered, searched and sorted;
a filter on any other column, or with an operator the column does not take, is refused rather than ignored, which
would show more rows than asked for. Used by Vendor Invoice Recon -> All Invoices (#1646): the Cashbook, Credit
Card and Porter pills.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import frappe
from frappe import _
from frappe.utils import cint

MAX_PAGE_LENGTH = 500
#: The hook asks for every row with `for_export=true` plus `limit_page_length=0`.
EXPORT_MAX_PAGE_LENGTH = 100_000

_COMPARE = {"=": "=", "!=": "!=", ">=": ">=", "<=": "<="}


@dataclass(frozen=True)
class ListSpec:
    #: Columns a facet filters with `in` / `not in` / `=` / `!=`.
    filterable: frozenset[str]
    #: Date columns: `Between`, `Timespan`, `Is`, `>=`, `<=`.
    dates: frozenset[str]
    #: Columns a search may name (ILIKE); the first is searched when none is named.
    searchable: tuple[str, ...]
    #: Columns a person may sort by, beside the date and filter columns.
    sortable: frozenset[str]
    #: ORDER BY when none (or an unknown column) is asked for; ends in a unique column so pages never overlap.
    default_order: str


def coerce(value):
    """A JSON-encoded argument as the value it encodes; anything else unchanged."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def split_filters(filters, own: set[str]) -> tuple[dict, list]:
    """({field: value} of the `=` filters on the caller's `own` fields, such as a pill's `kind`; the other filters)."""
    filters = coerce(filters) or []
    if isinstance(filters, dict):
        filters = [[k, "=", v] for k, v in filters.items()]
    mine, rest = {}, []
    for f in filters:
        if not isinstance(f, (list, tuple)) or len(f) < 3:
            continue
        field, op, value = f[-3], str(f[-2]).strip(), f[-1]
        if field in own:
            if op != "=":
                frappe.throw(_("The {0} filter takes '=', not {1}.").format(field, op))
            mine[field] = value
        else:
            rest.append([field, op, value])
    return mine, rest


def page(
    spec: ListSpec,
    base_sql: str,
    params: dict,
    filters: list,
    order_by=None,
    limit_start=0,
    limit_page_length=None,
    search_term=None,
    current_search_fields=None,
    for_export=False,
) -> dict:
    """One page of `base_sql` (named `%(…)s` parameters `params`) narrowed by `filters` (from `split_filters`)."""
    clauses, params = [], dict(params)

    def bind(value) -> str:
        key = f"lp{len(params)}"
        params[key] = value
        return f"%({key})s"

    for field, op, value in filters:
        clauses.append(_filter_clause(spec, field, op.lower(), value, bind))
    clauses += _search_clauses(spec, search_term, current_search_fields, bind)

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    total = frappe.db.sql(f"SELECT COUNT(*) FROM ({base_sql}) q{where}", params)[0][0]

    if for_export in (True, 1, "1", "true", "True"):
        length = EXPORT_MAX_PAGE_LENGTH
    else:
        length = min(cint(limit_page_length) or 20, MAX_PAGE_LENGTH)
    data = frappe.db.sql(
        f"SELECT q.* FROM ({base_sql}) q{where} ORDER BY {_order(spec, order_by)} "
        f"LIMIT {length} OFFSET {max(cint(limit_start), 0)}",
        params,
        as_dict=True,
    )
    return {"data": data, "total_count": total, "aggregates": None, "group_by_result": None}


def _filter_clause(spec: ListSpec, field: str, op: str, value, bind) -> str:
    col = f'q."{field}"'
    if field in spec.dates:
        if op == "timespan":
            from frappe.utils.data import get_timespan_date_range

            rng = get_timespan_date_range(str(value).lower().strip())
            if not rng:
                frappe.throw(_("Unsupported timespan: {0}").format(value))
            return f"{col}::date BETWEEN {bind(rng[0])} AND {bind(rng[1])}"
        if op == "between":
            if not isinstance(value, (list, tuple)) or len(value) != 2:
                frappe.throw(_("`Between` needs exactly two dates"))
            return f"{col}::date BETWEEN {bind(value[0])} AND {bind(value[1])}"
        if op == "is":
            return f"{col}::date = {bind(value)}"
        if op in (">=", "<="):
            return f"{col}::date {op} {bind(value)}"
        frappe.throw(_("Unsupported filter operator on {0}: {1}").format(field, op))
    if field not in spec.filterable:
        frappe.throw(_("Unsupported filter field: {0}").format(field))
    if op in ("in", "not in"):
        values = list(value) if isinstance(value, (list, tuple)) else [value]
        if not values:
            return "FALSE" if op == "in" else "TRUE"
        return f"{col} {'IN' if op == 'in' else 'NOT IN'} {bind(tuple(values))}"
    if op in _COMPARE:
        return f"{col} {_COMPARE[op]} {bind(value)}"
    frappe.throw(_("Unsupported filter operator on {0}: {1}").format(field, op))


def _search_clauses(spec: ListSpec, search_term, current_search_fields, bind) -> list[str]:
    term = (search_term or "").strip()
    if not term:
        return []
    fields = coerce(current_search_fields) or []
    if isinstance(fields, str):
        fields = [fields]
    fields = [f for f in fields if f in spec.searchable] or [spec.searchable[0]]
    like = bind(f"%{term}%")
    return ["(" + " OR ".join(f'q."{f}"::text ILIKE {like}' for f in fields) + ")"]


def _order(spec: ListSpec, order_by) -> str:
    parts = str(order_by or "").replace("`", "").split(",")[0].strip().split()
    if parts:
        col = parts[0].split(".")[-1].strip('"')
        if col in spec.sortable | spec.dates | spec.filterable:
            direction = "DESC" if len(parts) > 1 and parts[1].lower() == "desc" else "ASC"
            return f'q."{col}" {direction} NULLS LAST, {spec.default_order}'
    return spec.default_order
