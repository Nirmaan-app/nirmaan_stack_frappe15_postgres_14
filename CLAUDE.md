# CLAUDE.md — Nirmaan Stack

**Last updated:** 2026-06-25. The active feature is **BoQ Upload & Management**. **Live status + full
per-slice as-built detail: `frontend/.claude/plans/boq/`** (trunk `README.md`,
index `_slices.md`, fragments `slices/`). Backend as-built detail (endpoints, doctypes, commit
pipeline + the relocated slice changelog): **`.claude/context/domain/boq-backend.md`**. Frontend conventions:
`frontend/CLAUDE.md` + the **`boq-frontend-*.md`** surfaces in `frontend/.claude/context/domain/`. Load the relevant reference doc
before BoQ work — the always-loaded `CLAUDE.md` files intentionally hold only stable conventions + load-bearing
invariants, NOT per-commit detail (context-hygiene split 2026-06-25).

**Frontend conventions file: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**

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

## Module Residence (ADR-0010 — Proposed)

Before writing backend code, consult the **residence map** in [ADR-0010](docs/adr/0010-module-residence-rules.md): a concept must have **one owning module**, never scattered across call sites (this complements the *placement* rules above — folder vs owner). Load-bearing rules:

- **Calculations/decisions the business names** (Benchmark, Loss %, awaiting-approval) → a **pure module** in `services/` (no `frappe.db`, no request ctx) — B1.
- **A JSON / child-table shape** → **one accessor** that parses + types + keys it — B2.
- **`workflow_state` / status** → **one deriver** `f(items, descendants)`, never written ad-hoc across endpoints — B3.
- **Whitelisted endpoints** → **thin orchestrators** (lock → load → call → persist → commit → publish); an endpoint must not reach into a controller validator — B4.
- **A count/aggregate over many rows** → **the database** (`GROUP BY` / `EXISTS`), never a `get_doc`/row-loop in Python.

First worked proof: the `sidebar_counts` aggregate rewrite + the shared `services/procurement_approval.py` predicate home. Frontend rules F1–F5 and the deferred backlog live in ADR-0010.

**Enforcement:** run `python3 scripts/residence_check.py` before committing backend or frontend changes — it ratchets per-rule violation counts against `scripts/residence_baseline.json` (fail on increase; auto-tighten on decrease). Before creating a helper for an existing domain concept, consult the domain doc's **`## Residence — concept → owner`** manifest (first one: `.claude/context/domain/procurement.md`); an UNASSIGNED owner means ask, don't pick one ad-hoc.

---

## PostgreSQL Gotchas

1. **Reserved keyword:** Always quote `"user"` in raw SQL.
2. **JSON field filters:** `frappe.get_all()` cannot use `!=` or `is set` on JSON fields. Use raw SQL: `WHERE json_col IS NOT NULL` with double-quoted table names (`"tabDoctype"`).
3. **Child table filtering:** `frappe.get_all()` filters at the **parent** level — if any child row matches, all rows of that parent are returned. For row-level filtering, use SQL JOINs. See `api/credits/get_credits_list.py`.
4. **rename_doc():** Only updates Link fields. Data fields storing document names need manual SQL.

---


## Where the surface detail lives

This file is a ROUTER. It carries invariants and guardrails only.
Per-surface conventions -- worked examples, per-file specifics, the
reasoning behind a rule -- live beside it and are read ON DEMAND.

| Read this | When |
|---|---|
| [`backend-domain-gotchas.md`](.claude/context/conventions/backend-domain-gotchas.md) | Before any backend change -- the earned domain traps |
| [`backend-active-features.md`](.claude/context/conventions/backend-active-features.md) | Starting work on any active feature -- the feature register plus the full BoQ doctype inventory |
| [`backend-pricing-module.md`](.claude/context/conventions/backend-pricing-module.md) | Touching the pricing module backend -- APIs, workbooks, rate resolution |
| [`backend-rate-master.md`](.claude/context/conventions/backend-rate-master.md) | Touching the Rate Master backend (RM-1) -- loader, extraction, doctypes |
| [`backend-rate-suggestion.md`](.claude/context/conventions/backend-rate-suggestion.md) | Touching rate suggestion (RM-3) -- runs, events, scoring |

Nothing else was removed from this file. If a rule is not here, it is in one of the files above.
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
# A single module (the canonical BoQ pricing-suite invocation):
bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.test_pricing
```

**BoQ test-runner note (post boq-ai-validations merge):** run the pricing suite via
`bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.test_pricing` (in-container).
The raw `python -m unittest nirmaan_stack.api.boq.wizard.test_pricing` path now FAILS at import —
the merged `services/boq_ai_assist.py` calls `frappe.logger("boq_ai")` at module load, which opens
`/workspace/development/logs/boq_ai.log` before a bench context exists. Use the bench runner.

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

**Sanctioned exception:** A doctype JSON field's `fieldtype` MAY be changed via a deliberate, reviewed, committed CC edit + `bench migrate` when a schema constraint must be corrected (e.g. `source_file_url` Data->Small Text, fix 3815ea3f, 2026-05-30; `description` Data->Text on BOTH `Project Expenses` and `Non Project Expenses`, 2026-07-28 — all four expense dialogs already rendered a `<Textarea>` against a `varchar(140)` column, so a >140-char description hard-failed the save with Frappe's `CharacterLengthExceededError`). Any such change must be isolated to the minimum field diff and explicitly noted here.

---

## Working with Claude Code

- Read `docs/<feature>/spec.md` and the latest entries in `decisions.md` before starting any feature phase.
- **Output a written plan before writing any code. Never write code in the same turn as the plan.** Wait for user review.
- One branch per phase: `feature/<feature>-phase-<N>`. Commit at end of each phase.
- New doctypes: controllers go in `integrations/controllers/`. Doctype `*.py` stays minimal.
- New APIs: `nirmaan_stack/api/<feature>/<file>.py`, snake_case.
- Frontend: stay within the existing stack (shadcn/ui + TanStack Table + Zustand + frappe-react-sdk + React Hook Form + Zod). Do not introduce new UI libraries.
- Pure-Python modules (parsers, services) get real unit tests with fixture files — not stubs.

**Docs discipline -- DOCS-UPDATE RULE (revised 2026-06-25, context-hygiene split):** Per-slice / per-commit as-built detail (feat hashes, test/vitest/tsc counts, build logs, dated slice narratives) goes into the on-demand reference docs ONLY: `frontend/.claude/plans/boq/` (live status, source of truth) + `.claude/context/domain/boq-backend.md` (backend) + the `boq-frontend-*.md` surfaces (frontend). The always-loaded `CLAUDE.md` files get a MINIMAL touch ONLY when a STABLE convention or a load-bearing / owner-locked invariant changes — never a per-slice changelog entry. **Do NOT re-grow `CLAUDE.md` with commit data** (that bloat is exactly what this split removed). **Enforced in-session by the `.claude/hooks/guard_claude_md.py` PreToolUse hook** — it blocks changelog-style appends to CLAUDE.md and redirects them to the reference docs (see `.claude/hooks/README.md`; tune the patterns there). **Frontend conventions file: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**

---

## BoQ File Reading (S3 safety)

The BoQ upload worker (`api/boq/wizard/upload_file.py`) reads the uploaded file from a `NamedTemporaryFile` written from the in-memory bytes at the endpoint — NOT by constructing a local path from `file_url`. `Frappe File.get_content()` reads local disk only and breaks when `frappe_s3_attachment` is active (it replaces `file_url` with an `/api/method/...` API URL after insert). Any future code that needs to read an uploaded file's bytes should follow the same pattern: capture bytes before `save_file()`, write to a tempfile, clean up in a `finally` block.


---

## Wizard scope discipline (Phase 3 onward)

When a wizard decision has two paths — (a) build the capability inside the wizard, or (b) defer to or extend an existing app-wide flow — surface the fork explicitly in chat before writing code. Default lean: if the capability has reach beyond the Upload BoQ flow (i.e., other Nirmaan features would benefit from it), keep it outside wizard scope. The lean is a starting point only; the final call is case-by-case after discussion.

Common triggers: anything touching shared doctypes (Projects, Customers, Work Headers) in ways other features would also want; new app-wide UI patterns (sidebar items, top nav, modals); auth checks, audit, or notification flows other modules would benefit from.

Origin: Module 1a 2026-05-29 — `create_tendering_project` was initially scoped into the wizard, then dropped when this principle surfaced: tendering project creation has reach beyond the wizard and belongs in the existing Nirmaan new-project workflow.

---

## Wizard Endpoints Reference

All wizard endpoints live in `nirmaan_stack/api/boq/wizard/` (snake_case files; most are `@frappe.whitelist(methods=["POST"])`, return `{"status": "saved"}`, and call `frappe.db.commit()` after DML). The FULL per-endpoint reference — `update_sheet_draft`, `sheet_preview`, `parse_run`, `commit_gate`, `commit_pipeline`, `review_screen` — plus the `BoQ Review Row` schema, the `wizard_status` enum, and the load-bearing gotchas (the `_LIST_JSON_FIELDS` pre-serialize rule, the **-1** parent/root sentinel, the list-valued-JSON `doc.save()`/`delete_doc` wall, the commit freeze-and-supersede + per-sheet failure isolation) lives in **`.claude/context/domain/boq-backend.md`**. Load it before touching wizard backend code.

---

## Reference Docs

| Domain | File |
|---|---|
| Full context index | `.claude/context/_index.md` |
| Doctypes | `.claude/context/doctypes.md` |
| APIs | `.claude/context/apis.md` |
| **BoQ backend (endpoints, doctypes, commit pipeline, slice changelog)** | **`.claude/context/domain/boq-backend.md`** |
| **BoQ frontend** (wizard, hub, review, pricing; 10 surfaces) | **`frontend/.claude/context/domain/boq-frontend-*.md`** |
| BoQ live status / full as-built plan | `frontend/.claude/plans/boq/` |
| Procurement (PR/PO/RFQ) | `.claude/context/domain/procurement.md` |
| Projects | `.claude/context/domain/projects.md` |
| Service Requests | `.claude/context/domain/service-requests.md` |
| Internal Transfer Memos | `.claude/context/domain/internal-transfer-memos.md` |
| Expenses (approval workflow, Paid-only, unified module) | `.claude/context/domain/expenses.md` |
| Invoice Autofill | `.claude/context/domain/invoice-autofill.md` |
| **Invoice Qty** (derived `invoice_qty`, recompute classifier, backfill + Gemini extraction, cache, Resolve UI) | `.claude/context/domain/invoice-qty.md` |
| Vendor Hold | `frontend/.claude/context/domain/vendor-hold.md` |
| **Monthly WIP & Handover report** (Reports hub → Projects → "Monthly WIP"; 5-group/15-col compliance table: DPR-daily / Inventory-weekly / lifetime PO-dispatch + DC; active-days from Version history) | `.claude/plans/monthly-wip-plan.md` |
| Frontend domain context (full) | `frontend/.claude/context/_index.md` |
| Session changelog | `.claude/CHANGELOG.md` |
