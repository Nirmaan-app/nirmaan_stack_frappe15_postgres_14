# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class QuotationRequests(Document):
	pass

def generate_quotation_requests(procurement_task, method=None):
	quotation_requests = procurement_task.procurement_list["procurement_list"]
	for values in quotation_requests:
		doc = frappe.new_doc("Quotation Requests")
		doc.procurement_task=procurement_task.name
		doc.project=procurement_task.project
		doc.category=values["category"]
		doc.item=values["item"]
		doc.insert(ignore_permissions=True)