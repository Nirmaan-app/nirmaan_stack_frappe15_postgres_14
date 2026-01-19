
import frappe
from frappe import _
from frappe.utils import cint

# Roles that require project-level filtering based on user permissions
FILTERED_ACCESS_ROLES = {
    "Nirmaan Project Manager Profile",
   
    "Nirmaan Procurement Executive Profile",
}

# Roles with full access to all projects
FULL_ACCESS_ROLES = {
    "Nirmaan Admin Profile",
    "Nirmaan Project Lead Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Accountant Profile",
    "Nirmaan Design Lead Profile",
    "Nirmaan Design Executive Profile",
    "Nirmaan HR Executive Profile",
}


def _get_user_role(user: str) -> str:
    """Get the role profile for a user from Nirmaan Users."""
    if user == "Administrator":
        return "Administrator"

    role = frappe.db.get_value("Nirmaan Users", user, "role_profile")
    return role or ""


def _get_allowed_projects(user: str) -> list[str]:
    """
    Get list of projects the user has access to via Nirmaan User Permissions.
    """
    return frappe.get_all(
        "Nirmaan User Permissions",
        filters={"user": user, "allow": "Projects"},
        pluck="for_value",
    )


def _should_filter_by_permissions(user: str, role: str) -> bool:
    """
    Determine if the user should see filtered projects based on role.

    Returns:
        True if user should only see their assigned projects
        False if user has full access to all projects
    """
    # Administrator and full-access roles see everything
    if user == "Administrator" or role in FULL_ACCESS_ROLES:
        return False

    # These roles see only their assigned projects
    if role in FILTERED_ACCESS_ROLES:
        return True

    # Default: show all (for any other roles not explicitly defined)
    return False


@frappe.whitelist()
def get_tds_request_list(
    start=0,
    page_length=50,
    tab="Pending Approval",
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

    # --- Permission Check ---
    current_user = frappe.session.user
    role = _get_user_role(current_user)

    if _should_filter_by_permissions(current_user, role):
        allowed_projects = _get_allowed_projects(current_user)
        if not allowed_projects:
            # User has restricted access but no assigned projects
            return {
                "data": [],
                "total_count": 0,
                "tab_counts": {"pending": 0, "approved": 0, "rejected": 0, "all": 0}
            }
        
        conditions.append("tdsi_project_id IN %(allowed_projects)s")
        values['allowed_projects'] = allowed_projects
    # ------------------------

    
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
        p = (row.pending_count or 0) > 0
        a = (row.approved_count or 0) > 0
        r = (row.rejected_count or 0) > 0
        
        if p and a and r:
            row.status = "PAR"
        elif p and a:
            row.status = "PA"
        elif p and r:
            row.status = "PR"
        elif a and r:
            row.status = "AR"
        elif p:
            row.status = "Pending"
        elif r:
            row.status = "Rejected"
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
    
    # Tab counts for badges (ignores current tab filter but respects permissions)
    tab_conditions = ["docstatus != 2"]
    if 'allowed_projects' in values:
        tab_conditions.append("tdsi_project_id IN %(allowed_projects)s")
    
    tab_where = "WHERE " + " AND ".join(tab_conditions)

    tab_counts_sql = f"""
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
            {tab_where}
            GROUP BY tds_request_id
        ) as sub
    """
    tab_counts_result = frappe.db.sql(tab_counts_sql, values, as_dict=True)[0]
    
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

