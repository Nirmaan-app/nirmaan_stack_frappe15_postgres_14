import frappe
from frappe import _
from frappe.model.rename_doc import rename_doc


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
