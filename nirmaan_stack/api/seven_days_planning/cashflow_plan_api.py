import frappe

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

    # Batch-fetch child rows for all SRs in one query
    sr_names = [w["name"] for w in wo_list]
    items_rows = frappe.get_all(
        "Work Order Items",
        fields=["parent", "item_name", "category"],
        filters={"parent": ("in", sr_names), "parenttype": "Service Requests"} if sr_names else {"parent": ("in", [""])},
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

