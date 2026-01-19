import frappe
from frappe import _
from frappe.utils import now_datetime, format_datetime

# Admin roles that can finalize and revert
ADMIN_ROLES = [
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Project Lead Profile",
    "Nirmaan Procurement Executive Profile",
]


def get_user_role_profile(user: str) -> str:
    """Get the role profile for a user from Nirmaan Users doctype."""
    if user == "Administrator":
        return "Nirmaan Admin Profile"

    # Nirmaan Users uses lowercased email as name
    user_key = user.strip().lower() if user else ""
    role_profile = frappe.get_value("Nirmaan Users", user_key, "role_profile")
    return role_profile or ""


def get_user_full_name(user: str) -> str:
    """Get the full name for a user from Nirmaan Users doctype."""
    if user == "Administrator":
        return "Administrator"

    # Nirmaan Users uses lowercased email as name
    user_key = user.strip().lower() if user else ""
    full_name = frappe.get_value("Nirmaan Users", user_key, "full_name")
    return full_name or user


def is_admin_role(user: str) -> bool:
    """Check if user has an admin role or is Administrator."""
    # Administrator user always has admin privileges
    if user == "Administrator":
        return True
    role_profile = get_user_role_profile(user)
    return role_profile in ADMIN_ROLES


def create_finalization_remark(sr_id: str, action: str, full_name: str, timestamp: str) -> None:
    """Create a system remark for finalization/revert action."""
    # Format the timestamp for display (dd-MMM-yyyy)
    formatted_date = format_datetime(timestamp, "dd-MMM-yyyy")

    if action == "finalize":
        content = f"This Work Order was finalized by {full_name} on {formatted_date}"
    else:  # revert
        content = f"Finalization was reverted by {full_name} on {formatted_date}"

    # Create the comment using Nirmaan Comments
    comment_doc = frappe.new_doc("Nirmaan Comments")
    comment_doc.comment_type = "sr_remark"
    comment_doc.reference_doctype = "Service Requests"
    comment_doc.reference_name = sr_id
    comment_doc.content = content
    comment_doc.subject = "admin_remark"  # System-generated remarks use admin subject
    comment_doc.comment_by = frappe.session.user
    comment_doc.is_system_generated = 1  # Mark as system-generated (undeletable)
    comment_doc.insert(ignore_permissions=True)


@frappe.whitelist()
def finalize_sr(sr_id: str) -> dict:
    """
    Finalize a Service Request (Work Order).

    Only approved SRs can be finalized.
    Admin roles and the creator (owner) can finalize.

    Args:
        sr_id: The Service Request ID

    Returns:
        dict with status and message
    """
    if not sr_id:
        frappe.throw(_("SR ID is required"))

    # Validate SR exists
    if not frappe.db.exists("Service Requests", sr_id):
        frappe.throw(_("Service Request {0} not found").format(sr_id))

    # Get the SR document
    sr_doc = frappe.get_doc("Service Requests", sr_id)

    # Check if already finalized
    if sr_doc.is_finalized:
        frappe.throw(_("This Work Order is already finalized"))

    # Check if status is Approved
    if sr_doc.status != "Approved":
        frappe.throw(_("Only approved Work Orders can be finalized"))

    # Permission check: Admin roles OR owner can finalize
    current_user = frappe.session.user
    is_admin = is_admin_role(current_user)
    is_owner = sr_doc.owner == current_user

    if not is_admin and not is_owner:
        frappe.throw(_("You don't have permission to finalize this Work Order"))

    # Get user's full name
    full_name = get_user_full_name(current_user)

    # Update the SR document
    timestamp = now_datetime()
    sr_doc.is_finalized = 1
    sr_doc.finalized_by = full_name
    sr_doc.finalized_on = timestamp
    sr_doc.save(ignore_permissions=True)

    frappe.db.commit()

    # Create system remark
    create_finalization_remark(sr_id, "finalize", full_name, timestamp)
    frappe.db.commit()

    return {
        "status": "success",
        "message": _("Work Order finalized successfully"),
        "data": {
            "is_finalized": True,
            "finalized_by": full_name,
            "finalized_on": str(timestamp),
        }
    }


@frappe.whitelist()
def revert_finalize_sr(sr_id: str) -> dict:
    """
    Revert finalization of a Service Request (Work Order).

    Only admin roles can revert finalization.

    Args:
        sr_id: The Service Request ID

    Returns:
        dict with status and message
    """
    if not sr_id:
        frappe.throw(_("SR ID is required"))

    # Validate SR exists
    if not frappe.db.exists("Service Requests", sr_id):
        frappe.throw(_("Service Request {0} not found").format(sr_id))

    # Get the SR document
    sr_doc = frappe.get_doc("Service Requests", sr_id)

    # Check if actually finalized
    if not sr_doc.is_finalized:
        frappe.throw(_("This Work Order is not finalized"))

    # Permission check: Only admin roles can revert
    current_user = frappe.session.user
    if not is_admin_role(current_user):
        frappe.throw(_("Only administrators can revert Work Order finalization"))

    # Get user's full name
    full_name = get_user_full_name(current_user)

    # Create system remark before clearing values
    timestamp = now_datetime()
    create_finalization_remark(sr_id, "revert", full_name, timestamp)

    # Update the SR document
    sr_doc.is_finalized = 0
    sr_doc.finalized_by = None
    sr_doc.finalized_on = None
    sr_doc.save(ignore_permissions=True)

    frappe.db.commit()

    return {
        "status": "success",
        "message": _("Work Order finalization reverted successfully"),
        "data": {
            "is_finalized": False,
        }
    }


@frappe.whitelist()
def check_finalize_permissions(sr_id: str) -> dict:
    """
    Check what finalization actions the current user can perform on an SR.

    Args:
        sr_id: The Service Request ID

    Returns:
        dict with permission flags and current finalization state
    """
    if not sr_id:
        return {
            "can_finalize": False,
            "can_revert": False,
            "is_finalized": False,
            "error": "SR ID is required"
        }

    # Validate SR exists
    if not frappe.db.exists("Service Requests", sr_id):
        return {
            "can_finalize": False,
            "can_revert": False,
            "is_finalized": False,
            "error": "Service Request not found"
        }

    # Get basic SR details (fields that always exist)
    sr_data = frappe.db.get_value(
        "Service Requests",
        sr_id,
        ["status", "owner"],
        as_dict=True
    )

    # Try to get finalization fields (may not exist if migration hasn't run)
    is_finalized = False
    finalized_by = None
    finalized_on = None

    try:
        # Check if is_finalized column exists
        finalization_data = frappe.db.get_value(
            "Service Requests",
            sr_id,
            ["is_finalized", "finalized_by", "finalized_on"],
            as_dict=True
        )
        if finalization_data:
            is_finalized = bool(finalization_data.get("is_finalized"))
            finalized_by = finalization_data.get("finalized_by")
            finalized_on = finalization_data.get("finalized_on")
    except Exception:
        # Fields don't exist yet - migration hasn't been run
        # Default to not finalized
        pass

    current_user = frappe.session.user
    is_admin = is_admin_role(current_user)
    is_owner = sr_data.get("owner") == current_user
    is_approved = sr_data.get("status") == "Approved"

    # Can finalize: SR is approved, not finalized, and user is admin or owner
    can_finalize = is_approved and not is_finalized and (is_admin or is_owner)

    # Can revert: SR is finalized and user is admin
    can_revert = is_finalized and is_admin

    return {
        "can_finalize": can_finalize,
        "can_revert": can_revert,
        "is_finalized": is_finalized,
        "finalized_by": finalized_by if is_finalized else None,
        "finalized_on": str(finalized_on) if finalized_on else None,
        "is_admin": is_admin,
        "is_owner": is_owner,
    }
