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
- If `|remaining_impact| < 1` -> "Done"
- Otherwise -> "Pending"

---

## Entry Types (Double-Entry Accounting)

Each financial event creates entries that sum to track the running balance:

| Entry Type | Sign | When Created | Description |
|-----------|------|-------------|-------------|
| **Revision Impact** | +/-  | Revision approval | Records the raw PO amount change |
| **Term Addition** | negative | Positive revision | Offsets positive impact (auto-created term covers it) |
| **Auto Absorb** | positive | Negative revision | Absorption from Created payment terms |
| **Against PO** | positive | Manual adjustment | Credit transferred to another PO |
| **Adhoc** | positive | Manual adjustment | Written off as project expense |
| **Vendor Refund** | positive | Manual adjustment | Vendor returned money |

**Positive diff example:** "Revision Impact" +5000 + "Term Addition" -5000 = net 0 -> Done
**Negative diff example:** "Revision Impact" -8000 + "Auto Absorb" +3000 = remaining -5000 -> Pending (user must allocate 5000)

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

A PO with a Pending PO Adjustment has **payment operations locked** (but items are NOT locked):

- `revision_po_check.py` checks for Pending adjustments -> `is_payment_locked = True`
- `get_all_locked_po_names()` includes POs with Pending adjustments
- This prevents: payment term edits, payment requests, creating new revisions (since those would also create adjustments)
- This does NOT prevent: DN operations, dispatch operations

---

## Frontend Architecture

### File Structure
```
src/pages/POAdjustment/
├── POAdjustmentButton.tsx         # Button on PO overview (shows when Pending adjustment exists)
├── POAdjustmentDialog.tsx         # Main dialog for manual payment allocation
├── POAdjustmentHistory.tsx        # Accordion showing adjustment entries on PO detail
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

### POAdjustmentDialog
- Header shows "Extra Amount Paid" with the absolute impact amount
- **Positive adjustment:** Info alert -- "auto-created payment term, no action needed"
- **Negative adjustment:** Three method pills + allocation form

### POAdjustmentHistory
- Accordion component on PO detail showing all adjustment entries
- Color-coded badges per entry type
- Shows running status (Pending/Done) and remaining amount

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
