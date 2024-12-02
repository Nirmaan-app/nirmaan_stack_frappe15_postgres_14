import frappe
import json

def execute():
    """
    Fix the procurement orders to match the new merging flow.
    """
    # Step 1: Get all POs with status 'Merged' and aggregate them by the `merged` field
    merged_pos = frappe.get_all(
        "Procurement Orders",
        filters={"status": "Merged"},
        fields=["name", "merged", "order_list", "project", "vendor", "project_name", "project_address", "vendor_name", "vendor_address", "vendor_gst"]
    )
    
    # Aggregate the POs by the `merged` field
    aggregated_pos = {}
    for po in merged_pos:
        merged_name = po.merged
        if merged_name not in aggregated_pos:
            aggregated_pos[merged_name] = []
        aggregated_pos[merged_name].append(po)

    # Step 2: Iterate over the POs that have `merged=True` in the aggregation
    for master_po_name, po_list in aggregated_pos.items():
        # Fetch the master PO document
        master_po = frappe.get_doc("Procurement Orders", master_po_name)

        if master_po.merged != "true":
            continue

        # Filter `order_list.list` items of the master PO to only include those without the `po` field
        master_po_items = [item for item in master_po.order_list["list"] if "po" not in item]

        # Update the master PO in the database immediately after filtering
        master_po.order_list = {"list": master_po_items}
        master_po.save(ignore_permissions=True)
        frappe.db.commit()

        # Step 3: Combine items from all associated POs into a new PO
        combined_items = []
        for po in po_list:
            for item in po.order_list["list"]:
                # Add or modify the `po` field to include the name of the PO it came from
                item["po"] = po["name"]
                combined_items.append(item)

        # Add the filtered items from the master PO
        for item in master_po_items:
            item["po"] = master_po_name
            combined_items.append(item)

        # Create a new PO with the combined items
        new_po = frappe.new_doc("Procurement Orders")
        new_po.project = master_po.project
        new_po.vendor = master_po.vendor
        new_po.procurement_request = master_po.procurement_request
        new_po.project_name = master_po.project_name
        new_po.project_address = master_po.project_address
        new_po.vendor_name = master_po.vendor_name
        new_po.vendor_address = master_po.vendor_address
        new_po.vendor_gst = master_po.vendor_gst
        new_po.order_list = {"list": combined_items}
        new_po.status = master_po.status
        new_po.merged = "true"
        new_po.insert(ignore_permissions=True)
        frappe.db.commit()

        # Step 4: Update all POs that were merged to the new PO
        new_po_name = new_po.name
        master_po.merged = new_po_name
        master_po.status = "Merged"
        master_po.save(ignore_permissions=True)
        frappe.db.commit()
        for po in po_list:
            po_doc = frappe.get_doc("Procurement Orders", po["name"])
            po_doc.merged = new_po_name
            po_doc.status = "Merged"
            po_doc.save(ignore_permissions=True)
            frappe.db.commit()

    frappe.db.commit()

