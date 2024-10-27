# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

class CustomerGSTExistError(frappe.ValidationError):
	pass

class Customers(Document):
	def before_insert(self):
		customer_gsts = frappe.db.get_list("Customers")
		for customer_gst in customer_gsts:
			customer = frappe.get_doc("Customers", customer_gst)
			if self.company_gst == customer.company_gst:
				frappe.throw(_("Customer with this GST already exist."), exc=CustomerGSTExistError)
