<!-- Carved from .claude/context/domain/boq-backend.md on 2026-07-30 (structural carve).
     boq-backend.md is a router; this file holds the detail.
     Load when: Working on Revised BoQ or any ADR-0014 amendment -- entry, sheet mapping, column-diff carry, row match, commit overlay, cross-BoQ rate carry, Amendments B/C/D/E -->

## Revised BoQ entry (S2, ADR-0014 D1/D2, branch `feature/upload-revised-boq`)

`api/boq/wizard/revision.py` is the entry-surface owner for revisions:
- **`list_revisable_boqs(project)`** (whitelisted READ) — the picker source. Same project +
  `is_template_source=0`, **NO origin exclusion** (a committed revision is itself revisable —
  chains allowed), committed-ness via ONE `frappe.get_all("BoQ Committed Sheet Grid",
  {boq:["in",names], is_current:1}, distinct)` (the `commit_gate.get_committed_state` shape),
  `order_by uploaded_at desc`. Returns `{revisable:[{name,boq_name,version,uploaded_at}]}` —
  **filter, don't grey** (an empty list is the FE's signal to disable the Revise radio).
- **`_boq_has_committed_sheet(boq)`** — the committed-ness primitive.
- **`assert_revisable_source(source_boq, project)`** — the **single owning home** for D1
  eligibility (same project + ≥1 committed sheet), called by the upload endpoint. Distinct
  throws: not found / different project / not revisable.

`upload_file.upload_file()` reads `source_boq` from the form, rejects it alongside
`is_template_source` ("conflicting flags"), and re-validates via `assert_revisable_source`
(defence-in-depth over the already-filtered picker). `_upload_file_worker(..., source_boq=None)`:
a revision stamps `origin="revision"` + `source_boq`, **reuses the original's `boq_name`** so the
origin-agnostic `boqs.py before_insert` bumps `version` to N+1, and **skips the entire
`sheet_drafts` seeding loop + the Step-10.5 auto-guess** (`if not source_boq:`). E/F
(corrupted / zero-sheet) validation is unchanged; the non-revision path is byte-identical.

**Emergent marker (no 8th schema field):** an unconfirmed revision is exactly `origin=="revision"`
AND an empty `sheet_drafts` — S3's `confirm_revision_mapping` does the seeding after the human
confirms the sheet mapping. Tests: `test_revision_entry.py` (17). ⚠️ Pre-existing, NOT S2:
`test_upload_file.py` carries 8 `tempfile_path` errors (its tests target a fetch-refactored worker
signature this branch never received) — unchanged by S2.

## Revised BoQ sheet-mapping (S3, #1100, ADR-0014 D3/D4)

**Pure services `services/boq_revision/` (ADR-0010 B1 — residence b1 holds at 0):**
- **`normalize.normalize_n2(text)`** — the SINGLE N2 home (trim + lowercase + `str.split()`
  whitespace/nbsp fold; NO punctuation/synonym folding). Mirrors `_auto_guess._normalize` so a key
  matched here equals the same text keyed by the parser. Shared by D3/D5/D6 — do NOT fork.
- **`sheet_match.propose_pairing(revised, committed)`** — N2 + **per-key, per-side** count-guard →
  `PairingProposal(pairings:[SheetPairing(sheet_name, proposed_source|None, status)], self_collision)`.
  A key that self-collides on EITHER side (incoming workbook self-collision like `'SUMMARY '`/`'Summary'`,
  or an ambiguous committed side) routes to human without blocking other sheets; strict 1:1 falls out.
  It only PROPOSES — the human confirms.

**Endpoints in `revision.py`:**
- **`get_revision_mapping_proposal(boq)`** (whitelisted READ) — guards `origin=="revision"`; reads the
  revised workbook's tab names via `_read_revised_tab_names` (the S3-safe `_fetch_boq_file_to_tempfile` +
  `openpyxl(read_only=True).sheetnames` pattern — never a local path from `file_url`); reads the original's
  CURRENT committed sheets from the GRID tier (`BoQ Committed Sheet Grid` `is_current=1`; `sheet_disposition
  =="grid_only"` ⇒ general_specs) — the same committed-ness source S2 uses; cheap carry `COUNT`s (`BoQ Cell
  Pricing` current / `BOQ Nodes` current with non-blank `human_classification`, no parse). Returns Zone-1
  (`project`, `boq_name`, `source_version`, `committed_at`, `committed_sheets`, `carry_counts`) + Zone-2
  (`revised_sheets` in tab order with `proposed_source`/`status`/`general_specs`, `self_collision`).
- **`confirm_revision_mapping(boq, mapping)`** (POST) — write-once guard (rejects when `sheet_drafts` already
  populated — a second confirm is refused, `source_sheet_name` never mutates); **re-reads the workbook**
  (authoritative tab set/order, robust to a stale screen); validates cover-all-tabs + strict 1:1 + every claim
  is a real committed sheet; then **seeds** each tab as a `Pending` `BoQ Sheet Draft` (VERBATIM `sheet_name`,
  tab-order `sheet_order`, `source_sheet_name` write-once on mapped tabs — the CROSS-DOC pointer). A mapped tab
  whose original is general-specs carries the designation into `general_specs_sheets` (keyed by THIS doc's OWN
  name #152, blank `preamble_text` — re-extracts at parse) unless opted out. **S4 (below) decides each mapped
  DATA sheet's config carry + `wizard_status`** (`Config Done` clean / `Pending` unsafe); New + gs + no-config
  sheets stay `Pending`. `commit()` after the single save. Returns `{"status":"saved","seeded":N,"dispositions":[…]}`.
  **Two `source_sheet_name` fields are DISTINCT:** the Draft one points at the original; the general_specs child
  one is this doc's own name.

Tests: `test_revision_mapping.py` (17) + `services/boq_revision/test_normalize.py` (10) + `test_sheet_match.py`
(9). No regressions.

## Revised BoQ config column-diff carry (S4, #1101, ADR-0014 D5)

At seeding, a matched **DATA** sheet's columns are diffed against the original's committed grid; a structurally
clean sheet lands `Config Done` carrying the original's rectified role map, anything unsafe lands `Pending`. The
**seed is ALWAYS the original's rectified role map for BOTH dispositions** — only `wizard_status` differs — and
removed-mapped **flags, never auto-clears** (the seed keeps the dangling role). **NO new schema:** the disposition
rides `wizard_status` + the seeded `sheet_config`.

- **Pure `services/boq_revision/column_diff.py`** (B1): `diff_columns(role_map, original_header_cells,
  original_universe, revised_header_cells, revised_universe) → ColumnDiffResult(disposition {clean|unsafe}, reasons,
  dangling_roles, description_set_changed)`. Full-row **N2** header guard (compare where BOTH non-blank — a shift /
  mid-sheet insert-or-delete lands different text under the same letter → unsafe), new-column (revised non-blank
  header ∉ original universe → unsafe), removed-**mapped** (role-map col ∉ revised universe → unsafe + dangling),
  removed-**unmapped** (silent), **no-baseline** (empty original header ⇒ can't certify clean → unsafe — covers a
  template-origin original whose committed grid was inverted from the role map, so it carries no header row). Also
  the pure `summarize_columns(rows, header_row_numbers) → (header_cells, universe)`, shared by both sides so the
  extraction never forks. **`column_headers` is DEAD DATA — never read;** the baseline is the committed GRID.
- **Impure `api/boq/wizard/revision_carry.py`** (split from `revision.py`): frozen `CommittedDataSheet`
  (6-key seed blob + role_map + header_row/count — they travel together) + `SheetCarry`. `_committed_data_sheet`
  **inverts the commit snapshot** (`commit_pipeline._write_committed_boq_sheet` pins exactly `header_row /
  header_row_count / treat_as + column_role_map / column_headers / area_dimensions`; `sheet_name` OMITTED — the
  parser injects it at `_validate_sheet_blob`). `_original_header_cells` reads the committed grid header row(s) at
  `row_number == header_row .. +count-1`. `_read_revised_columns` **reuses the certified `sheet_preview.
  _extract_grid_rows`** (not re-implemented) + `summarize_columns`; the revised **universe keys off structural
  presence** (a real header cell even blank ∪ any data cell), NOT data alone, so a blank-but-present amount column
  in a fresh unpriced revision never false-flags as dangling. `carry_config_dispositions(source_boq,
  source_file_url, source_by_tab) → {tab: SheetCarry}`; a workbook-read failure degrades every matched sheet to
  `Pending` while STILL carrying the map (logged via `frappe.logger("boq_revision")`, not silent).
- **Diagnostics returned, NOT persisted:** `confirm_revision_mapping` returns `dispositions:[{sheet_name, status,
  reasons, dangling_roles, description_set_changed}]` per mapped data sheet. The **VISIBLE config-screen flag +
  config-time warning are SHIPPED on the frontend** (`SheetConfigPanel` re-derives them from the seeded map vs the
  loaded preview columns, revision-scoped, as a SOFT non-blocking flag — see the
  `boq-frontend-*` surfaces / `revisionConfigFlags.ts`).
- **Tests:** `services/boq_revision/test_column_diff.py` (17) + `api/boq/wizard/test_column_carry.py` (17, incl. a
  real-workbook read + the `dispositions` response). No regressions.

## Revised BoQ row-match + review carry (S6 = issue #1102 "S5a", ADR-0014 D6/D7)

At the post-parse merge seam, the revision's freshly-parsed rows are matched to the original's committed nodes and
the human's classification + parenting **overrides** carry forward. **Override-set only** (~87% of rows carry
nothing — the fresh parse reproduces the parser layer); the revised file stays authoritative for structure.

- **Pure `services/boq_revision/row_match.py`** (B1): `match_rows(original_rows, revised_rows) → RowMatchResult`
  over `MatchRow(row_id, description, order, level)`. N2-description buckets → the D6 outcome table verbatim
  (`N=1,M=1` MATCHED **section-ignored/rename-proof** · `N=M>1` section-then-physical-ordinal else AMBIGUOUS ·
  `N≠M` AMBIGUOUS · `N>0,M=0` REMOVED · `N=0,M>0` NEW). Section key = the pure `_section_keys` monotonic-stack walk
  (nearest preceding row at a strictly-shallower **numeric parser `level`**; both sides share the ADR-0009
  preamble-only-level convention). **`original_to_revised` (twin map) is keyed by the ORIGINAL row_id = the
  committed node NAME** — D7's parent re-point indexes `parent_node` (a node name) straight through it, so the
  ADR's "→ source_row_number →" hop is conceptual and node-name keying sidesteps any source_row_number
  non-uniqueness. Blank N2 keys are never matched.
- **Pure `services/boq_revision/carry.py`** (B1): `build_review_carry(revised_rows, original_by_id, match) →
  {row_id: ReviewCarryWrite}`. ⚠️ **AMENDED 2026-07-20 (owner-directed) — carries the EFFECTIVE value into the
  PARSER layer, superseding D7's "override set only".** From the committed node dict: `row_class` → the review
  row's `classification`; `parent_node` → `match.original_to_revised[twin]` → the twin's fresh `row_index` →
  `parent_index` — **never `sort_order`** (the original's row_index; deliberately not even read). A NULL
  `parent_node` is **effective root** ⇒ the explicit `-1` sentinel. A **missing parent twin** sets the advisory
  flag `parent_lost` and leaves the fresh parser's parent in place. **`level` is NEVER in the payload, and
  neither is any `human_*` field** (`ReviewCarryWrite` has no such field — both test-guarded). **Reads
  `row_class`, never `node_type`** (a lossy 3-value projection). **`Drifted` is RETIRED** (see below).
- **WHY the amendment (the bug it fixes, observed live):** commit writes `node.row_class =
  eff["effective_classification"]` (`:954`) and links `node.parent_node` from `eff["effective_parent_index"]`
  (`:862`), while `node.human_classification`/`human_parent` (`:996/:998`) hold only the RAW manually-typed
  layer. An **accepted Claude/Gemini suggestion** therefore lands on `row_class`/`parent_node` with the human
  fields blank/`-1` ⇒ the old override-set carry read NOTHING for it, and the `human_parent >= 0` re-point gate
  never fired. **Every AI-accepted classification and parent was silently dropped.**
- **WHY the PARSER layer, not the human layer:** `row_class` carries the full taxonomy but
  `_ASSIGNABLE_CLASSIFICATIONS` is only `{line_item, preamble, note, spacer}` — `subtotal_marker`/`header_repeat`
  may NEVER be written to `human_classification`; and `_row_has_override` keys on the human fields, so writing
  them would flip `has_override` true on every matched row and `_guard_row_at_parser_baseline` would block
  Apply-AI sheet-wide. Writing the parser layer means the row renders **"Original"** (calm), keeps the AI flow
  live, and lets a human edit / AI accept layer on top through the untouched `resolve_effective` precedence.
  **A matched row's parse baseline for the revision IS the original's accepted answer.**
- **`Drifted` RETIRED; TWO muted advisories instead.** Drift existed only to flag the hole override-only carry
  left; the effective carry closes it, so the status is never stamped (a legacy row falls through to "Original").
  Surfaced deltas = **`New` + `Ambiguous`** only. `revision_review_advisories(boq, sheet, source_boq) →
  {removed, parent_lost}` (**replaces `revision_removed_original_descriptions`**) returns both advisory sets from
  ONE match pass — `_build_carries` is the single carry-construction site shared with the write merge. Still a
  safe READ-TIME recompute: both depend only on descriptions, immutable post-parse. `get_review_rows`'s revision
  meta gains `parent_lost_count` / `parent_lost_descriptions` (same `_REVISION_REMOVED_SAMPLE_CAP`). Owner
  decision: **both stay muted PANEL LINES, never row badges** — this closes the prior OWNER-CONFIRM flag, which
  left the parent-lost case entirely silent.
- **Impure `api/boq/wizard/review_carry.py`:** `merge_revision_review_carry(boq, sheet_name, source_boq)` reads the
  just-inserted review rows (uncommitted, same txn) + the original's CURRENT committed `BOQ Nodes` for the mapped
  source (joined through the committed `BoQ Sheet` — nodes address the sheet by Link, not verbatim name), runs the
  pure match+carry, and stamps `revision_carry_status` + `classification`/`parent_index` via targeted
  `set_value(update_modified=False)` (no `edit_log` entry ⇒ the row never renders "Edited"). **The blank/spacer +
  every REMOVED original row are left UNSTAMPED** (the calm default; REMOVED has no revised row). Content-row
  filter runs once; `_summarize` is the single summary-shape site (`matched`/`new`/`ambiguous`/`parent_lost`/
  `removed` — no `drifted`). `revision_source_boq(boq)` = the origin gate (`origin=="revision"` AND `source_boq`).
- **The SEAM** (`parse_run._run_parse_worker`): inside the per-sheet `try`, **AFTER the review-row insert loop and
  BEFORE `_set_draft_status("Parsed")`**, gated on `revision_source_boq_name` (read once per parse). A non-revision
  parse never enters it → **byte-identical** (one extra read-only `get_value`, no data change). A merge that raises
  rides the existing compensating-delete + "Insert error" per-sheet failure channel (same transaction as the
  inserts, committed once at Step 7 before publish).
- **Verified inert:** a re-pointed row's stored `path` goes stale, but nothing reads it — commit rebuilds `path`
  from the effective tree (`commit_pipeline.py:886`) and the review UI derives depth from `effective_parent_index`.
  **No new schema** — the `Drifted` Select option is retained but never written.
- **Tests:** `test_row_match.py` (10) + `test_carry.py` (**16**) + `api/boq/wizard/test_review_carry.py` (**15**,
  integration). Every committed-node fixture now carries a **BLANK human layer** (the AI-accepted shape), so the
  suite fails if the carry ever regresses to reading `human_*`. No regressions (parse_run 102, review_screen 260,
  commit_pipeline 54, commit_validation 51, the full revision suite; vitest boq-wizard 594). Residence ratchet
  holds (b1 pure-purity 0). **Live E2E on a real revision still owed.**

## Revised BoQ commit overlay — formula/remark/color/category carry (S8 = issue #1104, ADR-0014 D8)

**Impure `api/boq/wizard/commit_overlay.py`** — `carry_commit_overlay(boq, sheet_name, dest_version,
dest_sheet_docname, grid_rows)`, wired into `commit_pipeline._commit_one_sheet` INSIDE `if disposition ==
"finalized":`, AFTER `_commit_node_tree` and before the trailing per-sheet commit (shares that transaction —
**no self-commit**). At a revision sheet's commit it silently carries the **re-arm-EXEMPT** layers onto the fresh
committed version + stamps the D2 provenance triple, so a committed revision arrives fully annotated, categorised
and formula-complete. A non-revision commit early-returns before any DML → **byte-identical**.

- **The re-arm taxonomy IS the carry taxonomy:** carries amount **formula** · **remark** · **color** ·
  **`remark` dismissal** · the whole **category** layer (machine + human). NEVER carries the re-armed set — the 4
  computed dismissals (`flag_kind == "remark"` filter excludes them) + the reconciliation choice (never read).
- **Provenance** (`source_boq`/`source_commit_version`/`source_sheet_name`) stamped on the committed `BoQ Sheet`
  via `set_value(update_modified=False)`, OUTSIDE any savepoint (must always land for S9). `source_commit_version`
  = the source's CURRENT committed version at carry time.
- **Excel-row twin map** = pure `row_match.match_rows` re-run over BOTH sides' committed `BOQ Nodes`, keyed by
  `source_row_number` (→ `source excel_row → dest excel_row`). Committed-effective `level` on both sides (feeds only
  the N=M>1 tiebreak; a mismatch degrades to AMBIGUOUS → the annotation drops SAFELY). Used for
  remark/color/dismissal/category; **formula does not use it** (logical axis).
- **Formula** re-validates against the DEST amount descriptors via the SHARED
  `pricing._formula_target_matches_column`; a match carries with `target_col` RE-RESOLVED from the matched dest
  descriptor (role **SWAP** correct for free), a no-match drops silently, an uncovered dest amount column stays
  uncovered → `_sheet_formulas_complete` false = **fail-closed**. `_next_formula_version` = 1 for the fresh triple.
  ⚠️ all live formulas are WILDCARD (value_key None).
- **Color** survivor set = the committed grid's column universe ∪ the dest `column_role_map` keys (S4's
  structural-presence reading — a mapped-but-empty column survives openpyxl's trailing-empty skip). **Category**
  written through the owner's new **no-commit `services/boq_category/persist.carry_row_categories`** (+
  `CARRY_READ_FIELDS`): a `write_row_categories`-shaped INSERT preserving the machine/human field split — **NEVER
  `set_human_verdict`** (would replicate the #1096 freeze bug inside carry). Per-discipline fan-out; NEW rows blank.
- **Best-effort PER LAYER (owner-chosen):** each layer runs in its own DB savepoint (`_guarded`, the
  `bulk_actions`/`create_itms` idiom, rollback-before-`log_error`) — a layer that raises rolls back only itself; the
  core commit + provenance always stand. A deliberate deviation from the ADR's atomic framing (module docstring).
- **Tests:** `test_commit_overlay.py` (18). No regressions (commit_pipeline 54, pricing 185, review_carry 10,
  row_category 26, classify 38, parse_run 102, review_screen 260, commit_validation 51). Residence ratchet holds.
  ⚠️ **PROD counts still owed** — dev matches the plan (Formula 46 / Remark 1 / Color 4 / Dismissal 0 / Recon 0 /
  Category 0). **S9 (cross-BOQ rate carry) is the next slice** — its formula gate depends on this carry.

## Revised BoQ cross-BOQ rate carry (S7a = issue #1105, ADR-0014 D9)

**The money — after a revision is committed, one explicit action pulls the ORIGINAL's rates across.** Not
net-new plumbing: it is `pricing.py`'s same-BOQ copy-forward classifier pointed cross-BOQ, wearing
`classify.py`'s Redis-marker long-job scaffolding. `BoQ Cell Pricing` needs **no migration** (`boq` is already
in its 5-part identity). Backend-only slice; the hub-footer action + grid amber-fill are S10 (#1106).
- **Pair-aware version guard (must-fix, `pricing.py`):** the two inline `from_version == current_version` throws
  (`get_copy_forward_plan`, `apply_copy_forward`) are extracted to the SINGLE home
  `pricing._assert_carry_versions_distinct(source_boq, source_version, dest_boq, dest_version)` — throws ONLY when
  `source_boq == dest_boq AND source_version == dest_version`. Same-BOQ copy-forward passes `(boq, from, boq, cur)`
  → **byte-identical** (still rejects `from == cur`); cross-BOQ v1→v1 across two BOQs now **passes** (the commonest
  case). Copy-forward regression: pricing 185 green.
- **Shared rate-carry resolver (`pricing._resolve_rate_carry_target`):** the CF3 rate-column re-resolution +
  priceability re-gate + clean-vs-conflict step is now ONE function called by BOTH `_build_copy_forward_plan` and the
  cross-BOQ `_classify_carry` — so the two carry paths **cannot drift** (the plan's "plan and apply must not drift").
  Returns `(target_col, skip_reason, dest_cell)`; reason STRINGS stay local (context phrasing). `allow_non_priceable`
  is NOT honoured on any carry path (hard skip).
- **Impure `api/boq/wizard/cross_boq_carry.py`:** `get_cross_boq_carry_plan(source_boq, source_version, dest_boq,
  sheet_names?)` (READ) + `start_cross_boq_carry(...)` (long job) + `get_cross_boq_carry_status(dest_boq)` (poll
  fallback). `_classify_carry(ctx, match)` is the SHARED classifier (plan + apply both re-derive it over a fresh D6
  match — client outcome/target-col/rate NEVER trusted; only `overwrite` is honoured, on a conflict). Plan is
  **source-driven** (iterate the original's `is_filled` cells) ⇒ D6 `NEW` rows never enter (their count is reported
  separately as `needs_new_value_count`, the S10 amber surface). **Destination-keyed** `(dest_excel_row, area,
  rate_kind)`; each entry carries both `source_excel_row` + `dest_excel_row` (they DIFFER under D6). Split skip
  taxonomy: `removed` (D6 REMOVED) / `ambiguous` (D6 AMBIGUOUS) / `no_rate_column` / `non_priceable` / `invalid`
  (apply-time) — hoisted to `_PLAN_SKIP_REASONS` (+ `invalid` = `_APPLY_SKIP_REASONS`).
- **D6 twin:** `commit_overlay.committed_excel_row_match` was promoted PUBLIC (returns the full `RowMatchResult` —
  the twin map PLUS `original_outcome`, needed to split removed vs ambiguous); `_excel_twin_map` is now a thin
  projection over it (one matcher, no duplicate — ADR-0010 "one owner").
- **Source resolution (server-authoritative):** per dest committed sheet, source = `BOQs.source_boq` +
  the committed `BoQ Sheet.source_sheet_name` provenance (S8-stamped; falls back to the draft pointer), read at the
  source sheet's **CURRENT committed version** (`is_current` — freshest rates, chain-aware, consistent with the
  overlay twin). The endpoint's `source_boq` is **validated** against the resolved original (reject a mismatch, never
  silently ignore); `source_version` stays advisory (per-sheet resolution). ⚠️ OWNER-CONFIRM: rates read from the
  source's `is_current` version, not the provenance-pinned `source_commit_version`.
- **Long-job worker `_carry_rates_worker`:** a LOOP over the selected sheets with **PER-SHEET failure isolation** —
  one `_guard_sheet_not_locked` → formula-complete gate → single-editor `acquire_or_refresh` → writes →
  ONE `frappe.db.commit()` per sheet, rollback-on-failure. A held lock / incomplete formulas / unexpected error fails
  **ONE sheet** (added to `failed` with a reason), never the batch. Terminal via `_publish_carry_event` (Redis status
  + clear marker + publish — commit-before-publish). Emits `boq:carry_rates_done {carried, failed}` (+ benign extras
  `conflicts_overwritten/kept`, `skipped`).
- **Tests:** `test_cross_boq_carry.py` (17) — every plan outcome, the moved-column re-resolution (target E not the
  source's D), NEW-row absence + count, conflict keep/overwrite, crafted-skip rejection, per-sheet formula-gate +
  held-lock isolation, the pair-guard (v1→v1 cross-BOQ accepted / same-boq same-version rejected), source_boq
  mismatch. No regressions (pricing 185, commit_overlay 18, review_carry 10, commit_pipeline 54, review_screen 260,
  parse_run 102, classify 38, commit_validation 51, revision suites). Residence ratchet holds (b1=0).
  **S10 (#1106, rate-carry FE) is the next slice.**

---

## Revised BoQ — Amendment B waves W3–W6 (2026-07-21, ADR-0014 A1/A2/A8/A10)

Waves W0–W2 (docs, matcher+carry, review screen) shipped earlier; see
`frontend/.claude/plans/boq-revised-upload-plan.md` for the full wave table and the W3–W6 as-built
narrative. This section holds the BACKEND contracts those waves changed.

### W6 — rate carry reads `is_current` CROSS-VERSION (A10)

**The defect.** Pricing identity includes `committed_version` (`pricing._IDENTITY_FIELDS`), so
`is_current` is scoped PER VERSION. Re-committing a sheet mints a new version and **orphans the
prior version's pricing onto the now-frozen one** (`commit_pipeline`'s `BOQ_DOWNSTREAM_ORPHAN`
guard warns, but never migrates). The cross-BOQ carry read its source strictly version-pinned, so
a source priced at v1 and re-committed to v2 carried **zero** while the mapping screen promised
rates. Live-observed on `BOQ-26-00023` / sheet `'LMS '`.

**New reader — `pricing.current_sheet_pricing_any_version(boq_name, sheet_name, current_version=None)`**
(NOT whitelisted). `is_current=1` across every `committed_version`, deduped per
`(excel_row, col_letter)` by preferring, in order:

1. the row on the sheet's **CURRENT committed version** — the `is_current=1` `BoQ Sheet`'s
   `commit_version`, i.e. the live sheet the user is actually looking at;
2. otherwise the highest `committed_version` (the newest stranded work);
3. `pricing_version` as the final tiebreak.

⚠️ **Anchored to the committed SHEET, not to `MAX(committed_version)`** (owner-directed). The two
are different questions: a bare max assumes the largest version number is the live one, which is
not authoritative — a pricing row stranded ABOVE the current sheet version (a superseded or
rolled-back commit) would then beat the price the user can actually see. Rule 1 makes the visible
price win by construction. `current_version` is resolved internally when the caller omits it;
None (no current committed sheet) degrades to rules 2–3. There is **no `is_latest` field** — the
one-current marker on `BoQ Sheet` is `is_current`.

⚠️ **`get_sheet_pricing` is UNCHANGED and must stay so** — it backs `get_priced_rows` and the
same-BOQ copy-forward, both of which are correctly pinned to one committed version.

⚠️ **Deliberate asymmetry — do NOT "fix" into symmetry.** RATES read cross-version; STRUCTURE
(nodes, descriptions, the D6 row match, `get_committed_rows_at_version`) stays per-commit. Pricing
is a living layer that keeps being edited after the structure freezes.

`cross_boq_carry._classify_carry` uses the new reader for the SOURCE side only. A plan row's
`source_version` now reports the version **the rate lives on**, not the sheet's current version
(sheet-level provenance stays `ctx.source_version` in the plan envelope).

**`revision._carry_counts(source_boq, source_sheet_names)`** — re-signed and rewritten on both
axes, because it was wrong on both:
- **scope** — only the originals a revised tab actually claims, general-specs excluded. On the
  mapping screen the drafts do not exist yet (an unconfirmed revision has empty `sheet_drafts`),
  so the caller passes the Zone-2 **proposed** pairing as the scope.
- **rates** — through the SAME `current_sheet_pricing_any_version` the carry uses (count and
  behaviour cannot drift), counting only `is_filled` (an unfilled current row is a CLEARED price
  and copies nothing).
- **classifications** — **`row_class`**, the committed EFFECTIVE value the carry copies (see
  `review_carry._NODE_FIELDS`). `human_classification` holds only the manually-typed layer and
  misses every AI-accepted decision, so it was never what carries.

⚠️ **KNOWN HOLE, owner call pending — the `commit_overlay` layers were NOT changed.** All five
carried layers (formula / remark / color / remark-dismissal / category) read pinned to
`ctx.source_version` and all five doctypes version-scope `is_current` identically, so they have
the same orphaning exposure. A10 scoped the owner's decision to RATES, and a stale remark or
category silently following a revision forward is arguably worse than one that does not.
`test_commit_overlay.TestCommitOverlayCrossVersionSource` pins this as known-wrong-on-purpose
(the `services/boq_revision/test_carry.py::TestKnownHole` convention).

⚠️ **CONFIRMED BY TEST, not by argument** — `test_cross_boq_carry.TestOrphanedFormulaBlocksTheRateCarry`
walks the whole chain on one fixture and asserts every link:

1. the source's formula EXISTS but is stranded on the frozen version (`_current_formula_records`
   at the current version returns `[]`);
2. W6 finds the rate cross-version;
3. the overlay carry copies **0** formulas forward;
4. the revision is therefore NOT formula-complete;
5. `_apply_sheet_carry` returns `formulas_incomplete` and the revision receives **no rate at all**.

The natural objection — "a rate can only be entered once a formula is declared, so a priced
source always has formulas" — is TRUE and is not a rebuttal: the formulas do exist, they are just
stranded on the same frozen version the rates were, so the version-pinned formula carry copies
none of them. **The annotation hole therefore defeats the W6 rate fix in exactly the scenario W6
was built for.**

✅ **OWNER DECISION 2026-07-21: leave it. The cross-version formula carry is DECLINED, not
pending.** A revision of a re-committed source will arrive not formula-complete and its rate carry
will report `formulas_incomplete`; the user re-declares the amount formula on the revision and
re-runs the carry. This is a known, accepted cost — do NOT "fix" it as a bug. If it is ever
revisited, links 3 and 5 of the test above are the assertions that flip; both are labelled.

### W4 — mapped sheets land `Pending`; work packages carry (A2)

`confirm_revision_mapping` splits what used to be one variable:
- `disposition_status` — the column-diff DIAGNOSIS (`Config Done` / `Pending`), reported in the
  returned `dispositions[]` and nowhere else.
- the persisted `BoQ Sheet Draft.wizard_status` — **always `"Pending"`**. A clean diff is
  evidence, not consent; the human attests every revised sheet exactly once.

`revision_carry.SheetCarry.status` is therefore a diagnosis only. `carry_config_dispositions`'
internal logic is unchanged — only its consumer moved.

**Work-package carry (ships WITH the above, not separable).** `revision_carry` gains:
- `read_committed_work_packages(source_boq, source_sheets) -> {sheet_name: [work_header]}` —
  direct `BoQ Sheet Work Package` read keyed by the committed sheet's docname (work packages are a
  GRANDCHILD table, never hydrated by `get_doc`). General-specs sources have no `BoQ Sheet` row and
  drop out. Sheets with no assignments are OMITTED, mirroring `get_boq_work_packages`.
- `carry_work_packages(draft_row_name, work_headers) -> int` — **must be called AFTER the parent
  `BOQs` save** (the child row has no docname before it, so this cannot ride `boq_doc.append`).
  Writes rows directly with explicit `parent`/`parenttype`/`parentfield`, the
  `update_sheet_draft.set_sheet_work_packages` precedent that never touches a doc holding a
  list-valued JSON field (the `doc.save()` / `delete_doc` wall).

Why they are inseparable: `SheetConfigPanel` disables the Config-Done attestation checkbox unless
the sheet has ≥1 work package. Landing every sheet at `Pending` without the carry would make every
revised sheet permanently un-attestable → un-parseable (`canParse` needs ≥1 marked sheet) →
un-committable.

### W3 — entry un-lock (A1)

**`controllers/boqs.next_boq_version(project, boq_name, is_template_source=False, exclude=None)`**
is now THE one owner of the version rule (`COALESCE(MAX(version), 0) + 1`). `before_insert` calls
it, and so does the conversion endpoint — which must recompute AFTER the fact, because converting
changes `boq_name` (a revision reuses the original's) and therefore the scope, long after
`before_insert` ran against the old one. **Do not re-inline this query.**

⚠️ `exclude` is load-bearing: the converting doc already EXISTS and already holds a version, so
counting itself would bump the number on every conversion, forever. On insert there is no docname
yet and the caller omits it, so insert behaviour is unchanged.

**`upload_file.append_sheet_drafts(boq_doc, reader, sheets)`** (pre-save) and
**`prefill_sheet_configs(boq_doc, reader)`** (post-save) extracted verbatim from
`_upload_file_worker`, so the fresh-upload path and the Revise→New re-seed share ONE
implementation.

> Pre-existing, untouched: `append_sheet_drafts` passes `"work_package": work_pkg` (singular).
> `BoQ Sheet Draft` has **no such field** (work packages are the `work_packages` grandchild table),
> so that auto-detect has never persisted and is inert. Preserved verbatim in the extraction —
> making it write for real would change fresh-upload behaviour, which is an owner-visible decision.

**`revision.convert_revision_entry(boq, mode, source_boq=None, file_name=None)`**
(`@frappe.whitelist(methods=["POST"])`). Flips a just-uploaded BoQ between New and Revision in BOTH
directions. Idempotent (converting to the current mode re-validates and returns without writing).
Returns `{status, origin, source_boq, boq_name, version, seeded}`.
- `mode="revise"` — requires `source_boq`, re-validates via `assert_revisable_source` (the D1 rule
  keeps one owner), adopts the original's `boq_name`, DROPS the seeded drafts. An unconfirmed
  revision is marked by exactly `origin=="revision"` AND empty `sheet_drafts` (S2's emergent
  marker), so dropping them is required, not incidental.
- `mode="new"` — clears `source_boq`, restores the filename-derived `boq_name`, re-seeds drafts
  from the workbook via the shared helpers.
- Guarded by `_assert_entry_still_convertible`: rejects a template SOURCE, anything committed,
  anything parsed/parsing, and a revision whose mapping is already CONFIRMED (`source_sheet_name`
  is write-once by D3 — delete + re-upload is the escape hatch).
- Grandchild `BoQ Sheet Work Package` rows are deleted explicitly before clearing their parents;
  they do NOT cascade off a parent save.

⚠️ **`file_name` is the CLIENT's original filename and is the only exact source** for the restored
New name. Frappe **uniquifies** a colliding upload (`my_boq_file.xlsx` → `my_boq_filef57551.xlsx`),
so reading `File.file_name` back reproduces the hash suffix — observed in test. The upload screen
holds the true name in its store (`droppedFile.name`). Server-side fallbacks (File row, then URL
basename) remain for a direct API call; the field is user-editable, so a slightly-off name beats
throwing.

⚠️ **Import cycle:** `upload_file` imports `assert_revisable_source` from `revision`, so
`revision` must import `upload_file` **inside** `convert_revision_entry`, not at module level.

### W5 — reporting (A8)

Two numbers that were computed and then discarded now ride their existing payloads. Both keys are
**ABSENT on a non-revision flow**, so those payloads stay byte-identical.

| Surface | Key | Shape |
|---|---|---|
| `boq:parse_run_done` (success) | `revision_carry` | `{sheet_name: {copied, needs_review, total}}`, sheet_name VERBATIM (#152) |
| `commit_boq` → each `committed[]` entry | `revision_overlay` | `{provenance, formulas, remarks, colors, remark_dismissals, categories}` |

`revision_overlay` is nulled when the summary is falsy or `provenance` is 0 — i.e. a non-revision
sheet, or a revision sheet with nothing to carry, reports nothing rather than a row of zeros.
Before this, a FAILED overlay layer surfaced ONLY in the Error Log (`commit_overlay._guarded`
swallows the exception and returns 0).

**Retired `"ambiguous"` skip reason DROPPED** from `cross_boq_carry._PLAN_SKIP_REASONS`,
`boqTypes.ts`, `CrossBoqCarryDialog.tsx` and the fixtures **together** — a backend-only removal
would have left the frontend summing `undefined`. Amendment B collapsed the match to
"paired or not", so `removed` is now the single not-carried reason.

### Test-fixture generation is idempotent (2026-07-21)

`services/boq_parser/tests/fixtures/generate_synthetic.py` `_save()` now **skips a fixture that
already exists**. `test_parse_run` (5 `setUpClass` calls), `test_reader` and `test_classifier` all
call `generate_all()`, so merely RUNNING those suites used to rewrite all 11 tracked `.xlsx`
fixtures. Content was always identical, bytes were not — every run left 11 modified files in the
working tree, which buries real changes and invites committing them by accident.

Pinning the document timestamps is NOT sufficient (measured): an `.xlsx` is a zip, and both the
zip's per-member dates AND some of openpyxl's XML element ordering vary **between processes** (the
latter tracks `PYTHONHASHSEED` — stable within a process, different across runs). So the committed
fixtures are treated as the artifact: present means authoritative. A MISSING fixture is still
generated, so a fresh checkout works. To genuinely regenerate after changing a fixture's shape:
`generate_all(force=True)` or `python generate_synthetic.py --force`, which deletes them first.

⚠️ `generate_synthetic.py` lives INSIDE the fixtures directory, so
`git checkout -- .../tests/fixtures/` reverts the GENERATOR too. Restore only `*.xlsx`.

> Unrelated pre-existing breakage found while verifying this: `api/boq/wizard/test_upload_file.py`
> passes `tempfile_path=` to `_upload_file_worker`, which has never accepted that kwarg — 8 errors
> at HEAD, untouched by this work.

---

## ⚠️ ADR-0014 Amendment E (2026-07-28) — the layers come back, opt-in + attributed

**Owner-directed reversal of Amendment D.** `cross_boq_carry.apply_sheet_carry` takes `layers` again
and moves rates **plus** any ticked subset of the four row-addressed layers. Amendment D's objection
was that carried records arrived **un-asked-for** and **un-attributed**; Amendment E answers both,
and a restoration with only one of them would reproduce the original defect.

**The COMMIT seam is UNCHANGED** — a revision commit still stamps the D2 provenance triple and
carries nothing. Everything here is the explicit per-sheet action.

### Schema (3 MIGRATE-carrying additions)

| Doctype | Added |
|---|---|
| `BoQ Row Category`, `BoQ Cell Remark`, `BoQ Cell Color`, `BoQ Cell Dismissal` | `carry_provenance_section` + `carried_from_boq` / `carried_from_version` / `carried_at` |
| `BoQ Sheet` | `sheet_config_snapshot` (JSON, nullable) — the R2 lossless config snapshot |

### The engine

- `committed_carry.LAYER_KEYS = ("categories", "remarks", "colors", "remark_dismissals")`;
  `walk_layers(ctx, choices, *, apply)` is the **single dispatch point** for both the plan
  (`apply=False`) and the write (`apply=True`), so a layer cannot be planned one way and applied
  another. An absent / `carry:False` layer is skipped entirely and **omitted from the result**, so
  the summary reports what actually ran instead of rows of zeros.
- `persist.carry_row_categories(boq, sheet_name, committed_version, rows, *, source_boq,
  source_version, overwrite=False)` — **the provenance stamp is KEYWORD-REQUIRED**, so no code path
  can produce an unstamped carried record. A caller wanting an unstamped write wants
  `write_row_categories`. ⚠️ **Do not soften this to an optional kwarg.**
- `persist.eligible_excel_rows` reuses the existing `_ELIGIBLE_NODE_TYPES`, so eligibility keeps
  **one owner** (ADR-0010 B2).
- **Destination-eligibility guard (NEW code, not restored):** write only where the *destination* row
  is Line Item / Preamble. The old commit-seam carry structurally could not hit this (its
  destination was always freshly parsed); a post-commit carry can, and a category on a non-eligible
  row pollutes both the grid and the classifier's evaluation corpus.
- Only `flag_kind == "remark"` dismissals carry (the four computed kinds acknowledge conditions a
  revision recomputes). Colours survive only if the physical column **letter** survives.
- Unknown layer keys are **dropped silently** in `_coerce_layers`, so a layer that exists on one
  side of the wire but not the other cannot break the call — no lock-step deploy.
- Layers ride the **same transaction** as the rates: one commit, one rollback.

> ⚠️ **The carried `human_verdict_at` keeps the SOURCE's (older) timestamp — never freshen it.**
> `resolve_row_ladder` breaks a human-vs-human tie across disciplines on the *most recent* verdict,
> so keeping it old is exactly what makes a verdict made **on the revision** outrank a carried one,
> with **no precedence code anywhere**. Pinned by
> `test_human_verdict_timestamp_is_carried_verbatim_not_freshened`.

### The category gate moved (reverses G2c, cross-BoQ only)

`categories_incomplete` is removed from `_APPLY_BLOCK_MESSAGE` / `_APPLY_BLOCK_TITLE`. Once the
action carries categories, gating it on categories being complete blocks its own remedy: a freshly
committed revision has **zero** category rows, so the gate is shut, so the carry that would populate
them cannot run — and a revision containing one genuinely new line item could never satisfy a
post-carry re-check either.

⚠️ **Both KEEP the gate; `save_cell_price` untouched, `apply_copy_forward`'s REORDERED (Amendment F).**
The gate stops a *hand-typed* rate landing on an uncategorised row; a carry moves known values from
a known-good source. **Do not "restore consistency" by re-adding it to the carry path** —
`test_h_categories_block_is_gone_from_the_message_family` guards the message maps and a re-added
branch will `KeyError` loudly, which is intended.

⚠️ **Do not widen `LAYER_KEYS` to include `formulas`** — `test_an_unknown_layer_key_is_dropped_silently`
uses it as the unknown-key example and would silently stop testing anything. (That is exactly what
happened to its predecessor when R5 implemented `remarks`.)

### Two supporting fixes that rode this work

**R1 — Frappe STRIPS every value in an `["in", [...]]` filter** (`frappe/model/db_query.py`:
`value = [escape((cstr(v) or "").strip()) for v in values]`). An `=` comparison is **not** stripped,
which is why only this side broke. Sheet names carry real leading/trailing whitespace (`#152
sheet_name VERBATIM`), so `read_committed_work_packages` silently dropped every whitespace-bearing
sheet — and a revision sheet with no work package can never be attested, parsed or committed.
**Second and worse blast site:** `revision._carry_counts` used the identical filter while
`_resolve_sheet_carry` (an `=` read) went ahead and carried, so the mapping screen reported **0**
carryable rates for those sheets and the carry delivered anyway — the `count == carry` invariant
failing in the direction W6 never covered (**122 rates / 87 classifications** under-reported on
`BOQ-26-00099`). Fixed by one shared `revision_carry.current_committed_sheets(boq, sheet_names,
fields)` that filters names **in Python**, used by both call sites — which is what
`cross_boq_carry._dest_committed_sheets` already did correctly.

**R2 — lossless committed config snapshot.** `_write_committed_boq_sheet` pinned only **6** config
keys, and `revision_carry._committed_data_sheet` seeds a revision by **inverting that snapshot**, so
anything outside the 6 could not carry. Measured across 865 configured draft sheets:
`top_header_rows_override` **46**, `skip_top_rows_after_header` **44**, `skip_row_definitions` **13**
non-default values, all silently reset on any revision. ⚠️ **Merge rule, load-bearing in both
directions:** the snapshot supplies only the EXTRA keys and the six columns are re-applied on top
and stay authoritative — `treat_as` in particular is derived from the commit **disposition**, so a
snapshot that won could seed `master_preamble` onto a data sheet and drop it out of the parse.
`sheet_name` is stripped. **FORWARD-ONLY:** already-committed sheets keep a NULL snapshot and the
six-key fallback permanently (their draft blobs may have drifted since commit).

### Verification

880 backend tests green across the 17 BoQ suites; 1061 vitest across 45 files; `tsc` clean;
`residence_check.py` holding at 40/0/8/116/207. Every slice was checked by **deliberately breaking
the fix and confirming the tests caught it** — which found that `test_snapshot_sheet_name_is_stripped`
had been *passing against a broken reader* (it asserted an absence with no proof the source ever
contained the thing), and that `test_commit_pipeline`'s `_CFG` fixture contained **only the six keys
that survived commit**, making the config loss structurally invisible.

⚠️ **Prod is not migrated.** Three migrations ride these commits — a prod deploy needs
`bench --site <site> migrate` **before** any commit/carry runs, or writes fail on missing columns.

---

## ⚠️ SUPERSEDED 2026-07-28 by Amendment E (above) — retained as the record of WHY the layers were removed, which is why they returned opt-in + attributed

## ⚠️ ADR-0014 Amendment D (2026-07-23) — the per-sheet carry moves RATES ONLY

**Owner-directed reversal of Amendment C's annotation carry.** `cross_boq_carry.apply_sheet_carry`
now writes rates and nothing else. Remark / colour / `remark` dismissal / category are never copied
between a revision and its original by any seam.

**Why.** A carried remark is indistinguishable in the pricing editor's Review block from one written
on the revision itself — both render as the same grey `Note` entry with no provenance — so the carry
silently grew the revision's review list with the original author's text, and with Overwrite armed
it superseded the reviewer's own remark at the same row. Observed on `BOQ-26-00269` / `FDA`: two
carried remarks, one replacing a hand-written one (`row7 v1` frozen, source text inserted as `v2`).

**Deleted (do not reintroduce).**

| File | Removed |
|---|---|
| `committed_carry.py` | `LAYER_KEYS`, `_AnnotLayer`, `_ANNOT_LAYERS`, `_CarryCtx`, `build_carry_ctx`, `carry_layers`, `plan_layer_counts`, `_walk_layers`, `_walk_annot_layer`, `_walk_category_layer`, `_zero_layer_outcome`, `_source_filters`, `_dest_current_map`, `_dest_max_version_map`, `_dest_column_letters`, `_dest_column_universe` — the module is now provenance stamp + excel-row twin match only (575 → 158 lines) |
| `cross_boq_carry.py` | `_plan_layer_counts`, `_coerce_layers`, the `layers` param on `apply_sheet_carry`, the `layers` key on the plan payload, `summary.setdefault("layers", {})` |
| `services/boq_category/persist.py` | `carry_row_categories`, `CARRY_READ_FIELDS`, `current_category_keys` — their only caller was the category layer |

**Kept, and load-bearing.** `stamp_revision_provenance` (the rate carry resolves its source through
it) and `committed_excel_row_match` (the Amendment B D6 match the rate plan is derived from).
Formulas still never carry and `_sheet_formulas_complete` still gates the whole action.

**Wire tolerance.** A stale client POSTing `layers` is harmless: the whitelisted HTTP path routes
through `frappe.call`, which filters kwargs to the signature. ⚠️ A *direct Python* call with
`layers=` raises `TypeError` — the tolerance is a property of the HTTP seam only, and
`test_a_stale_client_posting_layers_still_carries_rates_only` drives `frappe.call` for that reason.

**No schema change, no migration.** All four annotation doctypes keep their own endpoints and
freeze-and-supersede lifecycles; only the cross-BoQ copy is gone. Annotations already carried by an
Amendment C build are left in place — removing the feature does not retroactively un-write them.

**Tests.** `test_committed_carry.py` (967 → 690) keeps its rich fixtures and INVERTS them: the
source still seeds every annotation kind across a role SWAP, a dropped column, a removed row and a
two-engine category fan-out, and now asserts none of it lands. `TestCarryLayersPresenceAndOverwrite`
deleted; `TestCommitOverlayShiftStopsCarry` re-pointed at `_excel_twin_map` directly. 22 tests green.
`test_cross_boq_carry.py`: 40 green, incl. `test_a_carry_writes_no_annotation_of_any_kind`.

---

## ⚠️ ADR-0014 Amendment C (2026-07-23) — the commit carries nothing; carry is per-sheet

Owner-directed reversal of **D8** + re-siting of **D9**. Slices C1–C6, commits `8c60a25f`,
`f57a91b2`, `cf7dc2a5`, `580d113c`, `6453a3fd`, `0855527e`, `081de0f8` (`feature/upload-revised-boq`,
local/UNPUSHED). Full slice detail: `frontend/.claude/plans/boq-revised-upload-plan.md`.

**This supersedes the S8 (commit overlay) and S9 (cross-BOQ rate carry) sections above, and the
"KNOWN HOLE, owner call pending" note about the version pin — that hole is closed by REVERSING the
W6 rate read rather than widening the layers.**

### `commit_overlay.py` → `committed_carry.py`

- **`carry_commit_overlay` → `stamp_revision_provenance(boq, sheet_name, dest_sheet_docname) -> int`.**
  It stamps the D2 triple and stops. `_carry_formulas` and `_guarded` are **deleted**; the
  `revision_overlay` key is gone from `_commit_one_sheet`'s envelope (and from the frontend, same commit).
  ⚠️ **The stamp must stay** — `cross_boq_carry._resolve_sheet_carry` reads `source_sheet_name` off the
  committed `BoQ Sheet` to find the source at all.
- **The layer engine** (new): `LAYER_KEYS` = remark / colour / `remark` dismissal / category, one
  parametric `_walk_annot_layer` over an `_ANNOT_LAYERS` spec table + `_walk_category_layer`.
  `carry_layers(ctx, choices)` writes; `plan_layer_counts(ctx)` walks with `apply=False` so plan and
  apply cannot drift. `build_carry_ctx(...)` is the public keyword-only ctx factory.
- **Buckets:** `carried` (dest empty) / `replaced` (taken + overwrite) / `kept` (taken, overwrite off) /
  `unmatched` (no twin) / `dropped` (colour letter gone).
- ⚠️ **Version = `max(prior) + 1`, never a hardcoded `1`** — a frozen prior can exist with no current
  (`save_row_remark`'s CLEAR branch). This REVERSES `persist.carry_row_categories`'s documented
  *"the dest triple is brand new → no prior current to freeze"* contract, which held only at the commit seam.
  `persist.current_category_keys` is the presence map; the machine/human field split is preserved through
  an overwrite (never `set_human_verdict` — that is #1096's freeze bug).
- Colours read the persisted `BoQ Committed Sheet Grid Row` when `grid_rows=None` (post-commit).
- A classification-frozen dest sheet skips the CATEGORY layer only (defence in depth; the endpoint gates too).

### `cross_boq_carry.py` — per-sheet + synchronous

- **`apply_sheet_carry(dest_boq, sheet_name, decisions, layers)`** — whitelisted POST, SYNCHRONOUS,
  ATOMIC (one lock acquire, one commit, full rollback). `layers` = `{key: {carry, overwrite}}`;
  `_coerce_layers` DROPS an unknown key rather than throwing. Gate blocks map to user-facing throws via
  `_APPLY_BLOCK_MESSAGE` / `_APPLY_BLOCK_TITLE`.
- `_apply_sheet_carry(..., layers=None)` writes the layers inside the rates' transaction, using the SAME
  match the rates were classified against.
- `get_cross_boq_carry_plan` gains per-sheet `layers`: `{carryable, present, unmatched, dropped}`
  (from the overwrite-off walk, so counts are toggle-independent).
- **REMOVED (C6):** `start_cross_boq_carry`, `_carry_rates_worker`, `get_cross_boq_carry_status`,
  `_publish_carry_event`, the BOQ-scoped Redis marker/status block, `_coerce_decisions`, and the
  `boq:carry_rates_done` event. The marker was BOQ-scoped — a latent defect per-sheet (sheet B's poll
  would have reported sheet A's run).

### The rate read is VERSION-PINNED again (C2b) — reverses Amendment B W6 / A10

`_classify_carry` reads the source via `pricing.get_sheet_pricing(committed_version=ctx.source_version)`.
**`revision._carry_counts` is pinned identically, in the same commit** — the count == carry invariant W6
established is intact; only which side it sits on changed. ⚠️ **Never pin one without the other:** that
divergence IS the W6 defect (`BOQ-26-00023` / `'LMS '` promising 3 rates and carrying zero).
`pricing.current_sheet_pricing_any_version` had no production caller left and was **deleted**; restoring W6
means restoring it from history and repointing both call sites.

**Accepted cost:** a source sheet priced BEFORE its last re-commit has its rates orphaned on the frozen
version and carries zero. Now VISIBLE (count 0, empty plan, button reads "Nothing left to carry from the
original") rather than silent. Repair = *Copy rates forward* on the original first.
`test_cross_boq_carry.TestCrossVersionSourcePricing` keeps W6's exact fixture with assertions inverted.

**Suites at C6:** `committed_carry` 36 · `cross_boq_carry` 40 · `commit_pipeline` 55 · `pricing` 185 ·
`revision_mapping` 26 · `revision_entry` 32 · `revision_review` 31 · `review_carry` 24 · `commit_gate` 33 ·
`review_screen` 260 · `classify` 38 · `column_carry` 27 · `commit_validation` 51 · `parse_run` 110 — all OK.

---
