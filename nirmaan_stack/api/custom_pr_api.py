import frappe
import json

@frappe.whitelist()
def new_custom_pr(project_id: str, order: list, categories: list, comment: str = None):
    """
    Creates a new Procurement Request and optionally adds a comment.

    Args:
        project_id (str): The ID of the project.
        order (list): The list of order items.
        categories (list): The list of categories.
        comment (str, optional): The comment to add. Defaults to None.
    """
    try:
        res = frappe.new_doc("Procurement Requests")
        res.project = project_id
        res.procurement_list = {"list": order}
        res.category_list = {"list": categories}
        res.insert()

        if comment:
            comment_doc = frappe.new_doc("Nirmaan Comments")
            comment_doc.comment_type = "Comment"
            comment_doc.reference_doctype = "Procurement Requests"
            comment_doc.reference_name = res.name
            comment_doc.content = comment
            comment_doc.subject = "new custom pr"
            comment_doc.comment_by = frappe.session.user
            comment_doc.insert()

        frappe.db.set_value("Procurement Requests", res.name, "workflow_state", "Vendor Selected")

        return {"message": f"Custom PR: {res.name} Created Sent for Approval", "status": 200, "name": res.name}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "submit_procurement_request")
        return {"error": f"Unable to send Custom PR for approval: {str(e)}", "status": 400}

@frappe.whitelist()
def resolve_custom_pr(pr_id: str, order: list, categories: list, comment: str = None):
    """
    Updates an existing Procurement Request and optionally adds a comment.

    Args:
        pr_id (str): The name of the Procurement Request.
        order (list): The list of order items.
        categories (list): The list of categories.
        comment (str, optional): The comment to add. Defaults to None.
    """
    try:
        frappe.db.set_value("Procurement Requests", pr_id, "procurement_list", json.dumps({"list": order}))
        frappe.db.set_value("Procurement Requests", pr_id, "category_list", json.dumps({"list": categories}))
        frappe.db.set_value("Procurement Requests", pr_id, "workflow_state", "Vendor Selected")

        if comment:
            comment_doc = frappe.new_doc("Nirmaan Comments")
            comment_doc.comment_type = "Comment"
            comment_doc.reference_doctype = "Procurement Requests"
            comment_doc.reference_name = pr_id
            comment_doc.content = comment
            comment_doc.subject = "resolved custom pr"
            comment_doc.comment_by = frappe.session.user
            comment_doc.insert()

        return {"message": f"Custom PR: {pr_id} resolved and Sent for Approval!", "status": 200}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "resolve_custom_pr")
        return {"error": f"Unable to resolve Custom PR!: {str(e)}", "status": 400}