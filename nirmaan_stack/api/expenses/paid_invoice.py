# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Upload or replace a Paid expense's invoice from the Payments queue's Payment Done tab (owner, 2026-10-31).

URL: /api/method/nirmaan_stack.api.expenses.paid_invoice.set_paid_expense_invoice

WHO: `role_profiles.PAID_INVOICE_PROFILES` (Admin, Accountant, Accountant Lead, HR Executive, HR Lead). Only
Admin and the Accountant Lead may edit a Paid expense by hand (`expense_decision.edit_access`); this changes
the invoice file, number and date and nothing else, so it is open to more people. The rules are
`expense_decision.save_paid_invoice`.
"""

import frappe

from nirmaan_stack.services.expense_decision import save_paid_invoice
from nirmaan_stack.services.role_profiles import PAID_INVOICE_PROFILES, has_role_profile


@frappe.whitelist(methods=["POST"])
def set_paid_expense_invoice(
    doctype: str, expense: str, invoice_attachment: str, invoice_ref: str, invoice_date: str
) -> dict:
    """Set the invoice of Paid expense `expense` (`doctype`: Project Expenses or Non Project Expenses),
    replacing any it had. `invoice_attachment` is the File URL already on it, or one the caller just uploaded
    (unattached). All three are required; the date may not be after today.

    Example: `{"doctype": "Non Project Expenses", "expense": "NPE-0042", "invoice_attachment":
    "/private/files/bill.pdf", "invoice_ref": "INV-77", "invoice_date": "2026-10-30"}` -> `{"name": "NPE-0042"}`.
    """
    user = frappe.session.user
    if not has_role_profile(user, PAID_INVOICE_PROFILES):
        frappe.throw("Only Admin, Accounts or HR can add a paid expense's invoice.", frappe.PermissionError,
                     title="Not permitted")
    save_paid_invoice(doctype, expense, {
        "invoice_attachment": invoice_attachment,
        "invoice_ref": invoice_ref,
        "invoice_date": invoice_date,
    }, user)
    frappe.db.commit()
    return {"name": expense}
