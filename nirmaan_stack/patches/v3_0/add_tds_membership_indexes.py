# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Apply the two TDS membership read indexes to already-deployed databases.

WHY THIS PATCH EXISTS
    ADR-0004 made ``Items.linked_tds_item`` the SOLE membership store, and the
    `members` display mirror rebuilds ``TDS Items Child Table`` by ``parent``.
    Both columns were UNINDEXED (verified against ``pg_indexes`` on the dev
    site): a membership lookup Seq-Scanned 3,536 ``tabItems`` rows to return 8.

    The index shapes are declared in the two controllers' ``on_doctype_update()``
    hooks, but those are CONTROLLER-ONLY changes to doctypes that are already
    synced in every deployed environment -- and a plain ``bench migrate`` does
    NOT re-sync a doctype whose JSON is unchanged, so it never fires the hook and
    the indexes silently never land. (Same trap as
    ``add_boq_read_indexes``; see that patch's note.) This patch calls the hooks
    explicitly so the fix rides migrate.

    Calling the hooks rather than re-inlining the ``add_index`` shape is
    deliberate: the controllers stay the single source of truth, so this patch
    can never drift from the live schema-sync path.

IDEMPOTENT
    ``frappe.db.add_index`` no-ops when the index already exists, so re-runs and
    fresh environments (which get the indexes at first sync) are safe.

POSTGRESQL
    A brand-new index has no planner statistics until ANALYZE runs, so
    PostgreSQL can keep Seq-Scanning a populated table until autovacuum catches
    up. Both tables are ANALYZEd here, matching ``add_boq_read_indexes``.
"""

import frappe

from nirmaan_stack.nirmaan_stack.doctype.items.items import (
	on_doctype_update as _items_indexes,
)
from nirmaan_stack.nirmaan_stack.doctype.tds_items_child_table.tds_items_child_table import (
	on_doctype_update as _member_mirror_indexes,
)


def execute():
	print("[add_tds_membership_indexes] ensuring TDS membership read indexes (idempotent)")

	_items_indexes()
	print('    "tabItems": linked_tds_item index ensured')

	_member_mirror_indexes()
	print('    "tabTDS Items Child Table": parent index ensured')

	frappe.db.sql('ANALYZE "tabItems"')
	frappe.db.sql('ANALYZE "tabTDS Items Child Table"')
	print("    ANALYZE complete on both tables")

	frappe.db.commit()
	print("[add_tds_membership_indexes] done.")
