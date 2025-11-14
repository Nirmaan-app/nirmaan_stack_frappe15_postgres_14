
import frappe
import json
from frappe.utils import flt, getdate, nowdate

@frappe.whitelist()
def generate_pos_from_selection(project_id: str, pr_name: str, selected_items: list, selected_vendors: dict, custom: bool = False, payment_terms: str = None):
    """
    Generates Procurement Orders, including payment terms, based on selected items 
    and vendors from a Procurement Request.
    Prioritizes dynamic payment terms from the payload if provided.
    """
    try:
        # --- STEP 1: FETCH THE PROCUREMENT REQUEST (THE SINGLE SOURCE OF TRUTH FOR ITEMS) ---
        pr_doc = frappe.get_doc("Procurement Requests", pr_name, for_update=True)
        if not pr_doc:
            raise frappe.ValidationError(f"Procurement Request {pr_name} not found.")

        # --- STEP 2: PREPARE THE PAYMENT TERMS DATA (PRIORITIZING FRONTEND PAYLOAD) ---
        payment_terms_data_source = {}

        # If dynamic payment_terms are sent from the frontend, use them as the source.
        if payment_terms:
            try:
                print(f"DEBUGPP0: before payment_terms :{payment_terms}")
                parsed_terms = json.loads(payment_terms)
                print(f"DEBUGPP1: parsed_terms :{parsed_terms}")
                if isinstance(parsed_terms, dict):
                    payment_terms_data_source = parsed_terms
                    print(f"DEBUGPP2: payment_terms_data_source :{payment_terms_data_source}")
            except (json.JSONDecodeError, TypeError):
                frappe.log_error(f"Could not parse dynamic payment_terms JSON from payload for PR {pr_name}", "generate_pos_from_selection")     
        # --- STEP 3: PREPARE THE ITEM DATA (GROUPING ITEMS BY VENDOR) ---
        # This existing logic for preparing items and vendors remains the same.
        if isinstance(selected_items, str):
            selected_items = json.loads(selected_items)
        if isinstance(selected_vendors, str):
            selected_vendors = json.loads(selected_vendors)
        
        selected_child_item_names_set = set(selected_items)
        vendor_po_items_details = {}
        processed_pr_child_item_names_for_status_update = set()
        project_doc = frappe.get_doc("Projects", pr_doc.project) if pr_doc.project else None

        for pr_child_item in pr_doc.order_list:
            if pr_child_item.name in selected_child_item_names_set:
                vendor_id_from_payload = selected_vendors.get(pr_child_item.name)
                if vendor_id_from_payload and vendor_id_from_payload == pr_child_item.vendor:
                    if pr_child_item.quote is None:
                        frappe.throw(f"Quote not found for selected item {pr_child_item.item_id}.")
                    
                    item_quote_rate = flt(pr_child_item.quote)
                    item_quantity = flt(pr_child_item.quantity)
                    item_tax_percentage = flt(pr_child_item.tax)
                    base_amount = item_quantity * item_quote_rate
                    calculated_tax_amount = base_amount * (item_tax_percentage / 100.0)
                    final_total_amount = base_amount + calculated_tax_amount
                    po_item_dict = {
                        "item_id": pr_child_item.item_id, "item_name": pr_child_item.item_name, "unit": pr_child_item.unit,
                        "quantity": item_quantity, "category": pr_child_item.category, "procurement_package": pr_child_item.procurement_package,
                        "quote": item_quote_rate, "amount": base_amount, "make": pr_child_item.make, "tax": item_tax_percentage,
                        "tax_amount": calculated_tax_amount, "total_amount": final_total_amount, "comment": pr_child_item.comment,
                        "procurement_request_item": pr_child_item.name
                    }
                    if vendor_id_from_payload not in vendor_po_items_details:
                        vendor_po_items_details[vendor_id_from_payload] = []
                    vendor_po_items_details[vendor_id_from_payload].append(po_item_dict)
                    processed_pr_child_item_names_for_status_update.add(pr_child_item.name)
                else:
                    frappe.log_error(f"Vendor mismatch for item {pr_child_item.name} in PR {pr_name}.")

        if not vendor_po_items_details:
            if selected_items:
                frappe.msgprint(f"Warning: Selected items from PR {pr_name} could not be processed for PO.", indicator="orange", alert=True)

        # --- STEP 4: CREATE THE PURCHASE ORDERS (ONE PER VENDOR) ---
        latest_po_name = None
        created_po_names = []
        is_pr_custom = not pr_doc.work_package

        for vendor_id, po_items_list_for_vendor in vendor_po_items_details.items():
            po_doc = frappe.new_doc("Procurement Orders")
            vendor_doc = frappe.get_doc("Vendors", vendor_id)
            
            # Set PO Header Fields (no change)
            po_doc.procurement_request = pr_name
            po_doc.project = pr_doc.project
            if project_doc:
                po_doc.project_name = project_doc.project_name
                po_doc.project_address = project_doc.project_address
                # --- START FINAL REVISED LOGIC: Set Project GST (Header Field) ---
                # Field name is 'project_gst_number'
                if hasattr(project_doc, 'project_gst_number') and project_doc.project_gst_number:
                    
                    gst_source = project_doc.project_gst_number
                    gst_json_data = None

                    if isinstance(gst_source, str):
                        try:
                            # 1. Parse the JSON string: {"list": [...]}
                            gst_json_data = json.loads(gst_source)
                        except json.JSONDecodeError:
                            frappe.log_error(
                                f"Could not parse project_gst_number JSON string from Projects {pr_doc.project}", 
                                "generate_pos_from_selection"
                            )
                    elif isinstance(gst_source, dict):
                        # It's already parsed (e.g., by Frappe ORM), use it directly
                        gst_json_data = gst_source


                    if gst_json_data and isinstance(gst_json_data, dict):
                        # 2. Extract the actual list of GST details from the "list" key
                        project_gst_details_list = gst_json_data.get("list")
                        
                        if isinstance(project_gst_details_list, list):
                            
                            po_gst_to_set = None
                            # Requirement: Update po_doc.project_gst ONLY if the list has exactly one item.
                            if len(project_gst_details_list) == 1:
                                # If there is exactly one item, get its 'gst' value
                                single_gst_entry = project_gst_details_list[0]
                                po_gst_to_set = single_gst_entry.get("gst") 
                            
                            # Set the header field (po_doc.project_gst). 
                            po_doc.project_gst = po_gst_to_set
                            
                            # The logic to append to a child table ('project_gst_details') is removed as requested.
                                
                # --- END FINAL REVISED LOGIC ---
                    
            po_doc.vendor = vendor_id
            po_doc.vendor_name = vendor_doc.vendor_name
            po_doc.vendor_address = vendor_doc.vendor_address
            po_doc.vendor_gst = vendor_doc.vendor_gst
            if is_pr_custom:
                 po_doc.custom = "true"

            # --- Step 4.1: Populate the Payment Terms Child Table ---
            #
            # === THIS IS THE COMBINED LOGIC ===
            #
            # We use `payment_terms_data_source` which holds the dynamic data from the frontend.
            if vendor_id in payment_terms_data_source:
                # The structure of your old `vendor_term_data` had `type` at the top level
                # and `terms` as a list of milestones. The new data is just the list of milestones.
                # We will adapt to the new, simpler structure from the frontend.
                milestones = payment_terms_data_source[vendor_id]
             
                print(f"DEBUGPP3: milestones: {milestones}")
                po_doc.payment_type = milestones[0].get('type') if milestones else None
                # Your old code checked for `.get('terms', [])`. We now have the list directly.
                if milestones:
                    today = getdate(nowdate())
                    print(f"DEBUGPP3terms: milestones.terms:")
                    for milestone in milestones:
                    # for milestone in milestones.get('terms'):
                      
                        term_status = "Created"
                        due_date=""
                        print(f"DEBUGPP3term: milestones.terms: {milestone}")
                        # Get the payment type and due date from the milestone data
                        payment_type = milestone.get('type')
                        if payment_type == "Credit":
                            due_date_str = milestone.get('due_date')
                            # This append logic now mirrors your original code, ensuring compatibility.
                        if payment_type == "Credit" and due_date_str:
                    # Convert the due_date string to a proper date object for comparison
                            due_date = getdate(due_date_str)
                    
                    # If the due date is today or in the past...
                            if due_date <= today:
                        # ...override the default status to "Scheduled"
                                term_status = "Scheduled"
                # --- [END NEW LOGIC BLOCK] ---
                        po_doc.append("payment_terms", {
                            # The keys here MUST match the fieldnames in your "PO Payment Terms" Child Doctype.
                            # Get the 'type' from the milestone itself if it exists, otherwise it will be None.
                            "payment_type": payment_type,
                            "label": milestone.get('name'),
                            "percentage": milestone.get('percentage'),
                            "amount": milestone.get('amount'),
                            "due_date": milestone.get('due_date'),
                            "term_status": term_status # Example of setting a default status
                        })
                        print(f"DEBUGPP3ifend: milestone: {milestone}")
                else:
                    print(f"DEBUGPP3else: milestones is empty: {milestones}")

            # --- Step 4.2: Populate the Items Child Table (no change) ---
            print(f"DEBUGPP4: po_items_list_for_vendor: {po_items_list_for_vendor}")

            for po_item_entry in po_items_list_for_vendor:
                po_doc.append("items", po_item_entry)
            

            # --- Step 4.3: Calculate Totals and Save PO (no change) ---
            po_header_amount = sum(item.get("amount", 0) for item in po_doc.items)
            po_header_tax_amount = sum(item.get("tax_amount", 0) for item in po_doc.items)
            print(f"DEBUGPP4: po_header_amount: {po_header_amount}")
            
            po_doc.amount = po_header_amount
            po_doc.tax_amount = po_header_tax_amount
            po_doc.total_amount = po_header_amount + po_header_tax_amount


            po_doc.insert(ignore_permissions=True)
            latest_po_name= po_doc.name
            created_po_names.append(po_doc.name)
            print(f"DEBUGPP4: latest_po_name: {latest_po_name}")
        # --- STEP 5: FINALIZE THE PROCUREMENT REQUEST (no change) ---
        pr_state_potentially_changed = False
        if processed_pr_child_item_names_for_status_update:
            for pr_child_item_doc_to_update in pr_doc.order_list:
                if pr_child_item_doc_to_update.name in processed_pr_child_item_names_for_status_update:
                    if pr_child_item_doc_to_update.status != "Approved":
                        pr_child_item_doc_to_update.status = "Approved" 
                        pr_state_potentially_changed = True
        
        if pr_state_potentially_changed or not created_po_names:
            all_pr_items_finalized = all(item.status in ["Approved", "PO Generated", "Delayed", "Rejected", "Cancelled"] for item in pr_doc.order_list)
            has_any_approved_now = any(item.status in ["Approved", "PO Generated"] for item in pr_doc.order_list)
            current_pr_workflow_state = pr_doc.workflow_state
            new_pr_workflow_state = current_pr_workflow_state
            pr_non_updatable_states = ["Closed", "Cancelled", "Rejected"]

            if current_pr_workflow_state not in pr_non_updatable_states:
                if all_pr_items_finalized and has_any_approved_now:
                    new_pr_workflow_state = "Vendor Approved"
                elif has_any_approved_now:
                    new_pr_workflow_state = "Partially Approved"
                
                if new_pr_workflow_state != current_pr_workflow_state:
                    pr_doc.workflow_state = new_pr_workflow_state
                    pr_state_potentially_changed = True

        if pr_state_potentially_changed:
            pr_doc.save(ignore_permissions=True)

        message = f"Procurement Order(s): {', '.join(created_po_names)} created successfully." if created_po_names else "No Purchase Orders generated."
        if pr_state_potentially_changed:
            message += f" PR {pr_name} updated."
            
        return {
            "message": message,
            "status": 200,
            "po": latest_po_name,
            "created_pos": created_po_names
        }

    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="PO Generation Failed")
        return {"error": str(e), "status": 400, "message": f"Error: {str(e)}"}

