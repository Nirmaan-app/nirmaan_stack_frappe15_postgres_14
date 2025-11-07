import frappe
from frappe.utils import today, add_days, getdate

@frappe.whitelist(allow_guest=False)
def get_payment_dashboard_stats():
    """
    Fetches aggregated statistics for Project Payments (Pending, Approved, Paid),
    including both count and amount for all time-based metrics.
    
    This function aggregates data in Python to ensure cross-database compatibility 
    and reliable date comparisons using getdate().
    """
    
    doctype = 'Project Payments'
    
    # Date calculations (All converted to datetime.date objects for reliable comparison)
    today_date = getdate(today())
    seven_days_ago = getdate(add_days(today_date, -6))

    # --- DEBUGGING PRINT STATEMENTS ---
    # Keeping top-level date information for context
    print(f"\n--- Payment Dashboard Stats Debug ---")
    print(f"Today's Date (for comparison): {today_date.strftime('%Y-%m-%d')}")
    print(f"7 Days Ago Date (for comparison): {seven_days_ago.strftime('%Y-%m-%d')}")
    # ----------------------------------

    # Initialize raw statistics accumulator
    stats = {
        # Pending
        'total_pending_payment_count': 0,
        'total_pending_payment_amount': 0.0,
        # Approved
        'total_approval_done_today': 0,
        'total_approval_done_today_amount': 0.0,
        'total_approval_done_7_days': 0,
        'total_approval_done_7_days_amount': 0.0,
        # Paid
        'payment_done_today': 0,
        'payment_done_today_amount': 0.0,
        'payment_done_7_days': 0,
        'payment_done_7_days_amount': 0.0,
    }

    try:
        # 1. Fetch ALL necessary documents
        all_payments = frappe.get_all(
            doctype,
            fields=['name', 'status', 'amount', 'approval_date', 'payment_date'],
            limit_page_length=None 
        )
        
        # 2. Python Aggregation (Manual Calculation)
        for doc in all_payments:
            status = doc.status
            
            # Safely convert amount to float
            try:
                amount = float(doc.amount) if doc.amount else 0.0
            except (ValueError, TypeError):
                amount = 0.0
            
            # --- 2a. PENDING Check ---
            # FIX: The correct check for Pending is NOT IN ['Rejected', 'Approved', 'Paid']
            if status not in ['Rejected', 'Paid']:
                stats['total_pending_payment_count'] += 1
                stats['total_pending_payment_amount'] += amount

            # --- 2b & 2c. APPROVED Check ---
            if doc.approval_date:
                approval_date = doc.approval_date
                
                # Compare as date objects
                if approval_date == today_date:
                    stats['total_approval_done_today'] += 1
                    stats['total_approval_done_today_amount'] += amount
                
                if approval_date >= seven_days_ago and approval_date <= today_date:
                    stats['total_approval_done_7_days'] += 1
                    stats['total_approval_done_7_days_amount'] += amount
                

            # --- 2d & 2e. PAID Check ---
            if doc.payment_date:
                payment_date = doc.payment_date

                # Paid Today
                if payment_date == today_date:
                    stats['payment_done_today'] += 1
                    stats['payment_done_today_amount'] += amount
                
                # Paid Last 7 Days (inclusive)
                if payment_date >= seven_days_ago and payment_date <= today_date:
                    stats['payment_done_7_days'] += 1
                    stats['payment_done_7_days_amount'] += amount
        
        # 3. Return the dictionary of statistics
        # --- DEBUGGING PRINT STATEMENT ---
        print(f"--- Finished Processing. Returning Stats: {stats}")
        # ---------------------------------
        
        return stats

    except Exception as e:
        # 4. Handle and throw the error
        frappe.db.rollback() 
        
        frappe.log_error(f"Error fetching payment dashboard stats: {e}", "Payment Stats API Error - Rolled Back")
        
        frappe.throw(f"An unexpected error occurred while fetching payment statistics: {e}")