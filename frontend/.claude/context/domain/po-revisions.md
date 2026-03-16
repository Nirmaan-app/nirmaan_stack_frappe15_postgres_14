# PO Revision System — Complete Reference

## Overview

PO Revision is a **two-phase workflow** (draft -> approve/reject) for modifying a live Purchase Order's items after goods have started moving. It creates a separate `PO Revisions` document that stages all changes without touching the original PO until approval.

**Financial adjustment (payment reconciliation) is handled separately by the PO Adjustments system.** See `po-adjustments.md` for the full reference.

**Autoname:** `PRT/{project_short}/{po_number}/{sequence}`
**Statuses:** Pending -> Approved | Rejected

---

## Eligibility

A PO is eligible for revision when **ALL** conditions are met:

| Condition | Detail |
|-----------|--------|
| **Status** | `Partially Dispatched`, `Dispatched`, `Partially Delivered`, or `Delivered` |
| **Not locked** | No existing Pending revision or Pending PO Adjustment involves this PO |
| **Invoice mismatch** | `Math.abs(totalInvoiceAmount - po.total_amount) > 1` |

The "Revise PO" button renders as a **red warning banner** in the Invoices section of `PODetails.tsx`.

---

## Lock Mechanism

When a revision is Pending, the PO is locked for both items and payments. When a PO Adjustment is Pending, only payments are locked.

**Backend:** `revision_po_check.py`
- `check_po_in_pending_revisions(po_id)` -> `{ is_locked, is_item_locked, is_payment_locked, item_lock_revision_id, payment_lock_source, payment_lock_id }`
- Check 1: Pending revision on this PO -> locks both items and payments
- Check 2: Pending PO Adjustment on this PO -> locks payments only
- `get_all_locked_po_names()` -> Bulk fetch all locked PO names (revision + adjustment)

**Frontend:** `usePOLockCheck(poId)` hook (SWR-cached POST call)

### Disabled Operations When Locked

| Component | Action Blocked |
|-----------|---------------|
| `PODetails.tsx` | Dispatch Items (`disabled`), Mark Inactive (`disabled`), Revise PO (hidden) |
| `POPaymentTermsCard.tsx` | Edit Payment Terms (`disabled` + tooltip) |
| `RequestPaymentDialog` (both locations) | Request Payment button (`disabled` + red warning text) |
| `PurchaseOrder.tsx` | Merge PO (hidden), Update Delivery (`disabled`) |
| `DeliveryPivotTable` | All DN operations -- create, edit, return (submit `disabled` + alert) |

**Key:** Unlike CEO Hold which *exempts* DN operations, PO Revision *blocks* them. However, the DN lock is **frontend-only** -- no backend validation prevents DN creation during revision.

---

## Frontend Architecture

### File Structure
```
src/pages/PORevision/
├── PORevisionDialog.tsx          # 2-step wizard for creating revisions (items + summary)
├── PORevisionWarning.tsx         # Red lock banner on PO detail page
├── PORevisionsApprovalList.tsx   # List page with Pending/Approved/Rejected tabs
├── PORevisionsApprovalDetail.tsx # Detail page for review + approve/reject
├── types.ts                     # RevisionItem, RefundAdjustment, etc.
├── config/
│   └── poRevisions.config.tsx   # DataTable columns + search config
├── data/
│   ├── poRevision.constants.ts  # Cache keys, API endpoints, doctype names
│   ├── usePORevisionQueries.ts  # Read hooks with Sentry logging
│   └── usePORevisionMutations.ts # Mutation hooks with cache invalidation
├── hooks/
│   ├── usePORevision.ts         # Main dialog state + calculations + submission
│   └── usePORevisionsApprovalDetail.ts # Approval page state + mutations
└── components/
    ├── RevisionHeader.tsx        # Dialog header with stepper
    ├── RevisionFooter.tsx        # Dialog footer with navigation
    ├── Step1/Step1ReviseItems.tsx # Item editing + justification
    ├── Step3/Step3Summary.tsx     # Final review before submit
    ├── ImpactSummaryTable.tsx    # Before/After/Difference financial table
    ├── AddNewItemDialog.tsx      # Add catalog/custom item to revision
    ├── AddChargeDialog.tsx       # Add "Additional Charges" item
    ├── PORevisionHistory.tsx     # Timeline of past revisions on PO detail
    ├── PORevisionInfoCard.tsx    # Vendor/Project/Status info (approval page)
    ├── PORevisionInvoices.tsx    # Invoice table (approval page)
    ├── PORevisionImpactAndJustification.tsx # Before/After + justification
    ├── PORevisionLineItems.tsx   # Item diff table (approval page)
    └── PORevisionPaymentRectification.tsx  # Adjustment details display
```

### Cache Key Factory -- `poRevisionKeys`
All SWR keys generated from single factory in `poRevision.constants.ts`:
- `revisionDoc(id)`, `revisionHistory(poId)`, `procurementRequest(prId)`, `categories(wp)`, `items(wp)`, `categoryMakelist(wp)`, `vendorInvoices(poId)`, `originalPO(poId)`, `lockCheck(poId)`, `allLocked()`

### API Endpoints -- `PO_REVISION_APIS`
- `makeRevision` -> `nirmaan_stack.api.po_revisions.revision_logic.make_po_revisions`
- `approveRevision` -> `nirmaan_stack.api.po_revisions.revision_logic.on_approval_revision`
- `checkLock` -> `nirmaan_stack.api.po_revisions.revision_po_check.check_po_in_pending_revisions`
- `getHistory` -> `nirmaan_stack.api.po_revisions.revision_history.get_po_revision_history`
- `getAllLocked` -> `nirmaan_stack.api.po_revisions.revision_po_check.get_all_locked_po_names`

---

## Step 1: Revise Items

### Item Type Tracking

| Type | Meaning | Transition |
|------|---------|-----------|
| Original | Unchanged from PO | Default state |
| Revised | Same item, qty/rate/tax changed | Original -> edit value fields |
| Replace | Different item_id swapped in | Original -> change item_id |
| New | Entirely new item added | Via "Add Item" / "Add Charge" |
| Deleted | Soft-deleted for backend | Original/Revised -> click delete |

### Received Quantity Constraints

For items with `received_quantity > 0`:

| Field | Behavior |
|-------|----------|
| Item Name | DISABLED (cannot change identity) |
| Unit | DISABLED |
| Make | DISABLED |
| Quantity | min = `received_quantity` (red border if violated) |
| Delete button | DISABLED |

### Custom PO Differences
- Item name: free-text `Input` (not `ReactSelect`)
- Make column: hidden from table
- New items: require manual Category + Procurement Package selection (no catalog lookup)

### Validation (Step 1 -> Summary)
- At least one item must have changed (not all "Original")
- Justification text required (non-empty)
- All non-Deleted items: rate > 0
- All non-Deleted items: qty > 0 AND qty >= received_quantity

---

## Step 2: Summary & Submit

Shows item changes + justification + financial impact (before/after/difference).

Submission calls `make_po_revisions` -> creates Pending document -> returns revision ID.

**Note:** No payment allocation step -- financial reconciliation happens automatically on approval and manually via PO Adjustments.

---

## Backend: Creating a Revision

**API:** `make_po_revisions(po_id, justification, revision_items, total_amount_difference)`

1. Fetches original PO (read-only -- extracts project, vendor)
2. Creates new `PO Revisions` doc with status="Pending"
3. Populates `revision_items` child table per item type
4. Sets `payment_return_details = None` (payment handling decoupled)
5. `.insert(ignore_permissions=True)` -- allows low-permission users to create drafts
6. Emits `po:revision_created` Socket.IO event
7. Returns revision name

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
- `calculate_totals_from_items()` -- recalculates PO amount/tax/total
- Delivery status recalculation (see DN Interaction below)
- Save with `ignore_validate_update_after_submit=True`

### Phase 2: Auto Financial Adjustment

If `total_amount_difference != 0`, the system automatically:

**Positive diff (PO amount increased):** `_auto_add_payment_term()`
1. Appends a new "Created" payment term labeled "Revision Adjustment - {revision_id}"
2. Rebalances all term percentages
3. Creates double-entry in PO Adjustment: "Revision Impact" (+diff) + "Term Addition" (-diff) -> net 0 -> Done

**Negative diff (PO amount decreased):** `_auto_absorb_created_terms()`
1. LIFO-reduces "Created" payment terms to absorb the reduction
2. Creates double-entry in PO Adjustment: "Revision Impact" (-abs_diff) + "Auto Absorb" entries (+absorbed amounts)
3. If fully absorbed -> net 0 -> Done. If partially absorbed -> remaining negative -> Pending (user resolves via PO Adjustment dialog)

### Phase 3: Create/Update PO Adjustment Doc

`_create_or_update_adjustment()` creates or appends to the `PO Adjustments` doc for the original PO, recording all auto-generated entries and recalculating `remaining_impact`.

### Phase 4: Finalize
- Status -> "Approved", save revision doc
- Emits `po:revision_approved` Socket.IO event

### Error Handling
```python
except Exception as e:
    frappe.db.rollback()  # Undoes EVERYTHING
    frappe.log_error(traceback, "Approval Error")
    frappe.throw(user_friendly_message)
```

---

## Transaction Safety: `from_adjustment` Flag

**Problem:** Normal payment hooks call `frappe.db.commit()` mid-transaction, preventing rollback.

**Solution:** `_create_project_payment()` (in `api/po_adjustments/_payment_utils.py`) sets `pay.flags.from_adjustment = True`.

**Hooks that check and return early:**

| File | Hook |
|------|------|
| `doctype/project_payments/project_payments.py` | `before_insert()` -- skips amount validation |
| `doctype/project_payments/project_payments.py` | `on_update()` -- skips status sync + commit |
| `integrations/controllers/project_payments.py` | `after_insert()` -- skips notifications + commit |
| `integrations/controllers/project_payments.py` | `on_update()` -- skips notifications + commit |

**Manual recalc:** `_recalculate_amount_paid(po_id)` sums all Paid payments and updates `amount_paid` field via `frappe.db.set_value()`.

---

## Delivery Notes Interaction

### received_quantity is the Hard Boundary
- Items with `received_quantity > 0` cannot be deleted (backend throws error)
- Item name/unit/make cannot be changed (frontend disables)
- Quantity cannot go below received_quantity (frontend min + backend accepts gracefully)

### DN Operations Blocked During Revision
- `DeliveryPivotTable` receives `isLocked` prop -> submit disabled + alert shown
- **Frontend-only enforcement** -- no backend validation on DN APIs checks revision lock
- Contrast with CEO Hold: CEO Hold *exempts* DNs; Revision *blocks* them

### Post-Approval Delivery Status Recalculation

After `sync_original_po_items`, the system recalculates delivery status:

1. **Check dispatch completeness**: If any items not dispatched -> `Partially Dispatched` (sticky)
2. **For fully-dispatched POs**: Run `calculate_order_status()`:
   - Integer quantities: exact match (`quantity <= received_quantity`)
   - Float quantities: 2.5% tolerance
   - Additional Charges: skipped from calculation
3. **Recalculate `po_amount_delivered`** via `calculate_delivered_amount()`
4. **New items auto-dispatched**: Items added to post-dispatch PO get `is_dispatched=1`

**Key scenario -- quantity reduced below received:**
If revision reduces qty from 10->5 but 7 were received, backend silently accepts -> item marked "delivered" (7>=5) -> PO may auto-transition to "Delivered".

### Return Notes Can Independently Affect Status
Return DNs store negative `delivered_quantity` -> `recalculate_po_delivery_fields()` sums all DNs -> status may revert (Delivered -> Partially Delivered).

---

## Payload Structure

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

---

## Key Backend Files

| File | Purpose |
|------|---------|
| `api/po_revisions/revision_logic.py` | Create, approve, reject revisions; item sync; auto-adjustment |
| `api/po_revisions/revision_po_check.py` | Lock checks (revision + adjustment), bulk lock list |
| `api/po_revisions/revision_history.py` | History API with computed totals |
| `api/po_adjustments/_payment_utils.py` | Shared payment utilities (create payment, LIFO reduction, split terms) |
| `api/po_adjustments/adjustment_logic.py` | Manual adjustment execution (Against-PO, Adhoc, Refund) |
| `doctype/po_revisions/po_revisions.json` | PO Revisions doctype schema |
| `doctype/po_revisions_items/po_revisions_items.json` | Child table schema |
| `doctype/po_adjustments/po_adjustments.json` | PO Adjustments doctype schema |
| `doctype/project_payments/project_payments.py` | `from_adjustment` flag checks |
| `integrations/controllers/project_payments.py` | `from_adjustment` flag checks |

---

## Gotchas

1. **DN lock is frontend-only** -- no backend validation prevents DN creation during pending revision
2. **Quantity below received accepted** -- backend doesn't re-validate the constraint; item gets marked over-delivered
3. **Partially Dispatched is sticky** -- stays even with DNs recorded, until ALL items dispatched
4. **Additional Charges** skipped from delivery status calc, use full qty for amount calc
5. **from_adjustment flag is critical** -- without it, payment hook commits break rollback atomicity
6. **TimestampMismatchError** -- `_recalculate_amount_paid` for original PO must run AFTER `.save()` because `set_value` updates `modified`
7. **payment_return_details is deprecated** -- revision no longer stores payment allocation; set to None on creation
8. **Positive diff is auto-resolved** -- auto-creates Created term + PO Adjustment entries that net to zero -> status "Done"
9. **Negative diff may need manual resolution** -- only auto-absorbs Created terms; remaining deficit tracked as Pending in PO Adjustment
