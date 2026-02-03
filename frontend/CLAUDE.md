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

### Frappe Framework Integration

This frontend is tightly integrated with Frappe ERPNext backend:

1. **Development Mode**: Fetches boot context from `http://localhost:8000/api/method/nirmaan_stack.www.nirmaan_stack.get_context_for_dev`
2. **Production Mode**: Uses `window.frappe.boot` injected by Frappe
3. **Site Name**: Dynamically determined from `window.frappe.boot.sitename` or hostname
4. **Proxy Configuration**: `proxyOptions.ts` handles routing to Frappe backend and Socket.IO server

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

### Routing Architecture

Routes are defined in `src/components/helpers/routesConfig.tsx` using React Router v6's nested route structure:

- **Public routes**: `/login`, `/forgot-password`
- **Protected routes**: All other routes wrapped with `<ProtectedRoute />`
- **Main layout**: Most routes use `<MainLayout />` which includes sidebar, navbar, and notifications
- **Lazy loading**: Heavy pages use React.lazy() for code splitting (imported via `lazy()` in routes)

Key route patterns:
- PRs: `/prs&milestones/procurement-requests/:projectId/new-pr`
- PR Summary: `/prs&milestones/procurement-requests/:prId`
- PO Summary: `/:prId/:poId` (nested under various parent routes)
- Service Requests: `/service-requests/:srId`
- Projects: `/projects/:projectId`

### State Management Strategy

**Zustand Stores** (`src/zustand/`):
- `useNotificationStore` - Real-time notifications from Socket.IO
- `useDataRefetchStore` - Trigger data refetches across components
- `useFilterStore` - Table filter persistence
- `useDialogStore` - Modal/dialog state management
- `useFrappeDataStore` - Cached Frappe document data
- `useDocCountStore` - Document count badges for sidebar
- `useProjectDraftStore` - Draft persistence for project creation wizard
- `useApproveNewPRDraftStore` - Draft persistence for PR approval edits
- `useServiceRequestDraftStore` - Draft persistence for SR/WO creation

**Context Providers**:
- `UserProvider` (`src/utils/auth/UserProvider.tsx`) - Current user, auth state, selected project
- `FrappeProvider` (from frappe-react-sdk) - Frappe connection, db methods, socket
- `ThemeProvider` - Light/dark theme toggle
- `SidebarProvider` - Sidebar collapse state

### Real-time Updates

**Socket.IO Integration** (`src/config/SocketInitializer.tsx`):
- Initializes Socket.IO listeners on app mount
- Listens for Frappe doctype events (create, update, delete)
- Updates Zustand stores when documents change
- Service: `src/services/socketListeners.ts` handles event routing

**Firebase Cloud Messaging**:
- Push notifications configured in `src/firebase/firebaseConfig.ts`
- Service worker: `firebase-messaging-sw.js` handles background notifications
- Foreground notifications handled in `App.tsx` via `onMessage()`

### Data Fetching Patterns

**frappe-react-sdk hooks**:
- `useFrappeGetDocList()` - Fetch document lists with filters
- `useFrappeGetDoc()` - Fetch single document
- `useFrappeCreateDoc()` - Create new document
- `useFrappeUpdateDoc()` - Update existing document
- `useFrappeDeleteDoc()` - Delete document
- `useFrappeGetCall()` - Call whitelisted Frappe methods
- `useFrappePostCall()` - POST to Frappe methods

**Custom hooks** pattern:
- Most pages have dedicated hooks in their subdirectories (e.g., `pages/ProcurementRequests/ApproveNewPR/hooks/`)
- Hooks encapsulate data fetching, mutations, and business logic
- Return loading states, data, error states, and mutation functions

### Form Handling

Standard pattern using React Hook Form + Zod:
```tsx
const formSchema = z.object({...})
const form = useForm<z.infer<typeof formSchema>>({
  resolver: zodResolver(formSchema),
  defaultValues: {...}
})
const onSubmit = (data) => { /* create/update document */ }
```

Forms use shadcn/ui Form components with controlled inputs.

### Table Components

Data tables use TanStack Table v8 with custom wrappers in `src/components/data-table/`:
- Pagination, sorting, filtering built-in
- Column visibility toggle
- Faceted filters for enums/categories
- Date range filters
- Search/debounced input
- CSV export utilities

Many pages define table configs in `config/*.config.ts` files (e.g., `pages/ProcurementRequests/config/prTable.config.ts`).

### Component Libraries

**shadcn/ui components** (`src/components/ui/`):
- Based on Radix UI primitives
- Customized with Tailwind classes
- Main components: Button, Dialog, Sheet, Card, Form, Select, Popover, etc.

**Ant Design components** (direct imports):
- Used for specific complex components like DatePicker, Steps, Progress
- Import from `antd` package

### Error Handling

**Sentry Integration** (`src/instrument.ts`):
- Initialized before React app
- Tracks errors, performance, and console logs
- DSN configured for production monitoring

**Error Boundaries**:
- `ErrorBoundaryWrapper` component for graceful error handling
- Used to wrap pages/sections that may fail

### Environment Variables

Required in `.env`:
- `VITE_BASE_NAME` - Base path for router (empty for root)
- `VITE_FRAPPE_PATH` - Frappe backend URL (auto-proxied in dev)
- `VITE_SITE_NAME` - Frappe site name (fallback to hostname)

### Path Aliases

TypeScript path alias `@/*` maps to `src/*`:
```ts
import { Button } from "@/components/ui/button"
import { useUserData } from "@/hooks/useUserData"
```

## Common Development Tasks

### Adding a New Page

1. Create page component in `src/pages/[feature]/`
2. Add route to `src/components/helpers/routesConfig.tsx`
3. If protected, ensure it's nested under `<ProtectedRoute />`
4. Use `<MainLayout />` parent for standard layout with sidebar/nav

### Creating a New Frappe Doctype CRUD Page

1. Create page with data table using TanStack Table
2. Use `useFrappeGetDocList()` to fetch documents
3. Create table config in `config/[doctype]Table.config.ts`
4. Add create/edit dialogs using React Hook Form
5. Use `useFrappeCreateDoc()` / `useFrappeUpdateDoc()` for mutations
6. Add real-time listener in `src/services/socketListeners.ts` if needed

### Adding New Zustand Store

1. Create store in `src/zustand/use[Name]Store.ts`
2. Define state and actions following existing patterns
3. Use `create()` from zustand
4. Import and use with `useStore()` hook in components

### Updating UI Components

- For shadcn/ui: Edit files in `src/components/ui/`
- For custom components: Follow existing patterns with TypeScript props interfaces
- Use Tailwind utility classes for styling
- Use CVA (class-variance-authority) for variant-based component APIs

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

**Key components** (in `src/components/ui/`):
- `wizard-steps.tsx` - Visual step progress indicator
- `draft-indicator.tsx` - Auto-save status display
- `draft-resume-dialog.tsx` / `draft-cancel-dialog.tsx` - Draft management dialogs

**Draft persistence** (optional):
- Use Zustand store with `persist` middleware for localStorage
- `useProjectDraftManager` hook pattern for auto-save with debounce
- See also: `useApproveNewPRDraftStore` for PR approval drafts, `useServiceRequestDraftStore` for SR drafts

**Editing Lock Pattern** (for concurrent edit prevention):
For pages where only one user should edit at a time, use the Redis-based locking pattern:
```typescript
// Hook: src/pages/ProcurementRequests/ApproveNewPR/hooks/useEditingLock.ts
const { lockInfo, isMyLock, canEdit, acquireLock, releaseLock } = useEditingLock({ prName, enabled: true });

// Key features:
// - Auto-acquire on mount, auto-release on unmount
// - Heartbeat every 5 min to extend 15-min lock expiry
// - Socket.IO events for real-time lock status (pr:editing:started, pr:editing:stopped)
// - navigator.sendBeacon() for reliable release on page unload
// - Graceful degradation: editing allowed if API fails
// - Feature flag: localStorage.setItem('nirmaan-lock-disabled', 'true')
```

**Multi-select user assignment pattern:**
When assigning multiple users to roles (e.g., project leads, managers):
```typescript
// Schema: Store as array of {label, value} for react-select compatibility
assignees: z.object({
  project_leads: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  // ...
}).optional()

// Submission: Create User Permissions after document creation
const uniqueUsers = new Set<string>();
assignees?.project_leads?.forEach(u => uniqueUsers.add(u.value));
for (const userId of uniqueUsers) {
  await createDoc("User Permission", { user: userId, allow: "Projects", for_value: projectName });
}
```
- Don't store assignees in the document itself - use User Permissions for access control
- Use `ProjectCreationDialog` pattern for multi-stage progress (creating → assigning)

### Working with Procurement Flow

The procurement flow is the core workflow:

1. **New PR** (Procurement Request): Created by project managers, specifies items needed
2. **Approve PR**: Reviewed by procurement team
3. **Select Vendors**: Procurement team selects vendors and requests quotes
4. **Vendor Quotes**: Vendors submit quotes (can be edited by procurement if delayed)
5. **Approve Quotes**: Compare quotes and select winning vendor(s)
6. **Release PO** (Purchase Order): Generate and send PO to vendor
7. **Delivery Notes**: Track deliveries against POs
8. **Invoices**: Record vendor invoices
9. **Payments**: Process payments against invoices

Related routes and components are organized under `pages/ProcurementRequests/`, `pages/ProcurementOrders/`, etc.

## Role-Based Access Control

The system uses 10 role profiles for access control. Role checks use `useUserData()` hook.

**Roles:** Admin, PMO Executive, Project Lead, Project Manager, Procurement Executive, Accountant, Estimates Executive, Design Lead, Design Executive, HR Executive

**Special:** `Administrator` user (user_id) has hardcoded Admin access. PMO Executive mirrors Admin access. HR Executive has Admin Options sidebar access.

**Key files:**
- `src/hooks/useUserData.ts` - Role fetching
- `src/utils/auth/ProtectedRoute.tsx` - Route guards
- `src/components/layout/NewSidebar.tsx` - Menu visibility

**Common pattern:**
```typescript
["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role)
```

**Full documentation:** See `.claude/context/role-access.md` for:
- Complete sidebar menu access matrix
- Page-level access control with file:line references
- Action capabilities by role
- Dashboard routing

---

## Coding Standards

### Date Format
**All dates displayed to users must use `dd-MMM-yyyy` format** (e.g., "15-Jan-2026").

- Use `formatDate()` from `src/utils/FormatDate.ts` for standard date formatting
- Use `formatDeadlineShort()` from page-specific utils if available
- For date-fns operations, use format pattern `dd-MMM-yyyy`
- Never use formats like `MM/dd/yyyy`, `yyyy-MM-dd`, or ordinal formats ("15th Jan") for display

```typescript
// Correct - dd-MMM-yyyy format
import { formatDate } from "@/utils/FormatDate";
formatDate(dateString); // Returns "15-Jan-2026"

// For manual formatting
const day = date.toLocaleString('default', { day: '2-digit' });
const month = date.toLocaleString('default', { month: 'short' });
const year = date.toLocaleString('default', { year: 'numeric' });
return `${day}-${month}-${year}`; // "15-Jan-2026"
```

### React-Select Search Pattern

When using react-select for searchable dropdowns with >50 options, use `FuzzySearchSelect` from `@/components/ui/fuzzy-search-select.tsx` instead of plain ReactSelect.

**Why:** Default react-select uses simple substring matching on label only. FuzzySearchSelect provides:
- Multi-field search (label + value/ID)
- Token-based matching ("proj 2024" finds items matching both tokens)
- Partial word matching ("act" finds "actuators")
- Relevance scoring and ranking
- Field weighting (label > value)

**Pattern:**
```tsx
import { FuzzySearchSelect, TokenSearchConfig } from "@/components/ui/fuzzy-search-select";

const searchConfig: TokenSearchConfig = {
    searchFields: ['label', 'value'],
    partialMatch: true,
    fieldWeights: { label: 2.0, value: 1.5 }
};

<FuzzySearchSelect
    allOptions={options}
    tokenSearchConfig={searchConfig}
    onChange={handleChange}
    // ...other react-select props
/>
```

**Components using this pattern:**
- `ProjectSelect` (`components/custom-select/project-select.tsx`) - Project selection dropdowns
- `ItemSelectorControls` - Item selection in PR creation

When reviewing or creating react-select components, check if FuzzySearchSelect would improve the UX.

### React-Select in Radix UI Dialogs (AlertDialog/Dialog)

**Problem:** When using react-select inside Radix UI AlertDialog or Dialog, the dropdown menu becomes unclickable and unscrollable. Users can type and use keyboard navigation, but mouse interaction is blocked.

**Root Cause:** Radix UI dialogs set `pointer-events: none` on the `<body>` when modal to implement focus trapping. When react-select portals its menu to `document.body` via `menuPortalTarget`, those elements inherit `pointer-events: none` and become uninteractable.

**Solution:** The centralized theme in `src/config/selectTheme.ts` includes `pointerEvents: 'auto'` on menu, menuPortal, menuList, and option styles to override this behavior.

**Usage with ProjectSelect:**
```tsx
// Inside a dialog, use the usePortal prop
<ProjectSelect
    onChange={handleChange}
    universal={false}
    usePortal  // Enables menuPortalTarget={document.body} with proper pointer-events
/>
```

**If creating a new select component:**
```tsx
import { getSelectStyles } from "@/config/selectTheme";

// The default styles already include the pointer-events fix
<ReactSelect
    styles={getSelectStyles()}
    menuPortalTarget={document.body}
    menuPosition="fixed"
    // ...other props
/>
```

**Key files:**
- `src/config/selectTheme.ts` - Centralized theme with pointer-events fix
- `src/components/ui/fuzzy-search-select.tsx` - Applies theme automatically
- `src/components/custom-select/project-select.tsx` - Has `usePortal` prop

**References:**
- [Radix UI Issue #2122](https://github.com/radix-ui/primitives/issues/2122) - DialogContent disables pointer events
- [Radix UI Issue #3141](https://github.com/radix-ui/primitives/issues/3141) - Dialog and Dropdown Menu conflict

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
