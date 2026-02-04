# Projects Domain - Frontend Status Behavior

## Project Status Display

**File:** `src/pages/projects/project.tsx:98-118`

| Status | Color | Icon | Badge Variant |
|--------|-------|------|---------------|
| Created | `bg-blue-100` | — | `secondary` |
| WIP | `text-yellow-500` | HardHat | `secondary` |
| Completed | `text-green-500` | CircleCheckBig | `default` (green) |
| Halted | `text-red-500` | OctagonMinus | `destructive` (red) |
| **CEO Hold** | `text-amber-600` | Hand | amber theme |

> **Note:** CEO Hold has extensive blocking behavior. See `domain/ceo-hold.md` for full documentation.

---

## Status Change UI

**File:** `src/pages/projects/project.tsx:1085-1119, 1215-1258`

- **Who can change:** Admin (`Nirmaan Admin Profile`) and PMO Executive (`Nirmaan PMO Executive Profile`) only
- **Available targets:** WIP, Completed, Halted, CEO Hold (cannot revert to "Created")
- **Flow:** Popover dropdown → select status → confirmation AlertDialog → `updateDoc()` call
- **Feedback:** Success/error toast notification

---

## ProjectSelect Component

**File:** `src/components/custom-select/project-select.tsx`

### Status Filter (line 34)
```typescript
const projectFilters = [["status", "not in", ["Completed", "Halted"]]];
```

Filters out Halted/Completed projects from the dropdown by default.

### Props
| Prop | Default | Effect |
|------|---------|--------|
| `universal` | `true` | Restores selected project from sessionStorage |
| `all` | `false` | When `true`, bypasses status filter (shows all projects) |

### Usage Map

**With filter (Halted/Completed hidden):**

| Component | File:Line | Purpose |
|-----------|-----------|---------|
| PR List | `components/procurement-request/list-pr.tsx:79` | Project filter on PR list |
| SR List | `pages/ServiceRequests/service-request/list-sr.tsx:100` | Project filter on SR list |
| Delivery Notes | `pages/DeliveryNotes/deliverynotes.tsx:147,213` | Project filter on DN list |
| DC & MIRs | `pages/DeliveryChallansAndMirs/DeliveryChallansAndMirs.tsx:397` | Project filter on DC/MIR list |
| ManPower Report | `components/ManPowerReport.tsx:302` | Project filter for report |
| Edit Invoice | `pages/ProjectInvoices/components/ProjectInvoiceDialog.tsx:154` | Project selector in edit dialog |
| New Expense | `pages/ProjectExpenses/components/NewProjectExpenseDialog.tsx:170` | Project selector for new expense |

**Without filter (`all={true}`, all projects shown):**

| Component | File:Line | Reason |
|-----------|-----------|--------|
| New Inflow Payment | `pages/inflow-payments/components/NewInflowPayment.tsx:261` | Need to record payments for completed projects |
| New Project Invoice | `pages/ProjectInvoices/components/NewProjectInvoiceDialog.tsx:282` | Need to create invoices for completed projects |

---

## What Status Does NOT Restrict

These pages have their own project selection logic and do **not** use `ProjectSelect`:

| Page | File | Status Guard |
|------|------|-------------|
| New PR creation | `pages/ProcurementRequests/NewPR/NewProcurementRequestPage.tsx` | None |
| New SR/WO creation | `pages/ServiceRequests/service-request/new-service-request.tsx` | None |

PR and SR creation is **not blocked** for Halted/Completed projects — there is no frontend or backend guard.

---

## Complete Status Impact Matrix

| Feature | Created | WIP | Halted | Completed | CEO Hold |
|---------|---------|-----|--------|-----------|----------|
| Visible in project list | Yes | Yes | Yes | Yes | Yes |
| Change status (Admin/PMO) | To WIP/Halted/Completed/CEO Hold | All others | All others | All others | All others |
| Filter PRs/SRs/DNs by project | Yes | Yes | Hidden | Hidden | Yes |
| Create new PR | Allowed | Allowed | Allowed | Allowed | **Blocked** |
| Create new SR/WO | Allowed | Allowed | Allowed | Allowed | **Blocked** |
| Approve PR/SR | Allowed | Allowed | Allowed | Allowed | **Blocked** |
| Payments | Allowed | Allowed | Allowed | Allowed | **Blocked** |
| New Project Expense | Yes | Yes | Hidden | Hidden | **Blocked** |
| Edit Project Invoice | Yes | Yes | Hidden | Hidden | **Blocked** |
| New Project Invoice | Yes | Yes | Yes | Yes | **Blocked** |
| New Inflow Payment | Yes | Yes | Yes | Yes | **Blocked** |
| Design Tracker (backend) | Yes | Yes | Blocked | Blocked | Banner only |
| Progress Reports (backend) | Included | Included | Included | Excluded | Included |

> **CEO Hold Blocking:** Uses `useCEOHoldGuard` hook which shows toast and prevents action. See `domain/ceo-hold.md`.
