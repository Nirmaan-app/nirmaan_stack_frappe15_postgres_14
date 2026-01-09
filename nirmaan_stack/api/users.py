import frappe
from frappe import _
from frappe.model.rename_doc import rename_doc


@frappe.whitelist()
def create_user(
    first_name: str,
    last_name: str = None,
    email: str = None,
    mobile_no: str = None,
    role_profile_name: str = None
):
    """
    Create a new user with graceful handling of email failures.

    Creates the user first (with send_welcome_email=0), then attempts
    to send the welcome email separately. If email fails, user is still
    created successfully with a warning.

    Args:
        first_name: User's first name (required)
        last_name: User's last name
        email: User's email address (required, becomes the user ID)
        mobile_no: User's mobile number
        role_profile_name: Role profile to assign

    Returns:
        dict: {
            success: bool,
            user: User document name,
            message: str,
            email_sent: bool,
            email_error: str (if email failed)
        }
    """
    if not email:
        frappe.throw(_("Email is required"))

    if not first_name:
        frappe.throw(_("First name is required"))

    email = email.strip().lower()

    # Check if user already exists
    if frappe.db.exists("User", email):
        frappe.throw(_("User with email {0} already exists").format(email))

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


@frappe.whitelist()
def reset_password(user: str):
    """
    Send password reset email to a user with graceful error handling.

    Generates the reset key first (critical operation), then attempts to send
    the email. If email fails, returns success=True with email_sent=False
    since the reset key was generated.

    Args:
        user: User's email/name

    Returns:
        dict: {
            success: bool,
            message: str,
            email_sent: bool,
            reset_link: str (only if email failed, for manual sharing)
        }
    """
    if not user:
        frappe.throw(_("User is required"))

    user = user.strip().lower()

    # Check if user exists
    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist").format(user))

    # Step 1: Get user and generate reset key (critical operation)
    user_doc = None
    link = None

    try:
        user_doc = frappe.get_doc("User", user)

        # Generate reset password key
        from frappe.utils import random_string, get_url
        key = random_string(32)
        user_doc.db_set("reset_password_key", key)
        frappe.db.commit()

        # Build the reset link
        link = get_url(f"/update-password?key={key}")

    except Exception as e:
        frappe.log_error(f"Password reset failed for {user}: {str(e)}", "Password Reset Failed")
        frappe.throw(_("Failed to process password reset: {0}").format(str(e)))

    # Step 2: Send email (non-critical, completely isolated)
    email_sent = False
    email_error_msg = None

    try:
        frappe.sendmail(
            recipients=user_doc.email,
            subject="Password Reset",
            template="password_reset",
            args={
                "first_name": user_doc.first_name or user_doc.full_name,
                "last_name": user_doc.last_name or "",
                "user": user_doc.name,
                "link": link
            },
            header=["Password Reset", "green"],
            now=True
        )
        email_sent = True
    except Exception as email_error:
        email_error_msg = str(email_error) if email_error else "Unknown email error"
        # Log error silently
        try:
            frappe.log_error(
                f"Failed to send password reset email to {user}: {email_error_msg}",
                "Password Reset - Email Failed"
            )
        except Exception:
            pass  # Ignore logging errors

    # Build response - reset key is definitely generated at this point
    if email_sent:
        return {
            "success": True,
            "message": f"Password reset email has been sent to {user_doc.email}",
            "email_sent": True
        }
    else:
        return {
            "success": True,
            "message": f"Password reset link generated, but email could not be sent. Please contact the tech admin to resolve email configuration issues.",
            "email_sent": False,
            "email_error": email_error_msg,
            "reset_link": link  # Provide link so admin can share manually if needed
        }


@frappe.whitelist()
def get_user_role_counts():
	"""
	Get counts of users by role in a single database query.
	Returns: {role_value: count, ...}
	"""
	user_role_options = [
		"Nirmaan Admin Profile",
		"Nirmaan Project Lead Profile",
		"Nirmaan Project Manager Profile",
		"Nirmaan Procurement Executive Profile",
		"Nirmaan Accountant Profile",
		"Nirmaan Estimates Executive Profile",
		"Nirmaan Design Executive Profile",
		"Nirmaan Design Lead Profile",
	]

	role_counts = {}
	for role in user_role_options:
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
