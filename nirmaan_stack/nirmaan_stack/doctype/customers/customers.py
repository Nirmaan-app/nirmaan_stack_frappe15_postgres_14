# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class Customers(Document):
	def before_save(self):
		self.company_phone = self.get_company_contacts()["phone"] or ""
		self.company_email = self.get_company_contacts()["email"] or ""
	def get_company_contacts(self):
		address = frappe.get_doc("Address", self.company_address)
		return {
			"email":address.email_id,
			"phone":address.phone
		  }
