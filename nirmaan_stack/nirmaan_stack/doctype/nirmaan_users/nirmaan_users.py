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
	if not frappe.db.exists("Nirmaan Users", {"email": doc.email}):
		try:
			frappe.get_doc(doctype="Nirmaan Users",
				 first_name=doc.first_name,
				 full_name=doc.full_name,
				 email=doc.email,
				 role_profile=doc.role_profile_name).insert(ignore_permissions=True)
			frappe.db.commit()
		except Exception as e:
			frappe.get_doc(doctype="Nirmaan Users",
				 first_name=doc.first_name,
				 full_name=doc.full_name,
				 email=doc.email,
				 role_profile="Nirmaan Admin").insert(ignore_permissions=True)
			frappe.db.commit()
			

def on_user_update(doc, method=None):
	create_user_profile(doc)
	if any(doc.has_value_changed(field) for field in ["first_name","last_name","full_name", "mobile_no"]):
		profile = frappe.get_doc("Nirmaan Users", {"email": doc.email})
		profile.first_name = doc.first_name
		profile.last_name = doc.last_name
		profile.full_name = doc.full_name
		profile.mobile_no = doc.mobile_no
		profile.save(ignore_permissions=True)

def delete_user_profile(doc, method=None):
	exists = frappe.db.exists("Nirmaan Users", {"email": doc.email})
	if exists:
		return frappe.get_doc("Nirmaan Users", {"email": doc.email}).delete()