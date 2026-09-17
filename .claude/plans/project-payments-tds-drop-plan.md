# Plan: remove the `tds` field from Project Payments

**Status: Phase 1 (code) DONE, uncommitted — 2026-09-16.** Resumed by the owner the same day.
Phases 2–4 (doctype + migrate, Desk reports, column delete) are the owner's. Section 9 browser checks
not yet done.

**Scope:** the legacy `tds` field on the **Project Payments** doctype (fieldtype Data). This plan does
**not** touch the `Payment TDS Deduction` doctype, the TDS challan screens, or the TDS Repository
(Technical Data Sheet) — they share the three letters only.

**Already done, outside this plan:** the TDS input was removed from the Fulfil Payment dialog
(`frontend/src/pages/ProjectPayments/update-payment/UpdatePaymentDialog.tsx`). The fulfil payload no longer
sends `tds`.

---

## 1. Facts this plan rests on

| Fact | Detail |
|---|---|
| `bench migrate` does not delete the column | Removing the field from the doctype leaves the DB column and its values in place. Only `bench trim-tables` (or an `ALTER TABLE`) deletes it. |
| Frontend list calls fail soft | A REST list call asking for a field the doctype no longer has gets that field silently dropped — no error, the value is just `undefined`. |
| Backend reads fail hard | `frappe.get_all`, `frappe.db.get_value` and raw SQL skip that check. They keep working while the column exists and **crash once it is deleted**. |
| Saves ignore it | Setting `doc.tds` on a document whose doctype has no `tds` field is silently ignored on save. |
| Data (localhost, 2026-09-16) | 712 Paid payments hold a value: 87 PO (₹1,39,503.78), 625 Work Order (₹6,34,002.06). No non-numeric values. |
| Values already preserved | All three backfill patches are in Patch Log; 711 of the 712 have a matching record elsewhere. |
| One value not preserved | `PAY-00063-061` — PO/032/00063/25-26, amount ₹295, tds 0.295. |

---

## 2. Decisions the owner must make before starting

1. **`PAY-00063-061`** — accept losing its ₹0.295, or record it by hand first.
2. **Outflow Import "Settled with TDS" block** — once `tds` is gone this block can never fire, so a payment
   that had a TDS value becomes un-reconcilable on the Outflow Import screen. Accept that, or replace the
   check with a different one.
3. **PO TDS going forward** — after this plan, no screen anywhere lets a person record TDS on a PO payment
   (only Work Order payments are deducted automatically). Confirm that is intended.

---

## 3. Phase 0 — Pre-checks (on production data, read-only)

- [ ] Re-run the data counts on production (the numbers above are from localhost).
- [ ] Confirm the three backfill patches are in production's Patch Log:
      `backfill_sr_payment_tds_deductions`, `backfill_po_payment_tds_deductions`,
      `backfill_payment_tds_deduction_link`.
- [ ] Re-list saved Desk reports on Project Payments that use `tds` (localhost has 4 — see Phase 4).

---

## 4. Phase 1 — Remove every code reference (one commit, column still exists)

Safe to deploy on its own: the field still exists, so nothing reads a missing column.

### 4a. Approval queue — **edit both SQL lines together**

| File | Change | What happens |
|---|---|---|
| `nirmaan_stack/api/approvals/get_approval_queue.py:132` **and** `:175` | Delete the `tds` column from **both** branches of the UNION (and the comment at `:125`). | Removing only one = SQL error, whole approvals screen fails. |
| `frontend/src/pages/ProjectPayments/config/approvalsTable.config.ts:94` | Delete `tds: string;` (and its mention in the comment at `:87`). | Type only. |
| `frontend/src/pages/ProjectPayments/config/approvalExportColumns.ts:120` | Delete the `col("tds", "TDS", …)` line (and the mention at `:19`). | CSV export loses its TDS column. |
| `frontend/src/pages/ProjectPayments/approve-payments/components/BulkActionBar.tsx:16` | Drop `tds` from the comment. | Comment only — nothing in the bulk path reads it. |

### 4b. Outflow Import undo — **edit as one unit**

| File | Change | What happens |
|---|---|---|
| `nirmaan_stack/api/outflow_import/unreconcile_split.py:52, 64` | Remove `"tds"` from the field list and `tds=payment.tds`. | — |
| `nirmaan_stack/api/outflow_import/unreconcile_split.py:87, 97` | Same, for the child payments fetch. | — |
| `nirmaan_stack/services/outflow_import/unreconcile.py:190` | Remove `tds` from the facts class. | — |
| `nirmaan_stack/services/outflow_import/unreconcile.py:266–275` | Remove the "Settled with TDS" refusal (and its docstring bullet at `:43`). | See decision 2. |
| `nirmaan_stack/services/outflow_import/unsplit.py:100–101` | Remove `tds` from the leftover class. | — |
| `nirmaan_stack/services/outflow_import/unsplit.py:146` | `normalize_amount(leftover.tds) or leftover.tds_deducted` → `leftover.tds_deducted`. | Still refuses when a deduction record exists. |

### 4c. Screens that show or edit the value

| File | Change | What happens |
|---|---|---|
| `frontend/src/pages/ProjectPayments/PaymentsDataDialog.tsx:40, 98, 109, 111` | Remove `tds` from fields, the "TDS Amt" header + cell; amount cell shows `payment.amount`. | 87 PO payments show gross (higher by their TDS); 625 Work Order payments stop showing TDS subtracted twice. |
| `frontend/src/pages/ProjectPayments/update-payment/EditFulfilledPaymentDialog.tsx:33, 63, 72, 83–88, 95, 166–167, 173` | Remove the TDS input, form state, payload key and the `amountPaid` line. | Nobody can type TDS on any payment. |
| `nirmaan_stack/api/payments/project_payments.py:397` | Delete `pay.tds = …` (and the commented copies at `:527`, `:575`). | Nothing visible. |
| `frontend/src/pages/ProjectPayments/hooks/useUpdatePaymentRequests.ts:8` | Delete `tds?: number`. | Type only. |

### 4d. Fetched but never used — remove, nothing changes

- `frontend/src/hooks/useOrderPayments.ts:11`
- `frontend/src/pages/vendors/components/VendorMaterialOrdersTable.tsx:130`
- `frontend/src/pages/reports/hooks/useOutflowReportData.ts:74` (and the commented line `:134`)

### 4e. Types and dead screens — remove, nothing changes at runtime

- Types: `frontend/src/types/NirmaanStack/ProjectPayments.ts:30`,
  `frontend/src/pages/ServiceRequests/approved-sr/types/index.ts:10`.
  **Remove the type first** — TypeScript then lists every leftover use.
- Unreachable (no button opens them / not routed):
  `ProcurementOrders/purchase-order/components/TransactionDetailsCard.tsx` (TDS input + `tds` in `createDoc`),
  the add-payment dialog in `ProjectPayments/project-payments-list.tsx`,
  `ServiceRequests/approved-sr/components/SRNewPaymentDialog.tsx`,
  `ServiceRequests/approved-sr/hooks/useSRPaymentManager.ts`,
  `ServiceRequests/approved-sr/components/SRPaymentsSection.tsx`,
  `ProjectPayments/AmountPaidHoverCard.tsx` (not imported anywhere),
  commented lines in `ProjectPayments/order-payment-summary.tsx`.

### 4f. Tests

| File | Change |
|---|---|
| `nirmaan_stack/services/outflow_import/test_unreconcile.py` (lines 53, 90–91, 128, 220, 230) | Delete the "Settled with TDS" cases and the `tds` fact inputs. |
| `nirmaan_stack/api/outflow_import/test_reverse_allocation.py:153` | Delete the case that plants `tds` to test the block. |
| `nirmaan_stack/api/outflow_import/test_unreconcile_part_payment.py:219` | Same. |
| `nirmaan_stack/api/outflow_import/test_unreconcile_row.py:57` | Same. |
| `nirmaan_stack/api/outflow_import/test_settle_payment.py:375, 387` | Drop only the `tds` part of the assertions. |
| `nirmaan_stack/api/outflow_import/test_review.py:501–503` | Drop only the `tds` part of the assertion. |
| `test_unreconcile_tds.py`, `api/payments/test_taxed_work_order_fixture.py` | **No change** — their `made.tds` is a fixture value, not this field. |

### 4g. Docs that describe the field or the block

- `.claude/context/domain/outflow-import.md`
- `docs/adr/0022-unreconcile-and-unskip.md` (the "Settled with TDS" refusal — add an amendment, don't rewrite)
- `docs/adr/0021-the-statement-import-records-no-tax.md`

### 4h. Phase 1 done when

- [x] `grep -rnw tds` in the files above returns only unrelated uses (TDS Repository, `tds_amount`, `tds_deducted`, `tdsForecast`).
      Left on purpose: historical comments, commented-out `order-payment-summary.tsx`, compiled `public/frontend` assets.
- [x] `npx tsc --noEmit`: the project carries ~3,225 pre-existing errors; none remain from this change.
      ⚠️ macOS has no `timeout` command — never wrap `tsc` in it, the check silently never runs.
- [x] Tests: `test_unreconcile` (52), `test_unreconcile_row`, `test_reverse_allocation`,
      `test_unreconcile_part_payment`, `test_unreconcile_payments`, `test_unreconcile_tds`, `test_settle_payment` all OK.
      `test_review`: 323/324 — the 1 failure is live-data drift (an approved EXPENSE at ₹1,234.50), unrelated.
- [x] Approval queue endpoints called for every status + export/counts/facets: OK, rows carry no `tds`.
- [ ] Browser: every screen in section 9 checked.
- [ ] Committed and deployed.

**Extra, beyond the original list:** `AmountPaidHoverCard.tsx` deleted (imported nowhere);
`test_unreconcile.py` had more `tds` uses than 4f listed (fixtures + ordering tests) — kept by swapping
in `tds_deducted`; docs amended (ADR-0022 Amendment C, ADR-0021 notes, `outflow-import.md`).

---

## 5. Phase 2 — Remove the field from the doctype (owner runs migrate)

- [ ] `nirmaan_stack/nirmaan_stack/doctype/project_payments/project_payments.json`: remove `"tds"` from
      `field_order` (line 18) and the field block (lines ~78–82).
- [ ] Owner runs `bench --site <site> migrate`.
- [ ] Check: `frappe.db.has_column("Project Payments", "tds")` is still **True** (expected — values kept).
- [ ] Re-run the Phase 1 browser checks.

---

## 6. Phase 3 — Fix the saved Desk reports

In Desk, open each Report Builder report, remove the TDS column, save:

- [ ] Project Wise Payments
- [ ] Paid Payments
- [ ] Project Payment FY 25-26
- [ ] Project Payment last 3 months

---

## 7. Phase 4 — Delete the column (irreversible)

Only after Phases 1–3 are live in production.

- [ ] Take a database backup.
- [ ] Dry run: `trim_table("Project Payments", dry_run=True)` returns **only** `tds`.
      If it lists any other column, stop — do not use `trim-tables` for the whole site.
- [ ] Owner deletes the column.
- [ ] Check: approvals screen loads, Outflow Import undo works, `has_column` is False.

---

## 8. Rollback

| Stage | How to undo |
|---|---|
| After Phase 1 | Revert the commit. |
| After Phase 2 | Put the field back in the doctype JSON and migrate — values are still in the column. |
| After Phase 4 | Restore from the backup. There is no other way back. |

---

## 9. Screens to check

**Sample payments** (localhost, 2026-09-16) — write down what they show BEFORE starting:

| Sample | Against | Vendor / Project | Amount | TDS | Shown today as "paid" | After the change |
|---|---|---|---|---|---|---|
| `PAY-00043-116` | PO/033/00043/25-26 | Dhatri Networks Pvt Ltd / Work Square SS Plaza | ₹8,44,856 | ₹716 | ₹8,44,140 | ₹8,44,856 |
| `PAY-00187-055` | SR-00187-000969 | MD NAUSHER / Telus GIFT City | ₹74,844 | ₹756 | ₹74,088 | ₹74,844 |

**When:** check all of them after Phase 1 is deployed and again after Phase 2. After Phase 4, re-check the
ones marked ⚠ — those are the screens that crash if a code reference was missed.

### A. Project Payments — `/project-payments` (all tabs read the approval queue)

- [ ] ⚠ **Payment Pending Approval** — loads; export CSV (no TDS column); tick rows → bulk bar opens.
- [ ] ⚠ **Payment Pending CEO Approval** — loads.
- [ ] ⚠ **Payment need to paid** — loads; **Mark as Paid** → Fulfil dialog has no TDS field, "Total Paid" shows, Confirm works.
- [ ] ⚠ **Payment Done / Reconciliation Pending** — loads.
- [ ] ⚠ **Payment Done / Reconciliation Done** — loads; as Admin, pencil → Edit dialog has no TDS input and saves.
- [ ] **PO Wise** (hidden tab, open `/project-payments?tab=PO Wise`) — loads; Amount Paid → Payments dialog.

### B. Payments dialog (the "amount − TDS" screen)

- [ ] Vendor page (Dhatri Networks Pvt Ltd) → **Material Orders** → click **Amount Paid** on PO/033/00043/25-26.
- [ ] `/purchase-orders` list → click **Amount Paid** on PO/033/00043/25-26.
- [ ] Project page (Work Square SS Plaza) → **Financials** → **All Orders** → click **Amount Paid**.
- In each: no "TDS Amt" column, the sample row shows the "After" figure, no error.

### C. Edit a Paid payment (Admin)

- [ ] Project page → **Financials** → **All Payments** → pencil on a payment.
- [ ] Customer page → **Financials** → **All Payments** → pencil on a payment.

### D. Bulk Import Transactions — `/bulk-import-transactions`

- [ ] ⚠ Open an import → a **Settled** line → **Unreconcile** → completes.

### E. Reports — `/reports`

- [ ] **Outflow Report(Project)** — loads; totals unchanged (it already uses the amount only).

### F. Desk

- [ ] The 4 saved reports on Project Payments (Phase 3) — TDS column gone, report opens, re-saved.
