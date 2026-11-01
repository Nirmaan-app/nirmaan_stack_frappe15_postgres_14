# Browser walk — Payment Paid On on the TDS register

**Date:** 2026-10-29 · **Branch:** `develop` (uncommitted change set, migrated on localhost)
**Environment:** localhost:8080 (vite) + backend :8000 · fresh incognito Chrome (chrome-devtools MCP),
1440-wide window · signed in through the login form as an **Admin** (also holds CEO approval) and a
**Procurement** user. No deep URLs, no scripts: every screen reached by clicking.

**What is under test:** `Payment TDS Deduction.payment_date` ("Payment Paid On", register column
**Paid On**) is a copy of the payment's / Office Rent expense's `payment_date` while it is **Paid**,
empty before that, cleared when it leaves Paid (GLOSSARY "Payment Paid On (on a TDS record)";
`.claude/context/domain/payment-tds.md` § Payment Paid On).

> What this walk proves is what a person sees. The rules behind it are pinned by
> `services/test_tds_payment_paid_on.py` (15 backend tests) and the CSV/fetch wiring by
> `frontend/src/pages/PaymentTDSDeductions/config/paymentTdsDateColumns.test.ts` (8 tests).

---

## Result summary

| # | Step | Verdict |
|---|---|---|
| 1 | Reports → Payment → TDS Deduction: **Paid On** column sits right after Approved On | **PASS** |
| 2 | The Office Rent row (expense still Approved) shows Paid On **--** | **PASS** |
| 3 | An existing row matches its payment: PTD-26-00908 Paid On 27-Oct-2026 = the WO page's payment date for that ₹2,00,000 payment | **PASS** |
| 4 | Paid On header → **Desc** sorts by the new column (empty first, then 27-Oct, 26-Oct, …) | **PASS** |
| 5 | Work Orders → All WO → SR-00106-000889 → **Request Payment** ₹5,000, Base: preview says "TDS 2%: ₹100 · Vendor gets ₹4,900 · Tax is cut now"; auto-approved | **PASS** |
| 6 | Register: new row **PTD-26-00925**, Approved On 29-Oct-2026, **Paid On --**, ₹100 / ₹4,900; Pending total +₹100 | **PASS** |
| 7 | Project Payment & Expense → *Payment need to paid* → **Mark as Paid** → Reconciliation Pending | **PASS** |
| 8 | Register at Reconciliation Pending: PTD-26-00925 Paid On **still --** (Paid only, owner Q1) | **PASS** |
| 9 | *Reconciliation Pending* → **Mark Reconciled** → UTR + Payment Date 28-10-2026 → "Payment fulfilled" | **PASS** |
| 10 | Register: PTD-26-00925 **Paid On 28-Oct-2026**; its Pay TDS checkbox becomes selectable | **PASS** |
| 11 | Procurement user: Reports has **no Payment tab**, so no TDS register | **PASS** |
| 12 | After the walk, DB check: 870 / 870 payment deductions equal their payment's date, 0 non-Paid rows with a date | **PASS** |
| — | Paid On **date filter** (Is / date / Apply) | **NOT VERIFIED** — see below |
| — | CSV **Export** header "Payment Paid On" | **NOT VERIFIED IN BROWSER** — pinned by the frontend test |
| — | Desk form shows "Payment Paid On", read-only | **NOT VERIFIED IN BROWSER** — no in-app link to Desk |
| — | Date corrected on a Paid payment → copy follows | **NO SCREEN** — backend test only |
| — | Payment leaves Paid (Unreconcile) → copy clears | **NOT WALKED** — needs a matched bank line; backend test only |

No defects in the change itself.

---

## Findings and limits

- **Date-filter popover is taller than a 727-px-high viewport.** Its Apply button sits below the
  window edge and cannot be clicked; resizing the MCP window had no effect. This is the shared date
  filter that Approved On already uses (`dateFilterFn`), not new code. Re-walk on a taller screen.
- **The supplied "accountant" login is a Procurement profile.** It has no Mark as Paid / Mark
  Reconciled, so steps 7–9 were done as Admin, which is in `PAYMENT_SETTLE_PROFILES` with Accountant
  and Accountant Lead — the same code path. A real Accountant login is still worth one pass.
- **Mark Reconciled requires a receipt file first.** A 1-pixel dummy image was uploaded; autofill
  said "Auto-fill failed" (expected) and the UTR and date were typed by hand.
- **Some existing rows show Paid On earlier than Approved On** (e.g. PTD-26-00899: approved 25-Oct,
  paid 05-Sept). The copy is exact (step 12); those are the payments' own dates.

## Test data left on localhost

Cannot be deleted (a Paid payment refuses deletion); goes with the next restore from backup.

- Project Payment **PAY-00106-185** on SR-00106-000889: ₹5,000 gross, ₹4,900 paid, UTR
  `CLAUDETEST281026`, Payment Date 28-10-2026, receipt `claude-test-receipt.png`.
- Its deduction **PTD-26-00925** (₹100, 2%).

## How to re-walk

1. Sign in as an Accountant (or Admin). Reports → Payment → TDS Deduction: check steps 1–4.
2. As someone who can raise WO payments: Work Orders → an Approved WO with a TDS vendor → Request
   Payment (a small Base amount auto-approves). Check the register shows the row with Paid On --.
3. As the Accountant: Project Payment & Expense → *Payment need to paid* → Mark as Paid; check the
   register (still --). Then *Reconciliation Pending* → Mark Reconciled with a UTR and a date; check
   the register shows that date.
4. If a bank statement is available: settle a TDS payment through Bulk Import, check Paid On, then
   Unreconcile it and check Paid On returns to --.
5. Sign out.
