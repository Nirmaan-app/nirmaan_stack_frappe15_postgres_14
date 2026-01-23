# Invoice Management Domain

Reference documentation for PO and SR invoice management with 2B reconciliation.

---

## Overview

Invoices are stored in the centralized **Vendor Invoices** doctype with dynamic links to:
- **PO Invoices** - Purchase Orders (material procurement)
- **SR Invoices** - Service Requests (work orders)

Both types support:
- Approval workflow (Pending/Approved/Rejected)
- GST 2B form reconciliation tracking

---

## Vendor Invoices Doctype

**Autoname:** `VI-.YYYY.-.#####` (e.g., `VI-2026-00001`)

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `document_type` | Select | "Procurement Orders" or "Service Requests" |
| `document_name` | Dynamic Link | PO or SR document reference |
| `project` | Link | Project reference |
| `vendor` | Link | Vendor reference |
| `invoice_no` | Data | Vendor's invoice number |
| `date` | Date | Invoice date |
| `amount` | Currency | Invoice amount |
| `invoice_attachment_id` | Data | Attachment reference |

### Approval Fields

| Field | Type | Description |
|-------|------|-------------|
| `status` | Select | Pending / Approved / Rejected |
| `approved_by` | Data | User who approved/rejected |
| `approved_on` | Datetime | Approval timestamp |
| `rejection_reason` | Small Text | Reason for rejection |

### Reconciliation Fields

| Field | Type | Description |
|-------|------|-------------|
| `reconciliation_status` | Select | "" / "partial" / "full" / "na" |
| `reconciled_amount` | Currency | Amount matched in 2B |
| `reconciled_date` | Date | Reconciliation date |
| `reconciled_by` | Data | User who reconciled |
| `reconciliation_proof_attachment_id` | Data | Proof attachment |

---

## Key Files

| Component | Location |
|-----------|----------|
| PO Invoices Table | `src/pages/tasks/invoices/components/PoInvoices.tsx` |
| SR Invoices Table | `src/pages/tasks/invoices/components/SrInvoices.tsx` |
| Pending Tasks Table | `src/pages/tasks/invoices/components/PendingTasksTable.tsx` |
| Task History Table | `src/pages/tasks/invoices/components/TaskHistoryTable.tsx` |
| Invoice Dialog | `src/pages/ProcurementOrders/invoices-and-dcs/components/InvoiceDialog.tsx` |
| Invoice Type | `src/types/NirmaanStack/VendorInvoice.ts` |
| Constants | `src/pages/tasks/invoices/constants.ts` |

---

## Backend APIs

| API | Purpose |
|-----|---------|
| `api/invoices/po_wise_invoice_data.py` | Fetch PO invoices |
| `api/invoices/sr_wise_invoice_data.py` | Fetch SR invoices |
| `api/invoices/approve_vendor_invoice.py` | Approve/reject invoices |
| `api/invoices/check_duplicate_invoice.py` | Duplicate detection |
| `api/invoices/get_vendor_invoice_totals.py` | Document totals aggregation |
| `api/invoices/update_invoice_reconciliation.py` | Update reconciliation status |

---

## Invoice ID Resolution

**CRITICAL:** Always use the actual Vendor Invoice `name` field (e.g., `VI-2026-00001`), NOT a generated composite key.

```typescript
// ❌ WRONG - Don't generate composite keys
return entries.map((entry, index) => ({
    ...entry,
    name: `${entry.procurement_order}-${entry.invoice_no}-${index}`
}));

// ✅ CORRECT - Use backend's name field
return entries; // Backend returns actual Vendor Invoice name
```

---

## Tab Styling Pattern

Invoice reconciliation tabs use custom buttons (not Ant Design Radio.Group):

```typescript
// constants.ts
export const INVOICE_TASK_TAB_OPTIONS = [
  { label: "Pending Invoice Approvals", value: "pending" },
  { label: "Invoice Action History", value: "history" },
] as const;

export const INVOICE_TYPE_TAB_OPTIONS = [
  { label: "SR Invoices", value: "sr_invoices" },
  { label: "PO Invoices", value: "po_invoices" },
] as const;
```

Button styling: Active `bg-sky-500 text-white`, Inactive `bg-gray-100 text-gray-700 hover:bg-gray-200`

---

## Reconciliation Status Types

```typescript
type ReconciliationStatus = "" | "partial" | "full" | "na";

// "" = Not Reconciled (pending)
// "partial" = Partially Reconciled (some amount matched)
// "full" = Fully Reconciled (complete match)
// "na" = Not Applicable (no 2B reconciliation needed)
```

---

## User Field Mapping

Backend returns `uploaded_by`, display as user's full name:

```typescript
// Interface field
uploaded_by: string;

// Lookup user full name
const getUserFullName = useMemo(() => memoize((userId: string) => {
    const user = userValues.find(u => u.value === userId);
    return user?.label || userId;
}), [userValues]);
```

---

## Access Control

| Action | Roles |
|--------|-------|
| View Invoices | All roles |
| Approve/Reject | Admin, PMO, Accountant |
| Reconciliation | Admin, PMO, Accountant |
| Create/Edit | Admin, PMO, Accountant, Procurement, Project Lead |

---

## Vendor-Specific Filtering

Invoice components accept optional `vendorId` prop for Vendor Overview:

```typescript
interface PoInvoicesProps {
    vendorId?: string;
}

// When vendorId provided:
// 1. Filter data client-side to vendor's invoices
// 2. Hide vendor column (redundant)
// 3. Use vendor-specific urlSyncKey for filter persistence
```
