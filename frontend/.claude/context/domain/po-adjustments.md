# PO Adjustments System — Complete Reference

## Overview

PO Adjustments is a **standalone payment reconciliation system** that tracks and resolves financial differences caused by PO Revisions. It decouples payment handling from the revision workflow, allowing revisions to be created/approved without upfront payment allocation.

**Key design principle:** Revision approval auto-records the financial impact. If the impact is not fully auto-resolved (e.g., negative diff exceeds absorbable Created terms), the PO Adjustment remains "Pending" and the user resolves it manually via a dedicated dialog on the PO detail page.

---

## Doctypes

### PO Adjustments (Parent)
- **Autoname:** `POADJ-.po_id.` (one per PO)
- **Fields:** `po_id` (Link, unique), `project`, `vendor`, `status` (Pending/Done), `remaining_impact` (Currency), `adjustment_items` (Table)
- **Permissions:** System Manager, Admin, Accountant, PMO, Project Lead, Administrator

### PO Adjustment Items (Child Table)
- **Fields:** `entry_type` (Data), `revision_id` (Link -> PO Revisions), `amount` (Currency), `description` (Small Text), `timestamp` (Datetime), `project_payment` (Link -> Project Payments), `target_po` (Link -> Procurement Orders), `expense_type` (Data), `refund_date` (Date), `refund_attachment` (Attach)

### Status Calculation
`recalculate_remaining_impact()` sums all child item amounts:
- If `|remaining_impact| < 100` -> "Done"  (a **display tolerance**, NOT "credit gone")
- Otherwise -> "Pending"

> **`Done` is a display label only.** Any *negative* `remaining_impact` (overpaid credit) is still usable. Downstream logic reads the **number** (`remaining_impact`), never the status — so a `Done` adjustment can still hold up to ₹99 of reusable credit that gets consumed on the next revision increase. Do **not** treat `status == "Done"` as "fully settled / no credit". (Regression that drove this: `PO/068/00103/26-27`.)

---

## Entry Types (Double-Entry Accounting)

Each financial event creates entries that sum to track the running balance:

| Entry Type | Sign | When Created | Description |
|-----------|------|-------------|-------------|
| **Revision Impact** | +/-  | Revision approval | Records the raw PO amount change |
| **Auto Adjustment** | 0 (audit) | Positive revision | Audit marker: overpaid credit auto-applied to cover the increase. Stored as `entry_type = "Auto Adjustment"` (was "Credit Applied"). Its message states the total raised + the split (covered from credit / new term) |
| **Term Addition** | negative | Positive revision | Offsets the **uncovered** part of a positive impact (new term covers only what credit didn't) |
| **Auto Absorb** | positive | Negative revision | Absorption from Created payment terms |
| **Against PO** | positive | Manual adjustment | Credit transferred to another PO |
| **Adhoc** | positive | Manual adjustment | Written off as project expense |
| **Vendor Refund** | positive | Manual adjustment | Vendor returned money |

**Positive diff is CREDIT-AWARE** (`_auto_add_payment_term` + `_get_available_po_credit`): an increase first consumes any existing overpaid credit (`max(0, -remaining_impact)`, read by number/status-agnostic), and only the *uncovered* balance becomes a new `Created` term.

- **No prior credit:** "Revision Impact" +5000 + "Term Addition" -5000 = net 0 -> Done  *(unchanged legacy behaviour)*
- **Credit ≥ increase:** existing credit -200, increase +50 -> "Revision Impact" +50 + "Auto Adjustment" (0) = remaining -150, **NO new term created**. Card message: *"Revision raised this PO by ₹50.00 — fully covered by overpaid credit (₹150.00 still available). No new payment."*
- **Credit < increase:** existing credit -50, increase +150 -> "Revision Impact" +150 + "Auto Adjustment" (0) + "Term Addition" -100 = remaining 0, new term only for the **uncovered ₹100**. Card message: *"Revision raised this PO by ₹150.00 — ₹50.00 adjusted from overpaid credit, ₹100.00 added as a new payment term."*
- **Negative diff example:** "Revision Impact" -8000 + "Auto Absorb" +3000 = remaining -5000 -> Pending (user must allocate 5000)

---

## Lifecycle

```
PO Revision Approved
        |
        v
  diff != 0?
   /        \
  NO         YES
  |           |
  (no adj)   Create/Update PO Adjustment doc
              |
              Auto-entries recorded
              |
        remaining_impact == 0?
         /              \
        YES              NO
        |                |
     "Done"          "Pending"
                        |
                   User opens PO Adjustment Dialog
                        |
                   Manual allocation (Against-PO / Adhoc / Refund)
                        |
                   remaining_impact recalculated
                        |
                   == 0? -> "Done"
```

---

## Lock Mechanism

The lock keys on the adjustment's **balance + status**, not status alone (`revision_po_check.py`):

- **Pending adjustment (≥ ₹100 unresolved)** -> **HARD lock**: `is_payment_locked = True`. Blocks payment term edits, payment requests, and new revisions (items are NOT locked — DN/dispatch still allowed).
- **`Done` adjustment still holding small credit (`remaining_impact <= -1`)** -> **SOFT advisory only**: returns `has_credit_notice = True` + `remaining_credit` (NOT `is_payment_locked`). The PO detail page shows an **amber "Overpaid credit available — ₹X"** note (via `PORevisionWarning`) and payment terms **stay usable**. The credit still auto-applies to the next revision increase.
- `get_all_locked_po_names()` includes both Pending adjustments **and** `Done`-with-credit POs — but the Done-with-credit inclusion is used **only for merge/transfer candidate exclusion** (not for payment-term locking).

> **Threshold note:** the `Done` display band is `|remaining_impact| < 100`, while the lock/credit band is `remaining_impact <= -1`. So a balance of −1…−99 reads `Done` yet is still a soft credit notice; only ≥ ₹100 is a hard lock.

---

## Frontend Architecture

### File Structure
```
src/pages/POAdjustment/
├── POAdjustmentButton.tsx         # PUSH: "Adjust Payments" button on PO overview (Pending adjustment exists)
├── POAdjustmentDialog.tsx         # PUSH: main dialog for manual payment allocation (source PO)
├── VendorCreditSummaryCard.tsx    # PULL: top-of-PO banner — vendor credit pool + "Apply to this PO" (2026-06)
├── ApplyVendorCreditDialog.tsx    # PULL: source-picker dialog (current PO = destination) (2026-06)
├── POAdjustmentHistory.tsx        # ⚠️ DEAD CODE — imported nowhere; live cards render in ProcurementOrders/.../PORevisionsAndAdjustments.tsx
├── data/
│   ├── poAdjustment.constants.ts  # Cache keys (+ vendorCredit), API endpoints, doctype names
│   ├── usePOAdjustmentQueries.ts  # usePOAdjustment(poId), useAdjustmentCandidatePOs(vendor, po), useVendorAdjustmentCredit(vendor, excludePo)
│   └── usePOAdjustmentMutations.ts # useExecuteAdjustment() [push], useApplyVendorCredit() [pull]
└── hooks/
    └── usePOAdjustment.ts         # Push-dialog state management, form logic, submission
```
> **PULL flow (2026-06):** `VendorCreditSummaryCard` is mounted at the TOP of `ProcurementOrders/purchase-order/PurchaseOrder.tsx` (after `PORevisionWarning`). See "Vendor Credit — Pull Flow" below.

### POAdjustmentButton
- Renders on PO overview when a Pending adjustment with `remaining_impact != 0` exists
- Shows "Adjust Payments" with the remaining amount as a badge
- Red styling for negative impact (extra paid), orange for positive

> ⚠️ **Known limitation (gates on `status === "Pending"`):** because a sub-₹100 leftover credit is now `Done`, the "Adjust Payments" button (and the "₹X remaining" badge in `PORevisionsAndAdjustments.tsx`) is **hidden** for it — so such credit is not *manually* resolvable, only auto-applied on the next increase. To restore manual resolution, gate on `remaining_impact !== 0` instead of `status === "Pending"`.

### POAdjustmentDialog
- Header shows "Extra Amount Paid" with the absolute impact amount
- **Positive adjustment:** Info alert -- "auto-created payment term, no action needed"
- **Negative adjustment:** Three method pills + allocation form

### POAdjustmentHistory — ⚠️ UNUSED (dead code)
- Imported nowhere (confirmed via grep). The **live** adjustment UI is `pages/ProcurementOrders/purchase-order/components/PORevisionsAndAdjustments.tsx` (rendered from `PurchaseOrder.tsx`), which has its own `ENTRY_TYPE_COLORS`, `SYSTEM_ENTRY_TYPES`, and adjustment-card rendering (badge, "Triggered by", `amount !== 0` guard).
- Safe to delete. **Any badge / label / colour / message edits must go to `PORevisionsAndAdjustments.tsx`, not here.**
- (Historically this file mirrored the cards; it color-coded badges per entry type and showed status + remaining amount.)

### Cache Keys -- `poAdjustmentKeys`
- `adjustmentDoc(poId)` -- SWR key for the adjustment document
- `candidatePOs(vendor)` -- SWR key for candidate PO list

### API Endpoints -- `PO_ADJUSTMENT_APIS`
- `getAdjustment` -> `nirmaan_stack.api.po_adjustments.adjustment_logic.get_po_adjustment`
- `executeAdjustment` -> `nirmaan_stack.api.po_adjustments.adjustment_logic.execute_adjustment`  *(push)*
- `getCandidatePOs` -> `nirmaan_stack.api.po_adjustments.adjustment_logic.get_adjustment_candidate_pos`
- `getVendorCredit` -> `nirmaan_stack.api.po_adjustments.adjustment_logic.get_vendor_adjustment_credit`  *(pull — pool read)*
- `applyVendorCredit` -> `nirmaan_stack.api.po_adjustments.adjustment_logic.apply_vendor_credit_to_po`  *(pull — executor)*

---

## Manual Adjustment Methods

### Against Another PO
- User selects target POs from same vendor with sufficient "Created" terms
- For each target: creates outgoing payment on original PO (-amount) + incoming payment on target PO (+amount)
- Target PO's Created terms reduced via `_split_target_po_term()`, new "Credit PO" term appended
- Original PO gets "RA PO {target}" Return payment term
- Multiple target POs can be selected

### Ad-hoc Expense
- User selects expense type (from `Expense Type` doctype) + description + optional comment
- Creates negative payment on original PO + "RA Adhoc" Return term
- Creates `Project Expenses` record if expense type specified
- Description max 140 chars

### Vendor Refund
- User uploads refund proof (PDF/image) + refund date + optional UTR reference
- Creates negative payment on original PO + "RA Vendor" Return term
- UTR auto-set to `VR-{po_id}` when attachment provided

### Mixed Methods
- Primary method selected via pills (Against PO / Adhoc / Vendor Refund)
- When "Against PO" is primary and remaining exists, can add Adhoc or Refund as secondary
- Progress bar tracks allocation percentage

---

## Vendor Credit — Pull Flow ("Apply to this PO") (2026-06)

The **inverse** of the push flow. Everything above ("Adjust Payments") starts from the
**overpaid** PO and pushes its credit *out*. The pull flow starts from a PO that **owes
money** and pulls a vendor's overpaid credit *in*. Same double-entry mechanics, opposite
entry point. **Vendor-scoped and cross-project** — credit from a PO in one project can
settle a PO in another, as long as the vendor matches. The push flow is **unchanged**;
this is additive. No new doctype.

**Credit pool (read):** `get_vendor_adjustment_credit(vendor, exclude_po=None)` sums
`max(0, -remaining_impact)` over the vendor's `PO Adjustments` with `remaining_impact < -1`
(the usable-credit floor, NOT the ₹100 "Done" tolerance). Excludes the current PO and any
source in a **pending PO Revision**. Do NOT filter via `get_all_locked_po_names()` — it
marks Done-with-credit POs as locked, and those are exactly the sources. Returns
`{total_available, source_count, sources:[{po_id, project, project_name, available, status}]}`.

**Executor:** `apply_vendor_credit_to_po(dest_po, allocations_json)` where allocations =
`[{source_po, amount}]`. Validation order (all before any write): V1 dest not
payment-locked (`check_po_in_pending_revisions`); V2 coalesce duplicate sources / reject
non-positive; V3 per-source vendor match; **V4 lock + assert each source's credit**;
**V5 lock + assert the dest's capacity**. Then loops `_transfer_credit(src, dest, amt)`,
recalcs `amount_paid` on dest + sources, recalcs each source adjustment's `remaining_impact`,
recalcs vendor credit, single `frappe.db.commit()`, emits `po:payment_adjustment`
`{po_id: dest, status: "applied", sources: [...]}`. Try/except → rollback on any error.

**Per-transfer helper:** `_transfer_credit(source_po, dest_po, amount, vendor)` (in
`_payment_utils.py`) — one complete paired transfer, **tagging each leg with its own PO's
project** (cross-project correct, unlike the push flow's `execute_adjustment` which still
uses `adj_doc.project` for both legs — a pre-existing mis-tag left as an optional follow-up).
It is a STANDALONE copy of the Against-PO mechanics, deliberately NOT shared with
`execute_adjustment` (sharing would re-introduce a double-save hazard from that function's
body-level source rebalance).

**Frontend:** `VendorCreditSummaryCard` (top-of-PO banner, hidden when `total_available<=0`,
badge shows total + PO count, Apply gated to Admin/PMO/Procurement Executive AND dest having
Created-term capacity) → `ApplyVendorCreditDialog` (source picker, per-source amount capped at
`min(source.available, remaining-to-fill)`).

---

## Concurrency Guards — row locks on BOTH flows (2026-06)

The same credit is reachable from both flows (push from the source PO, pull from a
destination PO), and the same PO can be filled from both — so without serialization two
overlapping/stale actions could **double-spend a credit** or **over-pay a PO**. Two shared
guards in `_payment_utils.py`, called by **both** `execute_adjustment` (push) and
`apply_vendor_credit_to_po` (pull):

- `_lock_and_assert_source_credit(source_po, amount_needed)` — `SELECT ... FOR UPDATE` on the
  source's `PO Adjustments` row (read `remaining_impact` with `for_update=True`) + assert
  `available >= amount`. Locks the **coupon** (credit).
- `_lock_and_assert_dest_capacity(dest_po, amount_incoming)` — `FOR UPDATE` on the destination
  `Procurement Orders` row + assert its `Created`-term sum can absorb the amount. Locks the
  **bill** (payable). (The PO row is the mutex; the dest may have no adjustment doc.)

**Why both:** a lock only serializes callers that all take it — so the push had to adopt the
same locks as the pull. This also closed a pre-existing gap: `execute_adjustment` previously
did **no** backend credit/capacity re-check (frontend cap only).

**Order:** source-before-dest in both flows (minimizes deadlocks; Postgres cleanly aborts the
rare deadlock). **Held until commit.** Lock + re-read + assert is the complete pattern: the
re-read closes the stale/sequential case, the lock closes the truly-simultaneous case.

**Reject = no-op:** all guards run BEFORE any write, and the whole op is one transaction
(single commit at the end, rollback on error). So a rejection leaves both POs **completely
unchanged** — no payment, no term, no `amount_paid`/`remaining_impact` change. In a race, the
winner commits once; the loser waits, re-reads (credit/room now reduced), and is rejected with
a "refresh and retry" message.

---

## Backend: Payment Utilities

Shared utilities in `api/po_adjustments/_payment_utils.py`:

| Function | Purpose |
|----------|---------|
| `_create_project_payment()` | Creates payment with `from_adjustment=True` flag (skips hooks) |
| `_recalculate_amount_paid()` | Manually sums Paid payments and updates PO's `amount_paid` |
| `_append_return_payment_term()` | Adds Return/Paid term row to PO in memory |
| `_split_target_po_term()` | Reduces target PO's Created terms and appends Credit term |
| `_reduce_payment_terms_lifo()` | LIFO reduction of modifiable terms for negative flow |
| `_transfer_credit()` | (2026-06) One paired source→dest credit transfer for the PULL flow; per-leg project tagging |
| `_lock_and_assert_source_credit()` | (2026-06) `FOR UPDATE` lock + assert on the source's credit (both flows) |
| `_lock_and_assert_dest_capacity()` | (2026-06) `FOR UPDATE` lock + assert on the dest PO's Created-term capacity (both flows) |

### Candidate PO Filtering
`get_adjustment_candidate_pos(vendor, current_po)`:
1. Same vendor, not current PO
2. Status in: PO Approved, Partially Dispatched, Dispatched, Partially Delivered, Delivered
3. Not locked by any pending revision or adjustment
4. `created_terms_amount > 100` (sufficient unpaid balance)

---

## Key Backend Files

| File | Purpose |
|------|---------|
| `api/po_adjustments/adjustment_logic.py` | get_po_adjustment, execute_adjustment, get_adjustment_candidate_pos |
| `api/po_adjustments/_payment_utils.py` | Shared payment helpers (also used by revision approval) |
| `doctype/po_adjustments/po_adjustments.py` | `recalculate_remaining_impact()` method |
| `doctype/po_adjustments/po_adjustments.json` | Doctype schema |
| `doctype/po_adjustment_items/po_adjustment_items.json` | Child table schema |

---

## Socket.IO Events

| Event | When | Payload |
|-------|------|---------|
| `po:payment_adjustment` | After PUSH executed (`execute_adjustment`) | `{ po_id, adjustment_id, status }` |
| `po:payment_adjustment` | After PULL executed (`apply_vendor_credit_to_po`) | `{ po_id: dest, status: "applied", sources: [...] }` |

---

## Gotchas

1. **One adjustment doc per PO** -- autoname `POADJ-.po_id.` ensures uniqueness; multiple revisions append to same doc
2. **Double-entry must net correctly** -- entries sum to remaining_impact; positive entries resolve negative impact
3. **from_adjustment flag is critical** -- shared with revision flow; prevents payment hook commits from breaking atomicity
4. **Candidate PO min threshold is 100** -- POs with less than Rs.100 in Created terms are excluded
5. **Return term percentage is always 0** -- Return terms don't count toward the 100% percentage allocation
6. **LIFO reduction can create "Overpayment Return Required" term** -- when Created terms insufficient, auto-creates Return term with negative amount
7. **Types shared with PORevision** -- `RefundAdjustment` and `AdjustmentMethodType` types defined in `PORevision/types.ts`
