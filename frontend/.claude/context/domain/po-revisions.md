# PO Revision System — Complete Reference

## Overview

PO Revision is a **two-phase workflow** (draft → approve/reject) for modifying a live Purchase Order's items and reconciling payment terms after goods have started moving. It creates a separate `PO Revisions` document that stages all changes without touching the original PO until approval.

**Autoname:** `PRT/{project_short}/{po_number}/{sequence}`
**Statuses:** Pending → Approved | Rejected

---

## Eligibility

A PO is eligible for revision when **ALL** conditions are met:

| Condition | Detail |
|-----------|--------|
| **Status** | `Partially Dispatched`, `Dispatched`, `Partially Delivered`, or `Delivered` |
| **Not locked** | No existing Pending revision involves this PO (as Original or Target) |
| **Invoice mismatch** | `Math.abs(totalInvoiceAmount - po.total_amount) > 1` |

The "Revise PO" button renders as a **red warning banner** in the Invoices section of `PODetails.tsx` (~line 691-704).

---

## Lock Mechanism (Bidirectional)

When a revision is created, involved POs are locked until approval/rejection.

**Backend:** `revision_po_check.py`
- `check_po_in_pending_revisions(po_id)` → `{ is_locked, role, revision_id }`
- `_check_pending_as_original(po_id)` — Is PO the `revised_po` in any Pending revision?
- `_check_pending_as_target(po_id)` — Is PO in `target_pos` array of any Pending revision's JSON?
- `get_all_locked_po_names()` — Bulk fetch all locked PO names (used for candidate filtering)

**Frontend:** `usePOLockCheck(poId)` hook (SWR-cached POST call)

### Disabled Operations When Locked

| Component | Action Blocked |
|-----------|---------------|
| `PODetails.tsx` | Dispatch Items (`disabled`), Mark Inactive (`disabled`), Revise PO (hidden) |
| `POPaymentTermsCard.tsx` | Edit Payment Terms (`disabled` + tooltip) |
| `RequestPaymentDialog` (both locations) | Request Payment button (`disabled` + red warning text) |
| `PurchaseOrder.tsx` | Merge PO (hidden), Update Delivery (`disabled`) |
| `DeliveryPivotTable` | All DN operations — create, edit, return (submit `disabled` + alert) |

**Key:** Unlike CEO Hold which *exempts* DN operations, PO Revision *blocks* them. However, the DN lock is **frontend-only** — no backend validation prevents DN creation during revision.

---

## Frontend Architecture

### File Structure
```
src/pages/PORevision/
├── PORevisionDialog.tsx          # 3-step wizard for creating revisions
├── PORevisionWarning.tsx         # Red lock banner on PO detail page
├── PORevisionsApprovalList.tsx   # List page with Pending/Approved/Rejected tabs
├── PORevisionsApprovalDetail.tsx # Detail page for review + approve/reject
├── types.ts                     # RevisionItem, PaymentTerm, RefundAdjustment, etc.
├── config/
│   └── poRevisions.config.tsx   # DataTable columns + search config
├── data/
│   ├── poRevision.constants.ts  # Cache keys, API endpoints, doctype names
│   ├── usePORevisionQueries.ts  # 14 read hooks with Sentry logging
│   └── usePORevisionMutations.ts # 3 mutation hooks with cache invalidation
├── hooks/
│   ├── usePORevision.ts         # Main dialog state + calculations + submission
│   └── usePORevisionsApprovalDetail.ts # Approval page state + mutations
└── components/
    ├── RevisionHeader.tsx        # Dialog header with stepper
    ├── RevisionFooter.tsx        # Dialog footer with navigation
    ├── Step1ReviseItems.tsx      # Item editing + justification
    ├── Step2PositiveFlow.tsx     # Payment term allocation (amount increased)
    ├── Step2NegativeFlow.tsx     # Refund adjustment (amount decreased)
    ├── Step3Summary.tsx          # Final review before submit
    ├── ImpactSummaryTable.tsx    # Before/After/Difference financial table
    ├── InvoicesSection.tsx       # Invoice summary + detail table
    ├── AddNewItemDialog.tsx      # Add catalog/custom item to revision
    ├── AddChargeDialog.tsx       # Add "Additional Charges" item
    ├── PORevisionHistory.tsx     # Timeline of past revisions on PO detail
    ├── PORevisionInfoCard.tsx    # Vendor/Project/Status info (approval page)
    ├── PORevisionInvoices.tsx    # Invoice table (approval page)
    ├── PORevisionImpactAndJustification.tsx # Before/After + justification
    ├── PORevisionLineItems.tsx   # Item diff table (approval page)
    └── PORevisionPaymentRectification.tsx  # Adjustment details display
```

### Cache Key Factory — `poRevisionKeys`
All SWR keys generated from single factory in `poRevision.constants.ts`:
- `revisionDoc(id)`, `revisionHistory(poId)`, `procurementRequest(prId)`, `categories(wp)`, `items(wp)`, `categoryMakelist(wp)`, `vendorInvoices(poId)`, `candidatePOs(vendor)`, `originalPO(poId)`, `lockCheck(poId)`, `allLocked()`

### API Endpoints — `PO_REVISION_APIS`
- `makeRevision` → `nirmaan_stack.api.po_revisions.revision_logic.make_po_revisions`
- `approveRevision` → `nirmaan_stack.api.po_revisions.revision_logic.on_approval_revision`
- `checkLock` → `nirmaan_stack.api.po_revisions.revision_po_check.check_po_in_pending_revisions`
- `getHistory` → `nirmaan_stack.api.po_revisions.revision_history.get_po_revision_history`
- `getCandidatePOs` → `nirmaan_stack.api.po_revisions.revision_logic.get_adjustment_candidate_pos`
- `getAllLocked` → `nirmaan_stack.api.po_revisions.revision_po_check.get_all_locked_po_names`

---

## Step 1: Revise Items

### Item Type Tracking

| Type | Meaning | Transition |
|------|---------|-----------|
| Original | Unchanged from PO | Default state |
| Revised | Same item, qty/rate/tax changed | Original → edit value fields |
| Replace | Different item_id swapped in | Original → change item_id |
| New | Entirely new item added | Via "Add Item" / "Add Charge" |
| Deleted | Soft-deleted for backend | Original/Revised → click delete |

### Received Quantity Constraints

For items with `received_quantity > 0`:

| Field | Behavior |
|-------|----------|
| Item Name | DISABLED (cannot change identity) |
| Unit | DISABLED |
| Make | DISABLED |
| Quantity | min = `received_quantity` (red border if violated) |
| Delete button | DISABLED |

Hover card shows: warning + received qty + min allowed qty.

### Custom PO Differences
- Item name: free-text `Input` (not `ReactSelect`)
- Make column: hidden from table
- New items: require manual Category + Procurement Package selection (no catalog lookup)

### Validation (Step 1 → 2)
- Justification text required (non-empty)
- All non-Deleted items: rate > 0
- All non-Deleted items: qty > 0 AND qty >= received_quantity
- Difference ≠ 0 (button disabled if no financial change)

---

## Step 2: Financial Adjustment

### Positive Flow (revised > original)
- User creates Payment Terms: description (max 140 chars) + amount
- Validation: total allocated = `|difference.inclGst|` (±₹1 tolerance)
- Multiple terms allowed

### Negative Flow (revised < original)

**Auto-absorb:** System reduces unpaid "Created" payment terms first (`createdTermsAbsorbable`).

**User allocation** for remaining (`userAllocationRequired`):

| Method | Description | Details |
|--------|-------------|---------|
| **Against another PO** | Transfer credit to another PO | Same vendor, eligible status, not locked, absorbable > ₹100 |
| **Ad-hoc expense** | Write off as expense | Expense type + description + comment |
| **Vendor has refunded** | Direct refund with proof | File upload + date picker |

**Constraints:**
- Only ONE "Against PO" adjustment allowed
- Adhoc + Refunded can be combined via "Add Another Adjustment Method"
- Validation: user allocation total = `userAllocationRequired` (±₹1)

### Candidate PO Filtering (Against-po)
Backend `get_adjustment_candidate_pos(vendor, current_po)`:
1. Same vendor, not current PO
2. Status in: PO Approved, Partially Dispatched, Dispatched, Partially Delivered, Delivered
3. Not locked by any pending revision
4. `created_terms_amount > ₹100` (sufficient unpaid balance)

---

## Step 3: Summary & Submit

Shows item changes + justification + financial summary + adjustment details.

Submission calls `make_po_revisions` → creates Pending document → returns revision ID.

---

## Backend: Creating a Revision

**API:** `make_po_revisions(po_id, justification, revision_items, total_amount_difference, payment_return_details)`

1. Fetches original PO (read-only — extracts project, vendor)
2. Creates new `PO Revisions` doc with status="Pending"
3. Populates `revision_items` child table per item type
4. Stores `payment_return_details` JSON as-is
5. `.insert(ignore_permissions=True)` — allows low-permission users to create drafts
6. Returns revision name

---

## Backend: Approving a Revision

**API:** `on_approval_revision(revision_name)`

Runs as a **single atomic transaction** with full rollback on failure.

### Phase 1: Sync Items (`sync_original_po_items`)

| Item Type | Action |
|-----------|--------|
| Original | No change, mark "Approved" |
| New | Append row; auto-dispatch if PO is post-dispatch (`is_dispatched=1`) |
| Revised | Update qty, unit, rate, tax, amount, make, category, package |
| Replace | Change item_id/name, update all fields, preserve received_qty |
| Deleted | Remove row (throws error if `received_quantity > 0`) |

Post-sync:
- `calculate_totals_from_items()` — recalculates PO amount/tax/total
- Delivery status recalculation (see DN Interaction below)
- Save with `ignore_validate_update_after_submit=True`

### Phase 2: Financial Processing

**Positive Flow** (`process_positive_increase`):
1. Parse payment terms from JSON
2. Update existing terms or merge into first "Created" term or append new
3. For Credit payment type: new terms get `due_date = today + 2 days`
4. Recalculate ALL term percentages to sum to 100%

**Negative Flow** (`process_negative_returns`):
1. **Against-po:** Create negative payment on original PO (`VR-` UTR prefix) + positive payment on target PO. `_split_target_po_term()` reduces target's Created terms and appends consolidated "Credit PO" term.
2. **Vendor-has-refund:** Create negative payment on original PO + append "RA Vendor" Return term.
3. **Ad-hoc:** Create negative payment + create `Project Expenses` record + append "RA Adhoc" Return term.
4. **LIFO Reduction** (`_reduce_payment_terms_lifo`): Reduce original PO's Created terms bottom-up. If deficit → auto-create "Overpayment Return Required" term.
5. Recalculate percentages (Return terms = 0%).
6. `_recalculate_amount_paid()` for all affected POs.

### Phase 3: Finalize
- Status → "Approved", save revision doc

### Error Handling
```python
except Exception as e:
    frappe.db.rollback()  # Undoes EVERYTHING
    frappe.log_error(traceback, "Approval Error")
    frappe.throw(user_friendly_message)
```

---

## Transaction Safety: `from_revision` Flag

**Problem:** Normal payment hooks call `frappe.db.commit()` mid-transaction, preventing rollback.

**Solution:** `_create_project_payment()` sets `pay.flags.from_revision = True`.

**Hooks that check and return early:**

| File | Hook |
|------|------|
| `doctype/project_payments/project_payments.py` | `before_insert()` — skips amount validation |
| `doctype/project_payments/project_payments.py` | `on_update()` — skips status sync + commit |
| `integrations/controllers/project_payments.py` | `after_insert()` — skips notifications + commit |
| `integrations/controllers/project_payments.py` | `on_update()` — skips notifications + commit |

**Manual recalc:** `_recalculate_amount_paid(po_id)` sums all Paid payments and updates `amount_paid` field via `frappe.db.set_value()`.

---

## Delivery Notes Interaction

### received_quantity is the Hard Boundary
- Items with `received_quantity > 0` cannot be deleted (backend throws error)
- Item name/unit/make cannot be changed (frontend disables)
- Quantity cannot go below received_quantity (frontend min + backend accepts gracefully)

### DN Operations Blocked During Revision
- `DeliveryPivotTable` receives `isLocked` prop → submit disabled + alert shown
- **Frontend-only enforcement** — no backend validation on DN APIs checks revision lock
- Contrast with CEO Hold: CEO Hold *exempts* DNs; Revision *blocks* them

### Post-Approval Delivery Status Recalculation

After `sync_original_po_items`, the system recalculates delivery status:

1. **Check dispatch completeness**: If any items not dispatched → `Partially Dispatched` (sticky)
2. **For fully-dispatched POs**: Run `calculate_order_status()`:
   - Integer quantities: exact match (`quantity <= received_quantity`)
   - Float quantities: 2.5% tolerance
   - Additional Charges: skipped from calculation
3. **Recalculate `po_amount_delivered`** via `calculate_delivered_amount()`
4. **New items auto-dispatched**: Items added to post-dispatch PO get `is_dispatched=1`

**Key scenario — quantity reduced below received:**
If revision reduces qty from 10→5 but 7 were received, backend silently accepts → item marked "delivered" (7≥5) → PO may auto-transition to "Delivered".

### Return Notes Can Independently Affect Status
Return DNs store negative `delivered_quantity` → `recalculate_po_delivery_fields()` sums all DNs → status may revert (Delivered → Partially Delivered).

---

## Role Access

| Feature | Roles |
|---------|-------|
| Create revision | Any role that can view a PO |
| View revision history | Admin, PMO, Accountant, Procurement Exec |
| View revision link in warning | Admin, PMO, Accountant |
| Approve/Reject | Via approval list page (accessible to permitted roles) |

---

## Revision History API

**API:** `get_po_revision_history(po_id)`

Returns array of revision objects (newest-first) with:
- Pre-parsed `payment_return_details` JSON (no frontend JSON.parse needed)
- Pre-computed `original_total_incl_tax` and `revised_total_incl_tax`
- Full `revision_items` child rows

**Frontend:** `PORevisionHistory` component — collapsible timeline with status-colored dots, expandable cards showing items changed + payment details.

---

## Payload Structures

### revision_items (sent to backend)
```json
[{
  "item_type": "Original|New|Revised|Replace|Deleted",
  "original_row_id": "row_id",
  "original_item_id": "...", "original_qty": 10, "original_rate": 100,
  "original_amount": 1000, "original_tax": 18,
  "item_id": "...", "item_name": "...", "make": "...",
  "quantity": 15, "quote": 120, "amount": 1800, "tax": 18,
  "category": "...", "procurement_package": "..."
}]
```

### payment_return_details — Positive Flow
```json
{
  "list": {
    "type": "Payment Terms",
    "Details": [{
      "return_type": "Payment-terms",
      "status": "Pending",
      "amount": 5000,
      "terms": [{ "label": "Milestone 1", "amount": 2500 }]
    }]
  }
}
```

### payment_return_details — Negative Flow
```json
{
  "list": {
    "type": "Refund Adjustment",
    "auto_adjusted_amount": 2000,
    "Details": [{
      "status": "Pending",
      "amount": 2000,
      "return_type": "Against-po|Ad-hoc|Vendor-has-refund",
      "target_pos": [{ "po_number": "PO-002", "amount": 2000 }],
      "ad-hoc_type": "expense", "ad-hoc_description": "reason",
      "refund_date": "2026-02-27", "refund_attachment": "/files/receipt.pdf"
    }]
  }
}
```

---

## Key Backend Files

| File | Purpose |
|------|---------|
| `api/po_revisions/revision_logic.py` | Create, approve, reject revisions; item sync; financial flows |
| `api/po_revisions/revision_po_check.py` | Lock checks (original + target), bulk lock list |
| `api/po_revisions/revision_history.py` | History API with pre-parsed JSON + computed totals |
| `doctype/po_revisions/po_revisions.json` | PO Revisions doctype schema |
| `doctype/po_revisions_items/po_revisions_items.json` | Child table schema |
| `doctype/project_payments/project_payments.py` | `from_revision` flag checks |
| `integrations/controllers/project_payments.py` | `from_revision` flag checks |
| `integrations/controllers/procurement_orders.py` | AQ creation on dispatch |
| `api/delivery_notes/update_delivery_note.py` | `calculate_order_status()`, `calculate_delivered_amount()` |

---

## Gotchas

1. **DN lock is frontend-only** — no backend validation prevents DN creation during pending revision
2. **Quantity below received accepted** — backend doesn't re-validate the constraint; item gets marked over-delivered
3. **Partially Dispatched is sticky** — stays even with DNs recorded, until ALL items dispatched
4. **Additional Charges** skipped from delivery status calc, use full qty for amount calc
5. **`_check_pending_as_target` is O(N)** — iterates all pending revisions, parses JSON each time
6. **from_revision flag is critical** — without it, payment hook commits break rollback atomicity
7. **TimestampMismatchError** — `_recalculate_amount_paid` for original PO must run AFTER `.save()` because `set_value` updates `modified`
