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

yarn test
# vitest, environment: "node" -- unit tests only. NOT run by CI (.github/workflows/ci.yml runs
# the Python bench suite only), so this is a LOCAL gate.
```

**There is NO DOM test environment** — no jsdom / happy-dom / `@testing-library`, a deliberate
choice recorded in `vitest.config.ts`. **Load-bearing consequence:** anything whose correctness is
a React *semantic* — a component mounting, unmounting, or preserving state across a render — is
STRUCTURALLY untestable here; only pure in/out helpers can be covered, and a pure helper extracted
from such a component passes happily while the component itself misbehaves. (Same trap the Pricing
Module records at PW-2b-i: the tests assert the emitted formula TEXT and cannot see that the engine
mis-reads it at runtime.) When a change turns on a React semantic, the honest verification is a
live browser A/B — revert, reproduce, restore, re-verify — not a unit test.

**App-shell invariant (guarded by nothing but this note + a comment in the file):** the navigation
reset in `components/common/ErrorBoundaryWrapper.tsx` MUST NOT be a React `key`. A changing `key`
is an unmount instruction, and that boundary wraps `<Outlet />` in `MainLayout` — keying it on the
location rebuilds EVERY routed page on EVERY navigation, and silently destroys page state on a
same-route param change (the BoQ pricing editor's sheet-tab strip is exactly that shape). Reset it
by comparing a `resetKey` prop instead.

> **DEFERRED — owner reminder:** add a DOM environment so the invariant above can be pinned by a
> test. Agreed scope: `jsdom` ONLY (no `@testing-library`), a per-file `// @vitest-environment
> jsdom` docblock so the global `environment: "node"` and every existing suite stay untouched, and
> one test file whose primary case is *a same-route param change must not remount the child*.
> ⚠️ Pin **`jsdom@^26`** — jsdom 27+ requires Node >= 22 and the dev container runs Node 20.
> ⚠️ Install INSIDE the container (host `node_modules` is linux-arm64). An interrupted `yarn add`
> PRUNES `node_modules` and breaks the runner — recover with `yarn install --frozen-lockfile`.

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

**Special:** `Administrator` user (user_id) has hardcoded Admin access. PMO Executive mirrors Admin access **except** TDS Approval (view-only, cannot approve/reject), Payment Approval (no Approve tab, no edit fulfilled), PR Approval (no "Approve PR" tab, blocked from the approve view even by direct URL — approvers are Admin + Project Lead, `PR_ADMIN_ROLES`), and PR-flow new-item creation (request-only like a Project Manager in `new_items="false"` categories — no category-restriction bypass). HR Executive has Admin Options sidebar access.

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

## Module Residence (ADR-0010 — Proposed)

A concept has **one owning module**, never scattered across components (full set incl. backend B1–B5 in [ADR-0010](../docs/adr/0010-module-residence-rules.md)):

- **F1** — a domain rule has one home, pinned to the backend's via a parity test (FE↔BE), like boq `reconcile.ts` / `priceability.ts`.
- **F2** — backend shapes are parsed at **one typed accessor** (like itm `useITM()`); grep for inline parses.
- **F3** — near-twin flows are **one parametric module**, not a copy (the PR/SB approval twin is the anti-pattern).
- **F4** — pages/hooks stay **thin over pure logic** in `utils/<domain>`; the pure rule is unit-testable without React.
- **F5** — writes go through **one safety seam** (`useEditingLock`, extend it); grep for raw `updateDoc`.

**Faceted filters self-fetch (F2/F4 worked example).** A DataTable column declares its facet in
`meta.facet` (`{field, title, requirePendingItems?, decoupled?}` in `*.config.ts`); render-scope
bits (`additionalFilters`, an `enabled` render-gate) go in the `facetOverrides` prop; the page
passes `facetDoctype` to opt in. `<DataTable>` then renders a lazy `SelfFetchingFacetFilter`
(fetches on first popover-open, not on mount). **Do NOT hand-roll `useFacetValues` + a
`facetFilterOptions` memo in new pages** — that legacy path is dual-supported but scheduled for
sunset (ADR-0010 "Second proof" + Migration & sunset). `getColumnFacet` is the one typed reader.

**Enforcement:** run `python3 scripts/residence_check.py` (from the app root, not `frontend/`)
before committing — F2/F5 violation counts are ratcheted against `scripts/residence_baseline.json`
(fail on increase). Before adding a helper for an existing domain concept, consult the domain
doc's **`## Residence — concept → owner`** manifest (see `.claude/context/domain/procurement.md`).

---

## BoQ Wizard & Pricing Editor -- Frontend Conventions

All BoQ wizard / pricing frontend code lives in `src/pages/boq-wizard/`. This section keeps ONLY the
**stable conventions + load-bearing / owner-locked invariants**. The FULL per-slice as-built detail
(component contracts, per-slice changelog, feat hashes) is in the `boq-frontend-*.md` surfaces under
`frontend/.claude/context/domain/` — load the right one first. Live status = `frontend/.claude/plans/boq/`.

**Docs discipline -- DOCS-UPDATE RULE:** full rule, and the `guard_claude_md.py` hook enforcing it, in root
`CLAUDE.md`. Per-slice / per-commit as-built detail goes to `frontend/.claude/plans/boq/` + the
`boq-frontend-*.md` surfaces + `boq-backend.md` ONLY — never into an always-loaded `CLAUDE.md`.
**Frontend conventions file: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**


## Where the surface detail lives

This file is a ROUTER. It carries invariants and guardrails only.
Per-surface conventions -- worked examples, per-file specifics, the
reasoning behind a rule -- live beside it and are read ON DEMAND.

| Read this | When |
|---|---|
| [`frontend-wizard.md`](.claude/context/conventions/frontend-wizard.md) | Touching the BoQ wizard hub, a spoke, or the review screen shell |
| [`frontend-pricing-editor.md`](.claude/context/conventions/frontend-pricing-editor.md) | Touching PricingGrid.tsx or SheetPricingPage.tsx -- the load-bearing invariants: keyboard nav, memoisation, rate-edit gating, verdict states, the formula engine, carry/copy-forward |
| [`frontend-review-invariants.md`](.claude/context/conventions/frontend-review-invariants.md) | Touching ReviewTree.tsx -- the review screen's load-bearing invariants |
| [`frontend-pricing-module.md`](.claude/context/conventions/frontend-pricing-module.md) | Working on the HVAC / Electrical / ELV pricing module -- workbooks, rate resolution, checkout, baselines |
| [`frontend-rate-master.md`](.claude/context/conventions/frontend-rate-master.md) | Touching the Rate Master frontend (RM-2) -- pipelines, structure editing, registry |
| [`frontend-gotchas.md`](.claude/context/conventions/frontend-gotchas.md) | Before any non-trivial frontend change -- environment, build output, multi-tenancy, role gating, hold statuses, project scoping |

Nothing else was removed from this file. If a rule is not here, it is in one of the files above.
### BoQ Pricing Editor -- Frontend Conventions

The FULL per-slice component contracts (keyboard-nav matrix, the row-memo anti-defeat rule, the formula engine F1–F4, reconciliation, collapse/expand, lock/unlock, the two-ribbon toolbar, search/column-hide, export/download, review-screen render contracts, etc.) live in the **`boq-frontend-pricing-*.md`** and **`boq-frontend-review-screen.md`** surfaces under `frontend/.claude/context/domain/`. Load the relevant one before pricing-editor / review-screen frontend work. The STABLE conventions + LOAD-BEARING invariants are summarized above (§ "Pricing editor … LOAD-BEARING invariants" and § "Review screen … load-bearing invariants").

