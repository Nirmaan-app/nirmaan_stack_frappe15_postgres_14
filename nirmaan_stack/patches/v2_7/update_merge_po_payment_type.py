import frappe

def execute():
 
    try:
        # 1. Fetch
        po_list = frappe.get_all(
            "Procurement Orders", 
            filters={
                "payment_type": ["is", "not set"]
            },
            pluck="name"
        )

        total_fetched = len(po_list)
        print(f"\n[Patch] Found {total_fetched} POs to process.")
        
        count_updated = 0

        # 2. Iterate
        for po_name in po_list:
            doc = frappe.get_doc("Procurement Orders", po_name)

            if doc.payment_type:
                continue

            val_to_update = None

            if hasattr(doc, 'payment_terms') and doc.payment_terms:
                for row in doc.payment_terms:
                    if row.payment_type:
                        val_to_update = row.payment_type
                        break 
            
            if val_to_update:
                frappe.db.set_value(
                    "Procurement Orders", 
                    po_name, 
                    "payment_type", 
                    val_to_update, 
                    update_modified=False
                )
                count_updated += 1
                print(f" -> Updated {po_name}: {val_to_update}")

        print(f"Summary: Updated {count_updated} / {total_fetched}.\n")

        # ---------------------------------------------------------
        # THE FIX
        # ---------------------------------------------------------
        if count_updated == total_fetched:
            # Success: We can manually commit, or just let the function finish.
            # Frappe will commit automatically if we don't raise an exception.
            print("[Success] All records matched. Saving changes.")
            frappe.db.commit()

    except Exception as e:
        frappe.db.rollback()
        print(f"\n[Rolled Back] No changes were made.")
        print(f"Details: {str(e)}\n")
        raise e