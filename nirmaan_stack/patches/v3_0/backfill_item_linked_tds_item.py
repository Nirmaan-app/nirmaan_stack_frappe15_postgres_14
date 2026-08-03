"""Backfill ``Items.linked_tds_item`` from the legacy TDS membership child rows.

Background (ADR-0004)
---------------------
TDS membership moved from a many-to-many ``members`` child table
(``TDS Items Child Table``, rows ``{parent=<TDS Items id>, item=<Items id>}``)
to **N:1 owned by the Item**: each ``Items`` row now carries a single
``linked_tds_item`` Link. A group's members are derived live as
``Items WHERE linked_tds_item = <group>``.

This patch backfills ``linked_tds_item`` from the existing child rows, then drops
three long-dead orphan columns off ``tabTDS Repository`` (``tds_item_id`` /
``tds_item_name`` / ``category``). Those were removed from the doctype JSON long
ago but never dropped from PostgreSQL; their last reader (a dead
``Items.on_update`` block) was deleted alongside this patch.

⚠️ ORDERING: that code deletion and this column drop MUST ship together. Drop the
columns while the dead block is live and every item rename throws.

Two safety rulings (owner, 2026-08-03) that the original draft did not have
--------------------------------------------------------------------------
1. **GATE, don't silently tie-break.** When an item belongs to >1 group the
   resolution ladder ends in ``sorted(candidates)[0]`` — "lowest group id", which
   is deterministic but *arbitrary as a business decision*. A handful of such
   items is data-entry noise; dozens would mean this patch is quietly making
   business calls at scale, and the discarded membership is invisible afterwards
   (the child rows survive, but nothing in the product reads them). So the patch
   ABORTS above ``_MAX_EXPECTED_MULTI_GROUP`` instead of proceeding.

2. **Enforce the WP invariant HERE.** ``Items.validate`` hard-enforces that an
   item's work package (``Items.category -> Category.work_package``) equals its
   linked group's ``work_package`` — but ``frappe.db.set_value`` bypasses
   ``validate`` entirely. Planting a violating link would not fail at migrate
   time; it would make that item **unsaveable** the next time anyone edited it,
   with a baffling TDS error. Violations are therefore SKIPPED and reported; the
   item is left unlinked and a PMO can re-tag it from the Items page in seconds.

Audit (dev bench, 2026-08-03): 380 groups, 354 membership rows, 354 distinct
member items, **0 multi-group**, **1 WP violation** (ITEM-001431, category
'HVAC Junk' -> wp 'Services', pointed at a 'Data & Networking' group).
⚠️ The June 2026 audit saw 414/404/2 — a DIFFERENT dataset. These numbers say
nothing about production; re-run the audit there before deploying.

Idempotent / re-run safe
------------------------
* ``frappe.db.set_value`` is naturally idempotent.
* The orphan-column drops use ``DROP COLUMN IF EXISTS`` and are individually
  guarded in try/except.
* Re-running after a partial run re-derives everything from the child rows,
  which are never mutated here.

PostgreSQL (not MariaDB). Raw SQL double-quotes table identifiers, e.g.
``"tabTDS Repository"`` — matching the other v3_0 patches.

``TDS Items Child Table`` is intentionally left physically dormant (retired as a
writer, rows retained, not dropped).
"""

import frappe

# Abort threshold for multi-group items (owner ruling 1). Dev sees 0; the June
# audit saw 2. A handful is noise worth auto-resolving; more than this means the
# assumption behind the tie-break ladder no longer holds and a human must look.
_MAX_EXPECTED_MULTI_GROUP = 5

# A known catch-all group name whose membership we DROP when an item is also in
# a more specific (self-named) group. See ADR-0004 / the 2026-06-17 audit.
# NOTE: exact match after strip+lower — a differently-worded catch-all
# ("Miscellaneous", "Raceway and Cable Tray") is deliberately NOT guessed at;
# it would fall through to the ladder and, in bulk, trip the gate above.
_CATCH_ALL_GROUP_NAMES = {"raceway & cable tray"}

# Orphan columns to drop off "tabTDS Repository" (removed from the doctype JSON
# long ago, never dropped from PG, no remaining readers).
_ORPHAN_COLUMNS = ("tds_item_id", "tds_item_name", "category")


def execute():
	stats = {
		"items_linked": 0,
		"multi_group_resolved": 0,
		"items_missing_skipped": 0,
		"wp_violations_skipped": 0,
		"columns_dropped": 0,
	}

	# ------------------------------------------------------------------
	# Step 1 — read all membership child rows (perm-safe).
	# ------------------------------------------------------------------
	member_rows = frappe.get_all(
		"TDS Items Child Table",
		filters={"parenttype": "TDS Items"},
		fields=["item", "parent"],
		limit_page_length=0,
	)
	if not member_rows:
		print("[backfill_linked_tds_item] No TDS membership rows found. Nothing to backfill.")
	else:
		print(f"[backfill_linked_tds_item] Found {len(member_rows)} membership row(s).")

	# ------------------------------------------------------------------
	# Step 2 — build item -> [groups].
	# ------------------------------------------------------------------
	item_to_groups = {}
	for row in member_rows:
		item = (row.get("item") or "").strip()
		group = (row.get("parent") or "").strip()
		if not item or not group:
			continue
		# De-dupe identical (item, group) pairs while preserving order.
		groups = item_to_groups.setdefault(item, [])
		if group not in groups:
			groups.append(group)

	# Cache group metadata to avoid repeated lookups.
	group_name_cache = {}

	def _group_name(group):
		if group not in group_name_cache:
			group_name_cache[group] = (
				frappe.db.get_value("TDS Items", group, "tds_item_name") or ""
			)
		return group_name_cache[group]

	# ------------------------------------------------------------------
	# Step 2a — GATE on multi-group volume (owner ruling 1) BEFORE any write.
	# ------------------------------------------------------------------
	multi = {i: g for i, g in item_to_groups.items() if len(g) > 1}
	if len(multi) > _MAX_EXPECTED_MULTI_GROUP:
		detail = "\n".join(
			f"    {item}: " + ", ".join(f"{g} ({_group_name(g)!r})" for g in groups)
			for item, groups in sorted(multi.items())
		)
		frappe.throw(
			f"[backfill_linked_tds_item] ABORTED — found {len(multi)} items in more "
			f"than one TDS group, above the expected maximum of "
			f"{_MAX_EXPECTED_MULTI_GROUP}.\n\n"
			f"Collapsing M:N -> N:1 DISCARDS the non-chosen membership, and the "
			f"tie-break ladder ends in an arbitrary 'lowest group id' fallback. At "
			f"this volume that is a business decision, not data cleanup — resolve "
			f"these by hand (or widen _MAX_EXPECTED_MULTI_GROUP deliberately) "
			f"before migrating.\n\nMulti-group items:\n{detail}"
		)

	item_to_chosen_group = {}
	for item, groups in item_to_groups.items():
		if len(groups) == 1:
			item_to_chosen_group[item] = groups[0]
			continue

		chosen = _resolve_multi_group(item, groups, _group_name)
		item_to_chosen_group[item] = chosen
		stats["multi_group_resolved"] += 1
		print(
			f"[backfill_linked_tds_item] multi-group item '{item}' in "
			f"{[(g, _group_name(g)) for g in groups]} -> chose "
			f"'{chosen}' ('{_group_name(chosen)}')."
		)

	# ------------------------------------------------------------------
	# Step 3 — batch-resolve the WP invariant inputs (owner ruling 2).
	# `frappe.db.set_value` bypasses `Items.validate`, so the check lives here.
	# ------------------------------------------------------------------
	wp_by_item, wp_by_group = _resolve_work_packages(item_to_chosen_group)

	# ------------------------------------------------------------------
	# Step 4 — set Items.linked_tds_item for each resolved, VALID item.
	# ------------------------------------------------------------------
	for item, chosen_group in item_to_chosen_group.items():
		if not frappe.db.exists("Items", item):
			stats["items_missing_skipped"] += 1
			print(
				f"[backfill_linked_tds_item] WARN: Items row '{item}' no longer "
				f"exists — skipping link to '{chosen_group}'."
			)
			continue

		item_wp = wp_by_item.get(item, "")
		group_wp = wp_by_group.get(chosen_group, "")
		if not item_wp or item_wp != group_wp:
			stats["wp_violations_skipped"] += 1
			print(
				f"[backfill_linked_tds_item] SKIP (WP invariant): item '{item}' "
				f"wp={item_wp!r} vs group '{chosen_group}' "
				f"({_group_name(chosen_group)!r}) wp={group_wp!r}. Left UNLINKED — "
				f"re-tag it from the Items page. Writing this link would bypass "
				f"Items.validate and make the item unsaveable."
			)
			continue

		frappe.db.set_value(
			"Items", item, "linked_tds_item", chosen_group, update_modified=False
		)
		stats["items_linked"] += 1

	# ------------------------------------------------------------------
	# Step 5 — drop orphan columns off "tabTDS Repository" (idempotent).
	# ------------------------------------------------------------------
	for col in _ORPHAN_COLUMNS:
		try:
			frappe.db.sql(
				f'ALTER TABLE "tabTDS Repository" DROP COLUMN IF EXISTS {col}'
			)
			stats["columns_dropped"] += 1
		except Exception as e:
			# Roll back the aborted PG transaction so subsequent statements /
			# the migrate session aren't poisoned, then continue — the column
			# may already be gone (re-run) or never existed.
			frappe.db.rollback()
			print(
				f"[backfill_linked_tds_item] drop column '{col}' skipped "
				f"({e.__class__.__name__}: {e})."
			)

	# ------------------------------------------------------------------
	# Step 6 — single commit + summary.
	# ------------------------------------------------------------------
	frappe.db.commit()

	print(
		"[backfill_linked_tds_item] DONE. "
		f"items linked: {stats['items_linked']}, "
		f"multi-group resolved: {stats['multi_group_resolved']}, "
		f"WP violations skipped: {stats['wp_violations_skipped']}, "
		f"missing items skipped: {stats['items_missing_skipped']}, "
		f"orphan columns dropped (or already absent): {stats['columns_dropped']}."
	)
	if stats["wp_violations_skipped"]:
		print(
			f"[backfill_linked_tds_item] ⚠️  {stats['wp_violations_skipped']} item(s) "
			f"were left UNLINKED because their work package did not match their "
			f"group's. See the SKIP lines above; re-tag them from the Items page."
		)


def _resolve_work_packages(item_to_chosen_group):
	"""Batch-resolve `item -> work_package` and `group -> work_package`.

	Item WP is `Items.category -> Category.work_package`. Three batched queries
	total (Items, Category, TDS Items) — never a per-item lookup.

	Returns: ({item: wp_or_empty}, {group: wp_or_empty})
	"""
	item_ids = list(item_to_chosen_group.keys())
	group_ids = set(item_to_chosen_group.values())

	wp_by_item = {}
	wp_by_group = {}
	if not item_ids:
		return wp_by_item, wp_by_group

	items = frappe.get_all(
		"Items",
		filters={"name": ["in", item_ids]},
		fields=["name", "category"],
		limit_page_length=0,
	)
	category_ids = {i.category for i in items if i.category}

	wp_by_category = {}
	if category_ids:
		cats = frappe.get_all(
			"Category",
			filters={"name": ["in", list(category_ids)]},
			fields=["name", "work_package"],
			limit_page_length=0,
		)
		wp_by_category = {c.name: (c.work_package or "") for c in cats}

	for i in items:
		wp_by_item[i.name] = wp_by_category.get(i.category, "") if i.category else ""

	if group_ids:
		groups = frappe.get_all(
			"TDS Items",
			filters={"name": ["in", list(group_ids)]},
			fields=["name", "work_package"],
			limit_page_length=0,
		)
		wp_by_group = {g.name: (g.work_package or "") for g in groups}

	return wp_by_item, wp_by_group


def _resolve_multi_group(item, groups, group_name_fn):
	"""Pick a single group for an item that appears in multiple groups.

	Preference order:
	  1. Drop known catch-all groups (e.g. "Raceway & Cable Tray"); if exactly
	     one specific group remains, use it.
	  2. Prefer the group whose ``tds_item_name`` matches the item's
	     ``item_name`` (self-named) — the shape the audit found the noise in.
	  3. Else the first group by group id (stable, but ARBITRARY as a business
	     choice — this is the rung the volume gate in `execute()` exists to stop
	     from firing at scale).
	"""
	# 1. Drop catch-all groups if at least one specific group remains.
	specific = [
		g for g in groups
		if (group_name_fn(g) or "").strip().lower() not in _CATCH_ALL_GROUP_NAMES
	]
	candidates = specific if specific else groups

	if len(candidates) == 1:
		return candidates[0]

	# 2. Prefer the self-named group (group name == item's item_name).
	item_name = (frappe.db.get_value("Items", item, "item_name") or "").strip().lower()
	if item_name:
		for g in candidates:
			if (group_name_fn(g) or "").strip().lower() == item_name:
				return g

	# 3. Stable fallback: first group by id.
	return sorted(candidates)[0]
