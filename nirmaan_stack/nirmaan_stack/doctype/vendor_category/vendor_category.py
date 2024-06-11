# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class VendorCategory(Document):
	pass

def generate_vendor_category(vendor, method=None):
	categories = vendor.vendor_category["categories"]
	for category in categories:
		doc = frappe.new_doc("Vendor Category")
		doc.vendor=vendor.name
		doc.category=category
		doc.vendor_name=vendor.vendor_name
		doc.insert(ignore_permissions=True)