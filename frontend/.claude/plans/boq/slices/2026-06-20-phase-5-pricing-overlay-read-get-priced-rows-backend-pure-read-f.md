## Phase 5 Pricing-overlay read — get_priced_rows (BACKEND, pure-read, feat pending, 2026-06-20)

**Goal.** The composing read between Slice 1b (the pricing-layer doctype + persist) and the editor UI: a new
whitelisted endpoint `get_priced_rows(boq_name, sheet_name)` in `api/boq/wizard/pricing.py` that returns the
committed rows for a sheet WITH the current saved prices merged in — so the future pricing grid consumes ONE
already-merged structure instead of joining two reads on the client. PURE READ: never writes, never mutates the
committed tier, never creates/changes a `BoQ Cell Pricing` record. NO doctype JSON change → NO migrate.

**Composition (reimplements neither source).** Calls `review_screen.get_committed_rows` (imported at module top — no
circular import: review_screen does not import pricing) + this module's `get_sheet_pricing`, then merges. Arg /
not-found guards are inherited from `get_committed_rows` (called first; throws on missing boq_name / sheet_name /
unknown BOQs).

**The one additive change to get_committed_rows (review_screen.py).** Adds a top-level `commit_version` key to its
response — the current committed BoQ Sheet's `commit_version`, selected in the EXISTING sheet read (added to the
`["name","column_role_map","column_headers","commit_version"]` field list) and surfaced on all three return paths
(None on the no-sheet empty path). The overlay reads it as the single source of truth for "which version is current"
and passes it to `get_sheet_pricing` — re-querying in the overlay would be a second source that can race the read.
Purely additive: no existing key or row changed. Two committed-read assertions updated for the additive key
(`test_draft_only_fields_omitted` key-set + value; the uncommitted empty-contract dict-equality).

**The merge (descriptor-driven — col_letter is NOT on the committed row).** The committed row carries rate values by
structure (scalar `rate_supply`/`rate_install`/`rate_combined`; per-area `rate_by_area[area][kind]`), not by column
letter; only `column_descriptors` map a `col` letter to `(value_field, value_key=area, rate_subkey=kind)`. So the
overlay: indexes the current FILLED prices by `(excel_row, col_letter)`; filters descriptors to RATE descriptors only
(`value_field == "rate_by_area"` OR in `{rate_supply, rate_install, rate_combined}` — amount/qty descriptors NEVER
stamped); then for each row × each rate descriptor looks up `(row.source_row_number, descriptor.col)`.
`source_row_number` is the Excel join key (= pricing `excel_row`); `row_index` (= sort_order) is a DIFFERENT integer
space and is never used for the join.

**Stamp + mark.** A matched price stamps its `rate` IN PLACE — `row["rate_by_area"][area][kind]` (setdefault-created
if absent) for per-area, or `row[scalar field]` for scalar — AND sets a parallel marker: `priced_by_area[area][kind]
= True` for per-area cells, `priced_<scalar field>` (e.g. `priced_rate_combined`) = True for scalar cells. THE
correctness rule: priced-ness comes from the PRESENCE of a current price record + its `is_filled` (the index is gated
on `is_filled`), NEVER a zero-check — a committed 0.0 rate is a valid value, and a 0.0-rate save with is_filled=1
reads PRICED. Un-priced cells keep their committed value and carry no marker.

**Reserve-for-lock (forward-compat, nothing built).** The response includes two INERT placeholders — `editable: true`
+ `lock_info: null` — reserved so a future single-editor-lock slice need not reshape the contract. No lock doctype,
no acquire/release, no logic.

**Response.** `{rows (stamped + markers), column_descriptors (passthrough from get_committed_rows), commit_version,
editable: true, lock_info: null}`. Graceful empties: an uncommitted / grid-only sheet (no rows or no commit_version)
returns the same shape with pricing merged as a no-op (no throw; get_sheet_pricing is not called).

**Tests (bench-verified in-session).** `test_pricing` **12 → 22** (+10 `TestGetPricedRows`, reusing the shared
`build_committed_sheet_fixture` + a NEW local `_build_scalar_rate_committed_sheet` since the shared per-area fixture
has no scalar rate column): priced+unpriced in one row; zero-rate-is-priced (the load-bearing correctness test —
a zero-check marker would fail it); multi-area independence; commit_version passthrough; reserved editable/lock_info
placeholders; scalar-rate cell (un-priced baseline → priced); descriptors pass through unchanged; uncommitted empty
merged shape; missing-args / unknown-boq throw; NO amount/qty stamping. `test_review_screen` **205 → 205** (the
commit_version assertions folded into existing committed-read tests — net count unchanged). Frontend NOT touched
(backend-only slice; `frontend/CLAUDE.md` minimal-touch per the DOCS-UPDATE RULE).

---

