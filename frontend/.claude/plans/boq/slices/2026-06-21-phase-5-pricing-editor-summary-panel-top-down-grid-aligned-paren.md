### Phase 5 Pricing Editor -- Summary panel -- top-down grid-aligned parent-tree amount rollups (+display revisions) (FRONTEND, feat pending, 2026-06-21)

**Goal.** An Excel-pivot-style SUMMARY over the pricing editor: parent-tree amount rollups, computed PAGE-SIDE from data
already fetched for the grid (rows + columnDescriptors from get_priced_rows) -- NO backend, NO migrate. ROWS = nodes in
the committed parent tree (collapsible; expansion depth = aggregation level); COLUMNS = the sheet's own amount-column
structure; VALUES = each amount column summed over the node's descendants.

**`pricingRollup.ts` (NEW) -- the pure math (SIBLING module, NOT added to PricingGrid.tsx so the certified grid + its
tests stay untouched; one-way import of the grid's helpers, no cycle).** `rollupByParent(rows, columnDescriptors) ->
{columns, roots}` with co-located view types `RollupColumn`/`RollupNode`/`RollupResult` (boqTypes.ts NOT touched).

**THE SUMMING RULE (locked).** Per-row amount = `computeAmount(qty, pairedRate)` REUSING the EXISTING PricingGrid helpers
(`computeAmount` / `findPairedRateDescriptor` / the `PER_AREA_AMOUNT_TO_RATE_KIND` / `SCALAR_AMOUNT_TO_RATE_FIELD` maps)
+ the qty source. A row contributes its OWN amount **by AMOUNT-PRESENCE** (the paired rate yields a number); a missing
pairing / missing rate yields null -> contributes nothing. **node_type is NOT on the delivered committed row, so the
priceability gate is expressed as amount-presence, not a type check.** A priced PREAMBLE carries an amount for its OWN
ROW only -- never a sum of children: `node.totals = own + sum(children rolled totals)` (own amount added exactly once, no
double-count). Each amount descriptor rolls up INDEPENDENTLY column-by-column -- NO merging per-area + scalar surfaces,
NO derived totals. **Cycle-safe:** parent tree inverts `effective_parent_index` (reusing `computeDepths`' memo+cycle
guard) + an in-progress recursion guard + a DFS path-set guard; roots = parent null/negative/self/absent.

**`SummaryPanel.tsx` (NEW) -- TOP-DOWN, not a side drawer.** A `<section>` opened ABOVE the grid by the header "Summary"
toggle, full-width, `max-h-[40vh]` with internal scroll (never pushes the grid off-screen). Collapsible tree uses a flat
`collapsed` Set + visibility flatten (the ReviewTree table-tree idiom), NOT the Collapsible primitive (invalid table
markup). The discarded side-drawer / shadcn `Sheet` shell was removed.

**Display revisions (2026-06-21, after owner live-test -- changes only what is SHOWN, not what is SUMMED; the math
`rollupByParent` + its 7 tests UNCHANGED).** (1) Columns = Description + AMOUNT only (renders `rollup.columns` directly,
no blank spacer columns; grid alignment dropped as a goal). (2) Rows = Preamble + Line Item only -- a render-time filter
in `flatten` on `node.classification ∈ {"preamble","line_item"}` (DISPLAY-ONLY; totals unchanged; non-priceable types
are structural leaves so the filter never disconnects the tree). (3) Expand/Collapse-all toggle + default = shallowest
preamble tier via two NEW pure helpers `minPreambleDepth(roots)` + `defaultCollapsedSet(roots)`. (4) Description = fixed
`w-[320px]` + wrap.

**Tests + verification.** `pricingRollup.test.ts` (NEW) +7 (five real committed shapes + 2 negatives: per-area
symmetric; asymmetric per-area not normalized; scalar single-total; VRF full per-area + scalar split 9 cols independent
no double-count; priced-preamble own amount counted ONCE; cycle terminates; blank/un-priced contribute zero) -> later
**46 -> 50** (+4 default-tier display tests). Vitest **39 -> 46 -> 50 GREEN**; tsc 3178, 0 in touched; Vite build exit 0
(PWA 166). (See frontend CLAUDE.md `**Status (... Summary Panel ...)**` + the DISPLAY REVISIONS block.)

