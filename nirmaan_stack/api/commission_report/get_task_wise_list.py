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
    is_design_executive=False,
    task_phase=None
):
    """
    Custom API to fetch flattened Commission Report Tasks.
    """
    start = cint(limit_start)
    page_length = cint(limit_page_length) if limit_page_length else 50
    
    try:
        projects = frappe.get_list(
            "Project Commission Report", 
            fields=["name", "project_name","project"], 
            limit_page_length=999999
        )
    except Exception as e:
        frappe.log_error(f"Permission Fetch Error: {e}")
        return {"data": [], "total_count": 0}

    if not projects:
        return {"data": [], "total_count": 0}

    flattened_tasks = []
    
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

    for p in projects:
        try:
            doc = frappe.get_doc("Project Commission Report", p.name)

            if doc.get("hide_commission_report"):
                continue

            if not doc.commission_report_task:
                continue
                
            for t in doc.commission_report_task:
                if task_phase and t.get("task_phase") != task_phase:
                    continue

                row = t.as_dict()
                row['project_name'] = doc.project_name
                row['project'] = doc.project
                row['prjname'] = doc.name
                row['name'] = t.name
                
                if check_design_exec:
                    ad_str = str(row.get('assigned_designers') or "")
                    if user_id not in ad_str:
                        continue

                if term_lower:
                    found = False
                    if row.get('task_name') and term_lower in str(row.get('task_name')).lower(): found = True
                    elif row.get('commission_category') and term_lower in str(row.get('commission_category')).lower(): found = True
                    elif row.get('project_name') and term_lower in str(row.get('project_name')).lower(): found = True
                    elif row.get('task_zone') and term_lower in str(row.get('task_zone')).lower(): found = True
                    
                    if not found:
                        continue
                        
                filter_fail = False
                for f in ui_filters:
                    if len(f) == 4: field, op, val = f[1], f[2], f[3]
                    else: field, op, val = f[0], f[1], f[2]
                    
                    if field == 'assigned_designers':
                         row_val = str(row.get('assigned_designers') or "")
                    else:
                         row_val = row.get(field)
                    
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
                            if field == 'assigned_designers':
                                match_found = False
                                for v in val:
                                    if str(v) in row_val:
                                        match_found = True
                                        break
                                if not match_found: filter_fail = True
                            else:
                                if row_val not in val: filter_fail = True
                    elif op_lower == 'not in':
                        if isinstance(val, list):
                            if row_val in val: filter_fail = True
                    elif op_lower == 'between':
                        if isinstance(val, (list, tuple)) and len(val) == 2:
                            try:
                                d_val = getdate(row_val) if row_val else None
                                start_date = getdate(val[0]) if val[0] else None
                                end_date = getdate(val[1]) if val[1] else None
                                
                                if start_date and end_date:
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
                            if s_row != s_val: filter_fail = True
                    
                    if filter_fail: break
                
                if filter_fail:
                    continue
                    
                flattened_tasks.append(row)

        except Exception as e:
            continue

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
                if isinstance(val, str):
                    return (val is None, val.lower())
                return (val is None, val)
            
            flattened_tasks.sort(key=sort_key, reverse=not ascending)
        else:
            flattened_tasks.sort(key=lambda x: (x.get('deadline') is None, x.get('deadline')), reverse=False)
    except Exception as e:
        frappe.log_error(f"Task Sorting Error: {str(e)}")

    total_count = len(flattened_tasks)
    end = start + page_length
    paginated_data = flattened_tasks[start:end]

    return {
        "data": paginated_data,
        "total_count": total_count
    }
