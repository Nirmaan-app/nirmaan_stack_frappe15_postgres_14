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

def delete_vendor_category(vendor, method=None):
	frappe.db.delete("Vendor Category", {
		"vendor": vendor.name
	})

import json

def update_vendor_category(vendor, method=None):
    # Ensure vendor.vendor_category is a dictionary
    if isinstance(vendor.vendor_category, str):
        try:
            vendor.vendor_category = json.loads(vendor.vendor_category)
        except json.JSONDecodeError as e:
            frappe.throw(f"Invalid vendor_category format: {e}")

    # Check if 'categories' key exists
    if "categories" not in vendor.vendor_category:
        frappe.throw("Missing 'categories' in vendor_category")

    # Fetch existing Vendor Category documents for the vendor
    existing_categories = frappe.get_all(
        "Vendor Category",
        filters={"vendor": vendor.name},
        fields=["name", "category"]
    )

    # Extract current categories from the database
    existing_category_names = {doc["category"]: doc["name"] for doc in existing_categories}

    # Extract updated categories from vendor data
    updated_categories = set(vendor.vendor_category["categories"])

    # Find categories to delete (present in DB but not in updated list)
    categories_to_delete = set(existing_category_names.keys()) - updated_categories

    # Find categories to add (present in updated list but not in DB)
    categories_to_add = updated_categories - set(existing_category_names.keys())

    # Delete Vendor Category docs for removed categories
    for category in categories_to_delete:
        frappe.delete_doc("Vendor Category", existing_category_names[category], ignore_permissions=True)

    # Add Vendor Category docs for new categories
    for category in categories_to_add:
        doc = frappe.new_doc("Vendor Category")
        doc.vendor = vendor.name
        doc.category = category
        doc.vendor_name = vendor.vendor_name
        doc.insert(ignore_permissions=True)