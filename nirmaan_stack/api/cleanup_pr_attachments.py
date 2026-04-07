import frappe


@frappe.whitelist()
def cleanup_pr_attachments(pr_id: str):
    """
    Deletes all Nirmaan Attachments and their underlying File records
    linked to a Procurement Request. Called when reverting a PR from
    'In Progress' back to 'Approved' to ensure clean state.
    """
    if not pr_id:
        frappe.throw("PR ID is required")

    attachments = frappe.db.get_all(
        "Nirmaan Attachments",
        filters={
            "associated_docname": pr_id,
            "associated_doctype": "Procurement Requests",
        },
        fields=["name", "attachment"],
    )

    deleted_count = 0
    for att in attachments:
        if att.get("attachment"):
            frappe.db.delete(
                "File",
                {"file_url": att["attachment"], "attached_to_name": pr_id},
            )
        frappe.delete_doc("Nirmaan Attachments", att["name"], force=True)
        deleted_count += 1

    frappe.db.commit()

    return {"status": "success", "deleted": deleted_count}
