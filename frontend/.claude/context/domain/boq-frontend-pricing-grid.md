# BoQ Frontend — Pricing Editor: grid contract

> PricingGrid keyboard-nav matrix, row-level memoization, read-only gating, the asymmetric rate-edit gate, Esc-to-exit, annotation rendering.

> Split from `boq-frontend.md` (287KB) on 2026-07-29. Surfaces and pricing clusters defined by the owner.

## Contents

- Pricing grid keyboard-nav matrix (`PricingGrid.tsx`) -- the current contract
- Row-level memoization contract (`PricingGrid.tsx`, editor perf fix -- the load-bearing render rule)
- Read-only gating = PRESENCE of the save callback (the single root signal -- do NOT add a second)
- Rate-edit gate is ASYMMETRIC by node_type (`PricingGrid.isRateEditableRow`, owner-locked)
- Relocating the trigger to the prominent leading badge IS the render-bug fix.
- NOT
- Esc-to-exit
- Cross-area prefill save-path invariant (`PricingGrid.tsx`)
- Annotation render conventions (`PricingGrid.tsx`)

---

**Pricing grid keyboard-nav matrix (`PricingGrid.tsx`) -- the current contract:** roving-tabindex + a per-cell ref map
`cellRefs: useRef<Map<string,HTMLElement>>` keyed `${rowIndex}:${colIndex}`, where **`rowIndex` is the ARRAY INDEX into
`rows`** (not `row.row_index`). `colIndex`: 0..4 = the 5 fixed anchors (`FIXED_ANCHOR_COUNT = 5`: Excel Row / Sl.No /
Parent / Classification / Description); `FIXED_ANCHOR_COUNT + dIdx` = the descriptor columns; the trailing **Remarks**
column is `remarksColIndex = FIXED_ANCHOR_COUNT + displayDescriptors.length` and **`colCount = remarksColIndex + 1`**
(the +1 widens only `nextCell`'s right/Tab boundary -- it is the live post-4a.2 form; the remarks cell joined the matrix
in 4a.2). Focus target per cell differs: a RATE cell's `<input>` carries the ref/tabIndex/onFocus (`inputFocusProps`),
every other cell's `<td>` does (`tdFocusProps`); `onFocus` sets `activeCell`. Pure exported `nextCell(active, dir,
rowCount, colCount)`: arrows move one cell + STOP at edges (no wrap); Tab = right then wrap to next row col 0 then STOP;
Shift-Tab = reverse; Enter maps to "down". One `<table onKeyDown={handleGridKeyDown}>` handler maps key->dir, ALWAYS
`preventDefault`s a nav key while activeCell is set, calls `commitActiveRate(activeCell)` (commit-on-move; `commitRate`'s
`committedAttemptRef` dedupe absorbs the trailing onBlur -- save behaviour unchanged), then `focusCell(next)`. The rate
`<Input>` is `type="text" inputMode="decimal"` (frees the arrows) with a `DECIMAL_IN_PROGRESS` regex guard. Enter on the
remarks cell opens its editor (a controlled `RemarkCell`, open-state lifted to the grid as `openRemarkRowIdx`); Enter
inside the editor = save-and-move-down via the SAME `nextCell(..., "down")` path; Esc closes. **Extend this matrix
(colCount, focus targets) for new columns; never reshape the rate-cell nav.**

**Row-level memoization contract (`PricingGrid.tsx`, editor perf fix -- the load-bearing render rule):** the per-row
`<tr>` is a `React.memo`'d **`PricingGridRow`** (comparator `pricingRowPropsAreEqual`, both exported for unit test). The
cursor (`activeCell`) is grid-local state, so a cursor move (arrow key / click) re-renders `PricingGrid`; without per-row
memoization the WHOLE table (every row x every cell, an `evaluateAmountCell` at each amount cell) re-rendered per
keystroke -- the felt lag on big sheets (Electrical 194 / VRF 121). Now a cursor move re-renders only the **2** rows
whose active-state flipped, and a keystroke only the **1** edited row. **THE LOAD-BEARING ANTI-DEFEAT RULE: a memoized
row must NEVER receive the shared `draftRates` / `proposedRates` object** (a keystroke makes a new reference -> all rows
re-render -> memo silently defeated). Each row gets ONLY its own slice via **`groupDraftsByRow`** (exported, unit-tested):
per-row sub-maps keyed by the FULL `${row_index}:${col}` key, **reference-REUSED** from the prior render (a `useRef` +
`useMemo([draftRates])`) so an unrelated row's slice identity is stable across a keystroke. **The cursor lever** is the
`activeColIndex: number | null` prop (= `activeCell?.rowIndex === rowIdx ? activeCell.colIndex : null`) -- only the
previously-active + newly-active rows see it change. The per-cell active/tabindex/className helpers (`isActiveCol`,
`isTabStop`, `cellNavClass`, `tdFocusProps`, `inputFocusProps`) now live INSIDE `PricingGridRow`, computed from
`activeColIndex`/`anyCellActive`; the grid keeps only the focus-ref plumbing (`registerCell`/`focusCell`/`onCellFocus`)
and the mutation closures (`commitRate`/`scheduleAutoSave`/`setOpenRemark`), ALL `useCallback`-stable so the memo holds.
The grid derivations (`byIdx`, `computeDepths(rows)`, `displayDescriptors`, `slNoLetter`/`descriptionLetter`) are
`useMemo`'d on `[rows]` / `[columnDescriptors]` (NEVER on `activeCell`). The comparator is EXHAUSTIVE (returns false if
ANY prop changed) so memoization never goes stale -- a save->`mutate()` hands fresh `row`/`flags`/slice references ->
that row re-renders. **ZERO behaviour change** (same flags / markers / amounts / nav / lock gating, computed fewer
times). NEVER pass the shared draft/proposed map, the whole `byIdx`, or an inline-arrow callback to a memoized row.

**Read-only gating = PRESENCE of the save callback (the single root signal -- do NOT add a second):** the grid's
editability is whether `onSaveRate` (and, for annotations, `onSaveRemark`/`onSaveColor`) is passed. The page withholds
them (`onSaveRate={locked ? undefined : handleSaveRate}`, same for the annotation handlers) when `locked = editable ===
false || takenOver`, and ALL edit paths (rate-cell render branch, `commitRate`, `commitActiveRate`, `scheduleAutoSave`,
the `flush()` handle, `handleGridKeyDown`) collapse to the read-only render. A grid-only (general-specs) sheet never
reaches PricingGrid (the `isGridOnlySheet` fork renders a read-only `SheetDataGrid`), so it is annotation-free by
construction. **Do NOT add a per-cell `editable` check -- it duplicates the callback-presence gate.** Takeover detection:
`isTakeoverError(msg)` = `msg.includes("BOQ_PRICING_LOCKED")` (`.includes`, since `getFrappeError` ", "-joins messages).

**Rate-edit gate is ASYMMETRIC by node_type (`PricingGrid.isRateEditableRow`, owner-locked):** the rate-cell render
branch gates on `onSaveRate && isRateDescriptor(d) && isRateEditableRow(row, override)`, where
`isRateEditableRow(row, override) = override || row.node_type === "Line Item" || (row.node_type === "Preamble" &&
isRowQtyBearing(row))`. **A LINE ITEM is ALWAYS editable** (a zero-qty Line Item is a valid rate-only line -- do NOT
lock it); **a PREAMBLE is editable ONLY when qty-bearing** (a zero-qty Preamble -- nearly all Preambles -- is read-only);
a non-priceable type / null node_type is read-only; the **"Price any row" override unlocks BOTH** a zero-qty Preamble and
any non-priceable type. **This Preamble/Line-Item asymmetry is a DELIBERATE owner-locked rule -- never collapse it to
uniformity.** `isRowQtyBearing(row)` = **"qty ANYWHERE" (Definition A)**: `isNonZeroNum(row.qty_total) || any
Object.values(row.qty_by_area)` is finite non-zero. `isNonZeroNum` is a **SELF-CONTAINED copy inside PricingGrid** (NOT
imported from priceability -- importing back would reverse the one-way dependency / make a cycle). **THE DELIBERATE
DIVERGENCE (record, do NOT "fix"):** this gate's "qty anywhere, per-row, Preamble-only" is intentionally LOOSER than
`priceability.isPriceableLine`'s "qty in a RATE-COLUMN area, per-area, both types" -- they answer different questions
(edit-gate vs flags/priced-count/rollup) and correctly use different predicates. The gate change reads only
`row.qty_total`/`row.qty_by_area`/`row.node_type` (already on the memoized row prop) -- NO new shared-object prop, so the
perf memo is not defeated. The server (`save_cell_price`) enforces the SAME rule (`_node_is_qty_bearing`) -- client = UX,
server = the real boundary, no axis drift. **Marker nuance (known, not a defect):** the amber "needs review" priced
marker still keys on `isPriceableType` (TYPE), so an override-priced zero-qty Preamble renders emerald not amber; marker
logic was left unchanged (out of this slice's scope). **Build-time consistency finding (reported, not decided):** a
zero-qty rate-only Line Item is now editable but, because `isPriceableLine` excludes it, is NOT counted in the N/M
priced-count nor flagged needs_rate -- a follow-up decision for the owner; `isPriceableLine`/flags/count were NOT changed
here.

**MANDATORY amount-formula gate (`priceability.areFormulasComplete` + `PricingGrid.formulasComplete` + `SheetPricingPage`
banner; owner-locked):** amount formulas are now **MANDATORY before pricing** -- this **REVERSES the F1-F4 "formula
optional" property**. The new pure `priceability.areFormulasComplete(columnDescriptors, columnFormulas)` is the per-SHEET
completeness predicate: **every amount column descriptor (`isAmountDescriptor`) must be COVERED by a declared formula**, where
"covered" is **`pickFormula`'s override>area-wildcard-default resolution** -- so ONE wildcard default (`target_value_key`
null) covers ALL per-area amount columns sharing its `(value_field, rate_subkey)`; a present-but-CLEARED record (null
`.formula`) does NOT count; a sheet with **zero** amount columns is **TRIVIALLY complete** (rate editing NOT blocked). It
REUSES the EXACT `pickFormula` resolution `evaluateAmountCell` uses, so completeness can never drift from how amounts
compute. **No import cycle** (`priceability` already imports PricingGrid's leaf predicates; `pickFormula` from the leaf
`amountFormula.ts`). The page computes `const formulasComplete = areFormulasComplete(columnDescriptors, columnFormulas)` (the
data is ALREADY in hand from `get_priced_rows` -- NO new fetch) and passes it as a NEW per-SHEET boolean prop
`formulasComplete?: boolean` (**default TRUE** for back-compat). The grid ANDs it into the rate-cell render gate **OUTSIDE
`isRateEditableRow`**: `onSaveRate && formulasComplete && isRateDescriptor(d) && isRateEditableRow(row, override)` -- because
the `override` lives INSIDE `isRateEditableRow`, it can **NEVER reach past `formulasComplete`** (no declared formulas =>
NOTHING rate-editable, override or not). The prop is added to `PricingGridRowProps` AND the exhaustive comparator
`pricingRowPropsAreEqual` (**memo-safe**: a per-sheet boolean flips identically for all rows -> a flip re-renders all rows
ONCE). **`onSaveFormula` is DELIBERATELY NOT withheld by this gate** -- declaration (the `AmountFormulaBuilder` on each amount
`<th>`, gated only by `isAmountDescriptor(d) && onSaveFormula`) stays live while rates are locked, so the gate is
satisfiable; it is withheld only by `locked` (the single-editor lock), as before. The `SheetPricingPage` banner ("Declare
amount formulas to enable rate entry.", amber-note style) shows when `!isGridOnly && !locked && !pricedLoading &&
!pricedError && !formulasComplete` (a trivially-complete sheet never shows it). The server (`save_cell_price` ->
`_sheet_formulas_complete`) enforces the SAME rule OUTSIDE the override block -- client = UX, server = the real boundary. The
asymmetric gate / `isPriceableLine` / flags / count / rollup / perf memo are UNTOUCHED; the formula gate composes cleanly on
top. **Live re-gate:** removing a formula flips `formulasComplete` back to false (re-locking rates) as a natural consequence
of the live `column_formulas` read -- no special handling.

**Amount-column formula-status badge (`priceability.isAmountColumnCovered` + `AmountFormulaBuilder.tsx` trigger +
`PricingGrid.tsx` `<th>` tint; owner-locked option (a) -- status + action MERGED):** after the mandatory gate the user
had no per-column guidance (which amount cols still NEED a formula). The fix relocates + recolors the formula affordance:
a LEADING `ƒ` STATUS BADGE at the START of each amount column `<th>` (before the label) -- **AMBER when the column has no
covering formula (pending), GREEN when covered** -- and the badge **IS the click-to-edit trigger** for the
`AmountFormulaBuilder` popover (status + action are one control). The old far-right secondary preview line (the
`blue tokensToText` label under the column label) is **REMOVED** -- it was a tiny truncated 2nd line on far-right,
often-scrolled-off, narrow columns, which is the recon-diagnosed **layout/visibility** root cause of the "sometimes
doesn't render / easy to miss" complaint (NOT a data bug -- the control already resolved correctly via `pickFormula`).
**Relocating the trigger to the prominent leading badge IS the render-bug fix.** A subtle full-`<th>` **amber tint**
washes PENDING amount columns (covered/non-amount columns keep neutral `bg-muted`) so a wide sheet (VRF 9 cols) is
scannable at a glance; amber tokens (`bg-amber-50 dark:bg-amber-950/40`) mirror the gate banner. **Badge⇔gate agreement
(by construction):** the NEW pure `priceability.isAmountColumnCovered(d, columnFormulas)` =
`!!(pickFormula({value_field,value_key,rate_subkey}, columnFormulas)?.formula)` is the SINGLE per-column predicate;
`areFormulasComplete` now folds `.every()` over it -- so **every amount column GREEN ⇔ areFormulasComplete true ⇔ rate
gate open + banner hidden**. The badge color reuses `AmountFormulaBuilder`'s already-computed `applicable = pickFormula(...)`
(`covered = !!(applicable && applicable.formula)`, the SAME resolution -- no second path, no priceability import → **no
cycle**). The `<th>` tint check is `pickFormula` **inline** in `PricingGrid` (already imported from `amountFormula.ts`),
**NOT** `priceability.isAmountColumnCovered` -- importing priceability into PricingGrid would reverse the one-way
dependency into a cycle (same reason `isNonZeroNum` is a self-contained copy); it is the SAME override>wildcard
`pickFormula` resolution, so it can't drift. **Read-only branch preserved:** when `onSaveFormula` is withheld (locked /
taken-over / general-specs) the badge renders as a STATIC amber/green glyph with NO popover -- status always visible,
editing gated by `onSave` exactly as before. **Display-only:** the header is in `<thead>`, OUTSIDE the memoized
`PricingGridRow`, so a badge/tint re-render is free -- the gate logic / rate path / `pricingRowPropsAreEqual` / flags /
count / rollup / perf memo are UNTOUCHED. Non-amount columns get no badge + no tint. Builder popover / `onSave` /
validation / cycle-check UNCHANGED (only the trigger's look + position changed). vitest 235→241 (priceability 36→42:
`isAmountColumnCovered` incl. wildcard + cleared + the shared-predicate agreement; no RTL in this env so the badge RENDER
is not unit-tested -- the underlying coverage boolean is), tsc 3175 (0 new), in-container build exit 0, 2026-06-21.

**Full-screen / maximize editor (`SheetPricingPage` `expanded` state + `PricingGrid`/`SheetDataGrid` `expanded` prop +
`shouldExitFullscreenOnEsc`; owner-locked Slice 4c):** a "Full screen" toggle grows the pricing editor to fill the
viewport (the dense grid benefits from screen real estate); "Exit full screen" / **Esc** collapses back. **In-app
maximize, NOT the native Fullscreen API, NOT a Dialog/Sheet/portal.** The page holds `const [expanded, setExpanded] =
useState(false)`; the implementation toggles ONLY the **root wrapper's className** via `cn(expanded ? FULL : EMBEDDED)`
where FULL = `fixed inset-0 z-50 flex flex-col space-y-4 overflow-auto bg-background p-4` (covers the app shell, exactly
like the house Dialog/Sheet overlay) and EMBEDDED = the prior `flex-1 space-y-4 max-w-5xl mx-auto pt-6 pb-10 px-4`. **THE
LOAD-BEARING NO-REMOUNT RULE:** it is **ONE JSX tree** (same children, same positions, same `PricingGrid key={sheetName}`)
-- only the wrapper class flips, so React reconciles the same element in place and expand/collapse **NEVER remounts the
grid** -> `draftRates` (unsaved rates), `proposedRates`, `activeCell` (cursor), the per-cell debouncer timers, the
imperative `gridRef` (the review-strip `scrollToRow`), the single-editor lock / `takenOver`, and ALL page state
(override, `showOnlyUnpriced`, `reviewOpen`, `lastSavedAt`) survive untouched. Do NOT reach for `createPortal` / Dialog /
Sheet / a second return-branch with a different child tree -- they remount the subtree and would DROP unsaved rates +
re-fire the unmount-flush + lose the cursor. **Grid height in full-screen:** the FULL root is `flex flex-col`, the grid
SLOT (a wrapper `<div className={cn(expanded && "flex min-h-0 flex-1 flex-col")}>` around the render fork) takes
`flex-1 min-h-0`, and each grid's OUTER scroll container relaxes its `max-h-[calc(100vh-14rem)]` cap to `flex-1 min-h-0`
when `expanded` (a new `expanded?: boolean` prop, default false, on BOTH `PricingGrid` and the grid-only `SheetDataGrid`).
The grids' sticky header (`sticky top-0 z-20`) + horizontal `overflow-auto` are scroll-container-relative -- they carry in
unchanged; NO grid scroll/sticky internals are touched. **`expanded` is a per-GRID prop, NOT a per-row prop** -- it never
enters `PricingGridRowProps` / `pricingRowPropsAreEqual` / the row render, so the perf memo is intact (display-only).
**Esc-to-exit:** a `window` keydown listener mounted ONLY while `expanded` (`useEffect([expanded])`, removed on
collapse/unmount), calling the pure `shouldExitFullscreenOnEsc(e, document.activeElement)` (exported from `PricingGrid.tsx`
alongside `deriveSaveStatus`/`isGridOnlySheet` -- the established home for page-level pure helpers, sdk-free so it is
unit-tested in `PricingGrid.test.ts`). It returns true ONLY for a bare `Escape` that is **not `e.defaultPrevented`** (the
RemarkCell + AmountFormulaBuilder Radix popovers `preventDefault` THEIR Escape-dismiss, so a popover-closing Esc never
exits full-screen) and **not while an `<input>`/`<textarea>` is focused** (a rate/remark being typed owns its Esc). It is
DELIBERATELY a window listener (not the grid `<table>` -- it would miss Escs fired inside a portaled popover) and does NOT
touch the grid's own `handleGridKeyDown` / `nextCell`. **The toggle button renders OUTSIDE the `!isGridOnly` gate** (the
right-cluster wrapper now renders unconditionally; only the Save/Summary/Review/override buttons stay `!isGridOnly`) so a
read-only / grid-only / general-specs sheet can ALSO maximize -- full-screen is orthogonal to editability and composes
with the lock (a locked sheet is read-only but still expandable). Layout-only: NO pricing/gate/badge/flag/lock/rollup
logic, NO endpoint, NO migrate. vitest 241→245 (PricingGrid 109→113: `shouldExitFullscreenOnEsc`), tsc 3175 (0 new),
in-container build exit 0, 2026-06-24.

**Cross-area prefill save-path invariant (`PricingGrid.tsx`):** proposals live in a SEPARATE `proposedRates` map, NEVER
in `draftRates`. **No save path reads `proposedRates`** -- `commitRate`, `commitActiveRate`, `scheduleAutoSave`, the
`flush()` handle, and the unmount-flush all read `draftRates[key] ?? savedRateStr(...)` ONLY. Anything in `draftRates` is
committable; a cross-area proposal must never be written there until the user touches the cell (the input onChange then
deletes the `proposedRates` entry, promoting it to a real draft). Do NOT merge the two maps.

**Annotation render conventions (`PricingGrid.tsx`):** the **Remarks** column is a trailing `<th>/<td>` rendered AFTER
the `displayDescriptors.map()` (the established trailing-column pattern), edited via a click/Enter-to-open controlled
`RemarkCell` (shadcn Popover + Textarea, 250-char counter, Save/Clear). The **color** channel is a thick LEFT BORDER
(`colorClassForToken(token)` -> `border-l-4 border-l-<color>`), DELIBERATELY a border NOT a background, so it never masks
the system-owned cell BACKGROUND (emerald = priced / amber = priced-non-priceable) or the priced dot or the blue focus
ring -- the four channels coexist. The in-app channel is the border; the Excel-export = fill mapping is a later slice.
Apply-to-row fans out to `rowColorCells(displayDescriptors)`; the page owns the N POSTs + one `mutate()`.

**Amount-formula evaluator `amountFormula.ts` (Formula Builder F2 -- PURE module, NOT a component; full detail: plan
§"Formula Builder F2"):** the headless engine F4 calls per amount cell to compute `qty x rate` (or any +/* amount
formula) and fix the stale-amount bug `findPairedRateDescriptor` causes. **PURE** -- no React/DOM/Frappe, does NOT read a
row, does NOT import `resolveDescriptorValue` (types only). Entry `evaluateAmountColumn(col, columnFormulas, lookup) ->
EvalResult` (`{ok:true,value}` | `{ok:false, reason:"not_yet"|"broken"}`; not_yet="needs a rate", broken="check formula").
The CALLER (F4) injects `OperandLookup = (ref) => number|null|undefined` (concrete ref -> the row's value; real-0 is a
value, absent -> undefined, MIRROR `resolveDescriptorValue`). F2 itself does area-binding (a wildcard leaf value_key=null
on a `*_by_area` field binds to the column's area; a scalar value_field stays scalar -- the area-bind signal is the
value_field, no extra field), amount-refs-amount recursion (a leaf whose column has a formula recurses; else lookup),
cycle detection (-> broken), and the §0 FAIL-SAFE (ANY missing operand blanks the WHOLE formula -- no partial sum, no
zero-substitution; broken beats not_yet; NEVER throws). Wire types (`AmountFormulaNode`/`AmountFormulaRef`/`ColumnFormula`
+ `GetPricedRowsResponse.column_formulas`) live in `boqTypes.ts`. **F4 REPLACES `findPairedRateDescriptor`
(PricingGrid.tsx:1277-1300) with `evaluateAmountColumn`; F2 does NOT touch PricingGrid.** `pricingRollup.ts`/`SummaryPanel`
(the cross-row subtotal surface) is SEPARATE + untouched.

**Amount-formula builder `AmountFormulaBuilder.tsx` + `formulaTokens.ts` (Formula Builder F3 -- the click-to-insert editor;
full detail: plan §"Formula Builder F3"):** a per-amount-column shadcn Popover (ColorPicker/RemarkCell house style),
mounted by `PricingGrid` inside each AMOUNT `<th>` (gated `isAmountDescriptor`). The user ASSEMBLES a formula by clicking
real columns + `+ × ( )` -- NO free text, NO number input (literals barred by construction). The builder edits a flat
TOKEN LIST; `formulaTokens.parseTokens` (PURE, unit-tested -- the F3 risk spot) parses it to the F1 tree on save
(`×`-over-`+` precedence, brackets override, n-ary flatten; errors empty/dangling/unbalanced). **DEFAULT-as-template:**
`tokenRefForMode(d, mode)` inserts a WILDCARD leaf (value_key null) for a default on an area-bound column (F2 binds it
per-area) vs a CONCRETE ref for an override/scalar. The default/override toggle shows ONLY on a per-area amount column.
Cycle check at save REUSES F2 (`wouldCreateCycle` runs `evaluateAmountColumn` with a dummy `× 1` lookup -> broken === cycle;
NOT reimplemented). The header `ƒ = …` label reads `column_formulas` (applicable via F2 `pickFormula` precedence). Save ->
the page's `onSaveFormula` (`SheetPricingPage.handleSaveFormula` -> `save_amount_formula` POST + mutate; tree as JSON
string, `""` clears); **withheld when locked** -> the header renders read-only (the callback-presence gate). New wire type
`AmountFormulaSaveArgs` in boqTypes.ts. **F3 only AUTHORS the formula -- the amount-cell COMPUTE path
(`findPairedRateDescriptor`) is UNCHANGED; F4 owns that swap.**

**Amount-cell formula compute `PricingGrid.evaluateAmountCell` (Formula Builder F4 -- the grid swap, ARC COMPLETE; full
detail: plan §"Formula Builder F4"):** the amount-cell value now flows from the PURE exported `evaluateAmountCell(d, row,
columnDescriptors, columnFormulas, draftRates) -> AmountCellResult` (`value` | `committed` | `blank{not_yet|broken}`);
the render is a thin map. **Formula-wins-else-pairing:** an amount column WITH an applicable formula (F2 `pickFormula`
precedence override>default, REUSED) computes via `evaluateAmountColumn` (F4 passes the CONCRETE column; F2 binds the
wildcard default per-area -- F4 never pre-binds); NO formula -> the UNCHANGED `findPairedRateDescriptor`->`computeAmount`
fallback (committed value when un-priced). The injected `lookupOperandValue` is DRAFT-AWARE per rate operand (live
recompute as you type ANY rate the formula references -- the real change from the old single-paired read), mirroring
`resolveDescriptorValue` (real-0 is a value; absent->undefined). `validateFormulaRefs` is the dangling-ref gate (a ref
matching NO live descriptor -> broken, not a silent not_yet). **Fail-safe:** a formula that can't resolve renders BLANK
(not_yet = "Needs a rate" title; broken = blank + an `AlertTriangle` marker + "Check formula") -- NEVER a stale/wrong
number. This **fixes the supply+install->single-total stale-amount bug** (findPairedRateDescriptor couldn't pair it).
Surfacing not_yet/broken into the review-list seam is a **4b** concern (F4 leaves the cell-marker hook). F2/F3/storage +
rate-save/nav/color/remarks + `pricingRollup.ts`/`SummaryPanel` all UNTOUCHED. **The formula arc F1-F4 is COMPLETE.**

