# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Apply the two D3d read indexes to already-deployed databases.

WHY THIS PATCH EXISTS
    D3d (commit dd4ba4a3) added two `on_doctype_update()` index hooks -- one on
    `BoQ Committed Sheet Grid Row` (parent index) and one on `BoQ Row Category`
    (composite read index). Those hooks were CONTROLLER-ONLY changes to doctypes
    that were already synced in every deployed environment. A test-server deploy
    confirmed that a plain `bench migrate` does NOT re-sync a doctype whose JSON
    is unchanged, and therefore does NOT fire `on_doctype_update` -- so the two
    indexes silently never land, and the reads they cover (get_committed_sheet_grid
    by `parent`; get_sheet_categories / set_human_verdict on the composite) keep
    Seq-Scanning. This patch calls the hooks explicitly so the fix rides migrate.

    Calling the hooks (rather than re-inlining the `add_index` calls) is
    deliberate: the controllers stay the single source of truth for the exact
    index shape, so this patch can never drift from the live schema-sync path.

IDEMPOTENT
    `frappe.db.add_index` no-ops when the index already exists, so this patch is
    safe to run against environments that DO already have the indexes (e.g. the
    dev site, or a fresh env that got them at first sync). Re-runs are no-ops.

TRUTH SNAPSHOT DELIBERATELY EXCLUDED
    `BoQ Category Truth Snapshot` also declares an `on_doctype_update()` index,
    but its hook shipped ATOMICALLY with the new doctype (commit 8db7d5fb) -- there
    was never a controller-only-change window for it. A fresh schema sync always
    fires the hook when the doctype's table is first created, so no deployed
    environment can be missing that index. Adding it here would be redundant.

The corresponding patches.txt wiring
(`nirmaan_stack.patches.v3_0.add_boq_read_indexes` under [post_model_sync]) is
added separately by the maintainer -- it is intentionally not part of this patch.
"""

import frappe

from nirmaan_stack.nirmaan_stack.doctype.boq_committed_sheet_grid_row.boq_committed_sheet_grid_row import (
    on_doctype_update as _grid_row_indexes,
)
from nirmaan_stack.nirmaan_stack.doctype.boq_row_category.boq_row_category import (
    on_doctype_update as _row_category_indexes,
)


def execute():
    print("[add_boq_read_indexes] ensuring D3d read indexes (idempotent)")

    # Single source of truth: call the controllers' own hooks, do not re-inline
    # the add_index shape. add_index no-ops if the index already exists.
    _grid_row_indexes()
    print('    "tabBoQ Committed Sheet Grid Row": parent index ensured')

    _row_category_indexes()
    print('    "tabBoQ Row Category": composite read index ensured')

    # Refresh planner statistics so the freshly-created indexes are actually
    # chosen on already-populated tables (a brand-new index has no stats until
    # ANALYZE runs; without it PostgreSQL may keep Seq-Scanning until autovacuum).
    frappe.db.sql('ANALYZE "tabBoQ Committed Sheet Grid Row"')
    frappe.db.sql('ANALYZE "tabBoQ Row Category"')
    print("    ANALYZE complete on both tables")

    frappe.db.commit()
    print("[add_boq_read_indexes] done.")
