# BoQ "Create from Template" — Implementation Plan

**Status:** Proposed, pending owner sign-off (ADR-0013). **No code until reviewed.**
**Design of record:** `docs/boq/create-from-template-locked-design.html` (18 decisions, Q1–Q18).
**Decision record:** `docs/adr/0013-boq-create-from-template.md` (D1–D10).
**Branch (when approved):** `feature/boq-create-from-template` off `develop`.

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
```
