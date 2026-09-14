# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Non Project Inflows -- money the company receives that belongs to no project and no customer.

ADR-0016 Amendment A. It has NO status: it counts the moment it is saved. Nothing about a project,
customer or CEO Hold may ever read this table (those figures stay about projects and customers).

Controller stays minimal (CLAUDE.md): naming is the JSON `autoname`, the rules below are the only
logic here, and the receipt-adoption hook lives in `integrations/controllers/non_project_inflows.py`.
"""

import frappe
from frappe.model.document import Document
from frappe.utils import flt

INFLOW_TYPES = ("Interest Payouts", "FD Closures", "Loan Received", "Others")
INFLOW_TYPE_OTHERS = "Others"


class NonProjectInflows(Document):
    def validate(self):
        if flt(self.amount) <= 0:
            frappe.throw("Amount must be greater than 0.")
        if self.inflow_type not in INFLOW_TYPES:
            frappe.throw(f"Inflow Type must be one of: {', '.join(INFLOW_TYPES)}.")
        if self.inflow_type == INFLOW_TYPE_OTHERS and not (self.description or "").strip():
            frappe.throw("Description is required when the Inflow Type is Others.")
