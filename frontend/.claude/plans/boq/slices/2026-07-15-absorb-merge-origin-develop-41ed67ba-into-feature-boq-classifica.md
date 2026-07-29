### Absorb -- merge origin/develop 41ed67ba into feature/boq-classification-eval (merge commit 56b5cf85, base tip d545270f, merge-base dd60cc36, 2026-07-15)

**What came in (63 files, +3582/-1017):** the MC PR merge ca9af2c9 -- the multi-column-description arc (parser /
wizard / review + MC-5 pricing-grid fan-out with `anchorWidthKeys` Option-1 freeze + the `description_parts_raw` JSON-field
migrates on `BOQ Nodes` + `BoQ Review Row`); the prod-outage IN-list fix pair 20ab3bf9 + 310363e2 (bound/chunk unbounded
SQL `IN`-lists against the sqlparse 10k-token cap) + its docs 8ca5d9eb (`HANDOFF-sqlparse-in-list-token-limit-fix.md`);
and the MC follow-up 41ed67ba (re-serialize `description_parts_raw` on review-row edit save).

**Conflicts -- `PricingGrid.tsx` ONLY (4 hunks; every other file auto-merged clean, incl. `boqTypes.ts`, `ReviewTree.tsx`,
all 3 CLAUDE.md/plan docs):**
- **(1) import union** -- kept BOTH `useVirtualizer` (our V1) and `import type { DescriptionColumn }` (develop MC-5).
- **(2) Description-cell render** -- took develop's MC-5 **fan-out** structure wholesale (`fanOut ? descriptionColumns.map(...)
  : legacy single anchor`, both via the shared `DescriptionAnchorInner`; the row body is shared by the classic AND
  virtualized paths) AND threaded our V1 **`clipDescription`** gate through it -- added the param to `DescriptionAnchorInner`
  (clip only when `rowHeight != null && clipDescription`), to the non-first fan-out cell, and to both call sites. Rationale:
  MC's fan-out must render in both paths, but an AUTO virtualized row must render Description NATURAL (never clipped) or the
  FIX-2 max-of-both-panes measure loses its height authority and descriptions truncate.
- **(3) Category-column body** -- `colIndex = effectiveAnchorCount` (develop's PARAMETRIC anchor count, MC-5 -- fan-out
  columns shift the boundary) + `cat = category` (our P1 per-row prop, NOT `categoriesByExcelRow.get(row.source_row_number)`
  -- a whole-Map lookup inside the memoized row defeats the row memo, a load-bearing invariant). Both plumbing paths already
  survived the auto-merge into the props interface + comparator + `renderRow`.
- **(4) `focusCell`** -- kept our V2 `doFocus` closure (the common post-conflict region closes it and calls it via
  `resolveJumpAction`) and swapped `FIXED_ANCHOR_COUNT` -> develop's `effectiveAnchorCount` (MC-5).
- **PLUS one auto-merged live-geometry parameterization (outside the conflict hunks, within the mandated "both intents
  function" scope):** the V1 virtualizer spacer `paneColSpan(pane, FIXED_ANCHOR_COUNT, ...)` -- our construct develop never
  saw -> `effectiveAnchorCount`, so the spacer `<tr>` spans every frozen-pane column under MC-5 fan-out. The remaining
  `FIXED_ANCHOR_COUNT` refs are the const definitions + comments only (per the "never read for live geometry" invariant).

**patches.txt reconciliation:** develop does NOT touch `nirmaan_stack/patches.txt` (empty merge-base->develop diff), so the
merge left it untouched and the PRE-MERGE stash path never triggered. The standing local modification -- a DELETION of
`nirmaan_stack.patches.v3_0.backfill_cashflow_gap_limited #v4` -- is pre-existing working-tree noise, NOT staged, NOT part of
the merge. No decision required (it is a local removal predating this session, not a real local entry the merge lacks).

**Gates (merged state, bench-verified fresh -- a code state nobody had run):**
- `bench migrate` clean; `description_parts_raw` column verified True on `BOQ Nodes` + `BoQ Review Row`. Workers restart not
  needed for the test suites (each spawns its own process); the live alignment gate ran against the mounted merged code.
- **Backend -- OUR suites hold:** test_classify **38**, test_row_category **26**, test_truth_snapshot **5**. **MC-shared new
  baselines:** test_review_screen 247 -> **250**, test_pricing 176 -> **185**, test_parse_run **102**, test_sheet_preview
  **32**, test_commit_pipeline **54**. **MC parser suites:** test_classifier **135**, test_hierarchy **65**, test_orchestrator
  **78**, test_config **34**.
- **PRE-EXISTING FAILURE (merge-INDEPENDENT, NOT auto-fixed):** `test_update_sheet_draft` `TestMigrateWorkPackageToMulti`
  3 errors -- `setUp` raw-SQL writes to the `work_package` column that our earlier multi-WP migration DROPPED
  (`has_column("BoQ Sheet Draft","work_package")` = False). The test file is BYTE-IDENTICAL pre/post merge; develop touches
  neither the `BoQ Sheet Draft` schema nor its `work_package` field (develop's only `work_package` refs are the unrelated
  `Procurement Requests` field in the IN-list fix); it fails identically on pre-merge tip d545270f. Stale-migration test, not
  a merge regression.
- **Frontend:** wizard-scoped `tsc` **0** errors; vitest 507 -> **532** (PricingGrid **143** green + byte-identical classic
  path, reviewRender **25**); `yarn build` OK.
- **ALIGNMENT GATE (Chrome DevTools MCP, BOQ-26-00043 / sheet Toilet / BQSH-26-00566; Fast render ON + Freeze columns ON;
  destaled -- Vite already up, SW unregistered).** This committed sheet renders the LEGACY single-description path
  (`fanOut=[]`; `get_priced_rows` surfaces no description parts to the pricing grid) -- which is the branch our resolution
  most heavily modified (`DescriptionAnchorInner` + the `clipDescription` gate). **FIX-2:** per-row frozen-vs-scrolling
  top-edge delta = **0px** across 3 scroll depths (window firstIdx 0 -> 0 -> re-windowed **59-88**, each incl. heavily
  wrapped rows in the frozen pane), zero rows >1px, **zero truncated descriptions**. Confirmed programmatic `scrollTop`
  does NOT re-window (V1/V2 trait) -- real wheel events used. **V2-FIX:** remark popover opened on row 59, real-wheel
  scrolled off the top -> popover CLOSED (no `[data-radix-popper-content-wrapper]`, no ghost textarea, trigger unmounted).
  Live MC-5 FAN-OUT path not exercised (no committed sheet on the dev DB surfaces description parts to the pricing grid) --
  covered instead by vitest reviewRender 25 + PricingGrid 143 (both test fan-out AND legacy) + `tsc` + the hunk-by-hunk
  resolution.

**Scope:** the merge commit is the resolution ONLY (PricingGrid.tsx hunks + auto-merged develop changes). NOT staged /
NOT committed: `.claude/settings.local.json` + `patches.txt` (standing noise), `synthetic_*.xlsx` fixtures (re-saved by the
parser test runs this session), build artifacts under `public/frontend` + `www/` (gitignored). NOT pushed (per spec).


