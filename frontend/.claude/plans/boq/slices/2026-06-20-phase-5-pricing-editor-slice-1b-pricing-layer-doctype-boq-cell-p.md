### Phase 5 Pricing Editor -- Slice 1b -- pricing-layer doctype BoQ Cell Pricing + save_cell_price + get_sheet_pricing (BACKEND, MIGRATE, feat pending, 2026-06-20)

**Goal.** Creates the per-cell PRICING LAYER -- a NEW standalone doctype **`BoQ Cell Pricing`** (autoname
**`BPRC-.YY.-.#####`**, istable:0, track_changes:1) that stores the RATE a user fills into a committed Excel cell,
sitting ON TOP of the committed tier (NEVER mutates it -- nodes/grid/BoQ Sheet stay capture-only). ADDITIVE: no existing
doctype JSON changed -> ONE `bench migrate` (clean; doctype + 15 columns verified at runtime).

**Identity tuple (load-bearing -- a future slice must respect it).** `(boq, sheet_name [VERBATIM #152], excel_row,
col_letter, committed_version)` -- the durable Excel address + the committed version it prices (survives a re-commit).
`col_letter` is STORED (derived from `column_role_map` by `(role,area)->letter`, NOT on the node); `node`
(Link->BOQ Nodes) is a re-resolvable per-version pointer + `description` a copy-forward match guard -- NEITHER is part of
the key. `is_filled` (Check) is the layer's OWN filled-state (committed node rates read 0.0, not blank, so a separate
filled flag is required).

**Pricing lifecycle = its OWN freeze-and-supersede triple** `pricing_version` / `is_current` / `priced_at` (mirroring
the committed tier) + an `is_finalized` lock (declared, enforced later). Bare-stub controller -- the one-current
invariant is ENDPOINT-enforced (in `pricing.py`), NOT in the controller (no hooks.py wiring; mirrors the
pricing/committed convention).

**Endpoints (NEW `api/boq/wizard/pricing.py`).** `save_cell_price` (POST) -- freeze-and-supersede upsert mirroring
commit_pipeline's `_current_names`/`_next_commit_version`: freeze prior via `set_value`, insert new `is_current=1` /
`pricing_version=max+1` / `is_filled=1`; RESOLVES + VALIDATES the committed cell exists (throws for a non-cell), stores
the resolved node. `get_sheet_pricing` (GET) -- the current pricing set for a `(boq, sheet, committed_version)`. Guards
mirror `get_review_rows`.

**Hermetic fixture (folds in the owed Slice-1a fixup).** `build_committed_sheet_fixture` / `cleanup_committed_fixture`
(in `test_review_screen.py`) converted the 5 `get_committed_rows` positives from live-skip-guard to always-run (no
skip); `test_pricing.py` imports the shared builder.

**Tests.** `test_review_screen` **205 -> 205** (5 positives converted in place, net unchanged, no skips); NEW
`test_pricing` **12** (save/re-save freeze-and-supersede + exactly-one-current invariant + multi-area distinct + read +
NEG non-existent cell/version/sheet/boq/missing-args). OUT: the overlay-onto-1a read (= `get_priced_rows`, separate
section), finalize endpoints, copy-forward, frontend. (See root CLAUDE.md `// prior:` "Phase 5 Slice 1b".)

