import frappe

def execute():
    """
    Backfills the 'project_gst' field in 'Project Invoices' using the 'project_gst' 
    value from the linked 'Projects' document.
    """
    print("\nStarting Project Invoices GST Migration...")
    
    # Fetch all Project Invoices that don't have project_gst set but have a linked project
    invoices = frappe.get_all(
        "Project Invoices", 
        filters={"project_gst": ("is", "not set")},
        fields=["name", "project"]
    )
    
    if not invoices:
        print("No Project Invoices without GST found. Skipping.")
        return

    # Pre-fetch Projects to get the project_gst mapping for O(1) lookup
    # We only care about projects linked to the invoices above to keep it efficient
    project_names = list(set(inv.project for inv in invoices if inv.project))
    if not project_names:
        print("No valid project links found in invoices. Skipping.")
        return

    projects = frappe.get_all(
        "Projects", 
        filters={"name": ("in", project_names)},
        fields=["name", "project_gst"]
    )
    
    project_gst_map = {p.name: p.project_gst for p in projects if p.project_gst}
    
    updated_count = 0
    skipped_count = 0
    
    for invoice in invoices:
        if invoice.project and invoice.project in project_gst_map:
            gst_value = project_gst_map[invoice.project]
            
            frappe.db.set_value(
                "Project Invoices", 
                invoice.name, 
                "project_gst", 
                gst_value, 
                update_modified=False
            )
            updated_count += 1
        else:
            skipped_count += 1
            
    # Always commit explicitly in patches after a successful loop
    frappe.db.commit()
    
    print(f"Migration Complete: {updated_count} updated, {skipped_count} skipped.")
