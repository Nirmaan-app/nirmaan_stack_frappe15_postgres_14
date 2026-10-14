"""The asset history across all assets, with filters -- Admin and HR only (owner, 2026-10-12), plus the audit
rows for everyone who sees the Asset Audit tab (owner, 2026-10-14).

Reads the `Asset History` child rows (written by `services/asset_history.py`) joined to their asset,
newest first, one page at a time. A whitelisted read rather than the generic list API, because the
history is a child table and access is decided by role profile, which DocPerms cannot express.
"""

import frappe
from frappe.utils import add_days, getdate

from nirmaan_stack.services.asset_history import AUDIT_REQUESTED, AUDIT_FULFILLED, AUDIT_MISSED
from nirmaan_stack.services.role_profiles import ASSET_AUDIT_VIEW_PROFILES, ASSET_HISTORY_PROFILES, get_role_profile

MAX_PAGE_LENGTH = 200
AUDIT_EVENTS = (AUDIT_REQUESTED, AUDIT_FULFILLED, AUDIT_MISSED)


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
        start / page_length: paging (page_length at most 200).

    Returns:
        {"rows": [...], "total": <rows matching the filters>}

    Example:
        GET /api/method/nirmaan_stack.api.assets.history.get_asset_history?event=Assigned&department=Projects
    """
    if not can_view_asset_history(frappe.session.user, event):
        frappe.throw("Only Admin and HR can see the asset history.", frappe.PermissionError)

    conditions = ["h.parenttype = 'Asset Master'", "h.parentfield = 'asset_history'"]
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

    where = " and ".join(conditions)
    source = (
        'from "tabAsset History" h join "tabAsset Master" m on m.name = h.parent'
        ' left join "tabAsset Category" c on c.name = m.asset_category'
    )

    total = frappe.db.sql(f"select count(*) {source} where {where}", values)[0][0]
    values["start"] = max(int(start or 0), 0)
    values["page_length"] = min(max(int(page_length or 50), 1), MAX_PAGE_LENGTH)
    rows = frappe.db.sql(
        f"""
        select h.name, h.parent as asset, m.asset_name, m.asset_category, m.department as asset_department,
               h.event, h.assigned_to, h.done_by, h.done_on, h.declaration,
               h.from_department, h.to_department, h.reason
        {source}
        where {where}
        order by h.done_on desc, h.idx desc
        limit %(page_length)s offset %(start)s
        """,
        values,
        as_dict=True,
    )
    return {"rows": rows, "total": total}
