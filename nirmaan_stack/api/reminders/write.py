# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Reminders — WRITE endpoints (complete / reopen a raised reminder instance).

The accountant acts on a `Reminder Schedule Log` (the per-cycle instance). Plain
`Nirmaan Accountant` has READ-ONLY DocPerm on the log, so these run with
`ignore_permissions=True` — but ONLY AFTER a role-profile scope check: an accountant can
complete a reminder only if its schedule targets their own role profile (the SAME gate as
the read endpoints, via `_my_schedule_names`). Nothing is ever deleted — completion is a
status flip; the log is a permanent audit row. `ReminderScheduleLog.validate` stamps /
clears `completed_by` + `completed_at` on the status change.
"""

import frappe
from frappe import _

from nirmaan_stack.api.reminders.read import _my_schedule_names


@frappe.whitelist(methods=["POST"])
def mark_reminder_done(log, remarks=None):
	"""Flip a reminder instance Pending → Done (+ optional completion remarks)."""
	return _set_status(log, "Done", remarks)


@frappe.whitelist(methods=["POST"])
def reopen_reminder(log):
	"""Undo a completion: flip Done → Pending (validate clears the completion stamps)."""
	return _set_status(log, "Pending", None)


def _set_status(log_name, status, remarks):
	if not log_name:
		frappe.throw(_("log is required."))

	schedule = frappe.db.get_value("Reminder Schedule Log", log_name, "reminder_schedule")
	if not schedule:
		frappe.throw(_("Reminder not found."), frappe.DoesNotExistError)

	# Scope gate: the log's schedule must target the caller's role profile.
	if schedule not in set(_my_schedule_names()):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	doc = frappe.get_doc("Reminder Schedule Log", log_name)
	doc.status = status
	if status == "Done" and remarks is not None:
		doc.remarks = remarks
	doc.save(ignore_permissions=True)  # validate() stamps/clears completed_by/at
	frappe.db.commit()

	return {
		"name": doc.name,
		"status": doc.status,
		"completed_by": doc.completed_by,
		"completed_at": doc.completed_at,
	}
