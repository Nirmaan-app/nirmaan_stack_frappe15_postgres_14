from datetime import datetime

import frappe

from nirmaan_stack.api.projects._project_population import apply_full_project_details


# --- Authorization ---------------------------------------------------------
# Tendering-side management is gated to the same set that may create projects:
# Nirmaan Admin + PMO Executive (the "Administrator" user is always allowed,
# matching the frontend `canManageTendering` helper). This is enforced at the
# top of every whitelisted endpoint in this module — UI gates are not enough,
# because the endpoints can be called directly.

# NOTE: these are ROLE names as returned by `frappe.get_roles()`, NOT Role
# Profile names. The naming is inconsistent in this app: the Admin role is
# literally named "Nirmaan Admin Profile" (carries the "Profile" suffix), but
# the PMO role is "Nirmaan PMO Executive" (no suffix; "Nirmaan PMO Executive
# Profile" is only a Role Profile bundle, which get_roles() never returns).
# Using "Nirmaan PMO Executive Profile" here silently locked PMO users out.
TENDERING_MANAGER_ROLES = {
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive",
    # Estimates may create + manage tendering projects. The underlying Role is
    # "Nirmaan Estimates Executive" (no "Profile"); the Profile variant is added
    # defensively against this app's inconsistent role/role-profile naming.
    "Nirmaan Estimates Executive",
    "Nirmaan Estimates Executive Profile",
}


def _ensure_tendering_manager():
    user = frappe.session.user
    if user == "Administrator":
        return
    roles = set(frappe.get_roles(user))
    if roles.isdisjoint(TENDERING_MANAGER_ROLES):
        frappe.throw(
            "You are not permitted to manage Tendering projects.",
            frappe.PermissionError,
        )


@frappe.whitelist(methods=["POST"])
def create_tendering_project(project_name, project_state, project_city, customer=None):
    """
    Creates a lightweight "Tendering" project stub (v3 dual-field model).

    A Tendering project is a bid/prospect record capturing only the essentials —
    Project Name, City, State, and (optionally) the linked Customer. It has NO
    Address document and NO child tables (no work packages, no work headers, no
    zones, no team). It exists only to track a prospect before the bid is won.

    v3 writes the bid outcome to the new `tendering_status` field
    (`"Tendering"`) and leaves the execution `status` empty — the stub has no
    execution stage yet. Convert (Tendering → Won) is the only path that
    populates `status = "Won"`.

    The Projects autoname builds `{project_city}-PROJ-#####`, so `project_city`
    must be set before the document is inserted.

    The Projects `after_insert` hook (`generate_pwm`) is guarded to no-op when
    `tendering_status != "Won"`, so no Project Work Milestones are generated.

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
        _ensure_tendering_manager()
        frappe.db.begin()

        if not project_name:
            raise frappe.ValidationError("Project Name is required.")
        if not project_state:
            raise frappe.ValidationError("Project State is required.")
        if not project_city:
            raise frappe.ValidationError("Project City is required.")

        # No Address doc, no child tables. project_city is required before
        # insert because autoname uses it for the `{city}-PROJ-#####` name.
        project_doc = frappe.new_doc("Projects")
        project_doc.project_name = project_name
        project_doc.project_city = project_city
        project_doc.project_state = project_state
        if customer:
            project_doc.customer = customer
        project_doc.tendering_status = "Tendering"
        # status stays empty — the stub has no execution stage yet.
        project_doc.status = ""
        project_doc.save(ignore_permissions=True)

        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Tendering project '{project_doc.project_name}' created successfully!",
            "project_name": project_doc.name,
        }

    except frappe.PermissionError as pe:
        frappe.db.rollback()
        return {"status": 403, "error": str(pe)}
    except frappe.ValidationError as ve:
        frappe.db.rollback()
        frappe.log_error(
            title="create_tendering_project validation",
            message=str(ve),
        )
        return {"status": 400, "error": str(ve)}
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            title="create_tendering_project exception",
            message=frappe.get_traceback(),
        )
        return {"status": 400, "error": f"Failed to create tendering project: {str(e)}"}


@frappe.whitelist(methods=["POST"])
def update_tendering_project(project_name, project_title=None, project_state=None, project_city=None, customer=None):
    """
    Minimally edits a "Tendering" project stub (v3 dual-field model).

    Updates ONLY the four stub fields — Project Name (title), State, City and
    Customer — on a Projects doc whose `tendering_status` is currently
    `"Tendering"`. Lost projects are read-only and rejected; Won projects must
    be edited through the full edit-project flow.

    The Projects autoname / docname (`{city}-PROJ-#####`) is frozen at creation
    and is NOT changed here even when the City is edited — only the
    `project_city` field is updated.

    Returns:
        dict: {"status": 200, "message": str, "project_name": str} on success,
              or {"status": 400, "error": str} on failure.
    """
    try:
        _ensure_tendering_manager()
        frappe.db.begin()

        if not project_name:
            raise frappe.ValidationError("Project (docname) is required.")

        if not frappe.db.exists("Projects", project_name):
            raise frappe.ValidationError(f"Project '{project_name}' does not exist.")

        project_doc = frappe.get_doc("Projects", project_name)

        if project_doc.tendering_status != "Tendering":
            raise frappe.ValidationError(
                f"Project '{project_name}' is not editable as a Tendering stub "
                f"(tendering_status is '{project_doc.tendering_status}'). Only "
                f"Tendering stubs can be edited this way."
            )

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
            project_doc.customer = customer or None

        project_doc.save(ignore_permissions=True)

        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Tendering project '{project_doc.project_name}' updated successfully!",
            "project_name": project_doc.name,
        }

    except frappe.PermissionError as pe:
        frappe.db.rollback()
        return {"status": 403, "error": str(pe)}
    except frappe.ValidationError as ve:
        frappe.db.rollback()
        frappe.log_error(
            title="update_tendering_project validation",
            message=str(ve),
        )
        return {"status": 400, "error": str(ve)}
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            title="update_tendering_project exception",
            message=frappe.get_traceback(),
        )
        return {"status": 400, "error": f"Failed to update tendering project: {str(e)}"}


@frappe.whitelist(methods=["POST"])
def delete_tendering_project(project_name):
    """
    Deletes a Tendering or Lost project stub outright (v3 dual-field model).

    Both `Tendering` and `Lost` stubs are deletable — they carry no downstream
    operational data. The endpoint refuses to delete anything whose
    `tendering_status` is not in {Tendering, Lost}, so a Won project (which may
    already carry PRs/POs/payments) can never be removed here.

    Args:
        project_name (str): The Projects docname to delete.

    Returns:
        dict: {"status": 200, "message": str} on success,
              or {"status": 400, "error": str} on failure.
    """
    try:
        _ensure_tendering_manager()
        frappe.db.begin()

        if not project_name:
            raise frappe.ValidationError("Project (docname) is required.")

        if not frappe.db.exists("Projects", project_name):
            raise frappe.ValidationError(f"Project '{project_name}' does not exist.")

        tendering_status = frappe.db.get_value(
            "Projects", project_name, "tendering_status"
        )

        if tendering_status not in ("Tendering", "Lost"):
            raise frappe.ValidationError(
                f"Project '{project_name}' cannot be deleted here "
                f"(tendering_status is '{tendering_status}'). Only Tendering or "
                f"Lost stubs can be deleted this way."
            )

        frappe.delete_doc("Projects", project_name, ignore_permissions=True)

        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Tendering project '{project_name}' deleted successfully!",
        }

    except frappe.PermissionError as pe:
        frappe.db.rollback()
        return {"status": 403, "error": str(pe)}
    except frappe.ValidationError as ve:
        frappe.db.rollback()
        frappe.log_error(
            title="delete_tendering_project validation",
            message=str(ve),
        )
        return {"status": 400, "error": str(ve)}
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            title="delete_tendering_project exception",
            message=frappe.get_traceback(),
        )
        return {"status": 400, "error": f"Failed to delete tendering project: {str(e)}"}


@frappe.whitelist(methods=["POST"])
def mark_tendering_project_lost(project_name):
    """
    Marks a Tendering project as Lost (v3 dual-field model).

    Flips `tendering_status` from `"Tendering"` to `"Lost"`. The execution
    `status` field is not touched (it stays empty — Lost stubs have no
    execution stage). This is a terminal transition: no reverse to Tendering,
    no convert to Won.

    Rejects the call unless the project is currently `tendering_status =
    "Tendering"`, so Won projects can never be downgraded and a Lost project
    can never be re-marked.

    Args:
        project_name (str): The Projects docname.

    Returns:
        dict: {"status": 200, "message": str, "project_name": str} on success,
              or {"status": 400, "error": str} on failure.
    """
    try:
        _ensure_tendering_manager()
        frappe.db.begin()

        if not project_name:
            raise frappe.ValidationError("Project (docname) is required.")

        if not frappe.db.exists("Projects", project_name):
            raise frappe.ValidationError(f"Project '{project_name}' does not exist.")

        tendering_status = frappe.db.get_value(
            "Projects", project_name, "tendering_status"
        )

        if tendering_status != "Tendering":
            raise frappe.ValidationError(
                f"Project '{project_name}' cannot be marked Lost "
                f"(tendering_status is '{tendering_status}'). Only Tendering "
                f"stubs can be marked Lost."
            )

        frappe.db.set_value(
            "Projects",
            project_name,
            "tendering_status",
            "Lost",
        )

        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Tendering project '{project_name}' marked Lost successfully!",
            "project_name": project_name,
        }

    except frappe.PermissionError as pe:
        frappe.db.rollback()
        return {"status": 403, "error": str(pe)}
    except frappe.ValidationError as ve:
        frappe.db.rollback()
        frappe.log_error(
            title="mark_tendering_project_lost validation",
            message=str(ve),
        )
        return {"status": 400, "error": str(ve)}
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            title="mark_tendering_project_lost exception",
            message=frappe.get_traceback(),
        )
        return {"status": 400, "error": f"Failed to mark tendering project Lost: {str(e)}"}


@frappe.whitelist(methods=["POST"])
def convert_tendering_to_won(project_id, values):
    """
    Converts an existing "Tendering" project stub into a full "Won" project,
    in place (v3 dual-field model).

    On success this writes BOTH dimensions:
      - `tendering_status = "Won"`  (the bid is now awarded — permanent)
      - `status = "Won"`            (execution starts at Won)

    It also runs the EXACT same population behavior as the new-project flow
    via the shared :func:`apply_full_project_details` helper (Address creation,
    `project_wp_category_makes`, `project_work_header_entries`).

    Difference from `create_project_with_address`: instead of instantiating a
    new Projects doc, this loads the existing stub by ``project_id`` and never
    re-runs autoname, so the frozen ``{city}-PROJ-#####`` docname does NOT
    change even if ``values`` carries a different city.

    Rejects the call unless the project is currently
    `tendering_status = "Tendering"` (status 400). A Won project can never be
    re-converted; a Lost project can never be revived this way.

    Args:
        project_id (str): The existing stub's docname.
        values (dict): The full wizard payload — the same shape that
            ``create_project_with_address`` receives.

    Returns:
        dict: {"status": 200, "message": str, "project_name": str} on success
              (``project_name`` is the SAME, unchanged docname), or
              {"status": 400, "error": str} on failure.
    """
    try:
        _ensure_tendering_manager()
        frappe.db.begin()

        if not project_id:
            raise frappe.ValidationError("Project (docname) is required.")

        if not frappe.db.exists("Projects", project_id):
            raise frappe.ValidationError(f"Project '{project_id}' does not exist.")

        project_doc = frappe.get_doc("Projects", project_id)

        if project_doc.tendering_status != "Tendering":
            raise frappe.ValidationError(
                f"Project '{project_id}' cannot be converted "
                f"(tendering_status is '{project_doc.tendering_status}'). Only "
                f"Tendering stubs can be converted to Won."
            )

        # frappe.whitelist may deliver `values` as a JSON string from the client.
        if isinstance(values, str):
            values = frappe.parse_json(values)

        if not values.get("project_name"):
            raise frappe.ValidationError("Project Name is required.")
        if values.get("project_city") == "Not Found" or values.get("project_state") == "Not Found":
            raise frappe.ValidationError('City and State are "Not Found", Please Enter a Valid Pincode!')
        if not values.get("project_end_date"):
            raise frappe.ValidationError('Project End Date must not be empty!')

        frontend_wps_data = values.get("project_work_packages", {}).get("work_packages", [])
        if not frontend_wps_data:
            raise frappe.ValidationError('Please select at least one work package for this project.')

        enable_milestone_tracking = values.get("enable_project_milestone_tracking", False)
        frontend_work_header_entries = values.get("project_work_header_entries", [])
        if enable_milestone_tracking:
            if not frontend_work_header_entries or not any(entry.get("enabled", False) for entry in frontend_work_header_entries):
                raise frappe.ValidationError('Project Milestone Tracking is enabled, but no Work Headers were selected or enabled.')

        start_date_str = values.get("project_start_date")
        end_date_str = values.get("project_end_date")
        try:
            datetime.strptime(start_date_str, "%Y-%m-%dT%H:%M:%S.%fZ")
            datetime.strptime(end_date_str, "%Y-%m-%dT%H:%M:%S.%fZ")
        except (ValueError, TypeError) as e:
            frappe.log_error(
                title="convert_tendering_to_won date parsing",
                message=f"Date parsing error: {e}. Start: {start_date_str}, End: {end_date_str}",
            )
            raise frappe.ValidationError("Invalid date format for project start/end dates.")

        # Populate the existing doc in place (shared logic; no autoname re-run).
        apply_full_project_details(project_doc, values)

        # Promote the stub to a real, awarded project (v3 dual-field write).
        project_doc.tendering_status = "Won"
        project_doc.status = "Won"

        project_doc.save(ignore_permissions=True)
        frappe.db.commit()

        # project_doc.name is unchanged — the docname stays frozen.
        return {
            "status": 200,
            "message": f"Project '{project_doc.project_name}' converted to Won successfully!",
            "project_name": project_doc.name,
        }

    except frappe.PermissionError as pe:
        frappe.db.rollback()
        return {"status": 403, "error": str(pe)}
    except frappe.ValidationError as ve:
        frappe.db.rollback()
        frappe.log_error(
            title="convert_tendering_to_won validation",
            message=str(ve),
        )
        return {"status": 400, "error": str(ve)}
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(
            title="convert_tendering_to_won exception",
            message=frappe.get_traceback(),
        )
        return {"status": 400, "error": f"Failed to convert tendering project: {str(e)}"}
