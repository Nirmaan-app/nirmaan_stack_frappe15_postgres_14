# CLAUDE.md — Nirmaan Stack

**Last updated:** 2026-06-05 (Bucket-1 zone-differentiation follow-up -- frontend-only styling, no backend/convention impact on root; feat 1ec901e7; see plan-doc + frontend/CLAUDE.md for full record) **Frontend conventions file: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**

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
  - Subdirectories under `api/<feature>/` are acceptable for sub-area grouping (e.g. `api/boq/wizard/upload_file.py`). Use them when a feature has multiple sub-areas that benefit from logical grouping.
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
- **Frappe child-table serialization depth:** `frappe.get_doc` / the REST resource API hydrate child tables ONE LEVEL DEEP ONLY. A child-of-a-child (grandchild) Table field is NOT returned. When a doctype has a child table that itself has a child table, the grandchild needs an explicit read path (a whitelisted endpoint querying the grandchild doctype directly via `frappe.db.get_all`). Example: BoQ Sheet Draft.work_packages required `get_boq_work_packages` (`api/boq/wizard/update_sheet_draft.py`).

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

**Windows quirk:** prefix `MSYS_NO_PATHCONV=1` on all `docker exec` and `docker cp` commands when passing UNIX-style paths through Git Bash. Bash tool on Windows otherwise translates `/tmp/...` → `C:/Users/.../Temp/...`. See handover §9 #93 + §11 #33.

### BoQ env / testing procedures

For BoQ Upload dev-environment setup, clean bench-restart sequence, the CSRF clear-site-data login fix, the two-port (:8080 live / :8000 stale) rule, and manual read-only DB-inspect (PostgreSQL, run-from-sites-dir): see `BoQ_Environment_Testing_Runbook_v1_0.md` (in project knowledge). Source of truth remains handover doc §9 #118-#123 + caveats TT/UU/VV/WW; the Runbook is a convenience digest.

---

## Testing Conventions

- **Framework:** `frappe.tests.utils.FrappeTestCase` (Python unittest subclass).
- **Location:** `nirmaan_stack/nirmaan_stack/doctype/<name>/test_<name>.py` — co-located with each doctype.
- **Existing tests:** Nearly all are empty stubs. Don't rely on them to catch regressions.
- **New code:** Pure-Python modules (parsers, services) must have real unit tests with fixture files. No stubs for logic-bearing code.
- **Frontend E2E:** Cypress 13.7 configured in `frontend/cypress.config.ts` — largely unimplemented.
- **After editing any doctype JSON:** Always run `bench --site localhost migrate`. Tests use a separate test database that auto-migrates, so **passing tests do not guarantee the runtime database has the new column**. Verify with `frappe.db.has_column("DocType Name", "field_name")` in the bench console after migration.

### Projects row fixture pattern

Tests that need a Projects row in `setUpClass` must satisfy the legacy `Projects.after_insert` hook (`generate_pwm` in `doctype/project_work_milestones/project_work_milestones.py`). The hook requires `project_start_date` + `project_end_date` in `"YYYY-MM-DD HH:MM:SS"` format and `project_scopes` as a dict with a `"scopes"` key.

Working pattern:

```python
@classmethod
def setUpClass(cls):
    super().setUpClass()
    cls.test_project = frappe.new_doc("Projects")
    cls.test_project.project_name = f"TEST_<feature>_{frappe.generate_hash(length=6)}"
    cls.test_project.project_start_date = frappe.utils.now()[:19]
    cls.test_project.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    cls.test_project.project_scopes = {"scopes": []}
    cls.test_project.insert(ignore_permissions=True)
    frappe.db.commit()

@classmethod
def tearDownClass(cls):
    # Delete child rows (BOQs etc.) first, then the project
    frappe.delete_doc("Projects", cls.test_project.name, force=True, ignore_permissions=True)
    frappe.db.commit()
    super().tearDownClass()
```

Why `[:19]` truncation: `frappe.utils.now()` returns microsecond-precision strings (e.g. `"2026-05-29 12:30:45.581159"`); `generate_pwm` calls `strptime(..., "%Y-%m-%d %H:%M:%S")` which rejects them. `add_to_date` return values need the same truncation. Empty `{"scopes": []}` makes `generate_pwm` run but produce zero milestones — correct for test isolation. Origin: Module 1a 2026-05-29.

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

**Sanctioned exception:** A doctype JSON field's `fieldtype` MAY be changed via a deliberate, reviewed, committed CC edit + `bench migrate` when a schema constraint must be corrected (e.g. `source_file_url` Data->Small Text, fix 3815ea3f, 2026-05-30). Any such change must be isolated to the minimum field diff and explicitly noted here.

---

## Active Features

| Feature | Branch | Spec | Status |
|---|---|---|---|
| BoQ Upload & Management | `feature/boq-phase-3` | `frontend/.claude/plans/boq-upload-plan.md` | Phases 1.x (parser, 588 tests) + Phase 3 Module 1a/1b + Module 2a COMPLETE. Parse-run Phase 1 IN PROGRESS -- latest landed slice: Bucket-1 zone-differentiation follow-up (spoke config/details zones boxed + secondary zone tinted; frontend-only styling; feat 1ec901e7; Vite build exit 0). Wizard tests: 163 total (test_parse_run 55 + test_update_sheet_draft 66 + test_update_boq_draft 7 + test_sheet_preview 23 + test_upload_file 12); frontend slices verified by tsc + Vite build. Full sub-phase history + as-built detail: see boq-upload-plan.md (per-slice sections). Do not duplicate the changelog here. |

Always read `frontend/.claude/plans/boq-upload-plan.md` before working on BoQ. Active doctypes: `BOQs`, `BOQ Nodes`, `BOQ Node Qty By Area` (no separate audit doctype — audit goes through `Nirmaan Versions` per §7 of the BoQ handover doc / decisions log). Phased build (Phase 0 → 7) — don't implement Phase N+1 functionality while working in Phase N. Phase 2 sub-phase split: 2a → 2b.1a → 2b.1b → 2b.2 (A1, A2, A3, B) → 2c.

---

## Working with Claude Code

- Read `docs/<feature>/spec.md` and the latest entries in `decisions.md` before starting any feature phase.
- **Output a written plan before writing any code. Never write code in the same turn as the plan.** Wait for user review.
- One branch per phase: `feature/<feature>-phase-<N>`. Commit at end of each phase.
  - Phase 3 (wizard) is active on `feature/boq-phase-3`, branched from `feature/boq-phase-2` tip `2e338b36` (2026-05-29). Pre-v5.30 "Phase 2c body" framing superseded — wizard work is Phase 3. `feature/boq-phase-2` is frozen at `2e338b36`.
- New doctypes: controllers go in `integrations/controllers/`. Doctype `*.py` stays minimal.
- New APIs: `nirmaan_stack/api/<feature>/<file>.py`, snake_case.
- Frontend: stay within the existing stack (shadcn/ui + TanStack Table + Zustand + frappe-react-sdk + React Hook Form + Zod). Do not introduce new UI libraries.
- Pure-Python modules (parsers, services) get real unit tests with fixture files — not stubs.

**Docs discipline -- DOCS-UPDATE RULE (all three, every commit):** Every docs or feat+docs commit updates ALL THREE docs -- `frontend/.claude/plans/boq-upload-plan.md`, root `CLAUDE.md` (this file), and `frontend/CLAUDE.md` -- with NO exceptions. A doc not substantively affected still gets a MINIMAL TOUCH (bump its last-updated/status line + a one-line note of what landed), never a skip. Rationale: "update CLAUDE.md" without naming which one let `frontend/CLAUDE.md` silently fall a full module behind (stale through all of Module 2b). Naming all three by full path removes the routing ambiguity. **Frontend conventions file: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**

---

## BoQ File Reading (S3 safety)

The BoQ upload worker (`api/boq/wizard/upload_file.py`) reads the uploaded file from a `NamedTemporaryFile` written from the in-memory bytes at the endpoint — NOT by constructing a local path from `file_url`. `Frappe File.get_content()` reads local disk only and breaks when `frappe_s3_attachment` is active (it replaces `file_url` with an `/api/method/...` API URL after insert). Any future code that needs to read an uploaded file's bytes should follow the same pattern: capture bytes before `save_file()`, write to a tempfile, clean up in a `finally` block.

## BoQ Upload Worker -- auto-guess prefill (Step 10.5)

After `boq_doc.insert()` (Step 10, which assigns child-row names), the worker runs a prefill step for every **Pending** sheet draft:

1. `reader.detect_header_row(sheet_name)` — heuristic keyword-scoring scan of the first 15 rows; returns `int | None`.
2. If a row is found: `auto_guess_sheet_config(reader, sheet_name, header_row)` from `nirmaan_stack.services.boq_parser._auto_guess`. Returns a `SheetConfig` Pydantic model.
3. `frappe.db.set_value("BoQ Sheet Draft", draft.name, "sheet_config", json.dumps(detected.model_dump()))` — writes the full SheetConfig (including `column_role_map`) as JSON.

**Failure-isolation rule (enforced by try/except):** an exception in step 1, 2, or 3 calls `frappe.log_error()` and leaves `sheet_config = None` for that sheet. The upload never fails because of a bad auto-guess. This is intentional: the wizard spoke's sparkle UX handles wrong guesses; a failed guess falls back to the empty-panel behavior.

**Pending-only scope:** Hidden and Skip sheets (marked by the worker itself based on sheet visibility) are skipped entirely — `detect_header_row` is never called for them.

**Read path:** `useFrappeGetDoc("BOQs", boqName)` returns the full doc including the prefilled `sheet_config` on each child row. The frontend's `SheetConfigPanel` reads `draft.sheet_config` and shows sparkle on all pre-filled fields.

---

## Wizard scope discipline (Phase 3 onward)

When a wizard decision has two paths — (a) build the capability inside the wizard, or (b) defer to or extend an existing app-wide flow — surface the fork explicitly in chat before writing code. Default lean: if the capability has reach beyond the Upload BoQ flow (i.e., other Nirmaan features would benefit from it), keep it outside wizard scope. The lean is a starting point only; the final call is case-by-case after discussion.

Common triggers: anything touching shared doctypes (Projects, Customers, Work Headers) in ways other features would also want; new app-wide UI patterns (sidebar items, top nav, modals); auth checks, audit, or notification flows other modules would benefit from.

Origin: Module 1a 2026-05-29 — `create_tendering_project` was initially scoped into the wizard, then dropped when this principle surfaced: tendering project creation has reach beyond the wizard and belongs in the existing Nirmaan new-project workflow.

---

## Wizard Endpoints Reference (Phase 3 Module 2a onward)

All wizard endpoints live in `nirmaan_stack/api/boq/wizard/`. All use `@frappe.whitelist(methods=["POST"])`, return `{"status": "saved"}`, call `frappe.db.commit()` after `frappe.db.set_value`.

**`update_sheet_draft.py`** (feat 5cdbbd16 + b14e9015) -- 5 functions:

- `set_sheet_status(boq_name, sheet_name, status)` -- sets `wizard_status` on the matching `BoQ Sheet Draft` child row. Allowed values (direct): Pending, Hidden, Reviewed, Skip, Parse failed. "General specs" is REJECTED here; caller must use `set_general_specs_sheet` instead (backend never writes "General specs" to wizard_status; frontend derives the badge from the pointer). URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_status`

- `set_sheet_label(boq_name, sheet_name, label)` -- sets/clears the optional `sheet_label` Data field. label=None or "" both clear. URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_label`

- `set_general_specs_sheet(boq_name, sheet_name_or_none)` -- (Slice 2c) designates / un-designates a sheet as general-specs using replace-all child-table semantics: designating removes all existing `BoQ General Specs Sheet` child rows and inserts one new row; un-designating (None or "") removes all rows. Backend writes child-table membership ONLY -- does NOT touch `wizard_status` on any draft row (M2.23 unchanged). Frontend derives "General specs" badge from the child table and handles warn-and-confirm. Un-designation removes the child row (preamble_text is re-extractable on re-parse). Full multi-select (additive) semantics are Slice 2b. URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_general_specs_sheet`

- `set_sheet_config(boq_name, sheet_name, sheet_config)` -- (feat b14e9015) writes per-sheet parser config JSON blob to `BoQ Sheet Draft.sheet_config`. Accepts dict or JSON string. Single JSON blob by design (wizard-internal; M3.18/§6.3). URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_config`

- `set_sheet_work_packages(boq_name, sheet_name, work_headers)` -- (feat b14e9015) replace-all assignment of Work Headers to a sheet's `work_packages` child table. `work_headers` is a list of Work Headers docnames (or JSON-string list). Validates ALL docnames before any write; rejects entire call if any are missing (no partial write). URL: `/api/method/nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_work_packages`

**`wizard_status` enum (7 values on `BoQ Sheet Draft`):** blank / Pending / Hidden / Reviewed / Skip / General specs / Parse failed / Parsed. "Parse failed" has no writer until Module 5 (deliberate parse pass). "General specs" is never written directly to this field; it is derived by the frontend from `BOQs.general_specs_sheets` child table (set membership on `source_sheet_name`). "Parsed" is written by the parse-run worker (Slice 2) after a successful parse pass; `assemble_mapping_config` treats it identically to "Reviewed" -- both include the sheet as a data parse target with its saved `sheet_config` blob.

**Schema fields (Module 2a + Module 3 Slice 3a + Slice 2c):**
- `BoQ Sheet Draft.sheet_label` -- Data, optional. Human-reference label for Skip sheets. No parser coupling.
- `BoQ Sheet Draft.work_packages` -- Table, options "BoQ Sheet Work Package". Multi-link to Work Headers. REPLACES the former single-Link `work_package` field (renamed + converted in feat b14e9015). FRONTEND NOTE: `boqTypes.ts` still has `work_package?: string | null` -- a later frontend slice must update to `work_packages: BoQSheetWorkPackage[]`.
- `BoQ Sheet Draft.sheet_config` -- JSON, optional. Per-sheet parser config blob (header_row, header_row_count, column_role_map, area_dimensions, etc.). Written by `set_sheet_config`; consumed by parse pass. Never query cross-sheet; always treat as opaque blob outside the wizard.
- `BOQs.general_specs_sheets` -- Table, options "BoQ General Specs Sheet", in `parser_metadata_section`. REPLACES the removed scalars `BOQs.general_specs_sheet` (Data) + `BOQs.master_preamble` (Long Text) (Slice 2c, feat b5381c0c). Multiple general-specs sheets per workbook are now supported (M2.16 one-per-workbook constraint dropped). New child doctype path: `nirmaan_stack/nirmaan_stack/doctype/boq_general_specs_sheet/`.

**New child doctype BoQ General Specs Sheet (Slice 2c, feat b5381c0c):**
- Path: `nirmaan_stack/nirmaan_stack/doctype/boq_general_specs_sheet/`
- `istable=1`, module "Nirmaan Stack", permissions [], engine InnoDB. Two fields: `source_sheet_name` (Data, reqd=1) + `preamble_text` (Long Text, read_only=1).
- Data model: BOQs -> BoQ General Specs Sheet (one level deep -- serializes on `useFrappeGetDoc("BOQs", ...)`).
- Migration: `v3_0/migrate_general_specs_to_child_table` reads old scalar columns via raw SQL + inserts child rows idempotently. Old DB columns dropped manually post-migration.

**New child doctype BoQ Sheet Work Package (feat b14e9015):**
- Path: `nirmaan_stack/nirmaan_stack/doctype/boq_sheet_work_package/`
- `istable=1`, one field: `work_header` Link -> "Work Headers" (reqd=1).
- NAMING TRAP: target doctype is "Work Headers" (NOT "Work Packages"). The legacy field was named `work_package` but it always pointed at "Work Headers" (the sub-category doctype).
- Python class: `BoQSheetWorkPackage(Document): pass`.
- Data model: BOQs -> BoQ Sheet Draft -> BoQ Sheet Work Package (two levels of child table nesting).

**Child-row update idiom:** `frappe.db.get_value("BoQ Sheet Draft", {"parent": boq_name, "parenttype": "BOQs", "sheet_name": sheet_name}, "name")` to find child_name, then `frappe.db.set_value("BoQ Sheet Draft", child_name, field, value)`.

**Read path (sheet drafts):** no custom read endpoint. `useFrappeGetDoc("BOQs", boqName)` returns full doc including all `sheet_drafts` child rows.

**`sheet_preview.py`** (feat bf1a2e64, Slice 3b-i) -- 1 function:

- `get_sheet_preview(boq_name, sheet_name, start_row=1, end_row=40)` -- values-only windowed preview of raw cell data for one sheet. `@frappe.whitelist()` bare (read; callable via GET / useFrappeGetCall). Coerces start_row/end_row to int; guards start_row>=1, end_row>=start_row; clamps window silently to 200 rows max. Fetches the BoQ file from S3 via `_fetch_boq_file_to_tempfile` (URL-param key extraction + `S3Operations.read_file_from_s3`), opens with `openpyxl.load_workbook(path, data_only=True, read_only=True)` (~0.56s on a 7.65 MB file -- does NOT use BoqReader which takes ~27s due to double-open + merged-cell pre-scan), and reads the requested row window. VERBATIM sheet_name matching. Returns `{sheet_name, start_row, end_row_requested, rows: [{row_number, cells: {col_letter: value}}], returned_count, has_more}`. `has_more` derived from `ws.max_row` (dimension metadata). Tempfile always unlinked in a `finally` block. URL: `/api/method/nirmaan_stack.api.boq.wizard.sheet_preview.get_sheet_preview`

**`parse_run.py`** (Phase-1 Slice 1 + Slice 2) -- pure helpers + background worker + endpoint:

- `assemble_mapping_config(boq_name)` -- reads BOQs doc + BoQ Sheet Draft child rows, builds a `MappingConfig` Pydantic model for the parser orchestrator. Returns `(MappingConfig, not_eligible: list[str])`. Routing (in order, Slice 2c updated): (1) `general_specs_sheets` set membership -> `treat_as="master_preamble"` -- checked FIRST, outranks wizard_status (a Skip sheet in the child table must win); (2) Hidden/Skip -> `SheetConfig(skip=True)`; (3) Reviewed/Parsed with valid blob -> data sheet; (4) Pending/Parse-failed/blank/Reviewed-without-blob -> `not_eligible`. Raises `frappe.ValidationError` if BOQ not found or no eligible sheets remain. `GlobalSettings` always defaults (no per-BoQ override). **IMPORTANT:** Injects `raw["sheet_name"] = sheet_name` before `SheetConfig.model_validate(raw)` in Rule 3 -- production wizard blobs omit `sheet_name`; without this injection all Reviewed sheets fall into `not_eligible`.

- `flatten_resolved_row(resolved_row, sheet_name, row_index)` -- maps a parser `ResolvedRow` + nested `ClassifiedRow` to a flat dict of BoQ Review Row field values. JSON fields returned as Python objects (list/dict), NOT pre-serialized strings. CAVEAT: Frappe rejects Python lists for JSON fieldtype (`get_valid_dict` "cannot be a list"). Callers must `json.dumps()` the four list-JSON fields before `doc.insert()` -- see `_LIST_JSON_FIELDS` module constant. Dict-type JSON fields (`qty_by_area`, `amount_by_area`, `rate_by_area`, `append_notes_raw`) can be passed as Python dicts.

- `flatten_parsed_boq(parsed_boq, boq_name)` -- iterates `ParsedBoq.sheets`, calls `flatten_resolved_row` per row, injects `boq=boq_name`. `master_preamble` (treat_as="master_preamble") sheets produce no rows. Returns `list[dict]`.

- `run_parse(boq_name, sheet_names=None)` -- `@frappe.whitelist(methods=["POST"])`. Enqueues `_run_parse_worker` on `queue="long"`, `timeout=600`. `sheet_names=None` parses all eligible Reviewed/Parsed sheets; `sheet_names=[...]` parses only the named subset (per-sheet re-parse). Returns `{"status":"queued","job_id":...}`. URL: `/api/method/nirmaan_stack.api.boq.wizard.parse_run.run_parse`

- `_run_parse_worker(boq_name, sheet_names=None, user=None)` -- background worker. Fetches workbook from S3 or local (derives real `.xlsm`/`.xlsx` extension from URL). Calls `assemble_mapping_config` -> `parse_boq` -> per-sheet delete-then-insert loop (applying `_LIST_JSON_FIELDS` pre-serialization). Per-sheet failure: compensating delete + set `Parse failed` + continue. Global `parse_boq` failure: all eligible sheets -> `Parse failed` + error event. Stamps `BOQs.parsed_at` on any success. **TWO READ-SITES for general-specs (Slice 2c):** Read-site 1 in `assemble_mapping_config` (routing); Read-site 2 in `_run_parse_worker` Step 5 (gates "mark Parsed" -- general-specs sheets never receive "Parsed" status). Step 6 write-loop: for each (sheet_name, preamble_text) in `parsed.master_preambles`, delete-then-insert child row (replace semantics, falsy-skip per row). Commits BEFORE publishing `boq:parse_run_done` (targeted to `user=`). Does NOT touch `BOQs.wizard_state`.

**`_LIST_JSON_FIELDS` module constant** -- `frozenset` of the 4 list-type JSON fields that must be pre-serialized via `json.dumps()` before `doc.insert()`: `attached_notes`, `validation_warnings`, `classifier_warnings`, `preamble_candidate_signals`. Authoritative source for `_run_parse_worker` and `test_parse_run._insert_rows`. Do NOT add dict-type fields here.

**`boq:parse_run_done` realtime event** -- `user=`-targeted (unlike `boq:wizard_parse_done` which broadcasts). Success payload: `{status,boq_name,parsed_sheets,not_parsed_sheets,failed_sheets}`. Error payload: `{status,boq_name,error_code}`. Error codes: `missing_file`, `fetch_failed`, `no_eligible_sheets`, `parse_failed`, `internal`.

**`general_specs_sheets` empty guard (Slice 2c)** -- `assemble_mapping_config` builds `general_specs_sheet_names: set[str]` from child rows (`row.source_sheet_name for row in boq_doc.general_specs_sheets or []`). An empty child table produces an empty set; set membership check `sheet_name in general_specs_sheet_names` is safely False. `ParsedBoq.master_preambles: dict[str,str]` -- replaces `master_preamble: str|None`. Empty dict = no general-specs sheets parsed this run (does not blank existing child rows -- falsy-skip per row is preserved).

**New top-level doctype: BoQ Review Row** (Phase-1 Slice 1):
- Path: `nirmaan_stack/nirmaan_stack/doctype/boq_review_row/`. Autoname `BOQRR-.YY.-.#####`. `track_changes=1`.
- Role: transient per-row store for one parse-run's output. One row per resolved parser row per parse pass. NOT the committed output (that goes to BOQ Nodes in a later phase); meant for human review + approval before rows become canonical.
- Links section: `boq` (Link->BOQs, reqd, indexed), `sheet_name` (Data, reqd).
- Position section: `source_row_number`, `row_index`, `level`, `parent_index`, `attached_to_index` (Int); `classification`, `path` (Data, read-only+indexed).
- Classifier metadata: `promoted_from_line_item` / `needs_classification_review` (Check); `preamble_level_override` / `preamble_candidate_score` (Int); `review_reason` (Data); `preamble_candidate_signals` (JSON list).
- Content: `sl_no_value` / `unit` / `make_model` (Data); `description` (Text, global search); `is_rate_only` / `is_synthetic` (Check).
- Quantities/Rates/Amounts: `qty_total` / `rate_supply` / `rate_install` / `rate_combined` / `amount_total` / `amount_supply` / `amount_install` (Float).
- JSON dict fields (pass as Python dicts): `qty_by_area`, `amount_by_area`, `rate_by_area`, `append_notes_raw`.
- JSON list fields (must pre-serialize via `json.dumps()` before insert): `attached_notes`, `validation_warnings`, `classifier_warnings`, `preamble_candidate_signals`.
- Notes section: `row_notes` (Text).
- Object-per-flag distinction: `needs_classification_review` + `review_reason` are ResolvedRow-level flags (set by hierarchy post-pass); `classifier_warnings` + `preamble_candidate_*` are ClassifiedRow-level signals (set during classification). Do NOT conflate them.

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
