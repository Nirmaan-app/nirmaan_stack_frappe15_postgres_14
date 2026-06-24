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

### BoQ Pricing Editor -- Frontend Conventions (live component contracts)

These are the current, component-keyed contracts for the pricing editor (`PricingGrid.tsx` / `SheetPricingPage.tsx`).
Full per-slice as-built detail (Slices 2 -> 4a.2) lives in `boq-upload-plan.md` under "## Phase 5 Pricing Editor --
slice detail".

**Pricing grid keyboard-nav matrix (`PricingGrid.tsx`) -- the current contract:** roving-tabindex + a per-cell ref map
`cellRefs: useRef<Map<string,HTMLElement>>` keyed `${rowIndex}:${colIndex}`, where **`rowIndex` is the ARRAY INDEX into
`rows`** (not `row.row_index`). `colIndex`: 0..4 = the 5 fixed anchors (`FIXED_ANCHOR_COUNT = 5`: Excel Row / Sl.No /
Parent / Classification / Description); `FIXED_ANCHOR_COUNT + dIdx` = the descriptor columns; the trailing **Remarks**
column is `remarksColIndex = FIXED_ANCHOR_COUNT + displayDescriptors.length` and **`colCount = remarksColIndex + 1`**
(the +1 widens only `nextCell`'s right/Tab boundary -- it is the live post-4a.2 form; the remarks cell joined the matrix
in 4a.2). Focus target per cell differs: a RATE cell's `<input>` carries the ref/tabIndex/onFocus (`inputFocusProps`),
every other cell's `<td>` does (`tdFocusProps`); `onFocus` sets `activeCell`. Pure exported `nextCell(active, dir,
rowCount, colCount)`: arrows move one cell + STOP at edges (no wrap); Tab = right then wrap to next row col 0 then STOP;
Shift-Tab = reverse; Enter maps to "down". One `<table onKeyDown={handleGridKeyDown}>` handler maps key->dir, ALWAYS
`preventDefault`s a nav key while activeCell is set, calls `commitActiveRate(activeCell)` (commit-on-move; `commitRate`'s
`committedAttemptRef` dedupe absorbs the trailing onBlur -- save behaviour unchanged), then `focusCell(next)`. The rate
`<Input>` is `type="text" inputMode="decimal"` (frees the arrows) with a `DECIMAL_IN_PROGRESS` regex guard. Enter on the
remarks cell opens its editor (a controlled `RemarkCell`, open-state lifted to the grid as `openRemarkRowIdx`); Enter
inside the editor = save-and-move-down via the SAME `nextCell(..., "down")` path; Esc closes. **Extend this matrix
(colCount, focus targets) for new columns; never reshape the rate-cell nav.**

**Row-level memoization contract (`PricingGrid.tsx`, editor perf fix -- the load-bearing render rule):** the per-row
`<tr>` is a `React.memo`'d **`PricingGridRow`** (comparator `pricingRowPropsAreEqual`, both exported for unit test). The
cursor (`activeCell`) is grid-local state, so a cursor move (arrow key / click) re-renders `PricingGrid`; without per-row
memoization the WHOLE table (every row x every cell, an `evaluateAmountCell` at each amount cell) re-rendered per
keystroke -- the felt lag on big sheets (Electrical 194 / VRF 121). Now a cursor move re-renders only the **2** rows
whose active-state flipped, and a keystroke only the **1** edited row. **THE LOAD-BEARING ANTI-DEFEAT RULE: a memoized
row must NEVER receive the shared `draftRates` / `proposedRates` object** (a keystroke makes a new reference -> all rows
re-render -> memo silently defeated). Each row gets ONLY its own slice via **`groupDraftsByRow`** (exported, unit-tested):
per-row sub-maps keyed by the FULL `${row_index}:${col}` key, **reference-REUSED** from the prior render (a `useRef` +
`useMemo([draftRates])`) so an unrelated row's slice identity is stable across a keystroke. **The cursor lever** is the
`activeColIndex: number | null` prop (= `activeCell?.rowIndex === rowIdx ? activeCell.colIndex : null`) -- only the
previously-active + newly-active rows see it change. The per-cell active/tabindex/className helpers (`isActiveCol`,
`isTabStop`, `cellNavClass`, `tdFocusProps`, `inputFocusProps`) now live INSIDE `PricingGridRow`, computed from
`activeColIndex`/`anyCellActive`; the grid keeps only the focus-ref plumbing (`registerCell`/`focusCell`/`onCellFocus`)
and the mutation closures (`commitRate`/`scheduleAutoSave`/`setOpenRemark`), ALL `useCallback`-stable so the memo holds.
The grid derivations (`byIdx`, `computeDepths(rows)`, `displayDescriptors`, `slNoLetter`/`descriptionLetter`) are
`useMemo`'d on `[rows]` / `[columnDescriptors]` (NEVER on `activeCell`). The comparator is EXHAUSTIVE (returns false if
ANY prop changed) so memoization never goes stale -- a save->`mutate()` hands fresh `row`/`flags`/slice references ->
that row re-renders. **ZERO behaviour change** (same flags / markers / amounts / nav / lock gating, computed fewer
times). NEVER pass the shared draft/proposed map, the whole `byIdx`, or an inline-arrow callback to a memoized row.

**Read-only gating = PRESENCE of the save callback (the single root signal -- do NOT add a second):** the grid's
editability is whether `onSaveRate` (and, for annotations, `onSaveRemark`/`onSaveColor`) is passed. The page withholds
them (`onSaveRate={locked ? undefined : handleSaveRate}`, same for the annotation handlers) when `locked = editable ===
false || takenOver`, and ALL edit paths (rate-cell render branch, `commitRate`, `commitActiveRate`, `scheduleAutoSave`,
the `flush()` handle, `handleGridKeyDown`) collapse to the read-only render. A grid-only (general-specs) sheet never
reaches PricingGrid (the `isGridOnlySheet` fork renders a read-only `SheetDataGrid`), so it is annotation-free by
construction. **Do NOT add a per-cell `editable` check -- it duplicates the callback-presence gate.** Takeover detection:
`isTakeoverError(msg)` = `msg.includes("BOQ_PRICING_LOCKED")` (`.includes`, since `getFrappeError` ", "-joins messages).

**Rate-edit gate is ASYMMETRIC by node_type (`PricingGrid.isRateEditableRow`, owner-locked):** the rate-cell render
branch gates on `onSaveRate && isRateDescriptor(d) && isRateEditableRow(row, override)`, where
`isRateEditableRow(row, override) = override || row.node_type === "Line Item" || (row.node_type === "Preamble" &&
isRowQtyBearing(row))`. **A LINE ITEM is ALWAYS editable** (a zero-qty Line Item is a valid rate-only line -- do NOT
lock it); **a PREAMBLE is editable ONLY when qty-bearing** (a zero-qty Preamble -- nearly all Preambles -- is read-only);
a non-priceable type / null node_type is read-only; the **"Price any row" override unlocks BOTH** a zero-qty Preamble and
any non-priceable type. **This Preamble/Line-Item asymmetry is a DELIBERATE owner-locked rule -- never collapse it to
uniformity.** `isRowQtyBearing(row)` = **"qty ANYWHERE" (Definition A)**: `isNonZeroNum(row.qty_total) || any
Object.values(row.qty_by_area)` is finite non-zero. `isNonZeroNum` is a **SELF-CONTAINED copy inside PricingGrid** (NOT
imported from priceability -- importing back would reverse the one-way dependency / make a cycle). **THE DELIBERATE
DIVERGENCE (record, do NOT "fix"):** this gate's "qty anywhere, per-row, Preamble-only" is intentionally LOOSER than
`priceability.isPriceableLine`'s "qty in a RATE-COLUMN area, per-area, both types" -- they answer different questions
(edit-gate vs flags/priced-count/rollup) and correctly use different predicates. The gate change reads only
`row.qty_total`/`row.qty_by_area`/`row.node_type` (already on the memoized row prop) -- NO new shared-object prop, so the
perf memo is not defeated. The server (`save_cell_price`) enforces the SAME rule (`_node_is_qty_bearing`) -- client = UX,
server = the real boundary, no axis drift. **Marker nuance (known, not a defect):** the amber "needs review" priced
marker still keys on `isPriceableType` (TYPE), so an override-priced zero-qty Preamble renders emerald not amber; marker
logic was left unchanged (out of this slice's scope). **Build-time consistency finding (reported, not decided):** a
zero-qty rate-only Line Item is now editable but, because `isPriceableLine` excludes it, is NOT counted in the N/M
priced-count nor flagged needs_rate -- a follow-up decision for the owner; `isPriceableLine`/flags/count were NOT changed
here.

**MANDATORY amount-formula gate (`priceability.areFormulasComplete` + `PricingGrid.formulasComplete` + `SheetPricingPage`
banner; owner-locked):** amount formulas are now **MANDATORY before pricing** -- this **REVERSES the F1-F4 "formula
optional" property**. The new pure `priceability.areFormulasComplete(columnDescriptors, columnFormulas)` is the per-SHEET
completeness predicate: **every amount column descriptor (`isAmountDescriptor`) must be COVERED by a declared formula**, where
"covered" is **`pickFormula`'s override>area-wildcard-default resolution** -- so ONE wildcard default (`target_value_key`
null) covers ALL per-area amount columns sharing its `(value_field, rate_subkey)`; a present-but-CLEARED record (null
`.formula`) does NOT count; a sheet with **zero** amount columns is **TRIVIALLY complete** (rate editing NOT blocked). It
REUSES the EXACT `pickFormula` resolution `evaluateAmountCell` uses, so completeness can never drift from how amounts
compute. **No import cycle** (`priceability` already imports PricingGrid's leaf predicates; `pickFormula` from the leaf
`amountFormula.ts`). The page computes `const formulasComplete = areFormulasComplete(columnDescriptors, columnFormulas)` (the
data is ALREADY in hand from `get_priced_rows` -- NO new fetch) and passes it as a NEW per-SHEET boolean prop
`formulasComplete?: boolean` (**default TRUE** for back-compat). The grid ANDs it into the rate-cell render gate **OUTSIDE
`isRateEditableRow`**: `onSaveRate && formulasComplete && isRateDescriptor(d) && isRateEditableRow(row, override)` -- because
the `override` lives INSIDE `isRateEditableRow`, it can **NEVER reach past `formulasComplete`** (no declared formulas =>
NOTHING rate-editable, override or not). The prop is added to `PricingGridRowProps` AND the exhaustive comparator
`pricingRowPropsAreEqual` (**memo-safe**: a per-sheet boolean flips identically for all rows -> a flip re-renders all rows
ONCE). **`onSaveFormula` is DELIBERATELY NOT withheld by this gate** -- declaration (the `AmountFormulaBuilder` on each amount
`<th>`, gated only by `isAmountDescriptor(d) && onSaveFormula`) stays live while rates are locked, so the gate is
satisfiable; it is withheld only by `locked` (the single-editor lock), as before. The `SheetPricingPage` banner ("Declare
amount formulas to enable rate entry.", amber-note style) shows when `!isGridOnly && !locked && !pricedLoading &&
!pricedError && !formulasComplete` (a trivially-complete sheet never shows it). The server (`save_cell_price` ->
`_sheet_formulas_complete`) enforces the SAME rule OUTSIDE the override block -- client = UX, server = the real boundary. The
asymmetric gate / `isPriceableLine` / flags / count / rollup / perf memo are UNTOUCHED; the formula gate composes cleanly on
top. **Live re-gate:** removing a formula flips `formulasComplete` back to false (re-locking rates) as a natural consequence
of the live `column_formulas` read -- no special handling.

**Amount-column formula-status badge (`priceability.isAmountColumnCovered` + `AmountFormulaBuilder.tsx` trigger +
`PricingGrid.tsx` `<th>` tint; owner-locked option (a) -- status + action MERGED):** after the mandatory gate the user
had no per-column guidance (which amount cols still NEED a formula). The fix relocates + recolors the formula affordance:
a LEADING `ƒ` STATUS BADGE at the START of each amount column `<th>` (before the label) -- **AMBER when the column has no
covering formula (pending), GREEN when covered** -- and the badge **IS the click-to-edit trigger** for the
`AmountFormulaBuilder` popover (status + action are one control). The old far-right secondary preview line (the
`blue tokensToText` label under the column label) is **REMOVED** -- it was a tiny truncated 2nd line on far-right,
often-scrolled-off, narrow columns, which is the recon-diagnosed **layout/visibility** root cause of the "sometimes
doesn't render / easy to miss" complaint (NOT a data bug -- the control already resolved correctly via `pickFormula`).
**Relocating the trigger to the prominent leading badge IS the render-bug fix.** A subtle full-`<th>` **amber tint**
washes PENDING amount columns (covered/non-amount columns keep neutral `bg-muted`) so a wide sheet (VRF 9 cols) is
scannable at a glance; amber tokens (`bg-amber-50 dark:bg-amber-950/40`) mirror the gate banner. **Badge⇔gate agreement
(by construction):** the NEW pure `priceability.isAmountColumnCovered(d, columnFormulas)` =
`!!(pickFormula({value_field,value_key,rate_subkey}, columnFormulas)?.formula)` is the SINGLE per-column predicate;
`areFormulasComplete` now folds `.every()` over it -- so **every amount column GREEN ⇔ areFormulasComplete true ⇔ rate
gate open + banner hidden**. The badge color reuses `AmountFormulaBuilder`'s already-computed `applicable = pickFormula(...)`
(`covered = !!(applicable && applicable.formula)`, the SAME resolution -- no second path, no priceability import → **no
cycle**). The `<th>` tint check is `pickFormula` **inline** in `PricingGrid` (already imported from `amountFormula.ts`),
**NOT** `priceability.isAmountColumnCovered` -- importing priceability into PricingGrid would reverse the one-way
dependency into a cycle (same reason `isNonZeroNum` is a self-contained copy); it is the SAME override>wildcard
`pickFormula` resolution, so it can't drift. **Read-only branch preserved:** when `onSaveFormula` is withheld (locked /
taken-over / general-specs) the badge renders as a STATIC amber/green glyph with NO popover -- status always visible,
editing gated by `onSave` exactly as before. **Display-only:** the header is in `<thead>`, OUTSIDE the memoized
`PricingGridRow`, so a badge/tint re-render is free -- the gate logic / rate path / `pricingRowPropsAreEqual` / flags /
count / rollup / perf memo are UNTOUCHED. Non-amount columns get no badge + no tint. Builder popover / `onSave` /
validation / cycle-check UNCHANGED (only the trigger's look + position changed). vitest 235→241 (priceability 36→42:
`isAmountColumnCovered` incl. wildcard + cleared + the shared-predicate agreement; no RTL in this env so the badge RENDER
is not unit-tested -- the underlying coverage boolean is), tsc 3175 (0 new), in-container build exit 0, 2026-06-21.

**Full-screen / maximize editor (`SheetPricingPage` `expanded` state + `PricingGrid`/`SheetDataGrid` `expanded` prop +
`shouldExitFullscreenOnEsc`; owner-locked Slice 4c):** a "Full screen" toggle grows the pricing editor to fill the
viewport (the dense grid benefits from screen real estate); "Exit full screen" / **Esc** collapses back. **In-app
maximize, NOT the native Fullscreen API, NOT a Dialog/Sheet/portal.** The page holds `const [expanded, setExpanded] =
useState(false)`; the implementation toggles ONLY the **root wrapper's className** via `cn(expanded ? FULL : EMBEDDED)`
where FULL = `fixed inset-0 z-50 flex flex-col space-y-4 overflow-auto bg-background p-4` (covers the app shell, exactly
like the house Dialog/Sheet overlay) and EMBEDDED = the prior `flex-1 space-y-4 max-w-5xl mx-auto pt-6 pb-10 px-4`. **THE
LOAD-BEARING NO-REMOUNT RULE:** it is **ONE JSX tree** (same children, same positions, same `PricingGrid key={sheetName}`)
-- only the wrapper class flips, so React reconciles the same element in place and expand/collapse **NEVER remounts the
grid** -> `draftRates` (unsaved rates), `proposedRates`, `activeCell` (cursor), the per-cell debouncer timers, the
imperative `gridRef` (the review-strip `scrollToRow`), the single-editor lock / `takenOver`, and ALL page state
(override, `showOnlyUnpriced`, `reviewOpen`, `lastSavedAt`) survive untouched. Do NOT reach for `createPortal` / Dialog /
Sheet / a second return-branch with a different child tree -- they remount the subtree and would DROP unsaved rates +
re-fire the unmount-flush + lose the cursor. **Grid height in full-screen:** the FULL root is `flex flex-col`, the grid
SLOT (a wrapper `<div className={cn(expanded && "flex min-h-0 flex-1 flex-col")}>` around the render fork) takes
`flex-1 min-h-0`, and each grid's OUTER scroll container relaxes its `max-h-[calc(100vh-14rem)]` cap to `flex-1 min-h-0`
when `expanded` (a new `expanded?: boolean` prop, default false, on BOTH `PricingGrid` and the grid-only `SheetDataGrid`).
The grids' sticky header (`sticky top-0 z-20`) + horizontal `overflow-auto` are scroll-container-relative -- they carry in
unchanged; NO grid scroll/sticky internals are touched. **`expanded` is a per-GRID prop, NOT a per-row prop** -- it never
enters `PricingGridRowProps` / `pricingRowPropsAreEqual` / the row render, so the perf memo is intact (display-only).
**Esc-to-exit:** a `window` keydown listener mounted ONLY while `expanded` (`useEffect([expanded])`, removed on
collapse/unmount), calling the pure `shouldExitFullscreenOnEsc(e, document.activeElement)` (exported from `PricingGrid.tsx`
alongside `deriveSaveStatus`/`isGridOnlySheet` -- the established home for page-level pure helpers, sdk-free so it is
unit-tested in `PricingGrid.test.ts`). It returns true ONLY for a bare `Escape` that is **not `e.defaultPrevented`** (the
RemarkCell + AmountFormulaBuilder Radix popovers `preventDefault` THEIR Escape-dismiss, so a popover-closing Esc never
exits full-screen) and **not while an `<input>`/`<textarea>` is focused** (a rate/remark being typed owns its Esc). It is
DELIBERATELY a window listener (not the grid `<table>` -- it would miss Escs fired inside a portaled popover) and does NOT
touch the grid's own `handleGridKeyDown` / `nextCell`. **The toggle button renders OUTSIDE the `!isGridOnly` gate** (the
right-cluster wrapper now renders unconditionally; only the Save/Summary/Review/override buttons stay `!isGridOnly`) so a
read-only / grid-only / general-specs sheet can ALSO maximize -- full-screen is orthogonal to editability and composes
with the lock (a locked sheet is read-only but still expandable). Layout-only: NO pricing/gate/badge/flag/lock/rollup
logic, NO endpoint, NO migrate. vitest 241→245 (PricingGrid 109→113: `shouldExitFullscreenOnEsc`), tsc 3175 (0 new),
in-container build exit 0, 2026-06-24.

**Cross-area prefill save-path invariant (`PricingGrid.tsx`):** proposals live in a SEPARATE `proposedRates` map, NEVER
in `draftRates`. **No save path reads `proposedRates`** -- `commitRate`, `commitActiveRate`, `scheduleAutoSave`, the
`flush()` handle, and the unmount-flush all read `draftRates[key] ?? savedRateStr(...)` ONLY. Anything in `draftRates` is
committable; a cross-area proposal must never be written there until the user touches the cell (the input onChange then
deletes the `proposedRates` entry, promoting it to a real draft). Do NOT merge the two maps.

**Annotation render conventions (`PricingGrid.tsx`):** the **Remarks** column is a trailing `<th>/<td>` rendered AFTER
the `displayDescriptors.map()` (the established trailing-column pattern), edited via a click/Enter-to-open controlled
`RemarkCell` (shadcn Popover + Textarea, 250-char counter, Save/Clear). The **color** channel is a thick LEFT BORDER
(`colorClassForToken(token)` -> `border-l-4 border-l-<color>`), DELIBERATELY a border NOT a background, so it never masks
the system-owned cell BACKGROUND (emerald = priced / amber = priced-non-priceable) or the priced dot or the blue focus
ring -- the four channels coexist. The in-app channel is the border; the Excel-export = fill mapping is a later slice.
Apply-to-row fans out to `rowColorCells(displayDescriptors)`; the page owns the N POSTs + one `mutate()`.

**Amount-formula evaluator `amountFormula.ts` (Formula Builder F2 -- PURE module, NOT a component; full detail: plan
§"Formula Builder F2"):** the headless engine F4 calls per amount cell to compute `qty x rate` (or any +/* amount
formula) and fix the stale-amount bug `findPairedRateDescriptor` causes. **PURE** -- no React/DOM/Frappe, does NOT read a
row, does NOT import `resolveDescriptorValue` (types only). Entry `evaluateAmountColumn(col, columnFormulas, lookup) ->
EvalResult` (`{ok:true,value}` | `{ok:false, reason:"not_yet"|"broken"}`; not_yet="needs a rate", broken="check formula").
The CALLER (F4) injects `OperandLookup = (ref) => number|null|undefined` (concrete ref -> the row's value; real-0 is a
value, absent -> undefined, MIRROR `resolveDescriptorValue`). F2 itself does area-binding (a wildcard leaf value_key=null
on a `*_by_area` field binds to the column's area; a scalar value_field stays scalar -- the area-bind signal is the
value_field, no extra field), amount-refs-amount recursion (a leaf whose column has a formula recurses; else lookup),
cycle detection (-> broken), and the §0 FAIL-SAFE (ANY missing operand blanks the WHOLE formula -- no partial sum, no
zero-substitution; broken beats not_yet; NEVER throws). Wire types (`AmountFormulaNode`/`AmountFormulaRef`/`ColumnFormula`
+ `GetPricedRowsResponse.column_formulas`) live in `boqTypes.ts`. **F4 REPLACES `findPairedRateDescriptor`
(PricingGrid.tsx:1277-1300) with `evaluateAmountColumn`; F2 does NOT touch PricingGrid.** `pricingRollup.ts`/`SummaryPanel`
(the cross-row subtotal surface) is SEPARATE + untouched.

**Amount-formula builder `AmountFormulaBuilder.tsx` + `formulaTokens.ts` (Formula Builder F3 -- the click-to-insert editor;
full detail: plan §"Formula Builder F3"):** a per-amount-column shadcn Popover (ColorPicker/RemarkCell house style),
mounted by `PricingGrid` inside each AMOUNT `<th>` (gated `isAmountDescriptor`). The user ASSEMBLES a formula by clicking
real columns + `+ × ( )` -- NO free text, NO number input (literals barred by construction). The builder edits a flat
TOKEN LIST; `formulaTokens.parseTokens` (PURE, unit-tested -- the F3 risk spot) parses it to the F1 tree on save
(`×`-over-`+` precedence, brackets override, n-ary flatten; errors empty/dangling/unbalanced). **DEFAULT-as-template:**
`tokenRefForMode(d, mode)` inserts a WILDCARD leaf (value_key null) for a default on an area-bound column (F2 binds it
per-area) vs a CONCRETE ref for an override/scalar. The default/override toggle shows ONLY on a per-area amount column.
Cycle check at save REUSES F2 (`wouldCreateCycle` runs `evaluateAmountColumn` with a dummy `× 1` lookup -> broken === cycle;
NOT reimplemented). The header `ƒ = …` label reads `column_formulas` (applicable via F2 `pickFormula` precedence). Save ->
the page's `onSaveFormula` (`SheetPricingPage.handleSaveFormula` -> `save_amount_formula` POST + mutate; tree as JSON
string, `""` clears); **withheld when locked** -> the header renders read-only (the callback-presence gate). New wire type
`AmountFormulaSaveArgs` in boqTypes.ts. **F3 only AUTHORS the formula -- the amount-cell COMPUTE path
(`findPairedRateDescriptor`) is UNCHANGED; F4 owns that swap.**

**Amount-cell formula compute `PricingGrid.evaluateAmountCell` (Formula Builder F4 -- the grid swap, ARC COMPLETE; full
detail: plan §"Formula Builder F4"):** the amount-cell value now flows from the PURE exported `evaluateAmountCell(d, row,
columnDescriptors, columnFormulas, draftRates) -> AmountCellResult` (`value` | `committed` | `blank{not_yet|broken}`);
the render is a thin map. **Formula-wins-else-pairing:** an amount column WITH an applicable formula (F2 `pickFormula`
precedence override>default, REUSED) computes via `evaluateAmountColumn` (F4 passes the CONCRETE column; F2 binds the
wildcard default per-area -- F4 never pre-binds); NO formula -> the UNCHANGED `findPairedRateDescriptor`->`computeAmount`
fallback (committed value when un-priced). The injected `lookupOperandValue` is DRAFT-AWARE per rate operand (live
recompute as you type ANY rate the formula references -- the real change from the old single-paired read), mirroring
`resolveDescriptorValue` (real-0 is a value; absent->undefined). `validateFormulaRefs` is the dangling-ref gate (a ref
matching NO live descriptor -> broken, not a silent not_yet). **Fail-safe:** a formula that can't resolve renders BLANK
(not_yet = "Needs a rate" title; broken = blank + an `AlertTriangle` marker + "Check formula") -- NEVER a stale/wrong
number. This **fixes the supply+install->single-total stale-amount bug** (findPairedRateDescriptor couldn't pair it).
Surfacing not_yet/broken into the review-list seam is a **4b** concern (F4 leaves the cell-marker hook). F2/F3/storage +
rate-save/nav/color/remarks + `pricingRollup.ts`/`SummaryPanel` all UNTOUCHED. **The formula arc F1-F4 is COMPLETE.**

**Summary formula-fix `pricingRollup.ts` + `SummaryPanel.tsx` (post-F4 fix; full detail: plan §"Summary fix"):** F4 swapped
the GRID amount compute to formulas but the SUMMARY rollup still used the old `findPairedRateDescriptor` path, so
formula-only amount columns rolled up ZERO (Alorica throughout; Electrical Phase 2). FIX: `rollupByParent(rows,
columnDescriptors, columnFormulas=[])` + `rowOwnAmount` is now **formula-aware ONLY when a formula applies** -- `pickFormula`
(REUSED) -> `evaluateAmountColumn` with a **saved-only** lookup (`lookupOperandValue(row, ref, descriptors, {})` -- empty
draftRates skips the draft branch; un-priced -> not_yet -> null -> 0). **NO-formula columns are byte-for-byte unchanged**
(the D-2 guard -- NOT routed through `evaluateAmountCell`). **SAVE-TIME** (Option A: saved values only, no `draftRates`
threaded; the summary refreshes a beat after each auto-save's `mutate()`). Added: a **grand-total `<tfoot>` row** (Option 1
= sum of top-level rolled totals, root orphans included, each item once) + a **reconciliation guard** (Option 1 vs Option 2
= flat line-item sum; mismatch beyond `max(0.01, 1e-9*mag)` -> an amber integrity banner naming the column + both numbers,
the Option-1 value still shown). New prop `columnFormulas` threaded `SheetPricingPage`->`SummaryPanel`->`rollupByParent`.
not_yet/broken fold to 0 (the 4b incomplete-marker is deferred). No circular import (`pricingRollup`->`PricingGrid` already
existed). The grid compute / rate-save / nav / color / remarks / backend untouched.

**Prepopulated-rate fix `PricingGrid.lookupOperandValue` (RATE branch; full detail: plan §"Prepopulated-rate fix"):** a
formula ignored a PREPOPULATED committed rate (a real non-zero tender value with no editor MARKER) because the rate read
gated on `isCellPriced`, not value-presence -> the amount blanked until re-edited (confirmed on 150/166 by a DB peek). FIX:
a RATE operand is usable when `isCellPriced(row, rd)` **OR the resolved committed value is a NON-ZERO finite number**.
Three states: editor-priced (marker, any value incl. 0) -> value; committed NON-ZERO (no marker) -> value [THE FIX];
committed 0.0 (no marker) -> undefined -> not_yet ("needs a rate"). Owner-accepted: a genuine-0 never-priced rate BLANKS
(safer; price it 0 to set the marker). **RATE branch ONLY** -- the qty/plain-amount read is untouched (a committed qty 0
still reads 0); `isCellPriced` itself is UNCHANGED (its 5 other consumers -- pairing fallback, prefill/cleanup, priced
tint -- unaffected). No new storage/flag (non-zeroness is the distinguisher; the committed tier has no NULLs). The fix is
in the SINGLE shared `lookupOperandValue`, so it flows to BOTH the grid cell AND the summary rollup (drafts={}) -- the
rollup SOURCE was not edited.

**Computed review-flag layer `priceability.ts` (Slice 4b-A, Cluster A; full detail: plan §"Slice 4b-A"):** the NEW shared
spine `priceability.ts` is the ONE place the "qty-bearing priceable line" rule lives -- the §6 one-shared-definition. LOCKED
owner rule: a row is a PRICEABLE LINE iff `isPriceableType(node_type)` (Preamble/Line Item) AND it is QTY-BEARING in >=1
pricing area (a zero-qty-everywhere priceable row DROPS OUT of the population). FILLED = `isCellPriced` OR a
prepopulated-committed-non-zero rate -- expressed as `lookupOperandValue(row, ref, descriptors, {}) !== undefined`, so it
REUSES the editor's single source of truth (never a bare zero-check; a deliberate editor-0 counts, an unfilled 0 does not).
FULLY PRICED = option-(i): every QTY-BEARING area's rate cell(s) filled (no-qty areas IGNORED). Per-ROW count (owner-locked).
Every consumer routes through this module: `computeRowFlags` (the flags + F4 not_yet/broken), `computePricedCount`
(N/M done-test), `isRowIncomplete` (the incomplete-subtotal atom), and the `pricingRollup` alignment. **No circular import:**
`priceability` imports PricingGrid's leaf predicates (`isPriceableType`/`isCellPriced`/`isRateDescriptor`/`isAmountDescriptor`/
`lookupOperandValue`/`evaluateAmountCell`); PricingGrid NEVER imports `priceability` -- it
RECEIVES the flags as a `rowFlags?: Map<number, RowReviewFlags>` prop (the flag types `AreaKey`/`ReviewFlagKind`/
`RowReviewFlags`/`ReviewEntry`/`PricedLineCount` live in `boqTypes.ts` so the grid consumes them without the cycle).

The flags (all DERIVED on the fly -- no stored field): **needs_rate** (priceable line, a qty-bearing area not filled --
per-area aware: priced in X but not qty-bearing Y still fires for Y); **qty_anomaly** (a NON-priceable node_type carrying
qty -- the inverse guardrail). Plus F4's **broken**/**not_yet** surfaced by READING `evaluateAmountCell(d,row,...,{})`
(saved-state; the live grid keeps its own draft-aware broken `AlertTriangle`). **broken/not_yet are GATED behind the
priceability spine (cert fix):** they fire ONLY on (1) a PRICEABLE LINE (`isPriceableLine` -- the whole loop is skipped on a
non-priceable row) and (2) an amount cell whose AREA is QTY-BEARING on that row (option-(i), reusing the SAME
`isAreaQtyBearing` the `qtyBearingAreas` set is built from -- NO new qty check), SYMMETRIC with needs_rate -- so a
notes/header/non-priceable row never flags, and a no-qty area's amount cell is ignored on a priceable row. (The same gate is
applied to `isRowIncomplete` so the Summary message agrees with the grid.) **not_yet is also DE-DUPED against needs_rate
(cert fix, PER-AREA):** an amount cell's not_yet is SUPPRESSED when its area is already in the row's `needsRateAreas` -- the
amount-not-computed there is the SAME rate gap needs_rate reports (two messages for one problem = noise); the suppression is
a membership test reusing `needsRateAreas` (no recompute, no new rate check). **broken is NEVER suppressed** (a malformed /
cyclic formula is a different, real problem); and not_yet STILL fires for a non-needs_rate area whose formula blanks for a
NON-rate cause (e.g. an uncomputed amount operand). `isRowIncomplete` is unaffected -- a needs_rate row is already
`!isFullyPriced` -> incomplete before its amount loop, so the Summary stays correct. (**`wont_compute` was removed before
push** --
superseded by the forthcoming mandatory amount-formula-declaration gate, which makes the no-formula-at-pricing state
impossible, so the flag could never fire.) **In-grid marker (`PricingGrid.tsx`):** a left accent + `Flag` icon
in the Excel-Row GUTTER (col 0) -- DELIBERATELY in the gutter (which carries no priced tint / colour border) so a system flag
never collides with the emerald/amber priced background or the user colour border (§6); rose accent = critical
(broken/qty_anomaly), amber = attention. **Review strip (`SheetPricingPage.tsx`):** the 4a remark feed is EXTENDED IN PLACE
(one `ReviewEntry[]` list, no fork) = remarks + `buildFlagEntries` (the incomplete-subtotal STRIP entries were removed as
noise -- see below); each entry click-jumps via the existing `gridRef.current?.scrollToRow(excelRow)`; per-kind badge/colour
via the module-level `REVIEW_ENTRY_META`.
**Priced-count + filter (header):** a live "N of M priceable lines priced" readout (`computePricedCount`; "ready to finalize"
text when N===M, NO finalize logic -- that is a later slice) + a "Show unpriced" toggle filtering `displayRows` to
priceable-but-not-fully-priced (filtered PAGE-side; the grid's nav/byIdx stay consistent over the rendered set; `draftRates`
keyed by `row_index` persist across the toggle -- the grid is keyed on `sheetName` only, no remount).

**Incomplete-subtotal `pricingRollup.ts` + `SummaryPanel.tsx` (Slice 4b-A, STEP 7+8; strip->summary fix):** `RollupNode`
gains `incomplete: boolean` = an OR over self + descendants of `priceability.isRowIncomplete` (a qty-bearing priceable row
not fully priced / not_yet / broken). **Zero-qty / non-priceable descendants NEVER flag a parent** (owner: only qty-bearing
rows count). **The per-subtotal review-STRIP entries were REMOVED as noise** (the `incompleteSubtotalEntries` fn is deleted);
the signal now surfaces as **ONE quiet panel-level message** in `SummaryPanel` -- "Some priceable lines aren't fully priced
yet." -- shown when `roots.some(r => r.incomplete)` (a root's `incomplete` already ORs its whole subtree), muted style, NO
per-subtotal markers (owner option (a)). `SummaryPanel` already calls `rollupByParent` internally, so it reads
`RollupNode.incomplete` with NO new prop / fetch. **`RollupNode.incomplete` + `ownIncompleteByIdx`/`rolledIncomplete`/
`isRowIncomplete` are KEPT** (the message reads them). **Rollup ALIGNMENT (KEPT, owner-explicit):** the stale header comment
(node_type "NOT on the delivered row") stays corrected -- node_type IS now on `PricedRow`, and the priceable-POPULATION
decision (the incomplete signal) routes through the shared helper. The amount SUMMATION (`rowOwnAmount`) is INTENTIONALLY NOT
regated (regating would change committed-amount totals); only the incompleteness SIGNAL uses the helper, so the existing
rollup totals are byte-for-byte unchanged (the formula-aware / grand-total / reconciliation tests stay green).
**Cluster B (the formula-vs-document reconciliation CHOICE store) is now BUILT** (the choice store, the per-cell overlay,
the rollup-source switch [document-default], and the document-vs-formula divergence flag all shipped -- see the
"Formula-vs-document reconciliation (Cluster B)" paragraph below).

**Acknowledge dismiss layer `priceability.ts` + `SheetPricingPage.tsx` (Slice 4b-ACKNOWLEDGE; full detail: plan §"Phase 5
Slice 4b-ACKNOWLEDGE"):** a per-entry "reviewed / looks OK" DISMISS on the review strip. A dismissal HIDES a strip entry (a
computed flag OR a remark) from the ACTIVE view WITHOUT changing its condition (an ACKNOWLEDGMENT, not a fix -- the flag
clears for real only when its condition clears). **The store key is (excel_row, flag_kind) -- the SAME identity a
`ReviewEntry` carries, so `ReviewEntry` is UNCHANGED** (no shape edit). `priceability.ts` gains PURE helpers:
`dismissalKey(excelRow, kind)` => `"<kind>:<excelRow>"` (EQUALS the strip's existing `<li>` key `${e.kind}:${e.excelRow}` --
the membership composite is the strip key, locked by a test), `reviewEntryKey`, `buildDismissedKeySet` (from
`get_priced_rows.dismissals`, the additive sheet-level flat list `[{excel_row, flag_kind}, ...]`), `isEntryDismissed`,
`filterActiveReviewEntries` (ONE pass over the already-built `ReviewEntry[]` -- NO new page-level recompute). The new wire
types `DismissalRef` / `DismissalSaveArgs` + the `dismissals` key on `GetPricedRowsResponse` live in `boqTypes.ts`.
**`SheetPricingPage.tsx`:** `allReviewEntries` (the full sorted feed) -> `activeReviewEntries` (filtered) -> `reviewEntries`
= `showDismissed ? all : active`; the toolbar Review-count reads the ACTIVE count; the strip header gains a "Show dismissed
(N)" / "Hide dismissed" toggle (shown only when `dismissedCount > 0`, per-sheet, reset on tab switch); each strip row gains
a per-entry "Looks OK" (dismiss) / "Restore" (un-dismiss) ghost button -- `stopPropagation` (the row click scroll-jumps),
WITHHELD when `locked` (the read-only sheet has no dismiss action, mirroring the rate-save gate). `handleSaveDismiss`
mirrors `handleSaveColor` (in-flight count, takeover detection, `mutate()`); wires `save_cell_dismissal`
(`dismissed:false` un-dismisses). **RE-ARM is SERVER-side** (a successful `save_cell_price` freezes the row's computed
dismissals, EXCLUDING remark) -- the frontend just re-reads via `mutate()`; there is NO client re-arm logic.

**Formula-vs-document reconciliation `reconcile.ts` + `PricingGrid.tsx` + `priceability.ts` + `pricingRollup.ts` +
`SheetPricingPage.tsx` (Cluster B; full detail: plan §"Cluster B"):** when a committed (DOCUMENT) amount and the
formula-computed amount DIVERGE for the same amount cell, the editor FLAGS it and lets the user CHOOSE per cell which value
wins (stored per committed version via `save_cell_reconciliation_choice`). **NEW pure leaf `reconcile.ts`** (the ONE place
the comparison + resolution live, so grid/strip/rollup agree): `RECON_EPSILON_ABS/REL` + **`amountsEqual`** (the SHARED
tolerance -- `pricingRollup` now imports it for its Option-1-vs-Option-2 integrity guard, so ONE epsilon, never duplicated),
`amountsDiffer` (both sides must be real finite numbers -> a null/NaN side is NOT a divergence), `resolveDivergence` (the
**D1** rule: diverge+take_formula -> formula; diverge+unset/keep_document -> **DOCUMENT**; else no-divergence), `reconChoiceKey`
+ `buildReconChoiceMap`. **A LEAF** -- it imports only types, so `PricingGrid`/`priceability`/`pricingRollup` all import it
with no cycle (PricingGrid can NOT import pricingRollup -- that is the cycle reconcile.ts exists to avoid). **Detection
(D2a, `PricingGrid` amount cell):** when `cell.kind === "value"` (a real computed number -- not_yet/broken/committed never
diverge, **F1**), compare `resolveDescriptorValue(row, d)` (document) vs `cell.value` (formula) via `resolveDivergence`; the
SHOWN value defaults to the document (D1). A divergence renders a STRONG **violet `ReconcileBadge` pill** (distinct channel
-- background/left-border/gutter are taken) + a chooser popover labelled with both numbers; a RESOLVED choice shows a MUTED
grey pill (still visible). The badge is read-only (a static pill) when `onSaveReconChoice` is withheld (locked). **The grid
threads `reconChoices` -> a per-sheet `reconChoiceMap` (useMemo, reference-stable across a keystroke like `columnFormulas`)
-> the memoized row (added to `PricingGridRowProps` + `pricingRowPropsAreEqual`), memo intact.** **Strip (D2b):**
`priceability.buildDivergenceEntries` adds a "divergence" `ReviewEntry` kind (one per row, listing the unresolved diverging
cols; a resolved cell DROPS OUT); `ReviewFlagKind` gains `divergence`; `REVIEW_ENTRY_META` violet; the per-entry "Looks OK"
dismiss is WITHHELD for a divergence entry (its kind is not a dismissal token -- the chooser IS its resolution). **Rollup
(D4):** `rollupByParent` gains a `reconChoices` param -> `rowOwnAmount` resolves the chosen value ONCE (document-default) so
Option-1==Option-2 stays balanced; `SummaryPanel` threads it. **`SheetPricingPage`:** reads `reconciliation_choices` from
`get_priced_rows`, `handleSaveReconChoice` (mirrors `handleSaveDismiss`; `choice` null clears), withheld when `locked`. New
wire types `ReconChoice`/`ReconciliationChoiceRef`/`ReconChoiceSaveArgs` + the `reconciliation_choices` key on
`GetPricedRowsResponse` in `boqTypes.ts`. vitest 245->264 (NEW `reconcile.test` 12 + `pricingRollup` +4 + `priceability`
+3), tsc 3175 (0 new), in-container build exit 0, 2026-06-24.

**Toolbar Part 1 -- search + column-hide + 3 row-type filters (`SheetPricingPage.tsx` + `PricingGrid.tsx`; view-layer,
owner-locked; full detail: plan §"Toolbar Part 1"):** the pricing-editor header now carries FIVE view-only controls
(dropped into the existing `!isGridOnly` flex cluster; the toolbar LAYOUT rework is **Part 2, deferred until after Slice
5** -- only the controls were added, the header was NOT restructured). All default to the current behaviour (nothing
hidden, no search) so a no-touch user sees the exact prior grid. **(1) COLUMN-HIDE** -- a "Columns" Popover hides
NON-AMOUNT descriptor columns; **AMOUNT COLUMNS ARE NEVER HIDEABLE** (owner-locked -- their formula-status `ƒ` badge must
never be hidden). One source of truth: `hideableDescriptors(columnDescriptors)` (reuses `isAmountDescriptor`) lists the
popover; the grid guard `isColumnVisible(d, hiddenCols)` always returns true for amount columns. State = a per-GRID
`hiddenCols: Set<string>` tracked as HIDDEN (default EMPTY = nothing hidden, NO seeding -- a visible-set lazy-init would
flash on every sheet open). The grid renders + navigates a `visibleDescriptors` set used UNIFORMLY (header `<th>` map, row
`<td>` map, `remarksColIndex`/`colCount`, AND the `commitActiveRate` colIndex reverse-lookup) so the cursor can NEVER land
on a hidden column; the FULL `displayDescriptors` is kept for the data-fanout (cross-area prefill, autosave) so
`commitRate`'s identity stays stable across a hide. `hiddenCols` is per-GRID -- NEVER enters the row memo. **(2) SEARCH** --
a thin case-insensitive substring matcher over `row.description` (NO review-tier filter compose); `buildSearchHits` over
the rendered `displayRows` -> an N-of-M counter + prev/next `stepHit`-wrap that jumps via the grid's EXISTING
`gridRef.scrollToRow` (NOT ReviewTree's `revealAndScrollToRow`). **The ONE row-memo touch:** the per-row `isCurrentHit`
boolean is in `pricingRowPropsAreEqual` (like `reconChoiceMap`) so the highlight repaints on step; the current hit is a
**yellow BACKGROUND, not a ring** (the table is `border-collapse` -> a `<tr>` ring-inset is unreliable, and a blue ring
would collide with the active-cell ring). **(3/4/5) ROW-TYPE FILTERS** (spacers/notes/subtotals) -- three booleans keyed on
`effective_classification` (NOT node_type, which can't tell them apart); `classificationVisible` AND-composed into the SAME
page-side `displayRows` `.filter()` (the `=== rows` fast path preserved at default). **VIEW-ONLY (load-bearing):** the
toggles narrow ONLY `displayRows`; `computePricedCount` / `SummaryPanel` / the flag feed all read the UNFILTERED `rows`, so
hiding a row-type moves NO total/count, and nav-skip is free (the grid gets the already-filtered rows). Pure helpers
(`searchMatches`/`buildSearchHits`/`stepHit`/`isCurrentHitRow`/`classificationVisible`/`hideableDescriptors`/
`isColumnVisible`) live in `PricingGrid.tsx` + are unit-tested in the NEW `PricingToolbar.test.ts`. vitest 264->287, tsc
3175 (0 new), in-container build exit 0, 2026-06-24.

**Parent click-to-jump (`PricingGrid.tsx`; view-layer; restores §13-3a which 3a shipped read-only):** the Parent anchor
cell (col 2) is now a CLICKABLE jump to the parent row -- it scrolls + focuses the parent via the grid's EXISTING
`scrollToRow` path (search / review-strip precedent), NOT a new mechanism. When a parent exists the **`<button>` is col 2's
roving nav target** (it carries the focus props + active ring, exactly like a rate `<input>` owns its cell) so there is NO
second tab stop; a **ROOT row renders no button** and the `<td>` keeps `tdFocusProps(2)` (col 2 always has a nav target) --
backwards-compatible (the cell was a read-only muted span before). Activation: mouse-click + **Space** fire the button
natively (Space is not a nav key -> `handleGridKeyDown` lets it fall through); **Enter** is a col-2 special-case in
`handleGridKeyDown` (mirrors the remarks Enter case) so Enter jumps too (a root row falls through to the generic
Enter->down). The jump is the NEW pure exported `parentExcelRowOf(row, byIdx)` (root / -1-sentinel / parent-absent-from-map
-> null, safe no-op) -- it DE-DUPS the parent Excel-row resolution shared by the row render, the Enter handler, and (via
delegation) the imperative `scrollToRow`, and is unit-tested in `PricingGrid.test.ts`. **Row-memo rule:** the jump arrives
as a NEW per-row prop `onJumpToRow` (a grid-level `useCallback`, reference-STABLE -> memo-safe) added to BOTH
`PricingGridRowProps` AND `pricingRowPropsAreEqual` (the exhaustive comparator). **Frozen-left columns + column-resize
remain a SEPARATE later bundled slice** (recon recommendation (iii)) -- this slice touches NO table layout / widths /
sticky-left / colgroup. vitest 287->291 (PricingGrid 113->117: `parentExcelRowOf`), tsc 3175 (0 new), in-container build
exit 0, 2026-06-25. **Landing flash (follow-up):** a jump now also flashes the WHOLE landed row blue for 3s then clears
(focus alone cued only col 0) -- grid-level `flashExcelRow` state + a timeout ref (a new jump RESETS the timer, no stacking;
cleared on unmount; resets for free on the per-sheet remount), the derived per-row `isJumpFlash` boolean in
`pricingRowPropsAreEqual` (like `isCurrentHit`, via the NEW pure `isJumpFlashRow`); the blue `<tr>` wash WINS over the
search current-hit yellow for its 3s then reverts; instant on/off (NO transition -> calmest + reduced-motion-safe + leaves
the hover/current-hit paint untouched); `jumpToRow` stays reference-stable (deps []), so it ALSO flashes on the shared
imperative `scrollToRow` (review-strip + search jumps). vitest 291->294 (PricingGrid 117->120: `isJumpFlashRow`).

**Live status + per-slice as-built detail: see `boq-upload-plan.md`** (the `## Phase 5 Pricing Editor -- slice detail`,
`### Slice ...`, and `### Module 3 Slice ...` sections). The prepended per-slice status-block history was removed in the
docs-hygiene cleanup (git holds it). **Latest frontend slices:** Parent-jump landing flash -- a jump now flashes the WHOLE
landed row blue for 3s then clears (grid-level `flashExcelRow` + timeout ref, resets on a new jump; derived per-row
`isJumpFlash` in `pricingRowPropsAreEqual` via the NEW pure `isJumpFlashRow`; blue wins over search-yellow for its 3s;
instant on/off = reduced-motion-safe; also flashes on the shared `scrollToRow` so review-strip/search jumps flash too);
vitest 291->294, tsc 3175 (0 new), 2026-06-25, see the parent-click-to-jump paragraph above + plan §"Parent click-to-jump".
Parent click-to-jump -- the pricing grid's Parent cell
(col 2) is now a clickable jump to the parent row via the existing `scrollToRow` (restores §13-3a, which 3a shipped
read-only); the button is col 2's roving nav target (no second tab stop), root rows keep the `<td>` nav target + render no
button, Enter jumps via a col-2 `handleGridKeyDown` special-case (Space/click fire the button natively), the NEW pure
`parentExcelRowOf` de-dups the resolution + the new `onJumpToRow` stable prop is in `pricingRowPropsAreEqual`; frozen-left +
column-resize stay a SEPARATE later bundled slice; vitest 287->291, tsc 3175 (0 new), 2026-06-25, see the parent-click-to-
jump paragraph above + plan §"Parent click-to-jump". Toolbar Part 1 -- FIVE view-layer pricing-editor toolbar
controls (description SEARCH with N-of-M + prev/next jumping via the grid's `scrollToRow` + a yellow current-hit-row
highlight whose per-row `isCurrentHit` boolean is the ONE row-memo touch; COLUMN-HIDE via a "Columns" popover that EXCLUDES
amount columns [locked] and re-indexes the nav over a `visibleDescriptors` set; and 3 ROW-TYPE filters [spacers/notes/
subtotals] keyed on `effective_classification`, AND-composed into the page-side `displayRows` pass, VIEW-ONLY so no count/
total moves); pure helpers in `PricingGrid.tsx` + the NEW `PricingToolbar.test.ts`; vitest 264->287, tsc 3175 (0 new),
2026-06-24, see the Toolbar-Part-1 paragraph above + plan §"Toolbar Part 1" (Part 2 layout rework deferred until after
Slice 5). Formula-vs-document reconciliation (Cluster B) -- a per-cell
"keep document / use formula" choice on a divergent amount cell (NEW pure leaf `reconcile.ts` with the SHARED `amountsEqual`
tolerance; document-DEFAULT [D1]; a STRONG violet `ReconcileBadge` cell cue + chooser, muted when resolved; a "divergence"
review-strip kind; the chosen value resolved ONCE in `pricingRollup.rowOwnAmount` [D4]; divergence fires only on
`cell.kind === "value"`); vitest 245->264, tsc 3175 (0 new), 2026-06-24, see the reconciliation paragraph above + plan
§"Cluster B". Full-screen / maximize editor (Slice 4c) -- a "Full
screen" toggle expands the pricing editor to a `fixed inset-0` full-viewport overlay (in-app maximize via a root
className toggle, NOT native Fullscreen, NOT a Dialog/portal); the NO-REMOUNT rule (one JSX tree -> grid drafts / cursor /
lock / all state survive expand/collapse), each grid's `expanded` prop relaxing its `max-h` cap to `flex-1 min-h-0`, Esc-
to-exit via a `defaultPrevented`-guarded window listener (`shouldExitFullscreenOnEsc`, so a popover-Esc doesn't exit), the
toggle rendered outside the `!isGridOnly` gate (works on read-only sheets too); display-only (perf memo intact); vitest
241->245 (PricingGrid 109->113), tsc 3175 (0 new), 2026-06-24, see the full-screen paragraph above + plan §"Slice 4c
full-screen editor". Amount-column formula-status badge -- a leading amber
(pending) / green (covered) `ƒ` badge that IS the `AmountFormulaBuilder` trigger (status + action merged; far-right
preview line removed -- the layout/visibility render-bug fix) + a pending amber `<th>` tint + the shared
`priceability.isAmountColumnCovered` predicate (`areFormulasComplete` folds over it -> badge⇔gate by construction);
display-only (header outside the row memo); read-only branch preserved; vitest 235->241, tsc 3175 (0 new), 2026-06-21;
see the formula-status-badge paragraph above + plan §"Amount-column formula-status badge". MANDATORY amount-formula gate -- amount formulas required
before any rate is editable (REVERSES "formula optional"); `priceability.areFormulasComplete` (per-COVERAGE via `pickFormula`,
wildcard-default covers per-area cols) -> a per-sheet `formulasComplete` boolean ANDed into the grid rate gate OUTSIDE
`isRateEditableRow` (override CANNOT bypass) + added to `pricingRowPropsAreEqual` (memo-safe) + a "Declare amount formulas to
enable rate entry." banner; `onSaveFormula`/declaration stays live under the gate; vitest 226->235 (priceability 30->36,
PricingGrid 106->109), tsc 3175 (0 new), 2026-06-24, see the gate paragraph above + plan §"Mandatory amount-formula gate";
Editor perf fix -- `PricingGrid` row-level memoization
(extract the `<tr>` into a `React.memo`'d `PricingGridRow` + `groupDraftsByRow` per-row draft slices [the anti-defeat rule]
+ `useMemo`'d grid derivations; the `activeColIndex` cursor lever; fixes the arrow-key/click lag on big sheets; NO
behaviour change; PricingGrid.test 83->94, suite 203->214, see the memoization-contract paragraph above + plan §"Editor
perf fix", 2026-06-24); Slice 4b-ACKNOWLEDGE -- the per-entry "reviewed / looks OK"
review-strip DISMISS (pure `priceability.ts` filter helpers + `SheetPricingPage` active/show-all feed + "Show dismissed"
toggle + per-entry Looks-OK/Restore action wired to `save_cell_dismissal`; `ReviewEntry` UNCHANGED; server-side re-arm,
priceability 27->30, 2026-06-23); Slice 4b-A computed-flag layer -- the shared
`priceability.ts` spine + the flags (needs_rate / qty_anomaly / broken / not_yet, broken/not_yet GATED behind the
priceability spine + not_yet DE-DUPED per-area against needs_rate [cert fixes]; `wont_compute` removed before push) +
in-grid markers + unified review strip + N/M
priced-count & unpriced filter + the incomplete-subtotal signal as ONE quiet `SummaryPanel` message (the per-subtotal STRIP
entries removed as noise) + rollup alignment
(`priceability.ts`/`PricingGrid`/`SheetPricingPage`/`pricingRollup`/`SummaryPanel`,
2026-06-23); Prepopulated-rate fix -- formula reads committed rates by
non-zero value, not just the priced marker (`PricingGrid.lookupOperandValue`, 2026-06-23); Summary formula-fix --
formula-aware rollup + grand-total row + reconciliation guard (`pricingRollup`/`SummaryPanel`, 2026-06-23).

(Completed-arc changelog + the C-values OWED note collapsed -- the full per-slice as-built history lives in
`boq-upload-plan.md` under the dedicated `### Slice ...` / `### Module 3 Slice ...` detail sections.)

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

**Review screen (ReviewTree) conventions -- live component contract** (consolidated from Slices B1 / B1.1a / B1.1b-i/ii/iii / fix-B; full per-slice as-built detail in `boq-upload-plan.md` §"Slice B1...". The pricing editor's `PricingGrid` reuses these via the extracted `reviewRender.tsx` -- see Slice 2):

- **Review route:** `/upload-boq/hub/:boqId/review/:sheetName` -- lazy, exports `{ SheetReviewPage as Component }`; same `encodeURIComponent`/auto-decode convention as the config spoke. `onOpenReview?: (sheetName) => void` on SheetCard navigates to it (distinct from `onOpenSpoke`; SheetCard stays router-free). The "Review parsed sheets" hub section shows when `reviewableDrafts.length > 0`.
- **Depth + visibility (the tree walk, in `reviewRender.computeDepths` + ReviewTree `isVisible`):** depth is computed from the `effective_parent_index` chain (memoised, visited-set cycle guard -> cycle members depth 0). **NEVER use the stored `level` field for indentation** -- it is the parser's static value and diverges after `human_parent` edits. `isVisible(row)` walks the parent chain (60-hop cap) starting from `row.effective_parent_index` (the PARENT, not the row), breaking on `cur < 0` (-1 sentinel = root) and `cur === row.row_index` (self-cycle). Net: a collapsed row stays visible; only its descendants hide. Do NOT start the loop at `collapsed.has(row.row_index)` (reintroduces the "parent disappears" bug). `collapsed` is a `Set<number>` of `row_index`. `computeDepths` pre-runs over ALL (unfiltered) rows, so depth is independent of view filters.
- **ColumnDescriptor type (`boqTypes.ts`):** `{col, role, area: string|null, value_field, value_key: string|null, rate_subkey: string|null}` + `GetReviewRowsResponse.column_descriptors`. `resolveDescriptorValue(row, d)` (in `reviewRender.tsx`): dynamic access `(row as unknown as Record<string, unknown>)[d.value_field]` (the `as unknown` intermediate is required for TS2352), walking value_field -> value_key -> rate_subkey, `undefined` at any missing level. `renderDescriptorCell(val)`: null/undefined -> `""`, number -> `fmtNum(val)` incl. `0 -> "0"`. **Absent-vs-zero rule:** a missing key (blank) and a zero ("0") are visually distinct -- never collapse them.
- **ClassificationPill (`reviewRender.tsx` as of Slice 2):** left-bordered pill driven by the Tailwind-class map `CLS_PILL_CLASSES` + label map `CLS_LABELS` (both in `reviewRender.tsx`). The old hex `CLS_COLORS` map no longer exists (superseded by the B2b restyle).
- **Fixed anchor columns vs descriptor columns:** `FIXED_ROLE_DEDUPE = Set(["sl_no","description"])` excludes those roles from the descriptor-driven list; they render as fixed anchors. The fixed-anchor column order is **Excel Row / Sl.No / Parent / Classification / Description**; everything else is a descriptor column (`displayDescriptors`). The **Parent** anchor shows the parent row's `source_row_number` (Excel row number) via `effective_parent_index -> byIdx.get(pIdx)?.source_row_number`; root (null/negative) renders blank; NEVER show the internal `row_index`. The **Classification** anchor holds chevron + ClassificationPill; **Description** holds the text + the depth indent (`paddingLeft = depth * INDENT_PX`).
- **Column-subset selector + classification toggles:** `visibleCols: useState<Set<string>>` (lazy-init all descriptor cols; re-synced via `useEffect([displayDescriptors])`); both `<th>`/`<td>` for a descriptor gate on `visibleCols.has(d.col)`; fixed anchors are never in the selector. Three independent `useState(true)` toggles `showSpacers`/`showNotes`/`showSubtotals` drive `classificationVisible(row)`, composed with `isVisible` as TWO SEPARATE `return null` gates (keep the concerns separate). Children of a toggled-off annotation render at their ORIGINAL computed depth (do NOT re-parent/re-indent).
- **Area column tinting:** `AREA_COLORS` + `buildAreaColorMap` are re-implemented LOCALLY in ReviewTree (verbatim copy of SheetDataGrid's local constants -- do NOT export-refactor SheetDataGrid to share them). Applied to descriptor column HEADERS only.
- **Scroll-to-parent:** `rowRefs = useRef<Map<number, HTMLElement>>` keyed by `row_index` (`<tr>` ref callback set/delete). `revealAndScrollToRow(idx)` walks the ancestor chain, removes collapsed ancestors from `collapsed`, then after `setTimeout(50ms)` (lets React commit the expand) `.scrollIntoView({behavior:"smooth", block:"nearest"})` + sets a transient `highlightedIdx` (amber row tint, cleared after 1500ms).

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

**SheetConfigPanel conventions** (`src/pages/boq-wizard/SheetConfigPanel.tsx`; consolidated from Slices 3c / 3c-fix --
full per-slice as-built detail in `boq-upload-plan.md` §"Module 3 Slice 3c..."):

- **sheet_config read-modify-write (CRITICAL):** `set_sheet_config` is WHOLE-BLOB REPLACE. Any write must (1) parse the
  existing `draftConfig` blob, (2) update only the keys this component owns, (3) re-serialize the FULL merged object, (4)
  POST that. Never POST a partial blob -- it wipes `column_role_map` and any other keys later slices own. **No
  `data_start_row` key** exists in `SheetConfig` (it is a derived display label `header_row + header_row_count`) -- do not
  write it. `boqTypes.ts`: `sheet_config?: Record<string, unknown> | string | null` on `BoQSheetDraft` (Frappe returns it
  parsed; the string variant is a fallback `parseConfig()` handles).
- **Per-sheet confirm state is LOCAL** `useState<Set<string>>` (NOT the session-scoped Zustand `confirmedFields` from
  BoqMasterPanel); sparkle + `opacity-50` while `hasPrefill && !confirmed && hasValue`; `touch(key)` confirms. The panel
  is mounted `<SheetConfigPanel key={decodedSheetName} ...>` so it REMOUNTS fresh per sheet (resets all local state).
  Save is an explicit "Save config" button (single-flighted via `isSaving`, inline errors), then `onSaveSuccess ->
  mutate()`.
- **Select sparkle-clear (reusable):** use `onOpenChange` on `<Select>`, NEVER `onClick` on `<SelectTrigger>` (the latter
  does not fire reliably for Radix internals when re-selecting the active value).
- **Multi-value list entry (reusable):** a Single/Multi segmented toggle + stacked `Input` boxes, NOT chip/Enter-to-add;
  the active toggle button's `onClick` always calls `touch(key)` so re-clicking confirms the sparkle.
- **Grouped opacity (reusable):** apply `opacity-50` to ONE wrapper `<div>`, not per child input (avoids compounded
  opacity on nested nodes).

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

(The 3d-ii Section-3 seed-shape read-back bug-fix narrative relocated to `boq-upload-plan.md` §"Module 3 Slice 3d-ii --
read-back fix". The live rule it leaves behind -- the `column_role_map` seed loop handles BOTH the `{role,area}` object
shape and legacy role-only strings defensively -- is already stated in the 3d-i lifted-state conventions above.)

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

(The 3b-iii SheetDataGrid sticky-header + gridlines polish [feat 2ac4789a] is relocated to `boq-upload-plan.md` §"...Slice
3b-iii"; its sticky/z-index stack is superseded by the fuller version in the 3d-iii block above, and its
`decodeURIComponent` "decode fix" was itself superseded by Slice 3c [RR v6 auto-decodes -- `decodedSheetName = sheetName
?? ""`].)

**SheetSearchView conventions** (`src/pages/boq-wizard/SheetSearchView.tsx`; live component contract, post-v2 -- full per-slice as-built detail in `boq-upload-plan.md` §"Slice 1a" + the SheetSearchView-v2 changelog entry):

- **Role + props:** a self-contained "find the row in the source sheet" tool -- FINDS + SHOWS rows only (no select/save/reclassify). Props `{ boqName, sheetName (VERBATIM #152 -- never `.trim()`; trailing-space sheet names exist), initialCentreRow?, onCurrentHitChange?, onRowClick?, selectedRowNumber? }`. **Future "searchable sheet view" needs extend THIS component, not SheetDataGrid** (byte-for-byte untouched -- scroll/highlight need per-row DOM access it doesn't expose).
- **Self-contained data (two fetches it owns):** (1) rows via a SINGLE-PASS `get_sheet_preview_full` (`useFrappePostCall`, typed `{ message: SheetPreviewFullResponse }`) -- ONE call, no windowed loop (the v2 perf fix replacing the old 200-row windowed loop; `SheetPreviewFullResponse` is additive in boqTypes.ts, DISTINCT from the windowed `SheetPreviewResponse` SheetSpokePage still uses -- do NOT collapse the two); (2) role->letter map via `useFrappeGetDoc("BOQs", boqName) -> sheet_config.column_role_map` (local `parseColumnRoleMap` handles `{role,area}` + legacy string shapes).
- **Column-trim:** render ONLY `#` (Excel row_number) + Sl.No + Description + Unit + EVERY Qty column (per-area qty = one column each, headed letter + area). Rate/Amount hidden. **Degraded mode** (no column_role_map): all letters in Excel order, search disabled with an amber note.
- **Search + cycling hit-stepper:** case-insensitive substring over Description -> ordered `hits: number[]` of row_number; "N of M" counter, prev/next CYCLE; all hits yellow, current amber, transient flash; zero-match -> counter 0, toggles inert.
- **Scroll/center/highlight:** `rowRefs = useRef<Map<number, HTMLElement>>` keyed by row_number; on hit-change (+ `initialCentreRow` once) `scrollIntoView({block:"center"})`.
- **Column widths + click-to-select (v2):** `<Table className="table-fixed">`, Description `w-[360px]` / others `w-[120px]`, cells `whitespace-normal break-words`. Optional `onRowClick`/`selectedRowNumber` -> a row click + a persistent inset blue ring (`ring-2 ring-inset ring-blue-500`, a box-shadow that never collides with the yellow/amber hit-background tiers). The component ONLY emits the click + renders the tint -- it does not resolve/guard the pick.

**RestructureModal conventions** (`src/pages/boq-wizard/RestructureModal.tsx`; live component contract -- full per-slice as-built detail in `boq-upload-plan.md` §"Slice 1b-beta" + the restructure changelog entries):

- **Role + props:** the FRONTEND consumer of the `save_review_restructure` backend; the HEAVY (has-children) reclassify-and-place-children path. Props `{ open, onClose, boqName, sheetName (verbatim #152), row, newClassification, rows, onRestructured: (editedAt) => void }`. The response type is LOCAL to the modal/ReviewTree (boqTypes.ts not used; carries `row_moved?: boolean`).
- **Trigger chain (ReviewTree detail panel):** the Classification line's "Change" `DropdownMenu` offers the 4 ASSIGNABLE classes (`ASSIGNABLE_CLASSIFICATIONS` = line_item/preamble/note/spacer; subtotal_marker/header_repeat parser-only, NOT offered) -> `onPickClass(row, cls)` counts children: **childless -> a light `AlertDialog` confirm** (`child_moves:{}`; a plain Button NOT `AlertDialogAction` so it stays open + shows inline errors; its "This row's position" radios route the "Move under a new parent" choice ON-SELECT into the SAME `setRestructureModal` state -- the AlertDialog is too small to host the picker); **has children -> the staged modal**. The §9 #162 "Change parent" door also opens this modal directly via a no-op same-class reclassify.
- **The FIVE child-placement options (no silent default; radio, none pre-selected):** (1) move children up to this row's parent; (2) keep under this row (`child_moves:{}`, offered ONLY when the new class is parent-capable line_item/preamble); (3) all to ONE new parent (picker); (4) each child individually (per-child picker; a child may also go top-level -1); (5) all top-level. Save gating: 1/2/5 complete on select, 3 needs the parent picked, 4 needs EVERY child resolved.
- **Row-own-position control (with-children path):** a "This row's position" box -- "Keep current" (DEFAULT; omits `row_new_parent`) or "Move under a new parent" (`rowPosition`/`rowParentIdx` state; `-1` = top-level). A CHILDLESS row reaches the modal ONLY via the move route, so `rowPosition` lazy-inits to "move" + the children block + 5 options are hidden (`children.length === 0` gate; with-children UNCHANGED); a with-children row opens "keep".
- **Path A child_moves (FRONTEND computes the resolved map):** `buildChildMoves()` -> `{child_row_index: new_parent_index}` (`-1` = top-level); ONE `save_review_restructure(boq, sheet [VERBATIM], row_index, new_classification, child_moves, reason?, row_new_parent?)` call (`row_new_parent` added only on a resolved "move"; "keep" omits it). Success -> `onRestructured(edited_at)` -> the EXISTING `handleSaved` (setLastSavedAt + `mutate()`); a `frappe.throw` (e.g. batch cycle) surfaces inline + the modal STAYS OPEN. Do NOT fetch/patch the tree inside the modal.
- **Parent picker = the certified SheetSearchView (untouched):** consumed via `onCurrentHitChange`/`onRowClick` -> `currentHit`; `hitRowIndex = rows.find(source_row_number === hit.row_number)`; a header/banner/blank row resolves to none -> "Set as parent" DISABLED ("This row isn't a selectable parent"). Pick buttons render ABOVE the picker (v2's tall wrapping cells push them below the fold otherwise). `DialogContent` is `max-w-6xl`; long child-list texts wrap.
- **Dismiss + errors (reusable patterns):** `<DialogContent onInteractOutside={(e) => e.preventDefault()}>` makes an outside click inert while ESC/Cancel/Save/close-X still close (use `onInteractOutside`, NOT `onPointerDownOutside`, and do NOT route through `onOpenChange` -- it is shared by ESC). Apply to any wizard modal that must not dismiss-on-outside-click. All wizard catch blocks use `setX(getFrappeError(e) || "<static>")` (the house pattern -- the SDK's `.message` is a hardcoded generic; the real throw text rides `_server_messages`, decoded by `src/utils/frappeErrors.ts`; keep the `|| "<static>"` since the helper can return `""` for `_server_messages === "[]"`).

**Edit-history render conventions (ReviewTree detail panel; full detail relocated to `boq-upload-plan.md` §"Slice A2"):**
the "Edit history" block REUSES the SAME `byIdx` map the Parent column uses to render a `human_parent` entry's
internal-row_index `from`/`to` as `row {source_row_number}` (root for null/negative; raw `String(n)` defensive fallback)
-- never build a second map. A same-value `human_classification` entry (the §9 #162 no-op reclassify that rides with a
real `human_parent` move) is SUPPRESSED before the `.map` (type-guarded filter), not rendered blank. The stored
`edit_log` shape `{field, from, to, by, at, reason[, area][, rate_subkey]}` is unchanged.

**wizard_status literals + Finalized config-freeze conventions** (the rename migration history -- Reviewed->Config Done,
Parsed Check Done->Finalized -- is relocated to `boq-upload-plan.md` §"Slice A1"; the live rules below remain):

- **`wizard_status` is compared `===` against string LITERALS across backend AND frontend** (and is the `STATUS_PILL`
  lookup KEY in `SheetCard.tsx`). Any future status rename must hit EVERY `===` site or a branch silently breaks / the
  pill silently falls back to Pending. Verify with a zero-hit `grep` over the python package + `frontend/src`. **A naive
  quoted grep MISSES the doctype options token** (`\nReviewed`, no surrounding quotes) -- edit `boq_sheet_draft.json`
  options FIRST and read it back. The 9-value union: blank / Pending / Hidden / Config Done / Skip / General specs
  (derived, never stored) / Parse failed / Parsed / Finalized.
- **Finalized config-freeze = `_guard_sheet_not_finalized` (backend, all 5 config writers) + a `<fieldset disabled={isParsing
  || finalized}>` lock (frontend, `finalized = wizardStatus === "Finalized"`).** Reversibility = an "Un-mark and edit"
  TEAL ShieldCheck banner -> confirm `AlertDialog` -> the EXISTING `unmark_sheet_parsed_check_done` endpoint (function
  name unchanged) -> `onSaveSuccess()` re-fetch flips back to "Parsed" + unlocks the fieldset. The AlertDialog renders
  OUTSIDE the fieldset (portals to body). **Banner precedence: parsing amber beats finalized teal.** SheetCard's
  Finalized branch carries an "Edit config" -> `onOpenSpoke` button so the affordance is reachable.

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

**Review export conventions** (`exportReviewCsv.ts` + `exportReviewXlsx.ts` + `ExportWorkbookDialog.tsx`; consolidated from Slices D2 / D2b -- per-slice build history relocated to `boq-upload-plan.md` / git):

- **Wizard-local writers, NOT the shared util:** `src/pages/boq-wizard/exportReviewCsv.ts` (+ `exportReviewXlsx.ts`) -- the shared `src/utils/exportToCsv.ts` is deliberately NOT used/touched (TanStack-ColumnDef-coupled, wrong shape for the descriptor payload). Any future wizard export extends THESE writers. **Reuse the tree's helpers, never copy** (`resolveDescriptorValue`/`computeDepths`/`CLS_LABELS`/`FIXED_ROLE_DEDUPE` from `ReviewTree.tsx`, `ROLE_LABELS` from `boqTypes.ts`) so depth/value-resolution/labels/dedupe stay byte-identical to the rendered tree.
- **`buildReviewSheet` (in exportReviewCsv.ts) is the SHARED core (no csv/xlsx drift):** `{sheetName, rows, columnDescriptors} -> {headers, cells}` with **RAW TYPED cells** (numbers stay JS numbers, text string, empty null). The CSV writer maps cells -> `csvCell` (null->"", number->String); the xlsx writer feeds typed cells straight to exceljs (numbers land as real numbers). When extending the export, change `buildReviewSheet` -- never one writer alone. **Numbers RAW** (`String(val)`, NOT the display formatter -- thousands separators break Excel numeric parsing).
- **`append_notes_raw` is a `dict[str,str]`** keyed `column_headers.get(col_letter, col_letter)` (header text when mapped, else bare Excel letter; classifier.py:983); empty columns OMITTED; values are strings. The writer flattens to `"key: value"` joined `" | "` (flat, no JSON blobs per §8); defensively handles array/string/null.
- **CSV mechanics:** `Papa.unparse`; prepend a UTF-8 BOM so Excel renders rupee/unicode; filename a bare basename + `.csv` ONCE (the shared util's double-extension trap). Export is the sheet's DATA in row_index order, NOT the current view (filters/collapse/search ignored). The "Export CSV" button is NOT gated on status (a frozen/checked sheet is the prime export target).
- **XLSX dependency rule (reusable):** `exceljs` is **DYNAMICALLY imported** (`(await import("exceljs")).default`) so it stays in its OWN lazy chunk (~942 kB), absent from the hub/entry chunks. The npm `xlsx` (SheetJS) is FORBIDDEN (abandoned + 2 unpatched high-severity CVEs). **Install heavy deps IN-CONTAINER** (host installs corrupt the Linux-native node_modules). One worksheet per ticked sheet, header row bold, NO BOM (xlsx needs none). **Tab-name sanitize + dedupe (`sanitizeSheetTabName`/`dedupeTabName`) is TAB-TITLE ONLY** (#152): strip `: \ / ? * [ ]`, TRIM (Excel rejects the trailing-space corpus names as tab titles -- load-bearing), truncate to 31, " (2)"/" (3)" on collision; the Sheet Name COLUMN stays verbatim.
- **Hub vs card:** the global "Export reviewed" hub button -> `ExportWorkbookDialog` (ParseRunDialog pattern: pre-ticked Finalized sheets, sequential per-sheet `get_review_rows` fetch, abort-on-any-failure -> no partial file) -> ONE .xlsx; a per-card "Export CSV" -> the existing `buildAndDownloadReviewCsv` -> a single .csv. The hub owns all fetches; SheetCard stays fetch/router-free.

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

**ReviewTree detail-panel layout (the live design rule; full per-pass CSS detail relocated to `boq-upload-plan.md`):**
The inline detail panel (the `expandedDetailRow === row.row_index` block) is a NESTED BRAND-TINTED CARD, not a hovered
row: indigo body tint (`bg-indigo-50/40 dark:bg-indigo-950/20`) + a BRAND-RED left-accent stripe `border-l-4
border-l-primary` (the `--primary` rose/crimson token -- NOT `--destructive`, whose pure-red would collide with the
error/re-parse-warning red on this screen) + border/radius/shadow/inset padding. Do NOT revert to a `bg-muted/30` tint
(it equals the row-hover tint -> the panel blends in) and do NOT swap the stripe to `--destructive`. Classification/Parent
render as a VERTICAL stack (`grid-cols-1`, avoids off-screen horizontal scroll on wide sheets); the three edit blocks
(numeric / text / per-area) are INDEPENDENT responsive `grid-cols-1 sm:2 md:3 lg:4` grids and stay SEPARATE (each has its
own save path).

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
- **Loss Justification (high-loss items, PR + SB)**: a per-item reason required when **Loss % > 10%** (strict). Shared helper `src/utils/lossPercent.ts` (`computeLossPercent(savingLoss, benchmark)` + `isHighLoss` + `LOSS_THRESHOLD_PERCENT = 10`) is the SINGLE source of the rule — use it on every surface; never re-derive the threshold inline. **Capture (procurement enters + gate):** `VendorsSelectionSummary.tsx` (PR) + `Sent Back Requests/SBQuotesSelectionReview.tsx` (SB) — a "Reason (required)" textarea on each >10% item keyed by the `order_list` child-row `name`; Send-for-Approval disabled until all high-loss items are justified. PR sends `loss_justifications` in the `send_vendor_quotes` postcall; SB has no send endpoint so it persists the FULL `order_list` (justifications merged) via `updateDoc("Sent Back Category", ...)` — must send the whole child array (replace-all; omitting rows deletes them). **Approval (read-only display + backstop):** shared `ApproveVendorQuotes/components/VendorApprovalTable.tsx` shows Loss % in the Savings/Loss column + a light-red "Reason:" chip under the item name; both approve hooks (`useApproveRejectLogic.ts`, `useApproveSBSLogic.ts`) compute `lossPercent` with the **Target-prioritized** benchmark (NOT the `min(Target,L1)` used by the existing ₹ Savings/Loss column — see root CLAUDE.md GOTCHA 2) and block approval of a selected >10% item with no reason (Send Back is the escape hatch). `loss_justification` rides PR rows via `...prItem` spread but is mapped EXPLICITLY in the SB hook (it builds the display item field-by-field). Scope/rationale: `docs/adr/0002-loss-justification-scope.md`; terms: root `CONTEXT.md`.
- **Vendor Hold / Credit Management**: Vendors with exhausted credit are marked "On-Hold". **Asymmetric transitions**: On-Hold → Active is real-time (via `recalculate_vendor_credit()` on 9 events); Active → On-Hold is daily cron only (10 AM IST). Credit limit standardized at 50,000. **Admin-only** credit management (PMO removed). Blocks dispatch + payment operations on "PO Approved" POs only — dispatched+ POs get informational banner. Uses `useVendorHoldGuard` (single vendor) and `useVendorHoldVendors` (bulk lookup) hooks. Guard variable: `isVendorHoldBlocked = isVendorOnHold && po?.status === "PO Approved"`. See `.claude/context/domain/vendor-hold.md` for full docs.
- **`useFrappeGetDoc` swrKey gotcha**: Third arg is `swrKey`, NOT options. Use `id ? undefined : null` for conditional fetching — never `{ enabled: !!id }` which breaks SWR cache deduplication.
- **Internal Transfer Memos (ITM)**: Cost-neutral inter-project material transfer launched from the Inventory Item-Wise page. One target project per session → backend groups selections by `source_project` → N ITMs (one per unique source). Admin-only approval. Phase 1 = create + approval + pre-dispatch delete; Phase 2+ adds dispatch / DN polymorphism / Material Usage columns / real-time events. `estimated_rate` is a snapshot at create time (no retroactive revaluation). DO NOT modify the DN schema in Phase 1 — the `parent_doctype` / `parent_docname` polymorphism migration across ~51 consumer sites is a Phase 2 concern. See `.claude/context/domain/internal-transfer-memos.md` for the full reference.
- **Work-package read path (Slice 3f-readback):** Work-package assignments are grandchild rows (BoQ Sheet Draft.work_packages, child of a child of BOQs). Frappe get_doc / useFrappeGetDoc("BOQs") does NOT return grandchildren, so draft.work_packages is always empty on the client. Read assignments via the get_boq_work_packages endpoint instead; both hub and spoke consume it (SheetCard workHeaders prop; SheetConfigPanel workPackages: string[]).
- **`order` field name (Slice 3f-fix):** Never pass order_by on a Frappe field literally named `order` -- it is a PostgreSQL reserved keyword and Frappe's REST list layer does not quote it, producing a 500. Keep `order` in the fields list and sort client-side.
- **ITM DC & MIR**: ITMs in `Partially Delivered` or `Delivered` status can have Delivery Challans + Material Inspection Reports filed against them, parallel to the PO flow. The `PO Delivery Documents` doctype is polymorphic (`parent_doctype` Select + `parent_docname` Dynamic Link). Surfaces with PO/ITM toggle: hub `/prs&milestones/delivery-challans-and-mirs`, project `DC & MIR` tab (sub-tabs for DN > DC Report + DC + MIR), reports `DCs & MIRs` tab. ITM-only: `ITMAttachmentSection` on the ITM detail page. Hub toggle URL-persisted via `parent`; project sub-toggle via `dcmir_parent`; reports toggle via `dcmir_parent`. **PO-only by design** (do NOT mix in ITM rows): Material Usage tab, DN > DC PO report, Bulk Download wizard — all filter by `procurement_order ["is", "set"]`. Mobile cards: `ITMListCards.tsx` mirrors `POListCards.tsx`. Upload dialog `UploadDCMIRDialog` accepts optional `parentDoctype` prop ("Procurement Orders" default, "Internal Transfer Memo" for ITM). `ITMDNDCQuantityReport` is a parent-child grouped reconciliation report (mirrors `DNDCQuantityReport` exactly: parent ITM rows expand to item sub-rows, status rollup, sortable totals, source-project facet, status facet, search, CSV export, info banner, error state). Fetches ITM child items via `get_project_itms` (extended to include items array). PO/ITM toggle UI is a red-active segmented control (mirrors project tab styling). `ITMAttachmentSection` always renders the card when `canView`; only the upload buttons are gated by `canUpload` (status in delivered states) — historical DCs/MIRs never disappear if the ITM moves out of upload-eligible state.

# currentDate
Today's date is 2026-06-21.

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
