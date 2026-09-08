# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries
from datetime import datetime, timedelta

from frappe.utils import flt, getdate, today
from nirmaan_stack.api.milestone.project_schedule import sync_project_schedule
from nirmaan_stack.constants.authorized_users import (
	CEO_AUTHORIZED_USER as CEO_HOLD_AUTHORIZED_USER,
	CEO_HOLD_SYSTEM_USER,
)
from nirmaan_stack.services.ceo_hold.core import RECHECK_EXCLUDED_STATUSES

class Projects(Document):
	def validate(self):
		# Order matters: the recheck validator NORMALISES the two schedule fields (and
		# proves a newly-set schedule is legitimate), and `_validate_ceo_hold_status` then
		# reads the normalised flag to decide whether the FORK-9 reason guard applies.
		self._validate_ceo_hold_recheck()
		self._validate_ceo_hold_status()
		self._validate_manual_project_value()

	def _validate_manual_project_value(self):
		"""Manual mode claims a human typed the value, so it must actually carry one.

		Without this a project saves with `manual_project_value = 1` and a blank/zero value:
		before_save then skips PO aggregation for it, so no Customer PO can ever repair the 0.
		The PO-driven path (flag 0) is untouched — it is derived and may legitimately be 0.
		"""
		if not self.get("manual_project_value"):
			return

		if flt(self.project_value) <= 0 or flt(self.project_value_gst) <= 0:
			frappe.throw(
				"Enter both Project Value (excl. GST) and Project Value (incl. GST) when the value is "
				"entered manually, or untick 'Enter project value manually' to derive them from Customer POs.",
				title="Missing Project Value",
			)

	def _validate_ceo_hold_status(self):
		"""Enforce CEO Hold access rules:
		1. Only CEO_HOLD_AUTHORIZED_USER can set status to 'CEO Hold'
		2. Only the user who set CEO Hold can revert it
		3. Auto-manage the ceo_hold_by field
		"""
		old_doc = self.get_doc_before_save()
		if not old_doc:
			if self.status == "CEO Hold":
				if frappe.session.user != CEO_HOLD_AUTHORIZED_USER:
					frappe.throw(
						"Only the authorized user can set a project to CEO Hold.",
						frappe.PermissionError
					)
				self.ceo_hold_by = frappe.session.user
			return

		old_status = old_doc.status
		new_status = self.status

		if old_status == new_status:
			return

		# Setting TO CEO Hold
		if new_status == "CEO Hold":
			if frappe.session.user != CEO_HOLD_AUTHORIZED_USER:
				frappe.throw(
					"Only the authorized user can set a project to CEO Hold.",
					frappe.PermissionError
				)
			self.ceo_hold_by = frappe.session.user

		# Changing FROM CEO Hold
		elif old_status == "CEO Hold":
			# Block ANY manual release while an automatic (system) condition still
			# holds this project — the reason rows are the source of truth and clear
			# themselves when the underlying condition is resolved (ADR-0004 FORK 9).
			# recompute's auto-release uses set_value (bypasses validate), so it is
			# unaffected by this guard.
			#
			# THE ONE EXEMPTION is a SCHEDULED RECHECK: the authorized user releases now
			# and names a date for the system to re-run the very same evaluation. That is
			# deliberately a release WITHOUT the reason being resolved, so the guard has to
			# stand down — but only after `_validate_ceo_hold_recheck` (which ran first) has
			# proved the flag: authorized user, released from CEO Hold, non-past date
			# present. It also cleared the flag for Completed / Halted, so a terminal move
			# still hits this guard exactly as before.
			if not self.ceo_hold_recheck_scheduled:
				active = frappe.get_all(
					"CEO Hold Reason",
					filters={"project": self.name},
					fields=["reason_text"],
					limit_page_length=0,
				)
				if active:
					texts = ", ".join(r.reason_text for r in active if r.reason_text) or "active system conditions"
					frappe.throw(
						f"Cannot release CEO Hold while it is held by: {texts}. "
						"These clear automatically when the underlying conditions are resolved.",
						frappe.PermissionError,
					)

			# Cron-set holds (ceo_hold_by = CEO_HOLD_SYSTEM_USER) are clearable
			# by the authorized human, since no real user "owns" them.
			is_cron_set_hold = old_doc.ceo_hold_by == CEO_HOLD_SYSTEM_USER
			can_revert = (
				frappe.session.user == old_doc.ceo_hold_by
				or (is_cron_set_hold and frappe.session.user == CEO_HOLD_AUTHORIZED_USER)
			)
			if not can_revert:
				frappe.throw(
					"Only the user who placed this project on CEO Hold can remove it.",
					frappe.PermissionError
				)
			self.ceo_hold_by = None

	def _validate_ceo_hold_recheck(self):
		"""Server-side rules for the CEO Hold scheduled-recheck fields.

		The authorized user may release a CEO Hold WITHOUT resolving its reasons by naming
		the date on which the system should re-run the SAME evaluation. Between the release
		and that date the project sits in "scheduled-recheck mode": every Payment / Inflow /
		DN hook skips the CEO Hold decision (`services/ceo_hold/core.is_recheck_scheduled`),
		so ONLY `tasks/ceo_hold_recheck.py` can put the hold back.

		This is the server-side half of the dialog — the frontend must not be the only thing
		enforcing it. Four rules, all of which the UI also applies:

		  1. `ceo_hold_recheck_scheduled` may be turned ON only by the authorized user, and
		     only in the SAME save that moves the project OFF CEO Hold. That coupling is
		     what makes "status changed but the schedule was not saved" unrepresentable —
		     the flag is also the key that unlocks the FORK-9 reason guard, so a release
		     that drops the schedule is rejected outright rather than silently half-applied.
		  2. A schedule with no date is rejected (the date is mandatory).
		  3. A date in the past is rejected when the schedule is created or its date moved —
		     but NOT on later unrelated saves, or an overdue schedule (cron not yet run)
		     would start failing every edit of the project.
		  4. CEO Hold / Completed / Halted can never CARRY a schedule. Normalising instead
		     of throwing is deliberate: it is how a manual re-hold, or a move to a terminal
		     status, returns the project to normal evaluation mode in one save. This is the
		     validate-side half of the terminal-project protection; the cron holds the other
		     half for schedules that go stale without a save.
		"""
		old_doc = self.get_doc_before_save()

		# (4) Excluded statuses never carry a schedule.
		if self.status in RECHECK_EXCLUDED_STATUSES:
			self.ceo_hold_recheck_scheduled = 0
			self.ceo_hold_recheck_date = None
			return

		if not self.ceo_hold_recheck_scheduled:
			self.ceo_hold_recheck_date = None  # flag off → never leave an orphan date
			return

		newly_scheduled = not (old_doc and old_doc.ceo_hold_recheck_scheduled)

		# (1) Who may schedule, and from where.
		if newly_scheduled:
			if frappe.session.user != CEO_HOLD_AUTHORIZED_USER:
				frappe.throw(
					"Only the authorized user can schedule a CEO Hold recheck.",
					frappe.PermissionError,
				)
			if not (old_doc and old_doc.status == "CEO Hold"):
				frappe.throw(
					"A CEO Hold recheck can only be scheduled while releasing a project that "
					"is currently on CEO Hold.",
					title="Not On CEO Hold",
				)

		# (2) The date is mandatory.
		if not self.ceo_hold_recheck_date:
			frappe.throw(
				"Select the date on which the CEO Hold conditions should be checked again.",
				title="Recheck Date Required",
			)

		# (3) No past dates on create / change.
		date_changed = not old_doc or str(old_doc.ceo_hold_recheck_date or "") != str(
			self.ceo_hold_recheck_date or ""
		)
		if (newly_scheduled or date_changed) and getdate(self.ceo_hold_recheck_date) < getdate(today()):
			frappe.throw(
				"The CEO Hold Recheck Date cannot be in the past.",
				title="Invalid Recheck Date",
			)

	def before_save(self):
		# Project value has two modes, decided by the `manual_project_value` flag:
		#   manual_project_value = 1 -> the values were entered by a human; leave them alone.
		#   manual_project_value = 0 -> derive them from the Customer PO rows (default; unchanged
		#                               from the historical behaviour, including zeroing on an empty list).
		if not self.get("manual_project_value"):
			self.project_value = sum(flt(d.customer_po_value_exctax) for d in self.get("customer_po_details", []))
			self.project_value_gst = sum(flt(d.customer_po_value_inctax) for d in self.get("customer_po_details", []))
		#self.project_duration = (datetime.strptime(self.project_end_date, '%Y-%m-%d %H:%M:%S') - datetime.strptime(self.project_start_date, '%Y-%m-%d %H:%M:%S')).days or 0
		# self.project_city = self.get_project_address()["city"] or ""
		# self.project_state = self.get_project_address()["state"] or ""
		pass
	def autoname(self):
		city = f"{self.project_city}".replace(" ", "_")
		prefix = "PROJ-"
		self.name = f"{city}-{prefix}{getseries(prefix, 5)}"
	
def on_update(doc, method=None):
	old_doc = doc.get_doc_before_save()

	# Handle customer change - propagate to related documents
	if doc and doc.customer and old_doc and old_doc.customer and doc.customer != old_doc.customer:
		inflow_payments = frappe.db.get_all("Project Inflows", filters={"project": doc.name}, fields={"name", "customer"})
		for inflow in inflow_payments:
			inflow_doc = frappe.get_doc("Project Inflows", inflow.name)
			inflow_doc.customer = doc.customer
			inflow_doc.save(ignore_permissions=True)
		project_invoices = frappe.db.get_all("Project Invoices", filters={"project": doc.name}, fields={"name", "customer"})
		for inflow in project_invoices:
			inflow_doc = frappe.get_doc("Project Invoices", inflow.name)
			inflow_doc.customer = doc.customer
			inflow_doc.save(ignore_permissions=True)

	# Handle project_start_date change - recalculate Critical PO Task deadlines
	if doc.has_value_changed('project_start_date') and doc.project_start_date:
		recalculate_critical_po_deadlines(doc.name, doc.project_start_date)

	# Project Schedule sync — only re-run when the project window changes, so
	# every (non-overridden) milestone's start_date / end_date is recomputed
	# against the new window. Manual overrides (changed_by_user = 1) stay
	# frozen. Header enable/disable goes through the Setup Progress Tracking
	# wizard, which calls `ensure_project_schedule` directly, so we don't need
	# to also trigger from on_update here.
	if doc.has_value_changed('project_start_date') or doc.has_value_changed('project_end_date'):
		sync_project_schedule(doc, method)

	# Realtime CEO Hold re-check when the gap limit drops (or is first set).
	if doc.has_value_changed('cashflow_gap_limit'):
		from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import trigger_check
		trigger_check(doc.name)


def recalculate_critical_po_deadlines(project_name, project_start_date):
	"""
	Recalculates po_release_date for all Critical PO Tasks when project_start_date changes.

	Formula: po_release_date = project_start_date + release_timeline_offset (days)

	The release_timeline_offset is fetched from the matching Critical PO Items master record
	by matching critical_po_category, item_name, and sub_category.
	"""
	# Parse project_start_date (handles both date and datetime formats)
	if isinstance(project_start_date, str):
		try:
			start_date = datetime.strptime(project_start_date, "%Y-%m-%d %H:%M:%S").date()
		except ValueError:
			start_date = datetime.strptime(project_start_date, "%Y-%m-%d").date()
	else:
		start_date = project_start_date

	# Get all Critical PO Tasks for this project
	critical_po_tasks = frappe.db.get_all(
		"Critical PO Tasks",
		filters={"project": project_name},
		fields=["name", "critical_po_category", "item_name", "sub_category"]
	)

	if not critical_po_tasks:
		return

	# Build a lookup map from Critical PO Items master for efficient matching
	critical_po_items = frappe.db.get_all(
		"Critical PO Items",
		fields=["critical_po_category", "item_name", "sub_category", "release_timeline_offset"]
	)

	# Create lookup key: (category, item_name, sub_category) -> offset
	offset_map = {}
	for item in critical_po_items:
		key = (
			item.get("critical_po_category") or "",
			item.get("item_name") or "",
			item.get("sub_category") or ""
		)
		offset_map[key] = item.get("release_timeline_offset") or 0

	# Update each Critical PO Task
	updated_count = 0
	for task in critical_po_tasks:
		key = (
			task.get("critical_po_category") or "",
			task.get("item_name") or "",
			task.get("sub_category") or ""
		)

		offset_days = offset_map.get(key)

		if offset_days is not None:
			new_release_date = start_date + timedelta(days=offset_days)

			frappe.db.set_value(
				"Critical PO Tasks",
				task["name"],
				"po_release_date",
				new_release_date.strftime("%Y-%m-%d"),
				update_modified=False
			)
			updated_count += 1

	if updated_count > 0:
		frappe.db.commit()
		frappe.msgprint(
			f"Updated PO Release Deadline for {updated_count} Critical PO Task(s) based on new project start date.",
			alert=True
		)


		
