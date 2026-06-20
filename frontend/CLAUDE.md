# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React + TypeScript + Vite frontend application for **Nirmaan Stack**, a procurement and project management system built on the Frappe Framework. It handles procurement requests (PRs), purchase orders (POs), service requests (SRs), vendor management, project tracking, and financial workflows.

## Development Environment

### Development Server
```bash
yarn dev
# Runs on http://localhost:8080
# Automatically proxies API requests to Frappe backend (port 8000) and Socket.IO (port 9000)
```

### Building
```bash
yarn build
# Builds to ../nirmaan_stack/public/frontend/
# Copies index.html to ../nirmaan_stack/www/frontend.html
# Copies firebase-messaging-sw.js to ../nirmaan_stack/www/
```

### Testing
```bash
yarn test-local
# Opens Cypress E2E tests in Chrome browser
```

### Preview Production Build
```bash
yarn preview
```

**BoQ env / testing procedures** (bench restart, CSRF login fix, :8080-live-vs-:8000-stale, DB-inspect): see `BoQ_Environment_Testing_Runbook_v1_0.md` in project knowledge (digest; handover §9 is source of truth).

## Architecture

### Tech Stack
- **Frontend Framework**: React 18 with TypeScript
- **Build Tool**: Vite 5
- **Routing**: React Router v6 with nested routes
- **Backend SDK**: `frappe-react-sdk` for Frappe ERPNext integration
- **UI Components**: Combination of shadcn/ui (Radix UI primitives) and Ant Design
- **Styling**: TailwindCSS with custom theme configuration
- **State Management**: Zustand for global state
- **Forms**: React Hook Form with Zod validation
- **Tables**: TanStack Table v8 with virtualization support
- **Real-time**: Socket.IO for live updates
- **Notifications**: Firebase Cloud Messaging (FCM)
- **Error Tracking**: Sentry integration
- **PWA**: vite-plugin-pwa for Progressive Web App features

### Directory Structure

```
src/
├── components/          # Reusable React components
│   ├── ui/             # shadcn/ui components (Button, Dialog, etc.)
│   ├── layout/         # Layout components (MainLayout, loaders, alerts)
│   ├── nav/            # Navigation components (navbar, notifications)
│   ├── data-table/     # TanStack Table wrapper components
│   ├── helpers/        # Helper components (cards, inputs, etc.)
│   └── ...             # Domain-specific components
├── pages/              # Route-based page components
│   ├── ProcurementRequests/
│   ├── ProcurementOrders/
│   ├── ServiceRequests/
│   ├── BulkDownload/       # Multi-document PDF download wizard
│   ├── DeliveryChallansAndMirs/  # DC/MIR management (PO Delivery Documents)
│   ├── ProjectDesignTracker/     # Design tracker with handover phase
│   ├── remaining-items/          # Inventory update page
│   ├── reports/                  # Reports hub (PO, SR, DC/MIR, Inventory, etc.)
│   ├── projects/
│   ├── vendors/
│   ├── customers/
│   ├── auth/
│   └── ...
├── hooks/              # Custom React hooks
├── utils/              # Utility functions
│   ├── auth/           # Authentication (UserProvider, ProtectedRoute)
│   └── ...
├── zustand/            # Zustand stores for global state
├── config/             # Configuration files
│   ├── SocketInitializer.tsx  # Socket.IO setup
│   └── queryKeys.ts    # Query key constants
├── services/           # Business logic services
├── types/              # TypeScript type definitions
├── lib/                # Third-party library configurations
└── constants/          # App-wide constants
```

### Key Architecture Patterns

**Routing:** `src/components/helpers/routesConfig.tsx` — React Router v6 nested routes with `<ProtectedRoute />` and `<MainLayout />`

**State:** Zustand stores in `src/zustand/` (notifications, filters, dialogs, doc counts, drafts). Context providers: `UserProvider`, `FrappeProvider`, `ThemeProvider`, `SidebarProvider`

**Data Fetching:** frappe-react-sdk hooks (`useFrappeGetDocList`, `useFrappeGetDoc`, `useFrappePostCall`, etc.). Custom hooks per page encapsulate fetching + mutations + business logic.

**Forms:** React Hook Form + Zod schema + shadcn/ui Form components

**Tables:** TanStack Table v8 via `useServerDataTable` hook + `DataTable` component in `src/components/data-table/`. See `.claude/context/data-tables.md` for full reference (hook config, export system, backend API, search strategies). Page configs in `config/*.config.ts` files.

**Real-time:** Socket.IO via `src/config/SocketInitializer.tsx` + `src/services/socketListeners.ts`. Firebase push via `src/firebase/firebaseConfig.ts`.

**Path Aliases:** `@/*` maps to `src/*`

### Step-Based Wizard Architecture

For complex multi-step forms (like project creation), use the modular wizard pattern:

```
pages/[feature]/[form-name]/
├── index.tsx              # Main orchestrator (form state, navigation, submission)
├── schema.ts              # Zod schema, types, field mappings per step
├── constants.ts           # Wizard config (steps, options)
├── hooks/
│   └── use[Form]Data.ts   # Data fetching for dropdowns/lookups
└── steps/
    ├── index.ts           # Barrel export
    ├── Step1.tsx          # Each step ~150-250 lines
    ├── Step2.tsx
    └── ReviewStep.tsx     # Final review before submission
```

**Key components** (in `src/components/ui/`): `wizard-steps.tsx`, `draft-indicator.tsx`, `draft-resume-dialog.tsx`, `draft-cancel-dialog.tsx`

**Draft persistence:** Zustand store with `persist` middleware. See `useProjectDraftStore`, `useApproveNewPRDraftStore`, `useServiceRequestDraftStore`.

**Editing Lock Pattern:** Redis-based concurrent edit prevention via `useEditingLock` hook (`src/pages/ProcurementRequests/ApproveNewPR/hooks/useEditingLock.ts`). Auto-acquire/release, heartbeat, Socket.IO events, sendBeacon cleanup. Feature flag: `localStorage.setItem('nirmaan-lock-disabled', 'true')`.

**Multi-select user assignment:** Store as `{label, value}[]` for react-select, create `User Permission` docs after document creation. Don't store assignees in the document — use User Permissions for access control.

### Procurement Flow

1. **New PR** → 2. **Approve PR** → 3. **Select Vendors** → 4. **Vendor Quotes** → 5. **Approve Quotes** → 6. **Release PO** → 7. **Delivery Notes** → 8. **Invoices** → 9. **Payments**

Related: `pages/ProcurementRequests/`, `pages/ProcurementOrders/`

---

## Role-Based Access Control

The system uses 10 role profiles for access control. Role checks use `useUserData()` hook.

**Roles:** Admin, PMO Executive, Project Lead, Project Manager, Procurement Executive, Accountant, Estimates Executive, Design Lead, Design Executive, HR Executive

**Special:** `Administrator` user (user_id) has hardcoded Admin access. PMO Executive mirrors Admin access **except** TDS Approval (view-only, cannot approve/reject) and Payment Approval (no Approve tab, no edit fulfilled). HR Executive has Admin Options sidebar access.

**Key files:** `src/hooks/useUserData.ts`, `src/utils/auth/ProtectedRoute.tsx`, `src/components/layout/NewSidebar.tsx`

**Common pattern:**
```typescript
["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role)
```

**Read-Only Approval Tabs:** TDS "Pending Approval" and Payments "Approve Payments" tabs are visible to all roles with sidebar access, but read-only for non-approvers (no action buttons, no row navigation, info banner shown). Approver roles: TDS=Admin+PL, Payments=Admin only.

**Full documentation:** See `.claude/context/role-access.md`

---

## Coding Standards & React Patterns

**Date format:** All dates must use `dd-MMM-yyyy` (e.g., "15-Jan-2026"). Use `formatDate()` from `src/utils/FormatDate.ts`.

**React-Select vs FuzzySearchSelect:** Use `FuzzySearchSelect` (`src/components/ui/fuzzy-search-select.tsx`) for dropdowns with >50 options or where users search with multi-word queries (e.g., item names). It uses a token-based scoring algorithm (split query → match each token independently → score by position + field weight + full-match bonus). Plain `ReactSelect` is fine for small option sets (<50) like work packages, categories, or makes. Use `usePortal` prop inside Radix dialogs. Current usages: NewPR item select, ApproveNewPR item select, TDS item name select, Design Tracker team summary filters.

**React Effects:** Never use objects/arrays as useEffect deps. Never use TanStack `table` as dep. Put user-action side effects in handlers, not effects.

**Full reference:** See `.claude/context/coding-standards.md` and `.claude/context/react-patterns.md`

---

## BoQ Upload Wizard -- Frontend Conventions (Module 1b onward)

**Docs discipline -- DOCS-UPDATE RULE (all three, every commit):** Every docs or feat+docs commit updates ALL THREE docs -- `frontend/.claude/plans/boq-upload-plan.md`, root `CLAUDE.md`, and `frontend/CLAUDE.md` (this file) -- with NO exceptions. A doc not substantively affected still gets a MINIMAL TOUCH (bump its last-updated/status line + a one-line note of what landed), never a skip. Rationale: "update CLAUDE.md" without naming which one let this file silently fall a full module behind (stale through all of Module 2b). Naming all three by full path removes the routing ambiguity. **This file's path: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**

All wizard-frontend code lives in `src/pages/boq-wizard/`. Do not scatter
wizard components into other page folders.

**Project picker (M1.64):** The picker uses an inline `useFrappeGetDocList`
dropdown -- no shared `ProjectSelector` component. Mirror the query shape
from `NewMilestones.tsx` (fields: `["name", "project_name"]`, filter
`status != Tendering`, limit 1000). Do NOT build a reusable ProjectSelector.

**Global entry (M1.59):** Route is `/upload-boq` with optional `?project=<id>`
query param for pre-selection. Defined as a React Router v6 `lazy()` route
in `routesConfig.tsx`. The module must export `Component` (named) for lazy().

**In-project tab (M1.5):** Tab key is `PROJECT_PAGE_TABS.BOQ = 'boq'`, accessed
via `?page=boq` on `/projects/:projectId`. Tab component is `BoqProjectTab`
(lazy via `React.lazy()`). New tab sets must be typed as
`useMemo<Set<ProjectPageTabValue>>` to avoid TS narrowing failures.

**Sidebar nav (M1.57):** Role-gated to Admin + PMO + Procurement Executive +
Estimates Executive + Project Lead (identical to Item Price Search gating).
Add label to the leaf-item discriminator Set in `NewSidebar.tsx`, to `allKeys`,
and to `groupMappings`.

**Color tokens (M1.66):** Use Tailwind token classes only -- `text-muted-foreground`,
`bg-background`, `border-border`, `text-foreground`, `text-primary`, etc.
Never hardcode hex values. All tokens defined in `src/index.css` :root.

**UI library (M1.62):** shadcn/ui primitives only for wizard UI (Button, Card,
Select, Dialog, etc.). No Ant Design in wizard components.

**Tendering create-modal (M1.56):** The picker's 'Create new Tendering project'
button opens `TenderingProjectForm` inside a shadcn `Dialog`. The form is
rendered in embedded mode via two additive optional props:
- `embedded?: boolean` -- suppresses the standalone page chrome (back button,
  Card wrapper) so the form body sits cleanly inside the Dialog.
- `onCreated?: (newProjectId: string) => void` -- called with the new project's
  docname (`response.message.project_name`) on successful CREATE, replacing the
  default navigate-to-tendering-tab behavior.
- `onCancel` is extended to work in embedded CREATE mode (previously EDIT only).

The standalone route `/projects/new-project/tendering` is byte-for-byte
unchanged when these props are absent. This change is owner-approved (M1.56,
Nitesh briefed Abhishek). Do NOT widen these props further without owner sign-off.

In embedded mode all three react-select menus (State, City, Customer) render
inline (`menuPortalTarget={undefined}`) rather than portalling to `document.body`.
This prevents Radix Dialog's DismissableLayer from intercepting clicks on portalled
elements and swallowing option selections. On the standalone route (embedded
absent) the menus continue to portal to `document.body` as before.

**useBoqWizardStore (M1.60):** Transient Zustand store at `src/zustand/useBoqWizardStore.ts`
(no `persist` middleware -- wizard state is session-only). Mirrors `useProjectDraftStore`
structure. Key state: `selectedProjectId`, `droppedFile` ({name,size}|null),
`uploadStatus` ('idle' -- expanded in 1b-ii-b), `panelValues` (boqName/version/gst/notes),
`confirmedFields` (boqName/version/gst booleans). Key actions: `setDroppedFile`,
`clearFile`, `setPanelValue`, `confirmField`, `reset`. Call `reset()` when projectId
changes to flush stale state; pre-fill `boqName` from the fetched project name
afterwards (unconfirmed).

**Upload screen layout (M1.4, M1.7):** `BoqUploadScreen.tsx` owns the two-pane
layout (Card grid, 1-col mobile / 2-col md+). Renders in-place inside `BoqPickerPage`
when `?project=<id>` is present -- no new route. `BoqDropZone.tsx` is the left pane;
`BoqMasterPanel.tsx` is the right pane. Footer: Back-to-project (navigates to
`/projects/<id>`) + Continue (disabled until 1b-ii-b gates it on file + confirmed fields).

**Drop zone (M1.65):** `BoqDropZone.tsx` -- custom file-input pattern, no react-dropzone.
Hidden `<input type="file" accept=".xlsx,.xlsm">` triggered by click/drag. Client-side
validation only: wrong extension = Error D; >25 MB = Error H. Errors E (corrupted) and
F (zero sheets) require the parser -- deferred to 1b-ii-b. On valid drop: collapses to
file tile (filename + size + Replace link); file stored in `useBoqWizardStore.droppedFile`.

**Blank-until-parsed + confirm-reset (§4.1 clarification, 1b-ii-b):** Required fields
(BoQ Name, Version, GST) start BLANK (empty string, no radio selection) before parse.
`DEFAULT_PANEL` in the store has all-empty values; `GstChoice` includes `""`. After
parse success, `fillFromParse({boqName, version, gst, notes})` populates the fields
AND resets `confirmedFields` to all-false, so the user sees the sparkle + opacity-50
treatment on the REAL detected values. The sparkle/opacity condition checks BOTH
`!confirmed && value !== ""` -- empty fields never show sparkle pre-parse. The
1b-ii-a `useEffect` that pre-filled `boqName` from `project.project_name` is REMOVED.

**Upload trigger flow (1b-ii-b):** On valid drop, `BoqDropZone` immediately POSTs to
`/api/method/nirmaan_stack.api.boq.wizard.upload_file.upload_file` via native `fetch` with
`FormData` (fields: `project_id` from store, `file`). CSRF token from
`(window as any).frappe?.csrf_token`. Returns `{message: {job_id}}` synchronously;
`setUploadStatus("parsing")` + `setJobId(job_id)` on success. Upload HTTP failure
calls `resetUpload()` (not just `setUploadStatus("idle")`) so the drop zone
reappears for retry.

**uploadStatus lifecycle (1b-ii-b):** `idle` | `uploading` (POST in flight) |
`parsing` (job enqueued, waiting for socket) | `done` (parse success, BOQs row
created) | `error-E` (corrupted workbook, error_code="corrupted") | `error-F` (zero
sheets, error_code="zero_sheets") | `error-internal` (unexpected server error).
`BoqDropZone` renders spinner for uploading/parsing, error states for error-*, and
file tile for idle/done. The 30s "taking longer" message is a local `setTimeout`
in `BoqDropZone` that fires only during "parsing" -- not a timeout, parsing continues.

**Socket listener pattern (1b-ii-b):** `boq:wizard_parse_done` is registered
SCREEN-SCOPED in `BoqUploadScreen.tsx` via `useContext(FrappeContext)` -- NOT added
to `socketListeners.ts` or `SocketInitializer.tsx`. Pattern: `socket.on(event, handler)`
in a `useEffect([socket])` cleanup, `socket.off(event, handler)` in the cleanup
return. Handler guards on `useBoqWizardStore.getState().uploadStatus === "parsing"` to
filter events from concurrent uploads by other users (frappe.publish_realtime
broadcasts to ALL connected clients without user targeting). Success path sets
`boqDocName` + `uploadStatus("done")`; error path sets the appropriate error-* status.
`useFrappeGetDoc("BOQs", boqDocName, boqDocName ? undefined : null)` then fetches the
doc (third arg null disables SWR until boqDocName is set per sdk gotcha). A separate
`useEffect([boqDoc, uploadStatus])` calls `fillFromParse` when the doc arrives.

**Socket listener pattern (2b-frontend-i) -- hub `boq:parse_run_done` listener:** `boq:parse_run_done` is registered SCREEN-SCOPED in `BoqHubPage.tsx` via `useContext(FrappeContext)` -- NOT added to `socketListeners.ts` or `SocketInitializer.tsx` (same screen-scoped convention as the 1b-ii-b upload listener). `socket.on(event, handler)` in `useEffect([socket])`, `socket.off` in cleanup. KEY DIFFERENCE from the 1b-ii-b upload listener: guards on `payload.boq_name === boqId` (hub always knows its BoQ; no store-state check needed) rather than a store `uploadStatus` flag. On success: calls `mutate()` + sets `parseResult({parsed, notParsed, failed})` to open the completion modal (Bucket-2 Slice 2); on error: uses `PARSE_ERROR_MSGS` module-level const to set `parseError({message, severity})`. `boq:wizard_parse_done` (upload flow, 1b-ii-b, in `BoqUploadScreen`) and `boq:parse_run_done` (parse-run flow, 2b-frontend-i, in `BoqHubPage`) are DISTINCT events for DISTINCT flows -- do NOT conflate them.

**Parse completion modal pattern (Bucket-2 Slice 2, feat 21e56963):** `BoqHubPage` shows parse results in an acknowledge-only `AlertDialog` (single OK action, no Cancel). Open-state is derived from `parseResult || parseError` -- the modal opens automatically when either is set; OK action (and Escape key via `onOpenChange`) clears both. HUB-SCOPED only; never make this app-global. Per-case message convention:
- SUCCESS: up to 3 independent sub-lines, each shown only if the list is non-empty: (1) `Parsed: {names}` -- `font-medium text-foreground`; (2) `Not parsed (skipped, hidden, or general-specs): {names}` -- `text-muted-foreground` (NEUTRAL); (3) `Failed to parse: {names}` -- `text-destructive`. If all lists empty, show "Parse complete." fallback.
- ERROR: one message per error code. `no_eligible_sheets` is NEUTRAL (`text-muted-foreground`) -- it is advisory, not a failure; all other codes are `text-destructive`. Exact messages in `PARSE_ERROR_MSGS` const in `BoqHubPage.tsx` (module-level, not re-defined per event).
- `parseError` state shape: `{ message: string; severity: "destructive" | "neutral" } | null` -- preserving the error code semantics for styling. Do NOT flatten to a pre-baked string that loses the code.

**On-mount parse_in_progress recovery convention (Bucket-2 Slice 2, feat 21e56963):** `parseInFlight` must be initialized from the server flag on every hub mount so it survives navigation and missed socket events. Pattern: a `useEffect([boq])` (mirrors the specs-checklist `useEffect([boq])` pattern) that calls `setParseInFlight(boq.parse_in_progress === 1)`. The live socket event still clears `parseInFlight` on done -- the on-mount read is the fallback only. Do NOT poll; a single read on doc-load is sufficient. Apply this pattern to any future hub-scoped "job is running" indicator that must survive navigation.

**Parse button in-progress convention (Bucket-2 Slice 2):** When `parseInFlight=true`, the Parse workbook button should be `disabled` AND show a spinner (e.g. `<Loader2 className="mr-2 h-4 w-4 animate-spin" /> Parsing...`). This makes the recovered `parseInFlight=true` state visible without re-opening the confirm dialog. Pattern: `disabled={!canParse || parseInFlight}`.

**Hub reconnect self-heal convention (#147 option-4, feat 193327b1):** The hub socket `useEffect([socket])` registers both the `boq:parse_run_done` done-handler AND a `socket.on("connect", onReconnect)` reconnect handler in the same effect body. `onReconnect = () => { void mutate(); }` re-fetches the BoQ doc on socket reconnect (and initial connect -- harmless, SWR deduplicates). The existing `useEffect([boq])` on-mount recovery then re-syncs `parseInFlight` from the fresh `parse_in_progress` server value, self-healing a missed done-event without a manual refresh. Cleanup: `socket.off("connect", onReconnect)` in the same return alongside `socket.off("boq:parse_run_done", handler)`. Reuses the existing `mutate` from `useFrappeGetDoc`; no new fetch mechanism. Apply this pattern to any future hub-scoped long-running job that uses a socket done-event + on-mount recovery.

**ParseRunDialog dismiss convention (#147 option-4, feat 193327b1):** `ParseRunDialog`'s `onOpenChange` must allow dismiss even when `isLoading` (a parse is in flight) -- closing the dialog does NOT cancel the server parse job. The parse keeps running; the hub's Parse button continues showing Parsing... spinner (driven by `parseInFlight`). Pattern: `onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}` -- no `isLoading` guard. The **Cancel button stays disabled** while loading because "Cancel" implies aborting the job, which is not supported (no cancel API exists). Three dismiss affordances are always available: X button (built-in via `disableCloseIcon=true` default in `DialogContent`), Escape key, and overlay-click. This pattern enables navigate-away-during-parse: user closes dialog mid-parse, hub body becomes interactive, user navigates away. On return, on-mount recovery restores `parseInFlight=true` from `parse_in_progress`.

**Continue gate (M1.33-M1.36):** Enabled when `droppedFile !== null && uploadStatus
=== "done" && confirmedFields.boqName && confirmedFields.version && confirmedFields.gst`.
Disabled-state tooltip dynamically lists still-missing items. On click:
`navigate(\`/upload-boq/hub/${boqDocName}\`)` -- navigates to the BoQ Hub screen
(Module 2b-i, feat 81568df9). The old `handedOff` stub (CheckCircle2 placeholder,
local useState) has been removed.

**Pre-fill-unconfirmed pattern (S4.1, M1.34):** Required fields (BoQ Name, Version, GST)
start blank (see blank-until-parsed above). After `fillFromParse`, they carry real
detected values and show ~50% opacity with a ✨ sparkle until the user explicitly
interacts (click, focus, or value change calls `confirmField`). Read-only (Project,
Customer) and optional (Notes) fields are excluded from this treatment (M1.19, M1.32).
GST's `onClick` on the `RadioGroup` catches clicks on the pre-selected option,
satisfying M1.30 ("clicking even the default confirms"). Confirmed flags live in the
store.

**Minimal touch (2026-06-20 -- Phase 5 Pricing-overlay read `get_priced_rows`, BACKEND ONLY, feat pending):** Added
the composing pricing read -- `api/boq/wizard/pricing.py:get_priced_rows(boq_name, sheet_name)` merges the committed
rows (`get_committed_rows`) with the current saved prices (`get_sheet_pricing`) into ONE structure (rate cells stamped
in place + a `priced_by_area`/`priced_rate_*` marker driven by `is_filled`, NOT a zero-check) + the reserved
`editable`/`lock_info` lock placeholders; `get_committed_rows` gained an additive `commit_version` response key. PURE
READ, NO migrate. NO FRONTEND CHANGE this slice (the pricing grid that consumes this is a later frontend slice);
recorded here per the DOCS-UPDATE RULE. Full detail in root `CLAUDE.md` + `boq-upload-plan.md` "Phase 5 Pricing-overlay
read". test_pricing 12 -> 22, test_review_screen 205 unchanged.

**Status (2026-06-20 -- Phase 4 Slice AI-3c-2d GATE run_ai_pass ON A FINALIZED SHEET (FREEZE GAP) COMPLETE -- BACKEND + FRONTEND, `ai_assist.py` + `SheetReviewPage.tsx` (+ test_ai_assist.py), feat pending):**
Closes the last freeze hole in the AI surface. A "Finalized" sheet is read-only (`_guard_sheet_not_frozen`), and
accept/reject/revert were ALL already guarded -- but `run_ai_pass` was added later and was NEVER gated on EITHER layer,
so a finalized sheet could still trigger a fresh AI pass whose `_apply_ai_suggestions` STALE-CLEAR wipes the
`ai_suggestion_status` of already-Accepted rows (a real mutation of a read-only sheet; confirmed live + by recon). NO
doctype JSON change -> no migrate.

- **Frontend (`SheetReviewPage.tsx`).** The "Run AI pass" button's `disabled=` expression gained `|| isChecked` (=
  `sheetStatus === "Finalized"`, the SAME finalized signal the "Mark Finalized" button at ~455 uses; `isParsing` was
  already in the list). So a finalized sheet shows the button **GREYED but VISIBLE** (owner choice: disable-not-hide,
  mirroring the Revert button's visible-but-disabled treatment). A `title` hint ("Sheet is finalized — un-mark to run
  the AI pass") renders on the disabled button. `AI_REJECT_MSGS` gains `frozen` ("This sheet is finalized and is
  read-only. Un-mark it to run the AI pass.") + `parsing` entries -- defense in depth: the button is disabled, but a
  stale client that still calls `run_ai_pass` now surfaces a readable message instead of an opaque `{ok:false}` code.
- **Backend (`ai_assist.py` `run_ai_pass`) -- the load-bearing fix.** Two new pre-flight rejects in the existing
  `{ok:False,error:"<code>"}` idiom (NOT the throwing `_guard_*` -- run_ai_pass returns codes), inserted AFTER the
  no_api_key check and **BEFORE the cache check** (load-bearing: the cache-HIT path ALSO runs `_apply_ai_suggestions`'s
  stale-clear, so the guard must precede BOTH the synchronous cache path and the enqueue path): `frozen`
  (`_get_sheet_wizard_status(boq, sheet) == _SHEET_FINALIZED`, a non-throwing status read) + `parsing` (a new
  `_get_parse_in_progress` helper mirroring `_get_ai_in_progress`, reading the draft's `parse_in_progress` -- the
  non-throwing analog of `_guard_sheet_not_parsing`). `_SHEET_FINALIZED` + `_get_sheet_wizard_status` added to the
  review_screen import; the worker / `_apply_ai_suggestions` / stale-clear are UNCHANGED. **This completes the freeze
  coverage of the whole AI surface.**
- **Verification.** `test_ai_assist` 33 -> **36** (+3: Z1 finalized -> `{ok:False,error:"frozen"}` + NO enqueue + an
  Accepted row's `ai_suggestion_status` UNCHANGED [the stale-clear never ran -- the core proof]; Z2 a non-finalized
  Parsed sheet still enqueues [the guard does not over-fire]; Z3 `parse_in_progress=1` -> `{ok:False,error:"parsing"}` +
  NO enqueue). `test_review_screen` **196 unchanged** (review_screen.py not touched). All prior run_ai_pass +
  accept/reject/revert (V*/T*/G*/C*) green. tsc 0 new wizard-file errors (filtered `boq-wizard|SheetReviewPage` ->
  empty; total 3178 baseline) + in-container Vite build exit 0 (`Done in 326.85s`, PWA 164 entries). Manual live-cert
  pending Nitesh: finalize a sheet -> the "Run AI pass" button is greyed with the finalized title; un-mark -> it
  re-enables; a direct call on a finalized sheet returns the frozen reject and leaves Accepted rows' status intact.
  **NEXT = the boq_ai.log token-logging fix, then the Phase-4 doc refresh.**

// prior: **Status (2026-06-20 -- Phase 4 Slice AI-3c-2b REVERT AI CHANGE BUTTON + OVERRIDE CLEARS AI-ACCEPTED STATUS COMPLETE -- FRONTEND + a bundled BACKEND status fix (R6), `boqTypes.ts` + `ReviewTree.tsx` + `review_screen.py` (+ test_review_screen.py), feat pending):**
Surfaces AI-3c-2a's row-level revert in the UI AND fixes a misleading status (today an AI-Accepted row keeps reading
"AI Accepted" even after the user hand-edits its classification/parent -- the override is hidden; now it reads
"Edited"). **The AI accept/reject/revert surface is now COMPLETE** (pending live-cert). NO doctype JSON change -> no
migrate (the 2a snapshot fields already exist).

- **The Revert button (`ReviewTree.tsx` detail panel).** A NEW block placed right AFTER the PENDING accept/reject block
  (lines ~1993-2090, which renders only while `aiSuggestionInfo(row)` is non-empty -- i.e. `ai_suggestion_status ===
  "Pending"` -- and so VANISHES once Accepted, so the Revert button CANNOT live inside it). The new block is gated
  `row.ai_suggestion_status === "Accepted"` so it shows for an Accepted row in BOTH the editable AND the readOnly panel.
  `<Button size="sm" variant="outline" className="h-7 px-2 text-xs">` reading "Revert AI change" / "Reverting…", inside
  an indigo-tinted card mirroring the pending block (`border-indigo-200 bg-indigo-50/40` + dark). **ENABLED iff
  `row.revert_available && !readOnly`**; `disabled={!row.revert_available || readOnly || isRevertingAi}`. DISABLED-with-
  reason mirrors the pending block's italic-muted "(no change)" pattern (`text-muted-foreground italic text-xs`):
  readOnly -> "Sheet is finalized — revert unavailable."; else `!revert_available` -> "Revert no longer available — the
  row was edited after the AI change." Errors via the existing `aiActionError` (`text-xs text-destructive`).
- **`handleRevertAi` + the refresh choice.** `useFrappePostCall("…ai_assist.revert_ai_acceptance")` typed `{ ok,
  ai_suggestion_status, reverted_children }`; called with `{ boq_name, sheet_name (VERBATIM #152), row_index }`. On
  success it runs **`onRemarkSaved?.()`** -- DELIBERATELY the mutate-only full re-fetch (NOT `onSaved`): revert returns
  NO `edited_at` to thread, and the point is a full re-fetch so the row re-renders Pending (the pending accept/reject
  block reappears, the Revert button + "AI Accepted" tag disappear). Same pattern reject/dismiss use. `getFrappeError`
  into `aiActionError` on throw.
- **`boqTypes.ts` (additive).** `ReviewRow` gains `revert_available?: boolean` after `ai_suggestion_status` -- computed
  by `get_review_rows` from `ai_accept_snapshot`; the raw blob is never shipped.
- **BACKEND R6 (`review_screen.py` `_apply_and_save_row_edit`) -- the override-clears-Accepted fix.** The EXISTING
  AI-3c-2a class/parent chokepoint block (`if field in ("human_classification","human_parent")` -- the one that clears
  the revert snapshot + back-pointer) now ALSO clears `ai_suggestion_status` so an overridden AI-Accepted row stops
  reading "AI Accepted" (the Status column at ~1671 checks `=== "Accepted"` BEFORE `isEdited`, so a falsy status falls
  through to "Edited"). **GATED `if doc.ai_suggestion_status == "Accepted"` (a DELTA from the spec's bare `= None`):** a
  Pending/Rejected suggestion has NOT been applied, so a manual class/parent edit must leave it untouched -- this
  PRESERVES the restructure cancel-safety contract (R4: a manual restructure on a Pending-suggestion row must not change
  the status; the ungated clear broke R4 in-session). **value/text/per-area edits never enter this block** -> a value
  edit on an AI-Accepted row STAYS "AI Accepted" + revert stays available (the edit-type distinction). **ORDERING
  (load-bearing):** both accept paths flip `ai_suggestion_status="Accepted"` LAST (flip block, after every helper call)
  and revert flips "Pending" LAST, so this in-flight clear during an accept/revert is harmless -- the final flip wins
  (X1 + W2 assert it).
- **Verification.** `test_review_screen` 192 -> **196** (+4: X1 accept still ends "Accepted" despite the chokepoint
  clear; X2 accept-then-later-human_parent-edit -> falsy status + non-empty edit_log -> "Edited"; X3 accept-then-VALUE-
  edit -> stays "Accepted"; X4 class/parent edit on a never-accepted row is a status no-op). `test_ai_assist` **33
  unchanged** (the accept/reject/revert helper path runs while status is Pending -> the `== "Accepted"` gate skips it).
  All prior green incl. R4 cancel-safety + W2 revert-to-Pending. tsc 0 new wizard-file errors (filtered
  `boq-wizard|ReviewTree|boqTypes` -> empty; total 3178 baseline) + in-container Vite build exit 0 (`Done in 343.36s`,
  PWA 164 entries). Manual live-cert pending Nitesh: accept an AI rec -> "AI Accepted" + "Revert AI change" button
  shows; Revert -> row returns to pre-accept + the suggestion re-offers Pending; hand-edit the class/parent of an
  Accepted row -> reads "Edited" + the button greys with the "edited after" reason; a VALUE edit on an Accepted row ->
  stays "AI Accepted" + revert still offered; finalize -> button greys with the "finalized" reason. **NEXT = the
  boq_ai.log token-logging fix, then the Phase-4 doc refresh.**

// prior: **Status (2026-06-20 -- Phase 4 Slice AI-3c-3 AI CLASSIFICATION-ACCEPT MODAL PARITY (with-children) COMPLETE -- BACKEND + FRONTEND, `ReviewTree.tsx` + `ai_assist.py` (+ test_ai_assist.py + test_review_screen.py), feat pending):**
Closes a SILENT BROKEN-TREE hole: the AI-accept routing opened the child-disposition RestructureModal ONLY when a
PARENT change was accepted on a with-children row. A CLASSIFICATION-only accept on a with-children row (e.g.
Preamble->note) fell through to a bare `accept_ai_suggestion`, which wrote the new class and left the children pointing
at the now-non-parent row -- uncaught by `check_structural_integrity` (it flags line_item-as-parent only, NOT
note/spacer-as-parent). The MANUAL `onPickClass` path already opens the modal for ANY with-children reclass; the AI
path now mirrors it. No doctype JSON change -> no migrate.

- **THE RULE (owner-stated):** any classification change on a row WITH children opens the child-disposition modal; it
  skips the modal only if the row is CHILDLESS (the manual-edit rule).
- **Frontend (`ReviewTree.tsx` `handleApplyAi`).** The modal-open condition changed from `aiAcceptParent &&
  hasChildrenSet.has(row.row_index)` to `hasChildrenSet.has(row.row_index) && (clsIsChange || parentAccept)`, where
  `clsIsChange = aiAcceptCls && ai.hasClass && ai_suggested_classification !== effective_classification` and
  `parentAccept = aiAcceptParent && parentIsChange`. **A classification-ONLY accept OMITS `presetRowParent`**
  (`undefined`) -> the modal opens in NORMAL mode and, because the row has children, lazy-inits `rowPosition="keep"`
  (`RestructureModal:156-159`) so the row KEEPS its own parent -- IDENTICAL to manual `onPickClass`->modal (which also
  passes no parent preset). A parent accept still sets `presetRowParent` (root -> -1, else `ai_suggested_parent`) + the
  `presetParentMessage` line. `newClassification` = the AI class when `clsIsChange`, else the current effective class
  (the #162 no-op pattern). `markAiAccepted: true` rides every modal open (status flips on Save, cancel-safe).
  Childless rows + classification-only accepts on childless rows are UNCHANGED -> the direct `accept_ai_suggestion`
  path. The `presetRowParent`/`presetParentMessage` keys are spread CONDITIONALLY (`...(presetRowParent !== undefined ?
  {…} : {})`) so a classification-only open passes neither.
- **Backend (`ai_assist.py` `accept_ai_suggestion`).** A NEW `accept_classification && _row_has_children(...)` guard
  (mirrors the existing `accept_parent` guard) THROWS "Restructure required" on a with-children classification accept --
  closing the silent-break hole even if the frontend is bypassed. The childless classification accept is unaffected.
  `save_review_restructure` / `resolve_effective` / `check_structural_integrity` UNCHANGED -- the frontend routes the
  with-children case to the EXISTING `save_review_restructure` (reclassify + child-disposition; supports a class change
  with NO `row_new_parent` + `mark_ai_accepted`).
- **Verification.** `test_ai_assist` 27 -> **29** (+2: G1 with-children classification accept throws + row unchanged;
  G2 childless classification accept still works -- guard does not over-fire). `test_review_screen` 184 -> **185** (+1:
  R-fix4 mark_ai_accepted + new_classification + child_moves + NO row_new_parent -> class applied, children
  dispositioned, status Accepted, the row's OWN `human_parent` UNCHANGED [-1, resolves to its parser parent]). tsc 0
  new wizard-file errors (filtered `boq-wizard|ReviewTree|RestructureModal` -> empty) + in-container Vite build exit 0
  (PWA 164 entries). Manual live-cert pending Nitesh: on HVAC, a pending-suggestion with-children Preamble with an AI
  "note" classification rec -> tick classification only + Apply -> the child-disposition modal opens (row keeps its own
  parent, the 5 child options shown) -> Save -> Status "AI Accepted", children re-placed per choice. **NEXT = the
  boq_ai.log token-logging fix, then the Phase-4 doc refresh.**

// prior: **Status (2026-06-20 -- Phase 4 Slice AI-3b-2 ACCEPT AI PARENT on WITH-CHILDREN rows (cancel-safe modal) COMPLETE -- BACKEND + FRONTEND, `review_screen.py` + `RestructureModal.tsx` + `ReviewTree.tsx` (+ test_review_screen.py), feat pending):**
The FINAL piece of the AI accept/reject surface: accepting an AI PARENT on a row that HAS children fires the existing
RestructureModal (for child disposition) in a NEW children-only mode, with the AI parent PRE-APPLIED and the
`ai_suggestion_status` flip riding the modal's Save (never on cancel). **The AI accept/reject surface (AI-3a + AI-3b-1
+ AI-3b-2) is now COMPLETE.** No doctype JSON change -> no migrate.

- **Backend -- `save_review_restructure` gains `mark_ai_accepted=False`** (last param, HTTP-coerced). When truthy:
  sets `target_doc.ai_suggestion_status = "Accepted"` AFTER `frappe.get_doc` and BEFORE the first
  `_apply_and_save_row_edit`, so the human writes + the flip land in the function's SINGLE existing commit (atomic;
  mirrors AI-3b-1's accept endpoint). OPT-IN: omitted/false (every existing caller) leaves the status untouched.
  **CANCEL-SAFE BY CONSTRUCTION:** the endpoint is reached ONLY via the modal's Save (NO modal close path calls the
  backend -- `onClose` is pure state reset, `onInteractOutside` prevents overlay-dismiss), so a cancelled modal never
  flips. R4 asserts the opt-in semantic.
- **Frontend -- RestructureModal children-only mode (3 NEW optional props).** `presetRowParent?: number | null`
  (internal index; -1 = root), `presetParentMessage?: string`, `markAiAccepted?: boolean`. When `presetRowParent !==
  undefined`: lazy-init `rowPosition="move"` + `rowParentIdx=presetRowParent` (so `canSave`'s "move && rowParentIdx
  ===null" gate passes immediately), and the keep/move radio + the SheetSearchView picker are REPLACED by a read-only
  indigo message line (`presetParentMessage`, with a `Sparkles` icon); the 5 child-placement options are UNCHANGED.
  `handleSave` adds `mark_ai_accepted: true` to the `call(...)` payload (`row_new_parent` already flows from
  `rowParentIdx`). Undefined preset -> the modal is byte-for-byte unchanged (every existing opener -- onPickClass,
  the #162 Change-parent door -- passes nothing).
- **Frontend -- ReviewTree panel routing.** The AI-suggestion parent checkbox is now ENABLED for with-children rows
  (the AI-3b-1 `parentBlocked` disable is removed; the seed effect default-checks a real parent change regardless of
  children; a "(opens restructure)" hint + tooltip replace the old "next slice" label). `handleApplyAi`: when
  `aiAcceptParent && hasChildrenSet.has(row.row_index)`, it OPENS the modal --
  `setRestructureModal({ row, newClassification, presetRowParent, presetParentMessage, markAiAccepted: true })` --
  instead of calling `accept_ai_suggestion`. `presetRowParent` = `ai_suggested_is_root===1 ? -1 :
  ai_suggested_parent`; `newClassification` = the AI class when its checkbox is a real change, else the row's current
  effective class (the no-op reclassify the #162 door uses) -> ACCEPT-BOTH folds into ONE restructure call. Childless
  / classification-only accepts stay on the AI-3b-1 `accept_ai_suggestion` path unchanged. The `restructureModal`
  state type + the mount gained the 3 fields (existing openers omit them -> undefined -> unchanged).
- **Verification.** `test_review_screen` 176 -> **181** (+5: R1 parent+children flip; R2 class+parent both + flip;
  R3 root accept -> human_is_root; R4 no-flag leaves status Pending [the cancel-safety semantic]; R5 plain
  restructure never flips). tsc 0 new wizard-file errors (filtered `boq-wizard|ReviewTree|RestructureModal|boqTypes|
  SheetReviewPage` -> empty; total 3178 pre-existing drift) + in-container Vite build exit 0 (`built in 348.77s`,
  PWA 164 entries). Manual live-cert pending Nitesh: on HVAC, open a pending-suggestion row WITH children, tick the
  parent + Apply -> the children-only modal opens with the AI parent shown in the message line + the 5 child options;
  Save -> Status "AI Accepted", badge clears, children reparented per choice; Cancel/Esc -> nothing written, status
  stays Pending. **NEXT = the boq_ai.log token-logging fix, then the Phase-4 doc refresh.**

// prior: **Status (2026-06-20 -- Phase 4 Slice AI-3b-1 ACCEPT/REJECT (NON-MODAL) COMPLETE -- BACKEND + FRONTEND, `ai_assist.py` + `ReviewTree.tsx` (+ test_ai_assist.py), feat pending):**
Makes AI suggestions ACTIONABLE for the cases that do NOT need the RestructureModal: accept an AI CLASSIFICATION,
accept an AI PARENT on a CHILDLESS row, and REJECT. The accepted-parent-on-a-row-WITH-CHILDREN path (which fires the
modal) is AI-3b-2 (separate). No doctype JSON change -> no migrate.

- **Backend -- two NEW endpoints (`ai_assist.py`).** `accept_ai_suggestion(boq_name, sheet_name, row_index,
  accept_classification, accept_parent)` REUSES `review_screen._apply_and_save_row_edit` (imported, NOT reimplemented)
  to write human_* to the AI values (`human_classification = ai_suggested_classification`; parent:
  `ai_suggested_is_root==1 -> set_root=True` else `human_parent = ai_suggested_parent`) AND sets `doc.ai_suggestion_
  status = "Accepted"` on the SAME doc before the helper's `doc.save()` -> human_* + the status flip in ONE commit (so
  the row reads "AI Accepted", not plain "Edited", and the badge clears). SCOPE GUARD: parent-accept throws when the
  row has children (`_row_has_children`, the backend mirror of `hasChildrenSet`); childless => no cycle possible.
  `reject_ai_suggestion(...)` sets status="Rejected" via `frappe.db.set_value` ONLY -- no human_*, no edited_at (row
  stays "Original"); suggested values preserved for audit. Both guard frozen + parsing.
- **Frontend -- the per-field accept/reject panel (`ReviewTree.tsx` row-detail panel).** Below the Classification +
  Parent lines, a NEW "AI suggestion" block renders ONLY when `aiSuggestionInfo(row).hasClass || hasParent` (a Pending
  suggestion) AND `!readOnly`. It has a classification checkbox + a parent checkbox, each with an `AiConfBadge` (the
  AI-3a H/M/L pill) + the suggested value (parent translated to an Excel row via `byIdx`, or "Top level (root)" when
  `ai_suggested_is_root===1`), the single `ai_explanation` line, and "Apply selected changes" + "Reject" buttons.
- **Checkbox defaults + the children gate.** Seeded in the existing detail-panel-open effect: default-CHECKED when the
  AI suggests a REAL change (`ai_suggested_classification !== effective_classification`; for parent, the suggested
  parent/root differs from the current effective parent); a "(no change)" suggestion is shown disabled. The PARENT
  checkbox is additionally DISABLED (with a tooltip "…opens the restructure step — coming in the next slice") when
  `hasChildrenSet.has(row.row_index)` -- so AI-3b-1 never triggers the modal path. `canApply` requires at least one
  applicable checked box.
- **Refresh reuse (NO new mechanism).** Apply -> `accept_ai_suggestion` -> `onSaved?.(edited_at)` (the existing
  setLastSavedAt + mutate; row re-fetches Accepted, badge clears, Status -> "AI Accepted"). Reject ->
  `reject_ai_suggestion` -> `onRemarkSaved?.()` (the mutate-only refresh used by remark/dismiss; a reject is not a
  data edit, so no anchor advance). Errors via the house `getFrappeError` (the backend children-guard message
  surfaces readably).
- **Verification.** `test_ai_assist` 16 -> **24** (+8, all green: accept classification / childless real-parent /
  childless root / both; with-children guard throws + row unchanged; nothing-to-accept throws; reject status-only +
  no edited_at; accept-then-resolve_effective folds the accepted value). `test_review_screen` **176/176** unchanged.
  tsc 0 new wizard-file errors (filtered `boq-wizard|ReviewTree|SheetReviewPage|boqTypes` -> empty; total 3178,
  pre-existing drift) + in-container Vite build exit 0 (`built in 359.88s`, PWA 164 entries). Manual live-cert pending
  Nitesh: on HVAC, open a pending-suggestion row -> tick + Apply -> Status flips to "AI Accepted", badge clears, the
  effective classification/parent updates; Reject -> badge clears, row stays Original; a row-with-children shows the
  parent checkbox disabled with the tooltip. **NEXT = AI-3b-2** (the RestructureModal children-only mode for an
  accepted parent on a row WITH children + the cancel-safe `mark_ai_accepted` coupling), then the boq_ai.log fix.

// prior: **Status (2026-06-19 -- Phase 4 Slice AI-3a AI-PASS DISPLAY + TRIGGER COMPLETE -- FRONTEND + 1 additive backend read-list field, `boqTypes.ts` + `SheetReviewPage.tsx` + `ReviewTree.tsx` + `review_screen.py`, feat pending):**
The DISPLAY + TRIGGER layer for the AI structure-suggestion pass (backend AI-1..AI-2e). Makes the pass TRIGGERABLE
and suggestions VISIBLE; does NOT make them actionable -- NO accept/reject panel, NO Apply flow, NO RestructureModal
change (that is AI-3b). The accepted-suggestion write path is AI-3b; AI-3a is read-only surfacing + the run trigger.

- **Data plumbing (`boqTypes.ts`, additive).** `ReviewRow` gained all 8 ai_* fields (`ai_suggested_classification`,
  `ai_classification_confidence` "High"|"Medium"|"Low"|null, `ai_suggested_parent`, `ai_parent_confidence`,
  `ai_suggested_is_root` 0|1, `ai_suggested_level`, `ai_explanation`, `ai_suggestion_status`
  "Pending"|"Accepted"|"Rejected"|null) -- all OPTIONAL so no existing construction breaks. `BoQSheetDraft` gained
  `ai_in_progress?: 0|1` (mirror of `parse_in_progress`; rides `useFrappeGetDoc("BOQs")`). NEW `AiPassDonePayload`
  ({status, boq_name, sheet_name, count?, error_code?}) typed against `ai_assist._publish_ai_event`. **BACKEND:**
  `get_review_rows` `all_fields` (`review_screen.py`) gained the 4 ai_* NOT echoed by `resolve_effective`
  (confidence×2, level, explanation) so they ride the payload -- additive, no reorder, no migrate, 176/176 tests
  unchanged.
- **THE THREE-LAYER COMPLETION MECHANISM (the reliability requirement -- `SheetReviewPage.tsx`).** The parse/upload
  screens historically HUNG when a single socket event was MISSED (job done, event fired, client not listening ->
  stuck on "running" forever). AI-3a MUST NOT reproduce that: **the POLL is the guarantee; the socket is a fast-path
  optimization.** (1) **Socket fast-path:** a `boq:ai_pass_done` listener via `useContext(FrappeContext)` (newly
  imported here), mirroring BoqHubPage's `boq:parse_run_done` pattern -- guards `payload.boq_name === boqId &&
  payload.sheet_name === sheetName`, resolves (mutate + boqMutate + result/error banner + stop poll), plus a
  `socket.on("connect", ...)` reconnect re-fetch. (2) **Poll-until-terminal:** while `aiInProgress`
  (`sheetDraft?.ai_in_progress === 1`), `get_ai_pass_status` is polled every 3s; a terminal cached payload
  (success/error) resolves immediately, an idle+flag-0 edge (finished, no cached payload) refreshes+stops; the
  interval id is held in a `useRef` with idempotent `stopAiPoll` (cleanup on terminal + unmount + a double-register
  guard -- a leaked interval hammering the endpoint is its own bug). (3) **On-mount recovery:** because the poll
  effect keys on `aiInProgress` (which rides the BOQs doc), a pass still running when the user returns to the sheet
  auto-arms the poll; a pass that finished while away resolves via the cached status payload. `resolveAiOutcome` is a
  `useCallback` shared by both socket + poll (idempotent on double-resolve).
- **Run AI pass button (`SheetReviewPage.tsx`).** In the header cluster beside Export CSV / Mark Finalized
  (`Sparkles` icon). `useFrappePostCall("...ai_assist.run_ai_pass")`, called with `{boq_name, sheet_name}`. Disabled
  when `reviewLoading || rows.length === 0 || aiInProgress || aiRunLoading || isParsing`. The three documented
  response shapes (verified vs `ai_assist.py`): `{ok:false,error}` -> a muted inline message
  (`AI_REJECT_MSGS` for not_parsed/ai_disabled/no_api_key, `getFrappeError` on throw); `{ok:true,cached:true,count}`
  -> `mutate()` + an indigo "AI pass complete -- N suggestions (cached)" banner, NO socket expected;
  `{ok:true,enqueued:true}` -> `boqMutate()` so `ai_in_progress` flips in and the poll arms. An amber "AI pass
  running..." chip shows while `aiInProgress`. **The screen is NOT set readOnly for an AI pass** (unlike parse -- an
  AI pass only writes ai_* suggestion fields, never human/parser data, so editing stays safe).
- **AI Rec column + AI Accepted status + row tint (`ReviewTree.tsx`).** A new "AI Rec" column at **position 4**
  (immediately after Status -- the column order is Expander|Excel Row|Status|AI Rec|Sl.No|Parent|Classification|
  Description|descriptors|Append Notes; `totalCols` bumped 7->8). Its body cell renders confidence badge(s) for a
  PENDING suggestion (classification + parent each one H/M/L pill via `AiConfBadge`; both -> two side by side; none/
  resolved -> blank), driven by an `aiSuggestionInfo(row)` helper (a suggestion only "counts" while
  ai_suggestion_status === "Pending"; parent = a real index OR `ai_suggested_is_root === 1`). A filter Popover
  (mirrors the Status/Classification filter idiom): Show all rows (default) / Any AI suggestion / Has High / Has
  Medium / Has Low, AND-combined with the other filters in `passesFilter` (+ added to the `searchHits` deps for the
  compose interlock). The **Status** column gained a third value "AI Accepted" (indigo) -- branched on
  `ai_suggestion_status === "Accepted"` BEFORE the `isEdited` check (an accepted suggestion writes to human_* in
  AI-3b and would otherwise read "Edited"; this preserves AI provenance) -- with `STATUS_FILTER_LABELS` + the
  statusFilter type (`StatusFilter`) + `passesFilter` extended to match. A subtle indigo **row tint** for a pending
  suggestion, placed in `cn()` BEFORE the edited-green tint (so an edited row stays green via twMerge) and before the
  amber scroll-flash (so the flash still wins) -- matching the existing tint ordering.
- **Verification.** tsc 0 new wizard-file errors (filtered `boq-wizard|ReviewTree|SheetReviewPage|boqTypes` -> empty;
  total 3178 = pre-existing drift in Retired Components etc., none referencing the new ai_* symbols) + in-container
  Vite build exit 0 (`built in 5m 8s`, PWA 164 entries). Backend `test_review_screen` 176/176 unchanged (additive
  read-list field). No new backend tests this slice (additive field + frontend display). Manual live-cert pending
  Nitesh: Run AI pass on a parsed sheet -> badges appear in AI Rec, the running chip + completion banner show, and a
  missed socket still resolves within ~3s via the poll. **NEXT = AI-3b** (accept/reject panel + RestructureModal
  children-only mode for an accepted parent), then the boq_ai.log token-logging fix.

// prior: **Status (2026-06-18 -- Slices F3/F4 completion-modal failure REASONS COMPLETE -- FRONTEND, `BoqHubPage.tsx` (F4 = `CommitResultsModal.tsx` verify-only), feat bfa71098):**
The TRANSIENT counterpart to F2's persistent card: at the moment a parse/commit finishes, the completion modal
highlights each FAILED sheet WITH its reason. FRONTEND ONLY -- no backend, NO new fetch, NO payload change.
- **F4 (`CommitResultsModal.tsx`) = ALREADY SATISFIED at Slice 5 -- VERIFY-ONLY, no code change.** It already
  renders a dedicated "Failed (N)" section with, per sheet, a destructive `<li>` + `AlertTriangle` +
  `{sheet_name} -- {reason}` (the `{committed, failed}` envelope carries the reason). Re-read, confirmed no gap.
- **F3 (`BoqHubPage.tsx`, the parse-completion `AlertDialog`) = THE REAL WORK.** The failed line was
  `parseResult.failed.join(", ")` (bare NAMES). It is now a per-sheet `<ul>/<li>` list mirroring the
  CommitResultsModal failed-section shape (`AlertTriangle` + `text-destructive` + `{name} -- (category) reason`).
  **DATA SOURCE (the load-bearing decision):** the `boq:parse_run_done` socket payload (`ParseRunDonePayload`)
  carries NAMES ONLY by design (`failed_sheets: string[]`); the worker publish site
  (`parse_run._publish_parse_event`, payload `{status, boq_name, parsed_sheets, not_parsed_sheets, failed_sheets}`)
  adds no reasons. The REASON lives in the persisted `parse_failure_*` (Slice 1a) on the draft, which rides the
  `useFrappeGetDoc("BOQs")` doc the hub ALREADY has + ALREADY `mutate()`s on parse-done. So F3 reads each failed
  sheet's reason at render time via `boq.sheet_drafts?.find(sd => sd.sheet_name === name)` (VERBATIM #152, the same
  lookup F2 / the hub use) -> `parse_failure_reason` (+ `parse_failure_category` in parens). **NO new fetch.**
- **FRESHNESS FALLBACK (a correctness requirement, NOT optional).** `applyParseOutcome` calls `mutate()` (async
  refetch) AND `setParseResult()` (opens the modal immediately). The worker COMMITS the `parse_failure_*` stamps
  BEFORE publishing the socket event, so once the refetch lands the reasons are present and the open modal
  re-renders fresh -- but the FIRST render can be pre-mutate, so the draft lookup returns undefined. F3 guards with
  `reason && (...)` -> renders the sheet NAME ALONE in that window (never blank / "undefined" / crash); the next
  render shows name + reason. The modal is acknowledge-only and stays open, so the user sees the reason by the time
  they read it. Do NOT block the modal on the refetch; do NOT add a fetch to force freshness.
- **UNCHANGED (deliberate).** The `parsed` (foreground) + `notParsed` (NEUTRAL `text-muted-foreground`, names-only)
  success sub-lines stay exactly as-is -- `notParsed` is a neutral advisory list (skipped / hidden / general-specs /
  pending), and although stale-config drops DO land in `not_eligible` with a "Config stale" stamp, their reason is
  shown PERSISTENTLY on the F2 card and is NOT duplicated in this transient modal (notParsed stays neutral, NOT
  dragged into destructive styling). The whole-run `parseError` block (`PARSE_ERROR_MSGS`, `no_eligible_sheets`
  NEUTRAL) is a DIFFERENT axis (whole-run failure, not per-sheet) and is untouched. `AlertTriangle` added to the
  BoqHubPage lucide import. NO timestamp shown in the modal (it is just-happened/transient; the F2 card persists
  `parse_failure_at`). NO shared failed-list component extracted (two call sites, different data sources -- commit
  reads the envelope object, parse looks up `sheet_drafts`; abstracting both is over-engineering).
- **Verification.** tsc 0 new wizard-file errors (filtered `boq-wizard|SheetCard|BoqHubPage|boqTypes|CommitResultsModal`
  -> empty; 3177 baseline unchanged) + in-container Vite build exit 0 (`Done in 251.50s`). DATA-SIDE cert on
  BOQ-26-00145 (restore-first-safe capture-and-restore; workbook RESTORED to baseline): `_record_parse_failure`
  stamps the "FAS" draft -> a VERBATIM-name lookup resolves `parse_failure_reason` + category "Parser error" (the
  exact data F3 renders); a missing name -> `find()` undefined -> the name-only fallback path (code-inspected); the
  three fields restored to the captured baseline verbatim (no JSON round-trip -- these are scalar Select/Small Text/
  Datetime, not JSON). **The VISUAL modal render is an OWNER-OWNED later manual pass -- not headlessly confirmable.**
  Full detail in boq-upload-plan.md "Slice F3/F4". This COMPLETES the F-arc (F1 persist -> F2 persistent card ->
  F3/F4 transient modals).

// prior: **Status (2026-06-18 -- Slice F2 hub-card NEEDS-ATTENTION indicator COMPLETE -- FRONTEND, `boqTypes.ts` + `BoqHubPage.tsx` + `SheetCard.tsx`, feat 1f1828d4):**
The frontend that finally SHOWS the user the per-sheet failure/staleness signals the backend captures: a
consolidated "needs attention" chip on each hub `SheetCard`, collapsed by default, click-to-expand. THREE per-sheet
signals -- STALE CONFIG (`get_stale_sheets`, Slice 1b -- a LIVE call, reason only, NO timestamp), PARSE FAILURE
(`parse_failure_*` on the draft, Slice 1a -- category + reason + timestamp), COMMIT FAILURE (`commit_failure_*` on
the draft, Slice F1 -- reason + timestamp). FRONTEND ONLY -- no backend change (1a/1b/F1 already provide the data).

- **`boqTypes.ts` (additive).** `BoQSheetDraft` gains five optional fields it can now READ off the BOQs payload:
  `parse_failure_category?` (`"" | "Config stale" | "Parser error" | "Insert error" | null`, matching the doctype
  Select), `parse_failure_reason?`, `parse_failure_at?`, `commit_failure_reason?`, `commit_failure_at?`. Plus
  `StaleSheet { sheet_name; reason }` + `GetStaleSheetsResponse { stale_sheets: StaleSheet[] }` (mirrors
  `GetCommittedStateResponse`).
- **THE ONE NEW FETCH (`BoqHubPage.tsx`).** `get_stale_sheets` via `useFrappeGetCall` (the same bare-`@frappe.whitelist`
  GET family + `boqId ? undefined : null` swrKey gotcha as `get_committed_state`) -> a `staleMap: Map<sheet_name
  VERBATIM #152, reason>` mirroring `committedMap`, passed as `staleReason` to `SheetCard` at BOTH render sites (the
  main card list AND the hidden-sheets reveal). The parse/commit stamps RIDE the existing `useFrappeGetDoc("BOQs")`
  doc payload (child-table fields), so this is the ONLY fetch F2 adds. **`mutateStale` WIRING (the substantive hub
  work -- stale config is computed LIVE, no stored field, so only a re-fetch clears it):** `void mutateStale()` added
  to the parse-success path (`applyParseOutcome`), `handleCommitted`, and `handleSaved` -- so fixing config + re-parsing
  drops the indicator, and a fresh commit failure appears.
- **THE CHIP + EXPAND (`SheetCard.tsx`).** New optional `staleReason?: string` prop (the two failure stamps come off
  `draft`). The chip is a NEW sibling in the existing badge cluster (the div holding the isSaving/Parsing/pill/dirty/
  Committed chips): `AlertTriangle` + "N issue(s)", shown iff >= 1 distinct signal line. **Color (locked): RED**
  (`bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400`) when ANY failure STAMP is present (parse OR
  commit); **AMBER** (the dirty-chip tokens) when ONLY stale-config. Click toggles an inline expand block built with a
  local `useState` (`attnOpen`) mirroring the card's existing `editingLabel` inline-expand idiom -- NO new Popover/
  Collapsible library. Each line: a label (`Stale config` / `Parse failed (<category>)` / `Commit failed`), the reason
  (muted for stale, `text-destructive` for failures), and for parse/commit a timestamp via the card's existing
  `fmtCommittedAt` (`at.slice(0,16)` -- reused verbatim, no new formatter).
- **THE DE-DUP RULE (the one render subtlety, owner-locked).** 1a and 1b describe the SAME staleness with BYTE-IDENTICAL
  reason text (shared-helper design; re-proven live this slice). So when a live stale reason is present AND
  `draft.parse_failure_category === "Config stale"` AND `draft.parse_failure_reason === staleReason`, the two collapse
  into ONE "Stale config" line (carrying the parse timestamp, since the live stale signal has none). Other parse
  categories (Parser/Insert error) and commit failures are ALWAYS their own line. N (the chip count) = distinct lines
  after de-dup; the chip hides when N == 0.
- **EMPTY STATE.** A card with no stale entry AND no `parse_failure_reason` AND no `commit_failure_reason` (guard on
  the REASON STRINGS, not category -- category can be `""` with no reason) shows NO chip and no expand. Healthy cards
  stay uncluttered. NO per-signal action buttons -- show + expand only.
- **Verification.** tsc 0 new wizard-file errors (filtered `boq-wizard|SheetCard|BoqHubPage|boqTypes` -> empty; 3177
  baseline unchanged) + in-container Vite build exit 0 (`Done in 1285.37s`). DATA-SIDE live cert on BOQ-26-00145
  (capture-and-restore; workbook RESTORED to baseline): `get_stale_sheets` fires on a broken config (`[]` ->
  `["Lights"]`); de-dup string-equality holds (1b reason === stored `Config stale` `parse_failure_reason`, frontend
  `===` proven True); `_record_commit_failure` stamps the draft; all cleared + restored. **The VISUAL hub render (the
  chip paints, expand lists the right lines) is an OWNER-OWNED later manual pass -- not headlessly confirmable here.**
  Full detail in root CLAUDE.md... [N/A this slice -- frontend; see boq-upload-plan.md "Slice F2"]. NEXT = F3/F4 (the
  parse + commit completion modals highlighting failures with reasons).

// prior: **Status (2026-06-18 -- Phase 5 Slice 5 (frontend) commit-results modal COMPLETE -- FRONTEND, `boqTypes.ts` + `CommitResultsModal.tsx` (NEW) + `CommitDialog.tsx` + `BoqHubPage.tsx`, feat ab4a390b):**
Surfaces the Slice-5 backend envelope (`commit_boq` -> `{boq_name, committed:[{sheet_name, commit_version, ...}],
failed:[{sheet_name, reason}]}`, which NO LONGER throws on a per-sheet failure -- feat 09714041). After a commit the
user now sees an explicit RESULTS acknowledgement instead of the dialog silently closing. FRONTEND-ONLY -- no backend
Python, no doctype JSON.

- **Result flow = OPTION (i) (hub owns the modal).** `CommitDialog` keeps its "pick + fire" job: `fireCommit` now
  captures `res.message as CommitBoqResponse` and calls `onCommitted(result)` (prop widened from `() => void` to
  `(result: CommitBoqResponse) => void`) then closes. The hub's `handleCommitted(result)` stores it, fires the
  Slice-4b mutates (`mutate` / `mutateCommittedState` / `mutateCommittable` -- UNCONDITIONAL, harmless on an
  all-failed commit), and opens the results modal. Consistent with the hub owning the parse-completion modal.
- **`CommitDialog` catch unchanged in spirit.** The `try/catch` STAYS for WHOLE-CALL precondition throws (gate
  re-check / missing boq / empty subset / file fetch) -- those still `frappe.throw` and surface as the dialog's
  inline `getFrappeError` text. PER-SHEET failures are NOT thrown; they arrive in `result.failed` and render in the
  results modal. The picker (opens nothing-ticked, the step-1/step-2 re-commit warning) is byte-for-byte UNCHANGED.
- **`CommitResultsModal.tsx` (NEW) -- acknowledge-only, mirrors the parse-completion modal.** Props `{open,
  onOpenChange, result: CommitBoqResponse | null}`; returns null when `result` is null (safe -- opens only once a
  commit resolves). Uses the `AlertDialog` primitives (same as the parse-completion modal): a one-line SUMMARY that
  reads all three cases ("Committed N sheet(s)." / "Commit failed for N sheet(s)." / "Committed N sheet(s); M
  failed."), a COMMITTED `<ul>` (emerald + `CheckCircle2`, "{sheet} -- committed v{commit_version}", shown only when
  non-empty), a FAILED `<ul>` (`text-destructive` + `AlertTriangle`, "{sheet} -- {reason}", shown only when
  non-empty), and a single `AlertDialogAction` "OK" (+ escape via `onOpenChange`) that dismisses. Acknowledge-only --
  nothing in flight at this point, so no not-dismissible guard is needed. Sheet names display-trimmed; never re-sent.
- **`boqTypes.ts` (additive).** `CommittedSheetResult` (reads `sheet_name` + `commit_version`; other envelope keys
  optional), `FailedSheetResult` (`sheet_name` + `reason`), `CommitBoqResponse` (`{boq_name, committed[], failed[]}`).
  DISTINCT from `CommittedSheetState` (the get_committed_state read) -- this is the commit RESULT envelope.
- **No regression to Slice 4b.** The committed-state fetch, the dual "Committed" badge markers, and the "Committed: N"
  footer count are untouched; only the success-path handoff (silent close -> results modal) changed.
- **Verification.** tsc 0 new wizard-file errors (filtered) + in-container Vite build exit 0. HAPPY-PATH live-cert is
  OWNER-OWNED (not browser-driven here): on BOQ-26-00145, Commit -> tick a sheet -> the results modal shows the
  committed list + new version + summary "Committed 1 sheet(s)."; OK dismisses; the hub badge/count/version reflect
  the commit. FAILURE-path render is covered by the Slice-5 backend tests (T1/T4/T5/T6 populate `failed[]`) + code
  inspection; NOT exercised live (no real-data mutation, no browser-driving). Full detail in root CLAUDE.md +
  boq-upload-plan.md "Phase 5 Slice 5 (frontend)".

// prior: **Status (2026-06-17 -- Phase 5 Slice 4b commit UI COMPLETE -- FRONTEND, `boqTypes.ts` + `CommitDialog.tsx` (NEW) + `BoqHubPage.tsx` + `SheetCard.tsx`, feat 53645ab7):**
The user-facing commit entry point on the BoQ hub, wiring a UI onto the proven engine (`commit_boq`, already
whitelisted) + the Slice-4a read endpoint `get_committed_state`. FRONTEND-ONLY -- no backend Python, no doctype JSON.

- **TWO new hub reads (`BoqHubPage.tsx`).** `get_committable_sheets` (the gate -- eligibility + disposition) and
  `get_committed_state` (Slice 4a -- per-sheet current committed-state) via `useFrappeGetCall` (the whitelisted-bare
  GET family the work-package map uses; same `boqId ? undefined : null` swrKey gotcha), each with its own `mutate`.
  A `committedMap: Map<sheet_name(VERBATIM #152), CommittedSheetState>` is built once and drives the card badges +
  the footer tally; `committableSheets` drives the Commit button + the dialog. After a commit, `handleCommitted`
  calls `mutate()` (BoQ doc) + `mutateCommittedState()` + `mutateCommittable()` so badges + count + dialog refresh
  with NO reload.
- **Commit button = 4th footer sibling.** Added inside the existing `<div className="flex shrink-0 items-center
  gap-2">` Tooltip cluster after Export Finalized / Re-parse / Parse workbook. `variant="outline"`, label "Commit",
  `disabled={committableSheets.length === 0}` (gated on the GATE, NOT committed-state). Opens `commitDialogOpen`.
- **`CommitDialog.tsx` (NEW) -- mirrors ExportWorkbookDialog (checklist) + ParseRunDialog (two-step).** Props
  `{open, onOpenChange, boqName, eligibleSheets, committedState, onCommitted}`. Ticked `useState<Set<string>>`
  initialized EMPTY (opens with NOTHING ticked -- deliberate selection; reset on open). Each row: Checkbox + name +
  a `(finalized|general specs)` disposition hint + a muted "committed {date HH:MM} · v{n}" sub-label (or "not yet
  committed"). `const [step,setStep]=useState<1|2>(1)`: `handleConfirmClick` computes the ticked sheets that ALSO
  appear in `committedState` (the re-commits) -> NON-EMPTY sets step 2, else fires directly. Step 2 = destructive
  `AlertTriangle` callout NAMING each re-commit sheet WITH its last-committed date/time + "the prior version is
  frozen (kept as history), not lost", with "Go back" (-> step 1) and a destructive "Commit anyway". `fireCommit`
  calls `commit_boq` via `useFrappePostCall` with `{boq_name, sheet_subset: tickedList}` (ORDERED ticked list, the
  Export filter-by-eligible-order pattern; VERBATIM #152; the backend re-checks the gate before any write).
  running / inline `getFrappeError` / not-dismissible-mid-flight (`if (!isOpen && running) return`) all copied from
  Export; Confirm disabled when `running || ticked.size === 0`. On success -> `onCommitted()` then close.
- **`SheetCard.tsx` -- the Committed badge (dual markers).** New optional `committedState?: CommittedSheetState`.
  When present, an INDIGO "Committed" pill (`bg-indigo-600 ... dark:bg-indigo-700` -- distinct from every
  STATUS_PILL color) renders in the badge cluster ALONGSIDE the status pill (never replaces it), plus a muted
  "· Committed {date HH:MM} · v{n}" sub-line below the name/pill row. Applies to ANY committed sheet -- finalized
  AND general-specs, identical treatment. NOT added to `STATUS_PILL` or `WizardStatus`.
- **Footer "Committed: N".** `committedCount = allDrafts.filter(d => committedMap.has(d.sheet_name)).length` rendered
  in the existing `count>0 && ...` chain after "checked". DERIVED from committed-state, NOT a `getEffectiveStatus`
  bucket (committed-ness is orthogonal to wizard_status).
- **Date format.** Committed timestamps use the wizard's `slice(0,16)` "YYYY-MM-DD HH:MM" pattern (ReviewTree's
  `formatEditAt`) via a tiny local `fmtCommittedAt` in BOTH CommitDialog + SheetCard. App-shared `formatDate` is NOT
  mutated and NO new shared helper file was added.
- **`boqTypes.ts` (additive).** `CommittableSheet` / `GetCommittableSheetsResponse` (gate) + `CommittedSheetState` /
  `GetCommittedStateResponse` (4a read). NO committed field on `BoQSheetDraft`; NO "Committed" in `WizardStatus`.
- **Verification.** tsc 0 new wizard-file errors (filtered `boq-wizard|CommitDialog|SheetCard|BoqHubPage|boqTypes`
  -> empty) + in-container Vite build exit 0. Live-cert on a real committed BoQ pending/at session end (badge +
  date/HH:MM, footer count, modal nothing-ticked, re-commit warning naming the sheet + date/time). Live re-commit
  left to the owner (avoids mutating live committed data). Full detail in root CLAUDE.md + boq-upload-plan.md
  "Phase 5 Slice 4b".

**Minimal touch (2026-06-16 -- Phase 5 Slice 2.5, BACKEND ONLY, feat 49b77635):** The committed BOQ Nodes tier
is now CAPTURE-ONLY -- removed all write-chain money compute (parent `_compute_amounts` +
`_recompute_parent_rates_from_areas`; child `_apply_rate_fallback` + `_compute_child_amounts`) so reviewed values
persist verbatim; `is_rate_only` no longer auto-set (carried from the review row by Slice 3); `read_only` dropped on
the amount fields + is_rate_only; all structural invariants kept; test_boq_nodes 71/71 green (now certifies
capture-only). NO FRONTEND CHANGE. Full detail in root `CLAUDE.md` + `boq-upload-plan.md` "Phase 5 Slice 2.5".

**Minimal touch (2026-06-16 -- Phase 5 Slice 2, BACKEND ONLY, feat b93ec41c):** Added the commit GATE --
`api/boq/wizard/commit_gate.py` with `get_committable_sheets(boq_name)` (READ-ONLY eligibility: general-specs
pointer + Finalized -> committable, separate from parse-eligibility). NO FRONTEND CHANGE this slice; the hub
commit UI (Slice 4) will consume this endpoint later. Recorded here per the DOCS-UPDATE RULE. Full detail in root
`CLAUDE.md` + `boq-upload-plan.md` "Phase 5 Slice 2".

**Minimal touch (2026-06-16 -- Phase 5 Slice 1, BACKEND ONLY, feat 5fe61bff):** Added the committed
general-specs faithful-grid doctype (`BoQ Committed General Specs` istable=0 + child `BoQ Committed General
Specs Row` istable=1; schema + bare-stub controllers + tests only -- NOT the commit pipeline). NO FRONTEND
CHANGE this slice; recorded here per the DOCS-UPDATE RULE. Full detail in root `CLAUDE.md` + `boq-upload-plan.md`
"Phase 5 Slice 1".

**Status (2026-06-14 -- Append-to-notes-as-columns + staleness banner COMPLETE -- BACKEND + FRONTEND, `review_screen.py` + `ReviewTree.tsx` + `SheetReviewPage.tsx`):**
Renders `append_to_notes` data as review-screen columns (additive -- the commit-time notes-fold is untouched;
the same content appearing in-position AND in the combined column is BY DESIGN). TWO column surfaces: (a) each
mapped append-column as its OWN read-only data column in its ORIGINAL Excel position (interleaved by Excel
letter), PLUS (b) ONE combined "Append Notes" column PINNED LAST. PLUS a static always-on staleness banner.
BACKEND (`_build_column_descriptors`): `append_to_notes` REMOVED from `_NON_DISPLAY_ROLES` (now
`{ignore, reference_images}` only -- those two stay excluded) + a new explicit branch emitting one descriptor
per append-column: `value_field="append_notes_raw"`, `area=None`, `rate_subkey=None`, and **`value_key =
sheet_config.column_headers.get(col, col)`** -- NOT bare `col`. THE KEY FACT (Step-0 verify): the parser stores
`append_notes_raw` keyed by `column_headers.get(col_letter, col_letter)` (classifier.py:983) -- header text when
`column_headers` maps the letter, else the bare letter -- so the descriptor's `value_key` must mirror that exact
resolution for the one-hop `resolveDescriptorValue` walk to find the value (on BOQ-26-00166 `column_headers={}`
so keys are letters "Z"/"AB", but the robust impl handles populated headers too). The existing :649 Excel-letter
sort interleaves the in-position columns for free. FRONTEND (`ReviewTree.tsx`): `appendDescriptors =
displayDescriptors.filter(role==="append_to_notes")` (already Excel-sorted) drives the combined column;
`buildAppendCombined(row)` joins each non-empty append value as `"<value_key>: <text>"` (the value_key IS the
header-else-letter prefix the prompt wanted -- already baked in, no separate lookup) with `" | "`, numeric-looking
strings NOT coerced, empty -> blank. Combined column = a hand-written trailing `<th>`/`<td>` AFTER the descriptor
`.map()` (NOT a descriptor -- a sentinel descriptor would fight the :649 sort), shown only when
`hasAppendCombined` (no empty trailing column otherwise), NOT in the column-subset selector, left-aligned +
wrapping. `totalCols` = `7 + visibleDescriptorCount + (hasAppendCombined ? 1 : 0)`. In-position append columns
ride the existing descriptor render path (read-only; naturally exempt from the EDITABLE_* detail-panel blocks).
STALENESS BANNER (`SheetReviewPage.tsx`): a static always-on muted strip (matches the flag/remark strips) after
the teal Finalized banner, before the flag-summary strip -- copy verbatim: "Totals shown are as originally
parsed. Final calculations happen after the BoQ is committed." `boqTypes.ts` UNTOUCHED (`ROLE_LABELS` already had
`append_to_notes: "Append to Notes"`; `ColumnDescriptor` + `append_notes_raw` types already fit). The D2 export
writer (`exportReviewCsv.ts`) was NOT touched (the slice's docs DO correct its stale append-key note). tsc 0 NEW
wizard-file errors (filtered `ReviewTree|boqTypes|boq-wizard|SheetReviewPage` -> empty; 3177 baseline unchanged)
+ in-container Vite build exit 0. Backend test_review_screen 154 -> 158 (+4: append_to_notes now EMITS a
descriptor in Excel position [letter-fallback + header-mapped value_key cases], ignore/reference_images control
still excluded, get_review_rows still ships `append_notes_raw` parsed). **OWNER FLAG: this slice REVERSES the
locked non-display design for `append_to_notes`** -- the PK doc `BoQ_Review_Screen_Locked_Design_v1_0` (NOT in the
repo) needs an owner amendment. Live-cert pending Nitesh: open the review screen on BOQ-26-00166 ("VRF System")
-> append columns Z/AA/AB show in-position read-only, a combined "Append Notes" column is pinned last joining
their values, and the staleness banner shows at the top.

// prior: **Status (2026-06-14 -- Detail-panel edit-field repack COMPLETE -- FRONTEND ONLY, CSS/layout, `ReviewTree.tsx`):**
A layout + width fix to the review-screen ROW DETAIL PANEL's three edit blocks ("Edit values" flat numeric /
"Edit text" unit+make_model / "Edit per-area values"). They laid fields in an EQUAL-WIDTH responsive grid
(`grid-cols-1 sm:2 md:3 lg:4`) that stretched across the panel; after the prior width slice pinned each value
`<Input>` to `w-24`, every narrow input floated at the LEFT of a wide equal column, leaving large inter-field
GAPS (owner screenshot of the per-area block). **TWO changes, applied to ALL THREE blocks** (the three
container strings + the three input strings were each identical -> `replace_all`; the Apply `<Button>` carries
a DISTINCT `h-7 px-2 text-xs shrink-0`, so the input `replace_all` never touched it): (1) value `<Input>`
`w-24` -> `w-36` (96px -> 144px, +50%, owner-confirmed); (2) container `grid grid-cols-1 sm:grid-cols-2
md:grid-cols-3 lg:grid-cols-4 gap-2` -> **`grid grid-cols-[repeat(4,max-content)] gap-2 justify-start`** -- a
FIXED 4-per-row, CONTENT-SIZED, LEFT-PACKED grid: the four fixed-width fields sit close together then wrap to
the next row of 4, with no equal-grid dead space spreading them apart. Used the OWNER-PREFERRED fixed-4
arbitrary-value Tailwind grid template (it compiled fine in the in-container Vite build -- the `flex flex-wrap
gap-2` fallback was NOT needed). `gap-2` kept. The field item stays `flex flex-col gap-1` (label + the
`flex items-center gap-1` Input+Apply row). **UNTOUCHED:** labels, Apply buttons, the Input `h-7 text-xs`
height/text classes (only the `w-` token changed), the shadcn primitive (`components/ui/input.tsx`, app-wide
`w-full`), the main-grid `<td>` cells (`renderDescriptorCell` path), and the Remarks `<Textarea>` (`max-w-md`).
NO logic change. tsc 0 NEW wizard-file errors (filtered `ReviewTree|boqTypes|boq-wizard|SheetConfigPanel` ->
empty, 3177 baseline) + in-container Vite build exit 0 (`built in 7m 39s`, PWA 168 entries). No Frappe unit
tests (CSS/layout-only). Live-cert pending Nitesh: open a row's detail panel -> in each edit block the fields
sit 4-per-row packed close together (not spread edge-to-edge), inputs ~144px wide, content not clipped; if the
4-up packing looks off on a narrow panel the gap or column count is a one-step nudge.

// prior: **Status (2026-06-14 -- Slice 3 (Strand A) single-area config gate COMPLETE -- FRONTEND ONLY, `SheetConfigPanel.tsx`):**
Closes the review-screen `[object Object]` leak at its CONFIG source (prevention layer). ROOT CAUSE (Slice 3 recon):
a per-area role (`qty` per-area route + the six `rate_*_by_area`/`amount_*_by_area` roles -- the
`AREA_COMPATIBLE_ROLES` set) mapped on a SINGLE-area sheet saves `area=null`; `_build_column_descriptors`
(review_screen.py) emits that with `value_key=null`; `resolveDescriptorValue` (ReviewTree.tsx:255) returns the
WHOLE per-area dict; `renderDescriptorCell` (:268) `String(dict)` -> "[object Object]". **THE GATE:** on a
single-area sheet (`!isMulti || activeAreas.length === 0`, the live `perAreaRolesAllowed = isMulti &&
activeAreas.length > 0` -- the SAME state `showAreaDropdown` keys off) the role `<Select>` HIDES the entire
`AREA_COMPATIBLE_ROLES` set; the `SelectGroup` map now computes `visibleRoles = roles.filter(r =>
perAreaRolesAllowed || !AREA_COMPATIBLE_ROLES.has(r.value))` and `return null`s an emptied group (none empty in
practice). `qty_total` + the scalar roles stay offered. **Owner-decided: single-area uses `qty_total`, NOT `qty`**
(qty routes through `qty_by_area`, the prime offender, so it is hidden too). Reactive to the Single/Multi toggle +
area-box edits mid-config (the filter recomputes each render off `perAreaRolesAllowed`). **STRANDED-ROLE = OPTION 3
(flag, do NOT auto-clear):** a new `strandedCols` memo = the set of rows whose role is in `AREA_COMPATIBLE_ROLES`
while single-area (i.e. a row left stranded by a multi->single flip; the existing `useEffect([validAreas])` only
nulls a stale `area`, never the role). Each stranded row is flagged invalid REUSING the EXISTING area-required
pattern: `border-destructive` on the role `<SelectTrigger>` (`cn("w-52", isStranded && "border-destructive")`) +
an inline `text-destructive` message that NAMES the offending role via `ROLE_LABELS[entry.role]` (the role's option
is now hidden, so the trigger shows the placeholder -- the message preserves what to replace). `hasStrandedRoles`
is folded into the EXISTING attestation gate (AND-ed into the `attest-checkbox` `disabled` + label-opacity `cn`,
exactly like `parserRequiredSatisfied`/`hasWorkPackage`), so **Mark as Config Done is BLOCKED** until resolved,
with a `text-destructive` helper line (shown first, unconditional on section state). The role is NEVER silently
cleared/converted -- the user resolves it. **NO new error-display system invented** -- both patterns
(per-row `border-destructive`+message, attestation AND-gate) are pre-existing (V3). Plain "Save config" stays
permissive (existing semantics; a plain-Saved-but-not-Marked sheet stays Pending -> not parse-eligible -> never
reaches review, so blocking the Mark/attestation path is sufficient to keep a stranded mapping out of the
`[object Object]` path). **STRAND B (a render guard in `renderDescriptorCell`) DELIBERATELY NOT DONE** --
`[object Object]` is RETAINED as the visible alarm if A ever leaks (owner decision: a loud failure beats a silent
blank). `ReviewTree.tsx` / backend / parser / role definitions UNTOUCHED. tsc 0 NEW wizard-file errors (filtered
`ReviewTree|boqTypes|boq-wizard|SheetConfigPanel` -> empty, 3177 baseline) + in-container Vite build exit 0
(`built in 4m 24s`, PWA 168 entries). No Frappe unit tests (config panel is frontend-only; wizard convention).
Live-cert pending Nitesh: single-area BOQ-26-00150 (ALORICA) -> NO per-area roles offered (qty NOT offered),
`qty_total` is; multi-area BOQ-26-00166 / -00165-derived -> per-area roles incl. `qty` ARE offered; flip
multi->single after mapping a per-area role -> the stranded row is flagged invalid + Mark blocked (NOT silently
cleared); flip back single->multi -> per-area roles reappear.

// prior: **Status (2026-06-14 -- Detail-panel data-value field width pinned narrow COMPLETE -- FRONTEND ONLY, CSS-only):**
A one-class width fix to the review-screen ROW DETAIL PANEL (`ReviewTree.tsx` ONLY; no backend, no doctype, no
`boqTypes.ts`; root CLAUDE.md not touched -- pure frontend CSS). The three edit blocks' data-value `<Input>`
fields -- "Edit values" (flat numeric qty/rate/amount), "Edit text" (unit / make_model), "Edit per-area values"
(qty/amount/rate by area) -- were flex-filling their responsive grid cell because the shadcn `Input` primitive
(`components/ui/input.tsx`) bakes in `w-full`, so each field stretched far wider than the short numbers/text it
holds. **THE CHANGE:** appended `w-24` (96px, owner-confirmed) to each value Input's `className="h-7 text-xs"`
-> `"h-7 text-xs w-24"`, on ALL THREE `<Input>` sites (the three identical strings were a `replace_all`; the
`Apply` buttons use a DISTINCT `"h-7 px-2 text-xs shrink-0"` string and were NOT touched). `w-24` overrides the
inherited `w-full` flex-fill and pins the field; the `Apply` button is already `shrink-0` and the field item is
`flex flex-col`, so the pinned input simply left-aligns in its cell -- no layout fight. **HARD BOUNDARIES kept:**
the shadcn primitive `input.tsx` is UNTOUCHED (the app-wide `w-full` default stays -- width added ONLY at the
three call sites); the main-grid data cells (`renderDescriptorCell` / the `<td>` render path -- a separate path)
and the Remarks `<Textarea>` (`max-w-md`) + the read-only classification/parent display are unaffected; NO
grid-column-count / Apply-button / label / logic change. tsc 0 NEW wizard-file errors (filtered
`ReviewTree|boqTypes|boq-wizard|SheetConfigPanel` -> empty) + in-container Vite build exit 0 (`built in 4m 35s`,
PWA 168 entries). No Frappe unit tests (CSS-only). Live-cert pending Nitesh: open a row's detail panel -> the
value input fields are narrow + fixed (~96px), do NOT stretch to fill the panel, and do NOT clip their content
(check a long per-area amount). If too wide/narrow it is a one-step Tailwind nudge (`w-20`=80px / `w-28`=112px).

// prior: **Status (2026-06-14 -- Field-set rationalisation Slice 2b -- per-area amount EDIT path made NESTED COMPLETE -- BACKEND (+ frontend comment), feat ad99ebf7):**
The second half of the amount field-set work. Slice 2a shipped per-area amount STORED nested
`{area: {supply, install, total}}` on the read path but left the EDIT path FLAT, so a per-area amount edit
CORRUPTED data (the backend discarded the subkey and did a flat one-hop write, clobbering the area's whole
nested dict). 2b makes the amount edit path NESTED two-hop, mirroring rate. **This is a NEAR-PURE BACKEND
change (`review_screen.py`); the FRONTEND change is COMMENT-ONLY.** The reason: the frontend per-area edit path
is ALREADY generic over the descriptor -- `editableAreaDescriptors` includes amount, `openAreaConfirm`/
`confirmValueSave` forward `d.area` + `d.rate_subkey` (and for amount the descriptor's `rate_subkey` already
carries the amount kind supply/install/total -- 2a's generic-third-hop decision), the seed loop +
`resolveDescriptorValue` already walk the nested value. So `EDITABLE_AREA_FIELDS`, the edit cell, the handlers,
the payload, and the value walk are ALL UNCHANGED. The ONLY frontend edit is the stale `ReviewTree.tsx:~300`
comment (`EDITABLE_AREA_FIELDS`), corrected to state amount is nested two-hop (the inner kind rides the generic
`rate_subkey` slot). BACKEND (root CLAUDE.md has full detail): `amount_by_area` moved into `_NESTED_AREA_FIELDS`;
the write does a two-hop `amount_by_area[area][kind]` set that leaves the area's other kinds + other areas intact;
validation requires + validates an amount subkey against `_LEGAL_AMOUNT_SUBKEYS` = {supply, install, total}.
**DECISIONS (owner-locked): C2/C3 = Option A** -- reuse the generic `rate_subkey` plumbing + edit-log key for
amount (NO `amount_subkey`, NO new descriptor hop, NO frontend remap); accepted Phase-4 naming debt. **C4 =
accept staleness** -- the row scalar `amount_total` is NOT recomputed after a per-area edit (matches rate;
calculations live in the future tendering module). The staleness USER-MESSAGE banner is a DEFERRED separate
frontend slice (NOT here). The provenance "Edit history" panel renders `(entry.area / entry.rate_subkey)`
generically, so an amount edit shows "(Zone A / total)" with NO render change; `EditLogEntry` type UNCHANGED.
tsc 0 NEW wizard-file errors (comment-only change; filtered `ReviewTree|boqTypes|boq-wizard|SheetConfigPanel`
-> empty, 3177 baseline) + in-container Vite build exit 0 (`Done in 377.99s`, PWA 168 entries). No Frappe unit
tests on the frontend; backend test_review_screen 152 -> 154 (the B2 anti-corruption proof
`test_amount_by_area_sets_one_subkey_others_intact` + 2 reject tests), parser 597 / test_parse_run 86 /
test_update_sheet_draft 82 unchanged. Live-cert pending Nitesh: on a multi-area row (BOQ-26-00166 or the
-00165-derived sheet) edit a per-area SUPPLY (or INSTALL) amount -> ONLY that kind+area changes, the area's
other kinds + the other areas are intact, value persists on reload; the row's scalar total does NOT recompute
(EXPECTED accepted staleness, NOT a bug). KNOWN DEBT: `rate_subkey` naming misnomer (Phase-4) + accepted total
staleness (banner = later slice). Job-7 note still applies for sheets whose config predates the 2a rename.

// prior: **Status (2026-06-13 -- Field-set rationalisation Slice 2a -- amount per-area SYMMETRIC with rate (READ path) COMPLETE -- BACKEND + FRONTEND, feat 33ec8361):**
Made AMOUNT symmetric with RATE on the per-area READ path (extraction + storage + DISPLAY). The per-area
amount EDIT path is Slice 2b and was NOT touched -- `EDITABLE_AREA_FIELDS` (`ReviewTree.tsx:304`) still lists
the storage field `amount_by_area` and the per-area edit gating is unchanged; `resolveDescriptorValue` is
already generic so it renders the nested amounts with NO change. FRONTEND edits (`boqTypes.ts` +
`SheetConfigPanel.tsx` ONLY): `ROLE_LABELS` drops `amount_combined`, drops the single `amount_by_area` label,
and ADDS `amount_supply_by_area` / `amount_install_by_area` / `amount_total_by_area` ("Amount Supply/Install/
Total (per area)"); `SheetConfigPanel` `ROLES_BY_GROUP` Amount group, `AREA_COMPATIBLE_ROLES`,
`AREA_REQUIRED_ROLES`, `SINGLETON_ROLES`, the `ROLE_HELP_TEXT` map (drops `amount_combined`, re-points
`amount_total` help to "also use for SITC/S&I/Combined headers"), and the Layer-2 `_AMOUNT_ROLES` set are all
updated to the three new roles + `amount_combined` removal. NEW `AmountByAreaCell` type (`{supply?, install?,
total?}` -- mirrors `RateByAreaCell`); `ReviewRow.amount_by_area` retyped `Record<string, AmountByAreaCell>`
(the STORAGE FIELD name is kept -- only the ROLE was renamed, the exact analog of rate's `rate_by_area` field
vs `rate_*_by_area` roles). The descriptor for a per-area amount role carries `value_field:"amount_by_area"`,
`value_key:area`, and reuses the generic `rate_subkey` third-hop to carry the amount kind ("supply"/"install"/
"total") -- so the same `resolveDescriptorValue` walk renders amounts and rates identically (BACKEND
`review_screen._build_column_descriptors` made generic via `_AMOUNT_ROLE_TO_KIND` -- see root CLAUDE.md).
tsc 0 NEW wizard-file errors (filtered `ReviewTree|boqTypes|boq-wizard|SheetConfigPanel` -> empty; 3177
baseline unchanged) + in-container Vite build exit 0 (`built in 6m 14s`, PWA 168 entries). No Frappe unit
tests on the frontend; backend parser 589->597, wizard suites unchanged (152 / 86 / 82) green. Live-cert
pending Nitesh: parse a multi-area workbook with per-area SUPPLY + INSTALL + TOTAL amount columns; confirm
each renders in its own review-screen column with correct numbers and the derived row total is correct.
**Job-7 note (cert checklist):** after this change, re-SAVE a sheet's config through the WIZARD (not just
re-parse) to clear any old `amount_by_area`-role token from a stored config blob -- a re-parse alone does NOT
rewrite the config, and a stale role token silently drops the sheet from the parse (logged warning, no visible
failure).

// prior: **Status (2026-06-13 -- Field-set rationalisation Slice 1 / Finding 1 -- scalar amount roles NOT area-compatible COMPLETE -- BACKEND + FRONTEND, feat 83985079):**
Removed `amount_supply` / `amount_install` / `amount_total` from `AREA_COMPATIBLE_ROLES` in
`SheetConfigPanel.tsx:128` (the matching backend `_AREA_COMPATIBLE_ROLES` in `boq_parser/config.py` was
trimmed the same way -- see root CLAUDE.md). FRONTEND EFFECT: on a multi-area sheet the Section-3 area
sub-selector no longer appears for these three roles -- the gate at `SheetConfigPanel.tsx:1099`
(`AREA_COMPATIBLE_ROLES.has(entry.role) && isMulti && activeAreas.length > 0`) is the SINGLE source of the
dropdown's visibility, so removing them from the Set is SUFFICIENT (no other code path renders an area control
for these roles). The serialization sites (`:599` `changeRole` + `:655` `handleSave`) already force `area:null`
for non-area-compatible roles, so any stale area on these roles is cleaned on next save (harmless -- the
descriptor builder ignored it anyway). PURE SUBTRACTION -- `qty` + the genuine `*_by_area` roles stay
area-compatible; no other UI/behaviour change. tsc 0 new wizard-file errors (3177 baseline unchanged); no Vite
build run (a 3-string runtime Set subtraction cannot affect bundling). No frontend live-cert blocker -- the
one owner check is below. Backend tests: parser 588->589 (new `test_scalar_amount_roles_reject_area`); wizard
suites unchanged. Manual check (owner): on a multi-area sheet, mapping a column to Amount (Supply/Install/Total)
shows NO area dropdown, while Qty and the per-area roles still do.

// prior: **Status (2026-06-13 -- Slice A2 edit-log clarity pass COMPLETE -- FRONTEND ONLY, render-time, feat cefaf3c0):**
Three render-time improvements to ReviewTree's edit-history block (`ReviewTree.tsx` ONLY; the stored `edit_log`
shape is UNCHANGED -- NO backend, NO doctype, NO migration; root CLAUDE.md deliberately NOT touched this slice).
(1) **Excel-row parents:** a `human_parent` entry's `from`/`to` (stored as INTERNAL `row_index`) now render as
Excel/source row numbers via the SAME component-scoped `byIdx` map the Parent column uses (`byIdx.get(n)?.
source_row_number`); root/cleared -> `root` (matching the detail panel's own `origParentLabel`/`effParentLabel`
copy, since the Parent COLUMN renders blank for root -- not usable in a `from -> to` phrase); an index not in the
current set -> raw-number fallback (no crash). (2) **Honest verb** (from `entry.field`): `human_classification`
with `from !== to` -> "Reclassified" (+ from->to via `CLS_LABELS`); `human_parent` -> "Moved parent";
value/text/per-area -> "Edited" (field name + the existing area/rate_subkey suffix retained, raw from->to
unchanged). **The #162 no-op same-value reclassify** (`human_classification`, `from === to`, written by the
standalone Change-parent door alongside the real `human_parent` move) is **SUPPRESSED** -- `describeEditEntry`
returns null and a type-guarded `.filter` drops it before the `.map`, so it never produces an `<li>` (the
"No edits yet." fallback reflects the post-suppression list). (3) **Timestamp** `YYYY-MM-DD HH:MM` via a
module-level `formatEditAt` string slice (`at.slice(0,16)`; no date library, no TZ reparse). New helpers:
module-level `formatEditAt` + `DescribedEditEntry` interface; in-component `editParentLabel` + `describeEditEntry`
(close over `byIdx`). `EditLogEntry` added to the existing type import (boqTypes.ts UNTOUCHED -- the type already
exists + is exported). tsc 0 NEW wizard errors (3177 baseline unchanged) + in-container build exit 0 (`built in
4m 50s`, PWA 168 entries). Live-cert LC1-LC7 pending Nitesh (LC1 parent-move Excel rows match the Parent column;
LC2 real reclassify labels; LC3 #162 entry suppressed/reads as the move only; LC4 move-to-root reads `root`;
LC5 value/text/per-area raw from->to unchanged; LC6 timestamps no seconds/micros; LC7 old entries don't crash).
See the "Slice A2 edit-log clarity conventions" section below.

// prior: **Status (2026-06-13 -- Slice A1 status rename + Finalized config-freeze (un-mark-and-edit) COMPLETE -- BACKEND + FRONTEND + DATA MIGRATION, feat 6001e36e):**
The `wizard_status` values **"Reviewed" -> "Config Done"** and **"Parsed Check Done" -> "Finalized"** (compared
LITERALLY everywhere, so the rename was coverage-critical -- a zero-hit grep gate proved 100% coverage).
FRONTEND rename sites: `boqTypes.ts` `WizardStatus` union; `SheetCard.tsx` `STATUS_PILL` keys + labels ("Config
Done"/"Finalized") + all effectiveStatus branches/canReparse/dirty-badge; `BoqHubPage.tsx` every
getEffectiveStatus comparison + the hub footer label **"Export reviewed" -> "Export Finalized"**;
`SheetReviewPage.tsx` `isChecked` + the "Mark Finalized" button + teal banner copy; `ParseRunDialog.tsx` the two
`wizard_status === "Finalized"` comparisons + copy; `SheetConfigPanel.tsx` the `statusAtOpenRef` compare + the
`set_sheet_status("Config Done")` write; `ExportWorkbookDialog.tsx` copy. **Identifiers carrying the old name
were renamed for a zero-justification grep** (`newlyDesignatedReviewed`->`newlyDesignatedConfigDone`,
`pendingReviewedNames`->`pendingConfigDoneNames`, `dropIfReviewed`->`dropIfConfigDone`, `handleMarkReviewed`->
`handleMarkConfigDone`). **NEW Finalized config-freeze + un-mark-and-edit (SheetConfigPanel):** when
`wizardStatus === "Finalized"`, a TEAL ShieldCheck banner + an "Un-mark and edit" button -> a confirm
`AlertDialog` -> the EXISTING `unmark_sheet_parsed_check_done` endpoint (function name unchanged; sets status
back to "Parsed") -> `onSaveSuccess()` re-fetch unlocks the panel; the whole form is wrapped in `<fieldset
disabled={isParsing || finalized}>` so ONE flag locks Sections 1-4 + Save + Mark; **banner precedence: parsing
amber beats finalized teal**; the un-mark AlertDialog is rendered OUTSIDE the fieldset (portals to body).
`SheetCard.tsx` Finalized branch gains an **"Edit config" -> spoke** button so the un-mark affordance is
reachable without URL surgery. BACKEND backstop: `_guard_sheet_not_finalized` rejects config writes to a
Finalized sheet (supersedes the old dirty-marker asymmetry); see root CLAUDE.md. `SheetSpokePage.tsx` already
passes `wizardStatus` + `isParsing` (A3) -- unchanged this slice. `ReviewTree.tsx` OUT OF SCOPE (its `readOnly`
gating already freezes the tree; its "Reviewed -- looks OK" flag-dismissal text is NOT a status -- left as-is).
tsc 0 wizard-file errors (3177 baseline) + in-container build exit 0 (`✓ built in 9m 17s`, PWA 168 entries).
Live-cert pending Nitesh. See the "Slice A1 status-rename + Finalized config-freeze conventions" section below.

// prior: **Status (2026-06-13 -- §9 #164 Slice A3-frontend parse-lock UI + check_parse_status wiring + SheetConfigPanel getFrappeError migration COMPLETE -- FRONTEND ONLY, feat 6be90efd):**
The frontend half of the parse-lifecycle lock (backend floor: feat 004f80a8). While a sheet is under active
parse/re-parse (`BoQ Sheet Draft.parse_in_progress === 1`, which rides the `useFrappeGetDoc("BOQs")` payload),
its hub card actions are disabled + show a "Parsing..." indicator, its spoke config panel is fully locked,
and its review screen is read-only -- all surfaced via amber banners. Files: `boqTypes.ts` (+`parse_in_progress
?: 0|1` on `BoQSheetDraft`; `BOQsDoc.parse_in_progress` already existed), `SheetCard.tsx` (`isParsing =
draft.parse_in_progress === 1`; the four PARSE-ADMISSIBLE branches -- Reviewed/Parsed/Parsed Check Done/**Parse
failed** [v5.46: Parse-failed IS force-re-parse eligible so it can be superset-marked] -- get
`disabled={isSaving || isParsing}` on every action + a Loader2 "Parsing..." chip by the pill; Pending/Skip/
Hidden/General-specs untouched -- never parse-marked), `SheetReviewPage.tsx` (the existing draft lookup now
also yields `isParsing`; `readOnly={isChecked || isParsing}` on `ReviewTree`; an AMBER parsing banner that
TAKES PRECEDENCE over the D1 teal checked banner -- teal gated to `isChecked && !isParsing`), `SheetSpokePage.
tsx` (derives `isSheetParsing` from the same `:58` draft lookup -> new `isParsing` prop to SheetConfigPanel),
`SheetConfigPanel.tsx` (new `isParsing?: boolean`; an amber lock banner + the WHOLE form wrapped in a native
`<fieldset disabled={isParsing}>` -- cascades to every shadcn button/input/Radix-select trigger, one flag
locks Sections 1-4 + Save + Mark-as-reviewed; `dropIfReviewed` early-returns when `isParsing`), `BoqHubPage.
tsx` (a one-shot imperative `check_parse_status` call via `useFrappePostCall` in a `useEffect([boqId])` mount
effect -> on `cleared`/`cleared_stale` `void mutate()` so the existing `useEffect([boq])` recovery re-reads the
healed flags; `running`/`idle` no-op; failures are `console.error`-only/non-fatal). **§9 #161 getFrappeError
migration:** SheetConfigPanel now imports `getFrappeError` -- `handleSave` + `handleMarkReviewed`'s outer
catches use `getFrappeError(e) || "<fallback>"`, the two inner work-package/status catches append
`${getFrappeError(e)}` to their static strings, and `dropIfReviewed`'s `callSetStatus` gains a `.catch` routing
into `setSaveError` (no longer swallowed) -- so a STALE-tab mid-parse config write now surfaces the REAL backend
message ("This sheet is being parsed..."). No backend/Python touched; `ReviewTree.tsx` untouched (its `readOnly`
gating already covers the freeze). tsc 0 new wizard-file errors + in-container build exit 0 (`✓ built in 3m
46s`, PWA 168 entries). Manual live-cert LC1-LC7 pending Nitesh. STALE-PATH NOTE: the build brief listed
`frontend/src/types/boqTypes.ts` but the real file is `frontend/src/pages/boq-wizard/boqTypes.ts`. See the
"§9 #164 A3-frontend parse-lock conventions" section below for full detail.

// prior: **Status (2026-06-12 -- Slice D2b hub XLSX workbook export + per-card CSV export COMPLETE -- FRONTEND + dep, feat 91bf255d):**
Two hub export entry points: a GLOBAL multi-sheet .xlsx workbook (footer "Export reviewed" button -> a selection
modal of every "Parsed Check Done" sheet, all pre-ticked -> ONE .xlsx, one tab per sheet) and a PER-CARD
single-sheet .csv (the EXISTING D2 writer, on each "Parsed Check Done" SheetCard). The global path fetches each
ticked sheet's rows SEQUENTIALLY via `get_review_rows` and ABORTS the whole export on any single fetch failure
(no partial file, the failed sheet named inline). NEW dep `exceljs`, DYNAMICALLY imported -> its own lazy chunk
(942 kB, absent from the hub + entry chunks); npm `xlsx` FORBIDDEN (abandoned, two unpatched high-severity CVEs).
The D2 CSV writer is refactored to share a `buildReviewSheet` core (typed cells) with the xlsx writer -- the .csv
output stays BYTE-IDENTICAL. Excel tab names sanitized + de-duplicated (tab title ONLY; the Sheet Name column
stays verbatim #152). Files (frontend): NEW `exportReviewXlsx.ts` + `ExportWorkbookDialog.tsx`; `exportReviewCsv.ts`
(builder extraction), `BoqHubPage.tsx` (global button + wiring + per-card handler), `SheetCard.tsx` (per-card
button + `onExportCsv` prop); `package.json`/`yarn.lock` (exceljs). `SheetReviewPage.tsx` UNTOUCHED (its D2 button
rides the refactored writer -- signature unchanged); `boqTypes.ts` NOT needed. tsc 0 new wizard-file errors
(baseline 3177 unchanged) + in-container build exit 0 (`✓ built in 6m 54s`, PWA 168 entries; exceljs in its own
lazy chunk). Live-cert LC1-LC8 pending Nitesh. See the "Slice D2b hub export conventions" section below for full detail.

// prior: **Status (2026-06-12 -- Slice D2 per-sheet review CSV export COMPLETE -- FRONTEND ONLY, feat 27866a2e):**
A per-sheet CSV export of the review screen's data (parsed values + human corrections + provenance, flat
columns, opens clean in Excel). NEW wizard-local writer `exportReviewCsv.ts`; an "Export CSV" button in the
header right cluster, STATUS-INDEPENDENT (a frozen/checked sheet exports too) and VIEW-INDEPENDENT
(filters/collapse/search never affect it). Per-area = one column per area per role (mirrors the tree's
descriptor columns); numbers RAW (Excel parses them); UTF-8 BOM (rupee/unicode). The shared
`src/utils/exportToCsv.ts` is NOT used or touched. Files touched (frontend): NEW `exportReviewCsv.ts`,
`SheetReviewPage.tsx` (Export button + wiring), `ReviewTree.tsx` (export keyword on `resolveDescriptorValue`/
`computeDepths`/`CLS_LABELS`/`FIXED_ROLE_DEDUPE` -- no behaviour change). `boqTypes.ts` NOT needed (consumed
types already exported). tsc 0 new wizard-file errors (filtered, empty) + in-container build exit 0
(`✓ built in 5m 47s`, PWA 166 entries); no Frappe unit tests (frontend-only). Manual live-cert LC1-LC7
pending Nitesh. See the "Slice D2 review CSV export conventions" section below for the full as-built detail.

// prior: **Status (2026-06-11 -- Slice D1 "Parsed Check Done" marking + read-only FREEZE + Un-mark COMPLETE -- BACKEND + FRONTEND):**
A sheet at "Parsed Check Done" is FROZEN: no value/text/area edits, no restructure, no remarks, no flag
dismissals -- enforced BACKEND (a `_guard_sheet_not_frozen` check in all four write endpoints) AND FRONTEND.
Files touched (frontend): `boqTypes.ts` (+`MarkParsedCheckDoneResponse` / `UnmarkParsedCheckDoneResponse`,
reusing the existing `StructuralBreak`), `SheetReviewPage.tsx` (status derivation from `boq.sheet_drafts`,
`boqMutate`, the "Mark Parsed Check Done" header button + light-confirm/breaks-escalation AlertDialog, the teal
read-only banner with Un-mark + Go-to-hub, `readOnly={isChecked}` passed down), `ReviewTree.tsx` (the new
`readOnly?: boolean` prop gating ALL 11 write affordances). tsc 0 new wizard-file errors (baseline 3177
unchanged) + in-container build exit 0 (`✓ built in 3m 36s`, PWA 166 entries); no Frappe unit tests on the
frontend (backend has +10 -> test_review_screen 147 green). Manual live-cert LC1-LC8 pending Nitesh. See the
"Slice D1 Parsed Check Done freeze conventions" section below for the full as-built detail.

// prior: **Status (2026-06-11 -- C-flag-dismissal [per-row "Looks OK"] COMPLETE -- BACKEND + FRONTEND):**
A per-row dismissal of advisory flags on the review screen. PER-ROW (one gesture clears ALL of a row's
currently-computing flags); STAYS "Original" (a dismissal is an ACKNOWLEDGMENT, not an edit -- it does NOT
touch `isEdited`, the Edited pill, or the green tint). Files touched (frontend): `boqTypes.ts` (ReviewRow
gains `flags_dismissed?` / `_by?` / `_at?`, additive), `ReviewTree.tsx` (the "Looks OK" button + dismissed
marker), `SheetReviewPage.tsx` (the "N -- C cleared" summary strip). Backend: new `dismiss_row_flags`
endpoint + 3 `BoQ Review Row` fields + chokepoint clear-on-edit (see root CLAUDE.md). tsc 0 new wizard-file
errors (baseline 3177 unchanged) + in-container build exit 0 (`✓ built in 6m 46s`, PWA 166 entries); no
Frappe unit tests on the frontend (backend has TestDismissRowFlags +6 -> 137 green). Manual live-cert
LC1-LC6 pending Nitesh. See the "C-flag-dismissal conventions" section below for the full as-built detail.

// prior: **Status (2026-06-11 -- §9 #159 ReviewTree find & filter COMPLETE):**
A FILTER surface + a SEARCH surface on the main review tree (`ReviewTree.tsx` ONLY; FRONTEND ONLY -- no
backend, no doctype, no `boqTypes.ts`, no `SheetSearchView` edit/import, no `SheetReviewPage`). FILTER
(finding-6): a Status filter (Edited/Original/All) + a Classification filter (6-value `CLS_LABELS`
checklist) in column-header `Popover`s, AND-combined, STRICT-HIDE (a new `if (!passesFilter(row)) return
null;` gate joins the existing `isVisible`/`classificationVisible` gates). SEARCH (finding-8):
description-only case-insensitive search in the controls bar with two-tier blue RING highlight (soft = all
hits, strong = current hit -- box-shadow, NOT backgrounds, so they never mask the edited-green/preamble
tints) + prev/next modulo cycling that reuses the existing `revealAndScrollToRow` for auto-expand + an
`N of M` counter. COMPOSE: `searchHits` is computed over the SAME shown-predicate the render gate uses
(`classificationVisible + passesFilter`) so a hit is never a filtered-out row. tsc 0 new wizard-file errors
(baseline 3177 unchanged) + in-container build exit 0 (`✓ built in 10m 54s`); no Frappe unit tests
(frontend-only); manual live-cert LC1-LC7 pending Nitesh. See the "§9 #159 ReviewTree find-&-filter
conventions" section below for the full as-built detail.

// prior: **Status (2026-06-11 -- ReviewTree detail-panel layout pass COMPLETE):**
Three cosmetic/layout fixes to the inline detail panel in `ReviewTree.tsx` ONLY (FRONTEND ONLY; pure
CSS/className -- no logic, no state, no handler, no gate, no backend, no doctype, no `boqTypes.ts`).
**FINDING B (visual separation):** the panel's inner content `<div>` (inside the `<td colSpan={totalCols}>`)
gains `bg-indigo-50/40 dark:bg-indigo-950/20 border border-border border-l-4 border-l-primary rounded-md
shadow-sm p-3` so it reads as a DISTINCT nested card -- the root cause was that its old `bg-muted/30`
background is the EXACT tint a normal row uses on hover (`hover:bg-muted/30`), so it blended into the row
stack; a distinct INDIGO body tint (NOT the hover tint) + border + radius + shadow + own padding (inset
inside the cell's `px-3 py-3`) + a BRAND-RED left-accent stripe (`border-l-primary` = the rose/crimson
`--primary` token, hue 346.8, DISTINCT from `--destructive`'s pure-red hue 0; an ACCENT not a full surface,
to avoid colliding with the destructive/error red on this screen) is the differentiator.
The `<tr className="bg-muted/30">` + `<td colSpan>` structure is UNCHANGED (colSpan/totalCols untouched).
**OBS 1 (Parent below Classification):** the Classification/Parent grid `grid grid-cols-2 gap-x-4 gap-y-1`
becomes `grid grid-cols-1 gap-y-1` -- a VERTICAL STACK (Classification row, then the Parent + §9 #162
"Change parent" row below it), so Parent is no longer pushed off-screen-right on a wide sheet. The two
flex cells' internal content (labels, "Change ▾" dropdown, "Change parent" button) is UNCHANGED.
**OBS 2 (editable fields ~4-per-row, option A per-block):** EACH of the three edit-block containers
(numeric "Edit values" / text "Edit text" / per-area "Edit per-area values") converts from
`flex flex-wrap gap-2` to `grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2` (caps at
~4 wide on lg, fewer when narrow -- no heavy horizontal spread); the field items DROP `w-52` (the grid
column governs width now -- a fixed width would block cell-fill / overflow a narrow column). The three
blocks stay SEPARATE (different save paths); they are NOT merged. The Remarks block (`max-w-md` Textarea)
is UNTOUCHED. tsc 0 new wizard-file errors (baseline 3177 unchanged) + in-container build exit 0; no Frappe
unit tests (frontend slice, pure CSS); manual live-cert LC1-LC5 pending Nitesh. See the "ReviewTree
detail-panel layout pass conventions" section below for detail.

// prior: **Status (2026-06-11 -- §9 #158 RestructureModal polish pair COMPLETE):**
Two cosmetic/ergonomic fixes to `RestructureModal.tsx` ONLY (FRONTEND ONLY; no backend, no doctype, no
`SheetSearchView` edit, no `dialog.tsx` edit). **Finding-2:** accidental outside-click dismiss DISABLED via
`onInteractOutside={(e) => e.preventDefault()}` added directly to `<DialogContent>` (the shadcn primitive
spreads `{...props}` to `DialogPrimitive.Content`, so the Radix prop passes modal-side with no `dialog.tsx`
edit); `onInteractOutside` chosen over `onPointerDownOutside` to cover BOTH outside pointer-down AND outside
focus. `onOpenChange` is UNTOUCHED so ESC + Cancel + Save + the close-X all still close. **Finding-7:** the
"Set as parent" / "Top level" / "Cancel pick" button row is relocated VERBATIM to ABOVE the `<SheetSearchView>`
mount in all THREE picker sites (row-position move, option-3 one-new-parent, option-4 per-child), so the pick
action is reachable without scrolling past the tall wrapping grid; handlers/labels/disabled-logic/wiring
unchanged. **REFRAME recorded:** the literal "align inside the search-bar row" was recon-proven unreachable
without editing `SheetSearchView` (its search bar is internally enclosed, no slot/render-prop), so Path 1
(above-the-picker) was chosen modal-side; do NOT re-chase the in-search-bar idea. tsc 0 new wizard-file errors
(baseline 3177 unchanged) + in-container build exit 0; no Frappe unit tests (frontend slice; modal + backend
already certified); manual live-cert LC1-LC5 pending Nitesh. See the "§9 #158 RestructureModal polish
conventions" section below for detail.

// prior: **Status (2026-06-11 -- §9 #162 standalone "Change parent" door COMPLETE):**
A SECOND front door to the EXISTING `RestructureModal`, reached WITHOUT a reclassification (FRONTEND ONLY,
`ReviewTree.tsx` only). The row-detail panel's PARENT cell gains a "Change parent" button mirroring the
CLASSIFICATION cell's "Change ▾" reclassify control; it opens the modal via
`setRestructureModal({ row, newClassification: row.effective_classification })` -- a NO-OP reclassify (current
class passed as the target). The modal does everything else unchanged: a CHILDLESS row opens position-only;
a WITH-children row STILL surfaces the five child-placement options (the `children.length > 0` gate is
untouched -- no silent reparent; the children's fate stays explicit) plus the batch cycle-guard. The button
is HIDDEN on `subtotal_marker` / `header_repeat` (not in `_ASSIGNABLE_CLASSIFICATIONS` -- a no-op reclassify
there would be backend-rejected). edit_log fidelity VERIFIED with NO backend change: the parent move already
emits its own `human_parent` edit_log entry via `_apply_and_save_row_edit` (the B2 conditional + chokepoint
STOP-gate were never triggered). tsc 0 new wizard-file errors (baseline 3177 unchanged) + in-container build
exit 0; no Frappe unit tests (frontend slice; reused modal + backend already certified); manual live-cert
LC1-LC6 pending Nitesh. See the "§9 #162 standalone Change-parent door conventions" section below for detail.

// prior: **Status (2026-06-11 -- Force Re-parse FRONTEND slice COMPLETE):**
The Force Re-parse FRONTEND slice (FRONTEND ONLY) builds the UI that sets `force_reparse: true` on the
already-certified backend floor (feat 95928637). TWO entry points (per-card "Re-parse" + a global "Re-parse"
button beside Parse) open the SAME `ParseRunDialog` in a new `mode="reparse"`, which makes "Parsed Check Done"
sheets visible + tickable (they were invisible in all four dialog lists before) and shows a rewritten,
re-targeted destructive warning. Re-parse eligibility = `has_prior_parse === 1` AND effective status in
{Parsed, Parsed Check Done, Reviewed}; **"Parse failed" is DELIBERATELY EXCLUDED** (the backend floor does not
widen `force_reparse` to it -- offering it would no-op). Files: `SheetCard.tsx`, `ParseRunDialog.tsx`,
`BoqHubPage.tsx` (no backend, no doctype JSON, no `boqTypes.ts`). tsc 0 new wizard-file errors + in-container
build exit 0; no Frappe unit tests (frontend slice); manual live-cert LC1-LC7 (DESTRUCTIVE) pending Nitesh.
See the "Force Re-parse FRONTEND slice conventions" section below for the full as-built detail.

// prior: **Status (2026-06-11 -- Restructure Slice 1b-beta2b COMPLETE):**
Slice 1b-beta2b (feat 20e1f5a7, FRONTEND ONLY) closes the restructure-flow completeness gaps -- two
deliverables. D1 (finding-10): the broken inline error-extraction ladder is replaced by the house helper
`getFrappeError()` in FIVE catch blocks (RestructureModal.handleSave + ReviewTree confirmChildlessReclassify
/ confirmValueSave / saveTextField / saveRemark). Root cause: the SDK rejects with a plain object whose
`.message` is a hardcoded generic; the real `frappe.throw` text travels in `_server_messages` (double-encoded
JSON). `getFrappeError` decodes it, so backend throws (e.g. the cycle explanation) now reach the user.
D2 (finding-9): the row-position choice is now ALSO offered on the CHILDLESS reclassify path. tsc 0 errors
in both touched files (baseline 3177 unchanged) + build exit 0; no Frappe unit tests (UI slice); manual
live-cert LC-i..LC-vii pending Nitesh. LC10's UI-surfacing half closes at LC-i. Backend UNTOUCHED. See the
"Restructure surface Slice 1b-beta2b conventions" section below for the full as-built detail.

// prior: **Status (2026-06-11 -- Restructure Slice 1b-beta2 COMPLETE):**
Slice 1b-beta2 (feat 1ed9d3b7, BACKEND + FRONTEND) lets the restructure flow place the RECLASSIFIED ROW
ITSELF, not just its children. FRONTEND: `RestructureModal` gains a "This row's position" control with two
options -- (1) "Keep current position" (DEFAULT, pre-selected; sends NO `row_new_parent` -> backwards-compat
shape) and (2) "Move this row under a new parent", which reveals the SAME `SheetSearchView` mount + the SAME
`hitRowIndex` (`currentHit` -> `rows.find(source_row_number === hit.row_number)`) resolution + the SAME
no-match guard the child pickers use, PLUS a "Top level" button (sends -1). Save is gated until a chosen
"move" is resolved (`rowParentIdx !== null`). The childless LIGHT path (the `ReviewTree` AlertDialog) is
UNTOUCHED. A backend cycle throw caused by the row's own move (e.g. moving it under its own child) surfaces
inline exactly like a child-move error; modal stays open; nothing written. tsc 0 errors in RestructureModal
(baseline 3177 unchanged) + build exit 0; no Frappe unit tests (UI slice); manual live-cert STAGE A
(backwards-compat) / STAGE B (the new capability) / STAGE C (LC-5 = the guard, closing LC10's UI-surfacing
half) pending Nitesh. See the "Restructure surface Slice 1b-beta2 conventions" section below for the full
as-built detail. BACKEND detail (the `row_new_parent` param + cycle-guard start-point extension + T1/T2/T7
guards) in root CLAUDE.md + boq-upload-plan.md.

// prior: **Status (2026-06-10 -- SheetSearchView v2 COMPLETE):**
SheetSearchView v2 (feat fc7147db) re-certifies the 1a-certified `SheetSearchView` with THREE bundled
changes (per the slice-composition framework, so the component re-certs ONCE): (1) FETCH SWAP -- the
windowed `get_sheet_preview` 200-row loop is REPLACED by a single `get_sheet_preview_full` call (feat
196ed765); the perf OWED item is now WIRED (live perf proof in the v2 live-cert). (2) COLUMN RESTYLE --
`table-fixed`, Description `w-[360px]` / others `w-[120px]` on header + data cells, cells wrap
(`whitespace-normal break-words`). (3) CLICK-TO-SELECT -- new optional `onRowClick` + `selectedRowNumber`
props; the modal reuses its existing row_number->row_index resolution + no-match guard (click-sets-hit).
New additive `SheetPreviewFullResponse` type; `SheetPreviewResponse` + `get_sheet_preview` untouched.
tsc 0 errors in the 3 touched files (baseline 3177 unchanged) + build exit 0; no Frappe unit tests (UI
slice); manual v2 live-cert (STAGE 1 fetch swap / STAGE 2 columns / STAGE 3 click-to-select) pending
Nitesh. SheetSearchView is now RE-CERTIFIED by the v2 live-cert (supersedes the 1a-only cert). See the
"SheetSearchView v2 conventions" section below for the full as-built detail. The restructure-surface arc
+ the full-sheet-read OWED item are both COMPLETE.

// prior: **Status (2026-06-09 -- Restructure Slice 1b-beta FRONTEND COMPLETE):**
Slice 1b-beta (feat e8eeab58) builds the restructure MODAL -- the FRONTEND consumer of the
live-certified `save_review_restructure` backend. tsc 0 errors in touched wizard files + in-container
build exit 0; no Frappe unit tests (UI slice); manual live-cert LC1-12 pending Nitesh. See the
"Restructure surface Slice 1b-beta conventions" section below for the full as-built detail. The
restructure-surface arc is now COMPLETE pending live-cert; OWED next is a single-pass full-sheet-read
endpoint to replace SheetSearchView's windowed 200-row loop.

// prior: **Status (2026-06-09 -- Restructure Slice 1b-alpha BACKEND COMPLETE):**
Slice 1b-alpha (feat f7761415) is BACKEND-led; the only frontend touch is a type + one reader:
- `human_is_root: number | null` added to the `ReviewRow` type in `boqTypes.ts` -- a SEPARATE Check
  field (Option B), orthogonal to `human_parent` (the -1 sentinel value space is UNCHANGED). 1 => the
  human re-rooted the row to top-level (`effective_parent_index` is null; `human_parent` is -1 by the
  backend consistency invariant). Backend `resolve_effective` now also returns `human_is_root`.
- `ReviewTree.tsx` `parentOverridden` now ORs in `row.human_is_root === 1` so a human-rooted row reads
  as an override in the detail panel ("row N -> root" strikethrough). Display-only; no behaviour change.
- The restructure MODAL (mounting `SheetSearchView` + selection UI) is Slice 1b-beta -- NOT built here.
  It will POST to `save_review_restructure(boq_name, sheet_name, row_index, new_classification,
  child_moves, reason)`: `child_moves` is a `{child_row_index: new_parent_index}` map where a value of
  **`-1` = move that child to top-level/root**; assignable `new_classification` targets are
  line_item/preamble/note/spacer (subtotal_marker/header_repeat are parser-only, rejected). One atomic
  commit; the backend validates + writes the resolved plan (Path A -- the frontend computes placement).
The dev route + `_DevSheetSearchHarness.tsx` STILL REMAIN (removed in Slice 1b-beta).

// prior: **Status (2026-06-09 -- Restructure Slice 1a LIVE-CERTIFIED):**
Restructure surface Slice 1a (searchable sheet-view `SheetSearchView.tsx` + temporary dev route)
landed FRONTEND-ONLY (feat 5ecf1820); tsc + Vite green in-container.
LIVE-CERTIFIED 2026-06-09: 5/5 checks PASS on BOQ-26-00145 -- columns trimmed (#, Sl.No, Description,
Unit, both Qty cols shown; Rate+Amount hidden), exact-match description search + correct hit counter,
cycling prev/next stepper, scroll-to-hit + highlight, full-sheet load; verified on a clean-name sheet
(Fire Fitting, 1001 rows) AND a trailing-space sheet (Electrical , #152).
Deferred from live-cert: (a) FUZZY/TYPO-TOLERANT description search -- DEFERRED (exact matching kept for
V1; revisit only if real use proves exact-match frustrating; risk = false-positive noise on large
sheets; a logged decision, not owed work); (b) FULL-SHEET LOAD PERF -- ~30s on the 1001-row Fire Fitting
sheet because the frontend loops get_sheet_preview in 200-row windows and the endpoint re-opens the
workbook per window; OWED as a Slice 1b backend follow-up: a single-pass full-sheet-read endpoint to
replace the windowed loop (small/medium sheets already fast).
The dev route + `_DevSheetSearchHarness.tsx` REMAIN (removed in Slice 1b).
Slice 1b (restructure modal mounting 1a + selection + transactional save endpoint) NOT started.

OWED (C-values arc): rate-editing live-cert against a real Pattern-2-rate vehicle (Electrical has no
nested rate data); RE-LIVE-CERT of the BOQ-26-00145 `'HVAC '` per-area qty edit after bench restart.

Completed arcs (collapsed -- per-slice as-built detail in boq-upload-plan.md):
- Review-screen backend Slice A (feat fff26abd) -- -1 sentinel; resolve_effective / check_structural_integrity / append_edit_log_entry + get_review_rows / save_review_edit / mark_sheet_parsed_check_done.
- Slice B1 (0683f7b9) review spine + B1.1a (58d2ed44) column_descriptors + B1.1b-i (3e846ba1) descriptor-driven columns + B1.1b-fix-A/B + B1.1b-ii/iii -- review tree, ClassificationPill, parent column, column-subset selector.
- Slice B2a (single-source d9fa6b69) + B2a-fix + B2b + B2c + B2c-fix -- advisory flags, detail panel, Status column, Original/Edited pills.
- C-values arc C-v1 (2bf77d62) / C-v2 (aa74a023) / C-v2b (ae65555c) / C-v2c (da6bb6d1) / C-v2c-polish (ae9dcff2) / C-v2d (cd2cc156) / C-v2d-fix (7fee7481) -- inline value/text/per-area editing + per-row Remarks.
- Module 1b / 2b-i (81568df9) / 2b-ii (459f85ae) / 2b-iii (57152c52) / Module 3 Slice 3a-fix (ba4fb738) / 3b-i (bf1a2e64) / 3b-ii (7be670d4) / 3b-iii (2ac4789a) / 3c (16a6a4dc) / 3c-fix (9f8fb6f7) / 3d-ii (f24ac4fe) / 3d-iii (83b63b7b) / 3e (e60e768c) / 3f (793276f6) / Bucket-1 (f5dcfdd6, 1ec901e7) / Bucket-2 (cb86b92b, 21e56963) / #147 option-4 (193327b1) -- hub + spoke + parse-run surface + config panel + parse-progress modal.

**BoQ in-project list conventions (2026-06-01):**
- `BoqProjectTab` is the canonical in-project BoQ list component (and also reused as the **BOQs tab** on the Tendering project view -- see Tendering tabbed-view conventions below).
- Data: single `useFrappeGetDocList("BOQs", { fields: [...], filters: [["project","=",projectId]], orderBy: {field:"uploaded_at",order:"desc"}, limit:50 }, projectId ? \`boq-list-${projectId}\` : null)`. The third arg is the swrKey; passing `null` disables the fetch until projectId is available (standard SDK gotcha -- see useFrappeGetDoc swrKey note above).
- Status display: `wizard_state` Select field on BOQs -- ""/blank -> "Not started", "In progress", "Configured", "Parsed". No child-table reads; no sheet_drafts computation.
- Row navigation: `onClick` on `TableRow` -> `navigate(\`/upload-boq/hub/${row.name}\`)`. boqId = `row.name` (BOQs docname from Frappe autoname). Hub route: `upload-boq/hub/:boqId` (routesConfig.tsx).
- Date: `formatDate(row.uploaded_at || row.creation)` -- `uploaded_at` is the primary field; falls back to Frappe built-in `creation` for pre-M1 docs.
- UI: shadcn `Table` + `Skeleton` (mirrors ProjectTransferMemosTab), NOT TanStack/DataTable.
- BoqProjectTab is reused verbatim as the **BOQs tab** of `TenderingProjectView` (feat: tendering-project-tabs, 2026-06-16). Passed as `projectId={data.name}` where `data` is the Projects doc -- no transform.

**Tendering tabbed-view conventions (feat: tendering-project-tabs, 2026-06-16) -- `projects.tsx` + `tendering/TenderingProjectView.tsx` + `tendering/TenderingOverviewTab.tsx` + `data/root/useProjectRootApi.ts`:**
- **Admin Options -> Project Options tab rename + counts (`projects.tsx`):** the two shadcn `<Tabs>` triggers are now **"Won Projects"** (was "Projects") and **"Tendering Projects"** (was "Tendering"), each with a `bg-primary/10 text-primary` count chip. Won count reuses `useAllProjectsCount()` (`tendering_status="Won"`); tendering count is the NEW `useTenderingProjectsCount()` (`tendering_status="Tendering"` ONLY -- Lost excluded; it has its own sub-tab). Both are static `useFrappeGetDocCount` queries (NOT the table `totalCount`, which moves with in-table search) so the badges reflect the universe, not the current view. Chips show the number always (incl. `0`).
- **`TenderingProjectView` is now a tabbed shell** (rendered by `project.tsx` whenever `tendering_status !== "Won"`). It mirrors the won-project detail page: a custom button tab-bar (active `bg-[#D03B45] text-white`, identical to `project.tsx`) synced to the `?page=` URL param via `urlStateManager` + `getUrlStringParam` (same global-store pattern as `project.tsx`, NOT `useSearchParams`). Two tabs: `overview` / `boq`. Shell header = back button + project name + mono ID (the status badge/banner/actions live INSIDE the Overview tab -- owner decision -- so the BOQs tab still has identity context). `?page=boq` deep-links behave identically to the won page.
- **`TenderingOverviewTab` = the stub Overview body** (NEW). Styled to match `ProjectOverviewTab`'s "Project Details" card (shadcn Card + label/value grid using `CardDescription`), capped at `max-w-4xl mx-auto` so the sparse stub doesn't stretch thin. Shows only stub fields (Customer, Location=city+state, Created) in a 3-col grid that fills exactly one row; the tendering_status badge + Edit/Delete sit in the card header; the gradient banner (slate=Tendering / rose=Lost) sits above the card and EXPLAINS the minimalism; the Convert-to-Won (indigo) + Mark-as-Lost (rose-outline) action block + the inline `TenderingProjectForm` edit mode + the two confirm `AlertDialog`s all moved here verbatim from the old single-scroll `TenderingProjectView`. Lost stubs are read-only (Delete only). All tendering actions stay gated by `canManageTendering`.

**Hub route (Module 2b, feat 81568df9):** `/upload-boq/hub/:boqId` -- reads boqId
from URL param (survives refresh; not from the transient store). Module export:
`export { BoqHubPage as Component }` for React Router v6 lazy().

**Back-navigation convention (hub/spoke, Part 2 feat 2f8bf533):** All back-navigation buttons in the BoQ wizard route by entity ID -- never `navigate(-1)` or `window.history.back()`. Both the hub (`/upload-boq/hub/:boqId`) and spoke (`/upload-boq/hub/:boqId/sheet/:sheetName`) are accessible via direct URL with no guaranteed history stack, so history-based back misfires on hard refresh or deep link. Hub's "Back to project" uses `navigate(\`/projects/${boq.project}?page=boq\`)` -- routes to the project's BoQ tab by the BoQ doc's `project` field. Spoke's back button uses `navigate(\`/upload-boq/hub/${boqId}\`)` -- same principle. Apply this pattern to any future back-button added to a wizard route.

**Section-grain confirmedFields keys (Slice 3e feat e60e768c; 3e-fix; extended by Slice 3f feat 793276f6):** SheetConfigPanel's `confirmedFields: Set<string>` includes four stable section-level keys alongside per-field keys: `"section:rows"`, `"section:areas"`, `"section:roles"`, `"section:workpackages"`. A section is confirmed when: (a) any field in the section is interacted with (focus or change events both call `touchS1/touchS2/touchS3` or `touchS4()` which set both the field key AND the section key), (b) the user clicks "Accept all sections as-is" (adds the full `SAVE_ALL_FIELDS` set -- all per-field keys + 4 section keys -- matching Save semantics so every sparkle clears), or (c) a Save or Mark-as-reviewed completes (all keys added via `SAVE_ALL_FIELDS`). Section h3 headings show the sparkle when their section key is unconfirmed. Section 2 and Section 3 headings also OR-check their per-field key (area_dimensions / column_role_map) -- bulk-accept must therefore add the full SAVE_ALL_FIELDS set (not just the section keys) to clear all sparkles. Layer 1 is satisfied when all four section keys are present. Section 4 (work-package assignment) is INSIDE the gate AND required non-empty: `hasWorkPackage` (selectedWorkHeaders.length > 0) is ANDed into the attestation-checkbox enable condition SEPARATELY from `parserRequiredSatisfied` -- WP assignment is config-required (a sheet must declare what work it covers), not parser-required (that gate is strictly about column-role completeness). Helper text "Assign at least one work package to enable attestation" is shown when sections are confirmed and parser-required is satisfied but no WP is assigned.

**Save-then-status three-call Mark-reviewed pattern (Slice 3e feat e60e768c; extended by Slice 3f feat 793276f6):** A save-anchored "mark as reviewed" action calls three endpoints in sequence: `set_sheet_config` -> `set_sheet_work_packages` -> `set_sheet_status("Reviewed")`. Each step is gated on the prior succeeding. Plain "Save config" (handleSave) also calls both `set_sheet_config` and `set_sheet_work_packages` together. Never skip the config or work-packages save steps. If any step fails, stop and report the error inline -- subsequent steps are not called. All calls share the same `isSaving` flag; errors surface via `saveError` inline (no toasts).

**wizardStatus-as-prop into SheetConfigPanel (Slice 3e feat e60e768c):** `wizardStatus?: WizardStatus` is a prop on SheetConfigPanel, passed from SheetSpokePage as `draft.wizard_status`. It is captured into a `statusAtOpenRef` (useRef) at mount for M3.12 change-event drop. The panel remounts per sheet via `key={decodedSheetName}`, so the ref always reflects the status when the sheet was opened.

**Change-events-only re-edit drop rule (M3.12, Slice 3e feat e60e768c):** When a Reviewed sheet is re-opened and the user makes a genuine change (onChange on inputs, onValueChange on selects, add-row/remove-row in Section 2 or 3), the sheet is silently dropped to Pending and the attestation checkbox is cleared. Drop fires at most ONCE per spoke open (dropFiredRef guard). Focus events (onFocus, onClick on inputs, onOpenChange on dropdowns) do NOT trigger the drop -- the user can inspect without committing. Implementation: `dropIfReviewed()` helper called at the start of every genuine-change handler; onFocus/onOpenChange call only `touchS*` (confirm), not `dropIfReviewed`.

**Tooltip-inside-SelectContent pattern (Part 3b feat 8943e9ce):** Placing a Tooltip icon inside a shadcn `SelectItem` causes the icon to appear in the closed trigger's selected-value display. Root cause: shadcn's `SelectItem` wraps ALL children in `SelectPrimitive.ItemText`; Radix clones `ItemText` content into `SelectValue` in the trigger. Fix: use `SelectPrimitive.Item` directly (from `@radix-ui/react-select`) for items that need a sibling icon. Structure: `<SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>` (label only, shown in trigger) + sibling `<Tooltip>...<Info /></Tooltip>` (outside ItemText, shown only in open dropdown). The `TooltipContent` portals to body -- this does NOT conflict with the Select's `DismissableLayer` (which fires on `pointerdown`, not hover). Mount `TooltipProvider` locally around the component return, not globally. Non-confusable items continue to use shadcn's `SelectItem` unchanged.

**Slice B1 review screen conventions (feat 0683f7b9):**

- **Review route:** `/upload-boq/hub/:boqId/review/:sheetName` -- fourth sibling wizard route in `routesConfig.tsx`. Lazy, exports `{ SheetReviewPage as Component }`. Same `encodeURIComponent`/auto-decode convention as the config spoke.
- **ReviewTree tree-walk:** depth computed from `effective_parent_index` chain walk in `computeDepths()` in `ReviewTree.tsx`. Uses iterative memoised walk with visited-set cycle detection (cycle members get depth 0, B2 surfaces cycle flags). Never use the stored `level` field for display indentation -- it is the parser's static value and diverges after `human_parent` edits.
- **ReviewTree visibility:** `isVisible(row)` walks parent chain capped at 60 hops. Collapsed rows tracked in `Set<number>` of `row_index` values. B1 is read-only; editing affordances are Slice C.
- **onOpenReview prop (SheetCard):** `onOpenReview?: (sheetName: string) => void` -- navigates to the review route. Distinct from `onOpenSpoke` (config spoke). Hub passes `handleOpenReview`. SheetCard stays router-free.
- **"Review parsed sheets" hub section:** shown when `reviewableDrafts.length > 0` (Parsed or Parsed Check Done). Consistent with general-specs checklist section style.
- **"Parsed Check Done" addition:** added to `WizardStatus` union, `STATUS_PILL` (teal-600, label "Checked"), and SheetCard action branch. Was absent from all three before B1.

**Slice B1.1b-i review screen conventions (feat 3e846ba1):**

- **ColumnDescriptor type** (`boqTypes.ts`): `{col, role, area: string|null, value_field, value_key: string|null, rate_subkey: string|null}`. Added alongside `GetReviewRowsResponse.column_descriptors: ColumnDescriptor[]`.
- **ClassificationPill** (replaces B1's ClassificationBadge): left-bordered pill using locked §2 hex map. Inline `style={{ borderLeft: "3px solid {color}" }}` + `bg-muted/60` class. Hex map constant `CLS_COLORS` in `ReviewTree.tsx`: preamble #888780, line_item #378ADD, note #EF9F27, subtotal_marker #1D9E75, spacer #D3D1C7, header_repeat #94A3B8 (neutral; not in locked map). Fallback: unknown cls → #94A3B8. `CLS_LABELS` parallel constant for label text.
- **FIXED_ROLE_DEDUPE** (`Set(["sl_no","description"])`): these roles are excluded from the descriptor-driven column list. They render as fixed anchor columns (Sl.No = `sl_no_value`, Description = tree column). Other roles appear as descriptor-driven columns.
- **Anchor letters**: `slNoLetter` and `descriptionLetter` are extracted from `columnDescriptors` BEFORE deduplication (via `.find(d => d.role === "sl_no")?.col`). Used to render "Sl.No (A)" / "Description (B)" on anchor headers. Falls back to plain "Sl.No" / "Description" when the descriptor is absent (sheet not configured or role not mapped).
- **resolveDescriptorValue(row, d)**: dynamic field access via `(row as unknown as Record<string, unknown>)[d.value_field]`. The `as unknown` intermediate cast is required -- tsc rejects direct cast from `ReviewRow` to `Record<string, unknown>` without it (TS2352 strict overlap check). Walks value_field → value_key → rate_subkey; returns `undefined` at any missing level.
- **renderDescriptorCell(val)**: `undefined`/`null` → `""` (blank cell); `typeof val === "number"` → `fmtNum(val)` (incl. 0 → "0"). Absent-vs-zero rule: a missing key and a zero are visually distinct (blank vs "0").
- **Area column tinting**: `AREA_COLORS` + `buildAreaColorMap` are re-implemented locally in `ReviewTree.tsx` (verbatim copy of SheetDataGrid's local constants -- not exported from SheetDataGrid; do NOT export-refactor SheetDataGrid to share them). Applied to descriptor column headers only (not data cells).
- **No subset selector, no spacer toggle** in this slice -- those are B1.1b-ii.

**Slice B1.1b-ii review screen conventions (feat pending):**

- **Controls bar:** A `<div className="flex items-center gap-4 px-3 py-2 border-b border-border bg-muted/20 flex-wrap">` sits above the scroll area inside the outer rounded-border container. Outer container: `rounded-md border border-border overflow-hidden` (border moved from scroll div). Scroll div: `overflow-auto max-h-[calc(100vh-16rem)]` (2rem added for controls bar).
- **Column-subset selector (Feature A):** `visibleCols: useState<Set<string>>` lazy-initialized to all `displayDescriptor` col letters. `useEffect([displayDescriptors])` re-syncs to all cols when descriptors change. `toggleCol` uses functional Set updater. Both `<th>` and `<td>` for descriptor columns gated: `if (!visibleCols.has(d.col)) return null`. Fixed anchors (Excel Row, Sl.No, Parent, Description) never in the selector. Popover trigger shows "(N hidden)" amber text when any col hidden.
- **Three classification-visibility toggles (Feature B):** `showSpacers`, `showNotes`, `showSubtotals` — three independent `useState(true)` booleans. `classificationVisible(row)` returns false when `effective_classification` matches a toggled-off type. Composed with `isVisible` as TWO separate `return null` gates: `if (!isVisible(row)) return null; if (!classificationVisible(row)) return null;`. Keep the two concerns separate.
- **Children-of-hidden-annotation rule:** Hidden annotation rows' children render at their ORIGINAL computed depth. `classificationVisible` never adds to `collapsed` Set — `isVisible` of children is unaffected. `computeDepths` pre-runs over all rows (unfiltered), so depth is independent of what's filtered from render. Do NOT re-parent or re-indent children when their annotation ancestor is toggled off.
- **View-filter only:** No data edit, no state in boqTypes.ts, no backend changes.

**Slice B1.1b-iii review screen conventions (feat pending):**

- **Column split:** The former Description cell (chevron + pill stacked above + text + depth indent all in one) is split into TWO separate fixed-anchor columns: Classification and Description.
- **Classification column (new fixed anchor, between Parent and Description):** `<th>` header "Classification" (no letter). `<td>` contains chevron + ClassificationPill side by side (`flex items-start gap-1.5`). Flat-left — NO `paddingLeft` indent. Width `w-36 border-r border-border` on both `<th>` and `<td>`. Not in the column-subset selector (selector iterates `displayDescriptors` only; Classification is a fixed anchor outside that loop).
- **Description column (text-only):** `<td>` contains only the description text span + `(no description)` fallback + per-classification text styling. The depth indent (`paddingLeft = depth * INDENT_PX`) is applied on a `<div>` content wrapper inside the `<td>`. Chevron and pill removed from this cell entirely.
- **Chevron behavior:** click handler, `invisible pointer-events-none` on leaf rows, `aria-label`, `tabIndex` all carried over verbatim to the Classification `<td>`. No behavior change.
- **Not in selector:** The subset-selector Popover only ever iterates `displayDescriptors`. Classification is outside that loop — no change to selector code needed.
- **Pure layout restructure:** No behavior change to collapse, isVisible, classificationVisible, computeDepths, visibleCols, annotation toggles, Parent column, descriptor columns, or absent-vs-zero.

**Slice B1.1b-fix-B review screen conventions (feat pending):**

- **Parent column:** Fixed anchor column "Parent" inserted between Sl.No and Description. Shows the parent row's `source_row_number` (Excel row number) derived via `effective_parent_index → byIdx.get(pIdx)?.source_row_number`. Root rows (null/negative `effective_parent_index`) render blank. Never shows internal `row_index` values -- always Excel row numbers.
- **Scroll-to-parent mechanism:** `rowRefs = useRef<Map<number, HTMLElement>>(new Map())`. Each `<tr>` registers itself via a ref callback `(el) => rowRefs.current.set/delete(row.row_index, el)`. `revealAndScrollToRow(targetRowIdx)` walks the target's ancestor chain, removes collapsed ancestors from the `collapsed` set, then after `setTimeout(50ms)` calls `.scrollIntoView({ behavior: "smooth", block: "nearest" })` + sets `highlightedIdx`. The 50ms delay lets React commit the expand re-render before scrolling.
- **Transient highlight:** `highlightedIdx: number | null` state. Applied as `bg-amber-100 dark:bg-amber-900/40` on the `<tr>` className. Cleared after 1500ms via `useEffect([highlightedIdx])`.
- **isVisible ancestor-only rule (FIX 3):** The `isVisible` loop starts from `row.effective_parent_index` (the parent, not the row itself). Two defensive guards added: `cur < 0` → break (treats -1 sentinel as root stop); `cur === row.row_index` → break (self-reference cycle guard). Combined: a collapsed row R stays visible; only R's descendants are hidden. Do NOT add a check for `collapsed.has(row.row_index)` at the start -- that would reintroduce the described "parent disappears" bug.
- **Description cell pill-above-text layout (FIX 4):** Inner flex structure: `[chevron] [flex-col: [pill top] [text below]]`. The outer `flex items-start gap-1.5` + `paddingLeft` indent wrap the chevron + new inner `flex-col` div. The `flex-col` wrapper has `flex flex-col gap-0.5 min-w-0`. The pill's `whitespace-nowrap shrink-0` ensures full-label rendering with no truncation (FIX 2). Only the Description cell uses this stacked layout; all other columns keep single-value single-line rendering.

**Hub components in `src/pages/boq-wizard/`:**
- `boqTypes.ts` -- shared types: `BOQsDoc` + `BoQSheetDraft` + `WizardStatus` +
  `BoQSheetWorkPackage` + `BoQGeneralSpecsSheetRow` (Slice 2c). Both `BoqUploadScreen`
  and `BoqHubPage` import from here -- do not duplicate the type.
  Current `BoQSheetDraft` shape (feat ba4fb738 + Slice 2b-backend):
  `{ name, sheet_name, sheet_order, wizard_status, work_packages?: BoQSheetWorkPackage[], sheet_label?, sheet_config?, has_prior_parse?: 0 | 1, last_parsed_at?: string | null }`.
  `BoQSheetWorkPackage = { name: string; work_header: string }` (mirrors the backend child
  doctype "BoQ Sheet Work Package", field `work_header` Link -> "Work Headers").
  NOTE: `work_package` (singular string) is GONE -- it was the pre-3a legacy field. The
  array `work_packages` replaced it (feat b14e9015 backend, ba4fb738 frontend).
  `BoQGeneralSpecsSheetRow = { name: string; source_sheet_name: string; preamble_text?: string }`.
  `BOQsDoc.general_specs_sheet?: string` is GONE (Slice 2c). Replaced by
  `BOQsDoc.general_specs_sheets?: BoQGeneralSpecsSheetRow[]`. This is a FIRST-LEVEL child
  table on BOQs (not a grandchild like work_packages), so it SERIALIZES directly on the
  parent via `useFrappeGetDoc("BOQs", ...)` -- no focused read endpoint needed.
- `BoqHubPage.tsx` -- hub page with wired interactions (2b-ii). Four regions: header
  strip, general-specs selector, sheet-card list, parse-gate footer.
- `SheetCard.tsx` -- sheet card with status pill, summary line, per-card saving state,
  inline error, and status-dependent action buttons (2b-ii). Summary-line priority:
  `sheet_label > work_packages (comma-joined work_header values) > keyword hint`.
  `isKeywordHint` tests `!(work_packages?.length)` (feat ba4fb738).

**Mutation pattern (first wizard use of useFrappePostCall, feat 459f85ae):**
```typescript
const { call, loading } = useFrappePostCall("nirmaan_stack.api.boq.wizard.update_sheet_draft.<fn>");
await call({ boq_name, sheet_name, ... });  // throws on error
void mutate();  // SWR re-fetch from useFrappeGetDoc -- server is authoritative
```
`useFrappePostCall` is now the standard for JSON endpoint mutations in the wizard.
Raw `fetch` is kept ONLY for file upload (multipart FormData). Do NOT use raw fetch
for JSON endpoints; use `useFrappePostCall` + `mutate()`.

**Per-card saving convention:**
- `isSaving = statusLoading || labelLoading` from the card's own `useFrappePostCall` hooks.
- While saving: spinner + ALL buttons on that card disabled. Other cards stay interactive.
- On failure: inline `<p className="text-xs text-destructive">...</p>` on the card.
  No toasts -- inline error is the wizard convention throughout.

**Hub button set (per effective status):**
- Pending: [Review -- stub M3] [Skip] [Mark reviewed -- interim until M3]
- Reviewed: [Edit -- stub M3] [Set pending]
- Skip: [Edit label] [Include]
- Hidden: [Include]
- Parse failed: [Review -- stub M3] [Mark reviewed -- interim] [Skip]
- Parsed: [Edit -- navigates to per-sheet spoke] (fix 24312cab; single button only; no re-parse button -- deferred to Slice 2b)
- General specs: hint text only (checklist governs designation, no per-card status buttons)
- "Review" / "Edit" stubs: `onClick` no-op, Tooltip "Per-sheet configuration opens
  in Module 3 (coming next)". DO NOT navigate from these buttons.
- "Mark reviewed" + "Set pending": deliberately wired so parse gate is testable
  without the Module 3 spoke. Clearly labeled; they call `set_sheet_status` directly.
- Discard BoQ (header menu): still disabled/stubbed -- destructive, separate slice.
- Parse workbook (footer): WIRED (Slice 2b-frontend-i, feat c9fc37fd) to the run_parse endpoint via ParseRunDialog confirm; triggers the parse-run (assemble_mapping_config -> parse_boq() -> per-sheet BoQ Review Rows). NOT the Module-5 DB-commit / deliberate-parse-to-BOQ-Nodes pass, which is still not built.

**General-specs derivation rule (M2.16) -- CRITICAL (Slice 2c updated):**
The "General specs" display badge on a card is DERIVED from set membership in
`BOQs.general_specs_sheets` child array, NOT from `BoQSheetDraft.wizard_status`.
The backend NEVER writes "General specs" to `wizard_status` (see backend CLAUDE.md).
Do NOT write "General specs" to `wizard_status` in frontend code either.
The derivation logic (Slice 2c): build `generalSpecsSheetNames = new Set(boq.general_specs_sheets
.map(r => r.source_sheet_name))`; return "General specs" if `generalSpecsSheetNames.has(draft.sheet_name)`.
EXACT match -- sheet_name verbatim, no trimming. The old scalar `BOQs.general_specs_sheet`
was removed in Slice 2c; do NOT reference it. `general_specs_sheets` serializes on the
BOQs parent (first-level child) -- no focused read endpoint needed.
Multi-select CHECKLIST hub control (Slice 2b-frontend-ii, feat d1672c6f): candidate set = `nonHiddenDrafts` (backend rejects Hidden sheets server-side; never offer them). Ticked set seeded from `generalSpecsSheetNames`; re-synced on `boq` change via `useEffect([boq])`. Save sends the full ticked set as `sheet_names: string[]` to `set_general_specs_sheet` (list API, Slice 2b-backend-3, feat e996d097). The old `Select` + `NONE_SENTINEL` + `generalSpecsValue` single-select code is REMOVED. Set-membership derivation (above) is UNCHANGED.

**EXACT sheet_name constraint (verified 2026-05-31):**
`sheet_name` is stored and matched VERBATIM by the backend -- Frappe does NOT strip
whitespace from BoQ Sheet Draft Data fields. "  Electrical (Rev-2) " is stored as-is.
Rules: (1) use `draft.sheet_name` as-is for React keys and in every endpoint call;
(2) trim ONLY for visual display (e.g. card label text); (3) each call site in hub
code has a comment noting the exact-match requirement.

**M2.23 general-specs confirm flow (Slice 2b-frontend-ii -- combined multi-warning):**
ONE combined AlertDialog fires on Save when the ticked set NEWLY designates one or more Reviewed sheets. Names the affected sheets (1 sheet -> names it directly; 2+ -> lists them). Continue -> commits the full ticked list via `set_general_specs_sheet({ sheet_names: string[] })`; Cancel -> no write, checklist stays at current local ticks (not auto-reverted -- unlike the old controlled Select). Un-designating never warns; non-Reviewed new designations never warn. Designation NEVER calls `set_sheet_status` (M2.23 UNCHANGED: released sheets revert to their TRUE prior `wizard_status`).

**Hub parse-gate (M2.11/M2.12):** Enabled when `blockingCount === 0 && reviewedCount >= 1`.
Blocking = effective status is "Pending" or "Parse failed" on data sheets (non-hidden,
non-skip, non-general-specs). Parse workbook button is WIRED (Slice 2b-frontend-i) -- opens `ParseRunDialog` on click.

**ParseRunDialog.tsx (Slice 2b-frontend-i) -- the hub's parse confirm UX:** A FOUR-LIST summary Dialog: (1) "Will parse" -- Reviewed sheets, each a `Checkbox`, all ticked by default; (2) Skipped/Hidden -- informational; (3) Pending/parse-failed -- informational; (4) Already Parsed -- informational with `last_parsed_at`. The ticked subset is passed to `run_parse` as `sheet_names`. A two-step warn-before-reparse fires (within the same Dialog, `step` state 1 -> 2) when the ticked set includes any sheet with `has_prior_parse === 1`. This is the REFERENCE checklist component -- mirror its `useState<Set<string>>` + `toggleSheet` + Checkbox-per-row pattern for any future wizard multi-select UI. **Background note (Bucket-2 follow-up, feat 295e3881):** Both Step 1 and Step 2 show a bold-amber "runs in background ~10 min" note (`text-sm font-semibold text-amber-600 dark:text-amber-400`) -- Step 1 below the DialogDescription, Step 2 below the sheet list before the footer buttons. Reuses the existing wizard amber token (same as Section-3 unmapped-column warning). Copy: "This runs in the background and can take up to ~10 minutes. You can keep working; you'll see a summary here when it's done."

**Checkbox-checklist pattern (wizard convention, Slice 2b-frontend-i + 2b-frontend-ii):** `useState<Set<string>>` for the ticked set + a `toggleX` functional updater (`next = new Set(prev); has? delete : add`) + `Checkbox` from `@/components/ui/checkbox` (`checked` + `onCheckedChange`) + `<label htmlFor>` per row. Seed/reset in a `useEffect` keyed on the relevant trigger (`[open]` for a dialog, `[boq]` for the hub checklist). ParseRunDialog seeds = all Reviewed drafts, resets on `open` change; general-specs checklist seeds = `generalSpecsSheetNames`, resets on `boq` change so `mutate()` re-syncs after Save.

**Dirty-marker / parse-history fields (Slice 2b-backend + 2b-frontend-i):** `has_prior_parse: 0 | 1` and `last_parsed_at?: string | null` live on `BoQSheetDraft` (typed in `boqTypes.ts`). A Reviewed sheet with `has_prior_parse === 1` is DIRTY -- config changed since last parse, so re-parsing discards prior `BoQ Review Row` output. Frontend dirty test: `effectiveStatus === "Reviewed" && draft.has_prior_parse === 1`. `SheetCard` shows an amber "needs re-parse" badge next to the status pill on dirty Reviewed cards; Parsed cards display `last_parsed_at` via `formatDate`. The backend owns the dirty-drop (set_sheet_config drops Parsed -> Reviewed on a config change -- see backend CLAUDE.md); the frontend reads these fields but never writes them.

**Hub visual conventions (Module 2b-iii, feat 57152c52):**
- **Card list layout:** `grid grid-cols-1 sm:grid-cols-2 gap-3` for both the main card list
  and the hidden-sheets reveal section. Use the same grid if adding more card lists.
- **Status pills:** Solid saturated backgrounds with white text, `text-sm font-medium`,
  rounded-full, dark: variants for all 7 wizard_status values (incl. "Parsed", fix 24312cab).
  ONE central `STATUS_PILL` map in `SheetCard.tsx` -- do not scatter pill colors. Template:
  `bg-<color>-500 text-white dark:bg-<color>-600 dark:text-white` (most entries);
  "Parsed" uses `bg-green-600` / `dark:bg-green-700` (one shade darker, distinct from
  "Reviewed" emerald). "Parsed" entry must NOT fall back to the Pending pill.
- **Likely-skip keyword hint:** `isKeywordHint` flag (no label, no work_packages + keyword match).
  Rendered with `AlertTriangle` (lucide-react, `h-3 w-3`, amber) + amber text
  (`text-amber-600 dark:text-amber-400 font-medium`). Presentation-only; never changes data.
- **Footer breakdown pattern:** Lead with data-sheet progress (`N of M data sheets reviewed`),
  then append only non-zero counts: `· N parsed` (Bucket-1, feat f5dcfdd6), `· K general specs`,
  `· S skipped`, `· H hidden`. Each is a conditional fragment (`count > 0 && " · N label"`).
  Derive all counts from `getEffectiveStatus` -- same source as the gate. Do not change gate math.
  `parsedCount` filters `dataSheets` (not `allDrafts`) because Parsed sheets are data sheets;
  `generalSpecsCount`/`skippedCount` filter `allDrafts` (they are set-aside from the data pool).
- **General-specs checklist layout:** `grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2`
  (Bucket-1, feat f5dcfdd6). Matches the hub card-grid responsive pattern.

**Spoke section-grouping convention (Bucket-1 Option B, feat f5dcfdd6; boxed zones follow-up feat 1ec901e7):**

SheetConfigPanel's four sections are grouped into two visually distinct boxed zones inside the outer `space-y-5` card div:
- **Zone A -- "Parsing configuration":** wraps Sections 1 (Rows), 2 (Areas), 3 (Column Roles). Caption: `<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">Parsing configuration -- changes here require re-parsing</p>`. Container: `<div className="rounded-md border border-border p-3">` (untinted, on normal card surface -- primary zone). Within-zone section dividers (`pt-3 border-t border-border` on Sections 2 and 3) are kept; they read as within-group separators inside the box and complement (not duplicate) the outer box border.
- **Zone B -- "Sheet details":** wraps Section 4 (Work Packages). Caption same typography as Zone A. Container: `<div className="rounded-md border border-border bg-muted/30 p-3">` (tinted secondary using existing `muted` token -- calmer, lower-stakes zone). Zone B's former `border-t border-border pt-3` is REMOVED; the box border + outer `space-y-5` gap provide the visual separation. Section 4 `space-y-4` preserved.
- **Review gate and save bar:** outside both zones, after Zone B -- apply to the whole sheet, not to either zone. Do not move them into a zone.
- **Zone caption typography:** `text-xs font-medium uppercase tracking-wide text-muted-foreground` -- visually lighter than the section `<h3>` (`text-sm font-semibold text-foreground`), establishing "zone caption > section heading" hierarchy.
- **Design tokens used:** `border-border`, `bg-muted/30`, `rounded-md`, `p-3` -- all existing tokens, no new values introduced.
- **Gate logic is state-driven, not DOM-coupled:** all `confirmedFields.has("section:...")`, `allSectionsConfirmed`, `parserRequiredSatisfied`, `hasWorkPackage`, attestation `disabled` expression are purely state checks. Wrapping or reordering sections does not affect the gate.

**Module 3 Slice 3b-ii -- per-sheet spoke shell + SheetDataGrid (feat 7be670d4):**

- **Spoke route:** `/upload-boq/hub/:boqId/sheet/:sheetName` — sibling of the hub route in `routesConfig.tsx`. Lazy-loaded, `SheetSpokePage` exports `{ SheetSpokePage as Component }` (React Router v6 lazy convention).
- **encode/decode:** Hub navigates using `encodeURIComponent(draft.sheet_name)`. React Router v6.22.1 `useParams()` auto-decodes path params (calls `decodeURIComponent` internally) -- `sheetName` arrives already decoded. Corrected in Slice 3c (§9 #128): the redundant manual `decodeURIComponent(sheetName)` call was removed from SheetSpokePage; the spoke now uses `sheetName ?? ""` directly. Hub `encodeURIComponent` in `handleOpenSpoke` is unchanged (still required to avoid raw special chars in the URL path).
- **SheetSpokePage scope (this slice only):** back button → hub, header (display-trimmed sheet name + BoQ name/version + optional label), `SheetDataGrid`. NO config sections, NO work-package picker, NO mark-reviewed — Slice 3c+.
- **SheetDataGrid:** `useFrappePostCall` for ALL fetches (initial + load-more) — avoids mixing SWR state with accumulated rows. Initial 40 rows fetched in `useEffect([boqName, sheetName])`. `useState` tracks rows, hasMore, isInitLoading, initError, isLoadingMore, loadMoreError.
  - Column header: union of all col_letter keys across loaded rows, sorted in Excel order (shorter first, then alphabetical — A,B,...,Z,AA,AB,...). Recomputed after each load-more append.
  - Left gutter: absolute Excel `row_number` (never re-indexed; row 41 shows "41"). `sticky left-0` for horizontal scroll.
  - Cell values: null → blank, booleans → "TRUE"/"FALSE", others → String(). Truncated with `max-w-[180px]`, full value on hover via `title` attr. Uses shadcn `<Table>` (NOT TanStack).
  - Load-more: `disabled={isLoadingMore}` is the single-flight guard. `setRows(prev => [...prev, ...newRows])` appends. Re-evaluates `has_more` from new response. Hidden when `has_more === false`.
- **Review/Edit wiring:** `MODULE3_TOOLTIP` constant and `Tooltip`/`TooltipContent`/`TooltipTrigger` imports removed from `SheetCard.tsx`. Review (Pending, Parse-failed) and Edit (Reviewed) now call `onOpenSpoke?.(draft.sheet_name)` — optional so cards without a spoke callback still compile. `BoqHubPage` passes `onOpenSpoke={handleOpenSpoke}` where `handleOpenSpoke` calls `navigate(\`/upload-boq/hub/${boqId}/sheet/${encodeURIComponent(sheetName)}\`)`. All other card buttons (Mark reviewed, Set pending, Skip, Include, Edit label) are UNCHANGED.
- **Preview types in boqTypes.ts:** `SheetPreviewRow { row_number, cells: Record<string, string|number|boolean|null> }` and `SheetPreviewResponse { sheet_name, start_row, end_row_requested, rows, returned_count, has_more }`.

**Module 3 Slice 3c -- spoke config Sections 1 (rows) + 2 (areas) (feat 16a6a4dc):**

- **New component:** `SheetConfigPanel.tsx` in `src/pages/boq-wizard/`. Props: `boqName`, `sheetName` (verbatim), `draftConfig` (from the draft row's `sheet_config` field), `onSaveSuccess` callback.
- **sheet_config read-modify-write convention (CRITICAL):** `set_sheet_config` is WHOLE-BLOB REPLACE. Any write must: (1) parse the existing `draftConfig` blob, (2) update only the keys this component owns (Section 1/2: `header_row_count`, `header_row`, `top_header_rows_override`, `skip_top_rows_after_header`, `area_dimensions`), (3) re-serialize the FULL merged object, (4) POST that. Never POST a partial blob -- it wipes `column_role_map` and any other keys later slices own.
- **No data_start_row key:** Data start row is a derived display label only (`header_row + header_row_count`). No key of that name exists in `SheetConfig`. Do not write it.
- **Section 1 controls:** header type = `Select` with exactly two options (Single/Double) → `header_row_count` 1|2; header row = number `Input`; top header row(s) = comma-separated `Input` shown ONLY when `header_row_count === 2`; data start = read-only derived label; skip rows = comma-separated `Input`.
- **Section 2 control (Slice 3c-fix supersedes this):** Originally: badge-remove list (chips with X button to remove + `Input` to add on Enter) → `area_dimensions: string[]`. Replaced in Slice 3c-fix with Single/Multi toggle + stacked text boxes (see Slice 3c-fix section below).
- **Per-sheet confirm state:** Local `useState<Set<string>>` for confirmed field keys (NOT the session-scoped Zustand `confirmedFields` from BoqMasterPanel). Seeded empty (all unconfirmed) when an existing config loads. Sparkle + opacity-50 show while `hasPrefill && !confirmed && hasValue`. `touch(key)` marks confirmed. On save success, all S1/S2 field keys are marked confirmed. The sheet-level review GATE is NOT built here -- no checkbox, no mark-reviewed enable, no Pending-drop (deferred to Slice 3d+).
- **Save trigger:** Explicit "Save config" button (not per-keystroke). Rationale: read-modify-write is a network round-trip; editing multiple fields then saving once is the right UX. Single-flighted via `isSaving` guard. Errors surfaced inline on the panel.
- **Post-save re-read:** `onSaveSuccess` calls `mutate()` from `useFrappeGetDoc` in SheetSpokePage. `mutate` was added to the `useFrappeGetDoc` destructure in Slice 3c.
- **Panel mount:** `SheetSpokePage` renders `<SheetConfigPanel key={decodedSheetName} ...>` between the header strip and `<SheetDataGrid>`. The `key` prop causes the panel to remount fresh on sheet navigation, resetting all local state.
- **boqTypes.ts:** `sheet_config?: Record<string, unknown> | string | null` added to `BoQSheetDraft`. Frappe JSON fields return as parsed objects via useFrappeGetDoc; the string variant is a safety fallback. `parseConfig()` helper in SheetConfigPanel handles both.
- **Remaining next:** Section 3 column-role grid (column_role_map), area-per-column assignment, work-package assignment, two-layer review gate (Slice 3d+). No .py files touched in 3c.

**Module 3 Slice 3c-fix -- persistence + sparkle-on-confirm + Section-2 toggle/boxes (feat 9f8fb6f7):**

- **Persistence fix:** `setInitialized(true)` in the init `useEffect` was OUTSIDE the `if (parsedConfig !== null)` guard, causing it to fire on first render when `parsedConfig` was null (doc not yet loaded). This prematurely locked out re-seeding when the doc arrived. Fix: `setInitialized(true)` moved INSIDE the guard. Effect comment updated to reflect the correct contract: "only fires when real config data is present."
- **Sparkle-on-confirm (Select):** `onClick` on `SelectTrigger` removed. `onOpenChange={(open) => { if (open) touch(key); }}` added to the `Select` component instead. `onOpenChange` fires reliably when the dropdown opens, even when the user re-selects the already-active value -- the case `onClick` on Trigger did not handle reliably with Radix event propagation. **Convention for all future wizard Selects with sparkle:** use `onOpenChange` on `Select`, not `onClick` on `SelectTrigger`.
- **Section 2 reshape:** Replaced chip/Enter-to-add with a segmented Single/Multi toggle (two `Button` components in a `flex rounded-md border` container) + stacked `Input` boxes (one per area name, shown only in Multi mode). Toggle start state derived from prefilled config: `area_dimensions.length > 0` → Multi with boxes pre-filled; empty → Single. SINGLE saves `area_dimensions: []`; MULTI saves `areaBoxes.filter(s => s.trim() !== "")`. Remove button shown only when `areaBoxes.length > 1`. Confirm-as-is for Section 2: clicking the active toggle button (already-selected mode) always calls `touch("area_dimensions")`. Focusing any area Input also calls `touch`. State: `isMulti: boolean` + `areaBoxes: string[]` (replaces `areas: string[]` + `areaInput: string`).
- **Opacity treatment:** Section 2 unconfirmed state applies `opacity-50` to a single wrapper `<div>` around all Section 2 controls below the heading (not per-element), preventing compounded opacity on nested nodes.
- **boqTypes.ts:** unchanged -- `area_dimensions` still writes `string[]`.
- **SheetSpokePage.tsx:** not edited -- `isLoading` guard + `onSaveSuccess = () => void mutate()` confirmed correct.

**Conventions established by Slice 3c-fix (apply to future wizard panels):**
- **Select sparkle-clear:** use `onOpenChange` on `<Select>`, never `onClick` on `<SelectTrigger>`. Former does not fire reliably for Radix internals.
- **Multi-value list entry (areas, etc.):** Single/Multi segmented toggle + stacked Input boxes, not chip/Enter-to-add. Toggle's active-button onClick always calls `touch(key)` so re-clicking confirms sparkle.
- **Grouped opacity treatment:** apply `opacity-50` to ONE wrapper div, not individually to each child input.

**Module 3 Slice 3d-i -- lifted state conventions (SheetSpokePage as the state owner):**

- **Preview rows owned by SheetSpokePage.** The preview fetch (initial load + load-more) is lifted to `SheetSpokePage.tsx`. `SheetDataGrid` is a pure render component -- it accepts `rows`, `hasMore`, `isInitLoading`, `initError`, `isLoadingMore`, `loadMoreError`, `onLoadMore`, and `columnRoleMap` as props. It has no `useFrappePostCall`, no `useEffect`, no local state. All fetch state lives in SheetSpokePage.
- **columnRoleMap owned by SheetSpokePage.** `useState<Record<string, ColumnRoleEntry>>({})` with seeding effect. `setRoleMapInitialized(true)` fires only after `rawCfg` is successfully parsed (draft absent → early return; JSON fail → rawCfg null → early return); mutate() re-fetches do NOT overwrite user edits. Seed loop (corrected by read-back fix -- see below) handles both the current `{role,area}` object shape (3d-ii onward) and legacy role-only strings defensively.
- **ColumnRoleEntry type in boqTypes.ts.** `{ role: string; area: string | null }`. Backend blob (3d-ii onward) stores `column_role_map: Record<string, {role, area}>` objects. Convert on seed: `{role,area}` object → `ColumnRoleEntry` (or legacy string → `{role, area:null}`). Serialize on save in SheetConfigPanel.handleSave: write `{role, area}` per column with area forced null for non-area-compatible roles.
- **SheetConfigPanel receives but doesn't consume (yet).** `columnRoleMap` is destructured and used in `handleSave` (explicit `column_role_map` key overrides the `...existing` passthrough). `setColumnRoleMap` and `rows` are in the interface for Slice 3d-ii (Section 3 UI) but not destructured in this slice.
- **Hooks before guards in SheetSpokePage.** All hooks (useFrappePostCall, useState, useEffect, useRef) are called before any early-return guards. Computed values (`decodedSheetName`, `displaySheetName`, `draft`) use optional chaining on `boq` (may be undefined during loading) so they can be referenced by hooks that precede the `!boq` guard.
- **Rationale for lifting both children's state together.** Slice 3d-iii (grid annotation) requires SheetDataGrid to read the same live `columnRoleMap` that SheetConfigPanel writes. Both are siblings in SheetSpokePage. Lifting to the parent is the only way to share state without a context provider or prop-drilling back up. The preview rows are lifted for the same reason: Slice 3d-ii renders a column list from them inside SheetConfigPanel, requiring rows to be available at SheetSpokePage level.

**Module 3 Slice 3d-ii -- Section 3 column-role mapping conventions:**

- **Role vocabulary (21 roles, `qty_by_area` excluded).** Constant `ROLES_BY_GROUP` in `SheetConfigPanel.tsx` groups roles into 6 SelectGroup blocks. Role string values are the exact parser role names (e.g. `"rate_supply_by_area"`); display labels are friendly (e.g. `"Rate Supply (per area)"`). Never invent new role names -- the 21 are the complete set.
- **blob shape: `{role, area}` objects.** `column_role_map` in the saved blob is `dict[col -> {role, area}]` NOT `dict[col -> string]`. The 3d-i role-only shape was incorrect and is fixed in 3d-ii. Non-area-compatible roles always get `area: null` in the blob (enforced in `handleSave` via `AREA_COMPATIBLE_ROLES.has(entry.role) ? entry.area : null`).
- **Area-compatible roles (8):** `qty`, `amount_supply`, `amount_install`, `amount_total`, `amount_by_area`, `rate_supply_by_area`, `rate_install_by_area`, `rate_combined_by_area`. Area dropdown shown only when role is one of these AND `isMulti === true` AND `activeAreas.length > 0`.
- **Area-required roles (4):** the `*_by_area` group. Empty area flagged with `border-destructive` and `"— required —"` placeholder; save proceeds with `area: null` (no wizard-level blocking).
- **Singleton roles (12):** `sl_no`, `description`, `unit`, `qty_total`, `rate_supply`, `rate_install`, `rate_combined`, `amount_total`, `amount_combined`, `make_model`, `row_notes`, `reference_images`. Enforced by disabling in other rows' **role** dropdowns. `usedSingletons` Map (role → col) via useMemo. This is role-level uniqueness; does NOT cover area-pair uniqueness (see below).
- **Per-(role, area) pair uniqueness:** Parser enforces that each (role, area) pair may appear on at most one column per sheet (e.g. two columns cannot both be `qty` + "Zone A"). Enforced in the **area** dropdown: for each area option, it is disabled when another column already holds (same role, same area). Current row's own area is never disabled. `usedAreaPairs` Map (`"role|area"` → col) via useMemo alongside `usedSingletons`. Applies to all 8 area-compatible roles. Distinct from singleton enforcement: `qty` is not a singleton -- pair uniqueness is the only constraint for it. `"__none__"` sentinel is unaffected.
- **Pending rows pattern.** `pendingRows: string[]` (local state, IDs from `pendingIdRef`). Each pending row shows only a column picker. On column selection → `commitPendingRow(id, col)` moves to `columnRoleMap` with `{role: "", area: null}`. Role + area dropdowns appear only after column is committed. This keeps the persisted state (`columnRoleMap`) always clean.
- **Area sentinel `"__none__"`.** The area Select uses `value={entry.area || "__none__"}`. The `"__none__"` SelectItem maps back to `area: null`. `changeArea(col, "__none__")` → null.
- **Cross-section area reconciliation.** `useEffect([validAreas])` in SheetConfigPanel clears stale area values from `columnRoleMap` whenever `areaBoxes` changes. Re-sparkles "column_role_map". Uses `eslint-disable-next-line react-hooks/exhaustive-deps` (reads `columnRoleMap` from outer scope; functional update in `setColumnRoleMap` handles staleness safely).
- **Column picker header text.** Derived from the bottom header row (`headerRowNum` = the S1 `headerRow` field). `getColumnLabel(col)` returns `"C — Description"` or just `"C"` if blank. For 2-row headers, shows the bottom row only (the primary parser label row). Already-mapped columns are disabled in other rows' pickers (one-column-per-row constraint).

**Module 3 Slice 3d-ii -- read-back fix (seed loop shape mismatch):**

The 3d-ii save corrected `column_role_map` from role-only strings to `{role,area}` objects, but the seed loop in `SheetSpokePage.tsx` was not updated to match. The loop used `typeof role === "string"` where `role` was the entry VALUE (an object after 3d-ii) -- every entry was skipped, `columnRoleMap` seeded as `{}`, `setRoleMapInitialized(true)` locked the empty state, Section 3 rendered zero rows even though data was correctly saved.

Fix (applied in fix cbb704ce): renamed loop variable `role` → `val`; added dual-shape handling:
- `typeof val === "string"` → legacy pre-3d-ii: `{ role: val, area: null }`.
- `typeof val === "object" && val !== null && "role" in val && typeof val.role === "string"` → current 3d-ii: `{ role: v.role, area: v.area ?? null }`.
- Anything else: silently skipped.

`setRoleMapInitialized(true)` placement confirmed correct: already fires after the `if (!rawCfg) return` guard (not inside the `rawRoleMap` block), so absent or empty `column_role_map` is valid "no roles configured" and still locks. Only stale inline comment was corrected.

**Only `SheetSpokePage.tsx` was touched. SheetConfigPanel / boqTypes / all .py files are unchanged.**

**Module 3 Slice 3d-iii -- SheetDataGrid 4 column annotations (feat 83b63b7b):**

- **Shared ROLE_LABELS (boqTypes.ts):** `export const ROLE_LABELS: Record<string, string>` with 21 entries added as the single source of truth for role display labels. `SheetConfigPanel.tsx` ROLES_BY_GROUP was refactored to derive labels from ROLE_LABELS (group structure/order/behavior identical; no behavior change). `SheetDataGrid` uses `ROLE_LABELS` for badges.
- **Live-vs-saved asymmetry (by design):** `columnRoleMap` is live lifted state → color/badge/dim update as user edits Section 3 before Save. `savedHeaderRow` / `savedHrc` / `areaList` are `useMemo`-derived from `draft?.sheet_config` → freeze and area-color-map update only after Save triggers `mutate()`. No new `useState`; no `initialized` guard; plain derived values that track the saved doc automatically.
- **AREA_COLORS palette (2a/2b):** `const AREA_COLORS` (6-element `as const`): `bg-blue-100 dark:bg-blue-900`, `bg-emerald-100 dark:bg-emerald-900`, `bg-amber-100 dark:bg-amber-900`, `bg-rose-100 dark:bg-rose-900`, `bg-violet-100 dark:bg-violet-900`, `bg-teal-100 dark:bg-teal-900`. All fully opaque (no `/opacity` suffix) in both light and dark -- no bleed-through on scroll. `buildAreaColorMap(areas)` pure function assigns by index. Column-letter `<TableHead>` `bg-muted` REPLACED by area color when `colEntry.area !== null`. Single-area / unmapped columns keep `bg-muted`.
- **Role badge (2c):** `text-[9px]` `<span>` below column letter inside a `flex flex-col items-center justify-center` wrapper. `bg-black/10 dark:bg-white/15` overlay works on any area tint. `max-w-full truncate` prevents overflow. Absent for unmapped columns.
- **Dim unmapped (2d):** `isMapped = col in columnRoleMap && columnRoleMap[col].role !== ""`. Data `<TableCell>` gets `opacity-50` when `!isMapped`. Frozen rows exempt (they are header content).
- **Freeze header rows (2e):** Fixed height `h-10` (40px) on all column-letter `<TableHead>` cells (corner + letters) makes offsets predictable. `isFrozen = headerRow !== null && row.row_number ∈ [headerRow, headerRow+headerRowCount-1]`. `frozenIdx` = 0-based position in frozen band. Frozen data cells: `sticky z-[15] bg-background h-10 top-10` (first) or `top-20` (second). Frozen gutter cell: doubly-sticky `sticky left-0 z-[17] bg-muted h-10 top-10|top-20`. `bg-background` / `bg-muted` are solid -- no bleed-through. `headerRow=null` → no frozen rows, behaves as before. **Full z-index stack:** corner z-30 (top+left); column-letter z-20 (top); frozen gutter z-[17] (top+left); frozen data z-[15] (top); body gutter z-10 (left); body data cells not sticky.

**Module 3 batched UI-fixes Part 1 -- SheetConfigPanel patterns (feat bdf32e37):**

- **Conditional subform pattern (Section 1 top-header):** When a form field has a default value that covers the common case, replace the free-text input with a Yes/No segmented toggle (two `<Button>` in a `flex rounded-md border border-border overflow-hidden w-fit` container, matching Section 2's Single/Multi pattern). Default = Yes (no extra input). No = reveals the specific input. This prevents the Alorica-style mistake of entering the default value explicitly. Serialization: Yes → `null`; No → `[N]` (or other typed value). Sparkle on the toggle Label when `!defaultChoice` was prefilled; sparkle on the revealed input when its value is non-empty.
- **Derived display as inline text (data-start-row pattern):** Derived read-only values must be rendered as `<p className="text-xs text-muted-foreground">` with an inline sentence, never as a `<p>` with input-chrome classes (`rounded-md border border-border bg-muted/30 px-3 py-2`). Example: "Data starts at row **N** (derived from header row + row count)". No Label, no box, no separate helper text. Apply this pattern to all future derived/computed display values in Section 1.
- **Save-time unmapped-column warning (preview-rows-only, non-blocking):** At Section-3 save, scan `allColumns` (the `useMemo` over loaded `rows` prop) for columns missing from `columnRoleMap` (or with empty role) that have at least one non-null, non-empty-string cell in loaded preview rows. Set `unmappedWarnings: Array<{col, exampleRow}>` state. Render as an amber callout above the Save button using `AlertTriangle` icon, amber Tailwind classes, and a bullet list of column+row pairs. Save proceeds regardless (warn-then-save, not block-then-save). Warning persists until next save recomputes. **Accepted scope:** preview rows only (up to ~40 loaded). Full-sheet coverage deferred; the dim-unmapped visual (Slice 3d-iii) covers the rest.

**useFrappeGetCall vs useFrappePostCall in the wizard (convention, Slice 3b-ii):** Wizard reads use `useFrappeGetCall` by default. Accumulating/paginating reads (UI appends rows across multiple fetches) use `useFrappePostCall` + local `useState`, because SWR replace-on-fetch semantics fight row accumulation -- `useFrappeGetCall` replaces `data` on params change instead of appending. GET/POST signals read-vs-mutation intent; `useFrappePostCall` for reads is the one sanctioned exception and is limited to SheetDataGrid (Slice 3b-ii). `@frappe.whitelist()` bare (the get_sheet_preview endpoint) accepts both GET and POST.

**Module 3 Slice 3b-iii -- SheetDataGrid polish (feat 2ac4789a):**

- **Sticky column-letter header:** `overflow-x-auto` → `overflow-auto max-h-[calc(100vh-14rem)]` on the container. Bounded height creates a vertical scroll window so `sticky top-0` fires within the container (not relative to the page). z-index order: corner `#` cell = `sticky top-0 left-0 z-30`; column-letter headers = `sticky top-0 z-20`; row-number gutter = `sticky left-0 z-10`. All sticky cells use solid `bg-muted` or `bg-background` (not semi-transparent) so body rows don't show through.
- **Visible gridlines:** `border-r border-border` added to column-letter `<TableHead>` cells and data `<TableCell>` cells. Existing `border-b` on `<TableRow>` provides horizontal lines. Corner + gutter cells already had `border-r` from Slice 3b-ii.
- **Decode fix (SheetSpokePage.tsx, superseded by Slice 3c):** The Slice 3b-iii fix added `decodeURIComponent(sheetName)` based on a belief that RR does not decode. Slice 3c (§9 #128) corrected this -- RR v6 DOES auto-decode, so the explicit call was redundant and removed. `decodedSheetName = sheetName ?? ""` now (no-op assignment). The top-level JSDoc in SheetSpokePage.tsx states the correct behavior; the wrong inline comment was also corrected there.

**Restructure surface Slice 1a -- SheetSearchView conventions (feat 5ecf1820; LIVE-CERTIFIED 2026-06-09):**

- **Component home + role:** `src/pages/boq-wizard/SheetSearchView.tsx`. A self-contained "find the row in the source sheet" tool: FINDS + SHOWS rows only. It does NOT select a parent, NOT save, NOT change classification/parenting (Slice 1b adds the restructure modal that mounts this, selection, and a transactional save endpoint, and REMOVES the dev route). Props: `{ boqName, sheetName, initialCentreRow?, onCurrentHitChange? }`. `onCurrentHitChange(row|null)` is exposed for 1b but wired to nothing destructive.
- **Self-contained data (it owns both fetches):** (1) rows via `get_sheet_preview` (`useFrappePostCall`); (2) role->letter map via `useFrappeGetDoc("BOQs", boqName)` -> `draft.sheet_config.column_role_map` (same parse SheetSpokePage seeds from; object|string config + `{role,area}` and legacy role-only shapes handled by a local `parseColumnRoleMap`). A second fetch is intentional and in-scope.
- **Full-sheet load convention (NOT paginated):** `get_sheet_preview` hard-caps each call at 200 rows (`_PREVIEW_MAX_ROWS`). To make search cover the WHOLE sheet, the mount effect LOOPS windows of 200, advancing `nextStart = preview.end_row_requested + 1` (advance by the requested window, NOT the last returned row number -- the endpoint skips empty padding rows, so requested-window advance guarantees forward progress with no overlap/re-scan), until `has_more === false`. A 500-window backstop fails loudly. Blocks the table behind a "Loading sheet... (N rows loaded)" state until fully loaded. **Cost:** the endpoint re-fetches S3 + re-opens the workbook per call (~6 calls for ~1,186 rows); a true batch read endpoint is a possible 1b backend follow-up if it feels slow.
- **Column-trim:** render ONLY `#` (Excel `row_number`) + Sl.No + Description + Unit + EVERY Qty column (roles `qty` and `qty_total`; per-area qty = multiple Qty columns, each headed with its Excel letter + area label e.g. "Qty (Phase 1) (D)"). Rate + Amount hidden. **Degraded mode** (`column_role_map` absent/empty): show all letters in Excel order, disable search with an inline amber note.
- **Description search + cycling hit-stepper:** case-insensitive substring over the Description cell across ALL loaded rows -> ordered `hits: number[]` of `row_number`. Counter "N of M"; prev/next step both directions and CYCLE (`(i±1+len)%len`); all hits soft-highlighted (yellow), current hit emphasised (amber), transient flash (amber-300) cleared ~1.2s; empty/zero-match -> counter 0, toggles inert (disabled).
- **Scroll/center/highlight ported from ReviewTree (reimplemented, NOT imported):** `rowRefs = useRef<Map<number, HTMLElement>>` keyed by `row_number`, `<tr>` ref callback set/delete. On current-hit change (and `initialCentreRow` once after full load) `setTimeout` -> `scrollIntoView({ behavior:"smooth", block:"center" })` (`center` clears the sticky header). The sticky `#` gutter stays `bg-background` for horizontal-scroll correctness, so the row tint reads across data cells but not the gutter (accepted).
- **SheetDataGrid NOT reused/extended (byte-for-byte untouched):** the trimmed table is built fresh because scroll/highlight need per-row DOM access SheetDataGrid does not expose; reusing it would mean adding 3-4 review-specific props to a shared component. Future "searchable sheet view" needs should extend THIS component, not SheetDataGrid.
- **sheet_name VERBATIM (#152):** never `.trim()` -- trailing-space sheet names exist on BOQ-26-00145 (`Electrical `, `HVAC `, ...). Used verbatim in both fetches and the draft lookup.
- **TEMPORARY dev route (REMOVED in 1b-beta):** `_DevSheetSearchHarness.tsx` + the `upload-boq/_dev-sheetview/:boqId/:sheetName` route in `routesConfig.tsx`. Both REMOVED in Slice 1b-beta (feat e8eeab58) once the real modal mounts SheetSearchView. Not linked from any real UI while they existed. Live-cert URLs (historical) on BOQ-26-00145: `/upload-boq/_dev-sheetview/BOQ-26-00145/Fire%20Fitting` (clean), `.../Electrical%20` and `.../HVAC%20` (trailing-space). Slice 1a was LIVE-CERTIFIED 2026-06-09 (5/5 checks PASS) before removal; deferred findings: fuzzy-search DEFERRED, full-sheet-load perf OWED as a backend follow-up.

**Restructure surface Slice 1b-beta -- RestructureModal + trigger chain (feat e8eeab58):**

- **Component home + role:** `src/pages/boq-wizard/RestructureModal.tsx`. The FRONTEND consumer of the live-certified `save_review_restructure` backend (Slice 1b-alpha, feat f7761415). The HEAVY (has-children) path of the reclassify-and-place-children surface. Props: `{ open, onClose, boqName, sheetName (verbatim), row: ReviewRow, newClassification, rows: ReviewRow[], onRestructured: (editedAt) => void }`. The `save_review_restructure` response type is defined LOCALLY in the modal + ReviewTree (boqTypes.ts was out of scope for this slice; do NOT assume a shared type exists).
- **Trigger chain (in ReviewTree's detail panel):** the row-detail panel's Classification line gains a pill-styled `DropdownMenu` ("Change ▾") of the 4 ASSIGNABLE target classes (`line_item`/`preamble`/`note`/`spacer` -- `ASSIGNABLE_CLASSIFICATIONS` const; subtotal_marker/header_repeat are parser-only and NOT offered). Picking one calls `onPickClass(row, cls)` which counts children (`rows.filter(r => r.effective_parent_index === row.row_index)`): **childless -> light `AlertDialog` confirm** ("Change classification"; calls `save_review_restructure` with `child_moves: {}`; a plain Button, NOT `AlertDialogAction`, so the dialog stays open + shows an inline error on a backend throw); **has children -> the staged `RestructureModal`**. The detail panel is already `stopPropagation`-wrapped, and DropdownMenu/Dialog content portals to body, so neither dismisses the panel.
- **The FIVE child-placement options (no silent default):** (1) move all children UP to this row's current parent (`row.effective_parent_index`; null/<0 -> -1/top-level); (2) keep all children UNDER this row -- `child_moves: {}` (nothing reparents), OFFERED ONLY when the new class is parent-capable (`PARENT_CAPABLE = {line_item, preamble}`); disabled with a reason for note/spacer; (3) move all to ONE new parent (parent picker -> that row_index for every child); (4) decide EACH child individually (per-child picker; each gets a picked row_index or top-level -1); (5) make all children top-level (-1 each). Radio selection, none pre-selected. **Save gating:** options 1/2/5 complete on selection; option 3 needs the single parent picked; option 4 needs EVERY child resolved (`children.every(c => perChild[c.row_index] !== undefined)`).
- **child_moves assembly (Path A -- FRONTEND computes the resolved map):** `buildChildMoves()` returns `{child_row_index: new_parent_index}` with `-1` = top-level. ONE `save_review_restructure(boq_name, sheet_name [VERBATIM #152], row_index, new_classification, child_moves, reason?)` call. The object is passed directly to `useFrappePostCall` (same as `sheet_names`/`work_headers` arrays elsewhere -- the SDK serializes it; the backend accepts a dict). Success -> `onRestructured(res.message.edited_at)`; Cancel/close/Escape writes nothing; a backend `frappe.throw` (e.g. a batch cycle) surfaces inline and the modal STAYS OPEN.
- **Parent picker mounts the CERTIFIED SheetSearchView (byte-for-byte untouched):** consumed via its existing `onCurrentHitChange` prop, held in modal state. The modal renders its OWN "Set as parent" button (not inside SheetSearchView). **row_number -> row_index resolution:** a `SheetPreviewRow` carries only the Excel `row_number`, NOT `row_index`; resolve via `rows.find(r => r.source_row_number === hit.row_number)`. **No-match guard:** if the current hit resolves to no review row (a header/banner/blank band row), "Set as parent" is DISABLED with a quiet reason ("This row isn't a selectable parent"). For option 4 a child may also be set to top-level (-1) without picking a row.
- **onRestructured refresh wiring (mirrors the certified onSaved path):** ReviewTree gains an OPTIONAL `onRestructured?: (editedAt: string) => void` prop (backwards-compat -- no existing caller breaks). The modal's + childless-confirm's success calls `onRestructured(edited_at)`. SheetReviewPage wires `onRestructured={handleSaved}` -- the EXISTING handler (setLastSavedAt + `mutate()`); a restructure IS a real edit (it stamps + returns edited_at), so the tree reflects the moved children + reclassified row via the SAME SWR revalidate path the value/text edits use. Do NOT fetch/patch the tree inside the modal.
- **Titles (context-specific):** childless confirm "Change classification"; the heavy with-children modal "Reclassify row and place its children". (The design doc's standalone "Change parent" title is N/A here -- this slice's only trigger is reclassification, not a standalone reparent.)
- **Deferred (NOT built):** the batch "apply all edits at once" model, drag-to-reparent, and fuzzy search remain deferred.

**Restructure surface Layout Part A -- RestructureModal sizing + child-list wrap (feat 51b3412e):**

- Cosmetic, display-only follow-up to 1b-beta. RestructureModal `DialogContent` widened `max-w-3xl` -> `max-w-6xl` (keeps `w-full` + `max-h-[90vh] overflow-y-auto`); `max-w-6xl` (~1152px) is a balanced, viewport-safe cap that gives the mounted picker real room without going absurdly wide on large monitors (90vw was the alternative). The two children-list texts -- the "Children (N)" summary `<li>` and the option-4 per-child `<span>` -- switch from single-line `truncate` to `whitespace-normal break-words`, so a long child note WRAPS instead of clipping. The reclassified-row description line (`font-medium`, no truncate) was already wrap-capable and is left as-is.
- **Picker-grid columns/wrap is STILL OWED -- a SEPARATE slice.** The `SheetSearchView` cells hardcode per-column `min-w-[120px]` + `truncate` (no-wrap), uniform across columns incl. Description, with no sizing prop. Fixing the grid's column widths + cell wrap REQUIRES editing the 1a LIVE-CERTIFIED `SheetSearchView` (cell classes + a Description-vs-others width branch), which means re-confirming its 1a display/search behaviour. Deliberately split out per the slice-composition framework, to be paired with click-to-select. Not done here.
- No state/handler/save-path/option-logic change. In-container tsc 0 errors in RestructureModal.tsx; in-container build exit 0. Manual MA1-4 pending Nitesh.

**SheetSearchView v2 conventions (feat fc7147db -- RE-CERTIFIES SheetSearchView; supersedes the 1a-only cert):**

Three changes bundled into ONE slice so the certified `SheetSearchView` is re-certified ONCE (slice-composition framework). Frontend-only; no backend/doctype/schema change. Files touched: `SheetSearchView.tsx`, `RestructureModal.tsx`, `boqTypes.ts`.

- **(1) Fetch swap -- single-pass full-sheet read.** The windowed `get_sheet_preview` 200-row loop (mount effect) is REPLACED by ONE `useFrappePostCall` to `get_sheet_preview_full` (feat 196ed765) with `{ boq_name, sheet_name }` (sheetName VERBATIM, #152). `setAllRows(preview.rows)` once -> `setIsFullLoading(false)`. PRESERVED unchanged: the `[boqName, sheetName]` effect trigger, the `cancelled` unmount guard, `loadError` handling, and the single `isFullLoading` true->false flip (the `initialCentreRow` centre+flash effect still fires once after the flip). REMOVED as dead: `PREVIEW_WINDOW`, `MAX_WINDOWS`, the `loadedCount` state + its ticker. **Loading text = plain "Loading sheet..."** (one batch now -- no live count; the bottom-bar "N rows loaded" using `allRows.length` is unchanged). This WIRES the perf OWED item -- previously one S3 fetch + workbook open PER 200-row window (~30s on a 1001-row sheet); now one call. Live perf proof is the v2 live-cert (STAGE 1). The hook is typed `{ message: SheetPreviewFullResponse }`.
- **`SheetPreviewFullResponse` (boqTypes.ts, ADDITIVE):** `{ sheet_name; rows: SheetPreviewRow[]; returned_count; has_more }` (no `start_row`/`end_row_requested` -- no window; `has_more` always false, kept for shape-compat). `SheetPreviewResponse` is left byte-for-byte intact -- SheetSpokePage still consumes the windowed `get_sheet_preview` via that type. Do NOT collapse the two types.
- **(2) Column restyle -- fixed widths + wrap.** `<Table className="table-fixed">`. Per-column width via `col.letter === descriptionLetter`: Description -> `w-[360px]`, every other column -> `w-[120px]`, applied to BOTH the header `<TableHead>` (replaces `min-w-[120px]`) and the data `<TableCell>` (replaces `max-w-[360px] truncate`). Data cells gain `whitespace-normal break-words` (WRAP, not truncate); `title`, `border-r border-border px-2 text-xs` kept. **Degraded mode** (no `column_role_map` -> `descriptionLetter === null`): no real letter matches, so every column gets the narrow width -- no crash, no Description special-case. The `#` gutter (`w-12 min-w-[48px]`) is untouched. table-fixed + sticky header/gutter + z-index stacking are in the re-cert surface (live-cert STAGE 2).
- **(3) Click-to-select -- new optional props.** `onRowClick?: (row: SheetPreviewRow) => void` and `selectedRowNumber?: number | null` (both OPTIONAL -> backwards-compat; the modal is the only caller). The `<TableRow>` gains `onClick={() => onRowClick?.(row)}` (+ `cursor-pointer` when `onRowClick` is set); the ref-callback + existing highlight className are undisturbed. **Selected tint = a persistent inset blue ring** `ring-2 ring-inset ring-blue-500 dark:ring-blue-400`, added as ONE additive className line. CHOICE: a ring is a `box-shadow` -- a DIFFERENT CSS property than `background-color`, so it provably never collides with the certified yellow/amber hit tiers (a row that is both a search hit and selected shows the amber fill WITH a blue outline). The certified `isHit`/`isCurrent`/`isFlash` background lines are NOT touched. The component ONLY emits the click + renders the tint -- it does NOT resolve or guard the pick.
- **RestructureModal wiring -- click-sets-hit (reuse, NO duplication).** Both pickers (option 3 single-parent, option 4 per-child) get `onRowClick={setCurrentHit}` + `selectedRowNumber={currentHit?.row_number ?? null}`. A click sets the SAME `currentHit` state the search feeds via `onCurrentHitChange`, so the existing `hitRowIndex` useMemo (`rows.find(source_row_number === hit.row_number)`) + no-match guard ("This row isn't a selectable parent") + "Set as parent" enabling all react identically. A click does NOT re-fire `onCurrentHitChange` (that effect keys on the SEARCH hit changing, not clicks), so there is no overwrite race; last action (click or search) wins. The existing search -> hit -> "Set as parent" fallback path is intact. Do NOT add a second pick mechanism or copy the resolution/guard.

**Restructure surface Slice 1b-beta2 conventions (feat 1ed9d3b7 -- row-own-position control):**

- **The control + placement.** `RestructureModal` gains a "This row's position" control (its own bordered box) placed BETWEEN the reclassified-row description line and the "Children (N)" box -- the heavy with-children path only. Two radio options under the heading: (1) **"Keep current position (under {oldParentLabel})"** -- DEFAULT, pre-selected; (2) **"Move this row under a new parent"**. State: `rowPosition: "keep" | "move"` (default `"keep"`) + `rowParentIdx: number | null` (resolved target: `-1` = top-level, `>=0` = picked row_index, `null` = not yet resolved). Toggling via `selectRowPosition(pos)` resets `rowParentIdx` + the shared `currentHit` (the two choices are independent; `rowParentIdx` otherwise survives child-option changes).
- **Picker REUSE, no duplication (S5).** When `rowPosition === "move"` and `rowParentIdx === null`, the box reveals the SAME `SheetSearchView` mount + the SAME `hitRowIndex` useMemo (`currentHit` -> `rows.find(source_row_number === hit.row_number)`) + the SAME no-match guard ("This row isn't a selectable parent") the child pickers use, plus a "Set as parent" button (disabled until `hitRowIndex !== null`) AND a "Top level" button (sets `rowParentIdx = -1`, mirroring how children can be sent to root). Once resolved it collapses to a one-line summary (`targetLabel(rowParentIdx)`) with a "change" link -- mirroring option 3. There is NO second pick mechanism; the row picker shares `currentHit`/`hitRowIndex` with the child pickers (so typically only one picker is open at a time; the resolved value lives in separate state).
- **Save assembly + gating.** `row_new_parent` is added to the `save_review_restructure` call ONLY when `rowPosition === "move" && rowParentIdx !== null` (`...(cond ? { row_new_parent: rowParentIdx } : {})`); option "keep" omits the param entirely (S4 backwards-compat shape). `canSave` extends: `if (rowPosition === "move" && rowParentIdx === null) return false;` -- a chosen "move" with nothing resolved disables Save (same no-silent-incomplete principle as the child options). `child_moves` assembly is unchanged.
- **Light path untouched (F4).** The childless reclassify path is the `ReviewTree` AlertDialog (a DIFFERENT file, out of scope) -- it is NOT grown to support a standalone row-reparent this slice. Only rows WITH children (which open this modal) get the row-position control.
- **Error surfacing (F5).** A backend cycle throw now possibly caused by the ROW's own move surfaces inline via the existing `saveError` catch; the modal stays open; nothing is written. No new error machinery.
- **Response type.** The LOCAL `SaveReviewRestructureResponse` interface gains `row_moved?: boolean` (additive; boqTypes.ts remains out of scope -- the response type still lives locally in the modal). The success path still calls `onRestructured(res.message.edited_at)` unchanged (a restructure IS a real edit; the existing `handleSaved` SWR-revalidate path reflects the moved row + children).

**Restructure surface Slice 1b-beta2b conventions (feat 20e1f5a7 -- childless row-position + real error messages):**

Frontend-only completeness slice. Files touched: `RestructureModal.tsx`, `ReviewTree.tsx`. Backend UNTOUCHED (the childless wire shape is already certified by backend T2/T4).

- **D1 -- error extraction via `getFrappeError()` (THE house pattern; NEW catch blocks should use it).** Five catch blocks swapped from the inline `e instanceof Error ? e.message : typeof e === "object" && "message" in e ? ... : "<static>"` ladder to `setX(getFrappeError(e) || "<static>")`: RestructureModal.handleSave (-> setSaveError), ReviewTree confirmChildlessReclassify (-> setRestructureError), confirmValueSave (-> setSaveError, after the existing `setPendingEdit(null)`), saveTextField (-> setSaveError), saveRemark (-> setRemarkError). **Root cause:** the frappe-react-sdk rejects with a PLAIN OBJECT whose `.message` is a hardcoded `'There was an error.'`; the real `frappe.throw` text travels in `_server_messages` (a stringified JSON array of stringified JSON objects). `getFrappeError` (`src/utils/frappeErrors.ts`) decodes `_server_messages` first, then `exception` (stripping the `frappe.exceptions.X:` prefix), then `message`/`toString`. **Fallback choice:** each site KEEPS its prior static string as a trailing `|| "..."` -- `getFrappeError` has its own generic fallbacks but can return `""` in one edge case (`_server_messages === "[]"` -> empty `.join`), so the `||` guard is retained and reads naturally. `frappeErrors.ts` + its 4 pre-existing call sites are UNTOUCHED (consume the helper; do not "improve" it).
- **D2a -- childless AlertDialog radios + route-on-select (ReviewTree).** The childless reclassify AlertDialog gains a "This row's position" control (two radios) between the description and the error/footer: (1) **"Keep current position"** -- rendered `checked readOnly` (always the resting selection, since the dialog closes the instant "move" is picked); Confirm -> `confirmChildlessReclassify` UNCHANGED (the byte-for-byte keep path: child_moves:{}, no row_new_parent, one Confirm click) [S5]. (2) **"Move this row under a new parent"** -- its `onChange` routes ON SELECT (not on Confirm): `setRestructureModal({row, newClassification})` + `setChildlessConfirm(null)` + `setRestructureError(null)`, handing off to the SAME `setRestructureModal` state the with-children branch uses. **Why route-on-select:** the AlertDialog (`max-w-lg`) is too small to host the `max-w-6xl` picker, so "move" cannot complete in-dialog -- an extra Confirm to bounce dialogs would be a pointless click; the LC matrix reads this way too (LC-iii spells out "-> Confirm" for keep, LC-iv omits it for move). No local choice-state is needed (keep is always the displayed selection); reset-on-open is trivially satisfied.
- **D2b -- RestructureModal zero-children adaptation (ALL gated on `children.length === 0`; with-children UNCHANGED [S6]).** (1) The "Children (N)" box and the five-options block are wrapped in `{children.length > 0 && (...)}` -- hidden for a childless row. The option-3/option-4 picker sub-blocks already render only when `option === 3/4`, so with `option` staying `null` they are naturally hidden (no gating added). (2) `canSave`'s first line `if (option === null) return false;` becomes `if (children.length > 0 && option === null) return false;` -- for a childless row the gate is the row-position rule ALONE (`rowPosition === "move" ? rowParentIdx !== null : true`); the `option === 3/4` checks stay (inert when `option` is null). (3) Title/description adapt: childless -> title `Reclassify and position row {N}`, description drops the "children" language (`...Choose where this row should go.`). (4) **`rowPosition` lazy initializer:** `useState<"keep"|"move">(() => rows.filter(r => r.effective_parent_index === row.row_index).length === 0 ? "move" : "keep")` -- a childless row reaches the modal ONLY via the move route, so it opens with "move" active + picker showing; a with-children row opens "keep" (S6). The inline child-count recompute is required because the `children` memo isn't defined yet at the state line. `buildChildMoves()` already returns {} with zero children (every branch loops over `[]`, and `option === null` falls through to `{}`) -- the save assembly is NOT special-cased. The childless entry is a NEW entry point into the SAME modal, not a fork.
- **Verification.** tsc 0 errors in both touched files (project baseline 3177 unchanged); in-container build exit 0. No Frappe unit tests (frontend slice). Manual live-cert LC-i (the LC10 closer -- the cycle message now surfaces inline on a with-children row) .. LC-vii (with-children regression spot-check) pending Nitesh.

**§9 #158 RestructureModal polish conventions (FRONTEND ONLY, `RestructureModal.tsx` only):**

Two owner-locked fixes. Files touched: `RestructureModal.tsx` ONLY (no `SheetSearchView.tsx`, no
`dialog.tsx`, no backend, no doctype, no `boqTypes.ts`).

- **Finding-2 -- outside-click dismiss disabled, ESC kept (THE convention).** The modal's `<DialogContent>`
  carries `onInteractOutside={(e) => e.preventDefault()}`. This is the shadcn `Dialog` (Radix) -- `DialogContent`
  forwards `{...props}` to `DialogPrimitive.Content`, so the Radix dismiss prop is set MODAL-SIDE with NO edit to
  the `dialog.tsx` primitive. **Use `onInteractOutside`, NOT `onPointerDownOutside`** -- it intercepts both
  outside pointer-down AND outside focus, the fuller guard against losing staged work. **Do NOT route this
  through `onOpenChange`** -- that handler (`(o) => { if (!o) onClose(); }`) is SHARED by ESC, the close-X, and
  the programmatic Cancel/Save closes; intercepting there would kill ESC. Net behaviour: a stray outside click
  is inert; ESC, Cancel, Save, and the close-X all close the modal normally. Apply this exact pattern (dedicated
  `onInteractOutside` on `DialogContent`, leave `onOpenChange` alone) to any future wizard modal that must not
  dismiss-on-outside-click while keeping ESC.
- **Finding-7 -- pick buttons ABOVE the picker (Path 1).** In EACH of the three picker sites the pick-action
  button row is a sibling rendered BEFORE the `<SheetSearchView>` mount: order is `[helper <p>] -> [button row]
  -> [<SheetSearchView>]`, all inside the existing `rounded-md border ... space-y-2` container. The three sites:
  (1) row-own-position move (`rowParentIdx`-driven: Set as parent + Top level), (2) option-3 one-new-parent
  (`blockParentIdx`-driven: Set as parent), (3) option-4 per-child (`perChild`-driven: Set as parent + Cancel
  pick). The relocation is PURE -- buttons, handlers, labels, `disabled` logic, and the no-match guard span are
  byte-for-byte the prior JSX, only reordered above the picker. Rationale: SheetSearchView v2's wrapping cells
  made the grid tall, pushing the pick action below the fold.
- **REFRAME (do NOT re-chase).** The handover's literal #158 finding-7 wording wanted the buttons aligned INSIDE
  SheetSearchView's search-bar row (top band). The §9 #158 recon PROVED that unreachable without editing
  `SheetSearchView`: its search-bar band is the first child of the component's own root `space-y-3` div, and the
  component exposes no slot/render-prop for injecting content there -- a consumer can only place siblings ABOVE
  or BELOW the whole component. Path 1 (above-the-picker) was the owner-chosen, modal-side-only delivery of the
  intent (no scroll-to-pick). Any future "align in the search bar" attempt REQUIRES a SheetSearchView edit (and
  re-cert) that this slice deliberately avoided.
- **Verification.** tsc 0 new wizard-file errors (project baseline 3177 unchanged); in-container build exit 0.
  No Frappe unit tests (frontend slice). Manual live-cert LC1 (outside-click inert, selections preserved) / LC2
  (ESC + Cancel + Save + close-X still close) / LC3-LC4 (pick buttons above the grid + pick still works in all
  three sites) / LC5 (full reclassify-with-children round + §9 #162 door regression) pending Nitesh.

**Slice A2 edit-log clarity conventions (`ReviewTree.tsx` ONLY; render-time, edit_log shape UNCHANGED):**

Three render-time improvements to the row-detail panel's "Edit history" block. FRONTEND ONLY -- no backend, no
doctype, no migration; the stored `edit_log` entry shape (`{field, from, to, by, at, reason[, area][, rate_subkey]}`)
is untouched. boqTypes.ts is NOT edited (the `EditLogEntry` type already exists + is exported -- only the import
line in ReviewTree gained it). root CLAUDE.md is NOT touched (no backend change).

- **Excel-row parents -- REUSE `byIdx`, never build a second map (THE rule).** A stored `human_parent` entry's
  `from`/`to` are INTERNAL `row_index` (recon Q1: from = effective_parent_index, to = raw value, null = root).
  The new `editParentLabel(v)` (in-component, closes over the SAME `byIdx` map the Parent column uses at its
  cell render) returns: `null`/`undefined`/negative -> `root`; a number with a `byIdx` hit -> `row {source_row_number}`;
  a number with NO hit -> `String(n)` (raw-number defensive fallback, no crash). **Root copy = lowercase `root`
  to match the detail panel's own `origParentLabel`/`effParentLabel`** -- the Parent COLUMN renders BLANK for
  root, which is unusable inside a `from -> to` phrase, so the closest in-panel sibling copy was matched instead.
- **Honest verb from `entry.field` (`describeEditEntry`).** Returns `{ verb, detail, showField } | null`:
  `human_classification` + `from !== to` -> `{verb:"Reclassified", detail: CLS_LABELS[from] -> CLS_LABELS[to]}`;
  `human_classification` + `from === to` -> **`null` (SUPPRESS)**; `human_parent` -> `{verb:"Moved parent",
  detail: editParentLabel(from) -> editParentLabel(to)}`; everything else (value/text/per-area) -> `{verb:"Edited",
  detail: raw from->to, showField:true}` so the field name is still shown. The area/rate_subkey suffix render is
  KEPT verbatim for per-area entries.
- **The #162 no-op reclassify is DROPPED before the `.map`, not rendered blank.** The standalone "Change parent"
  door (§9 #162) writes a no-op same-value `human_classification` entry ALONGSIDE the real `human_parent` move;
  rendering it would duplicate the move. `describeEditEntry` returns `null` for it; the render IIFE does
  `[...edit_log].reverse().map(e => ({entry:e, d:describeEditEntry(e)})).filter((x): x is {...} => x.d !== null)`
  (type-guarded filter) so suppressed entries never produce an `<li>`. **"No edits yet." reflects the
  POST-suppression list** (an all-suppressed log shows the empty fallback -- a defensive edge; in practice the
  no-op always rides with a real human_parent entry).
- **Timestamp -- string slice, no library (`formatEditAt`).** `at` is a local `"YYYY-MM-DD HH:MM:SS.ffffff"`
  string; `formatEditAt(at)` = `typeof at === "string" ? at.slice(0,16) : ""` -> `"YYYY-MM-DD HH:MM"`. Chosen
  over a date formatter to avoid any timezone reparse surprise; no `formatDate` import added.
- **Backwards-compat.** Old entries read unchanged: old `human_parent` indices translate (or raw-number
  fallback); a missing/odd `at` -> empty string; non-parent entries -> "Edited" + raw values. No write-path or
  shape dependency -- purely how existing data is displayed.
- **Verification.** tsc 0 NEW wizard-file errors (filtered `boq-wizard|boqTypes` -> empty; 3177 baseline
  unchanged) + in-container Vite build exit 0 (`built in 4m 50s`, PWA 168 entries). No Frappe unit tests
  (frontend render-only). Manual live-cert LC1-LC7 pending Nitesh (see the A2 status block above).

**Slice A1 status-rename + Finalized config-freeze conventions (all 7 wizard frontend files + backend + migration):**

- **The rename is LITERAL-coverage-critical (THE rule).** `wizard_status` is compared `===` against string
  literals across backend AND frontend, so "Reviewed"->"Config Done" / "Parsed Check Done"->"Finalized" had to
  hit EVERY site or a branch silently breaks. The gate was a zero-hit `grep -rn "Reviewed"|"Parsed Check Done"`
  over the python package + `frontend/src`; the ONLY justified residuals are the migration map, two
  intentional-old-name regression tests, `ReviewTree.tsx`'s "Reviewed -- looks OK" flag text (NOT a status),
  and docstrings. **A naive quoted-`"Reviewed"` grep MISSES the doctype options token** (`\nReviewed`, no
  surrounding quotes) -- edit `boq_sheet_draft.json` options FIRST and read it back.
- **Identifiers carrying the old name were renamed too (zero-justification goal).** Capital-`Reviewed`
  identifiers match the gate grep, so they were renamed: `newlyDesignatedReviewed`/`pendingReviewedNames`
  (BoqHubPage), `dropIfReviewed`/`handleMarkReviewed` (SheetConfigPanel) -> `*ConfigDone`. Lowercase
  identifiers (`reviewedDraftsForDialog`, `reviewedCount`, `reviewedDrafts` prop) are NOT matched by the
  case-sensitive grep and were left.
- **STATUS_PILL keys are the lookup -- rename the KEY (SheetCard).** `STATUS_PILL["Config Done"]` /
  `STATUS_PILL["Finalized"]`; labels set to "Config Done"/"Finalized" (the old "Checked" label is gone). The
  pill is keyed by the effective status string, so a stale key would silently fall back to the Pending pill.
- **Finalized config-freeze = `_guard_sheet_not_finalized` (backend) + a `<fieldset>` lock (frontend).** A
  Finalized sheet's config write is REJECTED backend-side in all five writers (after the parse guard); the
  frontend mirrors this: SheetConfigPanel derives `finalized = wizardStatus === "Finalized"` and wraps the form
  in `<fieldset disabled={isParsing || finalized}>` (native cascade locks every control). This SUPERSEDES the
  old dirty-marker asymmetry (the Parsed->Config-Done drop is untouched; a Finalized sheet is rejected before
  reaching it).
- **Un-mark-and-edit (the reversibility affordance).** When `finalized`, a TEAL ShieldCheck banner shows an
  "Un-mark and edit" button -> a confirm `AlertDialog` ("returns to Parsed, must be re-finalized") -> the
  EXISTING `unmark_sheet_parsed_check_done` endpoint (**function name unchanged** -- only the status strings
  moved) -> `onSaveSuccess()` re-fetches so `wizardStatus` flips to "Parsed" and the fieldset unlocks. The
  AlertDialog renders OUTSIDE the fieldset (portals to body, so it stays interactive). **Banner precedence:
  parsing amber beats finalized teal** (`{isParsing ? amber : finalized ? teal : null}`). SheetCard's Finalized
  branch gains an "Edit config" -> `onOpenSpoke` button so the affordance is reachable (the Finalized card
  previously had no spoke route).
- **Data migration is mandatory + one-column.** Option-string rename does NOT touch stored rows; the idempotent
  patch `v3_0/migrate_boq_sheet_draft_status_rename` rewrites `BoQ Sheet Draft.wizard_status` (the ONLY field
  storing these strings -- edit_log/exports embed none). `bench migrate` verified 0 old-value rows.
- **Verification.** tsc 0 wizard-file errors (3177 baseline unchanged) + in-container build exit 0 (`✓ built in
  9m 17s`, PWA 168 entries); backend parser 588 + test_parse_run 86 + test_update_sheet_draft 82 +
  test_review_screen 152 green. Live-cert pending Nitesh: pill labels + every status branch render under the new
  names; Finalized card -> Edit config -> teal lock + Un-mark-and-edit round-trip -> panel unlocks + edits land;
  the hub "Export Finalized" button + dialog gate on Finalized sheets; a re-finalize after editing.

**§9 #164 A3-frontend parse-lock conventions (`boqTypes.ts` + `SheetCard.tsx` + `SheetReviewPage.tsx` + `SheetSpokePage.tsx` + `SheetConfigPanel.tsx` + `BoqHubPage.tsx`):**

The frontend parse-lifecycle lock. Backend floor (per-sheet `parse_in_progress`, double-fire guard, write
guards, `check_parse_status`) is feat 004f80a8; this is FRONTEND ONLY (no backend, no `ReviewTree.tsx` --
its `readOnly` gating already freezes everything).

- **The signal flows for free (THE pattern).** `BoQSheetDraft.parse_in_progress?: 0 | 1` (boqTypes.ts) rides
  the `useFrappeGetDoc("BOQs", boqId)` payload (one-level child table -- Recon #2 Q3), so every surface that
  already fetches the BOQs doc reads it from its EXISTING draft lookup -- no new fetch, no new prop drilling
  from a fetch. `BOQsDoc.parse_in_progress` (BoQ-level) already existed. `parse_job_id`/`parse_enqueued_at`
  are deliberately NOT typed -- the frontend never reads them; `check_parse_status` returns a derived `state`.
- **SheetCard: disable + indicate ONLY the parse-admissible branches.** `isParsing = draft.parse_in_progress
  === 1`. The branches that can be superset-marked mid-parse are Reviewed / Parsed / Parsed Check Done AND
  **Parse failed** (v5.46: Parse-failed is force-re-parse eligible, so the enqueue superset can mark it; the
  worker reconcile clears it if assemble drops it, but the card must reflect the transient mark). Each
  actionable control on those four branches gets `disabled={isSaving || isParsing}` (Edit/Review nav +
  Set-pending + Re-parse + Export CSV); a compact `<Loader2 animate-spin/> Parsing...` amber chip renders by
  the status pill. Pending/Skip/Hidden/General-specs are NEVER parse-marked -> untouched.
- **SheetReviewPage: amber banner BEATS the teal D1 banner.** The existing `boq.sheet_drafts.find(...)` lookup
  now captures the whole draft -> `sheetStatus` + `isParsing = draft?.parse_in_progress === 1`. `readOnly=
  {isChecked || isParsing}` on `ReviewTree` (reuses the entire D1 freeze machinery). An AMBER parsing banner
  (border-amber-300/bg-amber-50 + dark, Loader2 icon, one "Go to hub" button) renders when `isParsing` and
  TAKES PRECEDENCE: the teal "Parsed Check Done" banner is gated to `isChecked && !isParsing` (parsing is the
  transient state worth surfacing first).
- **SheetSpokePage -> SheetConfigPanel: a `<fieldset disabled>` locks the whole panel.** The spoke derives
  `isSheetParsing` from its `:58` draft lookup and passes `isParsing` to SheetConfigPanel. The panel accepts
  `isParsing?: boolean`, renders an amber lock banner, and wraps ALL form content in a native `<fieldset
  disabled={isParsing} className="space-y-5 border-0 p-0 m-0 min-w-0 disabled:opacity-60">` -- native fieldset
  disabling cascades to every descendant shadcn Button/Input/Checkbox + Radix Select trigger (all `<button>`/
  `<input>`), so ONE flag locks Sections 1-4 + Save + Mark-as-reviewed with no per-control edits. Belt-and-
  braces: `dropIfReviewed` early-returns `if (isParsing)` so no programmatic write can fire either.
- **BoqHubPage: one-shot self-heal on mount.** A `useFrappePostCall("...parse_run.check_parse_status")` (the
  wizard's imperative GET-capable form -- NOT `useFrappeGetCall`, to avoid SWR re-fetch loops re-hitting a
  self-healing endpoint) is called once in a `useEffect([boqId])`. On `state === "cleared" | "cleared_stale"`
  -> `void mutate()` so the EXISTING `useEffect([boq])` on-mount recovery re-reads the healed BoQ + per-sheet
  flags. `running`/`idle` -> no action. The call is NON-FATAL by contract: any failure is `console.error`-only;
  the hub renders regardless. The `cancelled` unmount guard mirrors the upload-screen socket pattern.
- **§9 #161 getFrappeError migration (SheetConfigPanel was the lone un-migrated wizard writer).** Import
  `getFrappeError` from `@/utils/frappeErrors` (ReviewTree form). `handleSave` + `handleMarkReviewed`'s outer
  catches -> `setSaveError(getFrappeError(e) || "Save failed. Please try again.")`. The two inner static-string
  catches (work-packages step, status step) -> `${"...failed."} ${getFrappeError(e)} Click ... again.`.trim()
  (catch param changed from bare `catch {` to `catch (e: unknown)`). `dropIfReviewed`'s `callSetStatus` gains a
  `.catch((e) => setSaveError(getFrappeError(e) || "..."))` -- previously swallowed. Net effect: a stale-tab
  mid-parse config write surfaces the REAL backend `frappe.throw` text (from `_server_messages`) instead of the
  SDK's generic "There was an error." `frappeErrors.ts` is CONSUMED, not modified.
- **STALE FILE-IN-SCOPE PATH (recorded).** The build brief listed `frontend/src/types/boqTypes.ts`; the real
  file is `frontend/src/pages/boq-wizard/boqTypes.ts` (all wizard types live in the page folder). The correct
  file was edited + staged.
- **Verification.** tsc 0 new wizard-file errors (filtered `boq-wizard|boqTypes` -> only the marker, empty) +
  in-container Vite build exit 0 (`✓ built in 3m 46s`, PWA 168 entries). No Frappe unit tests (frontend-only).
  Manual live-cert pending Nitesh: LC1 mid-parse card buttons disabled + Parsing chip; LC2 spoke locked +
  amber banner + dropIfReviewed inert; LC3 review screen read-only + amber banner (beats teal); LC4 post-parse
  all three unlock via socket->mutate without manual refresh; LC5 stale-tab config save shows the REAL backend
  message (getFrappeError proof); LC6 idle hub loads normally (check_parse_status idle, no side-effects);
  LC7 stuck-flag self-heal on mount -> cleared -> surfaces unlock.

**Slice D2b hub export conventions (`exportReviewXlsx.ts` NEW + `ExportWorkbookDialog.tsx` NEW + `exportReviewCsv.ts` + `BoqHubPage.tsx` + `SheetCard.tsx`):**

Hub-level export of reviewed sheets: a GLOBAL multi-sheet .xlsx workbook + a PER-CARD single-sheet .csv. FRONTEND
+ one dependency; no backend, no doctype, no `boqTypes.ts`.

- **`exceljs`, dynamically imported -- the dependency rule.** `const ExcelJS = (await import("exceljs")).default;`
  in `exportReviewXlsx.ts` -- NEVER a static import. The dynamic import keeps exceljs in its OWN lazy chunk
  (`exceljs.min-*.js`, ~942 kB) so it is ABSENT from the hub chunk + the entry chunk and fetched only when an
  export runs. The npm `xlsx` (SheetJS) package is FORBIDDEN -- abandoned on the public registry, two unpatched
  high-severity CVEs (prototype pollution + ReDoS). **Install deps IN-CONTAINER** (`yarn add ... ` inside the
  frappe container) -- host-side installs corrupt the Linux-native node_modules (the rollup lesson). This is the
  precedent for any future heavy wizard dep: dynamic-import + in-container install + reject abandoned/CVE'd libs.
- **`buildReviewSheet` is the shared core (no drift between .csv and .xlsx).** `exportReviewCsv.ts` exports
  `buildReviewSheet({ sheetName, rows, columnDescriptors }) -> { headers: string[], cells: SheetCell[][] }`
  (`SheetCell = string | number | null`). It holds the column set + value resolution; BOTH writers consume it, so
  the workbook and the CSV can never diverge in columns/order/values. **Cells are RAW TYPED:** numbers stay JS
  numbers (Excel-row, parent-rows, depth, numeric descriptor values), text stays string, empty -> null. The CSV
  writer does `cells.map(r => r.map(csvCell))` (csvCell(null)="" , csvCell(n)=String(n)) so the .csv stays
  BYTE-IDENTICAL to D2; the xlsx writer feeds the typed cells straight to exceljs so numbers land as real numbers.
  When extending the export, change `buildReviewSheet` -- never one writer alone.
- **`exportReviewXlsx.ts` (workbook writer).** `buildAndDownloadReviewWorkbook({ boqName, sheets })`,
  `sheets = Array<{ sheetName, rows, columnDescriptors }>` -- the FETCH happens in the dialog, this module does
  zero network I/O. One worksheet per entry in order: `buildReviewSheet` -> `ws.addRow(headers)` with
  `headerRow.font = { bold: true }` -> `ws.addRows(cells)`. Download: `workbook.xlsx.writeBuffer()` -> Blob
  (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) -> anchor-click + revokeObjectURL, NO BOM
  (xlsx never needs one). Filename `${sanitizeFilename(boqName)}_review_${yyyyMMdd_HHmmss}.xlsx` (the D2
  `sanitizeFilename`, now exported; bare basename, `.xlsx` once).
- **Tab-name sanitize + dedupe -- TAB TITLE ONLY, data verbatim (#152).** `sanitizeSheetTabName(name)` (exported):
  replace `: \ / ? * [ ]` -> `_`, trim leading/trailing whitespace (the trailing-space corpus names "Electrical "
  / "HVAC " are real -- Excel REJECTS them as tab titles, so the trim is load-bearing), truncate to 31, fall back
  "Sheet". `dedupeTabName(base, used)`: on collision append " (2)"/" (3)"... truncating the base to keep <=31. The
  Sheet Name COLUMN inside each tab stays the verbatim name. This is the FIRST tab-name guard in the codebase --
  there was none before.
- **`ExportWorkbookDialog.tsx` (NEW) -- ParseRunDialog pattern.** Props `{ open, onOpenChange, boqName,
  eligibleSheets }`; the hub computes eligibility (`getEffectiveStatus === "Parsed Check Done"`). Checklist ALL
  PRE-TICKED (the `[open]`-effect seed + functional `toggleSheet` + Checkbox/`<label htmlFor>` rows). Confirm =
  a SEQUENTIAL `for` loop: one imperative `get_review_rows` `.call()` per ticked sheet (GET-capable endpoint via
  `useFrappePostCall` -- the wizard's imperative-multi-read convention; sheet_name VERBATIM #152), a progress line
  ("Fetching {sheet} ({i}/{n})..."), controls disabled + NOT dismissible mid-flight. ANY fetch or the build step
  throwing -> ABORT (no partial file), inline `text-destructive` naming the failed sheet (`getFrappeError` +
  fallback). Confirm label "Export N sheets", disabled at zero ticked.
- **Hub + card wiring.** `BoqHubPage`: `exportEligibleSheetNames`, a footer "Export reviewed" Tooltip-button (a
  `<span tabIndex={0}>` sibling of Re-parse/Parse, Download icon, disabled when empty), and a `handleExportCsv`
  (its own `useFrappePostCall("...get_review_rows")` -> the EXISTING `buildAndDownloadReviewCsv`) passed to each
  SheetCard as `onExportCsv`. `SheetCard`: new optional `onExportCsv?: (sheetName) => Promise<void>` (the
  onOpenReview/onReparse convention) + an "Export CSV" Button in the "Parsed Check Done" branch with a LOCAL
  `exporting` busy state (disables + spinner) and failure -> the card's existing inline `cardError` via
  `getFrappeError`. Hub owns the fetch; card stays fetch/router-free. **Per-card = .csv (quick one-sheet grab),
  global = .xlsx (always a workbook, even for one ticked sheet).**
- **Verification.** tsc 0 new wizard-file errors (filtered `boq-wizard|exportReview|ExportWorkbook|BoqHubPage|
  SheetCard|boqTypes` -- empty; baseline 3177 unchanged) + in-container Vite build exit 0 (`✓ built in 6m 54s`,
  PWA 168 entries); exceljs confirmed in its own lazy chunk, absent from the hub + entry chunks. No Frappe unit
  tests (frontend-only). Manual live-cert LC1-LC8 pending Nitesh: (1) D2 CSV regression unchanged; (2) modal
  eligibility gating + pre-ticked list; (3) progress + abort-on-failure; (4) trailing-space-name workbook (tabs
  sanitized/de-duplicated, Sheet Name column verbatim); (5) numbers AS numbers in xlsx; (6) per-card .csv matches
  the screen .csv; (7) lazy exceljs chunk -- hub load unaffected; (8) one-sheet global export still .xlsx.

**Slice D2 review CSV export conventions (`exportReviewCsv.ts` NEW + `SheetReviewPage.tsx` + `ReviewTree.tsx`):**

A per-sheet CSV export of the review screen's data. FRONTEND ONLY; no backend, no doctype, no `boqTypes.ts`.

- **Wizard-local writer, NOT the shared util (THE decision).** `src/pages/boq-wizard/exportReviewCsv.ts`
  exports ONE function `buildAndDownloadReviewCsv({ boqName, sheetName, rows, columnDescriptors })`. The shared
  `src/utils/exportToCsv.ts` is deliberately NOT used and NOT touched -- it is TanStack-`ColumnDef`-coupled with
  15 callers and the wrong shape for the descriptor-driven review payload (recon 2026-06-12); reusing it would
  mean manufacturing fake ColumnDefs. Its 8 baseline tsc errors stay as-is (the old "fix exportToCsv before
  Slice D" carry is retired as N/A). Any future wizard export extends THIS writer, not the shared one.
- **Reuse the tree's helpers, never copy (THE no-drift rule).** The writer imports `resolveDescriptorValue`,
  `computeDepths`, `CLS_LABELS`, `FIXED_ROLE_DEDUPE` from `ReviewTree.tsx` (each gained the `export` keyword --
  all were already module-level; a trivial lift, zero behaviour change) and `ROLE_LABELS` from `boqTypes.ts`
  (already exported). So the CSV's depth, per-area/singleton value resolution, classification labels, and
  sl_no/description dedupe are byte-identical to what the tree renders. Do NOT re-implement any of these in the
  writer.
- **Column set + the row_notes-vs-append_notes distinction.** Fixed columns: Sheet Name (verbatim #152) |
  Excel Row | Sl.No | Description | Level (effective depth) | Classification (Original)=`classification` +
  Classification (Final)=`effective_classification` (both via `CLS_LABELS`) | Parent Excel Row
  (Original)=`parent_index`->source_row_number + (Final)=`effective_parent_index`->source_row_number (blank if
  root; human_is_root => root). Then one DATA column per `ColumnDescriptor` EXCLUDING sl_no/description roles
  (`FIXED_ROLE_DEDUPE` -- they are the dedicated Sl.No/Description columns, so no duplication), header mirrors
  the tree VERBATIM (`{col} — {ROLE_LABELS[role]}{ · area}`), value via `resolveDescriptorValue`, **numbers RAW
  (`String(val)`, NOT the display formatter** -- thousands separators break Excel numeric parsing). Trailing:
  Row Notes (`row_notes`, single replace-semantics field) | Append Notes (`append_notes_raw`) | Remarks |
  Edited (Yes/No via the SAME isEdited predicate the tree's Status column uses) | Edited By | Edited At.
- **`append_notes_raw` is a `dict[str,str]`, not an array.** CORRECTED shape (append-to-notes-as-columns slice,
  live-verified on BOQ-26-00166): keys are `column_headers.get(col_letter, col_letter)` -- the source column's
  HEADER TEXT when `sheet_config.column_headers` maps that letter, ELSE the bare Excel COLUMN LETTER (the parser's
  fallback, classifier.py:983). On BOQ-26-00166 `column_headers` is `{}`, so its keys are letters ("Z","AB").
  Empty append columns are OMITTED entirely (absent key = no note; there is NO `"AA": ""`). Values are STRINGS even
  when numeric-looking (`"152400"`). (The earlier "keys are the header label" note was only half-right -- it is
  header-OR-letter.) The writer flattens it to `"key: value"` pairs joined `" | "` (flat, no JSON braces,
  preserves source-column context); it defensively also handles array (join values) / string (verbatim) / null
  (""). Do NOT dump JSON into the cell (the §8 "no JSON blobs" rule).
- **Writer mechanics.** `Papa.unparse([headers, ...rows])`; prepend a UTF-8 BOM (`﻿`) before the Blob
  (`text/csv;charset=utf-8;`) so Excel renders rupee/unicode; anchor-click download + `revokeObjectURL`.
  Filename `${boqName}_${sanitize(sheetName)}_review_${yyyyMMdd_HHmmss}.csv` -- `sanitize` (trim + replace
  filename-illegal chars/whitespace with `_`) is FILENAME-ONLY; build a bare basename and append `.csv` exactly
  once (the shared util's double-extension trap). ALL rows in row_index order -- export is the sheet's data, NOT
  the current view (filters/collapse/search ignored).
- **Export button.** Header right-cluster (first child, before the D1 Mark button), `size="sm"
  variant="outline"`, Download icon, "Export CSV", `disabled={reviewLoading || rows.length === 0}`, NOT gated on
  `sheetStatus` (a frozen/checked sheet is the prime export target). Inline `onClick` -> `buildAndDownloadReviewCsv`
  with the in-hand `rows` / `columnDescriptors`; no dialog, no backend call.
- **Verification.** tsc 0 new wizard-file errors (filtered `ReviewTree|boqTypes|boq-wizard|SheetReviewPage|
  exportReviewCsv` -- empty) + in-container build exit 0 (`✓ built in 5m 47s`, PWA 166 entries). No Frappe unit
  tests (frontend-only). Manual live-cert LC1 (multi-area sheet -> diff CSV columns vs the screen) / LC2
  (edited-row original-vs-final classification + parent pairs) / LC3 (remarks + row-notes + append-notes
  columns) / LC4 (rupee/unicode renders in Excel via the BOM) / LC5 (a trailing-space sheet name: body verbatim,
  filename sanitized) / LC6 (export works on a frozen/checked sheet) / LC7 (numbers parse AS numbers in Excel,
  not text) pending Nitesh.

**Slice D1 Parsed Check Done freeze conventions (`boqTypes.ts` + `SheetReviewPage.tsx` + `ReviewTree.tsx`):**

The read-only freeze + mark/un-mark surface for the review screen. Owner-LOCKED model: a sheet at
"Parsed Check Done" is FULLY FROZEN (no value/text/area edits, no restructure, no remarks, no flag
dismissals); the freeze is enforced BOTH frontend (gated affordances) AND backend (write-endpoint guards --
see root CLAUDE.md). The frontend gating is the UI line of defence; the backend `_guard_sheet_not_frozen`
is the durable backstop.

- **Status derivation from `boq.sheet_drafts` (THE pattern -- no new fetch).** `SheetReviewPage` ALREADY
  fetches the BOQs doc via `useFrappeGetDoc("BOQs", boqId)`. `sheet_drafts` is a ONE-LEVEL child table, so it
  serializes on that payload -- the sheet's `wizard_status` is already in hand. Derive:
  `const sheetStatus = boq?.sheet_drafts?.find(d => d.sheet_name === (sheetName ?? ""))?.wizard_status;`
  (sheetName VERBATIM -- no trim, #152) and `const isChecked = sheetStatus === "Parsed Check Done";`. Do NOT
  add a status fetch. **Destructure `mutate: boqMutate`** from that same `useFrappeGetDoc` and call it after
  every successful mark / un-mark so the banner + button react (the get_review_rows `mutate` is a DIFFERENT
  hook -- mark/un-mark change the BOQs doc, not the rows, so they need `boqMutate`).
- **The Mark button (header right cluster).** Rendered ONLY when `sheetStatus === "Parsed"` (a
  Mark-and-the-banner are mutually exclusive by construction). It opens a LIGHT-CONFIRM `AlertDialog`; Confirm
  POSTs `mark_sheet_parsed_check_done` with `confirm:false`. `ok:true` -> close + `boqMutate()`. `ok:false`
  (breaks present) -> the SAME dialog switches to the ESCALATION view (`markBreaks` state non-null) listing
  each break (`BREAK_TYPE_LABELS[type]` + "Excel row {source_row_number}" + reason); the action button becomes
  "Mark anyway" which re-POSTs with `confirm:true`. A backend throw surfaces inline via `getFrappeError()`.
  The confirm action is a PLAIN `Button` (NOT `AlertDialogAction`) so the dialog stays open to escalate or
  show an error.
- **The read-only banner (when `isChecked`).** A full-width strip ABOVE the flags strip, TEAL family
  (`border-teal-300 bg-teal-50` + dark variants -- matching the "Checked" pill, NOT destructive red), with a
  `ShieldCheck` icon, the read-only explanation, and two buttons: "Un-mark" (light-confirm AlertDialog ->
  `unmark_sheet_parsed_check_done` -> `boqMutate()`) and "Go to hub" (reuses the Back nav `handleBack`).
- **`readOnly` prop on ReviewTree gates ALL 11 write affordances at their render sites.** `SheetReviewPage`
  passes `readOnly={isChecked}`. In `ReviewTree`, `readOnly?: boolean` (default false) HIDES (does not merely
  disable): the reclassify pill DropdownMenu (the plain classification text stays), the "Change parent" door
  (`canChangeParent && !readOnly`), the three edit blocks (`!readOnly && editable*Descriptors.length > 0`),
  the "Looks OK" button (the dismissed "Reviewed -- looks OK" span still shows read-only), and the Remarks
  editor -- which when `readOnly` renders the stored remark as READ-ONLY TEXT if present (else nothing),
  hiding the Textarea + Save. With the triggers gated, the value/area confirm dialog, the childless reclassify
  AlertDialog, and the RestructureModal become UNREACHABLE (all are state-driven and that state is set ONLY by
  the gated triggers -- verified: RestructureModal is imported/mounted only in ReviewTree). Every VIEW
  affordance stays fully live: expand/collapse, the detail panel (provenance, edit history, flag display),
  search, filters, column selector, scroll-to-parent.
- **Verification.** tsc 0 new wizard-file errors (baseline 3177 unchanged); in-container build exit 0
  (`✓ built in 3m 36s`, PWA 166 entries). No Frappe unit tests on the frontend (backend TestParsedCheckDoneFreeze
  / TestUnmark... + mark M1/M2 -> test_review_screen 147 green). Manual live-cert LC1 (Mark on a clean Parsed
  sheet -> banner appears, tree frozen) / LC2 (Mark on a sheet with structural breaks -> escalation dialog lists
  them, "Mark anyway" works) / LC3 (every edit affordance is gone when frozen; view affordances all still work) /
  LC4 (Un-mark -> tree editable again, edits land) / LC5 (Go to hub) / LC6 (a frozen write attempted out-of-band
  is rejected by the backend with the read-only message) / LC7 (reload a checked sheet -> banner persists from
  the payload) / LC8 (regression: a NON-checked sheet behaves byte-for-byte as before -- edits/remarks/restructure/
  dismissals all work) pending Nitesh.

**C-flag-dismissal conventions (per-row "Looks OK" -- `boqTypes.ts` + `ReviewTree.tsx` + `SheetReviewPage.tsx`):**

The per-row advisory-flag dismissal surface. Owner-LOCKED model: PER-ROW (one gesture clears ALL of a row's
currently-computing flags, NOT per-flag); a dismissal is an ACKNOWLEDGMENT, NOT an edit. Backend detail
(the `dismiss_row_flags` endpoint, the 3 `BoQ Review Row` fields, the `_apply_and_save_row_edit` chokepoint
clear-on-edit) is in root CLAUDE.md.

- **`flags_dismissed` is NOT an edit (THE invariant).** A dismissal must NEVER flip the row to "Edited" --
  the `isEdited` predicate (`row.edited_at !== null || edit_log.length > 0`), the Edited/Original pill, and
  the green tint are ALL left UNTOUCHED. The dismissal write path (`dismiss_row_flags`) mirrors
  `save_review_remark`'s bypass: it never stamps `edited_at` / `edit_log`. The frontend refreshes via the
  EXISTING `onRemarkSaved` (mutate only -- a dismissal, like a remark, does NOT advance the sheet-level
  "All changes saved" edit anchor); do NOT wire it to `onSaved`/`onRestructured`.
- **The "Looks OK" button (ReviewTree detail-panel Flags block).** Rendered in the detail panel's "Flags"
  block header (the natural "I've reviewed this row's flags" spot), sitting IMMEDIATELY BESIDE the "Flags"
  label on the LEFT. The header div is `flex items-center gap-2` (NOT `justify-between` -- a `justify-between`
  header right-pushes the button off-screen on a wide sheet, the same class of problem as #158 finding-7;
  bring the action to the eye, left-visible). It calls `useFrappePostCall("...dismiss_row_flags")` with
  `row_index` + `sheet_name` VERBATIM (#152) + `dismissed: true`; `onClick` does `e.stopPropagation()` (the
  table-body click dismisses the detail panel). When the row is ALREADY dismissed it reads "Reviewed — looks
  OK" (a span, not a button) -- NO separate un-dismiss button ships (edit re-opens / re-parse wipes / the flag
  reason stays readable cover the cases). A dedicated `dismissError` state (separate from `saveError` /
  `remarkError`) surfaces failures inline.
- **The dismissed visual = a NEW greyed/checked Info-marker state.** When `row.flags_dismissed` is truthy
  the table-body Info marker switches icon to `CheckCircle2` and colour to muted/grey (NOT amber-active,
  NOT removed -- the flags still EXIST, they're acknowledged); title "Reviewed — looks OK". The flag-reveal
  row appends a muted "Reviewed — looks OK" line (with who/when from `flags_dismissed_by`/`_at`). `isDismissed
  = !!row.flags_dismissed` is computed once per row alongside `hasFlags`/`flagsExpanded`.
- **The summary strip "N <label> – C cleared" (SheetReviewPage).** The existing per-type total (over the
  live `flags` array, which already auto-excludes resolved conditions) is kept; a per-type "cleared" count
  is ADDED = flags of that type whose `row_index` is in `dismissedRowIdx` (= the set of `flags_dismissed`
  rows from the row payload). Rendered as `N <label> – C cleared` when `C > 0`, else `N <label>`. Derived
  FRONTEND-side from the row payload + the flags array -- NO new endpoint, NO new backend data (mirrors the
  C-v2c remark-count strip's per-row-field derivation).
- **Verification.** tsc 0 new wizard-file errors (project baseline 3177 unchanged); in-container build exit 0
  (`✓ built in 6m 46s`). No Frappe unit tests on the frontend (backend TestDismissRowFlags +6 -> 137 green).
  Manual live-cert LC1 (dismiss -> greyed/checked + stays Original + reload persists) / LC2 (summary "N – C
  cleared" rose) / LC3 (edit the dismissed row -> flips Edited AND re-opens) / LC4 (remark on a dismissed row
  -> dismissal STAYS, stays Original) / LC5 (re-parse -> dismissals gone) / LC6 (regression: #159 filter/
  search + Edited/Original pills + green tint + detail panel + restructure modal + remarks all intact)
  pending Nitesh.

**§9 #159 ReviewTree find-&-filter conventions (FRONTEND ONLY, `ReviewTree.tsx` only):**

A find & filter surface on the main review tree. Files touched: `ReviewTree.tsx` ONLY (no SheetSearchView
edit/import -- its hit-stepper PATTERN is MIRRORED, not imported; no backend, no doctype, no `boqTypes.ts`,
no `SheetReviewPage.tsx`). The owner-LOCKED interaction model (findings 6 + 8) -- not open to redesign.

- **CLS_LABELS-6 for the filter, NOT the 4 write-targets (THE convention).** The Classification filter's
  option source is `CLASS_FILTER_VALUES` (a module const = the 6 `CLS_LABELS` keys: `preamble, line_item,
  note, spacer, subtotal_marker, header_repeat`), NOT `ASSIGNABLE_CLASSIFICATIONS` (the 4 restructure
  write-targets). A FILTER reads all 6 existing classification states a row can carry; the 4-value set is
  exclusively for restructure write-targets. Do not conflate them.
- **Status filter predicate = the existing `isEdited` expression.** `statusFilter: "all" | "edited" |
  "original"` (default `"all"`). `passesFilter` re-states `row.edited_at !== null || (Array.isArray(edit_log)
  && edit_log.length > 0)` (the SAME expression as the inline `isEdited` at the render row, which is left
  UNTOUCHED). A remark-only row is Original -- `save_review_remark` never stamps `edited_at`/`edit_log`, so
  the predicate already encodes it; do not special-case remarks.
- **classFilter SHOW-set semantics (stated choice).** `classFilter: Set<string>` is seeded with ALL 6 values
  (`useState(() => new Set(CLASS_FILTER_VALUES))`). `allClassesShown = classFilter.size === 6` => no
  narrowing (everything shows, incl. null-classification rows via short-circuit); unchecking a type hides it;
  empty set => show none. This is "seeded-full, size-6-means-all", NOT "empty-means-all". A null
  `effective_classification` passes only when `allClassesShown` (never matches an explicit subset).
- **STRICT HIDE via a third return-null gate (THE compose-safe pattern).** A new
  `if (!passesFilter(row)) return null;` joins the existing `if (!isVisible(row)) return null;` +
  `if (!classificationVisible(row)) return null;` at the top of `rows.map`. The two filters AND-combine
  inside `passesFilter`. This is SAFE against the render pipeline because `byIdx`/`depths`/`hasChildrenSet`
  derive from the FULL `rows` prop in `useMemo([rows])` -- strict-hide narrows only the rendered subset,
  never the depth/parent-resolution maps. Parent context for a hidden ancestor stays readable via the
  Parent column (owner-accepted flat-list-of-matches).
- **Search highlight = RINGS, never backgrounds (THE collision rule -- recon Q4c; do NOT violate).** The
  row `cn()` block already stacks BACKGROUND tiers (`hover:bg-muted/30`, preamble `bg-muted/20`, edited
  `bg-green-50`, the `highlightedIdx` amber scroll-flash). A search highlight added there MUST use
  `ring-inset` (box-shadow -- a DIFFERENT CSS property), placed AFTER the background tiers, so it layers
  OVER them without masking edit-state. As-built: all hits = `ring-1 ring-inset ring-blue-300
  dark:ring-blue-700`; current hit = `ring-2 ring-inset ring-blue-500 dark:ring-blue-400`. The soft tier is
  gated `searchHitSet.has(idx) && currentHitRowIdx !== idx` so the two ring WIDTHS are mutually exclusive
  (Tailwind would otherwise have two `--tw-ring-*` widths fight). The existing single `highlightedIdx` amber
  flash is UNTOUCHED (separate concern). **`border-collapse` caveat:** ReviewTree's `<table>` is
  `border-collapse`; `ring-inset` is the more reliably-painted box-shadow variant on table rows -- if a
  live-cert shows no ring, the fallback (a follow-up) is moving the ring to an inner cell, NOT switching to
  a background.
- **Cycling reuses `revealAndScrollToRow` (do NOT reimplement auto-expand).** `stepSearchPrev`/
  `stepSearchNext` modulo-wrap `searchCurrentIdx` over `searchHits.length` (both directions), mirroring
  SheetSearchView's `stepPrev`/`stepNext` (`:343-350`) PATTERN -- NOT imported. On each step they call the
  EXISTING `revealAndScrollToRow(searchHits[ni])` (`:696-717`), which already expands collapsed ancestors +
  scrolls + sets the amber flash. `searchCurrentIdx` resets to 0 on hit-set change (`useEffect([searchHits])`,
  mirror of SheetSearchView `:288-290`). Prev/next disabled at 0 hits; counter `0 of 0` else
  `${safeSearchIdx + 1} of ${searchHits.length}`.
- **The shown-predicate compose interlock (THE resolved ambiguity).** `searchHits` (a `useMemo` over `rows`)
  keeps a row iff `classificationVisible(row) && passesFilter(row)` AND `description` matches the query ->
  ordered `number[]` of `row_index` (+ `searchHitSet`). It uses the SAME filter predicates the render gate
  uses, so a hit can NEVER be a filtered-out row; clearing a filter widens the hit set. **RESOLVED:** the
  build prompt's B3 literally listed `isVisible` in the hit predicate, but B5/LC5 require stepping to a hit
  under a COLLAPSED parent to auto-expand it -- which is impossible if hits gate on `isVisible` (collapse).
  So hits gate on the FILTER axis but DELIBERATELY NOT on `isVisible` (the collapse axis, which is reversible
  and is exactly what `revealAndScrollToRow` undoes). Render and hits agree on the filter axis; they differ
  only on collapse, by design. Any future change MUST keep the hit predicate's filter axis identical to the
  render gate's filter axis.
- **Filter Popovers live INSIDE the `<table>` `<th>` cells -> `stopPropagation`.** Each header `Filter`
  trigger button calls `e.stopPropagation()` (the `<table>` body-onClick dismisses the detail/flag panels;
  the column-selector Popover is OUTSIDE the table so it never needed this). The trigger icon turns
  `text-blue-600 dark:text-blue-400` when its filter is narrowing (`statusFilterActive` /
  `classFilterActive`). Popovers + Checkbox reuse the SAME primitives as the existing column-subset selector.
- **Verification.** tsc 0 new wizard-file errors (project baseline 3177 unchanged); in-container build exit 0
  (`✓ built in 10m 54s`, PWA 166 entries). No Frappe unit tests (frontend-only). Manual live-cert LC1 (Status
  filter) / LC2 (Classification filter, all 6) / LC3 (AND-combine) / LC4 (search ring tiers, edited-green
  shows THROUGH the ring) / LC5 (cycling + auto-expand of a collapsed-parent hit) / LC6 (compose: filter
  then search, no hit on a filtered-out row) / LC7 (regression: edits still flip to Edited, detail panel +
  #162 door + #-pill modal + column-selector/flag-toggle/annotation checkboxes all still work) pending Nitesh.

**ReviewTree detail-panel layout pass conventions (FRONTEND ONLY, `ReviewTree.tsx` only; pure CSS):**

Three className-only fixes to the inline detail panel (the `expandedDetailRow === row.row_index` block). No
logic, state, handler, gate, save path, field-derivation (`editableDescriptors` / `editableTextDescriptors`
/ `editableAreaDescriptors`), `colSpan`, `totalCols`, or `<tr>`/`<td>` structure was touched.

- **FINDING B -- the panel is a NESTED, BRAND-TINTED CARD, not a hovered row.** The panel's inner content
  `<div onClick={stopPropagation}>` (inside `<td colSpan={totalCols} className="px-3 py-3 border-b
  border-border">`) carries `bg-indigo-50/40 dark:bg-indigo-950/20 border border-border border-l-4
  border-l-primary rounded-md shadow-sm p-3`. **Root cause locked:** the original panel background
  `bg-muted/30` is the EXACT tint a normal data row uses on hover (`hover:bg-muted/30`), so with only a
  bottom border it read as just another hovered row. The differentiator is a distinct body tint (NOT the
  hover tint) + border + radius + shadow + own padding (inset inside the cell's existing `px-3 py-3`).
  **Brand-tint follow-up (owner-requested):** the body is an INDIGO tint (`bg-indigo-50/40` /
  `dark:bg-indigo-950/20`) plus a BRAND-RED LEFT-ACCENT STRIPE `border-l-4 border-l-primary`.
  `border-l-primary` resolves to the `--primary` token (`346.8 77.2% 49.8%` -- a rose/crimson red, defined
  in `src/index.css`, identical in `:root` + `.dark`). **WHY an accent stripe, NOT a full red surface:** a
  red surface would collide with the destructive/error red already meaningful on this screen (the re-parse
  destructive warning, the cycle-rejection error). **WHY `--primary`, NOT `--destructive`:** the brand red
  (`--primary`, hue 346.8) is DISTINCT from the error red (`--destructive`, `0 84.2% 60.2%`, pure-red hue
  0) -- using `--destructive` would reintroduce the error association we are avoiding. Do NOT revert to a
  muted tint (reintroduces the blend) and do NOT swap the stripe to `border-l-destructive`. The `<tr
  className="bg-muted/30">` wrapper + the `<td colSpan>` are unchanged.
- **OBS 1 -- Classification/Parent is a VERTICAL STACK.** The original/effective grid is
  `grid grid-cols-1 gap-y-1 text-xs mb-2` (was `grid grid-cols-2 gap-x-4 gap-y-1`). Classification row first,
  then the Parent + §9 #162 "Change parent" row below it. Reason: on a wide sheet the right grid column
  (Parent) was off-screen and needed horizontal scroll. The two flex cells' INTERNAL content (labels, the
  "Change ▾" reclassify DropdownMenu, the "Change parent" button) is byte-for-byte unchanged -- only the
  side-by-side -> stacked arrangement changed.
- **OBS 2 -- the three edit blocks are responsive ~4-col grids, INDEPENDENTLY.** Each of the three
  edit-block containers -- numeric ("Edit values"), text ("Edit text"), per-area ("Edit per-area values") --
  is `grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2` (was `flex flex-wrap gap-2`),
  capping at ~4 wide on lg and fewer when narrow so there is no heavy left-right spread. The per-field items
  DROPPED their fixed `w-52` (now `flex flex-col gap-1`): in a grid the column governs width, and a fixed
  width would block cell-fill / overflow a narrow column; the item's internal `flex flex-col` (label +
  `flex items-center gap-1` Input/Apply row) is unchanged. **The three blocks stay SEPARATE -- they are NOT
  merged into one grid** (deliberate: each has its own save path -- numeric via openValueConfirm, text via
  saveTextField direct, per-area via openAreaConfirm). The Remarks block (`mb-2 max-w-md` Textarea, separate
  write path `saveRemark`) is OUT OF SCOPE and untouched.
- **Verification.** tsc 0 new wizard-file errors (project baseline 3177 unchanged); in-container build exit 0.
  No Frappe unit tests (frontend slice; pure CSS). Manual live-cert LC1 (panel reads as a distinct card,
  stays distinct when an adjacent row is hovered) / LC2 (Parent + "Change parent" stack below Classification,
  no horizontal scroll) / LC3 (fields wrap ~4-per-row, fewer when narrow) / LC4 (numeric/text/per-area Apply
  each still save + flip to Edited; Remarks unchanged) / LC5 ("Change ▾" + "Change parent" still open the
  modal) pending Nitesh.

**§9 #162 standalone Change-parent door conventions (FRONTEND ONLY, `ReviewTree.tsx` only):**

A SECOND front door to the EXISTING `RestructureModal`, reached WITHOUT a reclassification. Files touched:
`ReviewTree.tsx` ONLY (no `RestructureModal.tsx`, no backend, no doctype JSON, no `boqTypes.ts`).

- **The button + placement (mirror the reclassify control).** The row-detail panel's `grid grid-cols-2`
  has a CLASSIFICATION cell (left, already hosts the "Change ▾" reclassify DropdownMenu) and a PARENT cell
  (right, previously display-only). This slice wraps the PARENT cell's existing content in a
  `flex items-center gap-2` and adds a "Change parent" `<button>` beside the current-parent display,
  styled IDENTICALLY to the "Change ▾" pill (`rounded-full bg-blue-100 ... text-[10px]`). **Plain button,
  NOT a single-item DropdownMenu** -- there is no list to pick; the single action is "open the modal", so a
  dropdown would be a hollow one-item menu.
- **The open call = a NO-OP reclassify (THE pattern).** On click:
  `setRestructureModal({ row, newClassification: row.effective_classification as string })`. It uses the SAME
  `setRestructureModal` state setter the childless AlertDialog's "Move under a new parent" radio already uses
  -- and DIRECTLY, NOT via `onPickClass` (which would route a childless row to the light AlertDialog confirm
  instead of the modal). `newClassification` = the row's CURRENT class, so the modal's reclassify write is a
  no-op (same value) while the row-position picker drives the actual move. `canSave` in `RestructureModal`
  never compares new-vs-current classification, so a same-value class is benign (verified).
- **NON-NEGOTIABLE -- no silent reparent (why we reuse the modal, not a lighter path).** A WITH-children row
  opened via "Change parent" STILL surfaces the five child-placement options: the `children.length > 0` gate
  inside `RestructureModal` is left EXACTLY as is -- do NOT suppress it for a parent-only open. The reviewer
  must decide the children's fate; the modal's batch cycle-guard + the single write-chokepoint come along. A
  CHILDLESS row opens with the children block already suppressed (the existing childless adaptation;
  `rowPosition` lazy-inits to "move") -> only the row's-own-position picker shows.
- **Scope exclusion (owner-locked) -- `canChangeParent` gate.** The button does NOT render when the row's
  CURRENT classification is `subtotal_marker` or `header_repeat`:
  `const canChangeParent = row.effective_classification != null && (ASSIGNABLE_CLASSIFICATIONS as readonly string[]).includes(row.effective_classification);`
  (the `as readonly string[]` cast is required -- the const is a `readonly [...]` tuple, so `.includes` of a
  `string | null` otherwise fails TS2345). A no-op reclassify on those two parser-only detections would be
  rejected by the backend `_ASSIGNABLE_CLASSIFICATIONS` gate, so the door must not appear there.
- **edit_log fidelity (VERIFIED, no backend change).** The standalone reparent must appear in the row's
  edit_log. The no-op reclassify writes a same-value `human_classification` entry (harmless), but the PARENT
  change is captured SEPARATELY: `save_review_restructure`'s `row_new_parent` path calls
  `_apply_and_save_row_edit(..., "human_parent", ...)`, which ALWAYS appends its own edit_log entry for the
  field it writes -- field `human_parent`, `from` = prior effective parent, `to` = new parent (or null for
  root), reason `"row moved: row N reclassified to <cls>"`. So the parent move is ALREADY logged; the B2
  conditional (and its chokepoint STOP-gate) were NOT triggered -- backend untouched.
- **Verification.** tsc 0 new wizard-file errors (project baseline 3177 unchanged); in-container build exit 0.
  No Frappe unit tests (frontend slice; reused modal + backend already certified). Manual live-cert LC1-LC6
  (LC2 children-prompt + LC6 cycle-block are the load-bearing no-silent-reparent proofs) pending Nitesh.

**Force Re-parse FRONTEND slice conventions (two entry points + shared modal + rewritten warning):**

Frontend-only. Files touched: `SheetCard.tsx`, `ParseRunDialog.tsx`, `BoqHubPage.tsx` ONLY (no backend, no doctype JSON, no `boqTypes.ts` -- the dialog's new props are typed locally on `ParseRunDialogProps`). The slice builds the UI that sets `force_reparse: true` on the already-certified backend floor (`run_parse(..., force_reparse=False)` / `assemble_mapping_config`, feat 95928637).

- **Two-button hub pattern (THE convention).** The hub parse-gate footer now holds TWO buttons in a `flex gap-2` cluster on the right: the existing **"Parse workbook"** (primary, UNCHANGED gate `!canParse || parseInFlight`) and a new **"Re-parse"** (`variant="outline"`). The Re-parse button sits BESIDE Parse -- it does NOT replace Parse and does NOT re-enable a greyed Parse. Each button keeps its own `Tooltip` (disabled-reason pattern). Apply this two-button shape if a future hub action needs a "destructive variant of an existing primary action" beside it.
- **Re-parse path sends `force_reparse: true`; normal Parse does NOT (THE wire rule).** `BoqHubPage.handleParseConfirm` spreads `...(parseDialogMode === "reparse" ? { force_reparse: true } : {})` onto the EXISTING `callRunParse({ boq_name, sheet_names })` payload. Normal Parse omits the param entirely (backend default False). The SDK serializes the bool; the backend coerces `"true"/true`. NEVER send `force_reparse` on the normal Parse path.
- **Per-card eligibility = `has_prior_parse === 1` AND effective status in {Parsed, Parsed Check Done, Reviewed} (THE eligibility convention).** Computed as `canReparse` in `SheetCard.tsx` (per-card render gate) and as `reparseEligibleDrafts` in `BoqHubPage.tsx` (global-button enable gate + the dialog's tickable source) -- the SAME predicate in both places. **"Parse failed" is DELIBERATELY EXCLUDED** (decision recorded): the backend floor does NOT widen `force_reparse` to "Parse failed" (`assemble_mapping_config` Rule 4 keeps it `not_eligible` regardless of the flag), so offering it would be a control that silently no-ops (the sheet would surface in the completion modal's "Not parsed" line). A never-parsed sheet (`has_prior_parse !== 1`) NEVER shows a Re-parse control. The per-card "Re-parse" Button (`variant="outline"`) renders inside the Parsed / Parsed Check Done / Reviewed action blocks only; on click -> `onReparse?.(draft.sheet_name)` (VERBATIM #152).
- **Global-button enable rule: `reparseEligibleDrafts.length >= 1` (+ `parseInFlight` guard); NO blockingCount gate.** Deliberate divergence from `canParse` -- a Parse-failed sheet must NOT block re-parse of the previously-good sheets; the two concerns are independent. Greyed -> "No previously-parsed sheets to re-parse" tooltip.
- **Shared-modal mode mechanism.** `ParseRunDialog` gains `mode?: "parse" | "reparse"` (default `"parse"`) + `reparseDrafts?: BoQSheetDraft[]` (tickable source in reparse mode) + `restrictToSheetName?: string | null` (per-card pre-filter). The PARENT owns `parseDialogMode` + `reparseRestrictSheet` state (set BEFORE `parseDialogOpen` flips true) and derives `force_reparse` from `parseDialogMode` -- so `onConfirm(sheetNames)`'s signature is UNCHANGED (smallest blast radius; the dialog needs `mode` only for rendering). `tickableDrafts = isReparse ? (restrictToSheetName ? reparseDrafts.filter(one) : reparseDrafts) : reviewedDrafts`; `tickedSheets` seeds from `tickableDrafts`; the seed `useEffect` still keys on `[open]` (reads the fresh tickable source because mode/restrict are already set). The four informational lists (General specs / Already parsed / Pending / Skipped) are gated `mode === "parse"` -- hidden in reparse mode. Title / description / confirm-button label / "Will (re-)parse" heading all branch on `isReparse`. This was the B3 PROCEED path (extend the tickable-source array feeding the EXISTING checkbox machinery; NO four-list restructure).
- **Rewritten destructive warning (step 2 = the safety surface).** Trigger shape UNCHANGED: `if (dirtyTicked.length > 0) setStep(2)`, where `dirtyTicked` = ticked sheets with `has_prior_parse === 1` -- now catching Parsed + Parsed Check Done + dirty-Reviewed (re-targeted from dirty-Reviewed-only). Copy REWRITTEN to name specifically the parsed output AND every review-screen change -- edited values and text, REMARKS, classification changes, and parenting/restructure moves; "cannot be undone." A LOUDEST `destructive`-styled callout keyed on `checkedDoneTicked` (`dirtyTicked` filtered to `wizard_status === "Parsed Check Done"`) names the hand-reviewed+Checked sheets. In normal-parse mode the Checked callout never appears (no Checked sheet is tickable there) and a FRESH Reviewed sheet (`has_prior_parse !== 1`) still triggers nothing -- the normal Parse path is unchanged.
- **Verification.** tsc 0 NEW wizard-file errors (project baseline unchanged) + in-container build exit 0. No Frappe unit tests (frontend slice; backend floor already test-certified). Manual live-cert LC1 (never-parsed -> no per-card control, global greyed when zero eligible) .. LC7 (normal Parse on a fresh Reviewed sheet unchanged) -- DESTRUCTIVE, pending Nitesh. #145 (all-Parsed workbook: Parse greyed but Re-parse ENABLED) is closed by this slice.

---

## Important Notes

- **Frappe Backend Required**: This frontend cannot run standalone; it requires a Frappe backend (see `../CLAUDE.md` for backend documentation)
- **Multi-tenancy**: Supports Frappe's multi-site architecture via X-Frappe-Site-Name header
- **Service Worker**: Firebase messaging service worker must be at root URL path
- **Build Output**: Build artifacts go to parent Python package directory (`../nirmaan_stack/public/frontend/`), not within frontend/
- **Deprecated Components**: `src/pages/Retired Components/` contains old implementations for reference
- **Role-Based Access**: User roles from Frappe control UI visibility and permissions (see Role-Based Access Control section above)
- **Project Context**: Many operations are scoped to a selected project (stored in UserContext)
- **Customer Required for Financials**: Projects without a customer cannot have invoices or inflow payments created - UI shows validation warnings and disables forms
- **CEO Hold Status**: Projects with "CEO Hold" status block ALL procurement, payment, and expense operations. Use `useCEOHoldGuard` hook for single-project pages, `useCEOHoldProjects` for list pages. See `.claude/context/domain/ceo-hold.md` for full documentation. **Authorization:** Only `nitesh@nirmaan.app` can set/unset CEO Hold (not role-based). The `CEO_HOLD_AUTHORIZED_USER` constant is in `src/constants/ceoHold.ts`. The `ceo_hold_by` field on Projects tracks who set the hold. Backend validation in `projects.py` enforces this restriction.
- **Bulk Download Wizard**: `src/pages/BulkDownload/` provides a multi-step wizard for downloading POs, WOs, Invoices, DCs, MIRs, and DNs in bulk as merged PDFs. Uses `useBulkDownloadWizard.ts` hook and `FilterBar.tsx` for vendor/date filtering. PO rate visibility restricted for Project Managers.
- **Reusable Common Components**: `src/components/common/` contains shared components used across pages:
  - `VendorAttachmentForPR.tsx` - Vendor quote attachment viewer with read-only mode support
  - `VendorQuotesAttachmentSummaryPR.tsx` - Attachment summary for vendor quotes
  - `BulkPdfDownloadButton.tsx` - Button trigger for bulk PDF download
  - `ProjectTeamHoverCard.tsx` - Project team info hover card
  - `assigneesTableColumns.tsx` - Shared assignee column definitions for tables
- **Centralized Vendor Hooks**: `src/pages/vendors/data/` contains `useVendorQueries.ts` and `useVendorMutations.ts` for centralized vendor data operations with Sentry API error capturing.
- **Design Tracker Phases**: Design tracker supports Onboarding and Handover phases. Phase filtering available in task-wise and team-summary views. Approval proof (file attachment) required before task status can be set to Approved.
- **CSV Export Pattern**: Most DataTable columns support `exportMeta` configuration with `header` (custom column name), `value` (custom formatter function), and `exportFileName` for dynamic filenames. Export respects current table sorting and column order.
- **Return Notes:** DN variant for items returned to vendor (`is_return` field on Delivery Notes doctype). Negative `delivered_quantity`, red-tinted "RN-" columns in pivot table. Only available in PO accordion (not standalone DN page). Roles: Admin, PMO, PL, Procurement (PM excluded). See `.claude/context/domain/delivery-notes.md` for full docs.
- **Inventory Item-Wise Page**: `src/pages/inventory/InventoryItemWisePage.tsx` — cross-project aggregation of latest submitted Remaining Items Reports with max PO quote rates for estimated cost. Virtualized expandable table with category/unit facet filters and CSV export. Sidebar access: Admin, PMO, PL, PM, Procurement.
- **DN/CEO Hold Exemption**: Delivery Note operations (create, edit, return) are exempt from CEO Hold blocking — DNs can be managed even on held projects.
- **Vendor Financial Dialogs**: Vendor WO/Material Orders tables show Amount Due column with clickable Total Invoiced and Amount Paid cells that open InvoiceDataDialog/PaymentsDataDialog respectively.
- **PO Adjustments**: Decoupled payment reconciliation system (`src/pages/POAdjustment/`). Revision approval auto-creates `PO Adjustments` doc tracking financial impact; negative diffs with remaining balance show "Adjust Payments" button on PO detail. Three methods: Against-PO, Ad-hoc expense, Vendor Refund. Pending adjustments lock PO payments. See `.claude/context/domain/po-adjustments.md` for full docs.
- **PO Revision simplified to 2 steps**: Item editing + Summary (Step 2 financial allocation removed). Payment reconciliation handled by PO Adjustments system post-approval. See `.claude/context/domain/po-revisions.md`.
- **Vendor Hold / Credit Management**: Vendors with exhausted credit are marked "On-Hold". **Asymmetric transitions**: On-Hold → Active is real-time (via `recalculate_vendor_credit()` on 9 events); Active → On-Hold is daily cron only (10 AM IST). Credit limit standardized at 50,000. **Admin-only** credit management (PMO removed). Blocks dispatch + payment operations on "PO Approved" POs only — dispatched+ POs get informational banner. Uses `useVendorHoldGuard` (single vendor) and `useVendorHoldVendors` (bulk lookup) hooks. Guard variable: `isVendorHoldBlocked = isVendorOnHold && po?.status === "PO Approved"`. See `.claude/context/domain/vendor-hold.md` for full docs.
- **`useFrappeGetDoc` swrKey gotcha**: Third arg is `swrKey`, NOT options. Use `id ? undefined : null` for conditional fetching — never `{ enabled: !!id }` which breaks SWR cache deduplication.
- **Internal Transfer Memos (ITM)**: Cost-neutral inter-project material transfer launched from the Inventory Item-Wise page. One target project per session → backend groups selections by `source_project` → N ITMs (one per unique source). Admin-only approval. Phase 1 = create + approval + pre-dispatch delete; Phase 2+ adds dispatch / DN polymorphism / Material Usage columns / real-time events. `estimated_rate` is a snapshot at create time (no retroactive revaluation). DO NOT modify the DN schema in Phase 1 — the `parent_doctype` / `parent_docname` polymorphism migration across ~51 consumer sites is a Phase 2 concern. See `.claude/context/domain/internal-transfer-memos.md` for the full reference.
- **Work-package read path (Slice 3f-readback):** Work-package assignments are grandchild rows (BoQ Sheet Draft.work_packages, child of a child of BOQs). Frappe get_doc / useFrappeGetDoc("BOQs") does NOT return grandchildren, so draft.work_packages is always empty on the client. Read assignments via the get_boq_work_packages endpoint instead; both hub and spoke consume it (SheetCard workHeaders prop; SheetConfigPanel workPackages: string[]).
- **`order` field name (Slice 3f-fix):** Never pass order_by on a Frappe field literally named `order` -- it is a PostgreSQL reserved keyword and Frappe's REST list layer does not quote it, producing a 500. Keep `order` in the fields list and sort client-side.
- **ITM DC & MIR**: ITMs in `Partially Delivered` or `Delivered` status can have Delivery Challans + Material Inspection Reports filed against them, parallel to the PO flow. The `PO Delivery Documents` doctype is polymorphic (`parent_doctype` Select + `parent_docname` Dynamic Link). Surfaces with PO/ITM toggle: hub `/prs&milestones/delivery-challans-and-mirs`, project `DC & MIR` tab (sub-tabs for DN > DC Report + DC + MIR), reports `DCs & MIRs` tab. ITM-only: `ITMAttachmentSection` on the ITM detail page. Hub toggle URL-persisted via `parent`; project sub-toggle via `dcmir_parent`; reports toggle via `dcmir_parent`. **PO-only by design** (do NOT mix in ITM rows): Material Usage tab, DN > DC PO report, Bulk Download wizard — all filter by `procurement_order ["is", "set"]`. Mobile cards: `ITMListCards.tsx` mirrors `POListCards.tsx`. Upload dialog `UploadDCMIRDialog` accepts optional `parentDoctype` prop ("Procurement Orders" default, "Internal Transfer Memo" for ITM). `ITMDNDCQuantityReport` is a parent-child grouped reconciliation report (mirrors `DNDCQuantityReport` exactly: parent ITM rows expand to item sub-rows, status rollup, sortable totals, source-project facet, status facet, search, CSV export, info banner, error state). Fetches ITM child items via `get_project_itms` (extended to include items array). PO/ITM toggle UI is a red-active segmented control (mirrors project tab styling). `ITMAttachmentSection` always renders the card when `canView`; only the upload buttons are gated by `canUpload` (status in delivered states) — historical DCs/MIRs never disappear if the ITM moves out of upload-eligible state.

# currentDate
Today's date is 2026-03-12.

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
