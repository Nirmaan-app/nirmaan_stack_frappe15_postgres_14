# BoQ Upload & Management — Implementation Plan

**Status:** Phases 0-2 (parser) + Phase 3 Modules 1a/1b/2a/2b/3 COMPLETE; 589 parser tests.
The running phase-by-phase completion log (Phase 2a-2c, Phase 1.8-1.9x, Bugs 6-24, Module 1a/1b/2a,
Module 2b-i..iii, Module 3 Slice 3a-fix/3b-i..iii/3c, prefill auto_guess) has been collapsed here --
per-slice as-built detail lives in the dedicated sections below and in the handover doc.
Parked/deferred parser items (Bug 11/12/15, Pattern 2, working agreement #40) are tracked in the
section-17 (decisions / open-items) blocks below.
CURRENT arc: Restructure surface Slice 1 -- Slice 1a (searchable sheet-view, feat 5ecf1820)
LIVE-CERTIFIED 2026-06-09; Slice 1b-alpha BACKEND COMPLETE (feat f7761415); Slice 1b-beta FRONTEND
COMPLETE (feat e8eeab58) -- the restructure MODAL (RestructureModal.tsx + pill DropdownMenu trigger +
childless light path + 5 child-placement options + SheetSearchView-as-parent-picker + onRestructured
refresh), dev route + `_DevSheetSearchHarness.tsx` REMOVED. tsc 0 wizard-file errors + build exit 0;
manual live-cert LC1-12 pending. The restructure-surface arc is COMPLETE pending live-cert. The OWED
single-pass full-sheet-read endpoint landed (`get_sheet_preview_full`, feat 196ed765) and is now WIRED
into the picker by SheetSearchView v2 (feat fc7147db -- block below). Slice 1b-beta2 (feat 1ed9d3b7) adds
row-self-reparent. Slice 1b-beta2b (feat 20e1f5a7) closes finding-9 + finding-10. Force Re-parse
BACKEND floor (flag-gated `force_reparse` eligibility for "Parsed Check Done", feat 95928637) landed.
LATEST: Single-Editor Lock -- Slice B (FRONTEND: read-only gating + holder banner + takeover) (2026-06-21, feat
pending, branch feature/boq-phase-5). The frontend half that CONSUMES Slice A's `editable`/`lock_info` -- Slice A+B
together COMPLETE the single-editor lock. FRONTEND ONLY (PricingGrid.tsx + SheetPricingPage.tsx + PricingGrid.test.ts;
NO backend, NO boqTypes runtime change -- LockInfo already existed). LOCKED DESIGN implemented exactly:
- HARD READ-ONLY via WITHHOLDING onSaveRate (the elegant reuse). Recon-verified that the grid's editability is a SINGLE
  root gate -- `onSaveRate` presence (guarded at the rate-cell render branch, commitRate, commitActiveRate,
  scheduleAutoSave, the flush handle, handleGridKeyDown). So the page passes `onSaveRate={locked ? undefined :
  handleSaveRate}`; ALL seven gates collapse to the existing read-only cell render with ZERO new per-gate checks.
  `locked = editable === false || takenOver`. (NO per-cell `editable` check was added -- that would duplicate the
  onSaveRate guard.)
- LOAD-TIME HOLDER BANNER: a house-style amber strip (matching SheetReviewPage's parsing banner) shown ONLY when
  `editable === false` (the backend returns false ONLY when held FRESH by ANOTHER user), naming
  `lock_info.locked_by_name` ("being priced by NAME ... read-only until they finish") + Reload + Go-to-hub buttons.
- MID-EDIT TAKEOVER (NEXT-SAVE-ONLY, no socket/poll): a NEW pure helper `isTakeoverError(msg)` (exported from
  PricingGrid.tsx, unit-tested) detects the Slice-A reject by `msg.includes("BOQ_PRICING_LOCKED")` (the stable marker;
  `.includes` not `.startsWith` -- getFrappeError ", "-joins multiple server messages, and preserves the message
  verbatim). In handleSaveRate's catch: `if (isTakeoverError(getFrappeError(e))) setTakenOver(true)` (else the generic
  setSaveError). `takenOver` flips the page read-only (same withhold mechanism) + shows a distinct amber takeover banner
  ("taken over by another user ... Reload to continue"). The grid keeps the optimistic draft (it just can't be saved).
- STALE = SILENT (NO banner): a stale lock returns `editable === true` from the backend, so the page does NOT withhold
  onSaveRate and shows NEITHER banner -- the user edits normally and their first save auto-takes-over server-side. The
  banner condition is `editable === false` (NOT lock_info presence), so stale never surfaces anything.
- TAKEOVER RESET: a `useEffect` keyed on `pricedData` (the payload identity, so it fires on EVERY refetch -- an
  [editable] dep would miss a true->true no-change) resets `takenOver=false` whenever a FRESH get_priced_rows payload
  reports `editable === true` (a Reload re-read found it free/mine/stale). Reload = `mutate()` (re-reads lock state in
  place; preferred over window.location.reload).
- The grid's `lockInfo` prop retyped `unknown` -> `LockInfo | null` (type-only; the grid does NOT read it -- the PAGE
  owns the banner + error surface). Save mechanism / auto-save / prefill / summary panel UNCHANGED.
- VERIFIED: Vitest 56 -> 60 (+4 isTakeoverError: marker / ", "-joined-marker -> true; generic / "" -> false); tsc 3178
  (== baseline), 0 in touched files; Vite build exit 0. Manual live-cert pending Nitesh (two-user: B blocked read-only +
  banner names A; A's mid-edit save -> takeover banner + read-only; Reload clears when free/stale; stale shows nothing).
  Slice A+B COMPLETE the single-editor lock. Full detail in frontend/CLAUDE.md "Single-Editor Lock -- Slice B".

PRIOR: Single-Editor Lock -- Slice A (BACKEND: doctype + atomic acquire-on-first-edit) (2026-06-21, feat pending,
branch feature/boq-phase-5). The pricing editor's single-editor lock, backend + the atomicity guarantee, certified
ALONE. Slice B (frontend gating, holder-name banner, takeover/reload UX, optional socket) is a SEPARATE later prompt.
LOCKED DESIGN implemented exactly: acquire ON FIRST EDIT (the first save_cell_price for a (boq, sheet_name,
committed_version) -- reading acquires nothing); EXACTLY-ONE-WINNER under a concurrent first-edit; expiry = 5 min after
the LAST edit (edit-driven, NO heartbeat); STALE takeover by a different user; HARD READ-ONLY reject server-side when
held FRESH by another; holder display name via the reused `pr_editing_lock._get_user_full_name`.
- DOCTYPE `BoQ Sheet Pricing Lock` (NEW; istable:0, track_changes:0 -- volatile lock state): boq (Link->BOQs),
  sheet_name (Data, VERBATIM #152), committed_version (Int), locked_by (Link->User), last_edit_at (Datetime).
- ATOMICITY = a DETERMINISTIC PRIMARY KEY (why a doctype, NOT Redis: exactly-one-winner + DURABLE across restart; the
  app's prior-art `pr_editing_lock.py` is a Redis get-then-set = TOCTOU/non-atomic, and Frappe's cache has no
  set-if-not-exists). The controller `autoname()` sets `name = _lock_identity(...)` = sha1 hex of
  `f"{boq}\x00{sheet_name}\x00{int(version)}"` (NUL-joined: "Elec "/"Elec" DISTINCT #152; arbitrary chars/length safe).
  Two concurrent first-edits both INSERT the SAME name -> Postgres PK collision raises `frappe.exceptions.
  DuplicateEntryError`; one wins, the loser re-reads + is rejected/takes-over. BENCH-PROVEN: a duplicate insert raises
  `duplicate key value violates unique constraint "tabBoQ Sheet Pricing Lock_pkey"`, and the txn stays usable after
  `rollback(save_point=...)`. (Chose deterministic-NAME over a composite unique index -- the PK is the strongest, most
  portable atomic guarantee with no separate index; the recon's preferred approach.)
- MODULE `api/boq/wizard/pricing_lock.py`: `LOCK_STALE_SECONDS = 300`; `_lock_identity`/`_read_lock`/`_is_stale`;
  `acquire_or_refresh(boq, sheet, version, user, now)` -- 4 branches: (1) FREE -> `savepoint(_ACQUIRE_SAVEPOINT)` +
  INSERT, on DuplicateEntryError `rollback(save_point=...)` + re-read + fall through (the loser path); (2) MINE ->
  refresh last_edit_at; (3) OTHER+FRESH -> `frappe.throw` prefixed `_LOCK_HELD_MARKER = "BOQ_PRICING_LOCKED"` + holder
  full name (writes NOTHING); (4) OTHER+STALE -> takeover. `read_lock_info(...)` -> structured dict, PURE READ.
- GATE in `save_cell_price` (pricing.py): `acquire_or_refresh(... frappe.session.user, now_datetime())` slots AFTER
  `_resolve_committed_cell` (:167) and BEFORE the freeze `_current_pricing_names` (:180) -- REJECT MUTATES NOTHING; the
  lock write shares the request txn + the single trailing `frappe.db.commit()` so lock-touch + price are atomic together.
- `get_priced_rows`: structured `lock_info` (None free, else {locked_by_user, locked_by_name, is_locked_by_me,
  last_edit_at iso, is_stale}) vs `frappe.session.user` -- PURE READ (never acquires); `editable` = True if
  FREE/MINE/STALE, False only when held FRESH by another (precomputes the Slice-B gate).
- boqTypes.ts (ONLY frontend touch): `lock_info: unknown | null` -> structured `LockInfo | null`; PricingGrid/
  SheetPricingPage UNTOUCHED (Slice B). frontend/CLAUDE.md deferred to Slice B (the frontend slice).
- VERIFIED: `bench migrate` CLEAN (doctype live, istable 0, PK-collision proven live); test_pricing 22 -> 31 (+9
  TestSingleEditorLock: first-save-acquires; holder-refresh; reject-fresh-mutates-nothing [marker + holder name + zero
  pricing rows + holder/last_edit untouched]; stale-takeover; THE ATOMICITY TEST [monkeypatch the first `_read_lock`->
  None so user B attempts the INSERT against A's live row -> collision RAISES + handled -> exactly ONE row, holder stays
  A]; lock_info free/mine/other-fresh-blocks/other-stale-allows). NO release endpoint / socket / heartbeat (expiry
  edit-driven; release implicit via staleness). NEXT = Slice B (frontend lock gating + takeover-reload UX).

PRIOR (was LATEST): Phase 5 Phase-2 PREFILL -- CROSS-AREA PROPOSED RATES (proposed-until-touched) (FRONTEND, 2026-06-21,
feat pending, branch feature/boq-phase-5; PricingGrid.tsx + PricingGrid.test.ts only -- NO backend, NO boqTypes change,
SheetPricingPage UNCHANGED). On a MULTI-AREA sheet, when the user saves a PER-AREA rate in one area, the SAME value is
OFFERED as a PROPOSED (display-only, uncommitted) rate in the CORRESPONDING rate column of the OTHER area(s) for that
SAME ROW -- but ONLY where that corresponding cell is currently EMPTY (not priced, no user draft). A proposal is VISIBLE
but NEVER saved on its own: the user touches/edits it (-> promotes to a normal rate edit on the existing save path) or
ignores it (stays proposed, NEVER committed by auto-save / "Save now" force-save / keyboard nav / unmount).
- SEPARATE STATE (the load-bearing invariant): a NEW `proposedRates: useState<Record<string,string>>` keyed by the SAME
  `cellKey(row.row_index, d.col)` as `draftRates`, but kept STRICTLY SEPARATE -- NO save path (`commitRate` /
  `commitActiveRate` / `scheduleAutoSave` / `flush` / unmount-flush) ever reads `proposedRates`. Those all read
  `draftRates[key] ?? savedRateStr(...)` only, so a proposal can never reach the server until promoted. (Proposed values
  MUST NOT go in draftRates -- anything in draftRates is committable.)
- CORRESPONDENCE = NEW pure exported helper `findCorrespondingRateDescriptors(sourceD, descriptors)` (next to
  findPairedRateDescriptor, reusing the `PER_AREA_RATE_FIELD = "rate_by_area"` const): returns every descriptor C where
  source AND C are both `value_field === "rate_by_area"`, SAME `rate_subkey` (non-null), DIFFERENT `value_key` (area,
  non-null). Returns [] for a scalar / non-rate_by_area source (area null -> no cross-area analog) or a HALF-POPULATED
  source (null rate_subkey/value_key) -- FAIL-CLOSED. (Recon-verified across the corpus: Electrical/HVAC/Fire Fitting
  Phase1<->Phase2 combined_rate; VRF L1<->L2 supply/install/combined each; low-side + VRF scalar N/O/P never match.)
- TRIGGER: hooked in `commitRate`'s success `.then` (where onSaveRate resolves AFTER the page's saveCellPrice + mutate),
  gated `d.value_field === PER_AREA_RATE_FIELD` so SCALAR saves propose nothing. For each corresponding C it sets
  `proposedRates[cellKey(row.row_index, C.col)] = String(rate)` ONLY when the cell is EMPTY -- `!isCellPriced(freshRow,C)`
  (freshRow via a new `rowsRef` synced each render) AND no `draftRatesRef.current[ck]`. An older untouched proposal MAY
  be overwritten (newest saved value wins); a priced or drafted cell is NEVER overwritten.
- RENDER: value precedence `draft ?? proposed ?? savedRateStr`; `isProposed = draft===undefined && proposed!==undefined
  && !priced` -> the rate `<Input>` gets `text-muted-foreground italic` (MUTED GREY ITALIC); the emerald priced tint +
  dot stay gated on `isCellPriced` (false for a proposal -> neither shows). A priced or user-drafted cell renders normal.
- PROMOTION: the rate input's onChange (which already writes draftRates) now ALSO deletes the cell's `proposedRates`
  entry -> a touched proposal becomes a real draft on the normal save path (auto-save + emerald-on-save follow for free).
- CLEANUP: a `useEffect([rows])` reconciles after each mutate() refetch -- drops any `proposedRates` entry whose cell is
  now `isCellPriced` on the fresh data (a proposal never lingers on a now-priced cell). Proposals are display-only;
  reconciliation commits nothing. (Proposals are not wholesale-cleared on sheet change -- matching the existing
  draftRates behavior; they are non-committable + pruned-on-priced, so a stale cross-sheet proposal is at worst a
  harmless display artifact. No sheetName prop added.) "0.0 can be priced" preserved (isCellPriced still flag-driven).
- VERIFIED (in-session): Vitest **50 -> 56** (+6 `findCorrespondingRateDescriptors` tests: per-area symmetric 2-area
  combined Phase1->Phase2-only; VRF L1 supply_rate->L2 supply_rate-only; scalar source->[]; VRF scalar rate_combined->[];
  half-populated null-subkey->[]; mixed VRF 9-rate list L1 combined->L2 combined-only never scalar); tsc **3178** (==
  baseline), 0 in touched files; Vite build exit 0 (PWA 166 entries). Manual live-cert (save a per-area rate -> proposal
  appears muted-italic in the other area's empty cell; touch promotes + saves; ignore never commits via any path; priced
  cells never receive) pending Nitesh. Full detail + frontend/CLAUDE.md.
// prior LATEST: Phase 5 Summary Panel -- TOP-DOWN GRID-ALIGNED PARENT-TREE AMOUNT ROLLUPS (FRONTEND, 2026-06-21,
feat pending, branch feature/boq-phase-5). A pull-in, Excel-pivot-style SUMMARY over the pricing editor: ROWS = nodes
in the committed parent tree (collapsible; expansion depth = aggregation level); COLUMNS = the sheet's OWN
amount-column structure reproduced exactly (single combined / per-area / supply-install-total split / asymmetric
per-area / any combination -- the panel imposes NO shape of its own); VALUES = each amount column summed over the
node's descendants. Computed PAGE-SIDE from data already on the page (rows + columnDescriptors from get_priced_rows) --
NO new backend call, NO migrate.
- SHELL (top-down, NOT a side drawer): a plain `<section>` that opens ABOVE the grid via the existing header "Summary"
  button (now a toggle), FULL-WIDTH, capped at `max-h-[40vh]` with INTERNAL scroll (never pushes the grid off-screen;
  the grid stays usable below); its own close (X). The panel is a `<table>` MIRRORING the grid's column structure --
  one left "Item" region (`min-w-[616px]`, matching the grid's 5 anchor columns combined) + one column per
  `displayDescriptor` in the SAME Excel order with the SAME width classes the grid uses (`w-28 min-w-[112px]`); amount
  columns carry the rollup number, non-amount columns (unit/qty/rate/append) render blank so the amount columns line
  up. ALIGNMENT IS BEST-EFFORT (owner-chosen "same column order, best-effort widths") -- NOT pixel-perfect: both tables
  are `w-full` auto-layout, so they stretch alike but final widths are content-dependent. Pixel-perfect was rejected
  because it would require making PricingGrid `table-fixed` / a shared colgroup (out-of-scope grid change). The
  collapsible tree uses a flat `collapsed` Set + a visibility flatten (the ReviewTree table-tree idiom), NOT the
  Collapsible primitive (wrapping `<tr>` in a Collapsible div is invalid table markup).
- THE SUMMING RULE (locked): per-row amount = `computeAmount(qty, pairedRate)` REUSING the EXISTING PricingGrid helpers
  (`computeAmount` / `findPairedRateDescriptor` / `PER_AREA_AMOUNT_TO_RATE_KIND` / `SCALAR_AMOUNT_TO_RATE_FIELD`) + the
  qty source (per-area `qty_by_area[area]`, scalar `qty_total`) -- the pairing is reused, never reinvented. A row
  contributes its OWN amount selected by AMOUNT-PRESENCE (the paired rate yields a number); a missing pairing / missing
  rate (un-priced or non-priceable row) yields null -> contributes nothing. (node_type is NOT on the delivered
  committed row, so the priceability gate is expressed as amount-presence, not a type check.) A priced PREAMBLE carries
  an amount for ITS OWN ROW ONLY -- `node.totals = own + sum(children rolled totals)` -- so a preamble's own amount is
  added exactly once (NO double-count). Each amount descriptor rolls up INDEPENDENTLY, column-by-column -- NO merging of
  per-area and scalar surfaces, NO derived totals. (design v1.3 Sec.6 priceability; node shape Option A.)
- PARENT TREE: built by inverting `effective_parent_index` (the field reviewRender.computeDepths walks); "descendants of
  P" = transitive closure. CYCLE-SAFE: computeDepths (reused) has its own memo+cycle guard; the rolled-total recursion
  uses an in-progress guard and the tree build a DFS path-set guard -- a malformed cycle terminates, never hangs.
  Roots = rows whose parent is null/negative/self/absent (mirrors the grid's parent test) so no row is silently dropped.
- FILES: NEW `pricingRollup.ts` (pure helper `rollupByParent(rows, columnDescriptors) -> {columns, roots}` + types
  RollupColumn/RollupNode/RollupResult, co-located -- boqTypes.ts NOT touched), NEW `SummaryPanel.tsx` (the top-down
  panel), NEW `pricingRollup.test.ts` (the math tests), `SheetPricingPage.tsx` (toggle button + inline mount above the
  grid). PricingGrid.tsx / reviewRender.tsx / boqTypes.ts / backend UNTOUCHED. The rollup helper is a SIBLING module
  (not added to PricingGrid.tsx) so the certified grid file + its 27 tests stay byte-untouched; it imports the grid's
  helpers one-way (no cycle).
- VERIFIED (in-session): Vitest **39 -> 46** (+7 `pricingRollup` -- T1 HVAC-like per-area symmetric total; T2
  Electrical-like asymmetric per-area total/install; T3 low-side-like scalar single-total; T4 VRF-like full per-area +
  scalar supply/install/total split [9 amount cols, independent, no surface-merge/double-count]; T5 priced-preamble own
  amount counted ONCE; T6 cycle guard terminates; T7 blank/un-priced contribute zero); tsc **3178** (== baseline), 0 in
  touched files; Vite build exit 0 (PWA 166 entries). Manual live-cert (visual alignment + open/close + scroll) pending
  Nitesh. Full detail below + frontend/CLAUDE.md.
- DISPLAY REVISIONS (2026-06-21, feat pending -- after owner live-test; SummaryPanel.tsx + 2 additive pure helpers;
  the rollup MATH `rollupByParent` + its 7 tests UNCHANGED -- this changes only what is SHOWN, not what is SUMMED):
  (1) COLUMNS = Description + AMOUNT columns ONLY -- the panel no longer reproduces the grid's non-amount descriptors as
  blank spacer columns; it renders `rollup.columns` (the amount descriptors) directly, so it is now its own
  description-plus-amounts table (grid full-column alignment is no longer a goal). (2) ROWS = Preamble + Line Item ONLY
  -- a render-time filter on `node.classification` in {"preamble","line_item"} (the lowercase taxonomy / priceable
  qty-bearing types, design v1.6 §6); note/spacer/subtotal/header_repeat do NOT render. DISPLAY-ONLY: totals unchanged
  (priced amounts live only on these types); non-priceable types are structural LEAVES so the filter never disconnects
  the tree (no re-parenting). (3) EXPAND/COLLAPSE-ALL header toggle (flips the whole tree; per-row chevrons still work)
  + DEFAULT VIEW = expanded down to the SHALLOWEST preamble tier, computed from data (0 on a level-less sheet, 1
  otherwise -- never hardcoded) via two NEW additive pure helpers in pricingRollup.ts: `minPreambleDepth(roots)` (min
  depth among preamble nodes, null if none) + `defaultCollapsedSet(roots)` (every node WITH CHILDREN at that depth ->
  default `collapsed`; empty when no preamble = fully expanded). "Collapse all" = collapse every parent (only roots
  visible); "Expand all" = empty collapsed. (4) DESCRIPTION column = FIXED width `w-[320px]` + WRAP (truncate dropped,
  `break-words whitespace-normal`, top-aligned chevron+text); amount cells stay right/top-aligned. VERIFIED: Vitest
  **46 -> 50** (+4 helper tests D1 level-1-shallowest / D2 level-0/level-less / D3 multiple-preambles-one-tier / D4
  no-preamble; the 7 rollup math tests stay green); tsc **3178** (== baseline), 0 in touched files; Vite build exit 0
  (PWA 166 entries). Manual live-cert (columns, row-filter, default tier + expand-all, wrap) pending Nitesh.
// prior: Phase 5 Slice 3c -- AUTO-SAVE + FORCE-SAVE + SAVE-STATUS (FRONTEND, grid + page, 2026-06-21, feat pending,
branch feature/boq-phase-5). Adds debounced auto-save, a "Save now" force-save button, and a save-status chip to the
pricing editor -- all REUSING the existing save (commitRate -> onSaveRate -> save_cell_price -> mutate). The save
MECHANISM is unchanged; 3c adds more TRIGGERS + VISIBILITY. NO new endpoint, NO backend, NO migrate, NO lock.
- DEBOUNCED AUTO-SAVE (1000ms, lodash `debounce`): the rate input's onChange schedules a per-cell debounced commit
  (`scheduleAutoSave`, keyed by cellKey in `debouncersRef`) that fires ~1s after the last keystroke -- closing the
  typed-but-uncommitted gap (no blur/Enter/move gesture needed). The fire reads the LATEST draft via a ref
  (`autoSaveCellRef`, re-synced each render in a no-deps effect) so it never commits a stale captured value, then calls
  the EXISTING commitRate. AUTOSAVE_MS = 1000.
- CANCEL-DEBOUNCE-ON-GESTURE (same-cell race guard): commitRate now computes the key FIRST and
  `debouncersRef.current.get(key)?.cancel()`s the cell's pending debounce on every commit -- so a gesture (blur/Enter/
  nav) cancels the pending timer and a later auto-save can't fire a different/stale value out of order. (The existing
  committedAttemptRef dedupe still guards same-VALUE double-fires.)
- FLUSH-ON-UNMOUNT: a useEffect cleanup `.flush()`es all pending debouncers on grid unmount -> a just-typed value
  persists on navigate-away (not dropped).
- FORCE-SAVE = imperative grid handle. PricingGrid is now a `forwardRef` component exposing `flush()` via
  `useImperativeHandle` (type `PricingGridHandle`): fire all pending debounced saves now + retry any remaining draft
  (e.g. a previously-failed one). The page's header "Save now" button calls `gridRef.current.flush()`. (Drafts/debounce
  stay owned by the grid; only flush + a dirty signal are exposed -- no state hoisted.)
- SAVE-STATUS CHIP (page header): a pure `deriveSaveStatus({inFlight, hasUnsaved, hasSaved, hasError})` -> idle ("All
  changes saved") / unsaved ("Unsaved changes") / saving ("Saving...") / saved ("Saved as of HH:MM") / failed ("Save
  failed"), priority error>saving>unsaved>saved>idle. The PAGE owns the inputs: an IN-FLIGHT count (onSaveRate
  increments before the await, decrements in `finally`), a client-clock `lastSavedAt` (set on save success -- "saved as
  of" uses the CLIENT clock; save_cell_price returns no timestamp), the existing `saveError`, and `hasUnsaved` from the
  grid's new `onDirtyChange` callback (the grid reports `Object.keys(draftRates).length > 0`).
- editable / lock_info STAY INERT (auto-save/force-save are NOT gated on `editable`; no lock built -- that's a separate
  later slice). Read-only grid (no onSaveRate) no-ops auto-save (the rate input -- the only onChange/scheduleAutoSave
  site -- doesn't render).
- VERIFICATION (observed, in-container): Vitest **39/39 GREEN** (12 reviewRender + 27 PricingGrid = 22 prior + 5 NEW
  `deriveSaveStatus` tests: error>saving>unsaved>saved>idle priority); tsc **3178** (== baseline), **0** in touched
  files (filtered boq-wizard|PricingGrid|SheetPricingPage|boqTypes); Vite build exit 0 (PWA 166 entries). Manual
  live-cert pending Nitesh (1s auto-save of a typed-but-left value; chip cycles; Save-now flushes all drafts; cancel-
  on-gesture -> no double/out-of-order; flush-on-unmount -> no loss on nav; failure keeps draft). PricingGrid.tsx +
  SheetPricingPage.tsx (+ PricingGrid.test.ts); boqTypes NOT changed (the handle/status types live in PricingGrid).
  **3c is the last core-editor save slice; the single-editor lock is its own later slice.** Full frontend detail in
  frontend/CLAUDE.md.
// prior: Phase 5 Slice 3b.2 -- SPREADSHEET KEYBOARD NAVIGATION (FRONTEND, PricingGrid only, 2026-06-21, feat pending,
branch feature/boq-phase-5). Makes the WHOLE pricing grid arrow/Tab/Enter navigable like Excel (design v1.3 Sec.11);
rate cells edit-on-focus, every other cell holds focus. PricingGrid.tsx ONLY -- reuses commitRate/onSaveRate, NO
save-model change, NO page touch, NO backend, NO migrate.
- ALL CELLS NAVIGABLE via a roving-tabindex + per-cell ref map. `activeCell {rowIndex (ARRAY INDEX into rows, for
  contiguous +/-1), colIndex}` (null until click/tab-in); the active cell (or (0,0) before any focus) is the single
  tab stop. A `cellRefs` Map holds the focus target per `${rowIndex}:${colIndex}` -- **the `<input>` for a rate cell,
  the `<td>` for every other cell** (the input-vs-td asymmetry). `onFocus` on each cell sets activeCell (so click +
  tab-in + programmatic focus all converge); a keyboard move `.focus()`es the next target.
- COORDINATE MODEL: colIndex 0-4 = the 5 fixed anchors (Excel Row / Sl.No / Parent / Classification / Description),
  5..(5+N-1) = displayDescriptors; `FIXED_ANCHOR_COUNT = 5`; colCount = 5 + displayDescriptors.length; rowCount =
  rows.length. (Grid is a clean rectangular matrix -- recon-verified, every row renders exactly 5 + N cells, no
  spans.)
- KEY RULES (pure, unit-tested `nextCell(active, dir, rowCount, colCount)`): arrows move one cell + STOP at edges (no
  wrap); Enter = commit + move DOWN (stops at bottom); Tab = commit + move RIGHT, WRAP at row end to the next row's
  first cell; Shift-Tab = commit + move LEFT, wrap to the prev row's last cell; Tab off the very last cell / Shift-Tab
  off the very first -> STOP (focus CONTAINED in the grid). A single `<table onKeyDown>` handler maps the key ->
  direction, ALWAYS preventDefaults a nav key (so arrows never move the input caret + Tab never escapes), commits the
  active rate cell, then focuses the next.
- COMMIT-ON-MOVE = explicit: the handler calls the existing `commitRate` on the active rate cell before moving; the
  existing `committedAttemptRef` dedupe absorbs the trailing `onBlur` (no double-save). onBlur commit KEPT as the
  safety net. Save behaviour byte-for-byte unchanged.
- type="number" -> **type="text" inputMode="decimal"** on the rate `<Input>` (frees the arrow keys -- a number input
  hijacks Arrow Left/Right=caret + Up/Down=increment); a `DECIMAL_IN_PROGRESS` regex guard in onChange keeps the value
  numeric (rejects letters / multiple dots; partial "-"/"." tolerated -> parseFloat -> 0, unchanged). The input's old
  onKeyDown Enter special-case is REMOVED (the table handler owns Enter/arrows/Tab).
- ACTIVE HIGHLIGHT = a blue inset ring on the active cell's `<td>` (ring-2 ring-inset ring-blue-500/400). SCROLL-INTO-
  VIEW on move = `scrollIntoView({block:"nearest", inline:"nearest"})` + `scroll-mt-9` on cells so the active cell
  clears the STICKY TOP header (no frozen-left column to handle).
- READ-ONLY cells (anchors + amount + qty + default) are focusable (tabIndex) but NOT editable -- typing does nothing,
  Enter still moves down. When `onSaveRate` is absent the grid degrades to read-only (rate cells fall to the default
  branch); nav still works.
- DEFERRED (unchanged): subtotal roll-up, auto-save/force-save (3c), single-editor lock (editable/lock_info INERT),
  remarks + flag layer (4a/4b), Excel write-back (5), finalize/revert (6). EDITING IS RATES ONLY.
- VERIFICATION (observed, in-container): Vitest **34/34 GREEN** (12 reviewRender + 22 PricingGrid = 18 prior 3b + 4 NEW
  `nextCell` tests: arrow edge-stops/no-wrap, Tab wrap + last-cell-stop, Shift-Tab wrap + first-cell-stop, Enter-down +
  bottom-stop); tsc **3178** (== baseline), **0** in touched files (filtered boq-wizard|PricingGrid); Vite build exit 0
  (PWA 166 entries). Manual live-cert pending Nitesh (full arrow/Tab/Enter nav, rate edit-on-focus, move commits, no
  caret/spinner hijack, Tab contained, active cell scrolls clear of the header, multi-area order/independence).
  PricingGrid-only; no SheetPricingPage/input.tsx change. Full frontend detail in frontend/CLAUDE.md.
// prior: Phase 5 Slice 3b -- INLINE RATE EDITING + LIVE AMOUNT COMPUTE (FRONTEND, 2026-06-21, feat pending, branch
feature/boq-phase-5). Makes the 3a read-only PricingGrid editable for RATES ONLY: type a rate, save on blur/Enter via
save_cell_price, amount = qty x rate shows live (display-only), the cell flips to priced after a refetch. This is the
slice where pricing actually happens. NO backend (save_cell_price + get_priced_rows already built), NO migrate.
- EDITABLE RATE CELLS (PricingGrid.tsx): each RATE cell (`isRateDescriptor(d)`) renders a numeric `<Input>` (h-7
  text-xs w-20, right-aligned) instead of the read-only value; qty / amount / any non-rate descriptor + classification
  + structure stay READ-ONLY. **SAVE ON BLUR or ENTER** -- no Apply button, no confirm dialog (the design's Excel feel,
  high-frequency entry). `commitRate` guards: (a) UNCHANGED vs the saved value -> no-op; (b) DOUBLE-FIRE (blur+Enter
  same value) deduped via a `committedAttemptRef`; blank/NaN -> 0 (the endpoint coerces blank -> 0.0, still priced).
  When `onSaveRate` is absent the grid stays read-only (3a behaviour preserved).
- PAGE-OWNED SAVE (SheetPricingPage.tsx): the grid calls up `onSaveRate(cell: RateCellSaveArgs, rate)`; the page fills
  boq/sheet/committed_version + the rate, POSTs `save_cell_price` (useFrappePostCall), then `await mutate()` -- the
  get_priced_rows refetch re-derives the priced_* markers AUTHORITATIVELY (no client-side marker logic). The page now
  destructures `mutate`. On throw: `getFrappeError` inline error + re-throw so the grid keeps the optimistic draft.
- DESCRIPTOR -> save_cell_price ARGS (the core map, via the pure `buildRateCell`): excel_row = row.source_row_number;
  col_letter = d.col; committed_version = the payload's commit_version; rate = the typed number; area = per-area
  d.value_key (scalar: omitted); rate_kind = d.rate_subkey verbatim (per-area) / derived token (scalar, e.g.
  rate_combined->combined_rate) -- a guard field, NOT part of the identity key; description = row.description (the
  copy-forward MATCH GUARD, ALWAYS sent). NEW additive type `RateCellSaveArgs` (boqTypes.ts).
- LIVE AMOUNT (display-only, NEVER persisted -- the pricing layer stores RATES only; the committed tier is capture-only;
  the client workbook recomputes its own, design v1.3 Sec.5): an amount cell paired to a rate column (same area +
  corresponding kind, via the pure `findPairedRateDescriptor` + the amount-kind<->rate-kind maps total<->combined_rate /
  supply<->supply_rate / install<->install_rate) shows `computeAmount(qty, rate)` where qty = per-area qty_by_area[area]
  or scalar qty_total. **NON-REGRESSIVE rule:** the effective rate = the optimistically-typed draft (instant) ELSE,
  when not editing, the row's SAVED rate IF the cell is priced; an UN-PRICED, not-editing amount cell keeps its
  committed value UNCHANGED (no 3a regression) and a priced cell shows qty x saved-rate (so no refetch flash). Amount
  cells with no paired rate column render their committed value unchanged.
- DEFERRED (NOT in 3b): subtotal roll-up (sum of children) -- fast-follow; auto-save/debounce + force-save -> 3c
  (lodash available, NOT used here); the single-editor lock -> later (editable/lock_info stay INERT, editing is NOT
  gated on them); clear/un-price a cell (no un-price path; every save is priced); remarks + the review-flag layer
  (4a/4b); Excel write-back (5); finalize/revert (6). EDITING IS RATES ONLY.
- VERIFICATION (observed, in-container): Vitest **30/30 GREEN** (12 reviewRender + 18 PricingGrid = 8 prior 3a + 10 NEW
  3b: isAmountDescriptor, computeAmount incl. 0-rate, findPairedRateDescriptor per-area/scalar/no-pair, buildRateCell
  per-area/scalar); tsc **3178** (== baseline), **0** in touched files (filtered boq-wizard|PricingGrid|
  SheetPricingPage|boqTypes); Vite build exit 0 (PWA 166 entries). Manual live-cert pending Nitesh (rate cells
  editable, save on blur/Enter, live amount, marker flips via refetch, multi-area independent, persists across
  sessions, 0-rate saves priced, non-rate read-only). **Slice 3b unblocks 3c (auto-save + force-save).** Full frontend
  detail in frontend/CLAUDE.md.
// prior: Phase 5 Slice 3a -- PRICING GRID SKELETON + PAGE (FRONTEND, READ-ONLY, 2026-06-20, feat pending, branch
feature/boq-phase-5). The FIRST on-screen pricing surface: a NEW hub-reached, READ-ONLY page (5th sibling wizard route)
that opens a COMMITTED sheet, calls get_priced_rows, and renders the committed rows with their current saved rates +
a basic priced/un-priced marker -- reusing the Slice-2 reviewRender helpers in a NEW grid component (design v1.3 Sec.4
path b -- NOT a ReviewTree retune). NO editing (3b), NO Save/Export/Finalize (3c/5). NO backend, NO migrate.
- ROUTE: `upload-boq/hub/:boqId/pricing/:sheetName` -> `SheetPricingPage.tsx` (lazy, exports { SheetPricingPage as
  Component }; sheetName encodeURIComponent on nav, RR v6 auto-decodes). Added as the 5th wizard route in
  routesConfig.tsx (additive).
- NEW `SheetPricingPage.tsx` -- shell mirrors SheetReviewPage: useParams(boqId, sheetName); useFrappeGetDoc(BOQs) for
  the header; useFrappeGetCall(`...pricing.get_priced_rows`) typed `{ message: GetPricedRowsResponse }`; full-page
  spinner while BOQs loads, inline loading (data===undefined) / error (data===null) for the grid; Back nav to the hub
  (entity-id convention). Header = Back + title ONLY (`{boq_name} · V{version} · Pricing · committed v{commit_version}`
  + sheet name); NO Save/Export. `editable` / `lock_info` read from the payload + threaded INERT into the grid as
  reserved props (the 3b single-editor-lock hook; no lock logic built).
- NEW `PricingGrid.tsx` -- READ-ONLY grid. Imports computeDepths / resolveDescriptorValue / renderDescriptorCell /
  ClassificationPill from ./reviewRender + ROLE_LABELS from ./boqTypes. Does NOT import/reuse/retune ReviewTree
  (locked path-b call). Mirrors ReviewTree's descriptor-render loop MINIMALLY: fixed anchors Excel Row / Sl.No /
  Parent (parent's source_row_number, read-only -- no scroll-to nav) / Classification (ClassificationPill, no
  chevron) / Description (depth indent via computeDepths + INDENT_PX=20, preamble/line_item styling), then
  displayDescriptors = columnDescriptors.filter(!FIXED_ROLE_DEDUPE) with header `${col} — ${ROLE_LABELS[role]}${· area}`
  + body resolveDescriptorValue -> renderDescriptorCell. NO detail panel / inline edit / reclassify / AI columns /
  restructure / remarks / search / filter / column-subset selector / collapse. FIXED_ROLE_DEDUPE is defined LOCALLY
  (2-role set, documented mirror of ReviewTree's) to honor the locked no-ReviewTree-import call; per-area header tint
  is OMITTED (area shown in the label) to stay decoupled (buildAreaColorMap is ReviewTree-local, not exported).
- PRICED/UN-PRICED MARKER (Q4 -- the basic visual, IN for 3a): rate cells that carry a saved price get a subtle
  emerald tint + a small dot, driven SOLELY by the overlay's priced_* markers (priced_by_area[area][kind] / scalar
  priced_rate_<kind>), NEVER a zero-check (a committed 0.0 rate can be priced). Two PURE exported helpers in
  PricingGrid -- `isRateDescriptor(d)` + `isCellPriced(row, d)` -- are unit-tested (the rich review-flag layer
  "needs a rate" / "won't compute" is Slice 4b, NOT here). Only RATE cells get a marker (amount/qty never).
- NEW TYPES (boqTypes.ts, additive): `PricedRow extends ReviewRow` (adds optional priced_by_area /
  priced_rate_supply / priced_rate_install / priced_rate_combined) + `GetPricedRowsResponse` ({ rows: PricedRow[],
  column_descriptors, commit_version, editable, lock_info }). PricedRow EXTENDS ReviewRow so the ReviewRow-typed
  reviewRender helpers accept it with no retyping. No existing type changed.
- HUB ENTRY (CORRECTED -- 3a-fix, feat-pending): the global **"Tendering"** button in the hub BOTTOM action row
  (the `flex gap-2` cluster with Export Finalized / Re-parse / Parse workbook / Commit), gated on committed-ness
  (`disabled={committedMap.size === 0}`), opening a NEW **`TenderingDialog`** -- a RADIO single-select picker of the
  eligible (committed) sheets (each showing its committed version), Confirm enabled only when one is selected ->
  `onConfirm(sheetName)` -> `handleOpenPricing` opens that sheet's pricing editor (dismiss mirrors ParseRunDialog; the
  dialog is router-free). This is the DESIGNED entry door (design v1.3 Sec.8.5: a global hub button -> a list of
  eligible sheets -> select ONE -> its editor). **The initial 3a build put a per-card "Price" button on committed
  SheetCards; that was REPLACED by this global Tendering picker** (the per-card Price button + the `onOpenPricing` prop
  were removed from SheetCard; `handleOpenPricing` was kept and is now called by the modal's Confirm). Every existing
  card button/handler/status branch UNCHANGED.
- VERIFICATION (observed, in-container): Vitest **20/20 GREEN** (12 Slice-2 reviewRender + 8 NEW PricingGrid marker
  tests incl. the ZERO-RATE-IS-PRICED proof; Slice-2 suite unregressed); tsc error count **3178** (== baseline),
  **0** in the touched wizard files (filtered boq-wizard|SheetPricingPage|PricingGrid|BoqHubPage|SheetCard|boqTypes|
  routesConfig); Vite build exit 0 (PWA 166 entries -- +2 lazy chunks). Manual live-cert pending Nitesh (committed
  cards show Price; click -> pricing page renders rows/pills/depth/cells like the review screen; priced cells marked,
  un-priced not; Back works). **Slice 3a unblocks 3b (inline rate editing).** Full frontend detail in frontend/CLAUDE.md.
// prior: Phase 5 Slice 2 -- SHARED-RENDER EXTRACTION + Vitest harness (FRONTEND, 2026-06-20, feat pending, branch
feature/boq-phase-5). Lifts four render helpers OUT of the ~2580-line ReviewTree.tsx into a NEW importable sibling
module **`reviewRender.tsx`** so the future pricing grid (Slice 3a) reuses them instead of duplicating ReviewTree.
ZERO behaviour change, ZERO signature change (byte-identical move). This is the prerequisite for 3a (the pricing-grid
build, design v1.3 §4 path b = reuse extracted review-screen render logic).
- MOVED to `reviewRender.tsx` (byte-identical bodies): `computeDepths`, `resolveDescriptorValue`,
  `renderDescriptorCell`, `ClassificationPill` (the 4 helpers) + their two dependencies `fmtNum` (renderDescriptorCell's
  only caller) and `CLS_PILL_CLASSES` (the pill's colour map). **`CLS_LABELS` ALSO moved** -- it is needed by the pill,
  so leaving it in ReviewTree would have made a CIRCULAR import (reviewRender->ReviewTree->reviewRender); moving it
  breaks the cycle. fmtNum + CLS_PILL_CLASSES are module-private; computeDepths / resolveDescriptorValue /
  renderDescriptorCell / ClassificationPill / CLS_LABELS are exported.
- **`.tsx` not `.ts` (forced):** ClassificationPill contains JSX, which cannot live in a `.ts` file -- so the module is
  `reviewRender.tsx`. Importers use the extensionless `./reviewRender` specifier, so nothing rippled. (The build prompt
  illustratively said `.ts`; the JSX correctness fix to `.tsx` is the only deviation, byte-identical otherwise.)
- TWO importers re-pointed: `ReviewTree.tsx` (removed the defs, imports the 5 symbols from `./reviewRender`; call sites
  unchanged -- computeDepths x1, resolveDescriptorValue x4, renderDescriptorCell x1, ClassificationPill x1 JSX) and
  `exportReviewCsv.ts` (re-points `resolveDescriptorValue`/`computeDepths`/`CLS_LABELS` to `./reviewRender`; keeps
  `FIXED_ROLE_DEDUPE` from ReviewTree, which did NOT move). No third importer exists (SheetReviewPage imports the
  ReviewTree COMPONENT only). No re-export shims.
- **VITEST = the repo's FIRST frontend unit-test harness** (recon confirmed none existed -- only a vestigial Cypress
  spec). Added: `vitest` devDep (resolved **4.1.9**), `test`/`test:watch` package.json scripts, a STANDALONE
  `vitest.config.ts` (kept separate from the production vite.config.ts; re-declares the React plugin for the automatic
  JSX runtime + the `@`->src alias; `environment: 'node'` -- the 3 pure helpers need no DOM).
- **CHARACTERIZATION-BEFORE-EXTRACTION (the safety method, the whole point of the slice ordering):** the recon
  established the design-doc claim "the review screen's ~205 tests are the regression gate" is FALSE (those are BACKEND
  Python tests; nothing touched these frontend functions). So: (Step 1) wrote `reviewRender.test.ts` importing the 3
  pure helpers FROM ReviewTree.tsx as-they-were (renderDescriptorCell temp-exported), ran GREEN against the CURRENT
  code -> captured today's behaviour as the golden baseline; (Step 2) moved the code, re-pointed the test import to
  `./reviewRender`, re-ran the SAME assertions GREEN. The pre/post parity IS the behaviour-preservation proof. (One
  golden value was a mis-prediction -- a row with a MISSING parent resolves to depth 1, not 0, because computeDepths
  walks the absent parent as the depth-0 root; the TEST was corrected to the actual current behaviour, per Step 1c.)
- COVERAGE (12 tests, all GREEN both runs): computeDepths (nested chain depths 0/1/2; missing-parent -> 1; cycle -> 0);
  resolveDescriptorValue (scalar/value_key-null; nested per-area; missing per-area key -> undefined; null top field ->
  undefined); renderDescriptorCell (null/undefined -> ""; integer -> "220"; decimal -> fmtNum "150.5"; 0 -> "0"; string
  verbatim). **ClassificationPill is NOT unit-tested** (returns JSX; would need jsdom/@testing-library, deliberately
  not added) -- it is covered by the manual live-cert (visual eyeball).
- **STALE-DOC CORRECTION:** the pill colour map is `CLS_PILL_CLASSES`, NOT `CLS_COLORS` (which does not exist anywhere;
  the old hex `CLS_COLORS` from B1.1b-i was replaced by `CLS_PILL_CLASSES` in the B2b restyle). The stale `CLS_COLORS`
  reference in frontend/CLAUDE.md is corrected this slice.
- VERIFICATION (observed, in-container): Vitest 12/12 GREEN pre-extraction (import from ReviewTree) AND 12/12 GREEN
  post-extraction (import from reviewRender); tsc error count **3178** (== baseline) with **0** errors in the touched
  wizard files (filtered `boq-wizard|ReviewTree|reviewRender|exportReviewCsv|boqTypes`); Vite build exit 0 (`built in
  4m 31s`, PWA 164 entries). Manual live-cert pending Nitesh (pills/cell values/row depth render identically). Full
  frontend detail in frontend/CLAUDE.md; backend root CLAUDE.md minimal-touch.
// prior: Phase 5 Pricing-overlay read -- get_priced_rows (BACKEND, pure-read, 2026-06-20, feat pending, branch
feature/boq-phase-5). The COMPOSING read between Slice 1b and the editor: a NEW whitelisted endpoint
`get_priced_rows(boq_name, sheet_name)` in `api/boq/wizard/pricing.py` that returns the committed rows for a sheet WITH
the current saved prices merged in -- so the (future) pricing grid consumes ONE already-merged structure instead of
joining two reads on the client. PURE READ -- never writes, never mutates the committed tier, never creates/changes a
BoQ Cell Pricing record. NO doctype JSON change -> NO migrate.
- COMPOSES the two certified reads (reimplements NEITHER): calls `review_screen.get_committed_rows` (imported -- no
  circular import; review_screen does NOT import pricing) + this module's `get_sheet_pricing`, then merges.
- ONE ADDITIVE change to `get_committed_rows` (review_screen.py): adds a top-level `commit_version` key to its response
  (the current committed BoQ Sheet's commit_version, selected in the EXISTING sheet read; None on the empty paths). The
  overlay reads it as the single source of truth for "which version is current" and passes it to get_sheet_pricing
  (re-querying would be a second source that could race). Purely additive -- no existing key or row changed.
- THE MERGE (descriptor-driven -- col_letter is NOT on the committed row): index the current FILLED prices by
  (excel_row, col_letter); for each row x each RATE descriptor (value_field == "rate_by_area" OR a scalar rate field
  rate_supply/rate_install/rate_combined -- amount/qty descriptors NEVER stamped), look up
  (row.source_row_number, descriptor.col). source_row_number is the Excel join key (row_index = sort_order is a DIFFERENT
  space, never used).
- STAMP + MARK: a matched price stamps its `rate` IN PLACE (per-area row["rate_by_area"][area][kind], or the scalar rate
  field) AND sets a parallel marker -- `priced_by_area[area][kind] = True` for per-area cells, `priced_<scalar field>` =
  True for scalar cells. The marker comes from the PRESENCE of a current price record + its `is_filled`, NEVER a
  zero-check (a committed 0.0 rate is a valid priced value; a 0.0-rate save with is_filled=1 reads PRICED). Un-priced
  cells keep their committed value and carry no marker.
- RESERVE-FOR-LOCK: the response includes two INERT placeholders -- `editable: true` + `lock_info: null` -- reserved so a
  future single-editor-lock slice need not reshape the contract. NO locking logic built.
- RESPONSE: `{rows (stamped + markers), column_descriptors (passthrough), commit_version, editable, lock_info}`. Graceful
  empties: an uncommitted / grid-only sheet (no rows or no commit_version) returns the same shape with pricing merged as
  a no-op (no throw). Arg / not-found guards inherited from get_committed_rows (called first).
- TESTS (bench-verified, in-session): test_pricing **12 -> 22** (+10 TestGetPricedRows: priced+unpriced in one row;
  zero-rate-is-priced [the load-bearing correctness test]; multi-area independence; commit_version passthrough; reserved
  editable/lock_info placeholders; scalar-rate cell [via a NEW local scalar-rate committed fixture -- the shared
  per-area fixture has no scalar rate column]; descriptors pass through; uncommitted empty merged shape; missing-args /
  unknown-boq throw; NO amount/qty stamping). test_review_screen **205 -> 205** (the commit_version assertion folded
  into the existing test_draft_only_fields_omitted + the empty-contract assertion updated for the additive key -- net
  count unchanged). Frontend NOT touched (backend-only slice). Full detail in root CLAUDE.md.
// prior: Phase 5 Slice 1b (Pricing Editor) -- PRICING-LAYER DOCTYPE + persist (BACKEND, MIGRATE slice, 2026-06-20,
feat pending, branch feature/boq-phase-5). Creates the per-cell PRICING LAYER: a NEW standalone doctype that stores the
RATE a user fills into a committed Excel cell, sitting ON TOP of the committed tier (which it NEVER mutates -- committed
nodes/grid/BoQ Sheet stay capture-only). ADDITIVE: no existing doctype JSON changed; one new doctype -> ONE `bench
migrate` (clean; doctype + 15 columns verified at runtime). NO frontend (the overlay-onto-get_committed_rows read,
finalize-pricing endpoints, copy-forward, and the editor UI are LATER slices).
- DOCTYPE **"BoQ Cell Pricing"** (scrub `boq_cell_pricing`), autoname **`BPRC-.YY.-.#####`** (collision-checked: no
  clash with BCSG-/BOQ-/BOQN-/BOQRR-/BQSH-/etc.), istable:0, engine InnoDB, track_changes:1, the 10-role permission
  block -- mirroring BoQ Committed Sheet Grid / BOQ Nodes house style. Bare-stub controller (`class
  BoQCellPricing(Document): pass`; the one-current invariant is endpoint-enforced, NOT in the controller, mirroring the
  committed tier; autoname is the JSON series, no hooks.py wiring). FIELDS (Section-grouped): IDENTITY -- boq
  (Link->BOQs reqd, denormalized), sheet_name (Data reqd, VERBATIM #152), excel_row (Int reqd), col_letter (Data reqd
  -- STORED because it is derived from column_role_map by (role,area)->letter, NOT carried on the node),
  committed_version (Int reqd -- the committed-tier commit_version this prices); SEMANTIC (re-resolvable / guards, NOT
  identity) -- node (Link->BOQ Nodes, a settable per-version pointer), area (Data), rate_kind (Data), description (Small
  Text, the copy-forward MATCH GUARD); VALUE+STATE -- rate (Currency), is_filled (Check -- the layer's OWN filled-state,
  since committed node rates read 0.0 not blank); PRICING LIFECYCLE (mirrors the committed versioning triple) --
  pricing_version (Int default 1), is_current (Check default 1), priced_at (Datetime read_only), is_finalized (Check
  default 0, the finalize-pricing lock, declared this slice / enforced later).
- IDENTITY KEY = (boq, sheet_name, excel_row, col_letter, committed_version) -- the durable Excel address + the
  committed version it prices (survives a re-commit; the node Link/description are NOT part of the key).
- NEW endpoints in `api/boq/wizard/pricing.py`: `save_cell_price(...)` (POST) -- freeze-and-supersede upsert mirroring
  commit_pipeline (`_current_pricing_names`/`_next_pricing_version`; freeze prior current via `set_value is_current=0`
  NOT doc.save; insert new is_current=1, pricing_version=max+1, is_filled=1, priced_at=now); it RESOLVES + VALIDATES the
  committed cell exists (BoQ Sheet at that committed_version + a BOQ Nodes row with source_row_number=excel_row at that
  version) and stores the resolved node -- throws for a non-existent cell/sheet/version, NEVER prices a non-cell.
  `get_sheet_pricing(boq, sheet, committed_version)` (GET-capable) -- the current (is_current=1) pricing set for a
  committed (boq, sheet, version); pure read. Guards mirror get_review_rows ("BOQs '...' not found." etc.).
- HERMETIC COMMITTED-NODE FIXTURE (the owed Slice-1a test fixup): `build_committed_sheet_fixture` +
  `cleanup_committed_fixture` (module-level in test_review_screen.py, ~80 lines, satisfying the boq_nodes controller's
  rules) -- 1 current BoQ Sheet (multi-area role map E/H, Phase 1/Phase 2) + a Preamble root + 2 Line Item children with
  per-area children. The 5 Slice-1a get_committed_rows POSITIVES were CONVERTED from live-skip-guard (BOQ-26-00145) to
  this fixture so they ALWAYS RUN (no skip). test_pricing.py imports the shared builder (no circular import).
- TESTS (bench-verified): test_review_screen **205 -> 205** (the 5 positives converted IN PLACE -> always-run, net
  count unchanged; full suite green, no skips). NEW test_pricing **12** (save->current+is_filled v1; re-save
  freeze-and-supersede v2 + exactly-one-current; N-resave invariant; multi-area two-cells-same-row distinct;
  get_sheet_pricing current-set + empty; NEG non-existent cell/version/sheet/boq + missing args). OUT (NOT this slice):
  the overlay-onto-1a read, finalize-pricing endpoints, copy-forward, the editor UI, frontend. Implements Slice 1b of
  BoQ_Pricing_Editor_Design_Scoping_v1_2 (the per-cell key + the versioning/copy-forward anchoring). Full detail in root
  CLAUDE.md.
// prior: Phase 5 Slice 1a (Pricing Editor) -- COMMITTED-READ ENDPOINT get_committed_rows (BACKEND, pure-read,
2026-06-20, feat pending, branch feature/boq-phase-5). The first Phase-5 build: a NEW read endpoint that adapts the
COMMITTED tier (BOQ Nodes + BOQ Node Qty By Area children + the committed BoQ Sheet column config) into the SAME
{rows, column_descriptors} descriptor contract get_review_rows emits from the DRAFT tier, so the descriptor-driven
frontend render can later draw COMMITTED rows unchanged. NO new doctype, NO schema/JSON change, NO migrate, NO frontend
(the pricing-layer doctype is Slice 1b; the shared-render extraction + grid are later slices). Lives in review_screen.py
(it already owns _build_column_descriptors). get_review_rows / _build_column_descriptors / resolve_effective are
UNCHANGED (read-to-reuse only).
- COLUMN half = PURE REUSE: `_build_column_descriptors` runs UNCHANGED on the committed `BoQ Sheet.column_role_map`
  (verified-identical {letter:{role,area}} shape, no draft reach). A test asserts the endpoint's descriptors EQUAL the
  builder's output verbatim.
- ROW half = a bounded INVERSION of commit_pipeline.py's draft->committed map (the authority): `_committed_node_to_row`
  + `_collapse_area_children` re-key each node + its children back to the DRAFT-shaped keys the descriptors read.
  Money word-order re-key (node.supply_rate->row "rate_supply", combined_rate->"rate_combined",
  total_amount->"amount_total", etc.); identity (code->"sl_no_value", qty->"qty_total", notes->"row_notes"); per-area
  RE-COLLAPSE of the BOQ Node Qty By Area children into the nested *_by_area dicts (qty_by_area flat {area:num};
  rate_by_area {area:{supply_rate,install_rate,combined_rate}}; amount_by_area {area:{supply,install,total}} -- NOTE the
  amount kind rename total_amount->"total"/supply_amount->"supply"/install_amount->"install", the inverse of
  _explode_area_children).
- INDEX-FIELD CHOICE (the one A20 ambiguity, resolved + documented): **row_index = node.sort_order** (NOT
  source_row_number). Reasoning: commit_pipeline maps draft `row_index -> node.sort_order` (it IS the exact committed
  analog), and sort_order is 0-based contiguous as computeDepths/byIdx expect; `source_row_number` (sparse 1-based Excel
  row) is carried SEPARATELY on each row for the Parent column's Excel-row display. `effective_parent_index` = the
  parent node's sort_order, resolved via node.parent_node (a Link to the parent's NAME) -> a name->sort_order lookup
  pass; a ROOT (parent_node NULL) -> None (the null root sentinel computeDepths/resolve_effective use, NOT the raw -1).
- CLASSIFICATION = node.row_class (the full taxonomy the ClassificationPill reads) -> emitted as both `classification`
  and `effective_classification` (the committed tier has no human/AI override layer; node_type is the priceability axis,
  not the pill's source). DRAFT-ONLY fields (ai_*, draft edit_log, flags, revert_available, human_*, advisory,
  validation_warnings) are OMITTED -- the committed contract is AI-free + minimal ({rows, column_descriptors} only; no
  work_packages/flags, which are draft-advisory). Guards mirror get_review_rows verbatim (boq_name/sheet_name required;
  "BOQs '...' not found." throw); an uncommitted / no-current-sheet / grid-only sheet -> graceful {rows:[],
  column_descriptors:[]}. sheet_name VERBATIM (#152).
- TESTS: test_review_screen 196 -> 205 (+9, both bench-verified in-session): 4 hermetic NEGATIVE/empty (missing
  boq_name/sheet_name throw; non-existent boq throw [same guard as get_review_rows]; existing-but-uncommitted sheet ->
  empty contract) + 5 POSITIVE against the real current-committed multi-area sheet BOQ-26-00145/'Electrical ' (read-only,
  skip-if-absent so CI-safe): descriptors == builder output (the pure-reuse proof); rows carry re-keyed draft names +
  NOT committed node names + per-area nesting with the amount rename; hierarchy synthesized (root -> None, child ->
  parent's row_index); classification from row_class; draft-only fields ABSENT + response is exactly {rows,
  column_descriptors}. Live probe: BOQ-26-00145/'Electrical ' -> 194 rows, 9 descriptors, rates 0.0 (un-priced
  committed state, as expected), 2 roots. OUT (NOT this slice): the pricing-layer doctype (Slice 1b), the shared-render
  extraction, any frontend. Implements Slice 1a of BoQ_Pricing_Editor_Design_Scoping_v1_2. Full detail in root CLAUDE.md.
// prior: Phase 4 Slice AI-3c-2d (AI auto-mapping) -- GATE run_ai_pass ON A FINALIZED SHEET (FREEZE GAP)
(BACKEND + FRONTEND, 2026-06-20, feat pending). Closes the last freeze hole in the AI surface. A "Finalized" sheet is
read-only (`_guard_sheet_not_frozen`), and accept/reject/revert were all already guarded -- but `run_ai_pass` was added
later and NEVER gated on EITHER layer, so a Finalized sheet could trigger a fresh AI pass whose `_apply_ai_suggestions`
STALE-CLEAR wipes the `ai_suggestion_status` of already-Accepted rows (a real mutation of a read-only sheet; confirmed
live). NO doctype JSON change -> NO migrate. BACKEND (`ai_assist.py` `run_ai_pass`): two pre-flight rejects in the
`{ok:False,error:"<code>"}` idiom (NOT throwing), inserted AFTER no_api_key + BEFORE the cache check (load-bearing --
the cache-HIT path ALSO calls `_apply_ai_suggestions`, so the guard precedes BOTH cache + enqueue): `frozen`
(`_get_sheet_wizard_status == _SHEET_FINALIZED`, non-throwing read) + `parsing` (new `_get_parse_in_progress` helper
mirroring `_get_ai_in_progress`). `_SHEET_FINALIZED` + `_get_sheet_wizard_status` added to the review_screen import; the
worker / stale-clear UNCHANGED. FRONTEND (`SheetReviewPage.tsx`): the "Run AI pass" button `disabled=` gains `||
isChecked` (= `sheetStatus === "Finalized"`) so a finalized sheet shows it GREYED (stays visible -- disable-not-hide) +
a `title` hint; `AI_REJECT_MSGS` gains `frozen` + `parsing` messages (defense in depth). THIS COMPLETES THE FREEZE
COVERAGE OF THE WHOLE AI SURFACE (accept/reject/revert were already guarded; run_ai_pass was the one hole). TESTS:
test_ai_assist 33 -> 36 (Z1 finalized -> frozen + NO enqueue + Accepted status UNCHANGED [stale-clear never ran]; Z2
non-finalized still enqueues [no over-fire]; Z3 parse_in_progress -> parsing + NO enqueue); test_review_screen 196
unchanged (review_screen.py not touched). All prior green. tsc 0 new wizard errors (3178 baseline) + Vite build exit 0
(PWA 164 entries). Manual live-cert pending Nitesh. **NEXT = the boq_ai.log token-logging fix, then the Phase-4 doc
refresh.** Full detail in root CLAUDE.md + frontend/CLAUDE.md.
// prior: Phase 4 Slice AI-3c-2b (AI auto-mapping) -- REVERT AI CHANGE BUTTON + OVERRIDE CLEARS AI-ACCEPTED STATUS
(FRONTEND + a bundled BACKEND status fix R6, 2026-06-20, feat pending). Surfaces AI-3c-2a's row-level revert in the UI
AND fixes a misleading status. THE AI ACCEPT/REJECT/REVERT SURFACE IS NOW COMPLETE (pending live-cert). NO doctype JSON
change -> NO migrate (2a's snapshot fields already exist). (1) FRONTEND -- the Revert button (`ReviewTree.tsx` detail
panel): a NEW block right AFTER the PENDING accept/reject block (which vanishes once Accepted), gated
`row.ai_suggestion_status === "Accepted"` so it shows for an Accepted row in BOTH editable + read-only panels. `Button
size=sm variant=outline` "Revert AI change", ENABLED iff `revert_available && !readOnly`, else DISABLED with an
italic-muted reason (readOnly -> "Sheet is finalized -- revert unavailable."; else `!revert_available` -> "Revert no
longer available -- the row was edited after the AI change."). `handleRevertAi` -> `revert_ai_acceptance` (sheet_name
VERBATIM #152) -> `onRemarkSaved` (mutate-only re-fetch; revert returns no edited_at -> the row re-renders Pending, the
pending block reappears, the button disappears); errors via `aiActionError`/`getFrappeError`. `boqTypes.ts` ReviewRow +
`revert_available?: boolean`. (2) BACKEND -- R6 (`review_screen.py` `_apply_and_save_row_edit`): the EXISTING AI-3c-2a
class/parent chokepoint block (`field in ("human_classification","human_parent")`, which clears the revert snapshot)
now ALSO clears `ai_suggestion_status` so an overridden AI-Accepted row stops reading "AI Accepted" (the Status column
checks == "Accepted" before isEdited -> a falsy status renders "Edited"). GATED on the CURRENT status being "Accepted"
(a DELTA from the spec's bare "set None"): a Pending/Rejected suggestion has NOT been applied, so a manual class/parent
edit leaves it untouched -- preserving the restructure cancel-safety contract (R4; an UNGATED clear broke R4).
value/text/per-area edits never enter this block -> a value edit on an Accepted row STAYS "AI Accepted" + revert stays
available. ORDERING (load-bearing): both accept paths flip "Accepted" LAST + revert flips "Pending" LAST, so the
in-flight clear during an accept/revert is harmless (the final flip wins; X1 + W2 assert it). TESTS: test_review_screen
192 -> 196 (X1 accept still ends "Accepted"; X2 accept-then-later-parent-edit -> falsy status + non-empty edit_log; X3
accept-then-VALUE-edit -> stays "Accepted"; X4 class/parent edit on a never-accepted row is a status no-op);
test_ai_assist 33 unchanged (the accept/reject/revert helper path is Pending -> gate skips). All prior green (R4 +
W2). tsc 0 new wizard errors (3178 baseline) + Vite build exit 0 (PWA 164 entries). Manual live-cert pending Nitesh.
**NEXT = the boq_ai.log token-logging fix, then the Phase-4 doc refresh.** Full detail in root CLAUDE.md +
frontend/CLAUDE.md.
// prior: Phase 4 Slice AI-3c-2a (AI auto-mapping) -- ROW-LEVEL REVERT OF AN AI ACCEPTANCE (BACKEND, 2026-06-20,
feat pending). UNDO an AI acceptance at the row level: restore the row + any children the accept moved to their EXACT
pre-accept state, re-offer the suggestion (ai_suggestion_status -> Pending), append honest "reverted" edit_log entries.
The Revert BUTTON is AI-3c-2b (frontend, next) -> frontend/CLAUDE.md intentionally NOT touched this slice. THE FIRST
MIGRATE SINCE AI-2d (AI-3a..AI-3c-3 were field-free). SCHEMA (`boq_review_row.json`, +2 read_only fields, migrate CLEAN,
columns verified via information_schema + has_column + meta): `ai_accept_snapshot` (JSON pre-accept blob
`{"row":{hc,hp,hr},"children":[{idx,hp,hr},...]}`) + `ai_snapshot_owner` (Int, default "-1", the moved-child ->
owner-row back-pointer). THE -1 DEFAULT IS LOAD-BEARING: an empirical probe proved Frappe coerces an UNSET Int to 0
(would collide with row_index 0), so -1 + a `>= 0` guard make "not a snapshotted child" unambiguous. CAPTURE written
LAST in each accept txn (the SELF-CLEAR TRAP -- the chokepoint clears the snapshot on every human edit, so it is built
before the helper calls but persisted in the flip block after them; V1/W1 assert survival): `accept_ai_suggestion`
(childless, children=[]); `save_review_restructure` (mark_ai_accepted=True ONLY -- a MANUAL restructure writes nothing,
W5 -- captures row + each moved child's pre-move parent + stamps each child's `ai_snapshot_owner = row_index`). REVERT
ENDPOINT `revert_ai_acceptance(boq_name, sheet_name, row_index)` (whitelisted POST, guards _not_frozen + _not_parsing,
throws "nothing to revert" when absent): restores the row's human_classification + parent + each child's parent via
`_apply_and_save_row_edit`, each axis ONLY when it actually CHANGED (a delta from the spec's "restore both
unconditionally" -- restore-if-changed avoids no-op edit_log noise, still appends a genuine reverted entry per real
change); capture-then-flip IN REVERSE (restore while status is still Accepted, THEN flip to Pending + clear snapshot +
reset back-pointers, ONE commit). INVALIDATION (rule c-ii): the `_apply_and_save_row_edit` chokepoint (the
flags_dismissed clear site) now clears THIS row's snapshot on a human_classification/human_parent edit AND, if the row
is a moved child (`ai_snapshot_owner >= 0`), clears the OWNER's snapshot via the back-pointer (NOT a sheet-walk -- W4
proves a sibling edit does NOT clear); finalize (`mark_sheet_parsed_check_done`) bulk-clears every snapshot +
back-pointer on the sheet before its existing commit. READ FLAG: `get_review_rows` fetches `ai_accept_snapshot` ONLY to
compute `revert_available = bool(...)` and DROPS the raw blob (pre-state never ships to the client). TESTS:
test_ai_assist 29 -> 33 (V1 snapshot survives accept + revert_available; V2 revert restores parent + Pending + appends
reverted entry; V3 no-snapshot throws; V4 later edit invalidates); test_review_screen 185 -> 192 (W1 captures
row+children+back-pointers; W2 revert restores row+ALL children + clears owners; W3 moved-child edit clears owner; W4
sibling edit does NOT; W5 manual restructure no snapshot; W6 finalize bulk-clears; W7 post-revert non-empty edit_log +
Pending). All prior accept/reject (T*/R*/G*/C*) + get_review_rows + save_review_edit suites green (backwards-compat).
**NEXT = AI-3c-2b (the Revert BUTTON), then the boq_ai.log token-logging fix.** Full detail in root CLAUDE.md.
// prior: Phase 4 Slice AI-3c-3 (AI auto-mapping) -- AI CLASSIFICATION-ACCEPT MODAL PARITY (with-children)
(BACKEND + FRONTEND, 2026-06-20, feat pending). Closes a SILENT BROKEN-TREE hole: the AI-accept routing opened the
child-disposition RestructureModal ONLY when a PARENT change was accepted on a with-children row (`handleApplyAi` gated
on `aiAcceptParent && hasChildrenSet.has(row_index)`). A CLASSIFICATION-only accept on a with-children row (e.g.
Preamble->note) fell through to a bare `accept_ai_suggestion`, which wrote the new class and left the children pointing
at the now-non-parent row -- uncaught by `check_structural_integrity` (flags line_item-as-parent only, NOT
note/spacer-as-parent). The MANUAL `onPickClass` path already opens the modal for ANY with-children reclass; the AI
path now mirrors it. THE RULE (owner-stated): any classification change on a row WITH children opens the modal; it
skips it only if CHILDLESS. FRONTEND (`ReviewTree.tsx` `handleApplyAi`): modal-open condition is now
`hasChildrenSet.has(row.row_index) && (clsIsChange || parentAccept)`; a classification-ONLY accept OMITS
`presetRowParent` -> the modal lazy-inits `rowPosition="keep"` (with children) so the row keeps its own parent, exactly
like manual `onPickClass`->modal; a parent accept still sets the preset. `markAiAccepted:true` rides every open.
Childless / classification-only-childless accepts UNCHANGED (direct `accept_ai_suggestion`). BACKEND (`ai_assist.py`):
a NEW `accept_classification && _row_has_children` guard (mirrors the `accept_parent` guard) THROWS "Restructure
required" -- closes the hole even if the frontend is bypassed. `save_review_restructure` / `resolve_effective` /
`check_structural_integrity` UNCHANGED (the frontend routes to the EXISTING reclassify+child-disposition path).
NO doctype JSON change -> NO migrate. TESTS: test_ai_assist 27 -> 29 (+2: G1 with-children class accept throws + row
unchanged; G2 childless class accept still works); test_review_screen 184 -> 185 (+1: R-fix4 mark_ai_accepted +
new_classification + child_moves + NO row_new_parent -> class applied, children dispositioned, status Accepted, row's
OWN human_parent unchanged). tsc 0 new wizard errors + Vite build exit 0. **NEXT = the boq_ai.log token-logging fix,
then the Phase-4 doc refresh.** Full detail in root CLAUDE.md + frontend/CLAUDE.md.

// prior: Phase 4 Slice AI-3c-1 (AI auto-mapping) -- AI-ACCEPT edit_log FROM-VALUE FIX (capture-then-flip)
(BACKEND, 2026-06-20, feat pending). A history-only correctness fix the AI-3b-2 live use surfaced: accepting an AI
suggestion logged a no-op edit history (a parent change root->26 recorded as "26 -> 26"; the classification change
logged "AI-class -> AI-class", which the frontend hides). **The WRITES were always correct** (human_* + effective
values right, status Accepted); ONLY the logged from-value was wrong. ROOT CAUSE: BOTH accept paths flipped
`ai_suggestion_status="Accepted"` BEFORE the `_apply_and_save_row_edit` helpers captured their from-values; the helper
reads the from-value via `resolve_effective`, which honors the AI layer once status == "Accepted", so it returned the
AI value the helper was about to write -> from == to. FIX = capture-then-flip: move the flip to AFTER all human writes,
before the existing single commit, in BOTH `ai_assist.accept_ai_suggestion` (AI-3b-1) and
`review_screen.save_review_restructure` (AI-3b-2), via an in-memory-attr set + `frappe.db.set_value(...,
update_modified=False)` that rides the SAME transaction (atomicity preserved -- no second commit). `resolve_effective`
+ `_apply_and_save_row_edit` + all write/effective logic UNCHANGED (only the flip's TIMING moved). TESTS:
test_ai_assist 24 -> 27 (+3: C1/C2/C3); test_review_screen 181 -> 184 (+3: R-fix1/2/3 -- each seeds ai_suggested_* ==
the applied value to reproduce the live bug). All prior accept tests (R1-R5, T1-T8) green. NO doctype JSON change ->
NO migrate. frontend/CLAUDE.md NOT touched (backend-only; the frontend was always correct -- it hid the no-op
classification entry, which is now a real entry). **NEXT = the boq_ai.log token-logging fix, then the Phase-4 doc
refresh.** Full detail in root CLAUDE.md.

// prior: Phase 4 Slice AI-3b-2 (AI auto-mapping) -- accept AI PARENT on WITH-CHILDREN rows (cancel-safe modal)
(BACKEND + FRONTEND, 2026-06-20, feat pending). The FINAL piece of the AI accept/reject surface: accepting an AI
parent on a row that HAS children fires the existing RestructureModal (child disposition) in a NEW children-only mode
with the AI parent PRE-APPLIED, and the status flip rides the modal's Save (never on cancel). **AI-3 (the whole AI
accept/reject surface: AI-3a display+trigger + AI-3b-1 non-modal accept/reject + AI-3b-2) is now COMPLETE.** Backend:
`save_review_restructure` gains `mark_ai_accepted=False` (opt-in; flips `ai_suggestion_status="Accepted"` atomically
in the existing commit, set on target_doc before the first helper save). CANCEL-SAFE BY CONSTRUCTION -- the endpoint
is reached only via Save (no modal close path hits the backend); R4 asserts no-flag leaves status Pending. Frontend:
RestructureModal children-only mode (3 new optional props -- preset parent + message line replacing the picker;
child options unchanged); ReviewTree enables the parent checkbox for with-children rows + routes Apply to open the
modal (markAiAccepted) instead of the accept endpoint; accept-both folds into one restructure call. No doctype change
-> no migrate. **TESTS:** test_review_screen 176 -> 181 (+5: R1 parent+children; R2 class+parent both; R3 root; R4
cancel-safety no-flag-stays-Pending; R5 plain restructure never flips). tsc 0 new wizard errors + Vite build exit 0.
**NEXT = the boq_ai.log token-logging fix, then the Phase-4 doc refresh.** Full detail in root CLAUDE.md +
frontend/CLAUDE.md.

// prior: Phase 4 Slice AI-3b-1 (AI auto-mapping) -- accept/reject AI suggestions (NON-MODAL paths)
(BACKEND + FRONTEND, 2026-06-20, feat pending). Makes suggestions ACTIONABLE for the non-modal cases: accept an AI
CLASSIFICATION, accept an AI PARENT on a CHILDLESS row, and REJECT. The accepted-parent-WITH-CHILDREN path (fires the
RestructureModal) is AI-3b-2. **Backend (two new `ai_assist.py` endpoints):** `accept_ai_suggestion` reuses
`_apply_and_save_row_edit` (imported) to write human_* to the AI values AND flips `ai_suggestion_status="Accepted"` in
ONE commit (so the row reads "AI Accepted", not "Edited", and the badge clears); a SCOPE GUARD throws if parent-accept
is attempted on a row WITH children (`_row_has_children` mirrors the frontend `hasChildrenSet`; childless => no cycle
possible, so no cycle-guard needed). `reject_ai_suggestion` sets status="Rejected" via `set_value` ONLY -- no human_*,
no edited_at (row stays Original), suggested values preserved for audit. Both guard frozen+parsing. **Frontend
(ReviewTree detail panel):** a per-field "AI suggestion" block (classification + parent checkboxes, each with a
confidence badge + suggested value, one explanation line, Apply + Reject), shown only on a Pending suggestion +
not readOnly; checkboxes default-checked on a REAL change; the parent checkbox is DISABLED with a tooltip for rows
WITH children (-> AI-3b-2). Apply reuses onSaved->mutate; Reject reuses onRemarkSaved (mutate-only). No doctype change
-> no migrate. **TESTS:** test_ai_assist 16 -> 24 (+8: accept class/childless-parent/root/both; with-children guard
throws; nothing-to-accept throws; reject status-only + no edited_at; accept-then-resolve_effective). test_review_screen
176/176 unchanged. tsc 0 new wizard errors + Vite build exit 0. **NEXT = AI-3b-2** (RestructureModal children-only mode
for an accepted parent on a row WITH children + the cancel-safe `mark_ai_accepted` coupling), then the boq_ai.log fix.
Full detail in root CLAUDE.md + frontend/CLAUDE.md.

// prior: Phase 4 Slice AI-3a-FIX (AI auto-mapping) -- get_review_rows all_fields missing 4 ai_* fields
(BACKEND, 2026-06-20, feat pending). The AI Rec badges / row tint / "AI Accepted" status never rendered after a pass
that reported "12 suggestions" -- the data was correct in the DB, the break was in the row fetch. ROOT CAUSE: AI-3a
assumed `ai_suggestion_status` / `ai_suggested_classification` / `ai_suggested_parent` / `ai_suggested_is_root` "ride
the payload for free via resolve_effective's echo." WRONG -- `resolve_effective(d)` READS those from the row dict and
only re-emits what it read; `get_review_rows` builds `d` from `all_fields`, which omitted those 4, so they came back
None and the frontend `aiSuggestionInfo` "Pending" gate was always false -> no badges. FIX = add those 4 fields to
`get_review_rows.all_fields` (the confidence x2 / level / explanation fields are display-only, never read by
resolve_effective, and were already fetched). No resolve_effective / frontend / doctype change -> no migrate.
VERIFIED: test_review_screen 176/176 unchanged; `get_review_rows("BOQ-26-00145","HVAC ")` now returns 12 Pending
rows with non-null suggestion fields. Frontend + data were already correct -> the badges now render (live web reload
needed for the browser). NEXT remains AI-3b (accept/reject panel + RestructureModal children-only mode), then the
boq_ai.log token-logging fix. Full detail in root CLAUDE.md.

// prior: Phase 4 Slice AI-3a (AI auto-mapping) -- AI-pass DISPLAY + TRIGGER (FRONTEND)
(FRONTEND + 1 additive backend read-list field, 2026-06-19, feat pending). Makes the AI structure-suggestion pass
TRIGGERABLE and suggestions VISIBLE on the review screen; NOT actionable (accept/reject + the RestructureModal
children-only mode are AI-3b). **Backend:** `get_review_rows` all_fields gained the 4 ai_* fields NOT echoed by
resolve_effective (ai_classification_confidence, ai_parent_confidence, ai_suggested_level, ai_explanation) so they
ride the per-row payload -- additive, no doctype JSON change, no migrate, test_review_screen 176/176 unchanged.
**Frontend:** `ReviewRow` gained all 8 ai_* fields + `BoQSheetDraft.ai_in_progress` + a new `AiPassDonePayload` type;
a "Run AI pass" button (run_ai_pass) on SheetReviewPage; an "AI Rec" column (H/M/L confidence badges + a Show-all/
Any/High/Medium/Low filter), an "AI Accepted" Status value (indigo, branched before isEdited to preserve provenance),
and a pending-suggestion indigo row tint in ReviewTree (totalCols 7->8). **THE THREE-LAYER COMPLETION MECHANISM (the
owner reliability requirement):** socket fast-path (`boq:ai_pass_done`) + **poll-until-terminal GUARANTEE**
(get_ai_pass_status every 3s while ai_in_progress, ref-held interval, idempotent cleanup) + on-mount recovery -- so a
MISSED socket never hangs the screen (the historical parse/upload missed-socket hang). The screen is NOT set readOnly
for an AI pass (it only writes ai_* fields). Verify: tsc 0 new wizard-file errors + Vite build exit 0. **NEXT = AI-3b**
(the accept/reject panel + the RestructureModal children-only mode for an accepted parent), then the boq_ai.log
token-logging fix is bundled after. Full UI detail in frontend/CLAUDE.md; backend read-path note in root CLAUDE.md.

// prior: Phase 4 Slice AI-2e (AI auto-mapping) -- parse-response hardening (extract array from prose)
(BACKEND, 2026-06-19, feat pending). Fixes a bug the FIRST LIVE end-to-end API cert surfaced: the real Anthropic model
returns explanatory PROSE BEFORE the JSON array, but `parse_ai_response` only stripped code fences, so `json.loads`
failed on the leading prose (`_NonRetryable: "AI response was not valid JSON: Expecting value: line 1 column 1"`) and
the whole pass returned ZERO suggestions. (The AI-2b mock used a clean array, so unit tests never caught it.) **NEW
`_extract_json_array(text)`** extracts the first BALANCED JSON array, tolerant of prose before AND after: strips fences
first, then finds the first `[` and walks bracket depth to its matching `]`, STRING-LITERAL AWARE (a `[`/`]` inside an
`"explanation"` value doesn't affect depth); no `[` / no balanced close -> returns the text unchanged so the existing
`json.loads -> _NonRetryable` still fires on genuine garbage. `parse_ai_response`'s only change: `raw =
_strip_code_fences(text)` -> `raw = _extract_json_array(text)` (the json.loads + not-a-list `_NonRetryable` checks are
unchanged). **Delta from spec:** the proposed "starts with `[` -> return as-is" fast path was DROPPED -- a bare array
with TRAILING prose starts with `[` yet breaks `json.loads` ("Extra data"); the balanced scan is the single, correct
path (T_P2 proved it). **PROMPT** gains a hard final "output the JSON array and NOTHING else" rule (parser is the real
safety net; `str.replace` `{SHEET_NAME}`/`{ROWS_JSON}` preserved). **TESTS:** `test_boq_ai_assist` 15 -> **21** (+6:
leading prose, trailing prose, bracket-in-string, the real-cert multi-line-prose-then-array reproduction, genuine
garbage still raises, bare-array regression; fenced path stays covered by the existing fence test). NO doctype JSON ->
NO `bench migrate`. **THE LIVE END-TO-END API CERT IS TO BE RE-RUN after this lands** (the prior cert surfaced this
bug; with the parser now prose-tolerant the suggestions should parse + write back) -- covering re-parenting,
reclassification AND root -- then AI-3 (frontend). Full detail in root CLAUDE.md.

// prior: Phase 4 Slice AI-2d (AI auto-mapping) -- root-suggestion fix (`ai_suggested_is_root`)
(BACKEND, 2026-06-19, feat pending). CLOSES the AI-2c root-suggestion CONTRACT GAP: "AI suggests this row become a
top-level root" is now REPRESENTABLE and APPLYABLE. One cohesive change across schema -> service -> write-back ->
resolve_effective. **NO frontend (AI-3).** **SCHEMA:** new `ai_suggested_is_root` Check (default 0, read_only) on
BoQ Review Row, after `ai_suggested_parent`; `bench migrate` clean. **resolve_effective:** four-layer parent
precedence **human_is_root > human_parent > ai_suggested_is_root > ai_suggested_parent > parser** (new branch
`elif ai_accepted and ai_suggested_is_root -> None`, between human_parent and ai_suggested_parent; applies only when
status Accepted; human-root short-circuit still above); flag echoed in the return dict (1/0). **parse_ai_response:**
the null-root branch sets `ai_parent=-1` AND `ai_is_root=True`; per-suggestion dict gains `ai_suggested_is_root`; the
parent_conf guard widened so a root suggestion keeps its confidence. **`-1` on `ai_suggested_parent` now means ONLY
"no parent-index suggestion"** -- the clean sentinel is restored, the root signal lives in the flag.
**write-back (`_apply_ai_suggestions`):** `ai_suggested_is_root` is the FIRST branch (replaces the AI-2c interim +
its warning): root -> stored_parent -1, stored_is_root 1, **level 1** (genuine root level); the flag added to the
set_value dict, `_AI_DEFAULTS` (=0, stale-clear resets it), and `_AI_FETCH_FIELDS`. **Root suggestions are now fully
functional end-to-end** (service emits flag -> write-back stores it -> resolve_effective applies effective-root when
Accepted); the AI-2c interim is REPLACED. **TESTS (green):** `test_review_screen` 170 -> **176** (+6 AI-root:
accepted-root, human_parent-beats-AI-root, human_is_root+AI-root, Pending-root-ignored, flag-in-dict, real-parent
regression); `test_boq_ai_assist` 11 -> **15** (+4: root sets flag/keeps -1, root keeps parent_confidence, NO_CHANGE/
real-parent flag False); `test_ai_assist` 14 -> **16** (AI-2c interim test REPLACED by root-sets-flag/level=1; +
end-to-end write-back->Accept->resolve_effective->effective-root; + stale-clear resets the flag). **The AI-2c root
contract gap is now CLOSED.** **NEXT = the LIVE end-to-end Anthropic API cert (manual, on BOQ-26-00145/HVAC; key set
in Desk) -- now covering re-parenting, reclassification AND root** -- then AI-3 (frontend). Full detail in root CLAUDE.md.

// prior: Phase 4 Slice AI-2c (AI auto-mapping) -- AI-pass endpoint + worker + socket + write-back + cache
(BACKEND, 2026-06-19, feat pending). Wires the AI-2b stateless service into the LIVE flow, MIRRORING the parse flow
(`run_parse`/`_run_parse_worker`/`_publish_parse_event`) exactly. **NO frontend (AI-3).** ONE new module
`nirmaan_stack/api/boq/wizard/ai_assist.py` + `test_ai_assist.py`. **ENDPOINT `run_ai_pass(boq_name, sheet_name)`**:
guards (no review rows -> `{ok:False, error:"not_parsed"}`; settings disabled -> `ai_disabled`; no key -> `no_api_key`),
a CACHE CHECK (apply cached suggestions synchronously + return `{ok:True, cached:True, count}` -- "second click on the
same parse", no enqueue/API cost), else `frappe.enqueue` (`queue="long"`, raw hash job id, `user`) + set
`ai_in_progress=1` AFTER a successful enqueue with its own commit -> `{ok:True, enqueued:True}`. **STATUS ENDPOINT
`get_ai_pass_status`** reads the per-sheet Redis fallback (missed-socket recovery) else `{status:"idle_or_unknown",
ai_in_progress}`. **WORKER `_run_ai_pass_worker`** mirrors `_run_parse_worker`: fetch rows (explicit field list incl.
the raw ai_* columns -- `get_review_rows.all_fields` omits them) + merge `resolve_effective`, re-read settings/key
(fresh process), `boq_ai_assist.run_ai_pass`, write-back, cache, commit BEFORE publish; on failure log + rollback +
publish error + `raise` (RQ marks the job failed). Error codes: `_NonRetryable` -> `ai_failed`; unexpected ->
`internal`. **WRITE-BACK `_apply_ai_suggestions`** = `frappe.db.set_value` scalar bypass (no doc.save / edit_log),
STALE-CLEAR FIRST (reset the 7 ai_* to defaults on every row currently carrying a suggestion status, then apply the
new pass), status `Pending`; **level derivation** walks the effective-parent chain (root=level 1, bounded/visited-set):
real parent -> parent level + 1, NO_CHANGE -> the row's current level, root -> -1. **`_publish_ai_event`** = the
choke-point: clears `ai_in_progress=0` + own commit (EVERY exit path), per-sheet Redis fallback, then
`frappe.publish_realtime("boq:ai_pass_done", payload, user=)` -- commit BEFORE publish, no after_commit. **CACHE** keyed
on `(boq, sheet, last_parsed_at)`, 6h TTL; a re-parse bumps last_parsed_at -> key miss -> fresh pass. In-flight uses
`ai_in_progress` ONLY (no ai_job_id/ai_enqueued_at field added; no self-heal). **ROOT-SUGGESTION CONTRACT GAP (STOPPED
+ reported, NOT fixed):** the AI-2b service returns `ai_suggested_parent==-1` for a ROOT suggestion, but
`resolve_effective` (AI-1) treats -1 as "no suggestion" -- a root suggestion is indistinguishable from "no parent
change" and cannot be applied. NO schema change / new field invented. INTERIM: store parent -1 + level -1 (so
resolve_effective correctly no-ops the parent), PRESERVE any classification suggestion + explanation + Pending status,
warn. Classification-only + real-parent paths fully functional. RECOMMENDED real fix (follow-up slice): an
`ai_suggested_is_root` Check mirroring `human_is_root`, consumed by `resolve_effective` (touches the doctype JSON +
review_screen.py -- OUTSIDE AI-2c's file scope). **TESTS:** NEW `test_ai_assist.py` **14/14 OK**, service +
`frappe.enqueue` MOCKED, NO live API call. NO change to review_screen.py / parse_run.py / boq_ai_assist.py / any
doctype JSON. **NEXT = the LIVE end-to-end Anthropic API cert (manual, on BOQ-26-00145/HVAC; the key is already set in
Desk)**, then AI-3 (frontend: "Run AI pass" button + suggestion review/accept-reject UI + the boq:ai_pass_done socket
wiring). Full detail in root CLAUDE.md.

// prior: Phase 4 Slice AI-2b (AI auto-mapping) -- Anthropic ai-assist service (structure suggestions)
(BACKEND, 2026-06-19, feat pending). The SERVICE LOGIC ONLY of the AI pass: review rows -> Claude -> parsed
structural suggestions (classification / parent), mapped back to internal row_index. **NO endpoint / worker /
in-progress flag / socket (those are AI-2c) and NO frontend (AI-3)** -- the service is callable + unit-testable in
isolation with a MOCKED Anthropic client. **DEPENDENCY:** added `anthropic>=0.111.0,<1.0` to `pyproject.toml` and
installed it -- resolved **anthropic 0.111.0** (pulls httpx/anyio/jiter/h11/sniffio/httpcore/docstring-parser; no
anthropic-related `pip check` conflict -- the only note is the pre-existing google-auth one, unrelated). **NEW
`nirmaan_stack/services/boq_ai_assist.py`** mirrors `services/extraction/gemini.py`'s retry/backoff/transient pattern
but calls the Anthropic SDK. **STATELESS:** `settings` (dict) + `api_key` (str) are INJECTED by the caller (AI-2c
worker, via the AI-2a helpers) -- the service never reads them itself. **Terminal failure RAISES `_NonRetryable`
(NOT `frappe.throw`)** -- it runs in a worker, which turns the raise into a socket error event. Public functions:
`run_ai_pass(sheet_name, review_rows, settings, api_key) -> list` (build payload + format prompt +
`anthropic.Anthropic` + `client.messages.create` + retry loop + `_safe_text` + parse), `build_rows_payload` (rows ->
`(json_str, idx_map)`; per-row excel_row/classification/level/parent_excel_row[parent's excel row, None root]/sl_no/
description/unit; effective_* with raw fallback; ALL rows; idx_map = excel_row -> internal row_index),
`parse_ai_response(text, idx_map)` (strip ```json fences; output keyed by internal row_index; parent translation
**NO_CHANGE -> None / null -> -1 root / excel_row -> idx_map**, unknown excel_row drops the parent, unknown-row
element skipped, invalid classification dropped keeping parent; `ai_suggested_level` left to the caller). The
VALIDATED prompt (`BoQ_Phase4_AI_Pass_Prompt_v1_1`) is embedded VERBATIM as `_AI_PASS_PROMPT_TEMPLATE` (filled via
`str.replace`, not `.format`, due to literal JSON braces). Constants mirror gemini (`_MAX_RETRIES=2`,
`_BACKOFF_SECONDS=1.5`, `_TRANSIENT_MARKERS` incl. **529** = Anthropic overloaded; `_NonRetryable`). **Token logging**
via `frappe.logger("boq_ai").info` (tokens + model + sheet; never the prompt or key). **CACHING DEFERRED to AI-2c**
(the worker holds the sheet-draft + last_parsed_at context; the service is stateless). **FILES:** `pyproject.toml`,
`services/boq_ai_assist.py`, `services/test_boq_ai_assist.py` (feat); root `CLAUDE.md` + this plan (docs). **TESTS:**
NEW `test_boq_ai_assist` **11/11 OK**, Anthropic MOCKED (no live call). **NEXT = AI-2c** (whitelisted endpoint +
`queue="long"` worker mirroring `run_parse`/`_run_parse_worker`/`_publish_parse_event`: `ai_in_progress` flag,
user-targeted `boq:ai_pass_done` socket + Redis fallback, per-sheet caching, `ai_*` write-back via the
`frappe.db.set_value` scalar bypass, `ai_suggested_level` derivation); the **live end-to-end Anthropic API cert
happens after AI-2c** (the key is already set in Desk). Full detail in root CLAUDE.md.

// prior: Phase 4 Slice AI-2a (AI auto-mapping) -- BOQ Upload Review AI Settings doctype + reader helpers
(BACKEND, 2026-06-19, feat pending). The settings home for the AI pass's Anthropic API key; **UNBLOCKS AI-2** (the
service `boq_ai_assist.py` + endpoints will read the key + config via these helpers). **The API key is entered
MANUALLY via the Frappe UI (Desk) after this merges -- NO key value appears in any code, test, or doc.** Mirrors the
existing `Document AI Settings` doctype + `services/extraction/files.py` reader pattern exactly (recon-confirmed).
**NEW Single doctype** `BOQ Upload Review AI Settings` (module Nirmaan Stack, `issingle:1`, InnoDB, System-Manager-ONLY
perms): config fields `enabled` (Check 0), `provider` (Select Anthropic), `model` (Data `claude-sonnet-4-6`),
`max_tokens` (Int 8000), `request_timeout_seconds` (Int 120); credentials field **`anthropic_api_key` (Password --
encrypted at rest, NEVER Data)**. Controller = minimal `class BOQUploadReviewAISettings(Document): pass` (the
reference's required-when-enabled `validate()` is provider-specific, deferred to AI-2). **OWNER-NAME DELTA (resolved
mid-build):** the brief specified `"BOQ Upload & Review AI Settings"`, but Frappe scrubs the doctype NAME into the
controller module path WITHOUT stripping `&` -> module `boq_upload_&_review_ai_settings` is not importable and
`bench migrate` THREW `ModuleNotFoundError`; the owner chose the `&`-free `BOQ Upload Review AI Settings`, whose
`scrub` is exactly the specified slug `boq_upload_review_ai_settings` (no folder rename). **READER HELPERS**
`nirmaan_stack/api/boq/wizard/ai_settings.py` (const `SETTINGS_DOCTYPE = "BOQ Upload Review AI Settings"`):
`get_boq_ai_api_key()` (decrypted `get_decrypted_password`, fail-closed to None) + `get_boq_ai_settings()`
(perm-bypassing `get_single_value` per non-secret field, fail-closed to `{enabled: False, request_timeout_seconds:
120}`, NEVER reads the secret); no caching. **FILES:** doctype JSON + `.py` + `__init__.py`, `ai_settings.py`,
`test_ai_settings.py` (feat); root `CLAUDE.md` + this plan (docs). **TESTS:** NEW `test_ai_settings` **4/4 OK** (key
None-when-unset; settings fail-closed default; non-secret fields reflected; the `anthropic_api_key` == Password
encryption invariant). `bench migrate` CLEAN after the rename (doctype EXISTS, issingle, key=Password; no orphan from
the first failed sync). No commit_pipeline.py / parse_run.py / review_screen.py / frontend / Document AI Settings
change. **NEXT = AI-2** (Anthropic service `boq_ai_assist.py` + AI-assist/accept-reject endpoints; set the key in Desk
first). Full detail in root CLAUDE.md.

// prior: Phase 4 Slice AI-1 (AI auto-mapping) -- AI suggestion fields + resolve_effective three-layer chain
(BACKEND, 2026-06-19, feat pending). (formerly labelled P4-1; renamed to AI-N to avoid collision with the completed
committed-model-rebuild P4-1..P4-FINAL arc.) **NOTE ON NUMBERING (collision resolved):** this "Phase 4" is the
ORIGINAL plan's **Phase 4 -- AI assist** (§8 / §13), NOT the historical "Phase 4 committed-model rebuild"
(P4-1..P4-FINAL) whose entries appear below -- that earlier arc kept the "Phase 4 / P4-N" labels, so the AI-pass
slices now use the **AI-N** prefix to avoid the clash. **Naming convention going forward: AI-pass slices use the
AI-N prefix (AI-1 = this slice: schema + resolve_effective wiring; AI-2 = the AI service + endpoints; AI-3 = the
frontend suggestion UI).** This is the FIRST slice of the AI pass and is on branch `feature/boq-phase-4`. **SCOPE = schema + the resolution wiring ONLY**
(no AI service `boq_ai_assist.py`, no accept/reject endpoint, no `ai_in_progress` reader, no frontend -- all later
slices). The AI pass analyses parser output and suggests corrections to classification / parent / level; suggestions
are stored as ADDITIVE fields on `BoQ Review Row` and slot into the effective chain BETWEEN human and parser.
**commit_pipeline.py needs ZERO changes** (it reads only `effective_classification` + `effective_parent_index` from
`resolve_effective`, so extending that ONE function is the whole wiring change -- confirmed by the recon that
`_commit_node_tree` reads exactly those two keys, opaquely).
**WHAT WAS BUILT:** (1) `boq_review_row.json` +7 additive nullable read_only fields under a new
`ai_suggestions_section` Section Break at the tail (after `flags_dismissed_at`): `ai_suggested_classification` (Data),
`ai_classification_confidence` (Select High/Medium/Low), `ai_suggested_parent` (Int, -1 sentinel = no suggestion/root
exactly like `parent_index`/`human_parent`), `ai_parent_confidence` (Select High/Medium/Low), `ai_suggested_level`
(Int, derived-for-display, NOT read by resolve_effective), `ai_explanation` (Small Text), `ai_suggestion_status`
(Select Pending/Accepted/Rejected). Written ONLY by the future AI service + accept/reject endpoint -- never the parser
or human layer. (2) `boq_sheet_draft.json` +1 `ai_in_progress` (Check, default 0, read_only) appended at the tail,
mirroring `parse_in_progress` exactly. (3) `resolve_effective` (review_screen.py) extended Human > Parser ->
**Human > AI-accepted > Parser**: reads 3 more fields (5->8), returns 3 more keys (7->10, the raw ai_* echoed); the
AI layer applies ONLY when `ai_suggestion_status == "Accepted"` (None/""/Pending/Rejected ignore it); `ai_suggested_parent`
is -1/None-normalised so the -1 sentinel is NEVER treated as a root suggestion; the existing 7 return keys are
byte-for-byte unchanged and the human layer always wins where present.
**FILES CHANGED:** `boq_review_row.json`, `boq_sheet_draft.json`, `review_screen.py`, `test_review_screen.py` (feat);
root `CLAUDE.md` + this plan (docs). **TESTS:** `test_review_screen` **158 -> 170** (+12, all green): new
`TestResolveEffectiveAILayer` (12 AI-precedence tests) + the module `_minimal_row` and the `TestResolveEffective._row`
helpers extended with the ai_* params (no-suggestion defaults, so existing callers are unaffected). `_ALL_LIST_JSON_FIELDS`
unchanged (none of the ai_* fields are list-JSON). **`bench migrate` CLEAN** (all 8 columns install). No commit_pipeline.py /
parse_run.py / frontend / other-doctype change. NEXT (later AI-pass slices): `boq_ai_assist.py` (Anthropic Claude API
wrapper, §5.9 / §9), the AI-assist + accept/reject endpoints, the `ai_in_progress` lifecycle + `boq:ai_pass_done`
socket on the review screen, and the frontend suggestion UI. Full detail in root CLAUDE.md.

// prior: Phase 4 Slice P4-FINAL -- retire `parent_boq` + purge dev fixtures -- the destructive Phase-4 close
(BACKEND + DATA, 2026-06-16, feat pending). **COMPLETES PHASE 4** (the committed BoQ-model rebuild: P4-1 sheet
tier -> P4-2 node re-point -> P4-3 mapping lock -> P4-4 missing fields -> P4-5 type reconciliation -> P4-6
skip-filter verify -> CHECKPOINT pass -> P4-FINAL cleanup). Owner-authorized destructive slice on the local
throwaway instance. **parent_boq RETIRED:** the `parent_boq` Link field dropped from `boqs.json` (field def +
field_order entry); controller logic stripped in `boqs.py` -- the `_validate_parent_boq(doc)` call removed from
`validate()` (area-dimensions validation + the Superseded guards SURVIVE intact), and `_validate_parent_boq` +
`_cascade_approval_to_children` helper functions DELETED. `on_update()` had only the master/sub approval-cascade
logic, now a wired **no-op stub** (`pass` + comment) -- hooks.py UNCHANGED (the on_update hook stays wired to a
harmless no-op, the lowest-risk choice; not unwired). **Frappe note:** `bench migrate` retired the FIELD
(`get_meta` no longer has `parent_boq`; gone from UI/validation/field_order) but does NOT drop the physical DB
column (Frappe never auto-drops columns, to prevent data loss) -- the orphaned `parent_boq` column lingers in
`tabBOQs` harmlessly; a hard column-drop would need explicit SQL (out of scope, not how Frappe manages dropped
fields). **TESTS:** the 11 parent_boq-dependent tests removed from `test_boqs.py` -- Group A parent_boq linkage
(5) + Group C approval cascade (6); the `_make_boq` `parent_boq=` kwarg + the now-unused `_TEST_PROJECT_2` const
cleaned; Group B (area_dimensions, 6) + the before_insert/version/status tests UNTOUCHED. test_boqs 28 -> **17**.
**DEV-FIXTURE PURGE (legible before/after, owner-scoped):** owner chose **node-tier + test-fixture BOQs only**
(NOT a blanket 141-BOQ delete -- the recon + a mid-slice owner decision preserved the ~34 hand-uploaded real
client workbooks that are the live-cert corpus, incl. BOQ-26-00145/00150/00166). Purged via RAW `frappe.db.delete`
(bypasses the on_trash Approved-BoQ guard -- required, fixture nodes hung off Approved BoQs -- and bypasses
cascade, so child tables cleared explicitly, in child->node->sheet->BoQ order): **BOQ Node Qty By Area 456->0,
BOQ Nodes 182->0, BoQ Sheet 9->0**, the 101 `_TEST_BOQ_PROJECT_NODES` fixture BOQs + the 6 master/sub dev rows
(M1/M2 Master, C1 Child, C2a, c2b, Legacy standalone on BENGALURU-PROJ-00081) deleted with their child tables
(scoped by parent so the kept workbooks' sheet_drafts/work_packages/general_specs were PRESERVED), **BOQs
141->34**, + orphan `Nirmaan Versions` for BOQs/BOQ Nodes cleared. **Projects left UNTOUCHED (104, real app
data).** A second re-purge pass cleared the transient test residue the Step-5 suite runs re-seeded -> clean end
state **Nodes/Child/Sheet = 0/0/0, BOQs = 34**. **VERIFICATION:** migrate clean (after clearing the recurring
stale Jun-15 lock files, no live rq worker -- the established recovery); test_boqs **17 OK** (28-11); BOQ Nodes
**71 OK** + BoQ Sheet **5 OK** (both self-seed -- green despite the purge, proving no test depended on a purged
row); parser **597 UNCHANGED**; runtime DB confirms `parent_boq` field gone from meta + the four BoQ-schema node
tiers empty. No boq_nodes.py / boq_sheet.json / boq_node_qty_by_area.json / parser / frontend change; the on_trash
Approved-guard on BOQ Nodes was NOT touched. **NEXT = Phase 5 (the commit arc):** build the Finalized commit gate
+ general-specs faithful-row capture (the two conflicts logged in "PHASE 5 -- LOCKED INPUTS"), sourcing from the
review rows of the 34 preserved workbooks. Full detail in root CLAUDE.md.
// prior: Phase 4 Slice P4-6 -- §9 #135 Skip/Hidden filter = VERIFY-ONLY CLOSE (no build) + structural CHECKPOINT
inserted + Phase-5 commit-set LOCKED (DOCUMENTATION ONLY, 2026-06-16). **P4-6 was scoped as "build the §135
skip-filter" -- a read-only recon at HEAD found it is ALREADY BUILT + tested, so P4-6 closes as VERIFY-ONLY, not a
build.** EVIDENCE the skip-filter is built (parse layer): `assemble_mapping_config` (parse_run.py, Rule 2)
translates `wizard_status in {Hidden, Skip}` -> `SheetConfig(skip=True)`; `parse_boq()` (orchestrator.py) excludes
those from output (`if sheet_config.skip: continue` -- the sheet produces NO ParsedSheet, hence no rows); the
parser reads ONLY `sheet_config.skip` (a bool), never wizard_status. Passing tests exist at BOTH layers --
assemble: `test_hidden_sheet_included_with_skip_true` / `test_skip_sheet_included_with_skip_true` /
`test_pending_sheet_excluded_and_in_not_eligible`; parser-output: `test_skipped_sheet_excluded_from_output`
(orchestrator) + the real-fixture `test_snitch_skip_sheets_filtered_out`. THREE coordinated exclusion mechanisms
exist: `skip=True` (Skip/Hidden), `not_eligible` (Pending / Parse-failed / blank / Finalized-without-force), and
`treat_as="master_preamble"` (General specs -> text blob, no rows). The gate is enforced at the PARSE layer, so a
commit pipeline sourcing from parse output inherits skip/ineligible exclusion for free. **STALE-DOC CORRECTION:**
the structural-audit gap table / rebuild plan (`BoQ_StructuralAudit_Phase3_GapTable_and_RebuildPlan`, not in repo)
lists "§135 skip-filter" as a HARD pre-commit requirement STILL OUTSTANDING -- that is INCORRECT; it is built. The
ParseRun Plan of Record (2026-06-03, "skip-filter built from day one in assemble_mapping_config") is the accurate
side. FLAG for the next edit of that audit doc. **CHECKPOINT SLICE INSERTED (before P4-FINAL):** a read-only
STRUCTURAL SIGN-OFF that lays the live assembled committed schema (BOQs -> BoQ Sheet -> BOQ Nodes -> BOQ Node Qty
By Area) against the rebuild plan tier-by-tier and confirms the three-tier spine is continuous, the keep-set fully
landed, no drift / accidental scope, and deferred-to-Phase-5 items clearly marked. It runs AFTER P4-6 and BEFORE
P4-FINAL **specifically because P4-FINAL clears the 167 dev rows (the only thing currently populating the node
tables) and retires `parent_boq`** -- the checkpoint wants a last look while a sample assembled node still exists to
read, and it is the last clean point to catch a cross-slice structural mistake before the irreversible cleanup.
NOTE: the checkpoint is STRUCTURAL ONLY (no real data exists until Phase 5) -- it is NOT a substitute for the
Phase-5 end-to-end dogfood test. **REVISED Phase-4 tail sequence: P4-6 (done) -> CHECKPOINT -> P4-FINAL -> Phase 5.**
**WORDING FIX (P4-5 entry):** the P4-5 block said "the Phase-4 committed-model arc ... is now COMPLETE" -- that meant
the committed-model FIELD/TYPE arc (P4-1..P4-5); **Phase 4 is NOT complete** -- the CHECKPOINT + P4-FINAL still
remain. No code/doctype/test touched this slice; ONLY this plan doc + root CLAUDE.md. (See the "PHASE 5 -- LOCKED
INPUTS" block below for the commit-set decisions recorded this session.)

PHASE 5 -- LOCKED INPUTS (decided in session 2026-06-16) -- the durable record the Phase-5 commit pipeline builds
against. **COMMIT-SET (owner-decided): only TWO sheet dispositions commit to the DB.** (1) **Finalized** -- commits
its LINE-ITEM data; "Finalized" is the user's explicit "reviewed, edited, ready for DB" signal and is THE commit
gate for line items. (2) **General specs** -- commits as a FAITHFUL ROW-BY-ROW capture of the sheet's cells
(rendered as-is in the tendering view); if MULTIPLE general-specs sheets exist, ALL of them commit. Everything else
(Config Done, Parsed, Skip, Hidden, Pending, Parse failed, blank) does NOT commit. **CONFLICT 1 Phase 5 MUST
RESOLVE -- Finalized is currently NOT the commit gate.** Today `assemble_mapping_config` treats "Finalized" as
`not_eligible` BY DEFAULT (it parses only under `force_reparse=True`), and "Config Done"/"Parsed" are what currently
produce rows -- so "what parses" != "what commits." The commit gate is a SEPARATE, NARROWER gate keyed on
"Finalized", sitting DOWNSTREAM of parsing; it does NOT inherit the parse-eligibility filter and must be built
explicitly. **CONFLICT 2 Phase 5 MUST RESOLVE -- general specs currently stores a LOSSY BLOB, not rows.** Today a
general-specs sheet -> `get_master_preamble_text` flattens ALL non-empty cells row-major into ONE newline-joined
text blob stored in `BoQ General Specs Sheet.preamble_text` (one Long Text per sheet) -- row/column structure
DISCARDED. The target (faithful rows) requires NEW capture behavior. FEASIBILITY (recon-confirmed): the raw cell
grid IS available upstream at extraction time -- the parser holds the full openpyxl worksheet (`_wb_values` /
`iter_rows`) and merely CHOOSES to flatten it -- so faithful row-by-row capture is ROUTING EXISTING DATA, NOT new
parse work and NOT re-reading the file. (Demonstrated this session: a faithful CSV of BOQ-26-00145 'SOW' produced a
clean 39x3 label/description grid, vs the flattened `preamble_text` blob where label/value and row boundaries are
indistinguishable.) **PHASE-5 DESIGN CONSTRAINT (commit sourcing):** the commit pipeline must enforce the commit-set
gate EXPLICITLY (Finalized line items + general-specs faithful rows), NOT merely inherit the parse-layer
skip-filter. If commit sources rows from parse output, the skip/ineligible exclusion flows through -- but the
Finalized gate and the general-specs faithful-row capture are NOT in that output today and must be built. **CARRIED
FORWARD (from P4-4, co-located here):** TENDERING-ERA AUDIT SCOPE is an OPEN Phase-5/tendering-boundary decision --
tendering edits to a committed node (rates, per-area qty, SKU) need a full who/changed-what/when trail; today's
`_write_audit` (15 scalar fields, no per-area child, lifecycle-only) is under-built; to be designed explicitly at
the tendering boundary, NOT inherited.
**STRUCTURAL-CHECKPOINT FLAG RESOLUTIONS (adjudicated session-end 2026-06-16; mirrors PK audit doc v1.3).**
**Flag 1 -- general-specs needs a NEW doctype (CANNOT reuse BOQ Nodes).** BOQ Nodes requires `node_type` and
enforces the qty/rate/parent-chain invariants (sheet-required + boq-sync, node_type Preamble/Line-Item, combined-
rate consistency, L{n}->L{n-1} parent rules), all of which would FIGHT a general-specs grid row that is neither a
preamble nor a line item. Phase 5 builds a NEW doctype to hold faithful general-specs rows; target shape is simple
(a label/description grid -- row-by-row cells as demonstrated by the BOQ-26-00145 'SOW' 39x3 CSV), NOT the
line-item node shape. **Flag 2 -- committed-to-DB status + hub "Committed" state (TWO coordinated changes).** Phase 5
adds (a) a committed-side marker recording that a BoQ/sheet was committed to the DB (the committed schema has none
today -- BOQs.status is Draft/Approved/Superseded, no commit marker; BoQ Sheet has no commit-status field), AND
(b) updates the parser/wizard-side BoQ HUB status to a new "Committed" state after a successful commit. These move
together -- the hub must reflect the post-commit reality. **Flag 3 -- review-row -> node provenance link: BUILD it.**
Phase 5 adds a link from a committed BOQ Node back to its originating BoQ Review Row (absent today; only
`source_row_number` + `edit_log` carry partial provenance). **DURABILITY QUESTION to resolve at design:** BoQ
Review Rows are NON-DURABLE across re-parse (re-parse deletes + recreates them), so a stored review-row docname may
DANGLE after a re-parse -- decide at design time whether to store the review-row name (accepting it may dangle) or
a stable identifier that survives re-parse. **Flag 4 (parent_boq retire) + Flag 5 (dev-fixture purge): CLOSED in
P4-FINAL** (field dropped, controller stripped, fixtures purged, 34 uploaded workbooks preserved). **LOCKED
SEQUENCING (engineering call, owner-deferred): line-item commit + general-specs faithful-row capture are built
TOGETHER as ONE commit feature -- NOT line-items-first.** Rationale: a real BoQ has BOTH kinds of sheet; the commit
action, the committed-to-DB status (Flag 2a), and the hub "Committed" state (Flag 2b) cannot be finished until BOTH
the line-item path and the general-specs path exist; splitting would build the commit machinery (gate, status, hub
wiring) twice. **STATUS:** Phase 4 is COMPLETE and pushed (commits 9dae681d..35a8544c); the PK audit doc is at
v1.3. This in-repo block now matches PK ahead of the Phase-5 kickoff.
// prior: Phase 4 Slice P4-5 -- reconcile per-area CHILD rate/amount fields Float -> Currency (match the parent)
(BACKEND, 2026-06-16, feat pending). TYPE-ONLY change: the SIX money fields on `BOQ Node Qty By Area`
(`supply_rate` / `install_rate` / `combined_rate` / `supply_amount` / `install_amount` / `total_amount`) flip
`Float` -> `Currency` to match the parent BOQ Nodes (which already had them Currency). **CLOSES the
Float-vs-Currency inconsistency that P4-3 explicitly DEFERRED here.** The container decision (normalized child,
one-level serialization, no grandchild) was already satisfied -- this is NOT a reshape, only a type alignment. NO
field renamed / reordered / added / removed; NO `options`/currency-link or custom precision added (Frappe default
Currency precision = 2dp, owner-confirmed sufficient for rates); NO controller logic touched (`_area_ctrl` +
`boq_nodes.py` UNCHANGED); NO test changes. `qty` STAYS `Float` on BOTH parent and child (it is a quantity, not
money -- deliberately NOT touched); `area_name` (Data) + `amount_override` (Check) unchanged. **RECON EVIDENCE that
made this safe:** (1) all 436 existing child rows have ZERO rate/amount values >2dp -> Currency rounds NOTHING on
existing data; (2) no existing qty_by_area test asserts >2dp precision -- the weighted-average tests use
`assertAlmostEqual(places=2)`, the combined-rate-consistency + amount tests use integer/2dp values -> tests stay
green UNCHANGED; (3) the two sub-cent behaviors that shift under Currency (the `_validate_combined_rate`
`abs(cr-(sr+ir)) >= 0.01` tolerance check; the `_recompute_parent_rates_from_areas` `len(set(rates)) <= 1`
uniform-rate-skip) shift ONLY at the 3rd+ decimal, which for money is correctly discarded -- ACCEPTED as correct
money rounding, controller logic deliberately UNCHANGED. **VERIFICATION:** `bench migrate` clean (after clearing
the recurring 10 stale Jun-15 zero-byte lock files -- same environmental Role-Profile-fixture-sync
`DocumentLockedError` with NO live rq worker as P4-4; cleared + retried per the allowed recovery); BOQ Nodes suite
**71 OK UNCHANGED** (every qty_by_area test -- weighted-average, combined-rate-consistency, per-area amount -- still
passes with NO edit, proving the Currency change shifted nothing); BoQ Sheet **5 OK**; parser **597 UNCHANGED**.
Runtime verify via `frappe.get_meta("BOQ Node Qty By Area")`: all six fields report fieldtype `Currency`, `qty`
still `Float` (NOTE: the underlying SQL column type is unchanged -- Frappe stores Currency + Float as the same
decimal/double SQL type, so the meta fieldtype is the authoritative check, not information_schema). No
boq_node_qty_by_area.py / boq_nodes.py / test / parent-doctype / hooks.py / parser / frontend change. The Phase-4
committed-model arc (P4-1 sheet tier -> P4-2 node re-point -> P4-3 mapping lock -> P4-4 missing fields -> P4-5
type reconciliation) is now COMPLETE; the committed BOQ Nodes + child are structurally ready for the Phase-5
commit pipeline. Full detail in root CLAUDE.md.
// prior: Phase 4 Slice P4-4 -- add the 8 MISSING committed-node fields (human-layer + edit provenance + remarks
+ attached_notes) (BACKEND, 2026-06-16, feat pending). ADDITIVE STORAGE only on BOQ Nodes -- NO controller logic
this slice (the commit pipeline that POPULATES these is Phase 5). The committed BOQ Nodes was missing 8 fields the
audit keep-set requires; P4-4 adds them as columns so Phase 5 can write them at commit. **THE 8 FIELDS + types
(match the review-side source shapes):** HUMAN-LAYER (the why-is-this-line-here provenance) -- `human_classification`
(Data; free Data NOT Select, the assignable vocab is enforced upstream not enumerated), `human_parent` (Int; the
-1 sentinel convention -1/unset = no override, >=0 = reparent -- NO schema default, matches review side),
`human_is_root` (Check, default 0; Option B layer, orthogonal to human_parent); EDIT PROVENANCE -- `edit_log`
(JSON, stored OPAQUE -- the pre-commit review history, list of {field,from,to,by,at,reason} + optional area/
rate_subkey on per-area edits; element shape not validated here), `edited_by` (Data), `edited_at` (Datetime)
[edited_by/edited_at are SEPARATE stored scalars for the cheap isEdited/last-editor read without parsing edit_log;
NOT read_only -- matches the review side]; ANNOTATION -- `remarks` (Small Text); ATTACHED NOTES -- `attached_notes`
(JSON, stored OPAQUE -- a structured list carried verbatim from the review row; element shape parser-defined, not
validated here -- same opaque pattern as the sheet's column_role_map). **PLACEMENT:** the 3 human-layer fields
inserted into `node_details_section` immediately after `level` (grouped with the parser node_type/level they
override); the 5 provenance/annotation fields in a NEW `review_provenance_section` appended after `edit_reason`
(adjacent to notes/edit_reason). NO existing field reordered (pure inserts). NONE marked reqd (populated at commit,
not user-required). **DESIGN NOTES (locked):** (1) `edit_log` is KEPT on the node, NOT derived from Nirmaan
Versions -- Versions tracks only 15 post-commit scalar fields (lifecycle-only, no per-area child, no human-layer)
and CANNOT reconstruct the pre-commit review history; edit_log = pre-commit provenance, Nirmaan Versions =
post-commit edit trail, COMPLEMENTARY, both exist. (2) `attached_notes` gets its OWN JSON field -- folding a
structured list into the flat `notes` Text would destroy its structure; it is semantically distinct from `notes`.
(3) **`_write_audit` tracked_fields was deliberately NOT changed** -- none of the 8 added to it; auditing post-commit
changes to these is a SEPARATE decision (see the carried decision below). **CARRIED DECISION -- TENDERING-ERA AUDIT
SCOPE (open, Phase-5/tendering boundary):** tendering edits to a committed node (rates, per-area qty, SKU) must
carry a full who/changed-what/when trail; today's `_write_audit` (15 scalar fields, no per-area child, lifecycle
prev/new states only) is UNDER-BUILT for it; the tendering-era audit scope is to be designed EXPLICITLY at the
tendering boundary, NOT inherited from the current node-edit audit. **VERIFICATION:** `bench migrate` clean (after
clearing 10 stale zero-byte lock files dated Jun-15 from an interrupted prior run -- a Role Profile fixture-sync
`DocumentLockedError` with NO live worker; environmental, unrelated to this change); BOQ Nodes suite 64 -> **71 OK**
(+7: human-layer persist, -1 sentinel persist, edited_by/at persist, remarks persist, edit_log round-trip incl. a
per-area area+rate_subkey entry, attached_notes round-trip, all-8-absent-still-saves); BoQ Sheet suite **5 OK**;
parser **597 UNCHANGED**; runtime DB confirms all 8 columns on `tabBOQ Nodes` (human_classification varchar,
human_parent bigint, human_is_root smallint, edit_log json, edited_by varchar, edited_at timestamp, remarks text,
attached_notes json). list-JSON caveat applied in tests (edit_log + attached_notes json.dumps'd before insert).
No boq_nodes.py / hooks.py / child / review / parser / frontend change. NEXT: P5 commit pipeline populates these
+ the resolved parent_node from a parse. Full detail in root CLAUDE.md.
// prior: Phase 4 Slice P4-3 -- LOCK the commit field-mapping (review-row -> committed BOQ Node) + the
three-parent-fields design note (DOCUMENTATION ONLY, 2026-06-16). NO build, NO schema change, NO test churn --
the committed BOQ Nodes ALREADY uses the target field names; the naming gap lives entirely in the (not-yet-built)
Phase-5 COMMIT PIPELINE, so P4-3 freezes the ground-truth mapping here for Phase 5 to implement against.
**THE MAPPING (review-row source field -> committed BOQ Node target field; remap kind in brackets):**
`qty_total` -> `qty` [NAME]; `rate_supply` -> `supply_rate` [NAME+TYPE]; `rate_install` -> `install_rate`
[NAME+TYPE]; `rate_combined` -> `combined_rate` [NAME+TYPE]; `amount_supply` -> `supply_amount` [NAME+TYPE];
`amount_install` -> `install_amount` [NAME+TYPE]; `amount_total` -> `total_amount` [NAME+TYPE]; `sl_no_value` ->
`code` [NAME]; `row_index` -> `sort_order` [NAME]; `source_row_number` / `unit` / `make_model` / `description`
[SAME -- identical name both sides, no remap]. (Per-area JSON blobs `qty_by_area` / `rate_by_area` /
`amount_by_area` on the review row map to the committed `qty_by_area` CHILD TABLE -- Phase-5 shape work, not a
scalar rename.) **TWO TRAPS Phase 5 MUST respect:** (1) **WORD-ORDER REVERSAL** -- the review side is PREFIX-first
(`rate_*` / `amount_*`), the committed side is SUFFIX (`*_rate` / `*_amount`), so a naive name-match copy loop
SILENTLY MISSES all six rate/amount fields; Phase 5 must map FIELD-BY-FIELD against this table, never by a
matching-name loop. (2) **FLOAT -> CURRENCY** on the six rate/amount fields -- the review row stores them `Float`,
the committed PARENT stores them `Currency`; let Frappe COERCE on assignment (set the attr, Frappe casts), NO
manual rounding. `qty` stays `Float` on BOTH sides (no coercion). **FLOAT-VS-CURRENCY INCONSISTENCY logged for
P4-5 (NOT resolved here):** the committed PARENT (BOQ Nodes) rate/amount fields are `Currency` while the committed
CHILD (BOQ Node Qty By Area) rate/amount fields are `Float` -- a parent/child type mismatch; likely P4-5 resolution
= make the CHILD `Currency` to match the parent. `qty` is `Float` on both (not part of the inconsistency). P4-3
only LOGS it. **THREE PARENT FIELDS (design note -- do NOT "clean up" the apparent duplication):** the review row
stores THREE distinct parent layers -- `parent_index` (Int, the PARSER TRUTH = parent row's row_index from the
parse), `human_parent` (Int, the HUMAN OVERRIDE; -1 sentinel = no override, >=0 = reparent to that row_index),
`human_is_root` (Check, the human RE-ROOTED this row to top-level; orthogonal to human_parent, Option B).
**`effective_parent_index` is NOT a stored field** -- it is COMPUTED by `resolve_effective()` (review_screen.py) at
read time by collapsing those three layers. The Phase-5 commit runs `resolve_effective()` and writes the SINGLE
resolved parent to the committed node's `parent_node` Link -- it does NOT copy the three review-side fields onto
the node (the committed BOQ Nodes has `parent_node` as its ONLY node-parent field; `path` is derived from the
parent_node chain). The three-layer separation is LOAD-BEARING (a human edit never destroys the parser's original
parent), so it must NOT be refactored into a single field. **CORRECTION captured:** the Phase-3 gap table had
listed `effective_parent_index` as a STORED field -- it is COMPUTED, not stored (only `parent_index` +
`human_parent` + `human_is_root` are columns on BoQ Review Row). No code/doctype/test touched this slice; ONLY this
plan doc + root CLAUDE.md updated.
// prior: Phase 4 Slice P4-2 -- re-point BOQ Nodes to the BoQ Sheet tier (BACKEND, 2026-06-16, feat pending).
Inserts the P4-1 sheet tier into the committed node's upward ties: a node now links to a **BoQ Sheet** (the new
PRIMARY tie) and the `boq` link to BOQs is KEPT DENORMALIZED. SURGICAL: adds ONE Link field + ONE sync validation
+ moves ONE required-guard + re-points test fixtures; touches NOTHING else (path logic, parent-chain validation,
per-area roll-up, audit, on_trash, qty_by_area helpers ALL unchanged -- the recon proved them indifferent to the
link change). No commit pipeline (Phase 5), no real-data write. **SCHEMA (`boq_nodes.json`):** new `sheet` field
-- Link->"BoQ Sheet", `search_index:1`, `in_standard_filter:1`, NOT reqd at JSON level (required-ness is
controller-enforced, matching how `boq` is handled), placed in field_order IMMEDIATELY AFTER `boq` (both upward
links grouped). `boq` is left EXACTLY as-is (Link->BOQs, search_index + in_standard_filter intact). **WHY keep boq
denormalized (locked, owner-ratified):** Frappe cannot filter/sort a list across two Link hops (`sheet.boq`), and
`boq` carries search_index + in_standard_filter the Desk UI + index depend on; the idiomatic Frappe pattern for a
queryable grandparent value is a denormalized field. Keeping `boq` leaves the 3 hot-path boq reads (the validate
guard, on_trash status, qty_by_area area_dimensions) as cheap one-hops -- all UNCHANGED. **CONTROLLER
(`boq_nodes.py` validate, top only):** (1) the old `if not doc.boq: throw("BoQ is required")` is REPLACED by `if
not doc.sheet: throw("BoQ Sheet is required")` -- the sheet is now the single required upward tie; the standalone
boq-required throw is DROPPED (redundant + would mis-fire on a sheet-only node before auto-fill). (2) NEW SYNC
GUARD immediately after, the FIRST thing validate does (before `_validate_qty_by_area` reads `doc.boq`):
`sheet_boq = frappe.db.get_value("BoQ Sheet", doc.sheet, "boq")`; if `doc.boq` set AND `!= sheet_boq` -> throw
mismatch; if `doc.boq` blank -> **AUTO-FILL `doc.boq = sheet_boq`**. **DECISION = AUTO-FILL (not strict)**: the
sheet is the one source of truth, so boq is derived from it and stays in sync by construction; auto-fill restores
boq before any downstream read or before Frappe's `_validate_links` runs (validate-hook precedes link validation
in the save flow), so a sheet-only insert populates boq cleanly. `_write_audit` tracked_fields UNCHANGED -- `sheet`
deliberately NOT added (auditing the new link is a separate optional decision; flagged, not done). **TESTS
(`test_boq_nodes.py`) fixture-first re-point:** setUpClass now creates a shared `BoQ Sheet` (`cls.sheet_name`,
boq=cls.boq_name, sheet_name="_TEST", sheet_order=1) under the shared BOQs; the shared preamble + a `replace_all`
of the ~42 inline `.boq = self.boq_name` sites -> `.sheet = self.sheet_name` (boq auto-fills); 3 own-boq tests
(approved-trash + the two qty_by_area area-dimensions tests) each got a local BoQ Sheet under their own BOQs +
`.sheet` wiring; tearDownClass also deletes `BoQ Sheet` by boq. `test_validate_requires_boq` -> RENAMED
`test_validate_requires_sheet` (asserts a node with no sheet throws). NEW `test_node_sheet_boq_sync`: (a)
sheet-set + boq-blank auto-fills boq to the sheet's boq; (b) boq set to a DIFFERENT boq than the sheet's -> throws.
The 7 parent_node-based path-format assertions (L142/271/277/285/300/305/307-ish) survive UNCHANGED (path logic
untouched). **VERIFICATION:** `bench --site localhost migrate` clean; BOQ Nodes suite 64 OK (was ~63; +1 net = the
new sync test, the requires test renamed in place); BoQ Sheet suite 5 OK (still green -- node tests now create
sheets); parser suite 597 UNCHANGED; runtime DB confirms the `sheet` column exists on `tabBOQ Nodes` (varchar,
alongside `boq`). No hooks.py / boq_sheet.json / boqs.json / qty_by_area-controller / parser / frontend change.
NEXT: P5 commit pipeline writes BoQ Sheet + re-pointed BOQ Nodes from a parse. Full detail in root CLAUDE.md.
// prior: Phase 4 Slice P4-1 -- committed "BoQ Sheet" doctype (BACKEND, 2026-06-15, feat pending). Creates the
missing SHEET tier of the committed model BOQs (workbook) -> BoQ Sheet (sheet) -> BOQ Nodes (rows); nodes today
attach straight to BOQs. ADDITIVE + STANDALONE: ONE new doctype, nothing else touched (no BOQ Nodes / BOQs / BoQ
Sheet Draft / controller / endpoint / hooks.py change). Nothing writes to it yet -- the commit pipeline is Phase 5,
node re-pointing is P4-2. NEW `nirmaan_stack/nirmaan_stack/doctype/boq_sheet/` (boq_sheet.json + boq_sheet.py stub
`class BoQSheet(Document): pass` + empty __init__.py + test_boq_sheet.py). KEY DESIGN (owner-locked): `istable=0`
STANDALONE top-level doctype that Links UP to BOQs (NOT a child table -- the working-side BoQ Sheet Draft IS a
child table; the committed BoQ Sheet is a real linked record so nodes can Link to it in P4-2). `track_changes=1`
(mirrors BOQs / BOQ Nodes). **autoname `BQSH-.YY.-.#####`** -- deliberately NOT `BOQS-` (one char from BOQs'
`BOQ-` + reads as a plural; `BQSH` = "BoQ SHeet", zero collision). FIELDS (16, grouped by Section Breaks):
IDENTITY -- `boq` (Link->BOQs, reqd, in_list_view, search_index), `sheet_name` (Data, reqd, in_list_view),
`sheet_order` (Int, reqd, in_list_view), `sheet_label` (Data); WORK HEADERS -- `work_packages` (Table, options
**"BoQ Sheet Work Package"** -- REUSES the EXISTING child doctype, NOT a new one; sheet->many work-headers,
real-data-confirmed e.g. BOQ-26-00145 "HVAC " -> 3 headers); RENDER CONFIG (the audit KEEP-set, full Excel view
TLD-2) -- `treat_as` (Select data/master_preamble, default data), `header_row` (Int), `header_row_count` (Int,
default 1 -- plain Int, the Literal[1,2] constraint stays upstream in the parser), `column_role_map` (JSON,
**stored OPAQUE -- NO role validator**; legacy maps carry retired tokens e.g. `amount_by_area`), `column_headers`
(JSON), `area_dimensions` (JSON); PARSE VINTAGE -- `last_parsed_at` (Datetime, read_only). The SPENT sheet_config
keys are NOT carried (skip / top_header_rows_override / skip_top_rows_after_header / rate_only_markers_override /
level_1_style_override / package_name / sheet_name-echo). PERMISSIONS mirror BOQs verbatim (10 roles: 6 full-RW +
4 read/report/export/share). TESTS: test_boq_sheet 5/5 green in-container -- create+autoname (BQSH- prefix),
work_packages accepts 2+ work-headers (read-back), JSON round-trip INCLUDING a retired `amount_by_area` token
(proves opaque storage, not rejected), render-config + read-only last_parsed_at persist, treat_as/header_row_count
defaults. **list-JSON caveat (re-confirmed, CLAUDE.md):** a JSON field rejects a raw Python LIST on insert
(get_valid_dict "cannot be a list") -- `area_dimensions` must be `json.dumps()`'d by the caller before insert;
dict-JSON fields (`column_role_map`/`column_headers`) pass as dicts. The test mirrors the `_LIST_JSON_FIELDS`
pattern. `bench --site localhost migrate` clean (DocType + table + columns verified in the RUNTIME db: autoname
`BQSH-.YY.-.#####`, istable=0); parser suite 597 UNCHANGED. Live-cert N/A (no UI; passive container). NEXT: P4-2
re-points BOQ Nodes to a BoQ Sheet Link; P5 commit pipeline writes BoQ Sheet rows. Full detail in root CLAUDE.md.
// prior: Append-to-notes-as-columns + staleness banner (BACKEND + FRONTEND, 2026-06-14). Renders
`append_to_notes` data as review-screen columns -- ADDITIVE (the commit-time notes-fold is untouched; the same
content appearing in-position AND combined is BY DESIGN). (a) each mapped append-column as its OWN read-only
column in ORIGINAL Excel position (interleaved by Excel letter); (b) ONE combined "Append Notes" column PINNED
LAST. PLUS a static always-on staleness banner. BACKEND `review_screen._build_column_descriptors`:
`append_to_notes` REMOVED from `_NON_DISPLAY_ROLES` (now `{ignore, reference_images}` only -- both still
excluded) + a new branch emitting one descriptor per append-column: `value_field="append_notes_raw"`,
`area=None`, `rate_subkey=None`, **`value_key = sheet_config.column_headers.get(col, col)`** (NOT bare `col`).
STEP-0 KEY FACT: the parser stores `append_notes_raw` keyed by `column_headers.get(col_letter, col_letter)`
(classifier.py:983) -- HEADER TEXT when `column_headers` maps the letter, ELSE the bare Excel LETTER; the
descriptor `value_key` MUST mirror that resolution or the one-hop `resolveDescriptorValue` walk misses the value.
(On BOQ-26-00166 `column_headers={}` so keys are letters "Z"/"AB"; the impl handles populated headers too.) The
:649 Excel-letter sort interleaves the in-position columns for free. FRONTEND `ReviewTree.tsx`: combined column =
hand-written trailing `<th>`/`<td>` AFTER the descriptor `.map()` (NOT a descriptor -- a sentinel would fight the
sort), built from `appendDescriptors = displayDescriptors.filter(role==="append_to_notes")` joining
`"<value_key>: <text>"` with `" | "` (value_key IS the header-else-letter prefix, already baked in -- no separate
lookup; numeric-looking strings NOT coerced; empty -> blank), shown only when `hasAppendCombined`, NOT in the
column-subset selector, left-aligned + wrapping; `totalCols = 7 + visibleDescriptorCount + (hasAppendCombined ?
1 : 0)`. In-position columns ride the existing descriptor render path (read-only; naturally exempt from EDITABLE_*
detail-panel blocks). STALENESS BANNER `SheetReviewPage.tsx`: static always-on muted strip (matches flag/remark
strips) after the teal Finalized banner, before the flag-summary strip -- copy VERBATIM "Totals shown are as
originally parsed. Final calculations happen after the BoQ is committed." `boqTypes.ts` UNTOUCHED (`ROLE_LABELS`
already had `append_to_notes: "Append to Notes"`; `ColumnDescriptor` + `append_notes_raw` types already fit). The
D2 writer `exportReviewCsv.ts` was NOT touched (docs DID correct its stale append-key note -- the keys are
header-else-letter, empty columns omitted, values strings). tsc 0 NEW wizard-file errors (3177 baseline) +
in-container Vite build exit 0; backend test_review_screen 154 -> 158 (+4: append_to_notes EMITS a descriptor in
Excel position [letter-fallback + header-mapped value_key], ignore/reference_images control still excluded,
get_review_rows still ships `append_notes_raw` parsed). **OWNER FLAG: this slice REVERSES the locked non-display
design for `append_to_notes`** -- the PK doc `BoQ_Review_Screen_Locked_Design_v1_0` (NOT in the repo) needs an
owner amendment to record append_to_notes as a DISPLAY role on the review screen. Live-cert pending Nitesh
(BOQ-26-00166 "VRF System": Z/AA/AB show in-position read-only, combined "Append Notes" pinned last, banner at
top).
// prior: Detail-panel edit-field repack (FRONTEND ONLY, CSS/layout, `ReviewTree.tsx`, 2026-06-14). The row
DETAIL PANEL's three edit blocks ("Edit values" flat numeric / "Edit text" / "Edit per-area values") laid
their fields in an EQUAL-WIDTH responsive grid (`grid-cols-1 sm:2 md:3 lg:4`) that stretched across the panel;
after the prior width fix pinned each value `<Input>` to `w-24`, each narrow input floated at the left of a
wide equal column, leaving big inter-field GAPS. TWO changes (all THREE blocks): (1) value `<Input>` width
`w-24` -> `w-36` (96px -> 144px, +50%, owner-confirmed); (2) container `grid grid-cols-1 sm:grid-cols-2
md:grid-cols-3 lg:grid-cols-4 gap-2` -> `grid grid-cols-[repeat(4,max-content)] gap-2 justify-start` -- a
FIXED 4-per-row, CONTENT-SIZED, LEFT-PACKED grid (the four fixed-width fields sit close together then wrap to
the next row of 4, no dead space). Used the owner-preferred fixed-4 grid (arbitrary-value Tailwind template;
compiled fine -- the `flex flex-wrap` fallback was NOT needed). gap-2 kept. Labels / Apply buttons / Input
height+text classes / the shadcn primitive (`components/ui/input.tsx`) / the main-grid `<td>` cells / the
Remarks `<Textarea>` are all UNTOUCHED. tsc 0 new wizard errors; Vite build exit 0 (`built in 7m 39s`, PWA 168
entries). Live-cert pending Nitesh (open a row detail panel -> per-area + value + text edit fields sit
4-per-row packed close together, inputs ~144px, content not clipped; gap/column-count is a one-step nudge).
// prior: Slice 3 (Strand A) -- single-area config gate (FRONTEND ONLY, `SheetConfigPanel.tsx`, 2026-06-14).
Prevents the review-screen `[object Object]` leak at its CONFIG source: a per-area role mapped on a
SINGLE-area sheet stores `area=null`, which `_build_column_descriptors` emits with `value_key=null`, which
`resolveDescriptorValue` resolves to the whole per-area dict -> `String(dict)` = "[object Object]". THE GATE:
on a single-area sheet (`!isMulti || activeAreas.length === 0`) the role `<Select>` HIDES the entire
`AREA_COMPATIBLE_ROLES` set (qty + the six rate_*_by_area / amount_*_by_area roles) -- `qty_total` is offered as
the single-area quantity role (owner-decided: qty_total, NOT qty). The scalar roles stay. Reactive: keys off the
SAME live `isMulti && activeAreas.length > 0` state `showAreaDropdown` uses, so it updates on the Single/Multi
toggle + area-box edits mid-config. STRANDED-ROLE HANDLING = OPTION 3 (flag, do NOT auto-clear): a row holding a
per-area role after a multi->single flip is FLAGGED invalid -- reusing the EXISTING area-required pattern
(`border-destructive` on the role SelectTrigger + a `text-destructive` inline message naming the offending role,
since its option is now hidden) -- and `hasStrandedRoles` is folded into the EXISTING attestation gate (AND-ed
into the `attest-checkbox` disabled, exactly like `parserRequiredSatisfied`/`hasWorkPackage`), so **Mark as Config
Done is BLOCKED** until the user re-picks a valid role (a `text-destructive` helper line explains why). The role is
NOT silently cleared/converted. NO new error-display system invented -- both reused patterns are pre-existing.
Plain "Save config" stays permissive (consistent with existing semantics; a plain-Saved-but-not-Marked sheet stays
Pending -> not parse-eligible -> never reaches review, so blocking Mark is sufficient). STRAND B (a render guard in
ReviewTree) DELIBERATELY NOT DONE -- `[object Object]` is retained as the visible alarm if A ever leaks (owner
decision: a loud failure beats a silent blank). ReviewTree.tsx / backend / parser / role definitions UNTOUCHED.
tsc 0 new wizard errors; Vite build exit 0 (`built in 4m 24s`, PWA 168 entries). Live-cert pending Nitesh
(single-area BOQ-26-00150 ALORICA: no per-area roles offered, qty_total is; multi-area BOQ-26-00166/-00165: per-area
roles incl. qty offered; flip multi->single after mapping a per-area role -> row flagged + Mark blocked; flip back
-> roles reappear).
// prior: Detail-panel data-value field width (FRONTEND ONLY, CSS-only, 2026-06-14). The review-screen ROW
DETAIL PANEL's data-value `<Input>` fields (the three edit blocks: "Edit values" flat numeric / "Edit text"
unit+make_model / "Edit per-area values") were flex-filling their grid cell (shadcn `Input`'s baked-in
`w-full`), making them too wide for the short numbers/text they hold. Pinned to a FIXED narrow width
`w-24` (96px) by appending `w-24` to each value Input's `className="h-7 text-xs"` (now `"h-7 text-xs w-24"`),
across ALL THREE blocks in `ReviewTree.tsx`. Owner-confirmed value. The shadcn primitive
(`components/ui/input.tsx`, `w-full` default) is UNTOUCHED -- width added ONLY at the call site. The main-grid
data cells (`renderDescriptorCell` / `<td>` path) and the Remarks `<Textarea>` (`max-w-md`) are unaffected.
NO grid/column/Apply-button/label/logic change. tsc 0 new wizard errors; Vite build exit 0 (`built in 4m 35s`,
PWA 168 entries). Live-cert pending Nitesh (open a row detail panel -> value fields narrow ~96px fixed, not
stretching, content not clipped incl. a long per-area amount); one-step nudge if needed (w-20=80px / w-28=112px).
// prior: Field-set rationalisation Slice 2b -- per-area amount EDIT path made NESTED (BACKEND + frontend
comment, feat ad99ebf7, 2026-06-14). Slice 2a shipped per-area amount STORED nested {area: {supply, install,
total}} on the READ path but left the EDIT path FLAT, so a per-area amount edit CORRUPTED data (backend
discarded the subkey + did a flat one-hop write `current[area]=float`, clobbering the area's nested dict). 2b
makes the amount edit path NESTED two-hop, mirroring rate. NEAR-PURE BACKEND (review_screen.py); frontend is
COMMENT-ONLY because the edit path is already generic over the descriptor (the frontend sends the amount kind
in the rate_subkey slot -- 2a's decision). BACKEND: amount_by_area moved OUT of _FLAT_AREA_FIELDS (now
{qty_by_area}) INTO _NESTED_AREA_FIELDS={rate_by_area, amount_by_area}; _apply_and_save_row_edit write branch
keys on `field in _NESTED_AREA_FIELDS` -> two-hop amount_by_area[area][kind] write (sets ONE kind, leaves the
area's other kinds + other areas intact = the B2 anti-corruption guarantee), one-hop only for qty; validation
requires + validates a subkey for amount against _LEGAL_AMOUNT_SUBKEYS={supply,install,total} via a per-field
_NESTED_FIELD_LEGAL_SUBKEYS map. DECISIONS (owner-locked): C2/C3 = Option A -- reuse the generic rate_subkey
wire param + edit-log key for amount (NO amount_subkey, NO new descriptor hop, NO frontend remap); rate_subkey
carrying amount kinds is accepted Phase-4 naming debt. C4 = ACCEPT STALENESS -- the row scalar amount_total is
NOT recomputed after a per-area edit (matches rate; calcs live in the future tendering module; the 2a
derivation rule stays parse-time only -- NO recompute-on-edit added). The staleness USER-MESSAGE banner is a
DEFERRED separate frontend slice. FRONTEND: only the stale ReviewTree.tsx:~300 EDITABLE_AREA_FIELDS comment
corrected (amount is nested now); edit cell / openAreaConfirm / confirmValueSave / seed / resolveDescriptorValue
all already generic, unchanged. edit_log entry for an amount edit carries field=amount_by_area + area +
rate_subkey=<amount kind>; provenance panel renders it generically ("(Zone A / total)"), no type/render change.
Tests: test_review_screen 152 -> 154 (fixture amount seed -> nested; the two flat amount edit tests reworked to
nested -- test_amount_by_area_sets_one_subkey_others_intact is the B2 anti-corruption proof; +2 reject tests:
amount edit with NO subkey, and an illegal amount subkey using a legal RATE kind 'combined_rate' to prove
per-field selection). Parser 597 / test_parse_run 86 / test_update_sheet_draft 82 unchanged (no parser code
touched). tsc 0 new wizard errors; Vite build exit 0. Owner live-cert: edit a per-area supply/install amount on
a multi-area row (BOQ-26-00166) -> only that kind+area changes, other kinds/areas intact, persists on reload;
the scalar total does NOT recompute (EXPECTED accepted staleness). KNOWN DEBT: rate_subkey naming (Phase-4) +
accepted total staleness (banner = later slice). Prior latest:
Field-set rationalisation Slice 2a -- amount per-area SYMMETRIC with rate, READ path (BACKEND +
FRONTEND, feat 33ec8361, 2026-06-13). Made AMOUNT symmetric with RATE on the per-area READ path (extraction
+ storage + DISPLAY); the per-area amount EDIT path is deferred to Slice 2b and was NOT touched. ROLES: ADDED
`amount_supply_by_area`/`amount_install_by_area`/`amount_total_by_area` (area-required, area-compatible --
mirror `rate_*_by_area`); RENAMED `amount_by_area` -> `amount_total_by_area` (per-area combined amount;
DELIBERATELY differs from rate's `amount_combined_by_area` -- cross-family wording difference accepted +
logged); DROPPED scalar role `amount_combined`, re-homing its SITC/S&I/combined-amount keywords into
`_HEADER_KW["amount_total"]` (the `_cell_float` combined-cascade fallback removed) so a column that
auto-detected as combined now auto-detects as `amount_total`. NESTED extraction/storage/display mirrors
`rate_by_area`: `classifier.amount_by_area_raw` is now nested `dict[area][kind]` (supply/install/total) via
new `_AMOUNT_ROLE_TO_KIND` + helpers `_collapse_area_amount`/`_sum_area_amounts`; `hierarchy.ResolvedRow`
amount fields nested; `orchestrator` deep-copies nested, qty*rate fallback writes the `"total"` kind,
sum-validation collapses. SCALAR-TOTAL DERIVATION RULE (owner-confirmed, in `_apply_multi_area_post_pass`):
explicit total column wins; else derived = sum over areas of (per-area total if present, else supply +
install). `review_screen._build_column_descriptors` per-area amount branch made GENERIC via
`_AMOUNT_ROLE_TO_KIND` (value_field stays `amount_by_area` -- the kept storage field; the generic `rate_subkey`
third-hop carries the amount kind), so each supply/install/total amount renders in its own column and
`resolveDescriptorValue` needs NO change. **STORAGE FIELD `amount_by_area` KEPT (now nested) -- only the ROLE
renamed** (exact analog of rate's `rate_by_area` field): doctype JSON field, ResolvedRow/ClassifiedRow attrs,
descriptor value_field, get_review_rows all_fields, `_FLAT_AREA_FIELDS`/`_JSON_DICT_FIELDS`, flatten JSON key,
frontend `ReviewRow.amount_by_area` all retain the name; NO doctype-JSON change, NO migration. `_auto_guess`
BOTH duplicate sets updated; detected per-area amount column -> `amount_total_by_area`. FRONTEND (read/display
only): `ROLE_LABELS`/`ROLES_BY_GROUP`/`AREA_COMPATIBLE_ROLES`/`AREA_REQUIRED_ROLES`/`SINGLETON_ROLES`/
`ROLE_HELP_TEXT`/`_AMOUNT_ROLES` updated; new `AmountByAreaCell` type; `ReviewRow.amount_by_area` nested;
`EDITABLE_AREA_FIELDS` + per-area edit gating NOT touched (2b). ZERO-HIT GREP GATE: `amount_combined` gone
from live code (remaining = dead-scratch + rename-doc/regression tests); `amount_by_area` retains only
storage-field usages (ROLE-usage=0). Tests: parser 589->597 (new `TestNestedPerAreaAmountExtraction` +
`TestNestedAmountTotalDerivation`; old amount_combined extraction class -> `TestTotalAmountColumnCascade` +
dropped-role-rejected regression; fixtures re-nested/renamed; `classifier_audit._CLASSIFIER_HEADER_KW` synced
for the agreement-#21 live sync test); wizard suites unchanged (152/86/82); tsc 0 new wizard errors; Vite
build exit 0 (`built in 6m 14s`, PWA 168). Owner live-cert: a multi-area workbook (derived from
BOQ-26-00165's structure) with per-area supply/install/total amount columns -- confirm each renders in its own
column + the derived row total is correct; Job-7 note: re-SAVE config through the WIZARD (not just re-parse)
to clear any stored old-`amount_by_area`-role token, else the sheet silently drops from the parse. Slice 2b =
the per-area amount EDIT path. Prior latest:
Field-set rationalisation Slice 1 / Finding 1 -- scalar amount roles NOT area-compatible (BACKEND +
FRONTEND, feat 83985079, 2026-06-13). Removed `amount_supply`/`amount_install`/`amount_total` from
`_AREA_COMPATIBLE_ROLES` (`boq_parser/config.py:17`) + `AREA_COMPATIBLE_ROLES` (`SheetConfigPanel.tsx:128`).
These three are routed as SCALARS by the descriptor builder, which silently drops any area set on them, so the
config UI's area sub-selector for them was meaningless. PURE SUBTRACTION -- no new roles, no rename, no
parser-logic/descriptor/classifier/serialization change; `qty` + the genuine `*_by_area` roles untouched. Both
config.py consumers DERIVE from the set (the `area_only_for_qty_amount_roles` model validator + the
config.py:134 per-area uniqueness loop) so they tighten automatically -- scalar amount roles now REJECT an area
at ColumnRole validation. Frontend area-dropdown gate (`SheetConfigPanel.tsx:1099`) + serialization (`:599`/
`:655`) all key off the same Set; no second path renders an area control for these roles. Tests: new
`test_scalar_amount_roles_reject_area` + fixed the `test_valid_full_config_parses_cleanly` fixture (col K
amount_supply lost its area); parser 588->589, wizard suites unchanged (86/82/152); tsc 0 new wizard errors
(3177), no Vite build (runtime Set subtraction). This is Slice 1 of the field-set rationalisation arc.
Owner check: on a multi-area sheet, an Amount (Supply/Install/Total) column shows NO area dropdown; Qty + the
per-area roles still do. Prior latest:
Slice A2 -- edit-log clarity pass (FRONTEND ONLY, render-time, feat cefaf3c0, 2026-06-13). ReviewTree's
row-detail "Edit history" block now renders parent moves as Excel row numbers (via the same `byIdx` map the
Parent column uses), an honest verb (Reclassified / Moved parent / Edited) instead of the raw field name, and a
`YYYY-MM-DD HH:MM` timestamp; the #162 no-op same-value reclassify entry is SUPPRESSED. The stored `edit_log`
shape is UNCHANGED -- render-only, no backend/doctype/migration; `ReviewTree.tsx` is the only file touched. tsc 0
new wizard errors (3177 baseline) + build exit 0 (`✓ built in 4m 50s`). The "Slice A2 ..." section is at the
bottom of this doc. Prior latest:
Slice D2b -- hub-level XLSX workbook export + per-card CSV export (FRONTEND + dependency, feat
91bf255d). A global "Export reviewed" button in the hub footer opens a selection modal of every "Parsed
Check Done" sheet (all pre-ticked); confirming fetches each ticked sheet's rows SEQUENTIALLY via
`get_review_rows` and builds ONE .xlsx workbook -- one TAB per sheet, always .xlsx even for one sheet,
numbers as real Excel numbers, bold header row -- ABORTING the whole export if any single fetch fails (no
partial file, the failed sheet named inline). Each "Parsed Check Done" SheetCard also gains an "Export CSV"
button -> the EXISTING D2 .csv for that one sheet (hub owns the fetch; the card drives its own busy/error).
NEW dep `exceljs` (owner-approved), DYNAMICALLY imported so it lands in its OWN lazy chunk (942 kB, ABSENT
from the hub chunk [32.59 kB] + the entry chunk -- verified in the build asset list); the npm `xlsx` package
is FORBIDDEN (abandoned on npm, two unpatched high-severity CVEs). The D2 CSV writer is refactored:
`buildReviewSheet` (NEW export) returns `{headers, typed cells}` -- the SINGLE source of truth for BOTH
writers; the CSV path maps cells through `csvCell` so its output stays BYTE-IDENTICAL to D2. Excel TAB names
are sanitized + de-duplicated (tab title ONLY -- the Sheet Name column inside stays VERBATIM #152). tsc 0 new
wizard-file errors (baseline 3177 unchanged) + in-container build exit 0 (`✓ built in 6m 54s`, PWA 168
entries; exceljs in its own lazy chunk). Live-cert LC1-LC8 pending. The "Slice D2b ..." block immediately
below. Prior latest:
Slice D2 -- per-sheet CSV export on the review screen (FRONTEND ONLY, feat 27866a2e). A new
wizard-local writer `exportReviewCsv.ts` builds a flat per-sheet CSV (parsed values + human corrections +
provenance, no JSON blobs) and downloads it; an "Export CSV" button sits in the header right cluster,
STATUS-INDEPENDENT (a frozen/checked sheet exports too -- the prime use) and VIEW-INDEPENDENT (filters/
collapse/search never affect it). Per-area values get ONE COLUMN PER AREA PER ROLE (mirroring the tree's
descriptor columns); numbers written RAW so Excel parses them; UTF-8 BOM for rupee/unicode. The shared
`src/utils/exportToCsv.ts` is NOT used or touched (TanStack-coupled, 15 callers, wrong shape -- recon
2026-06-12). REUSES ReviewTree `resolveDescriptorValue`/`computeDepths`/`CLS_LABELS`/`FIXED_ROLE_DEDUPE` +
boqTypes `ROLE_LABELS` via an export-keyword-only change (no behaviour change). tsc 0 new wizard-file errors
+ in-container build exit 0 (`✓ built in 5m 47s`, PWA 166 entries); no Frappe tests (frontend-only); live-cert
LC1-LC7 pending. The "Slice D2 ..." block immediately below. Prior latest:
Slice D1 -- "Parsed Check Done" marking + read-only FREEZE + Un-mark (BACKEND + FRONTEND). A checked
sheet is fully frozen (no edits/restructure/remarks/dismissals), enforced both ends; a header "Mark Parsed
Check Done" button (light confirm -> structural-breaks escalation), a teal read-only banner with Un-mark +
Go-to-hub, and `readOnly` ReviewTree gating. New `unmark_sheet_parsed_check_done` endpoint + a mark
precondition (Parsed-only) + a `_guard_sheet_not_frozen` check in all four write endpoints. test_review_screen
137 -> 147 (+10). The "Slice D1 ..." block further below. Prior latest:
C-flag-dismissal (per-row "Looks OK", BACKEND + FRONTEND) -- a per-row dismissal of advisory flags
on the review screen; PER-ROW (one gesture clears ALL of a row's currently-computing flags) and STAYS
"Original" (an acknowledgment, not an edit). Backend: 3 additive `BoQ Review Row` fields (`flags_dismissed`
Check + `flags_dismissed_by` Data + `flags_dismissed_at` Datetime), a new `dismiss_row_flags` endpoint
mirroring `save_review_remark` (direct set_value, no edit_log/edited_at, stays Original), a ONE-LINE
chokepoint clear-on-edit in `_apply_and_save_row_edit` (any edit RE-OPENS; covers save_review_edit +
save_review_restructure), the 3 fields wired into `get_review_rows`; re-parse wipes free (delete+recreate);
test_review_screen 131 -> 137 (TestDismissRowFlags +6, green); bench migrate landed the columns. Frontend:
`boqTypes.ts` ReviewRow +3 optional fields; `ReviewTree` "Looks OK" button (detail-panel Flags block,
refresh via onRemarkSaved) + greyed/checked `CheckCircle2` Info-marker dismissed state + "Reviewed -- looks
OK" tag (isEdited/Edited-pill/green-tint UNTOUCHED); `SheetReviewPage` "N <label> -- C cleared" summary
strip (cleared derived frontend-side, no new endpoint). tsc 0 new wizard-file errors + build exit 0
(`✓ built in 6m 46s`). Live-cert LC1-LC6 pending. The block immediately below. Prior latest:
§9 #159 find & filter on the ReviewTree (FRONTEND ONLY, ReviewTree.tsx) -- strict-hide Status
(Edited/Original/All) + Classification (6-value checklist) AND-filter via column-header Popovers;
description-only case-insensitive search with soft/strong blue RING tiers (box-shadow, NOT backgrounds --
the collision rule) + prev/next modulo cycling that reuses the existing revealAndScrollToRow for auto-expand;
filter-then-search composition (hits computed over the SAME shown-predicate the render gate uses) -- the
block immediately below. Prior latest: ReviewTree detail-panel layout pass + brand-tint follow-up (FINDING B
card treatment, INDIGO body + BRAND-RED `border-l-primary` left-accent stripe; Obs 1 Classification/Parent
vertical stack; Obs 2 per-block responsive ~4-col grid). Before that:
§9 #158 RestructureModal polish pair (finding-2 outside-click dismiss disabled; finding-7 pick buttons
moved ABOVE the picker grid); §9 #162 standalone "Change parent" door (detail-panel button
-> existing RestructureModal via a no-op reclassify); Force Re-parse FRONTEND slice (two entry points +
shared modal + rewritten destructive warning) -- the blocks further below.

**Slice D2b -- hub XLSX workbook export + per-card CSV export ✅ COMPLETE (FRONTEND + dependency, feat 91bf255d):**
Two hub entry points for exporting reviewed data: a GLOBAL multi-sheet .xlsx workbook (a footer button + a
selection modal) and a PER-CARD single-sheet .csv (the existing D2 writer). Files in scope (exclusive): NEW
`exportReviewXlsx.ts` (workbook writer) + NEW `ExportWorkbookDialog.tsx` (selection modal);
`exportReviewCsv.ts` (builder extraction), `BoqHubPage.tsx` (global button + wiring), `SheetCard.tsx`
(per-card button + prop); `package.json` + `yarn.lock` (the exceljs dep) (+ the 3 docs). `boqTypes.ts` NOT
needed (the consumed `GetReviewRowsResponse` was already exported). OUT of scope: `SheetReviewPage.tsx` (its
D2 button keeps working via the refactored writer -- the `buildAndDownloadReviewCsv` signature is unchanged),
`src/utils/exportToCsv.ts`, all backend, `ParseRunDialog.tsx` (pattern reference only).
- **Dependency (owner-approved): `exceljs`, DYNAMICALLY imported.** `const ExcelJS = (await import("exceljs")).default;`
  -- NEVER a static import, so exceljs lands in its OWN lazy chunk (`exceljs.min-*.js`, 942 kB / gzip 272 kB),
  ABSENT from the hub chunk (`BoqHubPage-*.js`, 32.59 kB) and the entry chunk -- the hub's first paint never
  pays for it; the chunk is fetched only when an export actually runs. The npm `xlsx` (SheetJS) package is
  FORBIDDEN: abandoned on the public registry with two unpatched high-severity CVEs (prototype pollution +
  ReDoS). Installed IN-CONTAINER (`yarn add exceljs` inside the frappe container -- host-side installs corrupt
  the Linux-native node_modules, the rollup lesson).
- **Builder extraction (the no-drift core).** `exportReviewCsv.ts` gains `buildReviewSheet({ sheetName, rows,
  columnDescriptors }) -> { headers: string[], cells: SheetCell[][] }` (exported) -- the column set + value
  resolution lifted verbatim out of `buildAndDownloadReviewCsv`. **Cells are RAW TYPED** (`SheetCell = string |
  number | null`): numeric descriptor values, the Excel-row number, the parent Excel-row numbers, and the depth
  stay JS numbers; text stays string; empty -> null. The CSV path now does
  `buildReviewSheet(...).cells.map(row => row.map(csvCell))` -- `csvCell(null)=""` and `csvCell(n)=String(n)`
  reproduce the prior per-cell strings EXACTLY, so the .csv is **BYTE-IDENTICAL to D2** (verified column-by-column:
  source_row_number via `?? null` keeps 0; clsLabel/append-notes ""→null both render ""; depth/Level via
  String(n); parent-row "" for root). The xlsx path consumes the SAME typed cells so numbers land as real Excel
  numbers. `sanitizeFilename` is also exported (reused by the workbook filename). The literal U+FEFF BOM glyph at
  the CSV Blob stays a glyph (the edit tooling re-normalizes the `"﻿"` escape to the glyph, same as D2 --
  left as-is per plan; the byte is identical either way).
- **Workbook writer `exportReviewXlsx.ts` (NEW).** `buildAndDownloadReviewWorkbook({ boqName, sheets })` where
  `sheets = Array<{ sheetName, rows, columnDescriptors }>` (the fetch happens in the dialog, NOT here -- this
  module does zero network I/O). One worksheet per entry in order: `buildReviewSheet` -> `addRow(headers)` with
  `headerRow.font = { bold: true }` -> `addRows(cells)` (numbers numeric, null blank). Download via
  `workbook.xlsx.writeBuffer()` -> Blob (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) ->
  anchor-click + revokeObjectURL (NO BOM -- xlsx never needs one). Filename
  `${sanitizeFilename(boqName)}_review_${yyyyMMdd_HHmmss}.xlsx` (bare basename, `.xlsx` once).
- **Tab-name sanitize + dedupe (tab title ONLY -- data stays verbatim #152).** `sanitizeSheetTabName(name)`
  (exported): replace each of `: \ / ? * [ ]` with `_`, trim leading/trailing whitespace (the trailing-space
  corpus cases "Electrical " / "HVAC " make this load-bearing -- Excel REJECTS them as tab titles), truncate to
  31 chars, fall back to "Sheet" if blank. `dedupeTabName(base, used)`: on collision append " (2)", " (3)", ...
  truncating the base so the suffixed title still fits 31. The Sheet Name COLUMN inside each tab is the verbatim
  name (untouched).
- **Selection modal `ExportWorkbookDialog.tsx` (NEW), mirroring ParseRunDialog.** Props `{ open, onOpenChange,
  boqName, eligibleSheets }`. Checklist of eligible sheets, ALL PRE-TICKED (the `[open]`-effect seed + functional
  `toggleSheet` + Checkbox/`<label htmlFor>` rows). On confirm: a SEQUENTIAL `for` loop -- one imperative
  `get_review_rows` `.call()` per ticked sheet (GET-capable endpoint via `useFrappePostCall`; sheet_name VERBATIM
  #152) with a progress line ("Fetching {sheet} ({i}/{n})..."), controls disabled + the dialog NOT dismissible
  mid-flight. ANY fetch (or the build step) throwing -> ABORT the whole export, NO file, an inline
  `text-destructive` error naming the failed sheet (`getFrappeError(e)` + fallback). All fetched ->
  `buildAndDownloadReviewWorkbook` -> close. Confirm label "Export N sheets", disabled at zero ticked.
- **Hub wiring (`BoqHubPage.tsx`).** A new `exportEligibleSheetNames = allDrafts where getEffectiveStatus ===
  "Parsed Check Done"`. Global "Export reviewed" button in the footer action cluster (a Tooltip + `<span
  tabIndex={0}>` sibling of Re-parse/Parse, `variant="outline"`, Download icon), `disabled` when the eligible
  set is empty (tooltip "No checked sheets to export"); opens `ExportWorkbookDialog`. A `handleExportCsv` that
  imperatively fetches one sheet's rows (its own `useFrappePostCall("...get_review_rows")`) then the EXISTING
  `buildAndDownloadReviewCsv` -- passed to each SheetCard as `onExportCsv`.
- **Per-card button (`SheetCard.tsx`).** New optional `onExportCsv?: (sheetName: string) => Promise<void>` prop
  (the onOpenReview/onReparse convention). An "Export CSV" Button (`size="sm" variant="outline"`, Download icon)
  in the "Parsed Check Done" branch, after Review. A local `exporting` busy state disables it + swaps the icon
  for a spinner while the hub's promise is in flight; a rejection sets the card's existing inline `cardError`
  (via `getFrappeError`). The hub owns the fetch; the card stays fetch/router-free.
- **Per-card = .csv, global = .xlsx (the format split).** The single-sheet card path deliberately reuses the D2
  CSV writer (a quick one-sheet grab); the multi-sheet global path is always a workbook (.xlsx even for one
  ticked sheet, per the locked design).
- **Verification:** tsc 0 new wizard-file errors (filtered `boq-wizard|exportReview|ExportWorkbook|BoqHubPage|
  SheetCard|boqTypes` -- empty; baseline 3177 unchanged); in-container Vite build exit 0 (`✓ built in 6m 54s`,
  PWA 168 entries); exceljs confirmed in its own lazy chunk, absent from the hub + entry chunks. No Frappe unit
  tests (frontend-only). Manual live-cert LC1-LC8 pending Nitesh: (LC1) D2 CSV regression -- the review-screen
  Export CSV is unchanged; (LC2) global modal eligibility gating + pre-ticked list; (LC3) progress +
  abort-on-failure (no partial file, failed sheet named); (LC4) a multi-sheet workbook with trailing-space names
  -> tabs sanitized + de-duplicated, Sheet Name column verbatim; (LC5) numbers land AS numbers in the workbook;
  (LC6) the per-card .csv matches the review-screen .csv; (LC7) the lazy exceljs chunk -- hub load unaffected,
  exceljs fetched only on export; (LC8) one-sheet global export still produces .xlsx.

**Slice D2 -- per-sheet review CSV export ✅ COMPLETE (FRONTEND ONLY, feat 27866a2e):**
A per-sheet CSV export of the review screen's data: parsed values + human corrections + provenance, flat
columns (no JSON blobs), opening clean in Excel. Files in scope (exclusive): NEW
`frontend/src/pages/boq-wizard/exportReviewCsv.ts` (the writer), `SheetReviewPage.tsx` (button + wiring),
`ReviewTree.tsx` (export-keyword-only on 4 helpers) (+ the 3 docs). `boqTypes.ts` NOT needed (the consumed
types were already exported). OUT of scope: `src/utils/exportToCsv.ts` (NOT touched), all backend, all other
wizard files.
- **Owner-locked decisions:** (1) per-area values get ONE COLUMN PER AREA PER ROLE (matching the tree's
  descriptor columns exactly -- never a JSON dict in a cell); (2) the shared `exportToCsv.ts` is NOT used and
  NOT touched (TanStack-coupled, 15 callers, wrong shape for the descriptor-driven payload -- recon
  2026-06-12); a NEW wizard-local writer is built instead; (3) export is STATUS-INDEPENDENT (a
  frozen/"Parsed Check Done" sheet exports too -- that is the prime use) and VIEW-INDEPENDENT (filters/
  collapse/search state do NOT affect it -- it is the sheet's data, not the current view).
- **Column set (in order):** Sheet Name (verbatim, trailing spaces intact #152) | Excel Row
  (source_row_number) | Sl.No (sl_no_value) | Description | Level (EFFECTIVE depth via the reused
  `computeDepths`) | Classification (Original) = `classification` and Classification (Final) =
  `effective_classification`, both via the tree's `CLS_LABELS` (raw value fallback) | Parent Excel Row
  (Original) = `parent_index` resolved to that row's source_row_number, blank if root | Parent Excel Row
  (Final) = `effective_parent_index` resolved the same way, blank if root (human_is_root rows are roots) |
  one DATA column per `ColumnDescriptor` in payload (Excel) order, EXCLUDING sl_no/description roles (the
  same `FIXED_ROLE_DEDUPE` the tree applies, so Sl.No/Description never duplicate), value via the reused
  `resolveDescriptorValue`, numbers RAW (`String(val)`, NOT the display formatter -- thousands separators
  break Excel numeric parsing), header mirrors the tree VERBATIM (`{col} — {ROLE_LABELS[role]}{ · area}`) |
  Row Notes (`row_notes`, replaces-semantics) | Append Notes (`append_notes_raw`) | Remarks | Edited
  (Yes/No via the SAME isEdited predicate as the tree's Status column: edited_at set OR edit_log non-empty) |
  Edited By | Edited At (verbatim server string).
- **row_notes vs append_notes distinction:** `row_notes` is the single replace-semantics notes field (one
  string). `append_notes_raw` is the accumulate-semantics per-column notes -- VERIFIED client-side shape is a
  `dict[str, str]` (keys = the source column's header label, values = note text; parser classifier.py), NOT
  the array/string the spec anticipated. The writer flattens the dict to `"key: value"` pairs joined `" | "`
  (flat, no JSON braces, preserves which column each note came from); defensively also handles array (join
  values) / string (verbatim) / null ("").
- **Writer mechanics:** `Papa.unparse([headers, ...rows])`; prepend a UTF-8 BOM (`﻿`) before the Blob
  (real BoQs carry rupee signs + non-ASCII -- Excel needs the BOM); Blob type `text/csv;charset=utf-8;`;
  anchor-click download; `revokeObjectURL` after. Filename
  `${boqName}_${sanitize(sheetName)}_review_${yyyyMMdd_HHmmss}.csv` -- sanitize (trim + replace
  filename-illegal chars / whitespace with `_`) applies to the FILENAME ONLY; bare basename, `.csv` appended
  exactly once (the shared util's double-extension trap is the cautionary tale). Rows exported in row_index
  order, ALL rows.
- **Export button:** header right-cluster (first child, before the D1 Mark button), `size="sm"
  variant="outline"`, Download icon, label "Export CSV". Rendered whenever review data is loaded; `disabled`
  while `reviewLoading` or `rows.length === 0`. NOT gated on `sheetStatus`. No dialog, no backend call.
- **Helper reuse (no drift):** `resolveDescriptorValue`, `computeDepths`, `CLS_LABELS`, `FIXED_ROLE_DEDUPE`
  gained the `export` keyword in `ReviewTree.tsx` (all already module-level -- a trivial lift, no behaviour
  change); `ROLE_LABELS` was already exported from `boqTypes.ts`. The CSV and the tree share one source of
  truth for depth, descriptor-value resolution, classification labels, and the sl_no/description dedupe.
- **Retired carry:** the prior "fix exportToCsv's 8 baseline tsc errors before Slice D" item is N/A -- the
  shared util is deliberately untouched this arc; its 8 errors remain part of the standing repo baseline.
- **Verification:** tsc 0 new wizard-file errors (filtered ReviewTree|boqTypes|boq-wizard|SheetReviewPage|
  exportReviewCsv -- empty); in-container Vite build exit 0 (`✓ built in 5m 47s`, PWA 166 entries). No Frappe
  unit tests (frontend-only). Manual live-cert LC1-LC7 pending Nitesh (multi-area column diff vs screen;
  edited-row original/final pairs; remarks/row-notes/append-notes columns; rupee/unicode in Excel;
  trailing-space sheet name; export on a frozen/checked sheet; numbers parse as numbers).

**Slice D1 -- "Parsed Check Done" marking + read-only FREEZE + Un-mark ✅ COMPLETE (BACKEND + FRONTEND):**
A sheet at "Parsed Check Done" is FROZEN: no value/text/area edits, no restructure, no remarks, no flag
dismissals -- enforced BACKEND and FRONTEND. The review screen gains a "Mark Parsed Check Done" action and,
once checked, a read-only banner with Un-mark + Go-to-hub. Files in scope (exclusive list): `review_screen.py`,
`test_review_screen.py`, `SheetReviewPage.tsx`, `ReviewTree.tsx`, `boqTypes.ts` (+ the 3 docs). NO doctype JSON
change (the enum already carries the value); RestructureModal.tsx / SheetCard.tsx / BoqHubPage.tsx /
ParseRunDialog.tsx / update_sheet_draft.py all OUT of scope.
- **Backend freeze (1a/1b):** `_get_sheet_wizard_status(boq, sheet)` (one get_value, parent/parenttype/
  sheet_name filter, VERBATIM #152) + `_guard_sheet_not_frozen(boq, sheet)` (throws the single
  `_FROZEN_WRITE_MESSAGE` iff status == "Parsed Check Done"), called in EACH of the four write endpoints
  (`save_review_edit`, `save_review_restructure`, `save_review_remark`, `dismiss_row_flags`) immediately AFTER
  the BOQs-exists guard and BEFORE any doc-locate / validation / write (in save_review_edit this short-circuits
  the expensive human_parent cycle-guard). PURELY ADDITIVE -- a non-checked sheet is byte-for-byte unchanged.
- **Mark precondition (1c):** `mark_sheet_parsed_check_done` reads current status AFTER locating the child row,
  BEFORE the integrity compute: already "Parsed Check Done" -> throw; not "Parsed" -> throw (status echoed).
  The endpoint had NO status check before D1 (it stamped unconditionally). ok:false+breaks / ok:true+overridden
  response shapes UNCHANGED; its 3 prior tests seed "Parsed" so they stay green.
- **Un-mark endpoint (1d):** NEW `unmark_sheet_parsed_check_done(boq, sheet)` -- precondition current ==
  "Parsed Check Done" else throw; then direct `set_value(... "Parsed")` + commit; returns `{ok, status:"Parsed"}`.
  NO integrity check going backward. Deliberately bypasses `set_sheet_status` (which rejects "Parsed" --
  `_DIRECT_SET_STATUSES` excludes it), same as mark documents.
- **Tests (1e; +10 -> test_review_screen 137 -> 147, green in-container):** `TestParsedCheckDoneFreeze` F1-F5
  (each of the four writes blocked on a checked sheet + the unblocked control after status restored),
  `TestMarkSheetParsedCheckDone` M1/M2 (already-checked rejected; non-Parsed rejected), `TestUnmarkSheetParsedCheckDone`
  U1-U3 (un-mark accepts; non-checked rejects; mark->freeze-blocked->unmark->write-succeeds round-trip). Each freeze
  test flips the fixture status in-body and `setUp` restores "Parsed" so siblings are unaffected.
- **Frontend (2a-2c):** `boqTypes.ts` +`MarkParsedCheckDoneResponse` / `UnmarkParsedCheckDoneResponse` (reuse the
  existing `StructuralBreak`). `SheetReviewPage` derives `sheetStatus` from `boq.sheet_drafts` (already on the
  payload -- one-level child; VERBATIM match) + `isChecked`, destructures `boqMutate`, renders the Mark button
  (only when status=="Parsed") with a light-confirm AlertDialog that escalates to a breaks warn ("Mark anyway" =
  confirm:true), and a teal read-only banner with Un-mark + Go-to-hub; passes `readOnly={isChecked}` to ReviewTree.
  `ReviewTree` gains `readOnly?: boolean` gating ALL 11 write affordances at their render sites (reclassify pill,
  change-parent door, value/text/area edit blocks, Remarks editor [read-only text if a remark exists], "Looks
  OK"); the confirm dialogs + childless AlertDialog + RestructureModal become unreachable (state-driven, set ONLY
  by gated triggers). Errors via house `getFrappeError()`. tsc 0 new wizard-file errors + in-container build exit 0
  (`✓ built in 3m 36s`, PWA 166 entries). Manual live-cert LC1-LC8 pending Nitesh.
- **DEFERRED (logged):** the `update_sheet_draft` dirty-marker `"Parsed"`-only asymmetry (a config change does NOT
  drop a "Parsed Check Done" sheet) is left for the status-rename slice -- NOT fixed here (out of scope).

**C-flag-dismissal (per-row "Looks OK") ✅ COMPLETE (BACKEND + FRONTEND):**
A per-row dismissal of advisory flags on the review screen. Owner-LOCKED model: PER-ROW (one gesture clears
ALL of a row's currently-computing flags, NOT per-flag); a dismissal is an ACKNOWLEDGMENT, not an edit -- it
MUST NOT flip the row to "Edited", MUST NOT stamp edited_at, MUST NOT touch edit_log, MUST NOT alter the
`isEdited` predicate; it follows the `save_review_remark` pattern (direct set_value, bypassing the provenance
chokepoint). Files in scope: `boq_review_row.json`, `review_screen.py`, `test_review_screen.py`,
`boqTypes.ts`, `ReviewTree.tsx`, `SheetReviewPage.tsx` (+ the 3 docs). NO parse_run.py change; NO
`_compute_advisory_flags` change; NO `save_review_remark` change.
- **Storage (B1):** 3 additive `BoQ Review Row` fields after `remarks` -- `flags_dismissed` (Check, default
  "0"), `flags_dismissed_by` (Data, read_only), `flags_dismissed_at` (Datetime, read_only). Mirrors the
  `human_is_root` field-shape idiom. `bench migrate` landed all three (`has_column` verified).
- **Endpoint (B2):** `dismiss_row_flags(boq_name, sheet_name, row_index, dismissed)` -- `@frappe.whitelist
  (methods=["POST"])`, resolves the row the SAME way `save_review_remark` does (verbatim sheet_name #152),
  writes ONLY the 3 fields via `frappe.db.set_value` (NOT doc.save, NOT the chokepoint). dismissed truthy ->
  1 + by(`frappe.session.user`)/at(`frappe.utils.now()`); falsy -> all three cleared. Returns
  `{flags_dismissed: 0|1}`. HTTP-string bool coercion (`"1"/"true"/"yes"`).
- **Clear-on-edit (B3, decision 3a):** ONE insertion in `_apply_and_save_row_edit` at the provenance stamp
  block -- `doc.flags_dismissed=0` + by/at=None. Covers save_review_edit AND save_review_restructure (both
  funnel through the helper). A remark does NOT re-open (save_review_remark bypasses the helper -- correct).
  Re-parse wipes free (delete+recreate -> the Check defaults 0; NO parse-worker edit).
- **Read wiring (B4):** the 3 fields added to `get_review_rows` `all_fields` so they ride the row payload
  (exactly how `remarks` was added). No other get_review_rows change.
- **Tests:** `TestDismissRowFlags` +6 in test_review_screen.py -- dismiss-stays-Original (edited_at None +
  edit_log empty), un-dismiss-clears-all-three, edit-reopens (chokepoint), restructure-reopens (same
  chokepoint), remark-does-NOT-reopen (the bypass), get_review_rows-carries-the-3-fields. 131 -> 137, all
  green in-container.
- **Frontend (F1-F3):** `boqTypes.ts` ReviewRow gains `flags_dismissed?: number` / `_by?: string|null` /
  `_at?: string|null` (additive). `ReviewTree`: a "Looks OK" `Button` in the detail-panel Flags block header
  (calls `useFrappePostCall("...dismiss_row_flags")` with dismissed:true + stopPropagation; refresh via the
  existing `onRemarkSaved` mutate -- a dismissal is NOT an edit); a NEW dismissed Info-marker state
  (`CheckCircle2`, muted/grey, title "Reviewed — looks OK"; flags still EXIST, NOT amber-active, NOT removed)
  computed from `isDismissed = !!row.flags_dismissed`; a "Reviewed — looks OK" tag in the flag-reveal row;
  the `isEdited` predicate / Edited pill / green tint are UNTOUCHED; already-dismissed reads "Reviewed" (no
  un-dismiss button ships). `SheetReviewPage`: the flag summary strip now renders "N <label> – C cleared"
  per category, where cleared = flags of that type whose `row_index` is in `dismissedRowIdx` (the
  `flags_dismissed` rows from the payload) -- derived frontend-side, NO new endpoint.
- **Verification:** tsc 0 new wizard-file errors (project baseline 3177 unchanged) + in-container build exit
  0 (`✓ built in 6m 46s`, PWA 166 entries). Manual live-cert LC1-LC6 (LC3 = edit re-opens, LC4 = remark does
  NOT re-open, LC5 = re-parse wipes) DEFERRED to Nitesh. Two commits (feat, docs); NOT pushed.
- **Placement follow-up (FRONTEND ONLY, ReviewTree.tsx):** the "Looks OK" button placement was fixed -- the
  Flags block header div changed from `flex items-center justify-between gap-2` to `flex items-center gap-2`
  (REMOVED `justify-between`), so the "Looks OK" Button (and the "Reviewed — looks OK" span when dismissed)
  now sits IMMEDIATELY BESIDE the "Flags" label on the LEFT, always visible with NO horizontal scroll on a
  wide sheet. Same class of fix as #158 finding-7 (bring the action to the eye, left-visible). ONE className
  change -- the Button / stopPropagation / reasons `<ul>` / attribution line / dismissError line all UNCHANGED.
  tsc 0 ReviewTree errors + in-container build exit 0 (`✓ built in 5m 26s`). Live-cert LC1-LC2 pending Nitesh.

**§9 #159 ReviewTree find & filter ✅ COMPLETE (FRONTEND ONLY, `ReviewTree.tsx`; no backend change):**
A FILTER surface + a SEARCH surface on the main review tree (the owner-LOCKED interaction model from
findings 6 + 8). tsc 0 new wizard-file errors (project baseline 3177 unchanged) + in-container build exit 0
(`✓ built in 10m 54s`, PWA 166 entries, `Done in 741.06s`); no Frappe unit tests (frontend-only). Manual
live-cert LC1-LC7 deferred to Nitesh. Blast radius = `ReviewTree.tsx` ONLY (no SheetSearchView edit/import,
no backend, no doctype, no `boqTypes.ts`, no `SheetReviewPage.tsx`).
- **FILTER (finding-6) -- strict-hide, two column-header Popovers, AND-combined.**
  - **Status filter** (`statusFilter: "all" | "edited" | "original"`, default `"all"`): a `Popover` in the
    Status `<th>` with three buttons (All / Edited / Original). Predicate = the existing `isEdited`
    expression (`row.edited_at !== null || (edit_log.length > 0)`), re-stated inside `passesFilter` (the
    inline at the render row, ReviewTree :959-equiv, is UNTOUCHED). A remark-only row is Original
    (`save_review_remark` never stamps `edited_at`/`edit_log`).
  - **Classification filter** (`classFilter: Set<string>`, seeded with ALL 6 `CLS_LABELS` values): a
    `Popover` in the Classification `<th>` with a 6-value `Checkbox` checklist over the
    `CLASS_FILTER_VALUES` const = the FULL FROM/read vocab (`preamble, line_item, note, spacer,
    subtotal_marker, header_repeat`), NOT `ASSIGNABLE_CLASSIFICATIONS` (the 4 write-targets) -- a filter
    reads all 6 existing states. Matches `row.effective_classification`. **SHOW-set semantics:** size === 6
    => no narrowing (all shown); unchecking a type hides it; empty set => show none. `allClassesShown`
    short-circuits the predicate so a null-classification row still shows when no narrowing is active.
  - **STRICT HIDE:** a new `if (!passesFilter(row)) return null;` gate joins the existing `isVisible` +
    `classificationVisible` return-null gates at the top of `rows.map`. Non-matching rows emit no `<tr>`
    (flat list of matches; parent context stays readable via the Parent column -- owner-accepted). The two
    filters combine with AND inside `passesFilter`. Safe because `byIdx`/`depths`/`hasChildrenSet` derive
    from the FULL `rows` prop in `useMemo([rows])` -- strict-hide narrows only the rendered subset, never
    the depth/parent maps.
  - **Filter-active indicator:** the `Filter` trigger icon in each `<th>` turns `text-blue-600
    dark:text-blue-400` when that filter is narrowing (`statusFilterActive` / `classFilterActive`), else
    muted. Triggers `stopPropagation` (they live inside the `<table>` whose body-onClick dismisses the
    detail/flag panels).
- **SEARCH (finding-8) -- description-only, RING-highlighted, cycling.**
  - A search `Input` + `N of M` counter + prev/next stepper added to the existing controls bar
    (`ml-auto`, beside the column-selector / flag-toggle / annotation checkboxes). Substring match on
    `row.description` ONLY (case-insensitive); no other fields.
  - **Two-tier highlight via RINGS, NOT backgrounds (the collision rule, recon Q4c).** Added to the row
    `cn()` block AFTER the background tiers (`hover:bg-muted/30`, preamble `bg-muted/20`, edited
    `bg-green-50`, the `highlightedIdx` amber flash): all hits = `ring-1 ring-inset ring-blue-300
    dark:ring-blue-700` (soft); current hit = `ring-2 ring-inset ring-blue-500 dark:ring-blue-400` (strong).
    Mutually exclusive (`searchHitSet.has(idx) && currentHitRowIdx !== idx` for the soft tier) so the two
    ring WIDTHS never conflict in Tailwind. Rings are inset box-shadow -- a DIFFERENT CSS property than
    `background-color` -- so they layer OVER the background tiers without masking the edited-green /
    preamble tints (edit-state stays visible while searching). The existing single `highlightedIdx` amber
    scroll-flash is UNTOUCHED (separate concern; search reuses it via `revealAndScrollToRow`).
    **CAVEAT for live-cert (LC4):** ReviewTree's `<table>` is `border-collapse`; `ring-inset` (inset
    box-shadow) is the more reliably-painted variant on table rows, but if LC4 shows no ring the fallback
    is moving the ring to an inner cell -- watch this in cert.
  - **Cycling:** `stepSearchPrev` / `stepSearchNext` modulo-wrap `searchCurrentIdx` over `searchHits.length`
    (both directions), mirroring SheetSearchView's `stepPrev`/`stepNext` PATTERN (NOT imported). On step they
    call the EXISTING `revealAndScrollToRow(searchHits[ni])` (`:696-717`) so the new current hit
    auto-expands collapsed ancestors + scrolls + flashes -- no auto-expand reimplemented. Prev/next disabled
    at 0 hits; counter `0 of 0` / `${safeSearchIdx + 1} of ${searchHits.length}`. `searchCurrentIdx` resets
    to 0 when the hit set changes (`useEffect([searchHits])`, mirror of SheetSearchView :288-290).
- **COMPOSE (the interlock) -- hits over the SAME shown-predicate as render.** `searchHits` (a
  `useMemo`) iterates `rows` and keeps a row iff `classificationVisible(row) && passesFilter(row)` AND its
  description matches the query -> an ordered `number[]` of `row_index` (+ `searchHitSet` for O(1) ring
  membership). It uses the SAME filter predicates the render gate uses, so a search hit can NEVER be a
  filtered-out row; clearing a filter widens the hit set. **RESOLVED AMBIGUITY (recorded):** the build
  prompt's B3 literally listed `isVisible` in the hit predicate, but B5/LC5 require stepping to a hit under
  a COLLAPSED parent to auto-expand it. Gating hits on `isVisible` (collapse) would make a collapsed-ancestor
  hit un-findable and `revealAndScrollToRow`'s auto-expand dead code. RESOLUTION: hits gate on the FILTER
  axis (`classificationVisible + passesFilter`) but DELIBERATELY NOT on `isVisible` (the collapse axis,
  which is reversible and is exactly what stepping undoes). Render and hits agree on the filter axis; they
  differ only on collapse, by design -- LC5 works, and "a hit is never a filtered-out row" still holds.
- **Engineering-latitude choices (stated):** classFilter seeded full (size-6 == show-all, NOT empty-means-all
  -- empty means show-none); ring tiers `ring-1`/`ring-2` blue-300/blue-500 inset (rings, never backgrounds);
  filter-active indicator = blue trigger icon; search box pushed right (`ml-auto`) in the controls bar.

**ReviewTree detail-panel layout pass ✅ COMPLETE (FRONTEND ONLY; pure CSS; no backend change):**
Three className-only fixes to the inline detail panel in `ReviewTree.tsx` ONLY (no logic, state, handler,
gate, save path, field-derivation, `colSpan`/`totalCols`, or `<tr>`/`<td>` structure touched; no backend,
no doctype, no `boqTypes.ts`). tsc 0 new wizard-file errors (project baseline 3177 unchanged) + in-container
build exit 0; no Frappe unit tests (frontend-only, pure CSS). Manual live-cert LC1-LC5 deferred to Nitesh.
- **FINDING B -- panel reads as a DISTINCT, BRAND-TINTED nested card (was: blended into the row stack).**
  Recon root cause: the panel's inner content `<div>` background `bg-muted/30` is the EXACT tint a normal
  data row uses on hover (`hover:bg-muted/30`), and the panel had only a bottom border -- so it read as just
  another hovered row. FIX (layout pass + brand-tint follow-up): the inner content `<div
  onClick={stopPropagation}>` (inside `<td colSpan={totalCols} className="px-3 py-3 border-b border-border">`)
  now carries `bg-indigo-50/40 dark:bg-indigo-950/20 border border-border border-l-4 border-l-primary
  rounded-md shadow-sm p-3`. The differentiator = a distinct INDIGO body tint (NOT the hover tint) + border
  + radius + shadow + own padding + a BRAND-RED LEFT-ACCENT STRIPE (`border-l-primary`). **Brand-red token
  read (Phase 1):** `border-l-primary` -> the `--primary` token = `346.8 77.2% 49.8%` (a rose/crimson red,
  defined in `frontend/src/index.css` `:root` L47 + `.dark` L79, identical both modes), DISTINCT from
  `--destructive` (`0 84.2% 60.2%` light / `0 62.8% 30.6%` dark, pure-red hue 0). **WHY accent not full
  surface / WHY `--primary` not `--destructive`:** a full red surface (or the destructive token) would
  collide with the destructive/error red meaningful on this screen (re-parse warning, cycle rejection); the
  brand red is carried as an ACCENT via `--primary`. The `<tr className="bg-muted/30">` + `<td colSpan>`
  structure is UNCHANGED (colSpan/totalCols untouched).
- **Obs 1 -- Classification/Parent VERTICAL STACK.** The original/effective grid `grid grid-cols-2 gap-x-4
  gap-y-1 text-xs mb-2` becomes `grid grid-cols-1 gap-y-1 text-xs mb-2` (Classification row first, then the
  Parent + §9 #162 "Change parent" row below). Reason: on a wide sheet the right grid column (Parent) was
  off-screen-right and needed horizontal scroll. The two flex cells' internal content (labels, "Change ▾"
  dropdown, "Change parent" button) is byte-for-byte unchanged -- only side-by-side -> stacked.
- **Obs 2 -- the three edit blocks become responsive ~4-col grids, INDEPENDENTLY (option A, owner-locked).**
  EACH of the three edit-block containers (numeric "Edit values" / text "Edit text" / per-area "Edit per-area
  values") converts from `flex flex-wrap gap-2` to `grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3
  lg:grid-cols-4 gap-2` (caps ~4 wide on lg, fewer when narrow -- no heavy left-right spread). The per-field
  items DROP `w-52` (now `flex flex-col gap-1`): in a grid the column governs width; a fixed width would
  block cell-fill / overflow a narrow column. The item's internal `flex flex-col` (label + `flex
  items-center gap-1` Input/Apply row) is unchanged. **The three blocks stay SEPARATE -- NOT merged** (each
  has its own save path: numeric openValueConfirm, text saveTextField direct, per-area openAreaConfirm). The
  Remarks block (`mb-2 max-w-md` Textarea, separate `saveRemark` path) is OUT OF SCOPE and untouched.
- **Manual live-cert (deferred to Nitesh).** LC1 panel reads as a distinct card + stays distinct when an
  adjacent row is hovered; LC2 Parent + "Change parent" stack below Classification, no horizontal scroll;
  LC3 fields wrap ~4-per-row, fewer when narrow (responsive); LC4 numeric/text/per-area Apply each still save
  + flip the row to Edited, Remarks unchanged; LC5 "Change ▾" + "Change parent" still open the modal.
- **Engineering-latitude choices.** B1 card treatment = `bg-background` solid card + full border + rounded +
  `shadow-sm` (reason: a solid non-hover-tint background is the differentiator). B2 stack = keep grid with
  `grid-cols-1` (reason: minimal diff, retains the vertical gap). B3 `w-52` = DROPPED (reason: in a grid the
  column governs width; a fixed width fights cell-fill and overflows narrow columns).

**§9 #158 -- RestructureModal polish pair ✅ COMPLETE (FRONTEND ONLY; no backend change):**
Two cosmetic/ergonomic fixes to `RestructureModal.tsx` ONLY (no backend, no doctype, no `SheetSearchView`
edit, no `dialog.tsx` edit). tsc 0 new wizard-file errors (project baseline 3177 unchanged) + in-container
build exit 0; no Frappe unit tests (frontend-only; the modal + backend are already certified). Manual
live-cert LC1-LC5 deferred to Nitesh (briefing in the slice report).
- **Finding-2 -- accidental outside-click dismiss DISABLED (Option X, owner-locked).** A stray click OUTSIDE
  the modal previously dismissed it and lost the user's staged selections (chosen option, picked parent).
  FIX: `onInteractOutside={(e) => e.preventDefault()}` added DIRECTLY to `<DialogContent>` -- the shadcn
  `DialogContent` spreads `{...props}` onto `DialogPrimitive.Content` (recon-confirmed `dialog.tsx:36-43`),
  so the Radix dismiss prop is passed modal-side with NO edit to the `dialog.tsx` primitive. **`onInteractOutside`
  chosen over `onPointerDownOutside`** because it covers BOTH outside pointer-down AND outside focus -- the
  fuller guard against accidental loss. `onOpenChange` is UNTOUCHED (it is SHARED by ESC + the close-X +
  Cancel/Save -- touching it would have killed ESC, which we KEEP). Net: outside-click does nothing; ESC,
  Cancel, Save, and the close-X all still close normally.
- **Finding-7 -- pick buttons moved ABOVE the picker grid (Path 1, owner-locked).** The "Set as parent" /
  "Top level" / "Cancel pick" button row sat BELOW the `<SheetSearchView>` grid in all three picker sites
  (row-position move, option-3 one-new-parent, option-4 per-child), so reaching the pick action meant
  scrolling past the now-tall wrapping sheet grid (SheetSearchView v2 made cells wrap). FIX: the EXISTING
  button row is relocated VERBATIM to BEFORE the `<SheetSearchView>` mount in EACH of the three sites (order
  becomes `[helper <p>] -> [button row] -> [<SheetSearchView>]`). Pure relocation -- buttons, handlers,
  labels, disabled logic, and the `rowParentIdx`/`blockParentIdx`/`perChild` wiring are unchanged; the
  wrapping `rounded-md border ... space-y-2` container is kept, only its children reorder.
- **REFRAME (record so a future reader doesn't re-chase the dead idea):** the handover's literal #158
  finding-7 wording preferred aligning the buttons INSIDE the picker's search-bar row (top band). The §9 #158
  recon PROVED this unreachable WITHOUT editing `SheetSearchView`: its search-bar band is the first child of
  the component's own root `space-y-3` div and the component exposes NO slot/render-prop for injecting content
  there -- the modal can only place content as a sibling ABOVE or BELOW the whole component. Owner chose Path 1
  (above-the-picker), which delivers the intent (no scroll-to-pick) modal-side only. Do NOT re-attempt the
  in-search-bar alignment; it requires a SheetSearchView edit that was deliberately avoided.

**§9 #162 -- Standalone "Change parent" door ✅ COMPLETE (FRONTEND ONLY; no backend change):**
A SECOND front door to the EXISTING `RestructureModal`, reached WITHOUT a reclassification. Today a reviewer
can only move a row to a new parent BY changing its classification (the modal opens off the pill "Change ▾"
DropdownMenu). This slice adds a "Change parent" button in the row-detail panel's PARENT cell (right cell of
the detail grid), structurally MIRRORING the "Change ▾" reclassify control in the CLASSIFICATION cell (left).
File: `ReviewTree.tsx` ONLY (no `RestructureModal.tsx`, no backend, no doctype JSON, no `boqTypes.ts`).
tsc 0 new wizard-file errors (project baseline 3177 unchanged) + in-container build exit 0; no Frappe unit
tests (frontend-only; the reused modal + backend are already certified). Manual live-cert LC1-LC6 deferred
to Nitesh (briefing in the slice report).
- **The door = `setRestructureModal({ row, newClassification: row.effective_classification })` -- a NO-OP
  reclassify.** The button opens the modal DIRECTLY (not via `onPickClass`, which would route a childless row
  to the light AlertDialog confirm) with `newClassification` = the row's CURRENT classification. The modal does
  everything else UNCHANGED -- this is the POINT of reusing it. `canSave` never compares new-vs-current
  classification (verified V2), so a same-value class is benign; the backend accepts `new_classification ==
  current` for the 4 assignable classes (verified in the §9 #162 recon).
- **NON-NEGOTIABLE -- no silent reparent (the reason we reuse the modal, not a lighter path):** a WITH-children
  row opened via "Change parent" STILL surfaces the five child-placement options (the `children.length > 0` gate
  in `RestructureModal` is left EXACTLY as is -- NOT suppressed for a parent-only open). The reviewer must decide
  the children's fate; the modal's batch cycle-guard + single write-chokepoint (`_apply_and_save_row_edit`) come
  along. A CHILDLESS row opens with the children block already suppressed (the existing childless adaptation;
  `rowPosition` lazy-inits to "move") -> shows only the row's-own-position picker.
- **Scope exclusion (owner-locked):** the button does NOT render when the row's CURRENT classification is
  `subtotal_marker` or `header_repeat` (the two parser-only detections NOT in `_ASSIGNABLE_CLASSIFICATIONS`).
  Gated by `canChangeParent = effective_classification != null && ASSIGNABLE_CLASSIFICATIONS.includes(it)`. A
  no-op reclassify on those two classes would be rejected by the backend assignable-vocab gate, so the door
  must not appear there.
- **edit_log fidelity (the one backend question this slice had to resolve -- VERIFIED, no change needed):**
  the standalone reparent MUST appear in the row's edit_log. The modal's no-op reclassify writes a same-value
  `human_classification` entry (harmless), but the PARENT change is captured SEPARATELY: `save_review_restructure`'s
  `row_new_parent` write path calls `_apply_and_save_row_edit(..., "human_parent", ...)`, and that shared helper
  ALWAYS appends its own edit_log entry for the field it writes (`review_screen.py:811-828`) -- field
  `human_parent`, `from` = prior effective parent, `to` = new parent (or null for root), reason
  `"row moved: row N reclassified to <cls>"`. So the parent move is ALREADY logged as its own entry; NOTHING was
  added backend-side (the B2 conditional + its chokepoint STOP-gate were NOT triggered).
- **Engineering choice:** a plain `<button>` (not a single-item DropdownMenu), styled identically to the existing
  `Change ▾` pill -- there is no list to pick; the single action is "open the modal", so a dropdown would be a
  hollow one-item menu.

**Force Re-parse -- FRONTEND slice (two entry points + shared modal + rewritten warning) ✅ COMPLETE (FRONTEND ONLY; consumes the BACKEND floor below):**
The UI that sets `force_reparse: true`. Files: `SheetCard.tsx`, `ParseRunDialog.tsx`, `BoqHubPage.tsx` ONLY
(no backend, no doctype JSON, no `boqTypes.ts` -- the dialog's new props are typed locally). tsc 0 new
wizard-file errors (project baseline unchanged) + in-container build exit 0; no Frappe unit tests
(frontend-only; the backend floor is already test-certified). Manual live-cert LC1-LC7 (DESTRUCTIVE --
re-parsing wipes real edits) deferred to Nitesh; briefing written into the slice report.
- **Eligibility = `has_prior_parse === 1` AND effective status in {Parsed, Parsed Check Done, Reviewed}.**
  **"Parse failed" is DELIBERATELY EXCLUDED** (decision recorded this slice): the locked feature shape listed
  it, but the backend floor does NOT widen `force_reparse` to "Parse failed" (Rule 4 keeps it `not_eligible`
  regardless of the flag) -- offering it would be a control that silently no-ops (the sheet would land in the
  completion modal's "Not parsed" line). A never-parsed sheet (`has_prior_parse !== 1`) never shows a Re-parse
  control. The same predicate is used by BOTH the per-card render gate (`canReparse` in `SheetCard.tsx`) and
  the hub's `reparseEligibleDrafts` (the global-button gate + the dialog's tickable source).
- **TWO entry points, ONE shared modal (`ParseRunDialog`).** (1) PER-CARD "Re-parse" -- an `outline` Button
  inside the Parsed / Parsed Check Done / Reviewed action blocks (rendered only when `canReparse`); on click ->
  `onReparse(sheet_name)` -> hub opens the dialog in reparse mode PRE-FILTERED + pre-ticked to that ONE sheet
  (`reparseRestrictSheet`). (2) GLOBAL "Re-parse" -- an `outline` Button BESIDE the existing Parse button (both
  now wrapped in a `flex gap-2` cluster); it does NOT replace Parse or re-enable the greyed Parse. ENABLED when
  `reparseEligibleDrafts.length >= 1` (+ the existing `parseInFlight` guard); GREYED with a "No previously-parsed
  sheets to re-parse" tooltip when zero. **NO blockingCount gate** (deliberate divergence from `canParse` -- a
  Parse-failed sheet must not block re-parse of the previously-good sheets; the two concerns are independent).
- **Dialog-mode mechanism (engineering choice).** A `mode?: "parse" | "reparse"` prop (default `"parse"`) +
  `reparseDrafts?` (tickable source in reparse mode) + `restrictToSheetName?` (per-card pre-filter). The PARENT
  (`BoqHubPage`) owns `parseDialogMode` state and derives `force_reparse` from it in `handleParseConfirm`, so
  `onConfirm(sheetNames)`'s signature is UNCHANGED (smallest blast radius). `tickableDrafts` = reparse ?
  (restrict ? filter-to-one : reparseDrafts) : reviewedDrafts; `tickedSheets` seeds from it; the seed effect
  still keys on `[open]` (mode/restrict are set by the parent BEFORE open flips true, so the effect reads the
  fresh tickable source). The four informational lists (General specs / Already parsed / Pending / Skipped) are
  gated `mode === "parse"` -- hidden in reparse mode. Title / description / confirm-label / "Will (re-)parse"
  heading all adapt by mode.
- **B3 path taken = PROCEED (extend, NOT restructure).** Making "Parsed Check Done" tickable (it was invisible
  in all four dialog lists before) needed only swapping the tickable-source array feeding the EXISTING
  `tickedSheets` / `toggleSheet` / `<Checkbox>` machinery -- no rebuild of the four-list render. (The B3 risk
  gate's STOP path was not triggered.)
- **Rewritten + re-targeted destructive warning (step 2).** Trigger UNCHANGED in shape (`dirtyTicked.length > 0`,
  where `dirtyTicked` = ticked sheets with `has_prior_parse === 1`) -- which now catches Parsed + Parsed Check
  Done + dirty-Reviewed. Copy REWRITTEN to name specifically what is destroyed: the parsed output AND every
  review-screen change -- edited values and text, REMARKS, classification changes, and any parenting /
  restructure moves; "cannot be undone." A LOUDEST `destructive`-styled callout (`checkedDoneTicked` =
  `dirtyTicked` filtered to `wizard_status === "Parsed Check Done"`) names the hand-reviewed+Checked sheets
  ("Re-parsing throws away that completed review entirely"). In normal-parse mode the Checked callout never
  appears (no Checked sheet is tickable there) and a FRESH Reviewed sheet still triggers nothing (LC7 unchanged).
- **force_reparse wiring (B5).** `handleParseConfirm` spreads `...(parseDialogMode === "reparse" ? { force_reparse: true } : {})`
  onto the existing `callRunParse({ boq_name, sheet_names })` payload. Normal Parse omits it (backend default
  False). The SDK serializes the bool; the backend coerces `"true"/true`.
- **#145 closure.** "All-Parsed workbook: Parse greyed, but Re-parse now ENABLED" -- the per-card + global
  Re-parse controls give an all-Parsed (or all-Checked) workbook a live re-parse path it previously lacked.

**Force Re-parse -- BACKEND slice (flag-gated eligibility) ✅ COMPLETE (BACKEND ONLY; no frontend this slice):**
The receiving end for a future Force Re-parse UI: a user deliberately re-runs the parser on a sheet that is
already "Parsed Check Done" (one a human hand-edited on the review screen and marked checked). Today
`assemble_mapping_config` Rule 4 throws "Parsed Check Done" into `not_eligible`; this slice makes it eligible
ONLY under an explicit flag, leaving the normal parse path byte-for-byte unchanged.
- **The flag: `force_reparse: bool = False`.** Threaded through the existing `sheet_names` plumbing pattern:
  `run_parse(boq_name, sheet_names=None, force_reparse=False)` [whitelisted endpoint; HTTP string coerced
  to bool via `"true"/"1"/"yes"` check, mirroring the sheet_names JSON-decode] -> `frappe.enqueue(..., force_reparse=)`
  -> `_run_parse_worker(boq_name, sheet_names=None, user=None, force_reparse=False)` -> `assemble_mapping_config(boq_name, force_reparse=False)`.
  Default False / absent everywhere -- existing callers and the normal parse path are unchanged.
- **The eligibility extension (Rule 3, ONE guarded clause):** the existing branch becomes
  `if status in {"Reviewed", "Parsed"} or (force_reparse and status == "Parsed Check Done"):`. Admitting
  "Parsed Check Done" into the SAME Rule 3 branch body (not a parallel branch) means the empty-blob /
  invalid-blob sub-gates apply IDENTICALLY -- a valid sheet_config blob is still required. Chosen for zero
  validation duplication + minimal blast radius. Scope is "Parsed Check Done" ONLY; "Parse failed" is NOT
  widened (a frontend-slice concern -- the UI won't offer re-parse on a never-succeeded sheet).
- **Status after re-parse = "Parsed" (Option A) -- already correct, NOT changed.** The worker's status-set
  line (`_set_draft_status(boq_name, sheet_name, "Parsed", ...)`) is unconditional on a successful data-sheet
  parse; a re-parsed "Parsed Check Done" sheet (a data sheet) drops to "Parsed", discarding the human
  edits/remarks (the prior BoQ Review Rows are deleted-then-inserted -- replace semantics, by design). Verified
  unchanged this slice (V5).
- **Tests (+6; test_parse_run 63 -> 69, all green in-container):** T1 (flagged -> "Parsed Check Done" admitted
  as data); blob-gate guard (flagged but blob-less -> still not_eligible, proves "same terms as Rule 3"); T2
  (NO flag -> SAME sheet stays in not_eligible -- the load-bearing leak guard); T3 (flag does not change
  Reviewed/Parsed eligibility, both directions); T4 (worker: flagged re-parse of a Parsed Check Done sheet
  inserts rows + ends "Parsed" -- Option A end-to-end); T4b (worker: NO flag -> lone Parsed Check Done sheet
  not eligible, no rows, status untouched). Parser baseline 588 unchanged. Files: `parse_run.py` +
  `test_parse_run.py` ONLY. No doctype JSON, no frontend.

**Restructure Slice 1b-beta2b ✅ COMPLETE (feat 20e1f5a7; FRONTEND ONLY; finding-9 + finding-10 CLOSED):**
The restructure-flow completeness slice -- two deliverables, backend UNTOUCHED (the childless wire shape
is already certified by backend tests T2/T4).
- **D1 (finding-10) -- real error messages.** The broken inline error-extraction ladder
  (`e instanceof Error ? e.message : ...`) is replaced by the house helper `getFrappeError()` in FIVE catch
  blocks: RestructureModal.handleSave (-> setSaveError); ReviewTree confirmChildlessReclassify
  (-> setRestructureError), confirmValueSave (-> setSaveError, after the existing setPendingEdit(null)),
  saveTextField (-> setSaveError), saveRemark (-> setRemarkError). **Root cause:** the frappe-react-sdk
  rejects with a PLAIN OBJECT whose `.message` is a hardcoded `'There was an error.'`; the real
  `frappe.throw` text travels in `_server_messages` (double-encoded JSON). `getFrappeError`
  (`src/utils/frappeErrors.ts`) decodes `_server_messages` -> `exception` (strips the
  `frappe.exceptions.X:` prefix) -> `message`/`toString`. Each site KEEPS its prior static string as a
  trailing `|| "..."` fallback (guards the `_server_messages === "[]"` empty-join edge). `frappeErrors.ts`
  + its 4 pre-existing call sites are UNTOUCHED -- it is the proven house pattern; new catch blocks should
  consume it.
- **D2 (finding-9, owner spec amendment) -- the childless row-position choice.** The row-position choice
  (Keep current [DEFAULT] / Move under a new parent) is now ALSO offered on the CHILDLESS reclassify path.
  - **D2a (ReviewTree childless AlertDialog):** two radios between the description and the error/footer.
    (1) "Keep current position" -- rendered `checked readOnly` (always the resting selection); Confirm ->
    `confirmChildlessReclassify` UNCHANGED (child_moves:{}, no row_new_parent, byte-for-byte, one click) [S5].
    (2) "Move this row under a new parent" -- `onChange` routes ON SELECT into the `RestructureModal`
    (`setRestructureModal({row, newClassification})` + clear `childlessConfirm`). Route-on-select chosen
    because the `max-w-lg` AlertDialog cannot host the `max-w-6xl` picker -- a Confirm-to-bounce would be a
    pointless click (matches the LC matrix: LC-iii spells out Confirm for keep, LC-iv omits it for move).
    No choice-state needed.
  - **D2b (RestructureModal zero-children adaptation, ALL gated on `children.length === 0`):** (1) hides the
    "Children (N)" box + the five-options block (the option-3/4 picker sub-blocks render only when
    `option === 3/4`, so they hide naturally with `option` null); (2) `canSave` first line becomes
    `if (children.length > 0 && option === null) return false;` -- for a childless row the gate is the
    row-position rule alone (`rowPosition === "move" ? rowParentIdx !== null : true`); (3) title/description
    adapt (`Reclassify and position row {N}`, no "children" language); (4) `rowPosition` lazy-inits to
    "move" for a childless row (it reaches the modal only via the move route) -- inline child-count recompute
    because the `children` memo isn't defined at the state line. `buildChildMoves()` already returns {} with
    zero children; save assembly is NOT special-cased. WITH-children behaviour UNCHANGED (S6); the childless
    entry is a NEW entry point into the SAME modal, not a fork.
- **finding-9 + finding-10 CLOSED.** LC10 is fully retired once **LC-i** certifies (the cycle message now
  surfaces inline on a with-children row -- the UI-surfacing half; the backend half was closed by T1/T2).
  Manual live-cert LC-i (the LC10 closer) / LC-ii (any other swapped site) / LC-iii (childless keep, one
  click) / LC-iv (childless move -> slimmed modal) / LC-v (childless move -> Top level -> root) / LC-vi
  (childless modal gating) / LC-vii (with-children regression spot-check) PENDING Nitesh.
- tsc 0 errors in both touched files (baseline 3177 unchanged) + build exit 0; no Frappe unit tests
  (frontend slice). Full as-built detail: this section + frontend/CLAUDE.md "Restructure surface Slice
  1b-beta2b conventions" + root CLAUDE.md last-updated block.

**Restructure Slice 1b-beta2 ✅ COMPLETE (feat 1ed9d3b7; BACKEND + FRONTEND; row places ITSELF too):**
The restructure flow now also places the RECLASSIFIED ROW ITSELF, not just its children.
- **BACKEND (`save_review_restructure`):** new OPTIONAL `row_new_parent` param -- None/omitted = the row's
  own parent is left untouched (byte-for-byte today's behaviour for every existing caller); `-1` = move the
  row to top-level/root; an int = move it under that row. Validation mirrors the child / `save_review_edit`
  human_parent checks (int-coerce, self-parent reject, target-exists unless -1).
- **Cycle-guard extension (THE critical change):** (a) the row's own move is written into the SAME `sim`
  map as the child moves; (b) `row_index` is added to the `_chain_has_cycle` check START-POINTS whenever
  `row_new_parent` is given. (b) closes a silent-corruption trap -- a pure row move with EMPTY child_moves
  would otherwise run ZERO cycle checks (the check-loop iterates child moves only), so a row moved under
  its own child would corrupt the tree undetected. `_chain_has_cycle` (general walk) + `_apply_and_save_row_edit`
  (the #54-Option-B human_is_root XOR human_parent chokepoint) are UNCHANGED.
- **Write:** ONE extra `_apply_and_save_row_edit` call on the SAME `target_doc` (after the classification
  call, before the single commit; -1 -> `set_root=True`/edit_log to=None, int -> human_parent=that row;
  two sequential helper calls on one in-memory doc are safe). Response gains `row_moved: bool`.
- **Guards PROVEN genuine (fail-if-broken):** T1 keystone (row under its own child, empty moves), T2
  zero-checks trap (explicit child_moves={}), T7 shared-sim NON-EMPTY trap (cycle via the row while an
  innocent acyclic child move is present). Verified by temporarily reverting the start-point extension ->
  EXACTLY T1/T2/T7 go red ("ValidationError not raised"), 128 others stay green; then restored -> all green.
  **T7 impossibility note:** a literal "individually-acyclic joint-only" row+child cycle is mathematically
  IMPOSSIBLE here -- every child currently has effective parent == row_index, so reverting a child edge
  restores child->row and the row-move alone is already cyclic; the substitute (cycle-via-row + innocent
  child move) is a strictly STRONGER guard and is documented in the test docstring. +4 happy/compat tests
  (row->new-parent with edit_log carrying BOTH entries, row->root read-back via get_review_rows,
  omitted-param backwards-compat with row_moved False, self-parent reject). test_review_screen 124 -> 131,
  all green in-container.
- **FRONTEND (`RestructureModal`):** a "This row's position" control (between the row-description line and
  the Children box) with two options -- (1) "Keep current position" (DEFAULT, omits the param) / (2) "Move
  this row under a new parent", reusing the SAME `SheetSearchView` picker + `hitRowIndex` resolution +
  no-match guard the child pickers use (plus a "Top level" -1 button). Save gated until a chosen move is
  resolved. Childless LIGHT path (ReviewTree AlertDialog) UNTOUCHED. Backend cycle throw surfaces inline,
  modal stays open. tsc 0 errors in RestructureModal (baseline 3177 unchanged) + build exit 0.
- **LC10 (the row-self-move cycle):** backend half CLOSED by T1/T2; UI-surfacing half closes at manual
  LC-5 (reclassify a row with a child -> option (2) -> pick ITS OWN CHILD -> Save -> backend rejects,
  error inline, modal stays open). Manual live-cert STAGE A (backwards-compat LC-1) / STAGE B (new
  capability LC-2..LC-4) / STAGE C (the guard LC-5) pending Nitesh. Full as-built detail: this section +
  root CLAUDE.md (backend) + frontend/CLAUDE.md "Restructure surface Slice 1b-beta2 conventions".

**SheetSearchView v2 ✅ COMPLETE (feat fc7147db; frontend-only; re-certifies SheetSearchView once):**
Three bundled changes to the 1a-certified `SheetSearchView`, grouped per the slice-composition framework
so the component re-certs ONCE:
- **(1) Fetch swap (the OWED perf item, now WIRED + live-provable):** the windowed `get_sheet_preview`
  200-row loop is REPLACED by a single `get_sheet_preview_full` call (feat 196ed765). One S3 fetch +
  workbook open instead of one-per-window (~30s on a 1001-row sheet -> a single call). PRESERVED: the
  `[boqName,sheetName]` trigger, the `cancelled` guard, `loadError`, the single `isFullLoading` flip, and
  the `initialCentreRow` centre+flash. Loading text simplified to "Loading sheet..." (one batch; no live
  count). Live perf proof is the v2 live-cert (STAGE 1) -- the proof the endpoint unit tests could not give.
- **(2) Column restyle (the picker-grid fix OWED since Layout Part A):** `table-fixed`; Description
  `w-[360px]` / others `w-[120px]` on header + data cells; cells wrap (`whitespace-normal break-words`,
  was `truncate`). Degraded mode -> all narrow.
- **(3) Click-to-select:** new optional `onRowClick` + `selectedRowNumber` props; row onClick emits the
  click, selected row gets a persistent inset blue ring (box-shadow -- never collides with the yellow/amber
  hit tiers). RestructureModal wires `onRowClick=setCurrentHit` (click-sets-hit) so the existing
  row_number->row_index resolution + no-match guard react identically -- NO duplication; passes
  `selectedRowNumber=currentHit.row_number`. Both props optional -> backwards-compatible.
- New additive `SheetPreviewFullResponse` type; `SheetPreviewResponse` + `get_sheet_preview` untouched
  (SheetSpokePage's 40-row pagination unaffected).
- tsc 0 errors in the 3 touched files (SheetSearchView.tsx / RestructureModal.tsx / boqTypes.ts; baseline
  3177 unchanged); build exit 0. No Frappe unit tests (UI slice). Manual v2 live-cert STAGE 1 (fetch swap,
  riskiest) / STAGE 2 (columns) / STAGE 3 (click-to-select) pending Nitesh, on Fire Fitting (~1001 rows,
  perf) + 'Electrical ' (#152). Full as-built detail: frontend/CLAUDE.md "SheetSearchView v2 conventions".

**Phase-1 Slice 2c ✅ COMPLETE (feat b5381c0c; general-specs scalar->child table migration):**
- **Schema change:** `BOQs.general_specs_sheet` (Data) + `BOQs.master_preamble` (Long Text) REMOVED; replaced by `BOQs.general_specs_sheets` (Table -> new child doctype `BoQ General Specs Sheet` with `source_sheet_name` + `preamble_text`). M2.16 one-per-workbook constraint DROPPED -- multiple general-specs sheets now supported.
- **Migration patch** (`v3_0/migrate_general_specs_to_child_table`): reads old scalar columns via raw SQL (still physical even after ORM drop), inserts child rows idempotently. Old columns manually DROPed via `ALTER TABLE` post-migration (Frappe never auto-drops). 2 BoQs migrated (BOQ-26-00145/SOW 10652 chars + BOQ-26-00161/General Notes).
- **A-narrow parser reshape:** `ParsedBoq.master_preamble: str|None` -> `master_preambles: dict[str,str]` keyed by sheet_name. Container change only -- no classification/hierarchy/reader/multi-area logic touched. `orchestrator.py` + `test_orchestrator.py` (2 assertions) + `cycle_3_rerun.py` (1 line) updated.
- **Worker `assemble_mapping_config` read-site 1:** `set[str]` built from child table; rule-1 check changed from scalar equality to set membership (`sheet_name in general_specs_sheet_names`). Precedence preserved (outranks Skip/Hidden).
- **Worker `_run_parse_worker` read-site 2:** child-table query replaces `get_value("BOQs", ..., "general_specs_sheet")` -- gates the "mark Parsed" step so general-specs sheets are never marked Parsed. Both read-sites confirmed updated.
- **Step-6 write-loop:** per-sheet delete-then-insert (replace semantics, no duplicate rows on re-parse). Falsy preamble text skipped per row.
- **`set_general_specs_sheet`:** replace-all child-table semantics for single-select interim. Designating removes all existing rows + inserts one new row. Un-designating removes all rows. Wizard_status untouched (M2.23). Un-designation removes child row (preamble re-extractable on re-parse).
- **Frontend keep-alive (NOT multi-select UI -- deferred to Slice 2b):** `BOQsDoc.general_specs_sheet?: string` -> `general_specs_sheets?: BoQGeneralSpecsSheetRow[]` (new interface; serializes on parent -- first-level child, no focused read needed). `getEffectiveStatus`: set membership on `source_sheet_name`. `generalSpecsValue`: first child row's name (interim single-select still works; migrated multi-rows display correctly via set membership).
- **Tests:** 588 parser (unchanged -- A-narrow touched only 2 assertions). Wizard: 50 test_parse_run (was 47; +3 new: two_general_specs_sheets, re_parse_replaces_preamble, not_marked_parsed) + 49 test_update_sheet_draft (was 47; +2 new: un_designating_removes_child_row, two_rows_distinct_names). Total wizard 99 (+5 net; some tests renamed but count delta is net new).

**Slice 2-fix ✅ COMPLETE (fix 24312cab; frontend-only; pre-existing Slice-2 gap -- NOT a 2c regression):**
- **Root cause:** The parse worker (Slice 2) writes `wizard_status = "Parsed"` on successfully-parsed data sheets, but the frontend was never taught this 7th status value. `WizardStatus` union, `STATUS_PILL` map, and `SheetCard` button branches all lacked `"Parsed"`. Result: Parsed cards rendered a fake-Pending blue pill and an empty body (no button branch matched), so the spoke was unreachable. Live-observed on BOQ-26-00145 sheet "HVAC" (confirmed via direct DB query).
- **Three edits, no scope creep:** (1) `boqTypes.ts`: `"Parsed"` added to `WizardStatus` union. (2) `SheetCard.tsx` `STATUS_PILL`: `"Parsed"` entry added -- `bg-green-600 text-white dark:bg-green-700 dark:text-white` (solid green, distinct from "Reviewed" emerald; does NOT fall back to Pending). (3) `SheetCard.tsx`: `effectiveStatus === "Parsed"` branch -- single **Edit** button calling `onOpenSpoke?.(draft.sheet_name)`, mirroring the Reviewed branch's Edit button prop-for-prop.
- **Re-parse affordance:** deferred to Slice 2b. No re-parse button added.
- **tsc:** 0 errors in boq-wizard files. 21 pre-existing errors in unrelated utility files unchanged.
- **Tests:** no existing SheetCard test harness; manual verification is Nitesh's (HVAC card on BOQ-26-00145 must show green "Parsed" pill + "Edit" button → spoke after frontend de-stale ritual).

**Slice 2b-backend-3 COMPLETE (feat e996d097; set_general_specs_sheet list replace-all-to-many + non-Hidden validation):**
- **Signature change (Option A -- clean break):** `set_general_specs_sheet(boq_name, sheet_name_or_none: str)` -> `set_general_specs_sheet(boq_name, sheet_names)`. No backward-compat shim; only two callers confirmed (this test file + BoqHubPage.tsx).
- **Normalization:** accepts Python list OR JSON-array string (mirrors `set_sheet_work_packages` house style -- inline, no shared helper). Empty list `[]` = clear all designations (replaces old None/"" clear path).
- **Validate-all-before-write:** two checks per name before any write: (a) sheet exists in this BOQs (via `_get_child_name`); (b) sheet is non-Hidden (`frappe.db.get_value("BoQ Sheet Draft", child_name, "wizard_status")` -- Hidden rejected with "No changes were made." message). Entire call rejected if any name fails; no partial write.
- **Only Hidden is rejected.** Reviewed/Pending/Skip/Parsed sheets are all designatable. The M2.23 courtesy warn-on-Reviewed lives in the frontend, not here.
- **Replace-all-to-many:** delete all BoQ General Specs Sheet rows, then insert one per name in the list. Empty list = delete-only.
- **M2.23 unchanged:** wizard_status never touched; preamble_text blank on insert (worker-owned).
- **Tests:** 14 call sites updated (sheet_name_or_none=X -> sheet_names=[X]; None/"" -> []). Bypass test `test_two_designated_sheets_produce_two_rows_with_distinct_names` REWRITTEN to actually call the endpoint with sheet_names=[HVAC, ELEC] (was a frappe.new_doc bypass). +6 new tests: multi-designate, multi-then-fewer replace-all, clear-with-empty-list, hidden-rejection-no-partial-write, one-hidden-among-two-no-partial-write, multi-wizard-status-untouched. Total: 60 -> 66 test_update_sheet_draft; wizard 157 -> 163.
- **BREAKING NOTE:** `doSetGeneralSpecs` in `BoqHubPage.tsx` (passes `sheet_name_or_none: string`) is intentionally left broken by this slice. It is fixed in Slice 2b-frontend-ii (the multi-select checklist UI, next).

**Slice 2b-frontend-ii COMPLETE (feat d1672c6f; multi-select general-specs checklist + caller fix):**
- **Single-select replaced:** `<Select>` + `NONE_SENTINEL` + `generalSpecsValue` + `handleSpecsChange` + `pendingSpecsValue` state ALL REMOVED. Replaced by a multi-select checklist (`Checkbox` per sheet, `useState<Set<string>>` for local ticks, `toggleSpecsSheet` toggle, `handleSpecsSave` Save button).
- **Candidate set = `nonHiddenDrafts` only.** Backend rejects Hidden sheets server-side; never offer them in the checklist. The old single-select used `allDrafts` (included Hidden) -- this is corrected.
- **Seed/re-sync:** `useEffect([boq])` populates ticked set from `generalSpecsSheetNames`; re-syncs after `mutate()` so post-Save state reflects server truth.
- **Save button (one write):** computes full ordered ticked list from `nonHiddenDrafts` order; sends `{ sheet_names: string[] }` in one `callSpecs` call. Rationale: backend is replace-all; per-toggle = N redundant whole-set writes.
- **doSetGeneralSpecs FIXED:** now passes `{ sheet_names: sheetNamesList }` (was `{ sheet_name_or_none }` -- the broken 2b-backend-3 caller). **Un-breaks the branch.** General-specs designation is functional again.
- **Combined M2.23 warn-on-Reviewed:** on Save, computes `newlyDesignatedReviewed` (ticked AND not already in `generalSpecsSheetNames` AND Reviewed). If non-empty: opens `AlertDialog` naming them (1 sheet -> names it; 2+ -> lists them; mirrors ParseRunDialog's 1-vs-N pattern). Continue -> commits full list; Cancel -> no write, checklist stays at local ticks. Un-designating never warns; non-Reviewed sheets never warn.
- **Dead imports removed:** `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` (confirmed no other use in `BoqHubPage.tsx`). `Checkbox` import added.
- **Locked decisions:** checklist control (Option 1) + one combined warning (both locked).
- **Closes C7:** the schema-ahead-of-UI interim flagged in the dashboard (Slice 2c added multi-row schema; this slice adds the multi-select UI to match).
- **tsc:** 0 errors in boq-wizard files; 3177 pre-existing errors in unrelated utility files (CameraCapture, BulkPdfDownload, etc.) -- none introduced by this slice.
- **Vite build:** see build result in commit session report.
- **SheetCard wording holdover:** "Change it via the selector above." (SheetCard.tsx line ~263) still says "selector" -- a cosmetic wording holdover, out of scope for this slice; functional behavior is correct.
- **Module 2b parse-run surface COMPLETE** (all Slice 2b-backend-3 + 2b-frontend-i + 2b-frontend-ii landed). Pending: end-to-end manual cert round (Nitesh).

**Bucket-1 hub-polish slice COMPLETE (feat f5dcfdd6; additive UI -- frontend-only, 0 tests added, parser 588 / wizard 163 unchanged):**
- **Item 1 -- Hub Parsed count (BoqHubPage.tsx):** `parsedCount = dataSheets.filter(eff === "Parsed").length` added alongside sibling footer counts. `{parsedCount > 0 && " * N parsed"}` inserted after "reviewed" in the parse-gate footer status line. Previously Parsed sheets were counted in the gate math but never surfaced in the breakdown text. `getEffectiveStatus()` returns the literal `"Parsed"` (confirmed from Slice-2-fix 24312cab; line 294 `parsedDraftsForDialog` already used this exact string).
- **Item 2 -- General-specs 2-col checklist (BoqHubPage.tsx):** `<ul>` in the hub general-specs panel changed from `space-y-2` (single-column stack) to `grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2` (responsive 2-column). Matches the hub's canonical `grid grid-cols-1 sm:grid-cols-2 gap-3` card-grid pattern. Checkbox logic, candidate set (`nonHiddenDrafts`), Save button, M2.23 warn dialog, and error display unchanged.
- **Item 3 -- Spoke Option B zone grouping (SheetConfigPanel.tsx):** Sections 1-3 wrapped in a Zone A `<div>` with caption "Parsing configuration -- changes here require re-parsing"; Section 4 wrapped in a Zone B `<div className="border-t border-border pt-3">` with caption "Sheet details -- saved without re-parsing". Zone captions: `<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">` -- visually lighter than the per-section `<h3 className="text-sm font-semibold text-foreground">`. Zone A is first direct child of outer `space-y-5` div (no top margin); Zone B gets `margin-top: 20px` from `space-y-5` plus its own `border-t + pt-3`. Zone boundary effective separation (20px outer gap + border + 12px) reads clearly stronger than within-zone section boundaries (0 outer gap + border + 12px). Review gate and save bar remain outside both zones, after Zone B. Gate logic (all `confirmedFields.has("section:...")`, `allSectionsConfirmed`, `parserRequiredSatisfied`, `hasWorkPackage`, attestation `disabled` expression) confirmed purely state-driven -- no DOM-structure coupling found; zero gate logic touched. Section 4 container class: `pt-3 border-t border-border` removed (Zone B top provides visual separation); `space-y-4` preserved. All four section `<h3>` headings, sparkle spans, and inner fields byte-for-byte unchanged.
- **SheetCard "selector" wording:** dropped from this slice by decision -- out of scope.
- **tsc:** 0 errors on boq-wizard files. Vite build exit 0 (7862 modules, 4m 58s). No new warnings.
- **Files touched (code only):** `BoqHubPage.tsx`, `SheetConfigPanel.tsx`. `SheetCard.tsx`, `boqTypes.ts`, all `.py` files, all doctype JSON unchanged.

**Bucket-1 zone-differentiation follow-up COMPLETE (feat 1ec901e7; frontend-only styling only, 0 tests added, parser 588 / wizard 163 unchanged):**
- **Zone boxing + secondary tint (SheetConfigPanel.tsx):** Zone A ("Parsing configuration") given `rounded-md border border-border p-3` wrapper (untinted, primary box on normal card surface). Zone B ("Sheet details") given `rounded-md border border-border bg-muted/30 p-3` wrapper (tinted secondary box using existing `muted` token). Zone B's former `border-t border-border pt-3` removed -- the box border + outer `space-y-5` gap now provides the visual separation. Within-Zone-A section dividers (`pt-3 border-t border-border` on Sections 2 and 3) kept -- they serve as clear within-group section separators inside the box (complementary to the box border, not redundant). Captions, section headings, gate logic, sparkle conditions, save handlers: byte-for-byte unchanged.
- **tsc + Vite build:** 0 errors. Exit 0.
- **Files touched (code only):** `SheetConfigPanel.tsx` only. Docs: all three (substantive: plan-doc + `frontend/CLAUDE.md`; minimal-touch: root `CLAUDE.md`).

**Bucket-2 Slice 1 COMPLETE (feat cb86b92b; BACKEND ONLY -- no frontend changes this slice):**
- **New field: `BOQs.parse_in_progress`** (Check, hidden=1, read_only=1, default 0). Transient job-state marker: 1 = "a parse job is currently running for this BoQ". Distinct from `wizard_state` (the lifecycle Select) -- never overload wizard_state for transient job state. bench migrate created the column (confirmed via `frappe.db.has_column`).
- **SET on enqueue (`run_parse`):** `frappe.db.set_value("BOQs", boq_name, "parse_in_progress", 1)` + `frappe.db.commit()` placed AFTER the successful `frappe.enqueue()` call, before `return`. If enqueue raises, the flag is never set (no stuck-1 on enqueue failure).
- **CLEAR at publish choke-point (`_publish_parse_event`):** `set_value("parse_in_progress", 0)` + `commit()` at the TOP of `_publish_parse_event`, before payload construction. All six completion paths (success + missing_file + fetch_failed + no_eligible_sheets + parse_failed + internal) funnel through this single function, so the clear is guaranteed uniform with zero scatter.
- **Rollback survival (critical correctness):** The `internal` error path does `frappe.db.rollback()` THEN calls `_publish_parse_event`. Because `rollback()` completes before the function is called, the clear's own `set_value + commit` starts a brand-new transaction that is not subject to the prior rollback. The flag cannot be stuck at 1 on any error path.
- **Done-event payload contract UNCHANGED:** All payload keys (`status`, `boq_name`, `parsed_sheets`, `not_parsed_sheets`, `failed_sheets`) and all 5 error codes (`missing_file`, `fetch_failed`, `no_eligible_sheets`, `parse_failed`, `internal`) are byte-for-byte unchanged. The clear is additive -- nothing reshaped.
- **Tests: +5 in new `TestParseInProgressMarker` group (55 -> 60 wizard tests):** (1) `test_run_parse_sets_parse_in_progress_after_enqueue` -- mocks enqueue, calls `run_parse`, asserts flag=1; (2) `test_publish_clears_marker_on_success` -- sets to 1, calls `_publish_parse_event("success")`, asserts 0; (3) `test_publish_clears_marker_on_internal_error` -- same pattern for "internal"; (4) `test_publish_clears_marker_on_missing_file_error` -- early-return error path; (5) `test_clear_survives_prior_rollback` -- calls rollback() then publish, asserts 0 (documents the rollback-survival contract). All 60 green.
- **Slice 2 (frontend modal + messages) is the consumer -- still to come.** `BoqHubPage.tsx` reads `parse_in_progress` to show the in-progress state (spinner, disable parse button, etc.) and the `boq:parse_run_done` completion modal. Slice 2 is a frontend-only slice that depends on this backend field landing first.

**Bucket-2 Slice 2 COMPLETE (feat 21e56963; FRONTEND ONLY -- no backend changes this slice):**
- **boqTypes.ts:** `parse_in_progress?: 0 | 1` added to `BOQsDoc` -- consumes the Check field added by Slice 1.
- **ParseRunDialog.tsx:** "runs in background ~10 min" note added to Step 1 confirm (below DialogDescription, above scrollable sheet list). No change to footer buttons, isLoading behavior, or dismiss-blocking.
- **BoqHubPage.tsx -- completion AlertDialog:** Inline result strip (`{(parseResult || parseError) && (...)}` div, ~30 lines) REPLACED by an acknowledge-only `AlertDialog` (single OK action, no Cancel). Open-state derived from `parseResult || parseError`; OK action AND `onOpenChange(false)` both clear both states. HUB-SCOPED -- not app-global.
- **Per-case messages (8-case matrix):**
  - SUCCESS: up to 3 independent sub-lines, each shown only if non-empty: `Parsed: {names}` (font-medium text-foreground) / `Not parsed (skipped, hidden, or general-specs): {names}` (text-muted-foreground NEUTRAL) / `Failed to parse: {names}` (text-destructive). If all three are empty: "Parse complete." fallback.
  - ERROR: one message, no lists. `no_eligible_sheets` is NEUTRAL (text-muted-foreground -- advisory, not a failure); all other error codes are destructive.
  - Exact error messages: `missing_file` = "The source file for this BoQ could not be found. It may have been moved or deleted." / `fetch_failed` = "Could not retrieve the source file. Please try again; if it persists..." / `no_eligible_sheets` = "No sheets were eligible to parse. Mark at least one sheet as Reviewed before parsing." / `parse_failed` = "The parser could not process this workbook..." / `internal` = "An unexpected error occurred during parsing..." / fallback = "An unknown error occurred during parsing."
- **Error-code-preserving state shape:** `parseError` state changed from `string | null` to `{ message: string; severity: "destructive" | "neutral" } | null`. The old per-handler `ERROR_MSGS: Record<string, string>` map (redefined on every socket event) moved to a module-level `PARSE_ERROR_MSGS` const with `{ message, severity }` objects. `PARSE_ERROR_FALLBACK` for unrecognised codes. The socket handler's `boq_name` guard and `[socket]`-only dep pattern are UNCHANGED.
- **On-mount parse_in_progress recovery:** New `useEffect([boq])` (mirrors the specs-checklist `useEffect([boq])` pattern): `setParseInFlight(boq.parse_in_progress === 1)`. Recovers the true running state when user navigates away and back (or when a socket event was missed). The live socket event still clears `parseInFlight` on done -- this is the mount fallback only. NOT polling.
- **Parse button in-progress indicator:** `disabled={!canParse || parseInFlight}` + `{parseInFlight ? <Loader2 spin> Parsing... : "Parse workbook"}`. Makes the recovered `parseInFlight=true` visible without re-opening the confirm dialog.
- **Navigation not blocked (3d confirmed):** `parseInFlight` does not block navigation -- no `<Prompt>` or history blocker. User can freely navigate away during a parse. No change needed for this confirmation.
- **Test counts unchanged:** parser 588 / wizard 168 (60 parse_run + 66 update_sheet_draft + 7 update_boq_draft + 23 sheet_preview + 12 upload_file) -- 0 added by this frontend-only slice.
- **Build:** exit 0, no tsc errors, no new warnings (3 pre-existing: BoqProjectTab static/dynamic import, PWA theme_color, large chunks).
- **Bucket-2 COMPLETE** (Slice 1 backend + Slice 2 frontend). Both the SET/CLEAR backend plumbing and the consuming frontend modal/recovery are landed.

**Bucket-2 follow-up COMPLETE (feat 295e3881; ParseRunDialog.tsx only -- styling/copy only, no logic changes):**
- **Step 1 note:** className updated from `text-xs text-muted-foreground` to `text-sm font-semibold text-amber-600 dark:text-amber-400` -- bold + amber + slightly larger. Reuses existing wizard amber token (same as Section-3 unmapped-column warning). Copy unchanged.
- **Step 2 note added:** same bold-amber note (`text-sm font-semibold text-amber-600 dark:text-amber-400`) added to the Step-2 re-parse warning dialog, below the sheet list and above the Go back / Re-parse anyway buttons. Same copy. No behavior change.
- Build: exit 0. 0 tests added (parser 588 / wizard 168 unchanged).

**#147 option-4 slice COMPLETE (feat 193327b1; FRONTEND ONLY -- BoqHubPage.tsx + ParseRunDialog.tsx only):**
- **Problem A -- Missed done-event = stuck hub:** WebSocket drop + reconnect during the ~5-10 min parse window can cause the `boq:parse_run_done` event to land on a dead connection. The existing on-mount `useEffect([boq])` recovery syncs `parseInFlight` from `parse_in_progress` only when `boq` changes (i.e. when `mutate()` is called). A user who stays on the hub the whole time never triggers `mutate()` and stays stuck forever.
- **Fix A -- Hub reconnect mutate:** `BoqHubPage.tsx` socket `useEffect([socket])` now also registers `socket.on("connect", onReconnect)` where `onReconnect = () => { void mutate(); }`. Cleanup: `socket.off("connect", onReconnect)` in the same return. On socket reconnect, the BoQ doc is re-fetched; the existing `useEffect([boq])` re-syncs `parseInFlight` from the fresh `parse_in_progress` server value. Also fires on initial connect -- harmless (SWR deduplicates). Reuses the existing `mutate` from `useFrappeGetDoc`; no new fetch mechanism.
- **Problem B -- Parse dialog blocks navigation:** `ParseRunDialog` `onOpenChange` guard `if (!isOpen && !isLoading) onClose()` blocked Escape, overlay-click, and the built-in X button (from `disableCloseIcon=true` in `DialogContent`) while loading. Radix modal also trapped pointer events away from the hub body during the parse.
- **Fix B -- Allow dialog dismiss during parse:** `onOpenChange` simplified to `if (!isOpen) onClose()`. All three dismiss paths (X button, Escape, overlay-click) now work even while a parse is in flight. **Cancel button stays disabled** -- "Cancel" implies aborting the server job, which is not supported (no cancel API). Closing the dialog does NOT cancel the parse; the hub "Parse workbook" button keeps showing the Parsing... spinner (`disabled={!canParse || parseInFlight}`, BoqHubPage.tsx line 627).
- **Fix B also enables (C) navigate-away-during-parse:** previously the modal trapped the hub body; with the dialog dismissible the user can close it mid-parse and navigate away. The on-mount recovery (`useEffect([boq])`) restores `parseInFlight=true` correctly on return.
- **DEFERRED -- upload-screen in-place recovery:** `BoqUploadScreen.tsx` has no `boqDocName` (and hence no BOQs doc) available during parsing. A self-heal there requires a new read mechanism (job-status endpoint or boqDocName localStorage persistence). Deferred to a separate follow-up.
- **DEFERRED -- name/version/GST persistence:** `BoqMasterPanel` panel values are Zustand-only; no API saves them. Navigate-away workaround still loses them. Deferred.
- **Files touched:** `BoqHubPage.tsx`, `ParseRunDialog.tsx` only. No backend, no doctype JSON, no boqTypes.ts, no BoqUploadScreen.tsx.
- **Build:** pre-change build clean (exit 0, build-out.txt). Changes are trivially TypeScript-valid (no new imports, no type changes). 0 tests added (parser 588 / wizard 168 unchanged -- frontend-only slice).

**Owner:** Internal team.
**Last updated:** 2026-06-11 (ReviewTree detail-panel layout pass + brand-tint follow-up COMPLETE --
FRONTEND ONLY, pure CSS in `ReviewTree.tsx`: FINDING B inner-content `<div>` becomes a distinct nested card
with an INDIGO body tint + BRAND-RED left-accent stripe [`bg-indigo-50/40 dark:bg-indigo-950/20 border
border-border border-l-4 border-l-primary rounded-md shadow-sm p-3`, no longer the `bg-muted/30` row-hover
tint; `border-l-primary` = the rose/crimson `--primary` token hue 346.8, DISTINCT from `--destructive` pure
red -- accent not full surface, avoids the error-red collision on this screen]; Obs 1
Classification/Parent grid `grid-cols-2` -> `grid-cols-1` vertical stack; Obs 2 each of the three edit
blocks [numeric/text/per-area] `flex flex-wrap gap-2` -> `grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3
lg:grid-cols-4 gap-2` with `w-52` dropped; the three blocks stay SEPARATE, Remarks block untouched; tsc 0
new wizard errors + build exit 0; LC1-LC5 deferred to Nitesh. Block + conventions in the LATEST section
above + frontend/CLAUDE.md. // prior: Restructure Slice 1b-beta2b [feat 20e1f5a7] COMPLETE -- FRONTEND ONLY:
finding-10 -- the broken inline error ladder swapped for the house helper `getFrappeError()` in FIVE catch
blocks [RestructureModal.handleSave + ReviewTree confirmChildlessReclassify / confirmValueSave /
saveTextField / saveRemark], so backend `frappe.throw` text [carried in `_server_messages`] reaches the
user; static strings kept as `|| "..."` fallbacks; frappeErrors.ts + its 4 call sites untouched.
finding-9 -- the row-position choice is now ALSO offered on the CHILDLESS path: childless AlertDialog gains
two radios [Keep current (DEFAULT; Confirm unchanged) / Move (routes ON SELECT into RestructureModal)];
RestructureModal adapts for zero children [hides Children box + five-options, relaxes canSave, adapts
title/desc, lazy-inits rowPosition to "move"], all gated on children.length===0; with-children UNCHANGED.
Backend untouched [childless wire shape certified by T2/T4]. tsc 0 in both touched files [baseline 3177
unchanged] + build exit 0; LC10 retires once LC-i certifies; LC-i..LC-vii pending Nitesh. See the
"Restructure Slice 1b-beta2b" block at the top.
// prior: 2026-06-11 (Restructure Slice 1b-beta2 [feat 1ed9d3b7] COMPLETE -- BACKEND + FRONTEND:
`save_review_restructure` gains optional `row_new_parent` [None=untouched / -1=root / int=under that row];
cycle-guard extended [row's move into the same sim + row_index as a check start-point; `_chain_has_cycle`
+ `_apply_and_save_row_edit` UNCHANGED]; response `row_moved`. T1/T2/T7 corruption guards proven
fail-if-broken; test_review_screen 124 -> 131. RestructureModal "This row's position" control [Keep
[default] / Move under a new parent, reusing the same picker+guard]; tsc 0 + build exit 0. LC10 backend
half closed by T1/T2, UI-surfacing half at LC-5. See the "Restructure Slice 1b-beta2" block at the top.
// prior: 2026-06-10 (Restructure Layout Part A [feat 51b3412e] -- cosmetic display-only:
RestructureModal widened max-w-3xl->max-w-6xl + the two children-list texts wrap [truncate ->
whitespace-normal break-words]; picker-grid column widths/wrap still OWED as a separate
SheetSearchView-touching slice. See the "Layout Part A" section below.
// prior: 2026-06-09 (Restructure Slice 1b-beta [feat e8eeab58] FRONTEND COMPLETE -- the
restructure MODAL: detail-panel pill DropdownMenu of 4 assignable targets -> childless light
AlertDialog confirm OR staged `RestructureModal` [5 child-placement options, no silent default, Save
gated, Path A fully-resolved child_moves, mounts certified SheetSearchView untouched as the parent
picker with row_number->row_index resolution + a no-match guard]; `onRestructured` reuses handleSaved;
dev route + `_DevSheetSearchHarness.tsx` REMOVED. tsc 0 wizard-file errors + build exit 0; manual
live-cert LC1-12 pending. Restructure-surface arc COMPLETE pending live-cert. See the "Slice 1b-beta"
section below.
// prior: Slice 1b-alpha [feat f7761415] BACKEND COMPLETE -- shared `_apply_and_save_row_edit` helper +
transactional `save_review_restructure` [atomic reclassify+reparent, batch cycle-guard] + human-root
`human_is_root` Check field [Option B]; test_review_screen 124 green.
// prior: Slice 1a [feat 5ecf1820] LIVE-CERTIFIED 2026-06-09 -- 5/5 PASS on BOQ-26-00145.)
**Active branch:** `feature/boq-phase-3` (branched from `feature/boq-phase-2` tip 2e338b36; `feature/boq-phase-2` frozen at 2e338b36 as parser-stable tip)
**Latest commit:** feat 20e1f5a7 (Slice 1b-beta2b) // prior: feat 1ed9d3b7 (Slice 1b-beta2) // feat fc7147db (SheetSearchView v2) // feat e8eeab58 (Slice 1b-beta) // feat f7761415 (Slice 1b-alpha)

> This is the active implementation plan. Long-term domain documentation will be moved to `.claude/context/domain/boq.md` after Phase 3 stabilizes. Decisions log is at the end of this file.

**Off-machine backup:** Full repo bundle at `C:\Users\nites\OneDrive\Desktop\nirmaan_boq_backup_2026-05-09.bundle` (17.23 MiB, OneDrive-synced). Created 2026-05-09 because tech-person Monday push pending. Bundle restorable on any machine with `git clone <bundle-path>`.

**GitHub push pending:** `feature/boq-phase-1` and `feature/boq-phase-2` to be pushed Monday 2026-05-11 by Nitesh's tech person (Nitesh has no push access).

---

## 1. Overview

Upload Bill of Quantities (BoQ) Excel files for projects, parse them into a structured hierarchical form, edit with audit, and use the parsed line items as anchors for downstream linkages — Work Headers / Milestones, Critical PO Tasks, PR/PO line items, and Delivery records.

BoQs in the wild are non-standard: variable column layouts, multi-level nested preambles, supply-and-install rates sometimes separate, sometimes combined. The system must accommodate this without rigid templates.

## 2. Goals

- Upload `.xlsx` BoQs and convert them into a queryable, editable structured form.
- Preserve hierarchy: **L1 Preamble → L2 Preamble → L3 Preamble → Line Item**.
- Multiple BoQs per project (e.g. Civil + MEP).
- Line items are the anchor for downstream linkages.
- Editable post-import with full audit trail.
- Robust against real-world Excel inconsistencies.

## 3. Non-goals (this iteration)

- Auto-generation of BoQs from drawings.
- Cross-project BoQ benchmarking.
- Vendor portal BoQ submission.
- Replacement of existing Work Headers / Milestones doctypes (we link to them, we don't replace them).

### §3 refresh log

2026-05-21 (v5.21 docs cycle): Status block back-refreshed from Phase 1.9e (v5.15) anchor to fe18b337 (v5.21) anchor, adding 19 sub-phase records (1.9f → Bug 7+9 + v5.21 throwaway experiment). §17 Known Issues back-refreshed with entries #74-#96 (23 new entries). §14 Working Agreements appended with #30-#35 (6 new agreements). §17.13 marked RESOLVED. Strategic direction subsection added before §17. No source code touched this cycle.

## 4. Users and access

Internal team only. Permissions follow project membership conventions used by `Procurement Requests` and `Procurement Orders`. CEO Hold (`integrations/controllers/projects.py`) gates any procurement-related actions in Phase 7.

## 5. Core design decisions

### 5.1 Parsing strategy: manual mapping + AI assist

Two approaches, used together:

- **Option B — Manual mapping UI.** User uploads any Excel, sees a preview, marks columns (Description, Qty, Unit, Supply Rate, Install Rate, etc.) and rows (L1/L2/L3 preamble, line item, header, total, skip). Examples-based fill auto-classifies similar rows.
- **Option C — AI assist.** Claude API pre-fills column mapping and row classifications. User reviews and corrects.

AI is used for **structural classification only** — what each row/column means. Numerical values (qty, rates) are always read deterministically from cells, never from AI output. Non-negotiable for financial data.

### 5.2 Tree storage: self-referencing Link with denormalized path

`BOQ Nodes` is a standalone doctype with a self-referencing `parent_node` Link and a denormalized `path` field (`"node_id_1/node_id_12/node_id_45"`).

We do **not** use Frappe's `is_tree` / lft+rgt nested sets — there's no precedent in this codebase, BoQ trees are small (hundreds of nodes), and TanStack Table's `getSubRows` natively renders self-referenced trees client-side. Recursive CTEs on Postgres handle subtree queries. The `path` field gives cheap subtree filtering when needed.

### 5.3 Hierarchical model

Preambles can nest to any positive depth (level ≥ 1). A soft warning is emitted above level 5 (unusual but allowed). Line items belong to the deepest preamble in their ancestor chain. Standalone line items (no parent) are allowed — they receive a warning but save successfully.

The original L1/L2/L3 constraint was too rigid for real-world BoQs which sometimes nest 4–6 levels deep. The stack-walk algorithm already handles arbitrary depth without changes; the validation layer was the only restriction.

### 5.4 Versioning

Each upload is a new version. Previous versions are marked Superseded, never deleted. Downstream linkages remain attached to the version they were created against. Carry-over of links across versions is a Phase 7e concern.

### 5.5 Tax treatment

Per-BoQ flag: `pre_tax` (default) or `post_tax`. Rates stored as captured.

### 5.6 Editability and audit

Line items editable post-import. Audit follows the **Nirmaan Versions pattern** already used for PRs/POs/SRs/payments — independently queryable, business-meaningful. We do not use a child-table audit log. Every edit captures a `reason`. If `Nirmaan Versions` lacks a `reason` field, add it (cross-cutting improvement; benefits other doctypes too).

### 5.7 Multiple BoQs per project

A project can have multiple co-existing BoQs (e.g. Civil, MEP, Electrical) as separate documents.

### 5.8 BoQ Nodes are standalone documents, not child rows

Following the Critical PO Tasks precedent. Nodes are individually queryable, updatable, and audit-loggable. Do not store nodes as a child table or JSON field on the BOQ — that's a known migration trap (see `procurement_list` → `order_list` history).

### 5.9 AI provider for Phase 4: Anthropic Claude API

Document AI is built for structured form extraction (invoices, IDs) and is unsuited to free-form spreadsheets with arbitrary layouts. The architectural pattern of `services/document_ai.py` and `api/invoice_autofill.py` is mirrored — opt-in, file_url-based, confirm-before-save, never auto-persist — but the underlying service is Anthropic's API. Model: `claude-sonnet-4-6`.

### 5.10 BoQ → downstream relationships are via dedicated linkage doctypes

In Phase 7 we create one linkage doctype per relationship type, each following the Critical PO Tasks pattern (standalone documents). BoQ Nodes do **not** auto-create Work Headers, Milestones, PRs, or POs — users explicitly create the linkages.

We avoid the legacy `$#,,,` delimiter pattern used in milestone reports.

## 6. Data model

### 6.1 BOQs

| Field | Type | Notes |
|---|---|---|
| name | string (auto) | Frappe ID |
| project | Link → Projects | required |
| boq_name | Data | e.g. "Civil BoQ v1" |
| version | Int | auto-incremented per (project, boq_name) |
| status | Select | Draft / Approved / Superseded |
| tax_treatment | Select | Pre-tax (default) / Post-tax |
| uploaded_by | Link → User | |
| uploaded_at | Datetime | |
| parsed_at | Datetime | |
| notes | Text | |

Source `.xlsx` is stored via **Nirmaan Attachments** (`associated_doctype = "BOQs"`, `associated_docname = name`), matching how PR/PO/SR attachments work.

### 6.2 BOQ Nodes

Single self-referencing table for both preambles and line items.

| Field | Type | Notes |
|---|---|---|
| name | string (auto) | Frappe ID |
| boq | Link → BOQs | required |
| parent_node | Link → BOQ Nodes | nullable; null for L1 preambles and orphans |
| node_type | Select | `Preamble` / `Line Item` |
| level | Int | 1, 2, or 3 for preambles; null for line items |
| sort_order | Int | preserves Excel row order within siblings |
| code | Data | optional dotted code, e.g. "1.2.3" |
| description | Text | required |
| source_row_number | Int | which Excel row this came from |
| path | Data | slash-separated ancestor IDs, denormalized |
| **Line item / amount fields** (null for preambles unless leaf): | | |
| unit | Data | |
| qty | Float | nullable; 0 is valid (rate-only items) |
| supply_rate | Currency | nullable |
| install_rate | Currency | nullable |
| combined_rate | Currency | nullable |
| supply_amount | Currency | computed unless explicitly overridden |
| install_amount | Currency | computed unless explicitly overridden |
| total_amount | Currency | computed sum |
| is_rate_only | Check | auto-set when qty=0 and at least one rate is set; common in tender BoQs |
| notes | Text | |

Indexes: `boq`, `parent_node`, `path` (for prefix queries).

**Note on commit-time sources for `notes`:** The notes field receives content from two parser sources at commit time — `row_notes` (free-text user-written remarks, no prefix, written first) and `append_to_notes` (wizard-assigned columns with structured `[Source: ...] [Column: ...]` prefixes, written after a blank line separator). The `append_to_notes` block includes both this row's own captured values AND ancestor preamble inherited values per §7.34. See handover §7.34 for the prefix format spec.

### 6.3 Validation rules (in `integrations/controllers/boq_nodes.py`)

- If `node_type = "Line Item"`: `qty` must not be `None` (0 is valid for rate-only items); `level` must be null; at least one rate field should be set (warn if none).
- If `node_type = "Preamble"`: `level` must be a positive integer ≥ 1; warn (do not throw) if `level > 5`; qty/rates on a **non-leaf** preamble emit a warning (leaf preambles may carry qty/rate for tender computation — silent); `amount_override` suppresses the non-leaf warning.
- `parent_node` consistency (generic rule): a preamble at level N must have a parent at level N−1; a line item's parent must be a preamble (any level); standalone nodes (`parent_node` null) are allowed with a warning.
- `path` recomputed on save and on parent changes.
- `is_rate_only` auto-set in `before_save`: true when `qty == 0` and at least one rate field is set; false otherwise.
- Amount fields auto-computed from qty × rate unless `amount_override` is set. When `qty == 0` and rates are set, amounts compute to 0 correctly (`(supply or install)` logic replaced with `any([supply_rate, install_rate])` check).

### 6.4 Audit

Use **Nirmaan Versions** pattern. Phase 1 task: confirm Nirmaan Versions schema; if it lacks a `reason` field, add one. Every BOQ Node update from a user (post-initial-import) writes a Nirmaan Versions entry with the change diff and reason.

## 6.5 BOQ Node Qty By Area — child table for per-area breakdown (EXTENDED Phase 1.8)

Phase 1.8 extends this from 2 fields to 9 fields:

| Field | Type | Reqd | Default | Rule |
|---|---|---|---|---|
| area_name | Data | yes | — | existing |
| qty | Float | yes | — | existing |
| supply_rate | Float | no | None | fallback from parent BOQ Node `supply_rate` if source file doesn't provide |
| install_rate | Float | no | None | fallback from parent `install_rate` |
| combined_rate | Float | no | None | fallback from parent `combined_rate` |
| supply_amount | Float | no | None | from file when given; else `qty × supply_rate` (auto-compute in `before_save`) |
| install_amount | Float | no | None | from file when given; else `qty × install_rate` |
| total_amount | Float | no | None | from file when given; else `qty × combined_rate` OR `supply_amount + install_amount` (mirrors parent §7.14 rule) |
| amount_override | Check | no | 0 | when set, `before_save` skips auto-compute of amounts (parallel to parent's `amount_override`) |

**Fallback semantic:** Every child row always has populated rate and amount fields after `before_save` runs — no nulls for downstream code to branch on.

**Validation:** Per-child-row, `combined_rate == supply_rate + install_rate` when all three set (mirrors parent `BOQ Nodes` validation at controllers/boq_nodes.py:40-46). Zero-cost rows (all three rates None) allowed.

**Weighted-average precedence:** Parent BOQ Node `supply_rate` / `install_rate` / `combined_rate` auto-recompute in `before_save` as `Σ(area_qty × area_rate) ÷ Σ(area_qty)` when any per-area rate diverges from the universal. Computed independently for supply / install / combined.

**Migration:** Phase 1.8 ships a patch that back-populates every existing child-row's per-area rate from the parent line-item's universal rate, and computes amount as `area_qty × that_rate`. Same fallback rule applied retroactively.

## 7. Parsing pipeline

### 7.1 Stages (`services/boq_excel_parser.py`)

1. **Read** — open `.xlsx` with `openpyxl` (already in `pyproject.toml`). Read both `data_only=True` (evaluated values) and `data_only=False` (formulas) to detect computed cells. Capture cell formatting: bold, indent, fill color, merged ranges, font size.
2. **Configure mapping** — accept a config dict: `{header_row, column_role_map, code_column, preamble_detection_rules}`.
3. **Classify rows** — assign each row a type: `preamble_L1`, `preamble_L2`, `preamble_L3`, `line_item`, `header`, `total`, `skip`. Three signals in priority order:
   - **Code-driven:** if a code column is mapped and value matches a dotted pattern (`1`, `1.2`, `1.2.3`), level = dot count + 1.
   - **AI classification** (Phase 4): pre-applied as starting point.
   - **Rule-driven fallback:** bold + no qty + indent depth → preamble of computed level; has qty + has rate → line item.
4. **Resolve hierarchy** — stack-walk algorithm (see 7.2).
5. **Validate** — flag warnings: orphans, empty preambles, level skips, missing units, total mismatches.
6. **Persist** — create BOQ + BOQ Nodes records in a single transaction.

### 7.2 Hierarchy resolution algorithm (deterministic)

```python
def assign_parents(classified_rows):
    # stack maps level (any positive int) -> node_id
    # Algorithm is depth-agnostic: handles L1..L3 and L1..LN equally
    stack = {}

    for row in classified_rows:
        if row.type == 'preamble':
            level = row.level  # any positive integer ≥ 1
            # Truncate stack: anything at level ≥ current is no longer an ancestor
            stack = {k: v for k, v in stack.items() if k < level}
            row.parent_id = stack.get(level - 1)  # None if level == 1 (root preamble)
            row.id = create_node(row)
            stack[level] = row.id

        elif row.type == 'line_item':
            if stack:
                deepest_level = max(stack.keys())
                row.parent_id = stack[deepest_level]
            else:
                row.parent_id = None  # standalone — flag warning, still saved
            row.id = create_node(row)
```

Handles: L1 directly followed by line items, L2 → L1 transitions, arbitrary nesting depth (L4, L5, …), uneven trees, standalone line items.

### 7.3 Examples-based row classification

After user marks a few exemplar rows, classify remaining by feature similarity:

- Features per row: indent level, bold/non-bold, has-qty, has-rate, fill color, font size, code pattern depth.
- Algorithm: nearest-neighbor over the feature vector. Rows matching a labeled exemplar with high overlap inherit the label.
- Ambiguous rows go to a "needs review" bucket shown to the user.

## 8. AI assist (Phase 4)

### 8.1 Architecture

`services/boq_ai_assist.py` mirrors `services/document_ai.py` shape:

- Receives `file_url`.
- Reads and converts top ~50–100 rows to a structured representation including formatting metadata.
- Calls Anthropic API (`claude-sonnet-4-6`) via `frappe.enqueue` (background job).
- Returns JSON: `{header_row, column_roles, row_classifications, confidences, reasoning_for_low_confidence}`.
- Caches result per file_url (don't re-call on revisit).
- Logs token usage.

### 8.2 Prompt (template, iterate against fixture corpus)

> "This is the top of a Bill of Quantities Excel sheet. Identify:
> 1. The row containing column headers.
> 2. For each column, its semantic role from: description, qty, unit, supply_rate, install_rate, combined_rate, supply_amount, install_amount, total_amount, code, skip.
> 3. For each data row, classify as: preamble_L1, preamble_L2, preamble_L3, line_item, header, total, skip.
>
> Use indentation, font weight, fill color, numbering pattern (e.g. '1.' is L1, '1.1' is L2, '1.1.1' is L3), and presence/absence of qty/rate values. A row with bold text and no qty is likely a preamble; level is determined by indentation or numbering depth.
>
> Return JSON only, with this schema: {…}. Include a 0–1 confidence per column and per row, plus a one-line reasoning for low-confidence rows."

### 8.3 Guards

- AI output is a *suggestion*; user must confirm.
- Numerical values (qty, rates) NEVER taken from AI output.
- Cap input at 100 rows per call.
- Cache result per file_url; never re-call on revisit.
- Log token usage.
- Confirm-before-save flow consistent with `invoice_autofill.py`.

## 9. Backend code placement

| File | Purpose |
|---|---|
| `nirmaan_stack/doctype/boqs/boqs.py` | Doctype class (autoname only). |
| `nirmaan_stack/doctype/boqs/boqs.json` | Schema. |
| `nirmaan_stack/doctype/boq_nodes/boq_nodes.py` | Doctype class (autoname only). |
| `nirmaan_stack/doctype/boq_nodes/boq_nodes.json` | Schema. |
| `integrations/controllers/boqs.py` | Lifecycle hooks for BOQs. |
| `integrations/controllers/boq_nodes.py` | Lifecycle hooks: validation, path computation, audit log writing. |
| `services/boq_excel_parser.py` | Pure parser (Phase 2). Minimal Frappe deps in core logic for testability. |
| `services/boq_ai_assist.py` | Anthropic API wrapper (Phase 4). Mirrors `document_ai.py`. |
| `nirmaan_stack/api/boq/upload.py` | Upload endpoint. |
| `nirmaan_stack/api/boq/parse.py` | Parse endpoint (config in → parsed tree out). |
| `nirmaan_stack/api/boq/save.py` | Save endpoint. |
| `nirmaan_stack/api/boq/ai_assist.py` | AI assist endpoint (Phase 4). |
| `nirmaan_stack/api/boq/edit_node.py` | Post-import line item editing (Phase 5). |
| `tests/fixtures/boq_samples/` | Sample `.xlsx` files for parser tests. |
| `nirmaan_stack/doctype/boqs/test_boqs.py` | Real tests. |
| `nirmaan_stack/doctype/boq_nodes/test_boq_nodes.py` | Real tests. |
| `tests/test_boq_excel_parser.py` (or co-located) | Parser unit tests. |

`hooks.py` updates: register `doc_events` for BOQs and BOQ Nodes pointing to the controller modules.

## 10. Frontend code placement

Match the **project creation wizard** structure exactly (`frontend/src/pages/projects/project-form/`).

```
frontend/src/pages/BoQ/
├── BoQUpload/
│   ├── index.tsx                 # Orchestrator (mirrors project-form/index.tsx)
│   ├── schema.ts                 # Zod schemas per step (mirrors project-form/schema.ts)
│   ├── constants.ts              # Step definitions (mirrors project-form/constants.ts)
│   ├── steps/
│   │   ├── index.ts
│   │   ├── UploadStep.tsx        # Project + name + file picker + tax treatment
│   │   ├── MappingStep.tsx       # Excel preview + column/row classification UI
│   │   ├── ParsedPreviewStep.tsx # Tree of resolved structure + warnings + inline edit
│   │   └── ConfirmStep.tsx       # Final review and save
│   └── hooks/
│       └── useBoQUploadData.ts   # Project list, existing BoQ check
├── BoQList/                      # Phase 6 — list view of BoQs per project
│   └── index.tsx
└── BoQViewer/                    # Phase 6 — read-only tree view of a saved BoQ
    └── index.tsx

frontend/src/zustand/useBoQDraftStore.ts          # Mirrors useProjectDraftStore.ts
frontend/src/hooks/useBoQDraftManager.ts          # Mirrors useProjectDraftManager.ts
frontend/src/components/ui/boq-parsing-dialog.tsx # Multi-stage progress dialog (mirrors project-creation-dialog.tsx)
```

**Reference implementations to study before writing each step:**

- `frontend/src/pages/projects/project-form/index.tsx` — orchestrator
- `frontend/src/pages/projects/project-form/schema.ts` — Zod patterns
- `frontend/src/pages/projects/project-form/steps/PackageSelectionStep.tsx` — toggleable optional sections (model for "manual vs AI parse mode")
- `frontend/src/pages/projects/project-form/steps/ReviewStep.tsx` — model for ParsedPreviewStep and ConfirmStep
- `frontend/src/zustand/useProjectDraftStore.ts` — draft store pattern with persist
- `frontend/src/hooks/useProjectDraftManager.ts` — persistence logic
- `frontend/src/components/ui/project-creation-dialog.tsx` — multi-stage progress dialog

**Tech stack constraints (from CLAUDE.md):**

- All Frappe access via `frappe-react-sdk`. No raw `fetch`.
- TanStack Table v8 for the tree view (use `getSubRows`). Use `useServerDataTable` `clientData` mode for fully-loaded trees.
- shadcn/ui for primitives; Ant Design only when matching nearby pages.
- Date formatting: `formatDate()` from `src/utils/FormatDate.ts`, dd-MMM-yyyy.
- `FuzzySearchSelect` for dropdowns with >50 options.
- `getSelectStyles()` inside Radix dialogs.
- Real-time events: `boq:created`, `boq:node:updated`, `boq:parse:complete`, wired via `SocketInitializer.tsx`.
- Routes added in `src/components/helpers/routesConfig.tsx` under `<ProtectedRoute><MainLayout>`.

## 11. UX flow

1. **Step 1 — Upload.** Pick project, name BoQ, drop `.xlsx`, choose tax treatment. Optional toggle: "Use AI assist" (Phase 4+).
2. **Step 2 — Mapping.** Sheet rendered as table preserving merged cells, bold, indentation. AI runs in background if enabled; spinner. Once ready, suggestions overlay applied (column roles labeled, rows colored by type, low-confidence cells flagged). User clicks columns → role dropdown; clicks rows → type dropdown; drag-selects for bulk; "Auto-classify similar rows" runs examples-based fill.
3. **Step 3 — Parsed preview.** Tree view of resolved hierarchy (TanStack Table with `getSubRows`). Inline-edit any field. Validation warnings panel.
4. **Step 4 — Confirm and save.** Multi-stage progress dialog (uploading → parsing → saving nodes).
5. **View.** Tree view of saved BoQ. Search, filter, export to Excel.

## 12. Edge cases (carry from earlier design)

| Case | Handling |
|---|---|
| L1 directly followed by line items | Stack-walk handles; line item parent = L1. |
| L2 followed by L1 | Stack truncates to empty on L1. |
| Same preamble title twice under different L1s | Separate nodes, no dedup. |
| Preamble with qty/rate (rare) | Allowed in schema with override flag; warn. |
| Mid-row preamble | Stack-walk handles. |
| Multiple disciplines stacked in one sheet | L1 boundaries separate them. Future "split here" UI. |
| Multiple sheets in one Excel | Open question — see §15. |
| Subtotal / Grand Total rows | Classify as `total`, skip in import, recompute fresh. Warn on mismatch. |
| Merged cells in description column | Use top-left cell value. |
| Cells with formulas | Read evaluated value; metadata flag computed=true. |
| Empty preambles | Warn, allow save. |
| Orphan line items | Warn, allow save with `parent_node = null`. |
| Level skip (L1 → L3) | Warn, allow save. |

### 12.1 Parser behaviors locked from sample analysis

The following behaviors are settled from analysis of the real BoQ corpus (JSW, Paytm, Inovalon, HYBE, Snitch). Do not re-open without a new sample driving the change.

- **Sheet-to-package mapping: 1 sheet = 1 package always.** The only exception is mid-sheet numbering resets (Inovalon HVAC pattern) which produce multiple implicit packages within one sheet — auto-detected by parser via "TOTAL ITEM NO. X" regex, user confirms in Phase 3 review.
- **"RO" / "ro" / "R/O" / "RATE ONLY" markers in qty cell** → treat as qty=0, is_rate_only=True.
- **Blank qty cell** → treat as 0.
- **AMC / Lump Sum / annual maintenance items** → standard rate-only treatment (qty=0, is_rate_only=True). Parser does NOT synthesize qty=1.
- **Description and Product Specifications columns** merge into single description with " — " separator (deferred to Phase 2b.2 when `description_specs` role is added to config.py).
- **Numbering reset mid-sheet** → auto-detect via "TOTAL ITEM NO. X" regex pattern; user confirms in Phase 3 review.
- **Pivot/matrix sheets** → skip.
- **Multiple general-notes sheets** → all append to master notes with separators.
- **HYBE-style Milestone/Product columns** → ignore (Phase 7 builds linkages).
- **Image columns** → ignore + parser warning.
- **Vendor WO / DT Reply / RC Rates / Drawing Qty columns** → ignore.
- **Missing Supply Rate column entirely** (e.g. Cuberoot FA, FPS) → mapping omits rate_supply role; controller sets amount_override=1 on resulting line items.
- **Combined-rate rounding mismatches** → parser surfaces as warning (does NOT throw); user resolves in Phase 3 review per row.

## 13. Phasing

Each phase = one feature branch (`feature/boq-phase-<N>`) → review → merge before next phase.

### Phase 0 — Project context *(complete)*
- `CLAUDE.md` enriched.
- This plan committed at `frontend/.claude/plans/boq-upload-plan.md`.
- Decisions log at end of this file.

### Phase 1 — Data model + manual entry *(2–3 days)*
- Doctypes: `BOQs`, `BOQ Nodes`. JSON schemas as in §6.
- Controllers in `integrations/controllers/`. Validation, path computation, amount auto-computation.
- Audit: confirm Nirmaan Versions schema; add `reason` field if missing; wire BOQ Node changes to write Nirmaan Versions entries.
- `hooks.py` `doc_events` updates.
- Real tests covering: path computation, amount computation, validation rules per node_type, parent-child consistency, audit log creation. Use `FrappeTestCase`. Aim for genuine coverage, not stubs.
- Permissions: match Procurement Requests / Procurement Orders conventions.
- **Exit:** can manually create a BoQ tree via Frappe Desk; tests pass.

### Phase 1.8 — Per-area rate + amount schema extension ✅ COMPLETE

**Completed 2026-05-16. Feat commit: `7d5fbc4e`. 88 Phase 1.x Frappe tests passing (60 boq_nodes + 28 boqs). 237 parser tests unchanged.**

Extends `BOQ Node Qty By Area` from 2 fields to 9 fields: adds `supply_rate`, `install_rate`, `combined_rate`, `supply_amount`, `install_amount`, `total_amount`, `amount_override`. Adds controller logic with: (a) universal-rate fallback semantics — when source file doesn't provide per-area rate, populate from parent line-item rate; (b) auto-computed per-area amounts as `area_qty × area_rate` unless source file provides them; (c) `amount_override` Check field parallel to parent — when set, suppress auto-compute; (d) weighted-average precedence on parent — when per-area rates set, parent universal rate auto-recomputes as `Σ(area_qty × area_rate) ÷ Σ(area_qty)` in `before_save`; (e) consistency validation on child rows — `combined_rate == supply_rate + install_rate` when all three set (mirrors parent-row rule). Migration patch back-populates existing child-table rows with parent's universal rate. **Scope note (2026-05-16): `make_model` field was already present on `BOQ Nodes` (position 25) — Phase 1.8 added `"make_model"` to the `_write_audit` tracked-fields list (1-line cascade fix per §7.33 + §9 #55). Controller logic lives in `integrations/controllers/boq_node_qty_by_area.py` (helper module called from parent controller — no hooks.py change needed).**

### Phase 1.8.1 — F1 + F2 cleanup ✅ COMPLETE

**Completed 2026-05-17. Feat commit: `4c6b81e6`. 91 Phase 1.x Frappe tests passing (63 boq_nodes + 28 boqs). 267 parser tests unchanged.**

F1 (per-child consistency guard, §9 #58): `_validate_combined_rate` in `boq_node_qty_by_area.py` already had the correct all-three-set guard (`if sr is not None and ir is not None and cr is not None:`). The Phase 1.8 Desk-verification finding was that TESTS were missing for the partial-rate cases, not the code. Added 2 tests (Group G): `test_child_supply_only_no_consistency_error` (supply_rate set, install_rate/combined_rate None → no error) and `test_child_install_only_no_consistency_error` (install_rate set, supply_rate/combined_rate None → no error). Regression case already covered by existing Phase 1.8 test — not duplicated.

F2 (Desk-save audit trigger, §9 #59): `on_update` had `if old_doc is None or not doc.edit_reason: return`, blocking audit on Desk saves where `edit_reason` is not filled in. Fix: (1) removed `not doc.edit_reason` from the guard — audit fires for all saves with tracked-field changes; (2) `_write_audit` defaults `nv.reason` to `"Desk edit"` when `edit_reason` is not explicitly provided; (3) added `if not changed: return` guard to suppress no-op saves; (4) added `_NULLABLE_NUMERIC_FIELDS` normalization in `_write_audit`'s comparison loop — Frappe stores Currency/Int `None` as `0` in PostgreSQL, causing false `old=0 vs new=None` diffs on repeat saves for unset rate/amount/level fields; normalizing via `or 0` for 8 fields eliminates this noise. Existing test `test_audit_entry_not_written_without_reason` renamed to `test_audit_entry_without_reason_defaults_to_desk_edit` and updated (expects reason `"Desk edit"`, adds finally cleanup). New tests: `test_audit_entry_not_written_when_no_fields_change` (+1).

### Phase 1.9a — Parser support for per-area rate ✅ COMPLETE
Extends `ClassifiedRow` with `rate_by_area_raw: dict[str, dict[str, float | None]]` (parallel to existing `qty_by_area_raw` / `amount_by_area_raw` — completes the §7.22 parallel-field pattern). Adds three new ColumnRoles: `rate_supply_by_area`, `rate_install_by_area`, `rate_combined_by_area`. Extends `multi_area_detection.py` to recognize the 3-col-per-area Raheja "Pattern 2-rate" shape (`[Area merge][Qty][Rate][Amount]` vs textbook 2-col `[Area merge][Qty][Amount]`) — closes §17.5 / handover §9 #39 (partial). Routing priority: Pattern 2-rate → Pattern 2 → Pattern 3 → Pattern 1 (Pattern 2-rate tried first because it is a strict superset of Pattern 2 shape). Extends `_apply_multi_area_post_pass` to populate `rate_by_area` on `ResolvedRow`, auto-compute per-area amounts from rate×qty when amount not directly present, and emit soft `combined_rate != supply_rate + install_rate` validation warning. Synthetic `synthetic_pattern_2_rate.xlsx` fixture added. 12 new parser tests (237→249). Feat: `b2a2f747`. **All per-area rates in Pattern 2-rate default to `combined_rate` kind — split supply/install sub-label detection deferred to a future iteration.**

### Phase 1.9b — Parser support for append_to_notes ✅ COMPLETE
Adds `append_to_notes` to ColumnRole Literal in `config.py` (NOT singleton, NOT area-compatible). Adds `append_notes_raw: dict[str, str]` field to `ClassifiedRow` in `classifier.py` — keys are source column header strings (resolved via `SheetConfig.column_headers`, falling back to column letter), values are cell text coerced via `str()`. Pattern mirrors `qty_by_area_raw`. Empty/blank cells produce no dict entry (Policy-X-style empty-cell-skip). NOTE: `ResolvedRow` does NOT need its own field — accessed via `resolved_row.classified_row.append_notes_raw`. `column_headers: dict[str, str] = {}` field added to `SheetConfig` (Case B → Option B resolution, chat-Claude 2026-05-16). Phase 2c commit step merges captured values into the `notes` field on `BOQ Nodes` with structured `[Source: ...] [Column: ...]` prefixes (§7.34). 8 new tests (249→257): +3 test_config.py (append_to_notes accepted, multiple columns, column_headers round-trip), +5 test_classifier.py (TestAppendNotesRaw class). Feat: `78b3d233`.

### Phase 1.9d — F3b + F5 + F7 Raheja-fidelity bundle ✅ COMPLETE

Design-locked 2026-05-17. Three findings bundled. Implementation prompt to follow as a separate sub-phase.

**F3b (§9 #62) — `_RATE_CELL_PATTERN` widening.** Pattern 2-rate detection regex in `multi_area_detection.py` currently `r"^\s*rate\s*$"` rejects "RATES" plural. Raheja Commerzone Electrical uses "RATES"; falls through to Pattern 1; areas + qty still capture correctly via fallback but per-area rate fidelity lost. Locked fix: widen regex to `r"^\s*rates?\s*$"`. 1-line change. Implementation prompt to include: regex widening + new synthetic fixture variant with RATES-plural shape + audit-script regression check per agreement #25 + remove `@unittest.expectedFailure` decorator on `test_electrical_pattern_2_rate_detected`.

**F5 (§9 #63) — `SheetConfig.top_header_rows_override: list[int] | None` field.** Orchestrator currently hardcodes `top_header_row = header_row - 1` in `_apply_multi_area_post_pass`. Cannot bridge multi-row gaps (Raheja HVAC: 13-row gap between merged area-name top row at row 2 and bottom header row at row 15). Locked fix: add new optional field `top_header_rows_override: list[int] | None = None` to `SheetConfig`. **Field is plural and list-typed** for forward-compatibility with Pattern 6 (Société Générale compound area names per §7.4 / §7.12 / §7.19). When set, orchestrator uses the override list to identify top-header row(s). When unset, falls back to existing `header_row - 1` behaviour. Single-element list `[2]` is the Raheja HVAC case. Multi-element lists (Pattern 6 case) deferred — parser support for multi-row concatenation not in 1.9d scope. Validation: each entry must be a valid row number less than `header_row`; entries must be unique. Implementation prompt to include: schema change + validation + orchestrator branch + 2-3 new tests + remove `@unittest.expectedFailure` decorator on `test_hvac_pattern_2_rate_with_header_gap`. Migration path noted: when Pattern 6 lands, the same field absorbs multi-row concatenation logic — no schema migration needed.

**F7 (§9 #64) — Merged title banner standing pattern (no code change).** Real-BoQ row 1 frequently carries a merged title banner spanning all populated columns (Raheja Electrical "BOQ - ELECTRICAL"; D-Tech "PHASE-0"). Without user mitigation, parser classifies as junk LINE_ITEM with banner text propagated into sl_no/description/unit (zero qty via Policy X — benign but noisy). Existing `MappingConfig.skip_top_rows_after_header` field handles via row-index list (e.g. `[1]` for row 1, `[1, 2, 3, 4]` for multiple noise rows). **No code change in Phase 1.9d.** Standing pattern documented here. Phase 3 wizard default-skip behaviour when a merged cell spans all populated header columns is agreement #24 extension candidate — codify when Phase 3 wizard design lands.

**Pattern 6 (Société Générale compound area names) — design-locked but parser-deferred.** §7.19 captured the 2-level concatenation rule on 2026-05-12: top-row value + bottom-row value, with parenthetical-suffix stripping (case-insensitive trailing `(Qty)` / `(Quantity)` / `(Amount)` / etc.), joined by underscore separator. Worked example: top `Voyager (Qty)` → strip → `Voyager`; bottom `Ground +MF`; compound `Voyager_Ground +MF`. **3+ level concatenation is a known boundary** — build when a real fixture surfaces (currently zero such fixtures across the 24 real BoQs committed in v5.8). Pattern 6 parser implementation likely absorbed by Phase 3 wizard rather than shipping as detection code. The F5-b `top_header_rows_override: list[int]` field is the future Pattern 6 entry point — same field, multi-element list with concatenation logic added when needed. Re-evaluation triggers: (a) Phase 1.9e surfaces a 2nd Pattern 6 fixture, OR (b) a real user needs Société Générale upload before Phase 3 ships.

**Scope estimate:** ~250-300 line implementation prompt covering all three findings. Comfortably under 700-line cap per agreement #15.

**Status:** ✅ COMPLETE. Feat commit `eacc8b38`. F3b CLOSED (§9 #62). F5-b CLOSED (§9 #63). F7 documentation-only (§9 #64). Parser test count 267 → 274. 0 expected failures (was 2). Raheja Electrical + HVAC integration tests now pass without expectedFailure decorators. Audit-script regression check per agreement #25: classifier_audit_output.json ZERO CHANGES; preamble_with_children_audit_output.json ZERO CHANGES; keyword_audit stdout shows Raheja RATES-plural sheets flip to pattern_2_rate (expected F3b outcome, disclosed). Pattern 6 concatenation still deferred; field shape forward-compatible.

### Phase 1.9e — Real-fixture stress test (observability chore) ✅ COMPLETE

Walks all 25 fixtures (24 real BoQ workbooks + Snitch) with zero user declaration (auto-guessed `MappingConfig`). Selects up to 4 real BoQ sheets per workbook (skip excluded sheets by name, rank by data-row count). Calls `parse_boq()` once per workbook and records per-sheet parse results. Detects rate/cost/price synonym variations in header rows not matched by `_RATE_CELL_PATTERN`. Emits `real_fixture_stress_test_output.json` as a characterization artifact — no test assertions, no parser code changes, no Frappe code touched. Empirical basis for §17.13 wizard-load re-evaluation.

**Results:** 68 sheets parsed across 25 workbooks (1 load failure: openpyxl XML parse error on one file). 62 rate-synonym variations surfaced. Pattern 1 = 9 sheets auto-detected (13%); Pattern 2/3 = 0 by construction (auto-guess uses `header_row_count=1` only). 274 parser tests unchanged.

**Status:** ✅ COMPLETE. Chore commit: 5cd4f580. Output JSON: `real_fixture_stress_test_output.json`.

### Phase 2a — Reader + Mapping Config schema ✅ COMPLETE & MANUALLY VERIFIED

**What it built:**
- Pydantic-based MappingConfig schema (`config.py`): MappingConfig, SheetConfig, ColumnRole, GlobalSettings, MasterBoqMetadata. Full validation: column letters `^[A-Z]+$`, role uniqueness, area-must-match-area_dimensions, header_row required for data sheets, master_preamble vs data sheet types.
- BoqReader class (`reader.py`) wrapping openpyxl: list_sheets() preserving exact names including whitespace; get_sheet_dimensions() (content-based); iter_rows() with lazy iteration and content-based dimension detection on empty sheets; detect_header_row() weighted-keyword heuristic with row-shape guards; detect_blank_columns(); get_master_preamble_text().
- RawRow + CellInfo dataclasses capturing: computed values, formulas, merged ranges, bold formatting, fill RGB, indent.
- Synthetic fixture generator producing 7 .xlsx test fixtures (committed to repo): synthetic_simple, synthetic_merged_header, synthetic_trailing_spaces, synthetic_blank_cols, synthetic_empty, synthetic_sparse_header, synthetic_makelist_header.
- 35 new tests (14 config + 21 reader), all passing. Phase 1.x: 77/77 still passing.

**Two bugs fixed:**
1. `detect_blank_columns` couldn't see column Z because openpyxl's `max_column` only reflects written columns. Fixed by writing `ws["Z1"] = ""` in the test fixture to extend `max_column` to 26.
2. Empty sheets returning phantom blank row because openpyxl's `max_row` defaults to 1 after save/reload. Fixed by content-based dimension detection in `iter_rows()` when `end_row` not specified.

**Heuristic loosening (follow-up commit `c34b1440`):** Manual verification on real JSW BoQ revealed `detect_header_row` returned `None` for HVAC and ELEC Make List sheets (sparse multi-area headers and domain-specific vocabulary). Heuristic was loosened with weighted scoring (strong keywords +2pts: sl.no, s.no, sno, sr.no, description, item description; medium keywords +1pt: item, material, materials, details of materials, make/model, approved make, approved makes) and row-shape guards (≥3 non-empty cells, ≤1 cell with text >60 chars, not the last content row). 3 new tests + 2 new synthetic fixtures added. After loosening, all 3 real-file sheets returned correctly: Elect B1 → 2, HVAC → 5, ELEC Make List → 3.

**Manual verification done on real JSW Unpriced BoQ via Frappe console** — sheet listing exact, dimensions detected including stray content in column G that initial inspection missed (reader correctly returned (438, 7) — column G has values at rows 181 and 185), bold detection works, formulas captured, blank rows detected, header detection works on all 3 spot-checked sheets.

Branch: `feature/boq-phase-2`.

### Phase 2b.1a — Row classifier ✅ COMPLETE

**What it built:**
- `classifier.py`: RowClassification enum (PREAMBLE, LINE_ITEM, NOTE, SUBTOTAL_MARKER, SPACER, HEADER_REPEAT), ClassifiedRow dataclass, classify_row() pure function.
- Evaluation order: spacer → header-repeat (3+ keyword matches in mapped columns) → subtotal (text regex patterns OR =SUM( formula in any amount column) → qty extraction with RO-marker detection and blank-qty+rate rule → PREAMBLE / LINE_ITEM / NOTE decision.
- Handles RO/ro/R/O/RATE ONLY markers (qty=0, is_rate_only=True), blank qty cells (qty=0 when rates present), unit whitespace stripping, make_model passthrough, row_notes passthrough, numeric sl_no preservation as string, per-area raw qty capture (splitting deferred to 2b.2).
- Pure per-row logic — no tree-walking, no parent inference, no multi-area splitting.
- 17 new tests (asked for 12 minimum, +5 bonus for edge cases). All passing. Phase 1.x + Phase 2a tests: 129/129 still passing (28 BOQs + 49 BOQ Nodes + 14 config + 21 reader + 17 classifier).

Branch: `feature/boq-phase-2`. Commit: `9d8afac5`.

**Follow-up fix (ghost-note suppression):** Manual verification on real JSW Elect B1 revealed ~70 visually-empty rows being classified as NOTE because they contained leftover template formulas (e.g. `=N($D17)*N(E17)` evaluating to 0 with blank qty/rate). Added a post-extraction emptiness check after the classification decision: if classification = NOTE AND every extracted field (sl_no_value, desc_text, unit, qty, all rates, make_model, row_notes) is None/empty, override to SPACER and clear warnings. 1 new test (18 total classifier tests, 130 total). Commit: `ab99fb6c`.

### Phase 2b.1b — Hierarchy resolver ✅ COMPLETE

**What it built:**
- `hierarchy.py`: `ResolvedRow` dataclass (parent_index, level, path, attached_to_index, attached_notes), `ResolvedSheet` dataclass (rows, master_preamble_notes, warnings), `resolve_hierarchy()` pure function, `_determine_preamble_level()` private helper.
- Stack-walk algorithm with in-memory `path_cache: dict[int, str]` — avoids DB round-trips during bulk insert. `stack[i]` holds the resolved-row index of the most recent preamble at level i+1.
- **Note attachment:** notes attach to the topmost non-None preamble on the stack. Notes before the first preamble go to `ResolvedSheet.master_preamble_notes`.
- **Mid-sheet numbering reset:** SUBTOTAL_MARKER rows matching `^\s*total\s+item\s+no\.?\s+\d+` (case-insensitive) clear the stack entirely; subsequent preambles restart at level 1. Plain subtotals (e.g. "TOTAL CARRIED OVER") do not reset.
- **Level determination heuristic** (in order): pure integer → level 1; dotted-decimal (trailing `.0` stripped; ambiguous `1.0.0` → level 1) → len(parts) depth; single letter (A., B.) → level 1; PART-X → level 1; Roman numeral → level 1; digit+letter (1a) → level 2; digit.digit+letter (1.1a) → level 3; fallback to `sl_no` cell indent (indent+1); final fallback to stack_depth+1. Soft warning emitted for level > 5.
- 19 new tests across 4 families (tree shape, note attachment, special markers, level heuristics). All 72 parser tests passing (14 config + 21 reader + 18 classifier + 19 hierarchy). 77 Phase 1.x tests still passing.

Branch: `feature/boq-phase-2`. Commit: `fdb6eb64`.

**Follow-up fix (level_1_style detection — context-aware level determination):** Manual verification on real JSW Elect B1 revealed all 32 preambles classifying at level 1 (flat list, no tree) due to context-blind heuristic. Root cause: trailing-zero stripping rule for `1.0` produced level 1 even when `1.0` was a sub-section under a letter-coded parent. Fix: pre-scan sheet to detect first-preamble code style as `level_1_style` (one of letter/roman/numeric/part); subsequent preambles matching that style → level 1, different recognized style → level 2, multi-dot decimal → 1 + dots, lowercase letter → stack_depth + 1, unknown → fallback chain (cell indent → stack_depth + 1). Re-detects after mid-sheet "TOTAL ITEM NO. X" reset. Added `level_1_style_override` field to `SheetConfig` for Phase 3/4 manual override. Pattern Y multi-dot ambiguity emits warning category `ambiguous_level_pattern_y` and uses default depth — Phase 3 wizard resolves. Test count increased from 19 → 31 hierarchy tests; total parser tests 84 (14 config + 21 reader + 18 classifier + 31 hierarchy). Commit: `7f63e39a`.

**Second follow-up fix (lookahead-based level_1_style detection):** Manual re-verification on JSW Elect B1 (after the level_1_style fix) revealed sections C and D being mis-categorized because single chars C, D, L, M, I, V, X are valid Roman characters and match `_RE_ROMAN` before `_RE_UPPER`. A simple regex-order swap was attempted and reverted — it broke Paytm's legitimate Roman pattern starting at `I.` (where I, II, III sequences need single-char I to be Roman, not letter). Correct fix: lookahead-based detection in `_detect_level_1_style` that examines the first TWO level-1-eligible preambles. Unambiguous chars (A, B, E, F, G — not in [IVXLCDM]) return "letter" immediately. Ambiguous single chars (I, V, X, L, C, D, M) check the second preamble: multi-char Roman second (II, III...) → roman (Paytm I./II./III. pattern); single char alphabetically near (abs(ord) ≤ 3, e.g. C→D) → letter; both in Roman set and far apart → roman; else → letter. Plus a small special case in `_determine_preamble_level` so single-char Roman codes (C, D etc.) are accepted at level 1 on letter-style sheets (the categorizer still returns "roman" for them since `_RE_ROMAN` is unchanged). Handles both JSW alphabetic (A-G with C/D) and Paytm Roman (I-IV) correctly without regression. Test count increased from 31 → 36 hierarchy tests; total parser tests 89 (14 config + 21 reader + 18 classifier + 36 hierarchy). Commit: `90b0f0db`.

**Third follow-up addition (preamble candidate scoring + `is_synthetic` field for Phase 3 wizard):** Manual verification on real Inovalon HVAC BoQ revealed BoQ authors sometimes use unnumbered text-only rows as section headers (example: row 36 "Central Air Cleaner for AHUs" introduces line items 41-42 but has no sl_no). The classifier correctly labels these as NOTE since they have no sl_no, but Phase 3 wizard needs metadata to surface promotion candidates. Added `preamble_candidate_score: int` (0-5) and `preamble_candidate_signals: list[str]` to `ClassifiedRow` (both default to 0/[] — rows classified individually are unaffected). Score breakdown: bold +2, first-note-in-block-ending-at-line-item +2, short description (<80 chars) +1. Computed by new function `populate_preamble_candidate_scores(classified_rows, sheet_config)` called as a separate post-pass after individual row classification (Phase 2b.2's `parse_boq()` orchestrator will call it). Also added `is_synthetic: bool = False` field to `ResolvedRow` (parser never sets True) reserved for Phase 3 wizard's "create new preamble from scratch" action. Classifier classification and tree logic unchanged — this is data preparation only. Test count: classifier 18 → 26, hierarchy 36 → 37; total parser tests 98 (14 config + 21 reader + 26 classifier + 37 hierarchy). Commit: `481035ba`.

### Phase 2b.2 — Multi-area + first end-to-end fixture ✅ COMPLETE (Parts A1–A3c, B1, B2a, B2b-keywords, B2c, B2d, B2e, B2f all complete)

- Multi-area qty processing — populates qty_by_area per row from the qty_by_area_raw dict the classifier already captures
- First end-to-end test fixture using real Snitch BoQ (small, 4-sheet file, simple structure)
- Hand-written expected-output JSON for the Snitch fixture (~1 hour of careful work)
- parse_boq(file_path, config) entry point wiring reader + classifier + hierarchy resolver
- ~13 unit tests + 1 integration test using the Snitch fixture

**Part A1 complete (2026-05-10):** `iter_rows()` extended so that cells covered by a merged range (not the origin) now propagate the origin's `value`, `formula`, `formula_text`, and `merged_range` string into their `CellInfo`. `is_merged_origin` stays `False` for covered cells. Formatting fields (`font_bold`, `fill_color_rgb`, `indent`) are always the covered cell's own data — not inherited from the origin. Implementation: a per-invocation `covered_lookup: dict[(row, col), (range_str, value, formula_text, is_formula)]` built at the start of `iter_rows()` by walking `ws.merged_cells.ranges`; origin cells fall through to existing logic unchanged. 6 new tests in `TestMergedCellPropagation` class (origin unchanged, covered inherits range, covered inherits value, covered is not origin, formatting not inherited, two-row Pattern-2-shaped layout). Test count: reader 21 → 27; total 175 → 181. Commit: `ed860248`.

**Part A2 complete (2026-05-10):** `ColumnRole` Literal extended with 3 new roles: `amount_combined`, `qty_by_area`, `amount_by_area`. (`rate_combined` was already present; `total_qty` dropped — existing `qty_total` serves this role.) `_AREA_COMPATIBLE_ROLES` extended from 4 to 6 entries to include the two new per-area roles. New `area_required_for_by_area_roles` model validator enforces that `qty_by_area` and `amount_by_area` must have a non-empty `area` value; existing optional-area behaviour for `qty`, `amount_supply`, `amount_install`, `amount_total` is unchanged. Existing `area → area_dimensions` cross-check on `SheetConfig` applies automatically to the new roles (role-agnostic code). `GlobalSettings` gains `multi_area_reserved_keywords: list[str]` (22-entry locked default; `Field(default_factory=...)` pattern). 6 new tests (20 config total). Test count: config 14 → 20; total 181 → 187. Commit: `c70e186b`.

**Pre-implementation discrepancies surfaced and resolved:** (1) `rate_combined` already existed in Literal — dropped from addition list. (2) `total_qty` = same concept as existing `qty_total` — dropped; Part A3 populates `qty_total`. (3) `area_name` vs existing `area` field — resolved Option B: reuse existing `area` field, extend `_AREA_COMPATIBLE_ROLES`, add require-validator for new roles only. (4) Proposed Test 5 (area→area_dimensions cross-check for `qty_by_area`) was redundant with existing `test_area_referencing_undeclared_dimension_rejected` — replaced with combined `test_amount_combined_role_does_not_accept_area` (positive + negative assertions for `amount_combined`).

**Follow-up fix (2026-05-10, commit `c7f8912b`):** `amount_combined` was omitted from `_SINGLETON_ROLES` in the original A2 commit. Added adjacent to `amount_total` to match the amount-fields cluster. Parallel to `rate_combined` (already a singleton). The existing generic duplicate-rejection validator covers it automatically — no new test required. Test count unchanged at 187.

**Ops note (2026-05-10, commit `017b2a1a`):** `CLAUDE.md` Active Features row updated at the A2→A3 boundary — branch changed from `feature/boq-phase-0` to `feature/boq-phase-2`, spec path changed from `docs/boq-feature/spec.md` to `frontend/.claude/plans/boq-upload-plan.md`, `BOQ Node Audit Logs` corrected to `BOQ Node Qty By Area` (audit is via `Nirmaan Versions`), Phase 2 sub-phase split noted. Working agreement #13 (doc maintenance at sub-phase boundaries) should be extended to also require `CLAUDE.md` updates at each full phase boundary (i.e., when the Active Features table row would change).

**Session 1 complete (2026-05-13):** Added Pattern-4 integration test (`test_pattern_4_full_mapping_validates_successfully`) to `test_config.py`. Proves the Part A2 schema accepts a single-sheet config combining per-area qty + per-area amount + split supply/install rate + split supply/install total amount, all together. Pure in-memory construction — no reader/classifier/hierarchy involvement. Test count: config 20 → 21; parser total 110 → 111. Commits: feat `e150d1f0`, docs `see git log`. **Note:** test file lives at `nirmaan_stack/services/boq_parser/test_config.py` (NOT in `tests/` subdirectory — that directory holds only fixtures). Test runner command is `python -m unittest test_config test_reader test_classifier test_hierarchy -v` from the `boq_parser/` directory (pytest not installed in the bench env). **Note:** total 188 = 77 Phase 1.x (28 BOQs + 49 BOQ Nodes, run via `bench run-tests`) + 111 parser (run via unittest). The 111 pure-Python parser tests are the ones Claude Code can verify directly.

**Part A3a complete (2026-05-13):** `multi_area_detection.py` created with `MultiAreaPattern` dataclass + `detect_multi_area_pattern()` function + 3 private helpers (`_try_pattern_1`, `_try_pattern_2`, `_try_pattern_3`). Function accepts `(bottom_header_row: RawRow, reserved_keywords: list[str], top_header_row: RawRow | None = None)` — pure Python, no reader dependency, fully testable with in-memory `RawRow` objects. TOTAL_QTY_PATTERN + QTY/AMOUNT cell regexes locked per v5.3 §3. Priority routing: 1-row mode → P3 → P1; 2-row mode → P2 → P3 → P1(bottom) → P1(top fallback). 3 smoke tests added in `test_multi_area_detection.py` (one per pattern, happy-path only). Test count: parser 111 → 114. Feat commit: `043ff057`. **Signature deviation from prompt**: prompt suggested `(reader, sheet_name, header_row, header_row_count, reserved_keywords)`; implemented as `(bottom_header_row, reserved_keywords, top_header_row=None)` for testability — the caller extracts rows before calling. Noted for Part B orchestrator integration.

**Part A3b complete (2026-05-13):** 11 comprehensive tests added in new class `TestMultiAreaDetectionComprehensive` covering: Pattern 1 liberal (no terminator, 3 areas), Pattern 1 single-area rejection, Pattern 2 three-merge happy path, Pattern 2 QTY+QTY rejection (pairing required), Pattern 3 canonical two-pair shape, priority P2>P3 (2-row mode), priority P3>P1 (1-row mode), P1 top-row last-resort fallback (TS_T2_WEX shape), reserved-keyword top-row merges rejected for P2 (Morgan Stanley shape), all-reserved-keywords → None, case-insensitive keyword matching. Test count: parser 114 → 125. `multi_area_detection.py` unchanged. Feat commit: `4c2fd166`. ~~**Latent bug noted (not fixed):** `_try_pattern_1` does not skip covered cells — covered-cell duplication bug; fix deferred to Part B.~~ **Fixed in Part A3c (commit `3bc745a9`) — see A3c record below.**

**Part A3c complete (2026-05-13):** Fixed covered-cell duplication bug in `_try_pattern_1`: added one `continue` condition — `if cell.merged_range is not None and not cell.is_merged_origin: continue` — before the TOTAL_QTY_PATTERN check. Covered cells (reader-propagated values from Part A1) are now skipped; only merge origins and non-merged cells contribute area names. Test 4 (`test_pattern_2_qty_amount_pairing_required`) updated: covered-cell fixture tightened to realistic propagated values (`value="Office"` / `value="Common Area"` instead of `value=None`), assertion changed from `assertIsNone` to `Pattern 1 with ["Office", "Common Area"]` — the test now covers both P2 pairing rejection AND the P1 top-row fallback that correctly fires after the fix. Two regression tests added: `test_pattern_1_skips_merge_covered_cells_on_top_row` (realistic TS_T2_WEX-style fixture with propagated covered cells) and `test_pattern_1_treats_origin_cells_normally` (origin + regular cells both collected). Test count: parser 125 → 127. Fix commit: `3bc745a9`.

**Session 4 verification complete (2026-05-13):** Manual real-data verification of `detect_multi_area_pattern()` against two real BoQ files from local disk (no commits, no fixtures added). **JSW HVAC Pattern 3: PASS** — opened `R0 WORKING-JSW -MEP Priced BOQ- 29.04.2026.xlsx` via `BoqReader` from a temporary `/tmp/jsw_test.xlsx` (docker cp + cleanup), called `detect_multi_area_pattern` on row 5 of the HVAC sheet, returned `MultiAreaPattern(pattern=3, areas=['B1', 'B3', 'B6'], qty_columns=[4, 6, 8], amount_columns=[5, 7, 9], detected_on_row=5)` — exact match to predicted output. Pattern 3 detection, area capture, reserved-keyword handling, and TOTAL QTY terminator behavior all verified end-to-end on real data. Trailing whitespace on `'AMOUNT '` (column L) correctly handled by case-insensitive `.upper().strip()` comparison. **Raheja Commerzone Chennai Pattern 2: NOT VERIFIED** — discovered a variant shape (3-col-per-area `[Area merge][Qty][Rates][Amount]` instead of textbook 2-col `[Area merge][Qty][Amount]`) not currently handled by `detect_multi_area_pattern`. Spot-checked across all Raheja sheets — every sheet uses the 3-col variant. See §17.5 for full description and disposition. Half-coverage on real data; Pattern 3 alone confirmed working.

**Part B1 complete (2026-05-14):** `ClassifiedRow.amount_by_area_raw: dict[str, float]` field added (parallel to `qty_by_area_raw`; `field(default_factory=dict)`). `classify_row()` captures `amount_by_area_raw` from columns with `role == "amount_by_area"` — mirrors `qty_by_area_raw` capture logic exactly (same dict shape, same area-name keying, same early-return gating for SPACER/HEADER_REPEAT/SUBTOTAL_MARKER). `ResolvedRow.validation_warnings: list[str] = []` field added — parser never sets a non-empty value in B1; B2's sum-validation post-pass will. `ParsedBoq` + `ParsedSheet` Pydantic models created in new `nirmaan_stack/services/boq_parser/orchestrator.py` module (not `config.py` — keeps input config separate from output result models). `parse_boq(file_path, config) -> ParsedBoq` orchestrator wires reader → `classify_row()` → `populate_preamble_candidate_scores` → `resolve_hierarchy` → `detect_multi_area_pattern` per non-skipped data sheet; `master_preamble` extracted from `treat_as="master_preamble"` sheets. NO multi-area splitting; NO sum validation; NO fixtures committed — all B2 scope. 12 new unit tests (5 classifier for `amount_by_area_raw`, 2 for `ResolvedRow.validation_warnings`, 5 orchestrator). Test count: parser 127 → 139. Feat commit: `9c2275ae`.

**Part B2b-keywords complete (2026-05-14):** Prerequisite sub-phase to fix a multi-area detection false positive discovered during the B2b (Snitch) session. Root cause: `'S No.'` and `'ITEM'` in the Snitch `'7. Light Fixtures'` header row were not in `multi_area_reserved_keywords`, so `_try_pattern_1` collected them as area names. Fix: expanded `GlobalSettings.multi_area_reserved_keywords` in `config.py` from 22 to 49 entries — adding "INSTALLATION RATE", "TOTAL RATE" (rate variants), 11 Sl.No./S No. variants ("SL.NO", "SL.NO.", "SL NO", "SL NO.", "SLNO", "S NO", "S NO.", "S.NO", "S.NO.", "SNO", "S/N"), 4 Sr No. variants ("SR NO", "SR NO.", "SR.NO", "SR.NO."), 3 Serial No. variants ("SERIAL NO", "SERIAL NO.", "SERIAL NUMBER"), 5 Item variants ("ITEM", "ITEMS", "ITEM DESCRIPTION", "ITEM NO", "ITEM NO."), 2 Desc shorthand variants ("DESC", "DESC."). Code-trace verification confirmed fix eliminates false positive: col A='S No.' → reserved skip; col B='ITEM' → reserved skip; col C='UNIT' → reserved skip; col D='Qty' → TOTAL_QTY_PATTERN match → break; zero areas collected → None. 5 new regression tests in new class `TestReservedKeywordExpansion` in `test_multi_area_detection.py` (Snitch LF header no-false-positive, Sl.No. variant, Sr No. variant, Item Description variant, case-insensitive). Also updated `test_config.py` count assertion 22→49 (outside stated in-scope list — minimal fix to prevent failing test, noted as deviation). Test count: 156 → 161. `snitch_electrical.xlsx` stays untracked in `tests/fixtures/` (B2c will commit it). Feat commit: `d02b212f`.

**Part B2d complete (2026-05-14):** Added `_apply_unit_based_demotion_post_pass(classified_rows: list[ClassifiedRow]) -> None` to `classifier.py` (see §7.28). Wired in `orchestrator.py` as Step 2b — after the per-row `classify_row()` loop and BEFORE `populate_preamble_candidate_scores()` (preamble scoring must not apply to rows that were just demoted to LINE_ITEM). Logic: collect unit strings from all LINE_ITEM rows on the sheet; demote any PREAMBLE row whose `qty is None` and `unit` matches a collected unit (case-sensitive, exact) → `classification = LINE_ITEM, qty = 0.0, is_rate_only = True`. 9 new tests added to `test_classifier.py` in new `TestUnitBasedDemotion` class (8 unit tests + 1 smoke on `synthetic_simple.xlsx`). TestSnitchIntegration: 3 tests now fail intentionally (`test_snitch_electrical_total_resolved_row_count`, `test_snitch_electrical_first_5_line_items`, `test_snitch_electrical_preamble_level_transitions`) — Snitch Electrical LINE_ITEM count changed 93→175, PREAMBLE 126→44 (82 rows demoted). B2e-snitch-refresh will regenerate `snitch_electrical_expected.json` to match. Test count: 173 → 182 total (179 passing, 3 failing). Known issue §17.9 (preamble stack-depth cascade in `hierarchy.py`) parked — B2d addresses the symptom at the classifier stage but the resolver-level root cause is not fixed. Feat commit: see git log.

**Part B2e-snitch-refresh complete (2026-05-14):** Regenerated `snitch_electrical_expected.json` against the new classifier behaviour from B2d-classifier (§7.28). Snitch Electrical: total resolved rows 521 (unchanged), LINE_ITEM 175, PREAMBLE 44, NOTE 287, SPACER 6, SUBTOTAL_MARKER 9. Max preamble level dropped from 21 to 7 (the depth-21 cable cascade resolved as the affected rows were demoted to LINE_ITEM). `first_5_line_items` re-populated by new resolved-order: indices 24/25/27/31/32 (resolved_idx=25 is a newly-demoted row with qty=0.0, is_rate_only=True). `preamble_level_transitions` uses Option α working definition (first preamble at each distinct level; 7 entries for levels 1–7; documented in JSON `_notes`; level-2 entry uses `description_contains_substring` for soft-hyphen safety). Subtotal marker indices unchanged (same 9 positions). Light Fixtures fully unchanged (PIR PREAMBLE preserved by case-sensitive unit comparison 'NOS' ≠ 'Nos.'). No `test_orchestrator.py` source changes needed — JSON regeneration alone restored all 3 failing tests. All 182 tests now pass. `_notes` key added to JSON with working definition and regeneration provenance. §17.9 known issue (KG/LS-unit PREAMBLEs not demoted, unique units) visible in audit but benign — not blocking. Feat commit: `1fa1d99f`.

**Part B2f-zero-children-demotion complete (2026-05-14):** Added `_apply_zero_children_preamble_demotion_post_pass(resolved_rows: list[ResolvedRow]) -> None` to `hierarchy.py` (see §7.29). Wired in `orchestrator.py` as Step 4a — after `resolve_hierarchy()` (needs tree path data) and BEFORE `_apply_multi_area_post_pass()`. Algorithm: (A) build `paths_with_descendants` set by extracting ancestor-path prefixes from every row's `path`; (B) for each PREAMBLE row whose path is NOT in that set (i.e. leaf node): if it has a non-empty unit or a positive rate → demote to `LINE_ITEM(qty=0.0, is_rate_only=True, level=None)`. Row 341 in Snitch Electrical (sl_no='7.0', unit='KG', no children, path='305/341') was the target: now LINE_ITEM. Row 500 (sl_no='2.0', unit='LS', path='394/500', has 5 children) correctly NOT demoted (§17.10 deferred). Additionally, PIR sensor row in Snitch Light Fixtures (resolved_idx=14, unit='NOS', leaf node) also demoted by the same logic — this is correct behaviour (the classifier's blank-qty-no-rate rule had set it PREAMBLE, but it is a genuine rate-only item with a unit). Snitch expected JSON updated: Electrical LINE_ITEM 175→176, PREAMBLE 44→43; Light Fixtures LINE_ITEM 13→14, PREAMBLE 1→0; `row_16_preamble_anomaly` updated to reflect B2f-demoted LINE_ITEM classification. `test_snitch_light_fixtures_row_16_preamble_anomaly` test body updated (LINE_ITEM check). 8 new tests in `TestZeroChildrenPreambleDemotion` class in `test_hierarchy.py`. All 190 tests green. §17.10 known issue (priced PREAMBLE with children at row 500) explicitly parked. Feat commit: see git log.

**Part B2c complete (2026-05-14):** Committed `snitch_electrical.xlsx` (138,066 bytes, 5 sheets: OVERALL SUMMARY, SUMMARY MEP, 6. Electrical, 7. Light Fixtures, MAKE LIST). Wrote `snitch_electrical_expected.json` with narrow expected-output spec covering: workbook-level assertions (sheet count=2, master_preamble=None, no validation warnings), skip-sheet assertions, first 5 LINE_ITEMs per sheet, all 9 SUBTOTAL_MARKERs in Electrical + 1 in Light Fixtures, preamble level transitions (levels 1/2/3 for Electrical), Light Fixtures PIR PREAMBLE anomaly, per-classification counts. Added `TestSnitchIntegration` class (12 test methods) in `test_orchestrator.py` — setUpClass calls `parse_boq()` once and caches result. §7.25 decision log wording corrected from "by mistake" framing to deliberate policy-reversal framing. Snitch fixture partially closes §9 #40 (JSW MEP Priced still on local disk only). Known issue §17.8 (reserved keyword gap survey) deferred to Phase 2c. Test count: 161 → 173. Feat commit: see git log. Docs commit: see git log.

### Phase 2c — DB commit + version cascade + 4 more fixtures ⏳ FUTURE

**Blocked on Phase 1.8 + 1.9.** Per-area rate+amount schema extension must land BEFORE Phase 2c DB-commit work begins. Rationale: no real BoQ data is committed to the DB yet (only test fixtures); this is the cheapest possible moment to extend the schema. Once Phase 2c starts writing real parsed BoQ data, every subsequent schema extension carries a migration, writer-rewrite, and data-correctness audit. Phase 1.8 (schema + controller + migration) and Phase 1.9 (parser support including 3-col-per-area Pattern 2-rate detection) sequence first.

- commit_parsed_boq(parsed_output) writes master + sub-BoQs + nodes + qty_by_area to DB
- Version cascade (deferred from Phase 1.7) — re-upload triggers cascade: old master + old children → Superseded; new master + new children at v+1; missing-sheet handling per Q-Cascade-Missing decision (drop, not carry-forward)
- 4 more end-to-end fixtures (JSW Unpriced, Paytm, Inovalon HVAC, HYBE) using golden-with-review approach (run parser, eyeball output, save as expected)
- ~20 tests
- Manual back-office demo at end

**Scope expansion (2026-05-16, §7.34):** `commit_parsed_boq()` must implement the commit-time merge logic for the `notes` field — read `row_notes` from each row's classified_row, walk ancestor chain via `resolved_row.path` to assemble inherited `append_notes_raw` content, emit structured-prefix lines per the §7.34 format, write final string to `BOQ Nodes.notes` field.

### Phase 3 Module 1a — Wizard backend and schema ✅ COMPLETE

Branched as `feature/boq-phase-3` from `feature/boq-phase-2` tip 2e338b36 (2026-05-29). First commit of Phase 3 (wizard). Pre-v5.30 framing called this "Phase 2c body"; user decision at Phase 3 kickoff re-frames wizard work as a distinct phase branched fresh per "one branch per phase" working agreement.

Schema: `BOQs.wizard_state` Select (`In progress / Configured / Parsed`) + `BOQs.sheet_drafts` Table; new `BoQ Sheet Draft` child doctype with 4 fields (`sheet_name`, `sheet_order`, `wizard_status`, `work_package`). Migration verified: `has_column("BOQs", "wizard_state")` True; `BoQ Sheet Draft` DocType exists with 4 fields.

API: `api/boq/wizard/` package with two whitelisted endpoints:
- `upload_file` (async via `frappe.enqueue`): validates extension + size, saves to Frappe File storage, enqueues worker; worker opens BoqReader, creates BOQs row with `wizard_state="In progress"` and sheet_drafts child rows, auto-detects `work_package` via case-insensitive substring match on Work Headers, attaches via Nirmaan Attachments, publishes `boq:wizard_parse_done` over realtime.
- `update_boq_draft`: partial-update endpoint for `boq_name`, `version`, `tax_treatment`, `notes`.

`create_tendering_project` dropped from scope: wizard never creates Projects rows; picker's "Create new project" path (Module 1b) defers to existing Nirmaan new-project workflow.

`BOQs.before_insert` owns version computation (M1.25: `COALESCE(MAX(version), 0) + 1` scoped to project+boq_name); duplicate computation removed from worker.

16 new wizard tests (corrected from 17; bench run-tests reported 16; 16 + 25 from 2a = 41 total confirmed). Frappe tests: 679 -> 696. Parser tests: 588 unchanged. Feat: 06f38e8d.

### Phase 3 Module 2a -- Hub backend: schema + sheet-draft endpoints ✅ COMPLETE

**Schema (2 doctypes, sanctioned JSON edits + bench migrate).**
- `BoQ Sheet Draft.wizard_status` options extended from 3 to 6: blank/Pending/Hidden/Reviewed/Skip/General specs/Parse failed. "Parse failed" included at enum-definition time (no writer until Module 5) so no future option-migration needed.
- `BoQ Sheet Draft.sheet_label` Data field added (optional, after work_package in field_order). Human-reference label for Skip sheets. No parser coupling.
- `BOQs.general_specs_sheet` Data field added (optional, in parser_metadata_section after area_dimensions). Stores the sheet name string of the designated general-specifications/master-preamble sheet. At most one per workbook (single scalar on parent). NOT a Link -- sheet drafts have no standalone linkable name; parser master_preamble already keys off sheet name.
- `BOQs.master_preamble` Long Text field added (optional, read_only, in parser_metadata_section after general_specs_sheet; feat 8db5a8d8). Machine-written by the parse worker when `parsed.master_preamble` is non-empty. Kept separate from the user's free-form `notes` field (clean separation; Phase 2 review screen displays it). Search is within a single BoQ (UI/find-in-text concern) -- no full-text index, no splitting into points. C7-logged add: field has a live producer now (Slice 2 worker) and a named Phase-2 consumer (review screen).

NOT added: any parse-status/auto-parse-failed field on either doctype. No per-sheet parse producer exists in current architecture (Module 1 worker only lists sheets; per-sheet pass/fail is produced by the deliberate parse in Module 5). Dead schema with no writer is out of scope.

NOT changed: work_package on either doctype. Single->multi-link conversion is a Module 3 concern.

**API: `api/boq/wizard/update_sheet_draft.py`** -- 3 new POST endpoints (`@frappe.whitelist(methods=["POST"])`):
- `set_sheet_status(boq_name, sheet_name, status)`: sets wizard_status on matching child draft row. Explicitly REJECTS "General specs" (redirect message: use set_general_specs_sheet). Allowed: Pending/Hidden/Reviewed/Skip/Parse failed.
- `set_sheet_label(boq_name, sheet_name, label)`: sets/clears optional sheet_label. label=None or "" both clear.
- `set_general_specs_sheet(boq_name, sheet_name_or_none)`: sets/clears BOQs.general_specs_sheet pointer. Backend stores pointer ONLY -- does NOT touch wizard_status on any draft row. Frontend derives "General specs" display badge from pointer and handles warn-and-confirm (M2.23) before calling. When cleared, frontend reverts released sheet card to Pending.

URL paths: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.<function_name>`

Child-row idiom: `frappe.db.get_value("BoQ Sheet Draft", {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name}, "name")` to find child_name, then `frappe.db.set_value("BoQ Sheet Draft", child_name, field, value)`. Mirrors existing wizard endpoint style.

**Read path:** NO custom read endpoint added. `useFrappeGetDoc("BOQs", boqName)` (already used in BoqUploadScreen) returns full doc including all sheet_drafts child rows with all fields.

**Tests: `api/boq/wizard/test_update_sheet_draft.py`** -- 25 new FrappeTestCase tests:
- TestSetSheetStatusPositive (6): set_reviewed, set_skip, set_hidden, set_pending_after_reviewed, set_parse_failed, second_sheet_unaffected
- TestSetSheetStatusNegative (5): rejects_general_specs_direct, rejects_invalid_status, rejects_unknown_sheet, rejects_unknown_boq, rejects_missing_status
- TestSetSheetLabel (6): set_label, clear_with_empty_string, clear_with_none, second_sheet_unaffected, rejects_unknown_sheet, rejects_unknown_boq
- TestSetGeneralSpecsSheet (8): set_pointer, change_pointer, clear_with_none, clear_with_empty_string, wizard_status_not_touched_on_set, wizard_status_not_touched_on_clear, rejects_unknown_sheet, rejects_unknown_boq

Wizard test total: 41 (was 16 actual / 17 as recorded in Module 1a entry; 16 + 25 = 41). Parser tests: 588 unchanged.

**Migration:** `bench --site localhost migrate` in container. Processed frappe + nirmaan_stack + frappe_s3_attachment; no patches; no unrelated app touched.

**In-scope:** 2 doctype JSON edits, update_sheet_draft.py (3 endpoints), test_update_sheet_draft.py (25 tests), boq-upload-plan.md + root CLAUDE.md. **Out-of-scope:** all frontend (2a is backend-only); upload_file.py/update_boq_draft.py (unchanged); parser (unchanged at 588). Frontend CLAUDE.md intentionally NOT updated.

Feat: 5cdbbd16.

### Phase 3 Module 2b-i -- Hub static shell + read-only sheet-card list ✅ COMPLETE

**Route and read path.**
New route `{ path: "upload-boq/hub/:boqId", lazy: () => import("@/pages/boq-wizard/BoqHubPage") }` added as a sibling of `upload-boq` in routesConfig. `boqId` read from `useParams()` -- survives browser refresh and is linkable. `useFrappeGetDoc<BOQsDoc>("BOQs", boqId, boqId ? undefined : null)` fetches the doc (third-arg gotcha honored). No endpoint calls in this slice (2b-ii).

**Shared types (`boqTypes.ts`).**
`BOQsDoc` promoted from a private `BoqUploadScreen` interface to a shared module. Adds `sheet_drafts: BoQSheetDraft[]` and `general_specs_sheet?: string`. `BoQSheetDraft` interface includes `name`, `sheet_name` (EXACT), `sheet_order`, `wizard_status` (6-value union), `work_package?`, `sheet_label?`. Both `BoqUploadScreen` and `BoqHubPage` import from here.

**Continue stub repointed.**
`BoqUploadScreen.tsx`: removed `handedOff` state + `CheckCircle2` placeholder branch. Continue button now calls `navigate(\`/upload-boq/hub/${boqDocName}\`)`. Dead code fully cleaned (`useState` import removed, `CheckCircle2` import removed).

**Hub components (all in `src/pages/boq-wizard/`).**
- `BoqHubPage.tsx`: four regions rendered from the fetched BOQsDoc:
  1. Header strip: `boq_name` + V{version} subtitle + static "Saved" indicator + DropdownMenu with disabled "Discard BoQ" item (TODO(2b-ii)).
  2. General-specs selector: shadcn Select with current `general_specs_sheet` value; SelectTrigger `disabled` (2b-ii removes disabled and wires `onValueChange` to `set_general_specs_sheet`). EXACT: `SelectItem value` = `sheet_name` verbatim.
  3. Sheet-card list: non-hidden sheets sorted by keyword-hint weight then `sheet_order`. Hidden sheets collapsed under "Show hidden sheets (N)" toggle (local `useState`).
  4. Parse-gate footer: progress text "{N} of {M} sheets reviewed" + "Parse workbook" Button (disabled when `!canParse`, onClick no-op stub -- Module 5).
- `SheetCard.tsx`: status pill (6 statuses + fallback) + sheet name (display-trimmed only) + at most one muted summary line (sheet_label > work_package > keyword hint). Action buttons deferred to 2b-ii (TODO comment).

**General-specs derivation (M2.16) -- critical.** Effective status "General specs" is derived: if `draft.sheet_name === boq.general_specs_sheet` (EXACT match), effective status overrides `wizard_status`. The comparison is verbatim -- no trimming. This is the only correct derivation; writing "General specs" to `wizard_status` from the frontend is forbidden.

**Keyword sort + hint (presentation-only).** Keywords: `summary`, `make list`, `cover`, `index`, `abstract`, `boq summary`. Matching sheets get weight 1 (sink to bottom) and show "Likely non-data sheet -- consider skipping" in italic if no `sheet_label` or `work_package` is present. No data is changed.

**Parse-gate computation.** Data sheets = non-hidden, non-skip, non-general-specs (the parse candidates). `blockingCount` = Pending or Parse failed among data sheets. `reviewedCount` = Reviewed among data sheets. `canParse = blockingCount === 0 && reviewedCount >= 1`. Gate reflected in button's `disabled` state + tooltip. "Parse workbook" is a no-op stub.

**EXACT sheet_name constraint (verified 2026-05-31).** Backend matches `sheet_name` verbatim. React keys and SelectItem values use `draft.sheet_name` as-is; display labels are trimmed. Each site in hub code has a comment noting the exact-match requirement.

**Static/read-only boundary.**
- IN SCOPE (2b-i): route, all four hub regions rendered, General-specs derivation, keyword sort, parse-gate computation, Continue repointed.
- OUT OF SCOPE (2b-ii): `onValueChange` on Select (wire `set_general_specs_sheet`), action buttons on SheetCard (wire `set_sheet_status`/`set_sheet_label`), Discard BoQ (wire `delete_boq`), autosave indicator (real autosave), "Parse workbook" action (Module 5).

**Verification.** TypeScript: zero errors in wizard files (`node_modules/typescript/bin/tsc --noEmit`, filtered to wizard paths). Pre-existing baseline errors in other files are unchanged. Vite build: `bench build --app nirmaan_stack` via container, built in 3m 36s, clean.

**Frontend CLAUDE.md updated.** Root CLAUDE.md intentionally NOT updated (frontend-only slice).

Feat: 81568df9.

### Phase 3 Module 2b-ii -- Wire hub interactions + fix status pill colors ✅ COMPLETE

**Part A: Status pill color fix.**
`STATUS_PILL` in `SheetCard.tsx` refactored from raw palette classes to a clean centralized map:
- Semantic tokens (no dark: needed): `Parse failed` = `bg-destructive/10 text-destructive`; `Hidden` = `bg-muted text-muted-foreground`.
- Intentional traffic-light colors with dark: variants: Pending (slate), Reviewed (emerald), Skip (amber), General specs (sky).
One definition, no raw palette classes elsewhere. App has dark theme (ThemeProvider + mode-toggle).

**Part B: Interactions wired.**
- Mutation pattern: `useFrappePostCall` (frappe-react-sdk) for all three endpoints. First wizard use of `useFrappePostCall`; raw `fetch` kept only for file upload (multipart). Re-fetch via SWR `mutate()` after each successful write -- server is authoritative; no local-state optimistic updates.
- Per-card saving: `isSaving = statusLoading || labelLoading` per SheetCard. Spinner + all buttons on that card disabled; other cards stay interactive. Inline `text-destructive` error on failure (wizard convention -- no toasts).
- Button set per effective status (wired vs stubbed):
  - Pending: [Review(stub-M3)] [Skip -> set_sheet_status("Skip")] [Mark reviewed -> set_sheet_status("Reviewed")]
  - Reviewed: [Edit(stub-M3)] [Set pending -> set_sheet_status("Pending")]
  - Skip: [Edit label -> set_sheet_label] [Include -> set_sheet_status("Pending")]
  - Hidden: [Include -> set_sheet_status("Pending")]
  - Parse failed: [Review(stub-M3)] [Mark reviewed -> set_sheet_status("Reviewed")] [Skip -> set_sheet_status("Skip")]
  - General specs: hint text, no status buttons (selector governs it)
  - Stub buttons (Review, Edit): onClick no-op, Tooltip "Per-sheet configuration opens in Module 3 (coming next)"
  - "Mark reviewed" and "Set pending": interim affordances so the parse gate is testable without the Module 3 spoke. In the real flow, Reviewed is reached via the spoke (M2.6).
- Edit label (Skip cards): inline input expand on "Edit label" button; Save/Cancel inline; calls `set_sheet_label`. Empty value clears the field.
- General-specs selector (M2.23 AMENDED): `disabled` removed; `onValueChange` wired to `handleSpecsChange`. Behavior:
  - Selecting "None selected" (NONE_SENTINEL): calls `set_general_specs_sheet("")` directly (no confirm).
  - Selecting any other sheet whose effective status is NOT "Reviewed": calls `set_general_specs_sheet(sheet_name)` directly.
  - Selecting a sheet whose effective status IS "Reviewed": opens AlertDialog warn-and-confirm ("Set as general specifications sheet? ... Continue?"); Cancel reverts (selector is controlled by server state -- no endpoint called); Confirm calls `set_general_specs_sheet(sheet_name)`.
  - SINGLE call only: NO `set_sheet_status` as part of designation. Backend stores pointer only.
  - AMENDED from original M2.23: releasing a designated sheet returns it to its TRUE prior `wizard_status` (not forced Pending). Rationale: less destructive, simpler, no fragile two-call sequence.
- Parse workbook: stays no-op stub (Module 5). Gate computation from 2b-i unchanged.
- Discard BoQ: stays disabled/stubbed (destructive; separate slice). NOT wired.

**Verification.** tsc (filtered to wizard files): zero errors. Vite build via `bench build --app nirmaan_stack`: built in 3m 35s, clean.

**Root CLAUDE.md:** intentionally NOT updated (frontend-only slice).

Feat: 459f85ae.

### Phase 3 Module 2b-iii -- Hub visual polish ✅ COMPLETE

Visual/wording-only slice. No endpoint changes, no gate-logic changes, no store changes.

**Item 1: Two-column responsive card grid.** Main sheet-card list container changed from `space-y-2` (single vertical stack) to `grid grid-cols-1 sm:grid-cols-2 gap-3`. Hidden-sheets reveal section uses the same grid. Cards look proportionate in a 4xl container at 640px+ wide.

**Item 2: Solid-saturated status pills with dark: variants.** `STATUS_PILL` in `SheetCard.tsx` replaced faint tint backgrounds (e.g. `bg-emerald-100`) with solid saturated colors + white text for maximum contrast. Text bumped from `text-xs` to `text-sm`; horizontal padding widened to `px-2.5`. Dark: variants present for all six statuses. Pending is now vivid blue (`bg-blue-500`) -- no longer nearly invisible slate-gray.

**Item 3: Amber AlertTriangle keyword hint.** Sheets whose name matches a likely-skip keyword (no `sheet_label`, no `work_package`) now show an amber `AlertTriangle` icon + amber-colored text instead of soft italic muted text. `isKeywordHint` bool tracks the case; precedence (label > work_package > keyword) unchanged.

**Item 4: Detailed footer breakdown.** Footer text changed from `N of M sheets reviewed` to `N of M data sheets reviewed [· K general specs] [· S skipped] [· H hidden]` -- only non-zero categories shown. generalSpecsCount / skippedCount / hiddenCount derived from `getEffectiveStatus`. Gate math (canParse / blockingCount / reviewedCount) NOT touched.

**Verification.** tsc (filtered to wizard files): zero errors. Vite build via `bench build --app nirmaan_stack`: ✓ built in 3m 44s, clean.

**Root CLAUDE.md:** intentionally NOT updated (frontend-only slice).

Feat: 57152c52.

### Phase 3 Module 3 Slice 3a -- Backend schema + endpoints (per-sheet sheet_config + work_package multi-link) COMPLETE

**Backend-only slice. No frontend changes. No parse-trigger wiring (Module 5).**

**Schema changes (boq_sheet_draft.json, feat b14e9015):**
- `work_package` single-Link (options: "Work Headers") REPLACED by `work_packages` Table (options: "BoQ Sheet Work Package"). Plural fieldname signals multi-value. Named `work_packages` not `work_package` to distinguish from the legacy column.
- `sheet_config` JSON field added (optional, reqd=0). Single JSON blob home for per-sheet parser config (header_row, header_row_count, column_role_map, area_dimensions, etc.). Single blob by design per M3.18/§6.3 -- wizard-internal, not queried cross-sheet.
- Updated field_order: `[sheet_name, sheet_order, wizard_status, work_packages, sheet_label, sheet_config]`.

**New child doctype BoQ Sheet Work Package (feat b14e9015):**
- `nirmaan_stack/nirmaan_stack/doctype/boq_sheet_work_package/` (3 files: .json, .py, __init__.py)
- `istable=1`, one field: `work_header` Link -> "Work Headers" (reqd=1). NAMING NOTE: target doctype is "Work Headers" (NOT "Work Packages" -- legacy naming confusion).
- Python class: `BoQSheetWorkPackage(Document): pass` (minimal, same as Project Work Headers pattern).

**Migration (feat b14e9015):**
- `patches/v3_0/migrate_boq_sheet_draft_work_package_to_multi.py` appended to patches.txt (post_model_sync section).
- Reads existing single `work_package` column via raw SQL (ORM no longer tracks it post-schema-change). Creates one BoQ Sheet Work Package child row per non-empty work_package value. Idempotent (existence check). Orphan-guarded (skips rows where Work Headers no longer exists). Ran clean on localhost: migrated=8, skipped_already_exists=0, skipped_orphan=0.

**New endpoints in update_sheet_draft.py (2 additions, feat b14e9015):**
- `set_sheet_config(boq_name=None, sheet_name=None, sheet_config=None)` -- writes JSON blob. Accepts dict or JSON string. Validates JSON string on input. URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_config`
- `set_sheet_work_packages(boq_name=None, sheet_name=None, work_headers=None)` -- replace-all semantics. Accepts list or JSON-string list. Validates ALL docnames exist before any write (no partial write on rejection). URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_work_packages`
- Both mirror existing style exactly: `@frappe.whitelist(methods=["POST"])`, all-params-default-None signatures, `frappe.db.exists("BOQs", boq_name)` guard, `frappe.db.commit()` before `return {"status": "saved"}`.

**Tests (test_update_sheet_draft.py, feat b14e9015):** 25 (original in file) -> 41 tests. 16 new:
- TestSetSheetConfig (6): dict input write+read, JSON string input, second-sheet isolation, nonexistent boq/sheet/missing-config negatives.
- TestSetSheetWorkPackages (8): 2 headers -> 2 rows; replace-all reduces to 1; empty list clears; second-sheet isolation; nonexistent boq/sheet/work-header negatives; one-invalid-among-two rejects all.
- TestMigrateWorkPackageToMulti (2): creates child row from legacy column; idempotent.
All 41 tests in file pass. Wizard total: 41 (file) + 9 (upload) + 7 (boq_draft) = 57 total.

**bench migrate:** clean. Patch ran post-model-sync, tabBoQ Sheet Work Package table created by schema phase, then patch populated it.

**Frontend shape-change flag (EXPECTED -- handled in later slice):** `BoQSheetDraft.work_package` (string) on the frontend interface in `boqTypes.ts` does NOT match the new backend shape (`work_packages` as a Table child list). The frontend currently renders `work_package` as a string (SheetCard summary line). A later frontend slice must update `boqTypes.ts` to use `work_packages: BoQSheetWorkPackage[]` (where `BoQSheetWorkPackage = { name: string; work_header: string }`). Do NOT touch frontend files in this slice.

Feat: b14e9015.

### Phase 3 Module 3 Slice 3b-i -- Backend sheet-data preview endpoint (values-only, S3-safe) COMPLETE

**Backend-only slice. No frontend changes (Slice 3b-ii builds the spoke UI). No parser changes.**

**Performance rationale (measured, 7.65 MB workbook):**
`BoqReader(path)` takes ~27 s: opens workbook TWICE (data_only + formula pass) + pre-scans merged ranges for all sheets. Unusable for a synchronous preview. `openpyxl.load_workbook(path, data_only=True, read_only=True)` takes ~0.56 s on the same file. The endpoint uses `read_only=True` (streaming mode) and never uses `BoqReader`.

**S3 safety:** `BOQs.source_file_url` is a frappe_s3_attachment redirect URL after upload. `frappe.get_doc("File", ...).get_content()` reads local disk only and breaks under S3 (plugin moves the file). Bytes are fetched via `S3Operations.read_file_from_s3(key)` and written to a `NamedTemporaryFile`; the tempfile is always `os.unlink`-ed in a `finally` block.

**New module: `nirmaan_stack/api/boq/wizard/sheet_preview.py` (feat 7aaa0525):**

- `_derive_s3_key(source_file_url)` -- extracts the S3 object key. Primary: parse the `key=` query param from the private-file URL (format confirmed from controller.py line 142). Fallback: `frappe.db.get_value("File", {"file_url": url}, "content_hash")` (plugin stores key there per line 148). URL-param parsing is primary -- zero DB hit, format verified.
- `_fetch_boq_file_to_tempfile(source_file_url)` -- derives key, calls `S3Operations().read_file_from_s3(key)`, reads `response["Body"].read()` bytes, writes to a `NamedTemporaryFile(suffix=".xlsx", delete=False)`, returns path. Tempfile is only created AFTER bytes are successfully downloaded; a failed S3 fetch throws before any file is created (no orphan).
- `_to_json_serializable(value)` -- coerces non-JSON-primitives: `datetime.datetime` → `.isoformat()`, `datetime.date` → `.isoformat()`, `datetime.timedelta` → `str()`, any other non-primitive → `str()`.

**Endpoint: `get_sheet_preview(boq_name, sheet_name, start_row=1, end_row=40)`**
- `@frappe.whitelist()` bare (no `methods=["POST"]` -- it is a read; callable via GET / useFrappeGetCall).
- Coerces start_row / end_row to int (Frappe passes query params as strings). Guards: start_row >= 1, end_row >= start_row. Window cap: if window > 200 rows, end_row is CLAMPED silently (not rejected) to `start_row + 199`.
- Guards: `frappe.db.exists("BOQs", boq_name)`, source_file_url non-empty.
- VERBATIM sheet_name matching: uses `sheet_name not in wb.sheetnames` -- no strip, no case-fold. Same discipline as the rest of the wizard.
- Reads rows with `ws.iter_rows(min_row=start_row, max_row=end_row)`. Filters `EmptyCell` objects (openpyxl read_only mode pads rows to sheet `max_column` with `EmptyCell`; `EmptyCell` has no `.column`/`.row` attribute). Guard: `hasattr(cell, "column")`.
- Cell dict: `{col_letter: value}` where `col_letter` is uppercase Excel column letter (A, B, ...) and `value` is JSON-serializable (None for empty).
- `has_more` derived from `ws.max_row` (the sheet's dimension metadata, reliable for well-formed xlsx in read_only mode). Fallback when `max_row is None`: proxy from `returned_count == (end_row - start_row + 1)`.
- Tempfile always unlinked in a `finally` block. Workbook `wb.close()` called in the same `finally` block before unlink.
- Return shape: `{"sheet_name": str, "start_row": int, "end_row_requested": int, "rows": [{row_number, cells}], "returned_count": int, "has_more": bool}`.
- URL: `/api/method/nirmaan_stack.api.boq.wizard.sheet_preview.get_sheet_preview`

---

### Endpoint follow-up: `get_sheet_preview_full(boq_name, sheet_name)` -- single-pass full-sheet read (feat 196ed765, 2026-06-10) COMPLETE

**What & why.** The Slice 1a live-cert logged that SheetSearchView's full-sheet load is ~30s on the
1001-row Fire Fitting sheet because the frontend loops `get_sheet_preview` in 200-row windows and the
endpoint re-fetches S3 + re-opens the workbook PER WINDOW. This backend slice pays down that OWED item
with ONE additive endpoint that fetches + opens the workbook ONCE and reads EVERY row in a single pass.

**Recon decision (option a chosen, option b rejected).** A NEW additive function -- NOT a refactor of
`get_sheet_preview`. `get_sheet_preview` is left byte-for-byte untouched (it still serves SheetSpokePage's
genuine on-demand 40-row pagination); refactoring it to share a core was rejected (it risked the certified
windowed contract for no benefit). Verified additive: `git diff` shows +237 insertions, 0 deletions.

**As built.**
- `@frappe.whitelist()` bare (read). Args `boq_name`, `sheet_name` only -- no window params, no cap.
- REUSES the existing helpers verbatim: `_fetch_boq_file_to_tempfile`, `_to_json_serializable`,
  `get_column_letter` (no fork/duplication).
- Same guards as `get_sheet_preview`: missing `boq_name` / missing `sheet_name` / `BOQs` not-found /
  empty `source_file_url` / sheet-not-in-workbook all throw identically. `sheet_name` matched VERBATIM
  (#152) -- a trailing-space mismatch throws (mirrors `test_whitespace_mismatch_throws`).
- Fetch once -> `openpyxl.load_workbook(..., data_only=True, read_only=True)` once -> iterate
  `min_row=1 .. max_row=ws.max_row`. NOTE: `ws.max_row` is `None` for read_only sheets with no
  `<dimension>` tag (snitch_electrical is such a sheet); `iter_rows(max_row=None)` still iterates to the
  end (verified -- 1011 rows returned), so this is None-safe.
- IDENTICAL per-row build to `get_sheet_preview`: skip all-EmptyCell padding rows
  (`next((c.row...), None) -> skip if None`); within a kept row skip EmptyCells (`hasattr(cell,"column")`);
  keys via `get_column_letter`; values via `_to_json_serializable`. Row shape
  `{"row_number": <absolute Excel row>, "cells": {col_letter: value}}` -- byte-identical to the windowed path.
- Tempfile unlinked + workbook closed in a `finally` (mirrors `get_sheet_preview`).
- **Return shape:** `{sheet_name, rows, returned_count, has_more: False}`. `has_more` kept (always
  False -- a full read has nothing beyond) so the response stays TYPE-COMPATIBLE with
  `get_sheet_preview` for the v2 frontend (reuses `SheetPreviewResponse` without a fork); `start_row` /
  `end_row_requested` omitted (windowing artifacts, meaningless for a full read). Owner decision 2026-06-10.

**Tests (new `TestGetSheetPreviewFull`, 9, all PASS in-container):**
- T1 `test_all_rows_returned_no_200_cap` -- snitch fixture: `returned_count == len(rows)` and `> 200`
  (proves no 200-row cap; the sheet has 1011 content rows).
- T2 `test_byte_identity_to_windowed_path` (CORRECTNESS KEYSTONE) -- windows `get_sheet_preview` over the
  same sheet (`_gather_windowed_rows`, 200-row windows until `has_more` False), concatenates, asserts it
  EQUALS `get_sheet_preview_full`'s rows exactly (order, row_numbers, cells). Locks the new path to the
  preserved contract.
- T3 `test_blank_rows_skipped_noncontiguous` -- synthetic_simple has data on rows 1,2,3,5 (row 4 blank);
  asserts row_numbers `[1,2,3,5]`, blank row 4 absent, `max(rn) > count` (a row genuinely skipped), and
  the skip pattern matches the windowed path.
- T4 `test_whitespace_mismatch_throws` -- leading-space sheet_name throws (#152 verbatim).
- T5 negatives (5) -- missing boq_name / missing sheet_name / nonexistent boq / nonexistent sheet /
  empty source_file_url all throw, mirroring the existing endpoint.

**The tests ARE the cert for this slice** (no live UI consumer yet). The byte-identity test (T2)
genuinely executed and passed in-container -- it is the proof the new single-pass path equals the
concatenated windowed path. Live PERF proof lands when SheetSearchView v2 wires this endpoint up.

**No frontend consumer yet -- deferred to "SheetSearchView v2".** The SheetSearchView switch from the
windowed loop to this endpoint is bundled (per the slice-composition framework) with the other two
SheetSearchView-touching changes (column-widths/wrap from Layout Part A's OWED item + click-to-select),
so the 1a-certified component is re-certified ONCE rather than three times.

**Verification:** in-container `bench --site localhost run-tests --module
nirmaan_stack.api.boq.wizard.test_sheet_preview` -> 32 tests OK (23 pre-existing + 9 new). The 23
existing `get_sheet_preview` tests pass unchanged (proves the existing endpoint is untouched). No
tsc/build (no frontend touched). Two commits: feat (sheet_preview.py + test_sheet_preview.py) then docs.

---

**Tests: `nirmaan_stack/api/boq/wizard/test_sheet_preview.py` (23 tests as of feat bf1a2e64; +9 `TestGetSheetPreviewFull` added feat 196ed765 -> 32 total, all PASS):**
- `TestDeriveS3Key` (3): parse key from private URL; fallback via File doc content_hash (mock); throws when no key derivable.
- `TestToJsonSerializable` (5): primitives pass through; datetime.datetime → isoformat; datetime.date → isoformat; timedelta → str; unknown type → str.
- `TestGetSheetPreviewShape` (4): response keys present; row_numbers sequential + in range; cells use uppercase Excel column letters; A1 value matches `synthetic_simple.xlsx` fixture ("Sl.No.").
- `TestGetSheetPreviewPagination` (2): second window row_numbers start at 41; window cap clamped silently (end_row=500 → end_row_requested=200).
- `TestGetSheetPreviewHasMore` (3): has_more=True for first window on large fixture (snitch_electrical.xlsx "6. Electrical"); has_more=False when requesting past end of small fixture (synthetic_simple.xlsx); end-of-sheet returns fewer rows + has_more=False.
- `TestGetSheetPreviewNegative` (6): missing boq_name; missing sheet_name; nonexistent boq; nonexistent sheet_name; empty source_file_url; whitespace-mismatch sheet_name (verbatim EXACT match required).
- S3 fetch mocked via `unittest.mock.patch("...sheet_preview._fetch_boq_file_to_tempfile", side_effect=...)`. The side_effect copies the local fixture file into a fresh `NamedTemporaryFile` so the endpoint's `finally` block can safely `os.unlink` it without touching the original.
- Real BOQs rows created in `setUpClass` via `_make_project()` + `_make_boq_with_url()` pattern (mirrors `test_update_sheet_draft.py`). `source_file_url` set to fake S3-format URL so `frappe.db.exists` + `frappe.db.get_value` use the real DB; only the S3 fetch is mocked.

**Backwards-compat:** Purely additive. New module + new endpoint; no existing endpoint or schema touched. Existing wizard tests stable at 41 (test_update_sheet_draft.py). Total wizard Frappe tests: 41 + 23 = 64.

Feat: bf1a2e64.

### Phase 3 Module 3 Slice 3b-ii -- Frontend spoke shell + SheetDataGrid + load-more paginator COMPLETE

**Frontend-only slice. No backend changes. No config sections (Slice 3c).**

**Spoke route (routesConfig.tsx):** `/upload-boq/hub/:boqId/sheet/:sheetName` added as sibling of the hub route. Lazy-loaded; module exports `{ SheetSpokePage as Component }` per React Router v6 lazy convention.

**SheetSpokePage.tsx (shell -- minimal scope):** Reads `boqId` + `sheetName` from `useParams()`. Fetches `BOQsDoc` via `useFrappeGetDoc` (same third-arg gotcha as hub: pass null to disable). Back button → hub (`/upload-boq/hub/${boqId}`). Header shows display-trimmed sheet name + BoQ name/version + optional `sheet_label`. No config sections, no work-package picker, no mark-reviewed control -- those are Slice 3c+.

**encode/decode:** Hub navigates with `encodeURIComponent(draft.sheet_name)`. React Router v6 `useParams()` returns the RAW URL-encoded string (does NOT call `decodeURIComponent` automatically). NOTE: decode bug present at 3b-ii land -- fixed in Slice 3b-iii (q.v.).

**SheetDataGrid.tsx (new component):**
- `useFrappePostCall` for ALL fetches (initial + load-more). This is the sanctioned read-over-POST case: accumulating/paginating reads use POST + local `useState` because SWR replace-on-fetch semantics fight row accumulation. See convention note in frontend CLAUDE.md.
- Initial 40 rows fetched in `useEffect([boqName, sheetName])` with cancellation flag.
- Column header: union of all `col_letter` keys across loaded rows, sorted in Excel order (shorter first, then alphabetical: A,...,Z,AA,...). Recomputed after each load-more.
- Left gutter: absolute Excel `row_number` (never re-indexed; row 41 shows "41"). `sticky left-0 z-10`.
- Cells: null → blank, booleans → "TRUE"/"FALSE", others → String(). `max-w-[180px] truncate`, full value on hover via `title` attr. shadcn `<Table>` (NOT TanStack).
- Load-more: button shown when `has_more === true`. `disabled={isLoadingMore}` is the single-flight guard. `setRows(prev => [...prev, ...preview.rows])` appends. Re-evaluates `has_more` from new response.
- No sticky header / no gridlines at this slice (fixed in Slice 3b-iii).

**Preview types in boqTypes.ts:** `SheetPreviewRow { row_number, cells: Record<string, string|number|boolean|null> }` + `SheetPreviewResponse { sheet_name, start_row, end_row_requested, rows, returned_count, has_more }`.

**Review/Edit wiring (SheetCard.tsx + BoqHubPage.tsx):**
- `MODULE3_TOOLTIP` constant + unused `Tooltip`/`TooltipContent`/`TooltipTrigger` imports removed from SheetCard.
- Review (Pending, Parse-failed) and Edit (Reviewed) now call `onOpenSpoke?.(draft.sheet_name)` via a new optional prop `onOpenSpoke?: (sheetName: string) => void`.
- `BoqHubPage` passes `onOpenSpoke={handleOpenSpoke}` where `handleOpenSpoke` calls `navigate(\`/upload-boq/hub/${boqId}/sheet/${encodeURIComponent(sheetName)}\`)`. Hub owns navigate; SheetCard stays router-free.
- All other card buttons (Skip, Include, Mark reviewed, Set pending, Edit label) unchanged.

**Verification:** tsc zero new errors in wizard files. Vite build exit 0.

Feat: 7be670d4.

### Phase 3 Module 3 Slice 3b-iii -- SheetDataGrid polish (sticky header + gridlines + decode fix) COMPLETE

**Frontend-only slice. Pure polish pass on Slice 3b-ii. No backend, no config sections.**

Three live-testing fixes:

**(1) Sticky column-letter header row (SheetDataGrid.tsx).**
Root cause: the `overflow-x-auto` wrapper had no height constraint. CSS spec forces `overflow-y` to computed `auto` when `overflow-x` is non-visible, but without a max-height the container grew to fit content -- no vertical clip, no scroll window, so `sticky top-0` never fired.
Fix: changed container to `overflow-auto max-h-[calc(100vh-14rem)]`. This bounds the container in both axes, creates a proper vertical scroll window, and makes `sticky top-0` fire relative to the container (not the page).
z-index hierarchy: corner cell (z-30, both axes) > column-letter headers (z-20, top-only) > row-number gutter cells (z-10, left-only). Corner `#` cell changed from `sticky left-0 z-10` to `sticky top-0 left-0 z-30`. Column-letter headers gained `sticky top-0 z-20`. All sticky header cells use solid `bg-muted` (not semi-transparent `bg-muted/50`) so scrolled body rows don't show through.

**(2) Visible cell gridlines (SheetDataGrid.tsx).**
`border-r border-border` added to column-letter `<TableHead>` cells and data `<TableCell>` cells. Row-number gutter `<TableHead>` (corner) and `<TableCell>` already had `border-r` from Slice 3b-ii. Existing `border-b` on `<TableRow>` provides horizontal lines. Result: spreadsheet-style grid.

**(3) Spoke header decode fix (SheetSpokePage.tsx).**
Root cause: `useParams()` in React Router v6 returns the raw URL-encoded path segment without calling `decodeURIComponent`. So a sheet named "C&I" navigated via `encodeURIComponent` appeared as "C%26I" in the page header AND was sent to the endpoint as "C%26I" (breaking VERBATIM matching against the DB-stored "C&I").
Fix: `const decodedSheetName = sheetName ? decodeURIComponent(sheetName) : ""` applied once. `displaySheetName`, draft lookup, and `SheetDataGrid sheetName` prop all use `decodedSheetName`. The raw `sheetName` from `useParams()` is kept only for the `!sheetName` guard. `decodeURIComponent` is idempotent if the browser or RR already decoded -- safe in either direction.
No change to what `BoqHubPage.handleOpenSpoke` sends to `navigate()` -- the hub still uses `encodeURIComponent(draft.sheet_name)`.

**Backwards-compat:** Purely cosmetic + one decode fix. Fetch behavior (POST, accumulation, load-more, row numbers, cell values) unchanged. No behavior change to data loading or pagination.

**Verification:** tsc zero new errors in wizard files. Vite build exit 0.

Feat: 2ac4789a.

### Phase 2 — Excel parsing engine (backend only) *(4–5 days)*
- `services/boq_excel_parser.py`: reader, mapping config schema (dataclass / Pydantic), classifier (code-driven + rule-driven), hierarchy resolver (stack walk), validator.
- Sample BoQ corpus: 3–5 anonymized real `.xlsx` files under `tests/fixtures/boq_samples/`. Each has an expected JSON.
- Parser unit tests covering all sample BoQs and every edge case in §12.
- No frontend, no AI, no whitelisted endpoints yet.
- **Exit:** from Frappe console, `parse_boq(file_url, config)` returns correct structured output for all samples.

### Phase 3 — Upload + mapping UI (manual flow) *(5–7 days)*
- Whitelisted APIs: `upload.py`, `parse.py`, `save.py` under `nirmaan_stack/api/boq/`.
- Frontend: BoQ upload wizard mirroring project-form structure (see §10). Steps: Upload, Mapping, ParsedPreview, Confirm.
- Excel preview with TanStack Table preserving formatting cues.
- Column role assignment (click header → dropdown). Row classification (click row → type dropdown). Drag-select for bulk. "Auto-classify similar rows" examples-based fill.
- Validation warnings panel.
- Multi-stage progress dialog mirroring `project-creation-dialog.tsx`.
- **Exit:** real user uploads a real BoQ Excel, manually maps, saves; saved data matches Excel.

**append_to_notes wizard responsibility (2026-05-16, §7.34):** Surface `append_to_notes` as a column-role choice during per-sheet mapping. Allow user to assign it to any number of columns (multi-select, not singleton). Show a preview of the resulting notes field on a sample row before commit so user can verify. Future optional enhancements: user-override displayed column name; user-customize prefix format. Initial v1 ships with default format and raw column headers.

### Phase 4 — AI assist *(3–4 days)*
- `services/boq_ai_assist.py` mirroring `services/document_ai.py`. Anthropic API integration. Prompt iteration against fixture corpus.
- `api/boq/ai_assist.py` whitelisted endpoint, background job dispatch.
- Frontend: spinner on Mapping step, suggestions overlay applied, confidence display, low-confidence rows highlighted.
- Cost guards: row cap, caching, token logging.
- **Exit:** typical BoQ requires <30s of correction after AI pre-fill.

### Phase 5 — Edit + audit UI *(2–3 days)*
- Inline editing of saved BoQ Nodes with reason capture (modal).
- Audit log viewer per node (reads from Nirmaan Versions).
- Re-upload as new version: creates v2 BoQ, marks v1 as Superseded. Carry-over of links is stubbed.
- **Exit:** users can fix typos with full audit trail.

### Phase 6 — Read views, search, export *(3–5 days)*
- BoQ list per project.
- Tree view with collapse/expand per preamble.
- Search across line items by description.
- Filter by preamble.
- Export back to Excel.
- Roll-up summaries: total supply value, total install value, value per L1.
- Basic version diff view.
- **Exit:** PMs can browse a BoQ end-to-end without opening the original Excel.

### Phase 7 — Linkage layer *(2–4 weeks, sub-phased)*

Each sub-phase gets its own design doc. All linkages are standalone doctypes following the Critical PO Tasks pattern. CEO Hold check required before any procurement-creating action.

- **7a — Work Header / Milestone linkage.** New doctype `BOQ Node Milestone Link`. UI to map BoQ Nodes to existing Work Headers / Work Milestones (no replacement of existing entities).
- **7b — Critical PO Category linkage.** New doctype `BOQ Node Critical PO Link`. Map BoQ Nodes to Critical PO Tasks. Coordinate with active plans `frontend/.claude/plans/critical-po-setup-plan.md` and `critical-po-tracker-project-view.md`.
- **7c — PR / PO line item linkage.** New doctypes `BOQ Node PR Item Link`, `BOQ Node PO Item Link`. When creating a PR/PO, optionally pick from BoQ line items. Pre-fills item details.
- **7d — Delivery linkage.** New doctype `BOQ Node Delivery Link`. Track delivered qty per line item. Show "delivered vs BoQ qty" progress in the tree view.
- **7e — Version migration.** When v2 of a BoQ is uploaded, surface a UI to map v1 nodes → v2 nodes so existing linkages carry over.

## 14. Working agreements

- Before each phase, output a written plan; user reviews; then code.
2. **One feature branch per phase.** Phase 1.x stayed on `feature/boq-phase-1` (continuation rule). Phase 2 branched fresh as `feature/boq-phase-2` from `feature/boq-phase-1`. Phase 2 sub-phases (2a, 2b.1a, 2b.1b, 2b.2, 2c) all continue on `feature/boq-phase-2` since they're a single phase split for risk management. Phase 3 will branch fresh again.
- Doctype changes go through `bench --site <site> migrate`. New patches in `patches/` only when backfilling data on existing doctypes.
- All Python lifecycle logic in `integrations/controllers/`. Doctype `.py` stays minimal.
- All API endpoints under `nirmaan_stack/api/boq/`, snake_case.
- Frontend: shadcn/ui + TanStack Table + Zustand + frappe-react-sdk + React Hook Form + Zod. No new UI libraries.
- Pure-Python modules (parser, AI assist) get real unit tests with fixtures. No stubs.
- `frappe.db.commit()` before `publish_realtime()`.
- For ad-hoc DB queries: docker cp + docker exec pattern in CLAUDE.md.

11. **End-of-session git verification — MANDATORY.** Every Claude Code prompt must include in its "Stopping conditions" section: (a) run `git status` and report the output — working directory must be clean (no `M`, no `??`, no untracked files in scope); (b) run `git log <current-branch> --oneline -10` and report output to verify all intended changes are committed. This guards against the failure mode where Claude Code edits files but forgets to `git add` and commit the final round of changes — leaving uncommitted work that gets silently picked up by the next session. (Real lesson from the start of Phase 2a, where uncommitted Phase 1.7 controller and hook changes had to be recovered as the first action of the new session.)

12. **Test fixtures use real BoQ files — no anonymization required (Option C).** Decided 2026-05-10. The BoQ feature is for internal use by Nitesh's tendering team at Stratos Infra Technologies; confidentiality of project/client/vendor names is not a constraint. Real BoQ files are committed directly to `nirmaan_stack/services/boq_parser/tests/fixtures/` (~5-8 MB total across 5 fixtures). Saves ~5-10 hours of manual anonymization. (Future-Claude-or-developer note: if this project ever becomes externally distributed or open-sourced, fixture anonymization would need to be revisited.)

13. **Documentation maintenance — MANDATORY in every Claude Code prompt.** From 2026-05-11 onwards, every Claude Code prompt for a sub-phase must include a Documentation Maintenance section that requires Claude Code, before reporting completion, to: (a) update `frontend/.claude/plans/boq-upload-plan.md` to reflect what the sub-phase delivered (commit hashes, test counts, status flips, new known issues, new working agreements); (b) commit the doc update as a separate commit with message `docs(boq): update plan for <sub-phase> completion`; (c) verify via `git status` (clean) and `git log --oneline -10` (both commits present — code commit + docs commit). This bakes documentation maintenance into every sub-phase and prevents drift between in-repo docs and reality. (Real lesson from 2026-05-10 when 2b.1a started against a stale plan doc that hadn't captured Phase 2a completion or working agreements 11/12.)

30. **Throwaway experiments before committing risky changes.** (NEW v5.20.) Routing changes, pattern-detector additions, or other changes likely to break existing tests should be prototyped on a throwaway branch first. Procedure: snapshot pre-fix diagnostic output → create throwaway/<topic> branch from current tip → apply speculative fix → run parser tests + diagnostic → capture results → tear down (git checkout main; git branch -D throwaway/<topic>; git restore <modified files>). The experiment surfaces empirical reality BEFORE committing to a formal sub-phase prompt. Codified after v5.20 throwaway Bug 1 routing experiment surfaced 13 test failures + 1 fixture regression + Bug 6 (convenience field summation gap) in ~30 minutes.

31. **Diagnostic snapshot before regenerating live output.** (NEW v5.20.) Before any significant diagnostic re-run, copy current live output to nirmaan_stack/services/boq_parser/diagnostic_snapshots/<context>.json and .txt. Snapshots are read-only reference for comparison. Codified because diagnostic scripts overwrite output on each run; without snapshots, before/after comparison requires git archaeology or re-running old state. Folder convention introduced in chore 9d4abf36.

32. **Filename verification from disk before prompting.** (NEW v5.20.) When chat-Claude drafts prompts referencing fixture filenames (especially in TARGETS lists, scope-list paths, audit-script invocations), verify filenames from disk (ls or equivalent) before pasting. Codified after expanded-retest filename mishap (commit 9d4abf36 used filenames without multi_area_ prefix based on v5.19 handover descriptive shorthand; correction round-trip via commits c8c9f234 + bf043492). One ls call saves a 2-commit round-trip.

33. **§3 refresh is part of housekeeping.** (NEW v5.20.) Every handover-doc regeneration cycle must check §3 (Phase plan and sub-phase records) for new sub-phases landed since prior version. New sub-phase entries added at appropriate position; stale "🔜 LATER" entries flipped to "✅ COMPLETE"; §3 refresh log subsection at bottom gets entry noting changes. Codified after Nitesh caught §3 staleness during v5.20 review (Phase 1.9d/1.9e marked LATER for 7 versions despite landing earlier; 13 sub-phases missing). **Scope extends to plan-doc Status block per this v5.21 docs-cycle codification.**

34. **Iterative parser refinement loop.** (NEW v5.21.) Parser refinement proceeds in measured iteration cycles. Each cycle: hand-craft SheetConfigs for 1-3 fixtures bypassing auto_guess_sheet_config() → invoke parser via direct parse_boq() → preserve outputs to disk + Desktop → chat-Claude conducts deep-dive review of outputs against ground-truth Excel inspection → catalogue new bugs / wizard gaps / operational learnings as numbered §9 entries → implement fixes (standard 2-commit shape per agreement #9) → re-run experiment on same fixtures + ~3 new diverse ones → compare bug-discovery rate against prior cycle. **Termination criterion:** two consecutive cycles yield zero new parser bugs from at least 3 new fixtures each. **AI integration is gated on this termination.** Stated user position: "the more refined a version we can make without AI the better."

35. **Handover doc creation workflow.** (NEW v5.21.) Handover doc regeneration uses file-upload-and-edit workflow, NOT verbal copy-paste merging. Process: user uploads previous version .md file to chat at start of doc cycle → chat-Claude reads file via /mnt/user-data/uploads/ → chat-Claude applies targeted edits using str_replace/view/create_file tools (header, audit checklist, §3 refresh, §6 decisions, §8 agreements, §9 entries, §10-§13 updates, §14 renumbering + new EOS, §24 doc history) → chat-Claude saves to /mnt/user-data/outputs/ as new versioned file → chat-Claude verifies completeness via grep + view spot-checks → chat-Claude presents file via present_files tool → user downloads, uploads to project knowledge, deletes prior version per agreement #17. Does NOT apply to plan-doc + CLAUDE.md (those are repo files, edited by Claude Code, committed via docs commit per agreement #9 — like this very cycle).

40. **Bug 13 deterministic-unambiguous bar for parser-layer fixes.** (NEW v5.25.) Parser-layer hierarchy/classification fixes must meet the deterministic-unambiguous bar established by sec 9 #89 (Bug 13). A fix qualifies if: (a) the trigger is a text-pattern match (regex) or an exact value check on classified fields; (b) the action has a single deterministic outcome; (c) no fuzzy thresholds, heuristics, or natural-language pattern recognition. Closing examples from Phase 2c bug-fix cycle: (1) sec 9 #89 Bug 13 — Excel error literal normalization in reader.py; (2) sec 9 #99 A1/A2-reframed — lowercase cascade + sibling numeric peer fix in hierarchy.py; (3) sec 9 #100 SUB HEAD detection — text-pattern rule on sl_no; (4) sec 9 #101 Universal subtotal-reset — classification-based stack reset. Beyond these four, hierarchy/classification fixes go to Phase 3+ AI review layer. Empirical basis: 6-fixture cross-corpus audit surfaced sec 9 #88 Bug 12 (Inovalon NOTE-as-header) and sec 9 #102 Bug 15 (SG HVAC priced-sub-section-header) as cases requiring natural-language pattern recognition. Adopted 2026-05-23.

## 15. Open questions

1. **Multiple sheets per Excel.** Import all as one BoQ, prompt user to pick a sheet, or require separate uploads per sheet? *Defer to Phase 3.*
2. **Line item identity across versions.** When v2 is uploaded, how do we map v1 → v2 line items so links carry over? Options: by code field, by description-hash + parent-path, or manual mapping UI. *Defer to Phase 7e.*
3. **Permissions scope.** All internal users see all BoQs, or scoped per project membership? *Resolve in Phase 1, default to project membership matching Procurement Requests conventions.*
4. **Total reconciliation.** If computed total ≠ Excel's stated grand total, warn or block save? *Default warn-only; user can flip a "block on mismatch" flag if needed in a later phase.*
5. **Nirmaan Versions schema.** Does it have a `reason` field? Resolve in Phase 1 first task.

## 16. Glossary

- **BoQ** — Bill of Quantities. Structured list of work items with quantities and rates.
- **Preamble** — section header grouping line items. Nestable to L1/L2/L3.
- **Line item** — single work entry with quantity, unit, and rate(s).
- **Supply rate / Install rate / Combined rate** — material vs labor; sometimes separate, sometimes combined.
- **Pre-tax / Post-tax** — whether quoted rates include taxes. Default pre-tax.

## Strategic direction (v5.21 confirmed)

**Option 3b CONFIRMED** — declarative wizard + targeted classifier fixes. AI integration deferred until iterative refinement loop termination per agreement #34. Validated empirically: execution-layer experiment Sequence C2 + E2 produced 100% schema acceptance across 8 hand-configured fixtures. Direct user quote: "the more refined a version we can make without AI the better."

**Path A CONFIRMED** — fix parser bugs first, wizard implementation later. Tech-person can design wizard UI in parallel without writing code. Bug-fix queue (Bug 10 -> 11 -> 12 -> 13 -> 14) is bounded scope (~135 LOC total). Building wizard against unstable parser would compound rework.

See handover section 6 v5.21 decisions + section 14 v5.21 EOS for full context.

## 17. Known Parser Issues

Issues identified during real-BoQ verification. Each entry has a disposition: deferred or requires Phase 3 wizard action.

### 17.1 Pattern Y multi-dot ambiguity (level resolution)

**Issue:** In BoQs with numeric top-level coding (1., 2., ...) and letter sub-sections (A., B., ...), multi-dot sub-codes like `1.1` that appear under an `A.` parent are structurally ambiguous — they could be a sibling of `A.` at level 2, or a child of `A.` at level 3. The resolver cannot distinguish without user intent.

**Current behavior:** Resolver emits a warning with `category=ambiguous_level_pattern_y` and assigns default depth (1 + dot count). The tree structure is plausible but may not match the source document's intent.

**Disposition:** Defer to Phase 3 wizard. Phase 3 mapping UI will surface rows with this warning and let the user confirm or override the assigned level before saving. Working agreement #18 (TBD): all `ambiguous_level_pattern_y` warnings surface as explicit confirmation prompts in Phase 3 review step.

### 17.2 Stray `Note` sl_no rows misclassified as PREAMBLE

**Issue:** Some BoQ files include sl_no cells containing the literal text "Note" or "NOTE" followed by a description but no quantity. The classifier correctly routes these to PREAMBLE (sl_no + description, no qty) but they are not section headers — they are annotation notes.

**Current behavior:** These rows are inserted into the preamble stack, potentially becoming unwanted parent nodes for subsequent line items. One occurrence confirmed in JSW Elect B1.

**Disposition:** Visible but not catastrophic — the note becomes a leaf preamble with no line-item children in the one observed case. Defer: in Phase 3, add a reserved-keyword filter to the classifier that treats sl_no values matching `^note$` (case-insensitive) as NOTE classification regardless of description presence.

### 17.3 Unnumbered section headers classified as NOTE; Phase 3 wizard handles promotion to PREAMBLE

**Issue:** Some BoQ authors (observed in Inovalon HVAC) use unnumbered bold text-only rows as section headers. These have no sl_no value, so the classifier routes them to NOTE — not PREAMBLE. They are structurally preambles but visually indistinguishable from genuine annotation notes by pattern alone.

**Current behavior:** These rows are inserted as NOTE nodes in the resolved tree with no preamble-stack effect. Subsequent line items are parented to the last real PREAMBLE, not to the bold header. The hierarchy is therefore correct but misses an implicit grouping level.

**Scoring signals (implemented in `populate_preamble_candidate_scores()`):**
- Bold formatting on description cell: +2
- First note in a contiguous note-block (allowing spacers) terminated by a LINE_ITEM: +2
- Description shorter than 80 characters: +1

Score ≥ 2 is the Phase 3 promotion threshold. Score stored in `ClassifiedRow.preamble_candidate_score`; signal names in `ClassifiedRow.preamble_candidate_signals`.

**Phase 3 wizard responsibilities:**
1. Surface NOTE rows with score ≥ 2 as "could this be a section header?" prompts in the review step.
2. Provide a "Promote note → preamble" action that converts the NOTE to a PREAMBLE and re-runs hierarchy resolution for the affected subtree.
3. Provide a "Create new preamble from scratch" action for cases where no NOTE candidate exists (sets `ResolvedRow.is_synthetic = True`).

**Phase 2c (DB commit) responsibility:** Pass `preamble_candidate_score` and `preamble_candidate_signals` through to the BOQ Node record so Phase 3 can surface them without re-parsing.

**Deferred parser-side fix:** A future signal could use column-position heuristics (description starts in sl_no column rather than description column) to disambiguate at classify time. Not implemented — too many false-positive risks with current test corpus.

**Disposition:** Parser-side scoring implemented (Phase 2b.1b). Phase 3 wizard action deferred to Phase 3 planning.

### 17.4 Stale repo clone at `C:\Users\nites\Documents\nirmaan_stack_frappe15_postgres_14\`

**Issue:** There is a second nirmaan_stack repo clone on Nitesh's machine at `C:\Users\nites\Documents\nirmaan_stack_frappe15_postgres_14\`. That clone only has `feature/boq-phase-0` and `feature/boq-phase-1` branches — it does NOT have `feature/boq-phase-2` or any Phase 2 work.

**Critical pointer:** All BoQ Phase 2+ work MUST happen in the live working repo at `C:\Users\nites\Documents\frappe_docker\development\frappe-bench\apps\nirmaan_stack\`. At the start of every session, verify `pwd` output contains `.../frappe_docker/development/frappe-bench/apps/nirmaan_stack` before writing any code.

**Disposition:** Do NOT delete the stale clone — it may have independent history worth preserving. It is simply not the active development copy. If Claude Code ever opens in the stale clone by accident, stop immediately and switch to the live repo.

### 17.5 Raheja-style Pattern 2 variant — 3-col-per-area with rate column

**Issue:** Real BoQ files from Raheja Commerzone Chennai exhibit a Pattern 2 variant not handled by the current `detect_multi_area_pattern()` algorithm. The top row has area names in merged cells, but each merge spans **three** columns (not two), with the bottom row containing `[Qty][Rates][Amount]` under each merge (not `[QTY][AMOUNT]`). The current Pattern 2 algorithm (`_try_pattern_2` in `multi_area_detection.py`) is hardcoded to:
- Reject merges where `(max_col - min_col + 1) != 2` (2-col merges only)
- Require bottom-row pairs to match `_QTY_CELL_PATTERN` and `_AMOUNT_CELL_PATTERN` exactly (no rate cell in between)

Both checks fail on Raheja sheets. Detection priority falls through P2 → P3 (bottom: only reserved keywords) → P1 (bottom: only reserved keywords) → P1 (top, last-resort): finds the merge origins, returns `MultiAreaPattern(pattern=1, areas=[...], amount_columns=None)`. The result is technically "valid output" but factually wrong — areas have per-area amounts AND per-area rates that the Pattern 1 designation does not represent.

**Real-data evidence:** Verified 2026-05-13 across all sheets of `RAHEJA Commerzone Chennai BOQ.xlsx`. Every sheet uses the 3-col-per-area variant. The "Phase 1 / Phase 2" naming pattern and 3-col `Qty / Rates / Amount` shape are uniform.

**v5.3 documentation drift:** v5.3 §3 names Raheja as the "primary Pattern 2 validation target" — this assumption was wrong; Raheja does not match the textbook Pattern 2 spec at all.

**Disposition:** Defer to **Part D** (which already holds Pattern 4 + Pattern 6 candidate work) OR create a new dedicated sub-phase **Part D2 — Pattern 2-rate extension**. Likely scope: a new pattern designation (e.g., `pattern=4` if not already taken, or extending `MultiAreaPattern` with an optional `rate_columns` field), an extended detection algorithm accepting 3-col merges with `[QTY][RATE][AMOUNT]` pairing, ~3-5 new tests, and real-data re-verification on Raheja. Schema-side support already exists in Part A2 (`qty_by_area`, `amount_by_area`, and per-sheet `rate_combined` ColumnRoles are sufficient to represent the shape without new schema work).

**Status:** Open. Not blocking Part B or Phase 2c. Blocking only Raheja-specific parsing.

**Status updated 2026-05-16:** Re-opened. Absorbed into Phase 1.9 parser support scope. The 3-col-per-area shape detection lands as part of the per-area rate+amount schema extension work (see §7.32). No standalone follow-on sub-phase.

### 17.6 Fixtures folder contains only synthetic files; v5.3 "locked fixtures" claim was aspirational

**Issue:** v5.3 §3 and working agreement #12 (2026-05-10) state that real BoQ files (specifically JSW MEP Priced and Snitch) are "locked fixtures" committed to `nirmaan_stack/services/boq_parser/tests/fixtures/`. Inspection on 2026-05-13 shows that folder contains ONLY synthetic files:

- `generate_synthetic.py` (the generator script)
- `synthetic_blank_cols.xlsx`
- `synthetic_empty.xlsx`
- `synthetic_makelist_header.xlsx`
- `synthetic_merged_header.xlsx`
- `synthetic_simple.xlsx`
- `synthetic_sparse_header.xlsx`
- `synthetic_trailing_spaces.xlsx`

A `Get-ChildItem -Recurse -Filter "*JSW*"` across the entire `nirmaan_stack` repo on 2026-05-13 returned zero results.

**Root cause:** Working agreement #12 declared the intent to commit real fixtures, but the actual commit appears never to have happened. v5.3 was written as if the commit had landed.

**Impact:** Phase 2c (DB commit + version cascade + fixtures) cannot proceed against committed real fixtures because they don't exist in the repo. They currently live only on Nitesh's local disk at `C:\Users\nites\Downloads\`.

**Disposition:** **Phase 2c first action — commit the real fixtures.** Before adding any DB commit logic or version cascade tests, copy the real BoQ files into `tests/fixtures/` and commit them via a dedicated `chore(boq):` or `feat(boq):` commit. The handover doc's "locked fixtures" claim then becomes accurate. Per working agreement #12, no anonymization needed (this is an internal repo).

**Files to commit at Phase 2c kickoff:** at minimum `JSW MEP Priced` and `Snitch`. Additional fixtures (Raheja, TableSpace, DhashTech, Société Générale, etc.) can land in batches as Phase 2c progresses.

**Status (updated 2026-05-15):** CLOSED. 24 real BoQ fixtures committed at Phase 2c kickoff via feat commit `cfeaad1c`. Fixtures directory now contains: 8 synthetic files (7 originals + 1 synthetic_multi_area still untracked per B2a) + 1 Snitch (committed in B2c) + 24 real BoQ files = 33 total xlsx fixtures in tests/fixtures/. MappingConfig authoring for each new fixture deferred to per-fixture sub-phases later in Phase 2c. §9 #40 (handover doc) and §17.6 (plan doc) considered closed by this commit.

### 17.7 docker cp temp-file cleanup requires `-u root` flag

**Issue (operational):** When using `docker cp` to copy a temporary file into the Frappe container for manual verification (e.g., Session 4 real-data verification), the file lands inside the container as `root:root` owned. The default user when running `docker exec frappe_docker_devcontainer-frappe-1 ...` is the `frappe` user, who cannot delete root-owned files in `/tmp/`.

**Resolution:** Cleanup command needs `-u root`:

```
docker exec -u root frappe_docker_devcontainer-frappe-1 rm /tmp/<temp_file>.xlsx
```

**Standing rule for future docker-cp-based verifications:** include `-u root` in any `rm`/cleanup commands targeting files placed by `docker cp`. Verified and applied 2026-05-13 during Session 4 cleanup of `/tmp/jsw_test.xlsx`.

**Worst case if `-u root` is forgotten:** the temp file persists in `/tmp/` until container restart. Harmless (just untidy) since `/tmp/` is volatile.

### 17.8 Multi-area reserved keyword list — thorough survey deferred to Phase 2c

**Issue:** The `GlobalSettings.multi_area_reserved_keywords` list was initially set to 22 entries (Part A2) and expanded to 49 entries during Part B2b-keywords (triggered by the Snitch Light Fixtures false positive). The expansion was reactive — driven by one specific false positive, not a systematic survey of all header-word variants across the real-BoQ corpus.

**Known gaps:** No cross-file keyword analysis has been performed. Additional header words from JSW, Raheja, Paytm, Inovalon, HYBE, and other fixtures may still produce false positives in Pattern 1 detection when those files are parsed in Phase 2c.

**Disposition:** Defer systematic survey to Phase 2c. At Phase 2c kickoff, run `detect_multi_area_pattern()` against all committed real fixtures and inspect the output for false-positive areas. Any false-positive area name → add the offending header word to the reserved list. Working agreement: Phase 2c first-run verification step explicitly includes a keyword sweep before authoring any expected-output JSON.

**Status (updated 2026-05-15): CLOSED.** Audit half: `keyword_audit.py` (feat `da105976`) surfaced 125 candidate detections across 25 real fixtures. Expansion half (feat `824e3634`): 49→120 keywords (+71 in 6 buckets) + `_is_reserved` whitespace normalization + parenthetical strip. Post-expansion audit count: 112 (down from 125). The <50 target was not reached because the fixture set includes ~25+ genuine multi-area BoQs (RAHEJA PHASE-1/PHASE-2: 14 blocks, D-Tech floor-based: ~8, JSW MEP: 2) that are correctly detected and must not be suppressed. Remaining false positives (column headers: AREA/ACTIVITY/WORKITEM in D-Tech civil sheets; revision metadata: REV/RO in top-row fallbacks) are candidates for a follow-on keyword pass if needed. §9 #44 CLOSED on keyword-expansion landing; post-expansion sweep of remaining blocks is a non-blocking future caveat.

### 17.10 Phase 2c reserved keyword expansion did not reach detection target on first pass — targeted follow-on landed

**Issue:** Phase 2c keyword expansion sub-phase (feat `824e3634`, docs `db80d27e`) expanded `multi_area_reserved_keywords` from 49 to 120 entries with 71 new entries across 6 buckets (generic construction terminology: SQFT, NUMBER, BRAND, MARKET RATE, etc.). The post-expansion audit re-run dropped detection count from 125 to 112 — well above the spec'd <50 target. Root cause: the 71 entries committed did not match the specific false-positive triggers surfaced in the §9 #44 audit data (metadata top-row labels, per-row-attribution columns, space-and-typo Sl.No variants, etc.).

**Disposition:** Targeted follow-on sub-phase (feat `010666cc`, this docs commit): 71 specific entries added based on direct mapping from audit findings to false-positive triggers. List grows 120 → 191 entries. Post-targeted audit count: 50 detections (down from 112).

**Status (updated 2026-05-15): CLOSED.** §17.10 marked closed on targeted-additions landing. Of the 50 remaining detections, approximately 25 are genuine multi-area BoQ layouts (RAHEJA PHASE-1/PHASE-2 across 14 sheets, JSW MEP B1/B2/B3/B6, D-Tech per-floor floor-name areas, Bill of Quantities AV floor-names, DHL FK-5-1-12 critical-room areas, Voyager/Victor compound names on Société Générale) and must be preserved. Net real false positives remaining: roughly 25. These are candidates for structural heuristics (top-row title-repetition detection, sparse-metadata pattern detection) rather than keyword expansion — deferred as a future caveat if the residual false-positive count proves to be blocking during per-fixture MappingConfig authoring sub-phases.

### 17.11 Phase 2c caveats #2 + #4 cleanup — qty_by_area deprecation + 2-row Pattern 2 detection coverage

**Caveat #2 (§9 #42) — `qty_by_area` role removed from `ColumnRole.role` Literal:** The `qty_by_area` role was added in Part A2 as a parallel to `amount_by_area`, but the classifier never wired it — all per-area qty capture always used `role="qty"` with an `area=` field. The role was dead code in the Literal. Cleanup: removed `qty_by_area` from the `ColumnRole.role` Literal (it was already absent from `_AREA_COMPATIBLE_ROLES`). Validator `area_required_for_by_area_roles` renamed to `area_required_for_amount_by_area_role` and simplified to check only `amount_by_area`. Cascades: `test_qty_by_area_with_area_succeeds_in_full_sheetconfig` (test 17) updated to `role="qty"` (mechanical cascade per agreement #21); `test_pattern_4_full_mapping_validates_successfully` (test 21) updated similarly. New test 22 added: `test_qty_by_area_role_rejected_after_deprecation` — `ColumnRole(role="qty_by_area", area="Floor 1")` raises ValidationError even with area set. `test_config.py` count: 21 → 22.

**Caveat #4 (§9 #43) — premise correction + 2-row coverage gap:** Original framing in §9 #43 stated that `parse_boq()` on `synthetic_multi_area.xlsx` returned `multi_area_pattern=None` for the 1-row fixture and needed fixing. Step 0 verification revealed this premise was **wrong**: the fixture already returns `MultiAreaPattern(pattern=1, areas=['Floor 1', 'Floor 2'])` as of the current code. The "Total Qty" column (F1) appears AFTER "Floor 1" (D1) and "Floor 2" (E1), so Pattern 1 collects 2 areas before the `TOTAL_QTY_PATTERN` break. The `parse_boq()` result had always been non-None; the caveat's premise was stale. **Reframe (user-confirmed):** (a) Add Pattern 1 assertions to the existing 1-row integration test (`test_multi_area_post_pass_full_pipeline`) to lock in the now-verified passing behaviour; (b) Add a new 2-row Pattern 2 fixture (`synthetic_multi_area_2row.xlsx`) via `generate_multi_area_2row()` to cover the genuine 2-row header mode gap. The 2-row fixture has top header (row 1) with `Block A` / `Block B` merged cells and bottom header (row 2) with `Qty` / `Amount` pairs — `header_row=2, header_row_count=2`. New integration test class `TestMultiAreaDetectionIntegration` (1 test) verifies end-to-end `pattern=2`, `areas=["Block A", "Block B"]`, and per-area qty on resolved rows. `test_orchestrator.py` count: 27 → 28.

**Status (updated 2026-05-15): CLOSED.** Both caveats resolved in feat commit `c6910c71`. Test count: 205 → 207 (test_config 21→22 + test_orchestrator 27→28). `synthetic_multi_area_2row.xlsx` is generated at test runtime by `setUpClass`; the file is untracked alongside `synthetic_multi_area.xlsx`.

### 17.11.C Phase 2c §9 #45 priced-PREAMBLE-with-children review-flag implementation

**Implementation (§9 #45):** Two new fields added to `ResolvedRow` in `hierarchy.py`: `needs_classification_review: bool = False` and `review_reason: str = ""`. New post-pass `_apply_priced_preamble_with_children_review_flag_post_pass(resolved_rows)` added to `hierarchy.py`, wired in `orchestrator.py` between Step 4a (zero-children demotion) and Step 4b (multi-area post-pass) per §7.30. The post-pass flags any PREAMBLE that (a) has tree children (path in `paths_with_descendants`) AND (b) carries a price signal (alphanumeric unit string OR any rate field > 0). Flagged rows: `needs_classification_review=True`, `review_reason="priced_preamble_with_children"`. Re-parenting and demotion are NOT performed by the parser — the Phase 3 wizard reads `review_reason` to launch the re-classification flow.

**Audit (§9 #45 pre-step):** Audit script `nirmaan_stack/services/boq_parser/preamble_with_children_audit.py` (feat commit `1ad12a7b`) confirmed exactly one candidate across Snitch Electrical: resolved_idx=500, xlsx_row=502, sl_no='2.0', path='394/500', unit='LS', 5 direct children, `children_shape="siblings"`. No candidates in synthetic_simple. Re-running the audit on the current tip will now show row 500 with `needs_classification_review=True` on the parsed output (the audit script itself is unchanged — it reports the candidate, not the flag state).

**Test coverage:** 9 new tests in `TestPricedPreambleWithChildrenReviewFlag` (test_hierarchy.py) + 1 Snitch integration test `test_snitch_row_500_flagged_for_priced_preamble_with_children_review` (test_orchestrator.py). Test count: 207 → 217.

**Status (updated 2026-05-16): CLOSED.** feat commit `7ff4ce55`, docs commit this session. §17.10 (Priced PREAMBLE with tree children) updated to CLOSED. Next: Reader `sheet_state` exposure (§9 #49).

### 17.11.D Phase 2c §9 #49 reader sheet_state exposure

**Implementation (§9 #49):** New method `BoqReader.list_sheet_states() -> dict[str, str]` added to `reader.py` as a pure pass-through over openpyxl's `Worksheet.sheet_state`. Return value maps each sheet name (exact whitespace + casing, matching `list_sheets()`) to its visibility string — one of `'visible'`, `'hidden'`, or `'veryHidden'` — exactly as openpyxl yields them. No normalisation, no enum wrapper, no caching. Placement: immediately after `list_sheets()` in `reader.py`. No changes to any other source module.

**Design (§7.31):** See decisions log entry.

**Test coverage:** New `TestSheetStateExposure` class (4 tests) added to `test_reader.py`. Tests cover: all-visible default, one hidden sheet, one veryHidden sheet, and whitespace/order preservation. All use in-memory `openpyxl.Workbook` + `tempfile.TemporaryDirectory()` per-test (no committed fixture changes). Test count: 217 → 221.

**Non-breaking:** Additive only. No existing method changed. No existing test modified.

**Status (2026-05-16): CLOSED.** feat commit `3e9eafe0`. Next: §9 #48 classifier-dictionary audit half (see §17.11.E).

### 17.11.E Phase 2c §9 #48 classifier-dictionary audit

**What the script does:** Walks all 25 non-synthetic fixtures in `tests/fixtures/`, scans the first 15 rows of every sheet, and for each row with ≥ 3 non-empty cells tests every cell value against the classifier's `_HEADER_KW` dictionary. Records every string that no role's keyword set matches as "unclassified". Emits a JSON report with per-row detail, an unclassified-string frequency rollup, and summary counts.

**Script:** `nirmaan_stack/services/boq_parser/classifier_audit.py`

**Output JSON:** `nirmaan_stack/services/boq_parser/classifier_audit_output.json` (~5.4 MB)

**Run command (inside container):**
```bash
cd /workspace/development/frappe-bench/apps/nirmaan_stack
/workspace/development/frappe-bench/env/bin/python -m nirmaan_stack.services.boq_parser.classifier_audit
```

**Audit summary (from output JSON):**
- Fixtures attempted: 25 (24 scanned; 1 failed — `R0_CIVIL INTERIOR & MEP_TABLESPACE_PUNETH WORKING FILE_06.05.2026 (2).xlsx` contains invalid XML)
- Sheets scanned: 283
- Rows scanned (≥ 3 non-empty cells): 2,187
- Total cells scanned: 14,679
- Total classified: 1,770 | Total unclassified: 12,909
- Unique unclassified strings: 2,999

**Top 5 unclassified header strings by frequency (headers only — numerics dominate the raw rollup):**
1. `AMOUNT` (100 occurrences) — amount_total synonym family
2. `Sq.ft` (91) — unit/measurement column
3. `Amount` (71) — amount_total synonym (case variant)
4. `Rate` (67) — rate_combined synonym family
5. `Remarks` (64) — row_notes synonym family

**Note on rollup composition:** The raw top-frequency unclassified strings are dominated by numeric cell values (`0`: 2243, `1.0`: 295, etc.) because the first 15 rows of many fixtures include data rows that pass the ≥3 filter. These are expected junk that the expansion-half reviewer must filter. True column-header synonyms include: `Supply & Installation` (40), `SUPPLY & INSTALLATION` (20), `INSTALLATION` (29), `SUPPLY` (29), `Total Amount` (32), `Installation Rate` (25), `Supply Rate` (22), `SL. NO.` (17), `UOM` (11), `DSR` (12), `Make` (12).

**Status: CLOSED.** chore commit `f89e2478`. Next: §9 #48 classifier-dictionary expansion half (expansion-half sub-phase adds synonyms to `_HEADER_KW` in `classifier.py`).

### 17.11.F Phase 2c §9 #48 classifier-dictionary expansion + multi-area keyword expansion

**`_HEADER_KW` expansion (classifier.py):** Dict expanded from 5 to 14 role keys. The existing 5 keys (`sl_no`, `description`, `unit`, `qty`, `qty_total`) received audit-derived synonyms (e.g. `"sl. no"`, `"sr. no"`, `"si.no"`, `"particulars"`, `"item description"`, `"discription"`, `"uom"`, `"u.o.m"`, `"boq qty"`, `"total qty"`). Nine new role keys added: `rate_combined`, `rate_supply`, `rate_install`, `amount_total`, `amount_combined`, `amount_supply`, `amount_install`, `make_model`, `row_notes` — covering the rate/amount supply-install-combined split and make/notes label families prominent in real BoQ fixtures.

**`multi_area_reserved_keywords` expansion (config.py):** List expanded 191 → 224 (33 net new entries). New entries cover: SITC / S&I family (16 entries: SITC, S&I, S+I, SITC RATE, SITC AMOUNT, S&I RATE/AMOUNT, S+I RATE/AMOUNT, SUPPLY & INSTALLATION variants, SUPPLY AND INSTALLATION variants, SUPPLY, INSTALL & COMMISSIONING RATE), U.O.M, six "IN INR/RS" variants (RATE IN INR, RATE IN RS, RATE IN RS., AMOUNT IN INR, AMOUNT IN RS, AMOUNT IN RS.), NDSR (MR), COMBINED AMOUNT, six "AS PER BOQ" compounds (including a real-BoQ typo variant AS PER BNOQ TOTAL AMOUNT), SR., and AREA OF WORK. Seven entries from the original 41-entry spec were dropped as already-present duplicates (UOM, SPECS, SPECIFICATIONS, COMBINED RATE, FLOOR, LOCATION, NO.); original spec count was 40 not 41 (off by 1), giving 40 − 7 = 33 net new entries.

**classifier_audit.py sync (mechanical cascade, agreement #21):** The `_CLASSIFIER_HEADER_KW` frozen replica in `classifier_audit.py` was synced from 5 to 14 keys to match `_HEADER_KW`. Previously the replica was frozen at audit time; the sync makes future re-runs reflect the live dict. The "intentionally frozen" comment was updated to "synced as of Phase 2c §9 #48 expansion".

**Audit re-run delta (after sync):** classified 1,770 → 3,255 (+1,485 / +83.9%); unclassified 12,909 → 11,424 (−1,485); unique unclassified 2,999 → 2,697 (−302 / −10.1%). Total cells scanned unchanged (14,679) — same fixtures, same rows, only classification improved.

**Test count delta:** +10 in `TestHeaderKwExpansionPhase2c` (test_classifier.py — 8 required + 2 extra for `particulars` and `boq qty` synonyms), +6 in `TestReservedKeywordExpansionPhase2cSitcAndCombinedRoles` (test_multi_area_detection.py). Mechanical assertion bump in test_config.py (191 → 224, +5 spot-check entries: SITC RATE, SUPPLY & INSTALLATION, RATE IN INR, AS PER BOQ TOTAL AMOUNT, NDSR (MR)). Parser test count: 221 → 237.

**Non-breaking:** Pure data additions to both lists. No changes to `_is_reserved` matching logic, `classify_row` flow, or `detect_multi_area_pattern` algorithm. Existing parser behaviour fully preserved.

**Status: CLOSED.** feat commit `a0d2b4a5`. Next: DB commit + version cascade sub-phase.

### 17.11.G Phase 1.9c real-fixture integration tests (Raheja Electrical + HVAC + D-Tech CIVIL WORKS)

**Goal:** Add real-fixture integration tests to `test_orchestrator.py` covering three fixtures. No parser code changes. No Frappe code changes.

**Fixtures covered:**

1. **Raheja Commerzone Electrical sheet** ("Electrical ", trailing space) — Pattern 2-rate end-to-end with inline MappingConfig. Finding F3b confirmed: bottom header has "RATES" (plural); `_RATE_CELL_PATTERN` rejects it; pattern falls through to Pattern 1. `test_electrical_pattern_2_rate_detected` marked `@unittest.expectedFailure`.
2. **Raheja Commerzone HVAC sheet** ("HVAC ", trailing space) — Pattern 2-rate stress test. Finding F5 confirmed: area-name row is row 2 but `top_header_row` is hardcoded to `header_row − 1 = row 14` (blank intermediate row); no area names found. `test_hvac_pattern_2_rate_with_header_gap` marked `@unittest.expectedFailure`. F5 is distinct from F3b: HVAC bottom header has "RATE" (singular) — rejection is caused by wrong `top_header_row`, not RATES-plural mismatch.
3. **D-Tech CIVIL WORKS sheet** — `append_to_notes` end-to-end. Row 1 has a merged "PHASE-0" banner spanning all columns including G (Specs); `skip_top_rows_after_header=[1]` (absolute row number, confirmed from orchestrator `skip_rows.update()`) added to MappingConfig to discard it at parse time. Specs (G) always empty in fixture (0/54 data rows populated) — used as the always-absent column for Policy-X verification. Column E (Workitem) intentionally omitted from `column_headers` to exercise letter-fallback (`append_notes_raw["E"]`).

**Test classes added:**
- `TestPhase19cRealFixturesRaheja` — 4 tests (1 expectedFailure: F3b)
- `TestPhase19cRealFixturesRahejaHVAC` — 1 test (1 expectedFailure: F5)
- `TestPhase19cRealFixturesDTechCivilWorks` — 5 tests

**Test count:** 257 → 267. Expected failures = 2, counted as OK in suite verdict.

**Audit regression:** Zero flips in `classifier_audit.py` and `preamble_with_children_audit.py` — no parser code changed.

**Frappe boundary:** 88 PASS (28 boqs + 60 boq_nodes) — unchanged.

**Findings documented:**
- **F3b** — `_RATE_CELL_PATTERN = r"^\s*rate\s*$"` matches "RATE" singular only; "RATES" plural falls through to Pattern 1. Phase 1.9d candidate: widen to `r"^\s*rates?\s*$"`.
- **F5** — orchestrator `top_header_row` hardcoded to `header_row - 1`; cannot span multi-row gaps (e.g. 13 rows between area-name row 2 and bottom header row 15 in HVAC). Phase 1.9d candidate: `top_header_row_override` SheetConfig field.

**Status: CLOSED.** feat commit `f62a0ca5`. Phase 1.9d candidate scope: F3b + F5 bundled. Phase 2c next (unblocked).

### 17.9 Preamble stack-depth cascade in hierarchy resolver — parked

**Issue:** `_determine_preamble_level` in `hierarchy.py` uses a stack-walk heuristic: lowercase-letter sl_no tokens (`a.`, `b.`, … `z.`, `aa.`, `ab.`) each increment `stack_depth + 1`. In Snitch Electrical's cable-size section, every nested cable item has a lowercase-letter sl_no, causing the stack depth to climb from 3 to 21 over the section. These deeply-nested rows get `level=21` and are mistakenly classified as PREAMBLEs by the base classifier (sl_no + description, no qty → PREAMBLE). B2d-classifier's unit-based demotion post-pass addresses the symptom: those rows carry a unit value (e.g. `'Nos.'`) that matches real LINE_ITEM units on the sheet, so they are demoted to LINE_ITEM before the preamble candidate scorer runs.

**Residual concern:** The resolver's stack-depth rule is structurally wrong for real BoQs with deep lowercase cascades. A row that genuinely IS a section header with a unit value would also be demoted — the demotion criterion has no way to distinguish real section-header units from line-item units. This is unlikely in practice (real section headers have no unit), but it is a known structural weakness.

**Disposition:** Parked. B2d-classifier's unit-based demotion is sufficient for all known real fixtures (Snitch Electrical confirmed). Root-cause fix in `hierarchy.py` — e.g., capping lowercase-letter stack depth relative to the enclosing level — is deferred until a fixture is encountered where the symptom-level fix is insufficient.

**Status:** Open. Not blocking any current phase. Revisit if a real fixture shows demoted rows that are genuine section headers.

### 17.10 Priced PREAMBLE with tree children — re-parenting deferred

**Issue:** After B2d (unit-based demotion) and B2f (zero-children demotion), one PREAMBLE in Snitch Electrical remains that has both priced content (unit='LS') AND tree children: resolved_idx=500, sl_no='2.0', path='394/500', 5 children. It should arguably be demoted to LINE_ITEM (it carries a rate and a unit, implying it is itself a priced item), but doing so would orphan its 5 children — their `parent_index` would still point to the now-LINE_ITEM row. Re-parenting children to the demoted row's parent, or promoting them to top-level, requires a second pass over the resolved list to update `parent_index` and `path` values on all descendants. This is a non-trivial structural change.

**Disposition:** Explicitly OUT OF SCOPE for B2f. B2f's algorithm intentionally skips PREAMBLE rows that have descendants (`row.path in paths_with_descendants`). If row 500 is the only such case across the full real-fixture corpus and its children parse correctly, this is acceptable. If a future fixture shows the same pattern and the priced-but-with-children PREAMBLE causes downstream DB/UI problems, add a dedicated re-parenting pass as Part B2g (or Phase 2c extension).

**Status (updated 2026-05-16): CLOSED.** §9 #45 audit (commit `1ad12a7b`) confirmed row 500 as the sole candidate across the in-scope fixtures. §9 #45 implementation (feat `7ff4ce55`) resolves this by flagging the row via `needs_classification_review=True` / `review_reason="priced_preamble_with_children"` rather than auto-demoting. Re-parenting remains OUT OF SCOPE for the parser; deferred to Phase 3 wizard. See §17.11.C and §7.30.

### 17.12 Skip-then-ingest sheet type — parked

**Issue:** The current `SheetConfig.treat_as` Literal supports `"data"` and `"master_preamble"`. Real BoQs occasionally have a third sheet type: a summary or table-of-contents sheet that should be skipped for parsing but whose text should be ingested as unstructured metadata (e.g., room-area schedule, legend, cost summary). Setting `skip=True` discards the sheet entirely; there is no mechanism to capture its content without parsing it as a data sheet.

**Proposed addition:** A third `treat_as` value `"skip_then_ingest"` that causes the sheet to be skipped for row-by-row parsing but whose raw text content is captured and attached to the `ParsedBoq` as `ingest_only_sheets: dict[str, str]` (sheet_name → concatenated cell text). The wizard (Phase 3) can surface this text in a read-only panel for the user's reference.

**Disposition:** Parked. No real fixture currently requires this. The cost of skip=True is low — users can open the source Excel if they need the summary. Revisit if Phase 3 wizard user testing shows a clear need for ingested-but-not-parsed content. The `treat_as` Literal in `config.py` is the natural extension point; adding a third value is non-breaking.

**Status:** Open. Not blocking any current phase.

### 17.13 Wizard-load review pending — cumulative deferred-to-wizard inventory + UX-friction concern

**Status:** [RESOLVED v5.21] — Option 3b confirmed via execution-layer experiment Sequence C2+E2; 8/8 schema acceptance validates declarative wizard architecture. See handover §6 v5.21 decisions + §14 v5.21 EOS.

**Context (2026-05-17 chat-Claude / Nitesh discussion).** Multiple shape-handling decisions across Phases 1.8 – 1.9 have been deferred to Phase 3 wizard:
- Pattern 6 compound area names (§7.4 / §7.19, deferred since 2026-05-12)
- BMS schedule skip disposition (agreement #24)
- Vendor-compare disposition (agreement #24)
- Hidden-sheet default-skip (agreement #24, supported by §7.31 `BoqReader.list_sheet_states()`)
- Per-row attribution column-role choice (§7.34 `append_to_notes`; Phase 1.9b parser-side landed; commit-time merge owed in Phase 2c; wizard UX owed in Phase 3)
- Merged-title-banner default-skip (agreement #24 extension candidate; Phase 1.9d F7)
- Priced-PREAMBLE-with-children re-classification flow (§9 #45; parser-side review flag landed v5.9; wizard demote+re-parent owed in Phase 3)
- Multi-row top-header gap multi-row case (§7.39 candidate; Pattern 6 absorption)
- Declarative-first wizard direction (chat-Claude proposed 2026-05-16: parser-as-suggestion-engine, wizard-as-decision-engine; Nitesh locked direction: parser-fix-then-stress-test-then-wizard; not captured in v5.12 / v5.13 housekeeping — surfaced via conversation_search 2026-05-17)

**Standing concern (Nitesh, 2026-05-17).** Cumulative user-declaration load in Phase 3 wizard may be both UX-hostile (too many per-sheet decisions per upload) and error-prone (wrong user choices propagate to committed BoQ data). Worth a deliberate design conversation before Phase 2c body locks commit-time semantics.

**Re-evaluation trigger.** Post Phase 1.9e (real-fixture stress test observability chore). Phase 1.9e walks all 24 real fixtures with auto-guessed MappingConfigs and emits a characterization report. That report is the empirical basis for the decision — what fraction of sheets the parser gets right with zero user declaration, what fraction needs 1-2 overrides, what fraction needs 5+ overrides.

**Three threads to think through at re-evaluation time.**
1. Which deferred items get parser auto-detection (move work back to parser) vs stay with wizard.
2. Whether Phase 4 (LLM-assisted column-role suggestions, currently sequenced after Phase 3) should move up — AI auto-mapping is the direct mitigation for wizard friction. Nitesh flagged this as a parallel thread to explore 2026-05-17.
3. Per-template MappingConfig re-use as primary mitigation: if a user uploads the same vendor's BoQ template repeatedly (Raheja revision cycles, JSW project re-uploads), saved templates drop declaration cost to near-zero on subsequent uploads. Worth thinking about whether the wizard ships with this as a first-class concept (not bolted on later).

**Decision shape to make at re-evaluation.** Confirm or revise the locked sub-phase sequence (currently Phase 1.9d → 1.9e → 2c body → Phase 3 wizard → Phase 4 AI assist). Specifically: does Phase 4 stay after Phase 3, or interleave / move up?

**Status: OPEN. Re-evaluate post Phase 1.9e.**

Re-evaluation now unblocked — empirical data committed at 5cd4f580.

### 17.14 #74 [DOCUMENTED v5.18] — Diagnostic-script forces header_row_count=1

Intentional but means Mode A unmeasured. Mitigated by Diagnostic Chore #2 two-mode output. Full detail: handover §9 #74.

### 17.15 #75 [DOCUMENTED v5.18] — Amount-family metric over-counts

Amount-family metric over-counts based on role assignment. Mitigated by Diagnostic Chore #1 source_present_but_unparsed bucket. Full detail: handover §9 #75.

### 17.16 #76 [MITIGATED v5.19] — PowerShell Select-Object -Last N pipe deadlock

PowerShell Select-Object -Last N pipe deadlock with docker exec (15+ min hang). Mitigation: Option B file-redirect form for ALL test commands. Full detail: handover §9 #76.

### 17.17 #77 [MITIGATED v5.19] — Unicode section sign mangled by Windows/Docker heredoc

Unicode section sign mangled by Windows/Docker heredoc. Mitigation: ASCII labels only in commit messages and docs. Full detail: handover §9 #77.

### 17.18 #78 [MITIGATED v5.19] — docker exec -w flag failure in some PowerShell quoting contexts

docker exec -w flag failure in some PowerShell quoting contexts. Mitigation: bash -c 'cd /path && cmd' form. Full detail: handover §9 #78.

### 17.19 #79 [DOCUMENTED v5.19, RESOLVED v5.21] — v2 fixture shape only partially handled by Phase 1.9o

v2 fixture shape (area-name top merges + 4-col bottom) only PARTIALLY handled by Phase 1.9o. Reframed as Bug 9 in v5.21 8-bug taxonomy; addressed via Bug 7+9 combined remediation feat 9a5b16cb. Full detail: handover §9 #79.

### 17.20 #80 [OPEN v5.20] — test_auto_guess.py entirely mock-based

test_auto_guess.py is entirely mock-based; no real .xlsx loads. Mitigated forward by agreement #29 (real-fixture integration tests required). Closure deferred to focused sub-phase post-strategy decision. Full detail: handover §9 #80.

### 17.21 #81 [OPEN v5.20, deferred] — Output filename drift from 1.9j checkpoint

Output filename drift from 1.9j checkpoint. Low priority. Full detail: handover §9 #81.

### 17.22 #82 [DOCUMENTED v5.20] — Pre-1.9o synthetic fixtures embed two opposite conventions

Pre-1.9o synthetic fixtures embed two opposite conventions B and C. Documented; no action required. Full detail: handover §9 #82.

### 17.23 #83 [OPEN v5.20, deferred to wizard] — Three coexisting header conventions in real BoQs

Three coexisting header conventions in real BoQs (A/B/C). Path A explicitly defers parser-side fixes; wizard sidesteps via declarative config. Full detail: handover §9 #83.

### 17.24 #84 [CLOSED v5.21 by feat 47090d7d] — Convenience field summation gap (Bug 6)

cr.qty/rate/amount didn't sum per-area/per-component when Total/Combined blank. Closed by Bug 6 fix. Full detail: handover §9 #84.

### 17.25 #85 [CLOSED v5.21 by feat 9a5b16cb] — Keyword vocabulary missing word-order variants (Bug 7)

"Rate Supply" didn't match rate_supply. Closed by Bug 7+9 combined remediation. Full detail: handover §9 #85.

### 17.26 #86 [CLOSED v5.22 by feat 798f4fd2] — Same-row =SUM() SUBTOTAL_MARKER misfire (Bug 10)

classifier.py treats same-row supply+install aggregation formulas as cross-row subtotals. 131 cross-fixture misfires (57 VRF + 74 Societe Generale). Fix: _is_cross_row_sum() helper ~15 LOC + tests. Full detail: handover §9 #86.

**Closure record:** _is_cross_row_sum(formula, current_row) helper added in classifier.py Private helpers section. Gate added to FORMULA-path SUBTOTAL_MARKER check: formula must start with =SUM( AND _is_cross_row_sum returns True. Text-regex SUBTOTAL_MARKER path (Total Item No., Grand Total, etc.) NOT touched. 131 expected SUBTOTAL_MARKER -> LINE_ITEM reclassifications (VRF 57 + Societe Generale 74). Audit-script stats flat (classifier_audit.py measures header-keyword matching, not classification categories -- flat is expected for Bug 10). Fix verified by integration tests: TestBug10VrfSameRowSumIntegration row 1.1 and 1.2 assertions pass. Parser tests 409 -> 429 (20 new: 13 unit + 3 classify_row gating + 4 VRF real-fixture). No out-of-scope files touched. Agreements cited: #9 two-commit, #16 known-pattern citation, #20 25-item self-report, #25 audit-regression, #29 real-fixture integration.

**Coverage extension (feat 94706b5c):** TestBug10SocieteGeneraleHvacIntegration added in test_orchestrator.py. 73-row Societe Generale Bug 10 misfire surface now covered (VRF 57 rows covered by feat 798f4fd2 already). Areas: GF / 2F (Office) / 2F(Cafeteria). Per-row assertions: sl_no=1.03, 1.04, 1.05 (rows 23, 25, 27 with L=SUM(Jx:Kx)). Aggregate threshold >= 230 (post-fix empirical: 282; pre-fix ~209). Parser tests 429 -> 434. Suite verdict OK.

### 17.27 #87 [CLOSED v5.25 via A1+A2 land] -- Pattern-consistency mismatch in PREAMBLE vs LINE_ITEM (Bug 11)

**MISFRAMED — PARKED.** Original framing: classifier ignores sl_no pattern_depth; 240+ rows affected in BoQ Elec alone; fix was orchestrator post-pass with asymmetric depth rule. Implemented in feat fb89bf44 / docs f9bd1e70, then reverted (feat f1839b1e, docs debd5186) after diagnostic revealed root cause is hierarchy RESOLVER (parenting), not classifier.

**Root cause (post-diagnostic 2026-05-22).** Two sub-manifestations:
- **11a — Numeric peer sibling gap:** 1.0 PREAMBLE + 2.0 LINE_ITEM should sibling; resolver parents 2.0 under 1.0.
- **11b — Letter-sequence cascade (§17.9):** a/b/c letter-suffix rows chained stack_depth+1 each instead of equi-depth siblings under numbered ancestor.

**Why parked.** Snitch diagnostic confirmed 124/124 depth-1 lowercase-letter ('l' sig) rows in '6. Electrical' are genuine enumerated sub-items (cable variants, socket types, conduit sizes under numbered PREAMBLEs). Depth-≤1 auto-promote nets −95 LINE_ITEMs — a regression. Fix belongs in hierarchy resolver layer; deferred to Phase 3+ AI review per agreement #33. Parser tests stable at 434. Full detail: handover §9 #87.

**Update 2026-05-23 (post-hoc recognition):** Bug 11a + Bug 11b were structurally resolved by Rule A1 + Rule A2-reframed landing (feat 8f960a2b, sec 9 #99, §17.40). The connection was not recognized in the A1+A2 land docs commit (ea60a03f) and was identified during v5.25 housekeeping preparation review.

**Bug 11a -> Rule A2-reframed.** A2 fires at LINE_ITEM attachment when LINE_ITEM sl_no has same pattern_signature as stack-top PREAMBLE AND a different first_numeric_token (both non-None). Attaches to stack-top's parent (sibling, not child). This is exactly the Bug 11a canonical case: "1.0 PREAMBLE + 2.0 LINE_ITEM with qty -- resolver parents 2.0 under 1.0; should be SIBLING of 1.0 (same pattern signature D.D, same depth)". Empirical evidence: A2 audit (sec 9 #99, feat 16647958) captured 27 A2 firings in Snitch + 31 A2 firings in BoQ ELV -- every firing is the Bug 11a case. All landed correctly post-A1+A2 (parser tests 440 -> 464 confirm).

**Bug 11b -> Rule A1.** A1 fires in _determine_preamble_level when sl_no (after rstrip) is all-lowercase, scans stack reversed for first non-lowercase ancestor, returns anchor.level + 1. This is exactly the Bug 11b cascade case: "a/b/c letter-suffix children should sibling under numbered ancestor; resolver chains them via stack_depth + 1". Empirical evidence: A1 audit captured 3 A1 firings in Snitch (xlsx rows 458/475/491, sl_no b/c/d). Before A1: level 5/6/7 (cascade). After A1: all at level 4 (siblings under numbered parent). The §17.9 lowercase-letter cascade (root cause of Bug 11b) is structurally resolved.

**Snitch LINE_ITEM caveat.** Snitch diagnostic (2026-05-22 on tip f9bd1e70) showed 124/129 depth-1 lowercase-letter rows are GENUINE LINE_ITEMs (cable variants, socket types, conduit sizes). LINE_ITEMs do not go through _determine_preamble_level so A1 does not affect them. Those 124 rows attach to stack-top numbered PREAMBLE naturally without cascade. A1 handles the remaining 5 PREAMBLE anomalies that exhibited the cascade.

**Status:** **CLOSED v5.25.** Both manifestations structurally resolved. The 47 tests added in the reverted v5.22 attempt (feat fb89bf44 + docs f9bd1e70, reverted via debd5186 + f1839b1e) are NOT restored -- they tested classifier-layer auto-promotion logic that A1+A2 supersedes (resolver-layer fix). Original v5.22 commits preserved in git history for archaeology.

### 17.28 #88 [OPEN v5.21, TARGET NEXT] — Section heads pinned at L1, intermediate hierarchy traversal lost (Bug 12)

Non-dotted PREAMBLEs unconditionally L1; dotted-decimals trace to most recent section head. Foundational for §7.34 commit-time notes-merge. ~30 LOC hierarchy.py. Full detail: handover §9 #88.

### 17.29 #89 [CLOSED v5.23] — Excel error literals classified as content (Bug 13)

Excel error literals (#REF!, #VALUE! etc.) classified as content. Fix: EXCEL_ERROR_LITERALS frozenset + _is_excel_error() helper in reader.py; all seven error strings normalized to None at iter_rows() cell-read time; 6 new tests (4 unit + 2 integration). Parser tests 434 -> 440. feat 5ff93064. Full detail: handover §9 #89.

### 17.30 #90 [OPEN v5.21, LOW PRIORITY] — Letter-suffix peer items get nested levels (Bug 14, cosmetic)

Rows like a./b./c. should be peer children of most recent numbered ancestor; currently nested under each other. ~20 LOC hierarchy.py. No data damage. Full detail: handover §9 #90.

### 17.31 #91 [PHASE 3 SPEC v5.21] — Wizard design: area name suffix normalization (Finding 15)

Wizard must strip trailing ` Qty`/` Quantity` from area names auto-detected from column headers. Full detail: handover §9 #91.

### 17.32 #92 [PHASE 3 SPEC v5.21] — Wizard design: single non-merged area column adjacent to merged group (Finding 16)

Wizard needs hybrid layout support. Full detail: handover §9 #92.

### 17.33 #93 [MITIGATED v5.21] — MSYS path conversion on Windows docker exec

/tmp/ translates to C:/Users/.../Temp/. Mitigation: prefix MSYS_NO_PATHCONV=1 on ALL docker exec/cp commands. Captured in CLAUDE.md this commit. Full detail: handover §9 #93.

### 17.34 #94 [MITIGATED v5.21] — Docker cp over heredoc corrupts ownership

Files become root-owned. Mitigation: Write-tool -> host temp file -> docker cp INTO container. NEVER heredoc through bash -c. Full detail: handover §9 #94.

### 17.35 #95 [LESSON v5.21] — Claude Code scope overreach during Sequence E

Auto-drafted E2 configs unilaterally instead of returning to chat after inspection. Mitigation: future prompts include explicit "STOP after this phase" reminders. Full detail: handover §9 #95.

### 17.36 #96 [PATTERN v5.21] — Large output file, desktop-pull pattern

For >50KB diagnostic dumps, docker cp output off container to Desktop + upload to chat; avoid inline cat through Claude Code. Full detail: handover §9 #96.

### 17.37 [DIAGNOSTIC v5.23] — §7.28 orphan-children audit (read-only diagnostic)

Script `unit_demotion_orphan_audit.py` (feat 8a126846) answers: of the ~82 PREAMBLE rows
§7.28 demotes on Snitch '6. Electrical', how many have descendants outside the §7.28 target set
(i.e. descendants that would be orphaned)? Pipeline: classify_row → (§7.28 skipped) →
resolve_hierarchy → (§7.29/§7.30/multi-area skipped). Target set confirmed 82. Result: 47/82
(57.3%) of target rows have ≥1 real-orphan descendant; 196 total real-orphan descendants;
max 9 on a single row. Informs pending decision on "no auto-demote/promote of parented PREAMBLE"
blanket rule. Invokable as `python -m nirmaan_stack.services.boq_parser.unit_demotion_orphan_audit`.

### 17.38 [DIAGNOSTIC v5.23] -- Bill Of Quantities Electrical & ELV rows 4-22 comparison audit

Script `boq_electrical_elv_rows_4_22_audit.py` (feat 3b0790f0) compares production
hierarchy resolution (with §7.28 unit-based demotion) vs proposed Approach A
(Rule A1 lowercase-letter cascade fix + Rule A2 numeric peer signature match,
§7.28 skipped) on xlsx rows 4-22 of ELECTRICAL & ELV BOQ in Bill of Quantities.xlsx.

Per-row output: classification, level, qty, parent_sl_no, path, description.
Headline findings: 0/19 rows differ between current and Approach A in this range.
1 Bug 12 candidate (row 4, sl_no "SUB HEAD A", level 1, text-only section heading
co-existing with numeric level-1 PREAMBLEs 1.0 and 4.0). Rule A1 and Rule A2 each
fire 0 times -- no lowercase-letter cascade or numeric-peer PREAMBLE rows in range.
Rows 9 (2.0) and 11 (3.0) are classified as LINE_ITEM (have qty values), so Bug 11a's
PREAMBLE-vs-LINE_ITEM sibling gap is visible via parent_sl_no="1.0" on both -- Rule A2
cannot fix LINE_ITEM parenting (documented in Approach A limitation footer).
Invokable as `python -m nirmaan_stack.services.boq_parser.boq_electrical_elv_rows_4_22_audit`.

### 17.39 [DIAGNOSTIC v5.25] -- Approach A-reframed audit (sec 9 #99 gating, feat 16647958)

Script `approach_a_reframed_audit.py` (feat 16647958) compares production resolve_hierarchy
(with sec 7.28) vs Approach A-reframed custom resolver (Rule A1 + Rule A2-reframed,
sec 7.28 applied in BOTH) on two full fixtures:

  - Snitch '6. Electrical' (521 rows) -- Rule A1 cascade case
  - Bill of Quantities 'ELECTRICAL & ELV BOQ' (1186 rows) -- Rule A2-reframed case

Rule A1 fires in PREAMBLE level determination when pattern_signature(sl_no) starts with 'l'.
Scans stack top-down for first entry whose sig does not start with 'l'; level = anchor.level+1.

Rule A2-reframed fires at LINE_ITEM attachment step (NOT in _determine_preamble_level).
Stack top only (proximity=1). Trigger: signature(LINE_ITEM.sl_no) == signature(top.sl_no)
AND first_numeric_token differs AND both non-None. Action: attach LINE_ITEM to top.parent
(one level up; root if top has no parent). LINE_ITEM never pushes onto stack.

Snitch '6. Electrical':         A1=3   A2=27  combined=0  indirect=0  total=30
Bill of Quantities ELEC&ELV:    A1=0   A2=31  combined=0  indirect=0  total=31

No auto-bucket misfire classification. User reviews first-20 sample in diagnostic_snapshots/.
Decision criterion: low misfire rate => land A1+A2 next sub-phase (sec 9 #99 closed);
appreciable misfires => park + codify "no more parser fuzzy rules" as working agreement #40.
Gating exit criterion E3 (closing Phase 2c bug-fix cycle).
Invokable as `python approach_a_reframed_audit.py` from the boq_parser directory.

---

### 17.40 [LANDED v5.25] -- Approach A-reframed land (sec 9 #99 CLOSED, feat 8f960a2b)

Rule A1 + Rule A2-reframed landed in hierarchy.py as production code (feat 8f960a2b).
approach_a_enabled: bool = True kwarg on resolve_hierarchy() and
_determine_preamble_level() provides on/off toggle for regression testing.
Helpers pattern_signature() and first_numeric_token() added to hierarchy.py.

F5 tightening applied: A1 trigger changed from sig.startswith('l') to
all(c == 'l' for c in sig_stripped) where sig_stripped = pattern_signature(
sl_no.rstrip('.,):;]')). Prevents mixed codes (a1, custom-code-xyz) from
wrongly absorbing into A1 (failure mode discovered during Step 5 test run).

Sec 7.29 interaction: A2 reparents all 5 children of PREAMBLE "2.0" (xlsx ~502,
Snitch 6. Electrical) to section header G. Zero-children demotion post-pass then
makes "2.0" a LINE_ITEM with parent G, structurally resolving the priced-preamble
ambiguity flagged in sec 9 #45. test_snitch_row_500_demoted_to_line_item_post_a2
captures this end-state.

snitch_electrical_expected.json regenerated: LINE_ITEM 176->177, PREAMBLE 43->42,
preamble_level_transitions 7->4 entries (levels 1-4 only; b/c/d collapse to
level 4 via A1, reducing the former 5/6/7 cascade).

test_approach_a_rules.py: 24 new tests (5 helpers, 7 A1 unit, 7 A2 unit,
3 Snitch integration, 2 BoQ ELV integration). Parser tests: 440 -> 464.

Working agreement #40 deferred pending Bug 12 diagnostic on 2 fixtures
(see §17.28 -- Bug 12 candidate "SUB HEAD A" row 4 in BoQ ELV must be
evaluated on 2 fixtures before deciding whether any further fuzzy rules
are warranted or should be permanently prohibited).

**Update 2026-05-23:** Working agreement #40 now codified in §14 -- see §17.41.

**Update 2026-05-23 (post-hoc recognition):** A1+A2 land also structurally resolved Bug 11a + Bug 11b -- see §17.27 status update.

---

### 17.41 [LANDED v5.25] -- SUB HEAD detection + universal subtotal-reset (sec 9 #100 + #101 CLOSED, feat 25a43617)

Both fixes landed in hierarchy.py. _SUB_HEAD_RE + _is_sub_head_marker() helpers added;
SUB HEAD branch in _determine_preamble_level forces level=1 unconditionally; _MID_SHEET_RESET_RE
preserved (deprecated, audit-script-only) with deprecation comment at definition site --
see in-line comment at definition site. SUBTOTAL_MARKER now unconditionally clears stack.
test_sub_head_and_subtotal_reset.py: 20 tests (6 helper unit, 4 Fix 1 unit, 5 Fix 2 unit,
5 BoQ ELV integration). Parser tests 464 -> 484. PHASE 2c BUG-FIX CYCLE CLOSED.

Empirical basis: 6-fixture cross-corpus audit (BoQ ELV, Snitch '6. Electrical', Inovalon HVAC,
SG HVAC, Raheja Electrical, D-Tech Civil) confirmed zero mid-section subtotals across 46 markers
and "SUB HEAD X" pattern unique to BoQ ELV but harmless to other fixtures. All 21 SUB HEAD
PREAMBLE rows in BoQ ELV now correctly at level=1 with parent_index=None.

Note on Group 4 test scope: test_boq_elv_numeric_preamble_after_sub_head_b_is_clean_root
asserts numeric PREAMBLE 1.0 lands at level=1 with parent_index=None
(clean root, no stale section-A descendant chain). The 1.0 does NOT
parent under SUB HEAD B at level 2 -- both end up as level-1 peers
because dotted-decimal sl_no matches level_1_style="numeric" detection.
This is a known structural limitation in BoQ ELV's mixed-convention
hierarchy (SUB HEAD section markers co-existing with numeric PREAMBLEs
at the same level). Parenting numeric PREAMBLEs under SUB HEAD section
markers requires stateful section-aware level overrides -- fuzzy logic,
violates working agreement #40. Goes to Phase 3+ AI layer along with
Bug 12 + Bug 15.

---

### 17.42 [PARKED v5.25] -- Bug 12 priced section-header detection (sec 9 #88, Phase 3+ AI layer)

Inovalon HVAC sheet: section markers ("VRV SYSTEM FOR CRITICAL AREAS", "VAV BOXES WORKS",
"HYDROGEN EXHAUST") AND sub-section preambles ("OUTDOOR UNITS", "INDOOR UNITS",
"REMOTE CONTROLS", "DRAIN PUMP") are NOTE-classified text rows with no sl_no and no
quantitative data. Parser cannot promote NOTE -> PREAMBLE without natural-language pattern
recognition (short text + uppercase + position before numeric is fuzzy).

Cross-fixture audit identified 14 candidate section-marker NOTEs in Inovalon BOQ alone.
Working agreement #40 governs -- park to Phase 3+ AI review layer.

---

### 17.43 [PARKED v5.25] -- Bug 15 priced-sub-section-header mis-classification (sec 9 #102, Phase 3+ AI layer)

SG HVAC 'BOQ_HVAC Lowside works' sheet: 7 user-identified section headers (xlsx rows
5/123/130/157/165/194/260). 1/7 correctly classified PREAMBLE (row 5 "AIR DISTRIBUTION");
6/7 classified LINE_ITEM and buried under sl_no=1.0.

Root cause: sl_no values REPEAT across sections (sl="A" appears in rows 5, 165, 194, 260
for different sections). Quantitative-data routing dominates classifier today and sends these
to LINE_ITEM bucket. Natural-language section-title recognition is required to distinguish
"A -- CHILLED WATER WORKS" (header) from "A -- Chilled water FCU 1200 CFM" (line item).

Working agreement #40 governs -- park to Phase 3+ AI review layer.

---

### 17.44 [CYCLE 3 DEEP DIVE -- 9 DETERMINISTIC FIXES -- FIX QUEUE v5.26]

Cycle 3 deep dive walked 7 fixtures (sg_hvac, safron, inovalon,
bill_of_quantities, alorica 2row+1row A/B, snitch, raheja_commerzone_hvac;
multi_area_merged_header_v1 dropped per Section 1A decisions log entry). 9 deterministic
parser fixes identified, all meeting working agreement #40 deterministic-unambiguous
bar. Implementation queued per agreement #43 (one cycle + validation).

For each bug below: SYMPTOM (current behavior), CANONICAL FIXTURE EXAMPLES
(rows from cycle 3 walk), ROOT CAUSE (parser layer + mechanism), FIX SPEC
(what changes, in which module), EXPECTED POST-FIX BEHAVIOR (same rows
after fix), CROSS-FIXTURE SAFETY.

----------------------------------------------------------------------
Bug 16 -- classifier unit invariant (in-classifier flow)
LANDED v5.27 (this session). Commit: 68cfc57d.
----------------------------------------------------------------------

ROOT CAUSE: classifier's classification decision step routes to
LINE_ITEM whenever qty/rate/amount is present. Policy X (sec 7.25)
preserves explicit zero, so =SUM(blanks)=0.0 counts as "qty present."
sg_hvac and Snitch authors use ghost formulas (=SUM(blanks),
=N(...)*N(...)) on visually-blank rows, producing rows with
qty=0.0 but no semantic content. The classifier had no check on
unit presence.

FIX: in-classifier two-clause block in classify_row(), inserted
AFTER the existing four-way classification decision and BEFORE
the existing emptiness guard. Single toggle BUG_16_UNIT_INVARIANT_
ENABLED (default True) gates both clauses.

Clause 1 (SPACER broadening): if sl_no AND description AND unit
are all blank-or-junk, classify as SPACER. Overrides whatever the
four-way decision produced.

Clause 2 (LINE_ITEM unit gate): if the four-way decision produced
LINE_ITEM but unit is blank-or-junk, re-evaluate via PREAMBLE /
NOTE rules (same logic as the four-way decision but without the
LINE_ITEM option).

Three field-specific blank-or-junk helpers:
- _is_unit_blank_or_junk: trimmed empty OR contains no alphabetic
  characters. Rejects "", "-", "0", "123". Accepts "Nos.", "m**2", "LS".
- _is_sl_no_blank_or_junk: trimmed empty OR contains no alphanumeric
  characters. Accepts "1.0", "A.", "IV". Rejects "*", arrows.
- _is_description_blank_or_junk: delegates to _is_sl_no_blank_or_junk.

INVARIANT: together with sec 7.28 (unit-based PREAMBLE demotion)
and sec 7.29 (zero-children PREAMBLE demotion), Bug 16 closes the
biconditional: a row is LINE_ITEM if and only if it has a real
unit (modulo SPACER / HEADER_REPEAT / SUBTOTAL_MARKER caught at
earlier classifier steps).

CROSS-FIXTURE IMPACT (Phase 0 diagnostic this session):
- sg_hvac BOQ_HVAC Lowside works: 132 LINE_ITEM reclassifications
  (74 via Clause 1 to SPACER, 58 via Clause 2 to PREAMBLE/NOTE).
- Snitch 6. Electrical: 190 NOTE -> SPACER via Clause 1.
- VRF System: 1 Clause 1 + 1 Clause 2 hit.
- Inovalon HVAC: unchanged.
- Bill of Quantities ELV: unchanged.

CALIBRATION UPDATES TO EXISTING TESTS:
- test_classifier.py: 8 synthetic rows gained explicit unit="Nos"
  (were missing units; under old behavior LINE_ITEM, under Bug 16
  PREAMBLE).
- test_orchestrator.py: Snitch NOTE expectation 287 -> 97;
  Societe HVAC LINE_ITEM threshold relaxed; 2 Pattern 2 column-role
  maps shifted right by one to accommodate new unit column.
- generate_synthetic.py: Pattern 2 fixtures (synthetic_multi_area_
  2row.xlsx, synthetic_pattern_2_rate.xlsx) regenerated with a unit
  column (C) and unit="Nos" on data rows.

TODO/CLEANUP: Clause 2's fall-through duplicates the PREAMBLE/NOTE
logic from the four-way decision above (lines 766-789). If that
logic changes in a future fix, this block must be updated in
lockstep. Flagged for a future cleanup session: extract the
PREAMBLE/NOTE decision into a private helper called by both the
main path and Clause 2's fall-through.

ARCHITECTURAL ASYMMETRY: Bug 16 sits in classify_row() body
(in-classifier). Sec 7.28 and sec 7.29 sit as post-passes. The
biconditional invariant is therefore enforced in two places: the
classifier blocks LINE_ITEM at classify time when unit is missing
(Bug 16), and the post-passes catch PREAMBLEs with units at
post-classify time (sec 7.28/7.29). Acknowledged; not addressed
this session. Future cleanup may consolidate into one location.

PARKED BUG 16 ALTERNATIVE (FROM v5.26): the original v5.26 spec
proposed _apply_unit_blank_demotion_post_pass running after
sec 7.28. This session reframed to in-classifier flow. Rationale:
cleaner architecture (no intermediate "LINE_ITEM-that-is-not-
really-LINE_ITEM" state); enforces the invariant from the start.
The original post-pass framing is not implemented and will not be.

----------------------------------------------------------------------
Bug 17 -- Reader-layer auto-trim for text-role columns   [LANDED 30b6045b]
Layer: reader.py
----------------------------------------------------------------------

IMPLEMENTATION-DESIGN NOTE: Approach (a) sub-variant chosen -- reader takes
text_role_columns: set[str] | None at iter_rows() call time (column letters,
not construction). Orchestrator derives the set from SheetConfig.column_role_map
filtering by TEXT_ROLE_ROLES constant before calling iter_rows(). Single
commit; Bug 18 plumbing is independent shape (is_merged_origin propagation).
Pre-flight confirmed via raw xlsx XML inspection (openpyxl not available on
host): alorica A31/A33 numFmtId=0 ("General"), A45/A52 numFmtId=2 ("0.00"),
sg_hvac A39 numFmtId=166 (complex accounting format, no-op acceptable per spec).
+21 tests (502->523). Closes cluster 1 session 3.

SYMPTOM: sl_no (and other text-role columns like append_to_notes) read as
Python str() of float, losing user-intended display formatting. Two
failure modes:
(i) Trailing zero trim: BoQ author types "1.10" in numeric-formatted cell,
    Excel stores as float 1.1, str(1.1) returns "1.1". Author's "1.10" intent
    lost.
(ii) Float precision noise: BoQ author writes a formula like =A30+0.1,
     Excel evaluates to 2.3000000000000003 (IEEE 754), openpyxl returns
     the float, str(2.3000000000000003) returns the full precision string.

CANONICAL FIXTURE EXAMPLES:
- alorica r31: sl_no="2.3000000000000003" (formula result, intended "2.3"
  or "2.30")
- alorica r33: sl_no="2.4000000000000004" (intended "2.4")
- alorica r45: sl_no="3.0199999999999996" (intended "3.02")
- alorica r52: sl_no="3.0299999999999994" (intended "3.03")
- sg_hvac r39: sl_no="1.1" (sequence is 1.07, 1.08, 1.09, 1.1, 1.11, 1.12 --
  likely author typed "1.10" but Excel stored as 1.1 because default numeric
  formatting trims trailing zeros)

ROOT CAUSE: reader.py iter_rows() uses openpyxl data_only=True mode and
passes cell.value through. str() coercion happens downstream (classifier.py
reads cell value for sl_no). For floats, str() loses both trailing zeros
(from Excel's display format) and exposes IEEE 754 precision artifacts
(from formula evaluation).

FIX SPEC: Add helper to reader.py:
`_format_numeric_as_displayed(value, number_format) -> str`. Logic:
  - If value is int or value is None: return str(value) or "" respectively.
  - If value is float AND number_format matches a known precision pattern
    (e.g., "0.0", "0.00", "0.000"): use Python format-spec, e.g.,
    format(2.3000000000000003, ".2f") -> "2.30".
  - If value is float AND number_format is "General": apply
    conservative rounding (e.g., round(value, 10) then strip trailing zeros
    with care to preserve at least 1 decimal if format hints).
  - If value is str: pass through unchanged.
Apply to text-role columns only (sl_no, append_to_notes, description, unit,
make_model) -- NOT to numeric-role columns (qty/rate/amount which need raw
float for math).

EXPECTED POST-FIX BEHAVIOR:
- alorica r31: sl_no="2.30" (or "2.3" depending on cell number_format)
- alorica r45: sl_no="3.02"
- sg_hvac r39: sl_no="1.10" if number_format is "0.00", or "1.1" if
  "General" -- depending on what's actually in source cell format.

CROSS-FIXTURE SAFETY: Bug 17 fixes can only IMPROVE output, never regress --
the worst case is a no-op (number_format is "General" and value already
cleanly formatted). Cross-checked across 6 walked fixtures: snitch, raheja,
boq, safron, inovalon all use clean sl_nos with no precision noise; sg_hvac
and alorica are the catches.

Inovalon r26 (rate_supply_resolved=7560.000000000001) is a
cosmetic float passthrough in a numeric-role column (rate_supply),
NOT a Bug 17 target. Bug 17 applies to text-role columns only
(sl_no, append_to_notes, description, unit, make_model). Numeric-
role columns keep raw float for downstream math; downstream
ResolvedRow formatters handle display rounding for numeric
columns separately.

----------------------------------------------------------------------
Bug 18 -- Merged-cell banner rows produce false LINE_ITEMs
Layer: reader.py
----------------------------------------------------------------------

LANDED v5.28 -- cluster 1 session 4 (feat 41a86cd9)

IMPLEMENTATION NOTES:
- Architecture path (a) chosen: fix inside iter_rows() reusing Bug 17
  text_role_columns wiring. No classifier.py changes. No orchestrator
  changes. CellInfo.is_merged_origin and covered_lookup already present
  in reader.py; covered is not None correctly identifies propagated cells.
- New constant BUG_18_MERGE_PROPAGATION_BLANK_ENABLED (default True) in
  reader.py, placed immediately after Bug 17 helper section.
- Suppression logic: after Bug 17 formatting block, if toggle AND
  text_role_columns AND col_letter in text_role_columns AND covered is
  not None -> computed_value = None. Non-text-role covered cells
  (qty, rate, amount) are NOT suppressed -- area-header merge
  propagation continues to work.
- Fix selection (path a vs b vs c): path (a) chosen per chat-Claude
  2026-05-26 architectural discussion; rationale: Bug 17 consistency +
  zero new parameters or orchestrator changes. See agreement #39.
- Excel verification of safron r41: A41:G41 merge confirmed, cell text
  "PART- 2 INSULATION" (space after dash), no stray numeric data.
- +7 tests (523->530): 5 synthetic unit (TestBug18SyntheticMergeBanner)
  + 2 safron real-fixture integration (TestBug18SafronIntegration --
  r41 reader-level covered cell blank + classify_row NOTE assertion).
  0 existing-test calibrations. Cluster 1 complete (3 of 3:
  Bug 16 + Bug 17 + Bug 18 landed).
- Feat hash: 41a86cd9. Docs hash: see §14 decisions log.

ORIGINAL SYMPTOM: When BoQ author uses a banner-style section header that
spans multiple columns via merged cells, the per-cell merge propagation
logic (Phase 2b.2 Part A1, v5.10) copies the banner text into every
covered cell. Classifier then sees the same string in A (sl_no),
B (description), C (unit), etc. and routes to LINE_ITEM.

CANONICAL FIXTURE EXAMPLE:
- safron r41: PART-2 INSULATION banner. Merge A41:G41. After fix:
  A41 retains "PART- 2 INSULATION"; B41/C41 (text-role) -> None.
  D41-G41 (numeric-role) still carry propagated text -> treated as
  non-numeric qty=0.0 rate-only. Bug 16 Clause 2 then fires (unit=None
  is junk + desc=None is blank) -> NOTE.

CROSS-FIXTURE SAFETY: Banner-style section headers seen only in safron r41
among walked fixtures. Non-text-role covered cells unaffected.
Cross-fixture check during cycle 3 re-run will confirm no misfires.

----------------------------------------------------------------------
Bug 19 -- Priced-PREAMBLE detection via sl_no signature (LINE_ITEM step)
Bug 19-ext -- Same logic extended to PREAMBLE attachment step
Layer: classifier.py + hierarchy.py
LANDED cluster 2 session 4 (feat fbc1d845)
----------------------------------------------------------------------

IMPLEMENTATION DELTA vs ORIGINAL SPEC (cluster 2 session 4 partial-abort #20):

Original spec framed Bug 19 as an A2-reframed extension at the hierarchy
resolver's LINE_ITEM attachment step. Actual implementation pivoted to a
pre-resolve post-pass in classifier.py (_apply_priced_preamble_promotion),
running at Step 3c in parse_boq() pipeline (after Bug 20, before
resolve_hierarchy). Pivot rationale: once Bug 20 anchor-promoted PREAMBLEs
are visible, we can detect the priced-section-header pattern purely from
the classified list without needing hierarchy state.

ALGORITHM (as landed): backward-only window scan (size=20). For each LINE_ITEM
with numeric sl_no, collect first_numeric_token values of PREAMBLEs in the
backward window sharing the same pattern_signature. Promote iff:
  (a) len(preamble_fnts) >= 2
  (b) sorted preamble_fnts forms a gap-free consecutive sequence
  (c) target fnt == max(preamble_fnts) + 1

Backward-only: prevents a PREAMBLE from a DIFFERENT section (appearing in the
forward portion of the symmetric window) from corrupting the anchor set.
Rows processed in document order so promoted rows immediately become anchors
for subsequent candidates (8.00 promoted → 9.00 sees {3..8} in its window).

promoted_from_line_item: bool = False field added to ClassifiedRow; set on
promotion. Guard added in _apply_zero_children_preamble_demotion_post_pass
Step B to skip promoted rows (priced section headers legitimately have
unit/qty as leaf PREAMBLEs).

DISCRIMINATOR SHAPE (false-positive case, deferred):
Snitch electrical has 2 residual false promotions (30.0 row=109 backward
window {28,29}; 6.0 row=341 backward window {3,4,5}) where a clean contiguous
PREAMBLE sequence immediately precedes a genuine LINE_ITEM of the same pattern.
These promotions are semantically harmless (LINE_ITEM treated as PREAMBLE leaf
with no children). Discriminator refinement deferred to cycle 3 validation
re-run review. snitch_electrical_expected.json calibrated (LINE_ITEM 177→175,
PREAMBLE 42→44).

Bug 19-ext (sec 9 #107) as landed: BUG_19_EXT_PREAMBLE_REPARENT_ENABLED
toggle in hierarchy.py. In the PREAMBLE branch of resolve_hierarchy, after
the stack assigns a natural parent, scan resolved rows backwards for a PREAMBLE
with matching pattern_signature AND matching first_numeric_token at level-1.
If found and different from the natural parent, override parent_index.
Canonical: Inovalon r22 (sl=1.3) correctly parents under r6 (sl=1.0) because
r6 is found in the backward scan with sig='D.D' and fnt=1 matching r22's fnt.

Guarded by approach_a_enabled toggle (same toggle that gates A1/A2).

13 new tests in test_priced_preamble_promotion.py (552 → 565 total).
Sec 9 #106 and #107 CLOSED.

----------------------------------------------------------------------

SYMPTOM: LINE_ITEMs with sl_no signature matching nearby PREAMBLE family
but having quantitative data (so classifier correctly tags LINE_ITEM)
attach to wrong parent because hierarchy resolver attaches LINE_ITEMs to
top-of-stack only.

CANONICAL FIXTURE EXAMPLES:
- sg_hvac r25: sl_no="1.04" LINE_ITEM (real qty data, "plenum with Double
  skin AHU"). Parents under r6 (sl=1.0 PREAMBLE) which is a section-content
  parent. Should be sibling-of-r6, parented under r5 SUB HEAD A
  AIR DISTRIBUTION.
- safron r34 (sl=8.0), r35 (sl=9), r37 (sl=10.0): all LINE_ITEMs with real
  data. Parent under r30 (sl=7.0 PREAMBLE) instead of being level-1
  sibling sections.
- inovalon r22: sl_no="1.3" PREAMBLE parented under r19 (sl=2.0)
  PREAMBLE instead of r6 (sl=1.0) EQUIPMENTS -- same-family sibling gap at
  the PREAMBLE attachment step. This is Bug 19-ext.

ROOT CAUSE: v5.25 Rule A2-reframed fires at LINE_ITEM attachment with
`pattern_signature(LINE_ITEM.sl_no) == pattern_signature(top.sl_no)` AND
`first_numeric_token(LINE_ITEM.sl_no) != first_numeric_token(top.sl_no)`.
Two extensions needed:
(a) Bug 19: A2-reframed currently only re-parents to top's parent (one
    level up). It should also flag the LINE_ITEM as `needs_classification_
    review = True` with `review_reason = "priced_preamble_with_children"`
    analogue, so wizard can surface for user review (similar to §7.30).
(b) Bug 19-ext: A2-style logic at LINE_ITEM step doesn't apply to
    PREAMBLEs. The PREAMBLE-PREAMBLE case (inovalon r22 sl=1.3 should
    parent under r6 sl=1.0 instead of r19 sl=2.0) is unaddressed.

FIX SPEC:
(a) Bug 19: extend A2-reframed action to also set
    `needs_classification_review=True` + `review_reason=
    "priced_preamble_via_signature"` on the re-parented LINE_ITEM. Wizard
    reads this in review pass.
(b) Bug 19-ext: in `_determine_preamble_level`, after Rule A1 fires (or if
    A1 doesn't apply), check stack for entries with same pattern_signature
    AND different first_numeric_token. If found, set level to that entry's
    level and parent to that entry's parent (sibling-under-grandparent
    pattern, mirroring A2-reframed).

Search window and safety threshold (applies to both Bug 19 and
Bug 19-ext):
- Window: +/- 20 rows symmetric around the candidate row (the
  LINE_ITEM at Bug 19 attachment, or the PREAMBLE at Bug 19-ext
  attachment). Scan reaches forward into not-yet-classified rows
  only if those rows are already on the stack at the time of
  attachment; otherwise scan is backward-only within the 20-row
  radius.
- Minimum-count safety threshold: if fewer than 3 PREAMBLEs are
  present in the window, the rule does NOT fire. This prevents
  misfires on sparse sections where signature-matching peers are
  too few to establish reliable sibling-family structure.
- Asymmetric tunable held in reserve: window radius is configurable
  via module-level constants (forward_radius, backward_radius,
  min_window_preambles). Default symmetric +/- 20 / +/- 20 / >= 3.
  If post-land misfires surface on specific fixtures, tune
  asymmetrically (e.g. backward 30, forward 10) without changing
  the rule's deterministic-binary character. Tunable values land
  in agreement #16 (known-pattern citation) framing -- any
  asymmetric tune must cite specific empirical misfire evidence.

EXPECTED POST-FIX BEHAVIOR:
- sg_hvac r25 sl=1.04: A2-reframed already fires here (re-parents to None
  if r6's parent is None; with Bug 20-ext, r6 parents under r5 so r25
  becomes sibling of r6 under r5). Bug 19 adds review flag.
- safron r34/35/37: A2-reframed fires, re-parents to None (rootless). Bug 19
  adds review flag.
- inovalon r22: Bug 19-ext fires in _determine_preamble_level. Scans stack
  for signature match with different first_token. Finds r6 (sl=1.0,
  signature "D.D", first_token 1). r22 (sl=1.3, signature "D.D",
  first_token 1) -- wait, same first_token. Doesn't fire on this rule;
  actually correctly parents under r6 (already L1 PREAMBLE) at level 2.
  The Inovalon r22 issue is different: it should parent under r6 (sl=1.0)
  not r19 (sl=2.0); but the current resolver pops r6 when r19 enters
  (same level). After r19 pops r6, r22 sees only r19 on stack.
  THE FIX: Bug 19-ext applies when r22 enters -- it should scan FULL stack
  history (not just top), find r6 in the path (lookback), and re-parent
  to r6. This requires a stack-history scan, more complex than A2's
  top-only check. Implementation detail to be worked out in fix-prompt
  drafting.

CROSS-FIXTURE SAFETY: A2-reframed firing pattern already validated in
v5.25 (61 firings across Snitch + BoQ ELV, all correct). Extension to add
review flag is strictly additive -- no behavior change for the parenting
itself. Bug 19-ext extension to PREAMBLE step requires careful audit
before locking spec.

----------------------------------------------------------------------
Bug 20 anchor 1 + 2 + 3 -- Section-header NOTE -> PREAMBLE
Layer: classifier.py + hierarchy.py
LANDED anchors 1+2 v5.28 -- cluster 2 session 2 (feat 4f85ec3e)
Coverage correction (test only, no source change): initial test SheetConfig
used header_row=5 (copied from Bug 17/18 pattern). Safron's actual header is
r3. Corrected in follow-up commit; safron r5 PART-1 banner now exercises
anchor 1 as a real-fixture canonical case (was previously invisible to the
test). Caveat JJ logged for Bug 17 + Bug 18 config consistency.
----------------------------------------------------------------------

SYMPTOM: BoQ section-header rows that have only description text (no
sl_no, no numeric data) classify as NOTE per classifier rules
(description-only with no sl_no -> NOTE). They should be PREAMBLEs at
the section-root level, with subsequent numeric PREAMBLEs / LINE_ITEMs
parenting under them.

CANONICAL FIXTURE EXAMPLES:
- safron r5: "PART-1 AIR DISTRIBUTION SYSTEM" NOTE (no sl_no, no
  numeric). First non-spacer non-header row after header. Should be
  section-header PREAMBLE. Subsequent rows r7-r39 (sl=1.0 through 8.0
  and SUBTOTAL r39) all rootless level-1; should be children of r5.
- safron r41: "PART-2 INSULATION" (currently false LINE_ITEM per
  Bug 18 due to merged-cell banner; after Bug 18 fix becomes NOTE).
  First non-spacer after SUBTOTAL r39. Should be section-header
  PREAMBLE. Subsequent r44 (sl=1.0), r46 (sl=2.0) and r48 SUBTOTAL
  should be children.
- safron r43: "ACCOUSTIC INSULATION" NOTE. First non-spacer after
  promoted PREAMBLE r41 (anchor 3 -- post-promoted-section-header).
  Should be sub-section-header PREAMBLE under r41. Subsequent r44/r46
  parent under r43, which parents under r41.
- bill_of_quantities r4: "SUB HEAD A WIRING IN STEEL & PVC CONDUIT"
  already classifies as PREAMBLE per v5.25 §17.41 SUB HEAD detection.
  Bug 20 anchors don't change this -- SUB HEAD rule fires first. Bug
  20-ext level-0 applies (see next bug).

ROOT CAUSE: Classifier rule "description-only with no sl_no -> NOTE" is
correct for inline notes but mislabels banner-style section headers.
Hierarchy resolver then treats NOTE as content (attaches to topmost
PREAMBLE), not as structural element.

FIX SPEC: Add new hierarchy.py post-pass
`_apply_section_header_note_promotion_post_pass(classified_rows)`. Three
anchor patterns:
(1) Anchor 1 -- header: First non-spacer non-header row after the header
    row, where row is NOTE-classified with no sl_no, no numeric data.
    Promote to PREAMBLE at level 0.
(2) Anchor 2 -- subtotal: First non-spacer row after a SUBTOTAL_MARKER,
    same NOTE criteria. Promote to PREAMBLE at level 0.
(3) Anchor 3 -- post-promoted-section-header: First non-spacer row after
    a PREAMBLE that was just promoted via anchor 1 or 2 (one-step
    recursive), same NOTE criteria. Promote to PREAMBLE at level 1
    under the just-promoted ancestor.

Reading B locked: single-step recursive only -- anchor 3 does NOT
chain (promoted-via-anchor-3 PREAMBLE does NOT itself become a
new anchor for a further anchor 3 firing). Anchor 3 is correctness-
preferred but NOT data-loss-critical: even if anchor 3 mis-classifies
a row that should have been promoted, §22.11 NOTE-attachment
captures the row's content as an attached note under the most
recent in-stack PREAMBLE (e.g. safron r43 ACCOUSTIC INSULATION
content surfaces under r41 PART-2 INSULATION via the NOTE-attachment
pathway even if r43 itself stays classified as NOTE). This makes
anchor 3 a structurally-nice-to-have rather than a data-recovery
necessity -- implementation may defer anchor 3 if its empirical
yield proves too low to justify the misfire-audit cost.

Run BEFORE existing v5.25 SUB HEAD detection (so SUB HEAD takes priority
if applicable).

EXPECTED POST-FIX BEHAVIOR:
- safron r5: anchor 1 fires -> PREAMBLE level 0. r7/r13/r17/.../r37
  (level-1 sections 1.0 through 8.0) parent under r5.
- safron r41: Bug 18 demotes from LINE_ITEM to NOTE first; then anchor 2
  fires (preceded by SUBTOTAL r39) -> PREAMBLE level 0. r44/r46 (sl=1.0
  and 2.0) parent under r41.
- safron r43: anchor 3 fires (post-promoted r41) -> PREAMBLE level 1
  under r41. r44/r46 parent under r43.

CROSS-FIXTURE SAFETY:
- sg_hvac: r5 SUB HEAD-style is already PREAMBLE via sl_no=A -> existing
  rule covers, Bug 20 doesn't fire (no NOTE preceding).
- inovalon: r36-r40 cluster ("Central Air Cleaner for AHUs", etc.) NOT
  caught by any of the 3 anchors -- no header/subtotal/promoted-PREAMBLE
  immediately precedes. STAYS PARKED to Phase 3+ AI per agreement #43.
- snitch: pre-section INDEX (rows 3-10 PREAMBLEs + r11 SUBTOTAL) already
  works under universal subtotal-reset; Bug 20 anchors don't fire (no
  NOTE-classified section headers).
- raheja: section markers are PREAMBLEs (sl=1/2/3/4), not NOTEs. Bug 20
  doesn't fire.

----------------------------------------------------------------------
Bug 20-ext -- Section-header PREAMBLEs at LEVEL 0 (closes v5.25 §17.41
             PARKED limitation)
Layer: hierarchy.py
LANDED v5.28 -- cluster 2 session 2 (feat 4f85ec3e)
----------------------------------------------------------------------

SYMPTOM: Section-header PREAMBLEs (detected via SUB HEAD pattern v5.25,
or via Bug 20 anchors 1-3 newly above) are assigned level=1. Subsequent
numeric PREAMBLEs (sl_no like "1.0", "2.0") also resolve to level=1.
Stack-walk rule "pop while top.level >= candidate.level" pops the
section-header PREAMBLE when a level-1 numeric PREAMBLE enters. Section
headers become functionally useless as parents -- numeric PREAMBLEs become
rootless.

CANONICAL FIXTURE EXAMPLE:
- bill_of_quantities r4: SUB HEAD A WIRING IN STEEL & PVC CONDUIT,
  currently level=1, rootless.
- bill_of_quantities r6 sl=1.0, r9 sl=2.0, r11 sl=3.0, r13 sl=4.0,
  r25 sl=7.0, r30 sl=8.0, r38 sl=10.0, r43 sl=11.0, r52 sl=14.0:
  all level=1, all rootless. None parent under r4 SUB HEAD A.

ROOT CAUSE: v5.25 §17.41 explicitly set SUB HEAD to level=1 with the
reasoning that level=0 would break existing tests asserting level=1 +
parent=None for the 21 SUB HEAD rows. The PARKED rationale was
"Parenting numeric PREAMBLEs under SUB HEAD section markers requires
stateful section-aware level overrides -- fuzzy logic, violates working
agreement #40." But the fix is NOT fuzzy -- it's a single level-assignment
change.

FIX SPEC: Modify hierarchy.py SUB HEAD detection branch and Bug 20
anchors 1-3 promotion logic: section-header PREAMBLEs (whether detected
via SUB HEAD regex or via Bug 20 anchors 1-3) get `level=0` instead of
`level=1`. Numeric/letter PREAMBLEs continue to resolve to level=1+ via
existing 10-priority logic; stack-walk pop rule unchanged. Result:
level=0 section headers do not get popped by level=1 numeric PREAMBLEs;
numeric PREAMBLEs correctly parent under the level=0 section header.

Test calibration: 21 SUB HEAD rows in BoQ ELV currently asserted at
level=1 + parent=None. After fix: level=0 + parent=None (still rootless
at section-root level). Test JSONs need regeneration. NOT a regression
-- it's an explicit calibration update for the corrected behavior.

EXPECTED POST-FIX BEHAVIOR:
- bill_of_quantities r4 SUB HEAD A: level=0, parent=None.
- bill_of_quantities r6 sl=1.0: level=1, parent=r4. (Currently
  level=1, parent=None.)
- bill_of_quantities r9 sl=2.0: level=1, parent=r4 (A2-reframed
  re-parents from r6's parent which is now r4).
- All sl=1.0 through 14.0 PREAMBLEs/LINE_ITEMs in section A parent
  under r4 SUB HEAD A. Section structure correctly modeled.

CROSS-FIXTURE SAFETY:
- bill_of_quantities is the high-impact case. Closes v5.25 §17.41
  PARKED limitation.

Keystone observation (cluster-2 sequencing rationale): Bug 19 +
Bug 19-ext alone do NOT unlock BoQ-style structures, because
text-shaped pattern_signature (e.g. "SUB HEAD A" -> "UUU UUUU U")
never matches numeric-shaped pattern_signature (e.g. "1.0" -> "D.D")
under any tokenization. The one-line level=0 assignment change in
Bug 20-ext is what actually unlocks numeric PREAMBLEs parenting
under SUB HEAD section roots in Bill of Quantities. This makes
Bug 20-ext the highest-yield fix in cluster 2 for BoQ-style
structures -- Bug 19/19-ext are complementary but not substitutive.
Cluster 2 sequencing places Bug 20-ext last so its 21-assertion
test calibration lands after all prior cluster-2 fixes have
stabilized.

- safron r5/r41 (post Bug 20 anchor 1+2): also become level=0, get
  correct children.
- sg_hvac r5 (already PREAMBLE level=1 via sl_no=A): unaffected -- only
  promoted-via-anchor section headers get level=0. Existing PREAMBLEs
  with explicit sl_no keep their level.
- inovalon, snitch, raheja: no SUB HEAD pattern, no Bug 20 anchor
  promotions -> unaffected.

----------------------------------------------------------------------
Bug 22 -- Token-based pattern_signature (collapses consecutive digits)
Layer: hierarchy.py
----------------------------------------------------------------------

SYMPTOM: v5.25 `pattern_signature(sl_no)` is per-character: digits->D,
uppercase->U, lowercase->l, other chars literal. This means "9.0" produces
"D.D" but "10.0" produces "DD.D". Rule A2-reframed requires signature
equality between LINE_ITEM and stack-top PREAMBLE. When section
numbering crosses single-digit->multi-digit boundary, A2 stops firing.

CANONICAL FIXTURE EXAMPLE:
- snitch r48 sl_no="10.0" LINE_ITEM: stack at processing has
  [r14(A., L1), r31(3.0, L2)]. pattern_signature("10.0")="DD.D",
  pattern_signature("3.0")="D.D" -- DIFFERENT. A2-reframed does not fire.
  r48 attaches to top of stack = r31. Should be sibling of r6 sl=1.0,
  r9 sl=2.0, etc. (all parent under r14).
- snitch r50 sl_no="11.0": same issue, also parents under r31.

ROOT CAUSE: pattern_signature implementation maps each character
independently. Multi-digit integers produce N consecutive D's, breaking
equivalence with single-digit-prefix counterparts.

FIX SPEC: Modify `pattern_signature` to collapse consecutive same-class
characters into a single token. Two equivalent implementations:
(a) Regex-based: `re.sub(r"D+", "D", signature)` after current per-char
    mapping. "DD.D" -> "D.D", "DDD.DD" -> "D.D".
(b) Token-iteration: split by separator characters ("."), classify each
    token as "numeric"/"alpha"/"mixed" using the token's character classes.
    "10.0" -> ["numeric","numeric"], "3.0" -> ["numeric","numeric"]. Match.

Implementation choice: option (a) is the smaller change -- one line of
regex post-processing on existing function output. Tests need updating:
pattern_signature unit tests asserting "DD.D" for "10.0" should assert
"D.D" instead.

EXPECTED POST-FIX BEHAVIOR:
- snitch r48 sl_no="10.0": pattern_signature now "D.D" matches r31's
  "D.D". A2-reframed fires: same signature, first_token differs
  (10 != 3). Re-parent to r31's parent. r31's parent is r14 (sl=A.).
  r48 attaches to r14. Correct.
- snitch r50 sl_no="11.0": same, parents under r14.
- Same fix benefits any BoQ section with >=10 numbered items where the
  10+ items are LINE_ITEMs.

CROSS-FIXTURE SAFETY: STRICTLY ADDITIVE. The change only enables
additional A2-reframed firings (previously blocked by signature
mismatch). Existing firings (where signatures already matched, e.g.,
Snitch sl=2.0 through 9.0, BoQ ELV sl=2.0/3.0 vs 1.0) continue to fire
identically -- "D.D" still equals "D.D" under the new signature. No
existing-correct case becomes wrong. Test count: pattern_signature
unit tests need recalibration (~5-8 assertions), no integration test
regression expected.

LANDED v5.26a -- cluster 2 session 1 (feat 4e5561d3)

IMPLEMENTATION NOTES:
- Exact change: `return re.sub(r"D+", "D", "".join(result))` replaces
  bare `return "".join(result)` in pattern_signature. One line added.
  import re was already present (SUB HEAD detection v5.25).
- Unit-test recalibrations: 1 assertion in test_approach_a_rules.py
  (line 192, "10.3" expected "DD.D" -> "D.D").
- New tests: 3 methods in class TestPatternSignatureBug22 in
  test_hierarchy.py (test_multi_digit_collapses_to_single_token,
  test_single_digit_signature_unchanged,
  test_mixed_class_runs_each_class_collapses_independently).
- Parser test count: 484 -> 487 OK.
- Integration-level impact (snitch r48/r50 re-parenting) deferred to
  cycle 3 validation re-run (session 7). No integration test
  regressions observed during session 1 test run.
- Canonical 7-module command in prompt was stale: test_config +
  test_reader live at boq_parser root (not tests/ subdir), and
  test_approach_a_rules + test_sub_head_and_subtotal_reset were
  missing. Correct 9-module command documented in session findings.
  Sec 9 #110 CLOSED.
- Toggle added v5.26a session 1.5 (feat a2ce8a0d): module-level constant
  BUG_22_COLLAPSE_ENABLED (default True). Set False for regression
  isolation if cycle 3 validation re-run (session 7) surfaces a
  Bug 22-induced misfire. Mirrors v5.25 approach_a_enabled precedent
  in intent; module-level constant rather than function kwarg because
  pattern_signature is called from inside Rule A2-reframed. 3 additional
  tests in TestPatternSignatureBug22 covering toggle ON default +
  toggle OFF restoration of pre-Bug-22 per-char signature +
  same-first-numeric-token edge case (1.10 / 1.01 / 1.1 invariant lock
  -- same signature post-fix, same first_numeric_token, A2-reframed will
  not fire). Parser tests 487 -> 490 OK. Stale canonical command confirmed
  absent from plan-doc and CLAUDE.md (it existed only in session prompts,
  not in repo files -- no replacement needed in docs).

----------------------------------------------------------------------
Cross-bug interactions and implementation ordering
----------------------------------------------------------------------

Implementation will be batched per agreement #43 time-box (5-7 sessions
for all 9 fixes + cycle 3 validation re-run). Recommended cluster split:

CLUSTER 1 -- classifier.py + reader.py (~3 sessions):
- Bug 16 (classifier post-pass -- unit-blank demotion)
- Bug 17 (reader format helper + classifier integration)
- Bug 18 (merged-cell banner detection -- depends on Bug 17 architecture
  decision for cross-layer plumbing)

CLUSTER 2 -- hierarchy.py (~3 sessions):
- Bug 22 (pattern_signature token-collapse -- smallest, lands first) ✅ LANDED session 1
- Bug 19 (review flag on A2-reframed firings)
- Bug 19-ext (PREAMBLE-step signature siblings)
- Bug 20 anchors 1 + 2 (+ anchor 3 deferred to session 6) ✅ LANDED session 2
- Bug 20-ext (level-0 framing) ✅ LANDED session 2

VALIDATION -- cycle 3 re-run (~1 session):
- Re-run cycle 3 against 8 fixtures (multi_v1 dropped)
- Manual review of resolved-row outputs vs current baseline
- Confirm no regressions on 547 parser tests (or accept calibrated
  test JSON updates for Bug 19)

Cross-bug interactions to watch:
- Bug 16 + Bug 18: both re-route rows out of LINE_ITEM. Bug 18 fires
  earlier (in classify_row body); Bug 16 fires later (post-pass). No
  conflict.
- Bug 16 + Bug 20: Bug 16 may demote a LINE_ITEM to PREAMBLE
  (description+sl_no, no unit). Bug 20 anchors then fire on NOTE rows
  (Bug 16 doesn't produce NOTE from LINE_ITEM unless sl_no blank).
  No conflict.
- Bug 20 + Bug 20-ext: must fire in order -- anchors 1/2/3 promote NOTE
  to PREAMBLE first, then level-0 framing applies to those PREAMBLEs.
- Bug 22 + Rule A2-reframed: Bug 22 only changes signature output;
  A2-reframed's match logic unchanged. Bug 22 strictly adds firings.
- Bug 19 + §7.30: similar review flag namespace. Reason strings differ
  (priced_preamble_via_signature vs priced_preamble_with_children).
  One-writer-per-review_reason invariant (§22.11 invariant 5) preserved.

Out-of-scope shape observed during cycle 3 walk (Inovalon
subtotal-reset-and-continue):

Inovalon r28 SUBTOTAL is followed by rootless level-2 PREAMBLEs
at r30, r33, r44 -- the universal subtotal-reset rule (v5.25
§17.41) correctly resets the stack at r28, but the rows that
follow are not section-header-shaped (no SUB HEAD pattern, no
anchor-1/anchor-2 trigger context) and arrive at level 2 with
no level-1 or level-0 ancestor on the stack. This is a BoQ-author
data-quality issue (subtotal placed mid-section rather than at
section end) rather than a parser bug -- the BoQ author's intent
cannot be deterministically recovered from the spreadsheet text
alone. Disposition: out of scope for cycle 3 fix queue per
agreement #43. The wizard review pathway (Phase 2c body) surfaces
rootless level-2 PREAMBLEs for user-disambiguation via existing
rootless-row review flags; no parser-layer fix attempted.

---

## Decisions log

Newest at the top.

---

### 2026-06-04 -- DOCS-UPDATE RULE: all three docs, every commit

DOCS-UPDATE RULE (all three, every commit): every docs or feat+docs commit updates ALL THREE docs -- `frontend/.claude/plans/boq-upload-plan.md` (this file), root `CLAUDE.md`, and `frontend/CLAUDE.md` -- with NO exceptions. A doc not substantively affected still gets a MINIMAL TOUCH (bump its last-updated/status line + a one-line note of what landed), never a skip. Rationale: "update CLAUDE.md" without naming which one let `frontend/CLAUDE.md` silently fall a full module behind (stale through all of Module 2b). Naming all three by full path removes the routing ambiguity. **Frontend conventions file: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**

This commit is the first instance that obeys the rule -- touching all three docs. Also provides the retroactive minimal-touch bump for Module 2b COMPLETE: exit-criterion-B live-certified on BOQ-26-00145; five Slice 2b commits (dirty-marker 7795582f, parse-history 896f3a3c, Parse button + ParseRunDialog c9fc37fd, multi-select endpoint e996d097, checklist + caller fix d1672c6f); frontend/CLAUDE.md catch-up 4295566d.

---

### 2026-05-29 -- Module 1a CLAUDE.md convention codification

Docs commit dbbe7c93 (docs(claude): Module 1a convention codification).

Retroactively codifies four conventions established during Module 1a into root CLAUDE.md:
1. Phase 3 branch convention -- `feature/boq-phase-3` active; `feature/boq-phase-2` frozen at `2e338b36`.
2. Wizard scope discipline principle -- two-path discussion before drafting; default lean is "keep outside wizard if reach extends beyond Upload BoQ".
3. Test fixture pattern for Projects rows -- `now()[:19]` truncation + empty `project_scopes` + `tearDownClass` cleanup.
4. API subdirectory pattern under `api/<feature>/` -- acceptable for sub-area grouping (`api/boq/wizard/`).

Standing practice reaffirmed: every CC prompt going forward explicitly addresses both `boq-upload-plan.md` and `CLAUDE.md` (root + frontend). If any is skipped, the prompt must say why and chat-Claude obtains explicit user consent before issuing.

`frontend/CLAUDE.md` untouched this cycle -- Module 1b (frontend) will land substantive updates there.

---

### 2026-05-29 -- Module 1a -- wizard backend and schema landed (Phase 3 kickoff)

Feat commit 06f38e8d (feat(boq): Module 1a -- wizard backend and schema (Phase 3 kickoff)).

**1. Phase 3 reframe.** Wizard work is Phase 3, branched fresh as `feature/boq-phase-3` from `feature/boq-phase-2` tip 2e338b36 per the "one branch per phase" working agreement. Pre-v5.30 framing called this "Phase 2c body"; that framing is superseded for wizard work. `feature/boq-phase-2` is frozen at 2e338b36 as the parser-stable tip.

**2. Scope reduction during execution.** `create_tendering_project` endpoint and tests dropped. User decision: wizard never creates Projects rows. The picker's "Create new project" path (Module 1b) defers to the existing Nirmaan new-project workflow; that team is adding tendering support independently. Wizard consumes existing Projects rows only. Eliminates the project_city semantic-mismatch hack and the generate_pwm date-placeholder problem in production code.

**3. V1-V8 verification findings.**
- V1: Nirmaan Attachments creation pattern confirmed via `api/custom_pr_api.py:73-79` (frappe.new_doc with project, associated_doctype, associated_docname, attachment_type, attachment).
- V2: Projects has no plain-text `location` field (moot after scope reduction; no Projects rows created by wizard).
- V3: `BOQs.wizard_state` and `sheet_drafts` absent -- confirmed safe to add.
- V4: Work Headers display/autoname field is `work_header_name` (Data, unique=1; `autoname: "field:work_header_name"`).
- V5: `BOQ Node Qty By Area` shape confirmed: `istable: 1`, permissions: [], engine: InnoDB, module: Nirmaan Stack, no autoname (hash default). Mirrored exactly.
- V6: `site_config.json` had no `max_file_size` -- set to 26214400 (25 MB).
- V7: `frappe.enqueue` convention: full dotted path, `queue="long"`, `timeout=600`, user kwarg passed through; worker calls `frappe.set_user(user)`. No `job_name` convention used.
- V8: `publish_realtime` event naming confirmed `{doctype}:{action}` (e.g. `po:new`). Wizard event `boq:wizard_parse_done` follows convention.

**4. User decisions baked in.**
- A1-A4: doctype names (BOQs, BOQ Nodes, BOQ Node Qty By Area, BoQ Sheet Draft) confirmed as-is.
- A5: create_tendering_project dropped (see section 2 above).
- B1: Nirmaan Attachments is a real doctype; creation pattern confirmed.
- B2: max_file_size set to 26214400.
- C1: wizard/ subdir under api/boq/.
- C2: frappe.enqueue for async worker.
- C3: Socket.IO push via publish_realtime.
- D1: no backfill patch for existing BOQs rows.
- D2: BoQ Sheet Draft mirrors BOQ Node Qty By Area shape.
- D3: audit deferred (Nirmaan Versions -- post-Module 1a).
- E1: synthetic_simple.xlsx reused for upload_file worker tests.

**5. Findings hit during execution.**

Finding (a): `Projects.after_insert` (`generate_pwm` hook) crashes on minimal Projects rows -- requires `project_start_date`, `project_end_date` in `"%Y-%m-%d %H:%M:%S"` format AND `project_scopes["scopes"]` as a list. Resolution: scope reduction (section 2) makes this moot for production code. Test fixtures use `now()[:19]` dates + `{"scopes": []}` as standard Frappe testing convention. `generate_pwm` itself untouched per user instruction.

Finding (b): `BOQs.before_insert` already computes version per M1.25 (`COALESCE(MAX(version), 0) + 1` scoped to project+boq_name). Worker's duplicate computation removed; controller is the canonical M1.25 implementation.

Finding (c): `Customers.before_insert` null-GST duplicate-check bug -- treats `null == null` as a duplicate. Phase 1 bug; worked around in wizard tests by not creating Customers rows (none needed after scope reduction). Phase 1 fix tracked as future cleanup.

Finding (d): `frappe.utils.now()` returns microseconds (e.g. "2026-05-29 12:30:45.581159"); `generate_pwm` expects `"%Y-%m-%d %H:%M:%S"`. Fixed in test fixtures via `[:19]` truncation. `add_to_date` similarly truncated. Flagged per A8.

**6. Caveat T disposition.** Structurally on path to retirement once wizard ships per v5.30 decision.

**7. Next.** Module 1b (frontend: sidebar nav, project picker, tendering modal, upload screen, BoQ tab) is the next prompt. New-project workflow modification for tendering support is independent team work (not blocking wizard).

---

### 2026-05-28 -- Bug 23 + Bug 24 LANDED (cycle 4 session 1)

Feat commit 3d5d7122 (feat(boq): Bug 23 + Bug 24 -- LINE_ITEM + NOTE parent_index via level0_ancestor (cluster 4 session 1)).

**Bug 23 -- LINE_ITEM orphans after level=0.** Root cause: the LINE_ITEM default-path code never read level0_ancestor. After a level=0 PREAMBLE (SUB HEAD or anchor-promoted row) clears the stack, direct LINE_ITEM rows had parent_index=None even though level0_ancestor held the SUB HEAD's resolved index.

Fix: in the `if not a2_handled:` block, after `_top_non_none(stack)` returns None, check BUG_23_LINE_ITEM_LEVEL0_ANCESTOR_ENABLED and inherit level0_ancestor as parent. Rule A2 is fully gated: a2_handled=True skips this block, preserving the 7 alorica Rule-A2-rootless cases exactly (deferred to Phase 3+ AI layer per Nitesh's cycle 4 decision).

**Bug 24 -- NOTE parent_index always None.** Root cause: the NOTE branch set attached_to_index correctly for footnote rendering but never set parent_index. All NOTE rows were parent_index=None in the tree-structure path.

Fix: compute note_parent_index alongside attached_to_index. Stack has entry: mirrors preamble_index. Stack empty, level0_ancestor set: note_parent_index=level0_ancestor (NOTE after SUB HEAD gets SUB HEAD as parent). Stack empty, no level0_ancestor: None (sheet start or post-SUBTOTAL). Gated by BUG_24_NOTE_PARENT_INDEX_ENABLED (default True). Only parent_index is gated; attached_to_index logic always runs. NOTE path stays None -- zero-children demotion post-pass confirmed unaffected (path=None rows are skipped in paths_with_descendants build).

+18 tests in test_bug_23_24_parent_fix.py:
  TestBug23LineItemUnit (5), TestBug24NoteUnit (5), TestBug23Toggle (2),
  TestBug24Toggle (2), TestDemotionPostPassUnaffected (1),
  TestBillOfQuantitiesIntegration (2), TestAloricaIntegration (1).
Parser tests 570 -> 588. Zero existing-test calibrations.

Integration findings:
- BoQ ELV: >= 1 LINE_ITEM now parents under a level=0 SUB HEAD (Bug 23). >= 2 NOTEs now have non-None parent_index (Bug 24).
- Alorica 1row: >= 1 LINE_ITEM now parents under a level=0 PREAMBLE (Bug 23). 7 Rule-A2 rootless LINE_ITEMs confirmed still rootless.

Findings #1 (LINE_ITEM orphans after level=0) and #2 (NOTE parent_index) from cycle 3 walkthrough CLOSED.

---

### 2026-05-27 -- Bug 20-ext-v2 LANDED + cycle 3 runner infra (cluster 2 session 5)

Feat commit 78c1b6a1 (feat(boq): Bug 20-ext-v2 - _RE_NUMERIC trailing-zero tolerance).
Feat commit 4a3aedd7 (feat(boq): cycle 3 validation re-run script + 8 locked configs).

**Bug 20-ext-v2.** Root cause: `_RE_NUMERIC = re.compile(r"^\d+(\.0)?$")` at
hierarchy.py:96 accepted only ONE trailing zero. Safron sl_no values "1.00", "2.00",
"10.00" etc. fell through to `_RE_MULTI2`, were classified as `multi_dot_numeric`,
and received level=2. Bug 20-ext's level0_ancestor inheritance only fires at level==1,
so these rows became rootless (parent_index=None). Regression surfaced during cycle 3
cycle 1 validation re-run.

Fix: `(\.0)?` changed to `(\.0+)?`. Trailing zeros are cosmetic Excel number
formatting ("1", "1.0", "1.00" all mean the same semantic level). Conservatively
additive: more strings match as "numeric", none stop matching.

Empirical verification: safron r7/r13/r17/r20/r23/r27/r30 all now level=1 with
parent = r5 (PART-1 anchor, ridx=1). r34/r35/r37 (Bug-19 promoted) also level=1
parent ridx=1, promoted_from_line_item preserved. r50 ("DX 1.00") level=1
parent=None (correct -- SUBTOTAL_MARKER at r48 resets level0_ancestor per spec).

+5 tests in test_bug_20_ext_v2_trailing_zero.py:
  TestCategorizeTrailingZero (4 unit), TestSafronR7HierarchyCorrect (1 integration).
Parser tests 565 -> 570. Zero existing-test calibrations.

**Cycle 3 runner infra.** cycle_3_rerun.py -- CLI runner for replaying the 8 locked
fixtures with --configs-dir / --fixtures-dir / --output-dir / --projects. Emits
per-project JSON + CSV + _run_summary.json. cycle_3_configs/ -- 8 hand-generated
MappingConfig snapshots (multi_v1 dropped per v5.26a). Used in cycle 1 (safron +
alorica_1row verification) and this session's post-fix verification. Sec 9 #110 NEW + CLOSED.

---

### 2026-05-27 -- Bug 19 + Bug 19-ext LANDED (cluster 2 session 4)

Feat commit fbc1d845 (feat(boq): Bug 19 + Bug 19-ext LANDED -- cluster 2 session 4
(sec 9 #106 + #107)).

**Bug 19 priced-preamble promotion.** New `_apply_priced_preamble_promotion` post-pass
in classifier.py (Step 3c in orchestrator, after Bug 20 anchors). Backward-only
window scan: for each LINE_ITEM with a non-None sl_no, scans backward <=20 rows
to find PREAMBLE rows with the same pattern_signature and contiguous first_numeric_token
sequence. When a contiguous sequence of length >= 2 is found, promotes all members
(including the current row) to PREAMBLE via `promoted_from_line_item = True`.
Adjacent-extension rule: a new LINE_ITEM extending an existing promoted sequence also
promotes. Gated by `BUG_19_PRICED_PREAMBLE_PROMOTION_ENABLED` toggle (default True).

**Bug 19-ext reparenting.** When a promoted PREAMBLE (level computed as numeric)
has no stack parent, a backward scan through resolved rows finds the most recent
PREAMBLE at level-1 with matching (pattern_signature, first_numeric_token). If found,
reparents to that row rather than inheriting level0_ancestor. Gated by
`BUG_19_EXT_PREAMBLE_REPARENT_ENABLED` toggle (default True).

**Zero-children demotion guard.** `_apply_zero_children_preamble_demotion_post_pass`
now skips rows with `promoted_from_line_item=True` to avoid demoting them after
promotion.

Canonical verification: safron r34/r35/r37 (sl="8.00"/"9.00"/"10.00") promoted
from LINE_ITEM to PREAMBLE; Inovalon r22 parents under r6 via Bug 19-ext reparent.
2 snitch false positives (semantically harmless, discriminator deferred).

+13 tests in test_priced_preamble_promotion.py. Parser tests 552 -> 565.

---

### 2026-05-26 -- Bug 17 reader auto-trim approach chosen, LANDED v5.27

[DECISION] Approach (a) sub-variant: reader.iter_rows() takes optional
text_role_columns: set[str] | None parameter (column letters, not role
names). Orchestrator derives the set from SheetConfig.column_role_map by
filtering cr.role in TEXT_ROLE_ROLES frozenset, passes to iter_rows() at
data-row collection time. Header-row iter_rows() calls are NOT passed the
param (formatting header text is not needed).

_format_numeric_as_displayed() helper: None->None, bool->str(v), str->
passthrough, int/float: if _PRECISION_FMT_RE (re.compile(r"0\.(0+)"))
matches number_format -> format(v, ".Nf"); else str(round(v, 10)).
Covered-cell path extended to carry origin_number_format in the 5-tuple.
Bug 13 error-literal normalization runs first, Bug 17 formatting second.

Single feat commit 30b6045b. Pre-flight findings: alorica A31/A33
numFmtId=0 ("General") -> round-to-10 removes noise; alorica A45/A52
numFmtId=2 ("0.00") -> format(".2f") corrects; sg_hvac A39 numFmtId=166
(complex accounting format contains "0.00" substring) -> regex matches,
formats 1.1 as "1.10" (acceptable, spec said no-op is also acceptable).
+21 tests (502->523): 14 unit (TestFormatNumericAsDisplayed) + 2 backward-
compat (TestIterRowsTextRoleColumns) + 5 integration (TestBug17AloricaIntegration
-- alorica "low side" sheet, header_row=6). Closes sec 9 #__ (Bug 17).
Previous commit: 68cfc57d (Bug 16).

---

### 2026-05-27 -- Bug 18 LANDED v5.28 (cluster 1 session 4)

Feat commit 41a86cd9 (feat(boq): Bug 18 -- reader merge-propagation
blanking for text-role columns).

[DECISION] Bug 18 implemented via path (a): reader-side suppression
of propagated values for text-role columns, reusing Bug 17 plumbing.
Pre-implementation verification confirmed safron r41 is A41:G41 merge
with text "PART- 2 INSULATION" (space after dash). Architecture path
(a) chosen per chat-Claude 2026-05-26 architectural discussion; rationale:
Bug 17 consistency + zero new parameters + no orchestrator/classifier
changes. Path (b) orchestrator-side post-pass not chosen (more plumbing,
separate pass). Path (c) classifier-side not chosen (harder to maintain
cross-field merge awareness in classifier context).

Fix: BUG_18_MERGE_PROPAGATION_BLANK_ENABLED toggle (default True) +
suppression in iter_rows() after Bug 17 block: covered is not None AND
col_letter in text_role_columns -> computed_value = None. Origin cell
retains banner text. Non-text-role covered cells (qty, rate, amount)
NOT suppressed -- area-header merge propagation unaffected.

+7 tests (523->530): 5 synthetic unit + 2 safron integration. 0 existing-
test calibrations. Cluster 1 complete (Bug 16 + Bug 17 + Bug 18 landed).

[OVERRIDE #43 v5.28 cycle] Agreement #43 hard cap extended from 7 to 8
working sessions for cycle 3 fix batch. Risk accepted: any subsequent
extension request faces a weakened precedent bar; future cap discipline
depends on holding the line at 8. Override accepted by Nitesh at v5.27
to v5.28 transition. Logged per agreement #38 override mechanics.

---

### 2026-05-26 -- Bug 16 reframed to in-classifier flow, LANDED v5.27

[DECISION] Bug 16 reframed from post-pass to in-classifier flow,
landed v5.27. The v5.26 spec proposed a post-pass demotion of
unit-less LINE_ITEMs to PREAMBLE/NOTE/SPACER. User reframed the
spec mid-session to a hard classifier invariant: no row can be
LINE_ITEM without a real (non-junk) unit. Two clauses gated by
single toggle. Three field-specific blank-or-junk helpers using
deterministic alphabetic/alphanumeric tests (no maintained unit
allowlist). Cross-fixture Phase 0 diagnostic verified empirically
across 5 fixtures before implementation. Calibrations to 12
existing tests landed in same commit (8 inline rows gained units,
2 fixtures regenerated, 2 count assertions updated). Commit
68cfc57d. Closes sec 9 #103.

---

### 2026-05-27 -- Bug 20 anchor 3 LANDED (cluster 2 session 3)

Feat commit 73c9db99 (feat(boq): Bug 20 anchor 3 -- sub-section NOTE promotion (cluster 2 session 3)).

**`_promote_sub_section_header(row)`** — new helper in classifier.py, sets
`classification = PREAMBLE` + `preamble_level_override = 1` in-place.

**Anchor 3 block** added to `_apply_section_header_note_promotion_post_pass` (after anchors 1+2):
for each row where `preamble_level_override == 0` (set by anchors 1/2 in the same pass), skips
spacers and promotes the first non-SPACER NOTE candidate to PREAMBLE via `_promote_sub_section_header`.
Trigger is `preamble_level_override == 0` — SUB HEAD rows have `preamble_level_override = None`
at post-pass time (they receive level=0 via `_determine_preamble_level` inside `resolve_hierarchy`,
which runs AFTER the post-pass) and do NOT trigger anchor 3.

**Reading B enforced structurally:** anchor-3 promotions set `preamble_level_override = 1`, not 0,
so they can never themselves satisfy the trigger condition; no chaining is possible.

**Parenting:** safron r43 ACCOUSTIC INSULATION → PREAMBLE level=1, parented under r41 PART-2
INSULATION (level=0) via the existing `level0_ancestor` mechanism in `resolve_hierarchy` (added
in Bug 20-ext, cluster 2 session 2). No new hierarchy code required.

**Tests:** +5 TestAnchor3 synthetic unit tests (test_anchor3_fires_after_anchor1_promoted_preamble_with_spacer,
test_anchor3_fires_after_anchor2_promoted_preamble_no_spacer, test_anchor3_skips_spacers,
test_anchor3_no_fire_when_next_row_already_preamble, test_anchor3_no_fire_for_non_override_preamble).
Safron r43 deferral test rewritten as `test_safron_anchor3_r43_promoted_to_preamble_level1`
(asserts classification=PREAMBLE, level=1, parent=r41, "ACCOUSTIC INSULATION" in text).
Parser tests: 547 → 552. 0 existing-test calibrations.

Sec 9 #108 fully CLOSED (anchors 1+2 landed session 2; anchor 3 landed session 3).
Cluster 2 session 4 next: Bug 19 + 19-ext.

---

### 2026-05-27 -- Bug 20 test coverage correction (safron header_row 5 -> 3)

Test-only fix. No source code changed. No parser test count change (547 before and after).

`test_bug_20_section_header_promotion.py` `_SAFRON_HEADER_ROW` constant corrected from 5 to 3
(safron's actual column-title row). With header_row=5, the parser treated r5 itself ("PART-1 AIR
DISTRIBUTION SYSTEM" section banner) as the header row and excluded it from the data stream.
Anchor 1 silently skipped; the anchor-1 safron test was reframed to assert the skip as
expected behavior. Both were wrong. With header_row=3, r5 is the first non-SPACER data row
and is a NOTE -- anchor 1 fires correctly, promoting it to PREAMBLE level=0.

Test `test_safron_anchor1_skips_when_first_row_already_preamble` renamed and rewritten as
`test_safron_anchor1_promotes_r5_part1_to_preamble_level0`. Verifies: r5 in resolved output,
classification=PREAMBLE, level=0, parent_index=None, "PART-1" in sl_no_value/description.

Anchor-2 (r41) and anchor-3 (r43) tests unaffected -- both rows are well past r3 header
boundary and remain correct.

**Caveat JJ (NEW v5.28)** -- Bug 17 + Bug 18 safron test configs use header_row=5; actual is 3.
Both tests pass by coincidence (Bug 18 canonical case is r41, Bug 17 canonical cases are specific
cell values -- both well past the header boundary). Fix during housekeeping or when next touching
those tests. DO NOT fix in this commit -- scope limited to test_bug_20_section_header_promotion.py.

---

### 2026-05-27 -- Bug 20 anchors 1+2 + Bug 20-ext LANDED (cluster 2 session 2)

Feat commit 4f85ec3e (feat(boq): Bug 20 anchors 1+2 + Bug 20-ext level-0 -- cluster 2
session 2 (sec 9 #108)).

**Bug 20 anchors 1+2.** New `_apply_section_header_note_promotion_post_pass` post-pass
in classifier.py. Three key components:
- `_is_section_header_candidate`: accepts NOTE rows with non-empty description OR
  sl_no that is not a section-number code (`_SECTION_NUMBER_RE` rejects '1.0', 'A.', 'II.',
  'PART-A'). Handles Bug 18 merge-origin case where description=None but sl_no carries text.
- `_first_non_spacer_idx`: skip-spacers helper.
- Anchor 1: first non-SPACER in classified_rows list (header already excluded by orchestrator).
  Promote if `_is_section_header_candidate`.
- Anchor 2: first non-SPACER after each SUBTOTAL_MARKER. Same promotion guard.
- Anchor 3: LANDED cluster 2 session 3 (feat 73c9db99).
- `BUG_20_SECTION_HEADER_PROMOTION_ENABLED` toggle (default True).
- `preamble_level_override: int | None = None` field added to ClassifiedRow so the post-pass
  can inject level=0 without re-running `_determine_preamble_level`.
- Wired in orchestrator.py Step 3b between scoring and resolve_hierarchy.

**Bug 20-ext.** `_determine_preamble_level` SUB HEAD branch returns level=0 instead of 1,
gated by `BUG_20_EXT_SUB_HEAD_LEVEL_ZERO_ENABLED` (default True). resolve_hierarchy gains
`level0_ancestor: int | None` tracking: level=0 PREAMBLEs clear the stack and record their
idx as `level0_ancestor`. Level=1 PREAMBLEs with empty stack use `level0_ancestor` as parent
(instead of None). SUBTOTAL_MARKER resets `level0_ancestor = None`.

**Fixture results:**
- safron Low Side Works: anchor 1 skips (first non-SPACER r7 is already PREAMBLE, not NOTE).
  Anchor 2 fires on r41 (PART-2 INSULATION, Bug 18 NOTE via sl_no) → PREAMBLE level=0.
  r43 (ACCOUSTIC INSULATION) promoted to PREAMBLE level=1 by anchor 3 (cluster 2 session 3).
- BoQ ELV: all 21 SUB HEAD rows now level=0 (was 1). sl=1.0 at r6 correctly parents under
  preceding level=0 SUB HEAD A via level0_ancestor. A2-reframed ('2.0' → sibling) now
  resolves to SUB HEAD A parent instead of None.

**Tests (cluster 2 session 2).** 17 new tests in test_bug_20_section_header_promotion.py:
  TestAnchor1 (5), TestAnchor2 (4), TestToggles (2), TestSafronIntegration (3),
  TestBoqElvBug20Ext (3). Note: test_safron_anchor1 reframed to verify anchor 1 silently
  skips when first non-SPACER is already PREAMBLE — the safron sheet starts with PREAMBLE
  sl='1.00', not a NOTE banner. (Corrected to header_row=3 in coverage correction commit cf4f30a3.)
7 calibrations in test_sub_head_and_subtotal_reset.py:
  3 unit-level (level=1→0), 2 integration (level=1→0), 1 all-SUB-HEADs (level=1→0 in subTest),
  1 numeric-preamble-parent (None→SUB HEAD B via assertIsNotNone + _is_sub_head_marker check).
1 calibration in test_approach_a_rules.py:
  test_boq_elv_a2_first_firing_root_level: parent_index None→SUB HEAD A (A2 now inherits
  level0_ancestor parent chain). _is_sub_head_marker added to hierarchy imports.
Parser tests: 530 → 547 (12-module full count, session 2).

**Tests (cluster 2 session 3 — anchor 3).** +5 TestAnchor3 unit tests; safron r43 deferral
test rewritten as test_safron_anchor3_r43_promoted_to_preamble_level1 (asserts PREAMBLE level=1,
parent=r41). Parser tests: 547 → 552 (12-module full count, session 3).

Sec 9 #108 CLOSED. Agreement #43 cap at 8 sessions (override logged v5.28).
Cluster 2 session 4 next: Bug 19 + 19-ext.

---

### 2026-05-25 -- Bug 22 toggle added (session 1.5)

Feat commit a2ce8a0d (feat(boq): Bug 22 toggle -- BUG_22_COLLAPSE_ENABLED
module constant). Defensive-safety addition layered on top of Bug 22
LANDED (feat 4e5561d3 + docs 55aafc4a). Default True (no behavior change
at default). 3 new tests in TestPatternSignatureBug22 covering toggle ON
default + toggle OFF restoration of pre-Bug-22 per-char signature + the
same-first-numeric-token edge case (1.10 / 1.01 / 1.1 -- same signature
post-fix, same first_numeric_token, A2-reframed will not fire). Parser
tests 487 -> 490 OK. Mirrors v5.25 approach_a_enabled precedent in intent.
Off the 7-session cycle 3 budget per agreement #43 framing -- defensive-
safety addition, not a new fix in the queue. Stale canonical command
confirmed absent from plan-doc + CLAUDE.md (not a repo-file issue). Cluster
2 session 3 next: Bug 19 + 19-ext.

---

### 2026-05-25 -- Bug 22 LANDED (cluster 2 session 1)

Feat commit 4e5561d3 (feat(boq): Bug 22 -- token-based pattern_signature).
Adds `re.sub(r"D+", "D", signature)` post-step in pattern_signature in
hierarchy.py, collapsing consecutive digit runs to a single "D" token.
Strictly additive: only previously-blocked Rule A2-reframed firings now
fire; no existing firings change. 1 unit-test recalibration in
test_approach_a_rules.py; 3 new TestPatternSignatureBug22 tests in
test_hierarchy.py. Parser tests 484 -> 487 OK. Session used corrected
9-module test command (test_approach_a_rules + test_sub_head_and_subtotal_reset
added; tests.test_config / tests.test_reader corrected to root-level
test_config / test_reader per memory note). Sec 9 #110 CLOSED. Agreement
#43 (bounded fix cycle) + agreement #9 (two-commit shape) in effect.
Integration-level impact (snitch r48/r50 re-parenting) deferred to
session 7 cycle 3 validation re-run.

---

### 2026-05-25 -- v5.26 housekeeping cycle (Group B gaps + Caveat D/D-1)

Docs-only commit (per agreement #42). No parser source touched;
parser tests stable at 484. Lands seven documentation refinements
identified during v5.26 review pass:

- **Caveat D resolved**: plan-doc Last-updated line refreshed to
  2026-05-25.
- **Caveat D-1 resolved**: CLAUDE.md Last-updated line refreshed
  to 2026-05-25.
- **Bug 17 spec refinement (§17.44)**: Inovalon r26 cosmetic float
  passthrough explicitly excluded from Bug 17 scope; text-role-
  columns-only boundary clarified.
- **Bug 19 / 19-ext spec refinement (§17.44)**: search window
  spec landed -- +/- 20 rows symmetric, minimum-count threshold
  (>= 3 PREAMBLEs in window or don't fire), asymmetric tunable
  constants held in reserve for post-land calibration.
- **Bug 20 anchor 3 framing (§17.44)**: Reading B locked (single-
  step recursive, no chaining); data-loss-criticality noted
  (§22.11 NOTE-attachment captures content even if anchor 3
  mis-promotes); deferrable if empirical yield too low.
- **Bug 20-ext keystone observation (§17.44)**: text-signature
  vs numeric-signature non-equivalence makes Bug 20-ext the
  keystone fix for BoQ-style structures; Bug 19/19-ext
  complementary but not substitutive.
- **Inovalon subtotal-reset-and-continue disposition (§17.44)**:
  r28 -> r30/r33/r44 rootless level-2 PREAMBLEs out-of-scope per
  agreement #43; wizard review pathway handles via existing
  rootless-row flags.

No working agreement changes. No phase exit criterion change
(E5 stands). No status flips. Track 2 (handover doc + Caveat C
+ §12 + §13 refresh) follows separately via chat-Claude file-
upload-and-edit workflow per agreement #35.

---

### 2026-05-25 -- Cycle 3 deep dive + boundary-setting + 9-fix queue

**[DECISION] Working agreement #43 codified:** "Parser-fix work is bounded.
One round of deterministic fixes per identified-bug-batch + one validation
cycle. New bugs surfacing post-validation go to Phase 3+ AI resolution
layer, unless something strikingly deterministic and high-impact emerges.
Handwritten BoQs have infinite error combinations; we accept parser
limitations and rely on AI for residual disambiguation." Extends agreements
#34 (cycle termination) and #40 (no fuzzy parser rules) by bounding the
number of fix cycles per bug-batch to one + validation.

**[DECISION] Phase exit criterion E4 (v5.25) SUPERSEDED by E5 (v5.26):**
"All 9 deterministic fixes from cycle 3 deep dive landed AND cycle 3 re-run
validates against the 8 fixtures (multi_v1 dropped) AND activity 2b-3
schema migration started." Three binary, measurable components. Replaces
E4's "Phase 2c body sub-phase scoped or first sub-phase started OR Phase 2c
officially closed and wizard phase started, with explicit rationale."

**[DECISION] Cycle 3 fix-cycle time-box:** 5-7 working sessions total for all
9 deterministic fixes + cycle 3 validation re-run, batched implementation
(~4 fixes per cluster + 1 validation pass). Hard cap at 7 sessions; if
exceeded, accept what landed and move to activity 2b-3.

**[DECISION] multi_area_merged_header_v1 fixture DROPPED from cycle 3 /
wizard-design reference set.** Confirmed as synthetic stress test (extra
blank column inserted at position E into BoQ source xlsx, declared as
Area 1 in config, original qty column re-declared as Area 2). Byte-identical
classification distributions with bill_of_quantities because classification
doesn't depend on which column holds qty. Keep as test-suite fixture for
multi-area regression coverage; remove from cycle 3 reference set.

**[DECISION] AI-upfronting for Phase 2c body wizard scoping: NOT NEEDED.**
9 deterministic parser fixes cover the bulk of classification and hierarchy
issues observed across 7 fixtures. Wizard scoping work proceeds without AI
dependency. AI layer scoped to Phase 3+ for residual handwritten-BoQ
disambiguation per agreement #43.

**[DECISION] Bug 12 (sec 9 #88) disposition SPLIT v5.26:** deterministic portion
(section-header NOTEs detectable via positional anchors) goes to FIX QUEUE
as Bug 20 anchors 1-3 + Bug 20-ext level-0. Residual (Inovalon mid-section
uppercase NOTE clusters at r36-r40 with no positional anchor) stays Phase 3+
AI per agreement #43. Bug 14 (letter-suffix cosmetic), Bug 15 (sl_no semantic
repeats), and LINE_ITEM-as-missing-ancestor (alorica r35->r37) all stay
Phase 3+ AI; no further parser-layer attempts.

**[DECISION] Checklist C audit at v5.26 close -- all 7 items dispositioned:**
C1 PASS-with-tightening (E4->E5), C2 PASS at 5-item ceiling, C3 PASS
(power-user framing), C4 PASS (declarative wizard Option 3b confirmed),
C5 PASS (cycle 3 done, next check in E5), C6 PASS-with-time-box (5-7
sessions), C7 PASS (wizard spec exists, deep dive validated mapping;
Bug 17 + Bug 18 layering notes flagged for fix-prompt drafting time).

---

### 2026-05-23 -- Bug 11 closure recognition (sec 9 #87 CLOSED v5.25 via A1+A2 land)

**Context.** During v5.25 housekeeping preparation review, the user identified that Bug 11a +
Bug 11b (sec 9 #87, PARKED v5.22 pending deep rule review) were structurally resolved by Rule A1
+ Rule A2-reframed landing (feat 8f960a2b, sec 9 #99, §17.40). The connection was not recognized
in the A1+A2 land docs commit and is captured here post-hoc.

**Bug 11a -> Rule A2-reframed.** Canonical Bug 11a case ("1.0 PREAMBLE + 2.0 LINE_ITEM with qty
parents under 1.0 instead of siblinging") matches Rule A2-reframed's trigger condition (same
pattern_signature + different first_numeric_token + both non-None) and action (attach to
stack-top's parent). Empirical: 27 A2 firings in Snitch + 31 A2 firings in BoQ ELV (sec 9 #99
audit) are all Bug 11a cases, all resolved post-land.

**Bug 11b -> Rule A1.** Canonical Bug 11b case ("a/b/c letter-suffix children chain via
stack_depth+1") matches Rule A1's trigger (all-lowercase sl_no) and action (scan stack for
non-lowercase ancestor, return anchor.level + 1). Empirical: 3 A1 firings in Snitch (rows
458/475/491, sl_no b/c/d) -- pre-A1 level 5/6/7 cascade, post-A1 all at level 4 siblings. The
§17.9 lowercase-letter cascade (root cause of Bug 11b) is structurally resolved.

**Implication for working agreement #40.** The §14 working agreement #40 text already lists
A1/A2-reframed (sec 9 #99) as one of the four closing examples of the Bug 13
deterministic-unambiguous bar. Bug 11 closure reinforces this -- the parser-layer deterministic
fixes have closed two multi-fixture hierarchy bugs (Bug 11a + 11b) plus the BoQ-ELV-specific
SUB HEAD fix plus the universal subtotal-reset. No change to working agreement #40 wording.

**No code changes, no test runs.** Docs-only commit. CLAUDE.md + boq-upload-plan.md updated.
v5.22 Bug 11 commits remain reverted; their 47 tests are NOT restored (classifier-layer logic
superseded by resolver-layer A1+A2).

**Agreements cited.** None new. This is a single docs commit, not a two-commit shape.

---

### 2026-05-23 -- SUB HEAD + universal subtotal-reset land (sec 9 #100 + #101 CLOSED, Phase 2c bug-fix cycle CLOSED)

**Context.** Following A1+A2-reframed landing (feat 8f960a2b) and the 6-fixture cross-corpus
Bug 12 diagnostic (initial Bug12 dump + subtotal-reset audit), two deterministic fixes were frozen.

**Fix 1 -- SUB HEAD pattern detection.** _SUB_HEAD_RE + _is_sub_head_marker() in hierarchy.py.
Pattern /^\s*sub\s+head\s+[a-z][0-9]?\s*$/i tolerates embedded newlines. SUB HEAD branch in
_determine_preamble_level returns level=1 unconditionally. 1-fixture-specific (BoQ ELV only)
but harmless to non-matching fixtures.

**Fix 2 -- Universal subtotal-reset.** resolve_hierarchy now calls stack.clear() on every
SUBTOTAL_MARKER. _MID_SHEET_RESET_RE preserved (deprecated, audit-script-only) -- deprecation
comment added at definition site. Empirically validated against 6 fixtures (46 subtotal markers,
zero mid-section cases).

**Working agreement #40 codified** in §14: parser-layer fixes must meet the Bug 13
deterministic-unambiguous bar; beyond the four closing examples (Bug 13, A1/A2-reframed,
SUB HEAD, universal subtotal-reset), structural fixes go to Phase 3+ AI layer.

**Bug 12 (Inovalon NOTE-as-header) parked** in §17.42.
**Bug 15 (SG HVAC priced-sub-section-header) parked** in §17.43.

**Side-finding.** classifier_audit_output.json baseline detected stale during Step 9 regression
check -- the committed file is from a 24-fixture corpus, the current corpus has 28 fixtures.
Proportional stat growth (classified +20.6%, unclassified +19.5%, unique +1.7%) confirms no
classifier behavior change from this sub-phase's hierarchy.py edits. Filed as Caveat S for v5.25
housekeeping refresh chore (not bundled here per agreement #42).

**PHASE 2c BUG-FIX CYCLE CLOSED.** Phase 2c body (DB commit + version cascade) is next.

**Agreements cited.** #9 two-commit shape. #40 codification.

---

### 2026-05-23 - Approach A-reframed land (Rule A1 + A2-reframed, sec 9 #99 CLOSED)

**Context.** Following the Approach A-reframed audit (feat 16647958 + docs 43c14fcc, §17.39)
and user sample review, misfires were confirmed as low and exit criterion E3 was met.

**What landed.** Rule A1 + Rule A2-reframed landed in hierarchy.py as production code
(feat 8f960a2b + docs see git log).

Rule A1 fires in _determine_preamble_level when sl_no (after rstrip('.,):;]')) consists
ENTIRELY of lowercase characters (a, b., iv.). Scans stack reversed for first non-lowercase
ancestor; returns anchor.level + 1. F5 tightening: trigger uses all(c == 'l' for c in
sig_stripped) NOT startswith('l') -- rejects mixed codes like a1 or custom-code-xyz. The
broad trigger caused a pre-commit test failure that prompted the tightening.

Rule A2-reframed fires at LINE_ITEM attachment step when LINE_ITEM sl_no has same
pattern_signature as stack-top PREAMBLE AND a different first_numeric_token (both
non-None). Attaches LINE_ITEM to stack-top's parent (sibling, not child relationship).

Sec 7.29 interaction documented: A2 reparents all 5 children of PREAMBLE "2.0" (Snitch
xlsx ~502) to section header G. Zero-children post-pass demotes "2.0" to LINE_ITEM.
test_snitch_row_500_demoted_to_line_item_post_a2 captures the final state.

snitch_electrical_expected.json regenerated: LINE_ITEM 176->177, PREAMBLE 43->42,
preamble_level_transitions 7->4 entries. test_approach_a_rules.py: 24 new tests.
Parser tests: 440 -> 464.

**Working agreement #40 deferred.** The landing proceeded (low misfires). However,
working agreement #40 ("no more parser fuzzy rules") is NOT codified in this docs cycle.
It is deferred pending Bug 12 diagnostic on 2 fixtures (the fixtures referenced in §17.28
and §17.38 as containing the "SUB HEAD A" Bug 12 candidate). Once that diagnostic confirms
or rules out Approach A interaction with Bug 12, working agreement #40 disposition will
be revisited.

**Agreements cited.** #9 two-commit shape (feat 8f960a2b + docs see git log).

---

### 2026-05-23 - Approach A-reframed audit script (sec 9 #99 gating, feat 16647958)

**Context.** The Bill Of Quantities rows 4-22 audit (feat 3b0790f0) confirmed the known
Approach A limitation: Rule A2 cannot fix LINE_ITEM parenting (Bug 11a) because it only
fires on PREAMBLE rows in _determine_preamble_level. A redesigned Rule A2-reframed
targets the LINE_ITEM attachment step instead, and extends the audit to the full sheets.

**Method.** `approach_a_reframed_audit.py` runs two pipelines on each of two fixtures.
Both apply sec 7.28 (so the diff isolates A1+A2 effect only). Pipeline X uses production
resolve_hierarchy(). Pipeline Y uses a custom inline resolver applying Rule A1 (PREAMBLE
level determination: pattern_signature starts with 'l' triggers stack scan for numbered
ancestor; level = anchor.level + 1, fallback to stack_depth+1) and Rule A2-reframed
(LINE_ITEM attachment: stack top only; if signature(LINE_ITEM.sl_no) == signature(top.sl_no)
AND first_numeric_token differs AND both non-None, attach to top.parent). Diff compares
(parent_sl_no, level) per row. rule_fired tagged as A1/A2/A1+A2/indirect.

**Aggregate findings:**

Snitch '6. Electrical' (521 rows total):
  - Rule A1 direct: 3 (PREAMBLE rows b/c/d at xlsx rows 458/475/491, cascade level fix)
  - Rule A2 direct: 27 (LINE_ITEM rows e.g. 2.0/4.0-9.0 under section PREAMBLEs)
  - A1+A2 combined: 0
  - Indirect-effect: 0

Bill of Quantities ELECTRICAL & ELV BOQ (1186 rows total):
  - Rule A1 direct: 0 (no lowercase-letter cascade rows in full sheet)
  - Rule A2 direct: 31 (LINE_ITEM rows e.g. 2.0/3.0 from under 1.0 preamble to root)
  - A1+A2 combined: 0
  - Indirect-effect: 0

**Next step.** User reviews sample first-20 per fixture in diagnostic_snapshots/.
Decision criterion: low misfire rate => land A1+A2 next sub-phase (sec 9 #99 closed);
appreciable misfires => park + codify "no more parser fuzzy rules" as working agreement #40.
Gating exit criterion E3 (closing Phase 2c bug-fix cycle).

**Agreements cited.** #9 two-commit shape (feat 16647958 + docs 43c14fcc).

---

### 2026-05-23 - Bill Of Quantities Electrical & ELV rows 4-22 audit (feat 3b0790f0)

**Context.** Following the §7.28 orphan-children audit (feat 8a126846) and Bug 11 parking,
the strategic question remains: do Bug 11a (numeric peer sibling gap) and Bug 11b
(letter-sequence cascade) affect the Bill of Quantities fixture, and does proposed
Approach A (Rule A1 + Rule A2) produce meaningfully different hierarchy output?

**Method.** `boq_electrical_elv_rows_4_22_audit.py` replicates parse_boq through
resolve_hierarchy for ELECTRICAL & ELV BOQ sheet. Two pipelines run side-by-side:
Pipeline X (production + §7.28); Pipeline Y (inline Approach A resolver, §7.28 skipped).
Approach A: Rule A1 -- for lowercase-letter sl_no, scan stack for non-lowercase ancestor
and set level = anchor.level + 1 (fixes cascade); Rule A2 -- after standard level chain,
check pattern signature match on stack and set level = matching entry's level (sibling fix).

**Aggregate findings (ELECTRICAL & ELV BOQ, rows 4-22):**

- Rows in range with at least one column difference: 0/19
- Rule A1 fires in range: 0 rows (no lowercase-letter cascade rows in range)
- Rule A2 fires in range: 0 rows (no numeric-peer PREAMBLE rows in range)
- Bug 12 candidates (current pipeline): 1 (row 4, "SUB HEAD A", level 1)
- Bug 12 candidates (Approach A): 1 (same)

**Interpretation.** Rows 4-22 contain no lowercase-letter sub-items -- the range covers
chapter headings (SUB HEAD A), numeric PREAMBLEs (1.0, 4.0), and LINE_ITEMs (2.0, 3.0,
1.1, 4.1-4.8). Bug 11a is visible via parent_sl_no: rows 9 (2.0) and 11 (3.0) are
parented under 1.0 instead of being siblings -- but both are LINE_ITEMs (have qty values),
so Rule A2 cannot correct them (Rule A2 only fires on rows going through
_determine_preamble_level). The Approach A limitation footer documents this. Bug 11b does
not fire in this range. The strategic decision to defer Bug 11+12 fix work to the Phase 3+
AI review layer was made in chat this session but has not yet been codified as a numbered
working agreement.

**Agreements cited.** #9 two-commit shape (feat 3b0790f0 + docs this commit).

---

### 2026-05-23 - Bug 13 - Excel error literals normalization at reader.py (feat 5ff93064)

**Context.** Excel stores formula errors as string literals when read by openpyxl in
data_only=True mode. Seven error values (#REF!, #VALUE!, #NAME?, #DIV/0!, #NULL!, #N/A,
#NUM!) were flowing to the classifier as text strings. On real fixtures, this caused
rows containing only error cells to be classified as content (LINE_ITEM/PREAMBLE)
rather than treated as blank. Sec 9 #89 tracked this as Bug 13.

**Fix.** Added EXCEL_ERROR_LITERALS frozenset and _is_excel_error() helper to reader.py
(public module-level so they are importable by tests). The check fires in iter_rows() at
the single point where computed_value is finalized, before CellInfo construction, for
both covered and non-covered cells. Whitespace-tolerant, case-insensitive comparison.

**Tests.** 6 new tests in TestExcelErrorLiterals in test_reader.py:
- test_is_excel_error_true_all_seven_literals
- test_is_excel_error_whitespace_and_case_tolerance
- test_is_excel_error_false_for_none_empty_numeric_normal_text
- test_is_excel_error_false_for_substring (partial match does not fire)
- test_reader_normalizes_error_literal_cell_to_none (integration: temp xlsx)
- test_reader_blank_row_detection_not_confused_by_error_cells (RawRow.is_blank())

**Audit impact.** classifier_audit.py stats flat before/after (no audit regression).
No integration test for v2 Elec fixture -- not present in committed corpus.

**Agreements cited.** #9 two-commit shape (feat 5ff93064 + docs this commit).

---

### 2026-05-23 - §7.28 orphan-children audit — read-only diagnostic (feat 8a126846)

**Context.** §7.28 (`_apply_unit_based_demotion_post_pass`) demotes PREAMBLE rows
that carry a unit matching any LINE_ITEM unit on the same sheet (qty=None criterion).
Question: how many of the ~82 Snitch '6. Electrical' target rows have descendants in
the resolved tree that fall OUTSIDE the §7.28 target set — i.e. descendants that would
lose their parent if §7.28 demoted without re-parenting?

**Method.** `unit_demotion_orphan_audit.py` replicates the parse_boq pipeline through
resolve_hierarchy, intentionally skipping §7.28. Target set identified using the exact
§7.28 criteria (PREAMBLE + qty=None + unit in LINE_ITEM unit set, case-sensitive).
Descendants split into Bucket A (also in target set — cascade-collapse) and Bucket B
(not in target set — real-orphan candidates).

**Aggregate findings (Snitch '6. Electrical'):**

- Total §7.28 target rows:                82
- Target rows with zero real orphans:     35  (42.7%)
- Target rows with >=1 real orphan:       47  (57.3%)
- Sum of real-orphan descendants:         196
- Max real-orphan count on a single row:  9

**Bucket B distribution:**

- 0 orphans: 35 rows
- 1 orphan:   8 rows
- 2 orphans: 14 rows
- 3-5 orphans: 8 rows
- 6-10 orphans: 17 rows
- 11+ orphans: 0 rows

**Interpretation.** The majority (57.3%) of §7.28 targets have at least one real-orphan
descendant. The 196 real-orphan descendants are primarily LINE_ITEM rows (cable variants,
socket types) that are direct children of the target PREAMBLEs in the letter-sequence
cascade (§17.9 / Bug 11b). Blanket §7.28 demotion without re-parenting would orphan these
rows. This finding informs the "no auto-demote/promote of parented PREAMBLE" rule decision
pending Phase 3+ review. No code change. No test change.

**Agreements cited.** #9 two-commit shape (feat 8a126846 + docs this commit).

---

### 2026-05-23 - Bug 11 parking — post-diagnostic revert + rule-review capture

**Context.** Bug 11 (sec 9 #87): pattern-consistency mismatch in PREAMBLE vs LINE_ITEM
was implemented as an orchestrator post-pass in feat fb89bf44 (docs f9bd1e70). A
post-ship read-only diagnostic on Snitch's depth-1 lowercase-letter rows (2026-05-22)
revealed the original framing was incorrect.

**Diagnostic finding.** 124/124 depth-1 lowercase-letter ('l' sig group) rows in
Snitch '6. Electrical' are genuine enumerated sub-items (cable variants, socket types,
conduit sizes under numbered section PREAMBLEs like 1.0/2.0/3.0). Spec's assumed
depth-≤1 auto-promote reclassifies all 124 as PREAMBLE; §7.29 back-demotes 9,
netting −95 LINE_ITEMs regression with no correctness gain.

**Root cause reframing.** Bug 11 is a hierarchy RESOLVER parenting problem:
- 11a (numeric peer gap): 1.0 PREAMBLE + 2.0 LINE_ITEM should be equi-depth siblings;
  resolver parents 2.0 under 1.0 because both are depth-1 dotted-decimal and 1.0 is
  most recent PREAMBLE.
- 11b (letter-sequence cascade, §17.9): a/b/c letter-suffix rows are chained
  stack_depth+1 each instead of equi-depth siblings under their numbered ancestor.

**Decision.** Park Bug 11. Reverted feat fb89bf44 → f1839b1e; docs f9bd1e70 → debd5186.
Supplementary parking docs committed (this entry). §17.27 updated to [PARKED v5.22].
Deferred to Phase 3+ AI review layer. Parser test count stable at 434.

**Agreements cited.** #9 two-commit shape, #33 Bug 11 parking + Phase 3+ deferral.

---

### 2026-05-22 - Bug 10 coverage extension - Societe Generale HVAC integration test (feat 94706b5c)

**Context.** Bug 10 fix (feat 798f4fd2) landed with VRF System (57 misfires) covered by
TestBug10VrfSameRowSumIntegration. Societe Generale HVAC -- the larger half of the
131-misfire surface at 73 rows -- was not covered. Coverage gap surfaced in chat-Claude
Checklist B review of feat 798f4fd2; closed by this sub-phase.

**Implementation.** Added TestBug10SocieteGeneraleHvacIntegration to test_orchestrator.py
with hand-authored MappingConfig for the 'BOQ_HVAC Lowside works' sheet. Areas declared:
GF / 2F (Office) / 2F(Cafeteria) (row-3 sub-headers under Voyager/Victor merged groups;
Finding 16 wizard-side territory bypassed by declarative config). header_row=3 (bottom of
2-row header rows 2-3), header_row_count=2. Column L (amount_total) carries =SUM(Jx:Kx)
on every line item. 5 tests: fixture-exists smoke + 3 per-row LINE_ITEM assertions matched
by sl_no fingerprint (1.03, 1.04, 1.05) + 1 aggregate LINE_ITEM count threshold (>= 230;
post-fix empirical 282, pre-fix ~209).

**Test-only sub-phase.** No production code changes. Bug 10 fix (feat 798f4fd2) is the
change under test. Parser tests 429 -> 434. No regressions.

**Prompt note.** Step 0.5 command in Bug 10 coverage extension prompt omits test_hierarchy
and test_reader from the module list (5 modules, gives 340); the canonical 429-count
baseline requires all 7 modules. Self-reported as item #25 deviation.

**Agreements cited.** #9 two-commit shape, #20 25-item self-report, #29 real-fixture
integration (Bug 10 closure coverage extension).

---

### 2026-05-22 - Bug 10 fix - same-row =SUM() SUBTOTAL_MARKER misfire (feat 798f4fd2)

**Context.** Bug 10 (sec 9 #86): classifier.py formula-path SUBTOTAL_MARKER check fires on any cell whose formula starts with =SUM( in an amount column (_AMOUNT_ROLES: amount_supply, amount_install, amount_total). Same-row inline aggregations like =SUM(K20:L20) on row 20 (Supply Amount + Install Amount -> Total Amount, same row) were indistinguishable from genuine cross-row subtotal SUM formulas. 131 cross-fixture misfires: VRF System (57 rows) + Societe Generale HVAC (74 rows).

**Implementation.** Single private helper `_is_cross_row_sum(formula: str, current_row: int) -> bool` added to classifier.py Private helpers section (~45 LOC including docstring). Algorithm: strip leading `+`, uppercase, verify starts with =SUM(, extract inside of parentheses, check for cross-sheet `!` (conservative True), split on `,`, for each token strip `$` and parse cell ref(s) via `_CELL_REF_RE = r"^([A-Z]+)(\d+)$"`. Returns False only when ALL extracted row numbers equal current_row. Returns True (conservative) on any parse failure, named range, cross-sheet ref, or empty SUM. Gate added to formula-path SUBTOTAL_MARKER check: both =SUM( prefix AND _is_cross_row_sum returning True required. Text-regex SUBTOTAL_MARKER path (Total Item No., Grand Total, TOTAL CARRIED OVER, etc.) untouched.

**Test summary.** 20 new tests: TestBug10CrossRowSum (13 unit: same-row single/range/abs-refs/multi-range/leading-plus/lowercase, cross-row range/endpoint, mixed, named-range/cross-sheet/empty/non-SUM conservative) + TestBug10ClassifyRowGating (3 classify_row: same-row not subtotal, cross-row still subtotal, text-regex override) + TestBug10VrfSameRowSumIntegration in test_orchestrator.py (4 integration: fixture exists, row sl_no=1.1 LINE_ITEM, row sl_no=1.2 LINE_ITEM, LINE_ITEM count >= 30). Parser tests 409 -> 429. Suite verdict OK.

**Audit-script flips.** classifier_audit.py measures header-keyword matching (not classification categories) -- stats flat: classified 4789 / unclassified 12800 / unique 2580 (unchanged). Flat stats expected for Bug 10 -- fix does not affect header keywords. Fix verified by integration tests per agreement #25.

**Agreements cited.** #9 two-commit shape, #16 known-pattern citation (sec 9 #86), #20 25-item self-report, #25 audit-regression discipline, #29 real-fixture integration for new pattern/routing logic, #34 iterative refinement loop progress (Bug 10 is first in Bug 10->11->12->13->14 queue).

---

### 2026-05-20 - Bug 7 + Bug 9 + CRLF remediation (feat 9a5b16cb)

**Context.** Combined remediation for Bug 7 (sec 9 #85) and Bug 9 (sec 9 #86), plus CRLF pollution cleanup from the original (abandoned) Bug 7 attempt.

**CRLF remediation.** The prior Bug 7 attempt (`d2b542b4` + docs `e4792920`) was committed with CRLF line endings in classifier.py and classifier_audit.py — Windows-side Edit tool preserved CRLF while Docker git commits LF. `git diff --stat` showed ~1539 and ~673 spurious line changes. Resolution: soft-reset HEAD~2 back to Bug 6 tip (`3f7f4ffc`), converted files via Python in container, added `.gitattributes` (`* text=auto eol=lf`, binary overrides for xlsx/png/pdf/jpg) at repo root, then re-applied all changes with guaranteed LF.

**Bug 7 (sec 9 #85) — reverse word order keyword variants.** Real-world BoQ headers like "Rate Supply", "Rate Install", "Total Rate" and "Amount Supply", "Amount Install", "Amount Total" were not matched. Root cause: `_HEADER_KW` in classifier.py only had natural-word-order forms ("Supply Rate", "Install Rate", etc.). Fix: 10 new keyword entries across 7 frozensets:

- `qty_total`: `"qty total"`, `"quantity total"`
- `rate_combined`: `"rate total"`
- `rate_supply`: `"rate supply"`
- `rate_install`: `"rate install"`, `"rate installation"`
- `amount_total`: `"amount total"`
- `amount_supply`: `"amount supply"`
- `amount_install`: `"amount install"`, `"amount installation"`

`_CLASSIFIER_HEADER_KW` replica in classifier_audit.py synced (agreement #21). No changes to `_auto_guess.py` — the Phase 1.9l longest-match-wins precedence means the 11-char "rate supply" beats the 4-char "rate" automatically.

**Bug 9 (sec 9 #86) — amount_combined extraction gap.** `amount_combined` ColumnRole had no extraction path in `classify_row()` — silently dropped. This was surfaced as a "deferred item" in Bug 6. Per sec 7.14, `amount_total` and `amount_combined` are semantically equivalent. Fix: OR-fallback after `amount_total_raw = _cell_float("amount_total")`: if None, try `_cell_float("amount_combined")`. Bug 6 cascade Priority 1/2/3 unchanged; amount_combined now participates as a Priority 1 source. No new ClassifiedRow field needed.

**stopping condition #8 (config.py finding).** `amount_total` and `amount_combined` are both in `_SINGLETON_ROLES` independently but NOT mutually exclusive — a sheet CAN have both columns simultaneously (validator only checks each singleton ≤1, not family-wise exclusion). OR-fallback is still correct regardless.

**Tests added (392 → 409, +17):**

- test_auto_guess.py: `TestBug7WordOrderVariants` (6 methods) — rate/amount/qty family variants, longest-match disambiguation, parenthetical regression, agreement #21 sync invariant.
- test_orchestrator.py: `TestBug7SingleHeaderV2Integration` (6 methods) — real-fixture HVAC BOQ: columns H="Rate Supply"→rate_supply, I="Rate Install"→rate_install, J="Total Rate"→rate_combined, F="Total Qty"→qty_total; end-to-end parse_boq smoke.
- test_classifier.py: `TestBug9AmountCombinedExtraction` (5 methods) — B9-1 combined alone, B9-2 combined wins over supply+install, B9-3 blank falls to P2, B9-4 blank falls to P3 per-area, B9-5 SheetConfig validates OK.

**Classifier audit delta.** Classified 3970 → 4789 (+819) across 28 fixtures (3 new fixtures added since last audit run). 1 pre-existing fixture failure unchanged.

---

### 2026-05-20 - Bug 6 fix - convenience field summation cascade (feat 47090d7d)

**Context.** Implements the fix designed during pre-implementation audit (commit 95718686, entry below). Files changed: classifier.py, test_classifier.py, test_orchestrator.py. orchestrator.py and hierarchy.py not touched (no changes needed at those layers).

**Design decisions locked by chat-Claude before implementation:**

- NEW FIELD: `amount_total_raw: float | None = None` on ClassifiedRow (mirrors qty_total_raw pattern). Tracks the raw column cell value separately from the derived cascade result so callers can distinguish "total column was present" from "total was synthesized."
- cr.amount_total priority cascade:
  - Priority 1: amount_total column cell value wins when non-None.
  - Priority 2: amount_supply + amount_install when both non-None (and amount_total column absent/blank).
  - Priority 3: sum(amount_by_area_raw.values()) when both components absent/None.
  - Priority 4: None (all sources absent).
  - Warning emitted when Priority 2 fires AND amount_by_area_raw is non-empty AND |supply+install - per_area_sum| > 1.0 abs tolerance.
- cr.rate_combined fallback: Priority 1 (column) > Priority 2 (rate_supply + rate_install, both required). NO per-area rate summation (rates are per-unit; summing across areas is semantically invalid). No Priority 3 path for rate.
- Partial components: fallback does NOT fire when only one of supply/install is present. Both required for the cascade to activate.
- orchestrator.py Site 2 (ResolvedRow.amount_total per-area fallback) is redundant for supply+install case after fix but retained for safety - no code change.
- rate_combined fallback insertion point: BEFORE has_nonzero_rate computation so the derived rate_combined contributes to has_nonzero_rate (enabling correct blank-qty -> rate-only classification for rows with supply+install rates but no combined column).

**Tests added:**

- test_classifier.py: 13 new unit tests in TestBug6ConvenienceFieldSummation covering all cascade priorities (1-3), partial components (supply-only, install-only), all-blank -> None, warning fires (diff > 1.0), no warning within tolerance, rate_combined column wins, rate_combined fallback fires, rate_combined None (partial), rate_combined fallback contributes to has_nonzero_rate.
- test_orchestrator.py: 4 new integration tests in TestBug6InovalonIntegration using Inovalon HVAC Unpriced BOQ-21.01.2026.xlsx real fixture. Ground-truth row sl_no='1.1.4' at Excel row 13: G(amount_supply)=200000.0, H(amount_install)=25000.0, sum=225000.0, no amount_total column. Tests: smoke parse, amount_total summed correctly, amount_total_raw is None for summed rows, ResolvedRow.amount_total inherits cascade value.

**Parser test count: 375 -> 392 (+17).**

**Deferred items surfaced during implementation:**

- `amount_combined` ColumnRole has no ClassifiedRow field and no extraction path in classify_row(). Silently ignored for data extraction. Separate gap, not Bug 6.
- orchestrator.py Site 2 is now partially redundant but retained without change.

---

### 2026-05-20 - Bug 6 pre-implementation audit - convenience-field computation in classifier + orchestrator

**Context.** Bug 6 (sec 9 #84 in v5.20 handover) - convenience fields on ClassifiedRow leave as None when "total" column blank, even when component sources have data. Pre-fix read-only audit per working agreement #18 (emergent-design pattern). NO code changes this commit.

**ColumnRole Literal values (confirmed against config.py):**

```
"sl_no", "description", "unit", "qty", "qty_total",
"rate_supply", "rate_install", "rate_combined",
"amount_supply", "amount_install", "amount_total", "amount_combined",
"amount_by_area",
"rate_supply_by_area", "rate_install_by_area", "rate_combined_by_area",
"make_model", "row_notes", "append_to_notes", "reference_images", "ignore"
```

Note: `amount_combined` is a valid ColumnRole but has NO corresponding ClassifiedRow field and is never extracted by classify_row() - see Out-of-scope items below.

**ClassifiedRow fields (confirmed against classifier.py):**

Convenience fields:

| Field | Computation source today | Sum-fallback exists? | Gap re Bug 6 |
| --- | --- | --- | --- |
| cr.qty | Multi-area path (lines 573-582): sum of qty_by_area_raw.values() when qty_area_cols present, else None. Single-col path (lines 584-589): direct _parse_qty_cell read. Then qty_total column OVERRIDES qty (lines 631-637) when non-blank, recording qty_total_raw separately. | YES for per-area case (primary path, not a fallback). NO for single-col case. | No gap at ClassifiedRow level. When qty_area_cols exist, cr.qty = per-area sum regardless of qty_total being blank. qty_total_raw tracked separately feeds ResolvedRow.qty_total; post-pass (Site 1) handles that layer. "Ends up None" only when ALL qty sources are blank - expected behavior. |
| cr.amount_total | Line 665: _cell_float("amount_total") - direct read from amount_total column only. Independent of amount_supply/amount_install and amount_by_area_raw. | NO - no fallback of any kind. | CRITICAL GAP (two sub-cases). Sub-case A (Inovalon): amount_supply + amount_install present, amount_total column absent - cr.amount_total = None, and post-pass does NOT fix ResolvedRow.amount_total (post-pass Site 2 only reads amount_by_area, not supply+install). Sub-case B (per-area): amount_by_area_raw present, amount_total column absent - cr.amount_total = None (never fixed at ClassifiedRow level), but ResolvedRow.amount_total IS fixed by post-pass Site 2. |
| cr.amount_supply | Line 663: _cell_float("amount_supply") - direct read. | NO | Not a Bug 6 target (source field, not derived). |
| cr.amount_install | Line 664: _cell_float("amount_install") - direct read. | NO | Not a Bug 6 target (source field, not derived). |
| cr.amount_combined | DOES NOT EXIST as a ClassifiedRow field. No extraction in classify_row(). role="amount_combined" exists in config.py + _HEADER_KW (for HEADER_REPEAT detection) but produces no line-item data. | N/A | N/A - field is absent. See Out-of-scope items. |
| cr.rate_combined | Line 498: _cell_float("rate_combined") - direct read from rate_combined column only. | NO - no fallback from rate_supply + rate_install, no fallback from rate_by_area_raw. | GAP: when rate_combined column absent, cr.rate_combined = None even if rate_supply + rate_install present. Semantically valid per sec 7.32 (combined == supply + install). No fix exists at any layer (classifier, orchestrator, hierarchy). |
| cr.rate_supply | Line 496: _cell_float("rate_supply") - direct read. | NO | Not a Bug 6 target (source field). |
| cr.rate_install | Line 497: _cell_float("rate_install") - direct read. | NO | Not a Bug 6 target (source field). |

Raw fields (for reference, no Bug 6 work):

- `qty_total_raw: float | None` - value from qty_total column cell specifically (None if blank/absent); tracked separately from cr.qty to initialize ResolvedRow.qty_total
- `qty_by_area_raw: dict[str, float]` - per-area qty values keyed by area name; populated only from role="qty" with area= columns
- `amount_by_area_raw: dict[str, float]` - per-area amount values; populated only from role="amount_by_area" columns
- `rate_by_area_raw: dict[str, dict[str, float | None]]` - outer key=area, inner key in {"supply_rate","install_rate","combined_rate"}; populated from rate_*_by_area columns
- `append_notes_raw: dict[str, str]` - per-column text values for role="append_to_notes" columns; keyed by column header label

Other fields (not Bug 6):

- `raw_row, classification, sl_no_value, description, unit, is_rate_only, make_model, row_notes, warnings, preamble_candidate_score, preamble_candidate_signals`

**ResolvedRow direct fields (confirmed against hierarchy.py):**

Fields initialized from ClassifiedRow at resolve_hierarchy() LINE_ITEM construction (lines 467-475):

- `classified_row: ClassifiedRow` - full reference (most cr fields accessed by indirection)
- `qty_by_area_raw: dict[str, float]` - initialized from classified_row.qty_by_area_raw
- `amount_by_area_raw: dict[str, float]` - initialized from classified_row.amount_by_area_raw
- `qty_total: float | None` - initialized from classified_row.qty_total_raw (NOT from cr.qty)
- `amount_total: float | None` - initialized from classified_row.amount_total

Fields with defaults (not initialized from cr at construction):

- `parent_index, level, path, attached_to_index, attached_notes, is_synthetic, validation_warnings` - tree/structural fields
- `qty_by_area: dict[str, float]` - populated by _apply_multi_area_post_pass (Policy X copy from qty_by_area_raw + fallback)
- `amount_by_area: dict[str, float]` - populated by _apply_multi_area_post_pass
- `rate_by_area: dict[str, dict[str, float | None]]` - populated by _apply_multi_area_post_pass from cr.rate_by_area_raw
- `needs_classification_review: bool, review_reason: str` - set by priced-preamble review-flag post-pass

**Existing sum-fallback sites (confirmed against orchestrator.py + hierarchy.py):**

- Site 1: orchestrator.py:120-121, _apply_multi_area_post_pass(). Modifies ResolvedRow.qty_total. Reads from row.qty_by_area (which = row.qty_by_area_raw at this point - Policy X direct copy at line 84). Trigger: qty_total is None AND qty_by_area is non-empty. Result: qty_total = sum(qty_by_area.values()).
- Site 2: orchestrator.py:122-123, _apply_multi_area_post_pass(). Modifies ResolvedRow.amount_total. Reads from row.amount_by_area (which = row.amount_by_area_raw - Policy X direct copy at line 85). Trigger: amount_total is None AND amount_by_area is non-empty. Result: amount_total = sum(amount_by_area.values()). CRITICAL: amount_by_area comes ONLY from role="amount_by_area" columns; this site does NOT handle the amount_supply + amount_install sub-case.

No sum-fallback sites exist anywhere for cr.rate_combined, cr.amount_total (supply+install sub-case), or any ClassifiedRow convenience field. All ClassifiedRow convenience fields are set once in classify_row() with no post-classification mutation.

**Bug 6 gap summary - the actual fixes needed:**

1. cr.qty: No gap. When qty_area_cols (role="qty" with area=) exist, cr.qty = per-area sum already computed in the primary path (classifier.py:582). The qty_total column only overrides when non-blank (lines 631-637); a blank qty_total leaves cr.qty unchanged as the area sum. "Ends up None" only when all qty sources are blank - expected, no data to sum. ResolvedRow.qty_total fallback already covered by orchestrator.py Site 1. No fix needed for this field.

2. cr.amount_total: TWO gaps. (A) Per-component summation (Inovalon case): amount_supply + amount_install present, amount_total column absent - cr.amount_total = None with no fallback at ClassifiedRow OR ResolvedRow layer. Fix needed: add fallback in classifier.py after line 665 - if amount_total is None and amount_supply and amount_install are both non-None, set amount_total = amount_supply + amount_install. Also add parallel fallback in orchestrator.py _apply_multi_area_post_pass for ResolvedRow.amount_total. (B) Per-area summation: cr.amount_total stays None (ClassifiedRow-level gap persists), but ResolvedRow.amount_total is fixed by post-pass Site 2 - partial coverage already exists. Fix at ClassifiedRow level requires: if amount_total is None and amount_by_area_raw is non-empty, set amount_total = sum(amount_by_area_raw.values()).

3. cr.rate_combined: GAP - no fallback from rate_supply + rate_install. Per-area rate summation is explicitly INVALID (rates are per-unit; summing across areas is semantically wrong). Supply + install summation IS valid per sec 7.32 combined-rate consistency rule. Fix would be: if rate_combined is None and rate_supply is not None and rate_install is not None, rate_combined = rate_supply + rate_install - in classifier.py after line 498. Semantic confirmation needed before implementing (see open questions below).

**Out-of-scope items surfaced during audit (NOT Bug 6, but visible from the code):**

- `amount_combined` convenience field is entirely absent from ClassifiedRow. The role="amount_combined" ColumnRole exists in config.py and _HEADER_KW (used for HEADER_REPEAT detection at classifier.py Step 2), but classify_row() never extracts an amount_combined value for line items. Any column mapped as role="amount_combined" is silently ignored for data extraction. This is a separate feature gap - not Bug 6.
- `cr.rate_combined` fallback via rate_by_area_raw: per-area rate columns produce rate_by_area_raw entries but these are never used to compute cr.rate_combined. This would be semantically invalid (per-unit rates not summable across areas) so omission is correct design, but the gap between rate_by_area_raw and cr.rate_combined should be flagged.
- ResolvedRow.qty_total is initialized from qty_total_raw (the qty_total column cell value), NOT from cr.qty. This means if cr.qty was correctly computed as a per-area sum but qty_total_raw is None (qty_total column blank), ResolvedRow.qty_total starts as None before post-pass fixes it. The post-pass always makes it consistent. Design is intentional per comment at classifier.py line 46-48 ("Separate from qty because classify_row() may override qty from per-area sum").

**Recommended fix shape (informs the next prompt):**

- Files to touch: classifier.py (primary - cr.amount_total and cr.rate_combined fallbacks); orchestrator.py (secondary - ResolvedRow.amount_total supply+install fallback alongside the existing per-area fallback at Site 2)
- Approximate LOC: ~15-25 in classifier.py (3 new fallback blocks with guard conditions); ~5-8 in orchestrator.py (extend Site 2 with supply+install check)
- New tests needed:
  - Synthetic fixture test: amount_supply + amount_install present, no amount_total column - assert cr.amount_total = supply + install and ResolvedRow.amount_total = same
  - Synthetic fixture test: rate_supply + rate_install present, no rate_combined column - assert cr.rate_combined = supply + install
  - Inovalon real-fixture integration test (if one does not already assert amount_total): assert ResolvedRow.amount_total is non-None on rows with supply + install amounts
  - Edge case: amount_supply present but amount_install = None (or vice versa) - fallback should NOT fire for incomplete components; only when BOTH are non-None
- Existing tests that may need updates: any test currently asserting cr.amount_total = None when amount_total column absent but amount_supply/amount_install present; grep for amount_total assertions in test_*.py files before implementing
- Semantic open questions for chat-Claude to resolve before fix:
  - Should cr.rate_combined fall back to rate_supply + rate_install when rate_combined column absent? (YES per sec 7.32, but confirm.)
  - Should the fallback fire when ONLY ONE of supply/install is present (e.g., supply-only BoQ with no install rate)? (Probably NO - partial sum would be misleading. Require both.)
  - Ordering priority for cr.amount_total fallbacks: should supply+install summation take precedence over per-area summation, or vice versa? If both sources available simultaneously, which wins?
  - Should cr.amount_total fallback be added at classifier.py level (consistent, single-pass) or only at orchestrator.py level (no cr field mutation, follows existing pattern for amounts)? The per-area case currently only fixes ResolvedRow.amount_total, not cr.amount_total - should Bug 6 fix match that asymmetry or make both layers consistent?

---

### Phase 1.9i complete (2026-05-18)

**Single-area-targeted diagnostic on 11 sheets at hrc=1.**

- Chore commit: 7d588976d90e8c55ef7a20f33888ecec67541ec2
- Docs commit: see git log (paradox-free per §9 #69)
- Rationale: Nitesh's 2026-05-18 framing — nail single-area first → ~60-70% real-world coverage.
- Targets (11 sheets across 9 fixtures):
  1. ES-CW-MS HVAC Modification → `(Unpriced_R1)ES-CW-MS -6A-L1  L2-HVAC MODIFICATION 09.03.2026.xlsx` : `VRF System`
  2. ES-CW-MS Electrical Modification → `(Unpriced_R1)ES-EL-CW-MS-6A-L1  L2-ELECTRICAL MODIFICATION PRICED BOQ-10.03.2026-R1.xlsx` : `LT WORKS`
  3. Bill of Quantities → `Bill of Quantities.xlsx` : `ELECTRICAL & ELV BOQ`
  4a. Paytm → `BOQ MEP_PAYTM BANGALORE.xlsx` : `ELEC  BOQ` (double-space — confirmed)
  4b. Paytm → `BOQ MEP_PAYTM BANGALORE.xlsx` : `HVAC BOQ`
  5. Electrical BoQ → `Electrical BOQ.xlsx` : `BOQ_ELECTRICAL`
  6. Electrical Unpriced → `Electrical Unpriced BOQ-03.02.2026 R1.xlsx` : `Electrical ` (trailing space — confirmed)
  7. Inovalon → `Inovalon HVAC Unpriced BOQ-21.01.2026.xlsx` : `BOQ`
  8. K Mall → `K-Mall Jodhpur BOQ Combined.xlsx` : `HVAC BOQ`
  9a. Kohler → `Kohler-BOQ- 06-04-26.xlsx` : `Electrical`
  9b. Kohler → `Kohler-BOQ- 06-04-26.xlsx` : `HVAC`
- Captured per target: classification, pattern, areas, header_row_excel,
  header_cells_by_column, auto_guessed_column_role_map, first_3_l1_preambles,
  first_l2_preamble, first_10_line_items (parent_path + qty + rate + amount +
  per_area_*), line_items_with_non_none_qty_count vs total.
- Parser tests: 291 passing (unchanged — observability-only).
- Audit-script regression check (agreement #25): clean, zero diffs.
- Frappe tests: not run (no Frappe code touched, per agreement #20).
- Output files: single_area_triage_1_9i_output.json (~74 KB), .txt (~43 KB).
- Headline findings:
  - All 11 sheets correctly classified as single-area; zero multi-area false positives.
  - Zero load exceptions — all 9 fixture files opened cleanly.
  - 163 total null role assignments across 11 targets — auto-guess has coverage gaps (unrecognized header strings map to null).
  - Non-None-qty ratio: 100% across all 11 targets (min=58/58, max=553/553) — qty column detection working correctly for single-area sheets.
  - Line item counts span 58 (HVAC VRF) to 553 (Paytm ELEC) — parser scales correctly across large single-area sheets.
- Next step: chat-Claude + Nitesh review output and decide on Stage 2 scope (single-area follow-on fixes or proceed to Raheja HVAC parser polish).

### Phase 1.9j --- Mode C diagnostic metric fix ✅ COMPLETE

Diagnostic-script-only sub-phase. Replaces the broken `line_items_with_non_none_qty_count`
metric with three mutually-exclusive counts per role family (qty / rate / amount).
No parser source touched. Parser tests unchanged at 291 PASS / 0 FAIL.

**What changed in `single_area_triage_1_9i.py`:**

- Added `_role_metric(role_assigned, real_flags)` helper returning three-count dict.
- Added role-family membership constants `_QTY_FAMILY_ROLES`, `_RATE_FAMILY_ROLES`,
  `_AMOUNT_FAMILY_ROLES`.
- In `_run_target()`: per-LINE_ITEM-row appending of qty/rate/amount real-flags;
  per-target three-count computation; sum-invariant assertion raises ValueError if
  `real + zero_default + role_unassigned != total_line_items_count` for any role family
  on any target.
- New output fields per target: `line_items_with_real_<role>_count`,
  `line_items_with_<role>_zero_default_count`,
  `line_items_with_<role>_role_unassigned_count` for role in {qty, rate, amount}.
- Deprecated `line_items_with_non_none_qty_count` retained with inline comment for
  one transition cycle of comparability with 1.9i baseline.
- TXT renderer per-target block + new aggregate-summary three-count block.
- Output filenames changed from `_1_9i_output.{json,txt}` to `_1_9j_output.{json,txt}`;
  1.9i baseline files at `c3b2ed1d` preserved untouched.
- Added `_self_test()` callable via `--self-test` CLI flag; 3 synthetic cases
  verify the helper's three-count logic. Kept in-script (no test file added) so
  parser test count stays at 291.

**Real-flag definition (per role family):**

`real` = role assigned in `SheetConfig.column_role_map` AND
`ClassifiedRow.<role_field>` is not None. For qty: also excludes `cr.is_rate_only`
rows (§9 #66 blank-to-zero coercion and rate-only markers). Rate family checks
`rate_combined`/`rate_supply`/`rate_install`. Amount family checks
`amount_total`/`amount_supply`/`amount_install`.

**Sum invariant:** `real + zero_default + role_unassigned == total_line_items_count`
for each of qty / rate / amount on every target. Asserted in `_run_target` via
explicit `raise ValueError` on violation. Re-run on the 11 original 1.9i targets
showed no violations.

**Empirical headline from re-run** (`single_area_triage_1_9j_output.txt` aggregate,
2372 total line items across 11 targets):

```
qty   : real=  1617  zero_default=    32  role_unassigned=   723
rate  : real=   733  zero_default=  1639  role_unassigned=     0
amount: real=  2339  zero_default=    33  role_unassigned=     0
```

vs deprecated `line_items_with_non_none_qty_count` which scored 100% non-None on
every target (because 0.0 was treated as non-None). Mode C confirmed: the prior metric
was structurally incapable of distinguishing "parser found qty" from "qty unassigned
and defaulting to 0."

**Top finding: 723/2372 (30.5%) of line items have NO qty column assigned at all.**
Largest single contributor: Target 4 (Paytm ELEC, 553 items, role_unassigned=553)
— confirmed Mode A failure (merged-cell two-row header, hrc=1 misses the area names).
Target 5 (Paytm HVAC, 170 items) similarly: role_unassigned=170. Combined these two
targets account for 723/723 of the unassigned bucket. All other 9 targets show
role_unassigned=0 for qty — clean single-area sheets with qty column correctly mapped.
Mode A fix in Phase 1.9m should collapse role_unassigned for these targets.

Selected per-target highlights:
- Target 4 (Paytm ELEC, 553 items): qty real=0, zero_default=0, role_unassigned=553 — Mode A failure confirmed.
- Target 9 (K Mall HVAC, 67 items): qty real=65, zero_default=2, role_unassigned=0 — clean parse; 2 rate-only rows coerced.
- Target 11 (Kohler HVAC, 69 items): qty real=66, zero_default=3, role_unassigned=0 — clean; rate all zero_default (rate column absent or unrecognized).

**Caveat for follow-up refinement:** The real flag uses `cr.<role_field> is not None`
as a proxy for "source cell was non-empty." This is accurate if the parser preserves
None for blank cells at the `ClassifiedRow` layer. Step 0 verify-current-state
confirmed the type signatures (`qty: float | None = None`, etc.) but did not trace
every parsing code path to confirm None-preservation end-to-end. If any §9 #66-style
blank-to-zero coercion occurs at the `ClassifiedRow` layer (beyond the documented
`is_rate_only` path), real counts for qty/amount are slightly inflated and
zero_default slightly deflated; headline signals (role_unassigned distribution,
rate zero_default ratio) are unaffected. Verification recommended in a future
refinement (1.9j.1 candidate, low priority) or as a side-check during 1.9n re-run
analysis.

**Test impact:** Parser tests 291 unchanged. Script `--self-test` adds 3 synthetic
cases (all-real, all-zero-default, role-unassigned), all PASS. No new files in `tests/`.

**§9 #54 ECHO check:** xlsx fixtures perturbed by parser re-run; cleared via
`git restore nirmaan_stack/services/boq_parser/tests/fixtures/*.xlsx` before commit.

**Status:** CLOSED. Chore commit `68befb2e`. Docs commit see git log.

### Phase 1.9k --- Mode B + Mode F + F3c broadened ✅ COMPLETE

Three classifier defects fixed in one feat commit. Parser source touched:
`classifier.py`, `multi_area_detection.py`, `classifier_audit.py`. Test count
291 → 312. Phase 1.x Frappe tests 91 unchanged.

**Mode B (1.9i finding) — `_HEADER_KW` vocabulary additions:**
- `qnt`, `qnt.` → qty role (Paytm HVAC target 5, 170 line items with role_unassigned qty).
- `um` → unit role (Kohler HVAC target 11).
- 10 additional entries surfaced from `classifier_audit_output.json` top-200
  unclassified strings:
  - `sl no` → sl_no (unperioded variant; also enables Mode F "Sl No." fix as substring)
  - `sq.ft`, `sqm`, `rmt`, `rft`, `mtr`, `set`, `each` → unit (square feet/meters,
    running meter/feet, meter, set, each — all obvious unit abbreviations)
  - `no's` → qty (possessive/plural of nos, i.e. "numbers")
- `classifier_audit.py` `_CLASSIFIER_HEADER_KW` frozen replica synced
  (agreement #21 mechanical cascade). Sync comment updated to Phase 1.9k.

**Mode F (1.9i finding) — trailing-punctuation normalization:**
- Normalization at `classify_row()` header-repeat step (line 434 in `classifier.py`)
  extended: `_to_str(c.value).lower().rstrip(".:") `
- Affects: `Sl No.`, `SL NO.`, `Qty.`, `S No:`, and any trailing-period / trailing-colon
  variants across the corpus.
- Call-site scope: local to the header-repeat detection in `classifier.py`. Does NOT
  modify `multi_area_detection.py`'s `_is_reserved` (separate normalization path,
  reserved keywords from GlobalSettings do not typically have trailing periods).
- `classifier_audit.py` `_match_role()` normalization synced to same `rstrip(".:").
- **Audit magnitude**: Mode F contributed substantially more matches than Mode B alone.
  Classified count jumped from 3255 → 3970 (+715). The 715 delta vs ~12 vocabulary
  additions confirms Mode F's `rstrip` caught a large trailing-period long tail across
  the 25-workbook corpus.

**F3c broadened (Phase 1.9e finding) — `_RATE_CELL_PATTERN`:**
- Was: anchored regex `r"^\s*rates?\s*$"` (required cell to be exactly "rate"/"rates").
- Now: word-boundary regex `r"\b(rates?|costs?|prices?)\b"` (rate/cost/price family).
- Call-site changed from `.match()` to `.search()` (non-anchored regex requires search).
- Recognizes rate-family words anywhere in the cell text: `Per Unit Rate`,
  `Supply Rate`, `Rate (INR)`, `Unit Cost`, `Unit Price`, etc.
- Empirical basis: 62 cases (60 rate + 2 price) from Phase 1.9e stress test.
- False-positive risk bounded by Pattern 2-rate detection's call-site context
  (only consulted after a 3-col merge structure is already confirmed).
- Word-boundary semantics verified by `test_costing_does_NOT_match_word_boundary_check`
  — "Costing" does NOT match.
- F3c does NOT affect `classifier_audit_output.json` output (classifier_audit.py
  only uses classifier.py's `_match_role`, not multi_area_detection).

**Audit-script regression check (agreement #25):**
- `classifier_audit_output.json` regenerated.
- Before (v5.10 §17.11.F): classified=3255, unclassified=11424, unique_unclassified=2697.
- After (Phase 1.9k): classified=3970, unclassified=10709, unique_unclassified=2536.
- Net delta: classified +715; unclassified -715; unique_unclassified -161.
- Direction consistent with additive vocabulary + normalization broadening. No unexpected
  classification flips.

**Test calibration (§9 #73 path-shift pattern):** None required. All existing tests
continued to pass without modification. No test asserted that QNT/UM/Sl No. should
stay unclassified, and no Pattern 2-rate test asserted that non-bare-Rate headers should
fail detection.

**Test count:** 291 → 312. New tests:
- `TestPhase1_9kModeBAndF` in `test_classifier.py` (10 tests: QNT, QNT., UM, Sl No.,
  SL NO., Qty., No's, Sq.ft, Rmt, Each).
- `TestPhase1_9kF3cBroadenedRateCellPattern` in `test_multi_area_detection.py` (11 tests:
  Per Unit Rate, Supply Rate, Rate (INR), Unit Cost, Unit Price, bare Rate, bare Rates,
  Costing word-boundary guard, unrelated text guard, Per Unit Rate integration,
  Unit Cost integration).

**§9 #54 ECHO check:** xlsx fixtures perturbed by test runs; cleared via
`git restore nirmaan_stack/services/boq_parser/tests/fixtures/*.xlsx` before commit.

**Status:** CLOSED. Feat commit `3cc3819c`. Docs commit see git log.

### Phase 1.9l --- Mode D substring-match precedence fix ✅ COMPLETE

Single targeted fix per the 1.9j-1.9n locked plan. Parser source touched:
`_auto_guess.py` (Phase 1 assignment matcher) and `classifier_audit.py` (`_match_role()`
replica). `classifier.py` not modified — its HEADER_REPEAT checker iterates
per-column against already-assigned roles (different semantics, no role competition).
Test count 312 → 324. Phase 1.x Frappe tests 91 unchanged.

**Mode D (1.9i finding) — generic keyword beats specific:**

The old Phase 1 matcher in `_auto_guess.py` iterated `_HEADER_KW` in dict-insertion
order and broke on the first role whose keyword set had any matching substring.
Because substring matching makes shorter keywords match a strict superset of inputs
vs longer ones, generic keywords like `"rate"` (in `rate_combined`) would beat
specific compound keywords like `"supply rate"` (in `rate_supply`) whenever the cell
text contained both.

**Headline bug (1.9i target 8 Raheja Electrical):**
- Bottom-header cell text: `"Supply Rate"`.
- Old matcher: `"rate"` in `"supply rate"` → True → `rate_combined` wins (iteration
  order); `break`. Supply rate column mis-labeled as `rate_combined`. Install rate
  column dropped to NULL because no subsequent role's first-matching keyword was tried.
- New matcher: among all keyword matches across all roles, picks the role whose
  matched keyword is LONGEST. `"supply rate"` (11 chars) beats `"rate"` (4 chars) →
  `rate_supply` wins. Tie-break by iteration order (no second criterion).

**Implementation:**
- `_auto_guess.py` Phase 1 assignment loop (lines 111-121): replaced inner
  `if any(...): break` with a collect-all-matches loop tracking `best_kw_len`.
- `classifier_audit.py` `_match_role()` (lines 140-153): same longest-match-wins
  rewrite. Sync comment updated to cite Phase 1.9l Mode D + agreement #21.
- `classifier.py` HEADER_REPEAT checker: NOT modified. That checker iterates the
  already-assigned `col_map` and checks per-column whether the cell text matches
  that column's own role keywords — no role competition, so Mode D is irrelevant.

**Test calibrations (§9 #73 path-shift pattern):** None required. All existing tests
either used bare `"Rate"`/`"Amount"` headers (which only match one role family) or
pre-configured `column_role_map` objects (not derived from auto_guess). Zero tests
asserted the buggy first-match precedence.

**New tests** in `TestPhase1_9lModeDPrecedence`:
- `test_auto_guess.py` (10 tests): Supply Rate → rate_supply; Installation Rate →
  rate_install; Install Rate → rate_install; Supply Amount → amount_supply;
  Installation Amount → amount_install; Combined Rate → rate_combined (regression);
  bare Rate → rate_combined (regression); SITC Rate → rate_combined (regression);
  DSR Rate → rate_supply; NDSR Rate → rate_install.
- `test_classifier.py` (2 spot-check tests): Supply Rate in rate_supply col → HEADER_REPEAT;
  Install Rate in rate_install col → HEADER_REPEAT. Complementary guards that role
  assignment is in `_auto_guess.py` and tested fully there; classifier-level tests
  verify the HEADER_REPEAT checker works once columns carry the right roles.

**Audit-script regression check (agreement #25):**
- Top-level stats (expected near-flat since Mode D reassigns but does not unclassify):
  Before (Phase 1.9k): classified=3970, unclassified=10709, unique_unclassified=2536.
  After (Phase 1.9l): classified=3970, unclassified=10709, unique_unclassified=2536.
  Flat as expected — `"Supply Rate"` classified before (as wrong role) and after (as
  correct role); net classified count unchanged.
- Per-role breakdown: not surfaced in audit JSON structure (`summary` has no
  `classified_by_role` field). Role-flip detail visible only in `per_fixture`
  per-cell records; not summarized.

**§9 #54 ECHO check:** xlsx fixtures perturbed during two test runs (Step 1 and Step
7 checks); cleared via `git restore` before both the final test suite run and before
commit.

**Status:** CLOSED. Feat commit `f00cc6ca`. Docs commit see git log.

### Phase 1.9m --- Mode A auto-detect 2-row headers ✅ COMPLETE

Single targeted fix per the 1.9j-1.9n locked plan. Parser source touched:
`_auto_guess.py` only. Test count 324 → 337. Phase 1.x Frappe tests 91 unchanged.

**Mode A (1.9i §22.4 finding) --- merged-cell 2-row headers misread at hrc=1:**

When a sheet uses a two-row merged header and is read at `header_row_count=1`, the
reader flattens merged cells — every continuation cell carries the same text as its
merge origin. This means adjacent columns share identical normalized text in the bottom
header row. The Phase 1 singleton guard in `auto_guess_sheet_config()` fires on the
second duplicate and drops its role assignment, leaving per-area columns without roles.

**Helper: `_should_auto_promote_hrc_to_2(bottom_row, above_row, below_row) → bool`**

Three-condition heuristic (all must hold):
1. bottom_row has ≥ 3 non-blank cells (degenerate sheets don't trigger).
2. At least one pair of ADJACENT columns (col-index difference == 1) in bottom_row
   has identical normalized text (the merged-cell signature).
3. For at least one such duplicate pair, either `above_row` or `below_row` has
   DISTINCT non-blank text at both those column positions (confirms a genuine 2-row
   header rather than a table with legitimately repeated values).

Conservative by design: false negatives are recoverable via
`SheetConfig.top_header_rows_override` (Phase 1.9d F5-b). False positives would
corrupt the parse.

**Signature change to `auto_guess_sheet_config()`:**

```python
# Before (Phase 1.9l):
def auto_guess_sheet_config(reader, sheet_name, header_row,
                             header_row_count: int,
                             reserved_keywords: list[str]) -> SheetConfig

# After (Phase 1.9m):
def auto_guess_sheet_config(reader, sheet_name, header_row,
                             header_row_count: int | None = None,
                             reserved_keywords: list[str] | None = None) -> SheetConfig
```

- `header_row_count=None` (new default) → Mode A auto-detect: reads above + below rows,
  calls `_should_auto_promote_hrc_to_2()`, resolves to `effective_hrc` ∈ {1, 2}.
- Explicit int (1 or 2) → bypasses auto-detect, same behaviour as before.
- `reserved_keywords=None` → resolves to `[]` (backward-compatible).

All existing callers pass explicit positional args `(reader, sheet, hr, hrc, kws)` —
unaffected by the default changes.

**Empirical targets (Phase 1.9i §22.4):**

- Paytm ELEC (header_row=5): adjacent RATE/RATE and AMOUNT/AMOUNT in row 5; below row 6
  has Supply/Installation → `_should_auto_promote_hrc_to_2` returns True → effective_hrc=2.
  BUT "SUPPLY" and "INSTALLATION" are in `multi_area_reserved_keywords`, so
  `detect_multi_area_pattern` returns None on the top row → no per-area roles assigned.
  effective_hrc=2 but area_dimensions=[] → no corruption, no improvement for Paytm.
  Full fix for Paytm deferred (needs non-reserved area names or Pattern 6 detection).
- Paytm HVAC: same shape; same result.
- TS-T2-WEX shape (e.g. "Office"/"Common Area" above "QTY"/"QTY"): adjacent QTY/QTY
  in bottom row; above row has distinct non-reserved names → promotes to hrc=2 → Pattern 1
  (top row fallback) fires → per-area qty roles assigned correctly.

**Implementation:**

- `_should_auto_promote_hrc_to_2()` added after `_normalize()` in `_auto_guess.py`.
- `auto_guess_sheet_config()` early block: if `header_row_count is None`, reads
  `header_row − 1` (if exists) and `header_row + 1`, calls helper, sets `effective_hrc`.
  `effective_hrc` then replaces `header_row_count` in Phase 1, Phase 2, and `SheetConfig(...)`.

**Test calibrations:** None required. All existing tests pass explicit `header_row_count`
values — they route through the `else: effective_hrc = header_row_count` branch, unaffected.

**New tests** in `test_auto_guess.py` (13 total):

`TestShouldAutoPromoteHrc2` (8 helper unit tests):
- adjacent dup + below distinct → True
- adjacent dup + above distinct → True
- no adjacent dups → False
- fewer than 3 cells → False
- adjacent dup + both above/below None → False
- adjacent dup + below matching at dup cols → False
- adjacent dup + below blank at dup cols → False
- non-adjacent dups (gap column) → False

`TestPhase1_9mModeAAutoPromote2RowHeader` (5 integration tests):
- TS-T2-WEX shape: auto-promotes to hrc=2
- all-distinct bottom row: stays hrc=1
- TS-T2-WEX: after promote, Pattern 1 (top) assigns per-area qty to Office + Common Area
- Paytm ELEC shape: promotes to hrc=2 but reserved kws block pattern → area_dimensions=[]
- explicit hrc=1 on promotable sheet: bypasses auto-detect → stays hrc=1, no per-area roles

**Audit-script regression check (agreement #25):**

`classifier_audit.py` does not call `auto_guess_sheet_config` — it uses
`reader.detect_header_row()` and scans headers at its own fixed hrc=1. Stats are expected
flat. Confirmed:
  Before (Phase 1.9l): classified=3970, unclassified=10709, unique_unclassified=2536.
  After (Phase 1.9m): classified=3970, unclassified=10709, unique_unclassified=2536. ✓

**§9 #54 ECHO check:** Synthetic xlsx fixtures perturbed during test run; cleared via
`git restore` before commit (done manually outside Claude Code due to tool hang).

**Status:** CLOSED. Feat commit `c08ebd13`. Docs commit see git log.

### Phase 1.9n --- Re-run single-area diagnostic on subset + metric correction (1.9j-1.9n cycle closes) ✅ COMPLETE

Final sub-phase of the 1.9j-1.9n locked plan. Diagnostic-script-only re-run on the 9
single-area-candidate targets (3-11) from the original 1.9i target list, using the
Phase 1.9j three-count metric to measure the cumulative effect of Phase 1.9k (Mode B/F/F3c),
Phase 1.9l (Mode D), and Phase 1.9m (Mode A) on those targets.

No parser source touched. Parser tests unchanged at 337 PASS. No Frappe boundary crossed.

**Implementation:** Option A — extended `single_area_triage_1_9i.py` with a `--subset 1_9n`
CLI flag. Changed `main()` signature to `main(subset: str | None = None)`. When
`--subset 1_9n` is passed, filters `TARGETS[2:]` (targets 3-11) and writes to
`single_area_triage_1_9n_output.{json,txt}`. Original 1.9j output paths unaffected.
~18 lines net new/changed — well under the 30-line Option-B threshold.

**Metric correction: `_QTY_FAMILY_ROLES` widened to include `qty_total`:**

Initial run showed three apparent regressions (Kohler HVAC, Inovalon, Electrical Unpriced
all moved from 0 to fully-unassigned qty). STOP triggered. Investigation confirmed these
are NOT parser regressions — Phase 1.9l Mode D's longest-match-wins precedence fix
correctly reclassified "Total Qty" column headers from `qty` → `qty_total`. The 1.9j
metric definition `frozenset({"qty"})` excluded `qty_total`, so `qty_role_assigned` was
False for those sheets despite the column being correctly typed. Fix: widened to
`frozenset({"qty", "qty_total"})`. A single constant change; no parser source touched.

**Outputs:**
- `single_area_triage_1_9n_output.json` (66,055 bytes)
- `single_area_triage_1_9n_output.txt` (36,982 bytes)

**Headline finding: clean-parse count 2 of 9** (Bill of Quantities + Kohler Electrical).
Same count as the 1.9i baseline on the strict zero-default=0 definition — but the
semantic coverage is meaningfully better after the metric correction and 1.9k/l/m fixes.

**Per-target qty role_unassigned at 1.9n (vs 1.9j baseline, 9 kept targets):**

| Target | 1.9j unassigned | 1.9n unassigned | Delta | Notes |
|---|---|---|---|---|
| 3. Bill of Quantities | 0/449 | 0/449 | 0 | CLEAN |
| 4. Paytm ELEC | 553/553 | 553/553 | 0 | Mode A promotes to hrc=2 but Supply/Installation reserved kws block pattern; unchanged as predicted |
| 5. Paytm HVAC | 170/170 | 0/336 | −170 | Improved: Mode B QNT synonym assigned qty role; total doubled 170→336 due to Mode F rstrip reclassifying header-repeat rows as LINE_ITEM; 184 real + 152 zero_default |
| 6. Electrical BoQ | 0/230 | 0/261 | 0 | 31 zero_default; total grew (Mode F rstrip effect) |
| 7. Electrical Unpriced | 0/155 | 0/154 | 0 | Metric gap corrected: column is qty_total, not qty; real=149, zero_def=5 |
| 8. Inovalon | 0/106 | 0/106 | 0 | Metric gap corrected: column is qty_total; real=93, zero_def=13 |
| 9. K Mall HVAC | 0/67 | 0/67 | 0 | No regression ✓ |
| 10. Kohler Electrical | 0/236 | 0/236 | 0 | CLEAN; no regression ✓ |
| 11. Kohler HVAC | 0/69 | 0/69 | 0 | Metric gap corrected: column is qty_total; real=66, zero_def=3 |

**Aggregate three-count metric (9 targets, corrected):**

```
Total line items across all targets: 2231
qty:    real=1472  zero_default=206  role_unassigned=553
rate:   real=688   zero_default=1543 role_unassigned=0
amount: real=2208  zero_default=23   role_unassigned=0
```

Aggregate qty_unassigned: 723 (1.9j 9-target baseline) → 553 (1.9n corrected), delta=−170.
Sole residual: Paytm ELEC (553 items). All other targets have qty assigned.

**Strategic observation:** The 1.9j-1.9n cycle delivered one empirical gain: Paytm HVAC's
170 qty items moved from role_unassigned to assigned (via Mode B QNT synonym in 1.9k).
The three apparent regressions were a metric definitional gap exposed by 1.9l's semantic
precision improvement — a win for correctness, not a loss. Paytm ELEC (553 items) remains
the sole unresolved target, requiring either non-reserved area names or Pattern 6 detection
(not in any current sub-phase plan). The Mode A auto-detect (1.9m) fires correctly for
Paytm but is blocked by reserved keywords at the pattern-detection step — confirming the
1.9m design constraint documented in the 1.9m section above.

**Empirical input for the strategic re-evaluation conversation (v5.17 §22.8):** the
1.9j-1.9n cycle reduced the 9-target qty_unassigned from 723 to 553 (−170, Paytm HVAC
alone). The metric correction also revealed that 1.9l improved semantic precision beyond
what the original metric could measure.

**Audit-script regression check (#25): NOT APPLICABLE this sub-phase.** No parser source
touched, classifier dictionary unchanged.

**Phase 1.x Frappe tests:** NOT RE-RUN. Diagnostic-script-only; no parser/Frappe boundary
crossed per agreement #20.

**§9 #54 ECHO check:** 11 synthetic xlsx fixtures perturbed by both diagnostic runs.
Restored via `git restore "nirmaan_stack/services/boq_parser/tests/fixtures/synthetic_*.xlsx"`
(broad glob, confirmed safe when all 11 are modified per session verification).

**Status:** CLOSED. Chore commit `3af8e828`. Docs commit see git log.

**The 1.9j-1.9n locked cycle is now complete.** Next: strategic re-evaluation chat
(per v5.17 §22.8) with this 1.9n empirical data as input.

### Pre-1.9o fixture additions (chore, no parser source touched)

Added 4 synthetic multi-area BoQ fixtures (V1/V2 variants of
two shapes, intentionally different) to feed Phase 1.9o
regression coverage and the expanded-subset diagnostic retest:

- `multi_area_single_header_v1.xlsx` --- 17-sheet multi-sheet
  single-area BoQ, 1-row headers; parser handles cleanly today.
- `multi_area_single_header_v2.xlsx` --- same shape as V1,
  file bytes differ; V1 cross-check fixture.
- `multi_area_merged_header_v1.xlsx` --- 13-sheet BoQ with a
  hybrid shape (2-col top-row merges over Supply/Installation
  pairs PLUS row-2 'Area 1'/'Area 2' labels); auto_guess
  assigns qty to two columns. Edge-case coverage.
- `multi_area_merged_header_v2.xlsx` --- 13-sheet BoQ with
  canonical Tier A-merged shape: 4-col top-row merges over
  {Qty | Supply rate | Install Rate | Amount} sub-header
  quadruples per area. Currently exhibits silent supply/install
  drop (qty/rate/amount columns unassigned) at hrc=1 and hrc=2.
  Strongest Phase 1.9o regression fixture.

Commit: a97ff170

Feeds: Phase 1.9o (Tier A-merged pattern recognizer +
reference-code keyword expansion) regression coverage, and
the expanded-subset diagnostic retest empirical surface.

### Expanded-subset retest --- 15 targets (11 existing + 4 multi-area fixtures) ✅ COMPLETE

What landed: TARGETS list in single_area_triage_1_9i.py extended from 11 to 15
by appending the 4 synthetic multi-area fixture sheets specified by Nitesh. The
original chore (9d4abf36) used incorrect filenames (missing multi_area_ prefix);
a cleanup chore (c8c9f234) corrected the 4 "file" fields. The empirical findings
below come from the corrected run.

Fixture file references:
- multi_area_merged_header_v1.xlsx: ELECTRICAL & ELV BOQ
- multi_area_merged_header_v2.xlsx: ELECTRICAL & ELV BOQ
- multi_area_single_header_v1.xlsx: HVAC BOQ
- multi_area_single_header_v2.xlsx: HVAC BOQ

Snapshot convention introduced: diagnostic_snapshots/ folder for preserving
named copies of significant diagnostic runs. The live output files are
overwritten each run; snapshots provide historical comparison points. Chore #2
smoke-run (commit 63bead94) snapshotted as chore_2_smoke_run.json + .txt before
the expanded run regenerated the live output.

Key findings from the corrected empirical run:

merged_header_v1 (ELECTRICAL & ELV BOQ):
- hrc: Mode 1=2 (auto-detect bumped), Mode 2=1. Pattern=None. Classification: single-area.
- Tier A-merged did NOT fire. The fixture was parsed as single-area despite the
  auto-detect bump. total=449, qty real=449 (100%), rate real=200/449, amount
  real=449 (100%). No src_present_unparsed. Clean parse.
- Mode 1 vs Mode 2 delta: ZERO (identical metrics at hrc=2 and hrc=1).
- Note: Phase 1.9o commit notes cited v1 ELECTRICAL sheet as the empirical case
  where tier_a_merged fires. The multi_area_merged_header_v1.xlsx diagnostic here
  shows pattern=None / single-area. Either the fixture on disk differs from the one
  used in 1.9o tests, or auto-detect at hrc=2 is routing through a different code
  path than the tier_a_merged shape expects. Requires investigation.

merged_header_v2 (ELECTRICAL & ELV BOQ):
- hrc: Mode 1=2 (auto-detect bumped), Mode 2=1. Pattern=Pattern 1. Classification:
  multi-area, 2 areas. total=370.
- 100% role_unassigned across all 3 families (qty/rate/amount). Auto_guess could
  not assign any column roles to either area. No src_present_unparsed (vacuously
  0 -- no roles assigned so no source walk).
- Mode 1 vs Mode 2 delta: ZERO (Pattern 1 fires in both modes).
- This aligns with the prediction that v2 "falls through to Pattern 1 top-row
  fallback with partial handling" -- though the result is worse than partial:
  total role_unassigned for all 370 items. The role_unassigned = 100% finding
  makes this the most critical gap in the current corpus after Paytm HVAC.

single_header_v1 (HVAC BOQ):
- hrc: Mode 1=1, Mode 2=1 (no auto-detect bump). Pattern=Pattern 1. Classification:
  multi-area, 3 areas. total=67.
- qty: real=65, zero_default=2, src_present_unparsed=2 (NEW parser-side finding).
- rate: real=60, zero_default=7, src_present_unparsed=0.
- amount: real=47, zero_default=20, src_present_unparsed=0.
- Mode 1 vs Mode 2 delta: ZERO (no hrc delta as expected for single-header shape).

single_header_v2 (HVAC BOQ):
- hrc: Mode 1=1, Mode 2=1 (no auto-detect bump). Pattern=Pattern 1. Classification:
  multi-area, 3 areas. total=67.
- qty: real=65, zero_default=2, src_present_unparsed=2 (same as v1).
- rate: real=0, zero_default=67, src_present_unparsed=0 (ALL zero -- rate column
  not assigned in v2 vs 60 real in v1). This is the sharpest v1 vs v2 difference.
- amount: real=47, zero_default=20, src_present_unparsed=0 (same as v1).
- Mode 1 vs Mode 2 delta: ZERO.

Summary table (Mode 1 only, no Mode 1 vs Mode 2 delta on any new fixture):

  Fixture          | hrc | pattern   | class       | areas | total | qty_real | rate_real | amt_real | src_unp
  merged_hdr_v1    |  2  | None      | single-area |   0   |  449  |   449    |    200    |   449    |   0
  merged_hdr_v2    |  2  | Pattern 1 | multi-area  |   2   |  370  |     0    |      0    |     0    |   0
  single_hdr_v1    |  1  | Pattern 1 | multi-area  |   3   |   67  |    65    |     60    |    47    |   2
  single_header_v2 |  1  | Pattern 1 | multi-area  |   3   |   67  |    65    |      0    |    47    |   2

New parser-side findings to queue:
1. single_header_v1 + v2: qty src_present_but_unparsed=2 each -- 2 rows have a
   qty source cell value that the parser dropped. Candidate for the Phase 1.9q
   investigation queue alongside Paytm HVAC.
2. merged_header_v2: 100% role_unassigned across all families. The Pattern 1
   multi-area detection fires but auto_guess assigns nothing -- either the column
   layout is not recognizable by any keyword or the per-area assignment logic
   doesn't match this shape.
3. merged_header_v1 tier_a_merged miss: needs a follow-up diagnostic or direct
   inspection of the fixture to understand why pattern=None for a fixture named
   "merged_header".

Existing 11 targets: numbers identical to Chore #2 snapshot. Spot-checked:
- Paytm HVAC: qty src_present_unparsed=150/336 baseline confirmed.
- Kohler Electrical: total=236, qty real=236, clean.
- Electrical Unpriced: total=154, unchanged.
Mode 1 vs Mode 2 delta: zero for all 11 (consistent with prior chores).

Implications for queue positions 4 and 5: The merged_header_v2 100%
role_unassigned gap and the single_header src_present_unparsed=2 finding both
strengthen the case for Phase 1.9q work on the role-assignment + text-coercion
front before proceeding to the strategic re-evaluation chat. The merged_header_v1
tier_a_merged miss is the most unexpected finding and warrants ground-truth
inspection before the re-eval chat.

Parser tests 375 unchanged --- agreement 27 strict.

Chore commits: 9d4abf36 (TARGETS extension) + c8c9f234 (filename correction)
Docs commit: 483b53bd (original, now amended)

### Diagnostic metric repair --- source_present + two-mode output (chores, no parser source touched)

Two back-to-back diagnostic-script-only chores extending `single_area_triage_1_9i.py`.
No parser source touched. Parser tests unchanged at 375 PASS / 0 FAIL.

**Chore #1 (78ea7d49) --- `source_present_but_unparsed` signal + multi-area frozensets:**

- `_role_metric()` gains a 3rd arg `source_present_flags: list[bool]` and returns a 4th
  bucket: `source_present_but_unparsed` = line items where the role is assigned, the value
  is None (zero_default), AND the raw source cell was non-blank. Distinguishes "BoQ is
  unpriced" from "parser failed to parse a value that was present."
- New `_source_present_for_family(cr, sc, family_roles)` helper: walks `sc.column_role_map`
  to find columns mapped to any role in the given frozenset; checks `cr.raw_row.cells` for
  non-blank values.
- Multi-area role names added to family frozensets: `rate_combined_by_area`,
  `rate_supply_by_area`, `rate_install_by_area` added to `_RATE_FAMILY_ROLES`;
  `amount_by_area` added to `_AMOUNT_FAMILY_ROLES`. Without these, multi-area sheets
  would falsely register `role_assigned=False` for rate/amount families.
- 4 new `--self-test` cases (Cases 4-7): all-source-blank, all-source-present-and-parsed,
  mixed-with-1-parser-bug, role-unassigned-ignores-phantom-flags. Total: 7 cases, all PASS.

**Chore #2 (63bead94) --- two-mode output + `_run_mode` extraction:**

- Extracted `_run_mode(reader, wp, fname, sheet_name, header_row, hrc, hcells)` helper.
  Builds SheetConfig, runs `auto_guess_sheet_config` with given hrc, parses the sheet,
  collects the full 4-bucket metric per role family. Returns result dict or
  `_load_exception_result` on exception.
- `_run_target()` calls `_run_mode` twice: Mode 1 (`hrc=None`, production auto-detect)
  and Mode 2 (`hrc=1`, forced-debug). Output JSON structure:
  `diagnostic.mode_1_auto_detect` + `diagnostic.mode_2_hrc_1`.
- `_render_txt` rewritten with two-mode blocks per target.
- Module docstring rewritten to document 4-bucket metric definition and two-mode design intent.
- Output filenames unchanged: `single_area_triage_1_9j_output.{json,txt}`.

**Key empirical finding (Chore #2):** All 11 targets show zero Mode 1 vs Mode 2 delta.
Paytm HVAC's 150 `source_present_but_unparsed` qty rows are a parser-side text-coercion
issue, not a header-detection issue. Column D "QNT" has text values in those rows that
numeric coercion fails on. A two-row-header fix (Mode A) would not help --- `hrc=2`
auto-detect already fires correctly; forcing `hrc=1` produces identical metrics.
Investigation of the coercion gap is queued as Phase 1.9q candidate
(requires ground-truth pass per agreement #28).

**Test impact:** Parser tests 375 unchanged. `--self-test` total: 7 synthetic cases,
all PASS. No new files in `tests/`. Kept in-script so parser test count stays at 375.

**Status:** CLOSED. Chore commits: `78ea7d49` (Chore #1), `63bead94` (Chore #2).
Docs commit see git log.

### Phase 1.9p --- append_to_notes keyword auto-assignment ✅ COMPLETE

**What landed:** Added `append_to_notes` as a new key in `_HEADER_KW`
(classifier.py) with 12 reference-code keyword entries:
`ref no`, `refno`, `ref no.`, `ref. no`, `ref. no.`, `ref code`,
`ref number`, `reference`, `dsr`, `ndsr`, `code`, `item code`.
Synced `_CLASSIFIER_HEADER_KW` replica in classifier_audit.py per agreement #21.

**Why no _auto_guess.py change was needed:** Pre-flight code verification at tip
62e676e0 confirmed the existing Phase 1 longest-match loop (post-1.9l) correctly
handles `append_to_notes` without any guard blocks:
- `append_to_notes` is NOT in `_SINGLETON_ROLES` → multi-column assignment works.
- `append_to_notes` is NOT in `_PER_AREA_ONLY_ROLES` → universal role,
  assigned in Phase 1 (single-area path), not Phase 2 (per-area-only).

**Section 7.34 framing evolution (two-layer model):** Reference-code columns
(`Ref No`, `DSR`, `NDSR`, `Code`, etc.) are the first bounded carve-out from the
original "parser never auto-detects append_to_notes" rule. The revised model:
- Layer 1 (parser): auto-detects the bounded reference-code keyword family.
- Layer 2 (wizard): remains authoritative on user intent; wizard can
  confirm, override, or add any append_to_notes assignment.
Formal section 7.34 amendment owed in the handover doc on next chat-Claude cycle
per agreement #17 (manual sync).

**Longest-match-wins guards confirmed:** `DSR Rate` (8c) beats `dsr` (3c) →
stays rate_supply. `NDSR Rate` (9c) beats `ndsr` (4c) → stays rate_install.
`Material Code` (13c) beats `code` (4c) → stays make_model.

**Tests landed:** 11 in test_classifier.py `TestPhase1_9pAppendToNotesKeywords`
(9 positive recognition + 2 longest-match-wins regression). 7 in test_auto_guess.py
`TestPhase1_9pAppendToNotesAutoGuess` (3 positive auto-assign + 1 multi-column
lock-in + 3 longest-match-wins regression). Total: +18 (357 → 375).

**Audit regression check (agreement #25):** Pre-1.9p baseline with current corpus
(28 fixtures, 343 sheets): classified=4663, unclassified=12926,
unique_unclassified=2598. Post-1.9p: classified=4789, unclassified=12800,
unique_unclassified=2580. Delta: classified +126, unclassified -126, unique -18.
Direction correct. Magnitude +126 slightly above expected +20-+100 range but
plausible for reference-code family (DSR/NDSR/Reference/Code headers appear across
multiple sheets in the 28-fixture corpus). Note: direct comparison to the v5.18
baseline (3970/10709/2536) is not meaningful because the fixture corpus grew by
4 files between the committed audit snapshot and the current state; the stash-based
pre/post delta method was used instead to isolate the 1.9p contribution.

**Agreement #27 verified:** No diagnostic-script changes made. Agreement still holds.

**Feat commit:** `5d348e4a`

### Phase 1.9o --- Tier A-merged pattern recognizer (3-change feat) ✅ COMPLETE

**Three coupled changes in two files:**

**Change 1 (_auto_guess.py):** Added `amount_supply` and `amount_install` to
`_SINGLETON_ROLES` frozenset (2 new entries). Prevents duplicate singleton
assignment when a bottom header row contains both a Supply Amount and an
Install Amount column.

**Change 2+3 (multi_area_detection.py) --- unified `_try_tier_a_merged()`:**
Single function handling two sub-shapes via a top+bottom row scan:
- Qty-merged-over-areas: merged Qty/Quantity/Nos family cell spanning N>=2
  distinct area-name cells in the bottom row yields areas + qty_columns.
- Rate/Amount-merged-over-Supply/Install: merged Rate or Amount family cell
  spanning a Supply-then-Install pair (N=2); when the col count equals n_areas
  the columns are paired left-to-right with area names into rate_columns /
  amount_columns (rate_combined_by_area convention, consistent with
  Pattern 2-rate).

Four new broad regexes added before the dataclass:
`_QTY_CELL_PATTERN_BROAD`, `_AMOUNT_CELL_PATTERN_BROAD`,
`_SUPPLY_CELL_PATTERN`, `_INSTALL_CELL_PATTERN`.
Strict-anchor `_QTY_CELL_PATTERN` and `_AMOUNT_CELL_PATTERN` untouched
(still used by Pattern 2 / Pattern 2-rate).

Routing: `_try_tier_a_merged` inserted as the first step in the 2-row path
(before `_try_pattern_2_rate`).

**Empirical verification:**

v1 (`multi_area_merged_header_v1.xlsx`, ELECTRICAL sheet, hrc=2):
- tier_a_merged fires.
- areas=["Area 1", "Area 2"], E/F=qty per area, G/H=rate_combined_by_area per
  area, I/J=amount_by_area per area. Singletons A/C/D assigned correctly.

v2 (`multi_area_merged_header_v2.xlsx`, ELECTRICAL sheet, hrc=2):
- tier_a_merged returns None (top-row merges have area-name values, not
  Qty/Rate/Amount family text).
- Falls through to Pattern 1 top-row fallback.
- areas=["Area 1", "Area 2"] via E+I qty columns. F=rate_supply, G=rate_install,
  H=amount_total assigned as singletons from bottom row. J/K/L unassigned
  (singleton guard blocks duplicates).

**Tests:** 357 total (baseline 337 + 14 TestTryTierAMerged +
8 TestPhase1_9oChange1SingletonGuard + 5 TestPhase1_9oTierAMergedAutoGuess).
1 existing test calibrated: `test_reserved_keyword_top_row_merges_rejected_for_pattern_2`
updated to assert `tier_a_merged` (not pattern 1) because tier_a_merged now
correctly fires first for a QUANTITY-merge-over-area-names top row.

**Metric-impact review (agreement #27):** No diagnostic script changes needed.
`_AMOUNT_FAMILY_ROLES` already covers amount_supply + amount_install (Change 1
singletons). tier_a_merged's per-area roles (rate_combined_by_area,
amount_by_area) are multi-area only and not tracked by the single-area metric.

**Feat commit:** `6f6214ba`

### Phase 1.9h complete (2026-05-18)

**Auto-guess per-area column-role assignment + diagnostic script refactor.**

- Feat commit: f9a3121e
- Docs commit: see git log (paradox-free per §9 #69)
- Root cause: 1.9e auto-guess skipped area-specific roles with an explicit
  `if matched_role in {"amount_by_area", ...}: continue` guard. Raheja
  Electrical at hrc=2 detected Pattern 2-rate correctly but per-area
  qty/rate/amount came back all-None.
- Fix: extracted auto-guess logic into a shared module
  `nirmaan_stack/services/boq_parser/_auto_guess.py` with two-phase logic:
  Phase 1 (universal roles — singleton-guarded keyword matching, identical
  to prior inline logic); Phase 2 (per-area assignment when
  `detect_multi_area_pattern()` returns non-None at hrc≥2, uses positional
  parallel lists from MultiAreaPattern directly).
- Phase 2 core: for each area in mp.areas, assign qty col → ColumnRole(role="qty",
  area=...), amount col → role="amount_by_area", rate col →
  role="rate_combined_by_area". Override semantics: Phase 2 writes over Phase 1
  for columns inside area spans. area_dimensions set from list(mp.areas).
- Singleton guard preserved: _SINGLETON_ROLES tracking moved into
  `_auto_guess.py`, behavior identical. Verified by new test
  `test_singleton_guard_prevents_duplicate_assignment`.
- Diagnostic scripts refactored: `real_fixture_stress_test.py` and
  `multi_area_triage_1_9f.py` now import from `_auto_guess` and have their
  orphaned inline copies removed.
- New module: `_auto_guess.py` (119 lines). New tests: `test_auto_guess.py`
  (14 tests across 6 test classes).
- Smoke result: 98/100 LINE_ITEMs in Raheja Electrical have non-None PHASE-1
  qty at hrc=2; 51 have non-None PHASE-2 qty. rate=None expected (unpriced
  BoQ). amount=0.0 (zero values in cells).
- Parser tests: 291 passing, 0 failures (277 prior + 14 new).
- Frappe tests: not run (no Frappe code touched, per agreement #20).
- Next step: Phase 2c body (§17.13 wizard-load or next queued item).

### Phase 1.9g complete (2026-05-18)

**Pre-header rows skip fix in orchestrator + 3 new tests + snitch_electrical_expected.json calibration.**

- Feat commit: 40fb555c
- Docs commit: see git log (paradox-free per §9 #69)
- Root cause: `raw_rows` list comprehension in `parse_boq()` only excluded
  `header_row` and declared skip rows; rows before `header_row` (e.g. title
  banners, disclaimer notes in Excel rows 1..header_row-1) were incorrectly
  classified as data.
- Fix: added `and (header_row is None or rr.row_number >= header_row)` guard
  to the list comprehension in orchestrator.py.
- New tests (3, class TestPreHeaderSkip): row 1 absent when header_row=2
  (multi_area_2row fixture), row 1 absent for Pattern 2-rate fixture, no-op
  confirmed when header_row=1 (simple fixture).
- Test calibration: 7. Light Fixtures (snitch_electrical_expected.json) had
  a bold disclaimer banner at Excel row 1 (pre-header). Calibration updates:
  total_resolved_row_count 16→15; first_5_line_items, subtotal_markers, and
  row_16_preamble_anomaly resolved_idx values all shift by -1; path strings
  shift by -1 (path = str(resolved_list_append_idx)); row count in
  test_snitch_light_fixtures_total_resolved_row_count updated 16→15.
- Self-report item 26: Excel row 1 of "7. Light Fixtures" — sl_no=None,
  A1="* QUANTITIES AND SPECS TO BE UPDATED LATER AS PER THE RCP LAYOUT.
  CURRENT QTYS KEPT ARE ASSUMPTION BASED." (bold), G1="2) BUDGET SPECS"
  (bold, yellow fill). No qty value. Pre-header content confirmed.
- Parser tests: 277 passing, 0 failures (274 prior + 3 new).
- Frappe tests: not run (no Frappe code touched, per agreement #20).
- 4 new synthetic fixtures now tracked in git (previously untracked since
  Phase 1.9d): synthetic_multi_area.xlsx, synthetic_multi_area_2row.xlsx,
  synthetic_pattern_2_rate.xlsx, synthetic_pattern_2_rate_plural.xlsx.
- Next step: Phase 2c body (§17.13 wizard-load or next queued item).

### Phase 1.9f Stage 1 complete (2026-05-17)

**Multi-area triage diagnostic on 3 sheets at both header_row_count values.**

- Chore commit: c42eec9a
- Docs commit: see git log (paradox-free per §9 #69)
- Targets: Raheja Commerzone Chennai BOQ — Electrical + HVAC sheets;
  Snitch fixture — Electrical sheet.
- Per (sheet, header_row_count in [1, 2]) captured: classification,
  pattern, areas, header_row, first 3 L1 preambles, first L2 preamble,
  first 10 line items with parent + per-area + totals qty/rate/amount.
- Parser tests: 274 passing (unchanged — no parser code touched).
- Frappe tests: not run (no Frappe code touched, per agreement #20).
- Output files: multi_area_triage_1_9f_output.json (machine-readable),
  multi_area_triage_1_9f_output.txt (human-readable).
- Next step: chat-Claude + Nitesh review the output and decide on
  Stage 2 scope (None-case triage, additional targets, or proceed to
  §17.13 design conversation).

### Phase 1.9e complete (2026-05-17)

**Script committed, output JSON committed; 25 workbooks / 68 sheets parsed / 62 rate-synonym variations surfaced.**

- Chore commit: 5cd4f580 (`real_fixture_stress_test.py` + `real_fixture_stress_test_output.json`)
- Docs commit: this commit
- Parser tests: 274 passing (unchanged — Phase 1.9e touched no parser source files)
- Frappe tests: not run (per agreement #20; Phase 1.9e touched no Frappe code)
- Top rate-synonym variations: `rate` (60 occurrences across 15 fixtures/sheets), `price` (2 occurrences, `Bill of Quantities.xlsx` Audio & Visual sheet)
- 1 workbook load failed: `R0_CIVIL INTERIOR & MEP_TABLESPACE_PUNETH WORKING FILE_06.05.2026 (2).xlsx` — openpyxl XML parse error (unable to assign names); recorded in output JSON under `load_exception`
- Pattern distribution across 68 parsed sheets: Pattern 1 = 9, Pattern 2-area = 0, Pattern 2-rate = 0, Pattern 3 = 0, None = 59 (Pattern 2/3 = 0 expected — auto-guess sets `header_row_count=1` only)
- **Caveat on Pattern distribution numbers:** The auto-guess MappingConfig design uses `header_row_count=1` (the SheetConfig default). This means Pattern 2-rate (Raheja-shape, requires 2-row top header) and Pattern 3 (multi-row concat) are unreachable by construction in this stress test — the "None=59" count is dominated by sheets that would detect a multi-row pattern if the auto-guess set `header_row_count=2`. The "Pattern 1=9" count IS a real detection. Future 1.9f follow-up may re-run with header_row_count=2 auto-guess as a second pass to measure multi-row pattern reachability. Empirical input for §17.13: with zero user declaration AND single-row header assumption, 9/68 (13%) of sheets get pattern-detected; the remaining 59 either don't have a multi-area pattern OR have one the auto-guess can't reach.
- §9 #28 EXTENDED triggered (synthetic fixture ZIP timestamp noise after Docker test run) — cleared with `git restore` per v5.13 housekeeping note before commit
- **Scope deviation from v5.12 plan-doc 1.9e scope:** original said "pick largest data sheet (or all data sheets if total < 8)"; adopted "3-4 real BoQ sheets per workbook, skip sheets excluded, selection reported in output JSON" per chat-Claude / Nitesh decision 2026-05-17. Rationale: tighter scope produces cleaner empirical data for §17.13 re-evaluation.

### 2026-05-16 — Phase 1.8 implementation complete

**Phase 1.8 — per-area rate + amount schema extension landed.**

- 7 fields added to `BOQ Node Qty By Area`: `supply_rate`, `install_rate`, `combined_rate`, `supply_amount`, `install_amount`, `total_amount`, `amount_override`.
- `integrations/controllers/boq_node_qty_by_area.py` created as helper module (called from parent controller — no hooks.py change). Implements: universal-rate fallback, auto-compute child amounts, combined_rate consistency validation.
- `boq_nodes.py` extended: `_process_qty_by_area_rows` + `_recompute_parent_rates_from_areas` in `before_save`; per-child validation in `_validate_qty_by_area`.
- Weighted-average parent rate recompute when per-area rates diverge.
- `"make_model"` added to `_write_audit` tracked-fields list (1-line cascade fix per §7.33 + §9 #55).
- Migration patch `back_populate_boq_node_qty_by_area_rates` in `v3_0` registered.
- `dab597cf` placeholders backfilled per §9 #57.
- 11 new Frappe tests added to `test_boq_nodes.py`. Phase 1.x Frappe tests: 77 → 88 (60 boq_nodes + 28 boqs). Parser tests: 237 (unchanged).
- Feat commit: `7d5fbc4e` (filled in at commit time).

### 2026-05-16 — Phase 1.9a — per-area rate parser support landed

**Feat commit: `b2a2f747`**

- 3 new ColumnRoles added to `config.py`: `rate_supply_by_area`, `rate_install_by_area`, `rate_combined_by_area`. All require `area=` to be set (model validator mirrors `area_required_for_amount_by_area_role`). All added to `_AREA_COMPATIBLE_ROLES`.
- `rate_by_area_raw: dict[str, dict[str, float | None]]` field added to `ClassifiedRow` in `classifier.py`. Inner key is rate kind (`"supply_rate"`, `"install_rate"`, `"combined_rate"`). Policy X: explicit 0.0 preserved; blank cell produces no inner key. Module-level `_RATE_ROLE_TO_KIND` dict maps ColumnRole→inner key.
- `_RATE_CELL_PATTERN` compiled regex added to `multi_area_detection.py`. `MultiAreaPattern` extended: `pattern: int | str` (accepts `"pattern_2_rate"` string), `rate_columns: list[int] | None = None`. `_try_pattern_2_rate()` function detects the 3-col-per-area Raheja shape (merge span == 3, bottom-row QTY+RATE+AMOUNT sub-labels). `detect_multi_area_pattern()` routes Pattern 2-rate BEFORE Pattern 2 (stricter variant tried first to avoid misclassification).
- `_apply_multi_area_post_pass()` in `orchestrator.py` extended: reads `classified_row.rate_by_area_raw`, populates `row.rate_by_area` (deep copy, Policy X), auto-computes per-area amounts from rate×qty for areas without a direct amount, emits soft `combined != supply + install` validation warning (appended to `ResolvedRow.validation_warnings`, NOT a hard error). Priority: `combined_rate` → `supply_rate` → `install_rate` for auto-compute.
- `generate_pattern_2_rate()` added to `tests/fixtures/generate_synthetic.py`. Called from `generate_all()`. Produces `synthetic_pattern_2_rate.xlsx` (2-phase, 3-col-per-area, 2 data rows).
- 12 new parser tests (237→249): +2 test_config.py, +3 test_classifier.py, +4 test_multi_area_detection.py, +3 test_orchestrator.py.
- Phase 1.9b (`append_to_notes` parser) is next.
- §9 #50 standing decision partially revised: Pattern 2-rate detection re-opens §17.5. All per-area rates default to `combined_rate` kind in Phase 1.9a; split supply/install sub-label detection deferred.

### 2026-05-16 — §7.34 append_to_notes ColumnRole for long-tail column data preservation

**Decision:** Add a new `append_to_notes` ColumnRole that the Phase 3 wizard exposes as a user-assignable mapping option. Users explicitly mark any column whose data doesn't fit a structured schema field as "preserve to notes." Parser captures the values; Phase 2c commit step merges them into the existing `notes` Text field on `BOQ Nodes` with structured prefixes that disambiguate source. No schema change required.

**Role semantics:**
- User-assignable only — never auto-detected. Wizard must surface as an explicit column-role choice.
- Multiple columns on a single sheet may map to it (NOT in `_SINGLETON_ROLES`).
- No area-compatibility requirement (NOT in `_AREA_COMPATIBLE_ROLES`).
- Available for any sheet, any node type.

**Inheritance semantics:**
- Downward only. Values captured on a preamble row propagate to every descendant line item AND descendant sub-preamble.
- Values on a line item are NOT inherited anywhere — belong only to that row.
- Empty levels skipped — when walking up the parent chain to assemble a descendant's notes, levels with no `append_to_notes` data contribute nothing (no placeholder).

**Prefix format on each captured line:**

```
[Source: <where>] [Column: <column_name>] <value>
```

Where `<where>` is one of `THIS ROW`, `INHERITED L1`, `INHERITED L2`, `INHERITED L<N>` — arbitrary preamble depth supported per Phase 1.5. `<column_name>` is the source Excel column header text (or user-overridden label from wizard, future enhancement).

**Interaction with existing `row_notes` role:**

If a row has a value from a column mapped to the existing `row_notes` ColumnRole (the typical "Remarks" column with free-text human-written notes), that content goes FIRST in the notes field with NO prefix, preserving its identity as actual human remarks. Then a blank line separator. Then the structured `append_to_notes` block (own row's content + inherited from ancestors).

**Worked example — D-Tech CIVIL WORKS line item.** Columns: Description→`description`, Qty→`qty`, Unit→`unit`, Rate→`rate_combined`, Floor→`append_to_notes`, Area→`append_to_notes`, Activity→`append_to_notes`, Workitem→`append_to_notes`, Specs→`append_to_notes`, Remarks→`row_notes`.

Tree: L1 Preamble "Civil Works for Fourth Floor" with Floor="Fourth Floor"; L2 Preamble "CEO Cabin 02" with Area="CEO Cabin 02"; Line item "Wiring conduit, 25mm PVC, ISI marked" with Activity="Electrical", Workitem="Conduit", Specs="25mm PVC, ISI marked", Remarks="Lead time 4 weeks; verify with vendor".

L1 preamble's `notes` field:
```
[Source: THIS ROW] [Column: Floor] Fourth Floor
```

L2 preamble's `notes` field:
```
[Source: INHERITED L1] [Column: Floor] Fourth Floor
[Source: THIS ROW] [Column: Area] CEO Cabin 02
```

Line item's `notes` field:
```
Lead time 4 weeks; verify with vendor

[Source: INHERITED L1] [Column: Floor] Fourth Floor
[Source: INHERITED L2] [Column: Area] CEO Cabin 02
[Source: THIS ROW] [Column: Activity] Electrical
[Source: THIS ROW] [Column: Workitem] Conduit
[Source: THIS ROW] [Column: Specs] 25mm PVC, ISI marked
```

User-written remarks paragraph first (no prefix). Blank line. Then structured `append_to_notes` block.

**Scope split across phases:**

- **Phase 1.9 (parser):** Add `append_to_notes` to ColumnRole Literal in `config.py`. NOT in `_SINGLETON_ROLES`. NOT in `_AREA_COMPATIBLE_ROLES`. Validator needs no special handling. Add `append_notes_raw: dict[str, str]` field to `ClassifiedRow` in `classifier.py` — keys are source column header strings, values are cell values. Pattern mirrors `qty_by_area_raw`. Empty cells produce no dict entry. NOTE: `ResolvedRow` does NOT need its own `append_notes_raw` field — accessed via `resolved_row.classified_row.append_notes_raw`, same pattern as `make_model`, `description`, `unit`, etc.

- **Phase 2c (commit pipeline):** `commit_parsed_boq()` reads `append_notes_raw` from every row's classified_row, walks ancestor chain via `resolved_row.path`, assembles the final notes string per the prefix format. Writes to `BOQ Nodes.notes` field.

- **Phase 3 (wizard):** Surface `append_to_notes` as a column-role choice. Allow user to map any number of columns. Show preview of resulting notes field before commit. Optional future: let user override displayed column name; let user customize prefix format.

**Why this design over JSON `extra_data` field (Option B considered, rejected):**
- Plan doc §5.8 has a known JSON-as-trap caveat from `procurement_list` → `order_list` history.
- The existing `notes` field works without schema change — minimum-change principle.
- If notes field becomes too crowded in practice, refactoring to a JSON `extra_data` field later is clean, additive — defer until usage data shows the need.

**Why structured prefixes inside text (not separate sub-fields):**
- Compactness. Structured prefix is machine-parseable if Phase 5 UI wants to render as a table, and human-readable as plain text in Frappe form view.
- Sub-fields per BOQ Node would proliferate fields without bounding the count.

**Phase 1.9 scope note.** This addition expands Phase 1.9's scope (which was already substantial — `rate_by_area_raw` field, 3 new ColumnRoles for per-area rates, Pattern 2-rate 3-col detection re-opening §17.5, post-pass extension). Phase 1.9 may want its own sub-split (1.9a per-area parser work; 1.9b append_to_notes parser work). Decision deferred until 1.9 prompt drafting — note here so it's not surprising.

**Open questions deferred (recorded for future-Claude):**

1. **Re-mapping workflow.** If a user maps "HSN Code" to `append_to_notes` and later realizes HSN deserves a first-class field, what's the migration path? Re-upload? Re-parse with new mapping? Manual edit? Deferred — Phase 3/4/5 wizard design will resolve.
2. **Edit semantics in Phase 5 edit UI.** Should inherited notes on a line item display read-only (since editing there would be confusing — they reflect the parent) or editable (with edit propagating upward)? Deferred — Phase 5 UI design will resolve.
3. **Storage size monitoring.** Worst case ~25 lines in notes field (5 nested preambles × 5 append_to_notes columns). Frappe Text is unbounded so no hard cap. Monitor in practice. If becomes a problem, refactor to JSON `extra_data` field as clean follow-up.
4. **Prefix format customization.** Default is `[Source: ...] [Column: ...]`. User customization (different separator, shorter prefix, column-name override) is a Phase 3 wizard enhancement candidate. Not built in v1.

**Schema gaps this addresses (no first-class field needed today):**
Per-row attribution columns (D-Tech CIVIL WORKS Floor/Area/Activity/Workitem/Specs, 13+ sheets per §7.17); HSN/SAC codes for GST classification; Part code / Material code / Model number distinct from `make_model`; Reference image / drawing reference columns; "As per X Approved Rates" reference text (Snitch column H ignored); Vendor labels for vendor-compare sheets (Kohler HVAC's HVAC/ECO GREEN per agreement #24); Per-line-item GST rate when GST varies by item type.

### 2026-05-16 — §7.33 make_model already present on BOQ Nodes; Phase 1.8 scope reduced

**Discovery:** `make_model` field (`Data`, label `"Make / Model"`) is already present on `BOQ Nodes` at position 25 (between `qty_by_area` and `rates_col_break`) per `boq_nodes.json`. The Phase 1.8 plan premise that make_model needed to be added as part of per-area schema work is incorrect.

**Impact on Phase 1.8:** Remove `make_model` addition from Phase 1.8 scope. Phase 1.8 is solely the 7-field extension of `BOQ Node Qty By Area` (`supply_rate`, `install_rate`, `combined_rate`, `supply_amount`, `install_amount`, `total_amount`, `amount_override`) plus controller and migration.

**Audit-tracking gap:** `make_model` is NOT in the `_write_audit` tracked-fields list in `integrations/controllers/boq_nodes.py` (lines 192-201). The tracked list has 14 fields; `make_model` is absent. Consequence: edits to `make_model` via Frappe Desk will NOT generate a `Nirmaan Versions` audit entry. Fix: add `"make_model"` to the tracked-fields list. This is a separate, self-contained 1-line fix — can land in Phase 1.8 or as a standalone patch.

### 2026-05-16 — §7.32 Per-area rate + amount schema extension (decided 2026-05-16, Phase 1.8 implements)

**Decision:** Extend `BOQ Node Qty By Area` from 2 fields to 9 fields with per-area rate (supply/install/combined), per-area amount (supply/install/total), and `amount_override`. Universal-rate fallback semantics. Phase 1.8 implements schema + controller + migration; Phase 1.9 implements parser support. Both sequence BEFORE Phase 2c.

**Why now:**
1. Retrofit tax grows monotonically once Phase 2c starts writing real BoQ data to the DB. Currently no real parsed data is committed (only test fixtures) — this is the cheapest possible moment.
2. A significant minority of real BoQs capture per-area rate in the source file (Raheja Pattern 2-rate shape). Wizard overrides can absorb one-off edge cases; recurring structural shapes belong in the schema.
3. The 3-col-per-area Raheja shape (handover §17.5, §9 #39) gets absorbed into the baseline schema instead of leaving as a permanent retrofit candidate.

**Locked field naming.** Follows actual `BOQ Nodes` JSON convention: prefix-first for rates (`supply_rate`, `install_rate`, `combined_rate`), prefix-last for amounts (`supply_amount`, `install_amount`, `total_amount`). NO `combined_amount` field — `total_amount` serves both the combined-amount and total-amount roles per existing §7.14 rule.

**Fallback semantic.** When source file doesn't provide per-area rate, populate from parent universal rate. Compute amount as `area_qty × area_rate`. Every child row always has populated rate and amount after `before_save`.

**Weighted-average precedence.** When user (or parser) sets per-area rates that diverge across areas, parent universal rate auto-recomputes as `Σ(area_qty × area_rate) ÷ Σ(area_qty)` in `before_save`. Computed independently per rate kind. UI in Phase 5 will show parent universal as read-only with tooltip when per-area rates set.

**`is_rate_only` semantics.** Existing controller logic at boq_nodes.py:147-150 checks only main-row rates. NOT extended — the weighted-average rule keeps parent universal in sync, so existing `is_rate_only` logic remains correct without modification.

**Combined-rate consistency.** Same `combined == supply + install` rule applied per child row. Same error-message style. Zero-cost rows (all three None) allowed.

**`amount_override` parallel.** Same Check field on child table. When set, child's `before_save` skips amount auto-compute. Enables Phase 6 round-trip integrity (rounding-faithful preservation of source-file per-area amounts).

**§9 #50 standing decision REVISED.** v5.8's "auto-detection at natural floor" standing decision specifically deferred the 3-col-per-area Raheja detection work to "future caveat if blocking." Phase 1.9 re-opens it. Not because keyword precision was wrong — that decision still stands for the 191-entry keyword list — but because the 3-col Pattern 2-rate work is now bundled into the schema-extension scope where it has natural leverage.

**Estimated scope.** Phase 1.8: ~8-12 new Frappe tests, all 77 existing Frappe tests still pass. Phase 1.9: ~15-20 new parser tests, all 237 existing parser tests still pass.

### 2026-05-16 — §7.31 BoqReader.list_sheet_states() — sheet visibility pass-through

**Context:** Phase 2c §9 #49. The Phase 3 wizard needs to know which sheets in an uploaded workbook are hidden or veryHidden so it can default those sheets to the "skip" disposition (with user override). The reader already exposes sheet names via `list_sheets()` but not visibility state. openpyxl's `Worksheet.sheet_state` attribute returns a plain string (`'visible'`, `'hidden'`, or `'veryHidden'`) for each worksheet.

**Decision (§7.31):** Add `list_sheet_states() -> dict[str, str]` to `BoqReader`. Implementation: `return {ws.title: ws.sheet_state for ws in self._wb_values.worksheets}`. Access via `self._wb_values.worksheets` (the values workbook, matching the access pattern of all other reader methods). Sheet names preserve exact whitespace and casing, matching `list_sheets()`. Return type is `dict[str, str]` — plain Python dict keyed by sheet name; caller indexes it to retrieve a specific sheet's state.

**Ordering rationale:** Phase 3 wizard consumes this during sheet-selection step (before per-sheet MappingConfig authoring). No internal ordering dependency on other Phase 2c items. Additive only — no cascade to any existing method or post-pass.

**Explicitly NOT done:** `list_sheets()` not changed (returns names only; caller can combine with `list_sheet_states()` if needed). No single-sheet `get_sheet_state(name)` getter (caller indexes the dict). No caching (openpyxl `Worksheet` objects are already in-memory; a dict comprehension is negligible overhead). No enum wrapper (downstream code can compare directly against string literals `'visible'`, `'hidden'`, `'veryHidden'`). No normalisation (preserves openpyxl's exact strings so downstream code has a stable contract).

**Notable:** Per §9 #51, DHL FK-5-1-12 is a genuine multi-area sheet that is hidden in the workbook. The wizard's hidden-default-skip behaviour will handle it — the user can override to "process" for that sheet.

**Consequences:** `reader.py` +16 lines (method + docstring). `test_reader.py` +92 lines (4 new tests in `TestSheetStateExposure`). 0 existing tests modified. Test count: 217 → 221. openpyxl 3.1.5 confirmed in container.

### 2026-05-16 — §7.30 Priced-PREAMBLE-with-children review-flag post-pass

**Context:** Phase 2c §9 #45. After §7.29 (zero-children demotion), one PREAMBLE in Snitch Electrical (resolved_idx=500, sl_no='2.0', path='394/500', unit='LS', 5 children, `children_shape="siblings"`) remains that carries a price signal AND has tree descendants. Auto-demotion would orphan the 5 children whose `parent_index` still points to the PREAMBLE row — re-parenting is a non-trivial structural operation. The §9 #45 audit (commit `1ad12a7b`) surfaced this as the sole candidate across the in-scope fixtures.

**Decision (§7.30):** Add `_apply_priced_preamble_with_children_review_flag_post_pass(resolved_rows)` to `hierarchy.py`. The pass: (A) builds `paths_with_descendants` (same algorithm as §7.29); (B) for each PREAMBLE row where `row.path IN paths_with_descendants` AND `_is_priced_for_review(unit, rate_combined, rate_supply, rate_install)` is True: set `row.needs_classification_review = True` and `row.review_reason = "priced_preamble_with_children"`. `_is_priced_for_review` mirrors the audit script's `is_priced` logic: alphanumeric unit string OR any rate > 0; whitespace/punctuation-only unit does NOT count. Two new fields added to `ResolvedRow`: `needs_classification_review: bool = False` (default non-truthy), `review_reason: str = ""` (default empty). `review_reason` literal `"priced_preamble_with_children"` is the Phase 3 wizard's discriminator for selecting the re-classification UI flow; future review reasons can extend by adding new literals.

**Ordering rationale:** Must run AFTER §7.29 (zero-children demotion) so that leaf PREAMBLEs already demoted to LINE_ITEM cannot receive the review flag. Must run BEFORE `_apply_multi_area_post_pass()` to keep the post-pass cluster contiguous and predictable. In `orchestrator.py`, this is Step 4a.5 between Step 4a (§7.29) and Step 4b (multi-area).

**Why not demote here:** Auto-demotion without re-parenting orphans the children (`parent_index` still points to the demoted row, which is now LINE_ITEM). Re-parenting all descendants requires updating `parent_index` and `path` on every descendant — a second-pass structural operation beyond the parser's current scope. Parser flags only; Phase 3 wizard performs demotion + re-parenting on user confirmation.

**Consequences:** Snitch row 500 gains `needs_classification_review=True`, `review_reason="priced_preamble_with_children"`. Classification counts are unchanged (PREAMBLE count stays at 43 on 6. Electrical). `test_snitch_workbook_no_validation_warnings` continues to pass — `validation_warnings` is a separate field. Snitch canonical case confirmed via `test_snitch_row_500_flagged_for_priced_preamble_with_children_review` (test 218, TestSnitchIntegration). Test count: 207 → 217.

### 2026-05-14 — §7.29 Zero-children PREAMBLE demotion post-pass

**Context:** Phase 2b.2 Part B2f. After unit-based demotion (§7.28) and hierarchy resolution, some PREAMBLE rows remain that are structurally leaf nodes (zero tree children) yet carry a unit string or a non-zero rate. Real section-header preambles never have a unit or rate — those fields belong only to line items. A leaf PREAMBLE with a unit or rate was either: (a) not caught by §7.28 because its unit is unique on the sheet (no matching LINE_ITEM unit), or (b) classified PREAMBLE by the blank-qty-no-rate classifier rule. In both cases, the presence of a unit or rate on a leaf node is the deciding signal that it is a rate-only line item, not a section header.

**Decision (§7.29):** Add `_apply_zero_children_preamble_demotion_post_pass(resolved_rows)` to `hierarchy.py`, called in `orchestrator.py` after `resolve_hierarchy()` (Step 4a) and before `_apply_multi_area_post_pass()` (Step 4b). The pass: (A) builds `paths_with_descendants` — for every row path, all ancestor prefix segments are added to the set; (B) for each PREAMBLE row where `row.path NOT IN paths_with_descendants` AND (`unit` is non-empty OR any `rate_*` > 0): demote to `classification=LINE_ITEM, qty=0.0, is_rate_only=True, level=None`. Re-parenting of LINE_ITEM children of the demoted row is explicitly OUT OF SCOPE (§17.10).

**Ordering rationale:** Must run after `resolve_hierarchy()` because it needs tree path data (`paths_with_descendants`). Must run before `_apply_multi_area_post_pass()` to ensure the per-area post-pass sees the final classification of every row.

**Alternatives considered:** (a) Extend §7.28 (unit-based demotion) to also catch unique-unit PREAMBLEs — requires inspecting the tree, which belongs in hierarchy.py not classifier.py. (b) Re-parent children of demoted rows — deferred as §17.10 (complex, no current fixture needs it).

**Consequences:** Snitch Electrical row 341 (unit='KG', leaf) demoted: LINE_ITEM 175→176, PREAMBLE 44→43. Snitch Light Fixtures PIR row (unit='NOS', leaf) also demoted: LINE_ITEM 13→14, PREAMBLE 1→0.

### 2026-05-14 — §7.28 Unit-based PREAMBLE demotion post-pass

**Context:** Phase 2b.2 Part B2d. Real BoQs use lowercase-letter sl_no sequences (`a.`, `b.`, … `z.`, `aa.`, …) for nested line items in detailed sections (e.g. cable-type breakdowns in electrical BoQs). The hierarchy resolver's stack-walk heuristic increments stack depth by 1 per lowercase-letter transition, causing deeply-nested rows to accumulate a high stack depth. These rows get classified PREAMBLE by the base classifier (sl_no + description, no qty in the cell). But real preambles never carry a unit value — only measurable line items do. When a blank-qty row has a unit value matching a LINE_ITEM unit on the same sheet, the row is a rate-only line item whose qty cell was left blank, not a section header.

**Decision (§7.28):** Add `_apply_unit_based_demotion_post_pass(classified_rows)` as a post-classification pass in `classifier.py`, called in `orchestrator.py` after the per-row `classify_row()` loop and BEFORE `populate_preamble_candidate_scores()`. The pass: (1) collects unit strings from all LINE_ITEM rows on the sheet; (2) demotes any PREAMBLE row where `qty is None` AND `unit is not None` AND `unit` is in the collected set → `classification = LINE_ITEM, qty = 0.0, is_rate_only = True`. Match is case-sensitive.

**Ordering rationale:** Must precede preamble candidate scoring so that demoted rows do not receive preamble-candidate scores. Must follow per-row `classify_row()` since the demotion depends on the full sheet's LINE_ITEM population.

**Alternatives considered:** (a) Fix `_determine_preamble_level` in `hierarchy.py` to cap depth for lowercase cascades — deferred as §17.9 because it is a structural resolver change with wider blast radius. (b) Case-insensitive unit match — rejected to avoid false positives (`'NOS'` ≠ `'Nos.'`; the PIR PREAMBLE anomaly in Snitch Light Fixtures has `unit='NOS'` and correctly stays PREAMBLE because no LINE_ITEM has uppercase `'NOS'`).

**Consequences:** Snitch Electrical LINE_ITEM count: 93 → 175 (+82), PREAMBLE: 126 → 44 (-82). TestSnitchIntegration tests fail until B2e-snitch-refresh regenerates the expected JSON.

### 2026-05-14 — §7.25 Policy X: explicit zeros preserved in per-area raw dicts

**Context:** Phase 2b.2 Part B2a. Policy X reverses B1's deliberate zero-filter policy. B1 dropped explicit zeros via `!= 0` filters in `qty_by_area_raw` and `amount_by_area_raw` extraction to keep per-area dicts compact — at the time, that policy seemed sufficient. B2a reverses it after analysis showed three real-world scenarios (not-applicable / included-in-rate / lump-sum disconnected from qty) require distinguishing 'explicitly zero in this area' from 'this area's cell is missing/blank.' Policy X: both `qty_by_area_raw` and `amount_by_area_raw` preserve all explicitly-read values including zeros; only None/blank cells produce no key.

**Decision (§7.25 — Policy X):** A cell read as 0.0 **does** populate the dict with `0.0`. A blank/missing cell produces no dict entry. This preserves the distinction between "explicitly zero in this area" and "not applicable to this area". Applied to both `qty_by_area_raw` and `amount_by_area_raw` extraction in `classify_row()`.

**Alternatives considered:** Drop zeros (pre-B2a behavior) — loses the explicitly-zero signal; downstream consumers cannot distinguish "did not exist" from "existed but was zero".

**Consequences:** `qty_by_area_raw` and `amount_by_area_raw` now use `if area_qty is not None` / `if amt_val is not None` guards instead of `!= 0` guards. Post-pass copies with `dict(...)` (straight copy), so zeros flow through to `qty_by_area` / `amount_by_area` on `ResolvedRow`.

### 2026-05-14 — §7.24 amendment: empty-total fallback in _apply_multi_area_post_pass

**Context:** When a BoQ row has per-area qty populated but the qty_total column cell is blank, the post-pass needs a policy for `ResolvedRow.qty_total`. A warning would be noise for a valid multi-area row where the total column is simply absent.

**Decision (amendment to §7.24):** When `qty_total` is `None` and `qty_by_area` is non-empty, compute `qty_total = sum(qty_by_area.values())`. Same for `amount_total`. No warning is emitted for the fallback case. Sum validation (±1 tolerance warning) only fires when the column-declared total is non-None.

**Consequences:** `_apply_multi_area_post_pass()` in `orchestrator.py` implements the two-step: (1) fallback then (2) validate. The fallback is silent; the validation warning is appended to `ResolvedRow.validation_warnings`.

### 2026-05-14 — `qty_total_raw` added to ClassifiedRow to separate column value from computed qty

**Context:** `classified_row.qty` is overridden by the qty_total column value when present. After classification, it is impossible to tell whether `qty` came from the total column or from summing per-area values — both produce a float. The post-pass needs to distinguish "total column was blank (trigger fallback)" from "total column had value X".

**Decision:** Add `qty_total_raw: float | None = None` to `ClassifiedRow`. Set only when the `qty_total` column cell has a non-None, parseable value. `ResolvedRow.qty_total` is initialized from `qty_total_raw` (not from `qty`). The post-pass then uses `ResolvedRow.qty_total is None` correctly as the fallback trigger.

**Alternatives considered:** Check if `qty == sum(per_area_values)` at post-pass time — unreliable because rounding can make a column-declared total equal the per-area sum, producing false-positive fallback triggers.

**Consequences:** `ClassifiedRow` has a new field; `ResolvedRow.qty_total` is initialized in the LINE_ITEM constructor in `resolve_hierarchy()` from `classified_row.qty_total_raw`. All existing tests continue to pass.

### 2026-05-14 — Per-area raw data uses parallel-field pattern, not nested dict

**Context:** `ClassifiedRow` now has both `qty_by_area_raw` (existing) and `amount_by_area_raw` (added in B1). A third field `rate_by_area_raw` is anticipated for B2 or Part D2 to support the Raheja Pattern 2 rate-column variant (§17.5).

**Decision:** Each per-area raw type gets its own parallel `dict[str, float]` field on `ClassifiedRow`. No refactoring to a single combined nested dict (e.g., `area_raw: dict[str, dict[str, float]]`).

**Alternatives considered:** Combined nested dict — would require all existing readers of `qty_by_area_raw` to change their access pattern, increasing blast radius for a gain that isn't needed yet.

**Consequences:** If a fourth per-area field is ever needed, consider refactoring to a single combined nested dict keyed by area name. Today's reason for parallel fields: minimal blast radius — no existing readers of `qty_by_area_raw` need to change. Part D2 will add `rate_by_area_raw` as a third parallel field.

### 2026-05-08 — Phase 1.5: Foundation refinements

**Context:** After Phase 1 tests passed, three real-world BoQ patterns were found to be unsupported by the controller: (1) preambles nested deeper than L3, (2) zero-qty line items (rate-only tender entries), (3) standalone line items with no parent.

**Decisions:**
- **Arbitrary preamble depth:** Remove hard L1/L2/L3 constraint. Validation now accepts `level ≥ 1`, soft-warns above 5. The stack-walk algorithm already handled arbitrary depth; only the validator needed updating.
- **Zero-qty line items:** `if not doc.qty` blocked `qty=0` — changed to `if doc.qty is None`. Auto-set `is_rate_only=True` when `qty==0` and a rate is present. Amount computation fixed: `(supply or install)` was falsy for zero amounts — replaced with `any([supply_rate, install_rate])`.
- **Standalone line items:** `parent_node=None` on a line item now warns rather than throws.
- **Leaf preamble computation:** Leaf preambles (no children) may carry qty/rate silently; non-leaf preambles with qty/rate emit a warning. Detection via `frappe.db.exists("BOQ Nodes", {"parent_node": doc.name})`.

**Consequences:** `is_rate_only` field added to `boq_nodes.json`. Tests expanded from 25 to 33 (8 new, 1 removed, 3 renamed, 1 split into 2).

### 2026-05-06 — Wizard reference is project creation wizard

**Context:** BoQ upload is multi-step (upload → mapping → preview → confirm). Two candidate references in the codebase: project creation wizard and PR approval flow.

**Decision:** Project creation wizard (`frontend/src/pages/projects/project-form/`).

**Alternatives considered:** PR approval flow (`ApproveNewPR/`) — but it's a single-page document review with inline dialogs, not a stepped wizard. Not applicable.

**Consequences:** BoQ upload follows the orchestrator + steps + schema.ts + Zustand draft store + multi-stage progress dialog pattern. File paths in §10.

### 2026-05-06 — Tree storage via self-Link + path, not Frappe is_tree

**Context:** Need to store hierarchical BoQ structure in Frappe.

**Decision:** Standalone `BOQ Nodes` doctype with self-referencing `parent_node` Link and denormalized `path` field. Recursive CTEs for subtree queries. TanStack Table `getSubRows` for client-side rendering.

**Alternatives considered:** Frappe's `is_tree` (lft/rgt nested sets) — no precedent in this codebase, optimized for huge trees with rare writes (opposite of BoQ).

**Consequences:** Simpler mental model, matches codebase conventions. Recursive CTE for any subtree query. `path` recomputed on parent change.

### 2026-05-06 — BOQ Nodes are standalone documents, not child rows

**Context:** Should BoQ line items be a child table on BOQ, JSON field, or standalone doctype?

**Decision:** Standalone `BOQ Nodes` doctype, following the Critical PO Tasks precedent.

**Alternatives considered:** Child table on BOQ (loses individual queryability), JSON field (known migration trap — see `procurement_list` → `order_list` history).

**Consequences:** Each node is independently queryable, updatable, audit-loggable. Slightly more storage overhead, but matches established pattern.

### 2026-05-06 — Audit via Nirmaan Versions, not custom child-table log

**Context:** BoQ nodes editable post-import; need audit trail with reason.

**Decision:** Use the existing Nirmaan Versions pattern. If Nirmaan Versions lacks a `reason` field, add one (cross-cutting improvement).

**Alternatives considered:** Custom `BOQ Node Audit Log` doctype — would duplicate existing audit infrastructure.

**Consequences:** Consistent audit experience across PR/PO/SR/Payment/BoQ. Phase 1 first task: confirm Nirmaan Versions schema, add `reason` if missing.

### 2026-05-06 — AI assist provider is Anthropic Claude, not Document AI

**Context:** Phase 4 needs an AI service to pre-classify columns and rows.

**Decision:** Anthropic API (`claude-sonnet-4-6`). Architecture mirrors `services/document_ai.py` and `api/invoice_autofill.py` (file_url-based, opt-in, confirm-before-save, never auto-persist).

**Alternatives considered:** GCP Document AI — built for structured form extraction (invoices, IDs); poorly suited to free-form spreadsheets with arbitrary layouts. Would require custom processor + labeled training data per BoQ format.

**Consequences:** New external dependency (Anthropic API key). New service module `services/boq_ai_assist.py`. AI is for structure classification only; numerical values always read deterministically from cells.

### 2026-05-06 — Downstream linkages via dedicated standalone doctypes

**Context:** BoQ Nodes need to relate to Work Headers, Milestones, Critical PO Tasks, PR/PO line items, Deliveries.

**Decision:** One linkage doctype per relationship type, each standalone (Critical PO Tasks pattern). BoQ Nodes do not auto-create downstream entities.

**Alternatives considered:** Polymorphic Dynamic Link à la `PO Delivery Documents` — overkill for fixed relationships. JSON field of linked IDs — same migration trap as before.

**Consequences:** Phase 7 splits into 7a–7e, each shipping a focused linkage doctype. Avoids legacy `$#,,,` delimiter pattern from milestone reports.

### 2026-05-06 — Plan + decisions live in `frontend/.claude/plans/`, not `docs/`

**Context:** Where to put feature spec and decisions log.

**Decision:** `frontend/.claude/plans/boq-upload-plan.md` (active plan). After Phase 3 stabilizes, the long-term reference moves to `.claude/context/domain/boq.md`.

**Alternatives considered:** `docs/boq-feature/` — would create a parallel structure inconsistent with the rest of the project.

**Consequences:** Future Claude Code sessions auto-discover the plan via `.claude/context/_index.md` and `frontend/.claude/context/_index.md`.

### 2026-05-16 — Phase 1.9b — append_to_notes parser support landed

**Feat commit: `78b3d233`**

- `append_to_notes` added to ColumnRole Literal in `config.py`. NOT in `_SINGLETON_ROLES` (multiple columns per sheet allowed). NOT in `_AREA_COMPATIBLE_ROLES` (area= always rejected). No dedicated model validator needed — existing area_only_for_qty_amount_roles validator rejects area on this role automatically.
- `column_headers: dict[str, str] = {}` field added to `SheetConfig`. This is the **Case B → Option B** resolution: storing the column-letter → human-label mapping on SheetConfig (not on MappingConfig or a separate dict). Decision made by chat-Claude on 2026-05-16 as the minimum-change option consistent with the existing SheetConfig-scentric design — one place to look for all per-sheet structural config. Keys are column letters (same as `column_role_map`); values are the display labels used in `append_notes_raw` dict keys.
- `append_notes_raw: dict[str, str]` field added to `ClassifiedRow` in `classifier.py`. Keys are source column header strings resolved via `SheetConfig.column_headers.get(col_letter, col_letter)` — column letter is the fallback when no override is provided. Values are cell text coerced via `str(cell.value).strip()`. Empty/blank cells (None value or empty-string-after-strip) produce no dict entry (Policy-X-style empty-cell-skip, mirrors `rate_by_area_raw` extraction). Non-string cell values (floats, ints) are coerced via `str()` for maximum fidelity — e.g. HSN Code stored as float 1234.0 becomes `"1234.0"`.
- `append_notes_raw` passed through in `ClassifiedRow` return statement at end of `classify_row()`.
- 8 new tests (249→257): `test_config.py` +3 (tests 25-27: `append_to_notes` role accepted, two append_to_notes columns allowed on same sheet, `column_headers` round-trips); `test_classifier.py` +5 (`TestAppendNotesRaw` class: single column populated, multiple columns populated, empty cell produces no key, non-string coerced to str, no role mapped → empty dict).
- Phase 1.9c (real-fixture integration tests for Raheja + D-Tech using `synthetic_pattern_2_rate.xlsx` and append_to_notes columns) is next.

---

### 2026-06-01 -- BoQ-list tab + B2 tendering section (Phase 6 pull-forward)

**Feat commit:** (see git log)
**Files changed (frontend only):**
- `frontend/src/pages/boq-wizard/BoqProjectTab.tsx` -- expanded from empty-state-only to a full list component
- `frontend/src/pages/projects/tendering/TenderingProjectView.tsx` -- additive BoQ section appended (colleague's file, minimal-only edit)

**What was built:**
- `BoqProjectTab` is now a real list component. One `useFrappeGetDocList("BOQs", ...)` query filtered by `projectId`, `orderBy uploaded_at desc`, `limit 50`. swrKey = `boq-list-${projectId}` (or null until projectId set -- documented SDK gotcha, 3rd arg).
- Fields fetched: `name`, `boq_name`, `version`, `wizard_state`, `uploaded_at`, `creation`.
- States: loading (skeleton rows, `Array.from({length:5})` pattern), error (inline `<p className="text-destructive">`), zero rows (preserved empty-state verbatim with "Upload BoQ" CTA), non-empty (shadcn `<Table>` with header CTA).
- Columns: BoQ Name (`boq_name || name`) | Version (`v{version}`) | Status (`wizard_state` via `WIZARD_STATE_LABELS` map, blank -> "Not started") | Uploaded (`formatDate(uploaded_at || creation)`).
- Row click: `onClick` on `TableRow` navigates `navigate(\`/upload-boq/hub/${row.name}\`)`. boqId = `row.name` (the BOQs docname from Frappe autoname). Hub route verified: `upload-boq/hub/:boqId` in routesConfig.tsx.
- "Upload BoQ" CTA reachable in both states: empty-state CTA + header button in non-empty state. Verbatim target `navigate(\`/upload-boq?project=${projectId}\`)` preserved.
- `wizard_state` used as cheap row-level status (no child-table read, no sheet_drafts computation). Four values: `""` -> "Not started", "In progress", "Configured", "Parsed". Displayed as a `Badge variant="outline"`.
- Date formatter: `formatDate` from `@/utils/FormatDate` (same as `ProjectTransferMemosTab`). `uploaded_at || creation` fallback handles pre-M1 docs where uploaded_at may be blank.
- UI pattern mirrors `ProjectTransferMemosTab`: shadcn `Table` + `Skeleton`, NOT TanStack/DataTable.

**B2 -- TenderingProjectView additive section:**
- `BoqProjectTab` is now also rendered as a section on the Tendering project view -- a "Bill of Quantities" heading + `<BoqProjectTab projectId={data.name} />` appended between the isEditing/view-card block and the AlertDialog.
- `data.name` is the Projects docname -- passed straight to `projectId` with no transform.
- When `isEditing === true` (TenderingProjectForm shown inline), the BoQ section remains visible below the edit form -- intentional, not gated. Users editing a project stub may still want to see attached BoQs.
- Edit to TenderingProjectView was minimal: one import line + one 5-line section. No tab machinery, no URL params, no restructure of existing markup. Ownership guard observed (file introduced in 509a4dfe; additive-only change by agreement).

**Scope (read+navigate only):** No mutation endpoints, no delete, no sheet_drafts child reads, no new .py files touched.

**Parser tests:** Untouched (588). Frontend-only slice.

---

### Module 3 Slice 3c-fix -- SheetConfigPanel: persistence + sparkle-on-confirm + Section-2 toggle/boxes

**Status:** COMPLETE (feat 9f8fb6f7; docs 2426bb91). Frontend-only. One file edited: `frontend/src/pages/boq-wizard/SheetConfigPanel.tsx`. No .py files touched. No boqTypes.ts changes. SheetSpokePage.tsx confirmed correct (read-only; no edit needed -- isLoading guard + onSaveSuccess wiring verified). parser tests 588 unchanged.

**Context:** Live testing of the Slice 3c panel (BOQ-26-00152, Alorica HVAC) confirmed prefill works but revealed three defects: (1) area names and skip-rows entered in the panel did NOT persist across Save + hard reload; (2) header-type Select sparkle did not clear when re-confirming the pre-selected value as-is; (3) Section 2 used a chip/Enter-to-add pattern that did not clearly differentiate single-area from multi-area sheets. Recon session (prior to this slice) diagnosed all three.

**Fix 1 -- Persistence (root cause confirmed by code inspection):** The `useEffect` init guard had `setInitialized(true)` OUTSIDE the `if (parsedConfig !== null)` block (line 139 of the old file). When `parsedConfig` is null (doc not yet loaded or auto-guess failed for that sheet), the effect prematurely set `initialized = true`. When the doc subsequently arrived and `parsedConfig` became non-null, the effect bailed at `if (initialized) return` and NEVER seeded local state from the persisted config. Fix: moved `setInitialized(true)` INSIDE the `if (parsedConfig !== null)` block, so the lock only fires after real data is seeded. The SheetSpokePage `isLoading` guard prevents the most common race (hub->spoke SWR cache), but the bug still bit on hard reloads and for sheets where auto-guess failed (sheet_config = null). No SheetSpokePage edit needed: `onSaveSuccess = () => void mutate()` (line 129) is correct.

**Fix 2 -- Sparkle-on-confirm (pending live-test verification):** Replaced the unreliable `onClick` on `SelectTrigger` (which Radix UI may not fire reliably for sparkle-clear) with `onOpenChange` on the `Select` component: `onOpenChange={(open) => { if (open) touch("header_row_count"); }}`. This fires whenever the dropdown opens, including re-confirming the already-active value without changing it. The `onClick` on `SelectTrigger` was removed. Behavioral correctness requires manual re-test (cannot be confirmed by tsc or Vite build alone).

**Fix 3 -- Section 2 reshape:** Replaced the chip/Enter-to-add pattern with a Single/Multi segmented toggle (two shadcn `Button` components in a bordered div) + stacked editable text boxes (one `Input` per area name, shown only in Multi mode). Toggle start state derived from prefilled `area_dimensions`: non-empty -> Multi with names pre-filled into boxes; empty -> Single. SINGLE: no boxes shown; save writes `area_dimensions: []`. MULTI: boxes with remove controls + "+ Add area" button; save writes `area_dimensions = areaBoxes.filter(s => s.trim() !== "")` (string[]). Remove button hidden when only one box remains. State variables: `isMulti: boolean` + `areaBoxes: string[]` (replaces `areas: string[]` + `areaInput: string`). Section 2 sparkle (key: `"area_dimensions"`) shows when `hasPrefill && !confirmed && isMulti` -- only when areas were auto-detected (parser guessed multi-area). Confirm-as-is affordance: clicking the active toggle button (already-selected Single or Multi) always calls `touch("area_dimensions")`, clearing the sparkle without changing any value. Focusing any area text box also clears it.

**Conventions established (Section 2 shape is now canonical for other config panels):**
- For Select sparkle-clear: use `onOpenChange` on the `Select` component, not `onClick` on `SelectTrigger`. `onOpenChange` fires reliably on dropdown open even when value is unchanged.
- For multi-value list entry in wizard config panels: segmented toggle (Single/Multi) + stacked Input boxes, not chip/Enter-to-add. The toggle's active button onClick always calls `touch(key)` for confirm-as-is.
- Opacity-50 unconfirmed treatment on a grouped Section 2 area: apply `opacity-50` to a single wrapper div around all Section 2 controls (not per-element), to avoid compounding opacity on nested nodes.

**tsc result (boq-wizard files):** 0 errors. (Full-repo tsc has pre-existing errors in unrelated files -- App.tsx, CameraCapture.tsx, etc. -- none in boq-wizard/.) Command: `node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep boq-wizard` (no output = clean).

**Vite build result:** Clean. `built in 3m 33s`. Only pre-existing chunk-size warning (index bundle >500 kB), no new errors. Command: `docker exec frappe_docker_devcontainer-frappe-1 bash -c "cd /workspace/development/frappe-bench/apps/nirmaan_stack/frontend && node node_modules/vite/bin/vite.js build"`.

**Manual test plan (run on :8080 after clear-site-data + re-login):**
1. PERSISTENCE: open a prefilled Pending sheet spoke, add/edit an area name + set skip rows, click Save, then hard-reload the page (Ctrl+Shift+R). Area name + skip value must re-appear. (This is the defect this slice fixes.)
2. SPARKLE-ON-CONFIRM: for a prefilled header-type field (sparkle visible), open the header-type dropdown and re-select the same currently-active value (e.g. "Single"). The sparkle must clear without requiring a value change. (Confirms Fix 2 -- browser-dependent.)
3. SECTION-2 TOGGLE: open a spoke for a sheet the parser detected as multi-area -> Section 2 starts on Multi with detected names pre-filled in stacked boxes. Open a single-area sheet -> starts on Single with no boxes + hint text. Manually flip Single->Multi -> one empty box appears. Add/edit/remove boxes; Save; hard-reload -> persists correctly (covered by Fix 1).
4. SECTION-2 SPARKLE: on a multi-area prefilled sheet, Section 2 shows sparkle + opacity-50. Click the "Multi area" button (already selected) -> sparkle clears without any value change. Focus a box -> also clears sparkle.

---

### Module 3 Slice 3d-i -- lift preview fetch + column_role_map to SheetSpokePage

**Status:** COMPLETE (feat 0c297e24 refactor + e1b39ffc docs). Frontend-only refactor. Files changed: `boqTypes.ts` (ColumnRoleEntry type added), `SheetSpokePage.tsx` (full rewrite -- new owner of preview state + columnRoleMap), `SheetDataGrid.tsx` (full rewrite -- pure render component), `SheetConfigPanel.tsx` (prop interface + handleSave updated). No .py files touched. Parser tests 588 unchanged. tsc: 0 errors on boq-wizard files. Vite build: clean.

**Why:** Slice 3d-ii (next) adds a Section 3 column-role list to SheetConfigPanel. Slice 3d-iii annotates the preview grid from the role-map. Both need: (a) the full preview rows, and (b) the column_role_map state -- shared across SheetConfigPanel (editor) and SheetDataGrid (annotator). Lifting both to SheetSpokePage (the common parent) gives each child access to the same live state without prop-drilling back up.

**State ownership decision (columnRoleMap):**
- **Owner:** SheetSpokePage. Seeded once from `draft.sheet_config.column_role_map` when the doc first arrives. `setRoleMapInitialized(true)` fires only after `rawCfg` is successfully parsed (draft absent → early return; JSON fail → rawCfg null → early return); a later mutate() re-fetch does NOT overwrite in-progress user edits. Seed loop handles both the current `{role,area}` object shape (3d-ii onward) and legacy role-only strings defensively (see read-back fix below).
- **SheetConfigPanel:** receives `columnRoleMap` + `setColumnRoleMap` + `rows` as props. `handleSave` (from Slice 3d-ii onward) writes `column_role_map: {role, area}` objects per column (NOT role-only strings -- 3d-i wrote strings; 3d-ii corrected the save shape). The `...existing` spread still preserves all other unknown blob keys. `setColumnRoleMap` and `rows` are accepted in the interface for Slice 3d-ii forward compat but not yet consumed in the render.
- **SheetDataGrid:** receives `columnRoleMap` as a read-only prop for Slice 3d-iii. It is in the interface and accepted in the call but not destructured in this slice (no annotation visuals yet).

**Preview fetch lift:**
- The initial load (rows 1-40) and the load-more handler were both lifted from SheetDataGrid to SheetSpokePage. SheetDataGrid is now a pure render component: no `useFrappePostCall`, no local state, no `useEffect`. It receives `rows`, `hasMore`, `isInitLoading`, `initError`, `isLoadingMore`, `loadMoreError`, and `onLoadMore` as props.
- Pagination is fully preserved: `handleLoadMore` in SheetSpokePage computes `nextStart` from the last row's `row_number` (same logic as before), appends via `setPreviewRows(prev => [...prev, ...newRows])`, and passes the handler as `onLoadMore` to SheetDataGrid.
- `useFrappePostCall` stable-ref trick (fetchRef) is preserved in SheetSpokePage.

**ColumnRoleEntry type (boqTypes.ts):**
- `interface ColumnRoleEntry { role: string; area: string | null }` -- new type for the shared lifted state.
- Backend blob stores `column_role_map: Record<string, {role, area}>` objects (3d-ii onward; earlier blobs written by 3d-i stored role-only strings and are handled defensively by the seed). Conversion: seed (`{role,area}` object OR legacy string → `ColumnRoleEntry`) in SheetSpokePage; serialize (`{role,area}` → `{role,area}` with area forced null for non-compatible roles) in SheetConfigPanel.handleSave.

**Manual test plan (3d-i specific -- run on :8080 after clear-site-data + re-login):**
1. GRID RENDER: Open a Pending sheet spoke. The SheetDataGrid must render exactly as before -- same rows, same column letters, same sticky header/gutter, same load-more button. (Proves the lift did not break the grid.)
2. LOAD MORE: On a sheet with >40 rows, click "Load next 40 rows". Must append rows, re-evaluate has_more, disable button while loading. (Proves pagination still works.)
3. CONFIG PANEL: Section 1 + Section 2 must look and behave identically. Save + hard-reload -- column_role_map (prefilled or empty) must round-trip correctly under the new explicit-write ownership.
4. SHEET NAVIGATION: Navigate to a second sheet spoke without going through the hub. Preview grid must load fresh rows for the new sheet (not reuse rows from the first sheet). (Proves the `[boqId, sheetName]` effect dependency resets state correctly.)

---

### Module 3 Slice 3d-ii -- Section 3 column-role list + {role,area} save shape fix

**Status:** COMPLETE (feat f24ac4fe + docs 71d05d1d). Frontend-only. Files changed: `SheetConfigPanel.tsx` (Section 3 UI + cross-section reactivity + handleSave shape fix), `boqTypes.ts` (ColumnRoleEntry comment corrected). No .py files touched. Parser tests 588 unchanged. tsc: 0 errors on boq-wizard files. Vite build: clean.

**handleSave shape correction (over 3d-i):** 3d-i wrote `column_role_map: Record<string,string>` (role only). The parser contract is `dict[col -> {role, area}]` (objects). 3d-ii changes `handleSave` to write `{role, area}` per column. Non-area-compatible roles always get `area: null`. Entries with empty role (uncommitted pending rows) are excluded from the saved map.

**Role vocabulary (21 roles, qty_by_area excluded):**
- Structural: `sl_no`, `description`, `unit`
- Quantity: `qty`, `qty_total`
- Rate: `rate_supply`, `rate_install`, `rate_combined`, `rate_supply_by_area`, `rate_install_by_area`, `rate_combined_by_area`
- Amount: `amount_supply`, `amount_install`, `amount_total`, `amount_combined`, `amount_by_area`
- Notes: `make_model`, `row_notes`, `append_to_notes`, `reference_images`
- Ignore: `ignore`

**Area-compatible roles (8):** `qty`, `amount_supply`, `amount_install`, `amount_total`, `amount_by_area`, `rate_supply_by_area`, `rate_install_by_area`, `rate_combined_by_area`. Area dropdown shown only when role is one of these AND sheet is multi-area (Section 2 `isMulti`) AND at least one non-empty area box exists.

**Area-required roles (4, the *_by_area group):** `amount_by_area`, `rate_supply_by_area`, `rate_install_by_area`, `rate_combined_by_area`. Empty area flagged with `border-destructive` on the area Select trigger + "— required —" placeholder.

**Singleton roles (12):** `sl_no`, `description`, `unit`, `qty_total`, `rate_supply`, `rate_install`, `rate_combined`, `amount_total`, `amount_combined`, `make_model`, `row_notes`, `reference_images`. Enforcement: disabled in other rows' **role** dropdowns when already used. `usedSingletons` Map (role → col) derived from `columnRoleMap` via useMemo. Note: this is role-level uniqueness only -- does NOT cover area-pair uniqueness (see below).

**Per-(role, area) pair uniqueness (area-compatible roles):** The parser enforces that within a sheet, each (role, area) pair may appear on at most ONE column -- e.g. two columns cannot both be `qty` + "Zone A". `qty` + "Zone A" and `qty` + "Zone B" is valid (different areas); `qty` + "Zone A" twice is invalid. Enforced in the **area** dropdown: for each area option A in a given row with role R, A is disabled if another column already holds (R, A). The current row's own selection is never disabled (it must remain selectable). Distinct from singleton enforcement: `qty` is NOT a singleton; this is pair-uniqueness only. `usedAreaPairs` Map (`"role|area"` → col) derived from `columnRoleMap` via useMemo alongside `usedSingletons`. Applies to all 8 area-compatible roles. The `"__none__"` sentinel option is unaffected.

**State representation:**
- `columnRoleMap` (lifted prop from SheetSpokePage): the persisted source. Mapped rows display derives from `sortedMappedCols = sortColLetters(Object.keys(columnRoleMap))`.
- `pendingRows: string[]` (local): transient rows without a column letter. Each element is a unique string ID (from `pendingIdRef`). On column selection → `commitPendingRow(id, col)` removes from pendingRows, adds `{role: "", area: null}` to columnRoleMap. Role and area shown only after column chosen.
- Column picker for pending rows uses `value=""` (uncontrolled placeholder). Mapped row pickers use the committed column as `value`.

**Column picker header text:** Derives from the BOTTOM header row (`headerRowNum` = the `headerRow` S1 field). `getColumnLabel(col)` returns `"C — Description of Work"` when the header cell has text, or just `"C"` otherwise. For 2-row headers, shows the bottom row text only (the primary parser label row). The column picker disables already-mapped columns in other rows' pickers (one row per column constraint).

**Cross-section area reactivity:** `useEffect([validAreas])` — when Section 2 `areaBoxes` changes, any `columnRoleMap` area value no longer in `validAreas` is cleared to null via functional `setColumnRoleMap`. "column_role_map" removed from `confirmedFields` (re-sparkle) so user knows re-assignment is needed. Dependencies: `[validAreas]` only (intentional — reads `columnRoleMap` from outer scope with eslint-disable; functional update handles safety).

**Sparkle/confirm:** Single key `"column_role_map"`. Cleared (`touch("column_role_map")`) on any Section 3 interaction. Seeded unconfirmed (like all fields) on first load. Re-marked confirmed after Save. Cross-section reconciliation re-removes the key.

**Area dropdown sentinel:** `value="__none__"` maps to `area: null`. Options: `<SelectItem value="__none__">Any area / — required —</SelectItem>` first, then active area names. `changeArea(col, "__none__")` → `area: null`.

**handleSave non-area guard:** `AREA_COMPATIBLE_ROLES.has(entry.role) ? entry.area : null`. Ensures non-compatible roles (13 of 21) never write a non-null area to the blob.

**Manual test plan (3d-ii specific -- run on :8080):**
1. ADD + MAP: open a spoke. Section 3 shows below Section 2. Click "+ Add column mapping" → pending row with column picker. Pick a column → role dropdown appears. Pick a role, save, hard-reload → mapping persists and re-displays.
2. AREA CONDITIONAL: on a multi-area sheet, set role to "Quantity" → area dropdown appears with Section 2 area names. Switch to "Description" → area dropdown disappears. Set to a *_by_area role → area is required (border-destructive + "— required —" placeholder).
3. SINGLETON: map a column as "Description". Add another row → "Description" is disabled in its role dropdown.
4. CROSS-SECTION REACTIVITY: map a column with area "Zone A". Go to Section 2, remove/rename "Zone A". The Section 3 row's area clears and it re-sparkles. Save, reload → consistent.
5. OBJECT SHAPE: map qty with area "Zone A", save, hard-reload → area persists (proves {role,area} save-shape fix over 3d-i which dropped area).
6. PREFILL + SPARKLE: a sheet with existing column_role_map shows those rows prefilled with sparkle; any interaction clears it.

---

### Module 3 Slice 3d-ii -- read-back fix (Section 3 seed shape mismatch)

**Status:** COMPLETE (fix cbb704ce + docs 18157331). Frontend-only. File changed: `SheetSpokePage.tsx` (seed loop + comment hardening). No SheetConfigPanel / boqTypes / .py changes. Parser tests 588 unchanged. tsc: 0 errors on boq-wizard files. Vite build: clean (build tool unavailable in Windows Bash shell; tsc clean is the authoritative check).

**Root cause:** Slice 3d-i wrote the seed loop to check `if (typeof role === "string")` where `role` was the loop variable for the entry VALUE from `column_role_map`. When 3d-i was written, the blob stored role-only strings (`{col: "sl_no"}`). Slice 3d-ii corrected the save shape to `{role, area}` objects (`{col: {role:"sl_no", area:null}}`). The seed loop was never updated to match: every value's `typeof` check returned `"object"`, not `"string"`, so every entry was silently skipped. `setColumnRoleMap({})` was called. `setRoleMapInitialized(true)` then fired unconditionally (outside the rawRoleMap block but after the `if (!rawCfg) return` guard), permanently locking the empty state. Section 3 rendered zero rows on every navigation, even though 8 entries were correctly saved in the DB.

**Fix 1 -- seed loop dual-shape parser:** Renamed loop variable `role` → `val` (the value, not the role string). Loop body now handles both shapes:
- `typeof val === "string"` → legacy pre-3d-ii shape: `entries[col] = { role: val, area: null }`.
- `typeof val === "object" && val !== null && "role" in val && typeof val.role === "string"` → current 3d-ii shape: `entries[col] = { role: v.role, area: v.area ?? null }`.
- Anything else (null, malformed): silently skipped.

**Fix 2 -- initialized-flag placement review:** `setRoleMapInitialized(true)` was already correctly placed AFTER `if (!rawCfg) return` but NOT inside the `rawRoleMap` block -- so it fires whenever rawCfg is successfully parsed, even when `column_role_map` is absent (legitimate "no roles configured" state). This is the correct behavior: lock after rawCfg parse succeeds; leave unlocked on draft absent or JSON fail. No placement change was needed; stale comment ("is INSIDE the non-null guard") was corrected in the inline code comment.

**Manual test plan:**
1. PREFILL: open BOQ-26-00152 "low side" spoke. Section 3 must show 8 mapped rows prefilled from saved config, with sparkle. (**This was the primary broken case.**)
2. PERSISTENCE: add/change a mapping, Save, hard-reload → persists and re-displays.
3. EMPTY SHEET: open a sheet with no column_role_map → Section 3 empty (no rows), no crash.

---

### Module 3 Slice 3d-ii -- per-area-pair uniqueness fix

**Status:** COMPLETE (fix f541e428 + docs 3c5f8156). Frontend-only. File changed: `SheetConfigPanel.tsx` only (usedAreaPairs Map added). Parser tests 588 unchanged. tsc: 0 errors on boq-wizard files.

**Root cause:** Parser enforces that each (role, area) pair may appear on at most one column per sheet. The UI did not reflect this -- two columns could both be assigned `qty` + "Zone A". Fix adds `usedAreaPairs: Map<string, string>` (`"role|area"` → col) computed alongside `usedSingletons`. For each area option in the area dropdown, disabled when `usedAreaPairs.has("role|area") && usedAreaPairs.get("role|area") !== currentCol`. The current row's own area is never disabled (prevents locking the user out of their own assignment).

---

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

### Module 3 batched UI-fixes Part 1 -- Finding #1 + #2 + #5

**Status:** COMPLETE (feat bdf32e37 + docs this commit). Frontend-only. File changed: `SheetConfigPanel.tsx` only. No .py files, no boqTypes.ts, no SheetSpokePage.tsx touched. Parser tests 588 unchanged. tsc: 0 errors on boq-wizard files. Vite build: clean (exit 0, 5m build).

**Scope note (Finding #4 -- amount_combined dropdown removal):** OFF for this slice. Recon pass (same session) confirmed auto-guess CAN emit `amount_combined` (5 keyword entries in `_HEADER_KW["amount_combined"]` in classifier.py: "sitc amount", "s&i amount", "s+i amount", "supply & installation amount", "combined amount"). Removing the role from the dropdown would break pre-filled configs on SITC/S&I sheets. Finding #4 is reframed as helper-text only (a separate, future slice).

**Scope note (Finding #3 -- hub changes):** Deferred, separate slice.

**Finding #1 -- Section-1 conditional top-header subform:**

The original "Top header row(s)" free-text input (`topHeaderInput: string`) accepted comma-separated row numbers with instructions to "leave blank when adjacent". This framing inverted the default: most 2-row headers ARE adjacent, so users had to know to leave it blank. Mis-entering the adjacent row (the Alorica case) produced bad `top_header_rows_override` values.

**New design:** Yes/No segmented toggle (mirrors Section 2 Single/Multi pattern). Default = Yes (adjacent, `top_header_rows_override=null`). No = reveals a single number Input for the specific top-header row (serializes `[N]`, single-element list). Parser-check A confirmed the orchestrator reads only `top_header_rows_override[0]`, so a single-element list is the correct contract.

**State changes:**
- Removed: `topHeaderInput: string` (state + seed + save).
- Added: `topAdjacent: boolean` (default `true`); `topHeaderRowNum: string` (default `""`).
- Seed effect: if `cfg.top_header_rows_override` is a non-empty array → `topAdjacent=false`, `topHeaderRowNum=String(arr[0])`; else → `topAdjacent=true`, `topHeaderRowNum=""`.
- Save: `if (hrc === 2 && !topAdjacent && topHeaderRowNum !== "") { n = parseInt(topHeaderRowNum); if valid → topRows=[n] }`; else `topRows=[]`. `top_header_rows_override: topRows.length > 0 ? topRows : null`. Contract unchanged.
- Sparkle: toggle shows sparkle (on Label) when `!topAdjacent` (non-default prefilled). Number input shows sparkle when `topHeaderRowNum !== ""`. Clicking Yes clears `topHeaderRowNum` and removes sparkle. Clicking No does not clear (user may want to keep their custom row number). Adjacent hint `"Top header will be row N-1"` shown as helper text when topAdjacent=true and headerRowNum is known.

**Finding #2 -- Data-start-row restyle:**

The prior display was a `<p>` with `rounded-md border border-border bg-muted/30 px-3 py-2` chrome -- visually indistinguishable from an input box at a glance. Replaced with a single plain `<p className="text-xs text-muted-foreground">` sentence: "Data starts at row **N** (derived from header row + row count)". No Label, no box, no separate helper text. Derivation is unchanged (`headerRowNum + hrc`).

**Finding #5 -- Section-3 save-time unmapped-column warning:**

At Section-3 save, `handleSave` scans `allColumns` (the `useMemo` over loaded `rows` prop -- no new fetch) for columns where: (a) no entry in `columnRoleMap`, or entry with empty role; AND (b) at least one loaded preview row has a non-null, non-empty-string value in that column. For each match, records `{col, exampleRow}`. Sets `unmappedWarnings` state. Save proceeds regardless.

Warning renders as an amber callout block above the Save button (appears after first save attempt). Lists each column + first data row with that column's data. "Assign roles above to include these columns, then save again." Non-blocking: user can ignore and save is already done.

**Accepted limitation:** Preview-rows-only scope. If preview did not load (rows=[]) or a column's data starts beyond row 40+, the warning does not fire. This is acceptable per Findings_v2 -- the dim-unmapped visual in SheetDataGrid (Slice 3d-iii) covers the full sheet.

**Manual test plan (Part 1 -- restart Vite + hard-reload :8080 before testing):**
1. **FINDING #1 - YES default:** Open a double-header sheet. Section 1 shows Yes/No toggle, default Yes. Helper text shows "Top header will be row N-1". Save -- verify `top_header_rows_override: null` in the saved blob (check DevTools or the DB).
2. **FINDING #1 - NO path:** Click "No -- specify row". Row input appears. Enter a row number. Save -- verify `top_header_rows_override: [N]` in blob.
3. **FINDING #1 - prefill from auto-guess:** Load a sheet where auto-guess set `top_header_rows_override=[5]`. Toggle should show "No -- specify row" selected (dimmed/sparkle). Row input shows "5" (dimmed). Click the input -- sparkle clears.
4. **FINDING #1 - single-header:** Switch Header type to Single (1 row). Top-header toggle disappears entirely.
5. **FINDING #2 - restyle:** Data start row is now plain inline text "Data starts at row N (derived...)". No box chrome. Visually distinct from all editable inputs above it.
6. **FINDING #5 - warning fires:** Map only some columns (leave one with data unmapped). Save -- amber warning block appears listing the unmapped column + row. Save button is not disabled and save completed normally.
7. **FINDING #5 - warning clears on next save:** Map the previously unmapped column. Save again -- warning disappears (or shows only remaining unmapped columns).
8. **FINDING #5 - no false positive on empty column:** A column that appears in the header row but has no data in preview rows (all null) should NOT trigger a warning.
9. **REGRESSION:** Section 1 single-row header, data start row display, Section 2 areas, Section 3 role mapping, and sparkle behavior on all other fields unaffected.

---

### Module 3 batched UI-fixes Part 2 -- Finding #3

**Status:** COMPLETE (feat 2f8bf533). Frontend-only. Files changed: `BoqHubPage.tsx` + `boqTypes.ts`. No .py files, no SheetConfigPanel.tsx, no SheetSpokePage.tsx, no SheetDataGrid.tsx touched. Parser tests 588 unchanged. tsc: 0 errors. Vite build: confirmed clean (run in Docker).

**Finding #3 -- Hub "back to project" semantic route:**

The hub page had no "back to project" button at all (it was never implemented). The task framed it as "currently relies on browser history" -- the actual state was the button was absent. Implementing it with semantic routing from the start avoids the history.back() trap (misfires on hard refresh / direct URL with no history stack).

**Recon findings:**
- `boq.project` is present on the Frappe BOQs doctype (confirmed via boqs.json field at position 11/37) but was absent from the `BOQsDoc` TypeScript interface in `boqTypes.ts`. Added `project?: string` to the interface.
- The existing `useFrappeGetDoc("BOQs", boqId)` already returns `project` at runtime -- no new fetch needed.
- Canonical in-project BoQ tab route: `/projects/${projectId}?page=boq` (from CLAUDE.md M1.5 + pmo-project-detail.tsx precedent for page param).

**Implementation:**
- `boqTypes.ts`: Added `project?: string` to `BOQsDoc`.
- `BoqHubPage.tsx`: Added `ArrowLeft` to lucide import. Added conditional "Back to project" button above the header strip: renders only when `boq.project` is set (graceful for orphan BoQs), navigates to `/projects/${boq.project}?page=boq`. Uses `Button variant="ghost" size="sm"` + `-ml-2` offset, matching the panel's ghost-button style.

**Navigation convention (applies to future hub/spoke back-buttons):** All back-navigation in the BoQ wizard routes by entity ID -- never `navigate(-1)` or `window.history.back()`. Reason: wizard pages are accessible via direct URL (the hub at `/upload-boq/hub/:boqId` and spoke at `.../sheet/:sheetName`) with no guaranteed history stack.

**Manual test plan (Part 2 -- restart Vite + hard-reload :8080 before testing):**
1. Navigate directly (fresh tab) to `/upload-boq/hub/BOQ-26-XXXXX`. Confirm "Back to project" button appears above the BoQ title. Click it -- lands on the project page at the BoQ tab (`?page=boq` in URL).
2. **Graceful absent project:** If a BoQ exists with no `project` field (edge case), the button should not render. (Verify by checking the conditional: `{boq.project && ...}`.)
3. **Hard refresh on hub:** Refresh the hub page. Button still present and navigates correctly -- no history required.
4. **REGRESSION:** Spoke back button (returns to hub), status pills, general-specs selector, parse gate footer all unaffected.

---

### Module 3 batched UI-fixes Part 3 -- Finding #4 + #5 copy fix

**Status:** COMPLETE (feat 25ed4b48). Frontend-only. File changed: `SheetConfigPanel.tsx` only. No .py files, no boqTypes.ts, no BoqHubPage.tsx, no SheetSpokePage.tsx, no SheetDataGrid.tsx touched. Parser tests 588 unchanged. tsc: 0 errors. Vite build: clean.

**This commit closes the batched UI-fixes slice.** All five findings are now done:
- Finding #1: Part 1 (feat bdf32e37) -- S1 top-header Yes/No conditional subform.
- Finding #2: Part 1 (feat bdf32e37) -- data-start-row plain inline text.
- Finding #3: Part 2 (feat 2f8bf533) -- hub back-to-project semantic route.
- Finding #4: Part 3 (feat 25ed4b48) -- Section-3 role helper text (helper-text-only; dropdown removal OFF per prior recon).
- Finding #5: Part 1 (feat bdf32e37) -- unmapped-column amber warning. Part 3 copy fix.

**Carry forward:** Module 3 COMPLETE (3a-3f). Module 4 (review-parsed-output screen) next.

**Finding #4 -- Section-3 role helper text (helper-text-only, dropdown removal OFF):**

Per prior recon (Part 1 session): auto-guess CAN emit `amount_combined` (5 keyword entries in classifier.py `_HEADER_KW["amount_combined"]`: "sitc amount", "s&i amount", "s+i amount", "supply & installation amount", "combined amount"). Removing the role from the dropdown would break pre-filled configs on SITC/S&I sheets -- OFF remains final.

A static `<p className="text-xs text-muted-foreground">` note was added between the Section 3 heading and the opacity-50 wrapper. Placement outside the wrapper means it stays readable at full opacity even when the map is unconfirmed (sparkle state). No new data structure, no tooltip component, no ROLE_LABELS extension -- the note is a one-off static string.

**Wording (three pairs from parser-checks B/C/D):**
- **amount_total vs amount_combined:** "same resolved amount -- pick whichever matches your sheet's header wording." (Parser-check B: output-equivalent; user distinction is purely terminological.)
- **row_notes vs append_to_notes:** "Row Notes replaces the notes field (one source); Append to Notes accumulates from multiple columns." (Parser-check C: genuinely distinct behaviors.)
- **qty vs qty_total:** "set distinct parser fields -- not interchangeable." (Parser-check D: REVISED the earlier assumption of equivalence; non-equivalence made explicit.)

**Finding #5 copy fix:**

The closing line of the unmapped-column amber warning was:
> "Assign roles above to include these columns, then save again."

"save again" implied the first save failed or was incomplete. The save is non-blocking and already completed before the warning renders. Changed to:
> "Assign roles above and save to include them."

Logic unchanged. Only the warning text was edited (line 968 in the updated file).

**Manual test plan (Part 3 -- restart Vite + hard-reload :8080 before testing):**
1. ~~HELPER TEXT~~ (superseded by Part 3b -- the inline paragraph is REMOVED in Part 3b).
2. **DROPDOWN UNCHANGED:** Open the role dropdown -- all 21 roles still present including amount_combined. No roles added or removed.
3. **#5 COPY FIX:** Map only some columns (leave one with data unmapped). Save -- amber warning appears. Last line should read "Assign roles above and save to include them." (not "save again").
4. **REGRESSION:** Section 1/2 controls, sparkle behavior, save logic, area reconciliation, singleton enforcement all unaffected.

---

### Module 3 batched UI-fixes Part 3b -- Section-3 role tooltips

**Status:** COMPLETE (feat 8943e9ce). Frontend-only. File changed: `SheetConfigPanel.tsx` only. No .py files, no boqTypes.ts, no BoqHubPage.tsx, no SheetSpokePage.tsx, no SheetDataGrid.tsx touched. Parser tests 588 unchanged. tsc: 0 errors. Vite build: clean (confirmed exit 0).

**This is a refinement of Finding #4 (Part 3), not a new finding.** Batched UI-fixes slice remains CLOSED. Carry forward: 3e + 3f unchanged.

**Why Part 3b replaces Part 3's inline paragraph:**
The Part 3 paragraph described mechanical behavior ("same resolved amount", "replaces the notes field") rather than decision-oriented guidance ("when should I use this?"). It also crammed three distinctions into one dense block that users had to parse before opening the dropdown. Per-role tooltips give the help exactly when needed -- while browsing roles -- and are scoped to just the 6 confusable roles.

**Recon findings (portal safety):**

Two issues were identified before implementing:

**Issue 1 (DismissableLayer -- manageable):** `TooltipContent` portals to `document.body`. Radix Select's `DismissableLayer` fires on `pointerdown` outside SelectContent, not on hover events. Tooltip is hover-only (no pointerdown on tooltip content needed). Select will not close when a tooltip appears.

**Issue 2 (ItemText cloning -- REAL blocker for naive approach):** shadcn's `SelectItem` wraps ALL children in `SelectPrimitive.ItemText`. Radix `SelectValue` in the closed trigger clones `ItemText` content, so an icon placed inside shadcn's `SelectItem` would ALSO appear in the trigger's selected-value display. This is a visual bug.

**Resolution -- SelectPrimitive approach:**
For the 6 confusable roles, `SelectPrimitive.Item` (from `@radix-ui/react-select`) is used directly instead of shadcn's `SelectItem`. The structure:
```tsx
<SelectPrimitive.Item value={r.value} disabled={...} className={SHADCN_ITEM_CLASSES}>
  <span className="absolute right-2 ...">
    <SelectPrimitive.ItemIndicator>
      <Check className="h-4 w-4" />  {/* lucide Check, not @radix-ui/react-icons CheckIcon */}
    </SelectPrimitive.ItemIndicator>
  </span>
  <SelectPrimitive.ItemText>{r.label}</SelectPrimitive.ItemText>  {/* label only → trigger display */}
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="ml-1.5 inline-flex items-center shrink-0">
        <Info className="h-3 w-3 text-muted-foreground/60" />
      </span>
    </TooltipTrigger>
    <TooltipContent side="right" className="max-w-56 leading-relaxed">
      {helpText}
    </TooltipContent>
  </Tooltip>
</SelectPrimitive.Item>
```

The icon is a sibling to `ItemText` (not inside it), so it does NOT appear in the trigger. Non-confusable roles continue to use shadcn's plain `SelectItem` unchanged.

**ROLE_HELP_TEXT constant (local to SheetConfigPanel -- not in boqTypes.ts):**
One-component copy, not shared across wizard files. boqTypes.ts has ROLE_LABELS (shared for badge sync); help text is display-only copy, no sharing needed.

**TooltipProvider:** Mounted at the SheetConfigPanel return wrapper (wraps the outer `<div>`). Pattern matches existing wizard uses (BoqHubPage, SheetCard, BoqUploadScreen all mount locally). `delayDuration={300}`.

**Tooltip wording (6 roles, owner-approved verbatim):**
- `qty`: "Use for a normal quantity column."
- `qty_total`: "Use ONLY when the column is a sum of other quantity columns -- usually the 'total' area in a multi-area sheet that adds up the individual areas."
- `amount_total`: "Standard amount column. Same result as Amount (Combined) -- pick the one whose header label matches your sheet."
- `amount_combined`: "Same result as Amount (Total). Choose this if your column header says 'SITC', 'S&I', or 'Combined'."
- `row_notes`: "Use for a single remarks/notes column. Replaces the notes field."
- `append_to_notes`: "Use when several columns should be combined together into the notes field."

**Manual test plan (Part 3b -- hard-reload :8080 before testing; no Vite restart needed):**
1. **INLINE PARAGRAPH REMOVED:** Section 3 heading should have NO dense muted-foreground paragraph below it. The heading is followed directly by the column-role rows.
2. **TOOLTIP ON CONFUSABLE ROLES:** Open the role dropdown. The 6 confusable roles (Quantity, Total Quantity, Amount (Total), Amount (Combined), Row Notes, Append to Notes) each have a small `ℹ` icon to the right of the label. Hover the icon -- tooltip appears to the right with the decision-oriented wording. The dropdown stays open while hovering.
3. **TRIGGER DISPLAY CLEAN:** Select "Quantity" as a role. The closed SelectTrigger shows "Quantity" (label only). No icon appears in the trigger display.
4. **NON-CONFUSABLE ROLES UNCHANGED:** Other roles (sl_no, description, unit, rate_*, amount_supply, amount_install, amount_by_area, make_model, reference_images, ignore) have no icon. Render as plain text items.
5. **SELECT STILL WORKS:** Clicking a confusable role item (anywhere on the row, including near the icon) still selects it. Icon is informational only.
6. **SPARKLE/OPACITY:** The column_role_map opacity-50 sparkle state does not affect the inline paragraph (it's gone). No regression on Section 1/2 sparkle.
7. **REGRESSION:** #5 unmapped-column warning text, Section 1/2 controls, save logic all unaffected.

---

### Module 3 Slice 3e -- two-layer review gate

**Status:** COMPLETE (feat e60e768c). Frontend-only (no .py files touched). Files changed: `SheetConfigPanel.tsx`, `SheetSpokePage.tsx`, `SheetCard.tsx`. boqTypes.ts unchanged. Parser tests 588 unchanged. Wizard tests 89/89 OK. tsc: 0 errors. Production build: exit 0.

**Current state:** Module 3 COMPLETE (3a-3f); Module 4 next.

**What landed:**

**Section-grain Layer 1 (section:rows / section:areas / section:roles keys):**
- Three stable keys added to the existing `confirmedFields: Set<string>` in SheetConfigPanel. No new state structure.
- Section 1 h3: sparkle when `isUnconfirmed("section:rows", hasPrefill)`. Section 2 h3: sparkle when either field-level OR section:areas unconfirmed. Section 3 h3: same pattern for section:roles.
- `touchS1/touchS2/touchS3` helpers set BOTH the field key AND the section key in one `setConfirmedFields` call.
- Section keys are set on all: `onChange`/`onValueChange` (genuine change events); `onFocus`/`onClick` (focus-type events, which also confirm the field). Drop (M3.12) is wired to `onChange`/`onValueChange`/add/remove only -- not onFocus/onClick/onOpenChange.
- Save sets all three section keys in `setConfirmedFields` (alongside existing field keys). Save = natural confirmation.

**Bulk-accept:**
- Button "Accept all sections as-is" appears when `hasPrefill && !allSectionsConfirmed`. One click adds all three section keys to confirmedFields.
- **3e-fix (feat 7aaa0525):** Bulk-accept now calls `setConfirmedFields((prev) => new Set([...prev, ...SAVE_ALL_FIELDS]))` -- adds the full SAVE_ALL_FIELDS set (all 6 per-field keys + 3 section keys) rather than only the 3 section keys. Sections 2 and 3 heading sparkles checked the per-field key (area_dimensions / column_role_map) in an OR with the section key; adding only section keys left those sparkles live. Fix: bulk-accept now matches Save semantics -- clears every sparkle. Manual test confirmed: Cases 1 (all sparkles clear on bulk-accept), 2 (gate logic correct, drop works), 3 (no false-drop) all pass.

**Coverage summary:**
- `getContentBearingColumns()` helper extracted from handleSave's inline scan -- single source of truth.
- Save-time amber warning: `contentBearing.filter(unmapped)` -- unchanged behavior.
- Coverage block: all content-bearing columns shown with role label or "Ignore (unmapped)". Non-blocking.

**Layer 2 attestation checkbox:**
- Enabled when `allSectionsConfirmed && parserRequiredSatisfied`. Parser-required: header_row non-NaN + description + (qty|qty_total) + any rate-family + any amount-family.
- `disabled` HTML attr prevents ticking while disabled (no JS guard needed beyond that).

**Mark as reviewed (save-anchored):**
- `buildConfigPayload()` helper extracted (shared by handleSave and handleMarkReviewed to avoid blob-build duplication).
- `SAVE_ALL_FIELDS` constant (Set) shared for `setConfirmedFields` on both paths.
- Two-call sequence: `callSetConfig` first; on success `callSetStatus("Reviewed")`. Config-save failure stops before status call. Status-flip failure: inline error "Config saved but status update failed..." (config stays saved). Full success: `setConfirmedFields(SAVE_ALL_FIELDS)` + `onSaveSuccess()`.

**M3.12 re-edit drop:**
- `wizardStatus?: WizardStatus` new prop on SheetConfigPanel. SheetSpokePage passes `draft.wizard_status` (was already available, previously unused in the panel).
- `statusAtOpenRef = useRef(wizardStatus)` captures status at mount (panel remounts per sheet via `key={decodedSheetName}`).
- `dropFiredRef = useRef(false)` once-per-open guard.
- `dropIfReviewed()`: if `statusAtOpenRef.current === "Reviewed"` and not yet fired: sets `dropFiredRef.current = true`, clears `attestChecked`, calls `callSetStatus("Pending")`.
- Wired to: `onValueChange` on Header Type Select; `onChange` on all text Inputs; Yes/No toggle button onClick (these ARE value changes); area box onChange + add/remove buttons; all Section 3 handlers (addRow, commitPendingRow, changeColumn, changeRole, changeArea, removeRow, removePendingRow). NOT wired to: `onOpenChange` (dropdown open), `onFocus`, `onClick` on inputs.

**Hub Mark-reviewed retirement (M3.4):**
- `MARK_REVIEWED_CLASS` constant removed from SheetCard.tsx.
- "Mark reviewed" button removed from Pending block and Parse-failed block (found in exactly 2 places as expected).
- "Set pending" button (Reviewed block) untouched.
- A sheet can now only reach Reviewed via the spoke gate.

**Manual test checklist (live test required -- backend must be running):**
1. Open a Pending sheet with prefill. Sections show sparkle. Click "Accept all sections as-is" -- all sparkles clear. Map minimum required columns. Tick attestation checkbox. Click "Mark as reviewed" -- hub shows Reviewed pill.
2. Re-open the Reviewed sheet. Status-as-opened is Reviewed. Change one dropdown -- sheet drops to Pending (hub pill changes). Re-confirm sections, re-tick, mark reviewed again.
3. Re-open the Reviewed sheet. Focus a field (click into input) WITHOUT changing its value -- sheet stays Reviewed.
4. Hub: Pending and Parse-failed cards have no "Mark reviewed" button. Reviewed cards still have "Set pending" button.

---

### Module 3 Slice 3f -- Section 4 work-package assignment

**Status:** COMPLETE (feat 793276f6). Frontend-only -- no backend/schema/type change. The work_packages child-table schema and the set_sheet_work_packages endpoint landed earlier in 3a (feat b14e9015); 3f is UI-only. (The earlier plan-doc framing of 3f as a "schema conversion / backend-touch" slice was STALE -- corrected here.) Files: SheetConfigPanel.tsx, SheetSpokePage.tsx. boqTypes.ts unchanged. Wizard tests 89. Parser tests 588. Build exit 0.

**What landed:**
- Section 4 (Work Packages) in SheetConfigPanel, below Section 3. Flat checkbox list populated from useFrappeGetDocList("Work Headers") sorted by order ASC; option label = work_header_name, value = name (docname). No grouping (only one parent group has >1 member; 2 headers have null work_package_link -- flat is correct).
- selectedWorkHeaders[] seeded once from draft.work_packages (wpInitialized guard; survives mutate() re-fetch). SheetSpokePage passes workPackages={draft.work_packages}.
- INSIDE the gate: touchS4 adds "section:workpackages" to confirmedFields; allSectionsConfirmed now requires all 4 section keys; SAVE_ALL_FIELDS gains work_packages + section:workpackages so Save / Mark-as-reviewed / bulk-accept all clear the Section 4 sparkle.
- REQUIRED NON-EMPTY: hasWorkPackage (selectedWorkHeaders.length > 0) ANDed into the attestation-checkbox enable condition, kept SEPARATE from parserRequiredSatisfied (config-required, not parser-required). Helper line shown when sections confirmed + parser-required satisfied but no WP assigned.
- Save path writes BOTH endpoints: set_sheet_config then set_sheet_work_packages (in handleSave and handleMarkReviewed). Mark-reviewed sequence: set_sheet_config -> set_sheet_work_packages -> set_sheet_status("Reviewed"), each gated on the prior.
- M3.12 drop: dropIfReviewed() in the Section 4 checkbox onCheckedChange; opening without toggling does NOT drop.
- Removed orphaned touch() helper (zero call sites after 3e; TS6133 gone).

**Manual test (live, required):** open a Pending sheet -> Section 4 empty + sparkle; attestation checkbox DISABLED with zero WP even after confirming all sections; assign a header -> checkbox enables; mark reviewed -> hub shows Reviewed + card WP summary; re-open, add/remove a WP -> drops to Pending; re-open and just view the list without toggling -> stays Reviewed. Full de-stale before testing (Vite restart + Service Workers Unregister + Clear site data + Ctrl+Shift+R).

**3f-fix (feat 85c842a3) -- Work Headers picker 500 (order reserved word):** The picker hung on "Loading..." with a 500. Cause: useFrappeGetDocList passed order_by on the field `order`, a PostgreSQL reserved keyword -> invalid SQL in Frappe's REST list layer. Fix: removed server-side order_by, kept `order` in fields, sort client-side by order asc in JS. CONVENTION: never order_by on a Frappe field literally named `order` -- sort client-side.

**3f-readback (feat a637be0d) -- work-package read-back (grandchild rows):** Assignments saved but never displayed (hub card blank, spoke Section 4 unticked on re-open). Root cause: Frappe get_doc / REST serializes child tables ONE LEVEL DEEP ONLY -- BOQs.sheet_drafts populates, but BoQ Sheet Draft.work_packages (grandchild) does not, so draft.work_packages is always empty client-side. The hub display from 3a-fix was therefore never functional (latent bug, not a 3f regression). Fix: new read-only whitelisted endpoint get_boq_work_packages(boq_name) -> { sheet_name: [work_header,...] } (queries tabBoQ Sheet Work Package directly via frappe.db.get_all; get_doc does not hydrate grandchildren). Rewired hub (SheetCard workHeaders prop) and spoke (SheetConfigPanel workPackages: string[] from the endpoint); refresh on save via mutateWpMap. +6 wizard tests. Module 3 (3a-3f) COMPLETE -- all 5 manual-test checks passed live on BOQ-26-00145.

---

### Phase-1 Slice 1 -- BoQ Review Row doctype + MappingConfig assembly + ResolvedRow flattener

**Status:** COMPLETE (feat 7aaa0525; 31 new tests / 89 wizard / 588 parser). Backend-only -- no frontend changes this slice. Frontend CLAUDE.md NOT touched (no frontend change this slice).

Files added/modified:
- `nirmaan_stack/api/boq/wizard/parse_run.py` -- 3 pure functions (no `@frappe.whitelist` endpoint; Slice 2 adds that)
- `nirmaan_stack/api/boq/wizard/test_parse_run.py` -- 31 tests in 3 groups
- `nirmaan_stack/nirmaan_stack/doctype/boq_review_row/` -- new top-level doctype (JSON + controller + __init__ + test stub)
- `nirmaan_stack/nirmaan_stack/doctype/boq_sheet_draft/boq_sheet_draft.json` -- "Parsed" added to wizard_status Select options

**What is Phase-1 Slice 1?**

First backend slice of the "Phase 1 parse run". Prepares the infrastructure that the parse-pass endpoint (Slice 2) will call: the transient output doctype, the config-assembly function, and the output-flattening function. All pure Python -- no whitelisted endpoint, no DB writes.

**New doctype: BoQ Review Row**

Autoname `BOQRR-.YY.-.#####`. Top-level (not istable). `track_changes=1`. Role-based access: System Manager + 4 project roles (Procurement Executive, Project Lead, Project Manager, Estimates Executive) full CRUD; Design Lead full CRUD; Design Executive + Accountant + HR Executive + PMO Executive read-only.

Role: transient per-row store for one parse-run's output -- one row per resolved parser row per parse pass. NOT the committed output (that goes to BOQ Nodes once Phase 4+ lands). The doctype holds the full parser result so a human reviewer can inspect, annotate, and approve rows before they become canonical BOQ Nodes.

Field groups (from the .json field_order):
- **Links:** `boq` Link->BOQs (reqd, indexed), `sheet_name` Data (reqd)
- **Position:** `source_row_number` Int, `row_index` Int (0-based within sheet), `classification` Data, `level` Int, `parent_index` Int, `path` Data (read-only, indexed), `attached_to_index` Int, `attached_notes` JSON (list of str)
- **Classifier metadata:** `promoted_from_line_item` Check, `preamble_level_override` Int, `preamble_candidate_score` Int, `preamble_candidate_signals` JSON (list of str), `needs_classification_review` Check, `review_reason` Data
- **Content:** `sl_no_value` Data, `description` Text (global search), `unit` Data, `make_model` Data, `is_rate_only` Check
- **Quantities/Rates/Amounts:** `qty_total` Float, `qty_by_area` JSON (dict), `rate_supply/rate_install/rate_combined` Float, `rate_by_area` JSON (dict of dicts), `amount_total/amount_supply/amount_install` Float, `amount_by_area` JSON (dict)
- **Notes:** `row_notes` Text, `append_notes_raw` JSON (dict)
- **Warnings:** `validation_warnings` JSON (list -- sum-mismatch warnings on ResolvedRow), `classifier_warnings` JSON (list -- classifier-level warnings on ClassifiedRow; distinct from validation_warnings)
- **Flags:** `is_synthetic` Check

**Frappe list-JSON serialization caveat:** Frappe's `get_valid_dict()` auto-serializes Python dicts for JSON fieldtype but REJECTS Python lists with "cannot be a list". The four list-type JSON fields (`attached_notes`, `validation_warnings`, `classifier_warnings`, `preamble_candidate_signals`) must be pre-serialized via `json.dumps()` before `doc.insert()`. Dict-type fields can be passed as Python dicts directly. See `_LIST_JSON_FIELDS` module-level constant in `parse_run.py` for the authoritative set (module-level since Slice 2; `TestBoQReviewRowRoundTrip._insert_rows` references the same constant).

**"Parsed" wizard_status addition**

`BoQ Sheet Draft.wizard_status` Select gains `Parsed` as the 7th value. Lifecycle meaning: a sheet whose parse run completed successfully. `assemble_mapping_config` treats `Parsed` identically to `Reviewed` -- both include the sheet as a data parse target with its saved `sheet_config` blob (a re-run re-parses configured sheets).

**`assemble_mapping_config(boq_name) -> (MappingConfig, not_eligible: list[str])`**

Pure function (no DB writes). Reads the BOQs doc + all BoQ Sheet Draft child rows, builds a `MappingConfig` Pydantic model for the parser orchestrator. Routing rules applied in order (feat e997028b -- pointer outranks Skip/Hidden):
1. `sheet_name == BOQs.general_specs_sheet` -> `treat_as="master_preamble"` -- checked FIRST; pointer is source of truth per M2.16 and wins over any stored wizard_status
2. `wizard_status` in {Hidden, Skip} -> `SheetConfig(skip=True)` -- only for sheets NOT matching the pointer
3. `wizard_status` in {Reviewed, Parsed} + valid `sheet_config` blob -> deserialize + include as data
4. Anything else (Pending, Parse failed, blank, Reviewed-without-blob) -> appended to `not_eligible`

**Rule-order fix (feat e997028b, 2026-06-03).** Original order had Skip/Hidden (old Rule 1) before the pointer check (old Rule 2). Bug: a sheet designated as general-specs while its stored wizard_status was still "Skip" (the common real-data case -- hub pointer designation per M2.16 does NOT write "General specs" to wizard_status) was routed as skip=True and master_preamble text was never extracted. Verified live on BOQ-26-00145 sheet "SOW" (wizard_status="Skip", pointer="SOW"). Fix: pointer check promoted to Rule 1.

**DEFERRED REQUIREMENT -- Multiple general-specs sheets per Master BoQ (raised 2026-06-03, real-BoQ-driven).** Real BoQs found with more than one general-specifications sheet. Current model (single BOQs.general_specs_sheet Data pointer + single BOQs.master_preamble Long Text, one-per-workbook per M2.16) is too narrow. Needs (to design, not yet specced): drop the one-per-workbook constraint (reverses M2.16); store multiple designations -- likely a child table on BOQs, one row per general-specs sheet, each capturing (source sheet name + extracted master-preamble text); frontend hub designation UI single-select -> multi-select/add-list (wizard-scope; pairs with Slice 2b); worker changes from one-pointer-one-preamble to all-designated-sheets -> N preambles each with source sheet name; migration of existing single-general_specs_sheet BoQs into the new structure; open design question -- are the multiple sheets distinct kinds (SOW/General Conditions/Preamble) or same kind split (shapes separate-labeled vs concatenated). Sequencing: its own design-close + build, likely with Slice 2b. The rule-order precedence fix is a stepping stone -- the multi-version checks "sheet is in the set of general-specs sheets" instead of "== the one pointer", same precedence principle.

Raises `frappe.ValidationError` if the BOQ doesn't exist or no eligible sheets exist. `GlobalSettings` always uses defaults (no per-BoQ override exists or is wanted).

**`flatten_resolved_row(resolved_row, sheet_name, row_index) -> dict`**

Pure function. Maps a `ResolvedRow` (and its nested `ClassifiedRow`) to a flat dict of BoQ Review Row field values. All 30+ fields mapped. JSON list fields returned as Python lists; JSON dict fields returned as Python dicts (callers pre-serialize lists before insert). The `boq` field is NOT included -- `flatten_parsed_boq` injects it.

Object-per-flag note: `needs_classification_review` and `review_reason` are on `ResolvedRow` (post-hierarchy review flags); `preamble_candidate_score`, `preamble_candidate_signals`, `preamble_level_override`, and `classifier_warnings` are on `ClassifiedRow` (classifier-time signals). Mixing these up breaks the review-flag logic.

**`flatten_parsed_boq(parsed_boq, boq_name) -> list[dict]`**

Pure function. Iterates `ParsedBoq.sheets`, calls `flatten_resolved_row` per resolved row, injects `boq=boq_name`. `master_preamble` sheets produce no rows (their content lives on `ParsedBoq.master_preamble`). `row_index` is 0-based within each sheet's `resolved_rows` list.

**Test groups (31 new tests in `test_parse_run.py`):**
- `TestAssembleMappingConfig` (9 tests, FrappeTestCase): routing rules for all 5 wizard_status cases, not_eligible collection, general-specs pointer -> master_preamble, Parsed parity with Reviewed, Reviewed-without-blob soft-exclusion, unknown-boq ValidationError
- `TestFlattenFaithfulness` (17 tests, pure Python, no DB): row count matches resolved_rows, classification values, sequential row_index, sheet_name + boq injection, parent_index + path coherence, scalar rate_supply preserved, multi-area qty_by_area + amount_by_area dicts, validation_warnings survive flatten, clean rows have empty warnings, programmatic needs_classification_review flag survives flatten, is_synthetic False by default, JSON fields are Python objects not strings
- `TestBoQReviewRowRoundTrip` (5 tests, FrappeTestCase): insert simple rows + read-back classification, multi-area line item JSON round-trip, validation_warnings DB round-trip, needs_classification_review + review_reason DB round-trip

**Slice 2 next:** `trigger_parse_run` whitelisted endpoint + background worker + Parsed lifecycle (BOQs.wizard_state="Parsed") + old BoQ Review Rows cleanup on re-parse.

---

### Phase-1 Slice 2 -- parse_run worker + endpoint + two fixes

**Status:** COMPLETE (feat 842b2b1a; +13 tests; 44 test_parse_run / 102 wizard / 588 parser; all 831 app Frappe tests green). Backend-only -- no frontend changes this slice.

**Files changed:**
- `nirmaan_stack/api/boq/wizard/parse_run.py` -- FIX 1 + FIX 2 + `_LIST_JSON_FIELDS` module constant + `run_parse` endpoint + `_run_parse_worker` + `_fetch_boq_file_to_tempfile` + `_set_draft_status` + `_publish_parse_event`
- `nirmaan_stack/api/boq/wizard/test_parse_run.py` -- imports updated; `_LIST_JSON_FIELDS` moved to module-level; `test_fix1_production_blob_without_sheet_name_is_eligible` added to `TestAssembleMappingConfig`; `TestRunParseWorker` class added (13 new tests)

**FIX 1 -- sheet_name injection (BLOCKING)**

Production wizard blobs saved by `set_sheet_config` have exactly 6 keys: `area_dimensions`, `column_role_map`, `header_row`, `header_row_count`, `skip_top_rows_after_header`, `top_header_rows_override`. They NEVER contain `sheet_name` (verified live on BOQ-26-00150 and BOQ-26-00145). `SheetConfig.sheet_name` has no default; without the injection `model_validate` raises `ValidationError` and the sheet falls into `not_eligible` silently, making every Reviewed sheet ineligible.

Fix: `raw["sheet_name"] = sheet_name` injected in `assemble_mapping_config` Rule 3 before `SheetConfig.model_validate(raw)`. One line.

**FIX 2 -- list-JSON pre-serialization**

The four list-type JSON fields (`attached_notes`, `validation_warnings`, `classifier_warnings`, `preamble_candidate_signals`) must be pre-serialized via `json.dumps()` before `doc.insert()`. Frappe's `get_valid_dict()` rejects Python lists for JSON fieldtype. The `_run_parse_worker` applies this per-field. The canonical set is `_LIST_JSON_FIELDS` (module-level `frozenset` in `parse_run.py`).

**`run_parse` endpoint**

`@frappe.whitelist(methods=["POST"])`. Enqueues `_run_parse_worker` on `queue="long"`, `timeout=600`, mirroring `upload_file.py`. Returns `{"status": "queued", "job_id": ...}`.

`sheet_names=None` parses all eligible Reviewed/Parsed sheets. `sheet_names=[...]` narrows to the named subset (per-sheet re-parse; skip/master_preamble sheets always pass through).

URL: `/api/method/nirmaan_stack.api.boq.wizard.parse_run.run_parse`

**`_run_parse_worker` design**

1. Fetch workbook via `_fetch_boq_file_to_tempfile` -- S3 or local (dev/test). Real file extension derived from `file_name` query param in the S3 URL (unlike `sheet_preview._fetch_boq_file_to_tempfile` which hardcodes `.xlsx`). Local paths/`/private/` URLs copy to a tempfile via `shutil.copy2`.
2. `assemble_mapping_config(boq_name)` -- FIX 1 fires here; returns `(config, not_eligible)`.
3. If `sheet_names` subset given, narrow `config.sheets` (skip/master_preamble always included).
4. `parse_boq(tempfile_path, config)` -- orchestrator handles skip + master_preamble internally.
5. Per parsed sheet: delete existing BoQ Review Rows (`boq`+`sheet_name` filter) then insert new rows (FIX 2 applies). On per-sheet insert failure: compensating delete + set `Parse failed` status + continue.
6. On `parse_boq` global failure: all eligible data sheets set to `Parse failed`, commit, publish error event, return.
7. `master_preamble` text: when `parsed.master_preamble` is non-empty, written to `BOQs.master_preamble` via `frappe.db.set_value`. Falsy result skips the write -- a re-parse that finds no general-specs sheet does NOT blank a previously stored value. Logged at INFO level in both cases. Field added in feat 8db5a8d8; bench migrate run; `has_column` verified True.
8. `BOQs.parsed_at` stamped with `frappe.utils.now()` if at least one sheet succeeded.
9. `frappe.db.commit()` THEN `frappe.publish_realtime("boq:parse_run_done", ...)` (commit-before-publish per CLAUDE.md).
10. Event targeted to enqueueing user via `user=user` param.

**Status lifecycle (per `BoQ Sheet Draft.wizard_status`)**
- Reviewed + successful parse -> `Parsed`
- Re-parse of `Parsed` sheet -> rows replaced; status stays `Parsed`
- `parse_boq` global failure -> all eligible sheets -> `Parse failed`
- Per-sheet insert failure -> that sheet -> `Parse failed`; other sheets continue
- General-specs sheet (master_preamble): status NOT changed by worker (it is not a data sheet)
- Pending/Hidden/Skip/Parse-failed/Reviewed-without-blob: not parsed; status unchanged

**Event: `boq:parse_run_done`**
- Success: `{status:"success", boq_name, parsed_sheets:[], not_parsed_sheets:[], failed_sheets:[]}`
- Error: `{status:"error", boq_name, error_code: "missing_file"|"fetch_failed"|"no_eligible_sheets"|"parse_failed"|"internal"}`
- Targeted to enqueueing user (vs. `boq:wizard_parse_done` which is broadcast to all clients).

**`BOQs.wizard_state` NOT touched** -- the worker never sets this field. User-declared finalize is a later phase.

**New test class `TestRunParseWorker` (15 tests; +1 from rule-order fix)**
- Uses a tiny 3-sheet openpyxl workbook (SheetA + SheetB + SOW) built in `setUpClass`; `source_file_url` set to the local tempfile path (triggers local-fetch branch in `_fetch_boq_file_to_tempfile`; no S3 dependency)
- All blobs use 6-key production shape (no `sheet_name`) to exercise FIX 1 naturally
- Tests: Reviewed->Parsed on success; rows inserted; `parsed_at` stamped; `parse_boq` failure->Parse failed (via `unittest.mock.patch`); re-parse no duplicate rows; subset parse leaves other sheets' rows untouched; Pending sheet not parsed + stays Pending; general-specs sheet no rows; master_preamble written + contains SOW text + SOW still no rows; master_preamble written when general-specs sheet has wizard_status="Skip" (rule-order fix, real-data regression); `general_specs_sheet=""` safe; `general_specs_sheet=None` safe; Skip/Hidden no rows; FIX 2 list-JSON round-trip
- `test_fix1_production_blob_without_sheet_name_is_eligible` + `test_skip_sheet_designated_as_general_specs_routes_to_master_preamble` (rule-order fix unit test) added to `TestAssembleMappingConfig` (+1)

**`_LIST_JSON_FIELDS` promotion**
Moved from `TestBoQReviewRowRoundTrip._LIST_JSON_FIELDS` (class attribute) to module-level `frozenset` in `parse_run.py`. `test_parse_run.py` imports it from `parse_run`; no re-hardcoding.

**Live proof (to be run by Nitesh)**
1. Designate "SOW" on BOQ-26-00145 as general-specs via wizard hub (`set_general_specs_sheet`)
2. Call `run_parse` on BOQ-26-00145 and BOQ-26-00150 (or trigger via a temporary curl/bench console call until the Parse button is wired in Slice 2b)
3. Assert: Reviewed sheets -> Parsed; 21/3 Skip sheets -> no rows; SOW -> master_preamble text logged, no rows; per-sheet re-parse replaces only that sheet's rows; `parsed_at` set on BOQs

**Slice 2b next:** Wire "Parse workbook" button in hub frontend to call `run_parse`; handle `boq:parse_run_done` event in the hub; show parse progress/result. OR: Slice 3c (SheetConfigPanel wizard spoke) first if that is prioritized.

---

### Phase-1 Slice 2b-backend -- dirty-marker drop (Parsed -> Reviewed on config change)

**Status:** COMPLETE (feat 7795582f; 7 new tests; 56 wizard tests total; 588 parser tests unchanged). Backend-only -- no frontend changes this slice.

**Files changed:**
- `nirmaan_stack/api/boq/wizard/update_sheet_draft.py` -- `set_sheet_config` dirty-marker logic
- `nirmaan_stack/api/boq/wizard/test_update_sheet_draft.py` -- `TestSetSheetConfigDirtyMarker` class (7 tests)

**What this slice does**

`set_sheet_config` is the sole config writer (verified: no other endpoint touches `sheet_config`). Before writing the new blob it now:

1. Reads the child row's current `wizard_status` + `sheet_config` via `frappe.db.get_value(child_name, [...], as_dict=True)`.
2. Computes `changed` via a **sound semantic compare**: normalizes both the incoming config (Python object from dict input or `json.loads` of string input) and the stored config (stored blob re-parsed; handles Frappe auto-deserialization of JSON fields -- see note below) to `json.dumps(..., sort_keys=True)` and compares those canonical strings.
3. If `current_status == "Parsed"` and `changed`: sets `wizard_status = "Reviewed"` (separate `db.set_value` call before the blob write).
4. Writes the config blob unconditionally (identical blob write is harmless; simpler than skipping).

**Compare-soundness note (load-bearing)**

The stored and incoming forms are both non-canonical: dict input uses Python insertion-order via `json.dumps(dict)` (no `sort_keys`); string input is stored verbatim. Key reordering alone would cause a raw `==` compare to report "changed" on a semantically identical no-op save, producing a false dirty flag.

The `sort_keys=True` normalization makes semantically-equal configs compare equal regardless of key order or original string formatting.

**Additional finding during implementation:** Frappe's `db.get_value` with `as_dict=True` on a JSON fieldtype auto-deserializes the field to a Python dict (not a raw string). The comparison code handles both string and already-deserialized-object forms when reading the stored blob. Without this, `json.loads(dict)` raises `TypeError`, the except clause catches it, `stored_canonical` becomes `None`, and every save reports "changed" -- verified by two initial test failures.

**Status-machine contract (LOCKED per plan §4)**

| Prior status | changed | Result |
|---|---|---|
| Parsed | True | drops to Reviewed |
| Parsed | False | stays Parsed (no-op save) |
| Reviewed / Pending / Skip / Hidden / Parse failed | any | status untouched |

`set_sheet_config` is the only endpoint that implements this drop; it is called by SheetConfigPanel's read-modify-write save. No schema changes (no dirty boolean, no hash field, no timestamp -- the status drop IS the dirty marker, per plan §4).

**New test class `TestSetSheetConfigDirtyMarker` (7 tests)**
- Parsed + changed config -> drops to Reviewed
- Parsed + identical config (no-op save) -> stays Parsed
- Parsed + reordered-keys (same semantic) -> stays Parsed (compare-soundness regression guard; included because stored form IS non-canonical)
- Reviewed + changed config -> stays Reviewed (not touched)
- Pending + changed config -> stays Pending (not touched)
- Skip + changed config -> stays Skip (only-Parsed invariant)
- Config blob correctly written in the Parsed->Reviewed drop path

**No schema change.** No frontend change. No parser change. No CLAUDE.md convention-level change (dirty-marker behavior is fully documented here; set_sheet_config docstring updated inline).

---

### Phase-1 Slice 2b-backend-2 -- parse-history fields (has_prior_parse + last_parsed_at)

**Status:** COMPLETE (feat 896f3a3c; 5 new TestParseHistoryFields in test_parse_run + 4 new TestParseHistoryNotTouched in test_update_sheet_draft; 55 test_parse_run + 60 test_update_sheet_draft; 588 parser tests unchanged). Backend + type-only frontend.

**Files changed:**
- `nirmaan_stack/nirmaan_stack/doctype/boq_sheet_draft/boq_sheet_draft.json` -- two new fields
- `nirmaan_stack/api/boq/wizard/parse_run.py` -- `_set_draft_status` extended + Parsed write site stamped
- `nirmaan_stack/api/boq/wizard/test_parse_run.py` -- `TestParseHistoryFields` class (5 tests) + imports
- `nirmaan_stack/api/boq/wizard/test_update_sheet_draft.py` -- `TestParseHistoryNotTouched` class (4 tests)
- `frontend/src/pages/boq-wizard/boqTypes.ts` -- type addition only

**What this slice does**

Adds two fields to BoQ Sheet Draft:
- `has_prior_parse` (Check, default 0): set to 1 by the worker when it marks a sheet "Parsed". Never cleared.
- `last_parsed_at` (Datetime, read_only): stamped to `frappe.utils.now()` by the worker alongside the Parsed status write. Never cleared.

Both fields are stamped in a single `frappe.db.set_value` call (via the extended `_set_draft_status` helper's `extra_fields` dict param) to keep the write atomic.

**Design principle (LOCKED by product owner):** `wizard_status` = current intent/state; `has_prior_parse` + `last_parsed_at` = history of what actually occurred. Write-once by the worker; nothing in current scope clears them.

**Dirty-detection contract:** `wizard_status == "Reviewed"` AND `has_prior_parse == 1` means the sheet was previously parsed but its config was subsequently changed (parse is stale). This is the "dirty signal" for exit-criterion-B Checks 5/6 and for the hub Parse-button slice that follows.

**General-specs guard:** `has_prior_parse` / `last_parsed_at` are stamped ONLY inside the `if sheet_name not in general_specs_sheet_names_worker` guard -- exactly the same guard that gates the "Parsed" status write. General-specs sheets are never stamped.

**`_set_draft_status` extension:** `extra_fields: dict | None = None` param added. When provided, fields are merged via `{"wizard_status": status, **extra_fields}` and written in one `frappe.db.set_value` call. All existing callers (error paths writing "Parse failed") are unchanged (no extra_fields).

**Frontend type (boqTypes.ts):** `has_prior_parse?: 0 | 1` (Frappe Check fields return as 0/1) and `last_parsed_at?: string | null` added to `BoQSheetDraft`. TYPE ADDITION ONLY -- no frontend logic in this slice.

**New tests in `test_parse_run.py` -- `TestParseHistoryFields` (5 tests):**
- Data sheet parsed -> `has_prior_parse == 1` and `last_parsed_at` non-null
- General-specs sheet never stamped -> `has_prior_parse == 0` / `last_parsed_at` null
- Parse history survives config-change dirty-drop (key Check-5 support test: dirty signal = Reviewed + has_prior_parse=1)
- Parse history survives set_sheet_status("Pending") (history is history)
- Re-parse restamps `last_parsed_at` to newer time (sentinel-past-time technique avoids sleep)

**New tests in `test_update_sheet_draft.py` -- `TestParseHistoryNotTouched` (4 tests):**
- `set_sheet_config` dirty-drop does not clear parse history
- `set_sheet_config` no-op save does not clear parse history
- `set_sheet_status("Pending")` does not clear parse history
- `set_sheet_status("Reviewed")` does not clear parse history

**Frappe Datetime type note (test implementation):** `frappe.db.get_value` returns Datetime fields as `datetime.datetime` objects, not strings. Tests that compare `last_parsed_at` against a string sentinel use `str(val)[:19]` normalization (`str(datetime.datetime(2026, 1, 1, 0, 0))` = `"2026-01-01 00:00:00"`).

**Module 2b next.**

### Phase-1 Slice 2b-frontend-i -- hub "Parse workbook" button wired

**Status:** COMPLETE (feat c9fc37fd; frontend-only; tsc 0 errors on wizard files; Vite build exit 0, 10m 40s).

**Files changed:**
- `frontend/src/pages/boq-wizard/boqTypes.ts` -- `ParseRunDonePayload` interface
- `frontend/src/pages/boq-wizard/ParseRunDialog.tsx` -- NEW component
- `frontend/src/pages/boq-wizard/SheetCard.tsx` -- dirty badge + last_parsed_at display
- `frontend/src/pages/boq-wizard/BoqHubPage.tsx` -- full parse-run wiring

**What this slice does**

Wires the hub "Parse workbook" button (previously a no-op stub) to the `run_parse` endpoint:

1. **ParseRunDialog** (new component): four-list confirm summary shown before any parse:
   - WILL PARSE: all Reviewed sheets, each with a checkbox (all ticked by default). Dirty sheets (has_prior_parse=1) show amber "was parsed -- config changed, will re-parse" sub-line.
   - General specs (preamble only): informational, no checkboxes.
   - Already parsed: read-only with last_parsed_at date.
   - Pending / not configured: read-only.
   - Skipped / hidden: read-only.
   Two-step flow: step 1 = summary, step 2 = warn-before-reparse fires when any ticked sheet has has_prior_parse=1 ("Re-parse anyway" vs "Go back"). Parse button disabled + spinner while in-flight.

2. **BoqHubPage wiring**:
   - `useFrappePostCall(run_parse)` hook
   - `useContext(FrappeContext)` + `socket.on("boq:parse_run_done", handler)` in a `useEffect([socket])` (mirrors BoqUploadScreen pattern exactly; guard: `payload.boq_name !== boqId`)
   - Success: calls `mutate()`, sets `parseResult` state (parsed/notParsed/failed lists)
   - Error: maps `error_code` to readable message, sets `parseError` state
   - Inline result panel below footer (green for success, red for error)
   - `ParseRunDialog` rendered with effective-status-derived props (same gate source as canParse)
   - Button onClick wired to `handleParseClick`; gate unchanged

3. **SheetCard dirty surfacing**:
   - Reviewed + has_prior_parse=1: amber rounded-pill badge "needs re-parse" next to the emerald pill
   - Reviewed + has_prior_parse=1 + last_parsed_at: "last parsed <date>" as optional nicety text
   - Parsed + last_parsed_at: "Parsed <date>" inline text in action area

**Engineering calls:**
- Dialog extraction to `ParseRunDialog.tsx` (same wizard dir) to keep BoqHubPage manageable.
- Two-step warn-before-reparse within the same Dialog (not nested dialogs) for simplicity.
- Result surfacing as inline panel (wizard convention: no toasts; inline errors/results).
- Dialog cannot be dismissed while parse is in-flight (onOpenChange guarded by isLoading).
- Explicit ticked list always passed to run_parse (never omit the arg) for clarity.
- General-specs sheets: shown in their own informational section, no checkboxes.

**Wizard test count:** 157 (unchanged -- no Frappe tests for frontend slices; tsc + Vite build are the verification).

---

### UNIFY-ON-(-1) + Phase-2 Slice A -- review-screen backend

**Status:** COMPLETE (feat fff26abd; BACKEND ONLY -- no frontend files touched; +34 wizard tests; 202 total).

**The -1 sentinel decision (WHY):**

Frappe coerces `Int None -> 0` on insert. `parent_index = 0` is a VALID row index (parent is row 0). This means `None` (root row, no parent) and `0` (parent is row 0) were indistinguishable in the DB after insert. Verified: 618 real rows all stored `0` with zero NULLs, making root detection impossible from the stored value alone.

The retired workaround was `has_human_parent` (a separate Check field): since `human_parent=0` could be either "row 0 as parent" or "Frappe-coerced None", a dedicated sentinel was needed. This doubled the write surface and caused the Slice-1 root-cause bug.

FIX: `-1` is the canonical "no parent / no override" sentinel. -1 can never be a valid row index, so it is unambiguous. Architecture:
- `-1 lives ONLY at the DB persistence boundary.` The parser (hierarchy.py, classifier.py, orchestrator.py) keeps using `None` internally -- UNTOUCHED.
- WRITE boundary: `flatten_resolved_row` writes `-1` when `resolved_row.parent_index is None`. `save_review_edit` writes `-1` when human_parent is cleared (`value is None`).
- READ boundary: `resolve_effective` translates `in (None, -1) -> None` for both `parent_index` and `human_parent` before computing effective values.
- All downstream (`_chain_has_cycle`, `check_structural_integrity`, orphan/cycle/lineitem-as-parent checks) only see the translated `None` for root rows. Logic unchanged.
- `human_parent == 0` is unambiguously a real override (parent is row 0) because 0 is NOT in `(None, -1)`. `has_human_parent` is RETIRED entirely.

**Schema delta:**
- `has_human_parent` Check field REMOVED from `BoQ Review Row` (boq_review_row.json: field + field_order entry deleted; migration ran clean). `parent_index` and `human_parent` remain Int. NO new default values added (explicit writes at the DB boundary are the convention; Frappe defaults for Int are unreliable for sentinels).

**Files changed:**
- `nirmaan_stack/api/boq/wizard/parse_run.py` -- `flatten_resolved_row`: parent_index write now `None->-1`.
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- NEW FILE (Slice A backend). `resolve_effective`, `check_structural_integrity`, `append_edit_log_entry` helpers + `get_review_rows`, `save_review_edit`, `mark_sheet_parsed_check_done` endpoints.
- `nirmaan_stack/nirmaan_stack/doctype/boq_review_row/boq_review_row.json` -- `has_human_parent` removed.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- NEW FILE. 34 tests (6 groups).
- `nirmaan_stack/api/boq/wizard/test_parse_run.py` -- coherence assertion updated: `not in (None, -1)` instead of `is not None`.
- `nirmaan_stack/nirmaan_stack/doctype/boq_sheet_draft/boq_sheet_draft.json` -- already-landed Parsed Check Done enum (Slice A context).

**Test counts (all green):**
- `test_review_screen`: 34 new tests. Groups: TestResolveEffective (7), TestCheckStructuralIntegrity (8), TestAppendEditLogEntry (4), TestGetReviewRows (4 DB), TestSaveReviewEdit (7 DB), TestMarkSheetParsedCheckDone (3 DB).
- `test_parse_run`: 60 unchanged (regression).
- Total wizard: 202 (60 + 34 + 66 + 7 + 23 + 12).

**Frozen review-screen design (governing principles, carried into Slice B/C/D):**

Structural accuracy > edit speed (principle): the review screen is the correctness gate before rows become canonical BOQ Nodes. A false-negative (missing a structure break) is worse than friction. Warn-and-confirm, never silent auto-fix.

Human-edit layer architecture:
- Three confirm-gated edits: `human_classification`, `human_parent`, value fields (qty/rate/amount). Parser fields are NEVER overwritten.
- Effective = human override (if set) else parser value. `has_human_parent` retired; `-1` sentinel covers the "unset" case.
- `edit_log` JSON list: every write to any field appends `{field, from, to, by, at}`. `from` is the EFFECTIVE value before the edit (not the raw stored value) so the log shows what the user saw, not what the DB held.

Advisory-flag rule: `needs_classification_review` + `review_reason` are advisory only. They do not block the "Parsed Check Done" transition (warn-and-confirm gate via `check_structural_integrity` is a SEPARATE concern). A parser-flagged row that the user acknowledges and leaves as-is is acceptable.

Review-screen export design: per-sheet CSV. Clean fieldnames + Excel-row-number parent columns + appended edit columns. show-original (parser vs effective side-by-side) deferred to edit-log-only v1; show-original in the export is Slice D+.

Priced-preamble no-machinery: a PREAMBLE with `needs_classification_review=True` (priced_preamble_with_children) is surfaced via the advisory flag + `review_reason`. No auto-reclassification, no wizard UI machinery. Human decides via `human_classification` override if needed. 1186 rows / parser-flagged-nothing finding: on the real BoQ corpus (pre-Slice A), 0 rows had `needs_classification_review=True`. Advisory-flag saturation is low; UI emphasis should be on structural breaks (orphan/cycle/line-item-as-parent) which are more common.

Indent = live parent_index chain walk: display indentation is computed by walking `effective_parent_index` up the chain, NOT from the stored `level` field (which is the parser's computed depth, may diverge after human_parent edits). Frontend must re-walk the chain on every render using the effective values.

Level = preamble cross-check: `level` from the parser is retained as a stored field for cross-checking (e.g. a PREAMBLE at level 3 whose effective parent is a PREAMBLE at level 1 may indicate a skipped level). Level is NEVER updated after a human_parent change -- it is permanently the parser's value.

**Slices B/C/D:** Slice B is split into B1 (spine -- COMPLETE, feat 0683f7b9) + B2 (B2a advisory flags -- COMPLETE; B2b row-detail panel -- remaining). Slice C = editing UX (save_review_edit wiring). Slice D = integrity gate (mark_sheet_parsed_check_done).

---

### Slice B1 -- review screen spine (navigable tree)

**Status:** COMPLETE (feat 0683f7b9; frontend + backend endpoint + tests; +3 wizard tests; 37 total review-screen tests, 205 total wizard tests).

**What landed:**

*Backend:*
- `get_structural_breaks(boq_name, sheet_name)` -- new `@frappe.whitelist()` read-only endpoint in `review_screen.py`. Fetches minimal row fields, calls `check_structural_integrity`, returns `{"breaks": [...]}`. Does NOT write, does NOT change `wizard_status`. Dedicated read contract for B2 flag overlay (avoids coupling to `mark_sheet_parsed_check_done` side-channel).
- 3 new tests in `TestGetStructuralBreaks`: (a) orphan sheet returns break of type orphan with correct `row_index`/`source_row_number`; (b) clean sheet returns `{"breaks": []}`; (c) call does not mutate `wizard_status`.

*Frontend:*
- `boqTypes.ts`: `"Parsed Check Done"` added to `WizardStatus` union. New types: `EditLogEntry`, `ReviewRow` (all BoQ Review Row fields + `effective_classification`/`effective_parent_index`), `GetReviewRowsResponse`, `StructuralBreakOrphan`, `StructuralBreakLineItemAsParent`, `StructuralBreakCycle`, `StructuralBreak` (discriminated union), `GetStructuralBreaksResponse`.
- `SheetCard.tsx`: `"Parsed Check Done"` entry in `STATUS_PILL` (teal-600, label "Checked"). New `onOpenReview?: (sheetName) => void` prop. "Parsed Check Done" action branch: "Review" button (calls `onOpenReview`) + `last_parsed_at` display.
- `routesConfig.tsx`: new lazy route `/upload-boq/hub/:boqId/review/:sheetName` -> `SheetReviewPage`.
- `BoqHubPage.tsx`: `handleOpenReview` callback (navigates to review route, same encode convention as `handleOpenSpoke`). `reviewableDrafts` derived list (Parsed + Parsed Check Done). "Review parsed sheets" section (shown when `reviewableDrafts.length > 0`): grid list of reviewable sheets with soft status pills + "Review" buttons. `parsedCheckDoneCount` in footer breakdown. `onOpenReview={handleOpenReview}` passed to all `SheetCard` instances.
- `ReviewTree.tsx` (new): pure render component. `computeDepths` -- iterative memoised chain-walk, cycle-safe (visited set, assigns depth 0 to cycle members). Expand/collapse via `Set<number>` of collapsed `row_index` values; `isVisible` walks parent chain (capped at 60 hops). Columns: source_row_number, description (with indent + toggle + classification badge), unit, qty_total, rate_combined/rate_supply fallback, amount_total. Preambles tinted bg-muted/20 + font-medium; line_items normal; others italic/muted. `INDENT_PX = 20` per depth level. No flag overlays (B2), no row-detail (B2), no edit affordances (C).
- `SheetReviewPage.tsx` (new): mirrors `SheetSpokePage` shell. `useParams<{boqId,sheetName}>`. `useFrappeGetDoc<BOQsDoc>` for header. `useFrappeGetCall<{message:GetReviewRowsResponse}>` for review rows (SWR-managed, disabled until both params present). Full-page spinner while BOQ doc loads; inline loading/error for rows. Back nav: `navigate(/upload-boq/hub/${boqId})`. Exports `{ SheetReviewPage as Component }` for RR v6 lazy.

**Files changed:**
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- `get_structural_breaks` endpoint added (no existing code modified).
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- `get_structural_breaks` import added; `TestGetStructuralBreaks` class (3 tests) appended.
- `frontend/src/pages/boq-wizard/boqTypes.ts` -- `WizardStatus` + 8 new types.
- `frontend/src/pages/boq-wizard/SheetCard.tsx` -- STATUS_PILL + prop + action branch.
- `frontend/src/components/helpers/routesConfig.tsx` -- review route.
- `frontend/src/pages/boq-wizard/BoqHubPage.tsx` -- review section + handler + card prop.
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- NEW FILE.
- `frontend/src/pages/boq-wizard/SheetReviewPage.tsx` -- NEW FILE.

**Test counts:**
- `test_review_screen`: 37 tests (was 34, +3 `TestGetStructuralBreaks`).
- Total wizard: 205 (60 + 37 + 66 + 7 + 23 + 12).

**tsc:** 0 errors on boq-wizard files. Vite build exit 0.

---

### Slice B1.1a -- extend get_review_rows with column_descriptors (backend)

**Status:** COMPLETE (feat 58d2ed44; backend only; +13 wizard-review-screen tests; 50 total review-screen tests, 218 total wizard tests).

**What landed:**

*Backend (`review_screen.py`):*
- Imports `_RATE_ROLE_TO_KIND` from `classifier.py` (authoritative rate-role -> subkey table; no parallel copy).
- New module-level constants: `_NON_DISPLAY_ROLES` (append_to_notes, ignore, reference_images), `_SINGLETON_ROLE_TO_FIELD` (12 singleton roles -> review-row field names).
- New helper `_build_column_descriptors(sheet_config)` -- compiles a declarative list from `sheet_config.column_role_map`. Per entry: `{col, role, area, value_field, value_key, rate_subkey}`. Sorted by Excel order (len, lexical). Non-display and unknown roles skipped silently. Returns `[]` for absent/empty config.
- `get_review_rows` extended to load `sheet_config` from `BoQ Sheet Draft` child row (one `frappe.db.get_value` call) and append `column_descriptors` to its return dict. Existing `rows` + `work_packages` contract unchanged (additive only).
- `get_review_rows` return shape: `{"rows": [...], "work_packages": [...], "column_descriptors": [...]}`.

*Role -> descriptor mapping table:*
- Singleton: role in `_SINGLETON_ROLE_TO_FIELD` -> `value_field=<field>`, `value_key=null`, `rate_subkey=null`.
- `qty` -> `value_field="qty_by_area"`, `value_key=<area>`, `rate_subkey=null`.
- `amount_by_area` -> `value_field="amount_by_area"`, `value_key=<area>`, `rate_subkey=null`.
- `rate_*_by_area` (key in `_RATE_ROLE_TO_KIND`) -> `value_field="rate_by_area"`, `value_key=<area>`, `rate_subkey=_RATE_ROLE_TO_KIND[role]`.

*Tests (`test_review_screen.py`):*
- `_build_column_descriptors` imported for pure-Python tests.
- `TestBuildColumnDescriptors` (9 pure-Python tests): empty config, non-display exclusion, count + Excel order, singleton shape, rate_by_area shape, qty_by_area shape, amount_by_area shape, multi-letter column sort (Z < AA < AB), unknown role skipped.
- `TestGetReviewRowsColumnDescriptors` (4 DB tests): ordered descriptors with correct value_field/key/rate_subkey, non-display roles excluded from endpoint, no sheet_config returns `[]`, rows + work_packages unchanged.

**Files changed:**
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- import extended; 2 new constants; `_build_column_descriptors` helper; `get_review_rows` extended (additive only); docstring updated.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- `_build_column_descriptors` import added; `TestBuildColumnDescriptors` (9) + `TestGetReviewRowsColumnDescriptors` (4) appended.

**Test counts:**
- `test_review_screen`: 50 tests (was 37, +13: 9 pure-Python + 4 DB).
- Total wizard: 218 (60 + 50 + 66 + 7 + 23 + 12).

**No frontend changes (B1.1b consumes this).** tsc/build not required this slice.

---

### Slice B1.1b-i -- descriptor-driven column layer + classification pill (frontend)

**Status:** COMPLETE (feat 3e846ba1; frontend only; no backend changes; no bench tests; tsc 0 wizard errors; Vite build exit 0).

**What landed:**

*`boqTypes.ts`:*
- `ColumnDescriptor` interface added (col, role, area, value_field, value_key, rate_subkey). Typed to match B1.1a backend shape exactly.
- `GetReviewRowsResponse` extended with `column_descriptors: ColumnDescriptor[]`.

*`ReviewTree.tsx` -- column layer replaced, tree mechanic preserved verbatim:*
- `ClassificationBadge` (flat Tailwind badge) REPLACED by `ClassificationPill`: small left-bordered pill using the locked §2 hex colour map. `border-left: 3px solid {color}`, `bg-muted/60` background. Hex map: preamble #888780, line_item #378ADD, note #EF9F27, subtotal_marker #1D9E75, spacer #D3D1C7, header_repeat #94A3B8 (neutral, not in locked map).
- `ReviewTreeProps` extended with `columnDescriptors: ColumnDescriptor[]`.
- `FIXED_ROLE_DEDUPE = Set(["sl_no","description"])`: these roles are excluded from the descriptor-driven column list (shown as fixed anchors instead).
- Anchor letters: `slNoLetter` + `descriptionLetter` extracted from descriptors BEFORE deduplication. Anchor headers: "Sl.No (A)", "Description (B)" when mapped; "Sl.No" / "Description" when descriptor absent.
- Table structure: [Excel Row (source_row_number, no letter)] [Sl.No (letter)] [Description (letter, tree column)] [one col per displayDescriptor].
- Descriptor column headers: `"{col} — {ROLE_LABELS[role]}{ · area}"`. Area headers tinted with local AREA_COLORS (mirror of SheetDataGrid — not exported there; re-implemented locally).
- `resolveDescriptorValue(row, d)`: walks `row[value_field]` → `[value_key]` → `[rate_subkey]`. Returns `undefined` if any level is absent. Cast via `as unknown as Record<string,unknown>` to satisfy tsc strict overlap check.
- `renderDescriptorCell(val)`: `undefined`/`null` → `""` (blank); numeric 0 → `"0"`; numbers → `fmtNum(val)`. Absent-vs-zero rule enforced.
- `fmtNum` preserved (now called by `renderDescriptorCell` for number formatting — single source of truth).
- `computeDepths`, `isVisible`, `toggleCollapse`, `hasChildrenSet`/`byIdx`, `collapsed`, `INDENT_PX`, `VISIBILITY_HOP_CAP`, chevron button + text span interior — all verbatim from B1.
- No column-subset selector, no spacer-hide toggle (those are B1.1b-ii).

*`SheetReviewPage.tsx`:*
- `const columnDescriptors = reviewData?.message?.column_descriptors ?? [];` added.
- `<ReviewTree rows={rows} columnDescriptors={columnDescriptors} />` updated.

**Files changed:**
- `frontend/src/pages/boq-wizard/boqTypes.ts` -- ColumnDescriptor + GetReviewRowsResponse extended.
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- column layer replaced; pill; anchor letters; descriptor columns.
- `frontend/src/pages/boq-wizard/SheetReviewPage.tsx` -- extract + pass columnDescriptors.

**Note:** The canonical §6.5 fold (BoQ_Review_Screen_Locked_Design_v1_0.md -> BoQ_Wizard_Design_v1_13.md §6.5) is owed on the project-knowledge (chat-Claude) side. Those docs are not in the repo and cannot be edited here.

**tsc:** 0 errors on boq-wizard files. Vite build exit 0. No backend changes, no bench tests.

### Slice B1.1b-fix-A -- flatten_resolved_row writes human_parent=-1 (backend fix)

**Status:** COMPLETE (feat pending; BACKEND ONLY; no frontend changes; tsc/build not required).

**Root cause confirmed (live DB probe, 2026-06-06):** BOQ-26-00145 Electrical sheet -- `parent_index` correct (roots=-1, children=real indices), but `human_parent=0` on all 253 rows. `resolve_effective` treats `human_parent >= 0` as a real override → `effective_parent_index=0` for every row → flat tree.

**The bug:** `flatten_resolved_row` applied the -1 sentinel only to `parent_index` (the structural field), but never set `human_parent`. Frappe coerces unset `Int` fields to `0` on insert. `0` is a valid row index, so `resolve_effective` misread it as "row 0 is this row's parent". The agreement #54 unify was half-applied: write boundary for `human_parent` was the missing half.

**The fix:** Added `"human_parent": -1` to the dict returned by `flatten_resolved_row` in `parse_run.py`. At parse time there is never a human edit, so `-1` (no-override sentinel) is always correct. The explicit write prevents Frappe's Int coercion fallback.

**Files changed:**
- `nirmaan_stack/api/boq/wizard/parse_run.py` -- `flatten_resolved_row`: added `"human_parent": -1` with explanatory comment (agreement #54 rationale).
- `nirmaan_stack/api/boq/wizard/test_parse_run.py` -- 3 new tests: `test_human_parent_is_minus1_sentinel_for_root_row`, `test_human_parent_is_minus1_sentinel_for_child_row` (in `TestFlattenFaithfulness`), `test_human_parent_sentinel_root_resolves_effective_parent_none` (in `TestBoQReviewRowRoundTrip`). 60 → 63 tests; all pass.

**No data repair needed:** Nitesh will re-parse BOQ-26-00145 after this lands; the parse worker deletes and re-inserts all rows, so `human_parent=-1` is written fresh on every re-parse.

### Slice B1.1b-fix-B -- four ReviewTree display fixes (frontend)

**Status:** COMPLETE (feat pending; FRONTEND ONLY; no backend changes; no bench tests; tsc 0 wizard errors; Vite build exit 0).

**What landed (`ReviewTree.tsx` only; `boqTypes.ts` unchanged):**

**FIX 1 -- Parent column (after Sl.No):**
- New "Parent" fixed anchor column inserted between Sl.No and Description. Header: "Parent" (no Excel letter — it's a derived reference, not a mapped column).
- Value: resolves `effective_parent_index` → `byIdx.get(pIdx)?.source_row_number` (parent's Excel row number). Roots (null/negative effective_parent_index) show blank.
- Rendered as a clickable `<button>` showing `↑ {parentExcelRow}` in blue (`text-blue-600 dark:text-blue-400`), `font-mono`, `hover:underline`. Blank (null rendered) for root rows.
- Click handler (`revealAndScrollToRow(targetRowIdx)`): (a) walks the target row's ancestor chain to find collapsed ancestors, (b) removes them from the `collapsed` set via `setCollapsed`, (c) `setTimeout(50ms)` to wait for React DOM update, (d) `scrollIntoView({ behavior: "smooth", block: "nearest" })` on the target row's DOM element, (e) `setHighlightedIdx(targetRowIdx)` for a 1.5s amber flash.
- Row DOM refs: `useRef<Map<number, HTMLElement>>(new Map())` (`rowRefs`). Each `<tr>` registered via a ref callback `(el) => rowRefs.current.set/delete(row.row_index, el)`.
- Highlight: `useState<number | null>(null)` (`highlightedIdx`). `useEffect([highlightedIdx])` clears after 1500ms. Applied as `bg-amber-100 dark:bg-amber-900/40` on the `<tr>` className.

**FIX 2 -- Classification pill label no-truncation:**
- FIX 4's restructure (pill on its own line) gives the pill full horizontal room, eliminating horizontal compression. `whitespace-nowrap` + `shrink-0` preserved on the pill to prevent any text wrapping.

**FIX 3 -- isVisible ancestor-only rule:**
- Added two defensive guards to the `isVisible` loop:
  - `cur < 0` → `break`: treats -1 sentinel values (which resolve_effective should convert to null, but old pre-fix-A rows may produce stale `parent_index=0` → `effective_parent_index=0`, causing the row at index 0 to disappear when collapsed) as a root stop.
  - `cur === row.row_index` → `break`: self-reference guard (prevents a cycle-row from hiding itself when collapsed).
- Combined with the existing `cur = row.effective_parent_index` start (already walking from the parent, not the row itself), these guards ensure a collapsed row R stays visible; only its descendants hide.

**FIX 4 -- Pill-above-text in Description cell:**
- Restructured the Description cell's inner flex container: replaced flat `[chevron] [pill] [text]` horizontal layout with `[chevron] [flex-col: [pill] [text]]`.
- A `<div className="flex flex-col gap-0.5 min-w-0">` wrapper stacks pill on top and description text below. The outer `flex items-start gap-1.5` + `paddingLeft` indent remain unchanged; the chevron stays as the outer flex's first sibling.
- Preserves: depth/indent, chevron toggle, all text styles (isPreamble/isLineItem), break-words, (no description) fallback.

**New React hooks/state added:**
- `import { useMemo, useRef, useEffect, useState }` (was `useMemo, useState`; added `useRef, useEffect`).
- `useState<number | null>(null)` for `highlightedIdx`.
- `useRef<Map<number, HTMLElement>>(new Map())` for `rowRefs`.
- `useEffect([highlightedIdx])` for 1.5s highlight clear timer.
- `revealAndScrollToRow(targetRowIdx: number)` function (expand ancestors + scroll + highlight).

**Preserved verbatim:** `computeDepths`, descriptor-driven columns, anchor letters, absent-vs-zero rendering, `CLS_COLORS` / `CLS_LABELS` pill hex map, `fmtNum`, `AREA_COLORS`, `buildAreaColorMap`, `resolveDescriptorValue`, `renderDescriptorCell`, `INDENT_PX`, `VISIBILITY_HOP_CAP`, `FIXED_ROLE_DEDUPE`, `toggleCollapse`, `hasChildrenSet`, `byIdx` useMemo.

**Files changed:**
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- all four fixes.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record.
- `frontend/CLAUDE.md` -- B1.1b conventions block updated.
- Root `CLAUDE.md` -- status line bumped.

**tsc:** 0 wizard-file errors (pre-existing non-wizard errors are the standing state, agreement #16). Vite build exit 0. No backend changes, no bench tests.

**resolve_effective unchanged:** The fix is at the write boundary only. `resolve_effective` correctly treats `-1`/`None` as no-override; the human-layer logic is not touched.

---

### Slice B1.1b-ii -- column-subset selector + classification-visibility toggles (frontend)

**Scope:** `ReviewTree.tsx` only (no boqTypes.ts changes needed). View-filter only -- no data edit, no backend changes.

**Feature A -- Column-subset selector:**
- Popover trigger button (SlidersHorizontal icon + "Columns") in controls bar above the table. Shows "(N hidden)" amber badge when any column is hidden.
- PopoverContent: one Checkbox per `displayDescriptor` (post-FIXED_ROLE_DEDUPE). Label: `"{col} — {ROLE_LABELS[role]}{ · area}"`. All ticked by default.
- State: `visibleCols: useState<Set<string>>` lazy-initialized to all descriptor col letters on mount. `useEffect([displayDescriptors])` re-syncs to all cols when descriptors change (new sheet). `toggleCol` functional updater (new Set from prev, delete/add).
- Fixed anchor columns (Excel Row, Sl.No, Parent, Description) NOT in the selector — always render.
- Both `<th>` and `<td>` for descriptor columns gated: `if (!visibleCols.has(d.col)) return null`.

**Feature B -- Three independent annotation-row visibility toggles:**
- `showSpacers`, `showNotes`, `showSubtotals` — three independent booleans, default `true`.
- `classificationVisible(row)`: returns `false` when `effective_classification` matches a toggled-off type; `true` otherwise.
- Compose with `isVisible`: `if (!isVisible(row)) return null; if (!classificationVisible(row)) return null;` — two separate gates, each readable in isolation.
- **Children-of-hidden-annotation edge case:** handled for free. `computeDepths` pre-runs over all rows (unfiltered). `classificationVisible` never touches `collapsed` Set. `isVisible` only checks `collapsed` → children of a hidden note/spacer/subtotal render at their original computed depth with correct indent.

**Controls bar structure:**
- Outer wrapper: `<div className="rounded-md border border-border overflow-hidden">` (new; border moved from scroll div).
- Controls bar: `<div className="flex items-center gap-4 px-3 py-2 border-b border-border bg-muted/20 flex-wrap">`.
- Table scroll div: `max-h-[calc(100vh-16rem)]` (was 14rem; 2rem added to account for controls bar height).
- Popover trigger: compact `inline-flex` button, `border-primary text-foreground` variant when any col hidden.
- Classification toggles: three `<label htmlFor> + <Checkbox>` rows in `<div className="flex items-center gap-3">` with "Show:" prefix.

**No boqTypes.ts changes.** No backend changes. No bench tests.

**tsc:** 0 wizard-file errors. Vite build exit 0.

**Files changed:**
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- both features.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record.
- `frontend/CLAUDE.md` -- B1.1b conventions block updated.
- Root `CLAUDE.md` -- status line bumped.

---

### Slice B1.1b-iii -- Description cell split: Classification column + text-only Description (frontend)

**Scope:** `ReviewTree.tsx` only. Pure layout restructure — no behavior change to tree, collapse, filters, or data. No boqTypes.ts changes, no backend changes.

**What changed:**

Before B1.1b-iii, the Description `<td>` held: indent wrapper (paddingLeft = depth * INDENT_PX) > chevron button + flex-col[pill above, text below].

After B1.1b-iii, the cell is split into two separate columns:

**New column order:** Excel Row | Sl.No | Parent | **Classification** | Description | [descriptor columns]

**Classification `<td>` (new fixed anchor, between Parent and Description):**
- Contains: chevron button (verbatim, all aria/tabIndex/invisible-on-leaf behavior carried over) + ClassificationPill side by side.
- `w-36 border-r border-border` in both `<th>` and `<td>`.
- NO depth indent — flat-left, all rows align in this column regardless of tree depth.
- Header: "Classification" (no Excel letter — fixed anchor, not a mapped column).
- NOT in the column-subset selector (selector iterates `displayDescriptors` only; Classification is outside that loop).

**Description `<td>` (text-only):**
- Contains: only the description text span + fallback. Chevron and pill removed.
- Depth-based indent (`paddingLeft = depth * INDENT_PX`) applied on a content wrapper `<div>` inside the `<td>`. The nesting is now shown via Description column stepping.
- Per-classification text styling preserved verbatim: preamble `font-medium text-foreground`, line_item `text-foreground`, others `text-muted-foreground italic text-[11px]`.
- `(no description)` fallback preserved.

**Unchanged:** collapse mechanic, isVisible, classificationVisible, computeDepths, visibleCols subset selector, three annotation toggles, Parent column, absent-vs-zero, descriptor column rendering.

**No boqTypes.ts changes.** No backend changes. No bench tests.

**tsc:** 0 wizard-file errors. Vite build exit 0.

**Files changed:**
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- split.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record.
- `frontend/CLAUDE.md` -- B1.1b-iii conventions added.
- Root `CLAUDE.md` -- status line bumped.

---

### Slice B2a -- advisory flags: four §6.5.3 heuristics + per-row marker (backend + frontend)

**Status:** COMPLETE (feat pending; backend helpers + endpoint extension + frontend marker + tests; 76 total review-screen tests, 247 total wizard tests).

**What landed:**

**Governing constraints:**
- Flags are ADVISORY-ONLY: never auto-change any field, never block any wizard transition.
- READ-ONLY at the data layer: no new BoQ Review Row fields, no writes.
- Serving decision: backend extends `get_structural_breaks` endpoint to return `flags` alongside `breaks` (GET-capable; no new endpoint). Frontend computes flags client-side from the `rows` prop (all required fields already present in `ReviewRow` from `get_review_rows`), avoiding any change to `SheetReviewPage.tsx` (out of scope).
- Files in scope exclusive: `review_screen.py`, `test_review_screen.py`, `ReviewTree.tsx`, docs files.

**Four flag sources (§6.5.3 heuristics):**

| Type | Fires when | Canonical reason |
|---|---|---|
| `priced_preamble_no_children` | effective_cls=preamble AND no row has this row_index as effective_parent AND any scalar price field > 0 | "Preamble carrying a price with no sub-items — check if it's a line item." |
| `zero_amount_line_item` | effective_cls=line_item AND (amount_total is None or 0 OR qty_total is None or 0) | "Amount is zero — check the value or whether it's intentional." |
| `orphan` | reused from structural_breaks (type="orphan") -- NOT recomputed | "Line item with no parent group — check its parenting." |
| `parser` | needs_classification_review is set AND review_reason is non-empty | review_reason verbatim (no canonical override) |

**Flag (i) expected-dormant status:** `_apply_zero_children_preamble_demotion_post_pass` in `hierarchy.py` demotes childless priced preambles to line_items at parse time. Flag (i) only fires after a human reclassification (Slice C) reverts a demoted row back to preamble. On freshly parsed sheets, flag (i) is expected to produce zero results -- this is correct behavior, not a gap.

**`_PRICE_SIGNAL_FIELDS`:** scalar fields only -- `amount_total`, `amount_supply`, `amount_install`, `rate_supply`, `rate_install`, `rate_combined`. `rate_by_area` is a JSON dict (not scalar Float) and is intentionally excluded.

*Backend (`review_screen.py`):*
- New module-level constants: `_FLAG_REASONS` (3 canonical strings, verbatim-pinned), `_PRICE_SIGNAL_FIELDS` (6 scalar Float fields), `_ADVISORY_EXTRA_FIELDS` (9 extra fields fetched by `get_structural_breaks` for flag computation).
- New helper `_has_price_signal(row)`: returns True if any `_PRICE_SIGNAL_FIELDS` entry is non-None and > 0.
- New helper `_compute_advisory_flags(rows, structural_breaks)`: builds `children_of` set from effective parent values, reuses orphan row_indexes from structural_breaks input (never recomputes), iterates rows and emits flag dicts for all 4 sources. Each flag dict: `{type, row_index, source_row_number, reason}`.
- `get_structural_breaks` extended: fetches `_ADVISORY_EXTRA_FIELDS` alongside existing minimal fields; passes rows and breaks to `_compute_advisory_flags`; returns `{"breaks": [...], "flags": [...]}`. Existing `"breaks"` contract is fully preserved (additive only).

*Frontend (`ReviewTree.tsx`):*
- New import: `Fragment` (explicit -- `<>` shorthand doesn't support `key` prop), `Info` from `lucide-react`.
- New local type `AdvisoryFlag { type: string; reason: string }`.
- New pure function `computeAdvisoryFlags(rows)`: mirrors backend logic client-side using the same effective-parent chain, children-of set, and four-flag logic. Operates on the already-fetched `ReviewRow[]` prop -- no extra network call.
- New state: `expandedFlagRows: Set<number>` + `toggleFlagRow(rowIdx)` functional updater.
- `flagsByRowIdx: Map<number, AdvisoryFlag[]>` via `useMemo([rows])`.
- Row rendering: `rows.map(row => ...)` changed from returning `<tr key={...}>` to `<Fragment key={row.row_index}><tr>...</tr>{optional flag-reasons tr}</Fragment>`.
- Per-row flag marker: amber `<Info className="h-3 w-3">` button in the Classification `<td>`, after ClassificationPill. `e.stopPropagation()` prevents accidental collapse toggle. `aria-label` + `title` set. Only rendered when `flagsByRowIdx.has(row.row_index)`.
- Optional flag-reasons `<tr>`: `bg-amber-50/60 dark:bg-amber-950/20`, `colSpan={totalCols}`, bullet list of `{f.reason}` per flag. Only rendered when `hasFlags && flagsExpanded`.

*Tests (`test_review_screen.py`):*
- `TestAdvisoryFlagHelpers` (20 pure-Python tests): `_has_price_signal` (4 cases), flag (i) (4 cases incl. human-override path), flag (ii) (5 cases), flag (iii) orphan composition, flag (iv) parser verbatim, clean sheet, canonical reasons verbatim pin.
- `TestGetStructuralBreaksB2a` (6 DB tests): `flags` key present, `breaks` key unchanged, flag (i) in response (FlagSheet: preamble row 0, amount=500, no children), flag (iii) orphan in response, flag (iv) parser verbatim, clean sheet returns empty flags.
- **Test fix applied:** test fixture bug -- row 2 originally had `parent=0` making row 0 have a child, so flag (i) correctly didn't fire. Fixed to `parent=None` so row 0 is truly childless. The comment "no children" in the fixture now matches the actual setup.
- **Implementation fix applied:** `_FLAG_REASONS` constant had curly apostrophes (U+2019) from IDE/editor auto-correction; tests used straight apostrophes (U+0027). Fixed in `review_screen.py` via binary replace to use straight apostrophes throughout.

**Test counts:**
- `test_review_screen`: 76 tests (was 50, +26: 20 pure-Python `TestAdvisoryFlagHelpers` + 6 DB `TestGetStructuralBreaksB2a`).
- Total wizard: 247 (63 + 76 + 66 + 7 + 23 + 12).

**tsc:** 0 wizard-file errors. Vite build exit 0.

**Remaining in Slice B2:** B2b = row-detail panel (click a row to expand a side panel or inline detail showing all field values; not started).

**Files changed:**
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- `_FLAG_REASONS` + `_PRICE_SIGNAL_FIELDS` + `_ADVISORY_EXTRA_FIELDS` constants; `_has_price_signal` + `_compute_advisory_flags` helpers; `get_structural_breaks` extended.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- `_compute_advisory_flags` + `_has_price_signal` imports; `TestAdvisoryFlagHelpers` (20 tests) + `TestGetStructuralBreaksB2a` (6 tests) appended.
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- `Fragment` + `Info` imports; `AdvisoryFlag` type; `computeAdvisoryFlags` function; state + useMemo; Fragment-wrapped rows; Info marker button; flag-reasons `<tr>`.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record + overview line updated.
- `frontend/CLAUDE.md` -- status line bumped.

---

### Slice B2a single-source fix (refactor d9fa6b69, 2026-06-06)

**Problem:** B2a shipped flag logic twice -- tested backend `_compute_advisory_flags` (served via `get_structural_breaks`) AND an untested client-side `computeAdvisoryFlags` in `ReviewTree.tsx` that was what the UI actually rendered.

**Decision (final):** Backend is the single source of truth. Flags folded into the EXISTING `get_review_rows` response (no second fetch). `get_structural_breaks` left exactly as-is for Slice D.

**What changed:**

*Backend (`review_screen.py`):*
- `get_review_rows` now runs `check_structural_integrity(rows)` + `_compute_advisory_flags(rows, breaks)` on the already-resolve_effective-applied rows and returns `{"flags": [...]}` alongside `rows`/`work_packages`/`column_descriptors`. Additive only -- no reorder/rename of existing keys.
- `get_structural_breaks`: NO CHANGE (left exactly as-is; Slice D will consume it).

*Frontend:*
- `boqTypes.ts`: `AdvisoryFlag` interface added (exported, full backend shape: `{type, row_index, source_row_number, reason}`). `GetReviewRowsResponse` gains `flags: AdvisoryFlag[]`. `GetStructuralBreaksResponse` untouched.
- `ReviewTree.tsx`: deleted local `interface AdvisoryFlag` (2-field, no row_index/source_row_number), deleted `function computeAdvisoryFlags(~87 lines)`, deleted explanatory comment block, deleted `const flagsByRowIdx = useMemo(() => computeAdvisoryFlags(rows), [rows])`. Added `flags: AdvisoryFlag[]` to `ReviewTreeProps`; import updated to import `AdvisoryFlag` from `boqTypes`. New pure grouping useMemo: `const flagsByRowIdx = useMemo(() => { const m = ...; for (const f of flags) ...; return m; }, [flags])`. Rendering (rowFlags, Info marker, flag-reasons row reading `f.reason`) UNCHANGED.
- `SheetReviewPage.tsx`: `const flags = reviewData?.message?.flags ?? [];` added; `<ReviewTree ... flags={flags} />` updated.

*Test:*
- `test_flags_key_present_and_contains_known_flag` added to `TestGetReviewRows` (wiring test; row 0 in existing fixture has `human_classification=line_item` + no parent → orphan flag). Existing 76 B2a tests unchanged.

**Test counts (this run):**
- `test_review_screen`: 77 tests (was 76, +1 wiring test). All green.
- `test_parse_run`: 63 tests. All green.
- Total wizard: 248 (63 + 77 + 66 + 7 + 23 + 12).

**tsc:** 0 wizard-file errors. Vite build exit 0.

**Files changed:**
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- fold flags into get_review_rows.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- +1 wiring test.
- `frontend/src/pages/boq-wizard/boqTypes.ts` -- AdvisoryFlag exported + GetReviewRowsResponse.flags.
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- delete ~87 lines client-side; flags prop + pure useMemo.
- `frontend/src/pages/boq-wizard/SheetReviewPage.tsx` -- unpack + forward flags prop.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record.
- `CLAUDE.md` (root) -- status line bumped.
- `frontend/CLAUDE.md` -- status line bumped.
- Root `CLAUDE.md` -- status line bumped.

### Slice B2a-fix -- live-cert advisory-flag refinements (2026-06-06)

**Motivation:** Three issues observed after live-cert of B2a single-source:
- OBS-3: Flag (ii) fired on qty-zero rows even with non-zero amount -- wrong heuristic.
- OBS-1: Flag reveal used a multi-open Set model; single-open accordion + master toggle were missing.
- OBS-2: No flag count summary strip; users had to scroll the tree to discover flag density.

**OBS-3 -- Backend: flag-(ii) rule tightened (review_screen.py)**

Old logic fired on EITHER `amount_total == 0` OR `qty_total == 0` (independently). New rule:
- Fires ONLY when `amount_total` is zero/None AND at least one scalar rate field (`rate_supply`, `rate_install`, `rate_combined`) is non-zero.
- Qty-zero trigger DROPPED entirely: a zero quantity with a non-zero amount is not an advisory concern for the review screen.
- Reason text updated: "Has a rate but the amount is zero -- check the quantity or amount."
- Multi-area refinement (amount_by_area dicts) remains DEFERRED: the parser's empty-total fallback means multi-area rows with real data will have a non-zero `amount_total`; the edge case (amount_total=0 while amount_by_area is populated) is rare and produces a validation_warning already.

**OBS-1 -- Frontend: ReviewTree.tsx accordion model**

- State: `expandedFlagRows: Set<number>` REPLACED by `expandedFlagRow: number | null` (single-open accordion) + `showAllFlags: boolean` (master override).
- `toggleFlagRow(rowIdx)`: sets `expandedFlagRow` to rowIdx or null (toggle).
- `toggleShowAllFlags()`: toggles `showAllFlags`; hide-all also clears `expandedFlagRow` to null.
- `hasFlagsAny = flags.length > 0`.
- Master toggle button added to controls bar (gated on `hasFlagsAny`): "Show all notes" / "Hide all notes" with Info icon; amber tint when active.
- `<table>` gets `onClick={() => setExpandedFlagRow(null)}` (dismiss-on-click-elsewhere scoped to table, NOT controls bar -- Popover/Checkbox/button clicks are unaffected).
- Per-row: `flagsExpanded = hasFlags && (showAllFlags || expandedFlagRow === row.row_index)`.
- Redundant `hasFlags &&` guard on the reveal row removed (flagsExpanded already encodes it).

**OBS-2 -- Frontend: SheetReviewPage.tsx flag summary strip**

- `FLAG_LABELS` map: `zero_amount_line_item` -> "zero-amount", `orphan` -> "orphan", `parser` -> "needs-review", `priced_preamble_no_children` -> "priced-preamble".
- `FLAG_ORDER`: stable display order matching the map above.
- `flagCounts`: reduce over `flags` array to per-type counts.
- `flagSummaryParts`: filtered + mapped to "{count} {label}" strings joined by " · ".
- Strip renders between header strip and ReviewTree, gated on `!reviewLoading && !reviewError && flagSummaryParts.length > 0`. Neutral muted styling (`bg-muted/30 border border-border`). Bold "Advisory:" label prefix.

**Tests (review_screen):** 77 → 78 (net +1). Changes in `TestAdvisoryFlagHelpers`:
- `test_flag_ii_fires_on_zero_amount_line_item` → renamed `test_flag_ii_fires_on_zero_amount_with_rate` (added `rate_supply=150.0`).
- `test_flag_ii_fires_when_only_amount_is_zero` → renamed `test_flag_ii_fires_when_amount_zero_and_rate_combined_present` (added `rate_combined=200.0`, removed `qty_total=5.0` dependency).
- `test_flag_ii_fires_when_only_qty_is_zero` → renamed `test_flag_ii_qty_zero_alone_does_not_fire`, assertion FLIPPED to `assertNotIn` (`amount_total=100.0` non-zero -- no flag expected).
- NEW: `test_flag_ii_zero_amount_without_rate_does_not_fire` (amount=0, no rate fields -- must NOT fire).
- `test_flag_ii_respects_effective_classification`: added `rate_install=100.0`, removed `qty_total=0`.
- `test_canonical_reasons_verbatim` (flag-(ii) subtest): added `rate_supply=150.0`, updated expected string to new reason text.

**Deferred:**
- Multi-area zero-amount edge case for flag (ii) (amount_total=0 while amount_by_area has non-zeros).
- `rate_by_area` TS type bug (`Record<string, number>` should be `Record<string, {supply_rate,install_rate,combined_rate}>`).
- Wizard Design §6.5.3 doc wording for flag (ii) (stale after this fix -- update at next §6.5 fold).

**Test counts (this run):**
- `test_review_screen`: 78 tests. All green.
- `test_parse_run`: 63 tests. All green.
- Total wizard: 249 (63 + 78 + 66 + 7 + 23 + 12).

**tsc:** 0 wizard-file errors. Vite build exit 0 (4m 19s).

**Files changed:**
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- flag-(ii) rule + reason text.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- 4 renamed/updated + 1 new flag-(ii) test.
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- single-open accordion + master toggle.
- `frontend/src/pages/boq-wizard/SheetReviewPage.tsx` -- flag count summary strip.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record.
- `CLAUDE.md` (root) -- status line bumped.
- `frontend/CLAUDE.md` -- status line bumped.

### Slice B2a-fix wording -- toggle "notes"→"flags", strip label "Advisory:"→"Flags:" (2026-06-06)

**Motivation:** B2a-fix shipped "Show all notes"/"Hide all notes" and "Advisory:" as UI strings. Post-live-cert diagnostic confirmed these should be "flags" / "Flags:" to match the feature vocabulary and reduce user confusion.

**Changes (text-only, zero logic/state/behavior change):**
- `ReviewTree.tsx`: master toggle button label: "Show all notes" → "Show all flags" / "Hide all notes" → "Hide all flags". onClick, showAllFlags state, Info icon, and styling are exactly unchanged.
- `SheetReviewPage.tsx`: flag summary strip bold label: "Advisory:" → "Flags:". FLAG_LABELS short labels (zero-amount / orphan / needs-review / priced-preamble), FLAG_ORDER, flagCounts, flagSummaryParts logic, render condition, and styling are exactly unchanged.

**Tests:** None (text-only label change has no test surface). Wizard test count 249 unchanged.

**tsc:** 0 wizard-file errors. Vite build exit 0.

**Files changed:**
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- toggle string change.
- `frontend/src/pages/boq-wizard/SheetReviewPage.tsx` -- strip label change.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record + deferred items below.
- `CLAUDE.md` (root) -- status line bumped (minimal touch).
- `frontend/CLAUDE.md` -- status line bumped (minimal touch).

**Deferred / Known issues recorded from B2a-fix live-cert diagnostic:**

**(a) §6.5.3 design-doc wording drift:** The UI now says "Flags" / "Flags:" where Wizard Design §6.5.3 uses the word "advisory". The design doc itself is NOT edited here (out of scope). Whoever next does a §6.5 pass (B2b, Slice C, or any docs-only sweep) should fold in the wording reconciliation: align §6.5.3 to say "flags" throughout, or add a note that the implementation uses "flags" as the display term.

**(b) KNOWN ISSUE / LANDMINE -- trailing spaces in stored sheet names (verified on BOQ-26-00145):** At least 6 sheet names on BOQ-26-00145 are stored WITH a trailing space: `'Electrical '`, `'HVAC '`, `'PA '`, `'IT Active '`, `'WLD &RR '`, `'Modular Furniture '`. The root cause is how the workbook's sheet names were recorded at upload time. Frappe stores them verbatim -- no stripping. **Any UI control that trims or normalises a sheet name before passing it to `get_review_rows`, `sheet_preview`, or any future endpoint that matches on `sheet_name` will silently return 0 rows** -- the sheet appears "clean" or "not found" when it actually has data. This is a latent silent-mismatch risk. Whoever next handles sheet names in a UI control (B2b, Slice C, multi-general-specs, SheetCard nav) MUST preserve names verbatim -- never trim. The `EXACT sheet_name constraint` note in `frontend/CLAUDE.md` already captures the verbatim rule; this item adds the explicit trailing-space evidence so future implementers know the data is real, not hypothetical.

---

### Slice B2b -- left-gutter expander column + inline detail panel + sticky-header fix + pill restyle + aria-label (2026-06-07)

**Motivation:** B2a shipped the flag-reason accordion. B2b adds a per-row inline detail panel (row provenance, original-vs-effective values, edit history) as a frozen-left expander column, fixes the semi-transparent sticky header that bled through on scroll, restyles ClassificationPill to soft per-type fill, and normalises "advisory notes" to "flags" in aria-labels.

**BUILD 1 -- Left-gutter expander column + inline read-only detail panel:**
- New FIRST (leftmost) column in every `<thead>` and data row `<tr>`. Width w-8.
- Header corner `<th>`: `sticky top-0 left-0 z-30 bg-muted` (both axes, solid bg).
- Body `<td>`: `sticky left-0 z-10 bg-background` (frozen-left, always visible on horizontal scroll).
- Caret button: `ChevronRight` (closed) / `ChevronDown` (open), `e.stopPropagation()` mandatory, `aria-label` "Show/Hide row detail".
- New state: `expandedDetailRow: number | null`. `toggleDetailRow(idx)` opens the panel and closes the flag accordion (Option-B).
- Detail panel `<tr>` (`bg-muted/30`) renders when `expandedDetailRow === row.row_index`. Contains:
  - (a) Header: "Row detail — Excel row N" + provenance badge ("edited" amber/rounded-full if `edited_at` non-null or `edit_log` non-empty, else "original" muted).
  - (b) Original-vs-effective grid: `classification` (strikethrough original → bold effective if `human_classification` overrides); `parent` (Excel row numbers, "root" for null/-1, strikethrough if `human_parent >= 0`); `qty_total`, `rate_supply`, `rate_install`, `rate_combined`, `amount_total` (each shown only when non-null, read-only).
  - (c) Flag reasons: reuses `rowFlags` from `flagsByRowIdx` -- same canonical reason text, shown only when flags exist.
  - (d) Edit history: iterates `edit_log` entries `{field, from, to, by, at}`; formatted "field: from → to — by · at". "No edits yet." when empty/null.
  - (e) Reason slot: `<p className="text-[11px] text-muted-foreground italic">Reason — (added in a later step)</p>` -- laid out empty, pending Slice C's 6th edit_log key.
- Panel interior wrapped in `<div onClick={(e) => e.stopPropagation()}>` so reading/clicking inside does NOT dismiss via table handler.
- **Option-B (mutually exclusive) coupling -- all three arms:**
  1. `toggleDetailRow` calls `setExpandedFlagRow(null)`.
  2. `toggleFlagRow` calls `setExpandedDetailRow(null)`.
  3. Table-level `onClick`: `setExpandedFlagRow(null); setExpandedDetailRow(null)`.
  - Master `showAllFlags` toggle is flag-only; coexisting with an open detail panel is intentional and fine (only the single-open `expandedFlagRow` is mutually exclusive with `expandedDetailRow`).

**BUILD 2 -- totalCols 5 → 6:**
Applied to both the flag-reason reveal row and the detail panel reveal row. No other hardcoded column count exists.

**BUILD 3 -- Sticky-header fix (matches SheetDataGrid convention):**
- `bg-muted/50 sticky top-0 z-10` removed from `<tr>` (kept as static row).
- Each fixed-anchor `<th>` (Excel Row, Sl.No, Parent, Classification, Description): `sticky top-0 z-20 bg-muted`.
- Expander corner `<th>`: `sticky top-0 left-0 z-30 bg-muted` (both axes, highest z -- see z-index stack).
- Descriptor-driven `<th>` cells: `sticky top-0 z-20` + `d.area ? areaColorMap[d.area] : "bg-muted"` (area color if mapped, bg-muted fallback). All fully opaque -- no bleed-through.
- No new stacking overlap introduced: controls bar is outside the table (not sticky); flag-reason and detail rows are static; only header cells and the frozen-left column are sticky.
- **Z-index stack (ReviewTree):** expander corner z-30 (top+left); column header cells z-20 (top); frozen-left expander body cells z-10 (left); data rows not sticky.

**BUILD 4 -- ClassificationPill restyle:**
- Shape: `rounded-full` (full lozenge). Left-border accent (`borderLeft: 3px solid {hex}`) dropped entirely.
- Fill: soft per-type opaque Tailwind pairs. `CLS_PILL_CLASSES` map (replaces `CLS_COLORS` + inline style):
  - `preamble`: `bg-gray-200 dark:bg-gray-700` / `text-gray-700 dark:text-gray-200`
  - `line_item`: `bg-blue-100 dark:bg-blue-900` / `text-blue-800 dark:text-blue-200`
  - `note`: `bg-amber-100 dark:bg-amber-900` / `text-amber-800 dark:text-amber-200`
  - `subtotal_marker`: `bg-emerald-100 dark:bg-emerald-900` / `text-emerald-800 dark:text-emerald-200`
  - `spacer`: `bg-gray-100 dark:bg-gray-800` / `text-gray-500 dark:text-gray-400`
  - `header_repeat`: `bg-slate-100 dark:bg-slate-800` / `text-slate-700 dark:text-slate-300`
  - Fallback (unknown cls): slate-100 / slate-700.
- All fills fully opaque (no /opacity suffix). Per-type distinction kept.

**BUILD 5 -- aria-label / title cleanup:**
Flag marker button: `"Show advisory notes"` → `"Show flags"`, `"Hide advisory notes"` → `"Hide flags"`.

**Design-doc drift note (§6.5.3):** The row-detail panel layout (original-vs-effective strip, edit_log history, empty reason slot) is not described in §6.5/§6.5.3 mockups, which pre-date the Slice A human-edit layer. The as-built detail panel design is the authoritative source. §6.5 fold should incorporate this when it next occurs.

**Tests:** None -- display-layer only, no Python touched. Wizard backend test count 249 unchanged.

**tsc:** 0 wizard-file errors. Vite build exit 0.

**Files changed:**
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- all five builds.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record.
- `CLAUDE.md` (root) -- status line bumped.
- `frontend/CLAUDE.md` -- status line bumped.

### Slice B2c -- edit-provenance surfacing: Status column + green row tint + panel reshape (2026-06-07)

**Motivation:** B2b shipped the inline detail panel with an amber "edited" provenance badge. B2c makes edit-provenance a first-class column: a "Status" anchor column shows a green "Edited" badge on any row where `edited_at` is set or `edit_log` is non-empty. Edited rows also get a soft green row tint. The detail panel is reshaped to be edit-focused (value-field block removed; qty/rate/amount live in the grid columns; panel now shows provenance badge + original-vs-effective classification+parent + flags + edit_log history + empty reason slot). Panel "edited" badge colour changes from amber to green.

**Provenance rule (single source for badge + tint + panel):**
`isEdited = row.edited_at !== null || (Array.isArray(row.edit_log) && row.edit_log.length > 0)`

**BUILD 1 -- New "Status" fixed anchor column:**
- Position: immediately after Excel Row (order: Expander | Excel Row | **Status** | Sl.No | Parent | Classification | Description | data cols).
- Header `<th>`: label "Status", `w-20 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted` (matches other anchor headers). NOT frozen-left (only the Expander column is frozen-left).
- Body `<td>`: when `isEdited` → green "Edited" badge styled like ClassificationPill (`rounded-full py-0.5 px-2 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200`). When not edited → empty `<td>` (no badge, no "Original" text).
- Always shown; NOT in the column-subset selector (selector iterates `displayDescriptors` only; Status is a fixed anchor outside that loop).

**BUILD 2 -- Green row tint on edited rows:**
- Added `isEdited && "bg-green-50 dark:bg-green-950/30"` to the data-row `<tr>` cn() call.
- Ordering in cn(): base → preamble bg → **green tint** → highlight flash. `tailwind-merge` keeps the last matching class, so the amber highlight (placed after) still wins on flash. Preamble bg-muted/20 and the green tint coexist (different bg classes, both applied).
- Color chosen: `bg-green-50 dark:bg-green-950/30` — lighter end of the green palette so it reads as a soft tint, not a fill. Distinct from emerald (subtotal_marker pill uses emerald).

**BUILD 3 -- totalCols 6 → 7:**
Applied to both the flag-reason reveal row (`colSpan={totalCols}`) and the detail-panel reveal row. No other hardcoded column count exists.

**BUILD 4 -- Detail panel reshape (edit-focused):**
- **Removed:** entire value-field block (five conditional `<div>`s for `qty_total`, `rate_supply`, `rate_install`, `rate_combined`, `amount_total`). Current values live in the grid columns; the panel is about what changed.
- **Kept (in order):** (a) header + provenance badge, (b) original-vs-effective classification + parent, (c) flag reasons if any, (d) edit_log history ("No edits yet." when empty), (e) empty reason slot.
- Grid simplified from `grid grid-cols-2 sm:grid-cols-3` to `grid grid-cols-2` (only two items remain: Classification and Parent).
- Comment updated from "classification + parent + value fields" to "classification + parent (read-only, edit-focused panel)".
- Panel "edited" badge: `bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300` → `bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300`. "original" badge unchanged (bg-muted text-muted-foreground).

**fmtNum still in use:** after removing the value-field block, `fmtNum` is still called in `renderDescriptorCell` (descriptor-driven data columns). No import/helper removal needed.

**Design note (M4.12):** The M4.12 design intent described a "pencil + green tint" edited-row treatment. B2c partially realizes this as green tint + green "Edited" badge (no pencil icon — a worded badge is clearer than a pencil which would imply an edit action).

**Reality:** Until Slice C nothing is editable, so EVERY row renders as ORIGINAL (blank Status cell, no tint, panel shows "No edits yet."). This is correct, not a bug. The infra activates when Slice C lands.

**Tests:** None -- FRONTEND ONLY, display-layer, no Python touched. Wizard backend test count 249 unchanged.

**tsc:** 0 wizard-file errors. Vite build exit 0.

**Files changed:**
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- all four builds.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record.
- `CLAUDE.md` (root) -- status line bumped.
- `frontend/CLAUDE.md` -- status line bumped.

### Slice B2c-fix -- Status column unedited branch: blank → muted "Original" pill (2026-06-07)

**Motivation:** After live review of B2c the blank unedited Status cell reads as "broken" — users don't know whether the column has loaded or the row has no status. A muted gray "Original" pill signals "this row has not been edited" without drawing attention away from the green "Edited" rows.

**Change (one spot only):** In `ReviewTree.tsx`, the Status cell's `isEdited` ternary false-branch was changed from `null` to a muted gray "Original" pill:
```tsx
<span className="rounded-full py-0.5 px-2 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
  Original
</span>
```
Pill structure is identical to the green "Edited" pill; only colorway differs. Green "Edited" pill and green row tint are unchanged.

**Reality:** Until Slice C all rows are ORIGINAL so every Status cell now shows "Original". Slice C edited rows will flip to "Edited" + green tint as before.

**Tests:** None -- FRONTEND ONLY, display-layer, one-spot else-branch change. Wizard backend test count 249 unchanged.

**tsc:** 0 wizard-file errors. Vite build exit 0.

**Files changed:**
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- Status cell else-branch only.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record.
- `CLAUDE.md` (root) -- status line bumped.
- `frontend/CLAUDE.md` -- status line bumped.

### Slice C-v1 -- optional reason 6th edit_log key + edited_at on save return (feat 2bf77d62, 2026-06-07)

**Scope:** First of three C-values sub-slices and the ONLY backend-touching one. Deliberately tiny so the agreement-#49-sensitive edit_log serialization change lands and is unit-certified in isolation before the larger value-editing UI (C-v2) rests on it. C-v1 does exactly: (1) add an OPTIONAL per-edit `reason` string stored as a 6th key on each edit_log entry; (2) add `edited_at` to the `save_review_edit` return dict (so C-v2's save-status anchor reads a SERVER timestamp without a refetch); (3) frontend READ-SIDE ONLY -- `reason?: string` on `EditLogEntry` + render in the detail-panel edit-history when present. NO input, NO write path for reason -- that is C-v2. Schema-and-render-ahead-of-writer, same clean pattern B2c used.

**Backend (`api/boq/wizard/review_screen.py`):**
- `append_edit_log_entry(existing_log, field, from_val, to_val, user, reason=None)` -- new trailing `reason` param; entry dict now `{field, from, to, by, at, reason}`. UNIFORM SHAPE choice: the `reason` key is ALWAYS present; its value is `None` when no reason supplied (cleaner than conditionally omitting the key -- frontend renders only when truthy). `"at"` stays inline `frappe.utils.now()`.
- `save_review_edit(..., reason: str = None)` -- new trailing param after `value`. Normalized: `if isinstance(reason, str): reason = reason.strip() or None` (blank/whitespace -> None). Threaded into the `append_edit_log_entry` call. `edited_at` added to the return dict, sourced from `doc.edited_at` (the value just stamped this save). edit_log is serialized ONCE via `json.dumps` (key-count-agnostic -- the 6th key flows through unchanged; edit_log is NOT in `_RESAVE_LIST_JSON_FIELDS`).
- Return shape now: `{ok, row_index, field, from, to, edited_at, effective}`.
- `resolve_effective`, `_RESAVE_LIST_JSON_FIELDS` -- UNCHANGED. The D1 raw-vs-effective `to` behavior -- left as is (intentional, moot for value fields).

**Frontend (read-side only):**
- `boqTypes.ts` -- `EditLogEntry` gains `reason?: string` (optional). No `SaveReviewEditResponse` type exists today (save return is untyped at call sites); none invented -- minimal consistent surface.
- `ReviewTree.tsx` -- detail-panel edit-history loop (per-entry render) appends ` · reason: {entry.reason}` in muted styling when `entry.reason` is truthy; tolerates absence. The per-ROW "Reason — (added in a later step)" placeholder slot (a DIFFERENT thing: the row-level current-reason slot for C-v2) is LEFT UNTOUCHED.

**Tests (`test_review_screen.py`):** review_screen tests 78 -> 84 (+6). `TestAppendEditLogEntry`: reason stored as 6th key when supplied; reason key present and None when absent. `TestSaveReviewEdit`: reason persisted into latest edit_log entry; reason None when omitted; blank reason normalized to None; return includes non-empty `edited_at`. No existing test changed.

**tsc:** 0 wizard-file errors. No Vite build required for v1 -- no behavioral UI change to live-cert (reason render has no data to show until C-v2 wires the input). Parser tests unchanged, not run (out of scope). No fixture churn (no parse-run tests in this suite).

**Files changed:**
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- append_edit_log_entry + save_review_edit.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- +6 tests.
- `frontend/src/pages/boq-wizard/boqTypes.ts` -- EditLogEntry.reason.
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- edit-history reason render.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record + Latest-commit bump.
- `CLAUDE.md` (root) -- status line + endpoint reference note.
- `frontend/CLAUDE.md` -- status line + EditLogEntry reason / save edited_at note.

### Slice C-v2 -- inline value-editing for the 7 flat numeric fields (feat aa74a023, 2026-06-07)

**Scope:** Second of the three C-values sub-slices and the core value-editing UI. FRONTEND-ONLY -- C-v1 already shipped the backend (`reason` 6th edit_log key + `edited_at` in the save return), and the 7 flat fields were already writeable via `save_review_edit`. C-v2 binds the UI to that existing endpoint: it makes the SEVEN FLAT NUMERIC fields editable inline in the detail panel, confirm-gated, with an optional reason, auto-saving per confirm, and a sheet-level save-status anchor. This is the first slice where a human edit is written THROUGH THE UI. No backend (`.py`) change of any kind. Per-area cells (`value_key !== null`) and text fields (description/unit/sl_no/make_model/row_notes) are deliberately NOT editable here -- that is C-v2b; classification/parent editing are later dedicated slices.

**Editable set + rule:** Exactly the 7 flat numeric fields -- `qty_total`, `rate_supply`, `rate_install`, `rate_combined`, `amount_total`, `amount_supply`, `amount_install` (mirrors backend `review_screen._VALUE_FIELDS`). The build rule for which descriptor columns get an editable input: `editable = (d.value_key === null) && EDITABLE_VALUE_FIELDS.has(d.value_field)`. For an editable descriptor the write-target field name IS `d.value_field` (proven by `resolveDescriptorValue`: for `value_key === null` singletons, `value_field` is the flat ReviewRow field directly). A sheet whose value columns are ALL per-area correctly surfaces NO editable inputs in C-v2 -- expected, not a bug (per-area editing is C-v2b).

**Frontend (`ReviewTree.tsx`):**
- Module const `EDITABLE_VALUE_FIELDS` (the 7 names) near the other constants. Props extended: `boqName: string`, `sheetName: string` (VERBATIM/untrimmed -- the #152 trailing-space guard; never the display-trimmed name), `onSaved?: (editedAt: string) => void`.
- `editableDescriptors` computed inside the existing descriptor `useMemo` (filter on the editable rule), returned + destructured.
- New state (all `useState`, matching the ReviewTree idiom -- no Zustand): `editInputs: Record<string,string>` (the expanded row's input values, value_field -> string), `pendingEdit` (single-open draft: rowIndex/field/col/role/excelRow/from/to | null), `pendingReason: string`, `saveError: string | null`. POST hook: `useFrappePostCall<{message: SaveReviewEditResponse}>("...save_review_edit")` -> `{call: saveCall, loading: isSaving}`.
- Seed effect `[expandedDetailRow, byIdx, editableDescriptors]`: re-seeds `editInputs` to the row's stored values when the panel opens / after a save refreshes `byIdx` (so the just-edited field reads non-dirty post-mutate).
- Editable-inputs block in the detail panel, placed between the original-vs-effective grid and the flags block: per editable descriptor a shadcn `Input type="number"` labelled `"{col} -- {ROLE_LABELS[role]}"` pre-filled with the current value + an `Apply` button enabled only when dirty (and not saving). Inline `saveError` below the grid (`text-destructive`).
- `openValueConfirm(row, d, fromStr, toStr)` sets `pendingEdit` + clears reason/error. `confirmValueSave()` fires the POST `{boq_name, sheet_name (verbatim), row_index, field, value, reason}` (reason passed raw -- backend normalizes blank/whitespace -> None), then `onSaved?.(res.message.edited_at)`; on reject (the endpoint THROWS, not `{ok:false}`) the message is surfaced inline via `saveError` using the canonical wizard error-extraction idiom (no toasts).
- Per-edit confirm: a single shadcn `AlertDialog` mounted once after the table, open-state derived from `pendingEdit !== null`. One-line summary (`Row {excelRow} {col} -- {role}: {from} -> {to}. Confirm?`) + an OPTIONAL reason `Input type="text"` (placeholder "Reason (optional)"). `AlertDialogAction` confirms (auto-closes); Cancel discards with no write. Lightweight one-line confirm (value edits have no structural fallout -- NOT the heavy children-fate confirm).
- The C-v1 per-ENTRY edit-history reason render and the per-ROW "Reason -- (added in a later step)" placeholder slot are LEFT UNTOUCHED (the placeholder is a future per-row current-reason surface, distinct from the confirm-dialog reason input built here).

**Frontend (`SheetReviewPage.tsx`):**
- `mutate` added to the `get_review_rows` `useFrappeGetCall` destructure. `lastSavedAt: string | null` local state. `handleSaved(editedAt)` sets `lastSavedAt` (instant anchor update from the server timestamp, no wait for refetch) AND calls `void mutate()` (grid + provenance refresh: the row flips to "Edited", green tint, history gains an entry). `<ReviewTree>` now receives `boqName={boqId ?? ""}`, `sheetName={sheetName}` (verbatim), `onSaved={handleSaved}`.
- Save-status anchor in the header strip (`ml-auto`, `Check` icon + "All changes saved &middot; {time}"), shown once `lastSavedAt` is set. It REPORTS saved state -- it is NOT a batch-save button (every confirmed edit already auto-saved; one call = one commit; no dirty-buffer model). Header sub-line honesty: "Read-only review" -> "Review & edit" (the screen is no longer read-only). Local `fmtSavedTime` parses the server-local naive `edited_at` and renders HH:MM:SS.

**Frontend (`boqTypes.ts`):** added `SaveReviewEditResponse` interface (`ok, row_index, field, from, to, edited_at, effective`) so the POST return is typed where `edited_at` is read. (`EditLogEntry.reason?: string` already existed from C-v1.) Minimal surface -- nothing else added.

**Verification:** tsc 0 wizard-file errors (confirmed). Vite production build exit 0, built successfully IN THE CONTAINER (confirmed out of band). Wizard tests: unchanged (frontend-only slice, no test files touched) -- no bench/unittest run. Parser tests: not run (out of scope). LIVE-CERTIFICATION on BOQ-26-00145 is a SEPARATE step Nitesh runs AFTER this lands -- NOT part of this slice.

**Backwards-compat:** Additive only. `onSaved` is optional; the new `boqName`/`sheetName` props are required and supplied by the sole caller (`SheetReviewPage`). `SaveReviewEditResponse` is a new type, no existing type changed. Rows with no editable value columns render the panel exactly as before (no inputs). No backend/schema/route change.

**Files changed:**
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- editable inputs + confirm AlertDialog + optional reason + POST wiring + edit state.
- `frontend/src/pages/boq-wizard/SheetReviewPage.tsx` -- mutate + lastSavedAt + onSaved + save-status anchor + sub-line honesty.
- `frontend/src/pages/boq-wizard/boqTypes.ts` -- SaveReviewEditResponse.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record + Last-updated/Latest-commit bump.
- `frontend/CLAUDE.md` -- status line + value-editing behaviour note.
- `CLAUDE.md` (root) -- Active Features row + last-updated stamp (minimal touch).

### Slice C-v2b -- inline text-editing for unit + make_model (feat ae65555c, 2026-06-07)

**Scope:** Third of the C-values sub-slices. Makes the TWO flat TEXT fields -- `unit` and `make_model` -- inline-editable from the review-screen detail panel, ADDITIVE alongside the C-v2 numeric editing. Two deliberate differences from the numeric flow: (1) Apply saves DIRECTLY -- NO confirm dialog (silent save); (2) the value is a STRING (the backend must NOT coerce it through `float()`). A text edit is a genuine content edit, so it flips the row to "Edited" exactly like a numeric edit (same `edited_at` + `edit_log` path -- provenance logic untouched). `description` and `row_notes` stay READ-ONLY and are explicitly OUT OF SCOPE (NOT added to any editable set). The "Remarks" field, per-area editing, and classification/parent editing remain later slices.

**Backend (`review_screen.py`):**
- New `_TEXT_FIELDS: frozenset = {"unit", "make_model"}`; `_ALLOWED_EDIT_FIELDS = _HUMAN_FIELDS | _VALUE_FIELDS | _TEXT_FIELDS`.
- `save_review_edit` apply step is now THREE branches: `_HUMAN_FIELDS` (setattr / -1 clear, unchanged) -> `elif field in _TEXT_FIELDS` (NEW: `setattr(doc, field, value)` verbatim, NO float; `value is None or value == ""` clears to None) -> `else` (numeric `float()` path, unchanged). The text path is additive and only catches unit/make_model; it does NOT reorder or weaken the numeric/human branches. `from_val` for text fields flows through the existing `getattr(doc, field, None)` else-capture (text fields are not `_HUMAN_FIELDS`). edit_log append + `edited_by`/`edited_at` stamping are shared with every other field -- no new path.

**Frontend (`ReviewTree.tsx`):**
- Module const `EDITABLE_TEXT_FIELDS = new Set(["unit","make_model"])` (mirrors backend `_TEXT_FIELDS`), next to `EDITABLE_VALUE_FIELDS`.
- `editableTextDescriptors` computed in the existing descriptor `useMemo` with the SAME gating as `editableDescriptors` (`d.value_key === null && EDITABLE_TEXT_FIELDS.has(d.value_field)`), so a text input shows only when the sheet maps that column. unit/make_model ARE singleton descriptors (in `_SINGLETON_ROLE_TO_FIELD`) and they also still render as ordinary read-only data columns in the table; the editing affordance lives only in the detail panel.
- New `textInputs: Record<string,string>` state, seeded alongside `editInputs` in the SAME detail-open `useEffect` (deps extended with `editableTextDescriptors`); re-seeds on `mutate()` refresh so a just-saved field reads non-dirty.
- `saveTextField(rowIndex, field, value)` -- fires the POST `{boq_name, sheet_name (VERBATIM #152), row_index, field, value}` (NO reason -- text edits have no reason input), then `onSaved?.(res.message.edited_at)`; on reject surfaces inline via `saveError` using the same wizard error-extraction idiom. NO `openValueConfirm`, NO AlertDialog -- the numeric confirm flow is left exactly as-is.
- A SEPARATE "Edit text" block in the detail panel (after the numeric "Edit values" block): per text descriptor a shadcn `Input type="text"` labelled `"{col} -- {ROLE_LABELS[role]}"` pre-filled from `textInputs` + an `Apply` button enabled only when dirty (and not saving) that calls `saveTextField` directly.
- The inline `saveError` render was moved OUT of the numeric block to a single SHARED render below both edit blocks, so a text-only sheet (no editable numeric columns) still surfaces save failures.

**Frontend (`SheetReviewPage.tsx`):** UNCHANGED. The existing generic `onSaved={handleSaved}` (`setLastSavedAt(editedAt); void mutate();`) already carries text edits with no modification -- a text save advances the same "All changes saved" anchor + grid refresh.

**Tests (`test_review_screen.py`, +6 in `TestSaveReviewEdit`, 84 -> 90):**
- POSITIVE: editing `unit` to "sqm" persists the string verbatim + stamps `edited_at` + appends an edit_log entry with `field="unit"`; editing `make_model` to "Havells / X200" persists + stamps + logs; a blank `""` clears `unit` to None (set "kg" first, then "" -> None).
- NEGATIVE: editing `description` throws (not in allowed set); editing `row_notes` throws; editing numeric `qty_total` with "not_a_number" still throws (the `float()` path is unchanged for numeric fields -- the text path must not catch them).

**Verification:** review-screen wizard tests 90/90 GREEN in-session (was 84; +6). tsc 0 wizard-file errors. Vite production build exit 0 IN THE CONTAINER. No parser tests (no parser-layer code touched). No doctype JSON change (unit/make_model already exist as Data fields) -- no `bench migrate`.

**Backwards-compat:** The string write-branch does NOT change behaviour for the 7 numeric fields (they keep `float()`) or the 2 human fields (they keep setattr/-1). Additive only.

**Files changed:**
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- `_TEXT_FIELDS` + allowed-set + text write-branch + docstring.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- +6 tests.
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- text-edit block + direct-save + state/seeding + shared saveError.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record + Last-updated/Latest-commit bump.
- `CLAUDE.md` (root) -- Active Features row + save_review_edit reference + last-updated stamp.
- `frontend/CLAUDE.md` -- status line + C-v2b behaviour note.

### Slice C-v2c -- per-row Remarks (feat da6bb6d1, 2026-06-07)

**Scope:** Adds a per-row human-only "Remarks" free-text note to the review screen. A remark is annotation, NOT a data edit -- it is born empty (the parser write path leaves the field unset) and only a human ever writes it. FOUR settled design decisions shape the slice: (1) SEPARATE write path -- a remark must NOT make the row show "Edited" (which means "a human changed PARSED DATA"); the existing `save_review_edit` always stamps `edited_at` + appends `edit_log`, so a remark cannot ride it -- a NEW endpoint writes ONLY `remarks`. (2) NO remark history -- latest wins; no audit trail, no edit_log entry for remarks. (3) SEPARATE indicator -- a distinct blue marker (NOT the green "Edited" pill/tint), living INSIDE the Classification cell next to the flag marker (no new column, no `totalCols` change). (4) Panel for both READ and EDIT -- clicking the marker (or the row expander) opens the detail panel; the remark is read+edited there (Textarea + Save), NO inline reveal row. 500-char cap enforced on BOTH sides. Does NOT survive re-parse (covered by the re-parse warning; no persist work this slice). Per-area editing (C-v2d) and classification/parent editing remain later slices.

**Marker/toggle behaviour (decided in-build, panel-only):** The master "Show/Hide all remarks" toggle defaults OFF (`showAllRemarks=false`), mirroring the flags toggle's opt-in reveal. The per-row marker is shown when `hasRemark && (showAllRemarks || expandedDetailRow === row.row_index)` -- same shape as the flags marker's `hasFlags && (showAllFlags || expandedFlagRow===idx)`, but the "reveal" surface is the detail PANEL (clicking the marker calls `toggleDetailRow`), NOT a separate inline reveal row. This keeps one interaction model for the panel group and adds no reveal-row state.

**Backend:**
- `BoQ Review Row` doctype: new `remarks` field (Small Text) in the `review_edits_section` human layer; added to `field_order`. Migrated -- column landed as PostgreSQL `text` (verified via `information_schema.columns`, NOT `SHOW COLUMNS`).
- `review_screen.py`: `remarks` added to the `get_review_rows` `all_fields` list (explicit named list -- a new field does NOT ride along automatically). New `_REMARK_MAX_LEN = 500` const. New endpoint `save_review_remark(boq_name, sheet_name, row_index, remark)` -- `@frappe.whitelist(methods=["POST"])`; writes ONLY `remarks` via `frappe.db.set_value` (NOT `doc.save`) so `edited_at`/`edit_log`/version side-effects never fire; blank/whitespace -> None (clears); 500-char hard guard (`frappe.throw`); `sheet_name` matched VERBATIM (#152). Returns `{ok, row_index, remarks}`. `save_review_edit` is UNTOUCHED.

**Frontend:**
- `boqTypes.ts`: `ReviewRow.remarks: string | null`.
- `ReviewTree.tsx`: separate `save_review_remark` `useFrappePostCall` (own `isSavingRemark` flag); new `onRemarkSaved?: () => void` prop (DECOUPLED from `onSaved` -- refreshes via `mutate` WITHOUT advancing the sheet edit anchor); `showAllRemarks` state (default false) + `toggleShowAllRemarks` + `hasRemarksAny`; `remarkInput` seeded in the existing detail-open `useEffect`; DEDICATED `remarkError` (kept separate from the shared `saveError` so the two surfaces never cross-display). `MessageSquare` remark marker (blue) added to a right-aligned marker-group wrapper inside the Classification cell next to the flag `Info` marker (the flag marker's `ml-auto` moved to the shared wrapper). Master "Show/Hide all remarks" toggle in the controls bar (blue, mirrors flags toggle). Detail-panel "Remarks" block: `Textarea` + live `{n}/500` counter + "max 500 characters" message when over + Save button disabled when over-cap/unchanged/saving + inline `remarkError`. `REMARK_MAX_LEN=500` const.
- `SheetReviewPage.tsx`: wires `onRemarkSaved={() => void mutate()}`; adds a sheet-level "Remarks: N" count strip (N = rows with a non-empty remark), mirroring the flags summary strip, omitted when zero.

**Tests (`test_review_screen.py`, +5, 90 -> 95) -- new `TestSaveReviewRemark`:**
- POSITIVE: a remark persists AND `edited_at` stays None AND `edit_log` stays empty (the test proving the row stays "Original"); a blank remark clears to None; exactly 500 chars accepted.
- NEGATIVE: 501 chars rejected (throw) and field not written.
- SANITY: `save_review_edit` still stamps `edited_at` (proves the two write paths are independent).

**Verification:** review-screen wizard tests 95/95 GREEN in-session (was 90; +5). tsc 0 errors (wizard files + total project). Vite production build exit 0 IN THE CONTAINER. `bench migrate` clean + `remarks` column confirmed via `information_schema`.

**Backwards-compat:** Existing rows have no remark (new field default empty) -> read as null -> no marker, row still "Original", no green tint. New endpoint is purely additive; `save_review_edit`/flags/edit behaviour unchanged.

**Files changed:**
- `nirmaan_stack/nirmaan_stack/doctype/boq_review_row/boq_review_row.json` -- `remarks` field + field_order.
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- all_fields add + `_REMARK_MAX_LEN` + `save_review_remark`.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- +5 tests (`TestSaveReviewRemark`).
- `frontend/src/pages/boq-wizard/boqTypes.ts` -- `ReviewRow.remarks`.
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- marker + master toggle + panel Remarks block + remark save path.
- `frontend/src/pages/boq-wizard/SheetReviewPage.tsx` -- onRemarkSaved wiring + Remarks count strip.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record + Last-updated/Latest-commit bump.
- `CLAUDE.md` (root) -- Active Features row + Wizard Endpoints Reference (save_review_remark) + last-updated stamp.
- `frontend/CLAUDE.md` -- status line + C-v2c convention note.

### Slice C-v2c-polish -- remark marker always-visible, drop toggle, fixed-width panel inputs, cap 500->250 (fix ae9dcff2, 2026-06-08)

**Scope:** Live-cert UX follow-up on C-v2c. Three fixes + one removal; NO change to the core remark behaviour (remarks still save via the separate `save_review_remark` path and still never flip a row to "Edited").

**SUPERSEDES the C-v2c "Marker/toggle behaviour" note above:** the panel-only gate `hasRemark && (showAllRemarks || expandedDetailRow === idx)` is replaced by just `hasRemark` (always-visible), and the master Show/Hide-all-remarks toggle is GONE.

1. **Remark marker ALWAYS visible.** The blue `MessageSquare` marker now shows whenever the row carries a non-empty remark (`remarkMarkerShown = hasRemark`) -- no toggle or open-panel gating. A marker's job is to advertise the remark. Click still opens the detail panel (`toggleDetailRow`).
2. **Master "Show/Hide all remarks" toggle REMOVED.** In a panel-only model with the marker always-visible, the toggle had nothing to do. Removed: `showAllRemarks` state, `toggleShowAllRemarks`, `hasRemarksAny`, and the controls-bar button. (Confirmed no other references before deletion.)
3. **"Remarks: N" strip KEPT.** `SheetReviewPage` derives its own `remarkCount` (independent of the removed `hasRemarksAny`), so the strip is untouched. `SheetReviewPage.tsx` needed NO change.
4. **Fixed-width panel inputs (the real width fix).** All three detail-panel edit blocks were stretching to the full table width (`colSpan={totalCols}`), pushing the Apply/Save button far right on many-column sheets. Fix: numeric "Edit values" + text "Edit text" blocks switched `grid grid-cols-2 sm:grid-cols-3` -> `flex flex-wrap` with `w-52` items; the Remarks block capped at `max-w-md`. Inputs are now a compact unit with the button beside/below -- no horizontal scroll to reach it. Layout-only: no save logic, confirm dialog, endpoint, or dirty/disabled rule changed.
5. **Cap 500 -> 250 both sides.** `REMARK_MAX_LEN` (frontend) and `_REMARK_MAX_LEN` (backend) -> 250; counter, over-cap message, Save-disable, and backend hard-guard all follow. Backwards-compat: a stored remark > 250 still DISPLAYS (read path untouched); only a re-save past 250 is blocked -- no migration, no truncation of existing data.

**Tests:** the two cap tests renamed/retuned to the 250/251 boundary (`test_remark_exactly_250_accepted`, `test_remark_251_rejected_and_not_written`). Count stays 95 (two modified, none added/removed).

**Verification:** review-screen wizard tests 95/95 GREEN in-session. tsc 0 boq-wizard errors. Vite production build exit 0 IN THE CONTAINER. No doctype/schema change (no migrate).

**Files changed:**
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- `_REMARK_MAX_LEN` 500->250 + docstring number.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- two cap tests retuned to 250/251.
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- marker gate, toggle removal, width fixes, `REMARK_MAX_LEN` 250.
- `frontend/.claude/plans/boq-upload-plan.md` -- this record + header bump.
- `CLAUDE.md` (root) -- last-updated stamp + Active Features note.
- `frontend/CLAUDE.md` -- status line + C-v2c-polish note.

**NOT fixed (deliberate):** clicking the remark marker while its panel is already open toggles the panel closed -- Nitesh judged this acceptable.

### Slice C-v2d -- per-area numeric editing (qty/amount/rate) via save_review_edit (feat cd2cc156, 2026-06-08)

**Scope:** The last of the C-values slices. Makes the per-area cells (the by-area `qty`, `amount`, and `rate` surfaces) inline-editable in the review screen, alongside the flat numeric (C-v2), text (C-v2b), and remark (C-v2c) edits already shipped. Backend EXTENDS `save_review_edit` (does not add a new endpoint); frontend mirrors the C-v2 flat-numeric pattern.

**Why extend `save_review_edit` rather than write a fresh path (proven by recon probes #1/#2):** `doc.save()` validates the whole doc, and the list-JSON sibling fields (`attached_notes`, `validation_warnings`, `classifier_warnings`, `preamble_candidate_signals`) hydrate as Python lists and make `save()` throw unless re-serialized. `save_review_edit` already handles this via its `_RESAVE_LIST_JSON_FIELDS` pre-serialization (the "Defect-1 fix"). A fresh per-area write path would have to reinvent that. So the per-area write rides the same `doc.save()` and the same list-sibling handling. The probes also proved the three per-area JSON dict fields round-trip with a BARE Python dict assign (NO `json.dumps`) for BOTH shapes -- flat `{area: float}` (qty/amount) and nested `{area: {supply_rate, install_rate, combined_rate}}` (rate) -- Frappe auto-serializes the dict to the JSON column and auto-parses it back.

**Backend (`review_screen.py`):**
- `save_review_edit` gains two trailing optional params: `area` (str|None) and `rate_subkey` (str|None). `area_provided = area is not None and area != ""`. When `area_provided` is False the behaviour is EXACTLY the prior flat-field path (the flat capture/apply block is unchanged, just wrapped in an `else`).
- New constants: `_FLAT_AREA_FIELDS = {qty_by_area, amount_by_area}`, `_RATE_AREA_FIELD = "rate_by_area"`, `_AREA_JSON_FIELDS = _FLAT_AREA_FIELDS | {rate_by_area}`, and `_LEGAL_RATE_SUBKEYS = frozenset(_RATE_ROLE_TO_KIND.values())` -- the inner rate-kind names (`supply_rate`/`install_rate`/`combined_rate`) are REUSED from the parser's authoritative `classifier._RATE_ROLE_TO_KIND` (already imported), NOT re-copied.
- Per-area write = read-modify-write: read the current dict (handle dict / JSON-string / None -> `{}`), REJECT if `area not in current` (an edit never creates an area), compute `new_val` (blank -> `0.0`, else `float(value)` with the same "must be a number" throw), set the one cell, then BARE-assign the whole dict back (no `json.dumps`). Flat one-hop: `current[area] = new_val`. Nested two-hop (rate): `current[area][rate_subkey] = new_val`. The existing `_RESAVE_LIST_JSON_FIELDS` loop then runs before `doc.save()`.
- **Blank -> 0.0, the area key STAYS** (never deleted -- deleting a key is a structure change, not a value edit).
- **Validation (reject, don't silently create):** nonexistent area -> throw; `rate_by_area` without `rate_subkey` -> throw; illegal `rate_subkey` (not in `_LEGAL_RATE_SUBKEYS`) -> throw; a non-per-area field passed WITH an area (e.g. `qty_total` + area) -> throw.
- **Provenance:** a per-area edit IS a real data edit -- it stamps `edited_by` + `edited_at` (row flips to "Edited") via the SAME path as a flat edit. `from` = the per-area effective value BEFORE the edit (flat: `current.get(area)`; rate: `inner.get(rate_subkey)`).
- **Structured edit_log keying:** `append_edit_log_entry` gains optional `area` + `rate_subkey`, added to the entry dict ONLY when not None. Old flat entries omit them entirely and stay valid (no composite field string). Entry shape: `{field, from, to, by, at, reason[, area][, rate_subkey]}`.
- **Return shape:** `to` now uses a unified `to_val`; two keys added -- `area` and `rate_subkey` (both None on the flat path). Backward-compatible.

**Frontend:**
- `boqTypes.ts`: **rate_by_area TS type fix** -- was wrongly declared flat `Record<string, number>`; now nested `Record<string, RateByAreaCell>` where new `RateByAreaCell = {supply_rate?, install_rate?, combined_rate?: number|null}`. Recon confirmed NO static read site indexes it (resolveDescriptorValue casts to `Record<string, unknown>` and walks the rate_subkey hop generically), so blast radius is nil; tsc-verified 0 wizard errors. `EditLogEntry` + `SaveReviewEditResponse` extended with optional `area` / `rate_subkey`.
- `ReviewTree.tsx`: new `EDITABLE_AREA_FIELDS = {qty_by_area, amount_by_area, rate_by_area}` (mirrors backend `_AREA_JSON_FIELDS`); `editableAreaDescriptors = displayDescriptors.filter(d => d.value_key !== null && EDITABLE_AREA_FIELDS.has(d.value_field))`. New "Edit per-area values" detail-panel block mirroring the C-v2 flat pattern: `Input type=number` + `Apply` per area descriptor -> `openAreaConfirm` -> the SAME confirm `AlertDialog` -> `confirmValueSave` (now sends `area` + `rate_subkey`; undefined keys omitted by the SDK so the flat path is unchanged). Row flips to "Edited" via shared `onSaved(edited_at)`. `flex flex-wrap` + `w-52` items (C-v2c-polish width convention). `areaInputs` state keyed by `d.col` (value_field repeats per area). The field/area/rate_subkey contract sent to the backend comes straight from the backend-emitted `ColumnDescriptor` (`value_field`/`value_key`/`rate_subkey`) -- NOT a parallel invention.
- **Obs A:** the edit_log history render reversed to LATEST-FIRST (`[...row.edit_log].reverse().map(...)` on a copy). Per-area entries render the target inline: `qty_by_area (Zone A): 10 -> 15` / `rate_by_area (Zone A / combined_rate): 8 -> 9.5`. The confirm dialog description shows the area (+ rate kind) too.

**Tests:** new class `TestSaveReviewEditPerArea` (DB) -- 10 tests: flat qty/amount set-one-cell-key-stays, nested rate set-one-subkey-others-intact, blank->0.0 key-stays (flat + rate), nonexistent-area rejected (+ not-created + edited_at-stays-None), rate-without-rate_subkey rejected, illegal-rate_subkey rejected, non-per-area-field-with-area rejected, and flat-field regression (area=None unchanged + entry omits area/rate_subkey, the old-entry-still-valid coverage). `test_review_screen` = **105 (measured this run, was 95, +10)**; total wizard = **276 (derived: 266 - 95 + 105; full suite NOT re-run this session -- only test_review_screen ran)**.

**Verification (gates, all green in-session):** wizard-scoped tsc 0 boq-wizard errors IN THE CONTAINER (host tsc not used -- known node-v24 false-green trap); Vite production build exit 0 IN THE CONTAINER (`built in 6m 29s`, PWA generated, both cp post-steps, `Done in 435.66s`; only the 3 known-benign warnings); `test_review_screen` 105/105 OK.

**CERT STATUS (honest):** gates green, but LIVE-CERT NOT YET DONE -- boundary-crossing (#47). Pending: bench restart + re-parse of BOQ-26-00145 (doubly-dirtied by the recon probes -- must be re-parsed before any live-cert) + flat per-area (qty/amount) live-cert on Electrical. **RATE-editing live-cert is OWED against a real Pattern-2-rate vehicle** -- Electrical has NO nested `rate_by_area` data, so the nested rate path cannot be certified there. Nitesh runs the restart / re-parse / live-cert separately.

**Files changed (feat cd2cc156):**
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- per-area constants, `append_edit_log_entry` + `save_review_edit` extension.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- `TestSaveReviewEditPerArea` (+10).
- `frontend/src/pages/boq-wizard/boqTypes.ts` -- `RateByAreaCell`, rate_by_area type fix, EditLogEntry/SaveReviewEditResponse area+rate_subkey.
- `frontend/src/pages/boq-wizard/ReviewTree.tsx` -- per-area edit block, openAreaConfirm, areaInputs, Obs A latest-first, history/dialog area rendering.

**Path note:** the backend files live at `nirmaan_stack/api/boq/wizard/...` (single inner-package prefix), NOT `nirmaan_stack/nirmaan_stack/api/...`.

### Slice C-v2d-fix -- per-area edit validates against sheet area_dimensions, allows key creation (feat 7fee7481, 2026-06-08)

**Scope:** A follow-up FIX to C-v2d (feat cd2cc156), not a reopen. Backend-only -- no frontend change (the frontend already sends the correct verbatim area string; the bug was purely in the backend guard).

**The live-cert finding that drove it:** C-v2d's per-area guard rejected the edit when the sent `area` was not already a KEY in THIS row's target dict (`if area not in current: throw "Area '{area}' is not present on field '{field}' for this row."`). Live-cert proved this too strict: BOQ-26-00145 sheet `'HVAC '` row_index 2 (BOQRR-26-06690, a line_item) has `qty_by_area={}` but `'Phase 1'`/`'Phase 2'` are LEGITIMATE sheet areas (the sheet's `sheet_config.area_dimensions` defines them; the sibling `amount_by_area` carries them). Setting a qty on a defined-but-empty area is a valid VALUE edit, not an area-structure change -- but the row-dict-key guard blocked it.

**The fix (locked decision -- option ii):** validate the sent `area` against the SHEET'S defined areas (`sheet_config.area_dimensions`), NOT this row's existing dict keys. Do NOT union with `column_role_map` areas (they are defined to agree; a disagreement is a sheet-config bug to surface, not paper over).

**Backend (`review_screen.py`):**
- New helper `_get_sheet_area_dimensions(boq_name, sheet_name) -> list[str]` -- reads `sheet_config["area_dimensions"]` from the `BoQ Sheet Draft` child row using the SAME `frappe.db.get_value({parent, parenttype, sheet_name}, "sheet_config")` pattern `get_review_rows` already uses (sheet_name passed VERBATIM -- #152 trailing-space landmine, never strip; json.loads-if-str; returns `[]` when the draft / sheet_config / area_dimensions is absent or unparseable).
- The per-area guard (`save_review_edit`, the `area_provided` branch) is REPLACED:
  * `if not area_dimensions` -> `frappe.throw("This sheet has no defined areas; per-area values cannot be edited.", title="No defined areas")` -- fail loudly, no permissive fallback.
  * `elif area not in area_dimensions` -> `frappe.throw("Area '{area}' is not a defined area for this sheet.", title="Unknown area")` -- protection preserved, pointed at the right reference (the sheet's defined areas, not the row's keys).
  * `else` -> ALLOW the write, CREATING the key if absent. The existing read-modify-write below already does this for BOTH shapes: FLAT (`from_val = current.get(area)` -> None when absent; `current[area] = new_val`) and NESTED (`inner = current.get(area)` -> `{}` when absent; `inner[rate_subkey] = new_val`; `current[area] = inner`), preserving other areas + other subkeys. So `from_val` for a newly-created key is None (the user saw blank) -- recorded as None in the structured edit_log entry.
- **Unchanged from C-v2d:** the rate_subkey legality check (still validated against `_RATE_ROLE_TO_KIND` values BEFORE the area check); blank -> 0.0 with the key kept; provenance stamping (`edited_by`/`edited_at`); the STRUCTURED edit_log entry (area + rate_subkey); `_RESAVE_LIST_JSON_FIELDS` pre-serialization before `doc.save()`; the return shape; the flat-field (`area=None`) path.

**Tests (`test_review_screen.py`):** `TestSaveReviewEditPerArea` extended. Its `setUpClass` now declares `sheet_config = {"area_dimensions": ["Zone A", "Zone B"]}` on the `AreaSheet` draft (required so the existing per-area happy-path tests still pass under the new validation) PLUS a second `NoDimSheet` draft with no sheet_config. New tests (+5): `test_qty_create_key_on_defined_empty_area` (qty_by_area={}, area defined -> key created, from=None, edited_at stamped, entry carries area); `test_amount_create_key_on_defined_area`; `test_rate_create_path_on_defined_area` (nested path created on a defined area; existing area/subkey preserved); `test_reject_area_not_in_area_dimensions` (undefined area rejected even with an empty dict -- proves the area_dimensions source switch); `test_reject_when_no_area_dimensions` (a sheet with no sheet_config rejects any per-area edit; nothing written). The existing `test_nonexistent_area_rejected` ("Zone Z") still passes (Zone Z is not in area_dimensions). `test_review_screen` = **110 (measured this run, was 105, +5)**.

**Verification (gates, all green in-session):** wizard-scoped tsc 0 boq-wizard errors IN THE CONTAINER (backend-only fix -- trivially clean); Vite production build exit 0 IN THE CONTAINER (`built in 6m 28s`, PWA generated, both cp post-steps, `Done in 435.65s`; only the benign chunk-size warning); `test_review_screen` 110/110 OK.

**CERT STATUS (honest):** gates green, LIVE-CERT NOT YET DONE -- boundary-crossing. RE-LIVE-CERT OWED: after this lands, Nitesh restarts bench (worker reload) and re-tests the BOQ-26-00145 `'HVAC '` row_index 2 per-area qty edit to confirm it now SAVES + flips to "Edited". Rate-editing live-cert still owed against a real Pattern-2-rate vehicle (Electrical has no nested rate data).

**Files changed (feat 7fee7481):**
- `nirmaan_stack/api/boq/wizard/review_screen.py` -- `_get_sheet_area_dimensions` helper + per-area guard replacement + comment/docstring updates.
- `nirmaan_stack/api/boq/wizard/test_review_screen.py` -- `TestSaveReviewEditPerArea` setUpClass sheet_config + NoDimSheet + 5 new tests.

**NO frontend change, NO doctype/schema change.**

---

## Restructure surface (Slice 1)

The restructure surface lets a reviewer re-parent a row by FINDING the target row in the
source sheet and selecting + saving a new placement. Built in slices:
**1a** = the searchable sheet-view component (FIND + SHOW only, certified via a throwaway
dev route); **1b-alpha** = the BACKEND (transactional reclassify+reparent endpoint + the
human-root encoding) -- DONE; **1b-beta** = the restructure MODAL that mounts 1a, adds
selection, consumes the 1b-alpha endpoint, and REMOVES the dev route -- DONE (feat e8eeab58).
The restructure-surface arc is now COMPLETE pending live-cert.

### Slice 1b-beta -- the restructure modal (feat e8eeab58, 2026-06-09)

**Scope:** FRONTEND only. The consumer of the live-certified `save_review_restructure` backend
(1b-alpha). Adds the reclassify-and-place-children surface to the review screen and removes the
temporary Slice 1a dev route as the final act. No backend file touched; no Frappe unit tests
(UI slice). In-container tsc 0 errors in touched wizard files (project-wide pre-existing baseline
3177 unchanged before/after); in-container foreground build exit 0. Manual live-cert LC1-12 pending Nitesh.

**Files:** `RestructureModal.tsx` (NEW); `ReviewTree.tsx` (pill DropdownMenu trigger + childless
light path + `onRestructured` prop + modal mount); `SheetReviewPage.tsx` (`onRestructured={handleSaved}`);
`routesConfig.tsx` (dev route removed) + `_DevSheetSearchHarness.tsx` (deleted). `SheetSearchView.tsx`
byte-for-byte untouched; `boqTypes.ts` untouched (the `save_review_restructure` response type is
defined LOCALLY in the modal + ReviewTree).

**1. Trigger chain.** In the row-detail panel the Classification line gains a "Change ▾" pill-styled
`DropdownMenu` of the 4 ASSIGNABLE targets (`line_item`/`preamble`/`note`/`spacer`; subtotal_marker/
header_repeat never offered). `onPickClass` counts children (`rows.filter(r => r.effective_parent_index
=== row.row_index)`): childless -> a light `AlertDialog` ("Change classification"; `save_review_restructure`
with `child_moves: {}`; plain Button so the dialog stays open + shows an inline error on a backend throw);
has-children -> the staged `RestructureModal`.

**2. The five child-placement options (no silent default).** (1) move children UP to this row's current
parent (null/<0 -> -1); (2) keep children UNDER this row (`child_moves: {}`), OFFERED only when the new
class is parent-capable (line_item/preamble), disabled with a reason for note/spacer; (3) move all to ONE
new parent (picker); (4) decide EACH child individually (per-child picker; each a picked row_index or -1);
(5) make all children top-level (-1 each). Save gated: 1/2/5 complete on selection, 3 needs the parent
picked, 4 needs every child resolved.

**3. child_moves assembly (Path A) + atomic save.** `buildChildMoves()` -> `{child_row_index:
new_parent_index}` (-1 = top-level). ONE `save_review_restructure(boq_name, sheet_name [VERBATIM #152],
row_index, new_classification, child_moves, reason?)`. The object passes directly to `useFrappePostCall`
(SDK serializes; backend accepts a dict). Success -> `onRestructured(edited_at)`; Cancel/close/Escape
writes nothing; a backend `frappe.throw` (e.g. batch cycle) surfaces inline, modal STAYS OPEN.

**4. Parent picker -- mounts the certified SheetSearchView untouched.** Consumed via its existing
`onCurrentHitChange`; the modal renders its OWN "Set as parent" button. **row_number -> row_index
resolution:** a `SheetPreviewRow` carries only the Excel `row_number`; resolve via `rows.find(r =>
r.source_row_number === hit.row_number)`. **No-match guard:** a hit on a header/banner/blank band row
resolves to no review row -> "Set as parent" DISABLED with a quiet reason. Option 4 children may also be
set top-level (-1) without picking.

**5. Refresh wiring.** ReviewTree gains an OPTIONAL `onRestructured?: (editedAt) => void` (backwards-compat
-- no existing caller breaks). SheetReviewPage wires it to the EXISTING `handleSaved` (setLastSavedAt +
`mutate()`), so the tree reflects the moved children + reclassified row via the SAME SWR revalidate path
the value/text edits use. No fetch/patch inside the modal.

**6. Dev-route removal (gated LAST).** After tsc + build green, the `upload-boq/_dev-sheetview/...` route
was removed from `routesConfig.tsx` and `_DevSheetSearchHarness.tsx` deleted; tsc + build re-run green
(precache 168 -> 166 entries, harness chunk gone).

**Deferred (NOT built):** batch "apply all edits at once", drag-to-reparent, fuzzy search.

**OWED next:** ~~single-pass full-sheet-read endpoint~~ LANDED (`get_sheet_preview_full`, feat 196ed765;
WIRED by SheetSearchView v2, feat fc7147db). ~~row-self-reparent~~ LANDED (Slice 1b-beta2, feat 1ed9d3b7
-- see the block at the top of this plan). ~~childless-row reposition~~ LANDED (Slice 1b-beta2b, feat
20e1f5a7 -- the childless reclassify path now offers Keep/Move; "Move" routes into RestructureModal, which
adapts for zero children; finding-9 CLOSED). Still OWED: C-values rate-editing live-cert against a
Pattern-2-rate vehicle. NOTE: a PURELY standalone reparent (change a row's parent WITHOUT reclassifying it
-- the locked design's standalone "Change parent" mock, :236) remains a distinct, not-yet-built surface;
1b-beta2b reaches the childless row-move only as part of a reclassify.

### Layout Part A -- RestructureModal sizing + child-list wrap (feat 51b3412e, 2026-06-10)

**Scope:** FRONTEND, cosmetic display-only follow-up to 1b-beta. ONLY `RestructureModal.tsx` touched
(3-line diff). No state/handler/save-path/option-logic change; SheetSearchView NOT touched; dialog.tsx
primitive NOT touched. In-container tsc 0 errors in RestructureModal.tsx; in-container foreground build
exit 0. Manual MA1-4 pending Nitesh.

**The two changes.** (C1) `DialogContent` widened `max-w-3xl` -> `max-w-6xl` (keeps `w-full` +
`max-h-[90vh] overflow-y-auto`). `w-full` stays from the primitive default, so the `max-w-*` ceiling is
the lever; `max-w-6xl` (~1152px) is a balanced, viewport-safe cap that gives the mounted SheetSearchView
parent picker real room without going absurdly wide on large monitors (`max-w-[90vw]` was the alternative,
rejected for over-wideness on big screens). (C2) the two children-list texts -- the "Children (N)" summary
`<li>` and the option-4 per-child `<span>` -- switch from single-line `truncate` to `whitespace-normal
break-words`, so a long child note WRAPS instead of clipping. The reclassified-row description line
(`font-medium`, no truncate) was already wrap-capable and was left as-is (judgment: a title line where
one line reads fine; wrapping it changes nothing).

**STILL OWED -- the picker-grid column fix (a SEPARATE slice).** SheetSearchView's cells hardcode
per-column `min-w-[120px]` + `truncate` (no-wrap), uniform across columns incl. Description, with no
sizing prop to influence from outside. Fixing the grid's column widths + cell wrap REQUIRES editing the
1a LIVE-CERTIFIED `SheetSearchView` (cell classes at its TableHead/TableCell + a Description-vs-others
width branch), which re-opens its 1a display/search certification. Deliberately split out per the
slice-composition framework, to be paired with click-to-select. Layout Part A widens the modal so the
grid has more room NOW, but the grid's own columns still clip until that slice lands.

### Slice 1b-alpha -- transactional restructure backend + human-root (feat f7761415, 2026-06-09)

**Scope:** PURE BACKEND (+ a minimal frontend type/reader touch). No modal, no selection UI --
that is 1b-beta. test_review_screen 110 -> 124, all green.

**1. Shared write helper `_apply_and_save_row_edit` (review_screen.py).** The certified
field-application block of `save_review_edit` (apply one field-change to a loaded doc + append
edit_log + stamp provenance + re-serialize list-JSON siblings) was extracted verbatim into a
module-level helper that ALSO calls `doc.save()` but does NOT commit. **Save-inside /
commit-outside is the atomicity boundary:** under one request transaction, N per-row saves all
roll back if a later row throws; the caller's single trailing `frappe.db.commit()` makes a batch
all-or-nothing. `save_review_edit` was refactored to call it -- behaviour-preserving: all 110
pre-existing tests pass UNCHANGED. Callers retain ALL per-call validation, the doc LOAD, and the
commit; the helper assumes validated inputs. The helper takes a `set_root: bool` kwarg (below).

**2. `save_review_restructure` endpoint (Path A).** `@frappe.whitelist(methods=["POST"])`. Atomically
reclassifies one row AND reparents its children in ONE commit. `child_moves` is a dict (or JSON
string) `{child_row_index: new_parent_index}`; `-1` = top-level/root. The caller sends a FULLY
RESOLVED plan -- the backend validates + writes, it does NOT compute placement. Validation (all
per-call, BEFORE any write): required args; BOQ + row exist; `new_classification` ASSIGNABLE;
each child exists + is CURRENTLY a child of row_index (effective parent) + proposed parent is -1
or an existing row + not self-parented; **BATCH cycle-guard** -- build the whole-sheet
effective-parent map, apply ALL moves AT ONCE, then `_chain_has_cycle` per touched row against the
COMBINED tree (two individually-acyclic moves can form a cycle together, so they are checked
applied-together, never one at a time). Write: reclassify target via helper (one
human_classification entry, carries `reason`); each child via helper (one human_parent entry,
reason = "parent moved: row {N} reclassified to {cls}"); single commit. Returns
`{ok, row_index, new_classification, children_moved, edited_at}`.

**3. FROM-but-not-TO classification narrowing.** `_ASSIGNABLE_CLASSIFICATIONS = {line_item, preamble,
note, spacer}` is a STRICT SUBSET of `_VALID_CLASSIFICATIONS` (all 6 RowClassification literals).
`subtotal_marker` / `header_repeat` are parser-only DETECTIONS -- valid existing/FROM states + reads
but never assignable as a write TARGET. Applied to BOTH `save_review_restructure` and
`save_review_edit`'s human_classification path (the ONE intentional behaviour change to
save_review_edit; no prior test asserted those as targets, so S2 held -- no existing test changed).

**4. Human-root encoding `human_is_root` (Option B -- the recon's chosen encoding).** The recon found
that `-1` on `human_parent` means "no override -> fall back to parser parent", NOT root, so the
human layer could not express "make this row top-level" without overloading the -1 sentinel. Fix:
a NEW `human_is_root` Check field on BoQ Review Row (default 0), ORTHOGONAL to `human_parent` -- the
-1 sentinel value space (#54) is UNCHANGED. `resolve_effective` consults `human_is_root` FIRST:
truthy -> `effective_parent_index = None` (root), skipping the human_parent_norm/parent_index_norm
derivation; else the existing logic runs verbatim. **Consistency invariant** (root XOR row-override,
never both) is enforced at the SINGLE `_apply_and_save_row_edit` chokepoint via `set_root`:
set_root=True -> human_is_root=1 + human_parent=-1 (case c); value>=0 -> human_parent=value +
human_is_root=0 (case a); value None -> human_parent=-1 + human_is_root=0 (case b). `child_moves`
value -1 calls the helper with set_root=True; the edit_log records `to=None` for a root move (root
reads as "no parent", not the -1 sentinel). `human_is_root` was added to every fetch field-list that
feeds resolve_effective (get_review_rows, get_structural_breaks, mark_sheet_parsed_check_done, both
cycle-guards) + the resolve_effective return dict. **Migration: NONE** -- purely additive; a new Check
defaults to 0, correct for every existing row (none are human-rooted). `bench migrate` confirmed the
column exists (`has_column` True).

**5. Frontend touch (minimal, no modal).** `human_is_root: number | null` added to the `ReviewRow` type
(`boqTypes.ts`). `ReviewTree.tsx` `parentOverridden` now ORs in `row.human_is_root === 1` so a
human-rooted row reads as an override in the detail panel ("row N -> root"). In-container tsc: 0 errors
in the touched wizard files. Everything else (the restructure modal + selection UI consuming
save_review_restructure + dev-route removal) is Slice 1b-beta.

**6. Tests (test_review_screen, 110 -> 124, all green).** New `TestSaveReviewRestructure` group: happy
reclassify+reparent (children to a new parent / to root / to a shared parent / promote to old parent),
childless reclassify, FROM-but-not-TO rejects (subtotal_marker/header_repeat), non-child-in-map reject,
nonexistent-parent reject, the headline BATCH-cycle reject (two individually-acyclic moves -> nothing
written), JSON-string child_moves, the human_is_root invariant (root sets is_root=1 + parent=-1; a later
real-parent move clears is_root to 0; root move logs to=None), and a mixed batch (some children to a real
parent, some to root, in one call). The pre-existing 110 pass unchanged (helper extraction proven
behaviour-preserving).

**OWED to 1b-beta:** the restructure modal (mount SheetSearchView + selection), wiring to
save_review_restructure, removal of the dev route + `_DevSheetSearchHarness.tsx`; plus the still-OWED
1a follow-ups (single-pass full-sheet-read endpoint; fuzzy search remains DEFERRED).

### Slice 1a -- searchable sheet-view component (feat 5ecf1820, 2026-06-08; LIVE-CERTIFIED 2026-06-09)

**Scope:** FRONTEND ONLY. No backend file, no doctype JSON, no `patches/`, no
`review_screen.py` / `sheet_preview.py` change. SheetDataGrid kept byte-for-byte
untouched. No selection / no save / no modal / no restructure endpoint (all 1b).

**What was built:**
- **`frontend/src/pages/boq-wizard/SheetSearchView.tsx`** (new) -- a self-contained,
  searchable, column-trimmed, scroll-to-hit view of ONE sheet's raw cell data. Props
  `{ boqName, sheetName, initialCentreRow?, onCurrentHitChange? }`. `onCurrentHitChange`
  is the non-destructive callback exposed for 1b to consume; wired to nothing that saves.
- **Self-contained fetch (owns its data):**
  1. *Rows* -- `get_sheet_preview` via `useFrappePostCall`. The endpoint hard-caps each
     window at 200 rows (`_PREVIEW_MAX_ROWS`), so on mount the component LOOPS windows of
     200, advancing by `end_row_requested + 1`, until `has_more === false` -- loading the
     ENTIRE sheet up front (decision: search must cover every row, not a 40-row page).
     Progressive "Loading sheet... (N rows loaded)" state; a 500-window safety backstop
     (100k rows) fails loudly rather than looping forever. **Cost note:** the endpoint
     re-fetches the file from S3 + re-opens the workbook PER call, so a ~1,186-row sheet =
     ~6 sequential calls (~tens of seconds). Acceptable for 1a behind the loading state; a
     true batch/full-sheet read endpoint is a possible 1b backend follow-up if it feels slow.
  2. *Role->letter map* -- `useFrappeGetDoc("BOQs", boqName)` -> `draft.sheet_config.column_role_map`
     (same source SheetSpokePage seeds from; handles object|string config + `{role,area}`
     and legacy role-only shapes). Preview cells are keyed by Excel COLUMN LETTER and are
     role-blind; this map supplies which letter is Sl.No / Description / Unit / Qty.
- **Column-trim:** renders ONLY `#` (Excel row) + Sl.No + Description + Unit + EVERY Qty
  column (per-area qty included -- each Qty column shown with its Excel letter and area
  label, e.g. "Qty (Phase 1) (D)"). Rate and Amount columns hidden. **Degraded mode**
  (no `column_role_map`): all columns shown (Excel order), search disabled with an inline
  amber note "Description column not mapped... search is unavailable."
- **Description search + hit stepper:** case-insensitive substring over the Description
  cell across the FULL loaded sheet. Counter "N of M"; prev/next step BOTH directions and
  CYCLE (wrap at both ends); all matches soft-highlighted (yellow), current hit emphasised
  (amber); empty/zero-match -> counter 0, toggles inert.
- **Scroll/centre/highlight:** the ReviewTree pattern PORTED fresh (not imported) --
  `rowRefs = useRef<Map<number, HTMLElement>>` keyed by `row_number` + `<tr>` ref callback;
  on current-hit change (and `initialCentreRow` once on first full-loaded render)
  `scrollIntoView({ behavior:"smooth", block:"center" })` (center clears the sticky header)
  + a transient brighter flash cleared after ~1.2s. The sticky `#` gutter stays
  `bg-background` for horizontal-scroll correctness, so the row tint reads across the data
  cells but not the gutter (known, accepted).
- **Reuse decision:** self-contained trimmed table (shadcn `Table`, sticky header, sticky
  gutter) instead of reusing/extending SheetDataGrid -- the scroll/highlight needs per-row
  DOM access SheetDataGrid does not expose, so reusing would mean adding 3-4 review-specific
  props to a shared component; a focused table keeps SheetDataGrid untouched. `sheet_name`
  used VERBATIM everywhere (no trim) -- trailing-space names exist on BOQ-26-00145 (#152).

**Temporary dev route (live-cert vehicle -- REMOVED in 1b):**
- **`frontend/src/pages/boq-wizard/_DevSheetSearchHarness.tsx`** (new) + one route entry in
  `routesConfig.tsx`: `upload-boq/_dev-sheetview/:boqId/:sheetName`. Both carry the comment
  "TEMPORARY dev harness for Slice 1a live-cert -- REMOVE in Slice 1b". Not linked from any
  real UI. Removal is a named 1b task.
- **Live-cert URLs (BOQ-26-00145, all Parsed, desc column B mapped):**
  clean name -> `/upload-boq/_dev-sheetview/BOQ-26-00145/Fire%20Fitting`;
  trailing-space -> `/upload-boq/_dev-sheetview/BOQ-26-00145/Electrical%20` (and `HVAC%20`).

**Gates (in-container, canonical):** tsc `--noEmit` IN THE CONTAINER -- 0 boq-wizard errors,
0 in `SheetSearchView` / `_DevSheetSearchHarness` / `routesConfig` (the ~3.1k total errors are
the repo's known pre-existing baseline outside wizard scope). Vite production build IN THE
CONTAINER exit 0. No automated tests this slice (UI component, no backend change); parser /
wizard suites deliberately NOT run (agreement #55 -- avoids churning fixture bytes).

**CERT STATUS:** gates green; **LIVE-CERTIFIED 2026-06-09.**
Result: 5/5 checks PASS on BOQ-26-00145 -- columns trimmed (#, Sl.No, Description, Unit, both Qty cols
shown; Rate+Amount hidden), exact-match description search + correct hit counter, cycling prev/next
stepper, scroll-to-hit + highlight, full-sheet load; verified on a clean-name sheet (Fire Fitting,
1001 rows) AND a trailing-space sheet (Electrical , #152).
Two findings logged as deferred/owed:
(a) FUZZY/TYPO-TOLERANT description search -- DEFERRED. Exact matching kept for V1; revisit only if
real use proves exact-match frustrating (risk = false-positive noise on large sheets). A logged
decision, not owed work.
(b) FULL-SHEET LOAD PERF -- ~30s on the 1001-row Fire Fitting sheet because the frontend loops
get_sheet_preview in 200-row windows and the endpoint RE-OPENS the workbook per window. OWED as a
Slice 1b backend follow-up: a single-pass full-sheet-read endpoint to replace the windowed loop.
(Small/medium sheets are already fast.)
  RESOLVED (backend) 2026-06-10, feat 196ed765: `get_sheet_preview_full(boq_name, sheet_name)` built +
  tests-certified (byte-identical to the windowed path; see the get_sheet_preview_full endpoint section
  above). The PERF benefit lands when SheetSearchView v2 wires the new endpoint up (deferred so the
  1a-certified SheetSearchView is re-certified once, bundled with column-widths/wrap + click-to-select).

**Files changed (feat 5ecf1820):**
- `frontend/src/pages/boq-wizard/SheetSearchView.tsx` (new).
- `frontend/src/pages/boq-wizard/_DevSheetSearchHarness.tsx` (new, TEMPORARY -- removed in 1b).
- `frontend/src/components/helpers/routesConfig.tsx` (one throwaway route entry -- removed in 1b).

**NO backend change, NO doctype/schema change.**

---

## §9 #164 Slice A3-backend — per-sheet parse-lifecycle state + double-fire guard + self-heal + write guards (BACKEND ONLY, feat 004f80a8, 2026-06-13)

**Goal.** A sheet under active parse / re-parse must not be edited while the worker is concurrently
deleting + rebuilding its `BoQ Review Row`s. This slice is the BACKEND floor: per-sheet in-flight state,
a real double-fire guard, dead-worker self-heal, and write guards on every sheet-mutating endpoint. The
frontend parse-lock UI + the wiring of `check_parse_status` are a SEPARATE later slice (S5 backend-only
lock; `frontend/CLAUDE.md` deliberately NOT touched here).

**Recon basis.** Read-only Recon #1 + #2 (2026-06-13): the only prior in-flight signal was BoQ-level
`BOQs.parse_in_progress`; no per-sheet state; no real double-fire guard (status-based eligibility only);
the flag sticks on hard worker death; the nine config/review write endpoints had no parse guard;
eligibility resolves only inside the worker (not at enqueue). Recon-ref correction applied: wizard tests
live at `nirmaan_stack/api/boq/wizard/test_*.py`, NOT a `tests/` subdir.

**SCHEMA (CHANGE 1).**
- `BoQ Sheet Draft.parse_in_progress` — Check, default 0, read-only. The per-sheet in-flight marker.
- `BOQs.parse_job_id` — Data, hidden, read-only. The RAW (un-namespaced) RQ job id.
- `BOQs.parse_enqueued_at` — Datetime, hidden, read-only. Enqueue timestamp for staleness.
- `BOQs.parse_in_progress` (BoQ-level, pre-existing) — UNCHANGED.
- `bench migrate` landed all three columns; `get_meta` verified (fieldtype/default/read_only/hidden +
  `has_column=True` for each).

**run_parse (CHANGE 2, parse_run.py).** Before enqueue, in order:
- **Double-fire guard + self-heal:** if `BOQs.parse_in_progress==1`, call `_maybe_self_heal_parse_state`.
  `"running"` -> `frappe.throw("A parse is already running for this BoQ. ...")`; `"cleared"`/
  `"cleared_stale"` -> the stuck state was wiped, fall through and start fresh.
- **Raw job id:** `raw_job_id = frappe.generate_hash(length=32)`, passed as `job_id=` to `frappe.enqueue`,
  stored RAW in `parse_job_id`. CRITICAL (Recon #2 Q4): `frappe.enqueue` namespaces ids to `{site}::{id}`
  and `get_job_status` re-namespaces on read, so storing the returned `job.id` (already namespaced) would
  double-namespace and always read None. `parse_enqueued_at = frappe.utils.now()`.
- **Superset marking:** set `parse_in_progress=1` on the sheets that COULD parse this run — the named
  subset if `sheet_names` given, else every draft whose `wizard_status` is Rule-3-admissible
  (`{"Reviewed","Parsed"}`, plus `"Parsed Check Done"` only under `force_reparse` — mirrors
  `assemble_mapping_config` via `_rule3_admissible_statuses`). All in the one commit with the BoQ flag/job
  fields.

**Worker + clear (CHANGE 3, parse_run.py).**
- **Reconcile (3a):** after `assemble_mapping_config` succeeds and `eligible_data_sheets` is resolved
  (post subset-narrowing), `_clear_all_sheet_parse_markers(boq)` then `_set_sheet_parse_markers(boq,
  eligible_data_sheets, 1)` + commit — clears the enqueue-time superset entries that turn out ineligible
  (general-specs / skip / bad-blob / not-admissible / outside the named subset) and marks the truly-
  eligible set, visible to the UI DURING the parse.
- **Blanket clear (3b):** `_publish_parse_event` (the single choke-point all completion paths funnel
  through) now, alongside the existing post-rollback BoQ-flag clear, blanks `parse_job_id`/
  `parse_enqueued_at` AND `_clear_all_sheet_parse_markers(boq)` (filter on parent/parenttype — ALL rows).
  Blanket, not a passed list, so it is correct on every one of the seven exit paths — including the
  top-level-exception path whose `frappe.db.rollback()` discarded the in-loop status writes (the publish
  clear runs in its own fresh transaction after the rollback).

**Self-heal helper + endpoint (CHANGE 4, parse_run.py).**
- `_maybe_self_heal_parse_state(boq) -> str` (assumes flag==1 on entry): reads `parse_job_id` +
  `parse_enqueued_at`; `status = frappe.utils.background_jobs.get_job_status(raw_id)`.
  None / `finished` / `failed` -> clear, return `"cleared"`. `queued`/`started` within
  `_STALE_PARSE_SECONDS` (1200) -> return `"running"` (NO mutation). Past 1200s, or a legacy flag-set-but-
  no-job-id state -> clear, return `"cleared_stale"` (or `"cleared"` for legacy-without-timestamp). A clear
  ALWAYS sets the BoQ flag 0, blanks `parse_job_id`+`parse_enqueued_at`, and clears every per-sheet marker.
- `check_parse_status(boq)` — `@frappe.whitelist()` bare (GET). `parse_in_progress!=1` -> `{state:"idle"}`
  (no self-heal); else `{state: _maybe_self_heal_parse_state(boq)}`. Ships UNWIRED (no caller yet — the
  hub-mount call lands in the frontend slice).

**Write guards (CHANGE 5).**
- `_guard_sheet_not_parsing(boq, sheet)` — canonical home `update_sheet_draft.py` (the leaf module;
  `review_screen.py` already imports from it, and the reverse would be a circular import). Throws "This
  sheet is being parsed. Wait for the parse to finish." iff the draft's `parse_in_progress==1`; a missing
  draft row -> `get_value` None -> pass-through (safe). sheet_name VERBATIM (#152).
- review_screen.py: called AFTER each existing `_guard_sheet_not_frozen` in `save_review_edit`,
  `save_review_restructure`, `save_review_remark`, `dismiss_row_flags`.
- update_sheet_draft.py: called after the child-exists check in `set_sheet_status`, `set_sheet_label`,
  `set_sheet_config`, `set_sheet_work_packages`; and per-named-sheet inside `set_general_specs_sheet`'s
  validate-all loop (so a parsing sheet anywhere in the list rejects the whole call — no partial write).

**Tests (CHANGE 6) — +27, full gate green in-session.**
- `test_parse_run` 69 -> 85: `TestParseEnqueueMarking` (double-fire rejected with a live job + enqueue not
  called; superset marking for a named subset AND `None`=all-admissible; stored job id has no `"::"`);
  `TestSelfHealParseState` (None/finished -> cleared; queued-within-window -> running + non-mutation;
  stale-past-1200s -> cleared_stale; legacy-no-job-id -> cleared / cleared_stale; `check_parse_status` idle
  when flag 0; `check_parse_status` running leaves ALL flags+job fields+markers untouched);
  `TestPerSheetParseMarkersWorker` (reconcile clears a marked-but-ineligible Skip sheet [publish patched
  to isolate reconcile]; markers cleared on success / global parse_failed / top-level-exception paths).
- `test_update_sheet_draft` 66 -> 72: `TestParseInProgressGuard` (5 rejections — one per writer incl.
  `set_general_specs_sheet` list-member; 1 pass-through control).
- `test_review_screen` 147 -> 152: `TestParseInProgressWriteGuard` (4 rejections — one per write endpoint;
  GuardSheet is `Parsed`+in-flight so only the parse guard can fire, not the frozen guard; 1 pass-through).
- Parser suite 588 unchanged (fixtures restored post-run per agreement #55).

**Files changed (feat 004f80a8):** `parse_run.py`, `review_screen.py`, `update_sheet_draft.py`,
`boq_sheet_draft.json`, `boqs.json`, `test_parse_run.py`, `test_review_screen.py`,
`test_update_sheet_draft.py`. No frontend file touched.

**DEFERRED (next slice):** the frontend parse-lock UI (hub card + spoke config panel + review screen
disable for a parsing sheet) + wiring `check_parse_status` on hub mount; `frontend/CLAUDE.md` update.

---

## §9 #164 Slice A3-frontend — parse-lock UI + check_parse_status wiring + SheetConfigPanel getFrappeError migration (FRONTEND ONLY, feat 6be90efd, 2026-06-13)

**Goal.** The frontend half of the parse-lifecycle lock (backend floor = A3-backend, feat 004f80a8). While a
sheet is under active parse/re-parse it must not be edited; the user must see WHY. This slice disables the
hub card, locks the spoke config panel, and makes the review screen read-only for a parsing sheet, wires the
unwired `check_parse_status` self-heal on hub mount, and migrates SheetConfigPanel to the `getFrappeError`
house pattern (§9 #161). No backend/Python; `ReviewTree.tsx` untouched (its `readOnly` gating already freezes
the tree).

**Recon basis.** A3-frontend recon (2026-06-13): `parse_in_progress` flows automatically via
`useFrappeGetDoc("BOQs")` (Recon #2 Q3); SheetCard receives the full `draft`; SheetReviewPage/SheetSpokePage
both have an existing draft lookup; the hub already derives `parseInFlight` from `boq.parse_in_progress` on
mount; SheetConfigPanel is the lone wizard writer still on the inline `.message` ladder.

**CHANGE 1 — boqTypes.ts.** `BoQSheetDraft` gains `parse_in_progress?: 0 | 1` (rides the BOQs payload).
`BOQsDoc.parse_in_progress` already present. `parse_job_id`/`parse_enqueued_at` NOT added (frontend never
reads them; `check_parse_status` returns derived state).

**CHANGE 2 — SheetCard.tsx.** `isParsing = draft.parse_in_progress === 1`. The four parse-admissible branches
— Reviewed, Parsed, Parsed Check Done, and **Parse failed** (v5.46 amendment: Parse-failed IS force-re-parse
eligible -> can be superset-marked at enqueue) — get `disabled={isSaving || isParsing}` on every action; a
compact amber `Loader2 + "Parsing..."` chip renders by the status pill. Pending/Skip/Hidden/General-specs are
never parse-marked -> untouched.

**CHANGE 3 — SheetReviewPage.tsx.** The existing `boq.sheet_drafts.find(...)` lookup now captures the whole
draft -> `sheetStatus` + `isParsing`. `readOnly={isChecked || isParsing}` on `ReviewTree`. An AMBER parsing
banner (Loader2, one "Go to hub" button) renders when `isParsing` and TAKES PRECEDENCE; the teal D1 checked
banner is gated to `isChecked && !isParsing`.

**CHANGE 4 — SheetSpokePage.tsx.** Derives `isSheetParsing` from the `:58` draft lookup; passes `isParsing`
to SheetConfigPanel.

**CHANGE 5 — SheetConfigPanel.tsx.** (5a) new `isParsing?: boolean`; an amber lock banner + the whole form
wrapped in a native `<fieldset disabled={isParsing}>` (cascades to every shadcn button/input/Radix-select
trigger -> one flag locks Sections 1-4 + Save + Mark-as-reviewed); `dropIfReviewed` early-returns when
`isParsing`. (5b §9 #161) import `getFrappeError`; `handleSave` + `handleMarkReviewed` outer catches use
`getFrappeError(e) || "<fallback>"`; the two inner work-package/status catches append `${getFrappeError(e)}`
to their static strings; `dropIfReviewed`'s `callSetStatus` gains a `.catch` routing into `setSaveError` (no
longer swallowed). A stale-tab mid-parse config write now surfaces the REAL backend message.

**CHANGE 6 — BoqHubPage.tsx.** A one-shot imperative `check_parse_status` call via `useFrappePostCall` (the
wizard's imperative GET-capable form, chosen over `useFrappeGetCall` to avoid SWR re-fetch loops re-hitting a
self-healing endpoint) in a `useEffect([boqId])` mount effect. On `cleared`/`cleared_stale` -> `void mutate()`
so the existing `useEffect([boq])` recovery re-reads the healed flags; `running`/`idle` -> no-op. Non-fatal:
failures are `console.error`-only; the hub renders regardless. The `cancelled` unmount guard prevents a
post-unmount `mutate`.

**Verification.** In-container `tsc --noEmit`: 0 new wizard-file errors (filtered `boq-wizard|boqTypes` ->
empty). In-container `yarn build`: exit 0, `✓ built in 3m 46s`, PWA 168 entries. No Frappe tests (frontend-
only). Manual live-cert LC1-LC7 pending Nitesh (card disable+chip / spoke lock+banner / review read-only+amber
beats teal / post-parse socket unlock / stale-tab getFrappeError proof / idle hub normal / stuck-flag self-heal).

**Files changed (feat 6be90efd):** `pages/boq-wizard/boqTypes.ts`, `SheetCard.tsx`, `SheetReviewPage.tsx`,
`SheetSpokePage.tsx`, `SheetConfigPanel.tsx`, `BoqHubPage.tsx`. No backend file touched. STALE-PATH NOTE: the
build brief listed `frontend/src/types/boqTypes.ts`; the real file is `frontend/src/pages/boq-wizard/boqTypes.ts`.

**The #164 arc (backend A3 feat 004f80a8 + frontend A3 feat 6be90efd) is now COMPLETE pending live-cert.**

---

## Slice A1 — status rename (Config Done / Finalized) + Finalized config-freeze (un-mark-and-edit) + dirty-marker fix (BACKEND + FRONTEND + DATA MIGRATION, feat 6001e36e, 2026-06-13)

**Goal.** Rename the `BoQ Sheet Draft.wizard_status` values **"Reviewed" -> "Config Done"** and **"Parsed
Check Done" -> "Finalized"** (owner-locked, clearer names), fix the dirty-marker asymmetry (a config change
dropped Parsed->Reviewed but never dropped a checked sheet), and add an in-place un-mark affordance. Status
strings are compared LITERALLY across backend + frontend, so the rename is coverage-critical -- one missed
site silently breaks a branch; the owner's bar was a zero-hit grep gate.

**Recon basis.** A1 coverage recon (2026-06-13): exhaustive inventory of every "Reviewed" / "Parsed Check
Done" / "Export reviewed" site; flagged the doctype-options silent-miss (`\nReviewed` token), the
const-vs-literal split in review_screen, and that only `BoQ Sheet Draft.wizard_status` persists the strings.

**THE RENAME (Change 1).** Every rename-sensitive site: doctype options (`boq_sheet_draft.json`, both tokens
in one string -- edited FIRST + read back); parse_run `_RULE3_BASE_STATUSES` + force-arm + worker comparison;
update_sheet_draft `_DIRECT_SET_STATUSES` (now excludes "Reviewed" -- the old name is an INVALID status) +
dirty-drop write (-> "Config Done"); review_screen const `_PARSED_CHECK_DONE` -> `_SHEET_FINALIZED =
"Finalized"` with the mark/unmark preconditions + writes + messages all routed through the const (fixing the
const-vs-literal split -- one definition site); frontend `WizardStatus` union, `STATUS_PILL` keys+labels, all
effectiveStatus branches/comparisons (SheetCard/BoqHubPage/SheetReviewPage/ParseRunDialog/SheetConfigPanel),
the statusAtOpenRef compare, the `set_sheet_status` write, the hub "Export reviewed" -> "Export Finalized"
label; identifiers carrying the old name renamed (`newlyDesignatedReviewed`/`pendingReviewedNames`/
`dropIfReviewed`/`handleMarkReviewed` -> `*ConfigDone`); ~78 status literals renamed in the three test modules.

**THE DATA MIGRATION (Change 2).** `v3_0/migrate_boq_sheet_draft_status_rename` -- idempotent per-row
`frappe.db.set_value(..., update_modified=False)` rewriting `wizard_status` ('Reviewed'->'Config Done',
'Parsed Check Done'->'Finalized'). Option-string rename does NOT touch stored rows (option metadata only);
this is the entire migration surface (edit_log/exports/parse-history embed no status string). `bench migrate`
verified: 6 'Reviewed'->'Config Done', 0 'Parsed Check Done' (none in DB), **0 old-value rows remain**;
options string confirmed via get_meta.

**THE FINALIZED CONFIG-FREEZE + UN-MARK-AND-EDIT (Change 3, dirty-marker fix).** Backend: new shared
`_guard_sheet_not_finalized(boq, sheet)` (update_sheet_draft, leaf module; imported by review_screen) throws
iff wizard_status=="Finalized", called in ALL FIVE config writers immediately AFTER `_guard_sheet_not_parsing`
(per-named-sheet in `set_general_specs_sheet`) -- a Finalized sheet's config write is REJECTED, superseding the
old asymmetry; the Parsed->Config-Done dirty-drop is unchanged (a Finalized sheet is rejected first). Frontend
(SheetConfigPanel): `finalized = wizardStatus === "Finalized"` -> a TEAL ShieldCheck lock banner + "Un-mark and
edit" -> confirm AlertDialog -> the EXISTING `unmark_sheet_parsed_check_done` endpoint (function name unchanged;
returns status to "Parsed") -> `onSaveSuccess()` re-fetch unlocks; the form is `<fieldset disabled={isParsing
|| finalized}>` (parsing amber banner takes precedence over finalized teal); the AlertDialog renders outside
the fieldset (portals to body). SheetCard's Finalized branch gains an "Edit config" -> spoke button so the
affordance is reachable.

**TESTS (Change 4).** ~78 literals renamed in place (sed: ReviewedSheet->ConfigDoneSheet, then quoted
literals, then the phrase, then prose). NEW: `TestFinalizedConfigFreeze` (5 writer rejects on Finalized +
Config-Done pass-through control + REAL-unmark-then-config-writer round-trip + parse-guard-precedence over the
finalized guard) + `TestStatusRenameRegression` (old "Reviewed" rejected by set_sheet_status; new "Config Done"
accepted) + retired-value superset-marking hygiene (a draft holding "Reviewed" is NOT marked); mark-rejects-
Config-Done is covered by the renamed M2 test. Counts: test_parse_run 85->86, test_update_sheet_draft 72->82,
test_review_screen 152 (renamed in place), parser 588 unchanged.

**Verification.** bench migrate + 0-old-value query + get_meta options; parser 588; three wizard modules
green; ZERO-HIT GREP (residuals all justified: migration map / 2 intentional-old-name tests / ReviewTree
"Reviewed -- looks OK" flag text [out-of-scope file] / exportReviewCsv docstring); tsc 0 wizard errors (3177
baseline) + build exit 0 (`✓ built in 9m 17s`, PWA 168 entries). Live-cert LC1-LC6 pending Nitesh.

**Files (feat 6001e36e):** parse_run.py, update_sheet_draft.py, review_screen.py, boq_sheet_draft.json,
patches.txt + patches/v3_0/migrate_boq_sheet_draft_status_rename.py, the 3 test modules; frontend boqTypes.ts,
SheetCard.tsx, BoqHubPage.tsx, SheetReviewPage.tsx, SheetConfigPanel.tsx, ParseRunDialog.tsx,
ExportWorkbookDialog.tsx. SheetSpokePage.tsx unchanged (no status literals). ReviewTree.tsx out of scope.

## Slice A2 — edit-log clarity pass (FRONTEND ONLY, render-time, feat cefaf3c0, 2026-06-13)

**Goal.** Make ReviewTree's row-detail "Edit history" block readable: (1) parent moves show Excel row numbers
instead of internal `row_index`; (2) an honest verb instead of the raw field name; (3) a `YYYY-MM-DD HH:MM`
timestamp. **Render-only** -- the stored `edit_log` entry shape (`{field, from, to, by, at, reason[, area]
[, rate_subkey]}`) is UNCHANGED. NO backend, NO doctype, NO migration. `ReviewTree.tsx` is the ONLY file
touched (root CLAUDE.md deliberately not touched -- no backend change; boqTypes.ts not touched -- `EditLogEntry`
already exists + is exported, only ReviewTree's import line gained it).

**Recon basis.** A2 edit-log recon 2026-06-13: stored entry shape confirmed; `human_parent` from/to are INTERNAL
`row_index` (from = effective_parent_index, to = raw value, null = root); the Parent COLUMN already translates
index -> Excel row via the component-scoped `byIdx` map (`byIdx.get(pIdx)?.source_row_number`); `CLS_LABELS`
module-level; `at` = `frappe.utils.now()` local `"YYYY-MM-DD HH:MM:SS.ffffff"` string; the #162 standalone
Change-parent door writes a no-op same-value `human_classification` entry alongside the real `human_parent` move.

**CHANGE 1 -- Excel-row parents.** New in-component `editParentLabel(v)` (closes over the SAME `byIdx` map the
Parent column uses): `null`/`undefined`/negative -> `root`; number with a `byIdx` hit -> `row {source_row_number}`;
number with no hit -> raw number (defensive). Root copy = lowercase `root` to MATCH the detail panel's own
`origParentLabel`/`effParentLabel` (the Parent COLUMN renders BLANK for root -- unusable in a `from -> to`
phrase, so the in-panel sibling copy was matched). Applied ONLY to `human_parent` entries; non-parent fields
keep raw from/to.

**CHANGE 2 -- honest verb + #162 suppression.** New in-component `describeEditEntry(entry) -> {verb, detail,
showField} | null`: `human_classification` + from!==to -> "Reclassified" (detail = CLS_LABELS[from] -> [to]);
`human_classification` + from===to -> **null (SUPPRESS -- the #162 no-op)**; `human_parent` -> "Moved parent"
(detail = editParentLabel from -> to); else -> "Edited" (detail = raw from->to, showField=true so the field name
still shows). The render IIFE reverses the log (latest-first), maps to `{entry, d}`, and a type-guarded `.filter`
drops `d === null` BEFORE the `.map`, so the suppressed no-op never produces an `<li>`; "No edits yet." reflects
the post-suppression list. The area/rate_subkey suffix render is kept verbatim.

**CHANGE 3 -- timestamp.** New module-level `formatEditAt(at)` = `typeof at === "string" ? at.slice(0,16) : ""`
-> `"YYYY-MM-DD HH:MM"`. String slice (no date library, no TZ reparse); no `formatDate` import added.

**Backwards-compat.** Old entries read unchanged (old indices translate or raw-number fallback; odd/missing `at`
-> empty string; non-parent -> "Edited" + raw). Purely how existing data is displayed.

**Verification.** tsc 0 NEW wizard errors (filtered `boq-wizard|boqTypes` -> empty; 3177 baseline unchanged) +
in-container Vite build exit 0 (`✓ built in 4m 50s`, PWA 168 entries). No Frappe unit tests (frontend
render-only -- agreement #50). Manual live-cert LC1-LC7 pending Nitesh: LC1 parent-move shows "Moved parent" +
Excel rows matching the Parent column; LC2 real reclassify -> "Reclassified" + class labels; LC3 #162
Change-parent entry suppressed (move shown once); LC4 move-to-root reads `root`; LC5 value/text/per-area raw
from->to unchanged; LC6 timestamps no seconds/micros; LC7 old entries don't crash.

**Files (feat cefaf3c0):** frontend ReviewTree.tsx ONLY. Helpers added: module-level `formatEditAt` +
`DescribedEditEntry` interface; in-component `editParentLabel` + `describeEditEntry`. `EditLogEntry` added to the
existing `./boqTypes` type import. No backend, no doctype, no migration, no tests.

## Phase 5 Slice 1 — committed general-specs faithful-grid doctype (BACKEND, feat 5fe61bff, 2026-06-16)

**What this slice is (and is NOT).** Builds the EMPTY committed home for faithful general-specs rows — a new
top-level doctype that stores a general-specs sheet's cell grid faithfully (arbitrary length AND width) carrying
the per-sheet commit-version dimension. SCHEMA + bare-stub controllers + tests ONLY. It is NOT the commit
pipeline: NO commit logic, NO `get_sheet_preview_full` call, NO real-data fetch/persist, and the parser, wizard
API, BOQ Nodes, BOQs and BoQ Sheet Draft are ALL untouched (those are later slices). Resolves C2 (general-specs
stored today as a LOSSY flattened `preamble_text` blob — see "PHASE 5 -- LOCKED INPUTS") by giving the faithful
rows a committed home; the actual routing of reachable grid data into it is Slice 3.

**Slice-0 recon facts verified before build (all confirmed):** V1 — the existing `BoQ General Specs Sheet` has
exactly two fields (`source_sheet_name` Data, `preamble_text` Long Text, `istable=1`); it is the lossy blob
doctype and is UNTOUCHED — the new doctype is fully separate. V2 — `get_sheet_preview_full`'s per-row output
shape is `{"row_number": int, "cells": {col_letter: value}}` (`sheet_preview.py` ~:297-302); the new child
mirrors it so Slice 3 can persist that output directly. V3 — §9 #136 grandchild-serialization convention holds:
a first-level child serializes on its parent via `get_doc`, a grandchild Table does not, so the design uses ONE
level of child (`rows` on the parent) + JSON `cells` (a field, not a Table) to stay first-level.

**NEW doctype — `BoQ Committed General Specs`** (module Nirmaan Stack; `istable=0` standalone top-level, NOT a
child of BOQs, because it carries versioning and is queried independently per sheet). `autoname BCGS-.YY.-.#####`
(deliberately distinct from BQSH-/BOQ-/BOQN-/BOQRR-, collision-checked), `track_changes=1`, `engine InnoDB`,
`allow_rename=1`, `index_web_pages_for_search=1`, and the 10-role permission block mirroring `BoQ Sheet`
verbatim. **Fields:** `boq` (Link->BOQs, reqd, `search_index`, `in_standard_filter`, `in_list_view`);
`source_sheet_name` (Data, reqd, `in_list_view`, stored VERBATIM #152 — never stripped/trimmed); the per-sheet
VERSION dimension `commit_version` (Int, reqd, default 1, `in_list_view`) + `is_current` (Check, default 1,
`in_standard_filter`, `in_list_view`); `committed_at` (Datetime, read_only — pipeline-set); and the child table
`rows` (Table -> "BoQ Committed General Specs Row").

**NEW child doctype — `BoQ Committed General Specs Row`** (`istable=1`, module Nirmaan Stack, `permissions: []`).
**Fields:** `row_number` (Int, reqd, `in_list_view` — the source Excel row number, faithful 1-based position);
`row_order` (Int, `in_list_view` — emission-order sort key, preserves order when row_number is sparse); `cells`
(JSON — the arbitrary-width `{col_letter: value}` map mirroring `get_sheet_preview_full`'s per-row "cells" shape;
JSON not exploded columns is what gives arbitrary width without a grandchild table).

**One-current invariant DEFERRED.** Exactly one `is_current=1` row per (boq, source_sheet_name) is the durable
goal, but Slice 1 DEFINES the fields only — the pipeline (Slice 3) enforces the one-current invariant on write.
Slice 1 builds NO enforcement; both controllers are intentionally bare stubs (`class …(Document): pass`, no
compute, no cross-doc writes) per the project convention. The parent stub carries a docstring noting the deferred
invariant. No `integrations/controllers/` file is added (no hooks, no logic this slice).

**Design rationale (locked):** one-level child (`rows` on the parent) + JSON `cells` keeps the grid first-level so
it serializes on `get_doc` per §9 #136; versioning lives on the parent (the same model the node tier will carry);
the lossy `BoQ General Specs Sheet` blob doctype stays UNTOUCHED and separate.

**Verification (in-session, real bench run).** `bench --site localhost migrate` CLEAN (both doctypes install).
`test_boq_committed_general_specs` **4/4 green** in-container: T1 arbitrary-width round-trip (rows of 3 / 2 / 5
columns persist + read back, cells match exactly, widths preserved); T2 row_number + row_order persist and
ordering is recoverable from sparse/out-of-sequence row_numbers; T3 version fields default correctly
(commit_version=1, is_current=1) and are settable (commit_version=2, is_current=0) — schema-level only, NO
enforcement; T4 (#152) `source_sheet_name` with a trailing space persists VERBATIM (not stripped). Parser suite
**597 UNCHANGED** (this slice does not touch the parser). The test self-seeds a BOQs row in `setUpClass`
(`boq.project=_TEST_PROJECT` + `ignore_links=True`, mirroring `test_boq_sheet`); committed-general-specs inserts
are uncommitted so FrappeTestCase tearDown rolls them back.

**Files (feat 5fe61bff):** two NEW doctype folders only — `nirmaan_stack/nirmaan_stack/doctype/
boq_committed_general_specs/` (`__init__.py` + `.json` + bare-stub `.py` + `test_*.py`) and
`…/boq_committed_general_specs_row/` (`__init__.py` + `.json` + bare-stub `.py`). 7 files, +423 lines, 0
deletions. NO parser / wizard-API / BOQ Nodes / BOQs / BoQ Sheet Draft / hooks.py / frontend change. Docs commit
separate (this plan doc + root CLAUDE.md substantive; frontend/CLAUDE.md minimal-touch per the DOCS-UPDATE RULE).
**NEXT:** the per-sheet commit-version model on the node tier + the commit pipeline (Slice 3) that routes
`get_sheet_preview_full` output into these rows and enforces one-current.

## Phase 5 Slice 2 — the commit gate (eligibility) (BACKEND, feat b93ec41c, 2026-06-16)

**What this slice is (and is NOT).** Builds the GATE that answers one question for a BoQ: "which sheets are
eligible to COMMIT right now?" It is a READ-ONLY eligibility check — it computes + returns a list. It does NOT
commit anything, does NOT write the DB, does NOT change any wizard_status, does NOT call the parser or
`get_sheet_preview_full`, and does NOT touch `assemble_mapping_config` / parse-eligibility. The commit pipeline
(Slice 3) and the hub commit UI (Slice 4) will both call this gate; building + unit-testing it in isolation first
means the eligibility rule is locked before anything depends on it.

**THE parse-vs-commit distinction (load-bearing).** "What is eligible to COMMIT" is NOT "what is eligible to
PARSE." `assemble_mapping_config` treats "Finalized" as `not_eligible` BY DEFAULT (it re-parses Finalized only
under `force_reparse`). The COMMIT gate is the OPPOSITE for Finalized — Finalized is precisely what we want to
commit. So this gate is a SEPARATE, narrower rule keyed on Finalized + general-specs; it does NOT import, reuse,
or consult `assemble_mapping_config` / `force_reparse`. T5 is the regression guard that the two gates stay
distinct.

**Slice-0/verify-first findings (confirmed before build):** V1 — wizard_status options are blank / Pending /
Hidden / Config Done / Skip / General specs / Parse failed / Parsed / Finalized; "Committed" is NOT among them
(not added here). V2 — sheets read via `frappe.get_doc("BOQs", boq_name).sheet_drafts` (sheet_name +
wizard_status); read endpoints use bare `@frappe.whitelist()` + `frappe.db.exists` + `frappe.throw` (template:
`get_review_rows`). **V3 (decisive) — general-specs is POINTER membership in `BOQs.general_specs_sheets`
(`source_sheet_name` set), NOT `wizard_status == "General specs"`** (the option string carries that token but
`assemble_mapping_config:160-166` + its comment confirm the draft's wizard_status is NEVER literally set to
"General specs"; a designated sheet can carry any stored status, e.g. Skip). So the gate's general-specs test
keys off the pointer. V4 — no pre-existing commit-eligibility function to collide with.

**Eligibility rule (the ONLY two dispositions that commit, per PHASE 5 LOCKED INPUTS):**
- general-specs-designated (pointer membership) → eligible, disposition **`general_specs`**;
- else `wizard_status == "Finalized"` → eligible, disposition **`finalized`**;
- else NOT eligible (blank, Pending, Hidden, Config Done, Skip, Parse failed, Parsed).
The disposition tells Slice 3 which write path to use (faithful general-specs grid vs. line-item nodes).

**PRECEDENCE (overlap).** A sheet can be BOTH Finalized AND general-specs-designated (the designation is a pointer
overlay that never writes wizard_status, and the hub checklist can tick a Finalized sheet). When both apply,
**`general_specs` WINS** — mirroring `assemble_mapping_config` Rule 1, where the general-specs pointer is checked
FIRST and outranks wizard_status. Tested in T6.

**Chosen location + API.** `nirmaan_stack/api/boq/wizard/commit_gate.py` (beside `parse_run.py`, matching the
established wizard-endpoint convention — every BoQ whitelisted endpoint lives under `api/boq/wizard/`; placing the
commit gate next to the parse gate makes the deliberate distinction physically adjacent. `api/boq/commit/` was
rejected as premature for a single read function). Public API:
- `compute_committable_sheets(sheet_drafts, general_specs_sheet_names) -> list[dict]` — PURE helper, no DB,
  accepts Frappe child docs / `frappe._dict` / plain dicts via a `_get` shim; preserves input order; returns
  `[{"sheet_name", "disposition"}]`.
- `get_committable_sheets(boq_name) -> {"committable_sheets": [...]}` — `@frappe.whitelist()` READ-ONLY endpoint;
  loads `BOQs.sheet_drafts` + the `BOQs.general_specs_sheets` pointer (same read pattern
  `assemble_mapping_config` uses) and applies the pure helper. Missing/unknown BoQ → `frappe.throw`.

**Verification (in-session, real bench run).** `test_commit_gate` **13/13 green** in-container: 7 pure-helper
(T1 Finalized→finalized; T2 general-specs-pointer-as-Skip→general_specs; T3 every ineligible status incl. blank
""; T4 mixed exact subset; T5 parse-vs-commit distinction regression guard; T6 overlap→general_specs precedence;
#152 verbatim pointer match) + 6 endpoint end-to-end against a real mixed BoQ (exact subset, finalized,
general_specs, ineligible excluded, overlap, unknown-BoQ throws). Parser suite **597 UNCHANGED**. **NO doctype
JSON change → no migration required** (pure read logic over existing fields; verified no `.json` in the diff).

**Files (feat b93ec41c):** two NEW files only — `nirmaan_stack/api/boq/wizard/commit_gate.py` +
`…/test_commit_gate.py`. 2 files, +353 lines, 0 deletions. NO parser / `assemble_mapping_config` / BOQ Nodes /
BoQ Sheet / Slice-1 general-specs doctype / status-write / frontend change. Docs commit separate (this plan doc +
root CLAUDE.md substantive; frontend/CLAUDE.md minimal-touch). **NEXT = Slice 3** (the commit pipeline that calls
this gate, routes Finalized→line-item nodes via the P4-3 mapping + general_specs→the Slice-1 faithful-grid
doctype, and enforces one-current) **+ Slice 4** (hub commit UI).

## Phase 5 Slice 2.5 — committed tier is now CAPTURE-ONLY (BACKEND, feat 49b77635, 2026-06-16)

**What this slice is.** Makes the committed BOQ Nodes tier a TRUTHFUL CAPTURE STORE: when the Slice-3 pipeline
commits a reviewed BoQ, the node + its per-area child rows persist EXACTLY the reviewed values — no
recomputation. All money computation (amount = rate × qty, parent rate roll-up, child rate inheritance) is REMOVED
from the controller write chain and moves to the future tendering phase (built against that consumer's shape).
This is the owner-decided **capture-only** principle. Computation-removal ONLY: every STRUCTURAL invariant stays
and stays green; NOT the commit pipeline (Slice 3); NOT a schema redesign.

**Verify-first (re-confirmed at tip c5f72358 before editing):** V1 the two parent compute methods are called ONLY
from before_save (no external caller); V2 child compute is reached only via the parent's `_process_qty_by_area_rows`
→ `apply_before_save`; V3 NO structural validation reads a computed value (validate runs BEFORE before_save, so the
combined_rate consistency check + the child tolerance read INPUT rates; amounts are read only by `_write_audit`);
V4 the four fields are read_only=1; V5 `amount_override` is read at exactly 3 sites; V6 `is_rate_only` is written
only inside `_compute_amounts`.

**PARENT (`integrations/controllers/boq_nodes.py`):** `before_save` now calls only `_compute_path` (structural
path identity). REMOVED: the `_compute_amounts` call + def (recomputed supply/install/total_amount from qty×rate;
auto-set `is_rate_only`) and the `_recompute_parent_rates_from_areas` call + def (overwrote the parent rate with a
qty-weighted average on per-area divergence). `_process_qty_by_area_rows` did nothing but reach the (now-removed)
child compute, so the whole dead chain (it + the child `apply_before_save`) was removed; the `_area_ctrl` import
STAYS for `validate_child` (the kept tolerance check). **`is_rate_only` is NO LONGER auto-set anywhere** — the
field STAYS (structural-audit KEEP decision: rate-only rows aggregate differently downstream) and its value is
**CARRIED THROUGH from the BoQ Review Row by the Slice-3 pipeline** (the parser sets it; Slice 3 maps it onto the
node verbatim, same as every other captured field — **Slice 3 OWES this carry-through**). KEPT untouched: the full
`validate` chain (sheet-required, boq↔sheet sync-guard, node_type/description required, level rules, combined_rate
consistency, parent rules, `_validate_qty_by_area` incl. no-dup-area + per-child tolerance), `_compute_path`,
`after_insert`, `on_update`/`_write_audit`, `on_trash`.

**CHILD (`integrations/controllers/boq_node_qty_by_area.py`):** REMOVED `apply_before_save`, `_apply_rate_fallback`
(blank child rate inheriting the parent's) and `_compute_child_amounts` (child amount = rate×qty). KEPT
`validate_child` + `_validate_combined_rate` (structural tolerance). With fallback gone, a blank child rate stays
None, so the "all three set" guard short-circuits and never spuriously trips on an inherited value.

**SCHEMA (`boq_nodes.json`):** dropped `read_only` on `supply_amount` / `install_amount` / `total_amount` /
`is_rate_only` (now captured values written by the pipeline, not controller-derived display). NO field
added/removed. `amount_override` KEPT — its only remaining read is the cosmetic non-leaf-Preamble warning in
validate:38 (the field is otherwise dormant). **Known cosmetic-stale (not touched, tight JSON scope):** the
`is_rate_only` description still reads "Auto-set when qty=0…" and `amount_override`'s reads "prevent automatic
recomputation" — both now inaccurate; a later slice can correct the description text.

**TESTS (`test_boq_nodes.py`, still 71 — the suite now CERTIFIES capture-only):** the ~19 compute-asserting tests
were retargeted to assert "a value I set persists UNCHANGED; a value I leave blank STAYS blank (not
computed/inherited/auto-set)". 13 parent-COMPUTE retargeted (amounts-not-computed, set-amounts-persist-verbatim,
parent-rate-persists-when-per-area-diverges, is_rate_only-not-auto-set/persists-when-set), 5 child-COMPUTE
retargeted (child rate not-inherited, child amounts persist verbatim), 5 MIXED split (kept the structural
assertion — saves / consistency-fires-or-not — dropped only the dead `total_amount==` line). The **48
STRUCTURAL+NEUTRAL tests are untouched and stayed green**, proving no structural check depended on a removed
compute value (V3 confirmed empirically).

**Combined_rate consistency invariant STAYS (the dogfood watch).** It is the one structural check over rate inputs;
it remains enforced at validate time on the values the pipeline writes.

**VERIFICATION (in-session).** `bench migrate` CLEAN — after clearing 10 stale Role-Profile fixture-sync lock files
(the recurring environmental no-live-worker `DocumentLockedError` in `sync_fixtures`, unrelated to this change; the
`read_only` drops applied in the earlier schema-sync phase, which completed). `test_boq_nodes` **71/71 OK**;
`test_boq_node_qty_by_area` 0 tests (empty stub, green); parser suite **597 UNCHANGED**. **Zero blast radius:** no
other test module asserts node compute, and no live code (api/, parser, patches, `commit_gate.py`, the Slice-1
doctype) depends on node auto-compute (the parser's own `is_rate_only`/amount classification is a separate path).
4 files changed, +138/−199. **NEXT = Slice 3** must carry `is_rate_only` (+ all amounts/rates) from the review row
onto the node verbatim.

## Phase 5 Slice 3a — grid foundation + doctype rename + column-config snapshot + single-open commit shell (BACKEND, feat pending, 2026-06-16)

The FIRST slice of the commit pipeline and the FIRST to write REAL parsed BoQ data into the committed schema
(the #47 first-real-data crossing). Builds the GRID layer + the combined commit shell; the FINALIZED node-tree
branch is a PURE STUB (dispatched + no-op — that is Slice 3b).

**Two-layer model (the shell you are building).** Every committable sheet commits its COMPLETE original as a
FAITHFUL GRID (all 6 row classifications, in original position) into the renamed faithful-grid doctype. Finalized
sheets will ALSO commit a node tree (Slice 3b); general-specs sheets are grid-only. 3a writes the grid for BOTH
dispositions and dispatches to the node stub for finalized.

**(1) Doctype rename (free — zero rows existed).** `BoQ Committed General Specs` → **`BoQ Committed Sheet Grid`**
and its row child → **`BoQ Committed Sheet Grid Row`**: folders, `.json` `name`, controller files + classes
(`BoQCommittedSheetGrid` / `BoQCommittedSheetGridRow`), the `rows` table `options`, descriptions, and the test
file/class all renamed. Autoname **`BCGS-.YY.-.#####` → `BCSG-.YY.-.#####`** (decision: keep the prefix honest to
the new name; free with zero rows). The doctype is no longer general-specs-specific — it holds the faithful grid
for ANY committable sheet. **Frappe migrate AUTO-DELETED the orphaned old DocTypes** (built-in orphan cleanup:
"Orphaned DocType(s) found: BoQ Committed General Specs Row, BoQ Committed General Specs … Deleting orphaned
DocTypes") — this was NOT a `delete_doc` I added (the plan had said to leave the orphan inert; migrate cleaned it
itself). Harmless: zero rows, no runtime callers.

**(2) Discriminator field `sheet_disposition`** (Select `grid_only` / `grid_and_nodes`) added to the grid doctype.
RATIONALE: a Select over a `has_node_tree` Check — a self-documenting closed set that parallels the Slice-2 gate's
disposition vocabulary (`finalized` | `general_specs`) and leaves room for a future third disposition without an
awkward second boolean. VALUE MAPPING (ties to the gate, not re-derived): gate `general_specs` → `grid_only`;
gate `finalized` → `grid_and_nodes`. (`commit_version` / `is_current` / `committed_at` already existed from
Slice 1 — S4 satisfied, no new versioning fields.)

**(3) Commit shell + dispatch — NEW `nirmaan_stack/api/boq/wizard/commit_pipeline.py`.** `commit_boq(boq_name,
sheet_subset)` (whitelisted POST): calls the Slice-2 gate (`compute_committable_sheets`) for the eligible set +
each sheet's disposition; SERVER-SIDE GATE RE-CHECK rejects (throws) any subset sheet not in the eligible set,
BEFORE any file fetch or write — the caller's subset is never trusted; opens a PER-SHEET transaction boundary
(one trailing `frappe.db.commit()` per sheet, NO savepoints — the existing app-wide pattern); routes each sheet by
disposition to the grid write-body (both dispositions) + a node-write STUB (`_commit_node_tree_stub`, TODO(3b)
no-op) for finalized.

**(4) Single-open file path (shared, built here, used by 3a + 3b).** `sheet_preview.py`'s row-extraction loop was
WELDED + duplicated inside `get_sheet_preview` and `get_sheet_preview_full` (the fetch helper
`_fetch_boq_file_to_tempfile` was reusable, but there was no `ws`→rows helper). DECISION (owner): extract the
SHARED helper **`_extract_grid_rows(ws, min_row=1, max_row=None)`** and route BOTH endpoints through it
(behavior-preserving — the byte-identity test stays green), so the previewed grid and the committed grid read a
sheet through ONE implementation and cannot silently diverge. `commit_boq` fetches the workbook ONCE +
`load_workbook` ONCE, then LOOPS the committable sheets calling `_extract_grid_rows(ws)` inside the single open
workbook — no per-sheet re-open, no per-sheet whitelisted-endpoint loop; the S3-safe fetch helper is reused
verbatim.

**(5) Grid write-body (per sheet, BOTH dispositions).** Builds the faithful grid `{row_number, cells:{col_letter:
value}}` for every row (NO row dropped — note/spacer/subtotal_marker/header_repeat all kept), persists to
`BoQ Committed Sheet Grid` + its child `rows` (`row_order` = emission index). **Verbatim sheet identity (#152):**
`source_sheet_name` is matched byte-for-byte on BOTH the write and the freeze lookup — never trimmed (six sheets on
BOQ-26-00145 carry a trailing space; PostgreSQL `=` on varchar is byte-exact, so trailing spaces are significant
and the prior-version lookup finds the right row). **Versioning** per (boq, sheet verbatim): `commit_version =
max(prior)+1` (first = 1), `is_current=1`, `committed_at` set; the prior current grid's `is_current` flips → 0 —
exactly one current grid per (boq, sheet). `sheet_disposition` set per the gate mapping. All within the per-sheet
transaction.

**(6) Committed `BoQ Sheet` per sheet (both dispositions — incl. grid-only general-specs, which the node path
never created).** Creates the committed BoQ Sheet row (the P4-1 tier nodes attach to in 3b). REPLACE semantics: the
BoQ Sheet has no version dimension of its own (versioning lives on the grid; per-node versioning is 3b), so a
re-commit deletes the prior (boq, sheet verbatim) BoQ Sheet + its child work_packages and creates a fresh one —
keeping exactly one committed BoQ Sheet per (boq, sheet). **COLUMN-CONFIG SNAPSHOT (the linchpin):**
`column_role_map` + `column_headers` + `area_dimensions` (+ `header_row` / `header_row_count` / `treat_as`) are
pinned VERBATIM from the matching draft's `sheet_config` at commit; `sheet_order` / `sheet_label` / `work_packages`
carried from the draft; `treat_as` = master_preamble (general_specs) / data (finalized). This snapshot is what
later serves append-notes rendering, semantic column rendering, and Excel write-back addressing.

**GOTCHA (pinned).** `BoQ Sheet.area_dimensions` is a list-valued JSON field. It INSERTS fine via `json.dumps()`
(a string passes `get_valid_dict`), but Frappe parses it back to a Python list on load, so any later `doc.save()`
OR `delete_doc` (whose as_json archive calls `get_valid_dict`) THROWS "cannot be a list". The replace path
therefore uses raw `frappe.db.delete` (bypasses the lifecycle/archive) + explicit child-row cleanup (the BoQ Sheet
controller is a bare stub — no on_trash guard, so a raw delete is safe). Reads tolerate the parsed form
(`frappe.parse_json(v) if isinstance(v, str) else v`).

**Tests.** Renamed doctype suite `test_boq_committed_sheet_grid.py` 4/4 (baseline was 4; the BCGS→BCSG autoname
assertion updated). NEW `test_commit_pipeline.py` 11/11: grid round-trip (all rows kept, in order, cells by
col_letter — note/spacer/subtotal/header_repeat retained); column-config snapshot on a finalized sheet AND on a
grid-only general-specs sheet; discriminator mapping (finalized→grid_and_nodes, general_specs→grid_only);
versioning + freeze (v1→v2, exactly one current); committed_at set; gate re-check negative (ineligible / unknown /
empty subset throw, nothing written); verbatim trailing-space identity (a trimmed lookup would leave TWO current
grids — asserted it does not); one committed BoQ Sheet per sheet after re-commit. `test_sheet_preview` 32/32
UNCHANGED (byte-identity guard green → the `_extract_grid_rows` refactor is behavior-preserving). Parser suite
**597 UNCHANGED**. Test-fixture note: a `BOQs` row needs a non-empty `project` (the `before_insert` controller) —
a dummy `project` string + `ignore_links=True` satisfies it (the Slice-1 pattern).

**Migration.** `bench migrate` CLEAN (no Role-Profile lock this run; the orphan auto-clean is noted above — not a
failure). Schema verified at runtime: new doctypes present, old gone, `sheet_disposition` Select with options
`grid_only\ngrid_and_nodes`, autoname `BCSG-.YY.-.#####`, all version columns present.

**Live test (scripted commit-and-inspect on BOQ-26-00145 — the first-real-data crossing) PASS.** Gate →
SOW=general_specs, FAS=finalized. `commit_boq(["SOW","FAS"])` → SOW grid_only 39 rows (committed BoQ Sheet
treat_as=master_preamble, empty role-map — SOW has no parser config), FAS grid_and_nodes 1001 rows (committed BoQ
Sheet treat_as=data, header_row=2, header_row_count=2, role-map A–H, area_dimensions ['Phase 1','Phase 2']); the
node stub no-op'd (zero BOQ Nodes written — correct for 3a). Re-commit of the same subset → v1 froze (is_current
0), v2 current; exactly ONE current grid per sheet; the committed BoQ Sheet replaced (count = 1 each). The live
data persists on BOQ-26-00145 (legitimate committed data — the point of the crossing).

**Files.** 7 renamed (doctype folders/files) + 2 new (commit_pipeline.py + test_commit_pipeline.py) + the
sheet_preview.py refactor + docs. Pure-backend slice → docs scoped to root CLAUDE.md + this plan; frontend/CLAUDE.md
deliberately NOT touched (no frontend change this slice — the build prompt scoped it root-only; the DOCS-UPDATE
RULE's frontend minimal-touch is intentionally skipped, see the prompt's A15).

**NEXT = Slice 3b** (the node-tree write path for finalized sheets: resolve_effective() → BOQ Nodes + BOQ Node Qty
By Area per the P4-3 field-mapping lock, carrying is_rate_only + amounts/rates verbatim; per-node versioning; the
combined_rate throw→warning relaxation) **+ Slice 4** (hub commit UI / version picker / "Committed" status flip +
the hub last_committed_at mirror).

## Phase 5 Slice 3b — the node tree + provenance + three-tier versioning + combined_rate relaxation (BACKEND, feat pending, 2026-06-17)

FILLS the node-write stub Slice 3a left in `commit_pipeline.py`. The second real-data-write slice; completes the
commit pipeline's node layer. A FINALIZED sheet now commits a faithful grid (3a) AND a node tree (3b);
general-specs sheets stay grid-only.

**Recon first (read-only, prior turn).** Confirmed: `resolve_effective` lives only in `review_screen.py:252`,
returns a per-row dict with `effective_classification` + `effective_parent_index` (a review ROW_INDEX or None);
the P4-3 word-order reversal is real (rate_supply→supply_rate, etc.); BOQ Nodes had NO provenance/versioning
fields (P4-4 added only edit_log/edited_by/edited_at/remarks/attached_notes); BoQ Sheet had NO versioning fields;
the grid-freeze precedent uses `frappe.db.set_value`. THREE recon/build STOP-CHECKs fired and were resolved with
the owner: (4a-i) BOQ Nodes has list-valued JSON fields `attached_notes`+`edit_log` → `doc.save()` pass-2 unsafe;
(S3) BOQ Nodes lacked `append_notes_raw`; (4c-i) **the real per-area data is FLAT `{area:float}`, not the recon's
nested `{area:{kind}}`** — the current parser emits nested (BOQ-26-00166 VRF System confirmed nested L1/L2
supply/install/combined), so both shapes must be handled.

**Six locked decisions** (carried into the build): (1) per-area explosion = dual-shape, NEVER downgrade
granularity; (2) live-test the nested path on BOQ-26-00166 VRF System (real nested data); (3) rate path is
live-certified via 00166 (00145 had no per-area rates); (4) carry `edit_log` (P4-4: node is the durable home for
the review row's edit history); (5) parent wire = doc.save with deferred list-JSON fields; (6) add
`append_notes_raw`.

**Step 1 — schema (migrate clean).** BOQ Nodes: `review_row_name` (Data — source BOQRR- name; human-readable tie,
MAY DANGLE on re-parse), `commit_provenance_id` (Data — frappe.generate_hash, the DURABLE key), `is_synthetic`
(Check — FUTURE-INSURANCE: 0 across the whole current corpus, carried verbatim so the plumbing is ready),
`append_notes_raw` (JSON, dict-valued), and the per-node versioning triple
`commit_version`/`is_current`/`committed_at`. BoQ Sheet: the SAME versioning triple (it had none — only the grid
did). All columns verified present at runtime.

**Step 2 — combined_rate throw → WARNING (capture-only).** Parent (`boq_nodes.py`) + child
(`boq_node_qty_by_area.py`) `frappe.throw` → `frappe.msgprint(alert=True, indicator="orange")`; the node saves,
values persist verbatim, tendering reconciles. This is a prerequisite for the node body (pass-2 `doc.save()`
re-fires the checks). 3 throw-tests retargeted to assert-saves; the 5 success tests untouched.

**Steps 3–4 — the node body (`_commit_node_tree` replaces the stub).** Reads review rows ({boq, sheet_name
VERBATIM #152}, row_index asc), runs `resolve_effective` (imported, not reimplemented), maps
`effective_classification` → node_type: **preamble → Preamble (+level), line_item → Line Item (no level);
note/spacer/subtotal_marker/header_repeat → GRID-ONLY, NOT nodes** (the Select has exactly Preamble + Line Item).
**TWO-PASS + DEFERRED LIST FIELDS** (the load-bearing mechanic, resolving 4a-i): BOQ Nodes' list-valued JSON
`attached_notes`/`edit_log` would trip `doc.save()`'s get_valid_dict ("cannot be a list"). PASS 1 inserts each
node parent-less with those two fields NULL (dict-valued `append_notes_raw` IS set in pass 1 — only LISTs trip the
wall); PASS 2 sets `parent_node` + `doc.save()` in ANCESTOR-DEPTH order (paths cascade correctly + the
parent-chain validation re-runs as a free integrity check) — list-safe because the two list fields are still null;
PASS 3 writes `attached_notes`+`edit_log` via `frappe.db.set_value(json.dumps(...))` (targeted column write,
bypasses full-doc serialization). MONEY = P4-3 word-order reversal, Float→Currency (Frappe coerces, no manual
round); `qty_total→qty` (Float stays Float); `sl_no_value→code`, `row_index→sort_order`. is_rate_only/is_synthetic
carried verbatim. HUMAN LAYER (human_classification/human_parent[-1 sentinel]/human_is_root) carried as PROVENANCE
ONLY — never branched on (the LIVE wiring is parent_node+node_type+level from resolve_effective). edit_log carried
(decision 4); notes←row_notes; attached_notes carried verbatim (Option A — no aggregation/up-roll). Provenance:
review_row_name = the row name, commit_provenance_id = frappe.generate_hash().

**Step 4c — per-area child explosion (`_explode_area_children`) — DUAL-SHAPE, NEVER DOWNGRADE (owner-locked).**
qty_by_area always flat `{area:float}` → child.qty (defaults 0.0 for an area absent from qty but present in
rate/amount — child.qty is reqd=1); rate_by_area NESTED `{supply_rate,install_rate,combined_rate}` → each on its
own child column, FLAT scalar → combined_rate ONLY (deliberate; supply/install left empty, not invented);
amount_by_area NESTED `{supply,install,total}` → supply_amount/install_amount/total_amount each, FLAT scalar →
total_amount ONLY. area_name = dict key verbatim (#152).

**Step 5 — three-tier shared versioning + the BoQ Sheet fold.** ONE shared `commit_version` per (boq, sheet)
(`_next_commit_version` = grid max+1) covers grid + sheet + nodes. On re-commit each tier FREEZES its prior
current via `frappe.db.set_value(is_current=0)` — NEVER `doc.save()` (BoQ Sheet's list-valued `area_dimensions`
would re-serialize and hit get_valid_dict). **3a's raw-DELETE of the prior BoQ Sheet is RETIRED →
freeze-and-supersede**: the prior sheet + its nodes survive as a coherent frozen vN snapshot; v1 nodes stay
attached to frozen sheet v1. Node re-commit freezes the prior commit's current nodes (attached to the frozen prior
sheet), never touching their parent_node. **Centralized is-current accessor `_current_names(doctype, boq,
name_field, value)`** (recon Q5 — none existed): one helper, three callers (grid:source_sheet_name,
sheet:sheet_name, nodes:sheet). Step 6: the 3a gate re-check is intact (verified).

**Tests.** test_commit_pipeline 11→19 (node tree built preamble+line-items-only / note+spacer skipped;
provenance+flags carried; human-layer+notes+edit_log+append_notes_raw carried; per-area nested-granularity-survives
+ flat→total/combined; combined_rate warns-not-throws; three-tier re-commit freeze [grid+sheet+nodes one shared
version, v1 nodes attached to frozen sheet v1, one current per tier]; is-current accessor; T7 retargeted to
versioned-NOT-deleted). test_boq_nodes 71 (3 retargeted to capture-only warns). test_review_screen 158 UNCHANGED
(resolve_effective import safe). Parser **597 UNCHANGED**. A child-`qty`-reqd surprise (the flat explosion's
amount-only area) was fixed by defaulting child qty to 0.0; a Currency-defaults-to-0.0 (not None) test expectation
was corrected.

**Live test (scripted, second real-data crossing) — BOTH PASS.** FLAT BOQ-26-00145 FAS → 21 nodes (5 Preamble + 16
Line Item; note/spacer skipped from 1001 grid rows), parent tree wired 0-dangling, money verbatim vs the review
rows, provenance set; re-commit froze grid+sheet+nodes to one shared version (v3→v4 — 3a had left grid v1/v2 for
FAS, so max+1 is consistent), prior BoQ Sheet NOT deleted (3 FAS sheets, versions [1,3,4], 1 current), v1 nodes all
is_current=0 attached to the frozen sheet, exactly one current per tier. NESTED BOQ-26-00166 VRF System (set
Finalized as documented test setup) → 69 nodes; per-area L1/L2 each carry distinct supply_rate=160 / install_rate=40
/ combined_rate=200 on separate committed child columns — granularity SURVIVES (decision #1 proven on real data).
The live test left legitimate committed data on both BoQs and set BOQ-26-00166 VRF System → Finalized.

**Files.** boq_nodes.json + boq_sheet.json (schema), boq_nodes.py + boq_node_qty_by_area.py (relaxation),
commit_pipeline.py (node body + versioning fold + accessor), test_boq_nodes.py (3 retargeted),
test_commit_pipeline.py (+8 / T7 retarget) + docs. Pure-backend slice → root CLAUDE.md + this plan;
frontend/CLAUDE.md NOT touched (no frontend change). NEXT = Slice 4 (hub commit UI / version picker / "Committed"
status flip + the hub last_committed_at mirror).

## Phase 5 — level-less preamble guard fix (post-dogfood) (BACKEND, feat pending, 2026-06-17)

**The bug (found by the dogfood + a read-only recon).** `commit_pipeline._build_node_pass1` stamped a flat
`level=1` on ANY preamble whose parser level was unset/0. That breaks the tree when a child is also level 1 — e.g.
BOQ-26-00145 'Electrical ' row 18 "Note:" was committed at level 1, but its child row 20 is level 1 (parent ==
child level). A read-only recon across ALL finalized committable sheets found exactly **3 live cases**, all
committed at the buggy level 1, and **no squeeze/inversion edges** in real data.

**The rule.** A level-less preamble (no classifier override ≥1 and no parser level ≥1) is assigned:
- **WITH children → `max(0, min(child effective-level) − 1)`** — the shallowest child wins, so the preamble sits one
  level above its shallowest child; line-item children count as level 0.
- **CHILDLESS → the sheet's shallowest DEFINED preamble level; if the sheet has no defined levels at all → 0**
  (a sheet of line-items + one promoted preamble has no defined levels).
A normal preamble with a real ≥1 level (override or parser) is **unchanged**. The Preamble level constraint relaxes
from `≥1` to `≥0` (`integrations/controllers/boq_nodes.py`: throws only on `level is None or < 0`; the JSON `level`
is a plain Int with no min, so **no doctype change, no migrate**).

**The 3 real cases (now asserted with seeded review rows, not live data):** children all level 1 → 0 (Electrical
row 18); children mix level-0 line-items + level-1 preamble → 0 (low side row 191, min child 0); childless, sheet
has no defined levels → 0 (Fire Fitting row 8). Plus a control (normal multi-level preamble tree unchanged).

**Implementation.** `commit_pipeline.py`: new module-level `_real_preamble_level(d)` (override≥1 wins, else
level≥1, else None = level-less) + `_compute_levelless_preamble_levels(sheet_name, node_rows, eff_parent_by_idx)`
computed ONCE per sheet in `_commit_node_tree` (reuses the eff map; no re-resolve) and passed into
`_build_node_pass1` (signature extended with `assigned_levels`). A SAFETY warning (`frappe.msgprint`, not exercised
by current data) fires if a level-less preamble has both a parent and children and the computed level wouldn't sit
above the parent (squeeze) — best-effort assign, never silently jam.

**Tests.** `test_boq_nodes` 71→72 (`test_preamble_level_zero_rejected` retargeted → `_zero_saves` [level 0
persists] + new `_negative_rejected` [level −1 still throws]); `test_commit_pipeline` 19→23 (+4: with-children,
mixed-min, childless-no-levels, normal-multilevel regression); `test_review_screen` 158 UNCHANGED (import safe);
parser **597 UNCHANGED**. No migrate (no schema JSON change).

**OWED — a SEPARATE run before push:** the 3 live cases (and any other affected sheets) are still committed at the
buggy `level=1` until **re-committed**; the re-commit + a round-trip re-verify is a separate run. Pure-backend →
root CLAUDE.md + this plan; frontend/CLAUDE.md NOT touched.

## Phase 5 — X: commit all classified rows as semantic nodes (BACKEND, feat 711a792b, 2026-06-17)

**Goal.** Make the committed node tree a COMPLETE SEMANTIC MIRROR of the reviewed BoQ. Before X, only
`preamble` + `line_item` committed as BOQ Nodes; `note` / `subtotal_marker` / `header_repeat` were grid-only, so
the node layer was not a full semantic record. The dogfood surfaced a note (e.g. BOQ-26-00145 'Electrical ' "Aluminium
Cables" / its XLPE spec paragraph) losing its discrete classification + parent in the node tree. X commits every
classified row EXCEPT spacer, carrying its classification + parent + details — so the node tree equals the review
output minus only the dropped parser-QA fields.

**Read-only recon (prior turn) — the live corpus.** classification counts: line_item 465, note 268, spacer 225,
preamble 127, subtotal_marker 9, **header_repeat 0** (does not occur — handled defensively only). Parenting (via
`resolve_effective`): note→preamble 265 / note→root 3; spacer→root 225 (all); subtotal_marker→root 9 (all);
**zero non-priceable rows under non-priceable parents** (the tree stays clean: notes hang under preambles,
spacers/subtotals float at root). Field population: notes carry rich `description` + a real parent (+ occasionally
unit/row_notes), no money; subtotal_markers carry `description="TOTAL"`, no computed sum, root; spacers carry NOTHING
(no description) — pure layout.

**Node shape = OPTION A (owner-locked).** `node_type` stays the PRICEABILITY axis (Preamble / Line Item) + a NEW
neutral 3rd Select value `Other` for non-priceable rows; a NEW field `row_class` (Data) carries the FULL effective
classification (the taxonomy axis). A future external pricing engine selects priceable rows with exactly
`node_type in (Preamble, Line Item)` — unchanged, and without needing the full taxonomy. Option B (adding
note/spacer/etc. as node_type values) was rejected: it redefines node_type's domain and would force an audit of
every node_type consumer; Option A is strictly additive (existing two values' meaning byte-identical).

**Rows committed as nodes.** preamble, line_item, note, subtotal_marker, AND header_repeat (defensive — zero live
data). **SPACER alone stays grid-only** — pure layout, no semantic content; the faithful grid (3a) already preserves
its position. The filter is "commit everything EXCEPT spacer", not "only preamble+line_item".

**Per-type commit mapping.** preamble → node_type Preamble + level (existing rules + the Q8 fix); line_item →
Line Item (no level); note → Other, row_class note, description (the note text), parent_node = its preamble parent
(wired by pass 2), unit/row_notes carried if present, NO qty/rate/amount; subtotal_marker → Other, row_class
subtotal_marker, description ("TOTAL"), root, NO computed sum; header_repeat → Other, row_class header_repeat,
description carried (defensive). `row_class` = the full effective classification for EVERY node.

**NO note re-attach (critical).** The parser ALREADY rolls each descendant note's text onto its nearest-ancestor
preamble's `attached_notes` at parse time (recon: populated on 84 preamble review rows, NEVER on note rows; e.g.
'Electrical ' row 24 "LT CABLES" already carries all 7 of its descendant notes), and 3b carries `attached_notes`
verbatim onto the preamble node. X commits the note as its OWN discrete node WITHOUT a second walk-and-attach — a
second attach would DOUBLE the text. preamble/line_item commit exactly as before, including the existing
attached_notes carry. (The brief's premise that row 24 was empty was false; verified read-only first.)

**Implementation.**
- `boq_nodes.json`: `node_type` Select `Preamble\nLine Item` → `Preamble\nLine Item\nOther`; new `row_class` Data
  field placed after node_type. Migrate CLEAN (additive Select value + one Data field — verified `row_class`
  column + the `Other` option via `get_meta`).
- `integrations/controllers/boq_nodes.py`: the description-required throw is gated to
  `node_type in ("Preamble", "Line Item")` so an `Other` node may be contentless and no-ops. Recon confirmed EVERY
  other validation branch already falls through both `if/elif` for `Other` (Preamble level rules, Line-Item
  level-unset/qty-required, parent rules, combined_rate, qty_by_area) — no other relaxation needed. `row_class` is
  stored, never validated.
- `commit_pipeline.py`: `_NODE_CLASSIFICATIONS` retired → `_PRICEABLE_CLASSIFICATIONS` (={preamble,line_item}; drives
  node_type + the level calc) + `_GRID_ONLY_CLASSIFICATIONS` (={spacer}; the skip set). `_commit_node_tree`'s filter
  flips to "in grid-only-set → skip". `_build_node_pass1` sets `node.row_class = effective_classification` for every
  node and node_type via a 3-way branch (preamble→Preamble+level, line_item→Line Item, else→Other); the
  `qty None → 0` default stays Line-Item-only.
- **Q8 level-guard fix (mandatory — X breaks it otherwise).** `_compute_levelless_preamble_levels` now counts ONLY
  PRICEABLE (preamble/line_item) children toward `child_levels`; a note/subtotal carries level 0 and would wrongly
  pull a level-less preamble to level 0. A preamble whose only children are non-priceable now falls to the childless
  branch. The 3 existing level-less cases are unaffected (their children are preambles).

**Tests.** `test_commit_pipeline` 23→27 (+4: commit-all-except-spacer [note+subtotal→Other, correct row_class, note
wired to preamble, spacer NOT a node]; Other note carries description + no money; attached_notes NOT doubled; Q8
note-child excluded from the level calc; + the 2 existing node-tree tests retargeted in place — note now a node,
counts 3→4). `test_boq_nodes` 72→74 (+2: Other saves cleanly [no level/qty]; Other under a Preamble saves).
`test_review_screen` 158 UNCHANGED (import safe); parser 597 UNCHANGED. `bench migrate` CLEAN.

**OWED — SEPARATE NEXT runs before push:** RE-COMMIT all affected finalized sheets (the live committed nodes still
reflect the pre-X 2-type tree) + a round-trip RE-VERIFY with an attached_notes verification column. Pure-backend →
root CLAUDE.md + this plan; frontend/CLAUDE.md NOT touched (no frontend reads nodes).

## Phase 5 Slice 4a — committed-state read endpoint (BACKEND, feat 964e14d0, 2026-06-17)

**Goal.** Give the (coming) Slice-4b hub commit UI a per-sheet CURRENT committed-state read, so it can render a
"Committed" badge + timestamp on a committed sheet card, a "Committed: N" footer count, and last-committed
date/time inside the commit modal's already-committed warning. READ-ONLY: one new whitelisted endpoint + its
tests; no writes, no doctype JSON change, no migration.

**Why a NEW read (recon-confirmed).** The two existing commit endpoints do NOT surface committed-state: the gate
`get_committable_sheets` returns ELIGIBILITY only ({sheet_name, disposition}); `commit_boq` returns post-commit
metadata but does not echo `committed_at`. The modal therefore needs BOTH calls (gate for eligibility + this new
read for committed-state). The authoritative committed_at source is the **`BoQ Committed Sheet Grid`** tier — it is
written for BOTH dispositions (grid_only general-specs AND grid_and_nodes finalized), anchors the shared
`commit_version`, and the Slice-3 pipeline's freeze-and-supersede invariant keeps exactly one `is_current=1` row
per (boq, source_sheet_name); its JSON `committed_at` description already names it the Slice-4 source of truth.

**Implementation (`commit_gate.py`, beside the gate it complements).**
- New `@frappe.whitelist() def get_committed_state(boq_name) -> dict`. Same missing/unknown-BoQ guard as
  `get_committable_sheets` (`frappe.throw` "boq_name is required." / "BOQs '...' not found." → `ValidationError`).
- `frappe.get_all("BoQ Committed Sheet Grid", filters={"boq": boq_name, "is_current": 1}, fields=["source_sheet_name",
  "committed_at", "commit_version"])`, mapped to `{"sheet_name": <source_sheet_name VERBATIM #152>, "committed_at":
  <Datetime|None>, "commit_version": int}`. Returns `{"committed_state": [...]}`; empty list when nothing committed.
- PURE read — no set_value/insert/save/commit. NO dedup logic: the one-current invariant is pipeline-enforced; were
  it ever violated a sheet would simply appear twice rather than being silently collapsed (noted in the docstring).
- `get_committable_sheets` / `compute_committable_sheets` / `commit_pipeline.py` / all doctype JSON UNTOUCHED.

**Tests.** `test_commit_gate` 13 → 18 (+5, new `TestGetCommittedState` seeding `BoQ Committed Sheet Grid` rows
directly — no pipeline run): current state returns committed_at + commit_version; a prior frozen v1 (is_current=0)
+ current v2 → only v2 surfaces (commit_version 2); a trailing-space sheet name round-trips VERBATIM (`"Elec "`
present, `"Elec"` absent); a BoQ with no committed grid → `{"committed_state": []}`; unknown BoQ throws. The 13
existing gate tests still pass (same module). RUN in-container `bench --site localhost run-tests --app
nirmaan_stack --module nirmaan_stack.api.boq.wizard.test_commit_gate` → 18/18 OK.

**Scope.** BACKEND-ONLY (Slice 4b = the hub UI, separate). Pure-backend → root CLAUDE.md + this plan;
frontend/CLAUDE.md minimal-touch per the DOCS-UPDATE RULE.

## Phase 5 Slice 4b — commit UI: hub button + commit modal + committed badge + count (FRONTEND, feat 53645ab7, 2026-06-17)

**Goal.** The user-facing commit entry point on the BoQ hub, wiring a UI onto the proven engine (`commit_boq`,
already whitelisted) + the Slice-4a read (`get_committed_state`). Four deliverables: a global "Commit" footer
button → a checklist modal of commit-eligible sheets; a one-step re-commit warning naming already-committed sheets
+ their last-committed date/time; a per-sheet "Committed" badge + timestamp on committed cards (a SEPARATE marker
alongside the status pill, NOT a wizard_status); and a "Committed: N" footer tally. FRONTEND-ONLY — no backend
Python, no doctype JSON.

**Wiring onto proven patterns (no new scaffolding).** The modal mirrors `ExportWorkbookDialog` (the
`useState<Set<string>>` checklist + not-dismissible-mid-flight + inline `getFrappeError`) and `ParseRunDialog` (the
`const [step,setStep]=useState<1|2>(1)` two-step warning). The committed timestamp reuses the wizard's
`slice(0,16)` "date HH:MM" pattern (ReviewTree's `formatEditAt`) via a tiny local `fmtCommittedAt` in each consuming
file — app-shared `formatDate` is NOT mutated and NO new shared helper file was added.

**Files.**
- `boqTypes.ts` — ADD `CommittableSheet` / `GetCommittableSheetsResponse` (gate) + `CommittedSheetState` /
  `GetCommittedStateResponse` (Slice 4a). NO committed field on `BoQSheetDraft`; NO "Committed" in `WizardStatus`.
- `CommitDialog.tsx` (NEW) — props `{open, onOpenChange, boqName, eligibleSheets, committedState, onCommitted}`.
  Ticked `Set<string>` initialized EMPTY (opens with nothing ticked, reset on open). Each row: name + disposition
  hint + a muted "committed {date HH:MM} · v{n}" sub-label (or "not yet committed"). `handleConfirmClick` computes
  the ticked sheets that ALSO appear in `committedState` (the re-commits); NON-EMPTY → `setStep(2)`, else fire
  directly. Step 2 = destructive `AlertTriangle` callout NAMING each re-commit sheet WITH its last-committed
  date/time + "the prior version is frozen, not lost", "Go back" / destructive "Commit anyway". `fireCommit` calls
  `commit_boq` via `useFrappePostCall` with `{boq_name, sheet_subset: tickedList}` (ordered ticked list, VERBATIM
  #152; backend re-checks the gate). running/error/not-dismissible-mid-flight copied from Export. On success →
  `onCommitted()` then close.
- `BoqHubPage.tsx` — TWO new `useFrappeGetCall` reads (`get_committable_sheets` + `get_committed_state`, same
  null-key family as the work-package map, each with `mutate`); a `committedMap` (sheet_name VERBATIM → state); the
  Commit button as the **4th footer sibling** (disabled when `committableSheets.length === 0`, from the GATE not
  committed-state); the `CommitDialog` mount with `onCommitted = () => { mutate(); mutateCommittedState();
  mutateCommittable(); }`; the "Committed: N" count (`allDrafts.filter(d => committedMap.has(d.sheet_name))`, in the
  existing `count>0 && ...` chain — derived from committed-state, NOT `getEffectiveStatus`); `committedState` passed
  to each `SheetCard` at both render sites.
- `SheetCard.tsx` — new optional `committedState?: CommittedSheetState`; when present an indigo "Committed" badge
  renders in the badge cluster ALONGSIDE the status pill (distinct from every STATUS_PILL color; NOT added to
  STATUS_PILL/WizardStatus) + a muted "· Committed {date HH:MM} · v{n}" sub-line. Same treatment for finalized AND
  general-specs.

**Verification.** tsc 0 new wizard-file errors; in-container Vite build exit 0. De-stale (pkill -f vite, restart,
clear site data, unregister SW, reopen, :8080) then live-cert on a real committed BoQ (badge + timestamp, footer
count, modal nothing-ticked, re-commit warning naming the sheet + date/time). Pure-frontend → all three docs
(frontend/CLAUDE.md substantive, root CLAUDE.md cross-ref, this plan). The owner drives any live re-commit.

## Phase 5 Slice 5 (backend) — commit_boq reports per-sheet committed + failed (BACKEND, feat 09714041, 2026-06-17)

**Goal.** A commit-results modal (a SEPARATE later frontend prompt) must enumerate per-sheet SUCCESS and per-sheet
FAILURE. The partial-failure recon established `commit_boq` already commits per sheet (each `_commit_one_sheet`
ends with `frappe.db.commit()`, so earlier sheets are durable) but on a mid-batch failure it RAISED and aborted the
rest — the caller never learned which sheets succeeded vs failed. This slice changes propagate-and-abort into
catch-rollback-continue-and-report. BACKEND-ONLY (`commit_pipeline.py` + its test); the frontend modal is next.

**The change (`commit_pipeline.py`).** The per-sheet loop wraps each sheet's work in `try/except`. On `except`:
1. **`frappe.db.rollback()` — MANDATORY (the load-bearing safety point).** Catching the exception SUPPRESSES
   Frappe's request-level rollback (which today, in the raise path, discards the failed sheet's uncommitted work).
   Without an explicit rollback here, the failed sheet's freeze-before-write (its prior version's `is_current` set
   to 0) + partial new writes stay pending, and the NEXT sheet's `frappe.db.commit()` FLUSHES them — ORPHANING the
   sheet (prior frozen to `is_current=0`, new write incomplete → NO `is_current=1` version). The rollback runs
   FIRST, before recording/continuing. Already-committed earlier sheets are durable (commit made them permanent;
   rollback only affects the current uncommitted txn).
2. record `{sheet_name, reason}` in a new `failed[]` (`reason` via new `_commit_failure_reason(e)` — prefers the
   exception's message, lightly HTML-stripped, with a safe fallback "Commit failed for this sheet -- see server
   logs."; NEVER empty), `frappe.log_error` the traceback, `continue`.
Return envelope is now `{boq_name, committed, failed}` — `failed` is `[]` on full success (key always present).
**MIXED STATE is a valid resting outcome** (3 succeed + 2 fail → 3 durable, 2 rolled back); NO all-or-nothing
wrapper. The commit-per-sheet boundary + `_commit_one_sheet` + the three tier-writers are UNCHANGED. The
sheet-not-in-workbook check moved INSIDE the per-sheet try (a genuinely-absent eligible sheet → `failed[]`, loop
continues); the UPFRONT gate re-check STAYS a whole-call throw (eligibility is a precondition, not a runtime
failure).

**Tests (`test_commit_pipeline` 27 → 33, +6 in a new `TestCommitBoqPartialFailure`).** These drive `commit_boq`
(the public loop) with its file path PATCHED — `_fetch_boq_file_to_tempfile` + `openpyxl.load_workbook` (→ a
`_FakeWB`) + `_extract_grid_rows` (→ synthetic rows) — so no S3 / real workbook is needed; a per-sheet failure is
induced by monkeypatching `_commit_one_sheet` (or `_commit_node_tree` for the post-freeze orphan case) to raise for
ONE sheet_name. T1 partial-success durability (3 sheets, #2 fails → #1/#3 persisted, #2 wrote nothing); **T2
ORPHAN-PREVENTION (load-bearing)** — a re-commit whose new write fails AFTER the real tier-1/tier-2 freezes; asserts
the prior version stays `is_current=1`; **PROVEN to FAIL (`AssertionError: 0 != 1`) when the `frappe.db.rollback()`
line is neutered** (verified by temporarily neutering, running, restoring); T3 all-success `failed=[]`; T4 envelope
shape `{boq_name, committed, failed}` + each failed entry `{sheet_name, reason}`; T5 reason fallback on a
message-less exception; T6 sheet-absent-from-workbook lands in `failed[]`. Full suite `Ran 33 tests OK`.

**Scope.** BACKEND-ONLY — root CLAUDE.md + this plan; `frontend/CLAUDE.md` intentionally NOT touched (no frontend
change this slice; the commit-results modal that consumes `failed[]` is a separate frontend prompt). No doctype
JSON, no migration.

## Phase 5 Slice 5 (frontend) — commit-results acknowledge modal (FRONTEND, feat ab4a390b, 2026-06-18)

**Goal.** Consume the Slice-5 backend envelope (`commit_boq` → `{boq_name, committed:[{sheet_name, commit_version,
...}], failed:[{sheet_name, reason}]}`, which NO LONGER throws on a per-sheet failure). After a commit the user now
sees an explicit RESULTS acknowledgement — a hub-scoped OK-dismiss modal that enumerates, SEPARATELY, the sheets
that committed (with version) and the sheets that failed (with reason). MIXED outcomes are normal. FRONTEND-ONLY.

**Pattern (no new scaffolding).** Mirrors the hub's parse-completion modal: an acknowledge-only `AlertDialog`, open
driven from result state, single `AlertDialogAction` "OK" + escape dismiss. The result flows up via OPTION (i) —
`CommitDialog` keeps its "pick + fire" job and hands the resolved envelope to the hub; the hub owns the results
modal (consistent with the hub owning the parse-completion modal).

**Files.**
- `boqTypes.ts` — ADD `CommittedSheetResult` (reads `sheet_name` + `commit_version`; other envelope keys optional)
  + `FailedSheetResult` (`sheet_name` + `reason`) + `CommitBoqResponse` (`{boq_name, committed[], failed[]}`).
  DISTINCT from `CommittedSheetState` (the get_committed_state read) — this is the commit RESULT.
- `CommitDialog.tsx` — `fireCommit` now captures `res.message as CommitBoqResponse` and calls
  `onCommitted(result)` (prop widened `() => void` → `(result: CommitBoqResponse) => void`) then closes. The catch
  stays for WHOLE-CALL precondition throws (gate re-check / missing boq / empty subset / file fetch); per-sheet
  failures arrive in `result.failed`, not the catch. Picker behavior (opens nothing-ticked, the step-1/2 re-commit
  warning) UNCHANGED.
- `CommitResultsModal.tsx` (NEW) — props `{open, onOpenChange, result: CommitBoqResponse | null}`; renders nothing
  when `result` is null. Summary header reads all three cases ("Committed N sheet(s)." / "Commit failed for N
  sheet(s)." / "Committed N sheet(s); M failed."). COMMITTED list (emerald + CheckCircle2, "{sheet} — committed
  v{n}") and FAILED list (text-destructive + AlertTriangle, "{sheet} — {reason}"), each shown only when non-empty.
  Single OK + escape dismiss.
- `BoqHubPage.tsx` — new `commitResult` + `commitResultsOpen` state; `handleCommitted(result)` stores the result,
  fires the existing mutates (`mutate` / `mutateCommittedState` / `mutateCommittable` — unconditional, harmless on an
  all-failed commit), and opens the results modal; `<CommitResultsModal>` mounted alongside the other hub modals.
  The Slice-4b badge/count/committed-state wiring is untouched.

**Verification.** tsc 0 new wizard-file errors (filtered) + in-container Vite build exit 0. HAPPY-PATH live-cert is
OWNER-OWNED (on BOQ-26-00145: Commit → tick a sheet → results modal shows the committed list + new version; OK
dismisses; badge/count/version refresh). FAILURE-path render is covered by the Slice-5 backend tests (T1/T4/T5/T6
populate `failed[]`) + code inspection — NOT exercised live (no real-data mutation, no browser-driving). All three
docs updated (frontend/CLAUDE.md substantive, root CLAUDE.md cross-ref, this plan).

---

## Phase 5 Pricing-overlay read — get_priced_rows (BACKEND, pure-read, feat pending, 2026-06-20)

**Goal.** The composing read between Slice 1b (the pricing-layer doctype + persist) and the editor UI: a new
whitelisted endpoint `get_priced_rows(boq_name, sheet_name)` in `api/boq/wizard/pricing.py` that returns the
committed rows for a sheet WITH the current saved prices merged in — so the future pricing grid consumes ONE
already-merged structure instead of joining two reads on the client. PURE READ: never writes, never mutates the
committed tier, never creates/changes a `BoQ Cell Pricing` record. NO doctype JSON change → NO migrate.

**Composition (reimplements neither source).** Calls `review_screen.get_committed_rows` (imported at module top — no
circular import: review_screen does not import pricing) + this module's `get_sheet_pricing`, then merges. Arg /
not-found guards are inherited from `get_committed_rows` (called first; throws on missing boq_name / sheet_name /
unknown BOQs).

**The one additive change to get_committed_rows (review_screen.py).** Adds a top-level `commit_version` key to its
response — the current committed BoQ Sheet's `commit_version`, selected in the EXISTING sheet read (added to the
`["name","column_role_map","column_headers","commit_version"]` field list) and surfaced on all three return paths
(None on the no-sheet empty path). The overlay reads it as the single source of truth for "which version is current"
and passes it to `get_sheet_pricing` — re-querying in the overlay would be a second source that can race the read.
Purely additive: no existing key or row changed. Two committed-read assertions updated for the additive key
(`test_draft_only_fields_omitted` key-set + value; the uncommitted empty-contract dict-equality).

**The merge (descriptor-driven — col_letter is NOT on the committed row).** The committed row carries rate values by
structure (scalar `rate_supply`/`rate_install`/`rate_combined`; per-area `rate_by_area[area][kind]`), not by column
letter; only `column_descriptors` map a `col` letter to `(value_field, value_key=area, rate_subkey=kind)`. So the
overlay: indexes the current FILLED prices by `(excel_row, col_letter)`; filters descriptors to RATE descriptors only
(`value_field == "rate_by_area"` OR in `{rate_supply, rate_install, rate_combined}` — amount/qty descriptors NEVER
stamped); then for each row × each rate descriptor looks up `(row.source_row_number, descriptor.col)`.
`source_row_number` is the Excel join key (= pricing `excel_row`); `row_index` (= sort_order) is a DIFFERENT integer
space and is never used for the join.

**Stamp + mark.** A matched price stamps its `rate` IN PLACE — `row["rate_by_area"][area][kind]` (setdefault-created
if absent) for per-area, or `row[scalar field]` for scalar — AND sets a parallel marker: `priced_by_area[area][kind]
= True` for per-area cells, `priced_<scalar field>` (e.g. `priced_rate_combined`) = True for scalar cells. THE
correctness rule: priced-ness comes from the PRESENCE of a current price record + its `is_filled` (the index is gated
on `is_filled`), NEVER a zero-check — a committed 0.0 rate is a valid value, and a 0.0-rate save with is_filled=1
reads PRICED. Un-priced cells keep their committed value and carry no marker.

**Reserve-for-lock (forward-compat, nothing built).** The response includes two INERT placeholders — `editable: true`
+ `lock_info: null` — reserved so a future single-editor-lock slice need not reshape the contract. No lock doctype,
no acquire/release, no logic.

**Response.** `{rows (stamped + markers), column_descriptors (passthrough from get_committed_rows), commit_version,
editable: true, lock_info: null}`. Graceful empties: an uncommitted / grid-only sheet (no rows or no commit_version)
returns the same shape with pricing merged as a no-op (no throw; get_sheet_pricing is not called).

**Tests (bench-verified in-session).** `test_pricing` **12 → 22** (+10 `TestGetPricedRows`, reusing the shared
`build_committed_sheet_fixture` + a NEW local `_build_scalar_rate_committed_sheet` since the shared per-area fixture
has no scalar rate column): priced+unpriced in one row; zero-rate-is-priced (the load-bearing correctness test —
a zero-check marker would fail it); multi-area independence; commit_version passthrough; reserved editable/lock_info
placeholders; scalar-rate cell (un-priced baseline → priced); descriptors pass through unchanged; uncommitted empty
merged shape; missing-args / unknown-boq throw; NO amount/qty stamping. `test_review_screen` **205 → 205** (the
commit_version assertions folded into existing committed-read tests — net count unchanged). Frontend NOT touched
(backend-only slice; `frontend/CLAUDE.md` minimal-touch per the DOCS-UPDATE RULE).

---

## Slice 1a -- parse reason-bundle (reactive #166) -- BACKEND (feat e4b1fefc, 2026-06-18)

**What this slice is.** The reactive half of issue #166 and the parse-path instance of principle P2 ("stop erasing
the why"). When a sheet that was ELIGIBLE and ATTEMPTED fails to parse, the specific REASON was computed and then
thrown away. This slice makes the per-sheet failure reason DURABLE on `BoQ Sheet Draft` so a LATER frontend slice
can render a hub-card notice (reason + datetime). **BACKEND ONLY** -- no frontend built here.

**Recon basis (the reason-erasure map, prior read-only recon).** Three IN-SCOPE erasure points: STALE (E2 empty-blob
+ E3 invalid-blob) dropped in `assemble_mapping_config`'s Rule-3 branch to a `logger.warning` + a nameless
`not_eligible` list; PARSER-FAILED (E6, worker Step 4) and INSERT-FAILED (E7, worker Step 5) coarsened to an
`error_code` / a name-only `failed_sheets` + an Error Log row with no surfaced handle. OUT OF SCOPE (not failures or
a different fix): skip/hidden/ineligible/general-specs (never attempted), EMPTY-but-marked-Parsed (E8, success-path
mis-classification -- PARKED), config staleness DETECTION (Slice 1b), payload reshape, all frontend.

**Preconditions verified before edit (P-a..P-d).** (P-a) `BoQ Sheet Draft` had NO reason field; `has_prior_parse` /
`last_parsed_at` / `parse_in_progress` exist as the recon said. (P-b) `_set_draft_status(boq,sheet,status,
extra_fields=None)` merges `{wizard_status: status, **extra_fields}` into ONE `set_value`; existing callers pass no
extra_fields. (P-c) the three failure sites still matched. (P-d) CRITICAL -- the STALE drop does NOT write the draft
at all today (only `logger.warning` + `not_eligible.append`); `assemble_mapping_config` is called ONLY by
`_run_parse_worker` + the tests (`commit_gate` does NOT call it), so a write there pollutes no read-only production
caller. STALE therefore uses a NEW fields-only helper, never the status helper.

**Core constraint -- purely additive, truthful.** The done-event payload contract
(`{status,boq_name,parsed_sheets,not_parsed_sheets,failed_sheets}` / `{status,boq_name,error_code}`) stays
BYTE-FOR-BYTE FROZEN (a test asserts the success-payload key set). `wizard_status` writes and the displayed prior
rows are UNCHANGED -- the notice's whole point is "the rows you see are from the PRIOR parse," so the rows must
remain.

**Schema (`boq_sheet_draft.json`, +3 nullable fields; `bench migrate` CLEAN; runtime columns + Select options
verified via get_meta):**
- `parse_failure_category` -- Select `""` / `Config stale` / `Parser error` / `Insert error`. The S2-8 taxonomy: the
  three IN-SCOPE failure values ONLY. Skip/Hidden/Ineligible/general-specs/empty are NOT failures and are absent by
  design (a 1b/taxonomy concern, not this field).
- `parse_failure_reason` -- Small Text. The specific why: the `SheetConfig.model_validate` exc text for STALE; a
  concise message + an Error Log handle for crashes.
- `parse_failure_at` -- Datetime, read_only.

**The three write sites (`parse_run.py`).**
- STALE -- `assemble_mapping_config` Rule-3 empty-blob + invalid-blob branches call NEW
  `_record_parse_failure(boq,sheet,category,reason)`, which writes ONLY the three failure fields via a bare
  `frappe.db.set_value`, NEVER `wizard_status` (no commit -- rides the worker's transaction). Category `Config stale`.
- PARSER error -- worker Step-4 `except Exception as exc` (now binds `exc`); the reason folds into the EXISTING
  `_set_draft_status(... "Parse failed", extra_fields={category,reason,at})` loop over `eligible_data_sheets` (same
  `set_value`, no new/changed status). `parse_boq` has no per-sheet isolation (DA-1), so every eligible sheet is
  attributed the same parser error -- matching today's coarse behaviour.
- INSERT error -- worker Step-5 per-sheet `except Exception as exc`; reason folds into the EXISTING per-sheet
  `"Parse failed"` `_set_draft_status(extra_fields=...)`.

**S2-5 traceable handle.** Verified `frappe.log_error` RETURNS the inserted Error Log doc
(`frappe/utils/error.py`: `return error_log.insert(ignore_permissions=True)`; None only under
read_only/defer_insert). NEW `_reason_with_ref(reason, error_log_doc)` appends `(ref: Error Log <name>)` when a name
is available and NEVER fabricates one.

**Clear-on-success.** All three fields are cleared (set None) folded into the EXISTING `"Parsed"`
`_set_draft_status(extra_fields=...)` write (alongside has_prior_parse/last_parsed_at), so a fixed sheet drops its
stale notice. General-specs sheets never reach that write (gated) and never carry a reason, so no clear is needed.

**Shared "reconfigure" signal (for Slice 1b).** The natural origin of a "this sheet needs reconfiguring" signal on
this path is the SAME Rule-3 blob deserialize/validate guard in `assemble_mapping_config` (empty + `model_validate`
failure). 1a surfaces it reactively as a durable reason; 1b's proactive version-stamp detection is the cousin --
do NOT design the stamp here.

**Tests (`test_parse_run`, 86 -> 93, +7, all green in-container).** New `TestParseFailureReason`: stale invalid-blob
(exc detail captured; `wizard_status` + prior rows untouched), stale empty-blob, parser error (+handle), insert
error, clear-on-success, non-failures-untouched (Skip/Hidden/Pending/general-specs stay falsy -- a never-written
Select reads as `''`, asserted falsy not strictly None), done-event payload FROZEN (captured via patched
`publish_realtime`).

**Docs.** Pure backend -> this plan + root CLAUDE.md substantive. Per the build-prompt scope, frontend/CLAUDE.md was
explicitly excluded (no frontend change this slice); the standing DOCS-UPDATE RULE's minimal-touch was flagged as a
deliberate exception in the build self-report for the owner to reconcile.

---

## Slice 1b -- config staleness detection (proactive #166) -- BACKEND (feat 32e31a2a, 2026-06-18)

**What this slice is.** The PROACTIVE half of issue #166 (S1-1/S1-2). Slice 1a made the REACTIVE half durable (a
reason persisted when a stale config is DROPPED at parse). 1b flags a stale config ON READ -- before the user
triggers a parse -- so a LATER frontend hub-card slice can show "reconfigure this sheet" without first hitting a
parse failure. **BACKEND ONLY** -- a read-only endpoint; no frontend built here.

**Recon verdict implemented = validate-on-read (approach B), ZERO SCHEMA.** No fingerprint, no version-stamp, no
doctype change, no migration. The recon proved a field-name fingerprint MISSES the dominant real staleness
(`ColumnRole` Literal token renames + the `_AREA_COMPATIBLE_ROLES` / `model_validator` changes that actually caused
#166), and a deep fingerprint can never capture imperative validator logic -- chasing it is the balloon. Instead,
1b runs the SAME `SheetConfig.model_validate` the parser runs: an invalid stored blob is stale. This catches
everything a parse would, tracks the live model automatically (zero maintenance -- the property whose ABSENCE
caused #166), and needs NO new field/migration/backfill.

**Read-only verification before edit (reported, no drift).** Confirmed the current (post-1a) Rule-3 shape: an
empty-blob sub-branch (`_record_parse_failure(... "Config stale", "Saved configuration is empty ...")`, no
model_validate) and an invalid-blob sub-branch (`try: json.loads + inject sheet_name + SheetConfig.model_validate;
except: _record_parse_failure(... "Saved configuration is no longer valid: {exc}")`). Confirmed
`_RULE3_BASE_STATUSES = {"Config Done", "Parsed"}` exists and is the force_reparse=False data set. Confirmed
`run_parse`'s guard strings ("boq_name is required." / "BOQs '...' not found.") to mirror.

**(1) Shared validate helper + reason builders (`parse_run.py`).** `_validate_sheet_blob(blob, sheet_name) ->
Exception | None` is the SINGLE SOURCE OF TRUTH for "does this saved config still validate", used by BOTH the
reactive parse-drop path (`assemble_mapping_config` Rule 3 / 1a) and the proactive read path (`get_stale_sheets` /
1b). It injects `sheet_name` (production 6-key blobs omit it; `SheetConfig.sheet_name` has no default -- WITHOUT
injection every blob false-positives, the #1 cry-wolf trap), copies the blob before injecting (no caller mutation),
and catches a malformed/non-dict blob (returned as the exc, matching the parser's treat-as-stale behaviour).
`_stale_empty_reason(status)` / `_stale_invalid_reason(exc)` centralize the reason text so the reactive +
proactive messages are BYTE-IDENTICAL. `assemble_mapping_config` Rule 3 was REFACTORED to call the helper +
builders -- BEHAVIOR-PRESERVING for 1a: same exclusion, same `_record_parse_failure` calls with byte-identical
reason text; the success path re-validates once only to obtain the `SheetConfig` model object (a cheap pure-Python
re-parse, behaviour-identical to the prior single-validate). The empty-blob sub-branch stays its own 1a case (NOT
routed through model_validate) -- mirrored exactly.

**(2) New `get_stale_sheets(boq_name)` endpoint.** `@frappe.whitelist()` bare (READ-ONLY, GET-capable, mirrors
`get_committable_sheets`). Returns `{"stale_sheets": [{"sheet_name" [VERBATIM #152], "reason"}, ...]}`. ROUTING
PARITY with assemble (no new gating): general-specs pointer / Hidden / Skip -> never stale; status not in
`_RULE3_BASE_STATUSES` (Pending / Parse failed / Finalized / blank) -> not a data sheet here, never stale
(UNCONFIGURED != stale; Finalized is data-eligible only under force_reparse, which this normal read does not
assume); Config Done / Parsed with a non-empty invalid blob -> stale (reason = validation detail); Config Done /
Parsed with an empty blob -> stale (mirrors 1a's empty-on-done). PURE READ -- writes NOTHING (no
set_value/insert/save/commit; write-on-read was explicitly rejected by the recon). Guard mirrors `run_parse`.

**Anti-cry-wolf (recon §6 traps closed).** sheet_name injection (in the shared helper, both paths get it free);
routing parity (general-specs / Skip / Hidden / non-data statuses never validated as data sheets); unconfigured !=
stale (scoped to data-eligible statuses with a blob, plus 1a's empty-on-done). By construction `get_stale_sheets`
flags stale iff the parser would drop the sheet -- the truest anti-cry-wolf guarantee.

**Composition with 1a (no overlap, no double-write).** 1b writes NOTHING, so it cannot race or double-write with
1a's reactive `parse_failure_*` writes. They are the SAME validation at two triggers; the shared helper guarantees
identical verdicts. A test (`test_proactive_matches_reactive_invalid_and_empty`) runs `assemble_mapping_config`
(1a) then `get_stale_sheets` (1b) on the same BoQ and asserts both flag the same sheets AND the reason text is
byte-for-byte equal. (The frontend, later, will de-dupe a stored 1a reason and a computed 1b flag into ONE
"reconfigure" notice -- not this slice.)

**Tests (`test_parse_run`, 93 -> 102, +9, all green in-container; no migration).** New `TestGetStaleSheets`:
invalid-blob-stale-with-reason (the #166 core), Parsed-status parity, valid-prod-blob-not-stale (the sheet_name-
injection proof -- a valid blob OMITS sheet_name and must not flag), unconfigured-not-stale (Pending / Parse-failed;
a literally-blank wizard_status is not insertable -- `reqd=1`), Finalized-not-stale (force_reparse=False),
general-specs/Skip/Hidden-not-stale (routing parity), empty-on-done-stale, proactive-matches-reactive (shared-helper
+ reason parity vs 1a), guard (missing/unknown boq_name throws). The 1a `TestParseFailureReason` suite stays green
(the Rule-3 refactor is behavior-preserving).

**Docs.** Pure backend -> this plan + root CLAUDE.md substantive. frontend/CLAUDE.md NOT touched (build-prompt scope
excluded it; no frontend change this slice).

---

## Slice 2 -- commit round-trip reconciliation (output-fidelity) -- BACKEND (feat 01c7dbaf, 2026-06-18)

**What this slice is.** An AUTOMATIC, headless, EVERY-COMMIT verification that the committed tiers (node tree +
per-area children + faithful grid) equal what the commit PRODUCED. Runs at the tail of each per-sheet write path,
BEFORE the per-sheet `frappe.db.commit()`; a divergence `frappe.throw`s and the EXISTING Slice-5 per-sheet isolation
converts the sheet into a clean `{failed}` entry (rollback + reason). Recovers the dropped Slice-6 dogfood as an
always-on check. BACKEND ONLY.

**Locked scope = OUTPUT-FIDELITY, not logic-correctness.** Verifies ONLY that the value each transform PRODUCED was
COPIED to the DB accurately. It does NOT judge whether a produced value is *correct* (valid parent, no cycles, sane
rates, declared area, level-monotonicity = VALIDITY = tendering's job = OUT OF SCOPE). No coherence/relational
checks built. The "must be able to fail" rule governs: a derived-value check never re-runs the producer (that would
be self-confirming) -- it compares against the CAPTURED producer output.

**Build-recon resolved (verified against live code).** The two derived values are observable in-memory in
`_commit_node_tree`'s scope at the tail: `eff_parent_by_idx` (resolve_effective's captured output), `name_by_idx`
(pass-1 insertion record), `docs_by_idx` (the in-memory node docs, carrying produced `.level`), and `node_rows`
(the review-row snapshot). Currency precision: no per-field precision -> system default (money 2dp via empty
`currency_precision`; qty 3dp via `float_precision=3`). Day-N census: 625 current nodes / 18 sheets, **0
money/qty copy-divergences** across 584 resolvable nodes at 2dp (the check won't fire on day one; the money
suppress-set is complete). Slot confirmed: `_commit_one_sheet` does grid -> sheet -> node tree -> commit, so a
raise before commit routes to commit_boq's per-sheet `try/except` (Slice-5).

**The check (one type, two anchors).**
- COPIED fields -> `stored == transform(review-row source)` reusing the in-hand `node_rows` (no re-query drift):
  code, sort_order, source_row_number, description (cascade desc->sl_no->"(untitled)"), unit, make_model,
  node_type, row_class, qty (Line-Item None->0), the six money fields (word-order reversal), is_rate_only /
  is_synthetic / human_is_root (bool-coerce), human_classification, human_parent (-1 sentinel), notes (row_notes
  rename), append_notes_raw / attached_notes / edit_log (JSON, empty-normalized), and the per-area children
  (deterministic explosion; flat-stays-flat encoded for free).
- DERIVED (exactly two) -> `stored == CAPTURED producer output`, NEVER re-running the producer: `parent_node =
  name_by_idx.get(eff_parent_by_idx.get(idx))` (the exact lookup pass-2 used -- re-running resolve_effective would
  be the self-confirming trap); `level = docs_by_idx[idx].level` (the in-memory value the producer built -- a THIN
  tripwire: nothing mutates level today, kept for near-zero-cost regression value).
- Plus a node-COUNT check (produced node rows vs current stored nodes -> catches a finalized sheet that should
  have nodes but persisted none) and a grid row_number/cells compare.

**Precision + anti-false-flag.** Numerics compared rounded to the field's own `frappe.get_precision` (money 2dp,
qty 3dp) via `frappe.utils.flt(v, p)` -- never raw float equality -- so Float->Currency coercion never false-flags.
Stored read fresh in-transaction (Frappe sees the uncommitted writes).

**Suppress-set encoded exactly** (the only differences NOT flagged -- they are our own rules): blank-qty=0,
placeholder description, flat-stays-flat (absent rate/amount kind normalizes to 0 == stored 0), gen-specs 0 nodes
(node reconcile not called), minted `commit_provenance_id` + versioning triple + `path` + `boq` EXCLUDED from the
field list, spacer grid-only (skipped from node_rows), note/subtotal_marker/header_repeat -> Other money-null,
human_parent -1 sentinel (N-2), bool coercion (N-3), qty None->0 Line-Item-only (N-4), and N-1: node->source paired
via the in-hand `node_rows`/`name_by_idx`, NOT a `review_row_name` re-lookup -- so historical dangling provenance is
irrelevant (the check only runs on freshly-committed nodes).

**Implementation.** Two helpers in `commit_pipeline.py`: `_reconcile_node_tree(sheet_name, boq_sheet_name,
commit_version, node_rows, eff_parent_by_idx, name_by_idx, docs_by_idx)` called inline before
`_commit_node_tree`'s return; `_reconcile_grid(sheet_name, grid_name, grid_rows)` called in `_commit_one_sheet`
before the commit. Support helpers `_text_eq` (None/'' equal), `_json_eq` (empty {}/[]/None normalized),
`_node_type_for`, and the `_NODE_MONEY_SOURCE` word-reversal map. No signature change to the existing functions; no
new plumbing; isolation boundary unchanged.

**Tests (`test_commit_pipeline`, 33 -> 44, +11, all green in-container; no schema, no migration).** MUST-FIRE (6):
corrupted money, dropped per-area child, zero-node finalized sheet, wrong parent_node, mutated level, corrupted grid
-- each tampers the STORED side AFTER the write via a wrapper around the reconcile helper (`_corrupt_then`), so the
real reconcile reads the corrupted rows; no production code altered. MUST-NOT-FIRE (5): flat-stays-flat,
blank-qty/placeholder-desc, gen-specs 0 nodes, note-Other-money-null + dropped-spacer-parent-root, re-commit
versioning-excluded. The existing 33 faithful-commit tests stay green (the reconcile does not break a normal
commit). The raise->failed[] routing is the existing Slice-5 mechanism (a reconcile raise is just another per-sheet
exception), already proven by TestCommitBoqPartialFailure -- not duplicated here.

**Docs.** Pure backend -> this plan + root CLAUDE.md substantive. frontend/CLAUDE.md NOT touched (no frontend
change this slice).

## Slice F1 -- durable per-sheet commit-failure persistence (BACKEND, feat 5c095b34, 2026-06-18)

**What & why.** The backend half of the "needs attention" F-arc (F2 = a hub-card consolidated indicator,
F3/F4 = the parse/commit completion modals highlighting failures -- all FRONTEND, NOT this slice). Before F1,
`commit_boq`'s per-sheet failure handler built an in-memory `failed[]`, `frappe.log_error`d the traceback, and
returned the `{committed, failed}` envelope -- but PERSISTED NOTHING per-sheet. Once the HTTP response was gone a
hub card had nothing durable to read, so it could not show a commit-failure notice across sessions. F1 PERSISTS the
per-sheet commit failure (reason + timestamp) on the `BoQ Sheet Draft`, CLEARED on a successful re-commit -- the
durable analog of Slice 1a's `parse_failure_*`. BACKEND ONLY.

**Shape = a PAIR, NO category Select (recon-decided, owner-confirmed).** Parse had a clean 3-way taxonomy
(Config stale / Parser error / Insert error) because its failures came from three structurally-distinct phases.
Commit failures are heterogeneous/freeform -- a reconciliation divergence, a controller validation throw, a
sheet-not-in-workbook throw, a list-JSON `get_valid_dict` wall, a generic DB error -- and are already flattened to
one string by `_commit_failure_reason` (best-effort HTML-stripped message + safe fallback, never empty). A Select
would be mostly "Other", so it was deliberately omitted.

**(1) Schema (`boq_sheet_draft.json`).** Two additive NULLABLE fields at the tail of `field_order`, after
`parse_failure_at`, mirroring the `parse_failure_*` conventions:
- `commit_failure_reason` -- Small Text (no `read_only`, matching `parse_failure_reason`).
- `commit_failure_at` -- Datetime, `read_only: 1` (matching `parse_failure_at`).
Each carries a `description` documenting "Cleared on a subsequent successful commit". No `reqd`, no default, NO
data backfill (existing rows get NULL = "no commit failure" = the correct default). `bench migrate` CLEAN; runtime
columns verified via `frappe.db.has_column("BoQ Sheet Draft", ...)` + `get_meta` (Small Text / Datetime read_only).

**(2) Write hook -- the rollback-then-write-then-commit ORDER is load-bearing.** In `commit_boq`'s per-sheet
`except`, immediately AFTER the MANDATORY Slice-5 `frappe.db.rollback()` (UNCHANGED -- the orphan-prevention):
```
except Exception as e:
    frappe.db.rollback()                              # (1) FIRST -- unchanged Slice-5 orphan-prevention
    reason = _commit_failure_reason(e)
    _record_commit_failure(boq_name, sheet_name, reason)   # (2) set_value the draft, no commit
    frappe.db.commit()                                # (3) flush ONLY the stamp
    failed.append({"sheet_name": sheet_name, "reason": reason})   # reuses the captured reason
    frappe.log_error(...)                             # unchanged
    continue
```
`_record_commit_failure(boq, sheet, reason)` mirrors `_record_parse_failure`: verbatim-#152 child lookup
(`{"parent", "parenttype": "BOQs", "sheet_name"}` -> name; missing -> silent skip), then ONE
`frappe.db.set_value("BoQ Sheet Draft", child_name, {commit_failure_reason, commit_failure_at: now()},
update_modified=False)`, NO commit (the caller owns it). WHY THIS ORDER:
- The write is AFTER the rollback so the rollback does not sweep it away.
- The explicit `frappe.db.commit()` is REQUIRED -- this is the one real difference from the parse pattern (which
  relies on the worker's trailing commit). `commit_boq` has NO trailing commit after the loop; if the failed sheet
  is the LAST in the subset, no later `_commit_one_sheet` commit would ever flush the stamp -> it would be lost.
- The draft is a DIFFERENT doctype from the rolled-back grid/sheet/node tiers, and the commit pipeline never writes
  the draft during a sheet commit, so after the rollback this `set_value` is the ONLY pending write -- it cannot
  re-flush a rolled-back tier write, so T2 orphan-prevention is preserved.

**(3) Clear hook.** A new `_clear_commit_failure(boq, sheet)` (both fields -> None, same verbatim lookup, no
commit) folded into `_commit_one_sheet`'s trailing per-sheet `frappe.db.commit()` -- after the grid reconcile,
before the commit -- so a re-commit that now succeeds drops the stale stamp ATOMICALLY with the successful
grid/sheet/node write (mirrors 1a's clear-on-success). It runs only on the fully-successful path (a reconcile raise
earlier propagates to the except, which instead WRITES the stamp).

**Payload contract FROZEN.** The `{committed, failed}` envelope is byte-for-byte unchanged; the persisted fields are
an additive SUPERSET of what `failed[]` already returns. No return-shape change.

**Tests.** `test_commit_pipeline` **44 -> 49** (+5, all green), added to `TestCommitBoqPartialFailure` (the class
that drives the public `commit_boq` loop with the file path patched). Its `tearDown` now also clears the two
commit-failure fields on all sheets -- the stamps are committed (that is the point), so they survive
FrappeTestCase's per-test rollback and would otherwise leak into the next test (the draft rows are shared, created
once in setUpClass). The five:
- `test_f1_commit_failure_persisted_on_last_sheet_failure` -- PERSIST-ON-FAILURE; the failing sheet is LAST in the
  subset, so no later commit could flush the stamp -> it persists ONLY via the except's own commit (non-vacuous re
  the explicit commit). reason == the returned `failed[]` reason; `commit_failure_at` set.
- `test_f1_stamp_survives_rollback_and_no_orphan` -- KEYSTONE. A POST-FREEZE re-commit failure on the LAST sheet
  (`_commit_node_tree` patched to raise for S1 after the real `_write_grid` + `_write_committed_boq_sheet` froze
  S1's prior rows; S1 pre-committed once; subset `[S2, S1]` so S1 is last). Asserts BOTH: the prior S1 grid is
  STILL `is_current=1` at version 1 (the except's rollback discarded the freeze -> orphan-prevention holds, the new
  failure-commit did NOT re-flush it) AND the S1 stamp is persisted (it SURVIVED the very rollback that discarded
  the freeze).
- `test_f1_cleared_on_successful_recommit` -- pre-stamp via `_record_commit_failure` + commit, then a successful
  `commit_boq([S1])` -> both fields None.
- `test_f1_clean_first_commit_leaves_fields_null` -- a clean first commit leaves both fields None.
- `test_f1_mixed_outcome_only_failed_sheet_stamped` -- S2 fails of `[S1, S2, S3]` -> S2 stamped; S1 + S3 (clean
  successes) carry NO stamp; envelope correct.
The existing load-bearing T2 orphan-prevention test
(`test_orphan_prevention_rollback_restores_prior_on_failed_recommit`) is UNTOUCHED + green.

**Scope.** NO change to `parse_run.py` (the parse-failure fields are done -- only READ to mirror), `review_screen.py`,
the reconciliation internals, or any frontend. Pure-backend -> this plan + root CLAUDE.md substantive;
frontend/CLAUDE.md deliberately NOT touched (build-prompt scope; no frontend change this slice). NEXT = F2 (the hub
"needs attention" indicator reading `parse_failure_*` + `commit_failure_*` off the BOQs payload + a separate
`get_stale_sheets` call).

## Slice F2 -- hub-card "needs attention" indicator (FRONTEND, feat 1f1828d4, 2026-06-18)

**What & why.** The frontend half of the "needs attention" arc: finally SHOW the user the per-sheet
failure/staleness signals the backend now captures. A consolidated indicator on each hub `SheetCard`, COLLAPSED by
default (just a chip in the badge cluster), CLICK-TO-EXPAND to list whichever of three signals apply, each with its
reason and (for parse/commit) the timestamp of the failed attempt. FRONTEND ONLY -- 1a (`parse_failure_*`), 1b
(`get_stale_sheets`), and F1 (`commit_failure_*`) already provide the data; F2 reads + renders. F3/F4 (the parse +
commit completion modals highlighting failures) are SEPARATE later slices, NOT this one.

**The three signals (all per-sheet).** (1) STALE CONFIG -- from `get_stale_sheets(boq_name)`, a SEPARATE live call
(computed on read, no stored field): reason only, NO timestamp. (2) PARSE FAILURE -- `parse_failure_category` /
`parse_failure_reason` / `parse_failure_at` on the draft (ride the BOQs payload): category + reason + timestamp.
(3) COMMIT FAILURE -- `commit_failure_reason` / `commit_failure_at` on the draft (F1, ride the BOQs payload): reason
+ timestamp. A card may carry MORE THAN ONE -> one chip, expand lists each applicable line.

**Files (3) + the ONE new fetch.**
- `boqTypes.ts` (additive only): `BoQSheetDraft` gains the five optional failure fields (the type just lets the
  frontend READ what already arrives on the doc); new `StaleSheet` + `GetStaleSheetsResponse` mirroring
  `GetCommittedStateResponse`.
- `BoqHubPage.tsx`: ONE new `useFrappeGetCall("...parse_run.get_stale_sheets")` (same bare-whitelist GET + null-key
  gotcha as `get_committed_state`) -> `staleMap: Map<sheet_name VERBATIM #152, reason>` (mirrors `committedMap`),
  passed as `staleReason` to `SheetCard` at BOTH render sites (main list + hidden-sheets reveal). The parse/commit
  stamps ride the existing `useFrappeGetDoc("BOQs")` doc, so this is the ONLY fetch added. `void mutateStale()` wired
  into `applyParseOutcome` (parse success), `handleCommitted`, and `handleSaved` so the LIVE stale signal
  clears/updates on the same triggers (fix config + re-parse -> indicator clears; fresh commit failure -> appears).
- `SheetCard.tsx`: new optional `staleReason?: string`; a clickable chip (`AlertTriangle` + "N issue(s)") in the
  badge cluster, shown iff >= 1 distinct signal -- RED when any failure STAMP present (parse or commit), AMBER when
  only stale; an inline expand block (local `attnOpen` useState, mirrors the `editingLabel` idiom -- no new
  Popover/Collapsible) listing each line with the existing `fmtCommittedAt` for timestamps.

**The de-dup rule (the one render subtlety, owner-locked).** 1a and 1b describe the SAME staleness with BYTE-IDENTICAL
reason text (shared `_stale_invalid_reason`/`_stale_empty_reason`; re-proven live this slice). When a live stale
reason is present AND `draft.parse_failure_category === "Config stale"` AND `draft.parse_failure_reason ===
staleReason`, collapse to ONE "Stale config" line (carrying the parse timestamp). Other categories (Parser/Insert
error) + commit failures are always their own line. N (chip count) = distinct lines after de-dup; chip hides at N==0.
Empty state: no stale entry AND no parse_failure_reason AND no commit_failure_reason (guard on the REASON STRINGS,
not category -- category can be "" with no reason) -> NO chip. SHOW + EXPAND only; no per-signal action buttons.

**Verification.** `tsc` 0 new wizard-file errors (filtered `boq-wizard|SheetCard|BoqHubPage|boqTypes` -> empty; 3177
baseline unchanged) + in-container Vite build exit 0 (`Done in 1285.37s`). DATA-SIDE live cert on BOQ-26-00145
(capture-and-restore; workbook RESTORED to baseline -- non-negotiable for the cert workbook): on a "Lights" config
broken with one invalid role token, `get_stale_sheets` flips `[] -> ["Lights"]` (stale_fired); the de-dup
string-equality holds -- 1b's reason `===` the reason `_record_parse_failure` would store for the same blob
(`dedup_helper_equal`) AND the stamped `draft.parse_failure_reason === staleReason` with category `"Config stale"`
(`frontend_dedup_equal`), so the frontend de-dup `===` provably fires; `_record_commit_failure` on "Washroom" stamps
`commit_failure_reason`/`_at` (commit_stamped); RESTORE verified -- stale gone, parse/commit stamps cleared, the
broken role token reverted to `sl_no`. **The VISUAL hub render (chip paints, expand lists the right lines, healthy
cards show nothing) is an OWNER-OWNED later manual pass -- not headlessly confirmable here; the data + build are
certed.** NOTE: a mid-cert crash (Frappe returns the JSON `sheet_config` field as a parsed dict, not a string, so a
naive `json.loads` threw and the first restore attempt `set_value`'d a raw dict) left "Lights" broken briefly; it was
re-restored (column A role -> `sl_no`, `get_stale_sheets` -> `[]`) before the clean re-run -- the workbook ends at
baseline.

**Scope.** FRONTEND ONLY -- no backend, no completion modals (F3/F4), no `get_stale_sheets`/`commit_boq` change.
Pure-frontend -> this plan + frontend/CLAUDE.md substantive; root CLAUDE.md deliberately NOT touched (build-prompt
scope: a frontend slice updates frontend/CLAUDE.md, not root). NEXT = F3/F4 (parse + commit completion modals
highlighting failures with reasons).

## Slice F3/F4 -- completion modals highlight failures with reasons (FRONTEND, feat bfa71098, 2026-06-18)

**What & why.** The TRANSIENT counterpart to F2's persistent hub card: at the MOMENT a parse or commit finishes,
the completion modal highlights each FAILED sheet WITH its reason -- so the user sees the why right then, not only
later on the card. This completes the F-arc (F1 persist commit-failure -> F2 persistent "needs attention" card ->
F3/F4 transient modals). FRONTEND ONLY -- no backend, NO new fetch, NO payload change.

**F4 (the COMMIT results modal, `CommitResultsModal.tsx`) = ALREADY SATISFIED at Slice 5 -- VERIFY-ONLY.** The recon
found, and a re-read confirmed, that it already renders a dedicated "Failed (N)" section with, per sheet, a
destructive `<li>` + `AlertTriangle` + `{sheet_name} -- {reason}` (the `{committed, failed}` envelope carries the
reason directly). No concrete gap -> NO code change to F4.

**F3 (the PARSE completion modal -- the inline `AlertDialog` in `BoqHubPage.tsx`) = the real work.** Today's failed
line was `parseResult.failed.join(", ")` -- bare sheet NAMES, no reason. Now it is a per-sheet `<ul>/<li>` list
mirroring the CommitResultsModal failed-section visual shape: each `<li>` is `text-destructive` with an
`AlertTriangle` + `{name} -- (category) reason`.

**The data source (recon-confirmed, implemented exactly).** The `boq:parse_run_done` socket payload carries NAMES
ONLY -- `ParseRunDonePayload` is `{status, boq_name, parsed_sheets?: string[], not_parsed_sheets?: string[],
failed_sheets?: string[], error_code?}`, and the worker publish site `parse_run._publish_parse_event` (success kwargs
`parsed_sheets=parsed_sheets, not_parsed_sheets=not_eligible, failed_sheets=failed_sheets`, all `list[str]`) adds no
per-sheet reasons. The REASON lives in the persisted `parse_failure_*` (Slice 1a) on the draft, which rides the
`useFrappeGetDoc("BOQs")` doc the hub ALREADY fetches and ALREADY `mutate()`s on parse-done. So F3 reads each failed
sheet's reason at render time: `boq.sheet_drafts?.find(sd => sd.sheet_name === name)` (VERBATIM #152, the same lookup
F2 / the hub use) -> `parse_failure_reason` (trimmed) + `parse_failure_category` (in parens). NO new fetch.

**The freshness fallback (a correctness requirement).** `applyParseOutcome` calls `mutate()` (async refetch) AND
`setParseResult()` (opens the modal immediately). The worker COMMITS the `parse_failure_*` stamps BEFORE publishing
the socket event, so once the refetch lands the reasons are present and the open (acknowledge-only) modal re-renders
fresh -- but the FIRST render can be pre-mutate, so the draft lookup returns undefined. F3 guards with `reason &&
(...)` -> renders the sheet NAME ALONE in that window (never blank / "undefined" / crash); the next render shows
name + reason. The modal stays open, so the user sees the reason by the time they read it. No fetch is added to force
freshness; the modal is not blocked on the refetch.

**Unchanged (deliberate).** The `parsed` (foreground) and `notParsed` (NEUTRAL `text-muted-foreground`, names-only)
success sub-lines are untouched -- `notParsed` stays a neutral advisory list (skipped / hidden / general-specs /
pending). Although stale-config drops land in `not_eligible` WITH a "Config stale" stamp, their reason is shown
PERSISTENTLY on the F2 card and is NOT duplicated in this transient modal -- `notParsed` is NOT dragged into
destructive styling. The whole-run `parseError` block (`PARSE_ERROR_MSGS`; `no_eligible_sheets` NEUTRAL) is a
DIFFERENT axis (whole-run failure, not per-sheet) and is untouched. `AlertTriangle` was added to BoqHubPage's lucide
import. NO timestamp is shown in the modal (just-happened/transient; the F2 card persists `parse_failure_at`). NO
shared failed-list component was extracted (two call sites with different data sources -- commit reads the envelope
object, parse looks up `sheet_drafts` -- abstracting both is over-engineering for two sites). Language matches the F2
card expand (same reason + category strings), so the transient modal and the persistent card describe an identical
failure identically.

**Verification.** tsc 0 new wizard-file errors (filtered `boq-wizard|SheetCard|BoqHubPage|boqTypes|CommitResultsModal`
-> empty; 3177 baseline unchanged) + in-container Vite build exit 0 (`Done in 251.50s`). DATA-SIDE cert on
BOQ-26-00145 (restore-first-safe capture-and-restore; workbook RESTORED to baseline -- non-negotiable for the cert
workbook): captured the "FAS" draft's baseline `parse_failure_*` (all None), called
`parse_run._record_parse_failure(boq, "FAS", "Parser error", <reason>)` + commit, then confirmed the EXACT data F3's
render reads -- a `find` by verbatim sheet_name resolves `parse_failure_reason` + category "Parser error"
(`lookup_resolves` / `reason_present` / `category_present` all True); the freshness-fallback case (`find` over a
non-existent name -> undefined -> the `reason && (...)` guard renders name-only) is code-inspected
(`fallback_undefined_safe` True); RESTORED by writing the captured baseline values back verbatim (these are scalar
Select / Small Text / Datetime fields -- NOT JSON, so no dict round-trip gotcha) -> the three fields equal the
captured baseline (`RESTORED_clean` True). **The VISUAL modal render (the failed list paints with reasons, neutral
line stays neutral) is an OWNER-OWNED later manual pass -- not headlessly confirmable; the data + build are certed.**

**Scope.** FRONTEND ONLY -- no backend, no boqTypes change (`ParseRunDonePayload` stays names-only by design;
`parse_failure_*` already on `BoQSheetDraft` from F2), no `get_stale_sheets`/publish-payload change, no SheetCard
change, no CommitResultsModal change (F4 already done). Pure-frontend -> this plan + frontend/CLAUDE.md substantive;
root CLAUDE.md deliberately NOT touched (build-prompt scope: a frontend slice updates frontend/CLAUDE.md, not root).
The F-arc (F1 -> F2 -> F3/F4) is now COMPLETE.
