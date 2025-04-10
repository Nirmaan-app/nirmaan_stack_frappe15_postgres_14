import frappe

import frappe

@frappe.whitelist()
def handle_merge_pos(po_id: str, merged_items: list, order_data: dict):
    """
    Merges multiple Procurement Orders into a new master Procurement Order.

    Args:
        po_id (str): The name of the current Procurement Order.
        merged_items (list): List of Procurement Order documents to be merged.
        order_data (dict): Data from the current Procurement Order's order list.
    """
    try:
        frappe.db.begin()
        po_doc = frappe.get_doc("Procurement Orders", po_id)
        if not po_doc:
            raise frappe.ValidationError(f"Procurement Order {po_id} not found.")

        # Sanitize order items
        def sanitize_order_items(items):
            return [{**item, "po": po_id} if not item.get("po") else item for item in items]

        updated_order_list = sanitize_order_items(order_data.get("list", []))

        # Fresh merged POs
        fresh_merged_pos = [po for po in merged_items if po.get("merged") != "true"] + [po_doc]
        # Previous merge handling
        previously_merged_pos = [po for po in merged_items if po.get("merged") == "true"]
        merge_hierarchy = {}
        for po in previously_merged_pos:
            merge_hierarchy.setdefault(po["name"], []).extend(
                [item["name"] for item in frappe.get_all("Procurement Orders", filters={"merged": po["name"]}, fields=["name"])]
            )

        # Create new Master PO
        new_po_doc = frappe.new_doc("Procurement Orders")
        new_po_doc.procurement_request = po_doc.procurement_request
        new_po_doc.project = po_doc.project
        new_po_doc.project_name = po_doc.project_name
        new_po_doc.project_address = po_doc.project_address
        new_po_doc.vendor = po_doc.vendor
        new_po_doc.vendor_name = po_doc.vendor_name
        new_po_doc.vendor_address = po_doc.vendor_address
        new_po_doc.vendor_gst = po_doc.vendor_gst
        new_po_doc.order_list = {"list": updated_order_list}
        new_po_doc.merged = "true"
        new_po_doc.insert()

        # Batch Operations
        for po in fresh_merged_pos:
            if isinstance(po, frappe.model.document.Document):
                frappe.db.set_value("Procurement Orders", po.name, "status", "Merged")
                frappe.db.set_value("Procurement Orders", po.name, "merged", new_po_doc.name)
            else:
                frappe.db.set_value("Procurement Orders", po["name"], "status", "Merged")
                frappe.db.set_value("Procurement Orders", po["name"], "merged", new_po_doc.name)

        for po_names in merge_hierarchy.values():
            for po_name in po_names:
                frappe.db.set_value("Procurement Orders", po_name, "status", "Merged")
                frappe.db.set_value("Procurement Orders", po_name, "merged", new_po_doc.name)

        for po_name in merge_hierarchy.keys():
            frappe.delete_doc("Procurement Orders", po_name)
        
        frappe.db.commit()

        return {
            "message": f"{len(fresh_merged_pos) + len(merge_hierarchy)} POs merged into {new_po_doc.name}",
            "new_po_name": new_po_doc.name,
            "status": 200,
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "handle_merge_pos")
        return {"error": f"Failed to merge POs: {str(e)}", "status": 400}

@frappe.whitelist()
def handle_unmerge_pos(po_id: str, prev_merged_pos: list):
    """
    Unmerges Procurement Orders.

    Args:
        po_id (str): The name of the master Procurement Order to unmerge.
        prev_merged_pos (list): List of previously merged Procurement Orders.
    """
    try:
        frappe.db.begin()
        po_doc = frappe.get_doc("Procurement Orders", po_id)
        if not po_doc:
            raise frappe.ValidationError(f"Procurement Order {po_id} not found.")

        for po in prev_merged_pos:
            frappe.db.set_value("Procurement Orders", po["name"], "status", "PO Approved")
            frappe.db.set_value("Procurement Orders", po["name"], "merged", None)
        
        frappe.db.delete("Nirmaan Attachments", {"associated_docname": ("=", po_id)})
        frappe.delete_doc("Procurement Orders", po_id)
        frappe.db.commit()

        return {"message": "Successfully unmerged PO(s)", "status": 200}

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "handle_unmerge_pos")
        return {"error": f"Error while unmerging PO(s): {str(e)}", "status": 400}