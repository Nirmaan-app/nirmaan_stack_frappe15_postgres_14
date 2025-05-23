import frappe, json
from frappe import _

@frappe.whitelist()
def sidebar_counts(user: str) -> str:
    """Return all counts needed for the sidebar in ONE http-roundtrip.

    The dict is already split into normal/admin buckets so the client
    does zero post-processing.
    """
    is_admin = frappe.get_roles(user) and (
        "Nirmaan Admin Profile" in frappe.get_roles(user)
        or user == "Administrator"
    )

    def simple(doctype, flt):
        return frappe.db.count(doctype, filters=flt)

    # --- Procurement Orders -----------------------------------------
    po_filters = {} if is_admin else {"project": ["in", _get_projects(user)]}
    po_status_counts = frappe.get_all(
        "Procurement Orders",
        filters=po_filters,
        group_by="status",
        fields=["status", "count(name) as qty"],
        as_list=True,
    )
    print(f"po_status_counts: {po_status_counts}")
    po_map = {s: q for s, q, _ in po_status_counts}
    po_map["all"] = sum(q for _, q, _ in po_status_counts)

    # --- Procurement Requests (needs JSON) --------------------------
    pr_fields = ["workflow_state", "procurement_list"]
    pr_docs = frappe.get_all(
        "Procurement Requests",
        filters={
            "workflow_state": [
                "in",
                [
                    "Pending",
                    "Rejected",
                    "Approved",
                    "In Progress",
                    "Vendor Selected",
                    "Partially Approved",
                    "Vendor Approved",
                    "Delayed",
                    "Sent Back",
                ],
            ],
            **({} if is_admin else {"project": ["in", _get_projects(user)]}),
        },
        fields=pr_fields,
        limit=0,
    )
    pr_counts = {
        "pending": 0,
        "rejected": 0,
        "approved": 0,
        "in_progress": 0,
        "approve": 0,
        "vendor_approved": 0,
        "delayed": 0,
        "sent_back": 0,
        "all" : 0,
    }
    pr_counts["all"] = len(pr_docs)
    for d in pr_docs:
        if d.workflow_state == "Pending":
            pr_counts["pending"] += 1
        elif d.workflow_state in ("Vendor Selected", "Partially Approved"):
            plist = d.procurement_list or {}
            pending_inside = any(i.get("status") == "Pending" for i in plist.get("list", []))
            pr_counts["approve"] += 1 if pending_inside else 0
        elif d.workflow_state == "Approved":
            pr_counts["approved"] += 1
        elif d.workflow_state == "In Progress":
            pr_counts["in_progress"] += 1
        elif d.workflow_state == "Vendor Approved":
            pr_counts["vendor_approved"] += 1
        elif d.workflow_state == "Delayed":
            pr_counts["delayed"] += 1
        elif d.workflow_state == "Sent Back":
            pr_counts["sent_back"] += 1
        elif d.workflow_state == "Rejected":
            pr_counts["rejected"] += 1
    


    # --- Sent Back Category (needs JSON) ----------------------------
    sb_fields = ["workflow_state", "item_list", "type"]
    sb_docs = frappe.get_all(
        "Sent Back Category",
        filters={
            "workflow_state": ["in", ["Vendor Selected", "Partially Approved", "Pending", "Approved", "Sent Back"]],
            **({} if is_admin else {"project": ["in", _get_projects(user)]}),
        },
        fields=sb_fields,
        limit=0,
    )
    sb_counts = {
        "approve": 0,
        "rejected": {
            "all": 0,
            "pending": 0
        },
        "delayed": {
            "all": 0,
            "pending": 0
        },
        "cancelled": {
            "all": 0,
            "pending": 0
        },
        "pending": 0,
        "sent_back": 0,
        "all" : 0,
    }
    sb_counts["all"] = len(sb_docs)
    for d in sb_docs:
        if d.workflow_state in ("Vendor Selected", "Partially Approved"):
            if any(i.get("status") == "Pending" for i in (d.item_list or {}).get("list", [])):
                sb_counts["approve"] += 1
        elif d.type == "Rejected":
            if d.workflow_state == "Pending":
                sb_counts["rejected"]["pending"] += 1
            sb_counts["rejected"]["all"] += 1
        elif d.type == "Delayed":
            if d.workflow_state == "Pending":
                sb_counts["delayed"]["pending"] += 1
            sb_counts["delayed"]["all"] += 1
        elif d.type == "Cancelled":
            if d.workflow_state == "Pending":
                sb_counts["cancelled"]["pending"] += 1
            sb_counts["cancelled"]["all"] += 1
        elif d.type == "Pending":
            sb_counts["pending"] += 1
        elif d.type == "Sent Back":
            sb_counts["sent_back"] += 1

    # --- Service Requests (simple) ----------------------------------
    sr_filters = {} if is_admin else {"project": ["in", _get_projects(user)]}
    sr_counts = {
        "selected": simple("Service Requests", {**sr_filters, "status": "Vendor Selected"}),
        "approved": simple("Service Requests", {**sr_filters, "status": "Approved"}),
        "amended":  simple("Service Requests", {**sr_filters, "status": "Amendment"}),
        "all":      simple("Service Requests", sr_filters),
        "pending":  simple("Service Requests", {**sr_filters, "status": ["not in",
                      ["Vendor Selected", "Approved", "Amendment"]]}),
    }

    # --- Payments (simple) ------------------------------------------
    pay_filters = {} if is_admin else {"project": ["in", _get_projects(user)]}
    pay_counts = {
        s.lower(): simple("Project Payments", {**pay_filters, "status": s})
        for s in ("Requested", "Approved", "Rejected", "Paid")
    }
    pay_counts["all"] = simple("Project Payments", {**pay_filters})

    return json.dumps({
        "po" : po_map,
        "pr" : pr_counts,
        "sb" : sb_counts,
        "sr" : sr_counts,
        "pay": pay_counts,
    })


def _get_projects(user:str) -> list[str]:
    """Return the Projects a non-admin user may access."""
    return [
        d.for_value
        for d in frappe.get_all(
            "Nirmaan User Permissions",
            filters={"user": user, "allow": "Projects"},
            fields=["for_value"],
        )
    ]