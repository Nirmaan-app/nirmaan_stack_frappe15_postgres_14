"""
Monthly WIP + Handover Activity Report.

For a selected month, list every project that was ACTIVE (in ``WIP`` OR
``Handover`` status) during that month with, for that month:
  - how many days it was active (WIP + Handover combined),
  - the active start / end date(s) (multi-stint aware; each stint labelled with
    its status),
  - DPR compliance on a DAILY cadence (Sundays excluded): active working days,
    days that have a DPR, and the missing days (total + missing == working days),
  - Inventory compliance on a WEEKLY (Monday) cadence: expected inventories
    (active Mondays), the Mondays actually filled, and the missing ones.

Two further groups are LIFETIME (whole-project, NOT scoped to the month — the
same regardless of which month is picked), shown only on the project row:
  - PO dispatch: dispatched POs (status in DISPATCHED_PO_STATUSES), total DNs
    (deliveries, returns excluded), and missing DN = dispatched − DN (clamped ≥0),
  - DC compliance: total Delivery Challans and missing DC = total DN − total DC.

There is no stored status-start date on Projects (``status`` is a free-text Data
field). Duration is derived purely from the recorded ``-> WIP`` / ``-> Handover``
status transitions in Frappe's built-in ``Version`` history (Projects has
``track_changes: 1``). See the plan for the full rationale + known limitations.
"""

from datetime import timedelta

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

# Month-scoped day-based metrics: (result_key, table, business_date_column).
_SPECS = (
    ("dpr", "tabProject Progress Reports", "report_date"),
    ("inventory", "tabRemaining Items Report", "report_date"),
)
_SPEC_BY_KEY = {key: (table, date_col) for key, table, date_col in _SPECS}

# Python date.weekday(): Monday == 0 ... Sunday == 6.
MONDAY = 0
SUNDAY = 6

# Lifetime (NOT month-scoped) PO-dispatch / DC groups. A PO counts as "dispatched"
# once it has left "PO Approved" into any dispatch/delivery state.
DISPATCHED_PO_STATUSES = ("Partially Dispatched", "Dispatched", "Partially Delivered", "Delivered")


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


def _period_day_set(cstart, cend):
    """Calendar dates in a stint's counting window ``[cstart, cend)``.

    Same convention as the day count: entry day is included, exit day is not.
    Merged stints never overlap, so the union of period sets has no double-count.
    """
    days = set()
    d = cstart
    while d < cend:
        days.add(d)
        d = d + timedelta(days=1)
    return days


def _compliance_metrics(active_days, dpr_days, inv_report_count):
    """DPR (day-based) + Inventory (volume-based) compliance for one active-day set.

    ``active_days`` is the set of active calendar dates; ``dpr_days`` is the project's
    distinct DPR report dates in the month; ``inv_report_count`` is a plain COUNT of
    inventory report DOCUMENTS (see below — the caller decides its scope).

    DPR (DAILY, Sundays excluded): the working days are the active non-Sunday days.
    ``total_dpr_days`` = working days that have a DPR, ``missing_dpr_days`` = working
    days without one — so ``active_working_days == total + missing`` by construction.

    Inventory (WEEKLY cadence, VOLUME actual): ``expected_inventory`` = active Mondays
    (one report expected per active week); ``actual_inventory`` = how many inventory
    reports were actually FILED; ``missing_inventory`` = the shortfall, CLAMPED at 0.

    The clamp is required, not cosmetic — ``actual`` is an unbounded document count and
    routinely exceeds ``expected`` on live data (a project filing 6 reports against 5
    active Mondays would otherwise render −1). Same reason ``missing_dn`` /
    ``missing_dc`` are clamped.

    NOTE (owner ruling): ``actual_inventory`` counts DOCUMENTS, not covered Mondays. It
    deliberately no longer keys on the report landing on its Monday, so a project filing
    on a cadence other than Monday is no longer penalised — and, by the same token, the
    strict-Monday cadence signal is no longer surfaced by this report.

    A count (rather than a date set) is taken because a document count is NOT
    recoverable from a set of dates — dedup has already happened. Passing the scalar
    also keeps the scope policy at the call site, where it is visible.
    """
    working = {d for d in active_days if d.weekday() != SUNDAY}
    mondays = {d for d in active_days if d.weekday() == MONDAY}
    total_dpr = len(working & dpr_days)
    expected_inv = len(mondays)
    return {
        "active_working_days": len(working),
        "total_dpr_days": total_dpr,
        "missing_dpr_days": len(working) - total_dpr,
        "expected_inventory": expected_inv,
        "actual_inventory": inv_report_count,
        "missing_inventory": max(0, expected_inv - inv_report_count),
    }


# --------------------------------------------------------------------------- #
# DB helpers
# --------------------------------------------------------------------------- #
def _distinct_dates_by_project(table, date_col, project_ids, month_start, month_end_excl):
    """Per-project SET of distinct business dates in the month (day-based metrics)."""
    if not project_ids:
        return {}
    rows = frappe.db.sql(
        f'''
        SELECT project, COALESCE({date_col}, creation::date) AS d
        FROM "{table}"
        WHERE project IN %(ids)s
          AND COALESCE({date_col}, creation::date) >= %(start)s
          AND COALESCE({date_col}, creation::date) <  %(end)s
        GROUP BY project, COALESCE({date_col}, creation::date)
        ''',
        {"ids": tuple(project_ids), "start": month_start, "end": month_end_excl},
        as_dict=True,
    )
    out = {}
    for r in rows:
        out.setdefault(r.project, set()).add(getdate(r.d))
    return out


def _report_dates_by_project(table, date_col, project_ids, month_start, month_end_excl):
    """Per-project LIST of business dates in the month — ONE ENTRY PER DOCUMENT.

    Deliberately NOT deduped (contrast ``_distinct_dates_by_project``, which the
    day-based DPR metric still uses): the inventory ``actual`` is a document COUNT, so
    two reports filed on the same day must count twice. Returning dates rather than a
    bare count lets the caller bucket the same rows per stint.
    """
    if not project_ids:
        return {}
    rows = frappe.db.sql(
        f'''
        SELECT project, COALESCE({date_col}, creation::date) AS d
        FROM "{table}"
        WHERE project IN %(ids)s
          AND COALESCE({date_col}, creation::date) >= %(start)s
          AND COALESCE({date_col}, creation::date) <  %(end)s
        ''',
        {"ids": tuple(project_ids), "start": month_start, "end": month_end_excl},
        as_dict=True,
    )
    out = {}
    for r in rows:
        out.setdefault(r.project, []).append(getdate(r.d))
    return out


# A Delivery Note whose PO is Non-Billable can NEVER acquire a DC — the DC/MIR upload
# path rejects Non-Billable POs outright (see api/delivery_challans_data.py). Counting
# such DNs as "missing a DC" is permanently unclearable, so they are subtracted out of
# the G5 gap. Two joins-worth of care:
#   * matched on the legacy ``procurement_order`` Link, NOT ``parent_docname`` — the DN
#     polymorphism migration is only partly applied, so ``parent_docname`` is NULL on
#     every row while ``procurement_order`` is reliably set.
#   * only the EXPLICIT 'Non-Billable' string counts; a blank billing_status means
#     Billable (procurement_orders.py leaves it empty for an item-less PO), matching
#     the frontend convention everywhere.
# ITM-parented DNs have no PO, so they do not match and stay in the gap (owner call).
_NON_BILLABLE_DN_CLAUSE = '''
          AND is_return = 0
          AND EXISTS (
              SELECT 1 FROM "tabProcurement Orders" po
              WHERE po.name = "tabDelivery Notes".procurement_order
                AND po.billing_status = 'Non-Billable'
          )
'''


def _lifetime_counts_by_project(table, project_ids, extra=""):
    """Per-project COUNT(*) with NO date filter — the month-independent lifetime
    totals for the PO-dispatch (G4) and DC (G5) groups. ``extra`` is an extra
    ``AND ...`` clause (status set, is_return, type, etc.)."""
    if not project_ids:
        return {}
    rows = frappe.db.sql(
        f'''
        SELECT project, COUNT(*) AS c
        FROM "{table}"
        WHERE project IN %(ids)s
          {extra}
        GROUP BY project
        ''',
        {"ids": tuple(project_ids)},
        as_dict=True,
    )
    return {r.project: r.c for r in rows}


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

    # DPR (G2): month-scoped and DAY-based — distinct report-date SETS, intersected
    # with the active-day set below.
    # Inventory (G3): month-scoped and VOLUME-based — one entry per DOCUMENT, so the
    # dates are NOT deduped and are NOT intersected with the active window on the
    # project row (owner ruling: count every report dated in the month).
    dpr_table, dpr_col = _SPEC_BY_KEY["dpr"]
    inv_table, inv_col = _SPEC_BY_KEY["inventory"]
    dpr_dates = _distinct_dates_by_project(dpr_table, dpr_col, active_ids, month_start, month_end_excl)
    inv_report_dates = _report_dates_by_project(inv_table, inv_col, active_ids, month_start, month_end_excl)

    # PO-dispatch (G4) + DC (G5): LIFETIME totals, NOT month-scoped. DISPATCHED_PO_STATUSES
    # is a code constant (no user input) so its literals are safe to inline.
    status_in = ", ".join(f"'{s}'" for s in DISPATCHED_PO_STATUSES)
    dispatched_po = _lifetime_counts_by_project(
        "tabProcurement Orders", active_ids, f"AND status IN ({status_in})"
    )
    total_dn = _lifetime_counts_by_project("tabDelivery Notes", active_ids, "AND is_return = 0")
    # Subtracted out of the G5 gap only — `total_dn` above stays the FULL count, so the
    # displayed Total DN / Total DC / Missing DC do not visibly reconcile (owner chose
    # to keep this subtraction implicit rather than add a column).
    non_billable_dn = _lifetime_counts_by_project(
        "tabDelivery Notes", active_ids, _NON_BILLABLE_DN_CLAUSE
    )
    total_dc = _lifetime_counts_by_project(
        "tabPO Delivery Documents", active_ids,
        "AND type = 'Delivery Challan' AND parent_doctype = 'Procurement Orders'",
    )

    rows = []
    for pid, periods in proj_periods.items():
        p = proj_map[pid]
        pdpr = dpr_dates.get(pid, set())
        pinv = inv_report_dates.get(pid, [])

        all_days = set()
        per_stint_days = []
        for pr in periods:
            s = _period_day_set(pr["cstart"], pr["cend"])
            per_stint_days.append(s)
            all_days |= s

        # G4/G5 are lifetime, project-level — they do NOT split per stint.
        child_periods = [
            {
                "status": pr["status"],
                "start": pr["start"].isoformat(),
                "end": "ongoing" if pr["end"] is None else pr["end"].isoformat(),
                "days": pr["days"],
                # A stint counts only the reports dated inside ITS OWN window, while the
                # project row counts the whole month — so the stints can sum to LESS than
                # the parent when a report was filed while the project was inactive.
                # That is intended (it follows from the whole-month scope ruling) and is
                # the one place the "per-stint sums to parent" property no longer holds.
                **_compliance_metrics(sdays, pdpr, sum(1 for d in pinv if d in sdays)),
            }
            for pr, sdays in zip(periods, per_stint_days)
        ]

        n_dispatched = dispatched_po.get(pid, 0)
        n_dn = total_dn.get(pid, 0)
        n_dc = total_dc.get(pid, 0)
        rows.append(
            {
                "project": pid,
                "project_name": p.project_name or pid,
                "days_active": sum(pr["days"] for pr in periods),
                # Whole-month document count — NOT intersected with the active window.
                **_compliance_metrics(all_days, pdpr, len(pinv)),
                "active_start": periods[0]["start"].isoformat(),
                "active_end": "ongoing" if periods[-1]["end"] is None else periods[-1]["end"].isoformat(),
                "stints": len(periods),
                # G4 — PO dispatch vs delivery (lifetime). Missing clamped at 0: a PO can
                # carry several DNs, so raw (dispatched − dn) can go negative.
                "dispatched_po": n_dispatched,
                "total_dn": n_dn,
                "missing_dn": max(0, n_dispatched - n_dn),
                # G5 — DC compliance (lifetime). Missing = total DN − Non-Billable DN −
                # total DC, clamped at 0. The Non-Billable term removes DNs that can
                # never acquire a DC (see _NON_BILLABLE_DN_CLAUSE); the clamp still does
                # real work — several live projects go negative before it.
                "total_dc": n_dc,
                "missing_dc": max(0, n_dn - non_billable_dn.get(pid, 0) - n_dc),
                "periods": child_periods,
            }
        )

    rows.sort(key=lambda r: -r["days_active"])
    return {"month": month, "rows": rows}
