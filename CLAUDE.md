# CLAUDE.md — Nirmaan Stack

**Last updated:** 2026-06-15 (Phase 4 Slice P4-1 -- committed "BoQ Sheet" doctype, the SHEET tier -- BACKEND,
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
| BoQ Upload & Management | `feature/boq-phase-3` | `frontend/.claude/plans/boq-upload-plan.md` | Phases 1.x (parser, 588 tests) + Phase 3 Modules 1a/1b/2a/2b/3 COMPLETE. Review-screen arc COMPLETE: Slice A backend (feat fff26abd; -1 sentinel, resolve_effective / check_structural_integrity / append_edit_log_entry + 3 endpoints) -> B1/B1.1/B2a/B2b/B2c frontend (review tree + column descriptors + advisory flags + detail panel + Status column) -> C-values arc C-v1..C-v2d-fix (inline value/text/per-area editing + per-row Remarks). Restructure surface Slice 1a (searchable sheet-view `SheetSearchView.tsx`, FRONTEND-ONLY, feat 5ecf1820) LIVE-CERTIFIED 2026-06-09 (5/5 PASS on BOQ-26-00145). Slice 1b-alpha BACKEND (feat f7761415) -- shared write helper `_apply_and_save_row_edit` (save-inside/commit-outside) + transactional `save_review_restructure` (atomic reclassify+reparent, batch cycle-guard, FROM-but-not-TO assignable classes) + human-root via NEW `human_is_root` Check field (Option B, orthogonal to the -1 sentinel). CURRENT: Slice 1b-beta FRONTEND COMPLETE (feat e8eeab58) -- the restructure MODAL: detail-panel pill DropdownMenu -> childless light confirm OR staged `RestructureModal` (5 child-placement options, Path A fully-resolved child_moves, mounts certified SheetSearchView untouched as parent picker, row_number->row_index resolution + no-match guard), `onRestructured` reuses handleSaved; dev route + `_DevSheetSearchHarness.tsx` REMOVED. tsc 0 wizard-file errors + build exit 0; manual live-cert LC1-12 pending. Restructure-surface arc COMPLETE pending live-cert. Slice D1 -- "Parsed Check Done" marking + read-only FREEZE + Un-mark (BACKEND + FRONTEND): four-endpoint write freeze on a checked sheet via `_guard_sheet_not_frozen`, mark precondition (Parsed-only), new `unmark_sheet_parsed_check_done`, `readOnly` ReviewTree gating + Mark button + teal banner; test_review_screen 137 -> 147. Slice D2 -- per-sheet review CSV export (FRONTEND ONLY, feat 27866a2e): NEW wizard-local writer `exportReviewCsv.ts` (flat columns, per-area = one column per area per role, numbers raw, UTF-8 BOM) + "Export CSV" header button (status- and view-independent); reuses ReviewTree `resolveDescriptorValue`/`computeDepths`/`CLS_LABELS`/`FIXED_ROLE_DEDUPE` via export-keyword-only; the shared `src/utils/exportToCsv.ts` deliberately untouched. Slice D2b (latest) -- hub XLSX workbook export + per-card CSV export (FRONTEND + dependency, feat 91bf255d): a global "Export reviewed" footer button -> `ExportWorkbookDialog` (pre-ticked checklist of "Parsed Check Done" sheets) -> SEQUENTIAL `get_review_rows` fetch -> ONE .xlsx (one tab/sheet, numbers numeric, abort-on-any-failure) via NEW `exportReviewXlsx.ts`; a per-card "Export CSV" button -> the existing D2 .csv. NEW dep `exceljs` DYNAMICALLY imported (own lazy chunk, absent from hub/entry chunks); npm `xlsx` forbidden (abandoned + 2 CVEs). The D2 writer refactored to share a `buildReviewSheet` typed-cell core -> .csv stays byte-identical; Excel tab names sanitized+de-duplicated (tab title only, Sheet Name column verbatim #152). `SheetReviewPage.tsx` untouched (writer signature unchanged). OWED: single-pass full-sheet-read endpoint; C-values rate-editing live-cert against a Pattern-2-rate vehicle. Full slice-by-slice history + as-built detail: see boq-upload-plan.md. Do not duplicate the changelog here. |

Always read `frontend/.claude/plans/boq-upload-plan.md` before working on BoQ. Active doctypes: `BOQs`, `BoQ Sheet` (Phase 4 P4-1 -- the committed sheet tier, standalone istable=0, Links up to BOQs, autoname `BQSH-.YY.-.#####`; reuses the `BoQ Sheet Work Package` child for work-header links; nothing writes to it until P4-2/P5), `BOQ Nodes`, `BOQ Node Qty By Area` (no separate audit doctype — audit goes through `Nirmaan Versions` per §7 of the BoQ handover doc / decisions log). Phased build (Phase 0 → 7) — don't implement Phase N+1 functionality while working in Phase N. Phase 2 sub-phase split: 2a → 2b.1a → 2b.1b → 2b.2 (A1, A2, A3, B) → 2c.

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

- `flatten_resolved_row(resolved_row, sheet_name, row_index)` -- maps a parser `ResolvedRow` + nested `ClassifiedRow` to a flat dict of BoQ Review Row field values. JSON fields returned as Python objects (list/dict), NOT pre-serialized strings. CAVEAT: Frappe rejects Python lists for JSON fieldtype (`get_valid_dict` "cannot be a list"). Callers must `json.dumps()` the four list-JSON fields before `doc.insert()` -- see `_LIST_JSON_FIELDS` module constant. Dict-type JSON fields (`qty_by_area`, `amount_by_area`, `rate_by_area`, `append_notes_raw`) can be passed as Python dicts. **SENTINEL WRITES (agreement #54, both halves now applied):** writes `parent_index=-1` for root rows (None parent → -1) AND `human_parent=-1` for ALL rows (no human override at parse time). Both are required: Frappe coerces unset Int fields to 0, and 0 is a valid row index. `resolve_effective` treats `human_parent >= 0` as a real override -- without the explicit `-1`, every parsed row falsely reports effective_parent_index=0 (flat tree). Fix landed in Slice B1.1b-fix-A.

- `flatten_parsed_boq(parsed_boq, boq_name)` -- iterates `ParsedBoq.sheets`, calls `flatten_resolved_row` per row, injects `boq=boq_name`. `master_preamble` (treat_as="master_preamble") sheets produce no rows. Returns `list[dict]`.

- `run_parse(boq_name, sheet_names=None, force_reparse=False)` -- `@frappe.whitelist(methods=["POST"])`. Enqueues `_run_parse_worker` on `queue="long"`, `timeout=600`. `sheet_names=None` parses all eligible Reviewed/Parsed sheets; `sheet_names=[...]` parses only the named subset (per-sheet re-parse). `force_reparse` (HTTP string `"true"/"1"/"yes"` coerced to bool; default False) is threaded to `_run_parse_worker` -> `assemble_mapping_config` and makes `"Parsed Check Done"` sheets eligible (Force Re-parse backend slice -- see `assemble_mapping_config` above); the frontend sets it only for a deliberate, warned re-parse (a later frontend slice wires the button). After successful enqueue sets `BOQs.parse_in_progress=1` + commits (Bucket-2 Slice 1, feat cb86b92b). Returns `{"status":"queued","job_id":...}`. URL: `/api/method/nirmaan_stack.api.boq.wizard.parse_run.run_parse`

- `_run_parse_worker(boq_name, sheet_names=None, user=None)` -- background worker. Fetches workbook from S3 or local (derives real `.xlsm`/`.xlsx` extension from URL). Calls `assemble_mapping_config` -> `parse_boq` -> per-sheet delete-then-insert loop (applying `_LIST_JSON_FIELDS` pre-serialization). Per-sheet failure: compensating delete + set `Parse failed` + continue. Global `parse_boq` failure: all eligible sheets -> `Parse failed` + error event. Stamps `BOQs.parsed_at` on any success. **TWO READ-SITES for general-specs (Slice 2c):** Read-site 1 in `assemble_mapping_config` (routing); Read-site 2 in `_run_parse_worker` Step 5 (gates "mark Parsed" -- general-specs sheets never receive "Parsed" status). Step 6 write-loop: for each (sheet_name, preamble_text) in `parsed.master_preambles`, delete-then-insert child row (replace semantics, falsy-skip per row). Commits BEFORE publishing `boq:parse_run_done` (targeted to `user=`). Does NOT touch `BOQs.wizard_state`.

**`_LIST_JSON_FIELDS` module constant** -- `frozenset` of the 4 list-type JSON fields that must be pre-serialized via `json.dumps()` before `doc.insert()`: `attached_notes`, `validation_warnings`, `classifier_warnings`, `preamble_candidate_signals`. Authoritative source for `_run_parse_worker` and `test_parse_run._insert_rows`. `edit_log` (Slice A) is the 5th list-JSON field on BoQ Review Row but is NOT in `_LIST_JSON_FIELDS` (that constant is parse-worker scope only); `edit_log` is handled by `save_review_edit` directly. Do NOT add dict-type fields here.

**`boq:parse_run_done` realtime event** -- `user=`-targeted (unlike `boq:wizard_parse_done` which broadcasts). Success payload: `{status,boq_name,parsed_sheets,not_parsed_sheets,failed_sheets}`. Error payload: `{status,boq_name,error_code}`. Error codes: `missing_file`, `fetch_failed`, `no_eligible_sheets`, `parse_failed`, `internal`. **Payload contract is frozen** -- `_publish_parse_event` clears `parse_in_progress=0` before publishing (Bucket-2 Slice 1) but does NOT change any payload key or error code.

**`general_specs_sheets` empty guard (Slice 2c)** -- `assemble_mapping_config` builds `general_specs_sheet_names: set[str]` from child rows (`row.source_sheet_name for row in boq_doc.general_specs_sheets or []`). An empty child table produces an empty set; set membership check `sheet_name in general_specs_sheet_names` is safely False. `ParsedBoq.master_preambles: dict[str,str]` -- replaces `master_preamble: str|None`. Empty dict = no general-specs sheets parsed this run (does not blank existing child rows -- falsy-skip per row is preserved).

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
