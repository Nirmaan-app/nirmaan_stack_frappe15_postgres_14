import frappe

@frappe.whitelist()
def get_material_plan_data(project=None, procurement_package=None, mode=None, po=None, search_type="po"):
    if not project:
        return {"message": {} if not procurement_package else []}

    # 1. Fetch Basic PO List to identify relevant POs and their PR links
    filters = {
        "project": project, 
        "status": ["not in", ["Cancelled", "Merged", "Inactive", "PO Amendment"]]
    }
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


# =============================================================================
# MATERIAL PLAN V2 APIs
# =============================================================================

@frappe.whitelist()
def get_material_plan_data_v2(project=None, task_id=None, search_type="po"):
    """
    V2 API: Fetch POs or items based on Critical PO Task's associated_pos.
    
    Parameters:
        - project: Project ID
        - task_id: Critical PO Tasks document name
        - search_type: "po" (returns PO list) or "item" (returns flat item list)
    
    Returns:
        If search_type="po":
            { "has_pos": bool, "pos": [...], "associated_pos": [...] }
        If search_type="item":
            { "has_pos": bool, "po_list": [...], "items": [...], "associated_pos": [...] }
    """
    import json
    
    if not project or not task_id:
        if search_type == "po":
            return {"has_pos": False, "pos": [], "associated_pos": []}
        else:
            return {"has_pos": False, "po_list": [], "items": [], "associated_pos": []}
    
    try:
        task = frappe.get_doc("Critical PO Tasks", task_id)
    except frappe.DoesNotExistError:
        if search_type == "po":
            return {"has_pos": False, "pos": [], "associated_pos": []}
        else:
            return {"has_pos": False, "po_list": [], "items": [], "associated_pos": []}
    
    # Parse associated_pos - Frappe may auto-parse JSON fields
    # Handle: already dict, string, or None
    raw_associated = task.associated_pos
    associated_pos = []
    
    if raw_associated:
        # If still a string, parse it
        if isinstance(raw_associated, str):
            try:
                raw_associated = json.loads(raw_associated)
            except:
                raw_associated = []
        
        # Now handle dict or list
        if isinstance(raw_associated, dict):
            associated_pos = raw_associated.get("pos", [])
        elif isinstance(raw_associated, list):
            associated_pos = raw_associated
    
    if not associated_pos:
        if search_type == "po":
            return {"has_pos": False, "pos": [], "associated_pos": []}
        else:
            return {"has_pos": False, "po_list": [], "items": [], "associated_pos": []}
    
    # SEARCH TYPE: "item" - Return flat item list
    if search_type == "item":
        all_items = []
        po_list = []
        
        for po_id in associated_pos:
            try:
                doc = frappe.get_doc("Procurement Orders", po_id)
                po_list.append({
                    "name": doc.name,
                    "items_count": len(doc.items) if doc.items else 0,
                    "is_critical": True
                })
                
                if doc.items:
                    for item in doc.items:
                        item_dict = item.as_dict()
                        item_dict["parent"] = po_id
                        item_dict["is_critical_po"] = True
                        all_items.append(item_dict)
                        
            except Exception as e:
                frappe.log_error(f"Error fetching PO items for {po_id}: {str(e)}")
                continue
        
        return {
            "has_pos": True,
            "po_list": po_list,
            "items": all_items,
            "associated_pos": associated_pos
        }
    # SEARCH TYPE: "po" - Return PO list with items
    pos = []
    for po_id in associated_pos:
        try:
            doc = frappe.get_doc("Procurement Orders", po_id)
            pos.append({
                "name": doc.name,
                "items_count": len(doc.items) if doc.items else 0,
                "creation": str(doc.creation),
                "status": doc.status,
                "vendor": doc.vendor,
                "vendor_name": doc.vendor_name,
                "items": [item.as_dict() for item in doc.items] if doc.items else [],
                "is_critical": True
            })
        except Exception as e:
            frappe.log_error(f"Error fetching PO {po_id}: {str(e)}")
            continue
    
    return {"has_pos": True, "pos": pos, "associated_pos": associated_pos}


@frappe.whitelist()
def get_all_project_pos(project):
    """
    Fetch ALL POs for a project. Used for "See All POs" modal.
    
    Returns:
        {
            "pos": [
                {
                    "name": "PO-001",
                    "items_count": 5,
                    "creation": "2026-01-15",
                    "work_package": "Electrical",
                    "items": [...]
                },
                ...
            ]
        }
    """
    if not project:
        return {"pos": []}
    
    # Fetch all active POs for the project
    filters = {
        "project": project, 
        "status": ["not in", ["Cancelled", "Merged", "Inactive", "PO Amendment"]]
    }
    
    po_list = frappe.get_list("Procurement Orders", 
        filters=filters, 
        fields=["name", "procurement_request", "creation", "custom", "status"],
        order_by="creation desc"
    )
    
    if not po_list:
        return {"pos": []}
    
    # Map PR -> Work Package for display
    pr_ids = [p.procurement_request for p in po_list if p.procurement_request]
    pr_package_map = {}
    
    if pr_ids:
        prs = frappe.get_all("Procurement Requests",
            filters={"name": ["in", pr_ids]},
            fields=["name", "work_package"]
        )
        for pr in prs:
            pr_package_map[pr.name] = pr.work_package
    
    import json

    # Fetch global critical POs for the project to flag them
    critical_tasks = frappe.get_all("Critical PO Tasks",
        filters={"project": project},
        fields=["name", "item_name", "critical_po_category", "associated_pos"]
    )
    
    # Map PO Name (trimmed) -> List of Task Details
    po_critical_map = {}
    
    for t in critical_tasks:
        raw = t.associated_pos
        vals = []
        if raw:
            if isinstance(raw, str):
                try:
                    raw = json.loads(raw)
                except:
                    raw = []
            
            if isinstance(raw, dict):
                vals = raw.get("pos", [])
            elif isinstance(raw, list):
                vals = raw
        
        for v in vals:
            if isinstance(v, str):
                po_id = v.strip()
                if po_id not in po_critical_map:
                    po_critical_map[po_id] = []
                
                po_critical_map[po_id].append({
                    "task_name": t.name,
                    "item_name": t.item_name,
                    "category": t.critical_po_category
                })

    pos = []
    for p in po_list:
        try:
            # Determine work package
            if p.custom:
                work_pkg = "Custom"
            else:
                work_pkg = pr_package_map.get(p.procurement_request, "Uncategorized")
            
            doc = frappe.get_doc("Procurement Orders", p.name)
            po_name_trimmed = doc.name.strip()
            associated_tasks = po_critical_map.get(po_name_trimmed, [])
            
            pos.append({
                "name": doc.name,
                "vendor":doc.vendor,
                "vendor_name": doc.vendor_name,
                "items_count": len(doc.items) if doc.items else 0,
                "creation": str(doc.creation),
                "status": doc.status,
                "work_package": work_pkg,
                "is_critical": len(associated_tasks) > 0,
                "associated_tasks": associated_tasks,
                "items": [item.as_dict() for item in doc.items] if doc.items else []
            })
        except Exception as e:
            frappe.log_error(f"Error fetching PO {p.name}: {str(e)}")
            continue
    
    return {"pos": pos}


@frappe.whitelist()
def get_categories_and_tasks(project):
    """
    Fetch all Critical PO Categories and Tasks for a project.
    Used for Category/Task dropdowns in V2.
    
    Returns:
        {
            "categories": ["Structural", "Electrical", ...],
            "tasks": [
                {
                    "name": "task-001",
                    "item_name": "Foundation Materials",
                    "critical_po_category": "Structural",
                    "associated_pos": ["PO-001", "PO-002"],
                    "associated_pos_count": 2
                },
                ...
            ]
        }
    """
    import json
    
    if not project:
        return {"categories": [], "tasks": []}
    
    # Fetch all tasks for this project
    tasks = frappe.get_all("Critical PO Tasks",
        filters={"project": project},
        fields=["name", "item_name", "critical_po_category", "associated_pos", "status", "sub_category"]
    )
    
    # Extract unique categories and parse associated_pos
    categories = set()
    task_list = []
    
    for task in tasks:
        if task.critical_po_category:
            categories.add(task.critical_po_category)
        
        # Parse associated_pos - Frappe may auto-parse JSON fields
        # Handle: already dict, string, or None
        raw_associated = task.associated_pos
        associated_pos = []
        
        if raw_associated:
            # If still a string, parse it
            if isinstance(raw_associated, str):
                try:
                    raw_associated = json.loads(raw_associated)
                except:
                    raw_associated = []
            
            # Now handle dict or list
            if isinstance(raw_associated, dict):
                associated_pos = raw_associated.get("pos", [])
            elif isinstance(raw_associated, list):
                associated_pos = raw_associated
        
        task_list.append({
            "name": task.name,
            "item_name": task.item_name,
            "critical_po_category": task.critical_po_category,
            "associated_pos": associated_pos,
            "associated_pos_count": len(associated_pos),
            "status": task.status,
            "sub_category": task.sub_category
        })
    
    return {
        "categories": sorted(list(categories)),
        "tasks": task_list
    }