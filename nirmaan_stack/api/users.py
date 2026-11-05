import re

import frappe
from frappe import _
from frappe.model.rename_doc import rename_doc

from nirmaan_stack.services.asset_history import rename_person as rename_person_in_asset_history
from nirmaan_stack.services.departments import assert_active_department, is_department_editor
from nirmaan_stack.services.role_profiles import assert_user_admin


@frappe.whitelist(methods=["POST"])
def create_user(
    first_name: str,
    last_name: str = None,
    email: str = None,
    mobile_no: str = None,
    role_profile_name: str = None,
    department: str = None,
):
    """
    Create a new user with graceful handling of email failures. User admins only
    (`services/role_profiles.USER_ADMIN_PROFILES`).

    Creates the user first (with send_welcome_email=0), then attempts
    to send the welcome email separately. If email fails, user is still
    created successfully with a warning.

    Args:
        first_name: User's first name (required)
        last_name: User's last name
        email: User's email address (required, becomes the user ID)
        mobile_no: User's mobile number
        role_profile_name: Role profile to assign (any, Admin included)
        department: The person's department (Nirmaan Users.department); Admin/HR only

    Returns:
        dict: {
            success: bool,
            user: User document name,
            message: str,
            email_sent: bool,
            email_error: str (if email failed)
        }
    """
    assert_user_admin(frappe.session.user)

    if not email:
        frappe.throw(_("Email is required"))

    if not first_name:
        frappe.throw(_("First name is required"))

    email = email.strip().lower()

    # Check if user already exists
    if frappe.db.exists("User", email):
        frappe.throw(_("User with email {0} already exists").format(email))

    # Mobile number is the login key for phone-based login, so it must be
    # exactly 10 digits and unique across users.
    if mobile_no:
        if not re.fullmatch(r"\d{10}", mobile_no):
            frappe.throw(_("Mobile number must be exactly 10 digits"))
        existing_mobile_user = frappe.db.get_value("User", {"mobile_no": mobile_no}, "name")
        if existing_mobile_user:
            frappe.throw(
                _("User with mobile number {0} already exists ({1})").format(
                    mobile_no, existing_mobile_user
                )
            )

    # Checked BEFORE the user exists: the User insert commits, so a refusal after it would leave a
    # half-made user behind.
    if department:
        if not is_department_editor():
            frappe.throw(_("Only Admin and HR can set a person's department."), frappe.PermissionError)
        if not frappe.db.exists("Nirmaan Department", department):
            frappe.throw(_("Unknown department {0}").format(department))
        assert_active_department(department)

    user_doc = None
    full_name = first_name  # Default fallback

    try:
        # Create user WITHOUT sending welcome email
        user_doc = frappe.get_doc({
            "doctype": "User",
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "mobile_no": mobile_no,
            "role_profile_name": role_profile_name,
            "send_welcome_email": 0,  # Disable automatic welcome email
            "user_type": "System User",
        })
        user_doc.insert(ignore_permissions=True)
        if not frappe.db.exists("Nirmaan Users", email):
            # The User's after_insert sync logs and swallows its own failure; a login with no Nirmaan Users
            # record is refused at every request (integrations/login_gate.py), so don't report a success.
            frappe.throw(_("The user's Nirmaan Users record could not be created. See the Error Log."))
        if department:
            # The User after_insert hook has just created the person's Nirmaan Users record.
            profile = frappe.get_doc("Nirmaan Users", email)
            profile.department = department
            profile.save(ignore_permissions=True)
        frappe.db.commit()
        full_name = user_doc.full_name or first_name

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(f"Failed to create user {email}: {str(e)}", "User Creation Failed")
        frappe.throw(_("Failed to create user: {0}").format(str(e)))

    # If we reach here, user was created successfully
    # Now attempt to send welcome email - completely isolated
    email_sent = False
    email_error_msg = None

    try:
        if user_doc:
            user_doc.send_welcome_mail_to_user()
            email_sent = True
    except Exception as email_error:
        email_error_msg = str(email_error) if email_error else "Unknown email error"
        # Log error silently - don't let logging failure affect response
        try:
            frappe.log_error(
                f"Failed to send welcome email to {email}: {email_error_msg}",
                "User Creation - Email Failed"
            )
        except Exception:
            pass  # Ignore logging errors

    # Build response - user is definitely created at this point
    if email_sent:
        return {
            "success": True,
            "user": email,
            "full_name": full_name,
            "message": f"User {full_name} created successfully. Welcome email sent.",
            "email_sent": True,
            "email_error": None
        }
    else:
        return {
            "success": True,
            "user": email,
            "full_name": full_name,
            "message": f"User {full_name} created successfully, but welcome email could not be sent. Please contact the tech admin to resolve email configuration issues.",
            "email_sent": False,
            "email_error": email_error_msg
        }


@frappe.whitelist(methods=["POST"])
def reset_password(user: str):
    """
    Send a password reset email to a user. User admins only.

    The key is made and stored by Frappe (`User._reset_password`, the step Frappe's own reset runs), which
    keeps only its hash, so the link works in Frappe's update-password flow. Refused for Administrator and a
    switched-off login. The link is never returned to the caller: it goes
    only to the user's own inbox. If the email fails, the reset is reported as not sent.

    Args:
        user: User's email/name

    Returns:
        dict: {success: bool, message: str, email_sent: bool, email_error: str (if email failed)}
    """
    assert_user_admin(frappe.session.user)

    if not user:
        frappe.throw(_("User is required"))

    user = user.strip().lower()

    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist").format(user))

    user_doc = frappe.get_doc("User", user)
    # As Frappe's own `frappe.core.doctype.user.user.reset_password`: never for Administrator or a switched-off
    # login (an exited employee's).
    if user_doc.name == "Administrator" or not user_doc.enabled:
        frappe.throw(_("A password can't be reset for {0}: the login is switched off.").format(user))
    user_doc.validate_reset_password()
    try:
        user_doc._reset_password(send_email=True)
    except Exception as email_error:
        email_error_msg = str(email_error) or "Unknown email error"
        frappe.log_error(
            f"Failed to send password reset email to {user}: {email_error_msg}",
            "Password Reset - Email Failed",
        )
        frappe.db.commit()
        return {
            "success": True,
            "message": "The password reset email could not be sent. Please contact the tech admin to resolve email configuration issues.",
            "email_sent": False,
            "email_error": email_error_msg,
        }

    frappe.db.commit()
    return {
        "success": True,
        "message": f"Password reset email has been sent to {user_doc.email}",
        "email_sent": True,
    }


@frappe.whitelist()
def get_user_role_counts():
	"""
	Get counts of users by role in a single database query.
	Dynamically fetches all Nirmaan role profiles from Role Profile doctype.
	Returns: {role_value: count, ...}
	"""
	# Fetch all role profiles starting with "Nirmaan" from Role Profile doctype
	nirmaan_roles = frappe.get_all(
		"Role Profile",
		filters={"name": ["like", "Nirmaan%"]},
		pluck="name"
	)

	role_counts = {}
	for role in nirmaan_roles:
		count = frappe.db.count('Nirmaan Users', filters={'role_profile': role})
		role_counts[role] = count

	return role_counts


@frappe.whitelist()
def rename_user_email(old_email: str, new_email: str):
	"""
	Rename a user's email address across all systems.

	- Admin only: Only admins can rename emails
	- Cannot rename self
	- Cannot rename other admins
	- Forces logout of renamed user

	Args:
		old_email: Current email address (user's name/primary key)
		new_email: New email address to change to

	Returns:
		dict: Success status with new email or error message
	"""
	# Normalize emails
	old_email = old_email.strip().lower()
	new_email = new_email.strip().lower()

	current_user = frappe.session.user

	# 1. Check if current user is admin (either system Administrator or Nirmaan Admin)
	is_admin = False
	if current_user == "Administrator":
		is_admin = True
	else:
		current_user_role = frappe.get_value("Nirmaan Users", current_user, "role_profile")
		if current_user_role == "Nirmaan Admin Profile":
			is_admin = True

	if not is_admin:
		frappe.throw(_("Only admins can rename user emails"), frappe.PermissionError)

	# 2. Cannot rename self
	if old_email == current_user.lower():
		frappe.throw(_("You cannot rename your own email"))

	# 3. Check if target user exists
	if not frappe.db.exists("Nirmaan Users", old_email):
		frappe.throw(_("User {0} does not exist").format(old_email))

	# 4. Cannot rename the system Administrator user
	if old_email.lower() == "administrator":
		frappe.throw(_("Cannot rename the system Administrator user"))

	# 5. Cannot rename other admins
	target_user_role = frappe.get_value("Nirmaan Users", old_email, "role_profile")
	if target_user_role == "Nirmaan Admin Profile":
		frappe.throw(_("Cannot rename admin users"))

	# 6. Validate email format
	if not frappe.utils.validate_email_address(new_email):
		frappe.throw(_("Invalid email format: {0}").format(new_email))

	# 7. Check uniqueness - email should not already exist
	if frappe.db.exists("User", new_email):
		frappe.throw(_("Email {0} already exists in the system").format(new_email))

	if frappe.db.exists("Nirmaan Users", new_email):
		frappe.throw(_("Email {0} already exists in Nirmaan Users").format(new_email))

	try:
		# 8. Rename User doctype first (handles Link fields to User automatically)
		rename_doc("User", old_email, new_email, force=True)

		# 9. Rename Nirmaan Users doctype (handles Link fields to Nirmaan Users automatically)
		rename_doc("Nirmaan Users", old_email, new_email, force=True)

		# 10. Update Data fields that don't auto-update (not Link fields)
		frappe.db.sql("""
			UPDATE "tabNirmaan User Permissions"
			SET "user" = %s WHERE "user" = %s
		""", (new_email, old_email))
		rename_person_in_asset_history(old_email, new_email)

		# 11. Force logout the renamed user by clearing their sessions
		frappe.db.sql("""
			DELETE FROM "tabSessions" WHERE "user" = %s
		""", (new_email,))

		frappe.db.commit()

		return {
			"success": True,
			"message": _("Email renamed from {0} to {1}").format(old_email, new_email),
			"new_email": new_email
		}

	except Exception as e:
		frappe.db.rollback()
		frappe.log_error("Email rename failed", frappe.get_traceback())
		frappe.throw(_("Failed to rename email: {0}").format(str(e)))
