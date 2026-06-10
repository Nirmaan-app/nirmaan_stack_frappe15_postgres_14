import frappe


# ─────────────────────────────────────────────────────────────────────────────
# Why this module exists (Phase 2 — group-driven project consumption, ADR-0003):
#
# A project consumes TDS by picking a **TDS Item (group) + Make**. The picker
# must fuzzy-match the typed query against BOTH the group name (`TDS Items.
# tds_item_name`) AND the member rows' item code / item name in the child table
# `TDS Items Child Table`. A member-item hit must resolve to its PARENT TDS Item,
# and — because membership is many-to-many — the SAME query can surface one group
# multiple times via different members; results are deduped by `tds_item` id.
#
# `TDS Items Child Table` is an `istable` child doctype with NO DocPerm rows.
# Listing it through the permission-aware path (`frappe.client.get_list`, which
# `useFrappeGetDocList` calls) raises PermissionError for every NON-superuser —
# only the Administrator superuser sees rows. So we read the child rows (and, for
# consistency, the master/repository rows) with `frappe.get_all`, which ignores
# perms. This is the codebase's documented child-table pattern, identical to
# `api/tds/members.py`, where this exact bug was already diagnosed and fixed.
#
# All reads are batched to avoid N+1: matching groups are gathered first, then a
# single get_all over `TDS Repository` filtered by `tds_item IN [...]` attaches
# the makes-with-datasheet, and a single get_all over the child table attaches
# the member that caused each member-hit. Dicts are assembled in Python.
#
# PostgreSQL backend: no raw SQL is used here (frappe.get_all + filters cover
# everything); if any is added later, double-quote table names
# ("tabTDS Items Child Table") and the reserved word "user".
# ─────────────────────────────────────────────────────────────────────────────

GROUP_DOCTYPE = "TDS Items"
CHILD_DOCTYPE = "TDS Items Child Table"
ENTRY_DOCTYPE = "TDS Repository"

DEFAULT_LIMIT = 50


def _makes_by_group(tds_item_ids):
	"""Batch-fetch the makes-with-datasheet for a set of TDS Item groups.

	One `get_all` over `TDS Repository` filtered by `tds_item IN [...]`. Only
	makes that HAVE a Repository Entry (datasheet) for the group are returned —
	that is exactly the set the project-side Make dropdown may pick from.

	Returns: { "<TDS-ITEM-id>": [ {make, entry, tds_attachment, status}, ... ] }
	deduped per group on `make` (first entry wins; later duplicates ignored).
	"""
	by_group = {}
	if not tds_item_ids:
		return by_group

	entries = frappe.get_all(
		ENTRY_DOCTYPE,
		filters={"tds_item": ["in", list(tds_item_ids)]},
		fields=["name", "tds_item", "make", "tds_attachment", "status"],
		order_by="make asc, modified desc",
		limit_page_length=0,
	)

	seen = {}  # (tds_item, make) -> True, to dedupe makes within a group
	for e in entries:
		if not e.tds_item:
			continue
		key = (e.tds_item, e.make or "")
		if key in seen:
			continue
		seen[key] = True
		by_group.setdefault(e.tds_item, []).append(
			{
				"make": e.make,
				"entry": e.name,
				"tds_attachment": e.tds_attachment,
				"status": e.status,
			}
		)
	return by_group


@frappe.whitelist()
def get_tds_item_makes(tds_item: str):
	"""Return the makes-with-datasheet for ONE TDS Item group.

	Each make corresponds to a `TDS Repository` entry (the datasheet). Used by the
	project-side Make dropdown after a group is picked, and reused internally by
	`search_tds_items` to populate the `makes` list on each result.

	Returns: [ {make, entry (TDS Repository name), tds_attachment, status}, ... ]
	deduped on `make`.
	"""
	if not tds_item:
		return []
	return _makes_by_group([tds_item]).get(tds_item, [])


@frappe.whitelist()
def search_tds_items(query: str = "", work_package: str = None, limit: int = 50):
	"""Group-driven TDS picker search.

	Matches `query` (case-insensitive substring) against BOTH the TDS Items group
	name (`tds_item_name`) AND the member rows' `item` / `item_name` in the
	`istable` child `TDS Items Child Table`. A member-item hit resolves to its
	PARENT TDS Item group. Because membership is many-to-many, results are deduped
	by `tds_item` id; each result carries a `matched_member` hint (the member that
	caused a member-hit, or null when matched on the group name itself).

	Args:
	    query: search text. Empty/whitespace → returns the first `limit` groups
	           (optionally WP-filtered), with `matched_member` null.
	    work_package: optional WP filter — restricts results to that work package.
	    limit: max number of groups to return (defaults to 50).

	Returns a list of result objects:
	    {
	        "tds_item": "<TDS-ITEM-#####>",
	        "tds_item_name": "<group name>",
	        "work_package": "<wp>",
	        "matched_member": {"item": "...", "item_name": "..."} | null,
	        "makes": [
	            {"make": "Legrand", "entry": "<TDS Repository name>",
	             "tds_attachment": "<url>", "status": "Verified|Not Verified"},
	            ...
	        ]
	    }

	Result ordering: groups matched on their name come first (ranked by name),
	then groups surfaced only via a member hit. The frontend layers fuzzy ranking
	on top of this.
	"""
	try:
		limit = int(limit)
	except (TypeError, ValueError):
		limit = DEFAULT_LIMIT
	if limit <= 0:
		limit = DEFAULT_LIMIT

	q = (query or "").strip()
	q_lower = q.lower()

	group_filters = {}
	if work_package:
		group_filters["work_package"] = work_package

	# ── 1. Name matches: groups whose own name contains the query ──────────────
	name_filters = dict(group_filters)
	if q:
		name_filters["tds_item_name"] = ["like", f"%{q}%"]

	name_matched = frappe.get_all(
		GROUP_DOCTYPE,
		filters=name_filters,
		fields=["name", "tds_item_name", "work_package"],
		order_by="tds_item_name asc",
		# Pull a generous slice; we trim to `limit` after merging member hits.
		limit_page_length=0 if q else limit,
	)

	# ordered dict of tds_item id -> result skeleton (preserves name-first order)
	results = {}
	for g in name_matched:
		results[g.name] = {
			"tds_item": g.name,
			"tds_item_name": g.tds_item_name,
			"work_package": g.work_package,
			"matched_member": None,
		}

	# ── 2. Member matches: child rows whose item code / name contains query ────
	# Resolve each hit to its PARENT TDS Item (M:N → same group may appear via
	# several members; dedupe by parent, keep the first member as the hint).
	if q:
		member_rows = []
		# child rows where the linked Items SKU id contains the query…
		member_rows += frappe.get_all(
			CHILD_DOCTYPE,
			filters={"parenttype": GROUP_DOCTYPE, "item": ["like", f"%{q}%"]},
			fields=["parent", "item", "item_name"],
			limit_page_length=0,
		)
		# …or whose human item name contains the query.
		member_rows += frappe.get_all(
			CHILD_DOCTYPE,
			filters={"parenttype": GROUP_DOCTYPE, "item_name": ["like", f"%{q}%"]},
			fields=["parent", "item", "item_name"],
			limit_page_length=0,
		)

		# Parents surfaced only via a member hit (not already a name match).
		member_only_parents = {}  # parent -> first matching member hint
		for r in member_rows:
			if not r.parent:
				continue
			if r.parent in results:
				# Group already surfaced by its name; keep matched_member null
				# (name match is the stronger, more intuitive signal). If it was
				# null and we want a hint, only set it when there was no name hit.
				continue
			if r.parent not in member_only_parents:
				member_only_parents[r.parent] = {
					"item": r.item,
					"item_name": r.item_name,
				}

		if member_only_parents:
			# Fetch the parent groups in one call (respect WP filter).
			parent_filters = dict(group_filters)
			parent_filters["name"] = ["in", list(member_only_parents.keys())]
			parent_groups = frappe.get_all(
				GROUP_DOCTYPE,
				filters=parent_filters,
				fields=["name", "tds_item_name", "work_package"],
				limit_page_length=0,
			)
			for g in parent_groups:
				if g.name in results:
					continue
				results[g.name] = {
					"tds_item": g.name,
					"tds_item_name": g.tds_item_name,
					"work_package": g.work_package,
					"matched_member": member_only_parents.get(g.name),
				}

	# ── 3. Trim to limit (name matches first, then member-only) ────────────────
	ordered_ids = list(results.keys())[:limit]

	# ── 4. Attach makes-with-datasheet in one batched query ────────────────────
	makes_map = _makes_by_group(ordered_ids)

	out = []
	for tds_item_id in ordered_ids:
		row = results[tds_item_id]
		row["makes"] = makes_map.get(tds_item_id, [])
		out.append(row)

	return out
