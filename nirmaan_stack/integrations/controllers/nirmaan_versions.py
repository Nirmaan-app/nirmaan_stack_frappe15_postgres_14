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

# def remove_amend_version(doc, method):
#     if doc.ref_doctype != "Procurement Orders":
#         return

#     data = json.loads(doc.data)

#     # Check if the status changed from "PO Amendment" to "PO Approved"
#     status_change = next((change for change in data['changed'] if change[0] == 'status'), None)
#     if status_change and status_change[1] == "PO Amendment" and status_change[2] == "PO Approved":
#         # Fetch the corresponding Nirmaan Version document
#         nvs = frappe.db.get_list(
#             "Nirmaan Versions",
#             filters={
#                 "ref_doctype": doc.ref_doctype,
#                 "docname": doc.docname,
#                 "previous_state": "PO Approved",
#                 "new_state": "PO Amendment",
#             },
#             order_by="creation desc",
#             limit_page_length=1,
#         )
#         if not nvs:
#             return

#         nirmaan_version_doc = frappe.get_doc("Nirmaan Versions", nvs[0].name)
#         nv_data = json.loads(nirmaan_version_doc.data)

#         # Extract the original order list
#         original_list = next(
#             (change[1]["list"] for change in nv_data['changed'] if change[0] == "order_list"), []
#         )

#         # Extract the changed order list from the incoming document
#         changed_list = next(
#             (change[2]["list"] for change in data['changed'] if change[0] == "order_list"), None
#         )

#         # If `changed_list` is not present, derive it from `nv_data`
#         if changed_list is None:
#             changed_list = next(
#                 (change[2]["list"] for change in nv_data['changed'] if change[0] == "order_list"), []
#             )

#         # Update the associated procurement request
#         procurement_order = frappe.get_doc("Procurement Orders", doc.docname)
#         procurement_request_id = procurement_order.procurement_request
#         procurement_request = frappe.get_doc("Procurement Requests", procurement_request_id)

#         # Update or delete items in the Procurement Request
#         original_items = {item['name']: item for item in original_list}
#         changed_items = {item['name']: item for item in changed_list}

#         for changed_item in changed_list:
#             original_item = original_items.get(changed_item['name'])
#             if original_item:
#                 # Item exists in both lists, check for changes
#                 if original_item['quantity'] != changed_item['quantity']:
#                     # Quantity or make changed, update in Procurement Request
#                     for pr_item in procurement_request.procurement_list["list"]:
#                         if pr_item['name'] == changed_item['name']:
#                             pr_item['quantity'] = changed_item['quantity']
#                             break
#             else:
#                 # Item added in the changed list.
#                 for pr_item in procurement_request.procurement_list["list"]:
#                     if pr_item['name'] == changed_item['name']:
#                         pr_item['quantity'] = changed_item['quantity']
#                         break

#         # Find items removed in the changed list and mark as deleted
#         removed_items = [
#             item for name, item in original_items.items()
#             if name not in changed_items
#         ]

#         if removed_items:
#             for item in procurement_request.procurement_list["list"]:
#                 if item['name'] in {removed_item['name'] for removed_item in removed_items}:
#                     item["status"] = "Deleted"

#         procurement_request.save(ignore_permissions=True)
#         frappe.delete_doc("Nirmaan Versions", nvs[0].name)
#     else:
#         # No action if the status hasn't changed to "PO Approved"
#         pass

import json
import frappe

def remove_amend_version(doc, method):
    if doc.ref_doctype != "Procurement Orders":
        return # This is a quiet exit, which is fine.

    print("\n--- [DEBUG] remove_amend_version: HOOK TRIGGERED for Version update ---")
    print(f"--- [DEBUG] Ref Doctype: {doc.ref_doctype}, Docname: {doc.docname}")

    data = json.loads(doc.data)
    status_change = next((change for change in data.get('changed', []) if change[0] == 'status'), None)
    
    # 1. CHECK IF THE STATUS CONDITION IS MET
    if not (status_change and status_change[1] == "PO Amendment" and status_change[2] == "PO Approved"):
        print(f"--- [DEBUG] Status condition NOT MET. Before: '{status_change[1] if status_change else 'N/A'}' After: '{status_change[2] if status_change else 'N/A'}'. Exiting function.")
        return
        
    print("--- [DEBUG] Status condition MET (Amendment -> Approved). Proceeding...")

    # 2. CHECK IF WE CAN FIND THE 'NIRMAAN VERSIONS' DOC
    nvs = frappe.db.get_list(
        "Nirmaan Versions",
        filters={"ref_doctype": doc.ref_doctype, "docname": doc.docname},
        order_by="creation desc",
        limit_page_length=1,
    )
    if not nvs:
        print(f"--- [DEBUG] ERROR: Could not find a Nirmaan Version for PO {doc.docname}. Exiting function.")
        return
    
    print(f"--- [DEBUG] Found Nirmaan Version doc: {nvs[0].name}")
    nirmaan_version_doc = frappe.get_doc("Nirmaan Versions", nvs[0].name)
    pre_amendment_data = json.loads(nirmaan_version_doc.data)

    print(f"--- [DEBUG] Nirmaan Version data: {frappe.as_json(pre_amendment_data)}")

    # 3. INSPECT THE 'BEFORE' AND 'AFTER' ITEM LISTS
    # original_items_list = next(
    #     (change[1] for change in pre_amendment_data.get('changed', []) if change[0] == "items"), []
    # )
    removed_item_dicts = [
    removed_row[1] for removed_row in pre_amendment_data.get('removed', []) if removed_row[0] == "items"
]
    explicitly_removed_pr_item_ids = {
    item.get('procurement_request_item') for item in removed_item_dicts
}
    procurement_order = frappe.get_doc("Procurement Orders", doc.docname)
    approved_items_list = [item.as_dict() for item in procurement_order.items]

    print(f"--- [DEBUG] Proof list of removed PR item IDs: {explicitly_removed_pr_item_ids}")
    print(f"--- [DEBUG] Removed items list (from Nirmaan Version): {frappe.as_json(removed_item_dicts)}")
    print(f"--- [DEBUG] Approved items list (from current PO): {frappe.as_json(approved_items_list)}")


    # 4. CHECK IF IT FINDS THE LINKED PROCUREMENT REQUEST
    if not procurement_order.procurement_request:
        print(f"--- [DEBUG] PO {doc.docname} is NOT linked to a PR. Deleting Nirmaan Version and exiting.")
        frappe.delete_doc("Nirmaan Versions", nvs[0].name, ignore_permissions=True)
        return
    
    print(f"--- [DEBUG] PO is linked to PR: {procurement_order.procurement_request}. Attempting to fetch PR.")
    try:
        procurement_request = frappe.get_doc("Procurement Requests", procurement_order.procurement_request)
        print(f"--- [DEBUG] Successfully fetched PR: {procurement_request.name}")
    except frappe.DoesNotExistError:
        print(f"--- [DEBUG] ERROR: Linked PR {procurement_order.procurement_request} does not exist. Exiting.")
        return

    # 5. SEE WHAT HAPPENS INSIDE THE FINAL LOOP
    # original_items_dict = {item.get('item_name'): item for item in original_items_list}
    approved_items_dict = {item.get('item_name'): item for item in approved_items_list}
    pr_was_modified = False

    print("--- [DEBUG] Starting loop through PR items to check for changes...")
    for pr_item in procurement_request.order_list:
        final_po_item = approved_items_dict.get(pr_item.item_name)
        print(f"final_po_item: {final_po_item}")

        if final_po_item:
            print(f"--- [DEBUG] PR item '{pr_item.item_id}' ({pr_item.item_name}) FOUND in final PO. Current PR status: '{pr_item.status}'")
            if pr_item.status:
                pr_item.status = "Approved"
                pr_was_modified = True
                print(f"--- [DEBUG] ---> Action: Changed PR item status to 'Active'.")
        else:
            print(f"--- [DEBUG] PR item '{pr_item.item_id}' ({pr_item.item_name}) NOT FOUND in final PO. Current PR status: '{pr_item.status}'")
            if pr_item.name in explicitly_removed_pr_item_ids:
                # This item's unique row ID was found in the set of removed items.
                if pr_item.status != "Deleted":
                    pr_item.status = "Deleted"
                    pr_was_modified = True
                    print(f"--- [ACTION] PR item '{pr_item.item_name}' was explicitly removed. Marking as 'Deleted'.")
            else:
                # The item is not in the final PO, but was not in the 'removed' list.
                # This can happen if the item was never sent to the PO in the first place.
                # No action is needed in this case.
                print(f"--- [INFO] PR item '{pr_item.item_name}' not in final PO, but wasn't in the removed list. No action taken.")

    if pr_was_modified:
        print(f"--- [DEBUG] PR was modified. Attempting to save PR {procurement_request.name}...")
        procurement_request.save(ignore_permissions=True)
        print("--- [DEBUG] PR saved successfully.")
    else:
        print("--- [DEBUG] No modifications needed for the PR.")
        
    print(f"--- [DEBUG] Deleting Nirmaan Version {nvs[0].name}...")
    frappe.delete_doc("Nirmaan Versions", nvs[0].name, ignore_permissions=True)
    print("--- [DEBUG] remove_amend_version: HOOK FINISHED successfully. ---\n")

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