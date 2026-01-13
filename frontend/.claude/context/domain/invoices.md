# Invoice Management Domain

Reference documentation for PO and SR invoice management with 2B reconciliation.

---

## Overview

Invoices are created against:
- **PO Invoices** - Purchase Orders (material procurement)
- **SR Invoices** - Service Requests (work orders)

Both types support GST 2B form reconciliation tracking.

---

## Key Files

| Component | Location |
|-----------|----------|
| PO Invoices Table | `src/pages/tasks/invoices/components/PoInvoices.tsx` |
| SR Invoices Table | `src/pages/tasks/invoices/components/SrInvoices.tsx` |
| PO Table Config | `src/pages/tasks/invoices/config/poInvoicesTable.config.ts` |
| SR Table Config | `src/pages/tasks/invoices/config/srInvoicesTable.config.ts` |

---

## Invoice Fields

### Common Fields
- `invoice_no` - Vendor's invoice number
- `date` - Invoice date
- `vendor` - Vendor reference (Link)
- `vendor_name` - Vendor display name
- `project` - Project reference
- `status` - Invoice status (Pending, Approved, etc.)

### 2B Reconciliation Fields
- `2b_activation_status` - GST 2B form matching status (0/1)
- `reconciled_date` - Date when reconciliation was performed
- `updated_by` - User who last updated reconciliation

---

## Table Configuration Pattern

Config files define searchable fields and filter options:

```typescript
// poInvoicesTable.config.ts
export const PO_INVOICE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "invoice_no", label: "Invoice No", placeholder: "...", default: true },
    { value: "procurement_order", label: "PO ID", placeholder: "..." },
    { value: "vendor_name", label: "Vendor", placeholder: "..." },
    { value: "project", label: "Project ID", placeholder: "..." },
];

export const PO_INVOICE_DATE_COLUMNS: string[] = ["date", "reconciled_date"];

export const PO_INVOICE_2B_STATUS_OPTIONS = [
    { label: "Activated", value: "true" },
    { label: "Not Activated", value: "false" },
];
```

---

## Vendor-Specific Filtering

Invoice components accept optional `vendorId` prop for use in Vendor Overview:

```typescript
interface PoInvoicesProps {
    vendorId?: string;
}

// When vendorId is provided:
// 1. Filter data client-side to vendor's invoices
// 2. Hide vendor column (redundant)
// 3. Use vendor-specific urlSyncKey for filter persistence
// 4. Calculate vendor-specific summary stats
```

---

## Date Filter Implementation

Client-side tables require explicit `filterFn` for date columns:

```typescript
import { dateFilterFn } from "@/utils/tableFilters";

{
    accessorKey: "date",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Date" />,
    filterFn: dateFilterFn, // Required for DataTableDateFilter to work
}
```

The `dateFilterFn` handles operations: Is, Between, On/Before, On/After, Timespan.

---

## User Full Name Display

For `updated_by` field showing full name instead of user ID:

```typescript
// Fetch users
const { data: users } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
    fields: ["name", "full_name"],
    limit: 0,
});

// Create lookup values
const userValues = useMemo(() =>
    users?.map(u => ({ label: u.full_name, value: u.name })) || [],
[users]);

// Memoized lookup helper
const getUserFullName = useMemo(() => memoize((userId: string) => {
    const user = userValues.find(u => u.value === userId);
    return user?.label || userId;
}), [userValues]);

// Use in column cell
cell: ({ row }) => <span>{getUserFullName(row.original.updated_by)}</span>
```

---

## Facet Filter Options

Generate facet filter options from data:

```typescript
// Get unique values
const uniqueUpdatedBy = [...new Set(data.map(row => row.updated_by).filter(Boolean))];

// Create filter options with full names
facetFilterOptions: {
    updated_by: {
        title: "Updated By",
        options: uniqueUpdatedBy.map(u => ({
            label: getUserFullName(u as string),
            value: u as string
        }))
    }
}
```

---

## Access Control

Invoice reconciliation actions are typically restricted to:
- Admin
- PMO Executive
- Accountant

Check role before showing reconciliation controls.

---

## Related Backend

- `nirmaan_stack/api/invoices/` - Invoice API endpoints
- `PO Invoices` doctype - PO invoice records
- `SR Invoices` doctype - SR invoice records
