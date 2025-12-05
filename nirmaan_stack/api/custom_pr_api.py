import frappe
import json

@frappe.whitelist()
def new_custom_pr(project_id: str, order: list, categories: list, comment: str = None, attachment: dict = None, payment_terms: str = None):
    """
    Creates a new Procurement Request using the child table for items, and optionally adds a comment/attachment.
    """
    try:
        if isinstance(order, str):
            order = json.loads(order)
        if isinstance(categories, str):
            categories = json.loads(categories)

        frappe.db.begin()
        pr_doc = frappe.new_doc("Procurement Requests")
        pr_doc.project = project_id
        
        # Populate the 'order_list' child table
        for fe_item in order:
            pr_doc.append("order_list", {
                "item_id": fe_item.get("item_id"),
                "item_name": fe_item.get("item_name"),
                "unit": fe_item.get("unit"),
                "quantity": fe_item.get("quantity"),
                "category": fe_item.get("category"),
                "procurement_package": fe_item.get("procurement_package"),
                "status": fe_item.get("status", "Pending"),
                "tax": fe_item.get("tax"),
                "vendor": fe_item.get("vendor"),
                "quote": fe_item.get("quote")
            })
        
        pr_doc.category_list = {"list": categories}

        if payment_terms:
            pr_doc.payment_terms = payment_terms

        # --- CORRECTED CALCULATION ---
        # The error was using dot notation (item_data.quote).
        # We must use dictionary key access (item_data.get("quote")).
        current_estimated_total = 0
        for item_data in order:
            item_quote = frappe.utils.flt(item_data.get("quote"))
            item_quantity = frappe.utils.flt(item_data.get("quantity"))
            item_tax = frappe.utils.flt(item_data.get("tax"))
            if item_quote > 0 and item_quantity > 0:
                base_amount = item_quote * item_quantity
                tax_amount = base_amount * (item_tax / 100)
                current_estimated_total += base_amount + tax_amount
        
        pr_doc.estimated_value = current_estimated_total
        
        pr_doc.insert(ignore_permissions=True)

        if comment:
            comment_doc = frappe.new_doc("Nirmaan Comments")
            comment_doc.comment_type = "Comment"
            comment_doc.reference_doctype = "Procurement Requests"
            comment_doc.reference_name = pr_doc.name
            comment_doc.content = comment
            comment_doc.subject = "new custom pr"
            comment_doc.comment_by = frappe.session.user
            comment_doc.insert(ignore_permissions=True)

        if attachment and attachment.get("file_url"):
            attachment_doc = frappe.new_doc("Nirmaan Attachments")
            attachment_doc.project = project_id
            attachment_doc.associated_doctype = "Procurement Requests"
            attachment_doc.associated_docname = pr_doc.name
            attachment_doc.attachment_type = "custom pr attachment"
            attachment_doc.attachment = attachment["file_url"]
            attachment_doc.insert(ignore_permissions=True)
            
        pr_doc.workflow_state = "Vendor Selected"
        pr_doc.save(ignore_permissions=True)

        frappe.db.commit()

        return {"message": f"Custom PR: {pr_doc.name} Created and Sent for Approval", "status": 200, "name": pr_doc.name}

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(message=frappe.get_traceback(), title="New Custom PR Failed")
        return {"error": f"Unable to create Custom PR: {str(e)}", "status": 400}

@frappe.whitelist()
def resolve_custom_pr(project_id: str, pr_id: str, order: list, categories: list, comment: str = None, attachment: dict = None, payment_terms: str = None):
    """
    Updates an existing Procurement Request's child table items, and optionally comment/attachment.
    """
    try:
        if isinstance(order, str):
            order = json.loads(order)
        if isinstance(categories, str):
            categories = json.loads(categories)

        frappe.db.begin()
        pr_doc = frappe.get_doc("Procurement Requests", pr_id, for_update=True)

        pr_doc.set("order_list", [])

        for fe_item in order:
            pr_doc.append("order_list", {
                "item_id": fe_item.get("item_id"),
                "item_name": fe_item.get("item_name"),
                "unit": fe_item.get("unit"),
                "quantity": fe_item.get("quantity"),
                "category": fe_item.get("category"),
                "procurement_package": fe_item.get("procurement_package"),
                "status": fe_item.get("status", "Pending"),
                "tax": fe_item.get("tax"),
                "vendor": fe_item.get("vendor"),
                "quote": fe_item.get("quote")
            })

        pr_doc.category_list = {"list": categories}

        if payment_terms:
            pr_doc.payment_terms = payment_terms
        else:
            pr_doc.payment_terms = None

        pr_doc.workflow_state = "Vendor Selected"

        # --- CORRECTED CALCULATION ---
        # The same fix is applied here.
        current_estimated_total = 0
        for item_data in order:
            item_quote = frappe.utils.flt(item_data.get("quote"))
            item_quantity = frappe.utils.flt(item_data.get("quantity"))
            item_tax = frappe.utils.flt(item_data.get("tax"))
            if item_quote > 0 and item_quantity > 0:
                base_amount = item_quote * item_quantity
                tax_amount = base_amount * (item_tax / 100)
                current_estimated_total += base_amount + tax_amount
        
        pr_doc.estimated_value = current_estimated_total
        
        pr_doc.save(ignore_permissions=True)

        if comment:
            # Reusing the same comment logic, but you might want a different subject
            comment_doc = frappe.new_doc("Nirmaan Comments")
            comment_doc.comment_type = "Comment"
            comment_doc.reference_doctype = "Procurement Requests"
            comment_doc.reference_name = pr_doc.name
            comment_doc.content = comment
            comment_doc.subject = "resolved custom pr" # Changed subject
            comment_doc.comment_by = frappe.session.user
            comment_doc.insert(ignore_permissions=True)

        if attachment and attachment.get("file_url"):
            # This logic assumes you want to update an existing attachment or create a new one
            existing_attachment_name = frappe.db.get_value(
                "Nirmaan Attachments",
                {"associated_doctype": "Procurement Requests", "associated_docname": pr_doc.name, "attachment_type": "custom pr attachment"},
                "name"
            )
            if existing_attachment_name:
                frappe.db.set_value("Nirmaan Attachments", existing_attachment_name, "attachment", attachment["file_url"])
            else:
                attachment_doc = frappe.new_doc("Nirmaan Attachments")
                attachment_doc.project = pr_doc.project
                attachment_doc.associated_doctype = "Procurement Requests"
                attachment_doc.associated_docname = pr_doc.name
                attachment_doc.attachment_type = "custom pr attachment"
                attachment_doc.attachment = attachment["file_url"]
                attachment_doc.insert(ignore_permissions=True)

        frappe.db.commit()
        return {"message": f"Custom PR: {pr_doc.name} resolved and updated.", "status": 200}

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(message=frappe.get_traceback(), title="Resolve Custom PR Failed")
        return {"error": f"Unable to resolve Custom PR: {str(e)}", "status": 400}



        
# import frappe
# import json

# @frappe.whitelist()
# def new_custom_pr(project_id: str, order: list, categories: list, comment: str = None, attachment: dict = None):
#     """
#     Creates a new Procurement Request using the child table for items, and optionally adds a comment/attachment.

#     Args:
#         project_id (str): The ID of the project.
#         order (list): The list of order item objects from the frontend.
#         categories (list): The list of categories (remains in JSON field 'category_list').
#         comment (str, optional): The comment to add. Defaults to None.
#         attachment (dict, optional): Details of the file attachment. Defaults to None.
#     """
#     try:
#         # Ensure order and categories are Python lists if passed as JSON strings
#         if isinstance(order, str):
#             order = json.loads(order)
#         if isinstance(categories, str):
#             categories = json.loads(categories)

#         frappe.db.begin()
#         pr_doc = frappe.new_doc("Procurement Requests")
#         pr_doc.project = project_id
#         # The 'work_package' field will be empty for custom PRs, which is correct.
#         # This is how the frontend determines if a PR is custom: !orderData.work_package

#         # Populate the 'order_list' child table
#         for fe_item in order:
#             pr_doc.append("order_list", {
#                 "item_id": fe_item.get("name"),  # Using frontend's UUID 'name' as item_id for uniqueness
#                 "item_name": fe_item.get("item"), # The descriptive name
#                 "unit": fe_item.get("unit"),
#                 "quantity": fe_item.get("quantity"),
#                 "category": fe_item.get("category"),
#                 "procurement_package": fe_item.get("procurement_package"),
#                 # "make": fe_item.get("make"), # Add if 'make' is sent from frontend for custom items
#                 "status": fe_item.get("status", "Pending"), # Default to Pending if not provided
#                 "tax": fe_item.get("tax"), # Tax rate (e.g., 18 for 18%)
#                 "vendor": fe_item.get("vendor"),
#                 "quote": fe_item.get("quote") # Quoted rate per unit
#                 # Add other fields from Procurement Request Item Detail as needed
#             })

#         pr_doc.category_list = {"list": categories} # Continues to use JSON field for this

#         # Set other PR header fields if necessary
#         # pr_doc.custom_pr_flag = 1 # Example if you have a specific flag

#         current_estimated_total = 0
#         for item_data in order: # 'order' is the list of item dicts from frontend
#         # Assuming 'order' contains items that will be "Pending"
#             item_quote = frappe.utils.flt(item_data.get("quote"))
#             item_quantity = frappe.utils.flt(item_data.get("quantity"))
#             item_tax = frappe.utils.flt(item_data.get("tax"))
#             if item_quote > 0 and item_quantity > 0:
#                 current_estimated_total += (item_quote * item_quantity) + (item_quote * item_quantity * (item_tax / 100))

#         # Set the estimated value in PR header
#         pr_doc.estimated_value = current_estimated_total
#         pr_doc.insert(ignore_permissions=True) # Consider permissions carefully

#         if comment:
#             comment_doc = frappe.new_doc("Nirmaan Comments")
#             comment_doc.comment_type = "Comment"
#             comment_doc.reference_doctype = "Procurement Requests"
#             comment_doc.reference_name = pr_doc.name
#             comment_doc.content = comment
#             comment_doc.subject = "new custom pr"
#             comment_doc.comment_by = frappe.session.user
#             comment_doc.insert(ignore_permissions=True)

#         if attachment and attachment.get("file_url"):
#             attachment_doc = frappe.new_doc("Nirmaan Attachments")
#             attachment_doc.project = project_id
#             attachment_doc.associated_doctype = "Procurement Requests"
#             attachment_doc.associated_docname = pr_doc.name
#             attachment_doc.attachment_type = "custom pr attachment"
#             attachment_doc.attachment = attachment["file_url"]
#             attachment_doc.insert(ignore_permissions=True)

#         # Set initial workflow state
#         pr_doc.workflow_state = "Vendor Selected"
#         pr_doc.save(ignore_permissions=True) # Save again to trigger workflow actions if any, and persist state

#         frappe.db.commit()

#         return {"message": f"Custom PR: {pr_doc.name} Created and Sent for Approval", "status": 200, "name": pr_doc.name}

#     except Exception as e:
#         frappe.db.rollback()
#         frappe.log_error(message=frappe.get_traceback(), title="New Custom PR Failed")
#         return {"error": f"Unable to create Custom PR: {str(e)}", "status": 400}


# @frappe.whitelist()
# def resolve_custom_pr(project_id: str, pr_id: str, order: list, categories: list, comment: str = None, attachment: dict = None):
#     """
#     Updates an existing Procurement Request's child table items, and optionally comment/attachment.

#     Args:
#         project_id (str): The ID of the project. (Note: May not be needed if pr_id is sufficient)
#         pr_id (str): The name of the Procurement Request to resolve.
#         order (list): The new list of order item objects from the frontend.
#         categories (list): The new list of categories.
#         comment (str, optional): The comment to add. Defaults to None.
#         attachment (dict, optional): Details of the file attachment. Defaults to None.
#     """
#     try:
#         # Ensure order and categories are Python lists if passed as JSON strings
#         if isinstance(order, str):
#             order = json.loads(order)
#         if isinstance(categories, str):
#             categories = json.loads(categories)

#         frappe.db.begin()
#         pr_doc = frappe.get_doc("Procurement Requests", pr_id, for_update=True)

#         # Clear existing items in the child table
#         pr_doc.set("order_list", []) # More robust way to clear child table

#         # Populate the 'order_list' child table with new items
#         for fe_item in order:
#             pr_doc.append("order_list", {
#                 "item_id": fe_item.get("name"), # Using frontend's UUID 'name' as item_id
#                 "item_name": fe_item.get("item"),
#                 "unit": fe_item.get("unit"),
#                 "quantity": fe_item.get("quantity"),
#                 "category": fe_item.get("category"),
#                 "procurement_package": fe_item.get("procurement_package"),
#                 # "make": fe_item.get("make"),
#                 "status": fe_item.get("status", "Pending"),
#                 "tax": fe_item.get("tax"),
#                 "vendor": fe_item.get("vendor"),
#                 "quote": fe_item.get("quote")
#             })

#         pr_doc.category_list = {"list": categories} # Update JSON field

#         pr_doc.workflow_state = "Vendor Selected" # Reset/Set workflow state

#         current_estimated_total = 0
#         for item_data in order: # 'order' is the list of item dicts from frontend
#         # Assuming 'order' contains items that will be "Pending"
#             item_quote = frappe.utils.flt(item_data.get("quote"))
#             item_quantity = frappe.utils.flt(item_data.get("quantity"))
#             item_tax = frappe.utils.flt(item_data.get("tax"))
#             if item_quote > 0 and item_quantity > 0:
#                 current_estimated_total += (item_quote * item_quantity) + (item_quote * item_quantity * (item_tax / 100))

        
#         # Set the estimated value in PR header
#         pr_doc.estimated_value = current_estimated_total
#         pr_doc.save(ignore_permissions=True) # This saves the PR and its child table modifications

#         if comment:
#             comment_doc = frappe.new_doc("Nirmaan Comments")
#             comment_doc.comment_type = "Comment"
#             comment_doc.reference_doctype = "Procurement Requests"
#             comment_doc.reference_name = pr_doc.name
#             comment_doc.content = comment
#             comment_doc.subject = "resolved custom pr"
#             comment_doc.comment_by = frappe.session.user
#             comment_doc.insert(ignore_permissions=True)

#         if attachment and attachment.get("file_url"):
#             # Logic for updating or creating Nirmaan Attachments
#             existing_attachment_name = frappe.db.get_value(
#                 "Nirmaan Attachments",
#                 {
#                     "associated_doctype": "Procurement Requests",
#                     "associated_docname": pr_doc.name,
#                     "attachment_type": "custom pr attachment", # Ensure this filter is specific enough
#                 },
#                 "name"
#             )
#             if existing_attachment_name:
#                 frappe.db.set_value(
#                     "Nirmaan Attachments",
#                     existing_attachment_name,
#                     "attachment",
#                     attachment["file_url"]
#                 )
#                 # If project_id can change, update it too
#                 if project_id and pr_doc.project != project_id: # Assuming pr_doc.project is source of truth
#                      frappe.db.set_value("Nirmaan Attachments", existing_attachment_name, "project", pr_doc.project)

#             else:
#                 attachment_doc = frappe.new_doc("Nirmaan Attachments")
#                 attachment_doc.project = pr_doc.project # Use project from PR doc
#                 attachment_doc.associated_doctype = "Procurement Requests"
#                 attachment_doc.associated_docname = pr_doc.name
#                 attachment_doc.attachment_type = "custom pr attachment"
#                 attachment_doc.attachment = attachment["file_url"]
#                 attachment_doc.insert(ignore_permissions=True)


#         frappe.db.commit()
#         return {"message": f"Custom PR: {pr_doc.name} resolved and updated.", "status": 200}

#     except Exception as e:
#         frappe.db.rollback()
#         frappe.log_error(message=frappe.get_traceback(), title="Resolve Custom PR Failed")
#         return {"error": f"Unable to resolve Custom PR: {str(e)}", "status": 400}