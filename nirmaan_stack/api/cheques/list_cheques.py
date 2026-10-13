# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cheque Payments report's list: one row per Cheque (spec #1407).

Matches the data-table contract (`useServerDataTable`'s `apiEndpoint`): it takes the hook's
`filters`, `order_by`, paging and search arguments and returns
`{data, total_count, aggregates, group_by_result}`. Prior art: `api/approvals/get_approval_queue.py`.

Each row is a Cheque with what the table shows: number, bank (`bank_label`: the typed name for
Others), date, status, amount, description, Vendor or typed payee, who made it, the photo, and the
last status change ("by <user> . <date>", from the Cheque's history).

Each row also carries its `lines` (kind, project and its name, PO/WO, payment, amount), oldest first,
so the table can expand a row and show "+N" without a second read.

The summary strip (`aggregates`: count and amount for All, Issued, Cleared, Cancelled), the rows and
the facets (`get_cheque_facets`) all read the same WHERE, so they always agree. The project and PO/WO
filters match a Cheque when ANY of its lines matches (EXISTS on `Cheque Line`), and the Cheque is
still counted once, at its full amount (#1417).

Who: `CHEQUE_ACCESS_PROFILES` (Project Managers are refused).
"""

import json

import frappe
from frappe import _
from frappe.utils import cint, flt

from nirmaan_stack.api.cheques.save_cheque import assert_cheque_access
from nirmaan_stack.services.cheques.rules import CANCELLED, CLEARED, ISSUED

MAX_PAGE_LENGTH = 500
#: The hook asks for every row with `for_export=true` plus `limit_page_length=0`.
EXPORT_MAX_PAGE_LENGTH = 100_000

# One Cheque, flattened. `last` is its newest history row (the "by <user> . <date>" under the status).
_BASE = """
    SELECT c.name, c.creation, c.owner, owner_user.full_name AS owner_name,
           c.cheque_no, c.bank, c.bank_name,
           CASE WHEN c.bank = 'Others' THEN c.bank_name ELSE c.bank END AS bank_label,
           c.cheque_date, c.status, c.amount, c.description,
           c.vendor, v.vendor_name, c.payee_name, c.attachment, c.made_from,
           last.changed_by AS status_changed_by, changer.full_name AS status_changed_by_name,
           last.changed_at AS status_changed_at
    FROM "tabCheques" c
    LEFT JOIN "tabVendors" v ON v.name = c.vendor
    LEFT JOIN "tabUser" owner_user ON owner_user.name = c.owner
    LEFT JOIN LATERAL (
        SELECT h.changed_by, h.changed_at
        FROM "tabCheque Status History" h
        WHERE h.parent = c.name AND h.parenttype = 'Cheques'
        ORDER BY h.idx DESC
        LIMIT 1
    ) last ON TRUE
    LEFT JOIN "tabUser" changer ON changer.name = last.changed_by
"""

# The page's rows also carry their lines. Kept out of `_BASE` so the count and the facets never build them.
_LINES = """
    LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
                   'line_type', l.line_type, 'project', l.project, 'project_name', p.project_name,
                   'record_doctype', l.record_doctype, 'record_name', l.record_name,
                   'payment_doctype', l.payment_doctype, 'payment_name', l.payment_name, 'amount', l.amount
               ) ORDER BY l.idx) AS lines
        FROM "tabCheque Line" l
        LEFT JOIN "tabProjects" p ON p.name = l.project
        WHERE l.parent = q.name AND l.parenttype = 'Cheques'
    ) ln ON TRUE
"""

#: The strip's per-status buckets: `<key>_count` and `<key>_amount` in `aggregates`.
SUMMARY_STATUSES = {"issued": ISSUED, "cleared": CLEARED, "cancelled": CANCELLED}

#: Filters on the Cheque's lines, by Cheque Line column: a Cheque matches when ANY of its lines does.
LINE_FILTERS = {"project", "record_name"}

FILTERABLE = {"name", "status", "bank", "bank_label", "vendor", "payee_name", "made_from", "owner",
              "cheque_date", "creation"} | LINE_FILTERS
DATE_FIELDS = {"cheque_date", "creation"}
SEARCHABLE = {"cheque_no", "name", "bank_label", "vendor_name", "payee_name", "description"}
SORTABLE = {"name", "creation", "cheque_no", "bank_label", "cheque_date", "status", "amount", "vendor_name",
            "payee_name", "owner_name", "status_changed_at"}

_OPERATORS = {"=": "=", "!=": "!=", "like": "ILIKE", "not like": "NOT ILIKE", ">": ">", "<": "<", ">=": ">=",
              "<=": "<="}


def _coerce(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def _date_clause(field, op, value):
    col = f'q."{field}"::date'
    if op == "timespan":
        from frappe.utils.data import get_timespan_date_range

        rng = get_timespan_date_range(str(value).lower().strip())
        if not rng:
            frappe.throw(_("Unsupported timespan: {0}").format(value))
        return f"{col} BETWEEN %s AND %s", [rng[0], rng[1]]
    if op == "between":
        vals = value if isinstance(value, (list, tuple)) else [value, value]
        if len(vals) != 2:
            frappe.throw(_("`Between` needs exactly two dates"))
        return f"{col} BETWEEN %s AND %s", list(vals)
    if op == "is":
        return f"{col} = %s", [value]
    if op in _OPERATORS:
        return f"{col} {_OPERATORS[op]} %s", [value]
    frappe.throw(_("Unsupported filter operator: {0}").format(op))


def _line_clause(field, op, value):
    """A Cheque whose lines name any of the values. Only `=` and `in`: a negated line filter has two
    readings (no line matches / some line differs), and the report offers neither."""
    if op not in ("=", "in"):
        frappe.throw(_("Unsupported filter operator for {0}: {1}").format(field, op))
    values = [v for v in (value if isinstance(value, (list, tuple)) else [value]) if v]
    if not values:
        return "1=0", []
    placeholders = ", ".join(["%s"] * len(values))
    return (
        'EXISTS (SELECT 1 FROM "tabCheque Line" fl WHERE fl.parent = q.name AND fl.parenttype = \'Cheques\' '
        f'AND fl."{field}" IN ({placeholders}))',
        values,
    )


def _build_where(filters, search_term, search_fields):
    """Returns (sql_fragment, params). Identifiers are allowlisted, values bound. An unknown field is
    refused rather than ignored: ignoring it would show more rows than asked for."""
    clauses, params = [], []
    for f in filters or []:
        if not isinstance(f, (list, tuple)) or len(f) < 3:
            continue
        field, op, value = f[0], str(f[1]).lower().strip(), f[2]
        if field not in FILTERABLE:
            frappe.throw(_("Unsupported filter field: {0}").format(field))
        if field in DATE_FIELDS:
            frag, vals = _date_clause(field, op, value)
            clauses.append(frag)
            params.extend(vals)
        elif field in LINE_FILTERS:
            frag, vals = _line_clause(field, op, value)
            clauses.append(frag)
            params.extend(vals)
        elif op in ("in", "not in"):
            values = value if isinstance(value, (list, tuple)) else [value]
            if not values:
                clauses.append("1=0" if op == "in" else "1=1")
                continue
            placeholders = ", ".join(["%s"] * len(values))
            clauses.append(f'q."{field}" {"IN" if op == "in" else "NOT IN"} ({placeholders})')
            params.extend(values)
        elif op in _OPERATORS:
            clauses.append(f'q."{field}" {_OPERATORS[op]} %s')
            params.append(value)
        else:
            frappe.throw(_("Unsupported filter operator: {0}").format(op))

    term = (search_term or "").strip()
    if term:
        fields = [f for f in (search_fields or []) if f in SEARCHABLE] or ["cheque_no"]
        clauses.append("(" + " OR ".join(f'q."{f}"::text ILIKE %s' for f in fields) + ")")
        params.extend([f"%{term}%"] * len(fields))

    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


def _build_order(order_by):
    default = 'q."creation" DESC, q."name" ASC'
    parts = str(order_by or "").replace("`", "").split(",")[0].strip().split()
    if not parts:
        return default
    col = parts[0].split(".")[-1].strip('"')
    if col not in SORTABLE:
        return default
    direction = "DESC" if len(parts) > 1 and parts[1].lower() == "desc" else "ASC"
    return f'q."{col}" {direction} NULLS LAST, q."name" ASC'


def _where(filters, search_term, current_search_fields):
    """The WHERE the rows, the summary and the facets share."""
    filters = _coerce(filters) or []
    if isinstance(filters, dict):
        filters = [[k, "=", v] for k, v in filters.items()]
    search_fields = _coerce(current_search_fields) or []
    if isinstance(search_fields, str):
        search_fields = [search_fields]
    return _build_where(filters, search_term, search_fields)


def _summary(where, params) -> dict:
    """Count and amount of the filtered Cheques, all and per status. A Cheque counts once, at its full
    amount, however many of its lines matched a project or PO/WO filter."""
    columns, status_params = ["COUNT(*)", "COALESCE(SUM(q.amount), 0)"], []
    for status in SUMMARY_STATUSES.values():
        columns += ["COUNT(*) FILTER (WHERE q.status = %s)", "COALESCE(SUM(q.amount) FILTER (WHERE q.status = %s), 0)"]
        status_params += [status, status]
    values = frappe.db.sql(
        f"SELECT {', '.join(columns)} FROM ({_BASE}) q {where}", tuple(status_params) + tuple(params)
    )[0]
    out = {"count": cint(values[0]), "total_amount": flt(values[1])}
    for i, key in enumerate(SUMMARY_STATUSES):
        out[f"{key}_count"] = cint(values[2 + 2 * i])
        out[f"{key}_amount"] = flt(values[3 + 2 * i])
    return out


@frappe.whitelist()
def get_cheques(
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
    """One page of Cheques for the Cheque Payments report.

    `doctype`, `fields` and the hook's other arguments are accepted and ignored: the row shape is
    fixed here. `aggregates` is the summary strip over the whole filtered set: `count`,
    `total_amount`, and `<issued|cleared|cancelled>_count` / `_amount`.
    """
    assert_cheque_access(frappe.session.user)

    where, params = _where(filters, search_term, current_search_fields)
    order = _build_order(order_by)

    exporting = for_export is True or (isinstance(for_export, str) and for_export.lower() == "true")
    if exporting and cint(limit_page_length) == 0:
        page_length = EXPORT_MAX_PAGE_LENGTH
    else:
        page_length = min(cint(limit_page_length) or 50, EXPORT_MAX_PAGE_LENGTH if exporting else MAX_PAGE_LENGTH)

    summary = _summary(where, params)
    rows = frappe.db.sql(
        f"SELECT q.*, ln.lines FROM ({_BASE}) q {_LINES} {where} ORDER BY {order} LIMIT %s OFFSET %s",
        tuple(params) + (page_length, max(cint(limit_start), 0)),
        as_dict=True,
    )
    for row in rows:
        row["amount"] = flt(row.get("amount"))
        row["lines"] = [{**line, "amount": flt(line.get("amount"))} for line in (row.get("lines") or [])]

    return {
        "data": rows,
        "total_count": summary["count"],
        "aggregates": summary,
        "group_by_result": None,
    }


# Facet field -> (the grouped value, its label). Header facets group the Cheques; line facets group
# their lines, counting each Cheque once per value.
_HEADER_FACETS = {
    "status": ('q."status"', 'q."status"'),
    "bank_label": ('q."bank_label"', 'q."bank_label"'),
    "vendor": ('q."vendor"', 'MAX(q."vendor_name")'),
}
_LINE_FACETS = {
    "project": ("l.project", "MAX(p.project_name)"),
    "record_name": ("l.record_name", "l.record_name"),
}


@frappe.whitelist()
def get_cheque_facets(field, filters=None, search_term=None, current_search_fields=None):
    """The values one filter can offer, each with how many of the filtered Cheques carry it.

    `filters` are the table's other filters (the caller leaves this facet's own selection out, or
    ticking one value would hide its siblings). Blank values are not offered. Returns
    `{field, values: [{value, label, count}]}`, most common first.
    """
    assert_cheque_access(frappe.session.user)
    if field not in _HEADER_FACETS and field not in _LINE_FACETS:
        frappe.throw(_("Unsupported facet field: {0}").format(field))

    where, params = _where(filters, search_term, current_search_fields)
    if field in _HEADER_FACETS:
        value, label = _HEADER_FACETS[field]
        source, count = f"({_BASE}) q", "COUNT(*)"
    else:
        value, label = _LINE_FACETS[field]
        source = (
            f"({_BASE}) q "
            "JOIN \"tabCheque Line\" l ON l.parent = q.name AND l.parenttype = 'Cheques' "
            'LEFT JOIN "tabProjects" p ON p.name = l.project'
        )
        count = "COUNT(DISTINCT q.name)"
    rows = frappe.db.sql(
        f"SELECT {value} AS value, {label} AS label, {count} AS cnt FROM {source} {where} "
        f"GROUP BY {value} ORDER BY cnt DESC, value",
        tuple(params),
        as_dict=True,
    )
    values = [
        {"value": r["value"], "label": r["label"] or r["value"], "count": cint(r["cnt"])}
        for r in rows
        if (r["value"] or "").strip()
    ]
    return {"field": field, "values": values}
