# CLAUDE.md — Nirmaan Stack frontend

The React + TypeScript + Vite SPA for Nirmaan Stack (procurement, projects, service requests, vendors,
finance). It runs against the Frappe backend; the project, its stack and the session workflow are in root
`../CLAUDE.md`, which Claude Code also loads for a session started here.

## Before you write code

**Before writing, reviewing or testing frontend code, read `frontend/CODING_STANDARDS.md`.** Before changing
code in a domain, read that domain's doc from [Domain docs](#domain-docs).

Four standards fail silently when broken, so they are summarised here too (full text in
`frontend/CODING_STANDARDS.md`):

- **No DOM in tests.** vitest runs with `environment: "node"` and no jsdom, so a component's mount, unmount or
  state across a render cannot be unit-tested. Keep rules in pure helpers, and verify a React-semantic change
  with a live browser A/B.
- **Keep a controlled `<select>`'s placeholder selectable.** With no matching option the browser shows the first
  selectable option, so a `disabled` placeholder makes the field display a value the row never held (on an
  `allow_none` def, the `"None"` sentinel).
- **The app-shell error boundary resets through `resetKey`, never a React `key`.** Keying
  `ErrorBoundaryWrapper` on the location remounts every routed page on every navigation and destroys page state
  on a same-route param change.
- **`useFrappeGetDoc`'s third argument is the SWR key.** Fetch conditionally with `id ? undefined : null`;
  `{ enabled: !!id }` there breaks SWR deduplication.

## Commands

- `yarn dev` serves on `:8080` and proxies the API to Frappe on `:8000` and Socket.IO on `:9000`; the backend
  must be running.
- `yarn build` writes `../nirmaan_stack/public/frontend/` and copies `index.html` to
  `../nirmaan_stack/www/frontend.html` (plus the Firebase service worker into `www/`); both are generated output.
- `yarn test` (vitest) is a local gate: CI runs only the Python bench suite, so run it yourself.
- `python3 scripts/residence_check.py` runs from the app root, not `frontend/`.

## Domain docs

Read the doc for the area you touch before writing code; where it has a Load-bearing invariants section, read
that first. Paths are under `.claude/context/domain/` unless given in full.

`boq-frontend.md` (~330 KB) and `.claude/plans/boq-upload-plan.md` (~3 MB) are too large to read whole: list the
headings with `grep -n '^#' <file>`, then read only that range.

| Touching… | Read |
|---|---|
| **BoQ pricing editor**: `PricingGrid.tsx`, `SheetPricingPage.tsx`, the BCS cost block, the Category column, the rate-helper chassis, view filters | `boq-pricing-editor-frontend.md` |
| **BoQ wizard** (`src/pages/boq-wizard/`): upload, hub, spoke, the review screen | `boq-frontend.md` § Load-bearing invariants |
| **BoQ status**: the active slice, the design spec, as-built records | `.claude/plans/boq-upload-plan.md` |
| **Rate-helper panel** attributes, Pricing Module workbook pages, Rate Master screens | `pricing-rate-master-frontend.md` |
| **Procurement**: Loss Justification (PR/SB), Critical PO Task packages and links | `../.claude/context/domain/procurement.md` § Load-bearing invariants |
| **CEO Hold**, including the Delivery Note exemption | `ceo-hold.md` |
| **Vendor Hold** | `vendor-hold.md` |
| **Invoices**: Add Invoice / Add Credit, invoice-qty surfaces, Resolve Invoices, `LineItemMappingReview` | `invoices.md` § Load-bearing invariants |
| **Delivery Notes**, Return Notes | `delivery-notes.md` |
| **PO Adjustments** | `po-adjustments.md` |
| **PO Revisions** | `po-revisions.md` |
| **Internal Transfer Memos**, ITM DC & MIR | `../.claude/context/domain/internal-transfer-memos.md` |
| **Roles**: sidebar entries, per-page actions, PMO exceptions | `.claude/context/role-access.md` |
| Anything else (projects, customers, milestones, PO status, modules) | `.claude/context/_index.md` |
