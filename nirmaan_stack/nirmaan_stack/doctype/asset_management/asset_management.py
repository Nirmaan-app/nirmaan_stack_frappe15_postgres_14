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
		else:
			self.keep_asset_and_person()

	def keep_asset_and_person(self):
		"""An assignment is for one asset and one person for its whole life.

		The rules (one holder, the department move and its reason) and the "Assigned" history row run
		only when an assignment is created, so changing the person or the asset on an existing one in
		Desk or the API would hand the asset over with none of them -- and the new person would inherit
		the old one's signed declaration. Giving the asset to someone else is Unassign, then Assign.
		"""
		before = self.get_doc_before_save()
		if not before:
			return
		if before.asset != self.asset or before.asset_assigned_to != self.asset_assigned_to:
			frappe.throw(
				f"An assignment's asset and person can't be changed. To give {before.asset} to someone "
				"else, unassign it first, then assign it."
			)

	def check_not_already_assigned(self):
		"""One holder per asset: the asset's current holder decides, not any assignment row.

		Reading the holder with a row lock makes two people assigning the same asset at once take
		turns, so the second one sees the holder the first one set and is refused. An old leftover row
		for someone else (ASSET-LAP-029 had one) must not block a free asset, so the rows aren't asked.
		"""
		holder = frappe.db.get_value("Asset Master", self.asset, "current_assignee", for_update=True)
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
