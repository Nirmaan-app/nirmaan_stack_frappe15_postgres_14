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

**Tables:** TanStack Table v8 wrappers in `src/components/data-table/`. Page configs in `config/*.config.ts` files.

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

**Special:** `Administrator` user (user_id) has hardcoded Admin access. PMO Executive mirrors Admin access. HR Executive has Admin Options sidebar access.

**Key files:** `src/hooks/useUserData.ts`, `src/utils/auth/ProtectedRoute.tsx`, `src/components/layout/NewSidebar.tsx`

**Common pattern:**
```typescript
["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role)
```

**Full documentation:** See `.claude/context/role-access.md`

---

## Coding Standards & React Patterns

**Date format:** All dates must use `dd-MMM-yyyy` (e.g., "15-Jan-2026"). Use `formatDate()` from `src/utils/FormatDate.ts`.

**React-Select:** Use `FuzzySearchSelect` for dropdowns with >50 options. Use `usePortal` prop inside Radix dialogs.

**React Effects:** Never use objects/arrays as useEffect deps. Never use TanStack `table` as dep. Put user-action side effects in handlers, not effects.

**Full reference:** See `.claude/context/coding-standards.md` and `.claude/context/react-patterns.md`

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

# currentDate
Today's date is 2026-02-25.

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
