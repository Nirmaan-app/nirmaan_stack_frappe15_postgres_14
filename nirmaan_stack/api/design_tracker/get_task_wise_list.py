import frappe
from frappe import _
from frappe.utils import cint, getdate
import json

@frappe.whitelist()
def get_task_wise_list(
    doctype=None,
    fields=None,
    filters=None,
    order_by="deadline asc",
    limit_start=0,
    limit_page_length=50,
    search_term=None,
    user_id=None,
    is_design_executive=False
):
    """
    Custom API to fetch flattened Design Tracker Tasks.
    METHOD: Fetch Parent List -> Iteratively Fetch Full Docs -> Flatten.
    This relies on 'frappe.get_doc' logic which is permission-safe and simple.
    """
    start = cint(limit_start)
    page_length = cint(limit_page_length) if limit_page_length else 50
    
    # 1. PERMISSION SCOPE: Get Allowed Projects
    try:
        # Fetch all allowed projects (names only for speed)
        # 999999 limit to ensure we see everything the user is conducting
        projects = frappe.get_list(
            "Project Design Tracker", 
            fields=["name", "project_name","project"], 
            limit_page_length=999999
        )
    except Exception as e:
        frappe.log_error(f"Permission Fetch Error: {e}")
        return {"data": [], "total_count": 0}

    if not projects:
        return {"data": [], "total_count": 0}

    # Map for easy lookup if needed, though we will iterate directly
    # project_map = {p.name: p.project_name for p in projects}

    # 2. ITERATIVE FETCH & FLATTEN
    # We load each project document fully to access its child tasks.
    # This matches the logic the user requested ("fetch they whole parent list with child table")
    
    flattened_tasks = []
    
    # Pre-parse filters for Python-side filtering
    ui_filters = []
    if filters:
        if isinstance(filters, str):
            try:
                ui_filters = json.loads(filters)
            except: pass
        elif isinstance(filters, list):
            ui_filters = filters

    term_lower = search_term.lower() if search_term else None
    check_design_exec = (str(is_design_executive).lower() == 'true') and user_id

    # Optimization: Filter projects by search term beforehand?
    # No, search term might match task name (child), so we must check children.
    
    for p in projects:
        try:
            # Skip if project name doesn't match search term? 
            # NO, because a task inside might match.
            
            # Fetch Full Doc (Cached preferably? No, get_doc hits DB usually unless key-value cached)
            # frappe.get_doc allows us to access .design_tracker_task
            doc = frappe.get_doc("Project Design Tracker", p.name)
            
            if not doc.design_tracker_task:
                continue
                
            for t in doc.design_tracker_task:
                # --- FLATTENING ---
                # Create a dict representing the Task Row + Project Info
                row = t.as_dict()
                row['project_name'] = doc.project_name
                row['project'] = doc.project
                row['prjname'] = doc.name
                row['name'] = t.name # Ensure child name is primary ID
                
                # --- FILTERING (Python Side) ---
                
                # A. User Filter (Design Executive)
                if check_design_exec:
                    ad_str = str(row.get('assigned_designers') or "")
                    if user_id not in ad_str:
                        continue

                # B. Search Term
                if term_lower:
                    found = False
                    if row.get('task_name') and term_lower in str(row.get('task_name')).lower(): found = True
                    elif row.get('design_category') and term_lower in str(row.get('design_category')).lower(): found = True
                    elif row.get('project_name') and term_lower in str(row.get('project_name')).lower(): found = True
                    elif row.get('task_zone') and term_lower in str(row.get('task_zone')).lower(): found = True # Include Zone in Logic
                    
                    if not found:
                        continue
                        
                # C. UI Filters (Facets)
                filter_fail = False
                for f in ui_filters:
                    # [field, op, val] or [doctype, field, op, val]
                    if len(f) == 4: field, op, val = f[1], f[2], f[3]
                    else: field, op, val = f[0], f[1], f[2]
                    
                    
                    # Handle Assigned Designers filter explicitly
                    if field == 'assigned_designers':
                         # The value in row is a JSON string.
                         # The filter val is a list of names/IDs.
                         row_val = str(row.get('assigned_designers') or "")
                    else:
                         row_val = row.get(field)
                    
                    # Convert to string for safer comparison
                    s_row = str(row_val) if row_val is not None else ""
                    s_val = str(val) if val is not None else ""
                    
                    
                    op_lower = op.lower()
                    
                    if op_lower == '=':
                        if s_row != s_val: filter_fail = True
                    elif op_lower == '!=':
                        if s_row == s_val: filter_fail = True
                    elif op_lower == 'like':
                        if s_val.replace('%','').lower() not in s_row.lower(): filter_fail = True
                    elif op_lower == 'in':
                        if isinstance(val, list):
                            # Special handling for assigned_designers (substring search in JSON)
                            if field == 'assigned_designers':
                                # row_val is the JSON string. val is list of target strings.
                                # If ANY target is in the JSON string, it's a match.
                                match_found = False
                                for v in val:
                                    if str(v) in row_val:
                                        match_found = True
                                        break
                                if not match_found: filter_fail = True
                            else:
                                if row_val not in val: filter_fail = True
                    elif op_lower == 'between':
                        if isinstance(val, (list, tuple)) and len(val) == 2:
                            try:
                                d_val = getdate(row_val) if row_val else None
                                start_date = getdate(val[0]) if val[0] else None
                                end_date = getdate(val[1]) if val[1] else None
                                
                                if start_date and end_date:
                                    # Strict: If row has no date, it fails the filter
                                    if not d_val: 
                                        filter_fail = True
                                    elif not (start_date <= d_val <= end_date): 
                                        filter_fail = True
                            except: pass
                    elif op_lower in ['>', '<', '>=', '<=']:
                        try:
                            d_val = getdate(row_val) if row_val else None
                            comp_val = getdate(val) if val else None
                            
                            if comp_val:
                                if not d_val:
                                    filter_fail = True
                                elif op_lower == '>' and not (d_val > comp_val): filter_fail = True
                                elif op_lower == '<' and not (d_val < comp_val): filter_fail = True
                                elif op_lower == '>=' and not (d_val >= comp_val): filter_fail = True
                                elif op_lower == '<=' and not (d_val <= comp_val): filter_fail = True
                        except: pass
                    elif op_lower == 'is':
                        if val == 'set': 
                            if not row_val: filter_fail = True
                        elif val == 'not set':
                            if row_val: filter_fail = True
                        else:
                            # Treat 'is' value as equality (e.g. Is 2025-12-23)
                            if s_row != s_val: filter_fail = True
                    
                    if filter_fail: break
                
                if filter_fail:
                    continue
                    
                flattened_tasks.append(row)

        except Exception as e:
            # Skip project if load fails
            continue

    # 3. SORTING
    try:
        if order_by:
            parts = order_by.split()
            sort_field = parts[0]
            if "." in sort_field: sort_field = sort_field.split(".")[-1]
            ascending = True
            if len(parts) > 1 and "desc" in parts[1].lower():
                ascending = False
            
            def sort_key(x):
                val = x.get(sort_field)
                # Handle date sorting specially? String compare usually works for ISO dates
                return val if val is not None else ""
            
            flattened_tasks.sort(key=sort_key, reverse=not ascending)
        else:
             flattened_tasks.sort(key=lambda x: x.get('deadline') or "", reverse=False)
    except:
        pass

    # 4. PAGINATION
    total_count = len(flattened_tasks)
    end = start + page_length
    paginated_data = flattened_tasks[start:end]

    return {
        "data": paginated_data,
        "total_count": total_count
    }
