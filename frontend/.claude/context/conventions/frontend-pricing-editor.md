<!-- Carved from frontend/CLAUDE.md on 2026-07-30 (structural carve).
     frontend/CLAUDE.md is a router; this file holds the detail it points to.
     Load when: Touching PricingGrid.tsx or SheetPricingPage.tsx -- the load-bearing invariants: keyboard nav, memoisation, rate-edit gating, verdict states, the formula engine, carry/copy-forward -->

### Pricing editor (`PricingGrid.tsx` / `SheetPricingPage.tsx`) -- LOAD-BEARING invariants

- **Description is a FAN-OUT inside the frozen anchor pane (MC-5), not the single `a4` anchor.** When any row
  carries `description_parts_raw` (`sheetHasDescriptionParts`), the Description anchor becomes one column per
  mapped description column (Option-1 freeze: ALL inside the frozen pane; Category stays the first scrolling
  column). **The whole colIndex algebra is parametric over a per-render `anchorWidthKeys` list -- the SINGLE
  SOURCE OF TRUTH:** `effectiveAnchorCount = anchorWidthKeys.length`, `descriptorColStart = length + 1`. The
  module consts `FIXED_ANCHOR_COUNT`/`DESCRIPTOR_COL_START` are retained ONLY as the legacy source + test
  exports -- never read them for live geometry; use the per-render values (passed to the row as props). Fan-out
  columns are width-keyed by Excel LETTER (`desc:<col>`, via `descriptionWidthKey`), seeded first 280 / extras
  160 (`descriptionWidthSeeds`), and are READ-ONLY nav cells at colIndex `4..4+N-1` (`< descriptorColStart` ->
  excluded from the rate path). Only the FIRST gets the depth indent + chevron + `(no description)` fallback via
  the shared `DescriptionAnchorInner`. **LEGACY FALLBACK (permanent -- pre-MC-2 committed BoQs hit this screen
  forever):** no parts -> `anchorWidthKeys = [a0..a4]` -> effectiveAnchorCount 5, byte-identical to today via the
  SAME `DescriptionAnchorInner`. Labels/values via the MC-4 `reviewRender` helpers. **L7:** search + every save
  payload's `description` (the copy-forward match guard) + rollup keep reading the joined `row.description` --
  NEVER a per-column value there. `colIndexFromColKeyPure` resolves the `desc:<col>` keys.
- **Row-memo anti-defeat rule:** the per-row `<tr>` is a `React.memo`'d `PricingGridRow` (exhaustive comparator
  `pricingRowPropsAreEqual`). NEVER pass a memoized row the shared `draftRates`/`proposedRates` object (a keystroke
  makes a new ref → all rows re-render → memo silently defeated); each row gets only its own slice via
  `groupDraftsByRow` (ref-reused). Per-sheet/grid-level props (formula map, recon map, `expanded`, `hiddenCols`,
  search-hit booleans) must flip identically for all rows; never add an inline-arrow callback prop to a row.
  **Per-row-collection rule (P1):** the SAME rule applies to any per-row collection (categories, and future
  overlays) — flow it to a row as its OWN per-row entry compared BY VALUE (`category` = `map.get(source_row_number)`,
  passed in `renderRow`), NEVER the whole Map/collection compared by identity in the row comparator (a single
  edit rebuilds the collection → all rows re-render). The whole Map may live at the GRID level (keydown, size gates).
- **Read-only gating = PRESENCE of the save callback** (`onSaveRate` / `onSaveRemark` / `onSaveColor` / ...). The
  page withholds them when locked / taken-over / grid-only. Do NOT add a second per-cell `editable` signal.
- **Rate-edit gate is ASYMMETRIC by node_type (owner-locked):** editable iff `override || node_type === "Line Item"
  || (node_type === "Preamble" && isRowQtyBearing(row))`. A zero-qty Line Item stays editable; a zero-qty Preamble
  is read-only. NEVER collapse this asymmetry. Server `save_cell_price` enforces the same rule (client = UX).
- **MANDATORY amount-formula gate (owner-locked; REVERSES "formula optional"):** every amount column needs a covering
  formula (`priceability.areFormulasComplete`, override>wildcard via `pickFormula`) before ANY rate is editable; the
  gate is ANDed in OUTSIDE `isRateEditableRow` so the override CANNOT bypass it. `onSaveFormula` (declaration) stays
  live while rates are locked. Server `_sheet_formulas_complete` is the real boundary. It ALSO gates the revision
  carry button (below).
- **Revision carry button (owner-locked, ADR-0014 Amendment C + E):** a revision commit carries NOTHING, so
  the ONE carry surface is the emerald **"Carry rates from original"** button in the pricing editor's action row,
  immediately after *Save now* (the hub's whole-BoQ button is REMOVED). Its four states come from the PURE
  `carryButtonState` (`CrossBoqCarryDialog.tsx`, ADR-0010 F4): **hidden** off a revision (`origin === "revision" &&
  source_boq` — with no original the action does not exist, so a disabled button would be a lie), then loading, then
  no-mapped-source, then **locked**, then the formula gate, then nothing-to-carry. It calls `gridRef.current?.flush()`
  BEFORE opening — the carry writes underneath the grid and a pending draft saved afterwards would overwrite a carried
  rate. **AMENDMENT E (2026-07-28) REVERSED Amendment D: the dialog carries the four non-rate layers again, OPT-IN.**
  An "Also carry" block (single-sheet mode ONLY; hidden when the server sends no `sheet.layers`, disabled when the
  formula gate blocks the sheet) offers one row per `CARRY_LAYER_KEYS` entry with a Keep/Overwrite pair shown only when
  `kept > 0`. **Defaults categories ON, the three annotation layers OFF — a UI default living ONLY in
  `initialLayerChoices()`; never push it into the server** (an omitted `layers` payload is rates-only, which is exactly
  what a pre-E client keeps getting). The plan walks every layer with overwrite OFF, so
  `layerMoveCount = carried + (overwrite ? kept : 0)`. **Three gates had to widen to BOTH axes, and each matters:**
  the apply gate is `carryWriteCount(...) === 0` (**R15 deleted `nothingToCarry`**), not `selectedCount === 0`;
  the destructive footer counts rates and layer records **separately** (they are not the same kind of loss); and
  `summarizeSheetCarry`'s "Nothing was carried." branch keys off every axis (a category-only carry is the LIKELIEST
  shape — a revision whose rates all conflict can still take the whole category set). Readiness is still
  `counts.clean + counts.conflict > 0`. Emerald is BANNED inside the dialog — it means priced/succeeded in
  this screen and belongs to the button + the post-apply line.
- **The "carried" verdict state (Amendment E, owner ruling 2026-07-28; inputs corrected 2026-07-30 per R3/R16):**
  `deriveVerdictState` gains `"carried"`, rendered as sky text + `CornerDownRight` + a provenance tooltip. It marks
  **EVERY carried row, machine or human** — provenance is the axis, and "who decided it" does not answer "was this
  inherited?"; the check therefore sits ABOVE the human check. It has **three inputs**, not one:
    - `SheetCategoryRow.carried_from_boq` — the row's origin BoQ. **The STATE still keys on this field alone**, so a
      row is `"carried"` iff this is set; the other two inputs shape the tooltip, never the verdict.
      `resolvedToSheetCategoryRow` MUST pass it through — unlike `cross_engine_conflict`/`review_priority`/`votes`
      (telemetry, deliberately dropped), this is provenance, and dropping it fails SILENTLY (every carried row renders
      as locally decided).
    - `carried_from_version` (R3) — which VERSION a within-BoQ carry came from.
    - `carried_from_other_boq` (R16) — **derived SERVER-SIDE** in `get_sheet_categories_resolved`, not recomputed in
      the client. Do not re-derive cross-BoQ-ness from a string compare in the frontend.
  The tooltip therefore reads **`carried from Version N`** for a within-BoQ carry and **`carried from BOQ-…`** for a
  cross-BoQ one — the two cases are distinguishable, and rendering the BoQ form for both was the pre-R16 bug. Both
  gates built on
  `deriveVerdictState` are unaffected and test-pinned: `isRowEditable` (`!== "unclassified"`, so a carried row stays
  correctable) and `isMasterSetBlank` (`=== "unclassified"`, so an inherited category still opens the rate gate).
  ⚠️ `SheetPricingPage`'s `onApplied` MUST call `mutateCategories()` — Amendment D had removed it as a dead
  round-trip, and that reasoning expired with the layer it was based on.
- **Formula engine arc F1–F4 (COMPLETE):** PURE `amountFormula.ts` (evaluate) + `AmountFormulaBuilder.tsx` /
  `formulaTokens.ts` (author; click-to-insert, NO literals) + `PricingGrid.evaluateAmountCell` (compute;
  formula-wins-else-pairing, draft-aware, fail-safe BLANK on any missing operand — never a stale number).
  `pricingRollup.ts` / `SummaryPanel.tsx` are formula-aware too.
- **`reconcile.ts` is a PURE LEAF** (imports only types): the SHARED `amountsEqual` epsilon + `resolveDivergence`
  (D1 = DOCUMENT default). It exists so PricingGrid / priceability / pricingRollup share one comparison with NO cycle
  (PricingGrid must NOT import pricingRollup). Divergence fires only on `cell.kind === "value"`.
- **`priceability.ts` is the shared "qty-bearing priceable line" spine** — the ONE definition for flags / the N-of-M
  count / rollup alignment. It imports PricingGrid's leaf predicates; **PricingGrid NEVER imports priceability**
  (receives flags as a prop) — keep this one-way dependency (why `isNonZeroNum` is a self-contained copy in PricingGrid).
- **Column resize is shipped; frozen-left HAS shipped too** as a TWO-PANE split, gated behind a page-owned `frozen`
  toggle (`PricingGrid` `frozen` prop, default false, wired from `SheetPricingPage`; `split` engages once every row
  height is measured -- frozen pane = the 5 anchor columns, scrolling pane = descriptors + Remarks and owns overflow-x/y,
  mirroring its vertical scroll back to the frozen pane). When `frozen` is OFF (the default) it stays a single
  `table-fixed` + `<colgroup>` table with only a vertically-sticky header (no sticky-left). Widths are GRID-LEVEL
  (never a per-row prop, so the row memo is untouched). Full-screen is an in-app root-`className` toggle (NO portal /
  Dialog -- ONE JSX tree, so the grid never remounts and unsaved drafts + cursor survive).
- **Annotation channels coexist:** system cell BACKGROUND (priced emerald / amber), user color = LEFT BORDER, system
  flags = col-0 GUTTER, focus = ring — never let one channel mask another.
- **Classify Category column (CL-2):** a read-only nav column, the FIRST right-pane (scrolling) cell at colIndex
  `FIXED_ANCHOR_COUNT` (the 5 anchors stay pinned; Category is NOT a 6th anchor). The descriptor colIndex base is
  centralized to `DESCRIPTOR_COL_START = FIXED_ANCHOR_COUNT + 1` — the `+1` lives in ONE place (render loop /
  `remarksColIndex` / `descriptorAt` / `colIndexFromColKey` / rate-guard all read it); its leading `<col>`/`<th>` go in
  the scrolling-pane + single-table colgroups, NEVER the frozen/anchor pane. It is driven by a reference-stable
  `categoriesByExcelRow: Map<number, SheetCategoryRow>` (built page-side from `get_sheet_categories`, ONE identity line
  in `pricingRowPropsAreEqual`) — the row memo is untouched (do NOT hand it a per-row prop that changes on keystroke).
  The run itself is
  driven from a screen-scoped socket (`boq:classify_sheet_progress`/`_done`) + `get_classify_status` poll on
  `SheetPricingPage` (the page's FIRST socket), mirroring the BoqHub parse-run pattern. `ClassifySheetDialog.tsx` is the
  engine/scope picker (registry-driven, modeled on CopyForwardDialog's `Set<selected>` + `Record<id,scope>`).
- **Category cell is CLICK-TO-EDIT (CL-3):** click (and Enter on the focused cell) open `CategoryVerdictPicker.tsx` (a
  Radix Popover anchored to the clicked cell via `virtualRef`), with categories GROUPED BY the engine(s) that ran
  (engine-scoped, NOT all-15; v1 = one Electrical group). **Open-state is PAGE-OWNED, keyed by excel_row — NEVER a
  per-row prop.** The row receives only a REFERENCE-STABLE `onCategoryClick(excelRow, cellEl)` callback + a stable
  `categoryLabelById` map (both compared by identity in `pricingRowPropsAreEqual`), so the row memo stays intact — do
  NOT thread an `open`/`selected` boolean through the row props. Only classified rows are editable
  (`isRowEditable`). The cell shows the human-readable LABEL (`labelFor`, id fallback) + 3 states via `deriveVerdictState`
  (auto / amber needs-review / emerald "your pick" human verdict). Selecting calls `set_row_category` (`""`=clear) with an
  OPTIMISTIC `categoryOverrides` patch folded into the reference-stable `categoriesByExcelRow` map + `mutateCategories`
  reconcile + revert-on-error. The Check-Category filter drops a row once it has a verdict
  (`isMasterSetBlank`). Catalog + labels come from the read-only `get_category_catalog(discipline)` endpoint. The
  two-engine overlap-conflict fork stays PARKED. `get_category_catalog` labels the ids -- never invent labels client-side.
- **Blank-eligible clickability + amber "needs a category" fill (CL-6):** the click/Enter editability gate is
  `!!onCategoryClick && (isRowEditable(cat) || (isPriceableType(row.node_type) && hasRun))` — an ELIGIBLE
  (Preamble/Line Item) BLANK cell is clickable once the sheet has been classified at least once; a non-eligible ("Other")
  row is NEVER clickable; nothing is clickable on a never-run sheet (this REVISES CL-3's "only classified rows are
  editable"). `hasRun` is a GRID-LEVEL prop = `categoriesByExcelRow.size > 0` (page passes it; same size>0 truth that
  gates the filter button) — it is DELIBERATELY NOT in `pricingRowPropsAreEqual` (a pure function of the already-compared
  `categoriesByExcelRow`, so it never flips without that map's ref changing). The Category cell shows an amber FILL
  (`bg-amber-50 dark:bg-amber-950/30`, the grid's attention-fill token) exactly when the **ONE shared predicate
  `isMasterSetBlank(row, cat)` = `isPriceableType(row.node_type) && deriveVerdictState(cat) === "unclassified"`**
  (exported from `PricingGrid`) is true — an ELIGIBLE row (Line Item / Preamble) whose category cell is EMPTY
  (`unclassified`: with OR without a record, incl. never-classified no-record rows). The old `|| needs_review` disjunct
  was DROPPED from the fill (unreachable from resolved data — a resolved review row has a blank effective, which
  short-circuits to `unclassified` — and the owner ruled amber == master-set-blank). The fill CLEARS automatically when a
  category is set (effective non-blank → state leaves `unclassified`); do NOT add clearing code. Backend:
  `set_row_category`→`persist.set_human_verdict` UPSERTS (creates a `BoQ Row Category` when none exists) so a verdict on a
  no-record eligible row persists. **The "Check Category" view filter uses the SAME `isMasterSetBlank` predicate, so the
  filter shows EXACTLY what amber shows (owner-locked) — including never-classified eligible rows.** It REPLACED the
  RETIRED `isNeedsReviewCategory`, which returned FALSE for a never-classified row and so could not surface the rows the
  widened "empty is empty" gate now counts. `isPriceableType` TRIMS `node_type` so the client master set is byte-identical
  to the server's stripped eligible set. Amber and the filter, being one predicate, can never drift.
- **Category-gate VISIBLE half -- the live count, banner + cell gating (four surfaces, ONE predicate).**
  The page derives a LIVE blank COUNT via `PricingGrid.countMasterSetBlankRows(rows, categoriesByExcelRow)`
  -- the SAME `isMasterSetBlank` the amber fill + Check-Category filter use, now a FOURTH surface. It
  **iterates the ROWS array, NEVER the categories map** (a never-classified row is absent from the map but
  must still count -- the fail-open the backend guards). Memoise it on `[rows, categoriesByExcelRow]` (which
  already folds the optimistic overrides), so it recomputes only on a fetch/pick/clear, never per keystroke.
  **Only the BOOLEAN `categoryGateOpen = isCategoryGateOpen(count, override)` reaches `PricingGrid` -- NEVER
  the count.** A count changes on every pick and would re-render every row; the boolean flips only when
  editability actually flips (which IS when every row's editability changes -- the correct time to re-render
  all rows). It is threaded like `formulasComplete`: a `PricingGridProps` boolean (default true), a row prop
  in `pricingRowPropsAreEqual`, ANDed OUTSIDE `isRateEditableRow` in ALL THREE rate-write gates (the inline
  cell edit, `rateWritableAt` paste, `isDeltaWritable` undo/redo) so "Price any row" can never reach past it.
  **DELIBERATE asymmetry: the count keeps counting under the override (an admin sees how many remain) but the
  gate opens.** The category-pick handler writes an optimistic override for BOTH a pick AND a clear
  (`buildOptimisticVerdict`): a clear yields a BLANK verdict (effective "" -> `isMasterSetBlank` TRUE) so the
  count RISES instantly and the sheet re-locks in the same interaction (closing the drops-on-pick /
  rises-late-on-clear window); it reverts on save failure via the existing `dropOverride`, and the refetch
  reconciles an auto-machine reversion. The amber BANNER (owner-approved copy, a distinct OVERRIDE variant
  naming `category_override_by`/`category_override_at` via `formatDate`) shows the count and NAMES the existing
  "Check Category" control -- **no new button, no click-to-jump** (owner ruling). `GetPricedRowsResponse`
  declares the G2a/G2b/G2e payload keys (`eligible_blank_category_count`, `categories_complete`,
  `category_gate_override`/`_by`/`_at`/`_reason`). **The admin set/clear override CONTROL SHIPPED in G3b** --
  two contextual buttons IN the banner (SET = `Override the check` -> a reason `Popover`, OPTIONAL reason +
  `N/250` counter, no confirmation; CLEAR = `Remove override`), both gated on the pure exported
  `canAdminOverride(role, userId)` (role-resolved AND admin, MIRRORS `_is_nirmaan_admin` by construction --
  CONVENIENCE ONLY, server authoritative; the `role !== "Loading"` guard prevents a flash). Reason is
  normalised by the pure exported `normalizeOverrideReason` (client cap 250 + blank->null). Banners render
  for everyone; controls are admin-only. Override is TEMPORARY -- every G3b block carries a delete marker
  (removal condition: once classification engines cover all disciplines). **The refusal messages drop the pre-G2e "priceable"/"rate-editable" wording**
  (those terms stay correct only for the SEPARATE priceability gate). Because the client gate makes rate cells
  read-only, a UI save cannot be ATTEMPTED while locked -- the server save-refusal message is a backstop.
- **Multi-engine category resolution (HV-10, N-GENERIC -- no discipline named in the pathway):** the
  pricing editor reads `get_sheet_categories_resolved(boq, sheet_name)` (NOT the single-discipline
  `get_sheet_categories`, which is UNTOUCHED so `freeze_classification`/`get_freeze_summary` keep
  working). The SERVER applies a per-ROW ladder across every discipline with current rows: human
  wins (most-recent between disciplines) > auto-accepted > higher-`ai_confidence` between multiple
  autos (row flagged `cross_engine_conflict`) > blank. **`cross_engine_conflict` is TELEMETRY-ONLY --
  computed, never persisted, NEVER rendered** (owner ruling, same as `review_priority`); the pure
  `resolvedToSheetCategoryRow` adapter (`sheetCategoryResolve.ts`) DROPS it so it can't reach a
  rendered surface, and maps each resolved row onto the grid's `SheetCategoryRow` so `PricingGrid` +
  `deriveVerdictState` + `isMasterSetBlank` render UNCHANGED (blank rows still blank + amber).
  `ranDisciplines` (the read's `disciplines[]`) drives: one `get_category_catalog` per ran-discipline
  (via child `EngineCatalogFetcher` -- the hook-safe N-dynamic-fetch pattern) into the grouped
  picker (`buildSheetEngineCatalogs`), and per-running-discipline status polling (one child
  `ClassifyStatusPoller` each -- single-engine = the old single poll; the modal completes when all
  running disciplines terminate). Socket done/progress filters are MEMBERSHIP in
  `(ran UNION running)`, never `=== a constant`. **The picker's `onSelect(id, discipline)` CARRIES
  the picked group's discipline** -- the write (`set_row_category`) lands on that engine's row
  identity (upsert-on-missing mints it); "Clear" (`discipline=null`) targets the row's resolved
  human discipline. **NEVER hardcode a discipline string in this pathway** (the deleted
  `CLASSIFY_DISCIPLINE` constant was the HV-10 bug); a future engine flips `available` in the
  registry and flows through with zero code change. Every new page input stays identity-stable
  (`useMemo`/`useCallback`) so the `PricingGrid` `React.memo` shield holds.
- **Completion summary = COMBINED EFFECTIVE outcome (HV-10b, owner ruling 2026-07-22):** the
  "xx classified, yy flagged for review" message (both the `ClassifyProgressModal` line and the
  post-close toast) reports the COMBINED effective split, NOT a per-engine denominator (the old
  last-engine-wins `classifySummary` was the defect: a 2-engine run showed one engine's 13/12).
  When ALL running disciplines terminate, `applyClassifyDone` composes the summary from the FRESH
  resolved read (the grid's source of truth, post-`mutateCategories`) via the pure
  `summariseResolvedOutcome(resolvedRows, rangeUnion)`: categorised = effective non-blank (an
  auto-accept OR a human verdict -- so a pre-existing human verdict counts as categorised),
  review = effective blank. It is scoped to the run set's `rangeUnion` (`unionScopes`): a fresh
  run set (each `onStarted`) REPLACES the union (reset semantics); multiple engines fold together
  and **whole-sheet DOMINATES a mixed union**; a run recovered from the poll (unknown scope) or an
  empty scope degrades to whole-sheet. Single-engine whole-sheet with no human verdicts equals the
  engine's own numbers by construction (pinned by test). To carry the range up, `ClassifySheetDialog`'s
  `onStarted` now passes `Array<{discipline, scope}>` (signature-only; no dialog behaviour change).
  The error path and the message WORDING are unchanged -- only the numbers' SOURCE changed.
- **AI-status on the completion surfaces (HV-11): HEALTHY PATH SILENT, FALLBACK LOUD.** The pure
  `aiStatusWarning(aiStatusByDiscipline)` (`ClassifyProgressModal.tsx`) drives an AI-off warning on
  BOTH the modal line + the post-close toast. It returns "" when every ran discipline had AI ON
  (`ran`) or had no eligible rows (null) -- so the healthy completion text stays byte-identical
  (zero noise); when ANY discipline reports `disabled`/`no_key` it returns ONE plain line NAMING the
  off discipline(s) (multi-engine names ONLY the off one). `SheetPricingPage` accumulates ai_status
  PER DISCIPLINE over the run set (`aiStatusByDisciplineRef`, reset each `onStarted`, one entry per
  engine's done) -- do NOT revert to the old single last-engine-wins `aiStatusNote` render, which
  masked a mixed multi-engine run. The done payload's `ai_status` values are `ran | disabled |
  no_key | null`.
- **Classification freeze read pattern (SEPARATE from the pricing lock):** `classification_frozen` (+ `frozen_by`/`frozen_at`)
  rides `get_priced_rows` -> `GetPricedRowsResponse` and is read off `activeMessage` BESIDE `isLocked` — but it is
  DELIBERATELY NOT ORed into the pricing `locked` gate (pricing stays live under a classification freeze). It gates ONLY
  the Category picker + the Classify button. The Freeze/Unfreeze button sits in the bottom ribbon after Classify; freeze-click
  reads `get_freeze_summary` then confirms (warns on uncategorised eligible rows), unfreeze uses the verbatim owner-copy
  `AlertDialog`; both `mutate()` to re-read the flag (the `lock_sheet`/`handleToggleLock` pattern). While frozen,
  `onCategoryClick` short-circuits with a brief inline message via a `classificationFrozenRef` — the callback stays
  REFERENCE-STABLE (row-memo anti-defeat rule); NEVER thread a per-row `frozen` prop through `pricingRowPropsAreEqual`.
- **Rate-helper chassis (U1, DEV-only, `rate-helper/`; full detail in the plan doc's "Build slice U1"):** the
  "Suggest rates" button + per-cell badges + the page-level panel that renders a typed helper CONTRACT generically
  (`RateHelper.compute -> Suggestion | NoSuggestion`; the panel has ZERO helper-specific rendering — a new helper is
  a registry edit). Load-bearing invariants: (1) **DEV gate `RATE_HELPER_ENABLED` (`import.meta.env.DEV` + a
  localStorage kill-switch) — a prod `vite build` makes the whole feature unreachable**, so it must guard the button,
  the grid props (`rowSuggestionsByExcelRow`/`onSuggestionBadgeClick` passed only when enabled), and the panel mount.
  (2) The ONE write is **`PricingGridHandle.applyRate(excelRow, col, value)`, which MUST mirror the typed `onChange`
  EXACTLY — optimistic `setDraftRates` + clear proposal + the SAME 1s debounced `scheduleAutoSave`, NEVER a
  synchronous `commitRate`**: a synchronous commit races the page's `dirty -> ensureLockAcquired` and trips a spurious
  takeover; deferring makes "Use this value" byte-identical to typing (undo/mutate/takeover/locked-gate all inherited).
  (3) Memo shield (P1): the grid gets per-row ONLY its `rowSuggestions` entry compared BY VALUE (`rowSuggestionsEqual`),
  never the whole Map; `rowSuggestionsByExcelRow` + `onSuggestionBadgeClick` change only on a run/Use (like
  `categoriesByExcelRow`), never on keystroke. (4) The button's enable chain **REUSES the rate-write gate
  (`!locked && formulasComplete && categoryGateOpen`) — never re-derived** — surfacing the first failing reason as the
  title. (5) The badge lives in the rate cell's right-aligned flex strip with `stopPropagation`, so a bare cell click
  still just places the cursor.
- **Rate-helper WENT REAL (RM-3, `pricingSheetHelper.ts`; full detail in the plan doc's "Build slice RM-3"):**
  the stub is DELETED; the `Pricing sheet` helper is a page-built closure over a PERSISTED, version-keyed
  server extraction run that COMPUTES the rate CLIENT-SIDE via the RM-2 `runPipeline` UNCHANGED (the single
  compute source — a rate/param change flows in live with no re-run; only extracted attributes persist). The run
  itself IS persisted (unlike U1's page-session badges): `get_active_suggestion_run` loads it on open with no
  press, and `record_rate_suggestion_event` banks Use telemetry. Load-bearing additions: (a) a PARTIAL in-run row
  still badges via `Suggestion.producibleKinds`; (b) a FAINT always-on opener renders on every rate-editable cell
  WITHOUT a badge (owner: bring up the helper on badge-less cells) — a pure render change, no new row prop, memo
  shield intact; (c) attributes are CATEGORY-SCOPED — a not-in-run row of the helper's category gets a blank
  editable fill (never minting a badge), any OTHER category (or none) gets a "coming soon" NoSuggestion, gated on
  `ctx.category === config.category_id` (only `wiring_cabling` is defined this slice); (d) `RateHelperPanel`'s
  empty choice attrs carry a `— select —` placeholder so a blank never masquerades as its first option.
- **Rate-helper panel/strip/workings refinements (RM-3a, `RateHelperPanel.tsx` / `SheetPricingPage.tsx` /
  `PricingGrid.tsx` cell-strip; full detail in the plan doc's "Build slice RM-3a"):** three owner-locked
  invariants. (1) **TWO-MODE panel mount** (supersedes the single flex-row mount that shrank the grid): a
  `RateHelperPanel` `variant` prop — `"overlay"` in FULL-SCREEN is a viewport-`fixed inset-y-0 right-0 z-[60]`
  drawer rendered OUTSIDE the flex row (the grid's width/columns/horizontal-scroll stay BYTE-UNCHANGED on
  open/close), `"embedded"` (default) stays IN the flex row keeping the certed widen-while-open
  (`max-w-5xl` → `w-full`) but now `sticky top-4` so it rides the viewport; a scroll-into-view guard fires
  ONLY when the panel is genuinely off-screen (never yanks a sticky-pinned panel, never touches horizontal
  scroll). The page gates the flex-row + grid-shrink wrappers on `helperPanelOpen && !expanded` and renders
  the overlay panel on `expanded`. (2) **Colour-picker icon is HOVER/FOCUS-ONLY** (owner option (a), an
  action not status): `opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100`, so the
  3 descriptor `<td>`s that host `colorPicker` carry `group`; the priced dot + badge/used-check + sparkle
  opener stay PERSISTENT (strip `gap-0.5`). Colour-selection logic is unchanged (CSS + `group` markers only).
  (3) **GROUPED workings contract (generic, guardrail G3):** `WorkingsSection.sections?: WorkingsGroup[]`
  (`{label, derivation, finals, matchedRows?, attributes?}`) — the panel renders each group as its own block
  with the SHARED extracted attributes ONCE above; **ABSENT `sections` ⇒ flat rendering, byte-identical to
  before (single-group suggestions stay backward-shaped)**. `pricingSheetHelper` emits two groups on a CABLE
  row (`Cable — per Mtr` / `Termination — per Set`) and flat (no `sections`) on a termination row; groups are
  DISPLAY-ONLY (the applied value is still `Suggestion.values`). **Memo shield untouched** — no new per-row
  grid prop, `pricingRowPropsAreEqual` unchanged.
- **Rate-helper embedded panel-as-default + grid scroll conventions (RM-3b, `RateHelperPanel.tsx` /
  `SheetPricingPage.tsx` / `PricingGrid.tsx`; full detail in the plan doc's "Build slice RM-3b"):** three
  owner-locked layout invariants. (1) **EMBEDDED panel-as-default:** the embedded rate-helper panel is
  ALWAYS MOUNTED (no open/close, NO close X in embedded — the X renders only for `variant="overlay"`); its
  props `excelRow/col/kind/ctx` are OPTIONAL and absent => an empty-state card. The page derives
  `embeddedPanel = RATE_HELPER_ENABLED && !expanded`; when true the embedded page is PERMANENTLY widened
  (`w-full`, superseding RM-3a's widen-while-open there) and the flex row is always on. A badge/sparkle click
  SELECTS a row (replacing the previous) via the existing `helperPanel` page state. (2) **FULL-SCREEN sticky
  header + native bottom H-scrollbar (owner-locked):** the two panel-row wrappers between the grid slot and
  the grid container MUST carry `expanded && "flex min-h-0 flex-1 flex-col"` so the flex chain reaches the
  grid container and it BOUNDS to the viewport as the internal scroller — that is what keeps the (already
  `sticky top-0`) header visible AND puts the native H-scrollbar at the viewport bottom, in classic +
  virtualized + frozen split (both panes' headers pixel-aligned). Without it the outer `.fixed.inset-0`
  wrapper scrolls and the header scrolls away — do NOT let those wrappers go empty-class in full-screen.
  (3) **EMBEDDED always-visible H-scrollbar = a SYNCED PROXY bar:** a `sticky bottom-0` thin bar rendered as a
  SIBLING of the scroll container (spacer width = `twoPane ? scrollPaneTableWidth : totalWidth`), two-way
  `scrollLeft`-synced to the active X-scroller (`scrollPaneRef` when split, else `containerRef`) via a
  re-entrancy-latched effect; rendered ONLY embedded (`!expanded`) — full-screen uses the native bounded
  scrollbar. Same viewport-pinned-H-scrollbar FAMILY, realized per-mode. **Memo shield untouched** — the
  proxy + `expanded` gate are GRID-LEVEL; no new per-row prop, `pricingRowPropsAreEqual` + the virtualizer
  math unchanged (only its containers' styling).
- **Rate-helper single-bar + full-screen push panel + collapsible top block (RM-3c, `PricingGrid.tsx` /
  `RateHelperPanel.tsx` / `SheetPricingPage.tsx`; full detail in the plan doc's "Build slice RM-3c"):** three
  owner-locked layout invariants. (A) **Embedded = ONE horizontal scrollbar.** The single-pane container +
  the frozen scrolling pane carry `boq-embed-hidehbar` when `!expanded`; a scoped `<style>` inside PricingGrid
  (NOT `index.css`) does `::-webkit-scrollbar:horizontal{display:none;height:0}` -- suppresses ONLY the native
  H-bar, keeps the V-bar + `overflow-x:auto` capability. **Cross-browser shape: blink/webkit clean; Firefox
  has no per-axis control so it keeps a below-fold native H-bar (proxy stays primary).** The proxy width +
  spacer are LIVE-MEASURED from the ACTIVE scroller via a ResizeObserver (`hScrollMetrics`) -- proxy width =
  `scroller.clientWidth` (kills the V-bar clamp), spacer = `scroller.scrollWidth` (kills the frozen
  short-scroll); do NOT revert to the one-shot column-width sum. (B) **Full-screen panel is a PUSH panel**
  (`RateHelperPanel` variant `push`, supersedes the RM-3a fixed overlay): an IN-FLOW flex sibling of the grid,
  so `#4` is a flex ROW [ grid column | push panel ] and `#3` the grid COLUMN (`min-w-0 flex-1 flex-col`); the
  grid narrows by exactly the panel width and the bounded scroller / sticky header / native H-bar keep working
  at reduced width. A left-edge drag handle (`role="separator"`, focusable) resizes -- clamp `[280, 50% of the
  wrapper]`, double-click resets to the DEFAULT **300**, Arrow keys nudge, width persisted to
  **`nirmaan-rate-helper-panel-w`**. Push keeps its close X; embedded panel-as-default is untouched. (C)
  **Full-screen COLLAPSIBLE top block:** everything above the grid (title + both ribbons + banners + panels)
  is one `space-y-4` block that `hidden`s when `expanded && topCollapsed` so the grid-slot fills vertically; a
  SLIM RAIL (`expanded && topCollapsed`) re-expands in one click and shows the truncated sheet name + a
  compact chip per active blocking/visible banner (**the category chip surfaces whenever blanks exist -- in the
  blocking OR override-informational form -- so collapsing never hides state**). **Escape re-expands first**
  (a second Escape exits full-screen -- never trapped). Persisted to **`nirmaan-fullscreen-top-collapsed`**.
  EMBEDDED is untouched (`topCollapsed` only bites while `expanded`). **Memo shield + virtualizer math
  untouched** across all three.
- **Socket reconnect self-heal must be reconnect-GATED + debounced (T1, owner-verified):** a `socket.on("connect", ...)`
  handler that refetches (`mutate()`/`mutateCategories()`) MUST NOT fire on every connect — the initial mount connect
  double-fetches (the SWR mount fetch already ran) and a flapping dev socket then refetches on every reconnect, and
  because `PricingGrid` is `forwardRef` WITHOUT `React.memo`, each page re-render is a full-grid reconcile → a continuous
  idle re-render storm (measured: ~92% main-thread saturation for a whole session). The rule: refetch ONLY on a GENUINE
  reconnect (a `connect` that followed a `disconnect`, tracked via a REF — never state, or the tick itself re-renders)
  and debounce to ≤1 refetch per ~30s (`shouldRefetchOnConnect` pure helper + `RECONNECT_REFETCH_DEBOUNCE_MS`). frappe-react-sdk's
  SWR `revalidateOnReconnect` binds the browser `online` event, NOT the app socket, so socket flapping does NOT hit SWR —
  do not add per-hook `revalidateOnReconnect:false` for socket reasons. (Memoizing `PricingGrid` is the T2 source-independent
  kill — SHIPPED, see below.)
- **`PricingGrid` is `React.memo`'d (V0/T2) — EVERY prop it receives MUST stay identity-stable, or the shield silently dies.**
  A page-level re-render with unchanged grid inputs now bails at the memo instead of re-executing the whole grid body +
  `pricingRowPropsAreEqual` across all rows. This holds ONLY because `SheetPricingPage` keeps every grid prop referentially
  stable: the 7 grid handlers (`handleSaveRate`/`Remark`/`Color`/`ReconChoice`/`Formula`, `handleBatchWrite`, `handleDirtyChange`
  + the transitive `ensureLockAcquired`) are `useCallback`, and the derived collections (`rows`, `rowFlags`, `byRowIndex`,
  `childrenByParent`, `displayRows`) are `useMemo`. **`rows` is the linchpin:** `mergeRowsPreservingIdentity` returns a fresh
  array every render, so `rows` MUST be `useMemo`'d (keyed on `rawRows`) or the grid's `rows` prop churns and the memo never
  bails. Any NEW grid prop must be `useCallback`/`useMemo`/stable-per-fetch; a new plain-const handler or `new Map()`/`?? []`
  passed to the grid re-defeats the memo with no error. **The three loading/`!boq`/`!sheetName` guards render as branches of the
  SINGLE `return` (NOT early returns)** so all derived state stays hook-legal — do not reintroduce an early return above the
  derived-state region (it makes the memoization illegal). Verify with React DevTools Profiler ("Why did this render?").
- **Virtualized windowing (V1) — ONE virtualizer drives BOTH panes; classic path retained behind the A/B toggle.** The grid
  windows rows via `@tanstack/react-virtual` when the page-owned `virtualized` prop is true (default ON, session-scoped); false =
  the CLASSIC full render, **byte-identical to pre-V1** (the 143 `PricingGrid` tests certify it). ONE `useVirtualizer` instance is
  the row-window authority for both panes: `getScrollElement` = `scrollPaneRef` (two-pane) / `containerRef` (single); both
  `<tbody>`s render the SAME `getVirtualItems()` slice + identical `deriveSpacers` spacer `<tr>`s (never two synced virtualizers).
  The render decision is `twoPane = selectRenderPath(...) === "twoPane"` (classic gates on `split`, virtualized on `frozen`); only
  the `<tbody>` content changes (via `renderTbody`) — the pane/table JSX is shared. **Pane alignment = MAX-of-both-panes height
  (V1-FIX): NEVER assume which pane is taller.** The freeze layout puts the wrapping **Description** in the FROZEN pane (through
  the 5 anchors), so measuring only the scrolling pane truncates + mis-aligns. The custom `measureElement` reads BOTH panes' rows
  by `data-index` and feeds `ceil(max(paneNaturalHeight(frozen), paneNaturalHeight(scroll)))` to the ONE size cache; both panes get
  that size as the `<tr>` height (a table MIN) → the taller reaches content, the shorter pads → aligned, no truncation. **`paneNaturalHeight`
  MUST measure the `<tr>`'s TRUE box (`Math.ceil(tr.getBoundingClientRect().height)`, row border INCLUDED) — this is what makes both
  panes match CLASSIC, which applies `ceil(single-table box)` to both (V1-FIX-2).** The `<tr>` box is SELF-CORRECTING (`max(content,
  applied)`, a fixpoint) so it does NOT run away — do NOT revert to the old content-wrapper sum (it omitted the ~1px border → ~1px/row
  drift at every DPR) and do NOT add the border to a content-wrapper measure (a stretching scrolling cell feeds it back = runaway).
  `clipDescription` is OFF for auto virtualized rows, ON for classic + manual-drag rows. TanStack observes only the LAST element per
  index (verified) → a frozen-only reflow (column-resize Description re-wrap; scrolling `<tr>` unchanged → ResizeObserver silent) is
  covered by a **two-phase drag-END reset** (`remeasureVirtualRowsAfterResize`: `measure()` to clear sticky sizes, then a
  `resizeSettleTick`-keyed `useLayoutEffect` re-invokes `measureElement` on the mounted rows POST-commit — never streaming, no thrash;
  V1-FIX-2b). `measure()` alone is NOT enough (it clears but never re-reads the frozen twin; a shrunk row's min-height stays sticky).
  Residual drift is <=0.31px at fractional display DPR / browser zoom (two separate `border-collapse` tables) — 0px at 100% zoom.
  The freeze-measure-all `useLayoutEffect` is SKIPPED when `virtualized`. **Any new grid prop must stay identity-stable (the V0
  shield);** `measureRef` is stable per virtualizer instance and is compared in `pricingRowPropsAreEqual`. Pure window helpers
  live in `pricingVirtual.ts` (unit-tested). Runtime behavior is an A/B instrument — confirm the virtualized path live before
  relying on it; classic is the guaranteed fallback.
- **Off-window nav/jump = scrollToIndex-then-focus (V2), always `align:"center"`.** `focusCell` / `jumpToRow` reach the
  virtualizer via reference-stable refs (`virtualizedRef` + `scrollRowIntoWindowRef`, assigned after `useVirtualizer`) so
  they stay memo-safe; both branch on the pure `resolveJumpAction(isMounted, virtualized)` and, for a VIRTUALIZED off-window
  target, `scrollToIndex(idx,{align:"center"})` then focus after a 50ms mount-defer. **NEVER `align:"auto"`** — with dynamic
  row heights a near target's ESTIMATED offset reads as already-visible, so `"auto"` no-ops (arrow-nav stalls at the edge).
  Search-jump to any row works; **arrow-nav across the window edge is focus-safe (never escapes to `document.body`) but does
  NOT auto-scroll past the edge** — this virtualizer only re-windows on real wheel events, not programmatic scrolls (a V1
  trait affecting the mounted-path `scrollIntoView` too), so the near-target `scrollToIndex` can't advance it; do not
  re-attempt without reworking the virtualizer's scroll observation.
- **Per-row overlay open-state is keyed by the DURABLE excel row (`source_row_number`), NEVER the window array index (V2).**
  Under virtualized row recycling a collapse/filter reshuffle makes array index N map to a different row, so an index key
  mis-targets. The remark popover uses grid-level `openRemarkExcelRow`; the row prop `openRemark` stays a by-value boolean
  (memo untouched).
- **An in-row Radix popover in a VIRTUALIZED grid MUST close on VISIBILITY loss, NOT on unmount (V2-FIX).** The overscan
  zone keeps a row MOUNTED while scrolled off-screen, so a mounted-set / unmount-only close leaves the open `PopoverContent`
  collision-pinned into the viewport as a detached "ghost". Every in-row popover (RemarkCell, ColorPicker, ReconcileBadge)
  closes via the shared `useCloseWhenScrolledOut(triggerRef, open, onClose)` hook -- an `IntersectionObserver` (viewport
  root, threshold 0) on the trigger, gated on `virtualized` through `VirtualizedContext` (a context, NOT a row prop, so the
  memo shield holds; classic stays byte-identical). Same shape as the page-owned CategoryVerdictPicker's IO close. The
  grid-level `shouldCloseOverlay` mounted-set effect stays only as the remark BACKSTOP. Closing discards any unsaved draft
  (owner-accepted). EXEMPT: a popover in the STICKY `<th>` header (AmountFormulaBuilder) never scrolls off -> no observer.
