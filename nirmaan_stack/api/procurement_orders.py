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
            item->>'item' AS item_name,
            pr.work_package AS work_package
        FROM
        "tabProcurement Orders" po
        LEFT JOIN
            "tabProcurement Requests" pr
        ON
            po.procurement_request = pr.name,
        jsonb_array_elements(po.order_list::jsonb->'list') AS item
        WHERE
            po.project = %(project_id)s
            AND po.merged != 'true';
    """, values=arguments, as_dict=1)

    #removed AND po.status != 'PO Approved'; from WHERE statement
    #added AND po.merged != 'true'; in WHERE statement to reflect new merge po changes

    return {
            "po_items": po_items
        }

        