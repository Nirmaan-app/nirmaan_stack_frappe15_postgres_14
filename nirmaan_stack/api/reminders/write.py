# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Reminders — WRITE endpoints (complete / reopen a raised reminder instance, rename a schedule).

The accountant acts on a `Reminder Schedule Log` (the per-cycle instance). Plain
`Nirmaan Accountant` has READ-ONLY DocPerm on the log, so these run with
`ignore_permissions=True` — but ONLY AFTER a role-profile scope check: an accountant can
complete a reminder only if its schedule targets their own role profile (the SAME gate as
the read endpoints, via `_my_schedule_names`). Nothing is ever deleted — completion is a
status flip; the log is a permanent audit row. `ReminderScheduleLog.validate` stamps /
clears `completed_by` + `completed_at` on the status change.

`rename_reminder` is the SCHEDULE-level write (see its docstring for why a plain
`updateDoc({title})` cannot work); it is gated on the same role profiles that own the
Edit affordance, resolved from `Nirmaan Users.role_profile` exactly like `read.py` does.
"""

import frappe
from frappe import _

from nirmaan_stack.api.reminders.read import _my_schedule_names

# Role profiles allowed to RENAME a schedule — deliberately NARROWER than the page's
# `canCreate` set (which also has PMO Executive + Accountant Lead behind the Add/Edit
# buttons): a rename moves the primary key, so it is Admin-only.
# Resolved from `Nirmaan Users.role_profile`, NOT `frappe.get_roles` — the reminders
# module scopes on the PROFILE everywhere else, and the two name spaces differ (the
# DocPerm role is "Nirmaan Accountant Lead", the profile is "... Lead Profile").
REMINDER_EDITOR_PROFILES = frozenset({
	"Nirmaan Admin Profile",
})


def _require_reminder_editor():
	"""Throw unless the caller may edit a Reminder Schedule (Administrator or an editor profile)."""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)
	if user == "Administrator":
		return
	profile = frappe.db.get_value("Nirmaan Users", {"email": user}, "role_profile")
	if profile not in REMINDER_EDITOR_PROFILES:
		frappe.throw(_("Not permitted"), frappe.PermissionError)


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


@frappe.whitelist(methods=["POST"])
def rename_reminder(name, new_title):
	"""Rename a `Reminder Schedule` — the ONLY way its title can actually change.

	`Reminder Schedule` is autonamed ``field:title``, so the document NAME *is* the title,
	and Frappe's ``BaseDocument._sync_autoname_field`` force-copies name -> title on EVERY
	save. A plain ``updateDoc({"title": ...})`` is therefore silently reverted during
	validation: the save succeeds, the title snaps back, nothing is renamed. Only
	``rename_doc`` moves the name, and it then writes the new value into the title field
	itself (``rename_doc.update_autoname_field``).

	Renaming is SAFE with linked history: ``rename_doc`` repoints every Link field, so
	each ``Reminder Schedule Log.reminder_schedule`` follows to the new name and no audit
	row is orphaned. Returns ``{"name": <new name>, "renamed": bool}``.
	"""
	_require_reminder_editor()

	name = (name or "").strip()
	new_title = (new_title or "").strip()

	if not name:
		frappe.throw(_("name is required."))
	if not new_title:
		frappe.throw(_("Title is required."))
	if not frappe.db.exists("Reminder Schedule", name):
		frappe.throw(_("Reminder not found."), frappe.DoesNotExistError)

	# No-op rename: report it honestly instead of round-tripping the whole link rewrite.
	if new_title == name:
		return {"name": name, "renamed": False}

	# Guard BEFORE rename_doc so the caller gets a plain message rather than a
	# DuplicateEntryError traceback (rename_doc would otherwise merge-or-throw).
	if frappe.db.exists("Reminder Schedule", new_title):
		frappe.throw(_("A reminder named “{0}” already exists.").format(new_title))

	# Import the MODULE-level rename_doc, not the `frappe.rename_doc` wrapper — the wrapper
	# does not expose `ignore_permissions`, and we need it: the gate above is on the role
	# PROFILE, while DocPerm is keyed on ROLE names that do not match one-for-one (profile
	# "Nirmaan Accountant Lead Profile" vs role "Nirmaan Accountant Lead"). Same
	# gate-then-bypass pattern the rest of this module uses.
	from frappe.model.rename_doc import rename_doc

	new_name = rename_doc(
		doctype="Reminder Schedule",
		old=name,
		new=new_title,
		ignore_permissions=True,
		show_alert=False,  # this is an API call, not a Desk action — no server-side toast
	)
	frappe.db.commit()

	return {"name": new_name, "renamed": True}
