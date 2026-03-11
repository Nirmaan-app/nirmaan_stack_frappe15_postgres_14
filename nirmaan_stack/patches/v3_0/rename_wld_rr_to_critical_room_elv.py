import frappe

OLD = "WLD & RR"
NEW = "Critical Room ELV"


def execute():
    # --- 1. Primary records (update name PK + work_package_name) ---
    frappe.db.sql(
        'UPDATE "tabWork Packages" SET name = %s, work_package_name = %s WHERE name = %s',
        (NEW, NEW, OLD),
    )
    frappe.db.sql(
        'UPDATE "tabProcurement Packages" SET name = %s, work_package_name = %s WHERE name = %s',
        (NEW, NEW, OLD),
    )

    # --- 2. Link fields ---
    link_updates = [
        ("tabCategory", "work_package"),
        ("tabScopes of Work", "work_package"),
        ("tabCritical PO Category", "work_package"),
        ("tabDesign Tracker Category", "work_package"),
        ("tabWork Headers", "work_package_link"),
        ("tabProject Work Package Category Make", "procurement_package"),
        ("tabApproved Quotations", "procurement_package"),
        ("tabProcurement Requests", "work_package"),
        ("tabProject Estimates", "work_package"),
        ("tabTDS Repository", "work_package"),
    ]
    for table, col in link_updates:
        frappe.db.sql(
            f'UPDATE "{table}" SET "{col}" = %s WHERE "{col}" = %s', (NEW, OLD)
        )

    # --- 3. Data fields (not touched by rename_doc) ---
    data_updates = [
        ("tabPurchase Order Item", "procurement_package"),
        ("tabDelivery Note Item", "procurement_package"),
        ("tabProcurement Request Item Detail", "procurement_package"),
        ("tabSelected Quotations", "procurement_package"),
        ("tabPO Revisions Items", "revision_procurement_package"),
        ("tabPO Revisions Items", "original_procurement_package"),
        ("tabProject TDS Item List", "tds_work_package"),
        ("tabProject Work Milestones", "work_package"),
        ("tabNirmaan Notifications", "work_package"),
    ]
    for table, col in data_updates:
        frappe.db.sql(
            f'UPDATE "{table}" SET "{col}" = %s WHERE "{col}" = %s', (NEW, OLD)
        )

    # --- 4. JSON fields (text REPLACE inside JSON blobs) ---
    json_updates = [
        ("tabProjects", "project_work_packages"),
        ("tabProcurement Requests", "procurement_list"),
        ("tabProcurement Requests", "category_list"),
        ("tabProcurement Orders", "order_list"),
        ("tabService Requests", "service_order_list"),
        ("tabNirmaan Versions", "data"),
    ]
    for table, col in json_updates:
        frappe.db.sql(
            f"""
            UPDATE "{table}" SET "{col}" = REPLACE("{col}"::text, %s, %s)::json
            WHERE "{col}"::text LIKE %s
        """,
            (OLD, NEW, f"%{OLD}%"),
        )

    frappe.db.commit()
    print(f"Renamed '{OLD}' -> '{NEW}' across all tables.")
