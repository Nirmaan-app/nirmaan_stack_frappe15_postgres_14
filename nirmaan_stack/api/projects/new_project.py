import frappe
from frappe.model.document import Document
from datetime import datetime

@frappe.whitelist(methods=["POST"])
def create_project_with_address(values: dict):
    """
    Creates a new project and its associated address.

    Args:
        values (dict): Form values containing project and address details.

    Returns:
        dict: Response containing status and message, and optionally the project name.
    """
    try:
        frappe.db.begin()

        # Validate required fields
        if not values.get("project_name"):
            raise frappe.ValidationError("Project Name is required.")
        if values.get("project_city") == "Not Found" or values.get("project_state") == "Not Found":
            raise frappe.ValidationError('City and State are "Not Found", Please Enter a Valid Pincode!')
        if not values.get("project_end_date"):
            raise frappe.ValidationError('Project End Date must not be empty!')
        if not values.get("project_work_packages", {}).get("work_packages"):
            raise frappe.ValidationError('Please select at least one work package associated with this project!')

        # Format the dates
        try:
            formatted_start_date = datetime.strptime(values.get("project_start_date"), "%Y-%m-%dT%H:%M:%S.%fZ").strftime("%Y-%m-%d %H:%M:%S")
            formatted_end_date = datetime.strptime(values.get("project_end_date"), "%Y-%m-%dT%H:%M:%S.%fZ").strftime("%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError):
            raise frappe.ValidationError("Invalid date format.")

        # Reformat work packages
        reformatted_work_packages = []
        for wp in values.get("project_work_packages", {}).get("work_packages", []):
            updated_categories_list = [{"name": cat["name"], "makes": [make["label"] for make in cat["makes"]]} for cat in wp.get("category_list", {}).get("list", [])]
            reformatted_work_packages.append({**wp, "category_list": {"list": updated_categories_list}})

        # Create the address document
        address_doc = frappe.new_doc("Address")
        address_doc.address_title = values.get("project_name")
        address_doc.address_type = "Shipping"
        address_doc.address_line1 = values.get("address_line_1")
        address_doc.address_line2 = values.get("address_line_2")
        address_doc.city = values.get("project_city")
        address_doc.state = values.get("project_state")
        address_doc.country = "India"
        address_doc.pincode = values.get("pin")
        address_doc.email_id = values.get("email")
        address_doc.phone = values.get("phone")
        address_doc.save(ignore_permissions=True)

        # Create the project document
        project_doc = frappe.new_doc("Projects")
        project_doc.project_name = values.get("project_name")
        project_doc.customer = values.get("customer")
        project_doc.project_type = values.get("project_type")
        project_doc.project_value = frappe.utils.parse_val(values.get("project_value")) if values.get("project_value") else 0.0
        project_doc.project_gst_number = values.get("project_gst_number")
        project_doc.project_start_date = formatted_start_date
        project_doc.project_end_date = formatted_end_date
        project_doc.project_address = address_doc.name
        project_doc.project_city = values.get("project_city")
        project_doc.project_state = values.get("project_state")
        project_doc.project_lead = values.get("project_lead")
        project_doc.procurement_lead = values.get("procurement_lead")
        project_doc.estimates_exec = values.get("estimates_exec")
        project_doc.design_lead = values.get("design_lead")
        project_doc.accountant = values.get("accountant")
        project_doc.project_manager = values.get("project_manager")
        project_doc.project_work_packages = {"work_packages": reformatted_work_packages}
        project_doc.project_scopes = values.get("project_scopes")
        project_doc.subdivisions = values.get("subdivisions")
        project_doc.subdivision_list = {"list":  values.get("areaNames", [])}
        project_doc.status = "Created"
        project_doc.save(ignore_permissions=True)

        frappe.db.commit()

        return {"status": 200, "message": f"Project '{project_doc.project_name}' created successfully!", "project_name": project_doc.name}

    except frappe.ValidationError as ve:
        print(f"error while creating project", str(ve))
        frappe.db.rollback()
        return {"status": 400, "error": str(ve)}
    except Exception as e:
        frappe.db.rollback()
        error_message = str(e)
        print(f"error while creating project", error_message)
        frappe.log_error(frappe.get_traceback(), "create_project_with_address")
        return {"status": 400, "error": f"Failed to create project: {error_message}"}