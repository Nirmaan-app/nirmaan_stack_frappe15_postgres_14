# nirmaan_stack/nirmaan_stack/api/projects/project_ledger.py

import frappe

from nirmaan_stack.api.customers.customer_ledger import receivable_ledger


@frappe.whitelist()
def get_project_ledger_data(project_id):
    """
    The customer receivable ledger narrowed to one project (Project page ->
    Financials -> Project Ledger): its invoices raised and inflows received,
    date-ordered, same rows and amounts the customer ledger shows for it.

    Filters on `project`, not the project's current customer, so every invoice
    and inflow booked on the project appears even if its customer changed.
    """
    if not project_id:
        frappe.throw("Project ID is a required parameter.")

    return receivable_ledger({"project": project_id})
