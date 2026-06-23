import frappe
from frappe.utils import today, add_days, getdate


def _to_float(value):
    """Safely coerce a stored amount to float (None / '' / bad data → 0.0)."""
    try:
        return float(value) if value else 0.0
    except (ValueError, TypeError):
        return 0.0


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
    thirty_days_ago = getdate(add_days(today_date, -29))   # inclusive 30-day window

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
        # Requested (L1 Pending)
        'total_requested_payment_count': 0,
        'total_requested_payment_amount': 0.0,
        # CEO Pending
        'total_ceo_pending_count': 0,
        'total_ceo_pending_amount': 0.0,

        # Approved
        'total_approval_done_today': 0,
        'total_approval_done_today_amount': 0.0,
        'total_approval_done_7_days': 0,
        'total_approval_done_7_days_amount': 0.0,
        # CEO Approved
        'total_ceo_approval_done_today': 0,
        'total_ceo_approval_done_today_amount': 0.0,
        'total_ceo_approval_done_7_days': 0,
        'total_ceo_approval_done_7_days_amount': 0.0,
        # Auto Approved (amount below threshold — skipped the L1 + CEO gates)
        'total_auto_approval_today': 0,
        'total_auto_approval_today_amount': 0.0,
        'total_auto_approval_7_days': 0,
        'total_auto_approval_7_days_amount': 0.0,
        # Paid
        'payment_done_today': 0,
        'payment_done_today_amount': 0.0,
        'payment_done_7_days': 0,
        'payment_done_7_days_amount': 0.0,

        # --- Cash flow (last 30 days) ---
        # Inflow: money received (Project Inflows)
        'total_inflow_30_days_count': 0,
        'total_inflow_30_days_amount': 0.0,
        # Project outflow: PO + WO Paid payments + Project Expenses
        'total_project_outflow_30_days_count': 0,
        'total_project_outflow_30_days_amount': 0.0,
        # Non-project outflow: Non Project Expenses
        'total_non_project_expense_30_days_count': 0,
        'total_non_project_expense_30_days_amount': 0.0,
    }

    try:
        # 1. Fetch ALL necessary documents
        all_payments = frappe.get_all(
            doctype,
            fields=['name', 'status', 'amount', 'approval_date', 'ceo_approval_date', 'payment_date', 'auto_approved'],
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
            if status == 'Requested':
                stats['total_requested_payment_count'] += 1
                stats['total_requested_payment_amount'] += amount
            if status == 'CEO Pending':
                stats['total_ceo_pending_count'] += 1
                stats['total_ceo_pending_amount'] += amount
            if status == 'Approved':
                stats['total_pending_payment_count'] += 1
                stats['total_pending_payment_amount'] += amount

            # --- 2b & 2c. APPROVED Check (L1) ---
            # Exclude auto-approved payments — they skipped the L1 gate and are
            # reported under the dedicated Auto Approval metric instead.
            if doc.approval_date and not doc.auto_approved:
                approval_date = doc.approval_date
                
                # Compare as date objects
                if approval_date == today_date:
                    stats['total_approval_done_today'] += 1
                    stats['total_approval_done_today_amount'] += amount
                
                if approval_date >= seven_days_ago and approval_date <= today_date:
                    stats['total_approval_done_7_days'] += 1
                    stats['total_approval_done_7_days_amount'] += amount

            # --- 2c2. CEO APPROVED Check ---
            # Exclude auto-approved payments — they skipped the CEO gate too.
            if doc.ceo_approval_date and not doc.auto_approved:
                ceo_approval_date = doc.ceo_approval_date

                if ceo_approval_date == today_date:
                    stats['total_ceo_approval_done_today'] += 1
                    stats['total_ceo_approval_done_today_amount'] += amount

                if ceo_approval_date >= seven_days_ago and ceo_approval_date <= today_date:
                    stats['total_ceo_approval_done_7_days'] += 1
                    stats['total_ceo_approval_done_7_days_amount'] += amount

            # --- 2c3. AUTO APPROVED Check ---
            # Small payments that auto-approved (skipped L1 + CEO). approval_date is
            # stamped at creation for these, so it is the right window anchor.
            if doc.auto_approved and doc.approval_date:
                auto_approval_date = doc.approval_date

                if auto_approval_date == today_date:
                    stats['total_auto_approval_today'] += 1
                    stats['total_auto_approval_today_amount'] += amount

                if auto_approval_date >= seven_days_ago and auto_approval_date <= today_date:
                    stats['total_auto_approval_7_days'] += 1
                    stats['total_auto_approval_7_days_amount'] += amount


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

                # Project outflow — Paid payments (PO + WO) in the last 30 days.
                # payment_date is only stamped on fulfilment, so this is cash actually out.
                if payment_date >= thirty_days_ago and payment_date <= today_date:
                    stats['total_project_outflow_30_days_count'] += 1
                    stats['total_project_outflow_30_days_amount'] += amount

        # --- 2e2. Project Expenses → also project outflow (last 30 days) ---
        # Folded into the same bucket as PO + WO payments so "Project Outflow"
        # means PO + WO + Project Expenses (matches the Cash Sheet report).
        project_expenses = frappe.get_all(
            "Project Expenses",
            filters={"payment_date": ["between", [thirty_days_ago, today_date]]},
            fields=["amount"],
            limit_page_length=None,
        )
        stats['total_project_outflow_30_days_count'] += len(project_expenses)
        stats['total_project_outflow_30_days_amount'] += sum(
            _to_float(r.amount) for r in project_expenses
        )

        # --- 2f. Inflow (Project Inflows) — last 30 days ---
        inflows = frappe.get_all(
            "Project Inflows",
            filters={"payment_date": ["between", [thirty_days_ago, today_date]]},
            fields=["amount"],
            limit_page_length=None,
        )
        stats['total_inflow_30_days_count'] = len(inflows)
        stats['total_inflow_30_days_amount'] = sum(_to_float(r.amount) for r in inflows)

        # --- 2g. Non-project outflow (Non Project Expenses) — last 30 days ---
        non_project_expenses = frappe.get_all(
            "Non Project Expenses",
            filters={"payment_date": ["between", [thirty_days_ago, today_date]]},
            fields=["amount"],
            limit_page_length=None,
        )
        stats['total_non_project_expense_30_days_count'] = len(non_project_expenses)
        stats['total_non_project_expense_30_days_amount'] = sum(
            _to_float(r.amount) for r in non_project_expenses
        )

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