# BoQ "Create from Template" — Implementation Plan

**Status:** Backend v1 (T1–T6+T5b) **BUILT + committed** on the flagged-BOQs model. **Amendment A1
(2026-07-08) redesigns the templating store** — see the **[A1 Revised Plan](#amendment-a1--revised-plan-2026-07-08)**
below, which is now the authoritative execution plan. The original T1–T12 (further down) are retained as the
baseline; A1 marks each as REPLACE / PRESERVE / REMOVE. **No code until this plan is reviewed.**
**Decision record:** `docs/adr/0013-boq-create-from-template.md` (D1–D10 + **Amendment A1**).
**Design of record:** `docs/boq/create-from-template-locked-design.html` (18 decisions; superseded by A1 on the
store model).
**Branch:** `feature/boq-create-from-template` off `develop` (local, not pushed).

---

## Amendment A1 — Revised plan (2026-07-08)

**What A1 changes:** the templating *store* is redesigned (flagged-`BOQs` → dedicated `BoQ Template` doctype;
N templates → one hand-edited master; upload-authoring → seed-once-from-committed + a React editor). The
*create-flow* half is **preserved**. See ADR-0013 Amendment A1 for the decisions. This section supersedes the
"Execution Strategy" + "Slice detail" below for the store half.

### A1 BACKEND — AS-BUILT ✅ (2026-07-09, all green: 11 modules / 479 tests)
Built via implement→adversarial-verify Workflows (4 impl agents + 4 skeptics). Files (all under `api/boq/wizard/`):
`template_materialize.py` (A-T2 seed), rewritten `create_from_template.py` (A-T3 clone), collapsed
`template_admin.py` (A-T4 `set_template_active`), new `template_edit.py` + extracted pure `row_renumber.py`
(A-T5 editor), reworked `upload_file.py` (`is_template` → `is_template_source` + Admin/Estimates gate).
Doctypes created/migrated via `reload_doc`: `BoQ Template`, `BoQ Template Sheet`, `BoQ Template Row`; `BOQs`
lost `is_template`/`template_status` (orphan columns retained, harmless), gained `is_template_source`, kept
`origin`, repointed `source_template`→`BoQ Template`; `boqs.py::before_insert` keys project-less on
`is_template_source`.

**Deltas from the plan (found in review + adversarial verify, all fixed + tested):**
- **`BoQ Template Row` carries the full faithful subset:** added `sl_no_value`, `attached_notes`, **`row_notes`,
  `append_notes_raw`** so a template clone reproduces byte-identical review rows (else per-item notes were lost
  vs a direct upload).
- **Collapse RE-HOMES, not drops:** `_collapse_to_single_area` re-homes per-area rate/amount roles to their
  single-area scalars (keep-first-drop-rest), because dropping them left a purely area-split sheet (MEP
  Electrical) **unpriceable** (the pricing editor derives its editable rate cell from `column_role_map`).
- **Editor cycle guard:** `template_edit_row` rejects reparenting to a descendant (parity with the create-flow
  RestructureModal guard).
- **`template_reorder_sheets`** requires a complete duplicate-free permutation (a subset left colliding
  `sheet_order`).
- **Concurrent-seed advisory lock** (`pg_advisory_xact_lock`) in `set_as_master_template` enforces the singleton.
- **Mid-flight guard:** `_clone_worker` fails `template_changed` if a requested sheet was removed between
  validation and the async run.
- **Role-gate** lookups aligned to the raw-user convention (`pricing.py`/`draft_lock.py`).

**DEFERRED (known limitation, NOT fixed — out of A1 scope):** the `attached_to_index` **0-sentinel collision** —
deleting a row above a note whose target sits at `row_index 1` shifts the target to `0` = "not attached",
silently detaching the note. This is a **pre-existing shared defect** in `row_renumber._delete_remap_attached`
(also reachable via the create-flow `template_rows.delete_review_row`); the proper fix redesigns the
`attached_to_index` sentinel keyspace used across parse_run/review_screen/commit_pipeline with live data — a
separate cross-cutting change. Documented here + in memory as a follow-up.

**FE reuse-hardness flags (for the FE wave):** `ReviewTree` write path is hard-wired to `review_screen.*`
endpoints (needs a write-endpoint adapter prop for the A-T8 template editor) and has **no memoized row** (needs
a `pricingRowPropsAreEqual`-style memo row before adding a selection checkbox/qty for T10/T11). `is_template`
lives only in `BoqProjectTab.tsx`; `origin`/`is_template_source`/`source_template` are net-new to the TS types.

### A1 FRONTEND — AS-BUILT + LIVE E2E ✅ (2026-07-09, tsc delta-0)
Built via two parallel FE Workflows. Commits: **Stage 1 `045782d8`**, **Stage 2 `9fcfc021`** (backend
`f2f1dc15`) on `feature/boq-create-from-template`.
- **Stage 1 (additive, default-off):** T9 hub template-origin suppression (`sheetCardStages` override), A-T6
  "Set as master template" action (BoqHubPage; Admin/Estimates + `is_template_source` + committed), A-T7 create
  entry (BoqPickerPage 2nd option → in-place `TemplateCreateFlow` → `get_master_template` → sheet picker →
  `create_from_template` → clone-progress socket+poll → hub), A-T8 templates-admin SHELL (route
  `/upload-boq/templates` + role-gated sidebar + `get_master_template_admin` + `is_active` + seed-from-workbook),
  BoqProjectTab `is_template` cleanup, new TS types.
- **Stage 2:** T10 `ReviewTree.selectable` (Include checkbox → `set_row_excluded` cascade + dimmed-excluded +
  soft no-qty advisory; `templateSelection.ts` pure helpers) + T11 `canCreateRows` (insert/delete) — BOTH
  default-off so the upload flow is byte-identical; SheetReviewPage gates on `origin==="template" && !readOnly`;
  `get_review_rows` returns `is_excluded`. A-T8 **lean editor** (owner-chosen over ReviewTree-reuse):
  `TemplateRowsEditor` (`get_template_rows` → indented tree; edit/insert/delete/reparent via `template_edit.*`,
  cycle-safe parent picker) + TemplateEditorPage sheet selector + add/remove/reorder-sheet.
- **LIVE E2E (chrome-devtools, jatin/PMO):** create-from-template → clone → template-origin hub (Configure/Parse
  suppressed, "Cloned from template" subtitle) → review (Include checkboxes; deselecting a preamble cascades to
  its subtree; advisory recomputes 4→2) → commit (General Specs committed v1 — the **T5b source-file-less commit
  path**). All green.
- **Bug found + fixed in E2E:** the selection checkbox double-acquired the draft lock (client `onEditIntent` +
  server `set_row_excluded` raced on the lock's check-then-insert → "BoQ Sheet Pricing Lock … already exists").
  Removed the redundant client acquire; `set_row_excluded` is the single lock authority for a selection toggle.
- **RESIDUAL latent lock race (NOT fixed — follow-up):** `pricing_lock.acquire_or_refresh` is a non-atomic
  check-then-insert, so two TRULY-concurrent acquires (e.g. two users on the same sheet at the same instant)
  still race to a `DuplicateEntryError` instead of a graceful holder/reject. Harden by catching the dup +
  re-resolving (same-user → refresh, other-user → BOQ_DRAFT_LOCKED). Affects the pricing/draft/config locks too.
- **E2E env notes:** dev DB now has an active master `BOQTPL-00020` (E2E MEP Master, seeded programmatically) +
  a demo BoQ `BOQ-26-00101` (left for exploration). Observed **90 stale `BoQ Sheet Pricing Lock` rows** for
  BOQ-26-00101 with TEST sheet-names (RestructureSheet/EditSheet/Cascade…) by Administrator — a
  test-DB→runtime-DB leakage worth investigating separately.

**A1 STATUS: COMPLETE** (backend + frontend, committed, tsc delta-0, live-E2E-verified). Pending: push +
owner (Nitesh) review; optional fast-follows = the residual lock-race hardening, and finalize+commit of a
DATA sheet via the FE (backend-tested; needs Mark-Finalized-then-commit steps).


### Preserved from the built backend (NO code change) — the create-flow half
These act on the *created project BoQ's* review rows and are agnostic to the template store. **Do not touch:**
- `template_select.py` — `set_row_excluded` two-direction cascade (T3). ✅ keep + tests.
- `template_rows.py` — `create_review_row`/`delete_review_row`, renumber-on-insert (T4). ✅ keep + tests.
- `is_excluded` gate + commit filter (T5) in `commit_validation`/`review_screen`/`commit_pipeline`. ✅ keep.
- commit-pipeline **T5b** — `_invert_rows_to_grid`/`_template_grid_rows`, `origin=="template"` branch. ✅ keep.
- `BoQ Review Row.is_excluded`; `BOQs.origin`. ✅ keep.
- FE parametric review (T10) + row create/delete UI (T11) — build as originally planned; also **reused** by the
  new template editor (A-T8).

### Removed from the built backend
- `BOQs.is_template`, `BOQs.template_status` (fields + all references).
- `upload_file.upload_file`'s `is_template` authoring param.
- `template_admin.py`'s publish/deprecate/unpublish/**duplicate**/delete-of-N surface (collapses — see A-T4).
- `create_from_template.list_templates` (N-templates reader → single-master reader, A-T3).
- `BoqProjectTab.tsx`'s `is_template != 1` filter (seed BoQ is project-less + `is_template_source`-hidden).
- Tests: `test_template_admin`; the flagged-BOQs parts of `test_create_from_template`.

### A1 dependency graph
```
A-T1 (new doctypes + BOQs field migration) ──┬──► A-T2 (seed materialize: committed BoQ → BoQ Template)
                                             ├──► A-T3 (rewrite create_from_template: clone FROM BoQ Template)
                                             └──► A-T4 (lifecycle: is_active toggle + provenance + list cleanup)
A-T1 ──► A-T5 (template-editor endpoints: CRUD on BoQ Template Row/Sheet, renumber-on-insert)

A-T2 ──► A-T6 (FE: "Set as master template" action on a committed BoQ)
A-T3 ──► A-T7 (FE: create entry — sheet-only picker of the master + clone-progress)   [reuses old T7]
A-T4,A-T5 ──► A-T8 (FE: template-editor screen — reuse ReviewTree in edit mode + is_active)  [replaces old T8]
ALL ──► A-T9 (E2E: seed→materialize→edit→create→select/qty→finalize→commit→tender)
```
Unchanged FE from the original plan (build as-is, after their backend deps): **T9** hub template-origin
behavior, **T10** parametric review, **T11** create/delete row UI.

### A1 Waves
- **Wave A1 (blocking):** A-T1 — new doctypes + `BOQs` field migration.
- **Wave A2 (parallel, after A-T1):** A-T2, A-T3, A-T4, A-T5 — four independent backend units.
- **Wave A3 (parallel, after backend deps):** A-T6 (needs A-T2), A-T7 (needs A-T3), A-T8 (needs A-T4+A-T5),
  plus the unchanged T9/T10/T11 (per their original deps).
- **Wave A4 (after all):** A-T9 — end-to-end verify.

Execute via Plan-to-Parallel (`TaskCreate → TaskUpdate deps → parallel general-purpose subagents`). Each
subagent prompt carries the **why** (this A1 intent), exact files, the ADR-0013 A1 decision it implements, and
the test/verify expectation. Adversarially verify (skeptic subagent or a verify workflow) before committing.

### A1 Slice detail

#### A-T1 — New template doctypes + `BOQs` field migration (Wave A1) `[backend]`
**Why:** every store-half task reads the new doctypes; the flagged-BOQs fields must go.
- New doctypes (create via bench/Desk tooling, not hand-edited JSON per repo rule; note the sanctioned-exception
  discipline for the `BOQs` field changes):
  - **`BoQ Template`**: `template_name` (Data), `is_active` (Check, default 0), `seeded_from_boq` (Data),
    `seeded_at` (Datetime), `last_updated_by` (Data), `last_updated_on` (Datetime), child table `sheets`.
  - **`BoQ Template Sheet`** (child of `BoQ Template`): `sheet_name` (Data), `sheet_order` (Int), `sheet_label`
    (Data), `disposition` (Select: `data`/`general_specs`), `sheet_config` (JSON, single-area-normalized),
    `work_packages` (JSON — list of `work_header` names), `preamble_text` (Text).
  - **`BoQ Template Row`** (separate doctype): `template` (Link → BoQ Template), `sheet_name` (Data),
    `row_index` (Int), `classification` (Data), `parent_index` (Int, **−1** sentinel), `attached_to_index`
    (Int, **0** sentinel), `level` (Int), `path` (Data), `source_row_number` (Int), `description` (Text),
    `unit` (Data), `make_model` (Text), `is_rate_only` (Check). **No** qty/rate/amount, **no** overlay fields.
- `BOQs`: **remove** `is_template`, `template_status`; **add** `is_template_source` (Check, default 0);
  **keep** `origin`; **change** `source_template` target `BOQs` → `BoQ Template`.
- Migrate runtime DB (`reload_doc` for new doctypes; drop the two removed columns; verify each with
  `frappe.db.has_column`). Update `boqs.py::before_insert` to key the project-less allowance on
  `is_template_source` (was `is_template`).
- **OPEN for plan review:** the field name `is_template_source` (see ADR A1-D4). Confirm or rename.
**Done:** new doctypes + `is_template_source` exist on runtime DB; `is_template`/`template_status` gone; upload
flow byte-unaffected.

#### A-T2 — Seed materialize: committed BoQ → `BoQ Template` (Wave A2) `[backend]`
**Why:** the one-time bootstrap that turns a curated committed BoQ into the master (A1-D2/D10).
- New `api/boq/wizard/template_materialize.py`:
  - `set_as_master_template(seed_boq)` — Admin+Estimates gated; asserts the seed BoQ is committed +
    `is_template_source=1`. **Replaces** any existing master (raw-delete existing `BoQ Template Row`s + the
    `BoQ Template` doc first — mind list-JSON `delete_doc` wall; use `frappe.db.delete` where needed). Reads the
    seed's surviving `BoQ Review Row`s, resolves `effective_*` (reuse `review_screen.resolve_effective`),
    **strips qty/rate/amount**, **collapses multi-area → single-area** in the per-sheet `sheet_config`, carries
    WP grandchildren (direct `frappe.db` read) + general-specs `preamble_text`. Writes `BoQ Template` +
    `BoQ Template Sheet` + `BoQ Template Row`s (bulk via `frappe.db`; list-JSON pre-serialize). Sets provenance
    (`seeded_from_boq`, `seeded_at`, `last_updated_*`). Commit before any publish.
  - `get_master_template_admin()` — the master + sheets + row counts, for the editor.
**Tests:** materialize of a fixture committed BoQ yields structural-only rows (qty/rate blank), single-area
`sheet_config`, correct `parent_index`/`attached_to_index` sentinels, WP + general-specs carried; re-run
replaces cleanly (idempotent).

#### A-T3 — Rewrite `create_from_template.py`: clone FROM `BoQ Template` (Wave A2) `[backend]`
**Why:** create now sources the master doctype, not a flagged BoQ (A1-D2).
- `get_master_template()` — the active master's sheets (name/label/order/disposition), for the create picker.
  Role-gated to the 5 wizard roles. Returns nothing/inactive-guard when `is_active=0`.
- `create_from_template(project, boq_name, sheet_names)` — **no `template_boq` arg** (one master). Validates
  active master + non-empty sheet subset; creates the `BOQs` shell (`origin="template"`, `source_template=`the
  master, project-bound, `boq_name` default `{project}_BOQ`, `wizard_state="Parsed"`, no `source_file_url`);
  enqueues `_clone_worker`. `_clone_worker` reads `BoQ Template Row` (pre-flattened → **straight structural
  copy** into `BoQ Review Row` at `Parsed`, `is_excluded=0`); rebuilds `BoQ Sheet Draft` at `Parsed` from
  `BoQ Template Sheet` (`sheet_config`, WP grandchildren, general-specs membership). `get_clone_status` +
  `boq:template_clone_done` unchanged.
**Tests:** clone of a fixture master yields `Parsed` review rows matching the template's structure; WP +
general-specs carried; qty/rate blank; only picked sheets present.

#### A-T4 — Lifecycle + list cleanup (Wave A2) `[backend]`
**Why:** singleton lifecycle + remove the N-template surface (A1-D10).
- `set_template_active(active)` — Admin+Estimates gated toggle of the master's `is_active`; touches
  `last_updated_*`.
- **Delete** `template_admin.py`'s publish/deprecate/unpublish/duplicate/delete-of-N (and its tests). Any
  still-needed read collapses into `get_master_template_admin` (A-T2).
- Remove the `BoqProjectTab.tsx` `is_template != 1` filter; ensure `is_template_source` BoQs are hidden from
  project-facing BoQ list queries instead.
**Tests:** inactive master → `get_master_template` empty/guarded; role gate rejects a Project Lead toggling; a
seed (`is_template_source`) BoQ absent from project BoQ lists.

#### A-T5 — Template-editor endpoints (Wave A2) `[backend]`
**Why:** admin-edits-directly needs CRUD on the master's rows/sheets (A1-D10), safe under the tree sentinels.
- New `api/boq/wizard/template_edit.py` (Admin+Estimates gated), operating on `BoQ Template Row`/`Sheet`:
  - Row CRUD **reusing the renumber-on-insert + remap logic from `template_rows.py`** (extract the pure
    `_insert_shift`/`_delete_remap` helpers so both the review-row and template-row paths share them — F3-lite:
    one parametric core, two thin callers): `template_create_row` / `template_edit_row` (description/unit/
    classification/reparent) / `template_delete_row`.
  - Sheet ops: `template_add_sheet` (hand-built new sheet — name/label/disposition/single-area `sheet_config`),
    `template_remove_sheet`, `template_reorder_sheets`, `template_set_sheet_wp`.
  - Every write touches `last_updated_*`; commit before return.
**Tests:** insert/reparent preserves parent links + sentinels; delete re-points orphans; add/remove/reorder
sheet; role gate; parity with `template_rows.py`'s shared helpers.

#### A-T6 — FE: "Set as master template" action (Wave A3) `[frontend]`
**Why:** the seed trigger (A1-D10). On a committed BoQ's hub/detail, an Admin+Estimates-only "Set as master
template" button → confirm dialog (warns it **replaces** the current master) → `set_as_master_template` →
progress/toast. Screen-scoped socket if long-job; shadcn + tokens only.
**Verify:** action visible only to Admin+Estimates on a committed `is_template_source` BoQ; materialize
populates the master.

#### A-T7 — FE: create entry — sheet-only picker (Wave A3) `[frontend]`  *(revises old T7)*
**Why:** the create spine, simplified to one master (A1-D10). `BoqPickerPage` 2nd option "Create from
Template" → **no template-selection step** → checkbox picker of the **active master's** sheets
(`get_master_template`) → name (`{project}_BOQ` editable) → create → "Building your BOQ…"
(`boq:template_clone_done` + poll) → hub. If no active master, show a disabled/empty state.
**Verify:** create yields a hub with exactly the picked sheets at Review-ready.

#### A-T8 — FE: template-editor screen (Wave A3) `[frontend]`  *(replaces old T8)*
**Why:** the admin editor (A1-D10). New route (Admin+Estimates gated; sidebar entry) that **reuses the
parametric `ReviewTree` in a "template-edit" mode** against the `template_edit.py` endpoints: add/edit/delete/
reparent rows (renumber-on-insert), add/remove/reorder sheets, edit `sheet_config`, `is_active` toggle +
provenance display. Row-memo-safe (per-row slice, no shared Set). The tree component is parameterized on its
data source (review rows vs template rows) so it is **one component, two callers**.
**Verify:** edit persists to `BoQ Template Row`; a subsequent create-from-template reflects the edit;
inactive-toggle hides it from the picker.

#### A-T9 — E2E verification (Wave A4) `[verify]`
Seed: upload `MEP BOQ..xlsx` as a project-less `is_template_source` BoQ → single-area configure → parse →
review → commit → "Set as master template". Edit the master (add a row, add a sheet). Create-from-template into
a test project (pick a subset) → select/prune + create a row + fill quantities → finalize (soft advisory, no
block) → commit → open pricing/tender, confirm the included subset priced correctly. chrome-devtools on
`:8080`; `tsc` delta-0; backend suites green (preserved T3/T4/T5/T5b + new A-T2/3/4/5).

---

## Execution Strategy

Execute via the Plan-to-Parallel workflow (see `~/.claude/CLAUDE.md`). This section is authoritative and
must survive context clearing — the waves and dependencies below drive `TaskCreate → TaskUpdate
(dependencies) → parallel subagents (subagent_type=general-purpose)`.

**Dependency graph**

```
T1 (schema+migrate) ──┬──► T2 (clone worker + create endpoint + socket)
                      ├──► T3 (set_row_excluded + cascade, py)
                      ├──► T4 (create/delete_review_row, renumber)
                      ├──► T5 (gate + commit filter is_excluded=0)
                      └──► T6 (template lifecycle endpoints + list-filter)

T2 ──► T7 (FE: entry + sheet picker + clone-progress)
T6 ──► T8 (FE: Templates management page)
T1,T2 ──► T9 (FE: hub template-origin behavior)
T3,T5 ──► T10 (FE: parametric review — selection + qty gate + advisory)
T4,T10 ──► T11 (FE: create/delete row UI)
ALL ──► T12 (E2E verify author→create→select→qty→finalize→commit→tender)
```

**Waves**

- **Wave 1 (blocking prerequisite):** T1 — schema + migrate. Everything depends on the new fields.
- **Wave 2 (parallel, after T1):** T2, T3, T4, T5, T6 — five independent backend units, each touching
  different files. Launch as 5 parallel subagents.
- **Wave 3 (parallel, after their backend deps):** T7 (needs T2), T8 (needs T6), T9 (needs T1+T2), T10
  (needs T3+T5). Launch as parallel subagents once their upstream backend tasks are green.
- **Wave 4 (after T10):** T11 — create/delete row UI (builds on T10's parametric scaffolding).
- **Wave 5 (after all):** T12 — end-to-end verification via chrome-devtools on localhost.

Create all tasks with `TaskCreate`, set `addBlockedBy` per the graph, then launch each wave's unblocked
tasks as parallel subagents. Every subagent prompt must include the **why** (this plan's intent), the exact
files, the ADR-0013 decision it implements, and the test/verify expectation.

---

## Slice detail

### T1 — Schema + migration (Wave 1) `[backend]`
**Why:** every other task reads the new fields; additive and inert for the upload flow.
- `BOQs` doctype JSON (via Desk/bench tooling — do NOT hand-edit JSON per repo rule; add via a controlled
  edit + `bench migrate`, noting the sanctioned-exception discipline):
  `is_template` (Check), `template_status` (Select: `Draft\nPublished\nDeprecated`, default Draft),
  `origin` (Select: `upload\ntemplate`, default `upload`), `source_template` (Link → BOQs).
- `BoQ Review Row`: `is_excluded` (Check, default 0).
- `bench --site localhost migrate`; verify with `frappe.db.has_column` for each.
**Done:** columns exist on the runtime DB; upload flow unaffected (defaults preserve current behavior).

### T2 — Clone worker + create endpoint + socket (Wave 2) `[backend]`
**Why:** the create action must deep-copy the template into a fresh project BOQ off the request thread.
- New `api/boq/wizard/create_from_template.py`:
  - `list_templates()` — Published `is_template=1` BOQs (name, boq_name, sheet names). Role-gated to the 5.
  - `create_from_template(template_boq, project, boq_name, sheet_names)` — validate, create the new `BOQs`
    (`origin="template"`, `source_template`, project-bound, `boq_name` default `{project}_BOQ`), then
    `frappe.enqueue(_clone_worker, queue="long")`; return `{job_id, boq_id}`.
  - `_clone_worker` — per selected sheet: copy `BoQ Sheet Draft` (config + `work_packages` grandchild rows) at
    `wizard_status="Parsed"`; **flatten** each template `BoQ Review Row` (effective class/parent → base fields;
    drop overlay/AI/edit_log/warnings; **blank qty + rate + amount fields**; `is_excluded=0`); carry
    `general_specs_sheets` membership. **Bulk-insert** rows via `frappe.db`. Commit **before** publish.
  - `get_clone_status(job_id)` + publish `boq:template_clone_done` (mirror `upload_file`/`parse_run`
    long-job scaffolding, incl. self-heal marker).
**Tests:** unit — clone of a fixture template yields flattened, stripped, `is_excluded=0` rows at `Parsed`;
WP + general-specs carried; qty/rate blank. Idempotent job double-fire guard.

### T3 — `set_row_excluded` + cascade (Wave 2) `[backend]`
**Why:** durable, server-authoritative selection with the two-direction cascade (D5).
- New endpoint in `review_screen.py` (or `api/boq/wizard/template_select.py`): `set_row_excluded(boq, sheet,
  row_index, excluded)` — writes the row **and its cascade**: deselect → whole subtree `is_excluded=1`;
  select → row + ancestor preamble chain `is_excluded=0`. Reuse the cycle-safe descendant DFS. Guarded by
  `_guard_sheet_not_frozen` + draft lock. Commit, return updated index set.
- Pure cascade helper (Python) mirrored by FE `templateSelection.ts` (F1 parity target).
**Tests:** deselect a preamble excludes its subtree; select a nested line item pulls its ancestor preambles
back in; cycle-safe; non-eligible rows untouched (ride-along derived at read/commit, not stored).

### T4 — `create_review_row` / `delete_review_row` (Wave 2) `[backend]`
**Why:** the net-new insert primitive (D6); no such endpoint exists today.
- `create_review_row(boq, sheet, anchor_row_index, position: above|below, classification, parent_index,
  description, unit)` — **renumber-on-insert**: shift `row_index ≥ insertion point` +1, remap all parent
  pointers (`parent_index`, `human_parent ≥ 0`) through the shift map atomically; insert the new row
  (`is_excluded=0`, `is_synthetic=1`, `source_row_number` null/synthetic). Level auto-derives.
- `delete_review_row(boq, sheet, row_index)` — **only** rows with `is_synthetic=1` (user-created); reverse
  renumber + remap. Both guarded by freeze + lock; template-origin only (assert `origin="template"`).
**Tests:** insert above/below preserves order + all parent links; delete restores; refuse delete of a
template (non-synthetic) row; refuse on upload-origin BOQ.

### T5 — Finalize gate + commit filter to included subset (Wave 2) `[backend]`
**Why:** excluded rows must not block finalize nor become nodes (D5).
- `commit_validation.structural_errors_for_sheet` + `review_screen.check_structural_integrity` +
  `derive_effective_levels`: filter input rows to `is_excluded=0`.
- `commit_pipeline`: the row→node selection (the "commit all classified rows except spacer" set) gains
  `is_excluded=0`. Grid tier: decide whether excluded rows appear in the faithful committed grid — **keep the
  grid faithful is out; commit only builds NODES from the included subset** (grid mirrors included rows too,
  for consistency). Confirm no orphan `BOQ Nodes`.
**Tests:** a deselected orphan line item does NOT block finalize; excluded rows produce no nodes; included
subset commits identically to a hand-equivalent upload BOQ.

### T5b — Commit grid from review rows for template origin (Wave 2, DISCOVERED during build) `[backend]` ✅
**Why (gap the plan missed):** `commit_pipeline.commit_boq` builds the committed GRID tier by re-opening the
**source Excel** (`_extract_grid_rows`), and throws if there is no `source_file_url`. A template-cloned BoQ has
no workbook → commit was impossible for template origin (contradicting D9 "post-finalize untouched"). Owner
decision (2026-07-08): build the grid from the review rows (option A).
- `commit_pipeline._invert_rows_to_grid(review_rows, sheet_config)` — PURE inverse of `column_role_map`
  (col_letter → {role, area}) → grid_rows `[{row_number, cells:{col_letter: value}}]`; `_GRID_ROLE_SCALAR` +
  `_GRID_ROLE_AREA` role→field maps; `row_number = source_row_number` (or `row_index` for synthetic rows).
- `_template_grid_rows(...)` — DB wrapper: reads review rows filtered `is_excluded=0` (grid/node parity), or
  seeds one cell row from `preamble_text` for a `grid_only` (general-specs) sheet.
- `commit_boq` branches on `boq_doc.origin == "template"`: skip the source-file guard + workbook fetch/open;
  per sheet use `_template_grid_rows` instead of `_extract_grid_rows`. Node tier unchanged (already reads rows).
- **Safe because** a `grid_and_nodes` sheet's committed grid cells are WRITE-ONLY downstream (only the
  general-specs reference view reads cells; pricing drives off the node tier). Upload-origin path byte-identical.
**Tests:** `test_template_commit_grid` (9: pure inverter — scalar/area/None-omit/synthetic/JSON-coerce + DB
wrapper is_excluded filter + grid_only seed). E2E verified: a real template-origin `commit_boq` with no
source file commits, grid built from rows, `is_excluded=1` row absent. commit_pipeline 51 regression green.

### T6 — Template lifecycle endpoints + list-filter (Wave 2) `[backend]`
**Why:** publish gate + management surface (D10); templates must not pollute project BOQ lists.
- `create_from_template.py` (or `template_admin.py`): `publish_template` / `deprecate_template` /
  `duplicate_template` / `create_blank_template` — Admin + Estimates gated.
- Filter `is_template=1` out of every project-facing BOQ list query (find the BOQ list endpoints/hooks).
**Tests:** only Published templates returned by `list_templates`; templates absent from project BOQ lists;
role gate rejects a Project Lead publishing.

### T7 — Entry + sheet picker + clone-progress (Wave 3) `[frontend]`
**Why:** the user-facing create spine (Q7).
- `BoqPickerPage`: second option "Create from Template". New `TemplateCreateFlow.tsx`: template select →
  checkbox sheet picker (all template sheets) → name (`{project}_BOQ` editable) → create → "Building your
  BOQ…" state driven by `boq:template_clone_done` + `get_clone_status` poll → navigate to hub.
- Screen-scoped socket per convention; shadcn only; tokens only.
**Verify:** create yields a hub with exactly the selected sheets at Review-ready state.

### T8 — Templates management page (Wave 3) `[frontend]`
**Why:** author/manage lifecycle (D10).
- New route `/upload-boq/templates` (Admin + Estimates gated; sidebar entry). List `is_template` BOQs with
  status; actions New (→ blank template + upload/wizard), Edit (reopen wizard on that BOQ), Publish/Unpublish,
  Deprecate, Duplicate.
**Verify:** publish flips picker visibility; edit reopens the standard hub on the template BOQ.

### T9 — Hub template-origin behavior (Wave 3) `[frontend]`
**Why:** template sheets can't Configure/Parse (D2/D4).
- `BoqHubPage` + `SheetCard`/`sheetCardStages.ts`: when `boq.origin==="template"`, suppress ①Configure and
  the Parse/Re-parse footer actions; the stepper starts effectively at ②Review. One BOQ-level check.
**Verify:** template hub shows no Configure/Parse affordances; upload hub unchanged.

### T10 — Parametric review: selection + qty gate + advisory (Wave 3) `[frontend]`
**Why:** the enhanced Review-and-Select screen (D5/D7/D8).
- `templateSelection.ts` (pure, unit-tested; parity with T3 Python cascade). Extend
  `SheetReviewPage`/`ReviewTree` with capability flags (`selectable`, qty-gate). Checkbox column on eligible
  rows; wire `set_row_excluded`; **row-memo-safe** (per-row selection slice, never the shared Set). Gate the
  existing editable `qty_total` descriptor to selected `line_item` rows. Soft advisory "N selected lines have
  no quantity" (never blocks).
**Verify:** deselect cascades visually; qty editable only on selected line items; upload review unchanged
(flags off).

### T11 — Create/delete row UI (Wave 4) `[frontend]`
**Why:** the insert affordance (D6), on T10's scaffolding.
- Row context action "Insert above/below" → form (classification + parent picker + description + unit) →
  `create_review_row` → `mutate()`. Delete affordance on synthetic rows only.
**Verify:** created row appears in-position, auto-selected, editable qty; delete removes it.

### T12 — End-to-end verification (Wave 5) `[verify]`
Author a template (upload `MEP BOQ..xlsx`, single-area config, publish) → create-from-template into a test
project → select/prune, create a row, fill quantities → finalize (advisory shows, no block) → commit →
open pricing/tender and confirm the included subset priced correctly. chrome-devtools on `:8080`. tsc
delta-0; backend suites green.

---

## Guardrails / invariants to honor
- **Additive schema only** — upload flow byte-unaffected (`is_excluded` default 0, `origin` default upload).
- **Row-memo anti-defeat** (T10/T11): selection reaches a row as its own slice; no shared Set/inline-arrow
  props on memoized rows.
- **F1 parity:** `templateSelection.ts` cascade == the T3 Python cascade (add a parity test).
- **`sheet_name` verbatim** everywhere (#152). **Never `order_by` `order`** (PG reserved).
- **Commit-before-publish** in the clone worker; draft-lock + freeze guards on every write endpoint.
- **Docs discipline:** per-slice as-built detail goes to `boq-upload-plan.md` + the domain reference docs,
  NOT the always-loaded `CLAUDE.md` (guard hook enforces).

---

# ENHANCEMENT ROUND (A2) — 2026-07-09 — mode-selector + quantities + multi-area + admin polish

**Status:** PLAN APPROVED (grill 2026-07-09, 10 decisions locked). Slice-1 implementation blueprint being
produced by the `boq-template-slice1-blueprint` verification workflow (de-risks the synthetic-column seam).
Owner (Abhishek) confirmed intent. Delivered as 3 reviewable slices, core-first.

## Locked design decisions (Q1–Q10)
1. **Areas are BoQ-wide** — one set applied to every data sheet (`BOQs.area_dimensions`); NOT per-sheet.
2. **Finalize qty-gate** — SELECTED `line_item` rows must have Total Qty > 0 (multi-area = SUM across areas > 0);
   preambles/headers + excluded rows never checked. Extends `templateSelection.countSelectedLineItemsNoQty`.
3. **Inline grid qty editing** — type directly in the cell, save on blur/Enter (no per-cell confirm dialog);
   multi-area **Total column is read-only** = live sum; single-area Total is the editable cell. Reuses
   `save_review_edit` (accepts `qty_total` + `qty_by_area`). New inline-input work in `ReviewTree`, gated to
   template-origin qty columns only — all other cells stay read-only.
4. **Explicit mode selector** on `/upload-boq?project=<id>` — "Upload a BoQ" / "Create from Template"; the
   right/details panel is HIDDEN until a mode is chosen. Remove "Create from Template" from the bare `/upload-boq`
   picker (+ its orphaned `mode` state).
5. **Whole-master reseed** — reuse `set_as_master_template` (no per-sheet reseed); warning copy = "replace the
   existing template".
6. **Seed dialog = entry only** — dialog hosts the Upload-BoQ entry (drop + template-source name/version/notes,
   no project/customer); on parse success it closes and navigates to the new template-source BoQ's HUB for
   Config→Parse→Review→Commit→"Set as master".
7. **Sidebar audience = Admin + Estimates** — move "BoQ Templates" under "Admin Options" (`admin-actions`
   children); make the group visible to Estimates for this one item; update `allKeys`/`groupMappings` + nested
   active-highlight. (Group is otherwise Admin/PMO; do NOT add PMO to templates, do NOT drop Estimates.)
8. **Version read-only** (system auto-increment Int, displayed only); **GST → `tax_treatment`** (Pre/Post-tax)
   and **Notes → `notes`** are the editable inputs. No new version field.
9. **Areas locked at create** — single/multi + names fixed for that BoQ; no post-create area editing in v1
   (documented fast-follow). Per-sheet Config stays suppressed for template origin.
10. **Phased, core-first** — Slice 1 (core + single-area) → Slice 2 (multi-area) → Slice 3 (admin polish).

## Guardrails (all slices)
- **Upload flow byte-identical** — every new backend param optional/additive; ALL review customizations + the
  qty finalize-gate branch ONLY on `origin === "template"`. Upload-origin review renders + finalizes as today.
- `tsc` delta-0 for `src/pages/boq-wizard/` (baseline 0). `python3 scripts/residence_check.py` before each commit.
- `qty_by_area` is **dict-JSON** → assign directly, NEVER `json.dumps`. `attached_notes` stays list-JSON.
- Lock stays **server-authoritative**; do NOT re-add a client `onEditIntent` (prior E2E bug). Sentinels −1 root /
  0 not-attached. `sheet_name` verbatim. Commit-before-publish.

## Slice 1 — Create-flow restructure + single-area quantities  *(COMMITTED `6e1a9cb3` + LIVE-E2E-VERIFIED 2026-07-09)*

**AS-BUILT (2026-07-09):** all edits below landed. `tsc --noEmit` boq-wizard scope = **0 errors**;
`test_create_from_template` **26** green (+3: tax/notes persist, invalid-tax default, 3-arg caller),
`test_review_screen` **250** green (+3 `TestMarkTemplateQtyGate`: missing-qty blocks, qty-present
finalizes, excluded no-qty doesn't block). Backend = `create_from_template.py` (additive
tax_treatment/notes) + `review_screen.py` (template-only qty gate). Frontend = `ReviewTree.tsx`,
`SheetReviewPage.tsx`, `boqTypes.ts` (review customizations, all `templateOrigin`-gated default-off) +
`BoqPickerPage.tsx` (mode chooser, template button removed from bare page), `TemplateCreateFlow.tsx`
(BoQ-details card: Version RO / GST / Notes), `BoqUploadScreen.tsx` (optional `onBack`). NOT synthetic
columns — the master already carries `qty_total` (verified). **PENDING: live chrome-devtools E2E as
Admin/Estimates; NOT committed yet.**

**KEY VERIFIED FINDINGS (adversarial pass, 2 confirmed / 1 refuted):**
- **NO synthetic column injection needed.** The active master `BOQTPL-00020` already carries a `qty_total`
  `column_role_map` entry keyed by a REAL Excel letter on every DATA sheet (Electrical="F", HVAC/FA/PA/WLD/
  Data&Networking="D", CCTV="C", Access="D"); general-specs sheets correctly carry none. The clone copies
  `sheet_config` VERBATIM → `review_screen._build_column_descriptors` emits an editable `qty_total` descriptor
  (visible + in `EDITABLE_VALUE_FIELDS`) for free. Commit: `_build_node_pass1` `qty=d.get("qty_total")` →
  `BOQ Nodes.qty`. **Slice-1 backend needs ZERO column-map code.**
- **REFUTED — never use a non-Excel-letter key.** The parser's `SheetConfig.column_letters_must_be_valid`
  (`services/boq_parser/config.py:29`, `^[A-Z]+$`) runs LIVE on every hub load via `get_stale_sheets` — a
  `__QTY__`/`__QTY__::<area>` key throws "Saved configuration is no longer valid" and spuriously flags the sheet.
  Any future qty-column synthesis (or Slice-2 multi-area) MUST use REAL free Excel letters, not sentinels.
- **CONFIRMED upload byte-identical** (all 10 FE edits are no-ops when `templateOrigin=false`) and **CONFIRMED
  finalize gate is upload-safe** (scoped `if origin=='template'` inside `mark_sheet_parsed_check_done`).

**Backend edits** (`api/boq/wizard/`):
- `create_from_template.py` @256: add additive `tax_treatment=None, notes=None`; persist before insert @325-333
  (`_ALLOWED_TAX={'Pre-tax','Post-tax'}`, default 'Pre-tax' on invalid; `if notes: doc.notes=notes`). version untouched.
- `create_from_template.py` clone worker/`_copy_template_row`: **NO CHANGE** (sheet_config copied verbatim; qty blank).
- `review_screen.py` `mark_sheet_parsed_check_done` @2722: read `origin`; extend the included-rows fetch @2794 with
  `qty_total`; AFTER the structural `if breaks` return, add `if origin=='template':` qty-gap check (selected
  `line_item`, falsy `qty_total` — STRICT, no rate-only exemption) → `{ok:False, breaks:[], qty_gap:N}`.

**Frontend edits** (`src/pages/boq-wizard/`):
- `BoqPickerPage.tsx`: on `?project=`, add mode chooser (`'choose'|'upload'|'template'`); route to `BoqUploadScreen`
  or `TemplateCreateFlow`; REMOVE the bare-page Create-from-Template button + orphaned mode branch.
- `TemplateCreateFlow.tsx`: add Version (read-only "Auto-assigned on create"), GST `Select`→`tax_treatment`, Notes
  `Textarea`; extend `handleCreate` payload with `tax_treatment`+`notes`.
- `ReviewTree.tsx`: new `templateOrigin?: boolean` (default false, SEPARATE from `templateControls`); extend
  `displayDescriptors` filter @904 (+dep) to hide `role.startsWith('rate'|'amount')` for template; `totalCols` base
  `8 → 8-(templateOrigin?2:0)` @2064; wrap Status (th @1842 / td @2225) + AI Rec (th @1887 / td @2248) in
  `{!templateOrigin && …}`; inline uncontrolled numeric input for the `qty_total` descriptor cell @2394 (silent save
  via existing `saveCall` on blur/Enter, `onEditIntent` client-lock only — NO server re-acquire).
- `SheetReviewPage.tsx`: `geminiEnabled={geminiEnabled && !isTemplateOrigin}`; pass `templateOrigin={isTemplateOrigin}`;
  wrap Run AI pass + compose Run Gemini with `!isTemplateOrigin`; add `qtyGap` to Mark-Finalized disabled+tooltip.
- `templateSelection.ts`: **NO CHANGE** — the existing metric (selected `line_item` with falsy `qty_total`) is
  already the STRICT rule (owner chose strict 2026-07-09: rate-only rows must also carry a qty; the inline cell
  makes it satisfiable).

**Highest-risk edit:** the `totalCols` base-8 decrement MUST land in the same change as the Status+AI-Rec hides, or
the flag-reasons colSpan @2420 + detail-panel colSpan @2441 desync by 2. **New UI (mode chooser + form fields) via /frontend-design.**

**Verify:** single-area template → review shows structural + Total Quantity only, rate/amount/Status/AI-Rec/Gemini
hidden, tree intact on flagged/expanded rows → type qty inline → finalize blocked until selected line-items have qty
→ commit builds nodes with scalar `qty`. Upload review unchanged. tsc delta-0; bench `test_create_from_template` +
`test_review_screen` extended; vitest `templateSelection`.

## Slice 2 — Multi-area (layers on Slice 1)  *(COMMITTED `6e1a9cb3` + LIVE-E2E-VERIFIED 2026-07-09)*

> ⚠️ **COLUMN MODEL SUPERSEDED (2026-07-15) by `RECTIFICATION ROUND (R)` § R-T1 / ADR-0013 Amendment A2-D1.**
> The "Design A un-collapse / append-after-max" algorithm below (drop `qty_total`, append area cols + a new Total
> *after* the sheet's last column) is replaced by **insert-before-Total**: keep the master `qty_total`, insert the
> area cols immediately before it, shift Total+rates+amounts+notes right by N. The per-area inline cells + read-only
> summed Total (now **live** client-side) remain. Read R-T1 as current for the column layout.

**LIVE E2E (chrome-devtools, Administrator, :8080) — BOTH SLICES GREEN 2026-07-09:** single-area BOQ-26-00106
(mode chooser → form → clone → review: Status/AI-Rec/Rate*/Amount*/Gemini HIDDEN + inline Total-Quantity +
finalize gate disabled→enabled → inline save persisted → finalize → commit v1 → 15 Line-Item nodes qty=1) +
multi-area BOQ-26-00107 (Multi toggle + DefineAreasDialog Tower A/B → clone → review: `I — Quantity·Tower A`,
`J — Quantity·Tower B`, `K — Total Quantity` (real letters, area cols before Total) + per-area edit re-summed
qty_total + read-only Total shows sum → finalize → commit v1 → 15 nodes qty=5 + `BOQ Node Qty By Area`
Tower A=2/Tower B=3). Test BoQs cleaned up. **NOTE: master `BOQTPL-00020` reactivated (is_active=1) during E2E.**


**AS-BUILT (2026-07-09):** all edits below landed. `tsc` boq-wizard **0**; `test_create_from_template` **34**
green (+8: pure `_apply_areas_to_sheet_config` ×2, worker multi-area rewrite/seed/single-area ×3, endpoint
shell area_dimensions ×3), `test_review_screen` **252** green (+2 `TestTemplateResumQtyTotal`: template re-sum
fires, upload does NOT). Backend = `create_from_template.py` (`areas` param + `_apply_areas_to_sheet_config`
helper + shell `area_dimensions` + per-data-sheet config rewrite + row `qty_by_area` seeding) + `review_screen.py`
(`_apply_and_save_row_edit` template-scoped `qty_total` re-sum). Frontend = new `DefineAreasDialog.tsx` +
`TemplateCreateFlow.tsx` (Single/Multi toggle + areas payload + ≥2-area gate) + `ReviewTree.tsx` (`hasPerAreaQty`,
`saveAreaQtyInline`, three-way cell: single-area `qty_total` inline / per-area `qty_by_area` inline / multi Total
read-only). **Gotcha hit + fixed:** the sheet-config rewrite edit was initially missed (only seeding landed) →
`test_multi_area_rewrites` caught it. Commit path unchanged (audit-confirmed). **PENDING: live E2E (multi-area
create → per-area entry → summed Total → all-zero finalize block → commit round-trip); NOT committed yet.**

**Design A ("un-collapse", the inverse of `_collapse_to_single_area`):** for areas `[X,Y]`, each DATA sheet's
`column_role_map` DROPS its single `{role:"qty_total"}` entry and APPENDS, on fresh REAL Excel letters after the
sheet's max column, `{role:"qty",area:X}` + `{role:"qty",area:Y}` + `{role:"qty_total"}` (Total LAST/highest →
sorts after the area cols). Parser singleton cap ⇒ old qty_total MUST be dropped (only one allowed); `qty` is
non-singleton ⇒ N allowed. Review emits N editable `qty_by_area` cells + 1 read-only Total; `qty_total=sum(areas)`
maintained at one chokepoint. **NEVER a non-`^[A-Z]+$` key.**
- **`create_from_template.py`:** `areas` param (JSON-string/list, normalize like `sheet_names`); write
  `BOQs.area_dimensions = json.dumps(areas)` when non-empty; thread to `_clone_worker`; new pure
  `_apply_areas_to_sheet_config` (openpyxl `get_column_letter`/`column_index_from_string`, append-after-max, Total
  last); rewrite each sheet gated `areas and tmpl_sheet.disposition != "general_specs"`; seed eligible
  (line_item/preamble) rows `qty_by_area={a:0.0}` (dict-JSON, ASSIGN DIRECT — not in `_LIST_JSON_FIELDS`) +
  `qty_total=0`.
- **`review_screen.py`:** re-sum in **`_apply_and_save_row_edit`** (task's "_apply_field_edit" was a MISNOMER),
  AFTER `setattr(doc, field, current)`, gated `field=="qty_by_area" and origin=="template"` → `doc.qty_total =
  sum(current.values())` (rides the existing `doc.save()`). Upload multi-area untouched (origin!="template").
- **`TemplateCreateFlow.tsx` + new `DefineAreasDialog.tsx`:** Single/Multi toggle (default Single) + area-names
  dialog (lean, from `SheetConfigPanel` Multi branch minus config side-effects); `handleCreate` threads
  `areas: isMultiArea ? cleanAreas : []`; create gate needs ≥2 areas for Multi.
- **`ReviewTree.tsx`:** `hasPerAreaQty = displayDescriptors.some(d=>d.value_field==="qty_by_area")` (returned from
  the descriptor useMemo); Slice-1 `isInlineQty` gains `&& !hasPerAreaQty` (single-area only); new `isInlineAreaQty`
  (`value_key!==null && value_field==="qty_by_area"`) → inline `saveAreaQtyInline` (field `qty_by_area`, `area`);
  multi-area Total falls through to read-only `renderDescriptorCell(row.qty_total)`.
- **Commit unchanged** — `_explode_area_children` + `node.qty=qty_total` + T5b `_invert_rows_to_grid` handle both
  `qty` and `qty_total` cols (confirmed, degrades missing→blank). **Verify (open-risk #1) in test #7.**
- **Verify:** single-area/upload byte-identical; `_apply_areas_to_sheet_config` unit + `SheetConfig.model_validate`
  + `_build_column_descriptors` order; get_stale_sheets not-stale; seeding; re-sum (template vs upload); all-zero
  finalize block; commit nodes + BOQ Node Qty By Area; tsc; live E2E.
- **Open:** confirm `BoQ Template Sheet.disposition` field name (#2); seed-to-0 shows "0" in cells (matches "0 by
  default"); area rename post-clone OUT of scope (areas locked at create per Q9).

## Slice 3 — Templates-admin polish  *(uses `/frontend-design`)*
- Sidebar move (Q7). `TemplateEditorPage` full-width (`flex-1 space-y-4`) + TABBED (header: template/sheet info +
  Activate switch + Seed/Reseed; tabs MEP BoQ Details / Template Rows). `TemplateRowsEditor` fuzzy search
  (`boqDescriptionSearch.ts`) + reworked add-above/below icons+placement. Seed/Reseed warning AlertDialog +
  Upload-BoQ entry embedded in a dialog → navigate to hub on success.

## Deferred (out of scope, documented)
Post-create area editing; per-sheet area sets; per-sheet reseed; inline qty on upload-origin BoQs; the
pre-existing `attached_to_index` 0-sentinel edge.

---

# RECTIFICATION ROUND (R) — 2026-07-15 — owner review fixes + from-scratch priced export

**Status:** ✅ **AS-BUILT + LIVE-E2E-VERIFIED (2026-07-15)** — grill-locked (`/grill-with-docs` +
`/domain-modeling`, 9 decisions); design of record = **ADR-0013 Amendment A2** + **CONTEXT.md** terms.
Branch `feature/boq-create-from-template` (local/unpushed). **Slice 3 (templates-admin polish) stays ON HOLD.**

**Commits:** `dd1a2391` docs (ADR A2 + this plan + CONTEXT) · `686c44ce` Wave 1 (R-T1/R-T2/R-T4) ·
`612cf6f3` Wave 2 (R-T3/R-T5) · `cc99d44e` R-T3 export refinement (blank unpriced rate/amount).
**Gate (all green):** tsc boq-wizard **0** · `test_create_from_template` **35** · `test_review_screen` **252**
· `test_export_writeback` **22**.
**Built via implement→adversarial-verify Workflows** (Wave 1 + Wave 2); every confirmed finding fixed
(R-T2 medium: non-qty rows showed "0" → blank; R-T4 sheet-deselection dirty-guard + single-doc header fetch;
R-T3 medium: amount formulas on every row → priced-rows-only + skip committed-grid rate/amount 0s).
**Env repair (pre-existing):** the `BoQ Template` doctype metadata had been dropped from the runtime DB by a
develop-branch `bench migrate` (tables+data intact, tabDocType rows gone → `get_meta` failed → the live template
flow was broken); owner ran `bench migrate` on this branch to restore it. Fixed 1 surfaced test failure (the
`_SHEET_A` fixture lacked a `qty_total` anchor — unrealistic; made it realistic). `BOQTPL-00020` was `is_active=0`
and reactivated (the intended state; it flips off periodically — investigate).
**LIVE E2E (chrome-devtools, Administrator, :8080, 2026-07-15):** R-T4 one-screen toggle (no chooser gate) ✓ ·
R-T5 Tower A/Tower B badges + ✕-remove + Edit ✓ · fresh multi-area clone `BOQ-26-00117` (PA+Make List) via the
real worker → review shows `D·Tower A E·Tower B F·Total Quantity` (**area cols before Total**, R-T1) ✓ · live-sum
Total (Tower A=5, Tower B=3 → **Total=8** as-you-type, R-T2) ✓ · **in-app "Download priced tender" on committed
`BOQ-26-00107` → 200 + valid .xlsx** (R-T3 — the original "source file missing" pain, fixed) ✓. Export also
proven against real committed data (00107 → Summary + GST@18% + cross-sheet formulas + synthesized headers +
live amount formulas + `=SUM` Total). Test clone cleaned up. **Aside:** `sidebar_counts` endpoint returns 500
in this dev env (pre-existing, UNRELATED to this round — flagged for separate investigation).

Four owner rectifications to the shipped A2 build:
1. **R1 — one-screen mode selector.** Fold Upload-vs-Template selection into a persistent toggle at the top of the
   project-scoped upload screen; drop the redundant full-screen "New BoQ" chooser gate (`projectMode==="choose"`).
2. **R2 — areas as editable badges.** Show defined multi-area names as badges with ✕-remove + an Edit button.
3. **R3 — insert-before-Total columns + live Total.** Multi-area qty columns go *before* the existing Total column
   (Excel insert-column, shift-right); Total = live client-side sum. (ADR A2-D1.)
4. **R4 — from-scratch priced download.** Generate the priced Excel from committed data for template BoQs — full
   tender package (data sheets + Make List + computed Summary). Fixes the "source file missing" throw. (ADR A2-D2.)

## Locked decisions (grill 2026-07-15) — rationale in ADR A2
- **D4 (R3 backend):** rewrite `_apply_areas_to_sheet_config` to insert-before-Total / shift-right; keep the master
  `qty_total` (repurposed as the sum); **supersedes** Slice-2 append-after-max.
- **D5 (R3 frontend):** Total = live derived Σ in an isolated per-row `<AreaQtyCells>` component (blank=0 running
  sum; save-on-blur; server authoritative; NOT a stored formula record).
- **D1 (R1):** `BoqPickerPage` hosts one shared header + persistent Upload|Template toggle; active sub-component
  inline via a new `embedded` prop on `BoqUploadScreen` + `TemplateCreateFlow`; only the active mode mounted;
  toggle only on the project-scoped screen.
- **D2 (R1):** default = Upload; dirty-guard confirm on switch (Upload dirty = `droppedFile` set or
  `uploadStatus≠"idle"` — prevents stranding a created BoQ; Template dirty = fields typed / areas defined).
- **D3 (R2):** flex-wrap badge row from `cleanAreas`; per-badge ✕ remove (index-safe via
  `setAreaBoxes(cleanAreas.filter((_,i)=>i!==idx))`); one "Edit areas" button reopens `DefineAreasDialog`; ≥2-area
  gate unchanged; `DefineAreasDialog` untouched (no `focusIndex`).
- **D6 (R4):** amount cells = live Excel formulas (translate `BoQ Cell Amount Formula` AST → Excel `=…`);
  qty+rate static; Total-Qty = `=SUM(areas)`; per-sheet grand-total row.
- **D7 (R4):** from-scratch + light styling (synthesized bold headers, column widths, currency number-format,
  thin borders). Original template formatting NOT reproduced (non-goal).
- **D8 (R4):** full package — data sheets + Make List (verbatim `preamble_text` line-dump) + regenerated Summary
  (per-sheet rollup, Particulars=`sheet_label`/name, Supply/Install/Total as **live cross-sheet formulas**;
  `Total Excl. Taxes → GST @ 18% [Pre-tax only] → Grand Total`; Post-tax = amounts final, no GST line; drop the
  6th per-sqft column).

## Guardrails (this round)
- **Upload flow byte-identical** — all gates `origin==="template"` / `templateOrigin` / `embedded` default-off;
  single-area path unchanged. `tsc` boq-wizard delta-0. `python3 scripts/residence_check.py` before each commit.
- `_apply_areas_to_sheet_config` operates on the **pristine master** config each run (idempotent); keys stay real
  `^[A-Z]+$` (openpyxl `get_column_letter`); `qty_total` singleton preserved; **`column_headers` re-keyed in
  lockstep with `column_role_map`** (the one shift hazard). `qty_by_area` dict-JSON (assign direct).
- Export template branch: **reject-mutates-nothing** (no `last_exported_at` on failure); `frappe.db.set_value`
  (not `doc.save()`) for list-JSON; `sheet_name` verbatim; S3 avoided entirely; upload path (`data_only=False`,
  `_assert_fidelity`) untouched.
- Lock stays **server-authoritative** (no client re-acquire). Sentinels −1 root / 0 not-attached.

## Execution Strategy (plan-to-parallel — survives context clearing)
Dependency-ordered; **R-T1 (backend column model) is foundational** — R-T3 (export) reads the committed layout it
produces. Create tasks with `TaskCreate`, set deps with `TaskUpdate`, launch each wave as parallel subagents
(worktree isolation where files overlap). `BOQ-26-00107` is **stale old-layout** test data — verify with a FRESH
clone, do not migrate it.
- **Wave 1 (parallel — disjoint files):** R-T1 (`create_from_template.py` + tests), R-T2 (`ReviewTree.tsx`),
  R-T4 (`BoqPickerPage.tsx` + `BoqUploadScreen.tsx` + `TemplateCreateFlow.tsx`).
- **Wave 2:** R-T5 (badges — `TemplateCreateFlow.tsx`, **after R-T4**: same file), R-T3 (export —
  `export_writeback.py` + tests, **after R-T1**: reads new committed layout).
- **Wave 3:** R-T6 live E2E.

## Task detail

### R-T1 — `_apply_areas_to_sheet_config` → insert-before-Total (Wave 1) `[backend]`
- Rewrite the pure helper: find the master's single `{role:"qty_total"}` letter **T** (index *t*). Insert N
  `{role:"qty",area}` at indices `[t … t+N-1]`; **shift every column with index ≥ t right by N** (qty_total→t+N;
  rates/amounts/notes follow). Re-key `column_role_map` **and** `column_headers` together; set each area column's
  header = area name; preserve Total's header; `area_dimensions = areas`. Keys via `get_column_letter` (real
  `^[A-Z]+$`).
- Idempotent on the pristine master (as today); gated to DATA sheets with non-empty `areas`; general-specs +
  single-area untouched (byte-identical).
- Tests (`TestApplyAreasToSheetConfig`): **invert** the old `assertNotIn('F', role_map)` → assert `qty_total`
  KEPT + shifted; area cols sort immediately before Total; rates/amounts/notes shifted; `column_headers` lockstep;
  `SheetConfig.model_validate` passes; `get_stale_sheets` not-stale; `qty_total` singleton; rewrite idempotency.
  Reverify commit path (`node.qty=qty_total`, `_explode_area_children`) unchanged.

### R-T2 — live-sum Total in an isolated per-row component (Wave 1) `[frontend]`
- Extract the multi-area qty cells (per-area inputs + Total) from `ReviewTree`'s descriptor loop into a
  self-contained `<AreaQtyCells row descriptors onSaveArea>` holding **local per-area draft state**.
- Per-area input: controlled `value = draft[area] ?? saved`, `onChange` updates local draft, `onBlur`/Enter →
  `saveAreaQtyInline` (persistence unchanged). Total cell = live `Σ (draft[area] ?? row.qty_by_area[area])`,
  blank=0 (partial running sum), read-only. Only that row's cells re-render on keystroke — no whole-tree re-render,
  no grid-level draft plumbing, no memo refactor. Reconcile local draft with server value after refetch (key on
  saved value, mirroring the existing uncontrolled key). Single-area `isInlineQty` path unchanged.
- `tsc` delta-0; vitest for the sum helper.

### R-T3 — from-scratch template priced export (Wave 2, after R-T1) `[backend]`
- `export_priced_workbook`: `is_template = BOQs.origin=='template'`; gate the `source_file_url` guard + S3 fetch +
  copy + `_assert_fidelity` behind `if not is_template` (mirrors `commit_pipeline` D9/T5b).
- Template branch: fresh `openpyxl.Workbook()`; per ticked DATA sheet (verbatim name) read `BoQ Committed Sheet
  Grid` (is_current) + rows → write cells `{col_letter:value}` at `row_number`; **synthesize header labels** from
  column roles/areas at `header_row`. Overlay rates from `BoQ Cell Pricing` (is_current, is_filled) via reused
  `_stamp_rates`; reuse `_apply_colors`/`_apply_priced_highlight`/`_write_remark_column`. `_resolve_sheet_plan`
  reads `column_role_map`/`header_row` from BoQ Sheet (works for template).
- **Amounts** → live Excel formulas: translate each amount column's `BoQ Cell Amount Formula` AST → Excel
  `=<qty_cell>*<rate_cell>` using the row's actual cell addresses (fail-safe blank on missing operand). Total-Qty
  cell → `=SUM(<area cells>)` (multi) / static (single). Per-sheet **grand-total row** (`=SUM` per amount col).
- **Light styling**: bold synthesized header row, column widths, currency number-format on rate/amount cols, thin
  borders.
- **Make List** sheet: verbatim line-dump of general-specs `preamble_text` into column A.
- **Regenerated Summary** sheet: per-data-sheet rollup (Particulars=`sheet_label`/name), Supply/Install/Total as
  **live cross-sheet formulas** → each sheet's grand-total cells; `Total Excl. Taxes` → `GST @ 18%` (only if
  `tax_treatment=="Pre-tax"`) → `Grand Total`; Post-tax = amounts final (no GST line); drop the 6th per-sqft col.
- Reject-mutates-nothing; `frappe.db.set_value` for `last_exported_at`; upload path byte-identical.
- Tests: template export produces expected sheets (data + Make List + Summary) with correct cells / rates /
  amount-formulas / SUM / grand-total; Pre-tax vs Post-tax Summary; upload export unchanged. **Verify on a fresh
  clone** that `BoQ Cell Pricing.excel_row == committed grid row_number` (rate overlay lands on the right row).

### R-T4 — one-screen mode selector (Wave 1) `[frontend]`
- `BoqPickerPage`: `projectMode` → `"upload"|"template"` (default `"upload"`); **delete** the `"choose"` block +
  the dead `preProject` fetch; render one shared header + a persistent segmented toggle; conditionally mount the
  active sub-component inline (no `onBack`). Keep the two data hooks ABOVE the `if (preSelectedId)` early return
  (React #300).
- Add `embedded?: boolean` to `BoqUploadScreen` + `TemplateCreateFlow` (suppress own `<h1>` + outer width wrapper;
  keep footers) — mirrors the existing `TenderingProjectForm embedded` pattern in this file.
- **Dirty-guard** AlertDialog before switching if current mode dirty (Upload: `droppedFile` set or
  `uploadStatus≠"idle"`; Template: panel fields typed / areas defined). Toggle only on the project-scoped screen;
  bare `/upload-boq` project-picker unchanged. `tsc` delta-0. Toggle/header polish via `/frontend-design`.

### R-T5 — areas as editable badges (Wave 2, after R-T4) `[frontend]`
- `TemplateCreateFlow`: replace the comma-sentence (`~512-518`) with a flex-wrap `<Badge>` row from `cleanAreas`;
  each badge = name + inline `<button><X/></button>` remove (index-safe:
  `setAreaBoxes(cleanAreas.filter((_,i)=>i!==idx))`); one "Edit areas" button → existing `setAreasDialogOpen(true)`.
  ≥2-area gate (`areasReady`/`canCreate`) unchanged; badges under the `isMultiArea` guard only (single-area
  byte-identical); `DefineAreasDialog` untouched. `tsc` delta-0.

### R-T6 — live E2E verification (Wave 3) `[verify]`
- Fresh **single-area** + fresh **multi-area** clone (chrome-devtools, `:8080`). Verify: one-screen toggle +
  dirty-guard; badges (add / ✕-remove / Edit); multi-area review shows area cols **before** Total + **live-sum
  Total as you type**; finalize gate; commit; **price** the sheet(s); **download** priced Excel → data sheets
  (live amount formulas + grand-total row), Make List, Summary (per-sheet rollup + `GST @ 18%` for Pre-tax);
  upload flow unaffected. Fresh clones only (`BOQ-26-00107` is stale old-layout).
