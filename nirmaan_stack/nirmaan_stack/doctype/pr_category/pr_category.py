# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class PRCategory(Document):
	pass

def generate_pr_category(procurement_request, method=None):
	procurement_list = procurement_request.procurement_list["list"]
	categories = {}
	for values in procurement_list:
		if categories.get(values["category"]) is None:
			categories[values["category"]]=[{"item":values["item"], "quantity": values["quantity"],"unit": values["unit"],"name": values["name"]}]
		else:
			categories[values["category"]].append({"item":values["item"], "quantity": values["quantity"],"unit": values["unit"],"name": values["name"]})
	for category, items in categories.items():
		doc = frappe.new_doc("PR Category")
		doc.procurement_request=procurement_request.name
		doc.category=category
		doc.item_list={"list": items}
		doc.insert(ignore_permissions=True)
