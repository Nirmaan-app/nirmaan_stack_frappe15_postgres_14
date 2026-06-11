# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import json

from frappe.model.document import Document


def _is_response_data_meaningful(task) -> bool:
    """A wizard-filled response counts as evidence only when there's a real
    snapshot reference AND parseable, non-empty `responses`."""
    raw = (task.response_data or "").strip()
    if not raw or raw in ("{}", "null"):
        return False
    if not (task.response_snapshot_id or "").strip():
        return False
    try:
        data = json.loads(raw)
    except Exception:
        return False
    return bool(data.get("responses"))


class ProjectCommissionReport(Document):
    def validate(self):
        self.validate_report_evidence_for_completed()
        self.update_last_submitted_date()

    def _get_old_tasks_map(self):
        """Build a lookup of task name -> old task from before save."""
        before_save_doc = self.get_doc_before_save()
        old_tasks_map = {}
        if before_save_doc:
            for t in before_save_doc.get("commission_report_task", []):
                old_tasks_map[t.name] = t
        return old_tasks_map

    def validate_report_evidence_for_completed(self):
        import frappe
        old_tasks_map = self._get_old_tasks_map()
        for task in self.get("commission_report_task", []):
            # Only enforce when a task is newly moved to Completed.
            if task.task_status != "Completed":
                continue

            old_task = old_tasks_map.get(task.name)
            old_status = old_task.task_status if old_task else None
            if old_status == "Completed":
                continue

            has_file_link = bool((task.file_link or "").strip())
            has_attachment = bool(task.approval_proof)
            has_response = _is_response_data_meaningful(task)

            if not (has_file_link or has_attachment or has_response):
                frappe.throw(
                    f"Task '{task.task_name}' requires a report link, an attachment, or a filled wizard response before setting status to Completed.",
                    title="Report Evidence Required"
                )

    def update_last_submitted_date(self):
        import frappe
        from frappe.utils import nowdate

        # Get the previous state of the document
        before_save_doc = self.get_doc_before_save()

        # Create a map of old tasks for quick lookup by name
        old_tasks_map = {}
        if before_save_doc:
            for t in before_save_doc.get("commission_report_task", []):
                old_tasks_map[t.name] = t

        for task in self.get("commission_report_task", []):
            old_task = old_tasks_map.get(task.name)
            old_status = old_task.task_status if old_task else None
            new_status = task.task_status

            # Stamp the date when status newly changes to Completed.
            if new_status == "Completed" and old_status != "Completed":
                task.last_submitted = nowdate()
