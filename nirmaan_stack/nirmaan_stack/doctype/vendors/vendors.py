# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.naming import getseries

from nirmaan_stack.services.vendor_tds import rate_to_store

class VendorGSTExistError(frappe.ValidationError):
	pass


class Vendors(Document):
	def validate(self):
		# The PAN sets the TDS rate when a vendor is created or its PAN / rate is edited: always 1% for
		# an Individual / HUF; anyone else keeps the rate the user set, 2% by default
		# (services/vendor_tds.py).
		# Every other save leaves the rate alone -- the 04:30 credit job saves every vendor nightly
		# and must not move anyone's rate.
		if self.is_new() or self.has_value_changed("vendor_pan") or self.has_value_changed("tds_deduction_percentage"):
			self.tds_deduction_percentage = rate_to_store(self.vendor_pan, self.tds_deduction_percentage)

	def before_insert(self):
		# if not self.vendor_gst:
		# 	pass
		# else:
		# 	vendor_gsts = frappe.db.get_list("Vendors")
		# 	for vendor_gst in vendor_gsts:
		# 		vendor = frappe.get_doc("Vendors", vendor_gst)
		# 		if self.vendor_gst == vendor.vendor_gst:
		# 			frappe.throw(_("Vendor with this GST already exist."), exc=VendorGSTExistError)
		pass

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
