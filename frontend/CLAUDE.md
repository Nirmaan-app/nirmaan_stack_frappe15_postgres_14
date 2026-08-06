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
(component contracts, per-slice changelog, feat hashes) is relocated to
**`frontend/.claude/context/domain/boq-frontend.md`** — load it before BoQ frontend work. Live status =
`frontend/.claude/plans/boq-upload-plan.md`.

**Docs discipline -- DOCS-UPDATE RULE (revised 2026-06-25, context-hygiene split):** per-slice / per-commit
as-built detail goes into `boq-upload-plan.md` (live status) + `boq-frontend.md` (frontend) +
`.claude/context/domain/boq-backend.md` (backend) ONLY. The always-loaded `CLAUDE.md` files get a MINIMAL
touch ONLY when a STABLE convention or a load-bearing / owner-locked invariant changes — never a per-slice
changelog entry. Do NOT re-grow `CLAUDE.md` with commit data. **Enforced in-session by the `.claude/hooks/guard_claude_md.py` PreToolUse hook** (blocks changelog-style appends + redirects to the domain docs; see `.claude/hooks/README.md`). **Frontend conventions file: `frontend/CLAUDE.md`
(NOT `frontend/.claude/CLAUDE.md`).**

### Wizard (hub / spoke / review) -- stable conventions

- **Routes** (React Router v6 `lazy()`, module `export { X as Component }`): upload `/upload-boq` (`?project=<id>`);
  hub `/upload-boq/hub/:boqId`; spoke `/upload-boq/hub/:boqId/sheet/:sheetName`; review
  `/upload-boq/hub/:boqId/review/:sheetName`. RR v6 AUTO-decodes path params; the hub encodes with
  `encodeURIComponent`. Back-nav ALWAYS routes by entity ID, never `navigate(-1)` (routes are deep-linkable with
  no guaranteed history).
- **`sheet_name` is matched VERBATIM (#152)** everywhere (React keys, every endpoint arg) — trailing/leading
  spaces exist in real data; `.trim()` ONLY for display.
- **General-specs badge is DERIVED** from `BOQs.general_specs_sheets` child membership (`source_sheet_name`),
  NEVER from `wizard_status` (the backend never writes "General specs" there).
- **State / mutations:** transient `useBoqWizardStore` (no `persist`). JSON mutations use `useFrappePostCall` +
  `mutate()` (server is authoritative); raw `fetch` ONLY for the multipart file upload. Errors are inline, no toasts.
- **Work-package read path:** WP assignments are GRANDCHILD rows that do NOT serialize on `useFrappeGetDoc("BOQs")`
  — read via `get_boq_work_packages`. Never `order_by` a Frappe field literally named `order` (PG reserved word → 500).
- **`useFrappeGetDoc` swrKey:** 3rd arg is the swrKey; use `id ? undefined : null`, never `{ enabled }`.
- **Parse / commit hub flows** are socket-driven (`boq:parse_run_done`, screen-scoped) with on-mount
  `parse_in_progress` recovery + reconnect self-heal; the acknowledge-only completion / commit-results modals are
  hub-scoped. Full detail in `boq-frontend.md`.
- **SheetCard is a persistent 3-zone stepper** (`① Configure → ② Review → ③ Commit & Tender`). The
  effective-status → zone mapping lives in the PURE `sheetCardStages.ts` (`computeSheetStages`, unit-tested,
  ADR-0010 F4); `SheetCard.tsx` only renders descriptors + interpolates dynamic text (dates/reasons). There is
  **no header status pill** — the status IS the button-bearing zone's marker; the header holds only name +
  summary + transient chips (Parsing…, needs-re-parse, N-issues). **Stage ③ is READ-ONLY** (committed badge
  alone on its line, priced/orphan chips stacked below; Commit + Tender are footer-only actions). Aside sheets
  (Skip/Hidden) collapse the rail; a committed general-specs sheet still lights ③.
- **Parse-gate rule:** `canParse = reviewedCount >= 1` (≥1 Config-Done sheet). Pending / Parse-failed sheets do
  NOT block — `ParseRunDialog` shows them read-only and only ticks Config-Done sheets.
- **Tendering is direct-nav:** the footer button navigates straight to `/pricing/{first committed sheet by
  sheet_order}`; the pricing editor's in-editor sheet-tab strip replaces the old picker (TenderingDialog removed).
- **Commit dialog is one step:** all eligible sheets pre-ticked; a hard error routes to a slim errors-only notice
  (no per-warning "Looks OK" acks, no supersede-ack). Server gate re-check + `{committed, failed}` results modal +
  `BOQ_DOWNSTREAM_ORPHAN` confirm are the safety boundary. Detail in `boq-frontend.md`.

### Pricing editor (`PricingGrid.tsx` / `SheetPricingPage.tsx`) -- LOAD-BEARING invariants

- **Description is a FAN-OUT inside the frozen anchor pane (MC-5), not the single `a4` anchor.** When any row
  carries `description_parts_raw` (`sheetHasDescriptionParts`), the Description anchor becomes one column per
  mapped description column (Option-1 freeze: ALL inside the frozen pane; Category stays the first scrolling
  column). **The whole colIndex algebra is parametric over a per-render `anchorWidthKeys` list -- the SINGLE
  SOURCE OF TRUTH:** `effectiveAnchorCount = anchorWidthKeys.length`, `descriptorColStart = length + 1`. The
  module consts `FIXED_ANCHOR_COUNT`/`DESCRIPTOR_COL_START` are retained ONLY as the legacy source + test
  exports -- never read them for live geometry; use the per-render values (passed to the row as props). Fan-out
  columns are width-keyed by Excel LETTER (`desc:<col>`, via `descriptionWidthKey`), seeded first 280 / extras
  160 (`descriptionWidthSeeds`), and are READ-ONLY nav cells at colIndex `4..4+N-1` (`< descriptorColStart` ->
  excluded from the rate path). Only the FIRST gets the depth indent + chevron + `(no description)` fallback via
  the shared `DescriptionAnchorInner`. **LEGACY FALLBACK (permanent -- pre-MC-2 committed BoQs hit this screen
  forever):** no parts -> `anchorWidthKeys = [a0..a4]` -> effectiveAnchorCount 5, byte-identical to today via the
  SAME `DescriptionAnchorInner`. Labels/values via the MC-4 `reviewRender` helpers. **L7:** search + every save
  payload's `description` (the copy-forward match guard) + rollup keep reading the joined `row.description` --
  NEVER a per-column value there. `colIndexFromColKeyPure` resolves the `desc:<col>` keys.
- **Row-memo anti-defeat rule:** the per-row `<tr>` is a `React.memo`'d `PricingGridRow` (exhaustive comparator
  `pricingRowPropsAreEqual`). NEVER pass a memoized row the shared `draftRates`/`proposedRates` object (a keystroke
  makes a new ref → all rows re-render → memo silently defeated); each row gets only its own slice via
  `groupDraftsByRow` (ref-reused). Per-sheet/grid-level props (formula map, recon map, `expanded`, `hiddenCols`,
  search-hit booleans) must flip identically for all rows; never add an inline-arrow callback prop to a row.
  **Per-row-collection rule (P1):** the SAME rule applies to any per-row collection (categories, and future
  overlays) — flow it to a row as its OWN per-row entry compared BY VALUE (`category` = `map.get(source_row_number)`,
  passed in `renderRow`), NEVER the whole Map/collection compared by identity in the row comparator (a single
  edit rebuilds the collection → all rows re-render). The whole Map may live at the GRID level (keydown, size gates).
- **Read-only gating = PRESENCE of the save callback** (`onSaveRate` / `onSaveRemark` / `onSaveColor` / ...). The
  page withholds them when locked / taken-over / grid-only. Do NOT add a second per-cell `editable` signal.
- **Rate-edit gate is ASYMMETRIC by node_type (owner-locked):** editable iff `override || node_type === "Line Item"
  || (node_type === "Preamble" && isRowQtyBearing(row))`. A zero-qty Line Item stays editable; a zero-qty Preamble
  is read-only. NEVER collapse this asymmetry. Server `save_cell_price` enforces the same rule (client = UX).
- **MANDATORY amount-formula gate (owner-locked; REVERSES "formula optional"):** every amount column needs a covering
  formula (`priceability.areFormulasComplete`, override>wildcard via `pickFormula`) before ANY rate is editable; the
  gate is ANDed in OUTSIDE `isRateEditableRow` so the override CANNOT bypass it. `onSaveFormula` (declaration) stays
  live while rates are locked. Server `_sheet_formulas_complete` is the real boundary. It ALSO gates the revision
  carry button (below).
- **Revision carry button (owner-locked, ADR-0014 Amendment C + Amendment D):** a revision commit carries NOTHING, so
  the ONE carry surface is the emerald **"Carry rates from original"** button in the pricing editor's action row,
  immediately after *Save now* (the hub's whole-BoQ button is REMOVED). Its four states come from the PURE
  `carryButtonState` (`CrossBoqCarryDialog.tsx`, ADR-0010 F4): **hidden** off a revision (`origin === "revision" &&
  source_boq` — with no original the action does not exist, so a disabled button would be a lie), then loading, then
  no-mapped-source, then **locked**, then the formula gate, then nothing-to-carry. It calls `gridRef.current?.flush()`
  BEFORE opening — the carry writes underneath the grid and a pending draft saved afterwards would overwrite a carried
  rate. **AMENDMENT E (2026-07-28) REVERSED Amendment D: the dialog carries the four non-rate layers again, OPT-IN.**
  An "Also carry" block (single-sheet mode ONLY; hidden when the server sends no `sheet.layers`, disabled when the
  formula gate blocks the sheet) offers one row per `CARRY_LAYER_KEYS` entry with a Keep/Overwrite pair shown only when
  `kept > 0`. **Defaults categories ON, the three annotation layers OFF — a UI default living ONLY in
  `initialLayerChoices()`; never push it into the server** (an omitted `layers` payload is rates-only, which is exactly
  what a pre-E client keeps getting). The plan walks every layer with overwrite OFF, so
  `layerMoveCount = carried + (overwrite ? kept : 0)`. **Three gates had to widen to BOTH axes, and each matters:**
  `nothingToCarry` replaces `selectedCount === 0` (unticking every rate but leaving Categories ticked is real work);
  the destructive footer counts rates and layer records **separately** (they are not the same kind of loss); and
  `summarizeSheetCarry`'s "Nothing was carried." branch keys off every axis (a category-only carry is the LIKELIEST
  shape — a revision whose rates all conflict can still take the whole category set). Readiness is still
  `counts.clean + counts.conflict > 0`. Emerald is BANNED inside the dialog — it means priced/succeeded in
  this screen and belongs to the button + the post-apply line.
- **The "carried" verdict state (Amendment E, owner ruling 2026-07-28):** `deriveVerdictState` gains `"carried"`,
  rendered as sky text + `CornerDownRight` + a `carried from <BOQ>` tooltip. It marks **EVERY carried row, machine or
  human** — provenance is the axis, and "who decided it" does not answer "was this inherited?"; the check therefore sits
  ABOVE the human check. Its one input is `SheetCategoryRow.carried_from_boq`, which `resolvedToSheetCategoryRow` MUST
  pass through — unlike `cross_engine_conflict`/`review_priority`/`votes` (telemetry, deliberately dropped), this is
  provenance, and dropping it fails SILENTLY (every carried row renders as locally decided). Both gates built on
  `deriveVerdictState` are unaffected and test-pinned: `isRowEditable` (`!== "unclassified"`, so a carried row stays
  correctable) and `isMasterSetBlank` (`=== "unclassified"`, so an inherited category still opens the rate gate).
  ⚠️ `SheetPricingPage`'s `onApplied` MUST call `mutateCategories()` — Amendment D had removed it as a dead
  round-trip, and that reasoning expired with the layer it was based on.
- **Formula engine arc F1–F4 (COMPLETE):** PURE `amountFormula.ts` (evaluate) + `AmountFormulaBuilder.tsx` /
  `formulaTokens.ts` (author; click-to-insert, NO literals) + `PricingGrid.evaluateAmountCell` (compute;
  formula-wins-else-pairing, draft-aware, fail-safe BLANK on any missing operand — never a stale number).
  `pricingRollup.ts` / `SummaryPanel.tsx` are formula-aware too.
- **`reconcile.ts` is a PURE LEAF** (imports only types): the SHARED `amountsEqual` epsilon + `resolveDivergence`
  (D1 = DOCUMENT default). It exists so PricingGrid / priceability / pricingRollup share one comparison with NO cycle
  (PricingGrid must NOT import pricingRollup). Divergence fires only on `cell.kind === "value"`.
- **`priceability.ts` is the shared "qty-bearing priceable line" spine** — the ONE definition for flags / the N-of-M
  count / rollup alignment. It imports PricingGrid's leaf predicates; **PricingGrid NEVER imports priceability**
  (receives flags as a prop) — keep this one-way dependency (why `isNonZeroNum` is a self-contained copy in PricingGrid).
- **Column resize is shipped; frozen-left HAS shipped too** as a TWO-PANE split, gated behind a page-owned `frozen`
  toggle (`PricingGrid` `frozen` prop, default false, wired from `SheetPricingPage`; `split` engages once every row
  height is measured -- frozen pane = the 5 anchor columns, scrolling pane = descriptors + Remarks and owns overflow-x/y,
  mirroring its vertical scroll back to the frozen pane). When `frozen` is OFF (the default) it stays a single
  `table-fixed` + `<colgroup>` table with only a vertically-sticky header (no sticky-left). Widths are GRID-LEVEL
  (never a per-row prop, so the row memo is untouched). Full-screen is an in-app root-`className` toggle (NO portal /
  Dialog -- ONE JSX tree, so the grid never remounts and unsaved drafts + cursor survive).
- **Annotation channels coexist:** system cell BACKGROUND (priced emerald / amber), user color = LEFT BORDER, system
  flags = col-0 GUTTER, focus = ring — never let one channel mask another.
- **Classify Category column (CL-2):** a read-only nav column, the FIRST right-pane (scrolling) cell at colIndex
  `FIXED_ANCHOR_COUNT` (the 5 anchors stay pinned; Category is NOT a 6th anchor). The descriptor colIndex base is
  centralized to `DESCRIPTOR_COL_START = FIXED_ANCHOR_COUNT + 1` — the `+1` lives in ONE place (render loop /
  `remarksColIndex` / `descriptorAt` / `colIndexFromColKey` / rate-guard all read it); its leading `<col>`/`<th>` go in
  the scrolling-pane + single-table colgroups, NEVER the frozen/anchor pane. It is driven by a reference-stable
  `categoriesByExcelRow: Map<number, SheetCategoryRow>` (built page-side from `get_sheet_categories`, ONE identity line
  in `pricingRowPropsAreEqual`) — the row memo is untouched (do NOT hand it a per-row prop that changes on keystroke).
  The run itself is
  driven from a screen-scoped socket (`boq:classify_sheet_progress`/`_done`) + `get_classify_status` poll on
  `SheetPricingPage` (the page's FIRST socket), mirroring the BoqHub parse-run pattern. `ClassifySheetDialog.tsx` is the
  engine/scope picker (registry-driven, modeled on CopyForwardDialog's `Set<selected>` + `Record<id,scope>`).
- **Category cell is CLICK-TO-EDIT (CL-3):** click (and Enter on the focused cell) open `CategoryVerdictPicker.tsx` (a
  Radix Popover anchored to the clicked cell via `virtualRef`), with categories GROUPED BY the engine(s) that ran
  (engine-scoped, NOT all-15; v1 = one Electrical group). **Open-state is PAGE-OWNED, keyed by excel_row — NEVER a
  per-row prop.** The row receives only a REFERENCE-STABLE `onCategoryClick(excelRow, cellEl)` callback + a stable
  `categoryLabelById` map (both compared by identity in `pricingRowPropsAreEqual`), so the row memo stays intact — do
  NOT thread an `open`/`selected` boolean through the row props. Only classified rows are editable
  (`isRowEditable`). The cell shows the human-readable LABEL (`labelFor`, id fallback) + 3 states via `deriveVerdictState`
  (auto / amber needs-review / emerald "your pick" human verdict). Selecting calls `set_row_category` (`""`=clear) with an
  OPTIMISTIC `categoryOverrides` patch folded into the reference-stable `categoriesByExcelRow` map + `mutateCategories`
  reconcile + revert-on-error. The needs-review filter is UNCHANGED (a human verdict auto-drops the row via
  `isNeedsReviewCategory`). Catalog + labels come from the read-only `get_category_catalog(discipline)` endpoint. The
  two-engine overlap-conflict fork stays PARKED. `get_category_catalog` labels the ids -- never invent labels client-side.
- **Blank-eligible clickability + amber "needs a category" fill (CL-6):** the click/Enter editability gate is
  `!!onCategoryClick && (isRowEditable(cat) || (isPriceableType(row.node_type) && hasRun))` — an ELIGIBLE
  (Preamble/Line Item) BLANK cell is clickable once the sheet has been classified at least once; a non-eligible ("Other")
  row is NEVER clickable; nothing is clickable on a never-run sheet (this REVISES CL-3's "only classified rows are
  editable"). `hasRun` is a GRID-LEVEL prop = `categoriesByExcelRow.size > 0` (page passes it; same size>0 truth that
  gates the filter button) — it is DELIBERATELY NOT in `pricingRowPropsAreEqual` (a pure function of the already-compared
  `categoriesByExcelRow`, so it never flips without that map's ref changing). The Category cell shows an amber FILL
  (`bg-amber-50 dark:bg-amber-950/30`, the grid's attention-fill token) exactly when the **ONE shared predicate
  `isMasterSetBlank(row, cat)` = `isPriceableType(row.node_type) && deriveVerdictState(cat) === "unclassified"`**
  (exported from `PricingGrid`) is true — an ELIGIBLE row (Line Item / Preamble) whose category cell is EMPTY
  (`unclassified`: with OR without a record, incl. never-classified no-record rows). The old `|| needs_review` disjunct
  was DROPPED from the fill (unreachable from resolved data — a resolved review row has a blank effective, which
  short-circuits to `unclassified` — and the owner ruled amber == master-set-blank). The fill CLEARS automatically when a
  category is set (effective non-blank → state leaves `unclassified`); do NOT add clearing code. Backend:
  `set_row_category`→`persist.set_human_verdict` UPSERTS (creates a `BoQ Row Category` when none exists) so a verdict on a
  no-record eligible row persists. **The "Check Category" view filter uses the SAME `isMasterSetBlank` predicate, so the
  filter shows EXACTLY what amber shows (owner-locked) — including never-classified eligible rows.** It REPLACED the
  RETIRED `isNeedsReviewCategory`, which returned FALSE for a never-classified row and so could not surface the rows the
  widened "empty is empty" gate now counts. `isPriceableType` TRIMS `node_type` so the client master set is byte-identical
  to the server's stripped eligible set. Amber and the filter, being one predicate, can never drift.
- **Category-gate VISIBLE half -- the live count, banner + cell gating (four surfaces, ONE predicate).**
  The page derives a LIVE blank COUNT via `PricingGrid.countMasterSetBlankRows(rows, categoriesByExcelRow)`
  -- the SAME `isMasterSetBlank` the amber fill + Check-Category filter use, now a FOURTH surface. It
  **iterates the ROWS array, NEVER the categories map** (a never-classified row is absent from the map but
  must still count -- the fail-open the backend guards). Memoise it on `[rows, categoriesByExcelRow]` (which
  already folds the optimistic overrides), so it recomputes only on a fetch/pick/clear, never per keystroke.
  **Only the BOOLEAN `categoryGateOpen = isCategoryGateOpen(count, override)` reaches `PricingGrid` -- NEVER
  the count.** A count changes on every pick and would re-render every row; the boolean flips only when
  editability actually flips (which IS when every row's editability changes -- the correct time to re-render
  all rows). It is threaded like `formulasComplete`: a `PricingGridProps` boolean (default true), a row prop
  in `pricingRowPropsAreEqual`, ANDed OUTSIDE `isRateEditableRow` in ALL THREE rate-write gates (the inline
  cell edit, `rateWritableAt` paste, `isDeltaWritable` undo/redo) so "Price any row" can never reach past it.
  **DELIBERATE asymmetry: the count keeps counting under the override (an admin sees how many remain) but the
  gate opens.** The category-pick handler writes an optimistic override for BOTH a pick AND a clear
  (`buildOptimisticVerdict`): a clear yields a BLANK verdict (effective "" -> `isMasterSetBlank` TRUE) so the
  count RISES instantly and the sheet re-locks in the same interaction (closing the drops-on-pick /
  rises-late-on-clear window); it reverts on save failure via the existing `dropOverride`, and the refetch
  reconciles an auto-machine reversion. The amber BANNER (owner-approved copy, a distinct OVERRIDE variant
  naming `category_override_by`/`category_override_at` via `formatDate`) shows the count and NAMES the existing
  "Check Category" control -- **no new button, no click-to-jump** (owner ruling). `GetPricedRowsResponse`
  declares the G2a/G2b/G2e payload keys (`eligible_blank_category_count`, `categories_complete`,
  `category_gate_override`/`_by`/`_at`/`_reason`). **The admin set/clear override CONTROL SHIPPED in G3b** --
  two contextual buttons IN the banner (SET = `Override the check` -> a reason `Popover`, OPTIONAL reason +
  `N/250` counter, no confirmation; CLEAR = `Remove override`), both gated on the pure exported
  `canAdminOverride(role, userId)` (role-resolved AND admin, MIRRORS `_is_nirmaan_admin` by construction --
  CONVENIENCE ONLY, server authoritative; the `role !== "Loading"` guard prevents a flash). Reason is
  normalised by the pure exported `normalizeOverrideReason` (client cap 250 + blank->null). Banners render
  for everyone; controls are admin-only. Override is TEMPORARY -- every G3b block carries a delete marker
  (removal condition: once classification engines cover all disciplines). **The refusal messages drop the pre-G2e "priceable"/"rate-editable" wording**
  (those terms stay correct only for the SEPARATE priceability gate). Because the client gate makes rate cells
  read-only, a UI save cannot be ATTEMPTED while locked -- the server save-refusal message is a backstop.
- **Multi-engine category resolution (HV-10, N-GENERIC -- no discipline named in the pathway):** the
  pricing editor reads `get_sheet_categories_resolved(boq, sheet_name)` (NOT the single-discipline
  `get_sheet_categories`, which is UNTOUCHED so `freeze_classification`/`get_freeze_summary` keep
  working). The SERVER applies a per-ROW ladder across every discipline with current rows: human
  wins (most-recent between disciplines) > auto-accepted > higher-`ai_confidence` between multiple
  autos (row flagged `cross_engine_conflict`) > blank. **`cross_engine_conflict` is TELEMETRY-ONLY --
  computed, never persisted, NEVER rendered** (owner ruling, same as `review_priority`); the pure
  `resolvedToSheetCategoryRow` adapter (`sheetCategoryResolve.ts`) DROPS it so it can't reach a
  rendered surface, and maps each resolved row onto the grid's `SheetCategoryRow` so `PricingGrid` +
  `deriveVerdictState` + `isNeedsReviewCategory` render UNCHANGED (blank rows still blank + amber).
  `ranDisciplines` (the read's `disciplines[]`) drives: one `get_category_catalog` per ran-discipline
  (via child `EngineCatalogFetcher` -- the hook-safe N-dynamic-fetch pattern) into the grouped
  picker (`buildSheetEngineCatalogs`), and per-running-discipline status polling (one child
  `ClassifyStatusPoller` each -- single-engine = the old single poll; the modal completes when all
  running disciplines terminate). Socket done/progress filters are MEMBERSHIP in
  `(ran UNION running)`, never `=== a constant`. **The picker's `onSelect(id, discipline)` CARRIES
  the picked group's discipline** -- the write (`set_row_category`) lands on that engine's row
  identity (upsert-on-missing mints it); "Clear" (`discipline=null`) targets the row's resolved
  human discipline. **NEVER hardcode a discipline string in this pathway** (the deleted
  `CLASSIFY_DISCIPLINE` constant was the HV-10 bug); a future engine flips `available` in the
  registry and flows through with zero code change. Every new page input stays identity-stable
  (`useMemo`/`useCallback`) so the `PricingGrid` `React.memo` shield holds.
- **Completion summary = COMBINED EFFECTIVE outcome (HV-10b, owner ruling 2026-07-22):** the
  "xx classified, yy flagged for review" message (both the `ClassifyProgressModal` line and the
  post-close toast) reports the COMBINED effective split, NOT a per-engine denominator (the old
  last-engine-wins `classifySummary` was the defect: a 2-engine run showed one engine's 13/12).
  When ALL running disciplines terminate, `applyClassifyDone` composes the summary from the FRESH
  resolved read (the grid's source of truth, post-`mutateCategories`) via the pure
  `summariseResolvedOutcome(resolvedRows, rangeUnion)`: categorised = effective non-blank (an
  auto-accept OR a human verdict -- so a pre-existing human verdict counts as categorised),
  review = effective blank. It is scoped to the run set's `rangeUnion` (`unionScopes`): a fresh
  run set (each `onStarted`) REPLACES the union (reset semantics); multiple engines fold together
  and **whole-sheet DOMINATES a mixed union**; a run recovered from the poll (unknown scope) or an
  empty scope degrades to whole-sheet. Single-engine whole-sheet with no human verdicts equals the
  engine's own numbers by construction (pinned by test). To carry the range up, `ClassifySheetDialog`'s
  `onStarted` now passes `Array<{discipline, scope}>` (signature-only; no dialog behaviour change).
  The error path and the message WORDING are unchanged -- only the numbers' SOURCE changed.
- **AI-status on the completion surfaces (HV-11): HEALTHY PATH SILENT, FALLBACK LOUD.** The pure
  `aiStatusWarning(aiStatusByDiscipline)` (`ClassifyProgressModal.tsx`) drives an AI-off warning on
  BOTH the modal line + the post-close toast. It returns "" when every ran discipline had AI ON
  (`ran`) or had no eligible rows (null) -- so the healthy completion text stays byte-identical
  (zero noise); when ANY discipline reports `disabled`/`no_key` it returns ONE plain line NAMING the
  off discipline(s) (multi-engine names ONLY the off one). `SheetPricingPage` accumulates ai_status
  PER DISCIPLINE over the run set (`aiStatusByDisciplineRef`, reset each `onStarted`, one entry per
  engine's done) -- do NOT revert to the old single last-engine-wins `aiStatusNote` render, which
  masked a mixed multi-engine run. The done payload's `ai_status` values are `ran | disabled |
  no_key | null`.
- **Classification freeze read pattern (SEPARATE from the pricing lock):** `classification_frozen` (+ `frozen_by`/`frozen_at`)
  rides `get_priced_rows` -> `GetPricedRowsResponse` and is read off `activeMessage` BESIDE `isLocked` — but it is
  DELIBERATELY NOT ORed into the pricing `locked` gate (pricing stays live under a classification freeze). It gates ONLY
  the Category picker + the Classify button. The Freeze/Unfreeze button sits in the bottom ribbon after Classify; freeze-click
  reads `get_freeze_summary` then confirms (warns on uncategorised eligible rows), unfreeze uses the verbatim owner-copy
  `AlertDialog`; both `mutate()` to re-read the flag (the `lock_sheet`/`handleToggleLock` pattern). While frozen,
  `onCategoryClick` short-circuits with a brief inline message via a `classificationFrozenRef` — the callback stays
  REFERENCE-STABLE (row-memo anti-defeat rule); NEVER thread a per-row `frozen` prop through `pricingRowPropsAreEqual`.
- **Rate-helper chassis (U1, DEV-only, `rate-helper/`; full detail in the plan doc's "Build slice U1"):** the
  "Suggest rates" button + per-cell badges + the page-level panel that renders a typed helper CONTRACT generically
  (`RateHelper.compute -> Suggestion | NoSuggestion`; the panel has ZERO helper-specific rendering — a new helper is
  a registry edit). Load-bearing invariants: (1) **DEV gate `RATE_HELPER_ENABLED` (`import.meta.env.DEV` + a
  localStorage kill-switch) — a prod `vite build` makes the whole feature unreachable**, so it must guard the button,
  the grid props (`rowSuggestionsByExcelRow`/`onSuggestionBadgeClick` passed only when enabled), and the panel mount.
  (2) The ONE write is **`PricingGridHandle.applyRate(excelRow, col, value)`, which MUST mirror the typed `onChange`
  EXACTLY — optimistic `setDraftRates` + clear proposal + the SAME 1s debounced `scheduleAutoSave`, NEVER a
  synchronous `commitRate`**: a synchronous commit races the page's `dirty -> ensureLockAcquired` and trips a spurious
  takeover; deferring makes "Use this value" byte-identical to typing (undo/mutate/takeover/locked-gate all inherited).
  (3) Memo shield (P1): the grid gets per-row ONLY its `rowSuggestions` entry compared BY VALUE (`rowSuggestionsEqual`),
  never the whole Map; `rowSuggestionsByExcelRow` + `onSuggestionBadgeClick` change only on a run/Use (like
  `categoriesByExcelRow`), never on keystroke. (4) The button's enable chain **REUSES the rate-write gate
  (`!locked && formulasComplete && categoryGateOpen`) — never re-derived** — surfacing the first failing reason as the
  title. (5) The badge lives in the rate cell's right-aligned flex strip with `stopPropagation`, so a bare cell click
  still just places the cursor.
- **Rate-helper WENT REAL (RM-3, `pricingSheetHelper.ts`; full detail in the plan doc's "Build slice RM-3"):**
  the stub is DELETED; the `Pricing sheet` helper is a page-built closure over a PERSISTED, version-keyed
  server extraction run that COMPUTES the rate CLIENT-SIDE via the RM-2 `runPipeline` UNCHANGED (the single
  compute source — a rate/param change flows in live with no re-run; only extracted attributes persist). The run
  itself IS persisted (unlike U1's page-session badges): `get_active_suggestion_run` loads it on open with no
  press, and `record_rate_suggestion_event` banks Use telemetry. Load-bearing additions: (a) a PARTIAL in-run row
  still badges via `Suggestion.producibleKinds`; (b) a FAINT always-on opener renders on every rate-editable cell
  WITHOUT a badge (owner: bring up the helper on badge-less cells) — a pure render change, no new row prop, memo
  shield intact; (c) attributes are CATEGORY-SCOPED — a not-in-run row of the helper's category gets a blank
  editable fill (never minting a badge), any OTHER category (or none) gets a "coming soon" NoSuggestion, gated on
  `ctx.category === config.category_id` (only `wiring_cabling` is defined this slice); (d) `RateHelperPanel`'s
  empty choice attrs carry a `— select —` placeholder so a blank never masquerades as its first option.
- **Rate-helper panel/strip/workings refinements (RM-3a, `RateHelperPanel.tsx` / `SheetPricingPage.tsx` /
  `PricingGrid.tsx` cell-strip; full detail in the plan doc's "Build slice RM-3a"):** three owner-locked
  invariants. (1) **TWO-MODE panel mount** (supersedes the single flex-row mount that shrank the grid): a
  `RateHelperPanel` `variant` prop — `"overlay"` in FULL-SCREEN is a viewport-`fixed inset-y-0 right-0 z-[60]`
  drawer rendered OUTSIDE the flex row (the grid's width/columns/horizontal-scroll stay BYTE-UNCHANGED on
  open/close), `"embedded"` (default) stays IN the flex row keeping the certed widen-while-open
  (`max-w-5xl` → `w-full`) but now `sticky top-4` so it rides the viewport; a scroll-into-view guard fires
  ONLY when the panel is genuinely off-screen (never yanks a sticky-pinned panel, never touches horizontal
  scroll). The page gates the flex-row + grid-shrink wrappers on `helperPanelOpen && !expanded` and renders
  the overlay panel on `expanded`. (2) **Colour-picker icon is HOVER/FOCUS-ONLY** (owner option (a), an
  action not status): `opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100`, so the
  3 descriptor `<td>`s that host `colorPicker` carry `group`; the priced dot + badge/used-check + sparkle
  opener stay PERSISTENT (strip `gap-0.5`). Colour-selection logic is unchanged (CSS + `group` markers only).
  (3) **GROUPED workings contract (generic, guardrail G3):** `WorkingsSection.sections?: WorkingsGroup[]`
  (`{label, derivation, finals, matchedRows?, attributes?}`) — the panel renders each group as its own block
  with the SHARED extracted attributes ONCE above; **ABSENT `sections` ⇒ flat rendering, byte-identical to
  before (single-group suggestions stay backward-shaped)**. `pricingSheetHelper` emits two groups on a CABLE
  row (`Cable — per Mtr` / `Termination — per Set`) and flat (no `sections`) on a termination row; groups are
  DISPLAY-ONLY (the applied value is still `Suggestion.values`). **Memo shield untouched** — no new per-row
  grid prop, `pricingRowPropsAreEqual` unchanged.
- **Rate-helper embedded panel-as-default + grid scroll conventions (RM-3b, `RateHelperPanel.tsx` /
  `SheetPricingPage.tsx` / `PricingGrid.tsx`; full detail in the plan doc's "Build slice RM-3b"):** three
  owner-locked layout invariants. (1) **EMBEDDED panel-as-default:** the embedded rate-helper panel is
  ALWAYS MOUNTED (no open/close, NO close X in embedded — the X renders only for `variant="overlay"`); its
  props `excelRow/col/kind/ctx` are OPTIONAL and absent => an empty-state card. The page derives
  `embeddedPanel = RATE_HELPER_ENABLED && !expanded`; when true the embedded page is PERMANENTLY widened
  (`w-full`, superseding RM-3a's widen-while-open there) and the flex row is always on. A badge/sparkle click
  SELECTS a row (replacing the previous) via the existing `helperPanel` page state. (2) **FULL-SCREEN sticky
  header + native bottom H-scrollbar (owner-locked):** the two panel-row wrappers between the grid slot and
  the grid container MUST carry `expanded && "flex min-h-0 flex-1 flex-col"` so the flex chain reaches the
  grid container and it BOUNDS to the viewport as the internal scroller — that is what keeps the (already
  `sticky top-0`) header visible AND puts the native H-scrollbar at the viewport bottom, in classic +
  virtualized + frozen split (both panes' headers pixel-aligned). Without it the outer `.fixed.inset-0`
  wrapper scrolls and the header scrolls away — do NOT let those wrappers go empty-class in full-screen.
  (3) **EMBEDDED always-visible H-scrollbar = a SYNCED PROXY bar:** a `sticky bottom-0` thin bar rendered as a
  SIBLING of the scroll container (spacer width = `twoPane ? scrollPaneTableWidth : totalWidth`), two-way
  `scrollLeft`-synced to the active X-scroller (`scrollPaneRef` when split, else `containerRef`) via a
  re-entrancy-latched effect; rendered ONLY embedded (`!expanded`) — full-screen uses the native bounded
  scrollbar. Same viewport-pinned-H-scrollbar FAMILY, realized per-mode. **Memo shield untouched** — the
  proxy + `expanded` gate are GRID-LEVEL; no new per-row prop, `pricingRowPropsAreEqual` + the virtualizer
  math unchanged (only its containers' styling).
- **Rate-helper single-bar + full-screen push panel + collapsible top block (RM-3c, `PricingGrid.tsx` /
  `RateHelperPanel.tsx` / `SheetPricingPage.tsx`; full detail in the plan doc's "Build slice RM-3c"):** three
  owner-locked layout invariants. (A) **Embedded = ONE horizontal scrollbar.** The single-pane container +
  the frozen scrolling pane carry `boq-embed-hidehbar` when `!expanded`; a scoped `<style>` inside PricingGrid
  (NOT `index.css`) does `::-webkit-scrollbar:horizontal{display:none;height:0}` -- suppresses ONLY the native
  H-bar, keeps the V-bar + `overflow-x:auto` capability. **Cross-browser shape: blink/webkit clean; Firefox
  has no per-axis control so it keeps a below-fold native H-bar (proxy stays primary).** The proxy width +
  spacer are LIVE-MEASURED from the ACTIVE scroller via a ResizeObserver (`hScrollMetrics`) -- proxy width =
  `scroller.clientWidth` (kills the V-bar clamp), spacer = `scroller.scrollWidth` (kills the frozen
  short-scroll); do NOT revert to the one-shot column-width sum. (B) **Full-screen panel is a PUSH panel**
  (`RateHelperPanel` variant `push`, supersedes the RM-3a fixed overlay): an IN-FLOW flex sibling of the grid,
  so `#4` is a flex ROW [ grid column | push panel ] and `#3` the grid COLUMN (`min-w-0 flex-1 flex-col`); the
  grid narrows by exactly the panel width and the bounded scroller / sticky header / native H-bar keep working
  at reduced width. A left-edge drag handle (`role="separator"`, focusable) resizes -- clamp `[280, 50% of the
  wrapper]`, double-click resets to the DEFAULT **300**, Arrow keys nudge, width persisted to
  **`nirmaan-rate-helper-panel-w`**. Push keeps its close X; embedded panel-as-default is untouched. (C)
  **Full-screen COLLAPSIBLE top block:** everything above the grid (title + both ribbons + banners + panels)
  is one `space-y-4` block that `hidden`s when `expanded && topCollapsed` so the grid-slot fills vertically; a
  SLIM RAIL (`expanded && topCollapsed`) re-expands in one click and shows the truncated sheet name + a
  compact chip per active blocking/visible banner (**the category chip surfaces whenever blanks exist -- in the
  blocking OR override-informational form -- so collapsing never hides state**). **Escape re-expands first**
  (a second Escape exits full-screen -- never trapped). Persisted to **`nirmaan-fullscreen-top-collapsed`**.
  EMBEDDED is untouched (`topCollapsed` only bites while `expanded`). **Memo shield + virtualizer math
  untouched** across all three.
- **Socket reconnect self-heal must be reconnect-GATED + debounced (T1, owner-verified):** a `socket.on("connect", ...)`
  handler that refetches (`mutate()`/`mutateCategories()`) MUST NOT fire on every connect — the initial mount connect
  double-fetches (the SWR mount fetch already ran) and a flapping dev socket then refetches on every reconnect, and
  because `PricingGrid` is `forwardRef` WITHOUT `React.memo`, each page re-render is a full-grid reconcile → a continuous
  idle re-render storm (measured: ~92% main-thread saturation for a whole session). The rule: refetch ONLY on a GENUINE
  reconnect (a `connect` that followed a `disconnect`, tracked via a REF — never state, or the tick itself re-renders)
  and debounce to ≤1 refetch per ~30s (`shouldRefetchOnConnect` pure helper + `RECONNECT_REFETCH_DEBOUNCE_MS`). frappe-react-sdk's
  SWR `revalidateOnReconnect` binds the browser `online` event, NOT the app socket, so socket flapping does NOT hit SWR —
  do not add per-hook `revalidateOnReconnect:false` for socket reasons. (Memoizing `PricingGrid` is the T2 source-independent
  kill — SHIPPED, see below.)
- **`PricingGrid` is `React.memo`'d (V0/T2) — EVERY prop it receives MUST stay identity-stable, or the shield silently dies.**
  A page-level re-render with unchanged grid inputs now bails at the memo instead of re-executing the whole grid body +
  `pricingRowPropsAreEqual` across all rows. This holds ONLY because `SheetPricingPage` keeps every grid prop referentially
  stable: the 7 grid handlers (`handleSaveRate`/`Remark`/`Color`/`ReconChoice`/`Formula`, `handleBatchWrite`, `handleDirtyChange`
  + the transitive `ensureLockAcquired`) are `useCallback`, and the derived collections (`rows`, `rowFlags`, `byRowIndex`,
  `childrenByParent`, `displayRows`) are `useMemo`. **`rows` is the linchpin:** `mergeRowsPreservingIdentity` returns a fresh
  array every render, so `rows` MUST be `useMemo`'d (keyed on `rawRows`) or the grid's `rows` prop churns and the memo never
  bails. Any NEW grid prop must be `useCallback`/`useMemo`/stable-per-fetch; a new plain-const handler or `new Map()`/`?? []`
  passed to the grid re-defeats the memo with no error. **The three loading/`!boq`/`!sheetName` guards render as branches of the
  SINGLE `return` (NOT early returns)** so all derived state stays hook-legal — do not reintroduce an early return above the
  derived-state region (it makes the memoization illegal). Verify with React DevTools Profiler ("Why did this render?").
- **Virtualized windowing (V1) — ONE virtualizer drives BOTH panes; classic path retained behind the A/B toggle.** The grid
  windows rows via `@tanstack/react-virtual` when the page-owned `virtualized` prop is true (default ON, session-scoped); false =
  the CLASSIC full render, **byte-identical to pre-V1** (the 143 `PricingGrid` tests certify it). ONE `useVirtualizer` instance is
  the row-window authority for both panes: `getScrollElement` = `scrollPaneRef` (two-pane) / `containerRef` (single); both
  `<tbody>`s render the SAME `getVirtualItems()` slice + identical `deriveSpacers` spacer `<tr>`s (never two synced virtualizers).
  The render decision is `twoPane = selectRenderPath(...) === "twoPane"` (classic gates on `split`, virtualized on `frozen`); only
  the `<tbody>` content changes (via `renderTbody`) — the pane/table JSX is shared. **Pane alignment = MAX-of-both-panes height
  (V1-FIX): NEVER assume which pane is taller.** The freeze layout puts the wrapping **Description** in the FROZEN pane (through
  the 5 anchors), so measuring only the scrolling pane truncates + mis-aligns. The custom `measureElement` reads BOTH panes' rows
  by `data-index` and feeds `ceil(max(paneNaturalHeight(frozen), paneNaturalHeight(scroll)))` to the ONE size cache; both panes get
  that size as the `<tr>` height (a table MIN) → the taller reaches content, the shorter pads → aligned, no truncation. **`paneNaturalHeight`
  MUST measure the `<tr>`'s TRUE box (`Math.ceil(tr.getBoundingClientRect().height)`, row border INCLUDED) — this is what makes both
  panes match CLASSIC, which applies `ceil(single-table box)` to both (V1-FIX-2).** The `<tr>` box is SELF-CORRECTING (`max(content,
  applied)`, a fixpoint) so it does NOT run away — do NOT revert to the old content-wrapper sum (it omitted the ~1px border → ~1px/row
  drift at every DPR) and do NOT add the border to a content-wrapper measure (a stretching scrolling cell feeds it back = runaway).
  `clipDescription` is OFF for auto virtualized rows, ON for classic + manual-drag rows. TanStack observes only the LAST element per
  index (verified) → a frozen-only reflow (column-resize Description re-wrap; scrolling `<tr>` unchanged → ResizeObserver silent) is
  covered by a **two-phase drag-END reset** (`remeasureVirtualRowsAfterResize`: `measure()` to clear sticky sizes, then a
  `resizeSettleTick`-keyed `useLayoutEffect` re-invokes `measureElement` on the mounted rows POST-commit — never streaming, no thrash;
  V1-FIX-2b). `measure()` alone is NOT enough (it clears but never re-reads the frozen twin; a shrunk row's min-height stays sticky).
  Residual drift is <=0.31px at fractional display DPR / browser zoom (two separate `border-collapse` tables) — 0px at 100% zoom.
  The freeze-measure-all `useLayoutEffect` is SKIPPED when `virtualized`. **Any new grid prop must stay identity-stable (the V0
  shield);** `measureRef` is stable per virtualizer instance and is compared in `pricingRowPropsAreEqual`. Pure window helpers
  live in `pricingVirtual.ts` (unit-tested). Runtime behavior is an A/B instrument — confirm the virtualized path live before
  relying on it; classic is the guaranteed fallback.
- **Off-window nav/jump = scrollToIndex-then-focus (V2), always `align:"center"`.** `focusCell` / `jumpToRow` reach the
  virtualizer via reference-stable refs (`virtualizedRef` + `scrollRowIntoWindowRef`, assigned after `useVirtualizer`) so
  they stay memo-safe; both branch on the pure `resolveJumpAction(isMounted, virtualized)` and, for a VIRTUALIZED off-window
  target, `scrollToIndex(idx,{align:"center"})` then focus after a 50ms mount-defer. **NEVER `align:"auto"`** — with dynamic
  row heights a near target's ESTIMATED offset reads as already-visible, so `"auto"` no-ops (arrow-nav stalls at the edge).
  Search-jump to any row works; **arrow-nav across the window edge is focus-safe (never escapes to `document.body`) but does
  NOT auto-scroll past the edge** — this virtualizer only re-windows on real wheel events, not programmatic scrolls (a V1
  trait affecting the mounted-path `scrollIntoView` too), so the near-target `scrollToIndex` can't advance it; do not
  re-attempt without reworking the virtualizer's scroll observation.
- **Per-row overlay open-state is keyed by the DURABLE excel row (`source_row_number`), NEVER the window array index (V2).**
  Under virtualized row recycling a collapse/filter reshuffle makes array index N map to a different row, so an index key
  mis-targets. The remark popover uses grid-level `openRemarkExcelRow`; the row prop `openRemark` stays a by-value boolean
  (memo untouched).
- **An in-row Radix popover in a VIRTUALIZED grid MUST close on VISIBILITY loss, NOT on unmount (V2-FIX).** The overscan
  zone keeps a row MOUNTED while scrolled off-screen, so a mounted-set / unmount-only close leaves the open `PopoverContent`
  collision-pinned into the viewport as a detached "ghost". Every in-row popover (RemarkCell, ColorPicker, ReconcileBadge)
  closes via the shared `useCloseWhenScrolledOut(triggerRef, open, onClose)` hook -- an `IntersectionObserver` (viewport
  root, threshold 0) on the trigger, gated on `virtualized` through `VirtualizedContext` (a context, NOT a row prop, so the
  memo shield holds; classic stays byte-identical). Same shape as the page-owned CategoryVerdictPicker's IO close. The
  grid-level `shouldCloseOverlay` mounted-set effect stays only as the remark BACKSTOP. Closing discards any unsaved draft
  (owner-accepted). EXEMPT: a popover in the STICKY `<th>` header (AmountFormulaBuilder) never scrolls off -> no observer.

- **Header column filters + the Row Type label (UI slice, owner-locked).** The pricing grid's Row Type
  and Category headers each carry a funnel (`boq-wizard/GridColumnFilter.tsx`) opening a type-to-search
  checkbox popover. Load-bearing invariants:
  - **FILTER STATE IS PAGE-LEVEL AND ACTS ON THE ROW SET, NEVER ON A ROW.** It is a FOURTH clause in
    `SheetPricingPage.passesViewFilter`, beside the three existing view filters. The grid gets only the
    option list, the current selection and a callback -- six PER-GRID props, NONE in
    `pricingRowPropsAreEqual`. **The popover's type-to-search box is LOCAL to the popover and must never
    be lifted to the page**; that is what keeps a keystroke from re-rendering the grid. The
    module-level `EMPTY_FILTER_SET` / `EMPTY_FILTER_OPTIONS` destructuring defaults exist so a default
    cannot mint a new identity per render and defeat the `PricingGrid` memo -- do not inline `new Set()`.
  - **FILTER ON THE LABEL, MATCH ON THE ID.** An option is `{id, label}`: display/sort/search use the
    label (agreeing with the Category cell's `labelFor`), the predicate compares ids. Selections are
    ALWAYS sets of ids, so editing a catalog label cannot silently break a live filter.
  - **`isMasterSetBlank` is THE single blank predicate and now drives FIVE surfaces** -- the server
    gate/count, the grid's amber Category fill, the Check-Category view filter, the page's live blank
    count, and the Category filter's **"(Blanks)"** entry. Never write a sixth definition. An empty
    selection is a PASS-THROUGH (never "hide everything"); AND across columns, OR within a column.
  - **The funnel trigger's `h-4` + `leading-none` is LOAD-BEARING, not styling.** In FROZEN (two-pane)
    mode the Row Type header lives in the frozen table and Category in the scrolling table; an
    unpinned trigger height let the active-state count badge grow the frozen header row, offsetting
    that pane's body so the two grids visibly stopped lining up. Any affordance added to a header cell
    in EITHER pane must be height-neutral across all of its states.
  - **`GridColumnFilter` deliberately DUPLICATES `RateMasterDataViewer`'s `ColumnFilter` rather than
    importing it** (owner ruling): exporting would couple two independent modules, and the two already
    diverge. Do not "de-duplicate" them.
- **The rate-helper panel's three-way attribute state (owner-locked).** `ExtractedAttr` and
  `WorkingsAttribute` both declare `defaulted?: boolean` (it always arrived on the wire; it is no longer
  read through a cast), and the pure `isAttrBlank` / `isAttrDefaulted` in `rateHelperTypes.ts` are the
  ONE definition of the render rule: **BLANK (`value === ""`) -> red border; DEFAULTED -> the amber
  attention token; POSITIVELY ABSENT (the `"None"` sentinel, or `disabled` because its controller is
  None) -> NEITHER.** `"None"` is a DECISION, not a gap, and must never render as missing. ONE condition
  in `pricingSheetHelper` drives both the structural flag and the prose derivation line, so they cannot
  disagree; the prose line is a separate surface and is KEPT. Neither highlight holds state -- a human
  override recomputes the helper, which clears the mark at source, so a highlight can never outlive the
  correction.
- **User-facing text says "Row Type"; every field stays `classification` (U3, owner-locked).** The
  rename is WORDING, not a migration: `classification` / `human_classification` /
  `effective_classification` / `new_classification`, the AI prompt constants, the review CSV export
  headers, and `data-colkey="a3"` are all UNCHANGED. Strings naming the CATEGORY-CLASSIFICATION RUN
  (the classify modal, the Freeze/Unfreeze Classification family) are a DIFFERENT concept that shares
  the word and must NOT be renamed. Both screens render the ONE shared constant
  `reviewRender.ROW_TYPE_LABEL` (and the derived `ROW_TYPE_FILTER_LABEL`), which is what makes a
  half-rename structurally impossible rather than merely caught; `reviewRender.test.ts` pins it.
- **An `attribute_definitions[].default` is NOT display-only -- it reaches the AI.**
  `extraction.build_attribute_defs` copies it into the per-attribute definitions sent to the model, and
  it also seeds the Rate Master Derivation screen ahead of the goldens fallback. It is DISTINCT from the
  top-level `extraction_defaults` map. Treat adding one as a behavioural change, and prove the
  whole-config RM-4b round-trip -- the loader does not validate, only `update_rate_config` does.

### Review screen (`ReviewTree.tsx`) -- load-bearing invariants

- **Depth / indent comes from the `effective_parent_index` chain (`computeDepths`), NEVER the stored `level`** (which
  diverges after `human_parent` edits). `isVisible` walks from the PARENT, so a collapsed row stays visible.
- **Description is a FAN-OUT of the original columns (MC-4), not the single joined anchor.** When any row carries
  `description_parts_raw` (`sheetHasDescriptionParts`), the Description anchor becomes one column per mapped
  description column via the pure helpers in `reviewRender.tsx` (`buildDescriptionColumns` / `descriptionCellValue`):
  set+order from the `role:"description"` descriptors; per-cell value by `col_letter`; LABEL from the triples'
  `header_label` **union-across-rows** (letter fallback), `" 2"/" 3"`-suffixed on duplicates. The FIRST column is the
  always-on wide anchor (depth indent + `(no description)` fallback via the shared `DescriptionCellInner`); the rest
  are narrower and join the `visibleCols` picker via `pickerColumns`. `totalCols` keeps base `8` + extra visible
  description cols so `colSpan`s stay aligned. **LEGACY FALLBACK:** no parts on any row (pre-MC-2 drafts) -> the
  single anchor renders via the SAME `DescriptionCellInner` (byte-identical). Search still reads the joined
  `row.description` (unchanged); exports keep the single joined Description (MC-5/owner-deferred).
- **Description search uses the shared `boqDescriptionSearch.ts` (`fuzzyDescriptionMatchSet`)** — token-AND, min
  length 2; fuzzy decides MEMBERSHIP, document order drives prev/next. ReviewTree + SheetSearchView both call it;
  RestructureModal inherits via SheetSearchView. Never inline a second matcher.
- **Search highlight = RINGS (`ring-inset`), never backgrounds** (a background would mask the edited-green tint).
- **Filters gate on the FILTER axis (`classificationVisible && passesFilter`), NOT the collapse axis** — a hit can
  never be a filtered-out row, and stepping auto-expands a collapsed-parent hit via `revealAndScrollToRow`.
- **Finalized / "Parsed Check Done" freeze:** `readOnly` HIDES all 11 write affordances; backend
  `_guard_sheet_not_frozen` is the durable backstop. Restructure goes through `RestructureModal` (5 child-placement
  options + a batch cycle-guard). A flag dismissal / remark is NOT an edit (the row stays "Original").


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

### BoQ Pricing Editor -- Frontend Conventions

The FULL per-slice component contracts (keyboard-nav matrix, the row-memo anti-defeat rule, the formula engine F1–F4, reconciliation, collapse/expand, lock/unlock, the two-ribbon toolbar, search/column-hide, export/download, review-screen render contracts, etc.) live in **`.claude/context/domain/boq-frontend.md`**. Load it before pricing-editor / review-screen frontend work. The STABLE conventions + LOAD-BEARING invariants are summarized above (§ "Pricing editor … LOAD-BEARING invariants" and § "Review screen … load-bearing invariants").

### Pricing Module (HVAC / Electrical / ELV Pricing) -- Frontend Conventions

Standalone estimation-pricing pages (SEPARATE from the BoQ wizard/pricing editor). Lives in
`src/pages/pricing/` (`PricingWorkbookPage.tsx` + `pricingWorkbooks.ts` + local `pricingLibs.ts`). Live
status / decisions: `frontend/.claude/plans/pricing-module-plan.md`.

- **`pricingWorkbooks.ts` is THE single source of truth (PW-1).** One `PRICING_WORKBOOKS` registry entry per
  workbook page (`{ path, title, label }`) feeds all three consumers: the generic page (identity), the route
  entries in `routesConfig.tsx` (paths), and the sidebar spread in `NewSidebar.tsx` (keys + labels). Adding a
  workbook page = one registry entry + one route object + nothing else in the sidebar (its four touches are
  registry-driven: the role-gated item spread, `allKeys`, `groupMappings`, and the flat-label discriminator Set).
  Two rules are load-bearing: (1) **`title` must match the Pricing Workbook doctype's unique `title` exactly** —
  it is both the selection key and the import title; (2) **`path` must stay a SINGLE top-level segment**, because
  the sidebar's active-item matching is single-segment (`pathname.slice(1).split("/")[0]`, then
  `` `/${selectedKeys}` === subitem.key ``) — a nested `/pricing/hvac` would never highlight.
- **ONE generic page, one route object PER workbook (PW-1) — do NOT collapse them into `/pricing/:key`.**
  `PricingWorkbookPage` resolves its own entry from `useLocation().pathname` via `workbookForPath`; an
  unregistered path renders a visible "Unknown pricing workbook" state, never a blank page. Separate route
  objects are deliberate: they guarantee a real UNMOUNT on workbook switch, which is what destroys the
  Luckysheet **global singleton** and fires the `releaseBeacon` that frees the server-side checkout lock. A
  single param route reuses the element (no remount) and would strand the lock for 30 min — live-verified in
  PW-1: switching away mid-edit left `checked_out_by` NULL with zero stale sheet content.
- **Selection is BY TITLE, never by list position (PW-1).** `list_workbooks` is unfiltered and ordered
  `modified desc`, so the old `rows[0]` pick silently changed which workbook opened as people saved. Select with
  `rows.find(r => r.title === entry.title)`. Likewise the empty state is **per-title** (`!match`), NOT
  "zero workbooks in the system" (`!rows.length`) — the latter made Import unreachable for every page once any
  one workbook existed, so workbooks #2/#3 could not be created through the product at all. Import creates with
  `entry.title`, giving each page an independent empty → import → ready lifecycle.
- **Import + save pipeline (FR-1 -> FR-6), in order.** Import: `decodeSheetNames` (LuckyExcel escapes sheet
  NAMES but not formula text) -> `normalizeFormulas`. Save: `reenterNormalizedFormulas` (push corrected
  formulas back through the engine so it recomputes a real value — **pass the plain STRING**; the object form
  `setCellValue(r,c,{f:"..."})` silently leaves the cell empty) -> `serializeSheets` (compaction + a final
  normalize guard that drops stale `v`/`m` on any cell it still has to fix). Transport for BOTH
  `create_workbook` and `save_workbook` is **gzip + `multipart/form-data`** (file field `workbook_json_gz`);
  the nested-JSON body is GONE, there is no fallback. Rationale: nesting the workbook as a JSON string escaped
  every quote (1.23x -> 25.91 MB) and 413'd against the 25 MiB `max_file_size`; gzip is ~0.7 MB.
- **Dropdowns are re-attached at import (DV-2), because LuckyExcel DROPS every `<dataValidation>`.**
  `pricingValidations.ts` re-reads the same .xlsx with the **vendored `window.JSZip` global** (never an npm
  import — that would bundle it), parses `<dataValidation>` **and the `x14:` extLst variant**, and attaches
  `sheet.dataVerification`. Schema: a flat map **`"<row>_<col>" -> record`, 0-indexed, PER CELL** — a
  multi-cell `sqref` expands to one record each. `value1` is polymorphic: a range reference (cross-sheet
  works, including quoted names with spaces and `&`) or a literal comma list. Range sources are **clamped to
  the source sheet's data extent +5** — the engine re-walks the whole range on every dropdown open, so an
  unclamped 50k-row source is 50k iterations per click. Runs AFTER `decodeSheetNames` (matching uses decoded
  names) and never blocks an import. `serializeSheets` keeps the key, so dropdowns survive round-trips.
  **`prohibitInput` is false everywhere (advisory red-flag, owner-vetoable) — and NOTE: validation only
  guards TYPING; programmatic writes bypass it entirely, so a dropdown is a convenience, not a constraint.**
- **ENGINE CAUTIONS (owner-locked, both proven by minimal repro).** (1) **Never emit `INDEX` in composition** —
  `=INDEX(r,2)` is fine but `=INDEX(r,2)*2` returns **0**; use `VLOOKUP` against a key-first helper pair.
  (2) **Never leave `<operator><space>(`** — even `=2 * (1+2)` yields `#NAME?` for the whole cell; a space
  BEFORE the operator is harmless. `normalizeFormulaText` strips it quote-aware (string literals untouched).
  (3) The engine **never evaluates formulas at load** — it renders the cached value, which is why save-time
  re-entry (not just text fixing) is required.
- **Browser-measurement guard:** assert `document.visibilityState === "visible"` before any timing or render
  measurement. Hidden tabs suspend `requestAnimationFrame` (Luckysheet never paints) and throttle timers to
  ~1/min — this manufactured a convincing but entirely false "render hang" that cost two slices.
- **Vendored engine, script-injected — NOT bundled.** Luckysheet / LuckyExcel / JSZip are vendored under
  `nirmaan_stack/public/pricing_libs/` and served at `/assets/nirmaan_stack/pricing_libs/`. `pricingLibs.ts`
  injects the CSS `<link>`s + `<script>`s at runtime in dependency order (plugin.js before luckysheet.umd.js;
  jszip before luckyexcel) and reads `window.luckysheet` / `window.LuckyExcel`. **Never `import` these packages**
  (that would bundle ~3 MB into the app chunk); keep them out of the import graph.
- **Lazy `Component` export (M1.59)** — the page module ends with `export { PricingWorkbookPage as Component }`.
  All three route entries lazy-import the SAME module, so they share one ~10 KB chunk.
- **Sheet init is POST-MOUNT, never synchronous (PM-3):** `luckysheet.create` must run only after the container
  div is mounted. Every create path (load / import / edit / release) calls `requestSheet(sheets, allowEdit)` (a
  nonce-bumped state request); a `useEffect` keyed on `status === "ready" && renderReq` performs the actual
  `initSheet`. NEVER call `luckysheet.create` synchronously inside an async callback — the container is rendered
  only in the non-empty branch, so a pre-`"ready"` create hits a null container (`getElementById → null →
  addEventListener` crash). Re-init (not a live toggle) is how `allowEdit` changes — `destroy()` then `create`.
- **Toolbar always on (PM-3):** `showtoolbar: true` unconditionally; `showinfobar: false`; other bars default.
  Edit-only actions stay gated by `allowEdit`, NOT by hiding the toolbar.
- **Checkout-lock flow + honest banner (PM-3):** page loads READ-ONLY; "Edit" → `checkout` → re-init with
  `allowEdit:true` + Save/Release. On a checkout FAILURE, re-fetch the true lock state: show "Locked by <holder>
  — read only (since <t> IST)" ONLY when `checked_out_by` is non-null AND ≠ current session user AND not expired;
  otherwise surface the REAL error and keep Edit available (retryable). NEVER show an "another user" fallback on a
  null holder (that phantom-lock bug is DIAG-3). unmount + `beforeunload` best-effort `release` (fetch `keepalive`
  with the CSRF header).
- **Save posts the COMPACT form via `serializeSheets(getAllSheets())` (PM-5) — the single source for the save
  shape.** `serializeSheets` (in `pricingLibs.ts`) strips the rebuilt/runtime keys (`data`, `visibledatarow`,
  `visibledatacolumn`, `jfgird_select_save`, `luckysheet_selection_range`) and keeps `celldata` + `config` +
  `calcChain` + display settings. The raw `getAllSheets()` is ~26 MB (Luckysheet rebuilds `data` for every sheet
  at load); compacting → ~14 MB so it POSTs. LOSSLESS — the engine rebuilds `data` from `celldata` on load; this
  is the same celldata-only canonical shape already stored. Any new save-shaped path MUST go through
  `serializeSheets`.
- **Save uses a raw `fetch`, NOT the SDK (PM-6, large-body precedent).** `handleSave` POSTs the compacted body via
  same-origin `fetch` to `/api/method/…save_workbook` (session cookie + `X-Frappe-CSRF-Token` from
  `window.frappe`/`window.csrf_token`), mirroring the `releaseBeacon` + wizard multipart-upload precedent — the
  SDK/axios path stalled intermittently through the Vite dev proxy on the ~18 MB body, while `fetch` completes in
  ~1.6 s (live-verified: 3 button saves + revert, all 200, no hang). Failure parses `_server_messages` for the
  real message and keeps lock + Edit state. **Everything else (checkout/release/get/list) stays on the SDK** —
  small bodies, no reason to change. Watermark opacity is **0.22** (PM-6, darker; still `#D03B45`).
- **Watermark** = pointer-events-none data-URI-SVG overlay in the **Nirmaan brand red `#D03B45`** (full name +
  email, tiled ~30°, font 21/weight 600, opacity 0.22 per PM-6) in BOTH read-only and edit modes; must never
  block sheet interaction. Keyed on the USER, not the workbook — it needs no per-workbook parametrization. It
  is a **React SIBLING** of the engine mount (both `absolute inset-0` inside one `relative flex-1`) — NEVER
  reparent `#pricing-workbook-luckysheet` or the watermark strands.
- **Dropdown height cap (`pricing.css`, imported once by `PricingWorkbookPage`):** a bare-ID rule
  `#luckysheet-dataVerification-dropdown-List { max-height: 300px; overflow-y: auto; }` makes long
  range-sourced data-validation dropdowns scroll INTERNALLY instead of rendering at full content height
  (unscrollable + JS-placed off-screen). Capping the height also fixes placement (the engine measures the
  capped element). Short lists are unaffected (natural height, no scrollbar). Bare-ID specificity wins over the
  vendored script-injected styles — no `!important` needed. Accepted residual: a list opened low in the
  viewport can overhang the bottom edge but stays scrollable.
- **Dropdown type-to-search (PW-DS) is an APP-LEVEL DOM augmentation (`pricingDropdownSearch.ts`), never a
  vendored change.** `installDropdownSearch()` (one `useEffect([])` in `PricingWorkbookPage`) runs a
  `document.body` `MutationObserver` that, on each dropdown open, prepends a filter `<input>` into
  `#luckysheet-dataVerification-dropdown-List`. **The input MUST carry `luckysheet-mousedown-cancel`** — without
  it the engine's global mousedown handler dismisses the popup and steals focus (recon-proven). Selection stays
  the engine's own document-delegated `.dropdown-List-item` click (filtering only toggles `display`); the module
  owns arrow/Enter/Escape nav since the engine has none. Pure `filterOptions` / `nextVisibleIndex` are
  unit-tested. NEVER move this into the vendored `pricing_libs`.
- **Full-screen (PW-FS) = root-className FLIP, NOT the native Fullscreen API, NOT a portal.** An `expanded`
  `useState` swaps the page root between `flex flex-col h-[calc(100vh-100px)]` and
  `fixed inset-0 z-50 flex flex-col bg-background` (pure `pricingRootClass`) — ONE JSX tree, nothing remounts
  (engine / lock / sandbox / watermark survive). Native API is BANNED (the Radix save/import dialogs portal to
  `document.body` at `z-50` and would be hidden behind a fullscreened node; against a `z-50` overlay DOM-order
  puts them on top). **`window.luckysheet.resize()` MUST fire on BOTH enter and exit** (a `useEffect([expanded])`
  rAF, guarded on the sheet-inited ref) — the engine's own window-resize listener does not fire on a
  container-only change. Esc-exit uses the pure co-located `shouldExitPricingFullscreenOnEsc` (bare Esc; false
  on `defaultPrevented`; false on INPUT/TEXTAREA) — do NOT import the wizard's twin (the module stays
  standalone). NOTE: Luckysheet `stopPropagation`s Escape at its grid, so Esc exits only when focus is OUTSIDE
  the grid; the toggle button is the universal exit.
- **Access strings (PM-1 DB-verified, profile side):** `PricingRoute` guard + the sidebar spread both gate on
  Administrator OR role_profile `Nirmaan Admin Profile` / `Nirmaan Estimates Executive Profile`. The backend
  (`api/pricing/workbook.py`) also accepts the `Nirmaan Estimates Executive` Role and is the real enforcement
  layer — keep the guard/sidebar strings in sync with each other, not necessarily with the backend Role set.
- **Action-bar role gating (PW-2a).** ONE derived flag drives the whole bar:
  `isPricingAdmin = user_id === "Administrator" || role === "Nirmaan Admin Profile"`, with `role` destructured
  off the EXISTING `useUserData()` call (no new fetch — `PricingRoute` already warmed that SWR key). Admins get
  Edit / Save / Release / Import / **Replace from Excel**; estimation users get **Sandbox only** and never see
  a write affordance (the empty-state Import is admin-gated too). **Gate the bar on
  `roleResolved = role !== "Loading"`** — `useUserData` returns the literal `"Loading"` while the
  `Nirmaan Users` doc is in flight, and without the gate an admin flashes the estimation bar. Client gating is
  **UX only**; the backend write gate (`_require_pricing_write_access`) is the boundary, and `PricingRoute`
  stays wide so estimation users still reach the module.
- **Sandbox pattern (PW-2a): editability WITHOUT a lock.** `requestSheet(sheets, true)` with **no** `checkout`
  call; persistent amber banner + Exit Sandbox, which RE-FETCHES from the server (the engine may mutate the
  array it was created with, so a cached array is not a trustworthy pristine snapshot). Three things keep it
  from ever writing, and all three must be preserved: (1) `releaseBeacon` hard-guards on `lockMineRef.current`,
  which only `handleEdit` sets — **do NOT replace that guard with a `sandbox` condition**, the ref is the single
  truth for "do I hold the lock"; (2) Save/Release render only under `lock === "mine"`; (3) **NEVER pass
  `allowUpdate: true` to `luckysheet.create`** (engine default is false) — with it on, the engine POSTs its own
  deltas to `updateUrl` autonomously, outside the lock, outside `save_workbook`, and outside the Sandbox
  guarantee. The engine binds no Ctrl+S and has no toolbar save item; the Save button is the ONLY save surface.
- **Replace-from-Excel is a SAVE, not a create.** Admin + lock held. Reuses the full `runImportPipeline`
  (shared with the empty-state import), confirms first, re-`checkout`s to refresh the 30-min lock before the
  POST (idempotent for the holder; a long .xlsx conversion can otherwise blow the window), then posts
  `save_workbook` with `{name}`. **Never `create_workbook`** — `Pricing Workbook.title` is `unique: 1`, and
  save preserves the prior content as a version snapshot for free. Payload shape is identical between the two
  endpoints; only the text field differs.
- **Import pipeline stage order is AUTHORITATIVE (PW-2b-i) — every position is load-bearing:**
  `decodeSheetNames -> clampRowBloat -> normalizeFormulas -> runFormulaStage (freeze -> transform ->
  materializeHelpers) -> attachDataValidations`. decode FIRST (LuckyExcel escapes sheet NAMES, not
  formula text). **clamp SECOND is a PERFORMANCE PRECONDITION**, not tidiness — raw ELV converts to
  1,819,874 cells of which 98.8% are style-only filler and every later stage walks celldata.
  normalize before the parser. **DV LAST and after the clamp** — `clampRangeSource` clamps a dropdown
  source to the sheet extent +5, so running it on the bloated grid clamps to ~50,503 instead of ~30
  and reinstates the per-dropdown cost DV-2 removed. `runImportPipeline` returns `{sheets, report}`.
- **Formula transforms are AST-based (`pricingFormulaAst.ts` + `pricingTransforms.ts`), never regex.**
  Transforms COMPOSE inside one cell (an IFS whose branches are each a multi-condition array
  INDEX/MATCH; a LET wrapping another), so one bottom-up `mapNode` pass is what makes composition
  safe — and it is why LET inlining does not duplicate an expensive lookup. **Abstain is a
  first-class outcome**: anything not understood is left UNTOUCHED and reported; the parser never
  throws into the pipeline. ⚠️ **Array formulas carry NO marker after conversion** (no `t:"array"`,
  no braces) — detect BY SHAPE (`MATCH(1,(a=x)*(b=y),0)`).
- **ENGINE CAUTIONS #3-#5 (PW-2b-i, all found only by live Tier-3, all invisible to a green suite):**
  **(3)** a boolean literal poisons the cell — `,FALSE)` returns `#NAME?`, so every generated VLOOKUP
  emits `,0)`. **(4)** **LuckyExcel emits numeric cell values as UNTYPED STRINGS** (`{v:"1.0"}` with
  no `ct.t === "n"`) which the engine normalizes to `1` on load — **never trust `ct.t` on converted
  (pre-load) celldata**; canonicalize by SHAPE (`NUMERIC_LIKE`), which is what keeps helper keys
  matching the engine's runtime key. **(5)** **the engine evaluates ALL IF branches and propagates any
  branch's error** — it does not short-circuit — so generated lookups inside IF/IFS branches are
  wrapped in `IFERROR`; standalone lookups stay bare and honest. ⚠️ **The fallback token must not be
  error-spelled**: the engine coerces the literal `"#N/A"` back into the #N/A error
  (`ISTEXT("#N/A")` is `false`), re-poisoning the very IF the wrap protects. The token is `"n/a"`
  (`ISTEXT` true, survives concatenation, still reads as a miss).
- **Helper columns follow the FIXED workbooks' own convention:** `_mk` marker in the header row, key
  `=A2&"|"&B2`, value mirroring the result column, pair allocated at `maxCol + 2`, hidden via
  `config.colhidden`. **Each helper cell carries `f` AND a pipeline-computed `v`** — the engine never
  evaluates at load (FR-6), so a bare formula reads blank and every lookup returns `#N/A`. A source
  cell that is itself an unevaluated formula yields an EMPTY key for that row, never a partial key
  that could match the wrong record. `_mk` is also the IDEMPOTENCY marker (snapshot which sheets have
  it BEFORE writing, or the first pair you write hides every later pair on that sheet).
- **Criterion-range harmonization (owner-directed):** when the criterion + result ranges share a start
  row and a strict MAJORITY span, an outlier whose END differs by <= `MAX_HARMONIZE_ROWS` (2) is
  pulled onto the consensus and reported as class `harmonized`. A tie, a differing start row, or a
  larger gap still abstains — those bounds are what keep it a typo-fixer rather than a guesser.
- ⚠️ **Testing lesson (PW-2b-i):** the Tier-1 tests assert the emitted formula TEXT, which is correct,
  and they structurally **cannot** see that the engine mis-reads that text at runtime. Cautions 3, 4
  and 5 were all invisible to a fully green suite. **Anything about engine SEMANTICS must be proven
  in a live Tier-3 run.**
- **Consent-based live fix (`pricingLiveFix.ts`, PW-2b-ii + PW-2d).** `[Fix]` eligibility is DERIVED, not a
  hand-kept class list: `assessFix` runs the hit through `transformFormula`; a **helper-FREE** rewrite
  (`helpers.length === 0`, or a dead-Google `freeze`) is fixed in the LIVE engine; a **helper-CLASS** rewrite
  (multi-cond INDEX/MATCH) is fixed OFFLINE at save (below). Live writes mirror FR-6 (`setCellValue` with the
  plain STRING) and go through **`withSheetActive`** — activate the hit's sheet, write, restore the prior active
  sheet. ⚠️ **ENGINE CAUTION #6 (owner-locked):** `setCellValue` on a NON-active sheet CORRUPTS it — a bulk write
  rebuilds that sheet's cell store from an incomplete grid and DROPS every unrendered row (proven: a live
  Termination table went 154 rows → 0 and the save persisted the gutted sheet). NEVER write a non-active sheet;
  `withSheetActive` is the guard (`setSheetActive` is synchronous — no render-await). The import report is a
  receipt (`ImportReportDialog.tsx`), `lastReport` session-only. ⚠️ **Backend `_prune_versions` deletes via raw
  `frappe.db.delete`, NOT `delete_doc`** — a list-shaped version doc otherwise trips the list-valued-JSON load
  wall on the 21st save; every save-shaped path on an array-`workbook_json` doc avoids `doc.save()`/`delete_doc`.
- **Save-time helper-class fix + single-action dialog (`pricingLiveFix.ts` / `pricingHitEval.ts`, PW-2d — Option 3).**
  The advisory dialog is Cancel + ONE primary action: **"Fix all & save"** when any hit is fixable (helper-free AND
  helper-class ride the same click), **"Save anyway"** when hits exist but none fixable, **"Save"** at zero hits;
  each row shows **"will be fixed"** / **"no automatic fix — saved as-is"** (`isAutoFixable` = helper-free OR
  `REASON_NEEDS_HELPER`). Helper-class hits are fixed **OFFLINE on the serialized payload** — `materializeHelpers({force:true})`
  writes the pairs into `celldata` with computed values + `config.colhidden`, each hit gets its rewritten VLOOKUP,
  then ONE save, then `requestSheet(fixedSheets,true)` re-inits so `create()` renders the stored values. **NEVER via
  live `setCellValue` on the (usually non-active) table sheet (CAUTION #6), and NEVER `refreshFormula()` — ⚠️ ENGINE
  CAUTION #7:** a global recompute force-evaluates every formula and cascades `#NAME?` (the engine renders Excel's
  cached values on load, FR-6), and a `setCellValue` re-entry of the rewritten hit THROWS (it rejects a VLOOKUP whose
  key is a `&`-concatenation). **FIXED-CELL DISPLAY (owner call):** `pricingHitEval.computeHitValueExact` stores the
  hit's value **only where it resolves EXACTLY** against the just-built helpers (VLOOKUP dict lookup, resolvable refs,
  `& + - * /`, `ROUND*` with integer digits) — anything else (IF/IFS/IFERROR/branch, unknown fn, missing ref, VLOOKUP
  miss) leaves the cell BLANK (recomputes on the next edit). **Stored `f` always correct; `v` exact-or-absent — NEVER
  an approximation** (a wrong cached `v` would display wrong until a recalc). The report labels each row **"value
  computed"** vs **"blank until recalc"**; `canonicalizeCellValue` (pricingHelpers) is the SINGLE source for the
  criterion/key canonicalization so an offline VLOOKUP key matches the materialized helper key by construction.
- **Save-time formula advisory (`pricingFormulaScan.ts`, PW-2a) is WARN-ONLY and PURE.** Scans
  `sheets[].celldata[].v.f` **after `serializeSheets`** so it sees exactly what will be persisted. Flags INDEX
  anywhere (ENGINE CAUTION #1 — `=INDEX(r,2)*2` silently returns 0), the engine-absent `XLOOKUP`/`IFS`/`LET`,
  and any name outside `window.luckysheet_function` (a plain object keyed by UPPERCASE name, 371 entries;
  `supportedFunctionsFromEngine` returns null when it is missing/implausible and the unknown-name rule is then
  **skipped — fail-OPEN**, never warn-on-everything). Detection strips BOTH `"..."` literals and `'...'`
  sheet-name references before matching `identifier(`, so `="INDEX of items"` and a sheet named
  `'Sheet (old)'` are not flagged. `handleSaveClick` scans then opens the dialog; `performSave` posts the
  ALREADY-SCANNED sheets so Continue never re-runs the 400 ms re-entry pass. Keep the module side-effect free —
  PW-2b's consent-based fixing is meant to be a caller change, not a rewrite.

### Rate Master (RM-2) -- Frontend Conventions

The pricing helper's read surface, SEPARATE from the pricing workbook pages. Lives in
`src/pages/pricing/rate-master/`. Reads the RM-1 endpoints (`nirmaan_stack.api.boq.rate_master.
get_rate_master_items` / `get_rate_category_config`) as-is -- NO backend coupling. Full as-built lives
in the plan doc.

- **The page home is owner option (a):** a `Rate Master` route (`/rate-master`) beside the pricing
  workbooks, `PricingRoute`-guarded (UI gate only; the endpoints' login requirement is the enforcement),
  lazy + `export { RateMasterPage as Component }`. `rateMasterRegistry.ts` is registry-shaped like
  `pricingWorkbooks.ts` (Electrical today); the sidebar registration is the SAME four registry-driven
  touches the pricing workbooks use (role-gated item, `allKeys`, `groupMappings`, flat-label Set).
- **`ratePipelineInterpreter.ts` is THE single compute source (owner-locked) -- a PURE TS module with NO
  React imports.** It executes the stored pipeline step vocabulary (`match_master_row`,
  `apply_effective_multiplier` with conditions, `scale`, `component`, `component_band`, `sum_components`,
  `install_as_ratio`, `roundup`) and produces per-step traces + finals. **Formulas are read FROM the
  config and evaluated by a tiny safe arithmetic evaluator (no `eval()`, CSP-safe) -- never hardcode the
  arithmetic.** EXACT matching on canonical values (no case-insensitive matching anywhere). **RM-3's
  pricer-facing helper consumes this module UNCHANGED -- there must never be a second implementation of
  this arithmetic.** The four RM-1 goldens are its standing test fixtures.
- **Dynamic columns come FROM the config's `attribute_definitions`** (kind, brand, one column per
  definition, the rate fields present, unit, source) -- never a hardcoded column list.
- **Unknown step type = an explicit "unsupported" state, never a silent skip** (forward-compat honesty for
  future step types). A combination with no master row renders an honest no-match with zero computed values.
- **`runPipeline` NEVER throws on data shape (EA-DIFF Option C, owner-locked):** the step loop is wrapped so a
  data-shape formula throw (an unbound identifier / malformed expression -- e.g. a `scale` step carrying
  `conditions`, a shape only `component` binds) DEGRADES to the honest `unsupported` status for that pipeline;
  the Derivation tab AND the pricing helper render the honest state and NEVER hit the React error boundary. A
  well-formed pipeline is byte-unaffected. Contract enforcement, not new vocabulary.
- **Data-Viewer empty-scope rule (EA-DIFF, owner ADDENDUM):** a category whose resolved kind set is EMPTY
  (declared `item_kinds:[]` AND no pipeline-derivable kind -- `point_wiring`, the first kind-less category)
  renders an HONEST EMPTY STATE (0 items, no kind chips, no Add-row, a "no data rows of its own" note) via the
  pure `rateMasterStructure.isCategoryDataScopeEmpty(config)`. It MUST NEVER fall through to the discipline-wide
  all-items list (the pre-EA-DIFF `: items` fallback surfaced all rows with mixed columns). LMS
  (`item_kinds:["lms_item"]`, empty pipelines) resolves a kind -> UNCHANGED.
- **BCS pipelines ARE shown here** (internal transparency surface); only the pricer-facing helper defers BCS.
- **The viewer search is CASE-SENSITIVE across all displayed cell values** -- the data is canonical
  UPPERCASE, so a mixed-case query intentionally finds nothing (mirrors the RM ethos: no case-insensitive
  matching anywhere).
- **RM-4a editing is ADMIN-ONLY (owner option (a); full detail in the plan doc's "Build slice RM-4a").**
  Estimates sees everything READ-ONLY -- every edit affordance is `{isAdmin && ...}` (HIDDEN, never
  disabled), gated by the pure `isRateMasterAdmin(role, userId)` in `rateMasterEdit.ts` (mirrors
  `canAdminOverride` / the server `_is_nirmaan_admin`; false while `role` is "Loading"/"Error"). The server
  (four `api/boq/rate_master.py` write endpoints) is authoritative. **PARAM VALUES ONLY** -- pipeline
  STRUCTURE / condition / attribute-definition editing is RM-4b. **Derivation tab:** each NUMERIC param in a
  step's `detail` cell is an inline edit (`InlineParamEdit`: pencil -> input, Enter saves / Escape cancels);
  the condition `when` + string params (e.g. `kind`) stay read-only. The matched-condition path is
  re-derived by `matchedConditionIndex` (config + matched item, EXACTLY as the interpreter matches) so the
  interpreter is NEVER touched. **Data tab:** an admin ACTIONS column (inline row rate/attr edit; deactivate
  via AlertDialog confirm -- freeze-and-supersede, dropped from active view, NEVER deleted) + an `AddItemDialog`
  built from the attribute definitions + rate keys; manual rows carry "Manual entry" provenance. Each write
  refetches its collection so the derivation/viewer recompute live -- and the persistence split carries the
  edit into the next pricing-panel compute with NO AI re-run. The interpreter goldens stay the invariant any
  edit must still reproduce after an edit-and-revert.
- **Data Viewer per-column-header faceted filters (`RateMasterDataViewer.tsx`):** EVERY column header
  (kind / brand / every category attribute / every rate key / unit / source sheet / row) carries a filter
  funnel opening a `ColumnFilter` Popover -- a type-to-search box over that column's DISTINCT values + a
  checkbox multi-select. A unified `columns` model (`{key, get}`) is the SINGLE source for both the
  distinct-values dropdowns (`distinctByColumn`) and the row predicate (`getForColumn`), so headers and
  filtering never drift. Composition: **AND across columns, OR within a column**; a global `Clear filters (N)`
  control shows the active-column count and resets. Purely CLIENT-SIDE over the already-loaded active items
  -- no new query, no backend change, read-only (composes cleanly with the RM-4a admin editing above).
- **Data Viewer is CATEGORY-SCOPED (`RateMasterDataViewer.tsx`, owner-locked).** The tab shows ONLY the
  selected category's items + columns. The category's kinds come from `categoryItemKinds(config)`
  (`rateMasterStructure.ts`, pure + vitested): the config's declared `item_kinds` if present, ELSE derived
  from the pipelines' `match_master_row` params (the legacy wiring config predates item_kinds ->
  {cable, termination}). `scopedItems = items.filter(kind in categoryKinds)` drives every derivation (rate
  columns first-seen over ITS items, kind chips, filters, the count badge). The KIND column + chips render
  ONLY when the category spans >1 kind. **A top-level `item_kinds` config key is accepted by the RM-4b
  `_validate_config` allowlist** (else editing an E-ALL config would break). **Actions column is FIRST and
  `sticky left-0`** (visible at any H-scroll); admin hide-not-disable is unchanged -- a non-admin renders NO
  actions column (no ghost gutter). **The always-visible horizontal scrollbar is the RM-3b PROXY pattern**
  (from `PricingGrid.tsx`, now the STANDING single-bar rule for ALL wide tables): the real scroller
  suppresses its native H-bar (a `*-hidehbar` webkit CSS class, X-scroll capability kept) and a sticky-bottom
  proxy mirrors its `scrollLeft` two-way, with the proxy's visible width == the scroller's `clientWidth`
  (V-bar leak accounted) and a spacer == `scrollWidth`, both live-measured via a ResizeObserver;
  `border-t`-only on the proxy so proxyMax == scrollerMax. The Add-row form is likewise category-scoped (its
  attribute definitions + rate keys + kind preselected read-only for one kind, a select for several).
- **RM-4b structure editor -- the THIRD tab "Pipelines" (`RateMasterPipelines.tsx` + `rateMasterStructure.ts`).**
  LIFTS the RM-4a param-values-only line: add/remove params, steps, conditions, and attribute definitions.
  READ-ONLY structural view for everyone (attribute-definitions table + each pipeline as its ordered step
  list + the stored goldens); ADMIN EDIT MODE (owner option (a): hide-not-disable) with step
  add(vocabulary picker)/remove/reorder, per-step param add/remove/rename, condition-branch + component-band
  add/remove/edit, attribute-definition add/edit/remove (a referenced def's remove button DISABLES via the
  client mirror `referencedAttrIds`; the server guard's verbatim error still surfaces on save), and the
  brand `selector` flag as an editable checkbox. **THE PREVIEW GATE (`rateMasterStructure.ts`, pure +
  vitested):** before save the page computes ALL config goldens against the DRAFT (the SAME pure
  `ratePipelineInterpreter` + live items) and shows a pass/delta table; unchanged -> green "Save", any delta
  -> "Save with N changed goldens" opening an AlertDialog that lists the deltas and requires an explicit
  confirm (**confirm-NOT-block** -- deltas impossible to miss, never forbidden). `evaluateGoldens` WRAPS the
  interpreter in try/catch so a transiently invalid draft reports `got=null` instead of crashing the preview
  (it does NOT change the interpreter). Save calls `update_rate_config` (the server re-validates -- the
  authority); the refetch flows the new structure into the Derivation + Data tabs and the pricing helper
  with no code + no AI re-run (persistence split). **Goldens are CONFIG DATA** seeded via the endpoint; the
  vitest golden files stay independent pins. Full as-built + cert: plan doc "Build slice RM-4b".
- **Interpreter step vocabulary (owner-locked, MINIMAL; full detail in the plan doc's "Build slice EA-1").**
  The pure `ratePipelineInterpreter.ts` is the SINGLE compute source; there is NO loose-formula
  generalization (that is how silently-wrong sneaks in) — the stored configs normalize every formula to
  `base` = the step's target value + EXACT param names. Beyond the wiring set it supports: `component_band`
  STRING-EQUALITY bands (`chooseBand`; band_on read from the matched item, falling back to the selection)
  alongside the legacy numeric comparator bands; a `scale` value-from-attribute multiply (a `*_from_attr`
  param binds the selected attribute — missing/non-numeric → HONEST `no_match`, never a zero default);
  `match_master_row` on the stored-vs-selected INTERSECTION (a row matches on the keys it carries, exact
  where they overlap — wiring is byte-unchanged); a conditional `component` (params via attribute
  conditions on the SELECTION, formula may be param-only — unmatched → HONEST no-compute, never a zero
  adder). **A `component` may carry BOTH a `target` (base bound from the matched row) AND `conditions`
  (params from the selection) in one step** — e.g. the tray `cover` (`base*factor`); this shape needed no
  interpreter change. **EA-2b — the CORRECTED cable-tray config is FOUR pipelines** (`tray_boq_supply` /
  `tray_boq_install` / `tray_bcs` / `tray_bcs_install`): conditional-`component` adders (cover /
  ceiling-accessories 106 / refill 180 / cutting 200) + a **width-table install match** (kind
  `tray_install_rate`, ×4). The old single `tray_boq` (install = supply ×0.2, golden 280/60) was WRONG and
  is DELETED; the oracle goldens t1/t2/t3 (431/120/297/0, 415/120/286, 410/200) are the standing pins (the
  dead 280/60 interpreter-test fixture was replaced). **EA-2c — `component_ref` (a NEW interpreter step):
  base from a SEPARATELY-REFERENCED master row** matched by `ref.kind` AND every `ref.attributes` (exact
  canonical, this discipline); UNIQUE resolution (zero OR multiple -> HONEST no-compute); the referenced
  row's `target` binds as `base`, conditions/params/formula per the component contract; the trace names the
  referenced row (`StepTrace.refItem`, rendered by `detailFor`). First-class vocabulary member
  (STEP_VOCABULARY + blankStep + the server validator). **Owner: the earthing adder ADDS A BUS BAR (the
  existing Bus bar earthing_item row), NOT an earth chamber** (the chamber attempt was reverted; asset
  skipped v8, v7->v9). ONE ROW, TWO ROLES: the Bus bar row prices both as a selectable item AND as the
  adder; an edit flows into both. **component_ref is the ASSEMBLY PRIMITIVE's simplest form.** **EA-4a
  SHIPPED the assembly engine (owner-locked, `ratePipelineInterpreter.ts`):** `circuit_fit` (sizes conduit +
  counts circuits, binds `fitted_size`/`circuits`/`conduit_qty`) and `component_ref` extended (ref attrs
  literal | `@attr` | `@fitted_size`; `rate_stages [{mult,round?:up0|up-1}]` with PER-STAGE rounding; `qty` =
  number | `{from_attr}` | `{from_fit}` | `{if_attr,then,else}`; UNIQUE resolution else honest no-compute;
  Option-C never-throws). **PER-STAGE rounding is faithful + INTENTIONAL** (install switch `ceil(list*0.3625)`
  THEN `*0.2` UNROUNDED — pw1 `155*0.2=31`, pw2 White `131*0.2=26.2`); never collapse to one final round.
  **`point_wiring` is LIVE**; goldens **pw1 1869/735/1370** + **pw2 1823/722.2/1342** (MS→3 circuits;
  fractional 722.2) are config data + standing pins, and a golden's attrs are an ATOMIC SET. **`values_from`
  is resolved in the editor helper too (owner Option 1):** `pricingSheetHelper.attributeOptions` (pure,
  exported) mirrors the Derivation resolution — options from the live master by `kind` + `where` — so an
  AI-extracted item with no static `values` DISPLAYS in the panel select and a partial row completes from the
  catalog (the switch/socket/plate dropdowns were empty before). **EA-4a-r SHIPPED the NONE mechanism
  (owner-locked):** the sentinel string `"None"` (`NONE_SENTINEL`, exported from `ratePipelineInterpreter`) is
  POSITIVE ABSENCE, distinct from blank=unknown -> that component line is an EXPLICIT ZERO. A `component_ref`
  `none_skips` zeroes a line whose ref binds an `@attr`=="None" (fired before the ref lookup; back_box binds
  @plate_item, so plate=None zeroes it too); `circuit_fit.optional_wire_when_none` drops that wire from the dia
  (single-wire fit). **The affordance is GENERIC + input-appropriate:** a CHOICE allow_none def offers "None" at
  the top of its select (`optionsFor`/`attributeOptions`); a NUMBER allow_none def offers a "None" CHECKBOX
  beside the numeric input (checked -> sentinel + input greys/clears) -- both in RateMaster Derivation AND the
  editor panel; `WorkingsAttribute` gained `disabled` + `allowNone`. `coerceForMatch` PRESERVES "None" for an
  allow_none def (number included). Selecting None greys+clears the `disables_when_none` targets. Goldens: pw3
  (socket="None") -> supply 1682; single-wire (wire2="None") -> 1362. **A switch-only light point (socket_item
  null, no None set) is an HONEST NON-COMPUTE — became priceable via the None sentinel at EA-4a-r.** **EA-4b
  SHIPPED switches_point + the industrial_sockets paired-MCB (DATA-ONLY, no interpreter change):**
  `switches_point` = a 6-line switch/socket/plate/box assembly (TWO None-able socket slots, distinct from
  point_wiring; golden sp1 2320/470/1600; a new registry line "Switches Point"); `industrial_sockets` gained a
  CROSS-CATEGORY `paired_mcb` `component_ref` (ref.kind `db_switchgear_item`) gated by a `qty if_attr`
  interlocked rule, with `extraction_defaults={paired_mcb:"None"}` so a socket-only row prices (absent=unknown
  ->no_match; "None"=positive-absence->0). Tray ceiling-accessories = a CONFIRMED FIXED 106 scalar. **switches_point
  has ZERO production coverage until the Electrical CLASSIFIER emits it (rows resolve to switches_sockets today) --
  a classifier-vocab gap like popup_boxes/LMS; industrial_sockets IS emitted.** **EA-4c SHIPPED the DB build-up +
  the `lookup_or_ratio` interpreter step (owner-ruled ONE new capability):** the build-up is FIVE FIXED None-able
  MCB slots (sheet I10:I14) + a `db_shell` slot (allow_none -- **MCB-only, shell None, is a REAL product = the
  sheet's `IF(J9=0)` branch**) + enclosure, summed x0.495/x0.3 -- supply+bcs are EXISTING vocabulary
  (`component_ref none_skips` cross-kind to the NEW `db_shell` kind), so the old "variable-length list + list
  extraction extension" prediction was WRONG (the scalar payload carries the fixed slots, no extension). **`lookup_or_ratio`**
  (in `ratePipelineInterpreter.ts`; `LookupOrRatioStep` in `rateMasterTypes.ts`; `STEP_VOCABULARY` in
  `rateMasterStructure.ts`) is the sheet's EXACT IFERROR three-way install: shell absent (`when_shell_absent.attr=="None"`)
  -> `ROUNDUP(ratio.of x mult)`; else the unique install-table lookup (`kind`+`item`==`@attr`) resolves -> `ROUNDUP(matched[target] x mult)`
  [table-hit]; lookup MISS -> the ratio fallback. Uncomputed `ratio.of` -> honest no_match; malformed shape NEVER throws
  (Option C -> `unsupported`); the trace NAMES the branch. Goldens dbu1 (VTPN fallback 24360/**3660**/14760) / dbu2 (TPN 8WAY
  table-hit install **1500**) / dbu3 (MCB-only shell None 23840/**3580**/14450) -- all live-verified in the Derivation. **This
  CLOSES the assembly-category arc.** A discarded v16b data-only attempt (shell REQUIRED, no none_skips) was reverted for the
  owner ruling that MCB-only is real. **EA-4d (owner-locked) SPLIT the `lookup_or_ratio` rounding: `round_lookup`
  (the install-table-hit branch) + `round_ratio` (the shell-absent + IFERROR-fallback ratio branches) round
  SEPARATELY; the legacy single `round` stays the fallback for both (backwards-compat).** v17's step sets
  `round_lookup: null` -> the table-hit is UNROUNDED `matched[target] x mult` (sheet-faithful), while
  `round_ratio: -1` rounds the ratio branches to tens. This corrected the EA-4c drift: **dbu4 TPN-6WAY table-hit
  install `850 x 1.5` = 1275 UNROUNDED** (was over-rounded to 1280); goldens are now dbu1 (fallback 24360/3660/
  14760) / dbu2 (TPN-8WAY table-hit 1500) / **dbu4 (TPN-6WAY 1275)**, d1/d2/dbu3-single-item removed. **The wiring + point_wiring + switches_point + DB-build-up goldens are the standing regression pins for every addition.** The Rate Master
  category selector is REGISTRY-driven (`rateMasterRegistry.ts` lists all eleven Electrical categories),
  NOT config-read. **`module_fit` (owner-locked) computes a row's MODULE COUNT in the PIPELINE, never by
  the model** — a model-selected plate leaves NO trace, and the trace is the point: the step emits the
  arithmetic AND the ladder hop on one line, because a price must show its working. **Its weighted sum is
  CONFIG (weights AND attribute ids), never hardcoded** — `switches_sockets` has TWO socket slots and
  `point_wiring` has one, so a fixed two-attribute formula is not portable. **Its ladders derive from the
  CATALOG, never from a params array** (a ladder spec names a `kind` + a `where` family and carries no size
  list, so adding/retiring a plate size needs no config edit): EXACT if the catalog carries the size, else
  the **NEXT HIGHER**, never a lower one. **`"1M & 2M"` is ONE item covering TWO sizes** (every integer in a
  rung's label is a covered size), so a computed 1 and a computed 2 both match it on the ordinary exact
  path. Above the ladder's top is an HONEST NO-COMPUTE, NEVER clamped to the largest rung (a DELIBERATE
  divergence from `circuit_fit`, which falls back to its largest size but then re-checks `circuits <= 0`;
  `module_fit` has no second gate). A ladder's fitted LABEL binds for a later `component_ref` `"@<bind>"`
  exactly as `circuit_fit` binds `fitted_size`; label bindings live in their OWN scope resolved ahead of
  the selection, and every pipeline without a `module_fit` stays byte-identical.
  **TAKE-THE-LARGER (owner-locked; REPLACES the earlier stated-wins rule):** a ladder's `floor_from` names
  the attribute whose stated count is a **FLOOR, never a ceiling** — the plate priced is
  `max(stated, computed)`, so a stated plate too small for its contents is **UPGRADED** rather than
  refusing the row (a BoQ typo must not kill a line), and a stated plate bigger than needed is bought.
  **An UPGRADE MUST ALWAYS BE VISIBLE in the trace.** **Blanks derive from the plate ACTUALLY SELECTED and
  CLAMP AT ZERO**, never negative and never a refusal; the clamp is named in the trace too.
  **The BACK BOX takes the SELECTED plate's module COUNT re-fitted on its OWN (shorter) ladder — NEVER the
  plate's label:** no 9M/16M back box exists, so a 9M plate pairs with a **12M** box and 16M with **18M**,
  and copying the label made the WHOLE ROW unpriceable (a live defect before slice 2 part 2). A `"None"`
  plate keeps the plate line at ZERO while only the BOX takes the computed count — a box may exist with no
  face plate.
  **THE BLANKER'S COLOUR FOLLOWS THE ASSEMBLY and is NEVER hardcoded (owner-locked).** The blank
  component's ref binds `colour: "@colour"` like every other component, so a Grey assembly prices the
  Grey blanker and a White one the White blanker — a REAL price difference, not cosmetic. A hardcoded
  colour does NOT fail at runtime; it silently prices the wrong catalog row, which is why the guard is
  a PIN (the price path, never the colour string) rather than a code check. `1M Blanker` is the only
  blanker in the catalog, so the colour is the sole free variable on that line.
- **`blank_qty` is DERIVED and READ-ONLY — the COMPUTED count always wins and a stated one is ignored
  (owner-locked).** The blank line takes `qty: {from_fit: "blank_count"}`, so the attribute is no
  longer an input and must not render as one. **The derived-ness is READ FROM THE EXISTING CONFIG, not
  a new key and never hardcoded by attribute id:** a component taking `{from_fit}` has SUPERSEDED its
  `<name>_qty` attribute, while one taking `{from_attr}` still reads it — which is what makes
  `switches_point` (still on `from_attr`) opt out automatically, and hardcoding by id would have
  frozen a field that is genuinely editable there. An attribute read as an input ANYWHERE is never
  derived. **⚠️ A DERIVED DISPLAY MUST NEVER BE WRITTEN BACK INTO THE FORM'S STATE** — `selected`
  means "what the user or extraction supplied", and writing a computed value into it makes the two
  indistinguishable to every later reader. Display it from the pipeline results and leave the state
  alone; because the screen already recomputes every pipeline on every attribute change, live updating
  needs no extra machinery. An uncomputed value renders EMPTY, never 0 — with a None plate there are
  no blanks at all, and 0 would claim "zero needed" instead of "not applicable". **EA-2: the pricing-sheet helper (`pricingSheetHelper.ts`) is N-CATEGORY** — it resolves
  the config PER row category (`configsByCategory`, fetched by a child `RateConfigFetcher` for all 11
  registry categories in `SheetPricingPage.tsx`); a category with no ELIGIBLE config (pipelines + defs, so
  an empty-pipelines LMS is excluded) returns the `{kind:"none", "…coming soon."}` guard. Groups render ONE
  per NON-BCS pipeline (ids containing "bcs" NEVER surface), labelled `config.pipeline_labels?.[id]` (config
  data) else `prettifyPipelineId(id)`; `values` come from the FIRST non-BCS pipeline. **The `wiring_cabling`
  paired Cable+Termination display stays a TEMPORARY named-category special-case (owner Decision 2) — EA-4
  designs the generic pairing/assembly mechanism and wiring migrates then; do NOT extend it.** The helper
  Deps accept EITHER a single `config` (legacy RM-3 tests) OR `configsByCategory`; keep the memo shield
  (every grid input identity-stable). **HONEST-PARTIAL (owner-locked):** a `scale` step whose target rate is missing
  (`null`/`NaN`) SKIPS that output (it stays absent, renders `-`), NEVER inventing a 0; the pipeline's other
  outputs still compute — so a source row carrying supply but not install (or vice-versa; the misc CEIG /
  AS Built rows) prices only what exists. **Empty-pipelines configs render honestly with ZERO frontend
  changes:** a config with `pipelines: {}` (a DATA-ONLY category such as `lighting_mgmt_system`, authored
  in-system later) shows its data + attribute definitions on the Data / Derivation / Pipelines tabs and the
  preview gate with no derivation output and no crash. **EA-2 SHIPPED the authoring path:** the Pipelines-tab
  edit mode has an **Add-pipeline** control (validated id + output keys -> a validator-minimal pipeline via
  `blankPipeline`, seeded with `match_master_row`), so a NEW pipeline can be authored into an empty config;
  the RM-4b `distinctNumberValues` datalist makes number attributes (e.g. module_count) a free numeric input
  in the Derivation tab; and the Data-Viewer header row is sticky-top (a scoped `<style>` forces `top:0`
  because a global Ant Design table reset overrides Tailwind's `top-0`).

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
- **Invoice Qty (`Purchase Order Item.invoice_qty`)**: derived "how much of each PO line is invoiced", recomputed from Vendor Invoice Line mappings on every invoice event. FULL architecture (recompute classifier EXACT/TRUSTED-FULL/ORDERED-FB/ZERO — partial/unmapped POs fall back to **ordered qty**, owner 2026-07-22; one-time backfill + Gemini extraction + cache, credit notes, Additional Charges, Resolve UI, gotchas) → **`../.claude/context/domain/invoice-qty.md`**. The frontend surfaces + who can use them:

  | Surface | File | Frontend gate | Backend gate |
  |---|---|---|---|
  | Add Invoice / **Add Credit** buttons | `invoices-and-dcs/DocumentAttachments.tsx` (PO); `service-request/SRAttachments.tsx` (SR, **no Add Credit**) | shown unless `isEstimatesExecutive` | `update_invoice_data` |
  | Edit invoice (pencil) | `DocumentAttachments.tsx` (`onEditEntry`) | `isAccountant` = Accountant · Accountant Lead · **Admin** | `update_invoice_data` |
  | Edit AI mapping on an **Approved** PO invoice | `InvoiceDialog.tsx` (`canReExtract`) | Pending → anyone who can edit; **Approved → Nirmaan Admin only** (`isNirmaanAdmin`) | `_admin_can_rebuild` (Pending OR Nirmaan Admin) |
  | **Resolve Invoices** page `/resolve-invoices` | `pages/temp/ResolveInvoices.tsx` | route `AdminRoute` + in-page `isAdmin` (**Administrator \| Nirmaan Admin Profile**) | `temp_resolve._require_admin` (same set) |

- **Add Invoice vs Add Credit (PO only)**: the entry **button** decides `is_credit_note` (Add Credit = 1, `+` icon); the `InvoiceDialog` Credit-Note checkbox is a **read-only indicator shown ONLY in Edit mode** (hidden in Add). A credit note pins an amber warning at the top ("won't affect the PO's invoiced quantity"), stores a **negative** amount, and is excluded from `invoice_qty`. **SR shows "Add Invoice" only** and always opens non-credit (guard: `docType === "Procurement Orders" ? flag : false`). Sign logic in the autofill callback: `is_credit_note` → amount negative; `is_credit_note=false` **+ Gemini-detected credit** → amount **and** qty negative (return note). ⚠️ the autofill `useCallback` MUST list `invoiceData.is_credit_note` in deps (stale-closure else). `newInvoiceIsCredit` lives in `useDialogStore`.
- **Resolve Invoices** is **Nirmaan Admin only** (PMO can reach the `AdminRoute` route but the page shows "Admin only" — `isAdmin` excludes PMO, matching the backend). Analyze (Gemini, read-only on the file) → correct mapping/qty → Save → optimistic card removal. Naming (`temp_resolve` / `pages/temp`) is legacy; the feature is permanent.
- **`LineItemMappingReview`** (`invoices-and-dcs/components/`): the SHARED invoice-line → PO-item review table (Add/Edit dialog **and** Resolve UI). Line qty editable via the opt-in **`editableQty`** prop. **Radix gotcha:** the portalled react-select menu needs `styles.menuPortal = { ...base, pointerEvents: "auto" }` — a modal Radix dialog sets `pointer-events:none` outside itself, so without it options are keyboard-only. Any `lazy()` route (like `/resolve-invoices`) MUST be wrapped in `<Suspense fallback={null}>` or it throws "component suspended while responding to synchronous input".
- **PO Adjustments**: Decoupled payment reconciliation system (`src/pages/POAdjustment/`). Revision approval auto-creates `PO Adjustments` doc tracking financial impact; negative diffs with remaining balance show "Adjust Payments" button on PO detail. Three PUSH methods: Against-PO, Ad-hoc expense, Vendor Refund. Pending adjustments lock PO payments. **PULL flow (2026-06):** a top-of-PO `VendorCreditSummaryCard` shows the vendor's overpaid-credit pool across all its POs ("₹X across N POs", vendor-scoped + cross-project) and "Apply to this PO" pulls it into the current PO (`apply_vendor_credit_to_po`); push & pull both take `FOR UPDATE` row locks (`_lock_and_assert_source_credit` / `_lock_and_assert_dest_capacity`) so the same credit can't be double-spent. See `.claude/context/domain/po-adjustments.md` for full docs + `docs/adr/0007-vendor-scoped-credit-application.md`.
- **PO Revision simplified to 2 steps**: Item editing + Summary (Step 2 financial allocation removed). Payment reconciliation handled by PO Adjustments system post-approval. See `.claude/context/domain/po-revisions.md`.
- **Loss Justification (high-loss items, PR + SB)**: a per-item reason required when **Loss % > 10%** (strict). Shared helper `src/utils/lossPercent.ts` (`computeLossPercent(savingLoss, benchmark)` + `isHighLoss` + `LOSS_THRESHOLD_PERCENT = 10`) is the SINGLE source of the rule — use it on every surface; never re-derive the threshold inline. **Capture (procurement enters + gate):** `VendorsSelectionSummary.tsx` (PR) + `Sent Back Requests/SBQuotesSelectionReview.tsx` (SB) — a "Reason (required)" textarea on each >10% item keyed by the `order_list` child-row `name`; Send-for-Approval disabled until all high-loss items are justified. PR sends `loss_justifications` in the `send_vendor_quotes` postcall; SB has no send endpoint so it persists the FULL `order_list` (justifications merged) via `updateDoc("Sent Back Category", ...)` — must send the whole child array (replace-all; omitting rows deletes them). **Approval (read-only display + backstop):** shared `ApproveVendorQuotes/components/VendorApprovalTable.tsx` shows Loss % in the Savings/Loss column + a light-red "Reason:" chip under the item name; both approve hooks (`useApproveRejectLogic.ts`, `useApproveSBSLogic.ts`) compute `lossPercent` with the **Target-prioritized** benchmark (NOT the `min(Target,L1)` used by the existing ₹ Savings/Loss column — see root CLAUDE.md GOTCHA 2) and block approval of a selected >10% item with no reason (Send Back is the escape hatch). `loss_justification` rides PR rows via `...prItem` spread but is mapped EXPLICITLY in the SB hook (it builds the display item field-by-field). Scope/rationale: `docs/adr/0002-loss-justification-scope.md`; terms: root `CONTEXT.md`.
- **Vendor Hold / Credit Management**: Vendors with exhausted credit are marked "On-Hold". **Asymmetric transitions**: On-Hold → Active is real-time (via `recalculate_vendor_credit()` on 9 events); Active → On-Hold is daily cron only (10 AM IST). Credit limit standardized at 50,000. **Admin-only** credit management (PMO removed). Blocks dispatch + payment operations on "PO Approved" POs only — dispatched+ POs get informational banner. Uses `useVendorHoldGuard` (single vendor) and `useVendorHoldVendors` (bulk lookup) hooks. Guard variable: `isVendorHoldBlocked = isVendorOnHold && po?.status === "PO Approved"`. See `.claude/context/domain/vendor-hold.md` for full docs.
- **`useFrappeGetDoc` swrKey gotcha**: Third arg is `swrKey`, NOT options. Use `id ? undefined : null` for conditional fetching — never `{ enabled: !!id }` which breaks SWR cache deduplication.
- **Internal Transfer Memos (ITM)**: Cost-neutral inter-project material transfer launched from the Inventory Item-Wise page. One target project per session → backend groups selections by `source_project` → N ITMs (one per unique source). Admin-only approval. Phase 1 = create + approval + pre-dispatch delete; Phase 2+ adds dispatch / DN polymorphism / Material Usage columns / real-time events. `estimated_rate` is a snapshot at create time (no retroactive revaluation). DO NOT modify the DN schema in Phase 1 — the `parent_doctype` / `parent_docname` polymorphism migration across ~51 consumer sites is a Phase 2 concern. See `.claude/context/domain/internal-transfer-memos.md` for the full reference.
- **Work-package read path (Slice 3f-readback):** Work-package assignments are grandchild rows (BoQ Sheet Draft.work_packages, child of a child of BOQs). Frappe get_doc / useFrappeGetDoc("BOQs") does NOT return grandchildren, so draft.work_packages is always empty on the client. Read assignments via the get_boq_work_packages endpoint instead; both hub and spoke consume it (SheetCard workHeaders prop; SheetConfigPanel workPackages: string[]).
- **`order` field name (Slice 3f-fix):** Never pass order_by on a Frappe field literally named `order` -- it is a PostgreSQL reserved keyword and Frappe's REST list layer does not quote it, producing a 500. Keep `order` in the fields list and sort client-side.
- **ITM DC & MIR**: ITMs in `Partially Delivered` or `Delivered` status can have Delivery Challans + Material Inspection Reports filed against them, parallel to the PO flow. The `PO Delivery Documents` doctype is polymorphic (`parent_doctype` Select + `parent_docname` Dynamic Link). Surfaces with PO/ITM toggle: hub `/prs&milestones/delivery-challans-and-mirs`, project `DC & MIR` tab (sub-tabs for DN > DC Report + DC + MIR), reports `DCs & MIRs` tab. ITM-only: `ITMAttachmentSection` on the ITM detail page. Hub toggle URL-persisted via `parent`; project sub-toggle via `dcmir_parent`; reports toggle via `dcmir_parent`. **PO-only by design** (do NOT mix in ITM rows): Material Usage tab, DN > DC PO report, Bulk Download wizard — all filter by `procurement_order ["is", "set"]`. Mobile cards: `ITMListCards.tsx` mirrors `POListCards.tsx`. Upload dialog `UploadDCMIRDialog` accepts optional `parentDoctype` prop ("Procurement Orders" default, "Internal Transfer Memo" for ITM). `ITMDNDCQuantityReport` is a parent-child grouped reconciliation report (mirrors `DNDCQuantityReport` exactly: parent ITM rows expand to item sub-rows, status rollup, sortable totals, source-project facet, status facet, search, CSV export, info banner, error state). Fetches ITM child items via `get_project_itms` (extended to include items array). PO/ITM toggle UI is a red-active segmented control (mirrors project tab styling). `ITMAttachmentSection` always renders the card when `canView`; only the upload buttons are gated by `canUpload` (status in delivered states) — historical DCs/MIRs never disappear if the ITM moves out of upload-eligible state.

