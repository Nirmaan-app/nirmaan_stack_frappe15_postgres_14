import frappe
from frappe.utils import flt, today, add_days

@frappe.whitelist()
def approve_amend_po_with_payment_terms(po_name: str):
    """
    Approves an amended PO, recalculates totals, and intelligently updates payment terms
    based on whether the total increased or decreased.
    This is the final version, correctly handling overpayment scenarios.

    :param po_name: The name (ID) of the Procurement Order to process.
    """
    try:
        po_doc = frappe.get_doc("Procurement Orders", po_name, for_update=True)

        if po_doc.docstatus != 0:
            frappe.throw(f"PO {po_name} must be in Draft status to be amended and approved.")

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
            locked_terms = [t for t in po_doc.payment_terms if t.status in ["Paid", "Requested"]]
            created_terms = [t for t in po_doc.payment_terms if t.status == "Created"]
            locked_amount = sum(flt(t.amount) for t in locked_terms)

            ## CASE A: INCREASE LOGIC ##
            if current_total > previous_total:
                # This block remains correct
                if not locked_terms:
                    for term in po_doc.payment_terms:
                        term.amount = current_total * (flt(term.percentage) / 100.0)
                else:
                    if current_total < locked_amount:
                        frappe.throw(f"New total ({current_total}) cannot be less than paid/requested amount ({locked_amount}).")
                    remaining_balance = current_total - locked_amount
                    for term in locked_terms:
                        term.percentage = (flt(term.amount) / current_total) * 100 if current_total > 0 else 0
                    if created_terms:
                        amount_per_term = remaining_balance / len(created_terms)
                        for term in created_terms:
                            term.amount = amount_per_term
                            term.percentage = (amount_per_term / current_total) * 100 if current_total > 0 else 0
                    else:
                        due_date = add_days(today(), 1) if po_doc.payment_terms[0].payment_type == "Credit" else None
                        po_doc.append("payment_terms", {"label": "Amended Payment"+str(len(po_doc.payment_terms)), "amount": remaining_balance, "percentage": (remaining_balance / current_total) * 100 if current_total > 0 else 0, "status": "Created", "payment_type": po_doc.payment_terms[0].payment_type, "due_date": due_date}) 
            
            ## CASE B: REDUCE LOGIC ##
            elif current_total < previous_total:
                # --- RECENT CHANGE: Handle Overpayment and Normal Reduction separately ---

                # If the current total is less than the locked amount, then the PO is overpaid.
                if current_total < locked_amount:
                    # ** OVERPAYMENT SCENARIO **
                    # The amount paid/requested is MORE than the new PO total.
                    overpayment_amount = locked_amount - current_total

                    # All "Created" terms are now irrelevant and must be zeroed out.
                    for term in created_terms:
                        term.amount = 0
                    
                    # Create the "Return" term for the overpayment amount.
                    po_doc.append("payment_terms", {
                        "label": "Return",
                        "amount": overpayment_amount,
                        "status": "Return",
                        "percentage": 0
                    })
                else:
                    # ** NORMAL REDUCTION SCENARIO **
                    # The new total is still greater than or equal to the locked amount.
                    reduction_amount = previous_total - current_total
                    for term in created_terms:
                        if reduction_amount <= 0: break
                        
                        term_amount = flt(term.amount)
                        if reduction_amount >= term_amount:
                            reduction_amount -= term_amount
                            term.amount = 0
                        else:
                            term.amount = flt(term.amount) - reduction_amount
                            reduction_amount = 0
                
                # --- CONSOLIDATED CLEANUP AND RECALCULATION FOR ALL REDUCTION SCENARIOS ---
                # Remove any "Created" terms that were zeroed out.
                terms_to_keep = [t for t in po_doc.payment_terms if not (t.status == 'Created' and flt(t.amount) < 0.01)]
                po_doc.set("payment_terms", [])
                for term in terms_to_keep:
                    po_doc.append("payment_terms", term)

                # Recalculate percentages for all remaining terms.
                for term in po_doc.payment_terms:
                    if term.status != "Return":
                        term.percentage = (flt(term.amount) / current_total) * 100 if current_total > 0 else 0
                    else:
                        term.percentage = 0
            
        # --- STEP 4: Finalize and Save ---
        po_doc.status = "PO Approved"
        po_doc.save(ignore_permissions=True)
        frappe.db.commit()

        return {"status": 200, "message": f"PO {po_name} has been approved and recalculated."}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "PO Amend/Approval Failed")
        frappe.db.rollback()
        return {"status": 400, "message": str(e)}
