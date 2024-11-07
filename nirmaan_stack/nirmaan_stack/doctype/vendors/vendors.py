# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.naming import getseries

class VendorGSTExistError(frappe.ValidationError):
	pass


class Vendors(Document):
	def before_insert(self):
		vendor_gsts = frappe.db.get_list("Vendors")
		for vendor_gst in vendor_gsts:
			vendor = frappe.get_doc("Vendors", vendor_gst)
			if self.vendor_gst!="" and self.vendor_gst == vendor.vendor_gst:
				frappe.throw(_("Vendor with this GST already exist."), exc=VendorGSTExistError)

	def autoname(self):
		vendor_type = self.vendor_type
		
		prefix = f"VEN-{vendor_type}-"
		self.name = f"{prefix}{getseries(prefix, 4)}"
	# def get_project_address(self):
	# 	address = frappe.get_doc("Address", self.vendor_address)
	# 	return {
	# 		"city":address.city,
	# 		"state":address.state
	# 	  }
