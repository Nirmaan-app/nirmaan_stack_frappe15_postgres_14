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

            # =================== UPDATED LOGIC IS HERE ===================
            ## CASE B: REDUCE LOGIC (Updated with confirmed LIFO logic) ##
            elif current_total < previous_total:
                reduction_amount = previous_total - current_total
                
                # We iterate in reverse (LIFO) to reduce from the last payment terms first.
                for term in reversed(modifiable_terms):
                    if reduction_amount <= 0: 
                        break # Stop if we have nothing left to reduce.
                    
                    term_amount = flt(term.amount)
                    if reduction_amount >= term_amount:
                        # The reduction is larger than this term, so wipe out the term.
                        reduction_amount -= term_amount
                        term.amount = 0
                    else:
                        # The reduction is smaller than this term, so only reduce this term.
                        term.amount = flt(term.amount) - reduction_amount
                        reduction_amount = 0 # The entire reduction is now applied.
                
                # Clean up any terms that have been reduced to zero.
                terms_to_keep = [t for t in po_doc.payment_terms if not (t.status in ['Created', 'Scheduled'] and flt(t.amount) < 0.01)]
                po_doc.set("payment_terms", [])
                for term in terms_to_keep:
                    po_doc.append("payment_terms", term.as_dict())
            # =================== END OF UPDATED LOGIC ===================

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
