import frappe

def handle_category_rename(doc, method, old_name, new_name, merge=False):
    """
    Hook on PMO Task Category 'after_rename'. 
    Updates the 'category' plain-text field in existing PMO Project Task records.
    """
    frappe.db.set_value("PMO Project Task", 
                        {"category": old_name}, 
                        "category", new_name)
    frappe.db.commit()

def sync_task_master_update(doc, method=None):
    """
    Hook on PMO Task Master 'on_update'.
    Ensures any changes to task_name or category link in the master template 
    propagate to all existing PMO Project Task records linked to it.
    """
    # Get the display name of the linked category
    category_name = frappe.db.get_value("PMO Task Category", doc.category_link, "category_name")
    
    # Update all linked project tasks with the new master names/category
    frappe.db.set_value("PMO Project Task", 
                        {"task_master": doc.name}, 
                        {
                            "task_name": doc.task_name,
                            "category": category_name
                        }, 
                        update_modified=True)
    frappe.db.commit()
