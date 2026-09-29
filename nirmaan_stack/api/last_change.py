"""Who changed a record since the user opened it -- the words of the "refresh and try again" message.

A save refused as stale (the screen's loaded `modified` no longer matches) says only that the
record changed. This names who changed it and when, so the user knows whose work they are about
to see. ONE wording for every caller: the screens fetch it through `get_stale_message`, and the
bulk approve engines (`api/payments/bulk_actions.py`) build their failure reason with
`stale_message`.
"""

import frappe
from frappe.utils import get_datetime

STALE_FALLBACK = "Someone else changed this record after you opened it. Refresh and try again."


@frappe.whitelist()
def get_stale_message(doctype: str, name: str) -> str:
	"""The message for a save of `doctype`/`name` that was just refused as stale."""
	frappe.has_permission(doctype, "read", doc=name, throw=True)
	row = frappe.db.get_value(doctype, name, ["modified_by", "modified"], as_dict=True)
	return stale_message(row.modified_by, row.modified) if row else STALE_FALLBACK


def stale_message(modified_by: str | None, modified) -> str:
	"""Name the last saver and the time. The caller's own login = another tab or window of theirs."""
	if not modified_by:
		return STALE_FALLBACK
	at = f" at {get_datetime(modified).strftime('%d %b, %I:%M %p')}" if modified else ""
	if modified_by == frappe.session.user:
		return f"You already changed this record{at}, in another tab or window. Refresh and try again."
	return f"{_display_name(modified_by)} changed this record{at}, after you opened it. Refresh and try again."


def _display_name(user: str) -> str:
	"""Nirmaan Users first (the name the app shows), then User, then the login itself."""
	if user == "Administrator":
		return "Administrator"
	return (
		frappe.db.get_value("Nirmaan Users", user, "full_name")
		or frappe.db.get_value("User", user, "full_name")
		or user
	)
