# BoQ Upload & Management — Implementation Plan

**Status:** Phase 2a + Phase 2b.1a + Phase 2b.1b complete and tested (incl. preamble candidate scoring). Phase 2b.2 Part A1 (reader merged-cell propagation) complete. Part A2 (ColumnRole multi-area extensions + validation) complete. Session 1 (Pattern-4 integration test) complete. Part A3 (multi-area detection) is next. Phase 2c (DB commit + version cascade + 4 more fixtures) follows.
**Owner:** Internal team.
**Last updated:** 2026-05-13 (after Session 1 — Pattern-4 integration test; 21 config tests, 111 parser tests, 188 total).
**Active branch:** `feature/boq-phase-2` (branched from `feature/boq-phase-1`)
**Latest commit:** Session 1 docs commit (`1d46c8f4`). Session 1 feat commit: `e150d1f0`.

> This is the active implementation plan. Long-term domain documentation will be moved to `.claude/context/domain/boq.md` after Phase 3 stabilizes. Decisions log is at the end of this file.

**Off-machine backup:** Full repo bundle at `C:\Users\nites\OneDrive\Desktop\nirmaan_boq_backup_2026-05-09.bundle` (17.23 MiB, OneDrive-synced). Created 2026-05-09 because tech-person Monday push pending. Bundle restorable on any machine with `git clone <bundle-path>`.

**GitHub push pending:** `feature/boq-phase-1` and `feature/boq-phase-2` to be pushed Monday 2026-05-11 by Nitesh's tech person (Nitesh has no push access).

---

## 1. Overview

Upload Bill of Quantities (BoQ) Excel files for projects, parse them into a structured hierarchical form, edit with audit, and use the parsed line items as anchors for downstream linkages — Work Headers / Milestones, Critical PO Tasks, PR/PO line items, and Delivery records.

BoQs in the wild are non-standard: variable column layouts, multi-level nested preambles, supply-and-install rates sometimes separate, sometimes combined. The system must accommodate this without rigid templates.

## 2. Goals

- Upload `.xlsx` BoQs and convert them into a queryable, editable structured form.
- Preserve hierarchy: **L1 Preamble → L2 Preamble → L3 Preamble → Line Item**.
- Multiple BoQs per project (e.g. Civil + MEP).
- Line items are the anchor for downstream linkages.
- Editable post-import with full audit trail.
- Robust against real-world Excel inconsistencies.

## 3. Non-goals (this iteration)

- Auto-generation of BoQs from drawings.
- Cross-project BoQ benchmarking.
- Vendor portal BoQ submission.
- Replacement of existing Work Headers / Milestones doctypes (we link to them, we don't replace them).

## 4. Users and access

Internal team only. Permissions follow project membership conventions used by `Procurement Requests` and `Procurement Orders`. CEO Hold (`integrations/controllers/projects.py`) gates any procurement-related actions in Phase 7.

## 5. Core design decisions

### 5.1 Parsing strategy: manual mapping + AI assist

Two approaches, used together:

- **Option B — Manual mapping UI.** User uploads any Excel, sees a preview, marks columns (Description, Qty, Unit, Supply Rate, Install Rate, etc.) and rows (L1/L2/L3 preamble, line item, header, total, skip). Examples-based fill auto-classifies similar rows.
- **Option C — AI assist.** Claude API pre-fills column mapping and row classifications. User reviews and corrects.

AI is used for **structural classification only** — what each row/column means. Numerical values (qty, rates) are always read deterministically from cells, never from AI output. Non-negotiable for financial data.

### 5.2 Tree storage: self-referencing Link with denormalized path

`BOQ Nodes` is a standalone doctype with a self-referencing `parent_node` Link and a denormalized `path` field (`"node_id_1/node_id_12/node_id_45"`).

We do **not** use Frappe's `is_tree` / lft+rgt nested sets — there's no precedent in this codebase, BoQ trees are small (hundreds of nodes), and TanStack Table's `getSubRows` natively renders self-referenced trees client-side. Recursive CTEs on Postgres handle subtree queries. The `path` field gives cheap subtree filtering when needed.

### 5.3 Hierarchical model

Preambles can nest to any positive depth (level ≥ 1). A soft warning is emitted above level 5 (unusual but allowed). Line items belong to the deepest preamble in their ancestor chain. Standalone line items (no parent) are allowed — they receive a warning but save successfully.

The original L1/L2/L3 constraint was too rigid for real-world BoQs which sometimes nest 4–6 levels deep. The stack-walk algorithm already handles arbitrary depth without changes; the validation layer was the only restriction.

### 5.4 Versioning

Each upload is a new version. Previous versions are marked Superseded, never deleted. Downstream linkages remain attached to the version they were created against. Carry-over of links across versions is a Phase 7e concern.

### 5.5 Tax treatment

Per-BoQ flag: `pre_tax` (default) or `post_tax`. Rates stored as captured.

### 5.6 Editability and audit

Line items editable post-import. Audit follows the **Nirmaan Versions pattern** already used for PRs/POs/SRs/payments — independently queryable, business-meaningful. We do not use a child-table audit log. Every edit captures a `reason`. If `Nirmaan Versions` lacks a `reason` field, add it (cross-cutting improvement; benefits other doctypes too).

### 5.7 Multiple BoQs per project

A project can have multiple co-existing BoQs (e.g. Civil, MEP, Electrical) as separate documents.

### 5.8 BoQ Nodes are standalone documents, not child rows

Following the Critical PO Tasks precedent. Nodes are individually queryable, updatable, and audit-loggable. Do not store nodes as a child table or JSON field on the BOQ — that's a known migration trap (see `procurement_list` → `order_list` history).

### 5.9 AI provider for Phase 4: Anthropic Claude API

Document AI is built for structured form extraction (invoices, IDs) and is unsuited to free-form spreadsheets with arbitrary layouts. The architectural pattern of `services/document_ai.py` and `api/invoice_autofill.py` is mirrored — opt-in, file_url-based, confirm-before-save, never auto-persist — but the underlying service is Anthropic's API. Model: `claude-sonnet-4-6`.

### 5.10 BoQ → downstream relationships are via dedicated linkage doctypes

In Phase 7 we create one linkage doctype per relationship type, each following the Critical PO Tasks pattern (standalone documents). BoQ Nodes do **not** auto-create Work Headers, Milestones, PRs, or POs — users explicitly create the linkages.

We avoid the legacy `$#,,,` delimiter pattern used in milestone reports.

## 6. Data model

### 6.1 BOQs

| Field | Type | Notes |
|---|---|---|
| name | string (auto) | Frappe ID |
| project | Link → Projects | required |
| boq_name | Data | e.g. "Civil BoQ v1" |
| version | Int | auto-incremented per (project, boq_name) |
| status | Select | Draft / Approved / Superseded |
| tax_treatment | Select | Pre-tax (default) / Post-tax |
| uploaded_by | Link → User | |
| uploaded_at | Datetime | |
| parsed_at | Datetime | |
| notes | Text | |

Source `.xlsx` is stored via **Nirmaan Attachments** (`associated_doctype = "BOQs"`, `associated_docname = name`), matching how PR/PO/SR attachments work.

### 6.2 BOQ Nodes

Single self-referencing table for both preambles and line items.

| Field | Type | Notes |
|---|---|---|
| name | string (auto) | Frappe ID |
| boq | Link → BOQs | required |
| parent_node | Link → BOQ Nodes | nullable; null for L1 preambles and orphans |
| node_type | Select | `Preamble` / `Line Item` |
| level | Int | 1, 2, or 3 for preambles; null for line items |
| sort_order | Int | preserves Excel row order within siblings |
| code | Data | optional dotted code, e.g. "1.2.3" |
| description | Text | required |
| source_row_number | Int | which Excel row this came from |
| path | Data | slash-separated ancestor IDs, denormalized |
| **Line item / amount fields** (null for preambles unless leaf): | | |
| unit | Data | |
| qty | Float | nullable; 0 is valid (rate-only items) |
| supply_rate | Currency | nullable |
| install_rate | Currency | nullable |
| combined_rate | Currency | nullable |
| supply_amount | Currency | computed unless explicitly overridden |
| install_amount | Currency | computed unless explicitly overridden |
| total_amount | Currency | computed sum |
| is_rate_only | Check | auto-set when qty=0 and at least one rate is set; common in tender BoQs |
| notes | Text | |

Indexes: `boq`, `parent_node`, `path` (for prefix queries).

### 6.3 Validation rules (in `integrations/controllers/boq_nodes.py`)

- If `node_type = "Line Item"`: `qty` must not be `None` (0 is valid for rate-only items); `level` must be null; at least one rate field should be set (warn if none).
- If `node_type = "Preamble"`: `level` must be a positive integer ≥ 1; warn (do not throw) if `level > 5`; qty/rates on a **non-leaf** preamble emit a warning (leaf preambles may carry qty/rate for tender computation — silent); `amount_override` suppresses the non-leaf warning.
- `parent_node` consistency (generic rule): a preamble at level N must have a parent at level N−1; a line item's parent must be a preamble (any level); standalone nodes (`parent_node` null) are allowed with a warning.
- `path` recomputed on save and on parent changes.
- `is_rate_only` auto-set in `before_save`: true when `qty == 0` and at least one rate field is set; false otherwise.
- Amount fields auto-computed from qty × rate unless `amount_override` is set. When `qty == 0` and rates are set, amounts compute to 0 correctly (`(supply or install)` logic replaced with `any([supply_rate, install_rate])` check).

### 6.4 Audit

Use **Nirmaan Versions** pattern. Phase 1 task: confirm Nirmaan Versions schema; if it lacks a `reason` field, add one. Every BOQ Node update from a user (post-initial-import) writes a Nirmaan Versions entry with the change diff and reason.

## 7. Parsing pipeline

### 7.1 Stages (`services/boq_excel_parser.py`)

1. **Read** — open `.xlsx` with `openpyxl` (already in `pyproject.toml`). Read both `data_only=True` (evaluated values) and `data_only=False` (formulas) to detect computed cells. Capture cell formatting: bold, indent, fill color, merged ranges, font size.
2. **Configure mapping** — accept a config dict: `{header_row, column_role_map, code_column, preamble_detection_rules}`.
3. **Classify rows** — assign each row a type: `preamble_L1`, `preamble_L2`, `preamble_L3`, `line_item`, `header`, `total`, `skip`. Three signals in priority order:
   - **Code-driven:** if a code column is mapped and value matches a dotted pattern (`1`, `1.2`, `1.2.3`), level = dot count + 1.
   - **AI classification** (Phase 4): pre-applied as starting point.
   - **Rule-driven fallback:** bold + no qty + indent depth → preamble of computed level; has qty + has rate → line item.
4. **Resolve hierarchy** — stack-walk algorithm (see 7.2).
5. **Validate** — flag warnings: orphans, empty preambles, level skips, missing units, total mismatches.
6. **Persist** — create BOQ + BOQ Nodes records in a single transaction.

### 7.2 Hierarchy resolution algorithm (deterministic)

```python
def assign_parents(classified_rows):
    # stack maps level (any positive int) -> node_id
    # Algorithm is depth-agnostic: handles L1..L3 and L1..LN equally
    stack = {}

    for row in classified_rows:
        if row.type == 'preamble':
            level = row.level  # any positive integer ≥ 1
            # Truncate stack: anything at level ≥ current is no longer an ancestor
            stack = {k: v for k, v in stack.items() if k < level}
            row.parent_id = stack.get(level - 1)  # None if level == 1 (root preamble)
            row.id = create_node(row)
            stack[level] = row.id

        elif row.type == 'line_item':
            if stack:
                deepest_level = max(stack.keys())
                row.parent_id = stack[deepest_level]
            else:
                row.parent_id = None  # standalone — flag warning, still saved
            row.id = create_node(row)
```

Handles: L1 directly followed by line items, L2 → L1 transitions, arbitrary nesting depth (L4, L5, …), uneven trees, standalone line items.

### 7.3 Examples-based row classification

After user marks a few exemplar rows, classify remaining by feature similarity:

- Features per row: indent level, bold/non-bold, has-qty, has-rate, fill color, font size, code pattern depth.
- Algorithm: nearest-neighbor over the feature vector. Rows matching a labeled exemplar with high overlap inherit the label.
- Ambiguous rows go to a "needs review" bucket shown to the user.

## 8. AI assist (Phase 4)

### 8.1 Architecture

`services/boq_ai_assist.py` mirrors `services/document_ai.py` shape:

- Receives `file_url`.
- Reads and converts top ~50–100 rows to a structured representation including formatting metadata.
- Calls Anthropic API (`claude-sonnet-4-6`) via `frappe.enqueue` (background job).
- Returns JSON: `{header_row, column_roles, row_classifications, confidences, reasoning_for_low_confidence}`.
- Caches result per file_url (don't re-call on revisit).
- Logs token usage.

### 8.2 Prompt (template, iterate against fixture corpus)

> "This is the top of a Bill of Quantities Excel sheet. Identify:
> 1. The row containing column headers.
> 2. For each column, its semantic role from: description, qty, unit, supply_rate, install_rate, combined_rate, supply_amount, install_amount, total_amount, code, skip.
> 3. For each data row, classify as: preamble_L1, preamble_L2, preamble_L3, line_item, header, total, skip.
>
> Use indentation, font weight, fill color, numbering pattern (e.g. '1.' is L1, '1.1' is L2, '1.1.1' is L3), and presence/absence of qty/rate values. A row with bold text and no qty is likely a preamble; level is determined by indentation or numbering depth.
>
> Return JSON only, with this schema: {…}. Include a 0–1 confidence per column and per row, plus a one-line reasoning for low-confidence rows."

### 8.3 Guards

- AI output is a *suggestion*; user must confirm.
- Numerical values (qty, rates) NEVER taken from AI output.
- Cap input at 100 rows per call.
- Cache result per file_url; never re-call on revisit.
- Log token usage.
- Confirm-before-save flow consistent with `invoice_autofill.py`.

## 9. Backend code placement

| File | Purpose |
|---|---|
| `nirmaan_stack/doctype/boqs/boqs.py` | Doctype class (autoname only). |
| `nirmaan_stack/doctype/boqs/boqs.json` | Schema. |
| `nirmaan_stack/doctype/boq_nodes/boq_nodes.py` | Doctype class (autoname only). |
| `nirmaan_stack/doctype/boq_nodes/boq_nodes.json` | Schema. |
| `integrations/controllers/boqs.py` | Lifecycle hooks for BOQs. |
| `integrations/controllers/boq_nodes.py` | Lifecycle hooks: validation, path computation, audit log writing. |
| `services/boq_excel_parser.py` | Pure parser (Phase 2). Minimal Frappe deps in core logic for testability. |
| `services/boq_ai_assist.py` | Anthropic API wrapper (Phase 4). Mirrors `document_ai.py`. |
| `nirmaan_stack/api/boq/upload.py` | Upload endpoint. |
| `nirmaan_stack/api/boq/parse.py` | Parse endpoint (config in → parsed tree out). |
| `nirmaan_stack/api/boq/save.py` | Save endpoint. |
| `nirmaan_stack/api/boq/ai_assist.py` | AI assist endpoint (Phase 4). |
| `nirmaan_stack/api/boq/edit_node.py` | Post-import line item editing (Phase 5). |
| `tests/fixtures/boq_samples/` | Sample `.xlsx` files for parser tests. |
| `nirmaan_stack/doctype/boqs/test_boqs.py` | Real tests. |
| `nirmaan_stack/doctype/boq_nodes/test_boq_nodes.py` | Real tests. |
| `tests/test_boq_excel_parser.py` (or co-located) | Parser unit tests. |

`hooks.py` updates: register `doc_events` for BOQs and BOQ Nodes pointing to the controller modules.

## 10. Frontend code placement

Match the **project creation wizard** structure exactly (`frontend/src/pages/projects/project-form/`).

```
frontend/src/pages/BoQ/
├── BoQUpload/
│   ├── index.tsx                 # Orchestrator (mirrors project-form/index.tsx)
│   ├── schema.ts                 # Zod schemas per step (mirrors project-form/schema.ts)
│   ├── constants.ts              # Step definitions (mirrors project-form/constants.ts)
│   ├── steps/
│   │   ├── index.ts
│   │   ├── UploadStep.tsx        # Project + name + file picker + tax treatment
│   │   ├── MappingStep.tsx       # Excel preview + column/row classification UI
│   │   ├── ParsedPreviewStep.tsx # Tree of resolved structure + warnings + inline edit
│   │   └── ConfirmStep.tsx       # Final review and save
│   └── hooks/
│       └── useBoQUploadData.ts   # Project list, existing BoQ check
├── BoQList/                      # Phase 6 — list view of BoQs per project
│   └── index.tsx
└── BoQViewer/                    # Phase 6 — read-only tree view of a saved BoQ
    └── index.tsx

frontend/src/zustand/useBoQDraftStore.ts          # Mirrors useProjectDraftStore.ts
frontend/src/hooks/useBoQDraftManager.ts          # Mirrors useProjectDraftManager.ts
frontend/src/components/ui/boq-parsing-dialog.tsx # Multi-stage progress dialog (mirrors project-creation-dialog.tsx)
```

**Reference implementations to study before writing each step:**

- `frontend/src/pages/projects/project-form/index.tsx` — orchestrator
- `frontend/src/pages/projects/project-form/schema.ts` — Zod patterns
- `frontend/src/pages/projects/project-form/steps/PackageSelectionStep.tsx` — toggleable optional sections (model for "manual vs AI parse mode")
- `frontend/src/pages/projects/project-form/steps/ReviewStep.tsx` — model for ParsedPreviewStep and ConfirmStep
- `frontend/src/zustand/useProjectDraftStore.ts` — draft store pattern with persist
- `frontend/src/hooks/useProjectDraftManager.ts` — persistence logic
- `frontend/src/components/ui/project-creation-dialog.tsx` — multi-stage progress dialog

**Tech stack constraints (from CLAUDE.md):**

- All Frappe access via `frappe-react-sdk`. No raw `fetch`.
- TanStack Table v8 for the tree view (use `getSubRows`). Use `useServerDataTable` `clientData` mode for fully-loaded trees.
- shadcn/ui for primitives; Ant Design only when matching nearby pages.
- Date formatting: `formatDate()` from `src/utils/FormatDate.ts`, dd-MMM-yyyy.
- `FuzzySearchSelect` for dropdowns with >50 options.
- `getSelectStyles()` inside Radix dialogs.
- Real-time events: `boq:created`, `boq:node:updated`, `boq:parse:complete`, wired via `SocketInitializer.tsx`.
- Routes added in `src/components/helpers/routesConfig.tsx` under `<ProtectedRoute><MainLayout>`.

## 11. UX flow

1. **Step 1 — Upload.** Pick project, name BoQ, drop `.xlsx`, choose tax treatment. Optional toggle: "Use AI assist" (Phase 4+).
2. **Step 2 — Mapping.** Sheet rendered as table preserving merged cells, bold, indentation. AI runs in background if enabled; spinner. Once ready, suggestions overlay applied (column roles labeled, rows colored by type, low-confidence cells flagged). User clicks columns → role dropdown; clicks rows → type dropdown; drag-selects for bulk; "Auto-classify similar rows" runs examples-based fill.
3. **Step 3 — Parsed preview.** Tree view of resolved hierarchy (TanStack Table with `getSubRows`). Inline-edit any field. Validation warnings panel.
4. **Step 4 — Confirm and save.** Multi-stage progress dialog (uploading → parsing → saving nodes).
5. **View.** Tree view of saved BoQ. Search, filter, export to Excel.

## 12. Edge cases (carry from earlier design)

| Case | Handling |
|---|---|
| L1 directly followed by line items | Stack-walk handles; line item parent = L1. |
| L2 followed by L1 | Stack truncates to empty on L1. |
| Same preamble title twice under different L1s | Separate nodes, no dedup. |
| Preamble with qty/rate (rare) | Allowed in schema with override flag; warn. |
| Mid-row preamble | Stack-walk handles. |
| Multiple disciplines stacked in one sheet | L1 boundaries separate them. Future "split here" UI. |
| Multiple sheets in one Excel | Open question — see §15. |
| Subtotal / Grand Total rows | Classify as `total`, skip in import, recompute fresh. Warn on mismatch. |
| Merged cells in description column | Use top-left cell value. |
| Cells with formulas | Read evaluated value; metadata flag computed=true. |
| Empty preambles | Warn, allow save. |
| Orphan line items | Warn, allow save with `parent_node = null`. |
| Level skip (L1 → L3) | Warn, allow save. |

### 12.1 Parser behaviors locked from sample analysis

The following behaviors are settled from analysis of the real BoQ corpus (JSW, Paytm, Inovalon, HYBE, Snitch). Do not re-open without a new sample driving the change.

- **Sheet-to-package mapping: 1 sheet = 1 package always.** The only exception is mid-sheet numbering resets (Inovalon HVAC pattern) which produce multiple implicit packages within one sheet — auto-detected by parser via "TOTAL ITEM NO. X" regex, user confirms in Phase 3 review.
- **"RO" / "ro" / "R/O" / "RATE ONLY" markers in qty cell** → treat as qty=0, is_rate_only=True.
- **Blank qty cell** → treat as 0.
- **AMC / Lump Sum / annual maintenance items** → standard rate-only treatment (qty=0, is_rate_only=True). Parser does NOT synthesize qty=1.
- **Description and Product Specifications columns** merge into single description with " — " separator (deferred to Phase 2b.2 when `description_specs` role is added to config.py).
- **Numbering reset mid-sheet** → auto-detect via "TOTAL ITEM NO. X" regex pattern; user confirms in Phase 3 review.
- **Pivot/matrix sheets** → skip.
- **Multiple general-notes sheets** → all append to master notes with separators.
- **HYBE-style Milestone/Product columns** → ignore (Phase 7 builds linkages).
- **Image columns** → ignore + parser warning.
- **Vendor WO / DT Reply / RC Rates / Drawing Qty columns** → ignore.
- **Missing Supply Rate column entirely** (e.g. Cuberoot FA, FPS) → mapping omits rate_supply role; controller sets amount_override=1 on resulting line items.
- **Combined-rate rounding mismatches** → parser surfaces as warning (does NOT throw); user resolves in Phase 3 review per row.

## 13. Phasing

Each phase = one feature branch (`feature/boq-phase-<N>`) → review → merge before next phase.

### Phase 0 — Project context *(complete)*
- `CLAUDE.md` enriched.
- This plan committed at `frontend/.claude/plans/boq-upload-plan.md`.
- Decisions log at end of this file.

### Phase 1 — Data model + manual entry *(2–3 days)*
- Doctypes: `BOQs`, `BOQ Nodes`. JSON schemas as in §6.
- Controllers in `integrations/controllers/`. Validation, path computation, amount auto-computation.
- Audit: confirm Nirmaan Versions schema; add `reason` field if missing; wire BOQ Node changes to write Nirmaan Versions entries.
- `hooks.py` `doc_events` updates.
- Real tests covering: path computation, amount computation, validation rules per node_type, parent-child consistency, audit log creation. Use `FrappeTestCase`. Aim for genuine coverage, not stubs.
- Permissions: match Procurement Requests / Procurement Orders conventions.
- **Exit:** can manually create a BoQ tree via Frappe Desk; tests pass.

### Phase 2a — Reader + Mapping Config schema ✅ COMPLETE & MANUALLY VERIFIED

**What it built:**
- Pydantic-based MappingConfig schema (`config.py`): MappingConfig, SheetConfig, ColumnRole, GlobalSettings, MasterBoqMetadata. Full validation: column letters `^[A-Z]+$`, role uniqueness, area-must-match-area_dimensions, header_row required for data sheets, master_preamble vs data sheet types.
- BoqReader class (`reader.py`) wrapping openpyxl: list_sheets() preserving exact names including whitespace; get_sheet_dimensions() (content-based); iter_rows() with lazy iteration and content-based dimension detection on empty sheets; detect_header_row() weighted-keyword heuristic with row-shape guards; detect_blank_columns(); get_master_preamble_text().
- RawRow + CellInfo dataclasses capturing: computed values, formulas, merged ranges, bold formatting, fill RGB, indent.
- Synthetic fixture generator producing 7 .xlsx test fixtures (committed to repo): synthetic_simple, synthetic_merged_header, synthetic_trailing_spaces, synthetic_blank_cols, synthetic_empty, synthetic_sparse_header, synthetic_makelist_header.
- 35 new tests (14 config + 21 reader), all passing. Phase 1.x: 77/77 still passing.

**Two bugs fixed:**
1. `detect_blank_columns` couldn't see column Z because openpyxl's `max_column` only reflects written columns. Fixed by writing `ws["Z1"] = ""` in the test fixture to extend `max_column` to 26.
2. Empty sheets returning phantom blank row because openpyxl's `max_row` defaults to 1 after save/reload. Fixed by content-based dimension detection in `iter_rows()` when `end_row` not specified.

**Heuristic loosening (follow-up commit `c34b1440`):** Manual verification on real JSW BoQ revealed `detect_header_row` returned `None` for HVAC and ELEC Make List sheets (sparse multi-area headers and domain-specific vocabulary). Heuristic was loosened with weighted scoring (strong keywords +2pts: sl.no, s.no, sno, sr.no, description, item description; medium keywords +1pt: item, material, materials, details of materials, make/model, approved make, approved makes) and row-shape guards (≥3 non-empty cells, ≤1 cell with text >60 chars, not the last content row). 3 new tests + 2 new synthetic fixtures added. After loosening, all 3 real-file sheets returned correctly: Elect B1 → 2, HVAC → 5, ELEC Make List → 3.

**Manual verification done on real JSW Unpriced BoQ via Frappe console** — sheet listing exact, dimensions detected including stray content in column G that initial inspection missed (reader correctly returned (438, 7) — column G has values at rows 181 and 185), bold detection works, formulas captured, blank rows detected, header detection works on all 3 spot-checked sheets.

Branch: `feature/boq-phase-2`.

### Phase 2b.1a — Row classifier ✅ COMPLETE

**What it built:**
- `classifier.py`: RowClassification enum (PREAMBLE, LINE_ITEM, NOTE, SUBTOTAL_MARKER, SPACER, HEADER_REPEAT), ClassifiedRow dataclass, classify_row() pure function.
- Evaluation order: spacer → header-repeat (3+ keyword matches in mapped columns) → subtotal (text regex patterns OR =SUM( formula in any amount column) → qty extraction with RO-marker detection and blank-qty+rate rule → PREAMBLE / LINE_ITEM / NOTE decision.
- Handles RO/ro/R/O/RATE ONLY markers (qty=0, is_rate_only=True), blank qty cells (qty=0 when rates present), unit whitespace stripping, make_model passthrough, row_notes passthrough, numeric sl_no preservation as string, per-area raw qty capture (splitting deferred to 2b.2).
- Pure per-row logic — no tree-walking, no parent inference, no multi-area splitting.
- 17 new tests (asked for 12 minimum, +5 bonus for edge cases). All passing. Phase 1.x + Phase 2a tests: 129/129 still passing (28 BOQs + 49 BOQ Nodes + 14 config + 21 reader + 17 classifier).

Branch: `feature/boq-phase-2`. Commit: `9d8afac5`.

**Follow-up fix (ghost-note suppression):** Manual verification on real JSW Elect B1 revealed ~70 visually-empty rows being classified as NOTE because they contained leftover template formulas (e.g. `=N($D17)*N(E17)` evaluating to 0 with blank qty/rate). Added a post-extraction emptiness check after the classification decision: if classification = NOTE AND every extracted field (sl_no_value, desc_text, unit, qty, all rates, make_model, row_notes) is None/empty, override to SPACER and clear warnings. 1 new test (18 total classifier tests, 130 total). Commit: `ab99fb6c`.

### Phase 2b.1b — Hierarchy resolver ✅ COMPLETE

**What it built:**
- `hierarchy.py`: `ResolvedRow` dataclass (parent_index, level, path, attached_to_index, attached_notes), `ResolvedSheet` dataclass (rows, master_preamble_notes, warnings), `resolve_hierarchy()` pure function, `_determine_preamble_level()` private helper.
- Stack-walk algorithm with in-memory `path_cache: dict[int, str]` — avoids DB round-trips during bulk insert. `stack[i]` holds the resolved-row index of the most recent preamble at level i+1.
- **Note attachment:** notes attach to the topmost non-None preamble on the stack. Notes before the first preamble go to `ResolvedSheet.master_preamble_notes`.
- **Mid-sheet numbering reset:** SUBTOTAL_MARKER rows matching `^\s*total\s+item\s+no\.?\s+\d+` (case-insensitive) clear the stack entirely; subsequent preambles restart at level 1. Plain subtotals (e.g. "TOTAL CARRIED OVER") do not reset.
- **Level determination heuristic** (in order): pure integer → level 1; dotted-decimal (trailing `.0` stripped; ambiguous `1.0.0` → level 1) → len(parts) depth; single letter (A., B.) → level 1; PART-X → level 1; Roman numeral → level 1; digit+letter (1a) → level 2; digit.digit+letter (1.1a) → level 3; fallback to `sl_no` cell indent (indent+1); final fallback to stack_depth+1. Soft warning emitted for level > 5.
- 19 new tests across 4 families (tree shape, note attachment, special markers, level heuristics). All 72 parser tests passing (14 config + 21 reader + 18 classifier + 19 hierarchy). 77 Phase 1.x tests still passing.

Branch: `feature/boq-phase-2`. Commit: `fdb6eb64`.

**Follow-up fix (level_1_style detection — context-aware level determination):** Manual verification on real JSW Elect B1 revealed all 32 preambles classifying at level 1 (flat list, no tree) due to context-blind heuristic. Root cause: trailing-zero stripping rule for `1.0` produced level 1 even when `1.0` was a sub-section under a letter-coded parent. Fix: pre-scan sheet to detect first-preamble code style as `level_1_style` (one of letter/roman/numeric/part); subsequent preambles matching that style → level 1, different recognized style → level 2, multi-dot decimal → 1 + dots, lowercase letter → stack_depth + 1, unknown → fallback chain (cell indent → stack_depth + 1). Re-detects after mid-sheet "TOTAL ITEM NO. X" reset. Added `level_1_style_override` field to `SheetConfig` for Phase 3/4 manual override. Pattern Y multi-dot ambiguity emits warning category `ambiguous_level_pattern_y` and uses default depth — Phase 3 wizard resolves. Test count increased from 19 → 31 hierarchy tests; total parser tests 84 (14 config + 21 reader + 18 classifier + 31 hierarchy). Commit: `7f63e39a`.

**Second follow-up fix (lookahead-based level_1_style detection):** Manual re-verification on JSW Elect B1 (after the level_1_style fix) revealed sections C and D being mis-categorized because single chars C, D, L, M, I, V, X are valid Roman characters and match `_RE_ROMAN` before `_RE_UPPER`. A simple regex-order swap was attempted and reverted — it broke Paytm's legitimate Roman pattern starting at `I.` (where I, II, III sequences need single-char I to be Roman, not letter). Correct fix: lookahead-based detection in `_detect_level_1_style` that examines the first TWO level-1-eligible preambles. Unambiguous chars (A, B, E, F, G — not in [IVXLCDM]) return "letter" immediately. Ambiguous single chars (I, V, X, L, C, D, M) check the second preamble: multi-char Roman second (II, III...) → roman (Paytm I./II./III. pattern); single char alphabetically near (abs(ord) ≤ 3, e.g. C→D) → letter; both in Roman set and far apart → roman; else → letter. Plus a small special case in `_determine_preamble_level` so single-char Roman codes (C, D etc.) are accepted at level 1 on letter-style sheets (the categorizer still returns "roman" for them since `_RE_ROMAN` is unchanged). Handles both JSW alphabetic (A-G with C/D) and Paytm Roman (I-IV) correctly without regression. Test count increased from 31 → 36 hierarchy tests; total parser tests 89 (14 config + 21 reader + 18 classifier + 36 hierarchy). Commit: `90b0f0db`.

**Third follow-up addition (preamble candidate scoring + `is_synthetic` field for Phase 3 wizard):** Manual verification on real Inovalon HVAC BoQ revealed BoQ authors sometimes use unnumbered text-only rows as section headers (example: row 36 "Central Air Cleaner for AHUs" introduces line items 41-42 but has no sl_no). The classifier correctly labels these as NOTE since they have no sl_no, but Phase 3 wizard needs metadata to surface promotion candidates. Added `preamble_candidate_score: int` (0-5) and `preamble_candidate_signals: list[str]` to `ClassifiedRow` (both default to 0/[] — rows classified individually are unaffected). Score breakdown: bold +2, first-note-in-block-ending-at-line-item +2, short description (<80 chars) +1. Computed by new function `populate_preamble_candidate_scores(classified_rows, sheet_config)` called as a separate post-pass after individual row classification (Phase 2b.2's `parse_boq()` orchestrator will call it). Also added `is_synthetic: bool = False` field to `ResolvedRow` (parser never sets True) reserved for Phase 3 wizard's "create new preamble from scratch" action. Classifier classification and tree logic unchanged — this is data preparation only. Test count: classifier 18 → 26, hierarchy 36 → 37; total parser tests 98 (14 config + 21 reader + 26 classifier + 37 hierarchy). Commit: `481035ba`.

### Phase 2b.2 — Multi-area + first end-to-end fixture 🔧 IN PROGRESS (Part A1 ✅, Part A2 ✅ complete)

- Multi-area qty processing — populates qty_by_area per row from the qty_by_area_raw dict the classifier already captures
- First end-to-end test fixture using real Snitch BoQ (small, 4-sheet file, simple structure)
- Hand-written expected-output JSON for the Snitch fixture (~1 hour of careful work)
- parse_boq(file_path, config) entry point wiring reader + classifier + hierarchy resolver
- ~13 unit tests + 1 integration test using the Snitch fixture

**Part A1 complete (2026-05-10):** `iter_rows()` extended so that cells covered by a merged range (not the origin) now propagate the origin's `value`, `formula`, `formula_text`, and `merged_range` string into their `CellInfo`. `is_merged_origin` stays `False` for covered cells. Formatting fields (`font_bold`, `fill_color_rgb`, `indent`) are always the covered cell's own data — not inherited from the origin. Implementation: a per-invocation `covered_lookup: dict[(row, col), (range_str, value, formula_text, is_formula)]` built at the start of `iter_rows()` by walking `ws.merged_cells.ranges`; origin cells fall through to existing logic unchanged. 6 new tests in `TestMergedCellPropagation` class (origin unchanged, covered inherits range, covered inherits value, covered is not origin, formatting not inherited, two-row Pattern-2-shaped layout). Test count: reader 21 → 27; total 175 → 181. Commit: `ed860248`.

**Part A2 complete (2026-05-10):** `ColumnRole` Literal extended with 3 new roles: `amount_combined`, `qty_by_area`, `amount_by_area`. (`rate_combined` was already present; `total_qty` dropped — existing `qty_total` serves this role.) `_AREA_COMPATIBLE_ROLES` extended from 4 to 6 entries to include the two new per-area roles. New `area_required_for_by_area_roles` model validator enforces that `qty_by_area` and `amount_by_area` must have a non-empty `area` value; existing optional-area behaviour for `qty`, `amount_supply`, `amount_install`, `amount_total` is unchanged. Existing `area → area_dimensions` cross-check on `SheetConfig` applies automatically to the new roles (role-agnostic code). `GlobalSettings` gains `multi_area_reserved_keywords: list[str]` (22-entry locked default; `Field(default_factory=...)` pattern). 6 new tests (20 config total). Test count: config 14 → 20; total 181 → 187. Commit: `c70e186b`.

**Pre-implementation discrepancies surfaced and resolved:** (1) `rate_combined` already existed in Literal — dropped from addition list. (2) `total_qty` = same concept as existing `qty_total` — dropped; Part A3 populates `qty_total`. (3) `area_name` vs existing `area` field — resolved Option B: reuse existing `area` field, extend `_AREA_COMPATIBLE_ROLES`, add require-validator for new roles only. (4) Proposed Test 5 (area→area_dimensions cross-check for `qty_by_area`) was redundant with existing `test_area_referencing_undeclared_dimension_rejected` — replaced with combined `test_amount_combined_role_does_not_accept_area` (positive + negative assertions for `amount_combined`).

**Follow-up fix (2026-05-10, commit `c7f8912b`):** `amount_combined` was omitted from `_SINGLETON_ROLES` in the original A2 commit. Added adjacent to `amount_total` to match the amount-fields cluster. Parallel to `rate_combined` (already a singleton). The existing generic duplicate-rejection validator covers it automatically — no new test required. Test count unchanged at 187.

**Ops note (2026-05-10, commit `017b2a1a`):** `CLAUDE.md` Active Features row updated at the A2→A3 boundary — branch changed from `feature/boq-phase-0` to `feature/boq-phase-2`, spec path changed from `docs/boq-feature/spec.md` to `frontend/.claude/plans/boq-upload-plan.md`, `BOQ Node Audit Logs` corrected to `BOQ Node Qty By Area` (audit is via `Nirmaan Versions`), Phase 2 sub-phase split noted. Working agreement #13 (doc maintenance at sub-phase boundaries) should be extended to also require `CLAUDE.md` updates at each full phase boundary (i.e., when the Active Features table row would change).

**Session 1 complete (2026-05-13):** Added Pattern-4 integration test (`test_pattern_4_full_mapping_validates_successfully`) to `test_config.py`. Proves the Part A2 schema accepts a single-sheet config combining per-area qty + per-area amount + split supply/install rate + split supply/install total amount, all together. Pure in-memory construction — no reader/classifier/hierarchy involvement. Test count: config 20 → 21; parser total 110 → 111. Commits: feat `e150d1f0`, docs `see git log`. **Note:** test file lives at `nirmaan_stack/services/boq_parser/test_config.py` (NOT in `tests/` subdirectory — that directory holds only fixtures). Test runner command is `python -m unittest test_config test_reader test_classifier test_hierarchy -v` from the `boq_parser/` directory (pytest not installed in the bench env). **Note:** total 188 = 77 Phase 1.x (28 BOQs + 49 BOQ Nodes, run via `bench run-tests`) + 111 parser (run via unittest). The 111 pure-Python parser tests are the ones Claude Code can verify directly.

**Part A3 remaining:** `multi_area_detection.py` module — three-pattern auto-detection (Pattern 1 adjacent area-only labels, Pattern 2 two-row merged header, Pattern 3 single-row alternating label/AMOUNT pairs).

**Part B remaining:** classifier `amount_by_area_raw` capture; `parse_boq()` orchestrator; multi-area splitting post-pass; sum validation (sum per-area qty ≈ TOTAL QTY); Snitch fixture (hand-written JSON); 1 integration test.

### Phase 2c — DB commit + version cascade + 4 more fixtures ⏳ FUTURE

- commit_parsed_boq(parsed_output) writes master + sub-BoQs + nodes + qty_by_area to DB
- Version cascade (deferred from Phase 1.7) — re-upload triggers cascade: old master + old children → Superseded; new master + new children at v+1; missing-sheet handling per Q-Cascade-Missing decision (drop, not carry-forward)
- 4 more end-to-end fixtures (JSW Unpriced, Paytm, Inovalon HVAC, HYBE) using golden-with-review approach (run parser, eyeball output, save as expected)
- ~20 tests
- Manual back-office demo at end

### Phase 2 — Excel parsing engine (backend only) *(4–5 days)*
- `services/boq_excel_parser.py`: reader, mapping config schema (dataclass / Pydantic), classifier (code-driven + rule-driven), hierarchy resolver (stack walk), validator.
- Sample BoQ corpus: 3–5 anonymized real `.xlsx` files under `tests/fixtures/boq_samples/`. Each has an expected JSON.
- Parser unit tests covering all sample BoQs and every edge case in §12.
- No frontend, no AI, no whitelisted endpoints yet.
- **Exit:** from Frappe console, `parse_boq(file_url, config)` returns correct structured output for all samples.

### Phase 3 — Upload + mapping UI (manual flow) *(5–7 days)*
- Whitelisted APIs: `upload.py`, `parse.py`, `save.py` under `nirmaan_stack/api/boq/`.
- Frontend: BoQ upload wizard mirroring project-form structure (see §10). Steps: Upload, Mapping, ParsedPreview, Confirm.
- Excel preview with TanStack Table preserving formatting cues.
- Column role assignment (click header → dropdown). Row classification (click row → type dropdown). Drag-select for bulk. "Auto-classify similar rows" examples-based fill.
- Validation warnings panel.
- Multi-stage progress dialog mirroring `project-creation-dialog.tsx`.
- **Exit:** real user uploads a real BoQ Excel, manually maps, saves; saved data matches Excel.

### Phase 4 — AI assist *(3–4 days)*
- `services/boq_ai_assist.py` mirroring `services/document_ai.py`. Anthropic API integration. Prompt iteration against fixture corpus.
- `api/boq/ai_assist.py` whitelisted endpoint, background job dispatch.
- Frontend: spinner on Mapping step, suggestions overlay applied, confidence display, low-confidence rows highlighted.
- Cost guards: row cap, caching, token logging.
- **Exit:** typical BoQ requires <30s of correction after AI pre-fill.

### Phase 5 — Edit + audit UI *(2–3 days)*
- Inline editing of saved BoQ Nodes with reason capture (modal).
- Audit log viewer per node (reads from Nirmaan Versions).
- Re-upload as new version: creates v2 BoQ, marks v1 as Superseded. Carry-over of links is stubbed.
- **Exit:** users can fix typos with full audit trail.

### Phase 6 — Read views, search, export *(3–5 days)*
- BoQ list per project.
- Tree view with collapse/expand per preamble.
- Search across line items by description.
- Filter by preamble.
- Export back to Excel.
- Roll-up summaries: total supply value, total install value, value per L1.
- Basic version diff view.
- **Exit:** PMs can browse a BoQ end-to-end without opening the original Excel.

### Phase 7 — Linkage layer *(2–4 weeks, sub-phased)*

Each sub-phase gets its own design doc. All linkages are standalone doctypes following the Critical PO Tasks pattern. CEO Hold check required before any procurement-creating action.

- **7a — Work Header / Milestone linkage.** New doctype `BOQ Node Milestone Link`. UI to map BoQ Nodes to existing Work Headers / Work Milestones (no replacement of existing entities).
- **7b — Critical PO Category linkage.** New doctype `BOQ Node Critical PO Link`. Map BoQ Nodes to Critical PO Tasks. Coordinate with active plans `frontend/.claude/plans/critical-po-setup-plan.md` and `critical-po-tracker-project-view.md`.
- **7c — PR / PO line item linkage.** New doctypes `BOQ Node PR Item Link`, `BOQ Node PO Item Link`. When creating a PR/PO, optionally pick from BoQ line items. Pre-fills item details.
- **7d — Delivery linkage.** New doctype `BOQ Node Delivery Link`. Track delivered qty per line item. Show "delivered vs BoQ qty" progress in the tree view.
- **7e — Version migration.** When v2 of a BoQ is uploaded, surface a UI to map v1 nodes → v2 nodes so existing linkages carry over.

## 14. Working agreements

- Before each phase, output a written plan; user reviews; then code.
2. **One feature branch per phase.** Phase 1.x stayed on `feature/boq-phase-1` (continuation rule). Phase 2 branched fresh as `feature/boq-phase-2` from `feature/boq-phase-1`. Phase 2 sub-phases (2a, 2b.1a, 2b.1b, 2b.2, 2c) all continue on `feature/boq-phase-2` since they're a single phase split for risk management. Phase 3 will branch fresh again.
- Doctype changes go through `bench --site <site> migrate`. New patches in `patches/` only when backfilling data on existing doctypes.
- All Python lifecycle logic in `integrations/controllers/`. Doctype `.py` stays minimal.
- All API endpoints under `nirmaan_stack/api/boq/`, snake_case.
- Frontend: shadcn/ui + TanStack Table + Zustand + frappe-react-sdk + React Hook Form + Zod. No new UI libraries.
- Pure-Python modules (parser, AI assist) get real unit tests with fixtures. No stubs.
- `frappe.db.commit()` before `publish_realtime()`.
- For ad-hoc DB queries: docker cp + docker exec pattern in CLAUDE.md.

11. **End-of-session git verification — MANDATORY.** Every Claude Code prompt must include in its "Stopping conditions" section: (a) run `git status` and report the output — working directory must be clean (no `M`, no `??`, no untracked files in scope); (b) run `git log <current-branch> --oneline -10` and report output to verify all intended changes are committed. This guards against the failure mode where Claude Code edits files but forgets to `git add` and commit the final round of changes — leaving uncommitted work that gets silently picked up by the next session. (Real lesson from the start of Phase 2a, where uncommitted Phase 1.7 controller and hook changes had to be recovered as the first action of the new session.)

12. **Test fixtures use real BoQ files — no anonymization required (Option C).** Decided 2026-05-10. The BoQ feature is for internal use by Nitesh's tendering team at Stratos Infra Technologies; confidentiality of project/client/vendor names is not a constraint. Real BoQ files are committed directly to `nirmaan_stack/services/boq_parser/tests/fixtures/` (~5-8 MB total across 5 fixtures). Saves ~5-10 hours of manual anonymization. (Future-Claude-or-developer note: if this project ever becomes externally distributed or open-sourced, fixture anonymization would need to be revisited.)

13. **Documentation maintenance — MANDATORY in every Claude Code prompt.** From 2026-05-11 onwards, every Claude Code prompt for a sub-phase must include a Documentation Maintenance section that requires Claude Code, before reporting completion, to: (a) update `frontend/.claude/plans/boq-upload-plan.md` to reflect what the sub-phase delivered (commit hashes, test counts, status flips, new known issues, new working agreements); (b) commit the doc update as a separate commit with message `docs(boq): update plan for <sub-phase> completion`; (c) verify via `git status` (clean) and `git log --oneline -10` (both commits present — code commit + docs commit). This bakes documentation maintenance into every sub-phase and prevents drift between in-repo docs and reality. (Real lesson from 2026-05-10 when 2b.1a started against a stale plan doc that hadn't captured Phase 2a completion or working agreements 11/12.)

## 15. Open questions

1. **Multiple sheets per Excel.** Import all as one BoQ, prompt user to pick a sheet, or require separate uploads per sheet? *Defer to Phase 3.*
2. **Line item identity across versions.** When v2 is uploaded, how do we map v1 → v2 line items so links carry over? Options: by code field, by description-hash + parent-path, or manual mapping UI. *Defer to Phase 7e.*
3. **Permissions scope.** All internal users see all BoQs, or scoped per project membership? *Resolve in Phase 1, default to project membership matching Procurement Requests conventions.*
4. **Total reconciliation.** If computed total ≠ Excel's stated grand total, warn or block save? *Default warn-only; user can flip a "block on mismatch" flag if needed in a later phase.*
5. **Nirmaan Versions schema.** Does it have a `reason` field? Resolve in Phase 1 first task.

## 16. Glossary

- **BoQ** — Bill of Quantities. Structured list of work items with quantities and rates.
- **Preamble** — section header grouping line items. Nestable to L1/L2/L3.
- **Line item** — single work entry with quantity, unit, and rate(s).
- **Supply rate / Install rate / Combined rate** — material vs labor; sometimes separate, sometimes combined.
- **Pre-tax / Post-tax** — whether quoted rates include taxes. Default pre-tax.

## 17. Known Parser Issues

Issues identified during real-BoQ verification. Each entry has a disposition: deferred or requires Phase 3 wizard action.

### 17.1 Pattern Y multi-dot ambiguity (level resolution)

**Issue:** In BoQs with numeric top-level coding (1., 2., ...) and letter sub-sections (A., B., ...), multi-dot sub-codes like `1.1` that appear under an `A.` parent are structurally ambiguous — they could be a sibling of `A.` at level 2, or a child of `A.` at level 3. The resolver cannot distinguish without user intent.

**Current behavior:** Resolver emits a warning with `category=ambiguous_level_pattern_y` and assigns default depth (1 + dot count). The tree structure is plausible but may not match the source document's intent.

**Disposition:** Defer to Phase 3 wizard. Phase 3 mapping UI will surface rows with this warning and let the user confirm or override the assigned level before saving. Working agreement #18 (TBD): all `ambiguous_level_pattern_y` warnings surface as explicit confirmation prompts in Phase 3 review step.

### 17.2 Stray `Note` sl_no rows misclassified as PREAMBLE

**Issue:** Some BoQ files include sl_no cells containing the literal text "Note" or "NOTE" followed by a description but no quantity. The classifier correctly routes these to PREAMBLE (sl_no + description, no qty) but they are not section headers — they are annotation notes.

**Current behavior:** These rows are inserted into the preamble stack, potentially becoming unwanted parent nodes for subsequent line items. One occurrence confirmed in JSW Elect B1.

**Disposition:** Visible but not catastrophic — the note becomes a leaf preamble with no line-item children in the one observed case. Defer: in Phase 3, add a reserved-keyword filter to the classifier that treats sl_no values matching `^note$` (case-insensitive) as NOTE classification regardless of description presence.

### 17.3 Unnumbered section headers classified as NOTE; Phase 3 wizard handles promotion to PREAMBLE

**Issue:** Some BoQ authors (observed in Inovalon HVAC) use unnumbered bold text-only rows as section headers. These have no sl_no value, so the classifier routes them to NOTE — not PREAMBLE. They are structurally preambles but visually indistinguishable from genuine annotation notes by pattern alone.

**Current behavior:** These rows are inserted as NOTE nodes in the resolved tree with no preamble-stack effect. Subsequent line items are parented to the last real PREAMBLE, not to the bold header. The hierarchy is therefore correct but misses an implicit grouping level.

**Scoring signals (implemented in `populate_preamble_candidate_scores()`):**
- Bold formatting on description cell: +2
- First note in a contiguous note-block (allowing spacers) terminated by a LINE_ITEM: +2
- Description shorter than 80 characters: +1

Score ≥ 2 is the Phase 3 promotion threshold. Score stored in `ClassifiedRow.preamble_candidate_score`; signal names in `ClassifiedRow.preamble_candidate_signals`.

**Phase 3 wizard responsibilities:**
1. Surface NOTE rows with score ≥ 2 as "could this be a section header?" prompts in the review step.
2. Provide a "Promote note → preamble" action that converts the NOTE to a PREAMBLE and re-runs hierarchy resolution for the affected subtree.
3. Provide a "Create new preamble from scratch" action for cases where no NOTE candidate exists (sets `ResolvedRow.is_synthetic = True`).

**Phase 2c (DB commit) responsibility:** Pass `preamble_candidate_score` and `preamble_candidate_signals` through to the BOQ Node record so Phase 3 can surface them without re-parsing.

**Deferred parser-side fix:** A future signal could use column-position heuristics (description starts in sl_no column rather than description column) to disambiguate at classify time. Not implemented — too many false-positive risks with current test corpus.

**Disposition:** Parser-side scoring implemented (Phase 2b.1b). Phase 3 wizard action deferred to Phase 3 planning.

### 17.4 Stale repo clone at `C:\Users\nites\Documents\nirmaan_stack_frappe15_postgres_14\`

**Issue:** There is a second nirmaan_stack repo clone on Nitesh's machine at `C:\Users\nites\Documents\nirmaan_stack_frappe15_postgres_14\`. That clone only has `feature/boq-phase-0` and `feature/boq-phase-1` branches — it does NOT have `feature/boq-phase-2` or any Phase 2 work.

**Critical pointer:** All BoQ Phase 2+ work MUST happen in the live working repo at `C:\Users\nites\Documents\frappe_docker\development\frappe-bench\apps\nirmaan_stack\`. At the start of every session, verify `pwd` output contains `.../frappe_docker/development/frappe-bench/apps/nirmaan_stack` before writing any code.

**Disposition:** Do NOT delete the stale clone — it may have independent history worth preserving. It is simply not the active development copy. If Claude Code ever opens in the stale clone by accident, stop immediately and switch to the live repo.

---

## Decisions log

Newest at the top.

### 2026-05-08 — Phase 1.5: Foundation refinements

**Context:** After Phase 1 tests passed, three real-world BoQ patterns were found to be unsupported by the controller: (1) preambles nested deeper than L3, (2) zero-qty line items (rate-only tender entries), (3) standalone line items with no parent.

**Decisions:**
- **Arbitrary preamble depth:** Remove hard L1/L2/L3 constraint. Validation now accepts `level ≥ 1`, soft-warns above 5. The stack-walk algorithm already handled arbitrary depth; only the validator needed updating.
- **Zero-qty line items:** `if not doc.qty` blocked `qty=0` — changed to `if doc.qty is None`. Auto-set `is_rate_only=True` when `qty==0` and a rate is present. Amount computation fixed: `(supply or install)` was falsy for zero amounts — replaced with `any([supply_rate, install_rate])`.
- **Standalone line items:** `parent_node=None` on a line item now warns rather than throws.
- **Leaf preamble computation:** Leaf preambles (no children) may carry qty/rate silently; non-leaf preambles with qty/rate emit a warning. Detection via `frappe.db.exists("BOQ Nodes", {"parent_node": doc.name})`.

**Consequences:** `is_rate_only` field added to `boq_nodes.json`. Tests expanded from 25 to 33 (8 new, 1 removed, 3 renamed, 1 split into 2).

### 2026-05-06 — Wizard reference is project creation wizard

**Context:** BoQ upload is multi-step (upload → mapping → preview → confirm). Two candidate references in the codebase: project creation wizard and PR approval flow.

**Decision:** Project creation wizard (`frontend/src/pages/projects/project-form/`).

**Alternatives considered:** PR approval flow (`ApproveNewPR/`) — but it's a single-page document review with inline dialogs, not a stepped wizard. Not applicable.

**Consequences:** BoQ upload follows the orchestrator + steps + schema.ts + Zustand draft store + multi-stage progress dialog pattern. File paths in §10.

### 2026-05-06 — Tree storage via self-Link + path, not Frappe is_tree

**Context:** Need to store hierarchical BoQ structure in Frappe.

**Decision:** Standalone `BOQ Nodes` doctype with self-referencing `parent_node` Link and denormalized `path` field. Recursive CTEs for subtree queries. TanStack Table `getSubRows` for client-side rendering.

**Alternatives considered:** Frappe's `is_tree` (lft/rgt nested sets) — no precedent in this codebase, optimized for huge trees with rare writes (opposite of BoQ).

**Consequences:** Simpler mental model, matches codebase conventions. Recursive CTE for any subtree query. `path` recomputed on parent change.

### 2026-05-06 — BOQ Nodes are standalone documents, not child rows

**Context:** Should BoQ line items be a child table on BOQ, JSON field, or standalone doctype?

**Decision:** Standalone `BOQ Nodes` doctype, following the Critical PO Tasks precedent.

**Alternatives considered:** Child table on BOQ (loses individual queryability), JSON field (known migration trap — see `procurement_list` → `order_list` history).

**Consequences:** Each node is independently queryable, updatable, audit-loggable. Slightly more storage overhead, but matches established pattern.

### 2026-05-06 — Audit via Nirmaan Versions, not custom child-table log

**Context:** BoQ nodes editable post-import; need audit trail with reason.

**Decision:** Use the existing Nirmaan Versions pattern. If Nirmaan Versions lacks a `reason` field, add one (cross-cutting improvement).

**Alternatives considered:** Custom `BOQ Node Audit Log` doctype — would duplicate existing audit infrastructure.

**Consequences:** Consistent audit experience across PR/PO/SR/Payment/BoQ. Phase 1 first task: confirm Nirmaan Versions schema, add `reason` if missing.

### 2026-05-06 — AI assist provider is Anthropic Claude, not Document AI

**Context:** Phase 4 needs an AI service to pre-classify columns and rows.

**Decision:** Anthropic API (`claude-sonnet-4-6`). Architecture mirrors `services/document_ai.py` and `api/invoice_autofill.py` (file_url-based, opt-in, confirm-before-save, never auto-persist).

**Alternatives considered:** GCP Document AI — built for structured form extraction (invoices, IDs); poorly suited to free-form spreadsheets with arbitrary layouts. Would require custom processor + labeled training data per BoQ format.

**Consequences:** New external dependency (Anthropic API key). New service module `services/boq_ai_assist.py`. AI is for structure classification only; numerical values always read deterministically from cells.

### 2026-05-06 — Downstream linkages via dedicated standalone doctypes

**Context:** BoQ Nodes need to relate to Work Headers, Milestones, Critical PO Tasks, PR/PO line items, Deliveries.

**Decision:** One linkage doctype per relationship type, each standalone (Critical PO Tasks pattern). BoQ Nodes do not auto-create downstream entities.

**Alternatives considered:** Polymorphic Dynamic Link à la `PO Delivery Documents` — overkill for fixed relationships. JSON field of linked IDs — same migration trap as before.

**Consequences:** Phase 7 splits into 7a–7e, each shipping a focused linkage doctype. Avoids legacy `$#,,,` delimiter pattern from milestone reports.

### 2026-05-06 — Plan + decisions live in `frontend/.claude/plans/`, not `docs/`

**Context:** Where to put feature spec and decisions log.

**Decision:** `frontend/.claude/plans/boq-upload-plan.md` (active plan). After Phase 3 stabilizes, the long-term reference moves to `.claude/context/domain/boq.md`.

**Alternatives considered:** `docs/boq-feature/` — would create a parallel structure inconsistent with the rest of the project.

**Consequences:** Future Claude Code sessions auto-discover the plan via `.claude/context/_index.md` and `frontend/.claude/context/_index.md`.
