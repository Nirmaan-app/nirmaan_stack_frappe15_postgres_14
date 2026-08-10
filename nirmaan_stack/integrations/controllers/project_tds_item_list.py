import frappe

from nirmaan_stack.api.tds.members import get_group_category


def before_save(doc, method=None):
	"""Snapshot `tds_category` onto a Project TDS Item List row from its linked
	TDS Item group's member categories.

	Why this hook exists (TDS 3-level restructure, ADR-0003):
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
	  * approval converting a custom "New" request into a resolved/created group
	    (`approve.py` sets `tds_item_id` then `row.save()`) → re-derive.
	  Reject and plain status changes do NOT touch `tds_item_id`, so this is a
	  no-op for them — bulk Reject/Approve-Pending never alter category.

	Skips (leaves the field as-is):
	  * no group yet (custom "New" with blank `tds_item_id`) → filled later when
	    a group is resolved on approval;
	  * a legacy / CUS- / PCUS- id that does not resolve to a `TDS Items` group →
	    preserve the frozen legacy snapshot.

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
