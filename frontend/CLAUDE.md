# CLAUDE.md

This file holds what every frontend task needs. Rules that belong to one domain (the BoQ wizard and
pricing editor, procurement, invoices, holds) live in that domain's doc: before changing code in a domain,
read the doc that **Domain docs** (at the end) names for it.

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
from such a component passes happily while the component itself misbehaves. When a change turns on a
React semantic, the honest verification is a live browser A/B — revert, reproduce, restore,
re-verify — not a unit test.

**A controlled `<select>` with no matching option does not go blank — it falls back to the first
*selectable* option, so a disabled placeholder silently displays a wrong value (owner-locked).**
React does not assign `.value` on a controlled select; it sets
`option.selected = (option.value === props.value)` per option. When nothing matches, every option
ends unselected, and a single-select must still show something — so the browser picks the first
option the user could have picked. **A `<option value="" disabled>` placeholder is therefore
skipped, and the field displays a real value the row never held**, beside whatever names the true
one. On an `allow_none` def it is worse: the fallback is the `"None"` SENTINEL, a positive decision
the row never made. **Keep every such placeholder SELECTABLE** — blank is then genuinely blank, and
the user can clear any field by hand, which is the standing rule that the user is the ultimate
authority over an attribute value. A blank value needs no special case: it MATCHES the placeholder,
so it already selects it. The DOM note above applies: the data layer reports the correct value and
option list while the rendered control shows something else, so only a live browser check sees it.

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

## Architecture

Beyond the stack in root `CLAUDE.md`: Ant Design (selective, beside shadcn/ui), Socket.IO, Firebase
Cloud Messaging, Sentry, and `vite-plugin-pwa`. `pages/remaining-items/` is the inventory-update page.

### Key Architecture Patterns

**Routing:** `src/components/helpers/routesConfig.tsx` — React Router v6 nested routes with `<ProtectedRoute />` and `<MainLayout />`

**State:** Zustand stores in `src/zustand/` (notifications, filters, dialogs, doc counts, drafts). Context providers: `UserProvider`, `FrappeProvider`, `ThemeProvider`, `SidebarProvider`

**Data Fetching:** frappe-react-sdk hooks (`useFrappeGetDocList`, `useFrappeGetDoc`, `useFrappePostCall`, etc.). Custom hooks per page encapsulate fetching + mutations + business logic.

**Forms:** React Hook Form + Zod schema + shadcn/ui Form components

**Tables:** TanStack Table v8 via `useServerDataTable` hook + `DataTable` component in `src/components/data-table/`. See `.claude/context/data-tables.md` for full reference (hook config, export system, backend API, search strategies). Page configs in `config/*.config.ts` files.

**Real-time:** Socket.IO via `src/config/SocketInitializer.tsx` + `src/services/socketListeners.ts`. Firebase push via `src/firebase/firebaseConfig.ts`.

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

Role checks use the `useUserData()` hook.

**Roles:** Admin, PMO Executive, Project Lead, Project Manager, Procurement Executive, Accountant, Estimates Executive, Design Lead, Design Executive, HR Executive

**Special:** `Administrator` user (user_id) has hardcoded Admin access. PMO Executive mirrors Admin access **except** TDS Approval (view-only, cannot approve/reject), Payment Approval (no Approve tab), PR Approval (no "Approve PR" tab, blocked from the approve view even by direct URL — approvers are Admin + Project Lead, `PR_ADMIN_ROLES`), PO / Sent Back PO / PO Revision / WO / Amended WO approval (no Approve tabs, approve views guarded by direct URL too — `PO_ADMIN_ROLES`, `SR_ADMIN_ROLES`), payment settling (no "Payment need to paid" / "Reconciliation Pending" tabs, no Record Paid Entry; PMO CAN Request Payment and edit a PO's payment terms), vendor invoice approval (no Pending Invoice Approvals tab — `INVOICE_APPROVAL_PROFILES`, both sides), and PR-flow new-item creation (request-only like a Project Manager in `new_items="false"` categories — no category-restriction bypass). HR Executive has Admin Options sidebar access.

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

**React-Select vs FuzzySearchSelect:** Use `FuzzySearchSelect` (`src/components/ui/fuzzy-search-select.tsx`) for dropdowns with >50 options or where users search with multi-word queries (e.g., item names). Plain `ReactSelect` is fine for small option sets (<50) like work packages, categories, or makes. Use `usePortal` prop inside Radix dialogs.

**React Effects:** Never use objects/arrays as useEffect deps. Never use TanStack `table` as dep. Put user-action side effects in handlers, not effects.

**`React.lazy()` routes:** wrap each one in `<Suspense fallback={null}>`, or it throws "component suspended while responding to synchronous input".

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

**Enforcement:** `scripts/residence_check.py` runs from the app root, not `frontend/`; it ratchets the
F2/F5 violation counts against `scripts/residence_baseline.json`. Before adding a helper for an existing
domain concept, consult the domain doc's **`## Residence — concept → owner`** manifest (see
`.claude/context/domain/procurement.md`).

---

## Important Notes

- **Multi-tenancy**: Supports Frappe's multi-site architecture via X-Frappe-Site-Name header
- **Service Worker**: Firebase messaging service worker must be at root URL path
- **Deprecated Components**: `src/pages/Retired Components/` contains old implementations for reference
- **Project Context**: Many operations are scoped to a selected project (stored in UserContext)
- **Customer Required for Financials**: Projects without a customer cannot have invoices or inflow payments created - UI shows validation warnings and disables forms
- **Bulk Download Wizard**: `src/pages/BulkDownload/` provides a multi-step wizard for downloading POs, WOs, Invoices, DCs, MIRs, DNs and Client Invoices in bulk as merged PDFs. Uses `useBulkDownloadWizard.ts` hook, which hands each step its full eligible list; every step selects through ONE client-side table, `steps/BulkSelectTable.tsx` (the app's in-header facet + date filters; per-type columns in `steps/bulkTableColumns.tsx`). Changing any filter CLEARS the selection, so a download never carries a row the filters hide. PO rate visibility restricted for Project Managers.
- **Reusable Common Components**: `src/components/common/` holds components shared across pages; check it before writing a new one.
- **Centralized Vendor Hooks**: `src/pages/vendors/data/` contains `useVendorQueries.ts` and `useVendorMutations.ts` for centralized vendor data operations with Sentry API error capturing.
- **Design Tracker Phases**: Design tracker supports Onboarding and Handover phases. Phase filtering available in task-wise and team-summary views. Approval proof (file attachment) required before task status can be set to Approved.
- **CSV Export Pattern**: DataTable columns configure export through the column's **`meta`** object — **`meta.exportValue`** (a `(row) => string` formatter), **`meta.exportHeaderName`** (custom column name) and **`meta.excludeFromExport`**, read by `src/utils/exportToCsv.ts`. Export respects current table sorting and column order. There is **no `exportMeta`** object (`header` / `value` / `exportFileName`); an older version of this note named one, and it never existed.
- **Inventory Item-Wise Page**: `src/pages/inventory/InventoryItemWisePage.tsx` — cross-project aggregation of latest submitted Remaining Items Reports with max PO quote rates for estimated cost. Virtualized expandable table with category/unit facet filters and CSV export. Sidebar access: Admin, PMO, PL, PM, Procurement.
- **Vendor Financial Dialogs**: Vendor WO/Material Orders tables show Amount Due column with clickable Total Invoiced and Amount Paid cells that open InvoiceDataDialog/PaymentsDataDialog respectively.
- **One PO detail page, gated by role + status only**: every PO URL renders `PurchaseOrder.tsx`; never gate a button on which route opened it (the `summaryPage` / `accountsPage` flags were removed). Report / project tables link to a PO through `OrderDetailLink` (`poRoute.orderDetailPath`), never a hardcoded `/project-payments/…`. Matrix: `.claude/context/role-access.md` § Purchase Orders.
- **Dialogs that mutate their own list must hold the row's NAME, not the row object**: a dialog holding the row object (`useState<CriticalPOTask>`) keeps rendering the snapshot taken when it opened after its own action calls `mutate()` (stale PO chips). Store the name (`editingTaskName` in `CriticalPOTasksList.tsx`) and derive the live row from the refetched list (`useMemo` over `tasks`). Same shape applies to any controlled row dialog whose actions refetch the parent list.
- **`useFrappeGetDoc` swrKey gotcha**: Third arg is `swrKey`, NOT options. Use `id ? undefined : null` for conditional fetching — never `{ enabled: !!id }` which breaks SWR cache deduplication.

## Domain docs

Before changing code in one of these areas, read its doc; where it has a Load-bearing invariants section,
read that first. Paths are under `.claude/context/domain/` unless given in full.

`boq-frontend.md` (~330 KB) and `.claude/plans/boq-upload-plan.md` (~3 MB) are too large to read whole:
list the headings with `grep -n '^## ' <file>`, then read only that range.

| Touching… | Read |
|---|---|
| **BoQ pricing editor**: `PricingGrid.tsx`, `SheetPricingPage.tsx`, the BCS cost block, the Category column, the rate-helper chassis, view filters | `boq-pricing-editor-frontend.md` |
| **BoQ wizard**: upload, hub, spoke, the review screen (`ReviewTree.tsx`); all of it lives in `src/pages/boq-wizard/` | `boq-frontend.md` § Load-bearing invariants |
| **BoQ status**: the active slice, the design spec, as-built records | `.claude/plans/boq-upload-plan.md` |
| **Rate-helper panel** attribute semantics, the Pricing Module workbook pages, the Rate Master screens | `pricing-rate-master-frontend.md` |
| **Procurement**: Loss Justification (PR/SB), Critical PO Task packages and links | `../.claude/context/domain/procurement.md` § Load-bearing invariants |
| **CEO Hold**, including the Delivery Note exemption | `ceo-hold.md` |
| **Vendor Hold** | `vendor-hold.md` |
| **Invoices**: Add Invoice / Add Credit, invoice-qty surfaces, Resolve Invoices, `LineItemMappingReview` | `invoices.md` § Load-bearing invariants |
| **Delivery Notes**, Return Notes | `delivery-notes.md` |
| **PO Adjustments** | `po-adjustments.md` |
| **PO Revisions** | `po-revisions.md` |
| **Internal Transfer Memos**, ITM DC & MIR | `../.claude/context/domain/internal-transfer-memos.md` |
| Anything else (projects, customers, milestones, PO status, DataTables, sockets) | `.claude/context/_index.md` |
