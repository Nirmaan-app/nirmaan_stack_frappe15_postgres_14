"""
Unified approval queue — one list across all three money-out ledgers.

`Project Payments`, `Project Expenses` and `Non Project Expenses` stay three
separate doctypes (they always will — a payment carries a PO/SR parent, term
mirroring, TDS and vendor credit; an expense carries none of it). What unifies is
the QUEUE: one amount rule, one status field, one screen.

This endpoint is the union. It matches the data-table contract exactly, so the
frontend plugs it into `useServerDataTable` through its `apiEndpoint` option --
the same way `api/projects/pr_summary.get_pr_summary_list` already does.

It cannot delegate to `get_list_with_count_enhanced_impl`: that reads ONE doctype.
This is a UNION ALL of three normalized projections, filtered / sorted / paged
OVER the union, so sorting by age or amount is correct ACROSS ledgers rather than
per-ledger.

⚠️ THE ONE MEASURED TRAP: `Project Expenses.amount` is a `Data` field --
`character varying` in Postgres -- while it is numeric on the other two. An
unguarded `ORDER BY amount DESC` there returns 999 above 26000, and a lexical
compare would drop a 9,000 expense into the "> 50,000" band. Every read of that
column goes through `_EXPENSE_AMOUNT` below.
"""

import json

import frappe
from frappe import _
from frappe.utils import cint, flt

from nirmaan_stack.services.approval_tiers import (
    TIER_L2_ABOVE,
    TIER_L2_ABOVE_EXPENSES,
    required_tier,
)

MAX_PAGE_LENGTH = 500

# The data-table hook signals "give me everything" with `for_export=true` PLUS
# `limit_page_length=0` -- the convention `api/data_table/search.py` already honours.
# This endpoint used to swallow `for_export` in **kwargs and read the 0 as "unset":
# `cint(0) or 50` is 50, so EVERY export of this queue came back exactly 50 rows long,
# under a green "50 rows exported" toast, against a table showing thousands. A short
# file that announces success is worse than a failed one -- nothing on screen says the
# other 7,500 rows are missing.
#
# Deliberately NOT the same number as MAX_PAGE_LENGTH: 500 is a sane ceiling for a
# rendered PAGE and far too small for a file. Mirrors search.EXPORT_MAX_PAGE_LENGTH.
EXPORT_MAX_PAGE_LENGTH = 100_000

# Ledger -> the label the Source column shows.
SOURCE_VENDOR_PAYMENT = "Vendor Payment"
SOURCE_PROJECT_EXPENSE = "Project Expense"
SOURCE_NON_PROJECT = "Non-Project"

SOURCE_TO_DOCTYPE = {
    SOURCE_VENDOR_PAYMENT: "Project Payments",
    SOURCE_PROJECT_EXPENSE: "Project Expenses",
    SOURCE_NON_PROJECT: "Non Project Expenses",
}

# `Project Expenses.amount` became `Currency` / `numeric(21,9)` on 16 Sep 2026, so all
# three ledgers read the same way and this is a plain column read.
#
# ⚠️ THE REGEX-GUARDED CAST THAT STOOD HERE COULD NOT BE LEFT IN AS BELT AND BRACES:
# `BTRIM()` / `~` against a numeric column is a hard Postgres error, not a no-op, and it
# 500'd this whole endpoint the moment the column changed. The reason it existed still
# applies to any future varchar-amount column: ONE non-numeric row inside a CAST aborts
# the entire statement and blanks the queue, rather than spoiling one line.
_EXPENSE_AMOUNT = 'COALESCE(e."amount", 0)::numeric'

# Columns the union exposes. Filtering and sorting are ALLOWLISTED to these -- the
# values are parameterized, but the identifiers are interpolated, so an allowlist
# is what keeps that safe.
SORTABLE = {
    "name", "source", "status", "amount", "against_primary", "vendor", "project",
    "raised_by", "creation", "approved_on", "paid_on", "utr_ref", "payment_by",
    "expense_type", "doctype",
}

# Date columns get their own operator vocabulary. `creation` is a TIMESTAMP while
# the other two are DATEs, so every comparison casts to ::date -- otherwise
# "Is 06-Apr-2026" matches nothing, because a timestamp is never equal to a date.
DATE_FIELDS = {"creation", "approved_on", "paid_on"}
FILTERABLE = SORTABLE | {"doctype"}
SEARCHABLE = {
    "name", "against_primary", "against_secondary", "vendor", "project",
    "raised_by", "utr_ref",
}

_OPERATORS = {
    "=": "=", "!=": "!=", ">": ">", "<": "<", ">=": ">=", "<=": "<=",
    "like": "ILIKE", "not like": "NOT ILIKE",
}


def _payments_select():
    # `reconciled_on` does not exist on any ledger yet -- it arrives with the
    # writers slice. Selected as NULL so the Paid tab's column is wired from day
    # one and lights up the moment the field lands, with no query change.
    return """
        SELECT
            p."name"                        AS name,
            '{src}'                         AS source,
            'Project Payments'              AS doctype,
            p."status"                      AS status,
            COALESCE(p."amount", 0)::numeric AS amount,
            COALESCE(p."document_name", '')::text AS against_primary,
            ''::text                        AS against_secondary,
            ''::text                        AS against_full,
            COALESCE(p."vendor", '')::text  AS vendor,
            COALESCE(p."project", '')::text AS project,
            p."owner"                       AS raised_by,
            p."creation"                    AS creation,
            p."approval_date"               AS approved_on,
            p."payment_date"                AS paid_on,
            COALESCE(p."utr", '')::text     AS utr_ref,
            COALESCE(p."payment_attachment", '')::text AS proof,
            ''::text                        AS payment_by,
            COALESCE(p."document_type", '')::text AS against_type,
            ''::text                        AS expense_type,
            ''::text                        AS comment_text,
            -- Aliases kept under their PAYMENT names on purpose. The bulk-approve
            -- engine and the action dialogs read exactly six fields off a row
            -- (amount, name, document_name, vendor, document_type, tds), so
            -- carrying these makes the normalized row a SUPERSET of what already
            -- works -- `useBulkPaymentActions` and `PaymentActionDialog` need no
            -- change at all. They are blank on an expense, which is honest: an
            -- expense has no PO or SR parent and never withholds tax.
            COALESCE(p."document_name", '')::text AS document_name,
            COALESCE(p."document_type", '')::text AS document_type,
            COALESCE(p."tds", '')::text     AS tds,
            NULL::date                      AS reconciled_on,
            COALESCE(p."auto_approved", 0)  AS auto_approved
        FROM "tabProject Payments" p
    """.format(src=SOURCE_VENDOR_PAYMENT)


def _expense_select(table, source, project_col):
    """Both expense ledgers share one projection; they differ only in the project
    column -- `projects` (plural) on Project Expenses, nothing at all on
    Non-Project, which is company-wide by definition and renders an honest blank.
    """
    project_expr = f'COALESCE(e."{project_col}", \'\')::text' if project_col else "''::text"
    vendor_expr = 'COALESCE(e."vendor", \'\')::text' if source == SOURCE_PROJECT_EXPENSE else "''::text"
    payment_by_expr = 'COALESCE(e."payment_by", \'\')::text' if source == SOURCE_PROJECT_EXPENSE else "''::text"
    return f"""
        SELECT
            e."name"                        AS name,
            '{source}'                      AS source,
            '{SOURCE_TO_DOCTYPE[source]}'   AS doctype,
            e."status"                      AS status,
            {_EXPENSE_AMOUNT}               AS amount,
            COALESCE(SPLIT_PART(e."description", E'\\n', 1), '')::text AS against_primary,
            -- Line 2 is the expense TYPE, not the comment (owner, 15 Sep). A type is a
            -- stable category a reader recognises ("Labour Charges"); a comment is free
            -- text that is often an abbreviation only its author can read ("hrt"). The
            -- comment is still carried, for the hover.
            COALESCE(e."type", '')::text    AS against_secondary,
            COALESCE(e."description", '')::text AS against_full,
            {vendor_expr}                   AS vendor,
            {project_expr}                  AS project,
            e."owner"                       AS raised_by,
            e."creation"                    AS creation,
            e."approval_date"               AS approved_on,
            e."payment_date"                AS paid_on,
            COALESCE(e."payment_ref", '')::text AS utr_ref,
            COALESCE(e."payment_attachment", '')::text AS proof,
            {payment_by_expr}               AS payment_by,
            ''::text                        AS against_type,
            COALESCE(e."type", '')::text    AS expense_type,
            COALESCE(e."comment", '')::text AS comment_text,
            ''::text                        AS document_name,
            ''::text                        AS document_type,
            ''::text                        AS tds,
            NULL::date                      AS reconciled_on,
            COALESCE(e."auto_approved", 0)  AS auto_approved
        FROM "{table}" e
    """


def _readable_branches():
    """Only union the ledgers this user may read.

    Dropping an unreadable ledger rather than throwing means an Accountant who can
    read payments but not non-project expenses gets a working queue holding what
    they are allowed to see, instead of an error page.
    """
    branches = []
    if frappe.has_permission("Project Payments", "read"):
        branches.append(_payments_select())
    if frappe.has_permission("Project Expenses", "read"):
        branches.append(_expense_select("tabProject Expenses", SOURCE_PROJECT_EXPENSE, "projects"))
    if frappe.has_permission("Non Project Expenses", "read"):
        branches.append(_expense_select("tabNon Project Expenses", SOURCE_NON_PROJECT, None))
    return branches


def _l2_line_for(source) -> float:
    """The CEO threshold for the ledger this row came from.

    One place, so the Tier chip, any future server-side routing and the frontend
    mirror cannot each pick a different number.
    """
    return TIER_L2_ABOVE if source == SOURCE_VENDOR_PAYMENT else TIER_L2_ABOVE_EXPENSES


def _coerce(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


# The DataTable's date control emits these; anything else on a date column falls
# through to the plain operator table below.
_DATE_OPERATORS = {"is", "between", "timespan", "<=", ">=", "<", ">", "=", "!="}


def _date_clause(field, op, value):
    """One date filter -> (sql, params). Raises on a timespan we cannot resolve."""
    col = f'q."{field}"::date'

    if op == "timespan":
        # Frappe owns these words ("last 30 days", "this month", ...); resolving them
        # here rather than re-implementing keeps this control's meaning identical to
        # every other date filter in the app.
        from frappe.utils.data import get_timespan_date_range

        rng = get_timespan_date_range(str(value).lower().strip())
        if not rng:
            frappe.throw(_("Unsupported timespan: {0}").format(value))
        return f"{col} BETWEEN %s AND %s", [rng[0], rng[1]]

    if op == "between":
        vals = value if isinstance(value, (list, tuple)) else [value, value]
        if len(vals) != 2:
            frappe.throw(_("`Between` needs exactly two dates"))
        return f"{col} BETWEEN %s AND %s", [vals[0], vals[1]]

    if op == "is":
        return f"{col} = %s", [value]

    return f"{col} {op} %s", [value]


def _build_where(filters, search_term, search_fields):
    """Returns (sql_fragment, params). Identifiers are allowlisted, values bound."""
    clauses, params = [], []

    for f in filters or []:
        if not isinstance(f, (list, tuple)) or len(f) < 3:
            continue
        field, op, value = f[0], str(f[1]).lower().strip(), f[2]
        if field not in FILTERABLE:
            # Silently ignoring an unknown filter would show MORE rows than asked
            # for -- the same failure mode as a missing case in the tab switch.
            frappe.throw(_("Unsupported filter field: {0}").format(field))
        if field in DATE_FIELDS and op in _DATE_OPERATORS:
            frag, vals = _date_clause(field, op, value)
            clauses.append(frag)
            params.extend(vals)
        elif op == "in" or op == "not in":
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
        fields = [f for f in (search_fields or []) if f in SEARCHABLE] or ["against_primary"]
        ors = " OR ".join([f'q."{f}"::text ILIKE %s' for f in fields])
        clauses.append(f"({ors})")
        params.extend([f"%{term}%"] * len(fields))

    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


def _build_order(order_by):
    default = 'q."creation" DESC'
    if not order_by:
        return default
    parts = str(order_by).replace("`", "").split(",")[0].strip().split()
    if not parts:
        return default
    col = parts[0].split(".")[-1].strip('"')
    direction = "DESC" if len(parts) > 1 and parts[1].lower() == "desc" else "ASC"
    if col not in SORTABLE:
        return default
    # NULLS LAST so a queue sorted by a date half the rows do not carry (paid_on on
    # an unpaid row) does not open on a page of blanks.
    return f'q."{col}" {direction} NULLS LAST, q."name" ASC'


@frappe.whitelist(allow_guest=False)
def get_approval_queue(
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
    """One page of the unified approval queue.

    `doctype` and `fields` are accepted and ignored -- the data-table hook always
    sends them, and the shape here is fixed by the union, not by the caller.
    """
    branches = _readable_branches()
    if not branches:
        frappe.throw(_("Not permitted"), frappe.PermissionError)

    filters = _coerce(filters) or []
    if isinstance(filters, dict):
        filters = [[k, "=", v] for k, v in filters.items()]
    search_fields = _coerce(current_search_fields) or []
    if isinstance(search_fields, str):
        search_fields = [search_fields]

    union = " UNION ALL ".join(branches)
    where, params = _build_where(filters, search_term, search_fields)
    order = _build_order(order_by)

    start = max(cint(limit_start), 0)
    # `for_export` arrives over HTTP as the STRING "true", never a bool -- the same
    # coercion search.py does, for the same reason.
    for_export_bool = (
        for_export is True
        or (isinstance(for_export, str) and for_export.lower() == "true")
    )
    if for_export_bool and cint(limit_page_length) == 0:
        page_length = EXPORT_MAX_PAGE_LENGTH
    else:
        ceiling = EXPORT_MAX_PAGE_LENGTH if for_export_bool else MAX_PAGE_LENGTH
        page_length = min(cint(limit_page_length) or 50, ceiling)

    total = frappe.db.sql(
        f"SELECT COUNT(*) FROM ({union}) q {where}", tuple(params)
    )[0][0]

    rows = frappe.db.sql(
        f"SELECT * FROM ({union}) q {where} ORDER BY {order} LIMIT %s OFFSET %s",
        tuple(params) + (page_length, start),
        as_dict=True,
    )

    # Money totals for the summary line. Computed over the WHOLE filtered set, not
    # the page -- a total that changed when you turned the page would be a lie.
    total_amount = frappe.db.sql(
        f"SELECT COALESCE(SUM(q.\"amount\"), 0) FROM ({union}) q {where}", tuple(params)
    )[0][0]

    for r in rows:
        # Derived SERVER-side, from the same cast amount the routing will use, so
        # the chip on screen and the gate that runs can never disagree.
        #
        # ⚠️ THE TIER IS DERIVED PER-LEDGER even though all three ledgers share the
        # 50,000 CEO line today (owner, 16 Sep 2026). It was briefly 30,000 for the
        # two expense ledgers, and deriving every row against the module default
        # then made a Rs 40,000 expense read `L1` -- "your approval finishes this" --
        # while the approval it triggered forwarded it to the CEO. Keeping the
        # per-source lookup means a future split cannot reopen that gap.
        r["tier"] = required_tier(flt(r.get("amount")), _l2_line_for(r.get("source")))
        r["amount"] = flt(r.get("amount"))
        r["has_proof"] = bool(r.get("proof"))

    return {
        "data": rows,
        "total_count": cint(total),
        "aggregates": {"total_amount": flt(total_amount), "count": cint(total)},
        "group_by_result": None,
    }


@frappe.whitelist(allow_guest=False)
def get_approval_queue_counts():
    """Per-tab counts for the tab strip, in one query per readable ledger."""
    branches = _readable_branches()
    if not branches:
        frappe.throw(_("Not permitted"), frappe.PermissionError)
    union = " UNION ALL ".join(branches)
    rows = frappe.db.sql(
        f'SELECT q."status" AS status, COUNT(*) AS cnt, COALESCE(SUM(q."amount"), 0) AS amt '
        f"FROM ({union}) q GROUP BY q.\"status\"",
        as_dict=True,
    )
    counts = {r["status"] or "": cint(r["cnt"]) for r in rows}
    amounts = {r["status"] or "": flt(r["amt"]) for r in rows}
    counts["All"] = sum(counts.values())
    return {"counts": counts, "amounts": amounts}


# Facet fields the queue offers. `tier` is absent on purpose: it is derived in
# Python from the amount, not stored, so there is nothing in SQL to group by --
# and a closed 3-value set needs no server round trip anyway.
FACETABLE = {"source", "status", "vendor", "project", "doctype", "expense_type"}


@frappe.whitelist(allow_guest=False)
def get_approval_queue_facets(field, filters=None):
    """Distinct values for one facet, counted ACROSS THE UNION.

    The data-table's self-fetching facets read ONE doctype, which on this screen
    would silently offer only vendor-payment values -- no `source` at all, and no
    expense projects -- while the table itself shows all three ledgers. A facet
    that cannot name what is on screen is worse than no facet.
    """
    if field not in FACETABLE:
        frappe.throw(_("Unsupported facet field: {0}").format(field))

    branches = _readable_branches()
    if not branches:
        frappe.throw(_("Not permitted"), frappe.PermissionError)

    union = " UNION ALL ".join(branches)
    where, params = _build_where(_coerce(filters) or [], None, [])

    rows = frappe.db.sql(
        f'SELECT q."{field}" AS value, COUNT(*) AS cnt FROM ({union}) q {where} '
        f'GROUP BY q."{field}" ORDER BY COUNT(*) DESC',
        tuple(params),
        as_dict=True,
    )
    # A blank is a real, meaningful value here (a non-project expense has no
    # project and no vendor) but it cannot be offered as a filter option, so it is
    # reported separately rather than rendered as an empty row in the list.
    values = [
        {"value": r["value"], "count": cint(r["cnt"])}
        for r in rows if (r["value"] or "").strip()
    ]
    blank = sum(cint(r["cnt"]) for r in rows if not (r["value"] or "").strip())
    return {"field": field, "values": values, "blank_count": blank}
