import frappe
import json

def execute():
    """
    Set rfq_data field for PRs and SBs with handling of sent-back documents
    """
    prs = frappe.get_all("Procurement Requests",
                         filters={"workflow_state": ["not in", ["Pending", "Approved", "Rejected", "Delayed", "Draft"]]},
                         order_by="creation asc",
                         )

    for pr in prs:
        qrs = frappe.get_all("Quotation Requests",
                             filters={"procurement_task": pr.name},
                             fields=["name", "item", "vendor", "quantity", "quote", "makes"]
                             )

        pr_doc = frappe.get_doc("Procurement Requests", pr.name)

        rfq_json = {
            "selectedVendors": [],
            "details": {}
        }

        vendor_dict = {}
        for qr in qrs:
            # Selected Vendors
            if qr.vendor not in vendor_dict:
                vendor_info = frappe.get_doc("Vendors", qr.vendor)
                vendor_dict[qr.vendor] = {
                    "label": vendor_info.vendor_name,
                    "value": qr.vendor,
                    "city": vendor_info.vendor_city,
                    "state": vendor_info.vendor_state
                }

            # Parse makes JSON format
            makes_data = qr.makes if isinstance(qr.makes, dict) else json.loads(qr.makes or "{}")
            enabled_make = None
            all_makes = []

            for make_entry in makes_data.get("list", []):
                all_makes.append(make_entry["make"])
                if make_entry["enabled"].lower() == "true":
                    enabled_make = make_entry["make"]

            # Build details JSON
            if qr.item not in rfq_json["details"]:
                rfq_json["details"][qr.item] = {
                    "vendorQuotes": {},
                    "makes": all_makes
                }
            else:
                existing_makes = rfq_json["details"][qr.item]["makes"]
                rfq_json["details"][qr.item]["makes"] = list(set(existing_makes + all_makes))

            item_detail = rfq_json["details"][qr.item]

            vendor_quote = {"quote": qr.quote}
            if enabled_make:
                vendor_quote["make"] = enabled_make

            item_detail["vendorQuotes"][qr.vendor] = vendor_quote

        rfq_json["selectedVendors"] = list(vendor_dict.values())

        # Update original Procurement Request
        pr_doc.rfq_data = json.dumps(rfq_json)
        pr_doc.save(ignore_permissions=True)

        # Handle Sent Back Categories
        sent_backs = frappe.get_all("Sent Back Category", 
                                    filters={"procurement_request": pr.name},
                                    order_by="creation asc",
                                    )
        for sb in sent_backs:
            sb_doc = frappe.get_doc("Sent Back Category", sb.name)
            sb_item_list = sb_doc.item_list if isinstance(sb_doc.item_list, dict) else json.loads(sb_doc.item_list)

            sent_back_rfq_data = {
                "selectedVendors": rfq_json["selectedVendors"],
                "details": {}
            }

            for sb_item in sb_item_list.get("list", []):
                item_code = sb_item["name"]
                if item_code in rfq_json["details"]:
                    sent_back_rfq_data["details"][item_code] = rfq_json["details"][item_code]

            sb_doc.rfq_data = json.dumps(sent_back_rfq_data)
            sb_doc.save(ignore_permissions=True)
