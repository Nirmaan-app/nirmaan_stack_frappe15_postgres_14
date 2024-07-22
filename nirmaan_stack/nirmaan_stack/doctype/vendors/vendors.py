# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

#import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries


class Vendors(Document):
	def before_save(self):
		#self.project_duration = (datetime.strptime(self.project_end_date, '%Y-%m-%d %H:%M:%S') - datetime.strptime(self.project_start_date, '%Y-%m-%d %H:%M:%S')).days or 0
		# self.vendor_city = self.get_project_address()["city"] or ""
		# self.vendor_state = self.get_project_address()["state"] or ""
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
