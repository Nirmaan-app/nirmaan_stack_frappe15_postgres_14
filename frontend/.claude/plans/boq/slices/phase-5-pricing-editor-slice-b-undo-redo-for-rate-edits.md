## Phase 5 Pricing Editor -- Slice B: undo / redo for rate edits

**STATUS: code complete, OWNER live-cert pending.** FRONTEND-ONLY. SESSION-ONLY, delta-based undo/redo for RATE edits, the
second half of the clipboard+undo arc. **At Slice B the editor module is functionally complete; next = the rate-helper arc
(pricing engine -> other-BoQ rates -> material/PO/margin).** NO backend, NO endpoint, NO migrate, NO doctype. **SCOPE: RATE
writes only** -- remark / colour / reconciliation-choice / lock-unlock / version-switch are NOT undoable; a mixed paste records
only its rate deltas. In-memory, NO persistence; history clears for free on the `key={sheetName::version}` remount.

**NEW pure leaf `undoHistory.ts`** (mirrors clipboard.ts -- type-only imports). Exports + vitest (`undoHistory.test.ts`, 16):
- `emptyHistory()`; `pushEntry(state, entry, max=HISTORY_MAX=50)` -- ring buffer (drops OLDEST past max), CLEARS redo on a new
  push, no-op on an empty-delta gesture; `popUndo`/`popRedo` -- return `{entry, state}` (reduced stack, other stack untouched)
  or null, non-mutating; `canUndo`/`canRedo`; `invert(entry)` -- swap old<->new, returns a NEW entry (round-trips).
- Types: `RateDelta {cell:RateCellSaveArgs, draftKey, oldRate, newRate}` / `HistoryEntry {deltas}` / `HistoryState {undo,redo}`.
- **ONE-GESTURE-ONE-ENTRY** invariant: an 80-row fill-down = ONE undo entry.

**`PricingGrid.tsx`:**
- **Capture (alongside the existing funnels, no new save logic):** SINGLE-CELL at `commitRate` -- `oldNum` captured BEFORE the
  write (past the `rawValue===saved` early-return), pushed as a 1-delta entry only in the `.then` SUCCESS (a failed write never
  enters history). BATCH at the `doCut`/`doPaste`/`doFillDown` build sites -- a parallel `deltas:(RateDelta|null)[]` aligned 1:1
  with `writes` (null = remark), `oldRate=savedRateNum(targetRow,d)` in hand at the push (**no `BatchWrite` type change** -- the
  lower-churn recon path). **LANDED-ONLY:** `runBatch` now RETURNS the batch promise; callers read `outcome.written` and
  `recordLandedBatch(deltas, written)` keeps only `deltas[i]` for `i<written` (sequential apply + break => first-N are the
  successes; **`BatchOutcome.written` already IS the landed count -- no extension needed**, S2 not hit).
- **Replay (through the existing save path):** `undo()` pops top-undo, cross-pushes onto redo, replays `invert(entry)` (writes
  OLD rates); `redo()` pops redo, cross-pushes onto undo, replays the entry (NEW rates). Replay builds `BatchWrite[]` and fires
  the grid's OWN `runBatch -> onBatchWrite` (ONE trailing mutate). `isReplayingRef` guards the capture path from re-recording a
  replay (S5 -- the re-record loop). Each delta RE-GATED via `isDeltaWritable` (row present + rate descriptor + formulasComplete
  + isRateEditableRow, over the FULL descriptor set so column-hide never blocks an undo); a now-non-priceable delta is SKIPPED.
  A locked / read-only sheet (`onBatchWrite` withheld) -> undo/redo NO-OP (like paste).
- **Keyboard:** in the `~3012` Ctrl/Cmd block -- `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` redo, `Ctrl/Cmd+Y` redo (reads
  `e.shiftKey`), each `preventDefault` so a mid-edit `<input>` does NOT native-text-undo. `nextCell`/nav/the doX bodies are
  otherwise UNCHANGED.
- **Plumbing:** `history` grid-`useState` (+ synced `historyRef` for the imperative reads) -> cleared on the remount; `undo`/
  `redo` added to `PricingGridHandle` + `useImperativeHandle` (delegating to `undoRef`/`redoRef` synced each render, so the
  handle does not rebuild); NEW `onHistoryChange?({canUndo,canRedo})` prop fired in an effect on the history change (the
  `onDirtyChange` precedent). **NO new per-row memo prop** (no per-row undo highlight this slice).

**`SheetPricingPage.tsx`:** `historyState` `useState` fed by `onHistoryChange`; reset in the `[sheetName]` per-sheet effect.
Two `size="sm"` `Undo2`/`Redo2` icon buttons in the `{!isGridOnly}` bottom ribbon (mirror collapse-all), `disabled={locked ||
!canUndo/!canRedo}`, calling `gridRef.current.undo()/redo()`; titles teach the shortcuts.

**Tests / build:** vitest 368 -> 384 (+16 NEW `undoHistory.test.ts`: pushEntry ring-cap@50 + oldest-drop + custom-max +
redo-clear-on-push + empty-no-op; popUndo/popRedo + null-on-empty + non-mutating; canUndo/canRedo; invert swap/immutability/
round-trip; the push->undo->redo composition); `PricingGrid.test.ts` unchanged at 131; tsc 3175 (0 new, 0 in touched files);
in-container Vite build exit 0. ALL run IN-CONTAINER. **OWNER live-cert OWED:** type a rate -> Ctrl+Z reverts / Ctrl+Shift+Z
reapplies; paste/fill 80 cells -> ONE undo reverts all; cut -> undo restores; >50 gestures drops the oldest; a fresh edit
clears redo; locked sheet -> buttons greyed + shortcuts no-op; sheet/version switch wipes history; a replay onto a
now-non-priceable row skips that delta; an N-cell undo fires ONE network refetch (the batch's single trailing mutate).

### Slice B follow-on: onHistoryChange FLIP-GATE (perf micro-opt)

**STATUS: code complete, OWNER live-cert pending.** FRONTEND-ONLY, `PricingGrid.tsx` only -- one localized change to the
`onHistoryChange` effect. The effect now fires the page callback ONLY when `canUndo`/`canRedo` actually FLIP, not on every
history change. WHY: `history` gets a new object per edit, so the un-gated effect emitted a fresh `{canUndo,canRedo}` literal
each keystroke-commit -> the page's `setHistoryState` re-rendered the page shell every edit even when neither boolean changed
(the perf recon flagged it as one redundant page render per edit). HOW: a `prevHistoryFlagsRef` (init `{false,false}` =
the page default `historyState` + the empty-history start) is compared each fire; `onHistoryChange` runs only on a difference,
then the ref updates. **Observable button state is IDENTICAL** -- the page already shows disabled buttons at `{false,false}`,
and every genuine enable/disable flip still emits; on a sheet/version remount the new grid starts `{false,false}` with the
page reset matching, so nothing spurious or missed. `SheetPricingPage.tsx` UNTOUCHED. **NOT the autosave-lag fix** -- the
per-cell `await mutate()` full-sheet refetch + ~200-row re-render is a SEPARATE later slice (rows-merge / await change); this
slice does NOT touch `handleSaveRate` / `mutate` / `commitRate` / the rows path. Tests: NO new pure logic (effect gating) ->
vitest UNCHANGED at 384; `PricingGrid.test.ts` 131; tsc 3175 (0 new, 0 in touched files); in-container Vite build exit 0.
**OWNER live-cert OWED:** Undo enables after a rate edit; undo -> Redo enables; a fresh edit disables Redo; Ctrl+Z/Shift+Z
still work; button state correct after a sheet/version switch (the render-count win itself is not visually observable).

### Autosave-lag fix #1(c): structural row-identity merge (only the edited row re-renders on a save)

**STATUS: code complete, OWNER live-cert pending on all three canonical BoQs (145/150/166).** FRONTEND change
(`SheetPricingPage.tsx`) + a NEW pure leaf (`rowMerge.ts`); a READ-ONLY backend verification (STEP 0) preceded it. NO backend
edit, NO endpoint, NO migrate. The proven lag: the per-cell `await mutate()` full-sheet refetch hands EVERY row a new object
reference -> the grid row memo (`prev.row === next.row`) fails for all ~200 rows -> full re-render every keystroke-commit. Fix
**(c)** reuses the prior row OBJECT for any row a save did not change, so the memo holds and only the edited row re-renders.
This is (c) (identity preserve), NOT (b) -- the refetch still happens + is still awaited; only its RESULT preserves identity.

**STEP 0 -- CAPTURE-ONLY VERIFIED (the load-bearing invariant, turned into fact before any merge):**
- `save_cell_price` -> `_write_cell_price_record` (`pricing.py:434`): writes ONLY the edited cell's pricing record (rate +
  `is_filled` marker) + the same-row dismissal/recon re-arms (SEPARATE doctypes, returned message-level, not per-row); the
  committed tier (nodes/grid) is NOT mutated; no parent/other-row write.
- `get_priced_rows` -> `_merge_overlays` (`pricing.py:2088`): overlays onto the IMMUTABLE committed base ONLY these per-row
  fields -- `rate_by_area`/`priced_by_area`, scalar `rate_supply|install|combined` + `priced_rate_*`, `remark`, `color_by_cell`.
  Parent rollup AMOUNTS are NOT folded per-row (client-derived: `SummaryPanel`/`buildChildrenByParent` over the full rows).
- VERDICT: a save changes only the edited row's returned overlay data; the committed base can't change within a (boq, sheet,
  version) -> the structural predicate is justified AND the field-compare is a cheap extra guard. (Had it NOT held, S1 STOP.)

**`rowMerge.ts` (NEW pure leaf, type-only imports; vitest `rowMerge.test.ts`, 14):**
- `mergeRowsPreservingIdentity(prev, next)` -- key by `row_index` (stable identity, NOT array position); reuse the prior
  object when present AND `rowOverlayEqual` holds (returns the SAME reference -- the load-bearing property); a new row_index
  -> the new object; a removed one -> absent; empty prev/next -> `next` as-is. Returns a NEW array unless nothing reused.
- `rowOverlayEqual(a, b)` -- compares the FULL overlay surface: `rate_by_area`/`priced_by_area`/`color_by_cell` (struct/JSON),
  scalar `rate_*` + `priced_rate_*` (===), and `remark` (===). **remark + color_by_cell are INCLUDED** because
  `save_row_remark`/`save_cell_color` ALSO `await mutate()` the same refetch -- omitting them would display a stale
  remark/colour (STEP-0 rule: a field a save can change must be in the compare). The committed base is omitted (immutable).
  **Keep this list in sync with `pricing.py _merge_overlays`.** The field-compare is the FALLBACK GUARD -- a row whose visible
  content changed FAILS it and correctly re-renders even if STEP 0 missed a case.

**`SheetPricingPage.tsx` (the merge at the rows transform):** `const rawRows = activeMessage?.rows ?? []` ->
`const rows = mergeRowsPreservingIdentity(priorRowsForMerge, rawRows)`, with a `prevRowsRef` (last merged array) +
`rowsSourceSigRef`. **SOURCE-SWITCH RESET:** `priorRowsForMerge = rowsSourceSigRef.current === rowsSourceSig ?
prevRowsRef.current : []`, signature `v:<selectedVersion>` (history) vs `"current"` -- a different version's committed base is
never reused. Refs read/written in render (the established `collapsedRef` pattern; no extra render). The merge returns a NEW
array so the O(rows) page maps recompute (cheap) but reuses unchanged row OBJECTS (the memo win). On a non-fetch re-render
(toggle / `historyState` flip) the same rawRows ref re-merges to the same element identities -> grid memo still holds.

**Scope boundary kept:** ONLY `SheetPricingPage.tsx` edited (+ the new `rowMerge.ts`/test); `pricing.py` READ-ONLY;
`PricingGrid.tsx`, the row memo, `handleSaveRate`/`mutate`/`commitRate`/await timing UNTOUCHED. **NOT fixed (out of scope):**
the page-level O(rows) recomputes (`rowFlags`/`pricedCount`/`byRowIndex`/`displayRows`) still run each render -- a smaller,
separate item. Tests: vitest 384 -> 398 (+14 `rowMerge.test.ts`: unchanged-row SAME-reference [the core property], changed
rate -> new, changed remark -> new, changed color -> new, priced-marker flip -> new, new row_index -> new, removed -> absent,
empty prev -> next, match-by-index-not-position); `PricingGrid.test.ts` 131; tsc 3175 (0 new, 0 in touched); in-container Vite
build exit 0. **OWNER live-cert OWED (ALL THREE BoQs -- data render path):** (1) edit a rate on 150 (~200 rows) -> no
full-grid flicker, only the edited cell updates; (2) the saved rate is CORRECT + persists (no stale value -- the hardest
watch); (3) SummaryPanel/parent rollup still updates after the save; (4) priced-count updates; (5) per-area prefill still
proposes into the other area's empty cell; (6) paste/fill a block -> all targets correct, no stale rows; (7) undo/redo
correct; (8) sheet/version switch carries no stale rows (the source-switch reset).

### Phase 5 polish: save-status reflow fix (pin the ribbon buttons)

**STATUS: code complete, OWNER live-cert pending.** FRONTEND-ONLY, presentational, `SheetPricingPage.tsx` only -- CSS/className
+ a `title=` attr; NO logic / messaging / data-path change. After the row-identity merge stopped the GRID jitter, the only
remaining annoyance was the top-ribbon save-status label swapping "Saving..." <-> "Saved as of HH:MM" (different widths) and
SHOVING the action buttons every edit. STEP-0 layout recon found why: the status sits in a right-pinned status-group
(`ml-auto`) inside the right-pinned `shrink-0` action-button cluster, so a wider status grew the cluster LEFTWARD and shifted
the whole button row (Full screen / Lock / Freeze / Summary / Review / Price-any-row / Save now). FIX = give the status a
constant footprint so the cluster width never changes.

- **The change:** the save-status wrapper div is now `w-40 overflow-hidden` (w-40 = 160px, sized to the longest NORMAL string
  "Saved as of HH:MM" + icon, with buffer). Each status `<span>` is `min-w-0` with its TEXT in a `truncate` child + a `title=`
  (full text on hover); icons carry `shrink-0`. So normal strings render at a constant width (buttons pinned), and an
  unexpectedly-long message (e.g. a future error) stays on ONE line, ellipsis-clipped, never wrapping (no ribbon-height
  change) and never shoving neighbours.
- **Scope kept:** `deriveSaveStatus`, the status strings, the timing, and `inFlight`/`lastSavedAt` are UNCHANGED; the grid,
  row memo, merge, save path, and undo/redo are untouched. Tests: presentational, NO new pure logic -> vitest UNCHANGED at
  398; `PricingGrid.test.ts` 131; tsc 3175 (0 new, 0 in touched); in-container Vite build exit 0. **OWNER live-cert OWED:**
  rapid edits -> the Undo/Redo + ribbon buttons do NOT move on the Saving<->Saved swap; the status is fully readable in both
  states; a long/error message clips with full text on hover and still does not move the buttons; the messaging is unchanged.

### Slice commit-preflight (commit-phase validation rework) -- branch `feature/boq-commit-preflight`, 2026-06-29

REQUIREMENT (owner-grilled, /grilling Q1-Q9): move BoQ commit validation BEFORE the destructive write -- today warnings/errors are computed DURING/AFTER the commit (frappe.msgprint toasts), so "data gets committed even with errors and the user sees the errors, not the commit message". The confirm dialog must show per-sheet errors (blocking) + warnings (each individually "Looks OK"-acked) so the user decides before anything is written; clarify the warning language + show WHERE; remove warnings 17/18/19/21; re-assess + fix the #7 preamble-level bug.

INVESTIGATION: hard errors do NOT leak (per-sheet `_commit_one_sheet` writes all tiers then a SINGLE `frappe.db.commit()`; a #7/#8 throw rolls back -> `failed[]`). The "commits with errors" pain is the soft `msgprint` WARNINGS (non-blocking, by design) + the timing (computed mid-write, no preview). #7 confirmed a REAL latent false-positive: `level` (parser axis, frozen) vs `parent_node` (human/AI re-parent axis) diverge after a legitimate re-parent -> a structurally-fine sheet hard-stops at commit with no prior review warning.

DESIGN (locked): pre-commit DRY-RUN endpoint (no write, no Excel -- node checks derive from finalized review rows). Errors BLOCK + exclude that sheet (A1: ready sheets still commit); warnings per-warning grouped "Looks OK" gate (G1, local/non-persisted, zero-issue sheets skip); plain-language messages "Row {n} (middot) {desc} (emdash) {what is wrong}" + a what-to-do tail, terminology "section heading"/"item"; #7 RELAXED to strictly-shallower parent (ADR-0007, shared predicate = backstop + preview); real commit SILENT; commit-phase only (S1, no review-screen change). Keepers 15/16/20/22/orphan; deletions 17/18/19/21.

BUILT + GREEN: backend `commit_validation.py` (shared builder + validators + `commit_preflight` endpoint), `boq_nodes.py`/`boq_node_qty_by_area.py` relaxed+pruned (every hard throw kept), `commit_pipeline.py` reuses the shared builder + discards level_warnings (silent). Frontend `CommitDialog.tsx` issues step + `boqTypes.ts` preflight types. Tests: commit_validation 41, boq_nodes 75, commit_pipeline 49, review_screen 232 (all green; tsc 0 new). Adversarial code-review FOUND + FIXED a preflight/commit divergence -- the plan fields fed `resolve_effective` the `ai_*` layer the real commit omits, so partially-accepted AI rows resolved a different tree; fixed via the shared `RESOLVE_EFFECTIVE_COMMIT_INPUT_FIELDS` constant (spread by BOTH field lists) + a parity test. As-built detail: `.claude/context/domain/boq-backend.md` + `frontend/.claude/context/domain/boq-frontend.md`; #7 rationale in `docs/adr/0007-preamble-level-relax.md`. Live backend E2E on BOQ-26-00021 (5 warnings, correct shape). OWED: browser E2E of the dialog (errors-block / warnings-ack / clean-commit) -- blocked at build time on a running Chrome profile; #7 relax pending Nitesh review. Local-only, NOT pushed. [UPDATE: S1 committed e02599e1; browser-verified on BOQ-26-00115 -- commit dialog -> clean silent commit.]

### Slice commit-preflight S2 (surface #7/#8 in review + fully-hard finalize gate) -- branch `feature/boq-commit-preflight`, 2026-06-29

REQUIREMENT (owner reversed Q9 S1->S2): surface the two structural errors review was blind to (#7 sub-heading level line-up, #8 item-under-note) DURING review, and HARD-BLOCK finalize on them, so a finalized sheet is guaranteed structurally committable (closes the review<->commit asymmetry). Additive to S1 (the committed e02599e1 foundation).

DESIGN (locked Q1-Q3): hard-block #7/#8 at finalize (H); the gate becomes FULLY HARD (#7/#8/cycle block, "Mark anyway" + `overridden` removed; advisory flags stay soft); review surfaces ERRORS ONLY (the soft warnings #15/16/20/22 stay the commit dialog's "Looks OK" job). #8 generalized (line_item_as_parent -> line_item_parent_not_preamble, also catches item-under-note). PARITY BY CONSTRUCTION: review reuses the SHARED build_sheet_node_plan + validate_node_plan over the same ai_*-free human>parser tree as commit.

BUILT + GREEN: commit_validation.structural_errors_for_sheet; review_screen check_structural_integrity (cycle only) + get_structural_breaks/mark_sheet_parsed_check_done merge + fully-hard gate (lazy import dodges the circular dep); boqTypes union + ReviewTree labels + SheetReviewPage disable-Finalize/remove-override. Tests: test_review_screen 236, test_commit_validation 41 (all green); tsc 0 new. ADVERSARIAL REVIEW CLEAN (parity structural, lazy-import cycle-free, gate never reads confirm, no finalize bypass; one stale ai_assist.py comment fixed). Browser-verified on BOQ-26-00115: commit dialog -> clean silent commit ("Committed 2 sheets", no warning toasts); review renders post-S2 (advisories shown, no false breaks). ADR-0008 (fully-hard gate). As-built: `.claude/context/domain/boq-backend.md` + `frontend/.claude/context/domain/boq-frontend.md`. S1 = e02599e1; S2 local (pending its own commit).


---

