# 13. BoQ "Create from Template" — flagged-BOQs templates, origin-uniform, is_excluded selection

Date: 2026-07-08

## Status

**Proposed — pending owner (Nitesh) sign-off.**
**Amended by [Amendment A1](#amendment-a1--2026-07-08--master-template-doctype-model) (2026-07-08):** the
templating *store* is redesigned — a single master lives in a **dedicated `BoQ Template` doctype** (not a
flagged `BOQs` doc), seeded once from a committed BoQ and thereafter hand-edited by admins. **A1 supersedes
D1, D2 (source), D4 (fields), and D10 in full; it reaffirms D3; D5–D9 and the create-flow mechanics are
UNCHANGED.** Read A1 as the current design; the original D1–D10 below are retained as the historical baseline
the grill started from.

Grill-locked design (18 decisions, Q1–Q18), resolved via `/grill-with-docs` 2026-07-08; **re-grilled on the
templating system 2026-07-08 → Amendment A1**.
Design of record (decision table + flows + reuse matrix): `docs/boq/create-from-template-locked-design.html`.
Full build plan: `frontend/.claude/plans/boq-create-from-template-plan.md`. Numbered `0013`
(highest existing is `0012`; historical `0002`/`0007`/`0008`/`0009` collisions are **not** renumbered — out
of scope).

## Context

The BoQ wizard has exactly one way to start a BOQ: upload a client Excel workbook, which is ingested
(`upload_file._upload_file_worker`) into a `BOQs` doc + per-sheet `BoQ Sheet Draft`s, then driven per sheet
through **Configure → Parse → Review → Finalize → Commit → Tender/Pricing**. Every sheet's structure,
classification, and parenting is *discovered* from the uploaded file.

There is a recurring need to build a BOQ **from scratch off a curated skeleton** — a standard MEP scope
(`MEP BOQ..xlsx`, 9 trade sheets: HVAC, Electrical, Data & Networking, FA, PA, WLD & RRS, Sprinkler, CCTV,
Access) whose classification and parenting are already correct. For such a build the user does not want to
re-configure and re-parse; he wants to **pick sheets, prune to the rows this project needs, type quantities,
and go**. Rates are decided later at the pricing/tender stage, exactly as today.

Three structural facts frame the design:

- **The template sheets are heterogeneous.** Header-row count and column maps differ per sheet
  (Electrical has two header rows + area-split quantities; CCTV swaps QTY/UNIT). There is no single global
  config — each sheet needs its own `sheet_config`. This is precisely the per-sheet `sheet_config` blob the
  Configure spoke already produces.
- **The hub/commit/tender machinery is status-driven and origin-agnostic.** Nothing downstream of the
  review rows cares *how* the rows were produced — only that a sheet is `Parsed`/`Finalized` and that
  `BoQ Review Row`s exist. This is the seam a template flow plugs into.
- **The parse worker requires a source workbook.** `parse_run` reads `BOQs.source_file_url`. A template-
  created BOQ has no uploaded file, so Configure/Parse are not merely skipped — they are *impossible*.

ADR-0010's residence rules (landed 2026-07-08) bear directly: **F3** ("near-twin flows are one parametric
module, not a copy") rules out a parallel `BoQ Template` doctype and a clean-room second review screen;
**F4** ("thin components over pure logic") shapes where the new selection/cascade math lives.

## Decision

Add a second wizard entry point — **Create from Template** — with the following load-bearing decisions.

### D1 — A template is a flagged `BOQs` doc, not a new doctype (Q1)
A template is a **project-less `BOQs` doc with `is_template=1`**, authored through the *existing* wizard and
**deep-cloned** on create. No `BoQ Template` / `BoQ Template Sheet` doctype (would be an F3-violating near-twin
of `BOQs`/`BoQ Sheet Draft`/`BoQ Review Row` with a dual-shape snapshot mapper). `BOQs.project` is already a
nullable Link, so a project-less BOQ is schema-legal.

### D2 — The clone flattens to a clean `Parsed` baseline (Q2)
On create, the template's **effective** classification/parent (`effective_classification`,
`effective_parent_index`) are flattened into the base parser fields; the human-edit overlay, AI/Gemini layers,
edit_log, warnings, and dismissals are **dropped**. Cloned sheets land at `wizard_status="Parsed"`. Because a
template BOQ has no `source_file_url`, **Configure and Parse are suppressed** for template-origin sheets, and
revert-to-parser-baseline = revert-to-template.

### D3 — Strip both rates and quantities (Q3)
The clone carries **structure only** — classification, parenting, unit, `sheet_config`. Quantities and rates
are blanked. The user supplies quantities in review/select; rates are entered fresh at pricing, as today.

### D4 — Origin-uniform BOQs; the marker lives at BOQ level (Q10)
A BOQ is **either** template-origin **or** upload-origin, never mixed (MVP). An `origin` field on `BOQs`
(`"upload" | "template"`) drives every hub gate with one check, not per-card.

### D5 — Selection is a durable `is_excluded` flag, honored at commit (Q4, Q18)
Selection persists as an **`is_excluded` Check on `BoQ Review Row`** (default `0` = selected; inert for
upload BOQs). Default all-eligible-selected; **both cascades** (deselect → whole subtree; select → ancestor
preamble chain, reusing the existing cycle-safe descendant DFS). Checkboxes on **eligible rows only**
(`preamble`, `line_item`); non-eligible rows (`note`/`spacer`/`subtotal_marker`/`header_repeat`) **ride along**
with their nearest eligible ancestor. The **finalize gate** (`structural_errors_for_sheet` +
`check_structural_integrity` + `derive_effective_levels`) and the **commit pipeline** both filter to the
**included subset** (`is_excluded=0`) — a deselected orphan must not block finalize, and excluded rows must not
become `BOQ Nodes`.

### D6 — Row creation: renumber-on-insert, template-only (Q5)
A new `create_review_row` endpoint inserts a `BoQ Review Row` above/below an anchor by **renumbering**
(`row_index ≥ insertion point` shifts +1, all parent pointers — `parent_index`, `human_parent ≥ 0` — remapped
atomically in one transaction; no schema change). New rows require classification (the 4 assignable:
`line_item`/`preamble`/`note`/`spacer`) + parent, are auto-selected, and participate fully in the gate.
`delete_review_row` removes **user-created rows only** (template rows are removed via deselect). Create/delete
**UI is exposed only in the template flow** — upload re-parse deletes-and-regenerates all rows and would
destroy created rows.

### D7 — Quantity input: line-items-only, single-area (Q6)
Quantity input is enabled on **selected `line_item` rows only** (preambles are always pure groups in the
template flow). Templates are authored **single-area** (no `qty_by_area`), so entry is one editable
`qty_total` cell per selected line item, reusing the existing `save_review_edit` write path and editable qty
descriptors (C-v2). First cut reuses the expand-to-edit panel; inline grid cells are a fast-follow.
Quantities are **optional at finalize** (rate-only "R.O" lines are valid) with a **soft advisory** ("N
selected lines have no quantity") that never blocks (Q14).

### D8 — Parametric screen, not a fork (Q15)
The Review-and-Select screen is the **existing `SheetReviewPage`/`ReviewTree`** extended with capability flags
(`selectable`, `canCreateRows`, qty-gate), driven by `origin==="template"`. The new selection/cascade math
lives in a pure, unit-tested `templateSelection.ts` (F4); per row-memo rules, selection reaches a row as its
own slice, never the shared Set.

### D9 — Post-finalize is untouched (Q8) — with the T5b grid amendment
The template carries nothing for the pricing/tender stage. Commit → tender → pricing (including amount-formula
declaration) run identically to the upload flow. The changes below finalize are limited to: the `is_excluded=0`
filter (D5); and **T5b (discovered during build):** the commit pipeline builds the committed *grid* tier by
re-opening the **source Excel** (`_extract_grid_rows`), which a template-cloned BoQ does not have. For
`origin == "template"` the grid is instead reconstructed from the review rows by inverting
`sheet_config.column_role_map` (`commit_pipeline._invert_rows_to_grid` / `_template_grid_rows`). This is safe
because a `grid_and_nodes` sheet's committed grid cells are **write-only downstream** (nothing reads them back —
pricing drives off the node tier; only the general-specs `grid_only` reference view reads cells, which is seeded
from `preamble_text`). The node tier is unchanged (it already reads review rows, filtered `is_excluded=0`). The
upload-origin commit path is byte-identical.

### D10 — Lifecycle, roles, execution (Q11, Q12, Q13, Q16, Q17)
- **Status** `Draft → Published → Deprecated` on the template BOQ; only **Published** appears in the create
  picker. Templates are filtered out of all normal project BOQ lists.
- **Roles:** *create-from-template* = the 5 wizard roles (Admin/PMO/Procurement/Estimates/Project Lead);
  *author/manage templates* = **Admin + Estimates Executive**.
- **Created BOQ:** `boq_name` defaults to `{project_name}_BOQ` (editable); version auto (`MAX+1`);
  project-bound; stamped `origin="template"` + `source_template`.
- **Clone execution:** **enqueued + socket** (`boq:template_clone_done` + poll fallback + on-mount recovery),
  mirroring the `upload_file`/`parse_run` long-job pattern; rows bulk-inserted via `frappe.db`.
- **Authoring entry:** **new-and-upload only** (MVP); "save existing BOQ as template" deferred.

### New schema (all additive, inert for the upload flow)
- `BOQs`: `is_template` (Check), `template_status` (Select: Draft/Published/Deprecated), `origin` (Select:
  upload/template, default upload), `source_template` (Link → BOQs).
- `BoQ Review Row`: `is_excluded` (Check, default 0).

## Consequences

**Positive.**
- Maximal reuse: the entire post-finalize half (commit/tender/pricing) is untouched save one WHERE filter;
  the qty write path, tree model, cascade DFS, and priceability spine are all reused.
- No near-twin doctype or screen (F3); new domain logic is pure and testable (F4).
- Additive schema — the upload flow is byte-unaffected (`is_excluded` default 0, `origin` default upload).
- Clean authoring: a template is built with the exact same UI as a real BOQ.

**Negative / accepted.**
- `is_excluded` and `origin` land on **shared** doctypes (`BoQ Review Row`, `BOQs`). Accepted over a
  template-only side table for simplicity and to keep the gate/commit filter a single WHERE clause.
- **Renumber-on-insert mutates the `row_index` keyspace** (described as "stable parse order"). Accepted:
  it is pre-commit, atomic, fully remapped, and the client re-fetches; nothing persists `row_index` across the
  finalize boundary. The alternative (`sort_order` field + backfill patch touching the shared `get_review_rows`
  sort) has a wider blast radius for a template-only feature.
- A template BOQ **cannot be re-parsed** — "start over" on a badly-mangled sheet means re-clone, not re-parse.
  Deselect-to-exclude + revert-to-baseline cover most recovery.
- **Editing a Published template changes what future clones get** (existing BOQs are point-in-time copies,
  unaffected). No formal version chain in MVP.

**Deferred fast-follows.** Inline grid qty cells (Q6c); save-existing-BOQ-as-template (Q17); add template
sheets to an existing BOQ post-create (Q7); mixing template + uploaded sheets (Q10); formal template
versioning (Q12); template-level amount-formula pre-seed (Q8).

---

## Amendment A1 — 2026-07-08 — master-template doctype model

**Trigger.** After the backend was built (8 commits, all green), the owner re-opened the *templating system*
(re-grill via `/grill-with-docs`, 2026-07-08). The requirement changed: there is **one master template**, not
a library of many; it is **seeded once** from a normally-committed BoQ and thereafter **hand-edited by admins**
as a persistent **admin setting**. This Amendment records the new design. **It supersedes D1, D2 (clone
source), D4 (schema/fields), and D10 in full, and reaffirms D3.** The selection/qty/review/commit mechanics
(D5, D6, D7, D8, D9 incl. the T5b grid amendment) are **UNCHANGED** — they operate on the *created project
BoQ's* review rows and are agnostic to how the template is stored.

### A1-D1 — A template is a dedicated `BoQ Template` doctype, not a flagged `BOQs` doc (supersedes D1)
The one master template lives in **new dedicated doctypes**, not on `BOQs`:
- **`BoQ Template`** — a *normal* doctype (not a Frappe `Single`), holding exactly **one master row** for MVP
  (normal doctype keeps named-templates a zero-cost future option; a `Single` would hard-code "exactly one"
  and cannot cleanly hold sheets→rows). Fields: `template_name`, `is_active` (Check), and provenance
  `seeded_from_boq` / `seeded_at` / `last_updated_by` / `last_updated_on`.
- **`BoQ Template Sheet`** — child table of `BoQ Template`: `sheet_name` (verbatim), `sheet_order`,
  `sheet_label`, `disposition` (`data` / `general_specs`), a **normalized single-area** `sheet_config` (JSON),
  `work_packages` (JSON list of `work_header` names — a JSON field **dodges the grandchild-serialization
  gotcha**; WP is otherwise a grandchild invisible to `get_doc`), and `preamble_text` (for general-specs seed).
- **`BoQ Template Row`** — a **separate doctype** keyed by `template` + `sheet_name` (mirrors how
  `BoQ Review Row` is its own doctype rather than a grandchild, dodging the serialization wall). Stores only the
  **structural subset**: `row_index`, `classification`, `parent_index` (**−1** sentinel), `attached_to_index`
  (**0** sentinel), `level`, `path`, `source_row_number`, `description`, `unit`, `make_model`, `is_rate_only`.
  **No** qty/rate/amount fields; **no** human/AI/gemini/edit_log overlay (already flattened at seed time).

**F3-override rationale (residence).** The original D1 chose the flagged-`BOQs` model **specifically to satisfy
ADR-0010 F3** ("near-twin flows are one parametric module, not a copy"). A1 **deliberately overrides F3** for
this concept, and the override is owner-approved (re-grill, 2026-07-08). Justification: a *singleton,
admin-managed, hand-edited master with its own lifecycle* is modelled **poorly** by a flagged row in the
project-BoQ table — it is a genuinely different entity (an admin setting), not a near-twin of a project BoQ.
The near-twin cost is bounded: the `BoQ Template Row` is a strict structural *subset* of `BoQ Review Row`, and
the create-clone/editor logic is *reused*, not copied.

### A1-D2 — Two-inversion pipeline; clone source moves to `BoQ Template Row` (supersedes D2)
The flatten-and-strip work moves **earlier**, to seed time; the create-clone becomes a straight structural copy:
- **Seed (materialize), one-time:** the committed seed BoQ's **`BoQ Review Row`s survive commit** (verified —
  `commit_pipeline` never deletes them), so materialize reads them directly, resolves `effective_*` via the
  existing `resolve_effective` (human>AI>parser), **strips qty/rate/amount**, **collapses multi-area →
  single-area** in `sheet_config`, and writes `BoQ Template Sheet` + `BoQ Template Row`. Carries WP + general-
  specs `preamble_text`. (Sourcing from review rows avoids reconstructing `parent_index`/`attached_to_index`
  from the `parent_node`-linked committed node tree — a large reuse win.)
- **Create (clone):** reads `BoQ Template Row` → writes `BoQ Review Row` at `wizard_status="Parsed"`,
  `is_excluded=0`. This is the **already-built `_clone_worker` producer, re-pointed at the template doctype as
  its source** — the flatten step is now a no-op (rows are pre-flattened), so it is a straight copy of the
  structural subset. `origin="template"` still suppresses Configure/Parse (no source workbook) — unchanged.

### A1-D3 — Strip rates + quantities; single-area only (reaffirms D3, adds normalization)
Confirmed: the template carries **structure only** — no rates, no quantities. Additionally, the template is
**single-area** (one quantity column, no `qty_by_area`); the materialize step **normalizes** any multi-area
source sheet (e.g. the MEP Electrical sheet's area-split columns) down to a single quantity column in the
stored `sheet_config`. Because qty *values* are stripped, this is purely a column-config normalization.

### A1-D4 — Schema on `BOQs` (supersedes D4's field set; keeps origin-uniformity)
`BOQs` **loses** `is_template` and `template_status` (templates no longer live on `BOQs`). It **keeps**
`origin` (`upload`/`template`) — the *created* BoQ still needs it to drive hub Configure/Parse suppression (T9)
and the commit-grid-from-rows branch (T5b). `source_template` is **repointed** from `Link → BOQs` to
`Link → BoQ Template` (provenance on the created BoQ). The origin-uniform rule (a BoQ is template- **or**
upload-origin, never mixed) is unchanged.

**Seed authoring BoQ.** The seed is authored as a **project-less dedicated** BoQ (uploaded + Configure/Parse/
Review/Commit exactly as today). To permit a project-less insert now that `is_template` is gone, a **minimal
single-purpose `is_template_source` Check** on `BOQs` replaces it — narrower semantics ("this is a scratch
authoring source for the master template," not "this row *is* a template"): it (1) permits the project-less
insert in `boqs.py::before_insert`, (2) hides the BoQ from project-facing lists, (3) gates the "Set as master
template" action. *(This field name is the one open detail flagged for confirmation at plan review.)*

### A1-D10 — Lifecycle, authoring, roles, editor (supersedes D10)
- **Singleton lifecycle.** No `Draft→Published→Deprecated` across N templates. One master with an **`is_active`
  Check** (only an active master appears in the create picker) + provenance (`last_updated_by`/`_on`). An admin
  flips the master inactive to make risky structural edits, then re-activates — protecting against mid-edit
  exposure without a draft-buffer copy.
- **Seeding (one-time).** A **"Set as master template" action** on a committed BoQ (Admin + Estimates gated)
  materializes it into `BoQ Template` (replacing any existing master). Upload→review→commit is the **one-time
  bootstrap only** — never re-run to update the master.
- **Extension (ongoing).** **Admin-edits-directly.** A **custom React template-editor** reuses the parametric
  `ReviewTree` in a "template-edit" mode (add/edit/delete/reparent rows with renumber-on-insert; add/remove/
  reorder sheets), pointed at `BoQ Template Row`/`BoQ Template Sheet` endpoints. **No merge engine, no
  re-upload:** new whole-sheet additions are **hand-built** in the editor.
- **Create picker simplifies.** With one master, the "select which template" step is **dropped** — Create-from-
  Template goes straight to the per-sheet checkbox picker of the master's sheets.
- **Roles.** *Create* = the 5 wizard roles (Admin/PMO/Procurement/Estimates/Project Lead) — unchanged. *Seed +
  admin-edit the master* = **Admin + Estimates Executive** (the new editor screen inherits this gate).

### A1 — what is REPLACED, PRESERVED, and REMOVED in the built backend
- **Replaced (rewritten against the new doctypes):** `create_from_template.py` (`list_templates` → a
  `get_master_template` reader; `create_from_template` clones from `BoQ Template Row`); `template_admin.py`
  (publish/deprecate/duplicate/delete-of-N → `is_active` toggle + seed-materialize + editor endpoints).
- **Preserved (create-flow half, UNCHANGED):** `template_select.py` (`set_row_excluded` cascade),
  `template_rows.py` (create/delete review row, renumber-on-insert), `is_excluded` gate + commit filter (T5),
  commit-pipeline **T5b** (grid-from-rows for `origin="template"`), the parametric review (T10/T11). These act
  on the created project BoQ's review rows and are agnostic to the template store.
- **Removed:** `BOQs.is_template` + `BOQs.template_status`; `upload_file.upload_file`'s `is_template` authoring
  param; the `BoqProjectTab.tsx` `is_template != 1` list filter (the seed BoQ is project-less + `is_template_
  source`-hidden instead). Their tests (`test_template_admin` and the flagged-BOQs parts of
  `test_create_from_template`) are deleted/rewritten.

### A1 — new schema (delta from D4/§"New schema")
- **New doctypes:** `BoQ Template`, `BoQ Template Sheet` (child), `BoQ Template Row`.
- **`BOQs`:** **remove** `is_template`, `template_status`; **add** `is_template_source` (Check, single-purpose);
  **keep** `origin`; **repoint** `source_template` → `Link → BoQ Template`. `BoQ Review Row.is_excluded`
  unchanged.

### A1 — consequences (delta)
**Positive.** A hand-edited admin master is a first-class entity with its own lifecycle; no more filtering
templates out of project BoQ lists; the editor and the create-review screen converge on one tree idiom; the
create-clone becomes a trivial pre-flattened copy. **Negative / accepted.** A new near-twin doctype trio
(F3-override, owner-approved); a real template-editor screen is net-new build; new whole-trade-sheet additions
are hand-built (no bulk append — accepted, rare); editing a live master changes what future creates get
(existing project BoQs are point-in-time clones, unaffected — same as before). **No data migration:** all
existing BoQs are `is_template=0` and the branch is local/unpushed, so the flagged-BOQs paths are deleted with
zero backfill.
