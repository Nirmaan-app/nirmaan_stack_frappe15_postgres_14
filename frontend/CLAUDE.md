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

**⚠️ A CONTROLLED `<select>` WITH NO MATCHING OPTION DOES NOT GO BLANK — IT FALLS BACK TO THE FIRST
*SELECTABLE* OPTION, SO A DISABLED PLACEHOLDER SILENTLY DISPLAYS A WRONG VALUE (owner-locked).**
React does not assign `.value` on a controlled select; it sets
`option.selected = (option.value === props.value)` per option. When nothing matches, every option
ends unselected, and a single-select must still show something — so the browser picks the first
option the user could have picked. **A `<option value="" disabled>` placeholder is therefore
skipped, and the field displays a real value the row never held**, beside whatever names the true
one. On an `allow_none` def it is worse: the fallback is the `"None"` SENTINEL, a positive decision
the row never made. **Keep every such placeholder SELECTABLE** — blank is then genuinely blank, and
the user can clear any field by hand, which is the standing rule that the user is the ultimate
authority over an attribute value. A blank value needs no special case: it MATCHES the placeholder,
so it already selects it.
⚠️ **This is invisible to `vitest`** — see the DOM note above. The data layer reports the correct
value and option list while the rendered control shows something else, so a green suite proves
nothing here; only a live browser check can see it.

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
(component contracts, per-slice changelog, feat hashes) is in
`frontend/.claude/context/domain/boq-frontend.md` — load it first. Live status = `frontend/.claude/plans/boq-upload-plan.md`.
**Pricing Module + Rate Master frontend detail** (the rate-helper panel's attribute semantics, the workbook pages, the RM-2 screens): `frontend/.claude/context/domain/pricing-rate-master-frontend.md`.

**Docs discipline -- DOCS-UPDATE RULE:** full rule, and the `guard_claude_md.py` hook enforcing it, in root
`CLAUDE.md`. Per-slice / per-commit as-built detail goes to `frontend/.claude/plans/boq-upload-plan.md` +
`boq-frontend.md` + `boq-backend.md` ONLY — never into an always-loaded `CLAUDE.md`.
**Frontend conventions file: `frontend/CLAUDE.md` (NOT `frontend/.claude/CLAUDE.md`).**

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
  hub-scoped. See the wizard-upload surface.
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
  `BOQ_DOWNSTREAM_ORPHAN` confirm are the safety boundary. See the revised-boq surface.

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
- **Revision carry button (owner-locked, ADR-0014 Amendment C + E):** a revision commit carries NOTHING, so
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
  the apply gate is `carryWriteCount(...) === 0` (**R15 deleted `nothingToCarry`**), not `selectedCount === 0`;
  the destructive footer counts rates and layer records **separately** (they are not the same kind of loss); and
  `summarizeSheetCarry`'s "Nothing was carried." branch keys off every axis (a category-only carry is the LIKELIEST
  shape — a revision whose rates all conflict can still take the whole category set). Readiness is still
  `counts.clean + counts.conflict > 0`. Emerald is BANNED inside the dialog — it means priced/succeeded in
  this screen and belongs to the button + the post-apply line.
- **The "carried" verdict state (Amendment E, owner ruling 2026-07-28; inputs corrected 2026-07-30 per R3/R16):**
  `deriveVerdictState` gains `"carried"`, rendered as sky text + `CornerDownRight` + a provenance tooltip. It marks
  **EVERY carried row, machine or human** — provenance is the axis, and "who decided it" does not answer "was this
  inherited?"; the check therefore sits ABOVE the human check. It has **three inputs**, not one:
    - `SheetCategoryRow.carried_from_boq` — the row's origin BoQ. **The STATE still keys on this field alone**, so a
      row is `"carried"` iff this is set; the other two inputs shape the tooltip, never the verdict.
      `resolvedToSheetCategoryRow` MUST pass it through — unlike `cross_engine_conflict`/`review_priority`/`votes`
      (telemetry, deliberately dropped), this is provenance, and dropping it fails SILENTLY (every carried row renders
      as locally decided).
    - `carried_from_version` (R3) — which VERSION a within-BoQ carry came from.
    - `carried_from_other_boq` (R16) — **derived SERVER-SIDE** in `get_sheet_categories_resolved`, not recomputed in
      the client. Do not re-derive cross-BoQ-ness from a string compare in the frontend.
  The tooltip therefore reads **`carried from Version N`** for a within-BoQ carry and **`carried from BOQ-…`** for a
  cross-BoQ one — the two cases are distinguishable, and rendering the BoQ form for both was the pre-R16 bug. Both
  gates built on
  `deriveVerdictState` are unaffected and test-pinned: `isRowEditable` (`!== "unclassified"`, so a carried row stays
  correctable) and `isMasterSetBlank` (`=== "unclassified"`, so an inherited category still opens the rate gate).
  ⚠️ `SheetPricingPage`'s `onApplied` MUST call `mutateCategories()` — Amendment D had removed it as a dead
  round-trip, and that reasoning expired with the layer it was based on.
- **Formula engine arc F1–F4 (COMPLETE):** PURE `amountFormula.ts` (evaluate) + `AmountFormulaBuilder.tsx` /
  `formulaTokens.ts` (author; click-to-insert, NO literals) + `PricingGrid.evaluateAmountCell` (compute;
  formula-wins-else-pairing, draft-aware, fail-safe BLANK on any missing operand — never a stale number).
  `pricingRollup.ts` / `SummaryPanel.tsx` are formula-aware too.
- **The operator vocabulary is `+ − × ÷` (F5), and the last two are NOT like the first two.** `+`/`*` are
  commutative and associative, so an n-ary node's operand ORDER carries no meaning; `-`/`/` fold LEFT TO
  RIGHT from `operands[0]`, so **the list order IS the arithmetic** (`{op:"-",operands:[a,b,c]}` means
  `((a−b)−c)`). Any pass over a stored tree must preserve operand order. A MIXED tier parses
  left-associatively into a binary chain, while a run of ONE operator stays n-ary — that split is what
  keeps every pre-F5 formula's tree **byte-identical** (pinned by test; a re-shaped tree would move
  committed sheets' amounts). ⚠️ **A ZERO DIVISOR IS REFUSED BEFORE THE DIVISION** and reported `broken`
  ("check formula") — never `Infinity` on a tender document; `not_yet` would be wrong, since that reason
  means a value is ABSENT and a real 0 is present. **`amountFormula.foldOperands` is the ONE
  implementation** of all four operators (the BCS Total formula folds through it too) — do not write a
  second. ⚠️ Adding an operator means extending `AmountFormulaBuilder.OP_GLYPH` (a total map, deliberately
  not a ternary) **and** `pricing._FORMULA_OPS` **and** `export_template_workbook._OP_INFIX` — an operator
  missing from that last one exports as a BLANK cell, silently dropping the formula.
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
  reconcile + revert-on-error. The Check-Category filter drops a row once it has a verdict
  (`isMasterSetBlank`). Catalog + labels come from the read-only `get_category_catalog(discipline)` endpoint. The
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
  `deriveVerdictState` + `isMasterSetBlank` render UNCHANGED (blank rows still blank + amber).
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
- **Rate-helper chassis (U1, ALWAYS-ON in production, `rate-helper/`; full detail in the plan doc's "Build slice
  U1"):** the
  "Suggest rates" button + per-cell badges + the page-level panel that renders a typed helper CONTRACT generically
  (`RateHelper.compute -> Suggestion | NoSuggestion`; the panel has ZERO helper-specific rendering — a new helper is
  a registry edit). Load-bearing invariants: (1) **`RATE_HELPER_ENABLED` is a RUNTIME KILL-SWITCH THAT DEFAULTS ON —
  the `import.meta.env.DEV` gate is GONE (owner ruling), so the feature SHIPS in a production `vite build`.** It is
  read at ~21 sites in `SheetPricingPage.tsx` — **16 direct + the three derived `rmEnabled` / `helperPanelOpen` /
  `embeddedPanel`** — NOT the three this note used to name: the button, the four suggestion SWR fetches, the
  run-adoption / badge-rebuild / selection-prune effects, the status poller, the progress modal, the pre-run
  confirmation dialog, the partial-run resume strip, the per-category config fetchers, the grid badge + tick props
  (`rowSuggestionsByExcelRow`/`onSuggestionBadgeClick`/`tickableRows`/`selectedRows`/`onToggleTick`/`onToggleTicked`),
  and BOTH panel mounts. **They flip together ONLY because they all read the ONE module-load-once const — never
  replace a guard site with its own condition, and never make the const per-call** (memo-shield load-bearing; a
  half-gated set yields half-rendered states, e.g. a button that opens nothing or badges with no panel). The
  localStorage key `nirmaan-rate-helper-off` REMAINS as an emergency off-lever: **PER-BROWSER and PER-USER, effective
  on the next page load, never company-wide** — turning the feature off for everyone is a code change, not a setting.
  Because the gate is gone, `embeddedPanel`'s widening of the embedded pricing editor (`max-w-5xl` -> `w-full`) is now
  PERMANENT and INTENDED. **STANDING OWNER RULE: no dev-only gates, ever — anything built here must work as-is in
  production, so `import.meta.env.DEV` must never gate a feature again.**
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
- **BCS -- the INTERNAL cost block inside the pricing editor** (`bcsColumns.ts` pure leaf + `bcsRollup.ts` +
  `marginView.ts` + `BcsColumnsDialog.tsx` + `MarginRangeFilter.tsx`; the block itself renders inside
  `PricingGrid`/`SummaryPanel`, no new
  route). Full frontend as-built in `frontend/.claude/context/domain/boq-frontend.md`; storage, endpoints and the
  carry layer in `.claude/context/domain/boq-backend.md`. ⚠️ **NAME COLLISION: "BCS" in the Rate Master section
  below is a derivation pipeline -- an unrelated concept sharing three letters.** The acronym is never expanded
  anywhere in the codebase; do not invent an expansion. The load-bearing invariants:
  - **WHICH cost boxes a sheet gets is derived from the sheet's OWN rate columns** (`bcsLiveRateKinds`, owner
    ruling): no Supply rate column -> no Supply box; a combined-rate sheet gets ONE box; no rate column at all ->
    no block. ⚠️ **THE HALVES WIN OVER A COMBINED RATE MAPPED BESIDE THEM.** The backend forbids summing
    `combined_rate` with the two halves, so the live set must never hold both or the total double-counts -- which
    makes the prohibition **STRUCTURAL**: the arithmetic downstream cannot express the forbidden sum, because the
    set it is given never contains both. A NARROWING, never a widening.
  - **Column headers are an owner ruling, pinned by test:** `BCS Cost (Supply)` · `BCS Cost (Installation)` ·
    `BCS Total Amount`. The prefix marks which side of the sheet a figure belongs to (BCS = what it costs US;
    everything else = what we charge the CLIENT), which matters because the two blocks scroll apart on a wide
    sheet. The mirror to the parser's `Rate (Install)` role label is deliberately NOT word-for-word -- do not
    shorten `Installation` back to match it.
  - **THE BLOCK IS FOUR COLUMNS (BCS-S8, owner 2026-08-07):** the two cost boxes · `BCS Total Amount` ·
    `% Margin`. ⚠️ **`Tendered Total Amount` was REMOVED, reversing S3b's "ALWAYS SHOWN (owner ruling)" --
    but ONLY the column. `bcsRowAmount` / `bcsTenderedAmountCell` / `BcsSectionTotals.tendered` still
    compute it, because it is the margin's DIVISOR; deleting them blanks every % Margin on every sheet.**
    Cost: the denominator is no longer verifiable by eye (the rule that % Margin divides by the figure SHOWN
    still holds in code, but nothing on screen proves it). ⚠️ `isBcsInputColumn` answers "is this NOT a
    computed kind?", so REMOVING a token from `BCS_COMPUTED_KINDS` makes it **typeable**, not inert --
    anything dropped from that list must leave the `BcsComputedKind` union in the SAME edit.
  - **`% Profit` is now `% Margin` (owner 2026-08-07) -- A RENAME, NOT A MATHS CHANGE.** The owner's
    `(1 − BCS/BOQ) × 100` and the implemented `((amount − cost) / amount) × 100` are the same expression
    rearranged; the identity is pinned by test. ⚠️ That test ALSO pins the misread grouping as WRONG:
    `1 − (c/a) × 100` returns **−59** where the answer is **+40**. Do not "implement the owner's formula
    literally". `bcsMarginPercent`'s guards (zero denominator, NEGATIVE denominator, non-finite) are
    load-bearing -- rewriting it into the `1 − c/a` shape would compute the same thing while risking them.
  - **`% Margin` HAS ITS OWN ƒ TOO (S10/S11), and it is ONE dialog with TWO slots** --
    `MarginFormulaBuilder`, rendering `( 1 − COST ÷ AMOUNT ) × 100` with both operands live inside
    it. ⚠️ S11 first shipped this as TWO badges and the owner rejected it: they are two halves of
    one rule, and splitting them made the rule invisible. **The wrapper is rendered, NOT editable,
    and that is STRUCTURAL** -- `1` and `100` are numeric literals, which this system has no token
    for and the server rejects; keeping it in code is also what keeps `bcsMarginPercent`'s guards
    (zero / non-finite / NEGATIVE denominator, the last of which would show a loss as +150%)
    unbypassable. Targets `bcs_margin_cost` + `boq_total`; `rollBcsSections` takes a per-row
    `ownTendered` override so the Summary panel follows a formula too. ⚠️ **Total Quantity must
    stay reachable from the COST side** -- BCS Total is a ROW total while the cost boxes are
    PER-UNIT rates, so without it the only reachable formula was dimensionally wrong.
  - ⭐ **THE CHIP-NAMING RULE: a palette chip must read EXACTLY as its column reads in the grid.**
    Broken twice in one session, both times found by the owner (`Amount (Total)` was a ROLE label;
    `BCS Total` vs the header's `BCS Total Amount`). Sheet-column chips carry the **Excel letter**
    (`G — Amount (Supply)`) -- the one label both surfaces share; BCS chips carry none, because
    they have no Excel column and that absence is meaningful. **A chip nobody can locate in the
    grid reads as a figure that does not exist.**
  - **The % Margin column header OWNS the margin view controls (BCS-S13/S14, owner 2026-08-07).**
    Layout is `[ƒ] % Margin [↑↓] [▼funnel]`. ⚠️ **BCS-S4's separate flat "margin VIEW" is DELETED** --
    with its toolbar toggle, its header-as-sort-control, and `buildSectionLabels` (which existed only
    because flattening destroyed the section context a tree shows by POSITION). Do not rebuild it;
    a ranked overview is a rebuild, not an un-deletion.
    - **The RANGE is a TERM of `passesViewFilter`, never a separate pass** -- so it ANDs with
      Show-unpriced / Check-Category / the row-type toggles for free and search inherits it. The
      **SORT** is the one genuine stage after it (ordering cannot be a predicate).
    - **Both are SNAPSHOTS measured over the WHOLE sheet (`rowsRef.current`), never `displayRows`.**
      A range measured over the filtered set narrows irreversibly on each Apply; a rank built over it
      leaves later re-admitted rows unranked in the appended tail. Recomputed on an explicit
      Apply/arrow click ONLY -- `activeCell` is array-index addressed, so a live re-derivation would
      slide a different row under the cursor mid-keystroke.
    - ⚠️ **MEMBERSHIP IS THE MARGIN, NEVER `node_type`.** `isMarginViewRow` (line-items-only) was the
      VIEW's curation rule and could not survive either half: the grid renders % Margin on every row
      that has one, so a qty-bearing Preamble showing 15% would vanish from a 10-25% filter beside
      line items that stayed; and `marginSortRows`' output IS the grid's row set, so an unranked row
      silently disappears from the sheet. Rows with no margin are already excluded by `marginInRange`.
    - **Only the SORT suppresses tree claims** (flat depths, withheld `childrenByParent`, suspended
      collapse) -- a filter merely drops rows, so a survivor's ancestry and chevron stay true. The
      arrow is THREE-state (`off → asc → desc → off`); **off must stay reachable**, or the suppressed
      hierarchy has no way back.
    - ⚠️ **A CONTROL THAT CAN HIDE ITSELF NEEDS AN ESCAPE HATCH.** `PricingGrid`'s `rows.length === 0`
      early return fires BEFORE the header, so a range matching nothing removed the only control that
      could clear it. The empty state must therefore tell "empty sheet" from "your filters emptied it",
      name the applied range **without blaming it** (filters compose -- claiming "nothing has a margin
      in that band" may be false), and offer **Clear filters** resetting EVERY view filter. It must
      stay an early return INSIDE the grid: lifting it into the page unmounts `PricingGrid` and
      discards the unsaved drafts held in its state.
  - **The BCS dialog is ONLY a switch (S12):** on/off + Cancel; both column pickers gone.
    ⚠️ **Readiness dropped to `bcs_enabled` in the SAME change and the two are inseparable** --
    re-adding the confirmation requirement without the pickers makes BCS switch on and stay
    permanently read-only. The ribbon chip and the "BCS needs columns" banner were removed with
    them (a banner that cannot fire is worse than none). ⚠️ **Enabling no longer opens the card**
    -- that line was correct only while the card held the pickers.
  - **`BCS Total Amount` is an EDITABLE FORMULA (BCS-S9, green ƒ on its header).** Stored in the EXISTING
    `BoQ Cell Amount Formula` as `target_value_field = "bcs_total"` -- **no schema change, no migrate**, and
    it rides the `column_formulas` payload + `onSaveFormula` that already existed. **`bcsColumns.bcsTotalCell`
    is the ONE function that answers "this row's BCS total"** -- `PricingGrid` and `pricingRollup` computed it
    separately before S9, which was survivable only while the rule was a constant; as per-sheet DATA two
    copies would show different numbers in the grid and the Summary panel. Absent formula ⇒ the built-in
    `(cost boxes) × quantity`, byte-identical to pre-S9. The operand vocabulary (`bcs_supply` / `bcs_install`
    / `bcs_combined` / `bcs_qty`) is DISJOINT from the sheet's columns; the palette derives from
    `bcsLiveRateKinds`, so it can never offer a box the sheet lacks. ⚠️ **The builder's palette group
    headings must stay DERIVED (`paletteGroupOrder`), never a fixed list** -- a hardcoded
    `["Quantity","Rate","Amount"]` silently dropped the BCS cost chips at render with no error and no empty
    state, and only the owner caught it.
  - **A BLANK IS NEVER A 0, and every blank knows WHY** (`BcsComputedCell` = value | blank+reason, surfaced as the
    cell `title`). A `0` is a claim ("this costs nothing"); an absence is not. An unrecognised reason renders as an
    explicit UNSUPPORTED state, never a silent blank. ⭐ **% Margin is never NaN, never Infinity, and NEVER A
    PROFIT ON A LOSS** -- a NEGATIVE denominator flips the inequality (amount -100 vs cost 50 computes +150%), so
    a loss-making row would display positive profit: confidently wrong, which is worse than visibly absent. It is
    a **blank with a reason, not a blocked keystroke** (do not convert it into a validation); the COST side is
    deliberately unguarded, since only the denominator's sign inverts the comparison.
  - ⚠️ **`mergeBcsRowValues` takes a `ReadonlyMap` ON PURPOSE -- never "simplify" it to an object.** The grid's cost
    drafts are keyed `` `${row_index}:${field}` `` while the merge reads BARE field keys; as plain objects the two
    are structurally assignable, so passing the wrong key space COMPILES CLEANLY, finds nothing, and reverts a
    controlled cost input on every keystroke while the debounce saves a number nobody typed. A `Record` is not
    assignable to a `Map`, so the mistake is now a compile error.
  - **The `bcs_costs` carry layer defaults OFF, and the default lives ONLY in the client** -- an omitted `layers`
    payload is rates-only server-side. ON is the exception, not the rule, and an internal cost rate is the last
    layer on which to relax "nothing arrives un-asked-for".

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
- **A COMPLETION MESSAGE REPORTS WHAT RAN, NEVER THE POPULATION (owner-locked).** The suggest-run
  modal read `summary.results.length` — the whole DOCUMENT (carried + newly extracted) — so a
  scoped run announced the population and a partial run read as a full one. The pass's own scope
  rides the terminal payload; the message is built by a PURE, unit-pinned function so each run
  shape's wording is testable without spending an AI call. **"carried forward unchanged" and "not
  reached" are NEVER folded together** — they mean different things to someone deciding what to
  check — and a count that does not apply is OMITTED, never printed as zero. Where the payload
  cannot support a split, the message says what IS known rather than inventing a number — that is
  the fallback, not the target. **The COUNT A MESSAGE NEEDS MUST COME FROM THE PASS, NOT THE
  DOCUMENT:** a run document accumulates carried rows, so a document-level "attempted" figure
  answers "what does this document hold", never "what did this pass do", and subtracting it from
  the population reads as zero-missed exactly when rows were left unfinished. Where both numbers
  exist, take the per-pass one and derive carried-forward and not-reached from it. **Never name a single category in this message** — the population spans
  many, and the old "wiring rows" label was a leftover from when the feature handled only cables.
- **VIEW FILTERS COMPOSE IN EXACTLY ONE PLACE AND ALWAYS AND (owner-locked).** Every view filter is
  a clause in `SheetPricingPage.passesViewFilter` — never a second pipeline. **A new clause must
  ALSO be added to `anyViewFilter`**, because `displayRows` has a `!anyViewFilter` FAST PATH that
  returns the unfiltered rows: a clause added without it compiles, passes its unit tests, and
  silently does nothing. Its inputs must join the `displayRows` dependency array for the same
  reason. **An EMPTY selection is a PASS-THROUGH, never "hide everything".**
- **A FILTER MUST NEVER HIDE EVERY ROW WITHOUT SAYING WHY.** The ticked-rows toggle carries BOTH
  guards deliberately: the predicate passes everything through when nothing is ticked, AND the
  control is DISABLED with a tooltip saying what to do first. The accidental state (untick the last
  row while filtered) therefore restores the full sheet instead of emptying the grid.
- **THE TICKED-ROWS FILTER IS A TOGGLE, NOT A VALUE LIST, AND IT READS THE SELECTION SET.**
  `GridColumnFilter` is built entirely around distinct-VALUE lists (options array, `Set<string>`,
  type-to-search, membership matching); a thousand row numbers would be a useless list, and bending
  it would put a search box over two pseudo-options and express a boolean as a set of sentinels. The
  toggle READS the page's ONE selection set and never duplicates it — which is also what makes
  unticking while filtered drop the row immediately, with no special case. Only the toggle's own
  pressed state reaches the grid, and it stays OUT of `pricingRowPropsAreEqual`.
- **THE TICK BOX FOLLOWS THE RUN'S ELIGIBILITY, NEVER THE BADGE SET (owner-locked).** FOUR
  definitions of "eligible" live in this screen and they disagree: the priceable MASTER SET
  (`isPriceableType`), priceability's priceable LINE (qty in a rate-column area), the RATE-EDITABLE
  set the badges and the faint opener render on (`isRateEditableRow`), and the suggest RUN's own
  population (`assemble_population` — rate-editable AND a non-blank resolved category AND that
  category having an eligible rate config). **The set is surfaced BY THE SERVER**
  (`get_active_suggestion_run().eligible_rows`) and must never be re-derived client-side: a copy
  would be a FIFTH definition, free to drift, and the drift presents as ticks the run silently
  ignores. Ticking on the badge set would offer rows the run drops.
- **SELECTION STATE IS PAGE-LEVEL AND ONLY BOOLEANS REACH THE MEMOIZED ROW.** The row receives
  `tickable` + `selected` (per-row booleans, compared by value in `pricingRowPropsAreEqual`) plus a
  reference-stable `onToggleTick` — **never the selection Set and NEVER a count**; a count changes
  on every tick and would re-render every row. This is the `openRemark` shape. The COUNT the
  confirmation quotes stays page-local and is never passed down. Selection is keyed by the DURABLE
  `source_row_number`, never the window array index (virtualized recycling remaps indices), and it
  is per-sheet + session-only.
- **THE "SUGGEST RATES" BUTTON IS REPURPOSED, NOT DUPLICATED, AND ALWAYS CONFIRMS BEFORE AN AI
  CALL.** Ticks present -> run those; none -> the whole sheet. **The whole-sheet WORDING is the
  product, more than the count**: it must warn that re-running OVERWRITES rows that are already
  correct and point at the tick alternative, and its action renders DESTRUCTIVELY so a stray click
  cannot launch a full re-extraction. The copy lives in the pure `suggestConfirmCopy` so both
  branches are unit-testable; the selected-row branch carries NO warning because it has no such
  consequence.
- **Rate-helper panel + Rate Master attribute semantics:** every invariant moved to `frontend/.claude/context/domain/pricing-rate-master-frontend.md` -- load it before any rate-helper work.

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

**Wizard-screen detail (project picker, global entry + in-project tab, sidebar gating, colour tokens, UI
library, the Tendering create-modal, `useBoqWizardStore`, the upload screen / drop zone, the
blank-until-parsed + confirm-reset rule, the `uploadStatus` lifecycle, both socket-listener patterns, the
hub parse-completion / recovery / reconnect / dismiss conventions, and the Continue + pre-fill gates)
lives in **`frontend/.claude/context/domain/boq-frontend.md`** — load it before wizard work.

### BoQ Pricing Editor -- Frontend Conventions

The FULL per-slice component contracts (keyboard-nav matrix, the row-memo anti-defeat rule, the formula engine F1–F4, reconciliation, collapse/expand, lock/unlock, the two-ribbon toolbar, search/column-hide, export/download, review-screen render contracts, etc.) live in **`frontend/.claude/context/domain/boq-frontend.md`**. Load it before pricing-editor / review-screen frontend work. The STABLE conventions + LOAD-BEARING invariants are summarized above (§ "Pricing editor … LOAD-BEARING invariants" and § "Review screen … load-bearing invariants").

### Pricing Module (HVAC / Electrical / ELV Pricing) -- Frontend Conventions

Full record: `frontend/.claude/context/domain/pricing-rate-master-frontend.md` -- load it before any pricing-module work.

### Rate Master (RM-2) -- Frontend Conventions

Full record: `frontend/.claude/context/domain/pricing-rate-master-frontend.md` -- load it before any Rate Master work.

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

