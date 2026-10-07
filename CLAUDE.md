# CLAUDE.md — Nirmaan Stack

This file holds what every task needs. Rules that belong to one domain (BoQ, the Pricing Module,
procurement) live in that domain's doc: before changing code in a domain, read the doc that
**Domain docs** (near the end) names for it.

## Overview

Nirmaan Stack is a construction project management and procurement ERP built on Frappe. The backend exposes whitelisted Python APIs consumed by a React 18 + TypeScript SPA. Core domains: Procurement (PR → RFQ → PO → DC/DN), Projects, Vendor Management, Service Requests, Financial Tracking, Inventory, and Document AI invoice autofill.

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
├── nirmaan_stack/doctype/   # custom doctypes — data models and JSON schemas
├── api/                     # @frappe.whitelist() endpoints (snake_case names)
├── integrations/
│   ├── controllers/         # ALL doc lifecycle hooks — after_insert, on_update, etc.
│   ├── firebase/            # FCM push notification dispatch
│   └── Notifications/       # In-app notification logic
├── services/                # Reusable business logic (document_ai.py, finance.py)
├── tasks/                   # Scheduled jobs: daily item status, 10 AM vendor credit cron
├── www/                     # Serves frontend.html (SPA entry) and boot API
├── patches/                 # DB migrations (append-only)
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
  - Subdirectories under `api/<feature>/` are acceptable for sub-area grouping (e.g. `api/boq/wizard/upload_file.py`).
- **File size:** Split any file exceeding ~500 lines into focused submodules.
- **Child Tables:** For relational, queryable data (items, payment terms, ledger entries).
- **JSON Fields:** For flexible, UI-driven data (category lists, RFQ metadata).
- **Transactions:** `frappe.db.commit()` after any DML in whitelisted methods. Call it **before** `publish_realtime()` to avoid race conditions.
- **Raw SQL and `frappe.db.set_value` BYPASS the document lifecycle -- NO `doc_events` fire.** `doc.insert()` / `doc.save()` / `frappe.delete_doc()` run the hooks; `frappe.db.sql("UPDATE ...")`, `frappe.db.set_value(...)` and bulk DB writes do NOT. The Desk, bulk edit, Data Import and the REST API all go through the document layer, so a human editing a record is safe -- **it is our own code that skips hooks, and `patches/` plus repair / backfill scripts are the standing trap**, because they are exactly the code that reaches for raw SQL. Flipping a status or an amount with `set_value` leaves every field derived from it stale, with no error anywhere and nothing on screen looking wrong. Two rules: **(1)** when writing a raw `UPDATE` / `set_value` against a doctype that carries `doc_events`, say so at the call site and either invoke the affected recompute explicitly or state why skipping it is correct -- a `modified` / `modified_by`-only write is the usual safe case (`api/invoices/temp_resolve.py`, `patches/v3_0/backfill_invoice_qty.py`); **(2)** a derived field must be **RECOMPUTED FROM SOURCE, never incremented by a delta**, so that any later ordinary save repairs it exactly and a reconcile pass can always prove it. A handler's TRIGGER CONDITIONS are the other half of this: `Procurement Orders.amount_paid` drifted because its controller only fires on a *status transition*, so re-pointing an already-Paid payment to a different parent recomputed neither the old nor the new one -- a watched-field set must include the PARENT LINK, and must recompute BOTH sides when it changes.

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
5. **`SUBSTRING(x FROM y)` is OVERLOADED, and a bound parameter picks the WRONG overload — silently.** With an `INTEGER` it is the positional form; with `TEXT` it is the **POSIX-regex** form. A `%s` parameter arrives typed as text, so `SUBSTRING(col FROM %s)` with `27` is read as the pattern `/27/` — it matches the `27` inside `OFI-26-00271` and returns `27`. Nothing errors, the surrounding predicate just never matches. **Always cast: `SUBSTRING(col FROM %s::integer)`.**

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
# A single module (the canonical BoQ pricing-suite invocation):
bench --site localhost run-tests --module nirmaan_stack.api.boq.wizard.test_pricing
```

**BoQ test-runner note:** run test modules with the bench runner above (in-container). The raw
`python -m unittest nirmaan_stack.api.boq.wizard.test_pricing` path FAILS at import —
`services/boq_ai_assist.py` calls `frappe.logger("boq_ai")` at module load, which opens
`/workspace/development/logs/boq_ai.log` before a bench context exists.

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
- **Frontend E2E:** Cypress configured in `frontend/cypress.config.ts` — largely unimplemented.
- **Single-doctype state (STANDING RULE):** a test that mutates a field on a Single doctype MUST capture the
  site's original value and restore **that** — never a hardcoded restore constant. These suites run against the
  LIVE localhost site, so a hardcoded restore rewrites the owner's real setting whenever it differs. The failure
  is SILENT because `frappe.db.set_single_value` bypasses the doc lifecycle and writes **no `Version` row**: a
  `track_changes` audit cannot see it, so the setting appears to change by itself. Correct pattern:
  `test_ai_settings.py` (capture + `addCleanup`) or a `setUpClass` capture restored in `tearDownClass`.
- **A test on each side of a boundary is not a test of the boundary (STANDING RULE):** when a value crosses a seam (a service result stored by a run and read by the frontend; a capture log beside a stored result), the producer's pin and the consumer's pin can BOTH be green while the join is broken -- the producer asserts what it returned, the consumer asserts what it does with a hand-built input, and nothing asserts the value ARRIVES. Only the rendered screen, or a read of the stored artefact, tests the join; a slice that adds a cross-seam value is not done until one of those has been observed.
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

Why `[:19]` truncation: `frappe.utils.now()` returns microsecond-precision strings (e.g. `"2026-05-29 12:30:45.581159"`); `generate_pwm` calls `strptime(..., "%Y-%m-%d %H:%M:%S")` which rejects them. `add_to_date` return values need the same truncation. Empty `{"scopes": []}` makes `generate_pwm` run but produce zero milestones — correct for test isolation.

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

**Sanctioned exception:** A doctype JSON field's `fieldtype` MAY be changed via a deliberate, reviewed, committed CC edit + `bench migrate` when a schema constraint must be corrected (e.g. `source_file_url` Data->Small Text; `description` Data->Text on BOTH `Project Expenses` and `Non Project Expenses` — all four expense dialogs already rendered a `<Textarea>` against a `varchar(140)` column, so a >140-char description hard-failed the save with Frappe's `CharacterLengthExceededError`; `Project Payments.utr`, `Project Inflows.utr`, `Project Expenses.payment_ref`, `Non Project Expenses.payment_ref` and `Outflow Import Row.settlement_reference` Data->Text, #1254 — a bank-statement import stores the full ICICI narration as the reference, which outgrows 140 chars; screens render these through `components/common/TruncatedText`; `Project Inflows.amount` Data->Currency, #1255 — PostgreSQL cannot cast varchar->numeric without `USING` and Frappe's model sync emits none, so a plain migrate crashes: the `[pre_model_sync]` patch `patches/v3_0/project_inflows_amount_to_currency.py` casts it first, REFUSES (naming every row) on any value that is not a clean number rather than coercing junk to 0, and re-asserts row count + exact SUM). Any such change must be isolated to the minimum field diff and explicitly noted here.

**The same exception covers a field's `description` text, on the same terms** (minimum diff, reviewed, committed, a migrate run afterwards) — **OWNER-RATIFIED, and not to be narrowed back to `fieldtype`-only by a later reader who reads the widening as drift.** A description is what the next implementer reads before touching the field, so a stale one is a defect in the same class as a wrong `fieldtype` — and correcting it changes no column at all, which is exactly what makes it safe. Such a diff must stay description-ONLY, verified by comparing the doctype JSON structurally with `description` stripped: identical field lists, identical everything else.

**A doctype's `track_changes` flag may be turned ON the same way** (that one key, reviewed, committed, migrate afterwards) when an audit needs Version rows. Used on `Outflow Row Match`, so a reversed match record keeps its own history beside the payment it reverted. It adds no column. A save that must leave the Version row passes `ignore_version=False` explicitly: Frappe defaults it to `frappe.flags.in_test`, so without it the audit goes untested.

**A single new field may be ADDED the same way, when the owner rules it** (one field entry + its `field_order` line, reviewed, committed, migrate afterwards). Used for `Outflow Import Row.skip_kind` (a read-only Select): its options are pinned to `services/outflow_import/skip_kinds.SKIP_KINDS` by test, so the JSON and the code cannot drift. Also used for `Project Payments.mode_of_payment` (Select Online/Cheque, `set_only_once`) + `cheque_no` + `cheque_date`: three fields for one ruling, the mode read through `services/cheque_payments.is_cheque`. Also used for `Vendors.gst_hold` (a Check, ADR-0028): written by `tasks/vendor_gst_hold`, `api/vendor/gst_hold`, and by hand (editable; no backend role guard — access is controlled by which UI gets the control, owner ruling). Also used for `Project Payments.on_hold` (a Check): a FLAG, never a status, so no status-keyed figure moves; unlike `gst_hold` it IS role-guarded server-side — `services/payment_hold.validate_hold` refuses both a flag change outside `PAYMENT_SETTLE_PROFILES` and any save that moves a held payment out of `Approved`. Also used for `Vendor Invoices.invoice_base_amount` + `invoice_gst_amount` + `autofill_extracted_base_amount` + `autofill_extracted_gst_amount` (Currency, ADR-0030): deliberately NOT `reqd` (an older invoice stays approvable) — `update_invoice_data` requires the split on create, rules in `services/invoice_amounts`; Currency reads back 0 when unset, so 0 / 0 means never entered. Also used for `Project Payments.is_gst_payment` (a Check, `set_only_once`, ADR-0030): a GST payment is never taxed — `payment_tds.is_deductible` refuses it (every withholding route asks that first) and `payment_split.split_payment` copies it onto the leftover. Also used for `Service Requests.gst_invoiced` (read-only Currency, ADR-0030): a derived cache — SUM(`invoice_gst_amount`) over Approved invoices, recomputed from source in `_item_billing_sync.recompute_document_amount_invoiced` beside `amount_invoiced`, with `invoice_gst_amount` a watched field of the Vendor Invoices doc event. Also used for `Outflow Import Batch.repeats_not_saved` (read-only Int, ADR-0031): the count of exact repeats an upload left out — written ONCE at staging and never recomputed, because the rows it counts were never saved (the one other writer is the one-time patch `v3_0.delete_stored_exact_repeats`, which ADDS the count of the stored repeats it deletes).

---

## Working with Claude Code

- **Specs and tickets are GitHub issues** (see *Agent skills* below), not files. Before starting, read the ticket and its parent spec: `gh issue view <n> --comments --repo Nirmaan-app/nirmaan_stack_frappe15_postgres_14`.
- **Ad-hoc work (no ticket): output a written plan before writing any code, and wait for user review.** When `/implement` runs on a ticket, the ticket IS the approved plan: build it without re-planning or stopping for review.
- **Commit once per ticket, on the current branch.** Create a new branch only when the user asks.
- **Never push, and never close issues.** The user does both, by hand.
- **Work in place on the current branch — do NOT create a git worktree unless the user asks for one.** `bench` resolves this app through `sites/apps.txt` and an editable install pointing at the main checkout, so a backend test run from a worktree exercises the main checkout's code, not the change — a green result there proves nothing. The one sanctioned exception is a frontend-only browser walk: a second vite on `:8081`, with the worktree's `node_modules` symlinked to the main checkout's. Stating the preference here is also what makes a worktree-creating skill stand down — such a skill honours a preference already given in the instructions rather than creating a worktree by default.

**Docs discipline -- DOCS-UPDATE RULE:** Per-slice / per-commit as-built detail (feat hashes, test/vitest/tsc counts, build logs, dated slice narratives) goes into the on-demand reference docs ONLY: `frontend/.claude/plans/boq-upload-plan.md` (live status, source of truth) + `.claude/context/domain/boq-backend.md` (backend) + `frontend/.claude/context/domain/boq-frontend.md` (frontend). The always-loaded `CLAUDE.md` files get a MINIMAL touch ONLY when a STABLE convention or a load-bearing / owner-locked invariant changes — never a per-slice changelog entry. A rule that belongs to one domain goes in that domain doc's **Load-bearing invariants** section, with at most a pointer row in **Domain docs** below. **Do NOT re-grow `CLAUDE.md` with commit data.** **Enforced in-session by the `.claude/hooks/guard_claude_md.py` PreToolUse hook** — it blocks changelog-style appends to CLAUDE.md and redirects them to the reference docs (see `.claude/hooks/README.md`; tune the patterns there).

---

## Reading uploaded file bytes (S3 safety)

The BoQ upload worker (`api/boq/wizard/upload_file.py`) reads the uploaded file from a `NamedTemporaryFile` written from the in-memory bytes at the endpoint — NOT by constructing a local path from `file_url`. `Frappe File.get_content()` reads local disk only and breaks when `frappe_s3_attachment` is active (it replaces `file_url` with an `/api/method/...` API URL after insert). Any future code that needs to read an uploaded file's bytes should follow the same pattern: capture bytes before `save_file()`, write to a tempfile, clean up in a `finally` block.

---

## Domain docs

Find the row your task touches and read that doc before writing code. A doc that has a
**Load-bearing invariants** section holds its owner-locked rules there, at the top: read that section first.

**BoQ** is the active feature and its docs are huge. Before BoQ work, find and read only the section you need in `frontend/.claude/plans/boq-upload-plan.md` (~3 MB) and `.claude/context/domain/boq-backend.md` (~250 KB). Never read either one whole; neither fits in context. List the headings with `grep -n '^## ' <file>`, then read that range. The same goes for `boq-rate-master.md`.

| Read before you touch… | Doc |
|---|---|
| **BoQ status**: which phase or slice is active, the design spec, every as-built record (status is never written in CLAUDE.md) | `frontend/.claude/plans/boq-upload-plan.md` |
| **BoQ wizard, parser, review tree or commit**: the BoQ doctypes, wizard endpoints, description columns, note parenting, the AI-assist prompts and chunkers, `attached_notes`, a wizard-vs-app-wide scope fork | `.claude/context/domain/boq-backend.md` § Load-bearing invariants |
| **BoQ row classification**: `BoQ Row Category`, engines and disciplines, the rules runner, routing, the AI voter, truth snapshots | `.claude/context/domain/boq-classification.md` |
| **BoQ pricing editor**: the rate gates (lock, priceability, category, amount formula), copy-forward and the revision carry, the classification freeze | `.claude/context/domain/boq-pricing-editor.md` |
| **BCS cost layer**: `BoQ Row BCS Rate`, BCS Total, % Margin, the internal BCS export (not the rate-master "BCS", an unrelated concept) | `.claude/context/domain/boq-pricing-editor.md` § BCS |
| **BoQ Rate Master or Rate Suggestion**: the catalogue, category configs, pricing pipelines, pricing inputs, rate files (CSV/xlsx), asset mints, AI attribute extraction, the rate-helper panel | `.claude/context/domain/boq-rate-master.md` § Load-bearing invariants |
| **BoQ frontend**: wizard, hub, review, pricing screens. Frontend conventions file: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`) | `frontend/.claude/context/domain/boq-frontend.md` |
| **Pricing Module**: `api/pricing/`, Pricing Workbook doctypes, its read/write access split and checkout lock (not the BoQ pricing editor) | `.claude/context/domain/pricing-module.md` |
| **Procurement**: PR/PO/RFQ, a PR's package (`work_package` is the PR type), Critical PO Task ↔ PO links, the PR/SB Loss Justification gate | `.claude/context/domain/procurement.md` § Load-bearing invariants |
| Projects | `.claude/context/domain/projects.md` |
| Service Requests | `.claude/context/domain/service-requests.md` |
| Internal Transfer Memos | `.claude/context/domain/internal-transfer-memos.md` |
| Expenses (approval workflow, Paid-only, unified module) | `.claude/context/domain/expenses.md` |
| Invoice Autofill | `.claude/context/domain/invoice-autofill.md` |
| **Invoice Qty** (derived `invoice_qty`, recompute classifier, backfill + Gemini extraction, cache, Resolve UI) | `.claude/context/domain/invoice-qty.md` |
| **Bulk Import Outflow** (bank statement → settles Approved→Paid across Project Payments / Project + Non Project Expenses; matcher, status deriver, ±₹1 tolerance, decision screen) | `.claude/context/domain/outflow-import.md` |
| **Payment TDS** (TAX deducted at source — NOT the Technical Data Sheet family: deduction + challan doctypes, `reconciled_amount` recomputed-from-source and its three callers, pay/create-and-pay locking, restating a deduction on a payment edit, Gemini challan extraction) | `.claude/context/domain/payment-tds.md` |
| Vendor Hold | `frontend/.claude/context/domain/vendor-hold.md` |
| **Monthly WIP & Handover report** (Reports hub → Projects → "Monthly WIP"; 5-group/15-col compliance table: DPR-daily / Inventory-weekly / lifetime PO-dispatch + DC; active-days from Version history) | `.claude/plans/monthly-wip-plan.md` |
| Doctypes | `.claude/context/doctypes.md` |
| APIs | `.claude/context/apis.md` |
| Every other backend context doc | `.claude/context/_index.md` |
| Frontend domain context (full) | `frontend/.claude/context/_index.md` |
| Session changelog | `.claude/CHANGELOG.md` |

---

## Agent skills

Per-repo configuration read by the installed engineering skills (`/triage`, `/to-tickets`, `/to-spec`,
`/code-review`, `/wayfinder`, `/domain-modeling`, …). Edit the files under `docs/agents/` directly to change
any of it.

### Issue tracker

Issues and specs live as **GitHub issues** on `Nirmaan-app/nirmaan_stack_frappe15_postgres_14`, managed with
the `gh` CLI. PRs are NOT treated as a request surface. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

**Single-context** — root `GLOSSARY.md` + root `docs/adr/` — plus this repo's own per-domain reference docs
under `.claude/context/domain/` and `frontend/.claude/context/`. See `docs/agents/domain.md`.
