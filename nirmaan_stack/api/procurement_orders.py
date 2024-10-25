import frappe
from frappe import _



@frappe.whitelist()
def generate_po_summary(project_id: str):
    """
    API to get PO summary rows item-wise for a project

    """

    #Check if user has permission
    # if not frappe.permissions(doctype="Projects", doc=project_id, ptype="read"):
    #     frappe.throw(_("You do not have permission to access this project"), frappe.PermissionError)

    arguments = {'project_id': project_id}

    po_items = frappe.db.sql("""
            SELECT
                po.name AS po_number,
                po.vendor AS vendor_id,
                po.vendor_name,
                po.creation,
                item->>'name' AS item_id,
                item->>'quote' AS quote,
                item->>'quantity' AS quantity,
                item->>'category' AS category,
                item->>'tax' AS tax,
                item->>'unit' AS unit,
                item->>'item' AS item_name    
            FROM
                "tabProcurement Orders" po,
                 jsonb_array_elements(po.order_list::jsonb->'list') AS item 
            WHERE 
                project=%(project_id)s
                AND status!='PO Approved';                     
        """, values=arguments, as_dict=1)

    return {
            "po_items": po_items
        }

        