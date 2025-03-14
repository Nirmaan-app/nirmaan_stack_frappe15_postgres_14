import frappe

@frappe.whitelist()
def handle_cancel_po(po_id: str, comment: str = None):
    """
    Cancels a Procurement Order, creates a Sent Back Category document, and updates Procurement Request.

    Args:
        po_id (str): The name of the Procurement Order to cancel.
        comment (str, optional): Comment for the cancellation. Defaults to None.
    """
    try:
        # Fetch the Procurement Order
        po_doc = frappe.get_doc("Procurement Orders", po_id)
        if not po_doc:
            raise frappe.ValidationError(f"Procurement Order {po_id} not found.")

        # Fetch the Procurement Request
        pr_name = po_doc.procurement_request
        pr_doc = frappe.get_doc("Procurement Requests", pr_name)
        if not pr_doc:
            raise frappe.ValidationError(f"Procurement Request {pr_name} not found.")

        # Extract data from Procurement Order
        order_data = frappe.parse_json(po_doc.order_list).get("list", [])
        pr_categories = frappe.parse_json(pr_doc.category_list).get("list", [])
        rfq_data = frappe.parse_json(pr_doc.rfq_data) if pr_doc.rfq_data else {}
        selected_vendors = rfq_data.get("selectedVendors", [])
        rfq_details = rfq_data.get("details", {})

        # Prepare categories and item list
        categories = []
        item_list = []
        new_rfq_details = {}

        for item in order_data:
            if not any(cat["name"] == item["category"] for cat in categories):
                makes = next((cat.get("makes", []) for cat in pr_categories if cat["name"] == item["category"]), [])
                categories.append({"name": item["category"], "makes": makes})

            item_without_makes = {**item, "status": "Pending"}
            if "makes" in item_without_makes:
              del item_without_makes["makes"]
            item_list.append(item_without_makes)
            if item["name"] in rfq_details:
                new_rfq_details[item["name"]] = rfq_details[item["name"]]

        # Update Procurement Order status
        po_doc.status = "Cancelled"
        po_doc.save()

        # Create Sent Back Category document
        new_sent_back_doc = frappe.new_doc("Sent Back Category")
        new_sent_back_doc.type = "Cancelled"
        new_sent_back_doc.procurement_request = po_doc.procurement_request
        new_sent_back_doc.project = po_doc.project
        new_sent_back_doc.category_list = {"list": categories}
        new_sent_back_doc.item_list = {"list": item_list}
        new_sent_back_doc.rfq_data = {"selectedVendors": selected_vendors, "details": new_rfq_details}
        new_sent_back_doc.insert()

        # Create Nirmaan Comments document if comment is provided
        if comment:
            comment_doc = frappe.new_doc("Nirmaan Comments")
            comment_doc.comment_type = "Comment"
            comment_doc.reference_doctype = "Sent Back Category"
            comment_doc.reference_name = new_sent_back_doc.name
            comment_doc.content = comment
            comment_doc.subject = "creating sent-back(cancelled)"
            comment_doc.comment_by = frappe.session.user
            comment_doc.insert()

        return {"message": f"Cancelled Po & New Cancelled Type Sent Back: {new_sent_back_doc.name} created successfully!", "status": 200}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "handle_cancel_po")
        return {"error": f"PO: {po_id} Cancellation Failed! {str(e)}", "status": 400}