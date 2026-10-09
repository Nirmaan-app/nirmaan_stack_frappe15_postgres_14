# Coding Standards — Nirmaan Stack

How code is written in this repo, for agents and humans. Each rule sits beside its reason. Jump to the
section for the task in hand:

- [Stack](#stack) — what the app is built on, and the limits on adding to it
- [Where code goes](#where-code-goes) — module map, lifecycle hooks, API modules, naming
- [Module residence (ADR-0010)](#module-residence-adr-0010) — which module owns a concept
- [Writing backend Python](#writing-backend-python) — transactions, endpoints, status transitions, uploaded files (reading and deleting), Frappe gotchas, style
- [Writing raw SQL, `set_value` or a bulk write](#writing-raw-sql-set_value-or-a-bulk-write) — the `doc_events` bypass and PostgreSQL gotchas
- [Writing a migration or patch](#writing-a-migration-or-patch)
- [Changing a doctype schema](#changing-a-doctype-schema)
- [Writing frontend TypeScript](#writing-frontend-typescript) — pointer to `frontend/CODING_STANDARDS.md`
- [Writing tests](#writing-tests)
- [Don't touch](#dont-touch) — generated and append-only paths, and the sanctioned doctype-JSON exceptions
- [Before committing](#before-committing)
- [Commands](#commands)

Rules that belong to one domain (BoQ, Pricing Module, procurement, payments, …) live in that domain's doc;
root `CLAUDE.md` § Domain docs indexes them. Frontend-only rules (data access, state, forms, tables, effects,
dates, RBAC, F1–F5, vitest) live in [`frontend/CODING_STANDARDS.md`](frontend/CODING_STANDARDS.md). Code
examples (controller methods, error handling, realtime publishing, print formats) live in
`.claude/context/patterns.md`.

---

## Stack

- **Backend:** Frappe v15+, Python 3.10+, PostgreSQL 14.11 (never MariaDB), Redis, Socket.IO
- **Frontend:** React 18, TypeScript 5, Vite 5, React Router v6, `frappe-react-sdk 1.7`
- **UI:** shadcn/ui (primary) + Ant Design 5 (selective), TailwindCSS 3
- **State:** Zustand 5, React Hook Form + Zod, TanStack Table v8
- **Infra:** Firebase 10 (FCM push), GCP Document AI (invoice OCR), Sentry 10

Build within this stack: shadcn/ui + TanStack Table + Zustand + React Hook Form + Zod. A new UI library
needs the owner's ruling first — each one is another styling system and bundle cost the whole app carries.

---

## Where code goes

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

Frontend lives in `frontend/src/`; its layout is in `frontend/CODING_STANDARDS.md` § Where code goes.

**Lifecycle hooks:** always in `integrations/controllers/<doctype>.py`, registered in `hooks.py` `doc_events`.
New doctypes put their controllers there too.
- **Doctype `*.py` files:** only `autoname` and simple `validate`. Nothing else.

**API modules:** `snake_case` filenames under `api/<feature>/`, never hyphens (a hyphen cannot appear in the
dotted method path `nirmaan_stack.api.<module>.<method>`).
- Subdirectories under `api/<feature>/` are acceptable for sub-area grouping (e.g. `api/boq/wizard/upload_file.py`).

**File size:** split any file exceeding ~500 lines into focused submodules.

**Child tables vs JSON fields:**
- **Child Tables:** for relational, queryable data (items, payment terms, ledger entries).
- **JSON Fields:** for flexible, UI-driven data (category lists, RFQ metadata).

**Naming:**

| Thing | Convention | Example |
|---|---|---|
| Doctype name | Title Case with spaces | `Procurement Requests` |
| Doctype folder, Python module, API file | snake_case | `procurement_requests.py`, `get_service_requests.py` |
| Python function / API method | snake_case | `get_service_request_details` |
| Python class | PascalCase | `ServiceRequestController` |
| React component file | PascalCase | `ServiceRequestList.tsx` |
| Hook | camelCase with `use` prefix | `useUserData.ts` |
| Utility | camelCase | `formatDate.ts` |
| Constant | UPPER_SNAKE_CASE | `API_ENDPOINTS` |
| Type | PascalCase | `ServiceRequest` |

Use `.tsx` for files containing JSX and `.ts` for files without.

---

## Module residence (ADR-0010)

Before writing backend code, consult the **residence map** in [ADR-0010](docs/adr/0010-module-residence-rules.md):
a concept has **one owning module**, never scattered across call sites. This complements the placement rules
above (folder vs owner):

- **Calculations/decisions the business names** (Benchmark, Loss %, awaiting-approval) → a **pure module** in `services/` (no `frappe.db`, no request ctx) — B1.
- **A JSON / child-table shape** → **one accessor** that parses + types + keys it — B2.
- **`workflow_state` / status** → **one deriver** `f(items, descendants)`, never written ad-hoc across endpoints — B3.
- **Whitelisted endpoints** → **thin orchestrators** (lock → load → call → persist → commit → publish); an endpoint must not reach into a controller validator — B4.
- **A count/aggregate over many rows** → **the database** (`GROUP BY` / `EXISTS`), never a `get_doc`/row-loop in Python.

First worked proof: the `sidebar_counts` aggregate rewrite + the shared `services/procurement_approval.py`
predicate home. Frontend rules F1–F5 (stated in `frontend/CODING_STANDARDS.md`) and the deferred backlog live in ADR-0010.

Before creating a helper for an existing domain concept, consult the domain doc's **`## Residence — concept → owner`**
manifest (e.g. `.claude/context/domain/procurement.md`, `boq-backend.md`); an unassigned owner means ask the owner rather than
pick one ad-hoc. Enforcement: [Before committing](#before-committing).

---

## Writing backend Python

**Transactions:** `frappe.db.commit()` after any DML in whitelisted methods. Call it **before**
`publish_realtime()` to avoid race conditions: a client that reacts to the event must find the write already visible.

**Endpoints:** `@frappe.whitelist()` RPC methods, called from the frontend as
`nirmaan_stack.api.<module>.<method>`. Restrict mutating methods with `methods=["POST"]`, keep them thin
(see B4 above), and raise user-facing errors with `frappe.throw(...)`. Document API endpoints with parameters,
responses, and examples.

**Status transitions:** an endpoint that moves a document from one status to another reads the document again
inside its lock (`frappe.get_doc(..., for_update=True)`, or after a lock that starts a fresh transaction) and
refuses every from-status it does not expect, naming the status it found. A check made before the lock, or no
check at all, lets two concurrent actions undo each other: an edit resets an approval, or an approve settles a
Rejected row. Worked examples: `api/tds/edit_request.py`, `api/tds/approve.py` `WAITING_STATUSES`.

**The server's verdict travels as data:** when the server can overrule a decision the browser made from its own
cached copy, the reply carries that outcome as a structured field the browser acts on (`approve_tds_items`
marks a row `needs_datasheet_choice` and returns the sheet to choose against), not only as error text. The
browser's copy may offer the choice up front, but the reply is what the next step reads.

**Frappe framework gotchas:**
- **Child-table serialization depth:** `frappe.get_doc` / the REST resource API hydrate child tables one level deep only. A child-of-a-child (grandchild) Table field is NOT returned. When a doctype has a child table that itself has a child table, the grandchild needs an explicit read path (a whitelisted endpoint querying the grandchild doctype directly via `frappe.db.get_all`). Example: BoQ Sheet Draft.work_packages required `get_boq_work_packages` (`api/boq/wizard/update_sheet_draft.py`).
- **Child table filtering:** `frappe.get_all()` filters at the **parent** level — if any child row matches, all rows of that parent are returned. For row-level filtering, use SQL JOINs. See `api/credits/get_credits_list.py`.
- **JSON field filters:** `frappe.get_all()` cannot use `!=` or `is set` on JSON fields. Use raw SQL: `WHERE json_col IS NOT NULL` with double-quoted table names (`"tabDoctype"`).
- **rename_doc():** Only updates Link fields. Data fields storing document names need manual SQL.
- **Administrator user:** Name is the literal string `"Administrator"`, not an email. Handle explicitly in rename/delete logic (detail: `.claude/context/domain/users.md`).
- **Email ops:** Use `api/users.create_user` and `api/users.reset_password` — these decouple email from the core operation, so a mail failure cannot fail the user write.

**Reading uploaded file bytes (cloud storage):** never construct a local path from `file_url`. The storage
attachment app (`frappe_gcp_attachment`, S3-compatible) uploads in `File.after_insert`, replaces `file_url` with
an `/api/method/...` API URL and deletes the local copy, so a built path finds nothing and
`Frappe File.get_content()`, which reads local disk only, breaks. The same hook calls `frappe.db.commit()` inside
the request, so `save_file()` cannot be rolled back: parse and validate before saving. Two correct shapes:
- **In the request that received the upload:** capture the bytes before `save_file()`, write them to a
  `NamedTemporaryFile`, parse from that, and clean up in a `finally` block
  (`api/snags/file_io.write_bytes_to_tempfile`, `api/outflow_import/upload.py`). Read the werkzeug upload stream
  exactly once; it is consumed on read.
- **In a background worker:** re-fetch from durable storage by URL into a tempfile
  (`api/boq/wizard/sheet_preview._fetch_boq_file_to_tempfile`, used by the BoQ upload worker in
  `api/boq/wizard/upload_file.py`). Hand a worker the URL, never a local path: the web process and the RQ worker
  can run in separate containers with no shared `/tmp`.

**Deleting an uploaded File (cloud storage):** the storage app's `File` `on_trash` hook
(`frappe_gcp_attachment.controller.delete_from_cloud`) deletes the stored object keyed by `content_hash`, so
two File docs for the same PDF share one object, and trashing either through the document layer removes the
bytes the other still serves. Delete through a helper that removes only the File record when another File
shares its hash (`api/tds/submit.delete_row_datasheet`), and call it last, since no rollback restores storage.
The local site points at the production bucket (`nirmaan-attachments-prod`) with cloud deletes switched off:
an upload from local testing stays there for good, so seed test files as fake cloud URLs through the backend
(`api/tds/test_submit._cloud_url`) unless the user agrees to real uploads.

**Python style:** PEP 8. Match the file's indentation — hand-written modules use 4 spaces, Frappe-generated
doctype files use tabs. Group imports: standard library, third-party, Frappe, local application; sort
alphabetically within each group. Give public functions and classes docstrings.

---

## Writing raw SQL, `set_value` or a bulk write

**Raw SQL and `frappe.db.set_value` bypass the document lifecycle — no `doc_events` fire.** `doc.insert()` /
`doc.save()` / `frappe.delete_doc()` run the hooks; `frappe.db.sql("UPDATE ...")`, `frappe.db.set_value(...)` and
bulk DB writes do NOT. The Desk, bulk edit, Data Import and the REST API all go through the document layer, so a
human editing a record is safe -- **it is our own code that skips hooks, and `patches/` plus repair / backfill
scripts are the standing trap**, because they are exactly the code that reaches for raw SQL. Flipping a status or
an amount with `set_value` leaves every field derived from it stale, with no error anywhere and nothing on screen
looking wrong. Two rules:

1. When writing a raw `UPDATE` / `set_value` against a doctype that carries `doc_events`, say so at the call site and either invoke the affected recompute explicitly or state why skipping it is correct -- a `modified` / `modified_by`-only write is the usual safe case (`api/invoices/temp_resolve.py`, `patches/v3_0/backfill_invoice_qty.py`).
2. A derived field must be **recomputed from source, never incremented by a delta**, so that any later ordinary save repairs it exactly and a reconcile pass can always prove it.

A handler's **trigger conditions** are the other half of this: `Procurement Orders.amount_paid` drifted because
its controller only fires on a *status transition*, so re-pointing an already-Paid payment to a different parent
recomputed neither the old nor the new one -- a watched-field set must include the parent link, and must
recompute both sides when it changes.

**PostgreSQL gotchas** (the database is PostgreSQL 14, never MariaDB):
1. **Reserved keyword:** Always quote `"user"` in raw SQL.
2. **`SUBSTRING(x FROM y)` is overloaded, and a bound parameter picks the wrong overload — silently.** With an `INTEGER` it is the positional form; with `TEXT` it is the **POSIX-regex** form. A `%s` parameter arrives typed as text, so `SUBSTRING(col FROM %s)` with `27` is read as the pattern `/27/` — it matches the `27` inside `OFI-26-00271` and returns `27`. Nothing errors, the surrounding predicate just never matches. **Always cast: `SUBSTRING(col FROM %s::integer)`.**
3. JSON-field filters and row-level child-table filters need raw SQL — see the Frappe gotchas above.

---

## Writing a migration or patch

- **`patches/` is append-only migration history:** add a new patch module; never modify an existing file, because
  a site that already ran it will never run the edit.
- A patch is raw-SQL code by nature, so every rule in [Writing raw SQL](#writing-raw-sql-set_value-or-a-bulk-write)
  applies: name the skipped recompute at the call site, recompute derived fields from source.
- A column type change PostgreSQL cannot cast on its own (e.g. varchar → numeric) needs a `[pre_model_sync]`
  patch that casts first, refuses (naming every row) on a value that is not clean rather than coercing junk,
  and re-asserts row count + totals. Worked example: `patches/v3_0/project_inflows_amount_to_currency.py`
  (see the register under [Don't touch](#dont-touch)).

---

## Changing a doctype schema

Doctype JSON (`nirmaan_stack/nirmaan_stack/doctype/*/*.json`) is auto-generated by Frappe: edit it via the Desk
UI or bench tooling. The narrow hand-edits that are sanctioned are listed under [Don't touch](#dont-touch).

**After editing any doctype JSON:** always run `bench --site localhost migrate`. Tests use a separate test
database that auto-migrates, so **passing tests do not guarantee the runtime database has the new column**.
Verify with `frappe.db.has_column("DocType Name", "field_name")` in the bench console after migration.

---

## Writing frontend TypeScript

The frontend's rules — `frappe-react-sdk` data access, SWR keys, Zustand, forms and selects, tables, React
effects, `dd-MMM-yyyy` dates, realtime event naming, role checks, F1–F5, vitest and the build output — are in
[`frontend/CODING_STANDARDS.md`](frontend/CODING_STANDARDS.md). The rules in this file that bind it too: the
[Stack](#stack) limits, [Naming](#where-code-goes), [Don't touch](#dont-touch) and
[Before committing](#before-committing).

---

## Writing tests

- **Framework:** `frappe.tests.utils.FrappeTestCase` (Python unittest subclass).
- **Location:** `nirmaan_stack/nirmaan_stack/doctype/<name>/test_<name>.py` — co-located with each doctype.
- **Existing tests:** Nearly all are empty stubs. Don't rely on them to catch regressions.
- **New code:** Pure-Python modules (parsers, services) must have real unit tests with fixture files. No stubs for logic-bearing code. Test both the accepted and the refused path.
- **Frontend tests** (vitest, node-only, a local gate; Cypress): `frontend/CODING_STANDARDS.md` § Writing a test.
- **Running:** use the bench runner, in-container; the exact invocation and the `python -m unittest` import
  failure are in root `CLAUDE.md` § Commands.

**A test removes every record it creates, and its clean-up must survive a poisoned transaction:** these suites
run against the live site database, so a stranded row is permanent dev data. The trap is not a missing
`tearDownClass` — it is that **a DB-level error aborts the PostgreSQL transaction** ("current transaction is
aborted, commands ignored until end of transaction block") and **`FrappeTestCase` has no per-test rollback**: its
only one is `addClassCleanup(_rollback_db)`, which runs *after* `tearDownClass`. So a purge written as one
unguarded block raises on its first delete and strands every record after it — **silently, while the run still
reports OK**. Correct shape: **roll back first**, then delete each scope inside its own `try`/`except`, commit per
scope, and report any failure rather than swallow it; a test that provokes a unique/PK violation on purpose also
wraps it in a `frappe.db.savepoint`. One purge helper per suite family, imported rather than copied — two copies
either side of a shared database can disagree about whether a scope was cleaned. Reference implementation:
`_purge_test_disciplines` in `api/boq/test_rate_master.py`, imported by `test_spec_reader.py`.

**A sweep over live records must not depend on residue being absent:** a test that asserts a property of *every*
live row — `test_27_live_configs_all_validate` validates every `active=1` config with no discipline filter, which
is the right scope — also reads whatever another test left behind, and then fails for a reason that has nothing
to do with the code and reproduces at every commit. **Do not narrow the sweep to dodge it** (that is the assertion
the sweep exists to make). Fix it at the source: a test that deliberately writes an invalid record removes it the
moment it ends (`addCleanup`), so it can never outlive its own test method.

**Single-doctype state:** a test that mutates a field on a Single doctype must capture the site's original value
and restore **that** — never a hardcoded restore constant. These suites run against the live localhost site, so a
hardcoded restore rewrites the owner's real setting whenever it differs. The failure is silent because
`frappe.db.set_single_value` bypasses the doc lifecycle and writes **no `Version` row**: a `track_changes` audit
cannot see it, so the setting appears to change by itself. Correct pattern: `test_ai_settings.py` (capture +
`addCleanup`) or a `setUpClass` capture restored in `tearDownClass`.

**A test on each side of a boundary is not a test of the boundary:** when a value crosses a seam (a service result
stored by a run and read by the frontend; a capture log beside a stored result), the producer's pin and the
consumer's pin can both be green while the join is broken -- the producer asserts what it returned, the consumer
asserts what it does with a hand-built input, and nothing asserts the value arrives. Only the rendered screen, or
a read of the stored artefact, tests the join; a slice that adds a cross-seam value is not done until one of those
has been observed.

**After editing doctype JSON**, migrate before trusting a green run — see [Changing a doctype schema](#changing-a-doctype-schema).

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

## Don't touch

Never hand-edit these paths; change the source or use the tool named:

| Path | Reason |
|---|---|
| `nirmaan_stack/nirmaan_stack/doctype/*/*.json` | Auto-generated by Frappe — edit via Desk UI or bench tooling only |
| `patches/` | Append-only migration history — never modify existing files |
| `www/frontend.html` | Auto-generated SPA shell |
| `frontend/src/components/ui/` | shadcn/ui generated components — update via shadcn CLI |
| `nirmaan_stack/public/` | Compiled frontend assets — edit source in `frontend/src/` instead |
| `services/file_extractor.py` | Intentionally deleted — do not recreate (nor the `DocumentSearch` page) |

### Sanctioned doctype-JSON exceptions

Older as-built records cite this register as root `CLAUDE.md` § Don't Touch; it lives here now.

Each exception below is a deliberate, reviewed, committed edit followed by `bench --site localhost migrate`,
isolated to the minimum field diff and recorded here.

**`fieldtype` change**, when a schema constraint must be corrected (e.g. `source_file_url` Data->Small Text; `description` Data->Text on BOTH `Project Expenses` and `Non Project Expenses` — all four expense dialogs already rendered a `<Textarea>` against a `varchar(140)` column, so a >140-char description hard-failed the save with Frappe's `CharacterLengthExceededError`; `Project Payments.utr`, `Project Inflows.utr`, `Project Expenses.payment_ref`, `Non Project Expenses.payment_ref` and `Outflow Import Row.settlement_reference` Data->Text, #1254 — a bank-statement import stores the full ICICI narration as the reference, which outgrows 140 chars; screens render these through `components/common/TruncatedText`; `Project Inflows.amount` Data->Currency, #1255 — PostgreSQL cannot cast varchar->numeric without `USING` and Frappe's model sync emits none, so a plain migrate crashes: the `[pre_model_sync]` patch `patches/v3_0/project_inflows_amount_to_currency.py` casts it first, REFUSES (naming every row) on any value that is not a clean number rather than coercing junk to 0, and re-asserts row count + exact SUM). Any such change must be isolated to the minimum field diff and explicitly noted here.

**The same exception covers a field's `description` text, on the same terms** (minimum diff, reviewed, committed, a migrate run afterwards) — owner-ratified, and not to be narrowed back to `fieldtype`-only by a later reader who reads the widening as drift. A description is what the next implementer reads before touching the field, so a stale one is a defect in the same class as a wrong `fieldtype` — and correcting it changes no column at all, which is exactly what makes it safe. Such a diff must stay description-only, verified by comparing the doctype JSON structurally with `description` stripped: identical field lists, identical everything else.

**A doctype's `track_changes` flag may be turned ON the same way** (that one key, reviewed, committed, migrate afterwards) when an audit needs Version rows. Used on `Outflow Row Match`, so a reversed match record keeps its own history beside the payment it reverted. It adds no column. A save that must leave the Version row passes `ignore_version=False` explicitly: Frappe defaults it to `frappe.flags.in_test`, so without it the audit goes untested.

**A single new field may be ADDED the same way, when the owner rules it** (one field entry + its `field_order` line, reviewed, committed, migrate afterwards). Used for `Outflow Import Row.skip_kind` (a read-only Select): its options are pinned to `services/outflow_import/skip_kinds.SKIP_KINDS` by test, so the JSON and the code cannot drift. Also used for `Project Payments.mode_of_payment` (Select Online/Cheque, `set_only_once`) + `cheque_no` + `cheque_date`: three fields for one ruling, the mode read through `services/cheque_payments.is_cheque`. Also used for `Vendors.gst_hold` (a Check, ADR-0028): written by `tasks/vendor_gst_hold`, `api/vendor/gst_hold`, and by hand (editable; no backend role guard — access is controlled by which UI gets the control, owner ruling). Also used for `Project Payments.on_hold` (a Check): a FLAG, never a status, so no status-keyed figure moves; unlike `gst_hold` it IS role-guarded server-side — `services/payment_hold.validate_hold` refuses both a flag change outside `PAYMENT_SETTLE_PROFILES` and any save that moves a held payment out of `Approved`. Also used for `Vendor Invoices.invoice_base_amount` + `invoice_gst_amount` + `autofill_extracted_base_amount` + `autofill_extracted_gst_amount` (Currency, ADR-0030): deliberately NOT `reqd` (an older invoice stays approvable) — `update_invoice_data` requires the split on create, rules in `services/invoice_amounts`; Currency reads back 0 when unset, so 0 / 0 means never entered. Also used for `Project Payments.is_gst_payment` (a Check, `set_only_once`, ADR-0030): a GST payment is never taxed — `payment_tds.is_deductible` refuses it (every withholding route asks that first) and `payment_split.split_payment` copies it onto the leftover. Also used for `Service Requests.gst_invoiced` (read-only Currency, ADR-0030): a derived cache — SUM(`invoice_gst_amount`) over Approved invoices, recomputed from source in `_item_billing_sync.recompute_document_amount_invoiced` beside `amount_invoiced`, with `invoice_gst_amount` a watched field of the Vendor Invoices doc event. Also used for `Outflow Import Batch.repeats_not_saved` (read-only Int, ADR-0031): the count of exact repeats an upload left out — written ONCE at staging and never recomputed, because the rows it counts were never saved (the one other writer is the one-time patch `v3_0.delete_stored_exact_repeats`, which ADDS the count of the stored repeats it deletes). Also used for `Project Snag.attachment` (Attach) + `location` (Small Text): the snag's ONE photo and where it was taken (owner 2026-10-08) — Completed needs the photo, ruled in `services/snag_photo.photo_rule_violation` and enforced by the `before_save` controller (a bulk Completed skips a snag without one); `location` holds the DPR `CameraCapture` string and is cleared with the photo.

---

## Before committing

Run `python3 scripts/residence_check.py` (from the app root) before committing backend or frontend changes — it
ratchets per-rule violation counts against `scripts/residence_baseline.json` (fail on increase; auto-tighten on
decrease). Commit messages follow `type(scope): summary` (enforced by `.githooks/commit-msg`; see
`.claude/hooks/README.md`).

---

## Commands

Standard bench commands, run from the `frappe-bench` directory inside the container (test invocations and the
host-side DB recipe: root `CLAUDE.md` § Commands):

```bash
bench start                          # Backend :8000, Socket.IO :9000
bench --site localhost migrate        # Run pending patches
bench --site localhost clear-cache    # Flush Redis
bench build
bench new-doctype "Name"
```
