import frappe

def execute():
    """
    Migrates data from the old 'status' field to the new 'term_status' field
    in the 'PO Payment Terms' DocType using the Frappe ORM and reports the counts.
    """
    doctype_name = "PO Payment Terms"
    old_field = "status"
    new_field = "term_status"

    # 1. Safety Check: Ensure the old column exists before proceeding.
    if not frappe.db.has_column(doctype_name, old_field):
        print(f"✔ Skipping: Old column '{old_field}' not found in '{doctype_name}'. Migration likely already completed.")
        return

    try:
        # 2. Get Total Record Count
        total_records = frappe.db.count(doctype_name)
        if total_records == 0:
            print(f"✔ Skipping: No records found in '{doctype_name}'.")
            return

        # 3. Fetch all documents that need migration
        docs_to_migrate = frappe.get_all(
            doctype_name,
            filters={
                old_field: ['is', 'set'],
                new_field: ['is', 'not set']
            },
            fields=['name', old_field]
        )

        records_to_update = len(docs_to_migrate)

        if records_to_update == 0:
            print(f"✔ Skipping: No records in '{doctype_name}' needed migration.")
            return

        # 4. Perform the Data Migration using a loop and frappe.db.set_value
        print(f"Starting data migration for {records_to_update} records in '{doctype_name}'...")

        for doc in docs_to_migrate:
            value_to_migrate = doc.get(old_field)
            
            frappe.db.set_value(
                doctype_name, 
                doc.name, 
                new_field, 
                value_to_migrate,
                update_modified=False # Crucial: Do not change the 'modified' timestamp
            )

        # 5. Commit the transaction to save all changes to the database
        frappe.db.commit()

        # 6. Report the results
        print(
            f"✅ Successfully migrated data in '{doctype_name}':\n"
            f"- Records updated: {records_to_update}\n"
            f"- Total records: {total_records}"
        )

        # Optional: Log the event for auditing
        print(
            "DocType Migration",
            f"Migrated {doctype_name} data from {old_field} to {new_field}. Updated {records_to_update} records."
        )

    except Exception as e:
        frappe.log_error(f"Failed to migrate data for {doctype_name}. Error: {e}", "Migration Patch Error")
        raise e