# 13. BoQ "Create from Template" — flagged-BOQs templates, origin-uniform, is_excluded selection

Date: 2026-07-08

## Status

**Proposed — pending owner (Nitesh) sign-off.**

Grill-locked design (18 decisions, Q1–Q18), resolved via `/grill-with-docs` 2026-07-08.
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

### D9 — Post-finalize is untouched (Q8)
The template carries nothing for the pricing/tender stage. Commit → tender → pricing (including amount-formula
declaration) run identically to the upload flow. The **only** change below finalize is the `is_excluded=0`
filter (D5).

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
