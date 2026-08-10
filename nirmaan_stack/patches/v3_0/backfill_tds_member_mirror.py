# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Populate the `TDS Items.members` DISPLAY MIRROR from `Items.linked_tds_item`.

WHY THIS PATCH EXISTS
    The mirror is maintained going forward by hooks (`Items` on_update /
    after_insert / after_delete) and by the two `linking.py` endpoints. Those
    only fire on CHANGES made after they ship. Every membership that already
    exists — including everything linked in production before this deploy — was
    written when nothing maintained the child table, so the Desk `Members` grid
    is empty or stale for it. This patch materialises the mirror once, from the
    store, for every group.

    ⚠️ WITHOUT THIS PATCH THE FEATURE LOOKS BROKEN ON A DEPLOYED SITE: new links
    appear in the grid, old ones do not. Shipping the mirror code without this
    is the actual defect, not a missing nicety.

WHAT IT DOES
    `rebuild_group_members(group, full=True)` per group — clear-and-rebuild, so
    it also NORMALISES `idx` (alphabetical by item_name). `full` is deliberate:
    the diff path is for the hot path, this is the one place that wants a
    deterministic, from-scratch result.

⚠️ IT DISCARDS LEGACY CHILD ROWS THAT THE STORE DOES NOT BACK
    Before ADR-0004 the child table WAS the membership store (many-to-many).
    Those rows were left dormant, and some of them describe membership that
    never made it into `Items.linked_tds_item` -- e.g. groups created by the old
    Add-TDS-Item wizard, whose members were written ONLY to this dead table and
    are invisible to the whole product. A full rebuild deletes them.

    That is correct (the store is the source of truth) but it destroys the only
    surviving record of what those rows claimed, so they are PRINTED to the
    migrate log first. If the log shows any, capture it before moving on --
    afterwards it is unrecoverable.

IDEMPOTENT
    Re-running re-derives the same rows from the same store. Safe on a site that
    already has a correct mirror, and safe to re-run after a partial failure.

ORDERING
    Best run AFTER `add_tds_membership_indexes` (the `Items.linked_tds_item`
    index turns each group's read from a Seq Scan into an Index Scan), but it is
    correct either way.
"""

import frappe

from nirmaan_stack.api.tds.members import rebuild_group_members

CHILD_DOCTYPE = "TDS Items Child Table"
PARENT_DOCTYPE = "TDS Items"
ITEMS_DOCTYPE = "Items"
LINK_FIELD = "linked_tds_item"


def _orphan_rows():
	"""Child rows the store does NOT back — what a full rebuild will discard."""
	return frappe.db.sql(
		"""
		SELECT c.parent, c.item
		FROM "tabTDS Items Child Table" c
		WHERE NOT EXISTS (
			SELECT 1 FROM "tabItems" i
			WHERE i.name = c.item AND i.linked_tds_item = c.parent
		)
		ORDER BY c.parent, c.item
		""",
		as_dict=True,
	)


def _missing_rows_count():
	"""Live links that have no mirror row yet — what the backfill will create."""
	return frappe.db.sql(
		"""
		SELECT COUNT(*) FROM "tabItems" i
		WHERE i.linked_tds_item IS NOT NULL AND i.linked_tds_item != ''
		  AND EXISTS (SELECT 1 FROM "tabTDS Items" g WHERE g.name = i.linked_tds_item)
		  AND NOT EXISTS (
			SELECT 1 FROM "tabTDS Items Child Table" c
			WHERE c.parent = i.linked_tds_item AND c.item = i.name
		)
		"""
	)[0][0]


def _plan():
	"""Read-only survey of what this patch WOULD do. Writes nothing."""
	return {
		"groups": frappe.db.count(PARENT_DOCTYPE),
		"linked_items": frappe.db.count(ITEMS_DOCTYPE, {LINK_FIELD: ["is", "set"]}),
		"mirror_rows_now": frappe.db.count(CHILD_DOCTYPE),
		"rows_to_create": _missing_rows_count(),
		"orphans": _orphan_rows(),
	}


def _print_plan(plan, heading):
	print(f"    {heading}")
	print(f"        TDS Items                        : {plan['groups']}")
	print(f"        linked items (the store)         : {plan['linked_items']}")
	print(f"        mirror rows right now            : {plan['mirror_rows_now']}")
	print(f"        mirror rows MISSING (to create)  : {plan['rows_to_create']}")

	orphans = plan["orphans"]
	if not orphans:
		print("        legacy rows to DISCARD           : 0")
		return

	# These are the last surviving record of pre-ADR-0004 membership that never
	# reached `Items.linked_tds_item`. A full rebuild deletes them, so name every
	# one in the log before that happens.
	print(f"        legacy rows to DISCARD           : {len(orphans)}  ⚠️")
	for o in orphans:
		exists = frappe.db.exists(ITEMS_DOCTYPE, o.item)
		linked = frappe.db.get_value(ITEMS_DOCTYPE, o.item, LINK_FIELD) if exists else None
		print(
			f"            {o.parent} claimed {o.item} "
			f"(item {'exists, linked to ' + repr(linked) if exists else 'no longer exists'})"
		)


def dry_run():
	"""Report what `execute()` would change, WITHOUT writing anything.

	Run this on production before migrating:

	    bench --site <site> console
	    >>> from nirmaan_stack.patches.v3_0.backfill_tds_member_mirror import dry_run
	    >>> dry_run()
	"""
	print("[backfill_tds_member_mirror] DRY RUN — no changes will be made")
	plan = _plan()
	_print_plan(plan, "would do:")
	print("[backfill_tds_member_mirror] dry run complete. Nothing was written.")
	return plan


def execute():
	print("[backfill_tds_member_mirror] materialising TDS Items.members from Items.linked_tds_item")

	# BEFORE: the same survey `dry_run()` prints, so the migrate log always
	# records what the site looked like and what was about to be discarded —
	# even when nobody ran the dry run first.
	_print_plan(_plan(), "before:")

	groups = frappe.get_all(PARENT_DOCTYPE, pluck="name", limit_page_length=0)
	written = 0
	for group in groups:
		written += rebuild_group_members(group, full=True)
	frappe.db.commit()

	# AFTER: verify rather than assume — the mirror must equal the store, both
	# directions. `rows_to_create` and `orphans` must both be zero now.
	after = _plan()
	print("    after:")
	print(f"        groups processed                 : {len(groups)}")
	print(f"        member rows written              : {written}")
	print(f"        mirror rows in table             : {after['mirror_rows_now']}")
	print(f"        linked items (the store)         : {after['linked_items']}")
	print(f"        still missing from the mirror    : {after['rows_to_create']} (expected 0)")
	print(f"        still not backed by the store    : {len(after['orphans'])} (expected 0)")

	if after["rows_to_create"] or after["orphans"]:
		# Loud, but do not abort migrate — the mirror is cosmetic, and a partial
		# mirror is strictly better than the empty grid this patch replaces.
		print(
			"    ⚠️  MIRROR IS NOT IN STEP WITH THE STORE. Re-run this patch; if it "
			"persists, investigate before relying on the Desk Members grid."
		)

	print("[backfill_tds_member_mirror] done.")
