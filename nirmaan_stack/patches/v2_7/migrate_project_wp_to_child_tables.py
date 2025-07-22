import frappe
import json

def execute():
    module_name = "Nirmaan Stack" 
    frappe.reload_doc(module_name, "doctype", "projects", force=True)
    frappe.reload_doc(module_name, "doctype", "project_work_package_category_make", force=True)

    projects_doctype = "Projects"
    old_json_field_name = "project_work_packages"
    new_child_table_field_name = "project_wp_category_makes" # Field in Projects linking to ProjectWPCategoryMake

    make_label_to_id_map = {m.make_name: m.name for m in frappe.get_all("Makelist", fields=["name", "make_name"])}

    projects_to_migrate = frappe.get_all(
        projects_doctype,
        fields=["name", old_json_field_name],
        order_by="creation asc"  # Order by creation date for consistent processing
    )

    if not projects_to_migrate:
        frappe.log("No Projects found needing migration for project_work_packages.")
        return

    migrated_count = 0
    failed_count = 0

    for project_data in projects_to_migrate:
        project_name = project_data.get("name")
        old_json_string = project_data.get(old_json_field_name)

        if not old_json_string:
            continue

        try:
            project_doc = frappe.get_doc(projects_doctype, project_name)
            project_doc.set(new_child_table_field_name, []) 

            data_dict = {}
            if isinstance(old_json_string, str):
                try:
                    data_dict = json.loads(old_json_string)
                except json.JSONDecodeError:
                    frappe.log(f"Project {project_name}: Invalid JSON in '{old_json_field_name}'. Skipping.")
                    failed_count += 1
                    continue
            elif isinstance(old_json_string, dict):
                data_dict = old_json_string
            else:
                frappe.log(f"Project {project_name}: Content of '{old_json_field_name}' is not a string or dict. Skipping.")
                failed_count += 1
                continue
            
            work_packages_json = data_dict.get("work_packages", [])
            if not isinstance(work_packages_json, list):
                frappe.log(f"Project {project_name}: 'work_packages' key in '{old_json_field_name}' is not a list. Skipping.")
                failed_count += 1
                continue

            for wp_item_json in work_packages_json:
                proc_package_name_from_json = wp_item_json.get("work_package_name") 
                
                if not proc_package_name_from_json:
                    frappe.log(f"Project {project_name}: Missing 'work_package_name'. Skipping WP entry.")
                    continue
                
                if not frappe.db.exists("Procurement Packages", proc_package_name_from_json):
                    frappe.log(f"Project {project_name}: Procurement Package '{proc_package_name_from_json}' not found. Skipping WP assignment.")
                    continue

                categories_list_json = wp_item_json.get("category_list", {}).get("list", [])
                if not isinstance(categories_list_json, list):
                    frappe.log(f"Project {project_name}, WP {proc_package_name_from_json}: 'category_list.list' invalid or missing. No categories to process for this WP.")
                    # If a WP is selected but has no categories listed in JSON, we might still want to record the WP.
                    # However, ProjectWPCategoryMake requires a category. So, if categories_list_json is empty,
                    # no rows will be added for this WP, which seems correct based on the child table design.
                    continue

                if not categories_list_json: # If the list of categories is empty for this WP
                    frappe.log(f"Project {project_name}, WP {proc_package_name_from_json}: No categories defined in 'category_list.list'.")
                    # If you want to still add a "WP only" row, the child table design would need to change.
                    # Current design: ProjectWPCategoryMake needs a category.
                    continue


                for cat_item_json in categories_list_json:
                    category_name = cat_item_json.get("name") 
                    if not category_name or not frappe.db.exists("Category", category_name):
                        frappe.log(f"Project {project_name}, WP {proc_package_name_from_json}: Category '{category_name}' invalid/not found. Skipping this category.")
                        continue

                    make_labels_or_objects = cat_item_json.get("makes", [])
                    
                    # Ensure make_labels_or_objects is a list, even if empty
                    if not isinstance(make_labels_or_objects, list):
                        frappe.log(f"Project {project_name}, WP {proc_package_name_from_json}, Cat {category_name}: 'makes' is not a list. Treating as no makes selected.")
                        make_labels_or_objects = [] # Default to empty list

                    if not make_labels_or_objects: # No makes specified for this category
                        project_doc.append(new_child_table_field_name, {
                            "procurement_package": proc_package_name_from_json, 
                            "category": category_name,
                            "make": None # Explicitly None as 'make' field is optional
                        })
                        frappe.log(f"Project {project_name}, WP {proc_package_name_from_json}, Cat {category_name}: No makes found. Added row with Make as None.")
                    else: # Makes are specified
                        for make_entry in make_labels_or_objects:
                            make_id_to_store = None
                            if isinstance(make_entry, str): 
                                make_label = make_entry
                                make_id_to_store = make_label_to_id_map.get(make_label)
                                if not make_id_to_store:
                                    frappe.log(f"Project {project_name}, WP {proc_package_name_from_json}, Cat {category_name}: Make Label '{make_label}' not mapped. Skipping this make.")
                                    continue
                            elif isinstance(make_entry, dict) and "value" in make_entry: 
                                make_id_to_store = make_entry.get("value")
                            else:
                                frappe.log(f"Project {project_name}, WP {proc_package_name_from_json}, Cat {category_name}: Invalid make format: {make_entry}. Skipping this make.")
                                continue

                            if not make_id_to_store or not frappe.db.exists("Makelist", make_id_to_store):
                                frappe.log(f"Project {project_name}, WP {proc_package_name_from_json}, Cat {category_name}: Make ID '{make_id_to_store}' invalid/not found. Skipping this make.")
                                continue
                            
                            project_doc.append(new_child_table_field_name, {
                                "procurement_package": proc_package_name_from_json, 
                                "category": category_name,
                                "make": make_id_to_store
                            })
            
            project_doc.save(ignore_permissions=True, ignore_version=True) 
            migrated_count += 1
            if migrated_count > 0 and migrated_count % 20 == 0:
                frappe.db.commit()
                frappe.log(f"Migrated {migrated_count} projects.")

        except Exception as e: 
            # Rollback only if an error occurs for THIS project, to allow other projects to proceed.
            # If you want the whole patch to stop, remove the try/except from inside the loop or re-raise.
            frappe.db.rollback() 
            frappe.log(f"Error migrating Project {project_name}. Type: {type(e).__name__}, Error: {e}",_raise=True)
            failed_count += 1
            
    frappe.db.commit() 
    frappe.log(f"Successfully migrated project_work_packages for {migrated_count} Projects.")
    if failed_count > 0:
        frappe.log(f"Failed to migrate project_work_packages for {failed_count} Projects. Check logs.")