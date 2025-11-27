import frappe
import json
from frappe.utils import flt,getdate, nowdate

@frappe.whitelist()
def handle_merge_pos(po_id: str, merged_items: list, order_data: list, payment_terms: list):
    """
    Merges multiple Procurement Orders into a new master Procurement Order.
    This version calculates totals manually to build the document in one pass, avoiding ORM state errors.
    """
    try:
        print("DEBUGMERGE01: --- Function Start ---")
        # ... (Your other print statements for debugging are fine)

        frappe.db.begin()
        po_doc = frappe.get_doc("Procurement Orders", po_id)
        if not po_doc:
            raise frappe.ValidationError(f"Procurement Order {po_id} not found.")

        print(f"DEBUGMERGE02: Successfully fetched base PO: {po_doc.name}")

        # --- STEP 1: Create the new document object in memory ---
        new_po_doc = frappe.new_doc("Procurement Orders")
        # Copy header fields
        new_po_doc.procurement_request = po_doc.procurement_request
        new_po_doc.project = po_doc.project
        new_po_doc.project_name = po_doc.project_name
        new_po_doc.project_address = po_doc.project_address
        new_po_doc.vendor = po_doc.vendor
        new_po_doc.vendor_name = po_doc.vendor_name
        new_po_doc.vendor_address = po_doc.vendor_address
        new_po_doc.vendor_gst = po_doc.vendor_gst
        # Set the items from the payload
        # new_po_doc.items = order_data
        new_po_doc.merged = "true"
        new_po_doc.status="PO Approved"

        # --- STEP 2: Manually calculate the new total amount from the order data ---
        # This is the key to solving the chicken-and-egg problem.
        total_base_amount = 0
        total_tax_amount = 0
        for item in order_data:
            qty = float(item.get('quantity', 0))
            rate = float(item.get('quote', 0))
            tax_percent = float(item.get('tax', 0))
            base_amount = qty * rate
           
            tax_amount = base_amount * (tax_percent / 100)
            total_base_amount += base_amount
            total_tax_amount += tax_amount
         # The grand total is the sum of the two
        grand_total_amount = total_base_amount + total_tax_amount

        new_po_doc.amount = total_base_amount
        new_po_doc.tax_amount = total_tax_amount # Example field name
        new_po_doc.total_amount = grand_total_amount # This should match your 
         # --- STEP 3: Use .append() to build the 'items' child table ---
        # This is the KEY CHANGE. Instead of direct assignment, we loop and append.
        for item_dict in order_data:
            item_dict["po"] = item_dict.get('parent')
            new_po_doc.append("items",item_dict)
        
        # NOTE: If you merge freight/loading charges, add them here too.
        # Example: grand_total_amount += float(po_doc.loading_charges or 0)

        print(f"DEBUGMERGE_CALC: Manually calculated Total Amount: {grand_total_amount}")


        # --- STEP 3: Build the payment terms child table using the manually calculated total ---
        new_po_doc.payment_type=payment_terms[0].get("payment_type") if payment_terms else None
        for term_dict in payment_terms:
            today = getdate(nowdate())

            percentage = 0
            if grand_total_amount > 0:
                amount = float(term_dict.get('amount', 0))
                percentage = (amount / grand_total_amount) * 100
            
            term_dict['percentage'] = round(percentage, 2)
            term_dict['term_status'] = "Created"
            if term_dict.get("payment_type") == "Credit" and term_dict.get("due_date"):
                if getdate(term_dict.get("due_date")) <= today:
                    term_dict['term_status'] = "Scheduled"
            new_po_doc.append("payment_terms", term_dict)
        
        
        # --- STEP 4: Save the fully constructed document to the database ONCE ---
        # .insert() will save the main doc and all its child tables in a single, clean transaction.
        print("DEBUGMERGE_SAVE: Document fully built in memory. Calling .insert() now.")
        new_po_doc.insert()
        print(f"DEBUGMERGE_SAVE_SUCCESS: .insert() successful. New PO Name: {new_po_doc.name}")
        print(f"DEBUGMERGE_SAVE_SUCCESS: Frappe's final calculated total: {new_po_doc.total_amount}")

        # --- STEP 5: Update the old POs ---
        pos_to_update = [po["name"] for po in merged_items] + [po_id]
        print(f"DEBUGMERGE08: Updating status to 'Merged' for the following POs: {pos_to_update}")
        for po_name in pos_to_update:
            frappe.db.set_value("Procurement Orders", po_name, "status", "Merged")
            frappe.db.set_value("Procurement Orders", po_name, "merged", new_po_doc.name)
        
        frappe.db.commit()
        print("DEBUGMERGE09: --- Commit successful. Function End ---")

        return {
            "message": f"POs merged into new master PO {new_po_doc.name}",
            "new_po_name": new_po_doc.name,
            "status": 200,
        }

    except Exception as e:
        frappe.db.rollback()
        print(f"!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print(f"DEBUGMERGE_ERROR: An exception occurred during PO merge.")
        print(f"DEBUGMERGE_ERROR: Error Type: {type(e).__name__}")
        print(f"DEBUGMERGE_ERROR: Error Details: {e}")
        frappe.log_error(title="handle_merge_pos Error", message=frappe.get_traceback())
        print(f"!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        
        return {"error": f"Failed to merge POs: {str(e)}", "status": 400}

#  Umerge POs

@frappe.whitelist()
def handle_unmerge_pos(po_id: str):
    """
    Safely unmerges Procurement Orders from a master PO.
    This function is designed to be called from the frontend.
    It finds all linked POs from the database and performs safety checks.

    Args:
        po_id (str): The name of the master Procurement Order to unmerge.
    """
    try:
        frappe.db.begin()
        
        # --- 1. Safety Check: Block unmerge if payments exist ---
        # This is a critical safety feature to maintain data integrity.
        if frappe.db.exists("Project Payments", {"document_name": po_id}):
            frappe.throw(
                "Cannot Unmerge: Payment requests have been made against this merged PO.",
                title="Unmerge Blocked"
            )

        # --- 2. Find ALL original POs from the database (more secure) ---
        # Instead of trusting a list from the frontend, the backend finds the children itself.
        original_pos = frappe.get_all(
            "Procurement Orders",
            filters={"merged": po_id},
            fields=["name"]
        )

        if not original_pos:
            # Handle the edge case where a master PO might have no children linked.
            print(f"UNMERGE_INFO: No original POs found linked to {po_id}. Proceeding to delete master PO.")
        else:
            print(f"UNMERGE_INFO: Found {len(original_pos)} original PO(s) to restore.")
            # --- 3. Restore each original PO ---
            for po in original_pos:
                po_name = po.get("name")
                print(f"UNMERGE_INFO: Restoring {po_name} to 'PO Approved' status.")
                frappe.db.set_value("Procurement Orders", po_name, "status", "PO Approved")
                frappe.db.set_value("Procurement Orders", po_name, "merged", None)
        
        # --- 4. Delete the master PO and its attachments ---
        print(f"UNMERGE_INFO: Deleting attachments and master PO: {po_id}")
        # frappe.db.delete("Nirmaan Attachments", {"associated_docname": ("=", po_id)})
        frappe.delete_doc("Procurement Orders", po_id)
        
        frappe.db.commit()
        print("UNMERGE_SUCCESS: Unmerge process completed successfully.")

        return {"message": "Successfully unmerged PO(s)", "status": 200}

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(title="handle_unmerge_pos Error", message=frappe.get_traceback())
        # Return a clear error message to the frontend
        return {"error": f"Error while unmerging PO(s): {str(e)}", "status": 400}
        

@frappe.whitelist()
def get_full_po_details(po_names):
    """
    Accepts a list of PO names and returns a list of their full document objects,
    including all child tables.
    """
    if not po_names or not isinstance(po_names, list):
        return []

    full_po_docs = []
    for name in po_names:
        try:
            doc = frappe.get_doc("Procurement Orders", name)
            full_po_docs.append(doc.as_dict())
        except frappe.DoesNotExistError:
            continue
            
    return full_po_docs