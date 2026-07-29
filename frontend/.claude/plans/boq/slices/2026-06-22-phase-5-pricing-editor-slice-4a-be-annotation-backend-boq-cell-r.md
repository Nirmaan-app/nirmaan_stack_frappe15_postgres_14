### Phase 5 Pricing Editor -- Slice 4a-BE -- annotation backend (BoQ Cell Remark + BoQ Cell Color) (BACKEND, MIGRATE, feat pending, 2026-06-22)

**Goal.** Two USER-AUTHORED annotation layers on the pricing editor, stored ADDITIVELY on top of the committed tier
exactly like `BoQ Cell Pricing` (anchored to the durable Excel address + committed version, own freeze-and-supersede
triple) -- but carrying NO rate/priceability/lock-identity semantics, so TWO SEPARATE doctypes (NOT folded onto BoQ Cell
Pricing). **DATA SHEETS ONLY** -- general-specs (grid-only) sheets are read-only reference and get no annotation;
`get_committed_sheet_grid` / `SheetDataGrid` are UNTOUCHED. Committed tier NEVER mutated.

**THE TWO ANNOTATION DOCTYPES (load-bearing keying).**
- **`BoQ Cell Remark`** -- per-ROW; istable:0, track_changes:1, autoname **`BRMK-.YY.-.#####`**. IDENTITY = `(boq,
  sheet_name [VERBATIM #152], excel_row, committed_version)` -- **NO `col_letter`** (per-row); `remark` (Small Text);
  `description` (Small Text -- the copy-forward MATCH GUARD for the future Slice-7 copy-forward, NOT part of the key,
  never branched on, exactly like BoQ Cell Pricing.description); lifecycle triple `remark_version` / `is_current` /
  `remarked_at`.
- **`BoQ Cell Color`** -- per-CELL; autoname **`BCLR-.YY.-.#####`**. IDENTITY = `(boq, sheet_name, excel_row, col_letter,
  committed_version)`; `color` (Select, reqd, **EXACTLY 8 stable string tokens -- red/orange/yellow/green/blue/purple/
  pink/grey -- NOT hex**; the frontend maps token->swatch); `description` match-guard; lifecycle triple `color_version` /
  `is_current` / `colored_at`.

Both controllers are bare stubs (`pass`); the **one-current invariant is ENDPOINT-enforced (pricing.py), NOT in the
controller** (mirrors the pricing/committed convention).

**Endpoints + the merge (pricing.py).** `save_row_remark(boq, sheet, excel_row, committed_version, remark,
description=None)` + `save_cell_color(boq, sheet, excel_row, col_letter, committed_version, color, description=None)`
(both `@frappe.whitelist(methods=["POST"])`): each RESOLVES the committed ROW via the SAME row-level
`_resolve_committed_cell` save_cell_price uses (it keys on the node's `source_row_number`, NOT col_letter, and -- crucially
-- does NOT gate on node_type, so reusing it imposes NO priceability gate; the 3e priceability guard lives INLINE in
save_cell_price only). **So a COLOR (and a remark) is allowed on ANY committed cell -- non-priceable, zero-rate, anything
-- where a PRICE would be rejected** (a test proves the contrast). Both then ACQUIRE/REFRESH the single-editor lock
(`acquire_or_refresh`) AFTER the resolve + BEFORE any freeze/insert (a lock reject mutates NOTHING), then
freeze-and-supersede upsert (freeze prior `is_current` via set_value, insert new at version max+1) + one
`frappe.db.commit()`. Remark cap 250 (`_REMARK_MAX_LEN`) -> throw; color must be one of the 8 tokens -> throw. **CLEAR
semantics:** a blank/whitespace remark OR color FREEZES the prior current and inserts NO new current (reads as "no
remark"/"no color" -- will not appear in the review-list). `get_sheet_remarks` / `get_sheet_colors` (bare whitelist,
GET-capable, mirror get_sheet_pricing) return the current set.

**get_priced_rows MERGE shape (the per-row loop -- the contract Slice 4a-FE consumes).** Builds a remark index
(excel_row->text) + a color index (excel_row->{col_letter:token}) ONCE before the loop (no per-row query), then stamps
**`row["remark"]`** (None when absent) + **`row["color_by_cell"]`** (`{col_letter:token}`, only on rows that have a
color). The "nothing to merge" early-return now also accounts for remarks/colors (not just prices) so an annotation-only
sheet still merges.

**Tests.** `test_pricing` 47 -> **63** (+16: `TestRowRemark` 7 -- save/v1, freeze-and-supersede/v2,
clear-reads-as-none, 250-ok/251-throw, non-existent-row-throw, lock-held-by-other-rejects-mutates-nothing,
get_priced_rows surfaces remark; `TestCellColor` 9 -- save/v1, freeze/v2, all-8-tokens-accepted, invalid-9th-throws,
COLOR-ON-NON-PRICEABLE-CELL [the contrast: a price there is rejected, a color is accepted], clear-no-current,
non-existent-row-throw, lock-reject, get_priced_rows surfaces color_by_cell). `bench migrate` CLEAN -- BoQ Cell Remark 20
cols / BoQ Cell Color 21 cols, both istable 0, verified via information_schema. NO change to the committed tier /
get_committed_sheet_grid / SheetDataGrid. NEXT = Slice 4a-FE. (See root CLAUDE.md current header block "Phase 5 Slice
4a-BE".)

