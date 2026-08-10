import frappe

from nirmaan_stack.api.tds.members import rebuild_group_members_bulk


# ─────────────────────────────────────────────────────────────────────────────
# Why this module exists (membership is N:1, owned by the Item — ADR-0004):
#
# Each `Items` row carries a single `linked_tds_item` Link → `TDS Items` (the
# group). A group's members are derived live as `Items WHERE linked_tds_item =
# <group>`; there is no longer a writable child table on the group. This module
# owns the two write surfaces and the read tag both surfaces need:
#
#   * READ  — `get_items_linkage`: batched current-linkage lookup for many items
#             in ONE pass, so a list/edit UI can render the amber "linked to
#             <group>" tag on each item option without an N+1 fan-out.
#   * WRITE — `set_items_tds_link` / `clear_items_tds_link`: bulk link writers
#             used by BOTH the Items-side UI (Admin + PMO Executive — ADR-0004
#             relaxes ADR-0003's Admin-only authoring for the *membership*
#             dimension only) AND the TDS Item detail "Add Member Items" dialog
#             (Admin-only, enforced in the frontend since that page is Admin-only).
#
# WP invariant (hard-enforced, ADR-0004): an item's WP (`Items.category →
# Category.work_package`) must equal the target group's `work_package`. The
# write path validates this ITSELF: `frappe.db.set_value` bypasses
# `Items.validate`, and the validate hook only covers the single-doc save path,
# so the bulk path enforces the invariant here. (Same trap the backfill patch
# has to answer — see `patches/v3_0/backfill_item_linked_tds_item.py`.)
#
# Reassignment is a warn-and-confirm *move*: re-linking an already-linked item
# silently moves it at the DB level, but `set_items_tds_link` reports each such
# move in `reassigned` so the caller can have surfaced a confirm beforehand.
#
# Reads use `frappe.get_all` (permission-ignoring) — the codebase's documented
# custom-API read pattern (NOT the permission-aware `frappe.client.get_list`
# behind `useFrappeGetDocList`), identical to `api/tds/members.py` and
# `api/tds/picker.py`. The write permission gate uses `Nirmaan Users.
# role_profile` (NOT `get_roles`), as mandated by ADR-0003.
#
# PostgreSQL backend: no raw SQL is used here (frappe.get_all / frappe.db.set_value
# cover everything). If any is added later, double-quote table names
# ("tabItems") and the reserved word "user".
# ─────────────────────────────────────────────────────────────────────────────

ITEMS_DOCTYPE = "Items"
GROUP_DOCTYPE = "TDS Items"
CATEGORY_DOCTYPE = "Category"
LINK_FIELD = "linked_tds_item"  # Items.linked_tds_item → TDS Items (the group)

# Roles allowed to author membership from the bulk write surfaces (ADR-0004).
# DB-verified `Nirmaan Users.role_profile` strings (2026-08-03).
MEMBERSHIP_WRITE_ROLES = (
	"Nirmaan Admin Profile",
	"Nirmaan PMO Executive Profile",
)


def _coerce_id_list(item_ids):
	"""Normalise `item_ids` (JSON string OR list) into a clean list of ids.

	Strips falsy/blank entries. Returns [] for anything empty.
	"""
	if isinstance(item_ids, str):
		item_ids = frappe.parse_json(item_ids)
	if not item_ids:
		return []
	return [i for i in item_ids if i]


def _assert_membership_write_permission():
	"""Gate the bulk write surfaces to Admin + PMO Executive (ADR-0004).

	Uses `Nirmaan Users.role_profile` (NOT `get_roles`) per ADR-0003. The
	Administrator superuser is always allowed.
	"""
	user = frappe.session.user
	if user == "Administrator":
		return
	role_profile = frappe.db.get_value("Nirmaan Users", user, "role_profile")
	if role_profile in MEMBERSHIP_WRITE_ROLES:
		return
	frappe.throw(
		"Not permitted: only Admin or PMO Executive can change TDS Item linkage.",
		frappe.PermissionError,
	)


def _wp_by_item(item_names):
	"""Resolve the work package of each item via `Items.category →
	Category.work_package`, batched (no N+1).

	Returns: { "<item id>": "<work_package or ''>" } for every queried item
	(items with no category, or a category with no WP, map to "").
	"""
	wp_by_item = {}
	if not item_names:
		return wp_by_item

	items = frappe.get_all(
		ITEMS_DOCTYPE,
		filters={"name": ["in", list(item_names)]},
		fields=["name", "item_name", "category"],
		limit_page_length=0,
	)

	# Batch-resolve category → work_package in one call.
	category_ids = {i.category for i in items if i.category}
	wp_by_category = {}
	if category_ids:
		cats = frappe.get_all(
			CATEGORY_DOCTYPE,
			filters={"name": ["in", list(category_ids)]},
			fields=["name", "work_package"],
			limit_page_length=0,
		)
		wp_by_category = {c.name: (c.work_package or "") for c in cats}

	for i in items:
		wp_by_item[i.name] = wp_by_category.get(i.category, "") if i.category else ""

	return wp_by_item


@frappe.whitelist()
def get_items_linkage(item_ids=None, work_package=None):
	"""Batched current-linkage lookup for many items in ONE pass (ADR-0004).

	The list/edit UI uses this to render the amber "linked to <group>" tag on
	each item option without an N+1 fan-out.

	Selection (mutually exclusive, `item_ids` wins if both given):
	  * `item_ids` (JSON string or list) → the linkage of exactly those items.
	  * `work_package` → the linkage of every Item whose category's
	    `work_package` matches (one get_all on Category to resolve the matching
	    categories, then `Items.category IN [...]`).
	  * neither → returns {} (nothing to look up).

	Returns (ALL queried items are included, linked or not — an unlinked item
	carries empty strings, so the caller can render "no group" without a second
	round-trip):
	    {
	        "<item id>": {
	            "linked_tds_item": "<TDS-ITEM-id or ''>",
	            "group_name":      "<group name or ''>"
	        },
	        ...
	    }

	No N+1: one get_all over Items, then one get_all over `TDS Items` to resolve
	the distinct non-empty linked ids to their `tds_item_name`.
	"""
	ids = _coerce_id_list(item_ids)

	if ids:
		items = frappe.get_all(
			ITEMS_DOCTYPE,
			filters={"name": ["in", ids]},
			fields=["name", LINK_FIELD],
			limit_page_length=0,
		)
	elif work_package:
		# Resolve categories under this WP first, then filter Items by them.
		cats = frappe.get_all(
			CATEGORY_DOCTYPE,
			filters={"work_package": work_package},
			fields=["name"],
			limit_page_length=0,
		)
		category_ids = [c.name for c in cats]
		if not category_ids:
			return {}
		items = frappe.get_all(
			ITEMS_DOCTYPE,
			filters={"category": ["in", category_ids]},
			fields=["name", LINK_FIELD],
			limit_page_length=0,
		)
	else:
		return {}

	# Batch-resolve group ids → group names in one call.
	group_ids = {i.get(LINK_FIELD) for i in items if i.get(LINK_FIELD)}
	name_by_group = {}
	if group_ids:
		groups = frappe.get_all(
			GROUP_DOCTYPE,
			filters={"name": ["in", list(group_ids)]},
			fields=["name", "tds_item_name"],
			limit_page_length=0,
		)
		name_by_group = {g.name: (g.tds_item_name or "") for g in groups}

	out = {}
	for i in items:
		linked = i.get(LINK_FIELD) or ""
		out[i.name] = {
			"linked_tds_item": linked,
			"group_name": name_by_group.get(linked, "") if linked else "",
		}
	return out


@frappe.whitelist()
def set_items_tds_link(item_ids, tds_item):
	"""Bulk-assign `linked_tds_item = tds_item` to many items in one transaction.

	Permission: Admin + PMO Executive (ADR-0004). The WP invariant is enforced
	HERE because `frappe.db.set_value` bypasses `Items.validate` (the validate
	hook only covers the single-doc save path).

	Args:
	    item_ids: JSON string or list of `Items` ids.
	    tds_item: a `TDS Items` id (the target group).

	Per item:
	  * derive its WP (`Items.category → Category.work_package`);
	  * if the item has no category/WP, OR its WP != the group's WP → record in
	    `errors` and SKIP (no write);
	  * if currently linked to a DIFFERENT group → record the move in
	    `reassigned`;
	  * write `linked_tds_item = tds_item` (update_modified=False).

	One `frappe.db.commit()` at the end.

	Returns:
	    {
	        "updated":    ["<ids actually set>", ...],
	        "reassigned": [{"item", "item_name", "from_group", "from_group_name"}, ...],
	        "errors":     [{"item", "reason"}, ...]
	    }
	"""
	_assert_membership_write_permission()

	ids = _coerce_id_list(item_ids)
	if not tds_item:
		frappe.throw("A target TDS Item is required.", frappe.ValidationError)
	if not frappe.db.exists(GROUP_DOCTYPE, tds_item):
		frappe.throw(f"TDS Item '{tds_item}' does not exist.", frappe.ValidationError)

	group_wp = frappe.db.get_value(GROUP_DOCTYPE, tds_item, "work_package") or ""

	updated = []
	reassigned = []
	errors = []

	if not ids:
		return {"updated": updated, "reassigned": reassigned, "errors": errors}

	# Batch the per-item reads needed for validation + the reassignment hint.
	wp_by_item = _wp_by_item(ids)
	current = frappe.get_all(
		ITEMS_DOCTYPE,
		filters={"name": ["in", ids]},
		fields=["name", "item_name", LINK_FIELD],
		limit_page_length=0,
	)
	current_by_id = {c.name: c for c in current}

	# Resolve the names of every distinct "from" group we'll report, in one call.
	from_group_ids = {
		c.get(LINK_FIELD)
		for c in current
		if c.get(LINK_FIELD) and c.get(LINK_FIELD) != tds_item
	}
	from_group_names = {}
	if from_group_ids:
		fg = frappe.get_all(
			GROUP_DOCTYPE,
			filters={"name": ["in", list(from_group_ids)]},
			fields=["name", "tds_item_name"],
			limit_page_length=0,
		)
		from_group_names = {g.name: (g.tds_item_name or "") for g in fg}

	for item in ids:
		row = current_by_id.get(item)
		if row is None:
			errors.append({"item": item, "reason": "Item does not exist."})
			continue

		item_wp = wp_by_item.get(item, "")
		if not item_wp:
			errors.append(
				{"item": item, "reason": "Item has no resolvable work package."}
			)
			continue
		if item_wp != group_wp:
			errors.append(
				{
					"item": item,
					"reason": (
						f"Work package mismatch: item is '{item_wp}', "
						f"TDS Item is '{group_wp}'."
					),
				}
			)
			continue

		existing_link = row.get(LINK_FIELD) or ""
		if existing_link and existing_link != tds_item:
			reassigned.append(
				{
					"item": item,
					"item_name": row.get("item_name") or "",
					"from_group": existing_link,
					"from_group_name": from_group_names.get(existing_link, ""),
				}
			)

		frappe.db.set_value(
			ITEMS_DOCTYPE, item, LINK_FIELD, tds_item, update_modified=False
		)
		updated.append(item)

	# Refresh the DISPLAY-ONLY `members` mirror. `set_value` fires no doc hook,
	# so this call is the ONLY thing keeping the Desk grid in step — and BOTH
	# sides of a move must be rebuilt: the destination gains a row, and every
	# group an item was taken FROM loses one.
	if updated:
		rebuild_group_members_bulk(
			[tds_item] + [r["from_group"] for r in reassigned]
		)

	frappe.db.commit()
	return {"updated": updated, "reassigned": reassigned, "errors": errors}


@frappe.whitelist()
def clear_items_tds_link(item_ids):
	"""Bulk-clear `linked_tds_item` (set to empty) for many items in one txn.

	Permission: Admin + PMO Executive (ADR-0004). Used when a member is removed
	from a group — clearing the link IS the N:1 "remove member" operation.

	Args:
	    item_ids: JSON string or list of `Items` ids.

	One `frappe.db.commit()` at the end.

	Returns: {"cleared": ["<ids>", ...], "errors": [{"item", "reason"}, ...]}
	"""
	_assert_membership_write_permission()

	ids = _coerce_id_list(item_ids)
	cleared = []
	errors = []

	if not ids:
		return {"cleared": cleared, "errors": errors}

	# One existence check for the whole batch — a stale id from the UI should be
	# reported, not silently written into the void. The CURRENT link is read in
	# the SAME pass: once cleared it is unrecoverable, and the `members` mirror
	# rebuild below needs to know which groups just lost a row.
	existing = {
		r.name: r.get(LINK_FIELD)
		for r in frappe.get_all(
			ITEMS_DOCTYPE,
			filters={"name": ["in", ids]},
			fields=["name", LINK_FIELD],
			limit_page_length=0,
		)
	}

	affected_groups = []
	for item in ids:
		if item not in existing:
			errors.append({"item": item, "reason": "Item does not exist."})
			continue
		if existing[item]:
			affected_groups.append(existing[item])
		frappe.db.set_value(
			ITEMS_DOCTYPE, item, LINK_FIELD, None, update_modified=False
		)
		cleared.append(item)

	# Refresh the DISPLAY-ONLY `members` mirror for every group that lost a member.
	if affected_groups:
		rebuild_group_members_bulk(affected_groups)

	frappe.db.commit()
	return {"cleared": cleared, "errors": errors}
