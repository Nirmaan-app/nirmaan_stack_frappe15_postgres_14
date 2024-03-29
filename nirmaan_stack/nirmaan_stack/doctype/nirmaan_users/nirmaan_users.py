# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

# import frappe
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
