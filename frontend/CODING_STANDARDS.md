# Frontend Coding Standards — Nirmaan Stack

How code in `frontend/` is written, for agents and humans. Each rule sits beside its reason. Jump to the
section for the task in hand:

- [Where code goes](#where-code-goes) — folders, shared components, the wizard layout
- [Adding a page or route](#adding-a-page-or-route) — routing, lazy routes, the app-shell error boundary
- [Fetching or mutating data](#fetching-or-mutating-data) — `frappe-react-sdk`, SWR keys, accessors, the write seam
- [Holding state](#holding-state) — Zustand, context, drafts
- [Building a form or a select](#building-a-form-or-a-select) — RHF + Zod, select components, the placeholder trap
- [Building a table](#building-a-table) — `useServerDataTable`, faceted filters, CSV export
- [React effects](#react-effects)
- [Displaying dates](#displaying-dates)
- [Writing TypeScript and styling](#writing-typescript-and-styling)
- [Realtime events](#realtime-events)
- [Role-based access](#role-based-access)
- [Module residence (F1–F5)](#module-residence-f1f5)
- [Writing a test](#writing-a-test) — vitest is node-only and a local gate; the no-DOM consequence
- [Building](#building)

Cross-stack rules bind the frontend too and live in root [`CODING_STANDARDS.md`](../CODING_STANDARDS.md): the
stack and the limit on new UI libraries (§ Stack), naming (§ Where code goes), the generated paths such as
`src/components/ui/` and `nirmaan_stack/public/` (§ Don't touch), and the residence check plus commit-message
format (§ Before committing). Reference material and worked examples stay in `.claude/context/`
(`data-tables.md`, `websocket.md`, `role-access.md`, `testing.md`); rules for one domain stay in that domain's
doc, indexed by `frontend/CLAUDE.md` § Domain docs.

---

## Where code goes

```
src/
├── pages/                        # route-level components, one folder per feature (ServiceRequests/, ProcurementOrders/)
├── components/
│   ├── common/                   # components shared across pages — check here before writing a new one
│   ├── ui/                       # shadcn/ui primitives (generated; update via the shadcn CLI)
│   ├── data-table/               # DataTable + filters (see Building a table)
│   └── helpers/routesConfig.tsx  # all route definitions
├── hooks/                        # app-wide hooks (useUserData, useServerDataTable)
├── zustand/                      # global stores
├── types/                        # shared TypeScript types
├── utils/<domain>/               # pure domain logic (F4)
└── constants/roles.ts            # shared role-profile lists
```

- `src/pages/Retired Components/` holds old implementations, kept for reference only; build new work elsewhere.
- Page table configs go in the page's `config/*.config.ts`.
- Vendor reads and writes go through `src/pages/vendors/data/` (`useVendorQueries.ts`, `useVendorMutations.ts`),
  which capture API errors to Sentry.

**A complex multi-step form** (like project creation) uses the step wizard layout, so each step stays at
~150–250 lines and the orchestrator alone owns form state, navigation and submission:

```
pages/[feature]/[form-name]/
├── index.tsx              # orchestrator (form state, navigation, submission)
├── schema.ts              # Zod schema, types, field mappings per step
├── constants.ts           # wizard config (steps, options)
├── hooks/use[Form]Data.ts # data fetching for dropdowns/lookups
└── steps/                 # index.ts barrel, Step1.tsx, Step2.tsx, ReviewStep.tsx
```

Its building blocks are in `src/components/ui/` (`wizard-steps.tsx`, `draft-indicator.tsx`,
`draft-resume-dialog.tsx`, `draft-cancel-dialog.tsx`); drafts persist as described under
[Holding state](#holding-state).

---

## Adding a page or route

- Routes live in `src/components/helpers/routesConfig.tsx`: React Router v6 nested routes under
  `<ProtectedRoute />` and `<MainLayout />`. Role guards (`AdminRoute`, `RoleRoute`, …) are in
  `src/utils/auth/ProtectedRoute.tsx`.
- **Wrap every `React.lazy()` route in `<Suspense fallback={null}>`**; an unwrapped one throws "component
  suspended while responding to synchronous input".
- **The app-shell error boundary resets through its `resetKey` prop, never a React `key`.**
  `components/common/ErrorBoundaryWrapper.tsx` wraps `<Outlet />` in `MainLayout`, and a changing `key` is an
  unmount instruction: keying it on the location rebuilds every routed page on every navigation and silently
  destroys page state on a same-route param change (the BoQ pricing editor's sheet-tab strip is exactly that
  shape). The boundary compares `resetKey={location.key}` instead. Nothing but this note and a comment in the
  file guards it, because the test runner has no DOM (see [Writing a test](#writing-a-test)).
- Gate an approve view against direct-URL access as well as hiding its tab: a bookmarked `?tab=` URL must
  redirect a role that cannot act (see [Role-based access](#role-based-access)).

---

## Fetching or mutating data

- **Read and write through `frappe-react-sdk`:** `useFrappeGetDocList`, `useFrappeGetDoc`,
  `useFrappePostCall`. Call a backend mutation as
  `useFrappePostCall('nirmaan_stack.api.<module>.<method>')`.
- **`useFrappeGetDoc`'s third argument is the SWR key, not options.** Fetch conditionally with
  `useFrappeGetDoc(doctype, id, id ? undefined : null)`; passing `{ enabled: !!id }` there becomes the cache
  key and breaks SWR deduplication. The same `swrKey` slot sits third on `useFrappeGetDocList`.
- **A page's custom hook owns its fetching and mutations;** the rule itself lives as a pure function in
  `utils/<domain>` (F4), so it is unit-testable without React.
- **Parse a backend shape at one typed accessor** (F2), like `useITM()`; an inline `JSON.parse` in a page is a
  counted violation.
- **Write shared documents through the write-safety seam** (F5): `useEditingLock`
  (`src/pages/ProcurementRequests/ApproveNewPR/hooks/useEditingLock.ts`) — Redis-backed, auto acquire/release,
  heartbeat, Socket.IO events, `sendBeacon` cleanup; disable locally with
  `localStorage.setItem('nirmaan-lock-disabled', 'true')`. Extend the seam rather than adding a raw
  `updateDoc`, which is a counted violation.
- **A dialog that mutates its own list holds the row's name, not the row object.** A dialog holding the object
  (`useState<CriticalPOTask>`) keeps rendering the snapshot taken when it opened after its own action calls
  `mutate()` (stale PO chips). Store the name (`editingTaskName` in `CriticalPOTasksList.tsx`) and derive the live
  row from the refetched list (`useMemo` over `tasks`). The same shape applies to any controlled row dialog whose
  actions refetch the parent list.
- **Assign users through User Permissions, not a document field:** hold the multi-select as `{label, value}[]`
  for react-select, then create `User Permission` docs after the document is created; access control reads those.
- Many operations are scoped to the selected project, held in `UserContext`.
- Requests carry the site in the `X-Frappe-Site-Name` header (Frappe multi-site; set by the dev proxy in
  `proxyOptions.ts`).

---

## Holding state

- **Global state:** Zustand stores in `src/zustand/`, one per domain (notifications, filters, dialogs, doc counts,
  drafts). A store used by one page only may sit beside it (`pages/ProcurementRequests/NewPR/store/`).
- **Local state:** `useState` / `useReducer`.
- **Context providers:** `UserProvider`, `FrappeProvider`, `ThemeProvider`, `SidebarProvider`.
- **Drafts** persist through a Zustand store with the `persist` middleware: `useProjectDraftStore`,
  `useApproveNewPRDraftStore`, `useTdsRequestDraftStore`.

---

## Building a form or a select

- **Forms:** React Hook Form + a Zod schema + shadcn/ui `Form` components.
- **Searchable selects with more than ~50 options, or searched with multi-word queries** (item names), use
  `FuzzySearchSelect` (`src/components/ui/fuzzy-search-select.tsx`). Plain react-select matches a substring of
  the label only; `FuzzySearchSelect` searches label and value, matches tokens and partial words ("act" finds
  "actuators") and ranks by field weight. Plain `ReactSelect` suits small sets (work packages, categories, makes).
  Examples: `ProjectSelect` (`components/custom-select/project-select.tsx`), `ItemSelectorControls`.

  ```tsx
  const searchConfig: TokenSearchConfig = {
      searchFields: ['label', 'value'], partialMatch: true, fieldWeights: { label: 2.0, value: 1.5 },
  };
  <FuzzySearchSelect allOptions={options} tokenSearchConfig={searchConfig} onChange={handleChange} />
  ```

- **A react-select inside a Radix `Dialog` / `AlertDialog` portals its menu with the shared theme.** A modal
  Radix dialog sets `pointer-events: none` on `<body>`, so a menu portalled to `document.body` inherits it and
  becomes unclickable and unscrollable. `getSelectStyles()` in `src/config/selectTheme.ts` restores
  `pointerEvents: 'auto'` on the menu, portal, list and options; `FuzzySearchSelect` applies it automatically, and
  `ProjectSelect` takes a `usePortal` prop. A new select inside a dialog uses
  `styles={getSelectStyles()} menuPortalTarget={document.body} menuPosition="fixed"`.
- **Keep a controlled `<select>`'s placeholder selectable (owner-locked).** A controlled select with no matching
  option does not go blank: React sets `option.selected = (option.value === props.value)` per option, so when
  nothing matches every option ends unselected and the browser shows the first *selectable* option. A
  `<option value="" disabled>` placeholder is therefore skipped and the field displays a real value the row never
  held, beside whatever names the true one. On an `allow_none` def it is worse: the fallback is the `"None"`
  sentinel, a positive decision the row never made. A selectable placeholder makes blank genuinely blank and lets
  the user clear any field by hand — the user is the ultimate authority over an attribute value. A blank value
  needs no special case: it matches the placeholder, so it already selects it. The data layer reports the correct
  value and option list while the rendered control shows something else, so only a live browser check sees it.

---

## Building a table

Reference for the hook config, export system, backend API and search strategies: `.claude/context/data-tables.md`.

- **List pages use TanStack Table v8 through `useServerDataTable`** (`src/hooks/useServerDataTable.ts`) and the
  `DataTable` component in `src/components/data-table/`, configured from the page's `config/*.config.ts`.
- **Faceted filters self-fetch** (the F2/F4 worked example). A column declares its facet in `meta.facet`
  (`{field, title, requirePendingItems?, decoupled?}` in `*.config.ts`); render-scope bits (`additionalFilters`,
  an `enabled` render-gate) go in the `facetOverrides` prop; the page passes `facetDoctype` to opt in.
  `<DataTable>` then renders a lazy `SelfFetchingFacetFilter`, which fetches on first popover-open, not on mount.
  `getColumnFacet` is the one typed reader. The older `useFacetValues` + `facetFilterOptions` memo path is still
  supported but scheduled for sunset (ADR-0010 "Second proof" + Migration & sunset), so a new page uses
  `meta.facet`.
- **CSV export is configured on the column's `meta`:** `meta.exportValue` (a `(row) => string` formatter),
  `meta.exportHeaderName` and `meta.excludeFromExport`, read by `src/utils/exportToCsv.ts`. Export follows the
  table's current sorting and column order. (No `exportMeta` object exists.)
- **A custom export handler sources its rows from `await exportAllRows()`**; `table.getRowModel().rows` holds the
  current page only.
- The TanStack `table` object is never an effect dependency — see [React effects](#react-effects).

---

## React effects

These rules prevent infinite re-render loops (background: the `vercel-react-best-practices` skill).

1. **Depend on primitives:** `[user.id]`, `[dateRange?.from?.getTime(), dateRange?.to?.getTime()]`,
   `[filteredRowCount]`. An object or array dependency changes identity every render.
2. **Leave the TanStack `table` out of dependency arrays;** `useReactTable()` returns a new reference every render.
   Derive a primitive outside the effect (`const filteredRowCount = table.getFilteredRowModel().rows.length`) and
   depend on that.
3. **Put a user action's side effect in its handler,** not in an effect watching a flag the handler set.
4. **Sync props into local state in the handler that opens the view** (`handleOpen` sets the local copy, then
   `setIsOpen(true)`), not in an effect on the prop.

Before writing an effect: if it calls `setState` on something in its own dependency list, it loops — redesign.

---

## Displaying dates

**Display every date as `dd-MMM-yyyy`** ("15-Jan-2026"): `formatDate()` from `src/utils/FormatDate.ts`, a
page-specific `formatDeadlineShort()` where one exists, or the date-fns pattern `dd-MMM-yyyy`. That one format
covers every user-facing date, including ones that might read naturally as `MM/dd/yyyy`, `yyyy-MM-dd` or "15th Jan".

---

## Writing TypeScript and styling

- Functional components with hooks; extract reusable logic into custom hooks.
- Define an interface for component props. Shared types go in `src/types/`, component-specific ones in the
  component's file.
- Type unknown data as `unknown`, then narrow it — `any` switches the checker off.
- Add JSDoc comments to exported functions and interfaces.
- Style with Tailwind utilities and the theme variables in `tailwind.config.js`.

---

## Realtime events

- **Name events `{doctype}:{action}`** (`po:new`, `pr:approved`); the backend publishes them after committing
  (root `CODING_STANDARDS.md` § Writing backend Python).
- Global listeners are registered in `src/services/socketListeners.ts`, started once by
  `src/config/SocketInitializer.tsx`, each wrapped in the safe handler and removed in the returned cleanup.
  Firebase push lives in `src/firebase/firebaseConfig.ts`. Walkthrough for adding an event, the proxy and
  debugging: `.claude/context/websocket.md`.

---

## Role-based access

Matrix of roles, sidebar entries, per-page actions and the PMO exceptions: `.claude/context/role-access.md`.

- **Read the role with `useUserData()`** (`src/hooks/useUserData.ts`, returning `role` and `user_id`) and compare
  Role Profile names: `["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile"].includes(role)`. The
  `Administrator` user (`user_id`) has hardcoded Admin access, so admin checks include
  `user_id === "Administrator"`.
- **Reuse the shared role lists** (`src/constants/roles.ts`, and per-feature lists such as `PR_ADMIN_ROLES` in
  `pages/ProcurementRequests/config/prTabs.constants.ts`) rather than retyping profile strings.
- **Gate a page's controls on role and document status only, never on which route opened it.** Every PO URL
  renders `PurchaseOrder.tsx` (the old `summaryPage` / `accountsPage` flags were removed); report and project
  tables link a PO through `OrderDetailLink` (`poRoute.orderDetailPath`), not a hardcoded `/project-payments/…`.
- **A read-only approval tab** stays visible to every role with sidebar access; a non-approver sees an info banner,
  no action buttons and no row navigation (TDS "Pending Approval", Payments "Approve Payments").

---

## Module residence (F1–F5)

ADR-0010 (Proposed) gives each concept **one owning module**, never scattered across components; the full set,
backend B1–B5 included, is in [ADR-0010](../docs/adr/0010-module-residence-rules.md).

- **F1** — a domain rule has one home, pinned to the backend's via a parity test (FE↔BE), like boq
  `reconcile.ts` / `priceability.ts`.
- **F2** — backend shapes are parsed at **one typed accessor** (like itm `useITM()`); grep for inline parses.
- **F3** — near-twin flows are **one parametric module**, not a copy (the PR/SB approval twin is the anti-pattern).
- **F4** — pages/hooks stay **thin over pure logic** in `utils/<domain>`; the pure rule is unit-testable without React.
- **F5** — writes go through **one safety seam** (`useEditingLock`, extend it); grep for raw `updateDoc`.

Worked example: faceted filters ([Building a table](#building-a-table)). Before adding a helper for an existing
domain concept, consult the domain doc's `## Residence — concept → owner` manifest (first one:
`../.claude/context/domain/procurement.md`). `scripts/residence_check.py` runs from the app root, not `frontend/`,
and ratchets the F2/F5 counts against `scripts/residence_baseline.json` (root `CODING_STANDARDS.md` § Before
committing).

---

## Writing a test

- **`yarn test` runs vitest with `environment: "node"`** over `src/**/*.test.{ts,tsx}` — unit tests only. CI
  (`.github/workflows/ci.yml`) runs the Python bench suite only, so vitest is a local gate: run it yourself.
- **There is no DOM test environment** — no jsdom, happy-dom or `@testing-library`, a deliberate choice recorded
  in `vitest.config.ts`. Anything whose correctness is a React semantic — a component mounting, unmounting, or
  preserving state across a render — is structurally untestable here; only pure in/out helpers can be covered,
  and a pure helper extracted from such a component passes happily while the component itself misbehaves. So
  keep rules in pure helpers (F4), and verify a change that turns on a React semantic with a live browser A/B —
  revert, reproduce, restore, re-verify.
- **Browser verification:** the Playwright walkthrough, test user and key routes are in
  `.claude/context/testing.md`.
- **Cypress** (`yarn test-local`, `cypress.config.ts`) is configured but largely unimplemented.

> **Deferred — owner reminder:** add a DOM environment so the error-boundary invariant
> ([Adding a page or route](#adding-a-page-or-route)) can be pinned by a test. Agreed scope: `jsdom` only (no
> `@testing-library`), a per-file `// @vitest-environment jsdom` docblock so the global `environment: "node"`
> and every existing suite stay untouched, and one test file whose primary case is *a same-route param change
> must not remount the child*. Pin `jsdom@^26` — jsdom 27+ requires Node >= 22 and the dev container runs
> Node 20. Install inside the container (host `node_modules` is linux-arm64). An interrupted `yarn add` prunes
> `node_modules` and breaks the runner — recover with `yarn install --frozen-lockfile`.

---

## Building

`yarn build` builds with base `/assets/nirmaan_stack/frontend/` into `../nirmaan_stack/public/frontend/`, then
copies `index.html` to `../nirmaan_stack/www/frontend.html` and `firebase-messaging-sw.js` to
`../nirmaan_stack/www/`. Both copies are generated output (root `CODING_STANDARDS.md` § Don't touch). The
Firebase messaging service worker must be served from the root URL path, which is why it is copied into `www/`.
