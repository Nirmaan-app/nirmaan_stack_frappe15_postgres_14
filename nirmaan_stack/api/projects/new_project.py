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

from nirmaan_stack.api.projects._project_population import apply_full_project_details

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
        # --- Step 2: Validate date format (population helper re-parses these) ---
        try:
            # Assuming frontend sends ISO string like "2024-06-03T10:00:00.000Z"
            start_date_str = values.get("project_start_date")
            end_date_str = values.get("project_end_date")

            # Frappe typically expects "YYYY-MM-DD" for Date fields or "YYYY-MM-DD HH:MM:SS" for Datetime
            datetime.strptime(start_date_str, "%Y-%m-%dT%H:%M:%S.%fZ")
            datetime.strptime(end_date_str, "%Y-%m-%dT%H:%M:%S.%fZ")
        except (ValueError, TypeError) as e:
            frappe.log(f"Date parsing error: {e}. Start: {start_date_str}, End: {end_date_str}")
            raise frappe.ValidationError(f"Invalid date format for project start/end dates.")

        # --- Steps 3-6: Create Address + populate the project doc (shared logic) ---
        project_doc = frappe.new_doc("Projects")
        apply_full_project_details(project_doc, values)

        # "Won" is the initial lifecycle status of a real project (replaces the retired "Created").
        project_doc.status = "Won"

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