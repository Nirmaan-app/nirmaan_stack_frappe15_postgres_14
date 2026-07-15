import frappe
from frappe.utils import create_batch

@frappe.whitelist()
def get_active_vendors():
    vendors = frappe.get_all("Vendors", 
        fields=["name", "vendor_name"], 
        filters={"docstatus": 0}, 
        order_by="vendor_name asc"
    )
    return vendors


@frappe.whitelist()
def get_all_project_wos(project):
    """
    Fetch ALL Service Requests for a project with details.
    Used for 'Select Work Orders' modal.
    """
    if not project:
        return {"wos": []}
    
    filters = {
        "project": project,
        # "status": ["not in", ["Cancelled", "Merged", "Inactive", "Draft"]]
    }
    
    wo_list = frappe.get_all("Service Requests",
        filters=filters,
        fields=["name", "vendor", "creation", "status", "total_amount", "amount_paid"],
        order_by="creation desc"
    )

    # Fetch vendor names
    vendor_ids = [w.vendor for w in wo_list if w.vendor]
    vendor_map = {}
    if vendor_ids:
        vendors = frappe.get_all("Vendors", filters={"name": ["in", vendor_ids]}, fields=["name", "vendor_name"])
        for v in vendors:
            vendor_map[v.name] = v.vendor_name

    # Batch-fetch child rows for all SRs, chunked so the generated IN() never
    # exceeds the sqlparse 10k-token cap (prod). sr_names scales with the number
    # of Service Requests on the project. Each SR's rows stay within one chunk,
    # so per-parent order is preserved. Empty sr_names -> no chunks -> [] (same
    # as the old parent-in-[""] no-match query).
    sr_names = [w["name"] for w in wo_list]
    items_rows = []
    for _chunk in create_batch(sr_names, 500):
        items_rows += frappe.get_all(
            "Work Order Items",
            fields=["parent", "item_name", "category"],
            filters={"parent": ("in", list(_chunk)), "parenttype": "Service Requests"},
        )
    items_by_parent = {}
    for row in items_rows:
        items_by_parent.setdefault(row["parent"], []).append({
            "description": row.get("item_name"),
            "category": row.get("category"),
        })

    for w in wo_list:
        w["vendor_name"] = vendor_map.get(w.vendor, w.vendor)
        w["grand_total"] = w.get("total_amount") or 0
        w["total_paid"] = w.get("amount_paid") or 0
        w["items"] = items_by_parent.get(w["name"], [])

    return {"wos": wo_list}

