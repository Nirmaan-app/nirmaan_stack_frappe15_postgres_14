import frappe

@frappe.whitelist()
def handle_delayed_items(pr_id: str, comments: dict = None):
    """
    Handles delayed items in a Procurement Request, creates Sent Back Category,
    and updates the Procurement Request workflow state.

    Args:
        pr_id (str): The name of the Procurement Request.
        comments (dict, optional): Comments for delayed and approved items. Defaults to None.
    """
    try:
        pr_doc = frappe.get_doc("Procurement Requests", pr_id)
        if not pr_doc:
            raise frappe.ValidationError(f"Procurement Request {pr_id} not found.")

        procurement_list = frappe.parse_json(pr_doc.procurement_list).get('list', [])
        category_list = frappe.parse_json(pr_doc.category_list).get('list', [])
        rfq_data = frappe.parse_json(pr_doc.rfq_data) if pr_doc.rfq_data else {}
        selected_vendors = rfq_data.get("selectedVendors", [])
        rfq_details = rfq_data.get("details", {})

        delayed_items = []
        itemlist = []
        new_rfq_details = {}

        for item in procurement_list:
            if not item.get("vendor"):
                itemlist.append({
                    "name": item["name"],
                    "item": item["item"],
                    "quantity": item["quantity"],
                    "tax": item.get("tax"),
                    "unit": item["unit"],
                    "category": item["category"],
                    "status": "Pending",
                    "comment": item.get("comment"),
                })
                delayed_items.append(item["name"])
                # Add item details to new_rfq_details
                if item["name"] in rfq_details:
                    new_rfq_details[item["name"]] = rfq_details[item["name"]]


        updated_procurement_list = []
        for item in procurement_list:
            if item["name"] in delayed_items:
                updated_procurement_list.append({**item, "status": "Delayed"})
            else:
                updated_procurement_list.append(item)

        new_categories = []
        for item in itemlist:
            if not any(cat["name"] == item["category"] for cat in new_categories):
                makes = next((cat.get("makes", []) for cat in category_list if cat["name"] == item["category"]), [])
                new_categories.append({"name": item["category"], "makes": makes})

        new_send_back = {
            "procurement_request": pr_id,
            "project": pr_doc.project,
            "category_list": {"list": new_categories},
            "item_list": {"list": itemlist},
            "rfq_data" : {"selectedVendors": selected_vendors, "details": new_rfq_details},
            "type": "Delayed",
        }

        if itemlist:
            sent_back_doc = frappe.new_doc("Sent Back Category")
            sent_back_doc.update(new_send_back)
            sent_back_doc.insert()

            if comments and comments.get("delaying"):
                comment_doc = frappe.new_doc("Nirmaan Comments")
                comment_doc.comment_type = "Comment"
                comment_doc.reference_doctype = "Sent Back Category"
                comment_doc.reference_name = sent_back_doc.name
                comment_doc.content = comments["delaying"]
                comment_doc.subject = "creating sent-back(delayed)"
                comment_doc.comment_by = frappe.session.user
                comment_doc.insert()

        if len(itemlist) == len(procurement_list):
            pr_doc.workflow_state = "Delayed"
            pr_doc.procurement_list = {"list": updated_procurement_list}
            pr_doc.save()
            message = "You just delayed all the items, you can see them in Sent Back Requests delayed tab!"
        else:
            pr_doc.workflow_state = "Vendor Selected"
            pr_doc.procurement_list = {"list": updated_procurement_list}
            pr_doc.save()
            if itemlist:
                message = f"New Delayed Type Sent Back: {sent_back_doc.name} created successfully and selected Item-Vendor quotes sent for approval!"
            else:
                message = "Item-Vendor Quotes Sent for Approval"

            if comments and comments.get("approving"):
                comment_doc = frappe.new_doc("Nirmaan Comments")
                comment_doc.comment_type = "Comment"
                comment_doc.reference_doctype = "Procurement Requests"
                comment_doc.reference_name = pr_id
                comment_doc.content = comments["approving"]
                comment_doc.subject = "pr vendors selected"
                comment_doc.comment_by = frappe.session.user
                comment_doc.insert()

        return {"message": message, "status": 200}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "handle_delayed_items")
        return {"error": str(e), "status": 400}