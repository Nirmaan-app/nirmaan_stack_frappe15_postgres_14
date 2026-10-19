# Expenses Domain — Approval Workflow & Unified Module

As-built reference for the Expense module (Project + Non-Project expenses). Domain
language lives in `GLOSSARY.md` ("Expense workflow & settlement"); the type-normalization
decision is `docs/adr/0009-project-expense-type-normalization.md`. This doc records
**what was added, improved, and changed** across the feature.

## Overview

An **Expense** is a cost recorded outside the PO / Service Request flow. Two kinds:
- **Project Expense** — attributed to a Project (labelled "Misc Project Expense" in the UI).
- **Non-Project Expense** — company-wide, not tied to a Project.

Both share one approval lifecycle and are entered/managed together in a single unified
**Expense** area (`/expense`).

## Domain rules (source of truth: `GLOSSARY.md`)

- **Status lifecycle:** `Requested → CEO Pending → Approved → Reconciliation Pending → Paid`
  (one-way; both expense doctypes carry all five plus `Rejected`). *Approved* = sanctioned
  but not yet paid (staging); *Paid* = cash actually went out (final).
- **Settled spend = Paid only.** Only `Paid` expenses count in **every** financial rollup.
  `Requested`/`Approved` are commitments, excluded from those numbers.
- **The amount rule is NOT owned here.** It lives in `services/approval_tiers.py` (pure,
  mirrored by `frontend/src/utils/approvalTiers.ts` and pinned to it by a parity test that
  reads the Python source). Both expense ledgers pass `TIER_L2_ABOVE_EXPENSES` explicitly:
  - `< ₹15,000` → created directly at `Approved` (skips `Requested`), `auto_approved = 1`.
  - `₹15,000 – ₹50,000` → **L1 only**; the Admin / Accountant Lead tick FINISHES it.
  - `> ₹50,000` → **L1 then L2**; L1's tick writes `CEO Pending`, the CEO approves.
  - **A refund (amount ≤ 0) is never auto-approved**, then banded by its size like any
    other amount.
  ⚠️ TWO SUPERSEDED RULINGS, because anything written against either is stale: the
  `<= ₹10,000` INCLUSIVE auto line of 2026-09-04 (the lower edge is now ₹15,000 and
  **EXCLUSIVE** — exactly ₹15,000 needs L1), and the expense-only ₹30,000 CEO line of
  2026-09-15 (moved to ₹50,000 on 2026-09-16, so all three money-out ledgers now band
  identically).
- **One module decides every Expense status: `services/expense_decision.py`** (spec #1494 seam 2,
  #1497). `apply_starting_status` / `starting_status` give a NEW row its status (both ledgers'
  `validate`, previewed by `convert.target_status`); `decide` makes every later change, through the one
  call `api/approvals/expense_actions.decide_expenses` (actions `l1_approve`, `ceo_approve`, `reject`,
  `mark_done`, `mark_paid`; one row or a hundred, same code). No screen writes an expense's `status`:
  Approve Payments (row and bulk), the accountant tabs' Mark as Paid (`mark_done`) and the old pages'
  Approve / Mark as Paid all call it. **L1 = `Administrator` or the Admin profile** (`is_l1`; Accountants
  are NOT L1, though the payments bulk gate still admits them for payments). **Mark as Done / Mark as
  Paid = Admin, Accountant, Accountant Lead** (`can_mark_paid` = `PAYMENT_SETTLE_PROFILES`); HR Executive
  lost Mark as Paid on the old pages with #1497. A reject needs a reason; Mark as Paid needs payment
  date, reference and receipt. The bank-line rules (`expense_bank_links.validate`) still have the last word.
- **An L1 reviewer's review of an Expense Request is the L1 step** (#1499, ADR-0016 amendment 3).
  `starting_status(amount, raised_by, reviewed_by)` clears L1 when the request's `reviewed_by` is L1
  (`is_l1`), exactly as for an L1 raiser: an Admin-reviewed ₹22,000 request's Expense is born
  `Approved`, ₹60,000 `CEO Pending` with `approval_date` stamped. An HR or Accounts review clears
  nothing, so ₹15,000 and above still waits for an Admin. The review clears L1 only, even when the
  CEO reviews. ⚠️ `review.approve_expense_request` saves the request's `reviewed_by` BEFORE it
  inserts the ledger row, because the ledger's `validate` reads the reviewer from the request
  (`approval_raiser.expense_reviewer`). The dialog's preview passes the caller as the reviewer
  (`convert.target_status(req, reviewer)`).
- **Project Expenses use only project-flagged (`project=1`) Expense Types** (ADR 0009), and Non
  Project Expenses only `non_project=1` ones. **Enforced on the server by both ledgers' `validate`**
  (`services/expense_type_ledger.check_expense_type`, #1496), so it covers every write path: the
  request intake, the imports, the PO-adjustment ad-hoc expense, Desk and data import. It asks only
  when the row is new or its type changed, so an old row whose type was re-flagged stays editable.
  Paths that refuse before building anything (`settle._assert_type_scope`, `execute_adjustment`)
  ask the same `expense_type_problem`.
- **An expense's bank lines decide Paid, not a person** (ADR-0027, 2026-09-18). An expense can be
  settled by MANY imported bank lines — a salary or reimbursement run leaves the bank as one transfer
  per employee but is recorded as one expense. The **linked total** is the sum of the expense's live
  `Settled` `Outflow Row Match` slips; short of the amount the expense stays `Reconciliation Pending`,
  and within ₹5 of it it is `Paid`, dated by the latest linked line. ⚠️ **The linked total is always
  RECOMPUTED from the slips by one aggregate, never stored on the expense and never incremented** — it
  is owned by `services/outflow_import/expense_links.py` (`load_expense_links`, `derive_expense_status`,
  `remaining_balance`), which is also the ONE place that answers "is this expense fully linked". Full
  as-built: `.claude/context/domain/outflow-import.md`.

---

## What was ADDED

### Status workflow (both doctypes)
- `status` Select field (`Requested/Approved/Paid`, default `Requested`) on the
  `Project Expenses` and `Non Project Expenses` doctypes.
- **Auto-approval** in each doctype's `validate` (create-time, `is_new()`-guarded):
  `project_expenses.py`, `non_project_expenses.py` — `0 < amount <= 10000` → `Approved`.
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
  backend auto-approve threshold (which still applies — see the amount rule above; it is
  ₹15,000 exclusive, not the ₹10,000 this line used to quote). No backend cap enforcement
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

**Owner ruling: the label mirrors the BACKEND predicate exactly** — which since 2026-09-15 is
`isAutoApproved` from `approvalTiers.ts`, NOT a number this module holds. `expenseApproval.ts`
owns COPY only; it had its own `10000` and drifted, quietly telling users "Send for Approval"
for amounts the backend had already auto-approved. The edges that must not be "simplified":
- **Exactly ₹15,000 → "Send for Approval"** — the lower edge is EXCLUSIVE, so the limit
  itself needs L1. ⚠️ This REVERSES the 2026-09-04 ruling that made exactly ₹10,000
  auto-approve; anything written against "exactly the limit auto-approves" is stale.
- **A refund (negative amount, which Non-Project explicitly supports) → "Send for Approval"** —
  it is "less than 15,000" but the sign blocks auto-approval and it takes the full path.
- A blank / unparseable amount → "Send for Approval" (`parseNumber` yields 0, which fails `> 0`).

Edit dialogs are untouched (create-only scope). ⚠️ `AUTO_APPROVE_LIMIT = 10000` (inclusive) now exists in
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

### Payments queue: expense pencil, raiser skip, approve-dialog details (2026-09-21)

Owner rulings; commits `0fc6cd146`, `9e73e97ed`, `fc4a3de42` on `develop`. Terms in `GLOSSARY.md`
(*Raiser's own step*, *Editing a record by status*).

- **A second edit surface, with its own gating.** The unified Payments queue (every tab, plus the
  project / customer Financials tables, which reuse `AllPayments`) carries an expense **Edit pencil**
  for **Admin, Accountant and Accountant Lead**, in every status except *Rejected*. One rule:
  `frontend/src/pages/ProjectPayments/config/queueRowActions.ts` (mirrors
  `services/role_profiles.PAYMENT_SETTLE_PROFILES`). `QueueRowEditDialog` opens the existing
  `EditProjectExpenseDialog` / `EditNonProjectExpense`. ⚠️ This is WIDER than the Expense module's own
  per-tab tables below (where Paid-edit is Admin-only). The two surfaces are gated independently.
- **Paid = UI lock only.** On a *Paid* expense the dialogs render Amount, Payment Date and Payment Ref
  read-only (`isPaidExpense`) and never send them. The server enforces nothing (see *Deliberate design
  decisions*).
- **Raiser skip.** Both doctypes' `validate` routes a new row with
  `initial_status_for_raiser(amount, TIER_L2_ABOVE_EXPENSES, raiser_level(expense_raiser(self)))`.
  `expense_raiser` = the **Expense Request's owner** when `request_id` is set: the ledger row is inserted
  by the reviewer, so its own `owner` names the wrong person. Steps the raiser clears are stamped
  (`approval_date` / `ceo_approval_date`) and are NOT `auto_approved`. `convert.target_status` makes the
  same call, so the review dialog's "lands at" matches.
- **The queue's Approve / Reject dialog now shows the expense.** `api/approvals/expense_detail.
  get_expense_approval_detail` (read-only, `has_permission` read on the row) feeds
  `ExpenseApprovalDetails`. It shows: type, amount, project, vendor, raiser + date, description (hidden
  when the request's labelled answers already say it), comment, invoice ref / date / file, the Expense
  Request's answers + reviewer + extra attachments, same-type-and-amount expenses in the last 60 days
  (`similar._scan_ledgers`, the row itself excluded), and whether this click finishes the approval or
  forwards it to the CEO. The CEO's partial-amount box is suppressed on expenses: the CEO expense
  approve is a plain status write and always approved the full amount.

### Payments queue: Upload / Edit invoice on Paid Non Project Expenses (2026-10-05)

Owner rulings; commit `5916af3d4` (branch `vendor/print-format`). On **"Payment Done / Reconciliation
Done"** a Paid **Non Project** expense row carries a small **Upload Inv** button, which becomes a green
**Edit Inv** once `invoice_attachment` is set. Admin, Accountant and Accountant Lead only.

- **Who / which rows: ONE rule**, `queueRowActions.canUploadInvoiceRow` (queue role AND Non Project Expenses
  AND Paid). ⚠️ **Project Expenses do NOT get it** — the owner first asked for both ledgers, then ruled PE
  out the same day; a PE invoice is edited through the pencil. PO / WO payments never: their invoices are
  Vendor Invoices.
- **State comes from the server:** `get_approval_queue`'s union carries `invoice` (the file) + a derived
  `has_invoice`; blank on payment rows; not sortable / filterable. Proved row-for-row identical before/after
  on every status.
- **Dialog = the Non Project page's own `UpdateInvoiceDetailsDialog`**, reused with
  `requireAttachment` (set ONLY by the Paid tab): Save stays disabled until the file AND the ref are
  there; removing the file in Edit mode disables it again. ⚠️ The Non Project page's **Record Invoice does
  not pass it** — a ref may be recorded there before the file arrives (18 Paid rows have a ref and no file),
  so do not tighten it globally. A future invoice date is refused (`max` alone does not stop a typed date).
- ⚠️ **`AlertDialogAction` closes its dialog BEFORE an async save runs.** The dialog used to vanish on a
  validation error, dropping the chosen file and saving nothing. Save now `preventDefault`s and closes on
  success only, and the dialog cannot be closed mid-upload. Any other AlertDialog-based save dialog has
  the same trap.
- **What a save does to a Paid row:** it goes through `doc.save()`, so the bank-line rules below run.
  Measured over all 846 Paid Non Project expenses (136 with live slips): 0 refused, 0 moved off Paid,
  0 payment dates moved.
- **Known, accepted:** an upload that succeeds followed by a refused save leaves its File row behind
  (retrying uploads again) — the same as every expense dialog. Two people editing one invoice: last write
  wins.

### Payments queue: All Payments returns; HR Lead view-only (spec #1470, #1476)

- **All Payments** (every PO / WO payment, Project Expense and Non-Project Expense, in every status) is
  back on the strip, right after "Payment Raised By Me", for **Administrator, Admin, Accountant,
  Accountant Lead, PMO Executive, HR Executive and HR Lead**. Procurement, Project Lead and Project
  Manager do not see it; a deep link still opens it for them. The rule is
  `frontend/src/pages/ProjectPayments/config/paymentsTabSet.ts`.
- **Its badge** is `get_approval_queue_counts`'s `all`: every readable ledger, every status, the same
  rows the tab lists (`test_approval_queue_counts`). Not the payments-only store count.
- **Row actions:** the Actions column shows only to the queue edit profiles (`canWorkQueueRows`), so
  PMO and HR see none.
- **HR Lead** gets the Project Payment & Expense sidebar entry, **view-only**: HR Executive's tab set
  (Reconciliation Pending, Payment Done, Payment Raised By Me, All Payments; Payments Pending by link),
  landing on "Payment Raised By Me". No Add Expense button and no write right (its profile holds no
  System Manager; see *Known asymmetries* below).

### Four server rules protect an expense its bank lines settle (ADR-0027 Q11/Q22, #1302)
Both expense doctypes share ONE controller, `integrations/controllers/expense_bank_links.py`, wired in
`hooks.py` on `validate` + `on_trash`. The refusals themselves are pure functions in
`services/outflow_import/expense_links.py` (`amount_below_links_refusal`, `paid_while_short_refusal`,
`delete_while_linked_refusal`; rule 4 is `derive_expense_status`):
1. the amount may not drop below the linked total (₹5 leeway);
2. a hand-set `Paid` is refused while the linked total is short;
3. deleting is refused while live `Settled` slips exist;
4. every save re-derives `Paid` ⇄ `Reconciliation Pending` and the payment date from the slips — so
   RAISING an amount above the linked total moves a `Paid` expense back to `Reconciliation Pending` and
   clears its payment date.

⚠️ **Every rule is inert until the expense has live `Settled` slips** — an expense nothing has linked to
behaves exactly as before, and that gate is what lets the import's own Unreconcile put an expense back.
⚠️ **Rule 2 asks about a TRANSITION into `Paid`**, never the state, or it would refuse the very edit rule 4
exists to allow. ⚠️ **There is no bypass flag for the import** — it writes the slip first, then saves, so
its own writes satisfy the rules by construction. These rules hold from EVERY door: the Payments tab, the
old expense pages, Desk and Data Import. Detail + the read-only Bank-lines card on the Payments & Expenses
table (#1303): `.claude/context/domain/outflow-import.md`.

### Paid-only financial rollups (only settled spend counts)
Every cross-surface expense calculation now filters `status = "Paid"`:

| Surface | Where |
|---|---|
| CEO-Hold **cashflow gap** + Projects-list outflow (backend) | `services/project_money.py` (`project_money`), read by `_compute_cashflow_gap` and `get_projects_financial_rollup` |
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
- **An expense's own Files go through `stored_files.delete_files`** (`expense_files.delete_attached_files`,
  the LAST `after_delete` handler on both expense doctypes, spec #1442): a File sharing its stored bytes
  with another (a Porter invoice PDF) loses only its record. It runs mid-transaction, against
  `delete_files`' "call it last" rule, and no later than before: Frappe's own `remove_all` trashed the same
  Files at this same point of `delete_doc`, so a rollback after it could not restore a stored object either.

### PO adjustment
- The ad-hoc adjustment expense is created directly as **`Paid`** (money has already moved)
  — `api/po_adjustments/adjustment_logic.py`. Its type must be project-flagged: the picker lists
  `project=1` types only, and `execute_adjustment` refuses any other before it makes a payment (#1496).

### Data normalization (ADR 0009)
- Patch `v3_0.normalize_project_expense_types`: repoints Project Expenses using 6
  non-project-flagged types (Printing & Stationery, Staff Welfare, Hotel, Postage & Courier,
  Pooja, Travel (Flight)) → **Other Project Related Charges** (renamed Other Project Expenses
  2026-10-19). Type-only raw `UPDATE`,
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
- **Add Expense on Project Payment & Expense** (`/project-payments`, the Project Expense /
  Non-Project Expense dropdown): one pure, tested gate,
  `pages/ProjectPayments/config/addExpenseGate.canAddExpense` — the `Administrator` user, Admin,
  Accountant\*, every procurement profile, HR Executive and PMO Executive; not HR Lead, Project
  Lead or Project Manager. It hides the button only: the Direct Expense endpoint's `create` check
  is the boundary.
- **PMO Executive's create right sits on its own role** (#1475): the `Nirmaan PMO Executive` DocPerm
  on `Project Expenses` and `Non Project Expenses` is create + write + read, no delete (a DocType
  save in developer mode, not a hand-edit). Before it held read only, and a PMO save worked only
  because the PMO profile also carries System Manager; the right is on the role so it survives
  System Manager coming off that profile. It grants no approval or settle tab: the 2026-09-17 PMO
  access review stands (`paymentsTabSet` is unchanged).

### Non-Project Expenses — actions per tab
Primary actions render inline; secondary (Requested-only) sit in a `⋯` overflow menu.

| Tab | Action (placement) | Admin | PMO | Accountant\* | Procurement | HR |
|---|---|:--:|:--:|:--:|:--:|:--:|
| Requested | Approve (inline) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Requested | Delete (inline) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Requested | Record Invoice (⋯) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Requested | Edit (⋯) | ✅ | ✅ | ❌ | ✅ | ✅ |
| Approved | Mark as Paid (inline) | ✅ | ❌ | ✅ | ❌ | ❌ (server-refused since #1497) |
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
| Approved | Mark as Paid | ✅ | ❌ | ✅ | ❌ | ❌ (server-refused since #1497) |
| Approved | Delete | ✅ | ❌ | ❌ | ❌ | ❌ |
| Paid | Edit / Delete | ✅ | ❌ | ❌ | ❌ | ❌ |
| All | per row, by row status | ✅ | ❌ | ✅ | ❌ | ✅ |

Actions column visibility: same rule as Non-Project.

### Known asymmetries (by design — do NOT "fix" without owner sign-off)
- **Accountant\* Edit split:** can Edit a Requested **Project** expense but not a Requested
  **Non-Project** one (their Non-Project Requested action is *Record Invoice* instead).
- **Approve = Admin only; Delete = Admin only** in both tables.
- **HR Executive no longer Marks as Paid (#1497)**: the server allows Admin and Accounts only. It still
  lands on the `Requested` tab by default (only Accountant\* defaults to `Approved`), owner call 2026-07-28.
- **Approve and Mark as Paid are server-checked** (`services/expense_decision`, #1497); the rest is **frontend-only** (button/column visibility)…
  **with one caveat that IS a real backend gate:** the `Nirmaan HR Executive` *Role* has
  `write = 0` on both expense doctypes. Mark-as-Paid works only because the
  `Nirmaan HR Executive Profile` *also* carries **System Manager**, and Frappe permissions are
  a UNION across roles. ⚠️ **`Nirmaan HR Lead Profile` = `[Nirmaan HR Lead, Nirmaan HR Executive]`
  with NO System Manager, so it has genuinely no write.** It is not matched by the
  `role === "Nirmaan HR Executive Profile"` check, so it is safe today (0 such users) — but
  do NOT extend any write action to HR Lead without adding a real DocPerm first. (PMO
  Executive was in the same position until #1475 gave its role create + write; see
  Module visibility & create.)

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
- Queue surface (2026-09-21): `pages/ProjectPayments/config/queueRowActions.ts`,
  `components/QueueRowEditDialog.tsx`, `approve-payments/components/ExpenseApprovalDetails.tsx`
  (+ pure `expenseApprovalDetail.ts`); backend `api/approvals/expense_detail.py`,
  `services/approval_raiser.py`, `services/approval_tiers.py` (`initial_status_for_raiser`).
- Reports/aggregation: `pages/reports/hooks/useOutflowReportData.ts`,
  `useProjectReportCalculations.ts`, `pages/projects/data/root/useProjectRootApi.ts`,
  `pages/ProjectPayments/PaymentSummaryCards.tsx`.

## Patches (append-only)
- `v3_0.backfill_project_expenses_status`
- `v3_0.backfill_non_project_expenses_status #v3` (was #v2 — now sweeps all legacy → Paid)
- `v3_0.normalize_project_expense_types`

## Expense Request — the PM-raised ask (2026-08-18)

A **request is not an expense.** `Expense Request` is a separate doctype that appears in NO
financial rollup; approval is what creates the real ledger row. It DOES reach `Paid`, but only
as a MIRROR of the ledger — the row is what gets paid and the request follows it.
Full rationale: `docs/adr/0016-expense-request-vs-expense.md`.

```
PM raises  ->  Pending Approval  ->  routed reviewer
                                       |- Reject (comment required)  -> terminal
                                       `- Approve -> ONE ledger row, status "Approved"
                                                     -> Accountant marks Paid
                                                        -> request follows to Paid (hook)
                                                     -> ledger row DELETED
                                                        -> request deleted with it (hook)
```

### Schema

| Doctype | |
|---|---|
| `Expense Request` | NEW — 10 columns: `type` · `type_allows_project` · `projects` · `amount` · `comment` · `source_data` · `status` · `reviewed_by` · `reviewed_on` · `review_comment`. `status` is `Pending Approval` / `Approved` / `Rejected` / **`Paid`** |
| `Expense Request Template Snapshot` | NEW — freezes the format a request was filled against |
| `Expense Category` | NEW — `category_name` · `description` (`reviewer_role` REMOVED 2026-09-16) |
| `Expense Type` | `+source_format` (Long Text, JSON) · `+expense_category` (Link) · `+source_format_enabled` (Check, "Enable Source", 2026-09-16) · `+allowed_roles` (Table → `Expense Type Role`, 2026-09-16) |
| `Expense Type Role` | NEW child table (2026-09-16) — `role_profile` (Link → Role Profile) |
| `Project Expenses` / `Non Project Expenses` | `+request_id` (Link → Expense Request, read-only, indexed). Otherwise unchanged — approval writes a row through the existing schema |

### Load-bearing invariants

- **There is NO `expense_kind` field.** The PRESENCE of `projects` decides the target ledger,
  and the doctype `validate` checks it against the type's `project` / `non_project` flags:
  project-only requires one, non-project-only forbids one, both makes it optional
  (`Petty Cash` is the only both-flag type). `type_allows_project` is a `fetch_from` mirror
  of `Expense Type.project`, existing ONLY so `depends_on` can hide the field — Frappe cannot
  evaluate a linked doctype's field. Never treat the mirror as authority; `validate` reads
  the master.
- **⚠️ THE LEDGER'S OWN THRESHOLD DECIDES THE STATUS (owner ruling, 2026-08-20 — REVERSING
  the earlier "created at `Approved`, never `Requested`").** `create_ledger_row` no longer
  sets `status`, so the row is born at the ledger default `Requested` and each doctype's
  `validate` applies the rule it applies to any directly-entered row — identical on both:
  `0 < amount < ₹5,000` auto-approves, `₹5,000` or more stays `Requested`, and a zero or
  negative (a refund) stays `Requested`. **The fix was a DELETION, not a new branch:** setting
  the status was precisely what bypassed the rule, because `validate` returns early once the
  status is anything other than `Requested`.
  **⚠️ CONSEQUENCE, ACCEPTED BY THE OWNER: an expense of ₹5,000 or more is NOT payable on
  approval alone** — it needs the ledger's own Approve, which is admin-only. The prior
  measurement that argued against this still stands as a RISK, not a refutation: on
  2026-08-17 all 8 rows at `Requested` were stranded, the oldest 3+ weeks, while 99% of
  expenses went straight to `Paid`. If nobody works that queue, a large approved request
  never gets paid.
- **The reviewer gate is SERVER-SIDE** (`api/expense_requests/access.guard_reviewer`), unlike
  the rest of this module. It refuses two distinct ways — wrong role, and own request — and
  runs before any write, so a refusal mutates nothing. Admin passes both (they are the
  fallback reviewer for every unrouted category).
- **Records without review (spec #1494, #1498).** A raiser whose profile is on the single
  `Expense Settings` list (`records_without_review`, `Expense Type Role` rows), or any Admin, has
  the request approved on submit: `create.create_expense_request` creates the Expense in the
  same transaction, sets the request `Approved` and `approved_on_submit = 1` and leaves
  `reviewed_by` blank. The Expense's status still comes from the ledger `validate`
  (`expense_decision.apply_starting_status`), so it skips the Reviewer, never the amount rule:
  HR ₹40,000 lands at Requested for an Admin. The one question "is this raiser on it" is
  `access.records_without_review(user)`; the dialog reads it from `get_request_catalog`. The
  list is NOT a fixture (Admin edits survive migrate); `Expense Settings.validate` refuses the
  Admin profile and any profile that can raise no type (`access.profile_can_raise`); the
  Expense Packages read drops a listed profile that has since lost all its types. Seeded once
  by `v3_0.seed_records_without_review` (Accountant, Accountant Lead, HR Executive, HR Lead).
  Edited only through the admin-gated `api/expense_requests/expense_settings`.
- **⚠️ `Expense Type` IS A FIXTURE, so `fixtures/expense_type.json` is AUTHORITATIVE.** Every
  `bench migrate` re-imports each row and RESETS any field the file does not carry. When
  `source_format` and `expense_category` were added and the fixture was not regenerated, ONE
  migrate silently destroyed all 40 request forms and every category assignment — no error,
  discovered only because tests went red. **After authoring a format or re-categorising a type
  in the app, run `bench --site <site> export-fixtures --app nirmaan_stack` and commit**, or
  the next migrate reverts it. `Expense Category` is a fixture too, because it is a Link target
  and would otherwise dangle. Guarded by
  `api/expense_requests/test_fixture_completeness.py`, which fails naming the missing field —
  and which was verified by reproducing the bug, not merely by passing.
- **Every expense request is reviewed by `Nirmaan Admin Profile`.** `Expense Category.reviewer_role`
  ("Reviewed By") was REMOVED on request 2026-09-16 — every category had it blank, so no live
  routing changed; categories now only group types. Read through
  `services/expense_request_routing.py` (which REPLACED the temporary
  `services/expense_request_catalog.py`, deleted 2026-08-18) — it caches per request, because
  `get_permission_query_conditions` runs on every list read. **Categories are created in Frappe
  Desk.** Since 2026-09-16 the category is **not shown anywhere in the app** (request picker or
  Expense Packages): a new type is saved as `Uncategorized`, an edit keeps the current one.
- **"Enable Source" switch (`Expense Type.source_format_enabled`, 2026-09-16).** ON → the
  request dialog shows the type's `source_format`; OFF → the STANDARD fields a direct expense
  needs: Description (required), Vendor (required once a project is chosen; "Others" allowed —
  UI-only, the server cannot tell it from blank) and optional invoice details. Those ride
  `source_data` under minted keys (`responses.detail.description`,
  `responses.invoice.{invoice_date, invoice_ref}`, `attachments.invoice`) and approval copies them
  to the ledger's invoice columns (`flatten.native_invoice`). **Cannot be ON without a format**
  (doctype `validate`); clearing a format switches it OFF (`save_expense_format`). ONE rule picks
  the governing form — `convert.applicable_format`: the switch, EXCEPT a request already filled
  against the form (`templateId` in its answers) keeps it after the switch goes off. **Only the
  OFF side is server-enforced** (`create.guard_request_form`: description, refuses form answers);
  a form's own required answers are still dialog-only, as before.
- **The invoice is asked once, the same way, for every type (#1502).** "Do you have the invoice?"
  replaces the "Add invoice details" tick. It rides `source_data` under the native keys
  (`responses.invoice.{invoice_date, invoice_ref}`, `attachments.invoice`) on a form-filled request
  too, so **no form may name a section `invoice`**; it never reaches the ledger description
  (`flatten_source_data(skip_sections=)`, `undeclared_pairs`). Approval copies it onto the Expense's
  invoice columns (`convert.create_ledger_row`; a form slot with `maps_to: invoice_attachment` is read
  only for requests raised before, and the dialog no longer shows such a slot). **A missing invoice
  date or number is a warning, never a refusal**: `flatten.invoice_warnings`, returned as `warnings`
  by create, update and Add invoice. **Added later** from the request's page
  (`/expense/requests/<name>`, `read.get_expense_request`) by the raiser or an Admin, until the Expense
  is Paid (`invoice.invoice_refusal`, the one rule; refused on a Rejected request).
  `invoice.add_request_invoice` REPLACES the request's invoice and writes the same three columns on
  its Expense (`doc.save`, hooks fire). The file is uploaded when picked, so Gemini
  (`invoice_autofill.extract_invoice_fields`) can fill the date and number; the amount is never
  filled, a differing total only warns (`utils/newExpenseForm.invoiceNotes`).
- **Per-type visibility (`Expense Type.allowed_roles`, 2026-09-16).** Role PROFILES that may pick
  the type in the request dialog; Admin sees every type and is never listed, so **EMPTY = Admin
  only**. Enforced in `access.can_request_type` → `get_request_catalog` filter + `guard_requestable`
  (create; update only when the type CHANGES, so narrowing roles never strands a pending request —
  the edit dialog passes `include_type`). Scope is the REQUEST dialog only: ledger dialogs, outflow
  import and the request list are untouched.
  **Owner's role mapping (2026-09-16, in the fixture)** — Project Manager + Project Lead:
  Accommodation Deposit, Rent/PG for Staff, Rent/PG for Labour. Accountant + Accountant Lead: Audit
  Fee, GST Payment, TDS Payment, Other Project Expenses, Professional Charges. HR Executive + HR
  Lead: Electricity Expenses,
  Fixed Assets, Internet & Mobile Charges, Software Chagres. **Every other type is
  Admin only.** "Salary – TDS" and "Misc. Expenses" had no matching type and are unassigned.
  To make that mapping usable, `create` on Expense Request was granted to Nirmaan Accountant,
  Accountant Lead, HR Executive and HR Lead (they held read + write only). The test suite grants
  the PM profile on the real types it uses for its run and removes exactly those rows after.
- **Remove an Expense Type: delete it on the site AND drop it from `fixtures/expense_type.json`.**
  The fixture ships every type, so a type deleted only on the site comes back on the next
  `bench migrate`. Fixture sync only inserts and updates; it never deletes, so dropping a type from
  the fixture does not remove it from a site that has it. Removed both ways (2026-10-19): Rent
  Expenses, Professional Tax, Loan Received, Interest Received, Fixed Deposit Proceeds, EPFO
  Payment, Advertising & Marketing, Advance Returned. Manpower Rent too, after its expenses were
  moved to Staff Accommodation Rent (now Rent/PG for Staff).
- **Renamed by SQL (2026-10-19), every reference moved, plain-text columns included:** Staff
  Accommodation Rent → Rent/PG for Staff, Labour Accommodation Rent → Rent/PG for Labour, Other
  Project Related Charges → Other Project Expenses. `duplicates.RULES` is keyed by type name, so a
  rename must rename its key too, or that type's duplicate check silently switches off.
- **Merged by SQL (2026-10-19):** Salaries & Employee Wages → the existing Salary - Employee Payout
  (every Link, Dynamic Link and plain-text column), and Salaries & Employee Wages dropped from the
  fixture. Salary - Employee Payout is not in the fixture; it lives on the site only.
- **Removed (2026-10-19), no record used it:** Other Financial Expenses, from the site and the fixture.
- **Rename an Expense Type — ADMIN ONLY (2026-09-16).** Expense Packages → Rename →
  `masters.rename_expense_type`, which runs Frappe's model-level `rename_doc`. That moves the
  docname, `expense_name` (the autoname field), the `allowed_roles` child rows and every LINK to
  the type: `Project Expenses.type`, `Non Project Expenses.type`, `Expense Request.type`,
  `Outflow Import Expense Rule.expense_type`.
  **⚠️ Two places KEEP THE OLD TYPE NAME, by owner ruling — they store it as plain text and are
  deliberately not rewritten:** `PO Adjustment Items.expense_type` and
  `Outflow Import Row.suggested_expense_type`. A type-name search across those will not find the
  renamed type's history.
  **Refused** for any name the code looks up by name (`masters.names_referenced_in_code`: today
  only `outflow_import.cashbook.FALLBACK_EXPENSE_TYPE` "Petty Cash"), since a rename would silently
  switch off the bank-import fallback.
  **⚠️ NO PER-TYPE DUPLICATE RULES (owner ruling 2026-09-19).** The `duplicates.RULES` table (6
  types, matched on person/building + overlapping dates) was REMOVED with its create-dialog
  warning and the review dialog's "Already requested for this period" box: it keyed on the type's
  NAME, so it blocked renaming those types, and the owner did not want static rules. The approver
  still sees `similar.get_similar`'s same-type + same-amount count over the last 60 days. Do not
  bring back a name-keyed rule table.
  **⚠️ Update `fixtures/expense_type.json` too** — it is keyed by name and re-imported on every
  migrate, so an app rename alone comes back after the next deploy as a SECOND type under the old
  name.
- **⚠️ THERE IS NO ROW SCOPING ON READS (owner ruling, 2026-08-18).** The
  `permission_query_conditions` hook was REMOVED, so a list read returns everything the
  caller's ROLE may read — and **eight roles hold read DocPerm** (System Manager, PM, HR
  Executive, HR Lead, Accountant, Accountant Lead, PMO Executive, Project Lead), so a PM sees
  other PMs' personal claims. `access.get_permission_query_conditions` still EXISTS and is
  still correct, but nothing calls it; re-wiring is a one-line hooks entry. `can_review`
  narrows who may ACT on a row, never who may SEE one. `get_my_expense_requests` still uses
  `frappe.get_list` over `get_all` — the latter would ignore the DocPerm too. Pinned by
  `test_a_pm_sees_another_pms_request`, which flips if the hook ever returns.
- **⚠️ THE LINK POINTS BACKWARDS: the LEDGER carries `request_id`, not the reverse**
  (owner ruling, 2026-08-18; `created_expense` was removed). A ledger row may be raised
  DIRECTLY with no request at all, so the side that may or may not have a counterpart is the
  side that carries the field. It also puts the Paid hook one field access from the request
  instead of a reverse query. **A `Link` is a REFERENCE, not ownership** — the same field type
  points that row at its Project, Vendor and Expense Type — so Frappe blocks deleting the
  REQUEST while an expense names it, and does nothing about the reverse. Only child tables
  cascade.
- **⚠️ THE LEDGER OWNS `Paid`.** `Expense Request.status` reaches `Paid` through
  `integrations/controllers/expense_request_status.on_expense_paid` and NOWHERE else — no
  endpoint, no button, no reviewer action. Payment happens on the expense row, so the request
  can only report what the ledger already did; a second writer would let the two disagree
  about whether money moved. It rides the ledger's own transaction (both land or neither),
  guards on the TRANSITION into Paid, and flips only `Approved → Paid` — a whitelist of the
  one legal predecessor, because anything else means our model of the flow is wrong and
  overwriting would erase the evidence. It uses `set_value`, so this transition writes NO
  `Version` row; the audit lives on the ledger row, which carries the payment date, reference
  and attachment.
- **⚠️ DELETING THE EXPENSE DELETES THE REQUEST** (`on_expense_deleted`, owner ruling
  2026-08-18) — and it MUST be `after_delete`, never `on_trash`: `on_trash` fires BEFORE the
  row leaves the database, so the expense still points at the request and Frappe refuses
  (`LinkExistsError`). The cashflow recompute on the same doctype moved to `after_delete` for
  the same class of reason, and so does the Files delete (`expense_files.delete_attached_files`, after the
  link checks: a refused delete deletes no bytes). **It clears the request's notifications FIRST, and that is not
  tidiness — it is what makes the delete possible**: `Nirmaan Notifications.docname` is a
  **Dynamic Link**, and Frappe's delete guard walks dynamic links, so any rejected or paid
  request carries a notification that would block it. `ignore_links=True` is the WRONG fix —
  it leaves bell entries pointing at a record that no longer exists. Not swallowed: the
  expense is already gone, so a failure rolls back and NEITHER is deleted.
  **⚠️ COST, accepted by the owner: this destroys the only copy of the request detail** —
  `source_data` is the sole home for what was asked, so a delete-and-redo loses the original
  ask and the requester's record of it.
- **A REJECTED request with no Expense can be deleted by its raiser or an Admin** (spec #1494,
  `api/expense_requests/delete.py`). `delete_expense_request` refuses any other status, anyone
  else (`PermissionError`), and a request any Expense row still points at through `request_id`:
  that request goes only with its Expense (above), including one that reads Rejected because
  its Expense was rejected. It clears the notifications first, for the same Dynamic Link
  reason. `can_delete` is server-computed on `get_my_expense_requests` like `can_edit`; the
  trash button shows on "Raised By Me" and "All".
- **The edit pencil shows on "Raised By Me" as well as "Pending Approval"** (spec #1494).
  The rule is unchanged (`update.can_edit`: raiser or Admin, Pending only). Before this, a
  Project Manager could never reach it, because only reviewers get the pending tab. Approve /
  Reject stay on the pending tab. The Request ID cell carries a hover card
  (`RequestHoverCard.tsx`) that renders the scoped read's `detail`; rows past that read's
  200-row cap get no Edit / Delete and a header-only card.
- **A reviewer is a `Nirmaan Users.role_profile`, NEVER a Frappe Role.** The Role Profile
  `Nirmaan Admin Profile` grants `Nirmaan Project Manager` among seven others, and a Role of
  that exact name is assigned to nobody — a `frappe.get_roles()` gate would match no one and
  read every Admin as a PM.
- **⚠️ THERE IS NO `description` FIELD — `source_data` IS THE ONLY HOME FOR THE DETAIL**
  (owner, 2026-08-18). With a format that is the answers; without one it is the typed
  description, stored under the synthetic `detail.description` key exactly as the dialog
  writes it. One home means the approval dialog, the ledger description and the flatten all
  read the same place and none of them can hold a second, disagreeing copy. The field was
  removed from the doctype AND its orphan column dropped (a Frappe field removal leaves the
  column behind; `information_schema` is the truth, `frappe.db.has_column` reads a cache).
- **`comment` deliberately reuses the ledgers' own field name**, which is what makes that
  part of the conversion a straight copy with no mapping table.
- **A FORMAT-LESS REQUEST IS FLATTENED VALUES-ONLY ONTO THE LEDGER.** Its key is one WE mint,
  not one the requester saw, so labelling it would print "Description:" on the ledger as if
  they had written it. A formatted request DOES print its labels — those are the questions
  they actually answered.
- **Master writes are ADMIN-GATED endpoints** (`api/expense_requests/masters.py`), not client
  `updateDoc`: `Expense Type` carries `write = 1` for ~15 roles including Project Manager, so
  a raw write would let a requester edit the scope and form governing their own requests.

### Formats

`Expense Type.source_format` holds a JSON form; `Expense Request.source_data` holds the
answers. Authored in **Packages Settings → Expense Packages → Format**, which **refuses to
save an invalid template**.

- **THE VALIDATOR IS THIS MODULE'S OWN** (`utils/expenseFormat.validateFormat`), NOT
  commissioning's `parseTemplate`. It shared that parser until the sharing was found to cut
  both ways: commissioning's binding allowlist is project-scoped, so it REFUSED every expense
  format using `bind: "user.full_name"` — five of seven shipped formats could not be saved
  through the editor — while simultaneously ACCEPTING section types (`checklist`, `matrix`,
  `rowsTable`) that `FormatFieldsRenderer` cannot draw, letting a format save clean and reach
  a requester with a section missing. The two systems do not share a grammar. Do not re-couple
  them: the expense validator tracks the expense RENDERER, which is the invariant that
  matters.

- **Empty is normal and valid** — 33 of 40 types have no format and use the plain form.
  Unlike commissioning, an unauthored format must never block a request.
- **`Expense Type.source_format` is the ONLY home.** There is deliberately no seed file and
  no reference copy in the repo (owner ruling, 2026-08-18): a second copy drifts the moment
  someone edits a format in the app, and the rule "remember to mirror it" is one that depends
  on remembering. New environments restore a production backup, so the formats travel with the
  database. Read a live format from Desk or `get_expense_format` — never from a checked-in file.
- **A format NEVER declares a field named after a native column** (`comment`,
  `amount`, `type`, `projects`). Those are real columns the ledger row is built from; a format
  field of the same name would record the value twice and let the two disagree.
- **A request names who gets paid: its own pay-to account** ([ADR-0033](../../../docs/adr/0033-payee-is-one-bank-account.md)
  is the source; it retired the 2026-08-18 rule that a request asks for no payee bank details).
  Built by #1429, reworked by #1436 (spec #1420):
  - `Expense Type.payee_rule` (*Who gets paid*): *Required*, *Optional* or *Not asked* (the
    default). Set in Expense Packages' Edit dialog (`masters.update_expense_type`). ⚠️ It is a
    fixture field like the rest of the type, so a value set in the app is reset by the next migrate
    unless the fixture is re-exported.
  - **The pay-to account** (#1436): `Expense Request`, `Project Expenses` and `Non Project Expenses`
    each hold `pay_to_account_name`, `pay_to_account_number`, `pay_to_ifsc`, `pay_to_bank_name`,
    `pay_to_bank_branch`, a COPY of a Payee's account taken when the record is raised; nothing links
    back to the Payee, so editing or deleting it changes no copy. The one copy function is
    `services/payees/pay_to.copy_payee_account`. The three doctypes have no `payee` link (#1438).
  - **Raising** (`create_expense_request`): the `payee` sent (picked, or just added through
    `api/expense_requests/payees.add_request_payee`) is copied in, unless the request names a vendor.
    **Editing** (`update_expense_request`): `keep_pay_to=1` leaves the copy as it is; otherwise the
    `payee` sent is copied (none clears it). Both through `pay_to.apply_picked_payee`, which refuses
    a Payee that does not exist. A **Direct Expense** (#1471) is recorded the same way:
    `api/expenses/direct_expense.create_direct_expense` (rules in `payees.md` § Expense payee).
  - **A vendor named** (request or Project Expense, every write path): the save hook copies the
    vendor's Payee when the record has no copy and whenever the vendor changes, until the record is
    paid (`pay_to.fill_from_vendor`, from `guard.check_payee_links`). New expense dialogs, Bulk
    Import's create-expense and adjustments get it this way. Clearing the vendor leaves the copy.
  - **Records raised before the pay-to account** were filled by `patches/v3_0/backfill_pay_to_accounts`
    (#1441): unpaid ones from the vendor's Payee, paid ones from their settled bank line, the rest
    blank. Rules: `payees.md`.
  - **No server refusal** (#1436, owner 2026-10-15): *Required* with no account, a vendor and an
    account that disagree, a change after payment, a change outside Accounts are all accepted. They
    are screen rules: the request dialog blocks sending a *Required* type with no account
    (`utils/payees/expensePayee.whoGetsPaidProblem`) and shows a vendor's account read-only.
  - Approval (`convert.create_ledger_row`) copies the request's pay-to account onto the Project or
    Non-Project Expense AS IT IS (`pay_to.copy_pay_to`): the vendor's Payee is not read again. The
    reviewer sees it: `get_my_expense_requests` rows carry `pay_to` (`pay_to.pay_to_account`).
  - The dialog's picker (search, add new, the vendor's Payee) calls `api/expense_requests/payees`,
    gated on `access.can_raise_requests`, never the Accounts-only `api/payees/` endpoints.
  - Record Payment's "Pay ₹X to" box reads the expense's own copy; its Change account
    (`expense_payee.change_expense_account`, #1438; Accounts, an approved, unpaid expense with no
    vendor, a screen rule) overwrites the copy with a picked or added Payee's account, recorded with
    who and when (`.claude/context/domain/payees.md` § Paid to).
  - **No format asks for bank details or who gets paid as free text** (#1430): the Payroll
    (Salaries & Employee Wages, since removed), Accommodation Deposit and Rent/PG for Staff "Payee Bank Details" sections, and the
    fields that only named the payee (Rent's landlord, the Deposit's landlord / PG, Payroll's
    employee, the "Paid To" of Office Maintenance, Pooja, Other Financial (since removed) and Staff Welfare), are
    gone. Those types ask for a Payee instead: *Required* for Accommodation Deposit (paid by
    transfer into the landlord's account, and recovered from it),
    *Optional* for the other four (card, cash, or a batch with no single payee). The choice
    is pinned by `api/expense_requests/test_request_forms.py`, which also refuses a bank field or a
    `description_template` placeholder naming a field the form no longer asks. Bank Interest's
    "Bank Account No." stays: it is the company's own account, not who gets paid. Supplier-name
    fields (Service Provider, Print Vendor, Firm / Consultant, Supplier, ...) stay, and those
    types stay *Not asked*.
  - **Old requests keep their text.** Their answers stay in `source_data`; a request raised
    before a field was removed and approved after gets those answers after the format's sentence,
    labelled from the key (`flatten.undeclared_pairs`, used by `convert.compose_description`).
    Ledger descriptions already written are never rewritten.
- **ONE FORMAT PER EXPENSE TYPE** (owner, 2026-08-18), replacing an earlier shared
  accommodation shape. A staff PG, a labour dorm, a deposit and a hotel booking are four
  different questions, and the evidence differs per type: all 7 live Staff rows name exactly
  ONE person (so it never asks a count), while the single Labour row reads
  `4x6500=26000` (so it is the only one that does). Hotel does not re-ask the accommodation
  type — the expense type already says Hotel. **There is no reference copy in the repo** — see
  the ONLY-home rule above; read a live format from Desk or `get_expense_format`.
- **The travel MODE is the expense TYPE** (Bus / Train / Flight), never a field — a `mode`
  field would record it twice and let the two disagree.
- On approval the answers become the ledger `description` through **THREE renderings, best
  first** (`convert.compose_description`), with the request id appended in every case:
  1. the format's own `description_template` — a written sentence;
  2. no template → the labelled flatten, `Label: value · Label: value`;
  3. no format at all → the values, joined, unlabelled.

  Envelope keys (`templateId`, `filledAt`, …) are stripped; **`0` and `False` are kept**
  because a recorded zero is an answer. The id stays even though `request_id` now exists:
  2,586 shipped descriptions already carry it and several tests assert it. Removing it is its
  own change.
- **`description_template` is CONFIG, living in the format beside the fields it names**, so
  making a type read well is an edit to that type and touches no code. Two placeholder kinds,
  and the difference is the whole safety story: **`{key}` is REQUIRED** — no answer means the
  sentence would have a hole in it, so the WHOLE render is abandoned and it falls back to
  rendering 2, because a half-written sentence reads as complete and is worse than a form
  dump; **`[[… {key} …]]` is an OPTIONAL SPAN**, dropped whole when any answer inside it is
  missing, which is what stops a skipped field leaving `", ,"` behind. ISO dates become
  `1 Aug 2026`. **The placeholder is the field `key`, never its label** — rename a key and the
  template must be renamed in the same edit, or it silently stops working with no error
  anywhere. Live on Rent/PG for Staff and all three Travel types (each stating its own
  mode, since the mode is the TYPE).
- An attachment slot may declare `"maps_to": "invoice_attachment"` — at most one per format;
  the first declaring slot wins and a format declaring none carries no file.

### Notifications

Bell + realtime, **no Firebase push** (the Reminders precedent). **TWO events** (owner
ruling, 2026-08-18), both addressed to the REQUESTER:

| Event | Fired from | `event_id` |
|---|---|---|
| rejected | `review.reject_expense_request`, carries the reason | `expense_request:rejected` |
| paid | `integrations/controllers/expense_request_notify.on_expense_update` | `expense_request:paid` |

- **⚠️ APPROVAL IS DELIBERATELY SILENT.** Approve and Paid are one story to a requester and
  the money has not moved yet, so the approval message was noise that cost attention from the
  one that matters. `notify_decided` KEEPS its `decision` parameter so an APPROVED call is a
  documented no-op rather than a crash — the safe direction, enforcing the rule from any
  future call site. Consequence, accepted: a requester now gets no signal at all between
  raising and payment.

- **A notification must never break what it reports.** Every entry point is wrapped so a
  failure is logged and swallowed — an approval that succeeded must not roll back because a
  bell message could not be written.
- **The Paid hook is deliberately narrow.** It fires on EVERY save of BOTH ledgers (~3,300
  rows that have nothing to do with a request), so it exits on `status != Paid` first, then on
  `has_value_changed("status")` — the TRANSITION, not the state, so editing an
  already-Paid row does not re-notify. Only then does it read `request_id` off the row — one
  field access, no reverse query. Pinned by a test asserting an ordinary paid expense notifies
  nobody.
- **The bell CARD shows expense facts, not the stock procurement lines.** `Project` /
  `Work Package` / `Action By` are procurement-shaped and an expense notification sets none of
  them, so it rendered three blanks and one "Administrator". `components/nav/
  expenseNotificationDetails.ts` (pure) builds the lines instead, keyed on
  `document === "Expense Request"`. **Nothing extra is stored on the notification** — the
  ledger comes from whether the request names a project (the same rule as `target_doctype`),
  the type and approver from the request, and "Paid By" is the notification's own `sender`.
  ONE batched read for the whole screen, skipped when no expense notification is present. A
  rejection deliberately gets fewer lines: no ledger row and no approver exist, so printing
  them would state something untrue.
- **`Non Project Expenses` gained its FIRST `on_update` hook** for this; `Project Expenses`
  keeps the CEO-Hold handler and takes this as a LIST, so neither replaces the other.
- `action_url` is always `expense/requests` — the requester cannot see the ledger row.

### Testing gotcha

`test_expense_requests.py` runs against the LIVE site. A test that mutates a type's
`source_format` MUST capture the original and restore **that** — `addCleanup(..., None)`
silently wiped the shipped Travel (Bus) format once. Use the suite's `_set_format` helper.

---

## Cross-references
- Glossary: `GLOSSARY.md` → "Expense workflow & settlement" (incl. *linked total*
  under *Reconciliation Pending*, and *Bounced transfer*).
- Decision: `docs/adr/0009-project-expense-type-normalization.md`.
- Decision: `docs/adr/0016-expense-request-vs-expense.md` (request vs expense).
- Decision: `docs/adr/0027-many-lines-one-expense.md` — many bank lines settle one expense.
- Plan / as-built: `.claude/plans/expense-request-plan.md`.
- Bank-line settlement as-built: `.claude/context/domain/outflow-import.md`.

## Porter expenses (designed 2026-10-15; created since #1445; expense screens since #1450)

The Porter Statement import ([ADR-0032](../../../docs/adr/0032-porter-statement-import.md); rulings and
as-built in `outflow-import.md` § *Porter Statement — the fourth source*) creates one Project or Non-Project
Expense per completed Porter order, at `Paid` (`api/outflow_import/porter_create.py`, #1445):
- **Amount:** the Porter fare, never the reverse-charge GST (that stays on the Porter Order as `rcm_gst`).
- **Fields:** `payment_date` = the order's completion date; `payment_ref` = the CRN; `invoice_ref` /
  `invoice_date` = the Porter Invoice's number and the date Gemini read; `payment_by` = the trimmed
  booked-by name (Project side; Non-Project has no Paid by); `vendor` blank; `type` = Material
  Transportation Charges (now flagged for both ledgers in the fixture); description "Porter Delivery raised
  by {name} for {project}" (no " for …" on Non-Project); comment "Imported from OFI-…"; no
  `payment_attachment`.
- **Link:** one read-only, indexed `porter_order` Link to the `Porter Order` doctype (named by CRN). The
  Expense owns the link; the Porter Order holds none back and survives the Expense's deletion.
- **Invoice PDF:** `invoice_attachment` is the URL of the ONE `File` attached to the Porter Invoice, shared by
  every order on it; no File row per expense (written raw after insert so Frappe's attach-on-update hook makes
  none, and a `File` `before_insert` hook, `expense_files.refuse_invoice_pdf_copy`, refuses the copy that hook
  tries on every later save of a local-path value; it logs "Error Attaching File" and the save goes through).
  Deleting the expense runs its own Files through `stored_files.delete_files`, so the PDF is never deleted
  with it. The File itself is readable only by roles that can read `Porter Invoice` (Admin, Accountant,
  Accountant Lead) on a local-disk site, so every screen (both lists, both edit dialogs, the approval detail,
  the Porter section) opens it through `porter_invoice_pdf` (below), never the raw URL: one rule, a Porter
  Expense WITH an invoice attachment, in `porter_expense.pdf_url` and `utils/porterExpense.invoiceAttachmentUrl`,
  pinned to each other. (In production the stored URL is the storage app's `generate_file`, which checks
  nothing.)
- **CEO Hold:** a Paid Project Expense counts in the cashflow gap at once; the Create job re-evaluates each
  project it wrote to once at the end (the insert hook's check runs once per request).
- **Delete:** refused by `expense_bank_links` rule 3, because each one has a live Settled import match
  (pinned by `test_porter_expense.TestDeletingAPorterExpense`). `porter_order` itself guards nothing. Both
  list pages now toast the server's reason (`getFrappeError`), e.g. "… cannot be deleted: 1 bank line
  totalling ₹133 is linked to it. Take it off with Unreconcile …", not the SDK's generic delete error.

### As built — #1450: Porter expenses in the expense screens (2026-10-15)

**Decisions** live in `frontend/src/utils/porterExpense.ts` (vitest `porterExpense.test.ts`):
`isPorterExpense` (= `porter_order` set: the badge and every lock), `projectField` (locked + `RECTIFY_HINT`
"Use Rectify in Bulk Import" on a Porter Expense, `{locked: false}` otherwise), `porterSectionRows`.
Components: `frontend/src/components/common/PorterExpense.tsx` — `PorterBadge`, `usePorterExpense`
(SWR key `porter_expense_<doctype>_<name>`, null unless enabled), `PorterSectionBlock`, `PorterSection`.

- **Badge** ("Porter", orange pill, before the text so truncation never hides it) in the Description column of
  the Project list (standalone and the project's *Misc. Project Expenses* tab: one component) and the
  Non-Project list (and its Outflow (Non-Project) report mode). `porter_order` is in
  `DEFAULT_PE_FIELDS_TO_FETCH` / `DEFAULT_NPE_FIELDS_TO_FETCH` — the lists hand the ROW to the edit dialogs,
  so without it neither the badge nor the dialogs' lock see it. Not on the Payments queue (out of scope:
  `get_approval_queue` is a positional UNION).
- **Read-only Porter section**: CRN, booked by, from → to, city, fare, reverse-charge GST, billing entity, and
  the invoice number with a **View PDF** link. Read by ONE endpoint keyed on the EXPENSE,
  `api/outflow_import/porter_expense.get_porter_expense(doctype, name)` (expense read permission; the Porter
  doctypes are read without their own check, as `expense_detail` reads the Expense Request), `None` for a
  hand-keyed expense. Shown in both edit dialogs (bottom), in the approval detail
  (`ExpenseApprovalDetails`, when `get_expense_approval_detail` returns `porter_order`) and in the
  bank-lines card on the Payments & Expenses table / Bulk Import (`ExpenseBankLinesCard`, when
  `get_expense_bank_lines.details.porter_order` is set). It fetches only for a Porter Expense: every other
  expense opens with no extra request. ⚠️ A Porter Expense is created at Paid, so it never reaches the
  approval dialog in practice; the bank-lines card is where a Paid one is read.
- **PDF (story 53):** `porter_expense.porter_invoice_pdf(doctype, name)` serves the Porter Invoice's stored
  PDF inline (`response.type = "pdf"`) to anyone who may read the EXPENSE, reading the bytes through
  `services/extraction/files.fetch_file_content` (cloud or local). Walked: a PMO Executive gets 403 on the raw
  `/private/files/…` URL and the PDF through this link.
- **Project lock (UI only, like every Paid lock — no server rule):** the Project edit dialog, which has no
  project field for any other expense, shows a disabled Project row (the project's name) with the hint; the
  Non-Project dialog shows a disabled "Non-Project" row with the same hint. Description and comment stay
  editable and save (walked on both ledgers). On a local-disk site that save no longer adds a `File` row for
  the shared PDF (the review fixes' `File` `before_insert` refusal; it logs "Error Attaching File").

## Deliberate design decisions (do NOT "fix")

- **No server-side lock on a Paid record, expense or payment** (owner, 2026-09-21). The owner
  corrects Paid records by hand in Desk, so the only Paid locks are the app's dialogs
  (`queueRowActions`). A `services/paid_record_lock.py` shipped for Project Payments in `0fc6cd146`
  and was deleted the same day ("I already block in frontend"). Do not re-add one without a new
  ruling. Known cost on the payment side: a Desk amount edit on a Paid payment does not recompute
  the PO / SR `amount_paid` (`test_document_amount_fields`, expected failure).

- **Approved-but-unpaid expenses do NOT pressure the CEO-Hold cashflow gap** — only `Paid`
  expenses count as settled spend (confirmed, Option A). This is an **intentional asymmetry
  with POs**: a *delivered* PO pressures the gap before payment (via a liability term =
  delivered − paid), but an expense has no "delivered" milestone to anchor a liability on, so
  it counts only once `Paid`. Trade-off accepted: a large pile of approved-but-unpaid
  expenses can make a project look healthier than it is. **Do not add an expense-liability
  term** unless deliberately reversing this decision.
