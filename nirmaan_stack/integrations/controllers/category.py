import frappe


def handle_category_rename(doc, method, old_name, new_name, merge=False):
    """
    Propagate Category rename into JSON fields that embed category names as strings.

    Frappe's rename_doc auto-updates Link fields (e.g., Vendor Category.category)
    but NOT JSON/Data fields.  This hook closes that gap.

    Pattern follows patches/v3_0/rename_wld_rr_to_critical_room_elv.py.
    """
    json_updates = [
        ("tabVendors", "vendor_category"),
        ("tabProcurement Orders", "order_list"),
        ("tabProcurement Requests", "procurement_list"),
        ("tabProcurement Requests", "category_list"),
        ("tabService Requests", "service_order_list"),
    ]

    for table, column in json_updates:
        frappe.db.sql(
            f"""
            UPDATE "{table}"
            SET "{column}" = REPLACE("{column}"::text, %s, %s)::json
            WHERE "{column}"::text LIKE %s
        """,
            (old_name, new_name, f"%{old_name}%"),
        )

    frappe.db.commit()
