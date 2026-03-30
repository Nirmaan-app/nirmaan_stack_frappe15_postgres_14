import frappe
from nirmaan_stack.api.pmo_dashboard import initialize_project_tasks, cleanup_duplicate_tasks
from nirmaan_stack.api.pmo_sync import handle_category_rename, sync_task_master_update

def test_pmo_sync():
    frappe.connect()
    
    # 1. Setup mock data
    print("Setting up test masters...")
    cat_name = "Test Category"
    task_name = "Test Task"
    
    if not frappe.db.exists("PMO Task Category", cat_name):
        cat = frappe.get_doc({
            "doctype": "PMO Task Category",
            "category_name": cat_name
        }).insert()
    else:
        cat = frappe.get_doc("PMO Task Category", cat_name)
    
    if not frappe.db.exists("PMO Task Master", {"task_name": task_name, "category_link": cat.name}):
        task_master = frappe.get_doc({
            "doctype": "PMO Task Master",
            "task_name": task_name,
            "category_link": cat.name
        }).insert()
    else:
        task_master = frappe.get_all("PMO Task Master", filters={"task_name": task_name}, limit=1)[0]
    
    project = "Test Project"
    if not frappe.db.exists("Projects", project):
        frappe.get_doc({
            "doctype": "Projects",
            "project_name": project,
            "status": "Active"
        }).insert()
    
    # 2. Test initialization (Migration from string match)
    print("Testing initialization...")
    initialize_project_tasks(project)
    
    # Check if task_master link was backfilled
    p_task = frappe.get_all("PMO Project Task", filters={"project": project, "task_name": task_name}, fields=["*"])[0]
    if p_task.task_master == task_master.name:
        print("SUCCESS: task_master link backfilled correctly.")
    else:
        print(f"FAILED: task_master link not backfilled. Got: {p_task.task_master}")

    # 3. Test Task Master Renaming
    print(f"Testing Task Master rename (updating task_name)...")
    new_task_name = "Updated Task Name"
    tm_doc = frappe.get_doc("PMO Task Master", task_master.name)
    tm_doc.task_name = new_task_name
    tm_doc.save() # Triggers on_update hook
    
    p_task_updated = frappe.get_doc("PMO Project Task", p_task.name)
    if p_task_updated.task_name == new_task_name:
        print("SUCCESS: Project Task name updated automatically via hook.")
    else:
        print(f"FAILED: Project Task name not updated. Got: {p_task_updated.task_name}")

    # 4. Test Category Renaming
    print(f"Testing Category rename...")
    new_cat_name = "Renamed Category"
    # Note: rename_doc will trigger after_rename hook
    frappe.rename_doc("PMO Task Category", cat.name, new_cat_name)
    
    p_task_final = frappe.get_doc("PMO Project Task", p_task.name)
    if p_task_final.category == new_cat_name:
        print("SUCCESS: Project Task category updated automatically via hook.")
    else:
        print(f"FAILED: Project Task category not updated. Got: {p_task_final.category}")

if __name__ == "__main__":
    test_pmo_sync()
