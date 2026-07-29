## D3d follow-up -- read-index migrate patch (deploy the two indexes to existing DBs) COMPLETE

Branch `fix/boq-read-index-patch` off develop `a7b8237c`; patch commit `4aee8a89`, docs commit follows.
The D3d indexes were added as `on_doctype_update` hooks (commit `dd4ba4a3`), but a TEST-SERVER DEPLOY
confirmed the MIGRATE GOTCHA in the flesh: a plain `bench migrate` does NOT fire `on_doctype_update` for a
controller-only change of an already-synced doctype, so every deployed environment silently MISSED both
indexes and kept COLD Seq-Scanning the read tables (the same `get_priced_rows` ~5.5 s / `get_committed_sheet_grid`
322 ms cold spikes the D3d EXPLAIN captured -- Seq Scan on `tabBoQ Committed Sheet Grid Row` by `parent`
(269,708 rows) and on `tabBoQ Row Category` by the composite filter). This slice makes the fix ride migrate.

- **The patch (`nirmaan_stack/patches/v3_0/add_boq_read_indexes.py`, NEW, single file).** `execute()` IMPORTS and
  CALLS the two controllers' own `on_doctype_update()` -- `boq_committed_sheet_grid_row` (parent index) +
  `boq_row_category` (composite (boq, sheet_name, committed_version, discipline, is_current)) -- then `ANALYZE`s
  both tables (fresh index has no planner stats until analyzed) and `frappe.db.commit()`s (app norm; 51 v3_0
  precedents, and the DDL precedent `boq_commit_current_unique_guard.py` commits the same way). CALL-the-hook,
  do NOT re-inline `add_index`: the controllers stay the single source of truth for the index shape, so the
  patch can never drift from the live schema-sync path. Idempotent -- `add_index` no-ops when the index exists.
- **BoQ Category Truth Snapshot DELIBERATELY EXCLUDED (recon Q6).** Its `on_doctype_update` index shipped
  ATOMICALLY with the NEW doctype (commit `8db7d5fb`) -- there was never a controller-only-change window for it,
  so a fresh schema sync always fires the hook when its table is first created. No deployed env can be missing
  it; adding it to the patch would be redundant.
- **PENDING (Abhishek, external -- patches.txt is permanently out of scope for this slice).** Wire the patch by
  adding this exact line under `[post_model_sync]` in `nirmaan_stack/patches.txt`:
  `nirmaan_stack.patches.v3_0.add_boq_read_indexes`
- **VERIFICATION (live idempotency run against the dev site DB, twice -- NOT a test suite; a patch module has no
  unit-test harness precedent in this app).** NOTE: the dev DB did NOT already have the indexes (only the pkey) --
  consistent with the bug, so this DOUBLED as a create-path proof. RUN 1 (indexes absent = the deploy scenario):
  `execute()` completed with NO exception and CREATED exactly `parent_index` on `tabBoQ Committed Sheet Grid Row`
  and `boq_sheet_name_committed_version_discipline_is_current_index` on `tabBoQ Row Category` (index defs match
  the hook shapes byte-for-byte). RUN 2 (indexes now present = idempotency): completed with NO exception, `pg_indexes`
  delta added=[] removed=[] on both tables -- a clean no-op, no duplicate index. Driver = direct `frappe.init` +
  container `env/bin/python` (bench execute is flaky here -- spurious NameError, per the D3d note above).


