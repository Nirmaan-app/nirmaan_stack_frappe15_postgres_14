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
CHILD_DOCTYPE = "TDS Items Child Table"
MEMBERS_FIELD = "members"
LINK_FIELD = "linked_tds_item"


# ─────────────────────────────────────────────────────────────────────────────
# The `members` DISPLAY MIRROR (owner decision 2026-08-04).
#
# `Items.linked_tds_item` REMAINS the single source of truth. Every read in the
# product derives from it (this module, `picker`, `tds_report`, the project
# submittal snapshot) and NONE of them reads `members`. The child table is
# repopulated purely so the Desk form's `Members` grid stops showing "No Data"
# for a group that plainly has members.
#
# ⚠️ ONE-WAY. `rebuild_group_members` is the ONLY writer, and it always CLEARS
# and re-derives — it never merges. Anything hand-entered into that grid is
# discarded on the next rebuild, which is why the field is set `read_only` in
# the doctype. Do not "improve" this into a two-way sync: a second writable copy
# of membership is exactly what ADR-0004 collapsed, and the mirror is safe only
# because it can never disagree with the store it is rebuilt from.
#
# Correctness is maintained by CALLING this from every path that changes
# linkage: `linking.set_items_tds_link` / `clear_items_tds_link` (which use
# `frappe.db.set_value`, so NO doc hook fires for them) plus the `Items`
# `on_update` / `after_delete` controllers. A future write to `linked_tds_item`
# that forgets this call desyncs the Desk view silently — keep such writes
# confined to `linking.py`.
# ─────────────────────────────────────────────────────────────────────────────


def _desired_members(tds_item: str):
	"""The mirror's target state: {item -> (item_name, category)} from the store."""
	return {
		r.name: (r.item_name, r.category)
		for r in frappe.get_all(
			ITEMS_DOCTYPE,
			filters={LINK_FIELD: tds_item},
			fields=["name", "item_name", "category"],
			order_by="item_name asc",
			limit_page_length=0,
		)
	}


def _insert_member_rows(tds_item: str, items, start_idx: int = 1) -> int:
	"""Insert mirror rows for `items` = [(item, item_name, category), ...].

	Writes through `db_insert` rather than `parent.save()` ON PURPOSE: `TDS Items`
	is `track_changes: 1`, so saving the parent on every refresh would file a
	Version row for a change no human made, burying the group's real edit history.
	"""
	now = frappe.utils.now()
	user = frappe.session.user
	for offset, (item, item_name, category) in enumerate(items):
		child = frappe.new_doc(CHILD_DOCTYPE)
		child.name = frappe.generate_hash(length=10)
		child.parent = tds_item
		child.parenttype = PARENT_DOCTYPE
		child.parentfield = MEMBERS_FIELD
		child.idx = start_idx + offset
		child.item = item
		child.item_name = item_name
		child.category = category
		child.owner = user
		child.modified_by = user
		child.creation = now
		child.modified = now
		child.db_insert()
	return len(items)


def rebuild_group_members(tds_item: str, full: bool = False) -> int:
	"""Bring one group's `members` mirror in step with `Items.linked_tds_item`.

	DIFF by default: reads the current mirror rows and writes ONLY what actually
	changed — a removed member is one DELETE, a new member one INSERT, a renamed
	item one UPDATE, and an unchanged group writes NOTHING AT ALL. The previous
	clear-and-rebuild spent O(group size) writes on every trigger even when a
	single row moved, which is also what made a bulk item edit O(n^2).

	`full=True` restores that clear-and-rebuild.

	WHAT `full` ACTUALLY BUYS — measured, not assumed. The diff was expected to
	propagate drift, and it does NOT: because it compares the whole desired set
	against the whole current set, it deletes rows whose item is gone, inserts
	missing ones, drops duplicate rows for one item, and refreshes changed copies.
	Given a deliberately corrupted mirror (one ghost row, eight members missing)
	it converged in a single pass. So BOTH paths are self-healing on membership.
	What `full` uniquely does is NORMALISE `idx` — it renumbers every row
	alphabetically by `item_name` — and rewrite the group in one delete+insert
	rather than a read plus targeted writes. That makes it the right call for the
	backfill and for deterministic ordering, and the wrong call for the hot path.

	⚠️ ROW ORDER: `full` numbers `idx` alphabetically; the diff appends new rows
	after the current max, so the Desk grid drifts toward insertion order.
	Deliberate — renumbering on every membership change would spend exactly the
	writes this diff exists to save, and the product read
	(`get_tds_item_members`) sorts by `item_name` itself, so only the Desk grid
	is affected.

	`item_name` / `category` are COPIES on the child row, so they go stale on an
	item rename — which is why the `Items.on_update` hook covers those fields too.

	Returns the number of rows WRITTEN (inserted + updated + deleted); 0 means the
	mirror was already correct. Never raises for a missing group.
	"""
	if not tds_item or not frappe.db.exists(PARENT_DOCTYPE, tds_item):
		return 0

	desired = _desired_members(tds_item)

	if full:
		# Scoped by parenttype too: a bare `parent` match is the kind of thing
		# that bites later. (`TDS Items Child Table` is used only by
		# `TDS Items.members` today — verified — so this is belt-and-braces.)
		frappe.db.delete(CHILD_DOCTYPE, {"parent": tds_item, "parenttype": PARENT_DOCTYPE})
		return _insert_member_rows(
			tds_item,
			[(item, nm, cat) for item, (nm, cat) in desired.items()],
		)

	current_rows = frappe.get_all(
		CHILD_DOCTYPE,
		filters={"parent": tds_item, "parenttype": PARENT_DOCTYPE},
		fields=["name", "item", "item_name", "category", "idx"],
		limit_page_length=0,
	)
	current = {r.item: r for r in current_rows}

	# A duplicate `item` in the mirror can only come from drift; keep the first
	# and let the extras fall into the delete set below.
	stale_names = [
		r.name for r in current_rows if current.get(r.item) is not r
	]

	stale_names += [r.name for item, r in current.items() if item not in desired]
	to_insert = [
		(item, nm, cat) for item, (nm, cat) in desired.items() if item not in current
	]
	to_update = [
		(current[item].name, nm, cat)
		for item, (nm, cat) in desired.items()
		if item in current
		and (current[item].item_name != nm or current[item].category != cat)
	]

	if not (stale_names or to_insert or to_update):
		return 0  # already correct — the common case, and it writes nothing

	written = 0
	if stale_names:
		frappe.db.delete(CHILD_DOCTYPE, {"name": ["in", stale_names]})
		written += len(stale_names)
	for row_name, nm, cat in to_update:
		frappe.db.set_value(
			CHILD_DOCTYPE, row_name, {"item_name": nm, "category": cat},
			update_modified=False,
		)
		written += 1
	if to_insert:
		next_idx = max([r.idx or 0 for r in current_rows], default=0) + 1
		written += _insert_member_rows(tds_item, to_insert, start_idx=next_idx)

	return written


def rebuild_group_members_bulk(tds_items, full: bool = False) -> int:
	"""Rebuild several groups, skipping blanks/duplicates. Returns rows written."""
	seen = set()
	total = 0
	for g in tds_items or []:
		g = (g or "").strip()
		if not g or g in seen:
			continue
		seen.add(g)
		total += rebuild_group_members(g, full=full)
	return total


@frappe.whitelist()
def get_tds_member_index():
	"""Bucket every TDS group's members in one call.

	Returns:
	    {
	        "counts": { "TDS-ITEM-00001": 2, ... },   # group -> member count
	        "categories": ["Cables", "Switches", ...], # distinct member categories
	        "unlinked": ["TDS-ITEM-00007", ...]        # groups with ZERO members
	    }

	The master "TDS Items" tab uses `counts` for the Linked Item SKU pill; the
	master "Repository Entries" tab uses `categories` for its derived facet.

	ONE query over `Items` — the count is an aggregate over the whole catalog, so
	it must not become a per-group fan-out.

	WHY `unlinked` IS RETURNED rather than derived client-side. The master tab's
	"Linked Item SKU" facet (Linked / Not Linked) has no field to filter on —
	membership lives on `Items`, not on `TDS Items` — so each side is expressed
	to the data-table API as an explicit `["name", "in", [...]]` narrowing.
	`in` is the ONLY form that API pulls out of the generated query
	(`split_name_in_constraints`); a `not in` would be inlined and walk toward
	the sqlparse token cap. So the COMPLEMENT has to be enumerated too, and the
	client holds only the current page of groups — it cannot compute it. One
	extra name-only scan of `TDS Items` here, in the same aggregate that already
	knows which groups have members.
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

	# Keyed off `counts`, so a stale linkage pointing at a deleted group can
	# never make a live group read as linked — the membership set is whatever
	# `Items` actually points at, and everything else in `TDS Items` is custom.
	unlinked = [
		d.name
		for d in frappe.get_all(PARENT_DOCTYPE, fields=["name"], limit_page_length=0)
		if d.name not in counts
	]

	return {"counts": counts, "categories": sorted(categories), "unlinked": unlinked}


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
