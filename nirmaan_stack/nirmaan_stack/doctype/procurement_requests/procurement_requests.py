from frappe.model.document import Document
from frappe.model.naming import getseries


class ProcurementRequests(Document):
    # def validate(self):
    #     # Example: Run check only for new documents or drafts
    #     # Adapt the condition as needed for your workflow
    #     if self.is_new() or self.docstatus == 0:
    #         if not validate_procurement_request(self):
    #              frappe.throw("Procurement Request validation failed. Check messages for details.")

    #     pass

    # Packages (`pr_tag_list`) are written from the items by the validate hook
    # (integrations/controllers/procurement_request_packages.py). The PR Tracker reads them
    # live (api/critical_pr_tasks/get_projects_with_pr_stats.py); `Critical PR Tags` records are
    # no longer written.

    def autoname(self):
        project_id = self.project.split("-")[-1]
        prefix = "PR-"
        self.name = f"{prefix}{project_id}-{getseries(prefix, 6)}"
