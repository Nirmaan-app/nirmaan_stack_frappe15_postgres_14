# CEO Hold Status - Feature Documentation

## Overview

"CEO Hold" is a project status that **suspends all financial and procurement operations** for a project. When active, users cannot create, edit, or approve procurement requests, purchase orders, service requests, payments, invoices, or expenses for that project.

This status was added in commit `7c691bff` (2026-02-03) alongside "Created", "WIP", "Completed", and "Halted".

---

## Project Status Values

| Status | Color | Icon | Procurement | Payments | Visibility |
|--------|-------|------|-------------|----------|------------|
| Created | `bg-blue-100` | — | Allowed | Allowed | Active |
| WIP | `text-yellow-500` | HardHat | Allowed | Allowed | Active |
| Completed | `text-green-500` | CircleCheckBig | Hidden* | Allowed | Active |
| Halted | `text-red-500` | OctagonMinus | Hidden* | Allowed | Active |
| **CEO Hold** | `text-amber-600` | Hand | **Blocked** | **Blocked** | Active |

*Hidden = Not in ProjectSelect dropdown, but existing operations not blocked

---

## Implementation Architecture

### Core Hooks

**File: `src/hooks/useCEOHoldGuard.ts`**
- Single-project guard for detail pages
- Returns: `{ isCEOHold, isLoading, projectStatus, showBlockedToast }`
- Shows destructive toast: "This project is on CEO Hold. Contact Admin to resume operations."

**File: `src/hooks/useCEOHoldProjects.ts`**
- Multi-project batch lookup for list pages
- Returns: `{ ceoHoldProjectIds: Set<string>, isLoading }`
- Fetches all CEO Hold projects once, O(1) lookup per row

### Visual Components

**File: `src/components/ui/ceo-hold-banner.tsx`**
- Full banner (default): Gradient amber background with animated hand icon
- Compact mode (`compact={true}`): Inline badge for cards/tables

**File: `src/utils/ceoHoldRowStyles.ts`**
- `CEO_HOLD_ROW_CLASSES`: Tailwind classes for amber row highlighting
- Used with DataTable's `getRowClassName` prop

---

## Blocked Operations by Page

### Procurement Flow

| Page | File | Guard Hook | Actions Blocked |
|------|------|------------|-----------------|
| New PR | `NewPR/hooks/useSubmitProcurementRequest.ts` | `useCEOHoldGuard` | Submit new PR, edit draft PR |
| PR List | `procurement-requests.tsx` | `useCEOHoldProjects` | Row highlighting only (visual) |
| Approve PR | `ApproveNewPR/hooks/useApprovePRLogic.ts` | `useCEOHoldGuard` | Approve, reject, delete PR |
| Vendor Quotes | `ApproveVendorQuotes/hooks/useApproveRejectLogic.ts` | `useCEOHoldGuard` | Approve quotes, send back |
| Quote API | `ApproveVendorQuotes/hooks/useQuoteApprovalApi.ts` | `useCEOHoldGuard` | API-level blocking |
| Release PO | `release-po-select.tsx` | `useCEOHoldProjects` | Row highlighting (visual) |
| Amend PO | `amend-po/approve-amend-po.tsx` | `useCEOHoldGuard` | Approve PO amendments |
| Amend PO List | `amend-po/approve-select-amend-po.tsx` | `useCEOHoldProjects` | Row highlighting |
| Vendor Selection | `VendorQuotesSelection/hooks/useProcurementActions.ts` | `useCEOHoldGuard` | Select vendors, update quotes |
| Sent Back | `Sent Back Requests/hooks/useApproveSBSLogic.ts` | `useCEOHoldGuard` | Approve sent-back items |

### Service Requests (Work Orders)

| Page | File | Guard Hook | Actions Blocked |
|------|------|------------|-----------------|
| New SR | `sr-form/index.tsx` | `useCEOHoldGuard` | Create SR/WO |
| Approve SR | `service-request/approve-service-request.tsx` | `useCEOHoldGuard` | Approve, reject SR |
| SR Lists | `*-sr-list.tsx` files | `useCEOHoldProjects` | Row highlighting |
| SR Workflow | `approved-sr/hooks/useSRWorkflowActions.ts` | `useCEOHoldGuard` | Delete, amend SR |
| SR Finalize | `hooks/useSRFinalize.ts` | `useCEOHoldGuard` | Finalize, revert |
| SR Payment | `approved-sr/hooks/useSRPaymentManager.ts` | `useCEOHoldGuard` | Add payment terms |

### Payments & Financials

| Page | File | Guard Hook | Actions Blocked |
|------|------|------------|-----------------|
| Credits | `credits/hooks/useCredits.ts` | `useCEOHoldGuard` | Request payment term |
| Credits List | `credits/CreditsPage.tsx` | `useCEOHoldProjects` | Row highlighting |
| Approve Payments | `approve-payments/ApprovePayments.tsx` | Both hooks | Approve/reject payments |
| Payment Lists | `AllPayments.tsx`, `project-payments-list.tsx` | `useCEOHoldProjects` | Row highlighting |
| Update Payment | `update-payment/UpdatePaymentDialog.tsx` | `useCEOHoldGuard` | Update, mark paid |
| Request Payment | `request-payment/RequestPaymentDialog.tsx` | `useCEOHoldGuard` | Request new payment |
| Inflow Payments | `inflow-payments/InFlowPayments.tsx` | `useCEOHoldProjects` | Row highlighting |

### Expenses & Invoices

| Page | File | Guard Hook | Actions Blocked |
|------|------|------------|-----------------|
| New Expense | `ProjectExpenses/components/NewProjectExpenseDialog.tsx` | `useCEOHoldGuard` | Create expense |
| Edit Expense | `ProjectExpenses/components/EditProjectExpenseDialog.tsx` | `useCEOHoldGuard` | Update expense |
| Expense List | `ProjectExpenses/ProjectExpensesList.tsx` | `useCEOHoldProjects` | Row highlighting |
| Invoice Lists | `tasks/invoices/components/PoInvoices.tsx`, `SrInvoices.tsx` | `useCEOHoldProjects` | Row highlighting |
| All Invoices | `ProjectInvoices/AllProjectInvoices.tsx` | `useCEOHoldProjects` | Row highlighting |

### PO Operations

| Page | File | Guard Hook | Actions Blocked |
|------|------|------------|-----------------|
| PO Details | `purchase-order/components/PODetails.tsx` | `useCEOHoldGuard` | Delete attachment, mark delivered (Upload DC/MIR NOT blocked) |
| Payment Terms | `purchase-order/components/POPaymentTermsCard.tsx` | `useCEOHoldGuard` | Request payment |
| Delivery Notes | `DeliveryNotes/deliverynote.tsx` | `useCEOHoldGuard` | Banner display |
| DN Items | `DeliveryNotes/components/deliveryNoteItemsDisplay.tsx` | `useCEOHoldGuard` | Submit delivery updates |

### Reports & Trackers

| Page | File | Guard Hook | Actions Blocked |
|------|------|------------|-----------------|
| PO Reports | `reports/components/POReports.tsx` | `useCEOHoldProjects` | Row highlighting |
| SR Reports | `reports/components/SRReports.tsx` | `useCEOHoldProjects` | Row highlighting |
| Reconcile | `reports/components/POAttachmentReconcileReport.tsx` | `useCEOHoldProjects` | Row highlighting |
| TDS Approval | `tds/TDSApprovalDetail.tsx` | `useCEOHoldGuard` | Add item, delete (Approve/Reject NOT blocked) |
| Design Tracker | `ProjectDesignTracker/project-design-tracker-details.tsx` | `useCEOHoldGuard` | Banner only |
| Material Plan | `MaterialPlanTracker/material-plan-tracker-detail.tsx` | `useCEOHoldGuard` | Banner only |
| Cashflow Plan | `CashflowPlanTracker/cashflow-plan-tracker-detail.tsx` | `useCEOHoldGuard` | Banner only |
| Work Plan | `WorkPlanTracker/work-plan-tracker-detail.tsx` | `useCEOHoldGuard` | Banner only |

### Milestones

| Page | File | Guard Hook | Actions Blocked |
|------|------|------------|-----------------|
| Daily Summary | `Manpower-and-WorkMilestones/MilestoneDailySummary.tsx` | `useCEOHoldGuard` | Banner display only |

---

## Usage Patterns

### Detail Page Pattern (single project)

```typescript
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { CEOHoldBanner } from "@/components/ui/ceo-hold-banner";

function MyDetailPage({ projectId }: { projectId: string }) {
  const { isCEOHold, showBlockedToast } = useCEOHoldGuard(projectId);

  const handleAction = () => {
    if (isCEOHold) {
      showBlockedToast();
      return;
    }
    // ... proceed with action
  };

  return (
    <div>
      {isCEOHold && <CEOHoldBanner className="mb-4" />}
      {/* ... rest of UI */}
    </div>
  );
}
```

### List Page Pattern (multiple projects)

```typescript
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";

function MyListPage() {
  const { ceoHoldProjectIds } = useCEOHoldProjects();

  const getRowClassName = useCallback((row: Row<MyData>) => {
    if (ceoHoldProjectIds.has(row.original.project)) {
      return CEO_HOLD_ROW_CLASSES;
    }
    return undefined;
  }, [ceoHoldProjectIds]);

  return (
    <DataTable
      // ...
      getRowClassName={getRowClassName}
    />
  );
}
```

---

## Who Can Set CEO Hold

CEO Hold can **only** be set/unset by **`nitesh@nirmaan.app`** (not any Admin or role-based check).

- **Backend validation:** `projects.py` (`validate` method) enforces this — rejects CEO Hold changes from any other user
- **`ceo_hold_by` field:** Added to Projects doctype to track who set the hold
- **Frontend constant:** `CEO_HOLD_AUTHORIZED_USER` in `src/constants/ceoHold.ts` — used for UI gating (dropdown filter, disabled state, locked hint, heldBy banner)

**File:** `src/constants/ceoHold.ts` - Authorized user constant
**File:** `src/pages/projects/project.tsx` - Status change popover and confirmation dialog

---

## Comparison: CEO Hold vs Halted

| Aspect | CEO Hold | Halted |
|--------|----------|--------|
| Visual | Light red row highlighting | Red theme |
| PR/SR Creation | **Blocked** | Not blocked (no guard) |
| PR/SR Approval | **Blocked** | Not blocked |
| Payments | **Blocked** | Not blocked |
| Expenses | **Blocked** | Not blocked |
| In ProjectSelect | Hidden | Hidden |
| Icon | Hand | OctagonMinus |

**Key difference:** CEO Hold actively blocks operations; Halted only hides from dropdowns.

---

## File Reference

| File | Purpose |
|------|---------|
| `src/hooks/useCEOHoldGuard.ts` | Single-project guard hook |
| `src/hooks/useCEOHoldProjects.ts` | Multi-project lookup hook |
| `src/components/ui/ceo-hold-banner.tsx` | Visual banner component |
| `src/utils/ceoHoldRowStyles.ts` | Row styling constants |
| `src/constants/ceoHold.ts` | `CEO_HOLD_AUTHORIZED_USER` constant |
| `src/pages/projects/project.tsx:98-118` | Status options definition |
