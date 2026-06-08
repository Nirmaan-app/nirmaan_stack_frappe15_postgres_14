# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import time

import frappe
from frappe.model.document import Document
from psycopg2.errors import SerializationFailure

from nirmaan_stack.api.milestone.project_schedule import sync_schedules_for_header

_WEEK_FIELDS = tuple(f"week_{i}" for i in range(1, 10))


class WorkMilestones(Document):
	# Parent fieldname -> child column on `Work Milestone Dependency`.
	# `fetch_from` runs only at child-row save time, so changes here would
	# leave these denormalized columns stale on every dependency row pointing
	# at this milestone. The `on_update` hook below mirrors them.
	# Add a new entry here whenever another field gets denormalized downstream.
	_DEPENDENCY_DENORMALIZED_FIELDS = {
		"work_milestone_name": "milestone_name",
		"work_milestone_order": "dependent_milestone_order",
	}

	def validate(self):
		self._validate_dependent_milestones()
		self._validate_critical_po_dependencies()

	def after_insert(self):
		# Flow 1: a brand-new milestone needs to land in every Project Schedule
		# whose Work Header is enabled. The reconcile inside
		# sync_project_schedule will detect the missing row and append it
		# with formula-derived dates against the project's window.
		if self.work_header:
			sync_schedules_for_header(self.work_header)

	def on_update(self):
		self._sync_dependency_denormalized_fields()
		self._sync_project_schedules_on_week_change()

	def _sync_dependency_denormalized_fields(self):
		# Detect previous-vs-current changes on the fields that flow into
		# Work Milestone Dependency child rows; refresh only what changed.
		changed = {
			child_col: self.get(parent_field)
			for parent_field, child_col in self._DEPENDENCY_DENORMALIZED_FIELDS.items()
			if self.has_value_changed(parent_field)
		}
		if not changed:
			return

		set_clause = ", ".join(f"{col} = %s" for col in changed)
		params = tuple(changed.values()) + (self.name,)
		sql = (
			f'UPDATE "tabWork Milestone Dependency" '
			f'SET {set_clause} '
			f'WHERE dependent_milestone = %s'
		)

		# Concurrent saves during a bulk milestone reorder can collide on the
		# same `tabWork Milestone Dependency` row (Frappe's child-table write
		# in one tx + this UPDATE in another). Wrap in a savepoint so a
		# serialization conflict on the dependency sync doesn't fail the
		# milestone save itself; retry once, then log and accept eventual
		# consistency (next save of any affected milestone will re-sync).
		for attempt in range(2):
			save_point = f"wm_dep_sync_{attempt}"
			try:
				frappe.db.savepoint(save_point)
				frappe.db.sql(sql, params)
				frappe.db.release_savepoint(save_point)
				return
			except SerializationFailure:
				frappe.db.rollback(save_point=save_point)
				if attempt == 1:
					frappe.log_error(
						title="Work Milestone Dependency Sync",
						message=(
							f"Concurrent-update conflict syncing dependency rows "
							f"for {self.name} after retry; will re-sync on next save."
						),
					)
					return
				time.sleep(0.05)

	def _sync_project_schedules_on_week_change(self):
		# Flow 3: if the week % anchors moved, fan out to every Project
		# Schedule that has a row for this milestone so its formula
		# start/end dates are recomputed. Rows flagged `changed_by_user = 1`
		# are preserved by the reconcile function downstream — manual
		# overrides stay frozen.
		if not self.work_header:
			return
		if not any(self.has_value_changed(f) for f in _WEEK_FIELDS):
			return
		sync_schedules_for_header(self.work_header)

	def _validate_dependent_milestones(self):
		seen = set()
		for row in self.get("dependent_milestones") or []:
			if not row.dependent_milestone:
				continue
			if row.dependent_milestone == self.name:
				frappe.throw(
					f"A milestone cannot depend on itself ({self.name}).",
					title="Invalid Dependency",
				)
			if row.dependent_milestone in seen:
				frappe.throw(
					f"Duplicate dependency: {row.dependent_milestone}.",
					title="Duplicate Dependency",
				)
			seen.add(row.dependent_milestone)

	def _validate_critical_po_dependencies(self):
		seen = set()
		for row in self.get("critical_po_dependencies") or []:
			if not row.critical_po_item:
				continue
			if row.critical_po_item in seen:
				frappe.throw(
					f"Duplicate Critical PO Item: {row.critical_po_item}.",
					title="Duplicate Critical PO Dependency",
				)
			seen.add(row.critical_po_item)

			pct = row.delivery_percentage or 0
			if pct < 0 or pct > 100:
				frappe.throw(
					f"Delivery % for {row.critical_po_item} must be between 0 and 100 (got {pct}).",
					title="Invalid Delivery %",
				)
