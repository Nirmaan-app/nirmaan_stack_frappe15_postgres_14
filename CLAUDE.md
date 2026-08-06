# CLAUDE.md — Nirmaan Stack

**Last updated:** 2026-06-25. The active feature is **BoQ Upload & Management**. **Live status + full
per-slice as-built detail: `frontend/.claude/plans/boq-upload-plan.md`** (the `### Slice ...` /
`## Phase 5 Pricing Editor -- slice detail` sections). Backend as-built detail (endpoints, doctypes, commit
pipeline + the relocated slice changelog): **`.claude/context/domain/boq-backend.md`**. Frontend conventions:
`frontend/CLAUDE.md` + **`frontend/.claude/context/domain/boq-frontend.md`**. Load the relevant reference doc
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

## Domain Gotchas

- **PO Delivery Documents** are polymorphic: `parent_doctype` = `"Procurement Orders"` or `"Internal Transfer Memo"`. Always filter by `parent_doctype`; use `parent_docname` (not legacy `procurement_order` field).
- **Vendor credit status:** `recalculate_vendor_credit()` never sets `vendor_status` to On-Hold. Only the daily 10 AM cron does that. The function can auto-clear On-Hold → Active.
- **CEO Hold:** Only `nitesh@nirmaan.app` may set/unset — enforced in `integrations/controllers/projects.py`, not role-based.
- **Invoice Autofill:** Opt-in only via InvoiceDialog. Never recreate `services/file_extractor.py` or the `DocumentSearch` page — both intentionally deleted.
- **Email ops:** Use `api/users.create_user` and `api/users.reset_password` — these decouple email from the core operation.
- **Administrator user:** Name is the literal string `"Administrator"`, not an email. Handle explicitly in rename/delete logic.
- **Frappe child-table serialization depth:** `frappe.get_doc` / the REST resource API hydrate child tables ONE LEVEL DEEP ONLY. A child-of-a-child (grandchild) Table field is NOT returned. When a doctype has a child table that itself has a child table, the grandchild needs an explicit read path (a whitelisted endpoint querying the grandchild doctype directly via `frappe.db.get_all`). Example: BoQ Sheet Draft.work_packages required `get_boq_work_packages` (`api/boq/wizard/update_sheet_draft.py`).
- **BoQ Description role is multi-column:** a sheet may map the `description` role on MULTIPLE columns (it is intentionally NOT in the parser's `_SINGLETON_ROLES`). The classifier JOINS all mapped description columns, in Excel column order, with the separator `" | "`, into the one canonical `description` string the whole pipeline uses, and ALSO records each original column in the per-row `description_parts_raw` list -- an ordered list of `(col_letter, header_label, cell_text)` triples in Excel column order (col_letter is unique so identical headers never collide; original headers preserved; duplicate labels get ` 2`/` 3` suffixes only at RENDER time, MC-4/MC-5) -- for faithful display. `header_label` is the real per-column header text, captured at PARSE time from the sheet's `header_row` cells by `orchestrator._enrich_column_headers` (MC-3b) into the in-memory `SheetConfig.column_headers` (stored-wins; blank header cell -> the bare column letter; never written back to the stored blob); MC-4/5 read these labels from the persisted `description_parts_raw` triples. A single-description sheet's joined string stays byte-identical (no separator). Owner-locked; the shared `_description_columns` / `_description_parts` helpers in `services/boq_parser/classifier.py` are the single source of truth.
- **BoQ note parenting is NEAREST-PREAMBLE-OR-LINE-ITEM (EA-6a, owner-locked):** a NOTE attaches to the nearest **preamble OR line item** above it, not the nearest preamble. Selection is a plain three-way nearest-wins over `(_top_non_none(stack), last_line_item_index, level0_ancestor)` — **`level0_ancestor` is a FULL CANDIDATE, never an `else` fallback** (a level-0 section header IS a PREAMBLE, merely absent from the stack; the fallback form mis-attaches to a stale line item preceding the header — 42 measured). **The marker is READ ONLY in the note branch** — the LINE_ITEM branch only records it, so all other parenting/level logic is byte-unchanged. Reset at `SUBTOTAL_MARKER` ONLY (root-preamble / any-preamble resets are provable no-ops). Notes keep `path=None` and carry no level, so the demotion pass is unaffected; `attached_to_index == parent_index` for every note. Flag `hierarchy.NOTE_PARENT_NEAREST_ROW_ENABLED` (default True). Full detail: `.claude/context/domain/boq-backend.md`.
- **Both review-tree parenting PROMPTS are TEST-PINNED (owner-locked):** the load-bearing passages of
  `boq_ai_assist._AI_PASS_PROMPT_TEMPLATE` and `boq_gemini_assist._BOQ_CLASSIFY_PROMPT` are frozen by
  `TestPromptParentingPins` in **both** service test files. **A wording change must UPDATE the pins
  deliberately** — pin first, reword second, so the diff shows exactly what the model was told before and
  after. Both prompts state the parser's real rule (*a note's parent is the nearest preamble or line_item
  above it*) and the identical line-item rule (*only a preamble may parent a line_item* — matching the
  finalize gate, which hard-blocks an item under any non-heading parent). Both stay **SILENT on
  note-under-note**: silence is the mechanism, enforced by a NEGATIVE pin on each engine — never add a
  prohibition sentence.
- **Both AI-assist chunkers cut on the EFFECTIVE CLASSIFICATION (EA-6b, owner-locked):** Claude via
  `_is_preamble_payload`, Gemini via the `section_flags` parallel list the API layer resolves
  (`gemini_assist._section_flags`). Gemini previously cut on `preamble_candidate_score > 0` -- a derived
  SIGNAL -- which landed cuts MID-SECTION and stranded **774 notes across 97 of 110 sheets** (118 with a
  line-item target, median 2 rows behind the cut, plus 19 blind hard-max cuts); the classification-based
  rule takes every one of those to **0**. **Gemini's WIRE PAYLOAD NEVER carries the parser's verdict**
  (owner ruling: independence = (a), WIRE independence -- the model must never be shown a prior
  classification). The verdict IS now fetched for cutting, so the old structural guarantee (simply not
  fetching it) is gone: **the invariant is enforced by `services/test_boq_gemini_assist.TestWirePayloadPin`,
  which freezes the 11-key payload contract -- a wording change must never make it red.** `chunk_rows`
  with ABSENT `section_flags` degrades to ceiling-only cuts, never back to the score rule.
- **Committed `attached_notes` is DERIVED, not carried (EA-6a slice 2, owner-locked):** at commit,
  `commit_pipeline._derive_attached_notes` rebuilds every node's `attached_notes` from the EFFECTIVE
  tree (effective parent + effective classification, row_index order -- order is load-bearing,
  `hierarchy._notes_text` pipe-joins it). **The `BoQ Review Row` copy is DISPLAY-TIER only**; a
  disagreement emits ONE `frappe.logger("boq_commit")` warning and **NEVER fails the commit**. This is
  what makes the forward-only policy safe -- a historical sheet SELF-HEALS on re-commit, so there is no
  backfill. The review tier is kept in step at the ONE chokepoint `_apply_and_save_row_edit`, which
  fires on a `human_parent` move of a note **AND** on a `human_classification` transition INTO or OUT OF
  "note" (a re-label); a classification change touching "note" on neither side rebuilds nothing. **The
  rebuild keys on the EFFECTIVE PARENT, never `attached_to_index`** -- that field's 0 means "not
  attached", so keying on it silently dropped the text of every note parented to `row_index` 0; the
  sentinel ambiguity is now confined to the pointer field and can never reach the text or the AI
  engines. The C4 reconciliation asserts the DERIVED value **at its call site only** -- the shared
  `_jsn` helper still guards `append_notes_raw` / `edit_log` / `description_parts_raw` and must not be
  touched. `BUG_24_NOTE_PARENT_INDEX_ENABLED` is **RETIRED** (slice 1 made one `target` drive pointer,
  parent and notes-key, so setting it False would MANUFACTURE a divergence). **An item cannot be the
  parent of another item** -- the finalize gate refuses it ("Item not under a section heading").
- **`matching_mode: "item_identity"` routes a category to the composite-REFUSAL prompt (owner-locked).**
  `extraction.select_prompt_text` hands such a category `prompts/boq_rate_item_identity_prompt.md`, which
  instructs the model to return null for any row describing "MULTIPLE items or an assembled unit". It must
  NEVER be set on a category whose rows are ASSEMBLIES -- the model then refuses every row, deliberately and
  at high confidence, and the blanks look like an extraction failure rather than the instruction they are.
  Removing it means removing `identity_attribute_id` in the SAME edit (that key is read only when the mode
  is `item_identity`, so leaving it is a dangling key); `item_kinds` is SEPARATE and must stay -- it is what
  records which category OWNS a catalog kind.
- **`switches_sockets` is a PER-COMPONENT COMPOSITE and rounds to TENS; `point_wiring` rounds to UNITS
  (owner-locked, deliberately different).** Both are sheet-faithful: switches_sockets sums the RAW component
  lines, multiplies once, then rounds to tens; point_wiring multiplies and rounds per component. Do NOT
  "harmonise" them -- point_wiring's own notes record its unit rounding as "INTENTIONAL, per the sheet", and
  the tens convention is what keeps switches_sockets' standing golden value-identical across the rebuild.
- **The only blanker item in the catalog is `1M Blanker`, and it lives under `family: "Switch"`** -- there is
  no blanker family. Any `blank_item` slot therefore binds `values_from.where = {"family": "Switch"}`.
  **BOTH `switches_sockets` and `point_wiring` carry a blanker slot.**
- **The module count is computed in the PIPELINE, never by the model (owner-locked).** The
  `module_fit` interpreter step derives a row's module count from a weighted sum over its stated
  quantities and resolves it against the catalog. It belongs in the pipeline precisely BECAUSE a
  model-selected plate leaves no trace: the step's trace carries the arithmetic AND the ladder hop,
  and this system's design ethos is that a price shows its working. **The weighted sum is CONFIG —
  weights AND attribute ids — never hardcoded**, because `switches_sockets` has TWO socket slots and
  `point_wiring` has one, so a fixed two-attribute formula is not portable between them.
- **`module_fit` ladders derive from the CATALOG, never from a params array (owner-locked).** A ladder
  spec names an item `kind` + a `where` family and carries NO size list, so adding or retiring a plate
  size flows through with no config edit. Resolution is EXACT if the catalog carries the size, else the
  **NEXT HIGHER** one, **never a lower one** — a plate smaller than its contents cannot hold them, so
  rounding down is a wrong price, not merely a wrong size. **`"1M & 2M"` is ONE catalog item covering
  TWO sizes**: every integer in a rung's label is a covered size, so a computed 1 and a computed 2 both
  match it on the ordinary exact-match path. A count ABOVE the ladder's top is an HONEST NO-COMPUTE,
  never clamped to the largest rung; this DELIBERATELY DIVERGES from `circuit_fit`, which does fall
  back to its largest size but then re-checks with `circuits <= 0` — `module_fit` has no such second
  gate, so it refuses at the ladder.
- **TAKE-THE-LARGER: the plate priced is the LARGER of the STATED and the COMPUTED module count
  (owner-locked; REPLACES the earlier stated-wins rule).** A ladder's `floor_from` names the attribute
  whose stated count is a **FLOOR, never a ceiling**: a stated plate too small for its contents is
  **UPGRADED** rather than refusing the row (a BoQ typo must not kill a line), and a stated plate
  bigger than needed is what gets bought. **An UPGRADE MUST ALWAYS BE VISIBLE in the derivation trace**
  — the BoQ said one size and we price another, which is the right call only while it cannot be missed.
  **Blanks derive from the plate ACTUALLY SELECTED and CLAMP AT ZERO** (never negative, never a
  refusal); the clamp is likewise named in the trace.
- **The BACK BOX takes the SELECTED plate's module COUNT, re-fitted on its OWN ladder — never the
  plate's LABEL (owner-locked).** The box ladder is SHORTER than the plate ladder (no 9M, no 16M), so a
  9M plate pairs with a **12M** box and a 16M plate with an **18M** box. Copying the label asks the
  catalog for a box that does not exist and makes the WHOLE ROW unpriceable — that was a live defect
  before slice 2 part 2. When the plate is `"None"` the plate line stays ZERO and only the BOX takes
  the computed count, which is why a box may exist with no face plate.
- **The plate / back-box relationship is ONE-WAY (owner-locked).** A face plate present DEFAULTS the box to
  yes; a face plate set to `"None"` must leave `back_box` **STILL SELECTABLE**, because a back box can exist
  with no face plate. `plate_item.disables_when_none` therefore lists **`plate_qty` ONLY** -- never `back_box`.
  Greying the box out makes such a row UNPRICEABLE, which is a wrong answer and not merely a wrong UI.
  The back_box component's `@plate_item` binding is SEPARATE and stays: **box module = the PLATE's module
  when a plate exists**; the no-plate fallback needs the module computation and is a later slice.
- **Goldens live in the asset's TOP-LEVEL `goldens` dict, keyed by category_id, and NOWHERE ELSE.**
  `loader.load_rate_master` reads `payload["goldens"]` and OVERWRITES each config's `goldens` key from it, so
  a golden written into a `category_configs[*].goldens` entry is SILENTLY IGNORED. A golden added in-system
  via RM-4b but never written back into that top-level dict is DROPPED on the next `replace=True` import.
  **Verify an apply by comparing `stored == asset` KEY BY KEY, never by golden COUNT** -- a swap can leave the
  count identical while replacing the content.
- **Estimator rules are read from the DB, not the asset:** `extraction._load_active_configs` reads `BoQ Rate Category Config`, so editing `services/boq_rate_master/data/rate_master_*.json` is **INERT at runtime** until re-imported or applied via the audited RM-4b `update_rate_config`. The asset is the record; the config row is what the model reads.
- **Loss Justification (PR/SB):** a written reason is required for any approval item whose **Loss % > 10%** (strict). One field `loss_justification` (Small Text) on the SHARED child `Procurement Request Item Detail` covers both PR and SB. Terms in `CONTEXT.md`; scope/rationale in `docs/adr/0002-loss-justification-scope.md` (PR/SB approval surfaces ONLY — NOT on `Purchase Order Item`, no Loss% snapshot, no PO/print). Loss % = `(-savingLoss / benchmark) * 100`, **benchmark = Target Amount (target rate ×0.98) if available else Lowest Quoted L1 (Target-prioritized)**. Gate is server-authoritative: `send_vendor_quotes.handle_delayed_items` accepts `loss_justifications`, writes them onto `order_list`, and re-computes Loss % (`compute_item_loss_percent`) to `frappe.throw` on a blank >10% reason. **GOTCHA 1 — `rfq_data.details` is keyed by `item_id`, NOT the order_list child-row `name`** (verified against live data); the L1 lookup must use `item.item_id`. **GOTCHA 2 — dual benchmark on the approval screen:** the existing ₹ "Savings/Loss" column keeps its `min(Target, L1)` benchmark (unchanged), but the new Loss % uses the Target-prioritized benchmark to match capture and keep the >10% gate identical end-to-end — so the ₹ and the % on that one screen can come from different benchmarks; don't "fix" it.

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
- **Single-doctype state (STANDING RULE):** a test that mutates a field on a Single doctype MUST capture the
  site's original value and restore **that** — never a hardcoded restore constant. These suites run against the
  LIVE localhost site, so a hardcoded restore rewrites the owner's real setting whenever it differs. The failure
  is SILENT because `frappe.db.set_single_value` bypasses the doc lifecycle and writes **no `Version` row**: a
  `track_changes` audit cannot see it, so the setting appears to change by itself. Correct pattern:
  `test_ai_settings.py` (capture + `addCleanup`) or a `setUpClass` capture restored in `tearDownClass`.
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

## Active Features

| Feature | Branch | Spec | Status |
|---|---|---|---|
| BoQ Upload & Management | `feature/boq-phase-3` | `frontend/.claude/plans/boq-upload-plan.md` | Phases 1.x (parser) + Phase 3 (wizard) + Phase 4 (committed BoQ-model rebuild) COMPLETE; Phase 5 (commit gate + pricing editor) active. Full slice-by-slice status + as-built detail: `boq-upload-plan.md` + `.claude/context/domain/boq-backend.md`. Do NOT duplicate the changelog here. |

**Always read `frontend/.claude/plans/boq-upload-plan.md` + `.claude/context/domain/boq-backend.md` before working on BoQ.**

**Active BoQ doctypes** (full per-doctype detail in `.claude/context/domain/boq-backend.md`):
- `BOQs` — root BoQ doc; `BoQ Sheet Draft` (child) — per-sheet wizard config (`wizard_status`, `sheet_config`); `BoQ General Specs Sheet` / `BoQ Sheet Work Package` — child tables.
- `BoQ Review Row` — transient per-parse review rows (human-edit layer; **-1 sentinel** for no-parent/no-override).
- `BoQ Sheet` — committed, VERSIONED sheet tier (`commit_version`/`is_current`); `BOQ Nodes` (+ `BOQ Node Qty By Area`) — committed node tree, **CAPTURE-ONLY** controllers (no amount/parent-rate recompute).
- `BoQ Committed Sheet Grid` (+ `... Row`) — faithful committed cell grid (all 6 classifications).
- `BoQ Cell Pricing` — per-cell pricing layer; `BoQ Cell Amount Formula` — per-column amount formulas; `BoQ Cell Remark` / `BoQ Cell Color` — annotations; `BoQ Cell Dismissal` — per-row review-flag dismissal; `BoQ Cell Reconciliation Choice` — per-cell formula-vs-document choice; `BoQ Sheet Pricing Lock` — single-editor lock. (No separate audit doctype — audit goes through `Nirmaan Versions`.)
- `BoQ Row Category` — per-row classification overlay (classifier service `services/boq_category/`, backend-only; wired into the pricing editor at a later slice). Mirrors `BoQ Cell Remark`'s durable-address shape but with `discipline` IN the identity tuple (a second engine's row for the same Excel address coexists); freeze-and-supersede lifecycle via `persist.write_row_categories` (+ `set_human_verdict`, which UPSERTS: creates a current record when none exists for the address — CL-6, so a verdict on an eligible row that was never classified persists — else annotates the current record IN PLACE and does NOT mint a new version). `context_builder.build_sheet_context` rebuilds the committed-tree feed (`anc_texts`/`anc_headers` byte-identical to the certified harness, plus a structured per-ancestor list incl. every ancestor's notes; work headers PARKED, not fed this slice). `routing.route_r3d` = config-driven R3d router (`routing_config.json`); `ai_voter.classify_rows_ai` = independent Option-B voter (AI feed = description/ancestor_chain/notes only; fails closed when AI settings disabled). **Single-row-batch parse tolerance (HV-2, all disciplines, owner-locked):** the voter's `_extract_json_array` accepts a lone-row reply returned as a bare JSON OBJECT (wraps it as a one-element list) as well as the normal array; parse-shape ONLY — id/category validation stays downstream unchanged, and a genuinely non-JSON reply still RAISES loudly (error-swallowing is the harness's job, never the voter's). The eval harness (`harness/electrical_classification_harness.py`) IMPORTS this same `_extract_json_array` (HV-2b) — one source of truth, no duplicate; do NOT reintroduce a local copy. Effective category = `human_category_id` if set else `final_category_id`; a blank `final_category_id` means route-to-human, never a category. **AI-off fail-safe (CL-5, owner-locked, Option A):** when the voter did NOT run (`ai_status` in `{"disabled","no_key"}`) the `orchestrator` OVERRIDES routing per-row — `final_category_id` = the RULE category (a genuine rule-abstain stays honestly blank) and EVERY row is flagged `Needs review`. The override lives in `orchestrator.classify_sheet_rows` (a run-level flag the pure `route_r3d` is blind to); `route_r3d` + `persist` stay untouched. When `ai_status == "ran"` there is NO override (consensus auto-accepts, disagreement blanks final as before). **Endpoints (CL-1b, `api/boq/wizard/classify.py`):** `list_engines` / `start_classify` / `get_classify_status` / `get_sheet_categories` / `set_row_category`, plus `_classify_worker` on the `parse_run` long-job pattern (raw 32-char job_id, commit-before-publish, self-heal). Its in-progress marker + terminal payload live in REDIS keyed by `(boq, sheet_name, discipline)` (schema-free -- no doctype field -- fitting the committed tier). `orchestrator.classify_sheet_rows` does context->rule+AI->route->persist per sheet; range scoping is ELIGIBLE-ONLY + SILENT and the summary reports honest N-of-M plus a `skipped_by_reason` count rollup. Engines come from the `engines.py` registry (adding one = a registry edit; `available` gates start/verdict -- no hardcoded engine names). **Progress (CL-2):** the worker emits `boq:classify_sheet_progress` `{boq, sheet_name, discipline, done, total}` once per 20-row AI batch (the orchestrator drives the batching in slices of `_AI_BATCH`=20 -- IDENTICAL to `ai_voter._BATCH` -- so AI behaviour stays byte-identical; `ai_voter` is untouched); the terminal `boq:classify_sheet_done` is unchanged. **Progress poll is authoritative (CL-4):** the per-batch `_progress` closure ALSO merges `done`/`total` into the Redis in-progress marker (`_update_marker_progress`, preserving job identity; silent no-op if the marker is gone), and `get_classify_status`'s `running` branch returns them -- so the 3-second poll drives the progress bar even when the socket does not deliver (owner-env fact). Progress renders as a BLOCKING centered modal (`ClassifyProgressModal`) that is dismissable ONLY at a terminal state (success OR error) -- never mid-run. The terminal `_status_key`-then-clear ordering guarantees a `running` poll can never race a `done`. **Catalog (CL-3):** `get_category_catalog(discipline)` is a read-only endpoint returning `{discipline, categories:[{id,label}]}` from `load_ruleset` (engine-scoped -- unavailable engine throws); it drives the frontend verdict picker + the Category-column label. `set_row_category` (the human-verdict write, `""`=clear) is the CL-3 write path (unchanged since CL-1b). **Second-discipline seam (HV-1, owner-locked):** adding a classification discipline = 3 NEW asset files (`categories_<disc>.json`, `rules_<disc>.json`, `prompts/<disc>_ai_category_prompt.md`) + 3 one-line map edits (`runner._DISCIPLINE_ASSETS`, `ai_voter._DISCIPLINE_PROMPTS`, harness `BOQ_HARNESS_DISCIPLINE` env switch); `scoring.json` + `routing_config.json` stay SHARED across disciplines, and `load_ruleset(discipline)` / `_read_prompt(discipline)` RAISE for an unshipped discipline. HVAC assets exist (**17** categories `hvac_*` — the 17th, `hvac_raceway`, is an OWNER RULING at HV-3: cable trays/raceways price separately, so `hvac_cables` is cabling only and the tray vocabulary lives in Raceway with a false-friend guard each way — ruleset `4.2-hv7`, prompt `hvac-v1.3`; the ruleset is MEASURED OUT-OF-SAMPLE at the Set-2 exam — rules 63.58% on Set-2 vs 71.13% on Set-1 (the overfit bill, −7.56 pp) and 68.39% on the combined 2,354-row corpus after HV-6, vs the owner's 80% bar; AI prompt v1.2 measured 91.57% / 90.29% (Set-1/Set-2) and GENERALISES where the ruleset does not, so **further ruleset tuning is closed** — see `_classification_review/hvac_set2_exam/SET2_EXAM.md` and `hvac_rules_v4_verify/VERIFY_V4.md`. **Set-1 and Set-2 are both SPENT: the next honest out-of-sample measurement is production Set-3, and nothing further may be tuned against this corpus.** Prompt v1.3 is UNMEASURED, certified at HV-7) and **the HVAC engine is LIVE — `engines.py` `available=True` (HV-9, owner GO 2026-07-22), which CLOSES the HVAC build arc.** `is_discipline_available("HVAC")` now admits `start_classify` / `set_row_category` / `get_category_catalog`; ELV remains listed-but-unavailable and is the gate's negative exemplar. Certified stack behind the switch: rules `4.2-hv7` + notes-fallback surface + prompt `hvac-v1.3` + `consensus_floor_v1` routing. First production classify (`BOQ-26-00017 | Piping `): 14 auto-accepted / 9 review, both invariants holding on real data, tier shape 18/18 identical to the HV-8 certification. **PRODUCTION ERA: Set-3 accrual is now live — every production classify is unseen out-of-sample evidence, so the held Ducting demotion call and the demotion-list re-derivation must ride PRODUCTION data, never a re-fit on the spent Set-1/Set-2 corpus.** **OPERATIONAL WARNING: an AI-off run looks successful — always check `ai_status`; when it is `disabled`/`no_key` the CL-5 fail-safe adopts the RULE category as `final_category_id` and flags every row for review, so review rows carry a NON-blank final (correct, but the opposite of the certified blank-review shape).** **AI settings changes are now attributable (HV-11): `BOQ Upload Review AI Settings` carries `track_changes: 1`, so every toggle flip lands in the Version log (field change + user + timestamp) — the instrument for the standing unattributed-self-flip incident; and an AI-off run's completion modal + post-close toast now show a plain "AI voter was OFF for <discipline>" warning (healthy path silent), so the fallback is visible, not silent.** **Multi-engine pricing editor (HV-10):** the pricing editor reads the NEW `get_sheet_categories_resolved(boq, sheet_name)` — one index-covered query across every discipline with current rows, resolving an effective verdict PER ROW via the owner-locked server-side ladder (human wins, most-recent between disciplines > auto-accepted > higher-confidence between multiple autos, row flagged `cross_engine_conflict` > blank). `get_sheet_categories` (single-discipline) is BYTE-UNTOUCHED; it now backs ONLY `freeze_classification`'s stamping/banking. **Freeze summary reads the resolved ladder (Slice 1a):** `get_freeze_summary`'s blank counts come from the shared SERVICE helper `persist.blank_category_eligible_rows(boq, sheet_name, committed_version)` — eligible rows (node_type in {Line Item, Preamble}) whose RESOLVED effective category is blank across EVERY discipline; **a row with NO `BoQ Row Category` record is BLANK (the load-bearing fail-open guard — never-classified rows are ABSENT from the resolved read, so the count keys on the eligible NODE set, not on returned rows).** The ladder itself was relocated `classify._resolve_row_ladder` → `persist.resolve_row_ladder` so the resolved read AND this helper share ONE ladder (no service→api import; mirrors the frozen-reader precedent). `get_freeze_summary`'s `discipline` param is now accepted-but-IGNORED (resolves across all disciplines; single-discipline counts unchanged). `freeze_classification` stamping is deliberately deferred to its own slice. **`cross_engine_conflict` is TELEMETRY-ONLY — computed, never persisted, NEVER rendered** (owner ruling, same as `review_priority`). The whole pathway is N-ENGINE GENERIC — no discipline is named in code (the HV-10 bug was a hardcoded `discipline="Electrical"`); a future engine flipping `available` flows through with zero code change. The picker groups by the disciplines that ran and a human pick carries its group's discipline; the write (`set_row_category`, unchanged — it validates vocabulary + upserts) lands on that engine's row identity. Category picks on HVAC sheets are safe from HV-10 on. **`rules_version` provenance is WHOLE (HV-11): `load_ruleset` now surfaces `version` (the one additive loader line the HV-9 note owed — the same gap class as `routing_policy`), so `orchestrator` stamps it and new rows carry the real ruleset version (HVAC `4.2-hv7`, Electrical `2.1-tuning2`) beside `prompt_version`/`model`. The row-stamp chain (`orchestrator.classify_sheet_rows` reads `ruleset.get("version")` → row dict → `persist.write_row_categories`) was already correct; only the loader was blind.** **Ancestor-aware attribute guard (HV-5, rules side, HVAC-GATED):** an `exclusion` rule may carry `"applies_to_ancestor": true`, which moves its patterns off the line's own text and onto the **RESOLUTION POINT** — the ancestor nearest-hit settled on. Such a rule FORBIDS its category for that ancestor's children. It is consumed ONLY on the nearest-hit path, so a legacy discipline (no resolution point) is structurally unable to reach it, and `rules_electrical.json` carries none — proven byte-identical on the 2,888-row electrical corpus. This is how the owner's **4A composite ruling** is enforced at section level (`INS-COMPOSITE-ANC-EXCL`): a header describing a HOST item (pipe/duct/valve) that mentions insulation only as an ATTRIBUTE cannot yield Insulation for its children. **The discriminator is DISTANCE, not vocabulary** — the pattern requires ≥2 intervening words, so compound-noun item forms (`duct insulation`, `pipe insulation`, `underdeck insulation`) never match and insulation-is-the-item still wins. **The HVAC Boundary Rulings register (R1–R10, owner-dated 2026-07-21) is encoded in `rules_hvac.json` AND `prompts/hvac_ai_category_prompt.md` — the two must be changed together or the voters diverge.** **HV-6 final rulings (owner-dated 2026-07-21, in rules v4 + prompt v1.3):** (1) the **CHW/DX boundary is the FEED MEDIUM, never the form factor** — cassette/hi-wall/ductable/split are FORM words that resolve only with a water-fed or refrigerant-fed context, taken from the line's own text **OR its section header**, and bare form with neither context stays LOW/contested on purpose; **VRF keeps precedence** because VRF is refrigerant-fed too (`DX-VRF-EXCL`), and the bare token `refrigerant` is deliberately NOT a `DX-ANC` token (measured: it collides with VRF and cost 4 rows); (2) **a VRF system's own controls are `hvac_vrf`** (`VRF-CONTROLS`), with Sensors keeping the BMS basket only (`SNS-VRFCTRL-EXCL`); (3) **Misc is UNCHANGED** by explicit owner ruling. **`PNL-ANC-TYPE` is RETAINED by measurement** — despite its 18.8% Set-2 precision, deleting it costs 23 correct rows and fixes none (it resolves bare fragment leaves under a panel header); the distance-restricted fix needs a per-rule distance field in `runner.py` and is deferred to HV-7. **Notes-as-fallback matching surface (HV-6b, rules side, OPT-IN PER DISCIPLINE):** a discipline's `rules_<disc>.json` may declare top-level `"matching_surface": "notes_fallback"`, which makes rule matching TWO-PASS — pass 1 is NOTES-FREE (item/exclusion rules see the row description only; ancestor rules see ancestor descriptions only, each at its own level), and the LEGACY full surface (descriptions + all notes, own and ancestor) re-runs ONLY when pass 1 abstains outright; a pass-1 verdict wins as-is. **ABSENT = the legacy single pass, byte-identical.** The gate sits OUTSIDE every existing mechanism and changes none — each pass runs the complete unmodified pipeline (nearest-hit, decay, guards, exclusions, tie-break, band, geometry override); pass 1 re-enters `classify_line` with `ancestor_texts := ancestor_headers`, so NO `context_builder` change was needed, and a private `_notes_fallback_pass` kwarg guards recursion (without `ancestor_headers` the gate cannot engage and legacy runs). Verdicts carry a `matching_pass` stamp. **GATING IS LOAD-BEARING: HVAC carries the flag; Electrical does NOT and is proven byte-identical across the `runner.py` change itself (1,384 corpus line items, 0 differ, verdict hash `818dd8f1…1a5f`) — Electrical adopts this surface only via its own measured re-run, a rider on the Set-3 item.** Measured on the combined 2,354-row corpus: 68.39% → **75.49%** (Set-2 64.13% → 73.07%), AI agreement 69.80% → 77.74%, review share 37.6% → **29.6%** at 98.67% auto-accept. Owner WAIVED the per-category gate (ADP −6 rows) on 2026-07-21, accepting ADP precision 67.4% → 82.1%. **THE AI FEED IS DELIBERATELY UNTOUCHED — the voter still reads notes in full because it reads them semantically; this surface divergence between the two voters is intentional and must not be "tidied up".** Set-3 confirmation is OWED. **Per-discipline routing policy (HV-7, OPT-IN):** a discipline's `rules_<disc>.json` may declare a top-level `routing_policy` block (`policy_id`, `min_ai_confidence`, `demoted_categories`, `priority_max_ai_confidence`), consumed by the pure `routing.route_policy_v1`; **ABSENT = the legacy `route_r3d` path, byte-identical** (`route_r3d` is untouched, and `rules_electrical.json` carries no block). The orchestrator resolves it ONCE per run via `ruleset.get("routing_policy")` — **which only works because `load_ruleset` explicitly surfaces the key: the loader returns a HAND-BUILT dict, so any gating key missing from that return is invisible to every caller and its feature is SILENTLY INERT** (this exact gap stopped HV-7 mid-slice; a negative test now pins that Electrical reads it present-and-None). Signed HVAC values (owner 2026-07-21): auto-accept iff both voters agree on a non-blank category AND `ai_conf ≥ 0.80` AND the category is not in `{hvac_ahu, hvac_cables, hvac_sensors}`; everything else routes to review with a **BLANK** `final_category_id`. **THE DEMOTION LIST IS DATA, NEVER CODE** — it is re-derived from the in-segment grid every eval cycle (it already moved once at HV-6b) and a test asserts no `hvac_` id appears in `routing.py`. Measured: auto-accept 70.4% @ 98.67% combined / 67.8% @ 98.53% Set-2, review 29.6%. **`review_priority` (Check on `BoQ Row Category`, migrate-carrying) is TELEMETRY ONLY — owner amendment 2026-07-22: every review row is presented identically (blank final, `Needs review`), exactly as Electrical; the field must NEVER drive reviewer-facing UI and the HV-7f frontend slice is CANCELLED.** It is stamped 0 on auto-accepted rows, 0 on the legacy R3d path, and explicitly 0 on the AI-off fail-safe (the AI never ran, so its absent confidence is not evidence of doubt). Certification runs use the tracked `BOQ_HARNESS_MODE=certify` harness mode (no DB writes).

**Nearest-hit ancestor resolution (HV-4, rules side, OPT-IN PER DISCIPLINE):** the runner can resolve ancestor signals at the NEAREST ancestor that fires anything instead of flattening the whole chain into one blob — only signals firing AT that resolution point contribute, and farther ancestors contribute **nothing** (not a decayed remnant; this is the distinction from D1 decay). Config is the discipline's `rules_<disc>.json` top-level `ancestor_resolution: "nearest_hit"`; **ABSENT = the legacy blob path, byte-identical.** The same flag also switches that discipline onto the deterministic tie-break chain (score → rule weight → distinct signal types → declaration order) in place of the legacy **alphabetical-by-`category_id`** tiebreak. **Gating is load-bearing and must not be widened casually: HVAC carries the flag; Electrical does NOT and is proven unchanged on its 2,888-row labelled corpus (identical sweep + per-category CSVs, 86.88%).** Decay COMPOSES with it (the resolution point's one distance is scaled by `m**d`); it does not compete.

**Proximity decay (D1, rules side):** the runner supports PER-DISCIPLINE ancestor proximity decay — an ancestor signal weakens with degree of separation as `weight * rules_multiplier ** distance` (immediate parent `d=0`), contributing ONCE at the nearest matching ancestor. Config is the discipline's `rules_<disc>.json` top-level `decay` key; **default is FLAT (`{"rules_multiplier": 1.0}`) so every shipped discipline is byte-identical to pre-decay**. `classify_line(decay_override=...)` overrides it (the offline-sweep lever); the decay code path runs ONLY for `0 < m < 1.0`. AI-side decay is deliberately HELD (rules side only). **BOTH shipped disciplines are MEASURED FLAT and neither may be changed without a fresh sweep:** Electrical carries NO `decay` block (locked flat by its D2/D2b sweep — do not wire one); HVAC carries an EXPLICIT block at `1.0` stamped **`PROVISIONAL-FIT`** (HV-3 swept the certified ladder over the 1,366 labelled Set-1 rows — flat won, best non-flat `m=0.90` was −8 rows). PROVISIONAL-FIT means fitted on the team's provisional labels: a re-sweep is OWED at clean labels and the value is NOT certified until then.
- `BoQ Category Truth Snapshot` — permanent per-(snapshot event × row) ground-truth labels for the classifier eval (D3a). **Truth model = FREEZE SNAPSHOTS, not live edits:** live `BoQ Row Category` rows are WORKING STATE (a re-classify supersedes them and human verdicts do NOT carry forward — stranding is INTENTIONAL, the carry-forward plan is dropped), while ground truth is BANKED here at explicit events and is PERMANENT (never deleted; unfreeze/re-classify never touches prior snapshots). Identity mirrors Row Category's durable Excel address (`boq`, `sheet_name` VERBATIM #152, `excel_row`, `discipline`, `committed_version`) + a `snapshot_batch` per event + `source` (`Bulk-loaded ground truth` / `Frozen in product`); the cockpit joins a snapshot row to the current Row Category row by `(boq, sheet_name, excel_row, discipline)`. Loaded out-of-band by `services/boq_category/harness/corpus_classify_and_label.py` (modes `resolve` / `classify` / `label`; `label` writes SNAPSHOTS, NOT `human_category_id`, so live rows are untouched). The in-product **Freeze/Unfreeze button is SHIPPED** (`classify.freeze_classification` / `unfreeze_classification` / `get_freeze_summary`): Freeze banks one `source="Frozen in product"` batch (`snapshot_batch = "gtfreeze-"+hash`) consuming this doctype AS-IS AND stamps each categorised eligible row's effective category into `human_category_id`; the "human write-back at a new committed_version" is a re-freeze after a re-classify (the durable-address stamp lands on the new version's rows).

- **Committed read indexes (deploy invariant):** the two D3d read indexes -- `BoQ Committed Sheet Grid Row` `parent` and `BoQ Row Category` composite `(boq, sheet_name, committed_version, discipline, is_current)` -- are declared in each controller's `on_doctype_update` and applied to ALREADY-DEPLOYED databases by the patch module `nirmaan_stack.patches.v3_0.add_boq_read_indexes` (it CALLS the hooks -- single source of truth, not a re-inlined `add_index` -- and is idempotent). A plain migrate does NOT fire `on_doctype_update` for a controller-only change, so existing DBs need this patch; `BoQ Category Truth Snapshot`'s index is EXCLUDED (its hook shipped atomically with the new doctype, so a fresh sync always creates it). The `patches.txt` wiring line is added EXTERNALLY by the maintainer -- it is intentionally not part of the patch.

**BoQ pricing-editor load-bearing invariants** (full rules in `.claude/context/domain/boq-backend.md`):
- **Single-editor lock:** deterministic PK `sha1(boq \x00 sheet_name \x00 int(version))`; reject marker `BOQ_PRICING_LOCKED`; 2-min edit-driven expiry (`LOCK_STALE_SECONDS = 120`); a lock reject mutates NOTHING.
- **Priceability gate (owner-locked, ASYMMETRIC):** a rate is editable iff override OR `node_type == "Line Item"` (always) OR (`node_type == "Preamble"` AND qty-bearing). Enforced BOTH client + server (`save_cell_price`); do NOT collapse the Preamble/Line-Item asymmetry. **The server qty-bearing test lives in the SERVICE layer (`persist.node_is_qty_bearing` / `persist.is_nonzero_qty`, relocated from `pricing.py` in Slice G1) so it is defined ONCE and reachable by both `pricing.py` (imports UP, api->service) and the coming rate-editable category count; the client `isRowQtyBearing` in `PricingGrid.tsx` is a DELIBERATE cross-language duplication, NOT the same code.** **Rate-editable blank-category count (G2a, ADDITIVE, no gate):** `persist.blank_category_eligible_rows` takes a `population` param — `"eligible"` (default, classification set {Line Item, Preamble}, BYTE-IDENTICAL to pre-G2a; `get_freeze_summary` keeps this) or `"rate_editable"` (Line Item ALWAYS + qty-bearing Preamble). The rate_editable path batches the qty test via `persist._qty_bearing_node_names(nodes)` — ONE `BOQ Node Qty By Area` child query, reusing `is_nonzero_qty`; `node_is_qty_bearing` is UNCHANGED (a consistency test pins the batched set == the single-row test per node). `get_priced_rows` ADDITIVELY surfaces `rate_editable_blank_category_count` (int) + `categories_complete` (bool, count==0) — PAYLOAD keys, not schema; **NO gate/lock/override ships in G2a.** **Category gate + admin override (G2b, SHIPPED, MIGRATE-carrying):** `save_cell_price` REJECTS a rate write while any RATE-EDITABLE row has a blank RESOLVED category — `_guard_categories_complete` in `_resolve_and_guard_cell`, placed AFTER the mandatory formula gate and OUTSIDE the priceability override block, so **"Price any row" can NEVER bypass it** (owner ruling; ABSOLUTE like the formula gate; the formula gate still wins precedence). It REUSES the G2a `blank_category_eligible_rows(..., "rate_editable")` (same fn `get_priced_rows` counts from → gate + banner can't disagree; short-circuits when the override is set). **The ONLY escape is an admin override:** `pricing.set_category_override` / `clear_category_override` (admin = the EXISTING `_is_nirmaan_admin`, NOT re-minted; non-admin → `PermissionError`), persisted per-sheet-per-version on 4 new `BoQ Sheet` fields `category_gate_override`/`category_override_by`/`category_override_at`/`category_override_reason` (mirrors the freeze trio; reason optional, capped `_CATEGORY_OVERRIDE_REASON_MAX_LEN=250`, NULL when absent; `set_value(update_modified=False)`+commit). `get_priced_rows` surfaces those 4 keys. **NO grandfathering** (uniform on all committed sheets incl. already-priced; a rate revision on an uncategorised sheet must categorise first). **Blank = classified-and-blank OR never-classified — one definition.** **The WITHIN-BoQ rate carry-forward path is GATED too (G2c, owner ruling): `apply_copy_forward` (within-BoQ version carry). The DESTINATION sheet's categories govern.** ⚠️ **`cross_boq_carry._apply_sheet_carry` (the cross-BoQ REVISION carry) is NO LONGER GATED — ADR-0014 Amendment E (2026-07-28) removed it from that path ONLY.** Once that action CARRIES categories, gating it on categories being complete blocks its own remedy: a freshly committed revision has ZERO category rows, so the gate is shut, so the carry that would populate them cannot run. `save_cell_price` + `apply_copy_forward` KEEP the gate — it exists to stop a HAND-TYPED rate landing on an uncategorised row, and a carry moves known values from a known-good source. **Do NOT "restore consistency" by re-adding it to the carry path** (`test_h_categories_block_is_gone_from_the_message_family` guards the message maps; a re-added branch `KeyError`s loudly, which is intended). ONE shared condition `pricing._categories_gate_ok` (override OR no rate-editable blank — the SAME `blank_category_eligible_rows(..., "rate_editable")` the save gate + banner use) drives the remaining call sites; each keeps its OWN voiced messaging over that one condition: the save path throws via `_guard_categories_complete`, `apply_copy_forward` throws an inline copy-forward-voiced message. The carry gate is SHEET-LEVEL, checked ONCE up front AFTER the mandatory-formula gate (which keeps precedence) and BEFORE the lock acquire — never per-row (never calls `_resolve_and_guard_cell` in the loop; per-row was rejected on cost ~15 ms×K + failure-shape mismatch). Both carries stay ATOMIC (rollback, nothing written on a block) and fully REPLAYABLE + idempotent (freeze-and-supersede; nothing stranded), and the admin override unlocks carry too. **The gate covers the ELIGIBLE MASTER SET ("empty is empty", owner-locked): `node_type` in {Line Item, Preamble}; PRICEABILITY is NOT part of the gate — a qty-less Preamble IS in the set.** BLANK = the category cell the user SEES is EMPTY, whatever the path to empty (never-classified, classified-and-blank, AI-never-ran, human-cleared, whitespace id). `_categories_gate_ok` + `get_priced_rows` pass `population="eligible"` (the DEFAULT), so **the gate count == `get_freeze_summary`'s count == the surfaced `eligible_blank_category_count`** — ONE number, never diverging. (That surfaced key superseded the earlier rate-editable-named one; no consumer existed, so the rename was free.) The `"rate_editable"` mode of `blank_category_eligible_rows` (+ its batched qty helper + its mode tests) is RETAINED but currently UNUSED — kept because the future tendering-module rate helpers operate on exactly that population; do NOT delete it. The client `isPriceableType` (`PricingGrid.tsx`) TRIMS `node_type`, so the server/client master set is byte-identical (the server always strips). **ONE shared frontend predicate `PricingGrid.isMasterSetBlank(row, cat)` = `isPriceableType(node_type) && deriveVerdictState(cat) === "unclassified"` drives BOTH the grid's amber Category-cell fill AND the page's Check-Category view filter, so they can never drift** — it REPLACED `isNeedsReviewCategory`, which returned FALSE for a never-classified row and so could not surface rows the gate now counts. The real-data cost of the widening is owner-ACCEPTED; do NOT re-raise it. Test fixtures satisfy the gate by CATEGORISING (`_categorise_fixture_eligible_rows`), never by override. **VISIBLE HALF (frontend):** the page derives a LIVE blank COUNT client-side from the SAME `isMasterSetBlank` predicate (now FOUR surfaces over one predicate: the server gate/count, the grid amber fill, the Check-Category filter, and this count) via `PricingGrid.countMasterSetBlankRows(rows, categoriesByExcelRow)` -- iterating the ROWS, NEVER the categories map, so a never-classified row (absent from the map) is still counted. Only a BOOLEAN `categoryGateOpen = (count === 0) || override` (`isCategoryGateOpen`) reaches `PricingGrid` -- NEVER the count (a count changes on every pick and would re-render every row; the boolean flips only when editability actually flips). `categoryGateOpen` is ANDed OUTSIDE `isRateEditableRow` in ALL THREE rate-write gates (inline edit, paste, undo/redo), exactly like `formulasComplete`, so "Price any row" can never reach past it. **DELIBERATE asymmetry: the count keeps counting blanks under the override (an admin sees how many remain) but the gate opens.** The category-pick handler writes an optimistic override for BOTH a pick AND a clear (`buildOptimisticVerdict`): a clear yields a BLANK verdict so the count RISES instantly and the sheet re-locks in the same interaction (closing the pick-drops-but-clear-rises-late window). The amber banner shows the count with the owner-approved copy (a distinct OVERRIDE variant naming who/when); it NAMES the existing "Check Category" control (no new button, no click-to-jump). The **save/copy-forward/cross-BoQ refusal messages drop the pre-G2e "priceable"/"rate-editable" wording** (those terms remain correct only for the SEPARATE priceability gate); the save message threads the blank count. `GetPricedRowsResponse` declares the `eligible_blank_category_count` / `categories_complete` / `category_gate_override` (+`_by`/`_at`/`_reason`) keys. **OVERRIDE REMOVAL CONDITION: remove the override once classification engines cover all disciplines.** **The override is CLEARED on a successful WHOLE-SHEET re-classify (G2d, owner-locked): `classify._classify_worker` calls `pricing.reset_category_gate_override_on_reclassify` after the classify commit — SUCCESS-ONLY (never in the `except`), WHOLE-SHEET-ONLY (`scope.mode == "sheet"`; a partial row-range run leaves it INTACT), IDEMPOTENT (no override => no-op), and it MUST NEVER fail the classify run (wrapped in `_clear_override_after_reclassify`, which logs + swallows and returns False — the gate fails SAFE). RATIONALE: a re-classify changes which rows have categories, so an override granted against the OLD picture must not silently carry forward; the admin re-asserts. `set_row_category`, freeze/unfreeze, and partial runs do NOT clear it. The clear write is the SHARED `pricing._write_category_gate_override_cleared` (also used by the `clear_category_override` endpoint — one write, not a third `set_value`). PER-ENGINE by design: a re-classify fires once per selected engine (`ClassifySheetDialog` loops `start_classify` → N independent `_classify_worker` runs; NO all-engines completion barrier), so each engine's worker clears independently and an override re-set between two engines' completions is wiped by the later one.** The G2c carry messages' "your existing rates are untouched" promise is now VERIFIED by test (a pre-existing destination rate survives a refused carry byte-identically, both flavours). G3b (the admin override SET/CLEAR control) SHIPPED. Still OWED: clearing the override on re-classify is DONE; remaining is the admin override's eventual REMOVAL (condition above).
- **Mandatory amount-formula gate (ABSOLUTE):** every amount column needs a covering formula before ANY rate is editable; the `allow_non_priceable` override does NOT bypass it. **It also gates the whole revision carry (ADR-0014 Amendment C)** — see below.
- **Revision carry (owner-locked, ADR-0014 Amendment C + Amendment E):** a revision COMMIT carries **nothing** but the D2 provenance triple (`committed_carry.stamp_revision_provenance`; the stamp must stay — it is how the carry finds its source). Formulas are **hand-declared per sheet**, exactly as in the normal phase, and that declaration gates ONE explicit per-sheet action in the pricing editor (`cross_boq_carry.apply_sheet_carry` — synchronous, atomic). **Amendment E (2026-07-28) REVERSED Amendment D and restored the four row-addressed layers, OPT-IN + ATTRIBUTED**: that action moves rates **plus** any ticked subset of `LAYER_KEYS = ("categories", "remarks", "colors", "remark_dismissals")`, riding the SAME transaction. Amendment D's objection was that carried records arrived **un-asked-for** and **un-attributed** — BOTH halves must stay answered or the original defect returns: (1) every layer is opt-in (dialog defaults categories ON, annotations OFF — a **UI default, never a backend one**; an omitted payload carries rates only), and (2) every carried record is stamped `carried_from_boq`/`carried_from_version`/`carried_at`, **keyword-REQUIRED on `persist.carry_row_categories`** so no path can produce an unstamped record — do NOT soften it to an optional kwarg. **⚠️ The carried `human_verdict_at` keeps the SOURCE's older timestamp — never freshen it**: `resolve_row_ladder` breaks a human-vs-human tie on the most recent verdict, so keeping it old is exactly what makes a verdict made ON the revision outrank a carried one, with no precedence code anywhere. **⚠️ `carry_category_layer`'s classification-freeze guard is the ONLY one on this path** (`cross_boq_carry` gates the freeze nowhere) — it is NOT defence in depth and must not be removed as redundant. Formulas NEVER carry, in either seam. The source read is **version-pinned** to the original's current committed version, and `revision._carry_counts` is pinned identically — **never pin one without the other** (that divergence is the defect Amendment B W6 was written for). ⚠️ Frappe **STRIPS every value in an `["in", [...]]` filter** (an `=` comparison is not), so any committed-sheet read filtering on `sheet_name` must filter names **in Python** — use the shared `revision_carry.current_committed_sheets`.
- **Committed controllers are CAPTURE-ONLY** (Phase 5 Slice 2.5): no amount = qty×rate recompute, no parent-rate overwrite — the future tendering module owns calculations.
- **Classification freeze (owner-locked, SEPARATE from the pricing lock):** a per-sheet freeze on the committed `BoQ Sheet` (`classification_frozen`/`frozen_by`/`frozen_at`, set via `frappe.db.set_value(update_modified=False)` — NEVER `doc.save`). While frozen, category verdict writes AND re-classify are rejected via `_guard_classification_not_frozen` (primary in `set_row_category` + `start_classify`; defence-in-depth in `persist.set_human_verdict` + `orchestrator.classify_sheet_rows`); the ONE frozen-reader is `persist.is_sheet_classification_frozen`. **Pricing is NOT touched by this guard — it is NOT ORed into the pricing `locked`/`is_locked` gate; a classification-frozen sheet is still fully priceable.** Freeze is ATOMIC (single end-commit, rollback-on-failure): it stamps effective categories via the no-commit `persist.stamp_human_verdicts_bulk` (NOT `set_human_verdict`, which commits per call) + banks a `Frozen in product` snapshot batch. **The stamp SOURCE is the MULTI-ENGINE resolved read (Slice ST-1, owner Option A 2026-07-26): `persist.resolved_category_stamp_targets` — the exact INVERSE of `blank_category_eligible_rows`, sharing the ONE `persist.resolve_row_ladder` — so a sheet classified under N disciplines stamps rows from EVERY vocabulary in one freeze, each on its RESOLVING discipline's `is_current` row (grouped through `stamp_human_verdicts_bulk` per discipline). ONE FIFTH-SURFACE NUMBER: snapshot_count == the resolved non-blank eligible count == `get_freeze_summary`'s number. On a single-discipline sheet the stamped set + snapshot content are BYTE-EQUIVALENT to the prior single-discipline stamp (pinned by test). `get_sheet_categories` is BYTE-UNTOUCHED (the freeze trap — it now backs ONLY the tests' regression pin). The `discipline` parameter is accepted but drives ONLY the availability guard, NO LONGER the stamp set (mirrors `get_freeze_summary`'s accepted-but-unused disposition). Re-freeze after a re-classify inherits automatically through the SAME resolved read — a fresh run banks a NEW snapshot batch while prior batches stay permanent.** Re-commit resets the flag (a fresh `BoQ Sheet` row defaults 0). Frontend reads `classification_frozen` off `get_priced_rows` beside `is_locked`.

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

**Docs discipline -- DOCS-UPDATE RULE (revised 2026-06-25, context-hygiene split):** Per-slice / per-commit as-built detail (feat hashes, test/vitest/tsc counts, build logs, dated slice narratives) goes into the on-demand reference docs ONLY: `frontend/.claude/plans/boq-upload-plan.md` (live status, source of truth) + `.claude/context/domain/boq-backend.md` (backend) + `frontend/.claude/context/domain/boq-frontend.md` (frontend). The always-loaded `CLAUDE.md` files get a MINIMAL touch ONLY when a STABLE convention or a load-bearing / owner-locked invariant changes — never a per-slice changelog entry. **Do NOT re-grow `CLAUDE.md` with commit data** (that bloat is exactly what this split removed). **Enforced in-session by the `.claude/hooks/guard_claude_md.py` PreToolUse hook** — it blocks changelog-style appends to CLAUDE.md and redirects them to the reference docs (see `.claude/hooks/README.md`; tune the patterns there). **Frontend conventions file: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**

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

## Pricing Module

Standalone estimation-pricing module (separate from the BoQ wizard). Frontend serves a spreadsheet
editor (Luckysheet-as-static-assets planned) whose workbook state is persisted server-side. Live status
+ roadmap: **`frontend/.claude/plans/pricing-module-plan.md`**.

- **Doctypes** (`nirmaan_stack/nirmaan_stack/doctype/`): `Pricing Workbook` (title, `workbook_json`,
  `current_version`, `checked_out_by`/`checked_out_at`), `Pricing Workbook Version` (per-save snapshot),
  `Pricing Access Log` (open/save/checkout/release/create audit). **All three are `System Manager`-only** —
  the whitelisted API is the single-point access gate, so endpoints read/write with `ignore_permissions=True`.
- **API** (`nirmaan_stack/api/pricing/workbook.py`): `list_workbooks` / `get_workbook` / `checkout` /
  `release` / `save_workbook` / `create_workbook`, all `@frappe.whitelist()` and all gated by
  `_require_pricing_access()`.
- **Transport (FR-5/FR-6):** `create_workbook(title)` and `save_workbook(name)` take **NO `workbook_json`
  param**. They are thin wrappers that read + gunzip the `workbook_json_gz` **`multipart/form-data`** file from
  the request (`_read_gzip_payload` / `_gunzip_payload`, with a 200 MB decompressed guard) and delegate to
  `_create_workbook` / `_save_workbook`, which hold all logic unchanged. Single path, no fallback — the old
  nested-JSON body escaped every quote (1.23x) and 413'd a real workbook against the 25 MiB `max_file_size`;
  gzipped it is ~0.7 MB. Other endpoints unchanged.
- **Access rule — READ/WRITE SPLIT (owner decision, DB-discovered names; PW-2a):** two gates, the write one
  LAYERED on the read one so an outsider and an in-module read-only user get different, honest messages.
  - **READ** (`_require_pricing_access`, used by `list_workbooks` / `get_workbook`): ALLOW if session user is
    `Administrator`, OR `role_profile_name` is in `PRICING_ACCESS_SET`, OR `frappe.get_roles(user)` intersects
    it. The set holds the EXACT DB-verified strings (2026-07-22): `Nirmaan Admin Profile`,
    `Nirmaan Estimates Executive Profile`, `Nirmaan Estimates Executive` — **admins + estimation**.
  - **WRITE** (`_require_pricing_write_access`, used by `checkout` / `release` / `_save_workbook` /
    `_create_workbook`): read gate first, then `Administrator` OR profile/role in
    `PRICING_WRITE_SET = {"Nirmaan Admin Profile"}` — **admins only**. Estimation users get read + the
    client-side Sandbox (a local, never-persisted edit session) and no write path at all.

  Re-query the DB before editing either set. The frontend mirrors the split for UX only — **this module is the
  enforcement boundary**, and `PricingRoute` stays wide (estimation users must still enter the module). Only
  `workbook_json` parsing is validated; structure is frontend-owned.
- **Lock semantics:** `checkout` grants when the lock is free, already the caller's, or held >30 min
  (auto-expiry) — otherwise it throws naming the holder. `save_workbook` requires a live (non-expired) lock,
  bumps `current_version`, writes a Version row, and prunes to the newest 20 snapshots. `release` clears the
  lock for the holder or Administrator.
- **Tests:** `nirmaan_stack/api/pricing/test_pricing_workbook.py` (**20 tests**). Run:
  `bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.api.pricing.test_pricing_workbook`.
  Writes run as admin-role fixtures (`ADMIN_USER`/`ADMIN_USER2`); `POS_USER` is the estimation actor used for
  the read + negative-write assertions. Every workbook creation MUST go through `_create_as` — the suite runs
  against the LIVE site DB and its purge is scoped to rows it created.

---

## BoQ Rate Master (RM-1)

Backend rate-master for the pricing helper (the standalone estimation data behind cable/termination
rates). Full as-built lives in the plan doc + `.claude/context/domain/boq-backend.md`.

- **Two committed doctypes hold it:** `BoQ Rate Master Item` — discipline-wide priced-item master,
  addressed by `(discipline, kind)`, with a keyed `attributes` JSON (matched EXACT) + a keyed `rates`
  JSON (the raw list/base rates); and `BoQ Rate Category Config` — per-`(discipline, category_id)`, the
  whole config as one JSON blob (attribute definitions + derivation pipelines + `normalization_rule`).
  **JSON fields, not child tables**, per the app's flexible/UI-driven-data rule. Both `track_changes: 1`;
  minimal controllers each declaring a composite read index (`[discipline, kind, brand]` /
  `[discipline, category_id]`) via `on_doctype_update`.
- **Canonical-UPPERCASE normalization at ingest (owner-locked):** the loader uppercases `material` /
  `insulation` on import so messy future workbook exports self-clean at the boundary; ALL downstream
  matching is EXACT on canonical values — there is NO case-insensitive matching anywhere.
- **Batch-provenance import, freeze-and-supersede:** every row of one import carries ONE `import_batch`
  (prefix `rmbulk-`), mirroring `BoQ Category Truth Snapshot`'s gtbulk provenance. A re-run against
  existing active data for a discipline REFUSES cleanly; `--replace` deactivates the prior batch
  (`active=0`, rows retained) and loads fresh — idempotent, no duplicate active rows. Import runs
  service-side (`services/boq_rate_master/loader.py`); RM-1 ships NO write endpoint. Reads are the
  login-required, active-only endpoints in `api/boq/rate_master.py` (`get_rate_master_items` /
  `get_rate_category_config`); the editors are RM-4a (SHIPPED — see below).
- **RM-4a editing endpoints (ADMIN-ONLY, owner option (a); full as-built in the plan doc's "Build slice
  RM-4a").** Four `@frappe.whitelist(methods=["POST"])` writes in `api/boq/rate_master.py`:
  `update_rate_config_param` / `update_rate_master_item` / `create_rate_master_item` /
  `deactivate_rate_master_item`. ALL gate on the IMPORTED `pricing._is_nirmaan_admin` (never a re-minted
  copy), admin gate BEFORE any target resolution or write (`frappe.PermissionError` otherwise). **The
  AUDITED write recipe is `doc.save(ignore_permissions=True, ignore_version=False)`** (get_doc → json.loads
  → mutate the parsed dict → json.dumps → save → commit): both doctypes are `track_changes:1` with
  DICT-valued JSON only (config/attributes/rates — no BoQ-Sheet-style list-valued field), so `doc.save` is
  safe AND records a `Version` diff. **`set_value` is FORBIDDEN for these edits — it bypasses the doc
  lifecycle, so it skips the Version audit.** The explicit `ignore_version=False` is load-bearing (Frappe
  defaults `ignore_version = frappe.flags.in_test`, so without it the audit Version is suppressed under
  `bench run-tests`). **PARAM VALUES ONLY** (numeric; the addressed `config.pipelines[id].steps[i].params` /
  `.conditions[j].params` path must ALREADY exist — adding/removing a param, editing conditions, or
  attribute definitions is RM-4b → validation error, no write). A manual `create` stamps provenance
  `import_batch="manual-"+hash` / `source_sheet="Manual entry"` / `source_row=0`; `deactivate` sets
  `active=0` (RETAINED, never deleted). Frontend HIDES every affordance for non-admins (`isRateMasterAdmin`;
  the server is authoritative). The first `Version` docs for the two rate-master doctypes now exist.
- **RM-4b structure editor (ADMIN-ONLY; full as-built in the plan doc's "Build slice RM-4b").** ONE
  `@frappe.whitelist(methods=["POST"])` write `update_rate_config(name, config)` in `api/boq/rate_master.py`
  LIFTS the RM-4a param-values-only boundary — add/remove params, steps, conditions, and attribute
  definitions. Admin-gated FIRST (`pricing._is_nirmaan_admin`), then FULL server-side STRUCTURAL VALIDATION
  (`_validate_config`) before the SAME audited `doc.save(ignore_version=False)` recipe; valid → write, invalid
  → a NAMED `ValidationError`, NO write. Validation: known step types ONLY (the 8-member interpreter
  vocabulary); every `params` a map of FINITE numbers; conditions are `{attribute: scalar}` EXACT-match
  predicates (**the ONLY shape the pure interpreter executes** — a `{in:[...]}` / `{gte/lt}` predicate OBJECT
  is REJECTED, since the interpreter would silently never match it and changing its semantics is OUT OF
  SCOPE); component_band bands are comparator strings; attribute_definitions well-formed; **a REFERENCE GUARD
  rejects removing a definition any pipeline condition/`band_on` references, naming every referencing
  location**; no unknown top-level keys; an identity guard forbids repointing discipline/category_id.
  **GOLDENS-AS-CONFIG-DATA:** the config carries a `goldens` array (attrs + expected finals per pipeline)
  seeded via ONE audited endpoint call; the vitest golden files stay INDEPENDENT pins. The frontend Pipelines
  tab's PREVIEW GATE computes the goldens against a draft before save (confirm-not-block). Interpreter
  EXECUTION semantics untouched. Tests `test_rate_master` 14→22.
- **Multi-category import + scoped supersede (owner-locked; full detail in the plan doc's "Build slice
  EA-1").** A rate-master payload may carry a `category_configs` LIST (each config a `BoQ Rate Category
  Config` row, discipline stamped from the top-level payload, per-category goldens merged in as RM-4b
  config-data); `loader.load_rate_master` branches to `_load_multi` and the single-config path is
  unchanged. **Idempotency is SCOPED to the payload's item KINDS + config category_ids, NEVER the whole
  discipline (`_deactivate_scope`): a `replace=True` supersedes only that scope, so importing the
  non-wiring Electrical categories can NEVER deactivate a wiring (cable/termination, wiring_cabling) row —
  the WIRING-UNTOUCHED invariant.** Non-wiring Electrical categories are loaded by PATH from a separate
  asset; `DEFAULT_DATA_FILE` stays the wiring asset.
- **Interpreter step vocabulary (owner-locked, MINIMAL — no loose-formula generalization; the asset
  normalizes every formula to `base` = the step's target value + EXACT param names).** Beyond the wiring
  set, the pure `ratePipelineInterpreter.ts` supports: `component_band` STRING-EQUALITY bands (band_on read
  from the matched item, falling back to the selection) alongside the legacy numeric comparator bands; a
  `scale` value-from-attribute multiply (a `*_from_attr` param binds the selected attribute's value;
  missing/non-numeric → HONEST no-compute, never a zero default); `match_master_row` on the
  stored-vs-selected INTERSECTION (a row matches on the keys it carries, exact where they overlap — wiring,
  whose key sets coincide, is unchanged); and a conditional `component` (params resolved by attribute
  conditions on the selection, formula may be param-only — an unmatched condition is an HONEST no-compute).
  A conditional `component` may ALSO carry a `target` (base from the matched row) together with its
  conditions (e.g. the tray `cover`, `base*factor`) — this shape needed no interpreter change.
  **EA-2b — the CORRECTED cable-tray config is FOUR pipelines** (supply/install/bcs/bcs_install):
  conditional-component adders (cover / ceiling 106 / refill 180 / cutting 200) + a **width-table install
  match** (kind `tray_install_rate`, ×4). The old single `tray_boq` (install = supply ×0.2, golden 280/60)
  was WRONG and is DELETED; oracle goldens t1/t2/t3 (431/120/297/0, 415/120/286, 410/200) are the pins,
  machine-verified (config-data preview gate + vitest + live Derivation), so the tray is OFF the manual
  verification list. **EA-2c — `component_ref` (a NEW step): base from a SEPARATELY-REFERENCED master row**
  matched by `ref.kind` AND every `ref.attributes` (exact canonical, this discipline). UNIQUE resolution:
  zero OR multiple matches is an HONEST no-compute (never zero-by-default, never pick-first); the referenced
  row's `target` binds as `base`, then conditions/params/formula per the component contract; the trace names
  the referenced row (`StepTrace.refItem`). It is a first-class vocabulary member (client STEP_VOCABULARY +
  server `_KNOWN_STEP_TYPES`/`_validate_config`). **Owner correction: the earthing adder ADDS A BUS BAR (the
  existing Bus bar earthing_item row), NOT an earth chamber** (the chamber attempt was reverted, asset v8
  skipped v7->v9). This is ONE ROW, TWO ROLES (requirement #7, shared items stored once): the Bus bar row
  prices both as a selectable item AND as the adder; an edit to it flows into both. **component_ref is the
  ASSEMBLY PRIMITIVE's simplest form.** **EA-4a SHIPPED the assembly engine (owner-locked):** two pure-TS
  shapes — `circuit_fit` (sizes conduit + counts circuits: `overall_dia = sum sqrt(sqmm/pi)*2*core`;
  `fitted_size` = smallest usable-dia >= dia; `circuits = ROUNDDOWN(usable/dia)`; `conduit_qty =
  ROUNDUP(length/circuits)`; binds into ctx) and **`component_ref` extended** (ref attrs literal | `@attr` |
  `@fitted_size`; `rate_stages [{mult,round?:up0|up-1}]` with PER-STAGE rounding; `qty` = number |
  `{from_attr}` | `{from_fit}` | `{if_attr,then,else}`; `value = staged_rate * qty`; UNIQUE resolution else
  honest no-compute; both obey Option-C never-throws). **PER-STAGE ROUNDING is faithful to the guiding sheet
  and INTENTIONAL** (install switch `ceil(list*0.3625)` THEN `*0.2` UNROUNDED — pw1 `155*0.2=31`, pw2 White
  `131*0.2=26.2`); do NOT collapse to one final round. **`point_wiring` is LIVE** (14 defs, 3 pipelines);
  goldens **pw1 1869/735/1370** + **pw2 1823/722.2/1342** (MS→3 circuits; the fractional 722.2 pins per-stage
  rounding) are config data AND standing pins — a golden's attrs are an ATOMIC SET. **A switch-only light
  point (socket_item null) is an HONEST NON-COMPUTE — the EA-4a-r acceptance case, not a defect** (EA-4a-r
  adds a `None` socket next). **The nine `extraction_defaults` (owner-locked):** a config default is INJECTED
  into the extraction prompt and, where the row text gives no positive identification, returned with moderate
  confidence AND stamped `defaulted:true` (raceway also carries a `text_override`); ABSENT => byte-identical.
  **`values_from` is resolved in BOTH surfaces** — `RateMasterDerivation` AND the editor helper
  (`pricingSheetHelper.attributeOptions`, options from the live master by kind+where) — so an AI-extracted
  item with no static `values` still DISPLAYS in the panel select and a partial row completes from the
  catalog. **EA-4a-r SHIPPED the NONE mechanism (owner-locked):** a composite component may be POSITIVELY
  ABSENT -- the sentinel string `"None"` (distinct from blank=unknown) makes that line an EXPLICIT ZERO
  (`export const NONE_SENTINEL`). Config: an attr def carries `allow_none` + `disables_when_none` (the dependent
  attr ids greyed/cleared when it is None -- e.g. plate_item -> [plate_qty, back_box]); a `component_ref` carries
  `none_skips` (a ref @attr resolving to "None" -> the component is 0, fired BEFORE the ref lookup, so
  `socket_item="None"` doesn't abort; back_box binds @plate_item so plate=None zeroes it too); `circuit_fit`
  carries `optional_wire_when_none` (that wire is omitted from the dia -> single-wire fit). **The None affordance
  is GENERIC + input-appropriate:** a CHOICE def offers "None" at the top of its select; a NUMBER def offers a
  "None" CHECKBOX beside the numeric input (checked -> sentinel + input greys/clears) -- both in the Derivation
  AND the editor panel. `coerceForMatch`/`_coerce_value` PRESERVE "None" for an allow_none def (number included).
  Extraction injects "None" as a valid value + a guidance line ("None when the bill names no such component;
  null only when too vague"); `extraction_none_guidance` may be a custom string OR a truthy flag. Goldens: **pw3**
  (switch-only, socket="None") -> supply **1682**; single-wire (wire2="None") -> **1362**. A switch-only light
  point (socket null, no None) stays honest no-compute until the None is set. **EA-4b SHIPPED switches_point +
  the industrial_sockets paired-MCB (DATA-ONLY -- NO interpreter change; every shape is existing vocabulary):**
  `switches_point` is a 6-line switch/socket/plate/box assembly (TWO None-able socket slots; distinct from
  point_wiring -- no circuit_fit/wires; golden sp1 2320/470/1600); `industrial_sockets` gained a `paired_mcb`
  `component_ref` that is CROSS-CATEGORY (ref.kind `db_switchgear_item`) + gated by a `qty if_attr` interlocked
  rule (`{item:"...Interlocked"}?0:1`), with **`extraction_defaults={paired_mcb:"None"}` the production fix** so a
  socket-only row prices instead of refusing (absent=unknown->no_match; "None"=positive-absence->0 line -- the
  EA-4a-r distinction, owner-locked). Tray ceiling-accessories are a CONFIRMED FIXED 106 scalar (do not make
  adjustable this era). **EA-4c SHIPPED the DB build-up + the `lookup_or_ratio` interpreter step (owner-ruled
  ONE new capability -- implement the sheet's IFERROR install EXACTLY):** the build-up is FIVE FIXED None-able
  MCB slots (mirroring the sheet's I10:I14) + a `db_shell` slot (allow_none -- **MCB-only, shell None, is a REAL
  product = the sheet's `IF(J9=0)` branch**, the same module pricing bare MCBs) + enclosure, summed x0.495
  (supply) / x0.3 (bcs); supply + bcs are EXISTING vocabulary (`component_ref none_skips` cross-kind to the NEW
  `db_shell` kind, `sum_components`, `scale`, `roundup`), so the earlier "variable-length list step +
  extraction-payload extension" prediction was WRONG -- the scalar one-attribute-set-per-row payload carries the
  fixed slots and needed NO extension. **`lookup_or_ratio` is the sheet's EXACT IFERROR three-way install**
  (owner contract, do NOT improvise): (a) `when_shell_absent.attr=="None"` -> `ROUNDUP(ratio.of x ratio.mult)`
  [shell-absent]; (b) else the unique install-table lookup (`kind`+`item`==`@attr`) resolves -> `ROUNDUP(matched
  [target] x mult)` [table-hit]; (c) lookup MISS -> `ROUNDUP(ratio.of x ratio.mult)` [IFERROR fallback]. A ratio
  branch with an uncomputed `ratio.of` is an HONEST no_match; a malformed shape NEVER throws (Option C ->
  `unsupported`); the trace NAMES the branch. Pass-through in `rate_master._KNOWN_STEP_TYPES` (no deep
  validation; its `@db_shell_item` is reference-guarded via the supply `component_ref`s). Goldens dbu1 (VTPN
  fallback 24360/3660/14760) / dbu2 (TPN 8WAY table-hit install 1500) / dbu3 (MCB-only shell None 23840/3580/
  14450). **This CLOSES the assembly-category arc (point wiring, switches point, industrial-socket pairing, tray
  accessories [fixed], DB build-up all live).** A discarded v16b data-only attempt (shell REQUIRED, no
  none_skips) was reverted for this owner ruling.
  **EA-4d (owner-locked) supersedes the db_switchgear extraction + install-rounding invariants (asset v17,
  sha `c41ba8e7ce2e0b8b`):** (1) the DB SINGLE-ITEM path is REMOVED -- `db_boq`/`db_install_nondb`/
  `db_install_db`/`db_bcs` pipelines + the `family`/`item` attrs are GONE (they had NO sheet-cell basis; the
  whole guiding DB block IS the build-up). db_switchgear carries ONLY the 3 build-up pipelines; the 137
  `db_switchgear_item` master rows stay (the build-up slots reference them). (2) db_switchgear is the FIRST
  `matching_mode: "composite_decomposition"` category -- a GENERAL extraction mode driven ENTIRELY by
  `composite_slots` (shell / repeatable `{prefix,count,...}` -> enumerated slot attrs / fixed) +
  `decomposition_rules`, with NOTHING db-specific in `extraction.py`; **a second composite (switches_point /
  industrial sockets / future HVAC) opts in by config alone -- zero code change** (seam = `select_prompt_text`
  + `build_slot_spec`; prompt asset `prompts/boq_composite_decomposition_prompt.md`). Owner resolution rulings
  (in the prompt + `decomposition_rules`): CURVE BoQ-stated->UPS-context-D->default-C; AMP exact-or-NEXT-HIGHER
  (never lower), range takes highest; PARTIAL pricing (un-cataloguable components -- ATS, standalone bus bar,
  weatherproof enclosure, module-flexi shell, bespoke DB -- left out, never a wrong pick; whole-row no-match ->
  all null). (3) `lookup_or_ratio` now honors `round_lookup` (table-hit) + `round_ratio` (ratio branches)
  SEPARATELY; v17 sets `round_lookup: null` (table-hit UNROUNDED `VLOOKUP*1.5`, sheet-faithful) + `round_ratio:
  -1`; the legacy single `round` stays the fallback for both. Goldens: dbu1 fallback 24360/3660/14760, dbu2
  table-hit 1500, **dbu4 TPN-6WAY table-hit install 1275 UNROUNDED** (the fix; the EA-4c 1280 was the drift);
  d1/d2 removed.
  **A functional config with a RED preview gate is exactly what the gate exists to surface -- even when the miss
  is in the golden, not the pipeline (two i1 golden defects caught + fixed by regenerated assets at EA-4b).**
  **The wiring + point_wiring + switches_point goldens are the standing regression pins; the wiring-asset
  invariant sha is `76e09bba0d7affa1` (ext-b 2026-08-05 -- was `dcc9b2ea69f072bb`; the owner ACCEPTED this break when `runs` landed. The earlier `c10509…` was a stale carry-error).** The Rate Master category selector is
  REGISTRY-driven (`rateMasterRegistry.ts`), not config-read. The pricing-sheet helper stays wiring-only
  and shows its category coming-soon note for other categories (honest no-compute). A `scale` step whose
  TARGET RATE is missing (`null`/`NaN`) SKIPS that output (renders absent, never invented as 0) while the
  pipeline's other outputs still compute — the HONEST-PARTIAL rule (a source row with supply but no install,
  or vice-versa, prices only what exists).
- **THE GUIDING-SHEET AUTHORITY RULE (owner-locked standing law, 2026-07-29).** A rate-master category gets
  FINALIZED rules ONLY if it has a block on the **ALL ITEM WISE RATE** sheet; no block → no rules. Every
  future category/discipline inherits this. **Corollary:** where the guiding block carries its rates
  DIRECTLY, the block IS the table (no background-sheet dependency) — **miscellaneous** is the first such
  case (its items carry `boq_supply`/`boq_install` that ARE the BoQ rates; `misc_boq` is direct factor 1.0,
  `misc_bcs` = `boq*0.8` with install 0). The EA-1 "UPS" decode was a misread **Floor BOX** block: UPS is
  removed (excluded-by-ruling) and **popup_boxes** is the corrected decode (per-module, the
  value-from-attribute shape). A category may be committed DATA-ONLY (empty `pipelines: {}` — attribute
  definitions + items, no derivation) when its ruleset is not yet authored; **lighting_mgmt_system** is the
  first, to be authored in-system later (the loader + all four surfaces + the preview gate tolerate empty
  pipelines honestly — no derivation output, no crash). **EA-2 SHIPPED the in-system authoring path:**
  `_validate_config` now ACCEPTS empty `pipelines: {}` (a non-empty pipelines object is still fully
  validated), and the RM-4b Pipelines tab has an **Add-pipeline affordance** (id + output keys -> a
  validator-minimal `{output, [match_master_row]}` via `blankPipeline`, then edited via AddStep).
  `_KNOWN_CONFIG_KEYS` also gained FOUR pass-through keys (`identity_attribute_id`, `matching_mode`,
  `notes`, `pipeline_labels`) stored VERBATIM and NOT structurally validated (like `item_kinds`) —
  REQUIRED because RM-4b resubmits the whole config, so an item-identity config (or the wiring
  `pipeline_labels` edit) would otherwise be rejected as an unknown key.
- **Retired-scope supersede (loader, owner-locked).** A multi-config payload may declare `retired_kinds` /
  `retired_category_ids` — kinds/categories dropped from THIS payload that a `replace=True` must ALSO
  deactivate (a second scoped-supersede beyond the payload's own kinds/categories), so a retired
  kind/category left active from a prior batch (e.g. ups after the Floor BOX correction) is superseded rather
  than left orphan-active. Freeze-and-supersede (rows retained), logged in the load summary; the
  wiring-untouched invariant is unaffected.
- **Benchmark data (owner ruling):** the committed data asset is the **28-Jul benchmark workbook**
  (`rate_master_wiring_cabling_v3.json`) — the reference going forward, superseding the earlier 25-Jul
  reference. A benchmark refresh is a `replace=True` re-import of a new asset (freeze-and-supersede: the
  prior `rmbulk-` batch goes inactive, rows retained). NOTE: `loader.DEFAULT_DATA_FILE` is version-pinned
  to the asset filename (a known wart flagged for a future de-pinning slice), so a rename forces a loader
  edit in lockstep.
- **29-Jul truth-file cycle (EA-DIFF, owner-locked; the E-ALL benchmark of THAT cycle was
  `rate_master_electrical_all_v12.json` — the CURRENT E-ALL asset is `rate_master_electrical_all_v22.json`,
  sha256 prefix `f1344c1853614d75`; asset lineage v9->v12, v10/v11 skipped):** four
  data changes + two owner-ruled invariants. (1) **Synonyms** — a config may carry top-level `synonyms`
  `{attr_id:{variant:canonical}}` (conduit `{conduit_type:{GI:MS}}`); consumed TWICE (defence in depth) — the
  extraction prompt INJECTION (`extraction._extract_batch`, `.md` assets untouched) AND `_coerce_value`
  variant->canonical mapping BEFORE the allowed-values check. ABSENT => byte-identical. (2) **GI conduit rows
  EXCLUDED** (`conduit_type` now [PVC,MS]); a GI row prices at MS via the synonym. (3) **point_wiring** — a
  DATA-ONLY category (`pipelines:{}`, `item_kinds:[]`) with a banked EA-4 oracle `1869/735/2604` in
  `config.notes`; it is the FIRST kind-less category. (4) **DB install three-way split** (db_switchgear): kind
  `db_install_rate` + pipelines `db_install_db` (DB-family, scale x1.5) / `db_install_nondb` (switchgear+enclosure,
  15% of BoQ supply). **OWNER-RULED SHAPE (load-bearing):** `db_install_nondb` MUST be a **`component` step with
  `conditions`** (NOT `scale` — the interpreter's `scale` does NOT bind `conditions`, only `component` /
  `apply_effective_multiplier` do; a `scale`+conditions ships an unbound identifier that throws). Its conditions
  EXCLUDE the DB family (a DB row matches no condition -> honest no-compute, so DB install comes ONLY from
  `db_install_db`). **THE DEMOTION-STYLE LESSON: `scale` binds only top-level `params`; conditional params require
  `component`.** (5) **Interpreter robustness (Option C, owner scope-add):** `runPipeline`'s "never throws on data
  shape" contract is ENFORCED — a data-shape formula throw (unbound identifier / malformed) DEGRADES to the honest
  `unsupported` status, page + helper NEVER hit the error boundary. The Data-Viewer **empty-scope** rule
  (`rateMasterStructure.isCategoryDataScopeEmpty`): a kind-less category renders an honest empty state (0 rows,
  note, no Add-row), NEVER the discipline-wide all-items list; LMS (declares `item_kinds`) is unchanged.
- **Estimator `rules` (EA-4 ext-a, owner-authored config data; full as-built + the four rules verbatim in
  the plan doc's "Build slice EA-4 ext-a"):** a category config may carry a top-level `rules` array
  (`{id, label, applies_to, guidance}`) of OWNER-AUTHORED estimator guidance. It is a `_KNOWN_CONFIG_KEYS`
  pass-through key, read into the extraction context **UNGATED** (unlike `slot_spec` /
  `decomposition_rules`, which are composite-only — R7 lands on `cabletray_raceway`, an ordinary
  attribute category) and injected as an `ESTIMATOR_RULES` prompt block beside SYNONYMS / DEFAULTS.
  **NO interpreter change; absent key => byte-identical prompt.** The guidance text is the contract —
  it is passed through VERBATIM and nothing in the app rewords it. Rendered read-only on the Derivation
  tab, with an explicit "No rules configured for this category." empty state (that tab had no
  empty-state precedent). Live: `db_switchgear` R2/R3/R4, `cabletray_raceway` R7.
- **Cable RUNS and CORES are SEPARATE and are NEVER multiplied together (owner-locked).**
  `wiring_cabling` carries BOTH a `runs` and a `core` attribute, each defaulting to **1** via
  `extraction_defaults`. **The core count IDENTIFIES the cable in the catalog; the run count
  MULTIPLIES its price** — collapsing them would match the wrong cable. This is the OPPOSITE of
  `point_wiring`, which records runs INTO its wire-core value (`wire1_core`/`wire2_core`, labelled
  "Wire N - runs (Core)", both defaulting to 1): point wiring is single-core in the ordinary case, so
  a stated run count IS the core value and a line stating both records the PRODUCT. **Two categories,
  two deliberately opposite rules — do not "harmonise" them.**
- **All four wiring pipelines multiply by runs, at FIVE points not six (owner-locked).** A `scale`
  step carrying `runs_from_attr` (existing vocabulary; precedent `popup_boxes`
  `module_count_from_attr`) attaches AFTER each output's `roundup`, so runs multiplies a ROUNDED
  per-unit rate: `cable_boq` supply + install, `termination_boq` **supply ONLY**, `cable_bcs`,
  `termination_bcs`. **⚠️ `termination_boq` install is NOT multiplied — `install_as_ratio` derives it
  from the already-multiplied supply, so a second multiplier would make install runs-SQUARED.** The
  supply multiplier MUST stay BEFORE `install_as_ratio` for that inheritance to hold. `cable_boq`
  install IS multiplied because it scales the raw `install_base_per_mtr`, not supply.
- **A golden's attrs are an ATOMIC SET — a new attribute must be added to every stored golden.**
  Introducing `runs` made all five wiring goldens no-compute (`attribute 'runs' missing or
  non-numeric` — the interpreter's honest no-compute) until each golden's `attrs` gained `runs: 1`;
  the expected VALUES are untouched, since the goldens are invariant at runs=1 by construction.
  ⚠️ **Multi-run goldens (runs > 1) are OWED from the owner and must NOT be computed from our own
  code:** the guiding sheet carries no runs concept, so a multi-run value has no sheet basis.
- **`rules` remains an UNGATED `_KNOWN_CONFIG_KEYS` pass-through** reaching every category regardless
  of `matching_mode`; an absent/empty array yields a byte-identical prompt. Rule text is owner-authored
  and passes through VERBATIM — nothing in the app rewords it.
- **point_wiring records RUNS and CORES SEPARATELY, and they are NEVER multiplied together
  (owner-locked).** `wire1_runs`/`wire2_runs` are per-WIRE attributes, each defaulting to 1 beside
  `wire1_core`/`wire2_core`. **CORES is the CATALOG MATCH KEY** (the `ref.core` binding), **RUNS drives
  the conduit GEOMETRY and the WIRE RATE.** One attribute serving both purposes is exactly what broke
  the previous rule: folding runs into cores wrote a core count with no catalog row behind it, and the
  row stopped computing. ⚠️ This is the OPPOSITE of `wiring_cabling`, where runs and cores are also
  separate but the core count is itself a match key with no geometry — do not unify the two categories.
- **`circuit_fit`'s third `wire_spec` element is OPTIONAL and ABSENT MEANS 1.** A wire spec is
  `[core_attr, thickness_attr]` or `[core_attr, thickness_attr, runs_attr]`; the dia sum becomes
  `sqrt(sqmm/PI) * 2 * cores * runs`. Absence must never change behaviour — every pre-existing config
  carries 2-tuples, so a non-optional third element would break all of them on ship. The same
  absent-means-1 rule governs a rate stage's optional `mult_from_attr`, which folds its attribute in
  BEFORE that stage's rounding (`x runs then round`). **This DELIBERATELY DIVERGES from `scale`'s
  `<ident>_from_attr`, which hard-fails to an honest no-compute** — a run count is a multiplier whose
  neutral element is 1, not a missing measurement. Both sites share one helper so they cannot drift.
- **CONDUIT is runs-aware through the GEOMETRY ALONE and must never carry a second runs multiplier.**
  `conduit_qty` derives from `circuits`, which derives from the runs-scaled diameter. Adding a
  multiplier to the conduit component would charge runs-squared. Switch, socket, plate and back box
  never multiply by runs at all.
- **`_validate_config` must not be stricter than the interpreter (EA-4 ext-a).** Three shapes the
  interpreter explicitly executes are valid config and must stay accepted: a `component` with **no
  `params`** (a conditional component carries them per-condition), a `component` with **no `target`**
  (a param-only formula reads no price off the matched row; present-but-blank is still an error), and a
  **`*_from_attr` param holding a STRING** (an attribute-id binding — scoped to that suffix ONLY; any
  other param carrying a string still raises). Before this, `cabletray_raceway` and `popup_boxes` could
  not be saved through RM-4b at all.
- **⚠️ THE LOADER DOES NOT VALIDATE, THE EDITOR DOES.** `_validate_config` has exactly ONE caller
  (`update_rate_config`); `load_rate_master` / `_load_multi` validate nothing of the sort. **So an
  un-validatable config imports cleanly and only fails later, at the editor** — a whole-config RM-4b
  save. This asymmetry has now bitten TWICE in one slice (an unregistered top-level key, and step
  shapes). **Closing it is BANKED as its own future slice — do not attempt it inside a feature slice.**
- **The extraction payload is TIERED, LABELLED and NEVER DEDUPED (EA-7, owner-locked; SUPERSEDES the
  banked EA-6 note, whose boundary sat one level higher).** The rate-extraction payload
  (`extraction._ai_item`) keeps its four top-level keys (`id` / `description` / `notes` /
  `ancestor_chain`) but their VALUES are labelled: `notes` is a map keyed by note KIND (`own` /
  `attached` / `appended`, the last a `{column-header: value}` map so the source COLUMN is part of the
  provenance), and each `ancestor_chain` entry is an object carrying `relation` + `distance` + `tier` +
  `node_type` + `description` + its own kind-keyed note block, root-first, with the sheet name as an
  outermost LABEL entry (no distance/tier/notes — it is not a node). **An empty kind is OMITTED, never
  sent as an empty container**, so absence is unambiguous. **THE TIER (owner-locked 2026-08-04): self
  (distance 0), immediate parent (1) and GRANDPARENT (2) carry every note kind; great-grandparent (3)
  and every ancestor above carries description + APPENDED ONLY.** The boundary is the named constant
  `extraction._FULL_TIER_MAX_DISTANCE`, never a magic number. The flat `notes` field rides the FULL tier
  with `attached` (it is node-borne body text, and the lean-tier ruling names only description +
  appended). **PER-ROW, NEVER DEDUPED** — a shared ancestor's text is repeated in full on every row
  beneath it; the repetition was MEASURED and the cost accepted in exchange for each row being
  independently readable inline, so do NOT add dedup, reference-passing or a shared-ancestor block. The
  model is told how to read the labels by `_ROW_CONTEXT_SHAPE_GUIDANCE`, appended in `_extract_batch`
  following the existing SYNONYMS / DEFAULTS / ESTIMATOR_RULES convention — **the `.md` prompt ASSETS
  stay untouched.** EXTRACTION ONLY; the CLASSIFIER is NOT in scope and its input is byte-identical.
- **⚠️ `context_builder._notes_text` is SHARED with the classifier voter — changes there must be
  ADDITIVE (EA-7).** EA-7 needed the three self note-kinds separately and added `own_notes_raw` to the
  row dict AND to each entry of the `ancestors` struct **without touching `_notes_text` or any existing
  key**; `notes` still carries the identical `' | '`-joined string. Byte-identity of the voter's
  assembled payload is PROVEN, not asserted — a hand-written golden test (`TestEA7PayloadShape.
  test_p5_...`) plus a measured before/after hash over the live corpus. Any future change here owes the
  same proof.
- **The extraction payload shape is TEST-PINNED (EA-7).** `TestEA7PayloadShape` in
  `api/boq/test_rate_suggest.py` pins the key set, the labelled ancestor objects, the kind-keyed self
  notes, the tier boundary (both halves — the grandparent MUST carry every kind, the great-grandparent
  MUST NOT), the no-dedup rule, and the omit-empty-kinds rule. Before EA-7 this builder was pinned by
  NOTHING. **Pin first, change second** — the pins were proven green against the unchanged code, then
  updated in the same commit, so the test diff shows what the payload carried before and after.
- **Pipelines are STORED CONFIG, not code:** the four derivation pipelines (cable/termination × BoQ/BCS)
  live in the config JSON and are interpreted downstream — RM-1 stores them faithfully; no interpreter
  ships this slice. Owner-decoded shapes: effective = `(1-discount)*(1+markup)`; termination = lug +
  banded gland (`thickness_sqmm` < 35 vs ≥ 35); BCS = discounted product cost + 5% wastage, no install
  (electrical labour is per-sqft, added at project level). The four faithfulness goldens (e.g.
  COPPER/UNARMOURED/1C/6.0 → cable 120/20, termination 80/20, BCS 87) are the STANDING instrument any
  pipeline change must still reproduce EXACTLY.
- **Migrate obligation grows:** these two doctypes add to the pullers' migrate obligation (Abhishek
  heads-up) — pulling requires a DB migrate.

## BoQ Rate Suggestion (RM-3)

The extraction engine + the REAL `wiring_cabling` pricing helper. Full as-built:
`frontend/.claude/plans/boq-upload-plan.md` ("Build slice RM-3") + `frontend/CLAUDE.md`. Load-bearing
invariants:

- **Two more migrate-carrying doctypes** (fresh sync creates their composite indexes; NO patches.txt
  line, but they GROW the pullers' migrate obligation): `BoQ Rate Suggestion Run` (freeze-and-supersede
  via an `active` Check — a new run deactivates the prior active one, retained not deleted) and
  `BoQ Rate Suggestion Event` (immutable Use telemetry, `track_changes:0`; field is `event_user`, NEVER
  `user` — PG reserved word).
- **Server EXTRACTS, client COMPUTES (owner-locked):** `services/boq_rate_master/extraction.py` runs the
  AI attribute extraction (mirrors `ai_voter` wholesale — `ai_settings`, 20-row batches, 3x retry,
  fail-closed `ai_status` envelope; reuses `ai_voter._extract_json_array`) and persists only the extracted
  ATTRIBUTES; the rate itself is computed CLIENT-SIDE via the RM-2 interpreter UNCHANGED, so a rate/param
  change flows in live with no AI re-run. The regex corroborator is DISPLAY-ONLY and never overrides AI.
- **Endpoints** (`api/boq/rate_master.py`, long-job pattern): `start_suggest` / `_suggest_worker` /
  `get_suggest_status` / `get_active_suggestion_run` / `record_rate_suggestion_event` /
  `get_suggestion_events`, gated by the shared D8 chain (not locked + formulas complete + category gate,
  REUSING the `pricing.py` predicates). Marker + terminal payload live in Redis keyed by (boq, sheet_name).
- **SR-1 run resilience (owner-locked, MIGRATE-carrying; full as-built in `.claude/context/domain/boq-backend.md`):**
  a run is NO LONGER all-or-nothing. **The run doc IS the partial store** (never Redis — its TTL is the wrong
  lifetime): created up front at `status=running`/`active=0` and updated per completed batch via a
  `checkpoint_cb` that mirrors the existing `progress_cb` injection (the service layer still performs NO
  `frappe.db` writes). Three fields: `status` (`running|partial|complete|failed`, **`default: "complete"`** so
  pre-SR-1 rows backfill on migrate and never retroactively lock Use), `attempted_rows` (the per-row
  done-marker), `halt_reason`. **`ai_status` is NOT widened** — it keeps its own `ran|disabled|no_key`
  vocabulary, which the doctype and frontend treat as a contract. **`attempted_rows` is load-bearing:** a blank
  row is byte-identical whether never-asked, asked-and-null, or fail-closed, so the marker is explicit and is
  set **only AFTER a batch returns** — a FAILED batch's rows are never marked and stay pending. **R-SUPERSEDE:**
  a partial NEVER supersedes a prior COMPLETE run; `active` flips to 1 ONLY at `complete` (so
  `get_active_suggestion_run` also returns the newest resumable partial under a separate additive `partial_run`
  key). **R-RESUME-SAME-RUN:** a resume completes the SAME doc/`run_id`, never a second; it re-checks the D8
  gate AND the committed-version keying. **R-USE-GATE:** "Use this value" requires `status=complete`. Writes use
  `set_value(update_modified=False)`, never `doc.save` — this doctype is `track_changes:0` (no audit to bypass)
  AND its list-valued JSON hits the documented `doc.save()`/`delete_doc` wall. **`ExtractionHalted` splits
  terminal from transient — and the DEFAULT DIRECTION IS LOAD-BEARING: an UNRECOGNISED error must keep the
  pre-SR-1 retry behaviour** (a positive-terminal test, adopting `boq_ai_assist._TRANSIENT_MARKERS` for the
  transient signals). Classifying unrecognised errors as terminal turned a truncated reply into an instant halt
  — worse than the behaviour replaced; caught by the browser cert, not by the tests. A graceful halt still
  `log_error`s the provider's own words, so handling it never makes the cause unknowable.
- **`_extract_json_array` is STRICTLY MORE PERMISSIVE (SR-1):** it takes the FIRST BALANCED array span
  (string-aware) and ignores trailing data, fixing the production `Extra data: line 1 column 845`. It never
  rejects a previously-accepted shape (prose-wrapped array, element order, HV-2 bare object), and still RAISES
  on genuine garbage and on a TRUNCATED array (which must NOT degrade to its first element). **Shared by three
  production consumers BY DESIGN** — the classifier voter (def site), the certified harness (by import
  identity), rate extraction. ⚠️ The same-named function at `services/boq_ai_assist.py:431` returns a `str` and
  is a DIFFERENT function — do not confuse them.
- **The reply ceiling (SR-2, owner-locked, EXTRACTION ONLY):** `extraction._AI_MAX_TOKENS` is an EXPLICIT
  constant and is deliberately **NOT** the configured `ai_settings.max_tokens` — the call is NON-STREAMING
  with a fixed timeout and the higher configured region is UNTESTED, so extraction still does not read the
  setting. **The classifier voter and the offline harness keep their own lower constant deliberately**: the
  voter's reply is one small object per row (a wide margin that does not bind) and it is a CERTIFIED surface
  whose corpus is spent, so raising it is all risk and no benefit — changing it belongs in its own slice with
  a fresh harness run. A `stop_reason == "max_tokens"` cut raises the distinct **`ReplyCeilingExceeded`**
  BEFORE the reply text is parsed, so it can never degrade into the generic truncated-JSON `ValueError`, and
  it is **NEVER retried** — a ceiling cut is DETERMINISTIC for a given batch, so retrying is guaranteed waste
  (a garbled reply is the opposite case and keeps the SR-1 default-to-retry rule). **The special-case is
  NARROW: every other `stop_reason` keeps its pre-SR-2 behaviour byte-identical.**
  `_extract_with_ceiling_split` halves a cut batch (`_MAX_SPLIT_DEPTH`), triggers ONLY on
  `ReplyCeilingExceeded` — never on a transient error or a garbled reply — and composes with SR-1 unchanged:
  `attempted` advances and checkpoints per HALF, so a halt mid-split keeps the halves already done. Batch size
  is unchanged. **The trigger was ANY high-attribute-count category at the full batch size, NOT
  `composite_decomposition` specifically** — the failing batch was a non-composite assembly category, so a fix
  scoped to composite mode would have missed it.
- **Extraction prompt rulings (owner, `prompts/boq_rate_attr_extraction_prompt.md`):** tolerate spelling
  variants (map to the canonical value), and — for an ARMOURED/UNARMOURED insulation attribute — a FLEXIBLE
  cable is UNARMOURED, and insulation DEFAULTS to UNARMOURED when neither armoured nor unarmoured is stated.
- **Frontend attributes are CATEGORY-SCOPED (owner):** the `Pricing sheet` helper shows the row's CATEGORY
  attributes; a category with no attribute set defined yet shows a "coming soon" note, not the wrong fields.
  A badge-less rate-editable cell exposes an always-on faint opener for manual fill.
- **EA-2 -- extraction + helper are N-CATEGORY (owner-locked).** The runner is no longer wiring-only: the
  population spans EVERY category on the sheet whose active config has BOTH non-empty pipelines AND
  attribute definitions (an empty-pipelines DATA-ONLY config like `lighting_mgmt_system` is excluded
  automatically -- NO special case); batches are SINGLE-CATEGORY (each carries its category's defs +
  prompt), and results carry `category_id` per row. **MODE SWITCH** (config.`matching_mode`): an
  `item_identity` category injects the SECOND prompt asset
  (`prompts/boq_rate_item_identity_prompt.md`) and flags the identity attribute (`identity_attribute_id`)
  `identity:true` with its allowed values := the LIVE item catalog (distinct identity-attr values across
  the category's active master items -- NEVER hardcoded); `_coerce_value` enforces catalog membership, so
  an out-of-catalog value -> null. The identity prompt's REFUSE-COMPOSITES rule (an assembly / multi-item
  row -> null) is owner-locked. The helper (`pricingSheetHelper.ts`) resolves the config PER row category
  (`configsByCategory`, all 11 registry categories fetched via a child `RateConfigFetcher`); a category
  with no eligible config -> "coming soon". Groups render ONE per NON-BCS pipeline (ids containing "bcs"
  are NEVER surfaced -- owner deferral), labelled `config.pipeline_labels?.[id]` (CONFIG DATA, added to
  wiring by an audited RM-4b edit) else a prettified id. **The `wiring_cabling` paired Cable+Termination
  display is a TEMPORARY owner special-case (Decision 2) with a NAMED SUCCESSOR: EA-4 designs the generic
  pairing/assembly mechanism and wiring migrates onto it then -- do NOT extend the named-category branch.**
- **CLASSIFICATION-VOCABULARY GAP (standing):** `popup_boxes` + `lighting_mgmt_system` are rate-master
  categories the Electrical CLASSIFIER does not emit yet, so ZERO production rows resolve to them; the
  helper is ready but they need a classifier vocabulary update first.

---

## Reference Docs

| Domain | File |
|---|---|
| Full context index | `.claude/context/_index.md` |
| Doctypes | `.claude/context/doctypes.md` |
| APIs | `.claude/context/apis.md` |
| **BoQ backend (endpoints, doctypes, commit pipeline, slice changelog)** | **`.claude/context/domain/boq-backend.md`** |
| **BoQ frontend (wizard + pricing editor + review conventions)** | **`frontend/.claude/context/domain/boq-frontend.md`** |
| BoQ live status / full as-built plan | `frontend/.claude/plans/boq-upload-plan.md` |
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
