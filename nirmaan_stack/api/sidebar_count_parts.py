"""The sidebar badge counts, one function per part (`api/sidebar_counts.sidebar_counts` joins them).

Each part is computed from the counting scope alone (full access, or the projects a user may see), never from who
asks, so two users with the same scope get the same numbers. `PART_DOCTYPES` names every record type a part reads:
a save of one of them can change that part, and no other part.

Rules that keep each badge and its tab agreeing (ADR-0010: a count over many rows is a database aggregate):
* PR / Sent Back "approve" = in an approval state WITH a Pending order_list item, as
  `services/procurement_approval.is_awaiting_approval` (parity-tested).
* Payments "reconciliationpending" leaves out payments waiting in the Cheque Tracker (#1483), as
  `get_approval_queue_counts`.
* Credits count the PO Payment Terms the Credit Payments list shows, through that list's own tab conditions.
"""

from dataclasses import dataclass

import frappe

from nirmaan_stack.api.credits.get_credits_list import (
    TAB_CHEQUE_ISSUED as CREDIT_TAB_CHEQUE_ISSUED,
    TAB_DUE as CREDIT_TAB_DUE,
    _add_status_condition,
)
from nirmaan_stack.services.cheque_payments import in_cheque_tracker_sql
from nirmaan_stack.services.procurement_approval import AWAITING_APPROVAL_STATES, PENDING_ITEM_STATUS
from nirmaan_stack.services.role_profiles import SERVICE_PROCUREMENT_EXECUTIVE_PROFILE

#: Role profiles that count every project, with no project filter.
FULL_ACCESS_PROFILES = (
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Accountant Profile",  # Accountants need access to all projects for financial operations
    "Nirmaan Accountant Lead Profile",  # Accountant Leads mirror Accountant access
    "Nirmaan Estimates Executive Profile",
    "Nirmaan Billing Executive Profile",  # Billing Executive mirrors Estimates Executive access
    # Company-wide WO desk, never assigned projects. Without this its WO tab counts
    # read 0 while the WO table (Frappe list, no User Permission rows) shows every WO.
    SERVICE_PROCUREMENT_EXECUTIVE_PROFILE,
)


@dataclass(frozen=True)
class CountScope:
    """What the counts are taken over: every project, or the listed projects (none = nothing counts)."""

    full_access: bool
    projects: tuple


def scope_for(user: str) -> CountScope:
    """The counting scope of `user`: full access by role profile (or Administrator), else their projects."""
    user_role = frappe.get_value("Nirmaan Users", user, "role_profile") if user != "Administrator" else None
    if user == "Administrator" or user_role in FULL_ACCESS_PROFILES:
        return CountScope(full_access=True, projects=())
    projects = frappe.get_all(
        "Nirmaan User Permissions",
        filters={"user": user, "allow": "Projects"},
        pluck="for_value",
    )
    return CountScope(full_access=False, projects=tuple(projects))


def _doc_filter(scope: CountScope) -> dict:
    """The project filter for a `frappe.db.count` / `frappe.get_all` call."""
    return {} if scope.full_access else {"project": ["in", list(scope.projects)]}


def _proj(scope: CountScope, alias: str) -> str:
    """Project clause for raw SQL: empty for full access; blocks every row when a scoped user has no projects;
    otherwise an IN over the allowed projects."""
    if scope.full_access:
        return ""
    if not scope.projects:
        return " AND 1=0"
    return f' AND {alias}."project" IN %(projects)s'


def _params(scope: CountScope, extra: dict) -> dict:
    if not scope.full_access and scope.projects:
        extra["projects"] = tuple(scope.projects)
    return extra


def _count(doctype: str, filters: dict) -> int:
    return frappe.db.count(doctype, filters=filters)


def _awaiting_count(scope: CountScope, doctype: str, alias: str) -> int:
    """Count docs awaiting approval: in an approval state WITH a Pending order_list item."""
    return frappe.db.sql(
        f'''
        SELECT COUNT(*) FROM "tab{doctype}" {alias}
        WHERE {alias}.workflow_state IN %(states)s{_proj(scope, alias)}
          AND EXISTS (
            SELECT 1 FROM "tabProcurement Request Item Detail" i
            WHERE i.parent = {alias}.name AND i.parenttype = %(dt)s
              AND i.parentfield = 'order_list' AND i.status = %(pending)s
          )
        ''',
        _params(scope, {"states": tuple(AWAITING_APPROVAL_STATES), "dt": doctype, "pending": PENDING_ITEM_STATUS}),
    )[0][0]


def count_po(scope: CountScope, today: str) -> dict:
    rows = frappe.get_all(
        "Procurement Orders",
        filters=_doc_filter(scope),
        group_by="status",
        fields=["status", "count(name) as qty"],
        as_list=True,
    )
    counts = {s: q for s, q, _ in rows}
    counts["all"] = sum(q for _, q, _ in rows)
    return counts


def count_po_revisions(scope: CountScope, today: str) -> dict:
    flt = _doc_filter(scope)
    counts = {
        "pending_approval": _count("PO Revisions", {**flt, "status": "Pending"}),
        "approved": _count("PO Revisions", {**flt, "status": "Approved"}),
        "rejected": _count("PO Revisions", {**flt, "status": "Rejected"}),
    }
    counts["all"] = _count("PO Revisions", flt)
    return counts


def count_po_adjustments(scope: CountScope, today: str) -> dict:
    flt = {"status": "Pending"}
    if not scope.full_access:
        flt["project"] = ["in", list(scope.projects)]
    return {"pending": _count("PO Adjustments", flt)}


def count_pr(scope: CountScope, today: str) -> dict:
    states = ("Pending", "Rejected", "Approved", "In Progress", "Vendor Selected",
              "Partially Approved", "Vendor Approved", "Delayed", "Sent Back")
    rows = frappe.db.sql(
        f'''
        SELECT p.workflow_state AS state, COUNT(*) AS c
        FROM "tabProcurement Requests" p
        WHERE p.workflow_state IN %(states)s{_proj(scope, "p")}
        GROUP BY p.workflow_state
        ''',
        _params(scope, {"states": states}), as_dict=True,
    )
    by_state = {r["state"]: r["c"] for r in rows}
    # Vendor Selected / Partially Approved rows count toward `all` but feed only `approve`.
    return {
        "pending": by_state.get("Pending", 0),
        "rejected": by_state.get("Rejected", 0),
        "approved": by_state.get("Approved", 0),
        "in_progress": by_state.get("In Progress", 0),
        "approve": _awaiting_count(scope, "Procurement Requests", "p"),
        "vendor_approved": by_state.get("Vendor Approved", 0),
        "delayed": by_state.get("Delayed", 0),
        "sent_back": by_state.get("Sent Back", 0),
        "all": sum(by_state.values()),
    }


def count_sb(scope: CountScope, today: str) -> dict:
    sb_all = frappe.db.sql(
        f'''SELECT COUNT(*) FROM "tabSent Back Category" s
            WHERE s.workflow_state IN %(states)s{_proj(scope, "s")}''',
        _params(scope, {"states": ("Vendor Selected", "Partially Approved", "Pending", "Approved", "Sent Back")}),
    )[0][0]
    # Approval-state rows are covered by `approve`; the type tallies cover the rest
    # (workflow_state in Pending / Approved / Sent Back).
    rows = frappe.db.sql(
        f'''
        SELECT s.type AS type,
               COUNT(*) AS all_c,
               SUM(CASE WHEN s.workflow_state = 'Pending' THEN 1 ELSE 0 END) AS pending_c
        FROM "tabSent Back Category" s
        WHERE s.workflow_state IN %(states)s{_proj(scope, "s")}
        GROUP BY s.type
        ''',
        _params(scope, {"states": ("Pending", "Approved", "Sent Back")}), as_dict=True,
    )
    by_type = {r["type"]: r for r in rows}

    def of_type(t):
        row = by_type.get(t)
        if not row:
            return {"all": 0, "pending": 0}
        return {"all": int(row["all_c"] or 0), "pending": int(row["pending_c"] or 0)}

    return {
        "approve": _awaiting_count(scope, "Sent Back Category", "s"),
        "rejected": of_type("Rejected"),
        "delayed": of_type("Delayed"),
        "cancelled": of_type("Cancelled"),
        "pending": of_type("Pending")["all"],
        "sent_back": of_type("Sent Back")["all"],
        "all": sb_all,
    }


def count_sr(scope: CountScope, today: str) -> dict:
    flt = _doc_filter(scope)
    return {
        "selected": _count("Service Requests", {**flt, "status": "Vendor Selected"}),
        "approved": _count("Service Requests", {**flt, "status": "Approved", "is_finalized": 0}),
        "finalized": _count("Service Requests", {**flt, "status": "Approved", "is_finalized": 1}),
        "amended": _count("Service Requests", {**flt, "status": "Amendment"}),
        # All WO lists a Work Order under amendment too (story 21), so its count does.
        "all": _count("Service Requests", {**flt, "status": ["in", ["Approved", "Amendment"]]}),
        "pending": _count("Service Requests", {**flt, "status": ["not in", ["Approved", "Amendment"]]}),
    }


def count_pay(scope: CountScope, today: str) -> dict:
    flt = _doc_filter(scope)
    # Keys are lowercase single-word identifiers (spaces stripped) so consumers
    # can use plain dot access — e.g. counts.pay.ceopending.
    counts = {
        s.lower().replace(" ", ""): _count("Project Payments", {**flt, "status": s})
        for s in ("Requested", "CEO Pending", "Approved", "Reconciliation Pending", "Rejected", "Paid")
    }
    counts["all"] = _count("Project Payments", flt)
    # A payment on an Issued cheque waits in the Cheque Tracker, not in Reconciliation Pending (#1483).
    in_tracker, marks = in_cheque_tracker_sql("p.status", "c.status")
    counts["reconciliationpending"] = frappe.db.sql(
        f'''
        SELECT COUNT(*) FROM "tabProject Payments" p
        LEFT JOIN "tabCheques" c ON c.name = p.cheque
        WHERE p.status = %(tracker_status)s AND NOT ({in_tracker}) {_proj(scope, "p")}
        ''',
        _params(scope, dict(marks)),
    )[0][0]
    return counts


def count_credits(scope: CountScope, today: str) -> dict:
    # PO Payment Terms (child of Procurement Orders) on POs the Credit Payments list shows: not Merged, Inactive or
    # PO Amendment (`get_credits_list`). A JOIN, not `parent IN (<thousands>)`, which hits the sqlparse 10k-token cap.
    rows = frappe.db.sql(
        f'''
        SELECT t.term_status AS term_status, COUNT(t.name) AS count
        FROM "tabPO Payment Terms" t
        JOIN "tabProcurement Orders" po
          ON po.name = t.parent AND t.parenttype = 'Procurement Orders'
        WHERE t.payment_type = 'Credit'
          AND po.status NOT IN ('Merged', 'Inactive', 'PO Amendment'){_proj(scope, "po")}
        GROUP BY t.term_status
        ''',
        _params(scope, {}), as_dict=True,
    )
    counts = {(r["term_status"] or "").lower().replace(" ", ""): r["count"] for r in rows}
    counts["all"] = sum(counts.values())

    # Due and Cheque Issued count through the Credit Payments page's own tab conditions, so a badge and its tab
    # cannot disagree. Due depends on `today` (the site's date, IST).
    def tab_count(tab):
        conditions, values = [], {"today": today}
        _add_status_condition(tab, conditions, values)
        return frappe.db.sql(
            f'''
            SELECT COUNT(pt.name)
            FROM "tabPO Payment Terms" pt
            JOIN "tabProcurement Orders" po
              ON po.name = pt.parent AND pt.parenttype = 'Procurement Orders'
            WHERE pt.payment_type = 'Credit' AND {" AND ".join(conditions)}
              AND po.status NOT IN ('Merged', 'Inactive', 'PO Amendment'){_proj(scope, "po")}
            ''',
            _params(scope, values),
        )[0][0]

    counts["due"] = tab_count(CREDIT_TAB_DUE)
    counts["chequeissued"] = tab_count(CREDIT_TAB_CHEQUE_ISSUED)
    return counts


#: The parts in the order the reply lists them, each with its counting function.
PARTS = {
    "po": count_po,
    "po_revisions": count_po_revisions,
    "po_adjustments": count_po_adjustments,
    "pr": count_pr,
    "sb": count_sb,
    "sr": count_sr,
    "pay": count_pay,
    "credits": count_credits,
}

#: Every record type each part reads. Child tables are listed with the parent whose save rewrites them.
PART_DOCTYPES = {
    "po": ("Procurement Orders",),
    "po_revisions": ("PO Revisions",),
    "po_adjustments": ("PO Adjustments",),
    "pr": ("Procurement Requests", "Procurement Request Item Detail"),
    "sb": ("Sent Back Category", "Procurement Request Item Detail"),
    "sr": ("Service Requests",),
    "pay": ("Project Payments", "Cheques"),
    "credits": ("PO Payment Terms", "Procurement Orders", "Project Payments"),
}
