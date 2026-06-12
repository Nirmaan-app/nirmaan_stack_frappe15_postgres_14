"""
Shared "full project" population logic for the Won workflow (ADR-0001 module B3).

Extracted from ``api/projects/new_project.create_project_with_address`` so that both
project *creation* and the later Tendering -> Won *conversion* can reuse the EXACT
same population behavior without duplicating code.

The single public entry point is :func:`apply_full_project_details`.
"""
import frappe
from datetime import datetime


def apply_full_project_details(project_doc, values: dict):
    """
    Populate a Projects doc with the full "Won" workflow detail.

    Mutates ``project_doc`` in place by:
      1. Creating and saving a linked ``Address`` doc (Shipping) and pointing
         ``project_doc.project_address`` at it.
      2. Setting the project's main fields from the wizard payload (name, customer,
         type, value/gst, carpet area, project_gst link, formatted start/end dates,
         city/state, project_scopes, enable_project_milestone_tracking).
      3. Appending rows to the ``project_wp_category_makes`` child table from the
         payload's ``project_work_packages.work_packages`` (handling both the
         "category with makes" and "category with no makes" branches).
      4. Appending rows to the ``project_work_header_entries`` child table when
         milestone tracking is enabled.
      5. Clearing the legacy ``project_work_packages`` JSON field (set to None).

    Contract / ownership boundaries (do NOT change without auditing callers):
      - This function does NOT set ``project_doc.status`` — the caller owns the
        status decision (creation sets "Won"; conversion sets "Won" from "Tendering").
      - This function does NOT call ``project_doc.save()`` — the caller owns the
        save + transaction boundary (``frappe.db.commit()`` / rollback). It DOES
        save the Address doc, because the project needs the saved Address's name.
      - Input validation (required fields, date format, milestone-tracking presence)
        is the caller's responsibility and is assumed to have already run.

    Args:
        project_doc: An unsaved or existing ``Projects`` Document to populate.
        values (dict): The validated wizard payload.

    Returns:
        The created (and saved) ``Address`` Document.
    """
    # --- Format Dates (same parsing as the original creation API) ---
    # Assuming frontend sends ISO string like "2024-06-03T10:00:00.000Z"
    start_date_str = values.get("project_start_date")
    end_date_str = values.get("project_end_date")
    formatted_start_date = datetime.strptime(start_date_str, "%Y-%m-%dT%H:%M:%S.%fZ").strftime("%Y-%m-%d %H:%M:%S")
    formatted_end_date = datetime.strptime(end_date_str, "%Y-%m-%dT%H:%M:%S.%fZ").strftime("%Y-%m-%d %H:%M:%S")

    enable_milestone_tracking = values.get("enable_project_milestone_tracking", False)
    frontend_wps_data = values.get("project_work_packages", {}).get("work_packages", [])
    frontend_work_header_entries = values.get("project_work_header_entries", [])

    # --- Create the Address Document ---
    address_doc = frappe.new_doc("Address")
    address_doc.address_title = values.get("project_name")
    address_doc.address_type = "Shipping"  # Or other relevant type
    address_doc.address_line1 = values.get("address_line_1")
    address_doc.address_line2 = values.get("address_line_2")
    address_doc.city = values.get("project_city")
    address_doc.state = values.get("project_state")
    address_doc.country = "India"  # Or make dynamic if needed
    address_doc.pincode = values.get("pin")
    address_doc.email_id = values.get("email")
    address_doc.phone = values.get("phone")
    address_doc.save(ignore_permissions=True)

    # --- Set the Project Document Main Fields ---
    project_doc.project_name = values.get("project_name")
    project_doc.customer = values.get("customer")
    project_doc.project_type = values.get("project_type")
    project_doc.project_value = frappe.utils.flt(values.get("project_value"))  # Use flt for safe conversion
    project_doc.project_value_gst = frappe.utils.flt(values.get("project_value_gst"))
    project_doc.carpet_area = frappe.utils.flt(values.get("carpet_area"))
    project_doc.cashflow_gap_limit = frappe.utils.flt(values.get("cashflow_gap_limit"))

    # Set the project_gst Link field
    project_doc.project_gst = values.get("project_gst")

    project_doc.project_start_date = formatted_start_date
    project_doc.project_end_date = formatted_end_date
    project_doc.project_address = address_doc.name
    project_doc.project_city = values.get("project_city")
    project_doc.project_state = values.get("project_state")

    # Note: Assignee fields (project_lead, procurement_lead, etc.) are no longer set here.
    # Frontend handles multi-select assignees via User Permissions after project creation.

    project_doc.project_scopes = values.get("project_scopes")
    project_doc.enable_project_milestone_tracking = enable_milestone_tracking

    # --- Populate the 'project_wp_category_makes' child table ---
    child_table_fieldname_in_project = "project_wp_category_makes"

    for fe_wp_data in frontend_wps_data:
        wp_docname = fe_wp_data.get("work_package_name")

        if not wp_docname:
            frappe.log(f"Project {project_doc.project_name}: Skipping WP due to missing 'work_package_name'. Data: {fe_wp_data}")
            continue

        # Optional: Validate wp_docname exists in "Procurement Packages"
        if not frappe.db.exists("Procurement Packages", wp_docname):
            frappe.log(f"Project {project_doc.project_name}: Procurement Package '{wp_docname}' not found. Skipping makes for this WP.")
            continue

        fe_categories = fe_wp_data.get("category_list", {}).get("list", [])
        if not fe_categories:  # If a WP is selected but no categories are listed for it
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

            fe_makes = fe_cat_data.get("makes", [])  # Array of {label, value}

            if not fe_makes:  # No makes selected for this category by the user
                project_doc.append(child_table_fieldname_in_project, {
                    "procurement_package": wp_docname,
                    "category": category_docname,
                    "make": None  # 'make' is optional
                })
            else:  # Makes were selected
                for make_obj in fe_makes:
                    make_docname = make_obj.get("value")  # Use the 'value' which is the Make DocName
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

    # --- Populate the 'project_work_header_entries' child table ---
    child_table_fieldname_work_headers = "project_work_header_entries"

    if enable_milestone_tracking and frontend_work_header_entries:
        for entry in frontend_work_header_entries:
            work_header_name = entry.get("work_header_name")
            enabled_status = entry.get("enabled", False)

            if work_header_name:  # Only append if checked by the user
                # Optional: Validate work_header_name exists in "Work Headers" DocType
                if not frappe.db.exists("Work Headers", work_header_name):
                    frappe.log(f"Project {project_doc.project_name}: Work Header '{work_header_name}' not found. Skipping this entry.")
                    continue

                project_doc.append(child_table_fieldname_work_headers, {
                    "project_work_header_name": work_header_name,
                    "enabled": enabled_status  # This should be True if we're inside this 'if'
                })

    # --- Remove assignment to the old JSON field ---
    project_doc.project_work_packages = None  # Setting to None is safer if the field still exists in DocType schema.

    return address_doc
