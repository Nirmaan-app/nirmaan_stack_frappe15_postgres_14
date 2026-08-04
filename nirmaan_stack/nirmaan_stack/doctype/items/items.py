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

		self._validate_linked_tds_item()

	def _validate_linked_tds_item(self):
		"""Hard-enforce the ADR-0004 work-package invariant on `linked_tds_item`.

		An item may only belong to a TDS group in its OWN work package. The item's
		WP is derived `Items.category -> Category.work_package`; the group's is
		`TDS Items.work_package`.

		This runs behind a UI that already filters the dropdown to matching-WP
		groups, so a throw here means either a non-UI writer or stale data — both
		worth failing loudly on. It is deliberately a `validate` (not a
		`before_save`) so it also guards a bare `doc.save()` from a console.

		NOTE for migrations: `frappe.db.set_value` bypasses this entirely. Any
		patch that backfills `linked_tds_item` must re-implement the check itself
		(see `patches/v3_0/backfill_item_linked_tds_item.py`), or it will plant
		links that make the item unsaveable the next time anyone edits it.
		"""
		if not self.linked_tds_item:
			return

		item_wp = None
		if self.category:
			item_wp = frappe.db.get_value("Category", self.category, "work_package")

		if not item_wp:
			frappe.throw(
				frappe._(
					"Cannot link a TDS Item: product '{0}' has no resolvable work package "
					"(its category '{1}' does not map to one). Set a category with a work "
					"package first."
				).format(self.item_name or self.name, self.category or "—")
			)

		group_wp = frappe.db.get_value("TDS Items", self.linked_tds_item, "work_package")
		if item_wp != group_wp:
			frappe.throw(
				frappe._(
					"Work package mismatch: product '{0}' is in '{1}', but TDS Item '{2}' "
					"is in '{3}'. An item can only be linked to a TDS group in its own "
					"work package."
				).format(
					self.item_name or self.name,
					item_wp,
					self.linked_tds_item,
					group_wp or "—",
				)
			)

	def before_insert(self):
		# Set default values if not provided
		if not self.item_status:
			self.item_status = "Active"
		if not self.billing_category:
			self.billing_category = "Billable"
		if not self.order_category:
			self.order_category = "Local"

	def on_update(self):
		"""Propagate a billing_category change onto dependent PR / SB / PO line items."""
		old_doc = self.get_doc_before_save()
		if not old_doc:
			return

		self._propagate_billing_status(old_doc)

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
	# HISTORY (ADR-0004): `on_update` used to also sync item_name/category into
	# `TDS Repository` rows via a `tds_item_id` filter. The 3-level restructure had
	# already removed those columns from the doctype JSON, but Frappe never dropped
	# them from PostgreSQL — so the block kept running against orphan columns, and a
	# trailing NOTE claimed it had been deleted when it had not. It is now genuinely
	# gone, and `patches/v3_0/backfill_item_linked_tds_item.py` drops the columns.
	#
	# ORDERING: that column drop and this deletion must ship together. Drop the
	# columns while the block is live and every item rename throws.


def on_doctype_update():
	# ADR-0004 made `Items.linked_tds_item` the SOLE membership store, so it is
	# filtered by every membership read in the app -- members.get_tds_item_members
	# / get_tds_member_index / get_group_category, tds_report._enrich_model_no,
	# picker.search_tds_items, and the `members` display-mirror rebuild. Measured
	# without this index: Seq Scan discarding 3,528 of 3,536 rows per lookup, and
	# it degrades as the catalog grows.
	# Idempotent: add_index no-ops if the index already exists.
	frappe.db.add_index("Items", ["linked_tds_item"])
