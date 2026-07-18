# Revised BoQ — Implementation Plan

**Status:** PLAN — **pending owner (Nitesh) sign-off. No code written.**
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

1. **Near-match / "looks like original row 24"** (D6/D7). The typo case (`IP42` → `IP-42`) is REMOVED + NEW
   under the locked key, so classification *and* the hand-fixed parent are both dropped. D6 proved the fuzzy
   tier **layers on without changing the key** ⇒ additive later with **zero rework**. **Must be
   human-confirmed, never auto-applied** — it keeps the "silently carried a wrong decision" failure mode (the
   one failure the whole design is organised against) out of v1.
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
