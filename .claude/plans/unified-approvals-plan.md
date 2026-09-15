# Unified Approvals — execution plan

Source of record: artifact **"One Approval Rule"** — https://claude.ai/code/artifact/26410422-f1a9-402e-8593-9b3b49bbbfec
Owner note 11 Sep 2026 · Owner ruling 15 Sep 2026 · this file regenerated 15 Sep 2026 (deleted from disk twice before).

---

## 0. The spine (settled — do not re-litigate)

One amount rule, one status field, one queue, across all three money-out ledgers.
**The ledgers stay separate** — `Project Payments`, `Project Expenses`, `Non Project Expenses` remain three doctypes. Only the rule, the statuses and the screen unify.

**One status field.** The two-axis proposal (`status` + `reconciliation_status`) is REJECTED.

```
Requested → CEO Pending → Approved → Reconciliation Pending → Paid        (+ Rejected)
```

| # | status | means | money left the bank? |
|---|--------|-------|----------------------|
| 1 | Requested | pending approval | no |
| 2 | CEO Pending | pending CEO approval | no |
| 3 | Approved | sanctioned, not sent | no |
| 4 | Reconciliation Pending | **money sent**, bank not yet confirmed | **YES** |
| 5 | Paid | sent AND reconciled — terminal | yes |
| — | Rejected | refused at gate 1 or 2 | no |

**The one sentence the whole plan hangs on:** the money-out event moves from `→ Paid` to `Approved → Reconciliation Pending`. Everything in step 7 follows from it.

**The amount rule** (in `services/approval_tiers.py`, already built):

| band | route |
|------|-------|
| `< ₹15,000` | approved on create, no human touches it |
| `₹15,000 – ₹50,000` | **L1 finishes it** — CEO never sees it |
| `> ₹50,000` | L1 forwards → CEO approves (today's path) |
| `amount ≤ 0` | full path regardless of size; sign only blocks auto-approve, size still bands it |

Measured effect on 12 months of live data:
- CEO **stops** seeing ~912 payments/yr in the ₹15k–₹50k band (₹2.65 Cr).
- ~303 payments/yr in ₹10k–₹15k stop being approved by anyone (auto line moves up ₹5,000).
- ~102 non-project expenses/yr **newly** reach the CEO (that ledger has no CEO tier today).

---

## 1. Where we actually are (verified on disk, 15 Sep 2026)

| # | item | state |
|---|------|-------|
| 1 | The two pure modules + TS mirrors | **DONE**, staged in git |
| 2 | The tab scaffold | **DONE**, staged in git |
| 4 | Git-add the new files | **DONE** — all 14 files are in the index |
| 3 | Three expense fields via Desk | **DONE** 15 Sep — both ledgers, verified; `bench migrate` still owed |
| 5 | Four decisions | **OPEN — blocking items 10 and 12** |
| 6 | The "before" snapshot | **DONE** 15 Sep — 10 artefacts, 0 failed sections, comparator drift-tested |
| 7–12 | everything else | not started |

Staged right now:
```
A  frontend/src/utils/approvalTiers.ts + .test.ts
A  frontend/src/utils/settlement.ts   + .test.ts
A  nirmaan_stack/services/approval_tiers.py + test_approval_tiers.py
A  nirmaan_stack/services/settlement.py     + test_settlement.py
M  frontend/src/pages/ProjectPayments/RenderProjectPaymentsComponent.tsx
M  frontend/src/pages/ProjectPayments/approve-payments/constants.ts
M  frontend/src/pages/ProjectPayments/config/ppTabs.constants.ts
M  frontend/src/pages/ProjectPayments/config/projectPaymentsTable.config.ts
M  frontend/src/pages/ProjectPayments/update-payment/AccountantTabs.tsx
M  nirmaan_stack/api/sidebar_counts.py
```

**Nothing calls the two modules yet.** The three old thresholds are untouched
(`PAYMENT_AUTO_APPROVAL_THRESHOLD = 10001`, and `AUTO_APPROVE_LIMIT = 10000` in *both* expense doctypes)
and every `"Paid"` literal is still in place. The scaffold changed tab **labels only** — no tab *value* moved.

The public API that everything below binds to:

```python
# nirmaan_stack/services/settlement.py      (pure, no frappe)
SETTLED_STATUSES = ("Reconciliation Pending", "Paid")
is_settled(status) · is_pending(status) · is_settlement_transition(old, new)
settled_filter(fieldname="status") · status_label(status) · any_settled(statuses)

# nirmaan_stack/services/approval_tiers.py  (pure, no frappe)
TIER_AUTO_APPROVE_BELOW = 15000.0 · TIER_L2_ABOVE = 50000.0
required_tier(amount) · initial_status(amount) · status_after_l1(amount)
is_auto_approved(amount) · needs_ceo(amount)
```
Mirrored byte-for-behaviour in `frontend/src/utils/settlement.ts` and `approvalTiers.ts`.
The parity tests **read the Python source** and were verified to go red on drift.

---

## 2. Blocking on you

### 2a. Three fields, Desk → DocType, developer mode

On **both** `Project Expenses` and `Non Project Expenses`:

| field | type | note |
|-------|------|------|
| `approval_date` | Date | label "Acc Approval Date" — copy verbatim from Project Payments |
| `ceo_approval_date` | Date | |
| `auto_approved` | Check | default 0, **read-only** |

Then:
```
bench --site localhost migrate
```
and commit the JSON Frappe writes back. Three nullable columns; no data is read or rewritten.
**`Project Payments.status` needs nothing** — it is a `Data` field and accepts any string.
**`Project Expenses.status` / `Non Project Expenses.status`** are Selects and need the three new values
(`CEO Pending`, `Reconciliation Pending`, `Rejected`) added in the same Desk pass.

### 2b. Four decisions

| | decision | recommendation |
|---|----------|----------------|
| **a** | **The ₹15,000 collision.** Project-expense creation is already capped at ₹15,000 in the UI (`AMOUNT_LIMIT`, waived for accommodation types) — the same number as the new auto line. Under the new rule a project expense could essentially *never* need approval. | Accept it deliberately and write it down, or drop the auto line for expenses to ₹10,000. Do **not** move the ₹15,000 tier — it is shared with payments. |
| **b** | **Does L1 on expenses widen past Admin-only** to the payments L1 set (Admin · Accountant · Accountant Lead)? | Yes, widen — otherwise "one rule" is false for two of three ledgers. Your call; it is a real role expansion. |
| **c** | **Expense notifications.** Expenses have zero notification plumbing and appear in no sidebar count. A >₹50k non-project expense would reach the CEO silently, ~102×/yr. | Add a small controller mirroring the payments one. The alternative (queue badge only) is defensible but must be an explicit choice. |
| **d** | **Does the bank import promote `Reconciliation Pending → Paid`,** or is reconciliation always a manual tick? | Yes — it is exactly what that screen is for, and today that row is a wasted `Skipped: paid duplicate`. Ship it last (step 12, optional). |

### 2c. One go-live decision, recommendation already made

**159 requests are open right now under the old rule.** `CEO Pending` holds 24 under ₹15k, **56 in the 15k–50k band** and 43 over ₹50k; `Requested` holds 13 and 23.
**Recommended: leave them.** The rule applies at creation. No one-shot release patch.

---

## 3. Execution order

Each step is reviewable and shippable on its own. Do not reorder 6 before 7.

### Step 6 — The "before" snapshot ⚠️ DEADLINE

**The only item that becomes impossible to do later.** The entire safety argument for step 7 is
"the numbers must come back identical", and a before-snapshot cannot be taken after the code has changed.

**Built:** `.claude/plans/unified-approvals-snapshot/snapshot.py` (harness) and `compare.py` (diff).
Read-only — it ends on `frappe.db.rollback()` and writes nothing to the database.

It deliberately **calls the real functions** (`get_total_paid`, `_compute_cashflow_gap`,
`get_payment_dashboard_stats`, `get_projects_financial_rollup`, `get_po_ledger_data`, …) rather than
re-implementing their SQL. A snapshot of hand-written SQL would still pass after a broken edit and would
prove nothing about the code.

| artefact | what it pins | what it catches |
|----------|--------------|-----------------|
| `01_total_paid_by_document.csv` | `get_total_paid` + `get_total_pending` per PO and per SR | the available-balance check — if it under-counts, **over-payment becomes possible** |
| `02_amount_paid_stored.csv` | the **stored** `amount_paid` on every PO and SR | a D2 trigger left behind on `Paid`: 01 can be right while this quietly stops updating |
| `03_cashflow_gap_by_project.csv` | `_compute_cashflow_gap` per project | CEO holds releasing early |
| `04_projects_financial_rollup.json` | `get_projects_financial_rollup()` | project rollups |
| `05_project_aggregates.json` | PO + SR summary aggregates, per project | project rollups |
| `06_payment_dashboard_stats.json` | `get_payment_dashboard_stats()` | the 30-day dashboard, both ledgers |
| `07_vendor_ledger.csv` | `get_po_ledger_data` per vendor | vendor ledger |
| `08_settled_totals_by_project_ledger.csv` | settled totals per project × ledger × status | the substrate the two **frontend** outflow reports compute from |
| `09_payment_tds_totals.csv` | `Payment TDS Deduction` totals | `total_tds` mirrors `amount_paid` by design and must move with it |
| `10_status_counts.csv` | status counts, all three ledgers | the control — no status migrates, so these must not move either |

Run:
```
SNAP=/workspace/development/frappe-bench/apps/nirmaan_stack/.claude/plans/unified-approvals-snapshot/snapshot.py
docker exec -e SNAPSHOT_LABEL=before frappe_docker_devcontainer-frappe-1 bash -lc \
  "cd /workspace/development/frappe-bench && echo 'exec(open(\"$SNAP\").read(), globals())' | bench --site localhost console"
```

⚠️ **`bench console` exits 0 even when the script never ran.** Always confirm the sentinel:
```
grep -c "Done in" .claude/plans/unified-approvals-snapshot/before/_run.log
```
A missing `_run.log`, or a section marked `!! FAILED` inside it, means that artefact is not a baseline.
(Also: `bench console` does not keep the shell's cwd — pass the script path **absolute**.)

### Step 7 — The settled-spend audit  ·  *prove DIFF = 0*

The riskiest change in the plan, and the only one provable in isolation — **because at go-live zero rows
are in `Reconciliation Pending`**. All 10,840 existing settled rows stay `Paid`. There is **no status
migration at all**. So every rollup must return a figure identical to today, to the rupee. Any difference
is a bug in the edit, not a consequence of the design.

**D1 — money sites (sum and filter).** Bind `SETTLED_STATUSES`; never a literal.

| site | what breaks if missed |
|------|----------------------|
| `services/finance.py:79` `get_total_paid` | available-balance check under-counts ⇒ **over-payment allowed** |
| `doctype/project_payments/project_payments.py:33,103` `update_parent_amount_paid` | `Procurement Orders.amount_paid` and the SR equivalent stall |
| `services/payment_tds.py:105` | `total_tds` mirrors `amount_paid` by design — must move with it |
| `integrations/controllers/project_cashflow_hold_update.py:303,310` | CEO-hold gap understates spend ⇒ **holds release early** |
| `api/projects/project_aggregates.py:73,534` | project rollups |
| `api/payments/get_project_payment_summary.py:180,202` | the 30-day dashboard, both ledgers |
| `api/vendor/get_vendor_po_invoices.py:144` | vendor ledger |
| `api/sidebar_counts.py:166` | derives counts per status from a list — add the value |
| `services/outflow_import/ledgers.py:57` · `candidates.py` · `settle.py:200` | the import stops recognising money it already settled |

**D2 — trigger sites (fire on money-out).** *The half that is easy to forget:* add the new status to the
sums but leave the triggers on `Paid` and `amount_paid` silently stops updating at fulfilment. Every spot
check still looks right.

| site | today | becomes |
|------|-------|---------|
| `doctype/project_payments/project_payments.py:60,67,71,81` | recompute on enter/leave `Paid` | on enter/leave the **settled set** (`is_settlement_transition`) |
| `integrations/controllers/project_cashflow_hold_update.py:255,277` | re-evaluate on enter/leave `Paid` | same |
| `integrations/controllers/project_payments.py:352` | `Approved → Paid` ⇒ vendor-credit recalc + notify | `Approved → Reconciliation Pending` |

**D4 — frontend sites.** Bind `frontend/src/utils/settlement.ts` in:
`useProjectRootApi.ts` · `useOutflowReportData.ts` · `useProjectReportCalculations.ts` ·
`PaymentSummaryCards.tsx` · `ApprovePayments.tsx` (CEO cashflow-gap mirror) · `useProjectPOSummaryApi.ts` ·
`VendorPaymentsTable.tsx` · `VendorMaterialOrdersTable.tsx` · `TransactionDetailsCard.tsx` ·
`PurchaseOrder.tsx` · `useApprovedSRData.ts` · `useSRPaymentManager.ts` · `SRPaymentsSection.tsx` ·
`approved-sr.tsx` · `PaymentsDataDialog.tsx` · `project-payments-list.tsx` · `projectExpensesColumns.tsx` ·
`nonProjectExpensesColumns.tsx` · `NonProjectExpensesPage.tsx` · `outflowTableModel.ts` ·
`settledDirectionBlocks.ts` · `useVendorLedgerCalculations.ts`

**Plus six Desk reports whose SQL lives in the database** — no grep reaches them. Hand-edit.

**D5 — leave alone, deliberately.**
- `services/finance.py:127` `get_total_pending` lists `Requested / CEO Pending / Approved / Rejected`.
  **Do NOT add `Reconciliation Pending`** — that money is spent, not pending; adding it double-counts
  against `get_total_paid`.
- `PO Payment Terms.term_status` mirrors payment status 1:1 and gains the value automatically. `Data` field, no schema change.
- **Patches under `nirmaan_stack/patches/**` are frozen.** Their `"Paid"` literals are history; never touch them.

Surface check (grep, today): 46 backend `.py` files and 53 frontend files contain a `Paid` literal.
Most are display or history. The tables above are the subset that is a **money filter or a trigger** —
that is the ~36. **From this step on, a literal `"Paid"` in a money filter is a defect** and goes on the
review checklist as a grep.

**Definition of done:** re-run the step-6 snapshot. **DIFF = 0 rows, 0 rupees.** Ship alone.

### Step 8 — Writers start using the new status

- `doctype/project_payments/project_payments.py:373` `_fulfil_payment` writes **`Reconciliation Pending`** (was `Paid`).
- Both `UpdatePaymentDetailsDialog.tsx` write **`Reconciliation Pending`**.
- `services/outflow_import/settle.py` keeps writing `Paid` — a statement-settled row *is* reconciled.
- `api/po_adjustments/adjustment_logic.py` and `_payment_utils.py` keep writing `Paid` — an internal
  transfer never appears on a bank statement, could never be reconciled, and would be stranded forever.
  **Recorded deliberately so nobody "fixes" it.** (191 of 7,566 paid payments already hold a PO number in
  the UTR field for exactly this reason.)
- Add `reconciled_on` to all three doctypes (Desk). A blank `reconciled_on` is what marks the 10,840
  pre-existing rows as **grandfathered**, forever distinguishable from something genuinely reconciled.

**Definition of done (the step-4 walk):** move one real payment `Approved → Reconciliation Pending`,
re-run the snapshot. It must now appear in **every** settled figure and its PO's `amount_paid` must have
moved. **This is the only check that proves the triggers moved — a zero-diff by construction cannot.**

### Step 9 — The amount rule goes live

- Both create endpoints call `initial_status(amount)`.
- Delete `PAYMENT_AUTO_APPROVAL_THRESHOLD = 10001` and both `AUTO_APPROVE_LIMIT = 10000`; call the deriver.
- `api/payments/bulk_actions.py`: the L1 target becomes **per-row** — L1 now finishes some approvals and
  forwards others.

⚠️ **Three traps live here, all silent failures:**
1. **SR tax withholding stops for ₹15k–₹50k bulk approvals.** The post-commit deduction is gated on
   `config.approve_target_status == payment_tds.APPROVED` — a whole-batch constant
   (`api/payments/bulk_actions.py:303`). Once L1's target is per-row that comparison goes false for the
   lead config and every 15k–50k bulk payment lands at `Approved` **with no deduction, no error, nothing
   on screen looking wrong.** The gate must become per-row, on the status each payment actually reached.
2. **`_ModeConfig` assumes one target status per batch** — it also carries a single approve-date field,
   event id and action URL. A 15k–50k payment approved by L1 must stamp `ceo_approval_date` too: it has
   cleared every gate it will ever have. Auto-approved payments already stamp both — follow that precedent.
3. **`payment:approved` routes to the wrong tab.** It currently means *"L1 approved, CEO look at it"* and
   deep-links to `tab=CEO Pending`. For a 15k–50k payment it now means *"approved, accountant pay it"*.
   One event id, two meanings — split it.

Also: `term_status` gains a jump (`Requested → Approved`, skipping `CEO Pending`) and the new value.
The PO card renders each value independently so display is safe — anything asserting the *sequence* is not.
(`purchase-order/components/POPaymentTermsCard.tsx:805–831`)

### Step 10 — Expenses reach parity  *(needs decisions b and c)*

Today `ProjectExpensesList.tsx:263` calls `updateDoc(DOCTYPE, name, {status: "Approved"})` **straight from
the browser**, gated only by `canApprove = isAdmin` in the columns file — a frontend-only permission check
on a financial approval. *This is the one place in the whole plan where a real permission hole gets closed.*

New `api/approvals/expense_actions.py` enforces tier and role **server-side**. Both doctype `validate`s call
the deriver. Nine changes, both ledgers:

1. Three new status values (Desk — step 2a).
2. Tier deriver replaces the local limit. ⚠️ **`Project Expenses.amount` is a `Data`/varchar field** — `flt()`
   it before the tier test, or `"9000"` compares above `"50000"`.
3. A real approve endpoint (above).
4. L1 widens beyond Admin — decision **b**.
5. A CEO gate firing ~102×/yr, non-project only.
6. **Reject, which does not exist today.** Currently an Admin *deletes* a Requested expense, destroying the
   record and its audit trail. New: `Rejected` + a reason comment, exactly as payments do. Delete survives
   for genuine data-entry mistakes.
7. Mark-as-Paid writes `Reconciliation Pending`; new **Mark Reconciled** action.
8. Tabs go 4 → 6 (`ProjectExpensesList.tsx:349`, `NonProjectExpensesPage.tsx:165`).
9. Notifications + sidebar counts — decision **c**.

**Deliberately NOT given to expenses:** PO-term mirroring, SR tax withholding, vendor-credit recalc,
partial/split approval. The expense bulk engine is thin — no PO row locks, no term sync, no TDS. All of that
exists because a payment has a PO or SR parent; an expense does not.
**Non Project Expenses stays out of the CEO-hold gap** (no project) and keeps its versions-only `doc_events`,
so nothing in D2 touches it. Project Expenses keeps its cashflow hooks, trigger moved to the settled set.

Two expense-only edges:
- **The import creates expenses directly as `Paid` and should keep doing so.** `settle.create_expense_from_row:791`
  and the Cashbook source per ADR-0015 — an expense minted from a bank statement is reconciled by construction,
  so it is born terminal and skips approval entirely. Correct; recorded so nobody "fixes" it.
- **A hand-entered refund would sit in a money-out queue.** 12 Non-Project Expenses carry a negative amount.
  `amount ≤ 0` takes the full path, so a hand-entered refund lands in *Pending Approval* — a money-IN row in a
  money-OUT queue. Import-created ones are born `Paid` and unaffected. **Decide.**

### Step 11 — The unified queue

`/approvals`, six tabs, all three ledgers, one bulk bar. The old `/project-payments` tabs keep working —
notifications deep-link into them. Payments reuse the existing bulk engine unchanged; expenses get the thin one.

#### 11.1 Tabs

| tab | filter | who lands here by default |
|-----|--------|---------------------------|
| Pending Approval | `status = Requested` | Admin · Accountant Lead |
| Pending CEO Approval | `status = CEO Pending` | CEO |
| To Be Paid | `status = Approved` | Accountant |
| Reconciliation Pending | `status = Reconciliation Pending` | Accountant |
| Paid | `status = Paid` | — |
| All | none | — |
| PO Wise | payments-only, unchanged | — |

`Rejected` is a **filter on All, not a tab** — an end state nobody works from. `Payments Pending` is dropped:
it is exactly the sum of the first three tabs and the Pending card already shows that split.

⚠️ **Every tab needs an explicit case in the filter switch.** Today's `getProjectPaymentsStaticFilters`
falls through to `default: base` — i.e. **no status filter** — so a missing case shows *every* row in the
system while the tab label claims otherwise. This already bit tab four; it is written down in
`projectPaymentsTable.config.ts` and must be carried into the new config.

#### 11.2 The column matrix — this is the spec

Fourteen column ids exist. **No tab shows all of them.** `✓` = present, `–` = absent.

| # | column id | Pending Appr | CEO Pending | To Be Paid | Recon Pending | Paid | All |
|---|-----------|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `select` (checkbox) | ✓ | ✓ | ✓ | ✓ | – | – |
| 2 | `actions` | Approve · Reject | Approve · Reject | Record Payment | Mark Reconciled | – | per row |
| 3 | `source` **new** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4 | `against` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 5 | `vendor` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 6 | `project` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 7 | `amount` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 8 | `tier` **new** | ✓ | – | – | – | – | – |
| 9 | `raised_by` | ✓ | ✓ | ✓ | – | – | ✓ |
| 10 | `requested_on` (+ waiting days) | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| 11 | `approved_on` | – | – | ✓ | ✓ | ✓ | – |
| 12 | `paid_on` | – | – | – | ✓ | ✓ | – |
| 13 | `utr_ref` | – | – | – | ✓ | ✓ | – |
| 14 | `proof` | – | – | – | ✓ | ✓ | – |
| 15 | `reconciled_on` | – | – | – | – | ✓ | – |
| 16 | `status` | – | – | – | – | – | ✓ |
| 17 | `project_value` · `cashflow_gap` | – | ✓ | – | – | – | – |

Rules the matrix encodes, each with a reason — **do not "simplify" them back**:

- **`actions` sits at position 2, immediately after the checkbox.** The approver's hand never travels to
  the right edge, and the button stays put as the other columns change between tabs. Accepted trade-off:
  on a wide screen it is furthest from the Amount it acts on.
- **`tier` appears on the first tab only.** Every row on the CEO tab is `L1+L2` by definition — there it
  would be one word repeated down the page. On To Be Paid and later, approval is finished, so it answers
  nothing.
- **`status` appears only on All** — the only tab where it varies. On a single-status tab it is a column
  of one repeated word, which is exactly why today's Approve Payments tab has none.
- **`select` is absent on Paid and All.** There is nothing left to do to a Paid row; All is mixed-status,
  so no single bulk action is valid for a selection.
- **`project_value` + `cashflow_gap` are CEO-tab only** — they are the two columns that earn their place
  in the seat where `tier` was dropped.
- **`WO/PO Value`, `Total Paid`, `Payable Against Delivery` are not columns at all.** They collapse into a
  **hover card on `amount`** — *"₹1,20,000 requested · PO ₹4,50,000 · ₹2,10,000 paid · ₹3,00,000 delivered"* —
  rather than three columns permanently blank on every expense row. Reuse `AmountPaidHoverCard.tsx`.
- **`payment_by`** (Project Expenses, 99.5% filled, that ledger's stand-in for Vendor) is added to
  **Reconciliation Pending and Paid** — decision already recommended in §2b.

#### 11.3 How the table gets built under every tab

Today each screen builds its columns as one inline `useMemo<ColumnDef<ProjectPayments>[]>` with
`...(tab === "Payments Done" ? [...] : [])` spreads scattered through it (`AllPayments.tsx:260–436`,
`ApprovePayments.tsx:407–757`). **That idiom does not survive six tabs × three ledgers** — it is already
two near-duplicate 300-line column blocks for two tabs. Replace it with a **registry + per-tab id list**:

```
frontend/src/pages/Approvals/
  config/approvalsTable.config.ts    APPROVAL_TABS · TAB_COLUMNS · getApprovalsStaticFilters(tab)
                                     buildApprovalsUrlSyncKey · APPROVAL_SEARCHABLE_FIELDS
  config/approvalColumns.tsx         COLUMN_REGISTRY · buildApprovalColumns(ids, ctx)
  ApprovalsPage.tsx                  one useServerDataTable call, tab from the URL
```

```ts
// config/approvalsTable.config.ts
export const TAB_COLUMNS: Record<ApprovalTab, ApprovalColumnId[]> = {
  [APPROVAL_TABS.PENDING_APPROVAL]:
    ['select','actions','source','against','requested_on','vendor','project','amount','tier','raised_by'],
  [APPROVAL_TABS.CEO_PENDING]:
    ['select','actions','source','against','requested_on','vendor','project','amount','project_value','cashflow_gap'],
  [APPROVAL_TABS.TO_BE_PAID]:
    ['select','actions','source','against','vendor','project','amount','approved_on','raised_by'],
  [APPROVAL_TABS.RECONCILIATION_PENDING]:
    ['select','actions','source','against','vendor','project','amount','paid_on','utr_ref','proof','payment_by'],
  [APPROVAL_TABS.PAID]:
    ['source','against','vendor','project','amount','paid_on','utr_ref','proof','reconciled_on','payment_by'],
  [APPROVAL_TABS.ALL]:
    ['source','against','vendor','project','amount','status','requested_on','raised_by'],
};
```

```tsx
// config/approvalColumns.tsx
const COLUMN_REGISTRY: Record<ApprovalColumnId, (ctx: ColumnCtx) => ColumnDef<UnifiedApprovalRow>> = {
  source:   () => ({ accessorKey: 'source', header: 'Source',
                     cell: ({row}) => <SourceChip source={row.original.source} />,
                     meta: { facet: true } }),
  against:  (ctx) => ({ accessorKey: 'against_primary', header: 'Against',
                     cell: ({row}) => <AgainstCell row={row.original} /> }),
  amount:   (ctx) => ({ accessorKey: 'amount', header: 'Amount',
                     cell: ({row}) => <AmountCell row={row.original} ctx={ctx} /> }),
  tier:     () => ({ accessorKey: 'tier', header: 'Tier',
                     cell: ({row}) => <TierChip tier={row.original.tier} /> }),
  actions:  (ctx) => ({ id: 'actions', header: 'Actions',
                     cell: ({row}) => <RowActions row={row.original} tab={ctx.tab} /> }),
  /* …one entry per id… */
};

export const buildApprovalColumns = (ids: ApprovalColumnId[], ctx: ColumnCtx) =>
  ids.map(id => COLUMN_REGISTRY[id](ctx));
```

```tsx
// ApprovalsPage.tsx — the whole per-tab difference is three lines
const columns       = useMemo(() => buildApprovalColumns(TAB_COLUMNS[tab], ctx), [tab, ctx]);
const staticFilters = useMemo(() => getApprovalsStaticFilters(tab), [tab]);
const urlSyncKey    = useMemo(() => buildApprovalsUrlSyncKey(contextKey, tab), [contextKey, tab]);
const { table, ... } = useServerDataTable<UnifiedApprovalRow>({
  doctype: 'Project Payments',          // nominal; the endpoint unions all three
  apiEndpoint: 'nirmaan_stack.api.approvals.get_approval_queue.get_approval_queue',
  columns, fetchFields: APPROVAL_FETCH_FIELDS, searchableFields: APPROVAL_SEARCHABLE_FIELDS,
  additionalFilters: staticFilters, urlSyncKey,
  enableRowSelection: TAB_ALLOWS_SELECTION[tab],
  defaultSort: TAB_DEFAULT_SORT[tab],   // 'creation asc' on the queues — oldest first, the 53-day rows
});
```

Why a registry rather than more spreads: **one column id has exactly one definition**, so a change to
`against` cannot drift between tabs; the array *is* the order, so moving `actions` to position 2 is one
edit; and adding a tab is one line in `TAB_COLUMNS`, not another 300-line block. (ADR-0010 F1: a shape
gets one home.)

`ctx` carries only what a cell cannot get from the row: the lookup maps (`projectLabelMap`, `vendorLabelMap`),
the PO/SR figures behind the Amount hover, and the current tab.

#### 11.4 The row contract

`useServerDataTable<TData extends { name: string }>` requires `name`, and every cell above reads a
**normalized** field — never a per-doctype one. One endpoint, one shape:

| field | Vendor Payment | Project Expense | Non-Project Expense |
|-------|----------------|-----------------|---------------------|
| `name` | `name` | `name` | `name` |
| `source` | `"Vendor Payment"` | `"Project Expense"` | `"Non-Project"` |
| `doctype` | real doctype — the action endpoints need it | | |
| `against_primary` | `document_name` (#PO / #SR) | `description` line 1, ≤40 chars | `description` |
| `against_secondary` | *blank* | `comment` else `type` | `comment` else `type` |
| `against_full` | — | full description + type (hover) | full description + type |
| `vendor` | `vendor` | `vendor` (0.6% filled) | **blank — no such field** |
| `project` | `project` | `projects` ⚠️ plural | **blank — company-wide** |
| `amount` | `amount` | `CAST(amount AS NUMERIC)` ⚠️ | `amount` |
| `tier` | derived server-side from the cast amount | | |
| `payment_by` | — | `payment_by` | — |
| `utr_ref` | `utr` | `payment_ref` | `payment_ref` |
| `proof` | `payment_attachment` | `payment_attachment` | `payment_attachment` |

**Three normalization traps, all measured on live data:**

1. ⚠️ **Sorting by Amount is already broken for Project Expenses.** `amount` is `Data` / `character varying`
   there, `Currency` / numeric on the other two. `ORDER BY amount DESC` returns **₹999 at the top when the
   real maximum is ₹26,000.** Cast in the projection — for sorting, for range filters **and for the tier
   derivation**, or a lexical compare drops a ₹9,000 expense into the `> ₹50,000` band.
2. **`project` vs `projects` vs nothing.** One alias in the normalizer, one honest blank.
3. **Non-project expenses have neither vendor nor project. Render blanks** — never a zero, never "N/A" or
   "Company". A blank is the true value; a placeholder is a claim the data does not make.

#### 11.5 The `against` cell — description leads, for both expense ledgers

Measured: **35% of project-expense descriptions contain a line break** (those extra lines are *bank
details*, not description), and **98.6% of first lines fit 40 characters**.

- **Line 1** — first line of `description`, truncated at 40 chars with an ellipsis.
- **Line 2** — `comment`, falling back to Expense Type when blank (populated 98% / 82%).
- **Hover** — the full description including the bank lines, plus the type. Nothing is lost.
- ⚠️ **Never render a raw line break in a table cell** — 911 rows would break the row height.

Expense Type becomes a **facet in the filter bar, not a display line** (~40 repeating values). The
description never repeats, which is exactly what makes it the identity.

#### 11.6 The backend endpoint

`nirmaan_stack/api/approvals/get_approval_queue.py`, whitelisted, **same signature as the precedent**
`api/projects/pr_summary.py::get_pr_summary_list`:

```python
get_approval_queue(doctype, fields, filters, order_by,
                   limit_start, limit_page_length,
                   search_term, current_search_fields, **kwargs)
  -> {"data": [...], "total_count": N, "aggregates": {...}, "group_by_result": None}
```

It cannot delegate to `get_list_with_count_enhanced_impl` — that reads one doctype. It is a
**`UNION ALL` of three normalized projections**, then filter / sort / paginate **over the union**, so that
sorting by amount or age is correct across ledgers rather than per-ledger.

⚠️ **Chunk any `name in (...)` list** — `IN_CHUNK_SIZE`, per the data-table sqlparse 10k-token crash that
only reproduces in PROD.

`tier` is derived **server-side** by `services/approval_tiers.py` on the cast amount, so the chip and the
routing can never disagree. The TS mirror stays for optimistic UI only.

#### 11.7 Summary cards

The Pending card's four lines — `Pending Payment Approval 159` · `L1 Pending 36` · `CEO Pending 123` ·
`Approved But not Paid 3` — work unchanged once each query spans three ledgers instead of one. The
OUTFLOW (30 days) block **already** separates *Project (PO+WO + Exp)* from *Non-Project Expense*.

**Exactly one line is added: `Paid, awaiting reconciliation (N) ₹X`** — the new worklist. The L1 / CEO /
Auto counters need no change at all: they count status transitions, and expenses will now make the same ones.

#### 11.8 Counts these tabs must show on day one

`43 · 123 · 15 · 0 · 10,840 · 11,021`. These are live and reconcile exactly with today's Project Payments
screen (`36 · 123 · 3 · 7,566 · 7,728`) plus the expense rows unification adds: **+7 non-project expenses**
on Pending Approval and **+12 project expenses** on To Be Paid. If the new tabs do not land on these
numbers, the union or a filter is wrong — check before building anything on top.

#### 11.9 Fields the matrix drops, and whether that is a loss

A field dropped because it is empty costs nothing; a field dropped while 99% populated is a regression.
Measured fill rates say there are exactly four worth arguing about:

| field | fill | verdict |
|-------|------|---------|
| `payment_by` (Project Expenses) | **99.5%** | **Add it** — Recon Pending + Paid. That ledger's stand-in for Vendor. Already in 11.2. |
| `invoice_date` (Non-Project) | **89%** — and **0%** on project expenses | One ledger genuinely uses invoices, the other never has. **The answer cannot be the same for both.** Recommend an Invoice group on the Paid tab, or a hover on `against`, for non-project rows only. **Decide.** |
| `tds` (payments) | **65% — 5,026 rows** | Legacy field (live withholding is in `Payment TDS Deduction`) but 5,026 rows is not nothing, and nothing on the new screen shows it. Hover on Amount for settled rows, or a Paid-tab column. **Decide.** |
| `modified_by` | all | Both expense lists carry *Last Modified By* on their Paid tab **by deliberate design** — it is the settlement audit trail. The unified Paid tab drops it. **Decide.** |

Dropped with no argument, because they are empty or repeat: `name` (PAY-…) → search field only, people
recognise the PO not the payment id · `document_type` → the `#PO`/`#SR` prefix already says it, kept as a
facet · `auto_approved` → the AUTO tier chip says the same thing in the column that explains routing ·
`ceo_approval_date` → audit detail, on the record · `voucher_attachment` (8%) → Proof covers the common case ·
`invoice_ref`/`invoice_date`/`invoice_attachment` on Project Expenses → **0 of 2,585**.

**Two things that are simply dead — worth a separate look, not fixed here:**
- **`split_from`: 0 of 7,728.** Partial approval has never once been used. The Balance chip on `amount` is
  specified and will simply never render until someone splits a payment.
- **The Project Expenses invoice block: 0 of 2,585.** Shipped 22 Jul 2026, never filled once. Raises a
  separate question — is that feature dead?

One thing worth knowing, not fixing here: `description` is currently doing three jobs at once — payee, bank
details, and sometimes purpose. That is why the 11.5 first-line rule is needed at all. The `source_format`
work already under way on Expense Type (structured per-type forms built from the legacy *description = payee /
comment = facts* split) is the real fix, and it makes this column better for free as it rolls out.
**No schema change is proposed here.**

### Step 11b — The Payment Summary card

The tab badges now count all three ledgers, and the tables do too. **The summary card
above them does not** — so the screen currently contradicts itself in the one place a
reader looks first for totals.

#### What is already unified, and what is not

`api/payments/get_project_payment_summary.get_payment_dashboard_stats` is split down
the middle, and the split is not obvious from the screen:

| Block | Ledgers today | Action |
|-------|---------------|--------|
| **Pending Payment Summary** (Pending Approval · L1 · CEO · Approved-not-Paid) | `doctype = 'Project Payments'` — payments ONLY | **unify** |
| **Approved & Paid Summary** (L1 / CEO / Auto approval, today + 7 days; Paid today + 7 days) | payments ONLY | **unify**, with one caveat below |
| **INFLOW / OUTFLOW (30 days)** | already spans Project Expenses + Non Project Expenses | leave alone — it is already right |

#### The numbers that move (measured, 15 Sep 2026)

| Line | Today | After | Delta |
|------|-------|-------|-------|
| Pending Payment Approval | 159 · ₹1,38,77,440 | **182 · ₹1,46,51,710** | +23 expenses |
| L1 Pending Approval | 36 · ₹50,30,517 | **44 · ₹58,04,787** | +7 non-project, +1 project |
| CEO Pending Approval | 123 · ₹88,46,923 | 123 · ₹88,46,923 | unchanged — no expense reaches the CEO yet |
| Approved But not Paid | 3 · ₹13,848 | **15 · ₹87,408** | +12 project expenses |

The Approved-not-Paid line is the one worth noticing: **₹13,848 → ₹87,408 is a 6×
understatement of money already sanctioned and waiting to go out.**

#### One line to add

**`Paid, awaiting reconciliation (N) ₹X`** — the Reconciliation Pending worklist. It
reads 0 until step 8 switches the fulfil path over, which is correct and is the same
honest-zero the tab already shows.

#### ⚠️ The caveat: "Paid Today" becomes ambiguous

`Paid` now means RECONCILED, so "Paid Today / Paid (7 days)" has two possible meanings
and they diverge the moment step 8 lands:

- **money that LEFT the bank today** — the `Approved → Reconciliation Pending` event, or
- **money the bank CONFIRMED today** — the `→ Paid` event.

An accountant reading "Paid Today" almost certainly means the first. **Recommendation:
count the settled set (`SETTLED_STATUSES`) so the figure keeps meaning "went out today",
and let the new Reconciliation Pending line carry the not-yet-confirmed part.** This is a
D1 decision surfacing in the UI — it must be made deliberately, not inherited.

#### The Auto-approval counter has a data gap

`auto_approved` exists on all three ledgers as of step 3, but **no expense has ever
written it** — the expense doctypes auto-approve without flagging. So "Auto Approval
Today" stays payments-only in substance until step 9 wires `initial_status()` into both
expense `validate`s. Report it as payments-only rather than showing a number that
silently omits expenses.

#### Implementation

Two options, and the cheap one is right:

1. **Extend `get_payment_dashboard_stats` to union the three ledgers** — it already
   reads all three for the outflow block, so the SQL shape exists. Reuses the card's
   whole frontend unchanged; the `PaymentStats` interface does not grow.
2. Rebuild the card on `get_approval_queue_counts`. Rejected: that endpoint returns
   per-status counts only and knows nothing about *today / 7 days / inflow*, so the card
   would need two data sources and could show two different totals.

**Take option 1.** Add `total_reconciliation_pending_count/_amount` for the new line, and
route every approval/pending/paid aggregate through the same three-ledger union the
outflow block already uses.

⚠️ This block is one of the **~36 settled-spend sites (D1)**: `get_project_payment_summary.py:180,202`
is already on the audit list. Doing the card BEFORE step 7 means editing a site the
before/after DIFF proof is supposed to cover. **Sequence it after step 7**, or snapshot
these six figures separately and prove them unchanged.

### Step 12 — The import closes the loop *(optional, decision d)*

A statement line matching a `Reconciliation Pending` record promotes it to `Paid`. Today that record is
`Skipped: paid duplicate` — it becomes the productive case. This is the only transition the import performs on
a record it did not settle itself, and it is exactly what that screen is for.

---

## 4. Out of scope

- Merging the three doctypes
- CEO-Hold behaviour
- Partial / split approval — stays CEO-only
- `PO_REVISION_AUTO_APPROVAL_THRESHOLD` (₹5,000)
- **Any migration of existing status values — there is none, by design**

---

## 5. Test commands

```
env/bin/python -m unittest nirmaan_stack.services.test_approval_tiers nirmaan_stack.services.test_settlement
cd frontend && npx vitest run src/utils/approvalTiers.test.ts src/utils/settlement.test.ts
```
Currently 33 Python + 33 TypeScript, all green. Tests run against the **live DB** — scope any new test to its
own fixtures.

## 6. House rules that bind this work

- `doctype/*/*.json` is **Don't Touch** — schema goes through the Desk UI in developer mode, never a hand-edit.
- I do not run `bench migrate`, `--apply`, or a restore. You do.
- I do not `git add` / `stash` / `commit` / `push`. You do.
- Before/after row counts proving DIFF = 0 come **before** any offer to commit.
