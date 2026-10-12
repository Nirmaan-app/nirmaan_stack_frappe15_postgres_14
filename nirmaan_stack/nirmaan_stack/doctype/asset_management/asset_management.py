# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from nirmaan_stack.services.asset_department import department_move, reason_refusal


class AssetManagement(Document):
	def validate(self):
		if self.is_new():
			self.check_not_already_assigned()
			self.decide_department_move()

	def check_not_already_assigned(self):
		"""One current assignment per asset.

		Locking the asset row first makes two people assigning the same asset at once take turns, so
		the second one sees the first assignment and is refused.
		"""
		frappe.db.get_value("Asset Master", self.asset, "name", for_update=True)
		holder = frappe.db.get_value(
			"Asset Management", {"asset": self.asset, "name": ["!=", self.name]}, "asset_assigned_to"
		)
		if holder:
			holder_name = frappe.db.get_value("Nirmaan Users", holder, "full_name") or holder
			frappe.throw(f"{self.asset} is already assigned to {holder_name}. Unassign it first.")

	def decide_department_move(self):
		"""Assigning to someone in another department moves the asset there, with a reason.

		The reason is not stored on the assignment (owner, 2026-10-12): it arrives on
		`flags.department_change_reason` from `api/assets/assign.assign_asset` and is kept only in the
		asset's history. The decision goes on `flags.department_move` (+ `flags.department_reason`)
		for the after_insert hook, which moves the asset and writes the history row. A reason sent
		when nothing moves is dropped.
		"""
		asset_department = frappe.db.get_value("Asset Master", self.asset, "department")
		person_department = frappe.db.get_value("Nirmaan Users", self.asset_assigned_to, "department")
		move = department_move(asset_department, person_department)

		reason = self.flags.department_change_reason
		refusal = reason_refusal(move, reason)
		if refusal:
			frappe.throw(refusal)

		self.flags.department_move = move
		self.flags.department_reason = (reason or "").strip() if move and move[0] else None
