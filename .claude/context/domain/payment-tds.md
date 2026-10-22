# Payment TDS — tax withheld, and the challan it is paid under

⚠️ **"TDS" HERE IS TAX DEDUCTED AT SOURCE.** This repo also uses "TDS" for **TECHNICAL DATA SHEET**
(`TDS Items`, `TDS Repository`, `Project TDS Setting`, the `/tds-repository` + `/tds-approval`
routes). Same three letters, unrelated concepts, different owners. A grep for `tds` lands on both
families and they must never be reconciled with each other.

Two halves: **withholding** the tax from a vendor payment (`services/payment_tds.py`, pre-existing)
and **paying** it to the department under a challan (this doc's additions, 2026-09).

---

## WHEN tax is withheld — an approval FROM AN EARLIER STEP, not any save into `Approved`

**The rule (#1288, retiring ADR-0022's "TDS on Approved" ruling; ADR-0022 Amendment A).** A deduction
is recorded when a Work Order payment is **approved from an earlier step**:

| Path | Records? |
|---|---|
| `Requested` → `Approved` | **yes** |
| `CEO Pending` → `Approved` | **yes** |
| `Rejected` → `Approved` | **yes** — a payment rejected before its first approval is still taxed |
| created already `Approved` (auto-approve below the threshold) | **yes**, via `after_insert` |
| `Reconciliation Pending` → `Approved` | no |
| `Paid` → `Approved` | no |
| anything else into `Approved` | no |

⚠️ **THE RULE IS A NAMED SET, NOT "anything except the settled statuses"** —
`payment_tds.APPROVAL_SOURCE_STATUSES`. A status inserted into the lifecycle later must be considered on
its merits rather than silently inheriting the tax.

**Why it changed.** "Any save into `Approved` withholds" was correct only while `Approved` could be
reached in one direction. The lifecycle gained `Reconciliation Pending` after it (#1282), and Bulk
Import's Unreconcile writes `Paid → Approved` — so an ordinary undo read as a fresh approval and
withheld the tax a SECOND time. Both bugs were reproduced on the local site through the real endpoints:
a payment with no tax row was netted 50,000 → 49,000 by an unreconcile, and a part payment's leftover
38,000 → 37,240 on top of the original's tax — after which the first line could not be unreconciled at
all ("Leftover taxed"), and **nothing in the app can remove a tax row**.

**Where it lives.** `payment_tds.is_approval_from_an_earlier_step(previous, new)` — pure, no database —
with exactly ONE call site, `controllers/project_payments.on_update`. ⚠️ **The insert path is
deliberately NOT routed through it**: an insert has no previous status, so the predicate answers False,
which is right for a transition and would be wrong for an insert. `after_insert` calls
`record_deduction_if_eligible` directly.

**Cheque payments pass THROUGH `Approved` (owner ruling 2026-09-19).** A Project Payment requested
as a cheque (`mode_of_payment = "Cheque"`) is approved exactly like an online one — it lands on
`Approved`, so every row of the table above applies unchanged — and only then does
`services/cheque_payments.move_to_reconciliation` move it on to `Reconciliation Pending` (the same
write as the accountant's Mark as Paid, which is not an approval). ⚠️ The move must run AFTER the
deduction: bulk approve deducts post-commit, so the move is an explicit call after
`_record_bulk_deductions` (and at the end of each single route), never a hook inside the save. A
**PO** cheque has no tax to wait for (`DEDUCTIBLE_PARENTS` is SR-only), so bulk approve moves it INSIDE its
approval group and the group's one PO save writes the term (`cheque_payments.has_no_tds_to_wait_for`);
widening TDS to Procurement Orders sends those back through the after-TDS path automatically.
`move_to_reconciliation` retries `record_deduction` (idempotent) before leaving `Approved`, because nothing can record a
deduction once the payment has left it. The cheque is written for the NET figure (after TDS).

**Unchanged by this:** the bulk-approval exemption (`bulk_actions._record_bulk_deductions` deducts
post-commit, and bulk approve is itself an earlier-step approval), the `from_adjustment` exemption, and
tax already withheld — nothing here removes or restates an existing deduction.

**A CEO part-approval is the deliberate exception.** Its leftover waits at `CEO Pending` and is taxed at
its own approval, so a payment the CEO splits can carry one tax row per part. That is correct: each part
is paid only after its own approval. A leftover split off in **Bulk Import** is different — it never
passes through `Approved` again and never carries its own deduction; the tax stays withheld once, on the
original.

---

## GST payments are never taxed (ADR-0030, #1338)

`Project Payments.is_gst_payment` (Check, `set_only_once`, default 0) marks a payment that pays a Work
Order's GST only. **`payment_tds.is_deductible` refuses it**, and every withholding route asks that
first — single approve from any earlier step, auto-approve at insert, bulk approve's post-commit phase,
the cheque move's retry — so none writes a row or nets the amount. `restate_deduction_on_amount_change`
returns early for one too. `payment_split.split_payment` copies the flag onto the leftover, which covers
both the CEO part-approval and the Bulk Import part payment. Frontend: `paymentKind.isGstPayment`
feeds `forecastTds` / `forecastTdsTotals` (no forecast, so a GST cheque is its full amount); the
approval queue returns `is_gst_payment` and the lists show a "GST" tag (`GstPaymentTag`).

---

## Company-borne Work Orders — the payment is NOT reduced (owner ruling 2026-09-17)

A Work Order whose `service_category_list` holds **only** `Miscellaneous Services` and/or
`Transportation Services` still gets a deduction row at approval, but its payment keeps the requested
figure — the company pays the tax on top:

| | Request | TDS row | `Project Payments.amount` after approval |
|---|---|---|---|
| ordinary Work Order | 800 | 16 | 784 |
| company-borne Work Order | 800 | 16 | **800** |

- **"ALL", not "ANY"** — one other category (Electrical, …) makes it ordinary; no categories is ordinary.
- **ONE rule, `payment_tds.COMPANY_BORNE_CATEGORIES` + `is_company_borne`**, mirrored on the frontend by
  `tdsForecast.COMPANY_BORNE_CATEGORIES` + `isCompanyBorneWorkOrder`. Change both or neither.
### Load-bearing invariants: which orders take tax, and whose recorded tax counts

- **Two sets, never one answering for the other (ADR-0034 Amendment B, #1534).**
  `payment_tds.DEDUCTIBLE_PARENTS` = the orders that TAKE a deduction and store `total_tds`: Work Orders
  only (`is_deductible`, `cheque_payments.has_no_tds_to_wait_for`, `total_tds_of` / `sync_total_tds`,
  `is_company_borne`). `TAX_COUNTED_PARENTS` = the orders whose RECORDED tax counts: Work Orders and POs.
  Every reader of recorded tax (Amount Paid writer, mismatch judge's paid figure, Vendor Ledger, Vendor
  report, payment summary, request limits, project outflow, payments pop-up) goes through ONE source,
  `payment_tds.counted_deductions_sql` (`paid_borne_tds_sql` for Paid payments). Asserted at import:
  `DEDUCTIBLE_PARENTS <= TAX_COUNTED_PARENTS`.
- **A PO payment still stored gross counts its tax nowhere on top.** `counted_deductions_sql` drops a
  deduction whose payment's order is not deductible and still carries the legacy `Project Payments.tds`
  box: the 86 PO payments the 2026-09 backfill left at the full bill. `patches/v3_0/net_po_payments_with_tds`
  cuts each to net and clears the box, which is what makes its tax count; its skips (bank-matched, tax
  ≤ ₹5) keep the box and read as before. Never clear that box by hand on a PO payment with a deduction
  without cutting the amount: the tax would count twice (the mismatch report shows the PO).

### Load-bearing invariants: deposited tax stays safe (#1535)

- **A payment whose deduction is in a challan can't be deleted, rejected or have its amount changed**,
  by any route (Desk, REST, `update_payment_request`, bulk reject, a PO delete's forced payment delete).
  One check, `payment_tds.refuse_if_deposited`, names the challan (`TDC-… (challan no. …)`). Called
  from the payment controller's `validate` (`refuse_reject_if_deposited`,
  `refuse_amount_change_if_deposited`) and FIRST in its `on_trash`, so a refused delete runs no
  clean-up. ⚠️ The amount guard must stay in `validate`: `on_update`'s recount commits, so a refusal
  raised there would leave the new amount saved. It is skipped on exactly the saves the restate skips
  (`NO_RESTATE_FLAGS`, `from_adjustment`): those move the amount, never the tax.
- **Rejecting a payment gives its tax back:** `payment_tds.give_back_tax_on_reject` (from
  `on_update` on entering `Rejected`) deletes the deduction and sets the amount to its `gross_amount`
  and `payment_tds` blank. Approving it again takes the tax afresh from the gross.
- **Pay TDS takes tax only from Paid payments** (`pay_tds._refuse_unpaid_payments`, inside the lock).
  The register still lists an Approved payment's deduction as Pending, and selecting it is refused.
- **A deduction is locked once in a challan, correctable before** (`controllers/payment_tds_deduction`):
  `validate` refuses any change to a row with `tds_challan` and any hand-written `status` /
  `tds_challan` (only Pay TDS writes those, by `set_value`), a new row included: a deduction is born
  Pending, in no challan; `on_trash` refuses deleting a deposited
  row; `on_update` (a correction, never an insert) recounts the order of a Paid payment and re-checks
  CEO Hold, as `after_delete` does. A correction leaves the payment's amount alone.
- So no path removes a deduction from a challan, and `reconciled_amount` moves only when Pay TDS pays.

### Load-bearing invariants: a challan and its TDS Payment expense (#1544)

- **A deposit is booked twice, by hand:** as a challan (what Pay TDS spends) and as a non-project
  expense of type *TDS Payment* (the money in the expense books). `TDS Challan Attachment.tds_payment_expense`
  (Link → Non Project Expenses, **unique**) says which expense is the challan's. Nothing creates or links
  either side automatically.
- **What may be linked is the challan's own `validate`** (`_validate_tds_payment_expense`): type *TDS
  Payment*, not *Rejected*, on no other challan (the refusal names that challan; the unique index holds
  under two simultaneous saves). Desk and the challan list's Link (`api/tds_challan/challan_expense.set_challan_expense`,
  a document save) refuse the same things. Clearing the link is allowed.
- **Every challan is a deposit already made**, so every challan without an expense carries the warning
  (View Challans button count, the dialog header, the row). A linked expense can't be deleted: Frappe's
  link check refuses it while the challan points at it.

### Load-bearing invariants: bulk approve's tax failures (#1536)

- **Bulk approve names every approved payment whose tax it could not withhold** (`tds_failed` from
  `bulk_actions._record_bulk_deductions`, after the approvals' commit). Such a payment is Approved at its
  GROSS amount. The Approve Payments bar shows them (`BulkActionBar`, "TDS failed on N", opening by itself)
  until dismissed.
- **Retry TDS** (`bulk_actions.retry_bulk_deductions`, L1 as bulk approve) runs the same phase over those
  names: only a payment still at `Approved` can take its tax (`is_deductible`); one that has moved on comes
  back in `not_approved`, untouched. A retried Work Order cheque then moves on to Reconciliation Pending,
  as after a bulk approve (`_move_on_approved_cheques`). Idempotent: a payment with a deduction counts as
  recorded and is not cut twice.

### Load-bearing invariants: who bore the tax

- **`Payment TDS Deduction.borne_by` IS THE SOURCE (#1451).** A stored field by owner ruling 2026-10-16,
  overriding the 2026-09-17 "no new field" ruling. `Vendor` = withheld, the payment cut to
  the net; `Company` = paid on top, the payment kept whole. Read-only, column default `Vendor`. The
  category rule decides it ONCE, when the row is created: `record_deduction` (the one function every
  approval route shares: single approve, a split's approved half, auto-approve at insert, bulk approve
  post-commit) asks `is_company_borne` and passes `write_deduction(borne_by=...)`, which stores it and
  cuts the payment only for `Vendor`. `write_deduction` defaults to `Vendor`, so the historical
  backfills are unchanged. Nothing rewrites `borne_by` after that, except the Admin action below.
- **_TDS paid by company_ (#1537) is the one way `borne_by` moves, Vendor → Company only.**
  `api/payments/tds_paid_by_company.mark_tds_paid_by_company` (Admin, `is_nirmaan_admin`) →
  `payment_tds.mark_tds_paid_by_company`: a Work Order payment's deduction, before *Paid* or after *Paid*
  while its tax is not in a challan (`refuse_if_deposited`). It changes no figure (payment amount,
  `gross_amount`, `tds_amount` stay), so the tax leaves Amount Paid and stays in `total_tds` and project
  outflow: ₹10,000 paid with ₹204 "withheld" → Amount Paid 10,204, Due −204 → 10,000 and 0. It saves the
  deduction through the doc layer, so `controllers/payment_tds_deduction.on_update` recounts through
  `write_amount_paid` and re-checks CEO Hold, and its Version (`ignore_version=False`, written even in a
  test run) records who and when. Any other change of `borne_by` (Desk, REST) is refused
  (`refuse_hand_written_borne_by`; the action sets `flags.tds_paid_by_company`).
- **A payment whose tax was cut (`Vendor`) can't be raised (#1537)**, `payment_tds.refuse_raise_after_cut`
  from the payment's `validate`, on the saves the restate runs on (not `NO_RESTATE_FLAGS` /
  `from_adjustment`). A raised net was grossed up again (9,800 → 10,000 read as 10,204 gross, 204
  withheld), which is how the negative-Due Work Orders arose. The message names *TDS paid by company*.
  Lowering still restates; a `Company` payment (never cut) may be raised and is taxed on the new gross.
- **Every reader reads the field, never the categories or the amounts:**
  - **Amount Paid includes the vendor's tax (ADR-0034 Amendment A, #1509).** A WO's stored
    `amount_paid` = its Paid payments + the `Vendor` deductions on them − its Received refunds;
    `amount_due = total − amount_paid`. `Company` tax (paid on top) is in neither. ₹10,000 gross,
    ₹200 withheld, ₹9,800 paid → Amount Paid ₹10,000. ONE source for "tax by order",
    `payment_tds.borne_tds_by_order_sql` (columns `vendor_borne_tds`, `company_borne_tds`, Paid
    payments only, joined through the PAYMENT's order): the writer (`amount_paid.amount_paid_of`, via
    `borne_tds_by_order`, with `exclude_payment` on a delete) selects from it and the mismatch judge
    (`amount_paid_drift.mismatches`) joins it into its one query per doctype. `total_tds` (both kinds)
    is still stored and judged against the deduction rows, but it is no Amount Due operand, and adding
    it onto `amount_paid` counts the tax twice (ratchet `p1_tds_added_to_amount_paid`, baseline 0).
  - **Every change to a Paid payment's deduction recounts through `amount_paid.write_amount_paid`**
    (Amount Paid, `total_tds`, Amount Due): a deduction created on a Paid payment
    (`write_deduction`) or restated by an amount edit (`restate_deduction_on_amount_change`), both via
    `payment_tds._recount_parent`, which does nothing for a payment not Paid (its tax counts nowhere
    yet); a delete through the payment's `on_trash` recount (`exclude_payment`); a deduction deleted
    on its own through `controllers/payment_tds_deduction.after_delete`, which takes a forced delete
    (a plain one is refused by the link from `Project Payments.payment_tds`). The tax on a Paid
    payment moves project outflow (#1510), so the CEO Hold check runs after each: the payment's own
    `on_project_payment` hook after its `on_update` (restate), `recheck_after_recount` (deduction
    delete). The cashflow hold rule itself is pure, `services/ceo_hold/rules.over_cashflow_limit`.
  - An amount edit (`restate_deduction_on_amount_change`) restates the figures by the row's own
    `borne_by` (`Company`: the edit is the gross, `tds = amount × rate`; `Vendor`: it is the net,
    inverted) and keeps `borne_by`.
  - A part settlement (split) leaves the deduction untouched, so a kept-whole payment cut to the bank's
    figure stays `Company`.
  - The request caps add back only `Vendor` tax: server `order_payments.load_payments` (feeds
    `payment_summary`, `work_order_payment_limit`). Per deduction, so a Work Order with both kinds
    counts each payment right. The WO Request Payment dialog reads only that server balance
    (`get_payment_summary`) and confirms nothing until it has loaded; it has no local WO figure.
  - The WO page's one Amount Paid tile has a hover (`SRDetailsCard`, `tdsForecast.amountPaidParts`):
    Paid to vendor (Amount Paid − withheld) / TDS withheld / Total (= stored Amount Paid), plus "TDS
    paid by company (on top)" outside the Total. The parts come from the server,
    `api/payments/work_order_tds.get_work_order_tds` → `payment_tds.work_order_tds_borne`: the
    deductions on the WO's **Paid** payments only, split withheld / company off `borne_tds_by_order`
    (the writer's own source), kind `withheld` / `company` / `part`; nothing paid yet → the deductions
    recorded on its other payments (any status), and only with none → the category rule (#1537). There is no separate TDS tile. The same answer carries `payments`
    (`payment_tds.work_order_deductions`: each payment's `tds_amount` and `borne_by`, any status) for
    the WO page's transactions table TDS column.
  - **The vendor-level figures read the same split per payment (#1512)**, off
    `payment_tds.paid_borne_tds_sql` (one row per Paid payment's deduction, `vendor_borne_tds` /
    `company_borne_tds` from `borne_tds_by_payment_sql`, with the payment's columns;
    `borne_tds_by_order_sql` is its per-order sum, and project outflow's WO TDS adds both kinds). Python
    readers get `payment_tds.BorneTds(vendor, company)`. The Vendor Ledger (screen and
    PDF, `api/vendor/get_vendor_po_invoices.get_po_ledger_data` via `borne_tds_by_payment`): a WO
    payment row is payment + its `Vendor` tax, details "incl. TDS ₹x". The Vendor report's dated paid
    figure (`services/vendor_paid`): the `Vendor` tax on the payment's date. The payments pop-up
    (`PaymentsDataDialog`, `paymentsDialogRows`): a TDS column from `get_work_order_tds` `payments`,
    `Vendor` rows only; its **Total is the order's saved Amount Paid** (#1543), never the rows' sum.
    The rows (payments + TDS − Received refunds) are checked against it once all have loaded, and a
    drift of ₹1 or more (the mismatch report's `THRESHOLD`) shows a warning (`amountPaidLine`). Read
    through the one accessor `useWorkOrderTds` (SWR key `WorkOrderTds-<id>`, shared with the WO page);
    the TDS column shows a loading state until it answers. `Company` tax adds nothing to any of them.
  - **Company tax is labelled wherever a tax column lists it** (#1543): the WO payment table's TDS cell
    (`tdsPreview.tdsColumnNote`) and the Payment Voucher Uploads report say "TDS paid by company". The
    TDS register's Net Paid is what the vendor got: gross − tax for `Vendor`, the whole gross for
    `Company` (`deductionNetPaid`).
- **`Payment TDS Deduction` is readable only by Accountant, Accountant Lead and System Manager**, and
  its permissions stay so. Anything a non-accountant screen needs from it goes through a whitelisted
  read that checks read on the parent order (`get_work_order_tds`, `get_order_payment_tds`,
  `get_payment_summary`, and for Reports > WO > Payment Voucher Uploads
  `get_paid_work_order_payment_tds`, which keeps only the Work Orders `frappe.get_list` lets the caller
  read, #1543). A page's own list read of the doctype is refused to Procurement with a 403 (walk story
  27, #1451), so no non-accountant screen reads it at all.
- **Why stored, not inferred:** the Misc/Transport Work Orders paid before 2026-09-17 had their tax
  netted out of the vendor's payment (SR-00041-000138: ₹24,800 → ₹24,552 + ₹248 TDS, due 0) and stay
  `Vendor`; SR-00107-001055 has both kinds. Inferring from payment ≈ gross broke on a part settlement
  and an amount edit, and categories can change after a deduction is taken.
- **Existing rows were backfilled once** by `patches/v3_0/backfill_payment_tds_borne_by` with that
  inference (payment nearer `gross_amount` than `gross_amount − tds_amount`, on a WO whose categories
  are company-borne → `Company`; all else `Vendor`). It recounts nothing; drift is left to the Amount
  Paid Mismatch report. On the env clone (2026-10-16): 16 `Company`, 767 `Vendor`; Service Requests
  mismatches stay 7, as after `e8e7ef3ce`.
- The forecasts for a NEW approval (approve + bulk-confirm previews: `useVendorTdsRates`
  `companyBorneFor`) still use the category rule, as `record_deduction` will.

### Load-bearing invariants: the TDS preview before approval (#1541)

- **The server works the preview out, from approval's own pieces.** `services/tds_forecast.py`:
  `forecast` / `figures` use `payment_tds.vendor_rate` (the vendor's rate TODAY, owner ruling X3-A),
  `is_company_borne`, `tds_on` (the formula `record_deduction` uses) and `is_withholdable` (the guard
  `write_deduction` uses), and a typed amount is first rounded as the request stores it
  (`request_amount_as_stored`, which `create_payment_request_for_service` itself calls). Change those
  pieces, never a copy. Readers: the Request Payment dialog (`api/payments/tds_forecast.forecast_work_order_tds`,
  via `useTdsForecast`; read checked on the Work Order) and the WO page's payment table
  (`get_work_order_tds` `forecasts`: each Requested / CEO Pending, non-GST payment without a deduction).
  The approve dialogs, single and bulk (`api/payments/tds_forecast.forecast_payments_tds`, via
  `usePaymentTdsForecasts`; `services/tds_forecast.payment_forecasts`, on the stored amount or a partial
  approval's typed figure). The browser holds no copy of the rate or the company-borne categories (spec
  #1528 story 59): the bulk dialog only adds the server's figures up (`tdsPreview.forecastTotals`).
- **Nothing is written before approval.** A request left at Requested has no deduction
  (`test_tds_forecast`). A request below ₹15,000, or raised by someone holding the approval, is born
  Approved and is taxed at insert, so the dialog says "Tax is cut now" (`cut_now`, from the endpoint's
  own routing `_tier_new_payment`).
- **"Req. Amount" is the full bill whatever the status (owner ruling X4-A).** The WO page table:
  Req. Amount / TDS / To be paid (`tdsPreview.paymentTableFigures`: a recorded `Vendor` deduction is
  added back onto the cut amount). The approval queue (All Payments, accountant tabs, CSV): the row's
  `requested_amount` (a union column in `api/approvals/get_approval_queue`: the stored amount plus the counted
  `Vendor` tax, `counted_deductions_sql`) with a "To be paid" line under it when they differ. The column's
  sort and filter (id `amount`) read `requested_amount` too (`_COLUMN_FOR`, story 60), as does the "Req. Amt"
  selection pill (`bulkSelectionSummary.requestedTotal`). `amount` stays the stored figure: every action, the
  summary total, the Mark-as-Paid confirm total and the bank file read it.

---

## The vendor's rate — set from its PAN (Section 194C)

`Vendors.tds_deduction_percentage` is the rate `vendor_rate` snapshots at approval. The PAN's 4th
letter decides it (owner, 2026-10-16):

| PAN | Rate |
|---|---|
| valid, 4th letter **P** (Individual) or **H** (HUF) | **always 1%** — the forms lock the field; the server puts any other figure back to 1 |
| valid, any other 4th letter | **2% by default**; any rate the user sets (1, 3, 4…) is kept |
| blank / not a valid PAN | kept as entered |

- **ONE rule, `services/vendor_tds.py`**, applied by `Vendors.validate` **only when a vendor is
  created or its PAN / rate is edited**: the vendor screens, Desk, Data Import. Every other save
  leaves the rate alone, so the 04:30 credit job's full vendor save never moves a rate. Mirrored on
  the frontend by `pages/vendors/utils/vendorTaxIds.ts`; both suites read
  `services/vendor_tds_cases.json`. Change both or neither.
- **Corrected, never refused.** A blank or unreadable rate ("2%", "abc") with a valid PAN gets the 2%
  default rather than being stored as 0 (no tax withheld).
- **Moving off an Individual / HUF PAN puts a default back in the form only**: 2% on the new-vendor
  form, the saved rate (or 2%) on the edit form. The server keeps whatever rate arrives with a
  non-Individual PAN, so a Desk edit from P to C with the rate left at 1 stays 1.
- A PAN edit moves only future approvals; past deduction rows keep their snapshot (above).

---

## The two doctypes

**`Payment TDS Deduction`** — one deduction, one payment.

| Field | Note |
|---|---|
| `project_payment` | Link → Project Payments. **UNIQUE, and that constraint IS the idempotency guarantee** — only the first qualifying approval can write a row, which is also what stops the amount being netted twice. |
| `gross_amount` | The amount BEFORE tax. ⚠️ The only surviving record of it: `Project Payments.amount` is rewritten to the net. |
| `tds_percentage` | The rate AS APPLIED, snapshotted. Never re-read from the vendor — 561 of 629 rows differ from their vendor's rate today. |
| `tds_amount` | `gross × rate / 100`. What `Service Requests.total_tds` sums (Paid payments only). |
| `borne_by` | `Vendor` (withheld, payment netted) / `Company` (paid on top, payment kept whole). Read-only, set once at creation (#1451); THE source for every reader — see § Company-borne. |
| `payment_approved_on` | The day the payment was **approved** — the day this row was written, which is the approval that withheld the tax. Not "the day it last entered Approved": a later `Paid → Approved` save writes nothing (see the rule above) and moves nothing here. Renamed from `deducted_on` (2026-09-12). |
| `deducted_on` | ⚠️ **RETIRED, READ-ONLY, FROZEN.** The pre-rename copy, kept until the owner drops the column by hand. Nothing writes it, so rows created after the rename leave it empty — never read it as the live date. |
| `status` | `Pending` → `Paid`. Written by the Pay TDS action, never by hand. |
| `tds_challan` | Link → TDS Challan Attachment. |

**`TDS Challan Attachment`** — one ITNS 281 receipt.

Carries financial year, amount, mode of payment, bank + bank reference, date of deposit, BSR code,
challan no, tender date and the attachment, and `tds_payment_expense` (#1544, see the invariants above).

- **Duplicate key: Amount + Bank Reference Number + BSR Code + Challan No.** All four matching means
  the same receipt uploaded twice. The site is Postgres (case-sensitive), so the text parts are
  trimmed and the bank reference upper-cased before the lookup.
- `bsr_code` / `challan_no` are **Data, not Int** — both carry meaningful leading zeros (`00069`).
- `reconciled_amount` is **read-only and server-owned** (see below). Remaining balance is
  `amount - reconciled_amount`, derived at the point of use, never stored.

**`Project Payments.payment_tds`** — Link → Payment TDS Deduction, **read-only**. A MIRROR, not the
authority: `project_payment` above is the real link. The service writes it when the deduction is
recorded and repairs it on the next save if blank. ⚠️ The self-heal only fills a BLANK one; it does
not correct a wrong value.

---

## `reconciled_amount` — the one rule, and the bug it already caused

**A challan's `reconciled_amount` IS the sum of the deductions pointing at it.** It is always
**RECOMPUTED FROM SOURCE, never adjusted by a delta** — a `+=` on pay and a `-=` on delete would be
two arithmetic paths that must agree forever.

The rule lives in **`services/payment_tds.recompute_challan_reconciled`** — in the service, not in
`api/`, because a CONTROLLER must be able to call it and a controller may not import from `api/`.
It is the **only writer** of that field.

One caller since #1535: `api/tds_challan/pay_tds`, which adds its own over-application guard before
writing. The payment's delete and both deduction delete paths used to recompute too; they no longer
need to, because a deduction in a challan can't be deleted, rejected, restated or edited (§ deposited
tax stays safe), so nothing else moves the sum.

⚠️ **MEASURED BUG (2026-09-15):** deleting a payment deleted its deduction, but nothing recomputed —
a challan sat at ₹150 used with **zero** deductions behind it. A recompute on delete fixed the number;
#1535 removed the cause (deposited tax could be deleted at all).

---

## Paying — `api/tds_challan/pay_tds.py`

- `pay_tds(deductions, challan)` — spend an existing challan's balance.
- `create_challan_and_pay(deductions, challan_data)` — mint the challan and pay in the **same
  transaction**, so a challan is never left created-but-unused.

Both take a `SELECT ... FOR UPDATE` lock on the challan **before reading anything**, then re-check
every selected deduction inside that lock (still Pending, still unlinked, its payment Paid). ⚠️ **The client's total
is never trusted** — the amount is summed from the database rows, because the browser's figure was
computed before the lock existed. A selection exceeding the challan's remaining balance is refused,
naming the shortfall; there is **no partial payment and no splitting one deduction across two
challans**.

---

## Editing a payment that already carries a deduction

⚠️ **THE EDITED AMOUNT IS THE NET.** Once a deduction exists, `Project Payments.amount` IS what left
the bank, so an edit to it is an edit to the net. A raise of a cut payment is refused (§ who bore the tax, #1537), so on a `Vendor`
row only a lowering gets here. `restate_deduction_on_amount_change` re-derives:

```
gross = net / (1 - rate/100)        tds = gross - net
```

at the deduction's **own snapshotted rate**, then, on a Paid payment, recounts the parent through `amount_paid.write_amount_paid` (Amount Paid holds the vendor's tax, so
the restated tax moves it, not only `total_tds`).

- ⚠️ **It must NOT re-net the payment.** `write_deduction` rewrites `amount` once, at creation;
  doing it again would shrink the payment on every edit, compounding.
- ⚠️ **It sits ABOVE the status early-return in `on_update`**, which returns when the status has not
  changed — an amount edit changes no status, so everything below that line is unreachable for it.
  Same placement reason as the `after_insert` call.
- An edit of a payment whose tax is in a challan is **refused** in `validate`, before anything is
  written (#1535). The old over-application check ran in `on_update`, after the recount had committed
  the new amount.

---

## Reading the challan off a receipt (Gemini)

`doc_kind="tds_challan"` on the shared `services/extraction/` seam plus
`api/tds_challan_autofill.extract_challan_fields`. Nothing is persisted — the response fills a form
the user corrects.

- `bsr_code` / `challan_no` stay **strings** so leading zeros survive.
- `mode_of_payment` is **snapped to the doctype's Select options**, else blank — an unrecognised
  value fails Frappe's own option check on insert.
- ⚠️ The extracted **amount is cross-checked against the receipt's own tax breakup**, because that
  figure becomes the ceiling on what can be paid against the challan; a misread would cap every
  later payment silently. The financial-year check is format-only, so an Assessment-Year misread
  (`2026-27`) passes it — the prompt and the amber tint are the only guards there.

---

## Frontend

Reports hub → **Payment TDS Deduction** tab (report type "TDS Deduction"), gated by
`PAYMENT_TDS_ACCESS`. `/payment-tds-deductions` redirects into it.

- Checkbox selection is limited to **Pending** rows; a paid row's checkbox is disabled and
  select-all skips it. ⚠️ Turning selection on also re-aims **Export** at the selection (the shared
  DataTable gates both on one prop).
- **Pay TDS** button carries the count and rounded total; the dialog has two arms — old challan, or
  upload → Gemini → create + pay. The upload shows the drop zone alone until a file lands: a failed
  **upload** keeps the form hidden (no receipt, no challan), a failed **read** opens it blank with
  the reason.
- **View Challans** lists every challan *including fully-used ones* — the picker answers "what can I
  pay from?", this answers "what have we deposited?". Its Expense column links or unlinks the
  challan's TDS Payment expense (§ a challan and its TDS Payment expense); the picker leaves out
  expenses already on another challan (`challanExpense.linkableExpenses`).
- Project / Payment / Gross / Net columns are **hidden by default**, not deleted (⚠️ hiding `project`
  also removes its facet dropdown).

---

## Patches

| Patch | Does |
|---|---|
| `rename_deducted_on_to_payment_approved_on` | Copies the dates across. **Drops nothing** — the owner drops the old column by hand. |
| `backfill_payment_tds_deduction_link` | Fills `Project Payments.payment_tds` for the 626 existing rows. |
| `backfill_payment_tds_borne_by` | Sets `borne_by` on every existing row from its payment (kept whole on a company-borne WO → `Company`, else `Vendor`). Recounts nothing. ⚠️ **Run once only** (the patch log is its only guard): a re-run would re-infer rows `record_deduction` wrote since, off payments that may have changed. The reason it cannot be limited to old rows is at the top of the patch. |
| `recount_work_order_amount_paid_with_tds` | Recounts every Work Order the mismatch judge finds wrong through `write_amount_paid` (ADR-0034 Amendment A, #1513). Run by hand, `preview` first: it lists the Work Orders the tax explains (Amount Paid short by exactly the TDS withheld from the vendor) apart from those wrong for another reason (#1545), and each project the WO tax in project outflow newly puts over its cashflow limit, for the owner. Re-checks no CEO Hold; idempotent. |
| `net_po_payments_with_tds` | Cuts each PO payment with a tax record still stored gross (legacy `tds` box filled) to gross − tax and clears the box (ADR-0034 Amendment B, #1534). Skips and lists bank-matched payments and tax ≤ ₹5. Recounts each touched PO (refund sync step, vendor credit under "PO TDS Netting"), re-checks CEO Hold, and aborts writing nothing unless each touched PO's Amount Paid / Amount Due, vendor credit and project outflow are unchanged. Run by hand, `preview` first; idempotent. |

The first two are idempotent and fill only what is still empty.

---

## Testing — reach the tax code, or you test nothing (#1284)

⚠️ A payment planted by raw SQL with **no vendor** can never be taxed (`is_deductible` needs one), so
a suite built that way cannot see a tax bug. The Bulk Import and payment-split suites were built that
way, and that is how the double-TDS bugs in #1283 went unseen.

Use **`api/payments/taxed_work_order_fixture.TaxedWorkOrderFixture`**: a Service Request payment with a
2% vendor, approved through the real `ceo_approve_payment`, so the deduction row and the netted amount
come from production code (50,000 → 49,000 by default). It refuses to return a payment with no tax row,
and `attach(test)` registers a purge that also sweeps split leftovers minted under its projects. Pinned
by `api/payments/test_taxed_work_order_fixture.py`.

---

## Known gaps

- **No reversal or unlink path.** A deduction is deleted with its payment or on its reject, only
  before a challan; nothing detaches one from a challan. Any future unlink must reuse
  `recompute_challan_reconciled`, never subtract.
- The register does not show the payment's status, so an Approved payment's deduction can be ticked
  and is then refused by Pay TDS (#1535).
- The mirror self-heal fills a blank, not a wrong value.
- A challan that drifted before the fix stays wrong until something is paid against it (the pay path
  recomputes). One such row exists on localhost by owner decision.
- Gemini challan extraction has never run against a real challan file; none of the UI has been
  verified in a browser.
