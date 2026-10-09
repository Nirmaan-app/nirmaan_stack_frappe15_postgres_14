import frappe
from frappe import _

from nirmaan_stack.api.tds.members import get_group_category


def before_save(doc, method=None):
	"""Snapshot `tds_category` onto a Project TDS Item List row from its linked
	TDS Item group's member categories.

	Why this hook exists (TDS 3-level restructure, ADR-0025):
	  After the restructure, category is no longer chosen at request time and is
	  no longer stored on `TDS Repository`. The authoritative origin is
	  `Items.category`, surfaced (derived) on the `TDS Items` group's member child
	  rows. A project submittal must FREEZE that category at submission time
	  alongside `tds_item_name` / `tds_make` / `tds_work_package`, so the signed
	  PDF stays historically accurate even if the master item is recategorized
	  later. That frozen copy lives on `Project TDS Item List.tds_category`.

	Snapshot semantics — refresh ONLY when the row's TDS Item changes:
	  * create (is_new) → fill from the picked/resolved group;
	  * edit re-pick → re-derive from the newly chosen group (fixes the stale
	    value the edit modal otherwise preserves);
	  Reject and plain status changes do NOT touch `tds_item_id`, so this is a
	  no-op for them — bulk Reject/Approve-Pending never alter category.

	Skips (leaves the field as-is):
	  * a blank `tds_item_id` (legacy rows only);
	  * a legacy / CUS- / PCUS- id that does not resolve to a `TDS Items` group →
	    preserve the frozen snapshot. A Project Custom row (`PCUS-`) keeps the
	    Category its requester chose (`api/tds/submit.py`).

	Defensive: any failure is logged and swallowed so it can never break a save
	or a bulk approval batch.
	"""
	try:
		if not (doc.is_new() or doc.has_value_changed("tds_item_id")):
			return

		group = (doc.tds_item_id or "").strip()
		if not group:
			return  # custom "New" with no group yet, or cleared id

		if not frappe.db.exists("TDS Items", group):
			return  # legacy / CUS- / PCUS- id → keep frozen snapshot

		doc.tds_category = get_group_category(group)
	except Exception:
		frappe.log_error(
			title="ProjectTDSItemList before_save tds_category snapshot failed",
			message=frappe.get_traceback(),
		)


def on_trash(doc, method=None):
	"""Refuse to delete a row the client has answered, whoever asks and however (#1387).

	A row with a Client Status is a datasheet the client has signed off or turned down, so it stays
	until an Admin clears that answer through `api/tds/client_status.set_client_status`. The
	replace-on-resubmit and edit paths delete only Admin-Rejected rows, which never carry a Client
	Status (it needs `tds_status = Approved`), so they pass. A raw `frappe.db.delete` skips this hook.
	"""
	if doc.client_status:
		frappe.throw(
			_(
				"{0} is marked {1}, so it can't be deleted. An Admin must clear its Client Status first."
			).format(doc.tds_item_name or doc.name, doc.client_status)
		)
