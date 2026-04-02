import frappe
import json
from frappe.utils import flt,getdate, nowdate
from nirmaan_stack.api.vendor_credit import recalculate_vendor_credit

@frappe.whitelist()
def handle_merge_pos(po_id: str, merged_items: list, order_data: list, payment_terms: list):
    """
    Merges multiple Procurement Orders into a new master Procurement Order.
    This version calculates totals manually to build the document in one pass, avoiding ORM state errors.
    """
    try:
        frappe.db.begin()
        po_doc = frappe.get_doc("Procurement Orders", po_id)
        if not po_doc:
            raise frappe.ValidationError(f"Procurement Order {po_id} not found.")

        # Block merge if any PO has pending revisions or adjustments
        from nirmaan_stack.api.po_revisions.revision_po_check import get_all_locked_po_names
        locked_pos = get_all_locked_po_names()
        all_po_names = [po["name"] for po in (merged_items if isinstance(merged_items, list) else json.loads(merged_items))] + [po_id]
        locked_in_merge = [name for name in all_po_names if name in locked_pos]
        if locked_in_merge:
            frappe.throw(
                f"Cannot merge: PO(s) {', '.join(locked_in_merge)} have pending revisions or adjustments.",
                title="Merge Blocked"
            )

        # Block merge if items have incompatible variants (same item_id, different make/comment)
        from collections import defaultdict
        all_merge_items = []
        for po_name in all_po_names:
            po = frappe.get_doc("Procurement Orders", po_name)
            for item in po.get("items"):
                if item.category != "Additional Charges":
                    all_merge_items.append({
                        "item_id": item.item_id,
                        "make": item.make or "",
                        "comment": item.comment or "",
                        "po_name": po_name,
                    })

        item_groups = defaultdict(list)
        for item in all_merge_items:
            item_groups[item["item_id"]].append(item)

        for item_id, group in item_groups.items():
            po_names_in_group = set(i["po_name"] for i in group)
            if len(po_names_in_group) < 2:
                continue
            makes = set(i["make"] for i in group)
            if len(makes) > 1:
                frappe.throw(
                    f"Cannot merge: item '{item_id}' has different makes across POs ({', '.join(makes)})",
                    title="Merge Blocked"
                )
            comments = set(i["comment"] for i in group)
            if len(comments) > 1:
                frappe.throw(
                    f"Cannot merge: item '{item_id}' has different comments across POs",
                    title="Merge Blocked"
                )

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
        new_po_doc.insert()

        # --- STEP 5: Update the old POs ---
        pos_to_update = [po["name"] for po in merged_items] + [po_id]
        for po_name in pos_to_update:
            frappe.db.set_value("Procurement Orders", po_name, "status", "Merged")
            frappe.db.set_value("Procurement Orders", po_name, "merged", new_po_doc.name)
        
        # Vendor credit recalculation after PO merge
        if po_doc.vendor:
            recalculate_vendor_credit(po_doc.vendor, "PO Merged", po_id=new_po_doc.name, project=po_doc.project)

        frappe.db.commit()

        return {
            "message": f"POs merged into new master PO {new_po_doc.name}",
            "new_po_name": new_po_doc.name,
            "status": 200,
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(title="handle_merge_pos Error", message=frappe.get_traceback())
        return {"error": f"Failed to merge POs: {str(e)}", "status": 400}

@frappe.whitelist()
def handle_unmerge_pos(po_id: str):
    """Deprecated: Unmerge is no longer supported. Use PO Revisions or Cancel PO instead."""
    return {"error": "Unmerge is no longer supported. Use Cancel PO instead.", "status": 400}
        

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