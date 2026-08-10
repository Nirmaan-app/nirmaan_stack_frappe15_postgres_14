import frappe

from nirmaan_stack.integrations.controllers.procurement_orders import _po_delete_blockers


@frappe.whitelist()
def delete_custom_po(po_id: str):
    """
    Deletes a Procurement Order and its associated Procurement Request, along with any attachments.

    Args:
        po_id (str): The name (ID) of the Procurement Order to delete.
    """
    try:
        po_doc = frappe.get_doc("Procurement Orders", po_id)
        if not po_doc:
            raise frappe.ValidationError(f"Procurement Order {po_id} not found.")

        # PRE-CHECK, BEFORE ANY DESTRUCTION.
        #
        # `on_trash` enforces this too and is the real boundary — it covers Desk and
        # the Cancelled branch of procurement_orders.on_update as well. But by the
        # time on_trash runs, the attachment loop below has ALREADY deleted the PR's
        # attachments, and this function swallows the exception and returns a dict,
        # so the request completes normally and Frappe COMMITS those deletions. The
        # user gets an error message and silently loses the attachments.
        #
        # That was reproduced on live data: attempting to delete PO/066/00097/26-27
        # (which holds Rs.563.33 of credit from PO/011/00097/26-27) removed its PR's
        # attachment before the guard ever spoke. Asking the same question here,
        # first, makes a refusal a genuine no-op. The rollback below is the backstop
        # for every other failure.
        blockers = _po_delete_blockers(po_doc)
        if blockers:
            return {
                "error": "{0} cannot be deleted — money from other records points at it: {1}".format(
                    po_id, " ".join(blockers)
                ),
                "status": 400,
            }

        pr_name = po_doc.procurement_request
        pr_doc = frappe.get_doc("Procurement Requests", pr_name)
        if not pr_doc:
            raise frappe.ValidationError(f"Procurement Request {pr_name} not found.")

        # Make sure the doctype is set correctly to match the attachments associated with the PR
        attachments = frappe.db.get_list(
            "Nirmaan Attachments",
            filters={
                "associated_docname": pr_name,
                "associated_doctype": "Procurement Requests"
            },
            fields=["name"]
        )
        for att in attachments:
            frappe.delete_doc("Nirmaan Attachments", att.name)

        # Now delete the Procurement Order and Request
        frappe.delete_doc("Procurement Orders", po_id)
        frappe.delete_doc("Procurement Requests", pr_name)

        return {"message": "Procurement Order and associated Procurement Request deleted successfully.", "status": 200}

    except Exception as e:
        # Without this, the attachment/PO deletions already performed above stay in
        # the session and are committed when the request ends — a "failed" delete
        # that destroyed things. Deletion is all-or-nothing.
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "delete_custom_po")
        return {"error": f"Failed to delete Procurement Order and/or Procurement Request: {str(e)}", "status": 400}
