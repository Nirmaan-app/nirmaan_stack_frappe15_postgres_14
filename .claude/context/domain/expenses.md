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
- **Backfill patches:** `v3_0.backfill_project_expenses_status` — classify legacy
  rows (payment attachment ⇒ `Paid`, else `Approved`).
  `v3_0.backfill_non_project_expenses_status #v3` — **simplified (attachment check
  dropped, owner decision):** every non-`Paid` row (`Approved` / `Requested` /
  unclassified) → `Paid`, i.e. all Non Project Expenses end up `Paid`. Local-only
  patch edited in place + tag-bumped (`#v2`→`#v3`) to force a re-run, not a new file.

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

### Project invoice/payment split + both-sided AI autofill (2026-07-22)
Project Expenses now mirrors the Non-Project split (previously it had **no** invoice/payment
fields). 5 fields added to the `Project Expenses` doctype — `invoice_attachment` /
`invoice_ref` / `invoice_date`, `payment_attachment` / `payment_ref` (`payment_date` already
existed). Frappe re-serialised the JSON on migrate into `Payment Details` / `Invoice Details`
sections; all 5 columns verified via `has_column`.
- **Creator records invoice at create/edit** — optional "Record Invoice Details" section in
  `NewProjectExpenseDialog.tsx` (two-stage upload) with **invoice AI autofill**
  (`invoice_autofill.extract_invoice_fields`) filling Invoice Ref (from `invoice_no`),
  Invoice Date, **and Amount** (from the invoice total; the existing **₹15,000** create cap
  still validates and flags larger extracted amounts).
- **Accountant records payment at Mark-as-Paid** — a NEW two-stage
  `ProjectExpenses/components/UpdatePaymentDetailsDialog.tsx` (ported from Non-Project) with
  **payment AI autofill** (`payment_autofill.extract_payment_fields`) filling Payment Ref +
  Date, attaching the proof, and setting `payment_by` + status `Paid`. Amount is **not**
  re-filled here (already set at create), but the receipt's extracted `transfer_amount` is
  **cross-checked** against the recorded expense amount: on a mismatch (`|diff| > ₹1`) a
  **soft amber warning** (`amountMismatch`) says the receipt is "more/less than" the expense
  amount — **non-blocking** (Mark-as-Paid still allowed). This mismatch warning lives in
  **BOTH** Mark-as-Paid dialogs — `ProjectExpenses/components/UpdatePaymentDetailsDialog.tsx`
  AND `NonProjectExpenses/components/UpdatePaymentDetailsDialog.tsx` (identical logic). **Mark-as-Paid no longer routes through
  `EditProjectExpenseDialog`** (`ProjectExpensesList.handleOpenMarkPaid` opens the new dialog).
- **Files are docname-linked to `Project Expenses`** so they appear under the doc's
  attachments (`attached_to_doctype`/`_name`/`_field`). Create-time invoice uploads happen
  before the doc exists, so they're **re-linked after `createDoc`** via
  `updateDoc("File", <fileName>, {...})` (non-blocking — the field URL is set regardless);
  mark-as-paid / edit uploads pass `docname` directly. This is a deliberate **improvement
  over Non-Project's create flow**, which leaves its create-time File unlinked.
- Split **Inv. Attach / Pay. Attach** columns + clickable blue Invoice Ref (Paid/All) added to
  `projectExpensesColumns.tsx`; the 5 fields added to `DEFAULT_PE_FIELDS_TO_FETCH`.
- `EditProjectExpenseDialog.tsx` surfaces invoice fields (any stage) + payment fields
  (Approved/Paid) with existing-attachment view + replace-upload.
- **Amount cap exemption (frontend-only):** the ₹15,000 create/edit cap (`AMOUNT_LIMIT`)
  is lifted for any type whose docname/label **contains** a `NO_LIMIT_EXPENSE_TYPE_KEYWORDS`
  word (currently `["accommodation"]`, **case-insensitive SUBSTRING** match — so
  "Accommodation Deposit", "Staff Accommodation Rent", "Labour Accommodation Rent", or a
  plain "Accommodation" all qualify). Defined identically in `NewProjectExpenseDialog.tsx` +
  `EditProjectExpenseDialog.tsx` (`isUncappedExpenseType`); any new project-flagged type
  containing the keyword is exempt automatically — no code change needed. Unrelated to the
  ₹5,000 backend auto-approve threshold (that still applies). No backend cap enforcement
  exists.

### Description widened to `Text` (2026-07-28, migrate-carrying)
`description` was `Data` on BOTH doctypes → PostgreSQL `varchar(140)`, while **all four
dialogs already rendered a `<Textarea>`** (`NewProjectExpenseDialog` / `EditProjectExpenseDialog`
/ `NewNonProjectExpense` / `EditNonProjectExpense`). Frappe's `Document._validate_length()`
does **not** truncate an over-long `Data` value — it **throws** `CharacterLengthExceededError`
— so the 141st character was a hard save failure. Changed to `fieldtype: "Text"` (a
CLAUDE.md **sanctioned exception**, one-key diff per JSON) + `bench migrate`.
Verified post-migrate: both columns are PG `text`, `character_maximum_length` NULL, all
2,574 Project + 698 Non-Project rows intact (max stored length unchanged at 81 / 110).
No frontend change was needed. Description is the **default search field** on both tables
(`PE_SEARCHABLE_FIELDS[0]` / `NPE_SEARCHABLE_FIELDS[0]`) — `LIKE` behaves identically on
`text`, so search is unaffected.

### Create-button label names the path the expense will take (2026-07-28)
The two CREATE dialogs' submit buttons were static (`Save Expense` / `Add Expense`). They now
read **"Raise Expense"** when the expense will auto-approve on save and **"Send for Approval"**
otherwise. The rule lives in ONE pure module, `frontend/src/utils/expenseApproval.ts`
(`EXPENSE_AUTO_APPROVE_LIMIT`, `isAutoApprovedExpenseAmount`, `getExpenseSubmitLabel`,
`EXPENSE_SUBMIT_LABELS`) — ADR-0010 F1/F4, unit-tested in `expenseApproval.test.ts` (10 tests).

**Owner ruling: the label mirrors the BACKEND predicate `0 < amount < 5000` exactly, NOT the
looser phrase "under 5,000".** Two edges depend on it and must not be "simplified":
- **Exactly ₹5,000 → "Send for Approval"** — the backend comparison is a strict `<`.
- **A refund (negative amount, which Non-Project explicitly supports) → "Send for Approval"** —
  it is "less than 5000" but takes the full `Requested → Approved → Paid` path.
- A blank / unparseable amount → "Send for Approval" (`parseNumber` yields 0, which fails `> 0`).

Edit dialogs are untouched (create-only scope). ⚠️ `AUTO_APPROVE_LIMIT = 5000` now exists in
**three** places — both doctype `.py` files and this TS module. The backend is authoritative;
the TS copy exists only to describe the outcome to the user.

### Paid-tab "Last Modified By" column (2026-07-28)
A `modified_by` column on the **Paid tab of both lists** — the settlement audit trail (who
actually saved the row into `Paid`, vs Project's `Payment By` which is who the payment is
*attributed* to; Non-Project has no `payment_by` field at all). Faceted like Created By:
`modified_by` was **already** in the backend `LINK_FIELD_MAP` (`api/data_table/constants.py`
→ `User.full_name`) and already in `STANDARD_FIELDS`, so the self-fetching facet resolves real
names with **zero backend change** — only the column's `facetMeta` + a `modified_by` entry in
each page's `facetOverrides`. Added `modified_by` to both `*_FIELDS_TO_FETCH`.
**Excluded when `disableActions`** — i.e. hidden from the embedded project-detail Misc-Expenses
view and from the Non-Project Outflow report, both of which are also Paid-scoped but are
financial summaries, not audit surfaces (same precedent as the Status column).

### Project Expenses "All" tab: Payment By dropped, Created By is the identity (2026-07-28)
The All tab rendered **both** Created By and Payment By; Payment By was blank for every
`Requested`/`Approved` row. Owner call: **Payment By is Paid-tab only** (settlement
attribution) and the All tab keeps **Created By** — who raised the payment request. This also
re-aligns the code with `projectExpensesColumns.tsx`'s own header contract, which had already
documented Payment By as Paid-only while the code had drifted.

---

## What was IMPROVED / CHANGED

### Paid-only financial rollups (only settled spend counts)
Every cross-surface expense calculation now filters `status = "Paid"`:

| Surface | Where |
|---|---|
| CEO-Hold **cashflow gap** (backend) | `integrations/controllers/project_cashflow_hold_update.py` (`_compute_cashflow_gap`) |
| CEO-Hold cashflow gap — **Approve-Payments CEO view** (frontend) | `pages/ProjectPayments/approve-payments/ApprovePayments.tsx` — the `projectExpenses` fetch (swr key `ProjectExpenses_CEOPending`) filters `status = "Paid"`, mirroring the backend gap + `projects.tsx`; `Requested`/`Approved`-but-unpaid no longer inflate the displayed gap. |
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
- **Approved tab:** Procurement Executive sees **no Actions column** (both lists) — on
  `Approved` the only capability is Mark-as-Paid, which they don't have. (HR Executive was in
  this suppression until 2026-07-28; it was removed when HR gained Mark-as-Paid — the two edits
  are a PAIR, since un-gating the button without un-hiding the column renders it invisible.)

### UX polish
- Pill tabs (active = primary/red, inactive = gray, with count badges); standalone lists grow
  to natural height for a single page scroll (`autoHeight`); clearly-headed split attachment
  columns.

---

## Role gating (frontend enforcement)

Roles come from `Nirmaan Users.role_profile` (via `useUserData`), NOT standard Frappe
roles. **Accountant\*** below = both `Nirmaan Accountant Profile` and
`Nirmaan Accountant Lead Profile` (Lead mirrors Accountant everywhere).

### Module visibility & create
- **Sees the Expense sidebar entry + can open `/expense`** (`NewSidebar.tsx`): Admin,
  PMO, Accountant\*, Procurement, HR (+ the `Administrator` user). Everyone else
  (Project Lead, PM, Estimates, Design, Sales, …) has **no access**.
- **Create** ("Add New Expense" / "Add New Project Expense",
  `renderRightActionButton.tsx`): **no extra role gate** — the same 5 groups can create,
  for both Project and Non-Project.
- **Default landing tab:** Accountant\* → `Approved`; everyone else → `Requested`.

### Non-Project Expenses — actions per tab
Primary actions render inline; secondary (Requested-only) sit in a `⋯` overflow menu.

| Tab | Action (placement) | Admin | PMO | Accountant\* | Procurement | HR |
|---|---|:--:|:--:|:--:|:--:|:--:|
| Requested | Approve (inline) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Requested | Delete (inline) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Requested | Record Invoice (⋯) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Requested | Edit (⋯) | ✅ | ✅ | ❌ | ✅ | ✅ |
| Approved | Mark as Paid (inline) | ✅ | ❌ | ✅ | ❌ | ✅ |
| Approved | Delete (inline) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Paid | Edit (inline) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Paid | Delete (inline) | ✅ | ❌ | ❌ | ❌ | ❌ |
| All | per row, by row status | ✅ | ❌ | ✅ | ❌ | ✅ |

**Actions column visibility:** Requested → all 5; Approved → Admin/PMO/Accountant\*/HR
(hidden for Procurement); Paid → Admin only; All → Admin + Accountant\* + HR.
The **All** tab mixes statuses and every button inside the cell is already gated by the
ROW's status, so opening the column to Accountant\*/HR surfaces exactly the Mark-as-Paid
they have on the Approved tab — no new capability, just a second surface for it.

### Project Expenses — actions per tab
Same profiles/gating, all actions inline (no `⋯` menu), and **Accountant\* CAN Edit a
Requested row**. As of 2026-07-22 Project mirrors the Non-Project invoice/payment split:
invoice details are recorded optionally as a **section in the create/edit dialog** (not a
separate "Record Invoice" row action), and **Mark as Paid** opens the two-stage payment
dialog (`UpdatePaymentDetailsDialog`, receipt AI autofill + proof) instead of the plain edit
dialog.

| Tab | Action | Admin | PMO | Accountant\* | Procurement | HR |
|---|---|:--:|:--:|:--:|:--:|:--:|
| Requested | Edit | ✅ | ✅ | ✅ | ✅ | ✅ |
| Requested | Approve | ✅ | ❌ | ❌ | ❌ | ❌ |
| Requested | Delete | ✅ | ❌ | ❌ | ❌ | ❌ |
| Approved | Mark as Paid | ✅ | ❌ | ✅ | ❌ | ✅ |
| Approved | Delete | ✅ | ❌ | ❌ | ❌ | ❌ |
| Paid | Edit / Delete | ✅ | ❌ | ❌ | ❌ | ❌ |
| All | per row, by row status | ✅ | ❌ | ✅ | ❌ | ✅ |

Actions column visibility: same rule as Non-Project.

### Known asymmetries (by design — do NOT "fix" without owner sign-off)
- **Accountant\* Edit split:** can Edit a Requested **Project** expense but not a Requested
  **Non-Project** one (their Non-Project Requested action is *Record Invoice* instead).
- **Approve = Admin only; Delete = Admin only** in both tables.
- **HR Executive can Mark as Paid but still lands on the `Requested` tab by default**
  (only Accountant\* defaults to `Approved`) — deliberate, owner call 2026-07-28.
- Enforcement is **frontend-only** (button/column visibility) — no backend `validate` gate…
  **with one caveat that IS a real backend gate:** the `Nirmaan HR Executive` *Role* has
  `write = 0` on both expense doctypes. Mark-as-Paid works only because the
  `Nirmaan HR Executive Profile` *also* carries **System Manager**, and Frappe permissions are
  a UNION across roles. ⚠️ **`Nirmaan HR Lead Profile` = `[Nirmaan HR Lead, Nirmaan HR Executive]`
  with NO System Manager, so it has genuinely no write.** It is not matched by the
  `role === "Nirmaan HR Executive Profile"` check, so it is safe today (0 such users) — but
  do NOT extend any write action to HR Lead without adding a real DocPerm first.

---

## Key files

- Doctypes: `doctype/project_expenses/`, `doctype/non_project_expenses/` (`.json` + `.py`).
- Auto-approval rule (FE mirror): `frontend/src/utils/expenseApproval.ts` (+ `.test.ts`).
- Backend calc/controllers: `integrations/controllers/project_cashflow_hold_update.py`,
  `api/payments/get_project_payment_summary.py`, `api/po_adjustments/adjustment_logic.py`,
  `hooks.py` (doc_events).
- Frontend module: `pages/Expenses/ExpenseLayout.tsx`, `pages/ProjectExpenses/*`,
  `pages/NonProjectExpenses/*` (list pages, `config/*Columns.tsx`, dialogs). Project
  dialogs: `NewProjectExpenseDialog.tsx` (invoice autofill), `EditProjectExpenseDialog.tsx`,
  `UpdatePaymentDetailsDialog.tsx` (Mark-as-Paid, payment autofill).
- Reports/aggregation: `pages/reports/hooks/useOutflowReportData.ts`,
  `useProjectReportCalculations.ts`, `pages/projects/data/root/useProjectRootApi.ts`,
  `pages/ProjectPayments/PaymentSummaryCards.tsx`.

## Patches (append-only)
- `v3_0.backfill_project_expenses_status`
- `v3_0.backfill_non_project_expenses_status #v3` (was #v2 — now sweeps all legacy → Paid)
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
