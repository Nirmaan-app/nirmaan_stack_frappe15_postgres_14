# Revised BoQ — Implementation Plan

**Status:** S1–S11 **AS-BUILT** (#1098–#1107, branch `feature/upload-revised-boq`, local/unpushed) —
then **partially superseded by ADR-0014 Amendment B (2026-07-20, owner-directed)**. The carry rework
waves **W0–W6** are at the end of this doc; read them **before** trusting S6/S7's as-built detail, which
Amendment B replaces. S1–S5 and S8–S11 stand.
**Design of record:** [`docs/adr/0014-boq-revised-upload-and-carry.md`](../../../docs/adr/0014-boq-revised-upload-and-carry.md)
(D1–D9 + the schema table). **Full argument, rejected alternatives and live-data measurements:** the wayfinder
map [#1086](https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/issues/1086) and its resolution
comments on T1–T8 (#1087–#1094). This plan does **not** restate the reasoning — it slices the build.

**The feature:** upload a revised workbook against an already-committed BOQ and walk the wizard so only the
**deltas** need human attention; everything that still matches carries forward.

---

## The spine principle — why this slices cleanly

**A revision is a tagged fresh upload, and every carry is additive on top of it.**

Slices 1–3 land a revision that behaves *exactly like a fresh upload* but carries provenance
(`origin="revision"`, `source_boq`, `source_sheet_name`). Slices 4–10 then add one carry layer at a time, in
**pipeline order** (config → rows → annotations → money). **Every slice is independently shippable and safe:
if you stop after slice N, the user gets a correct BOQ that simply carries less.** Nothing half-carries.

That property is not an accident of the slicing — it falls out of ADR-0014 **D2's parse-authoritative
overlay**: the revised file is the source of truth for all structure, so an absent overlay is a *no-op*, never
a corruption.

---

## Execution Strategy

Execute via the Plan-to-Parallel workflow (see `~/.claude/CLAUDE.md`). This section is authoritative and must
survive context clearing — the waves and dependencies below drive `TaskCreate → TaskUpdate (dependencies) →
parallel subagents (subagent_type=general-purpose)`.

**Dependency graph**

```
S1 (schema + origin-gate audit)
 └─► S2 (entry: radio + picker + revision create)
      └─► S3 (mapping BE: N2 + proposal + confirm + seeding)
           ├─► S4 (config carry + column diff)        [T5]
           ├─► S5 (mapping screen FE + hub gate)      [T4]
           └─► S6 (row match + review carry)          [T3+T6]
                ├─► S7 (review delta surfacing FE)    [T6]
                └─► S8 (commit overlay: formula/remark/color/category)  [T8]  (also needs S4)
                     └─► S9 (cross-BOQ rate carry BE) [T7]
                          └─► S10 (rate carry FE)     [T7]
ALL ──► S11 (E2E verify)
```

**Waves**

- **Wave 1 (blocking):** S1 — schema + migrate + the `origin` gate audit. Everything reads the new fields.
- **Wave 2:** S2 — entry + revision create (needs the fields).
- **Wave 3:** S3 — the mapping backend + seeding (needs a revision doc to map).
- **Wave 4 (parallel, 3 subagents):** S4, S5, S6 — independent units touching different files.
- **Wave 5 (parallel, 2 subagents):** S7 (needs S6), S8 (needs S6 + S4).
- **Wave 6:** S9 — rate carry backend (**must** follow S8: without formulas at commit it is DOA).
- **Wave 7:** S10 — rate carry frontend.
- **Wave 8:** S11 — E2E verification.

Create all tasks with `TaskCreate`, set `addBlockedBy` per the graph, then launch each wave's unblocked tasks
as parallel subagents. **Every subagent prompt must include the why** (this plan's intent + the spine
principle), the exact files, **the ADR-0014 decision id it implements**, and the test/verify expectation.

---

## Delta lists (the whole build surface)

### Schema — 7 fields, 4 doctypes, all additive + nullable + inert for existing flows

| Doctype | Field | Type | ADR |
|---|---|---|---|
| `BOQs` | `origin` | Select — **add `revision`** to `upload\ntemplate` | D2 |
| `BOQs` | `source_boq` | Link → BOQs (model on the existing `source_template`, `boqs.json:198-205`) | D2 |
| `BoQ Sheet Draft` | `source_sheet_name` | Data, nullable, **write-once** | D3 |
| `BoQ Sheet` | `source_boq` | Link → BOQs | D2 |
| `BoQ Sheet` | `source_commit_version` | Int | D2 |
| `BoQ Sheet` | `source_sheet_name` | Data, nullable, **write-once** | D3 |
| `BoQ Review Row` | `revision_carry_status` | Select: *(blank)*/`Matched`/`New`/`Ambiguous`/`Drifted` | D7 |

**D5 / D8 / D9 add none.** `BoQ Cell Pricing`, the four annotation layers and `BoQ Row Category` all already
carry `boq` in their identity tuples ⇒ cross-BOQ writes need **no migration**.

> ⚠️ **Repo rule:** doctype JSON is not hand-edited — add via Desk/bench tooling, then
> `bench --site localhost migrate`, then verify each with `frappe.db.has_column` (**passing tests do not prove
> the runtime DB has the column** — tests use a separate auto-migrated DB).

### Backend — new module `nirmaan_stack/api/boq/wizard/revision.py`

| Endpoint | Purpose | ADR |
|---|---|---|
| `list_revisable_boqs(project)` | eligibility = same project + ≥1 committed sheet (compute via the `get_committed_state` shape — `BOQs.status` is unusable) | D1 |
| `get_revision_mapping_proposal(boq)` | Zone-1 identity + carry counts; Zone-2 N2 + per-side count-guard pairing proposal | D3 |
| `confirm_revision_mapping(boq, mapping)` | validate strict 1:1 + no unmatched; **seed the drafts**; stamp `source_sheet_name` write-once; carry general-specs designation | D3/D4 |

### Backend — changes to existing modules

| File | Change | ADR |
|---|---|---|
| `upload_file.py` | accept `source_boq`; revision branch creates the `BOQs` doc (`origin="revision"`, same `boq_name`) and **skips draft seeding** | D2/D3 |
| `parse_run.py` | the **post-parse merge seam** — after the insert loop, before `_set_draft_status("Parsed")` | D7 |
| `commit_pipeline.py` | the **silent commit overlay** (formula · remark · color · `remark` dismissal · category); stamp `source_boq`/`source_commit_version`/`source_sheet_name` on the committed `BoQ Sheet` | D2/D8 |
| `pricing.py` | `get_cross_boq_carry_plan` + `start_cross_boq_carry` + `_carry_worker`; **fix the `from_version == current_version` guard** → `(boq, version)`-pair aware (`:2506`, `:2658`) | D9 |
| `update_sheet_draft.py` | dangling-role flag folded into the attestation gate | D5 |
| `review_screen.py`, `template_select.py`, `commit_pipeline.py`, `export_writeback.py` | **audit every `== "template"` / `!= "template"` gate** — a `revision` origin currently falls into the *upload* branch by default | D2 |

### Backend — new pure services (`nirmaan_stack/services/boq_revision/`)

Per ADR-0010 **B1** (a named calculation gets a pure module — no `frappe.db`, no request ctx) and **B2**
(one accessor per shape). All unit-tested with fixtures — these are logic-bearing, so **no stubs**.

| Module | Owns |
|---|---|
| `normalize.py` | **the N2 normalizer** — the single home shared by rows (D6), sheets (D3) and headers (D5). One home, no fork. |
| `sheet_match.py` | D3's pairing proposal: N2 + **per-side** count-guard, strict 1:1 |
| `column_diff.py` | D5: grid-header read, full-row guard, column-universe diff, dangling-role detection, disposition |
| `row_match.py` | D6: description-primary + section tiebreak + count-guard → **MATCHED / NEW / REMOVED / AMBIGUOUS** |
| `carry.py` | D7/D8 payload builders (override set, relational re-point, formula re-validate, category field-split) |

### Frontend (`frontend/src/pages/boq-wizard/`)

| Component | Change | ADR |
|---|---|---|
| `BoqMasterPanel.tsx` | New\|Revise radio (default New) + inline `react-select` original picker; empty-state disables the radio | D1 |
| `BoqUploadScreen.tsx` | Continue gate gains "original selected"; `source_boq` in the upload POST | D1 |
| **NEW** `RevisionMappingPage.tsx` (+ `RevisionIdentityPanel.tsx`, `SheetPairingRow.tsx`) | the always-shown screen between upload and hub | D3 |
| `routesConfig.tsx` | new `lazy()` route `/upload-boq/revision/:boqId/map` (module exports `Component`) | D3 |
| `BoqHubPage.tsx` | unconfirmed-revision redirect gate; removed-sheet advisory; **"Carry rates from original"** footer action; `boq:carry_rates_done` socket + on-mount recovery + reconnect self-heal + results modal | D3/D4/D9 |
| `SheetConfigPanel.tsx` | dangling-role flag; description-set-change warning | D5 |
| `ReviewTree.tsx` | Status column gains New/Ambiguous/Drifted; needs-action panel (R4 shape); filter; "no deltas" chip; removed-row advisory line | D7 |
| **NEW** `CrossBoqCarryDialog.tsx` | whole-BOQ plan/apply (CopyForwardDialog-shaped, but multi-sheet) | D9 |
| `PricingGrid.tsx` | CL-6 amber attention-fill + filter on **unpriced priceable rate cells** | D9 |

---

## Slice detail

### S1 — Schema + `origin` gate audit (Wave 1) `[backend]`
**Why:** every other slice reads these fields; additive and inert, so it ships safely on its own.
- Add the 7 fields from the table above via bench tooling; `bench --site localhost migrate`; verify each with
  `frappe.db.has_column`.
- **Audit every `== "template"` / `!= "template"` gate** (`review_screen.py:829`, `template_select.py:167-168`,
  `commit_pipeline.py:504`, `export_writeback.py:461`): a `revision` origin currently falls into the *upload*
  branch by default. **Confirm per site that the upload branch is the correct home for a revision** — do not
  assume; a revision *is* an upload in every one of these, but that must be verified, not inherited.
**Done:** columns exist on the runtime DB; every existing flow byte-unaffected (blank/default preserves
today's behaviour); the gate audit is written up in the commit body.

**AS-BUILT (S1, `feature/boq-revised-upload` off the T9 synthesis branch):** 7 fields added to the 4 doctype
JSONs (`BOQs.origin` gains `revision` + `source_boq`; `BoQ Sheet Draft.source_sheet_name`;
`BoQ Sheet.source_boq`/`source_commit_version`/`source_sheet_name`; `BoQ Review Row.revision_carry_status`) —
all additive, nullable, `read_only`, no behaviour-changing default. `bench migrate` applied on dev; all 7
confirmed on the runtime DB via `has_column` + ORM Meta. **Gate audit found 6 production gates, not the 4
cited** — the plan missed `review_screen.py:2918-2919` (finalize A2 qty gate) and `template_rows.py:84-85`
(`_guard_template_write`); every one routes `revision` → the non-template/upload branch correctly (full
per-site write-up in the commit body). FE `origin === "template"` gates (SheetReviewPage/BoqHubPage/
sheetCardStages/SheetCard) also default revision to the upload branch — revision-specific FE lands in S2/S5,
untouched here. Non-revision suites green: `test_pricing` 185, `test_review_screen` 250, `test_commit_pipeline`
54 (the 3 `test_update_sheet_draft` errors are a pre-existing stale `work_package`-column fixture, identical on
baseline). **Note:** the dev bench's main app checkout is on `chore/context-hygiene` (develop-based, lacks the
create-from-template stack), so migrate/verify was run by materialising the 4 JSONs into the app path in-container
then restoring; the create-from-template test suites (`test_create_from_template`/`test_template_*`) can only run
once the bench app dir is on this build branch.

### S2 — Entry: Revise radio + eligibility + revision create (Wave 2) `[backend+frontend]`
**Why (D1/D2):** the user-facing entry, and the `BOQs` doc every later slice hangs off.
- **BE** `revision.py::list_revisable_boqs(project)` — same project + ≥1 committed sheet, computed via the
  `get_committed_state` shape (`commit_gate.py:202`, `:258-260`). **Filter, don't grey.** **Chains allowed** —
  no `origin` exclusion.
- **BE** `upload_file.py` — accept `source_boq`; when set, create the `BOQs` with `origin="revision"`,
  `source_boq`, and **the same `boq_name` as the original** so `boqs.py before_insert` auto-bumps `version` to
  N+1. **Skip the draft-seeding loop** (S3 owns seeding). Keep the E/F workbook validation exactly as today.
- **FE** radio in `BoqMasterPanel` (default New, Revise reveals the picker inline); options
  `{boq_name} — v{version}` + muted `uploaded {date}`, **latest-uploaded first**; inline `useFrappeGetDocList`
  mirroring `BoqProjectTab`/`NewMilestones` (**no shared ProjectSelector**). Continue gate += "original
  selected" with the missing-item tooltip. The top-level `Upload | Template` toggle is **untouched**.
**Tests:** eligibility predicate (partial commit qualifies; a never-committed BOQ is absent; a committed
revision *is* listed); version auto-bump on shared `boq_name`; a revision upload seeds **zero** drafts.
**Ships as:** a revision `BOQs` doc with provenance and no sheets — the hub redirect (S5) is what makes it
usable, so **S2 + S3 + S5 are the minimum shippable set**.

**AS-BUILT (S2, `feature/upload-revised-boq`, #1099):** BE — new `api/boq/wizard/revision.py` owns the
entry surface: `list_revisable_boqs(project)` (whitelisted read; same project + `is_template_source=0`, **no
origin exclusion** so chains list, committed-ness via one `BoQ Committed Sheet Grid`/`is_current=1` query,
`order_by uploaded_at desc`; returns `{revisable:[{name,boq_name,version,uploaded_at}]}`), plus
`_boq_has_committed_sheet` and `assert_revisable_source(source_boq, project)` — the **single owning home** for
D1 eligibility, called by the endpoint (missing / different-project / uncommitted each throw distinctly).
`upload_file.upload_file()` reads `source_boq` from the form and (belt-and-suspenders) re-validates; the
worker gained `source_boq=None` → stamps `origin="revision"` + `source_boq`, **reuses the original's
`boq_name`** (so the origin-agnostic `before_insert` bumps version N+1), and **skips the whole seeding loop +
Step-10.5 auto-guess** (the `if not source_boq:` guard keeps the non-revision path byte-identical). E/F
(corrupted / zero-sheet) validation runs unchanged; a template-source + `source_boq` combo is rejected.
FE — store gains `revisionMode`/`sourceBoq` (+ `setRevisionMode` clears the pick when leaving revise; `reset`
clears both, `resetUpload` preserves them via shallow-merge). `BoqMasterPanel` renders the New | Revise radio +
inline `react-select` (`getSelectStyles`, two-line option label + muted `uploaded {date}`); empty-eligible-list
disables Revise; radio+picker lock once `uploadStatus !== "idle"` (entry is baked into the created doc).
`BoqDropZone` sends `source_boq` and **holds a file dropped before the pick** (`pendingFileRef` + a deferred
effect) so drop/pick are order-independent (D1). `BoqUploadScreen` Continue gate adds `needsOriginal`. The
top-level Upload | Template toggle (`BoqPickerPage`) is untouched. Tests: `test_revision_entry.py` 17 green
(eligibility/ordering/chains/template+other-project exclusion/shape; N+1 bump; zero-drafts; byte-identical
non-revision seeding; 3 endpoint guards). No regressions: create_from_template 35 / commit_pipeline 54 /
review_screen 260 / pricing 185 green; residence baselines hold; FE boq-wizard vitest 540 green (run in the
Linux container — the host's `node_modules` carries only linux-arm64 rolldown bindings). **Pre-existing, NOT
S2:** `test_upload_file.py` has 8 `tempfile_path` errors (its tests target a fetch-refactored worker signature
this branch never received) — count unchanged by S2.

### S3 — Mapping backend: N2 + proposal + confirm + seeding (Wave 3) `[backend]`
**Why (D3/D4):** the pairing authority and the seeding the whole carry hangs off.
- **`services/boq_revision/normalize.py`** — the N2 normalizer: trim ends + collapse internal whitespace runs
  to one space + nbsp/unicode fold + **case-insensitive**. **No punctuation or synonym folding.** This is the
  **single home** for D3/D5/D6 — do not fork it.
- **`services/boq_revision/sheet_match.py`** (pure) — N2 pairing + **PER-SIDE count-guard** (route to human
  when *either* side's N2 keys are non-unique: the committed tier is clean, but **the incoming workbook is
  draft-shaped and can self-collide** — `BOQ-26-00006` holds both `'SUMMARY '` and `'Summary'`). Strict 1:1.
- **`revision.py::get_revision_mapping_proposal(boq)`** — reads the revised workbook's tab names + order, the
  original's committed sheets, and returns Zone-1 (identity + committed-sheet list + **carry counts**: cheap
  `COUNT`s on `BoQ Cell Pricing` and on `BOQ Nodes` with non-blank `human_classification` — **no parse**) plus
  the Zone-2 proposal.
  **⚠️ S3 safety rule:** read the workbook bytes via the `NamedTemporaryFile` pattern — **never** build a local
  path from `file_url` (`frappe_s3_attachment` rewrites it after insert; see root `CLAUDE.md` § BoQ File
  Reading). Tab names only: `load_workbook(read_only=True).sheetnames`.
- **`revision.py::confirm_revision_mapping(boq, mapping)`** — validates strict 1:1 + **hard-stops on any
  unmatched sheet** (explicit original *or* declared New; no silent fallback), then **seeds the drafts**:
  every tab as a draft at its **verbatim** `sheet_name` + `sheet_order`; `source_sheet_name` stamped
  **write-once** on mapped ones; general-specs designation carried for sheets that were general-specs in the
  committed original (blank `preamble_text` — it always re-extracts at parse). **All statuses land `Pending`
  in this slice** — S4 is what upgrades a clean matched sheet to `Config Done`.
**Mechanical call this slice makes (inside D3's lock, not a new decision):** D3 locked *"seeding must wait for
the human"*. This plan implements that as **`upload_file` seeds nothing for a revision, and
`confirm_revision_mapping` does the seeding**. ⇒ **the unconfirmed-revision marker is `origin=="revision"` AND
`sheet_drafts` is empty** — no 8th schema field. Unambiguous: a fresh upload always seeds, and a confirmed
revision always has ≥1 draft (a zero-sheet workbook is error F, rejected upstream).
**Tests:** N2 (`'SUMMARY '`/`'Summary'` collapse; `'Electrical'` vs `'Electrical 2'` **never** merge);
per-side count-guard fires on a self-colliding workbook; strict 1:1 rejects a double-claimed original;
unmatched without a declaration is refused; `source_sheet_name` write-once (a second confirm is rejected);
seeding is idempotent under a double-fire.

**AS-BUILT (S3, #1100 = plan S3 + plan S5 — mapping backend + screen + hub gate):**
- **Pure services `services/boq_revision/` (ADR-0010 B1, residence b1 holds at 0):** `normalize.py::normalize_n2`
  — the SINGLE N2 home (trim + lowercase + `str.split()` whitespace/nbsp fold; NO punctuation/synonym folding),
  mirrors `_auto_guess._normalize` byte-for-byte. `sheet_match.py::propose_pairing(revised, committed)` —
  N2 + **PER-KEY PER-SIDE** count-guard (a self-colliding key routes to human without blocking other sheets)
  → `PairingProposal(pairings:[SheetPairing(sheet_name, proposed_source|None, status)], self_collision)`; strict
  1:1 falls out (a clean committed side has unique keys). `test_normalize` 9 + `test_sheet_match` 9 green.
- **`revision.py` endpoints:** `get_revision_mapping_proposal(boq)` (READ) — guards origin=="revision"; reads
  revised tab names via the `_fetch_boq_file_to_tempfile` + `openpyxl(read_only=True).sheetnames` pattern
  (S3-safety, `_read_revised_tab_names`); reads the original's CURRENT committed sheets from the GRID tier
  (`BoQ Committed Sheet Grid` `is_current=1`, `sheet_disposition=="grid_only"` ⇒ general_specs — matches S2's
  committed-ness source + the test fixture); cheap carry `COUNT`s (`BoQ Cell Pricing` current / `BOQ Nodes`
  current with non-blank `human_classification`, no parse); returns Zone-1 (`project`, `boq_name`,
  `source_version`, `committed_at`, `committed_sheets`, `carry_counts`) + Zone-2 (`revised_sheets` in tab order
  with `proposed_source`/`status`/`general_specs`, `self_collision`). `confirm_revision_mapping(boq, mapping)`
  (POST) — write-once guard (rejects when `sheet_drafts` non-empty); re-reads the workbook (authoritative tab
  set/order); validates cover-all-tabs + strict 1:1 + every claim is a real committed sheet; **seeds** each tab as
  a `Pending` draft (VERBATIM `sheet_name`, tab-order `sheet_order`, `source_sheet_name` write-once on mapped);
  carries general-specs designation into `general_specs_sheets` (keyed by THIS doc's own name, blank
  `preamble_text`) for a mapped tab whose original is general-specs unless opted out. `test_revision_mapping` 16
  green (Zone-1 identity+counts, Zone-2 pre-fill/self-collision/gs-carry, real workbook read, all confirm guards +
  write-once + JSON-string mapping). **The two `source_sheet_name` fields are DISTINCT** (Draft = cross-doc
  pointer at the original; general_specs child = this doc's own name).

### S4 — Config carry + column diff (Wave 4) `[backend]`
**Why (D5):** carries the rectified role map so a clean matched sheet needs no config visit.
- **`services/boq_revision/column_diff.py`** (pure): baseline = the committed **GRID**
  (`BoQ Committed Sheet Grid Row.cells` at `row_number == BoQ Sheet.header_row`) for the column universe **and
  the real header text** + the committed `column_role_map` for roles. **`column_headers` is dead data (548/554
  empty, structurally — no writer exists anywhere). Do not read it.**
- **Full-row header guard** — compare **every** column present on either side, **mapped or not**, wherever both
  texts are non-blank; a blank on either side is **silent on that column**; **N2 verbatim**.
- **Dispositions** (all unsafe branches converge): guard mismatch / new column / removed **mapped** column →
  **`Pending` + seed** (the carve-out from D4); removed **unmapped** → silent no-op; **structurally clean →
  `Config Done`, no prompt**.
- **The seed is ALWAYS the original's rectified role map — NEVER a fresh auto-guess.** `_auto_guess` provably
  cannot reproduce a rectified config (its own `_SINGLETON_ROLES` copy wrongly includes `description`).
- **Dangling-role flag** (role-map keys absent from the revised universe) — a **new, distinct check** of the
  same *shape* as the existing `hasStrandedRoles` (`SheetConfigPanel.tsx:700-708`, which is a **different**
  check — per-area role on a single-area sheet). **Flag, never auto-clear.**
- Wire into `confirm_revision_mapping`'s seeding: the disposition sets the draft's `wizard_status`.
**Tests:** a shifted column trips the guard → `Pending`; an appended column → `Pending`; a removed mapped
column → `Pending` + flag; a removed unmapped column → silent; a clean sheet → `Config Done` with the
rectified map intact; a **blank-header** column never mismatches; a renamed *unmapped* column **does** flag
(the accepted false positive).
**Emergent, no rule needed:** a title row inserted above the header makes the carried `header_row` point at the
wrong row ⇒ the guard mismatches ⇒ `Pending` + seed ⇒ the human fixes `header_row`. **The failure degrades
into the safe branch.**

**AS-BUILT (S4, #1101):**
- **Pure `services/boq_revision/column_diff.py`** (ADR-0010 B1): `diff_columns(role_map, original_header_cells,
  original_universe, revised_header_cells, revised_universe) → ColumnDiffResult(disposition, reasons,
  dangling_roles, description_set_changed)`. Full-row N2 guard (blanks silent) + new-column + removed-mapped
  (dangling) + removed-unmapped (silent) + **no-baseline ⇒ unsafe** (a template-origin original whose committed
  grid was inverted from the role map carries no header row ⇒ can't certify clean ⇒ `Pending`). Also the pure
  `summarize_columns(rows, header_row_numbers) → (header_cells, universe)`, shared by BOTH sides so the
  header/universe extraction never forks. **`column_headers` is never read** — the baseline is the committed GRID.
- **Impure reader/orchestrator `api/boq/wizard/revision_carry.py`** (split out of `revision.py` so each module
  changes for one reason; `revision.py` 694→466 lines): frozen `CommittedDataSheet` (the 6-key seed blob +
  `role_map` + `header_row`/`header_row_count`, which travel together) and `SheetCarry`. `_committed_data_sheet`
  inverts the commit snapshot (`commit_pipeline._write_committed_boq_sheet` pins exactly `header_row /
  header_row_count / treat_as + column_role_map / column_headers / area_dimensions`; `sheet_name` omitted — the
  parser injects it). `_original_header_cells` reads the committed grid header row(s). `_read_revised_columns`
  **reuses the certified `sheet_preview._extract_grid_rows`** (no re-implemented skip logic) + `summarize_columns`;
  the revised **universe keys off structural presence** (a real header cell, even blank, ∪ any data cell) — NOT
  data alone — so a blank-but-present amount column in a fresh unpriced revision never false-flags as dangling.
- **Wired into `confirm_revision_mapping`:** `carry_config_dispositions(source_boq, source_file_url, source_by_tab)`
  runs per mapped **DATA** tab (general-specs + New sheets excluded). The **seed is ALWAYS the original's rectified
  role map** for both dispositions; only `wizard_status` differs (clean → `Config Done`, unsafe → `Pending`).
  Removed-mapped **flags, never auto-clears** (the seed keeps the dangling role). A workbook-read failure degrades
  every matched sheet to `Pending` while STILL carrying the map (logged via `frappe.logger("boq_revision")`, not
  silent). **No new schema** — the disposition rides `wizard_status` + the seeded `sheet_config`.
- **Diagnostics returned, not persisted:** confirm's response gains `dispositions: [{sheet_name, status, reasons,
  dangling_roles, description_set_changed}]` per mapped data sheet.
- **FRONTEND surfacing (SHIPPED):** the pure `revisionConfigFlags.ts` (`computeDanglingRoles` /
  `hasDanglingDescription`, F4 — unit-tested) re-derives the dangling roles on the config screen from the seeded
  role map vs the columns present in the loaded preview (`SheetConfigPanel.allColumns`). **REVISION-ONLY** (keyed off
  the new `sourceSheetName` prop = `BoQ Sheet Draft.source_sheet_name`, so the normal upload flow is byte-identical)
  and a **SOFT flag** (per-column `border-destructive` + inline message, same shape as `hasStrandedRoles`, but does
  NOT block Config Done — the WINDOWED preview can't authoritatively prove a column is gone, so a false positive must
  never trap the user) + an amber config-time **warning banner** in Section 3 (names the dropped columns; calls out a
  Description-set change). Empty preview ⇒ no flag (never flag before the columns load). `BoQSheetDraft.source_sheet_name`
  widened in `boqTypes.ts`.
- **Tests:** `services/boq_revision/test_column_diff.py` (17 — 13 diff + 4 `summarize_columns`) +
  `api/boq/wizard/test_column_carry.py` (17 — seeding integration incl. a real-workbook read + the `dispositions`
  response). No regressions (revision_mapping 17 / revision_entry 17 / sheet_match 9 / normalize 10 / revision_schema
  15 / commit_pipeline 54 / parse_run 102 / pricing 185 / review_screen 260 green). The 3 `test_update_sheet_draft`
  errors are the PRE-EXISTING legacy `work_package`-migration fixture, unrelated to S4.

### S5 — Mapping screen + hub gate (Wave 4) `[frontend]`
**Why (D3):** the F1 + F2 controls. **Always shown** on a revision; a fresh upload never sees it.
- New route `/upload-boq/revision/:boqId/map` (RR v6 `lazy()`, module exports `Component`).
- **Zone 1 — "What you're revising" (the F2 control):** identity + committed sheets + **carry counts**
  (*"…will carry 1,234 rates and 89 classifications"*). **Not** a restatement of the pick — it must show what
  they *didn't* see at pick time.
- **Zone 2 — the pairing (the F1 control):** revised sheets in **tab order**; **pre-filled** where the proposal
  is confident, **blank + hard stop** where unmatched or guard-refused; strict 1:1 (an original claimed once);
  live unclaimed-originals tail (*"3 of 5 originals claimed — 'Preamble' and 'Make List' won't carry"*);
  unmatched dropdown = **plain, ordered by the original's `sheet_order`, NO fuzzy**.
- **Everything editable. Nothing binds until Confirm** — the screen is a staging area; irreversibility begins
  **at Confirm, not per click**. No per-override confirm dialog (friction on the rare deliberate act; dialogs
  train dismissal).
- **Hub gate:** `BoqHubPage` redirects to the mapping route when `origin==="revision"` and `sheet_drafts` is
  empty.
**Verify:** a fresh upload never routes here; a revision cannot reach the hub unconfirmed; an unmatched sheet
blocks Confirm; claiming an original twice is refused; back-nav routes **by entity id, never `navigate(-1)`**.

**AS-BUILT (S5, shipped WITH S3 under #1100):**
- **Route** `/upload-boq/revision/:boqId/map` (RR v6 `lazy()`, `RevisionMappingPage` dual-exports `Component`),
  added as a sibling right after the hub route in `routesConfig.tsx`.
- **`BoqHubPage` gate:** after the `!boq` guard, `origin==="revision" && sheet_drafts empty` → `<Navigate replace>`
  to the map route (declarative, not imperative-in-render). `boqTypes.BOQsDoc.origin` widened to include
  `"revision"` + a `source_boq?` field. S2's Continue still lands on the hub, which now intercepts unconfirmed
  revisions — no `BoqUploadScreen` nav change needed.
- **Pure helper `revisionMapping.ts` (ADR-0010 F4):** client-side bookkeeping ONLY — `NEW_SHEET`/`UNDECIDED`
  sentinels, `initDecisions` (matched pre-fill else undecided), `claimed/duplicate/unclaimedOriginals`,
  `isMappingComplete` (the Confirm gate = no undecided + no double-claim), `toConfirmPayload`. **N2 lives only in
  Python** — the helper never re-derives it (consumes the backend's `proposed_source`). `revisionMapping.test` 10
  green.
- **Screen:** `RevisionMappingPage` (orchestrator) + `RevisionIdentityPanel` (Zone-1 F2 control: identity +
  committed-sheet badges + "will carry N rates and M classifications") + `SheetPairingRow` (Zone-2 F1 control:
  react-select of originals + "Declare as a New sheet", amber highlight on undecided rows, general-specs toggle
  when the chosen original is general-specs). Decisions are seeded ONCE from the proposal (ref-guard, so an SWR
  revalidation never clobbers edits); everything editable, nothing binds until Confirm; Confirm → hub by entity id.
  Self-collision banner when the proposal flags it. shadcn primitives only; inline errors via `getFrappeError`
  (no toast). Full boq-wizard vitest **550 green** (540 baseline + 10); host `tsc` clean in touched files;
  residence baselines hold.

### S6 — Row match + review carry (Wave 4) `[backend]`
**Why (D6/D7):** the heart — it preserves the human's classification and re-parenting across a shifted file.
- **`services/boq_revision/row_match.py`** (pure): bucket both sides by **N2-normalized joined `description`**;
  N=1/M=1 → **MATCHED** (section ignored — the forced pairing is rename-proof); N=M>1 → section-header +
  physical-ordinal tiebreak, else **AMBIGUOUS**; N≠M → **AMBIGUOUS**; N>0/M=0 → **REMOVED**; N=0/M>0 → **NEW**.
  Section = the nearest preceding row in **physical (`source_row_number`) order** at a **strictly shallower
  stored parser `level`** (both parser-native ⇒ human-edit-immune). Original's **stored** `description` vs the
  revised side's **parsed** one. `description_parts_raw` stays **display-only — never identity**.
- **The merge seam** — inside `run_parse_worker`'s per-sheet `try`, **after** the review-row insert loop and
  **before** `_set_draft_status(..., "Parsed")` (`parse_run.py:846-869`). Runs only when
  `BOQs.origin == "revision"`; otherwise a **no-op**. The existing compensating delete (`:879`) already cleans
  up a failed merge, and `parse_failure_category: "Insert error"` is the ready-made durable failure channel.
- **Payload — the override set ONLY** (read from the original's committed `BOQ Nodes`, source sheet =
  `source_sheet_name`):
  - `human_classification` non-blank → `human_classification`. **Read `row_class`, never `node_type`** (a lossy
    3-value projection).
  - `human_parent >= 0` ⇒ resolve `parent_node` → the parent's `source_row_number` → the D6 twin → the twin's
    **`row_index`**. **Never `sort_order`** (that is the *original's* `row_index` — a trap).
  - `human_is_root = 1` (`parent_node IS NULL`) ⇒ `human_is_root=1` + `human_parent=-1`. **Root ≠ no-parent.**
  - **Write `-1` explicitly** for no-override (Frappe coerces Int `None`→`0`, and `0` is a valid `row_index`).
  - **Do NOT carry `level`** (ADR-0009 — re-derive via `derive_effective_levels`, or the `BOQ Nodes`
    controller's Preamble/Line-Item throws fire).
  - A missing twin (the override row's **or** its parent target's) ⇒ that row's parenting → review.
- **Drift detection:** MATCHED + **no** carried override + original effective `row_class` != the revision's
  fresh parser `classification` ⇒ **`Drifted`**.
- Stamp `revision_carry_status` per row (`Matched`/`New`/`Ambiguous`/`Drifted`; **`REMOVED` is never a value** —
  it is an *original*-side outcome and surfaces as the panel's advisory line).
**Tests:** the PCC worked example (re-parented row's override lands on the twin's new `row_index` after an
insert shifts it); root override; `-1` sentinel written, never null/0; `level` absent from the payload;
missing-twin → parenting to review; a duplicate cluster at N=M pairs k-th↔k-th; N≠M → all AMBIGUOUS; a
section **rename** at N=1/M=1 still MATCHES; drift detected; **a non-revision parse is byte-identical**.
**Known holes (measured, documented, not designed around):** 11 `spacer` overrides (grid-only ⇒ no node to
read), 3 synthetic rows, 41 `is_excluded` rows.

**AS-BUILT (S6 = issue #1102 "S5a", `feature/upload-revised-boq`):**
- **Pure `services/boq_revision/row_match.py` (ADR-0010 B1, residence b1 holds at 0):** `match_rows(original_rows,
  revised_rows) → RowMatchResult` over `MatchRow(row_id, description, order, level)`. N2-description buckets →
  the D6 outcome table verbatim (`N=1,M=1` MATCHED section-ignored / `N=M>1` section-then-ordinal else AMBIGUOUS
  / `N≠M` AMBIGUOUS / `N>0,M=0` REMOVED / `N=0,M>0` NEW). Section key = the pure `_section_keys` monotonic-stack
  walk (nearest preceding row with a strictly-shallower numeric parser `level`; both sides share the ADR-0009
  preamble-only-level convention). **The twin map (`original_to_revised`) is keyed by the ORIGINAL row_id = the
  committed node NAME**, so D7's parent re-point indexes `parent_node` (a node name) straight through — the ADR's
  "→ source_row_number →" hop is conceptual, and node-name keying sidesteps any source_row_number non-uniqueness.
  Blank N2 keys are never matched. `test_row_match` 10.
- **Pure `services/boq_revision/carry.py` (B1):** `build_review_carry(revised_rows, original_by_id, match) →
  {row_id: ReviewCarryWrite}`. Reads the override set from the committed node dict: `human_classification`
  (non-blank) carries; `human_is_root` → `is_root=1 + human_parent=-1` (root precedence, mirrors
  `resolve_effective`); `human_parent >= 0` → `parent_node` → `match.original_to_revised[twin]` → the twin's fresh
  `row_index` (**never `sort_order`** — it is deliberately absent from the node read). **`level` is NEVER in the
  payload** (`ReviewCarryWrite` has no such field, test-guarded). Drift = a MATCHED row that carried NOTHING
  (`carried_nothing`, the literal reading of "no carried override" — a row that carried any override is a calm
  Matched, so Edited/Drifted stay disjoint) whose committed `row_class` ≠ the fresh `classification`. `test_carry` 12.
- **Impure `api/boq/wizard/review_carry.py`:** `merge_revision_review_carry(boq, sheet_name, source_boq)` reads
  the just-inserted review rows (uncommitted, same txn) + the original's CURRENT committed `BOQ Nodes` for the
  mapped source (joined through the committed `BoQ Sheet` — nodes address the sheet by Link, not name; reads
  `row_class` NEVER `node_type`), runs the pure match+carry, and applies `revision_carry_status` + the override
  set via targeted `set_value(update_modified=False)`. Content-row filter runs once (`content_rows`). Returns a
  count summary (`_summarize`, single site). `revision_source_boq(boq)` is the origin gate (`origin=="revision"`
  AND `source_boq`). **The merge SEAM** (`parse_run._run_parse_worker`) sits inside the per-sheet `try`, AFTER the
  review-row insert loop and BEFORE `_set_draft_status("Parsed")`, gated on `revision_source_boq_name` (read once
  per parse). A non-revision parse never enters it → byte-identical (only one extra read-only `get_value`). A merge
  that raises rides the existing compensating-delete + "Insert error" failure channel. `test_review_carry` 10
  (integration: statuses, classification carry, parent re-point to the twin's new index, root, plain-matched,
  blank-spacer no-stamp, summary counts, the origin guard, unmapped no-op).
- **Tests:** all green in-container. No regressions: parse_run 102, review_screen 260, commit_pipeline 54, the
  full revision suite (normalize 10 / sheet_match 9 / column_diff 17 / revision_entry 17 / revision_mapping 17 /
  column_carry 17 / revision_schema 15). Residence ratchet holds (b1 pure-purity 0). Both /code-review axes actioned
  (Standards dedupe + summary-site cleanup + var renames; Spec confirmed faithful on all 7 invariants).
- **⚠️ OWNER-CONFIRM (Spec-review flag, not a bug):** the **missing-parent-twin** row (D7 "→ review") drops the
  uncarried parent and stays `Matched` (calm) — its parenting reverts to the parser and is surfaced INDIRECTLY via
  S7's removed-parent advisory, NOT via a dedicated needs-action status (D7 offers no status for "parent lost", and
  the marks are only New/Ambiguous/Drifted). Faithful to the spec as written; flag for owner if a direct alert was
  intended. **S7 (review delta FE) is the next slice** — it consumes `revision_carry_status`.

### S7 — Review delta surfacing (Wave 5) `[frontend]`
**Why (D7):** the human must see the small set that matters — and **only** it.
- **Carried rows get NO treatment** — the calm default, visually identical to an untouched row. ~90% of rows
  carry; marking them paints the sheet. (Also forced: **every colour channel is already taken** — backgrounds
  green/indigo/violet/amber/muted, rings=search, left-border=Gemini, opacity=excluded.)
- **Status column** gains New/Ambiguous/Drifted, slotted into the existing 4-way if/else:
  `Accepted·Claude` > `Accepted·Gemini` > `Edited` > **New/Ambiguous/Drifted** > `Original`. A carried row
  renders `Original` for free (a *fallthrough*, not a stored state) — accepted: it means "you haven't touched
  this", which is true. **This design adds no column.**
- **Needs-action = `revision_carry_status in (New, Ambiguous, Drifted) AND NOT isEdited`** — **self-clearing**
  (CL-6's pattern). **Do not add clearing code.**
- **Panel** reuses the **R4 warnings-panel** shape verbatim (`ReviewTree.tsx:1685-1830`): one clickable entry →
  `revealAndScrollToRow`, count + cleared-rollup header. The **removed-row advisory** rides it as a muted
  non-clickable line.
- **Filter** mirrors `passesFilter` exactly: `"all"` sentinel, `xFilterActive` header tint, one early-return.
  **Two interlocks:** add the state to the `searchHits` dep array (`:1645`), and keep `searchHits` composing
  over `classificationVisible && passesFilter` so **a hit can never be a filtered-out row**.
- **"No deltas" chip** = `revision_carry_status` is `Matched` for every row ⇒ panel goes green
  (*"No deltas — 14 of 14 rows carried from v3."*).
- **Finalize stays ADVISORY — do NOT add a second gate.** `structural_errors_for_sheet` +
  `check_structural_integrity` remain the only hard backstop, **unchanged**.
**Verify:** a zero-delta sheet shows the green chip and no marks; a new row is listed and drops off the moment
it's edited; the filter and search compose; an upload-origin review screen is **byte-identical**.

### S6+S7 AMENDMENT — effective-value carry (owner-directed, 2026-07-20) `[backend+frontend]`

**Supersedes the "override set only" rule in S6 and the `Drifted` surfacing in S7.** Design rationale +
the full objection-by-objection reversal live in the **ADR-0014 D7 amendment block**; this is the as-built.

**Root cause it fixes (observed live by the owner).** `commit_pipeline` writes the EFFECTIVE values to
`node.row_class` (`:954`) and `node.parent_node` (via `eff_parent_by_idx`, `:862`) while
`node.human_classification` / `human_parent` (`:996/:998`) keep only the raw manually-typed layer. An
**accepted Claude/Gemini suggestion** therefore lands on `row_class`/`parent_node` with the human fields
blank/`-1` ⇒ the override-set carry read nothing, and the `human_parent >= 0` re-point gate never fired.
Every AI-accepted classification and parent was silently dropped.

**New rule (pure `services/boq_revision/carry.py`):** on a MATCHED row carry `row_class` → the review row's
`classification` and `parent_node` → D6 twin → the twin's `row_index` → `parent_index` (`parent_node` NULL =
effective root ⇒ explicit `-1`). **The PARSER layer, never the human layer** — `subtotal_marker`/`header_repeat`
are not in `_ASSIGNABLE_CLASSIFICATIONS` so they could never ride `human_classification`, and writing `human_*`
would flip `_row_has_override` true sheet-wide and block Apply-AI. `ReviewCarryWrite` now has **no `human_*`
field at all** (test-guarded), alongside the existing no-`level` guard.

- **`Drifted` RETIRED** — it only flagged the hole the override-only carry left; the effective carry closes it.
  Never stamped again; a legacy row falls through to "Original". Surfaced deltas = **`New` + `Ambiguous`** only.
- **`parent_lost`** (new, advisory-only): a MATCHED row whose original parent has no twin. The parenting is not
  re-pointed (keeps the fresh parser's parent) and the row stays a calm `Matched`. **Closes S6's open
  OWNER-CONFIRM flag**, which left this case entirely silent.
- **Both advisories are MUTED PANEL LINES, never row badges** (owner decision). `revision_review_advisories`
  replaces `revision_removed_original_descriptions`, returning `{removed, parent_lost}` from ONE match pass
  (`_build_carries` is the single carry-construction site shared with the write merge). Read-time recompute is
  still safe — both depend only on descriptions, which are immutable post-parse. Meta gains
  `parent_lost_count` / `parent_lost_descriptions` (same `_REVISION_REMOVED_SAMPLE_CAP`).
- **Verified inert:** a re-pointed row's stored `path` goes stale, but nothing reads it — commit rebuilds it
  from the effective tree (`commit_pipeline.py:886`) and the review UI derives depth from
  `effective_parent_index`. **No new schema** (the `Drifted` Select option is retained, unwritten).

**Files:** `services/boq_revision/carry.py` (rewritten, net deletion) · `api/boq/wizard/review_carry.py` ·
`review_screen.py` (meta block + 2 comments) · `revisionReviewDelta.ts` · `ReviewTree.tsx` (2nd advisory line
+ stale comments) · `boqTypes.ts`.
**Tests:** `test_carry` 16 (was 12 — adds the AI-accepted regression, the parser-only-taxonomy carry, the
no-`human_*`-field guard, `Drifted`-never-produced) · `test_review_carry` 15 (was 10 — the fixture's committed
nodes now all carry a BLANK human layer, i.e. the AI-accepted shape, so the suite fails if the carry ever
regresses to reading `human_*`; adds `parent_lost`, the advisories read path, and a human-layer-untouched
assertion across every row) · `revisionReviewDelta.test` (Drifted→retired guards + parent-lost modes).
**Green:** vitest boq-wizard **594** · review_screen 260 · parse_run 102 · commit_pipeline 54 ·
commit_validation 51 · revision_mapping 22 · column_carry 17 · revision_entry 17 · row_match 10 · carry 16 ·
review_carry 15. `tsc` clean in `boq-wizard`; residence ratchet holds (b1 0 / b2 8 / b3 40 / f2 200 / f5 114).
**Not yet done: live E2E on a real revision** — re-run the BOQ where the AI-accepted rows failed to carry.

### S8 — Commit overlay: formula · remark · color · `remark` dismissal · category (Wave 5) `[backend]`
**Why (D8):** everything that is **not money** lands silently at commit, so a committed revision arrives fully
annotated, categorised and formula-complete. **This slice is what makes S9 possible at all.**
- Runs inside `commit_pipeline` for `origin=="revision"`; also stamps `source_boq` / `source_commit_version` /
  `source_sheet_name` on the revision's committed `BoQ Sheet` (D2's provenance triple).
- **Carry the re-arm-EXEMPT set only** — **never** the re-armed set (the 4 computed dismissals + Recon Choice):
  they acknowledge **computed** conditions a revision recomputes, and S9's own rate carry would re-arm them on
  arrival ⇒ the carried record would **vanish from both views moments after landing**.
- **Amount Formula** (logical-axis — **neither** D6 nor D5's letters): identity is
  `(target_value_field, target_value_key, target_rate_subkey)`; `target_col` is a **guard, never a key** ⇒
  **re-resolve** it from the matched destination descriptor. Re-validate against the **destination's**
  committed amount descriptors via `_formula_target_matches_column`. No match → **drop silently** (D5's config
  gate already surfaced it). Uncovered destination amount column → **gate fails, user declares** (fail-closed).
  A **role swap is correct for free** (a letter key would have got it wrong). New `(boq, committed_version)`
  identity ⇒ `_next_formula_version` returns 1 naturally; `is_current=1`, `is_finalized=0`.
  ⚠️ **All 32 live formulas are wildcard — the override branch has never fired. Handle it, but it is untested
  territory.**
- **Remark** + **Dismissal kind `remark`** (row-addressed, **D6 only**): carry to the dest `excel_row`; drop
  for non-MATCHED.
- **Color** (cell-addressed by letter, **D6 × D5**): drop if the letter didn't survive the column diff.
- **Category** (`BoQ Row Category`, **D6 + discipline fan-out**): carry the **whole** layer (machine + human) at
  the revision's new `committed_version`, keyed `(excel_row, discipline)`. **No re-classify.**
  **PRESERVE THE FIELD SPLIT — machine → machine, human → human — via a `write_row_categories`-shaped INSERT,
  NEVER `set_human_verdict`** (collapsing a carried machine label into `human_category_id` would replicate the
  freeze bug, #1096, inside carry). **Fan out per discipline** (discipline is *in* the identity; two engines
  coexist as independent `is_current` rows — never pick one). NEW rows land **blank** → CL-6's amber +
  Check-Category filter; **no auto-classify**. `hasRun` resolves itself (carried rows *are* Row Category rows
  ⇒ size>0). Leave the dormant `description` guard **dormant** (D6's N2 key subsumes it).
**Tests:** the exempt set carries and the re-armed set does not; a formula whose column vanished drops
silently; a role **swap** re-resolves correctly; an uncovered dest amount column fails the gate; category rows
land with the field split intact (a machine label **never** appears in `human_category_id`); per-discipline fan-out;
a non-revision commit is **byte-identical**.
> ⚠️ **Before building: confirm PROD counts.** On dev every layer here is ~unused (Formula 32/all-wildcard,
> Color 4, Remark **1**, Recon **0**, Dismissal **0**, Row Category **0**; 45 priced cells vs 31,225 priceable
> nodes = **0.14%**; freeze **never used**, 0/554). Pricing and classification are recently shipped, so "zero
> here" is weak evidence of "zero in prod" — and prod counts could reshape this slice's priority.

**AS-BUILT (S8 = issue #1104 "S6 — commit overlay", `feature/upload-revised-boq`):**
- **Impure orchestrator `api/boq/wizard/commit_overlay.py`** — `carry_commit_overlay(boq, sheet_name,
  dest_version, dest_sheet_docname, grid_rows)`. Wired into `commit_pipeline._commit_one_sheet` INSIDE the
  `if disposition == "finalized":` block, AFTER `_commit_node_tree` (the priceable node tier the overlays sit on
  now exists) and before the trailing per-sheet commit. Shares that per-sheet transaction (**NO self-commit** — the
  whole overlay flushes atomically with the commit). A non-revision (upload/template) commit early-returns
  `_empty_summary()` before any DML → **byte-identical** (proven by the unchanged `test_commit_pipeline` 54).
- **The re-arm taxonomy IS the carry taxonomy (D8):** carries the EXEMPT set — amount **formula**, **remark**,
  **color**, **`remark` dismissal**, the whole **category** layer (machine + human) — and NEVER reads the re-armed
  set (the 4 computed dismissals via a `flag_kind == "remark"` filter; reconciliation choice is simply never read).
- **Provenance triple** (`source_boq` / `source_commit_version` / `source_sheet_name`, D2) stamped on the committed
  `BoQ Sheet` via `set_value(update_modified=False)`, OUTSIDE any savepoint (owner-chosen: it must always land so
  S9 finds the source). `source_commit_version` = the source's CURRENT committed version at carry time.
- **Excel-row twin map** = pure `row_match.match_rows` re-run on BOTH sides' committed `BOQ Nodes`, keyed by
  `source_row_number` on each side (→ `original_to_revised` is `source excel_row → dest excel_row` directly). The
  fixture shifts every revised row +10 (an inserted block) so a naive same-row carry would mis-land — the twin map
  follows the description. Committed-effective `level` on both sides (used only for the N=M>1 tiebreak; a mismatch
  degrades to AMBIGUOUS → the annotation SAFELY drops). Only remark/color/dismissal/category use the twin; **formula
  does not** (it re-validates on the logical axis).
- **Formula** re-validates each source record against the DEST amount descriptors via the SHARED
  `pricing._formula_target_matches_column` (never a re-implemented predicate); a match carries with `target_col`
  **re-resolved** from the matched dest descriptor (a role **SWAP** is correct for free — identity is
  value_field/value_key/rate_subkey, never the letter), a no-match drops silently, and an uncovered dest amount
  column stays uncovered → `_sheet_formulas_complete` stays false = **fail-closed** (no new gate). New triple ⇒
  `_next_formula_version` = 1. ⚠️ All live formulas are WILDCARD (value_key None) — tested (`test_wildcard_*`) plus
  the untested per-area OVERRIDE branch.
- **Color** survivor set = the committed grid's column universe UNION the dest `column_role_map` keys (S4's
  structural-presence reading of "survived the column diff" — a mapped-but-empty column survives openpyxl's
  trailing-empty skip). **Category** written through the **owner's** new no-commit `persist.carry_row_categories`
  (a `write_row_categories`-shaped INSERT preserving the machine/human field split; NEVER `set_human_verdict` — that
  would replicate the #1096 freeze bug inside carry) + `CARRY_READ_FIELDS` (one source/write field-set). Per-discipline
  fan-out rides the row list; NEW rows land blank (CL-6 amber).
- **Best-effort PER LAYER (owner-chosen via AskUserQuestion):** each layer runs in its own DB savepoint (`_guarded`,
  the `bulk_actions`/`create_itms` idiom — rollback BEFORE `log_error`); a layer that raises rolls back ONLY itself
  and is logged, so the core commit + provenance always stand. This is a DELIBERATE deviation from the ADR's atomic
  framing (documented in the module docstring).
- **Tests** `test_commit_overlay.py` (18): the rich fixture (role swap + drop, remark/color survivor+drop,
  remark-vs-computed dismissal, recon never carried, category field-split + fan-out + NEW-blank, provenance,
  summary) + `TestCommitOverlayWildcardFormula` (the common prod shape) + `TestCommitOverlayFailClosed`
  (uncovered dest column keeps the gate closed) + `TestCommitOverlayNonRevision` (non-revision + declared-New no-op).
  No regressions: commit_pipeline 54, pricing 185, review_carry 10, row_category 26, classify 38, parse_run 102,
  review_screen 260, commit_gate 33, commit_validation 51 + the revision service suite. Residence ratchet holds
  (b1 0 / b2 8 / b3 40 / f2 200 / f5 114). Both /code-review axes actioned (Data-Clumps → `_CarryCtx` bundle;
  twin-map `level` docstring corrected). ⚠️ **PROD counts not confirmed from this env** — dev matches the plan
  (Formula 46 / Remark 1 / Color 4 / Dismissal 0 / Recon 0 / Category 0); prod-count confirmation is still owed.

### S9 — Cross-BOQ rate carry backend (Wave 6) `[backend]`
**Why (D9):** the money. **Isolated late and deliberately last of the carries** — it is the only layer whose
failure costs real value, and it is the one net-new API surface.
- **MUST-FIX FIRST:** the `from_version == current_version` guard (`pricing.py:2506-2508`, `:2658-2660`) throws
  *"The selected version is already the current version"* — **two different BOQs can legitimately both be at
  v1, so this rejects the single most common cross-BOQ case.** Make it **`(boq, version)`-pair aware**: reject
  only when `source_boq == dest_boq AND source_version == dest_version`.
- `get_cross_boq_carry_plan(source_boq, source_version, dest_boq, sheet_names?)` → `{sheets: [{sheet_name,
  plan, counts, formulas_complete, needs_new_value_count}]}`. Read-only. **Reuse `_build_copy_forward_plan`'s
  shared-classifier discipline — plan and apply must not drift** (`pricing.py:2531`).
- `start_cross_boq_carry(source_boq, source_version, dest_boq, decisions_by_sheet)` — a **long job on the
  `parse_run` pattern** (raw 32-char `job_id`, **commit before publish**, self-heal marker), emitting
  `boq:carry_rates_done` `{carried, failed}`. **A loop over the per-sheet plan with per-sheet failure
  isolation — NOT one giant transaction** (the commit pipeline's precedent). Per sheet: one
  `acquire_or_refresh`, one `frappe.db.commit()`, rollback-on-failure.
- **The plan is per-CELL, not per-row** — one `excel_row` yields several entries (one per area/rate_kind).
- **Source-driven** (iterate the original's `is_filled` cells) ⇒ **D6 `NEW` rows never enter the plan** — the
  grid is their review surface (S10).
- **Decision identity = destination-keyed** `(dest_excel_row, area, rate_kind)`; the entry carries **both**
  `source_excel_row` and `dest_excel_row` (+ `source_boq`, `source_version`). Safe: D6's MATCHED is 1:1.
- **`(area, rate_kind)` re-resolution** (`rate_index.get((area, rate_kind))`, `pricing.py:2594`) survives
  cross-BOQ unchanged. **The source's bare `col_letter` is NEVER a write target.**
- **Skip taxonomy:** `removed` · **`ambiguous`** (new slot — today `non_match` conflates *"gone"* with *"can't
  tell"*, which need different human responses) · `no_rate_column` · `non_priceable` · `invalid`. Today's
  *"description changed"* branch **disappears** (under D6 that is REMOVED + NEW).
- **Priceability re-gate retained as-is** — re-resolved against the **destination** node;
  `allow_non_priceable` is **not** honoured on the carry path (hard skip).
- **Lock: destination-only, per-sheet.** The source is read-only ⇒ **never lock it**. A held lock **fails in
  isolation** and is reported — it does not abort the batch. **Classification freeze does NOT gate this**
  (owner-locked: not ORed into the pricing gate).
- **Both endpoints re-derive the plan server-side — a client-supplied outcome / target column / rate is NEVER
  trusted** (`pricing.py:2623-2625`).
**Tests:** the pair-guard fix (v1→v1 across two BOQs is accepted; same-boq same-version still rejected);
per-sheet isolation (one sheet's lock failure does not abort the rest); the skip taxonomy splits correctly;
NEW rows are absent from the plan; `(area, rate_kind)` re-resolves after a column move; a conflict defaults to
keep.

### S10 — Rate carry frontend (Wave 7) `[frontend]`
**Why (D9):** the one deliberate act left after commit.
- **Hub footer action** *"Carry rates from original"*, beside Commit / Tender. **Visibility:**
  `origin === "revision"` **AND** `source_boq` set **AND** ≥1 committed sheet. **`VersionRibbon` is left
  untouched** (it returns `null` below 2 versions — a fresh revision at v1 has no launch point today, which is
  why this is net-new).
- New `CrossBoqCarryDialog.tsx` — whole-BOQ, all sheets, plan-then-apply. Keeps `Set<cellKey>` +
  `Record<cellKey, boolean>` intact (only the key's *provenance* changes, not its shape). Conflicts keep
  today's model: default **keep**, per-cell toggle, bulk *"Overwrite all"* / *"Keep all existing"*. A sheet
  blocked by the formula gate is **unticked + labelled, never silently skipped** (a defensive fallback — the
  gate is server-enforced and can legitimately fail).
- Socket per the hub convention: **screen-scoped**, guarded on `payload.boq_name === boqId`, `socket.on` in
  `useEffect([socket])` + `socket.off` in cleanup, **on-mount in-progress recovery** + **reconnect self-heal**;
  acknowledge-only `{carried, failed}` results modal reporting *"150 carried · 11 rows need new values"*.
- `PricingGrid.tsx`: **unpriced priceable rate cells get CL-6's amber attention-fill** (`bg-amber-50` /
  `dark:bg-amber-950/30`) + a filter button. **Same shape, same token, no new vocabulary** — this is the
  existing system-cell-BACKGROUND lane (priced-emerald/amber), **not a new channel**.
  ⚠️ **Row-memo anti-defeat rule applies**: the flag reaches a row as **its own per-row value**, never a shared
  Map/Set compared by identity; and **`PricingGrid` is `React.memo`'d — every new prop must be
  `useCallback`/`useMemo`/stable-per-fetch** or the shield silently dies.
**Verify:** the action appears only on a committed revision; a blocked sheet renders unticked; the results
modal reports both counts; amber clears when a rate is typed; navigate-away-during-carry recovers on return.

**AS-BUILT (S10 = issue #1106 "S7b FE", `feature/upload-revised-boq`):**
- **NEW `CrossBoqCarryDialog.tsx`** (+ `CrossBoqCarryDialog.test.ts`, 14 pure-helper tests): whole-BOQ,
  **SUMMARY-FIRST per sheet** — a header (sheet-level tick + `v{src}→v{dst}` badge + `N to copy · M conflicts
  · K skipped · P need new values`), conflicts ALWAYS shown (per-cell Keep/Overwrite + per-sheet bulk
  "Overwrite all"/"Keep all"), clean rows folded behind a "Show N rows to copy" expander, skips in a muted
  `<details>` with `SKIP_REASON_LABEL`. A **formula-gate-blocked sheet** (`formulas_complete=false`) renders
  its checkbox disabled + an amber "Declare amount formulas…" banner + is pre-unticked (never silently
  skipped). Pure helpers (F1/tested): `cellKey` (sheet-qualified, NUL separator so a sheet's rows never
  collide), `isWritable`, `sheetWritableKeys`, `initialSelection` (writable cells of UNBLOCKED sheets pre-ticked;
  conflicts default KEEP), `applyBulkOverwrite` (per-sheet, conflict keys only), `buildDecisionsBySheet`
  (destination-keyed `{dest_excel_row, area, rate_kind, overwrite}`; **omits sheets with no selection**),
  `planTotals`, `sheetCountsDisplay`. On apply → `start_cross_boq_carry` → hands the plan's total
  `needs_new_value_count` up + closes.
- **`BoqHubPage.tsx`** — footer **"Carry rates from original"** gated `origin==="revision" && source_boq &&
  committedMap.size>=1` (`VersionRibbon` untouched); the carry socket lifecycle is a faithful clone of the
  parse-run machinery: screen-scoped `boq:carry_rates_done` guarded on `boq_name`, `carryInFlightRef`-gated
  `applyCarryOutcome`, on-mount recovery via `get_cross_boq_carry_status` (**re-arms `running` only, never
  re-pops a stale `done`**), 3s poll fallback while in-flight, reconnect self-heal (`mutateCarryStatus` on
  connect — the un-gated hub convention, NOT the T1 pricing-page rule); the status fetch is **gated to a
  revision doc** so a non-revision hub skips the call. Acknowledge-only results modal *"N carried · M rows need
  new values"* (M from the plan, captured at apply into `carryNeedsNewValuesRef`) + failed sheets via a
  module-level `CARRY_FAIL_REASON` map (5 worker reasons). `boqTypes.ts` gains the `CrossBoqCarry*` /
  `CarryRatesDonePayload` / `CarryStatusResponse` types, contract-matched to `cross_boq_carry.py` (#1105).
- **⚠️ OWNER-DIRECTED DEVIATION from the S10 text above:** the owner **declined** the new CL-6 amber cell-fill
  on `PricingGrid.tsx` ("no new highlighting not in the shipped pricing editor"). **`PricingGrid.tsx` is
  byte-identical** (the 143 PricingGrid tests untouched). The **existing "Show unpriced" filter**
  (`showOnlyUnpriced` in `SheetPricingPage.tsx` — already `isPriceableLine && !isFullyPriced`, which a carried-in
  D6 NEW blank row already matches) is the review surface; the results modal directs the user to it. See
  memory `feedback_boq_s10_no_new_amber`. The `PricingGrid` sub-bullet + its Verify clause above are
  **superseded** by this decision.
- Both /code-review axes clean (Standards: 0 hard, 2 acceptable judgement-calls — F3 near-twin of
  `CopyForwardDialog` helpers left un-shared since the `1|2|3` codes are anchored to the shared backend
  `_CF_*`; Spec: 0 findings, full backend-contract verification). vitest **590** (+14) / tsc 0 new / residence
  holds (b1 0 / b2 8 / b3 40 / f2 200 / f5 114). ⚠️ **Live E2E deferred to S11** (#1107) — dialog + socket
  paths are unit/contract-verified, not yet browser-run.

### S11 — End-to-end verification (Wave 8) `[verify]`
Commit a BOQ → upload a revised workbook against it (Revise radio → picker) → **rename one sheet, insert rows
in another, add a column in a third, leave a fourth byte-identical** → the mapping screen (Zone 1 counts
correct; the renamed sheet is a hard stop; pair it) → hub (removed-sheet advisory; the clean sheets at
`Config Done`, the added-column one at `Pending`) → parse → review (the unchanged sheet shows the green
"no deltas" chip; the inserted rows are `New`; a re-parented row's override landed on the twin) → finalize
each → commit (formulas/remarks/colors/categories present, field split intact) → **"Carry rates from
original"** → rates land, NEW rows amber. chrome-devtools on `:8080` (**the `:8000` two-port rule** — see the
BoQ runbook). `tsc` delta-0; backend suites green.

---

## ⚠️ Amendment B — the carry rework (waves W0–W6, 2026-07-20)

**Owner-directed after reviewing the as-built.** Design of record:
`docs/boq/revised-boq-carry-amendment.html` (ten worked scenarios; scenarios 4, 5, 6, 8 and 10 are
load-bearing). Full defect trace + code map: `docs/boq/HANDOFF-revised-boq-carry-amendment.md`.
ADR blocks: D1 / D5 / D6 / D7 / D9, each dated `AMENDED 2026-07-20 (Amendment B)`.

**The rule, in one sentence:**

> A row carries the original's classification **and** parenting forward **iff** it is at the **same Excel
> row** (`source_row_number`) with the **same** N2-normalised **description**, **and** its parent
> satisfies the same test. Both, or neither. Status is `Copied` or blank; blank renders `Original`.

**What this supersedes in the slices above:** S6's description-bucket matcher and S7's
`New`/`Ambiguous`/`Drifted` delta surfacing, plus the S6+S7 amendment's `parent_lost` advisory. The
**effective-value read** from that amendment **stays** — it is not reverted.

| Wave | Scope | Primary files |
|---|---|---|
| **W0** ✅ | ADR-0014 Amendment B — docs only, no code | `docs/adr/0014-*.md`, this plan, the HTML spec + handoff |
| **W1** | Matcher + carry — **the core** | `services/boq_revision/row_match.py`, `carry.py`, `api/boq/wizard/review_carry.py`, `boq_review_row.json` |
| **W2** | Review screen collapse | `revisionReviewDelta.ts`, `ReviewTree.tsx`, `boqTypes.ts`, `review_screen.py:1370-1393` |
| **W3** | Entry un-lock (A1) | `api/boq/wizard/revision.py`, `controllers/boqs.py:24-29`, `BoqMasterPanel.tsx`, `BoqDropZone.tsx` |
| **W4** | Config → `Pending` + work-package carry (A2) | `revision.py:467`, `api/boq/wizard/test_column_carry.py` |
| **W5** | Reporting at parse / mapping / commit (A8) | `revision.py:218-230`, `parse_run.py:872-874`, `commit_pipeline.py:655`, `CommitResultsModal.tsx` |
| **W6** | Rate-carry `is_current` fix (A10 — **resolved**) | `cross_boq_carry.py:233-236`, `revision.py:225`, cross-version fixtures |

**W1 shape.** `MatchRow(row_id, excel_row, description)` — `row_id` stays the caller's opaque identity
(original = committed node name for the review carry, `source_row_number` for the committed-tier
consumer; revised = `row_index`). `match_rows` builds a dict per side keyed by `excel_row`, **drops any
position appearing more than once on either side**, and keeps pairs whose `normalize_n2(description)`
are equal. `build_review_carry` then resolves the original's `parent_node` → that node's `excel_row` →
requires **that** position matched too → emits `classification` + `parent_index` together, or nothing.
Root (`parent_node` NULL) → `parent_index = -1`, condition 3 trivially satisfied.

**W1 tests.** Rewrite `test_row_match.py` (exact match · shifted-by-insert · shifted-by-delete ·
in-place text edit · duplicate Excel position either side · blank descriptions) and `test_carry.py` —
**deleting `test_pcc_reparented_row_lands_on_twin_new_row_index`**, whose premise Amendment B reverses,
and replacing it with its inverse. Keep `test_level_never_in_the_payload`. New fixtures for HTML
scenarios 4, 6, 8 and **10 (the documented net-zero insert+delete hole — assert the known-wrong
behaviour so nobody "fixes" it by accident, with a comment pointing at the ADR)**.

**W1 acceptance.** A non-revision parse is **byte-identical** — prove it with `parse_run` (102) +
`review_screen` (260), not by inspection.

**Suite baselines at `d89153e8` (do not regress).** Revision: `normalize` 10 · `sheet_match` 9 ·
`row_match` 10 · `carry` 12 · `column_diff` 17 · `revision_schema` 15 · `revision_entry` 17 ·
`revision_mapping` 22 · `review_carry` 10 · `column_carry` 17 · `commit_overlay` 18 ·
`cross_boq_carry` 17. Regression: `commit_pipeline` 54 · `pricing` 185 · `review_screen` 260 ·
`parse_run` 102 · `classify` 38 · `commit_validation` 51 · `create_from_template` 35. Frontend:
boq-wizard vitest **590**, `tsc` delta **0** in touched files. ⚠️ `commit_overlay` and
`cross_boq_carry` are green **only because their fixtures are same-version** — exactly why they miss
the W6 defect.

---

## Guardrails / invariants to honor (every slice)

- **Additive schema only** — every existing flow byte-unaffected; blank `revision_carry_status` /
  `source_sheet_name` preserves today's behaviour exactly. **A non-revision code path must stay byte-identical**
  (assert it in tests, per slice).
- **`sheet_name` is VERBATIM (#152)** everywhere — React keys, every endpoint arg. **N2 is used ONLY to
  *propose* the cross-doc pairing**, never to address a sheet. The ~30 existing join sites are untouched.
- **`source_sheet_name` is write-once.** No remap affordance — **delete + re-upload is the escape hatch**.
- **`-1` sentinel doctrine** — Frappe coerces Int `None`→`0` and `0` is a valid `row_index`. Write `-1`
  explicitly; never null, never 0.
- **Never carry `level`** (ADR-0009) — re-derive, or the `BOQ Nodes` controller throws.
- **`frappe.db.commit()` after DML, BEFORE `publish_realtime()`** — in every worker.
- **S3 safety:** read uploaded bytes via the `NamedTemporaryFile` pattern; **never** build a local path from
  `file_url` (`frappe_s3_attachment`).
- **Never `order_by` a Frappe field literally named `order`** (PG reserved keyword → 500).
- **`useFrappeGetDoc` 3rd arg is the swrKey** — `id ? undefined : null`, never `{ enabled }`.
- **Row-memo anti-defeat + the `PricingGrid` memo shield** (S10) — see `frontend/CLAUDE.md`.
- **Residence (ADR-0010):** the pure services above are **B1** modules (no `frappe.db`, no request ctx); N2 has
  **one home** (B2/F1). Run `python3 scripts/residence_check.py` from the **app root** before committing.
- **Pure modules get real unit tests with fixtures — no stubs** (repo rule; these are logic-bearing).
- **After any doctype JSON edit:** `bench --site localhost migrate`, then verify with
  `frappe.db.has_column` — **passing tests do not prove the runtime DB has the column**.
- **Docs discipline (DOCS-UPDATE RULE):** per-slice as-built detail goes to **this plan** +
  `.claude/context/domain/boq-backend.md` + `frontend/.claude/context/domain/boq-frontend.md` — **never** a
  changelog entry in the always-loaded `CLAUDE.md` files (the `guard_claude_md.py` PreToolUse hook enforces
  this). Touch `CLAUDE.md` only if a **stable convention or a load-bearing invariant** changes.

---

## Deferred (documented, not built in v1)

1. **Near-match / "looks like original row 24"** (D6/D7). The typo case (`IP42` → `IP-42`) simply **does not
   copy** under Amendment B's key — it fails condition 2 at a matching position — so classification *and* the
   hand-fixed parent are both dropped. The fuzzy tier **layers on without changing the key** ⇒ additive later
   with **zero rework**, and Amendment B makes it *cheaper*: the candidate set is now the single original row
   at the same Excel position, not the whole sheet. **Must be human-confirmed, never auto-applied** — it keeps
   the "silently carried a wrong decision" failure mode (the one failure the whole design is organised
   against) out of v1.
2. **Fuzzy suggestions in the unmatched-sheet dropdown** (D3). Sheets are median 5 / max 38 with meaningful
   names (only **5/506** are generic `'Sheet1'`); fuzzy's anchoring cost lands on the exact failure the screen
   exists to prevent.
3. **Confirm PROD counts before building S8** — every annotation layer is ~unused on dev (see S8's warning).
4. **Prod sanity check of D5's header-quality distributions** (69% blank / 35% duplicate) — dev-only, and
   load-bearing for the letter-key + full-row-guard choices.
5. **The measured carry holes** (D7): 11 `spacer` overrides, 3 synthetic rows, 41 `is_excluded` rows.
6. **Category ancestor drift** (D8): `ancestor_chain` is an AI input but only partially in D6's key, so a
   MATCHED row whose ancestors moved could warrant a different label than the carried one. No drift detection
   this slice (D7's `Drifted` idea applied to category is a separate, larger ticket).
7. **Role change on a matched column** (D5) — **undetectable by construction**; user-initiated only.

## Fog (in scope, not yet specifiable)

- **Concurrency** — the original edited / re-committed while a revision is in flight; two people revising the
  same original. D2's `source_commit_version` pin fixes audit + stability, **not** the UX of "the original
  changed under you". D9 settled the carry path (destination-only lock, per-sheet, isolated failure).
- **Canonical/latest marker for revision chains** (D1 allows chains). Latest-first ordering is the v1
  mitigation; an is-latest badge / tip-autoselect is a later slice.
- **Wrong-original mis-pick hardening beyond Zone 1** (the **F2 residual**). Zone 1 catches the ABB case and
  one direction of XORIANT, but **mis-picking a *richer* original reads as good news, not an alarm** — 20 of
  119 directed combos still silently mis-carry ≥1 sheet. What would close it is unclear (scope/discipline
  signal? a diff preview? a carry dry-run?).

## Out of scope (ruled beyond this effort — see ADR-0014)

- Auto-superseding the original (`status=Superseded` / an is-latest flag).
- **[#1096](https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/issues/1096) — Freeze banks
  MACHINE verdicts as permanent human ground truth** (surfaced by T8). **Indicts freeze, not carry**; needs an
  owner call on what Freeze was intended to bank.
- The 600s classify timeout + all-or-nothing persist (bites the original's first classify identically).
- Orphaned formula data (`'Lock Fix '` on 4 BOQs) — data hygiene.
- The three diverging role-vocabulary copies — a pre-existing defect D5 **routes around** rather than fixes.
