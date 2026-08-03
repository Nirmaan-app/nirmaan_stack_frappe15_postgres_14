import frappe


# ─────────────────────────────────────────────────────────────────────────────
# Why this module exists (membership is N:1, owned by the Item — ADR-0004):
#
# A TDS group's members are DERIVED live as `Items WHERE linked_tds_item =
# <group>`. There is no membership store to read besides `Items` itself — the
# `linked_tds_item` Link IS the store.
#
# HISTORY (why these endpoints exist as custom APIs at all): members used to
# live in `TDS Items Child Table`, an `istable` child doctype with NO DocPerm
# rows. Listing it through the permission-aware path (`frappe.client.get_list`,
# which `useFrappeGetDocList` calls) raised PermissionError for every
# NON-superuser, so the master table showed "Custom" (count 0) for every group
# and the derived Category facet came back empty. That specific trap is GONE —
# `Items` is an ordinary doctype with DocPerms — but these endpoints are kept
# because the reads are now AGGREGATES (one pass for every group's count) that a
# per-row client fetch cannot express, and because `frappe.get_all` keeps them
# permission-ignoring so any role with access to the TDS master page sees
# correct member data.
#
# `TDS Items Child Table` is retired as a writer and left physically dormant
# (rows retained, not dropped). Nothing here reads it any more — a stale row
# there is invisible to the product by design.
#
# PostgreSQL: `linked_tds_item` is a Link (a plain varchar column), so `["is",
# "set"]` is safe here. The `get_all` JSON-field restriction in CLAUDE.md does
# not apply.
# ─────────────────────────────────────────────────────────────────────────────

ITEMS_DOCTYPE = "Items"
PARENT_DOCTYPE = "TDS Items"
LINK_FIELD = "linked_tds_item"


@frappe.whitelist()
def get_tds_member_index():
	"""Bucket every TDS group's members in one call.

	Returns:
	    {
	        "counts": { "TDS-ITEM-00001": 2, ... },   # group -> member count
	        "categories": ["Cables", "Switches", ...]  # distinct member categories
	    }

	The master "TDS Items" tab uses `counts` for the Linked Item SKU pill; the
	master "Repository Entries" tab uses `categories` for its derived facet.

	ONE query over `Items` — the count is an aggregate over the whole catalog, so
	it must not become a per-group fan-out.
	"""
	rows = frappe.get_all(
		ITEMS_DOCTYPE,
		filters={LINK_FIELD: ["is", "set"]},
		fields=[LINK_FIELD, "category"],
		limit_page_length=0,
	)

	counts = {}
	categories = set()
	for r in rows:
		group = r.get(LINK_FIELD)
		if not group:
			continue
		counts[group] = counts.get(group, 0) + 1
		if r.category:
			categories.add(r.category)

	return {"counts": counts, "categories": sorted(categories)}


@frappe.whitelist()
def get_tds_item_members(tds_item: str):
	"""Return the member Items SKUs of a single TDS group (quick-peek dialog).

	Shape is UNCHANGED from the child-table era — `item` / `item_name` /
	`category` — so every existing consumer keeps working; `item` is now the
	`Items` id itself rather than a child row's Link to it. Ordered by
	`item_name` (the child table's `idx` no longer exists, and a derived set has
	no author-defined order).
	"""
	if not tds_item:
		return []

	rows = frappe.get_all(
		ITEMS_DOCTYPE,
		filters={LINK_FIELD: tds_item},
		fields=["name", "item_name", "category"],
		order_by="item_name asc",
		limit_page_length=0,
	)
	return [
		{"item": r.name, "item_name": r.item_name, "category": r.category}
		for r in rows
	]


def get_group_category(tds_item: str) -> str:
	"""Distinct member categories of a TDS group, joined by ", ".

	The single source of the "category of a group" rule. Reused by:
	  * the `Project TDS Item List` before_save hook — snapshots `tds_category`
	    onto a project submittal row (origin: `Items.category` → member items).
	  * `api/tds/tds_report._enrich_model_no` — the PDF "Model No." cell.

	Returns "" for a falsy id or a member-less (custom) group. Permission-ignoring
	read. Defensive: never raises — on any read error it returns "" so a (possibly
	bulk) save/approval is never broken by category derivation.
	"""
	if not tds_item:
		return ""
	try:
		rows = frappe.get_all(
			ITEMS_DOCTYPE,
			filters={LINK_FIELD: tds_item},
			fields=["category"],
			order_by="item_name asc",
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
