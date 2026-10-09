# Pricing editor (`PricingGrid.tsx` / `SheetPricingPage.tsx`) -- LOAD-BEARING invariants

Read this before editing `PricingGrid.tsx`, `SheetPricingPage.tsx`, or anything they render (the BCS
cost block, the Category column, the rate-helper chassis, the view filters). Backend twin:
`.claude/context/domain/boq-pricing-editor.md`. The per-slice component contracts are in
`boq-frontend.md` § BoQ Pricing Editor; the rate-helper panel's attribute semantics are in
`pricing-rate-master-frontend.md`.

## Load-bearing invariants (owner-locked)

_Moved verbatim from `frontend/CLAUDE.md` when it was cut down to material every frontend task needs (CLAUDE.md restructure, pass 2). `frontend/CLAUDE.md` now carries a one-line pointer here._

### Grid structure and read-only gating

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

### Rate gates, revision carry and formulas

- **Rate-edit gate is ASYMMETRIC by node_type (owner-locked):** editable iff `override || node_type === "Line Item"
  || (node_type === "Preamble" && isRowQtyBearing(row))`. A zero-qty Line Item stays editable; a zero-qty Preamble
  is read-only. NEVER collapse this asymmetry. Server `save_cell_price` enforces the same rule (client = UX).
- **MANDATORY amount-formula gate (owner-locked):** every amount column needs a covering
  formula (`priceability.areFormulasComplete`, override>wildcard via `pickFormula`) before ANY rate is editable; the
  gate is ANDed in OUTSIDE `isRateEditableRow` so the override CANNOT bypass it. `onSaveFormula` (declaration) stays
  live while rates are locked. Server `_sheet_formulas_complete` is the real boundary. It ALSO gates the revision
  carry button (below).
- **Revision carry button (owner-locked, ADR-0014 Amendment C + E):** a revision commit carries NOTHING, so
  the ONE carry surface is the emerald **"Carry rates from original"** button in the pricing editor's action row,
  immediately after *Save now* (there is no hub-level whole-BoQ button). Its states come from the PURE
  `carryButtonState` (`CrossBoqCarryDialog.tsx`, ADR-0010 F4): **hidden** off a revision (`origin === "revision" &&
  source_boq` — with no original the action does not exist, so a disabled button would be a lie), then loading, then
  no-mapped-source, then **locked**, then the formula gate, then nothing-to-carry. It calls `gridRef.current?.flush()`
  BEFORE opening — the carry writes underneath the grid and a pending draft saved afterwards would overwrite a carried
  rate. **Under Amendment E the dialog also carries the four non-rate layers, OPT-IN.**
  An "Also carry" block (single-sheet mode ONLY; hidden when the server sends no `sheet.layers`, disabled when the
  formula gate blocks the sheet) offers one row per `CARRY_LAYER_KEYS` entry with a Keep/Overwrite pair shown only when
  `kept > 0`. **Defaults categories ON, the three annotation layers OFF — a UI default living ONLY in
  `initialLayerChoices()`; never push it into the server** (an omitted `layers` payload is rates-only, which is exactly
  what a pre-E client keeps getting). The plan walks every layer with overwrite OFF, so
  `layerMoveCount = carried + (overwrite ? kept : 0)`. **Three gates had to widen to BOTH axes, and each matters:**
  the apply gate is `carryWriteCount(...) === 0`, not `selectedCount === 0`;
  the destructive footer counts rates and layer records **separately** (they are not the same kind of loss); and
  `summarizeSheetCarry`'s "Nothing was carried." branch keys off every axis (a category-only carry is the LIKELIEST
  shape — a revision whose rates all conflict can still take the whole category set). Readiness is still
  `counts.clean + counts.conflict > 0`. Emerald is BANNED inside the dialog — it means priced/succeeded in
  this screen and belongs to the button + the post-apply line.
- **The "carried" verdict state (Amendment E, owner ruling):**
  `deriveVerdictState` gains `"carried"`, rendered as sky text + `CornerDownRight` + a provenance tooltip. It marks
  **EVERY carried row, machine or human** — provenance is the axis, and "who decided it" does not answer "was this
  inherited?"; the check therefore sits ABOVE the human check. It has **three inputs**, not one:
    - `SheetCategoryRow.carried_from_boq` — the row's origin BoQ. **The STATE still keys on this field alone**, so a
      row is `"carried"` iff this is set; the other two inputs shape the tooltip, never the verdict.
      `resolvedToSheetCategoryRow` MUST pass it through — unlike `cross_engine_conflict`/`review_priority`/`votes`
      (telemetry, deliberately dropped), this is provenance, and dropping it fails SILENTLY (every carried row renders
      as locally decided).
    - `carried_from_version` — which VERSION a within-BoQ carry came from.
    - `carried_from_other_boq` — **derived SERVER-SIDE** in `get_sheet_categories_resolved`, not recomputed in
      the client. Do not re-derive cross-BoQ-ness from a string compare in the frontend.
  The tooltip therefore reads **`carried from Version N`** for a within-BoQ carry and **`carried from BOQ-…`** for a
  cross-BoQ one; rendering the BoQ form for both was a past bug. Both gates built on `deriveVerdictState` are
  unaffected and test-pinned: `isRowEditable` (`!== "unclassified"`, so a carried row stays correctable) and
  `isMasterSetBlank` (`=== "unclassified"`, so an inherited category still opens the rate gate).
  ⚠️ `SheetPricingPage`'s `onApplied` MUST call `mutateCategories()` — it was once removed as a dead round-trip,
  which stopped being true when the carry began moving categories.
- **Formula engine F1–F4:** PURE `amountFormula.ts` (evaluate) + `AmountFormulaBuilder.tsx` /
  `formulaTokens.ts` (author; click-to-insert, NO literals) + `PricingGrid.evaluateAmountCell` (compute;
  formula-wins-else-pairing, draft-aware, fail-safe BLANK on a missing RATE — never a stale number; a
  missing qty/amount reads as 0, see the empty-operand invariant below).
  `pricingRollup.ts` / `SummaryPanel.tsx` are formula-aware too.
- **The operator vocabulary is `+ − × ÷` (F5), and the last two are NOT like the first two.** `+`/`*` are
  commutative and associative, so an n-ary node's operand ORDER carries no meaning; `-`/`/` fold LEFT TO
  RIGHT from `operands[0]`, so **the list order IS the arithmetic** (`{op:"-",operands:[a,b,c]}` means
  `((a−b)−c)`). Any pass over a stored tree must preserve operand order. A MIXED tier parses
  left-associatively into a binary chain, while a run of ONE operator stays n-ary — that split is what
  keeps every pre-F5 formula's tree **byte-identical** (pinned by test; a re-shaped tree would move
  committed sheets' amounts). ⚠️ **A zero divisor is refused before the division** and reported `broken`
  ("check formula") — never `Infinity` on a tender document; `not_yet` would be wrong, since that reason
  means a value is ABSENT and a real 0 is present. **`amountFormula.foldOperands` is the ONE
  implementation** of all four operators (the BCS Total formula folds through it too) — do not write a
  second. ⚠️ Adding an operator means extending `AmountFormulaBuilder.OP_GLYPH` (a total map, deliberately
  not a ternary) **and** `pricing._FORMULA_OPS` **and** `export_template_workbook._OP_INFIX` — an operator
  missing from that last one exports as a BLANK cell, silently dropping the formula.
- **An empty qty / amount operand reads as the number 0 inside a formula; a missing rate never does
  (owner ruling; narrows F2's fail-safe).** An empty per-area quantity is a FACT the
  document states ("none of this in that area"), so `(20 + <empty>) x 40` is 800. An UNPRICED RATE is a PENDING ACTION and still blanks the row, and that verdict
  PROPAGATES (`EvalResult.missing: "rate" | "value"`), so an enclosing `+` cannot zero-fill a node that
  blanked on a rate two levels down. ⚠️ **ZERO-FILL IS OPT-IN PER CALLER (`FoldOptions.missingValueIsZero`)
  and `amountFormula.evalNode` is the ONLY site that opts in** — every `bcsColumns` caller passes nothing,
  so BCS Total, % Margin cost and the % Margin DENOMINATOR stay strictly fail-safe. Zero-filling the
  denominator shrinks it and makes the margin read BETTER than it is; BCS's own `EvalResult`s carry no
  `missing` tag, so the flag alone could not reach them. Substitution happens in `foldOperands`, so it is the ARITHMETIC that
  changes and NOTHING is written: the stored dict keeps its absent/null key, the quantity cell still
  renders blank (a typed `0` still renders `0`), and an empty DIVISOR is still `broken` ("check formula"),
  never 0. ⚠️ **A bare-leaf formula (one chip, no operator) deliberately does not zero-fill**, for two
  reasons (both test-pinned): (a) `evalColumn` cannot tell an EMPTY
  cell from NON-NUMERIC junk — both used to be tagged `"value"` — so substituting at the top level turned
  bad data into a confident 0; the NaN branch is now UNTAGGED so no fold can zero-fill it either. And (b)
  zero is the IDENTITY OF AN OPERATION: with no operator there is nothing for an absent operand to
  contribute to, so `amount_total = amount_supply` over an empty column would be INVENTING a number
  rather than adding nothing. The rule is "an empty operand contributes nothing to an operation", and a
  bare leaf is a READ, not arithmetic.
- **`RATE_VALUE_FIELDS` is defined twice and the two copies are pinned together by test
  (`rateFieldParity.test.ts`).** `PricingGrid`'s copy decides how a lookup RESOLVES (draft-aware,
  priced-marker, prepopulated-non-zero); `amountFormula`'s decides how a MISS is CLASSIFIED — `"rate"`
  (blank the row) or `"value"` (may read as 0). ⚠️ **Add a rate field to one and not the other and an
  UNPRICED RATE is classified `"value"`, so `foldOperands` substitutes 0 and the amount prints a
  confident number that silently omits a price** — the exact failure the opt-in zero-fill exists to
  prevent, appearing as a plausible figure on a tender line. `amountFormula` must NOT import
  `PricingGrid` (F2 stays free of it), so the parity test is the mechanism, per ADR-0010 F1.
- **The formula tier follows the column — there is no tab to choose (owner ruling).** A column
  that NAMES AN AREA writes the per-area tier; a column with no area dimension has only the one tier
  (stored `target_value_key: null`). `AmountFormulaBuilder` pins `effectiveMode` off `targetIsPerArea` and
  holds NO mode state; "Default (all areas)" still RENDERS on a per-area column but is PERMANENTLY
  DISABLED — signage, so the tier stays visible without being editable there. ⚠️ **An override ALWAYS
  beats the default (`pickFormula`), so a default saved while every area is overridden governs NOTHING** —
  it saves, reports success and is dead on arrival. `formulaTokens.storedDefaultFormula` reports such a
  leftover ONLY for a column that actually overrides it (a column with no override is INHERITING, not
  shadowing) and the dialog offers a Remove; the inheriting column SEEDS from the applicable default
  (`inheritedDefault`), so the formula driving a column is never invisible behind the disabled tab.
  ⚠️ `target_col` is a stored GUARD, NOT part of the identity — one axis has ONE default record shared by
  EVERY per-area column on it, so saving a "default" from column I overwrites the one from column H.
- **The operand palette is EVERY operand column the sheet has, minus the trivial self-reference
  (`formulaTokens.buildOperandPalette`, which takes NO mode — refs are always concrete).** A SCALAR
  amount target addresses each per-area column individually — a single area-wildcard chip cannot bind to a
  scalar target, so every row rendered blank while the builder reported "Well-formed". Other AREAS are
  offered too (owner ruling): the cycle check and the dangling-ref gate are the real
  boundaries, not the chip list. ⚠️ **A chip is named by `boqTypes.columnChipLabel` (`E — Quantity · 7f`) —
  the SAME call `PricingGrid`'s header cells and `MarginFormulaBuilder`'s chips render through**, so a chip
  can never name a column differently from the header above it. A role alone is NOT an identity: a sheet
  may map two `qty` columns, and naming both "Quantity" left one of them unreachable.
- **`reconcile.ts` is a PURE LEAF** (imports only types): the SHARED `amountsEqual` epsilon + `resolveDivergence`
  (D1 = DOCUMENT default). It exists so PricingGrid / priceability / pricingRollup share one comparison with NO cycle
  (PricingGrid must NOT import pricingRollup). Divergence fires only on `cell.kind === "value"`.
- **`priceability.ts` is the shared "qty-bearing priceable line" spine** — the ONE definition for flags / the N-of-M
  count / rollup alignment. It imports PricingGrid's leaf predicates; **PricingGrid NEVER imports priceability**
  (receives flags as a prop) — keep this one-way dependency (why `isNonZeroNum` is a self-contained copy in PricingGrid).

### Frozen panes and annotation channels

- **Frozen-left is a TWO-PANE split, gated behind a page-owned `frozen`
  toggle (`PricingGrid` `frozen` prop, default false, wired from `SheetPricingPage`; `split` engages once every row
  height is measured -- frozen pane = the 5 anchor columns, scrolling pane = descriptors + Remarks and owns overflow-x/y,
  mirroring its vertical scroll back to the frozen pane). When `frozen` is OFF (the default) it stays a single
  `table-fixed` + `<colgroup>` table with only a vertically-sticky header (no sticky-left). Widths are GRID-LEVEL
  (never a per-row prop, so the row memo is untouched). Full-screen is an in-app root-`className` toggle (NO portal /
  Dialog -- ONE JSX tree, so the grid never remounts and unsaved drafts + cursor survive).
- **Annotation channels coexist:** system cell BACKGROUND (priced emerald / amber), user color = LEFT BORDER, system
  flags = col-0 GUTTER, focus = ring — never let one channel mask another.

### Category column and classification

- **Classify Category column (CL-2):** a read-only nav column, the FIRST right-pane (scrolling) cell, just past the
  anchors (Category is NOT an extra anchor). Its colIndex follows the per-render anchor algebra in the fan-out bullet
  above: descriptors start at `descriptorColStart = effectiveAnchorCount + 1`, the `+1` being Category. Its leading
  `<col>`/`<th>` go in the scrolling-pane + single-table colgroups, NEVER the frozen/anchor pane. It is driven by a
  reference-stable `categoriesByExcelRow: Map<number, SheetCategoryRow>` (built page-side from the resolved category
  read, see the multi-engine bullet below; ONE identity line in `pricingRowPropsAreEqual`) — the row memo is untouched
  (do NOT hand it a per-row prop that changes on keystroke). The run itself is driven from a screen-scoped socket (`boq:classify_sheet_progress`/`_done`) + `get_classify_status` poll on
  `SheetPricingPage` (the page's FIRST socket), mirroring the BoqHub parse-run pattern. `ClassifySheetDialog.tsx` is the
  engine/scope picker (registry-driven, modeled on CopyForwardDialog's `Set<selected>` + `Record<id,scope>`).
- **Category cell is CLICK-TO-EDIT (CL-3):** click (and Enter on the focused cell) open `CategoryVerdictPicker.tsx` (a
  Radix Popover anchored to the clicked cell via `virtualRef`), with categories GROUPED BY the engine(s) that ran
  (engine-scoped). **Open-state is PAGE-OWNED, keyed by excel_row — NEVER a
  per-row prop.** The row receives only a REFERENCE-STABLE `onCategoryClick(excelRow, cellEl)` callback + a stable
  `categoryLabelById` map (both compared by identity in `pricingRowPropsAreEqual`), so the row memo stays intact — do
  NOT thread an `open`/`selected` boolean through the row props. Click editability: see CL-6 below. The cell shows the human-readable LABEL (`labelFor`, id fallback) + 3 states via `deriveVerdictState`
  (auto / amber needs-review / emerald "your pick" human verdict). Selecting calls `set_row_category` (`""`=clear) with an
  OPTIMISTIC `categoryOverrides` patch folded into the reference-stable `categoriesByExcelRow` map + `mutateCategories`
  reconcile + revert-on-error. Catalog + labels come from the read-only `get_category_catalog(discipline)` endpoint --
  never invent labels client-side.
- **Blank-eligible clickability + amber "needs a category" fill (CL-6):** the click/Enter editability gate is
  `!!onCategoryClick && (isRowEditable(cat) || (isPriceableType(row.node_type) && hasRun))` — an ELIGIBLE
  (Preamble/Line Item) BLANK cell is clickable once the sheet has been classified at least once; a non-eligible ("Other")
  row is NEVER clickable; nothing is clickable on a never-run sheet. `hasRun` is a GRID-LEVEL prop = `categoriesByExcelRow.size > 0` (page passes it; same size>0 truth that
  gates the filter button) — it is DELIBERATELY NOT in `pricingRowPropsAreEqual` (a pure function of the already-compared
  `categoriesByExcelRow`, so it never flips without that map's ref changing). The Category cell shows an amber FILL
  (`bg-amber-50 dark:bg-amber-950/30`, the grid's attention-fill token) exactly when the **ONE shared predicate
  `isMasterSetBlank(row, cat)` = `isPriceableType(row.node_type) && deriveVerdictState(cat) === "unclassified"`**
  (exported from `PricingGrid`) is true — an ELIGIBLE row (Line Item / Preamble) whose category cell is EMPTY
  (`unclassified`: with OR without a record, incl. never-classified no-record rows). The owner ruled amber ==
  master-set-blank, so the fill has no `|| needs_review` disjunct (a resolved review row has a blank effective,
  which already short-circuits to `unclassified`). The fill CLEARS automatically when a
  category is set (effective non-blank → state leaves `unclassified`); do NOT add clearing code. Backend:
  `set_row_category`→`persist.set_human_verdict` UPSERTS (creates a `BoQ Row Category` when none exists) so a verdict on a
  no-record eligible row persists. **The "Check Category" view filter uses the SAME `isMasterSetBlank` predicate, so the
  filter shows EXACTLY what amber shows (owner-locked) — including never-classified eligible rows.** Do not revive the
  retired `isNeedsReviewCategory`: it returned FALSE for a never-classified row, so it cannot surface the rows the
  "empty is empty" gate counts. `isPriceableType` TRIMS `node_type` so the client master set is byte-identical
  to the server's stripped eligible set. Amber and the filter, being one predicate, can never drift.
- **Category-gate VISIBLE half -- the live count, banner + cell gating (ONE predicate).**
  The page derives a LIVE blank COUNT via `PricingGrid.countMasterSetBlankRows(rows, categoriesByExcelRow)`
  -- the SAME `isMasterSetBlank` the amber fill + Check-Category filter use. It
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
  declares the payload keys (`eligible_blank_category_count`, `categories_complete`,
  `category_gate_override`/`_by`/`_at`/`_reason`). **The admin set/clear override control** is
  two contextual buttons IN the banner (SET = `Override the check` -> a reason `Popover`, OPTIONAL reason +
  `N/250` counter, no confirmation; CLEAR = `Remove override`), both gated on the pure exported
  `canAdminOverride(role, userId)` (role-resolved AND admin, MIRRORS `_is_nirmaan_admin` by construction --
  CONVENIENCE ONLY, server authoritative; the `role !== "Loading"` guard prevents a flash). Reason is
  normalised by the pure exported `normalizeOverrideReason` (client cap 250 + blank->null). Banners render
  for everyone; controls are admin-only. Override is TEMPORARY -- every G3b block carries a delete marker
  (removal condition: once classification engines cover all disciplines). **The refusal messages do not say
  "priceable"/"rate-editable"** (those terms stay correct only for the SEPARATE priceability gate). Because the client gate makes rate cells
  read-only, a UI save cannot be ATTEMPTED while locked -- the server save-refusal message is a backstop.
- **Multi-engine category resolution (HV-10, N-GENERIC -- no discipline named in the pathway):** the
  pricing editor reads `get_sheet_categories_resolved(boq, sheet_name)` (NOT the single-discipline
  `get_sheet_categories`, which stays untouched). The SERVER applies a per-ROW ladder across every discipline with current rows: human
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
- **Completion summary = COMBINED EFFECTIVE outcome (HV-10b, owner ruling):** the
  "xx classified, yy flagged for review" message (both the `ClassifyProgressModal` line and the
  post-close toast) reports the COMBINED effective split, NOT a per-engine denominator (a
  last-engine-wins summary shows one engine's numbers for a multi-engine run).
  When ALL running disciplines terminate, `applyClassifyDone` composes the summary from the FRESH
  resolved read (the grid's source of truth, post-`mutateCategories`) via the pure
  `summariseResolvedOutcome(resolvedRows, rangeUnion)`: categorised = effective non-blank (an
  auto-accept OR a human verdict -- so a pre-existing human verdict counts as categorised),
  review = effective blank. It is scoped to the run set's `rangeUnion` (`unionScopes`): a fresh
  run set (each `onStarted`) REPLACES the union (reset semantics); multiple engines fold together
  and **whole-sheet DOMINATES a mixed union**; a run recovered from the poll (unknown scope) or an
  empty scope degrades to whole-sheet. Single-engine whole-sheet with no human verdicts equals the
  engine's own numbers by construction (pinned by test). To carry the range up, `ClassifySheetDialog`'s
  `onStarted` passes `Array<{discipline, scope}>`.
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

### Rate-helper chassis

- **Rate-helper chassis (U1, ALWAYS-ON in production, `rate-helper/`; full detail in the plan doc's "Build slice
  U1"):** the "Suggest rates" button + per-cell badges + the page-level panel that renders a typed helper CONTRACT generically
  (`RateHelper.compute -> Suggestion | NoSuggestion`; the panel has ZERO helper-specific rendering — a new helper is
  a registry edit). Load-bearing invariants: (1) **`RATE_HELPER_ENABLED` is a RUNTIME KILL-SWITCH THAT DEFAULTS ON —
  there is no `import.meta.env.DEV` gate (owner ruling), so the feature SHIPS in a production `vite build`.** It is
  read across `SheetPricingPage.tsx`, directly and through the derived `rmEnabled` / `helperPanelOpen` /
  `embeddedPanel`: the button, the four suggestion SWR fetches, the
  run-adoption / badge-rebuild / selection-prune effects, the status poller, the progress modal, the pre-run
  confirmation dialog, the partial-run resume strip, the per-category config fetchers, the grid badge + tick props
  (`rowSuggestionsByExcelRow`/`onSuggestionBadgeClick`/`tickableRows`/`selectedRows`/`onToggleTick`/`onToggleTicked`),
  and BOTH panel mounts. **They flip together ONLY because they all read the ONE module-load-once const — never
  replace a guard site with its own condition, and never make the const per-call** (memo-shield load-bearing; a
  half-gated set yields half-rendered states, e.g. a button that opens nothing or badges with no panel). The
  localStorage key `nirmaan-rate-helper-off` REMAINS as an emergency off-lever: **PER-BROWSER and PER-USER, effective
  on the next page load, never company-wide** — turning the feature off for everyone is a code change, not a setting.
  `embeddedPanel`'s widening of the embedded pricing editor (`max-w-5xl` -> `w-full`) is therefore PERMANENT and
  INTENDED. **Standing owner rule: no dev-only gates, ever — anything built here must work as-is in production, so
  `import.meta.env.DEV` never gates a feature.**
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
- **Rate-helper `Pricing sheet` helper (RM-3, `pricingSheetHelper.ts`; full detail in the plan doc's "Build slice RM-3"):**
  the helper is a page-built closure over a PERSISTED, version-keyed
  server extraction run that COMPUTES the rate CLIENT-SIDE via the RM-2 `runPipeline` UNCHANGED (the single
  compute source — a rate/param change flows in live with no re-run; only extracted attributes persist). The run
  itself IS persisted (unlike U1's page-session badges): `get_active_suggestion_run` loads it on open with no
  press, and `record_rate_suggestion_event` banks Use telemetry. Load-bearing additions: (a) a PARTIAL in-run row
  still badges via `Suggestion.producibleKinds`; (b) a FAINT always-on opener renders on every rate-editable cell
  WITHOUT a badge (owner: bring up the helper on badge-less cells) — a pure render change, no new row prop, memo
  shield intact; (c) attributes are CATEGORY-SCOPED — a not-in-run row of the helper's category gets a blank
  editable fill (never minting a badge), any OTHER category (or none) gets a "coming soon" NoSuggestion, gated on
  `ctx.category === config.category_id`; (d) `RateHelperPanel`'s
  empty choice attrs carry a `— select —` placeholder so a blank never masquerades as its first option.
- **Rate-helper panel/strip/workings refinements (RM-3a, `RateHelperPanel.tsx` / `SheetPricingPage.tsx` /
  `PricingGrid.tsx` cell-strip; full detail in the plan doc's "Build slice RM-3a"):** three owner-locked
  invariants. (1) **TWO-MODE panel mount** via the `RateHelperPanel` `variant` prop: full-screen uses
  `"push"` (see RM-3c below); `"embedded"` (default) stays IN the flex row, `sticky top-4` so it rides the
  viewport; a scroll-into-view guard fires ONLY when the panel is genuinely off-screen (never yanks a
  sticky-pinned panel, never touches horizontal scroll). (2) **Colour-picker icon is HOVER/FOCUS-ONLY** (owner option (a), an
  action not status): `opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100`, so the
  3 descriptor `<td>`s that host `colorPicker` carry `group`; the priced dot + badge/used-check + sparkle
  opener stay PERSISTENT (strip `gap-0.5`). Colour-selection logic is unchanged (CSS + `group` markers only).
  (3) **GROUPED workings contract (generic, guardrail G3):** `WorkingsSection.sections?: WorkingsGroup[]`
  (`{label, derivation, finals, matchedRows?, attributes?}`) — the panel renders each group as its own block
  with the SHARED extracted attributes ONCE above; **ABSENT `sections` ⇒ flat rendering (single-group
  suggestions stay backward-shaped)**. `pricingSheetHelper` emits two groups
  (`Cable — per Mtr` / `Termination — per Set`) on **EVERY** wiring row (owner ruling). The row TEXT
  (`isTerminationRow`) decides only which block is PRIMARY (whose finals become `values`), never which is
  COMPUTED — letting it pick the pipeline silently discarded the other rate. Groups stay DISPLAY-ONLY (the applied value is
  still `Suggestion.values`). **Memo shield untouched** — no new per-row grid prop,
  `pricingRowPropsAreEqual` unchanged.
  (4) **TWO STACKED HEADLINES (owner Rulings A + C):** `Suggestion.headlines?:
  {label, values}[]` — when a helper sets it the collapsed header renders one line PER ENTRY (label +
  figure, stacked, taller); **ABSENT ⇒ the single headline**, which is what keeps every other
  category identical. ⚠️ **The entries are never summed**: cable is per **Mtr** and termination is per
  **Set**, so a total would apply a per-set rate across a metre quantity.
  Each entry's `combined_rate` is computed WITHIN its own block only. ⚠️ **It must never feed `values`** —
  "Use this value" keeps applying the PRIMARY figure (owner Ruling B), so on a termination-texted row it
  applies the termination rate while the larger cable figure sits visible beside it (owner-parked).
  ⚠️ **`sections.length >= 2` is NOT a usable substitute signal** — cabletray_raceway, db_switchgear,
  industrial_sockets and point_wiring all emit two sections too; only the helper knows its figures are
  different units, which is why the field exists.
  (5) **A PANEL-VISIBLE `map_attribute` TARGET MUST SET `prefer_attr` TO ITSELF** (the
  `cabletray_raceway` `thickness_mm` shape, and the conduit attributes). `applyDerivedDisplay`'s
  STATED branch deliberately publishes NO display value and falls back to the TARGET attribute's own
  extracted value, so the pricer's own entry is shown rather than the pipeline taking credit for it.
  Point `prefer_attr` at a DIFFERENT id and that fallback reads an attribute nothing extracts: the field
  renders **blank while pricing uses a real value** — the attribute-panel invariant broken silently, with
  correct rates, and no test catches it. The different-id form is
  correct ONLY for `panel: false` internals, which is what `industrial_sockets`' `mcb_pole_norm` is.
  ⚠️ **Before adding a `map_attribute` to any config, answer these three.** Prose did not carry; this
  is a CHECK — one config once violated all three and the owner found the result on screen.
  1. **Does the target already have another filler?** If it is ALSO a `derive_attribute` target (or a
     `catalog_fit` / `module_fit` bind), the missing-gate narrowing in `pricingSheetHelper.ts` must
     not withdraw its exemption — it skips `derive_attribute` targets explicitly; missing this made
     previously priced rows refuse outright. ⚠️ A `default` also silences the
     narrowing, but a REAL default silently BECOMES the value (`map_attribute` consults `default`
     before `on_miss`), so it is NOT a safe way to buy the exemption.
  2. **Is the target written MORE THAN ONCE in the chain?** `mapAttributeOutcomes` is LAST-WINS.
     The panel shows the LAST write; make sure that is the effective one.
  3. **Will `derive_attribute` run AFTER it on the same target?** Derive's stated-wins sees the map's
     write, calls it stated, and the display branch then publishes nothing — **the field renders
     BLANK while pricing uses a real number.** The display consults the map's `stated` verdict to
     recover it; a value the PRICER typed must still show as theirs, unmarked.
  ⚠️ **Where none of the above applies:** a panel-visible
  `map_attribute` target with no other filler MUST carry a `default`, because `valueOfDef` reads the
  RAW extraction — null on every row for a pipeline-filled attribute — and without it every such
  row renders "Complete the missing attributes to price".
- **Rate-helper embedded panel-as-default + grid scroll conventions (RM-3b, `RateHelperPanel.tsx` /
  `SheetPricingPage.tsx` / `PricingGrid.tsx`; full detail in the plan doc's "Build slice RM-3b"):** three
  owner-locked layout invariants. (1) **EMBEDDED panel-as-default:** the embedded rate-helper panel is
  ALWAYS MOUNTED (no open/close, NO close X in embedded — the X renders only for `variant="push"`); its
  props `excelRow/col/kind/ctx` are OPTIONAL and absent => an empty-state card. The page derives
  `embeddedPanel = RATE_HELPER_ENABLED && !expanded`; when true the embedded page is PERMANENTLY widened
  (`w-full`) and the flex row is always on. A badge/sparkle click
  SELECTS a row (replacing the previous) via the existing `helperPanel` page state. (2) **FULL-SCREEN sticky
  header + native bottom H-scrollbar (owner-locked):** the two panel-row wrappers between the grid slot and
  the grid container MUST carry `expanded && "flex min-h-0 flex-1 flex-col"` so the flex chain reaches the
  grid container and it BOUNDS to the viewport as the internal scroller — that is what keeps the (already
  `sticky top-0`) header visible AND puts the native H-scrollbar at the viewport bottom, in classic +
  virtualized + frozen split (both panes' headers pixel-aligned). Without it the outer `.fixed.inset-0`
  wrapper scrolls and the header scrolls away — do NOT let those wrappers go empty-class in full-screen.
  (3) **EMBEDDED always-visible H-scrollbar = a SYNCED PROXY bar:** a `sticky bottom-0` thin bar rendered as a
  SIBLING of the scroll container (sized live, see RM-3c (A)), two-way
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
  (`RateHelperPanel` variant `push`; there is no fixed overlay): an IN-FLOW flex sibling of the grid,
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

### Rendering, virtualization and sockets

- **Socket reconnect self-heal must be reconnect-GATED + debounced (T1, owner-verified):** a `socket.on("connect", ...)`
  handler that refetches (`mutate()`/`mutateCategories()`) MUST NOT fire on every connect — the initial mount connect
  double-fetches (the SWR mount fetch already ran) and a flapping dev socket then refetches on every reconnect; each
  refetch re-renders the grid → a continuous idle re-render storm that saturates the main thread. The rule: refetch ONLY on a GENUINE
  reconnect (a `connect` that followed a `disconnect`, tracked via a REF — never state, or the tick itself re-renders)
  and debounce to ≤1 refetch per ~30s (`shouldRefetchOnConnect` pure helper + `RECONNECT_REFETCH_DEBOUNCE_MS`). frappe-react-sdk's
  SWR `revalidateOnReconnect` binds the browser `online` event, NOT the app socket, so socket flapping does NOT hit SWR —
  do not add per-hook `revalidateOnReconnect:false` for socket reasons. (The `PricingGrid` memo below is the
  source-independent defence.)
- **`PricingGrid` is `React.memo`'d (V0/T2) — EVERY prop it receives MUST stay identity-stable, or the shield silently dies.**
  A page-level re-render with unchanged grid inputs bails at the memo instead of re-executing the whole grid body +
  `pricingRowPropsAreEqual` across all rows. This holds ONLY because `SheetPricingPage` keeps every grid prop referentially
  stable: the grid handlers (`handleSaveRate`/`Remark`/`Color`/`ReconChoice`/`Formula`, `handleBatchWrite`, `handleDirtyChange`
  + the transitive `ensureLockAcquired`) are `useCallback`, and the derived collections (`rows`, `rowFlags`, `byRowIndex`,
  `childrenByParent`, `displayRows`) are `useMemo`. **`rows` is the linchpin:** `mergeRowsPreservingIdentity` returns a fresh
  array every render, so `rows` MUST be `useMemo`'d (keyed on `rawRows`) or the grid's `rows` prop churns and the memo never
  bails. Any NEW grid prop must be `useCallback`/`useMemo`/stable-per-fetch; a new plain-const handler or `new Map()`/`?? []`
  passed to the grid re-defeats the memo with no error. **The three loading/`!boq`/`!sheetName` guards render as branches of the
  SINGLE `return` (NOT early returns)** so all derived state stays hook-legal — do not reintroduce an early return above the
  derived-state region (it makes the memoization illegal). Verify with React DevTools Profiler ("Why did this render?").
- **Virtualized windowing (V1) — ONE virtualizer drives BOTH panes; classic path retained behind the A/B toggle.** The grid
  windows rows via `@tanstack/react-virtual` when the page-owned `virtualized` prop is true (default ON, session-scoped); false =
  the CLASSIC full render, **byte-identical to the pre-virtualization grid** (the `PricingGrid` tests certify it). ONE `useVirtualizer` instance is
  the row-window authority for both panes: `getScrollElement` = `scrollPaneRef` (two-pane) / `containerRef` (single); both
  `<tbody>`s render the SAME `getVirtualItems()` slice + identical `deriveSpacers` spacer `<tr>`s (never two synced virtualizers).
  The render decision is `twoPane = selectRenderPath(...) === "twoPane"` (classic gates on `split`, virtualized on `frozen`); only
  the `<tbody>` content changes (via `renderTbody`) — the pane/table JSX is shared. **Pane alignment = MAX-of-both-panes height:
  NEVER assume which pane is taller.** The freeze layout puts the wrapping **Description** in the FROZEN pane (through
  the 5 anchors), so measuring only the scrolling pane truncates + mis-aligns. The custom `measureElement` reads BOTH panes' rows
  by `data-index` and feeds `ceil(max(paneNaturalHeight(frozen), paneNaturalHeight(scroll)))` to the ONE size cache; both panes get
  that size as the `<tr>` height (a table MIN) → the taller reaches content, the shorter pads → aligned, no truncation. **`paneNaturalHeight`
  MUST measure the `<tr>`'s TRUE box (`Math.ceil(tr.getBoundingClientRect().height)`, row border INCLUDED) — this is what makes both
  panes match CLASSIC, which applies `ceil(single-table box)` to both.** The `<tr>` box is SELF-CORRECTING (`max(content,
  applied)`, a fixpoint) so it does NOT run away — do NOT revert to the old content-wrapper sum (it omitted the ~1px border → ~1px/row
  drift at every DPR) and do NOT add the border to a content-wrapper measure (a stretching scrolling cell feeds it back = runaway).
  `clipDescription` is OFF for auto virtualized rows, ON for classic + manual-drag rows. TanStack observes only the LAST element per
  index (verified) → a frozen-only reflow (column-resize Description re-wrap; scrolling `<tr>` unchanged → ResizeObserver silent) is
  covered by a **two-phase drag-END reset** (`remeasureVirtualRowsAfterResize`: `measure()` to clear sticky sizes, then a
  `resizeSettleTick`-keyed `useLayoutEffect` re-invokes `measureElement` on the mounted rows POST-commit — never streaming, no
  thrash). `measure()` alone is NOT enough (it clears but never re-reads the frozen twin; a shrunk row's min-height stays sticky).
  Sub-pixel residual drift at fractional display DPR / browser zoom is expected (two separate `border-collapse` tables).
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

### BCS cost block

- **BCS -- the INTERNAL cost block inside the pricing editor** (`bcsColumns.ts` pure leaf + `bcsRollup.ts` +
  `marginView.ts` + `BcsColumnsDialog.tsx` + `MarginRangeFilter.tsx`; the block itself renders inside
  `PricingGrid`/`SummaryPanel`, no new route). Full frontend as-built in `frontend/.claude/context/domain/boq-frontend.md`; storage, endpoints and the
  carry layer in `.claude/context/domain/boq-backend.md`. ⚠️ **NAME COLLISION: "BCS" in the Rate Master section
  below is a derivation pipeline -- an unrelated concept sharing three letters.** The acronym is never expanded
  anywhere in the codebase; do not invent an expansion. The load-bearing invariants:
  - **WHICH cost boxes a sheet gets is derived from the sheet's OWN rate columns** (`bcsLiveRateKinds`, owner
    ruling): no Supply rate column -> no Supply box; a combined-rate sheet gets ONE box; no rate column at all ->
    no block. ⚠️ **The halves win over a combined rate mapped beside them.** The backend forbids summing
    `combined_rate` with the two halves, so the live set must never hold both or the total double-counts -- which
    makes the prohibition **STRUCTURAL**: the arithmetic downstream cannot express the forbidden sum, because the
    set it is given never contains both. A NARROWING, never a widening.
  - **Column headers are an owner ruling, pinned by test:** `BCS Cost (Supply)` · `BCS Cost (Installation)` ·
    `BCS Total Amount`. The prefix marks which side of the sheet a figure belongs to (BCS = what it costs US;
    everything else = what we charge the CLIENT), which matters because the two blocks scroll apart on a wide
    sheet. The mirror to the parser's `Rate (Install)` role label is deliberately NOT word-for-word -- do not
    shorten `Installation` back to match it.
  - **The block is four columns (owner ruling):** the two cost boxes · `BCS Total Amount` ·
    `% Margin`. ⚠️ **There is no `Tendered Total Amount` column -- but ONLY the column was removed.
    `bcsRowAmount` / `bcsTenderedAmountCell` / `BcsSectionTotals.tendered` still
    compute it, because it is the margin's DIVISOR; deleting them blanks every % Margin on every sheet.**
    Cost: the denominator is not verifiable by eye. ⚠️ `isBcsInputColumn` answers "is this NOT a
    computed kind?", so REMOVING a token from `BCS_COMPUTED_KINDS` makes it **typeable**, not inert --
    anything dropped from that list must leave the `BcsComputedKind` union in the SAME edit.
  - **`% Margin` (formerly `% Profit`) -- a rename, not a maths change.** The owner's
    `(1 − BCS/BOQ) × 100` and the implemented `((amount − cost) / amount) × 100` are the same expression
    rearranged; the identity is pinned by test. ⚠️ That test ALSO pins the misread grouping as WRONG:
    `1 − (c/a) × 100` returns **−59** where the answer is **+40**. Do not "implement the owner's formula
    literally". `bcsMarginPercent`'s guards (zero denominator, NEGATIVE denominator, non-finite) are
    load-bearing -- rewriting it into the `1 − c/a` shape would compute the same thing while risking them.
  - **`% Margin` has its own ƒ too, and it is ONE dialog with TWO slots** --
    `MarginFormulaBuilder`, rendering `( 1 − COST ÷ AMOUNT ) × 100` with both operands live inside
    it. ⚠️ Never split it into two badges (owner rejected that): they are two halves of one rule, and
    splitting them makes the rule invisible. **The wrapper is rendered, NOT editable,
    and that is STRUCTURAL** -- `1` and `100` are numeric literals, which this system has no token
    for and the server rejects; keeping it in code is also what keeps `bcsMarginPercent`'s guards
    (zero / non-finite / NEGATIVE denominator, the last of which would show a loss as +150%)
    unbypassable. Targets `bcs_margin_cost` + `boq_total`; `rollBcsSections` takes a per-row
    `ownTendered` override so the Summary panel follows a formula too. ⚠️ **Total Quantity must
    stay reachable from the COST side** -- BCS Total is a ROW total while the cost boxes are
    PER-UNIT rates, so without it the only reachable formula was dimensionally wrong.
  - **The chip-naming rule: a palette chip must read EXACTLY as its column reads in the grid.**
    (Past breaks: `Amount (Total)`, a ROLE label; `BCS Total` vs the header's `BCS Total Amount`.) Sheet-column chips carry the **Excel letter**
    (`G — Amount (Supply)`) -- the one label both surfaces share; BCS chips carry none, because
    they have no Excel column and that absence is meaningful. **A chip nobody can locate in the
    grid reads as a figure that does not exist.**
  - **The % Margin column header OWNS the margin view controls (owner ruling).**
    Layout is `[ƒ] % Margin [↑↓] [▼funnel]`. ⚠️ **The old separate flat "margin VIEW" is deleted** (with
    its toolbar toggle, header-as-sort-control and `buildSectionLabels`). Do not rebuild it; a ranked
    overview is a rebuild, not an un-deletion.
    - **The RANGE is a TERM of `passesViewFilter`, never a separate pass** -- so it ANDs with
      Show-unpriced / Check-Category / the row-type toggles for free and search inherits it. The
      **SORT** is the one genuine stage after it (ordering cannot be a predicate).
    - **Both are SNAPSHOTS measured over the WHOLE sheet (`rowsRef.current`), never `displayRows`.**
      A range measured over the filtered set narrows irreversibly on each Apply; a rank built over it
      leaves later re-admitted rows unranked in the appended tail. Recomputed on an explicit
      Apply/arrow click ONLY -- `activeCell` is array-index addressed, so a live re-derivation would
      slide a different row under the cursor mid-keystroke.
    - ⚠️ **Membership is the margin, never `node_type`.** A line-items-only rule (the old
      `isMarginViewRow`) cannot survive either half: the grid renders % Margin on every row
      that has one, so a qty-bearing Preamble showing 15% would vanish from a 10-25% filter beside
      line items that stayed; and `marginSortRows`' output IS the grid's row set, so an unranked row
      silently disappears from the sheet. Rows with no margin are already excluded by `marginInRange`.
    - **Only the SORT suppresses tree claims** (flat depths, withheld `childrenByParent`, suspended
      collapse) -- a filter merely drops rows, so a survivor's ancestry and chevron stay true. The
      arrow is THREE-state (`off → asc → desc → off`); **off must stay reachable**, or the suppressed
      hierarchy has no way back.
    - ⚠️ **A control that can hide itself needs an escape hatch.** `PricingGrid`'s `rows.length === 0`
      early return fires BEFORE the header, so a range matching nothing removes the only control that
      could clear it. The empty state must therefore tell "empty sheet" from "your filters emptied it",
      name the applied range **without blaming it** (filters compose -- claiming "nothing has a margin
      in that band" may be false), and offer **Clear filters** resetting EVERY view filter. It must
      stay an early return INSIDE the grid: lifting it into the page unmounts `PricingGrid` and
      discards the unsaved drafts held in its state.
  - **The BCS dialog is ONLY a switch:** on/off + Cancel; no column pickers.
    ⚠️ **Readiness is `bcs_enabled` alone, and the two facts are inseparable** --
    re-adding the confirmation requirement without the pickers makes BCS switch on and stay
    permanently read-only. There is no ribbon chip or "BCS needs columns" banner (a banner that cannot
    fire is worse than none), and enabling does not open the card.
  - **`BCS Total Amount` is an EDITABLE FORMULA (green ƒ on its header).** Stored in the EXISTING
    `BoQ Cell Amount Formula` as `target_value_field = "bcs_total"` (no schema of its own), riding the
    `column_formulas` payload + `onSaveFormula`. **`bcsColumns.bcsTotalCell` is the ONE function that answers
    "this row's BCS total"** -- the rule is per-sheet DATA, so a second copy would show different numbers in
    the grid and the Summary panel. Absent formula ⇒ the built-in `(cost boxes) × quantity`. The operand vocabulary (`bcs_supply` / `bcs_install`
    / `bcs_combined` / `bcs_qty`) is DISJOINT from the sheet's columns; the palette derives from
    `bcsLiveRateKinds`, so it can never offer a box the sheet lacks. ⚠️ **The builder's palette group
    headings must stay DERIVED (`paletteGroupOrder`), never a fixed list** -- a hardcoded
    `["Quantity","Rate","Amount"]` silently drops the BCS cost chips at render with no error and no empty
    state.
  - **A BLANK IS NEVER A 0, and every blank knows WHY** (`BcsComputedCell` = value | blank+reason, surfaced as the
    cell `title`). A `0` is a claim ("this costs nothing"); an absence is not. An unrecognised reason renders as an
    explicit UNSUPPORTED state, never a silent blank. **% Margin is never NaN, never Infinity, and never a
    profit on a loss** -- a NEGATIVE denominator flips the inequality (amount -100 vs cost 50 computes +150%), so
    a loss-making row would display positive profit: confidently wrong, which is worse than visibly absent. It is
    a **blank with a reason, not a blocked keystroke** (do not convert it into a validation); the COST side is
    deliberately unguarded, since only the denominator's sign inverts the comparison.
  - ⚠️ **`mergeBcsRowValues` takes a `ReadonlyMap` ON PURPOSE -- never "simplify" it to an object.** The grid's cost
    drafts are keyed `` `${row_index}:${field}` `` while the merge reads BARE field keys; as plain objects the two
    are structurally assignable, so passing the wrong key space COMPILES CLEANLY, finds nothing, and reverts a
    controlled cost input on every keystroke while the debounce saves a number nobody typed. A `Record` is not
    assignable to a `Map`, so the mistake is a compile error.
  - **The `bcs_costs` carry layer defaults OFF, and the default lives ONLY in the client** -- an omitted `layers`
    payload is rates-only server-side. ON is the exception, not the rule, and an internal cost rate is the last
    layer on which to relax "nothing arrives un-asked-for".


### Filters, selection and Suggest rates

- **Header column filters + the Row Type label (UI slice, owner-locked).** The pricing grid's Row Type
  and Category headers each carry a funnel (`boq-wizard/GridColumnFilter.tsx`) opening a type-to-search
  checkbox popover. Load-bearing invariants:
  - **Filter state is page-level and acts on the row set, never on a row.** It is a clause in
    `SheetPricingPage.passesViewFilter`. The grid gets only the option list, the current selection and a
    callback -- PER-GRID props, NONE in
    `pricingRowPropsAreEqual`. **The popover's type-to-search box is LOCAL to the popover and must never
    be lifted to the page**; that is what keeps a keystroke from re-rendering the grid. The
    module-level `EMPTY_FILTER_SET` / `EMPTY_FILTER_OPTIONS` destructuring defaults exist so a default
    cannot mint a new identity per render and defeat the `PricingGrid` memo -- do not inline `new Set()`.
  - **FILTER ON THE LABEL, MATCH ON THE ID.** An option is `{id, label}`: display/sort/search use the
    label (agreeing with the Category cell's `labelFor`), the predicate compares ids. Selections are
    ALWAYS sets of ids, so editing a catalog label cannot silently break a live filter.
  - **`isMasterSetBlank` is THE single blank predicate and drives FIVE surfaces** -- the server
    gate/count, the grid's amber Category fill, the Check-Category view filter, the page's live blank
    count, and the Category filter's **"(Blanks)"** entry. Never write a sixth definition. AND across
    columns, OR within a column.
  - **The funnel trigger's `h-4` + `leading-none` is LOAD-BEARING, not styling.** In FROZEN (two-pane)
    mode the Row Type header lives in the frozen table and Category in the scrolling table; an
    unpinned trigger height let the active-state count badge grow the frozen header row, offsetting
    that pane's body so the two grids visibly stopped lining up. Any affordance added to a header cell
    in EITHER pane must be height-neutral across all of its states.
  - **`GridColumnFilter` deliberately DUPLICATES `RateMasterDataViewer`'s `ColumnFilter` rather than
    importing it** (owner ruling): exporting would couple two independent modules, and the two already
    diverge. Do not "de-duplicate" them.
- **A completion message reports what ran, never the population (owner-locked).** The suggest-run
  modal must not read `summary.results.length` — the whole DOCUMENT (carried + newly extracted) — or a
  scoped run announces the population and a partial run reads as a full one. The pass's own scope
  rides the terminal payload; the message is built by a PURE, unit-pinned function so each run
  shape's wording is testable without spending an AI call. **"carried forward unchanged" and "not
  reached" are NEVER folded together** — they mean different things to someone deciding what to
  check — and a count that does not apply is OMITTED, never printed as zero. Where the payload
  cannot support a split, the message says what IS known rather than inventing a number — that is
  the fallback, not the target. **The count a message needs must come from the pass, not the
  document:** a run document accumulates carried rows, so a document-level "attempted" figure
  answers "what does this document hold", never "what did this pass do", and subtracting it from
  the population reads as zero-missed exactly when rows were left unfinished. Where both numbers
  exist, take the per-pass one and derive carried-forward and not-reached from it. **Never name a
  single category in this message** — the population spans many.
- **View filters compose in exactly one place and always AND (owner-locked).** Every view filter is
  a clause in `SheetPricingPage.passesViewFilter` — never a second pipeline. **A new clause must
  ALSO be added to `anyViewFilter`**, because `displayRows` has a `!anyViewFilter` FAST PATH that
  returns the unfiltered rows: a clause added without it compiles, passes its unit tests, and
  silently does nothing. Its inputs must join the `displayRows` dependency array for the same
  reason. **An EMPTY selection is a PASS-THROUGH, never "hide everything".**
- **A filter must never hide every row without saying why.** The ticked-rows toggle carries BOTH
  guards deliberately: the predicate passes everything through when nothing is ticked, AND the
  control is DISABLED with a tooltip saying what to do first. The accidental state (untick the last
  row while filtered) therefore restores the full sheet instead of emptying the grid.
- **The ticked-rows filter is a toggle, not a value list, and it reads the selection set.**
  `GridColumnFilter` is built entirely around distinct-VALUE lists (options array, `Set<string>`,
  type-to-search, membership matching); a thousand row numbers would be a useless list, and bending
  it would put a search box over two pseudo-options and express a boolean as a set of sentinels. The
  toggle READS the page's ONE selection set and never duplicates it — which is also what makes
  unticking while filtered drop the row immediately, with no special case. Only the toggle's own
  pressed state reaches the grid, and it stays OUT of `pricingRowPropsAreEqual`.
- **The tick box follows the run's eligibility, never the badge set (owner-locked).** FOUR
  definitions of "eligible" live in this screen and they disagree: the priceable MASTER SET
  (`isPriceableType`), priceability's priceable LINE (qty in a rate-column area), the RATE-EDITABLE
  set the badges and the faint opener render on (`isRateEditableRow`), and the suggest RUN's own
  population (`assemble_population` — rate-editable AND a non-blank resolved category AND that
  category having an eligible rate config). **The set is surfaced BY THE SERVER**
  (`get_active_suggestion_run().eligible_rows`) and must never be re-derived client-side: a copy
  would be a FIFTH definition, free to drift, and the drift presents as ticks the run silently
  ignores. Ticking on the badge set would offer rows the run drops.
- **Selection state is page-level and only booleans reach the memoized row.** The row receives
  `tickable` + `selected` (per-row booleans, compared by value in `pricingRowPropsAreEqual`) plus a
  reference-stable `onToggleTick` — **never the selection Set and NEVER a count**; a count changes
  on every tick and would re-render every row. This is the `openRemark` shape. The COUNT the
  confirmation quotes stays page-local and is never passed down. Selection is keyed by the DURABLE
  `source_row_number`, never the window array index (virtualized recycling remaps indices), and it
  is per-sheet + session-only.
- **The "Suggest rates" button is repurposed, not duplicated, and always confirms before an AI
  call.** Ticks present -> run those; none -> the whole sheet. **The whole-sheet WORDING is the
  product, more than the count**: it must warn that re-running OVERWRITES rows that are already
  correct and point at the tick alternative, and its action renders DESTRUCTIVELY so a stray click
  cannot launch a full re-extraction. The copy lives in the pure `suggestConfirmCopy` so both
  branches are unit-testable; the selected-row branch carries NO warning because it has no such
  consequence.
- **Matching a stated value to a dropdown option must never discard meaning the pricer reads (layers, compositions); option matching runs only on values the pricer would read the same way** (12d-6, owner-locked: `computeItemList` skips `matchStatedToOption` for any value `readLayers` accepts -- the panel used to hand the pricer the option "19" for a model-read "Double layer of 19 mm" and price one layer).
- **Rate-helper panel + Rate Master attribute semantics:** every invariant moved to `frontend/.claude/context/domain/pricing-rate-master-frontend.md` -- load it before any rate-helper work.

## Where the full component contracts live

The FULL per-slice component contracts (keyboard-nav matrix, the row-memo anti-defeat rule, the formula engine F1–F4, reconciliation, collapse/expand, lock/unlock, the two-ribbon toolbar, search/column-hide, export/download, review-screen render contracts, etc.) live in **`frontend/.claude/context/domain/boq-frontend.md`**. Load it before pricing-editor / review-screen frontend work.
