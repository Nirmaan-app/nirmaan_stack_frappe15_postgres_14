import frappe
import json

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
        fields=["name", "vendor", "creation", "status", "total_amount", "amount_paid", "service_order_list"],
        order_by="creation desc"
    )

    # Fetch vendor names
    vendor_ids = [w.vendor for w in wo_list if w.vendor]
    vendor_map = {}
    if vendor_ids:
        vendors = frappe.get_all("Vendors", filters={"name": ["in", vendor_ids]}, fields=["name", "vendor_name"])
        for v in vendors:
            vendor_map[v.name] = v.vendor_name

    for w in wo_list:
        w["vendor_name"] = vendor_map.get(w.vendor, w.vendor)
        w["grand_total"] = w.get("total_amount") or 0
        w["total_paid"] = w.get("amount_paid") or 0
        
        # Parse service_order_list
        raw_list = w.get("service_order_list")
        parsed_items = []
        if raw_list:
            try:
                if isinstance(raw_list, str):
                    data = json.loads(raw_list)
                else:
                    data = raw_list
                
                if isinstance(data, dict):
                    raw_items = data.get("list", [])
                elif isinstance(data, list):
                    raw_items = data
                else:
                    raw_items = []
                    
                # Filter specific fields
                for item in raw_items:
                    parsed_items.append({
                        "description": item.get("description") or item.get("item_name"),
                        "category": item.get("category")
                    })
            except:
                parsed_items = []
        w["items"] = parsed_items
    
    return {"wos": wo_list}

