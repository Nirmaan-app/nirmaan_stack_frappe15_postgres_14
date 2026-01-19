import frappe
from datetime import datetime, timedelta


@frappe.whitelist()
def get_customer_stats():
    """
    Get customer statistics for the summary card.

    Returns:
        dict: {
            total: int,
            by_state: dict,  # {state_name: count}
            with_projects: int,
            without_projects: int,
            recent_30_days: int
        }
    """
    # Total customers
    total = frappe.db.count("Customers")

    # Count by state (from linked Address)
    state_counts = frappe.db.sql("""
        SELECT
            COALESCE(a.state, 'Unknown') as state,
            COUNT(*) as count
        FROM `tabCustomers` c
        LEFT JOIN `tabAddress` a ON c.company_address = a.name
        GROUP BY COALESCE(a.state, 'Unknown')
        ORDER BY count DESC
    """, as_dict=True)

    by_state = {row["state"]: row["count"] for row in state_counts}

    # Customers with projects
    customers_with_projects = frappe.db.sql("""
        SELECT COUNT(DISTINCT customer)
        FROM `tabProjects`
        WHERE customer IS NOT NULL AND customer != ''
    """)[0][0] or 0

    # Customers without projects
    without_projects = total - customers_with_projects

    # Recent 30 days
    thirty_days_ago = datetime.now() - timedelta(days=30)
    recent_30_days = frappe.db.count(
        "Customers",
        filters={"creation": [">=", thirty_days_ago]}
    )

    return {
        "total": total,
        "by_state": by_state,
        "with_projects": customers_with_projects,
        "without_projects": without_projects,
        "recent_30_days": recent_30_days
    }
