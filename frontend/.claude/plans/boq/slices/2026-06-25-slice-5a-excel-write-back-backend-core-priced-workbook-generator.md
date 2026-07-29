### Slice 5a -- Excel write-back BACKEND core (priced-workbook generator) (BACKEND, MIGRATE [additive field], base tip e9833dc5, 2026-06-25)

**NEW module `nirmaan_stack/api/boq/wizard/export_writeback.py` + endpoint `export_priced_workbook(boq_name, sheet_names)`**
(a sibling module, NOT folded into the 2076-line pricing.py per the >500-line split rule). Preceded by two Checklist-B-PASS
recons (DATA SHAPE + WRITE-PATH MECHANICS). BACKEND-ONLY -- the hub UI is **Slice 5b (NEXT)**.

**The write-back contract as built (owner-locked, governing principle 0 -- the tendering doc is client-owned; we write RATES
only + the user's own color/remark annotations; NEVER amounts/formulas/structure):**
- **Resolve current version server-side.** The client passes only `boq_name` + `sheet_names` (a list; JSON-string coerced
  via `_coerce_names`, mirrors `commit_pipeline._coerce_subset`). `_resolve_sheet_plan` reads the CURRENT committed
  `BoQ Sheet` per sheet (is_current=1) -> name / commit_version / treat_as / column_role_map / header_row; throws "No
  committed version" if absent. The client NEVER passes a version.
- **COPY-ON-WRITE.** `_fetch_boq_file_to_tempfile(source_file_url)` (reused from sheet_preview) -> `shutil.copy` to a second
  temp; ONLY the copy is stamped + saved; the original temp and the S3 object are NEVER written. Both temps unlinked in a
  `finally`. (Chosen over fetch-and-stamp-that-temp for an explicit immutable-original guarantee.)
- **`openpyxl.load_workbook(copy, data_only=False)`** -- formulas preserved as strings. The `data_only=True` trap (loads
  cached VALUES, discards formulas on save) is explicitly avoided + documented.
- **RATES ONLY + PER-CELL FORMULA SKIP (`_stamp_rates`).** For each current+is_filled `BoQ Cell Pricing` row, stamp `rate`
  into `(col_letter, excel_row)` -- BUT if `cell.data_type == 'f'` the cell is LEFT UNTOUCHED and recorded as a skipped
  formula-rate column (decided against the REAL file, never inferred from the role name -- e.g. a VRF combined-rate
  `=SUM(supply,install)`). Returned per-sheet as `skipped_formula_columns` (unique col_letters) for 5b to surface (the 0
  requirement: tell the user which rate columns we left untouched).
- **COLOR -> PatternFill (`_apply_colors`).** For each current `BoQ Cell Color`, a solid `PatternFill(fgColor=hex)` at the
  tagged `(col_letter, excel_row)` -- ANY column incl. non-rate (a description cell). A fill sets ONLY `.fill`; the cell
  `.value`/formula is never touched (NOT subject to the formula-skip rule -- a colored formula cell keeps its formula).
  **The 8 token->hex map is DECIDED HERE** (`_COLOR_HEX`, the one place a hex is chosen -- light, distinct tints so cell
  text stays readable): red `FFC7CE`, orange `FFD9A0`, yellow `FFEB9C`, green `C6EFCE`, blue `BDD7EE`, purple `E1D5F7`,
  pink `FBD4E4`, grey `D9D9D9`.
- **REMARK -> "Nirmaan Remarks" TRAILING COLUMN (`_write_remark_column`).** The column lands **one past the TRUE DATA EDGE**
  = `_rightmost_mapped_col_index(column_role_map) + 1` (the rightmost MAPPED letter from the committed `column_role_map` --
  deliberately NOT openpyxl `max_column`, which recon found inflated by empty styled cells out to AC/Z/AS). **HARD SAFETY
  CHECK `_col_is_empty`:** if the target column carries ANY value/formula across the sheet, the export THROWS (never
  overwrite real data). Header `"Nirmaan Remarks"` at `header_row`; each `BoQ Cell Remark.remark` at its `excel_row`.
- **POST-SAVE FIDELITY ASSERTION (`_fidelity_snapshot` + `_assert_fidelity`).** After save, re-open the saved copy and assert
  the four invariants are unchanged vs the pre-stamp copy: total formula-cell count, merged-range count, worksheet count,
  defined-name count. A mismatch FAILS the export with a naming error (reject-mutates-nothing -- no file returned, no
  last_exported_at stamp). (Recon: 145 carries 33 conditional formats, 166 carries 4585 defined names; live verify passed.)
- **`last_exported_at` (NEW additive `Datetime` on BoQ Sheet).** Stamped per exported sheet AFTER the fidelity pass via
  `frappe.db.set_value(..., update_modified=False)` -- NOT `doc.save` (the list-valued `area_dimensions` JSON throws on a
  full save; mirrors the commit pipeline's set_value-on-this-tier idiom). Drives the future "pricing changed since last
  export" signal (compared against `MAX(BoQ Cell Pricing.priced_at)` on the current version -- recon #2 C2).
- **Grid-only general-specs sheets** (`treat_as == "master_preamble"`) pass through UNTOUCHED (no stamp) but still count as
  exported (ticked => last_exported_at stamped).
- **RETURN = base64-in-JSON (NOT `frappe.local.response.filecontent`).** The file-only download idiom cannot carry the
  skipped-formula report alongside the bytes, so ONE JSON response carries both:
  `{filename, content_type, content_base64, exported_sheets, skipped_formula_columns, remark_columns, last_exported_at}`.
  5b decodes `content_base64` -> Blob -> browser download (reusing the existing exceljs-export download tail) and surfaces
  `skipped_formula_columns`. The whitelisted endpoint is a thin shell (validate -> fetch S3 -> copy -> `_generate_priced_workbook`
  -> cleanup); the worker `_generate_priced_workbook(boq, sheet_names, src_path)` takes an already-fetched copy path so tests
  inject a synthetic workbook and bypass S3.

**Tests:** `test_pricing` 126 -> 145 (+19). `TestExportWritebackPureHelpers` (hermetic, synthetic workbooks): stamp lands +
paired formula preserved; formula-skip (the =SUM case) reported; formula-vs-value-vs-blank distinguished; color fills any
cell incl. a formula cell; unknown token skipped; rightmost-mapped-edge; remark column at the true edge; remark refuses a
non-empty target; col-is-empty (a real 0 is data); fidelity clean round-trip PASSES; fidelity FAILS on each of the four
invariants diverging (non-vacuous). `TestExportWritebackEndToEnd` (committed fixture + injected synthetic workbook): stamp +
last_exported_at set_value; skipped-formula reported; remark column; color fill survives the round-trip; neg
(uncommitted-sheet / unknown-boq / empty-list / missing-boq throw). **Live end-to-end verify on all three canonical BoQs
(145/150/166): fidelity PASSES, incl. 166's 4585 defined names; 145's J remark column confirmed against a genuinely-empty
column.** `bench migrate` landed `last_exported_at` (the schema sync runs BEFORE the pre-existing unrelated
`backfill_cashflow_gap_limited` patch wart, which aborts the patch phase -- NOT this slice's, NOT fixed). NO Vitest/tsc
(backend-only). **NEXT = Slice 5b (hub UI: export picker mirroring CommitDialog + the base64->Blob download + the
skipped-formula + staleness surfacing).**

**Amendment (2026-06-25) -- priced-cell verification highlight (BACKEND, no schema/migrate, commit 95f07c47):** an
ALWAYS-ON Nirmaan-facing "which cells did we write" aid -- a muted-teal solid PatternFill (`_PRICED_HIGHLIGHT_HEX =
"B7E4D8"`, a SEPARATE constant from the 8 user tokens in `_COLOR_HEX`, distinct from user green C6EFCE / blue BDD7EE so a
system mark never reads as a user tag) on every rate cell the write-back ACTUALLY stamped. **RULE 1 (stamped-only):**
`_stamp_rates` now returns `(skipped, written)` and the new `_apply_priced_highlight` is driven by `written`, so a SKIPPED
formula rate cell (data_type=='f', e.g. a VRF combined-rate `=SUM`) gets NO teal -- teal doubles as the live signal of the
rates-only + formula-skip rule (no-teal on a rate cell = the client's formula was left untouched). **RULE 2 (system wins):**
`_apply_priced_highlight` runs AFTER `_apply_colors` in the per-sheet pass, so on a stamped rate cell that ALSO carries a
user color tag the teal lands last and WINS (the aid must be exhaustive over written cells -- the ONE place a system fill
beats a user fill); a user color on a NON-stamped cell is untouched. **RULE 3:** only stamped RATE cells (never
remark/amount cells, never the Nirmaan Remarks column). A fill sets only `.fill` -- the stamped rate value is untouched; the
post-save fidelity assertion is unaffected (a fill changes no formula/merge/sheet/defined-name count). NO schema / NO
migrate. `test_pricing` 145 -> 151 (+6); live-verified on 145 Electrical (stamped E24/H24/E34 carry teal, amount F36 does
not, version-isolated to the current committed version). NO frontend (Vitest/tsc N/A).

