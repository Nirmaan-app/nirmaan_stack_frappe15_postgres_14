# CLAUDE.md — Nirmaan Stack

**Last updated:** 2026-05-20 IST (chore 9d4abf36, expanded-subset retest --- 15 targets + Chore #2 snapshot)

## Overview

Nirmaan Stack is a construction project management and procurement ERP built on Frappe v15+ (Python 3.10+, PostgreSQL 14). The backend exposes whitelisted Python APIs consumed by a React 18 + TypeScript SPA. Core domains: Procurement (PR → RFQ → PO → DC/DN), Projects, Vendor Management, Service Requests, Financial Tracking, Inventory, and Document AI invoice autofill.

---

## Tech Stack

- **Backend:** Frappe v15+, Python 3.10+, PostgreSQL 14.11 (never MariaDB), Redis, Socket.IO
- **Frontend:** React 18, TypeScript 5, Vite 5, React Router v6, `frappe-react-sdk 1.7`
- **UI:** shadcn/ui (primary) + Ant Design 5 (selective), TailwindCSS 3
- **State:** Zustand 5, React Hook Form + Zod, TanStack Table v8
- **Infra:** Firebase 10 (FCM push), GCP Document AI (invoice OCR), Sentry 10

---

## App / Module Map

```
nirmaan_stack/
├── nirmaan_stack/doctype/   # 84 custom doctypes — data models and JSON schemas
├── api/                     # @frappe.whitelist() endpoints (35+ files, snake_case names)
├── integrations/
│   ├── controllers/         # ALL doc lifecycle hooks — after_insert, on_update, etc.
│   ├── firebase/            # FCM push notification dispatch
│   └── Notifications/       # In-app notification logic
├── services/                # Reusable business logic (document_ai.py, finance.py)
├── tasks/                   # Scheduled jobs: daily item status, 10 AM vendor credit cron
├── www/                     # Serves frontend.html (SPA entry) and boot API
├── patches/                 # DB migrations v1_5 → v3_0 (append-only)
└── hooks.py                 # App wiring: doc_events, scheduled tasks, fixtures
```

Frontend lives in `frontend/src/`:
- `pages/` — route-level components, one folder per domain
- `components/ui/` — shadcn/ui primitives (generated, don't hand-edit)
- `zustand/` — global state stores
- `components/helpers/routesConfig.tsx` — all route definitions

---

## Coding Conventions

### Python
- **Lifecycle hooks:** Always in `integrations/controllers/<doctype>.py`. Never in doctype `*.py` files.
- **Doctype `*.py` files:** Only `autoname` and simple `validate`. Nothing else.
- **API modules:** `snake_case` filenames under `api/<feature>/`. Never hyphens.
- **File size:** Split any file exceeding ~500 lines into focused submodules.
- **Child Tables:** For relational, queryable data (items, payment terms, ledger entries).
- **JSON Fields:** For flexible, UI-driven data (category lists, RFQ metadata).
- **Transactions:** `frappe.db.commit()` after any DML in whitelisted methods. Call it **before** `publish_realtime()` to avoid race conditions.

### TypeScript
- All Frappe data access via `frappe-react-sdk`: `useFrappeGetDocList`, `useFrappeGetDoc`, `useFrappePostCall`.
- Backend mutations: `useFrappePostCall('nirmaan_stack.api.<module>.<method>')`.
- Real-time events named `{doctype}:{action}` (e.g. `po:new`, `pr:approved`).
- **Do not introduce new UI libraries.** Stay within shadcn/ui + TanStack Table + Zustand + React Hook Form + Zod.

---

## PostgreSQL Gotchas

1. **Reserved keyword:** Always quote `"user"` in raw SQL.
2. **JSON field filters:** `frappe.get_all()` cannot use `!=` or `is set` on JSON fields. Use raw SQL: `WHERE json_col IS NOT NULL` with double-quoted table names (`"tabDoctype"`).
3. **Child table filtering:** `frappe.get_all()` filters at the **parent** level — if any child row matches, all rows of that parent are returned. For row-level filtering, use SQL JOINs. See `api/credits/get_credits_list.py`.
4. **rename_doc():** Only updates Link fields. Data fields storing document names need manual SQL.

---

## Domain Gotchas

- **PO Delivery Documents** are polymorphic: `parent_doctype` = `"Procurement Orders"` or `"Internal Transfer Memo"`. Always filter by `parent_doctype`; use `parent_docname` (not legacy `procurement_order` field).
- **Vendor credit status:** `recalculate_vendor_credit()` never sets `vendor_status` to On-Hold. Only the daily 10 AM cron does that. The function can auto-clear On-Hold → Active.
- **CEO Hold:** Only `nitesh@nirmaan.app` may set/unset — enforced in `integrations/controllers/projects.py`, not role-based.
- **Invoice Autofill:** Opt-in only via InvoiceDialog. Never recreate `services/file_extractor.py` or the `DocumentSearch` page — both intentionally deleted.
- **Email ops:** Use `api/users.create_user` and `api/users.reset_password` — these decouple email from the core operation.
- **Administrator user:** Name is the literal string `"Administrator"`, not an email. Handle explicitly in rename/delete logic.

---

## Commands

```bash
# Dev server (from frappe-bench directory)
bench start                          # Backend :8000, Socket.IO :9000

# Database
bench --site localhost migrate        # Run pending patches
bench --site localhost clear-cache    # Flush Redis

# Assets / doctypes
bench build
bench new-doctype "Name"

# Tests
bench run-tests --app nirmaan_stack
```

**Ad-hoc DB queries from host** (bench CLI broken on host — click version mismatch):
```bash
cat > /tmp/q.py <<'EOF'
import os; os.chdir('/workspace/development/frappe-bench/sites')
import frappe; frappe.init(site='localhost'); frappe.connect()
# ... query ...
frappe.destroy()
EOF
docker cp /tmp/q.py frappe_docker_devcontainer-frappe-1:/tmp/q.py
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 env/bin/python /tmp/q.py
```
`os.chdir` to `sites/` is **required** before `frappe.init()`.

---

## Testing Conventions

- **Framework:** `frappe.tests.utils.FrappeTestCase` (Python unittest subclass).
- **Location:** `nirmaan_stack/nirmaan_stack/doctype/<name>/test_<name>.py` — co-located with each doctype.
- **Existing tests:** Nearly all are empty stubs. Don't rely on them to catch regressions.
- **New code:** Pure-Python modules (parsers, services) must have real unit tests with fixture files. No stubs for logic-bearing code.
- **Frontend E2E:** Cypress 13.7 configured in `frontend/cypress.config.ts` — largely unimplemented.
- **After editing any doctype JSON:** Always run `bench --site localhost migrate`. Tests use a separate test database that auto-migrates, so **passing tests do not guarantee the runtime database has the new column**. Verify with `frappe.db.has_column("DocType Name", "field_name")` in the bench console after migration.

---

## Don't Touch

| Path | Reason |
|---|---|
| `nirmaan_stack/nirmaan_stack/doctype/*/*.json` | Auto-generated by Frappe — edit via Desk UI or bench tooling only |
| `patches/` | Append-only migration history — never modify existing files |
| `www/frontend.html` | Auto-generated SPA shell |
| `frontend/src/components/ui/` | shadcn/ui generated components — update via shadcn CLI |
| `nirmaan_stack/public/` | Compiled frontend assets — edit source in `frontend/src/` instead |
| `services/file_extractor.py` | Intentionally deleted — do not recreate |

---

## Active Features

| Feature | Branch | Spec | Status |
|---|---|---|---|
| BoQ Upload & Management | `feature/boq-phase-2` | `frontend/.claude/plans/boq-upload-plan.md` | Phase 1.8 ✅ COMPLETE (88 Phase 1.x Frappe tests; 237 parser tests unchanged). Phase 1.9a ✅ COMPLETE (249 parser tests). Phase 1.9b ✅ COMPLETE (257 parser tests; append_to_notes ColumnRole + append_notes_raw on ClassifiedRow + column_headers on SheetConfig). Phase 1.9c ✅ COMPLETE (267 parser tests; 2 expectedFailure: F3b RATES-plural + F5 HVAC header gap; D-Tech PHASE-0 banner resolved via skip_top_rows_after_header=[1]). Phase 1.8.1 ✅ COMPLETE (91 Phase 1.x Frappe tests; F1 partial-rate guard tests added; F2 Desk-save audit fixed — edit_reason gate removed, defaults to "Desk edit", _NULLABLE_NUMERIC_FIELDS normalization added). Phase 2c next (unblocked). §7.34 append_to_notes ColumnRole parser-wired (commit merge in 2c, UX in Phase 3). DB commit + version cascade is post-1.9 task. Phase 1.9d ✅ COMPLETE (274 parser tests; F3b RATES-plural regex widened; F5-b SheetConfig.top_header_rows_override added; Raheja Electrical + HVAC integration tests pass; Pattern 6 forward-compat captured). Phase 1.9e ✅ COMPLETE (68 sheets parsed across 25 workbooks; observability-only chore; no parser code changes; 274 parser tests unchanged). Phase 1.9g ✅ COMPLETE (277 parser tests; pre-header rows skip fix — rows with row_number < header_row now unconditionally excluded from data classification; 3 new TestPreHeaderSkip tests; snitch_electrical_expected.json calibrated — 7. Light Fixtures total_resolved_row_count 16→15, resolved_idx values shift -1). Phase 1.9h ✅ COMPLETE (291 parser tests; auto-guess per-area column-role assignment — extracted `_auto_guess.py` module with two-phase logic: Phase 1 universal-role keyword matching + singleton guard, Phase 2 per-area assignment from MultiAreaPattern parallel lists at hrc≥2; fixes Raheja Electrical per-area qty/rate/amount all-None at hrc=2; `real_fixture_stress_test.py` + `multi_area_triage_1_9f.py` orphaned inline copies removed; 14 new tests in `test_auto_guess.py`; singleton guard preserved and verified by `test_singleton_guard_prevents_duplicate_assignment`). Phase 1.9i ✅ COMPLETE (291 parser tests unchanged; single-area-targeted diagnostic on 11 sheets at hrc=1; observability-only — no parser source touched; all 11 classified single-area, 0 load exceptions, 163 null role assignments, 100% non-None qty across all targets; chore 7d588976). Phase 1.9j ✅ COMPLETE (291 parser tests unchanged; Mode C diagnostic metric fix — replaced broken non_none_qty metric with three mutually-exclusive counts per role family; real/zero_default/role_unassigned summing to total; sum invariant asserted; --self-test added; 723/2372 line items have qty role_unassigned — Paytm ELEC+HVAC Mode A; chore 68befb2e). Phase 1.9k ✅ COMPLETE (312 parser tests; Mode B: QNT+QNT.→qty, UM→unit, 10 additional entries: sl no/sq.ft/sqm/rmt/rft/mtr/set/each/no's; Mode F: rstrip(".:") normalization in header-repeat step — classified 3255→3970 (+715); F3c: _RATE_CELL_PATTERN broadened to word-boundary rate/cost/price family + .search(); classifier_audit.py synced; 21 new tests; feat 3cc3819c). Phase 1.9l ✅ COMPLETE (324 parser tests; Mode D: _auto_guess.py Phase 1 matcher rewritten to longest-matched-keyword-wins precedence — fixes "Supply Rate" mis-labeled as rate_combined; classifier_audit.py _match_role() synced per agreement #21; classifier.py not touched — HEADER_REPEAT checker has different semantics; 12 new tests in TestPhase1_9lModeDPrecedence (10 auto_guess + 2 classifier spot-checks); 0 test calibrations; audit top-level stats flat 3970/10709/2536; feat f00cc6ca). Phase 1.9m ✅ COMPLETE (337 parser tests; Mode A: _should_auto_promote_hrc_to_2() helper added to _auto_guess.py; auto_guess_sheet_config() signature changed to header_row_count: int | None = None + reserved_keywords: list[str] | None = None — pass None to enable auto-detect, explicit int bypasses; heuristic: ≥3 non-blank cells + adjacent-column duplicate-text pair + above/below row has distinct text at those cols; 13 new tests (8 helper unit tests + 5 integration); 0 calibrations; audit stats flat 3970/10709/2536; feat c08ebd13). Phase 1.9n ✅ COMPLETE (337 parser tests unchanged; diagnostic-script-only re-run on 9 targets (3-11); --subset 1_9n CLI flag added to single_area_triage_1_9i.py; _QTY_FAMILY_ROLES widened to include qty_total — Phase 1.9l Mode D correctly classifies "Total Qty" as qty_total, which was excluded from the 1.9j metric definition causing spurious regressions for Kohler HVAC + Inovalon + Electrical Unpriced; corrected aggregate qty_unassigned 723→553 (−170, Paytm HVAC improved via Mode B QNT synonym); Paytm ELEC remains sole residual at 553 unassigned; clean-parse count 2-of-9; chore 3af8e828). The 1.9j-1.9n locked cycle is now complete. Next: strategic re-evaluation chat (v5.17 §22.8). Phase 1.9o ✅ COMPLETE (357 parser tests; Tier A-merged pattern recognizer: Change 1 --- amount_supply + amount_install added to _SINGLETON_ROLES in _auto_guess.py; Change 2+3 --- unified _try_tier_a_merged() in multi_area_detection.py handles Qty-merged-over-areas and Rate/Amount-merged-over-Supply/Install sub-shapes; 4 new broad regexes _QTY_CELL_PATTERN_BROAD/_AMOUNT_CELL_PATTERN_BROAD/_SUPPLY_CELL_PATTERN/_INSTALL_CELL_PATTERN; routing: tier_a_merged fires first in 2-row path; 20 new tests (14 TestTryTierAMerged + 8 TestPhase1_9oChange1SingletonGuard + 5 TestPhase1_9oTierAMergedAutoGuess --- overlap in count due to class grouping); 1 existing test calibrated; empirical: v1 fixture ELECTRICAL sheet tier_a_merged fires with G/H=rate_combined_by_area + I/J=amount_by_area; v2 fixture falls through to Pattern 1 top-row; feat 6f6214ba). Phase 1.9p ✅ COMPLETE (375 parser tests; append_to_notes keyword auto-assignment: new _HEADER_KW key with 12 reference-code entries (ref no, refno, ref no., ref. no, ref. no., ref code, ref number, reference, dsr, ndsr, code, item code); _CLASSIFIER_HEADER_KW replica synced per agreement #21; no _auto_guess.py changes --- existing Phase 1 longest-match loop (post-1.9l) correctly handles non-singleton non-per-area-only roles; longest-match-wins guards confirmed: DSR Rate→rate_supply, NDSR Rate→rate_install, Material Code→make_model; 11 new tests TestPhase1_9pAppendToNotesKeywords (classifier) + 7 new tests TestPhase1_9pAppendToNotesAutoGuess (auto_guess); section 7.34 framing: bounded reference-code family is first carve-out from "never auto-detect" rule --- two-layer model (parser auto-detects + wizard authoritative); audit delta classified +126 / unclassified -126 / unique -18 (stash-based pre/post isolation used due to corpus growth); feat 5d348e4a). Diagnostic metric repair Chore #1 ✅ COMPLETE (375 parser tests unchanged; 4th metric bucket source_present_but_unparsed added to _role_metric() --- distinguishes "BoQ unpriced" from "parser failed to parse a present value"; _source_present_for_family() helper walks column_role_map + raw_row.cells; multi-area role names rate_combined_by_area/rate_supply_by_area/rate_install_by_area/amount_by_area added to family frozensets; 4 new --self-test cases Cases 4-7 --- total 7 cases all PASS; chore 78ea7d49). Diagnostic metric repair Chore #2 ✅ COMPLETE (375 parser tests unchanged; _run_mode() helper extracted; _run_target() calls it twice: Mode 1 hrc=None auto-detect + Mode 2 hrc=1 forced-debug; output JSON diagnostic.mode_1_auto_detect + diagnostic.mode_2_hrc_1; _render_txt rewritten with two-mode blocks; module docstring rewritten; key empirical finding: all 11 targets show zero Mode 1 vs Mode 2 delta --- Paytm HVAC 150-row source_present_but_unparsed gap is parser-side text-coercion not header-detection; Phase 1.9q candidate queued (ground-truth pass required per agreement #28); chore 63bead94). Expanded-subset retest ✅ COMPLETE (single-file chore extending TARGETS list 11 to 15 with the 4 multi-area fixtures specified by Nitesh: merged_header_v1 / merged_header_v2 / single_header_v1 / single_header_v2 paired with ELECTRICAL & ELV BOQ or HVAC BOQ as appropriate; introduces diagnostic_snapshots/ folder convention for preserving historical runs; Chore #2 smoke output snapshotted as chore_2_smoke_run.{json,txt} before regeneration; key finding: all 4 new fixture .xlsx files absent from tests/fixtures/ --- FileNotFoundError on both modes for all 4 targets, no parse data collected; 11 existing targets identical to Chore #2 snapshot; Tier A-merged did not fire (no files to parse); parser tests 375 unchanged; chore 9d4abf36; closes v5.19 queue position 3). |

Always read `frontend/.claude/plans/boq-upload-plan.md` before working on BoQ. Active doctypes: `BOQs`, `BOQ Nodes`, `BOQ Node Qty By Area` (no separate audit doctype — audit goes through `Nirmaan Versions` per §7 of the BoQ handover doc / decisions log). Phased build (Phase 0 → 7) — don't implement Phase N+1 functionality while working in Phase N. Phase 2 sub-phase split: 2a → 2b.1a → 2b.1b → 2b.2 (A1, A2, A3, B) → 2c.

---

## Working with Claude Code

- Read `docs/<feature>/spec.md` and the latest entries in `decisions.md` before starting any feature phase.
- **Output a written plan before writing any code. Never write code in the same turn as the plan.** Wait for user review.
- One branch per phase: `feature/<feature>-phase-<N>`. Commit at end of each phase.
- New doctypes: controllers go in `integrations/controllers/`. Doctype `*.py` stays minimal.
- New APIs: `nirmaan_stack/api/<feature>/<file>.py`, snake_case.
- Frontend: stay within the existing stack (shadcn/ui + TanStack Table + Zustand + frappe-react-sdk + React Hook Form + Zod). Do not introduce new UI libraries.
- Pure-Python modules (parsers, services) get real unit tests with fixture files — not stubs.

---

## Reference Docs

| Domain | File |
|---|---|
| Full context index | `.claude/context/_index.md` |
| Doctypes | `.claude/context/doctypes.md` |
| APIs | `.claude/context/apis.md` |
| Procurement (PR/PO/RFQ) | `.claude/context/domain/procurement.md` |
| Projects | `.claude/context/domain/projects.md` |
| Service Requests | `.claude/context/domain/service-requests.md` |
| Internal Transfer Memos | `.claude/context/domain/internal-transfer-memos.md` |
| Invoice Autofill | `.claude/context/domain/invoice-autofill.md` |
| Vendor Hold | `frontend/.claude/context/domain/vendor-hold.md` |
| Frontend domain context (full) | `frontend/.claude/context/_index.md` |
| Session changelog | `.claude/CHANGELOG.md` |
