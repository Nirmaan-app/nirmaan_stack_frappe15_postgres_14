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

# The type rule lives in a pure service so the bank-statement import asks the same one (#1266).
# `INFLOW_TYPES` is re-exported here for the existing doctype tests.
from nirmaan_stack.services.non_project_inflows import (  # noqa: F401
    INFLOW_TYPE_OTHERS,
    INFLOW_TYPES,
    inflow_type_problem,
)


class NonProjectInflows(Document):
    def validate(self):
        if flt(self.amount) <= 0:
            frappe.throw("Amount must be greater than 0.")
        problem = inflow_type_problem(self.inflow_type, self.description)
        if problem:
            frappe.throw(problem)
