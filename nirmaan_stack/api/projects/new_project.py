# import frappe
# from frappe.model.document import Document
# from datetime import datetime

# @frappe.whitelist(methods=["POST"])
# def create_project_with_address(values: dict):
#     """
#     Creates a new project and its associated address.

#     Args:
#         values (dict): Form values containing project and address details.

#     Returns:
#         dict: Response containing status and message, and optionally the project name.
#     """
#     try:
#         frappe.db.begin()

#         # Validate required fields
#         if not values.get("project_name"):
#             raise frappe.ValidationError("Project Name is required.")
#         if values.get("project_city") == "Not Found" or values.get("project_state") == "Not Found":
#             raise frappe.ValidationError('City and State are "Not Found", Please Enter a Valid Pincode!')
#         if not values.get("project_end_date"):
#             raise frappe.ValidationError('Project End Date must not be empty!')
#         if not values.get("project_work_packages", {}).get("work_packages"):
#             raise frappe.ValidationError('Please select at least one work package associated with this project!')

#         # Format the dates
#         try:
#             formatted_start_date = datetime.strptime(values.get("project_start_date"), "%Y-%m-%dT%H:%M:%S.%fZ").strftime("%Y-%m-%d %H:%M:%S")
#             formatted_end_date = datetime.strptime(values.get("project_end_date"), "%Y-%m-%dT%H:%M:%S.%fZ").strftime("%Y-%m-%d %H:%M:%S")
#         except (ValueError, TypeError):
#             raise frappe.ValidationError("Invalid date format.")

#         # Reformat work packages
#         reformatted_work_packages = []
#         for wp in values.get("project_work_packages", {}).get("work_packages", []):
#             updated_categories_list = [{"name": cat["name"], "makes": [make["label"] for make in cat["makes"]]} for cat in wp.get("category_list", {}).get("list", [])]
#             reformatted_work_packages.append({**wp, "category_list": {"list": updated_categories_list}})

#         # Create the address document
#         address_doc = frappe.new_doc("Address")
#         address_doc.address_title = values.get("project_name")
#         address_doc.address_type = "Shipping"
#         address_doc.address_line1 = values.get("address_line_1")
#         address_doc.address_line2 = values.get("address_line_2")
#         address_doc.city = values.get("project_city")
#         address_doc.state = values.get("project_state")
#         address_doc.country = "India"
#         address_doc.pincode = values.get("pin")
#         address_doc.email_id = values.get("email")
#         address_doc.phone = values.get("phone")
#         address_doc.save(ignore_permissions=True)

#         # Create the project document
#         project_doc = frappe.new_doc("Projects")
#         project_doc.project_name = values.get("project_name")
#         project_doc.customer = values.get("customer")
#         project_doc.project_type = values.get("project_type")
#         project_doc.project_value = frappe.utils.parse_val(values.get("project_value")) if values.get("project_value") else 0.0
#         project_doc.project_gst_number = values.get("project_gst_number")
#         project_doc.project_start_date = formatted_start_date
#         project_doc.project_end_date = formatted_end_date
#         project_doc.project_address = address_doc.name
#         project_doc.project_city = values.get("project_city")
#         project_doc.project_state = values.get("project_state")
#         project_doc.project_lead = values.get("project_lead")
#         project_doc.procurement_lead = values.get("procurement_lead")
#         project_doc.estimates_exec = values.get("estimates_exec")
#         project_doc.design_lead = values.get("design_lead")
#         project_doc.accountant = values.get("accountant")
#         project_doc.project_manager = values.get("project_manager")
#         project_doc.project_work_packages = {"work_packages": reformatted_work_packages}
#         project_doc.project_scopes = values.get("project_scopes")
#         project_doc.subdivisions = values.get("subdivisions")
#         project_doc.subdivision_list = {"list":  values.get("areaNames", [])}
#         project_doc.status = "Created"
#         project_doc.save(ignore_permissions=True)

#         frappe.db.commit()

#         return {"status": 200, "message": f"Project '{project_doc.project_name}' created successfully!", "project_name": project_doc.name}

#     except frappe.ValidationError as ve:
#         print(f"error while creating project", str(ve))
#         frappe.db.rollback()
#         return {"status": 400, "error": str(ve)}
#     except Exception as e:
#         frappe.db.rollback()
#         error_message = str(e)
#         print(f"error while creating project", error_message)
#         frappe.log_error(frappe.get_traceback(), "create_project_with_address")
#         return {"status": 400, "error": f"Failed to create project: {error_message}"}


import frappe
# from frappe.model.document import Document # Not strictly needed for this version
from datetime import datetime

@frappe.whitelist(methods=["POST"])
def create_project_with_address(values: dict):
    """
    Creates a new project, its associated address, and populates the 
    project_wp_category_makes child table.
    """
    try:
        frappe.db.begin()

        # --- Step 1: Validate required fields (Keep your existing validations) ---
        if not values.get("project_name"):
            raise frappe.ValidationError("Project Name is required.")
        if values.get("project_city") == "Not Found" or values.get("project_state") == "Not Found":
            raise frappe.ValidationError('City and State are "Not Found", Please Enter a Valid Pincode!')
        if not values.get("project_end_date"): # Ensure this is a valid date string from frontend
            raise frappe.ValidationError('Project End Date must not be empty!')
        
        # Validate structure of project_work_packages from frontend
        frontend_wps_data = values.get("project_work_packages", {}).get("work_packages", [])
        if not frontend_wps_data: # Check if the list itself is empty or not provided
            raise frappe.ValidationError('Please select at least one work package for this project.')
        # --- NEW VALIDATION: For Work Headers if milestone tracking is enabled ---
        enable_milestone_tracking = values.get("enable_project_milestone_tracking", False)
        frontend_work_header_entries = values.get("project_work_header_entries", [])

        if enable_milestone_tracking:
            if not frontend_work_header_entries or not any(entry.get("enabled", False) for entry in frontend_work_header_entries):
                raise frappe.ValidationError('Project Milestone Tracking is enabled, but no Work Headers were selected or enabled.')
        # --- Step 2: Format Dates (Keep your existing date formatting) ---
        try:
            # Assuming frontend sends ISO string like "2024-06-03T10:00:00.000Z"
            start_date_str = values.get("project_start_date")
            end_date_str = values.get("project_end_date")

            # Frappe typically expects "YYYY-MM-DD" for Date fields or "YYYY-MM-DD HH:MM:SS" for Datetime
            # If your Frappe fields are Date, format to "YYYY-MM-DD"
            formatted_start_date = datetime.strptime(start_date_str, "%Y-%m-%dT%H:%M:%S.%fZ").strftime("%Y-%m-%d %H:%M:%S")
            formatted_end_date = datetime.strptime(end_date_str, "%Y-%m-%dT%H:%M:%S.%fZ").strftime("%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError) as e:
            frappe.log(f"Date parsing error: {e}. Start: {start_date_str}, End: {end_date_str}")
            raise frappe.ValidationError(f"Invalid date format for project start/end dates.")


        # --- Step 3: Create the Address Document (Keep as is) ---
        address_doc = frappe.new_doc("Address")
        address_doc.address_title = values.get("project_name")
        address_doc.address_type = "Shipping" # Or other relevant type
        address_doc.address_line1 = values.get("address_line_1")
        address_doc.address_line2 = values.get("address_line_2")
        address_doc.city = values.get("project_city")
        address_doc.state = values.get("project_state")
        address_doc.country = "India" # Or make dynamic if needed
        address_doc.pincode = values.get("pin")
        address_doc.email_id = values.get("email")
        address_doc.phone = values.get("phone")
        address_doc.save(ignore_permissions=True)

        # --- Step 4: Create the Project Document (Main Fields) ---
        project_doc = frappe.new_doc("Projects")
        project_doc.project_name = values.get("project_name")
        project_doc.customer = values.get("customer")
        project_doc.project_type = values.get("project_type")
        project_doc.project_value = frappe.utils.flt(values.get("project_value")) # Use flt for safe conversion
        project_doc.project_value_gst = frappe.utils.flt(values.get("project_value_gst")) 
        
        # Assuming project_gst_number is still a JSON field as per your Projects.json
        project_gst_number_data = values.get("project_gst_number")
        if isinstance(project_gst_number_data, dict) and "list" in project_gst_number_data:
            project_doc.project_gst_number = project_gst_number_data # Store the dict
        elif isinstance(project_gst_number_data, list): # If frontend sends just the list
             project_doc.project_gst_number = {"list": project_gst_number_data}
        else:
            project_doc.project_gst_number = None # Or an empty dict: {"list": []}
            
        project_doc.project_start_date = formatted_start_date
        project_doc.project_end_date = formatted_end_date
        project_doc.project_address = address_doc.name
        project_doc.project_city = values.get("project_city")
        project_doc.project_state = values.get("project_state")
        
        # Assignees
        project_doc.project_lead = values.get("project_lead")
        project_doc.procurement_lead = values.get("procurement_lead")
        project_doc.estimates_exec = values.get("estimates_exec")
        project_doc.design_lead = values.get("design_lead")
        project_doc.accountant = values.get("accountant")
        project_doc.project_manager = values.get("project_manager")
        
        # Other JSON fields (if they remain JSON)
        project_doc.project_scopes = values.get("project_scopes") 
        # --- NEW: Set the enable_project_milestone_tracking field ---
        project_doc.enable_project_milestone_tracking = enable_milestone_tracking
        # project_doc.subdivisions = values.get("subdivisions")
        # project_doc.subdivision_list = {"list":  values.get("areaNames", [])}
        
        project_doc.status = "Created"

        # --- Step 5: Populate the 'project_wp_category_makes' child table ---
        # This is the fieldname of the Table in Projects DocType
        child_table_fieldname_in_project = "project_wp_category_makes"
        
        for fe_wp_data in frontend_wps_data: # `frontend_wps_data` defined in Step 1
            wp_docname = fe_wp_data.get("work_package_name")
            
            if not wp_docname:
                frappe.log(f"Project {project_doc.project_name}: Skipping WP due to missing 'work_package_name'. Data: {fe_wp_data}")
                continue
            
            # Optional: Validate wp_docname exists in "Procurement Packages"
            if not frappe.db.exists("Procurement Packages", wp_docname):
                frappe.log(f"Project {project_doc.project_name}: Procurement Package '{wp_docname}' not found. Skipping makes for this WP.")
                continue

            fe_categories = fe_wp_data.get("category_list", {}).get("list", [])
            if not fe_categories: # If a WP is selected but no categories are listed for it
                # Create a row for each category that *should* be associated with this WP by default,
                # OR simply skip if the frontend doesn't send any categories for this WP.
                # For now, we'll only process categories explicitly sent by the frontend.
                # If you need to auto-populate all categories of a WP, that's different logic.
                frappe.log(f"Project {project_doc.project_name}, WP {wp_docname}: No categories listed in 'category_list.list'.")
                continue


            for fe_cat_data in fe_categories:
                category_docname = fe_cat_data.get("name")
                
                if not category_docname:
                    frappe.log(f"Project {project_doc.project_name}, WP {wp_docname}: Skipping category due to missing 'name'. Data: {fe_cat_data}")
                    continue

                # Optional: Validate category_docname exists in "Category"
                if not frappe.db.exists("Category", category_docname):
                    frappe.log(f"Project {project_doc.project_name}, WP {wp_docname}: Category '{category_docname}' not found. Skipping makes for this category.")
                    continue
                
                fe_makes = fe_cat_data.get("makes", []) # Array of {label, value}
                
                if not fe_makes: # No makes selected for this category by the user
                    project_doc.append(child_table_fieldname_in_project, {
                        "procurement_package": wp_docname,
                        "category": category_docname,
                        "make": None  # 'make' is optional
                    })
                else: # Makes were selected
                    for make_obj in fe_makes:
                        make_docname = make_obj.get("value") # Use the 'value' which is the Make DocName
                        if make_docname:
                            # Optional: Validate make_docname exists in "Makelist"
                            if not frappe.db.exists("Makelist", make_docname):
                                frappe.log(f"Project {project_doc.project_name}, WP {wp_docname}, Cat {category_docname}: Make '{make_docname}' not found. Skipping this make.")
                                continue
                                
                            project_doc.append(child_table_fieldname_in_project, {
                                "procurement_package": wp_docname,
                                "category": category_docname,
                                "make": make_docname
                            })
                        else:
                             frappe.log(f"Project {project_doc.project_name}, WP {wp_docname}, Cat {category_docname}: Skipping make due to missing 'value' in make object. Data: {make_obj}")

        child_table_fieldname_work_headers = "project_work_header_entries" # Fieldname of the Table field in Projects DocType

        if enable_milestone_tracking and frontend_work_header_entries:
            for entry in frontend_work_header_entries:
                work_header_name = entry.get("work_header_name")
                enabled_status = entry.get("enabled", False)

                if work_header_name: # Only append if checked by the user
                    # Optional: Validate work_header_name exists in "Work Headers" DocType
                    if not frappe.db.exists("Work Headers", work_header_name):
                        frappe.log(f"Project {project_doc.project_name}: Work Header '{work_header_name}' not found. Skipping this entry.")
                        continue
                    
                    project_doc.append(child_table_fieldname_work_headers, {
                        "project_work_header_name": work_header_name,
                        "enabled": enabled_status # This should be True if we're inside this 'if'
                    })
                

        # --- Step 6: Remove assignment to the old JSON field ---
        project_doc.project_work_packages = None # Or delete if not needed at all: delattr(project_doc, 'project_work_packages')
                                             # Setting to None is safer if the field still exists in DocType schema.
                                             # If you deleted `project_work_packages` field from Projects DocType, this line is not needed.

        # --- Step 7: Save and Commit ---
        project_doc.save(ignore_permissions=True)
        frappe.db.commit()

        return {"status": 200, "message": f"Project '{project_doc.project_name}' created successfully!", "project_name": project_doc.name}

    except frappe.ValidationError as ve:
        frappe.db.rollback()
        # Using frappe.log for consistency with your request, though frappe.log_error is generally better for errors.
        frappe.log(f"Validation Error in create_project_with_address: {str(ve)}")
        return {"status": 400, "error": str(ve)}
    except Exception as e:
        frappe.db.rollback()
        frappe.log(f"Exception in create_project_with_address: {frappe.get_traceback()}")
        return {"status": 400, "error": f"Failed to create project: {str(e)}"}