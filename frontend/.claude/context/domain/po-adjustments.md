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
├── POAdjustmentButton.tsx         # Button on PO overview (shows when Pending adjustment exists)
├── POAdjustmentDialog.tsx         # Main dialog for manual payment allocation
├── POAdjustmentHistory.tsx        # ⚠️ DEAD CODE — imported nowhere; live cards render in ProcurementOrders/.../PORevisionsAndAdjustments.tsx
├── data/
│   ├── poAdjustment.constants.ts  # Cache keys, API endpoints, doctype names
│   ├── usePOAdjustmentQueries.ts  # usePOAdjustment(poId), useAdjustmentCandidatePOs(vendor, po)
│   └── usePOAdjustmentMutations.ts # useExecuteAdjustment()
└── hooks/
    └── usePOAdjustment.ts         # Dialog state management, form logic, submission
```

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
- `executeAdjustment` -> `nirmaan_stack.api.po_adjustments.adjustment_logic.execute_adjustment`
- `getCandidatePOs` -> `nirmaan_stack.api.po_adjustments.adjustment_logic.get_adjustment_candidate_pos`

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

## Backend: Payment Utilities

Shared utilities in `api/po_adjustments/_payment_utils.py`:

| Function | Purpose |
|----------|---------|
| `_create_project_payment()` | Creates payment with `from_adjustment=True` flag (skips hooks) |
| `_recalculate_amount_paid()` | Manually sums Paid payments and updates PO's `amount_paid` |
| `_append_return_payment_term()` | Adds Return/Paid term row to PO in memory |
| `_split_target_po_term()` | Reduces target PO's Created terms and appends Credit term |
| `_reduce_payment_terms_lifo()` | LIFO reduction of modifiable terms for negative flow |

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
| `po:payment_adjustment` | After manual adjustment executed | `{ po_id, adjustment_id, status }` |

---

## Gotchas

1. **One adjustment doc per PO** -- autoname `POADJ-.po_id.` ensures uniqueness; multiple revisions append to same doc
2. **Double-entry must net correctly** -- entries sum to remaining_impact; positive entries resolve negative impact
3. **from_adjustment flag is critical** -- shared with revision flow; prevents payment hook commits from breaking atomicity
4. **Candidate PO min threshold is 100** -- POs with less than Rs.100 in Created terms are excluded
5. **Return term percentage is always 0** -- Return terms don't count toward the 100% percentage allocation
6. **LIFO reduction can create "Overpayment Return Required" term** -- when Created terms insufficient, auto-creates Return term with negative amount
7. **Types shared with PORevision** -- `RefundAdjustment` and `AdjustmentMethodType` types defined in `PORevision/types.ts`
