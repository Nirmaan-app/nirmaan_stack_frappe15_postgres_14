import frappe
from frappe.utils import flt, today, add_days

@frappe.whitelist()
def approve_amend_po_with_payment_terms(po_name: str):
    """
    Approves an amended PO, recalculates totals, and intelligently updates payment terms.
    If the total increases, the difference is added to the last 'Created' payment term.
    If the total decreases, the difference is deducted from 'Created' terms using a
    cascading 'Last-In, First-Out' (LIFO) approach.
    This version blocks execution if a "Return" scenario is detected.

    :param po_name: The name (ID) of the Procurement Order to process.
    """
    try:
        po_doc = frappe.get_doc("Procurement Orders", po_name, for_update=True)

        if po_doc.docstatus != 0:
            frappe.throw(f"PO {po_name} must be in Draft status to be amended and approved.")

        # Store original total before recalculation
        previous_total = flt(po_doc.total_amount)

        # --- STEP 1 & 2: Recalculate all totals ---
        new_header_amount = 0
        new_header_tax_amount = 0
        for item in po_doc.items:
            item.amount = flt(item.quote) * flt(item.quantity)
            item.tax_amount = item.amount * (flt(item.tax) / 100.0)
            item.total_amount = item.amount + item.tax_amount
            new_header_amount += item.amount
            new_header_tax_amount += item.tax_amount

        po_doc.amount = new_header_amount
        po_doc.tax_amount = new_header_tax_amount
        po_doc.total_amount = new_header_amount + new_header_tax_amount
        current_total = flt(po_doc.total_amount)

        # --- STEP 3: Update Payment Terms ---
        if po_doc.payment_terms:
            locked_terms = [t for t in po_doc.payment_terms if t.status in ["Paid", "Requested", "Approved"]]
            modifiable_terms = [t for t in po_doc.payment_terms if t.status in ["Created", "Scheduled"]]
            locked_amount = sum(flt(t.amount) for t in locked_terms)

            # --- Validation Block for "Return" scenarios ---
            has_existing_return = any(t.status == "Return" for t in po_doc.payment_terms)
            will_create_return = current_total < locked_amount
            if has_existing_return or will_create_return:
                frappe.throw(f"PO {po_name} has been returned and recalculated, not available so revert to Original for Approve this .")

            ## CASE A: INCREASE LOGIC (Unchanged from your version) ##
            if current_total > previous_total:
                increase_amount = current_total - previous_total
                
                if modifiable_terms:
                    last_modifiable_term = modifiable_terms[-1]
                    last_modifiable_term.amount = flt(last_modifiable_term.amount) + increase_amount
                else:
                    due_date = add_days(today(), 1) if po_doc.payment_terms and po_doc.payment_terms[0].payment_type == "Credit" else None
                    payment_type = po_doc.payment_terms[0].payment_type if po_doc.payment_terms else "Cash"
                    po_doc.append("payment_terms", {
                        "label": f"Balance Payment {len(po_doc.payment_terms) + 1}",
                        "amount": increase_amount,
                        "percentage": (increase_amount / current_total) * 100 if current_total > 0 else 0,
                        "status": "Created",
                        "payment_type": payment_type,
                        "due_date": due_date
                    })
            
            # # =================== UPDATED LOGIC IS HERE ===================
            # ## CASE B: REDUCE LOGIC (Updated with confirmed LIFO logic) ##
            # elif current_total < previous_total:
            #     reduction_amount = previous_total - current_total
            #     print(f"REDUCTION AMT: {reduction_amount}")
            #     print(f"Pervious Total: {previous_total}")
            #     print(f"Current Total: {current_total}")
            #     # We iterate in reverse (LIFO) to reduce from the last payment terms first.
            #     for term in reversed(modifiable_terms):
            #         if reduction_amount <= 0.01: 
            #             break # Stop if we have nothing left to reduce.
                    
            #         term_amount = flt(term.amount)
            #         if reduction_amount >= term_amount:
            #             # The reduction is larger than this term, so wipe out the term.
            #             reduction_amount -= term_amount
            #             term.amount = 0
            #         else:
            #             # The reduction is smaller than this term, so only reduce this term.
            #             term.amount = flt(term.amount) - reduction_amount
            #             reduction_amount = 0 # The entire reduction is now applied.
                
            #     # Clean up any terms that have been reduced to zero.
            #     terms_to_keep = [t for t in po_doc.payment_terms if not (t.status in ['Created', 'Scheduled'] and flt(t.amount) < 0.01)]
            #     po_doc.set("payment_terms", [])
            #     for term in terms_to_keep:
            #         po_doc.append("payment_terms", term.as_dict())
            # # =================== END OF UPDATED LOGIC ===================
            ## CASE B: REDUCE LOGIC ##
            elif current_total < previous_total:
                reduction_needed = previous_total - current_total

                # Work with dictionaries for safety and reliability
                locked_term_dicts = [t.as_dict() for t in locked_terms]
                modifiable_term_dicts = [t.as_dict() for t in modifiable_terms]

                # Apply reduction to modifiable terms (LIFO)
                for term_dict in reversed(modifiable_term_dicts):
                    if reduction_needed <= 0.01: break
                    
                    term_amount = flt(term_dict.get("amount", 0))
                    amount_to_deduct = min(term_amount, reduction_needed)
                    
                    term_dict["amount"] = term_amount - amount_to_deduct
                    reduction_needed -= amount_to_deduct
                
                # Create the final list of terms to keep
                final_modifiable_terms = [d for d in modifiable_term_dicts if flt(d.get("amount")) > 0.01]
                all_final_terms = locked_term_dicts + final_modifiable_terms

                # Replace the entire child table with the new, correct list
                po_doc.set("payment_terms", all_final_terms)
            # =================== END OF REDUCE LOGIC ===================

            # --- STEP 3: FINAL CORRECTION & PERCENTAGE RECALCULATION ---
            # This block runs for both increase and decrease scenarios to guarantee correctness.

            # 1. Calculate the actual sum of payment terms after modification
            current_payment_sum = sum(flt(t.amount) for t in po_doc.payment_terms)

            # 2. Find any discrepancy due to floating point math or logic
            discrepancy = current_total - current_payment_sum
            
            # 3. If there is a meaningful discrepancy, adjust the last modifiable term
            if abs(discrepancy) > 0.01:
                # Find the last term that isn't locked
                last_adjustable_term = next((t for t in reversed(po_doc.payment_terms) if t.status not in ["Paid", "Requested", "Approved"]), None)
                if last_adjustable_term:
                    last_adjustable_term.amount = flt(last_adjustable_term.amount) + discrepancy
            
            # --- CONSOLIDATED PERCENTAGE RECALCULATION (Unchanged) ---
            if current_total > 0:
                for term in po_doc.payment_terms:
                    if term.status != "Return":
                        term.percentage = (flt(term.amount) / current_total) * 100
                    else:
                        term.percentage = 0

        # --- STEP 4: Finalize and Save (Unchanged) ---
        po_doc.status = "PO Approved"
        po_doc.save(ignore_permissions=True)
        frappe.db.commit()

        return {"status": 200, "message": f"PO {po_name} has been approved and recalculated successfully."}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "PO Amend/Approval Failed")
        frappe.db.rollback()
        return {"status": 400, "message": str(e)}

import frappe
from frappe.utils import flt
import json

@frappe.whitelist()
def revert_from_amend_po(po_name: str, status: str, items: list):
    """
    Reverts a Procurement Order by re-adding items from a previous state.
    This is the definitive, robust version.
    """
    print("\n" + "="*80)
    print(f"--- [API revert_from_amend_po] STARTING for PO: {po_name} ---")

    try:
        po_doc = frappe.get_doc("Procurement Orders", po_name, for_update=True)

        # --- STEP 1: Clear existing items and RE-ADD the reverted items ---
        print("--- [API revert_from_amend_po] STEP 1: Clearing existing items...")
        po_doc.set("items", [])  # Clear the current child table
        
        print(f"--- [API revert_from_amend_po] STEP 1: Appending {len(items)} items from payload...")
        
        # THIS IS THE CORRECT, ROBUST LOOP
        for item_from_frontend in items:
            # Create a new, blank row in the 'items' child table
            new_row = po_doc.append("items", {})
            
            # Explicitly set the fields on the new row from the frontend data.
            # This is safe and ignores any extra fields the frontend might send.
            # Use .get() to avoid errors if a key is missing.
            new_row.item_id = item_from_frontend.get("item_id")
            new_row.item_name = item_from_frontend.get("item_name")
            new_row.quantity = flt(item_from_frontend.get("quantity"))
            new_row.quote = flt(item_from_frontend.get("quote"))
            new_row.unit = item_from_frontend.get("unit")
            new_row.tax = flt(item_from_frontend.get("tax"))
            new_row.category = item_from_frontend.get("category")
            new_row.make = item_from_frontend.get("make")
            # IMPORTANT: If your "Purchase Order Item" child table has other mandatory
            # fields, add them here. For example:
            # new_row.procurement_request_item = item_from_frontend.get("procurement_request_item")
            
            print(f"    -> Appended item: {new_row.item_name} with quantity {new_row.quantity}")

        print(f"--- [API revert_from_amend_po] STEP 1 COMPLETE: PO in memory now has {len(po_doc.items)} item(s).")
        print("-" * 40)

        # --- STEP 2: Recalculate Totals ---
        print("--- [API revert_from_amend_po] STEP 2: Recalculating totals...")
        # If you have a 'recalculate' method in your Procurement Orders doctype python class, use it.
        # It's a best practice to centralize calculation logic.
        if hasattr(po_doc, "recalculate"):
             po_doc.run_method("recalculate")
        else:
            # Otherwise, do it manually
            new_header_amount = 0
            new_header_tax_amount = 0
            for item in po_doc.items:
                item.amount = flt(item.quote) * flt(item.quantity)
                item.tax_amount = item.amount * (flt(item.tax) / 100.0)
                item.total_amount = item.amount + item.tax_amount
                new_header_amount += item.amount
                new_header_tax_amount += item.tax_amount
            po_doc.amount = new_header_amount
            po_doc.tax_amount = new_header_tax_amount
            po_doc.total_amount = new_header_amount + new_header_tax_amount

        print("--- [API revert_from_amend_po] STEP 2 COMPLETE.")
        print("-" * 40)

        # --- STEP 3: Finalize and Save ---
        print(f"--- [API revert_from_amend_po] STEP 3: Setting status to '{status}' and saving...")
        po_doc.status = status
        po_doc._from_revert = True # Set the temporary flag for the hook
        po_doc.save(ignore_permissions=True)
        frappe.db.commit()
        print("--- [API revert_from_amend_po] STEP 3 COMPLETE: Document saved and committed.")
        
        return {"status": 200, "message": f"PO {po_name} has been successfully reverted."}

    except Exception as e:
        print("\n" + "!"*80)
        print(f"--- [API revert_from_amend_po] CRITICAL ERROR for PO: {po_name}")
        frappe.log_error(frappe.get_traceback(), "PO Revert from Amend Failed")
        frappe.db.rollback()
        print("--- [API revert_from_amend_po] Database transaction has been rolled back.")
        print("!"*80 + "\n")
        return {"status": 400, "message": str(e)}

# import frappe
# from frappe.utils import flt, today, add_days
# import json # Import the json library for pretty-printing

# @frappe.whitelist()
# def revert_from_amend_po(po_name: str, status: str, items: list):
#     """
#     Reverts a Procurement Order from an amendment back to a previous state.

#     This function replaces the existing 'items' child table with a new list of items
#     provided in the payload, recalculates all totals based on the new item list,
#     updates the document status, and saves it.

#     This is typically used to undo an amendment and restore the PO to its last
#     "PO Approved" state.

#     :param po_name: The name (ID) of the Procurement Order to revert.
#     :param status: The new status to set for the PO (e.g., "PO Approved").
#     :param items: A list of item dictionaries representing the state to revert to.
#     """
#     print("\n" + "="*80)
#     print(f"--- [REVERT PO] Starting revert_from_amend_po for PO: {po_name} ---")
#     print(f"--- [REVERT PO] Target Status: {status}")
#     print(f"--- [REVERT PO] Incoming items payload (pretty-printed): {json.dumps(items, indent=2)}")
#     print("="*80 + "\n")

#     try:
#         po_doc = frappe.get_doc("Procurement Orders", po_name, for_update=True)
#         original_total = po_doc.total_amount

#         # --- STEP 1: Replace Items in Document ---
#         print("--- [REVERT PO] STEP 1: Clearing existing items and appending reverted items...")
#         po_doc.set("items", [])  # Clear the current child table
#         # po_doc.append("items", items)
#         print(f"OUT-items: {items}")
#         for item_data in items:
#             print(f"IN-item_data: {item_data}")
#             po_doc.append("items", item_data)
        
#         print(f"--- [REVERT PO] STEP 1 COMPLETE: Successfully replaced {len(po_doc.items)} item(s) in the document.")
#         print("-" * 40)

#         # --- STEP 2: Recalculate Totals ---
#         print("--- [REVERT PO] STEP 2: Recalculating totals based on new item list...")
#         new_header_amount = 0
#         new_header_tax_amount = 0
        
#         for item in po_doc.items:
#             item.amount = flt(item.quote) * flt(item.quantity)
#             item.tax_amount = item.amount * (flt(item.tax) / 100.0)
#             item.total_amount = item.amount + item.tax_amount
#             new_header_amount += item.amount
#             new_header_tax_amount += item.tax_amount
#             print(f"    - Recalculated item '{item.item_id}': Amount={item.amount}, Tax={item.tax_amount}, Total={item.total_amount}")

#         po_doc.amount = new_header_amount
#         po_doc.tax_amount = new_header_tax_amount
#         po_doc.total_amount = new_header_amount + new_header_tax_amount
        
#         print("--- [REVERT PO] STEP 2 COMPLETE: Totals recalculated.")
#         print(f"    - Original Total Amount: {original_total}")
#         print(f"    - New Total Amount: {po_doc.total_amount}")
#         print("-" * 40)
        
#         # Note: We are NOT adjusting payment terms here. Reverting implies
#         # restoring the previous state, including its associated payment terms.
#         # The `approve` function is responsible for complex payment term logic.

#         # --- STEP 3: Finalize and Save ---
#         print(f"--- [REVERT PO] STEP 3: Setting status to '{status}' and saving the document...")
#         po_doc.status = status
#         po_doc._from_revert = True
#         po_doc.save(ignore_permissions=True)
#         print(f"DEBUG-After save: {po_doc.status}:{po_doc}")
#         frappe.db.commit()

#         print("--- [REVERT PO] STEP 3 COMPLETE: Document saved and transaction committed.")
#         print("-" * 40)

#         success_message = f"PO {po_doc.items} has been successfully reverted and approved."
#         print(f"--- [REVERT PO] SUCCESS: {success_message}")
#         print("="*80 + "\n")
#         return {"status": 200, "message": success_message}

#     except Exception as e:
#         print("\n" + "!"*80)
#         print("--- [REVERT PO] ERROR: An exception occurred during the revert process.")
#         frappe.log_error(frappe.get_traceback(), "PO Revert from Amend Failed")
#         frappe.db.rollback()
#         print("--- [REVERT PO] ERROR: Database transaction has been rolled back.")
#         print("!"*80 + "\n")
        
#         # Ensure the error message is passed to the frontend
#         return {"status": 400, "message": str(e)}

