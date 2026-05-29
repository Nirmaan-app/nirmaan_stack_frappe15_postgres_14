# BoQ Upload & Management — Implementation Plan

**Status:** Phase 2a + Phase 2b.1a + Phase 2b.1b complete and tested (incl. preamble candidate scoring). Phase 2b.2 Part A1 (reader merged-cell propagation) complete. Part A2 (ColumnRole multi-area extensions + validation) complete. Session 1 (Pattern-4 integration test) complete. Part A3a (multi-area detection module + smoke tests) complete. Part A3b (comprehensive detection tests) complete. Part A3c (covered-cell skip fix + regression tests) complete. Session 4 verification complete (Pattern 3: PASS; Pattern 2: deferred — see §17.5). Part B1 (classifier `amount_by_area_raw` + orchestrator + return models) complete. **Part B2a (Policy X §7.25, per-area totals on ResolvedRow, `_apply_multi_area_post_pass`, synthetic_multi_area fixture, +17 tests) complete.** **Part B2b-keywords (reserved keyword expansion — false-positive fix) complete.** **Part B2c (Snitch real fixture + integration test, §7.25 wording correction) complete.** **Part B2d (unit-based PREAMBLE demotion post-pass, §7.28, +9 tests) complete.** **Part B2e-snitch-refresh (Snitch expected JSON regenerated, max preamble level 21→7, all 182 tests green) complete.** **Part B2f (zero-children PREAMBLE demotion post-pass, §7.29, +8 tests) complete. All 190 tests green.** Phase 2c next. **Phase 2c kickoff fixture commits (24 real BoQ files added to tests/fixtures/, §9 #40 CLOSED) complete.** **Phase 2c keyword expansion (§9 #44 CLOSED — 49→120 reserved keywords + _is_reserved whitespace normalization + parenthetical strip) complete. 205 tests passing.** **Phase 2c keyword targeted additions (§17.10 CLOSED — 120→191 entries) complete.** **Phase 2c caveats #2 + #4 cleanup (§9 #42 + §9 #43 reframed, §17.11 CLOSED) complete. 207 tests passing.** **Phase 2c §9 #45 priced-PREAMBLE-with-children review flag (feat 7ff4ce55, §17.11.C CLOSED) complete. 217 tests passing.** **Phase 2c §9 #49 reader sheet_state exposure (feat 3e9eafe0, §17.11.D CLOSED) complete. 221 tests passing.** **Phase 2c §9 #48 classifier-dictionary audit half (chore f89e2478, §17.11.E CLOSED) complete. 2999 unique unclassified header strings surfaced. 221 tests passing.** **Phase 2c §9 #48 classifier-dictionary + multi-area keyword expansion (feat a0d2b4a5, §17.11.F CLOSED) complete. 237 tests passing. DB commit + version cascade next.** **Phase 1.8 + 1.9 planned (per-area rate+amount schema extension) — sequenced BEFORE Phase 2c kickoff.** **make_model field confirmed already present on BOQ Nodes (position 25) — Phase 1.8 scope reduced; audit-tracking gap flagged (make_model absent from _write_audit tracked fields).** **append_to_notes ColumnRole designed (§7.34) for user-curated preservation of long-tail column data into notes field — parser-side wiring lands in 1.9 expanded scope; commit-time merge in 2c; wizard UX in Phase 3.** **Phase 1.8 (per-area rate + amount schema extension) ✅ COMPLETE. 88 Phase 1.x Frappe tests passing (60 boq_nodes + 28 boqs). Phase 1.9 next.** **Phase 1.9a (per-area rate parser support — Pattern 2-rate detection) ✅ COMPLETE. 249 parser tests passing. Phase 1.9b (append_to_notes parser) next.** **Phase 1.9b (append_to_notes parser support) ✅ COMPLETE. 257 parser tests passing. Phase 1.9c ✅ COMPLETE. 267 parser tests passing (expectedFailure=2: F3b RATES-plural + F5 HVAC header gap). Phase 2c next (unblocked). Phase 1.8.1 (F1 + F2 cleanup) ✅ COMPLETE. 91 Phase 1.x Frappe tests passing (63 boq_nodes + 28 boqs). Audit now fires on Desk saves without explicit edit_reason (defaults to "Desk edit"). Phase 2c next (unblocked). **Phase 1.9d design-locked (F3b regex widening + F5-b `top_header_rows_override: list[int]` field on `SheetConfig` + F7 standing-pattern doc-only). Pattern 6 future shape locked as forward-compat extension of same field. §17.13 NEW — wizard-load review pending parking entry. Implementation prompts to follow. **Phase 1.9d (F3b + F5-b implementation) ✅ COMPLETE. 274 parser tests passing (was 267 + 7 new F5-b validation + RATES-plural unit tests; 0 expected failures, was 2). Raheja Electrical now detects Pattern 2-rate directly; Raheja HVAC now detects PHASE-1 / PHASE-2 via top_header_rows_override=[2]. F7 standing pattern doc-only (no code change). Pattern 6 forward-compat captured in field shape. Phase 1.9e (real-fixture stress test) next.****** Phase 1.9e ✅ COMPLETE (68 sheets parsed across 25 workbooks; 62 rate-synonym variations surfaced; output at real_fixture_stress_test_output.json). Phase 1.9f Stage 1 ✅ COMPLETE — multi-area triage diagnostic (chore c42eec9a + docs 458bed3d). Observability only; +0 parser tests. Phase 1.9g ✅ COMPLETE — pre-header rows skip fix (feat 40fb555c + docs 9b9bb664). Closes §17 #71. +3 parser tests. Phase 1.9h ✅ COMPLETE — auto-guess per-area column-role assignment (feat f9a3121e + docs 7e842385). Closes §17 #72. +14 parser tests (277 → 291). Phase 1.9i ✅ COMPLETE — single-area-targeted diagnostic (chore 7d588976 + docs c3b2ed1d). Observability only. Phase 1.9j ✅ COMPLETE — Mode C metric fix (chore 68befb2e + docs b2fbbb7e). Diagnostic metric repair. Phase 1.9k ✅ COMPLETE — Mode B + F + F3c broadened (feat 3cc3819c + docs 7ecee053). Parser keyword + punctuation work. Phase 1.9l ✅ COMPLETE — Mode D longest-match precedence (feat f00cc6ca + docs 900078d5). Supply/install keyword family. Phase 1.9m ✅ COMPLETE — Mode A auto-detect 2-row headers (feat c08ebd13 + docs cb3f8694). Phase 1.9n ✅ COMPLETE — re-run diagnostic + metric correction (chore 3af8e828 + docs 287ca670). Closes Phase 1.9j-1.9n locked cycle. Cumulative +46 parser tests across cycle (291 → 337). Pre-1.9o ✅ COMPLETE — 4 synthetic multi-area fixtures added (chore a97ff170 + docs e55d1691). Phase 1.9o ✅ COMPLETE — Tier A-merged pattern recognizer (feat 6f6214ba + docs 62e676e0). +20 parser tests (337 → 357). Phase 1.9p ✅ COMPLETE — append_to_notes keyword auto-assignment, 12 reference-code entries (feat 5d348e4a + docs 7fdbf764). +18 parser tests (357 → 375). First carve-out from "never auto-detect" rule of §7.34. Diagnostic Chore #1 ✅ COMPLETE — source_present_but_unparsed 4th metric bucket (chore 78ea7d49). Mitigates §17 #75. Diagnostic Chore #2 ✅ COMPLETE — two-mode output Mode 1 hrc=None + Mode 2 hrc=1 (chore 63bead94). Mitigates §17 #74. Diagnostic metric repair docs ✅ COMPLETE — combined Chore #1 + #2 documentation (docs 9fedf079). Expanded-subset retest ✅ COMPLETE — TARGETS 11 → 15, diagnostic_snapshots/ folder introduced (chore 9d4abf36 + docs 483b53bd + chore c8c9f234 + docs bf043492). Two-commit correction round-trip per agreement #32 codification. Bug 6 fix ✅ COMPLETE — convenience field summation (feat 47090d7d). Closes §17 #84. Bug 7 + Bug 9 + CRLF remediation ✅ COMPLETE — keyword word-order variants + CRLF normalization (feat 9a5b16cb + docs fe18b337). Closes §17 #85 + §17 #79 (reframed as Bug 9). v5.21 execution-layer experiment ✅ COMPLETE (in-chat, NOT committed per agreement #30) — Sequence C2 + E2 across 8 fixtures, 100% schema acceptance, Option 3 STRUCTURALLY VALIDATED. Surfaced Bugs 10-14 + Findings 15-16 + 4 operational learnings. **Bug 10 fix ✅ COMPLETE — same-row =SUM() SUBTOTAL_MARKER misfire closed (feat 798f4fd2 + docs 81efb8c5). Closes §17 #86. _is_cross_row_sum() helper in classifier.py gates FORMULA-path; text-regex path untouched. 131 expected misfires closed (VRF 57 + Societe Generale 74). Parser tests 409 → 429. Bug 10 coverage extension ✅ COMPLETE — TestBug10SocieteGeneraleHvacIntegration added (feat 94706b5c). Parser tests 429 → 434. Closes 73-row Societe Generale Bug 10 coverage gap. Bug 11 PARKED v5.22 (see §17.27) — misframed as classifier; root cause is hierarchy resolver parenting (11a: numeric-peer sibling gap, 11b: letter-sequence cascade §17.9). feat reverted f1839b1e, docs reverted debd5186. §7.28 orphan-children audit ✅ COMPLETE (feat 8a126846 + docs 5a440fc9): 47/82 target rows have ≥1 real-orphan descendant; 196 total; max 9 on single row. Informs parented-PREAMBLE blanket rule. Bug 13 Excel error literals normalization ✅ COMPLETE (feat 5ff93064): EXCEL_ERROR_LITERALS frozenset + _is_excel_error() helper in reader.py; all seven error strings (#REF!, #VALUE!, #NAME?, #DIV/0!, #NULL!, #N/A, #NUM!) normalized to None at iter_rows() cell-read time; 6 new tests in TestExcelErrorLiterals (4 unit + 2 integration); parser tests 434 -> 440. Closes §17.29 / sec 9 #89. Bill Of Quantities Electrical & ELV rows 4-22 audit ✅ COMPLETE (feat 3b0790f0): 0/19 rows differ between current and Approach A; 1 Bug 12 candidate (row 4 "SUB HEAD A"); Rule A1+A2 each fire 0 times in range; LINE_ITEM parenting (Bug 11a) unreachable by Approach A. Phase 2c next (unblocked). **Approach A-reframed audit ✅ COMPLETE (feat 16647958): Snitch A1=3/A2=27/indirect=0 total=30 of 521 rows; BoQ-ELV A1=0/A2=31/indirect=0 total=31 of 1186 rows. User sample review next (sec 9 #99 gating, exit criterion E3). Approach A-reframed land ✅ COMPLETE (feat 8f960a2b + docs see git log): Rule A1 (lowercase cascade fix, F5-tightened all-lowercase trigger) + Rule A2-reframed (sibling numeric peer fix) landed in hierarchy.py; approach_a_enabled: bool = True toggle; pattern_signature() + first_numeric_token() helpers; snitch_electrical_expected.json regenerated (LINE_ITEM 176->177, PREAMBLE 43->42, preamble_level_transitions 7->4 entries); test_approach_a_rules.py +24 tests; parser tests 440->464. Sec 9 #99 CLOSED. Working agreement #40 deferred pending Bug 12 diagnostic on 2 fixtures. Phase 2c next (unblocked). **SUB HEAD detection + universal subtotal-reset landing COMPLETE (feat 25a43617); sec 9 #100 + #101 CLOSED; working agreement #40 codified; Bug 12 + Bug 15 parked to Phase 3+ AI layer; PHASE 2c BUG-FIX CYCLE CLOSED; Phase 2c body next.** Bug 23 + Bug 24 LANDED cycle 4 session 1 (feat 3d5d7122; BUG_23_LINE_ITEM_LEVEL0_ANCESTOR_ENABLED + BUG_24_NOTE_PARENT_INDEX_ENABLED; LINE_ITEM after empty-stack level=0 inherits level0_ancestor; NOTE parent_index mirrors attached_to_index or level0_ancestor; +18 tests test_bug_23_24_parent_fix.py; 570 -> 588 parser tests; 0 calibrations; Findings #1+#2 CLOSED). Phase 3 kicked off on `feature/boq-phase-3` (branched from `feature/boq-phase-2` tip 2e338b36). Module 1a COMPLETE (feat 06f38e8d; BOQs.wizard_state Select + BOQs.sheet_drafts Table + BoQ Sheet Draft child doctype; upload_file endpoint async via frappe.enqueue + update_boq_draft endpoint; 17 new wizard tests; Frappe tests 679->696; parser tests stable at 588; create_tendering_project dropped from scope -- wizard never creates Projects rows, picker defers to existing Nirmaan new-project workflow). Module 1b (frontend) kicked off. Module 1b-i COMPLETE (feat 3b69d00d; sidebar 'Upload BoQ' nav item; in-project 'BoQ' tab (PROJECT_PAGE_TABS.BOQ = 'boq') with empty-state + CTA; BoqPickerPage at /upload-boq + /upload-boq?project=<id>; BoqProjectTab lazy component; routesConfig route added; TypeScript clean on changed files; Vite build clean. 1b-i corrected (fix 74741417) -- Procurement Executive access to BoQ re-enabled in sidebar gating + procurementExecutiveAllowedTabs + PE render array (was inadvertently excluded in 3b69d00d). Module 1b-modal COMPLETE (feat b13c7b9c; TenderingProjectForm additive embedded mode -- new optional props embedded + onCreated; onCancel extended to embedded CREATE mode; page chrome suppressed when embedded=true; standalone route /projects/new-project/tendering byte-for-byte unchanged; BoqPickerPage 'Create new Tendering project' button now active, opens shadcn Dialog containing TenderingProjectForm in embedded mode; handleCreated closes dialog + sets picker selection + navigates to /upload-boq?project=<newId>; new project id from response.message.project_name; shadcn Dialog only, no Ant Design, Tailwind tokens throughout; TypeScript clean; Vite build clean; owner-approved additive change M1.56). 1b-modal dropdown-in-dialog fix COMPLETE (fix 0c066902; Radix DismissableLayer intercepted pointerdown on react-select menus portalled to document.body -- options unselectable in embedded mode; fix: State/City/Customer all set menuPortalTarget={embedded ? undefined : document.body} -- menus render inline inside Dialog subtree when embedded; standalone document.body portal unchanged; TypeScript clean; manual re-test required). Module 1b-ii-a COMPLETE (feat d1f3b5cd; useBoqWizardStore transient Zustand store in src/zustand/ -- selectedProjectId + droppedFile + uploadStatus(idle) + panelValues + confirmedFields; BoqDropZone custom file-input drop zone -- no react-dropzone (M1.65); validation Error D wrong-ext + Error H over-25MB client-side only; Errors E/F deferred to 1b-ii-b; BoqMasterPanel 6 fields per M1.17 -- Project+Customer read-only; BoQ Name+Version+GST required pre-fill-unconfirmed per S4.1/M1.34 with sparkle+opacity-50; GST onClick-confirms per M1.30; Notes optional no unconfirmed treatment per M1.32; BoqUploadScreen two-pane layout (M1.4 M1.7) + footer Back-to-project + Continue disabled/stubbed; BoqPickerPage early-return to BoqUploadScreen when ?project= present -- no routing change; pre-fills boqName from project_name unconfirmed; no backend/upload/parse call; TypeScript clean). Module 1b-ii-b COMPLETE (feat 273e7fab; live upload trigger -- FormData POST to upload_file with project_id+file, CSRF header via window.frappe.csrf_token; uploadStatus lifecycle idle|uploading|parsing|done|error-E|error-F|error-internal + jobId + boqDocName fields + fillFromParse + resetUpload added to store; GstChoice extended to include ""; boq:wizard_parse_done socket listener screen-scoped via FrappeContext -- subscribe on mount / off on unmount -- guard uploadStatus==="parsing" against concurrent-user events from publish_realtime broadcast; blank-until-parsed §4.1 clarification -- DEFAULT_PANEL all-empty, sparkle+opacity-50 only when value !== "" AND unconfirmed -- 1b-ii-a boqName pre-fill useEffect removed; fillFromParse sets BOQs.boq_name+V{version}+tax_treatment AND resets confirmedFields to false; useFrappeGetDoc("BOQs", boqDocName) fetches doc after success; Continue gate 3-part AND droppedFile+done+all-3-confirmed, tooltip lists missing items; Module 2 handoff stubbed inline CheckCircle2 no routing change; TypeScript clean; Vite build clean). Module 1b COMPLETE end-to-end. Module 2 next.
**Owner:** Internal team.
**Last updated:** 2026-05-30 (Module 1b-ii-b landed -- live upload + socket + Continue gate; feat 273e7fab; Module 1b COMPLETE)
**Active branch:** `feature/boq-phase-3` (branched from `feature/boq-phase-2` tip 2e338b36; `feature/boq-phase-2` frozen at 2e338b36 as parser-stable tip)
**Latest commit:** 273e7fab feat(boq): Module 1b-ii-b -- live upload, socket listener, Continue gate

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

### §3 refresh log

2026-05-21 (v5.21 docs cycle): Status block back-refreshed from Phase 1.9e (v5.15) anchor to fe18b337 (v5.21) anchor, adding 19 sub-phase records (1.9f → Bug 7+9 + v5.21 throwaway experiment). §17 Known Issues back-refreshed with entries #74-#96 (23 new entries). §14 Working Agreements appended with #30-#35 (6 new agreements). §17.13 marked RESOLVED. Strategic direction subsection added before §17. No source code touched this cycle.

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

### Phase 3 Module 1a — Wizard backend and schema ✅ COMPLETE

Branched as `feature/boq-phase-3` from `feature/boq-phase-2` tip 2e338b36 (2026-05-29). First commit of Phase 3 (wizard). Pre-v5.30 framing called this "Phase 2c body"; user decision at Phase 3 kickoff re-frames wizard work as a distinct phase branched fresh per "one branch per phase" working agreement.

Schema: `BOQs.wizard_state` Select (`In progress / Configured / Parsed`) + `BOQs.sheet_drafts` Table; new `BoQ Sheet Draft` child doctype with 4 fields (`sheet_name`, `sheet_order`, `wizard_status`, `work_package`). Migration verified: `has_column("BOQs", "wizard_state")` True; `BoQ Sheet Draft` DocType exists with 4 fields.

API: `api/boq/wizard/` package with two whitelisted endpoints:
- `upload_file` (async via `frappe.enqueue`): validates extension + size, saves to Frappe File storage, enqueues worker; worker opens BoqReader, creates BOQs row with `wizard_state="In progress"` and sheet_drafts child rows, auto-detects `work_package` via case-insensitive substring match on Work Headers, attaches via Nirmaan Attachments, publishes `boq:wizard_parse_done` over realtime.
- `update_boq_draft`: partial-update endpoint for `boq_name`, `version`, `tax_treatment`, `notes`.

`create_tendering_project` dropped from scope: wizard never creates Projects rows; picker's "Create new project" path (Module 1b) defers to existing Nirmaan new-project workflow.

`BOQs.before_insert` owns version computation (M1.25: `COALESCE(MAX(version), 0) + 1` scoped to project+boq_name); duplicate computation removed from worker.

17 new wizard tests. Frappe tests: 679 -> 696. Parser tests: 588 unchanged. Feat: 06f38e8d.

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

30. **Throwaway experiments before committing risky changes.** (NEW v5.20.) Routing changes, pattern-detector additions, or other changes likely to break existing tests should be prototyped on a throwaway branch first. Procedure: snapshot pre-fix diagnostic output → create throwaway/<topic> branch from current tip → apply speculative fix → run parser tests + diagnostic → capture results → tear down (git checkout main; git branch -D throwaway/<topic>; git restore <modified files>). The experiment surfaces empirical reality BEFORE committing to a formal sub-phase prompt. Codified after v5.20 throwaway Bug 1 routing experiment surfaced 13 test failures + 1 fixture regression + Bug 6 (convenience field summation gap) in ~30 minutes.

31. **Diagnostic snapshot before regenerating live output.** (NEW v5.20.) Before any significant diagnostic re-run, copy current live output to nirmaan_stack/services/boq_parser/diagnostic_snapshots/<context>.json and .txt. Snapshots are read-only reference for comparison. Codified because diagnostic scripts overwrite output on each run; without snapshots, before/after comparison requires git archaeology or re-running old state. Folder convention introduced in chore 9d4abf36.

32. **Filename verification from disk before prompting.** (NEW v5.20.) When chat-Claude drafts prompts referencing fixture filenames (especially in TARGETS lists, scope-list paths, audit-script invocations), verify filenames from disk (ls or equivalent) before pasting. Codified after expanded-retest filename mishap (commit 9d4abf36 used filenames without multi_area_ prefix based on v5.19 handover descriptive shorthand; correction round-trip via commits c8c9f234 + bf043492). One ls call saves a 2-commit round-trip.

33. **§3 refresh is part of housekeeping.** (NEW v5.20.) Every handover-doc regeneration cycle must check §3 (Phase plan and sub-phase records) for new sub-phases landed since prior version. New sub-phase entries added at appropriate position; stale "🔜 LATER" entries flipped to "✅ COMPLETE"; §3 refresh log subsection at bottom gets entry noting changes. Codified after Nitesh caught §3 staleness during v5.20 review (Phase 1.9d/1.9e marked LATER for 7 versions despite landing earlier; 13 sub-phases missing). **Scope extends to plan-doc Status block per this v5.21 docs-cycle codification.**

34. **Iterative parser refinement loop.** (NEW v5.21.) Parser refinement proceeds in measured iteration cycles. Each cycle: hand-craft SheetConfigs for 1-3 fixtures bypassing auto_guess_sheet_config() → invoke parser via direct parse_boq() → preserve outputs to disk + Desktop → chat-Claude conducts deep-dive review of outputs against ground-truth Excel inspection → catalogue new bugs / wizard gaps / operational learnings as numbered §9 entries → implement fixes (standard 2-commit shape per agreement #9) → re-run experiment on same fixtures + ~3 new diverse ones → compare bug-discovery rate against prior cycle. **Termination criterion:** two consecutive cycles yield zero new parser bugs from at least 3 new fixtures each. **AI integration is gated on this termination.** Stated user position: "the more refined a version we can make without AI the better."

35. **Handover doc creation workflow.** (NEW v5.21.) Handover doc regeneration uses file-upload-and-edit workflow, NOT verbal copy-paste merging. Process: user uploads previous version .md file to chat at start of doc cycle → chat-Claude reads file via /mnt/user-data/uploads/ → chat-Claude applies targeted edits using str_replace/view/create_file tools (header, audit checklist, §3 refresh, §6 decisions, §8 agreements, §9 entries, §10-§13 updates, §14 renumbering + new EOS, §24 doc history) → chat-Claude saves to /mnt/user-data/outputs/ as new versioned file → chat-Claude verifies completeness via grep + view spot-checks → chat-Claude presents file via present_files tool → user downloads, uploads to project knowledge, deletes prior version per agreement #17. Does NOT apply to plan-doc + CLAUDE.md (those are repo files, edited by Claude Code, committed via docs commit per agreement #9 — like this very cycle).

40. **Bug 13 deterministic-unambiguous bar for parser-layer fixes.** (NEW v5.25.) Parser-layer hierarchy/classification fixes must meet the deterministic-unambiguous bar established by sec 9 #89 (Bug 13). A fix qualifies if: (a) the trigger is a text-pattern match (regex) or an exact value check on classified fields; (b) the action has a single deterministic outcome; (c) no fuzzy thresholds, heuristics, or natural-language pattern recognition. Closing examples from Phase 2c bug-fix cycle: (1) sec 9 #89 Bug 13 — Excel error literal normalization in reader.py; (2) sec 9 #99 A1/A2-reframed — lowercase cascade + sibling numeric peer fix in hierarchy.py; (3) sec 9 #100 SUB HEAD detection — text-pattern rule on sl_no; (4) sec 9 #101 Universal subtotal-reset — classification-based stack reset. Beyond these four, hierarchy/classification fixes go to Phase 3+ AI review layer. Empirical basis: 6-fixture cross-corpus audit surfaced sec 9 #88 Bug 12 (Inovalon NOTE-as-header) and sec 9 #102 Bug 15 (SG HVAC priced-sub-section-header) as cases requiring natural-language pattern recognition. Adopted 2026-05-23.

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

## Strategic direction (v5.21 confirmed)

**Option 3b CONFIRMED** — declarative wizard + targeted classifier fixes. AI integration deferred until iterative refinement loop termination per agreement #34. Validated empirically: execution-layer experiment Sequence C2 + E2 produced 100% schema acceptance across 8 hand-configured fixtures. Direct user quote: "the more refined a version we can make without AI the better."

**Path A CONFIRMED** — fix parser bugs first, wizard implementation later. Tech-person can design wizard UI in parallel without writing code. Bug-fix queue (Bug 10 -> 11 -> 12 -> 13 -> 14) is bounded scope (~135 LOC total). Building wizard against unstable parser would compound rework.

See handover section 6 v5.21 decisions + section 14 v5.21 EOS for full context.

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

**Status:** [RESOLVED v5.21] — Option 3b confirmed via execution-layer experiment Sequence C2+E2; 8/8 schema acceptance validates declarative wizard architecture. See handover §6 v5.21 decisions + §14 v5.21 EOS.

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

### 17.14 #74 [DOCUMENTED v5.18] — Diagnostic-script forces header_row_count=1

Intentional but means Mode A unmeasured. Mitigated by Diagnostic Chore #2 two-mode output. Full detail: handover §9 #74.

### 17.15 #75 [DOCUMENTED v5.18] — Amount-family metric over-counts

Amount-family metric over-counts based on role assignment. Mitigated by Diagnostic Chore #1 source_present_but_unparsed bucket. Full detail: handover §9 #75.

### 17.16 #76 [MITIGATED v5.19] — PowerShell Select-Object -Last N pipe deadlock

PowerShell Select-Object -Last N pipe deadlock with docker exec (15+ min hang). Mitigation: Option B file-redirect form for ALL test commands. Full detail: handover §9 #76.

### 17.17 #77 [MITIGATED v5.19] — Unicode section sign mangled by Windows/Docker heredoc

Unicode section sign mangled by Windows/Docker heredoc. Mitigation: ASCII labels only in commit messages and docs. Full detail: handover §9 #77.

### 17.18 #78 [MITIGATED v5.19] — docker exec -w flag failure in some PowerShell quoting contexts

docker exec -w flag failure in some PowerShell quoting contexts. Mitigation: bash -c 'cd /path && cmd' form. Full detail: handover §9 #78.

### 17.19 #79 [DOCUMENTED v5.19, RESOLVED v5.21] — v2 fixture shape only partially handled by Phase 1.9o

v2 fixture shape (area-name top merges + 4-col bottom) only PARTIALLY handled by Phase 1.9o. Reframed as Bug 9 in v5.21 8-bug taxonomy; addressed via Bug 7+9 combined remediation feat 9a5b16cb. Full detail: handover §9 #79.

### 17.20 #80 [OPEN v5.20] — test_auto_guess.py entirely mock-based

test_auto_guess.py is entirely mock-based; no real .xlsx loads. Mitigated forward by agreement #29 (real-fixture integration tests required). Closure deferred to focused sub-phase post-strategy decision. Full detail: handover §9 #80.

### 17.21 #81 [OPEN v5.20, deferred] — Output filename drift from 1.9j checkpoint

Output filename drift from 1.9j checkpoint. Low priority. Full detail: handover §9 #81.

### 17.22 #82 [DOCUMENTED v5.20] — Pre-1.9o synthetic fixtures embed two opposite conventions

Pre-1.9o synthetic fixtures embed two opposite conventions B and C. Documented; no action required. Full detail: handover §9 #82.

### 17.23 #83 [OPEN v5.20, deferred to wizard] — Three coexisting header conventions in real BoQs

Three coexisting header conventions in real BoQs (A/B/C). Path A explicitly defers parser-side fixes; wizard sidesteps via declarative config. Full detail: handover §9 #83.

### 17.24 #84 [CLOSED v5.21 by feat 47090d7d] — Convenience field summation gap (Bug 6)

cr.qty/rate/amount didn't sum per-area/per-component when Total/Combined blank. Closed by Bug 6 fix. Full detail: handover §9 #84.

### 17.25 #85 [CLOSED v5.21 by feat 9a5b16cb] — Keyword vocabulary missing word-order variants (Bug 7)

"Rate Supply" didn't match rate_supply. Closed by Bug 7+9 combined remediation. Full detail: handover §9 #85.

### 17.26 #86 [CLOSED v5.22 by feat 798f4fd2] — Same-row =SUM() SUBTOTAL_MARKER misfire (Bug 10)

classifier.py treats same-row supply+install aggregation formulas as cross-row subtotals. 131 cross-fixture misfires (57 VRF + 74 Societe Generale). Fix: _is_cross_row_sum() helper ~15 LOC + tests. Full detail: handover §9 #86.

**Closure record:** _is_cross_row_sum(formula, current_row) helper added in classifier.py Private helpers section. Gate added to FORMULA-path SUBTOTAL_MARKER check: formula must start with =SUM( AND _is_cross_row_sum returns True. Text-regex SUBTOTAL_MARKER path (Total Item No., Grand Total, etc.) NOT touched. 131 expected SUBTOTAL_MARKER -> LINE_ITEM reclassifications (VRF 57 + Societe Generale 74). Audit-script stats flat (classifier_audit.py measures header-keyword matching, not classification categories -- flat is expected for Bug 10). Fix verified by integration tests: TestBug10VrfSameRowSumIntegration row 1.1 and 1.2 assertions pass. Parser tests 409 -> 429 (20 new: 13 unit + 3 classify_row gating + 4 VRF real-fixture). No out-of-scope files touched. Agreements cited: #9 two-commit, #16 known-pattern citation, #20 25-item self-report, #25 audit-regression, #29 real-fixture integration.

**Coverage extension (feat 94706b5c):** TestBug10SocieteGeneraleHvacIntegration added in test_orchestrator.py. 73-row Societe Generale Bug 10 misfire surface now covered (VRF 57 rows covered by feat 798f4fd2 already). Areas: GF / 2F (Office) / 2F(Cafeteria). Per-row assertions: sl_no=1.03, 1.04, 1.05 (rows 23, 25, 27 with L=SUM(Jx:Kx)). Aggregate threshold >= 230 (post-fix empirical: 282; pre-fix ~209). Parser tests 429 -> 434. Suite verdict OK.

### 17.27 #87 [CLOSED v5.25 via A1+A2 land] -- Pattern-consistency mismatch in PREAMBLE vs LINE_ITEM (Bug 11)

**MISFRAMED — PARKED.** Original framing: classifier ignores sl_no pattern_depth; 240+ rows affected in BoQ Elec alone; fix was orchestrator post-pass with asymmetric depth rule. Implemented in feat fb89bf44 / docs f9bd1e70, then reverted (feat f1839b1e, docs debd5186) after diagnostic revealed root cause is hierarchy RESOLVER (parenting), not classifier.

**Root cause (post-diagnostic 2026-05-22).** Two sub-manifestations:
- **11a — Numeric peer sibling gap:** 1.0 PREAMBLE + 2.0 LINE_ITEM should sibling; resolver parents 2.0 under 1.0.
- **11b — Letter-sequence cascade (§17.9):** a/b/c letter-suffix rows chained stack_depth+1 each instead of equi-depth siblings under numbered ancestor.

**Why parked.** Snitch diagnostic confirmed 124/124 depth-1 lowercase-letter ('l' sig) rows in '6. Electrical' are genuine enumerated sub-items (cable variants, socket types, conduit sizes under numbered PREAMBLEs). Depth-≤1 auto-promote nets −95 LINE_ITEMs — a regression. Fix belongs in hierarchy resolver layer; deferred to Phase 3+ AI review per agreement #33. Parser tests stable at 434. Full detail: handover §9 #87.

**Update 2026-05-23 (post-hoc recognition):** Bug 11a + Bug 11b were structurally resolved by Rule A1 + Rule A2-reframed landing (feat 8f960a2b, sec 9 #99, §17.40). The connection was not recognized in the A1+A2 land docs commit (ea60a03f) and was identified during v5.25 housekeeping preparation review.

**Bug 11a -> Rule A2-reframed.** A2 fires at LINE_ITEM attachment when LINE_ITEM sl_no has same pattern_signature as stack-top PREAMBLE AND a different first_numeric_token (both non-None). Attaches to stack-top's parent (sibling, not child). This is exactly the Bug 11a canonical case: "1.0 PREAMBLE + 2.0 LINE_ITEM with qty -- resolver parents 2.0 under 1.0; should be SIBLING of 1.0 (same pattern signature D.D, same depth)". Empirical evidence: A2 audit (sec 9 #99, feat 16647958) captured 27 A2 firings in Snitch + 31 A2 firings in BoQ ELV -- every firing is the Bug 11a case. All landed correctly post-A1+A2 (parser tests 440 -> 464 confirm).

**Bug 11b -> Rule A1.** A1 fires in _determine_preamble_level when sl_no (after rstrip) is all-lowercase, scans stack reversed for first non-lowercase ancestor, returns anchor.level + 1. This is exactly the Bug 11b cascade case: "a/b/c letter-suffix children should sibling under numbered ancestor; resolver chains them via stack_depth + 1". Empirical evidence: A1 audit captured 3 A1 firings in Snitch (xlsx rows 458/475/491, sl_no b/c/d). Before A1: level 5/6/7 (cascade). After A1: all at level 4 (siblings under numbered parent). The §17.9 lowercase-letter cascade (root cause of Bug 11b) is structurally resolved.

**Snitch LINE_ITEM caveat.** Snitch diagnostic (2026-05-22 on tip f9bd1e70) showed 124/129 depth-1 lowercase-letter rows are GENUINE LINE_ITEMs (cable variants, socket types, conduit sizes). LINE_ITEMs do not go through _determine_preamble_level so A1 does not affect them. Those 124 rows attach to stack-top numbered PREAMBLE naturally without cascade. A1 handles the remaining 5 PREAMBLE anomalies that exhibited the cascade.

**Status:** **CLOSED v5.25.** Both manifestations structurally resolved. The 47 tests added in the reverted v5.22 attempt (feat fb89bf44 + docs f9bd1e70, reverted via debd5186 + f1839b1e) are NOT restored -- they tested classifier-layer auto-promotion logic that A1+A2 supersedes (resolver-layer fix). Original v5.22 commits preserved in git history for archaeology.

### 17.28 #88 [OPEN v5.21, TARGET NEXT] — Section heads pinned at L1, intermediate hierarchy traversal lost (Bug 12)

Non-dotted PREAMBLEs unconditionally L1; dotted-decimals trace to most recent section head. Foundational for §7.34 commit-time notes-merge. ~30 LOC hierarchy.py. Full detail: handover §9 #88.

### 17.29 #89 [CLOSED v5.23] — Excel error literals classified as content (Bug 13)

Excel error literals (#REF!, #VALUE! etc.) classified as content. Fix: EXCEL_ERROR_LITERALS frozenset + _is_excel_error() helper in reader.py; all seven error strings normalized to None at iter_rows() cell-read time; 6 new tests (4 unit + 2 integration). Parser tests 434 -> 440. feat 5ff93064. Full detail: handover §9 #89.

### 17.30 #90 [OPEN v5.21, LOW PRIORITY] — Letter-suffix peer items get nested levels (Bug 14, cosmetic)

Rows like a./b./c. should be peer children of most recent numbered ancestor; currently nested under each other. ~20 LOC hierarchy.py. No data damage. Full detail: handover §9 #90.

### 17.31 #91 [PHASE 3 SPEC v5.21] — Wizard design: area name suffix normalization (Finding 15)

Wizard must strip trailing ` Qty`/` Quantity` from area names auto-detected from column headers. Full detail: handover §9 #91.

### 17.32 #92 [PHASE 3 SPEC v5.21] — Wizard design: single non-merged area column adjacent to merged group (Finding 16)

Wizard needs hybrid layout support. Full detail: handover §9 #92.

### 17.33 #93 [MITIGATED v5.21] — MSYS path conversion on Windows docker exec

/tmp/ translates to C:/Users/.../Temp/. Mitigation: prefix MSYS_NO_PATHCONV=1 on ALL docker exec/cp commands. Captured in CLAUDE.md this commit. Full detail: handover §9 #93.

### 17.34 #94 [MITIGATED v5.21] — Docker cp over heredoc corrupts ownership

Files become root-owned. Mitigation: Write-tool -> host temp file -> docker cp INTO container. NEVER heredoc through bash -c. Full detail: handover §9 #94.

### 17.35 #95 [LESSON v5.21] — Claude Code scope overreach during Sequence E

Auto-drafted E2 configs unilaterally instead of returning to chat after inspection. Mitigation: future prompts include explicit "STOP after this phase" reminders. Full detail: handover §9 #95.

### 17.36 #96 [PATTERN v5.21] — Large output file, desktop-pull pattern

For >50KB diagnostic dumps, docker cp output off container to Desktop + upload to chat; avoid inline cat through Claude Code. Full detail: handover §9 #96.

### 17.37 [DIAGNOSTIC v5.23] — §7.28 orphan-children audit (read-only diagnostic)

Script `unit_demotion_orphan_audit.py` (feat 8a126846) answers: of the ~82 PREAMBLE rows
§7.28 demotes on Snitch '6. Electrical', how many have descendants outside the §7.28 target set
(i.e. descendants that would be orphaned)? Pipeline: classify_row → (§7.28 skipped) →
resolve_hierarchy → (§7.29/§7.30/multi-area skipped). Target set confirmed 82. Result: 47/82
(57.3%) of target rows have ≥1 real-orphan descendant; 196 total real-orphan descendants;
max 9 on a single row. Informs pending decision on "no auto-demote/promote of parented PREAMBLE"
blanket rule. Invokable as `python -m nirmaan_stack.services.boq_parser.unit_demotion_orphan_audit`.

### 17.38 [DIAGNOSTIC v5.23] -- Bill Of Quantities Electrical & ELV rows 4-22 comparison audit

Script `boq_electrical_elv_rows_4_22_audit.py` (feat 3b0790f0) compares production
hierarchy resolution (with §7.28 unit-based demotion) vs proposed Approach A
(Rule A1 lowercase-letter cascade fix + Rule A2 numeric peer signature match,
§7.28 skipped) on xlsx rows 4-22 of ELECTRICAL & ELV BOQ in Bill of Quantities.xlsx.

Per-row output: classification, level, qty, parent_sl_no, path, description.
Headline findings: 0/19 rows differ between current and Approach A in this range.
1 Bug 12 candidate (row 4, sl_no "SUB HEAD A", level 1, text-only section heading
co-existing with numeric level-1 PREAMBLEs 1.0 and 4.0). Rule A1 and Rule A2 each
fire 0 times -- no lowercase-letter cascade or numeric-peer PREAMBLE rows in range.
Rows 9 (2.0) and 11 (3.0) are classified as LINE_ITEM (have qty values), so Bug 11a's
PREAMBLE-vs-LINE_ITEM sibling gap is visible via parent_sl_no="1.0" on both -- Rule A2
cannot fix LINE_ITEM parenting (documented in Approach A limitation footer).
Invokable as `python -m nirmaan_stack.services.boq_parser.boq_electrical_elv_rows_4_22_audit`.

### 17.39 [DIAGNOSTIC v5.25] -- Approach A-reframed audit (sec 9 #99 gating, feat 16647958)

Script `approach_a_reframed_audit.py` (feat 16647958) compares production resolve_hierarchy
(with sec 7.28) vs Approach A-reframed custom resolver (Rule A1 + Rule A2-reframed,
sec 7.28 applied in BOTH) on two full fixtures:

  - Snitch '6. Electrical' (521 rows) -- Rule A1 cascade case
  - Bill of Quantities 'ELECTRICAL & ELV BOQ' (1186 rows) -- Rule A2-reframed case

Rule A1 fires in PREAMBLE level determination when pattern_signature(sl_no) starts with 'l'.
Scans stack top-down for first entry whose sig does not start with 'l'; level = anchor.level+1.

Rule A2-reframed fires at LINE_ITEM attachment step (NOT in _determine_preamble_level).
Stack top only (proximity=1). Trigger: signature(LINE_ITEM.sl_no) == signature(top.sl_no)
AND first_numeric_token differs AND both non-None. Action: attach LINE_ITEM to top.parent
(one level up; root if top has no parent). LINE_ITEM never pushes onto stack.

Snitch '6. Electrical':         A1=3   A2=27  combined=0  indirect=0  total=30
Bill of Quantities ELEC&ELV:    A1=0   A2=31  combined=0  indirect=0  total=31

No auto-bucket misfire classification. User reviews first-20 sample in diagnostic_snapshots/.
Decision criterion: low misfire rate => land A1+A2 next sub-phase (sec 9 #99 closed);
appreciable misfires => park + codify "no more parser fuzzy rules" as working agreement #40.
Gating exit criterion E3 (closing Phase 2c bug-fix cycle).
Invokable as `python approach_a_reframed_audit.py` from the boq_parser directory.

---

### 17.40 [LANDED v5.25] -- Approach A-reframed land (sec 9 #99 CLOSED, feat 8f960a2b)

Rule A1 + Rule A2-reframed landed in hierarchy.py as production code (feat 8f960a2b).
approach_a_enabled: bool = True kwarg on resolve_hierarchy() and
_determine_preamble_level() provides on/off toggle for regression testing.
Helpers pattern_signature() and first_numeric_token() added to hierarchy.py.

F5 tightening applied: A1 trigger changed from sig.startswith('l') to
all(c == 'l' for c in sig_stripped) where sig_stripped = pattern_signature(
sl_no.rstrip('.,):;]')). Prevents mixed codes (a1, custom-code-xyz) from
wrongly absorbing into A1 (failure mode discovered during Step 5 test run).

Sec 7.29 interaction: A2 reparents all 5 children of PREAMBLE "2.0" (xlsx ~502,
Snitch 6. Electrical) to section header G. Zero-children demotion post-pass then
makes "2.0" a LINE_ITEM with parent G, structurally resolving the priced-preamble
ambiguity flagged in sec 9 #45. test_snitch_row_500_demoted_to_line_item_post_a2
captures this end-state.

snitch_electrical_expected.json regenerated: LINE_ITEM 176->177, PREAMBLE 43->42,
preamble_level_transitions 7->4 entries (levels 1-4 only; b/c/d collapse to
level 4 via A1, reducing the former 5/6/7 cascade).

test_approach_a_rules.py: 24 new tests (5 helpers, 7 A1 unit, 7 A2 unit,
3 Snitch integration, 2 BoQ ELV integration). Parser tests: 440 -> 464.

Working agreement #40 deferred pending Bug 12 diagnostic on 2 fixtures
(see §17.28 -- Bug 12 candidate "SUB HEAD A" row 4 in BoQ ELV must be
evaluated on 2 fixtures before deciding whether any further fuzzy rules
are warranted or should be permanently prohibited).

**Update 2026-05-23:** Working agreement #40 now codified in §14 -- see §17.41.

**Update 2026-05-23 (post-hoc recognition):** A1+A2 land also structurally resolved Bug 11a + Bug 11b -- see §17.27 status update.

---

### 17.41 [LANDED v5.25] -- SUB HEAD detection + universal subtotal-reset (sec 9 #100 + #101 CLOSED, feat 25a43617)

Both fixes landed in hierarchy.py. _SUB_HEAD_RE + _is_sub_head_marker() helpers added;
SUB HEAD branch in _determine_preamble_level forces level=1 unconditionally; _MID_SHEET_RESET_RE
preserved (deprecated, audit-script-only) with deprecation comment at definition site --
see in-line comment at definition site. SUBTOTAL_MARKER now unconditionally clears stack.
test_sub_head_and_subtotal_reset.py: 20 tests (6 helper unit, 4 Fix 1 unit, 5 Fix 2 unit,
5 BoQ ELV integration). Parser tests 464 -> 484. PHASE 2c BUG-FIX CYCLE CLOSED.

Empirical basis: 6-fixture cross-corpus audit (BoQ ELV, Snitch '6. Electrical', Inovalon HVAC,
SG HVAC, Raheja Electrical, D-Tech Civil) confirmed zero mid-section subtotals across 46 markers
and "SUB HEAD X" pattern unique to BoQ ELV but harmless to other fixtures. All 21 SUB HEAD
PREAMBLE rows in BoQ ELV now correctly at level=1 with parent_index=None.

Note on Group 4 test scope: test_boq_elv_numeric_preamble_after_sub_head_b_is_clean_root
asserts numeric PREAMBLE 1.0 lands at level=1 with parent_index=None
(clean root, no stale section-A descendant chain). The 1.0 does NOT
parent under SUB HEAD B at level 2 -- both end up as level-1 peers
because dotted-decimal sl_no matches level_1_style="numeric" detection.
This is a known structural limitation in BoQ ELV's mixed-convention
hierarchy (SUB HEAD section markers co-existing with numeric PREAMBLEs
at the same level). Parenting numeric PREAMBLEs under SUB HEAD section
markers requires stateful section-aware level overrides -- fuzzy logic,
violates working agreement #40. Goes to Phase 3+ AI layer along with
Bug 12 + Bug 15.

---

### 17.42 [PARKED v5.25] -- Bug 12 priced section-header detection (sec 9 #88, Phase 3+ AI layer)

Inovalon HVAC sheet: section markers ("VRV SYSTEM FOR CRITICAL AREAS", "VAV BOXES WORKS",
"HYDROGEN EXHAUST") AND sub-section preambles ("OUTDOOR UNITS", "INDOOR UNITS",
"REMOTE CONTROLS", "DRAIN PUMP") are NOTE-classified text rows with no sl_no and no
quantitative data. Parser cannot promote NOTE -> PREAMBLE without natural-language pattern
recognition (short text + uppercase + position before numeric is fuzzy).

Cross-fixture audit identified 14 candidate section-marker NOTEs in Inovalon BOQ alone.
Working agreement #40 governs -- park to Phase 3+ AI review layer.

---

### 17.43 [PARKED v5.25] -- Bug 15 priced-sub-section-header mis-classification (sec 9 #102, Phase 3+ AI layer)

SG HVAC 'BOQ_HVAC Lowside works' sheet: 7 user-identified section headers (xlsx rows
5/123/130/157/165/194/260). 1/7 correctly classified PREAMBLE (row 5 "AIR DISTRIBUTION");
6/7 classified LINE_ITEM and buried under sl_no=1.0.

Root cause: sl_no values REPEAT across sections (sl="A" appears in rows 5, 165, 194, 260
for different sections). Quantitative-data routing dominates classifier today and sends these
to LINE_ITEM bucket. Natural-language section-title recognition is required to distinguish
"A -- CHILLED WATER WORKS" (header) from "A -- Chilled water FCU 1200 CFM" (line item).

Working agreement #40 governs -- park to Phase 3+ AI review layer.

---

### 17.44 [CYCLE 3 DEEP DIVE -- 9 DETERMINISTIC FIXES -- FIX QUEUE v5.26]

Cycle 3 deep dive walked 7 fixtures (sg_hvac, safron, inovalon,
bill_of_quantities, alorica 2row+1row A/B, snitch, raheja_commerzone_hvac;
multi_area_merged_header_v1 dropped per Section 1A decisions log entry). 9 deterministic
parser fixes identified, all meeting working agreement #40 deterministic-unambiguous
bar. Implementation queued per agreement #43 (one cycle + validation).

For each bug below: SYMPTOM (current behavior), CANONICAL FIXTURE EXAMPLES
(rows from cycle 3 walk), ROOT CAUSE (parser layer + mechanism), FIX SPEC
(what changes, in which module), EXPECTED POST-FIX BEHAVIOR (same rows
after fix), CROSS-FIXTURE SAFETY.

----------------------------------------------------------------------
Bug 16 -- classifier unit invariant (in-classifier flow)
LANDED v5.27 (this session). Commit: 68cfc57d.
----------------------------------------------------------------------

ROOT CAUSE: classifier's classification decision step routes to
LINE_ITEM whenever qty/rate/amount is present. Policy X (sec 7.25)
preserves explicit zero, so =SUM(blanks)=0.0 counts as "qty present."
sg_hvac and Snitch authors use ghost formulas (=SUM(blanks),
=N(...)*N(...)) on visually-blank rows, producing rows with
qty=0.0 but no semantic content. The classifier had no check on
unit presence.

FIX: in-classifier two-clause block in classify_row(), inserted
AFTER the existing four-way classification decision and BEFORE
the existing emptiness guard. Single toggle BUG_16_UNIT_INVARIANT_
ENABLED (default True) gates both clauses.

Clause 1 (SPACER broadening): if sl_no AND description AND unit
are all blank-or-junk, classify as SPACER. Overrides whatever the
four-way decision produced.

Clause 2 (LINE_ITEM unit gate): if the four-way decision produced
LINE_ITEM but unit is blank-or-junk, re-evaluate via PREAMBLE /
NOTE rules (same logic as the four-way decision but without the
LINE_ITEM option).

Three field-specific blank-or-junk helpers:
- _is_unit_blank_or_junk: trimmed empty OR contains no alphabetic
  characters. Rejects "", "-", "0", "123". Accepts "Nos.", "m**2", "LS".
- _is_sl_no_blank_or_junk: trimmed empty OR contains no alphanumeric
  characters. Accepts "1.0", "A.", "IV". Rejects "*", arrows.
- _is_description_blank_or_junk: delegates to _is_sl_no_blank_or_junk.

INVARIANT: together with sec 7.28 (unit-based PREAMBLE demotion)
and sec 7.29 (zero-children PREAMBLE demotion), Bug 16 closes the
biconditional: a row is LINE_ITEM if and only if it has a real
unit (modulo SPACER / HEADER_REPEAT / SUBTOTAL_MARKER caught at
earlier classifier steps).

CROSS-FIXTURE IMPACT (Phase 0 diagnostic this session):
- sg_hvac BOQ_HVAC Lowside works: 132 LINE_ITEM reclassifications
  (74 via Clause 1 to SPACER, 58 via Clause 2 to PREAMBLE/NOTE).
- Snitch 6. Electrical: 190 NOTE -> SPACER via Clause 1.
- VRF System: 1 Clause 1 + 1 Clause 2 hit.
- Inovalon HVAC: unchanged.
- Bill of Quantities ELV: unchanged.

CALIBRATION UPDATES TO EXISTING TESTS:
- test_classifier.py: 8 synthetic rows gained explicit unit="Nos"
  (were missing units; under old behavior LINE_ITEM, under Bug 16
  PREAMBLE).
- test_orchestrator.py: Snitch NOTE expectation 287 -> 97;
  Societe HVAC LINE_ITEM threshold relaxed; 2 Pattern 2 column-role
  maps shifted right by one to accommodate new unit column.
- generate_synthetic.py: Pattern 2 fixtures (synthetic_multi_area_
  2row.xlsx, synthetic_pattern_2_rate.xlsx) regenerated with a unit
  column (C) and unit="Nos" on data rows.

TODO/CLEANUP: Clause 2's fall-through duplicates the PREAMBLE/NOTE
logic from the four-way decision above (lines 766-789). If that
logic changes in a future fix, this block must be updated in
lockstep. Flagged for a future cleanup session: extract the
PREAMBLE/NOTE decision into a private helper called by both the
main path and Clause 2's fall-through.

ARCHITECTURAL ASYMMETRY: Bug 16 sits in classify_row() body
(in-classifier). Sec 7.28 and sec 7.29 sit as post-passes. The
biconditional invariant is therefore enforced in two places: the
classifier blocks LINE_ITEM at classify time when unit is missing
(Bug 16), and the post-passes catch PREAMBLEs with units at
post-classify time (sec 7.28/7.29). Acknowledged; not addressed
this session. Future cleanup may consolidate into one location.

PARKED BUG 16 ALTERNATIVE (FROM v5.26): the original v5.26 spec
proposed _apply_unit_blank_demotion_post_pass running after
sec 7.28. This session reframed to in-classifier flow. Rationale:
cleaner architecture (no intermediate "LINE_ITEM-that-is-not-
really-LINE_ITEM" state); enforces the invariant from the start.
The original post-pass framing is not implemented and will not be.

----------------------------------------------------------------------
Bug 17 -- Reader-layer auto-trim for text-role columns   [LANDED 30b6045b]
Layer: reader.py
----------------------------------------------------------------------

IMPLEMENTATION-DESIGN NOTE: Approach (a) sub-variant chosen -- reader takes
text_role_columns: set[str] | None at iter_rows() call time (column letters,
not construction). Orchestrator derives the set from SheetConfig.column_role_map
filtering by TEXT_ROLE_ROLES constant before calling iter_rows(). Single
commit; Bug 18 plumbing is independent shape (is_merged_origin propagation).
Pre-flight confirmed via raw xlsx XML inspection (openpyxl not available on
host): alorica A31/A33 numFmtId=0 ("General"), A45/A52 numFmtId=2 ("0.00"),
sg_hvac A39 numFmtId=166 (complex accounting format, no-op acceptable per spec).
+21 tests (502->523). Closes cluster 1 session 3.

SYMPTOM: sl_no (and other text-role columns like append_to_notes) read as
Python str() of float, losing user-intended display formatting. Two
failure modes:
(i) Trailing zero trim: BoQ author types "1.10" in numeric-formatted cell,
    Excel stores as float 1.1, str(1.1) returns "1.1". Author's "1.10" intent
    lost.
(ii) Float precision noise: BoQ author writes a formula like =A30+0.1,
     Excel evaluates to 2.3000000000000003 (IEEE 754), openpyxl returns
     the float, str(2.3000000000000003) returns the full precision string.

CANONICAL FIXTURE EXAMPLES:
- alorica r31: sl_no="2.3000000000000003" (formula result, intended "2.3"
  or "2.30")
- alorica r33: sl_no="2.4000000000000004" (intended "2.4")
- alorica r45: sl_no="3.0199999999999996" (intended "3.02")
- alorica r52: sl_no="3.0299999999999994" (intended "3.03")
- sg_hvac r39: sl_no="1.1" (sequence is 1.07, 1.08, 1.09, 1.1, 1.11, 1.12 --
  likely author typed "1.10" but Excel stored as 1.1 because default numeric
  formatting trims trailing zeros)

ROOT CAUSE: reader.py iter_rows() uses openpyxl data_only=True mode and
passes cell.value through. str() coercion happens downstream (classifier.py
reads cell value for sl_no). For floats, str() loses both trailing zeros
(from Excel's display format) and exposes IEEE 754 precision artifacts
(from formula evaluation).

FIX SPEC: Add helper to reader.py:
`_format_numeric_as_displayed(value, number_format) -> str`. Logic:
  - If value is int or value is None: return str(value) or "" respectively.
  - If value is float AND number_format matches a known precision pattern
    (e.g., "0.0", "0.00", "0.000"): use Python format-spec, e.g.,
    format(2.3000000000000003, ".2f") -> "2.30".
  - If value is float AND number_format is "General": apply
    conservative rounding (e.g., round(value, 10) then strip trailing zeros
    with care to preserve at least 1 decimal if format hints).
  - If value is str: pass through unchanged.
Apply to text-role columns only (sl_no, append_to_notes, description, unit,
make_model) -- NOT to numeric-role columns (qty/rate/amount which need raw
float for math).

EXPECTED POST-FIX BEHAVIOR:
- alorica r31: sl_no="2.30" (or "2.3" depending on cell number_format)
- alorica r45: sl_no="3.02"
- sg_hvac r39: sl_no="1.10" if number_format is "0.00", or "1.1" if
  "General" -- depending on what's actually in source cell format.

CROSS-FIXTURE SAFETY: Bug 17 fixes can only IMPROVE output, never regress --
the worst case is a no-op (number_format is "General" and value already
cleanly formatted). Cross-checked across 6 walked fixtures: snitch, raheja,
boq, safron, inovalon all use clean sl_nos with no precision noise; sg_hvac
and alorica are the catches.

Inovalon r26 (rate_supply_resolved=7560.000000000001) is a
cosmetic float passthrough in a numeric-role column (rate_supply),
NOT a Bug 17 target. Bug 17 applies to text-role columns only
(sl_no, append_to_notes, description, unit, make_model). Numeric-
role columns keep raw float for downstream math; downstream
ResolvedRow formatters handle display rounding for numeric
columns separately.

----------------------------------------------------------------------
Bug 18 -- Merged-cell banner rows produce false LINE_ITEMs
Layer: reader.py
----------------------------------------------------------------------

LANDED v5.28 -- cluster 1 session 4 (feat 41a86cd9)

IMPLEMENTATION NOTES:
- Architecture path (a) chosen: fix inside iter_rows() reusing Bug 17
  text_role_columns wiring. No classifier.py changes. No orchestrator
  changes. CellInfo.is_merged_origin and covered_lookup already present
  in reader.py; covered is not None correctly identifies propagated cells.
- New constant BUG_18_MERGE_PROPAGATION_BLANK_ENABLED (default True) in
  reader.py, placed immediately after Bug 17 helper section.
- Suppression logic: after Bug 17 formatting block, if toggle AND
  text_role_columns AND col_letter in text_role_columns AND covered is
  not None -> computed_value = None. Non-text-role covered cells
  (qty, rate, amount) are NOT suppressed -- area-header merge
  propagation continues to work.
- Fix selection (path a vs b vs c): path (a) chosen per chat-Claude
  2026-05-26 architectural discussion; rationale: Bug 17 consistency +
  zero new parameters or orchestrator changes. See agreement #39.
- Excel verification of safron r41: A41:G41 merge confirmed, cell text
  "PART- 2 INSULATION" (space after dash), no stray numeric data.
- +7 tests (523->530): 5 synthetic unit (TestBug18SyntheticMergeBanner)
  + 2 safron real-fixture integration (TestBug18SafronIntegration --
  r41 reader-level covered cell blank + classify_row NOTE assertion).
  0 existing-test calibrations. Cluster 1 complete (3 of 3:
  Bug 16 + Bug 17 + Bug 18 landed).
- Feat hash: 41a86cd9. Docs hash: see §14 decisions log.

ORIGINAL SYMPTOM: When BoQ author uses a banner-style section header that
spans multiple columns via merged cells, the per-cell merge propagation
logic (Phase 2b.2 Part A1, v5.10) copies the banner text into every
covered cell. Classifier then sees the same string in A (sl_no),
B (description), C (unit), etc. and routes to LINE_ITEM.

CANONICAL FIXTURE EXAMPLE:
- safron r41: PART-2 INSULATION banner. Merge A41:G41. After fix:
  A41 retains "PART- 2 INSULATION"; B41/C41 (text-role) -> None.
  D41-G41 (numeric-role) still carry propagated text -> treated as
  non-numeric qty=0.0 rate-only. Bug 16 Clause 2 then fires (unit=None
  is junk + desc=None is blank) -> NOTE.

CROSS-FIXTURE SAFETY: Banner-style section headers seen only in safron r41
among walked fixtures. Non-text-role covered cells unaffected.
Cross-fixture check during cycle 3 re-run will confirm no misfires.

----------------------------------------------------------------------
Bug 19 -- Priced-PREAMBLE detection via sl_no signature (LINE_ITEM step)
Bug 19-ext -- Same logic extended to PREAMBLE attachment step
Layer: classifier.py + hierarchy.py
LANDED cluster 2 session 4 (feat fbc1d845)
----------------------------------------------------------------------

IMPLEMENTATION DELTA vs ORIGINAL SPEC (cluster 2 session 4 partial-abort #20):

Original spec framed Bug 19 as an A2-reframed extension at the hierarchy
resolver's LINE_ITEM attachment step. Actual implementation pivoted to a
pre-resolve post-pass in classifier.py (_apply_priced_preamble_promotion),
running at Step 3c in parse_boq() pipeline (after Bug 20, before
resolve_hierarchy). Pivot rationale: once Bug 20 anchor-promoted PREAMBLEs
are visible, we can detect the priced-section-header pattern purely from
the classified list without needing hierarchy state.

ALGORITHM (as landed): backward-only window scan (size=20). For each LINE_ITEM
with numeric sl_no, collect first_numeric_token values of PREAMBLEs in the
backward window sharing the same pattern_signature. Promote iff:
  (a) len(preamble_fnts) >= 2
  (b) sorted preamble_fnts forms a gap-free consecutive sequence
  (c) target fnt == max(preamble_fnts) + 1

Backward-only: prevents a PREAMBLE from a DIFFERENT section (appearing in the
forward portion of the symmetric window) from corrupting the anchor set.
Rows processed in document order so promoted rows immediately become anchors
for subsequent candidates (8.00 promoted → 9.00 sees {3..8} in its window).

promoted_from_line_item: bool = False field added to ClassifiedRow; set on
promotion. Guard added in _apply_zero_children_preamble_demotion_post_pass
Step B to skip promoted rows (priced section headers legitimately have
unit/qty as leaf PREAMBLEs).

DISCRIMINATOR SHAPE (false-positive case, deferred):
Snitch electrical has 2 residual false promotions (30.0 row=109 backward
window {28,29}; 6.0 row=341 backward window {3,4,5}) where a clean contiguous
PREAMBLE sequence immediately precedes a genuine LINE_ITEM of the same pattern.
These promotions are semantically harmless (LINE_ITEM treated as PREAMBLE leaf
with no children). Discriminator refinement deferred to cycle 3 validation
re-run review. snitch_electrical_expected.json calibrated (LINE_ITEM 177→175,
PREAMBLE 42→44).

Bug 19-ext (sec 9 #107) as landed: BUG_19_EXT_PREAMBLE_REPARENT_ENABLED
toggle in hierarchy.py. In the PREAMBLE branch of resolve_hierarchy, after
the stack assigns a natural parent, scan resolved rows backwards for a PREAMBLE
with matching pattern_signature AND matching first_numeric_token at level-1.
If found and different from the natural parent, override parent_index.
Canonical: Inovalon r22 (sl=1.3) correctly parents under r6 (sl=1.0) because
r6 is found in the backward scan with sig='D.D' and fnt=1 matching r22's fnt.

Guarded by approach_a_enabled toggle (same toggle that gates A1/A2).

13 new tests in test_priced_preamble_promotion.py (552 → 565 total).
Sec 9 #106 and #107 CLOSED.

----------------------------------------------------------------------

SYMPTOM: LINE_ITEMs with sl_no signature matching nearby PREAMBLE family
but having quantitative data (so classifier correctly tags LINE_ITEM)
attach to wrong parent because hierarchy resolver attaches LINE_ITEMs to
top-of-stack only.

CANONICAL FIXTURE EXAMPLES:
- sg_hvac r25: sl_no="1.04" LINE_ITEM (real qty data, "plenum with Double
  skin AHU"). Parents under r6 (sl=1.0 PREAMBLE) which is a section-content
  parent. Should be sibling-of-r6, parented under r5 SUB HEAD A
  AIR DISTRIBUTION.
- safron r34 (sl=8.0), r35 (sl=9), r37 (sl=10.0): all LINE_ITEMs with real
  data. Parent under r30 (sl=7.0 PREAMBLE) instead of being level-1
  sibling sections.
- inovalon r22: sl_no="1.3" PREAMBLE parented under r19 (sl=2.0)
  PREAMBLE instead of r6 (sl=1.0) EQUIPMENTS -- same-family sibling gap at
  the PREAMBLE attachment step. This is Bug 19-ext.

ROOT CAUSE: v5.25 Rule A2-reframed fires at LINE_ITEM attachment with
`pattern_signature(LINE_ITEM.sl_no) == pattern_signature(top.sl_no)` AND
`first_numeric_token(LINE_ITEM.sl_no) != first_numeric_token(top.sl_no)`.
Two extensions needed:
(a) Bug 19: A2-reframed currently only re-parents to top's parent (one
    level up). It should also flag the LINE_ITEM as `needs_classification_
    review = True` with `review_reason = "priced_preamble_with_children"`
    analogue, so wizard can surface for user review (similar to §7.30).
(b) Bug 19-ext: A2-style logic at LINE_ITEM step doesn't apply to
    PREAMBLEs. The PREAMBLE-PREAMBLE case (inovalon r22 sl=1.3 should
    parent under r6 sl=1.0 instead of r19 sl=2.0) is unaddressed.

FIX SPEC:
(a) Bug 19: extend A2-reframed action to also set
    `needs_classification_review=True` + `review_reason=
    "priced_preamble_via_signature"` on the re-parented LINE_ITEM. Wizard
    reads this in review pass.
(b) Bug 19-ext: in `_determine_preamble_level`, after Rule A1 fires (or if
    A1 doesn't apply), check stack for entries with same pattern_signature
    AND different first_numeric_token. If found, set level to that entry's
    level and parent to that entry's parent (sibling-under-grandparent
    pattern, mirroring A2-reframed).

Search window and safety threshold (applies to both Bug 19 and
Bug 19-ext):
- Window: +/- 20 rows symmetric around the candidate row (the
  LINE_ITEM at Bug 19 attachment, or the PREAMBLE at Bug 19-ext
  attachment). Scan reaches forward into not-yet-classified rows
  only if those rows are already on the stack at the time of
  attachment; otherwise scan is backward-only within the 20-row
  radius.
- Minimum-count safety threshold: if fewer than 3 PREAMBLEs are
  present in the window, the rule does NOT fire. This prevents
  misfires on sparse sections where signature-matching peers are
  too few to establish reliable sibling-family structure.
- Asymmetric tunable held in reserve: window radius is configurable
  via module-level constants (forward_radius, backward_radius,
  min_window_preambles). Default symmetric +/- 20 / +/- 20 / >= 3.
  If post-land misfires surface on specific fixtures, tune
  asymmetrically (e.g. backward 30, forward 10) without changing
  the rule's deterministic-binary character. Tunable values land
  in agreement #16 (known-pattern citation) framing -- any
  asymmetric tune must cite specific empirical misfire evidence.

EXPECTED POST-FIX BEHAVIOR:
- sg_hvac r25 sl=1.04: A2-reframed already fires here (re-parents to None
  if r6's parent is None; with Bug 20-ext, r6 parents under r5 so r25
  becomes sibling of r6 under r5). Bug 19 adds review flag.
- safron r34/35/37: A2-reframed fires, re-parents to None (rootless). Bug 19
  adds review flag.
- inovalon r22: Bug 19-ext fires in _determine_preamble_level. Scans stack
  for signature match with different first_token. Finds r6 (sl=1.0,
  signature "D.D", first_token 1). r22 (sl=1.3, signature "D.D",
  first_token 1) -- wait, same first_token. Doesn't fire on this rule;
  actually correctly parents under r6 (already L1 PREAMBLE) at level 2.
  The Inovalon r22 issue is different: it should parent under r6 (sl=1.0)
  not r19 (sl=2.0); but the current resolver pops r6 when r19 enters
  (same level). After r19 pops r6, r22 sees only r19 on stack.
  THE FIX: Bug 19-ext applies when r22 enters -- it should scan FULL stack
  history (not just top), find r6 in the path (lookback), and re-parent
  to r6. This requires a stack-history scan, more complex than A2's
  top-only check. Implementation detail to be worked out in fix-prompt
  drafting.

CROSS-FIXTURE SAFETY: A2-reframed firing pattern already validated in
v5.25 (61 firings across Snitch + BoQ ELV, all correct). Extension to add
review flag is strictly additive -- no behavior change for the parenting
itself. Bug 19-ext extension to PREAMBLE step requires careful audit
before locking spec.

----------------------------------------------------------------------
Bug 20 anchor 1 + 2 + 3 -- Section-header NOTE -> PREAMBLE
Layer: classifier.py + hierarchy.py
LANDED anchors 1+2 v5.28 -- cluster 2 session 2 (feat 4f85ec3e)
Coverage correction (test only, no source change): initial test SheetConfig
used header_row=5 (copied from Bug 17/18 pattern). Safron's actual header is
r3. Corrected in follow-up commit; safron r5 PART-1 banner now exercises
anchor 1 as a real-fixture canonical case (was previously invisible to the
test). Caveat JJ logged for Bug 17 + Bug 18 config consistency.
----------------------------------------------------------------------

SYMPTOM: BoQ section-header rows that have only description text (no
sl_no, no numeric data) classify as NOTE per classifier rules
(description-only with no sl_no -> NOTE). They should be PREAMBLEs at
the section-root level, with subsequent numeric PREAMBLEs / LINE_ITEMs
parenting under them.

CANONICAL FIXTURE EXAMPLES:
- safron r5: "PART-1 AIR DISTRIBUTION SYSTEM" NOTE (no sl_no, no
  numeric). First non-spacer non-header row after header. Should be
  section-header PREAMBLE. Subsequent rows r7-r39 (sl=1.0 through 8.0
  and SUBTOTAL r39) all rootless level-1; should be children of r5.
- safron r41: "PART-2 INSULATION" (currently false LINE_ITEM per
  Bug 18 due to merged-cell banner; after Bug 18 fix becomes NOTE).
  First non-spacer after SUBTOTAL r39. Should be section-header
  PREAMBLE. Subsequent r44 (sl=1.0), r46 (sl=2.0) and r48 SUBTOTAL
  should be children.
- safron r43: "ACCOUSTIC INSULATION" NOTE. First non-spacer after
  promoted PREAMBLE r41 (anchor 3 -- post-promoted-section-header).
  Should be sub-section-header PREAMBLE under r41. Subsequent r44/r46
  parent under r43, which parents under r41.
- bill_of_quantities r4: "SUB HEAD A WIRING IN STEEL & PVC CONDUIT"
  already classifies as PREAMBLE per v5.25 §17.41 SUB HEAD detection.
  Bug 20 anchors don't change this -- SUB HEAD rule fires first. Bug
  20-ext level-0 applies (see next bug).

ROOT CAUSE: Classifier rule "description-only with no sl_no -> NOTE" is
correct for inline notes but mislabels banner-style section headers.
Hierarchy resolver then treats NOTE as content (attaches to topmost
PREAMBLE), not as structural element.

FIX SPEC: Add new hierarchy.py post-pass
`_apply_section_header_note_promotion_post_pass(classified_rows)`. Three
anchor patterns:
(1) Anchor 1 -- header: First non-spacer non-header row after the header
    row, where row is NOTE-classified with no sl_no, no numeric data.
    Promote to PREAMBLE at level 0.
(2) Anchor 2 -- subtotal: First non-spacer row after a SUBTOTAL_MARKER,
    same NOTE criteria. Promote to PREAMBLE at level 0.
(3) Anchor 3 -- post-promoted-section-header: First non-spacer row after
    a PREAMBLE that was just promoted via anchor 1 or 2 (one-step
    recursive), same NOTE criteria. Promote to PREAMBLE at level 1
    under the just-promoted ancestor.

Reading B locked: single-step recursive only -- anchor 3 does NOT
chain (promoted-via-anchor-3 PREAMBLE does NOT itself become a
new anchor for a further anchor 3 firing). Anchor 3 is correctness-
preferred but NOT data-loss-critical: even if anchor 3 mis-classifies
a row that should have been promoted, §22.11 NOTE-attachment
captures the row's content as an attached note under the most
recent in-stack PREAMBLE (e.g. safron r43 ACCOUSTIC INSULATION
content surfaces under r41 PART-2 INSULATION via the NOTE-attachment
pathway even if r43 itself stays classified as NOTE). This makes
anchor 3 a structurally-nice-to-have rather than a data-recovery
necessity -- implementation may defer anchor 3 if its empirical
yield proves too low to justify the misfire-audit cost.

Run BEFORE existing v5.25 SUB HEAD detection (so SUB HEAD takes priority
if applicable).

EXPECTED POST-FIX BEHAVIOR:
- safron r5: anchor 1 fires -> PREAMBLE level 0. r7/r13/r17/.../r37
  (level-1 sections 1.0 through 8.0) parent under r5.
- safron r41: Bug 18 demotes from LINE_ITEM to NOTE first; then anchor 2
  fires (preceded by SUBTOTAL r39) -> PREAMBLE level 0. r44/r46 (sl=1.0
  and 2.0) parent under r41.
- safron r43: anchor 3 fires (post-promoted r41) -> PREAMBLE level 1
  under r41. r44/r46 parent under r43.

CROSS-FIXTURE SAFETY:
- sg_hvac: r5 SUB HEAD-style is already PREAMBLE via sl_no=A -> existing
  rule covers, Bug 20 doesn't fire (no NOTE preceding).
- inovalon: r36-r40 cluster ("Central Air Cleaner for AHUs", etc.) NOT
  caught by any of the 3 anchors -- no header/subtotal/promoted-PREAMBLE
  immediately precedes. STAYS PARKED to Phase 3+ AI per agreement #43.
- snitch: pre-section INDEX (rows 3-10 PREAMBLEs + r11 SUBTOTAL) already
  works under universal subtotal-reset; Bug 20 anchors don't fire (no
  NOTE-classified section headers).
- raheja: section markers are PREAMBLEs (sl=1/2/3/4), not NOTEs. Bug 20
  doesn't fire.

----------------------------------------------------------------------
Bug 20-ext -- Section-header PREAMBLEs at LEVEL 0 (closes v5.25 §17.41
             PARKED limitation)
Layer: hierarchy.py
LANDED v5.28 -- cluster 2 session 2 (feat 4f85ec3e)
----------------------------------------------------------------------

SYMPTOM: Section-header PREAMBLEs (detected via SUB HEAD pattern v5.25,
or via Bug 20 anchors 1-3 newly above) are assigned level=1. Subsequent
numeric PREAMBLEs (sl_no like "1.0", "2.0") also resolve to level=1.
Stack-walk rule "pop while top.level >= candidate.level" pops the
section-header PREAMBLE when a level-1 numeric PREAMBLE enters. Section
headers become functionally useless as parents -- numeric PREAMBLEs become
rootless.

CANONICAL FIXTURE EXAMPLE:
- bill_of_quantities r4: SUB HEAD A WIRING IN STEEL & PVC CONDUIT,
  currently level=1, rootless.
- bill_of_quantities r6 sl=1.0, r9 sl=2.0, r11 sl=3.0, r13 sl=4.0,
  r25 sl=7.0, r30 sl=8.0, r38 sl=10.0, r43 sl=11.0, r52 sl=14.0:
  all level=1, all rootless. None parent under r4 SUB HEAD A.

ROOT CAUSE: v5.25 §17.41 explicitly set SUB HEAD to level=1 with the
reasoning that level=0 would break existing tests asserting level=1 +
parent=None for the 21 SUB HEAD rows. The PARKED rationale was
"Parenting numeric PREAMBLEs under SUB HEAD section markers requires
stateful section-aware level overrides -- fuzzy logic, violates working
agreement #40." But the fix is NOT fuzzy -- it's a single level-assignment
change.

FIX SPEC: Modify hierarchy.py SUB HEAD detection branch and Bug 20
anchors 1-3 promotion logic: section-header PREAMBLEs (whether detected
via SUB HEAD regex or via Bug 20 anchors 1-3) get `level=0` instead of
`level=1`. Numeric/letter PREAMBLEs continue to resolve to level=1+ via
existing 10-priority logic; stack-walk pop rule unchanged. Result:
level=0 section headers do not get popped by level=1 numeric PREAMBLEs;
numeric PREAMBLEs correctly parent under the level=0 section header.

Test calibration: 21 SUB HEAD rows in BoQ ELV currently asserted at
level=1 + parent=None. After fix: level=0 + parent=None (still rootless
at section-root level). Test JSONs need regeneration. NOT a regression
-- it's an explicit calibration update for the corrected behavior.

EXPECTED POST-FIX BEHAVIOR:
- bill_of_quantities r4 SUB HEAD A: level=0, parent=None.
- bill_of_quantities r6 sl=1.0: level=1, parent=r4. (Currently
  level=1, parent=None.)
- bill_of_quantities r9 sl=2.0: level=1, parent=r4 (A2-reframed
  re-parents from r6's parent which is now r4).
- All sl=1.0 through 14.0 PREAMBLEs/LINE_ITEMs in section A parent
  under r4 SUB HEAD A. Section structure correctly modeled.

CROSS-FIXTURE SAFETY:
- bill_of_quantities is the high-impact case. Closes v5.25 §17.41
  PARKED limitation.

Keystone observation (cluster-2 sequencing rationale): Bug 19 +
Bug 19-ext alone do NOT unlock BoQ-style structures, because
text-shaped pattern_signature (e.g. "SUB HEAD A" -> "UUU UUUU U")
never matches numeric-shaped pattern_signature (e.g. "1.0" -> "D.D")
under any tokenization. The one-line level=0 assignment change in
Bug 20-ext is what actually unlocks numeric PREAMBLEs parenting
under SUB HEAD section roots in Bill of Quantities. This makes
Bug 20-ext the highest-yield fix in cluster 2 for BoQ-style
structures -- Bug 19/19-ext are complementary but not substitutive.
Cluster 2 sequencing places Bug 20-ext last so its 21-assertion
test calibration lands after all prior cluster-2 fixes have
stabilized.

- safron r5/r41 (post Bug 20 anchor 1+2): also become level=0, get
  correct children.
- sg_hvac r5 (already PREAMBLE level=1 via sl_no=A): unaffected -- only
  promoted-via-anchor section headers get level=0. Existing PREAMBLEs
  with explicit sl_no keep their level.
- inovalon, snitch, raheja: no SUB HEAD pattern, no Bug 20 anchor
  promotions -> unaffected.

----------------------------------------------------------------------
Bug 22 -- Token-based pattern_signature (collapses consecutive digits)
Layer: hierarchy.py
----------------------------------------------------------------------

SYMPTOM: v5.25 `pattern_signature(sl_no)` is per-character: digits->D,
uppercase->U, lowercase->l, other chars literal. This means "9.0" produces
"D.D" but "10.0" produces "DD.D". Rule A2-reframed requires signature
equality between LINE_ITEM and stack-top PREAMBLE. When section
numbering crosses single-digit->multi-digit boundary, A2 stops firing.

CANONICAL FIXTURE EXAMPLE:
- snitch r48 sl_no="10.0" LINE_ITEM: stack at processing has
  [r14(A., L1), r31(3.0, L2)]. pattern_signature("10.0")="DD.D",
  pattern_signature("3.0")="D.D" -- DIFFERENT. A2-reframed does not fire.
  r48 attaches to top of stack = r31. Should be sibling of r6 sl=1.0,
  r9 sl=2.0, etc. (all parent under r14).
- snitch r50 sl_no="11.0": same issue, also parents under r31.

ROOT CAUSE: pattern_signature implementation maps each character
independently. Multi-digit integers produce N consecutive D's, breaking
equivalence with single-digit-prefix counterparts.

FIX SPEC: Modify `pattern_signature` to collapse consecutive same-class
characters into a single token. Two equivalent implementations:
(a) Regex-based: `re.sub(r"D+", "D", signature)` after current per-char
    mapping. "DD.D" -> "D.D", "DDD.DD" -> "D.D".
(b) Token-iteration: split by separator characters ("."), classify each
    token as "numeric"/"alpha"/"mixed" using the token's character classes.
    "10.0" -> ["numeric","numeric"], "3.0" -> ["numeric","numeric"]. Match.

Implementation choice: option (a) is the smaller change -- one line of
regex post-processing on existing function output. Tests need updating:
pattern_signature unit tests asserting "DD.D" for "10.0" should assert
"D.D" instead.

EXPECTED POST-FIX BEHAVIOR:
- snitch r48 sl_no="10.0": pattern_signature now "D.D" matches r31's
  "D.D". A2-reframed fires: same signature, first_token differs
  (10 != 3). Re-parent to r31's parent. r31's parent is r14 (sl=A.).
  r48 attaches to r14. Correct.
- snitch r50 sl_no="11.0": same, parents under r14.
- Same fix benefits any BoQ section with >=10 numbered items where the
  10+ items are LINE_ITEMs.

CROSS-FIXTURE SAFETY: STRICTLY ADDITIVE. The change only enables
additional A2-reframed firings (previously blocked by signature
mismatch). Existing firings (where signatures already matched, e.g.,
Snitch sl=2.0 through 9.0, BoQ ELV sl=2.0/3.0 vs 1.0) continue to fire
identically -- "D.D" still equals "D.D" under the new signature. No
existing-correct case becomes wrong. Test count: pattern_signature
unit tests need recalibration (~5-8 assertions), no integration test
regression expected.

LANDED v5.26a -- cluster 2 session 1 (feat 4e5561d3)

IMPLEMENTATION NOTES:
- Exact change: `return re.sub(r"D+", "D", "".join(result))` replaces
  bare `return "".join(result)` in pattern_signature. One line added.
  import re was already present (SUB HEAD detection v5.25).
- Unit-test recalibrations: 1 assertion in test_approach_a_rules.py
  (line 192, "10.3" expected "DD.D" -> "D.D").
- New tests: 3 methods in class TestPatternSignatureBug22 in
  test_hierarchy.py (test_multi_digit_collapses_to_single_token,
  test_single_digit_signature_unchanged,
  test_mixed_class_runs_each_class_collapses_independently).
- Parser test count: 484 -> 487 OK.
- Integration-level impact (snitch r48/r50 re-parenting) deferred to
  cycle 3 validation re-run (session 7). No integration test
  regressions observed during session 1 test run.
- Canonical 7-module command in prompt was stale: test_config +
  test_reader live at boq_parser root (not tests/ subdir), and
  test_approach_a_rules + test_sub_head_and_subtotal_reset were
  missing. Correct 9-module command documented in session findings.
  Sec 9 #110 CLOSED.
- Toggle added v5.26a session 1.5 (feat a2ce8a0d): module-level constant
  BUG_22_COLLAPSE_ENABLED (default True). Set False for regression
  isolation if cycle 3 validation re-run (session 7) surfaces a
  Bug 22-induced misfire. Mirrors v5.25 approach_a_enabled precedent
  in intent; module-level constant rather than function kwarg because
  pattern_signature is called from inside Rule A2-reframed. 3 additional
  tests in TestPatternSignatureBug22 covering toggle ON default +
  toggle OFF restoration of pre-Bug-22 per-char signature +
  same-first-numeric-token edge case (1.10 / 1.01 / 1.1 invariant lock
  -- same signature post-fix, same first_numeric_token, A2-reframed will
  not fire). Parser tests 487 -> 490 OK. Stale canonical command confirmed
  absent from plan-doc and CLAUDE.md (it existed only in session prompts,
  not in repo files -- no replacement needed in docs).

----------------------------------------------------------------------
Cross-bug interactions and implementation ordering
----------------------------------------------------------------------

Implementation will be batched per agreement #43 time-box (5-7 sessions
for all 9 fixes + cycle 3 validation re-run). Recommended cluster split:

CLUSTER 1 -- classifier.py + reader.py (~3 sessions):
- Bug 16 (classifier post-pass -- unit-blank demotion)
- Bug 17 (reader format helper + classifier integration)
- Bug 18 (merged-cell banner detection -- depends on Bug 17 architecture
  decision for cross-layer plumbing)

CLUSTER 2 -- hierarchy.py (~3 sessions):
- Bug 22 (pattern_signature token-collapse -- smallest, lands first) ✅ LANDED session 1
- Bug 19 (review flag on A2-reframed firings)
- Bug 19-ext (PREAMBLE-step signature siblings)
- Bug 20 anchors 1 + 2 (+ anchor 3 deferred to session 6) ✅ LANDED session 2
- Bug 20-ext (level-0 framing) ✅ LANDED session 2

VALIDATION -- cycle 3 re-run (~1 session):
- Re-run cycle 3 against 8 fixtures (multi_v1 dropped)
- Manual review of resolved-row outputs vs current baseline
- Confirm no regressions on 547 parser tests (or accept calibrated
  test JSON updates for Bug 19)

Cross-bug interactions to watch:
- Bug 16 + Bug 18: both re-route rows out of LINE_ITEM. Bug 18 fires
  earlier (in classify_row body); Bug 16 fires later (post-pass). No
  conflict.
- Bug 16 + Bug 20: Bug 16 may demote a LINE_ITEM to PREAMBLE
  (description+sl_no, no unit). Bug 20 anchors then fire on NOTE rows
  (Bug 16 doesn't produce NOTE from LINE_ITEM unless sl_no blank).
  No conflict.
- Bug 20 + Bug 20-ext: must fire in order -- anchors 1/2/3 promote NOTE
  to PREAMBLE first, then level-0 framing applies to those PREAMBLEs.
- Bug 22 + Rule A2-reframed: Bug 22 only changes signature output;
  A2-reframed's match logic unchanged. Bug 22 strictly adds firings.
- Bug 19 + §7.30: similar review flag namespace. Reason strings differ
  (priced_preamble_via_signature vs priced_preamble_with_children).
  One-writer-per-review_reason invariant (§22.11 invariant 5) preserved.

Out-of-scope shape observed during cycle 3 walk (Inovalon
subtotal-reset-and-continue):

Inovalon r28 SUBTOTAL is followed by rootless level-2 PREAMBLEs
at r30, r33, r44 -- the universal subtotal-reset rule (v5.25
§17.41) correctly resets the stack at r28, but the rows that
follow are not section-header-shaped (no SUB HEAD pattern, no
anchor-1/anchor-2 trigger context) and arrive at level 2 with
no level-1 or level-0 ancestor on the stack. This is a BoQ-author
data-quality issue (subtotal placed mid-section rather than at
section end) rather than a parser bug -- the BoQ author's intent
cannot be deterministically recovered from the spreadsheet text
alone. Disposition: out of scope for cycle 3 fix queue per
agreement #43. The wizard review pathway (Phase 2c body) surfaces
rootless level-2 PREAMBLEs for user-disambiguation via existing
rootless-row review flags; no parser-layer fix attempted.

---

## Decisions log

Newest at the top.

---

### 2026-05-29 -- Module 1a CLAUDE.md convention codification

Docs commit dbbe7c93 (docs(claude): Module 1a convention codification).

Retroactively codifies four conventions established during Module 1a into root CLAUDE.md:
1. Phase 3 branch convention -- `feature/boq-phase-3` active; `feature/boq-phase-2` frozen at `2e338b36`.
2. Wizard scope discipline principle -- two-path discussion before drafting; default lean is "keep outside wizard if reach extends beyond Upload BoQ".
3. Test fixture pattern for Projects rows -- `now()[:19]` truncation + empty `project_scopes` + `tearDownClass` cleanup.
4. API subdirectory pattern under `api/<feature>/` -- acceptable for sub-area grouping (`api/boq/wizard/`).

Standing practice reaffirmed: every CC prompt going forward explicitly addresses both `boq-upload-plan.md` and `CLAUDE.md` (root + frontend). If any is skipped, the prompt must say why and chat-Claude obtains explicit user consent before issuing.

`frontend/CLAUDE.md` untouched this cycle -- Module 1b (frontend) will land substantive updates there.

---

### 2026-05-29 -- Module 1a -- wizard backend and schema landed (Phase 3 kickoff)

Feat commit 06f38e8d (feat(boq): Module 1a -- wizard backend and schema (Phase 3 kickoff)).

**1. Phase 3 reframe.** Wizard work is Phase 3, branched fresh as `feature/boq-phase-3` from `feature/boq-phase-2` tip 2e338b36 per the "one branch per phase" working agreement. Pre-v5.30 framing called this "Phase 2c body"; that framing is superseded for wizard work. `feature/boq-phase-2` is frozen at 2e338b36 as the parser-stable tip.

**2. Scope reduction during execution.** `create_tendering_project` endpoint and tests dropped. User decision: wizard never creates Projects rows. The picker's "Create new project" path (Module 1b) defers to the existing Nirmaan new-project workflow; that team is adding tendering support independently. Wizard consumes existing Projects rows only. Eliminates the project_city semantic-mismatch hack and the generate_pwm date-placeholder problem in production code.

**3. V1-V8 verification findings.**
- V1: Nirmaan Attachments creation pattern confirmed via `api/custom_pr_api.py:73-79` (frappe.new_doc with project, associated_doctype, associated_docname, attachment_type, attachment).
- V2: Projects has no plain-text `location` field (moot after scope reduction; no Projects rows created by wizard).
- V3: `BOQs.wizard_state` and `sheet_drafts` absent -- confirmed safe to add.
- V4: Work Headers display/autoname field is `work_header_name` (Data, unique=1; `autoname: "field:work_header_name"`).
- V5: `BOQ Node Qty By Area` shape confirmed: `istable: 1`, permissions: [], engine: InnoDB, module: Nirmaan Stack, no autoname (hash default). Mirrored exactly.
- V6: `site_config.json` had no `max_file_size` -- set to 26214400 (25 MB).
- V7: `frappe.enqueue` convention: full dotted path, `queue="long"`, `timeout=600`, user kwarg passed through; worker calls `frappe.set_user(user)`. No `job_name` convention used.
- V8: `publish_realtime` event naming confirmed `{doctype}:{action}` (e.g. `po:new`). Wizard event `boq:wizard_parse_done` follows convention.

**4. User decisions baked in.**
- A1-A4: doctype names (BOQs, BOQ Nodes, BOQ Node Qty By Area, BoQ Sheet Draft) confirmed as-is.
- A5: create_tendering_project dropped (see section 2 above).
- B1: Nirmaan Attachments is a real doctype; creation pattern confirmed.
- B2: max_file_size set to 26214400.
- C1: wizard/ subdir under api/boq/.
- C2: frappe.enqueue for async worker.
- C3: Socket.IO push via publish_realtime.
- D1: no backfill patch for existing BOQs rows.
- D2: BoQ Sheet Draft mirrors BOQ Node Qty By Area shape.
- D3: audit deferred (Nirmaan Versions -- post-Module 1a).
- E1: synthetic_simple.xlsx reused for upload_file worker tests.

**5. Findings hit during execution.**

Finding (a): `Projects.after_insert` (`generate_pwm` hook) crashes on minimal Projects rows -- requires `project_start_date`, `project_end_date` in `"%Y-%m-%d %H:%M:%S"` format AND `project_scopes["scopes"]` as a list. Resolution: scope reduction (section 2) makes this moot for production code. Test fixtures use `now()[:19]` dates + `{"scopes": []}` as standard Frappe testing convention. `generate_pwm` itself untouched per user instruction.

Finding (b): `BOQs.before_insert` already computes version per M1.25 (`COALESCE(MAX(version), 0) + 1` scoped to project+boq_name). Worker's duplicate computation removed; controller is the canonical M1.25 implementation.

Finding (c): `Customers.before_insert` null-GST duplicate-check bug -- treats `null == null` as a duplicate. Phase 1 bug; worked around in wizard tests by not creating Customers rows (none needed after scope reduction). Phase 1 fix tracked as future cleanup.

Finding (d): `frappe.utils.now()` returns microseconds (e.g. "2026-05-29 12:30:45.581159"); `generate_pwm` expects `"%Y-%m-%d %H:%M:%S"`. Fixed in test fixtures via `[:19]` truncation. `add_to_date` similarly truncated. Flagged per A8.

**6. Caveat T disposition.** Structurally on path to retirement once wizard ships per v5.30 decision.

**7. Next.** Module 1b (frontend: sidebar nav, project picker, tendering modal, upload screen, BoQ tab) is the next prompt. New-project workflow modification for tendering support is independent team work (not blocking wizard).

---

### 2026-05-28 -- Bug 23 + Bug 24 LANDED (cycle 4 session 1)

Feat commit 3d5d7122 (feat(boq): Bug 23 + Bug 24 -- LINE_ITEM + NOTE parent_index via level0_ancestor (cluster 4 session 1)).

**Bug 23 -- LINE_ITEM orphans after level=0.** Root cause: the LINE_ITEM default-path code never read level0_ancestor. After a level=0 PREAMBLE (SUB HEAD or anchor-promoted row) clears the stack, direct LINE_ITEM rows had parent_index=None even though level0_ancestor held the SUB HEAD's resolved index.

Fix: in the `if not a2_handled:` block, after `_top_non_none(stack)` returns None, check BUG_23_LINE_ITEM_LEVEL0_ANCESTOR_ENABLED and inherit level0_ancestor as parent. Rule A2 is fully gated: a2_handled=True skips this block, preserving the 7 alorica Rule-A2-rootless cases exactly (deferred to Phase 3+ AI layer per Nitesh's cycle 4 decision).

**Bug 24 -- NOTE parent_index always None.** Root cause: the NOTE branch set attached_to_index correctly for footnote rendering but never set parent_index. All NOTE rows were parent_index=None in the tree-structure path.

Fix: compute note_parent_index alongside attached_to_index. Stack has entry: mirrors preamble_index. Stack empty, level0_ancestor set: note_parent_index=level0_ancestor (NOTE after SUB HEAD gets SUB HEAD as parent). Stack empty, no level0_ancestor: None (sheet start or post-SUBTOTAL). Gated by BUG_24_NOTE_PARENT_INDEX_ENABLED (default True). Only parent_index is gated; attached_to_index logic always runs. NOTE path stays None -- zero-children demotion post-pass confirmed unaffected (path=None rows are skipped in paths_with_descendants build).

+18 tests in test_bug_23_24_parent_fix.py:
  TestBug23LineItemUnit (5), TestBug24NoteUnit (5), TestBug23Toggle (2),
  TestBug24Toggle (2), TestDemotionPostPassUnaffected (1),
  TestBillOfQuantitiesIntegration (2), TestAloricaIntegration (1).
Parser tests 570 -> 588. Zero existing-test calibrations.

Integration findings:
- BoQ ELV: >= 1 LINE_ITEM now parents under a level=0 SUB HEAD (Bug 23). >= 2 NOTEs now have non-None parent_index (Bug 24).
- Alorica 1row: >= 1 LINE_ITEM now parents under a level=0 PREAMBLE (Bug 23). 7 Rule-A2 rootless LINE_ITEMs confirmed still rootless.

Findings #1 (LINE_ITEM orphans after level=0) and #2 (NOTE parent_index) from cycle 3 walkthrough CLOSED.

---

### 2026-05-27 -- Bug 20-ext-v2 LANDED + cycle 3 runner infra (cluster 2 session 5)

Feat commit 78c1b6a1 (feat(boq): Bug 20-ext-v2 - _RE_NUMERIC trailing-zero tolerance).
Feat commit 4a3aedd7 (feat(boq): cycle 3 validation re-run script + 8 locked configs).

**Bug 20-ext-v2.** Root cause: `_RE_NUMERIC = re.compile(r"^\d+(\.0)?$")` at
hierarchy.py:96 accepted only ONE trailing zero. Safron sl_no values "1.00", "2.00",
"10.00" etc. fell through to `_RE_MULTI2`, were classified as `multi_dot_numeric`,
and received level=2. Bug 20-ext's level0_ancestor inheritance only fires at level==1,
so these rows became rootless (parent_index=None). Regression surfaced during cycle 3
cycle 1 validation re-run.

Fix: `(\.0)?` changed to `(\.0+)?`. Trailing zeros are cosmetic Excel number
formatting ("1", "1.0", "1.00" all mean the same semantic level). Conservatively
additive: more strings match as "numeric", none stop matching.

Empirical verification: safron r7/r13/r17/r20/r23/r27/r30 all now level=1 with
parent = r5 (PART-1 anchor, ridx=1). r34/r35/r37 (Bug-19 promoted) also level=1
parent ridx=1, promoted_from_line_item preserved. r50 ("DX 1.00") level=1
parent=None (correct -- SUBTOTAL_MARKER at r48 resets level0_ancestor per spec).

+5 tests in test_bug_20_ext_v2_trailing_zero.py:
  TestCategorizeTrailingZero (4 unit), TestSafronR7HierarchyCorrect (1 integration).
Parser tests 565 -> 570. Zero existing-test calibrations.

**Cycle 3 runner infra.** cycle_3_rerun.py -- CLI runner for replaying the 8 locked
fixtures with --configs-dir / --fixtures-dir / --output-dir / --projects. Emits
per-project JSON + CSV + _run_summary.json. cycle_3_configs/ -- 8 hand-generated
MappingConfig snapshots (multi_v1 dropped per v5.26a). Used in cycle 1 (safron +
alorica_1row verification) and this session's post-fix verification. Sec 9 #110 NEW + CLOSED.

---

### 2026-05-27 -- Bug 19 + Bug 19-ext LANDED (cluster 2 session 4)

Feat commit fbc1d845 (feat(boq): Bug 19 + Bug 19-ext LANDED -- cluster 2 session 4
(sec 9 #106 + #107)).

**Bug 19 priced-preamble promotion.** New `_apply_priced_preamble_promotion` post-pass
in classifier.py (Step 3c in orchestrator, after Bug 20 anchors). Backward-only
window scan: for each LINE_ITEM with a non-None sl_no, scans backward <=20 rows
to find PREAMBLE rows with the same pattern_signature and contiguous first_numeric_token
sequence. When a contiguous sequence of length >= 2 is found, promotes all members
(including the current row) to PREAMBLE via `promoted_from_line_item = True`.
Adjacent-extension rule: a new LINE_ITEM extending an existing promoted sequence also
promotes. Gated by `BUG_19_PRICED_PREAMBLE_PROMOTION_ENABLED` toggle (default True).

**Bug 19-ext reparenting.** When a promoted PREAMBLE (level computed as numeric)
has no stack parent, a backward scan through resolved rows finds the most recent
PREAMBLE at level-1 with matching (pattern_signature, first_numeric_token). If found,
reparents to that row rather than inheriting level0_ancestor. Gated by
`BUG_19_EXT_PREAMBLE_REPARENT_ENABLED` toggle (default True).

**Zero-children demotion guard.** `_apply_zero_children_preamble_demotion_post_pass`
now skips rows with `promoted_from_line_item=True` to avoid demoting them after
promotion.

Canonical verification: safron r34/r35/r37 (sl="8.00"/"9.00"/"10.00") promoted
from LINE_ITEM to PREAMBLE; Inovalon r22 parents under r6 via Bug 19-ext reparent.
2 snitch false positives (semantically harmless, discriminator deferred).

+13 tests in test_priced_preamble_promotion.py. Parser tests 552 -> 565.

---

### 2026-05-26 -- Bug 17 reader auto-trim approach chosen, LANDED v5.27

[DECISION] Approach (a) sub-variant: reader.iter_rows() takes optional
text_role_columns: set[str] | None parameter (column letters, not role
names). Orchestrator derives the set from SheetConfig.column_role_map by
filtering cr.role in TEXT_ROLE_ROLES frozenset, passes to iter_rows() at
data-row collection time. Header-row iter_rows() calls are NOT passed the
param (formatting header text is not needed).

_format_numeric_as_displayed() helper: None->None, bool->str(v), str->
passthrough, int/float: if _PRECISION_FMT_RE (re.compile(r"0\.(0+)"))
matches number_format -> format(v, ".Nf"); else str(round(v, 10)).
Covered-cell path extended to carry origin_number_format in the 5-tuple.
Bug 13 error-literal normalization runs first, Bug 17 formatting second.

Single feat commit 30b6045b. Pre-flight findings: alorica A31/A33
numFmtId=0 ("General") -> round-to-10 removes noise; alorica A45/A52
numFmtId=2 ("0.00") -> format(".2f") corrects; sg_hvac A39 numFmtId=166
(complex accounting format contains "0.00" substring) -> regex matches,
formats 1.1 as "1.10" (acceptable, spec said no-op is also acceptable).
+21 tests (502->523): 14 unit (TestFormatNumericAsDisplayed) + 2 backward-
compat (TestIterRowsTextRoleColumns) + 5 integration (TestBug17AloricaIntegration
-- alorica "low side" sheet, header_row=6). Closes sec 9 #__ (Bug 17).
Previous commit: 68cfc57d (Bug 16).

---

### 2026-05-27 -- Bug 18 LANDED v5.28 (cluster 1 session 4)

Feat commit 41a86cd9 (feat(boq): Bug 18 -- reader merge-propagation
blanking for text-role columns).

[DECISION] Bug 18 implemented via path (a): reader-side suppression
of propagated values for text-role columns, reusing Bug 17 plumbing.
Pre-implementation verification confirmed safron r41 is A41:G41 merge
with text "PART- 2 INSULATION" (space after dash). Architecture path
(a) chosen per chat-Claude 2026-05-26 architectural discussion; rationale:
Bug 17 consistency + zero new parameters + no orchestrator/classifier
changes. Path (b) orchestrator-side post-pass not chosen (more plumbing,
separate pass). Path (c) classifier-side not chosen (harder to maintain
cross-field merge awareness in classifier context).

Fix: BUG_18_MERGE_PROPAGATION_BLANK_ENABLED toggle (default True) +
suppression in iter_rows() after Bug 17 block: covered is not None AND
col_letter in text_role_columns -> computed_value = None. Origin cell
retains banner text. Non-text-role covered cells (qty, rate, amount)
NOT suppressed -- area-header merge propagation unaffected.

+7 tests (523->530): 5 synthetic unit + 2 safron integration. 0 existing-
test calibrations. Cluster 1 complete (Bug 16 + Bug 17 + Bug 18 landed).

[OVERRIDE #43 v5.28 cycle] Agreement #43 hard cap extended from 7 to 8
working sessions for cycle 3 fix batch. Risk accepted: any subsequent
extension request faces a weakened precedent bar; future cap discipline
depends on holding the line at 8. Override accepted by Nitesh at v5.27
to v5.28 transition. Logged per agreement #38 override mechanics.

---

### 2026-05-26 -- Bug 16 reframed to in-classifier flow, LANDED v5.27

[DECISION] Bug 16 reframed from post-pass to in-classifier flow,
landed v5.27. The v5.26 spec proposed a post-pass demotion of
unit-less LINE_ITEMs to PREAMBLE/NOTE/SPACER. User reframed the
spec mid-session to a hard classifier invariant: no row can be
LINE_ITEM without a real (non-junk) unit. Two clauses gated by
single toggle. Three field-specific blank-or-junk helpers using
deterministic alphabetic/alphanumeric tests (no maintained unit
allowlist). Cross-fixture Phase 0 diagnostic verified empirically
across 5 fixtures before implementation. Calibrations to 12
existing tests landed in same commit (8 inline rows gained units,
2 fixtures regenerated, 2 count assertions updated). Commit
68cfc57d. Closes sec 9 #103.

---

### 2026-05-27 -- Bug 20 anchor 3 LANDED (cluster 2 session 3)

Feat commit 73c9db99 (feat(boq): Bug 20 anchor 3 -- sub-section NOTE promotion (cluster 2 session 3)).

**`_promote_sub_section_header(row)`** — new helper in classifier.py, sets
`classification = PREAMBLE` + `preamble_level_override = 1` in-place.

**Anchor 3 block** added to `_apply_section_header_note_promotion_post_pass` (after anchors 1+2):
for each row where `preamble_level_override == 0` (set by anchors 1/2 in the same pass), skips
spacers and promotes the first non-SPACER NOTE candidate to PREAMBLE via `_promote_sub_section_header`.
Trigger is `preamble_level_override == 0` — SUB HEAD rows have `preamble_level_override = None`
at post-pass time (they receive level=0 via `_determine_preamble_level` inside `resolve_hierarchy`,
which runs AFTER the post-pass) and do NOT trigger anchor 3.

**Reading B enforced structurally:** anchor-3 promotions set `preamble_level_override = 1`, not 0,
so they can never themselves satisfy the trigger condition; no chaining is possible.

**Parenting:** safron r43 ACCOUSTIC INSULATION → PREAMBLE level=1, parented under r41 PART-2
INSULATION (level=0) via the existing `level0_ancestor` mechanism in `resolve_hierarchy` (added
in Bug 20-ext, cluster 2 session 2). No new hierarchy code required.

**Tests:** +5 TestAnchor3 synthetic unit tests (test_anchor3_fires_after_anchor1_promoted_preamble_with_spacer,
test_anchor3_fires_after_anchor2_promoted_preamble_no_spacer, test_anchor3_skips_spacers,
test_anchor3_no_fire_when_next_row_already_preamble, test_anchor3_no_fire_for_non_override_preamble).
Safron r43 deferral test rewritten as `test_safron_anchor3_r43_promoted_to_preamble_level1`
(asserts classification=PREAMBLE, level=1, parent=r41, "ACCOUSTIC INSULATION" in text).
Parser tests: 547 → 552. 0 existing-test calibrations.

Sec 9 #108 fully CLOSED (anchors 1+2 landed session 2; anchor 3 landed session 3).
Cluster 2 session 4 next: Bug 19 + 19-ext.

---

### 2026-05-27 -- Bug 20 test coverage correction (safron header_row 5 -> 3)

Test-only fix. No source code changed. No parser test count change (547 before and after).

`test_bug_20_section_header_promotion.py` `_SAFRON_HEADER_ROW` constant corrected from 5 to 3
(safron's actual column-title row). With header_row=5, the parser treated r5 itself ("PART-1 AIR
DISTRIBUTION SYSTEM" section banner) as the header row and excluded it from the data stream.
Anchor 1 silently skipped; the anchor-1 safron test was reframed to assert the skip as
expected behavior. Both were wrong. With header_row=3, r5 is the first non-SPACER data row
and is a NOTE -- anchor 1 fires correctly, promoting it to PREAMBLE level=0.

Test `test_safron_anchor1_skips_when_first_row_already_preamble` renamed and rewritten as
`test_safron_anchor1_promotes_r5_part1_to_preamble_level0`. Verifies: r5 in resolved output,
classification=PREAMBLE, level=0, parent_index=None, "PART-1" in sl_no_value/description.

Anchor-2 (r41) and anchor-3 (r43) tests unaffected -- both rows are well past r3 header
boundary and remain correct.

**Caveat JJ (NEW v5.28)** -- Bug 17 + Bug 18 safron test configs use header_row=5; actual is 3.
Both tests pass by coincidence (Bug 18 canonical case is r41, Bug 17 canonical cases are specific
cell values -- both well past the header boundary). Fix during housekeeping or when next touching
those tests. DO NOT fix in this commit -- scope limited to test_bug_20_section_header_promotion.py.

---

### 2026-05-27 -- Bug 20 anchors 1+2 + Bug 20-ext LANDED (cluster 2 session 2)

Feat commit 4f85ec3e (feat(boq): Bug 20 anchors 1+2 + Bug 20-ext level-0 -- cluster 2
session 2 (sec 9 #108)).

**Bug 20 anchors 1+2.** New `_apply_section_header_note_promotion_post_pass` post-pass
in classifier.py. Three key components:
- `_is_section_header_candidate`: accepts NOTE rows with non-empty description OR
  sl_no that is not a section-number code (`_SECTION_NUMBER_RE` rejects '1.0', 'A.', 'II.',
  'PART-A'). Handles Bug 18 merge-origin case where description=None but sl_no carries text.
- `_first_non_spacer_idx`: skip-spacers helper.
- Anchor 1: first non-SPACER in classified_rows list (header already excluded by orchestrator).
  Promote if `_is_section_header_candidate`.
- Anchor 2: first non-SPACER after each SUBTOTAL_MARKER. Same promotion guard.
- Anchor 3: LANDED cluster 2 session 3 (feat 73c9db99).
- `BUG_20_SECTION_HEADER_PROMOTION_ENABLED` toggle (default True).
- `preamble_level_override: int | None = None` field added to ClassifiedRow so the post-pass
  can inject level=0 without re-running `_determine_preamble_level`.
- Wired in orchestrator.py Step 3b between scoring and resolve_hierarchy.

**Bug 20-ext.** `_determine_preamble_level` SUB HEAD branch returns level=0 instead of 1,
gated by `BUG_20_EXT_SUB_HEAD_LEVEL_ZERO_ENABLED` (default True). resolve_hierarchy gains
`level0_ancestor: int | None` tracking: level=0 PREAMBLEs clear the stack and record their
idx as `level0_ancestor`. Level=1 PREAMBLEs with empty stack use `level0_ancestor` as parent
(instead of None). SUBTOTAL_MARKER resets `level0_ancestor = None`.

**Fixture results:**
- safron Low Side Works: anchor 1 skips (first non-SPACER r7 is already PREAMBLE, not NOTE).
  Anchor 2 fires on r41 (PART-2 INSULATION, Bug 18 NOTE via sl_no) → PREAMBLE level=0.
  r43 (ACCOUSTIC INSULATION) promoted to PREAMBLE level=1 by anchor 3 (cluster 2 session 3).
- BoQ ELV: all 21 SUB HEAD rows now level=0 (was 1). sl=1.0 at r6 correctly parents under
  preceding level=0 SUB HEAD A via level0_ancestor. A2-reframed ('2.0' → sibling) now
  resolves to SUB HEAD A parent instead of None.

**Tests (cluster 2 session 2).** 17 new tests in test_bug_20_section_header_promotion.py:
  TestAnchor1 (5), TestAnchor2 (4), TestToggles (2), TestSafronIntegration (3),
  TestBoqElvBug20Ext (3). Note: test_safron_anchor1 reframed to verify anchor 1 silently
  skips when first non-SPACER is already PREAMBLE — the safron sheet starts with PREAMBLE
  sl='1.00', not a NOTE banner. (Corrected to header_row=3 in coverage correction commit cf4f30a3.)
7 calibrations in test_sub_head_and_subtotal_reset.py:
  3 unit-level (level=1→0), 2 integration (level=1→0), 1 all-SUB-HEADs (level=1→0 in subTest),
  1 numeric-preamble-parent (None→SUB HEAD B via assertIsNotNone + _is_sub_head_marker check).
1 calibration in test_approach_a_rules.py:
  test_boq_elv_a2_first_firing_root_level: parent_index None→SUB HEAD A (A2 now inherits
  level0_ancestor parent chain). _is_sub_head_marker added to hierarchy imports.
Parser tests: 530 → 547 (12-module full count, session 2).

**Tests (cluster 2 session 3 — anchor 3).** +5 TestAnchor3 unit tests; safron r43 deferral
test rewritten as test_safron_anchor3_r43_promoted_to_preamble_level1 (asserts PREAMBLE level=1,
parent=r41). Parser tests: 547 → 552 (12-module full count, session 3).

Sec 9 #108 CLOSED. Agreement #43 cap at 8 sessions (override logged v5.28).
Cluster 2 session 4 next: Bug 19 + 19-ext.

---

### 2026-05-25 -- Bug 22 toggle added (session 1.5)

Feat commit a2ce8a0d (feat(boq): Bug 22 toggle -- BUG_22_COLLAPSE_ENABLED
module constant). Defensive-safety addition layered on top of Bug 22
LANDED (feat 4e5561d3 + docs 55aafc4a). Default True (no behavior change
at default). 3 new tests in TestPatternSignatureBug22 covering toggle ON
default + toggle OFF restoration of pre-Bug-22 per-char signature + the
same-first-numeric-token edge case (1.10 / 1.01 / 1.1 -- same signature
post-fix, same first_numeric_token, A2-reframed will not fire). Parser
tests 487 -> 490 OK. Mirrors v5.25 approach_a_enabled precedent in intent.
Off the 7-session cycle 3 budget per agreement #43 framing -- defensive-
safety addition, not a new fix in the queue. Stale canonical command
confirmed absent from plan-doc + CLAUDE.md (not a repo-file issue). Cluster
2 session 3 next: Bug 19 + 19-ext.

---

### 2026-05-25 -- Bug 22 LANDED (cluster 2 session 1)

Feat commit 4e5561d3 (feat(boq): Bug 22 -- token-based pattern_signature).
Adds `re.sub(r"D+", "D", signature)` post-step in pattern_signature in
hierarchy.py, collapsing consecutive digit runs to a single "D" token.
Strictly additive: only previously-blocked Rule A2-reframed firings now
fire; no existing firings change. 1 unit-test recalibration in
test_approach_a_rules.py; 3 new TestPatternSignatureBug22 tests in
test_hierarchy.py. Parser tests 484 -> 487 OK. Session used corrected
9-module test command (test_approach_a_rules + test_sub_head_and_subtotal_reset
added; tests.test_config / tests.test_reader corrected to root-level
test_config / test_reader per memory note). Sec 9 #110 CLOSED. Agreement
#43 (bounded fix cycle) + agreement #9 (two-commit shape) in effect.
Integration-level impact (snitch r48/r50 re-parenting) deferred to
session 7 cycle 3 validation re-run.

---

### 2026-05-25 -- v5.26 housekeeping cycle (Group B gaps + Caveat D/D-1)

Docs-only commit (per agreement #42). No parser source touched;
parser tests stable at 484. Lands seven documentation refinements
identified during v5.26 review pass:

- **Caveat D resolved**: plan-doc Last-updated line refreshed to
  2026-05-25.
- **Caveat D-1 resolved**: CLAUDE.md Last-updated line refreshed
  to 2026-05-25.
- **Bug 17 spec refinement (§17.44)**: Inovalon r26 cosmetic float
  passthrough explicitly excluded from Bug 17 scope; text-role-
  columns-only boundary clarified.
- **Bug 19 / 19-ext spec refinement (§17.44)**: search window
  spec landed -- +/- 20 rows symmetric, minimum-count threshold
  (>= 3 PREAMBLEs in window or don't fire), asymmetric tunable
  constants held in reserve for post-land calibration.
- **Bug 20 anchor 3 framing (§17.44)**: Reading B locked (single-
  step recursive, no chaining); data-loss-criticality noted
  (§22.11 NOTE-attachment captures content even if anchor 3
  mis-promotes); deferrable if empirical yield too low.
- **Bug 20-ext keystone observation (§17.44)**: text-signature
  vs numeric-signature non-equivalence makes Bug 20-ext the
  keystone fix for BoQ-style structures; Bug 19/19-ext
  complementary but not substitutive.
- **Inovalon subtotal-reset-and-continue disposition (§17.44)**:
  r28 -> r30/r33/r44 rootless level-2 PREAMBLEs out-of-scope per
  agreement #43; wizard review pathway handles via existing
  rootless-row flags.

No working agreement changes. No phase exit criterion change
(E5 stands). No status flips. Track 2 (handover doc + Caveat C
+ §12 + §13 refresh) follows separately via chat-Claude file-
upload-and-edit workflow per agreement #35.

---

### 2026-05-25 -- Cycle 3 deep dive + boundary-setting + 9-fix queue

**[DECISION] Working agreement #43 codified:** "Parser-fix work is bounded.
One round of deterministic fixes per identified-bug-batch + one validation
cycle. New bugs surfacing post-validation go to Phase 3+ AI resolution
layer, unless something strikingly deterministic and high-impact emerges.
Handwritten BoQs have infinite error combinations; we accept parser
limitations and rely on AI for residual disambiguation." Extends agreements
#34 (cycle termination) and #40 (no fuzzy parser rules) by bounding the
number of fix cycles per bug-batch to one + validation.

**[DECISION] Phase exit criterion E4 (v5.25) SUPERSEDED by E5 (v5.26):**
"All 9 deterministic fixes from cycle 3 deep dive landed AND cycle 3 re-run
validates against the 8 fixtures (multi_v1 dropped) AND activity 2b-3
schema migration started." Three binary, measurable components. Replaces
E4's "Phase 2c body sub-phase scoped or first sub-phase started OR Phase 2c
officially closed and wizard phase started, with explicit rationale."

**[DECISION] Cycle 3 fix-cycle time-box:** 5-7 working sessions total for all
9 deterministic fixes + cycle 3 validation re-run, batched implementation
(~4 fixes per cluster + 1 validation pass). Hard cap at 7 sessions; if
exceeded, accept what landed and move to activity 2b-3.

**[DECISION] multi_area_merged_header_v1 fixture DROPPED from cycle 3 /
wizard-design reference set.** Confirmed as synthetic stress test (extra
blank column inserted at position E into BoQ source xlsx, declared as
Area 1 in config, original qty column re-declared as Area 2). Byte-identical
classification distributions with bill_of_quantities because classification
doesn't depend on which column holds qty. Keep as test-suite fixture for
multi-area regression coverage; remove from cycle 3 reference set.

**[DECISION] AI-upfronting for Phase 2c body wizard scoping: NOT NEEDED.**
9 deterministic parser fixes cover the bulk of classification and hierarchy
issues observed across 7 fixtures. Wizard scoping work proceeds without AI
dependency. AI layer scoped to Phase 3+ for residual handwritten-BoQ
disambiguation per agreement #43.

**[DECISION] Bug 12 (sec 9 #88) disposition SPLIT v5.26:** deterministic portion
(section-header NOTEs detectable via positional anchors) goes to FIX QUEUE
as Bug 20 anchors 1-3 + Bug 20-ext level-0. Residual (Inovalon mid-section
uppercase NOTE clusters at r36-r40 with no positional anchor) stays Phase 3+
AI per agreement #43. Bug 14 (letter-suffix cosmetic), Bug 15 (sl_no semantic
repeats), and LINE_ITEM-as-missing-ancestor (alorica r35->r37) all stay
Phase 3+ AI; no further parser-layer attempts.

**[DECISION] Checklist C audit at v5.26 close -- all 7 items dispositioned:**
C1 PASS-with-tightening (E4->E5), C2 PASS at 5-item ceiling, C3 PASS
(power-user framing), C4 PASS (declarative wizard Option 3b confirmed),
C5 PASS (cycle 3 done, next check in E5), C6 PASS-with-time-box (5-7
sessions), C7 PASS (wizard spec exists, deep dive validated mapping;
Bug 17 + Bug 18 layering notes flagged for fix-prompt drafting time).

---

### 2026-05-23 -- Bug 11 closure recognition (sec 9 #87 CLOSED v5.25 via A1+A2 land)

**Context.** During v5.25 housekeeping preparation review, the user identified that Bug 11a +
Bug 11b (sec 9 #87, PARKED v5.22 pending deep rule review) were structurally resolved by Rule A1
+ Rule A2-reframed landing (feat 8f960a2b, sec 9 #99, §17.40). The connection was not recognized
in the A1+A2 land docs commit and is captured here post-hoc.

**Bug 11a -> Rule A2-reframed.** Canonical Bug 11a case ("1.0 PREAMBLE + 2.0 LINE_ITEM with qty
parents under 1.0 instead of siblinging") matches Rule A2-reframed's trigger condition (same
pattern_signature + different first_numeric_token + both non-None) and action (attach to
stack-top's parent). Empirical: 27 A2 firings in Snitch + 31 A2 firings in BoQ ELV (sec 9 #99
audit) are all Bug 11a cases, all resolved post-land.

**Bug 11b -> Rule A1.** Canonical Bug 11b case ("a/b/c letter-suffix children chain via
stack_depth+1") matches Rule A1's trigger (all-lowercase sl_no) and action (scan stack for
non-lowercase ancestor, return anchor.level + 1). Empirical: 3 A1 firings in Snitch (rows
458/475/491, sl_no b/c/d) -- pre-A1 level 5/6/7 cascade, post-A1 all at level 4 siblings. The
§17.9 lowercase-letter cascade (root cause of Bug 11b) is structurally resolved.

**Implication for working agreement #40.** The §14 working agreement #40 text already lists
A1/A2-reframed (sec 9 #99) as one of the four closing examples of the Bug 13
deterministic-unambiguous bar. Bug 11 closure reinforces this -- the parser-layer deterministic
fixes have closed two multi-fixture hierarchy bugs (Bug 11a + 11b) plus the BoQ-ELV-specific
SUB HEAD fix plus the universal subtotal-reset. No change to working agreement #40 wording.

**No code changes, no test runs.** Docs-only commit. CLAUDE.md + boq-upload-plan.md updated.
v5.22 Bug 11 commits remain reverted; their 47 tests are NOT restored (classifier-layer logic
superseded by resolver-layer A1+A2).

**Agreements cited.** None new. This is a single docs commit, not a two-commit shape.

---

### 2026-05-23 -- SUB HEAD + universal subtotal-reset land (sec 9 #100 + #101 CLOSED, Phase 2c bug-fix cycle CLOSED)

**Context.** Following A1+A2-reframed landing (feat 8f960a2b) and the 6-fixture cross-corpus
Bug 12 diagnostic (initial Bug12 dump + subtotal-reset audit), two deterministic fixes were frozen.

**Fix 1 -- SUB HEAD pattern detection.** _SUB_HEAD_RE + _is_sub_head_marker() in hierarchy.py.
Pattern /^\s*sub\s+head\s+[a-z][0-9]?\s*$/i tolerates embedded newlines. SUB HEAD branch in
_determine_preamble_level returns level=1 unconditionally. 1-fixture-specific (BoQ ELV only)
but harmless to non-matching fixtures.

**Fix 2 -- Universal subtotal-reset.** resolve_hierarchy now calls stack.clear() on every
SUBTOTAL_MARKER. _MID_SHEET_RESET_RE preserved (deprecated, audit-script-only) -- deprecation
comment added at definition site. Empirically validated against 6 fixtures (46 subtotal markers,
zero mid-section cases).

**Working agreement #40 codified** in §14: parser-layer fixes must meet the Bug 13
deterministic-unambiguous bar; beyond the four closing examples (Bug 13, A1/A2-reframed,
SUB HEAD, universal subtotal-reset), structural fixes go to Phase 3+ AI layer.

**Bug 12 (Inovalon NOTE-as-header) parked** in §17.42.
**Bug 15 (SG HVAC priced-sub-section-header) parked** in §17.43.

**Side-finding.** classifier_audit_output.json baseline detected stale during Step 9 regression
check -- the committed file is from a 24-fixture corpus, the current corpus has 28 fixtures.
Proportional stat growth (classified +20.6%, unclassified +19.5%, unique +1.7%) confirms no
classifier behavior change from this sub-phase's hierarchy.py edits. Filed as Caveat S for v5.25
housekeeping refresh chore (not bundled here per agreement #42).

**PHASE 2c BUG-FIX CYCLE CLOSED.** Phase 2c body (DB commit + version cascade) is next.

**Agreements cited.** #9 two-commit shape. #40 codification.

---

### 2026-05-23 - Approach A-reframed land (Rule A1 + A2-reframed, sec 9 #99 CLOSED)

**Context.** Following the Approach A-reframed audit (feat 16647958 + docs 43c14fcc, §17.39)
and user sample review, misfires were confirmed as low and exit criterion E3 was met.

**What landed.** Rule A1 + Rule A2-reframed landed in hierarchy.py as production code
(feat 8f960a2b + docs see git log).

Rule A1 fires in _determine_preamble_level when sl_no (after rstrip('.,):;]')) consists
ENTIRELY of lowercase characters (a, b., iv.). Scans stack reversed for first non-lowercase
ancestor; returns anchor.level + 1. F5 tightening: trigger uses all(c == 'l' for c in
sig_stripped) NOT startswith('l') -- rejects mixed codes like a1 or custom-code-xyz. The
broad trigger caused a pre-commit test failure that prompted the tightening.

Rule A2-reframed fires at LINE_ITEM attachment step when LINE_ITEM sl_no has same
pattern_signature as stack-top PREAMBLE AND a different first_numeric_token (both
non-None). Attaches LINE_ITEM to stack-top's parent (sibling, not child relationship).

Sec 7.29 interaction documented: A2 reparents all 5 children of PREAMBLE "2.0" (Snitch
xlsx ~502) to section header G. Zero-children post-pass demotes "2.0" to LINE_ITEM.
test_snitch_row_500_demoted_to_line_item_post_a2 captures the final state.

snitch_electrical_expected.json regenerated: LINE_ITEM 176->177, PREAMBLE 43->42,
preamble_level_transitions 7->4 entries. test_approach_a_rules.py: 24 new tests.
Parser tests: 440 -> 464.

**Working agreement #40 deferred.** The landing proceeded (low misfires). However,
working agreement #40 ("no more parser fuzzy rules") is NOT codified in this docs cycle.
It is deferred pending Bug 12 diagnostic on 2 fixtures (the fixtures referenced in §17.28
and §17.38 as containing the "SUB HEAD A" Bug 12 candidate). Once that diagnostic confirms
or rules out Approach A interaction with Bug 12, working agreement #40 disposition will
be revisited.

**Agreements cited.** #9 two-commit shape (feat 8f960a2b + docs see git log).

---

### 2026-05-23 - Approach A-reframed audit script (sec 9 #99 gating, feat 16647958)

**Context.** The Bill Of Quantities rows 4-22 audit (feat 3b0790f0) confirmed the known
Approach A limitation: Rule A2 cannot fix LINE_ITEM parenting (Bug 11a) because it only
fires on PREAMBLE rows in _determine_preamble_level. A redesigned Rule A2-reframed
targets the LINE_ITEM attachment step instead, and extends the audit to the full sheets.

**Method.** `approach_a_reframed_audit.py` runs two pipelines on each of two fixtures.
Both apply sec 7.28 (so the diff isolates A1+A2 effect only). Pipeline X uses production
resolve_hierarchy(). Pipeline Y uses a custom inline resolver applying Rule A1 (PREAMBLE
level determination: pattern_signature starts with 'l' triggers stack scan for numbered
ancestor; level = anchor.level + 1, fallback to stack_depth+1) and Rule A2-reframed
(LINE_ITEM attachment: stack top only; if signature(LINE_ITEM.sl_no) == signature(top.sl_no)
AND first_numeric_token differs AND both non-None, attach to top.parent). Diff compares
(parent_sl_no, level) per row. rule_fired tagged as A1/A2/A1+A2/indirect.

**Aggregate findings:**

Snitch '6. Electrical' (521 rows total):
  - Rule A1 direct: 3 (PREAMBLE rows b/c/d at xlsx rows 458/475/491, cascade level fix)
  - Rule A2 direct: 27 (LINE_ITEM rows e.g. 2.0/4.0-9.0 under section PREAMBLEs)
  - A1+A2 combined: 0
  - Indirect-effect: 0

Bill of Quantities ELECTRICAL & ELV BOQ (1186 rows total):
  - Rule A1 direct: 0 (no lowercase-letter cascade rows in full sheet)
  - Rule A2 direct: 31 (LINE_ITEM rows e.g. 2.0/3.0 from under 1.0 preamble to root)
  - A1+A2 combined: 0
  - Indirect-effect: 0

**Next step.** User reviews sample first-20 per fixture in diagnostic_snapshots/.
Decision criterion: low misfire rate => land A1+A2 next sub-phase (sec 9 #99 closed);
appreciable misfires => park + codify "no more parser fuzzy rules" as working agreement #40.
Gating exit criterion E3 (closing Phase 2c bug-fix cycle).

**Agreements cited.** #9 two-commit shape (feat 16647958 + docs 43c14fcc).

---

### 2026-05-23 - Bill Of Quantities Electrical & ELV rows 4-22 audit (feat 3b0790f0)

**Context.** Following the §7.28 orphan-children audit (feat 8a126846) and Bug 11 parking,
the strategic question remains: do Bug 11a (numeric peer sibling gap) and Bug 11b
(letter-sequence cascade) affect the Bill of Quantities fixture, and does proposed
Approach A (Rule A1 + Rule A2) produce meaningfully different hierarchy output?

**Method.** `boq_electrical_elv_rows_4_22_audit.py` replicates parse_boq through
resolve_hierarchy for ELECTRICAL & ELV BOQ sheet. Two pipelines run side-by-side:
Pipeline X (production + §7.28); Pipeline Y (inline Approach A resolver, §7.28 skipped).
Approach A: Rule A1 -- for lowercase-letter sl_no, scan stack for non-lowercase ancestor
and set level = anchor.level + 1 (fixes cascade); Rule A2 -- after standard level chain,
check pattern signature match on stack and set level = matching entry's level (sibling fix).

**Aggregate findings (ELECTRICAL & ELV BOQ, rows 4-22):**

- Rows in range with at least one column difference: 0/19
- Rule A1 fires in range: 0 rows (no lowercase-letter cascade rows in range)
- Rule A2 fires in range: 0 rows (no numeric-peer PREAMBLE rows in range)
- Bug 12 candidates (current pipeline): 1 (row 4, "SUB HEAD A", level 1)
- Bug 12 candidates (Approach A): 1 (same)

**Interpretation.** Rows 4-22 contain no lowercase-letter sub-items -- the range covers
chapter headings (SUB HEAD A), numeric PREAMBLEs (1.0, 4.0), and LINE_ITEMs (2.0, 3.0,
1.1, 4.1-4.8). Bug 11a is visible via parent_sl_no: rows 9 (2.0) and 11 (3.0) are
parented under 1.0 instead of being siblings -- but both are LINE_ITEMs (have qty values),
so Rule A2 cannot correct them (Rule A2 only fires on rows going through
_determine_preamble_level). The Approach A limitation footer documents this. Bug 11b does
not fire in this range. The strategic decision to defer Bug 11+12 fix work to the Phase 3+
AI review layer was made in chat this session but has not yet been codified as a numbered
working agreement.

**Agreements cited.** #9 two-commit shape (feat 3b0790f0 + docs this commit).

---

### 2026-05-23 - Bug 13 - Excel error literals normalization at reader.py (feat 5ff93064)

**Context.** Excel stores formula errors as string literals when read by openpyxl in
data_only=True mode. Seven error values (#REF!, #VALUE!, #NAME?, #DIV/0!, #NULL!, #N/A,
#NUM!) were flowing to the classifier as text strings. On real fixtures, this caused
rows containing only error cells to be classified as content (LINE_ITEM/PREAMBLE)
rather than treated as blank. Sec 9 #89 tracked this as Bug 13.

**Fix.** Added EXCEL_ERROR_LITERALS frozenset and _is_excel_error() helper to reader.py
(public module-level so they are importable by tests). The check fires in iter_rows() at
the single point where computed_value is finalized, before CellInfo construction, for
both covered and non-covered cells. Whitespace-tolerant, case-insensitive comparison.

**Tests.** 6 new tests in TestExcelErrorLiterals in test_reader.py:
- test_is_excel_error_true_all_seven_literals
- test_is_excel_error_whitespace_and_case_tolerance
- test_is_excel_error_false_for_none_empty_numeric_normal_text
- test_is_excel_error_false_for_substring (partial match does not fire)
- test_reader_normalizes_error_literal_cell_to_none (integration: temp xlsx)
- test_reader_blank_row_detection_not_confused_by_error_cells (RawRow.is_blank())

**Audit impact.** classifier_audit.py stats flat before/after (no audit regression).
No integration test for v2 Elec fixture -- not present in committed corpus.

**Agreements cited.** #9 two-commit shape (feat 5ff93064 + docs this commit).

---

### 2026-05-23 - §7.28 orphan-children audit — read-only diagnostic (feat 8a126846)

**Context.** §7.28 (`_apply_unit_based_demotion_post_pass`) demotes PREAMBLE rows
that carry a unit matching any LINE_ITEM unit on the same sheet (qty=None criterion).
Question: how many of the ~82 Snitch '6. Electrical' target rows have descendants in
the resolved tree that fall OUTSIDE the §7.28 target set — i.e. descendants that would
lose their parent if §7.28 demoted without re-parenting?

**Method.** `unit_demotion_orphan_audit.py` replicates the parse_boq pipeline through
resolve_hierarchy, intentionally skipping §7.28. Target set identified using the exact
§7.28 criteria (PREAMBLE + qty=None + unit in LINE_ITEM unit set, case-sensitive).
Descendants split into Bucket A (also in target set — cascade-collapse) and Bucket B
(not in target set — real-orphan candidates).

**Aggregate findings (Snitch '6. Electrical'):**

- Total §7.28 target rows:                82
- Target rows with zero real orphans:     35  (42.7%)
- Target rows with >=1 real orphan:       47  (57.3%)
- Sum of real-orphan descendants:         196
- Max real-orphan count on a single row:  9

**Bucket B distribution:**

- 0 orphans: 35 rows
- 1 orphan:   8 rows
- 2 orphans: 14 rows
- 3-5 orphans: 8 rows
- 6-10 orphans: 17 rows
- 11+ orphans: 0 rows

**Interpretation.** The majority (57.3%) of §7.28 targets have at least one real-orphan
descendant. The 196 real-orphan descendants are primarily LINE_ITEM rows (cable variants,
socket types) that are direct children of the target PREAMBLEs in the letter-sequence
cascade (§17.9 / Bug 11b). Blanket §7.28 demotion without re-parenting would orphan these
rows. This finding informs the "no auto-demote/promote of parented PREAMBLE" rule decision
pending Phase 3+ review. No code change. No test change.

**Agreements cited.** #9 two-commit shape (feat 8a126846 + docs this commit).

---

### 2026-05-23 - Bug 11 parking — post-diagnostic revert + rule-review capture

**Context.** Bug 11 (sec 9 #87): pattern-consistency mismatch in PREAMBLE vs LINE_ITEM
was implemented as an orchestrator post-pass in feat fb89bf44 (docs f9bd1e70). A
post-ship read-only diagnostic on Snitch's depth-1 lowercase-letter rows (2026-05-22)
revealed the original framing was incorrect.

**Diagnostic finding.** 124/124 depth-1 lowercase-letter ('l' sig group) rows in
Snitch '6. Electrical' are genuine enumerated sub-items (cable variants, socket types,
conduit sizes under numbered section PREAMBLEs like 1.0/2.0/3.0). Spec's assumed
depth-≤1 auto-promote reclassifies all 124 as PREAMBLE; §7.29 back-demotes 9,
netting −95 LINE_ITEMs regression with no correctness gain.

**Root cause reframing.** Bug 11 is a hierarchy RESOLVER parenting problem:
- 11a (numeric peer gap): 1.0 PREAMBLE + 2.0 LINE_ITEM should be equi-depth siblings;
  resolver parents 2.0 under 1.0 because both are depth-1 dotted-decimal and 1.0 is
  most recent PREAMBLE.
- 11b (letter-sequence cascade, §17.9): a/b/c letter-suffix rows are chained
  stack_depth+1 each instead of equi-depth siblings under their numbered ancestor.

**Decision.** Park Bug 11. Reverted feat fb89bf44 → f1839b1e; docs f9bd1e70 → debd5186.
Supplementary parking docs committed (this entry). §17.27 updated to [PARKED v5.22].
Deferred to Phase 3+ AI review layer. Parser test count stable at 434.

**Agreements cited.** #9 two-commit shape, #33 Bug 11 parking + Phase 3+ deferral.

---

### 2026-05-22 - Bug 10 coverage extension - Societe Generale HVAC integration test (feat 94706b5c)

**Context.** Bug 10 fix (feat 798f4fd2) landed with VRF System (57 misfires) covered by
TestBug10VrfSameRowSumIntegration. Societe Generale HVAC -- the larger half of the
131-misfire surface at 73 rows -- was not covered. Coverage gap surfaced in chat-Claude
Checklist B review of feat 798f4fd2; closed by this sub-phase.

**Implementation.** Added TestBug10SocieteGeneraleHvacIntegration to test_orchestrator.py
with hand-authored MappingConfig for the 'BOQ_HVAC Lowside works' sheet. Areas declared:
GF / 2F (Office) / 2F(Cafeteria) (row-3 sub-headers under Voyager/Victor merged groups;
Finding 16 wizard-side territory bypassed by declarative config). header_row=3 (bottom of
2-row header rows 2-3), header_row_count=2. Column L (amount_total) carries =SUM(Jx:Kx)
on every line item. 5 tests: fixture-exists smoke + 3 per-row LINE_ITEM assertions matched
by sl_no fingerprint (1.03, 1.04, 1.05) + 1 aggregate LINE_ITEM count threshold (>= 230;
post-fix empirical 282, pre-fix ~209).

**Test-only sub-phase.** No production code changes. Bug 10 fix (feat 798f4fd2) is the
change under test. Parser tests 429 -> 434. No regressions.

**Prompt note.** Step 0.5 command in Bug 10 coverage extension prompt omits test_hierarchy
and test_reader from the module list (5 modules, gives 340); the canonical 429-count
baseline requires all 7 modules. Self-reported as item #25 deviation.

**Agreements cited.** #9 two-commit shape, #20 25-item self-report, #29 real-fixture
integration (Bug 10 closure coverage extension).

---

### 2026-05-22 - Bug 10 fix - same-row =SUM() SUBTOTAL_MARKER misfire (feat 798f4fd2)

**Context.** Bug 10 (sec 9 #86): classifier.py formula-path SUBTOTAL_MARKER check fires on any cell whose formula starts with =SUM( in an amount column (_AMOUNT_ROLES: amount_supply, amount_install, amount_total). Same-row inline aggregations like =SUM(K20:L20) on row 20 (Supply Amount + Install Amount -> Total Amount, same row) were indistinguishable from genuine cross-row subtotal SUM formulas. 131 cross-fixture misfires: VRF System (57 rows) + Societe Generale HVAC (74 rows).

**Implementation.** Single private helper `_is_cross_row_sum(formula: str, current_row: int) -> bool` added to classifier.py Private helpers section (~45 LOC including docstring). Algorithm: strip leading `+`, uppercase, verify starts with =SUM(, extract inside of parentheses, check for cross-sheet `!` (conservative True), split on `,`, for each token strip `$` and parse cell ref(s) via `_CELL_REF_RE = r"^([A-Z]+)(\d+)$"`. Returns False only when ALL extracted row numbers equal current_row. Returns True (conservative) on any parse failure, named range, cross-sheet ref, or empty SUM. Gate added to formula-path SUBTOTAL_MARKER check: both =SUM( prefix AND _is_cross_row_sum returning True required. Text-regex SUBTOTAL_MARKER path (Total Item No., Grand Total, TOTAL CARRIED OVER, etc.) untouched.

**Test summary.** 20 new tests: TestBug10CrossRowSum (13 unit: same-row single/range/abs-refs/multi-range/leading-plus/lowercase, cross-row range/endpoint, mixed, named-range/cross-sheet/empty/non-SUM conservative) + TestBug10ClassifyRowGating (3 classify_row: same-row not subtotal, cross-row still subtotal, text-regex override) + TestBug10VrfSameRowSumIntegration in test_orchestrator.py (4 integration: fixture exists, row sl_no=1.1 LINE_ITEM, row sl_no=1.2 LINE_ITEM, LINE_ITEM count >= 30). Parser tests 409 -> 429. Suite verdict OK.

**Audit-script flips.** classifier_audit.py measures header-keyword matching (not classification categories) -- stats flat: classified 4789 / unclassified 12800 / unique 2580 (unchanged). Flat stats expected for Bug 10 -- fix does not affect header keywords. Fix verified by integration tests per agreement #25.

**Agreements cited.** #9 two-commit shape, #16 known-pattern citation (sec 9 #86), #20 25-item self-report, #25 audit-regression discipline, #29 real-fixture integration for new pattern/routing logic, #34 iterative refinement loop progress (Bug 10 is first in Bug 10->11->12->13->14 queue).

---

### 2026-05-20 - Bug 7 + Bug 9 + CRLF remediation (feat 9a5b16cb)

**Context.** Combined remediation for Bug 7 (sec 9 #85) and Bug 9 (sec 9 #86), plus CRLF pollution cleanup from the original (abandoned) Bug 7 attempt.

**CRLF remediation.** The prior Bug 7 attempt (`d2b542b4` + docs `e4792920`) was committed with CRLF line endings in classifier.py and classifier_audit.py — Windows-side Edit tool preserved CRLF while Docker git commits LF. `git diff --stat` showed ~1539 and ~673 spurious line changes. Resolution: soft-reset HEAD~2 back to Bug 6 tip (`3f7f4ffc`), converted files via Python in container, added `.gitattributes` (`* text=auto eol=lf`, binary overrides for xlsx/png/pdf/jpg) at repo root, then re-applied all changes with guaranteed LF.

**Bug 7 (sec 9 #85) — reverse word order keyword variants.** Real-world BoQ headers like "Rate Supply", "Rate Install", "Total Rate" and "Amount Supply", "Amount Install", "Amount Total" were not matched. Root cause: `_HEADER_KW` in classifier.py only had natural-word-order forms ("Supply Rate", "Install Rate", etc.). Fix: 10 new keyword entries across 7 frozensets:

- `qty_total`: `"qty total"`, `"quantity total"`
- `rate_combined`: `"rate total"`
- `rate_supply`: `"rate supply"`
- `rate_install`: `"rate install"`, `"rate installation"`
- `amount_total`: `"amount total"`
- `amount_supply`: `"amount supply"`
- `amount_install`: `"amount install"`, `"amount installation"`

`_CLASSIFIER_HEADER_KW` replica in classifier_audit.py synced (agreement #21). No changes to `_auto_guess.py` — the Phase 1.9l longest-match-wins precedence means the 11-char "rate supply" beats the 4-char "rate" automatically.

**Bug 9 (sec 9 #86) — amount_combined extraction gap.** `amount_combined` ColumnRole had no extraction path in `classify_row()` — silently dropped. This was surfaced as a "deferred item" in Bug 6. Per sec 7.14, `amount_total` and `amount_combined` are semantically equivalent. Fix: OR-fallback after `amount_total_raw = _cell_float("amount_total")`: if None, try `_cell_float("amount_combined")`. Bug 6 cascade Priority 1/2/3 unchanged; amount_combined now participates as a Priority 1 source. No new ClassifiedRow field needed.

**stopping condition #8 (config.py finding).** `amount_total` and `amount_combined` are both in `_SINGLETON_ROLES` independently but NOT mutually exclusive — a sheet CAN have both columns simultaneously (validator only checks each singleton ≤1, not family-wise exclusion). OR-fallback is still correct regardless.

**Tests added (392 → 409, +17):**

- test_auto_guess.py: `TestBug7WordOrderVariants` (6 methods) — rate/amount/qty family variants, longest-match disambiguation, parenthetical regression, agreement #21 sync invariant.
- test_orchestrator.py: `TestBug7SingleHeaderV2Integration` (6 methods) — real-fixture HVAC BOQ: columns H="Rate Supply"→rate_supply, I="Rate Install"→rate_install, J="Total Rate"→rate_combined, F="Total Qty"→qty_total; end-to-end parse_boq smoke.
- test_classifier.py: `TestBug9AmountCombinedExtraction` (5 methods) — B9-1 combined alone, B9-2 combined wins over supply+install, B9-3 blank falls to P2, B9-4 blank falls to P3 per-area, B9-5 SheetConfig validates OK.

**Classifier audit delta.** Classified 3970 → 4789 (+819) across 28 fixtures (3 new fixtures added since last audit run). 1 pre-existing fixture failure unchanged.

---

### 2026-05-20 - Bug 6 fix - convenience field summation cascade (feat 47090d7d)

**Context.** Implements the fix designed during pre-implementation audit (commit 95718686, entry below). Files changed: classifier.py, test_classifier.py, test_orchestrator.py. orchestrator.py and hierarchy.py not touched (no changes needed at those layers).

**Design decisions locked by chat-Claude before implementation:**

- NEW FIELD: `amount_total_raw: float | None = None` on ClassifiedRow (mirrors qty_total_raw pattern). Tracks the raw column cell value separately from the derived cascade result so callers can distinguish "total column was present" from "total was synthesized."
- cr.amount_total priority cascade:
  - Priority 1: amount_total column cell value wins when non-None.
  - Priority 2: amount_supply + amount_install when both non-None (and amount_total column absent/blank).
  - Priority 3: sum(amount_by_area_raw.values()) when both components absent/None.
  - Priority 4: None (all sources absent).
  - Warning emitted when Priority 2 fires AND amount_by_area_raw is non-empty AND |supply+install - per_area_sum| > 1.0 abs tolerance.
- cr.rate_combined fallback: Priority 1 (column) > Priority 2 (rate_supply + rate_install, both required). NO per-area rate summation (rates are per-unit; summing across areas is semantically invalid). No Priority 3 path for rate.
- Partial components: fallback does NOT fire when only one of supply/install is present. Both required for the cascade to activate.
- orchestrator.py Site 2 (ResolvedRow.amount_total per-area fallback) is redundant for supply+install case after fix but retained for safety - no code change.
- rate_combined fallback insertion point: BEFORE has_nonzero_rate computation so the derived rate_combined contributes to has_nonzero_rate (enabling correct blank-qty -> rate-only classification for rows with supply+install rates but no combined column).

**Tests added:**

- test_classifier.py: 13 new unit tests in TestBug6ConvenienceFieldSummation covering all cascade priorities (1-3), partial components (supply-only, install-only), all-blank -> None, warning fires (diff > 1.0), no warning within tolerance, rate_combined column wins, rate_combined fallback fires, rate_combined None (partial), rate_combined fallback contributes to has_nonzero_rate.
- test_orchestrator.py: 4 new integration tests in TestBug6InovalonIntegration using Inovalon HVAC Unpriced BOQ-21.01.2026.xlsx real fixture. Ground-truth row sl_no='1.1.4' at Excel row 13: G(amount_supply)=200000.0, H(amount_install)=25000.0, sum=225000.0, no amount_total column. Tests: smoke parse, amount_total summed correctly, amount_total_raw is None for summed rows, ResolvedRow.amount_total inherits cascade value.

**Parser test count: 375 -> 392 (+17).**

**Deferred items surfaced during implementation:**

- `amount_combined` ColumnRole has no ClassifiedRow field and no extraction path in classify_row(). Silently ignored for data extraction. Separate gap, not Bug 6.
- orchestrator.py Site 2 is now partially redundant but retained without change.

---

### 2026-05-20 - Bug 6 pre-implementation audit - convenience-field computation in classifier + orchestrator

**Context.** Bug 6 (sec 9 #84 in v5.20 handover) - convenience fields on ClassifiedRow leave as None when "total" column blank, even when component sources have data. Pre-fix read-only audit per working agreement #18 (emergent-design pattern). NO code changes this commit.

**ColumnRole Literal values (confirmed against config.py):**

```
"sl_no", "description", "unit", "qty", "qty_total",
"rate_supply", "rate_install", "rate_combined",
"amount_supply", "amount_install", "amount_total", "amount_combined",
"amount_by_area",
"rate_supply_by_area", "rate_install_by_area", "rate_combined_by_area",
"make_model", "row_notes", "append_to_notes", "reference_images", "ignore"
```

Note: `amount_combined` is a valid ColumnRole but has NO corresponding ClassifiedRow field and is never extracted by classify_row() - see Out-of-scope items below.

**ClassifiedRow fields (confirmed against classifier.py):**

Convenience fields:

| Field | Computation source today | Sum-fallback exists? | Gap re Bug 6 |
| --- | --- | --- | --- |
| cr.qty | Multi-area path (lines 573-582): sum of qty_by_area_raw.values() when qty_area_cols present, else None. Single-col path (lines 584-589): direct _parse_qty_cell read. Then qty_total column OVERRIDES qty (lines 631-637) when non-blank, recording qty_total_raw separately. | YES for per-area case (primary path, not a fallback). NO for single-col case. | No gap at ClassifiedRow level. When qty_area_cols exist, cr.qty = per-area sum regardless of qty_total being blank. qty_total_raw tracked separately feeds ResolvedRow.qty_total; post-pass (Site 1) handles that layer. "Ends up None" only when ALL qty sources are blank - expected behavior. |
| cr.amount_total | Line 665: _cell_float("amount_total") - direct read from amount_total column only. Independent of amount_supply/amount_install and amount_by_area_raw. | NO - no fallback of any kind. | CRITICAL GAP (two sub-cases). Sub-case A (Inovalon): amount_supply + amount_install present, amount_total column absent - cr.amount_total = None, and post-pass does NOT fix ResolvedRow.amount_total (post-pass Site 2 only reads amount_by_area, not supply+install). Sub-case B (per-area): amount_by_area_raw present, amount_total column absent - cr.amount_total = None (never fixed at ClassifiedRow level), but ResolvedRow.amount_total IS fixed by post-pass Site 2. |
| cr.amount_supply | Line 663: _cell_float("amount_supply") - direct read. | NO | Not a Bug 6 target (source field, not derived). |
| cr.amount_install | Line 664: _cell_float("amount_install") - direct read. | NO | Not a Bug 6 target (source field, not derived). |
| cr.amount_combined | DOES NOT EXIST as a ClassifiedRow field. No extraction in classify_row(). role="amount_combined" exists in config.py + _HEADER_KW (for HEADER_REPEAT detection) but produces no line-item data. | N/A | N/A - field is absent. See Out-of-scope items. |
| cr.rate_combined | Line 498: _cell_float("rate_combined") - direct read from rate_combined column only. | NO - no fallback from rate_supply + rate_install, no fallback from rate_by_area_raw. | GAP: when rate_combined column absent, cr.rate_combined = None even if rate_supply + rate_install present. Semantically valid per sec 7.32 (combined == supply + install). No fix exists at any layer (classifier, orchestrator, hierarchy). |
| cr.rate_supply | Line 496: _cell_float("rate_supply") - direct read. | NO | Not a Bug 6 target (source field). |
| cr.rate_install | Line 497: _cell_float("rate_install") - direct read. | NO | Not a Bug 6 target (source field). |

Raw fields (for reference, no Bug 6 work):

- `qty_total_raw: float | None` - value from qty_total column cell specifically (None if blank/absent); tracked separately from cr.qty to initialize ResolvedRow.qty_total
- `qty_by_area_raw: dict[str, float]` - per-area qty values keyed by area name; populated only from role="qty" with area= columns
- `amount_by_area_raw: dict[str, float]` - per-area amount values; populated only from role="amount_by_area" columns
- `rate_by_area_raw: dict[str, dict[str, float | None]]` - outer key=area, inner key in {"supply_rate","install_rate","combined_rate"}; populated from rate_*_by_area columns
- `append_notes_raw: dict[str, str]` - per-column text values for role="append_to_notes" columns; keyed by column header label

Other fields (not Bug 6):

- `raw_row, classification, sl_no_value, description, unit, is_rate_only, make_model, row_notes, warnings, preamble_candidate_score, preamble_candidate_signals`

**ResolvedRow direct fields (confirmed against hierarchy.py):**

Fields initialized from ClassifiedRow at resolve_hierarchy() LINE_ITEM construction (lines 467-475):

- `classified_row: ClassifiedRow` - full reference (most cr fields accessed by indirection)
- `qty_by_area_raw: dict[str, float]` - initialized from classified_row.qty_by_area_raw
- `amount_by_area_raw: dict[str, float]` - initialized from classified_row.amount_by_area_raw
- `qty_total: float | None` - initialized from classified_row.qty_total_raw (NOT from cr.qty)
- `amount_total: float | None` - initialized from classified_row.amount_total

Fields with defaults (not initialized from cr at construction):

- `parent_index, level, path, attached_to_index, attached_notes, is_synthetic, validation_warnings` - tree/structural fields
- `qty_by_area: dict[str, float]` - populated by _apply_multi_area_post_pass (Policy X copy from qty_by_area_raw + fallback)
- `amount_by_area: dict[str, float]` - populated by _apply_multi_area_post_pass
- `rate_by_area: dict[str, dict[str, float | None]]` - populated by _apply_multi_area_post_pass from cr.rate_by_area_raw
- `needs_classification_review: bool, review_reason: str` - set by priced-preamble review-flag post-pass

**Existing sum-fallback sites (confirmed against orchestrator.py + hierarchy.py):**

- Site 1: orchestrator.py:120-121, _apply_multi_area_post_pass(). Modifies ResolvedRow.qty_total. Reads from row.qty_by_area (which = row.qty_by_area_raw at this point - Policy X direct copy at line 84). Trigger: qty_total is None AND qty_by_area is non-empty. Result: qty_total = sum(qty_by_area.values()).
- Site 2: orchestrator.py:122-123, _apply_multi_area_post_pass(). Modifies ResolvedRow.amount_total. Reads from row.amount_by_area (which = row.amount_by_area_raw - Policy X direct copy at line 85). Trigger: amount_total is None AND amount_by_area is non-empty. Result: amount_total = sum(amount_by_area.values()). CRITICAL: amount_by_area comes ONLY from role="amount_by_area" columns; this site does NOT handle the amount_supply + amount_install sub-case.

No sum-fallback sites exist anywhere for cr.rate_combined, cr.amount_total (supply+install sub-case), or any ClassifiedRow convenience field. All ClassifiedRow convenience fields are set once in classify_row() with no post-classification mutation.

**Bug 6 gap summary - the actual fixes needed:**

1. cr.qty: No gap. When qty_area_cols (role="qty" with area=) exist, cr.qty = per-area sum already computed in the primary path (classifier.py:582). The qty_total column only overrides when non-blank (lines 631-637); a blank qty_total leaves cr.qty unchanged as the area sum. "Ends up None" only when all qty sources are blank - expected, no data to sum. ResolvedRow.qty_total fallback already covered by orchestrator.py Site 1. No fix needed for this field.

2. cr.amount_total: TWO gaps. (A) Per-component summation (Inovalon case): amount_supply + amount_install present, amount_total column absent - cr.amount_total = None with no fallback at ClassifiedRow OR ResolvedRow layer. Fix needed: add fallback in classifier.py after line 665 - if amount_total is None and amount_supply and amount_install are both non-None, set amount_total = amount_supply + amount_install. Also add parallel fallback in orchestrator.py _apply_multi_area_post_pass for ResolvedRow.amount_total. (B) Per-area summation: cr.amount_total stays None (ClassifiedRow-level gap persists), but ResolvedRow.amount_total is fixed by post-pass Site 2 - partial coverage already exists. Fix at ClassifiedRow level requires: if amount_total is None and amount_by_area_raw is non-empty, set amount_total = sum(amount_by_area_raw.values()).

3. cr.rate_combined: GAP - no fallback from rate_supply + rate_install. Per-area rate summation is explicitly INVALID (rates are per-unit; summing across areas is semantically wrong). Supply + install summation IS valid per sec 7.32 combined-rate consistency rule. Fix would be: if rate_combined is None and rate_supply is not None and rate_install is not None, rate_combined = rate_supply + rate_install - in classifier.py after line 498. Semantic confirmation needed before implementing (see open questions below).

**Out-of-scope items surfaced during audit (NOT Bug 6, but visible from the code):**

- `amount_combined` convenience field is entirely absent from ClassifiedRow. The role="amount_combined" ColumnRole exists in config.py and _HEADER_KW (used for HEADER_REPEAT detection at classifier.py Step 2), but classify_row() never extracts an amount_combined value for line items. Any column mapped as role="amount_combined" is silently ignored for data extraction. This is a separate feature gap - not Bug 6.
- `cr.rate_combined` fallback via rate_by_area_raw: per-area rate columns produce rate_by_area_raw entries but these are never used to compute cr.rate_combined. This would be semantically invalid (per-unit rates not summable across areas) so omission is correct design, but the gap between rate_by_area_raw and cr.rate_combined should be flagged.
- ResolvedRow.qty_total is initialized from qty_total_raw (the qty_total column cell value), NOT from cr.qty. This means if cr.qty was correctly computed as a per-area sum but qty_total_raw is None (qty_total column blank), ResolvedRow.qty_total starts as None before post-pass fixes it. The post-pass always makes it consistent. Design is intentional per comment at classifier.py line 46-48 ("Separate from qty because classify_row() may override qty from per-area sum").

**Recommended fix shape (informs the next prompt):**

- Files to touch: classifier.py (primary - cr.amount_total and cr.rate_combined fallbacks); orchestrator.py (secondary - ResolvedRow.amount_total supply+install fallback alongside the existing per-area fallback at Site 2)
- Approximate LOC: ~15-25 in classifier.py (3 new fallback blocks with guard conditions); ~5-8 in orchestrator.py (extend Site 2 with supply+install check)
- New tests needed:
  - Synthetic fixture test: amount_supply + amount_install present, no amount_total column - assert cr.amount_total = supply + install and ResolvedRow.amount_total = same
  - Synthetic fixture test: rate_supply + rate_install present, no rate_combined column - assert cr.rate_combined = supply + install
  - Inovalon real-fixture integration test (if one does not already assert amount_total): assert ResolvedRow.amount_total is non-None on rows with supply + install amounts
  - Edge case: amount_supply present but amount_install = None (or vice versa) - fallback should NOT fire for incomplete components; only when BOTH are non-None
- Existing tests that may need updates: any test currently asserting cr.amount_total = None when amount_total column absent but amount_supply/amount_install present; grep for amount_total assertions in test_*.py files before implementing
- Semantic open questions for chat-Claude to resolve before fix:
  - Should cr.rate_combined fall back to rate_supply + rate_install when rate_combined column absent? (YES per sec 7.32, but confirm.)
  - Should the fallback fire when ONLY ONE of supply/install is present (e.g., supply-only BoQ with no install rate)? (Probably NO - partial sum would be misleading. Require both.)
  - Ordering priority for cr.amount_total fallbacks: should supply+install summation take precedence over per-area summation, or vice versa? If both sources available simultaneously, which wins?
  - Should cr.amount_total fallback be added at classifier.py level (consistent, single-pass) or only at orchestrator.py level (no cr field mutation, follows existing pattern for amounts)? The per-area case currently only fixes ResolvedRow.amount_total, not cr.amount_total - should Bug 6 fix match that asymmetry or make both layers consistent?

---

### Phase 1.9i complete (2026-05-18)

**Single-area-targeted diagnostic on 11 sheets at hrc=1.**

- Chore commit: 7d588976d90e8c55ef7a20f33888ecec67541ec2
- Docs commit: see git log (paradox-free per §9 #69)
- Rationale: Nitesh's 2026-05-18 framing — nail single-area first → ~60-70% real-world coverage.
- Targets (11 sheets across 9 fixtures):
  1. ES-CW-MS HVAC Modification → `(Unpriced_R1)ES-CW-MS -6A-L1  L2-HVAC MODIFICATION 09.03.2026.xlsx` : `VRF System`
  2. ES-CW-MS Electrical Modification → `(Unpriced_R1)ES-EL-CW-MS-6A-L1  L2-ELECTRICAL MODIFICATION PRICED BOQ-10.03.2026-R1.xlsx` : `LT WORKS`
  3. Bill of Quantities → `Bill of Quantities.xlsx` : `ELECTRICAL & ELV BOQ`
  4a. Paytm → `BOQ MEP_PAYTM BANGALORE.xlsx` : `ELEC  BOQ` (double-space — confirmed)
  4b. Paytm → `BOQ MEP_PAYTM BANGALORE.xlsx` : `HVAC BOQ`
  5. Electrical BoQ → `Electrical BOQ.xlsx` : `BOQ_ELECTRICAL`
  6. Electrical Unpriced → `Electrical Unpriced BOQ-03.02.2026 R1.xlsx` : `Electrical ` (trailing space — confirmed)
  7. Inovalon → `Inovalon HVAC Unpriced BOQ-21.01.2026.xlsx` : `BOQ`
  8. K Mall → `K-Mall Jodhpur BOQ Combined.xlsx` : `HVAC BOQ`
  9a. Kohler → `Kohler-BOQ- 06-04-26.xlsx` : `Electrical`
  9b. Kohler → `Kohler-BOQ- 06-04-26.xlsx` : `HVAC`
- Captured per target: classification, pattern, areas, header_row_excel,
  header_cells_by_column, auto_guessed_column_role_map, first_3_l1_preambles,
  first_l2_preamble, first_10_line_items (parent_path + qty + rate + amount +
  per_area_*), line_items_with_non_none_qty_count vs total.
- Parser tests: 291 passing (unchanged — observability-only).
- Audit-script regression check (agreement #25): clean, zero diffs.
- Frappe tests: not run (no Frappe code touched, per agreement #20).
- Output files: single_area_triage_1_9i_output.json (~74 KB), .txt (~43 KB).
- Headline findings:
  - All 11 sheets correctly classified as single-area; zero multi-area false positives.
  - Zero load exceptions — all 9 fixture files opened cleanly.
  - 163 total null role assignments across 11 targets — auto-guess has coverage gaps (unrecognized header strings map to null).
  - Non-None-qty ratio: 100% across all 11 targets (min=58/58, max=553/553) — qty column detection working correctly for single-area sheets.
  - Line item counts span 58 (HVAC VRF) to 553 (Paytm ELEC) — parser scales correctly across large single-area sheets.
- Next step: chat-Claude + Nitesh review output and decide on Stage 2 scope (single-area follow-on fixes or proceed to Raheja HVAC parser polish).

### Phase 1.9j --- Mode C diagnostic metric fix ✅ COMPLETE

Diagnostic-script-only sub-phase. Replaces the broken `line_items_with_non_none_qty_count`
metric with three mutually-exclusive counts per role family (qty / rate / amount).
No parser source touched. Parser tests unchanged at 291 PASS / 0 FAIL.

**What changed in `single_area_triage_1_9i.py`:**

- Added `_role_metric(role_assigned, real_flags)` helper returning three-count dict.
- Added role-family membership constants `_QTY_FAMILY_ROLES`, `_RATE_FAMILY_ROLES`,
  `_AMOUNT_FAMILY_ROLES`.
- In `_run_target()`: per-LINE_ITEM-row appending of qty/rate/amount real-flags;
  per-target three-count computation; sum-invariant assertion raises ValueError if
  `real + zero_default + role_unassigned != total_line_items_count` for any role family
  on any target.
- New output fields per target: `line_items_with_real_<role>_count`,
  `line_items_with_<role>_zero_default_count`,
  `line_items_with_<role>_role_unassigned_count` for role in {qty, rate, amount}.
- Deprecated `line_items_with_non_none_qty_count` retained with inline comment for
  one transition cycle of comparability with 1.9i baseline.
- TXT renderer per-target block + new aggregate-summary three-count block.
- Output filenames changed from `_1_9i_output.{json,txt}` to `_1_9j_output.{json,txt}`;
  1.9i baseline files at `c3b2ed1d` preserved untouched.
- Added `_self_test()` callable via `--self-test` CLI flag; 3 synthetic cases
  verify the helper's three-count logic. Kept in-script (no test file added) so
  parser test count stays at 291.

**Real-flag definition (per role family):**

`real` = role assigned in `SheetConfig.column_role_map` AND
`ClassifiedRow.<role_field>` is not None. For qty: also excludes `cr.is_rate_only`
rows (§9 #66 blank-to-zero coercion and rate-only markers). Rate family checks
`rate_combined`/`rate_supply`/`rate_install`. Amount family checks
`amount_total`/`amount_supply`/`amount_install`.

**Sum invariant:** `real + zero_default + role_unassigned == total_line_items_count`
for each of qty / rate / amount on every target. Asserted in `_run_target` via
explicit `raise ValueError` on violation. Re-run on the 11 original 1.9i targets
showed no violations.

**Empirical headline from re-run** (`single_area_triage_1_9j_output.txt` aggregate,
2372 total line items across 11 targets):

```
qty   : real=  1617  zero_default=    32  role_unassigned=   723
rate  : real=   733  zero_default=  1639  role_unassigned=     0
amount: real=  2339  zero_default=    33  role_unassigned=     0
```

vs deprecated `line_items_with_non_none_qty_count` which scored 100% non-None on
every target (because 0.0 was treated as non-None). Mode C confirmed: the prior metric
was structurally incapable of distinguishing "parser found qty" from "qty unassigned
and defaulting to 0."

**Top finding: 723/2372 (30.5%) of line items have NO qty column assigned at all.**
Largest single contributor: Target 4 (Paytm ELEC, 553 items, role_unassigned=553)
— confirmed Mode A failure (merged-cell two-row header, hrc=1 misses the area names).
Target 5 (Paytm HVAC, 170 items) similarly: role_unassigned=170. Combined these two
targets account for 723/723 of the unassigned bucket. All other 9 targets show
role_unassigned=0 for qty — clean single-area sheets with qty column correctly mapped.
Mode A fix in Phase 1.9m should collapse role_unassigned for these targets.

Selected per-target highlights:
- Target 4 (Paytm ELEC, 553 items): qty real=0, zero_default=0, role_unassigned=553 — Mode A failure confirmed.
- Target 9 (K Mall HVAC, 67 items): qty real=65, zero_default=2, role_unassigned=0 — clean parse; 2 rate-only rows coerced.
- Target 11 (Kohler HVAC, 69 items): qty real=66, zero_default=3, role_unassigned=0 — clean; rate all zero_default (rate column absent or unrecognized).

**Caveat for follow-up refinement:** The real flag uses `cr.<role_field> is not None`
as a proxy for "source cell was non-empty." This is accurate if the parser preserves
None for blank cells at the `ClassifiedRow` layer. Step 0 verify-current-state
confirmed the type signatures (`qty: float | None = None`, etc.) but did not trace
every parsing code path to confirm None-preservation end-to-end. If any §9 #66-style
blank-to-zero coercion occurs at the `ClassifiedRow` layer (beyond the documented
`is_rate_only` path), real counts for qty/amount are slightly inflated and
zero_default slightly deflated; headline signals (role_unassigned distribution,
rate zero_default ratio) are unaffected. Verification recommended in a future
refinement (1.9j.1 candidate, low priority) or as a side-check during 1.9n re-run
analysis.

**Test impact:** Parser tests 291 unchanged. Script `--self-test` adds 3 synthetic
cases (all-real, all-zero-default, role-unassigned), all PASS. No new files in `tests/`.

**§9 #54 ECHO check:** xlsx fixtures perturbed by parser re-run; cleared via
`git restore nirmaan_stack/services/boq_parser/tests/fixtures/*.xlsx` before commit.

**Status:** CLOSED. Chore commit `68befb2e`. Docs commit see git log.

### Phase 1.9k --- Mode B + Mode F + F3c broadened ✅ COMPLETE

Three classifier defects fixed in one feat commit. Parser source touched:
`classifier.py`, `multi_area_detection.py`, `classifier_audit.py`. Test count
291 → 312. Phase 1.x Frappe tests 91 unchanged.

**Mode B (1.9i finding) — `_HEADER_KW` vocabulary additions:**
- `qnt`, `qnt.` → qty role (Paytm HVAC target 5, 170 line items with role_unassigned qty).
- `um` → unit role (Kohler HVAC target 11).
- 10 additional entries surfaced from `classifier_audit_output.json` top-200
  unclassified strings:
  - `sl no` → sl_no (unperioded variant; also enables Mode F "Sl No." fix as substring)
  - `sq.ft`, `sqm`, `rmt`, `rft`, `mtr`, `set`, `each` → unit (square feet/meters,
    running meter/feet, meter, set, each — all obvious unit abbreviations)
  - `no's` → qty (possessive/plural of nos, i.e. "numbers")
- `classifier_audit.py` `_CLASSIFIER_HEADER_KW` frozen replica synced
  (agreement #21 mechanical cascade). Sync comment updated to Phase 1.9k.

**Mode F (1.9i finding) — trailing-punctuation normalization:**
- Normalization at `classify_row()` header-repeat step (line 434 in `classifier.py`)
  extended: `_to_str(c.value).lower().rstrip(".:") `
- Affects: `Sl No.`, `SL NO.`, `Qty.`, `S No:`, and any trailing-period / trailing-colon
  variants across the corpus.
- Call-site scope: local to the header-repeat detection in `classifier.py`. Does NOT
  modify `multi_area_detection.py`'s `_is_reserved` (separate normalization path,
  reserved keywords from GlobalSettings do not typically have trailing periods).
- `classifier_audit.py` `_match_role()` normalization synced to same `rstrip(".:").
- **Audit magnitude**: Mode F contributed substantially more matches than Mode B alone.
  Classified count jumped from 3255 → 3970 (+715). The 715 delta vs ~12 vocabulary
  additions confirms Mode F's `rstrip` caught a large trailing-period long tail across
  the 25-workbook corpus.

**F3c broadened (Phase 1.9e finding) — `_RATE_CELL_PATTERN`:**
- Was: anchored regex `r"^\s*rates?\s*$"` (required cell to be exactly "rate"/"rates").
- Now: word-boundary regex `r"\b(rates?|costs?|prices?)\b"` (rate/cost/price family).
- Call-site changed from `.match()` to `.search()` (non-anchored regex requires search).
- Recognizes rate-family words anywhere in the cell text: `Per Unit Rate`,
  `Supply Rate`, `Rate (INR)`, `Unit Cost`, `Unit Price`, etc.
- Empirical basis: 62 cases (60 rate + 2 price) from Phase 1.9e stress test.
- False-positive risk bounded by Pattern 2-rate detection's call-site context
  (only consulted after a 3-col merge structure is already confirmed).
- Word-boundary semantics verified by `test_costing_does_NOT_match_word_boundary_check`
  — "Costing" does NOT match.
- F3c does NOT affect `classifier_audit_output.json` output (classifier_audit.py
  only uses classifier.py's `_match_role`, not multi_area_detection).

**Audit-script regression check (agreement #25):**
- `classifier_audit_output.json` regenerated.
- Before (v5.10 §17.11.F): classified=3255, unclassified=11424, unique_unclassified=2697.
- After (Phase 1.9k): classified=3970, unclassified=10709, unique_unclassified=2536.
- Net delta: classified +715; unclassified -715; unique_unclassified -161.
- Direction consistent with additive vocabulary + normalization broadening. No unexpected
  classification flips.

**Test calibration (§9 #73 path-shift pattern):** None required. All existing tests
continued to pass without modification. No test asserted that QNT/UM/Sl No. should
stay unclassified, and no Pattern 2-rate test asserted that non-bare-Rate headers should
fail detection.

**Test count:** 291 → 312. New tests:
- `TestPhase1_9kModeBAndF` in `test_classifier.py` (10 tests: QNT, QNT., UM, Sl No.,
  SL NO., Qty., No's, Sq.ft, Rmt, Each).
- `TestPhase1_9kF3cBroadenedRateCellPattern` in `test_multi_area_detection.py` (11 tests:
  Per Unit Rate, Supply Rate, Rate (INR), Unit Cost, Unit Price, bare Rate, bare Rates,
  Costing word-boundary guard, unrelated text guard, Per Unit Rate integration,
  Unit Cost integration).

**§9 #54 ECHO check:** xlsx fixtures perturbed by test runs; cleared via
`git restore nirmaan_stack/services/boq_parser/tests/fixtures/*.xlsx` before commit.

**Status:** CLOSED. Feat commit `3cc3819c`. Docs commit see git log.

### Phase 1.9l --- Mode D substring-match precedence fix ✅ COMPLETE

Single targeted fix per the 1.9j-1.9n locked plan. Parser source touched:
`_auto_guess.py` (Phase 1 assignment matcher) and `classifier_audit.py` (`_match_role()`
replica). `classifier.py` not modified — its HEADER_REPEAT checker iterates
per-column against already-assigned roles (different semantics, no role competition).
Test count 312 → 324. Phase 1.x Frappe tests 91 unchanged.

**Mode D (1.9i finding) — generic keyword beats specific:**

The old Phase 1 matcher in `_auto_guess.py` iterated `_HEADER_KW` in dict-insertion
order and broke on the first role whose keyword set had any matching substring.
Because substring matching makes shorter keywords match a strict superset of inputs
vs longer ones, generic keywords like `"rate"` (in `rate_combined`) would beat
specific compound keywords like `"supply rate"` (in `rate_supply`) whenever the cell
text contained both.

**Headline bug (1.9i target 8 Raheja Electrical):**
- Bottom-header cell text: `"Supply Rate"`.
- Old matcher: `"rate"` in `"supply rate"` → True → `rate_combined` wins (iteration
  order); `break`. Supply rate column mis-labeled as `rate_combined`. Install rate
  column dropped to NULL because no subsequent role's first-matching keyword was tried.
- New matcher: among all keyword matches across all roles, picks the role whose
  matched keyword is LONGEST. `"supply rate"` (11 chars) beats `"rate"` (4 chars) →
  `rate_supply` wins. Tie-break by iteration order (no second criterion).

**Implementation:**
- `_auto_guess.py` Phase 1 assignment loop (lines 111-121): replaced inner
  `if any(...): break` with a collect-all-matches loop tracking `best_kw_len`.
- `classifier_audit.py` `_match_role()` (lines 140-153): same longest-match-wins
  rewrite. Sync comment updated to cite Phase 1.9l Mode D + agreement #21.
- `classifier.py` HEADER_REPEAT checker: NOT modified. That checker iterates the
  already-assigned `col_map` and checks per-column whether the cell text matches
  that column's own role keywords — no role competition, so Mode D is irrelevant.

**Test calibrations (§9 #73 path-shift pattern):** None required. All existing tests
either used bare `"Rate"`/`"Amount"` headers (which only match one role family) or
pre-configured `column_role_map` objects (not derived from auto_guess). Zero tests
asserted the buggy first-match precedence.

**New tests** in `TestPhase1_9lModeDPrecedence`:
- `test_auto_guess.py` (10 tests): Supply Rate → rate_supply; Installation Rate →
  rate_install; Install Rate → rate_install; Supply Amount → amount_supply;
  Installation Amount → amount_install; Combined Rate → rate_combined (regression);
  bare Rate → rate_combined (regression); SITC Rate → rate_combined (regression);
  DSR Rate → rate_supply; NDSR Rate → rate_install.
- `test_classifier.py` (2 spot-check tests): Supply Rate in rate_supply col → HEADER_REPEAT;
  Install Rate in rate_install col → HEADER_REPEAT. Complementary guards that role
  assignment is in `_auto_guess.py` and tested fully there; classifier-level tests
  verify the HEADER_REPEAT checker works once columns carry the right roles.

**Audit-script regression check (agreement #25):**
- Top-level stats (expected near-flat since Mode D reassigns but does not unclassify):
  Before (Phase 1.9k): classified=3970, unclassified=10709, unique_unclassified=2536.
  After (Phase 1.9l): classified=3970, unclassified=10709, unique_unclassified=2536.
  Flat as expected — `"Supply Rate"` classified before (as wrong role) and after (as
  correct role); net classified count unchanged.
- Per-role breakdown: not surfaced in audit JSON structure (`summary` has no
  `classified_by_role` field). Role-flip detail visible only in `per_fixture`
  per-cell records; not summarized.

**§9 #54 ECHO check:** xlsx fixtures perturbed during two test runs (Step 1 and Step
7 checks); cleared via `git restore` before both the final test suite run and before
commit.

**Status:** CLOSED. Feat commit `f00cc6ca`. Docs commit see git log.

### Phase 1.9m --- Mode A auto-detect 2-row headers ✅ COMPLETE

Single targeted fix per the 1.9j-1.9n locked plan. Parser source touched:
`_auto_guess.py` only. Test count 324 → 337. Phase 1.x Frappe tests 91 unchanged.

**Mode A (1.9i §22.4 finding) --- merged-cell 2-row headers misread at hrc=1:**

When a sheet uses a two-row merged header and is read at `header_row_count=1`, the
reader flattens merged cells — every continuation cell carries the same text as its
merge origin. This means adjacent columns share identical normalized text in the bottom
header row. The Phase 1 singleton guard in `auto_guess_sheet_config()` fires on the
second duplicate and drops its role assignment, leaving per-area columns without roles.

**Helper: `_should_auto_promote_hrc_to_2(bottom_row, above_row, below_row) → bool`**

Three-condition heuristic (all must hold):
1. bottom_row has ≥ 3 non-blank cells (degenerate sheets don't trigger).
2. At least one pair of ADJACENT columns (col-index difference == 1) in bottom_row
   has identical normalized text (the merged-cell signature).
3. For at least one such duplicate pair, either `above_row` or `below_row` has
   DISTINCT non-blank text at both those column positions (confirms a genuine 2-row
   header rather than a table with legitimately repeated values).

Conservative by design: false negatives are recoverable via
`SheetConfig.top_header_rows_override` (Phase 1.9d F5-b). False positives would
corrupt the parse.

**Signature change to `auto_guess_sheet_config()`:**

```python
# Before (Phase 1.9l):
def auto_guess_sheet_config(reader, sheet_name, header_row,
                             header_row_count: int,
                             reserved_keywords: list[str]) -> SheetConfig

# After (Phase 1.9m):
def auto_guess_sheet_config(reader, sheet_name, header_row,
                             header_row_count: int | None = None,
                             reserved_keywords: list[str] | None = None) -> SheetConfig
```

- `header_row_count=None` (new default) → Mode A auto-detect: reads above + below rows,
  calls `_should_auto_promote_hrc_to_2()`, resolves to `effective_hrc` ∈ {1, 2}.
- Explicit int (1 or 2) → bypasses auto-detect, same behaviour as before.
- `reserved_keywords=None` → resolves to `[]` (backward-compatible).

All existing callers pass explicit positional args `(reader, sheet, hr, hrc, kws)` —
unaffected by the default changes.

**Empirical targets (Phase 1.9i §22.4):**

- Paytm ELEC (header_row=5): adjacent RATE/RATE and AMOUNT/AMOUNT in row 5; below row 6
  has Supply/Installation → `_should_auto_promote_hrc_to_2` returns True → effective_hrc=2.
  BUT "SUPPLY" and "INSTALLATION" are in `multi_area_reserved_keywords`, so
  `detect_multi_area_pattern` returns None on the top row → no per-area roles assigned.
  effective_hrc=2 but area_dimensions=[] → no corruption, no improvement for Paytm.
  Full fix for Paytm deferred (needs non-reserved area names or Pattern 6 detection).
- Paytm HVAC: same shape; same result.
- TS-T2-WEX shape (e.g. "Office"/"Common Area" above "QTY"/"QTY"): adjacent QTY/QTY
  in bottom row; above row has distinct non-reserved names → promotes to hrc=2 → Pattern 1
  (top row fallback) fires → per-area qty roles assigned correctly.

**Implementation:**

- `_should_auto_promote_hrc_to_2()` added after `_normalize()` in `_auto_guess.py`.
- `auto_guess_sheet_config()` early block: if `header_row_count is None`, reads
  `header_row − 1` (if exists) and `header_row + 1`, calls helper, sets `effective_hrc`.
  `effective_hrc` then replaces `header_row_count` in Phase 1, Phase 2, and `SheetConfig(...)`.

**Test calibrations:** None required. All existing tests pass explicit `header_row_count`
values — they route through the `else: effective_hrc = header_row_count` branch, unaffected.

**New tests** in `test_auto_guess.py` (13 total):

`TestShouldAutoPromoteHrc2` (8 helper unit tests):
- adjacent dup + below distinct → True
- adjacent dup + above distinct → True
- no adjacent dups → False
- fewer than 3 cells → False
- adjacent dup + both above/below None → False
- adjacent dup + below matching at dup cols → False
- adjacent dup + below blank at dup cols → False
- non-adjacent dups (gap column) → False

`TestPhase1_9mModeAAutoPromote2RowHeader` (5 integration tests):
- TS-T2-WEX shape: auto-promotes to hrc=2
- all-distinct bottom row: stays hrc=1
- TS-T2-WEX: after promote, Pattern 1 (top) assigns per-area qty to Office + Common Area
- Paytm ELEC shape: promotes to hrc=2 but reserved kws block pattern → area_dimensions=[]
- explicit hrc=1 on promotable sheet: bypasses auto-detect → stays hrc=1, no per-area roles

**Audit-script regression check (agreement #25):**

`classifier_audit.py` does not call `auto_guess_sheet_config` — it uses
`reader.detect_header_row()` and scans headers at its own fixed hrc=1. Stats are expected
flat. Confirmed:
  Before (Phase 1.9l): classified=3970, unclassified=10709, unique_unclassified=2536.
  After (Phase 1.9m): classified=3970, unclassified=10709, unique_unclassified=2536. ✓

**§9 #54 ECHO check:** Synthetic xlsx fixtures perturbed during test run; cleared via
`git restore` before commit (done manually outside Claude Code due to tool hang).

**Status:** CLOSED. Feat commit `c08ebd13`. Docs commit see git log.

### Phase 1.9n --- Re-run single-area diagnostic on subset + metric correction (1.9j-1.9n cycle closes) ✅ COMPLETE

Final sub-phase of the 1.9j-1.9n locked plan. Diagnostic-script-only re-run on the 9
single-area-candidate targets (3-11) from the original 1.9i target list, using the
Phase 1.9j three-count metric to measure the cumulative effect of Phase 1.9k (Mode B/F/F3c),
Phase 1.9l (Mode D), and Phase 1.9m (Mode A) on those targets.

No parser source touched. Parser tests unchanged at 337 PASS. No Frappe boundary crossed.

**Implementation:** Option A — extended `single_area_triage_1_9i.py` with a `--subset 1_9n`
CLI flag. Changed `main()` signature to `main(subset: str | None = None)`. When
`--subset 1_9n` is passed, filters `TARGETS[2:]` (targets 3-11) and writes to
`single_area_triage_1_9n_output.{json,txt}`. Original 1.9j output paths unaffected.
~18 lines net new/changed — well under the 30-line Option-B threshold.

**Metric correction: `_QTY_FAMILY_ROLES` widened to include `qty_total`:**

Initial run showed three apparent regressions (Kohler HVAC, Inovalon, Electrical Unpriced
all moved from 0 to fully-unassigned qty). STOP triggered. Investigation confirmed these
are NOT parser regressions — Phase 1.9l Mode D's longest-match-wins precedence fix
correctly reclassified "Total Qty" column headers from `qty` → `qty_total`. The 1.9j
metric definition `frozenset({"qty"})` excluded `qty_total`, so `qty_role_assigned` was
False for those sheets despite the column being correctly typed. Fix: widened to
`frozenset({"qty", "qty_total"})`. A single constant change; no parser source touched.

**Outputs:**
- `single_area_triage_1_9n_output.json` (66,055 bytes)
- `single_area_triage_1_9n_output.txt` (36,982 bytes)

**Headline finding: clean-parse count 2 of 9** (Bill of Quantities + Kohler Electrical).
Same count as the 1.9i baseline on the strict zero-default=0 definition — but the
semantic coverage is meaningfully better after the metric correction and 1.9k/l/m fixes.

**Per-target qty role_unassigned at 1.9n (vs 1.9j baseline, 9 kept targets):**

| Target | 1.9j unassigned | 1.9n unassigned | Delta | Notes |
|---|---|---|---|---|
| 3. Bill of Quantities | 0/449 | 0/449 | 0 | CLEAN |
| 4. Paytm ELEC | 553/553 | 553/553 | 0 | Mode A promotes to hrc=2 but Supply/Installation reserved kws block pattern; unchanged as predicted |
| 5. Paytm HVAC | 170/170 | 0/336 | −170 | Improved: Mode B QNT synonym assigned qty role; total doubled 170→336 due to Mode F rstrip reclassifying header-repeat rows as LINE_ITEM; 184 real + 152 zero_default |
| 6. Electrical BoQ | 0/230 | 0/261 | 0 | 31 zero_default; total grew (Mode F rstrip effect) |
| 7. Electrical Unpriced | 0/155 | 0/154 | 0 | Metric gap corrected: column is qty_total, not qty; real=149, zero_def=5 |
| 8. Inovalon | 0/106 | 0/106 | 0 | Metric gap corrected: column is qty_total; real=93, zero_def=13 |
| 9. K Mall HVAC | 0/67 | 0/67 | 0 | No regression ✓ |
| 10. Kohler Electrical | 0/236 | 0/236 | 0 | CLEAN; no regression ✓ |
| 11. Kohler HVAC | 0/69 | 0/69 | 0 | Metric gap corrected: column is qty_total; real=66, zero_def=3 |

**Aggregate three-count metric (9 targets, corrected):**

```
Total line items across all targets: 2231
qty:    real=1472  zero_default=206  role_unassigned=553
rate:   real=688   zero_default=1543 role_unassigned=0
amount: real=2208  zero_default=23   role_unassigned=0
```

Aggregate qty_unassigned: 723 (1.9j 9-target baseline) → 553 (1.9n corrected), delta=−170.
Sole residual: Paytm ELEC (553 items). All other targets have qty assigned.

**Strategic observation:** The 1.9j-1.9n cycle delivered one empirical gain: Paytm HVAC's
170 qty items moved from role_unassigned to assigned (via Mode B QNT synonym in 1.9k).
The three apparent regressions were a metric definitional gap exposed by 1.9l's semantic
precision improvement — a win for correctness, not a loss. Paytm ELEC (553 items) remains
the sole unresolved target, requiring either non-reserved area names or Pattern 6 detection
(not in any current sub-phase plan). The Mode A auto-detect (1.9m) fires correctly for
Paytm but is blocked by reserved keywords at the pattern-detection step — confirming the
1.9m design constraint documented in the 1.9m section above.

**Empirical input for the strategic re-evaluation conversation (v5.17 §22.8):** the
1.9j-1.9n cycle reduced the 9-target qty_unassigned from 723 to 553 (−170, Paytm HVAC
alone). The metric correction also revealed that 1.9l improved semantic precision beyond
what the original metric could measure.

**Audit-script regression check (#25): NOT APPLICABLE this sub-phase.** No parser source
touched, classifier dictionary unchanged.

**Phase 1.x Frappe tests:** NOT RE-RUN. Diagnostic-script-only; no parser/Frappe boundary
crossed per agreement #20.

**§9 #54 ECHO check:** 11 synthetic xlsx fixtures perturbed by both diagnostic runs.
Restored via `git restore "nirmaan_stack/services/boq_parser/tests/fixtures/synthetic_*.xlsx"`
(broad glob, confirmed safe when all 11 are modified per session verification).

**Status:** CLOSED. Chore commit `3af8e828`. Docs commit see git log.

**The 1.9j-1.9n locked cycle is now complete.** Next: strategic re-evaluation chat
(per v5.17 §22.8) with this 1.9n empirical data as input.

### Pre-1.9o fixture additions (chore, no parser source touched)

Added 4 synthetic multi-area BoQ fixtures (V1/V2 variants of
two shapes, intentionally different) to feed Phase 1.9o
regression coverage and the expanded-subset diagnostic retest:

- `multi_area_single_header_v1.xlsx` --- 17-sheet multi-sheet
  single-area BoQ, 1-row headers; parser handles cleanly today.
- `multi_area_single_header_v2.xlsx` --- same shape as V1,
  file bytes differ; V1 cross-check fixture.
- `multi_area_merged_header_v1.xlsx` --- 13-sheet BoQ with a
  hybrid shape (2-col top-row merges over Supply/Installation
  pairs PLUS row-2 'Area 1'/'Area 2' labels); auto_guess
  assigns qty to two columns. Edge-case coverage.
- `multi_area_merged_header_v2.xlsx` --- 13-sheet BoQ with
  canonical Tier A-merged shape: 4-col top-row merges over
  {Qty | Supply rate | Install Rate | Amount} sub-header
  quadruples per area. Currently exhibits silent supply/install
  drop (qty/rate/amount columns unassigned) at hrc=1 and hrc=2.
  Strongest Phase 1.9o regression fixture.

Commit: a97ff170

Feeds: Phase 1.9o (Tier A-merged pattern recognizer +
reference-code keyword expansion) regression coverage, and
the expanded-subset diagnostic retest empirical surface.

### Expanded-subset retest --- 15 targets (11 existing + 4 multi-area fixtures) ✅ COMPLETE

What landed: TARGETS list in single_area_triage_1_9i.py extended from 11 to 15
by appending the 4 synthetic multi-area fixture sheets specified by Nitesh. The
original chore (9d4abf36) used incorrect filenames (missing multi_area_ prefix);
a cleanup chore (c8c9f234) corrected the 4 "file" fields. The empirical findings
below come from the corrected run.

Fixture file references:
- multi_area_merged_header_v1.xlsx: ELECTRICAL & ELV BOQ
- multi_area_merged_header_v2.xlsx: ELECTRICAL & ELV BOQ
- multi_area_single_header_v1.xlsx: HVAC BOQ
- multi_area_single_header_v2.xlsx: HVAC BOQ

Snapshot convention introduced: diagnostic_snapshots/ folder for preserving
named copies of significant diagnostic runs. The live output files are
overwritten each run; snapshots provide historical comparison points. Chore #2
smoke-run (commit 63bead94) snapshotted as chore_2_smoke_run.json + .txt before
the expanded run regenerated the live output.

Key findings from the corrected empirical run:

merged_header_v1 (ELECTRICAL & ELV BOQ):
- hrc: Mode 1=2 (auto-detect bumped), Mode 2=1. Pattern=None. Classification: single-area.
- Tier A-merged did NOT fire. The fixture was parsed as single-area despite the
  auto-detect bump. total=449, qty real=449 (100%), rate real=200/449, amount
  real=449 (100%). No src_present_unparsed. Clean parse.
- Mode 1 vs Mode 2 delta: ZERO (identical metrics at hrc=2 and hrc=1).
- Note: Phase 1.9o commit notes cited v1 ELECTRICAL sheet as the empirical case
  where tier_a_merged fires. The multi_area_merged_header_v1.xlsx diagnostic here
  shows pattern=None / single-area. Either the fixture on disk differs from the one
  used in 1.9o tests, or auto-detect at hrc=2 is routing through a different code
  path than the tier_a_merged shape expects. Requires investigation.

merged_header_v2 (ELECTRICAL & ELV BOQ):
- hrc: Mode 1=2 (auto-detect bumped), Mode 2=1. Pattern=Pattern 1. Classification:
  multi-area, 2 areas. total=370.
- 100% role_unassigned across all 3 families (qty/rate/amount). Auto_guess could
  not assign any column roles to either area. No src_present_unparsed (vacuously
  0 -- no roles assigned so no source walk).
- Mode 1 vs Mode 2 delta: ZERO (Pattern 1 fires in both modes).
- This aligns with the prediction that v2 "falls through to Pattern 1 top-row
  fallback with partial handling" -- though the result is worse than partial:
  total role_unassigned for all 370 items. The role_unassigned = 100% finding
  makes this the most critical gap in the current corpus after Paytm HVAC.

single_header_v1 (HVAC BOQ):
- hrc: Mode 1=1, Mode 2=1 (no auto-detect bump). Pattern=Pattern 1. Classification:
  multi-area, 3 areas. total=67.
- qty: real=65, zero_default=2, src_present_unparsed=2 (NEW parser-side finding).
- rate: real=60, zero_default=7, src_present_unparsed=0.
- amount: real=47, zero_default=20, src_present_unparsed=0.
- Mode 1 vs Mode 2 delta: ZERO (no hrc delta as expected for single-header shape).

single_header_v2 (HVAC BOQ):
- hrc: Mode 1=1, Mode 2=1 (no auto-detect bump). Pattern=Pattern 1. Classification:
  multi-area, 3 areas. total=67.
- qty: real=65, zero_default=2, src_present_unparsed=2 (same as v1).
- rate: real=0, zero_default=67, src_present_unparsed=0 (ALL zero -- rate column
  not assigned in v2 vs 60 real in v1). This is the sharpest v1 vs v2 difference.
- amount: real=47, zero_default=20, src_present_unparsed=0 (same as v1).
- Mode 1 vs Mode 2 delta: ZERO.

Summary table (Mode 1 only, no Mode 1 vs Mode 2 delta on any new fixture):

  Fixture          | hrc | pattern   | class       | areas | total | qty_real | rate_real | amt_real | src_unp
  merged_hdr_v1    |  2  | None      | single-area |   0   |  449  |   449    |    200    |   449    |   0
  merged_hdr_v2    |  2  | Pattern 1 | multi-area  |   2   |  370  |     0    |      0    |     0    |   0
  single_hdr_v1    |  1  | Pattern 1 | multi-area  |   3   |   67  |    65    |     60    |    47    |   2
  single_header_v2 |  1  | Pattern 1 | multi-area  |   3   |   67  |    65    |      0    |    47    |   2

New parser-side findings to queue:
1. single_header_v1 + v2: qty src_present_but_unparsed=2 each -- 2 rows have a
   qty source cell value that the parser dropped. Candidate for the Phase 1.9q
   investigation queue alongside Paytm HVAC.
2. merged_header_v2: 100% role_unassigned across all families. The Pattern 1
   multi-area detection fires but auto_guess assigns nothing -- either the column
   layout is not recognizable by any keyword or the per-area assignment logic
   doesn't match this shape.
3. merged_header_v1 tier_a_merged miss: needs a follow-up diagnostic or direct
   inspection of the fixture to understand why pattern=None for a fixture named
   "merged_header".

Existing 11 targets: numbers identical to Chore #2 snapshot. Spot-checked:
- Paytm HVAC: qty src_present_unparsed=150/336 baseline confirmed.
- Kohler Electrical: total=236, qty real=236, clean.
- Electrical Unpriced: total=154, unchanged.
Mode 1 vs Mode 2 delta: zero for all 11 (consistent with prior chores).

Implications for queue positions 4 and 5: The merged_header_v2 100%
role_unassigned gap and the single_header src_present_unparsed=2 finding both
strengthen the case for Phase 1.9q work on the role-assignment + text-coercion
front before proceeding to the strategic re-evaluation chat. The merged_header_v1
tier_a_merged miss is the most unexpected finding and warrants ground-truth
inspection before the re-eval chat.

Parser tests 375 unchanged --- agreement 27 strict.

Chore commits: 9d4abf36 (TARGETS extension) + c8c9f234 (filename correction)
Docs commit: 483b53bd (original, now amended)

### Diagnostic metric repair --- source_present + two-mode output (chores, no parser source touched)

Two back-to-back diagnostic-script-only chores extending `single_area_triage_1_9i.py`.
No parser source touched. Parser tests unchanged at 375 PASS / 0 FAIL.

**Chore #1 (78ea7d49) --- `source_present_but_unparsed` signal + multi-area frozensets:**

- `_role_metric()` gains a 3rd arg `source_present_flags: list[bool]` and returns a 4th
  bucket: `source_present_but_unparsed` = line items where the role is assigned, the value
  is None (zero_default), AND the raw source cell was non-blank. Distinguishes "BoQ is
  unpriced" from "parser failed to parse a value that was present."
- New `_source_present_for_family(cr, sc, family_roles)` helper: walks `sc.column_role_map`
  to find columns mapped to any role in the given frozenset; checks `cr.raw_row.cells` for
  non-blank values.
- Multi-area role names added to family frozensets: `rate_combined_by_area`,
  `rate_supply_by_area`, `rate_install_by_area` added to `_RATE_FAMILY_ROLES`;
  `amount_by_area` added to `_AMOUNT_FAMILY_ROLES`. Without these, multi-area sheets
  would falsely register `role_assigned=False` for rate/amount families.
- 4 new `--self-test` cases (Cases 4-7): all-source-blank, all-source-present-and-parsed,
  mixed-with-1-parser-bug, role-unassigned-ignores-phantom-flags. Total: 7 cases, all PASS.

**Chore #2 (63bead94) --- two-mode output + `_run_mode` extraction:**

- Extracted `_run_mode(reader, wp, fname, sheet_name, header_row, hrc, hcells)` helper.
  Builds SheetConfig, runs `auto_guess_sheet_config` with given hrc, parses the sheet,
  collects the full 4-bucket metric per role family. Returns result dict or
  `_load_exception_result` on exception.
- `_run_target()` calls `_run_mode` twice: Mode 1 (`hrc=None`, production auto-detect)
  and Mode 2 (`hrc=1`, forced-debug). Output JSON structure:
  `diagnostic.mode_1_auto_detect` + `diagnostic.mode_2_hrc_1`.
- `_render_txt` rewritten with two-mode blocks per target.
- Module docstring rewritten to document 4-bucket metric definition and two-mode design intent.
- Output filenames unchanged: `single_area_triage_1_9j_output.{json,txt}`.

**Key empirical finding (Chore #2):** All 11 targets show zero Mode 1 vs Mode 2 delta.
Paytm HVAC's 150 `source_present_but_unparsed` qty rows are a parser-side text-coercion
issue, not a header-detection issue. Column D "QNT" has text values in those rows that
numeric coercion fails on. A two-row-header fix (Mode A) would not help --- `hrc=2`
auto-detect already fires correctly; forcing `hrc=1` produces identical metrics.
Investigation of the coercion gap is queued as Phase 1.9q candidate
(requires ground-truth pass per agreement #28).

**Test impact:** Parser tests 375 unchanged. `--self-test` total: 7 synthetic cases,
all PASS. No new files in `tests/`. Kept in-script so parser test count stays at 375.

**Status:** CLOSED. Chore commits: `78ea7d49` (Chore #1), `63bead94` (Chore #2).
Docs commit see git log.

### Phase 1.9p --- append_to_notes keyword auto-assignment ✅ COMPLETE

**What landed:** Added `append_to_notes` as a new key in `_HEADER_KW`
(classifier.py) with 12 reference-code keyword entries:
`ref no`, `refno`, `ref no.`, `ref. no`, `ref. no.`, `ref code`,
`ref number`, `reference`, `dsr`, `ndsr`, `code`, `item code`.
Synced `_CLASSIFIER_HEADER_KW` replica in classifier_audit.py per agreement #21.

**Why no _auto_guess.py change was needed:** Pre-flight code verification at tip
62e676e0 confirmed the existing Phase 1 longest-match loop (post-1.9l) correctly
handles `append_to_notes` without any guard blocks:
- `append_to_notes` is NOT in `_SINGLETON_ROLES` → multi-column assignment works.
- `append_to_notes` is NOT in `_PER_AREA_ONLY_ROLES` → universal role,
  assigned in Phase 1 (single-area path), not Phase 2 (per-area-only).

**Section 7.34 framing evolution (two-layer model):** Reference-code columns
(`Ref No`, `DSR`, `NDSR`, `Code`, etc.) are the first bounded carve-out from the
original "parser never auto-detects append_to_notes" rule. The revised model:
- Layer 1 (parser): auto-detects the bounded reference-code keyword family.
- Layer 2 (wizard): remains authoritative on user intent; wizard can
  confirm, override, or add any append_to_notes assignment.
Formal section 7.34 amendment owed in the handover doc on next chat-Claude cycle
per agreement #17 (manual sync).

**Longest-match-wins guards confirmed:** `DSR Rate` (8c) beats `dsr` (3c) →
stays rate_supply. `NDSR Rate` (9c) beats `ndsr` (4c) → stays rate_install.
`Material Code` (13c) beats `code` (4c) → stays make_model.

**Tests landed:** 11 in test_classifier.py `TestPhase1_9pAppendToNotesKeywords`
(9 positive recognition + 2 longest-match-wins regression). 7 in test_auto_guess.py
`TestPhase1_9pAppendToNotesAutoGuess` (3 positive auto-assign + 1 multi-column
lock-in + 3 longest-match-wins regression). Total: +18 (357 → 375).

**Audit regression check (agreement #25):** Pre-1.9p baseline with current corpus
(28 fixtures, 343 sheets): classified=4663, unclassified=12926,
unique_unclassified=2598. Post-1.9p: classified=4789, unclassified=12800,
unique_unclassified=2580. Delta: classified +126, unclassified -126, unique -18.
Direction correct. Magnitude +126 slightly above expected +20-+100 range but
plausible for reference-code family (DSR/NDSR/Reference/Code headers appear across
multiple sheets in the 28-fixture corpus). Note: direct comparison to the v5.18
baseline (3970/10709/2536) is not meaningful because the fixture corpus grew by
4 files between the committed audit snapshot and the current state; the stash-based
pre/post delta method was used instead to isolate the 1.9p contribution.

**Agreement #27 verified:** No diagnostic-script changes made. Agreement still holds.

**Feat commit:** `5d348e4a`

### Phase 1.9o --- Tier A-merged pattern recognizer (3-change feat) ✅ COMPLETE

**Three coupled changes in two files:**

**Change 1 (_auto_guess.py):** Added `amount_supply` and `amount_install` to
`_SINGLETON_ROLES` frozenset (2 new entries). Prevents duplicate singleton
assignment when a bottom header row contains both a Supply Amount and an
Install Amount column.

**Change 2+3 (multi_area_detection.py) --- unified `_try_tier_a_merged()`:**
Single function handling two sub-shapes via a top+bottom row scan:
- Qty-merged-over-areas: merged Qty/Quantity/Nos family cell spanning N>=2
  distinct area-name cells in the bottom row yields areas + qty_columns.
- Rate/Amount-merged-over-Supply/Install: merged Rate or Amount family cell
  spanning a Supply-then-Install pair (N=2); when the col count equals n_areas
  the columns are paired left-to-right with area names into rate_columns /
  amount_columns (rate_combined_by_area convention, consistent with
  Pattern 2-rate).

Four new broad regexes added before the dataclass:
`_QTY_CELL_PATTERN_BROAD`, `_AMOUNT_CELL_PATTERN_BROAD`,
`_SUPPLY_CELL_PATTERN`, `_INSTALL_CELL_PATTERN`.
Strict-anchor `_QTY_CELL_PATTERN` and `_AMOUNT_CELL_PATTERN` untouched
(still used by Pattern 2 / Pattern 2-rate).

Routing: `_try_tier_a_merged` inserted as the first step in the 2-row path
(before `_try_pattern_2_rate`).

**Empirical verification:**

v1 (`multi_area_merged_header_v1.xlsx`, ELECTRICAL sheet, hrc=2):
- tier_a_merged fires.
- areas=["Area 1", "Area 2"], E/F=qty per area, G/H=rate_combined_by_area per
  area, I/J=amount_by_area per area. Singletons A/C/D assigned correctly.

v2 (`multi_area_merged_header_v2.xlsx`, ELECTRICAL sheet, hrc=2):
- tier_a_merged returns None (top-row merges have area-name values, not
  Qty/Rate/Amount family text).
- Falls through to Pattern 1 top-row fallback.
- areas=["Area 1", "Area 2"] via E+I qty columns. F=rate_supply, G=rate_install,
  H=amount_total assigned as singletons from bottom row. J/K/L unassigned
  (singleton guard blocks duplicates).

**Tests:** 357 total (baseline 337 + 14 TestTryTierAMerged +
8 TestPhase1_9oChange1SingletonGuard + 5 TestPhase1_9oTierAMergedAutoGuess).
1 existing test calibrated: `test_reserved_keyword_top_row_merges_rejected_for_pattern_2`
updated to assert `tier_a_merged` (not pattern 1) because tier_a_merged now
correctly fires first for a QUANTITY-merge-over-area-names top row.

**Metric-impact review (agreement #27):** No diagnostic script changes needed.
`_AMOUNT_FAMILY_ROLES` already covers amount_supply + amount_install (Change 1
singletons). tier_a_merged's per-area roles (rate_combined_by_area,
amount_by_area) are multi-area only and not tracked by the single-area metric.

**Feat commit:** `6f6214ba`

### Phase 1.9h complete (2026-05-18)

**Auto-guess per-area column-role assignment + diagnostic script refactor.**

- Feat commit: f9a3121e
- Docs commit: see git log (paradox-free per §9 #69)
- Root cause: 1.9e auto-guess skipped area-specific roles with an explicit
  `if matched_role in {"amount_by_area", ...}: continue` guard. Raheja
  Electrical at hrc=2 detected Pattern 2-rate correctly but per-area
  qty/rate/amount came back all-None.
- Fix: extracted auto-guess logic into a shared module
  `nirmaan_stack/services/boq_parser/_auto_guess.py` with two-phase logic:
  Phase 1 (universal roles — singleton-guarded keyword matching, identical
  to prior inline logic); Phase 2 (per-area assignment when
  `detect_multi_area_pattern()` returns non-None at hrc≥2, uses positional
  parallel lists from MultiAreaPattern directly).
- Phase 2 core: for each area in mp.areas, assign qty col → ColumnRole(role="qty",
  area=...), amount col → role="amount_by_area", rate col →
  role="rate_combined_by_area". Override semantics: Phase 2 writes over Phase 1
  for columns inside area spans. area_dimensions set from list(mp.areas).
- Singleton guard preserved: _SINGLETON_ROLES tracking moved into
  `_auto_guess.py`, behavior identical. Verified by new test
  `test_singleton_guard_prevents_duplicate_assignment`.
- Diagnostic scripts refactored: `real_fixture_stress_test.py` and
  `multi_area_triage_1_9f.py` now import from `_auto_guess` and have their
  orphaned inline copies removed.
- New module: `_auto_guess.py` (119 lines). New tests: `test_auto_guess.py`
  (14 tests across 6 test classes).
- Smoke result: 98/100 LINE_ITEMs in Raheja Electrical have non-None PHASE-1
  qty at hrc=2; 51 have non-None PHASE-2 qty. rate=None expected (unpriced
  BoQ). amount=0.0 (zero values in cells).
- Parser tests: 291 passing, 0 failures (277 prior + 14 new).
- Frappe tests: not run (no Frappe code touched, per agreement #20).
- Next step: Phase 2c body (§17.13 wizard-load or next queued item).

### Phase 1.9g complete (2026-05-18)

**Pre-header rows skip fix in orchestrator + 3 new tests + snitch_electrical_expected.json calibration.**

- Feat commit: 40fb555c
- Docs commit: see git log (paradox-free per §9 #69)
- Root cause: `raw_rows` list comprehension in `parse_boq()` only excluded
  `header_row` and declared skip rows; rows before `header_row` (e.g. title
  banners, disclaimer notes in Excel rows 1..header_row-1) were incorrectly
  classified as data.
- Fix: added `and (header_row is None or rr.row_number >= header_row)` guard
  to the list comprehension in orchestrator.py.
- New tests (3, class TestPreHeaderSkip): row 1 absent when header_row=2
  (multi_area_2row fixture), row 1 absent for Pattern 2-rate fixture, no-op
  confirmed when header_row=1 (simple fixture).
- Test calibration: 7. Light Fixtures (snitch_electrical_expected.json) had
  a bold disclaimer banner at Excel row 1 (pre-header). Calibration updates:
  total_resolved_row_count 16→15; first_5_line_items, subtotal_markers, and
  row_16_preamble_anomaly resolved_idx values all shift by -1; path strings
  shift by -1 (path = str(resolved_list_append_idx)); row count in
  test_snitch_light_fixtures_total_resolved_row_count updated 16→15.
- Self-report item 26: Excel row 1 of "7. Light Fixtures" — sl_no=None,
  A1="* QUANTITIES AND SPECS TO BE UPDATED LATER AS PER THE RCP LAYOUT.
  CURRENT QTYS KEPT ARE ASSUMPTION BASED." (bold), G1="2) BUDGET SPECS"
  (bold, yellow fill). No qty value. Pre-header content confirmed.
- Parser tests: 277 passing, 0 failures (274 prior + 3 new).
- Frappe tests: not run (no Frappe code touched, per agreement #20).
- 4 new synthetic fixtures now tracked in git (previously untracked since
  Phase 1.9d): synthetic_multi_area.xlsx, synthetic_multi_area_2row.xlsx,
  synthetic_pattern_2_rate.xlsx, synthetic_pattern_2_rate_plural.xlsx.
- Next step: Phase 2c body (§17.13 wizard-load or next queued item).

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
