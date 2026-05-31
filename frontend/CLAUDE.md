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

**Status (2026-06-01):** Module 1b COMPLETE. Module 2b-i ✅ COMPLETE (feat 81568df9;
hub route + static read-only hub). Module 2b-ii ✅ COMPLETE (feat 459f85ae; pill-color
fix + all hub interactions wired). Module 2b-iii ✅ COMPLETE (feat 57152c52; visual
polish -- 2-col grid, solid-saturated pills, amber keyword hint, detailed footer). Module 3 Slice 3a-fix ✅ COMPLETE (feat ba4fb738; hub type + display patched for work_packages multi-link). Module 3 Slice 3b-ii ✅ COMPLETE (feat 7be670d4; spoke shell + SheetDataGrid + Review/Edit wiring; tsc clean on wizard files; Vite build 0 errors). Module 3 Slice 3b-iii ✅ COMPLETE (feat 2ac4789a; sticky header + gridlines + decode fix; tsc + build clean). BoQ-list tab + B2 tendering section (Phase 6 pull-forward) ✅ COMPLETE (BoqProjectTab expanded to full list; BoqProjectTab reused as section on TenderingProjectView; see slice record in boq-upload-plan.md). Module 3 Slice 3c next (config sections -- Section 1 rows + Section 2 areas).

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

**Hub components in `src/pages/boq-wizard/`:**
- `boqTypes.ts` -- shared types: `BOQsDoc` + `BoQSheetDraft` + `WizardStatus` +
  `BoQSheetWorkPackage`. Both `BoqUploadScreen` and `BoqHubPage` import from here --
  do not duplicate the type. Current `BoQSheetDraft` shape (feat ba4fb738):
  `{ name, sheet_name, sheet_order, wizard_status, work_packages?: BoQSheetWorkPackage[], sheet_label? }`.
  `BoQSheetWorkPackage = { name: string; work_header: string }` (mirrors the backend child
  doctype "BoQ Sheet Work Package", field `work_header` Link -> "Work Headers").
  NOTE: `work_package` (singular string) is GONE -- it was the pre-3a legacy field. The
  array `work_packages` replaced it (feat b14e9015 backend, ba4fb738 frontend).
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
- General specs: hint text only (selector governs it, no status buttons)
- "Review" / "Edit" stubs: `onClick` no-op, Tooltip "Per-sheet configuration opens
  in Module 3 (coming next)". DO NOT navigate from these buttons.
- "Mark reviewed" + "Set pending": deliberately wired so parse gate is testable
  without the Module 3 spoke. Clearly labeled; they call `set_sheet_status` directly.
- Discard BoQ (header menu): still disabled/stubbed -- destructive, separate slice.
- Parse workbook (footer): still no-op stub -- Module 5.

**General-specs derivation rule (M2.16) -- CRITICAL:**
The "General specs" display badge on a card is DERIVED from `BOQs.general_specs_sheet`
pointer, not from `BoQSheetDraft.wizard_status`. The backend NEVER writes "General specs"
to `wizard_status` (see backend CLAUDE.md). Do NOT write "General specs" to
`wizard_status` in frontend code either. The derivation logic: if
`draft.sheet_name === boq.general_specs_sheet` (EXACT string match), return "General specs"
as the effective status regardless of what `wizard_status` contains.

**EXACT sheet_name constraint (verified 2026-05-31):**
`sheet_name` is stored and matched VERBATIM by the backend -- Frappe does NOT strip
whitespace from BoQ Sheet Draft Data fields. "  Electrical (Rev-2) " is stored as-is.
Rules: (1) use `draft.sheet_name` as-is for React keys and in every endpoint call;
(2) trim ONLY for visual display (e.g. card label text); (3) each call site in hub
code has a comment noting the exact-match requirement.

**M2.23 general-specs confirm flow (AMENDED from original design):**
Warn-and-confirm (AlertDialog) fires ONLY when the chosen sheet's effective status is
"Reviewed". Single call: `set_general_specs_sheet(sheet_name)` only -- NO
`set_sheet_status` as part of designation. When the pointer is later cleared or
re-pointed, the released sheet returns to its TRUE prior `wizard_status` (not forced
to Pending). Rationale: less destructive, simpler, no fragile two-call sequence.
Cancel: dialog closes, selector reverts to server state automatically (controlled
component -- no endpoint called, no state update needed).

**Hub parse-gate (M2.11/M2.12):** Enabled when `blockingCount === 0 && reviewedCount >= 1`.
Blocking = effective status is "Pending" or "Parse failed" on data sheets (non-hidden,
non-skip, non-general-specs). Parse workbook onClick is a no-op stub -- Module 5 owns
the actual parse.

**Hub visual conventions (Module 2b-iii, feat 57152c52):**
- **Card list layout:** `grid grid-cols-1 sm:grid-cols-2 gap-3` for both the main card list
  and the hidden-sheets reveal section. Use the same grid if adding more card lists.
- **Status pills:** Solid saturated backgrounds with white text, `text-sm font-medium`,
  rounded-full, dark: variants for all six statuses. ONE central `STATUS_PILL` map in
  `SheetCard.tsx` -- do not scatter pill colors. Template:
  `bg-<color>-500 text-white dark:bg-<color>-600 dark:text-white`.
- **Likely-skip keyword hint:** `isKeywordHint` flag (no label, no work_packages + keyword match).
  Rendered with `AlertTriangle` (lucide-react, `h-3 w-3`, amber) + amber text
  (`text-amber-600 dark:text-amber-400 font-medium`). Presentation-only; never changes data.
- **Footer breakdown pattern:** Lead with data-sheet progress (`N of M data sheets reviewed`),
  then append only non-zero set-aside categories (`· K general specs · S skipped · H hidden`).
  Derive counts from `getEffectiveStatus` -- same source as the gate. Do not change gate math.

**Module 3 Slice 3b-ii -- per-sheet spoke shell + SheetDataGrid (feat 7be670d4):**

- **Spoke route:** `/upload-boq/hub/:boqId/sheet/:sheetName` — sibling of the hub route in `routesConfig.tsx`. Lazy-loaded, `SheetSpokePage` exports `{ SheetSpokePage as Component }` (React Router v6 lazy convention).
- **encode/decode:** Hub navigates using `encodeURIComponent(draft.sheet_name)`. React Router v6 `useParams()` returns the RAW URL-encoded string (does NOT call `decodeURIComponent`). Fixed in Slice 3b-iii — spoke now calls `decodeURIComponent(sheetName)` before display and before passing to the endpoint.
- **SheetSpokePage scope (this slice only):** back button → hub, header (display-trimmed sheet name + BoQ name/version + optional label), `SheetDataGrid`. NO config sections, NO work-package picker, NO mark-reviewed — Slice 3c+.
- **SheetDataGrid:** `useFrappePostCall` for ALL fetches (initial + load-more) — avoids mixing SWR state with accumulated rows. Initial 40 rows fetched in `useEffect([boqName, sheetName])`. `useState` tracks rows, hasMore, isInitLoading, initError, isLoadingMore, loadMoreError.
  - Column header: union of all col_letter keys across loaded rows, sorted in Excel order (shorter first, then alphabetical — A,B,...,Z,AA,AB,...). Recomputed after each load-more append.
  - Left gutter: absolute Excel `row_number` (never re-indexed; row 41 shows "41"). `sticky left-0` for horizontal scroll.
  - Cell values: null → blank, booleans → "TRUE"/"FALSE", others → String(). Truncated with `max-w-[180px]`, full value on hover via `title` attr. Uses shadcn `<Table>` (NOT TanStack).
  - Load-more: `disabled={isLoadingMore}` is the single-flight guard. `setRows(prev => [...prev, ...newRows])` appends. Re-evaluates `has_more` from new response. Hidden when `has_more === false`.
- **Review/Edit wiring:** `MODULE3_TOOLTIP` constant and `Tooltip`/`TooltipContent`/`TooltipTrigger` imports removed from `SheetCard.tsx`. Review (Pending, Parse-failed) and Edit (Reviewed) now call `onOpenSpoke?.(draft.sheet_name)` — optional so cards without a spoke callback still compile. `BoqHubPage` passes `onOpenSpoke={handleOpenSpoke}` where `handleOpenSpoke` calls `navigate(\`/upload-boq/hub/${boqId}/sheet/${encodeURIComponent(sheetName)}\`)`. All other card buttons (Mark reviewed, Set pending, Skip, Include, Edit label) are UNCHANGED.
- **Preview types in boqTypes.ts:** `SheetPreviewRow { row_number, cells: Record<string, string|number|boolean|null> }` and `SheetPreviewResponse { sheet_name, start_row, end_row_requested, rows, returned_count, has_more }`.

**useFrappeGetCall vs useFrappePostCall in the wizard (convention, Slice 3b-ii):** Wizard reads use `useFrappeGetCall` by default. Accumulating/paginating reads (UI appends rows across multiple fetches) use `useFrappePostCall` + local `useState`, because SWR replace-on-fetch semantics fight row accumulation -- `useFrappeGetCall` replaces `data` on params change instead of appending. GET/POST signals read-vs-mutation intent; `useFrappePostCall` for reads is the one sanctioned exception and is limited to SheetDataGrid (Slice 3b-ii). `@frappe.whitelist()` bare (the get_sheet_preview endpoint) accepts both GET and POST.

**Module 3 Slice 3b-iii -- SheetDataGrid polish (feat 2ac4789a):**

- **Sticky column-letter header:** `overflow-x-auto` → `overflow-auto max-h-[calc(100vh-14rem)]` on the container. Bounded height creates a vertical scroll window so `sticky top-0` fires within the container (not relative to the page). z-index order: corner `#` cell = `sticky top-0 left-0 z-30`; column-letter headers = `sticky top-0 z-20`; row-number gutter = `sticky left-0 z-10`. All sticky cells use solid `bg-muted` or `bg-background` (not semi-transparent) so body rows don't show through.
- **Visible gridlines:** `border-r border-border` added to column-letter `<TableHead>` cells and data `<TableCell>` cells. Existing `border-b` on `<TableRow>` provides horizontal lines. Corner + gutter cells already had `border-r` from Slice 3b-ii.
- **Decode fix (SheetSpokePage.tsx):** `const decodedSheetName = sheetName ? decodeURIComponent(sheetName) : ""` applied once. All display uses, draft lookup, and `SheetDataGrid sheetName` prop use `decodedSheetName`. Raw `sheetName` kept only for the `!sheetName` guard. Hub navigation unchanged (`encodeURIComponent` still used in `handleOpenSpoke`).

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
- **ITM DC & MIR**: ITMs in `Partially Delivered` or `Delivered` status can have Delivery Challans + Material Inspection Reports filed against them, parallel to the PO flow. The `PO Delivery Documents` doctype is polymorphic (`parent_doctype` Select + `parent_docname` Dynamic Link). Surfaces with PO/ITM toggle: hub `/prs&milestones/delivery-challans-and-mirs`, project `DC & MIR` tab (sub-tabs for DN > DC Report + DC + MIR), reports `DCs & MIRs` tab. ITM-only: `ITMAttachmentSection` on the ITM detail page. Hub toggle URL-persisted via `parent`; project sub-toggle via `dcmir_parent`; reports toggle via `dcmir_parent`. **PO-only by design** (do NOT mix in ITM rows): Material Usage tab, DN > DC PO report, Bulk Download wizard — all filter by `procurement_order ["is", "set"]`. Mobile cards: `ITMListCards.tsx` mirrors `POListCards.tsx`. Upload dialog `UploadDCMIRDialog` accepts optional `parentDoctype` prop ("Procurement Orders" default, "Internal Transfer Memo" for ITM). `ITMDNDCQuantityReport` is a parent-child grouped reconciliation report (mirrors `DNDCQuantityReport` exactly: parent ITM rows expand to item sub-rows, status rollup, sortable totals, source-project facet, status facet, search, CSV export, info banner, error state). Fetches ITM child items via `get_project_itms` (extended to include items array). PO/ITM toggle UI is a red-active segmented control (mirrors project tab styling). `ITMAttachmentSection` always renders the card when `canView`; only the upload buttons are gated by `canUpload` (status in delivered states) — historical DCs/MIRs never disappear if the ITM moves out of upload-eligible state.

# currentDate
Today's date is 2026-03-12.

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
