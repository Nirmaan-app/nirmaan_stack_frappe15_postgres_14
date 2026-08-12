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
same regardless of which month is picked) and BILLABLE-ONLY, shown only on the
project row:
  - PO dispatch: dispatched POs (status in DISPATCHED_PO_STATUSES), total DNs
    (deliveries, returns excluded), and missing DN,
  - DC compliance: total Delivery Challans and missing DC.

Every column in both groups is restricted to Billable POs. A Non-Billable PO cannot
acquire a Delivery Challan at all, so it can never be compliant and never enters the
``missing_*`` figures; leaving it in the totals beside them meant the two halves of a
row described different universes.

``missing_dn`` / ``missing_dc`` are PO COUNTS from ``reports/metrics.py`` — the same
predicates the Project Action Item reconciler uses — NOT arithmetic over the document
totals beside them. They used to be ``max(0, dispatched_po − total_dn)`` and
``max(0, total_dn − non_billable_dn − total_dc)``; both subtracted document counts to
answer a per-PO question, which is unsound because one PO carries any number of DNs.
The raw values went negative on 56 / 12 of 93 projects respectively and the clamp
rendered that as a clean zero. See reports/metrics.py for the full rationale.

CONSEQUENCE, and it is intended: ``total_dn`` / ``total_dc`` are DOCUMENT counts while
``missing_dn`` / ``missing_dc`` are PO counts, so the columns do NOT reconcile
arithmetically on screen. They are answering different questions in different units.

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
from nirmaan_stack.api.reports.metrics import pending_counts_by_project
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
    active Mondays would otherwise render −1). ``missing_dn`` / ``missing_dc`` used to
    be clamped for the same reason; they no longer are, because they are now PO counts
    from reports/metrics.py rather than a subtraction of document totals, and a count
    cannot go negative. Inventory keeps its clamp because it IS still a subtraction.

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


# NOTE: the old ``_NON_BILLABLE_DN_CLAUSE`` lived here. It subtracted DNs belonging to
# Non-Billable POs out of the missing-DC gap, because such a PO can never acquire a DC
# (the DC/MIR upload path rejects it — see api/delivery_challans_data.py). It is gone
# because ``missing_dc`` no longer subtracts anything: reports/metrics.py counts POs
# through ``predicates.is_dc_pending``, which already returns False for a Non-Billable
# PO. The correction is now explicit in the predicate instead of an invisible term.


# A blank / NULL ``billing_status`` counts as BILLABLE — the same convention as
# predicates.is_billable and the frontend. procurement_orders.py leaves the field empty
# on an item-less PO, so an ``!= 'Non-Billable'`` test alone would wrongly drop those
# rows on Postgres (NULL != 'x' is NULL, not TRUE).
_BILLABLE = "(po.billing_status IS NULL OR po.billing_status != 'Non-Billable')"


def _billable_po_clause(table, link_column):
    """``AND EXISTS(...)`` restricting ``table`` to rows whose parent PO is Billable.

    ``_lifetime_counts_by_project`` does not alias its FROM table, so the correlation
    has to name the table in full (``"tabDelivery Notes".procurement_order``) rather
    than use an alias — Postgres rejects the aliased form with "invalid reference to
    FROM-clause entry".

    A row whose ``link_column`` is blank (an ITM-parented DN, of which there are 4 on
    live data) matches no PO and is therefore EXCLUDED — correct here, since the whole
    lifetime block is scoped to the Billable PO universe.
    """
    return f'''
          AND EXISTS (
              SELECT 1 FROM "tabProcurement Orders" po
              WHERE po.name = "{table}".{link_column}
                AND {_BILLABLE}
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
    #
    # THE WHOLE LIFETIME BLOCK IS SCOPED TO BILLABLE POs. A Non-Billable PO can never
    # acquire a Delivery Challan (the upload path rejects it), so it can never be
    # "compliant" and never appears in `missing_dn` / `missing_dc` either — counting its
    # POs and documents in the totals beside them made the row unreadable (a project
    # would show 35 dispatched POs against 25 missing DCs with no visible explanation
    # for the 10-PO gap). Every column in this block now describes the same Billable
    # universe. On live data this drops 1107 of 5047 POs and 261 of 1631 challans.
    status_in = ", ".join(f"'{s}'" for s in DISPATCHED_PO_STATUSES)
    # Disp PO counts EVERY live PO, Billable or not — the same owner ruling as Total DN
    # below. A Non-Billable PO is still a dispatched PO. The Billable subset rides along
    # so the cell can show the split on hover.
    dispatched_po = _lifetime_counts_by_project(
        "tabProcurement Orders", active_ids, f"AND status IN ({status_in})"
    )
    dispatched_po_billable = _lifetime_counts_by_project(
        "tabProcurement Orders", active_ids,
        f"AND status IN ({status_in}) "
        "AND (billing_status IS NULL OR billing_status != 'Non-Billable')",
    )
    # Total DN counts EVERY non-return delivery note, Billable or not — owner ruling,
    # and DELIBERATELY unlike the rest of this block. A Non-Billable PO still receives
    # goods and still produces delivery notes; hiding them made the column disagree with
    # the Delivery Notes list for no reason a reader could see. The Billable subset rides
    # alongside so the cell can show the split on hover.
    #
    # It does NOT change `missing_dn` / `missing_dc`, which stay Billable-only: a
    # Non-Billable PO can never acquire a challan (the upload path rejects it), so
    # counting one as non-compliant would put a row in those columns that can never
    # clear. Nor does it change Total DC — the ruling is delivery notes only.
    total_dn = _lifetime_counts_by_project(
        "tabDelivery Notes", active_ids, "AND is_return = 0"
    )
    total_dn_billable = _lifetime_counts_by_project(
        "tabDelivery Notes", active_ids,
        "AND is_return = 0" + _billable_po_clause("tabDelivery Notes", "procurement_order"),
    )
    total_dc = _lifetime_counts_by_project(
        "tabPO Delivery Documents", active_ids,
        "AND type = 'Delivery Challan' AND parent_doctype = 'Procurement Orders'"
        + _billable_po_clause("tabPO Delivery Documents", "parent_docname"),
    )

    # The two "missing" figures — PO counts, NOT arithmetic over the totals above. One
    # bulk call covering every project; a project with no live POs is simply absent, so
    # every read below defaults to 0. Deliberately NOT filtered to `active_ids`: the
    # helper's queries join on PO status rather than taking an IN-list of project names,
    # which is what keeps them clear of the sqlparse 10k-token cap in production.
    pending = pending_counts_by_project()

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
        p_pending = pending.get(pid) or {}
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
                # G4 — PO dispatch vs delivery (lifetime). `dispatched_po` / `total_dn`
                # are DOCUMENT counts; `missing_dn` is a PO count — Billable POs with a
                # dispatched item that is not yet fully received (predicates.is_dn_pending,
                # the SAME rule as the project Overview tile's "DN Pending", so the two
                # surfaces always print the same number). The three do NOT subtract into
                # one another. No clamp — a count cannot be negative.
                "dispatched_po": n_dispatched,
                # Billable slice, surfaced ONLY for the hover split. Nothing derives from
                # it — `missing_dn` / `missing_dc` still come from the predicates, which
                # apply their own Billable rule.
                "dispatched_po_billable": dispatched_po_billable.get(pid, 0),
                "total_dn": n_dn,
                # The Billable slice of `total_dn`, surfaced ONLY so the cell can show
                # "N Billable / M Non-Billable" on hover. Nothing derives from it.
                "total_dn_billable": total_dn_billable.get(pid, 0),
                "missing_dn": p_pending.get("dn_pending", 0),
                # G5 — DC compliance (lifetime). Same unit split: `total_dc` counts
                # challan DOCUMENTS (stubs included, as a raw total should), while
                # `missing_dc` counts POs that owe one via predicates.is_dc_pending
                # (which excludes stubs and Non-Billable POs).
                "total_dc": n_dc,
                "missing_dc": p_pending.get("dc_pending", 0),
                "periods": child_periods,
            }
        )

    rows.sort(key=lambda r: -r["days_active"])
    return {"month": month, "rows": rows}
