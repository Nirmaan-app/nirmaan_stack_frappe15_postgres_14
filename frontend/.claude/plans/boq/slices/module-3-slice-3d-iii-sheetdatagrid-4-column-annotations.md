### Module 3 Slice 3d-iii -- SheetDataGrid 4 column annotations

**Status:** COMPLETE (feat 83b63b7b + docs af72632a). Frontend-only. Files changed: `boqTypes.ts`, `SheetConfigPanel.tsx`, `SheetSpokePage.tsx`, `SheetDataGrid.tsx`. No .py files touched. Parser tests 588 unchanged. tsc: 0 errors on boq-wizard files. Vite build: tool not on PATH in Windows Bash; tsc-clean is the acceptance criterion per prior-slice convention.

**STEP 0 -- shared ROLE_LABELS:**
- `export const ROLE_LABELS: Record<string, string>` added to `boqTypes.ts` with 21 entries (exact labels from SheetConfigPanel's former inline literals).
- `SheetConfigPanel.tsx` imports `ROLE_LABELS` and refactors `ROLES_BY_GROUP` to derive labels from it (`label: ROLE_LABELS["sl_no"]` etc.). Group structure, order, and dropdown behavior are byte-for-byte identical; no behavior change.
- **Path taken:** full refactor (not duplication-accepted) -- the change is trivially safe (string lookup, no logic), eliminates future label drift.

**STEP 1 -- SheetSpokePage derived props (no useState, no seed guard):**
- `useMemo` added to React imports.
- `parsedSavedCfg` (`useMemo<Record<string,unknown>|null>`) -- re-parses `draft?.sheet_config` each render when the draft updates. Tracks the saved doc; updates automatically on `mutate()`.
- `savedHeaderRow: number | null` -- `parsedSavedCfg?.header_row` if `typeof === "number"`.
- `savedHrc: 1 | 2` -- `parsedSavedCfg?.header_row_count === 2 ? 2 : 1`.
- `areaList: string[]` -- `parsedSavedCfg?.area_dimensions` if `Array.isArray`.
- All three passed as new props to `<SheetDataGrid>`. No new `useState`; no `initialized` guard -- these are plain derived values.
- **Live-vs-saved asymmetry (by design):** `columnRoleMap` is live state (color/badge/dim update as user edits Section 3 before Save). `savedHeaderRow`/`savedHrc`/`areaList` come from the last-saved doc (freeze and area-color-map update only after Save triggers `mutate()`).

**STEP 2 -- SheetDataGrid 4 annotations:**

**(2a/2b) AREA_COLORS palette + color-by-area:**
- `const AREA_COLORS` (6-element `as const` tuple of Tailwind bg classes): `bg-blue-100 dark:bg-blue-900`, `bg-emerald-100 dark:bg-emerald-900`, `bg-amber-100 dark:bg-amber-900`, `bg-rose-100 dark:bg-rose-900`, `bg-violet-100 dark:bg-violet-900`, `bg-teal-100 dark:bg-teal-900`. All fully opaque (solid, no /opacity suffix) in both light and dark modes -- no bleed-through.
- `buildAreaColorMap(areas: string[]): Record<string,string>` pure function: index-by-position `AREA_COLORS[i % 6]`. Called after early returns (not a hook).
- Column-letter `<TableHead>` `bg-muted` is REPLACED by the area color when `colEntry.area !== null && areaColorMap[colArea]` exists. Single-area/unmapped columns keep `bg-muted`. Both are opaque -- no bleed-through on horizontal scroll.

**(2c) Role badge:**
- `badgeLabel = colRole ? (ROLE_LABELS[colRole] ?? null) : null`.
- Rendered inside a `flex flex-col items-center justify-center` wrapper in `<TableHead>` as a `text-[9px]` `<span>` below the column letter. Background: `bg-black/10 dark:bg-white/15` (semi-transparent overlay works on any area tint color). `max-w-full truncate` prevents overflow.
- Absent for unmapped columns (no role or empty role string).

**(2d) Dim unmapped:**
- `isMapped = col in columnRoleMap && columnRoleMap[col].role !== ""`.
- Data `<TableCell>` receives `opacity-50` when `!isMapped`. Mapped cells render normally. Frozen rows exempt (they are header content, not data).

**(2e) Freeze header rows:**
- Fixed height approach: `h-10` added to ALL column-letter header `<TableHead>` cells (incl. corner). This makes the 40px offset predictable for frozen-row stickiness.
- `isFrozen = headerRow !== null && row.row_number ∈ [headerRow, headerRow + headerRowCount - 1]`.
- `frozenIdx` = 0-based position in the frozen band (0 or 1).
- Frozen row top-offset classes: `frozenIdx === 0 → "top-10"` (40px), `frozenIdx === 1 → "top-20"` (80px).
- Frozen data cells: `sticky z-[15] bg-background h-10 top-{10|20}`. `bg-background` is solid -- no bleed-through on vertical scroll.
- Frozen row gutter cell: doubly-sticky `sticky left-0 z-[17] bg-muted h-10 top-{10|20}`. z-[17] sits above frozen data cells (z-[15]) but below column-letter headers (z-20) and the corner (z-30).
- `headerRow = null` → no rows marked frozen; grid behaves exactly as before.

**z-index stack (complete):**
| Cell | z-index | sticky axes |
|------|---------|-------------|
| Corner `#` | z-30 | top-0 left-0 |
| Column-letter headers | z-20 | top-0 |
| Frozen row gutter | z-[17] | top-X left-0 |
| Frozen row data cells | z-[15] | top-X |
| Body row gutter | z-10 | left-0 |
| Body data cells | (not sticky) | — |

**Manual test plan (3d-iii -- restart Vite + hard-reload :8080 before testing):**
1. **FREEZE 1-ROW:** Open a single-header-row sheet with saved header_row=6 (e.g. "low side"). Scroll vertically -- row 6 stays pinned below the A/B/C letter row; data rows 7+ scroll under it; no bleed-through.
2. **FREEZE 2-ROW:** Open a 2-row-header sheet (hrc=2). Both header rows freeze and stack below the letter row.
3. **COLOR-BY-AREA:** On a multi-area sheet where area_dimensions is saved (e.g. with zones), columns mapped to specific areas show distinct header tints. Single-area/unmapped columns show the default muted header.
4. **ROLE BADGE:** Mapped columns show a small label badge (e.g. "Description", "Quantity") below the column letter. Unmapped columns have none.
5. **DIM UNMAPPED:** Columns not in the role map render at half opacity in data cells. Mapped columns normal.
6. **LIVE vs SAVED:** Edit Section 3 (add/remove a column role) → color/badge/dim update immediately without Save (live columnRoleMap). Edit header row in Section 1 → freeze does NOT update until after Save (saved config). Confirm both.
7. **REGRESSION:** Sticky column-letter header + row-number gutter + load-more still work. Single-area sheet with no area_dimensions shows no tint.

---

