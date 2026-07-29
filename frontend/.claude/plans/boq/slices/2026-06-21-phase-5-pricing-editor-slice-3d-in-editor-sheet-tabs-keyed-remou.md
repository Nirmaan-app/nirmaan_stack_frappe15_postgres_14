### Phase 5 Pricing Editor -- Slice 3d -- in-editor sheet tabs + keyed-remount switch safety (FULL-STACK, small additive backend, feat pending, 2026-06-21)

**Goal.** A tab strip at the top of the pricing editor lists the SAME BoQ's COMMITTED sheets in WORKBOOK ORDER; clicking
another tab opens it in the editor WITHOUT going out to the hub. The visible feature is tabs; the load-bearing part is
the keyed-remount switch-safety fix. NO migrate. NO scope creep (no sheet close/reorder, no "new sheet", no cross-BoQ
tabs, no keyboard tab-cycling -- §14 reserve).

**THE KEY-REMOUNT INVARIANT (future slices MUST keep this).** A pricing->pricing tab switch does NOT remount the
page/grid (same RR route element, no key), so `draftRates` + in-flight debounced saves would carry across while `rows`
swap underneath -- a leftover draft keyed `${row_index}:${col}` could fire against the NEW sheet's same-indexed row. FIX:
**`key={sheetName}` (the VERBATIM useParams value) on the `<PricingGrid>` mount** -> a tab switch UNMOUNTS+REMOUNTS the
grid. The EXISTING flush-on-unmount commits the OLD sheet's pending drafts TO THE OLD SHEET (the old grid instance's
`autoSaveCellRef`/`commitRate` closures captured the old `onSaveRate` = old boqId/sheetName/commitVersion), and the NEW
sheet gets a CLEAN grid. **Do NOT remove the `key={sheetName}` -- it is the correctness fix, not cosmetics.**

**Page per-sheet state reset.** A new `useEffect([sheetName])` resets `saveError`/`lastSavedAt`/`takenOver`/`summaryOpen`.
**`inFlight` is DELIBERATELY NOT reset** -- a flush-on-unmount save increments then decrements in a pair against the SAME
stable setter; a hard reset to 0 would underflow when that save's finally runs. `hasUnsaved` re-derives from the
remounted grid's `onDirtyChange(false)`.

**The tab strip.** shadcn `Tabs`; the committed-sheets list fetched in the page via `useFrappeGetCall` on the SAME
`commit_gate.get_committed_state` endpoint the hub uses. Ordered by the NEW pure exported helper `orderCommittedSheets`
(added to PricingGrid.tsx). `<Tabs value={decodedSheetName}>` (active = current :sheetName, VERBATIM #152), one
`<TabsTrigger value={s.sheet_name}>` per sheet -- **value = VERBATIM sheet_name, label = `s.sheet_name.trim()` for
DISPLAY only**; `onValueChange` navigates to the hub's exact target `/upload-boq/hub/${boqId}/pricing/${encodeURIComponent
(val)}` (no-op guard on self).

**Backend `get_committed_state` -- ADDITIVE `sheet_order` (workbook order).** `sheet_order` is NOT on the queried
`BoQ Committed Sheet Grid` tier; it lives on the committed `BoQ Sheet` tier. Sourced via a SECOND lookup
(`frappe.get_all("BoQ Sheet", {boq, is_current:1}, ["sheet_name","sheet_order"])` -> `{sheet_name: sheet_order}` dict,
joined on the committed sheet identity, sheet_name VERBATIM), `None` if no match. Result `.sort`ed by `(sheet_order is
None, sheet_order or 0, sheet_name)`. PURELY ADDITIVE -- the hub (maps committedMap by sheet_name + doesn't assume order)
is UNCHANGED. `CommittedSheetState` gains `sheet_order: number | null`. NO migrate. **Stale-lock on switch = NO ACTION**
(no release endpoint; the old sheet's lock expires 5 min after last edit).

**Tests + verification.** backend `test_commit_gate` **18 -> 19** (+1 `TestGetCommittedStateOrdering`); Vitest **60 -> 64
GREEN** (+4 `orderCommittedSheets`: ascending; null-order-last + name tiebreak; VERBATIM trailing-space #152; no-mutate);
tsc 3178, 0 in touched; Vite build exit 0. (See root CLAUDE.md committed-state notes + frontend CLAUDE.md `**Status (...
Slice 3d ...)**`.)

