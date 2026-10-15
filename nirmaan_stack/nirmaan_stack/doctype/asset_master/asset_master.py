# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.model.naming import make_autoname
from frappe.utils import get_datetime

from nirmaan_stack.services.asset_department import can_edit_asset_department
from nirmaan_stack.services.asset_project import check_asset_project
from nirmaan_stack.services.departments import assert_active_department

HISTORY_COMPARED_FIELDS = (
	"event", "assigned_to", "done_by", "declaration", "from_department", "to_department", "reason",
)


class AssetMaster(Document):
	def validate(self):
		self.clear_location_when_project_removed()
		self.check_project()
		self.check_department()
		self.keep_history_unchanged()

	def check_project(self):
		"""A Won project, on a Project asset only (owner, 2026-10-15; `services/asset_project`). Only when the
		project changes, so an asset booked earlier to a project that is no longer Won still saves."""
		if self.is_new() or self.has_value_changed("project"):
			check_asset_project(self.asset_category, self.project)

	def check_department(self):
		"""A new asset needs a department; afterwards Edit may only fill or fix it, never clear it
		(owner, 2026-10-12).

		Once the asset has been assigned, its department moves only through an assignment with a
		reason (the Asset Management hook, which bypasses this validate), so every real move is in the
		asset's history.
		"""
		if self.is_new():
			if not self.department:
				frappe.throw("Choose the department this asset belongs to.")
			assert_active_department(self.department)
			return

		before = self.get_doc_before_save()
		if not before or (before.department or None) == (self.department or None):
			return
		if not self.department:
			frappe.throw("An asset must belong to a department. Choose another one instead of clearing it.")
		assert_active_department(self.department)
		has_been_assigned = bool(before.current_assignee) or any(
			row.event == "Assigned" for row in before.get("asset_history")
		)
		if not can_edit_asset_department(before.department, has_been_assigned):
			frappe.throw(
				"This asset has been assigned before, so its department changes only when you assign it "
				"to someone in another department and give a reason."
			)

	def keep_history_unchanged(self):
		"""The history is append-only: no save (Desk or API) may drop or alter an existing row.

		New rows are written by `services/asset_history.add_history` directly, not through this save.
		"""
		if self.is_new():
			return
		before = self.get_doc_before_save()
		if not before:
			return
		if _history_snapshot(before) != _history_snapshot(self):
			frappe.throw("Asset history can't be edited or deleted.")

	def clear_location_when_project_removed(self):
		"""
		asset_city / asset_state are fetch_from fields on `project`. Frappe only
		fetches when the link HAS a value, so clearing the project would otherwise
		leave the previous project's city/state stranded on the row.
		"""
		if not self.project:
			self.asset_city = None
			self.asset_state = None

	def autoname(self):
		"""
		Generate name in format: ASSET-<first 3 letters of category>-###
		Examples:
		- Laptop → ASSET-LAP-001
		- Mobile Phone → ASSET-MOB-001
		- Desktop Computer → ASSET-DES-001
		"""
		if not self.asset_category:
			frappe.throw("Asset Category is required for naming")

		# Get first 3 letters of category in uppercase
		category_prefix = self.asset_category[:3].upper()

		# Generate name with pattern: ASSET-XXX-.###
		self.name = make_autoname(f"ASSET-{category_prefix}-.###")


def _history_snapshot(doc) -> list[tuple]:
	"""The history rows as comparable values. A saved row's datetime and a posted row's string are
	normalised, so a Desk save that sends the rows back unchanged is not mistaken for an edit."""
	return [
		(
			row.name,
			get_datetime(row.done_on) if row.done_on else None,
			*((row.get(field) or None) for field in HISTORY_COMPARED_FIELDS),
		)
		for row in doc.get("asset_history")
	]
