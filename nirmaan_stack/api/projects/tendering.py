from datetime import datetime

import frappe

from nirmaan_stack.api.projects._project_population import apply_full_project_details


@frappe.whitelist(methods=["POST"])
def create_tendering_project(project_name, project_state, project_city, customer=None):
    """
    Creates a lightweight "Tendering" project stub.

    A Tendering project is a bid/prospect record that captures only the
    essentials — Project Name, City, State, and (optionally) the linked
    Customer. It deliberately has NO Address document and NO child tables
    (no work packages, no work headers, no zones, no team). It exists only
    to track a prospect before the bid is won.

    The Projects autoname builds `{project_city}-PROJ-#####`, so
    `project_city` must be set before the document is inserted.

    The Projects `after_insert` hook (`generate_pwm`) is guarded to no-op for
    `status == "Tendering"`, so no Project Work Milestones are generated.

    Args:
        project_name (str): The prospect's name.
        project_state (str): State, chosen from the Pincodes master.
        project_city (str): City within that State, from the Pincodes master.
        customer (str, optional): Linked Customer docname. Defaults to None.

    Returns:
        dict: {"status": int, "message": str, "project_name": str} on success,
              or {"status": 400, "error": str} on failure.
    """
    try:
        frappe.db.begin()

        # --- Validate required fields ---
        if not project_name:
            raise frappe.ValidationError("Project Name is required.")
        if not project_state:
            raise frappe.ValidationError("Project State is required.")
        if not project_city:
            raise frappe.ValidationError("Project City is required.")

        # --- Create the minimal Projects stub ---
        # No Address doc, no child tables. project_city is required before
        # insert because autoname uses it for the `{city}-PROJ-#####` name.
        project_doc = frappe.new_doc("Projects")
        project_doc.project_name = project_name
        project_doc.project_city = project_city
        project_doc.project_state = project_state
        if customer:
            project_doc.customer = customer
        project_doc.status = "Tendering"
        project_doc.save(ignore_permissions=True)

        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Tendering project '{project_doc.project_name}' created successfully!",
            "project_name": project_doc.name,
        }

    except frappe.ValidationError as ve:
        frappe.db.rollback()
        frappe.log(f"Validation Error in create_tendering_project: {str(ve)}")
        return {"status": 400, "error": str(ve)}
    except Exception as e:
        frappe.db.rollback()
        frappe.log(f"Exception in create_tendering_project: {frappe.get_traceback()}")
        return {"status": 400, "error": f"Failed to create tendering project: {str(e)}"}


@frappe.whitelist(methods=["POST"])
def update_tendering_project(project_name, project_title=None, project_state=None, project_city=None, customer=None):
    """
    Minimally edits a "Tendering" project stub.

    Updates ONLY the four stub fields — Project Name (title), State, City and
    Customer — on a Projects doc whose `status` is currently `"Tendering"`.
    The full edit-project form is deliberately NOT reachable for a stub; this
    endpoint is the only edit path.

    The Projects autoname / docname (`{city}-PROJ-#####`) is frozen at creation
    and is NOT changed here even when the City is edited — only the
    `project_city` field is updated. This is consistent with the existing
    "changing the pincode won't change the project id" behaviour.

    Rejects the call if the project does not exist or is not currently
    `"Tendering"` (a real/awarded project must be edited through its own flow).

    Args:
        project_name (str): The Projects docname (the frozen `{city}-PROJ-#####`).
        project_title (str, optional): New value for the `project_name` field
            (the human-readable title). Only applied when provided.
        project_state (str, optional): New State. Only applied when provided.
        project_city (str, optional): New City. Only applied when provided.
        customer (str, optional): New Customer docname; pass an empty string to
            clear the link. `None` leaves the customer untouched.

    Returns:
        dict: {"status": 200, "message": str, "project_name": str} on success,
              or {"status": 400, "error": str} on failure.
    """
    try:
        frappe.db.begin()

        if not project_name:
            raise frappe.ValidationError("Project (docname) is required.")

        if not frappe.db.exists("Projects", project_name):
            raise frappe.ValidationError(f"Project '{project_name}' does not exist.")

        project_doc = frappe.get_doc("Projects", project_name)

        # --- Enforce the "must be Tendering" invariant ---
        if project_doc.status != "Tendering":
            raise frappe.ValidationError(
                f"Project '{project_name}' is not a Tendering project (status is "
                f"'{project_doc.status}'); only Tendering stubs can be edited this way."
            )

        # --- Apply only the provided stub fields ---
        # The docname is frozen even if the City changes (autoname not re-run).
        if project_title is not None:
            if not project_title:
                raise frappe.ValidationError("Project Name cannot be empty.")
            project_doc.project_name = project_title
        if project_state is not None:
            if not project_state:
                raise frappe.ValidationError("Project State cannot be empty.")
            project_doc.project_state = project_state
        if project_city is not None:
            if not project_city:
                raise frappe.ValidationError("Project City cannot be empty.")
            project_doc.project_city = project_city
        if customer is not None:
            # Empty string clears the optional Customer link.
            project_doc.customer = customer or None

        # status stays "Tendering" — this endpoint never changes status.
        project_doc.save(ignore_permissions=True)

        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Tendering project '{project_doc.project_name}' updated successfully!",
            "project_name": project_doc.name,
        }

    except frappe.ValidationError as ve:
        frappe.db.rollback()
        frappe.log(f"Validation Error in update_tendering_project: {str(ve)}")
        return {"status": 400, "error": str(ve)}
    except Exception as e:
        frappe.db.rollback()
        frappe.log(f"Exception in update_tendering_project: {frappe.get_traceback()}")
        return {"status": 400, "error": f"Failed to update tendering project: {str(e)}"}


@frappe.whitelist(methods=["POST"])
def delete_tendering_project(project_name):
    """
    Deletes a "Tendering" project stub outright.

    A Tendering stub carries no downstream operational data (no Address, no
    work packages, no PRs/POs/payments), so it can be removed safely. This
    endpoint refuses to delete anything that is not currently `"Tendering"`,
    so a real/awarded project (Won/WIP/etc.) can never be deleted through it.

    Args:
        project_name (str): The Projects docname to delete.

    Returns:
        dict: {"status": 200, "message": str} on success,
              or {"status": 400, "error": str} on failure.
    """
    try:
        frappe.db.begin()

        if not project_name:
            raise frappe.ValidationError("Project (docname) is required.")

        if not frappe.db.exists("Projects", project_name):
            raise frappe.ValidationError(f"Project '{project_name}' does not exist.")

        status = frappe.db.get_value("Projects", project_name, "status")

        # --- Enforce the "must be Tendering" invariant ---
        if status != "Tendering":
            raise frappe.ValidationError(
                f"Project '{project_name}' is not a Tendering project (status is "
                f"'{status}'); only Tendering stubs can be deleted this way."
            )

        frappe.delete_doc("Projects", project_name, ignore_permissions=True)

        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Tendering project '{project_name}' deleted successfully!",
        }

    except frappe.ValidationError as ve:
        frappe.db.rollback()
        frappe.log(f"Validation Error in delete_tendering_project: {str(ve)}")
        return {"status": 400, "error": str(ve)}
    except Exception as e:
        frappe.db.rollback()
        frappe.log(f"Exception in delete_tendering_project: {frappe.get_traceback()}")
        return {"status": 400, "error": f"Failed to delete tendering project: {str(e)}"}


@frappe.whitelist(methods=["POST"])
def convert_tendering_to_won(project_id, values):
    """
    Converts an existing "Tendering" project stub into a full "Won" project,
    in place (its docname / identity is preserved).

    This is the one-way `Tendering -> Won` transition (ADR-0001 decisions #6 / #7,
    module B4). It completes the lightweight stub with the full project detail
    captured by the same 6-step wizard that drives normal project creation, and
    runs the EXACT same population behavior via the shared
    :func:`apply_full_project_details` helper (Address creation,
    `project_wp_category_makes`, `project_work_header_entries`, legacy field
    clear) — without duplicating that logic.

    Difference from `create_project_with_address`: instead of instantiating a new
    Projects doc, this loads the existing stub by ``project_id`` and never re-runs
    autoname, so the frozen ``{city}-PROJ-#####`` docname does NOT change even if
    ``values`` carries a different city (from a real pincode lookup). Only the
    ``project_city`` / ``project_state`` fields update — consistent with the
    existing "changing the pincode won't change the project id" behavior.

    The "must be Tendering" invariant is enforced server-side: the call is
    rejected (status 400) if the project does not exist or is not currently
    ``"Tendering"``. A real/awarded project (Won/WIP/etc.) can never be
    re-converted, protecting any operational data it may already carry.

    Args:
        project_id (str): The existing stub's docname (the frozen
            ``{city}-PROJ-#####``).
        values (dict): The full wizard payload — the same shape that
            ``create_project_with_address`` receives.

    Returns:
        dict: {"status": 200, "message": str, "project_name": str} on success
              (``project_name`` is the SAME, unchanged docname), or
              {"status": 400, "error": str} on failure.
    """
    try:
        frappe.db.begin()

        # --- Resolve / validate the target stub ---
        if not project_id:
            raise frappe.ValidationError("Project (docname) is required.")

        if not frappe.db.exists("Projects", project_id):
            raise frappe.ValidationError(f"Project '{project_id}' does not exist.")

        project_doc = frappe.get_doc("Projects", project_id)

        # --- Enforce the one-way "must be Tendering" invariant ---
        if project_doc.status != "Tendering":
            raise frappe.ValidationError(
                f"Project '{project_id}' is not a Tendering project (status is "
                f"'{project_doc.status}'); only Tendering stubs can be converted to Won."
            )

        # frappe.whitelist may deliver `values` as a JSON string from the client.
        if isinstance(values, str):
            values = frappe.parse_json(values)

        # --- Validate required fields (mirror create_project_with_address) ---
        if not values.get("project_name"):
            raise frappe.ValidationError("Project Name is required.")
        if values.get("project_city") == "Not Found" or values.get("project_state") == "Not Found":
            raise frappe.ValidationError('City and State are "Not Found", Please Enter a Valid Pincode!')
        if not values.get("project_end_date"):
            raise frappe.ValidationError('Project End Date must not be empty!')

        frontend_wps_data = values.get("project_work_packages", {}).get("work_packages", [])
        if not frontend_wps_data:
            raise frappe.ValidationError('Please select at least one work package for this project.')

        # Work Headers required if milestone tracking is enabled.
        enable_milestone_tracking = values.get("enable_project_milestone_tracking", False)
        frontend_work_header_entries = values.get("project_work_header_entries", [])
        if enable_milestone_tracking:
            if not frontend_work_header_entries or not any(entry.get("enabled", False) for entry in frontend_work_header_entries):
                raise frappe.ValidationError('Project Milestone Tracking is enabled, but no Work Headers were selected or enabled.')

        # Validate date format (population helper re-parses these).
        try:
            start_date_str = values.get("project_start_date")
            end_date_str = values.get("project_end_date")
            datetime.strptime(start_date_str, "%Y-%m-%dT%H:%M:%S.%fZ")
            datetime.strptime(end_date_str, "%Y-%m-%dT%H:%M:%S.%fZ")
        except (ValueError, TypeError) as e:
            frappe.log(f"Date parsing error: {e}. Start: {start_date_str}, End: {end_date_str}")
            raise frappe.ValidationError("Invalid date format for project start/end dates.")

        # --- Populate the existing doc in place (shared logic; no autoname re-run) ---
        apply_full_project_details(project_doc, values)

        # Promote the stub to a real, awarded project.
        project_doc.status = "Won"

        project_doc.save(ignore_permissions=True)
        frappe.db.commit()

        # project_doc.name is unchanged — the docname stays frozen.
        return {
            "status": 200,
            "message": f"Project '{project_doc.project_name}' converted to Won successfully!",
            "project_name": project_doc.name,
        }

    except frappe.ValidationError as ve:
        frappe.db.rollback()
        frappe.log(f"Validation Error in convert_tendering_to_won: {str(ve)}")
        return {"status": 400, "error": str(ve)}
    except Exception as e:
        frappe.db.rollback()
        frappe.log(f"Exception in convert_tendering_to_won: {frappe.get_traceback()}")
        return {"status": 400, "error": f"Failed to convert tendering project: {str(e)}"}
