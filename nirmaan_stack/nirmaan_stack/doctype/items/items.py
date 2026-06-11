# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Items(Document):
	def validate(self):
		if self.item_name:
			# Case-insensitive duplicate check excluding current record
			duplicate = frappe.db.get_value("Items", {
				"item_name": self.item_name,
				"name": ["!=", self.name]
			}, "name")
			if duplicate:
				frappe.throw(frappe._("Product Name '{0}' already exists (ID: {1})").format(self.item_name, duplicate))

	def before_insert(self):
		# Set default values if not provided
		if not self.item_status:
			self.item_status = "Active"
		if not self.billing_category:
			self.billing_category = "Billable"
		if not self.order_category:
			self.order_category = "Local"

	def on_update(self):
		"""Sync item_name and category changes to all matching TDS Repository records."""
		old_doc = self.get_doc_before_save()
		if not old_doc:
			return

		# Propagate a billing_category change to the billing_status of every
		# Procurement Request / Sent Back / Purchase Order line item for this item.
		self._propagate_billing_status(old_doc)

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

	# PR / SB parent workflow states that are still heading toward a PO ("upcoming PO").
	# Terminal / done states are intentionally excluded so historical PR/SB rows are left
	# alone (their PO already carries the value):
	#   PR excluded: Vendor Approved, Rejected, Sent Back, Delayed, Hidden
	#   SB excluded: Approved, Sent Back
	_PR_UPCOMING_PO_STATES = (
		"Draft", "Pending", "Approved", "RFQ Generated", "Quote Updated",
		"In Progress", "Vendor Selected", "Partially Approved",
	)
	_SB_UPCOMING_PO_STATES = ("Pending", "Vendor Selected", "Partially Approved")

	def _propagate_billing_status(self, old_doc):
		"""When billing_category changes, mirror it onto billing_status:
		  - Purchase Order Item: ALL rows for this item (the PO is the billing record).
		  - Procurement Request Item Detail (PR + SB order_list): only rows whose parent
		    PR/SB is still heading toward a PO (upcoming-PO workflow states). Terminal/done
		    PR/SB rows are left untouched as history.
		Then recompute the PO parent rollup. Raw SQL / update_modified=False, so no parent
		timestamps are bumped."""
		if (old_doc.get("billing_category") or "") == (self.billing_category or ""):
			return

		new_status = self.billing_category
		# Don't propagate a blank: if billing_category was cleared, leave existing
		# line-item billing_status as-is rather than wiping it to empty.
		if not new_status:
			return

		# 1) PO items — update fully (every PO line for this item).
		frappe.db.set_value(
			"Purchase Order Item",
			{"item_id": self.name},
			"billing_status",
			new_status,
			update_modified=False,
		)

		# 2) PR / SB items — only where the parent doc is in an upcoming-PO state.
		frappe.db.sql(
			"""
			UPDATE "tabProcurement Request Item Detail" t
			SET billing_status = %(status)s
			WHERE t.item_id = %(item)s
			  AND (
			        (t.parenttype = 'Procurement Requests' AND EXISTS (
			            SELECT 1 FROM "tabProcurement Requests" pr
			            WHERE pr.name = t.parent AND pr.workflow_state IN %(pr_states)s))
			     OR (t.parenttype = 'Sent Back Category' AND EXISTS (
			            SELECT 1 FROM "tabSent Back Category" sb
			            WHERE sb.name = t.parent AND sb.workflow_state IN %(sb_states)s))
			  )
			""",
			{
				"status": new_status,
				"item": self.name,
				"pr_states": self._PR_UPCOMING_PO_STATES,
				"sb_states": self._SB_UPCOMING_PO_STATES,
			},
		)

		# 3) Recompute the PO-level rollup for any PO that contains this item.
		frappe.db.sql(
			"""
			UPDATE "tabProcurement Orders" po
			SET billing_status = CASE
				WHEN EXISTS (SELECT 1 FROM "tabPurchase Order Item" it
							 WHERE it.parent = po.name AND it.billing_status = 'Billable') THEN 'Billable'
				WHEN EXISTS (SELECT 1 FROM "tabPurchase Order Item" it
							 WHERE it.parent = po.name) THEN 'Non-Billable'
				ELSE ''
			END
			WHERE po.name IN (
				SELECT DISTINCT parent FROM "tabPurchase Order Item" WHERE item_id = %s
			)
			""",
			(self.name,),
		)
