import frappe
import json

def execute():
   """
   Rebuild Merged POs and change their state to merged.
   """ 
   pos = frappe.get_all("Procurement Orders")
   for po in pos:
         doc = frappe.get_doc("Procurement Orders", po.name)
         order_list = doc.order_list['list']
         merged_pos = {}
         merged_pos[doc.name] = []
         for item in order_list:
             try:
                 if item['po'] not in merged_pos.keys():
                     merged_pos[item['po']]=[]
                 merged_pos[item['po']].append(item)
             except KeyError as error:
                 merged_pos[doc.name].append(item)
         if len(merged_pos)==1:
             continue
         else:
             doc.merged='true'
             doc.save(ignore_permissions=True)
         prs = frappe.get_all("Procurement Requests", filters={'project':doc.project})
         for mpo in merged_pos.keys():
            for pr in prs:
                d2 = frappe.get_doc("Procurement Requests", pr.name)
                if is_pr_responsible_for_po(merged_pos[mpo], d2.procurement_list) and mpo!=doc.name:
                    new_doc = frappe.new_doc("Procurement Orders")
                    new_doc.name = mpo
                    new_doc.project = doc.project
                    new_doc.vendor = doc.vendor
                    new_doc.procurement_request = pr.name
                    new_doc.project_name = doc.project_name
                    new_doc.project_address = doc.project_address
                    new_doc.vendor_name = doc.vendor_name
                    new_doc.vendor_address = doc.vendor_address
                    new_doc.vendor_gst = doc.vendor_gst
                    new_doc.order_list = {'list': merged_pos[mpo]}
                    new_doc.status = "Merged"
                    new_doc.merged = doc.name
                    new_doc.insert(ignore_permissions=True)
                    break
                else:
                    continue


def is_pr_responsible_for_po(po, pr):
    """
    Check if a PR is responsible for a given PO.
    
    Args:
        po (list): List of items in a PO.
        pr (dict): Procurement list in a PR.

    Returns:
        bool: True if the PR is responsible for the PO, False otherwise.
    """
    po_items = po  # Items from the PO
    pr_items = pr.get("list", [])  # Items from the PR's procurement list

    # Check if all items in the PO exist in the PR with the same details and quantity
    for po_item in po_items:
        if not any(
            pr_item["name"] == po_item["name"]
            and pr_item["quantity"] == po_item["quantity"]
            and pr_item["unit"] == po_item["unit"]
            for pr_item in pr_items
        ):
            return False
    return True
