"""The asset history across all assets, with filters -- Admin and HR only (owner, 2026-10-12), plus the audit
rows for everyone who sees the Asset Audit tab (owner, 2026-10-14).

Reads the `Asset History` child rows (written by `services/asset_history.py`) joined to their asset,
newest first, one page at a time. A whitelisted read rather than the generic list API, because the
history is a child table and access is decided by role profile, which DocPerms cannot express.

- `get_asset_history`: named filters, for the Asset Audit tab's Fulfilled list.
- `get_asset_history_table`: the History tab's data table (`useServerDataTable` with `apiEndpoint`), its filters
  set from the column headers (owner, 2026-10-15).
- `get_asset_history_facets`: the counts beside the History table's header filter choices.
The two row reads go through `_history_rows`, so the query exists once; the table and its counts share
`_table_conditions`, so a count always matches the rows it filters to.
"""

import frappe
from frappe.utils import add_days, cint, getdate
from frappe.utils.data import get_timespan_date_range

from nirmaan_stack.api.data_table.constants import EXPORT_MAX_PAGE_LENGTH, MAX_PAGE_LENGTH
from nirmaan_stack.services.asset_history import AUDIT_REQUESTED, AUDIT_FULFILLED, AUDIT_MISSED
from nirmaan_stack.services.role_profiles import ASSET_AUDIT_VIEW_PROFILES, ASSET_HISTORY_PROFILES, get_role_profile

AUDIT_EVENTS = (AUDIT_REQUESTED, AUDIT_FULFILLED, AUDIT_MISSED)

_BASE_CONDITIONS = ("h.parenttype = 'Asset Master'", "h.parentfield = 'asset_history'")
_SOURCE = (
    'from "tabAsset History" h join "tabAsset Master" m on m.name = h.parent'
    ' left join "tabAsset Category" c on c.name = m.asset_category'
)
_NEWEST_FIRST = "h.done_on desc, h.idx desc"

# The History table's header filters: a column -> the SQL it filters ("in" a list of picked values).
_TABLE_FACETS = {"event": "h.event", "assigned_to": "h.assigned_to", "done_by": "h.done_by"}
# The columns the History table can sort on.
_TABLE_SORTS = {
    "done_on": "h.done_on",
    "event": "h.event",
    "assigned_to": "h.assigned_to",
    "done_by": "h.done_by",
    "asset": "h.parent",
    "asset_name": "m.asset_name",
}


def can_view_asset_history(user: str, event: str | None = None) -> bool:
    """Admin, HR Executive, HR Lead, or the Administrator user -- every event.

    The audit events alone also for the people who see the Asset Audit tab (its Fulfilled list reads them
    here): PMO and procurement too.
    """
    if user == "Administrator" or get_role_profile(user) in ASSET_HISTORY_PROFILES:
        return True
    return event in AUDIT_EVENTS and get_role_profile(user) in ASSET_AUDIT_VIEW_PROFILES


@frappe.whitelist()
def get_asset_history(
    event: str | None = None,
    department: str | None = None,
    person: str | None = None,
    asset: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    category_type: str | None = None,
    start: int = 0,
    page_length: int = 50,
) -> dict:
    """One page of history rows, newest first.

    Args:
        event: one event type ("Assigned", "Unassigned", "Declaration Signed", ...).
        department: rows that moved an asset from or to it, or rows of assets now in it.
        person: rows about this person (assigned_to) or done by them (done_by).
        asset: part of the asset ID or name.
        from_date / to_date: YYYY-MM-DD, inclusive.
        category_type: "Project" or "IT" -- rows of assets whose category is of that kind.
        start / page_length: paging (page_length at most the data tables' `MAX_PAGE_LENGTH`).

    Returns:
        {"rows": [...], "total": <rows matching the filters>}

    Example:
        GET /api/method/nirmaan_stack.api.assets.history.get_asset_history?event=Assigned&department=Projects
    """
    if not can_view_asset_history(frappe.session.user, event):
        frappe.throw("Only Admin and HR can see the asset history.", frappe.PermissionError)

    conditions = list(_BASE_CONDITIONS)
    values: dict = {}
    if event:
        conditions.append("h.event = %(event)s")
        values["event"] = event
    if department:
        conditions.append(
            "(lower(h.from_department) = lower(%(department)s) or lower(h.to_department) = lower(%(department)s)"
            " or lower(m.department) = lower(%(department)s))"
        )
        values["department"] = department.strip()
    if person:
        conditions.append("(h.assigned_to = %(person)s or h.done_by = %(person)s)")
        values["person"] = person
    if asset:
        conditions.append("(lower(m.name) like %(asset)s or lower(m.asset_name) like %(asset)s)")
        values["asset"] = f"%{asset.strip().lower()}%"
    if from_date:
        conditions.append("h.done_on >= %(from_date)s")
        values["from_date"] = str(getdate(from_date))
    if to_date:
        conditions.append("h.done_on < %(to_date)s")
        values["to_date"] = str(add_days(getdate(to_date), 1))
    if category_type:
        conditions.append("c.category_type = %(category_type)s")
        values["category_type"] = category_type

    rows, total = _history_rows(
        conditions, values, _NEWEST_FIRST, max(int(start or 0), 0), min(max(int(page_length or 50), 1), MAX_PAGE_LENGTH)
    )
    return {"rows": rows, "total": total}


@frappe.whitelist()
def get_asset_history_table(
    doctype: str | None = None,
    fields: str | None = None,
    filters: str | list | None = None,
    order_by: str | None = None,
    limit_start: int = 0,
    limit_page_length: int = 50,
    search_term: str | None = None,
    for_export: int | bool = False,
    **kwargs,
) -> dict:
    """The History tab's rows for the shared data table -- Admin and HR only.

    Speaks the table's request (`useServerDataTable` with `apiEndpoint`): `filters` from the column headers as
    [[column, operator, value]] -- `event` / `assigned_to` / `done_by` / `department` "in" a list, `done_on`
    "Between" / ">=" / "<=" / "Is" / "IsNot" / "Timespan" -- `order_by` "<column> asc|desc", `search_term` on the
    asset ID or name, and paging (`limit_page_length` 0 with `for_export`: every row, at most `EXPORT_MAX_PAGE_LENGTH`).
    Any other column or operator is refused, so a filter never silently matches everything. `doctype`, `fields`
    and the table's other keys are ignored: the row shape is fixed.

    Returns:
        {"data": [rows, as `get_asset_history` returns them], "total_count": <rows matching>}

    Example:
        POST /api/method/nirmaan_stack.api.assets.history.get_asset_history_table
        {"filters": "[[\"event\", \"in\", [\"Audit Fulfilled\"]], [\"done_on\", \"Timespan\", \"this month\"]]",
         "order_by": "done_on desc", "limit_start": 0, "limit_page_length": 50}
    """
    if not can_view_asset_history(frappe.session.user):
        frappe.throw("Only Admin and HR can see the asset history.", frappe.PermissionError)

    conditions, values = _table_conditions(filters, search_term)

    if cint(for_export) and not cint(limit_page_length):
        start, page_length = 0, EXPORT_MAX_PAGE_LENGTH
    else:
        start = max(cint(limit_start), 0)
        # The data tables' cap, which covers every pager size: a smaller cap than asked makes the table skip rows.
        page_length = min(max(cint(limit_page_length) or 50, 1), MAX_PAGE_LENGTH)
    rows, total = _history_rows(conditions, values, _table_order(order_by), start, page_length)
    return {"data": rows, "total_count": total}


@frappe.whitelist()
def get_asset_history_facets(field: str, filters: str | list | None = None, search_term: str | None = None) -> dict:
    """The counts beside one History-table header filter's choices -- Admin and HR only.

    Counts the rows the table's other filters and search leave, grouped by `field` (`event` / `assigned_to` /
    `done_by` / `department`); the field's own filter is left out, so every choice keeps its count while some
    are picked -- what the shared `get_facet_values` does for list doctypes, which can't read this child table.
    A row counts under each department it touches (moved from, moved to, or the asset's now), matching the
    department filter. Values with no rows aren't returned.

    Returns:
        {"values": [{"value": "Audit Fulfilled", "label": "Audit Fulfilled", "count": 30}, ...]} -- most rows first.

    Example:
        GET /api/method/nirmaan_stack.api.assets.history.get_asset_history_facets
            ?field=assigned_to&filters=[["event","in",["Audit Fulfilled"]]]
    """
    if not can_view_asset_history(frappe.session.user):
        frappe.throw("Only Admin and HR can see the asset history.", frappe.PermissionError)
    if field not in _TABLE_FACETS and field != "department":
        frappe.throw(f"The history can't be filtered on {field}.")

    conditions, values = _table_conditions(filters, search_term, skip_column=field)
    where = " and ".join(conditions)
    if field == "department":
        # One row per department the history row touches; `distinct` keeps a row that names one twice to one count.
        rows = frappe.db.sql(
            f"""
            select min(d.department) as value, count(distinct h.name) as count
            {_SOURCE}
            cross join lateral (values (h.from_department), (h.to_department), (m.department)) as d(department)
            where {where} and coalesce(d.department, '') != ''
            group by lower(d.department)
            order by count desc, value
            """,
            values,
            as_dict=True,
        )
    else:
        column = _TABLE_FACETS[field]
        rows = frappe.db.sql(
            f"""
            select {column} as value, count(*) as count
            {_SOURCE}
            where {where} and coalesce({column}, '') != ''
            group by {column}
            order by count desc, value
            """,
            values,
            as_dict=True,
        )
    return {"values": [{"value": row.value, "label": row.value, "count": cint(row.count)} for row in rows]}


def _table_conditions(filters, search_term, skip_column: str | None = None) -> tuple[list[str], dict]:
    """The History table's filters and search as SQL conditions; `skip_column`'s own filter left out (facet counts)."""
    conditions = list(_BASE_CONDITIONS)
    values: dict = {}
    for index, item in enumerate(_parse_filters(filters)):
        if skip_column and isinstance(item, (list, tuple)) and item and item[0] == skip_column:
            continue
        _add_table_filter(item, f"f{index}", conditions, values)
    if search_term and str(search_term).strip():
        conditions.append("(lower(m.name) like %(search)s or lower(m.asset_name) like %(search)s)")
        values["search"] = f"%{str(search_term).strip().lower()}%"
    return conditions, values


def _history_rows(conditions: list[str], values: dict, order_sql: str, start: int, page_length: int) -> tuple[list, int]:
    """One page of history rows matching `conditions`, and how many match in all."""
    where = " and ".join(conditions)
    total = frappe.db.sql(f"select count(*) {_SOURCE} where {where}", values)[0][0]
    rows = frappe.db.sql(
        f"""
        select h.name, h.parent as asset, m.asset_name, m.asset_category, m.department as asset_department,
               h.event, h.assigned_to, h.done_by, h.done_on, h.declaration,
               h.from_department, h.to_department, h.reason, h.audit_answers
        {_SOURCE}
        where {where}
        order by {order_sql}
        limit %(page_length)s offset %(start)s
        """,
        {**values, "start": start, "page_length": page_length},
        as_dict=True,
    )
    return rows, total


def _parse_filters(filters: str | list | None) -> list:
    """The table's filters as a list; refused when they aren't one."""
    try:
        parsed = frappe.parse_json(filters) if filters else []
    except ValueError:
        parsed = None
    if not isinstance(parsed, list):
        frappe.throw("The history filters couldn't be read. Clear them and try again.")
    return parsed


def _add_table_filter(item, key: str, conditions: list[str], values: dict) -> None:
    """One header filter as SQL; anything the History table doesn't send is refused."""
    if not isinstance(item, (list, tuple)) or len(item) != 3:
        frappe.throw("The history filters couldn't be read. Clear them and try again.")
    column, operator, value = item
    operator = str(operator or "")

    if column in _TABLE_FACETS or column == "department":
        if operator.lower() != "in" or not isinstance(value, list) or not value:
            frappe.throw(f"The {column} filter couldn't be read. Clear it and try again.")
        if column == "department":
            # Moved from or to it, or the asset is in it now -- the same meaning as `get_asset_history`.
            values[key] = tuple(str(v).strip().lower() for v in value)
            conditions.append(
                f"(lower(h.from_department) in %({key})s or lower(h.to_department) in %({key})s"
                f" or lower(m.department) in %({key})s)"
            )
        else:
            values[key] = tuple(str(v) for v in value)
            conditions.append(f"{_TABLE_FACETS[column]} in %({key})s")
        return

    if column == "done_on":
        first, after = _date_window(operator, value)
        if operator == "IsNot":
            values[f"{key}_a"], values[f"{key}_b"] = first, after
            conditions.append(f"(h.done_on < %({key}_a)s or h.done_on >= %({key}_b)s)")
            return
        if first:
            values[f"{key}_a"] = first
            conditions.append(f"h.done_on >= %({key}_a)s")
        if after:
            values[f"{key}_b"] = after
            conditions.append(f"h.done_on < %({key}_b)s")
        return

    frappe.throw(f"The history can't be filtered on {column}. Clear that filter and try again.")


def _date_window(operator: str, value) -> tuple[str | None, str | None]:
    """A date filter as [first day, the day after the last) -- `done_on` is a datetime, so the last day counts whole."""
    try:
        if operator == "Between" and isinstance(value, list) and len(value) == 2:
            return str(getdate(value[0])), str(add_days(getdate(value[1]), 1))
        if operator == ">=":
            return str(getdate(value)), None
        if operator == "<=":
            return None, str(add_days(getdate(value), 1))
        if operator in ("Is", "IsNot"):
            return str(getdate(value)), str(add_days(getdate(value), 1))
        if operator == "Timespan":
            window = get_timespan_date_range(str(value).lower())
            if window:
                return str(getdate(window[0])), str(add_days(getdate(window[1]), 1))
    except Exception:
        pass
    frappe.throw("The date filter couldn't be read. Clear it and try again.")


def _table_order(order_by: str | None) -> str:
    """The table's "<column> asc|desc" as SQL on a known column; newest first otherwise."""
    parts = (order_by or "").split()
    if len(parts) == 2 and parts[0] in _TABLE_SORTS and parts[1].lower() in ("asc", "desc"):
        direction = parts[1].lower()
        return f"{_TABLE_SORTS[parts[0]]} {direction}, h.done_on desc, h.idx desc"
    return _NEWEST_FIRST
