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

**Status (2026-06-06, updated):** UNIFY-ON-(-1) + Slice A review-screen backend COMPLETE (feat fff26abd; BACKEND ONLY). Slice B1 review-screen spine COMPLETE (feat 0683f7b9; SheetReviewPage + ReviewTree + get_structural_breaks endpoint + 3 tests). Slice B1.1a COMPLETE (feat 58d2ed44; BACKEND ONLY -- get_review_rows extended with column_descriptors; 50 total review-screen tests, 218 total wizard tests). Slice B1.1b-i COMPLETE (feat 3e846ba1; FRONTEND ONLY -- descriptor-driven column layer + ClassificationPill; ColumnDescriptor type; anchor letters; tsc 0 wizard errors; Vite build exit 0). Slice B1.1b-fix-A COMPLETE (BACKEND ONLY -- flatten_resolved_row writes human_parent=-1; agreement #54 unify completed; 63 parse-run tests, 221 total wizard tests). Slice B1.1b-fix-B COMPLETE (FRONTEND ONLY -- ReviewTree.tsx: parent column + scroll-to-parent, pill-no-clip, ancestor-only collapse, pill-above-text; tsc 0 wizard errors; Vite build exit 0). Slice B1.1b-ii COMPLETE (FRONTEND ONLY -- column-subset selector Popover + Checkbox + three independent spacer/note/subtotal visibility toggles; children-of-hidden-annotation render at original depth; tsc 0 wizard errors; Vite build exit 0). Slice B1.1b-iii COMPLETE (FRONTEND ONLY -- Description cell split: Classification fixed anchor [chevron+pill, flat-left, w-36] + text-only Description with depth indent; tsc 0 wizard errors; Vite build exit 0). Module 1b COMPLETE. Module 2b-i ✅ COMPLETE (feat 81568df9;
hub route + static read-only hub). Module 2b-ii ✅ COMPLETE (feat 459f85ae; pill-color
fix + all hub interactions wired). Module 2b-iii ✅ COMPLETE (feat 57152c52; visual
polish -- 2-col grid, solid-saturated pills, amber keyword hint, detailed footer). Module 3 Slice 3a-fix ✅ COMPLETE (feat ba4fb738; hub type + display patched for work_packages multi-link). Module 3 Slice 3b-ii ✅ COMPLETE (feat 7be670d4; spoke shell + SheetDataGrid + Review/Edit wiring; tsc clean on wizard files; Vite build 0 errors). Module 3 Slice 3b-iii ✅ COMPLETE (feat 2ac4789a; sticky header + gridlines + decode fix; tsc + build clean). BoQ-list tab + B2 tendering section (Phase 6 pull-forward) ✅ COMPLETE (BoqProjectTab expanded to full list; BoqProjectTab reused as section on TenderingProjectView; see slice record in boq-upload-plan.md). Module 3 Slice 3c ✅ COMPLETE (feat 16a6a4dc; SheetConfigPanel new -- Section 1 rows + Section 2 areas config UI; per-field sparkle local confirm-state; read-modify-write guard on set_sheet_config; sheet_config typed on BoQSheetDraft; §9 #128 comment+decode fix; tsc clean on all boq-wizard files; parser tests 588 unchanged). Module 3 Slice 3c-fix ✅ COMPLETE (feat 9f8fb6f7; persistence fix -- setInitialized(true) moved inside parsedConfig !== null guard; sparkle-on-confirm -- Select uses onOpenChange not onClick on SelectTrigger; Section 2 reshape -- Single/Multi toggle + stacked text boxes replace chip/Enter-to-add; tsc 0 errors on boq-wizard files; Vite build clean; manual test required for sparkle-on-confirm browser behavior). Module 3 Slice 3d-i ✅ COMPLETE (refactor -- preview fetch + column_role_map state lifted to SheetSpokePage; SheetDataGrid now pure render component; ColumnRoleEntry type added to boqTypes.ts; tsc 0 errors on boq-wizard files; Vite build clean; NO new user-facing behavior -- behavioral equivalence is manual-test-only). Module 3 Slice 3d-ii ✅ COMPLETE (feat f24ac4fe; Section 3 column-role list in SheetConfigPanel -- 21 roles in 6 groups, area-conditional dropdown (8 compatible / 4 required), singleton enforcement (12 roles, disabled in other rows), cross-section area reconciliation, pending-row transient state, {role,area} save shape fixing 3d-i role-only shape; tsc 0 errors on boq-wizard files; Vite build clean). Module 3 Slice 3d-ii read-back fix ✅ COMPLETE (fix cbb704ce; seed loop in SheetSpokePage updated to parse {role,area} object shape -- 3d-ii corrected the save but not the read; dual-shape handler added; initialized-flag placement confirmed correct; SheetSpokePage.tsx only). Module 3 Slice 3d-ii per-area-pair uniqueness fix ✅ COMPLETE (fix f541e428; usedAreaPairs Map added to SheetConfigPanel -- "role|area" → col; area dropdown options disabled when pair already taken by another column; mirrors usedSingletons pattern; SheetConfigPanel.tsx only). Module 3 Slice 3d-iii ✅ COMPLETE (feat 83b63b7b; 4 SheetDataGrid annotations -- (2a/2b) AREA_COLORS palette 6 opaque Tailwind classes index-by-area_dimensions, column-letter headers tinted by area; (2c) role badge text-[9px] below column letter using ROLE_LABELS (imported from boqTypes.ts -- single source of truth, SheetConfigPanel refactored to also use it); (2d) opacity-50 dim on data cells for unmapped columns, frozen rows exempt; (2e) h-10 fixed height on column-letter headers, frozen data rows sticky top-10/top-20 at z-[15], gutter cell doubly-sticky z-[17]; live-vs-saved asymmetry: color/badge/dim driven by live columnRoleMap, freeze + area-color map driven by saved draft.sheet_config updated on mutate(); tsc 0 errors on boq-wizard files). Module 3 batched UI-fixes Part 1 ✅ COMPLETE (feat bdf32e37; Finding #1: Section 1 top-header Yes/No toggle replaces free-text input -- default Yes (top_header_rows_override=null), No reveals single number input ([N] single-element list); Finding #2: data-start-row plain inline text replaces input-box-chrome <p>; Finding #5: save-time amber warning for columns with preview-row data but no role assigned (non-blocking, preview-rows-only scope); SheetConfigPanel.tsx only; tsc 0 errors on boq-wizard files; Vite build clean). Finding #4 (amount_combined dropdown removal) OFF -- recon confirmed auto-guess CAN emit amount_combined (5 keywords in _HEADER_KW). Module 3 batched UI-fixes Part 2 ✅ COMPLETE (feat 2f8bf533; Finding #3: hub back-to-project button added, routes semantically to /projects/${boq.project}?page=boq -- never navigate(-1); project field added to BOQsDoc type; BoqHubPage.tsx + boqTypes.ts only; tsc 0 errors; Vite build clean). Module 3 batched UI-fixes Part 3 ✅ COMPLETE (feat 25ed4b48; Finding #4: static role-pair helper note + #5 copy fix; SheetConfigPanel.tsx only). Module 3 batched UI-fixes Part 3b ✅ COMPLETE (feat 8943e9ce; Part 3 inline paragraph REPLACED by per-role Info icon tooltips on the 6 confusable roles; SelectPrimitive approach to avoid ItemText-cloning-into-trigger bug; TooltipProvider mounted locally; SheetConfigPanel.tsx only; tsc 0 errors; Vite build clean). Batched UI-fixes slice CLOSED (all #1-#5 done; #4 refined by 3b). Module 3 Slice 3e ✅ COMPLETE (feat e60e768c; two-layer review gate in SheetConfigPanel -- section-grain Layer 1 (section:rows/areas/roles keys in confirmedFields) + bulk-accept + Layer-2 attestation checkbox + save-anchored Mark-as-reviewed two-call sequence + coverage summary + M3.12 change-event re-edit drop + hub interim Mark-reviewed retired from Pending and Parse-failed; wizard tests 83/83; parser tests 588 unchanged; tsc 0 errors; Vite build exit 0). Carry forward: 3f work-package assignment UI remains. Slice 2-fix ✅ COMPLETE (fix 24312cab; pre-existing gap not 2c regression; WizardStatus union + STATUS_PILL + SheetCard button branches now cover all 7 wizard_status values incl. "Parsed" -- green pill bg-green-600 + Edit-to-spoke branch; surfaced live on BOQ-26-00145 HVAC). Module 2b (parse-run hub surface) ✅ COMPLETE + live-certified on BOQ-26-00145 -- five Slice 2b commits: 2b-backend dirty-marker `7795582f`, 2b-backend-2 parse-history fields `896f3a3c`, 2b-frontend-i Parse button + ParseRunDialog `c9fc37fd`, 2b-backend-3 multi-select endpoint `e996d097`, 2b-frontend-ii multi-select checklist + caller fix `d1672c6f`. Module 3 IN PROGRESS (Slice 3e COMPLETE; Slice 3f work-package spoke UI remaining). Bucket-1 hub-polish ✅ COMPLETE (feat f5dcfdd6; hub Parsed count + 2-col general-specs checklist + spoke Option-B parsing-vs-details zone grouping; tsc 0 errors; Vite build exit 0). Bucket-1 zone-differentiation follow-up ✅ COMPLETE (feat 1ec901e7; spoke config/details zones boxed with rounded border; Zone B tinted bg-muted/30 as secondary zone; Zone B border-t/pt-3 removed in favor of box; SheetConfigPanel.tsx only; Vite build exit 0). Bucket-2 Slice 1 COMPLETE (feat cb86b92b; BACKEND ONLY -- no frontend files touched; `BOQs.parse_in_progress` Check field added; parse_run.py SET+CLEAR logic landed; 55->60 wizard tests). Bucket-2 Slice 2 COMPLETE (feat 21e56963; FRONTEND ONLY -- completion AlertDialog replacing inline strip; 8-case message matrix (3 success sub-lines + 5 error codes) with no_eligible_sheets neutral; error-code-preserving state shape; on-mount parse_in_progress recovery; parse button in-progress spinner; ParseRunDialog ~10-min note; build exit 0; 0 tests added). Bucket-2 is COMPLETE. #147 option-4 COMPLETE (feat 193327b1; FRONTEND ONLY -- hub reconnect mutate self-heal + ParseRunDialog dismissable mid-parse; BoqHubPage.tsx + ParseRunDialog.tsx; build pre-change clean exit 0; 0 tests added).

**BoQ in-project list conventions (2026-06-01):**
- `BoqProjectTab` is the canonical in-project BoQ list component (and also reused as a section on the Tendering project view).
- Data: single `useFrappeGetDocList("BOQs", { fields: [...], filters: [["project","=",projectId]], orderBy: {field:"uploaded_at",order:"desc"}, limit:50 }, projectId ? \`boq-list-${projectId}\` : null)`. The third arg is the swrKey; passing `null` disables the fetch until projectId is available (standard SDK gotcha -- see useFrappeGetDoc swrKey note above).
- Status display: `wizard_state` Select field on BOQs -- ""/blank -> "Not started", "In progress", "Configured", "Parsed". No child-table reads; no sheet_drafts computation.
- Row navigation: `onClick` on `TableRow` -> `navigate(\`/upload-boq/hub/${row.name}\`)`. boqId = `row.name` (BOQs docname from Frappe autoname). Hub route: `upload-boq/hub/:boqId` (routesConfig.tsx).
- Date: `formatDate(row.uploaded_at || row.creation)` -- `uploaded_at` is the primary field; falls back to Frappe built-in `creation` for pre-M1 docs.
- UI: shadcn `Table` + `Skeleton` (mirrors ProjectTransferMemosTab), NOT TanStack/DataTable.
- BoqProjectTab is reused verbatim on TenderingProjectView as an additive section (no tab machinery). Passed as `projectId={data.name}` where `data` is the Projects doc -- no transform.

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
