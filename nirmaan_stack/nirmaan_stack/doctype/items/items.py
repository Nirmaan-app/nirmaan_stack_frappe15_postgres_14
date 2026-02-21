# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Items(Document):
	def after_insert(self):
		# Set the item code to uppercase
		self.item_status = "Active"
		self.billing_category = "Billable"
		self.order_category = "Local"
		self.save()

	def on_update(self):
		"""Sync item_name and category changes to all matching TDS Repository records."""
		old_doc = self.get_doc_before_save()
		if not old_doc:
			return

		# Build dict of changed fields: Items field -> TDS Repository field
		updates = {}

		old_name = old_doc.get("item_name") or ""
		new_name = self.get("item_name") or ""
		if old_name != new_name:
			updates["tds_item_name"] = new_name

		old_category = old_doc.get("category") or ""
		new_category = self.get("category") or ""
		if old_category != new_category:
			updates["category"] = new_category

		if not updates:
			return

		tds_records = frappe.get_all(
			"TDS Repository",
			filters={"tds_item_id": self.name},
			fields=["name"],
		)

		for rec in tds_records:
			frappe.db.set_value("TDS Repository", rec.name, updates, update_modified=False)

		if tds_records:
			frappe.db.commit()
			print(f"[Items on_update] '{self.name}': Synced {updates} to {len(tds_records)} TDS Repository record(s).")
