# CLAUDE.md — Nirmaan Stack

**Last updated:** 2026-06-11 (Slice D1 -- "Parsed Check Done" marking + read-only FREEZE + Un-mark
COMPLETE -- BACKEND + FRONTEND: a sheet at "Parsed Check Done" is FROZEN -- all four BoQ Review Row write
endpoints (`save_review_edit`, `save_review_restructure`, `save_review_remark`, `dismiss_row_flags`) reject
writes, enforced BACKEND + FRONTEND. BACKEND (review_screen.py): a shared `_get_sheet_wizard_status(boq,
sheet)` (one get_value, same parent/parenttype/sheet_name filter mark uses; sheet_name VERBATIM #152) +
`_guard_sheet_not_frozen(boq, sheet)` (throws an IDENTICAL read-only message via the `_FROZEN_WRITE_MESSAGE`
const), called in EACH of the four write endpoints immediately AFTER the BOQs-exists guard and BEFORE any
doc-locate/validation/write (in save_review_edit this short-circuits the expensive human_parent cycle-guard).
`mark_sheet_parsed_check_done` gains a PRECONDITION (after locating the child row, before the integrity
compute): already "Parsed Check Done" -> throw; not "Parsed" -> throw (current status echoed) -- its existing
ok:false+breaks / ok:true+overridden response shapes are UNCHANGED and its 3 prior tests stay green (they seed
"Parsed"). NEW endpoint `unmark_sheet_parsed_check_done(boq, sheet)` -- precondition current=="Parsed Check
Done" else throw, then direct `set_value(... "Parsed")` + commit, returns `{ok, status:"Parsed"}` (no integrity
check going backward; deliberately bypasses set_sheet_status, which rejects "Parsed" -- _DIRECT_SET_STATUSES
excludes it). test_review_screen 137 -> 147 (+10: TestParsedCheckDoneFreeze F1-F5 [each write blocked + an
unblocked control after restore], TestMarkSheetParsedCheckDone M1/M2 [already-checked + non-Parsed rejects],
TestUnmarkSheetParsedCheckDone U1-U3 [accept / reject / mark->freeze->unmark round-trip]), all green in-container.
FRONTEND: `boqTypes.ts` +`MarkParsedCheckDoneResponse`/`UnmarkParsedCheckDoneResponse` (reuse existing
`StructuralBreak`); `SheetReviewPage` derives `sheetStatus` from `boq.sheet_drafts` (one-level child -- already
on the payload, VERBATIM match) + `isChecked`, destructures `boqMutate` from the BOQs `useFrappeGetDoc`, adds a
header "Mark Parsed Check Done" button (only when status=="Parsed") -> light-confirm AlertDialog that escalates
to a breaks warn-and-confirm ("Mark anyway" re-POSTs confirm:true), and a teal read-only BANNER (when isChecked)
with Un-mark (light confirm) + Go-to-hub; passes `readOnly={isChecked}` to ReviewTree. `ReviewTree` gains
`readOnly?: boolean` gating ALL 11 write affordances at their render sites (reclassify pill, change-parent door,
value/text/area edit blocks, Remarks editor [read-only remark text shown if present], "Looks OK") -- the confirm
dialogs + childless AlertDialog + RestructureModal become unreachable (state-driven, reachable ONLY via gated
triggers); every VIEW affordance (expand/collapse, detail panel, search, filters, column selector,
scroll-to-parent) stays live. Errors via house `getFrappeError()`. tsc 0 new wizard-file errors + in-container
build exit 0 (`✓ built in 3m 36s`, PWA 166 entries). DEFERRED (logged): the update_sheet_draft dirty-marker
"Parsed"-only asymmetry stays for the status-rename slice -- NOT fixed here. Manual live-cert LC1-LC8 pending
Nitesh. Full detail in frontend/CLAUDE.md + boq-upload-plan.md.
// prior: C-flag-dismissal [per-row "Looks OK"] COMPLETE -- BACKEND + FRONTEND:
a per-row dismissal of advisory flags on the review screen. PER-ROW (one gesture clears ALL of a row's
currently-computing flags); STAYS "Original" (a dismissal is an ACKNOWLEDGMENT, not an edit -- it never
stamps edited_at, never touches edit_log, never flips isEdited). BACKEND: three additive fields on
`BoQ Review Row` -- `flags_dismissed` (Check, default 0), `flags_dismissed_by` (Data, read-only),
`flags_dismissed_at` (Datetime, read-only); a NEW endpoint `dismiss_row_flags(boq_name, sheet_name,
row_index, dismissed)` that MIRRORS `save_review_remark` (direct `frappe.db.set_value`, NOT doc.save, NOT
the `_apply_and_save_row_edit` chokepoint -- so no edited_at/edit_log/version side-effects; dismissed
truthy -> set 1 + by/at, falsy -> clear all three); a ONE-LINE insertion at the `_apply_and_save_row_edit`
chokepoint clears the dismissal on every data edit (decision 3a -- any edit RE-OPENS the flags; covers BOTH
save_review_edit AND save_review_restructure since both funnel through the helper); the 3 fields added to
`get_review_rows` all_fields so they ride the row payload. A remark does NOT re-open (it bypasses the
chokepoint -- intentional). Re-parse wipes the dismissal for free (delete+recreate -> the Check defaults 0;
NO parse-worker change). `_compute_advisory_flags` is UNTOUCHED -- flags stay computed-fresh; dismissal is
orthogonal. test_review_screen 131 -> 137 (TestDismissRowFlags +6: dismiss-stays-Original, un-dismiss,
edit-reopens, restructure-reopens, remark-does-NOT-reopen, get_review_rows-carries-fields), all green
in-container; `bench migrate` landed the 3 columns (has_column verified). FRONTEND: `boqTypes.ts` ReviewRow
gains `flags_dismissed?`/`_by?`/`_at?`; `ReviewTree` adds a "Looks OK" button in the detail-panel Flags
block (calls `dismiss_row_flags`, refresh via the existing `onRemarkSaved` mutate -- a dismissal is NOT an
edit), a NEW greyed/checked Info-marker state when dismissed (CheckCircle2, "Reviewed -- looks OK"; NOT
amber-active, flags still EXIST), and a "Reviewed -- looks OK" tag in the flag-reveal row -- the `isEdited`
predicate / Edited pill / green tint are UNTOUCHED; `SheetReviewPage` summary strip shows "N <label> -- C
cleared" per category (cleared = flags of that type whose row is dismissed; derived frontend-side from the
row payload, NO new endpoint). tsc 0 new wizard-file errors (baseline 3177 unchanged) + in-container build
exit 0 (`✓ built in 6m 46s`); manual live-cert LC1-LC6 pending Nitesh. Full detail in
frontend/CLAUDE.md + boq-upload-plan.md.
// prior: Restructure Slice 1b-beta2b [feat 20e1f5a7] COMPLETE -- FRONTEND ONLY:
two deliverables. D1 (finding-10/LC10 UI half): the broken inline error-extraction ladder is replaced by
the house helper `getFrappeError()` in FIVE catch blocks (RestructureModal.handleSave + ReviewTree
confirmChildlessReclassify / confirmValueSave / saveTextField / saveRemark), so backend `frappe.throw`
text -- e.g. the cycle explanation, which travels in `_server_messages` (the SDK's plain-object `.message`
is a hardcoded generic) -- reaches the user instead of "There was an error."; each site keeps its static
string as a `|| "..."` last-resort fallback; `frappeErrors.ts` + its 4 existing call sites UNTOUCHED.
D2 (finding-9): the row-position choice is now ALSO offered on the CHILDLESS reclassify path -- ReviewTree's
childless AlertDialog gains two radios: (1) Keep current position [DEFAULT; Confirm reclassifies only,
byte-for-byte as before: child_moves:{}, no row_new_parent] and (2) Move under a new parent [routes ON
SELECT into the RestructureModal -- the AlertDialog is too small to host the picker]. RestructureModal
adapts for zero children (ALL gated on `children.length === 0`): hides the Children box + five-options
block, drops the option-required gate in `canSave` (row-position rule alone), adapts title/description
(no "children" language), and `rowPosition` lazy-inits to "move" (a childless row reaches the modal only
via the move route). WITH-children behaviour UNCHANGED (S6); `buildChildMoves` already returns {} with
zero children. Backend UNTOUCHED -- the childless wire shape (row_new_parent + child_moves:{}) is already
certified by backend tests T2/T4. tsc 0 errors in both touched files (baseline 3177 unchanged) + build
exit 0; no Frappe unit tests (UI slice); manual live-cert LC-i..LC-vii pending. LC10's backend half was
CLOSED by T1/T2; its UI-surfacing half closes at LC-i (the cycle message now surfaces inline). Full detail
in frontend/CLAUDE.md + boq-upload-plan.md.
// prior: Restructure Slice 1b-beta2 [feat 1ed9d3b7] COMPLETE -- BACKEND + FRONTEND:
the restructure flow now also places the RECLASSIFIED ROW ITSELF, not just its children.
BACKEND: `save_review_restructure` gains an OPTIONAL `row_new_parent` param (None/omitted = the
row's parent is left untouched, byte-for-byte today's behaviour for every existing caller; -1 = move
the row to top-level/root; int = move it under that row). The batch cycle-guard is EXTENDED two ways:
(a) the row's own move is written into the SAME `sim` map as the child moves, and (b) `row_index` is
added to the `_chain_has_cycle` check START-POINTS whenever `row_new_parent` is given. (b) is
load-bearing -- a pure row move with EMPTY child_moves would otherwise run ZERO cycle checks (the
check-loop iterates child moves only) and silently corrupt the tree (e.g. a row moved under its own
child). `_chain_has_cycle` (the walk is general) and `_apply_and_save_row_edit` (the #54-Option-B
human_is_root XOR human_parent invariant chokepoint) are UNCHANGED -- the row's own move is ONE extra
helper call on the SAME `target_doc` (after the classification call, before the single commit; two
sequential helper calls on one in-memory doc are safe). Response gains `row_moved: bool`. The corruption
guards are PROVEN genuine: T1 (keystone -- row under its own child, empty moves), T2 (zero-checks trap,
explicit child_moves={}), T7 (shared-sim NON-EMPTY trap -- cycle via the row while an innocent acyclic
child move is also present; literal "individually-acyclic joint-only" is mathematically IMPOSSIBLE here
since every child currently has effective parent == row_index, documented in the test) ALL fail-if-broken
(verified by temporarily reverting the start-point extension -> exactly T1/T2/T7 go red, 128 others stay
green). +4 happy/compat tests (row->new-parent, row->root read-back, omitted-param backwards-compat,
self-parent reject). test_review_screen 124 -> 131, all green in-container. FRONTEND: RestructureModal
gains a "This row's position" control (Keep current [DEFAULT, omits the param] / Move under a new parent),
reusing the SAME SheetSearchView picker + hitRowIndex resolution + no-match guard the child pickers use
(plus a Top-level -1 option); Save gated until a chosen move is resolved; childless light path (ReviewTree)
untouched. tsc 0 errors in RestructureModal (baseline 3177 unchanged) + build exit 0; manual live-cert
STAGE A/B/C + LC-1..LC-5 pending. LC10 backend half CLOSED by T1/T2; UI-surfacing half closes at LC-5.
Full detail in frontend/CLAUDE.md + boq-upload-plan.md.
// prior: SheetSearchView v2 [feat fc7147db] COMPLETE -- FRONTEND ONLY: re-certifies
the 1a-certified `SheetSearchView` with three bundled changes -- (1) FETCH SWAP: the windowed
get_sheet_preview 200-row loop is replaced by a single `get_sheet_preview_full` call [the new endpoint
below is now WIRED -- the perf OWED item lands here, live-proven in the v2 cert]; (2) COLUMN RESTYLE:
table-fixed, Description w-[360px]/others w-[120px], cells wrap; (3) CLICK-TO-SELECT: new optional
onRowClick + selectedRowNumber props, persistent inset blue selected ring, RestructureModal reuses its
existing row_number->row_index resolution + no-match guard [click-sets-hit, no duplication]. New additive
`SheetPreviewFullResponse` type; `SheetPreviewResponse` + `get_sheet_preview` untouched. tsc 0 errors in
the 3 touched files [baseline 3177 unchanged] + build exit 0; no Frappe unit tests [UI slice]; manual v2
live-cert pending. Frontend detail in frontend/CLAUDE.md + boq-upload-plan.md.
// prior: get_sheet_preview_full [feat 196ed765] COMPLETE -- BACKEND ONLY:
new additive whitelisted endpoint `get_sheet_preview_full(boq_name, sheet_name)` that fetches +
opens the workbook ONCE and reads EVERY row in a single pass (no 200-row cap), reusing the existing
helpers + the IDENTICAL per-row skip logic so its `rows` is BYTE-IDENTICAL to concatenating every
windowed get_sheet_preview call over the same sheet. Replaces the need for SheetSearchView's slow
windowed loop (one S3 fetch + workbook open PER 200-row window, ~30s on a 1001-row sheet). The existing
`get_sheet_preview` is UNCHANGED -- still serves SheetSpokePage's on-demand 40-row pagination (S2;
diff is purely additive, +237 lines, 0 deletions). Return shape `{sheet_name, rows, returned_count,
has_more:False}` -- has_more kept (always False) for v2 type-compat; start_row/end_row_requested omitted
(no window). NO frontend consumer yet -- the SheetSearchView switch is deferred to the "SheetSearchView
v2" slice (bundled with column-widths/wrap + click-to-select per the slice-composition framework, so the
certified component is re-certified ONCE). The tests ARE the cert: new TestGetSheetPreviewFull (9) incl
the byte-identity keystone (windowed-concat == full-read, exact); 23 existing sheet_preview tests pass
unchanged; 32 total, in-container bench run-tests OK. Live perf proof lands in v2. No frontend touched ->
frontend/CLAUDE.md not substantively affected this slice. Full detail in boq-upload-plan.md.
// prior: Restructure Slice 1b-beta [feat e8eeab58] COMPLETE -- FRONTEND: the
restructure MODAL. Detail-panel classification pill -> DropdownMenu of the 4 assignable targets;
childless rows take a light AlertDialog confirm (empty child_moves), rows WITH children open the staged
`RestructureModal` (NEW) -- lists the row + children + FIVE child-placement options [move-up /
keep-under-this-row (gated to parent-capable line_item/preamble) / one-new-parent / per-child /
all-top-level], no option pre-selected, Save gated until the choice is complete, assembles a
fully-resolved child_moves map [Path A; -1 = top-level] and fires ONE `save_review_restructure` call.
Mounts the CERTIFIED `SheetSearchView` (byte-for-byte untouched) as the parent picker via its existing
onCurrentHitChange; resolves the picked Excel row_number -> review-row row_index via source_row_number, with
a no-match guard disabling Set-as-parent on header/banner rows. `onRestructured` prop wired to the existing
`handleSaved` (a restructure IS a real edit -- same setLastSavedAt + mutate SWR refresh). The temporary
Slice 1a dev route + `_DevSheetSearchHarness.tsx` are REMOVED (gated last, after tsc+build green).
Verification: in-container tsc 0 errors in touched wizard files (project-wide pre-existing baseline 3177
unchanged), in-container build exit 0; no Frappe unit tests (UI slice); manual live-cert LC1-12 pending.
Restructure-surface arc now COMPLETE pending live-cert. OWED next: single-pass full-sheet-read endpoint
(replace SheetSearchView's windowed 200-row loop). Full detail in frontend/CLAUDE.md + boq-upload-plan.md.
// prior: Restructure Slice 1b-alpha [feat f7761415] COMPLETE -- BACKEND-led: shared
write helper `_apply_and_save_row_edit` (save-inside / commit-outside) extracted from save_review_edit
[behaviour-preserving, 110 prior tests pass unchanged]; new transactional `save_review_restructure`
(atomic reclassify-one-row + reparent-children in ONE commit; Path A resolved `child_moves` map; whole-sheet
BATCH cycle-guard -- all moves simulated together; FROM-but-not-TO classification narrowing: assignable =
line_item/preamble/note/spacer, subtotal_marker/header_repeat rejected as TARGETS, also tightened on
save_review_edit); HUMAN-ROOT via NEW `human_is_root` Check field on BoQ Review Row (Option B -- ORTHOGONAL
to the -1 sentinel, which is UNCHANGED; consistency invariant root-XOR-row-override enforced at the single
helper chokepoint via a `set_root` kwarg; `child_moves` value -1 = top-level). test_review_screen 124 green.
Frontend touch ONLY: ReviewTree `parentOverridden` accounts for human_is_root + `human_is_root` on the
ReviewRow type -- the restructure MODAL is Slice 1b-beta. Full detail in boq-upload-plan.md.
// prior: Restructure surface Slice 1a [feat 5ecf1820] LIVE-CERTIFIED 2026-06-09 --
5/5 checks PASS on BOQ-26-00145: columns trimmed (#, Sl.No, Description, Unit, both Qty cols shown;
Rate+Amount hidden), exact-match description search + correct hit counter, cycling prev/next stepper,
scroll-to-hit + highlight, full-sheet load; verified on a clean-name sheet (Fire Fitting, 1001 rows)
AND a trailing-space sheet (Electrical , #152).
FRONTEND-ONLY `SheetSearchView.tsx` [self-contained get_sheet_preview full-sheet load by looping
200-row windows + role->letter join from draft.sheet_config.column_role_map; trim to
#/Sl.No/Description/Unit/every-Qty, hide Rate+Amount; FINDS+SHOWS only -- no selection/save/modal,
all Slice 1b] + a TEMPORARY `_DevSheetSearchHarness.tsx` and throwaway route
`upload-boq/_dev-sheetview/:boqId/:sheetName` [both REMOVED in Slice 1b]; NO backend/doctype/schema change.
Deferred from 1a live-cert: (a) fuzzy/typo-tolerant description search DEFERRED (exact matching kept for
V1; logged decision, not owed work); (b) full-sheet-load perf ~30s on the 1001-row Fire Fitting sheet
[windowed get_sheet_preview re-opens the workbook per window] OWED as a Slice 1b backend follow-up: a
single-pass full-sheet-read endpoint.
Full detail in frontend/CLAUDE.md + boq-upload-plan.md.
// prior: Slice C-values arc C-v1..C-v2d-fix (feats 2bf77d62 / aa74a023 / ae65555c / da6bb6d1 /
ae9dcff2 / cd2cc156 / 7fee7481) COMPLETE -- inline value/text/per-area editing + per-row Remarks on the
review screen; C-values rate-editing live-cert still OWED against a Pattern-2-rate vehicle + RE-LIVE-CERT
of the per-area qty edit after bench restart (see boq-upload-plan.md).
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
| BoQ Upload & Management | `feature/boq-phase-3` | `frontend/.claude/plans/boq-upload-plan.md` | Phases 1.x (parser, 588 tests) + Phase 3 Modules 1a/1b/2a/2b/3 COMPLETE. Review-screen arc COMPLETE: Slice A backend (feat fff26abd; -1 sentinel, resolve_effective / check_structural_integrity / append_edit_log_entry + 3 endpoints) -> B1/B1.1/B2a/B2b/B2c frontend (review tree + column descriptors + advisory flags + detail panel + Status column) -> C-values arc C-v1..C-v2d-fix (inline value/text/per-area editing + per-row Remarks). Restructure surface Slice 1a (searchable sheet-view `SheetSearchView.tsx`, FRONTEND-ONLY, feat 5ecf1820) LIVE-CERTIFIED 2026-06-09 (5/5 PASS on BOQ-26-00145). Slice 1b-alpha BACKEND (feat f7761415) -- shared write helper `_apply_and_save_row_edit` (save-inside/commit-outside) + transactional `save_review_restructure` (atomic reclassify+reparent, batch cycle-guard, FROM-but-not-TO assignable classes) + human-root via NEW `human_is_root` Check field (Option B, orthogonal to the -1 sentinel). CURRENT: Slice 1b-beta FRONTEND COMPLETE (feat e8eeab58) -- the restructure MODAL: detail-panel pill DropdownMenu -> childless light confirm OR staged `RestructureModal` (5 child-placement options, Path A fully-resolved child_moves, mounts certified SheetSearchView untouched as parent picker, row_number->row_index resolution + no-match guard), `onRestructured` reuses handleSaved; dev route + `_DevSheetSearchHarness.tsx` REMOVED. tsc 0 wizard-file errors + build exit 0; manual live-cert LC1-12 pending. Restructure-surface arc COMPLETE pending live-cert. Slice D1 -- "Parsed Check Done" marking + read-only FREEZE + Un-mark (BACKEND + FRONTEND): four-endpoint write freeze on a checked sheet via `_guard_sheet_not_frozen`, mark precondition (Parsed-only), new `unmark_sheet_parsed_check_done`, `readOnly` ReviewTree gating + Mark button + teal banner; test_review_screen 137 -> 147. Slice D2 (latest) -- per-sheet review CSV export (FRONTEND ONLY, feat 27866a2e): NEW wizard-local writer `exportReviewCsv.ts` (flat columns, per-area = one column per area per role, numbers raw, UTF-8 BOM) + "Export CSV" header button (status- and view-independent); reuses ReviewTree `resolveDescriptorValue`/`computeDepths`/`CLS_LABELS`/`FIXED_ROLE_DEDUPE` via export-keyword-only; the shared `src/utils/exportToCsv.ts` deliberately untouched. OWED: single-pass full-sheet-read endpoint; C-values rate-editing live-cert against a Pattern-2-rate vehicle. Full slice-by-slice history + as-built detail: see boq-upload-plan.md. Do not duplicate the changelog here. |

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

**`sheet_preview.py`** (feat bf1a2e64, Slice 3b-i; + get_sheet_preview_full feat 196ed765) -- 2 functions:

- `get_sheet_preview(boq_name, sheet_name, start_row=1, end_row=40)` -- values-only windowed preview of raw cell data for one sheet. `@frappe.whitelist()` bare (read; callable via GET / useFrappeGetCall). Coerces start_row/end_row to int; guards start_row>=1, end_row>=start_row; clamps window silently to 200 rows max. Fetches the BoQ file from S3 via `_fetch_boq_file_to_tempfile` (URL-param key extraction + `S3Operations.read_file_from_s3`), opens with `openpyxl.load_workbook(path, data_only=True, read_only=True)` (~0.56s on a 7.65 MB file -- does NOT use BoqReader which takes ~27s due to double-open + merged-cell pre-scan), and reads the requested row window. VERBATIM sheet_name matching. Returns `{sheet_name, start_row, end_row_requested, rows: [{row_number, cells: {col_letter: value}}], returned_count, has_more}`. `has_more` derived from `ws.max_row` (dimension metadata). Tempfile always unlinked in a `finally` block. URL: `/api/method/nirmaan_stack.api.boq.wizard.sheet_preview.get_sheet_preview`

- `get_sheet_preview_full(boq_name, sheet_name)` -- (feat 196ed765) ADDITIVE single-pass full-sheet read: fetches + opens the workbook ONCE and iterates row 1 .. `ws.max_row` (None-safe -- read_only sheets with no `<dimension>` tag still iterate to the end) with NO 200-row cap. `@frappe.whitelist()` bare. REUSES the existing helpers verbatim (`_fetch_boq_file_to_tempfile`, `_to_json_serializable`, `get_column_letter`) and the IDENTICAL per-row skip logic (skip all-EmptyCell padding rows via `next((c.row...), None)`; skip EmptyCells within a kept row via `hasattr(cell,"column")`), so `rows` is BYTE-IDENTICAL to concatenating every windowed `get_sheet_preview` call over the same sheet (locked by `test_byte_identity_to_windowed_path`). VERBATIM sheet_name (#152). Same guards as `get_sheet_preview` (missing args / BOQs-not-found / empty source_file_url / sheet-not-in-workbook). Tempfile + workbook closed in a `finally`. Returns `{sheet_name, rows: [{row_number, cells: {col_letter: value}}], returned_count, has_more: False}` -- `has_more` always False (a full read has nothing beyond), kept only so the response stays type-compatible with `get_sheet_preview` for the v2 frontend; `start_row`/`end_row_requested` omitted (no window). PURPOSE: replace SheetSearchView's slow windowed loop (one S3 fetch + workbook open PER 200-row window, ~30s on a 1001-row sheet). `get_sheet_preview` is UNCHANGED -- still serves SheetSpokePage's on-demand 40-row pagination. NO frontend consumer yet -- the SheetSearchView switch is deferred to the "SheetSearchView v2" slice (bundled with column-widths/wrap + click-to-select, so the certified component is re-certified ONCE); live perf proof lands there. URL: `/api/method/nirmaan_stack.api.boq.wizard.sheet_preview.get_sheet_preview_full`

**`parse_run.py`** (Phase-1 Slice 1 + Slice 2) -- pure helpers + background worker + endpoint:

- `assemble_mapping_config(boq_name, force_reparse=False)` -- reads BOQs doc + BoQ Sheet Draft child rows, builds a `MappingConfig` Pydantic model for the parser orchestrator. Returns `(MappingConfig, not_eligible: list[str])`. Routing (in order, Slice 2c updated): (1) `general_specs_sheets` set membership -> `treat_as="master_preamble"` -- checked FIRST, outranks wizard_status (a Skip sheet in the child table must win); (2) Hidden/Skip -> `SheetConfig(skip=True)`; (3) Reviewed/Parsed with valid blob -> data sheet; (4) Pending/Parse-failed/blank/Reviewed-without-blob/Parsed-Check-Done -> `not_eligible`. Raises `frappe.ValidationError` if BOQ not found or no eligible sheets remain. `GlobalSettings` always defaults (no per-BoQ override). **IMPORTANT:** Injects `raw["sheet_name"] = sheet_name` before `SheetConfig.model_validate(raw)` in Rule 3 -- production wizard blobs omit `sheet_name`; without this injection all Reviewed sheets fall into `not_eligible`. **FORCE RE-PARSE (`force_reparse`, Force Re-parse backend slice):** when `force_reparse=True`, Rule 3 ALSO admits `"Parsed Check Done"` sheets (`if status in {"Reviewed","Parsed"} or (force_reparse and status == "Parsed Check Done")`) -- on the SAME terms as Rule 3 (valid sheet_config blob still required; empty/invalid-blob sub-gates still apply). **CONVENTION future work MUST respect: `"Parsed Check Done"` is parse-eligible ONLY under this flag** -- with `force_reparse=False` (the default, and the normal parse path) it stays in `not_eligible` byte-for-byte as before, so force-reparse can never leak into normal parsing. Scope is `"Parsed Check Done"` ONLY; `"Parse failed"` is NOT widened. A successful re-parse drops the sheet back to `"Parsed"` (Option A, worker status-set line unchanged) and DELETES the prior BoQ Review Rows (discarding human edits/remarks by design).

- `flatten_resolved_row(resolved_row, sheet_name, row_index)` -- maps a parser `ResolvedRow` + nested `ClassifiedRow` to a flat dict of BoQ Review Row field values. JSON fields returned as Python objects (list/dict), NOT pre-serialized strings. CAVEAT: Frappe rejects Python lists for JSON fieldtype (`get_valid_dict` "cannot be a list"). Callers must `json.dumps()` the four list-JSON fields before `doc.insert()` -- see `_LIST_JSON_FIELDS` module constant. Dict-type JSON fields (`qty_by_area`, `amount_by_area`, `rate_by_area`, `append_notes_raw`) can be passed as Python dicts. **SENTINEL WRITES (agreement #54, both halves now applied):** writes `parent_index=-1` for root rows (None parent → -1) AND `human_parent=-1` for ALL rows (no human override at parse time). Both are required: Frappe coerces unset Int fields to 0, and 0 is a valid row index. `resolve_effective` treats `human_parent >= 0` as a real override -- without the explicit `-1`, every parsed row falsely reports effective_parent_index=0 (flat tree). Fix landed in Slice B1.1b-fix-A.

- `flatten_parsed_boq(parsed_boq, boq_name)` -- iterates `ParsedBoq.sheets`, calls `flatten_resolved_row` per row, injects `boq=boq_name`. `master_preamble` (treat_as="master_preamble") sheets produce no rows. Returns `list[dict]`.

- `run_parse(boq_name, sheet_names=None, force_reparse=False)` -- `@frappe.whitelist(methods=["POST"])`. Enqueues `_run_parse_worker` on `queue="long"`, `timeout=600`. `sheet_names=None` parses all eligible Reviewed/Parsed sheets; `sheet_names=[...]` parses only the named subset (per-sheet re-parse). `force_reparse` (HTTP string `"true"/"1"/"yes"` coerced to bool; default False) is threaded to `_run_parse_worker` -> `assemble_mapping_config` and makes `"Parsed Check Done"` sheets eligible (Force Re-parse backend slice -- see `assemble_mapping_config` above); the frontend sets it only for a deliberate, warned re-parse (a later frontend slice wires the button). After successful enqueue sets `BOQs.parse_in_progress=1` + commits (Bucket-2 Slice 1, feat cb86b92b). Returns `{"status":"queued","job_id":...}`. URL: `/api/method/nirmaan_stack.api.boq.wizard.parse_run.run_parse`

- `_run_parse_worker(boq_name, sheet_names=None, user=None)` -- background worker. Fetches workbook from S3 or local (derives real `.xlsm`/`.xlsx` extension from URL). Calls `assemble_mapping_config` -> `parse_boq` -> per-sheet delete-then-insert loop (applying `_LIST_JSON_FIELDS` pre-serialization). Per-sheet failure: compensating delete + set `Parse failed` + continue. Global `parse_boq` failure: all eligible sheets -> `Parse failed` + error event. Stamps `BOQs.parsed_at` on any success. **TWO READ-SITES for general-specs (Slice 2c):** Read-site 1 in `assemble_mapping_config` (routing); Read-site 2 in `_run_parse_worker` Step 5 (gates "mark Parsed" -- general-specs sheets never receive "Parsed" status). Step 6 write-loop: for each (sheet_name, preamble_text) in `parsed.master_preambles`, delete-then-insert child row (replace semantics, falsy-skip per row). Commits BEFORE publishing `boq:parse_run_done` (targeted to `user=`). Does NOT touch `BOQs.wizard_state`.

**`_LIST_JSON_FIELDS` module constant** -- `frozenset` of the 4 list-type JSON fields that must be pre-serialized via `json.dumps()` before `doc.insert()`: `attached_notes`, `validation_warnings`, `classifier_warnings`, `preamble_candidate_signals`. Authoritative source for `_run_parse_worker` and `test_parse_run._insert_rows`. `edit_log` (Slice A) is the 5th list-JSON field on BoQ Review Row but is NOT in `_LIST_JSON_FIELDS` (that constant is parse-worker scope only); `edit_log` is handled by `save_review_edit` directly. Do NOT add dict-type fields here.

**`boq:parse_run_done` realtime event** -- `user=`-targeted (unlike `boq:wizard_parse_done` which broadcasts). Success payload: `{status,boq_name,parsed_sheets,not_parsed_sheets,failed_sheets}`. Error payload: `{status,boq_name,error_code}`. Error codes: `missing_file`, `fetch_failed`, `no_eligible_sheets`, `parse_failed`, `internal`. **Payload contract is frozen** -- `_publish_parse_event` clears `parse_in_progress=0` before publishing (Bucket-2 Slice 1) but does NOT change any payload key or error code.

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
- JSON list fields (must pre-serialize via `json.dumps()` before insert): `attached_notes`, `validation_warnings`, `classifier_warnings`, `preamble_candidate_signals`, `edit_log` (Slice A addition).
- Notes section: `row_notes` (Text).
- Object-per-flag distinction: `needs_classification_review` + `review_reason` are ResolvedRow-level flags (set by hierarchy post-pass); `classifier_warnings` + `preamble_candidate_*` are ClassifiedRow-level signals (set during classification). Do NOT conflate them.
- Review edits (human layer, Slice A): `human_classification` (Data), `human_parent` (Int), `edit_log` (JSON list), `edited_by` (Data), `edited_at` (Datetime). `has_human_parent` DOES NOT EXIST (was retired in feat fff26abd -- see -1 sentinel below). `remarks` (Small Text, Slice C-v2c) also lives in this section but is NOT an edit field -- it is human-only annotation written ONLY by `save_review_remark`, never stamps edited_at/edit_log, and a remark-only row stays "Original". `flags_dismissed` (Check, default 0), `flags_dismissed_by` (Data, read-only), `flags_dismissed_at` (Datetime, read-only) (C-flag-dismissal) also live here but are NOT edit fields -- the per-row "Looks OK" acknowledgment, written ONLY by `dismiss_row_flags` (mirrors the remark bypass), cleared on any edit at the `_apply_and_save_row_edit` chokepoint, and a dismissed-only row stays "Original".
- **-1 sentinel convention (parent_index + human_parent):** Frappe coerces Int None->0 on insert and 0 is a valid row index, so None is unusable as a "no parent/no override" sentinel at the DB boundary. FIX: -1 is the sentinel. `flatten_resolved_row` writes -1 for root rows (None->-1). `save_review_edit` writes -1 when human_parent is cleared. `resolve_effective` translates both -1 AND None to Python None before computing effective values (`in (None, -1)` check), so all downstream tree/cycle/orphan logic (which uses None for root) is unchanged. `human_parent >= 0` (including 0) is a real human override. The Check field `has_human_parent` was redundant once -1 is the sentinel and has been removed from the schema.
- **wizard_status 9 values on BoQ Sheet Draft:** blank / Pending / Hidden / Reviewed / Skip / General specs (derived, never stored) / Parse failed / Parsed / Parsed Check Done. `mark_sheet_parsed_check_done` writes "Parsed Check Done" directly (bypasses `set_sheet_status` which rejects it).

**`review_screen.py`** (Slice A, feat fff26abd) -- helpers + 3 endpoints in `nirmaan_stack/api/boq/wizard/review_screen.py`:

- `resolve_effective(row)` -- accepts Frappe Document / frappe._dict / plain dict. Computes effective_classification (human > parser) and effective_parent_index (-1/None sentinel translation; human_parent >= 0 is a real override). Returns dict with raw stored values + effective values. has_human_parent NOT included (retired). Authoritative source for the -1 sentinel.
- `check_structural_integrity(rows)` -- operates on EFFECTIVE values from resolve_effective. Three checks: ORPHAN (line_item with effective_parent=None), LINE_ITEM_AS_PARENT, CYCLE. Returns list of break dicts (empty = clean). Does NOT modify input rows.
- `append_edit_log_entry(existing_log, field, from_val, to_val, user, reason=None, area=None, rate_subkey=None)` -- appends `{field,from,to,by,at,reason[,area][,rate_subkey]}` to the log list. `reason` (Slice C-v1, trailing optional) is always present for a uniform shape; value None when not supplied. `area`/`rate_subkey` (Slice C-v2d, trailing optional) are added to the entry ONLY when not None -- flat-field entries omit them entirely, so old entries stay valid (no composite field string). Handles list/JSON-string/None input. Returns new list (does not mutate input). Caller must json.dumps() before save.
- `get_review_rows(boq_name, sheet_name)` -- `@frappe.whitelist()` bare (GET-capable). Returns `{rows: [...with effective values...], work_packages: [...], column_descriptors: [...]}`. JSON list/dict fields returned as parsed Python objects. `column_descriptors` (Slice B1.1a, feat 58d2ed44): one entry per mapped display column compiled from `sheet_config.column_role_map`; each entry: `{col, role, area, value_field, value_key, rate_subkey}`. Non-display roles (append_to_notes, ignore, reference_images) excluded. Absent/empty sheet_config -> `[]`. Sorted by Excel column order (len, lexical). URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.get_review_rows`
- `save_review_edit(boq_name, sheet_name, row_index, field, value, reason=None, area=None, rate_subkey=None)` -- `@frappe.whitelist(methods=["POST"])`. FLAT-field path (area is None): editable fields human_classification, human_parent, qty_total, rate_supply, rate_install, rate_combined, amount_total, amount_supply, amount_install (numeric, float-coerced), and unit, make_model (text, stored verbatim -- Slice C-v2b); three apply-branches: _HUMAN_FIELDS (setattr / -1 clear), _TEXT_FIELDS (setattr string, NO float coercion; blank clears to None), else numeric float() path; description and row_notes are NOT editable. Cycle-guard + self-parent guard for human_parent. **PER-AREA path (Slice C-v2d -- when `area` is supplied):** `field` is one of qty_by_area / amount_by_area / rate_by_area (the `_AREA_JSON_FIELDS` set, gated SEPARATELY from `_ALLOWED_EDIT_FIELDS`); `area` names the cell; rate_by_area additionally requires `rate_subkey` in supply_rate/install_rate/combined_rate (`_LEGAL_RATE_SUBKEYS = frozenset(_RATE_ROLE_TO_KIND.values())`, reused from the parser, not copied). **GUARD (Slice C-v2d-fix):** the sent `area` is validated against the SHEET'S defined areas (`sheet_config.area_dimensions` via new helper `_get_sheet_area_dimensions(boq_name, sheet_name)`, sheet_name VERBATIM), NOT this row's existing dict keys -- a defined-but-empty area is a valid value-edit target, so the dict key is CREATED if absent (flat `dict[area]=v` / nested `dict[area][rate_subkey]=v`, from=None for a newly-created key); an UNDEFINED area -> throw "not a defined area for this sheet", a sheet with no area_dimensions -> throw "no defined areas" (fail loudly, no permissive fallback). Read-modify-write: blank value -> 0.0 with the key KEPT (never deleted); whole dict BARE-assigned back (NO json.dumps -- proven round-trip). A per-area edit IS a real data edit: stamps edited_by/edited_at, appends a STRUCTURED edit_log entry carrying area (+ rate_subkey). Validation rejects undefined-area / no-area-dimensions / missing-rate_subkey / illegal-rate_subkey / non-per-area-field-with-area. Both paths: appends to edit_log, pre-serializes _RESAVE_LIST_JSON_FIELDS before doc.save() (Defect-1 fix -- the reason the per-area write EXTENDS this endpoint rather than adding a new path). `reason` (Slice C-v1, blank->None) stored on the entry. Returns `{ok, row_index, field, from, to, edited_at, effective, area, rate_subkey}` (area/rate_subkey None on the flat path; edited_at added Slice C-v1). URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.save_review_edit`
- `save_review_remark(boq_name, sheet_name, row_index, remark)` -- `@frappe.whitelist(methods=["POST"])` (Slice C-v2c). The SEPARATE remark write path: writes ONLY the `remarks` field (Small Text) via `frappe.db.set_value` (NOT `doc.save`), so it NEVER stamps `edited_at`, NEVER appends `edit_log`, and NEVER calls append_edit_log_entry -- a row carrying only a remark stays "Original" (the frontend's edited provenance keys off edited_at / edit_log). A remark is annotation, not a data edit; there is NO remark history (latest wins). Blank/whitespace-only normalizes to None (clears). 250-char hard guard (`_REMARK_MAX_LEN=250` -- was 500, lowered in Slice C-v2c-polish; `frappe.throw` if exceeded) so the cap holds even if the frontend is bypassed. `sheet_name` matched VERBATIM (#152). Returns `{ok, row_index, remarks}`. `remarks` is also added to the `get_review_rows` all_fields list so it rides the per-row payload (read path). URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.save_review_remark`
- `dismiss_row_flags(boq_name, sheet_name, row_index, dismissed)` -- `@frappe.whitelist(methods=["POST"])` (C-flag-dismissal). The per-row "Looks OK" dismissal write path. MIRRORS `save_review_remark`: writes ONLY `flags_dismissed` / `flags_dismissed_by` / `flags_dismissed_at` via `frappe.db.set_value` (NOT `doc.save`, NOT the `_apply_and_save_row_edit` chokepoint), so it NEVER stamps `edited_at`, NEVER appends `edit_log`, NEVER touches `human_*` -- a row that is only dismissed stays "Original" (frontend provenance keys off edited_at / edit_log). `dismissed` truthy (HTTP `"1"/"true"/"yes"` coerced) -> `flags_dismissed=1` + by=`frappe.session.user` + at=`frappe.utils.now()`; falsy -> all three cleared (supports a future un-dismiss + the edit-reopen symmetry, though no UI un-dismiss ships). A dismissal is an ACKNOWLEDGMENT, not a data edit; it does NOT touch `_compute_advisory_flags` (flags stay computed-fresh -- orthogonal). `sheet_name` matched VERBATIM (#152). Returns `{flags_dismissed: 0|1}`. The 3 fields are also added to `get_review_rows` all_fields (read path). **EDIT RE-OPENS (decision 3a):** any data edit clears the dismissal at the `_apply_and_save_row_edit` chokepoint (ONE insertion: `doc.flags_dismissed=0` + by/at=None alongside the provenance stamp), covering BOTH save_review_edit AND save_review_restructure. A REMARK does NOT re-open (save_review_remark bypasses the chokepoint -- intentional). Re-parse wipes it free (delete+recreate -> the Check defaults 0; NO parse-worker change). URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.dismiss_row_flags`
- `mark_sheet_parsed_check_done(boq_name, sheet_name, confirm=False)` -- `@frappe.whitelist(methods=["POST"])`. Step 1: run check_structural_integrity. Step 2a: breaks exist + confirm=False -> return `{ok:False, breaks:[...]}` (warn-and-confirm gate). Step 2b: clean or confirm=True -> set wizard_status="Parsed Check Done" directly (bypasses set_sheet_status). Returns `{ok, status, overridden}`. **PRECONDITION (Slice D1):** after locating the child row + BEFORE the integrity compute, reads `wizard_status`: already "Parsed Check Done" -> throw "already marked"; not "Parsed" -> throw "Only a sheet with status 'Parsed' can be marked ... Current status: {status}." (the endpoint had NO status check before D1 -- it stamped unconditionally). Response shapes unchanged. URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.mark_sheet_parsed_check_done`
- `unmark_sheet_parsed_check_done(boq_name, sheet_name)` -- `@frappe.whitelist(methods=["POST"])` (Slice D1). The inverse of mark: reverts a checked sheet to "Parsed", lifting the read-only freeze. Precondition: current status == "Parsed Check Done" else throw ("Only a sheet marked 'Parsed Check Done' can be un-marked. Current status: {status}."). No integrity check (going backward is always allowed). Writes `set_value(... "Parsed")` + commit directly -- deliberately bypasses `set_sheet_status`, which rejects "Parsed" (`_DIRECT_SET_STATUSES` excludes it). Returns `{ok: True, status: "Parsed"}`. URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.unmark_sheet_parsed_check_done`
- **Read-only freeze (Slice D1) -- `_get_sheet_wizard_status(boq_name, sheet_name)` + `_guard_sheet_not_frozen(boq_name, sheet_name)`:** module-level helpers. `_get_sheet_wizard_status` returns the BoQ Sheet Draft `wizard_status` via one `frappe.db.get_value` (same parent/parenttype/sheet_name filter mark uses; sheet_name VERBATIM #152). `_guard_sheet_not_frozen` throws the single `_FROZEN_WRITE_MESSAGE` ("This sheet is marked 'Parsed Check Done' and is read-only. Un-mark it to make changes.") iff the status is "Parsed Check Done". The guard is called in EACH of the four write endpoints (`save_review_edit`, `save_review_restructure`, `save_review_remark`, `dismiss_row_flags`) immediately AFTER the BOQs-exists guard and BEFORE any doc-locate / validation / write -- so a frozen sheet short-circuits before any work (in `save_review_edit` this precedes the expensive whole-sheet cycle-guard). PURELY ADDITIVE: a sheet NOT at "Parsed Check Done" passes through byte-for-byte unchanged (backwards-compat). The FRONTEND `readOnly` gating is the first line of defence; this guard is the durable backstop.
- `get_structural_breaks(boq_name, sheet_name)` -- `@frappe.whitelist()` bare (GET-capable, Slice B1, feat 0683f7b9). Read-only: fetches minimal row fields + calls `check_structural_integrity`. Returns `{"breaks": [...]}`. Does NOT write, does NOT change `wizard_status`. Dedicated display contract for the review screen (B2 flag overlay). URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.get_structural_breaks`
- `_apply_and_save_row_edit(doc, boq_name, sheet_name, field, value, area=None, rate_subkey=None, reason=None, user=None, set_root=False)` -- (Slice 1b-alpha, feat f7761415) MODULE-LEVEL shared write helper extracted from `save_review_edit`. Applies one field-change to an ALREADY-LOADED BoQ Review Row doc + appends the edit_log entry + stamps provenance + re-serializes the list-JSON siblings + `doc.save()` -- but DOES NOT commit. **Save-inside / commit-outside is the atomicity boundary:** under one request transaction N per-row saves all roll back if a later row throws, and the caller's single trailing `frappe.db.commit()` makes a batch all-or-nothing. Callers own ALL per-call validation (the human_classification assignable check, the human_parent self-parent/target-exists/cycle-guard -- the cycle-guard is whole-sheet/whole-batch and CANNOT be per-row), the doc LOAD, and the commit. `save_review_edit` now calls this (its observable behaviour is unchanged except the assignable narrowing below). **`set_root` kwarg (human-root chokepoint):** for `field="human_parent"`, set_root=True writes the human-root override (`human_is_root=1` AND `human_parent=-1`, case c); else value>=0 -> `human_parent=value` + `human_is_root=0` (case a), value None -> `human_parent=-1` + `human_is_root=0` (case b). This is the SINGLE place the consistency invariant (root XOR row-override -- they can never coexist) is enforced.
- `save_review_restructure(boq_name, sheet_name, row_index, new_classification, child_moves=None, reason=None, row_new_parent=None)` -- (Slice 1b-alpha, feat f7761415; `row_new_parent` added Slice 1b-beta2, feat 1ed9d3b7) `@frappe.whitelist(methods=["POST"])`. ATOMIC reclassify-one-row + reparent-its-children (+ optionally the row ITSELF) in ONE commit (the restructure backend for the 1b-beta/1b-beta2 modal). **Path A:** the caller sends a FULLY-RESOLVED plan; the backend VALIDATES + WRITES, it does NOT compute placement. `child_moves` is a dict (or JSON string of a dict) `{child_row_index: new_parent_index}`; `-1` = move to top-level/root. **`row_new_parent` (1b-beta2, OPTIONAL):** None/omitted = the reclassified ROW's own parent is left untouched (byte-for-byte the pre-1b-beta2 behaviour for every existing caller); `-1` = move the row to top-level/root; an int = move it under that row. Validation (all per-call, BEFORE any write): required args; BOQ exists; row exists; `new_classification` in the ASSIGNABLE set (line_item/preamble/note/spacer -- subtotal_marker/header_repeat rejected as TARGETS, the FROM-but-not-TO rule); each child exists, its CURRENT effective parent IS row_index (cannot move a non-child), proposed parent is -1 or an existing row, not self-parented; `row_new_parent` (when not None) int-coerced, not self-parented (!= row_index), and != -1 must exist (mirrors the child / save_review_edit checks); **BATCH cycle-guard** -- build the whole-sheet effective-parent map, apply ALL moves AT ONCE **including the row's own move into the SAME `sim` map** (1b-beta2), then `_chain_has_cycle` per touched row against the COMBINED tree, where touched = the child-move keys PLUS `row_index` when `row_new_parent` is given (two individually-acyclic moves can form a cycle together; AND a pure row move with empty child_moves would run ZERO checks unless row_index is a check START-POINT -- THE silent-corruption trap this closes). `_chain_has_cycle` is UNCHANGED (the walk is general). Write: reclassify the target via the helper (one human_classification entry, carrying `reason`); **when `row_new_parent` is not None, ONE more helper call on the SAME `target_doc`** setting human_parent (`reason` = "row moved: row {N} reclassified to {cls}"; `-1` -> `set_root=True`, edit_log `to=None`; int -> human_parent=that row; two sequential helper calls on one in-memory doc are safe -- one commit covers both, a mid-block throw rolls back everything); each child via the helper (one human_parent entry, `reason` = "parent moved: row {N} reclassified to {cls}"; `-1` -> `set_root=True`, edit_log `to=None`); single `frappe.db.commit()` at the end. Returns `{ok, row_index, new_classification, children_moved, edited_at, row_moved}` (`row_moved` true iff `row_new_parent` was applied). **NOTE (test T7):** a literal "individually-acyclic joint-only" row+child cycle is mathematically IMPOSSIBLE here -- every child currently has effective parent == row_index, so reverting a child edge restores child->row and the row-move alone is already cyclic; the shared-sim guard is instead proven by a cycle-via-the-row paired with an innocent acyclic child move. URL: `/api/method/nirmaan_stack.api.boq.wizard.review_screen.save_review_restructure`

**Classification target vocab (Slice 1b-alpha):** `_VALID_CLASSIFICATIONS` (all 6 RowClassification literals) remains the FROM/read vocab. `_ASSIGNABLE_CLASSIFICATIONS` (line_item, preamble, note, spacer) is the STRICT SUBSET valid as a write TARGET. `subtotal_marker` and `header_repeat` are parser-only DETECTIONS -- valid existing/FROM states but never assignable. Applied to BOTH `save_review_restructure` and `save_review_edit`'s human_classification path.

**`human_is_root` (Slice 1b-alpha, BoQ Review Row Check field, default 0):** the human-root encoding (Option B). A SEPARATE Check field ORTHOGONAL to `human_parent` -- the -1 sentinel value space (#54: -1/None = no override, >=0 = override-to-row) is UNCHANGED. `resolve_effective` consults `human_is_root` FIRST: truthy -> `effective_parent_index = None` (root), skipping the human_parent_norm/parent_index_norm derivation; else the existing logic runs verbatim. **Consistency invariant** (enforced ONLY at the `_apply_and_save_row_edit` chokepoint): `human_is_root=1` => `human_parent=-1`; a `human_parent>=0` write clears `human_is_root` to 0. Purely additive -- NO data migration (a new Check defaults to 0, correct for every existing row, none of which are human-rooted). `human_is_root` is added to every fetch field-list that feeds `resolve_effective` (get_review_rows, get_structural_breaks, mark_sheet_parsed_check_done, and both cycle-guards) and to the resolve_effective return dict + the frontend ReviewRow type.

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
