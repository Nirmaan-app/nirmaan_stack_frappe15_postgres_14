import frappe
from frappe import _
from frappe.utils import flt, nowdate
import json

@frappe.whitelist()
def make_po_revisions(po_id, justification, revision_items, total_amount_difference, payment_return_details):
    """
    Creates a new draft 'PO Revisions' entry from an existing 'Procurement Orders'
    and populates it with revision data.

    Use Case: Called when a user submits "Revise PO" on the frontend.
    What it does: Safely stores requested item changes (New, Revised, Replace, Deleted)
    and financial adjustments as a 'Pending' revision, without modifying the original,
    locked Procurement Order.
    """
    try:
        po = frappe.get_doc("Procurement Orders", po_id)
        
        rev_po = frappe.new_doc("PO Revisions")
        rev_po.revised_po = po_id
        rev_po.project = po.project
        # rev_po.project_name = getattr(po, 'project_name', '')
        rev_po.vendor = po.vendor
        # rev_po.vendor_name = getattr(po, 'vendor_name', '')
        rev_po.status = "Pending"
        rev_po.revision_justification = justification
        rev_po.total_amount_difference = flt(total_amount_difference)
        
        # Ensure payment_return_details is a string before saving
        if not isinstance(payment_return_details, str):
            rev_po.payment_return_details = json.dumps(payment_return_details)
        else:
            rev_po.payment_return_details = payment_return_details
        
        # Parse revision items
        if isinstance(revision_items, str):
            revision_items = json.loads(revision_items)
            
        for item in revision_items:
            item_type = item.get("item_type")
            row_data = {
                "item_type": item_type,
                "item_status": "Pending",
            }

            # Original Anchors - Skip for "New" items
            if item_type != "New":
                row_data.update({
                    "original_row_id": item.get("original_row_id"), 
                    "original_item_id": item.get("original_item_id"),
                    "original_item_name": item.get("original_item_name"),
                    "original_make": item.get("original_make"),
                    "original_unit": item.get("original_unit"),
                    "original_qty": flt(item.get("original_qty")),
                    "original_rate": flt(item.get("original_rate")),
                    "original_amount": flt(item.get("original_amount")),
                    "original_tax": flt(item.get("original_tax")),
                })

            # Revision Details - Skip for "Original" and "Deleted" items
            if item_type not in ["Original", "Deleted"]:
                row_data.update({
                    "revision_item_id": item.get("item_id"),
                    "revision_item_name": item.get("item_name"),
                    "revision_make": item.get("make"),
                    "revision_qty": flt(item.get("quantity")),
                    "revision_unit": item.get("unit"),
                    "revision_rate": flt(item.get("quote")),
                    "revision_amount": flt(item.get("amount")),
                    "revision_tax": flt(item.get("tax")),
                })

            rev_po.append("revision_items", row_data)
            
        rev_po.insert(ignore_permissions=True)  # Must insert to get name for payments

        # Upfront negative flow logic has been disabled per request.
        # All Project Payments and Terms will be handled strictly upon Approval.
                    
        return rev_po.name

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Make PO Revisions API Error")
        frappe.throw(str(e))


    
    # Also store a master list of created payments for easy deletion
    if not hasattr(rev_po, 'created_project_payments'):
        rev_po.db_set('revision_justification', rev_po.revision_justification) # dummy to force update 
    
    rev_po.save(ignore_permissions=True)

def _split_target_po_term(target_po_id, transfer_amount, payment_name, source_po_id):
    """
    Finds the first available 'Created' term on the Target PO, reduces it,
    and inserts a new 'Credit' term right below it linked to the payment.

    Use Case: Used during the negative revision flow when excess credit is transferred "Against-po".
    What it does: Accurately reduces the target PO's pending payments by the credit amount
    from the revised source PO.
    """
    target_po = frappe.get_doc("Procurement Orders", target_po_id)
    if not target_po.payment_terms: return

    credit_remaining = transfer_amount
    new_terms = []
    
    for term in target_po.payment_terms:
        # If we still have credit to apply and this term is unpaid
        if credit_remaining > 0 and term.term_status == "Created":
            term_amount = flt(term.amount)
            # We can only deduct up to what the term currently holds
            reduction = min(term_amount, credit_remaining)
            
            if reduction > 0:
                # Reduce the original term
                term.amount = term_amount - reduction
                new_terms.append(term.as_dict())
                
                # Create the new split reserved term
                split_term = {
                    "label": f"{term.label} (Credit from PO {source_po_id})",
                    "amount": reduction,
                    "percentage": 0, # Percentage will be recalculated on approval if needed, keep 0 for draft
                    "term_status": "Paid", # Keeps it un-usable by regular GRNs
                    "payment_type": term.payment_type,
                    "project_payment": payment_name
                }
                new_terms.append(split_term)
                credit_remaining -= reduction
            else:
                new_terms.append(term.as_dict())
        else:
            new_terms.append(term.as_dict())
            
    # Set and save the newly cascaded terms
    target_po.set("payment_terms", new_terms)
    
    # Recalculate percentages for regular terms to keep UI balanced
    target_po.calculate_totals_from_items()
    target_total = flt(target_po.total_amount)
    if target_total > 0:
        for t in target_po.payment_terms:
            t.percentage = (flt(t.amount) / target_total) * 100
            
    target_po.save(ignore_permissions=True)


@frappe.whitelist()
def on_approval_revision(revision_name):
    """
    Handles the actual application of changes to the Original PO and financials.
    Triggered when the manager Approves the PO Revision.

    Use Case: Executed when a manager clicks "Approve" on a pending PO Revision.
    What it does: Orchestrates the application of changes:
    1. Syncs item edits back to the original PO.
    2. Calls positive flow logic if the total cost increased (asking for more money).
    3. Calls negative flow logic if the total cost decreased (processing refunds/credits).
    """
    revision_doc = frappe.get_doc("PO Revisions", revision_name)
    
    if revision_doc.status == "Approved":
        frappe.throw(_("This revision is already approved."))

    frappe.db.begin()
    try:
        # Step 1: Sync Items
        sync_original_po_items(revision_doc)
        
        # Step 2: Handle Financial Changes
        diff = flt(revision_doc.total_amount_difference)
        if diff > 0:
            process_positive_increase(revision_doc)
        elif diff < 0:
            process_negative_returns(revision_doc)
            
        # Step 3: Finalize Status
        revision_doc.status = "Approved"
        revision_doc.save(ignore_permissions=True)
        
        # Step 4: Unlock the original PO (if we locked it)
        # frappe.db.set_value("Procurement Orders", revision_doc.revised_po)
        
        frappe.db.commit()
        return "Success"

    except Exception as e:
        frappe.db.rollback()
        
        # Cleanup: Delete any Project Payments that were generated before the error occurred
        # Since it rolled back, the PO terms are safe, but standalone Docs might persist.
        try:
            target_pos = [revision_doc.revised_po]
            
            # Try to extract target POs from JSON
            if revision_doc.payment_return_details:
                try:
                    data = json.loads(revision_doc.payment_return_details) if isinstance(revision_doc.payment_return_details, str) else revision_doc.payment_return_details
                    block = data.get("list", {})
                    if block.get("type") == "Refund Adjustment":
                        for entry in block.get("Details", []):
                            if entry.get("return_type") == "Against-po":
                                for target in entry.get("target_pos", []):
                                    t_po_id = target.get("po_number")
                                    if t_po_id:
                                        target_pos.append(t_po_id)
                except Exception:
                    pass

            # Calculate 5 minutes ago to strictly target freshly generated payments
            import datetime
            minutes_ago = frappe.utils.now_datetime() - datetime.timedelta(minutes=1)

            stray_payments = frappe.get_all(
                "Project Payments", 
                filters={
                    "creation": [">", minutes_ago],
                    "document_name": ["in", target_pos]
                },
                fields=["name"]
            )
            
            # Combine dynamically found stray payments with the strictly tracked ones
            tracked_payments = getattr(frappe.local, 'rollback_payments', [])
            all_payments_to_delete = set([p.name for p in stray_payments] + tracked_payments)

            for pay_name in all_payments_to_delete:
                frappe.delete_doc("Project Payments", pay_name, force=1, ignore_permissions=True)
                
            # Cleanup stray Project Expenses
            tracked_expenses = getattr(frappe.local, 'rollback_expenses', [])
            for exp_name in tracked_expenses:
                frappe.delete_doc("Project Expenses", exp_name, force=1, ignore_permissions=True)
                
        except Exception:
            pass # Keep original rollback error primary
            
        frappe.log_error(frappe.get_traceback(), "PO Revision Approval Error")
        frappe.throw(_("Approval failed: {0}").format(str(e)))


def _get_item_metadata(item_id):
    """
    Fetches category and procurement_package based on item_id.

    Use Case: Helper function used when adding new items to a PO during a revision.
    What it does: Retrieves necessary metadata (category, work package) for a new item 
    so it can be correctly tracked on the original PO.
    """
    if not item_id:
        return None, None
    category = frappe.db.get_value("Items", item_id, "category")
    package = None
    if category:
        package = frappe.db.get_value("Category", category, "work_package")
    return category, package


def sync_original_po_items(revision_doc):
    """
    Mirrors item changes (Original, New, Revised, Replace, Deleted) back to the Original PO.

    Use Case: Step 1 of the Approval process.
    What it does: Matches up the revision items with the original PO items and applies
    the actual modifications (updating values, adding new rows, deleting rows) to the 
    original Procurement Order.
    """
    original_po = frappe.get_doc("Procurement Orders", revision_doc.revised_po)
    
    # Map original items by their row 'name' for O(1) access
    original_item_map = {row.name: row for row in original_po.get("items", [])}

    for rev_item in revision_doc.get("revision_items", []):
        
        if rev_item.item_type == "Original":
            rev_item.item_status = "Approved"
            continue
            
        elif rev_item.item_type == "New":
            new_row = original_po.append("items", {})
            new_row.item_id = rev_item.revision_item_id
            new_row.item_name = rev_item.revision_item_name
            new_row.quantity = flt(rev_item.revision_qty)
            new_row.unit = rev_item.revision_unit
            new_row.quote = flt(rev_item.revision_rate)
            new_row.amount = flt(rev_item.revision_amount)
            new_row.tax = flt(rev_item.revision_tax) # Changed to tax
            new_row.make = rev_item.revision_make
            new_row.tax_amount = (new_row.amount * new_row.tax) / 100
            new_row.total_amount = new_row.amount + new_row.tax_amount
            
            # Fetch and assign metadata
            cat, pkg = _get_item_metadata(new_row.item_id)
            new_row.category = cat
            new_row.procurement_package = pkg
            
            rev_item.item_status = "Approved"

        elif rev_item.item_type == "Revised":
            if rev_item.original_row_id in original_item_map:
                orig_row = original_item_map[rev_item.original_row_id]
                orig_row.quantity = flt(rev_item.revision_qty)
                orig_row.unit = rev_item.revision_unit
                orig_row.quote = flt(rev_item.revision_rate)
                orig_row.amount = flt(rev_item.revision_amount)
                orig_row.tax = flt(rev_item.revision_tax) # Changed to tax
                orig_row.make = rev_item.revision_make
                orig_row.tax_amount = (orig_row.amount * orig_row.tax) / 100
                orig_row.total_amount = orig_row.amount + orig_row.tax_amount
                
                rev_item.item_status = "Approved"
            else:
                frappe.throw(_("Original item row {0} not found for revision.").format(rev_item.original_row_id))

        elif rev_item.item_type == "Replace":
            if rev_item.original_row_id in original_item_map:
                orig_row = original_item_map[rev_item.original_row_id]
                
                # Identity change
                orig_row.item_id = rev_item.revision_item_id 
                orig_row.item_name = rev_item.revision_item_name
                
                # Value properties
                orig_row.quantity = flt(rev_item.revision_qty)
                orig_row.unit = rev_item.revision_unit
                orig_row.quote = flt(rev_item.revision_rate)
                orig_row.amount = flt(rev_item.revision_amount)
                orig_row.tax = flt(rev_item.revision_tax) # Changed to tax
                orig_row.make = rev_item.revision_make
                orig_row.tax_amount = (orig_row.amount * orig_row.tax) / 100
                orig_row.total_amount = orig_row.amount + orig_row.tax_amount
                
                rev_item.item_status = "Approved"
            else:
                frappe.throw(_("Original row '{0}' not found. Cannot perform Replacement.").format(rev_item.original_row_id))

        elif rev_item.item_type == "Deleted":
            if rev_item.original_row_id in original_item_map:
                orig_row = original_item_map[rev_item.original_row_id]
                
                # Anti-corruption check: Cannot delete if we've received goods against it
                if flt(getattr(orig_row, 'received_quantity', 0)) > 0:
                    frappe.throw(_("Cannot delete item {0} as it has already received quantity.").format(orig_row.item_id))
                
                original_po.get("items").remove(orig_row)
                rev_item.item_status = "Approved"

    # Re-calculate parent totals if method exists
    if hasattr(original_po, 'calculate_totals_from_items'):
         original_po.calculate_totals_from_items()
         
    original_po.flags.ignore_validate_update_after_submit = True
    original_po.save(ignore_permissions=True)


def process_positive_increase(revision_doc):
    """
    Handles cost increases: Updates existing terms, appends new ones,
    and recalculates percentages for ALL terms based on the new PO total.

    Use Case: Step 2 of the Approval process (Positive Flow).
    What it does: When a revision makes the PO more expensive, it recalculates the grand total,
    adds newly agreed-upon payment terms for the extra cost, and rebalances the percentages of 
    all existing terms to sum to 100%.
    """
    data = revision_doc.payment_return_details
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            data = {}
            
    if not isinstance(data, dict):
        return
        
    block = data.get("list")
    if isinstance(block, dict) and block.get("type") == "Payment Terms":
        block["status"] = "Approved"
        
        # 1. Load Original PO & Refresh Totals to get the new Grand Total
        original_po = frappe.get_doc("Procurement Orders", revision_doc.revised_po)
        original_po.calculate_totals_from_items()
        new_total = flt(original_po.total_amount)
        
        details = block.get("Details", [])
        if isinstance(details, list):
            for entry in details:
                if isinstance(entry, dict):
                    entry["status"] = "Approved"
                    
                    submitted_terms = entry.get("terms", [])
                    if isinstance(submitted_terms, list):
                        # Map existing terms for reconciliation
                        existing_terms = {t.name: t for t in original_po.get("payment_terms", [])}

                        # Get existing payment type from the first term if available
                        existing_payment_type = None
                        if original_po.payment_terms:
                            existing_payment_type = original_po.payment_terms[0].payment_type

                        for st in submitted_terms:
                            term_id = st.get("id")
                            if term_id and term_id in existing_terms:
                                # Update existing term (if passed explicitly)
                                target = existing_terms[term_id]
                                target.amount = flt(st.get("amount"))
                                target.label = st.get("label")
                            else:
                                # Try to merge into an existing 'Created' term first
                                merge_target = None
                                for term in original_po.get("payment_terms", []):
                                    if term.term_status == "Created":
                                        merge_target = term
                                        break
                                
                                if merge_target:
                                    # Merge into the existing unpaid term
                                    merge_target.amount += flt(st.get("amount"))
                                    # Update label intelligently
                                    new_label = st.get("label", "").strip()
                                    if new_label and new_label.lower() not in (merge_target.label or "").lower():
                                        merge_target.label = f"{merge_target.label} + {new_label}"
                                else:
                                    # Fallback: Append a brand new term
                                    new_term_data = {
                                        "label": st.get("label"),
                                        "amount": flt(st.get("amount")),
                                        "vendor": original_po.vendor,
                                        "project": original_po.project,
                                        "term_status": "Created",
                                        "payment_type": existing_payment_type
                                    }
                                    
                                    # If the inherited payment type is Credit, set due_date to today + 2 days
                                    if existing_payment_type == "Credit":
                                        new_term_data["due_date"] = frappe.utils.add_days(frappe.utils.nowdate(), 2)
                                        
                                    original_po.append("payment_terms", new_term_data)

                        # 2. Recalculate percentages for ALL terms on the PO based on final grand total
                        if new_total > 0:
                            for term in original_po.get("payment_terms", []):
                                # Field is 'Data', but we store numeric percentage for consistency
                                term.percentage = flt((flt(term.amount) / new_total) * 100, 2)
                        
                        # 3. Synchronize percentages back to the Revision JSON
                        for st in submitted_terms:
                            if new_total > 0:
                                st["percentage"] = flt((flt(st.get("amount")) / new_total) * 100, 2)
        
        # 4. Save original PO with reconciled terms and percentages
        original_po.flags.ignore_validate_update_after_submit = True
        original_po.save(ignore_permissions=True)
            
    revision_doc.payment_return_details = json.dumps(data)


def _create_project_payment(po_id, project, vendor, amt, status):
    """
    Internal helper to create a Project Payment record without appending terms.

    Use Case: Helper function used during the negative revision flow (refunds/credits).
    What it does: Creates standalone Project Payment records to track money moving 
    in (refunds) or out (credits transferred to other POs).
    """
    pay = frappe.new_doc("Project Payments")
    pay.document_type = "Procurement Orders"
    pay.document_name = po_id
    pay.project = project
    pay.vendor = vendor
    pay.amount = amt
    pay.status = status
    pay.payment_date = nowdate()
    pay.flags.ignore_amount_validation = True # Bypass basic manual payment validation for internal adjustments
    pay.save(ignore_permissions=True)
    
    # Store reference so rollback can delete it if approval fails halfway 
    if not hasattr(frappe.local, 'rollback_payments'):
        frappe.local.rollback_payments = []
    frappe.local.rollback_payments.append(pay.name)
    
    return pay

def _append_return_payment_term(po_doc, payment_doc, term_label, amt):
    """
    Internal helper to add a Return/Adjustment term row to the existing PO in memory.

    Use Case: Helper function used during the negative revision flow.
    What it does: Appends a specific tracking row ("Return" or "Paid") to the PO's 
    payment terms to reflect refunds or credits explicitly on the UI.
    """
    existing_payment_type = "Cash"
    if po_doc.payment_terms:
        existing_payment_type = po_doc.payment_terms[0].payment_type

    # If amount is negative (money going out), status = Return. If positive (money coming in), status = Paid.
    conditional_status = "Return" if flt(amt) < 0 else "Paid"

    po_doc.append("payment_terms", {
        "label": term_label,
        "amount": amt, # Keep the sign true to what was passed so it reflects on the UI accurately per user request
        "percentage": 0.0,
        "term_status": conditional_status,
        "payment_type": existing_payment_type,
        "project_payment": payment_doc.name
    })

def _reduce_payment_terms_lifo(original_po, reduction_needed, new_total):
    """
    Reduces modifiable terms bottom-up strictly according to reduction needed.

    Use Case: Helper function used during the negative revision flow.
    What it does: Adjusts the original PO's un-paid payment terms from the bottom up 
    (Last-In, First-Out), essentially canceling out future payments that are no longer 
    needed due to items being made cheaper or removed.
    """
    locked_terms = [t for t in original_po.payment_terms if t.term_status in ["Paid", "Requested", "Approved"] and "Return" not in (t.label or "")]
    modifiable_terms = [t for t in original_po.payment_terms if t.term_status in ["Created"] and "Return" not in (t.label or "")]
    locked_amount = sum(flt(t.amount) for t in locked_terms)
    
    # Calculate negative return terms manually appended
    return_amount = sum(flt(t.amount) for t in original_po.payment_terms if "Return" in (t.label or "") and flt(t.amount) < 0)

    # Validation: Ensure we don't reduce below what is already locked (Paid/Requested), offsetting the return
    if new_total < (locked_amount + return_amount):
        frappe.throw(f"Revision calculation reduces amount below already paid/requested terms. Revert not possible.")

    locked_term_dicts = [t.as_dict() for t in locked_terms]
    modifiable_term_dicts = [t.as_dict() for t in modifiable_terms]

    # The appended 'Return' terms already account for a portion (or all) of the reduction.
    # We only need to reduce the modifiable terms by the remaining gap (if any).
    reduction_needed_for_terms = max(0, reduction_needed - abs(return_amount))

    # Apply LIFO reduction to modifiable terms
    for term_dict in reversed(modifiable_term_dicts):
        if reduction_needed_for_terms <= 0.01: break
        
        term_amount = flt(term_dict.get("amount", 0))
        amount_to_deduct = min(term_amount, reduction_needed_for_terms)
        
        term_dict["amount"] = term_amount - amount_to_deduct
        reduction_needed_for_terms -= amount_to_deduct
    
    # Preserve locked terms, reduced modifiable terms (> 0), and any Return terms
    return_terms = [t.as_dict() for t in original_po.payment_terms if "Return" in (t.label or "")]
    final_modifiable_terms = [d for d in modifiable_term_dicts if flt(d.get("amount")) > 0.01]
    
    # Reset child table with the corrected list
    original_po.set("payment_terms", locked_term_dicts + final_modifiable_terms + return_terms)

    # Final Adjustment for floating point drift
    # Here we MUST include Return terms because Frappe validates that the sum of all terms == new_total
    current_payment_sum = sum(flt(t.amount) for t in original_po.payment_terms)
    discrepancy = new_total - current_payment_sum
    
    if abs(discrepancy) > 0.01:
        last_adjustable_term = next((t for t in reversed(original_po.payment_terms) if t.term_status not in ["Paid", "Requested", "Approved"] and "Return" not in (t.label or "")), None)
        if last_adjustable_term:
            last_adjustable_term.amount = flt(last_adjustable_term.amount) + discrepancy

    # Assign percentages cleanly based strictly on new_total
    for term in original_po.payment_terms:
        # If it's a "Return/Refund" tracking term we appended, leave percentage at 0
        if "Return" in (term.label or "") or new_total <= 0:
            term.percentage = 0.0
        else:
            term.percentage = (flt(term.amount) / new_total) * 100



def process_negative_returns(revision_doc):
    """
    Handles when total_amount_difference < 0 upon Approval.
    Creates all necessary Project Payments (Out and In), splits Target PO terms,
    and appends Return terms on the Original PO only upon Approval.

    Use Case: Step 2 of the Approval process (Negative Flow).
    What it does: Handles complex accounting when a PO becomes cheaper. It can create a direct 
    refund, transfer credit to another open PO for the exact same vendor, and adjust the 
    original PO's future payment terms downwards.
    """
    data = revision_doc.payment_return_details
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception as e:
            frappe.throw(_("Invalid JSON in Payment Return Details: {0}").format(str(e)))
        
    if not isinstance(data, dict): return
    block = data.get("list")
    if not isinstance(block, dict) or block.get("type") != "Refund Adjustment": return
    
    entries = block.get("Details", [])
    if not isinstance(entries, list):
        entries = [entries] if entries else []
        
    original_po = frappe.get_doc("Procurement Orders", revision_doc.revised_po)

    # Process each JSON entry and Create Paid Payments
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("status") != "Pending":
            continue
            
        r_type = entry.get("return_type")
        amount = abs(flt(entry.get("amount", 0)))
        
        # A. Against-po
        if r_type == "Against-po":
            for target in entry.get("target_pos", []):
                t_amount = abs(flt(target.get("amount", 0)))
                t_po_id = target.get("po_number")
                if not t_po_id or t_amount <= 0: continue
                
                # CREATE Adjustment Out NOW
                pay_out = _create_project_payment(
                    po_id=revision_doc.revised_po, project=revision_doc.project, vendor=revision_doc.vendor,
                    amt=-t_amount, status="Paid"
                )
                _append_return_payment_term(original_po, pay_out, f"Return - Against PO {t_po_id}", -t_amount)

                # CREATE Adjustment In NOW
                pay_in = _create_project_payment(
                    po_id=t_po_id, project=revision_doc.project, vendor=revision_doc.vendor,
                    amt=t_amount, status="Paid"
                )
                # Split Target PO Term NOW
                _split_target_po_term(t_po_id, t_amount, pay_in.name, revision_doc.revised_po)

        # B. Vendor-has-refund
        elif r_type == "Vendor-has-refund":
            # CREATE Return/Refund NOW
            pay_refund = _create_project_payment(
                po_id=revision_doc.revised_po, project=revision_doc.project, vendor=revision_doc.vendor,
                amt=-amount, status="Paid"
            )
            _append_return_payment_term(original_po, pay_refund, "Return - Vendor Refund", -amount)

        # C. Ad-hoc
        elif r_type == "Ad-hoc":
            desc = entry.get("ad-hoc_dexription", "")
            expense_type = entry.get("ad-hoc_tyep", "")
            # CREATE Ad-hoc NOW
            pay_adhoc = _create_project_payment(
                po_id=revision_doc.revised_po, project=revision_doc.project, vendor=revision_doc.vendor,
                amt=-amount, status="Paid"
            )
            _append_return_payment_term(original_po, pay_adhoc, f"Return - Adhoc {desc}", -amount)
            
            # CREATE PROJECT EXPENSE
            if expense_type:
                expense = frappe.new_doc("Project Expenses")
                expense.projects = revision_doc.project
                expense.type = expense_type
                expense.vendor = revision_doc.vendor
                expense.description = desc
                expense.amount = amount  # Positive amount for expense
                expense.payment_date = nowdate()
                expense.payment_by = revision_doc.owner
                comment_text = entry.get("comment", "").strip()
                po_prefix = f"PO {revision_doc.revised_po}"
                expense.comment = f"{po_prefix}\n{comment_text}" if comment_text else po_prefix
                
                expense.save(ignore_permissions=True)
                
                if not hasattr(frappe.local, 'rollback_expenses'):
                    frappe.local.rollback_expenses = []
                frappe.local.rollback_expenses.append(expense.name)

        entry["status"] = "Approved"

    block["status"] = "Approved"
    revision_doc.payment_return_details = json.dumps(data)
    
    # Handle Original PO Term LIFO Reduction
    original_po.calculate_totals_from_items()
    new_total = flt(original_po.total_amount)
    reduction_needed = abs(flt(revision_doc.total_amount_difference))

    if original_po.payment_terms and reduction_needed > 0:
        _reduce_payment_terms_lifo(original_po, reduction_needed, new_total)

    # Sync modified timestamp from DB to bypass TimestampMismatchError caused by backend Project Payments
    original_po.modified = frappe.db.get_value("Procurement Orders", original_po.name, "modified")
    original_po.save(ignore_permissions=True)


@frappe.whitelist()
def on_reject_revision(revision_name):
    """
    Handles the rejection or cancellation of a PO Revision.
    Since payments and terms are no longer created upfront, this just marks the revision rejected.

    Use Case: Executed when a manager clicks "Reject" on a PO Revision.
    What it does: Cancels the revision request simply by marking its status as "Rejected". 
    Since financial/item changes are deferred until approval, no complex rollback is needed.
    """
    revision_doc = frappe.get_doc("PO Revisions", revision_name)
    
    if revision_doc.status in ["Approved", "Rejected"]:
        frappe.throw(_("This revision cannot be rejected in its current state."))

    frappe.db.begin()
    try:
        revision_doc.status = "Rejected"
        revision_doc.save(ignore_permissions=True)
        frappe.db.commit()
        return "Success"

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "PO Revision Rejection Error")
        frappe.throw(_("Rejection failed: {0}").format(str(e)))

@frappe.whitelist()
def get_adjustment_candidate_pos(vendor, current_po):
    """
    Returns a list of approved POs for the same vendor that could potentially 
    receive a payment adjustment 'In'.

    Use Case: Used by the frontend dropdown during a Negative Revision.
    What it does: Fetches a list of other active, approved Procurement Orders for the 
    same vendor where excess credit from a revision could be transferred.
    """
    return frappe.get_all("Procurement Orders", 
        filters={
            "vendor": vendor,
            "docstatus": 1,
            "name": ["!=", current_po],
            "status": ["not in", ["Cancelled", "Closed"]]
        },
        fields=["name", "total_amount", "vendor_name", "creation", "project", "project_name"],
        order_by="creation desc",
        limit=50
    )
