import frappe, json
from frappe import _

@frappe.whitelist()
def sidebar_counts(user: str) -> str:
    """
    Return all counts needed for the sidebar in ONE http-roundtrip.
    This version uses the original flow of fetching documents and looping through them,
    with corrected logic for accessing child tables.
    """
    # Roles that have full access without project filtering
    full_access_roles = [
        "Nirmaan Admin Profile",
        "Nirmaan PMO Executive Profile",
        "Nirmaan Accountant Profile",  # Accountants need access to all projects for financial operations
    ]
    user_role = frappe.get_value("Nirmaan Users", user, "role_profile") if user != "Administrator" else None
    is_full_access = user == "Administrator" or user_role in full_access_roles
    user_projects = [] if is_full_access else _get_projects(user)

    def simple(doctype, flt):
        """Helper for simpleFrappe DB counts."""
        return frappe.db.count(doctype, filters=flt)

    # --- Procurement Orders (Your Original, Correct Logic) ---
    po_filters = {} if is_full_access else {"project": ["in", user_projects]}
    po_status_counts = frappe.get_all(
        "Procurement Orders",
        filters=po_filters,
        group_by="status",
        fields=["status", "count(name) as qty"],
        as_list=True,
    )
    po_map = {s: q for s, q, _ in po_status_counts}
    po_map["all"] = sum(q for _, q, _ in po_status_counts)


    # --- Procurement Requests (Using Your Preferred Flow with the Fix) ---
    # We fetch only the parent document fields first for speed.
    pr_fields = ["name", "workflow_state"] 
    pr_docs = frappe.get_all(
        "Procurement Requests",
        filters={
            "workflow_state": ["in", ["Pending", "Rejected", "Approved", "In Progress", "Vendor Selected", "Partially Approved", "Vendor Approved", "Delayed", "Sent Back"]],
            **({} if is_full_access else {"project": ["in", user_projects]}),
        },
        fields=pr_fields,
        limit=0,
    )
    pr_counts = {
        "pending": 0, "rejected": 0, "approved": 0, "in_progress": 0,
        "approve": 0, "vendor_approved": 0, "delayed": 0, "sent_back": 0, "all": len(pr_docs),
    }

    for d in pr_docs:
        # For simple states, we just increment the counter based on the data we already have.
        if d.workflow_state == "Pending":
            pr_counts["pending"] += 1
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
        
        # --- THIS IS THE FIX ---
        # For complex states that require checking the child table:
        elif d.workflow_state in ("Vendor Selected", "Partially Approved"):
            # We must get the full document object for THIS specific document
            # to access its child table (`order_list`).
            full_doc = frappe.get_doc("Procurement Requests", d.name)
            order_list_items = full_doc.order_list or []
            
            # Now your original `any()` logic works perfectly on the correct data.
            if any(i.get("status") == "Pending" for i in order_list_items):
                pr_counts["approve"] += 1
    

    # --- Sent Back Category (Using Your Preferred Flow with the Fix) ---
    sb_fields = ["name", "workflow_state", "type"]
    sb_docs = frappe.get_all(
        "Sent Back Category",
        filters={
            "workflow_state": ["in", ["Vendor Selected", "Partially Approved", "Pending", "Approved", "Sent Back"]],
            **({} if is_full_access else {"project": ["in", user_projects]}),
        },
        fields=sb_fields,
        limit=0,
    )
    sb_counts = {
        "approve": 0, "rejected": {"all": 0, "pending": 0},
        "delayed": {"all": 0, "pending": 0}, "cancelled": {"all": 0, "pending": 0},
        "pending": 0, "sent_back": 0, "all" : len(sb_docs),
    }

    for d in sb_docs:
        if d.workflow_state in ("Vendor Selected", "Partially Approved"):
            # --- THIS IS THE FIX (Applied to Sent Back Category) ---
            # Get the full document to access its child table, which is also `order_list`.
            full_doc = frappe.get_doc("Sent Back Category", d.name)
            order_list_items = full_doc.order_list or []

            if any(i.get("status") == "Pending" for i in order_list_items):
                sb_counts["approve"] += 1
        elif d.type == "Rejected":
            if d.workflow_state == "Pending": sb_counts["rejected"]["pending"] += 1
            sb_counts["rejected"]["all"] += 1
        elif d.type == "Delayed":
            if d.workflow_state == "Pending": sb_counts["delayed"]["pending"] += 1
            sb_counts["delayed"]["all"] += 1
        elif d.type == "Cancelled":
            if d.workflow_state == "Pending": sb_counts["cancelled"]["pending"] += 1
            sb_counts["cancelled"]["all"] += 1
        elif d.type == "Pending":
            sb_counts["pending"] += 1
        elif d.type == "Sent Back":
            sb_counts["sent_back"] += 1


    # --- Service Requests, Payments, Credits (Your Original, Correct Logic) ---
    sr_filters = {} if is_full_access else {"project": ["in", user_projects]}
    sr_counts = {
        "selected": simple("Service Requests", {**sr_filters, "status": "Vendor Selected"}),
        "approved": simple("Service Requests", {**sr_filters, "status": "Approved", "is_finalized": 0}),
        "finalized": simple("Service Requests", {**sr_filters, "status": "Approved", "is_finalized": 1}),
        "amended":  simple("Service Requests", {**sr_filters, "status": "Amendment"}),
        "all":      simple("Service Requests", sr_filters),
        "pending":  simple("Service Requests", {**sr_filters, "status": ["not in", ["Approved", "Amendment"]]}),
    }
    pay_filters = {} if is_full_access else {"project": ["in", user_projects]}
    pay_counts = {
        s.lower(): simple("Project Payments", {**pay_filters, "status": s})
        for s in ("Requested", "Approved", "Rejected", "Paid")
    }
    pay_counts["all"] = simple("Project Payments", {**pay_filters})
    credit_po_filters = {} if is_full_access else {"project": ["in", user_projects]}
    credit_po_filters["status"] = ["not in", ["Merged", "Inactive", "PO Amendment"]]

    # Get the list of valid PO names once for reuse
    valid_po_names = frappe.get_all("Procurement Orders", filters=credit_po_filters, pluck="name")

    # Get term_status counts
    credit_counts_raw = frappe.get_all(
        "PO Payment Terms",
        fields=["term_status", "count(name) as count"],
        filters={
            "payment_type": "Credit",
            "parent": ["in", valid_po_names]
        },
        group_by="term_status"
    )
    credit_counts = {item.term_status.lower(): item.count for item in credit_counts_raw}
    credit_counts["all"] = sum(credit_counts.values())

    # Calculate "due" count for the Due tab:
    # - Created terms with due_date <= today (overdue/due for payment)
    # - Requested terms (payment has been requested)
    # - Approved terms (payment approved, pending disbursement)
    from datetime import date
    today = date.today().isoformat()

    # Count Created terms with past due_date
    created_due_count = frappe.db.count(
        "PO Payment Terms",
        filters={
            "payment_type": "Credit",
            "term_status": "Created",
            "due_date": ["<=", today],
            "parent": ["in", valid_po_names]
        }
    )

    # Count Requested terms
    requested_count = credit_counts.get("requested", 0)

    # Count Approved terms
    approved_count = credit_counts.get("approved", 0)

    # Total "due" count = Created (past due) + Requested + Approved
    credit_counts["due"] = created_due_count + requested_count + approved_count

    return json.dumps({
        "po": po_map,
        "pr": pr_counts,
        "sb": sb_counts,
        "sr": sr_counts,
        "pay": pay_counts,
        "credits": credit_counts,
    })

def _get_projects(user:str) -> list[str]:
    """Return the Projects a non-admin user may access."""
    return frappe.get_all(
        "Nirmaan User Permissions",
        filters={"user": user, "allow": "Projects"},
        pluck="for_value",
    )


# import frappe, json
# from frappe import _

# @frappe.whitelist()
# def sidebar_counts(user: str) -> str:
#     """Return all counts needed for the sidebar in ONE http-roundtrip.

#     The dict is already split into normal/admin buckets so the client
#     does zero post-processing.
#     """
#     # is_full_access = frappe.get_roles(user) and (
#     #     "Nirmaan Admin Profile" in frappe.get_roles(user)
#     #     or user == "Administrator"
#     # )

#     is_full_access = user == "Administrator" or frappe.get_value("Nirmaan Users", user, "role_profile") == "Nirmaan Admin Profile"

#     def simple(doctype, flt):
#         return frappe.db.count(doctype, filters=flt)

#     # --- Procurement Orders -----------------------------------------
#     po_filters = {} if is_full_access else {"project": ["in", _get_projects(user)]}
#     po_status_counts = frappe.get_all(
#         "Procurement Orders",
#         filters=po_filters,
#         group_by="status",
#         fields=["status", "count(name) as qty"],
#         as_list=True,
#     )
#     print(f"po_status_counts: {po_status_counts}")
#     po_map = {s: q for s, q, _ in po_status_counts}
#     po_map["all"] = sum(q for _, q, _ in po_status_counts)

#     # --- Procurement Requests (needs JSON) --------------------------
#     pr_fields = ["workflow_state", "procurement_list"]
#     pr_docs = frappe.get_all(
#         "Procurement Requests",
#         filters={
#             "workflow_state": [
#                 "in",
#                 [
#                     "Pending",
#                     "Rejected",
#                     "Approved",
#                     "In Progress",
#                     "Vendor Selected",
#                     "Partially Approved",
#                     "Vendor Approved",
#                     "Delayed",
#                     "Sent Back",
#                 ],
#             ],
#             **({} if is_full_access else {"project": ["in", _get_projects(user)]}),
#         },
#         fields=pr_fields,
#         limit=0,
#     )
#     pr_counts = {
#         "pending": 0,
#         "rejected": 0,
#         "approved": 0,
#         "in_progress": 0,
#         "approve": 0,
#         "vendor_approved": 0,
#         "delayed": 0,
#         "sent_back": 0,
#         "all" : 0,
#     }
#     pr_counts["all"] = len(pr_docs)
#     for d in pr_docs:
#         if d.workflow_state == "Pending":
#             pr_counts["pending"] += 1
#         elif d.workflow_state in ("Vendor Selected", "Partially Approved"):
#             plist = d.procurement_list or {}
#             pending_inside = any(i.get("status") == "Pending" for i in plist.get("list", []))
#             pr_counts["approve"] += 1 if pending_inside else 0
#         elif d.workflow_state == "Approved":
#             pr_counts["approved"] += 1
#         elif d.workflow_state == "In Progress":
#             pr_counts["in_progress"] += 1
#         elif d.workflow_state == "Vendor Approved":
#             pr_counts["vendor_approved"] += 1
#         elif d.workflow_state == "Delayed":
#             pr_counts["delayed"] += 1
#         elif d.workflow_state == "Sent Back":
#             pr_counts["sent_back"] += 1
#         elif d.workflow_state == "Rejected":
#             pr_counts["rejected"] += 1
    


#     # --- Sent Back Category (needs JSON) ----------------------------
#     sb_fields = ["workflow_state", "item_list", "type"]
#     sb_docs = frappe.get_all(
#         "Sent Back Category",
#         filters={
#             "workflow_state": ["in", ["Vendor Selected", "Partially Approved", "Pending", "Approved", "Sent Back"]],
#             **({} if is_full_access else {"project": ["in", _get_projects(user)]}),
#         },
#         fields=sb_fields,
#         limit=0,
#     )
#     sb_counts = {
#         "approve": 0,
#         "rejected": {
#             "all": 0,
#             "pending": 0
#         },
#         "delayed": {
#             "all": 0,
#             "pending": 0
#         },
#         "cancelled": {
#             "all": 0,
#             "pending": 0
#         },
#         "pending": 0,
#         "sent_back": 0,
#         "all" : 0,
#     }
#     sb_counts["all"] = len(sb_docs)
#     for d in sb_docs:
#         if d.workflow_state in ("Vendor Selected", "Partially Approved"):
#             if any(i.get("status") == "Pending" for i in (d.item_list or {}).get("list", [])):
#                 sb_counts["approve"] += 1
#         elif d.type == "Rejected":
#             if d.workflow_state == "Pending":
#                 sb_counts["rejected"]["pending"] += 1
#             sb_counts["rejected"]["all"] += 1
#         elif d.type == "Delayed":
#             if d.workflow_state == "Pending":
#                 sb_counts["delayed"]["pending"] += 1
#             sb_counts["delayed"]["all"] += 1
#         elif d.type == "Cancelled":
#             if d.workflow_state == "Pending":
#                 sb_counts["cancelled"]["pending"] += 1
#             sb_counts["cancelled"]["all"] += 1
#         elif d.type == "Pending":
#             sb_counts["pending"] += 1
#         elif d.type == "Sent Back":
#             sb_counts["sent_back"] += 1

#     # --- Service Requests (simple) ----------------------------------
#     sr_filters = {} if is_full_access else {"project": ["in", _get_projects(user)]}
#     sr_counts = {
#         "selected": simple("Service Requests", {**sr_filters, "status": "Vendor Selected"}),
#         "approved": simple("Service Requests", {**sr_filters, "status": "Approved"}),
#         "amended":  simple("Service Requests", {**sr_filters, "status": "Amendment"}),
#         "all":      simple("Service Requests", sr_filters),
#         "pending":  simple("Service Requests", {**sr_filters, "status": ["not in",
#                       ["Vendor Selected", "Approved", "Amendment"]]}),
#     }

#     # --- Payments (simple) ------------------------------------------
#     pay_filters = {} if is_full_access else {"project": ["in", _get_projects(user)]}
#     pay_counts = {
#         s.lower(): simple("Project Payments", {**pay_filters, "status": s})
#         for s in ("Requested", "Approved", "Rejected", "Paid")
#     }
#     pay_counts["all"] = simple("Project Payments", {**pay_filters})


#     # --- [NEW SECTION] Credits (PO Payment Terms) -------------------
#     # This filter is for the PARENT doctype (Procurement Orders).
#     # We apply user permissions at the PO level.
#     credit_po_filters = {} if is_full_access else {"project": ["in", _get_projects(user)]}
#     credit_po_filters["status"] = ["!=", "Merged"]
#     # We query the child table 'PO Payment Terms' but filter it based on which
#     # parent documents ('Procurement Orders') the user is allowed to see.
#     credit_counts_raw = frappe.get_all(
#         "PO Payment Terms",
#         fields=["status", "count(name) as count"],
#         filters={
#             "payment_type": "Credit",
#             # This is the crucial part: filter child docs by their parent's properties
#             "parent": ["in", frappe.get_all("Procurement Orders", filters=credit_po_filters, pluck="name")]
#         },
#         group_by="status"
#     )
#     # Convert list of dicts to a single dict: {'Paid': 10, 'Requested': 5}
#     credit_counts = {item.status.lower(): item.count for item in credit_counts_raw}
    
#     # Calculate the total for the 'all' key
#     credit_counts["all"] = sum(credit_counts.values())

#     return json.dumps({
#         "po" : po_map,
#         "pr" : pr_counts,
#         "sb" : sb_counts,
#         "sr" : sr_counts,
#         "pay": pay_counts,
#         "credits": credit_counts, # <-- Add the new credits object here

#     })


# def _get_projects(user:str) -> list[str]:
#     """Return the Projects a non-admin user may access."""
#     return [
#         d.for_value
#         for d in frappe.get_all(
#             "Nirmaan User Permissions",
#             filters={"user": user, "allow": "Projects"},
#             fields=["for_value"],
#         )
#     ]