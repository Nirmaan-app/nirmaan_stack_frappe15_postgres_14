# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Vendor Refunds -- money a vendor paid back to the company, against ONE PO or Work Order of that
vendor on a project, or against no document at all (a Misc. Expense).

Created from a bank-statement credit on the Bulk Import Transactions screen: a credit split across
three POs and a misc remainder becomes four records. It has NO status -- it counts the moment it is saved, like the other
inflow books (`Project Inflows`, `Non Project Inflows`).

⚠️ IT MOVES NO PO, WORK ORDER, EXPENSE OR VENDOR PAID AMOUNT, and creates no Project Payment. The
document is a reference; the PO Adjustment "Vendor has refund" flow is still the path that lowers a
PO's paid amount.
"""

import frappe
from frappe.model.document import Document

# The rule lives in a service so the bank-statement import asks the same one.
from nirmaan_stack.services.vendor_refunds import document_project, refund_document_problem


class VendorRefunds(Document):
    def validate(self):
        # A PO / WO refund is on its document's project; fill it when left blank.
        if not self.project:
            self.project = document_project(self.document_type, self.document_name)
        problem = refund_document_problem(
            self.vendor,
            self.project,
            self.document_type,
            self.document_name,
            self.amount,
            exclude_refund=None if self.is_new() else self.name,
        )
        if problem:
            frappe.throw(problem)
