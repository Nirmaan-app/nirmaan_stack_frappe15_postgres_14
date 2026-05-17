# BoQ Upload & Management — Implementation Plan

**Status:** Phase 2a + Phase 2b.1a + Phase 2b.1b complete and tested (incl. preamble candidate scoring). Phase 2b.2 Part A1 (reader merged-cell propagation) complete. Part A2 (ColumnRole multi-area extensions + validation) complete. Session 1 (Pattern-4 integration test) complete. Part A3a (multi-area detection module + smoke tests) complete. Part A3b (comprehensive detection tests) complete. Part A3c (covered-cell skip fix + regression tests) complete. Session 4 verification complete (Pattern 3: PASS; Pattern 2: deferred — see §17.5). Part B1 (classifier `amount_by_area_raw` + orchestrator + return models) complete. **Part B2a (Policy X §7.25, per-area totals on ResolvedRow, `_apply_multi_area_post_pass`, synthetic_multi_area fixture, +17 tests) complete.** **Part B2b-keywords (reserved keyword expansion — false-positive fix) complete.** **Part B2c (Snitch real fixture + integration test, §7.25 wording correction) complete.** **Part B2d (unit-based PREAMBLE demotion post-pass, §7.28, +9 tests) complete.** **Part B2e-snitch-refresh (Snitch expected JSON regenerated, max preamble level 21→7, all 182 tests green) complete.** **Part B2f (zero-children PREAMBLE demotion post-pass, §7.29, +8 tests) complete. All 190 tests green.** Phase 2c next. **Phase 2c kickoff fixture commits (24 real BoQ files added to tests/fixtures/, §9 #40 CLOSED) complete.** **Phase 2c keyword expansion (§9 #44 CLOSED — 49→120 reserved keywords + _is_reserved whitespace normalization + parenthetical strip) complete. 205 tests passing.** **Phase 2c keyword targeted additions (§17.10 CLOSED — 120→191 entries) complete.** **Phase 2c caveats #2 + #4 cleanup (§9 #42 + §9 #43 reframed, §17.11 CLOSED) complete. 207 tests passing.** **Phase 2c §9 #45 priced-PREAMBLE-with-children review flag (feat 7ff4ce55, §17.11.C CLOSED) complete. 217 tests passing.** **Phase 2c §9 #49 reader sheet_state exposure (feat 3e9eafe0, §17.11.D CLOSED) complete. 221 tests passing.** **Phase 2c §9 #48 classifier-dictionary audit half (chore f89e2478, §17.11.E CLOSED) complete. 2999 unique unclassified header strings surfaced. 221 tests passing.** **Phase 2c §9 #48 classifier-dictionary + multi-area keyword expansion (feat a0d2b4a5, §17.11.F CLOSED) complete. 237 tests passing. DB commit + version cascade next.** **Phase 1.8 + 1.9 planned (per-area rate+amount schema extension) — sequenced BEFORE Phase 2c kickoff.** **make_model field confirmed already present on BOQ Nodes (position 25) — Phase 1.8 scope reduced; audit-tracking gap flagged (make_model absent from _write_audit tracked fields).** **append_to_notes ColumnRole designed (§7.34) for user-curated preservation of long-tail column data into notes field — parser-side wiring lands in 1.9 expanded scope; commit-time merge in 2c; wizard UX in Phase 3.** **Phase 1.8 (per-area rate + amount schema extension) ✅ COMPLETE. 88 Phase 1.x Frappe tests passing (60 boq_nodes + 28 boqs). Phase 1.9 next.** **Phase 1.9a (per-area rate parser support — Pattern 2-rate detection) ✅ COMPLETE. 249 parser tests passing. Phase 1.9b (append_to_notes parser) next.** **Phase 1.9b (append_to_notes parser support) ✅ COMPLETE. 257 parser tests passing. Phase 1.9c ✅ COMPLETE. 267 parser tests passing (expectedFailure=2: F3b RATES-plural + F5 HVAC header gap). Phase 2c next (unblocked). Phase 1.8.1 (F1 + F2 cleanup) ✅ COMPLETE. 91 Phase 1.x Frappe tests passing (63 boq_nodes + 28 boqs). Audit now fires on Desk saves without explicit edit_reason (defaults to "Desk edit"). Phase 2c next (unblocked). **Phase 1.9d design-locked (F3b regex widening + F5-b `top_header_rows_override: list[int]` field on `SheetConfig` + F7 standing-pattern doc-only). Pattern 6 future shape locked as forward-compat extension of same field. §17.13 NEW — wizard-load review pending parking entry. Implementation prompts to follow. **Phase 1.9d (F3b + F5-b implementation) ✅ COMPLETE. 274 parser tests passing (was 267 + 7 new F5-b validation + RATES-plural unit tests; 0 expected failures, was 2). Raheja Electrical now detects Pattern 2-rate directly; Raheja HVAC now detects PHASE-1 / PHASE-2 via top_header_rows_override=[2]. F7 standing pattern doc-only (no code change). Pattern 6 forward-compat captured in field shape. Phase 1.9e (real-fixture stress test) next.****** Phase 1.9e ✅ COMPLETE (68 sheets parsed across 25 workbooks; 62 rate-synonym variations surfaced; output at real_fixture_stress_test_output.json).
**Owner:** Internal team.
**Last updated:** 2026-05-17 IST (commit 5cd4f580, Phase 1.9e — real-fixture stress test)
**Active branch:** `feature/boq-phase-2` (branched from `feature/boq-phase-1`)
**Latest commit:** Phase 1.8.1 — F1 + F2 cleanup — feat `4c6b81e6`, docs `241988d9` (see git log).

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

**Note on commit-time sources for `notes`:** The notes field receives content from two parser sources at commit time — `row_notes` (free-text user-written remarks, no prefix, written first) and `append_to_notes` (wizard-assigned columns with structured `[Source: ...] [Column: ...]` prefixes, written after a blank line separator). The `append_to_notes` block includes both this row's own captured values AND ancestor preamble inherited values per §7.34. See handover §7.34 for the prefix format spec.

### 6.3 Validation rules (in `integrations/controllers/boq_nodes.py`)

- If `node_type = "Line Item"`: `qty` must not be `None` (0 is valid for rate-only items); `level` must be null; at least one rate field should be set (warn if none).
- If `node_type = "Preamble"`: `level` must be a positive integer ≥ 1; warn (do not throw) if `level > 5`; qty/rates on a **non-leaf** preamble emit a warning (leaf preambles may carry qty/rate for tender computation — silent); `amount_override` suppresses the non-leaf warning.
- `parent_node` consistency (generic rule): a preamble at level N must have a parent at level N−1; a line item's parent must be a preamble (any level); standalone nodes (`parent_node` null) are allowed with a warning.
- `path` recomputed on save and on parent changes.
- `is_rate_only` auto-set in `before_save`: true when `qty == 0` and at least one rate field is set; false otherwise.
- Amount fields auto-computed from qty × rate unless `amount_override` is set. When `qty == 0` and rates are set, amounts compute to 0 correctly (`(supply or install)` logic replaced with `any([supply_rate, install_rate])` check).

### 6.4 Audit

Use **Nirmaan Versions** pattern. Phase 1 task: confirm Nirmaan Versions schema; if it lacks a `reason` field, add one. Every BOQ Node update from a user (post-initial-import) writes a Nirmaan Versions entry with the change diff and reason.

## 6.5 BOQ Node Qty By Area — child table for per-area breakdown (EXTENDED Phase 1.8)

Phase 1.8 extends this from 2 fields to 9 fields:

| Field | Type | Reqd | Default | Rule |
|---|---|---|---|---|
| area_name | Data | yes | — | existing |
| qty | Float | yes | — | existing |
| supply_rate | Float | no | None | fallback from parent BOQ Node `supply_rate` if source file doesn't provide |
| install_rate | Float | no | None | fallback from parent `install_rate` |
| combined_rate | Float | no | None | fallback from parent `combined_rate` |
| supply_amount | Float | no | None | from file when given; else `qty × supply_rate` (auto-compute in `before_save`) |
| install_amount | Float | no | None | from file when given; else `qty × install_rate` |
| total_amount | Float | no | None | from file when given; else `qty × combined_rate` OR `supply_amount + install_amount` (mirrors parent §7.14 rule) |
| amount_override | Check | no | 0 | when set, `before_save` skips auto-compute of amounts (parallel to parent's `amount_override`) |

**Fallback semantic:** Every child row always has populated rate and amount fields after `before_save` runs — no nulls for downstream code to branch on.

**Validation:** Per-child-row, `combined_rate == supply_rate + install_rate` when all three set (mirrors parent `BOQ Nodes` validation at controllers/boq_nodes.py:40-46). Zero-cost rows (all three rates None) allowed.

**Weighted-average precedence:** Parent BOQ Node `supply_rate` / `install_rate` / `combined_rate` auto-recompute in `before_save` as `Σ(area_qty × area_rate) ÷ Σ(area_qty)` when any per-area rate diverges from the universal. Computed independently for supply / install / combined.

**Migration:** Phase 1.8 ships a patch that back-populates every existing child-row's per-area rate from the parent line-item's universal rate, and computes amount as `area_qty × that_rate`. Same fallback rule applied retroactively.

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

### Phase 1.8 — Per-area rate + amount schema extension ✅ COMPLETE

**Completed 2026-05-16. Feat commit: `7d5fbc4e`. 88 Phase 1.x Frappe tests passing (60 boq_nodes + 28 boqs). 237 parser tests unchanged.**

Extends `BOQ Node Qty By Area` from 2 fields to 9 fields: adds `supply_rate`, `install_rate`, `combined_rate`, `supply_amount`, `install_amount`, `total_amount`, `amount_override`. Adds controller logic with: (a) universal-rate fallback semantics — when source file doesn't provide per-area rate, populate from parent line-item rate; (b) auto-computed per-area amounts as `area_qty × area_rate` unless source file provides them; (c) `amount_override` Check field parallel to parent — when set, suppress auto-compute; (d) weighted-average precedence on parent — when per-area rates set, parent universal rate auto-recomputes as `Σ(area_qty × area_rate) ÷ Σ(area_qty)` in `before_save`; (e) consistency validation on child rows — `combined_rate == supply_rate + install_rate` when all three set (mirrors parent-row rule). Migration patch back-populates existing child-table rows with parent's universal rate. **Scope note (2026-05-16): `make_model` field was already present on `BOQ Nodes` (position 25) — Phase 1.8 added `"make_model"` to the `_write_audit` tracked-fields list (1-line cascade fix per §7.33 + §9 #55). Controller logic lives in `integrations/controllers/boq_node_qty_by_area.py` (helper module called from parent controller — no hooks.py change needed).**

### Phase 1.8.1 — F1 + F2 cleanup ✅ COMPLETE

**Completed 2026-05-17. Feat commit: `4c6b81e6`. 91 Phase 1.x Frappe tests passing (63 boq_nodes + 28 boqs). 267 parser tests unchanged.**

F1 (per-child consistency guard, §9 #58): `_validate_combined_rate` in `boq_node_qty_by_area.py` already had the correct all-three-set guard (`if sr is not None and ir is not None and cr is not None:`). The Phase 1.8 Desk-verification finding was that TESTS were missing for the partial-rate cases, not the code. Added 2 tests (Group G): `test_child_supply_only_no_consistency_error` (supply_rate set, install_rate/combined_rate None → no error) and `test_child_install_only_no_consistency_error` (install_rate set, supply_rate/combined_rate None → no error). Regression case already covered by existing Phase 1.8 test — not duplicated.

F2 (Desk-save audit trigger, §9 #59): `on_update` had `if old_doc is None or not doc.edit_reason: return`, blocking audit on Desk saves where `edit_reason` is not filled in. Fix: (1) removed `not doc.edit_reason` from the guard — audit fires for all saves with tracked-field changes; (2) `_write_audit` defaults `nv.reason` to `"Desk edit"` when `edit_reason` is not explicitly provided; (3) added `if not changed: return` guard to suppress no-op saves; (4) added `_NULLABLE_NUMERIC_FIELDS` normalization in `_write_audit`'s comparison loop — Frappe stores Currency/Int `None` as `0` in PostgreSQL, causing false `old=0 vs new=None` diffs on repeat saves for unset rate/amount/level fields; normalizing via `or 0` for 8 fields eliminates this noise. Existing test `test_audit_entry_not_written_without_reason` renamed to `test_audit_entry_without_reason_defaults_to_desk_edit` and updated (expects reason `"Desk edit"`, adds finally cleanup). New tests: `test_audit_entry_not_written_when_no_fields_change` (+1).

### Phase 1.9a — Parser support for per-area rate ✅ COMPLETE
Extends `ClassifiedRow` with `rate_by_area_raw: dict[str, dict[str, float | None]]` (parallel to existing `qty_by_area_raw` / `amount_by_area_raw` — completes the §7.22 parallel-field pattern). Adds three new ColumnRoles: `rate_supply_by_area`, `rate_install_by_area`, `rate_combined_by_area`. Extends `multi_area_detection.py` to recognize the 3-col-per-area Raheja "Pattern 2-rate" shape (`[Area merge][Qty][Rate][Amount]` vs textbook 2-col `[Area merge][Qty][Amount]`) — closes §17.5 / handover §9 #39 (partial). Routing priority: Pattern 2-rate → Pattern 2 → Pattern 3 → Pattern 1 (Pattern 2-rate tried first because it is a strict superset of Pattern 2 shape). Extends `_apply_multi_area_post_pass` to populate `rate_by_area` on `ResolvedRow`, auto-compute per-area amounts from rate×qty when amount not directly present, and emit soft `combined_rate != supply_rate + install_rate` validation warning. Synthetic `synthetic_pattern_2_rate.xlsx` fixture added. 12 new parser tests (237→249). Feat: `b2a2f747`. **All per-area rates in Pattern 2-rate default to `combined_rate` kind — split supply/install sub-label detection deferred to a future iteration.**

### Phase 1.9b — Parser support for append_to_notes ✅ COMPLETE
Adds `append_to_notes` to ColumnRole Literal in `config.py` (NOT singleton, NOT area-compatible). Adds `append_notes_raw: dict[str, str]` field to `ClassifiedRow` in `classifier.py` — keys are source column header strings (resolved via `SheetConfig.column_headers`, falling back to column letter), values are cell text coerced via `str()`. Pattern mirrors `qty_by_area_raw`. Empty/blank cells produce no dict entry (Policy-X-style empty-cell-skip). NOTE: `ResolvedRow` does NOT need its own field — accessed via `resolved_row.classified_row.append_notes_raw`. `column_headers: dict[str, str] = {}` field added to `SheetConfig` (Case B → Option B resolution, chat-Claude 2026-05-16). Phase 2c commit step merges captured values into the `notes` field on `BOQ Nodes` with structured `[Source: ...] [Column: ...]` prefixes (§7.34). 8 new tests (249→257): +3 test_config.py (append_to_notes accepted, multiple columns, column_headers round-trip), +5 test_classifier.py (TestAppendNotesRaw class). Feat: `78b3d233`.

### Phase 1.9d — F3b + F5 + F7 Raheja-fidelity bundle ✅ COMPLETE

Design-locked 2026-05-17. Three findings bundled. Implementation prompt to follow as a separate sub-phase.

**F3b (§9 #62) — `_RATE_CELL_PATTERN` widening.** Pattern 2-rate detection regex in `multi_area_detection.py` currently `r"^\s*rate\s*$"` rejects "RATES" plural. Raheja Commerzone Electrical uses "RATES"; falls through to Pattern 1; areas + qty still capture correctly via fallback but per-area rate fidelity lost. Locked fix: widen regex to `r"^\s*rates?\s*$"`. 1-line change. Implementation prompt to include: regex widening + new synthetic fixture variant with RATES-plural shape + audit-script regression check per agreement #25 + remove `@unittest.expectedFailure` decorator on `test_electrical_pattern_2_rate_detected`.

**F5 (§9 #63) — `SheetConfig.top_header_rows_override: list[int] | None` field.** Orchestrator currently hardcodes `top_header_row = header_row - 1` in `_apply_multi_area_post_pass`. Cannot bridge multi-row gaps (Raheja HVAC: 13-row gap between merged area-name top row at row 2 and bottom header row at row 15). Locked fix: add new optional field `top_header_rows_override: list[int] | None = None` to `SheetConfig`. **Field is plural and list-typed** for forward-compatibility with Pattern 6 (Société Générale compound area names per §7.4 / §7.12 / §7.19). When set, orchestrator uses the override list to identify top-header row(s). When unset, falls back to existing `header_row - 1` behaviour. Single-element list `[2]` is the Raheja HVAC case. Multi-element lists (Pattern 6 case) deferred — parser support for multi-row concatenation not in 1.9d scope. Validation: each entry must be a valid row number less than `header_row`; entries must be unique. Implementation prompt to include: schema change + validation + orchestrator branch + 2-3 new tests + remove `@unittest.expectedFailure` decorator on `test_hvac_pattern_2_rate_with_header_gap`. Migration path noted: when Pattern 6 lands, the same field absorbs multi-row concatenation logic — no schema migration needed.

**F7 (§9 #64) — Merged title banner standing pattern (no code change).** Real-BoQ row 1 frequently carries a merged title banner spanning all populated columns (Raheja Electrical "BOQ - ELECTRICAL"; D-Tech "PHASE-0"). Without user mitigation, parser classifies as junk LINE_ITEM with banner text propagated into sl_no/description/unit (zero qty via Policy X — benign but noisy). Existing `MappingConfig.skip_top_rows_after_header` field handles via row-index list (e.g. `[1]` for row 1, `[1, 2, 3, 4]` for multiple noise rows). **No code change in Phase 1.9d.** Standing pattern documented here. Phase 3 wizard default-skip behaviour when a merged cell spans all populated header columns is agreement #24 extension candidate — codify when Phase 3 wizard design lands.

**Pattern 6 (Société Générale compound area names) — design-locked but parser-deferred.** §7.19 captured the 2-level concatenation rule on 2026-05-12: top-row value + bottom-row value, with parenthetical-suffix stripping (case-insensitive trailing `(Qty)` / `(Quantity)` / `(Amount)` / etc.), joined by underscore separator. Worked example: top `Voyager (Qty)` → strip → `Voyager`; bottom `Ground +MF`; compound `Voyager_Ground +MF`. **3+ level concatenation is a known boundary** — build when a real fixture surfaces (currently zero such fixtures across the 24 real BoQs committed in v5.8). Pattern 6 parser implementation likely absorbed by Phase 3 wizard rather than shipping as detection code. The F5-b `top_header_rows_override: list[int]` field is the future Pattern 6 entry point — same field, multi-element list with concatenation logic added when needed. Re-evaluation triggers: (a) Phase 1.9e surfaces a 2nd Pattern 6 fixture, OR (b) a real user needs Société Générale upload before Phase 3 ships.

**Scope estimate:** ~250-300 line implementation prompt covering all three findings. Comfortably under 700-line cap per agreement #15.

**Status:** ✅ COMPLETE. Feat commit `eacc8b38`. F3b CLOSED (§9 #62). F5-b CLOSED (§9 #63). F7 documentation-only (§9 #64). Parser test count 267 → 274. 0 expected failures (was 2). Raheja Electrical + HVAC integration tests now pass without expectedFailure decorators. Audit-script regression check per agreement #25: classifier_audit_output.json ZERO CHANGES; preamble_with_children_audit_output.json ZERO CHANGES; keyword_audit stdout shows Raheja RATES-plural sheets flip to pattern_2_rate (expected F3b outcome, disclosed). Pattern 6 concatenation still deferred; field shape forward-compatible.

### Phase 1.9e — Real-fixture stress test (observability chore) ✅ COMPLETE

Walks all 25 fixtures (24 real BoQ workbooks + Snitch) with zero user declaration (auto-guessed `MappingConfig`). Selects up to 4 real BoQ sheets per workbook (skip excluded sheets by name, rank by data-row count). Calls `parse_boq()` once per workbook and records per-sheet parse results. Detects rate/cost/price synonym variations in header rows not matched by `_RATE_CELL_PATTERN`. Emits `real_fixture_stress_test_output.json` as a characterization artifact — no test assertions, no parser code changes, no Frappe code touched. Empirical basis for §17.13 wizard-load re-evaluation.

**Results:** 68 sheets parsed across 25 workbooks (1 load failure: openpyxl XML parse error on one file). 62 rate-synonym variations surfaced. Pattern 1 = 9 sheets auto-detected (13%); Pattern 2/3 = 0 by construction (auto-guess uses `header_row_count=1` only). 274 parser tests unchanged.

**Status:** ✅ COMPLETE. Chore commit: 5cd4f580. Output JSON: `real_fixture_stress_test_output.json`.

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

### Phase 2b.2 — Multi-area + first end-to-end fixture ✅ COMPLETE (Parts A1–A3c, B1, B2a, B2b-keywords, B2c, B2d, B2e, B2f all complete)

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

**Part A3a complete (2026-05-13):** `multi_area_detection.py` created with `MultiAreaPattern` dataclass + `detect_multi_area_pattern()` function + 3 private helpers (`_try_pattern_1`, `_try_pattern_2`, `_try_pattern_3`). Function accepts `(bottom_header_row: RawRow, reserved_keywords: list[str], top_header_row: RawRow | None = None)` — pure Python, no reader dependency, fully testable with in-memory `RawRow` objects. TOTAL_QTY_PATTERN + QTY/AMOUNT cell regexes locked per v5.3 §3. Priority routing: 1-row mode → P3 → P1; 2-row mode → P2 → P3 → P1(bottom) → P1(top fallback). 3 smoke tests added in `test_multi_area_detection.py` (one per pattern, happy-path only). Test count: parser 111 → 114. Feat commit: `043ff057`. **Signature deviation from prompt**: prompt suggested `(reader, sheet_name, header_row, header_row_count, reserved_keywords)`; implemented as `(bottom_header_row, reserved_keywords, top_header_row=None)` for testability — the caller extracts rows before calling. Noted for Part B orchestrator integration.

**Part A3b complete (2026-05-13):** 11 comprehensive tests added in new class `TestMultiAreaDetectionComprehensive` covering: Pattern 1 liberal (no terminator, 3 areas), Pattern 1 single-area rejection, Pattern 2 three-merge happy path, Pattern 2 QTY+QTY rejection (pairing required), Pattern 3 canonical two-pair shape, priority P2>P3 (2-row mode), priority P3>P1 (1-row mode), P1 top-row last-resort fallback (TS_T2_WEX shape), reserved-keyword top-row merges rejected for P2 (Morgan Stanley shape), all-reserved-keywords → None, case-insensitive keyword matching. Test count: parser 114 → 125. `multi_area_detection.py` unchanged. Feat commit: `4c2fd166`. ~~**Latent bug noted (not fixed):** `_try_pattern_1` does not skip covered cells — covered-cell duplication bug; fix deferred to Part B.~~ **Fixed in Part A3c (commit `3bc745a9`) — see A3c record below.**

**Part A3c complete (2026-05-13):** Fixed covered-cell duplication bug in `_try_pattern_1`: added one `continue` condition — `if cell.merged_range is not None and not cell.is_merged_origin: continue` — before the TOTAL_QTY_PATTERN check. Covered cells (reader-propagated values from Part A1) are now skipped; only merge origins and non-merged cells contribute area names. Test 4 (`test_pattern_2_qty_amount_pairing_required`) updated: covered-cell fixture tightened to realistic propagated values (`value="Office"` / `value="Common Area"` instead of `value=None`), assertion changed from `assertIsNone` to `Pattern 1 with ["Office", "Common Area"]` — the test now covers both P2 pairing rejection AND the P1 top-row fallback that correctly fires after the fix. Two regression tests added: `test_pattern_1_skips_merge_covered_cells_on_top_row` (realistic TS_T2_WEX-style fixture with propagated covered cells) and `test_pattern_1_treats_origin_cells_normally` (origin + regular cells both collected). Test count: parser 125 → 127. Fix commit: `3bc745a9`.

**Session 4 verification complete (2026-05-13):** Manual real-data verification of `detect_multi_area_pattern()` against two real BoQ files from local disk (no commits, no fixtures added). **JSW HVAC Pattern 3: PASS** — opened `R0 WORKING-JSW -MEP Priced BOQ- 29.04.2026.xlsx` via `BoqReader` from a temporary `/tmp/jsw_test.xlsx` (docker cp + cleanup), called `detect_multi_area_pattern` on row 5 of the HVAC sheet, returned `MultiAreaPattern(pattern=3, areas=['B1', 'B3', 'B6'], qty_columns=[4, 6, 8], amount_columns=[5, 7, 9], detected_on_row=5)` — exact match to predicted output. Pattern 3 detection, area capture, reserved-keyword handling, and TOTAL QTY terminator behavior all verified end-to-end on real data. Trailing whitespace on `'AMOUNT '` (column L) correctly handled by case-insensitive `.upper().strip()` comparison. **Raheja Commerzone Chennai Pattern 2: NOT VERIFIED** — discovered a variant shape (3-col-per-area `[Area merge][Qty][Rates][Amount]` instead of textbook 2-col `[Area merge][Qty][Amount]`) not currently handled by `detect_multi_area_pattern`. Spot-checked across all Raheja sheets — every sheet uses the 3-col variant. See §17.5 for full description and disposition. Half-coverage on real data; Pattern 3 alone confirmed working.

**Part B1 complete (2026-05-14):** `ClassifiedRow.amount_by_area_raw: dict[str, float]` field added (parallel to `qty_by_area_raw`; `field(default_factory=dict)`). `classify_row()` captures `amount_by_area_raw` from columns with `role == "amount_by_area"` — mirrors `qty_by_area_raw` capture logic exactly (same dict shape, same area-name keying, same early-return gating for SPACER/HEADER_REPEAT/SUBTOTAL_MARKER). `ResolvedRow.validation_warnings: list[str] = []` field added — parser never sets a non-empty value in B1; B2's sum-validation post-pass will. `ParsedBoq` + `ParsedSheet` Pydantic models created in new `nirmaan_stack/services/boq_parser/orchestrator.py` module (not `config.py` — keeps input config separate from output result models). `parse_boq(file_path, config) -> ParsedBoq` orchestrator wires reader → `classify_row()` → `populate_preamble_candidate_scores` → `resolve_hierarchy` → `detect_multi_area_pattern` per non-skipped data sheet; `master_preamble` extracted from `treat_as="master_preamble"` sheets. NO multi-area splitting; NO sum validation; NO fixtures committed — all B2 scope. 12 new unit tests (5 classifier for `amount_by_area_raw`, 2 for `ResolvedRow.validation_warnings`, 5 orchestrator). Test count: parser 127 → 139. Feat commit: `9c2275ae`.

**Part B2b-keywords complete (2026-05-14):** Prerequisite sub-phase to fix a multi-area detection false positive discovered during the B2b (Snitch) session. Root cause: `'S No.'` and `'ITEM'` in the Snitch `'7. Light Fixtures'` header row were not in `multi_area_reserved_keywords`, so `_try_pattern_1` collected them as area names. Fix: expanded `GlobalSettings.multi_area_reserved_keywords` in `config.py` from 22 to 49 entries — adding "INSTALLATION RATE", "TOTAL RATE" (rate variants), 11 Sl.No./S No. variants ("SL.NO", "SL.NO.", "SL NO", "SL NO.", "SLNO", "S NO", "S NO.", "S.NO", "S.NO.", "SNO", "S/N"), 4 Sr No. variants ("SR NO", "SR NO.", "SR.NO", "SR.NO."), 3 Serial No. variants ("SERIAL NO", "SERIAL NO.", "SERIAL NUMBER"), 5 Item variants ("ITEM", "ITEMS", "ITEM DESCRIPTION", "ITEM NO", "ITEM NO."), 2 Desc shorthand variants ("DESC", "DESC."). Code-trace verification confirmed fix eliminates false positive: col A='S No.' → reserved skip; col B='ITEM' → reserved skip; col C='UNIT' → reserved skip; col D='Qty' → TOTAL_QTY_PATTERN match → break; zero areas collected → None. 5 new regression tests in new class `TestReservedKeywordExpansion` in `test_multi_area_detection.py` (Snitch LF header no-false-positive, Sl.No. variant, Sr No. variant, Item Description variant, case-insensitive). Also updated `test_config.py` count assertion 22→49 (outside stated in-scope list — minimal fix to prevent failing test, noted as deviation). Test count: 156 → 161. `snitch_electrical.xlsx` stays untracked in `tests/fixtures/` (B2c will commit it). Feat commit: `d02b212f`.

**Part B2d complete (2026-05-14):** Added `_apply_unit_based_demotion_post_pass(classified_rows: list[ClassifiedRow]) -> None` to `classifier.py` (see §7.28). Wired in `orchestrator.py` as Step 2b — after the per-row `classify_row()` loop and BEFORE `populate_preamble_candidate_scores()` (preamble scoring must not apply to rows that were just demoted to LINE_ITEM). Logic: collect unit strings from all LINE_ITEM rows on the sheet; demote any PREAMBLE row whose `qty is None` and `unit` matches a collected unit (case-sensitive, exact) → `classification = LINE_ITEM, qty = 0.0, is_rate_only = True`. 9 new tests added to `test_classifier.py` in new `TestUnitBasedDemotion` class (8 unit tests + 1 smoke on `synthetic_simple.xlsx`). TestSnitchIntegration: 3 tests now fail intentionally (`test_snitch_electrical_total_resolved_row_count`, `test_snitch_electrical_first_5_line_items`, `test_snitch_electrical_preamble_level_transitions`) — Snitch Electrical LINE_ITEM count changed 93→175, PREAMBLE 126→44 (82 rows demoted). B2e-snitch-refresh will regenerate `snitch_electrical_expected.json` to match. Test count: 173 → 182 total (179 passing, 3 failing). Known issue §17.9 (preamble stack-depth cascade in `hierarchy.py`) parked — B2d addresses the symptom at the classifier stage but the resolver-level root cause is not fixed. Feat commit: see git log.

**Part B2e-snitch-refresh complete (2026-05-14):** Regenerated `snitch_electrical_expected.json` against the new classifier behaviour from B2d-classifier (§7.28). Snitch Electrical: total resolved rows 521 (unchanged), LINE_ITEM 175, PREAMBLE 44, NOTE 287, SPACER 6, SUBTOTAL_MARKER 9. Max preamble level dropped from 21 to 7 (the depth-21 cable cascade resolved as the affected rows were demoted to LINE_ITEM). `first_5_line_items` re-populated by new resolved-order: indices 24/25/27/31/32 (resolved_idx=25 is a newly-demoted row with qty=0.0, is_rate_only=True). `preamble_level_transitions` uses Option α working definition (first preamble at each distinct level; 7 entries for levels 1–7; documented in JSON `_notes`; level-2 entry uses `description_contains_substring` for soft-hyphen safety). Subtotal marker indices unchanged (same 9 positions). Light Fixtures fully unchanged (PIR PREAMBLE preserved by case-sensitive unit comparison 'NOS' ≠ 'Nos.'). No `test_orchestrator.py` source changes needed — JSON regeneration alone restored all 3 failing tests. All 182 tests now pass. `_notes` key added to JSON with working definition and regeneration provenance. §17.9 known issue (KG/LS-unit PREAMBLEs not demoted, unique units) visible in audit but benign — not blocking. Feat commit: `1fa1d99f`.

**Part B2f-zero-children-demotion complete (2026-05-14):** Added `_apply_zero_children_preamble_demotion_post_pass(resolved_rows: list[ResolvedRow]) -> None` to `hierarchy.py` (see §7.29). Wired in `orchestrator.py` as Step 4a — after `resolve_hierarchy()` (needs tree path data) and BEFORE `_apply_multi_area_post_pass()`. Algorithm: (A) build `paths_with_descendants` set by extracting ancestor-path prefixes from every row's `path`; (B) for each PREAMBLE row whose path is NOT in that set (i.e. leaf node): if it has a non-empty unit or a positive rate → demote to `LINE_ITEM(qty=0.0, is_rate_only=True, level=None)`. Row 341 in Snitch Electrical (sl_no='7.0', unit='KG', no children, path='305/341') was the target: now LINE_ITEM. Row 500 (sl_no='2.0', unit='LS', path='394/500', has 5 children) correctly NOT demoted (§17.10 deferred). Additionally, PIR sensor row in Snitch Light Fixtures (resolved_idx=14, unit='NOS', leaf node) also demoted by the same logic — this is correct behaviour (the classifier's blank-qty-no-rate rule had set it PREAMBLE, but it is a genuine rate-only item with a unit). Snitch expected JSON updated: Electrical LINE_ITEM 175→176, PREAMBLE 44→43; Light Fixtures LINE_ITEM 13→14, PREAMBLE 1→0; `row_16_preamble_anomaly` updated to reflect B2f-demoted LINE_ITEM classification. `test_snitch_light_fixtures_row_16_preamble_anomaly` test body updated (LINE_ITEM check). 8 new tests in `TestZeroChildrenPreambleDemotion` class in `test_hierarchy.py`. All 190 tests green. §17.10 known issue (priced PREAMBLE with children at row 500) explicitly parked. Feat commit: see git log.

**Part B2c complete (2026-05-14):** Committed `snitch_electrical.xlsx` (138,066 bytes, 5 sheets: OVERALL SUMMARY, SUMMARY MEP, 6. Electrical, 7. Light Fixtures, MAKE LIST). Wrote `snitch_electrical_expected.json` with narrow expected-output spec covering: workbook-level assertions (sheet count=2, master_preamble=None, no validation warnings), skip-sheet assertions, first 5 LINE_ITEMs per sheet, all 9 SUBTOTAL_MARKERs in Electrical + 1 in Light Fixtures, preamble level transitions (levels 1/2/3 for Electrical), Light Fixtures PIR PREAMBLE anomaly, per-classification counts. Added `TestSnitchIntegration` class (12 test methods) in `test_orchestrator.py` — setUpClass calls `parse_boq()` once and caches result. §7.25 decision log wording corrected from "by mistake" framing to deliberate policy-reversal framing. Snitch fixture partially closes §9 #40 (JSW MEP Priced still on local disk only). Known issue §17.8 (reserved keyword gap survey) deferred to Phase 2c. Test count: 161 → 173. Feat commit: see git log. Docs commit: see git log.

### Phase 2c — DB commit + version cascade + 4 more fixtures ⏳ FUTURE

**Blocked on Phase 1.8 + 1.9.** Per-area rate+amount schema extension must land BEFORE Phase 2c DB-commit work begins. Rationale: no real BoQ data is committed to the DB yet (only test fixtures); this is the cheapest possible moment to extend the schema. Once Phase 2c starts writing real parsed BoQ data, every subsequent schema extension carries a migration, writer-rewrite, and data-correctness audit. Phase 1.8 (schema + controller + migration) and Phase 1.9 (parser support including 3-col-per-area Pattern 2-rate detection) sequence first.

- commit_parsed_boq(parsed_output) writes master + sub-BoQs + nodes + qty_by_area to DB
- Version cascade (deferred from Phase 1.7) — re-upload triggers cascade: old master + old children → Superseded; new master + new children at v+1; missing-sheet handling per Q-Cascade-Missing decision (drop, not carry-forward)
- 4 more end-to-end fixtures (JSW Unpriced, Paytm, Inovalon HVAC, HYBE) using golden-with-review approach (run parser, eyeball output, save as expected)
- ~20 tests
- Manual back-office demo at end

**Scope expansion (2026-05-16, §7.34):** `commit_parsed_boq()` must implement the commit-time merge logic for the `notes` field — read `row_notes` from each row's classified_row, walk ancestor chain via `resolved_row.path` to assemble inherited `append_notes_raw` content, emit structured-prefix lines per the §7.34 format, write final string to `BOQ Nodes.notes` field.

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

**append_to_notes wizard responsibility (2026-05-16, §7.34):** Surface `append_to_notes` as a column-role choice during per-sheet mapping. Allow user to assign it to any number of columns (multi-select, not singleton). Show a preview of the resulting notes field on a sample row before commit so user can verify. Future optional enhancements: user-override displayed column name; user-customize prefix format. Initial v1 ships with default format and raw column headers.

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

### 17.5 Raheja-style Pattern 2 variant — 3-col-per-area with rate column

**Issue:** Real BoQ files from Raheja Commerzone Chennai exhibit a Pattern 2 variant not handled by the current `detect_multi_area_pattern()` algorithm. The top row has area names in merged cells, but each merge spans **three** columns (not two), with the bottom row containing `[Qty][Rates][Amount]` under each merge (not `[QTY][AMOUNT]`). The current Pattern 2 algorithm (`_try_pattern_2` in `multi_area_detection.py`) is hardcoded to:
- Reject merges where `(max_col - min_col + 1) != 2` (2-col merges only)
- Require bottom-row pairs to match `_QTY_CELL_PATTERN` and `_AMOUNT_CELL_PATTERN` exactly (no rate cell in between)

Both checks fail on Raheja sheets. Detection priority falls through P2 → P3 (bottom: only reserved keywords) → P1 (bottom: only reserved keywords) → P1 (top, last-resort): finds the merge origins, returns `MultiAreaPattern(pattern=1, areas=[...], amount_columns=None)`. The result is technically "valid output" but factually wrong — areas have per-area amounts AND per-area rates that the Pattern 1 designation does not represent.

**Real-data evidence:** Verified 2026-05-13 across all sheets of `RAHEJA Commerzone Chennai BOQ.xlsx`. Every sheet uses the 3-col-per-area variant. The "Phase 1 / Phase 2" naming pattern and 3-col `Qty / Rates / Amount` shape are uniform.

**v5.3 documentation drift:** v5.3 §3 names Raheja as the "primary Pattern 2 validation target" — this assumption was wrong; Raheja does not match the textbook Pattern 2 spec at all.

**Disposition:** Defer to **Part D** (which already holds Pattern 4 + Pattern 6 candidate work) OR create a new dedicated sub-phase **Part D2 — Pattern 2-rate extension**. Likely scope: a new pattern designation (e.g., `pattern=4` if not already taken, or extending `MultiAreaPattern` with an optional `rate_columns` field), an extended detection algorithm accepting 3-col merges with `[QTY][RATE][AMOUNT]` pairing, ~3-5 new tests, and real-data re-verification on Raheja. Schema-side support already exists in Part A2 (`qty_by_area`, `amount_by_area`, and per-sheet `rate_combined` ColumnRoles are sufficient to represent the shape without new schema work).

**Status:** Open. Not blocking Part B or Phase 2c. Blocking only Raheja-specific parsing.

**Status updated 2026-05-16:** Re-opened. Absorbed into Phase 1.9 parser support scope. The 3-col-per-area shape detection lands as part of the per-area rate+amount schema extension work (see §7.32). No standalone follow-on sub-phase.

### 17.6 Fixtures folder contains only synthetic files; v5.3 "locked fixtures" claim was aspirational

**Issue:** v5.3 §3 and working agreement #12 (2026-05-10) state that real BoQ files (specifically JSW MEP Priced and Snitch) are "locked fixtures" committed to `nirmaan_stack/services/boq_parser/tests/fixtures/`. Inspection on 2026-05-13 shows that folder contains ONLY synthetic files:

- `generate_synthetic.py` (the generator script)
- `synthetic_blank_cols.xlsx`
- `synthetic_empty.xlsx`
- `synthetic_makelist_header.xlsx`
- `synthetic_merged_header.xlsx`
- `synthetic_simple.xlsx`
- `synthetic_sparse_header.xlsx`
- `synthetic_trailing_spaces.xlsx`

A `Get-ChildItem -Recurse -Filter "*JSW*"` across the entire `nirmaan_stack` repo on 2026-05-13 returned zero results.

**Root cause:** Working agreement #12 declared the intent to commit real fixtures, but the actual commit appears never to have happened. v5.3 was written as if the commit had landed.

**Impact:** Phase 2c (DB commit + version cascade + fixtures) cannot proceed against committed real fixtures because they don't exist in the repo. They currently live only on Nitesh's local disk at `C:\Users\nites\Downloads\`.

**Disposition:** **Phase 2c first action — commit the real fixtures.** Before adding any DB commit logic or version cascade tests, copy the real BoQ files into `tests/fixtures/` and commit them via a dedicated `chore(boq):` or `feat(boq):` commit. The handover doc's "locked fixtures" claim then becomes accurate. Per working agreement #12, no anonymization needed (this is an internal repo).

**Files to commit at Phase 2c kickoff:** at minimum `JSW MEP Priced` and `Snitch`. Additional fixtures (Raheja, TableSpace, DhashTech, Société Générale, etc.) can land in batches as Phase 2c progresses.

**Status (updated 2026-05-15):** CLOSED. 24 real BoQ fixtures committed at Phase 2c kickoff via feat commit `cfeaad1c`. Fixtures directory now contains: 8 synthetic files (7 originals + 1 synthetic_multi_area still untracked per B2a) + 1 Snitch (committed in B2c) + 24 real BoQ files = 33 total xlsx fixtures in tests/fixtures/. MappingConfig authoring for each new fixture deferred to per-fixture sub-phases later in Phase 2c. §9 #40 (handover doc) and §17.6 (plan doc) considered closed by this commit.

### 17.7 docker cp temp-file cleanup requires `-u root` flag

**Issue (operational):** When using `docker cp` to copy a temporary file into the Frappe container for manual verification (e.g., Session 4 real-data verification), the file lands inside the container as `root:root` owned. The default user when running `docker exec frappe_docker_devcontainer-frappe-1 ...` is the `frappe` user, who cannot delete root-owned files in `/tmp/`.

**Resolution:** Cleanup command needs `-u root`:

```
docker exec -u root frappe_docker_devcontainer-frappe-1 rm /tmp/<temp_file>.xlsx
```

**Standing rule for future docker-cp-based verifications:** include `-u root` in any `rm`/cleanup commands targeting files placed by `docker cp`. Verified and applied 2026-05-13 during Session 4 cleanup of `/tmp/jsw_test.xlsx`.

**Worst case if `-u root` is forgotten:** the temp file persists in `/tmp/` until container restart. Harmless (just untidy) since `/tmp/` is volatile.

### 17.8 Multi-area reserved keyword list — thorough survey deferred to Phase 2c

**Issue:** The `GlobalSettings.multi_area_reserved_keywords` list was initially set to 22 entries (Part A2) and expanded to 49 entries during Part B2b-keywords (triggered by the Snitch Light Fixtures false positive). The expansion was reactive — driven by one specific false positive, not a systematic survey of all header-word variants across the real-BoQ corpus.

**Known gaps:** No cross-file keyword analysis has been performed. Additional header words from JSW, Raheja, Paytm, Inovalon, HYBE, and other fixtures may still produce false positives in Pattern 1 detection when those files are parsed in Phase 2c.

**Disposition:** Defer systematic survey to Phase 2c. At Phase 2c kickoff, run `detect_multi_area_pattern()` against all committed real fixtures and inspect the output for false-positive areas. Any false-positive area name → add the offending header word to the reserved list. Working agreement: Phase 2c first-run verification step explicitly includes a keyword sweep before authoring any expected-output JSON.

**Status (updated 2026-05-15): CLOSED.** Audit half: `keyword_audit.py` (feat `da105976`) surfaced 125 candidate detections across 25 real fixtures. Expansion half (feat `824e3634`): 49→120 keywords (+71 in 6 buckets) + `_is_reserved` whitespace normalization + parenthetical strip. Post-expansion audit count: 112 (down from 125). The <50 target was not reached because the fixture set includes ~25+ genuine multi-area BoQs (RAHEJA PHASE-1/PHASE-2: 14 blocks, D-Tech floor-based: ~8, JSW MEP: 2) that are correctly detected and must not be suppressed. Remaining false positives (column headers: AREA/ACTIVITY/WORKITEM in D-Tech civil sheets; revision metadata: REV/RO in top-row fallbacks) are candidates for a follow-on keyword pass if needed. §9 #44 CLOSED on keyword-expansion landing; post-expansion sweep of remaining blocks is a non-blocking future caveat.

### 17.10 Phase 2c reserved keyword expansion did not reach detection target on first pass — targeted follow-on landed

**Issue:** Phase 2c keyword expansion sub-phase (feat `824e3634`, docs `db80d27e`) expanded `multi_area_reserved_keywords` from 49 to 120 entries with 71 new entries across 6 buckets (generic construction terminology: SQFT, NUMBER, BRAND, MARKET RATE, etc.). The post-expansion audit re-run dropped detection count from 125 to 112 — well above the spec'd <50 target. Root cause: the 71 entries committed did not match the specific false-positive triggers surfaced in the §9 #44 audit data (metadata top-row labels, per-row-attribution columns, space-and-typo Sl.No variants, etc.).

**Disposition:** Targeted follow-on sub-phase (feat `010666cc`, this docs commit): 71 specific entries added based on direct mapping from audit findings to false-positive triggers. List grows 120 → 191 entries. Post-targeted audit count: 50 detections (down from 112).

**Status (updated 2026-05-15): CLOSED.** §17.10 marked closed on targeted-additions landing. Of the 50 remaining detections, approximately 25 are genuine multi-area BoQ layouts (RAHEJA PHASE-1/PHASE-2 across 14 sheets, JSW MEP B1/B2/B3/B6, D-Tech per-floor floor-name areas, Bill of Quantities AV floor-names, DHL FK-5-1-12 critical-room areas, Voyager/Victor compound names on Société Générale) and must be preserved. Net real false positives remaining: roughly 25. These are candidates for structural heuristics (top-row title-repetition detection, sparse-metadata pattern detection) rather than keyword expansion — deferred as a future caveat if the residual false-positive count proves to be blocking during per-fixture MappingConfig authoring sub-phases.

### 17.11 Phase 2c caveats #2 + #4 cleanup — qty_by_area deprecation + 2-row Pattern 2 detection coverage

**Caveat #2 (§9 #42) — `qty_by_area` role removed from `ColumnRole.role` Literal:** The `qty_by_area` role was added in Part A2 as a parallel to `amount_by_area`, but the classifier never wired it — all per-area qty capture always used `role="qty"` with an `area=` field. The role was dead code in the Literal. Cleanup: removed `qty_by_area` from the `ColumnRole.role` Literal (it was already absent from `_AREA_COMPATIBLE_ROLES`). Validator `area_required_for_by_area_roles` renamed to `area_required_for_amount_by_area_role` and simplified to check only `amount_by_area`. Cascades: `test_qty_by_area_with_area_succeeds_in_full_sheetconfig` (test 17) updated to `role="qty"` (mechanical cascade per agreement #21); `test_pattern_4_full_mapping_validates_successfully` (test 21) updated similarly. New test 22 added: `test_qty_by_area_role_rejected_after_deprecation` — `ColumnRole(role="qty_by_area", area="Floor 1")` raises ValidationError even with area set. `test_config.py` count: 21 → 22.

**Caveat #4 (§9 #43) — premise correction + 2-row coverage gap:** Original framing in §9 #43 stated that `parse_boq()` on `synthetic_multi_area.xlsx` returned `multi_area_pattern=None` for the 1-row fixture and needed fixing. Step 0 verification revealed this premise was **wrong**: the fixture already returns `MultiAreaPattern(pattern=1, areas=['Floor 1', 'Floor 2'])` as of the current code. The "Total Qty" column (F1) appears AFTER "Floor 1" (D1) and "Floor 2" (E1), so Pattern 1 collects 2 areas before the `TOTAL_QTY_PATTERN` break. The `parse_boq()` result had always been non-None; the caveat's premise was stale. **Reframe (user-confirmed):** (a) Add Pattern 1 assertions to the existing 1-row integration test (`test_multi_area_post_pass_full_pipeline`) to lock in the now-verified passing behaviour; (b) Add a new 2-row Pattern 2 fixture (`synthetic_multi_area_2row.xlsx`) via `generate_multi_area_2row()` to cover the genuine 2-row header mode gap. The 2-row fixture has top header (row 1) with `Block A` / `Block B` merged cells and bottom header (row 2) with `Qty` / `Amount` pairs — `header_row=2, header_row_count=2`. New integration test class `TestMultiAreaDetectionIntegration` (1 test) verifies end-to-end `pattern=2`, `areas=["Block A", "Block B"]`, and per-area qty on resolved rows. `test_orchestrator.py` count: 27 → 28.

**Status (updated 2026-05-15): CLOSED.** Both caveats resolved in feat commit `c6910c71`. Test count: 205 → 207 (test_config 21→22 + test_orchestrator 27→28). `synthetic_multi_area_2row.xlsx` is generated at test runtime by `setUpClass`; the file is untracked alongside `synthetic_multi_area.xlsx`.

### 17.11.C Phase 2c §9 #45 priced-PREAMBLE-with-children review-flag implementation

**Implementation (§9 #45):** Two new fields added to `ResolvedRow` in `hierarchy.py`: `needs_classification_review: bool = False` and `review_reason: str = ""`. New post-pass `_apply_priced_preamble_with_children_review_flag_post_pass(resolved_rows)` added to `hierarchy.py`, wired in `orchestrator.py` between Step 4a (zero-children demotion) and Step 4b (multi-area post-pass) per §7.30. The post-pass flags any PREAMBLE that (a) has tree children (path in `paths_with_descendants`) AND (b) carries a price signal (alphanumeric unit string OR any rate field > 0). Flagged rows: `needs_classification_review=True`, `review_reason="priced_preamble_with_children"`. Re-parenting and demotion are NOT performed by the parser — the Phase 3 wizard reads `review_reason` to launch the re-classification flow.

**Audit (§9 #45 pre-step):** Audit script `nirmaan_stack/services/boq_parser/preamble_with_children_audit.py` (feat commit `1ad12a7b`) confirmed exactly one candidate across Snitch Electrical: resolved_idx=500, xlsx_row=502, sl_no='2.0', path='394/500', unit='LS', 5 direct children, `children_shape="siblings"`. No candidates in synthetic_simple. Re-running the audit on the current tip will now show row 500 with `needs_classification_review=True` on the parsed output (the audit script itself is unchanged — it reports the candidate, not the flag state).

**Test coverage:** 9 new tests in `TestPricedPreambleWithChildrenReviewFlag` (test_hierarchy.py) + 1 Snitch integration test `test_snitch_row_500_flagged_for_priced_preamble_with_children_review` (test_orchestrator.py). Test count: 207 → 217.

**Status (updated 2026-05-16): CLOSED.** feat commit `7ff4ce55`, docs commit this session. §17.10 (Priced PREAMBLE with tree children) updated to CLOSED. Next: Reader `sheet_state` exposure (§9 #49).

### 17.11.D Phase 2c §9 #49 reader sheet_state exposure

**Implementation (§9 #49):** New method `BoqReader.list_sheet_states() -> dict[str, str]` added to `reader.py` as a pure pass-through over openpyxl's `Worksheet.sheet_state`. Return value maps each sheet name (exact whitespace + casing, matching `list_sheets()`) to its visibility string — one of `'visible'`, `'hidden'`, or `'veryHidden'` — exactly as openpyxl yields them. No normalisation, no enum wrapper, no caching. Placement: immediately after `list_sheets()` in `reader.py`. No changes to any other source module.

**Design (§7.31):** See decisions log entry.

**Test coverage:** New `TestSheetStateExposure` class (4 tests) added to `test_reader.py`. Tests cover: all-visible default, one hidden sheet, one veryHidden sheet, and whitespace/order preservation. All use in-memory `openpyxl.Workbook` + `tempfile.TemporaryDirectory()` per-test (no committed fixture changes). Test count: 217 → 221.

**Non-breaking:** Additive only. No existing method changed. No existing test modified.

**Status (2026-05-16): CLOSED.** feat commit `3e9eafe0`. Next: §9 #48 classifier-dictionary audit half (see §17.11.E).

### 17.11.E Phase 2c §9 #48 classifier-dictionary audit

**What the script does:** Walks all 25 non-synthetic fixtures in `tests/fixtures/`, scans the first 15 rows of every sheet, and for each row with ≥ 3 non-empty cells tests every cell value against the classifier's `_HEADER_KW` dictionary. Records every string that no role's keyword set matches as "unclassified". Emits a JSON report with per-row detail, an unclassified-string frequency rollup, and summary counts.

**Script:** `nirmaan_stack/services/boq_parser/classifier_audit.py`

**Output JSON:** `nirmaan_stack/services/boq_parser/classifier_audit_output.json` (~5.4 MB)

**Run command (inside container):**
```bash
cd /workspace/development/frappe-bench/apps/nirmaan_stack
/workspace/development/frappe-bench/env/bin/python -m nirmaan_stack.services.boq_parser.classifier_audit
```

**Audit summary (from output JSON):**
- Fixtures attempted: 25 (24 scanned; 1 failed — `R0_CIVIL INTERIOR & MEP_TABLESPACE_PUNETH WORKING FILE_06.05.2026 (2).xlsx` contains invalid XML)
- Sheets scanned: 283
- Rows scanned (≥ 3 non-empty cells): 2,187
- Total cells scanned: 14,679
- Total classified: 1,770 | Total unclassified: 12,909
- Unique unclassified strings: 2,999

**Top 5 unclassified header strings by frequency (headers only — numerics dominate the raw rollup):**
1. `AMOUNT` (100 occurrences) — amount_total synonym family
2. `Sq.ft` (91) — unit/measurement column
3. `Amount` (71) — amount_total synonym (case variant)
4. `Rate` (67) — rate_combined synonym family
5. `Remarks` (64) — row_notes synonym family

**Note on rollup composition:** The raw top-frequency unclassified strings are dominated by numeric cell values (`0`: 2243, `1.0`: 295, etc.) because the first 15 rows of many fixtures include data rows that pass the ≥3 filter. These are expected junk that the expansion-half reviewer must filter. True column-header synonyms include: `Supply & Installation` (40), `SUPPLY & INSTALLATION` (20), `INSTALLATION` (29), `SUPPLY` (29), `Total Amount` (32), `Installation Rate` (25), `Supply Rate` (22), `SL. NO.` (17), `UOM` (11), `DSR` (12), `Make` (12).

**Status: CLOSED.** chore commit `f89e2478`. Next: §9 #48 classifier-dictionary expansion half (expansion-half sub-phase adds synonyms to `_HEADER_KW` in `classifier.py`).

### 17.11.F Phase 2c §9 #48 classifier-dictionary expansion + multi-area keyword expansion

**`_HEADER_KW` expansion (classifier.py):** Dict expanded from 5 to 14 role keys. The existing 5 keys (`sl_no`, `description`, `unit`, `qty`, `qty_total`) received audit-derived synonyms (e.g. `"sl. no"`, `"sr. no"`, `"si.no"`, `"particulars"`, `"item description"`, `"discription"`, `"uom"`, `"u.o.m"`, `"boq qty"`, `"total qty"`). Nine new role keys added: `rate_combined`, `rate_supply`, `rate_install`, `amount_total`, `amount_combined`, `amount_supply`, `amount_install`, `make_model`, `row_notes` — covering the rate/amount supply-install-combined split and make/notes label families prominent in real BoQ fixtures.

**`multi_area_reserved_keywords` expansion (config.py):** List expanded 191 → 224 (33 net new entries). New entries cover: SITC / S&I family (16 entries: SITC, S&I, S+I, SITC RATE, SITC AMOUNT, S&I RATE/AMOUNT, S+I RATE/AMOUNT, SUPPLY & INSTALLATION variants, SUPPLY AND INSTALLATION variants, SUPPLY, INSTALL & COMMISSIONING RATE), U.O.M, six "IN INR/RS" variants (RATE IN INR, RATE IN RS, RATE IN RS., AMOUNT IN INR, AMOUNT IN RS, AMOUNT IN RS.), NDSR (MR), COMBINED AMOUNT, six "AS PER BOQ" compounds (including a real-BoQ typo variant AS PER BNOQ TOTAL AMOUNT), SR., and AREA OF WORK. Seven entries from the original 41-entry spec were dropped as already-present duplicates (UOM, SPECS, SPECIFICATIONS, COMBINED RATE, FLOOR, LOCATION, NO.); original spec count was 40 not 41 (off by 1), giving 40 − 7 = 33 net new entries.

**classifier_audit.py sync (mechanical cascade, agreement #21):** The `_CLASSIFIER_HEADER_KW` frozen replica in `classifier_audit.py` was synced from 5 to 14 keys to match `_HEADER_KW`. Previously the replica was frozen at audit time; the sync makes future re-runs reflect the live dict. The "intentionally frozen" comment was updated to "synced as of Phase 2c §9 #48 expansion".

**Audit re-run delta (after sync):** classified 1,770 → 3,255 (+1,485 / +83.9%); unclassified 12,909 → 11,424 (−1,485); unique unclassified 2,999 → 2,697 (−302 / −10.1%). Total cells scanned unchanged (14,679) — same fixtures, same rows, only classification improved.

**Test count delta:** +10 in `TestHeaderKwExpansionPhase2c` (test_classifier.py — 8 required + 2 extra for `particulars` and `boq qty` synonyms), +6 in `TestReservedKeywordExpansionPhase2cSitcAndCombinedRoles` (test_multi_area_detection.py). Mechanical assertion bump in test_config.py (191 → 224, +5 spot-check entries: SITC RATE, SUPPLY & INSTALLATION, RATE IN INR, AS PER BOQ TOTAL AMOUNT, NDSR (MR)). Parser test count: 221 → 237.

**Non-breaking:** Pure data additions to both lists. No changes to `_is_reserved` matching logic, `classify_row` flow, or `detect_multi_area_pattern` algorithm. Existing parser behaviour fully preserved.

**Status: CLOSED.** feat commit `a0d2b4a5`. Next: DB commit + version cascade sub-phase.

### 17.11.G Phase 1.9c real-fixture integration tests (Raheja Electrical + HVAC + D-Tech CIVIL WORKS)

**Goal:** Add real-fixture integration tests to `test_orchestrator.py` covering three fixtures. No parser code changes. No Frappe code changes.

**Fixtures covered:**

1. **Raheja Commerzone Electrical sheet** ("Electrical ", trailing space) — Pattern 2-rate end-to-end with inline MappingConfig. Finding F3b confirmed: bottom header has "RATES" (plural); `_RATE_CELL_PATTERN` rejects it; pattern falls through to Pattern 1. `test_electrical_pattern_2_rate_detected` marked `@unittest.expectedFailure`.
2. **Raheja Commerzone HVAC sheet** ("HVAC ", trailing space) — Pattern 2-rate stress test. Finding F5 confirmed: area-name row is row 2 but `top_header_row` is hardcoded to `header_row − 1 = row 14` (blank intermediate row); no area names found. `test_hvac_pattern_2_rate_with_header_gap` marked `@unittest.expectedFailure`. F5 is distinct from F3b: HVAC bottom header has "RATE" (singular) — rejection is caused by wrong `top_header_row`, not RATES-plural mismatch.
3. **D-Tech CIVIL WORKS sheet** — `append_to_notes` end-to-end. Row 1 has a merged "PHASE-0" banner spanning all columns including G (Specs); `skip_top_rows_after_header=[1]` (absolute row number, confirmed from orchestrator `skip_rows.update()`) added to MappingConfig to discard it at parse time. Specs (G) always empty in fixture (0/54 data rows populated) — used as the always-absent column for Policy-X verification. Column E (Workitem) intentionally omitted from `column_headers` to exercise letter-fallback (`append_notes_raw["E"]`).

**Test classes added:**
- `TestPhase19cRealFixturesRaheja` — 4 tests (1 expectedFailure: F3b)
- `TestPhase19cRealFixturesRahejaHVAC` — 1 test (1 expectedFailure: F5)
- `TestPhase19cRealFixturesDTechCivilWorks` — 5 tests

**Test count:** 257 → 267. Expected failures = 2, counted as OK in suite verdict.

**Audit regression:** Zero flips in `classifier_audit.py` and `preamble_with_children_audit.py` — no parser code changed.

**Frappe boundary:** 88 PASS (28 boqs + 60 boq_nodes) — unchanged.

**Findings documented:**
- **F3b** — `_RATE_CELL_PATTERN = r"^\s*rate\s*$"` matches "RATE" singular only; "RATES" plural falls through to Pattern 1. Phase 1.9d candidate: widen to `r"^\s*rates?\s*$"`.
- **F5** — orchestrator `top_header_row` hardcoded to `header_row - 1`; cannot span multi-row gaps (e.g. 13 rows between area-name row 2 and bottom header row 15 in HVAC). Phase 1.9d candidate: `top_header_row_override` SheetConfig field.

**Status: CLOSED.** feat commit `f62a0ca5`. Phase 1.9d candidate scope: F3b + F5 bundled. Phase 2c next (unblocked).

### 17.9 Preamble stack-depth cascade in hierarchy resolver — parked

**Issue:** `_determine_preamble_level` in `hierarchy.py` uses a stack-walk heuristic: lowercase-letter sl_no tokens (`a.`, `b.`, … `z.`, `aa.`, `ab.`) each increment `stack_depth + 1`. In Snitch Electrical's cable-size section, every nested cable item has a lowercase-letter sl_no, causing the stack depth to climb from 3 to 21 over the section. These deeply-nested rows get `level=21` and are mistakenly classified as PREAMBLEs by the base classifier (sl_no + description, no qty → PREAMBLE). B2d-classifier's unit-based demotion post-pass addresses the symptom: those rows carry a unit value (e.g. `'Nos.'`) that matches real LINE_ITEM units on the sheet, so they are demoted to LINE_ITEM before the preamble candidate scorer runs.

**Residual concern:** The resolver's stack-depth rule is structurally wrong for real BoQs with deep lowercase cascades. A row that genuinely IS a section header with a unit value would also be demoted — the demotion criterion has no way to distinguish real section-header units from line-item units. This is unlikely in practice (real section headers have no unit), but it is a known structural weakness.

**Disposition:** Parked. B2d-classifier's unit-based demotion is sufficient for all known real fixtures (Snitch Electrical confirmed). Root-cause fix in `hierarchy.py` — e.g., capping lowercase-letter stack depth relative to the enclosing level — is deferred until a fixture is encountered where the symptom-level fix is insufficient.

**Status:** Open. Not blocking any current phase. Revisit if a real fixture shows demoted rows that are genuine section headers.

### 17.10 Priced PREAMBLE with tree children — re-parenting deferred

**Issue:** After B2d (unit-based demotion) and B2f (zero-children demotion), one PREAMBLE in Snitch Electrical remains that has both priced content (unit='LS') AND tree children: resolved_idx=500, sl_no='2.0', path='394/500', 5 children. It should arguably be demoted to LINE_ITEM (it carries a rate and a unit, implying it is itself a priced item), but doing so would orphan its 5 children — their `parent_index` would still point to the now-LINE_ITEM row. Re-parenting children to the demoted row's parent, or promoting them to top-level, requires a second pass over the resolved list to update `parent_index` and `path` values on all descendants. This is a non-trivial structural change.

**Disposition:** Explicitly OUT OF SCOPE for B2f. B2f's algorithm intentionally skips PREAMBLE rows that have descendants (`row.path in paths_with_descendants`). If row 500 is the only such case across the full real-fixture corpus and its children parse correctly, this is acceptable. If a future fixture shows the same pattern and the priced-but-with-children PREAMBLE causes downstream DB/UI problems, add a dedicated re-parenting pass as Part B2g (or Phase 2c extension).

**Status (updated 2026-05-16): CLOSED.** §9 #45 audit (commit `1ad12a7b`) confirmed row 500 as the sole candidate across the in-scope fixtures. §9 #45 implementation (feat `7ff4ce55`) resolves this by flagging the row via `needs_classification_review=True` / `review_reason="priced_preamble_with_children"` rather than auto-demoting. Re-parenting remains OUT OF SCOPE for the parser; deferred to Phase 3 wizard. See §17.11.C and §7.30.

### 17.12 Skip-then-ingest sheet type — parked

**Issue:** The current `SheetConfig.treat_as` Literal supports `"data"` and `"master_preamble"`. Real BoQs occasionally have a third sheet type: a summary or table-of-contents sheet that should be skipped for parsing but whose text should be ingested as unstructured metadata (e.g., room-area schedule, legend, cost summary). Setting `skip=True` discards the sheet entirely; there is no mechanism to capture its content without parsing it as a data sheet.

**Proposed addition:** A third `treat_as` value `"skip_then_ingest"` that causes the sheet to be skipped for row-by-row parsing but whose raw text content is captured and attached to the `ParsedBoq` as `ingest_only_sheets: dict[str, str]` (sheet_name → concatenated cell text). The wizard (Phase 3) can surface this text in a read-only panel for the user's reference.

**Disposition:** Parked. No real fixture currently requires this. The cost of skip=True is low — users can open the source Excel if they need the summary. Revisit if Phase 3 wizard user testing shows a clear need for ingested-but-not-parsed content. The `treat_as` Literal in `config.py` is the natural extension point; adding a third value is non-breaking.

**Status:** Open. Not blocking any current phase.

### 17.13 Wizard-load review pending — cumulative deferred-to-wizard inventory + UX-friction concern

**Status:** OPEN, re-evaluation pending post Phase 1.9e.

**Context (2026-05-17 chat-Claude / Nitesh discussion).** Multiple shape-handling decisions across Phases 1.8 – 1.9 have been deferred to Phase 3 wizard:
- Pattern 6 compound area names (§7.4 / §7.19, deferred since 2026-05-12)
- BMS schedule skip disposition (agreement #24)
- Vendor-compare disposition (agreement #24)
- Hidden-sheet default-skip (agreement #24, supported by §7.31 `BoqReader.list_sheet_states()`)
- Per-row attribution column-role choice (§7.34 `append_to_notes`; Phase 1.9b parser-side landed; commit-time merge owed in Phase 2c; wizard UX owed in Phase 3)
- Merged-title-banner default-skip (agreement #24 extension candidate; Phase 1.9d F7)
- Priced-PREAMBLE-with-children re-classification flow (§9 #45; parser-side review flag landed v5.9; wizard demote+re-parent owed in Phase 3)
- Multi-row top-header gap multi-row case (§7.39 candidate; Pattern 6 absorption)
- Declarative-first wizard direction (chat-Claude proposed 2026-05-16: parser-as-suggestion-engine, wizard-as-decision-engine; Nitesh locked direction: parser-fix-then-stress-test-then-wizard; not captured in v5.12 / v5.13 housekeeping — surfaced via conversation_search 2026-05-17)

**Standing concern (Nitesh, 2026-05-17).** Cumulative user-declaration load in Phase 3 wizard may be both UX-hostile (too many per-sheet decisions per upload) and error-prone (wrong user choices propagate to committed BoQ data). Worth a deliberate design conversation before Phase 2c body locks commit-time semantics.

**Re-evaluation trigger.** Post Phase 1.9e (real-fixture stress test observability chore). Phase 1.9e walks all 24 real fixtures with auto-guessed MappingConfigs and emits a characterization report. That report is the empirical basis for the decision — what fraction of sheets the parser gets right with zero user declaration, what fraction needs 1-2 overrides, what fraction needs 5+ overrides.

**Three threads to think through at re-evaluation time.**
1. Which deferred items get parser auto-detection (move work back to parser) vs stay with wizard.
2. Whether Phase 4 (LLM-assisted column-role suggestions, currently sequenced after Phase 3) should move up — AI auto-mapping is the direct mitigation for wizard friction. Nitesh flagged this as a parallel thread to explore 2026-05-17.
3. Per-template MappingConfig re-use as primary mitigation: if a user uploads the same vendor's BoQ template repeatedly (Raheja revision cycles, JSW project re-uploads), saved templates drop declaration cost to near-zero on subsequent uploads. Worth thinking about whether the wizard ships with this as a first-class concept (not bolted on later).

**Decision shape to make at re-evaluation.** Confirm or revise the locked sub-phase sequence (currently Phase 1.9d → 1.9e → 2c body → Phase 3 wizard → Phase 4 AI assist). Specifically: does Phase 4 stay after Phase 3, or interleave / move up?

**Status: OPEN. Re-evaluate post Phase 1.9e.**

Re-evaluation now unblocked — empirical data committed at 5cd4f580.

---

## Decisions log

Newest at the top.

### Phase 1.9f Stage 1 complete (2026-05-17)

**Multi-area triage diagnostic on 3 sheets at both header_row_count values.**

- Chore commit: c42eec9a
- Docs commit: see git log (paradox-free per §9 #69)
- Targets: Raheja Commerzone Chennai BOQ — Electrical + HVAC sheets;
  Snitch fixture — Electrical sheet.
- Per (sheet, header_row_count in [1, 2]) captured: classification,
  pattern, areas, header_row, first 3 L1 preambles, first L2 preamble,
  first 10 line items with parent + per-area + totals qty/rate/amount.
- Parser tests: 274 passing (unchanged — no parser code touched).
- Frappe tests: not run (no Frappe code touched, per agreement #20).
- Output files: multi_area_triage_1_9f_output.json (machine-readable),
  multi_area_triage_1_9f_output.txt (human-readable).
- Next step: chat-Claude + Nitesh review the output and decide on
  Stage 2 scope (None-case triage, additional targets, or proceed to
  §17.13 design conversation).

### Phase 1.9e complete (2026-05-17)

**Script committed, output JSON committed; 25 workbooks / 68 sheets parsed / 62 rate-synonym variations surfaced.**

- Chore commit: 5cd4f580 (`real_fixture_stress_test.py` + `real_fixture_stress_test_output.json`)
- Docs commit: this commit
- Parser tests: 274 passing (unchanged — Phase 1.9e touched no parser source files)
- Frappe tests: not run (per agreement #20; Phase 1.9e touched no Frappe code)
- Top rate-synonym variations: `rate` (60 occurrences across 15 fixtures/sheets), `price` (2 occurrences, `Bill of Quantities.xlsx` Audio & Visual sheet)
- 1 workbook load failed: `R0_CIVIL INTERIOR & MEP_TABLESPACE_PUNETH WORKING FILE_06.05.2026 (2).xlsx` — openpyxl XML parse error (unable to assign names); recorded in output JSON under `load_exception`
- Pattern distribution across 68 parsed sheets: Pattern 1 = 9, Pattern 2-area = 0, Pattern 2-rate = 0, Pattern 3 = 0, None = 59 (Pattern 2/3 = 0 expected — auto-guess sets `header_row_count=1` only)
- **Caveat on Pattern distribution numbers:** The auto-guess MappingConfig design uses `header_row_count=1` (the SheetConfig default). This means Pattern 2-rate (Raheja-shape, requires 2-row top header) and Pattern 3 (multi-row concat) are unreachable by construction in this stress test — the "None=59" count is dominated by sheets that would detect a multi-row pattern if the auto-guess set `header_row_count=2`. The "Pattern 1=9" count IS a real detection. Future 1.9f follow-up may re-run with header_row_count=2 auto-guess as a second pass to measure multi-row pattern reachability. Empirical input for §17.13: with zero user declaration AND single-row header assumption, 9/68 (13%) of sheets get pattern-detected; the remaining 59 either don't have a multi-area pattern OR have one the auto-guess can't reach.
- §9 #28 EXTENDED triggered (synthetic fixture ZIP timestamp noise after Docker test run) — cleared with `git restore` per v5.13 housekeeping note before commit
- **Scope deviation from v5.12 plan-doc 1.9e scope:** original said "pick largest data sheet (or all data sheets if total < 8)"; adopted "3-4 real BoQ sheets per workbook, skip sheets excluded, selection reported in output JSON" per chat-Claude / Nitesh decision 2026-05-17. Rationale: tighter scope produces cleaner empirical data for §17.13 re-evaluation.

### 2026-05-16 — Phase 1.8 implementation complete

**Phase 1.8 — per-area rate + amount schema extension landed.**

- 7 fields added to `BOQ Node Qty By Area`: `supply_rate`, `install_rate`, `combined_rate`, `supply_amount`, `install_amount`, `total_amount`, `amount_override`.
- `integrations/controllers/boq_node_qty_by_area.py` created as helper module (called from parent controller — no hooks.py change). Implements: universal-rate fallback, auto-compute child amounts, combined_rate consistency validation.
- `boq_nodes.py` extended: `_process_qty_by_area_rows` + `_recompute_parent_rates_from_areas` in `before_save`; per-child validation in `_validate_qty_by_area`.
- Weighted-average parent rate recompute when per-area rates diverge.
- `"make_model"` added to `_write_audit` tracked-fields list (1-line cascade fix per §7.33 + §9 #55).
- Migration patch `back_populate_boq_node_qty_by_area_rates` in `v3_0` registered.
- `dab597cf` placeholders backfilled per §9 #57.
- 11 new Frappe tests added to `test_boq_nodes.py`. Phase 1.x Frappe tests: 77 → 88 (60 boq_nodes + 28 boqs). Parser tests: 237 (unchanged).
- Feat commit: `7d5fbc4e` (filled in at commit time).

### 2026-05-16 — Phase 1.9a — per-area rate parser support landed

**Feat commit: `b2a2f747`**

- 3 new ColumnRoles added to `config.py`: `rate_supply_by_area`, `rate_install_by_area`, `rate_combined_by_area`. All require `area=` to be set (model validator mirrors `area_required_for_amount_by_area_role`). All added to `_AREA_COMPATIBLE_ROLES`.
- `rate_by_area_raw: dict[str, dict[str, float | None]]` field added to `ClassifiedRow` in `classifier.py`. Inner key is rate kind (`"supply_rate"`, `"install_rate"`, `"combined_rate"`). Policy X: explicit 0.0 preserved; blank cell produces no inner key. Module-level `_RATE_ROLE_TO_KIND` dict maps ColumnRole→inner key.
- `_RATE_CELL_PATTERN` compiled regex added to `multi_area_detection.py`. `MultiAreaPattern` extended: `pattern: int | str` (accepts `"pattern_2_rate"` string), `rate_columns: list[int] | None = None`. `_try_pattern_2_rate()` function detects the 3-col-per-area Raheja shape (merge span == 3, bottom-row QTY+RATE+AMOUNT sub-labels). `detect_multi_area_pattern()` routes Pattern 2-rate BEFORE Pattern 2 (stricter variant tried first to avoid misclassification).
- `_apply_multi_area_post_pass()` in `orchestrator.py` extended: reads `classified_row.rate_by_area_raw`, populates `row.rate_by_area` (deep copy, Policy X), auto-computes per-area amounts from rate×qty for areas without a direct amount, emits soft `combined != supply + install` validation warning (appended to `ResolvedRow.validation_warnings`, NOT a hard error). Priority: `combined_rate` → `supply_rate` → `install_rate` for auto-compute.
- `generate_pattern_2_rate()` added to `tests/fixtures/generate_synthetic.py`. Called from `generate_all()`. Produces `synthetic_pattern_2_rate.xlsx` (2-phase, 3-col-per-area, 2 data rows).
- 12 new parser tests (237→249): +2 test_config.py, +3 test_classifier.py, +4 test_multi_area_detection.py, +3 test_orchestrator.py.
- Phase 1.9b (`append_to_notes` parser) is next.
- §9 #50 standing decision partially revised: Pattern 2-rate detection re-opens §17.5. All per-area rates default to `combined_rate` kind in Phase 1.9a; split supply/install sub-label detection deferred.

### 2026-05-16 — §7.34 append_to_notes ColumnRole for long-tail column data preservation

**Decision:** Add a new `append_to_notes` ColumnRole that the Phase 3 wizard exposes as a user-assignable mapping option. Users explicitly mark any column whose data doesn't fit a structured schema field as "preserve to notes." Parser captures the values; Phase 2c commit step merges them into the existing `notes` Text field on `BOQ Nodes` with structured prefixes that disambiguate source. No schema change required.

**Role semantics:**
- User-assignable only — never auto-detected. Wizard must surface as an explicit column-role choice.
- Multiple columns on a single sheet may map to it (NOT in `_SINGLETON_ROLES`).
- No area-compatibility requirement (NOT in `_AREA_COMPATIBLE_ROLES`).
- Available for any sheet, any node type.

**Inheritance semantics:**
- Downward only. Values captured on a preamble row propagate to every descendant line item AND descendant sub-preamble.
- Values on a line item are NOT inherited anywhere — belong only to that row.
- Empty levels skipped — when walking up the parent chain to assemble a descendant's notes, levels with no `append_to_notes` data contribute nothing (no placeholder).

**Prefix format on each captured line:**

```
[Source: <where>] [Column: <column_name>] <value>
```

Where `<where>` is one of `THIS ROW`, `INHERITED L1`, `INHERITED L2`, `INHERITED L<N>` — arbitrary preamble depth supported per Phase 1.5. `<column_name>` is the source Excel column header text (or user-overridden label from wizard, future enhancement).

**Interaction with existing `row_notes` role:**

If a row has a value from a column mapped to the existing `row_notes` ColumnRole (the typical "Remarks" column with free-text human-written notes), that content goes FIRST in the notes field with NO prefix, preserving its identity as actual human remarks. Then a blank line separator. Then the structured `append_to_notes` block (own row's content + inherited from ancestors).

**Worked example — D-Tech CIVIL WORKS line item.** Columns: Description→`description`, Qty→`qty`, Unit→`unit`, Rate→`rate_combined`, Floor→`append_to_notes`, Area→`append_to_notes`, Activity→`append_to_notes`, Workitem→`append_to_notes`, Specs→`append_to_notes`, Remarks→`row_notes`.

Tree: L1 Preamble "Civil Works for Fourth Floor" with Floor="Fourth Floor"; L2 Preamble "CEO Cabin 02" with Area="CEO Cabin 02"; Line item "Wiring conduit, 25mm PVC, ISI marked" with Activity="Electrical", Workitem="Conduit", Specs="25mm PVC, ISI marked", Remarks="Lead time 4 weeks; verify with vendor".

L1 preamble's `notes` field:
```
[Source: THIS ROW] [Column: Floor] Fourth Floor
```

L2 preamble's `notes` field:
```
[Source: INHERITED L1] [Column: Floor] Fourth Floor
[Source: THIS ROW] [Column: Area] CEO Cabin 02
```

Line item's `notes` field:
```
Lead time 4 weeks; verify with vendor

[Source: INHERITED L1] [Column: Floor] Fourth Floor
[Source: INHERITED L2] [Column: Area] CEO Cabin 02
[Source: THIS ROW] [Column: Activity] Electrical
[Source: THIS ROW] [Column: Workitem] Conduit
[Source: THIS ROW] [Column: Specs] 25mm PVC, ISI marked
```

User-written remarks paragraph first (no prefix). Blank line. Then structured `append_to_notes` block.

**Scope split across phases:**

- **Phase 1.9 (parser):** Add `append_to_notes` to ColumnRole Literal in `config.py`. NOT in `_SINGLETON_ROLES`. NOT in `_AREA_COMPATIBLE_ROLES`. Validator needs no special handling. Add `append_notes_raw: dict[str, str]` field to `ClassifiedRow` in `classifier.py` — keys are source column header strings, values are cell values. Pattern mirrors `qty_by_area_raw`. Empty cells produce no dict entry. NOTE: `ResolvedRow` does NOT need its own `append_notes_raw` field — accessed via `resolved_row.classified_row.append_notes_raw`, same pattern as `make_model`, `description`, `unit`, etc.

- **Phase 2c (commit pipeline):** `commit_parsed_boq()` reads `append_notes_raw` from every row's classified_row, walks ancestor chain via `resolved_row.path`, assembles the final notes string per the prefix format. Writes to `BOQ Nodes.notes` field.

- **Phase 3 (wizard):** Surface `append_to_notes` as a column-role choice. Allow user to map any number of columns. Show preview of resulting notes field before commit. Optional future: let user override displayed column name; let user customize prefix format.

**Why this design over JSON `extra_data` field (Option B considered, rejected):**
- Plan doc §5.8 has a known JSON-as-trap caveat from `procurement_list` → `order_list` history.
- The existing `notes` field works without schema change — minimum-change principle.
- If notes field becomes too crowded in practice, refactoring to a JSON `extra_data` field later is clean, additive — defer until usage data shows the need.

**Why structured prefixes inside text (not separate sub-fields):**
- Compactness. Structured prefix is machine-parseable if Phase 5 UI wants to render as a table, and human-readable as plain text in Frappe form view.
- Sub-fields per BOQ Node would proliferate fields without bounding the count.

**Phase 1.9 scope note.** This addition expands Phase 1.9's scope (which was already substantial — `rate_by_area_raw` field, 3 new ColumnRoles for per-area rates, Pattern 2-rate 3-col detection re-opening §17.5, post-pass extension). Phase 1.9 may want its own sub-split (1.9a per-area parser work; 1.9b append_to_notes parser work). Decision deferred until 1.9 prompt drafting — note here so it's not surprising.

**Open questions deferred (recorded for future-Claude):**

1. **Re-mapping workflow.** If a user maps "HSN Code" to `append_to_notes` and later realizes HSN deserves a first-class field, what's the migration path? Re-upload? Re-parse with new mapping? Manual edit? Deferred — Phase 3/4/5 wizard design will resolve.
2. **Edit semantics in Phase 5 edit UI.** Should inherited notes on a line item display read-only (since editing there would be confusing — they reflect the parent) or editable (with edit propagating upward)? Deferred — Phase 5 UI design will resolve.
3. **Storage size monitoring.** Worst case ~25 lines in notes field (5 nested preambles × 5 append_to_notes columns). Frappe Text is unbounded so no hard cap. Monitor in practice. If becomes a problem, refactor to JSON `extra_data` field as clean follow-up.
4. **Prefix format customization.** Default is `[Source: ...] [Column: ...]`. User customization (different separator, shorter prefix, column-name override) is a Phase 3 wizard enhancement candidate. Not built in v1.

**Schema gaps this addresses (no first-class field needed today):**
Per-row attribution columns (D-Tech CIVIL WORKS Floor/Area/Activity/Workitem/Specs, 13+ sheets per §7.17); HSN/SAC codes for GST classification; Part code / Material code / Model number distinct from `make_model`; Reference image / drawing reference columns; "As per X Approved Rates" reference text (Snitch column H ignored); Vendor labels for vendor-compare sheets (Kohler HVAC's HVAC/ECO GREEN per agreement #24); Per-line-item GST rate when GST varies by item type.

### 2026-05-16 — §7.33 make_model already present on BOQ Nodes; Phase 1.8 scope reduced

**Discovery:** `make_model` field (`Data`, label `"Make / Model"`) is already present on `BOQ Nodes` at position 25 (between `qty_by_area` and `rates_col_break`) per `boq_nodes.json`. The Phase 1.8 plan premise that make_model needed to be added as part of per-area schema work is incorrect.

**Impact on Phase 1.8:** Remove `make_model` addition from Phase 1.8 scope. Phase 1.8 is solely the 7-field extension of `BOQ Node Qty By Area` (`supply_rate`, `install_rate`, `combined_rate`, `supply_amount`, `install_amount`, `total_amount`, `amount_override`) plus controller and migration.

**Audit-tracking gap:** `make_model` is NOT in the `_write_audit` tracked-fields list in `integrations/controllers/boq_nodes.py` (lines 192-201). The tracked list has 14 fields; `make_model` is absent. Consequence: edits to `make_model` via Frappe Desk will NOT generate a `Nirmaan Versions` audit entry. Fix: add `"make_model"` to the tracked-fields list. This is a separate, self-contained 1-line fix — can land in Phase 1.8 or as a standalone patch.

### 2026-05-16 — §7.32 Per-area rate + amount schema extension (decided 2026-05-16, Phase 1.8 implements)

**Decision:** Extend `BOQ Node Qty By Area` from 2 fields to 9 fields with per-area rate (supply/install/combined), per-area amount (supply/install/total), and `amount_override`. Universal-rate fallback semantics. Phase 1.8 implements schema + controller + migration; Phase 1.9 implements parser support. Both sequence BEFORE Phase 2c.

**Why now:**
1. Retrofit tax grows monotonically once Phase 2c starts writing real BoQ data to the DB. Currently no real parsed data is committed (only test fixtures) — this is the cheapest possible moment.
2. A significant minority of real BoQs capture per-area rate in the source file (Raheja Pattern 2-rate shape). Wizard overrides can absorb one-off edge cases; recurring structural shapes belong in the schema.
3. The 3-col-per-area Raheja shape (handover §17.5, §9 #39) gets absorbed into the baseline schema instead of leaving as a permanent retrofit candidate.

**Locked field naming.** Follows actual `BOQ Nodes` JSON convention: prefix-first for rates (`supply_rate`, `install_rate`, `combined_rate`), prefix-last for amounts (`supply_amount`, `install_amount`, `total_amount`). NO `combined_amount` field — `total_amount` serves both the combined-amount and total-amount roles per existing §7.14 rule.

**Fallback semantic.** When source file doesn't provide per-area rate, populate from parent universal rate. Compute amount as `area_qty × area_rate`. Every child row always has populated rate and amount after `before_save`.

**Weighted-average precedence.** When user (or parser) sets per-area rates that diverge across areas, parent universal rate auto-recomputes as `Σ(area_qty × area_rate) ÷ Σ(area_qty)` in `before_save`. Computed independently per rate kind. UI in Phase 5 will show parent universal as read-only with tooltip when per-area rates set.

**`is_rate_only` semantics.** Existing controller logic at boq_nodes.py:147-150 checks only main-row rates. NOT extended — the weighted-average rule keeps parent universal in sync, so existing `is_rate_only` logic remains correct without modification.

**Combined-rate consistency.** Same `combined == supply + install` rule applied per child row. Same error-message style. Zero-cost rows (all three None) allowed.

**`amount_override` parallel.** Same Check field on child table. When set, child's `before_save` skips amount auto-compute. Enables Phase 6 round-trip integrity (rounding-faithful preservation of source-file per-area amounts).

**§9 #50 standing decision REVISED.** v5.8's "auto-detection at natural floor" standing decision specifically deferred the 3-col-per-area Raheja detection work to "future caveat if blocking." Phase 1.9 re-opens it. Not because keyword precision was wrong — that decision still stands for the 191-entry keyword list — but because the 3-col Pattern 2-rate work is now bundled into the schema-extension scope where it has natural leverage.

**Estimated scope.** Phase 1.8: ~8-12 new Frappe tests, all 77 existing Frappe tests still pass. Phase 1.9: ~15-20 new parser tests, all 237 existing parser tests still pass.

### 2026-05-16 — §7.31 BoqReader.list_sheet_states() — sheet visibility pass-through

**Context:** Phase 2c §9 #49. The Phase 3 wizard needs to know which sheets in an uploaded workbook are hidden or veryHidden so it can default those sheets to the "skip" disposition (with user override). The reader already exposes sheet names via `list_sheets()` but not visibility state. openpyxl's `Worksheet.sheet_state` attribute returns a plain string (`'visible'`, `'hidden'`, or `'veryHidden'`) for each worksheet.

**Decision (§7.31):** Add `list_sheet_states() -> dict[str, str]` to `BoqReader`. Implementation: `return {ws.title: ws.sheet_state for ws in self._wb_values.worksheets}`. Access via `self._wb_values.worksheets` (the values workbook, matching the access pattern of all other reader methods). Sheet names preserve exact whitespace and casing, matching `list_sheets()`. Return type is `dict[str, str]` — plain Python dict keyed by sheet name; caller indexes it to retrieve a specific sheet's state.

**Ordering rationale:** Phase 3 wizard consumes this during sheet-selection step (before per-sheet MappingConfig authoring). No internal ordering dependency on other Phase 2c items. Additive only — no cascade to any existing method or post-pass.

**Explicitly NOT done:** `list_sheets()` not changed (returns names only; caller can combine with `list_sheet_states()` if needed). No single-sheet `get_sheet_state(name)` getter (caller indexes the dict). No caching (openpyxl `Worksheet` objects are already in-memory; a dict comprehension is negligible overhead). No enum wrapper (downstream code can compare directly against string literals `'visible'`, `'hidden'`, `'veryHidden'`). No normalisation (preserves openpyxl's exact strings so downstream code has a stable contract).

**Notable:** Per §9 #51, DHL FK-5-1-12 is a genuine multi-area sheet that is hidden in the workbook. The wizard's hidden-default-skip behaviour will handle it — the user can override to "process" for that sheet.

**Consequences:** `reader.py` +16 lines (method + docstring). `test_reader.py` +92 lines (4 new tests in `TestSheetStateExposure`). 0 existing tests modified. Test count: 217 → 221. openpyxl 3.1.5 confirmed in container.

### 2026-05-16 — §7.30 Priced-PREAMBLE-with-children review-flag post-pass

**Context:** Phase 2c §9 #45. After §7.29 (zero-children demotion), one PREAMBLE in Snitch Electrical (resolved_idx=500, sl_no='2.0', path='394/500', unit='LS', 5 children, `children_shape="siblings"`) remains that carries a price signal AND has tree descendants. Auto-demotion would orphan the 5 children whose `parent_index` still points to the PREAMBLE row — re-parenting is a non-trivial structural operation. The §9 #45 audit (commit `1ad12a7b`) surfaced this as the sole candidate across the in-scope fixtures.

**Decision (§7.30):** Add `_apply_priced_preamble_with_children_review_flag_post_pass(resolved_rows)` to `hierarchy.py`. The pass: (A) builds `paths_with_descendants` (same algorithm as §7.29); (B) for each PREAMBLE row where `row.path IN paths_with_descendants` AND `_is_priced_for_review(unit, rate_combined, rate_supply, rate_install)` is True: set `row.needs_classification_review = True` and `row.review_reason = "priced_preamble_with_children"`. `_is_priced_for_review` mirrors the audit script's `is_priced` logic: alphanumeric unit string OR any rate > 0; whitespace/punctuation-only unit does NOT count. Two new fields added to `ResolvedRow`: `needs_classification_review: bool = False` (default non-truthy), `review_reason: str = ""` (default empty). `review_reason` literal `"priced_preamble_with_children"` is the Phase 3 wizard's discriminator for selecting the re-classification UI flow; future review reasons can extend by adding new literals.

**Ordering rationale:** Must run AFTER §7.29 (zero-children demotion) so that leaf PREAMBLEs already demoted to LINE_ITEM cannot receive the review flag. Must run BEFORE `_apply_multi_area_post_pass()` to keep the post-pass cluster contiguous and predictable. In `orchestrator.py`, this is Step 4a.5 between Step 4a (§7.29) and Step 4b (multi-area).

**Why not demote here:** Auto-demotion without re-parenting orphans the children (`parent_index` still points to the demoted row, which is now LINE_ITEM). Re-parenting all descendants requires updating `parent_index` and `path` on every descendant — a second-pass structural operation beyond the parser's current scope. Parser flags only; Phase 3 wizard performs demotion + re-parenting on user confirmation.

**Consequences:** Snitch row 500 gains `needs_classification_review=True`, `review_reason="priced_preamble_with_children"`. Classification counts are unchanged (PREAMBLE count stays at 43 on 6. Electrical). `test_snitch_workbook_no_validation_warnings` continues to pass — `validation_warnings` is a separate field. Snitch canonical case confirmed via `test_snitch_row_500_flagged_for_priced_preamble_with_children_review` (test 218, TestSnitchIntegration). Test count: 207 → 217.

### 2026-05-14 — §7.29 Zero-children PREAMBLE demotion post-pass

**Context:** Phase 2b.2 Part B2f. After unit-based demotion (§7.28) and hierarchy resolution, some PREAMBLE rows remain that are structurally leaf nodes (zero tree children) yet carry a unit string or a non-zero rate. Real section-header preambles never have a unit or rate — those fields belong only to line items. A leaf PREAMBLE with a unit or rate was either: (a) not caught by §7.28 because its unit is unique on the sheet (no matching LINE_ITEM unit), or (b) classified PREAMBLE by the blank-qty-no-rate classifier rule. In both cases, the presence of a unit or rate on a leaf node is the deciding signal that it is a rate-only line item, not a section header.

**Decision (§7.29):** Add `_apply_zero_children_preamble_demotion_post_pass(resolved_rows)` to `hierarchy.py`, called in `orchestrator.py` after `resolve_hierarchy()` (Step 4a) and before `_apply_multi_area_post_pass()` (Step 4b). The pass: (A) builds `paths_with_descendants` — for every row path, all ancestor prefix segments are added to the set; (B) for each PREAMBLE row where `row.path NOT IN paths_with_descendants` AND (`unit` is non-empty OR any `rate_*` > 0): demote to `classification=LINE_ITEM, qty=0.0, is_rate_only=True, level=None`. Re-parenting of LINE_ITEM children of the demoted row is explicitly OUT OF SCOPE (§17.10).

**Ordering rationale:** Must run after `resolve_hierarchy()` because it needs tree path data (`paths_with_descendants`). Must run before `_apply_multi_area_post_pass()` to ensure the per-area post-pass sees the final classification of every row.

**Alternatives considered:** (a) Extend §7.28 (unit-based demotion) to also catch unique-unit PREAMBLEs — requires inspecting the tree, which belongs in hierarchy.py not classifier.py. (b) Re-parent children of demoted rows — deferred as §17.10 (complex, no current fixture needs it).

**Consequences:** Snitch Electrical row 341 (unit='KG', leaf) demoted: LINE_ITEM 175→176, PREAMBLE 44→43. Snitch Light Fixtures PIR row (unit='NOS', leaf) also demoted: LINE_ITEM 13→14, PREAMBLE 1→0.

### 2026-05-14 — §7.28 Unit-based PREAMBLE demotion post-pass

**Context:** Phase 2b.2 Part B2d. Real BoQs use lowercase-letter sl_no sequences (`a.`, `b.`, … `z.`, `aa.`, …) for nested line items in detailed sections (e.g. cable-type breakdowns in electrical BoQs). The hierarchy resolver's stack-walk heuristic increments stack depth by 1 per lowercase-letter transition, causing deeply-nested rows to accumulate a high stack depth. These rows get classified PREAMBLE by the base classifier (sl_no + description, no qty in the cell). But real preambles never carry a unit value — only measurable line items do. When a blank-qty row has a unit value matching a LINE_ITEM unit on the same sheet, the row is a rate-only line item whose qty cell was left blank, not a section header.

**Decision (§7.28):** Add `_apply_unit_based_demotion_post_pass(classified_rows)` as a post-classification pass in `classifier.py`, called in `orchestrator.py` after the per-row `classify_row()` loop and BEFORE `populate_preamble_candidate_scores()`. The pass: (1) collects unit strings from all LINE_ITEM rows on the sheet; (2) demotes any PREAMBLE row where `qty is None` AND `unit is not None` AND `unit` is in the collected set → `classification = LINE_ITEM, qty = 0.0, is_rate_only = True`. Match is case-sensitive.

**Ordering rationale:** Must precede preamble candidate scoring so that demoted rows do not receive preamble-candidate scores. Must follow per-row `classify_row()` since the demotion depends on the full sheet's LINE_ITEM population.

**Alternatives considered:** (a) Fix `_determine_preamble_level` in `hierarchy.py` to cap depth for lowercase cascades — deferred as §17.9 because it is a structural resolver change with wider blast radius. (b) Case-insensitive unit match — rejected to avoid false positives (`'NOS'` ≠ `'Nos.'`; the PIR PREAMBLE anomaly in Snitch Light Fixtures has `unit='NOS'` and correctly stays PREAMBLE because no LINE_ITEM has uppercase `'NOS'`).

**Consequences:** Snitch Electrical LINE_ITEM count: 93 → 175 (+82), PREAMBLE: 126 → 44 (-82). TestSnitchIntegration tests fail until B2e-snitch-refresh regenerates the expected JSON.

### 2026-05-14 — §7.25 Policy X: explicit zeros preserved in per-area raw dicts

**Context:** Phase 2b.2 Part B2a. Policy X reverses B1's deliberate zero-filter policy. B1 dropped explicit zeros via `!= 0` filters in `qty_by_area_raw` and `amount_by_area_raw` extraction to keep per-area dicts compact — at the time, that policy seemed sufficient. B2a reverses it after analysis showed three real-world scenarios (not-applicable / included-in-rate / lump-sum disconnected from qty) require distinguishing 'explicitly zero in this area' from 'this area's cell is missing/blank.' Policy X: both `qty_by_area_raw` and `amount_by_area_raw` preserve all explicitly-read values including zeros; only None/blank cells produce no key.

**Decision (§7.25 — Policy X):** A cell read as 0.0 **does** populate the dict with `0.0`. A blank/missing cell produces no dict entry. This preserves the distinction between "explicitly zero in this area" and "not applicable to this area". Applied to both `qty_by_area_raw` and `amount_by_area_raw` extraction in `classify_row()`.

**Alternatives considered:** Drop zeros (pre-B2a behavior) — loses the explicitly-zero signal; downstream consumers cannot distinguish "did not exist" from "existed but was zero".

**Consequences:** `qty_by_area_raw` and `amount_by_area_raw` now use `if area_qty is not None` / `if amt_val is not None` guards instead of `!= 0` guards. Post-pass copies with `dict(...)` (straight copy), so zeros flow through to `qty_by_area` / `amount_by_area` on `ResolvedRow`.

### 2026-05-14 — §7.24 amendment: empty-total fallback in _apply_multi_area_post_pass

**Context:** When a BoQ row has per-area qty populated but the qty_total column cell is blank, the post-pass needs a policy for `ResolvedRow.qty_total`. A warning would be noise for a valid multi-area row where the total column is simply absent.

**Decision (amendment to §7.24):** When `qty_total` is `None` and `qty_by_area` is non-empty, compute `qty_total = sum(qty_by_area.values())`. Same for `amount_total`. No warning is emitted for the fallback case. Sum validation (±1 tolerance warning) only fires when the column-declared total is non-None.

**Consequences:** `_apply_multi_area_post_pass()` in `orchestrator.py` implements the two-step: (1) fallback then (2) validate. The fallback is silent; the validation warning is appended to `ResolvedRow.validation_warnings`.

### 2026-05-14 — `qty_total_raw` added to ClassifiedRow to separate column value from computed qty

**Context:** `classified_row.qty` is overridden by the qty_total column value when present. After classification, it is impossible to tell whether `qty` came from the total column or from summing per-area values — both produce a float. The post-pass needs to distinguish "total column was blank (trigger fallback)" from "total column had value X".

**Decision:** Add `qty_total_raw: float | None = None` to `ClassifiedRow`. Set only when the `qty_total` column cell has a non-None, parseable value. `ResolvedRow.qty_total` is initialized from `qty_total_raw` (not from `qty`). The post-pass then uses `ResolvedRow.qty_total is None` correctly as the fallback trigger.

**Alternatives considered:** Check if `qty == sum(per_area_values)` at post-pass time — unreliable because rounding can make a column-declared total equal the per-area sum, producing false-positive fallback triggers.

**Consequences:** `ClassifiedRow` has a new field; `ResolvedRow.qty_total` is initialized in the LINE_ITEM constructor in `resolve_hierarchy()` from `classified_row.qty_total_raw`. All existing tests continue to pass.

### 2026-05-14 — Per-area raw data uses parallel-field pattern, not nested dict

**Context:** `ClassifiedRow` now has both `qty_by_area_raw` (existing) and `amount_by_area_raw` (added in B1). A third field `rate_by_area_raw` is anticipated for B2 or Part D2 to support the Raheja Pattern 2 rate-column variant (§17.5).

**Decision:** Each per-area raw type gets its own parallel `dict[str, float]` field on `ClassifiedRow`. No refactoring to a single combined nested dict (e.g., `area_raw: dict[str, dict[str, float]]`).

**Alternatives considered:** Combined nested dict — would require all existing readers of `qty_by_area_raw` to change their access pattern, increasing blast radius for a gain that isn't needed yet.

**Consequences:** If a fourth per-area field is ever needed, consider refactoring to a single combined nested dict keyed by area name. Today's reason for parallel fields: minimal blast radius — no existing readers of `qty_by_area_raw` need to change. Part D2 will add `rate_by_area_raw` as a third parallel field.

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

### 2026-05-16 — Phase 1.9b — append_to_notes parser support landed

**Feat commit: `78b3d233`**

- `append_to_notes` added to ColumnRole Literal in `config.py`. NOT in `_SINGLETON_ROLES` (multiple columns per sheet allowed). NOT in `_AREA_COMPATIBLE_ROLES` (area= always rejected). No dedicated model validator needed — existing area_only_for_qty_amount_roles validator rejects area on this role automatically.
- `column_headers: dict[str, str] = {}` field added to `SheetConfig`. This is the **Case B → Option B** resolution: storing the column-letter → human-label mapping on SheetConfig (not on MappingConfig or a separate dict). Decision made by chat-Claude on 2026-05-16 as the minimum-change option consistent with the existing SheetConfig-scentric design — one place to look for all per-sheet structural config. Keys are column letters (same as `column_role_map`); values are the display labels used in `append_notes_raw` dict keys.
- `append_notes_raw: dict[str, str]` field added to `ClassifiedRow` in `classifier.py`. Keys are source column header strings resolved via `SheetConfig.column_headers.get(col_letter, col_letter)` — column letter is the fallback when no override is provided. Values are cell text coerced via `str(cell.value).strip()`. Empty/blank cells (None value or empty-string-after-strip) produce no dict entry (Policy-X-style empty-cell-skip, mirrors `rate_by_area_raw` extraction). Non-string cell values (floats, ints) are coerced via `str()` for maximum fidelity — e.g. HSN Code stored as float 1234.0 becomes `"1234.0"`.
- `append_notes_raw` passed through in `ClassifiedRow` return statement at end of `classify_row()`.
- 8 new tests (249→257): `test_config.py` +3 (tests 25-27: `append_to_notes` role accepted, two append_to_notes columns allowed on same sheet, `column_headers` round-trips); `test_classifier.py` +5 (`TestAppendNotesRaw` class: single column populated, multiple columns populated, empty cell produces no key, non-string coerced to str, no role mapped → empty dict).
- Phase 1.9c (real-fixture integration tests for Raheja + D-Tech using `synthetic_pattern_2_rate.xlsx` and append_to_notes columns) is next.
