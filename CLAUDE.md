# CLAUDE.md — Nirmaan Stack

**Last updated:** 2026-06-20 (Phase 5 Slice 3a -- PRICING GRID SKELETON + PAGE -- FRONTEND, READ-ONLY, feat pending,
branch `feature/boq-phase-5`. Minimal-touch cell (frontend slice). The FIRST on-screen pricing surface: a NEW
hub-reached, READ-ONLY page (5th sibling wizard route `upload-boq/hub/:boqId/pricing/:sheetName` ->
`SheetPricingPage.tsx`) that opens a COMMITTED sheet, calls **`get_priced_rows`**, and renders the committed rows +
current saved rates + a basic priced/un-priced marker, via a NEW **`PricingGrid.tsx`** that REUSES the Slice-2
`reviewRender` helpers (design v1.3 Sec.4 path b -- NOT a ReviewTree retune). The priced marker is driven SOLELY by the
overlay's `priced_*` fields (NEVER a zero-check; 0.0 can be priced) via two pure, unit-tested helpers
(`isRateDescriptor`/`isCellPriced`). Hub entry (CORRECTED by the 3a-fix) = a global **"Tendering"** button in the hub
bottom action row (gated on committed-ness) -> a `TenderingDialog` RADIO single-select picker of eligible (committed)
sheets -> Confirm -> `handleOpenPricing` opens that sheet's editor (design v1.3 Sec.8.5). The initial 3a per-card
"Price" button on `SheetCard` was REPLACED by this global picker (`onOpenPricing` prop removed; `handleOpenPricing`
kept). NEW additive frontend types `PricedRow extends ReviewRow` +
`GetPricedRowsResponse` (boqTypes.ts). NO editing (3b), NO Save/Export (3c/5); `editable`/`lock_info` threaded INERT
(the 3b lock hook). NO backend / doctype / migrate. VERIFIED: Vitest 20/20 GREEN (12 Slice-2 + 8 new marker tests);
tsc 3178 (== baseline), 0 in touched files; Vite build exit 0 (PWA 166 entries). Slice 3a unblocks 3b. Full detail in
frontend/CLAUDE.md + boq-upload-plan.md "Phase 5 Slice 3a".)
// prior: 2026-06-20 (Phase 5 Slice 2 -- SHARED-RENDER EXTRACTION + Vitest harness -- FRONTEND, feat pending,
branch `feature/boq-phase-5`. Minimal-touch cell (frontend slice). Lifted four render helpers out of the ~2580-line
`ReviewTree.tsx` into a NEW importable sibling **`frontend/src/pages/boq-wizard/reviewRender.tsx`** so the future
pricing grid (Slice 3a) reuses them instead of duplicating ReviewTree -- ZERO behaviour change, byte-identical move.
MOVED: `computeDepths`, `resolveDescriptorValue`, `renderDescriptorCell`, `ClassificationPill` (+ private deps `fmtNum`,
`CLS_PILL_CLASSES`, and `CLS_LABELS` -- moved to avoid a circular import since the pill needs it). `.tsx` not `.ts`
(ClassificationPill is JSX). Re-pointed the two importers (`ReviewTree.tsx`, `exportReviewCsv.ts`); no third importer.
**Added the repo's FIRST frontend unit-test harness: Vitest** (4.1.9) + `test`/`test:watch` scripts + a standalone
`vitest.config.ts` (node env; React plugin for automatic JSX + `@` alias). Method = characterization-before-extraction:
12 golden tests written against the CURRENT code (GREEN), then re-run against the moved module (GREEN) -- the pre/post
parity is the behaviour-preservation proof (the design-doc claim that the backend's ~205 `test_review_screen.py` tests
gate this was FALSE -- they never touch these frontend functions). `ClassificationPill` is manual-cert (JSX; no DOM
test added). VERIFIED: Vitest 12/12 GREEN both runs; tsc 3178 errors (== baseline), 0 in touched wizard files; Vite
build exit 0 (PWA 164 entries). NO backend / doctype / migrate. Full detail in frontend/CLAUDE.md + boq-upload-plan.md
"Phase 5 Slice 2".)
// prior: 2026-06-20 (Phase 5 PRICING-OVERLAY READ -- `get_priced_rows` -- BACKEND, pure-read, feat pending,
branch `feature/boq-phase-5`. The COMPOSING read between Slice 1b and the editor: a NEW whitelisted endpoint
**`get_priced_rows(boq_name, sheet_name)`** in `api/boq/wizard/pricing.py` returning the committed rows for a sheet WITH
the current saved prices merged in -- so the (future) pricing grid consumes ONE already-merged structure instead of
joining two reads client-side. **PURE READ** -- never writes, never mutates the committed tier, never creates/changes a
`BoQ Cell Pricing` record. **NO doctype JSON change -> NO migrate.** COMPOSES the two certified reads (reimplements
NEITHER): imports + calls `review_screen.get_committed_rows` (no circular import -- review_screen does NOT import
pricing) + this module's `get_sheet_pricing`, then merges; arg/not-found guards inherited from get_committed_rows
(called first). **ONE ADDITIVE change to `get_committed_rows` (review_screen.py):** adds a top-level **`commit_version`**
key to its response (the current committed BoQ Sheet's commit_version -- selected in the EXISTING sheet read, surfaced
on all three return paths, None on the no-sheet empty path); the overlay reads it as the single source of truth for
"which version is current" and passes it to get_sheet_pricing (re-querying would be a second source that can race).
Purely additive -- no existing key/row changed. **THE MERGE (descriptor-driven -- col_letter is NOT on the committed
row):** index current FILLED prices by `(excel_row, col_letter)`; for each row x each RATE descriptor (value_field ==
`"rate_by_area"` OR a scalar rate field `rate_supply`/`rate_install`/`rate_combined` -- amount/qty descriptors NEVER
stamped) look up `(row.source_row_number, descriptor.col)`. `source_row_number` is the Excel join key (= pricing
`excel_row`); `row_index`(=sort_order) is a DIFFERENT space, never used. **STAMP + MARK:** a matched price stamps its
`rate` IN PLACE (per-area `rate_by_area[area][kind]`, or the scalar rate field) AND sets a parallel marker --
`priced_by_area[area][kind]=True` (per-area) / `priced_<scalar field>`=True (scalar). The marker comes from the PRESENCE
of a current price record + its `is_filled` (the index is is_filled-gated), **NEVER a zero-check** (a committed 0.0 rate
is a valid priced value; a 0.0-rate save with is_filled=1 reads PRICED). Un-priced cells keep their committed value, no
marker. **RESERVE-FOR-LOCK:** two INERT placeholders `editable: true` + `lock_info: null` (reserved for a future
single-editor-lock slice; NO locking logic built). **RESPONSE:** `{rows (stamped+markers), column_descriptors
(passthrough), commit_version, editable, lock_info}`; graceful empties (uncommitted/grid-only -> same shape, no-op
merge, no throw). **TESTS (bench-verified in-session):** test_pricing **12 -> 22** (+10 TestGetPricedRows:
priced+unpriced in one row; zero-rate-is-priced [the load-bearing correctness test]; multi-area independence;
commit_version passthrough; reserved editable/lock_info; scalar-rate cell via a NEW local `_build_scalar_rate_committed_
sheet` fixture [the shared per-area fixture has no scalar rate column]; descriptors passthrough; uncommitted empty
shape; missing-args/unknown-boq throw; NO amount/qty stamping). test_review_screen **205 -> 205** (commit_version
assertions folded into existing committed-read tests -- net count unchanged). Frontend NOT touched (backend-only;
frontend/CLAUDE.md minimal-touch). Full detail in boq-upload-plan.md "Phase 5 Pricing-overlay read".)
// prior: 2026-06-20 (Phase 5 Slice 1b -- PRICING-LAYER DOCTYPE + persist -- BACKEND, MIGRATE slice, feat
pending, branch `feature/boq-phase-5`. Creates the per-cell PRICING LAYER -- a NEW standalone doctype **`BoQ Cell
Pricing`** (autoname **`BPRC-.YY.-.#####`**, istable:0, track_changes:1) that stores the RATE a user fills into a
committed Excel cell, sitting ON TOP of the committed tier (NEVER mutates it -- nodes/grid/BoQ Sheet stay capture-only).
ADDITIVE: no existing doctype JSON changed -> ONE `bench migrate` (clean; doctype + 15 columns verified at runtime).
**IDENTITY = (boq, sheet_name [VERBATIM #152], excel_row, col_letter, committed_version)** -- the durable Excel address
+ the committed version it prices (survives a re-commit). `col_letter` is STORED (derived from `column_role_map` by
(role,area)->letter, not on the node); `node` (Link->BOQ Nodes) is a re-resolvable per-version pointer + `description` a
copy-forward guard -- NEITHER is part of the key. `is_filled` (Check) is the layer's OWN filled-state (committed node
rates read 0.0, not blank). PRICING LIFECYCLE = its own freeze-and-supersede triple `pricing_version`/`is_current`/
`priced_at` (mirroring the committed tier) + an `is_finalized` lock (declared, enforced later). Bare-stub controller
(invariant is endpoint-enforced, NOT in the controller; no hooks.py wiring). NEW `api/boq/wizard/pricing.py`:
`save_cell_price` (POST -- freeze-and-supersede upsert mirroring commit_pipeline's `_current_names`/`_next_commit_
version`: freeze prior via `set_value`, insert new is_current=1 / pricing_version=max+1 / is_filled=1; RESOLVES +
VALIDATES the committed cell exists, throws for a non-cell, stores the resolved node) + `get_sheet_pricing` (GET --
current pricing set for a (boq, sheet, committed_version)). Guards mirror get_review_rows. **HERMETIC COMMITTED-NODE
FIXTURE** (`build_committed_sheet_fixture`/`cleanup_committed_fixture` in test_review_screen.py) folds in the owed
Slice-1a fixup: the 5 get_committed_rows positives were CONVERTED from live-skip-guard to the fixture -> always-run (no
skip); test_pricing.py imports the shared builder. **TESTS** (bench-verified): test_review_screen **205 -> 205** (5
positives converted in place, net unchanged, no skips); NEW test_pricing **12** (save/re-save freeze-and-supersede +
exactly-one-current invariant + multi-area distinct + read + NEG non-existent cell/version/sheet/boq/missing-args). OUT:
the overlay-onto-1a read, finalize endpoints, copy-forward, frontend. NEXT = the pricing overlay read (merge pricing
onto get_committed_rows) + finalize-pricing. Full detail in boq-upload-plan.md "Phase 5 Slice 1b".)
// prior: 2026-06-20 (Phase 5 Slice 1a -- COMMITTED-READ ENDPOINT `get_committed_rows` -- BACKEND, pure-read,
feat pending, NEW branch `feature/boq-phase-5`. The first Phase-5 (pricing-editor) build: a NEW whitelisted read
endpoint in `review_screen.py` that adapts the COMMITTED tier (BOQ Nodes + BOQ Node Qty By Area children + the committed
`BoQ Sheet` column config) into the SAME `{rows, column_descriptors}` descriptor contract `get_review_rows` emits from
the DRAFT tier -- so the descriptor-driven frontend render can later draw committed rows unchanged. NO new doctype, NO
schema/JSON change, NO migrate, NO frontend (the pricing-layer doctype is Slice 1b). `get_review_rows` /
`_build_column_descriptors` / `resolve_effective` UNCHANGED (read-to-reuse). **COLUMN half = pure reuse**
(`_build_column_descriptors` runs UNCHANGED on the committed `column_role_map` -- identical {letter:{role,area}} shape).
**ROW half = a bounded INVERSION of commit_pipeline.py's draft->committed map** (`_committed_node_to_row` +
`_collapse_area_children`): money word-order re-key (node.supply_rate->"rate_supply", combined_rate->"rate_combined",
total_amount->"amount_total", ...), identity (code->"sl_no_value", qty->"qty_total", notes->"row_notes"), and the
per-area children RE-COLLAPSED into the nested *_by_area dicts (qty_by_area flat; rate_by_area
{area:{supply_rate,install_rate,combined_rate}}; amount_by_area {area:{supply,install,total}} -- the amount kind rename
total_amount->"total"/supply_amount->"supply"/install_amount->"install"). **INDEX-FIELD CHOICE (A20):** `row_index =
node.sort_order` (the exact committed analog -- commit_pipeline maps draft row_index->sort_order; 0-based contiguous as
computeDepths expects), `effective_parent_index` = parent node's sort_order via `parent_node`->name->sort_order, ROOT
(parent_node NULL) -> None; `source_row_number` carried separately for the Parent column's Excel display.
`classification`/`effective_classification` = node.row_class (the pill's taxonomy; node_type is priceability).
DRAFT-ONLY fields (ai_*, edit_log, flags, revert_available, human_*) OMITTED -- AI-free minimal contract. Guards mirror
get_review_rows (boq/sheet required; "BOQs '...' not found." throw); uncommitted/grid-only -> graceful empty lists.
sheet_name VERBATIM (#152). **TESTS:** `test_review_screen` 196 -> **205** (+9, bench-verified: 4 hermetic
negative/empty + 5 positive against the live committed multi-area BOQ-26-00145/'Electrical ', skip-if-absent so
CI-safe). Live probe: 194 rows, 9 descriptors, rates 0.0 (un-priced committed state), 2 roots. NEXT = Slice 1b (the
per-cell pricing-layer doctype). Full detail in boq-upload-plan.md "Phase 5 Slice 1a".)
// prior: 2026-06-20 (Phase 4 Slice AI-3c-2d -- GATE run_ai_pass ON A FINALIZED SHEET (FREEZE GAP) --
BACKEND + FRONTEND, feat pending. Closes the last freeze hole in the AI surface. A "Finalized" sheet is read-only
(enforced by `_guard_sheet_not_frozen`), and accept/reject/revert were all already guarded -- but `run_ai_pass` was
added later and was NEVER gated on EITHER layer, so a Finalized sheet could still trigger a fresh AI pass whose
`_apply_ai_suggestions` STALE-CLEAR wipes the `ai_suggestion_status` of already-Accepted rows (a real mutation of a
read-only sheet; confirmed live + by recon). NO doctype JSON change -> NO migrate. **(1) BACKEND (`ai_assist.py`
`run_ai_pass`):** TWO new pre-flight rejects in the existing `{ok:False,error:"<code>"}` idiom (NOT the throwing
`_guard_*` -- run_ai_pass returns codes, it does not throw), inserted AFTER the no_api_key check and **BEFORE the cache
check** (load-bearing -- the cache-HIT path ALSO calls `_apply_ai_suggestions`, so the guard must precede BOTH the
synchronous cache path and the enqueue path): `if _get_sheet_wizard_status(boq, sheet) == _SHEET_FINALIZED -> {ok:False,
error:"frozen"}` (the core fix; reads the status NON-throwingly via the imported helper) and `if
_get_parse_in_progress(boq, sheet) -> {ok:False, error:"parsing"}` (a new helper mirroring `_get_ai_in_progress`,
reading the draft's `parse_in_progress` -- the non-throwing analog of the `_guard_sheet_not_parsing` the other AI
endpoints enforce). `_SHEET_FINALIZED` + `_get_sheet_wizard_status` added to the review_screen import. The worker /
`_apply_ai_suggestions` / stale-clear are UNCHANGED -- the fix is purely the pre-flight gate. **(2) FRONTEND
(`SheetReviewPage.tsx`):** the "Run AI pass" button's `disabled=` gains `|| isChecked` (`isChecked = sheetStatus ===
"Finalized"`, the same signal the "Mark Finalized" button uses) so a finalized sheet shows it GREYED (stays VISIBLE per
owner -- disable-not-hide); a `title` hint ("Sheet is finalized -- un-mark to run the AI pass") on the disabled button;
and `AI_REJECT_MSGS` gains readable `frozen` + `parsing` entries (defense in depth -- a stale client that still calls
the endpoint surfaces a clear message). **THIS COMPLETES THE FREEZE COVERAGE OF THE WHOLE AI SURFACE** (accept / reject
/ revert were already guarded; run_ai_pass was the one hole). **TESTS:** `test_ai_assist` 33 -> **36** (+3: Z1 a
Finalized sheet -> `{ok:False,error:"frozen"}` + NO enqueue + an Accepted row's `ai_suggestion_status` UNCHANGED [the
stale-clear never ran -- the core proof]; Z2 a non-finalized Parsed sheet still enqueues [the guard does not over-fire];
Z3 a sheet with `parse_in_progress=1` -> `{ok:False,error:"parsing"}` + NO enqueue). `test_review_screen` **196
unchanged** (review_screen.py not touched). All prior run_ai_pass + accept/reject/revert (V*/T*/G*/C*) green. tsc 0 new
wizard-file errors (filtered `boq-wizard|SheetReviewPage` -> empty; total 3178 baseline) + in-container Vite build exit
0 (PWA 164 entries). Manual live-cert pending Nitesh: finalize a sheet -> the "Run AI pass" button is greyed with the
finalized title; un-mark -> it re-enables; a direct run_ai_pass call on a finalized sheet returns the frozen reject and
leaves Accepted rows' status intact. **NEXT = the boq_ai.log token-logging fix, then the Phase-4 doc refresh.** Full
detail in frontend/CLAUDE.md.)
// prior: 2026-06-20 (Phase 4 Slice AI-3c-2b -- REVERT AI CHANGE BUTTON + OVERRIDE CLEARS AI-ACCEPTED
STATUS -- FRONTEND + a bundled BACKEND status fix (R6), feat pending. Surfaces AI-3c-2a's row-level revert in the UI
AND fixes a misleading status. **THE AI ACCEPT/REJECT/REVERT SURFACE IS NOW COMPLETE** (pending live-cert). NO doctype
JSON change -> NO migrate (the 2a snapshot fields already exist). **(1) FRONTEND -- the Revert button (`ReviewTree.tsx`
detail panel).** A NEW block placed right AFTER the PENDING accept/reject block (which renders only while
`ai_suggestion_status === "Pending"` and so VANISHES once Accepted), gated `row.ai_suggestion_status === "Accepted"` so
it shows for an Accepted row in BOTH the editable and read-only panels. `<Button size="sm" variant="outline">` "Revert
AI change" -- ENABLED iff `row.revert_available && !readOnly`; DISABLED otherwise with an italic-muted reason (readOnly
-> "Sheet is finalized -- revert unavailable."; else `!revert_available` -> "Revert no longer available -- the row was
edited after the AI change."). `handleRevertAi` calls `revert_ai_acceptance` (sheet_name VERBATIM #152) then
`onRemarkSaved?.()` -- the MUTATE-ONLY full re-fetch (revert returns no edited_at; the re-fetch re-renders the row
Pending so the pending block reappears + the button disappears); errors via the existing `aiActionError`
(`getFrappeError`). `boqTypes.ts` `ReviewRow` gains `revert_available?: boolean` (after `ai_suggestion_status`;
computed by get_review_rows, blob never shipped). **(2) BACKEND -- R6 override-clears-Accepted (`review_screen.py`
`_apply_and_save_row_edit`).** The EXISTING AI-3c-2a class/parent chokepoint block (`if field in
("human_classification","human_parent")` -- the one that clears the revert snapshot) now ALSO clears
`ai_suggestion_status` so an overridden AI-Accepted row stops reading "AI Accepted" (the Status column checks ==
"Accepted" BEFORE isEdited, so a falsy status falls through to "Edited"). **GATED on the CURRENT status being
"Accepted"** (a DELTA from the spec's bare "set to None"): a Pending/Rejected suggestion has NOT been applied, so a
manual class/parent edit must leave it untouched -- this preserves the restructure cancel-safety contract (R4: a manual
restructure on a Pending-suggestion row must not change the status; an UNGATED clear broke R4). **value/text/per-area
edits never enter this block** -> a value edit on an AI-Accepted row STAYS "AI Accepted" + revert stays available.
**ORDERING (load-bearing, same self-clear territory as 2a):** both accept paths flip status="Accepted" LAST (flip block,
after every helper call) and revert flips "Pending" LAST, so this in-flight clear during an accept/revert is harmless --
the final flip wins (X1 + W2 assert it). **TESTS:** `test_review_screen` 192 -> **196** (+4: X1 an accept still ends
"Accepted" despite the chokepoint clear [the status self-clear-trap guard]; X2 accept-then-later-human_parent-edit ->
status falsy + edit_log non-empty [renders "Edited"]; X3 accept-then-later-VALUE-edit -> status STAYS "Accepted"
[edit-type distinction]; X4 a class/parent edit on a never-accepted row is a status no-op [no crash]). `test_ai_assist`
**33 unchanged** (the V*/T*/G*/C* accept/reject/revert path is Pending during its helper calls -> the gate skips it).
All prior suites green incl. R4 cancel-safety + W2 revert-to-Pending. tsc 0 new wizard-file errors (filtered
`boq-wizard|ReviewTree|boqTypes` -> empty; total 3178 baseline) + in-container Vite build exit 0 (PWA 164 entries).
Manual live-cert pending Nitesh: accept an AI rec -> the row reads "AI Accepted" + a "Revert AI change" button shows;
Revert -> the row returns to its pre-accept state + the suggestion is re-offered Pending; hand-edit the class/parent of
an AI-Accepted row -> it reads "Edited" + the button greys with the "edited after" reason; a value edit on an
AI-Accepted row -> stays "AI Accepted" + revert still offered; finalize -> the button greys with the "finalized"
reason. **NEXT = the boq_ai.log token-logging fix, then the Phase-4 doc refresh.** Full detail in frontend/CLAUDE.md.)
// prior: 2026-06-20 (Phase 4 Slice AI-3c-2a -- ROW-LEVEL REVERT OF AN AI ACCEPTANCE -- BACKEND, feat
pending. Adds the ability to UNDO an AI acceptance at the row level: restore the row (and any children the accept
moved) to their EXACT pre-accept state, re-offer the suggestion (status -> Pending), and append honest "reverted"
edit_log entries. The Revert BUTTON is AI-3c-2b (frontend, next) -- so frontend/CLAUDE.md is intentionally NOT touched
this slice. **THE FIRST MIGRATE SINCE AI-2d** (AI-3a..AI-3c-3 were all field-free). **(1) SCHEMA (`boq_review_row.json`,
+2 additive read_only fields at the tail of `ai_suggestions_section`; `bench migrate` CLEAN, both columns verified via
information_schema + has_column + meta):** `ai_accept_snapshot` (JSON -- the per-row pre-accept blob `{"row":{hc,hp,hr},
"children":[{idx,hp,hr},...]}`); `ai_snapshot_owner` (Int, **default "-1"** -- the back-pointer from a moved child to
the accepted owner row's row_index). **THE -1 DEFAULT IS LOAD-BEARING:** an empirical probe proved Frappe coerces an
UNSET Int to **0**, which would collide with `row_index 0`; the explicit -1 default + a `>= 0` guard (NOT truthiness)
make "not a snapshotted child" unambiguous. **(2) CAPTURE -- written LAST in each accept transaction (the SELF-CLEAR
TRAP):** both accept paths write human_* via `_apply_and_save_row_edit`, whose chokepoint (Step 4) CLEARS the snapshot
on every human edit -- so the snapshot is built BEFORE the helper calls but PERSISTED in each path's flip block AFTER
them (so the accept can't wipe its own snapshot; V1/W1 assert it SURVIVES). `accept_ai_suggestion` (childless path):
captures the row's pre-state, children=[]. `save_review_restructure` (mark_ai_accepted=True ONLY -- a MANUAL
restructure writes NOTHING, W5): captures the row + each moved child's pre-move human_parent/human_is_root from the
pre-write `rows_by_idx`, and stamps each moved child's `ai_snapshot_owner = row_index`. **(3) REVERT ENDPOINT
`revert_ai_acceptance(boq_name, sheet_name, row_index)`** (whitelisted POST, guards _not_frozen + _not_parsing): reads
the snapshot (throws "nothing to revert" if absent), restores via `_apply_and_save_row_edit` -- the row's
human_classification + human_parent and each child's human_parent -- each axis ONLY when it actually CHANGED (so a
parent-only accept appends no spurious classification entry; **delta from the spec's "restore both unconditionally" --
restore-if-changed avoids no-op edit_log noise while still appending a genuine reverted entry for every real change**).
Capture-then-flip IN REVERSE: restores run while status is still "Accepted" (so the helper's from-value reads the
accepted effective value), THEN status flips to "Pending" + the snapshot clears + each child's back-pointer resets to
-1, all in ONE commit. Returns `{ok, row_index, ai_suggestion_status:"Pending", reverted_children:[...]}`. **(4)
INVALIDATION (rule c-ii):** the `_apply_and_save_row_edit` chokepoint (the existing flags_dismissed clear site) now ALSO,
on a `human_classification`/`human_parent` edit, clears THIS row's snapshot AND -- if the row is a moved child
(`ai_snapshot_owner >= 0`) -- clears the OWNER row's snapshot (back-pointer, NOT a sheet-walk: W4 proves a sibling edit
does NOT clear) and resets the child's back-pointer. `mark_sheet_parsed_check_done` finalize bulk-clears every snapshot
+ back-pointer on the sheet via one filtered set_value before its existing commit. **(5) READ FLAG:** `get_review_rows`
fetches `ai_accept_snapshot` ONLY to compute `d["revert_available"] = bool(...)`, then DROPS the raw blob from the
payload (the internal pre-state never reaches the client). **TESTS:** `test_ai_assist` 29 -> **33** (+4: V1 accept ->
snapshot survives the chokepoint + revert_available true; V2 revert restores parent + Pending + appends a reverted
entry [accept entry stays]; V3 no-snapshot throws; V4 a later human edit invalidates). `test_review_screen` 185 ->
**192** (+7: W1 restructure-accept captures row+children + back-pointers; W2 revert restores row+ALL children + clears
owners; W3 moved-child edit clears the OWNER snapshot; W4 sibling edit does NOT [back-pointer precision]; W5 manual
restructure writes no snapshot; W6 finalize bulk-clears; W7 post-revert = non-empty edit_log + Pending [renders
"Edited" + re-offered]). All prior accept/reject (T*/R*/G*/C*) green; existing get_review_rows + save_review_edit
suites green (backwards-compat). **NEXT = AI-3c-2b** (the Revert BUTTON: read `revert_available`, call
`revert_ai_acceptance`, refresh), then the boq_ai.log token-logging fix. Full backend detail in boq-upload-plan.md.)
// prior: 2026-06-20 (Phase 4 Slice AI-3c-3 -- AI CLASSIFICATION-ACCEPT MODAL PARITY (with-children) --
BACKEND + FRONTEND, feat pending. Closes a SILENT BROKEN-TREE hole the recon pinned: the AI-accept routing opened the
child-disposition RestructureModal ONLY when a PARENT change was accepted on a with-children row (`handleApplyAi`
gated on `aiAcceptParent && hasChildrenSet.has(row_index)`). A CLASSIFICATION-only accept on a with-children row (e.g.
Preamble->note) fell through to a bare `accept_ai_suggestion`, which wrote the new class and LEFT the children pointing
at the now-non-parent row -- a silent broken tree (`check_structural_integrity` flags line_item-as-parent ONLY, NOT
note/spacer-as-parent, so nothing warned). The MANUAL reclassify path (`onPickClass`) already does the right thing: it
opens the modal for ANY with-children reclass (`childCount > 0`). **THE RULE (owner-stated, now mirrored in the AI
path): any classification change on a row WITH children opens the child-disposition modal; it skips the modal only if
the row is CHILDLESS.** **(1) FRONTEND (`ReviewTree.tsx` `handleApplyAi`):** the modal-open condition is now
`hasChildrenSet.has(row.row_index) && (clsIsChange || parentAccept)` where `clsIsChange = aiAcceptCls && a real class
change` and `parentAccept = aiAcceptParent && parentIsChange`. **Classification-ONLY accept OMITS `presetRowParent`
(undefined)** -> the RestructureModal opens in NORMAL mode and (because the row has children) lazy-inits
`rowPosition="keep"` (`RestructureModal:159`), so the row KEEPS its own parent -- exactly what manual
`onPickClass`->modal does (it passes no parent preset either). A parent accept still sets `presetRowParent` (+ the
message line) as before. `newClassification` = the AI class when `clsIsChange`, else the row's current effective class
(the #162 no-op pattern). `markAiAccepted: true` rides every modal open so the status flips on Save. Childless accepts
+ classification-only accepts on childless rows are UNCHANGED (fall through to the direct `accept_ai_suggestion` path).
**(2) BACKEND (`ai_assist.py` `accept_ai_suggestion`):** a NEW `accept_classification && _row_has_children(...)` guard
mirrors the existing `accept_parent` guard -- a classification accept on a with-children row now THROWS
"Restructure required" (closes the silent-break hole even if the frontend is bypassed). The childless classification
accept is unaffected. `save_review_restructure` / `resolve_effective` / `check_structural_integrity` UNCHANGED (the
frontend routes the with-children case to the EXISTING `save_review_restructure` reclassify+child-disposition path,
which already supports a class change with the row's own parent untouched [no `row_new_parent`] + `mark_ai_accepted`).
NO doctype JSON change -> NO migrate. **TESTS:** `test_ai_assist` 27 -> **29** (+2: G1 accept_classification on a
with-children row THROWS the guard, row unchanged + status Pending; G2 accept_classification on a CHILDLESS row still
works -> Accepted, class applied [guard does not over-fire]). `test_review_screen` 184 -> **185** (+1: R-fix4
mark_ai_accepted + new_classification + child_moves + NO row_new_parent -> class applied, children dispositioned,
status Accepted, the row's OWN human_parent UNCHANGED [= -1, resolves to its parser parent] -- the path the frontend
now routes to). All prior accept tests green. tsc 0 new wizard-file errors (filtered boq-wizard|ReviewTree|
RestructureModal -> empty) + Vite build exit 0 (PWA 164 entries). **NEXT = the boq_ai.log token-logging fix, then the
Phase-4 doc refresh.** Full UI detail in frontend/CLAUDE.md.)
// prior: 2026-06-20 (Phase 4 Slice AI-3c-1 -- AI-ACCEPT edit_log FROM-VALUE FIX (capture-then-flip) --
BACKEND, feat pending. A history-only correctness fix the AI-3b-2 live use surfaced: accepting an AI suggestion
recorded a WRONG edit_log (a parent change root->26 logged as the no-op "26 -> 26"; the classification change logged
"AI-class -> AI-class", which the frontend hides -> the change "vanished" from history). **The WRITES were always
correct** (human_* + effective values right, status Accepted); ONLY the logged from-value was wrong. **ROOT CAUSE
(recon-pinned):** BOTH accept paths flipped `ai_suggestion_status="Accepted"` on the in-memory doc BEFORE the
`_apply_and_save_row_edit` helper calls. The helper captures the edit_log from-value via `resolve_effective(doc)`
(`["effective_classification"]` / `["effective_parent_index"]`), and `resolve_effective` HONORS the AI layer the
moment status == "Accepted" -- so the premature flip made it return the very AI value the helper was about to write
-> from == to -> a no-op entry. **FIX = capture-then-flip (the ONLY change is WHEN the flip happens):** move the
status flip to AFTER all human writes, BEFORE the existing single commit, in BOTH paths. (1) `ai_assist.accept_ai_suggestion`
(AI-3b-1): removed the early `doc.ai_suggestion_status = "Accepted"`; after the classification/parent helpers it now
sets the in-memory attr + `frappe.db.set_value(_REVIEW_ROW, doc.name, "ai_suggestion_status", "Accepted",
update_modified=False)`. (2) `review_screen.save_review_restructure` (AI-3b-2): the `if mark_ai_accepted:` flip moved
from before the classification helper to after the child-reparent loop, before the commit, via the same in-memory-attr
+ `set_value` pair on `target_doc`. **ATOMICITY PRESERVED:** `set_value` runs IN the request transaction (no
auto-commit), so the function's SINGLE existing `frappe.db.commit()` still makes the human_* writes + the flip atomic
-- NO second independent commit. `resolve_effective`, `_apply_and_save_row_edit`, and ALL write/effective logic are
UNCHANGED. The child reparent from-values were never affected (children edit child_doc, not the AI'd target).
**TESTS:** `test_ai_assist` 24 -> **27** (+3: C1 childless parent accept logs from=None/root not the AI value; C2
classification accept logs from=prior-effective not the AI class; C3 the flip still lands Accepted + effective
correct). `test_review_screen` 181 -> **184** (+3: R-fix1 mark_ai_accepted parent from=root not "4->4"; R-fix2
accept-both class from=prior-effective; R-fix3 deferred flip still Accepted + effective correct -- each seeds
ai_suggested_* == the applied value to reproduce the live bug, so they only pass once the flip is deferred). All prior
accept tests (R1-R5, T1-T8) unchanged + green. NO doctype JSON change -> NO migrate. frontend/CLAUDE.md NOT touched
(backend-only; frontend was always correct -- it hid the no-op classification entry, which is now a real entry).
**NEXT = the boq_ai.log token-logging fix, then the Phase-4 doc refresh.**)
// prior: 2026-06-20 (Phase 4 Slice AI-3b-2 -- ACCEPT AI PARENT on a WITH-CHILDREN row via the
cancel-safe RestructureModal -- BACKEND + FRONTEND, feat pending. The FINAL piece of the AI accept/reject surface:
accepting an AI parent on a row that HAS children fires the existing RestructureModal (for child disposition) in a
new children-only mode, with the AI parent PRE-APPLIED and the status flip riding the modal's Save (never on cancel).
**THE AI ACCEPT/REJECT SURFACE (AI-3a + AI-3b-1 + AI-3b-2) IS NOW COMPLETE.** **(1) BACKEND -- `save_review_restructure`
gains `mark_ai_accepted=False` (last param, HTTP-coerced).** When truthy it sets `target_doc.ai_suggestion_status =
"Accepted"` AFTER `frappe.get_doc(target_name)` and BEFORE the first `_apply_and_save_row_edit`, so the helper's
`doc.save()` + the function's SINGLE existing commit make the human writes + the status flip ATOMIC (mirrors the
AI-3b-1 accept endpoint). **OPT-IN:** omitted/false (every pre-AI-3b-2 caller -- onPickClass, the #162 door) leaves
`ai_suggestion_status` byte-for-byte untouched. **CANCEL-SAFE BY CONSTRUCTION:** `save_review_restructure` is reached
ONLY via the modal's Save (recon cold-verified NO modal close path -- Cancel/Esc/close-X/overlay-dismiss -- calls the
backend; `onClose` is pure state reset, `onInteractOutside` prevents overlay-dismiss), so a cancelled modal never
flips the status. A test (R4) asserts the flip is opt-in (no flag -> status stays Pending). **(2) FRONTEND --
RestructureModal children-only mode (3 new OPTIONAL props):** `presetRowParent?` (internal index; -1=root),
`presetParentMessage?`, `markAiAccepted?`. When `presetRowParent !== undefined`: lazy-init `rowPosition="move"` +
`rowParentIdx=presetRowParent` (so `canSave`'s move-gate passes immediately) AND the keep/move radio + SheetSearchView
picker are REPLACED by a read-only indigo message line; the 5 child-placement options are UNCHANGED; `handleSave`
adds `mark_ai_accepted: true` to the payload. Undefined -> the modal is byte-for-byte unchanged. **(3) FRONTEND --
ReviewTree panel routing:** the parent checkbox is now ENABLED for with-children rows (the AI-3b-1 `parentBlocked`
disable is gone); `handleApplyAi` -- when `aiAcceptParent && hasChildrenSet.has(row_index)` -- OPENS the modal
(`setRestructureModal({row, newClassification, presetRowParent, presetParentMessage, markAiAccepted:true})`) instead
of calling `accept_ai_suggestion`. ACCEPT-BOTH folds into ONE restructure call: `newClassification` carries the AI
class (when its checkbox is a real change; else the no-op current class -- the #162 pattern), `presetRowParent`
carries the AI parent, `mark_ai_accepted` flips status once on Save. Childless / classification-only stay on the
AI-3b-1 `accept_ai_suggestion` path unchanged. NO doctype JSON change -> NO migrate. **TESTS:** `test_review_screen`
176 -> **181** (+5: R1 parent+children flip; R2 class+parent both + flip; R3 root accept; R4 no-flag leaves status
Pending [the cancel-safety semantic]; R5 plain restructure never flips). tsc 0 new wizard errors + Vite build exit 0.
**NEXT = the boq_ai.log token-logging fix, then the Phase-4 doc refresh.** Full UI detail in frontend/CLAUDE.md.)
// prior: 2026-06-20 (Phase 4 Slice AI-3b-1 -- ACCEPT/REJECT AI suggestions (NON-MODAL paths) --
BACKEND + FRONTEND, feat pending. Makes AI suggestions ACTIONABLE for the cases that do NOT need the
RestructureModal: accept an AI CLASSIFICATION, accept an AI PARENT on a CHILDLESS row, and REJECT. The
accepted-parent-on-a-row-WITH-CHILDREN path (which fires the modal) is AI-3b-2 (separate). **TWO NEW whitelisted
endpoints in `ai_assist.py`:** `accept_ai_suggestion(boq_name, sheet_name, row_index, accept_classification,
accept_parent)` -- bools (HTTP-coerced), at least one required. It REUSES the existing
`review_screen._apply_and_save_row_edit` chokepoint (imported, NOT reimplemented) to write the HUMAN layer to the AI
values (`human_classification = ai_suggested_classification`; parent: `ai_suggested_is_root==1 -> set_root=True` else
`human_parent = ai_suggested_parent`), AND sets `doc.ai_suggestion_status = "Accepted"` on the SAME doc before the
helper's `doc.save()` so human_* + the status flip land in ONE commit -- the row ends with human_* set AND status
Accepted (the frontend then renders "AI Accepted" instead of plain "Edited", and the badge clears). **SCOPE GUARD:**
`accept_parent` is rejected (`frappe.throw`) when the row HAS CHILDREN (`_row_has_children` -- the backend mirror of
ReviewTree's `hasChildrenSet` effective-parent walk, via `resolve_effective`); a childless row has no descendants so
no cycle is possible (that's why the cycle-guard `save_review_edit` runs is unnecessary here). Self-parent +
target-exists guards kept. `reject_ai_suggestion(boq_name, sheet_name, row_index)` -- sets `ai_suggestion_status =
"Rejected"` ONLY via `frappe.db.set_value` (the save_review_remark / dismiss_row_flags bypass): NO human_*, NO
edited_at/edit_log (a reject is not a data edit; the row stays "Original"); the suggested values stay in the ai_*
fields (audit of "what the AI suggested" preserved; badge clears because aiSuggestionInfo gates on Pending). Both
endpoints guard `_guard_sheet_not_frozen` + `_guard_sheet_not_parsing`. **FRONTEND (ReviewTree row-detail panel):**
a per-field "AI suggestion" block (shown only on a Pending suggestion + not readOnly) -- a classification checkbox +
a parent checkbox, each with a confidence badge + the suggested value (parent shown as an Excel row via `byIdx`, or
"Top level (root)"), the one `ai_explanation` line, and "Apply selected changes" + "Reject" buttons. Checkboxes
default-checked when the AI suggests a REAL change (differs from current effective); a parent change on a row WITH
children DISABLES the parent checkbox with a tooltip (that's AI-3b-2). Apply -> `accept_ai_suggestion` -> the
EXISTING `onSaved`->mutate refresh; Reject -> `reject_ai_suggestion` -> the mutate-only `onRemarkSaved` refresh. NO
doctype JSON change -> NO migrate. **TESTS:** `test_ai_assist` 16 -> **24** (+8: accept classification / childless
real-parent / childless root / both; with-children guard throws + row unchanged; nothing-to-accept throws; reject
status-only + no edited_at; accept-then-resolve_effective folds the value). `test_review_screen` **176/176**
unchanged (the imported `_apply_and_save_row_edit` is unchanged). tsc 0 new wizard errors + Vite build exit 0. **NEXT
= AI-3b-2** (the RestructureModal children-only mode for an accepted parent on a row WITH children + the cancel-safe
`mark_ai_accepted` coupling), then the boq_ai.log token-logging fix. Full UI detail in frontend/CLAUDE.md.)
// prior: 2026-06-20 (Phase 4 Slice AI-3a-FIX -- get_review_rows all_fields was missing the 4
status/suggestion ai_* fields -- BACKEND, feat pending. The AI Rec badges (+ tint + "AI Accepted" status) never
rendered though the pass reported "12 suggestions" and the data was correct in the DB. ROOT CAUSE: AI-3a assumed
`ai_suggestion_status` / `ai_suggested_classification` / `ai_suggested_parent` / `ai_suggested_is_root` "ride the
payload for free via resolve_effective's echo" -- WRONG. `resolve_effective(d)` READS those fields from the row dict
`d` and only re-emits what it read; `get_review_rows` built `d = dict(r)` from `all_fields`, which OMITTED those 4,
so `_get` returned None, the echo wrote None, and the frontend `aiSuggestionInfo` gate (`ai_suggestion_status ===
"Pending"`) was always false. FIX: add those 4 fields to `get_review_rows.all_fields` (the other 4 -- confidence x2,
level, explanation -- are display-only, never read by resolve_effective, and were already fetched by AI-3a). ONE
read-list change; no resolve_effective / frontend / doctype JSON change -> no migrate. VERIFIED: `test_review_screen`
**176/176 unchanged**; a fresh `get_review_rows("BOQ-26-00145", "HVAC ")` now returns 12 rows with
`ai_suggestion_status == "Pending"` + non-null suggestion fields (was None). Live web/worker reload needed for the
browser to pick it up. Frontend + stored data were already correct. Full detail in boq-upload-plan.md.)
// prior: 2026-06-19 (Phase 4 Slice AI-3a -- AI-PASS DISPLAY + TRIGGER (FRONTEND) -- mostly FRONTEND +
ONE additive backend read-list change. Makes the AI pass TRIGGERABLE + suggestions VISIBLE on the review screen;
does NOT make them actionable (accept/reject + the RestructureModal children-only mode are AI-3b). **BACKEND
CHANGE (the only one):** `get_review_rows` `all_fields` (`api/boq/wizard/review_screen.py`) gained 4 ai_* read
fields -- `ai_classification_confidence`, `ai_parent_confidence`, `ai_suggested_level`, `ai_explanation` -- so they
ride the per-row payload (the other 4 ai_* already arrive via `resolve_effective`'s echo: ai_suggestion_status /
ai_suggested_classification / ai_suggested_parent / ai_suggested_is_root). Purely ADDITIVE: no field removed/
reordered, no doctype JSON change, NO `bench migrate`; `test_review_screen` **176/176 unchanged**. **FRONTEND
(see frontend/CLAUDE.md for the full as-built):** the `ReviewRow` type gained all 8 ai_* fields + `BoQSheetDraft`
gained `ai_in_progress` + a new `AiPassDonePayload` type; a "Run AI pass" button (run_ai_pass) on SheetReviewPage
with a THREE-LAYER poll-safe completion (socket fast-path + poll-until-terminal GUARANTEE + on-mount recovery, so a
missed `boq:ai_pass_done` socket never hangs the screen -- the historical parse/upload failure mode); an "AI Rec"
column (confidence badges H/M/L + filter), an "AI Accepted" Status value, and a pending-suggestion row tint, all in
ReviewTree. Verify: tsc 0 new wizard-file errors + Vite build exit 0. **NEXT = AI-3b** (the accept/reject panel +
the RestructureModal children-only mode for an accepted parent), then the boq_ai.log token-logging fix. Full UI
detail in frontend/CLAUDE.md + boq-upload-plan.md "Phase 4 Slice AI-3a".)
// prior: 2026-06-19 (Phase 4 Slice AI-2e -- PARSE-RESPONSE HARDENING (extract array from prose) --
BACKEND, feat pending. Fixes a bug the FIRST LIVE end-to-end API cert surfaced: the real Anthropic model returns
explanatory PROSE BEFORE the JSON array (e.g. "Looking at the structure...\n\n[...]"), but `parse_ai_response` only
stripped code fences, so `json.loads` failed on the leading prose -> `_NonRetryable("AI response was not valid JSON:
Expecting value: line 1 column 1")` -> the whole pass returned ZERO suggestions. (The AI-2b unit tests mocked a CLEAN
array, so they never caught it -- a mock-too-clean gap.) **(1) NEW `_extract_json_array(text)` (boq_ai_assist.py)** --
extracts the first BALANCED JSON array from text, tolerant of prose before AND after. Runs `_strip_code_fences` first
(kept), then finds the FIRST `[` and walks forward tracking bracket depth to its MATCHING `]`, **STRING-LITERAL AWARE**
(toggles `in_string` on an unescaped `"`, tracks a backslash-escape flag, counts `[`/`]` ONLY when not in a string) --
so a `[` or `]` inside an `"explanation"` value never breaks the scan; on the matching close it slices `[...]` and
returns it (trailing prose dropped). No `[` at all, or no balanced close -> returns the stripped text UNCHANGED so the
caller's `json.loads` STILL raises `_NonRetryable` (genuine garbage is never silently swallowed). **NOTE (delta from
the build spec's 2a):** the spec proposed a "starts with `[` -> return as-is" fast path; that is WRONG -- a bare array
FOLLOWED by trailing prose starts with `[` yet hands `json.loads` an "Extra data" error (test T_P2 proved it). So the
balanced scan is the SINGLE path (it handles bare-array [first `[` at index 0], leading prose, trailing prose, and
string brackets uniformly); the naive fast path was dropped. **(2) `parse_ai_response`** -- the ONLY change is
`raw = _strip_code_fences(text)` -> `raw = _extract_json_array(text)`; the `json.loads` try/except -> `_NonRetryable`
and the not-a-list -> `_NonRetryable` checks are BYTE-FOR-BYTE UNCHANGED. **(3) PROMPT** -- `_AI_PASS_PROMPT_TEMPLATE`
gains a final hard rule line ("CRITICAL: output the JSON array and NOTHING else... starting with [ and ending with ]")
to reduce prose frequency; the parser change is the real safety net. `str.replace` `{SHEET_NAME}`/`{ROWS_JSON}`
convention preserved. **TESTS:** `test_boq_ai_assist` **15 -> 21** (+6 in `TestParseAIResponse`: leading-prose extract;
trailing-prose ignored; bracket-inside-explanation-string [the string-literal-aware proof]; the REAL-CERT-SHAPE
multi-line-prose-then-2-element-array reproduction; genuine-garbage-no-`[` still raises `_NonRetryable`; bare-array
regression -- the fenced-array path stays covered by the existing `test_parse_ai_response_strips_code_fences`). NO
doctype JSON change -> NO `bench migrate`. NO change outside boq_ai_assist.py + its test; frontend/CLAUDE.md
deliberately NOT touched (backend only). **NEXT = RE-RUN the LIVE end-to-end Anthropic API cert** (the prior cert
surfaced this bug; with the parser now prose-tolerant the suggestions should land + write back) covering re-parenting,
reclassification AND root, then AI-3 (frontend). Full detail in boq-upload-plan.md "Phase 4 Slice AI-2e".)
// prior: 2026-06-19 (Phase 4 Slice AI-2d -- ROOT-SUGGESTION FIX (`ai_suggested_is_root`) -- BACKEND,
feat pending. CLOSES the root-suggestion contract gap AI-2c flagged: "AI suggests this row become a top-level root"
is now both REPRESENTABLE and APPLYABLE. One cohesive change across the full chain (schema -> service -> write-back
-> resolve_effective). **NO frontend (AI-3).** **(1) SCHEMA `boq_review_row.json`** -- ONE new field
`ai_suggested_is_root` (Check, default 0, read_only=1) inserted in field_order immediately AFTER `ai_suggested_parent`
+ a mirror field def (mirrors `human_is_root`'s Check/default-0, carries the ai_* group's read_only). `bench migrate`
CLEAN (column verified via `has_column` -> true). **(2) `resolve_effective` (review_screen.py)** -- now reads
`ai_suggested_is_root` (alongside the other ai_* reads) and inserts ONE new branch into the effective_parent_index
ladder, giving the **FOUR-LAYER parent precedence: human_is_root > human_parent > ai_suggested_is_root >
ai_suggested_parent > parser**. The `human_is_root` short-circuit STAYS above the whole else-block (human-root still
wins). The new branch (`elif ai_accepted and ai_suggested_is_root: effective_parent_index = None`) sits BETWEEN the
human_parent branch and the ai_suggested_parent branch -- applies ONLY when `ai_suggestion_status == "Accepted"`. The
return dict gains `"ai_suggested_is_root": 1 if ... else 0` (echoed for the frontend, mirroring `human_is_root`). All
existing keys + behaviour BYTE-FOR-BYTE UNCHANGED except the added branch + key. **(3) `parse_ai_response`
(boq_ai_assist.py)** -- the null-root branch now sets BOTH `ai_parent = -1` AND a new `ai_is_root = True`; the
per-suggestion dict gains `"ai_suggested_is_root"`. The `parent_conf` guard widened to
`(ai_parent is not None or ai_is_root)` so a root suggestion (a parent opinion = "parent is nothing") KEEPS its
`ai_parent_confidence`. **`-1` on `ai_suggested_parent` now UNAMBIGUOUSLY means "no parent-index suggestion"** (the
root signal moved to the flag) -- the clean sentinel contract is restored. **(4) WRITE-BACK `_apply_ai_suggestions`
(ai_assist.py)** -- `ai_suggested_is_root` is the FIRST branch (replacing the AI-2c interim block + its warning):
root -> `stored_parent=-1`, `stored_is_root=1`, **`level=1`** (the genuine root level per `_effective_level`, where a
parentless node is level 1); NO_CHANGE (service None) -> -1/0/current-level; real parent -> parent's level+1.
`ai_suggested_is_root` added to the set_value write-back dict, to `_AI_DEFAULTS` (=0, so stale-clear resets it), and
to `_AI_FETCH_FIELDS` (the worker feeds rows into resolve_effective, which now reads the flag). **THE AI-2c INTERIM IS
REPLACED -- root suggestions are now fully functional end-to-end** (service emits flag -> write-back stores it ->
resolve_effective applies it as effective-root when Accepted). **TESTS (all green):** `test_review_screen` **170 ->
176** (+6 `TestResolveEffectiveAILayer`: AI_13 accepted-root -> None; AI_14 human_parent beats AI-root; AI_15
human_is_root + AI-root both root; AI_16 Pending root ignored -> parser; AI_17 flag echoed/coerced in the dict; AI_18
real-parent regression with root flag false; the local `_row()` helper gained `ai_suggested_is_root`);
`test_boq_ai_assist` **11 -> 15** (+4: root sets flag + keeps -1; root keeps parent_confidence; NO_CHANGE flag False;
real-parent flag False); `test_ai_assist` **14 -> 16** (the AI-2c interim test REPLACED by AI_A1 root sets flag/level=1;
+ AI_A2 end-to-end write-back -> Accept -> resolve_effective -> effective-root; + AI_A3 stale-clear resets the flag).
NO change to any file outside the slice scope; frontend/CLAUDE.md deliberately NOT touched (backend only). **NEXT =
the LIVE end-to-end Anthropic API cert (manual, on BOQ-26-00145/HVAC; the key is set in Desk) -- now covering
re-parenting, reclassification AND root** -- then AI-3 (frontend). Full detail in boq-upload-plan.md "Phase 4 Slice AI-2d".)
// prior: 2026-06-19 (Phase 4 Slice AI-2c -- AI-PASS ENDPOINT + WORKER + SOCKET + WRITE-BACK + CACHE --
BACKEND, feat pending. Wires the AI-2b stateless service into the LIVE flow, MIRRORING the parse flow
(`run_parse`/`_run_parse_worker`/`_publish_parse_event`) exactly. **NO frontend (AI-3).** ONE new module
`nirmaan_stack/api/boq/wizard/ai_assist.py`. **(1) ENDPOINT `run_ai_pass(boq_name, sheet_name)`** (`@frappe.whitelist()`)
-- guards in order: no review rows -> `{ok:False, error:"not_parsed"}`; `get_boq_ai_settings().enabled` false ->
`ai_disabled`; `get_boq_ai_api_key()` None -> `no_api_key`. **CACHE CHECK** (read): if `last_parsed_at` is set AND a
cached result exists for it, apply the cached suggestions SYNCHRONOUSLY (write-back) + return `{ok:True, cached:True,
count:N}` -- the "second click on the same parse" path, NO enqueue, NO API cost. Else `frappe.enqueue` the worker
(`queue="long"`, `timeout=600`, raw `frappe.generate_hash(length=32)` job id, `user=frappe.session.user`), set
`ai_in_progress=1` on the sheet draft AFTER a successful enqueue with its OWN `frappe.db.commit()`, return
`{ok:True, enqueued:True}`. **(2) STATUS ENDPOINT `get_ai_pass_status(boq_name, sheet_name)`** -- reads the per-sheet
Redis fallback (missed-socket recovery); else `{status:"idle_or_unknown", ai_in_progress:<0/1>}`. **(3) WORKER
`_run_ai_pass_worker(boq, sheet, user)`** -- mirrors `_run_parse_worker`: `if user: frappe.set_user(user)`; fetch rows
via `frappe.db.get_all` with an EXPLICIT field list (`_AI_FETCH_FIELDS` -- the structural fields the service reads +
the human + raw ai_* fields `resolve_effective` needs; `get_review_rows.all_fields` does NOT include the ai_* columns)
ordered `row_index asc`; merge `resolve_effective` into each row dict; re-read settings + key (FRESH PROCESS);
`boq_ai_assist.run_ai_pass(sheet, rows, settings, key)`; write-back; cache; `frappe.db.commit()` BEFORE publish;
`_publish_ai_event(... "success", count=len)`. On failure: `frappe.log_error` + `frappe.db.rollback()` +
`_publish_ai_event(... "error", error_code=)` + **`raise`** (so RQ marks the job failed -- matches parse). Error codes:
`_NonRetryable` -> **`ai_failed`**; unexpected -> **`internal`**. **(4) WRITE-BACK `_apply_ai_suggestions(boq, sheet,
rows, suggestions)`** -- `frappe.db.set_value` SCALAR BYPASS (no doc.save, no edit_log side-effects). **STALE-CLEAR
FIRST:** resets the 7 ai_* fields to defaults (`_AI_DEFAULTS`: ai_suggested_parent/level=-1, rest None) on every row of
the sheet that currently carries a non-null `ai_suggestion_status`, THEN applies the new pass (a re-run never leaves
orphaned Pending suggestions). Per suggestion: writes ai_suggested_classification/confidence/parent/parent_confidence/
level/explanation + `ai_suggestion_status="Pending"`. **LEVEL DERIVATION (`_effective_level`, walks the
effective-parent chain to root, root=level 1, bounded + visited-set so a cycle/dangling-parent -> -1):** real parent
(row_index>=0) -> parent's effective level + 1; NO_CHANGE (service None -> stored -1) -> the row's current effective
level; ROOT (see gap) -> -1. **(5) `_publish_ai_event(boq, sheet, status, user, **kwargs)`** -- the CHOKE-POINT
mirroring `_publish_parse_event`: CLEARS `ai_in_progress=0` on the sheet draft + its OWN `frappe.db.commit()` (so EVERY
exit path -- success + every error -- clears the flag, even after the error-path rollback), builds payload
`{status, boq_name, sheet_name, **kwargs}`, writes the per-sheet Redis fallback (best-effort try/except), then
`frappe.publish_realtime("boq:ai_pass_done", payload, user=user|broadcast)` -- COMMIT BEFORE PUBLISH, no after_commit.
**(6) CACHE:** `_ai_cache_key(boq, sheet, last_parsed_at)` -> `frappe.cache().set_value(..., expires_in_sec=6h)` of the
RAW suggestion list on worker success; a re-parse bumps `last_parsed_at` -> key miss -> fresh pass. In-flight tracking
uses `ai_in_progress` ONLY (NO ai_job_id/ai_enqueued_at field added this slice -- none exists; no self-heal). **ROOT-
SUGGESTION CONTRACT GAP (STOPPED + reported, NOT fixed here):** the AI-2b service returns `ai_suggested_parent==-1`
for a ROOT suggestion, but `resolve_effective` (AI-1) treats `-1` as "no suggestion" -- so a root suggestion is
INDISTINGUISHABLE from "no parent change" and cannot be applied. Per the slice's stopping condition NO schema change /
new field was invented. **INTERIM:** the write-back stores parent `-1` + level `-1` (so resolve_effective correctly
no-ops the parent) while PRESERVING any classification suggestion + explanation + status Pending, and `logger.warning`s.
Classification-only + real-parent paths are fully functional. **RECOMMENDED real fix (follow-up slice):** an
`ai_suggested_is_root` Check field mirroring `human_is_root`, consumed by `resolve_effective` -- touches the doctype
JSON + review_screen.py, both OUTSIDE AI-2c's exclusive file scope. **TESTS:** NEW `test_ai_assist.py` **14/14 OK**,
service (`boq_ai_assist.run_ai_pass`) + `frappe.enqueue` MOCKED, NO live API call (T1-T3 endpoint guards
not_parsed/ai_disabled/no_api_key; T4 enqueue + ai_in_progress=1; T5 write-back classification + real-parent; T6 level
derivation real-parent=2/NO_CHANGE=1; T7 stale-clear; T8/T9 in_progress cleared on success + on error-with-reraise;
T10 cache-hit skips enqueue + applies; T11 cache-miss-after-reparse enqueues; T12 classification-only leaves parent
-1; T13 root-suggestion interim drops parent keeps classification; + status idle shape). NO change to review_screen.py
/ parse_run.py / boq_ai_assist.py / any doctype JSON. Pure-backend -> root CLAUDE.md + boq-upload-plan.md substantive;
frontend/CLAUDE.md deliberately NOT touched. **NEXT = the LIVE end-to-end API cert (manual, on BOQ-26-00145/HVAC; the
key is already set in Desk)**, then AI-3 (the frontend: "Run AI pass" button + suggestion review UI + the
boq:ai_pass_done socket wiring + accept/reject). Full detail in boq-upload-plan.md "Phase 4 Slice AI-2c".)
// prior: 2026-06-19 (Phase 4 Slice AI-2b -- ANTHROPIC AI-ASSIST SERVICE (structure suggestions) --
BACKEND, feat pending. The SERVICE LOGIC ONLY of the AI pass: review rows -> Claude -> parsed structural
suggestions. **NO endpoint / worker / in-progress flag / socket (AI-2c) and NO frontend (AI-3)** -- the service is
callable + unit-testable in isolation with a MOCKED Anthropic client. **(1) DEPENDENCY:** added `anthropic>=0.111.0,<1.0`
to `pyproject.toml` (floor pinned to the resolved version so an older client API can't be selected; capped <1.0)
and installed into the bench env -- **resolved `anthropic 0.111.0`** (pulled httpx/anyio/jiter/h11/sniffio/httpcore/
docstring-parser; `pip check` shows NO anthropic-related conflict -- the only note is the PRE-EXISTING google-auth
one, unrelated; anthropic does not depend on google-auth). **(2) NEW `nirmaan_stack/services/boq_ai_assist.py`** --
mirrors `services/extraction/gemini.py`'s retry/backoff/transient pattern but calls the Anthropic SDK. **STATELESS BY
DESIGN:** `settings` (dict) + `api_key` (str) are INJECTED by the caller (the future AI-2c worker, via the AI-2a
helpers); the service NEVER reads `get_boq_ai_settings`/`get_boq_ai_api_key` itself (keeps it unit-testable).
**KEY DIFFERENCE from gemini:** terminal failure RAISES `_NonRetryable` (NOT `frappe.throw`) -- it runs in a worker,
which converts the raise into a socket error event. Components: module constants `_MAX_RETRIES=2`/`_BACKOFF_SECONDS=1.5`/
`_TRANSIENT_MARKERS` (OVERLOADED/RATE_LIMIT/429/500/502/503/**529**[Anthropic overloaded]/TIMEOUT/CONNECTION) +
`class _NonRetryable`; the VALIDATED prompt `_AI_PASS_PROMPT_TEMPLATE` embedded VERBATIM (BoQ_Phase4_AI_Pass_Prompt_v1_1,
validated vs 5 real sheets; filled via `str.replace` not `.format` because the body has literal JSON braces; slots
`{SHEET_NAME}`/`{ROWS_JSON}`); `build_rows_payload(review_rows) -> (json_str, idx_map)` (per-row excel_row=
source_row_number / classification / level / parent_excel_row [parent's source_row_number, None for root, translated
from the effective internal parent_index] / sl_no / description / unit; uses effective_* with raw fallback; ALL rows,
no cap; idx_map = excel_row -> internal row_index); `parse_ai_response(text, idx_map) -> list` (strips ```json fences;
keys output by INTERNAL row_index; parent translation **"NO_CHANGE" -> None / null -> -1 (root) / excel_row ->
idx_map row_index, unknown excel_row -> DROP parent + warn**; element with unknown excel_row SKIPPED entirely; invalid
classification [not in line_item/preamble/note/spacer] DROPPED, parent kept; `ai_suggested_level` deliberately NOT
computed here -- derived by the caller at write-back); `run_ai_pass(sheet_name, review_rows, settings, api_key) ->
list` (builds payload + prompt, `anthropic.Anthropic(api_key=...)`, `client.messages.create(model, max_tokens,
messages, timeout)`, retry loop `range(1,_MAX_RETRIES+2)`; `_safe_text` concatenates text blocks + raises
`_NonRetryable` on empty/non-end_turn stop_reason; `_is_transient` mirrors gemini). **TOKEN LOGGING:** a single
informational line via `frappe.logger("boq_ai").info(...)` (input/output tokens + model + sheet -- NOT the Error Log,
never logs the prompt or the key). **CACHING DEFERRED to AI-2c** (the worker holds the sheet-draft + last_parsed_at
context; the service is stateless -- noted in-code). **TESTS:** NEW `services/test_boq_ai_assist.py` **11/11 OK**,
Anthropic client MOCKED, NO live API call (payload shape + parent-is-excel-row; idx_map; parent translation
excel/null/NO_CHANGE; code-fence strip; unknown-excel-row drop; invalid-classification drop keeps parent;
run_ai_pass success via mocked client; retry-on-transient-then-succeed [time.sleep patched]; _NonRetryable on empty
response). NO endpoint/worker/socket/frontend (AI-2c). Pure-backend -> root CLAUDE.md + boq-upload-plan.md
substantive; frontend/CLAUDE.md deliberately NOT touched. **NEXT = AI-2c** (the whitelisted endpoint + `queue="long"`
background worker mirroring `run_parse`/`_run_parse_worker`/`_publish_parse_event` with an `ai_in_progress` flag +
a user-targeted `boq:ai_pass_done` socket + Redis fallback + the per-sheet caching + the `ai_*` write-back via the
`frappe.db.set_value` scalar bypass + the `ai_suggested_level` derivation); the live end-to-end API cert happens
AFTER AI-2c (the key is already set in Desk). Full detail in boq-upload-plan.md "Phase 4 Slice AI-2b".)
// prior: 2026-06-19 (Phase 4 Slice AI-2a -- BOQ UPLOAD REVIEW AI SETTINGS DOCTYPE + READER HELPERS --
BACKEND, feat pending. The settings home for the AI pass's Anthropic API key, MIRRORING the existing
`Document AI Settings` pattern exactly (recon-confirmed). Unblocks AI-2 (the AI service `boq_ai_assist.py`), which
will read the key + config via these helpers. **NO API KEY IN CODE/TESTS/DOCS** -- the key is entered MANUALLY via the
Frappe UI (Desk) after this lands. **(1) NEW Single doctype `BOQ Upload Review AI Settings`** (module Nirmaan Stack,
`issingle:1`, `allow_rename:1`, InnoDB, System-Manager-ONLY permission block [full RWCD + email/print/share],
autoname=Single). **OWNER-NAME DELTA (resolved):** the brief specified the name `"BOQ Upload & Review AI Settings"`,
but Frappe derives the controller module folder from `scrub(name)` which RETAINS `&` -> an invalid Python package
(`boq_upload_&_review_ai_settings`) and `bench migrate` THREW `ModuleNotFoundError`. Owner chose the `&`-free name
**`BOQ Upload Review AI Settings`** -> `scrub` = `boq_upload_review_ai_settings` (the specified slug exactly; no folder
rename). FIELDS (Section-Break grouped, mirroring the reference): config -- `enabled` (Check, default 0), `provider`
(Select `Anthropic`, default Anthropic), `model` (Data, default `claude-sonnet-4-6`), `max_tokens` (Int, default
8000), `request_timeout_seconds` (Int, default 120); credentials -- **`anthropic_api_key` (Password -- ENCRYPTED AT
REST, the load-bearing field; NEVER Data)**. **(2) CONTROLLER** `boq_upload_review_ai_settings.py` -- minimal
`class BOQUploadReviewAISettings(Document): pass` (the reference's `validate()` required-when-enabled is
provider-specific and deferred to AI-2; kept minimal per the brief). **(3) READER HELPERS
`nirmaan_stack/api/boq/wizard/ai_settings.py`** (mirror `services/extraction/files.py`): module const
`SETTINGS_DOCTYPE = "BOQ Upload Review AI Settings"`; `get_boq_ai_api_key()` -> `get_decrypted_password(SETTINGS_DOCTYPE,
SETTINGS_DOCTYPE, "anthropic_api_key", raise_exception=False)` -> `(value or "").strip() or None`, except ->
`frappe.log_error` + None (FAIL-CLOSED); `get_boq_ai_settings()` -> per-field perm-bypassing
`frappe.db.get_single_value` (enabled[bool]/provider/model/max_tokens/request_timeout_seconds), fail-closed to
`{"enabled": False, "request_timeout_seconds": 120}`, and DELIBERATELY never reads the secret key. NO caching (fresh
read each call, mirrors the reference). **TESTS:** NEW `test_ai_settings.py` **4/4 OK** (T1 key None when unset
[fail-closed]; T2 settings fail-closed default shape on an unset Single; T3 non-secret fields reflected after
`set_single_value`, restored via addCleanup; T4 the encryption invariant -- `anthropic_api_key` meta fieldtype ==
"Password"). `bench migrate` CLEAN after the rename (verified: doctype EXISTS, issingle 1, key fieldtype Password; no
orphan row left by the first failed sync). NO change to commit_pipeline.py / parse_run.py / review_screen.py / any
frontend / Document AI Settings. Pure-backend -> root CLAUDE.md + boq-upload-plan.md substantive; frontend/CLAUDE.md
deliberately NOT touched. Full detail in boq-upload-plan.md "Phase 4 Slice AI-2a". NEXT = AI-2 (the Anthropic service
`boq_ai_assist.py` + AI-assist/accept-reject endpoints) -- the key is set in the Desk UI before AI-2 can run live.)
// prior: 2026-06-19 (Phase 4 Slice AI-1 (AI auto-mapping) -- AI SUGGESTION FIELDS + resolve_effective
THREE-LAYER CHAIN -- BACKEND, feat pending. (formerly labelled P4-1; renamed to AI-N to avoid collision with the
completed committed-model-rebuild P4-1..P4-FINAL arc.) The first slice of the Phase-4 AI pass: the SCHEMA + the resolution wiring, NOTHING ELSE
(no AI service, no accept/reject endpoint, no frontend -- those are later slices). Phase 4 adds an AI pass that
analyses parser output and suggests corrections to classification / parent / level for rows the deterministic parser
got wrong; the suggestions are stored as ADDITIVE fields on `BoQ Review Row` and slot into the effective-value chain
BETWEEN the human and parser layers. **commit_pipeline.py needs ZERO changes** -- it reads only
`effective_classification` + `effective_parent_index` from `resolve_effective`, so extending that ONE function is the
entire wiring change. **(1) SCHEMA -- `boq_review_row.json`, +7 additive NULLABLE read_only fields (under a new
`ai_suggestions_section` Section Break at the field_order tail after `flags_dismissed_at`; `bench migrate` CLEAN):**
`ai_suggested_classification` (Data), `ai_classification_confidence` (Select `\nHigh\nMedium\nLow`),
`ai_suggested_parent` (Int -- SAME -1 sentinel as `parent_index`/`human_parent`: -1 = no suggestion/root, >=0 = a
real suggested parent), `ai_parent_confidence` (Select High/Medium/Low), `ai_suggested_level` (Int, derived-for-
display, NOT read by resolve_effective), `ai_explanation` (Small Text), `ai_suggestion_status` (Select
`\nPending\nAccepted\nRejected`). ALL 7: read_only=1, no reqd, no default, nullable. Written ONLY by the future AI
service + accept/reject endpoint -- NEVER by the parser or human edit layer. NOT list-JSON, so
`test_review_screen._ALL_LIST_JSON_FIELDS` is UNCHANGED. **(2) SCHEMA -- `boq_sheet_draft.json`, +1 field
`ai_in_progress` (Check, default 0, read_only=1)** appended at the field_order tail, MIRRORING `parse_in_progress`
exactly (the AI-pass in-flight flag for a later frontend slice; nothing reads it yet). **(3) `resolve_effective`
(review_screen.py) extended Human > Parser -> Human > AI-accepted > Parser:** reads 3 MORE fields
(`ai_suggestion_status`, `ai_suggested_classification`, `ai_suggested_parent`; 5 -> 8 via the same `_get` helper) and
returns 3 MORE keys (the same three raw values echoed for the frontend; 7 -> 10). The AI layer applies ONLY when
`ai_suggestion_status == "Accepted"`; None/""/Pending/Rejected ignore the ai_suggested_* fields entirely.
**CLASSIFICATION:** human_classification (non-empty) -> AI-accepted+suggested -> classification.
**PARENT:** human_is_root -> None; else human_parent>=0 -> human; else AI-accepted + ai_suggested_parent>=0 (norm
via the -1/None sentinel, so -1 = no suggestion, NEVER root) -> AI; else parent_index_norm. **The existing 7 return
keys are BYTE-FOR-BYTE UNCHANGED and the human layer ALWAYS wins where present -- no existing human-override path is
weakened** (proven: all 158 prior tests pass unchanged). NO signature change. **TESTS:** `test_review_screen`
**158 -> 170** (+12, all green): NEW `TestResolveEffectiveAILayer` (pure-Python, after `TestResolveEffective`,
shares an extended local `_row()` carrying human_is_root + the 3 ai_* params) -- AI-accepted classification/parent
used when no human override (AI_1/AI_5); human classification / human_parent / human_is_root each BEAT an accepted AI
suggestion (AI_2/AI_6/AI_7); Pending + Rejected ignored for both axes (AI_3/AI_4/AI_8); the -1 sentinel is NOT
applied as a suggestion (AI_9); the 3 ai_* keys are present in the returned dict (AI_10); a row with no ai_* fields
still resolves to the parser layer (AI_11); AI-accepted both axes at once (AI_12). The module-level `_minimal_row`
helper gained the 7 ai_* fields with no-suggestion defaults (ai_suggested_parent/level=-1, rest None/None status), so
every existing DB-test caller is unaffected. NO change to commit_pipeline.py / parse_run.py / any frontend / any
other doctype. Pure-backend -> root CLAUDE.md + boq-upload-plan.md substantive; frontend/CLAUDE.md deliberately NOT
touched (backend-only slice, no frontend change). Full detail in boq-upload-plan.md "Phase 4 Slice AI-1".)
// prior: 2026-06-18 (Slice F1 -- DURABLE PER-SHEET COMMIT-FAILURE PERSISTENCE -- BACKEND, feat
5c095b34. The backend half of the "needs attention" F-arc (F2/F3/F4 = the frontend, NOT this slice). Before F1,
`commit_boq`'s per-sheet failure handler built an in-memory `failed[]`, `frappe.log_error`'d the traceback, and
returned the envelope -- but PERSISTED NOTHING per-sheet, so once the HTTP response was gone a hub card had nothing
durable to read across sessions. F1 PERSISTS the per-sheet commit failure (reason + timestamp) on the `BoQ Sheet
Draft`, CLEARED on a successful re-commit -- the durable analog of Slice 1a's `parse_failure_*`. **BACKEND ONLY.**
**SHAPE = a PAIR, NO category Select (owner-confirmed):** commit exceptions are heterogeneous/freeform
(reconciliation divergence, controller validation throw, sheet-not-in-workbook, generic DB error), already flattened
to one string by `_commit_failure_reason`; a Select would be mostly "Other". **(1) SCHEMA (`boq_sheet_draft.json`,
+2 additive NULLABLE fields at the tail after `parse_failure_at`; `bench migrate` CLEAN, runtime columns verified
via `has_column` + `get_meta`):** `commit_failure_reason` (Small Text), `commit_failure_at` (Datetime, read_only). No
`reqd`, no default, NO data backfill (existing rows = NULL = "no commit failure" = correct). **(2) WRITE HOOK -- the
ORDERING is load-bearing:** in `commit_boq`'s per-sheet `except`, AFTER the MANDATORY Slice-5 `frappe.db.rollback()`
(UNCHANGED -- orphan-prevention), a NEW `_record_commit_failure(boq, sheet, reason)` (mirrors `_record_parse_failure`:
verbatim-#152 child lookup, `set_value` the two fields `update_modified=False`, no commit) THEN an explicit
`frappe.db.commit()` flushes ONLY the stamp. WHY: (a) the write is AFTER the rollback so the rollback does not sweep it
away; (b) the explicit commit is REQUIRED because `commit_boq` has NO trailing commit -- a LAST-sheet failure would
otherwise never be flushed; (c) the draft is a DIFFERENT doctype from the rolled-back grid/sheet/node tiers, so after
the rollback this `set_value` is the ONLY pending write and CANNOT re-flush a rolled-back tier write (T2 orphan-
prevention preserved). The `failed.append` now reuses the captured `reason` (no behaviour change). **(3) CLEAR HOOK:**
a NEW `_clear_commit_failure(boq, sheet)` (both fields -> None) folded into `_commit_one_sheet`'s trailing per-sheet
`frappe.db.commit()` (after the grid reconcile, before the commit), so a re-commit that now succeeds drops the stale
stamp ATOMICALLY with the grid/sheet/node write (mirrors 1a's clear-on-success). **PAYLOAD CONTRACT FROZEN:** the
`{committed, failed}` envelope is byte-for-byte unchanged -- the persisted fields are an additive SUPERSET of what
`failed[]` already returns. **TESTS:** `test_commit_pipeline` **44 -> 49** (+5, all green, in `TestCommitBoqPartialFailure`
+ a tearDown stamp-clear so committed stamps don't leak): persist-on-LAST-sheet-failure (the failing sheet is last ->
proves the explicit commit is load-bearing, non-vacuous); KEYSTONE survives-rollback-and-no-orphan (a POST-FREEZE
re-commit failure on the last sheet -- the prior version STAYS current [orphan-prevention] AND the stamp SURVIVES the
same rollback that discarded the freeze); clear-on-successful-recommit; clean-first-commit-leaves-NULL;
mixed-outcome-only-the-failed-sheet-stamped. The existing load-bearing T2 orphan-prevention test is UNTOUCHED + green.
NO change to parse_run.py / review_screen.py / the reconciliation internals / any frontend. Pure-backend -> root
CLAUDE.md + boq-upload-plan.md substantive; frontend/CLAUDE.md deliberately NOT touched (build-prompt scope; no
frontend change). Full detail in boq-upload-plan.md "Slice F1 -- durable commit-failure persistence".)
// prior: 2026-06-18 (Slice 2 -- COMMIT ROUND-TRIP RECONCILIATION (output-fidelity) -- BACKEND, feat
01c7dbaf. An AUTOMATIC, headless, EVERY-COMMIT verification that the committed tiers (node tree + per-area
children + faithful grid) equal what the commit PRODUCED. Runs at the tail of each per-sheet write path, BEFORE the
per-sheet `frappe.db.commit()`; a divergence `frappe.throw`s and the EXISTING Slice-5 per-sheet isolation converts
the sheet into a clean `{failed}` entry (rollback + reason) -- NO new plumbing, isolation boundary UNCHANGED.
Recovers the dropped Slice-6 dogfood as an always-on check. **BACKEND ONLY.** **LOCKED SCOPE = OUTPUT-FIDELITY, not
logic-correctness:** verifies ONLY that the value each transform PRODUCED was COPIED to the DB accurately; it does
NOT judge whether a produced value is *correct* (valid parent, no cycles, sane rates, declared area,
level-monotonicity = VALIDITY = tendering's job = OUT OF SCOPE -- no coherence checks built). **ONE CHECK TYPE, two
anchors:** (a) COPIED fields -> `stored == transform(review-row source)` reusing the in-hand `node_rows` snapshot
(code/sort_order/source_row_number/description-cascade/unit/make_model/node_type/row_class/qty[Line-Item None->0]/
the six money fields[word-order reversal]/is_rate_only/is_synthetic/human_is_root[bool]/human_classification/
human_parent[-1 sentinel]/notes[row_notes rename]/append_notes_raw/attached_notes/edit_log[JSON, empty-normalized]/
the per-area children[deterministic explosion, flat-stays-flat for free]); (b) DERIVED (EXACTLY TWO) -> `stored ==
CAPTURED producer output`, NEVER re-running the producer: `parent_node = name_by_idx.get(eff_parent_by_idx.get(idx))`
(the captured eff-parent map + pass-1 insertion record -- the exact lookup pass-2 used; re-running resolve_effective
would be the self-confirming trap), `level = docs_by_idx[idx].level` (the in-memory value the producer built -- a
THIN tripwire: nothing mutates level today so it can't fire under current code, kept for near-zero-cost regression
value). Plus a node-COUNT check (produced rows vs current stored nodes -> catches a finalized sheet that should have
nodes but persisted none) + a grid row_number/cells compare. **Numerics compared rounded to the field's own
`frappe.get_precision` (money 2dp via empty `currency_precision`; qty 3dp via `float_precision`) -- NEVER raw float
equality -- so the Float->Currency coercion never false-flags** (day-N census: 0 divergences across 584 resolvable
nodes at 2dp). Source values reused from `node_rows`/`grid_rows` (no re-query drift); stored read fresh in-transaction
(Frappe sees the uncommitted writes). **SUPPRESS-SET encoded exactly** (blank-qty=0, placeholder description,
flat-stays-flat[absent kind == 0], gen-specs 0 nodes, minted `commit_provenance_id` + versioning triple + `path` +
`boq` EXCLUDED from compare, spacer grid-only, note/subtotal/header_repeat -> Other money-null, -1 sentinel, bool
coercion). **TWO HELPERS** (`_reconcile_node_tree` inline at `_commit_node_tree` tail; `_reconcile_grid` from
`_commit_one_sheet` before commit) -- no signature change. **TESTS:** `test_commit_pipeline` **33 -> 44** (+11):
MUST-FIRE (6: corrupted money, dropped per-area child, zero-node finalized, wrong parent_node, mutated level,
corrupted grid -- each tampers the STORED side after write via a reconcile-helper wrapper, no production-code
change) + MUST-NOT-FIRE (5: flat-stays-flat, blank-qty/placeholder-desc, gen-specs 0 nodes,
note-Other-money-null+dropped-spacer-parent-root, re-commit versioning-excluded); the existing 33 faithful-commit
tests stay green (the reconcile does not break a normal commit). NO schema change, NO migration. Pure-backend ->
boq-upload-plan.md + root CLAUDE.md substantive; frontend/CLAUDE.md NOT touched (no frontend change). Full detail in
boq-upload-plan.md "Slice 2 -- commit round-trip reconciliation".)
// prior: 2026-06-18 (Slice 1b -- CONFIG STALENESS DETECTION (proactive #166) -- BACKEND, feat 32e31a2a.
The PROACTIVE half of issue #166 (S1-1/S1-2). Slice 1a made the REACTIVE half durable (reason persisted when a
stale config is DROPPED at parse). 1b flags a stale config ON READ -- before the user triggers a parse -- so a
later hub-card slice can show "reconfigure this sheet" without first hitting a parse failure. **BACKEND ONLY**
(read-only endpoint; the hub-card render is a SEPARATE later frontend slice). **VERDICT IMPLEMENTED = validate-on-
read (recon's approach B), ZERO SCHEMA:** NO fingerprint, NO version-stamp, NO doctype change, NO migration. A
field-name fingerprint MISSES the dominant real staleness (`ColumnRole` Literal token renames + the
`_AREA_COMPATIBLE_ROLES` / `model_validator` changes that actually caused #166) and a deep fingerprint can never
capture imperative validator logic; so 1b runs the SAME `SheetConfig.model_validate` the parser runs -- catching
everything a parse would and tracking the live model automatically (the property whose ABSENCE caused #166).
**(1) SHARED HELPER `_validate_sheet_blob(blob, sheet_name) -> Exception | None`** (parse_run.py) -- the SINGLE
SOURCE OF TRUTH for "does this saved config still validate", used by BOTH the reactive parse-drop path
(`assemble_mapping_config` Rule 3 / 1a) and the proactive read path (1b). INJECTS sheet_name (production 6-key
blobs OMIT it; `SheetConfig.sheet_name` has no default -- WITHOUT injection EVERY blob false-positives -- the #1
cry-wolf trap) and catches a malformed/non-dict blob. Reason text centralized in `_stale_empty_reason(status)` /
`_stale_invalid_reason(exc)` so the reactive + proactive messages are BYTE-IDENTICAL. `assemble_mapping_config`
Rule 3 REFACTORED to call the helper + builders -- BEHAVIOR-PRESERVING for 1a (the success path re-validates only
to obtain the model object, a cheap behaviour-identical re-parse; `TestParseFailureReason` stays green). The empty-
blob sub-branch stays its own 1a case (NOT routed through model_validate). **(2) NEW `get_stale_sheets(boq_name)`**
`@frappe.whitelist()` bare (READ-ONLY, GET-capable, mirrors `get_committable_sheets`). Returns `{"stale_sheets":
[{sheet_name [VERBATIM #152], reason}, ...]}`. **ROUTING PARITY with assemble (no new gating):** general-specs
pointer / Hidden / Skip -> never stale; Pending / Parse failed / Finalized / blank -> not a data sheet here, never
stale (UNCONFIGURED != stale -- no cry-wolf; Finalized is data-eligible only under force_reparse, which this normal
read does not assume -- gate is `status in _RULE3_BASE_STATUSES` = {Config Done, Parsed}); Config Done / Parsed with
a NON-EMPTY invalid blob -> STALE (reason = validation detail); Config Done / Parsed with an EMPTY blob -> STALE
mirroring 1a's empty-on-done. **PURE READ -- writes NOTHING** (no set_value/insert/save/commit; write-on-read was
explicitly rejected). Guard mirrors `run_parse` ("boq_name is required." / "BOQs '...' not found."). **COMPOSITION
with 1a:** same validation at two triggers (1a reactive persists to `parse_failure_*`; 1b proactive computes a
transient flag); the shared helper guarantees identical verdicts -- proven by a test asserting 1b's verdict + reason
MATCH 1a's reactive stamp byte-for-byte. **TESTS:** `test_parse_run` **93 -> 102** (+9 `TestGetStaleSheets`:
invalid-blob-stale-with-reason, Parsed-status parity, valid-prod-blob-not-stale [the sheet_name-injection proof],
unconfigured-not-stale, Finalized-not-stale [force_reparse=False], general-specs/Skip/Hidden-not-stale,
empty-on-done-stale, proactive-matches-reactive, guard); 1a regression green. NO doctype change -> NO `bench
migrate`. Pure-backend -> boq-upload-plan.md + root CLAUDE.md substantive; frontend/CLAUDE.md NOT touched
(build-prompt scope; no frontend change this slice). Full detail in boq-upload-plan.md "Slice 1b -- config
staleness detection".)
// prior: 2026-06-18 (Slice 1a -- PARSE REASON-BUNDLE (reactive #166) -- BACKEND, feat e4b1fefc.
The reactive half of issue #166 / principle P2 ("stop erasing the why"): the per-sheet parse-failure REASON,
previously computed and then discarded (STALE config drops -> an unqueryable `logger.warning` + a nameless
`not_eligible` list; PARSER/INSERT crashes -> a coarse `error_code` + Error Log only), is now PERSISTED to three
NEW additive fields on `BoQ Sheet Draft` so a LATER frontend slice can render a hub-card notice. **BACKEND ONLY**
(no frontend built). **PURELY ADDITIVE + TRUTHFUL:** the done-event payload contract
(`{status,boq_name,parsed_sheets,not_parsed_sheets,failed_sheets}` / `{status,boq_name,error_code}`) stays
BYTE-FOR-BYTE FROZEN; `wizard_status` writes and the displayed prior rows are UNCHANGED (the notice's whole point
is "the rows you see are from the PRIOR parse"). **SCHEMA (`boq_sheet_draft.json`, +3 nullable fields, `bench
migrate` CLEAN, runtime columns + Select options verified via get_meta):** `parse_failure_category` (Select
`""`/`Config stale`/`Parser error`/`Insert error` -- the S2-8 taxonomy, the three IN-SCOPE failures ONLY;
skip/hidden/ineligible/general-specs/empty are NOT failures and are deliberately absent), `parse_failure_reason`
(Small Text), `parse_failure_at` (Datetime, read_only). **THREE IN-SCOPE FAILURE CASES (sheets that were eligible,
attempted, and went wrong):** (1) **STALE** -- `assemble_mapping_config` Rule-3 empty-blob + invalid-blob branches;
captures the `SheetConfig.model_validate` exc text (the precise "which field-set is now invalid" detail). Written
via a NEW `_record_parse_failure(boq,sheet,category,reason)` helper that writes ONLY the three failure fields,
**NEVER `wizard_status`** (the stale drop has NO status write today and must keep none -- P-d confirmed); (2)
**PARSER error** -- worker Step-4 `parse_boq` raise; (3) **INSERT error** -- worker Step-5 per-sheet insert except.
(2)+(3) FOLD the reason into the EXISTING `"Parse failed"` write via `_set_draft_status(extra_fields=...)` (same
`set_value`, no new/changed status). **S2-5 TRACEABLE HANDLE:** verified `frappe.log_error` RETURNS the inserted
Error Log doc (`frappe/utils/error.py` `return error_log.insert(...)`); a new `_reason_with_ref` appends `(ref:
Error Log <name>)` when available, never fabricated (None under read_only/defer_insert). **CLEAR-ON-SUCCESS:** all
three fields cleared (folded into the existing `"Parsed"` `set_value` alongside has_prior_parse/last_parsed_at), so
a fixed sheet drops its stale notice. **NON-FAILURES UNTOUCHED:** skip/hidden/ineligible/general-specs get NO
reason (proven by test). **TESTS:** `test_parse_run` **86 -> 93** (+7, all green: stale invalid-blob [exc detail
captured, status+prior-rows untouched], stale empty-blob, parser error [+handle], insert error, clear-on-success,
non-failures-untouched, done-event payload FROZEN). PARKED/out-of-scope (NOT built): EMPTY-but-marked-Parsed (E8,
success-path mis-classification), config staleness DETECTION/version-stamp (Slice 1b -- shares the "reconfigure"
signal origin = the Rule-3 blob validate guard), per-sheet parse isolation (DA-1), any payload reshape, all
frontend. Pure-backend -> boq-upload-plan.md + root CLAUDE.md substantive; frontend/CLAUDE.md deliberately NOT
touched per the build-prompt scope (no frontend change this slice). Full detail in boq-upload-plan.md "Slice 1a --
parse reason-bundle".)
// prior: 2026-06-17 (Phase 5 -- X: COMMIT ALL CLASSIFIED ROWS EXCEPT SPACER AS SEMANTIC NODES --
BACKEND, feat 711a792b. Makes the committed node tree a COMPLETE SEMANTIC MIRROR of the reviewed BoQ. Before X,
only preamble + line_item committed as nodes; note / subtotal_marker / header_repeat were grid-only, so the node
layer was not a full semantic record (the dogfood surfaced a note losing its discrete classification + parent in
the node tree). **NODE SHAPE = OPTION A (owner-locked):** `node_type` stays the PRICEABILITY axis (Preamble / Line
Item) + a NEW neutral 3rd Select value **`Other`** for non-priceable rows; a NEW field **`row_class` (Data)** carries
the FULL effective classification (preamble/line_item/note/spacer/subtotal_marker/header_repeat) -- the TAXONOMY
axis. A future pricing walk stays EXACTLY `node_type in (Preamble, Line Item)`, unchanged. **ROWS COMMITTED AS
NODES:** preamble, line_item, note, subtotal_marker, AND header_repeat (defensive -- ZERO live data). **SPACER alone
stays GRID-ONLY** (pure layout, no semantic content; the faithful grid preserves its position) -- the filter is now
"commit everything EXCEPT spacer", not "only preamble+line_item". **node_type mapping:** preamble->Preamble,
line_item->Line Item, every other committed class (note/subtotal_marker/header_repeat)->Other; `row_class` = the full
effective classification for EVERY node. **(1) SCHEMA (`boq_nodes.json`, migrate CLEAN -- additive Select value + one
Data field):** node_type `Preamble\nLine Item` -> `Preamble\nLine Item\nOther`; new `row_class` Data placed after
node_type. **(2) CONTROLLER (`boq_nodes.py`):** the description-required throw is GATED to `node_type in (Preamble,
Line Item)` so an `Other` node may be contentless and no-ops; EVERY other validation branch (Preamble level rules,
Line-Item level-unset/qty-required, parent rules, combined_rate, qty_by_area) already falls through both `if/elif`
branches for `Other` -- confirmed, no other relaxation needed. `row_class` is stored, never validated. **(3)
PIPELINE (`commit_pipeline.py`):** `_NODE_CLASSIFICATIONS` (={preamble,line_item}) RETIRED -> `_PRICEABLE_
CLASSIFICATIONS` (={preamble,line_item}, for node_type + the level calc) + `_GRID_ONLY_CLASSIFICATIONS` (={spacer},
the skip set); the `_commit_node_tree` filter flips from "not in node-set -> skip" to "in grid-only-set -> skip".
`_build_node_pass1` sets `node.row_class = effective_classification` for every node and node_type via a 3-way branch
(preamble->Preamble+level, line_item->Line Item, else->Other); the `qty None -> 0` default STAYS Line-Item-only
(Other rows carry no qty/rate/amount -- none exist on the review row). **Q8 LEVEL-GUARD FIX (mandatory -- X would
break it otherwise):** `_compute_levelless_preamble_levels` now counts ONLY PRICEABLE (preamble/line_item) children
toward `child_levels`; a note/subtotal (level 0) is NOT a structural child and would wrongly pull a level-less
preamble to level 0. A preamble whose only children are non-priceable now falls to the childless branch. **NO NOTE
RE-ATTACH:** the parser ALREADY rolls descendant note text onto the nearest preamble's `attached_notes` (recon:
populated on 84 preamble review rows, NEVER on note rows) and 3b carries it verbatim onto the preamble node; X
commits the note as its OWN discrete node WITHOUT a second attach (a second walk would DOUBLE the text). preamble /
line_item commit EXACTLY as before, including their existing attached_notes carry. **TESTS:** `test_commit_pipeline`
23->27 (+4: commit-all-except-spacer [note+subtotal->Other, correct row_class, note wired to preamble, spacer NOT a
node]; Other note carries description + no money; attached_notes NOT doubled; Q8 note-child excluded from level calc;
+ 2 existing node-tree tests RETARGETED in place -- note now a node, counts 3->4); `test_boq_nodes` 72->74 (+2: Other
saves cleanly [no level/qty]; Other under a Preamble saves); `test_review_screen` **158 UNCHANGED** (import safe);
parser **597 UNCHANGED**. `bench migrate` CLEAN (`row_class` column + the `Other` Select value verified via get_meta).
**RE-COMMIT of all affected finalized sheets + a round-trip RE-VERIFY (with an attached_notes verification column)
are SEPARATE NEXT runs before push** -- the live committed nodes still reflect the pre-X 2-type tree until
re-committed. Pure-backend -> root CLAUDE.md + plan only; frontend/CLAUDE.md NOT touched (no frontend reads nodes).
Full detail in boq-upload-plan.md "Phase 5 -- X: commit all classified rows as semantic nodes".)
// prior: 2026-06-17 (Phase 5 -- LEVEL-LESS PREAMBLE GUARD FIX (post-dogfood) -- BACKEND, feat pending.
A real commit-pipeline correctness fix the dogfood surfaced: `_build_node_pass1` stamped a flat `level=1` on ANY
preamble whose parser level was unset/0, which BREAKS the tree when a child is also level 1 (BOQ-26-00145
'Electrical ' row 18 "Note:" -> 1, but its child row 20 is level 1 -> parent==child level). Read-only recon found
exactly 3 live cases (all committed at the buggy 1), no squeeze/inversion edges. **THE FIX:** (1) RELAX the
constraint -- `integrations/controllers/boq_nodes.py` Preamble guard `level is None or level < 1` -> `< 0` (message
"...non-negative integer..."); preambles may now be level 0 (the JSON `level` is a plain Int, no min -> NO doctype
change, NO migrate). (2) REWRITE the guard -- `commit_pipeline.py`: a NEW module-level `_real_preamble_level(d)`
(override>=1 wins, else level>=1, else None=level-less) + `_compute_levelless_preamble_levels(sheet_name,
node_rows, eff_parent_by_idx)` computed ONCE per sheet in `_commit_node_tree` (reuses the eff map, no re-resolve)
and passed into `_build_node_pass1`. RULE for a level-less preamble: **WITH children -> max(0, min(child
effective-level) - 1)** (shallowest child wins; line-item children count as level 0); **CHILDLESS -> the sheet's
shallowest DEFINED preamble level, else 0** (a sheet of line-items + a lone promoted preamble has no defined levels
-> 0). A normal preamble with a real >=1 level is UNCHANGED. SAFETY (loud, not hit by current data): a level-less
preamble with BOTH a parent and children whose computed level wouldn't sit above the parent (squeeze) ->
`frappe.msgprint` warning + best-effort assign (never silently jam). **THE 3 REAL CASES (now tested with seeded
rows, not live data):** children all level 1 -> 0 (Electrical row 18); children mix level-0 line-items + level-1
preamble -> 0 (low side row 191, min child 0); childless, sheet has no levels -> 0 (Fire Fitting row 8). **TESTS:**
`test_boq_nodes` 71->72 (`test_preamble_level_zero_rejected` retargeted -> `..._zero_saves` [level 0 persists] +
NEW `..._negative_rejected` [level -1 still throws]); `test_commit_pipeline` 19->23 (+4: with-children, mixed-min,
childless-no-levels, normal-multilevel-unchanged regression); `test_review_screen` 158 UNCHANGED (import safe);
parser **597 UNCHANGED**. NO migrate (no schema JSON change). **AFFECTED COMMITTED SHEETS NEED RE-COMMIT +
round-trip RE-VERIFY (a SEPARATE run) before push** -- the 3 live cases are still committed at the buggy level=1
until re-committed. Pure-backend -> root CLAUDE.md + plan only; frontend/CLAUDE.md NOT touched. Full detail in
boq-upload-plan.md "Phase 5 -- level-less preamble guard fix".)
// prior: 2026-06-17 (Phase 5 Slice 3b -- THE NODE TREE + provenance + three-tier versioning +
combined_rate relaxation -- BACKEND, feat pending. FILLS the node-write stub Slice 3a left in commit_pipeline.py;
the second real-data-write slice. **TWO-LAYER MODEL:** a FINALIZED sheet now ALSO commits a node tree (the grid
stays from 3a); general-specs sheets remain grid-only. **(1) SCHEMA adds (migrate clean):** BOQ Nodes gained
`review_row_name` (Data -- source BOQRR- name, human-readable tie, MAY DANGLE on re-parse) + `commit_provenance_id`
(Data -- frappe.generate_hash, the DURABLE provenance key) + `is_synthetic` (Check -- FUTURE-INSURANCE, 0 across the
whole current corpus, carried verbatim) + `append_notes_raw` (JSON, dict-valued -- unflagged-by-recon add, owner-OK)
+ the per-node versioning triple `commit_version`/`is_current`/`committed_at`; BoQ Sheet gained the SAME versioning
triple (it had none -- only the grid did). **(2) combined_rate THROW -> WARNING** (capture-only): parent
(`boq_nodes.py`) + child (`boq_node_qty_by_area.py`) `frappe.throw` -> `frappe.msgprint(alert,indicator=orange)`;
the node saves, values persist verbatim, tendering reconciles. 3 throw-tests RETARGETED to assert-saves
(`test_combined_rate_mismatch_warns_not_throws`, `..._leaf_preamble_combined_rate_mismatch_warns`,
`..._child_combined_rate_mismatch_warns_not_throws`); the 5 success tests untouched. **(3) NODE BODY
(`_commit_node_tree` replaces the stub):** reads review rows ({boq, sheet_name VERBATIM #152}, row_index asc),
runs `resolve_effective` (imported from review_screen, NOT reimplemented), maps `effective_classification` ->
node_type: **preamble -> Preamble (+level), line_item -> Line Item (no level); note/spacer/subtotal_marker/
header_repeat -> GRID-ONLY, NOT nodes** (the Select has exactly Preamble+Line Item). **TWO-PASS + DEFERRED LIST
FIELDS (the load-bearing mechanic):** BOQ Nodes has LIST-valued JSON fields (`attached_notes`, `edit_log`) that
`doc.save()`'s get_valid_dict rejects ("cannot be a list"). So PASS 1 inserts each node parent-less with those two
fields NULL (dict-valued `append_notes_raw` IS set in pass 1 -- only LISTs trip the wall); PASS 2 sets parent_node +
`doc.save()` in ANCESTOR-DEPTH order (paths cascade correctly + the parent-chain validation re-runs as a free
integrity check) -- list-safe because the two list fields are still null; PASS 3 writes `attached_notes`+`edit_log`
via `frappe.db.set_value(json.dumps(...))` (targeted column write, bypasses full-doc serialization). **MONEY = P4-3
word-order reversal, Float->Currency (Frappe coerces, no manual round):** rate_supply->supply_rate /
rate_install->install_rate / rate_combined->combined_rate / amount_supply->supply_amount /
amount_install->install_amount / amount_total->total_amount; qty_total->qty (Float stays Float); sl_no_value->code,
row_index->sort_order. is_rate_only/is_synthetic carried verbatim. **HUMAN LAYER carried as PROVENANCE ONLY**
(human_classification/human_parent[-1 sentinel]/human_is_root copied verbatim, NEVER branched on -- the LIVE wiring
is parent_node+node_type+level from resolve_effective). **edit_log CARRIED** (P4-4: the node is the durable home for
the review row's edit history; review rows die on re-parse). notes<-row_notes; attached_notes carried verbatim
(Option A -- no aggregation/up-roll). **(4) PER-AREA CHILD explosion (`_explode_area_children`) -- DUAL-SHAPE,
NEVER DOWNGRADE (owner-locked):** qty_by_area always flat {area:float}->child.qty (defaults 0.0 for an area absent
from qty but present in rate/amount -- child.qty is reqd); rate_by_area NESTED {supply_rate,install_rate,
combined_rate}->each preserved on its own column, FLAT scalar->combined_rate ONLY; amount_by_area NESTED {supply,
install,total}->supply_amount/install_amount/total_amount each preserved, FLAT scalar->total_amount ONLY;
area_name=dict key verbatim. (Recon's nested-only assumption was WRONG -- the real corpus is FLAT; current parser
output is nested -- both handled. STOP-CHECK 4c-i finding.) **(5) THREE-TIER SHARED VERSIONING + BoQ Sheet FOLD:**
ONE shared commit_version per (boq, sheet) (anchored on grid max+1) covers grid+sheet+nodes. On re-commit each tier
FREEZES its prior current via `frappe.db.set_value(is_current=0)` -- NEVER doc.save() (BoQ Sheet's list-valued
area_dimensions would re-serialize and hit get_valid_dict). **3a's raw-DELETE of the prior BoQ Sheet is RETIRED ->
freeze-and-supersede** (prior sheet+its nodes survive as a coherent frozen vN snapshot; v1 nodes stay attached to
frozen sheet v1). **(6) CENTRALIZED is-current accessor `_current_names(doctype, boq, name_field, value)`** (recon
Q5: none existed) -- one helper, three callers (grid:source_sheet_name, sheet:sheet_name, nodes:sheet). Gate
re-check (3a) intact. **TESTS:** test_commit_pipeline 11->19 (node tree built preamble+line-items-only/note+spacer
skipped; provenance+flags; human-layer+notes+edit_log+append_notes_raw carried; per-area nested-granularity-survives
+ flat->total/combined; combined_rate warns-not-throws; three-tier re-commit freeze; is-current accessor; +T7
retargeted to versioned-not-deleted); test_boq_nodes 71 (3 retargeted, capture-only); test_review_screen 158
UNCHANGED (resolve_effective import safe); parser **597 UNCHANGED**. `bench migrate` CLEAN. **LIVE TEST (scripted,
second real-data crossing) BOTH PASS:** FLAT BOQ-26-00145 FAS -> 21 nodes (5 Preamble+16 Line Item, note/spacer
skipped from 1001 grid rows), parent tree wired 0-dangling, money verbatim, provenance set; re-commit froze
grid+sheet+nodes to one shared version, prior sheet NOT deleted (frozen), one current per tier. NESTED BOQ-26-00166
VRF System (set Finalized as test setup) -> 69 nodes, per-area L1/L2 supply_rate/install_rate/combined_rate each
SURVIVE on committed children (granularity preserved). Pure-backend slice -> root CLAUDE.md + plan only;
frontend/CLAUDE.md NOT touched (no frontend change). NEXT = Slice 4 (hub commit UI / version picker / Committed
status). Full detail in boq-upload-plan.md "Phase 5 Slice 3b".)
// prior: 2026-06-16 (Phase 5 Slice 3a -- GRID FOUNDATION + doctype rename + column-config snapshot +
single-open commit shell -- BACKEND, feat pending. The FIRST slice of the commit pipeline + the FIRST to write
REAL parsed BoQ data into the committed schema. **TWO-LAYER MODEL:** every committable sheet commits its COMPLETE
original as a FAITHFUL GRID (all 6 row classifications, original position) into the renamed faithful-grid doctype;
FINALIZED sheets will ALSO commit a node tree -- but that is Slice 3b (a PURE STUB here, dispatched + no-op). **(1)
RENAME** `BoQ Committed General Specs` -> **`BoQ Committed Sheet Grid`** (+ row child -> `BoQ Committed Sheet Grid
Row`): folders/JSONs/controllers/classes/test all renamed; autoname **`BCGS-` -> `BCSG-`** (free, zero rows).
Frappe `migrate` AUTO-DELETED the orphaned old DocTypes (built-in orphan cleanup -- "Orphaned DocType(s) found ...
Deleting") -- harmless (zero rows, no callers); NOT a `delete_doc` I added. **(2) NEW field `sheet_disposition`**
(Select `grid_only`/`grid_and_nodes`) on the grid doctype -- a closed set paralleling the Slice-2 gate vocabulary
(room for a future 3rd disposition without a 2nd boolean). MAPPING (ties to the gate, not re-derived): gate
`general_specs` -> `grid_only`; gate `finalized` -> `grid_and_nodes`. (`commit_version`/`is_current`/`committed_at`
already existed from Slice 1.) **(3) NEW `nirmaan_stack/api/boq/wizard/commit_pipeline.py`:** `commit_boq(boq_name,
sheet_subset)` (whitelisted POST) -- re-checks EVERY subset sheet against the LIVE Slice-2 gate (throws on any
not-eligible BEFORE any fetch/write; never trusts the caller), then SINGLE S3 fetch + SINGLE `load_workbook`, loops
the sheets. **(4) SINGLE-OPEN PATH:** extracted a SHARED helper **`sheet_preview._extract_grid_rows(ws, min_row,
max_row)`** from the welded/duplicated row-extraction loop; BOTH preview endpoints now route through it (byte-identity
test stays green -- behavior-preserving) AND commit_pipeline calls it inside its one open workbook (no per-sheet
re-open, no per-sheet whitelisted-endpoint loop; reuses `_fetch_boq_file_to_tempfile` verbatim). **(5) GRID
WRITE-BODY** (per sheet, BOTH dispositions): build `{row_number, cells:{col_letter:value}}` faithfully (NO row
dropped); persist to the grid + child; **VERBATIM (#152)** `source_sheet_name` on write AND freeze-lookup (PostgreSQL
`=` on varchar is byte-exact -- trailing spaces significant); **VERSIONING** per (boq, sheet verbatim): new
`commit_version = max(prior)+1`, `is_current=1`, set `committed_at`, FREEZE prior current -> 0 (exactly one current);
PER-SHEET transaction (one trailing `frappe.db.commit()` per sheet, NO savepoints). **(6) COMMITTED `BoQ Sheet` per
sheet (both dispositions, incl. grid-only general-specs -- which the node path never created):** REPLACE semantics
(no version dim on BoQ Sheet; per-node versioning is 3b) -- raw `frappe.db.delete` the prior (boq, sheet) BoQ Sheet
+ child work_packages, then create fresh. **COLUMN-CONFIG SNAPSHOT** (the linchpin): `column_role_map` +
`column_headers` + `area_dimensions` (+ `header_row`/`header_row_count`/`treat_as`) pinned VERBATIM from the matching
draft's `sheet_config`; sheet_order/sheet_label/work_packages carried from the draft; `treat_as` = master_preamble
(general_specs) / data (finalized). **GOTCHA pinned:** `BoQ Sheet.area_dimensions` is a list-valued JSON field, and
`delete_doc`'s as_json archive -> `get_valid_dict` REJECTS a list ("cannot be a list"); the replace path therefore
uses raw `frappe.db.delete` (bare-stub controller, no on_trash) + explicit child cleanup. Node branch =
`_commit_node_tree_stub` (TODO(3b), no-op). **TESTS:** renamed doctype suite 4/4 (BCGS->BCSG assertion updated);
NEW `test_commit_pipeline.py` 11/11 (grid round-trip all-rows-kept-in-order; snapshot on finalized AND on grid-only
general-specs; discriminator mapping; versioning + freeze [exactly one current]; committed_at set; gate-recheck
negative [ineligible/unknown/empty subset throw, nothing written]; verbatim trailing-space identity [a trimmed
lookup would leave TWO current grids -- asserted it doesn't]; one BoQ Sheet per sheet after re-commit);
`test_sheet_preview` 32/32 UNCHANGED (byte-identity green -> refactor behavior-preserving); parser **597 UNCHANGED**.
`bench migrate` CLEAN (no Role-Profile lock this run; orphan auto-clean noted above). **LIVE TEST (scripted
commit-and-inspect on BOQ-26-00145 -- the first-real-data crossing) PASS:** gate -> SOW=general_specs, FAS=finalized;
commit_boq([SOW,FAS]) -> SOW grid_only 39 rows (BoQ Sheet treat_as=master_preamble, empty role-map -- SOW has no
parser config), FAS grid_and_nodes 1001 rows (BoQ Sheet treat_as=data, header_row=2, role-map A-H, area_dimensions
['Phase 1','Phase 2']); node stub no-op (zero nodes -- correct); RE-commit -> v1 froze (is_current 0), v2 current,
exactly ONE current grid per sheet, BoQ Sheet replaced (count 1). 7 files (rename) + 2 new (commit_pipeline +
test) + sheet_preview refactor. Pure-backend slice -> root CLAUDE.md ONLY (build prompt scoped docs to root +
plan doc; frontend/CLAUDE.md deliberately NOT touched -- no frontend change this slice). NEXT = Slice 3b (the
node-tree write path for finalized sheets) + Slice 4 (hub commit UI / picker / Committed status). Full detail in
boq-upload-plan.md "Phase 5 Slice 3a".)
// prior: 2026-06-16 (Phase 5 Slice 2.5 -- committed tier is now CAPTURE-ONLY -- BACKEND, feat 49b77635.
Makes the committed BOQ Nodes tier a TRUTHFUL CAPTURE STORE so the Slice-3 pipeline's reviewed values persist
VERBATIM: ALL money computation is REMOVED from the controller write chain and moves to the future tendering phase.
Computation-removal ONLY -- every STRUCTURAL invariant is kept + stays green. **PARENT (`integrations/controllers/
boq_nodes.py`):** `before_save` now calls only `_compute_path`. REMOVED `_compute_amounts` (recomputed
supply/install/total_amount from qty x rate + auto-set `is_rate_only`) + `_recompute_parent_rates_from_areas`
(overwrote the parent rate with a qty-weighted average on per-area divergence) -- calls + defs, zero external
callers. `_process_qty_by_area_rows` did nothing but reach the child compute, so the whole dead chain (it + the
child `apply_before_save`) was removed; the `_area_ctrl` import STAYS for `validate_child`. **`is_rate_only` is NO
LONGER auto-set** -- the FIELD STAYS (structural-audit KEEP) and its value is CARRIED THROUGH from the BoQ Review
Row by the Slice-3 pipeline (parser sets it; Slice 3 maps it verbatim -- **Slice 3 OWES this**). KEPT: the full
validate chain (sheet-required, boq<->sheet sync-guard, node_type/description required, level rules, combined_rate
consistency, parent rules, `_validate_qty_by_area` no-dup-area + per-child tolerance), `_compute_path`,
after_insert, on_update/`_write_audit`, on_trash. **CHILD (`boq_node_qty_by_area.py`):** REMOVED `apply_before_save`
+ `_apply_rate_fallback` (blank child rate inheriting parent) + `_compute_child_amounts` (child amount = rate x qty);
KEPT `validate_child`/`_validate_combined_rate` (a blank child rate now stays None so the all-three-set guard
short-circuits, never spuriously trips). **SCHEMA (`boq_nodes.json`):** dropped `read_only` on `supply_amount` /
`install_amount` / `total_amount` / `is_rate_only` (now captured, pipeline-written); NO field added/removed;
`amount_override` KEPT (its only remaining read = the cosmetic non-leaf-Preamble warning in validate). Known
cosmetic-stale (untouched, tight scope): the `is_rate_only` + `amount_override` field descriptions still mention
auto-set/recomputation. **TESTS (`test_boq_nodes.py`, still 71 -- now CERTIFIES capture-only):** ~19 compute tests
retargeted to "set value persists unchanged; blank stays blank, NOT computed/inherited/auto-set" (13 parent + 5
child retargeted; 5 MIXED split -- kept the structural assertion, dropped the dead `total_amount==` line); the **48
STRUCTURAL+NEUTRAL tests untouched + green** (proves no structural check read a removed compute value).
**VERIFICATION:** `bench migrate` CLEAN after clearing 10 stale Role-Profile fixture-sync lock files (recurring
environmental no-live-worker `DocumentLockedError` in `sync_fixtures`, unrelated; the read_only drops applied in the
earlier schema-sync phase); `test_boq_nodes` **71/71 OK**; `test_boq_node_qty_by_area` 0 tests (empty stub); parser
**597 UNCHANGED**. Zero blast radius -- no other test + no live code (api/, parser, patches, commit_gate, Slice-1
doctype) depends on node auto-compute (the parser's own `is_rate_only`/amount classification is a separate path). 4
files, +138/-199. Separate docs commit (plan doc + this file substantive; frontend/CLAUDE.md minimal-touch). NEXT =
Slice 3 must carry `is_rate_only` + all amounts/rates from the review row onto the node verbatim. Full detail in
boq-upload-plan.md "Phase 5 Slice 2.5".)
// prior: 2026-06-16 (Phase 5 Slice 2 -- the COMMIT GATE (eligibility) -- BACKEND, feat b93ec41c.
A READ-ONLY gate answering "which sheets of this BoQ are eligible to COMMIT right now?": it computes + returns a
list, does NOT commit / write the DB / change wizard_status / call the parser / touch `assemble_mapping_config`.
Slice 3 (commit pipeline) + Slice 4 (hub commit UI) will both call it; built + unit-tested in isolation first.
**THE parse-vs-commit distinction (load-bearing):** `assemble_mapping_config` treats "Finalized" as not_eligible
BY DEFAULT (re-parses Finalized only under force_reparse); the COMMIT gate is the OPPOSITE -- "Finalized" is
precisely what we commit. So the gate is a SEPARATE, narrower rule keyed on Finalized + general-specs; it does NOT
import / reuse / consult `assemble_mapping_config` / `force_reparse` (T5 is the regression guard). **NEW
`nirmaan_stack/api/boq/wizard/commit_gate.py`** (beside `parse_run.py`, matching the wizard-endpoint convention):
`compute_committable_sheets(sheet_drafts, general_specs_sheet_names) -> list[dict]` (PURE helper, no DB; accepts
Frappe child docs / `_dict` / plain dicts via a `_get` shim; preserves input order) + `get_committable_sheets(
boq_name) -> {"committable_sheets": [{sheet_name, disposition}]}` (`@frappe.whitelist()` READ-ONLY; loads
`BOQs.sheet_drafts` + the `BOQs.general_specs_sheets` pointer, same read pattern `assemble_mapping_config` uses).
**ELIGIBILITY RULE (the only two dispositions that commit, per PHASE 5 LOCKED INPUTS):** general-specs-designated
-> disposition **`general_specs`**; else `wizard_status == "Finalized"` -> **`finalized`**; else NOT eligible
(blank, Pending, Hidden, Config Done, Skip, Parse failed, Parsed). The disposition tells Slice 3 which write path
to use. **KEY FINDING (verify-first V3):** general-specs is POINTER membership in `BOQs.general_specs_sheets`
(`source_sheet_name` set), **NOT** `wizard_status == "General specs"` (never literally stored -- a designated
sheet can carry any status, e.g. Skip). **PRECEDENCE (overlap):** a sheet that is BOTH Finalized AND
general-specs-designated commits as **`general_specs`** -- mirroring `assemble_mapping_config` Rule 1 (pointer
checked first, outranks wizard_status); tested in T6. **VERIFICATION:** `test_commit_gate` **13/13 OK**
in-container (7 pure-helper: T1 Finalized, T2 general-specs-pointer-as-Skip, T3 every ineligible status incl.
blank "", T4 mixed exact subset, T5 parse-vs-commit distinction, T6 overlap precedence, #152 verbatim pointer
match; + 6 endpoint end-to-end on a real mixed BoQ incl. unknown-BoQ throws); parser suite **597 UNCHANGED**; NO
doctype JSON change -> NO migration required (pure read over existing fields). 2 new files, +353 lines, 0
deletions. No parser / `assemble_mapping_config` / BOQ Nodes / BoQ Sheet / Slice-1 general-specs doctype /
status-write / frontend change. Separate docs commit (plan doc + this file substantive; frontend/CLAUDE.md
minimal-touch). NEXT = Slice 3 (commit pipeline) + Slice 4 (hub commit UI). Full detail in boq-upload-plan.md
"Phase 5 Slice 2".)
// prior: 2026-06-16 (Phase 5 Slice 1 -- committed general-specs faithful-grid doctype -- BACKEND,
feat 5fe61bff. The EMPTY committed home for faithful general-specs rows: SCHEMA + bare-stub controllers + tests
ONLY (NOT the commit pipeline -- no commit logic, no `get_sheet_preview_full` call, no real-data fetch/persist;
parser / wizard API / BOQ Nodes / BOQs / BoQ Sheet Draft ALL untouched). Resolves C2 (general-specs stored today
as a LOSSY flattened `preamble_text` blob) by giving the faithful rows a committed home; routing reachable grid
data into it is Slice 3. **Slice-0 recon verified before build:** V1 the existing `BoQ General Specs Sheet`
(2 fields source_sheet_name/preamble_text, istable=1) is the lossy blob -- UNTOUCHED, the new doctype is separate;
V2 `get_sheet_preview_full`'s per-row shape `{"row_number": int, "cells": {col_letter: value}}` (sheet_preview.py
~:297-302) -- the new child mirrors it so Slice 3 persists that output directly; V3 §9 #136 grandchild-serialization
holds (one level of child + JSON cells stays first-level). **NEW `BoQ Committed General Specs`** (module Nirmaan
Stack, `istable=0` STANDALONE top-level -- NOT a child of BOQs because it carries versioning + is queried per
sheet; autoname **`BCGS-.YY.-.#####`** collision-checked vs BQSH-/BOQ-/BOQN-/BOQRR-; `track_changes=1`, InnoDB,
10-role permission block mirroring BoQ Sheet). FIELDS: `boq` (Link->BOQs, reqd, search_index, in_standard_filter),
`source_sheet_name` (Data, reqd, stored VERBATIM #152), the per-sheet VERSION dimension `commit_version` (Int,
reqd, default 1) + `is_current` (Check, default 1, in_standard_filter), `committed_at` (Datetime, read_only,
pipeline-set), and child table `rows` -> "BoQ Committed General Specs Row". **NEW child `BoQ Committed General
Specs Row`** (`istable=1`, permissions []): `row_number` (Int, reqd -- source Excel row), `row_order` (Int --
emission sort key for sparse rows), `cells` (JSON -- arbitrary-width {col_letter: value} map; JSON not exploded
columns gives arbitrary width with no grandchild table). **One-current invariant DEFERRED** to the Slice-3
pipeline -- Slice 1 defines fields only, builds NO enforcement; both controllers are intentionally BARE STUBS
(`class ...(Document): pass`, no compute, no cross-doc writes) per convention, the parent stub carries a docstring
noting the deferred invariant; NO `integrations/controllers/` file added. **DESIGN (locked):** one-level child +
JSON cells keeps the grid first-level (serializes on get_doc per §9 #136); versioning lives on the parent (the
same model the node tier will carry); the lossy `BoQ General Specs Sheet` blob stays UNTOUCHED + separate.
**VERIFICATION:** `bench --site localhost migrate` CLEAN (both doctypes install); `test_boq_committed_general_specs`
**4/4 OK** in-container (T1 arbitrary-width 3/2/5-col round-trip, T2 row_number+row_order ordering recoverable,
T3 version defaults 1/1 + settable 2/0 [schema only, no enforcement], T4 #152 trailing-space verbatim); parser
suite **597 UNCHANGED**. 7 new files, +423 lines, 0 deletions. No parser / wizard-API / BOQ Nodes / BOQs / BoQ
Sheet Draft / hooks.py / frontend change. Separate docs commit (plan doc + this file substantive; frontend/CLAUDE.md
minimal-touch per DOCS-UPDATE RULE). NEXT = the node-tier commit-version model + the Slice-3 commit pipeline that
routes `get_sheet_preview_full` output into these rows + enforces one-current. Full detail in boq-upload-plan.md
"Phase 5 Slice 1".)
// prior: 2026-06-16 (Phase-5 INPUT RECORD finalized -- DOCUMENTATION ONLY. Mirrors the PK audit doc v1.3
session-end decisions into the in-repo "PHASE 5 -- LOCKED INPUTS" block ahead of the Phase-5 kickoff. **Checkpoint
flags resolved:** Flag 1 -- general-specs gets a NEW doctype (CANNOT reuse BOQ Nodes; its node_type/qty/rate/parent
invariants would fight a general-specs grid row -- target is a simple label/description grid). Flag 2 -- add a
committed-to-DB marker AND a new hub "Committed" state (two coordinated changes, post-successful-commit). Flag 3 --
BUILD a review-row -> node provenance link, with a DURABILITY question to settle at design (review rows are
non-durable across re-parse -> store the review-row name [may dangle] vs a stable identifier). Flags 4/5
(parent_boq retire + dev purge) CLOSED in P4-FINAL. **LOCKED SEQUENCING:** line-item commit + general-specs
faithful-row capture built TOGETHER as ONE commit feature (NOT line-items-first) -- a real BoQ has both kinds; the
commit action / committed status / hub state can't finish until both exist; splitting builds the machinery twice.
**Phase 4 is CLOSED and pushed (9dae681d..35a8544c); PK audit doc at v1.3.** No code/schema/test touched; only the
plan doc + this file. Pure-backend/data record -> root CLAUDE.md. Full detail in boq-upload-plan.md "PHASE 5 --
LOCKED INPUTS".)
// prior: 2026-06-16 (Phase 4 P4-FINAL -- retire `parent_boq` + purge dev fixtures -- the destructive
Phase-4 CLOSE. **PHASE 4 COMPLETE** (P4-1 sheet tier -> P4-2 node re-point -> P4-3 mapping lock -> P4-4 missing
fields -> P4-5 type reconciliation -> P4-6 skip-filter verify -> CHECKPOINT pass -> P4-FINAL). Owner-authorized
destructive slice (local throwaway instance). **parent_boq RETIRED:** field dropped from `boqs.json` (def +
field_order); `boqs.py` stripped -- `_validate_parent_boq` call removed from `validate()` (area-dimensions +
Superseded guards SURVIVE), `_validate_parent_boq` + `_cascade_approval_to_children` DELETED, `on_update()` now a
wired no-op stub (hooks.py UNCHANGED -- lowest-risk; not unwired). **Frappe note:** migrate retired the FIELD
(`get_meta` no longer has it) but does NOT drop the physical column (Frappe never auto-drops columns) -- the
orphaned `parent_boq` column lingers harmlessly in `tabBOQs`; a hard drop needs explicit SQL (out of scope).
**TESTS:** 11 parent_boq tests removed from `test_boqs.py` (Group A linkage 5 + Group C cascade 6) + `_make_boq`
kwarg + unused `_TEST_PROJECT_2` cleaned; Group B + version/status UNTOUCHED -> test_boqs 28->**17**. **DEV-FIXTURE
PURGE (owner-scoped -- node-tier + test-fixture BOQs only; the ~34 hand-uploaded live-cert workbooks incl.
00145/00150/00166 PRESERVED):** raw `frappe.db.delete` (bypasses the on_trash Approved-guard; child->node->sheet->
BoQ order, child tables scoped by parent) -- BOQ Node Qty By Area 456->0, BOQ Nodes 182->0, BoQ Sheet 9->0, the
101 `_TEST_BOQ_PROJECT_NODES` + 6 master/sub dev BOQs deleted with their children, BOQs 141->34, orphan Nirmaan
Versions cleared; **Projects untouched (104)**. Clean end state Nodes/Child/Sheet=0/0/0, BOQs=34. **VERIFICATION:**
migrate clean (stale-lock recovery); test_boqs **17 OK**, BOQ Nodes **71 OK** + BoQ Sheet **5 OK** (self-seed --
green post-purge), parser **597 UNCHANGED**; runtime DB confirms field gone from meta + tiers empty. No
boq_nodes.py / boq_sheet.json / child-doctype / parser / frontend change; on_trash Approved-guard NOT touched.
**NEXT = Phase 5 (commit arc):** Finalized commit gate + general-specs faithful-row capture (the two conflicts in
"PHASE 5 -- LOCKED INPUTS"), sourcing from the 34 preserved workbooks' review rows. Full detail in boq-upload-plan.md.)
// prior: 2026-06-16 (Phase 4 P4-6 close + structural CHECKPOINT inserted + Phase-5 commit-set LOCKED --
DOCUMENTATION ONLY. **P4-6 = VERIFY-ONLY** (no build): a read-only recon found the §9 #135 Skip/Hidden filter is
ALREADY BUILT at the PARSE layer + tested -- `assemble_mapping_config` Rule 2 maps `wizard_status in {Hidden,Skip}`
-> `SheetConfig(skip=True)`; `parse_boq()` drops skip sheets from output (`if sheet_config.skip: continue`); passing
tests at both layers (`test_skipped_sheet_excluded_from_output`, Snitch `test_snitch_skip_sheets_filtered_out`,
assemble hidden/skip/pending tests). Three exclusion mechanisms: skip=True (Skip/Hidden), not_eligible (Pending/
Parse-failed/blank/Finalized-without-force), master_preamble (General specs). **The audit gap-table entry for §135
is STALE** (it lists the filter as outstanding -- it is built; corrected in the plan doc; the ParseRun Plan of
Record is accurate). **CHECKPOINT slice inserted BEFORE P4-FINAL:** a read-only structural sign-off of the assembled
committed schema (BOQs -> BoQ Sheet -> BOQ Nodes -> BOQ Node Qty By Area) vs the rebuild plan -- runs before
P4-FINAL because P4-FINAL clears the 167 dev rows + retires `parent_boq` (last look while a sample assembled node
exists; last clean point to catch cross-slice drift). STRUCTURAL ONLY -- NOT the Phase-5 dogfood test. Revised tail:
P4-6 -> CHECKPOINT -> P4-FINAL -> Phase 5. (P4-5's "Phase-4 arc complete" meant the FIELD/TYPE arc P4-1..P4-5;
Phase 4 is NOT complete.) **PHASE-5 COMMIT-SET LOCKED (owner-decided):** only TWO dispositions commit -- (1)
**Finalized** -> its line-item data (Finalized is THE commit gate for line items), (2) **General specs** -> a
FAITHFUL row-by-row capture of the sheet's cells (ALL general-specs sheets if multiple). Everything else (Config
Done / Parsed / Skip / Hidden / Pending / Parse-failed / blank) does NOT commit. **TWO CONFLICTS Phase 5 must
resolve:** (C1) Finalized is currently `not_eligible` BY DEFAULT (parses only under force_reparse) -- "what parses"
!= "what commits"; the commit gate is a SEPARATE narrower gate keyed on Finalized, downstream of parsing, must be
built. (C2) general specs is stored today as a LOSSY flattened `preamble_text` blob (row/column structure
discarded) -- faithful rows need NEW capture behavior; FEASIBLE because the raw cell grid IS available upstream
(parser holds the openpyxl worksheet via `_wb_values`/`iter_rows` and merely flattens it) -> routing existing data,
not new parse work (demonstrated: a faithful 39x3 CSV of BOQ-26-00145 'SOW'). The commit pipeline must enforce the
commit-set EXPLICITLY (Finalized + general-specs faithful rows), not merely inherit the parse skip-filter. CARRIED:
the tendering-era audit scope stays an open Phase-5/tendering-boundary decision (P4-4). Pure-backend/data slice ->
root CLAUDE.md, NOT frontend. Full detail + the "PHASE 5 -- LOCKED INPUTS" block in boq-upload-plan.md.)
// prior: 2026-06-16 (Phase 4 Slice P4-5 -- reconcile per-area CHILD rate/amount fields Float -> Currency
-- BACKEND, feat pending. TYPE-ONLY: the SIX money fields on `BOQ Node Qty By Area` (`supply_rate`/`install_rate`/
`combined_rate`/`supply_amount`/`install_amount`/`total_amount`) flip `Float` -> `Currency` to match the parent
BOQ Nodes. **CLOSES the Float-vs-Currency inconsistency P4-3 deferred here.** NOT a reshape (the normalized-child /
one-level-serialization container was already satisfied) -- no field renamed/reordered/added/removed, no
options/custom-precision added (default 2dp, owner-confirmed), NO controller logic touched (`_area_ctrl` +
`boq_nodes.py` UNCHANGED), NO test changes. `qty` STAYS Float on both parent + child (quantity, not money);
`area_name`/`amount_override` unchanged. SAFE per recon: all 436 existing child rows are <=2dp (Currency rounds
nothing); no qty_by_area test asserts >2dp (`assertAlmostEqual places=2` / integer values -> stay green); the two
sub-cent edge behaviors (`_validate_combined_rate` 0.01-tolerance; the weighted-average uniform-rate-skip) shift
only at the 3rd decimal -> accepted as correct money rounding, logic unchanged. VERIFICATION: migrate clean (after
clearing the recurring 10 stale Jun-15 lock files -- same environmental no-live-worker DocumentLockedError as P4-4);
BOQ Nodes **71 OK UNCHANGED**; BoQ Sheet **5 OK**; parser **597 UNCHANGED**; `frappe.get_meta` confirms all six are
`Currency` + `qty` still `Float` (the SQL column type is unchanged -- Frappe stores Currency + Float identically, so
the meta fieldtype is the authoritative check). No child-controller / parent / test / hooks / parser / frontend
change. Phase-4 committed-model arc (P4-1 sheet tier -> P4-2 node re-point -> P4-3 mapping lock -> P4-4 missing
fields -> P4-5 type reconciliation) COMPLETE; committed nodes + child are structurally ready for the Phase-5 commit
pipeline. Full detail in boq-upload-plan.md.)
// prior: 2026-06-16 (Phase 4 Slice P4-4 -- add 8 MISSING committed-node fields -- BACKEND, feat pending.
ADDITIVE STORAGE on BOQ Nodes; NO controller logic (the commit pipeline that populates them is Phase 5). **8
FIELDS:** HUMAN-LAYER -- `human_classification` (Data, NOT Select), `human_parent` (Int, -1 sentinel, no schema
default), `human_is_root` (Check default 0); EDIT PROVENANCE -- `edit_log` (JSON, stored OPAQUE: list of
{field,from,to,by,at,reason}+optional area/rate_subkey), `edited_by` (Data), `edited_at` (Datetime) [both separate
scalars for the cheap isEdited read; not read_only, matches review side]; ANNOTATION -- `remarks` (Small Text);
ATTACHED NOTES -- `attached_notes` (JSON, stored OPAQUE, structured list carried verbatim). PLACEMENT: 3 human-layer
fields in `node_details_section` after `level`; 5 provenance/annotation fields in a NEW `review_provenance_section`
after `edit_reason`. No existing field reordered; none reqd. **DESIGN (locked):** (1) `edit_log` is KEPT on the node
NOT derived from Nirmaan Versions -- Versions tracks only 15 post-commit scalar fields and cannot carry the
pre-commit review history / per-area edits / human-layer changes; edit_log = pre-commit provenance, Versions =
post-commit trail, both exist. (2) `attached_notes` gets its OWN JSON field (folding into the flat `notes` Text
would destroy structure). (3) **`_write_audit` tracked_fields UNCHANGED** -- none of the 8 added. **OPEN DECISION --
TENDERING-ERA AUDIT SCOPE (Phase-5/tendering boundary):** tendering edits to a committed node (rates, per-area qty,
SKU) need a full who/changed-what/when trail; today's `_write_audit` (15 scalar fields, no per-area child,
lifecycle-only) is under-built; the tendering-era audit scope is to be designed explicitly at the tendering
boundary, NOT inherited. VERIFICATION: migrate clean (after clearing 10 stale Jun-15 lock files -- a Role Profile
fixture-sync DocumentLockedError with no live worker; environmental, unrelated); BOQ Nodes suite **71 OK** (+7);
BoQ Sheet **5 OK**; parser **597 UNCHANGED**; runtime DB confirms all 8 columns on `tabBOQ Nodes`. No boq_nodes.py
/ hooks.py / child / review / parser / frontend change. Full detail in boq-upload-plan.md.)
// prior: 2026-06-16 (Phase 4 Slice P4-3 -- LOCK the commit field-mapping + three-parent-fields design --
DOCUMENTATION ONLY. No build, no schema change, no test churn: the committed BOQ Nodes already uses the target
field names; the naming gap lives in the (unbuilt) Phase-5 commit pipeline, so P4-3 freezes the review-row ->
committed-node mapping for Phase 5 to implement. **MAPPING:** `qty_total`->`qty` [NAME]; `rate_supply`->
`supply_rate`, `rate_install`->`install_rate`, `rate_combined`->`combined_rate`, `amount_supply`->`supply_amount`,
`amount_install`->`install_amount`, `amount_total`->`total_amount` [all NAME+TYPE]; `sl_no_value`->`code` [NAME];
`row_index`->`sort_order` [NAME]; `source_row_number`/`unit`/`make_model`/`description` [SAME, no remap]. (Per-area
`qty_by_area`/`rate_by_area`/`amount_by_area` JSON -> the committed `qty_by_area` CHILD table; Phase-5 shape work.)
**TWO TRAPS:** (1) WORD-ORDER REVERSAL -- review is prefix-first (`rate_*`/`amount_*`), committed is suffix
(`*_rate`/`*_amount`); Phase 5 must map FIELD-BY-FIELD, never by a name-match loop (a loop silently misses all six
rate/amount fields). (2) FLOAT->CURRENCY on the six rate/amount fields (review=Float, committed parent=Currency);
let Frappe COERCE on assignment, no manual rounding. `qty` stays Float on both sides. **FLOAT-VS-CURRENCY
INCONSISTENCY deferred to P4-5 (NOT resolved here):** committed PARENT (BOQ Nodes) rate/amount = Currency, committed
CHILD (BOQ Node Qty By Area) rate/amount = Float -- a parent/child mismatch; likely P4-5 fix = make the child
Currency. `qty` = Float on both. **THREE PARENT FIELDS (design note, do NOT collapse):** BoQ Review Row stores
THREE distinct layers -- `parent_index` (Int, parser truth), `human_parent` (Int, -1 sentinel = no override / >=0 =
reparent), `human_is_root` (Check, human re-rooted to top). `effective_parent_index` is NOT stored -- it is
COMPUTED by `resolve_effective()` at read time. The Phase-5 commit runs `resolve_effective()` and writes the single
resolved parent to the node's `parent_node` Link (the node's ONLY parent field); it does NOT copy the three
review-side fields. The three-layer separation is load-bearing (a human edit never destroys the parser's original
parent) and must not be refactored into one field. CORRECTION: the Phase-3 gap table had listed
`effective_parent_index` as stored -- it is computed, not stored. Only the plan doc + this file updated.)
// prior: 2026-06-16 (Phase 4 Slice P4-2 -- re-point BOQ Nodes to the BoQ Sheet tier -- BACKEND, feat
pending. Inserts the P4-1 sheet tier into the committed node's upward ties: a node now links to a **BoQ Sheet**
(new PRIMARY tie) and the `boq` Link->BOQs is KEPT DENORMALIZED. SURGICAL: +1 Link field, +1 sync validation, 1
required-guard moved, test fixtures re-pointed. NOTHING ELSE touched -- `_compute_path` (parent_node-based),
parent-chain node_type/level validation, `_recompute_parent_rates_from_areas`/`_process_qty_by_area_rows`,
`_write_audit`, `on_trash`, the qty_by_area helpers are ALL unchanged (the P4-2 recon proved them indifferent: path
never reads boq, the parent check has NO same-boq constraint to translate, the roll-up is intra-node). No commit
pipeline (Phase 5), no real-data write. **SCHEMA (`boq_nodes.json`):** new `sheet` field -- Link->"BoQ Sheet",
`search_index:1`, `in_standard_filter:1`, NOT reqd at JSON level (required-ness is controller-enforced, matching
`boq`), placed in field_order IMMEDIATELY AFTER `boq`. `boq` is UNCHANGED (Link->BOQs, search_index +
in_standard_filter intact). **WHY keep boq denormalized (locked, owner-ratified):** Frappe cannot filter/sort a
list across two Link hops (`sheet.boq`), and `boq` carries search_index + in_standard_filter the Desk UI + index
depend on; a denormalized field is the idiomatic Frappe pattern for a queryable grandparent. The 3 hot-path boq
reads (validate guard, on_trash BOQs.status, `_validate_qty_by_area` BOQs.area_dimensions) stay cheap one-hops,
unchanged. **CONTROLLER (`boq_nodes.py` validate, top only):** the old `if not doc.boq: throw("BoQ is required")`
is REPLACED by `if not doc.sheet: throw("BoQ Sheet is required")` (sheet is now the single required upward tie;
the standalone boq-required throw is DROPPED -- redundant + would mis-fire before auto-fill). A NEW SYNC GUARD runs
FIRST (before `_validate_qty_by_area` reads doc.boq): `sheet_boq = frappe.db.get_value("BoQ Sheet", doc.sheet,
"boq")`; doc.boq set AND `!= sheet_boq` -> throw mismatch; doc.boq blank -> **AUTO-FILL `doc.boq = sheet_boq`**.
**DECISION = AUTO-FILL** (one source of truth = the sheet; runs before Frappe's `_validate_links`, so a sheet-only
insert populates boq cleanly). `_write_audit` tracked_fields UNCHANGED -- `sheet` deliberately NOT added (auditing
the link is a separate optional decision; flagged not done). **TESTS** fixture-first: setUpClass creates a shared
`BoQ Sheet` (`cls.sheet_name`) under the shared BOQs; ~42 inline `.boq = self.boq_name` sites -> `.sheet =
self.sheet_name` (boq auto-fills); 3 own-boq tests get a local sheet; tearDownClass deletes BoQ Sheet by boq;
`test_validate_requires_boq` -> RENAMED `test_validate_requires_sheet`; NEW `test_node_sheet_boq_sync` (auto-fill +
mismatch-throw); the 7 parent_node-based path-format assertions survive unchanged. **VERIFICATION:** migrate clean;
BOQ Nodes suite **64 OK**; BoQ Sheet suite **5 OK**; parser **597 UNCHANGED**; runtime DB confirms `sheet` column on
`tabBOQ Nodes` (varchar, alongside `boq`). No hooks.py / boq_sheet.json / boqs.json / qty_by_area-controller /
parser / frontend change. NEXT: P5 commit pipeline. Full detail in boq-upload-plan.md.)
// prior: 2026-06-15 (Phase 4 Slice P4-1 -- committed "BoQ Sheet" doctype, the SHEET tier -- BACKEND,
feat pending. Creates the missing middle tier of the committed model BOQs (workbook) -> **BoQ Sheet** (sheet) ->
BOQ Nodes (rows); committed nodes today attach straight to BOQs (BOQ Nodes has `boq` + `parent_node`, NO sheet
field/Link). ADDITIVE + STANDALONE: ONE new doctype, NOTHING ELSE touched -- no BOQ Nodes / BOQs / BoQ Sheet Draft
/ controller / endpoint / hooks.py change. Nothing writes to it yet (commit pipeline = Phase 5; node re-pointing =
P4-2). NEW `nirmaan_stack/nirmaan_stack/doctype/boq_sheet/`: boq_sheet.json + boq_sheet.py (stub
`class BoQSheet(Document): pass`, matches the BOQs/BOQNodes house stub) + empty __init__.py + test_boq_sheet.py.
DESIGN (owner-locked): **`istable=0` STANDALONE top-level doctype that Links UP to BOQs** (NOT a child table --
the working-side `BoQ Sheet Draft` IS a child table; the committed BoQ Sheet is a real linked record so P4-2 can
re-point BOQ Nodes to it). `track_changes=1` (mirrors BOQs/BOQ Nodes), `engine InnoDB`. **autoname
`BQSH-.YY.-.#####`** -- deliberately NOT `BOQS-` (one char off BOQs' `BOQ-` + reads as a plural; `BQSH`="BoQ
SHeet", zero prefix collision). FIELDS (16, Section-Break grouped): IDENTITY -- `boq` (Link->BOQs, reqd,
in_list_view, search_index), `sheet_name` (Data, reqd, in_list_view), `sheet_order` (Int, reqd, in_list_view),
`sheet_label` (Data); WORK HEADERS -- `work_packages` (Table, options **"BoQ Sheet Work Package"** -- REUSES the
EXISTING child doctype [istable=1, single `work_header` Link->"Work Headers" reqd], NOT a new one; sheet->many,
real-data-confirmed e.g. BOQ-26-00145 "HVAC " links 3 headers); RENDER CONFIG (the audit KEEP-set, full Excel view
TLD-2) -- `treat_as` (Select data/master_preamble, default data), `header_row` (Int), `header_row_count` (Int
default 1 -- plain Int; the Literal[1,2] constraint stays upstream in the parser SheetConfig), `column_role_map`
(JSON, **stored OPAQUE -- NO role validator added**; live legacy maps carry retired tokens e.g. `amount_by_area`),
`column_headers` (JSON), `area_dimensions` (JSON); PARSE VINTAGE -- `last_parsed_at` (Datetime, read_only). The
SPENT sheet_config keys are deliberately NOT carried (skip / top_header_rows_override / skip_top_rows_after_header
/ rate_only_markers_override / level_1_style_override / package_name / sheet_name-echo). PERMISSIONS mirror the
BOQs block verbatim (10 roles: 6 full-RW + 4 read/report/export/share). **list-JSON caveat (re-confirmed): a JSON
field rejects a raw Python LIST on insert (`get_valid_dict` "cannot be a list") -- a caller must `json.dumps()`
`area_dimensions` before insert; dict-JSON fields (`column_role_map`/`column_headers`) pass as Python dicts.** The
test mirrors the `_LIST_JSON_FIELDS` serialization pattern. TESTS: `test_boq_sheet` 5/5 green in-container
(create+autoname BQSH- prefix; work_packages accepts 2+ work-headers + read-back; JSON round-trip INCLUDING a
retired `amount_by_area` token -- proves opaque storage; render-config + read-only last_parsed_at persist;
treat_as/header_row_count defaults). `bench --site localhost migrate` CLEAN; RUNTIME db verified (DocType exists,
`boq`+`column_role_map` columns present, autoname `BQSH-.YY.-.#####`, istable=0). Parser suite 597 UNCHANGED. No
hooks.py wiring (passive container -- no lifecycle hook this slice). Live-cert N/A (no UI). NEXT: P4-2 re-points
BOQ Nodes to a BoQ Sheet Link; P5 commit pipeline writes BoQ Sheet rows. Full detail in boq-upload-plan.md.)
// prior: 2026-06-14 (Append-to-notes-as-columns + staleness banner -- BACKEND + FRONTEND: renders
`append_to_notes` data as review-screen columns (additive -- the commit-time notes-fold is untouched; the same
content showing twice is BY DESIGN). (a) each mapped append-column as its OWN read-only column in ORIGINAL Excel
position; (b) ONE combined "Append Notes" column PINNED LAST. BACKEND `review_screen._build_column_descriptors`:
`append_to_notes` removed from `_NON_DISPLAY_ROLES` (now `{ignore, reference_images}` only) + a new branch
emitting one descriptor per append-column -- `value_field="append_notes_raw"`, `area=None`, `rate_subkey=None`,
**`value_key = sheet_config.column_headers.get(col, col)`** (NOT bare `col`). KEY FACT: the parser stores
`append_notes_raw` keyed by `column_headers.get(col_letter, col_letter)` (classifier.py:983) -- header text when
mapped, else the bare Excel letter -- so the descriptor `value_key` MUST mirror that same resolution or the
one-hop `resolveDescriptorValue` walk misses the value (BOQ-26-00166 has `column_headers={}` so its keys are
letters, but the impl handles populated headers). The :649 Excel-letter sort interleaves the in-position columns
for free. FRONTEND `ReviewTree.tsx`: combined column = hand-written trailing `<th>`/`<td>` after the descriptor
`.map()` (NOT a descriptor -- a sentinel would fight the sort), built from `appendDescriptors` joining
`"<value_key>: <text>"` with `" | "` (value_key IS the header-else-letter prefix, already baked in; numeric
strings NOT coerced), shown only when append-columns exist, NOT in the column-subset selector; `totalCols` gains
`+1` when shown. STALENESS BANNER `SheetReviewPage.tsx`: a static always-on muted strip after the teal Finalized
banner -- "Totals shown are as originally parsed. Final calculations happen after the BoQ is committed."
`boqTypes.ts` untouched (`ROLE_LABELS` already had `append_to_notes`; types already fit). D2 writer
`exportReviewCsv.ts` NOT touched (its stale append-key doc note IS corrected). tsc 0 new wizard errors (3177
baseline) + Vite build exit 0; test_review_screen 154 -> 158 (+4). **OWNER FLAG: REVERSES the locked non-display
design for `append_to_notes` -- the PK doc `BoQ_Review_Screen_Locked_Design_v1_0` (not in repo) needs an owner
amendment.** Live-cert pending Nitesh. Full detail in boq-upload-plan.md + frontend/CLAUDE.md.
// prior: 2026-06-14 (Field-set rationalisation Slice 2b -- per-area amount EDIT path made NESTED
-- BACKEND (+ frontend comment) , feat ad99ebf7: the second half of the amount field-set work. Slice 2a
shipped per-area amount STORED nested `{area: {supply, install, total}}` on the READ path but left the EDIT
path FLAT, so a per-area amount edit CORRUPTED data -- the backend discarded the sent subkey and did a flat
one-hop write `current[area] = float`, clobbering the area's whole nested dict. 2b makes the amount edit path
NESTED, mirroring rate's two-hop `amount_by_area[area][kind]` write. NEAR-PURE BACKEND: the frontend edit path
is already generic over the descriptor (it sends the amount kind in the `rate_subkey` slot -- 2a's decision),
so the frontend change is COMMENT-ONLY. `review_screen.py`: `amount_by_area` moved OUT of `_FLAT_AREA_FIELDS`
(now `{qty_by_area}` only) INTO a new `_NESTED_AREA_FIELDS = {rate_by_area, amount_by_area}`; `_AREA_JSON_FIELDS`
(the is-per-area-editable gate) stays the full union; new `_LEGAL_AMOUNT_SUBKEYS = frozenset(_AMOUNT_ROLE_TO_KIND
.values())` (= {supply, install, total}) + a per-field `_NESTED_FIELD_LEGAL_SUBKEYS` map. The `_apply_and_save
_row_edit` write branch now keys on `field in _NESTED_AREA_FIELDS` (NOT the literal `field == _RATE_AREA_FIELD`)
-> two-hop nested write for BOTH rate + amount (locate/create the inner dict, set ONE kind, leave the area's
other kinds + the other areas intact -- the B2 anti-corruption guarantee); one-hop only for `qty_by_area`. The
`save_review_edit` validation requires + validates a subkey for amount too, against the PER-FIELD legal set
(rate -> rate kinds, amount -> amount kinds). **DECISIONS (owner-locked): C2/C3 = OPTION A** -- REUSE the
generic `rate_subkey` wire param + edit-log key for amount (NO `amount_subkey` param, NO new descriptor hop, NO
frontend remap); the `rate_subkey` name carrying amount kinds is accepted **Phase-4 naming debt**, NOT renamed
here. **C4 = ACCEPT STALENESS** -- the row scalar `amount_total` is NOT recomputed after a per-area edit (matches
existing rate behaviour; calculations live in the future tendering module, post-DB-commit). NO recompute-on-edit
logic was added; the 2a derivation rule (`orchestrator._apply_multi_area_post_pass`) stays PARSE-TIME ONLY. The
staleness USER MESSAGE (a review-screen banner) is a DEFERRED separate frontend slice -- not in 2b. The edit-log
entry for an amount per-area edit carries `field="amount_by_area"`, `area`, `rate_subkey=<amount kind>` (reuses
`append_edit_log_entry` unchanged; the provenance panel renders `entry.rate_subkey` generically -> "(Zone A /
total)"). READ path UNCHANGED (`_JSON_DICT_FIELDS` already had `amount_by_area`; descriptors / resolveDescriptor
Value generic). TESTS: test_review_screen 152 -> 154 -- the per-area fixture seeds amount nested now; the two
flat amount edit tests reworked to nested (`test_amount_by_area_sets_one_subkey_others_intact` is the B2
anti-corruption proof: edits ONE kind, asserts the area's other kinds AND the other areas survive); +2 reject
tests (amount edit with NO subkey; illegal amount subkey using a legal RATE kind `combined_rate` to prove the
per-field selection rejects the wrong set). Parser 597 + test_parse_run 86 + test_update_sheet_draft 82
UNCHANGED (no parser code touched). tsc 0 new wizard errors; Vite build exit 0 (`Done in 377.99s`, PWA 168
entries). Live-cert pending Nitesh: edit a per-area supply/install amount on a multi-area row (BOQ-26-00166 or
the -00165-derived sheet) -> only that kind+area changes, other kinds/areas intact, persists on reload; the row
scalar total does NOT recompute (EXPECTED accepted staleness, not a bug). KNOWN DEBT: the `rate_subkey` naming
misnomer (Phase-4) + the accepted total staleness (banner is a later slice). Full detail in boq-upload-plan.md
+ frontend/CLAUDE.md.
// prior: 2026-06-13 (Field-set rationalisation Slice 2a -- amount per-area SYMMETRIC with rate,
READ path -- BACKEND + FRONTEND, feat 33ec8361: made AMOUNT symmetric with RATE on the per-area READ path
(extraction + storage + DISPLAY; the per-area amount EDIT path is deferred to Slice 2b and was NOT touched).
ROLES: ADDED `amount_supply_by_area` / `amount_install_by_area` / `amount_total_by_area` (area-required,
area-compatible -- mirror the `rate_*_by_area` roles); RENAMED `amount_by_area` -> `amount_total_by_area`
(the per-area combined amount -- DELIBERATELY differs from rate's `amount_combined_by_area`; cross-family
wording difference accepted + logged); DROPPED scalar role `amount_combined` -- its SITC / S&I /
combined-amount keywords RE-HOMED into `_HEADER_KW["amount_total"]` (`classifier.py`; the `_cell_float`
combined-cascade fallback removed), so a column that auto-detected as combined now auto-detects as
`amount_total`. NESTED extraction/storage/display (mirrors `rate_by_area`): `classifier.amount_by_area_raw`
is now nested `dict[area][kind]` (supply/install/total) via new `_AMOUNT_ROLE_TO_KIND` + helpers
`_collapse_area_amount` / `_sum_area_amounts`; `hierarchy.ResolvedRow.amount_by_area_raw`+`amount_by_area`
nested; `orchestrator` deep-copies nested, the qty*rate fallback writes the `"total"` kind, sum-validation
collapses nested. SCALAR-TOTAL DERIVATION RULE (owner-confirmed, in `_apply_multi_area_post_pass`): the
explicit total-amount column wins (`amount_total` already set upstream); ELSE derived = sum over areas of
(that area's per-area total if it has a `total` kind, else its supply + install). `review_screen.
_build_column_descriptors` per-area amount branch is now GENERIC via `_AMOUNT_ROLE_TO_KIND` (mirrors the rate
branch); each per-area supply/install/total amount renders in its OWN column. **STORAGE FIELD `amount_by_area`
is KEPT (now nested) -- ONLY the ROLE was renamed** (exact analog of rate's `rate_by_area` field coexisting
with `rate_*_by_area` roles): `BoQ Review Row.amount_by_area` (JSON), `ResolvedRow`/`ClassifiedRow`
attributes, the descriptor `value_field`, `get_review_rows` all_fields, `_FLAT_AREA_FIELDS`/`_JSON_DICT_FIELDS`,
and `flatten_resolved_row`'s JSON key all retain the name; no doctype-JSON change, no migration (JSON value
shape only). `_auto_guess` BOTH duplicate role sets updated; a detected per-area amount column maps to
`amount_total_by_area`. FRONTEND (read/display only): `ROLE_LABELS` + `ROLES_BY_GROUP` + `AREA_COMPATIBLE_ROLES`
+ `AREA_REQUIRED_ROLES` + `SINGLETON_ROLES` + the Layer-2 `_AMOUNT_ROLES` set updated; new `AmountByAreaCell`
type; `ReviewRow.amount_by_area` typed nested; `resolveDescriptorValue` already generic (no change);
`EDITABLE_AREA_FIELDS` + the per-area edit gating NOT touched (Slice 2b). ZERO-HIT GREP GATE: `amount_combined`
fully gone from live code (remaining hits = dead-scratch scripts + rename-documenting/regression tests only);
`amount_by_area` retains ONLY storage-field usages (classified ROLE-usage=0). TESTS: parser 589->597 (new
`TestNestedPerAreaAmountExtraction` + `TestNestedAmountTotalDerivation`; the old amount_combined extraction
class repurposed to `TestTotalAmountColumnCascade` with a dropped-role-rejected regression; config/classifier/
orchestrator/hierarchy/parse_run/auto_guess fixtures re-nested + roles renamed; `classifier_audit.
_CLASSIFIER_HEADER_KW` synced for the agreement-#21 live sync test); wizard suites unchanged (test_review_screen
152 / test_parse_run 86 / test_update_sheet_draft 82) green; tsc 0 new wizard errors; Vite build exit 0
(`built in 6m 14s`, PWA 168 entries). Live-cert pending Nitesh (multi-area workbook with per-area supply/install/
total amounts; Job-7 note: re-SAVE the sheet config through the WIZARD, not just re-parse, to clear any stored
`amount_by_area`-role token from an old config blob -- a stale token silently drops the sheet from the parse).
Full detail in boq-upload-plan.md + frontend/CLAUDE.md.
// prior: 2026-06-13 (Field-set rationalisation Slice 1 -- Finding 1: scalar amount roles NOT
area-compatible -- BACKEND + FRONTEND, feat 83985079: removed `amount_supply`/`amount_install`/`amount_total`
from `_AREA_COMPATIBLE_ROLES` (`services/boq_parser/config.py:17`) AND `AREA_COMPATIBLE_ROLES`
(`SheetConfigPanel.tsx:128`). The descriptor builder already routes these three as SCALARS and silently drops
any area set on them, so the config UI's area sub-selector for them was meaningless (a user could attach an
area and it was dropped at render). PURE SUBTRACTION -- no new roles, no rename, no parser-logic / descriptor /
classifier / serialization change; `qty` + the genuine `*_by_area` roles stay area-compatible and are
untouched. BOTH config.py consumers DERIVE from the set so they tighten automatically: the
`area_only_for_qty_amount_roles` model validator (config.py:46) AND the per-area uniqueness loop
(config.py:134) -- so scalar amount roles now REJECT an area at ColumnRole validation (the uniqueness loop over
them becomes vacuous, correct). Frontend: the area-dropdown gate (`SheetConfigPanel.tsx:1099` --
`AREA_COMPATIBLE_ROLES.has(role) && isMulti && activeAreas.length>0`) + the serialization sites (`:599`/`:655`
force `area:null` for non-compatible roles) all key off the same set; no second code path renders an area
control for these roles. TESTS: new `TestMappingConfig.test_scalar_amount_roles_reject_area` (the three reject
an area; `qty` + `amount_by_area` still accept) + fixed the pre-existing `test_valid_full_config_parses_cleanly`
fixture (column K `amount_supply` no longer carries `area="B1"`). Parser 588->589 green; wizard suites unchanged
(test_parse_run 86 / test_update_sheet_draft 82 / test_review_screen 152); tsc 0 new wizard errors (3177
baseline), no Vite build run (runtime Set subtraction cannot affect bundling). Full detail in boq-upload-plan.md.
// prior: 2026-06-13 (Slice A1 status rename + Finalized config-freeze + dirty-marker fix --
BACKEND + FRONTEND + DATA MIGRATION, feat 6001e36e: the `BoQ Sheet Draft.wizard_status` values
**"Reviewed" -> "Config Done"** and **"Parsed Check Done" -> "Finalized"** (compared LITERALLY across backend
+ frontend, so the rename is coverage-critical -- a zero-hit grep gate confirmed 100% coverage). The doctype
options string (`boq_sheet_draft.json`) renames both tokens; an idempotent patch
`v3_0/migrate_boq_sheet_draft_status_rename` rewrites stored rows (option metadata does NOT touch stored
values) -- `bench migrate` verified 0 old-value rows remain (6 'Reviewed'->'Config Done'). BACKEND: parse_run
`_RULE3_BASE_STATUSES`/force-arm/worker-comparison; update_sheet_draft `_DIRECT_SET_STATUSES` (now excludes
"Reviewed" -- the old name is now an INVALID status) + the dirty-drop write (Parsed->"Config Done");
review_screen renames the const `_PARSED_CHECK_DONE`->`_SHEET_FINALIZED="Finalized"` AND fixes the
const-vs-literal split (mark/unmark preconditions + writes + messages now all reference the const -- one
definition site). **DIRTY-MARKER ASYMMETRY FIX (Finalized config-freeze):** a NEW shared
`_guard_sheet_not_finalized(boq, sheet)` (update_sheet_draft, leaf module; imported by review_screen) throws
iff wizard_status=="Finalized", called in ALL FIVE config writers immediately AFTER `_guard_sheet_not_parsing`
(per-named-sheet in `set_general_specs_sheet`) -- so a Finalized sheet's config write is REJECTED (superseding
the old silent "Parsed Check Done never drops" asymmetry); the dirty-drop at the Parsed branch is unchanged (a
Finalized sheet is rejected before reaching it). FRONTEND: `WizardStatus` union + `STATUS_PILL` keys/labels +
all effectiveStatus branches/comparisons (SheetCard/BoqHubPage/SheetReviewPage/ParseRunDialog) + the
statusAtOpenRef compare + the `set_sheet_status` write + the hub "Export reviewed"->"Export Finalized" label;
identifiers carrying the old name were renamed for a zero-justification grep (`newlyDesignatedReviewed`->
`newlyDesignatedConfigDone`, `pendingReviewedNames`->`pendingConfigDoneNames`, `dropIfReviewed`->
`dropIfConfigDone`, `handleMarkReviewed`->`handleMarkConfigDone`). **NEW un-mark-and-edit affordance:**
SheetConfigPanel shows a TEAL Finalized-lock banner + an "Un-mark and edit" confirm (-> the EXISTING
`unmark_sheet_parsed_check_done` endpoint -- function name unchanged -> onSaveSuccess re-fetch unlocks); the
whole form is `<fieldset disabled={isParsing || finalized}>` (parsing amber banner takes precedence over
finalized teal); SheetCard's Finalized branch gains an "Edit config" -> spoke button so the affordance is
reachable. TESTS: ~78 status literals renamed in place + new TestFinalizedConfigFreeze (5 writer rejects +
Config-Done control + REAL-unmark-then-writer round-trip + parse-guard-precedence) + TestStatusRenameRegression
(old "Reviewed" rejected) + retired-value superset-marking hygiene; the renamed M2 test covers mark-rejects-
Config-Done. test_parse_run 85->86, test_update_sheet_draft 72->82, test_review_screen 152 (renamed in place),
parser 588 unchanged. tsc 0 wizard errors (3177 baseline) + build exit 0. Zero-hit grep residuals all justified
(migration map / 2 intentional-old-name tests / ReviewTree "Reviewed -- looks OK" flag text [out-of-scope] /
exportReviewCsv docstring). Live-cert pending Nitesh. Full detail in boq-upload-plan.md + frontend/CLAUDE.md.
// prior: §9 #164 Slice A3-backend -- per-sheet parse-lifecycle state + double-fire
guard + self-heal + write guards -- BACKEND ONLY, feat 004f80a8: a sheet under active parse/re-parse is
marked in-flight so its config + review writes are rejected until the parse finishes. SCHEMA: `BoQ Sheet
Draft.parse_in_progress` (Check, default 0); `BOQs.parse_job_id` (Data, hidden, read-only) + `BOQs.
parse_enqueued_at` (Datetime, hidden, read-only) -- `BOQs.parse_in_progress` (BoQ-level) UNCHANGED. `bench
migrate` landed all three columns (get_meta verified). parse_run.py: `run_parse` gains a DOUBLE-FIRE guard
(if `BOQs.parse_in_progress==1`, call `_maybe_self_heal_parse_state`; a genuinely-live job -> throw "A parse
is already running", a stuck remnant -> self-heal + proceed), stores a RAW uuid `job_id` in `parse_job_id`
(NOT the namespaced `job.id` -- get_job_status re-namespaces, Recon #2 Q4) + `parse_enqueued_at`, and
SUPERSET-marks `parse_in_progress=1` at enqueue (named subset, else every Rule-3-admissible
{Reviewed,Parsed}+force_reparse{Parsed Check Done} sheet -- mirrors assemble_mapping_config). WORKER:
reconciles markers after `assemble_mapping_config`/`eligible_data_sheets` resolve (clears marked-but-
ineligible, marks the truly-eligible set, commits so the UI sees it mid-parse); `_publish_parse_event`
BLANKET-clears `parse_in_progress` on ALL drafts + blanks job_id/enqueued_at alongside the existing BoQ-flag
clear (correct on all 7 exit paths incl. the rollback-then-clear top-level-exception path). `_maybe_self_heal
_parse_state(boq)` reads job status via `frappe.utils.background_jobs.get_job_status(raw_id)`:
None/finished/failed -> clear (returns "cleared"); queued/started within 1200s -> "running" (NO mutation);
past 1200s or legacy-no-job-id -> clear (returns "cleared_stale"/"cleared"); a clear ALWAYS blanks
job_id+enqueued_at + all per-sheet markers. NEW endpoint `check_parse_status(boq)` (whitelist bare/GET) ->
{state: idle|running|cleared|cleared_stale} -- ships UNWIRED (the hub-mount call is a later frontend slice).
GUARDS: shared `_guard_sheet_not_parsing(boq, sheet)` (canonical home update_sheet_draft.py -- the leaf;
review_screen.py imports it, avoiding the circular import the reverse would cause; throws "This sheet is
being parsed..." iff the draft's parse_in_progress==1; missing draft -> pass-through), called AFTER the
existing guard sequence in the four review_screen write endpoints (`save_review_edit`,
`save_review_restructure`, `save_review_remark`, `dismiss_row_flags`) and after the child-exists check in the
five update_sheet_draft writers (`set_sheet_status`/`set_sheet_label`/`set_sheet_config`/`set_sheet_work
_packages`, plus per-named-sheet in `set_general_specs_sheet`). TESTS +27: test_parse_run 69->85
(TestParseEnqueueMarking [double-fire reject, subset+None superset marking, raw-not-namespaced id],
TestSelfHealParseState [None/finished/stale/legacy/idle + the non-mutating "running" check],
TestPerSheetParseMarkersWorker [reconcile clears ineligible, clears on success/global-fail/top-level-
exception]); test_update_sheet_draft 66->72 (TestParseInProgressGuard, 5 rejects + control);
test_review_screen 147->152 (TestParseInProgressWriteGuard, 4 rejects + control). Parser suite 588 unchanged.
ALL FRONTEND DEFERRED to a separate slice (the parse-lock UI + wiring check_parse_status); frontend/CLAUDE.md
deliberately NOT touched this slice (S5 backend-only lock). Recon-ref correction: wizard tests live at
`api/boq/wizard/test_*.py`, NOT a `tests/` subdir. Full detail in boq-upload-plan.md.
// prior: Slice D1 -- "Parsed Check Done" marking + read-only FREEZE + Un-mark
COMPLETE -- BACKEND + FRONTEND: a sheet at "Parsed Check Done" is FROZEN -- all four BoQ Review Row write
endpoints (`save_review_edit`, `save_review_restructure`, `save_review_remark`, `dismiss_row_flags`) reject
writes, enforced BACKEND + FRONTEND. BACKEND (review_screen.py): a shared `_get_sheet_wizard_status(boq,
sheet)` (one get_value, same parent/parenttype/sheet_name filter mark uses; sheet_name VERBATIM #152) +
`_guard_sheet_not_frozen(boq, sheet)` (throws an IDENTICAL read-only message via the `_FROZEN_WRITE_MESSAGE`
const), called in EACH of the four write endpoints immediately AFTER the BOQs-exists guard and BEFORE any
doc-locate/validation/write (in save_review_edit this short-circuits the expensive human_parent cycle-guard).
`mark_sheet_parsed_check_done` gains a PRECONDITION (after locating the child row, before the integrity
compute): already "Parsed Check Done" -> throw; not "Parsed" -> throw (current status echoed) -- its existing
ok:false+breaks / ok:true+overridden response shapes are UNCHANGED and its 3 prior tests stay green (they seed
"Parsed"). NEW endpoint `unmark_sheet_parsed_check_done(boq, sheet)` -- precondition current=="Parsed Check
Done" else throw, then direct `set_value(... "Parsed")` + commit, returns `{ok, status:"Parsed"}` (no integrity
check going backward; deliberately bypasses set_sheet_status, which rejects "Parsed" -- _DIRECT_SET_STATUSES
excludes it). test_review_screen 137 -> 147 (+10: TestParsedCheckDoneFreeze F1-F5 [each write blocked + an
unblocked control after restore], TestMarkSheetParsedCheckDone M1/M2 [already-checked + non-Parsed rejects],
TestUnmarkSheetParsedCheckDone U1-U3 [accept / reject / mark->freeze->unmark round-trip]), all green in-container.
FRONTEND: `boqTypes.ts` +`MarkParsedCheckDoneResponse`/`UnmarkParsedCheckDoneResponse` (reuse existing
`StructuralBreak`); `SheetReviewPage` derives `sheetStatus` from `boq.sheet_drafts` (one-level child -- already
on the payload, VERBATIM match) + `isChecked`, destructures `boqMutate` from the BOQs `useFrappeGetDoc`, adds a
header "Mark Parsed Check Done" button (only when status=="Parsed") -> light-confirm AlertDialog that escalates
to a breaks warn-and-confirm ("Mark anyway" re-POSTs confirm:true), and a teal read-only BANNER (when isChecked)
with Un-mark (light confirm) + Go-to-hub; passes `readOnly={isChecked}` to ReviewTree. `ReviewTree` gains
`readOnly?: boolean` gating ALL 11 write affordances at their render sites (reclassify pill, change-parent door,
value/text/area edit blocks, Remarks editor [read-only remark text shown if present], "Looks OK") -- the confirm
dialogs + childless AlertDialog + RestructureModal become unreachable (state-driven, reachable ONLY via gated
triggers); every VIEW affordance (expand/collapse, detail panel, search, filters, column selector,
scroll-to-parent) stays live. Errors via house `getFrappeError()`. tsc 0 new wizard-file errors + in-container
build exit 0 (`✓ built in 3m 36s`, PWA 166 entries). DEFERRED (logged): the update_sheet_draft dirty-marker
"Parsed"-only asymmetry stays for the status-rename slice -- NOT fixed here. Manual live-cert LC1-LC8 pending
Nitesh. Full detail in frontend/CLAUDE.md + boq-upload-plan.md.
// prior: C-flag-dismissal [per-row "Looks OK"] COMPLETE -- BACKEND + FRONTEND:
a per-row dismissal of advisory flags on the review screen. PER-ROW (one gesture clears ALL of a row's
currently-computing flags); STAYS "Original" (a dismissal is an ACKNOWLEDGMENT, not an edit -- it never
stamps edited_at, never touches edit_log, never flips isEdited). BACKEND: three additive fields on
`BoQ Review Row` -- `flags_dismissed` (Check, default 0), `flags_dismissed_by` (Data, read-only),
`flags_dismissed_at` (Datetime, read-only); a NEW endpoint `dismiss_row_flags(boq_name, sheet_name,
row_index, dismissed)` that MIRRORS `save_review_remark` (direct `frappe.db.set_value`, NOT doc.save, NOT
the `_apply_and_save_row_edit` chokepoint -- so no edited_at/edit_log/version side-effects; dismissed
truthy -> set 1 + by/at, falsy -> clear all three); a ONE-LINE insertion at the `_apply_and_save_row_edit`
chokepoint clears the dismissal on every data edit (decision 3a -- any edit RE-OPENS the flags; covers BOTH
save_review_edit AND save_review_restructure since both funnel through the helper); the 3 fields added to
`get_review_rows` all_fields so they ride the row payload. A remark does NOT re-open (it bypasses the
chokepoint -- intentional). Re-parse wipes the dismissal for free (delete+recreate -> the Check defaults 0;
NO parse-worker change). `_compute_advisory_flags` is UNTOUCHED -- flags stay computed-fresh; dismissal is
orthogonal. test_review_screen 131 -> 137 (TestDismissRowFlags +6: dismiss-stays-Original, un-dismiss,
edit-reopens, restructure-reopens, remark-does-NOT-reopen, get_review_rows-carries-fields), all green
in-container; `bench migrate` landed the 3 columns (has_column verified). FRONTEND: `boqTypes.ts` ReviewRow
gains `flags_dismissed?`/`_by?`/`_at?`; `ReviewTree` adds a "Looks OK" button in the detail-panel Flags
block (calls `dismiss_row_flags`, refresh via the existing `onRemarkSaved` mutate -- a dismissal is NOT an
edit), a NEW greyed/checked Info-marker state when dismissed (CheckCircle2, "Reviewed -- looks OK"; NOT
amber-active, flags still EXIST), and a "Reviewed -- looks OK" tag in the flag-reveal row -- the `isEdited`
predicate / Edited pill / green tint are UNTOUCHED; `SheetReviewPage` summary strip shows "N <label> -- C
cleared" per category (cleared = flags of that type whose row is dismissed; derived frontend-side from the
row payload, NO new endpoint). tsc 0 new wizard-file errors (baseline 3177 unchanged) + in-container build
exit 0 (`✓ built in 6m 46s`); manual live-cert LC1-LC6 pending Nitesh. Full detail in
frontend/CLAUDE.md + boq-upload-plan.md.
// prior: Restructure Slice 1b-beta2b [feat 20e1f5a7] COMPLETE -- FRONTEND ONLY:
two deliverables. D1 (finding-10/LC10 UI half): the broken inline error-extraction ladder is replaced by
the house helper `getFrappeError()` in FIVE catch blocks (RestructureModal.handleSave + ReviewTree
confirmChildlessReclassify / confirmValueSave / saveTextField / saveRemark), so backend `frappe.throw`
text -- e.g. the cycle explanation, which travels in `_server_messages` (the SDK's plain-object `.message`
is a hardcoded generic) -- reaches the user instead of "There was an error."; each site keeps its static
string as a `|| "..."` last-resort fallback; `frappeErrors.ts` + its 4 existing call sites UNTOUCHED.
D2 (finding-9): the row-position choice is now ALSO offered on the CHILDLESS reclassify path -- ReviewTree's
childless AlertDialog gains two radios: (1) Keep current position [DEFAULT; Confirm reclassifies only,
byte-for-byte as before: child_moves:{}, no row_new_parent] and (2) Move under a new parent [routes ON
SELECT into the RestructureModal -- the AlertDialog is too small to host the picker]. RestructureModal
adapts for zero children (ALL gated on `children.length === 0`): hides the Children box + five-options
block, drops the option-required gate in `canSave` (row-position rule alone), adapts title/description
(no "children" language), and `rowPosition` lazy-inits to "move" (a childless row reaches the modal only
via the move route). WITH-children behaviour UNCHANGED (S6); `buildChildMoves` already returns {} with
zero children. Backend UNTOUCHED -- the childless wire shape (row_new_parent + child_moves:{}) is already
certified by backend tests T2/T4. tsc 0 errors in both touched files (baseline 3177 unchanged) + build
exit 0; no Frappe unit tests (UI slice); manual live-cert LC-i..LC-vii pending. LC10's backend half was
CLOSED by T1/T2; its UI-surfacing half closes at LC-i (the cycle message now surfaces inline). Full detail
in frontend/CLAUDE.md + boq-upload-plan.md.
// prior: Restructure Slice 1b-beta2 [feat 1ed9d3b7] COMPLETE -- BACKEND + FRONTEND:
the restructure flow now also places the RECLASSIFIED ROW ITSELF, not just its children.
BACKEND: `save_review_restructure` gains an OPTIONAL `row_new_parent` param (None/omitted = the
row's parent is left untouched, byte-for-byte today's behaviour for every existing caller; -1 = move
the row to top-level/root; int = move it under that row). The batch cycle-guard is EXTENDED two ways:
(a) the row's own move is written into the SAME `sim` map as the child moves, and (b) `row_index` is
added to the `_chain_has_cycle` check START-POINTS whenever `row_new_parent` is given. (b) is
load-bearing -- a pure row move with EMPTY child_moves would otherwise run ZERO cycle checks (the
check-loop iterates child moves only) and silently corrupt the tree (e.g. a row moved under its own
child). `_chain_has_cycle` (the walk is general) and `_apply_and_save_row_edit` (the #54-Option-B
human_is_root XOR human_parent invariant chokepoint) are UNCHANGED -- the row's own move is ONE extra
helper call on the SAME `target_doc` (after the classification call, before the single commit; two
sequential helper calls on one in-memory doc are safe). Response gains `row_moved: bool`. The corruption
guards are PROVEN genuine: T1 (keystone -- row under its own child, empty moves), T2 (zero-checks trap,
explicit child_moves={}), T7 (shared-sim NON-EMPTY trap -- cycle via the row while an innocent acyclic
child move is also present; literal "individually-acyclic joint-only" is mathematically IMPOSSIBLE here
since every child currently has effective parent == row_index, documented in the test) ALL fail-if-broken
(verified by temporarily reverting the start-point extension -> exactly T1/T2/T7 go red, 128 others stay
green). +4 happy/compat tests (row->new-parent, row->root read-back, omitted-param backwards-compat,
self-parent reject). test_review_screen 124 -> 131, all green in-container. FRONTEND: RestructureModal
gains a "This row's position" control (Keep current [DEFAULT, omits the param] / Move under a new parent),
reusing the SAME SheetSearchView picker + hitRowIndex resolution + no-match guard the child pickers use
(plus a Top-level -1 option); Save gated until a chosen move is resolved; childless light path (ReviewTree)
untouched. tsc 0 errors in RestructureModal (baseline 3177 unchanged) + build exit 0; manual live-cert
STAGE A/B/C + LC-1..LC-5 pending. LC10 backend half CLOSED by T1/T2; UI-surfacing half closes at LC-5.
Full detail in frontend/CLAUDE.md + boq-upload-plan.md.
// prior: SheetSearchView v2 [feat fc7147db] COMPLETE -- FRONTEND ONLY: re-certifies
the 1a-certified `SheetSearchView` with three bundled changes -- (1) FETCH SWAP: the windowed
get_sheet_preview 200-row loop is replaced by a single `get_sheet_preview_full` call [the new endpoint
below is now WIRED -- the perf OWED item lands here, live-proven in the v2 cert]; (2) COLUMN RESTYLE:
table-fixed, Description w-[360px]/others w-[120px], cells wrap; (3) CLICK-TO-SELECT: new optional
onRowClick + selectedRowNumber props, persistent inset blue selected ring, RestructureModal reuses its
existing row_number->row_index resolution + no-match guard [click-sets-hit, no duplication]. New additive
`SheetPreviewFullResponse` type; `SheetPreviewResponse` + `get_sheet_preview` untouched. tsc 0 errors in
the 3 touched files [baseline 3177 unchanged] + build exit 0; no Frappe unit tests [UI slice]; manual v2
live-cert pending. Frontend detail in frontend/CLAUDE.md + boq-upload-plan.md.
// prior: get_sheet_preview_full [feat 196ed765] COMPLETE -- BACKEND ONLY:
new additive whitelisted endpoint `get_sheet_preview_full(boq_name, sheet_name)` that fetches +
opens the workbook ONCE and reads EVERY row in a single pass (no 200-row cap), reusing the existing
helpers + the IDENTICAL per-row skip logic so its `rows` is BYTE-IDENTICAL to concatenating every
windowed get_sheet_preview call over the same sheet. Replaces the need for SheetSearchView's slow
windowed loop (one S3 fetch + workbook open PER 200-row window, ~30s on a 1001-row sheet). The existing
`get_sheet_preview` is UNCHANGED -- still serves SheetSpokePage's on-demand 40-row pagination (S2;
diff is purely additive, +237 lines, 0 deletions). Return shape `{sheet_name, rows, returned_count,
has_more:False}` -- has_more kept (always False) for v2 type-compat; start_row/end_row_requested omitted
(no window). NO frontend consumer yet -- the SheetSearchView switch is deferred to the "SheetSearchView
v2" slice (bundled with column-widths/wrap + click-to-select per the slice-composition framework, so the
certified component is re-certified ONCE). The tests ARE the cert: new TestGetSheetPreviewFull (9) incl
the byte-identity keystone (windowed-concat == full-read, exact); 23 existing sheet_preview tests pass
unchanged; 32 total, in-container bench run-tests OK. Live perf proof lands in v2. No frontend touched ->
frontend/CLAUDE.md not substantively affected this slice. Full detail in boq-upload-plan.md.
// prior: Restructure Slice 1b-beta [feat e8eeab58] COMPLETE -- FRONTEND: the
restructure MODAL. Detail-panel classification pill -> DropdownMenu of the 4 assignable targets;
childless rows take a light AlertDialog confirm (empty child_moves), rows WITH children open the staged
`RestructureModal` (NEW) -- lists the row + children + FIVE child-placement options [move-up /
keep-under-this-row (gated to parent-capable line_item/preamble) / one-new-parent / per-child /
all-top-level], no option pre-selected, Save gated until the choice is complete, assembles a
fully-resolved child_moves map [Path A; -1 = top-level] and fires ONE `save_review_restructure` call.
Mounts the CERTIFIED `SheetSearchView` (byte-for-byte untouched) as the parent picker via its existing
onCurrentHitChange; resolves the picked Excel row_number -> review-row row_index via source_row_number, with
a no-match guard disabling Set-as-parent on header/banner rows. `onRestructured` prop wired to the existing
`handleSaved` (a restructure IS a real edit -- same setLastSavedAt + mutate SWR refresh). The temporary
Slice 1a dev route + `_DevSheetSearchHarness.tsx` are REMOVED (gated last, after tsc+build green).
Verification: in-container tsc 0 errors in touched wizard files (project-wide pre-existing baseline 3177
unchanged), in-container build exit 0; no Frappe unit tests (UI slice); manual live-cert LC1-12 pending.
Restructure-surface arc now COMPLETE pending live-cert. OWED next: single-pass full-sheet-read endpoint
(replace SheetSearchView's windowed 200-row loop). Full detail in frontend/CLAUDE.md + boq-upload-plan.md.
// prior: Restructure Slice 1b-alpha [feat f7761415] COMPLETE -- BACKEND-led: shared
write helper `_apply_and_save_row_edit` (save-inside / commit-outside) extracted from save_review_edit
[behaviour-preserving, 110 prior tests pass unchanged]; new transactional `save_review_restructure`
(atomic reclassify-one-row + reparent-children in ONE commit; Path A resolved `child_moves` map; whole-sheet
BATCH cycle-guard -- all moves simulated together; FROM-but-not-TO classification narrowing: assignable =
line_item/preamble/note/spacer, subtotal_marker/header_repeat rejected as TARGETS, also tightened on
save_review_edit); HUMAN-ROOT via NEW `human_is_root` Check field on BoQ Review Row (Option B -- ORTHOGONAL
to the -1 sentinel, which is UNCHANGED; consistency invariant root-XOR-row-override enforced at the single
helper chokepoint via a `set_root` kwarg; `child_moves` value -1 = top-level). test_review_screen 124 green.
Frontend touch ONLY: ReviewTree `parentOverridden` accounts for human_is_root + `human_is_root` on the
ReviewRow type -- the restructure MODAL is Slice 1b-beta. Full detail in boq-upload-plan.md.
// prior: Restructure surface Slice 1a [feat 5ecf1820] LIVE-CERTIFIED 2026-06-09 --
5/5 checks PASS on BOQ-26-00145: columns trimmed (#, Sl.No, Description, Unit, both Qty cols shown;
Rate+Amount hidden), exact-match description search + correct hit counter, cycling prev/next stepper,
scroll-to-hit + highlight, full-sheet load; verified on a clean-name sheet (Fire Fitting, 1001 rows)
AND a trailing-space sheet (Electrical , #152).
FRONTEND-ONLY `SheetSearchView.tsx` [self-contained get_sheet_preview full-sheet load by looping
200-row windows + role->letter join from draft.sheet_config.column_role_map; trim to
#/Sl.No/Description/Unit/every-Qty, hide Rate+Amount; FINDS+SHOWS only -- no selection/save/modal,
all Slice 1b] + a TEMPORARY `_DevSheetSearchHarness.tsx` and throwaway route
`upload-boq/_dev-sheetview/:boqId/:sheetName` [both REMOVED in Slice 1b]; NO backend/doctype/schema change.
Deferred from 1a live-cert: (a) fuzzy/typo-tolerant description search DEFERRED (exact matching kept for
V1; logged decision, not owed work); (b) full-sheet-load perf ~30s on the 1001-row Fire Fitting sheet
[windowed get_sheet_preview re-opens the workbook per window] OWED as a Slice 1b backend follow-up: a
single-pass full-sheet-read endpoint.
Full detail in frontend/CLAUDE.md + boq-upload-plan.md.
// prior: Slice C-values arc C-v1..C-v2d-fix (feats 2bf77d62 / aa74a023 / ae65555c / da6bb6d1 /
ae9dcff2 / cd2cc156 / 7fee7481) COMPLETE -- inline value/text/per-area editing + per-row Remarks on the
review screen; C-values rate-editing live-cert still OWED against a Pattern-2-rate vehicle + RE-LIVE-CERT
of the per-area qty edit after bench restart (see boq-upload-plan.md).
**Frontend conventions file: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**

## Overview

Nirmaan Stack is a construction project management and procurement ERP built on Frappe v15+ (Python 3.10+, PostgreSQL 14). The backend exposes whitelisted Python APIs consumed by a React 18 + TypeScript SPA. Core domains: Procurement (PR → RFQ → PO → DC/DN), Projects, Vendor Management, Service Requests, Financial Tracking, Inventory, and Document AI invoice autofill.

---

## Tech Stack

- **Backend:** Frappe v15+, Python 3.10+, PostgreSQL 14.11 (never MariaDB), Redis, Socket.IO
- **Frontend:** React 18, TypeScript 5, Vite 5, React Router v6, `frappe-react-sdk 1.7`
- **UI:** shadcn/ui (primary) + Ant Design 5 (selective), TailwindCSS 3
- **State:** Zustand 5, React Hook Form + Zod, TanStack Table v8
- **Infra:** Firebase 10 (FCM push), GCP Document AI (invoice OCR), Sentry 10

---

## App / Module Map

```
nirmaan_stack/
├── nirmaan_stack/doctype/   # 84 custom doctypes — data models and JSON schemas
├── api/                     # @frappe.whitelist() endpoints (35+ files, snake_case names)
├── integrations/
│   ├── controllers/         # ALL doc lifecycle hooks — after_insert, on_update, etc.
│   ├── firebase/            # FCM push notification dispatch
│   └── Notifications/       # In-app notification logic
├── services/                # Reusable business logic (document_ai.py, finance.py)
├── tasks/                   # Scheduled jobs: daily item status, 10 AM vendor credit cron
├── www/                     # Serves frontend.html (SPA entry) and boot API
├── patches/                 # DB migrations v1_5 → v3_0 (append-only)
└── hooks.py                 # App wiring: doc_events, scheduled tasks, fixtures
```

Frontend lives in `frontend/src/`:
- `pages/` — route-level components, one folder per domain
- `components/ui/` — shadcn/ui primitives (generated, don't hand-edit)
- `zustand/` — global state stores
- `components/helpers/routesConfig.tsx` — all route definitions

---

## Coding Conventions

### Python
- **Lifecycle hooks:** Always in `integrations/controllers/<doctype>.py`. Never in doctype `*.py` files.
- **Doctype `*.py` files:** Only `autoname` and simple `validate`. Nothing else.
- **API modules:** `snake_case` filenames under `api/<feature>/`. Never hyphens.
  - Subdirectories under `api/<feature>/` are acceptable for sub-area grouping (e.g. `api/boq/wizard/upload_file.py`). Use them when a feature has multiple sub-areas that benefit from logical grouping.
- **File size:** Split any file exceeding ~500 lines into focused submodules.
- **Child Tables:** For relational, queryable data (items, payment terms, ledger entries).
- **JSON Fields:** For flexible, UI-driven data (category lists, RFQ metadata).
- **Transactions:** `frappe.db.commit()` after any DML in whitelisted methods. Call it **before** `publish_realtime()` to avoid race conditions.

### TypeScript
- All Frappe data access via `frappe-react-sdk`: `useFrappeGetDocList`, `useFrappeGetDoc`, `useFrappePostCall`.
- Backend mutations: `useFrappePostCall('nirmaan_stack.api.<module>.<method>')`.
- Real-time events named `{doctype}:{action}` (e.g. `po:new`, `pr:approved`).
- **Do not introduce new UI libraries.** Stay within shadcn/ui + TanStack Table + Zustand + React Hook Form + Zod.

---

## PostgreSQL Gotchas

1. **Reserved keyword:** Always quote `"user"` in raw SQL.
2. **JSON field filters:** `frappe.get_all()` cannot use `!=` or `is set` on JSON fields. Use raw SQL: `WHERE json_col IS NOT NULL` with double-quoted table names (`"tabDoctype"`).
3. **Child table filtering:** `frappe.get_all()` filters at the **parent** level — if any child row matches, all rows of that parent are returned. For row-level filtering, use SQL JOINs. See `api/credits/get_credits_list.py`.
4. **rename_doc():** Only updates Link fields. Data fields storing document names need manual SQL.

---

## Domain Gotchas

- **PO Delivery Documents** are polymorphic: `parent_doctype` = `"Procurement Orders"` or `"Internal Transfer Memo"`. Always filter by `parent_doctype`; use `parent_docname` (not legacy `procurement_order` field).
- **Vendor credit status:** `recalculate_vendor_credit()` never sets `vendor_status` to On-Hold. Only the daily 10 AM cron does that. The function can auto-clear On-Hold → Active.
- **CEO Hold:** Only `nitesh@nirmaan.app` may set/unset — enforced in `integrations/controllers/projects.py`, not role-based.
- **Invoice Autofill:** Opt-in only via InvoiceDialog. Never recreate `services/file_extractor.py` or the `DocumentSearch` page — both intentionally deleted.
- **Email ops:** Use `api/users.create_user` and `api/users.reset_password` — these decouple email from the core operation.
- **Administrator user:** Name is the literal string `"Administrator"`, not an email. Handle explicitly in rename/delete logic.
- **Frappe child-table serialization depth:** `frappe.get_doc` / the REST resource API hydrate child tables ONE LEVEL DEEP ONLY. A child-of-a-child (grandchild) Table field is NOT returned. When a doctype has a child table that itself has a child table, the grandchild needs an explicit read path (a whitelisted endpoint querying the grandchild doctype directly via `frappe.db.get_all`). Example: BoQ Sheet Draft.work_packages required `get_boq_work_packages` (`api/boq/wizard/update_sheet_draft.py`).

---

## Commands

```bash
# Dev server (from frappe-bench directory)
bench start                          # Backend :8000, Socket.IO :9000

# Database
bench --site localhost migrate        # Run pending patches
bench --site localhost clear-cache    # Flush Redis

# Assets / doctypes
bench build
bench new-doctype "Name"

# Tests
bench run-tests --app nirmaan_stack
```

**Ad-hoc DB queries from host** (bench CLI broken on host — click version mismatch):
```bash
cat > /tmp/q.py <<'EOF'
import os; os.chdir('/workspace/development/frappe-bench/sites')
import frappe; frappe.init(site='localhost'); frappe.connect()
# ... query ...
frappe.destroy()
EOF
docker cp /tmp/q.py frappe_docker_devcontainer-frappe-1:/tmp/q.py
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 env/bin/python /tmp/q.py
```
`os.chdir` to `sites/` is **required** before `frappe.init()`.

**Windows quirk:** prefix `MSYS_NO_PATHCONV=1` on all `docker exec` and `docker cp` commands when passing UNIX-style paths through Git Bash. Bash tool on Windows otherwise translates `/tmp/...` → `C:/Users/.../Temp/...`. See handover §9 #93 + §11 #33.

### BoQ env / testing procedures

For BoQ Upload dev-environment setup, clean bench-restart sequence, the CSRF clear-site-data login fix, the two-port (:8080 live / :8000 stale) rule, and manual read-only DB-inspect (PostgreSQL, run-from-sites-dir): see `BoQ_Environment_Testing_Runbook_v1_0.md` (in project knowledge). Source of truth remains handover doc §9 #118-#123 + caveats TT/UU/VV/WW; the Runbook is a convenience digest.

---

## Testing Conventions

- **Framework:** `frappe.tests.utils.FrappeTestCase` (Python unittest subclass).
- **Location:** `nirmaan_stack/nirmaan_stack/doctype/<name>/test_<name>.py` — co-located with each doctype.
- **Existing tests:** Nearly all are empty stubs. Don't rely on them to catch regressions.
- **New code:** Pure-Python modules (parsers, services) must have real unit tests with fixture files. No stubs for logic-bearing code.
- **Frontend E2E:** Cypress 13.7 configured in `frontend/cypress.config.ts` — largely unimplemented.
- **After editing any doctype JSON:** Always run `bench --site localhost migrate`. Tests use a separate test database that auto-migrates, so **passing tests do not guarantee the runtime database has the new column**. Verify with `frappe.db.has_column("DocType Name", "field_name")` in the bench console after migration.

### Projects row fixture pattern

Tests that need a Projects row in `setUpClass` must satisfy the legacy `Projects.after_insert` hook (`generate_pwm` in `doctype/project_work_milestones/project_work_milestones.py`). The hook requires `project_start_date` + `project_end_date` in `"YYYY-MM-DD HH:MM:SS"` format and `project_scopes` as a dict with a `"scopes"` key.

Working pattern:

```python
@classmethod
def setUpClass(cls):
    super().setUpClass()
    cls.test_project = frappe.new_doc("Projects")
    cls.test_project.project_name = f"TEST_<feature>_{frappe.generate_hash(length=6)}"
    cls.test_project.project_start_date = frappe.utils.now()[:19]
    cls.test_project.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    cls.test_project.project_scopes = {"scopes": []}
    cls.test_project.insert(ignore_permissions=True)
    frappe.db.commit()

@classmethod
def tearDownClass(cls):
    # Delete child rows (BOQs etc.) first, then the project
    frappe.delete_doc("Projects", cls.test_project.name, force=True, ignore_permissions=True)
    frappe.db.commit()
    super().tearDownClass()
```

Why `[:19]` truncation: `frappe.utils.now()` returns microsecond-precision strings (e.g. `"2026-05-29 12:30:45.581159"`); `generate_pwm` calls `strptime(..., "%Y-%m-%d %H:%M:%S")` which rejects them. `add_to_date` return values need the same truncation. Empty `{"scopes": []}` makes `generate_pwm` run but produce zero milestones — correct for test isolation. Origin: Module 1a 2026-05-29.

---

## Don't Touch

| Path | Reason |
|---|---|
| `nirmaan_stack/nirmaan_stack/doctype/*/*.json` | Auto-generated by Frappe — edit via Desk UI or bench tooling only |
| `patches/` | Append-only migration history — never modify existing files |
| `www/frontend.html` | Auto-generated SPA shell |
| `frontend/src/components/ui/` | shadcn/ui generated components — update via shadcn CLI |
| `nirmaan_stack/public/` | Compiled frontend assets — edit source in `frontend/src/` instead |
| `services/file_extractor.py` | Intentionally deleted — do not recreate |

**Sanctioned exception:** A doctype JSON field's `fieldtype` MAY be changed via a deliberate, reviewed, committed CC edit + `bench migrate` when a schema constraint must be corrected (e.g. `source_file_url` Data->Small Text, fix 3815ea3f, 2026-05-30). Any such change must be isolated to the minimum field diff and explicitly noted here.

---

## Active Features

| Feature | Branch | Spec | Status |
|---|---|---|---|
| BoQ Upload & Management | `feature/boq-phase-3` | `frontend/.claude/plans/boq-upload-plan.md` | Phases 1.x (parser, 588 tests) + Phase 3 Modules 1a/1b/2a/2b/3 COMPLETE. Review-screen arc COMPLETE: Slice A backend (feat fff26abd; -1 sentinel, resolve_effective / check_structural_integrity / append_edit_log_entry + 3 endpoints) -> B1/B1.1/B2a/B2b/B2c frontend (review tree + column descriptors + advisory flags + detail panel + Status column) -> C-values arc C-v1..C-v2d-fix (inline value/text/per-area editing + per-row Remarks). Restructure surface Slice 1a (searchable sheet-view `SheetSearchView.tsx`, FRONTEND-ONLY, feat 5ecf1820) LIVE-CERTIFIED 2026-06-09 (5/5 PASS on BOQ-26-00145). Slice 1b-alpha BACKEND (feat f7761415) -- shared write helper `_apply_and_save_row_edit` (save-inside/commit-outside) + transactional `save_review_restructure` (atomic reclassify+reparent, batch cycle-guard, FROM-but-not-TO assignable classes) + human-root via NEW `human_is_root` Check field (Option B, orthogonal to the -1 sentinel). CURRENT: Slice 1b-beta FRONTEND COMPLETE (feat e8eeab58) -- the restructure MODAL: detail-panel pill DropdownMenu -> childless light confirm OR staged `RestructureModal` (5 child-placement options, Path A fully-resolved child_moves, mounts certified SheetSearchView untouched as parent picker, row_number->row_index resolution + no-match guard), `onRestructured` reuses handleSaved; dev route + `_DevSheetSearchHarness.tsx` REMOVED. tsc 0 wizard-file errors + build exit 0; manual live-cert LC1-12 pending. Restructure-surface arc COMPLETE pending live-cert. Slice D1 -- "Parsed Check Done" marking + read-only FREEZE + Un-mark (BACKEND + FRONTEND): four-endpoint write freeze on a checked sheet via `_guard_sheet_not_frozen`, mark precondition (Parsed-only), new `unmark_sheet_parsed_check_done`, `readOnly` ReviewTree gating + Mark button + teal banner; test_review_screen 137 -> 147. Slice D2 -- per-sheet review CSV export (FRONTEND ONLY, feat 27866a2e): NEW wizard-local writer `exportReviewCsv.ts` (flat columns, per-area = one column per area per role, numbers raw, UTF-8 BOM) + "Export CSV" header button (status- and view-independent); reuses ReviewTree `resolveDescriptorValue`/`computeDepths`/`CLS_LABELS`/`FIXED_ROLE_DEDUPE` via export-keyword-only; the shared `src/utils/exportToCsv.ts` deliberately untouched. Slice D2b (latest) -- hub XLSX workbook export + per-card CSV export (FRONTEND + dependency, feat 91bf255d): a global "Export reviewed" footer button -> `ExportWorkbookDialog` (pre-ticked checklist of "Parsed Check Done" sheets) -> SEQUENTIAL `get_review_rows` fetch -> ONE .xlsx (one tab/sheet, numbers numeric, abort-on-any-failure) via NEW `exportReviewXlsx.ts`; a per-card "Export CSV" button -> the existing D2 .csv. NEW dep `exceljs` DYNAMICALLY imported (own lazy chunk, absent from hub/entry chunks); npm `xlsx` forbidden (abandoned + 2 CVEs). The D2 writer refactored to share a `buildReviewSheet` typed-cell core -> .csv stays byte-identical; Excel tab names sanitized+de-duplicated (tab title only, Sheet Name column verbatim #152). `SheetReviewPage.tsx` untouched (writer signature unchanged). OWED: single-pass full-sheet-read endpoint; C-values rate-editing live-cert against a Pattern-2-rate vehicle. **PHASE 4 (committed BoQ-model rebuild) COMPLETE: P4-1 BoQ Sheet tier -> P4-2 node re-point (sheet link + denormalized boq sync-guard) -> P4-3 commit field-mapping lock -> P4-4 8 missing node fields -> P4-5 child Float->Currency -> P4-6 skip-filter verify -> structural CHECKPOINT -> P4-FINAL (parent_boq retired + dev fixtures purged; 34 uploaded live-cert workbooks preserved). NEXT = Phase 5 commit arc (Finalized commit gate + general-specs faithful-row capture).** Full slice-by-slice history + as-built detail: see boq-upload-plan.md. Do not duplicate the changelog here. |

Always read `frontend/.claude/plans/boq-upload-plan.md` before working on BoQ. Active doctypes: `BOQs`, `BoQ Sheet` (Phase 4 P4-1 -- the committed sheet tier, standalone istable=0, Links up to BOQs, autoname `BQSH-.YY.-.#####`; reuses the `BoQ Sheet Work Package` child for work-header links. WRITTEN by the commit pipeline from Phase 5 Slice 3a [column-config snapshot from the draft]; Phase 5 Slice 3b added the versioning triple `commit_version`/`is_current`/`committed_at` -- the sheet is now VERSIONED [freeze-and-supersede via `set_value`, NOT deleted; 3a's raw-delete retired]; nodes attach to it via their `sheet` Link), `BOQ Nodes` (Phase 4 P4-2 -- now links to a `BoQ Sheet` via the new `sheet` Link [the PRIMARY upward tie]; the `boq` Link->BOQs is KEPT DENORMALIZED, controller-synced so `node.boq == sheet.boq` [auto-filled from the sheet when blank, throws on mismatch]; the required-guard moved from boq to sheet. Phase 4 P4-4 -- gained 8 storage fields populated at commit [Phase 5]: human-layer `human_classification`/`human_parent`/`human_is_root`, edit provenance `edit_log` [JSON, opaque, KEPT on node not derived from Nirmaan Versions]/`edited_by`/`edited_at`, `remarks` [Small Text], `attached_notes` [JSON, opaque, own field not folded into `notes`]; `_write_audit` UNCHANGED [tendering-era audit scope is an OPEN decision for the tendering boundary, not inherited]. Phase 5 Slice 2.5 -- the controller is now CAPTURE-ONLY: `_compute_amounts` + `_recompute_parent_rates_from_areas` REMOVED from before_save (no amount = qty x rate recompute, no parent-rate weighted-average overwrite); `is_rate_only` no longer auto-set [field STAYS, value carried from the review row by Slice 3]; `read_only` dropped on supply_amount/install_amount/total_amount/is_rate_only; ALL structural validations kept [sync-guard, level/parent rules, qty_by_area no-dup-area, `_compute_path`]. **Phase 5 post-dogfood fix -- Preamble level constraint RELAXED `>=1` -> `>=0`** (`boq_nodes.py`: throws only on `level is None or < 0`): a level-less preamble may commit at level 0 (the commit pipeline computes it; see `_compute_levelless_preamble_levels`). **Phase 5 Slice 3b -- now WRITTEN by the commit pipeline** [`_commit_node_tree`, FINALIZED sheets only]: gained `review_row_name`+`commit_provenance_id` [provenance], `is_synthetic` [future-insurance Check], `append_notes_raw` [JSON dict], and the versioning triple `commit_version`/`is_current`/`committed_at` [per-node versioning, shared commit_version with grid+sheet]. P4-3 money mapping lands here [rate_*->*_rate / amount_*->*_amount, Float->Currency; sl_no_value->code, row_index->sort_order]; human-layer carried as PROVENANCE ONLY [never branched on]; edit_log+attached_notes carried [list-JSON -> written via pass-3 set_value]. **combined_rate consistency RELAXED to a WARNING** [parent + child; was throw -- capture-only]), `BOQ Node Qty By Area` (Phase 4 P4-5 -- its six rate/amount fields `supply_rate`/`install_rate`/`combined_rate`/`supply_amount`/`install_amount`/`total_amount` are now `Currency`, matching the parent BOQ Nodes; `qty` stays `Float`. The P4-3-deferred parent/child Float-vs-Currency inconsistency is now CLOSED. Phase 5 Slice 2.5 -- child controller is CAPTURE-ONLY too: `_apply_rate_fallback` [blank child rate inheriting parent] + `_compute_child_amounts` [child amount = rate x qty] REMOVED; `validate_child`/`_validate_combined_rate` KEPT but Phase 5 Slice 3b RELAXED its combined_rate check from throw -> WARNING [capture-only; a blank child rate stays None -> the all-three-set guard never spuriously trips]. NOTE: child `qty` + `area_name` are reqd=1, so the per-area explosion defaults child qty to 0.0 for an amount/rate-only area), `BoQ Committed Sheet Grid` (Phase 5 Slice 1 doctype, RENAMED from `BoQ Committed General Specs` in
Slice 3a -- the committed home for ANY committable sheet's FAITHFUL cell grid [all 6 row classifications,
original position; grid-only general-specs AND grid+nodes finalized alike]; standalone istable=0, Links up to BOQs,
autoname `BCSG-.YY.-.#####`; carries the per-sheet commit-version dimension `commit_version`/`is_current` [the
one-current invariant is ENFORCED by the Slice-3a commit pipeline `commit_pipeline.py`, not the controller] +
`committed_at` + the Slice-3a `sheet_disposition` Select [grid_only / grid_and_nodes, mapped from the gate's
general_specs / finalized]; one child table `rows` -> `BoQ Committed Sheet Grid Row` [istable=1:
`row_number`/`row_order`/`cells` JSON {col_letter: value}, mirroring `get_sheet_preview_full`'s per-row shape].
SEPARATE from the lossy `BoQ General Specs Sheet` blob doctype, which is UNTOUCHED. Written by `commit_pipeline.py`
[Slice 3a]; the Finalized node tree is Slice 3b), `BoQ Cell Pricing` (Phase 5 Slice 1b -- the per-cell PRICING LAYER on top of the committed tier: standalone istable=0, autoname `BPRC-.YY.-.#####`, track_changes=1. One record per priced committed Excel cell; identity = (boq, sheet_name VERBATIM, excel_row, col_letter, committed_version) -- the durable Excel address + the committed version it prices. col_letter STORED (derived from column_role_map, not on the node); node Link = re-resolvable per-version pointer, description = copy-forward guard -- NEITHER part of the key. `is_filled` = the layer's own filled-state (committed node rates read 0.0, not blank). Own freeze-and-supersede triple `pricing_version`/`is_current`/`priced_at` + `is_finalized` lock, mirroring the committed tier; one current per cell identity, endpoint-enforced (api/boq/wizard/pricing.py `save_cell_price`/`get_sheet_pricing`), NOT in the bare-stub controller. ADDITIVE -- never mutates the committed tier). (No separate audit doctype — audit goes through `Nirmaan Versions` per §7 of the BoQ handover doc / decisions log). Phased build (Phase 0 → 7) — don't implement Phase N+1 functionality while working in Phase N. Phase 2 sub-phase split: 2a → 2b.1a → 2b.1b → 2b.2 (A1, A2, A3, B) → 2c.

---

## Working with Claude Code

- Read `docs/<feature>/spec.md` and the latest entries in `decisions.md` before starting any feature phase.
- **Output a written plan before writing any code. Never write code in the same turn as the plan.** Wait for user review.
- One branch per phase: `feature/<feature>-phase-<N>`. Commit at end of each phase.
  - Phase 3 (wizard) is active on `feature/boq-phase-3`, branched from `feature/boq-phase-2` tip `2e338b36` (2026-05-29). Pre-v5.30 "Phase 2c body" framing superseded — wizard work is Phase 3. `feature/boq-phase-2` is frozen at `2e338b36`.
- New doctypes: controllers go in `integrations/controllers/`. Doctype `*.py` stays minimal.
- New APIs: `nirmaan_stack/api/<feature>/<file>.py`, snake_case.
- Frontend: stay within the existing stack (shadcn/ui + TanStack Table + Zustand + frappe-react-sdk + React Hook Form + Zod). Do not introduce new UI libraries.
- Pure-Python modules (parsers, services) get real unit tests with fixture files — not stubs.

**Docs discipline -- DOCS-UPDATE RULE (all three, every commit):** Every docs or feat+docs commit updates ALL THREE docs -- `frontend/.claude/plans/boq-upload-plan.md`, root `CLAUDE.md` (this file), and `frontend/CLAUDE.md` -- with NO exceptions. A doc not substantively affected still gets a MINIMAL TOUCH (bump its last-updated/status line + a one-line note of what landed), never a skip. Rationale: "update CLAUDE.md" without naming which one let `frontend/CLAUDE.md` silently fall a full module behind (stale through all of Module 2b). Naming all three by full path removes the routing ambiguity. **Frontend conventions file: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**

---

## BoQ File Reading (S3 safety)

The BoQ upload worker (`api/boq/wizard/upload_file.py`) reads the uploaded file from a `NamedTemporaryFile` written from the in-memory bytes at the endpoint — NOT by constructing a local path from `file_url`. `Frappe File.get_content()` reads local disk only and breaks when `frappe_s3_attachment` is active (it replaces `file_url` with an `/api/method/...` API URL after insert). Any future code that needs to read an uploaded file's bytes should follow the same pattern: capture bytes before `save_file()`, write to a tempfile, clean up in a `finally` block.

## BoQ Upload Worker -- auto-guess prefill (Step 10.5)

After `boq_doc.insert()` (Step 10, which assigns child-row names), the worker runs a prefill step for every **Pending** sheet draft:

1. `reader.detect_header_row(sheet_name)` — heuristic keyword-scoring scan of the first 15 rows; returns `int | None`.
2. If a row is found: `auto_guess_sheet_config(reader, sheet_name, header_row)` from `nirmaan_stack.services.boq_parser._auto_guess`. Returns a `SheetConfig` Pydantic model.
3. `frappe.db.set_value("BoQ Sheet Draft", draft.name, "sheet_config", json.dumps(detected.model_dump()))` — writes the full SheetConfig (including `column_role_map`) as JSON.

**Failure-isolation rule (enforced by try/except):** an exception in step 1, 2, or 3 calls `frappe.log_error()` and leaves `sheet_config = None` for that sheet. The upload never fails because of a bad auto-guess. This is intentional: the wizard spoke's sparkle UX handles wrong guesses; a failed guess falls back to the empty-panel behavior.

**Pending-only scope:** Hidden and Skip sheets (marked by the worker itself based on sheet visibility) are skipped entirely — `detect_header_row` is never called for them.

**Read path:** `useFrappeGetDoc("BOQs", boqName)` returns the full doc including the prefilled `sheet_config` on each child row. The frontend's `SheetConfigPanel` reads `draft.sheet_config` and shows sparkle on all pre-filled fields.

---

## Wizard scope discipline (Phase 3 onward)

When a wizard decision has two paths — (a) build the capability inside the wizard, or (b) defer to or extend an existing app-wide flow — surface the fork explicitly in chat before writing code. Default lean: if the capability has reach beyond the Upload BoQ flow (i.e., other Nirmaan features would benefit from it), keep it outside wizard scope. The lean is a starting point only; the final call is case-by-case after discussion.

Common triggers: anything touching shared doctypes (Projects, Customers, Work Headers) in ways other features would also want; new app-wide UI patterns (sidebar items, top nav, modals); auth checks, audit, or notification flows other modules would benefit from.

Origin: Module 1a 2026-05-29 — `create_tendering_project` was initially scoped into the wizard, then dropped when this principle surfaced: tendering project creation has reach beyond the wizard and belongs in the existing Nirmaan new-project workflow.

---

## Wizard Endpoints Reference (Phase 3 Module 2a onward)

All wizard endpoints live in `nirmaan_stack/api/boq/wizard/`. All use `@frappe.whitelist(methods=["POST"])`, return `{"status": "saved"}`, call `frappe.db.commit()` after `frappe.db.set_value`.

**`update_sheet_draft.py`** (feat 5cdbbd16 + b14e9015) -- 5 functions:

- `set_sheet_status(boq_name, sheet_name, status)` -- sets `wizard_status` on the matching `BoQ Sheet Draft` child row. Allowed values (direct): Pending, Hidden, Reviewed, Skip, Parse failed. "General specs" is REJECTED here; caller must use `set_general_specs_sheet` instead (backend never writes "General specs" to wizard_status; frontend derives the badge from the pointer). URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_status`

- `set_sheet_label(boq_name, sheet_name, label)` -- sets/clears the optional `sheet_label` Data field. label=None or "" both clear. URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_label`

- `set_general_specs_sheet(boq_name, sheet_name_or_none)` -- (Slice 2c) designates / un-designates a sheet as general-specs using replace-all child-table semantics: designating removes all existing `BoQ General Specs Sheet` child rows and inserts one new row; un-designating (None or "") removes all rows. Backend writes child-table membership ONLY -- does NOT touch `wizard_status` on any draft row (M2.23 unchanged). Frontend derives "General specs" badge from the child table and handles warn-and-confirm. Un-designation removes the child row (preamble_text is re-extractable on re-parse). Full multi-select (additive) semantics are Slice 2b. URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_general_specs_sheet`

- `set_sheet_config(boq_name, sheet_name, sheet_config)` -- (feat b14e9015) writes per-sheet parser config JSON blob to `BoQ Sheet Draft.sheet_config`. Accepts dict or JSON string. Single JSON blob by design (wizard-internal; M3.18/§6.3). URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_config`

- `set_sheet_work_packages(boq_name, sheet_name, work_headers)` -- (feat b14e9015) replace-all assignment of Work Headers to a sheet's `work_packages` child table. `work_headers` is a list of Work Headers docnames (or JSON-string list). Validates ALL docnames before any write; rejects entire call if any are missing (no partial write). URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_work_packages`

**`wizard_status` enum (7 values on `BoQ Sheet Draft`):** blank / Pending / Hidden / Reviewed / Skip / General specs / Parse failed / Parsed. "Parse failed" has no writer until Module 5 (deliberate parse pass). "General specs" is never written directly to this field; it is derived by the frontend from `BOQs.general_specs_sheets` child table (set membership on `source_sheet_name`). "Parsed" is written by the parse-run worker (Slice 2) after a successful parse pass; `assemble_mapping_config` treats it identically to "Reviewed" -- both include the sheet as a data parse target with its saved `sheet_config` blob.

**Schema fields (Module 2a + Module 3 Slice 3a + Slice 2c):**
- `BoQ Sheet Draft.sheet_label` -- Data, optional. Human-reference label for Skip sheets. No parser coupling.
- `BoQ Sheet Draft.work_packages` -- Table, options "BoQ Sheet Work Package". Multi-link to Work Headers. REPLACES the former single-Link `work_package` field (renamed + converted in feat b14e9015). FRONTEND NOTE: `boqTypes.ts` still has `work_package?: string | null` -- a later frontend slice must update to `work_packages: BoQSheetWorkPackage[]`.
- `BoQ Sheet Draft.sheet_config` -- JSON, optional. Per-sheet parser config blob (header_row, header_row_count, column_role_map, area_dimensions, etc.). Written by `set_sheet_config`; consumed by parse pass. Never query cross-sheet; always treat as opaque blob outside the wizard.
- `BOQs.general_specs_sheets` -- Table, options "BoQ General Specs Sheet", in `parser_metadata_section`. REPLACES the removed scalars `BOQs.general_specs_sheet` (Data) + `BOQs.master_preamble` (Long Text) (Slice 2c, feat b5381c0c). Multiple general-specs sheets per workbook are now supported (M2.16 one-per-workbook constraint dropped). New child doctype path: `nirmaan_stack/nirmaan_stack/doctype/boq_general_specs_sheet/`.
- `BoQ Sheet Draft.parse_failure_category` / `parse_failure_reason` / `parse_failure_at` -- (Slice 1a, reactive #166, feat e4b1fefc) the durable per-sheet parse-failure REASON. `parse_failure_category` Select (`""`/`Config stale`/`Parser error`/`Insert error` -- the three IN-SCOPE failures ONLY; non-failures never set it); `parse_failure_reason` Small Text (the specific why -- the validation exc for STALE, a concise message + an `(ref: Error Log <name>)` handle for crashes); `parse_failure_at` Datetime read_only. ADDITIVE: written WITHOUT touching `wizard_status` (STALE: via `_record_parse_failure`, fields-only; PARSER/INSERT: folded into the existing `"Parse failed"` `_set_draft_status(extra_fields=...)`). CLEARED on a successful parse (folded into the `"Parsed"` write). Read by a LATER frontend hub-card notice slice (not built). Done-event payload UNCHANGED.
- `BoQ Sheet Draft.commit_failure_reason` / `commit_failure_at` -- (Slice F1, feat 5c095b34) the durable per-sheet COMMIT-failure stamp -- the commit-side analog of `parse_failure_*`. A PAIR, NO category Select (commit exceptions are heterogeneous/freeform, already flattened to one string by `_commit_failure_reason`). `commit_failure_reason` Small Text; `commit_failure_at` Datetime read_only. ADDITIVE: written WITHOUT touching `wizard_status` via `_record_commit_failure` (verbatim-#152 child lookup, `set_value` both fields `update_modified=False`). WRITTEN in `commit_boq`'s per-sheet `except` AFTER the mandatory `frappe.db.rollback()` + with its OWN explicit `frappe.db.commit()` (the rollback-then-write-then-commit ordering is load-bearing -- see `commit_pipeline.py` ref below). CLEARED on a successful commit via `_clear_commit_failure` folded into `_commit_one_sheet`'s trailing commit. Read by a LATER frontend hub-card "needs attention" slice (F2, not built). The `{committed, failed}` envelope is UNCHANGED (the fields are an additive superset of `failed[]`).

**New child doctype BoQ General Specs Sheet (Slice 2c, feat b5381c0c):**
- Path: `nirmaan_stack/nirmaan_stack/doctype/boq_general_specs_sheet/`
- `istable=1`, module "Nirmaan Stack", permissions [], engine InnoDB. Two fields: `source_sheet_name` (Data, reqd=1) + `preamble_text` (Long Text, read_only=1).
- Data model: BOQs -> BoQ General Specs Sheet (one level deep -- serializes on `useFrappeGetDoc("BOQs", ...)`).
- Migration: `v3_0/migrate_general_specs_to_child_table` reads old scalar columns via raw SQL + inserts child rows idempotently. Old DB columns dropped manually post-migration.

**New child doctype BoQ Sheet Work Package (feat b14e9015):**
- Path: `nirmaan_stack/nirmaan_stack/doctype/boq_sheet_work_package/`
- `istable=1`, one field: `work_header` Link -> "Work Headers" (reqd=1).
- NAMING TRAP: target doctype is "Work Headers" (NOT "Work Packages"). The legacy field was named `work_package` but it always pointed at "Work Headers" (the sub-category doctype).
- Python class: `BoQSheetWorkPackage(Document): pass`.
- Data model: BOQs -> BoQ Sheet Draft -> BoQ Sheet Work Package (two levels of child table nesting).

**Child-row update idiom:** `frappe.db.get_value("BoQ Sheet Draft", {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name}, "name")` to find child_name, then `frappe.db.set_value("BoQ Sheet Draft", child_name, field, value)`.

**Read path (sheet drafts):** no custom read endpoint. `useFrappeGetDoc("BOQs", boqName)` returns full doc including all `sheet_drafts` child rows.

**`sheet_preview.py`** (feat bf1a2e64, Slice 3b-i; + get_sheet_preview_full feat 196ed765) -- 2 functions:

- `get_sheet_preview(boq_name, sheet_name, start_row=1, end_row=40)` -- values-only windowed preview of raw cell data for one sheet. `@frappe.whitelist()` bare (read; callable via GET / useFrappeGetCall). Coerces start_row/end_row to int; guards start_row>=1, end_row>=start_row; clamps window silently to 200 rows max. Fetches the BoQ file from S3 via `_fetch_boq_file_to_tempfile` (URL-param key extraction + `S3Operations.read_file_from_s3`), opens with `openpyxl.load_workbook(path, data_only=True, read_only=True)` (~0.56s on a 7.65 MB file -- does NOT use BoqReader which takes ~27s due to double-open + merged-cell pre-scan), and reads the requested row window. VERBATIM sheet_name matching. Returns `{sheet_name, start_row, end_row_requested, rows: [{row_number, cells: {col_letter: value}}], returned_count, has_more}`. `has_more` derived from `ws.max_row` (dimension metadata). Tempfile always unlinked in a `finally` block. URL: `/api/method/nirmaan_stack.api.boq.wizard.sheet_preview.get_sheet_preview`

- `get_sheet_preview_full(boq_name, sheet_name)` -- (feat 196ed765) ADDITIVE single-pass full-sheet read: fetches + opens the workbook ONCE and iterates row 1 .. `ws.max_row` (None-safe -- read_only sheets with no `<dimension>` tag still iterate to the end) with NO 200-row cap. `@frappe.whitelist()` bare. REUSES the existing helpers verbatim (`_fetch_boq_file_to_tempfile`, `_to_json_serializable`, `get_column_letter`) and the IDENTICAL per-row skip logic (skip all-EmptyCell padding rows via `next((c.row...), None)`; skip EmptyCells within a kept row via `hasattr(cell,"column")`), so `rows` is BYTE-IDENTICAL to concatenating every windowed `get_sheet_preview` call over the same sheet (locked by `test_byte_identity_to_windowed_path`). VERBATIM sheet_name (#152). Same guards as `get_sheet_preview` (missing args / BOQs-not-found / empty source_file_url / sheet-not-in-workbook). Tempfile + workbook closed in a `finally`. Returns `{sheet_name, rows: [{row_number, cells: {col_letter: value}}], returned_count, has_more: False}` -- `has_more` always False (a full read has nothing beyond), kept only so the response stays type-compatible with `get_sheet_preview` for the v2 frontend; `start_row`/`end_row_requested` omitted (no window). PURPOSE: replace SheetSearchView's slow windowed loop (one S3 fetch + workbook open PER 200-row window, ~30s on a 1001-row sheet). `get_sheet_preview` is UNCHANGED -- still serves SheetSpokePage's on-demand 40-row pagination. NO frontend consumer yet -- the SheetSearchView switch is deferred to the "SheetSearchView v2" slice (bundled with column-widths/wrap + click-to-select, so the certified component is re-certified ONCE); live perf proof lands there. URL: `/api/method/nirmaan_stack.api.boq.wizard.sheet_preview.get_sheet_preview_full`

**`parse_run.py`** (Phase-1 Slice 1 + Slice 2) -- pure helpers + background worker + endpoint:

- `assemble_mapping_config(boq_name, force_reparse=False)` -- reads BOQs doc + BoQ Sheet Draft child rows, builds a `MappingConfig` Pydantic model for the parser orchestrator. Returns `(MappingConfig, not_eligible: list[str])`. Routing (in order, Slice 2c updated): (1) `general_specs_sheets` set membership -> `treat_as="master_preamble"` -- checked FIRST, outranks wizard_status (a Skip sheet in the child table must win); (2) Hidden/Skip -> `SheetConfig(skip=True)`; (3) Reviewed/Parsed with valid blob -> data sheet; (4) Pending/Parse-failed/blank/Reviewed-without-blob/Parsed-Check-Done -> `not_eligible`. Raises `frappe.ValidationError` if BOQ not found or no eligible sheets remain. `GlobalSettings` always defaults (no per-BoQ override). **IMPORTANT:** Injects `raw["sheet_name"] = sheet_name` before `SheetConfig.model_validate(raw)` in Rule 3 -- production wizard blobs omit `sheet_name`; without this injection all Reviewed sheets fall into `not_eligible`. **FORCE RE-PARSE (`force_reparse`, Force Re-parse backend slice):** when `force_reparse=True`, Rule 3 ALSO admits `"Parsed Check Done"` sheets (`if status in {"Reviewed","Parsed"} or (force_reparse and status == "Parsed Check Done")`) -- on the SAME terms as Rule 3 (valid sheet_config blob still required; empty/invalid-blob sub-gates still apply). **CONVENTION future work MUST respect: `"Parsed Check Done"` is parse-eligible ONLY under this flag** -- with `force_reparse=False` (the default, and the normal parse path) it stays in `not_eligible` byte-for-byte as before, so force-reparse can never leak into normal parsing. Scope is `"Parsed Check Done"` ONLY; `"Parse failed"` is NOT widened. A successful re-parse drops the sheet back to `"Parsed"` (Option A, worker status-set line unchanged) and DELETES the prior BoQ Review Rows (discarding human edits/remarks by design).

- `_validate_sheet_blob(blob, sheet_name) -> Exception | None` + `_stale_empty_reason(status)` / `_stale_invalid_reason(exc)` (Slice 1b, feat 32e31a2a) -- the SHARED config-staleness gate + reason vocabulary. `_validate_sheet_blob` returns None if the stored `sheet_config` blob validates as a `SheetConfig`, else the validation/parse Exception; it INJECTS `sheet_name` (production 6-key blobs omit it -- without injection EVERY blob false-positives) and catches a malformed/non-dict blob. It is the SINGLE SOURCE OF TRUTH for "does this saved config still validate", called by BOTH `assemble_mapping_config` Rule 3 (reactive parse-drop / 1a) and `get_stale_sheets` (proactive read / 1b), so the two never diverge; the reason builders make their messages byte-identical. (Rule 3's success path re-validates only to obtain the `SheetConfig` object -- behaviour-identical.)

- `get_stale_sheets(boq_name)` -- `@frappe.whitelist()` bare (READ-ONLY, GET-capable; Slice 1b, proactive #166). Flags sheets whose saved config no longer validates BEFORE a parse is triggered (validate-on-read; ZERO schema -- no stamp/fingerprint/migration). Returns `{"stale_sheets": [{"sheet_name" [VERBATIM #152], "reason"}, ...]}`. ROUTING PARITY with `assemble_mapping_config` (no new gating): general-specs pointer / Hidden / Skip never stale; Pending / Parse failed / Finalized / blank are not data sheets here (UNCONFIGURED != stale -- no cry-wolf; gate = `status in _RULE3_BASE_STATUSES` = {Config Done, Parsed}, i.e. force_reparse=False read semantics -- Finalized is NOT flagged on a normal read); Config Done / Parsed with a non-empty invalid blob -> stale (reason = validation detail via `_stale_invalid_reason`); Config Done / Parsed with an empty blob -> stale (mirrors 1a's empty-on-done, reason via `_stale_empty_reason`). PURE READ -- writes NOTHING (no set_value/insert/save/commit). Guard mirrors `run_parse`. Composes with 1a (same validation, two triggers; shared helper => identical verdict + reason; a test asserts byte-for-byte parity vs the 1a reactive stamp). URL: `/api/method/nirmaan_stack.api.boq.wizard.parse_run.get_stale_sheets`

- `flatten_resolved_row(resolved_row, sheet_name, row_index)` -- maps a parser `ResolvedRow` + nested `ClassifiedRow` to a flat dict of BoQ Review Row field values. JSON fields returned as Python objects (list/dict), NOT pre-serialized strings. CAVEAT: Frappe rejects Python lists for JSON fieldtype (`get_valid_dict` "cannot be a list"). Callers must `json.dumps()` the four list-JSON fields before `doc.insert()` -- see `_LIST_JSON_FIELDS` module constant. Dict-type JSON fields (`qty_by_area`, `amount_by_area`, `rate_by_area`, `append_notes_raw`) can be passed as Python dicts. **SENTINEL WRITES (agreement #54, both halves now applied):** writes `parent_index=-1` for root rows (None parent → -1) AND `human_parent=-1` for ALL rows (no human override at parse time). Both are required: Frappe coerces unset Int fields to 0, and 0 is a valid row index. `resolve_effective` treats `human_parent >= 0` as a real override -- without the explicit `-1`, every parsed row falsely reports effective_parent_index=0 (flat tree). Fix landed in Slice B1.1b-fix-A.

- `flatten_parsed_boq(parsed_boq, boq_name)` -- iterates `ParsedBoq.sheets`, calls `flatten_resolved_row` per row, injects `boq=boq_name`. `master_preamble` (treat_as="master_preamble") sheets produce no rows. Returns `list[dict]`.

- `run_parse(boq_name, sheet_names=None, force_reparse=False)` -- `@frappe.whitelist(methods=["POST"])`. Enqueues `_run_parse_worker` on `queue="long"`, `timeout=600`. `sheet_names=None` parses all eligible Reviewed/Parsed sheets; `sheet_names=[...]` parses only the named subset (per-sheet re-parse). `force_reparse` (HTTP string `"true"/"1"/"yes"` coerced to bool; default False) is threaded to `_run_parse_worker` -> `assemble_mapping_config` and makes `"Parsed Check Done"` sheets eligible (Force Re-parse backend slice -- see `assemble_mapping_config` above); the frontend sets it only for a deliberate, warned re-parse (a later frontend slice wires the button). After successful enqueue sets `BOQs.parse_in_progress=1` + commits (Bucket-2 Slice 1, feat cb86b92b). Returns `{"status":"queued","job_id":...}`. URL: `/api/method/nirmaan_stack.api.boq.wizard.parse_run.run_parse`

- `_run_parse_worker(boq_name, sheet_names=None, user=None)` -- background worker. Fetches workbook from S3 or local (derives real `.xlsm`/`.xlsx` extension from URL). Calls `assemble_mapping_config` -> `parse_boq` -> per-sheet delete-then-insert loop (applying `_LIST_JSON_FIELDS` pre-serialization). Per-sheet failure: compensating delete + set `Parse failed` + continue. Global `parse_boq` failure: all eligible sheets -> `Parse failed` + error event. Stamps `BOQs.parsed_at` on any success. **TWO READ-SITES for general-specs (Slice 2c):** Read-site 1 in `assemble_mapping_config` (routing); Read-site 2 in `_run_parse_worker` Step 5 (gates "mark Parsed" -- general-specs sheets never receive "Parsed" status). Step 6 write-loop: for each (sheet_name, preamble_text) in `parsed.master_preambles`, delete-then-insert child row (replace semantics, falsy-skip per row). Commits BEFORE publishing `boq:parse_run_done` (targeted to `user=`). Does NOT touch `BOQs.wizard_state`.

**`_LIST_JSON_FIELDS` module constant** -- `frozenset` of the 4 list-type JSON fields that must be pre-serialized via `json.dumps()` before `doc.insert()`: `attached_notes`, `validation_warnings`, `classifier_warnings`, `preamble_candidate_signals`. Authoritative source for `_run_parse_worker` and `test_parse_run._insert_rows`. `edit_log` (Slice A) is the 5th list-JSON field on BoQ Review Row but is NOT in `_LIST_JSON_FIELDS` (that constant is parse-worker scope only); `edit_log` is handled by `save_review_edit` directly. Do NOT add dict-type fields here.

**`boq:parse_run_done` realtime event** -- `user=`-targeted (unlike `boq:wizard_parse_done` which broadcasts). Success payload: `{status,boq_name,parsed_sheets,not_parsed_sheets,failed_sheets}`. Error payload: `{status,boq_name,error_code}`. Error codes: `missing_file`, `fetch_failed`, `no_eligible_sheets`, `parse_failed`, `internal`. **Payload contract is frozen** -- `_publish_parse_event` clears `parse_in_progress=0` before publishing (Bucket-2 Slice 1) but does NOT change any payload key or error code.

**`general_specs_sheets` empty guard (Slice 2c)** -- `assemble_mapping_config` builds `general_specs_sheet_names: set[str]` from child rows (`row.source_sheet_name for row in boq_doc.general_specs_sheets or []`). An empty child table produces an empty set; set membership check `sheet_name in general_specs_sheet_names` is safely False. `ParsedBoq.master_preambles: dict[str,str]` -- replaces `master_preamble: str|None`. Empty dict = no general-specs sheets parsed this run (does not blank existing child rows -- falsy-skip per row is preserved).

**`commit_gate.py`** (Phase 5 Slice 2, feat b93ec41c) -- the READ-ONLY commit-eligibility gate. SEPARATE from parse-eligibility (does NOT import/reuse/consult `assemble_mapping_config` / `force_reparse` -- the parser treats "Finalized" as not_eligible by default; the commit gate is the opposite, Finalized is exactly what commits). 2 functions:

- `compute_committable_sheets(sheet_drafts, general_specs_sheet_names)` -- PURE helper (no DB; accepts Frappe child docs / `frappe._dict` / plain dicts via a `_get` shim; preserves input order). Returns `list[dict]` of `{"sheet_name", "disposition"}`. RULE: general-specs-designated (membership in `general_specs_sheet_names`) -> disposition `"general_specs"`; else `wizard_status == "Finalized"` -> `"finalized"`; else NOT eligible (blank / Pending / Hidden / Config Done / Skip / Parse failed / Parsed). PRECEDENCE: general-specs outranks Finalized on overlap (mirrors `assemble_mapping_config` Rule 1). The disposition tells the Slice-3 pipeline which write path to use.

- `get_committable_sheets(boq_name)` -- `@frappe.whitelist()` bare (READ-ONLY). Loads `BOQs.sheet_drafts` + the `BOQs.general_specs_sheets` pointer (general-specs = POINTER membership on `source_sheet_name`, NOT `wizard_status == "General specs"` which is never literally stored), applies the pure helper. Returns `{"committable_sheets": [{"sheet_name", "disposition"}, ...]}`. Missing/unknown BoQ -> `frappe.throw`. URL: `/api/method/nirmaan_stack.api.boq.wizard.commit_gate.get_committable_sheets`

- `get_committed_state(boq_name)` -- (Phase 5 Slice 4a, feat 964e14d0) `@frappe.whitelist()` bare (READ-ONLY). The per-sheet CURRENT committed-state read for the Slice-4b hub UI (committed badge + timestamp, "Committed: N" footer count, last-committed date/time in the commit modal). Sourced from the **`BoQ Committed Sheet Grid`** tier -- the authoritative `committed_at` source (written for BOTH dispositions, anchors the shared `commit_version`, one `is_current=1` row per (boq, source_sheet_name) by the pipeline's freeze-and-supersede invariant). Same missing/unknown-BoQ guard as `get_committable_sheets` (`frappe.throw` "boq_name is required." / "BOQs '...' not found."). Queries `frappe.get_all("BoQ Committed Sheet Grid", filters={"boq", "is_current": 1}, fields=["source_sheet_name", "committed_at", "commit_version"])` and maps each current row to `{"sheet_name": <source_sheet_name VERBATIM #152>, "committed_at": <Datetime|None>, "commit_version": int}`. Returns `{"committed_state": [...]}`; empty when nothing committed. SEPARATE from `get_committable_sheets` (eligibility) -- the modal needs BOTH (eligibility + committed-state). PURE read (no set_value/insert/save/commit). No dedup logic (the one-current invariant is pipeline-enforced). `test_commit_gate` 13 -> 18 (+5: current state, superseded-excluded, verbatim trailing space, empty case, unknown-BoQ throws). URL: `/api/method/nirmaan_stack.api.boq.wizard.commit_gate.get_committed_state`. **CONSUMED by the frontend (Phase 5 Slice 4b, feat 53645ab7):** the BoQ hub now wires the commit UI onto this read + the existing `commit_boq` -- a "Commit" footer button -> a checklist modal (`CommitDialog.tsx`) of `get_committable_sheets` rows that fires `commit_boq` (POST, `sheet_subset`=ordered ticked list) with a one-step re-commit warning (naming already-committed sheets + their last-committed date/time from this endpoint), a per-card "Committed" badge + timestamp, and a hub "Committed: N" tally. Frontend-only; committed-ness stays a separate marker, NOT a `wizard_status`. Full detail in frontend/CLAUDE.md + boq-upload-plan.md "Phase 5 Slice 4b".

**`commit_pipeline.py`** (Phase 5 Slice 3a, feat pending) -- the combined commit shell + grid write-body. The FIRST writer of REAL parsed BoQ data into the committed schema. Single public endpoint:

- `commit_boq(boq_name, sheet_subset)` -- `@frappe.whitelist(methods=["POST"])`. Commits a subset of a BoQ's sheets. SERVER-SIDE GATE RE-CHECK: every sheet in `sheet_subset` MUST be in the LIVE `compute_committable_sheets` set (same general-specs pointer read the gate uses) or the whole call throws BEFORE any file fetch / write -- the caller's subset is never trusted. `sheet_subset` accepts a JSON-string list or a Python list; empty/missing throws. SINGLE-OPEN: one `_fetch_boq_file_to_tempfile` + one `openpyxl.load_workbook`, then loop the sheets, each grid built by the SHARED `sheet_preview._extract_grid_rows(ws)` inside the one open workbook (no per-sheet re-open, no whitelisted-endpoint loop). **PER-SHEET FAILURE ISOLATION (Phase 5 Slice 5, feat 09714041):** the per-sheet loop wraps each sheet in `try/except` -- catch-rollback-continue-and-report (was propagate-and-abort). On a sheet failure it calls **`frappe.db.rollback()` (MANDATORY -- catching the exception SUPPRESSES Frappe's request-level rollback, so without it the failed sheet's freeze-before-write [prior `is_current` set to 0] + partial new writes stay pending and the NEXT sheet's `frappe.db.commit()` FLUSHES them, ORPHANING the sheet -- prior frozen, new incomplete, NO `is_current=1` version; a test proves T2 FAILS if the rollback line is removed)**, records `{sheet_name, reason}` in a new `failed[]` (`reason` via `_commit_failure_reason(e)` -- best-effort HTML-stripped message + safe fallback, never empty), `frappe.log_error`s the traceback, and continues. **DURABLE PERSISTENCE (Slice F1, feat 5c095b34):** immediately AFTER that mandatory `frappe.db.rollback()` the except calls `_record_commit_failure(boq, sheet, reason)` (`set_value` `commit_failure_reason`/`commit_failure_at` on the draft, `update_modified=False`) THEN an explicit `frappe.db.commit()` -- the rollback-then-write-then-commit ORDER is load-bearing: the write is AFTER the rollback so it survives it, the explicit commit is REQUIRED because `commit_boq` has NO trailing commit (a LAST-sheet failure would otherwise be lost), and the draft is a DIFFERENT doctype from the rolled-back tiers so the stamp cannot re-flush a rolled-back tier write (T2 orphan-prevention preserved). The success path's `_commit_one_sheet` CLEARS the stamp via `_clear_commit_failure` folded into its trailing commit. **MIXED STATE is a valid outcome** (some committed + some failed); NO all-or-nothing wrapper; earlier committed sheets are durable (commit-per-sheet boundary UNCHANGED). The sheet-not-in-workbook check is now INSIDE the per-sheet try (a genuinely-absent eligible sheet -> `failed[]`, loop continues); the UPFRONT gate re-check STAYS a whole-call throw (eligibility is a precondition, not a runtime failure). Returns `{"boq_name", "committed": [{sheet_name, disposition, sheet_disposition, grid_name, boq_sheet_name, commit_version, row_count, froze_prior, froze_prior_sheet, node_count, froze_nodes}, ...], "failed": [{sheet_name, reason}, ...]}` (`failed` is `[]` on full success -- the key is always present). URL: `/api/method/nirmaan_stack.api.boq.wizard.commit_pipeline.commit_boq`. **CONSUMED by the frontend (Phase 5 Slice 5 frontend, feat ab4a390b):** after `commit_boq` resolves, the hub surfaces the `{committed, failed}` envelope in an acknowledge-only `CommitResultsModal` (mirrors the parse-completion modal -- single OK) enumerating the committed sheets (with version) and the failed sheets (with reason); mixed outcomes are normal. `CommitDialog` hands the envelope up via `onCommitted(result)`; the hub stores it, fires the Slice-4b mutates, and opens the modal. Frontend detail in frontend/CLAUDE.md + boq-upload-plan.md "Phase 5 Slice 5 (frontend)".
- Internal write-body (`_commit_one_sheet` -> `_write_grid` + `_write_committed_boq_sheet` + `_commit_node_tree`): PER-SHEET transaction (one trailing `frappe.db.commit()` per sheet, NO savepoints -- the app-wide pattern). ONE SHARED `commit_version` per (boq, sheet) = `_next_commit_version` (grid max+1) covers grid+sheet+nodes. `_write_grid` -- VERBATIM (#152) `source_sheet_name`; `is_current=1`; `committed_at`; prior current frozen -> 0 via `_current_names` + `set_value`. `_write_committed_boq_sheet` (Slice 3b -- FREEZE-AND-SUPERSEDE, 3a's raw-delete RETIRED) -- freezes the prior current BoQ Sheet via `frappe.db.set_value(is_current=0)` (NOT doc.save() -- the list-valued `area_dimensions` would re-serialize and hit get_valid_dict; see gotcha) then INSERTS a fresh current under the shared version; COLUMN-CONFIG SNAPSHOT from the draft's `sheet_config` (`column_role_map`/`column_headers`/`area_dimensions` json.dumps'd, + `header_row`/`header_row_count`/`treat_as`); `sheet_order`/`sheet_label`/`work_packages` carried; `treat_as` = master_preamble (general_specs) / data (finalized); returns (new_name, prior_current_names). `_commit_node_tree` (Slice 3b, FINALIZED only) -- freezes prior nodes (attached to the frozen prior sheet[s], `set_value` is_current=0), reads review rows + `resolve_effective`, maps preamble/line_item -> nodes (the other 4 classifications grid-only), TWO-PASS write (pass1 insert parent-less with list-JSON fields NULL; pass2 set parent_node + doc.save() in ancestor-depth order; pass3 set_value the list-JSON fields attached_notes/edit_log), per-area child explosion via `_explode_area_children` (dual-shape, never downgrade). Returns {node_count, froze_nodes}. **LEVEL-LESS PREAMBLE GUARD (post-dogfood fix):** a real >=1 level (override or parser) is used unchanged; a level-less preamble (no override, no >=1 level) gets a level computed ONCE per sheet by `_compute_levelless_preamble_levels` -- WITH children -> `max(0, min(child effective-level) - 1)` (shallowest child wins; line-item children = level 0); CHILDLESS -> the sheet's shallowest DEFINED preamble level, else 0. (`_real_preamble_level(d)` is the shared level-less test.) The old flat default of 1 broke trees where a child was also level 1; the controller constraint relaxed >=1 -> >=0 to allow level 0.
- DISPOSITION MAPPING (ties to the gate, NOT re-derived): `_DISPOSITION_TO_SHEET_DISPOSITION` general_specs->grid_only, finalized->grid_and_nodes; `_DISPOSITION_TO_TREAT_AS` general_specs->master_preamble, finalized->data.
- **`_current_names(doctype, boq, name_field, value)` (Slice 3b)** -- the ONE centralized is-current accessor across all three committed tiers (grid:`source_sheet_name`, BoQ Sheet:`sheet_name`, BOQ Nodes:`sheet`); returns is_current=1 row names (value VERBATIM #152). One helper, three callers.
- **`_explode_area_children(qty_ba, rate_ba, amount_ba)` (Slice 3b) -- DUAL-SHAPE, NEVER DOWNGRADE (owner-locked):** qty_by_area always flat {area:float}->child.qty (defaults 0.0 when an area is absent from qty but present in rate/amount -- child.qty is reqd=1); rate_by_area NESTED {supply_rate,install_rate,combined_rate}->each on its own child column, FLAT scalar->combined_rate ONLY; amount_by_area NESTED {supply,install,total}->supply_amount/install_amount/total_amount each, FLAT scalar->total_amount ONLY. area_name = dict key verbatim. The real corpus is FLAT; the current parser emits NESTED -- both handled (recon's nested-only assumption was wrong).
- **`_reconcile_node_tree(...)` + `_reconcile_grid(...)` (Slice 2, feat 01c7dbaf) -- OUTPUT-FIDELITY commit round-trip check.** Run on every per-sheet commit (node-tier INLINE at `_commit_node_tree` tail; grid-tier from `_commit_one_sheet`) BEFORE the per-sheet `frappe.db.commit()`. Verify ONLY that the value each transform PRODUCED was COPIED to the DB faithfully -- NOT logic-correctness (validity/coherence = tendering, OUT OF SCOPE). COPIED fields: `stored == transform(review-row source)` (reusing the in-hand `node_rows`, no re-query). DERIVED (exactly two): `parent_node == name_by_idx.get(eff_parent_by_idx.get(idx))` (captured eff-parent map, NOT re-running resolve_effective) and `level == docs_by_idx[idx].level` (captured in-memory doc; a thin tripwire). Numerics rounded to `frappe.get_precision` (money 2dp / qty 3dp). On divergence `frappe.throw` -> commit_boq's Slice-5 per-sheet isolation routes it to `failed[]` (rollback + reason), isolation boundary UNCHANGED. Suppress-set encoded (blank-qty=0, placeholder desc, flat-stays-flat, gen-specs 0 nodes, minted id + versioning + path + boq excluded, note/Other money-null, -1 sentinel, bool coercion). Helper trio `_text_eq`/`_json_eq`/`_node_type_for` + the `_NODE_MONEY_SOURCE` word-reversal map support the compare.

**Shared single-open helper `sheet_preview._extract_grid_rows(ws, min_row=1, max_row=None)`** (Slice 3a) -- the ONE worksheet->rows transform (`{row_number, cells:{col_letter:value}}`, EmptyCell skip logic, `_to_json_serializable` values). Extracted from the previously-welded/duplicated loop in `get_sheet_preview` + `get_sheet_preview_full`; BOTH now call it (byte-identity test green -> behavior-preserving), AND `commit_pipeline` calls it so the previewed grid and the committed grid can never silently diverge. `max_row=None` -> whole sheet.

**GOTCHA -- list-valued JSON field + doc.save()/delete_doc (Slice 3a pin; amended 3b):** a JSON field holding a Python LIST (e.g. `BoQ Sheet.area_dimensions`, or BOQ Nodes' `attached_notes`/`edit_log`) can be INSERTED via `json.dumps()` (string passes `get_valid_dict`) but Frappe parses it back to a list on load, so any later `doc.save()` OR `delete_doc` (whose as_json archive calls `get_valid_dict`) THROWS "cannot be a list". MITIGATIONS in use: (1) to FREEZE/flip a field on an existing such doc, use `frappe.db.set_value(...)` (targeted column write, bypasses full-doc serialization) -- this is how 3b freezes the prior BoQ Sheet's `is_current` (the 3a raw-`delete` of the BoQ Sheet is RETIRED -- the sheet is now VERSIONED/frozen, not deleted); (2) to WRITE a list-JSON field while still needing a later `doc.save()`, defer the list field to a post-save `set_value(json.dumps(...))` and keep it NULL across the save (3b's node two-pass leaves attached_notes/edit_log null through pass-2 save, writes them in pass 3). Reads must tolerate the parsed form (`frappe.parse_json(v) if isinstance(v, str) else v`). Dict-valued JSON (e.g. `append_notes_raw`, grid `cells`) is fine -- only LISTs trip the wall.

**New top-level doctype: BoQ Review Row** (Phase-1 Slice 1):
- Path: `nirmaan_stack/nirmaan_stack/doctype/boq_review_row/`. Autoname `BOQRR-.YY.-.#####`. `track_changes=1`.
- Role: transient per-row store for one parse-run's output. One row per resolved parser row per parse pass. NOT the committed output (that goes to BOQ Nodes in a later phase); meant for human review + approval before rows become canonical.
- Links section: `boq` (Link->BOQs, reqd, indexed), `sheet_name` (Data, reqd).
- Position section: `source_row_number`, `row_index`, `level`, `parent_index`, `attached_to_index` (Int); `classification`, `path` (Data, read-only+indexed).
- Classifier metadata: `promoted_from_line_item` / `needs_classification_review` (Check); `preamble_level_override` / `preamble_candidate_score` (Int); `review_reason` (Data); `preamble_candidate_signals` (JSON list).
- Content: `sl_no_value` / `unit` / `make_model` (Data); `description` (Text, global search); `is_rate_only` / `is_synthetic` (Check).
- Quantities/Rates/Amounts: `qty_total` / `rate_supply` / `rate_install` / `rate_combined` / `amount_total` / `amount_supply` / `amount_install` (Float).
- JSON dict fields (pass as Python dicts): `qty_by_area`, `amount_by_area`, `rate_by_area`, `append_notes_raw`.
- JSON list fields (must pre-serialize via `json.dumps()` before insert): `attached_notes`, `validation_warnings`, `classifier_warnings`, `preamble_candidate_signals`, `edit_log` (Slice A addition).
- Notes section: `row_notes` (Text).
- Object-per-flag distinction: `needs_classification_review` + `review_reason` are ResolvedRow-level flags (set by hierarchy post-pass); `classifier_warnings` + `preamble_candidate_*` are ClassifiedRow-level signals (set during classification). Do NOT conflate them.
- Review edits (human layer, Slice A): `human_classification` (Data), `human_parent` (Int), `edit_log` (JSON list), `edited_by` (Data), `edited_at` (Datetime). `has_human_parent` DOES NOT EXIST (was retired in feat fff26abd -- see -1 sentinel below). `remarks` (Small Text, Slice C-v2c) also lives in this section but is NOT an edit field -- it is human-only annotation written ONLY by `save_review_remark`, never stamps edited_at/edit_log, and a remark-only row stays "Original". `flags_dismissed` (Check, default 0), `flags_dismissed_by` (Data, read-only), `flags_dismissed_at` (Datetime, read-only) (C-flag-dismissal) also live here but are NOT edit fields -- the per-row "Looks OK" acknowledgment, written ONLY by `dismiss_row_flags` (mirrors the remark bypass), cleared on any edit at the `_apply_and_save_row_edit` chokepoint, and a dismissed-only row stays "Original".
- **-1 sentinel convention (parent_index + human_parent):** Frappe coerces Int None->0 on insert and 0 is a valid row index, so None is unusable as a "no parent/no override" sentinel at the DB boundary. FIX: -1 is the sentinel. `flatten_resolved_row` writes -1 for root rows (None->-1). `save_review_edit` writes -1 when human_parent is cleared. `resolve_effective` translates both -1 AND None to Python None before computing effective values (`in (None, -1)` check), so all downstream tree/cycle/orphan logic (which uses None for root) is unchanged. `human_parent >= 0` (including 0) is a real human override. The Check field `has_human_parent` was redundant once -1 is the sentinel and has been removed from the schema.
- **wizard_status 9 values on BoQ Sheet Draft (renamed Slice A1):** blank / Pending / Hidden / **Config Done** (was "Reviewed") / Skip / General specs (derived, never stored) / Parse failed / Parsed / **Finalized** (was "Parsed Check Done"). `mark_sheet_parsed_check_done` writes "Finalized" directly (bypasses `set_sheet_status` which rejects it). The endpoint FUNCTION names (`mark_sheet_parsed_check_done` / `unmark_sheet_parsed_check_done`) are UNCHANGED -- only the status strings moved.

**`review_screen.py`** (Slice A, feat fff26abd) -- helpers + 3 endpoints in `nirmaan_stack/api/boq/wizard/review_screen.py`:

- `resolve_effective(row)` -- accepts Frappe Document / frappe._dict / plain dict. Computes effective_classification (human > parser) and effective_parent_index (-1/None sentinel translation; human_parent >= 0 is a real override). Returns dict with raw stored values + effective values. has_human_parent NOT included (retired). Authoritative source for the -1 sentinel.
- `check_structural_integrity(rows)` -- operates on EFFECTIVE values from resolve_effective. Three checks: ORPHAN (line_item with effective_parent=None), LINE_ITEM_AS_PARENT, CYCLE. Returns list of break dicts (empty = clean). Does NOT modify input rows.
- `append_edit_log_entry(existing_log, field, from_val, to_val, user, reason=None, area=None, rate_subkey=None)` -- appends `{field,from,to,by,at,reason[,area][,rate_subkey]}` to the log list. `reason` (Slice C-v1, trailing optional) is always present for a uniform shape; value None when not supplied. `area`/`rate_subkey` (Slice C-v2d, trailing optional) are added to the entry ONLY when not None -- flat-field entries omit them entirely, so old entries stay valid (no composite field string). Handles list/JSON-string/None input. Returns new list (does not mutate input). Caller must json.dumps() before save.
- `get_review_rows(boq_name, sheet_name)` -- `@frappe.whitelist()` bare (GET-capable). Returns `{rows: [...with effective values...], work_packages: [...], column_descriptors: [...]}`. JSON list/dict fields returned as parsed Python objects. `column_descriptors` (Slice B1.1a, feat 58d2ed44): one entry per mapped display column compiled from `sheet_config.column_role_map`; each entry: `{col, role, area, value_field, value_key, rate_subkey}`. Non-display roles `{ignore, reference_images}` excluded (append-to-notes-as-columns slice: `append_to_notes` is NO LONGER excluded -- it now emits one descriptor per append-column with `value_field="append_notes_raw"`, `value_key=sheet_config.column_headers.get(col, col)` [header-else-letter, matching the parser-stored key], `area=None`, `rate_subkey=None`). Absent/empty sheet_config -> `[]`. Sorted by Excel column order (len, lexical). URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.get_review_rows`
- `save_review_edit(boq_name, sheet_name, row_index, field, value, reason=None, area=None, rate_subkey=None)` -- `@frappe.whitelist(methods=["POST"])`. FLAT-field path (area is None): editable fields human_classification, human_parent, qty_total, rate_supply, rate_install, rate_combined, amount_total, amount_supply, amount_install (numeric, float-coerced), and unit, make_model (text, stored verbatim -- Slice C-v2b); three apply-branches: _HUMAN_FIELDS (setattr / -1 clear), _TEXT_FIELDS (setattr string, NO float coercion; blank clears to None), else numeric float() path; description and row_notes are NOT editable. Cycle-guard + self-parent guard for human_parent. **PER-AREA path (Slice C-v2d -- when `area` is supplied):** `field` is one of qty_by_area / amount_by_area / rate_by_area (the `_AREA_JSON_FIELDS` set, gated SEPARATELY from `_ALLOWED_EDIT_FIELDS`); `area` names the cell; **the NESTED two-hop fields `_NESTED_AREA_FIELDS = {rate_by_area, amount_by_area}` (amount joined in Slice 2b) each require `rate_subkey`** validated against the PER-FIELD legal set via `_NESTED_FIELD_LEGAL_SUBKEYS` (rate_by_area -> `_LEGAL_RATE_SUBKEYS` = supply_rate/install_rate/combined_rate; amount_by_area -> `_LEGAL_AMOUNT_SUBKEYS` = supply/install/total; both `frozenset(_RATE_ROLE_TO_KIND.values())` / `frozenset(_AMOUNT_ROLE_TO_KIND.values())`, reused from the parser, not copied). `qty_by_area` is the only FLAT one-hop field (`_FLAT_AREA_FIELDS = {qty_by_area}`). **Slice 2b naming debt:** the wire/edit-log key is `rate_subkey` for BOTH nested fields -- for amount it carries the amount kind (accepted Phase-4 misnomer, not renamed). The two-hop write sets ONE inner kind and leaves the area's other kinds + the other areas intact (the B2 anti-corruption guarantee). **C4 (owner-locked):** a per-area edit does NOT recompute the row scalar amount_total -- it stays as parsed (the 2a derivation rule runs at PARSE time only; the future tendering module owns calculations). **GUARD (Slice C-v2d-fix):** the sent `area` is validated against the SHEET'S defined areas (`sheet_config.area_dimensions` via new helper `_get_sheet_area_dimensions(boq_name, sheet_name)`, sheet_name VERBATIM), NOT this row's existing dict keys -- a defined-but-empty area is a valid value-edit target, so the dict key is CREATED if absent (flat `dict[area]=v` / nested `dict[area][rate_subkey]=v`, from=None for a newly-created key); an UNDEFINED area -> throw "not a defined area for this sheet", a sheet with no area_dimensions -> throw "no defined areas" (fail loudly, no permissive fallback). Read-modify-write: blank value -> 0.0 with the key KEPT (never deleted); whole dict BARE-assigned back (NO json.dumps -- proven round-trip). A per-area edit IS a real data edit: stamps edited_by/edited_at, appends a STRUCTURED edit_log entry carrying area (+ rate_subkey). Validation rejects undefined-area / no-area-dimensions / missing-rate_subkey / illegal-rate_subkey / non-per-area-field-with-area. Both paths: appends to edit_log, pre-serializes _RESAVE_LIST_JSON_FIELDS before doc.save() (Defect-1 fix -- the reason the per-area write EXTENDS this endpoint rather than adding a new path). `reason` (Slice C-v1, blank->None) stored on the entry. Returns `{ok, row_index, field, from, to, edited_at, effective, area, rate_subkey}` (area/rate_subkey None on the flat path; edited_at added Slice C-v1). URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.save_review_edit`
- `save_review_remark(boq_name, sheet_name, row_index, remark)` -- `@frappe.whitelist(methods=["POST"])` (Slice C-v2c). The SEPARATE remark write path: writes ONLY the `remarks` field (Small Text) via `frappe.db.set_value` (NOT `doc.save`), so it NEVER stamps `edited_at`, NEVER appends `edit_log`, and NEVER calls append_edit_log_entry -- a row carrying only a remark stays "Original" (the frontend's edited provenance keys off edited_at / edit_log). A remark is annotation, not a data edit; there is NO remark history (latest wins). Blank/whitespace-only normalizes to None (clears). 250-char hard guard (`_REMARK_MAX_LEN=250` -- was 500, lowered in Slice C-v2c-polish; `frappe.throw` if exceeded) so the cap holds even if the frontend is bypassed. `sheet_name` matched VERBATIM (#152). Returns `{ok, row_index, remarks}`. `remarks` is also added to the `get_review_rows` all_fields list so it rides the per-row payload (read path). URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.save_review_remark`
- `dismiss_row_flags(boq_name, sheet_name, row_index, dismissed)` -- `@frappe.whitelist(methods=["POST"])` (C-flag-dismissal). The per-row "Looks OK" dismissal write path. MIRRORS `save_review_remark`: writes ONLY `flags_dismissed` / `flags_dismissed_by` / `flags_dismissed_at` via `frappe.db.set_value` (NOT `doc.save`, NOT the `_apply_and_save_row_edit` chokepoint), so it NEVER stamps `edited_at`, NEVER appends `edit_log`, NEVER touches `human_*` -- a row that is only dismissed stays "Original" (frontend provenance keys off edited_at / edit_log). `dismissed` truthy (HTTP `"1"/"true"/"yes"` coerced) -> `flags_dismissed=1` + by=`frappe.session.user` + at=`frappe.utils.now()`; falsy -> all three cleared (supports a future un-dismiss + the edit-reopen symmetry, though no UI un-dismiss ships). A dismissal is an ACKNOWLEDGMENT, not a data edit; it does NOT touch `_compute_advisory_flags` (flags stay computed-fresh -- orthogonal). `sheet_name` matched VERBATIM (#152). Returns `{flags_dismissed: 0|1}`. The 3 fields are also added to `get_review_rows` all_fields (read path). **EDIT RE-OPENS (decision 3a):** any data edit clears the dismissal at the `_apply_and_save_row_edit` chokepoint (ONE insertion: `doc.flags_dismissed=0` + by/at=None alongside the provenance stamp), covering BOTH save_review_edit AND save_review_restructure. A REMARK does NOT re-open (save_review_remark bypasses the chokepoint -- intentional). Re-parse wipes it free (delete+recreate -> the Check defaults 0; NO parse-worker change). URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.dismiss_row_flags`
- `mark_sheet_parsed_check_done(boq_name, sheet_name, confirm=False)` -- `@frappe.whitelist(methods=["POST"])`. Step 1: run check_structural_integrity. Step 2a: breaks exist + confirm=False -> return `{ok:False, breaks:[...]}` (warn-and-confirm gate). Step 2b: clean or confirm=True -> set wizard_status="Parsed Check Done" directly (bypasses set_sheet_status). Returns `{ok, status, overridden}`. **PRECONDITION (Slice D1):** after locating the child row + BEFORE the integrity compute, reads `wizard_status`: already "Parsed Check Done" -> throw "already marked"; not "Parsed" -> throw "Only a sheet with status 'Parsed' can be marked ... Current status: {status}." (the endpoint had NO status check before D1 -- it stamped unconditionally). Response shapes unchanged. URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.mark_sheet_parsed_check_done`
- `unmark_sheet_parsed_check_done(boq_name, sheet_name)` -- `@frappe.whitelist(methods=["POST"])` (Slice D1). The inverse of mark: reverts a checked sheet to "Parsed", lifting the read-only freeze. Precondition: current status == "Parsed Check Done" else throw ("Only a sheet marked 'Parsed Check Done' can be un-marked. Current status: {status}."). No integrity check (going backward is always allowed). Writes `set_value(... "Parsed")` + commit directly -- deliberately bypasses `set_sheet_status`, which rejects "Parsed" (`_DIRECT_SET_STATUSES` excludes it). Returns `{ok: True, status: "Parsed"}`. URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.unmark_sheet_parsed_check_done`
- **Read-only freeze (Slice D1) -- `_get_sheet_wizard_status(boq_name, sheet_name)` + `_guard_sheet_not_frozen(boq_name, sheet_name)`:** module-level helpers. `_get_sheet_wizard_status` returns the BoQ Sheet Draft `wizard_status` via one `frappe.db.get_value` (same parent/parenttype/sheet_name filter mark uses; sheet_name VERBATIM #152). `_guard_sheet_not_frozen` throws the single `_FROZEN_WRITE_MESSAGE` ("This sheet is marked 'Parsed Check Done' and is read-only. Un-mark it to make changes.") iff the status is "Parsed Check Done". The guard is called in EACH of the four write endpoints (`save_review_edit`, `save_review_restructure`, `save_review_remark`, `dismiss_row_flags`) immediately AFTER the BOQs-exists guard and BEFORE any doc-locate / validation / write -- so a frozen sheet short-circuits before any work (in `save_review_edit` this precedes the expensive whole-sheet cycle-guard). PURELY ADDITIVE: a sheet NOT at "Parsed Check Done" passes through byte-for-byte unchanged (backwards-compat). The FRONTEND `readOnly` gating is the first line of defence; this guard is the durable backstop.
- `get_structural_breaks(boq_name, sheet_name)` -- `@frappe.whitelist()` bare (GET-capable, Slice B1, feat 0683f7b9). Read-only: fetches minimal row fields + calls `check_structural_integrity`. Returns `{"breaks": [...]}`. Does NOT write, does NOT change `wizard_status`. Dedicated display contract for the review screen (B2 flag overlay). URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.get_structural_breaks`
- `_apply_and_save_row_edit(doc, boq_name, sheet_name, field, value, area=None, rate_subkey=None, reason=None, user=None, set_root=False)` -- (Slice 1b-alpha, feat f7761415) MODULE-LEVEL shared write helper extracted from `save_review_edit`. Applies one field-change to an ALREADY-LOADED BoQ Review Row doc + appends the edit_log entry + stamps provenance + re-serializes the list-JSON siblings + `doc.save()` -- but DOES NOT commit. **Save-inside / commit-outside is the atomicity boundary:** under one request transaction N per-row saves all roll back if a later row throws, and the caller's single trailing `frappe.db.commit()` makes a batch all-or-nothing. Callers own ALL per-call validation (the human_classification assignable check, the human_parent self-parent/target-exists/cycle-guard -- the cycle-guard is whole-sheet/whole-batch and CANNOT be per-row), the doc LOAD, and the commit. `save_review_edit` now calls this (its observable behaviour is unchanged except the assignable narrowing below). **`set_root` kwarg (human-root chokepoint):** for `field="human_parent"`, set_root=True writes the human-root override (`human_is_root=1` AND `human_parent=-1`, case c); else value>=0 -> `human_parent=value` + `human_is_root=0` (case a), value None -> `human_parent=-1` + `human_is_root=0` (case b). This is the SINGLE place the consistency invariant (root XOR row-override -- they can never coexist) is enforced.
- `save_review_restructure(boq_name, sheet_name, row_index, new_classification, child_moves=None, reason=None, row_new_parent=None)` -- (Slice 1b-alpha, feat f7761415; `row_new_parent` added Slice 1b-beta2, feat 1ed9d3b7) `@frappe.whitelist(methods=["POST"])`. ATOMIC reclassify-one-row + reparent-its-children (+ optionally the row ITSELF) in ONE commit (the restructure backend for the 1b-beta/1b-beta2 modal). **Path A:** the caller sends a FULLY-RESOLVED plan; the backend VALIDATES + WRITES, it does NOT compute placement. `child_moves` is a dict (or JSON string of a dict) `{child_row_index: new_parent_index}`; `-1` = move to top-level/root. **`row_new_parent` (1b-beta2, OPTIONAL):** None/omitted = the reclassified ROW's own parent is left untouched (byte-for-byte the pre-1b-beta2 behaviour for every existing caller); `-1` = move the row to top-level/root; an int = move it under that row. Validation (all per-call, BEFORE any write): required args; BOQ exists; row exists; `new_classification` in the ASSIGNABLE set (line_item/preamble/note/spacer -- subtotal_marker/header_repeat rejected as TARGETS, the FROM-but-not-TO rule); each child exists, its CURRENT effective parent IS row_index (cannot move a non-child), proposed parent is -1 or an existing row, not self-parented; `row_new_parent` (when not None) int-coerced, not self-parented (!= row_index), and != -1 must exist (mirrors the child / save_review_edit checks); **BATCH cycle-guard** -- build the whole-sheet effective-parent map, apply ALL moves AT ONCE **including the row's own move into the SAME `sim` map** (1b-beta2), then `_chain_has_cycle` per touched row against the COMBINED tree, where touched = the child-move keys PLUS `row_index` when `row_new_parent` is given (two individually-acyclic moves can form a cycle together; AND a pure row move with empty child_moves would run ZERO checks unless row_index is a check START-POINT -- THE silent-corruption trap this closes). `_chain_has_cycle` is UNCHANGED (the walk is general). Write: reclassify the target via the helper (one human_classification entry, carrying `reason`); **when `row_new_parent` is not None, ONE more helper call on the SAME `target_doc`** setting human_parent (`reason` = "row moved: row {N} reclassified to {cls}"; `-1` -> `set_root=True`, edit_log `to=None`; int -> human_parent=that row; two sequential helper calls on one in-memory doc are safe -- one commit covers both, a mid-block throw rolls back everything); each child via the helper (one human_parent entry, `reason` = "parent moved: row {N} reclassified to {cls}"; `-1` -> `set_root=True`, edit_log `to=None`); single `frappe.db.commit()` at the end. Returns `{ok, row_index, new_classification, children_moved, edited_at, row_moved}` (`row_moved` true iff `row_new_parent` was applied). **NOTE (test T7):** a literal "individually-acyclic joint-only" row+child cycle is mathematically IMPOSSIBLE here -- every child currently has effective parent == row_index, so reverting a child edge restores child->row and the row-move alone is already cyclic; the shared-sim guard is instead proven by a cycle-via-the-row paired with an innocent acyclic child move. URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.save_review_restructure`

**Classification target vocab (Slice 1b-alpha):** `_VALID_CLASSIFICATIONS` (all 6 RowClassification literals) remains the FROM/read vocab. `_ASSIGNABLE_CLASSIFICATIONS` (line_item, preamble, note, spacer) is the STRICT SUBSET valid as a write TARGET. `subtotal_marker` and `header_repeat` are parser-only DETECTIONS -- valid existing/FROM states but never assignable. Applied to BOTH `save_review_restructure` and `save_review_edit`'s human_classification path.

**`human_is_root` (Slice 1b-alpha, BoQ Review Row Check field, default 0):** the human-root encoding (Option B). A SEPARATE Check field ORTHOGONAL to `human_parent` -- the -1 sentinel value space (#54: -1/None = no override, >=0 = override-to-row) is UNCHANGED. `resolve_effective` consults `human_is_root` FIRST: truthy -> `effective_parent_index = None` (root), skipping the human_parent_norm/parent_index_norm derivation; else the existing logic runs verbatim. **Consistency invariant** (enforced ONLY at the `_apply_and_save_row_edit` chokepoint): `human_is_root=1` => `human_parent=-1`; a `human_parent>=0` write clears `human_is_root` to 0. Purely additive -- NO data migration (a new Check defaults to 0, correct for every existing row, none of which are human-rooted). `human_is_root` is added to every fetch field-list that feeds `resolve_effective` (get_review_rows, get_structural_breaks, mark_sheet_parsed_check_done, and both cycle-guards) and to the resolve_effective return dict + the frontend ReviewRow type.

**`ai_suggested_is_root` (Slice AI-2d, BoQ Review Row Check field, default 0, read_only):** the AI analog of `human_is_root` -- the AI-layer root encoding. A SEPARATE Check ORTHOGONAL to `ai_suggested_parent` (whose -1 now means ONLY "no parent-index suggestion", never root). `resolve_effective` consults it as the THIRD layer of the four-layer parent precedence **human_is_root > human_parent > ai_suggested_is_root > ai_suggested_parent > parser**: when `ai_suggestion_status == "Accepted"` AND the flag is truthy, `effective_parent_index = None` (AI root), but ONLY below the human layer (a human_parent override or human_is_root still wins). `parse_ai_response` emits it (`suggested_parent: null` -> `ai_suggested_parent=-1` + `ai_suggested_is_root=True`, keeping parent_confidence); the AI-2c write-back stores it (root -> `ai_suggested_is_root=1`, `ai_suggested_parent=-1`, `ai_suggested_level=1`) and resets it in `_AI_DEFAULTS`; it is in `_AI_FETCH_FIELDS` (the worker feeds rows into resolve_effective) and the resolve_effective return dict. This REPLACES the AI-2c interim that could not represent a root suggestion.

---

## Reference Docs

| Domain | File |
|---|---|
| Full context index | `.claude/context/_index.md` |
| Doctypes | `.claude/context/doctypes.md` |
| APIs | `.claude/context/apis.md` |
| Procurement (PR/PO/RFQ) | `.claude/context/domain/procurement.md` |
| Projects | `.claude/context/domain/projects.md` |
| Service Requests | `.claude/context/domain/service-requests.md` |
| Internal Transfer Memos | `.claude/context/domain/internal-transfer-memos.md` |
| Invoice Autofill | `.claude/context/domain/invoice-autofill.md` |
| Vendor Hold | `frontend/.claude/context/domain/vendor-hold.md` |
| Frontend domain context (full) | `frontend/.claude/context/_index.md` |
| Session changelog | `.claude/CHANGELOG.md` |
