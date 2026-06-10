import frappe


# ─────────────────────────────────────────────────────────────────────────────
# Why this module exists:
# `TDS Items Child Table` is an `istable` child doctype with NO DocPerm rows.
# Listing it through the permission-aware path (`frappe.client.get_list`, which
# `useFrappeGetDocList` calls) raises PermissionError for every NON-superuser —
# only the Administrator superuser sees rows. That made the TDS Repository master
# table show "Custom" (count 0) for every TDS Item, and emptied the derived
# Category facet, even though 402/413 items actually have members.
#
# These endpoints read the child rows with `frappe.get_all` (permission-ignoring)
# so any role with access to the TDS master page gets correct member data. This
# is the codebase's documented child-table pattern (custom API, not get_list).
# ─────────────────────────────────────────────────────────────────────────────

CHILD_DOCTYPE = "TDS Items Child Table"
PARENT_DOCTYPE = "TDS Items"


@frappe.whitelist()
def get_tds_member_index():
	"""Bucket all TDS Item member child rows in one call.

	Returns:
	    {
	        "counts": { "TDS-ITEM-00001": 2, ... },   # parent -> member count
	        "categories": ["Cables", "Switches", ...]  # distinct member categories
	    }

	The master "TDS Items" tab uses `counts` for the Linked Item SKU pill; the
	master "Repository Entries" tab uses `categories` for its derived facet.
	"""
	rows = frappe.get_all(
		CHILD_DOCTYPE,
		filters={"parenttype": PARENT_DOCTYPE},
		fields=["parent", "category"],
		limit_page_length=0,
	)

	counts = {}
	categories = set()
	for r in rows:
		if not r.parent:
			continue
		counts[r.parent] = counts.get(r.parent, 0) + 1
		if r.category:
			categories.add(r.category)

	return {"counts": counts, "categories": sorted(categories)}


@frappe.whitelist()
def get_tds_item_members(tds_item: str):
	"""Return the member Items SKUs of a single TDS Item (for the quick-peek
	dialog). Permission-ignoring read of the child rows, ordered by `idx`."""
	if not tds_item:
		return []

	return frappe.get_all(
		CHILD_DOCTYPE,
		filters={"parent": tds_item, "parenttype": PARENT_DOCTYPE},
		fields=["item", "item_name", "category"],
		order_by="idx asc",
		limit_page_length=0,
	)


def get_group_category(tds_item: str) -> str:
	"""Distinct member categories of a TDS Item group, joined by ", ".

	The single source of the "category of a group" rule. Reused by:
	  * the `Project TDS Item List` before_save hook — snapshots `tds_category`
	    onto a project submittal row (origin: `Items.category` → member rows).
	  * `api/tds/tds_report._enrich_model_no` — the PDF "Model No." cell.

	Returns "" for a falsy id or a member-less (custom) group. Permission-ignoring
	read (the child table is an `istable` with no DocPerm). Defensive: never
	raises — on any read error it returns "" so a (possibly bulk) save/approval is
	never broken by category derivation.
	"""
	if not tds_item:
		return ""
	try:
		rows = frappe.get_all(
			CHILD_DOCTYPE,
			filters={"parent": tds_item, "parenttype": PARENT_DOCTYPE},
			fields=["category"],
			order_by="idx asc",
			limit_page_length=0,
		)
	except Exception:
		frappe.log_error(
			title="get_group_category read failed",
			message=frappe.get_traceback(),
		)
		return ""

	seen = set()
	cats = []
	for r in rows:
		c = (r.category or "").strip()
		if c and c not in seen:
			seen.add(c)
			cats.append(c)
	return ", ".join(cats)
