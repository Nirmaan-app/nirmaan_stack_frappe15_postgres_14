# Vendor Hold & Credit Management - Feature Documentation

## Overview

Vendor Hold is a vendor-level status that **blocks dispatch and payment operations** on POs with "PO Approved" status. When a vendor's credit is exhausted (`available_credit <= 0`), they are marked "On-Hold" by a daily cron. Admins/PMOs can also toggle status manually.

Unlike CEO Hold (project-scoped, blocks ALL operations), Vendor Hold is vendor-scoped and only blocks pre-dispatch financial operations on newly approved POs.

---

## Vendor Status Values

| Status | Badge Color | Operations on PO Approved POs | Operations on Dispatched+ POs |
|--------|-------------|-------------------------------|-------------------------------|
| Active | `green` | All allowed | All allowed |
| On-Hold | `amber` | Dispatch + payments **blocked** | All allowed (informational banner only) |

---

## Credit Model

```
credit_used = SUM(max(po_amount_delivered - amount_paid, 0))  [post-April 2025 POs]
            + SUM(max(total_invoiced - amount_paid, 0))        [pre-April 2025 POs]

available_credit = credit_limit - credit_used
vendor_status = "On-Hold" if available_credit <= 0 else "Active"  [set by daily cron only]
```

**Default credit limit:** 10,000 for new vendors. Migration sets `max(20% of FY 25-26 PO volume, 10000)` for existing vendors.

---

## Implementation Architecture

### Core Hooks

**File: `src/hooks/useVendorHoldGuard.ts`**
- Single-vendor guard for PO detail pages
- Fetches vendor doc via `useFrappeGetDoc("Vendors", vendorId, vendorId ? undefined : null)`
- Returns `{ isOnHold, showBlockedToast, availableCredit, creditLimit }`
- **IMPORTANT:** Third arg to `useFrappeGetDoc` is `swrKey`, NOT options. Use `vendorId ? undefined : null` (not `{ enabled }`)

**File: `src/hooks/useVendorHoldVendors.ts`**
- Bulk lookup for list/table pages
- Fetches all On-Hold vendor IDs via `useFrappeGetDocList` with filter `[["vendor_status", "=", "On-Hold"]]`
- Returns `Set<string>` for O(1) row lookup
- Used with `VENDOR_HOLD_ROW_CLASSES` for amber row highlighting

### UI Components

| Component | File | Usage |
|-----------|------|-------|
| `VendorHoldBanner` | `src/components/ui/vendor-hold-banner.tsx` | Full banner (amber gradient) + compact badge mode |
| `VENDOR_HOLD_ROW_CLASSES` | `src/utils/vendorHoldRowStyles.ts` | Amber row highlighting for DataTables |

### Blocking Pattern (in PO detail pages)

**Derived variable:**
```typescript
const isVendorHoldBlocked = isVendorOnHold && po?.status === "PO Approved";
```

**Guard pattern (toast-on-click, NOT disabled buttons):**
```typescript
if (isVendorHoldBlocked) {
    showVendorBlockedToast();
    return;
}
```

---

## Frontend Integration Points

### PO Detail — `PODetails.tsx`
- `useVendorHoldGuard(po?.vendor)` — fetches vendor status
- `isVendorHoldBlocked` — gates actions to "PO Approved" status only
- **Banner:** Shows `VendorHoldBanner` for ALL statuses when vendor On-Hold (informational)
- **Blocked actions:** Dispatch, Revert, Revise PO, Adjust Payments

### PO Payment Terms — `POPaymentTermsCard.tsx`
- `useVendorHoldGuard(PO?.vendor)` — independent hook call (SWR deduplicates)
- `isVendorHoldBlocked` — same status gate
- **Blocked actions:** Request Payment, Edit Payment Terms

### Approve Vendor Quotes — `ApproveRejectVendorQuotesContainer/View`
- `useVendorHoldVendors()` — bulk lookup
- Shows `VendorHoldBanner` per on-hold vendor in quotes
- **Actions NOT blocked** — PO creation proceeds; blocking happens on PO detail page

### Vendors List — `VendorsPage.tsx`
- `useVendorHoldVendors()` + `VENDOR_HOLD_ROW_CLASSES` for row highlighting
- `vendor_status` column with color-coded badge
- Facet filter for vendor status

### Vendor Detail — `vendor.tsx`
- `VendorHoldBanner` on overview tab when On-Hold
- `VendorCreditManagementCard` — status toggle (Admin/PMO), credit metrics, ledger

---

## Backend Architecture

### Credit Recalculation Engine — `api/vendor_credit.py`
- `recalculate_vendor_credit(vendor_id, entry_type, ...)` — updates credit metrics + appends ledger entry. **Does NOT change vendor_status.**
- `_compute_credit_used(vendor_doc, exclude_po=None)` — dual-era formula
- `update_credit_limit(vendor_id, new_limit)` — whitelisted API for admin

### Daily Cron — `tasks/vendor_credit_update.py`
- Runs at 10 AM IST (`cron: "30 4 * * *"`)
- **Sole authority** for auto-setting `vendor_status`
- Recalculates ALL vendors, sets On-Hold if `available_credit <= 0`

### Trigger Points (9 events call `recalculate_vendor_credit`):
| Event | File | Entry Type |
|-------|------|------------|
| DN create/update | `controllers/delivery_notes.py` | "DN Created" / "Return Note" |
| DN delete | `controllers/delivery_notes.py` | "DN Deleted" |
| Payment fulfilled | `controllers/project_payments.py` | "Payment Fulfilled" |
| Payment deleted | `controllers/project_payments.py` | "Payment Deleted" |
| PO cancelled | `api/handle_cancel_po.py` | "PO Cancelled" |
| PO deleted | `controllers/procurement_orders.py` | "PO Deleted" |
| PO merged | `api/po_merge_and_unmerge.py` | "PO Merged" |
| Revision approved | `api/po_revisions/revision_logic.py` | "Revision Approved" |
| Adjustment resolved | `api/po_adjustments/adjustment_logic.py` | "Adjustment Resolved" |

### Doctypes
- **Vendor Credit Ledger** — child table on Vendors (`istable: 1`)
  - Fields: `entry_type`, `po_id`, `project`, `delta_amount`, `credit_used_after`, `available_credit_after`, `timestamp`, `description`, `triggered_by`

---

## Comparison: Vendor Hold vs CEO Hold

| Aspect | CEO Hold | Vendor Hold |
|--------|----------|-------------|
| Scope | Per-project | Per-vendor |
| Status field | `project.status = "CEO Hold"` | `vendor.vendor_status = "On-Hold"` |
| Trigger | Manual only (`nitesh@nirmaan.app`) | Auto (credit exhaustion) + manual (Admin/PMO) |
| Backend enforcement | Yes (`projects.py validate`) | No (frontend-only) |
| Operations blocked | ALL procurement + payments | Dispatch + payments on **PO Approved only** |
| DN exempt | Yes (explicit exemption) | N/A (DNs are post-dispatch) |
| Guard variable | `isCEOHold` | `isVendorHoldBlocked` (status-gated) |

---

## Key Gotchas

1. **`useFrappeGetDoc` third arg is `swrKey`, not options.** Use `vendorId ? undefined : null` to conditionally fetch. `{ enabled: !!vendorId }` breaks SWR caching (all vendors share one cache key).
2. **Daily cron overrides manual status** — if admin sets vendor Active but credit is still exhausted, next cron at 10 AM will revert to On-Hold.
3. **No backend enforcement** — vendor hold blocking is frontend-only. API calls bypass guards.
4. **Banner vs blocking** — Banner shows on ALL PO statuses (informational). Blocking only on "PO Approved" status.
