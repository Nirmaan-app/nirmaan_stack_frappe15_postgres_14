
import frappe
import json
from frappe.utils import flt,getdate,nowdate

@frappe.whitelist()
def new_handle_approve(sb_id: str, selected_items: list, project_id: str, selected_vendors: dict,payment_terms: str = None):
    """
    Approves selected items from a Sent Back Category, creates Procurement Orders with a child table for items,
    and updates the Sent Back Category document.
    """
    try:
        sb_doc = frappe.get_doc("Sent Back Category", sb_id, for_update=True) # Lock for update
        if not sb_doc:
            raise frappe.ValidationError(f"Sent Back Category {sb_id} not found.")

        # ====================================================================
        # --- ADDED BLOCK: Prepare Payment Terms Data ---
        # ====================================================================
        payment_terms_by_vendor = {}
        # Safely get the 'payment_terms' field from the document.
        # Use your actual fieldname if it's different (e.g., "custom_payment_terms").

        if payment_terms:
            try:
                parsed_terms = json.loads(payment_terms)
                if isinstance(parsed_terms, dict):
                    payment_terms_by_vendor = parsed_terms
            except (json.JSONDecodeError, TypeError):
                frappe.log_error(f"Could not parse dynamic payment_terms JSON from payload for PR {sb_id}", "generate_pos_from_selection")
        # --- END OF ADDED BLOCK ---

        # Ensure payloads are Python objects
        if isinstance(selected_items, str):
            selected_items = json.loads(selected_items)
        if isinstance(selected_vendors, str):
            selected_vendors = json.loads(selected_vendors)

        # Read from the child table 'order_list' of Sent Back Category
        source_sb_order_list = sb_doc.get("order_list", []) # List of child document objects

        # --- Group selected SB child items by vendor for PO creation ---
        vendor_po_items_for_child_table = {}
        processed_sb_child_item_names_for_status_update = set() # Store child_doc.name for status update

        selected_item_ids_set = set(selected_items) # For efficient lookup

        project_doc_for_po = None
        if sb_doc.project:
            project_doc_for_po = frappe.get_doc("Projects", sb_doc.project)

        for sb_child_item in source_sb_order_list: # sb_child_item is a child document object
            if sb_child_item.name in selected_item_ids_set:
                vendor_id_for_po = selected_vendors.get(sb_child_item.name)
                if not vendor_id_for_po:
                    frappe.log_error(f"Vendor not found in payload for selected SB item {sb_child_item.name} from SB Doc {sb_id}", "new_handle_approve")
                    continue # Skip if no vendor assigned in payload for this approved item

                if sb_child_item.quote is None: # Quote should be present on the SB item
                    frappe.throw(f"Quote not found for item {sb_child_item.name} in SB Doc {sb_id}.")

                item_quote_rate = flt(sb_child_item.quote)
                item_quantity = flt(sb_child_item.quantity)
                item_tax_percentage = flt(sb_child_item.tax)
                base_amount = item_quantity * item_quote_rate
                calculated_tax_amount = base_amount * (item_tax_percentage / 100.0)
                final_total_amount = base_amount + calculated_tax_amount
                
                po_item_dict = {
                    "item_id": sb_child_item.item_id, "item_name": sb_child_item.item_name,
                    "unit": sb_child_item.unit, "quantity": item_quantity,
                    "category": sb_child_item.category, "procurement_package": sb_child_item.procurement_package,
                    "quote": item_quote_rate, "amount": base_amount, "make": sb_child_item.make,
                    "tax": item_tax_percentage, "tax_amount": calculated_tax_amount,
                    "total_amount": final_total_amount, "comment": sb_child_item.comment,
                    "procurement_request_item": sb_child_item.name
                }

                if vendor_id_for_po not in vendor_po_items_for_child_table:
                    vendor_po_items_for_child_table[vendor_id_for_po] = []
                vendor_po_items_for_child_table[vendor_id_for_po].append(po_item_dict)
                processed_sb_child_item_names_for_status_update.add(sb_child_item.name)

        latest_po_name = None
        created_po_names = []

        # --- Create Procurement Orders (one per vendor) ---
        if not vendor_po_items_for_child_table and selected_items:
             frappe.msgprint(f"Warning: No processable items found for PO creation from SB {sb_id} despite selections.", indicator="orange")
        
        for vendor_id, po_items_list in vendor_po_items_for_child_table.items():
            vendor_doc_for_po = frappe.get_doc("Vendors", vendor_id)
            
            po_doc = frappe.new_doc("Procurement Orders")
            po_doc.procurement_request = sb_doc.procurement_request 
            po_doc.project = sb_doc.project
            if project_doc_for_po:
                po_doc.project_name = project_doc_for_po.project_name
                po_doc.project_address = project_doc_for_po.project_address

            po_doc.vendor = vendor_id
            po_doc.vendor_name = vendor_doc_for_po.vendor_name
            po_doc.vendor_address = vendor_doc_for_po.vendor_address
            po_doc.vendor_gst = vendor_doc_for_po.vendor_gst
            
            
            original_pr_is_custom = not frappe.db.get_value("Procurement Requests", sb_doc.procurement_request, "work_package")
            if original_pr_is_custom:
                 po_doc.custom = "true"

            # ====================================================================
            # --- ADDED BLOCK: Populate the Payment Terms Child Table ---
            # ====================================================================
            if vendor_id in payment_terms_by_vendor:
                # vendor_term_data = payment_terms_by_vendor[vendor_id]
                milestones = payment_terms_by_vendor[vendor_id]
                if isinstance(milestones, list):
                    today = getdate(nowdate())
                    for milestone in milestones:
                        term_status = "Created"
            
                        # Get the payment type and due date from the milestone data
                        payment_type = milestone.get('type')
                        due_date_str = milestone.get('due_date')
                        if payment_type == "Credit" and due_date_str:
                    # Convert the due_date string to a proper date object for comparison
                            due_date = getdate(due_date_str)
                    
                    # If the due date is today or in the past...
                            if due_date <= today:
                        # ...override the default status to "Scheduled"
                                term_status = "Scheduled"
                        po_doc.append("payment_terms", {
                            "payment_type": milestone.get('type'), 
                            "label": milestone.get('name'),
                            "percentage": milestone.get('percentage'),
                            "amount": milestone.get('amount'),
                            "due_date": milestone.get('due_date'),
                            "status": term_status # Example of setting a default status
                        })

            # --- END OF ADDED BLOCK ---

            # Populate the 'items' child table of the PO
            for po_item_data_dict in po_items_list:
                po_doc.append("items", po_item_data_dict)

            # Calculate PO header totals
            po_doc.amount = sum(item.get("amount", 0) for item in po_doc.items)
            po_doc.tax_amount = sum(item.get("tax_amount", 0) for item in po_doc.items)
            po_doc.total_amount = po_doc.amount + po_doc.tax_amount

            po_doc.insert(ignore_permissions=True)
            latest_po_name = po_doc.name
            created_po_names.append(po_doc.name)

        # --- Update Sent Back Category's child items' statuses and workflow state ---
        sb_state_changed = False
        if processed_sb_child_item_names_for_status_update:
            for sb_child_doc in sb_doc.order_list:
                if sb_child_doc.name in processed_sb_child_item_names_for_status_update:
                    if sb_child_doc.status != "Approved":
                        sb_child_doc.status = "Approved"
                        sb_state_changed = True
        
        if sb_state_changed:
            total_items_in_sb = len(sb_doc.order_list)
            approved_items_in_sb = sum(1 for item_cd in sb_doc.order_list if item_cd.status == "Approved")
            if approved_items_in_sb == total_items_in_sb:
                sb_doc.workflow_state = "Approved"
            elif approved_items_in_sb > 0:
                sb_doc.workflow_state = "Partially Approved"
            
            sb_doc.save(ignore_permissions=True)
        
        message = f"Procurement Order(s): {', '.join(created_po_names)} created from SB {sb_id}." if created_po_names else f"No POs created from SB {sb_id}."
        if sb_state_changed:
            message += f" Sent Back Category {sb_id} updated."

        return {"message": message.strip(), "status": 200, "po": latest_po_name, "created_pos": created_po_names}

    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="new_handle_approve_sb_error")
        return {"error": str(e), "status": 400}


@frappe.whitelist()
def new_handle_sent_back(sb_id: str, selected_items: list, comment: str = None):
    """
    Sends back selected items from a Sent Back Category document by creating a new Sent Back Category document,
    and updates the source Sent Back Category document.

    Args:
        sb_id (str): The name of the source Sent Back Category document.
        selected_items (list): List of item_ids (from the source SB doc's order_list) to send back.
        comment (str, optional): Comment for the newly created Sent Back Category document. Defaults to None.
    """
    try:
        sb_doc = frappe.get_doc("Sent Back Category", sb_id, for_update=True) # Lock for update
        if not sb_doc:
            raise frappe.ValidationError(f"Sent Back Category {sb_id} not found.")

        # item_list contains child document objects from sb_doc's order_list
        source_item_list = sb_doc.get("order_list", [])
        
        # These are still JSON fields on the Sent Back Category parent doc
        rfq_data_sb = frappe.parse_json(sb_doc.rfq_data or '{}')
        selected_vendors_sb = rfq_data_sb.get("selectedVendors", [])
        rfq_details_sb = rfq_data_sb.get("details", {})
        category_list_sb = frappe.parse_json(sb_doc.category_list or '{}').get("list", [])


        print(f"Selected Items for creating new sent back: {selected_items}")

        items_for_new_sb_doc = []
        categories_for_new_sb_doc = []
        rfq_details_for_new_sb_doc = {}

        parent_pr_work_package = frappe.get_value("Procurement Requests", sb_doc.procurement_request, "work_package")

        # Ensure selected_items contains strings if passed as JSON
        if isinstance(selected_items, str):
            selected_items = json.loads(selected_items)

        for selected_item_id in selected_items:
            # Find the item in the source_item_list (list of child doc objects)
            item_in_source_sb = next((child_doc for child_doc in source_item_list if child_doc.name == selected_item_id), None)
            
            if item_in_source_sb:
                items_for_new_sb_doc.append({
                    "item_name": item_in_source_sb.item_name,
                    "item_id": item_in_source_sb.item_id,
                    "quantity": flt(item_in_source_sb.quantity),
                    "quote": flt(item_in_source_sb.quote),
                    "unit": item_in_source_sb.unit,
                    "tax": flt(item_in_source_sb.tax),
                    "status": "Pending", # New SB items are always Pending
                    "category": item_in_source_sb.category,
                    "procurement_package": item_in_source_sb.procurement_package or parent_pr_work_package,
                    "comment": item_in_source_sb.comment, # Carry over comment
                    "make": item_in_source_sb.make,
                    "vendor": item_in_source_sb.vendor, # Carry over selected vendor
                })

                # Build category list for the new SB doc
                if not any(cat_dict.get("name") == item_in_source_sb.category for cat_dict in categories_for_new_sb_doc):
                    # Find original makes for this category from the source SB's category_list
                    source_category_info = next((cat_dict for cat_dict in category_list_sb if cat_dict.get("name") == item_in_source_sb.category), None)
                    makes_for_category = source_category_info.get("makes", []) if source_category_info else []
                    categories_for_new_sb_doc.append({"name": item_in_source_sb.category, "makes": makes_for_category})

                # Copy RFQ details for this item to the new SB doc's RFQ data
                if selected_item_id in rfq_details_sb:
                    rfq_details_for_new_sb_doc[selected_item_id] = rfq_details_sb[selected_item_id]
            else:
                frappe.log_warning(f"Item ID '{selected_item_id}' not found in Sent Back Category '{sb_id}' order_list.", "new_handle_sent_back")


        newly_created_sb_doc_name = None
        if items_for_new_sb_doc:
            new_sent_back_doc = frappe.new_doc("Sent Back Category")
            new_sent_back_doc.procurement_request = sb_doc.procurement_request
            new_sent_back_doc.project = sb_doc.project
            new_sent_back_doc.category_list = json.dumps({"list": categories_for_new_sb_doc}) # Still JSON
            new_sent_back_doc.type = "Rejected" # Or based on context
            new_sent_back_doc.rfq_data = json.dumps({"selectedVendors": selected_vendors_sb, "details": rfq_details_for_new_sb_doc}) # Still JSON

            for item_dict_for_new_sb in items_for_new_sb_doc:
                new_sent_back_doc.append("order_list", item_dict_for_new_sb)

            new_sent_back_doc.insert(ignore_permissions=True) # Consider permissions
            newly_created_sb_doc_name = new_sent_back_doc.name

            if comment: # Comment for the NEW SB doc
                comment_doc = frappe.new_doc("Nirmaan Comments")
                comment_doc.comment_type = "Comment"
                comment_doc.reference_doctype = "Sent Back Category"
                comment_doc.reference_name = newly_created_sb_doc_name
                comment_doc.content = comment
                comment_doc.subject = "Creating new Sent Back from existing SB" # More descriptive
                comment_doc.comment_by = frappe.session.user
                comment_doc.insert(ignore_permissions=True)


        # Update statuses in the original sb_doc's order_list
        source_sb_state_changed = False
        for item_child_doc in source_item_list: # item_child_doc is a Frappe Document
            if item_child_doc.name in selected_items: # selected_items contains item_ids
                if item_child_doc.status != "Sent Back":
                    item_child_doc.status = "Sent Back"
                    source_sb_state_changed = True
        
        # Determine and update workflow state of the original sb_doc
        if source_sb_state_changed : # Only recalculate if item statuses actually changed
            total_items_in_source_sb = len(source_item_list)
            # Count based on current statuses in source_item_list (which has been updated in memory)
            items_still_pending_in_source_sb = sum(1 for item_cd in source_item_list if item_cd.status == "Pending")
            items_approved_in_source_sb = sum(1 for item_cd in source_item_list if item_cd.status == "Approved")
            
            # Logic for sb_doc workflow state
            if items_still_pending_in_source_sb == 0 and items_approved_in_source_sb == 0:
                # All items are either "Sent Back" (by this action) or were already in some other non-actionable state
                sb_doc.workflow_state = "Sent Back"
            elif items_still_pending_in_source_sb == 0 and items_approved_in_source_sb > 0 :
                # No more pending, but some are approved -> effectively Fully Approved or Partially approved from a previous state.
                # If all non-"Sent Back" items are "Approved", it becomes "Approved"
                if all(item_cd.status == "Approved" or item_cd.status == "Sent Back" for item_cd in source_item_list):
                    sb_doc.workflow_state = "Approved"
                else:
                    sb_doc.workflow_state = "Partially Approved" # Should cover cases where some are approved, some sent back
            else: # Still has pending items OR a mix of pending and approved not covering all scenarios above
                sb_doc.workflow_state = "Partially Approved" # Default if still actionable items or mixed final states
        
        # Save the original sb_doc if its item statuses or workflow state changed
        # Check if workflow_state actually changed from its original value before save
        original_workflow_state = sb_doc.get_doc_before_save().workflow_state if sb_doc.get_doc_before_save() else sb_doc.workflow_state
        if source_sb_state_changed or sb_doc.workflow_state != original_workflow_state:
            sb_doc.save(ignore_permissions=True) # This saves changes to child items' status as well

        message = f"Selected items processed."
        if newly_created_sb_doc_name:
            message = f"New Rejected Type Sent Back: {newly_created_sb_doc_name} created successfully."
        if source_sb_state_changed:
            message += f" Source Sent Back Category {sb_id} updated."
            
        return {"message": message.strip(), "status": 200, "new_sb_doc_name": newly_created_sb_doc_name}

    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="new_handle_sent_back Error")
        return {"error": str(e), "status": 400}
    




# ---------//Before Dynamic Table Change
# import frappe
# import json
# from frappe.utils import flt

# @frappe.whitelist()
# def new_handle_approve(sb_id: str, selected_items: list, project_id: str, selected_vendors: dict):
#     """
#     Approves selected items from a Sent Back Category, creates Procurement Orders with a child table for items,
#     and updates the Sent Back Category document.
#     """
#     try:
#         sb_doc = frappe.get_doc("Sent Back Category", sb_id, for_update=True) # Lock for update
#         if not sb_doc:
#             raise frappe.ValidationError(f"Sent Back Category {sb_id} not found.")

#         # ====================================================================
#         # --- ADDED BLOCK: Prepare Payment Terms Data ---
#         # ====================================================================
#         payment_terms_by_vendor = {}
#         # Safely get the 'payment_terms' field from the document.
#         # Use your actual fieldname if it's different (e.g., "custom_payment_terms").
#         payment_terms_from_doc = sb_doc.get("payment_terms") 

#         if payment_terms_from_doc:
#             try:
#                 # Handle both string and dict/list types, as Frappe can sometimes auto-parse JSON fields.
#                 data_object = json.loads(payment_terms_from_doc) if isinstance(payment_terms_from_doc, str) else payment_terms_from_doc
                
#                 # Extract the inner dictionary from the "list" key, based on your JSON structure.
#                 vendor_terms_dict = data_object.get('list', {})
                
#                 if isinstance(vendor_terms_dict, dict):
#                     payment_terms_by_vendor = vendor_terms_dict
#             except (json.JSONDecodeError, TypeError):
#                 frappe.log_error(f"Could not parse payment_terms JSON from SB {sb_id}", "new_handle_approve")
#         # --- END OF ADDED BLOCK ---

#         # Ensure payloads are Python objects
#         if isinstance(selected_items, str):
#             selected_items = json.loads(selected_items)
#         if isinstance(selected_vendors, str):
#             selected_vendors = json.loads(selected_vendors)

#         # Read from the child table 'order_list' of Sent Back Category
#         source_sb_order_list = sb_doc.get("order_list", []) # List of child document objects

#         # --- Group selected SB child items by vendor for PO creation ---
#         vendor_po_items_for_child_table = {}
#         processed_sb_child_item_names_for_status_update = set() # Store child_doc.name for status update

#         selected_item_ids_set = set(selected_items) # For efficient lookup

#         project_doc_for_po = None
#         if sb_doc.project:
#             project_doc_for_po = frappe.get_doc("Projects", sb_doc.project)

#         for sb_child_item in source_sb_order_list: # sb_child_item is a child document object
#             if sb_child_item.name in selected_item_ids_set:
#                 vendor_id_for_po = selected_vendors.get(sb_child_item.name)
#                 if not vendor_id_for_po:
#                     frappe.log_error(f"Vendor not found in payload for selected SB item {sb_child_item.name} from SB Doc {sb_id}", "new_handle_approve")
#                     continue # Skip if no vendor assigned in payload for this approved item

#                 if sb_child_item.quote is None: # Quote should be present on the SB item
#                     frappe.throw(f"Quote not found for item {sb_child_item.name} in SB Doc {sb_id}.")

#                 item_quote_rate = flt(sb_child_item.quote)
#                 item_quantity = flt(sb_child_item.quantity)
#                 item_tax_percentage = flt(sb_child_item.tax)
#                 base_amount = item_quantity * item_quote_rate
#                 calculated_tax_amount = base_amount * (item_tax_percentage / 100.0)
#                 final_total_amount = base_amount + calculated_tax_amount
                
#                 po_item_dict = {
#                     "item_id": sb_child_item.item_id, "item_name": sb_child_item.item_name,
#                     "unit": sb_child_item.unit, "quantity": item_quantity,
#                     "category": sb_child_item.category, "procurement_package": sb_child_item.procurement_package,
#                     "quote": item_quote_rate, "amount": base_amount, "make": sb_child_item.make,
#                     "tax": item_tax_percentage, "tax_amount": calculated_tax_amount,
#                     "total_amount": final_total_amount, "comment": sb_child_item.comment,
#                     "procurement_request_item": sb_child_item.name
#                 }

#                 if vendor_id_for_po not in vendor_po_items_for_child_table:
#                     vendor_po_items_for_child_table[vendor_id_for_po] = []
#                 vendor_po_items_for_child_table[vendor_id_for_po].append(po_item_dict)
#                 processed_sb_child_item_names_for_status_update.add(sb_child_item.name)

#         latest_po_name = None
#         created_po_names = []

#         # --- Create Procurement Orders (one per vendor) ---
#         if not vendor_po_items_for_child_table and selected_items:
#              frappe.msgprint(f"Warning: No processable items found for PO creation from SB {sb_id} despite selections.", indicator="orange")
        
#         for vendor_id, po_items_list in vendor_po_items_for_child_table.items():
#             vendor_doc_for_po = frappe.get_doc("Vendors", vendor_id)
            
#             po_doc = frappe.new_doc("Procurement Orders")
#             po_doc.procurement_request = sb_doc.procurement_request 
#             po_doc.project = sb_doc.project
#             if project_doc_for_po:
#                 po_doc.project_name = project_doc_for_po.project_name
#                 po_doc.project_address = project_doc_for_po.project_address

#             po_doc.vendor = vendor_id
#             po_doc.vendor_name = vendor_doc_for_po.vendor_name
#             po_doc.vendor_address = vendor_doc_for_po.vendor_address
#             po_doc.vendor_gst = vendor_doc_for_po.vendor_gst
            
#             original_pr_is_custom = not frappe.db.get_value("Procurement Requests", sb_doc.procurement_request, "work_package")
#             if original_pr_is_custom:
#                  po_doc.custom = "true"

#             # ====================================================================
#             # --- ADDED BLOCK: Populate the Payment Terms Child Table ---
#             # ====================================================================
#             if vendor_id in payment_terms_by_vendor:
#                 vendor_term_data = payment_terms_by_vendor[vendor_id]
#                 milestones = vendor_term_data.get('terms', [])
#                 for milestone in milestones:
#                     # Append a row to the 'po_payment_terms' child table.
#                     # This fieldname MUST match your child table fieldname on the PO Doctype.
#                     po_doc.append("payment_terms", {
#                         # The keys here MUST match the fieldnames in your "PO Payment Terms" child Doctype.
#                         "payment_type": vendor_term_data.get('type'),
#                         "label": milestone.get('name'),
#                         "percentage": milestone.get('percentage'),
#                         "amount": milestone.get('amount'),
#                         "due_date": milestone.get('due_date'),
#                         "status": "Created"
#                     })
#             # --- END OF ADDED BLOCK ---

#             # Populate the 'items' child table of the PO
#             for po_item_data_dict in po_items_list:
#                 po_doc.append("items", po_item_data_dict)

#             # Calculate PO header totals
#             po_doc.amount = sum(item.get("amount", 0) for item in po_doc.items)
#             po_doc.tax_amount = sum(item.get("tax_amount", 0) for item in po_doc.items)
#             po_doc.total_amount = po_doc.amount + po_doc.tax_amount

#             po_doc.insert(ignore_permissions=True)
#             latest_po_name = po_doc.name
#             created_po_names.append(po_doc.name)

#         # --- Update Sent Back Category's child items' statuses and workflow state ---
#         sb_state_changed = False
#         if processed_sb_child_item_names_for_status_update:
#             for sb_child_doc in sb_doc.order_list:
#                 if sb_child_doc.name in processed_sb_child_item_names_for_status_update:
#                     if sb_child_doc.status != "Approved":
#                         sb_child_doc.status = "Approved"
#                         sb_state_changed = True
        
#         if sb_state_changed:
#             total_items_in_sb = len(sb_doc.order_list)
#             approved_items_in_sb = sum(1 for item_cd in sb_doc.order_list if item_cd.status == "Approved")
#             if approved_items_in_sb == total_items_in_sb:
#                 sb_doc.workflow_state = "Approved"
#             elif approved_items_in_sb > 0:
#                 sb_doc.workflow_state = "Partially Approved"
            
#             sb_doc.save(ignore_permissions=True)
        
#         message = f"Procurement Order(s): {', '.join(created_po_names)} created from SB {sb_id}." if created_po_names else f"No POs created from SB {sb_id}."
#         if sb_state_changed:
#             message += f" Sent Back Category {sb_id} updated."

#         return {"message": message.strip(), "status": 200, "po": latest_po_name, "created_pos": created_po_names}

#     except Exception as e:
#         frappe.log_error(message=frappe.get_traceback(), title="new_handle_approve_sb_error")
#         return {"error": str(e), "status": 400}


# @frappe.whitelist()
# def new_handle_sent_back(sb_id: str, selected_items: list, comment: str = None):
#     """
#     Sends back selected items from a Sent Back Category document by creating a new Sent Back Category document,
#     and updates the source Sent Back Category document.

#     Args:
#         sb_id (str): The name of the source Sent Back Category document.
#         selected_items (list): List of item_ids (from the source SB doc's order_list) to send back.
#         comment (str, optional): Comment for the newly created Sent Back Category document. Defaults to None.
#     """
#     try:
#         sb_doc = frappe.get_doc("Sent Back Category", sb_id, for_update=True) # Lock for update
#         if not sb_doc:
#             raise frappe.ValidationError(f"Sent Back Category {sb_id} not found.")

#         # item_list contains child document objects from sb_doc's order_list
#         source_item_list = sb_doc.get("order_list", [])
        
#         # These are still JSON fields on the Sent Back Category parent doc
#         rfq_data_sb = frappe.parse_json(sb_doc.rfq_data or '{}')
#         selected_vendors_sb = rfq_data_sb.get("selectedVendors", [])
#         rfq_details_sb = rfq_data_sb.get("details", {})
#         category_list_sb = frappe.parse_json(sb_doc.category_list or '{}').get("list", [])


#         print(f"Selected Items for creating new sent back: {selected_items}")

#         items_for_new_sb_doc = []
#         categories_for_new_sb_doc = []
#         rfq_details_for_new_sb_doc = {}

#         parent_pr_work_package = frappe.get_value("Procurement Requests", sb_doc.procurement_request, "work_package")

#         # Ensure selected_items contains strings if passed as JSON
#         if isinstance(selected_items, str):
#             selected_items = json.loads(selected_items)

#         for selected_item_id in selected_items:
#             # Find the item in the source_item_list (list of child doc objects)
#             item_in_source_sb = next((child_doc for child_doc in source_item_list if child_doc.name == selected_item_id), None)
            
#             if item_in_source_sb:
#                 items_for_new_sb_doc.append({
#                     "item_name": item_in_source_sb.item_name,
#                     "item_id": item_in_source_sb.item_id,
#                     "quantity": flt(item_in_source_sb.quantity),
#                     "quote": flt(item_in_source_sb.quote),
#                     "unit": item_in_source_sb.unit,
#                     "tax": flt(item_in_source_sb.tax),
#                     "status": "Pending", # New SB items are always Pending
#                     "category": item_in_source_sb.category,
#                     "procurement_package": item_in_source_sb.procurement_package or parent_pr_work_package,
#                     "comment": item_in_source_sb.comment, # Carry over comment
#                     "make": item_in_source_sb.make,
#                     "vendor": item_in_source_sb.vendor, # Carry over selected vendor
#                 })

#                 # Build category list for the new SB doc
#                 if not any(cat_dict.get("name") == item_in_source_sb.category for cat_dict in categories_for_new_sb_doc):
#                     # Find original makes for this category from the source SB's category_list
#                     source_category_info = next((cat_dict for cat_dict in category_list_sb if cat_dict.get("name") == item_in_source_sb.category), None)
#                     makes_for_category = source_category_info.get("makes", []) if source_category_info else []
#                     categories_for_new_sb_doc.append({"name": item_in_source_sb.category, "makes": makes_for_category})

#                 # Copy RFQ details for this item to the new SB doc's RFQ data
#                 if selected_item_id in rfq_details_sb:
#                     rfq_details_for_new_sb_doc[selected_item_id] = rfq_details_sb[selected_item_id]
#             else:
#                 frappe.log_warning(f"Item ID '{selected_item_id}' not found in Sent Back Category '{sb_id}' order_list.", "new_handle_sent_back")


#         newly_created_sb_doc_name = None
#         if items_for_new_sb_doc:
#             new_sent_back_doc = frappe.new_doc("Sent Back Category")
#             new_sent_back_doc.procurement_request = sb_doc.procurement_request
#             new_sent_back_doc.project = sb_doc.project
#             new_sent_back_doc.category_list = json.dumps({"list": categories_for_new_sb_doc}) # Still JSON
#             new_sent_back_doc.type = "Rejected" # Or based on context
#             new_sent_back_doc.rfq_data = json.dumps({"selectedVendors": selected_vendors_sb, "details": rfq_details_for_new_sb_doc}) # Still JSON

#             for item_dict_for_new_sb in items_for_new_sb_doc:
#                 new_sent_back_doc.append("order_list", item_dict_for_new_sb)

#             new_sent_back_doc.insert(ignore_permissions=True) # Consider permissions
#             newly_created_sb_doc_name = new_sent_back_doc.name

#             if comment: # Comment for the NEW SB doc
#                 comment_doc = frappe.new_doc("Nirmaan Comments")
#                 comment_doc.comment_type = "Comment"
#                 comment_doc.reference_doctype = "Sent Back Category"
#                 comment_doc.reference_name = newly_created_sb_doc_name
#                 comment_doc.content = comment
#                 comment_doc.subject = "Creating new Sent Back from existing SB" # More descriptive
#                 comment_doc.comment_by = frappe.session.user
#                 comment_doc.insert(ignore_permissions=True)


#         # Update statuses in the original sb_doc's order_list
#         source_sb_state_changed = False
#         for item_child_doc in source_item_list: # item_child_doc is a Frappe Document
#             if item_child_doc.name in selected_items: # selected_items contains item_ids
#                 if item_child_doc.status != "Sent Back":
#                     item_child_doc.status = "Sent Back"
#                     source_sb_state_changed = True
        
#         # Determine and update workflow state of the original sb_doc
#         if source_sb_state_changed : # Only recalculate if item statuses actually changed
#             total_items_in_source_sb = len(source_item_list)
#             # Count based on current statuses in source_item_list (which has been updated in memory)
#             items_still_pending_in_source_sb = sum(1 for item_cd in source_item_list if item_cd.status == "Pending")
#             items_approved_in_source_sb = sum(1 for item_cd in source_item_list if item_cd.status == "Approved")
            
#             # Logic for sb_doc workflow state
#             if items_still_pending_in_source_sb == 0 and items_approved_in_source_sb == 0:
#                 # All items are either "Sent Back" (by this action) or were already in some other non-actionable state
#                 sb_doc.workflow_state = "Sent Back"
#             elif items_still_pending_in_source_sb == 0 and items_approved_in_source_sb > 0 :
#                 # No more pending, but some are approved -> effectively Fully Approved or Partially approved from a previous state.
#                 # If all non-"Sent Back" items are "Approved", it becomes "Approved"
#                 if all(item_cd.status == "Approved" or item_cd.status == "Sent Back" for item_cd in source_item_list):
#                     sb_doc.workflow_state = "Approved"
#                 else:
#                     sb_doc.workflow_state = "Partially Approved" # Should cover cases where some are approved, some sent back
#             else: # Still has pending items OR a mix of pending and approved not covering all scenarios above
#                 sb_doc.workflow_state = "Partially Approved" # Default if still actionable items or mixed final states
        
#         # Save the original sb_doc if its item statuses or workflow state changed
#         # Check if workflow_state actually changed from its original value before save
#         original_workflow_state = sb_doc.get_doc_before_save().workflow_state if sb_doc.get_doc_before_save() else sb_doc.workflow_state
#         if source_sb_state_changed or sb_doc.workflow_state != original_workflow_state:
#             sb_doc.save(ignore_permissions=True) # This saves changes to child items' status as well

#         message = f"Selected items processed."
#         if newly_created_sb_doc_name:
#             message = f"New Rejected Type Sent Back: {newly_created_sb_doc_name} created successfully."
#         if source_sb_state_changed:
#             message += f" Source Sent Back Category {sb_id} updated."
            
#         return {"message": message.strip(), "status": 200, "new_sb_doc_name": newly_created_sb_doc_name}

#     except Exception as e:
#         frappe.log_error(message=frappe.get_traceback(), title="new_handle_sent_back Error")
#         return {"error": str(e), "status": 400}