"""Reading APPROVED records across the three ledgers, in one shape.

WHY THIS MODULE EXISTS. Three doctypes hold the money this import settles, and they are NOT twins --
`review._search_one_ledger`'s docstring says so in as many words, and keeps three separate queries
rather than one parametrised one precisely so the asymmetries stay visible. That was right while one
endpoint needed them. A second surface now does (the Approved tab), and a second copy of "which
columns does a Non Project Expense not have" is how the two would come to disagree about the same
record.

⚠️ SO THIS IS ONE PLACE THAT KNOWS THE ASYMMETRIES, NOT ONE QUERY THAT HIDES THEM. Each ledger keeps
its own `LedgerSource` -- its joins, its amount expression, its date expression, its searchable
columns -- written out in full. What is shared is the SHAPE every row comes back in, so a caller can
put all three in one table without asking which ledger it is holding.

THE THREE ASYMMETRIES, EACH OF WHICH HAS ALREADY CAUSED A DEFECT:

1. ⚠️ ONLY `Project Payments` HAS AN APPROVAL DATE. Not a field, not an approver, nothing on either
   expense doctype. So `approved_on` and `updated_on` are SEPARATE KEYS and a row fills exactly one:
   a modification timestamp is not an approval and must never be rendered as one (owner ruling
   2026-08-06). Merging them into a single column would present a modification as an approval on 82
   of the 1,164 approved records.

2. ⚠️ `Project Expenses.amount` IS A DATA COLUMN OF NUMERIC STRINGS while the other two are real
   Currency. Sorting or totalling it needs a cast, and a cast throws on junk -- taking the whole page
   down, not one row. There is no junk today (measured: zero non-numeric rows) but the column permits
   it, so the cast is REGEX-GUARDED and a bad value yields NULL. A record with an unreadable amount
   still appears, with a blank where the number would be; it does not vanish, and it does not 500.

3. ⚠️ `Non Project Expenses` HAS NO VENDOR AND NO PROJECT COLUMN AT ALL. Selecting either is a hard
   SQL error, not a blank -- which is why the literal NULLs below are spelled out rather than the
   columns being omitted. Two of the six columns are structurally empty for that ledger; that is a
   rendering decision for the caller, not a gap to fill in.
"""

from __future__ import annotations

from dataclasses import dataclass

import frappe

from nirmaan_stack.services.outflow_import.ledgers import settleable_statuses

__all__ = [
    "LEDGER_SOURCES",
    "LedgerSource",
    "approved_rows",
    "approved_count",
    "approved_projects",
    "SORTABLE",
]

PAYMENT = "Project Payments"
PROJECT_EXPENSE = "Project Expenses"
NON_PROJECT_EXPENSE = "Non Project Expenses"

# ⚠️ REGEX-GUARDED, NOT `NULLIF(btrim(...), '')`. The blank guard stops an EMPTY string; it does not
# stop `"n/a"`, and `CAST('n/a' AS numeric)` fails the whole statement. See asymmetry 2.
_PROJECT_EXPENSE_AMOUNT = (
    "CASE WHEN btrim(e.amount) ~ '^-?[0-9]+(\\.[0-9]+)?$' "
    "THEN CAST(btrim(e.amount) AS numeric) ELSE NULL END"
)


@dataclass(frozen=True)
class LedgerSource:
    """One ledger's half of the shared shape.

    `select` must produce EXACTLY the shared column list, in order, so the three can be `UNION ALL`ed
    into one sorted, paged result. A column a ledger does not have is spelled `NULL AS x` rather than
    dropped -- see asymmetry 3.
    """

    doctype: str
    select: str
    frm: str
    search_columns: tuple[str, ...]
    amount_expr: str
    sort_date_expr: str
    status_expr: str
    """The ledger's own status column — `p.status` in one, `n.status` in another."""
    project_expr: str = ""
    """How this ledger names a project, or `""` when it has none at all (asymmetry 3)."""


LEDGER_SOURCES: dict[str, LedgerSource] = {
    PAYMENT: LedgerSource(
        doctype=PAYMENT,
        select="""
            'Project Payments' AS target_doctype, p.name, p.amount, p.status,
            v.vendor_name, COALESCE(pr.project_name, p.project) AS project_name,
            p.document_type AS order_doctype, p.document_name AS order_name,
            NULL AS expense_type,
            COALESCE(p.ceo_approval_date, p.approval_date) AS approved_on,
            NULL::timestamp AS updated_on
        """,
        # LEFT joins, never inner: a payment whose vendor or project link is broken must still be
        # listed. Dropping it would hide an approved record for a reason invisible on the screen.
        frm='''"tabProject Payments" p
               LEFT JOIN "tabVendors" v ON v.name = p.vendor
               LEFT JOIN "tabProjects" pr ON pr.name = p.project''',
        search_columns=(
            "p.name",
            "v.vendor_name",
            "p.document_name",
            "pr.project_name",
            "p.project",
        ),
        amount_expr="p.amount",
        sort_date_expr="COALESCE(p.ceo_approval_date, p.approval_date, p.modified)",
        status_expr="p.status",
        project_expr="COALESCE(pr.project_name, p.project)",
    ),
    PROJECT_EXPENSE: LedgerSource(
        doctype=PROJECT_EXPENSE,
        select=f"""
            'Project Expenses' AS target_doctype, e.name, {_PROJECT_EXPENSE_AMOUNT} AS amount,
            e.status, v.vendor_name, COALESCE(pr.project_name, e.projects) AS project_name,
            NULL AS order_doctype, NULL AS order_name,
            e.type AS expense_type,
            NULL::timestamp AS approved_on,
            e.modified AS updated_on
        """,
        frm='''"tabProject Expenses" e
               LEFT JOIN "tabVendors" v ON v.name = e.vendor
               LEFT JOIN "tabProjects" pr ON pr.name = e.projects''',
        search_columns=(
            "e.name",
            "e.description",
            "e.type",
            "v.vendor_name",
            "pr.project_name",
            "e.projects",
        ),
        amount_expr=_PROJECT_EXPENSE_AMOUNT,
        sort_date_expr="e.modified",
        status_expr="e.status",
        project_expr="COALESCE(pr.project_name, e.projects)",
    ),
    NON_PROJECT_EXPENSE: LedgerSource(
        doctype=NON_PROJECT_EXPENSE,
        select="""
            'Non Project Expenses' AS target_doctype, n.name, n.amount, n.status,
            NULL AS vendor_name, NULL AS project_name,
            NULL AS order_doctype, NULL AS order_name,
            n.type AS expense_type,
            NULL::timestamp AS approved_on,
            n.modified AS updated_on
        """,
        frm='"tabNon Project Expenses" n',
        search_columns=("n.name", "n.description", "n.type"),
        amount_expr="n.amount",
        sort_date_expr="n.modified",
        status_expr="n.status",
        # No project column at all -- see asymmetry 3. A project filter EXCLUDES this ledger rather
        # than matching nothing inside it, which is the same answer arrived at honestly.
        project_expr="",
    ),
}

# The sort keys a caller may ask for, mapped to the UNIONed result's own columns.
#
# ⚠️ AN ALLOW-LIST, because a sort key cannot be a bound parameter and is therefore interpolated.
# Never widen this by passing a client string through.
SORTABLE = {
    "amount": "amount",
    "name": "name",
    "vendor_name": "vendor_name",
    "project_name": "project_name",
    # One key over two columns, and it is the honest way to sort a mixed list: whichever date the
    # row actually has. The two stay SEPARATE in the payload -- see asymmetry 1 -- so the screen can
    # still say which one it is showing.
    "decided_on": "COALESCE(approved_on, updated_on)",
}


def _branch(source: LedgerSource, *, search: str, project: str):
    """One ledger's SELECT, already filtered to what may be settled. `None` = this ledger is out.

    ⚠️ EVERY PREDICATE SITS WHERE ITS COLUMNS EXIST -- inside the query, against the ledger's own
    aliases. The first version wrapped the SELECT and filtered outside it, which cannot work: the
    search reads `p.name` and `v.vendor_name`, and neither is visible past the subquery. Filtering
    in place is also what lets the database use an index on `status`.
    """
    statuses = settleable_statuses(source.doctype)
    params: list = [*statuses]
    where = [f"{source.status_expr} IN ({', '.join(['%s'] * len(statuses))})"]

    needle = (search or "").strip().lower()
    if needle:
        where.append(
            "("
            + " OR ".join(
                f"lower(coalesce({c}::text, '')) LIKE %s" for c in source.search_columns
            )
            + ")"
        )
        params.extend([f"%{needle}%"] * len(source.search_columns))

    wanted_project = (project or "").strip()
    if wanted_project:
        # ⚠️ A LEDGER WITH NO PROJECT COLUMN DROPS OUT ENTIRELY rather than contributing an
        # always-false predicate. "Which of these are on project X" has one honest answer for a
        # doctype that does not record a project, and it is none of them.
        if not source.project_expr:
            return None
        where.append(f"coalesce({source.project_expr}, '') = %s")
        params.append(wanted_project)

    sql = f"SELECT {source.select} FROM {source.frm} WHERE {' AND '.join(where)}"
    return sql, params


def _union(doctypes, *, search: str, project: str) -> tuple[str, list]:
    parts, params = [], []
    for doctype in doctypes:
        source = LEDGER_SOURCES.get(doctype)
        if source is None:
            continue
        branch = _branch(source, search=search, project=project)
        if branch is None:
            continue
        sql, branch_params = branch
        parts.append(sql)
        params.extend(branch_params)
    if not parts:
        return "", []
    return " UNION ALL ".join(parts), params


def approved_rows(
    doctypes,
    *,
    search: str = "",
    project: str = "",
    sort_by: str = "decided_on",
    sort_dir: str = "desc",
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """One page of approved records across the given ledgers, newest decision first by default."""
    union, params = _union(doctypes, search=search, project=project)
    if not union:
        return []

    column = SORTABLE.get(sort_by or "", SORTABLE["decided_on"])
    direction = "ASC" if (sort_dir or "").lower() == "asc" else "DESC"

    rows = frappe.db.sql(
        f"""
        SELECT * FROM ({union}) u
        ORDER BY {column} {direction} NULLS LAST, name ASC
        LIMIT %s OFFSET %s
        """,
        tuple(params) + (int(limit), int(offset)),
        as_dict=True,
    )
    return [_shape(r) for r in rows]


def approved_count(doctypes, *, search: str = "", project: str = "") -> dict:
    """How many records and how much money, per ledger and in total, under the same filters."""
    union, params = _union(doctypes, search=search, project=project)
    if not union:
        return {"total": 0, "value": 0.0, "by_ledger": {}}

    rows = frappe.db.sql(
        f"""
        SELECT target_doctype, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS v
        FROM ({union}) u GROUP BY target_doctype
        """,
        tuple(params),
        as_dict=True,
    )
    by_ledger = {r["target_doctype"]: {"count": int(r["n"]), "value": float(r["v"] or 0)} for r in rows}
    return {
        "total": sum(x["count"] for x in by_ledger.values()),
        "value": sum(x["value"] for x in by_ledger.values()),
        "by_ledger": by_ledger,
    }


def approved_projects(doctypes, *, search: str = "") -> list[str]:
    """Every project that has something approved on it, in one DISTINCT query.

    ⚠️ IT MUST NOT BE DERIVED FROM A PAGE OF ROWS, and the first version was. `approved_rows` caps at
    200; there are 332 approved records, so building the filter's options from one page silently
    dropped whichever projects happened to sort past the cap -- a filter that omits options is worse
    than no filter, because the absence looks like "nothing approved on that project".
    """
    union, params = _union(doctypes, search=search, project="")
    if not union:
        return []
    rows = frappe.db.sql(
        f"""
        SELECT DISTINCT project_name FROM ({union}) u
        WHERE COALESCE(project_name, '') <> ''
        ORDER BY project_name ASC
        """,
        tuple(params),
        as_dict=True,
    )
    return [r["project_name"] for r in rows]


def _shape(row: dict) -> dict:
    """The one row shape all three ledgers come back in.

    ⚠️ `amount` MAY BE `None`, and that is not the same as zero. It means the stored value could not
    be read as a number (asymmetry 2). A caller must render the absence, never a 0 -- claiming a
    record costs nothing is a claim, and an unreadable amount is not one.
    """
    amount = row.get("amount")
    return {
        "target_doctype": row.get("target_doctype") or "",
        "name": row.get("name") or "",
        "amount": float(amount) if amount is not None else None,
        "status": row.get("status") or "",
        "vendor_name": row.get("vendor_name") or "",
        "project_name": row.get("project_name") or "",
        "order_doctype": row.get("order_doctype") or "",
        "order_name": row.get("order_name") or "",
        "expense_type": row.get("expense_type") or "",
        # ⚠️ SEPARATE KEYS. Exactly one is ever filled. See asymmetry 1.
        "approved_on": str(row["approved_on"]) if row.get("approved_on") else "",
        "updated_on": str(row["updated_on"]) if row.get("updated_on") else "",
    }
