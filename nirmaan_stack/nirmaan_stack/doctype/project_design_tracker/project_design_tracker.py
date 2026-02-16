# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class ProjectDesignTracker(Document):
    def validate(self):
        self.validate_file_link_for_submitted()
        self.validate_approval_proof_for_approved()
        self.update_last_submitted_date()

    def validate_file_link_for_submitted(self):
        import frappe
        for task in self.get("design_tracker_task", []):
            if task.task_status == "Submitted" and not task.file_link:
                frappe.throw(
                    f"Task '{task.task_name}' requires a design file link before setting status to Submitted.",
                    title="File Link Required"
                )

    def validate_approval_proof_for_approved(self):
        import frappe
        for task in self.get("design_tracker_task", []):
            if task.task_status == "Approved" and not task.approval_proof:
                frappe.throw(
                    f"Task '{task.task_name}' requires approval proof (screenshot) before setting status to Approved.",
                    title="Approval Proof Required"
                )

    def update_last_submitted_date(self):
        import frappe
        from frappe.utils import nowdate

        # Get the previous state of the document
        before_save_doc = self.get_doc_before_save()
        
        # Create a map of old tasks for quick lookup by name
        old_tasks_map = {}
        if before_save_doc:
            for t in before_save_doc.get("design_tracker_task", []):
                old_tasks_map[t.name] = t

        for task in self.get("design_tracker_task", []):
            # If the task is new (no name yet or not in old map), we treat old status as None/Empty
            old_task = old_tasks_map.get(task.name)
            old_status = old_task.task_status if old_task else None
            new_status = task.task_status

            # Logic: If status changed TO "Submitted" from something else
            if new_status == "Submitted" and old_status != "Submitted":
                task.last_submitted = nowdate()
