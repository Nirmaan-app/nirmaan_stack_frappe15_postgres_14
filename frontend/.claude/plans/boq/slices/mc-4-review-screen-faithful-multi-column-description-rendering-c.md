## MC-4 -- review screen faithful multi-column description rendering COMPLETE

Fans the review screen's single Description anchor (the joined string) into ONE COLUMN PER mapped
description column, faithful originals. Frontend-only; two commits (feat + this docs). No backend/schema.
`reviewRender.test.ts` 12 -> 25; tsc scoped gate 0 errors; build green.

**Data source (locked, MC-3b):** every draft row ships `description_parts_raw` from `get_review_rows` --
`[col_letter, header_label, cell_text]` triples (list-of-lists after JSON round-trip), real labels since
MC-3b. Added `description_parts_raw: string[][] | null` to `ReviewRow` (boqTypes.ts).

**Three pure helpers (reviewRender.tsx, unit-tested):** `buildDescriptionColumns(columnDescriptors, rows)`
-- column SET+ORDER from the `role:"description"` descriptors (Excel order; NOT a single row's parts, since
blanks are absent per-row); LABEL via **union-across-rows** (first row carrying a triple for the column
wins; letter fallback when none); **" 2"/" 3" suffixes** on duplicate labels in column order; `headerText`
= `` `${label} (${col})` `` or the bare letter when `label===col` (avoids "C (C)"). `descriptionCellValue(row,
col)` -- per-cell text by `col_letter`; absent/null/legacy -> `""`. `sheetHasDescriptionParts(rows)` -- the
once-per-sheet **legacy detector**.

**ReviewTree.tsx fan-out (~10 touch points):** the FIRST description column is the wide (`min-w-[280px]`)
always-on anchor -- depth indent + `(no description)` fallback via a shared `DescriptionCellInner`; the
REMAINING columns are narrower (`min-w-[160px]`) `sticky top-0 z-20 bg-muted` cells that JOIN the show/hide
picker. A new `pickerColumns` abstraction drives the picker + `hiddenColCount` + `totalCols`; it lists the
**extra description columns FIRST, then the ordinary descriptor columns** (MC-4-fix) so the picker mirrors
the table's leftmost-description visual order (order is presentation-only -- the counts are order-independent
`.filter`s), with description entries in the **letter-first** picker format `${col} — ${label}` (bare letter
when degenerate) matching the other columns -- NOT the `${label} (${col})` table-header format (MC-4-fix2); `visibleCols` init/sync seed the extra description LETTERS from
the DESCRIPTORS (stable per sheet, so a cell edit never resets hidden columns). `totalCols` keeps base `8`
(the first/legacy anchor) + extra visible description cols -> every `colSpan` (flag-reasons + detail panel)
stays aligned. `FIXED_ROLE_DEDUPE` unchanged (description stays out of `displayDescriptors`; the fan-out
REPLACES the anchor, does not duplicate into descriptors).

**LEGACY FALLBACK (A10 compat contract):** when `sheetHasDescriptionParts(rows)` is false (drafts parsed
pre-MC-2), the single Description anchor renders via the SAME shared `DescriptionCellInner` -- byte-identical
screen. `pickerColumns === displayDescriptors` and `totalCols` are identical by construction. The shared
inner (one source, not a drifting copy) IS the compat mechanism.

**Verified unaffected, unmodified (per owner scope):** search (`fuzzyDescriptionMatchSet` on the still-present
joined `row.description`), the row-level search-highlight ring, and the detail panel (never renders
`row.description`). OUT OF SCOPE and untouched: `exportReviewCsv.ts` (exports keep the single joined
Description -- owner-deferred), `PricingGrid.tsx` + pricing (MC-5), `SheetConfigPanel.tsx`, all backend.

**Width choice:** first description column `min-w-[280px]` (unchanged from the old anchor); each extra
description column `min-w-[160px]`.

**Tests (+13):** `buildDescriptionColumns` (set/order, label union, letter fallback, " 2"/" 3" suffix,
headerText formats incl. label==letter), `descriptionCellValue` (present/absent/null/legacy -> value/""),
`sheetHasDescriptionParts` (carrying/all-null/empty). Existing 12 pass unmodified.

