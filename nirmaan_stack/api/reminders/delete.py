# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Reminders — DELETE endpoint (retire a `Reminder Schedule`).

Split out of `write.py`: that module owns the per-cycle instance writes (complete /
reopen) plus the rename, all of which MUTATE live state. Deleting a schedule is a
different kind of operation with its own history-preservation contract, so it gets its
own file.

The admin gate is IMPORTED from `write.py` rather than re-minted here — a permission
predicate must have exactly one home, or the two copies can drift and disagree about the
same user.
"""

import frappe
from frappe import _

from nirmaan_stack.api.reminders.write import _require_reminder_editor


@frappe.whitelist(methods=["POST"])
def delete_reminder(name):
	"""Hard-delete a `Reminder Schedule`. Its DONE history is KEPT; its PENDING rows go.

	`Reminder Schedule Log` rows are NOT child rows of the schedule — they are a separate
	doctype holding a Link — so `delete_doc` does not cascade into them. What happens to
	them is decided here, and the two statuses are treated differently ON PURPOSE
	(owner ruling):

	* ``Done`` — a record that someone completed this filing on this date. This is the
	  audit trail and is NEVER deleted.
	* ``Pending`` — an un-actioned to-do for a reminder that will no longer exist. Nothing
	  ever happened on it, so it is not audit; leaving it behind would strand a task nobody
	  can complete (its schedule is gone, so it fails scoping and cannot be marked done).
	  These are deleted with the schedule.

	Pending rows go through `delete_doc`, not a raw `db.delete`, so each one is archived
	into Frappe's `Deleted Document` and stays recoverable.

	Three deliberate mechanics:

	* ``force=1`` — Frappe refuses to delete a doc that is Linked elsewhere
	  (`LinkExistsError`), and `force` is the documented way past that check. Without it a
	  schedule could only ever be deleted before its first reminder was raised.
	* The title is re-stamped onto every one of its logs FIRST. `reminder_title` carries
	  ``fetch_from: reminder_schedule.title``, so Frappe already fills it at insert — this
	  is NOT the only copy. It is re-stamped because a fetched value is a SNAPSHOT taken at
	  the log's last save: a schedule renamed after its logs were raised leaves them holding
	  the old title, and once the master is gone there is nothing left to fetch from. The
	  write makes the surviving rows self-describing and current at the moment of deletion.

	⚠️ KNOWN CONSEQUENCE, accepted by the owner: the retained Done rows stop appearing in
	the Compliance History. `get_my_reminder_logs` scopes visible logs through the
	schedule's `Reminder Role Profile` CHILD rows, and those DO die with the master, so the
	surviving logs match no profile. They remain in the database, titled and queryable, but
	are no longer surfaced. Making them visible again needs a role-profile snapshot on the
	log plus a read-endpoint rework — deliberately not in this slice.

	Returns ``{"deleted": True, "name": <name>, "kept_done": N, "removed_pending": M}``.
	"""
	_require_reminder_editor()

	name = (name or "").strip()
	if not name:
		frappe.throw(_("name is required."))

	row = frappe.db.get_value("Reminder Schedule", name, ["title"], as_dict=True)
	if not row:
		frappe.throw(_("Reminder not found."), frappe.DoesNotExistError)

	# Pending rows first: they are the ones being removed, so they must not be counted as
	# kept history nor re-stamped. delete_doc (not db.delete) archives each into
	# `Deleted Document`, so an over-eager delete stays recoverable.
	pending = frappe.get_all(
		"Reminder Schedule Log",
		filters={"reminder_schedule": name, "status": "Pending"},
		pluck="name",
	)
	for log_name in pending:
		frappe.delete_doc(
			"Reminder Schedule Log", log_name, ignore_permissions=True, force=1
		)

	kept_done = frappe.db.count("Reminder Schedule Log", {"reminder_schedule": name})

	# Re-stamp BEFORE the delete: afterwards there is no master left to read a title from,
	# so a log still holding a pre-rename snapshot could never be corrected.
	# update_modified=False: stamping provenance is not a content edit by this user.
	if kept_done:
		frappe.db.set_value(
			"Reminder Schedule Log",
			{"reminder_schedule": name},
			"reminder_title",
			row.title or name,
			update_modified=False,
		)

	frappe.delete_doc(
		"Reminder Schedule",
		name,
		force=1,  # past the LinkExistsError raised by the surviving Done rows
		ignore_permissions=True,  # gated above on the role profile, like every endpoint here
	)
	frappe.db.commit()

	return {
		"deleted": True,
		"name": name,
		"kept_done": kept_done,
		"removed_pending": len(pending),
	}
