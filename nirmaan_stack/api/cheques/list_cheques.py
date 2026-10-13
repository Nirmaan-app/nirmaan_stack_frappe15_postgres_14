# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cheque Payments report's list: one row per Cheque (spec #1407).

Matches the data-table contract (`useServerDataTable`'s `apiEndpoint`): it takes the hook's
`filters`, `order_by`, paging and search arguments and returns
`{data, total_count, aggregates, group_by_result}`. Prior art: `api/approvals/get_approval_queue.py`.

Each row is a Cheque with what the table shows: number, bank (`bank_label`: the typed name for
Others), date, status, amount, description, Vendor or typed payee, who made it, the photo, and the
last status change ("by <user> . <date>", from the Cheque's history).

Who: `CHEQUE_ACCESS_PROFILES` (Project Managers are refused).

#1417 adds the summary by status, the project / PO-WO filters (matched on any line with EXISTS)
and the facets, over the same WHERE.
"""

import json

import frappe
from frappe import _
from frappe.utils import cint, flt

from nirmaan_stack.api.cheques.save_cheque import assert_cheque_access

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

FILTERABLE = {"name", "status", "bank", "bank_label", "vendor", "payee_name", "made_from", "owner",
              "cheque_date", "creation"}
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
    fixed here. `aggregates` carries the count and amount of the whole filtered set.
    """
    assert_cheque_access(frappe.session.user)

    filters = _coerce(filters) or []
    if isinstance(filters, dict):
        filters = [[k, "=", v] for k, v in filters.items()]
    search_fields = _coerce(current_search_fields) or []
    if isinstance(search_fields, str):
        search_fields = [search_fields]

    where, params = _build_where(filters, search_term, search_fields)
    order = _build_order(order_by)

    exporting = for_export is True or (isinstance(for_export, str) and for_export.lower() == "true")
    if exporting and cint(limit_page_length) == 0:
        page_length = EXPORT_MAX_PAGE_LENGTH
    else:
        page_length = min(cint(limit_page_length) or 50, EXPORT_MAX_PAGE_LENGTH if exporting else MAX_PAGE_LENGTH)

    count, total_amount = frappe.db.sql(
        f"SELECT COUNT(*), COALESCE(SUM(q.amount), 0) FROM ({_BASE}) q {where}", tuple(params)
    )[0]
    rows = frappe.db.sql(
        f"SELECT * FROM ({_BASE}) q {where} ORDER BY {order} LIMIT %s OFFSET %s",
        tuple(params) + (page_length, max(cint(limit_start), 0)),
        as_dict=True,
    )
    for row in rows:
        row["amount"] = flt(row.get("amount"))

    return {
        "data": rows,
        "total_count": cint(count),
        "aggregates": {"total_amount": flt(total_amount), "count": cint(count)},
        "group_by_result": None,
    }
