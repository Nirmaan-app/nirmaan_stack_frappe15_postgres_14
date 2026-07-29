### Phase 5 Pricing Editor -- Slice 4a-FE -- annotation frontend (remarks column + color picker + review-list seam) (FRONTEND, feat pending, 2026-06-22)

**Goal.** The frontend half of Slice 4a -- the UI consuming the 4a-BE backend. Two annotation surfaces on the DATA-SHEET
pricing grid. FRONTEND ONLY -- no backend / doctype / test_pricing change; SheetDataGrid + the general-specs path
UNTOUCHED.

**Consumed contract (live from 4a-BE).** `get_priced_rows` rows carry `row["remark"]` (string|null) + `row["color_by_cell"]`
(`{col_letter: token}`). Endpoints (POST): `save_row_remark(boq, sheet, excel_row, committed_version, remark,
description?)` + `save_cell_color(boq, sheet, excel_row, col_letter, committed_version, color, description?)` -- blank
remark/color CLEARS; remark cap 250; a whole-ROW color apply = N save_cell_color calls (FE fans out). 8 tokens:
red/orange/yellow/green/blue/purple/pink/grey. `boqTypes.ts` (additive): `PricedRow.remark?` + `.color_by_cell?`, NEW
`COLOR_TOKENS`/`ColorToken`, `RemarkSaveArgs`/`ColorSaveArgs`.

**Read-only gating reuse (the single root signal -- do NOT add a second).** The grid's editability is the PRESENCE of a
save callback. The page passes `onSaveRemark`/`onSaveColor` ONLY when `!locked` (mirroring `onSaveRate={locked ?
undefined : handleSaveRate}`). Withheld -> remarks/colors render READ-ONLY. General-specs never reaches PricingGrid (the
isGridOnlySheet fork renders SheetDataGrid), so it is annotation-free by construction.

**(1) Remarks column.** A trailing `<th>Remarks</th>` + per-row `<td>` rendered AFTER the `displayDescriptors.map()` (the
established trailing-column pattern; the `RemarkCell` is NOT a descriptor + NOT in the keyboard matrix THIS slice).
`RemarkCell`: editable -> a shadcn `Popover` with a `<Textarea>` (rows 3), a live `{len}/250` counter, Save (disabled
over-cap / not dirty) + Clear; own draft/saving/error state; refresh is the page's mutate. READ-ONLY -> the stored remark
as plain text. **KEYBOARD: CLICK-ONLY this slice -- NOT registered in `cellRefs`, `colCount`/`nextCell` UNCHANGED** (the
nextCell tests stay green; 4a.2 changes this). The trigger `onKeyDown stopPropagation`s so the grid nav never hijacks it.

**(2) Color fill -- a SEPARATE visual channel.** Each descriptor td is now `relative` and hosts a tiny corner
`ColorPicker` trigger (editable only) opening an 8-swatch palette + "Apply to whole row" + "Clear color". **The applied
color renders as a thick LEFT BORDER** (`colorClassForToken(token)` -> `border-l-4 border-l-<color>`), DELIBERATELY a
border NOT a background: the system owns the cell BACKGROUND (emerald=priced / amber=priced-non-priceable) + the priced
dot + the blue inset focus ring, so the four channels (left border, bg fill, dot, ring) never mask each other. (Note: the
in-app channel is the left BORDER; the Excel export = fill is Slice 5, not built here.) Picking calls `onApply(token,
wholeRow)`; the grid maps it to a `ColorSaveArgs[]` -- one cell (`[d.col]`) or `rowColorCells(displayDescriptors)` for
apply-to-row -- and the PAGE owns the N POSTs + ONE mutate. Clear sends `color:""`.

**(3) Page handlers.** `handleSaveRemark` + `handleSaveColor` mirror `handleSaveRate` (the useFrappePostCall idiom):
inFlight count, POST(s) -> `await mutate()`, client-clock `lastSavedAt`, inline `saveError`, and the SAME
`isTakeoverError(BOQ_PRICING_LOCKED)` detection -> a lock-rejected annotation flips `takenOver`. `handleSaveColor` loops
the array sequentially then ONE mutate. **The rate save path is byte-for-byte UNCHANGED** -- annotations are a PARALLEL
write.

**(4) Minimal review-list (the 4b seam).** A "Review (N)" header toggle opens a collapsible strip ABOVE the grid listing
rows with a remark; each entry click-jumps via a NEW `PricingGridHandle.scrollToRow(excelRow)` (resolves excel_row ->
array index through `rowsRef`, focuses+centres the row's col-0 cell). Entries are a GENERIC `{kind:"remark", excelRow,
description, text}` shape derived page-side (no new fetch), so 4b's computed flags push into the SAME list. `reviewOpen`
resets per sheet.

**NEW pure exported helpers (unit-tested):** `colorClassForToken` (token -> border class; "" fail-safe),
`swatchClassForToken` (token -> bg swatch), `rowColorCells(displayDescriptors)` (apply-to-row target cols -- takes ONLY
the descriptors since targets are row-independent; a reported deviation from the prompt's `(row, displayDescriptors)`
sketch), `remarkPreview` (trim + ellipsis past the cap).

**Tests + verification.** Vitest **72 -> 80** (+8: colorClassForToken [8 distinct + fail-safe], swatchClassForToken,
rowColorCells, remarkPreview; the existing nextCell/nav + 3a-3e helper tests UNCHANGED). tsc 3178, 0 in touched; Vite
build exit 0 (PWA 168). NEXT = 4b. (See frontend CLAUDE.md `**Status (... Slice 4a-FE ...)**`.)

