import json
import frappe

def generate_amend_version(doc, method):
    if doc.ref_doctype != "Procurement Orders":
        return
    data = json.loads(doc.data)
    print(f"amend version: {data}")

    # Check if the status changed from "PO Approved" to "PO Amendment"
    status_change = next((change for change in data['changed'] if change[0] == 'status'), None)
    if status_change and status_change[1] == "PO Approved" and status_change[2] == "PO Amendment":
        # Create a new Nirmaan Versions document
        nv = frappe.new_doc("Nirmaan Versions")
        nv.ref_doctype = doc.ref_doctype
        nv.docname = doc.docname
        nv.data = json.dumps(doc.data)
        nv.previous_state = status_change[1]
        nv.new_state = status_change[2]
        nv.insert(ignore_permissions=True)
    else:
        # No action if the status hasn't changed to "PO Amendment"
        pass

def remove_amend_version(doc, method):
    if doc.ref_doctype != "Procurement Orders":
        return
    data = json.loads(doc.data)

    # Check if the status changed from "PO Amendment" to "PO Approved"
    status_change = next((change for change in data['changed'] if change[0] == 'status'), None)
    if status_change and status_change[1] == "PO Amendment" and status_change[2] == "PO Approved":
        # Fetch the corresponding Nirmaan Version document
        nvs = frappe.db.get_list(
            "Nirmaan Versions",
            filters={
                "ref_doctype": doc.ref_doctype,
                "docname": doc.docname,
                "previous_state": "PO Approved",
                "new_state": "PO Amendment",
            },
            order_by="creation desc",
            limit_page_length=1,
        )
        if not nvs:
            return

        nirmaan_version_doc = frappe.get_doc("Nirmaan Versions", nvs[0].name)
        nv_data = json.loads(nirmaan_version_doc.data)

        # Extract the original order list
        original_list = next(
            (change[1]["list"] for change in nv_data['changed'] if change[0] == "order_list"), []
        )

        # Extract the changed order list from the incoming document
        changed_list = next(
            (change[2]["list"] for change in data['changed'] if change[0] == "order_list"), None
        )

        # If `changed_list` is not present, derive it from `nv_data`
        if changed_list is None:
            changed_list = next(
                (change[2]["list"] for change in nv_data['changed'] if change[0] == "order_list"), []
            )

        # Compare lengths
        if len(changed_list) >= len(original_list):
            frappe.delete_doc("Nirmaan Versions", nvs[0].name)
            return

        # Find items removed in the changed list
        original_items = {item['name']: item for item in original_list}
        changed_items = {item['name']: item for item in changed_list}
        removed_items = [
            item for name, item in original_items.items()
            if name not in changed_items
        ]

        if removed_items:
            # Update the associated procurement request
            procurement_order = frappe.get_doc("Procurement Orders", doc.docname)
            procurement_request_id = procurement_order.procurement_request
            procurement_request = frappe.get_doc("Procurement Requests", procurement_request_id)

            # Mark removed items as "Deleted"
            for item in procurement_request.procurement_list["list"]:
                if item['name'] in {removed_item['name'] for removed_item in removed_items}:
                    item["status"] = "Deleted"

            procurement_request.save(ignore_permissions=True)
            
        frappe.delete_doc("Nirmaan Versions", nvs[0].name)
    else:
        # No action if the status hasn't changed to "PO Approved"
        pass

def generate_sr_amend_version(doc, method):
    if doc.ref_doctype != "Service Requests":
        return
    data = json.loads(doc.data)
    print(f"amend version: {data}")

    # Check if the status changed from "PO Approved" to "PO Amendment"
    status_change = next((change for change in data['changed'] if change[0] == 'status'), None)
    if status_change and status_change[1] == "Approved" and status_change[2] == "Amendment":
        # Create a new Nirmaan Versions document
        nv = frappe.new_doc("Nirmaan Versions")
        nv.ref_doctype = doc.ref_doctype
        nv.docname = doc.docname
        nv.data = json.dumps(doc.data)
        nv.previous_state = status_change[1]
        nv.new_state = status_change[2]
        nv.insert(ignore_permissions=True)
    else:
        # No action if the status hasn't changed to "PO Amendment"
        pass