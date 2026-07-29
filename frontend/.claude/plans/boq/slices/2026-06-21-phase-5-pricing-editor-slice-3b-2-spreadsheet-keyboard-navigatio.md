### Phase 5 Pricing Editor -- Slice 3b.2 -- spreadsheet keyboard navigation (FRONTEND, feat pending, 2026-06-21)

**Goal.** Makes the WHOLE pricing grid arrow/Tab/Enter navigable like Excel (design v1.3 Sec.11): every cell focusable,
rate cells edit-on-focus, every other cell holds focus. PricingGrid.tsx ONLY -- reuses commitRate/onSaveRate, NO
save-model change, NO SheetPricingPage/input.tsx touch, NO backend.

**THE KEYBOARD-NAV MATRIX CONTRACT (load-bearing -- 4a.2 + later slices extend it, never reshape it).**
- **Focus model = roving-tabindex + per-cell ref map.** `activeCell {rowIndex, colIndex} | null` state; `cellRefs:
  useRef<Map<string, HTMLElement>>` keyed `${rowIndex}:${colIndex}`. **`rowIndex` is the ARRAY INDEX into `rows`**
  (`rows.map((row, rowIdx) => …)`) -- contiguous +/-1 movement (NOT `row.row_index`). `colIndex`: 0-4 = the 5 fixed
  anchors (`FIXED_ANCHOR_COUNT = 5`: Excel Row / Sl.No / Parent / Classification / Description), `5..(5+N-1)` =
  `displayDescriptors` (`colIndex = FIXED_ANCHOR_COUNT + dIdx`). `colCount = 5 + displayDescriptors.length`. Focus target
  per cell differs: a RATE cell's `<input>` gets the ref/tabIndex/onFocus (`inputFocusProps`); every other cell's `<td>`
  does (`tdFocusProps`). Roving: the active cell (or (0,0) before any focus) is `tabIndex=0`, the rest `-1`.
- **`nextCell(active, dir, rowCount, colCount)` (pure, exported, unit-tested).** Arrows move one cell + return null at
  edges (NO wrap). Tab: right, else wrap to next row col 0, else null (last cell -> STOP). Shift-Tab: left, else wrap to
  prev row last col, else null (first cell -> STOP). Enter maps to "down". Returns `{rowIndex,colIndex}` or null.
- **One `<table onKeyDown={handleGridKeyDown}>` handler** (keydowns bubble up): maps key -> direction, **ALWAYS
  `preventDefault`s a nav key while activeCell is set** (arrows never move the caret, Tab never escapes the grid), calls
  `commitActiveRate(activeCell)` (explicit commit-on-move), then `focusCell(next)` (`.focus()` + `scrollIntoView`).
- **Commit-on-move = explicit, dedupe-safe.** `commitActiveRate` calls the EXISTING `commitRate`; its
  `committedAttemptRef` dedupe absorbs the trailing onBlur. Save behaviour byte-for-byte unchanged.
- **`type="number"` -> `type="text" inputMode="decimal"`** so Arrow keys are free for nav; a `DECIMAL_IN_PROGRESS` regex
  (`/^-?\d*\.?\d*$/`) rejects letters/multiple dots. Active cell = blue inset ring + `scroll-mt-9` to clear the sticky
  header. Read-only cells (anchors/amount/qty) are focusable but not editable; when `onSaveRate` is absent the grid
  degrades to read-only and nav still works.

**Tests + verification.** `PricingGrid.test.ts` 18 -> **22** (+4 `nextCell` tests: arrow edge-stops/no-wrap; Tab
right+wrap+last-cell-stop; Shift-Tab left+wrap+first-cell-stop; Enter-down+bottom-stop). Vitest **34/34 GREEN**; tsc
3178, 0 in touched; Vite build exit 0 (PWA 166). (See frontend CLAUDE.md `**Status (... Slice 3b.2 ...)**`.)

