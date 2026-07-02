# Expenses Domain — Approval Workflow & Unified Module

As-built reference for the Expense module (Project + Non-Project expenses). Domain
language lives in `CONTEXT.md` ("Expense workflow & settlement"); the type-normalization
decision is `docs/adr/0009-project-expense-type-normalization.md`. This doc records
**what was added, improved, and changed** across the feature.

## Overview

An **Expense** is a cost recorded outside the PO / Service Request flow. Two kinds:
- **Project Expense** — attributed to a Project (labelled "Misc Project Expense" in the UI).
- **Non-Project Expense** — company-wide, not tied to a Project.

Both share one approval lifecycle and are entered/managed together in a single unified
**Expense** area (`/expense`).

## Domain rules (source of truth: `CONTEXT.md`)

- **Status lifecycle:** `Requested → Approved → Paid` (one-way). *Approved* = sanctioned
  but not yet paid (staging); *Paid* = cash actually went out (final).
- **Settled spend = Paid only.** Only `Paid` expenses count in **every** financial rollup.
  `Requested`/`Approved` are commitments, excluded from those numbers.
- **Auto-approval:** a positive amount `< ₹5,000` is created directly at `Approved`
  (skips `Requested`); a refund (non-positive) or `≥ ₹5,000` takes the full path.
- **Project Expenses use only project-flagged (`project=1`) Expense Types** (ADR 0009).

---

## What was ADDED

### Status workflow (both doctypes)
- `status` Select field (`Requested/Approved/Paid`, default `Requested`) on the
  `Project Expenses` and `Non Project Expenses` doctypes.
- **Auto-approval** in each doctype's `validate` (create-time, `is_new()`-guarded):
  `project_expenses.py`, `non_project_expenses.py` — `0 < amount < 5000` → `Approved`.
  (Owner preference: this small create-time derivation lives in the doctype `.py`
  `validate`, not a controller+hooks.)
- **Backfill patches:** `v3_0.backfill_project_expenses_status`,
  `v3_0.backfill_non_project_expenses_status #v2` — classify legacy rows
  (payment attachment ⇒ `Paid`, else `Approved`).

### Unified Expense module (frontend)
- New `/expense` route with URL-driven tabs: `/expense/project` (Misc Project Expense)
  and `/expense/non-project` (Non-Project Expense) — `pages/Expenses/ExpenseLayout.tsx`
  (pill tab strip + `<Outlet/>`). Index redirects to `/expense/project`; legacy
  `/project-expenses` and `/non-project` redirect in. `components/helpers/routesConfig.tsx`.
- Single **Expense** sidebar entry (union of both role gates) — `NewSidebar.tsx`.
- Per-tab right-action button ("Add New Project Expense" / "Add New Expense") —
  `renderRightActionButton.tsx`.

### Non-Project invoice/payment split
- Creator records **invoice** details; Accountant records **payment** and marks `Paid`.
- Split **Inv. Attach** / **Pay. Attach** columns; clickable blue Invoice Ref on Paid/All;
  two-stage **Mark as Paid** dialog with receipt AI auto-fill
  (`nirmaan_stack.api.payment_autofill.extract_payment_fields`).

---

## What was IMPROVED / CHANGED

### Paid-only financial rollups (only settled spend counts)
Every cross-surface expense calculation now filters `status = "Paid"`:

| Surface | Where |
|---|---|
| CEO-Hold **cashflow gap** | `integrations/controllers/project_cashflow_hold_update.py` (`_compute_cashflow_gap`) |
| **30-day Payment dashboard** (Project + Non-Project) | `api/payments/get_project_payment_summary.py` |
| **Outflow Report(Project)** | `pages/reports/hooks/useOutflowReportData.ts` |
| **Project-detail Financials** total + Projects-list aggregation | `pages/projects/data/root/useProjectRootApi.ts` (both expense hooks) |
| **Project Reports** per-project outflow | `pages/reports/hooks/useProjectReportCalculations.ts` |
| **Outflow Report(Non-Project)** | `NonProjectExpensesPage` report mode (`DisableAction`) forces `Paid` + hides the Status column |

List-page **summary cards stay tab-scoped** (they reflect the active status tab) — by design.

### CEO-Hold trigger correctness
- `on_project_expense` now only re-evaluates the hold when a row **enters or leaves `Paid`**
  (mirrors `on_project_payment`); adding/editing a `Requested`/`Approved` expense no longer
  fires it.
- The cashflow handler moved from `on_trash` → **`after_delete`** in `hooks.py` (Frappe runs
  `on_trash` *before* the row is deleted, so the gap query would still count the row);
  `after_delete` runs after the delete, so removing a `Paid` expense correctly lowers the
  gap / can release a hold. `generate_versions` stays on `on_trash`.

### PO adjustment
- The ad-hoc adjustment expense is created directly as **`Paid`** (money has already moved)
  — `api/po_adjustments/adjustment_logic.py`.

### Data normalization (ADR 0009)
- Patch `v3_0.normalize_project_expense_types`: repoints Project Expenses using 6
  non-project-flagged types (Printing & Stationery, Staff Welfare, Hotel, Postage & Courier,
  Pooja, Travel (Flight)) → **Other Project Related Charges**. Type-only raw `UPDATE`,
  `modified` preserved, idempotent, Non-Project untouched. Fixes the Outflow(Project) facet
  so that report reconciles.

### Embedded / read-only views
- **Project-detail "Misc. Project Expenses" tab** (embedded `ProjectExpensesList`, `projectId`
  present): `Paid`-only, status tabs hidden, Actions column hidden — a clean read-only view.
  The standalone `/expense` module is unchanged.
- **Approved tab:** Procurement Executive + HR Executive see **no Actions column** (both
  lists) — on `Approved` their only capability was Mark-as-Paid, which they don't have.

### UX polish
- Pill tabs (active = primary/red, inactive = gray, with count badges); standalone lists grow
  to natural height for a single page scroll (`autoHeight`); clearly-headed split attachment
  columns.

---

## Role gating (frontend enforcement)

| Action | Roles |
|---|---|
| Record Invoice / edit a `Requested` row | Admin, PMO, Accountant (+ Lead), Procurement, HR |
| Approve (`Requested → Approved`) | Admin |
| Mark as Paid (`Approved → Paid`) | Admin, Accountant (+ Lead) |
| Edit a `Paid` row / Delete | Admin |

Roles come from the `Nirmaan Users.role_profile` (via `useUserData`), not standard Frappe roles.

---

## Key files

- Doctypes: `doctype/project_expenses/`, `doctype/non_project_expenses/` (`.json` + `.py`).
- Backend calc/controllers: `integrations/controllers/project_cashflow_hold_update.py`,
  `api/payments/get_project_payment_summary.py`, `api/po_adjustments/adjustment_logic.py`,
  `hooks.py` (doc_events).
- Frontend module: `pages/Expenses/ExpenseLayout.tsx`, `pages/ProjectExpenses/*`,
  `pages/NonProjectExpenses/*` (list pages, `config/*Columns.tsx`, dialogs).
- Reports/aggregation: `pages/reports/hooks/useOutflowReportData.ts`,
  `useProjectReportCalculations.ts`, `pages/projects/data/root/useProjectRootApi.ts`,
  `pages/ProjectPayments/PaymentSummaryCards.tsx`.

## Patches (append-only)
- `v3_0.backfill_project_expenses_status`
- `v3_0.backfill_non_project_expenses_status #v2`
- `v3_0.normalize_project_expense_types`

## Cross-references
- Glossary: `CONTEXT.md` → "Expense workflow & settlement".
- Decision: `docs/adr/0009-project-expense-type-normalization.md`.

## Deliberate design decisions (do NOT "fix")

- **Approved-but-unpaid expenses do NOT pressure the CEO-Hold cashflow gap** — only `Paid`
  expenses count as settled spend (confirmed, Option A). This is an **intentional asymmetry
  with POs**: a *delivered* PO pressures the gap before payment (via a liability term =
  delivered − paid), but an expense has no "delivered" milestone to anchor a liability on, so
  it counts only once `Paid`. Trade-off accepted: a large pile of approved-but-unpaid
  expenses can make a project look healthier than it is. **Do not add an expense-liability
  term** unless deliberately reversing this decision.
