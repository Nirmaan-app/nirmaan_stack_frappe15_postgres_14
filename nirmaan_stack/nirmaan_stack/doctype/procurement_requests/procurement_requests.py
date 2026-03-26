import frappe
import json
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
    
    def autoname(self):
        project_id = self.project.split("-")[-1]
        prefix = "PR-"
        self.name = f"{prefix}{project_id}-{getseries(prefix, 6)}"

    def after_insert(self):
        # When a new PR is created, add all its tags
        for tag in self.pr_tag_list:
            print(f"after_insert PR")
            self.update_single_critical_tag(tag, add=True)

    def on_update(self):
        print(f"On_update PR")
        # If the PR is already submitted/cancelled, don't update tags here 
        # (unless business logic requires tracking changes after submission)
        if self.docstatus != 0:
            print(f"Doc status=0")
            return

        old_doc = self.get_doc_before_save()
        if not old_doc:
            print(f"No Old Doc")
            return

        # Compare old and new tags
        old_tags = {(t.tag_header, t.tag_package) for t in old_doc.pr_tag_list}
        new_tags = {(t.tag_header, t.tag_package) for t in self.pr_tag_list}

        # Tags to remove: in old but not in new
        removed_tags = old_tags - new_tags
        for header, package in removed_tags:
            print(f"Removed Tags")
            tag_stub = frappe._dict({"tag_header": header, "tag_package": package})
            self.update_single_critical_tag(tag_stub, add=False)

        # Tags to add: in new but not in old
        added_tags = new_tags - old_tags
        for header, package in added_tags:
            print(f"Added Tags")
            tag_stub = frappe._dict({"tag_header": header, "tag_package": package})
            self.update_single_critical_tag(tag_stub, add=True)

    def on_cancel(self):
        # When cancelled, remove all current tags
        for tag in self.pr_tag_list:
            self.update_single_critical_tag(tag, add=False)

    def update_single_critical_tag(self, tag, add=True):
        """Helper to add/remove a single tag reference."""
        filters = {
            "project": self.project,
            "header": tag.tag_header,
            "package": tag.tag_package
        }
        
        critical_tag_doc_name = frappe.db.get_value("Critical PR Tags", filters, "name")
        
        if critical_tag_doc_name:
            doc = frappe.get_doc("Critical PR Tags", critical_tag_doc_name)
            
            # Robust JSON loading
            if isinstance(doc.associated_prs, str):
                data = json.loads(doc.associated_prs)
            else:
                data = doc.associated_prs or {"prs": []}
            
            if not isinstance(data, dict) or "prs" not in data:
                data = {"prs": []}
            
            prs = data["prs"]
            
            if add:
                if self.name not in prs:
                    prs.append(self.name)
            else:
                if self.name in prs:
                    prs.remove(self.name)
            
            doc.associated_prs = json.dumps({"prs": prs})
            doc.save(ignore_permissions=True)
        elif add:
            new_doc = frappe.get_doc({
                "doctype": "Critical PR Tags",
                "project": self.project,
                "header": tag.tag_header,
                "package": tag.tag_package,
                "associated_prs": json.dumps({"prs": [self.name]})
            })
            new_doc.insert(ignore_permissions=True)
