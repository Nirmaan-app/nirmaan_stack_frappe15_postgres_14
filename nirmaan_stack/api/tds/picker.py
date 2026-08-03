import frappe


# ─────────────────────────────────────────────────────────────────────────────
# Why this module exists (Phase 2 — group-driven project consumption, ADR-0003;
# amended by ADR-0004):
#
# A project consumes TDS by picking a **TDS Item (group) + Make**. The picker
# fuzzy-matches the typed query against the group name (`TDS Items.
# tds_item_name`). Member-SKU matching is ARCHIVED behind the default-off
# `include_member_matches` flag — a stakeholder ruling, not a capability loss.
#
# ADR-0004 changed the member model underneath: membership is N:1 owned by the
# Item (`Items.linked_tds_item`), so a member hit resolves to exactly ONE group
# and the old M:N dedupe is unnecessary. Nothing here reads
# `TDS Items Child Table` any more (retired as a writer, left dormant).
#
# Reads use `frappe.get_all` (permission-ignoring) — the codebase's documented
# custom-API read pattern, identical to `api/tds/members.py` and
# `api/tds/linking.py`.
#
# All reads are batched to avoid N+1: matching groups are gathered first, then a
# single get_all over `TDS Repository` filtered by `tds_item IN [...]` attaches
# the makes-with-datasheet. Dicts are assembled in Python.
#
# PostgreSQL backend: no raw SQL is used here (frappe.get_all + filters cover
# everything); if any is added later, double-quote table names
# ("tabTDS Repository") and the reserved word "user".
# ─────────────────────────────────────────────────────────────────────────────

GROUP_DOCTYPE = "TDS Items"
ENTRY_DOCTYPE = "TDS Repository"
ITEMS_DOCTYPE = "Items"
LINK_FIELD = "linked_tds_item"  # Items.linked_tds_item → TDS Items (ADR-0004)

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
def search_tds_items(
	query: str = "",
	work_package: str = None,
	limit: int = 50,
	include_member_matches: bool = False,
):
	"""Group-driven TDS picker search — GROUP NAME ONLY by default (ADR-0004).

	Matches `query` (case-insensitive substring) against the TDS Items group name
	(`tds_item_name`). Stakeholders asked for group-name-only search, so the
	member-SKU search path is OFF by default and archived behind
	`include_member_matches` — kept working (and ported to the N:1 model) so it
	can be revived without re-deriving it, but no caller passes it today.

	ADR-0004 also COLLAPSED the old member fan-out: membership is now N:1 (an item
	belongs to exactly ONE group via `Items.linked_tds_item`), so a member hit can
	surface at most one parent group and the M:N dedupe that used to be necessary
	is gone.

	Args:
	    query: search text. Empty/whitespace → returns the first `limit` groups
	           (optionally WP-filtered), with `matched_member` null.
	    work_package: optional WP filter — restricts results to that work package.
	    limit: max number of groups to return (defaults to 50).
	    include_member_matches: opt back into member-SKU matching (default False).

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

	# ── 2. Member matches — ARCHIVED, opt-in only (ADR-0004) ───────────────────
	# Ported to N:1: members are `Items WHERE linked_tds_item IS SET`, so a hit
	# resolves to its ONE group via the item's own `linked_tds_item` — no child
	# table, and no M:N dedupe (an item cannot surface two parents any more).
	# Default-off per the stakeholder ruling that the picker searches group names.
	if q and include_member_matches:
		member_rows = []
		# items whose SKU id contains the query…
		member_rows += frappe.get_all(
			ITEMS_DOCTYPE,
			filters={LINK_FIELD: ["is", "set"], "name": ["like", f"%{q}%"]},
			fields=["name", "item_name", LINK_FIELD],
			limit_page_length=0,
		)
		# …or whose human item name contains the query.
		member_rows += frappe.get_all(
			ITEMS_DOCTYPE,
			filters={LINK_FIELD: ["is", "set"], "item_name": ["like", f"%{q}%"]},
			fields=["name", "item_name", LINK_FIELD],
			limit_page_length=0,
		)

		# Groups surfaced only via a member hit (not already a name match).
		member_only_parents = {}  # group -> first matching member hint
		for r in member_rows:
			parent = r.get(LINK_FIELD)
			if not parent:
				continue
			if parent in results:
				# Group already surfaced by its name; keep matched_member null
				# (a name match is the stronger, more intuitive signal).
				continue
			if parent not in member_only_parents:
				member_only_parents[parent] = {
					"item": r.name,
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
