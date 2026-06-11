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

**Status (2026-06-11 -- Slice D1 "Parsed Check Done" marking + read-only FREEZE + Un-mark COMPLETE -- BACKEND + FRONTEND):**
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
