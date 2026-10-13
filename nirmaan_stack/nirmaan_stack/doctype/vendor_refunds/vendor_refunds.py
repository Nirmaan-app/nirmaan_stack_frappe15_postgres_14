# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Vendor Refunds -- money a vendor paid back to the company, against ONE PO or Work Order of that
vendor on a project, or against no document at all (a Misc. Expense).

Created from a bank-statement credit on the Bulk Import Transactions screen: a credit split across
three POs and a misc remainder becomes four records, each `Received` from the moment it is saved.

STATUS (#1398, ADR-0032): `Reconciliation Pending` (recorded before its bank line), `Received` (a bank
line is matched to it, or it was recorded from one) or `Cancelled`. Which status counts for what lives
in `services/vendor_refunds` (`LOWERS_PAID_STATUSES`, `TAKES_REFUNDABLE_STATUSES`).

⚠️ A RECEIVED REFUND LOWERS ITS PO'S / WORK ORDER'S `amount_paid` (owner, 2026-09-17): the stored figure
is the Paid payments LESS the Received refunds, recomputed on every save and delete by
`integrations/controllers/vendor_refunds`, which also recounts the vendor's credit. It creates no Project Payment. Recording the same money
through the PO Adjustment "Vendor has refund" flow as well would lower the paid amount twice.
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
