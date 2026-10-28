# nirmaan_stack/nirmaan_stack/api/projects/project_ledger.py

import frappe
from frappe import _

from nirmaan_stack.api.customers.customer_ledger import receivable_ledger
from nirmaan_stack.services.role_profiles import PROJECT_LEDGER_PROFILES, has_role_profile


@frappe.whitelist()
def get_project_ledger_data(project_id):
    """
    The customer receivable ledger narrowed to one project (Project page ->
    Financials -> Project Ledger): its invoices raised and inflows received,
    date-ordered, same rows and amounts the customer ledger shows for it.

    Filters on `project`, not the project's current customer, so every invoice
    and inflow booked on the project appears even if its customer changed.

    `receivable_ledger` reads with `get_all`, which checks no permission, so
    both checks happen here: the caller's profile must be in
    `PROJECT_LEDGER_PROFILES` (Administrator passes), and the caller must be
    able to read the project (a User Permission limits which projects).
    """
    if not project_id:
        frappe.throw(_("Project ID is a required parameter."))

    user = frappe.session.user
    if not has_role_profile(user, PROJECT_LEDGER_PROFILES):
        raise frappe.PermissionError(_("Only Admin, PMO and Accounts may see the Project Ledger."))
    if not frappe.db.exists("Projects", project_id):
        frappe.throw(_("Project not found."))
    if not frappe.has_permission("Projects", "read", doc=project_id, user=user):
        raise frappe.PermissionError(_("Not permitted to read this project."))

    return receivable_ledger({"project": project_id})
