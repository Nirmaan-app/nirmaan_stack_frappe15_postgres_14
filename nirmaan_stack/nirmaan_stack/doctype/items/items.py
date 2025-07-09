# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class Items(Document):
	def after_insert(self):
		# Set the item code to uppercase
		self.item_status = "Active"
		self.billing_category = "Billable"
		self.order_category = "Local"
		self.save()
