<!-- Carved from .claude/context/domain/boq-backend.md on 2026-07-30 (structural carve).
     boq-backend.md is a router; this file holds the detail.
     Load when: HISTORICAL -- do not load, do not extend. Per-slice detail belongs in frontend/.claude/plans/boq/slices/ -->

> **HISTORICAL. Do not load, do not extend.**
>
> This is a rolling per-slice changelog, carved out of `boq-backend.md` on
> 2026-07-30. Under the plan-doc rotation rule, per-slice as-built detail
> belongs in `frontend/.claude/plans/boq/slices/` as a write-once fragment
> with a row in `_slices.md` -- not in a context surface, where it grows
> without bound and is loaded by sessions that do not need it. It is kept
> here as the existing record; new slices do NOT get appended.
>
> Same disposition as `frontend/.claude/context/domain/boq-frontend-as-built-log.md`.

## Recent slice changelog (relocated header)

**`make_model` fieldtype Data→Text on `BOQ Nodes` + `BoQ Review Row` (2026-07-01, committed on develop — sanctioned-exception schema fix per root CLAUDE.md "Don't Touch"):** the running DB DocField was already `Text` and both columns already `text` (a prior out-of-band Desk change), while the committed JSON still said `Data`. Frappe developer-mode auto-export surfaced this divergence during an unrelated session (it also injected timestamp/trailing-newline noise). Resolved by committing the **minimal 1-line fieldtype diff** on each doctype JSON (auto-export noise stripped), aligning the committed code to the already-migrated runtime. Verified: both columns `text` via `information_schema` + clean `reload-doctype` — **no full `bench migrate` needed** (DB already migrated). This is the required "explicitly noted here" record for the CLAUDE.md sanctioned exception (post context-split, per-instance records live here, not in CLAUDE.md). NOT part of the BoQ review-refinements work — incidental cleanup captured while merging that work to develop.

**Review-screen refinements — #22 demote + advisory-suppression-on-edit (2026-07-01, `feature/boq-review-refinements` off `feature/boq-level-derivation`; local, NOT pushed):**
- **#22 (`levelless_preamble_squeeze`) demoted to an internal tripwire (ADR-0009 amendment):** removed from `validate_node_plan`'s user-facing warnings + dropped its `level_warnings` parameter (all call sites updated). `derive_effective_levels` still returns `consistency_warnings`; when non-empty they now feed `_log_levelless_squeeze_tripwire` (`frappe.logger("boq").warning` + `frappe.log_error` Sentry, wrapped in try/except so it can never raise into a commit txn) at the preflight (`evaluate_sheet`) + commit (`commit_pipeline._commit_node_tree`) paths. #22 was unreachable for well-formed trees (cycle → already hard-blocked by `check_structural_integrity`; >60-hop → pathological) and the commit pipeline discarded it anyway. **#7 (`preamble_parent_level`) + #15 KEPT unchanged** — #7 still uniquely guards a preamble filed under a non-heading parent (a state the derivation does not prevent; the `boq_nodes.py` controller still hard-`throw`s it).
- **Advisory suppression on human reclassification (`_compute_advisory_flags`, `review_screen.py`):** the `parser` (`needs_classification_review` + `review_reason`) and `classifier_warning` (`classifier_warnings`) flags are now suppressed when the row has a human classification override (`and not _get(row, "human_classification")` added to both emit conditions). `orphan` UNCHANGED (recompute-on-read; reflects current truth). Rationale: those two are backed by STORED parser fields a human edit never rewrites (only a re-parse does), so they persisted as stale noise on edited rows. **Dimension-aligned:** ONLY a classification override suppresses — a parenting-only override (`human_parent`/`human_is_root`) leaves them live. `human_classification` was already present in the row dicts on both feed paths (`get_review_rows` build + `get_structural_breaks` `frappe.db.get_all`). Advisories are soft (dropped from the finalize gate), so suppression is correctness-neutral. **Verified live:** BOQ-26-00023 / "HVAC BOQ " row 143 (`BOQRR-26-21017`, human-reclassified preamble→line_item, `needs_classification_review=1`) now returns 0 flags (was the stale `parser` advisory). Tests: test_review_screen 241→247 (+6), test_commit_validation 51, test_commit_pipeline 50, test_boq_nodes 77 (all green); tsc delta-0. Frontend: `boq-frontend-*` (RestructureModal picker + "Looks OK" align).

**Preamble `level` derived from effective tree (2026-06-30, local, NOT committed, NOT deployed. ADR-0009 pending Nitesh sign-off):**
Root cause: `level` is written by the parser from the heading numbering/styling axis (written once, never updated). The review screen's `human_parent`/`effective_parent_index` re-parenting NEVER touches `level`. After a legitimate re-parent the two axes diverge and #7 (`preamble_parent_ok`) hard-blocks Finalize on a structurally-valid tree. Confirmed on BOQ-26-00023 / "HVAC BOQ " (11 must-fix `preamble_parent_level` breaks). Full analysis: `docs/boq/preamble-level-reparent-block.html`.

**`derive_effective_levels(node_rows)` (new, `commit_validation.py`):** replaces `_real_preamble_level` + `_compute_levelless_preamble_levels`. For each row: walks up `effective_parent_index` (hop-cap 60, cycle-guard via seen-set) counting **preamble-classified ancestors**; preamble → `level = 1 + preamble_ancestor_count` (root=1, +1/tier); any non-preamble → `None` (the system convention — maintained exactly). Order-independent (counts ancestors, never reuses stored parent level). **Cascade invariant:** runs whole-sheet on every read, so re-parenting a preamble recomputes that row AND every descendant in lockstep (the non-cascade gap in the old `_compute_levelless_preamble_levels` is eliminated).

**Three consumers (single source of truth):** (a) `validate_node_plan` — drives #7/#15/#22 validators (bodies UNCHANGED — now validate derived levels); (b) `commit_pipeline.py` — replaces the `_compute_levelless_preamble_levels` call at `:646`, writes derived `BOQ Nodes.level` at commit; (c) `review_screen.py get_review_rows` — via lazy function-level import (same pattern as `structural_errors_for_sheet`, avoids the existing module cycle), attaches `effective_level` (preamble → derived; non-preamble → `None`) to each row dict. Validation, commit, and display can never disagree.

**Parser `level` becomes vestigial:** the parser continues to write it (not changed, per owner instruction); all consumers downstream of the review screen now ignore it in favour of the derived value. Same position as `path`.

**Checks kept as defensive tripwires (owner instruction):** `preamble_parent_ok` (#7) survives in both `validate_node_plan` AND the `boq_nodes.py` controller backstop. #15 (deep-nesting) and #22 (level-squeeze) re-pointed at derived levels. Under correct derivation these always pass; a future regression trips them loudly.

**No migration:** committed `level` on existing `BOQ Nodes` rows is not recomputed. Applies to new commits and re-commits only.

**Tests (all in-container green):** test_commit_validation 51, test_commit_pipeline 50, test_boq_nodes 77, test_review_screen 241. New `derive_effective_levels` unit tests: root=1, nesting, non-preamble=None, reclassify preamble→line-item=None, VALVES 4-tier, cycle-safety. CASCADE test: 4-deep preamble subtree → re-parent middle node → row AND all descendants shift in lockstep. Tripwire test: injected inconsistent level → #7 fires.

**Empirical confirmation (localhost DB):** 1554 review rows + 1994 committed nodes, ZERO non-preamble rows with level≥1. The 11 `preamble_parent_level` breaks on BOQ-26-00023/HVAC BOQ  clear: VALVES→L2, PN-16 Butterfly Valves→L3 (parent L2 < L3 ✓), BTU METER→L3, Ultrasonic BTUH→L4. Cascade verified through the real `save_review_edit` endpoint + `mutate()` refetch. ADR-0009 ref: `docs/adr/0009-derive-preamble-level-from-tree.md`. Frontend: see `frontend/.claude/context/domain/boq-frontend-*` (ParentChain `effective_level` chip section).

**Copy-forward -- carry RATES from an old version into current (FULL-STACK, NO migrate, base tip 863dceb5, 2026-06-26):**
the WRITE-side of version-view (slice 2). From the read-only history view, the user copies an OLD version's RATES into the
CURRENT version (rates only; never structure/amount/qty). **Build shape = Option B: server-side plan + ATOMIC apply.**
**Behavior-preserving extraction of `save_cell_price`** (the live write path stays byte-for-byte -- `test_pricing` 166
unchanged): `_resolve_and_guard_cell(...)` (resolve + the three gates: deliberate lock, mandatory amount-formula,
priceability) + `_write_cell_price_record(...)` (freeze-and-supersede + insert + the two re-arms, NO commit); the
priceability rule is now a shared predicate `_node_priceable_without_override` used by BOTH the guard AND the plan
classifier (no drift). **The CF3 safety rule** -- `_current_rate_column_index(column_descriptors)` builds the RESTRICTED
rate-role-only inverse `{(area, rate_kind): col_letter}` (per-area key (area, rate_subkey) -- rate_subkey IS the stored
rate_kind spelling supply_rate/install_rate/combined_rate; scalar key (None, <kind>) via the `rate_supply<->supply_rate`
bridge; NON-rate roles excluded because a generic inverse is ambiguous -- append_to_notes maps one role+area to several
letters); copy-forward re-resolves the target column by (area, rate_kind), NEVER the bare source col_letter. **Endpoints
(`pricing.py`):** `get_copy_forward_plan(boq, sheet, from_version)` (whitelisted READ-ONLY) classifies every source
priced cell via the SHARED `_build_copy_forward_plan` -> outcome 1 HARD SKIP (skip_reason non_match | no_rate_column |
non_priceable) / 2 clean / 3 conflict, with the re-resolved target_col + current_rate; `apply_copy_forward(boq, sheet,
from_version, decisions)` (whitelisted POST, ATOMIC) RE-DERIVES the plan server-side (client outcome/target/rate NOT
trusted -- a crafted POST can't write a wrong column or an outcome-1 row), checks sheet-level gates once, does ONE lock
acquire + ONE commit, and rolls back the WHOLE batch on any error. NO migrate (writes through existing BoQ Cell Pricing).
`test_pricing` 166 -> 176 (+10 `TestCopyForward`: all outcomes + counts + overwrite/keep + outcome-1-never-written +
column-drift re-resolution + atomic rollback + guards).

**Version-view -- read-only committed-version history read paths (FULL-STACK, NO migrate, base tip 761c4bf3, 2026-06-26):**
the pricing editor gains a read-only history browser; the BACKEND adds version-aware READ paths ONLY -- the live-editor hot
path is byte-for-byte unchanged. **The hot-path problem:** `get_priced_rows`/`get_committed_rows` are welded to the CURRENT
version (`get_committed_rows` resolves BoQ Sheet + nodes by `is_current=1`); the pricing + grid reads were ALREADY
version-parameterized (`get_sheet_pricing`/`get_committed_sheet_grid` take `committed_version`) -- only the NODE read was
hardwired. **`review_screen.py`:** extracted the node-read + row-assembly tail of `get_committed_rows` into a private
`_assemble_committed_rows(boq, node_filters, column_descriptors, commit_version)` -- the CURRENT path passes
`{boq, sheet, is_current:1}` (byte-for-byte the prior query; `test_review_screen` 232 unchanged & green). NEW
`get_committed_rows_at_version(boq, sheet, committed_version)` (`@frappe.whitelist()` bare, READ-ONLY): resolves the BoQ
Sheet by `commit_version` (ANY is_current -- an old version is is_current=0), rebuilds descriptors from ITS config, reads
nodes scoped by the resolved version's BoQ Sheet name (no is_current -- that row IS the version); graceful empty (`rows:[]`)
when the version has no node-tier row (node tier + grid tier can carry different version sets -> client falls back to the
faithful grid). **`pricing.py`:** extracted the overlay-merge of `get_priced_rows` into `_merge_overlays(boq, sheet, version,
rows, column_descriptors)` (behavior-preserving; `get_priced_rows` calls it -> `test_pricing` proves equivalence). NEW
`get_version_priced_rows(boq, sheet, committed_version)` (`@frappe.whitelist()`, READ-ONLY): mirrors `get_priced_rows`' shape
so the grid renders an old version with NO new render code, but forces the read-only posture -- `editable=False`,
`lock_info=None` (a historical read NEVER touches the single-editor lock); `column_formulas`/`dismissals`/
`reconciliation_choices` read for the REQUESTED version (all version-parameterized); reuses `_merge_overlays`. **`commit_gate.py`:**
NEW `get_sheet_versions(boq, sheet)` (`@frappe.whitelist()`, READ-ONLY) -- the dropdown version list. **Version
SOURCE-OF-TRUTH = the committed GRID tier** (`BoQ Committed Sheet Grid`, the existing "what versions exist" authority --
covers grid-only sheets + versions the node tier lacks). Each version carries its last-pricing-change via **reuse of
`_latest_change_by_sheet_version`** (the Slice-5b staleness helper -- one grouped call returns every version); missing key =
never-priced -> `last_change_at=None` (the client labels by committed_at + "never priced", a COMMON case: VRF /
Electrical v1-v2 / HVAC v1-v3). Returns `{"versions":[{commit_version,is_current,committed_at,sheet_disposition,
last_change_at}]}` version-desc. **FINDING (reported, NOT guarded this slice -- informs copy-forward):** the WRITE endpoints
(`save_cell_price` etc) take `committed_version` and resolve the cell WITHOUT requiring is_current, so a crafted POST could
write an OLD version -- BY DESIGN (each version carries its own pricing lifecycle), and version-view adds no write, so no new
exposure. NO migrate. `test_pricing` 158 -> 166 (+8 `TestGetVersionPricedRows`); `test_commit_gate` 27 -> 33 (+6
`TestGetSheetVersions`); `test_review_screen` 232 (unchanged -- refactor byte-for-byte).

**Relocated pricing-editor slices (from root CLAUDE.md, 2026-06-26 re-split — these post-2026-06-25-split slices' `docs(record)` commits had bypassed this doc and re-bloated CLAUDE.md):**

**Latest slice (FULL-STACK + MIGRATE
-- deliberate per-sheet pricing-editor lock):** a USER-CONTROLLED, PERSISTED, CROSS-USER, SERVER-ENFORCED per-sheet read-only
lock for the pricing editor -- the pricing twin of the review-screen "Finalized" freeze. DISTINCT from the transient
single-editor CONCURRENCY lock (`BoQ Sheet Pricing Lock` / `BOQ_PRICING_LOCKED`) and the inert per-cell `is_finalized`.
**Doctype (ADDITIVE, migrate):** three fields on **`BoQ Sheet`** (the committed sheet tier) -- `is_locked` (Check, default 0),
`locked_by` (Data read_only, mirroring `dismissed_by`/`chosen_by`), `locked_at` (Datetime read_only); written via
`frappe.db.set_value` (NOT doc.save -- the list-valued `area_dimensions` JSON throws on a full save), mirroring the
`last_exported_at` precedent. **Endpoints (`pricing.py`):** `lock_sheet`/`unlock_sheet(boq_name, sheet_name, committed_version)`
(POST; mirror `mark_sheet_parsed_check_done`/`unmark` -- resolve the `is_current=1` BoQ Sheet row via the shared
`_set_sheet_lock` -> set_value the three fields + commit; **NO role check -- ANY user may toggle**, a coordination signal not
a permission). **Guard:** `_guard_sheet_not_locked(boq, sheet, version)` (mirrors `_guard_sheet_not_frozen`) called in ALL SIX
save_* endpoints (`save_cell_price` [before the formula/priceability gates so the lock error wins], `save_row_remark`,
`save_cell_color`, `save_cell_dismissal`, `save_cell_reconciliation_choice`, `save_amount_formula`) AFTER the resolve + BEFORE
`acquire_or_refresh` -- reject-mutates-nothing; PURELY ADDITIVE (an unlocked sheet passes through byte-for-byte). The server is
the real boundary (a direct API write on a locked sheet is rejected -- proven by test). **Return fold:** `get_priced_rows` adds
an `is_locked` key BESIDE `editable` (separate -- the frontend ORs it into `locked` but keeps the reason distinct for the
teal banner vs the amber concurrency banner); `get_committed_state` folds `is_locked` into its EXISTING `is_current=1` BoQ Sheet
lookup (no new query). **Re-commit INVALIDATES the lock FOR FREE:** `_write_committed_boq_sheet` `new_doc()`s a fresh BoQ Sheet
row per commit and never sets `is_locked`, so a new commit_version starts `is_locked=0` (no pipeline change). `bench migrate`
landed the 3 columns (schema sync runs BEFORE the pre-existing unrelated `backfill_cashflow_gap_limited` patch wart). backend
`test_pricing` 151->158 (+7 `TestSheetLock`), `test_commit_gate` 27 (unchanged); frontend rides the existing `locked` choke
point (toggle + teal banner; `pricingRowPropsAreEqual` untouched -- detail in frontend/CLAUDE.md + plan §"Lock/unlock edits").

**Prior slice (FULL-STACK, Slice 5b):**
**Download priced tender hub UI + staleness.** The hub UI for the 5a write-back -- COMPLETES the Slice-5 arc (5a backend +
highlight + 5b UI). **Backend (ADDITIVE, NO schema/migrate):** `commit_gate.get_committed_state` now ALSO returns per committed
sheet **`last_exported_at`** (FREE -- folded into the existing `is_current=1` BoQ Sheet lookup) + **`pricing_changed_since_export`**
(bool: `max(priced_at/colored_at/remarked_at on the sheet's CURRENT commit_version, is_current=1)` > `last_exported_at`, or
content-exists-but-never-exported -> True, nothing -> False; **version-isolated** via `_latest_change_by_sheet_version` grouping
by `(sheet_name, committed_version)`; three GROUPED queries; existing return keys UNCHANGED). **Frontend:** a NEW "Download
priced tender" hub button (now an "Export" overflow-menu item per the toolbar rework, gated on `committedMap.size`, DELIBERATELY distinct from the D2b "Export Parsed BoQ"
draft-review export) -> NEW **`PricedTenderDialog`** (CommitDialog's committedState rows + ExportWorkbookDialog's
self-contained download; all finalized rows ticked by default; **grid-only general-specs rows SHOWN but DISABLED "no rates to
write"**; per-row "last exported {date} / never exported" + amber "changed since export"); NEW **`downloadBlob.ts`**
(`base64ToBytes` pure + `downloadBytes` = the exportReviewXlsx Blob/anchor tail) decodes the endpoint's `content_base64` ->
Blob -> download; a skipped-formula acknowledge-note (mirrors CommitResultsModal) names the formula-rate columns left
untouched (0 client-owned-doc); a per-sheet "priced since last export" amber chip on `SheetCard` (rides the existing
`committedState` prop). `export_writeback.py` (the 5a endpoint) UNCHANGED -- 5b only CALLS it. backend test_commit_gate 20->27,
frontend vitest 303->307 (+4 `base64ToBytes`), tsc 3175 (0 new), NO migrate; backend live-verified on 145; the browser
download round-trip is owner-cert-live (not headless). OWED live-cert: (i) VRF formula-skip live proof; (ii) unticked/grid-only
sheet unchanged + chip flip/clear. See plan section "Slice 5b" + frontend/CLAUDE.md. **Prior slice (BACKEND, Slice 5a):**
**Excel write-back backend -- the priced-workbook generator.** NEW module `api/boq/wizard/export_writeback.py` + endpoint
`export_priced_workbook(boq_name, sheet_names)` (a sibling module, NOT folded into the 2076-line pricing.py). Given a committed
BoQ + a ticked sheet subset (current committed version resolved SERVER-SIDE), it produces a priced `.xlsx` COPY and returns
its bytes. **COPY-ON-WRITE** (fetch S3 -> `shutil.copy` -> stamp+save ONLY the copy; original temp/S3 never written);
`openpyxl.load_workbook(copy, data_only=False)` (the `data_only=True` value-trap avoided). Per ticked sheet: **(a) RATES ONLY**
-- stamp each filled `BoQ Cell Pricing.rate` into `(col_letter, excel_row)`, with **PER-CELL FORMULA SKIP** (`cell.data_type
== 'f'` -> leave untouched + report the col_letter; e.g. a VRF combined-rate `=SUM(supply,install)`); **(b) COLOR** -- a solid
`PatternFill` at the tagged cell (ANY column incl. non-rate; a fill never alters value/formula); **the 8 token->hex map is
DECIDED HERE** (`_COLOR_HEX`: red `FFC7CE`, orange `FFD9A0`, yellow `FFEB9C`, green `C6EFCE`, blue `BDD7EE`, purple `E1D5F7`,
pink `FBD4E4`, grey `D9D9D9`); **(c) REMARK** -- a `"Nirmaan Remarks"` TRAILING COLUMN one past the **TRUE DATA EDGE**
(rightmost MAPPED col from the committed `column_role_map`, NOT inflated openpyxl `max_column`), with a HARD empty-column
safety check that THROWS rather than overwrite real data. **POST-SAVE FIDELITY ASSERTION** re-opens the saved copy + asserts
formula / merge / worksheet / defined-name counts unchanged (mismatch FAILS the export, reject-mutates-nothing). NEW additive
`BoQ Sheet.last_exported_at` (Datetime), stamped per exported sheet via `frappe.db.set_value` (NOT doc.save -- the list-JSON
`area_dimensions` gotcha). Grid-only general-specs sheets (`treat_as == "master_preamble"`) pass through untouched but count
as exported. **RETURN = base64-in-JSON** (`{filename, content_type, content_base64, exported_sheets, skipped_formula_columns,
remark_columns, last_exported_at}`) -- the file-only `frappe.local.response.filecontent` idiom can't carry the skipped-formula
report, so one JSON response carries both; 5b decodes base64 -> Blob -> download. Governing principle 0: client-owned doc --
rates + the user's own color/remark annotations ONLY, never amounts/formulas/structure. `bench migrate` landed the field (schema
sync runs BEFORE the pre-existing unrelated `backfill_cashflow_gap_limited` patch wart, which aborts the patch phase -- NOT
this slice's, not fixed). backend `test_pricing` 126->145 (+19), live-verified end-to-end on 145/150/166 (fidelity passes incl.
166's 4585 defined names). NO frontend (Vitest/tsc N/A). 2026-06-25; see plan section "Slice 5a". **Amendment (highlight,
commit 95f07c47):** an ALWAYS-ON priced-cell verification highlight -- a muted-teal `PatternFill` (`_PRICED_HIGHLIGHT_HEX =
"B7E4D8"`, a SEPARATE constant from the 8 user tokens, distinct from user green/blue) on every rate cell the write-back
ACTUALLY stamped. RULE 1 stamped-only (`_stamp_rates` returns `(skipped, written)`; the highlight is driven by `written`, so
a SKIPPED formula rate cell gets NO teal -- teal = the live signal of the rates-only + formula-skip rule); RULE 2 system wins
(`_apply_priced_highlight` runs AFTER `_apply_colors`, so on a collision the teal overrides a user color tag on a stamped
rate cell; a user color on a non-stamped cell is untouched); RULE 3 only stamped RATE cells (never remark/amount/remark-col).
A fill changes no value/formula -> the fidelity assertion is unaffected. NO schema/migrate. test_pricing 145->151 (+6),
live-verified on 145 Electrical. **NEXT = Slice 5b (hub UI).**

**Amendment (download filename = original uploaded BoQ name, 2026-07-08):** the export filename now mirrors the ORIGINAL
uploaded BoQ name (the friendly `BOQs.boq_name` FIELD, e.g. `Tender ABC Project_priced_<ts>.xlsx`) instead of the docname
(`BOQ-26-00001_priced_<ts>.xlsx`). Root cause was a variable-shadowing trap: `_generate_priced_workbook`'s `boq_name` param is
the DOCNAME (the committed-tier `{"boq": boq_name}` lookups need the PK) but the filename line read the same name as if it were
the friendly field. Fix: `export_priced_workbook` fetches `boq_name` (the field) alongside `source_file_url` in the SAME
`get_value` and threads it as a NEW optional `display_name` arg to `_generate_priced_workbook` (default `None` -> the ~7 existing
3-arg call sites keep the docname fallback, so no existing test/behavior changed). Filename base is built by the pure helper
`_safe_export_basename(display_name, docname)`: prefers `display_name`, strips filename-illegal chars (`\ / : * ? " < > |` +
control), collapses whitespace, falls back to docname when blank/all-unsafe. The `_`->space lossiness from upload
(`upload_file.py` `base.replace("_"," ")`) is unavoidable + acceptable (the friendly field IS the app's notion of the BoQ name).
Frontend UNCHANGED (it uses `result.filename` verbatim). test_pricing +7 (176->183). No schema/migrate.

**get_committed_state Slice-5b staleness additions (relocated):** **Phase 5 Slice 5b -- TWO MORE ADDITIVE fields (`last_exported_at` + `pricing_changed_since_export`):** `last_exported_at` rides the EXISTING second BoQ Sheet `is_current=1` lookup (one field added to its `fields=[...]` -- no new query). `pricing_changed_since_export` (bool) = `max(priced_at over BoQ Cell Pricing, colored_at over BoQ Cell Color, remarked_at over BoQ Cell Remark)` for the sheet's CURRENT `commit_version` (`is_current=1`) > `last_exported_at`; content-exists-but-never-exported -> True; nothing -> False. **Version-isolated** -- the new module helper `_latest_change_by_sheet_version(boq)` runs THREE GROUPED queries (one per overlay tier) keyed `(sheet_name, committed_version)` so an OLD version's timestamp never marks the current version stale; `_is_changed_since_export(latest_change, last_exported_at)` is the pure rule (normalizes both via `frappe.utils.get_datetime`). Existing return keys UNCHANGED. Drives the Slice-5b "Download priced tender" picker sub-labels + the per-card "priced since last export" chip. `test_commit_gate` 20 -> 27 (+7 `TestGetCommittedStateStaleness`).


**Orphan demotion + warnings-UX polish (2026-06-26, develop, full-stack).** Orphan is NO LONGER a structural
break. Backend (`review_screen.py`): removed the orphan branch from `check_structural_integrity` (now ONLY
`line_item_as_parent` + `cycle`); `_compute_advisory_flags` computes orphan INDEPENDENTLY (a `line_item` whose
`resolve_effective` parent is None) instead of deriving it from `structural_breaks` — so its `structural_breaks`
PARAM IS REMOVED (both callers updated: `get_review_rows` + `get_structural_breaks`). **Finalise-gate consequence
(intended):** `mark_sheet_parsed_check_done` reads `check_structural_integrity`, so an orphan-only sheet now
finalises on the plain confirm with NO "Structural issues found" dialog (`{ok:true,overridden:false}` on
confirm:false — browser-verified on BOQ-26-00020/GeminiSheet); `line_item_as_parent`/`cycle` still gate. Orphan
becomes a dismissable amber advisory. Frontend (`ReviewTree.tsx`, no backend dep): orphan renders amber (removed
from `WARN_BREAK_LABELS`); classifier notes render as BULLETS (one per note, from the `classifier_warnings` array,
NOT the "·"-joined reason) across all three surfaces via a shared `WarningFlagContent` helper (block-`<span>`s, not
`<ul>` — the panel entries are `<button>`s); advisory flags now ALSO surface on must-fix rows; the detail panel folds
FLAGS + the old "Classifier notes" section into ONE "Warnings" block with "Looks OK" moved to the BOTTOM (one click
acknowledges the whole block, per-row). NO schema change / NO migrate. test_review_screen 229→232; tsc 0 new; build
exit 0; chrome-devtools E2E green (orphan amber + bulleted, must-fix advisory surfacing, Looks-OK at bottom,
orphan-only finalise has no dialog, no console errors). See plan "Latest".

**Review-warnings cleanup (2026-06-25, develop, full-stack).** Reworked the review-screen advisory-flag set
(`review_screen.py` `_compute_advisory_flags`). REMOVED two flags: `priced_preamble_no_children` and
`zero_amount_line_item` (both deemed redundant -- qty-bearing preambles are now handled only by the pricing editor's
`priceability`/`needs_rate`; the zero-amount/has-rate case is expected on unpriced tenders). Dropped the now-dead
`_has_price_signal` + `_PRICE_SIGNAL_FIELDS` and trimmed `_ADVISORY_EXTRA_FIELDS` to
`(needs_classification_review, review_reason, classifier_warnings)`. ADDED a new advisory flag
**`classifier_warning`** that surfaces the per-row `classifier_warnings` notes (previously computed + shipped but never
rendered) -- one flag per row, `reason = " · ".join(notes)`, tolerant of the JSON-string shape (`get_structural_breaks`
fetches via `frappe.db.get_all`, which does NOT JSON-parse) AND the list shape (unit tests). SURVIVING flag set =
`orphan`, `parser`, `classifier_warning`. REMOVED `validation_warnings` ENTIRELY (the per-area math reconciliation
checks -- qty/amount per-area-sum-vs-total + combined_rate consistency): deleted from the parser (`orchestrator.py`
appends + `ResolvedRow`/`ParsedSheet`/`ParsedBoq` dataclass fields, `hierarchy.py`), the worker write-path
(`parse_run.py` `flatten_resolved_row` + `_LIST_JSON_FIELDS`), the read endpoints (`review_screen.py`
`_RESAVE_LIST_JSON_FIELDS`/`_JSON_LIST_FIELDS`/`get_review_rows.all_fields`), the `BoQ Review Row` doctype JSON, and the
`boqTypes.ts` type. **Orphan finalise gate UNCHANGED** (deliberate -- it stays a soft warn-and-confirm via "Mark anyway",
NOT a hard block). bench migrate clean; backend 920 tests green (test_review_screen 229, test_parse_run 99, full parser
suite incl. orchestrator 69 / hierarchy 63); frontend tsc 0 new errors. NOTE: Frappe does not auto-drop DB columns -- the
physical `validation_warnings` column on `tabBoQ Review Row` persists orphaned until an explicit `DROP COLUMN`.

**Last updated:** 2026-06-24. **Latest slice (full-stack):**
**Cluster B -- formula-vs-document reconciliation (per-cell choice).** When a committed (DOCUMENT) amount and the
formula-computed amount DIVERGE for the same amount cell, the editor FLAGS it (mismatch only -- never auto-fixes; the
tendering doc is client-owned) and lets the user CHOOSE per cell which value wins, stored stickily per committed version in
the NEW per-CELL doctype **`BoQ Cell Reconciliation Choice`** (mirrors BoQ Cell Dismissal's freeze-and-supersede model;
identity adds `col_letter` -> PER-CELL). FOUR LOCKED decisions: **D1 default = DOCUMENT** (an unset/keep_document divergent
cell shows the document value in BOTH the grid AND the rollup -- REVERSES the prior formula-wins display; take_formula shows
the formula value); **D2 visualization = BOTH channels** (a STRONG violet cell badge/chooser [muted-grey when resolved] +
a new "divergence" review-strip kind carrying the unresolved count); **D3 invalidation = AUTO-RESET, SURGICAL, PER-CELL,
COLUMN-AWARE** (a rate save clears a choice ONLY on amount cells whose formula REFERENCES the edited rate operand [via the
new `_amount_col_depends_on_rate` operand walk -- NOT the whole row]; a formula save/remove clears that column's cells; a
re-commit orphans old choices by version); **D4 rollup single-source** (the chosen value resolves ONCE in
`pricingRollup.rowOwnAmount` so Option-1==Option-2 stays balanced). Divergence fires ONLY when the formula yields a real
number (`cell.kind === "value"` -- not_yet/broken/no-formula never flag). Endpoints `save_cell_reconciliation_choice` /
`get_sheet_reconciliation_choices` + a flat per-cell `reconciliation_choices` key on `get_priced_rows`. NEW pure leaf
`reconcile.ts` (the SHARED `amountsEqual` tolerance, now also reused by the rollup integrity guard -- one epsilon).
bench migrate creates the doctype (the migrate run also hit a PRE-EXISTING unrelated patch error
`backfill_cashflow_gap_limited` missing `execute`, commit 4cc217f8, NOT from this slice -- the doctype synced before it).
backend test_pricing 110->126, frontend vitest 245->264 (NEW reconcile.test 12 + rollup +4 + priceability +3), tsc 3175
(0 new), in-container build exit 0, 2026-06-24; see the pricing-editor quick rules below + plan §"Cluster B". **Prior slice
(full-stack):** the
**MANDATORY amount-formula gate** -- amount formulas are now required before any rate is editable (REVERSES the F1-F4
"formula optional" property); the gate is ABSOLUTE (the `allow_non_priceable` override does NOT bypass it). Server
`_sheet_formulas_complete` (+ the shared `_formula_target_matches_column` / `_formula_covers`) throws in `save_cell_price`
OUTSIDE the override block; frontend `priceability.areFormulasComplete` -> a per-sheet `formulasComplete` ANDed into the grid
rate gate + a "Declare amount formulas to enable rate entry." banner. `save_amount_formula`/declaration stays live under the
gate. NO migrate (reads existing formula storage). backend test_pricing 104->110, frontend vitest 226->235, tsc 3175 (0 new),
2026-06-24; see the pricing-editor quick rules below + plan §"Mandatory amount-formula gate". **Prior slice (full-stack):**
Phase 5 Slice 4b-ACKNOWLEDGE -- the per-ROW review-strip DISMISSAL ("reviewed / looks OK") layer (NEW doctype BoQ Cell Dismissal +
**Last updated:** 2026-06-25. **Latest frontend slice
(2026-06-25):** BoQ review-screen FUZZY DESCRIPTION SEARCH -- FRONTEND-ONLY (no backend/doctype). The case-insensitive
SUBSTRING search in BOTH `ReviewTree.tsx` (the #159 find-&-filter) and `SheetSearchView.tsx` (the row-finder, also the
RestructureModal parent-picker) is replaced by the app-wide token-scoring matcher (`utils/tokenSearch`, the FuzzySearchSelect
core) via ONE shared wizard-local helper `boqDescriptionSearch.ts` (`fuzzyDescriptionMatchSet`). Locked behaviour: token AND
(every >=2-char token must match), partial tokens on, min length 2; fuzzy decides MEMBERSHIP only -- each surface re-emits
hits in DOCUMENT order so the prev/next stepper still walks top-to-bottom (tokenSearch's relevance ranking deliberately
discarded). RestructureModal inherits via SheetSearchView (no change). tsc delta-0, build green; details in
`frontend/CLAUDE.md` + plan §"Fuzzy description search". **Prior frontend slice (2026-06-25):** detail-panel READ VIEWS --
two ADDITIVE pure components (`ParentChain.tsx` ancestor breadcrumb + `ChildrenList.tsx` direct children + `▸N`) mounted in
the EXISTING `expandedDetailRow` panel (ORIGINAL single-column design unchanged), clickable to drill-navigate via
`navigateToRow`; a two-column revamp was prototyped then REVERTED. **Prior parser fix (2026-06-24):**
PREAMBLE rows no longer drop their source quantities -- the owner-locked "no source attribute lost during parsing;
classification is a label, not a data filter" principle (Option B). The resolver PREAMBLE `ResolvedRow` now carries
qty/amount forward symmetric with LINE_ITEM (`hierarchy.py`), `_apply_multi_area_post_pass` widened to `{LINE_ITEM, PREAMBLE}`
(`orchestrator.py`), and the `priced_preamble_no_children` advisory flag now ALSO fires on a carried `qty_total` so qty-bearing
preambles are surfaced for human reclassify -- NOT a new parser flag (would duplicate the existing one) (`review_screen.py`).
**[SUPERSEDED 2026-06-25 review-warnings cleanup:** the `priced_preamble_no_children` review-advisory flag was REMOVED ENTIRELY
(along with `zero_amount_line_item`). qty-bearing preambles are now surfaced ONLY by the pricing editor
(`priceability.isPriceableLine` includes Preamble -> a qty-bearing Preamble is a priceable line -> `needs_rate`). The parser-side qty
PRESERVATION (this 2026-06-24 fix) STANDS unchanged; only the review-screen advisory flag is gone.]**
Root cause = Bug-19 `_apply_priced_preamble_promotion` over-promoting flat-`sl_no` leaf items INTO preambles + the PREAMBLE
ResolvedRow never copying qty. ~833 parser+review+commit tests green; verified 16/16 dropped quantities restored on
BOQ-26-00021 / `HVAC_-19TH FLOOR`. See plan §17.45. **Latest slice (full-stack):** Phase 5
Slice 4b-ACKNOWLEDGE -- the per-ROW review-strip DISMISSAL ("reviewed / looks OK") layer (NEW doctype BoQ Cell Dismissal +
save_cell_dismissal / get_sheet_dismissals + a row-level RE-ARM inside save_cell_price [computed kinds only, EXCLUDES remark]
+ an additive sheet-level `dismissals` key on get_priced_rows; frontend active/show-all strip filter + toggle + per-entry
Looks-OK/Restore action; backend test_pricing 82->96, frontend priceability 27->30; bench migrate clean, 2026-06-23; see plan
§"Phase 5 Slice 4b-ACKNOWLEDGE"). **Prior backend slice:** Phase 5
Formula Builder F1 -- amount-formula storage (NEW doctype BoQ Cell Amount Formula + save_amount_formula /
get_sheet_amount_formulas + get_priced_rows column_formulas merge, 2026-06-22; see plan §"Formula Builder F1").
**Prior frontend slice:** Phase 5 Slice 4b-A -- the computed review-flag layer (FRONTEND-only, NO backend/doctype/migrate):
the shared `frontend/src/pages/boq-wizard/priceability.ts` "qty-bearing priceable line" spine (§6 one-shared-definition) +
the computed flags (needs-rate / qty-anomaly + F4 broken/not_yet, with broken/not_yet GATED behind the priceability spine --
option-(i), symmetric with needs_rate; and not_yet DE-DUPED per-area against needs_rate so one rate gap isn't reported twice
-- cert fixes) + in-grid markers + a unified review strip + an N/M
priced-count & "show unpriced" filter + the incomplete-subtotal signal (`pricingRollup.RollupNode.incomplete`) surfaced as
ONE quiet `SummaryPanel` message (the per-subtotal review-STRIP entries were removed as noise) + rollup
alignment; Cluster B (the reconciliation choice store) deferred to a later slice (2026-06-23; see plan §"Slice 4b-A").
The `wont_compute` flag was REMOVED before push -- superseded by the forthcoming mandatory amount-formula-declaration gate,
which makes the no-formula-at-pricing state impossible (so the flag could never fire).

---
