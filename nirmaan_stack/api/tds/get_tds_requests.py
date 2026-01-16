
import frappe
from frappe import _
from frappe.utils import cint

@frappe.whitelist()
def get_tds_request_list(
    start=0,
    page_length=50,
    tab="Pending Approval",  # Tabs: "Pending Approval", "Approved", "Rejected", "All TDS"
    search_term=None,
    user_id=None
):
    """
    Fetches grouped TDS Requests from 'Project TDS Item List'.
    Groups items by 'request_id' and computes aggregated status.
    """
    start = cint(start)
    page_length = cint(page_length)
    
    # Base SQL
    # Note: We group by request_id. 
    # We aggregate status counts to determine the overall request status.
    
    conditions = []
    values = {}
    
    # 1. Search Filter
    if search_term:
        conditions.append("""
            (tds_request_id LIKE %(search)s OR 
             tdsi_project_name LIKE %(search)s OR 
             owner LIKE %(search)s)
        """)
        values['search'] = f"%{search_term}%"

    # Tab Logic
    # Treat NULL/empty tds_status as 'Pending'
    pending_expr = "SUM(CASE WHEN tds_status = 'Pending' OR tds_status IS NULL OR tds_status = '' THEN 1 ELSE 0 END)"
    rejected_expr = "SUM(CASE WHEN tds_status = 'Rejected' THEN 1 ELSE 0 END)"
    approved_expr = "SUM(CASE WHEN tds_status = 'Approved' THEN 1 ELSE 0 END)"
    total_expr = "COUNT(name)"
    
    having_clause = ""
    if tab == "Pending Approval":
        # Show requests that have ANY pending items
        having_clause = f"HAVING {pending_expr} > 0"
    elif tab == "Approved":
        # Show requests where ALL items are approved (no pending, no rejected)
        having_clause = f"HAVING {approved_expr} > 0"
    elif tab == "Rejected":
        # Show requests that have ANY rejected items
        having_clause = f"HAVING {rejected_expr} > 0"  
    
    where_clause = " AND ".join(conditions)
    if where_clause:
        where_clause = "WHERE " + where_clause
        
    sql_query = f"""
        SELECT 
            tds_request_id as request_id,
            MAX(tdsi_project_name) as project,
            MIN(creation) as creation,
            COUNT(name) as total_items,
            MAX(owner) as created_by,
            SUM(CASE WHEN tds_status = 'Pending' OR tds_status IS NULL OR tds_status = '' THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN tds_status = 'Rejected' THEN 1 ELSE 0 END) as rejected_count,
            SUM(CASE WHEN tds_status = 'Approved' THEN 1 ELSE 0 END) as approved_count
        FROM `tabProject TDS Item List`
        {where_clause}
        {'AND' if where_clause else 'WHERE'} docstatus != 2
        GROUP BY tds_request_id
        {having_clause}
        ORDER BY creation DESC
        LIMIT %(page_length)s OFFSET %(start)s
    """
    
    values['page_length'] = page_length
    values['start'] = start
    
    data = frappe.db.sql(sql_query, values, as_dict=True)
    
    # derived status for UI
    for row in data:
        if row.rejected_count > 0:
            row.status = "Rejected"
        elif row.pending_count > 0:
            row.status = "Pending"
        else:
            row.status = "Approved"
            
    # Count Query (Approximate for pagination - difficult with GROUP BY + HAVING efficiently)
    # common pattern: SELECT COUNT(*) FROM (SELECT ... GROUP BY ... HAVING ...) as sub
    
    count_sql = f"""
        SELECT COUNT(*) as total FROM (
            SELECT tds_request_id,
            SUM(CASE WHEN tds_status = 'Pending' OR tds_status IS NULL OR tds_status = '' THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN tds_status = 'Rejected' THEN 1 ELSE 0 END) as rejected_count,
            SUM(CASE WHEN tds_status = 'Approved' THEN 1 ELSE 0 END) as approved_count,
            COUNT(name) as total_count
            FROM `tabProject TDS Item List`
            {where_clause}
            {'AND' if where_clause else 'WHERE'} docstatus != 2
            GROUP BY tds_request_id
            {having_clause}
        ) as sub
    """
    total_count = frappe.db.sql(count_sql, values)[0][0]
    
    # Tab counts for badges (ignores current tab filter)
    tab_counts_sql = """
        SELECT 
            COUNT(DISTINCT CASE WHEN pending_count > 0 THEN tds_request_id END) as pending,
            COUNT(DISTINCT CASE WHEN approved_count > 0 THEN tds_request_id END) as approved,
            COUNT(DISTINCT CASE WHEN rejected_count > 0 THEN tds_request_id END) as rejected,
            COUNT(DISTINCT tds_request_id) as all_count
        FROM (
            SELECT 
                tds_request_id,
                SUM(CASE WHEN tds_status = 'Pending' OR tds_status IS NULL OR tds_status = '' THEN 1 ELSE 0 END) as pending_count,
                SUM(CASE WHEN tds_status = 'Rejected' THEN 1 ELSE 0 END) as rejected_count,
                SUM(CASE WHEN tds_status = 'Approved' THEN 1 ELSE 0 END) as approved_count,
                COUNT(name) as total_count
            FROM `tabProject TDS Item List`
            WHERE docstatus != 2
            GROUP BY tds_request_id
        ) as sub
    """
    tab_counts_result = frappe.db.sql(tab_counts_sql, as_dict=True)[0]
    
    return {
        "data": data,
        "total_count": total_count,
        "tab_counts": {
            "pending": tab_counts_result.get("pending", 0),
            "approved": tab_counts_result.get("approved", 0),
            "rejected": tab_counts_result.get("rejected", 0),
            "all": tab_counts_result.get("all_count", 0)
        }
    }

