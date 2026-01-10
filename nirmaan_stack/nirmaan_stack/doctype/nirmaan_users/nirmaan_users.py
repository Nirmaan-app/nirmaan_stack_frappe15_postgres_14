# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class NirmaanUsers(Document):
	def validate(self):
		self.set_full_name()

	def autoname(self):
		"""set name as Email Address"""
		self.email = self.email.strip().lower()
		self.name = self.email

	#REFER from frappe modules User doctype
	def set_full_name(self):
		self.full_name = " ".join(filter(None, [self.first_name, self.last_name]))


def create_user_profile(doc, method=None):
	"""
	Create a Nirmaan Users profile when a Frappe User is created.
	Called via after_insert hook on User doctype.
	"""
	# Normalize email to match autoname behavior
	email = doc.email.strip().lower() if doc.email else None

	if not email:
		frappe.log_error(
			f"Cannot create Nirmaan User: User {doc.name} has no email",
			"Nirmaan Users Sync"
		)
		return

	# Check if Nirmaan Users already exists (by name/primary key, not email field)
	if frappe.db.exists("Nirmaan Users", email):
		return

	try:
		frappe.get_doc(
			doctype="Nirmaan Users",
			first_name=doc.first_name,
			last_name=doc.last_name,
			full_name=doc.full_name,
			email=email,
			mobile_no=doc.mobile_no,
			role_profile=doc.role_profile_name
		).insert(ignore_permissions=True)
		frappe.db.commit()
	except Exception as e:
		# Log the first error
		frappe.log_error(
			f"Primary insert failed for {email}: {str(e)}",
			"Nirmaan Users Sync"
		)
		try:
			# Fallback: minimal fields only
			frappe.get_doc(
				doctype="Nirmaan Users",
				first_name=doc.first_name or email.split("@")[0],
				full_name=doc.full_name or doc.first_name or email.split("@")[0],
				email=email
			).insert(ignore_permissions=True)
			frappe.db.commit()
		except Exception as fallback_error:
			# Log fallback failure - this is critical
			frappe.log_error(
				f"Fallback insert also failed for {email}: {str(fallback_error)}\n"
				f"User {doc.name} exists WITHOUT Nirmaan Users record!",
				"Nirmaan Users Sync CRITICAL"
			)


def on_user_update(doc, method=None):
	"""
	Sync Nirmaan Users when Frappe User is updated.
	Creates Nirmaan Users if missing, then syncs changed fields.
	"""
	# First ensure Nirmaan Users exists
	create_user_profile(doc)

	# Normalize email
	email = doc.email.strip().lower() if doc.email else None
	if not email:
		return

	# Check if any relevant fields changed
	if not any(doc.has_value_changed(field) for field in ["first_name", "last_name", "full_name", "mobile_no", "role_profile_name"]):
		return

	# Defensive check: only update if Nirmaan Users exists
	if not frappe.db.exists("Nirmaan Users", email):
		frappe.log_error(
			f"Cannot update Nirmaan User: {email} does not exist after create_user_profile",
			"Nirmaan Users Sync"
		)
		return

	try:
		profile = frappe.get_doc("Nirmaan Users", email)
		profile.first_name = doc.first_name
		profile.last_name = doc.last_name
		profile.full_name = doc.full_name
		profile.mobile_no = doc.mobile_no
		profile.role_profile = doc.role_profile_name
		profile.save(ignore_permissions=True)
	except Exception as e:
		frappe.log_error(
			f"Failed to update Nirmaan User {email}: {str(e)}",
			"Nirmaan Users Sync"
		)


# Creating infinite loop if enabled with nirmaan users controller on_trash function
def delete_user_profile(doc, method=None):
	"""
	Delete Nirmaan Users when Frappe User is deleted.
	Currently disabled in hooks.py to avoid infinite loop with on_trash.
	"""
	email = doc.email.strip().lower() if doc.email else doc.name
	if frappe.db.exists("Nirmaan Users", email):
		try:
			frappe.get_doc("Nirmaan Users", email).delete()
		except Exception as e:
			frappe.log_error(
				f"Failed to delete Nirmaan User {email}: {str(e)}",
				"Nirmaan Users Sync"
			)
