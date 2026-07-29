## Pricing editor -- Build slice HV-10 (MULTI-ENGINE per-row resolution + grouped picker) COMPLETE

**Commits:** `76a41050` (feat) + this docs commit. Branch `feature/boq-classification-eval`, base
tip `120cd3c6`. Fixes the HV-9-era defect: the pricing editor was hardcoded to
`discipline="Electrical"` in NINE sites, so an HVAC sheet showed blank Category cells and the
classify modal stuck at "preparing rows" (its done/progress/status filters discarded HVAC events).

### The owner-locked design, as shipped

- **Per-ROW resolution, SERVER-SIDE**, in the new `get_sheet_categories_resolved(boq, sheet_name)`
  ladder: (1) human verdict wins -- most-recent (`human_verdict_at`) between disciplines, ties on
  discipline name (deterministic, not hardcoded); (2) auto-accepted beats needs-review; (3) multiple
  auto-accepts -> higher `ai_confidence` wins + `cross_engine_conflict=true`; (4) all review -> BLANK
  (blank-review law). ONE index-covered query across all disciplines (the composite index leads with
  boq/sheet/cv, so dropping the discipline filter is covered -- recon 0.4 ms), grouped per excel_row.
- **`cross_engine_conflict` is TELEMETRY-ONLY** -- computed at read time, NEVER persisted, NEVER
  rendered (owner ruling, same class as `review_priority`). The frontend adapter drops it so it can
  never reach a rendered surface.
- **Picker** shows one discipline-labelled group per engine with current rows; single-engine sheets
  look flat as today. **A human pick CARRIES its group's discipline**; the write lands on that
  engine's row identity (upsert-on-missing mints it -- CL-6). "Clear verdict" targets the row's
  resolved human discipline.
- **N-ENGINE GENERIC**: no discipline is named anywhere in the pathway (grep-proof at commit); a
  synthetic "Plumbing" engine flows through the whole resolved read + the tests with ZERO code
  changes. A future engine flipping `available` in the registry inherits this for free.

### The two-endpoint read model (the freeze-preservation decision)

`get_sheet_categories` (single-discipline) is **BYTE-UNTOUCHED** -- `freeze_classification` (line 497)
and `get_freeze_summary` (600) still call it positionally with one discipline. The pricing editor
consumes the NEW merged `get_sheet_categories_resolved` instead. This was the top recon risk (a
shared-endpoint shape change would silently break Freeze); a regression test pins the old shape.
**The write path is unchanged** -- `set_row_category` already validates the discipline vocabulary
(an `hvac_` id sent as Electrical THROWS, never corrupts) and upserts; HV-10 only makes the frontend
send the right discipline.

### Frontend (the nine sites + memo safety)

`CLASSIFY_DISCIPLINE` deleted. The grid consumes adapted rows via the PURE `resolvedToSheetCategoryRow`
so `PricingGrid` + `deriveVerdictState` + `isNeedsReviewCategory` render UNCHANGED (no new visual
states; blank rows still show blank + amber). One `get_category_catalog` per ran-discipline +
`list_engines` labels feed `buildSheetEngineCatalogs`. Socket done/progress filters became MEMBERSHIP
in (ran UNION running); status polling is PER-RUNNING-DISCIPLINE (one `ClassifyStatusPoller` each --
single-engine = today's single poll), so the modal completes when all running disciplines terminate
(the stuck-modal fix). `onStarted(disciplines)` is captured. **The hook-safe N-dynamic
fetch/poll uses child `EngineCatalogFetcher` / `ClassifyStatusPoller` components** (one hook each,
stable order). Every new page input is `useMemo`/`useCallback` stable so the `PricingGrid`
`React.memo` shield holds. New pure helpers: `sheetCategoryResolve.ts` (adapter + membership +
running-set + group builder), unit-tested in `sheetCategoryResolve.test.ts`.

### Tests + baselines (in-container, bench-verified)

- Backend `test_classify.py` **40 -> 54 (+14)**: the ladder pure-grid (single-discipline == today;
  human-beats-auto; most-recent-human; two-auto conflict + higher-confidence; all-review blank;
  equal-confidence deterministic tiebreak; **synthetic third discipline "Plumbing"**), the resolved
  endpoint (single-engine resolves like effective; votes map; multi-engine human-wins + lists both;
  uncommitted empty), and a **freeze-reader-shape regression guard**. `test_row_category` 29 green.
- Frontend `vitest` **532 -> 547 (+15)** (new `sheetCategoryResolve.test.ts`, 24 files). `tsc`
  net-zero new errors (3235 pre-existing in the repo, **0 in the touched files**).
- **Electrical byte-identical (A10):** the resolved read on `BOQ-26-00009 | ELECTRICAL WORKS`
  returns disciplines `["Electrical"]`, 939 rows, 0 effective differences vs `get_sheet_categories`,
  3/3 spot-check MATCH.

### Live verification

HVAC `Piping` renders **14 auto + 9 blank** (matches the HV-8 certification). The MULTI-ENGINE row:
`BOQ-26-00033 | LOWSIDE` excel_row 10 took an Electrical human verdict (`panels`) -- the upsert
minted the Electrical row, disciplines went `["HVAC"] -> ["Electrical","HVAC"]`, the ladder showed
it winning (source human, `human_discipline=Electrical`); a subsequent HVAC-group pick
(`hvac_piping`) overrode it by most-recent-human. **Left in the HVAC-pick state** (row 10 carries
both a superseded Electrical human + the current HVAC human -- the intended two-discipline demo row).

### The standing warning LIFTS

**Category picks on HVAC sheets are safe from this slice on.** The write sends the picked group's
discipline, the picker shows the right engine's vocabulary, and the modal completes.

### Carried forward

1. **Concurrent multi-engine classify progress** is wired (per-discipline pollers + all-terminate
   completion) but only single-engine has been LIVE-exercised; confirm a genuine two-engine
   concurrent run before relying on the aggregate progress bar. **(DONE -- HV-10b live check ran a
   genuine concurrent Electrical+HVAC whole-sheet run on `BOQ-26-00050 | MEP Combined`; aggregate
   progress + all-terminate modal completion both held.)**
2. The AI-toggle keeps turning itself off (unattributable; own investigation) and an AI-off run
   still reports success -- both unchanged by HV-10.
3. `rules_version` persists empty (HV-9) -- own slice.

