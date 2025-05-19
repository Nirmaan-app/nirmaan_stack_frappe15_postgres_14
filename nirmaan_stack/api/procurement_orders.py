import frappe
from frappe import _
from frappe.utils.caching import redis_cache
from frappe.utils import flt


@frappe.whitelist()
@redis_cache(shared=True)
def generate_po_summary(project_id: str):
    """
    API to get PO summary rows item-wise for a project
    """
    # Fetch all Procurement Orders for the given project_id that are not merged
    po_records = frappe.get_all(
        "Procurement Orders",
        filters={
            "project": project_id,
            "status": ["!=", "Merged"]
        },
        fields=["name", "vendor", "vendor_name", "creation", "procurement_request", "order_list", "custom"]
    )

    po_items = []
    custom_items = []

    for po in po_records:
        # Parse the order_list JSON field to process individual items
        order_list = frappe.parse_json(po.get("order_list", "{}")).get("list", [])
        is_custom = po.get('custom') == "true"
        
        # Fetch the associated Procurement Request to get the work_package (only if not custom)
        work_package = None
        if po.get("procurement_request") and not is_custom:
            pr_doc = frappe.get_value("Procurement Requests", po["procurement_request"], "work_package")
            work_package = pr_doc
       
        # Process each item in the order_list
        for item in order_list:
            item_data = {
                "po_number": po["name"],
                "vendor_id": po["vendor"],
                "vendor_name": po["vendor_name"],
                "creation": po["creation"],
                "item_id": item.get("name"),
                "quote": flt(item.get("quote")),
                "quantity": flt(item.get("quantity")),
                "received": flt(item.get("received")),
                "category": item.get("category"),
                "tax": item.get("tax"),
                "unit": item.get("unit"),
                "item_name": item.get("item"),
                "work_package": work_package if not is_custom else item.get("procurement_package")
            }

            # Append to the correct list
            if is_custom:
                custom_items.append(item_data)
            else:
                po_items.append(item_data)

    return {
        "po_items": po_items,
        "custom_items": custom_items
    }


# @frappe.whitelist()
# def generate_po_summary(project_id: str):
#     """
#     API to get PO summary rows item-wise for a project

#     """

#     #Check if user has permission
#     # if not frappe.permissions(doctype="Projects", doc=project_id, ptype="read"):
#     #     frappe.throw(_("You do not have permission to access this project"), frappe.PermissionError)

#     arguments = {'project_id': project_id}

#     po_items = frappe.db.sql("""
#         SELECT
#             po.name AS po_number,
#             po.vendor AS vendor_id,
#             po.vendor_name,
#             po.creation,
#             item->>'name' AS item_id,
#             item->>'quote' AS quote,
#             item->>'quantity' AS quantity,
#             item->>'category' AS category,
#             item->>'tax' AS tax,
#             item->>'unit' AS unit,
#             item->>'item' AS item_name,
#             pr.work_package AS work_package
#         FROM
#         "tabProcurement Orders" po
#         LEFT JOIN
#             "tabProcurement Requests" pr
#         ON
#             po.procurement_request = pr.name,
#         jsonb_array_elements(po.order_list::jsonb->'list') AS item
#         WHERE
#             po.project = %(project_id)s
#             AND po.merged != 'true';
#     """, values=arguments, as_dict=1)

#     print(f"po_items : {po_items}")

#     #removed AND po.status != 'PO Approved'; from WHERE statement
#     #added AND po.merged != 'true'; in WHERE statement to reflect new merge po changes

#     return {
#             "po_items": po_items
#         }


# @frappe.whitelist()
# def generate_po_summary(project_id: str):
#     """
#     API to get PO summary rows item-wise for a project.

#     Retrieves all Procurement Orders where po.merged != 'true', and for each Procurement Order,
#     fetches individual items from po.order_list.list. Constructs a response containing item details
#     and associated work_package from the linked Procurement Requests.
#     """

#     # Check if user has permission
#     # if not frappe.permissions(doctype="Projects", doc=project_id, ptype="read"):
#     #     frappe.throw(_("You do not have permission to access this project"), frappe.PermissionError)

#     arguments = {'project_id': project_id}

#     # Query to fetch procurement order items
#     po_items_query = """
#         SELECT
#             po.name AS po_number,
#             po.vendor AS vendor_id,
#             po.vendor_name,
#             po.creation,
#             item.value->>'name' AS item_id,
#             item.value->>'quote' AS quote,
#             item.value->>'quantity' AS quantity,
#             item.value->>'category' AS category,
#             item.value->>'tax' AS tax,
#             item.value->>'unit' AS unit,
#             item.value->>'item' AS item_name,
#             pr.work_package AS work_package
#         FROM
#             "tabProcurement Orders" po
#         LEFT JOIN
#             "tabProcurement Requests" pr
#         ON
#             po.procurement_request = pr.name
#         CROSS JOIN LATERAL
#             jsonb_array_elements(po.order_list::jsonb->'list') AS item(value)
#         WHERE
#             po.project = %(project_id)s
#             AND po.merged != 'true';
#     """

#     # Execute the query
#     po_items = frappe.db.sql(po_items_query, values=arguments, as_dict=1)

#     print(f"Retrieved PO Items: {po_items}")

#     # Return the items in the required format
#     return {
#         "po_items": po_items
#     }