import frappe
import json
from nirmaan_stack.api.vendor_credit import recalculate_vendor_credit
from nirmaan_stack.integrations.controllers.procurement_orders import cleanup_po_linked_docs

@frappe.whitelist()
def handle_cancel_po(po_id: str, comment: str = None):
    """
    Cancels a Procurement Order.
    - 'Additional Charge' items from the PO are ignored.
    - Regular items are moved to a 'Cancelled' type Sent Back Category document.
    """
    try:
        frappe.db.begin()

        # 1. Fetch required documents with validation
        po_doc = frappe.get_doc("Procurement Orders", po_id)

        is_merged_master = (po_doc.merged == "true")
        source_pos = []
        if is_merged_master:
            source_pos = frappe.get_all(
                "Procurement Orders",
                filters={"merged": po_id},
                fields=["name"]
            )

        pr_name = po_doc.procurement_request
        if not pr_name:
            # Raise a specific, helpful error
            frappe.throw(f"The cancelled Procurement Order '{po_id}' is not linked to a Procurement Request. Cannot proceed.", title="Missing Link")
        
        pr_doc = frappe.get_doc("Procurement Requests", pr_name)
        
        # Use .get() for safety, returns [] if 'items' field doesn't exist or is empty
        items_from_po = po_doc.get("items", [])
        if not items_from_po:
            # This is not necessarily an error, could be a PO with only charges.
            # We can let the logic proceed.
            pass

        # 2. Partition items and IGNORE Additional Charges
        regular_items_to_send_back = []
        for item in items_from_po:
            if item.category != "Additional Charges":
                regular_items_to_send_back.append(item)

        # 3. Act ONLY on the "Regular Items" group
        sent_back_doc_name = None
        if regular_items_to_send_back:
            # Create the new document that will hold the sent-back items
            new_sent_back_doc = frappe.new_doc("Sent Back Category")
            new_sent_back_doc.type = "Cancelled"
            new_sent_back_doc.procurement_request = pr_doc.name
            new_sent_back_doc.project = po_doc.project
            
            for item_doc in regular_items_to_send_back:
                # Prepare the item dictionary for the child table
                item_dict = item_doc.as_dict()
                item_dict["status"] = "Pending"

                # Clean internal Frappe fields to prevent errors on insert
                for field in ['name', 'parent', 'parentfield', 'parenttype', 'doctype', 'owner', 'creation', 'modified', 'modified_by', 'idx']:
                    if field in item_dict:
                        del item_dict[field]

                # **DEFINITIVE FIX:** Use .append() to add the item to the child table
                new_sent_back_doc.append("order_list", item_dict)

            # Skip after_insert notifications (their frappe.db.commit() would
            # prematurely commit and break rollback on subsequent failure).
            new_sent_back_doc.flags.from_cancel = True
            # Insert the fully populated document
            new_sent_back_doc.insert(ignore_permissions=True)
            sent_back_doc_name = new_sent_back_doc.name

        # 4. Clean up linked PO Revisions, PO Adjustments, and their Project Payments
        #    so that frappe.delete_doc() in on_update doesn't fail the link check.
        cleanup_po_linked_docs(po_id)

        # 5. Finalize Actions
        po_doc.status = "Cancelled"
        po_doc.save(ignore_permissions=True)

        if is_merged_master and source_pos:
            for source in source_pos:
                frappe.db.set_value("Procurement Orders", source["name"], "status", "Cancelled")
                frappe.db.set_value("Procurement Orders", source["name"], "merged", None)

        if comment:
            ref_doctype = "Sent Back Category" if sent_back_doc_name else "Procurement Order"
            ref_name = sent_back_doc_name if sent_back_doc_name else po_doc.name
            frappe.new_doc("Nirmaan Comments").update({
                "comment_type": "Comment", "reference_doctype": ref_doctype,
                "reference_name": ref_name, "content": comment,
                "subject": "PO Cancelled", "comment_by": frappe.session.user
            }).insert(ignore_permissions=True)
        
        # Vendor credit recalculation after PO cancellation
        if po_doc.vendor:
            recalculate_vendor_credit(po_doc.vendor, "PO Cancelled", po_id=po_doc.name, project=po_doc.project)

        frappe.db.commit()

        message = f"PO {po_id} cancelled successfully."
        if sent_back_doc_name:
            message += f" New Sent Back document {sent_back_doc_name} created for {len(regular_items_to_send_back)} item(s)."
        elif items_from_po:
            message += " Additional charge items were noted and ignored as per process."
        if is_merged_master and source_pos:
            message += f" {len(source_pos)} source PO(s) were also cancelled."

        return {"message": message, "status": 200}

    except Exception as e:
        frappe.db.rollback()
        # Log the full error for backend debugging
        frappe.log_error(message=frappe.get_traceback(), title="handle_cancel_po Failed")
        # Return a clean error message to the user
        return {"error": f"PO Cancellation Failed: {str(e)}", "status": 400}