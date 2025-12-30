import frappe

@frappe.whitelist()
def get_material_plan_data(project=None, procurement_package=None, mode=None, po=None, search_type="po"):
    if not project:
        return {"message": {} if not procurement_package else []}

    # 1. Fetch Basic PO List to identify relevant POs and their PR links
    filters = {"project": project, "status": ["!=", "Cancelled"]}
    if po:
        filters["name"] = po

    pos = frappe.get_list("Procurement Orders", 
        filters=filters, 
        fields=["name", "procurement_request", "creation", "custom"],
        order_by="creation desc"
    )
    
    if not pos:
        return {"message": {} if not procurement_package else []}

    # 2. Map PR -> Work Package
    pr_ids = [p.procurement_request for p in pos if p.procurement_request]
    pr_package_map = {}
    
    if pr_ids:
        # We need the 'work_package' field from Procurement Requests
        # This corresponds to the 'Procurement Package'
        prs = frappe.get_all("Procurement Requests",
            filters={"name": ["in", pr_ids]},
            fields=["name", "work_package"]
        )
        for pr in prs:
            pr_package_map[pr.name] = pr.work_package

    # 3. Associate POs with Packages
    # We will store (po_name, package_name) tuples or extend the dict
    po_list_with_pkg = []
    for p in pos:
        pkg = pr_package_map.get(p.procurement_request)
        
        # Determine Package
        if p.custom:
            p_pkg = "Custom"
        elif pkg:
            p_pkg = pkg
        else:
            p_pkg = "Uncategorized"
        
        # If we are filtering by package, check now
        if procurement_package and p_pkg != procurement_package:
            continue
            
        po_list_with_pkg.append({
            "name": p.name,
            "package": p_pkg
        })

    # SCENARIO: Search Type = "item"
    # Return items belonging to the filtered POs
    if search_type == "item":
        po_names = [x["name"] for x in po_list_with_pkg]
        if not po_names:
            return []
            
        all_items = []
        for po_name in po_names:
            try:
                doc = frappe.get_doc("Procurement Orders", po_name)
                # doc.items is a list of child docs
                for item in doc.items:
                    item_dict = item.as_dict()
                    # Ensure parent is set for frontend linking
                    item_dict["parent"] = po_name 
                    all_items.append(item_dict)
            except Exception as e:
                frappe.log_error(f"Error fetching PO items for {po_name}: {str(e)}")
                
        return all_items

    # 4. Fetch Full Docs for remaining POs
    # User requested `frappe.get_doc`
    final_pos = []
    for item in po_list_with_pkg:
        po_name = item["name"]
        pkg_name = item["package"]
        
        try:
            doc = frappe.get_doc("Procurement Orders", po_name)
            po_dict = doc.as_dict()
            
            # Inject calculated package for frontend grouping/display
            po_dict["procurement_package"] = pkg_name
            
            # 5. Compatibility Fixes
            # Fix 1: delivery_date
            po_dict["delivery_date"] = po_dict.get("latest_delivery_date")
            
            # Fix 2: Items `quote` -> `rate`
            if po_dict.get("items"):
                for pol_item in po_dict["items"]:
                    # Ensure rate exists for frontend
                    if "quote" in pol_item:  
                        pol_item["rate"] = pol_item["quote"]
                    # Add package to item (optional, for row display)
                    pol_item["procurement_package"] = pkg_name

            final_pos.append(po_dict)
            
        except Exception as e:
            frappe.log_error(f"Error fetching PO {po_name}: {str(e)}")
            continue

    # SCENARIO 1: Specific Package Request (List) OR Explicit List Mode
    if procurement_package or mode == "list":
        return final_pos

    # SCENARIO 2: Full Plan (Grouped by Package)
    grouped_data = {}
    for po in final_pos:
        pkg = po.get("procurement_package", "Uncategorized")
        
        if pkg not in grouped_data:
            grouped_data[pkg] = {
                "package_doc": {}, 
                "orders": []
            }
        grouped_data[pkg]["orders"].append(po)

    return  grouped_data

@frappe.whitelist()
def get_po_items(po):
    if not po:
        return []
        
    items = frappe.get_all("Procurement Orders", 
        filters={"parent": po},
        fields=["name", "item_name", "item_code", "quantity", "uom", "rate"]
    )
    return items