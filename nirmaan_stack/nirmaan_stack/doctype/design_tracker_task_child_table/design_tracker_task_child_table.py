# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class DesignTrackerTaskChildTable(Document):
    def validate(self):
        self.validate_file_link_for_submitted()
        self.validate_approval_proof_for_approved()

    def validate_file_link_for_submitted(self):
        if self.task_status == "Submitted" and not self.file_link:
            frappe.throw(
                f"Task '{self.task_name}' requires a design file link before setting status to Submitted.",
                title="File Link Required"
            )

    def validate_approval_proof_for_approved(self):
        if self.task_status == "Approved" and not self.approval_proof:
            frappe.throw(
                f"Task '{self.task_name}' requires approval proof (screenshot) before setting status to Approved.",
                title="Approval Proof Required"
            )
