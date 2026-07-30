<!-- Recovered 2026-07-30 from frontend/.claude/plans/boq/archive/boq-upload-plan-pre-split.md.
     This record shipped in PR #1133 (2bd6032f) but was never
     distributed into the rotated plan tree: the rotation was
     computed from a 1,286,655 B plan doc and the rebase archived
     develop's 1,352,991 B version. Verbatim copy, write-once. -->

## Build slice RM-3 (extraction engine + the helper goes REAL + run persistence) COMPLETE

Session 3 of 4 of the rate-master box. **The stub dies here.** Migrate-carrying (TWO new doctypes).
Branch `feature/boq-pricing-helper`. feat `22165f67` + docs (this entry). The "Pricing sheet" rate
helper is now REAL for the `wiring_cabling` category, backed by a server-side AI attribute-extraction
run that is persisted, version-keyed, and drives a live client-side rate via the RM-2 interpreter
UNCHANGED.

### Backend
- **Two new doctypes** (both minimal controllers with a composite read index via `on_doctype_update`;
  fresh sync creates the indexes, so NO patches.txt line -- but they GROW the pullers' migrate
  obligation):
  - **`BoQ Rate Suggestion Run`** (`BRSR-.YY.-.#####`) -- one row per run; FREEZE-AND-SUPERSEDE via
    an `active` Check (a new run deactivates the prior active run(s) for the sheet, retained not
    deleted); fields `boq`/`sheet_name` (VERBATIM #152)/`committed_version`/`run_id`/`ai_status`/
    `results` (JSON)/`run_by`/`run_at`. Index `[boq, sheet_name, active]`.
  - **`BoQ Rate Suggestion Event`** (`BRSE-.YY.-.#####`) -- immutable Use telemetry (`track_changes:0`).
    `event_user` (NOT `user` -- PG reserved word). Captures excel_row/col/kind/helper_id/category_id/
    run_id + extracted_attributes/extracted_confidences/corrected_attributes (JSON) + computed_value/
    used_value/used_at. Index `[boq, sheet_name, excel_row]`.
- **`services/boq_rate_master/extraction.py`** -- `run_extraction(boq, sheet_name, client=None,
  progress_cb=None)` returns `{committed_version, ai_status, model, category_id, attribute_definitions,
  results}`. `assemble_population` JOINs `build_sheet_context` x the resolved categories (filtered to
  `wiring_cabling`) x the rate-editable predicate (`persist._qty_bearing_node_names` +
  `persist.resolve_row_ladder`). `_extract_batch` MIRRORS `ai_voter` wholesale (`ai_settings` verbatim,
  `anthropic.Anthropic().messages.create`, 20-row batches, 3x retry, fail-closed `ai_status` envelope;
  imports `ai_voter._extract_json_array`). `_corroborate`/`_regex_attributes` are a DISPLAY-ONLY
  corroborator that NEVER overrides the AI. `CATEGORY_ID="wiring_cabling"`, `DISCIPLINE="Electrical"`.
- **`api/boq/rate_master.py`** (appended after RM-1) -- Redis key helpers, `_guard_suggest_gate` (the D8
  chain re-checked server-side: not locked + formulas complete + category gate open, REUSING
  `pricing._get_sheet_is_locked` / `_sheet_formulas_complete` / `_categories_gate_ok`), `start_suggest`
  (POST, enqueue on the `long` queue), `_suggest_worker` (freeze-and-supersede, commit-before-publish,
  self-heal), `get_suggest_status`, `get_active_suggestion_run`, `record_rate_suggestion_event`,
  `get_suggestion_events`. In-progress marker + terminal payload in REDIS keyed by (boq, sheet_name).
- **Prompt asset** `services/boq_category/prompts/boq_rate_attr_extraction_prompt.md` -- category-agnostic
  extraction template (attribute defs injected per call). **Owner rulings encoded here (see below).**

### Frontend
- **`rate-helper/pricingSheetHelper.ts`** -- `makePricingSheetHelper({config, items, extractionByRow})`
  closure. `compute` reads the run's per-row extraction and COMPUTES the rate CLIENT-SIDE via the RM-2
  `runPipeline` UNCHANGED (the single compute source -- a rate/param change flows in live without
  re-running the AI). Paired termination reference line on cable rows; BCS deferred. `producibleKinds`
  makes a PARTIAL in-run row still badge.
- **Badge-less opener + category-scoped manual fill (owner mid-run):** `PricingGrid.tsx` renders an
  always-on FAINT sparkle opener on every rate-editable cell that has no badge; clicking it opens the
  panel. For a row NOT in the run, `compute` offers a BLANK, editable attribute form for the row's
  CATEGORY (never minting a badge -- reached only via the opener), OR a "coming soon" NoSuggestion when
  the row's category has no attribute set defined yet (only `wiring_cabling` is defined this slice).
  `RateHelperPanel.tsx` adds a `- select -` placeholder so an empty attribute never masquerades as its
  first option, plus per-attribute confidence % + a corroboration tick.
- **Run lifecycle:** `RateSuggestProgressModal.tsx` (async progress) + a poller; `SheetPricingPage.tsx`
  fetches config/items/active-run/events, loads the active run ON OPEN (persistence, no press),
  restores used-state, and on Use calls `applyRate` (mirrors typing -- optimistic + debounced autosave)
  then records telemetry. Combined-rate column = supply + install.
- **The stub is DELETED** (`stubRateHelper.ts` + test); the registry prepends the page-built real helper.

### Owner mid-run rulings (folded into this slice, dated 2026-07-28)
1. **"override the category lock for testing"** -- the cert ran on a REAL sheet (BOQ-26-00106 ELECTRICAL
   BOQ) with the admin category-gate override active; **left active by owner decision** (housekeeping).
2. **flexible = UNARMOURED; default UNARMOURED** -- a FLEXIBLE cable is unarmoured, and when NEITHER
   armoured nor unarmoured is stated (row or ancestors) the insulation DEFAULTS to UNARMOURED (not null).
   Encoded in the prompt; measured live -- row 77 "copper *flexibal* cable" went null(0.3) -> UNARMOURED(0.9).
3. **tolerate spelling mismatches** -- the prompt maps common typos/variants to the canonical value
   (`flexibal`->flexible, `aluminium`/`aluminum`->ALUMINIUM, `armored`->ARMOURED, `coper`->COPPER).
4. **helper reachable on badge-less cells** -- the always-on opener above (owner: "cells which
   legitimately don't have a badge should let the user bring up the helper... fill in the details and
   get the pricing").
5. **category-scoped attributes + coming-soon** -- the pricing sheet shows the ROW'S CATEGORY attributes;
   if that category's attributes are not defined yet, show nothing but a "coming soon" message (owner
   verbatim). Reverses the interim "offer wiring fields universally" and gates on `ctx.category`.

### Cert (browser + server, live on BOQ-26-00106 / ELECTRICAL BOQ)
- **Extraction** proven with real AI: 51 wiring rows, `ai_status="ran"`, model `claude-opus-4-8`; the
  flexible/spelling rules produce full extractions.
- **Run + persistence:** new run BRSR-26-00007 auto-loads on page open (no press); 8 badges on rows 77-84.
- **Compute:** row 77 (COPPER/UNARMOURED/3C/1.5) -> `supply 100 + install 24 = combined 124`, paired
  termination `supply 70, install 20`, per-attribute confidence + corroboration ticks.
- **Opener + coming-soon:** row 59 (Point Wiring, a non-wiring category) shows "Rate attributes for this
  category haven't been defined yet -- coming soon"; badge-less wiring cells expose the faint opener.
- **Use -> save + telemetry (last item):** pressing Use on row 77 wrote pricing row **BPRC-26-15330 =
  124.0** (`is_current`, superseding the prior 130.0) AND telemetry **BRSE-26-00003** (row 77,
  combined_rate, computed 124 / used 124, helper `pricing_sheet`, cat `wiring_cabling`, extracted
  `{COPPER,UNARMOURED,3,1.5}` + confidences + corrected attrs + run_id). **No CSRF error.**
- **Env note (dev CSRF):** in dev the app boots a Guest context (no csrf_token), and Frappe enforces
  CSRF only when the session HAS a stored token -- so a FRESH relogin (clear-site-data + hard refresh)
  yields a token-less session where POSTs pass. That is the "destale ritual", not a code issue.

### Gates
Pricing rate-helper vitest **24 pass** (pricingSheetHelper 10, registry 5, model 9); tsc unchanged at
the 3240 baseline (0 new); backend `test_rate_suggest` **10 pass**; `test_rate_master` 8 + `test_pricing`
230 unaffected.

### Files
NEW: the two doctype folders (`boq_rate_suggestion_event`, `boq_rate_suggestion_run`),
`services/boq_rate_master/extraction.py`, `services/boq_category/prompts/boq_rate_attr_extraction_prompt.md`,
`api/boq/test_rate_suggest.py`, `frontend/.../rate-helper/{pricingSheetHelper.ts,.test.ts,
RateSuggestProgressModal.tsx}`. MODIFIED: `api/boq/rate_master.py`, `frontend/.../PricingGrid.tsx`,
`SheetPricingPage.tsx`, `rate-helper/{RateHelperPanel,rateHelperRegistry(+test),rateHelperTypes,
rateSuggestionModel(+test)}`. DELETED: `rate-helper/stubRateHelper.ts(+test)`. Docs: this entry +
`frontend/CLAUDE.md` (rate-helper section) + root CLAUDE.md (RM-3 note). Out of scope (untouched):
patches.txt, .claude/settings.local.json.
