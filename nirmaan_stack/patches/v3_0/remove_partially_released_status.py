import frappe

def execute():
    # Fetch all tasks that need updating
    tasks = frappe.get_all("Critical PO Tasks", filters={"status": "Partially Released"}, pluck="name")
    
    count = len(tasks)
    
    for task_name in tasks:
        frappe.db.set_value(
            "Critical PO Tasks",
            task_name,
            "status",
            "Not Released",
            update_modified=False
        )

    print(f"Updated {count} Critical PO Tasks from 'Partially Released' to 'Not Released'")
