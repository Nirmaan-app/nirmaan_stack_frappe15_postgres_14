### Phase 5 Editor perf fix -- PricingGrid row-level memoization (FRONTEND, perf, feat pending, 2026-06-24)

**What + why.** The pricing editor lagged on arrow-key nav + click, scaling with sheet size (Electrical 194 / VRF 121 felt
it; Fire Fitting 6 did not). A read-only perf recon (Checklist-B PASS, tip 99c488e4) found the cause and REFUTED the
original suspect: the cursor (`activeCell`) is GRID-LOCAL state inside `PricingGrid`, NOT page state, so a cursor move
re-renders ONLY `PricingGrid` (the page's flag/entry derivations do NOT run per keystroke -- they were NOT the cause and
were left untouched). The REAL cause: `PricingGrid` had ZERO memoization, so every `setActiveCell` re-rendered the whole
component -- `rows.map` over ALL N rows x M cells, an `evaluateAmountCell` at every amount cell, plus `byIdx` (O(rows)) and
`computeDepths(rows)` (O(rows)) rebuilds -- work the changed cell does not need. This slice is recon items 1+2 ONLY (item 3,
page-level memo, DEFERRED -- it does not affect the per-keystroke lag). FRONTEND-ONLY, NO behaviour change.

**Item 1 -- React.memo row component.** The per-row `<tr>` is extracted into `PricingGridRow = memo(..., pricingRowPropsAreEqual)`
(both exported for unit test). A cursor move now re-renders only the **2** rows whose active-state flipped; a keystroke only
the **1** edited row. **The cursor LEVER:** the `activeColIndex: number | null` prop (`activeCell?.rowIndex === rowIdx ?
activeCell.colIndex : null`) -- only the previously-active + newly-active rows see it change; every other row's props are
reference-stable -> the memo skips them. The per-cell active/tabindex/className helpers (`isActiveCol`/`isTabStop`/
`cellNavClass`/`tdFocusProps`/`inputFocusProps`) moved INTO the row (computed from `activeColIndex`/`anyCellActive`); the
grid keeps the focus-ref plumbing (`registerCell`/`focusCell`/`onCellFocus`) + the mutation closures (`commitRate`/
`scheduleAutoSave`/`setOpenRemark`), ALL `useCallback`-stable. The nav matrix (roving-tabindex, `nextCell`, `focusCell`,
`commitActiveRate`, `handleGridKeyDown` on the `<table>`, the `${rowIdx}:${colIndex}` cellRefs keys) is byte-for-byte
preserved -- the row registers the SAME coords.

**THE LOAD-BEARING ANTI-DEFEAT RULE (the single way this fix silently no-ops):** `draftRates`/`proposedRates` are ONE
shared object each; passing the whole object to a memoized row gives a NEW reference on every keystroke -> all rows
re-render -> memo defeated but LOOKS done. So each row gets ONLY its own slice via **`groupDraftsByRow(drafts, prev)`**
(exported, unit-tested): per-row sub-maps keyed by the FULL `${row_index}:${col}` key (so `evaluateAmountCell` / the rate
input read them unchanged -- they only ever look up this row's keys), **reference-REUSED** against the prior render's slices
(a `useRef` carried through `useMemo([draftRates])`) so a keystroke in row X never changes row Y's slice identity. On a
cursor move `draftRates` is unchanged -> `useMemo` returns the cached structure -> no row's slice changes -> no re-render.
The grid keeps `draftRates`/`proposedRates` + all save logic on the PARENT (the row reads its slice, the parent owns the
mutation + commit).

**Item 2 -- memoized grid derivations.** `byIdx` + `computeDepths(rows)` -> `useMemo([rows])`; `displayDescriptors` +
`slNoLetter` + `descriptionLetter` -> `useMemo([columnDescriptors])` (PricingGrid has NO `visibleCols` filter -- verified --
so `[columnDescriptors]` is the exact key). NEVER keyed on `activeCell`.

**Staleness self-check (the correctness side).** `pricingRowPropsAreEqual` is EXHAUSTIVE -- it returns false if ANY prop
changed -- so memoization trades lag for speed, never staleness. After a save->`mutate()` the page hands fresh `rows` /
`rowFlags` Map (-> new `flags` object) / `color_by_cell` references -> the affected row's props change -> it re-renders
fresh (priced tint / flag marker / amount value / dismissal state all update). The `key={row.row_index}` (DATA identity,
not array index) is unchanged from the pre-extraction row.

**Tests (the memo-WORKS proof -- env is `node`, no jsdom/RTL, so proven via the two pure surfaces).** `PricingGrid.test.ts`
83 -> 94 (+11): `groupDraftsByRow` (+5: slicing with full keys; absent row; THE anti-defeat reference-reuse [a row-5
keystroke keeps row-7's slice reference]; an unchanged row keeps its reference when another changes; malformed-key
tolerance) + `pricingRowPropsAreEqual` (+6: SKIP when all props equal [the cursor-move win for an unrelated row]; RE-render
on this row's activeColIndex change [gain + lose]; on its draft-slice change; on flags/row/proposal change [no post-save
staleness]; on openRemark/override/anyCellActive change; on a shared callback/descriptor reference change). Full suite 203
-> 214, all green (regression net: existing 203 unchanged + green = no behaviour drift). tsc: 0 new errors (3177 -> 3175,
2 FEWER from the removed duplicate `cellKey`/`savedRateStr` inner defs); in-container Vite build exit 0 (`built in 4m 17s`,
PWA 167 entries).

**Manual live-cert (pending Nitesh, on 145/150/166 -- BIG sheets).** PERF: arrow-DOWN a rate column + click around Electrical
194 / VRF 121 -> lag gone/much reduced; Fire Fitting 6 stays instant. NO-BEHAVIOUR-CHANGE: rate entry saves + amount
computes; nav identical (arrows/Tab/Enter-down/Esc/commit-on-move); markers intact (priced tint, flags, color borders,
override amber, amounts); annotations (remark popover, color apply); acknowledge dismiss + rate-edit re-arm; lock/read-only
stays read-only. Any divergence = regression, not PASS.

