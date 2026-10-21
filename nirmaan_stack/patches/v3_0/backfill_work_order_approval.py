# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Fill each old Work Order's approved-on and approved-by from its change history (spec #1528, #1532).

WHY
    Until #1532 a Work Order stored no approval date, and its page showed the last-modified time as
    "Approved", which every payment, invoice or notes save moves. Approval now stamps `approved_on` and
    `approved_by` (`services/work_order_lifecycle.approval_record`); this patch fills the Work Orders
    approved before that.

WHAT IT DOES
    For each Approved or Amendment Work Order whose `approved_on` or `approved_by` is blank, it reads the Work Order's
    `Version` rows (Service Requests tracks changes) and takes the first one that approves it, by the
    same rule live approval uses (`work_order_lifecycle.is_approval`: a status change into Approved
    from anything but Amendment). That row's `creation` fills `approved_on` and its `owner` (the user
    who saved it) fills `approved_by`. Only a blank field is filled; a value already there is kept.
    A Work Order with no such row (created straight as Approved, or history removed) stays blank and
    is listed.

HOOKS
    The fill is a `set_value` with no `modified` stamp: no `doc_events` fire, and none hang off these
    two fields (nothing reads them but the Work Order page).

RUN BY HAND, preview first
    bench --site <site> execute nirmaan_stack.patches.v3_0.backfill_work_order_approval.preview
    bench --site <site> execute nirmaan_stack.patches.v3_0.backfill_work_order_approval.execute
`preview` only reads. A second run changes nothing: a filled Work Order is no longer blank, and a
Work Order left blank has no history to fill it from.
"""

import json
from typing import NamedTuple

import frappe

from nirmaan_stack.services.work_order_lifecycle import AMENDMENT, APPROVED, is_approval

SR = "Service Requests"
#: A Work Order in one of these has been approved; one in any other status has nothing to fill.
APPROVED_STATUSES = (APPROVED, AMENDMENT)


class Fill(NamedTuple):
    work_order: str
    fields: dict  # only the blank fields, with the value history gives each


class Plan(NamedTuple):
    fills: list   # [Fill]
    no_history: list  # Work Orders with a blank field and no approval in their history


def plan(work_orders=None) -> Plan:
    """What `execute` would fill. Reads only. `work_orders` scopes it, for tests on the live site."""
    scope, params = "", {"approved_statuses": APPROVED_STATUSES}
    if work_orders is not None:
        if not work_orders:
            return Plan([], [])
        scope = "AND name IN %(work_orders)s"
        params["work_orders"] = tuple(work_orders)
    blanks = frappe.db.sql(
        f"""SELECT name, approved_on, approved_by FROM "tabService Requests"
             WHERE status IN %(approved_statuses)s
               AND (approved_on IS NULL OR COALESCE(approved_by, '') = '') {scope}
             ORDER BY name""",
        params,
        as_dict=True,
    )
    if not blanks:
        return Plan([], [])
    approvals = _first_approvals([row.name for row in blanks])
    fills, no_history = [], []
    for row in blanks:
        found = approvals.get(row.name)
        if not found:
            no_history.append(row.name)
            continue
        fields = {}
        if row.approved_on is None:
            fields["approved_on"] = found["approved_on"]
        if not row.approved_by:
            fields["approved_by"] = found["approved_by"]
        fills.append(Fill(row.name, fields))
    return Plan(fills, no_history)


def _first_approvals(work_orders) -> dict:
    """{work order: {approved_on, approved_by}} from the first Version row that approves it."""
    rows = frappe.db.sql(
        """SELECT docname, creation, owner, data FROM "tabVersion"
            WHERE ref_doctype = %(sr)s AND docname IN %(work_orders)s AND data LIKE %(approved)s
            ORDER BY creation, name""",
        {"sr": SR, "work_orders": tuple(work_orders), "approved": '%"Approved"%'},
        as_dict=True,
    )
    found = {}
    for row in rows:
        if row.docname not in found and _approves(row.data):
            found[row.docname] = {"approved_on": row.creation, "approved_by": row.owner}
    return found


def _approves(data) -> bool:
    try:
        changed = json.loads(data or "{}").get("changed") or []
    except (ValueError, AttributeError):
        return False
    return any(
        len(change) == 3 and change[0] == "status" and is_approval(change[1], change[2]) for change in changed
    )


def preview(work_orders=None) -> Plan:
    found = plan(work_orders)
    _print("would fill", found)
    return found


def execute(work_orders=None) -> Plan:
    found = plan(work_orders)
    for fill in found.fills:
        frappe.db.set_value(SR, fill.work_order, fill.fields, update_modified=False)
    _print("filled", found)
    return found


def _print(verb, found: Plan):
    print(f"  Work Order approval: {verb} {len(found.fills)}; {len(found.no_history)} have no approval in history")
    for fill in found.fills:
        values = ", ".join(f"{field}={value}" for field, value in fill.fields.items())
        print(f"    {fill.work_order}: {values}")
    if found.no_history:
        print(f"    left blank: {', '.join(found.no_history)}")
