"""
Monthly WIP + Handover Activity Report.

For a selected month, list every project that was ACTIVE (in ``WIP`` OR
``Handover`` status) during that month with, for that month:
  - how many days it was active (WIP + Handover combined),
  - the active start / end date(s) (multi-stint aware; each stint labelled with
    its status),
  - counts of DPR, Inventory, DC and DN documents.

There is no stored status-start date on Projects (``status`` is a free-text Data
field). Duration is derived purely from the recorded ``-> WIP`` / ``-> Handover``
status transitions in Frappe's built-in ``Version`` history (Projects has
``track_changes: 1``). See the plan for the full rationale + known limitations.
"""

import frappe
from frappe.utils import (
    add_days,
    add_months,
    get_datetime,
    get_first_day,
    get_last_day,
    getdate,
    now_datetime,
    today,
)

from nirmaan_stack.api.pmo_dashboard import _extract_status_change_value_pairs
from nirmaan_stack.api.seven_days_planning.get_projects_material_plan_stats import (
    _get_allowed_projects,
    _get_user_role,
    _should_filter_by_permissions,
)

WIP = "WIP"
HANDOVER = "Handover"
ACTIVE_STATUSES = (WIP, HANDOVER)

# (result_key, table, business_date_column, extra_sql_filter)
_SPECS = (
    ("dpr", "tabProject Progress Reports", "report_date", ""),
    ("inventory", "tabRemaining Items Report", "report_date", ""),
    ("dc", "tabPO Delivery Documents", "dc_date", "AND type = 'Delivery Challan'"),
    ("dn", "tabDelivery Notes", "delivery_date", ""),
)


# --------------------------------------------------------------------------- #
# Pure helpers (no frappe.db) — unit-tested in test_wip_monthly_report.py
# --------------------------------------------------------------------------- #
def _build_intervals(creation_dt, current_status, changes, now_dt):
    """Reconstruct the project's status timeline as ``[(status, start, end)]``.

    ``changes`` is ``[(change_datetime, old_status, new_status)]`` ordered ascending.
    The status *before* the first recorded change is that change's ``old`` value,
    spanning ``[creation -> first_change]`` (some projects were already WIP before
    their first Version row). The last interval runs to ``now_dt``.
    """
    intervals = []
    if changes:
        prev_status = changes[0][1]
        prev_ts = creation_dt
        for ts, _old, new in changes:
            intervals.append((prev_status, prev_ts, ts))
            prev_status, prev_ts = new, ts
        intervals.append((prev_status, prev_ts, now_dt))
    else:
        intervals.append((current_status, creation_dt, now_dt))
    return intervals


def _merged_active_periods(intervals, now_dt):
    """Return merged active periods as ``[(start_date, end_date, ongoing, status)]``.

    Tracks BOTH ``WIP`` and ``Handover`` intervals. The Version log fragments a
    continuous same-status period into touching sub-intervals; merging any where
    ``next.start <= prev.end`` **and the status matches** makes the stint count +
    dates truthful. A ``WIP -> Handover`` (or vice-versa) transition is NOT merged —
    the two remain distinct, adjacent stints. ``ongoing`` means the period runs to
    *now* (project still in that status).
    """
    raw = []
    for status, start, end in intervals:
        st = (status or "").strip()
        if st not in ACTIVE_STATUSES:
            continue
        raw.append((getdate(start), getdate(end), end == now_dt, st))
    raw.sort(key=lambda x: (x[0], x[1]))

    merged = []
    for start, end, ongoing, st in raw:
        if merged and st == merged[-1][3] and start <= merged[-1][1]:
            prev_start, prev_end, prev_ongoing, prev_st = merged[-1]
            merged[-1] = (prev_start, max(prev_end, end), prev_ongoing or ongoing, prev_st)
        else:
            merged.append((start, end, ongoing, st))
    return merged


def _active_periods_for_month(merged, month_start, month_end_excl):
    """Given merged active periods, return ``(total_days, periods)`` for one month.

    Each period dict has actual ``start``/``end`` dates (``end`` is ``None`` when
    ongoing) plus the month-clipped counting window ``cstart``/``cend``, in-month
    ``days``, and the ``status`` (``WIP`` / ``Handover``). Convention: entry day
    counts, exit day does not. Zero-in-month-day periods are dropped so ``stints``
    counts only real periods. ``total_days`` = WIP + Handover days combined.
    """
    periods = []
    total = 0
    for start, end, ongoing, status in merged:
        if end > month_start and start < month_end_excl:  # overlaps the month
            cstart = max(start, month_start)
            cend = min(end, month_end_excl)
            days = (cend - cstart).days
            if days > 0:
                periods.append(
                    {
                        "start": start,
                        "end": None if ongoing else end,
                        "cstart": cstart,
                        "cend": cend,
                        "days": days,
                        "status": status,
                    }
                )
                total += days
    periods.sort(key=lambda p: p["cstart"])
    return total, periods


# --------------------------------------------------------------------------- #
# DB helpers
# --------------------------------------------------------------------------- #
def _counts_by_project(table, date_col, project_ids, month_start, month_end_excl, extra=""):
    """Per-project COUNT(*) for a doctype in the month (ADR-0010: SQL GROUP BY)."""
    if not project_ids:
        return {}
    rows = frappe.db.sql(
        f'''
        SELECT project, COUNT(*) AS c
        FROM "{table}"
        WHERE project IN %(ids)s
          AND COALESCE({date_col}, creation::date) >= %(start)s
          AND COALESCE({date_col}, creation::date) <  %(end)s
          {extra}
        GROUP BY project
        ''',
        {"ids": tuple(project_ids), "start": month_start, "end": month_end_excl},
        as_dict=True,
    )
    return {r.project: r.c for r in rows}


def _dates_by_project(table, date_col, project_ids, month_start, month_end_excl, extra=""):
    """Fetch ``(project, date)`` rows for the month — only for multi-stint bucketing."""
    if not project_ids:
        return {}
    rows = frappe.db.sql(
        f'''
        SELECT project, COALESCE({date_col}, creation::date) AS d
        FROM "{table}"
        WHERE project IN %(ids)s
          AND COALESCE({date_col}, creation::date) >= %(start)s
          AND COALESCE({date_col}, creation::date) <  %(end)s
          {extra}
        ''',
        {"ids": tuple(project_ids), "start": month_start, "end": month_end_excl},
        as_dict=True,
    )
    out = {}
    for r in rows:
        out.setdefault(r.project, []).append(getdate(r.d))
    return out


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@frappe.whitelist()
def get_wip_month_options(months=24):
    """Dropdown choices: the last ``months`` months, most-recent first."""
    months = int(months or 24)
    cur = getdate(get_first_day(today()))
    options = []
    for k in range(months):
        ms = getdate(get_first_day(add_months(cur, -k)))
        options.append({"value": ms.strftime("%Y-%m"), "label": ms.strftime("%b %Y")})
    return options


@frappe.whitelist()
def get_wip_monthly_report(month=None):
    """Return the monthly WIP activity rows for ``month`` (``"YYYY-MM"``)."""
    now_dt = now_datetime()
    if not month:
        month = getdate(get_first_day(today())).strftime("%Y-%m")
    month_start = getdate(f"{month}-01")
    month_end_excl = getdate(add_days(get_last_day(month_start), 1))

    # Role scoping — restricted roles only see their permitted projects.
    user = frappe.session.user
    role = _get_user_role(user)
    project_filters = {}
    if _should_filter_by_permissions(user, role):
        allowed = _get_allowed_projects(user)
        if not allowed:
            return {"month": month, "rows": []}
        project_filters["name"] = ["in", allowed]

    projects = frappe.get_all(
        "Projects",
        filters=project_filters,
        fields=["name", "project_name", "status", "creation"],
    )
    proj_map = {p.name: p for p in projects}

    # Full status-change history (all rows — needed so a WIP period that ended
    # *after* the month still shows its real end date).
    version_rows = frappe.get_all(
        "Version",
        filters={"ref_doctype": "Projects"},
        fields=["docname", "creation", "data"],
        order_by="docname asc, creation asc",
    )
    changes_by_project = {}
    for v in version_rows:
        if v.docname not in proj_map:
            continue
        for old, new in _extract_status_change_value_pairs(v.data):
            changes_by_project.setdefault(v.docname, []).append(
                (get_datetime(v.creation), old, new)
            )

    # Derive per-project active (WIP + Handover) periods overlapping the month.
    proj_periods = {}
    for name, p in proj_map.items():
        intervals = _build_intervals(
            get_datetime(p.creation), p.status, changes_by_project.get(name, []), now_dt
        )
        merged = _merged_active_periods(intervals, now_dt)
        days, periods = _active_periods_for_month(merged, month_start, month_end_excl)
        if days > 0:
            proj_periods[name] = periods

    active_ids = list(proj_periods.keys())
    if not active_ids:
        return {"month": month, "rows": []}

    # Parent month totals (SQL GROUP BY over all active projects).
    parent_counts = {
        key: _counts_by_project(table, date_col, active_ids, month_start, month_end_excl, extra)
        for key, table, date_col, extra in _SPECS
    }

    # Per-stint counts only for the few multi-stint projects.
    multi_ids = [pid for pid in active_ids if len(proj_periods[pid]) > 1]
    stint_dates = {}
    if multi_ids:
        stint_dates = {
            key: _dates_by_project(table, date_col, multi_ids, month_start, month_end_excl, extra)
            for key, table, date_col, extra in _SPECS
        }

    rows = []
    for pid, periods in proj_periods.items():
        p = proj_map[pid]
        child_periods = []
        for pr in periods:
            child = {
                "status": pr["status"],
                "start": pr["start"].isoformat(),
                "end": "ongoing" if pr["end"] is None else pr["end"].isoformat(),
                "days": pr["days"],
                "dpr": 0,
                "inventory": 0,
                "dc": 0,
                "dn": 0,
            }
            if pid in multi_ids:
                for key in ("dpr", "inventory", "dc", "dn"):
                    dates = stint_dates.get(key, {}).get(pid, [])
                    child[key] = sum(1 for d in dates if pr["cstart"] <= d < pr["cend"])
            child_periods.append(child)

        rows.append(
            {
                "project": pid,
                "project_name": p.project_name or pid,
                "days_active": sum(pr["days"] for pr in periods),
                "active_start": periods[0]["start"].isoformat(),
                "active_end": "ongoing" if periods[-1]["end"] is None else periods[-1]["end"].isoformat(),
                "stints": len(periods),
                "dpr": parent_counts["dpr"].get(pid, 0),
                "inventory": parent_counts["inventory"].get(pid, 0),
                "dc": parent_counts["dc"].get(pid, 0),
                "dn": parent_counts["dn"].get(pid, 0),
                "periods": child_periods,
            }
        )

    rows.sort(key=lambda r: -r["days_active"])
    return {"month": month, "rows": rows}
