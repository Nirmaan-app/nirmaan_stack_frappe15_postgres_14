# Claude Code Session Changelog

This file tracks significant changes made by Claude Code sessions.

---

## 2026-02-02: PR Editing Lock, Draft Persistence & Service Request Form Wizard

### Summary
Major session implementing concurrent editing prevention for PR approval flow, localStorage draft persistence for PR edits, and a new step-based wizard for Service Request (Work Order) creation with amendment support.

### Commits
- `9cd6831d` - feat: add backend API for PR editing lock
- `d16819cb` - feat: add customizable title prop to DraftCancelDialog
- `1fed460c` - feat: add New WO dialog trigger from service requests page
- `294cc7b4` - feat: add step-based Service Request form wizard
- `20492e84` - feat: add draft persistence and editing lock for Approve PR
- `84656a59` - feat: improve Approve PR flow UI/UX and fix undo bug
- `6762676b` - refactor: integrate new WO wizard route and clean up dialogs
- `e0d43e1a` - feat: add FormResetWarningDialog for unsaved changes warning
- `6aa5eb3e` - feat: add new Work Order creation wizard with step-based flow

### Feature 1: PR Editing Lock System

Prevents concurrent edits to the same Procurement Request by multiple users using Redis-based locking.

**Backend (`nirmaan_stack/api/pr_editing_lock.py`):**
- `acquire_lock(pr_name)` - Acquire editing lock (15-minute expiry)
- `release_lock(pr_name)` - Release lock (idempotent)
- `check_lock(pr_name)` - Check lock status without acquiring
- `extend_lock(pr_name)` - Heartbeat to extend lock (called every 5 minutes)

**Frontend (`src/pages/ProcurementRequests/ApproveNewPR/`):**
- `hooks/useEditingLock.ts` - React hook managing lock lifecycle:
  - Auto-acquire on mount, auto-release on unmount
  - Heartbeat interval (5 min) to extend lock
  - Socket.IO listeners for real-time lock status updates
  - `navigator.sendBeacon()` for reliable unload release
- `components/EditingLockIndicator.tsx` - UI showing who has the lock

**Socket.IO Events:**
- `pr:editing:started` - Emitted when user acquires lock
- `pr:editing:stopped` - Emitted when user releases lock

**Feature Flag:**
- `localStorage.setItem('nirmaan-lock-disabled', 'true')` to disable lock system

### Feature 2: Approve PR Draft Persistence

Saves PR editing progress to localStorage, allowing users to resume work after accidental navigation or page refresh.

**Store (`src/zustand/useApproveNewPRDraftStore.ts`):**
- Zustand store with `persist` middleware for localStorage
- Keys: `nirmaan-approve-pr-drafts` keyed by PR ID
- 30-day expiration with auto-cleanup on rehydration
- Tracks: orderList, categoryList, universalComment, undoStack

**Draft Item Flags:**
- `_isNew` - Item added by approver (not in original PR)
- `_isDeleted` - Item marked for deletion
- `_isModified` - Item quantity/comment changed
- `_originalQuantity`, `_originalComment` - For change detection

**Draft Manager Hook (`src/hooks/useApproveNewPRDraftManager.ts`):**
- Auto-save with debounce
- Resume/discard dialogs
- `hasDraft()` - Check if meaningful changes exist

### Feature 3: Service Request Form Wizard

New step-based wizard for creating Service Requests (Work Orders) with vendor selection.

**Directory Structure:**
```
src/pages/ServiceRequests/sr-form/
├── index.tsx              # Main wizard orchestrator
├── schema.ts              # Zod validation schema
├── constants.ts           # Wizard step configuration
├── hooks/
│   ├── useSRFormData.ts   # Data fetching for categories, vendors
│   └── useSRAmendData.ts  # Amendment-specific data
├── steps/
│   ├── ServiceItemsStep.tsx  # Step 1: Select items
│   ├── VendorRatesStep.tsx   # Step 2: Select vendor, enter rates
│   └── ReviewStep.tsx        # Step 3: Final review
├── components/
│   ├── ServiceItemsAccordion.tsx  # Grouped item display
│   └── index.ts
└── amend/
    ├── SRAmendPage.tsx    # Full-page amendment
    ├── SRAmendSheet.tsx   # Sheet/drawer amendment
    ├── useSRAmendForm.ts  # Amendment form logic
    ├── transformers.ts    # Data conversion utilities
    └── index.ts
```

**Routes Added:**
- `/service-requests/new/:projectId` - New SR creation
- `/service-requests/:srId/amend` - SR amendment

### Feature 4: FormResetWarningDialog Component

**File:** `src/components/ui/form-reset-warning-dialog.tsx`

New reusable dialog for warning users about unsaved changes when navigating away. Uses `useBlocker` from react-router-dom.

**Usage:**
```tsx
<FormResetWarningDialog
    show={showWarning}
    onConfirmLeave={handleLeave}
    onCancel={handleCancel}
    title="Discard changes?"
    description="You have unsaved changes that will be lost."
/>
```

### Files Created
- `src/zustand/useApproveNewPRDraftStore.ts` - PR draft persistence
- `src/zustand/useServiceRequestDraftStore.ts` - SR draft persistence
- `src/hooks/useApproveNewPRDraftManager.ts` - PR draft manager
- `src/hooks/useServiceRequestDraftManager.ts` - SR draft manager
- `src/pages/ProcurementRequests/ApproveNewPR/hooks/useEditingLock.ts` - Lock management
- `src/pages/ProcurementRequests/ApproveNewPR/components/EditingLockIndicator.tsx` - Lock UI
- `src/components/ui/form-reset-warning-dialog.tsx` - Navigation warning dialog
- `src/pages/ServiceRequests/sr-form/**/*` - Entire SR form wizard module

### Files Modified
- `src/pages/ProcurementRequests/ApproveNewPR/ApprovePRView.tsx` - Integrated lock and draft
- `src/pages/ProcurementRequests/ApproveNewPR/hooks/useApprovePRLogic.ts` - Major refactor for draft support
- `src/pages/ServiceRequests/ServiceRequestsTabs.tsx` - Added New WO button
- `src/pages/ServiceRequests/approved-sr/ApprovedSRView.tsx` - Integrated new amend sheet
- `src/components/helpers/routesConfig.tsx` - Added SR form routes
- `src/zustand/useDialogStore.ts` - Added new dialog types
- `src/components/ui/draft-cancel-dialog.tsx` - Made title customizable

### Key Patterns

**Editing Lock with Graceful Degradation:**
```typescript
const acquireLock = async (): Promise<boolean> => {
  try {
    const result = await acquireLockApi({ pr_name: prName });
    // ...
  } catch (error) {
    // Allow editing on API failure (graceful degradation)
    return true;
  }
};
```

**Draft Item Change Tracking:**
```typescript
interface DraftItem {
  _isNew?: boolean;      // Added by approver
  _isDeleted?: boolean;  // Marked for deletion
  _isModified?: boolean; // Quantity/comment changed
  _originalQuantity?: number;
  _originalComment?: string;
}
```

**Socket.IO Lock Events:**
```typescript
socket.on('pr:editing:started', (data) => {
  if (data.pr_name === prName && data.user !== currentUser) {
    setShowLockWarning(true);
  }
});
```

---

## 2026-01-28: GST Terminology Rename & WO Options Card Revamp

### Summary
Renamed "Project GST" to "Nirmaan GST for Billing" across PO and WO/SR components. Revamped the WO Options card to include an inline GST toggle (Switch) with instant save, replacing the previous approach of bundling GST changes with the notes save dialog. Added Nirmaan GST for Billing as a read-only display in the WO Options card. Fixed missing `refNumber` in useEffect dependency arrays causing stale closures.

### Commits
- `e2f461ff` - refactor: rename "Project GST" to "Nirmaan GST for Billing" in PO payment terms
- `b882591a` - refactor: revamp WO Options card with GST toggle and Nirmaan GST display
- `98ec8c07` - fix: add missing refNumber to useEffect dependency arrays

### Key Changes

**Terminology:**
- "Project GST" → "Nirmaan GST for Billing" in all user-facing labels (PO payment terms, WO Options card)

**WO Options Card Architecture Change:**
- GST toggle extracted from edit dialog into WO Options card as an inline `Switch` component
- Toggle saves independently via `handleGstToggle` (instant save, no dialog required)
- Nirmaan GST for Billing value displayed as read-only in the Options card

**Bug Fix:**
- `refNumber` was missing from `useEffect` dependency arrays in `DocumentAttachments.tsx` and `PODetails.tsx`, causing stale closures when reference numbers changed

### Files Modified
- `src/pages/ProcurementOrders/purchase-order/components/POPaymentTermsCard.tsx` - Renamed label
- `src/pages/ServiceRequests/service-request/approved-sr.tsx` - GST toggle + Nirmaan GST display in Options card
- `src/pages/ProcurementOrders/invoices-and-dcs/DocumentAttachments.tsx` - Added refNumber to useEffect deps
- `src/pages/ProcurementOrders/purchase-order/components/PODetails.tsx` - Added refNumber to useEffect deps

---

## 2026-01-27: Project Status Lifecycle Analysis & Documentation

### Summary
Comprehensive analysis of how project statuses (Created, WIP, Halted, Completed) affect the application. Documented findings in new context files.

### Key Findings
- `ProjectSelect` component (`components/custom-select/project-select.tsx:34`) filters out Halted/Completed projects from dropdowns by default
- PR and SR/WO creation pages do NOT use `ProjectSelect` and have NO status guards
- Financial operations (New Inflow Payment, New Project Invoice) intentionally bypass filter with `all={true}`
- Backend: Design Tracker blocks Halted/Completed; Progress reports exclude Completed
- No hard backend API validation exists for any status

### Context Files Created
- `.claude/context/domain/projects.md` (backend) - Status lifecycle, backend effects, gotchas
- `frontend/.claude/context/domain/projects.md` - Frontend status behavior, ProjectSelect usage map, impact matrix

### Context Files Updated
- `.claude/context/_index.md` - Added projects domain reference
- `.claude/context/workflows.md` - Added Project Status Lifecycle section
- `frontend/.claude/context/_index.md` - Added projects domain reference + directory tree

---

## 2026-01-27: DC/MIR Reference Numbers + DCs Column in Material Usage

### Summary
Added DC/MIR reference number capture and display across upload dialogs, attachment tables, and PO reconcile reports. Added a new "DCs" column to the Project Material Usage table showing delivery challan counts per item with a popover for details. Simplified PO reports by removing separate payments fetch.

### Commits
- `0069d8ac` - feat: add attachment_ref field to Nirmaan Attachments doctype
- `fe8999e1` - feat: add DC/MIR reference number capture and display
- `907e24b7` - feat: show attachment ref numbers in PO reconcile report
- `f08276bf` - refactor(reports): use PO amount_paid instead of separate payments fetch
- `e9a8561e` - feat: add DCs column to project material usage table

### Files Created
- `src/pages/projects/components/DCCountCell.tsx` - Popover component showing DC count badge (gray "0" or amber truck icon) with table of DC details (DC No, Uploaded On, View link)

### Files Modified

**Upload Dialogs (ref number input):**
- `src/pages/DeliveryChallansAndMirs/DeliveryChallansAndMirs.tsx` - Added refNumber state, input field, display in view dialog
- `src/pages/ProcurementOrders/invoices-and-dcs/DocumentAttachments.tsx` - Same pattern
- `src/pages/ProcurementOrders/purchase-order/components/PODetails.tsx` - Same pattern

**Attachment Tables (ref number column):**
- `src/pages/ProcurementOrders/invoices-and-dcs/components/DeliveryChallanTable.tsx` - Added "Ref No." column
- `src/pages/ProcurementOrders/purchase-order/components/POAttachments.tsx` - Added "DC No." column

**PO Reconcile Report (ref number in popovers):**
- `src/pages/reports/components/columns/poAttachmentReconcileColumns.tsx` - DC No/MIR No columns in popovers
- `src/pages/reports/hooks/usePOAttachmentReconcileData.ts` - Fetch and map attachment_ref

**PO Reports Simplification:**
- `src/pages/reports/hooks/usePOReportsData.ts` - Removed ProjectPayments fetch, use po.amount_paid directly

**Material Usage Table (DCs column):**
- `src/pages/projects/components/ProjectMaterialUsageTab.tsx` - Added deliveryChallans/dcCount to interface + CSV export
- `src/pages/projects/hooks/useMaterialUsageData.ts` - DC attachment fetch, dcByPOMap, merge into items
- `src/pages/projects/components/VirtualizedMaterialTable.tsx` - Header + totalColumns update
- `src/pages/projects/components/MaterialTableRow.tsx` - DCCountCell rendering

---

## 2026-01-23: Vendor Invoices Frontend Integration

### Summary
Updated invoice reconciliation UI to work with new Vendor Invoices doctype. Replaced Ant Design Radio.Group tabs with custom button tabs, added invoice rejection dialog, and fixed various data resolution issues.

### Frontend Files Created
- `src/hooks/useDocumentInvoiceTotals.ts` - Hook for fetching document invoice totals
- `src/pages/tasks/invoices/components/InvoiceRejectionDialog.tsx` - Dialog for invoice rejection with reason
- `src/types/NirmaanStack/VendorInvoice.ts` - TypeScript interface for Vendor Invoice

### Frontend Files Modified

**Tab Styling (Ant Design → Custom Buttons):**
- `src/pages/tasks/invoices/InvoiceReconciliationContainer.tsx`:
  - Replaced Ant Design `Radio.Group` with custom button tabs
  - Renamed "Pending Tasks" → "Pending Invoice Approvals"
  - Renamed "Task History" → "Invoice Action History"
  - Added tab option constants to `constants.ts`

**Bug Fix - Invoice ID Resolution:**
- `src/pages/tasks/invoices/components/PoInvoices.tsx`:
  - Removed `.map()` that was overwriting `entry.name` with composite key
  - Now uses actual Vendor Invoice docname (e.g., `VI-2026-00001`)

- `src/pages/tasks/invoices/components/SrInvoices.tsx`:
  - Same fix as PoInvoices.tsx

**Bug Fix - "Invoice Uploaded By" Column:**
- `src/pages/reports/hooks/usePO2BReconcileData.ts`:
  - Changed `updated_by` → `uploaded_by` to match backend API response

- `src/pages/reports/hooks/useSR2BReconcileData.ts`:
  - Same fix as PO2B hook

**Invoice Task Tables:**
- `src/pages/tasks/invoices/components/PendingTasksTable.tsx` - Updated for Vendor Invoices
- `src/pages/tasks/invoices/components/TaskHistoryTable.tsx` - Updated for Vendor Invoices
- `src/pages/tasks/invoices/components/columns.tsx` - Updated column definitions
- `src/pages/tasks/invoices/config/InvoiceTaskTable.config.ts` - Updated config
- `src/pages/tasks/invoices/hooks/useInvoiceTasks.ts` - Updated data fetching
- `src/pages/tasks/invoices/hooks/useInvoiceTaskActions.ts` - Updated approval/rejection actions
- `src/pages/tasks/invoices/hooks/useInvoiceReconciliation.ts` - Updated reconciliation logic

**PO/SR Attachments:**
- `src/pages/ProcurementOrders/invoices-and-dcs/DocumentAttachments.tsx` - Invoice totals display
- `src/pages/ProcurementOrders/invoices-and-dcs/components/InvoiceDialog.tsx` - Create/edit Vendor Invoices
- `src/pages/ProcurementOrders/invoices-and-dcs/components/InvoiceTable.tsx` - Display Vendor Invoices
- `src/pages/ProcurementOrders/purchase-order/components/POAttachments.tsx` - Invoice integration
- `src/pages/ServiceRequests/service-request/SRAttachments.tsx` - Invoice integration

**Reports:**
- `src/pages/reports/hooks/usePOReportsData.ts` - Updated for new data structure
- `src/pages/reports/hooks/useSRReportsData.ts` - Updated for new data structure
- `src/pages/reports/hooks/useProjectReportCalculations.ts` - Updated calculations
- `src/pages/reports/hooks/useVendorLedgerCalculations.ts` - Updated calculations

### Key Pattern - Custom Button Tabs (replacing Ant Design Radio.Group)

```tsx
// constants.ts
export const INVOICE_TASK_TAB_OPTIONS = [
  { label: "Pending Invoice Approvals", value: "pending" },
  { label: "Invoice Action History", value: "history" },
] as const;

// Component
<div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
  <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
    {taskTabs.map((option) => (
      <button
        key={option.value}
        onClick={() => onClick(option.value)}
        className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded
          transition-colors flex items-center gap-1.5 whitespace-nowrap
          ${tab === option.value
            ? "bg-sky-500 text-white"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
      >
        {option.label}
      </button>
    ))}
  </div>
</div>
```

### Bug Fix - Invoice ID Resolution

**Before (broken):**
```typescript
return entries.map((entry, index) => ({
    ...entry,
    name: `${entry.procurement_order}-${entry.invoice_no}-${index}` // Generated composite key
}));
```

**After (fixed):**
```typescript
// Backend returns actual Vendor Invoice `name` field - do NOT overwrite it
return entries;
```

### Commit
- `eb729064` - feat(invoices): implement Vendor Invoices doctype with approval workflow

---

## 2026-01-21: Invoice Reconciliation N/A Status

### Summary
Added "Not Applicable" (N/A) as a fourth reconciliation status for GST 2B reconciliation on invoices. N/A invoices are excluded from reconciliation metrics and displayed with a distinct slate-colored badge. Summary cards now show "(X N/A excluded)" footnote when applicable.

### Files Modified

**Constants & Types:**
- `src/pages/tasks/invoices/constants.ts`:
  - Added `"na"` to `ReconciliationStatus` type: `"" | "partial" | "full" | "na"`
  - Added option to `RECONCILIATION_STATUS_OPTIONS`: `{ label: "Not Applicable", value: "na" }`

**ReconciliationDialog:**
- `src/pages/tasks/invoices/components/ReconciliationDialog.tsx`:
  - Added `"na"` to `InternalSelectValue` type
  - Added N/A option to `INTERNAL_STATUS_OPTIONS`
  - Updated `handleStatusChange`: N/A clears proof/amount fields (same as "none")
  - Added help text: "Use 'Not Applicable' for invoices that don't require 2B reconciliation"

**Invoice Components:**
- `src/pages/tasks/invoices/components/PoInvoices.tsx`:
  - Updated `dynamicSummary` to track `totalNotApplicable` and `totalNotApplicableAmount` separately
  - N/A invoices excluded from pending and reconciled counts
  - Added slate-colored N/A badge: `bg-slate-100 text-slate-600`
  - Added "(X N/A excluded)" footnote to Reconciled summary card

- `src/pages/tasks/invoices/components/SrInvoices.tsx`:
  - Same changes as PoInvoices.tsx

**Table Config Files (Facet Filters):**
- `src/pages/tasks/invoices/config/poInvoicesTable.config.ts` - Added N/A option
- `src/pages/tasks/invoices/config/srInvoicesTable.config.ts` - Added N/A option
- `src/pages/reports/config/po2BReconcileTable.config.ts` - Added `{ label: "N/A", value: "N/A" }`
- `src/pages/reports/config/sr2BReconcileTable.config.ts` - Added N/A option

**Report Components:**
- `src/pages/reports/components/PO2BReconcileReport.tsx`:
  - Updated `dynamicSummary` to track N/A separately
  - Added "(X N/A excluded)" footnote to Reconciled card

- `src/pages/reports/components/SR2BReconcileReport.tsx`:
  - Same changes as PO2BReconcileReport.tsx

**Report Columns:**
- `src/pages/reports/components/columns/po2BReconcileColumns.tsx` - Added N/A case to accessor, cell, export
- `src/pages/reports/components/columns/sr2BReconcileColumns.tsx` - Added N/A case

**Data Hooks:**
- `src/pages/reports/hooks/usePO2BReconcileData.ts` - Updated local `ReconciliationStatus` type
- `src/pages/reports/hooks/useSR2BReconcileData.ts` - Updated local `ReconciliationStatus` type
- `src/pages/tasks/invoices/hooks/useInvoiceReconciliation.ts` - Added `"na": "Not Applicable"` to status labels

### Key Pattern: 4-State Reconciliation

```typescript
// ReconciliationStatus type
type ReconciliationStatus = "" | "partial" | "full" | "na";

// N/A is NOT considered reconciled - separate category
} else if (entry.reconciliation_status === "na") {
    totalNotApplicable++;
    totalNotApplicableAmount += invoiceAmount;
}

// N/A badge styling (slate color)
case "na":
    return (
        <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
            N/A
        </Badge>
    );

// Summary card footnote
{totalNotApplicable > 0 && (
    <dd className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 italic">
        ({totalNotApplicable} N/A excluded)
    </dd>
)}
```

### Commits
- `30453f17` - feat(invoices): add N/A status to backend reconciliation API
- `2b2be5d9` - feat(invoices): add N/A option to reconciliation dialog and types
- `bcc19da0` - feat(invoices): add N/A status handling to invoice views
- `fc0d90b8` - feat(reports): add N/A status handling to reconcile reports

---

## 2026-01-21: Critical PO Tasks DataTable Refactoring with PR Not Released Status

### Summary
Refactored Critical PO Tasks list to use DataTable component with faceted filters. Added new "PR Not Released" status for tasks where the procurement request hasn't been released yet. Extracted utility functions and column definitions into dedicated modules.

### Files Created
- `src/pages/projects/CriticalPOTasks/config/taskTableColumns.tsx` - DataTable column definitions
- `src/pages/projects/CriticalPOTasks/utils.tsx` - Status styling, JSON parsing, progress calculation helpers

### Files Modified
- `src/pages/projects/CriticalPOTasks/CriticalPOTasksList.tsx` - Integrated DataTable with TanStack Table hooks
- `src/pages/projects/CriticalPOTasks/components/EditTaskDialog.tsx` - Added controlled mode (open/onOpenChange props), added PR Not Released status
- `src/pages/projects/CriticalPOTasks/components/TaskStatusBadge.tsx` - Added purple color scheme for PR Not Released
- `src/types/NirmaanStack/CriticalPOTasks.ts` - Updated status type
- `src/pages/CriticalPOTracker/types/index.ts` - Updated CriticalPOTaskStatus type

### Status Progression
| Status | Color | Meaning |
|--------|-------|---------|
| PR Not Released | Purple | Pre-requisite missing (PR not yet created/released) |
| Not Released | Red | Blocked (PR released but PO not created) |
| Partially Released | Yellow | In progress (some POs released) |
| Released | Green | Complete (all POs released) |
| Not Applicable | Gray | Skip (not required) |

### Commit
- `c8a4f171` - feat(critical-po-tasks): refactor list with DataTable and add PR Not Released status

---

## 2026-01-21: Multiple Critical PO Task Tagging During PO Dispatch

### Summary
Enabled multi-select for Critical PO Tasks during PO dispatch. Users can now link a single PO to multiple tasks at once, with at least one tag being compulsory when the project has Critical PO setup.

### Files Modified
- `src/pages/ProcurementOrders/purchase-order/hooks/useCriticalPOTaskLinking.ts`:
  - Changed from single-select (`selectedTask`) to multi-select (`selectedTasks[]`)
  - Added `LinkResult` type for tracking linking operation outcomes
  - Implemented `linkPOToTasks()` using `Promise.allSettled` for parallel linking
  - Added `removeTask()` handler for individual task removal
  - Category filter no longer clears task selections (allows cross-category)

- `src/pages/ProcurementOrders/purchase-order/components/CriticalPOTaskLinkingSection.tsx`:
  - Added `isMulti` to ReactSelect with amber-themed multi-value chips
  - Scrollable task list with individual remove buttons
  - Updated validation: "At least one task must be selected"
  - Badge shows "X Selected" instead of "Linked"

- `src/pages/ProcurementOrders/purchase-order/components/PODetails.tsx`:
  - Updated `handleDispatchPO` to call `linkPOToTasks()`
  - Confirmation dialog shows full details for ≤3 tasks, summary for 4+
  - Dynamic button text: "Link to X Task(s) & Dispatch"

### Key Pattern: Multi-Select with Promise.allSettled
```typescript
const linkPOToTasks = useCallback(async (): Promise<LinkResult> => {
  const results = await Promise.allSettled(
    selectedTasks.map(async (taskOption) => {
      // Link PO to each task in parallel
    })
  );
  // Separate successful and failed results
  return { success: failed.length === 0, linked, failed };
}, [selectedTasks, poName, updateDoc, mutate]);
```

### Commit
- `7ba10ac1` - feat(po-dispatch): enable multiple Critical PO Task tagging

---

## 2026-01-21: PO Overview Enhancements

### Summary
Enhanced PO details page with upload buttons, compact design, and delivery history accordion. Hide invoice-related UI from Project Manager role.

### Files Modified
- `src/pages/ProcurementOrders/purchase-order/PurchaseOrder.tsx` - Added Upload DC/MIR buttons, redesigned action buttons to compact style
- `src/pages/ProcurementOrders/purchase-order/components/PODetails.tsx` - Hide Add Invoice button and Invoices section from Project Manager
- `src/pages/ProcurementOrders/invoices-and-dcs/DocumentAttachments.tsx` - UI updates
- `src/pages/DeliveryNotes/components/DeliveryHistory.tsx` - Added accordion with update count badge

### Commit
- `98582008` - feat(po): enhance PO overview with upload buttons, compact design, and delivery history accordion

---

## 2026-01-21: Design Tracker Edit Column Fix

### Summary
Fixed Edit column in Design Tracker to be completely hidden from Project Manager role instead of rendered but disabled.

### Pattern: Conditional Column Spread
```typescript
const columns = [
  // ... other columns
  ...(role !== "Nirmaan Project Manager Profile" ? [{
    id: "edit",
    // Edit column definition
  }] : []),
];
```

### Commit
- `ead2195d` - fix(design-tracker): hide edit column from project manager role

---

## 2026-01-19: SR Comments Standalone Card with Add/Delete

### Summary
Extracted comments functionality from SRDetailsCard into a dedicated SRComments component with role-based comment creation and deletion capabilities. Uses the existing `sr_remarks` backend API.

### Files Created
- `src/pages/ServiceRequests/service-request/hooks/useSRRemarks.ts` - Hooks for SR remarks API:
  - `useSRRemarks()` - Fetch remarks with optional filter
  - `useAddSRRemark()` - Add new remark
  - `useDeleteSRRemark()` - Delete own remarks

- `src/pages/ServiceRequests/service-request/components/SRComments.tsx` - Standalone comments card with:
  - Role-based filter pills (All, Accountant, Procurement, Admin) with counts
  - Add comment form with Ctrl+Enter submit
  - Delete own comments capability
  - Timeline display with avatars and relative time

### Files Modified
- `src/pages/ServiceRequests/service-request/approved-sr.tsx`:
  - Removed `universalComments` and `usersList` data fetching
  - Removed comments props from SRDetailsCard
  - Added SRComments card after Order Details section

- `src/pages/ServiceRequests/service-request/components/SRDetailsCard.tsx`:
  - Removed Comments section (Section 5)
  - Removed `usersList`, `universalComments` props
  - Removed helper functions: `getFullName`, `getInitials`, `formatRelativeTime`, `getSubjectDotColor`

### Role-Based Comment Access
| Role | Can Add | Subject Category |
|------|---------|------------------|
| Accountant | Yes | `accountant_remark` |
| Procurement Executive | Yes | `procurement_remark` |
| Admin/PMO/Project Lead | Yes | `admin_remark` |
| Others | No | - |

All users can delete their own comments.

---

## 2026-01-19: Hide Financial Information from Project Manager in PO Details View

### Summary
Extended role-based financial data hiding to the PO Details view for users with "Nirmaan Project Manager Profile" role. Follows the pattern established in commit `53594079` (WO/PO Summary tabs).

### Files Modified
- `src/pages/ProcurementOrders/purchase-order/components/PODetails.tsx`:
  - Added `isProjectManager` check
  - Wrapped Amounts section (PO Amount Incl/Excl GST, Total Invoiced, Amount Paid, Amount Delivered) with conditional

- `src/pages/ProcurementOrders/purchase-order/components/POPdf.tsx`:
  - Hide PO render/preview section for Project Manager (Print, Download buttons were already hidden)
  - Keep "Download Without Rate" button visible for all roles

- `src/pages/ProcurementOrders/purchase-order/PurchaseOrder.tsx`:
  - Added `isProjectManager` useMemo check
  - Hide Payment Details accordion (TransactionDetailsCard, POPaymentTermsCard) entirely
  - Hide financial columns in Order Details desktop table: Rate, Tax, Amount, Amount (incl.GST)
  - Hide financial fields in Order Details mobile view: Rate, Tax, Total (incl. GST)

### What Project Managers See
| Section | Visible | Hidden |
|---------|---------|--------|
| PO Details Card | Vendor, Package, Status, Timeline | Amounts section |
| Preview Sheet | "Download Without Rate" button | Print, Download, PO render |
| Payment Details | - | Entire accordion hidden |
| Order Details | S.No., Item Name, Unit, Qty, Delivered Qty | Rate, Tax, Amount, Amount (incl.GST) |

---

## 2026-01-19: SR Summary and ApprovedSR Consolidation

### Summary
Consolidated the separate sr-summary.tsx and ApprovedSR components into a unified view with role-based feature visibility. Users no longer need to click "View Order" to access full features.

### Files Created
- `src/pages/ServiceRequests/service-request/components/SRDetailsCard.tsx` - Reusable sectioned card component with Header, Info (Project|Package|Vendor), Amounts (color-coded), Timeline, Comments (collapsible), and Actions sections

### Files Modified
- `src/pages/ServiceRequests/service-request/approved-sr.tsx`:
  - Integrated SRDetailsCard component
  - Added Nirmaan Comments fetch for comments section
  - Added Nirmaan Users fetch for commenter names
  - Cleaned up unused imports (Badge, VendorHoverCard, Eye, PencilRuler, etc.)

- `src/components/helpers/routesConfig.tsx`:
  - Changed index route for `:srId` to use ApprovedSR directly
  - Removed `/order-view` route (no longer needed)

- `src/pages/ServiceRequests/service-request/list-sr.tsx`:
  - Updated link from `${item.name}/order-view` to `${item.name}`

- `src/pages/projects/components/ProjectSRSummaryTable.tsx`:
  - Updated link from `/service-requests-list/${sr.name}/order-view` to `/service-requests-list/${sr.name}`

- `src/pages/vendors/components/LedgerTableRow.tsx`:
  - Updated SR links to remove `/order-view`

### Files Retired
- `src/pages/Retired Components/sr-summary.tsx` - Original component with all code commented out and documentation header

### Route Changes
- **Before:** `/service-requests-list/:srId` → sr-summary.tsx (read-only), `/service-requests-list/:srId/order-view` → ApprovedSR (full management)
- **After:** `/service-requests-list/:srId` → ApprovedSR (unified view with role-based features)

### Role-Based Access (preserved from ApprovedSR)
| Feature | PM / Estimates | Admin / PMO / Others |
|---------|---------------|---------------------|
| View SR Details | ✓ | ✓ |
| PDF Preview | ✓ | ✓ |
| Delete/Amend/Invoice/Payment | ✗ | ✓ |

---

## 2026-01-17: Customer Page UI Revamp & Nickname Feature

### Summary
Complete redesign of the Customer detail page with enterprise-grade components, migration from Ant Design to shadcn Tabs, addition of customer filtering for Project Invoices, and new customer_nickname field across the system.

### Files Modified

**Customer Page UI (Phase 1-2):**
- `src/pages/customers/customer.tsx`:
  - Replaced Ant Design `ConfigProvider/Menu` with shadcn `Tabs` component
  - Added lucide icons (LayoutDashboard, Receipt) for tab visual enhancement
  - Simplified handlers: `mainTabClick` → `handleMainTabChange`
  - Display customer nickname alongside company name in header

- `src/pages/customers/CustomerOverview.tsx`:
  - Complete redesign following `UserOverviewTab.tsx` patterns
  - Added `StatCard` component with hover effects and gradient overlays
  - Added `InfoItem` component following icon + label + value pattern
  - Created gradient header card with overlapping Building2 icon
  - Display customer stats: Total Projects, Active Projects, Days as Customer
  - Replaced Ant Radio.Group with shadcn Tabs for sub-navigation
  - Added new "Invoices" tab for customer-scoped project invoices

**Project Invoices Customer Filtering (Phase 3):**
- `src/pages/ProjectInvoices/config/projectInvoices.config.tsx`:
  - Added `getProjectInvoiceStaticFilters()` helper function
  - Added `hideCustomerColumn` option to column generator
  - Conditionally hide customer column when viewing from customer context

- `src/pages/ProjectInvoices/AllProjectInvoices.tsx`:
  - Destructured and wired up `customerId` prop
  - Used static filters helper for `additionalFilters`
  - Pass `customerName` to summary card for context display

**Customer Nickname Feature:**
- `nirmaan_stack/doctype/customers/customers.json`:
  - Added `customer_nickname` field (Data, required, in_list_view)

- `src/types/NirmaanStack/Customers.ts`:
  - Added `customer_nickname: string` to interface

- `src/pages/customers/add-new-customer.tsx`:
  - Added nickname field with validation (2-30 chars)
  - Fixed validation message typo: "Employee Name" → "Company Name"

- `src/pages/customers/edit-customer.tsx`:
  - Added nickname field with change detection

- `src/pages/customers/customers.constants.ts`:
  - Added nickname to `CUSTOMER_LIST_FIELDS_TO_FETCH`
  - Added nickname to `CUSTOMER_SEARCHABLE_FIELDS`

- `src/pages/customers/customers.tsx`:
  - Added Nickname column to customers list table

**Customer Statistics API:**
- `nirmaan_stack/api/customers/customer_stats.py` (NEW):
  - Added `get_customer_stats()` whitelisted API
  - Returns total, by_state breakdown, with/without projects, recent_30_days

- `src/pages/customers/components/CustomersSummaryCard.tsx`:
  - Complete redesign with state-based color pills
  - Integrated with customer_stats API
  - Added expandable dropdown for state breakdown

**Documentation:**
- `.claude/context/_index.md` - Added customers domain reference
- `.claude/context/domain/customers.md` (NEW) - Customer management docs

### Design Patterns Established

**Enterprise Minimalist Info Cards:**
```tsx
<InfoItem
  icon={<Building2 className="h-4 w-4" />}
  label="Company Name"
  value={data?.company_name}
/>
```

**Stat Cards with Hover Effects:**
```tsx
<StatCard
  icon={<FolderKanban className="h-5 w-5" />}
  label="Total Projects"
  value={totalProjectCount ?? 0}
  colorClass="text-blue-600"
/>
```

**Conditional Column Hiding:**
```typescript
getProjectInvoiceColumns({
  hideCustomerColumn: !!customerId, // Hide when in customer context
})
```

---

## 2026-01-16: WebSocket Documentation Added

### Summary
Created comprehensive context documentation for Socket.IO real-time integration between Frappe backend and React frontend.

### Files Modified

- `.claude/context/websocket.md` - **NEW**
  - Architecture overview diagram
  - Key files reference table
  - Development proxy setup details
  - Complete event naming convention table (20+ events)
  - Backend event publishing pattern with commit-before-publish rule
  - Frontend event handling flow (SocketInitializer -> socketListeners -> eventListeners)
  - Notification store structure and methods
  - Step-by-step guide for adding new event types
  - Debugging tips and common issues

- `.claude/context/_index.md`
  - Added websocket.md to Available Context Files table
  - Updated Directory Structure to include websocket.md

### Key Patterns Documented

1. **Event naming**: `{doctype}:{action}` (e.g., `pr:new`, `po:amended`)
2. **Critical rule**: Always `frappe.db.commit()` BEFORE `publish_realtime()` to avoid race conditions
3. **Event flow**: Backend publishes -> Socket.IO -> Frontend listeners -> Fetch notification doc -> Update Zustand store
4. **Deduplication**: Notification store checks for existing notifications by `name` before adding

---

## 2026-01-15: Dispatch PO - Mandatory Critical Task Linking

### Summary
Made Critical PO Task selection mandatory during PO dispatch when the PO is not already linked to any task. Removed status selection from the flow and enhanced UI with clear validation feedback.

### Files Modified

- `src/pages/ProcurementOrders/purchase-order/hooks/useCriticalPOTaskLinking.ts`:
  - Added `isPoAlreadyLinked` computed value to check if PO is linked to any task
  - Removed `selectedStatus` and `setSelectedStatus` (status no longer updated on link)
  - Updated `linkPOToTask()` to only associate PO without changing task status

- `src/pages/ProcurementOrders/purchase-order/components/CriticalPOTaskLinkingSection.tsx`:
  - Added "REQUIRED" badge (pulsing red) when task selection is mandatory
  - Badge changes to "LINKED" (emerald) once task is selected
  - Red border/ring highlight when validation fails
  - Task dropdown styled with red border and asterisk when mandatory
  - Added validation error message box when no task selected
  - Removed status selection buttons (no longer needed)

- `src/pages/ProcurementOrders/purchase-order/components/PODetails.tsx`:
  - Updated button disabled condition: `hasCriticalPOSetup && !selectedTask && !isPoAlreadyLinked`
  - Added footer warning banner explaining why dispatch is disabled
  - Disabled button styled with gray background for clarity
  - Removed skip linking warning dialog (no longer applicable)
  - Moved Critical PO Tag to new row below Vendor/Package/Status info

### Validation Logic

| Condition | Dispatch Button |
|-----------|-----------------|
| No critical PO setup | ✅ Enabled |
| Setup exists + task selected | ✅ Enabled |
| Setup exists + PO already linked | ✅ Enabled |
| Setup exists + PO NOT linked + no task | ❌ Disabled |

### Key Decisions

- **No status update on link**: Previously linking updated the task's status. Now it only associates the PO to preserve manual status control.
- **Skip dialog removed**: Since task selection is now enforced via disabled button, the "dispatch without linking" option is removed.

---

## 2026-01-15: Design Tracker V2 UI Overhaul

### Summary
Redesigned the Project Design Tracker page with compact header, DataTable integration with faceted filters, and enhanced dialogs with enterprise minimal theme.

### Files Modified

- `src/pages/ProjectDesignTracker/project-design-tracker-details.tsx`:
  - Consolidated 4 header sections into 2 compact rows (~100px vs ~280px)
  - Added "Design Tracker" eyebrow label for page identification
  - Integrated zone navigation bar with task counts and action buttons
  - Redesigned Add Category modal with flat grid layout and selection summary
  - Redesigned Add Zone modal with 3-section layout (current/add/preview)
  - Updated Create Task modal to auto-fill zone from active tab
  - Fixed bug: "Not Applicable" status tasks now visible in table

- `src/pages/ProjectDesignTracker/config/taskTableColumns.tsx` (NEW):
  - Column definitions for DataTable with faceted filters
  - Custom filter functions for multi-select and date range filtering
  - Optimized column widths for 16:9 screens

- `src/pages/ProjectDesignTracker/components/TaskEditModal.tsx`:
  - Enhanced header with labeled context (Zone, Category, Task name)
  - Updated button styling to match brand colors (red-600)

- `src/pages/ProjectDesignTracker/utils.tsx`:
  - Updated `getAssignedNameForDisplay()` to render badges instead of list
  - Standardized date format to `dd-MMM-yyyy`

- `src/pages/projects/project.tsx`:
  - Updated import to use `ProjectDesignTrackerDetailV2` component

### UI Patterns Established

**Compact Header Bar:**
```
Row 1: [Page Type Label] Project Name | Meta Pills | Action Buttons
Row 2: Zone Tabs with counts | Create/Export Actions
```

**Dialog 3-Section Layout (Add Zone):**
```
1. Current State (read-only display)
2. Add New (input + pending items)
3. Preview (combined result)
```

**Auto-fill Context Pattern:**
When opening modal from contextual location (e.g., zone tab), pre-fill relevant fields as read-only.

---

## 2026-01-14: Project Manager Access & Summary Card Restrictions

### Summary
Expanded Project Manager role access to Projects page while restricting visibility of financial summary cards based on role.

### Files Modified

- `src/components/layout/NewSidebar.tsx`:
  - Added `Nirmaan Project Manager Profile` to Projects sidebar menu condition
  - PM now has Projects in sidebar alongside PL, Procurement, and Accountant

- `src/components/layout/dashboards/dashboard-pm.tsx`:
  - Added "Projects" card to "Other Options" section
  - Uses `BlendIcon` for visual consistency with sidebar

- `src/pages/projects/projects.tsx`:
  - Added `SUMMARY_CARD_ROLES` constant (Admin, PMO only)
  - Added `canViewSummaryCard` check using `user_id` and role
  - Projects summary card (total/status counts) now hidden for non-Admin/PMO users

- `src/pages/projects/project.tsx`:
  - Added `isProjectManager` role check
  - Pass `hideSummaryCard={isProjectManager}` to summary table components

- `src/pages/projects/components/ProjectSRSummaryTable.tsx`:
  - Added `hideSummaryCard?: boolean` prop to interface
  - Wrapped summary card with conditional `{!hideSummaryCard && ...}`

- `src/pages/projects/components/ProjectPOSummaryTable.tsx`:
  - Added `hideSummaryCard?: boolean` prop to interface
  - Changed `summaryCard` prop to `summaryCard={hideSummaryCard ? undefined : ...}`

### Pattern: Role-Based Summary Card Visibility

```typescript
// In parent component (project.tsx)
const isProjectManager = role === "Nirmaan Project Manager Profile";

<ProjectSRSummaryTable projectId={projectId} hideSummaryCard={isProjectManager} />
<ProjectPOSummaryTable projectId={projectId} hideSummaryCard={isProjectManager} />

// In child component
interface Props {
  projectId: string | undefined;
  hideSummaryCard?: boolean;
}

// For direct rendering
{!hideSummaryCard && <Card>...</Card>}

// For DataTable summaryCard prop
summaryCard={hideSummaryCard ? undefined : <Card>...</Card>}
```

### Access Matrix Update

| Feature | Admin | PMO | PL | PM | Procurement | Accountant |
|---------|:-----:|:---:|:--:|:--:|:-----------:|:----------:|
| Projects Sidebar | Y | Y | Y | Y | Y | Y |
| Projects Summary Card | Y | Y | - | - | - | - |
| WO/PO Summary Cards | Y | Y | Y | - | Y | Y |

---

## 2026-01-14: Project Makes Management Refactoring

### Summary
Refactored project makes management by removing makes configuration from edit project form and revamping the dedicated Project Makes tab with enterprise minimalist UI.

### Files Modified

- `src/pages/projects/edit-project-form.tsx`:
  - Revamped WorkPackageSelection component with 2-column grid layout
  - Added "Select All" header with selection counter ("X of Y selected")
  - Removed Category & Makes Configuration section (functionality moved to Project Makes tab)
  - Added info banner directing users to Project Makes tab
  - Cleaned up unused imports (Controller, ReactSelect, Users)
  - Added proper TypeScript types for component props

- `src/pages/projects/ProjectMakesTab.tsx`:
  - Replaced Ant Design `Radio.Group` with custom segmented button control
  - Added horizontal `ScrollArea` for work package selector overflow
  - Replaced `TailSpin` spinner with `Skeleton` loading states
  - Redesigned table with CSS Grid layout and compact styling
  - Added progressive disclosure (edit button appears on row hover)
  - Improved empty state with centered icon and helpful message
  - Added footer showing category/makes count summary
  - Modernized edit dialog with two-column context panel
  - Styled ReactSelect to match enterprise theme

### Pattern: Enterprise Minimalist Segmented Control

Replace Ant Design Radio.Group with native buttons:
```tsx
<div className="flex gap-1.5">
  {options.map((option) => (
    <button
      key={option.value}
      onClick={() => setSelected(option.value)}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border",
        selected === option.value
          ? "bg-gray-900 text-white border-gray-900 shadow-sm"
          : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
      )}
    >
      {selected === option.value && <Check className="h-3.5 w-3.5" />}
      {option.label}
    </button>
  ))}
</div>
```

### Pattern: Progressive Disclosure Table Actions

Show actions on row hover for cleaner UI:
```tsx
<div className="... group">
  {/* Row content */}
  <Button
    className="opacity-0 group-hover:opacity-100 transition-opacity"
  >
    <Pencil className="h-3.5 w-3.5" />
  </Button>
</div>
```

---

## 2026-01-13: Critical PO Tasks Mobile Responsiveness

### Summary
Enhanced the Critical PO Tasks list with mobile-responsive design: card-based layout for mobile, horizontal-scrolling table for desktop, and improved filter controls.

### Files Modified

- `src/pages/projects/CriticalPOTasks/CriticalPOTasksList.tsx`:
  - Added `TaskMobileCard` component for mobile view with collapsible linked POs
  - Split layout: card view for mobile (`sm:hidden`), table for desktop (`hidden sm:block`)
  - Made filters stack vertically on mobile (`flex-col sm:flex-row`)
  - Changed table column widths from percentage (`w-[15%]`) to minimum widths (`min-w-[150px]`)
  - Added horizontal scroll container for desktop table (`overflow-x-auto`)
  - Added dropdown menu for mobile task actions (Edit, Link PO)

- `src/pages/projects/CriticalPOTasks/components/LinkedPOsColumn.tsx`:
  - Added `max-w-[140px]` and `truncate` to PO link badges for overflow handling

### Pattern: Mobile-First Responsive Tables

For complex tables with many columns:
```tsx
{/* Mobile: Card layout */}
<div className="sm:hidden space-y-3">
  {items.map(item => <MobileCard key={item.id} item={item} />)}
</div>

{/* Desktop: Table with horizontal scroll */}
<div className="hidden sm:block overflow-x-auto">
  <Table>
    <TableHeader>
      <TableHead className="min-w-[150px]">Column</TableHead>
      {/* Use min-w instead of percentage widths */}
    </TableHeader>
    {/* ... */}
  </Table>
</div>
```

---

## 2026-01-13: Nirmaan Role Permissions Sync

### Summary
Added missing Nirmaan role permissions to 55 doctypes, ensuring all 9 Nirmaan roles have access across the entire app.

### Files Created

**Backend Patch:**
- `nirmaan_stack/patches/v2_8/add_missing_nirmaan_role_permissions.py` - Database patch to add missing permissions

**Utility Script:**
- `scripts/analyze_doctype_permissions.py` - Standalone script to analyze and fix doctype permissions in JSON files

### Changes
- 45 doctypes: Added Nirmaan HR Executive, Nirmaan PMO Executive
- 7 doctypes: Added above + Nirmaan Design Lead
- 3 doctypes: Added all 9 roles (had none before):
  - Auto Approval Counter Settings
  - Material Delivery Plan
  - TDS Repository

### Nirmaan Roles (9 total)
1. Nirmaan Accountant
2. Nirmaan Design Executive
3. Nirmaan Design Lead
4. Nirmaan Estimates Executive
5. Nirmaan HR Executive
6. Nirmaan PMO Executive
7. Nirmaan Procurement Executive
8. Nirmaan Project Lead
9. Nirmaan Project Manager

---

## 2026-01-13: PO Attachment Reconciliation Report

### Summary
Added new report for Delivered/Partially Delivered POs showing attachment counts (Invoices, DCs, MIRs) with mismatch highlighting and filtering capabilities.

### Features
- **Dynamic summary cards** - Recalculate based on applied table filters
- **Attachment count popovers** - Click to view Invoice/DC/MIR details in table format
- **Mismatch highlighting** - Rows where Invoice count ≠ DC count are highlighted in amber
- **Mismatch filter toggle** - "Show only" switch to filter mismatched rows
- **Mobile-responsive design** - Compact summary for mobile, expanded for desktop

### Files Added
- `src/pages/reports/components/POAttachmentReconcileReport.tsx` - Main report component
- `src/pages/reports/components/columns/poAttachmentReconcileColumns.tsx` - Column definitions with popovers
- `src/pages/reports/config/poAttachmentReconcileTable.config.ts` - Table configuration
- `src/pages/reports/hooks/usePOAttachmentReconcileData.ts` - Data fetching hook

### Files Modified
- `src/pages/reports/ReportsContainer.tsx` - Added route
- `src/pages/reports/components/POReports.tsx` - Added tab
- `src/pages/reports/store/useReportStore.ts` - Added report type
- `src/config/queryKeys.ts` - Added `po_amount_delivered` field

### Pattern: Hidden Column for Computed Filters
```typescript
// Add hidden column for computed filter values
{
    id: "isMismatched",
    accessorFn: (row) => row.invoiceCount !== row.dcCount ? "yes" : "no",
    header: () => null,
    cell: () => null,
    filterFn: facetedFilterFn,
    meta: { hidden: true },
}

// Toggle filter programmatically
const mismatchColumn = table.getColumn("isMismatched");
mismatchColumn?.setFilterValue(showOnly ? ["yes"] : undefined);
```

---

## 2026-01-13: DataTable getRowClassName Prop

### Summary
Added `getRowClassName` callback prop to DataTable component for conditional row styling.

### Files Modified
- `src/components/data-table/new-data-table.tsx`

### Usage Pattern
```typescript
<DataTable
    getRowClassName={(row) => {
        if (row.original.hasError) {
            return "bg-red-50 hover:bg-red-100";
        }
        return undefined;
    }}
/>
```

---

## 2026-01-13: PO2B Reconcile Report Dynamic Summary

### Summary
Enhanced PO2B Reconcile Report with dynamic summary that recalculates based on applied filters.

### Files Modified
- `src/pages/reports/components/PO2BReconcileReport.tsx`

### Pattern: Dynamic Summary from Filtered Data
```typescript
const fullyFilteredData = table.getFilteredRowModel().rows.map(r => r.original);

const dynamicSummary = useMemo(() => ({
    totalCount: fullyFilteredData.length,
    totalAmount: fullyFilteredData.reduce((sum, row) => sum + row.amount, 0),
}), [fullyFilteredData]);
```

---

## 2026-01-13: Fix CSRF Token Error on HR Executive Login

### Summary
Fixed CSRFTokenError that occurred when logging in as HR Executive. The HR Dashboard was making POST requests before the CSRF token was available.

### Root Cause
- `useFrappePostCall` makes POST requests which require CSRF tokens
- The `useEffect` with empty dependency array fired immediately on component mount
- After login redirect, the CSRF token cookie may not be synchronized yet
- Result: Multiple API calls failed with `CSRFTokenError`

### Solution
Changed from `useFrappePostCall` (POST) to `useFrappeGetCall` (GET) for the read-only `get_user_role_counts` API. GET requests don't require CSRF token validation.

### Files Modified

- `src/components/layout/dashboards/dashboard-hr.tsx`:
  - Changed import from `useFrappePostCall` to `useFrappeGetCall`
  - Removed manual state management (`useState` for roleCounts, isLoading, error)
  - Removed `useEffect` that called the API on mount
  - Replaced with SWR-based `useFrappeGetCall` hook which handles request timing automatically

### Pattern: Avoiding CSRF Issues

**Use GET for read-only operations:**
```typescript
// ❌ POST - requires CSRF token, may fail on initial load
const { call } = useFrappePostCall("api.method");
useEffect(() => { call({}); }, []);

// ✅ GET - no CSRF required, SWR handles timing
const { data, isLoading, error } = useFrappeGetCall("api.method");
```

**When to use each:**
- `useFrappeGetCall` - Read-only data fetching (counts, lists, lookups)
- `useFrappePostCall` - Data mutations (create, update, delete)

---

## 2026-01-12: Project Creation Dialog Layout Fix and Customer PO Button

### Summary
Fixed button overflow in project creation success dialog and added "Add Customer PO" navigation option.

### Files Modified

- `src/components/ui/project-creation-dialog.tsx`:
  - Increased dialog width from `sm:max-w-md` to `sm:max-w-lg`
  - Changed footer layout from horizontal flex to 2x2 grid (`grid grid-cols-1 sm:grid-cols-2`)
  - Added `onAddCustomerPO` prop and corresponding button
  - Center-aligned all action buttons with `justify-center`

- `src/pages/projects/project-form/index.tsx`:
  - Added `handleAddCustomerPO` handler navigating to project overview page
  - Passed new prop to `ProjectCreationDialog`

### UI Pattern
Dialog with multiple actions (4+ buttons) should use grid layout instead of horizontal flex to prevent overflow.

---

## 2026-01-12: Critical PO Task Linking in PO Dispatch Workflow

### Summary
Added ability to link Purchase Orders to Critical PO Tasks during dispatch, with enterprise minimalist redesign of the dispatch sheet.

### Files Created

**Hook:**
- `src/pages/ProcurementOrders/purchase-order/hooks/useCriticalPOTaskLinking.ts` - Manages linking state, fetches tasks for project, provides category/task options, handles linking logic

**Components:**
- `src/pages/ProcurementOrders/purchase-order/components/CriticalPOTaskLinkingSection.tsx` - React-select dropdowns for category/task selection, shows selected task details, linked POs with hover cards, status selection
- `src/pages/ProcurementOrders/purchase-order/components/LinkedCriticalPOTag.tsx` - Tag displayed below PO status showing linked Critical PO Task with edit/unlink options
- `src/pages/ProcurementOrders/purchase-order/components/POItemsHoverCard.tsx` - Hover card component for displaying PO items

### Files Modified

- `src/pages/ProcurementOrders/purchase-order/components/PODetails.tsx`:
  - Added Critical PO Task linking hook and state
  - Updated `handleDispatchPO` to include linking logic
  - Added `LinkedCriticalPOTag` below status badge
  - Revamped Sheet content with enterprise minimalist design
  - Added confirmation dialogs for linking and skip scenarios
  - Added Delivery Contact collapsible section

### Key Features
- Check if Critical PO setup exists for project before showing linking options
- Searchable category and task dropdowns using react-select
- Auto-set category when task is selected directly
- Status selection: "Partially Released" or "Released"
- Show which other POs are already linked to selected task
- ItemsHoverCard integration for viewing linked PO contents
- Confirmation flows for linking and skipping without linking

### Technical Notes

**React-Select in Radix Sheet:**
Use `menuPosition="fixed"` instead of `menuPortalTarget={document.body}` to avoid focus trap blocking clicks.

**filterOption data path:**
In react-select's filterOption, `option.data` is TaskOption, `option.data.data` is CriticalPOTask.

---

## 2026-01-12: Critical PO Tracker Cross-Project Dashboard

### Summary
Created a new cross-project PO Tracker dashboard page that displays aggregated Critical PO Task statistics across all projects.

### Files Created

**Frontend Module (`src/pages/CriticalPOTracker/`):**
- `critical-po-tracker-list.tsx` - Main list page with project cards grid, search, and refresh
- `index.tsx` - Barrel export
- `components/CriticalPOProjectCard.tsx` - Card component showing progress circle, release stats, and status breakdown
- `types/index.ts` - TypeScript interfaces (ProjectWithCriticalPOStats, StatusCounts, CriticalPOTaskStatus)
- `utils.ts` - Status styling utilities (getStatusStyle, getProgressColor, STATUS_DISPLAY_ORDER)

**Backend API (`nirmaan_stack/api/critical_po_tasks/`):**
- `get_projects_with_stats.py` - Aggregates Critical PO Task stats by project (excludes "Not Applicable" status from metrics)

### Files Modified

- `src/components/helpers/routesConfig.tsx` - Added `/critical-po-tracker` route
- `src/components/layout/NewSidebar.tsx` - Added "PO Tracker" menu item, route mappings
- `src/pages/projects/project.tsx` - Fixed URL query param race condition for Critical PO tab navigation

### Access Control
Roles with access: Admin, PMO Executive, Project Lead, Project Manager, Procurement Executive

### API Endpoint
```python
# GET /api/method/nirmaan_stack.api.critical_po_tasks.get_projects_with_stats.get_projects_with_critical_po_stats
# Returns: [{ project, project_name, total_tasks, released_tasks, status_counts }]
```

---

## 2026-01-12: Procurement Executive Role Access Expansion

### Summary
Extended Procurement Executive role permissions to access Projects, Products, and Vendors standalone routes.

### Files Modified
- `src/components/layout/NewSidebar.tsx` - Added standalone menu items and route mappings for Procurement Executive

---

## 2026-01-12: Procurement Dashboard Redesign

### Summary
Complete visual overhaul of the procurement dashboard with improved categorization and cleaner visual hierarchy using modern card layout.

### Files Modified
- `src/components/layout/dashboards/procurement-dashboard.tsx` - Redesigned with categorized status cards and brand colors

---

## 2026-01-10: Work Headers Configuration Redesign

### Summary
Revamped the Work Headers & Milestones configuration component (`workHeaderMilestones.tsx`) with enterprise minimalist design and added Work Package link functionality.

### Changes Made
- Added Work Package link selection to create/edit Work Header dialogs
- Display Work Package badges on header cards when associated
- Implemented enterprise minimalist slate color theme
- Added collapsible card sections with expand/collapse functionality
- Sticky header with clean typography
- Maintained drag-and-drop reordering for headers and milestones

---

## 2026-01-10: Milestone Report Code Refactoring

### Summary
Extracted reusable components and hooks from milestone report pages to reduce code duplication and improve maintainability.

### New Files Created
- `hooks/useMilestoneReportData.ts` - Centralized data fetching hook for milestone reports
- `components/DailyReportView.tsx` - Daily report display component
- `components/MilestoneProgress.tsx` - Progress visualization component
- `components/ReportControlBar.tsx` - Zone/date/type control bar
- `utils/milestoneHelpers.ts` - Utility functions (date formatting, work plan parsing, status badges)

### Key Patterns
- Work plan delimiter constant: `"$#,,,"`
- Zone progress status: `'completed' | 'partial' | 'pending' | null`
- Shared hook returns: `projectData`, `dailyReportDetails`, `workPlanGroups`, `milestoneGroups`, `validationZoneProgress`

---

## 2026-01-10: Delete Report Button for MilestonesSummary

### Summary
Added delete report functionality to MilestonesSummary component matching MilestoneDailySummary.

### Changes Made
- Added trash icon button in control bar for authorized users
- Confirmation dialog before deletion
- Permission check for Admin, PMO Executive, and Project Lead roles
- Only shown for today's reports when report exists

---

## 2026-01-10: Daily Progress Report Setup in Project Creation

### Summary
Added Section 2 (Daily Progress Report Setup) to the Package Selection step in project creation wizard. Users can optionally configure progress tracking with zones and work headers during project creation, with settings saved to the Projects doctype after creation.

### Changes Made

**Schema & Types (`schema.ts`):**
- Added `daily_progress_setup` object to form schema with:
  - `enabled: boolean` - Toggle for feature
  - `zone_type: 'single' | 'multiple'` - Zone configuration mode
  - `zones: Array<{ zone_name: string }>` - Custom zone names
  - `work_headers: Array<{ work_header_doc_name, work_header_display_name, work_package_link }>` - Selected headers
- Added `DailyProgressWorkHeader` and `DailyProgressSetup` type exports

**Data Fetching (`useProjectFormData.ts`):**
- Added `WorkHeaderType` interface
- Added Work Headers fetch with `useFrappeGetDocList("Work Headers")`
- Exposed `workHeaders`, `isWorkHeadersLoading`, `workHeadersError`

**UI (`PackageSelectionStep.tsx`):**
- Simplified work package selection to two-column list layout (enterprise utilitarian design)
- Added Section 2: Daily Progress Reports (Optional)
  - Enable toggle checkbox
  - Zone configuration: Single (Default) or Multiple custom zones
  - Work headers selection grouped by work_package_link with expandable accordions
- Removed card-based flashy design in favor of clean borders and minimal styling

**Submission Logic (`index.tsx`):**
- Extract `daily_progress_setup` from form values (not sent to backend API)
- After project creation, call `updateDoc` to set:
  - `enable_project_milestone_tracking: true`
  - `project_zones` child table (field: `zone_name`)
  - `project_work_header_entries` child table (fields: `project_work_header_name`, `enabled: "True"`)
- Added debug logging for troubleshooting

**Creation Dialog (`project-creation-dialog.tsx`):**
- Added third stage: "Setting up progress tracking"
- Conditionally shown when `progressSetupEnabled` is true

**Review Step (`ReviewStep.tsx`):**
- Added Daily Progress Reports section showing zone configuration and selected work headers

**Draft Store (`useProjectDraftStore.ts`):**
- Added `daily_progress_setup` to `ProjectDraftFormValues` interface

**Backend Fixes:**
- `new_project.py`: Removed assignee field assignments (handled by frontend via User Permissions)
- `projects.py`: Changed `generateUserPermissions` hook to use truthy checks instead of `!= ""`

### Technical Notes

**Child Table Field Names:**
- `Project Zone Child Table`: `zone_name` (Data)
- `Project Work Headers`: `project_work_header_name` (Link to Work Headers), `enabled` (Data)

**Enabled Field Format:**
The reading code at `MilestoneTab.tsx:422` filters with `entry.enabled === "True"` (string comparison), so we save `enabled: "True"` not boolean `true`.

**Work Headers Doctype:**
Uses `autoname: "field:work_header_name"`, so document names ARE the display names (e.g., "Fire Sprinkler System").

---

## 2026-01-10: Project Draft System

### Summary
Implemented a draft/resume system for the project creation wizard that auto-saves form progress to localStorage, allows users to cancel setup with save/discard options, and prompts users to resume or start fresh when returning. Drafts expire after 30 days.

### Files Created

**Zustand Store:**
- `src/zustand/useProjectDraftStore.ts` - Draft persistence store:
  - localStorage persistence via `createJSONStorage`
  - Stores form values, areaNames, current step, section, and timestamp
  - Auto-expires drafts after 30 days
  - Date serialization (Date ↔ ISO string conversion)

**Custom Hook:**
- `src/hooks/useProjectDraftManager.ts` - Draft management hook:
  - Auto-save with 1.5s debounce on form changes
  - Relative time display ("Saved 5 minutes ago")
  - Resume/discard dialog controls
  - Form ↔ draft value conversion (handles Date objects)

**UI Components:**
- `src/components/ui/draft-indicator.tsx`:
  - `DraftIndicator` - Pill-shaped status badge showing save state
  - States: Saving (spinner), Saved (green cloud), Error (amber)
  - `DraftHeader` - Container for cancel button + indicator

- `src/components/ui/draft-cancel-dialog.tsx`:
  - AlertDialog for cancel confirmation
  - Shows progress (Step X of Y with progress bar)
  - Three actions: Save Draft & Exit, Discard & Exit, Continue Editing

- `src/components/ui/draft-resume-dialog.tsx`:
  - AlertDialog shown when draft exists on page load
  - Shows project name preview and last saved time
  - Two actions: Resume Draft, Start Fresh

### Files Modified

- `src/pages/projects/project-form.tsx`:
  - Added imports for draft system components
  - Integrated `useProjectDraftManager` hook
  - Added `DraftHeader` with Cancel button and `DraftIndicator`
  - Added `DraftResumeDialog` and `DraftCancelDialog`
  - Clear draft on successful project submission

### Key Patterns

**Draft Store with Persistence:**
```typescript
export const useProjectDraftStore = create<ProjectDraftStore>()(
  persist(
    (set, get) => ({
      draft: null,
      saveDraft: (draft) => set({ draft: { ...draft, lastSavedAt: new Date().toISOString() } }),
      clearDraft: () => set({ draft: null }),
      hasDraft: () => { /* check expiration */ },
    }),
    {
      name: 'nirmaan-project-draft',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
```

**Draft Manager Hook Usage:**
```typescript
const {
  hasDraft, lastSavedText, isSaving,
  showResumeDialog, showCancelDialog,
  setShowResumeDialog, setShowCancelDialog,
  resumeDraft, discardDraft, saveDraftNow, clearDraftAfterSubmit,
} = useProjectDraftManager({
  form, areaNames, setAreaNames,
  currentStep, section, setCurrentStep, setSection,
});
```

**Draft Header Integration:**
```typescript
<DraftHeader>
  <Button variant="ghost" onClick={() => setShowCancelDialog(true)}>
    <X className="h-4 w-4" />
    <span className="hidden sm:inline">Cancel</span>
  </Button>
  <DraftIndicator lastSavedText={lastSavedText} isSaving={isSaving} />
</DraftHeader>
```

---

## 2026-01-10: New Design for Project Forms

### Summary
Redesigned project creation and edit forms with a modern wizard-based layout, responsive step indicator, and new reusable UI components. Replaced Ant Design Steps with custom WizardSteps component. Added consistent form field layouts and enhanced review section with collapsible cards.

### Files Created

**New UI Components:**
- `src/components/ui/wizard-steps.tsx` - Custom multi-step wizard indicator with responsive layouts:
  - Mobile: Progress bar with percentage and current step name
  - Tablet: Compact horizontal with step numbers + current title
  - Desktop: Full horizontal with short titles and connectors
  - Animated current step indicator with pulse effect
  - Color-coded step states (completed=green, current=primary, upcoming=muted)

- `src/components/ui/form-field-row.tsx` - Unified form field layout component:
  - Three variants: `default`, `sheet`, `compact`
  - Responsive breakpoints (`md:` for horizontal layout)
  - Consistent label/input proportions
  - `FormSectionHeader` for section titles with icons
  - `FormGrid` for multi-column layouts
  - `FormActions` for button placement

- `src/components/ui/review-section.tsx` - Review section components:
  - `ReviewContainer` - Gradient wrapper with title/description
  - `ReviewSection` - Collapsible section with icon, title, edit button
  - `ReviewDetail` - Stacked label-value display (label=uppercase muted, value=prominent)

- `src/components/ui/package-review-card.tsx` - Work package review:
  - `PackageReviewCard` - Collapsible card for individual packages
  - `PackagesReviewGrid` - Responsive grid of package cards
  - Category badges with make counts

**New Hooks:**
- `src/hooks/useMediaQuery.ts` - Responsive breakpoint detection:
  - `useMediaQuery(query)` - Check if media query matches
  - `useBreakpoint()` - Get `isMobile`, `isTablet`, `isDesktop`, `current`

### Files Modified

**Project Forms:**
- `src/pages/projects/project-form.tsx`:
  - Replaced Ant Design `Steps` with custom `WizardSteps`
  - Added `wizardStepsConfig` with short titles and icons
  - Refactored `ReviewDetails` to use new `ReviewSection`, `ReviewDetail`, `PackagesReviewGrid`
  - Removed legacy `Section` and `Detail` components
  - Fixed `Calendar` naming conflict with `CalendarLucide` alias

- `src/pages/projects/edit-project-form.tsx`:
  - Updated form field layouts to use consistent classes:
    - `md:flex md:items-start gap-4` (was `lg:flex lg:items-center`)
    - `md:w-1/4 md:pt-2.5 shrink-0` for labels (was `md:basis-3/12`)
    - `flex-1` for input containers (was `md:basis-2/4`)
  - Added `FormSectionHeader` with icons for each section
  - Fixed `Calendar` naming conflict with `CalendarIconAlt` alias

### Key Patterns

**Responsive Wizard Steps:**
```typescript
const wizardStepsConfig: WizardStep[] = [
    { key: "projectDetails", title: "Project Details", shortTitle: "Details", icon: Building2 },
    { key: "projectAddressDetails", title: "Project Address", shortTitle: "Address", icon: MapPin },
    // ...
];

<WizardSteps
    steps={wizardStepsConfig}
    currentStep={currentStep}
    onStepClick={(stepIndex) => { /* navigation */ }}
/>
```

**Review Section with Edit:**
```typescript
<ReviewSection
    title="Project Details"
    icon={Building2}
    onEdit={() => navigateToSection("projectDetails")}
    iconColorClass="bg-blue-500/10 text-blue-600"
>
    <ReviewDetail label="Project Name" value={form.getValues("project_name")} />
</ReviewSection>
```

**Consistent Form Field Layout:**
```typescript
<FormItem className="md:flex md:items-start gap-4">
    <FormLabel className="md:w-1/4 md:pt-2.5 shrink-0">Label</FormLabel>
    <div className="flex-1 space-y-1.5">
        <FormControl><Input {...field} /></FormControl>
        <FormMessage />
    </div>
</FormItem>
```

---

## 2026-01-10: Invoice Reconciliation with 2B Activation Tracking

### Summary
Added 2B activation status tracking for PO and SR invoices with reconciliation workflow. Invoices can now be marked as reconciled with GST 2B form matching status.

### Files Created

**Config Files:**
- `src/pages/tasks/invoices/config/poInvoicesTable.config.ts` - PO invoice table searchable fields and filter options
- `src/pages/tasks/invoices/config/srInvoicesTable.config.ts` - SR invoice table searchable fields and filter options

### Files Modified

**Invoice Components:**
- `src/pages/tasks/invoices/components/PoInvoices.tsx`:
  - Added optional `vendorId` prop for vendor-specific filtering
  - Added `2b_activation_status` column with reconciliation dialog
  - Added `reconciled_date` column with date filter
  - Added `updated_by` column showing full name from Nirmaan Users
  - Added facet filter for `updated_by` field
  - Fixed date filters by adding `filterFn: dateFilterFn`

- `src/pages/tasks/invoices/components/SrInvoices.tsx`:
  - Same enhancements as PoInvoices.tsx for SR invoices

**Vendor Overview:**
- `src/pages/vendors/vendor.tsx`:
  - Added "PO Invoices" and "SR Invoices" tabs
  - Tabs filtered by vendor_type (Material/Service/Both)
  - Lazy loading for invoice components

### Key Patterns

**Optional Vendor Filtering:**
```typescript
interface PoInvoicesProps {
    vendorId?: string; // Optional: filter to specific vendor
}
// When vendorId provided: client-side filter, hide vendor column, vendor-specific urlSyncKey
```

**User Full Name Lookup:**
```typescript
const getUserFullName = useMemo(() => memoize((userId: string) => {
    const user = userValues.find(u => u.value === userId);
    return user?.label || userId;
}), [userValues]);
```

**Date Filter Fix:**
```typescript
{
    accessorKey: "date",
    filterFn: dateFilterFn, // Required for client-side date filtering
}
```

---

## 2026-01-10: Remarks System for PO and Work Orders (SR)

### Summary
Complete remarks/comments system for purchase orders and service requests with role-based categorization.

### Files Created

**PO Remarks:**
- `src/pages/purchase-order/components/PORemarks.tsx` - Full remarks UI for PO summary
- `src/pages/purchase-order/components/PORemarksPopover.tsx` - Compact remarks popover
- `src/pages/purchase-order/hooks/usePORemarks.ts` - PO remarks hook

**SR Remarks:**
- `src/pages/ServiceRequests/approved-sr/components/SRRemarks.tsx` - Full remarks UI for SR
- `src/pages/ServiceRequests/approved-sr/components/SRRemarksPopover.tsx` - Compact remarks popover
- `src/pages/ServiceRequests/approved-sr/hooks/useSRRemarks.ts` - SR remarks hook

**Reports Integration:**
- `src/pages/reports/components/columns/PORemarksHoverCard.tsx` - Reports table hover card
- `src/pages/reports/components/columns/SRRemarksHoverCard.tsx` - Reports table hover card

**Backend:**
- `nirmaan_stack/api/po_remarks.py` - Backend PO remarks API
- `nirmaan_stack/api/sr_remarks.py` - Backend SR remarks API

### Key Pattern
Role-based remark categorization (Accountant, Procurement, Admin tabs). Users can only delete their own remarks.

---

## 2026-01-10: Code Cleanup and Refactoring

### Summary
Cleanup of InFlowPayments component and project hooks.

### Files Modified
- `src/pages/inflow-payments/InFlowPayments.tsx` - Refactored to use extracted components
- `src/pages/projects/projects.tsx` - Updated to use `useProjectAllCredits` hook

### Files Created
- `src/components/ui/progress.tsx` - Added shadcn/ui Progress component

---

## 2026-01-09: Header/Sidebar Alignment Fix & Mobile Menu

### Summary
Fixed visual misalignment between sidebar header and main layout topbar. Added minimal mobile menu trigger.

### Files Modified

**Sidebar Header (`src/components/layout/NewSidebar.tsx:603`):**
- Set fixed height `h-14 min-h-[56px]` matching main layout header
- Changed flex layout from `flex-col` to `flex-row items-center justify-between`
- Added `border-b border-border/40` for consistent border line
- Removed separate `<Separator />` component
- SidebarTrigger centers (`mx-auto`) when sidebar collapsed

**Main Layout (`src/components/layout/main-layout.tsx`):**
- Removed duplicate absolute-positioned mobile SidebarTrigger
- Added minimal inline mobile menu trigger (`w-5` width, `h-4 w-4` icon)
- Trigger only visible on mobile with muted styling

### Visual Result
- Sidebar and main layout header borders now align horizontally
- Mobile view has compact hamburger icon on left edge of topbar
- Cleaner visual separation between header and content

---

## 2026-01-09: Asset Management Module

### Summary
Complete frontend module for managing company assets including categories, asset master records, assignments, and declarations.

### Files Created

**Main Pages:**
- `src/pages/Assets/AssetsPage.tsx` - Main page with tabs:
  - Assets tab: Sub-tabs for All/Assigned/Unassigned/Pending Declaration
  - Categories tab: Manage asset categories
- `src/pages/Assets/AssetOverview.tsx` - Individual asset detail/edit page

**Components (`src/pages/Assets/components/`):**
- `AssetCategoriesList.tsx` - Category management table
- `AssetMasterList.tsx` - All assets table with filters
- `AssignedAssetsList.tsx` - Currently assigned assets view
- `UnassignedAssetsList.tsx` - Available assets view
- `PendingActionsList.tsx` - Assets pending declaration upload
- `AssetsSummaryCard.tsx` - Stats card showing asset counts
- `AddAssetCategoryDialog.tsx` - Create new category
- `AddAssetDialog.tsx` - Create new asset
- `AssignAssetDialog.tsx` - Assign asset to user
- `UnassignAssetDialog.tsx` - Remove assignment

**Constants:**
- `src/pages/Assets/assets.constants.ts` - Doctype names, field definitions, search configs

### Doctypes Used
- `Asset Category` - Asset classification
- `Asset Master` - Individual asset records
- `Asset Management` - Assignment records linking assets to users

### Routing
- `/asset-management` - Main assets page
- `/asset-management/:assetId` - Asset detail/overview page

### Access Control
- Sidebar: Admin, PMO Executive, HR Executive
- All actions require one of these roles

---

## 2026-01-09: Accountant Role Enhancements

### Summary
Fixed Accountant role unable to create Work Orders and created backend patch to remove project assignments from all Accountant users (giving them access to all projects).

### Backend Patch Created

**File:** `nirmaan_stack/patches/v2_8/remove_accountant_project_assignments.py`

Removes all project assignments from Accountant users:
- Deletes `User Permission` entries (Frappe built-in) for Projects
- Deletes `Nirmaan User Permissions` entries for Projects
- Sets `has_project = "false"` for all Accountant users

**Registered in:** `nirmaan_stack/patches.txt`

**Run with:** `bench --site localhost migrate`

### Frontend Bug Fix

**File:** `src/pages/ServiceRequests/service-request/new-service-request.tsx:128`

**Issue:** Accountant role was missing from the `handleSubmit()` role check array, causing silent failure when creating Work Orders.

**Fix:** Added `"Nirmaan Accountant Profile"` to allowed roles. Also removed `"Nirmaan Project Manager Profile"` (was inconsistent with role-access.md and button visibility).

**Before:**
```typescript
["Nirmaan Project Manager Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile",
 "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"]
```

**After:**
```typescript
["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Procurement Executive Profile",
 "Nirmaan Project Lead Profile", "Nirmaan Accountant Profile"]
```

### Documentation Created

**File:** `.claude/context/_index.md` - Navigation index for frontend context files

---

## 2026-01-09: Added User Assets Tab with Assignment and Declaration Upload

### Summary
Enhanced user profile page with an "Assets" tab showing assigned assets. Admins (Admin/PMO/HR) can assign unassigned assets to users. Users can upload pending declaration documents for their own assets.

### Files Created

**New Components:**
- `src/pages/users/components/UserAssetsTab.tsx` - Displays user's assigned assets with:
  - Asset cards showing name, category, condition, serial number, assignment date
  - Declaration status (Pending/Uploaded) with upload/view actions
  - Assign Asset button (Admin/PMO/HR only)
  - Unassign button (Admin/PMO/HR only)

- `src/pages/users/components/AssignAssetToUserDialog.tsx` - Dialog for assigning assets:
  - Category dropdown filter
  - Asset dropdown (filtered to unassigned only)
  - Assignment date picker
  - Optional declaration file upload

### Files Modified

**User Profile:**
- `src/pages/users/user-profile.tsx`:
  - Added Assets tab (visible to all users with profile access)
  - Fetches Asset Management, Asset Master, Asset Category data
  - Tab layout: 2 cols for project-exempt roles, 3 cols for others

- `src/pages/users/components/UserOverviewTab.tsx`:
  - Added `assetCount` and `showAssetStats` props
  - "Assigned Assets" stat card shown when user has assets
  - Dynamic grid layout for 1-3 stat cards

- `src/pages/users/components/index.ts` - Exported new components

### Access Control

| Action | Admin/PMO/HR | Own Profile | Others |
|--------|:------------:|:-----------:|:------:|
| View Assets Tab | Yes | Yes | No |
| Assign Asset | Yes | No | No |
| Unassign Asset | Yes | No | No |
| Upload Declaration | Yes | Yes (own) | No |

### Key Patterns

**Asset Assignment Flow:**
```typescript
// 1. Create Asset Management record
await createDoc(ASSET_MANAGEMENT_DOCTYPE, {
  asset: selectedAsset,
  asset_assigned_to: userId,
  asset_assigned_on: date,
  asset_declaration_attachment: fileUrl,
});

// 2. Update Asset Master
await updateDoc(ASSET_MASTER_DOCTYPE, selectedAsset, {
  current_assignee: userId,
});
```

---

## 2026-01-09: Fixed Project Count for Own Profile and Hide for Exempt Roles

### Summary
Fixed bug where non-admin users couldn't see their assigned projects. Added logic to hide Projects tab/stats for roles that have access to all projects (no assignment required).

### Changes

**Bug Fix - Project Count:**
- Changed `permission_list` fetch condition from `isAdmin` to `(isAdmin || isOwnProfile)`
- Changed doctype from "User Permission" to "Nirmaan User Permissions"

**Hide Projects for Exempt Roles:**
- Added `PROJECT_EXEMPT_ROLES` constant (Admin, PMO, HR, Accountant, Estimates, Design Lead)
- Projects tab hidden for users with these roles
- "Assigned Projects" stat card hidden for exempt roles

---

## 2026-01-09: Restricted Users Page Access to Authorized Roles

### Summary
Added route-level access control to restrict `/users` and `/users/:userId` pages to Admin, PMO Executive, and HR Executive roles only. Non-authorized users can still access their own profile.

### Files Modified

**Route Guards:**
- `src/utils/auth/ProtectedRoute.tsx` - Added two new route guards:
  - `UsersRoute` - Restricts `/users` list to Admin, PMO, HR Executive
  - `UserProfileRoute` - Restricts `/users/:userId` to authorized roles OR own profile

**Routing:**
- `src/components/helpers/routesConfig.tsx` - Wrapped users routes with new guards

### Bug Fix: Own Profile Access for Non-Authorized Roles

**Issue:** Non-authorized users (e.g., Project Manager) could not access their own profile at `/users/:userId` even though `UserProfileRoute` allowed it.

**Root Cause:** `UserProfileRoute` was nested inside `UsersRoute`, so React Router evaluated `UsersRoute` first, which blocked non-authorized users before `UserProfileRoute` could check for own profile.

**Fix:** Restructured routes so `UserProfileRoute` is a sibling, not a child of `UsersRoute`:
```tsx
{
  path: "users",
  children: [
    // UsersRoute guards only list and new-user
    {
      element: <UsersRoute />,
      children: [
        { index: true, element: <Users /> },
        { path: "new-user", element: <UserForm /> },
      ],
    },
    // UserProfileRoute guards profile routes independently
    {
      path: ":userId",
      element: <UserProfileRoute />,
      children: [
        { index: true, element: <Profile /> },
        { path: "edit", element: <EditUserForm /> },
      ],
    },
  ],
}
```

### Access Control Pattern

```tsx
// UsersRoute - for /users list page
export const UsersRoute = () => {
  const { role, user_id } = useUserData()
  const canAccessUsers =
    role === "Nirmaan Admin Profile" ||
    role === "Nirmaan PMO Executive Profile" ||
    role === "Nirmaan HR Executive Profile" ||
    user_id === "Administrator"
  // ...
}

// UserProfileRoute - for /users/:userId profile page
export const UserProfileRoute = () => {
  const { role, user_id } = useUserData()
  const { userId } = useParams()
  const isAuthorizedRole = /* Admin, PMO, HR, Administrator */
  const isOwnProfile = user_id === userId
  if (isAuthorizedRole || isOwnProfile) return <Outlet />
  // ...
}
```

### Access Matrix

| Role | /users | Other's Profile | Own Profile |
|------|--------|-----------------|-------------|
| Admin/PMO/HR | ✅ | ✅ | ✅ |
| All other roles | ❌ | ❌ | ✅ |

---

## 2026-01-09: Enterprise Minimalist User Form Redesign

### Summary
Redesigned Create New User and Edit User forms with an enterprise minimalist aesthetic. Forms now feature Card containers, two-column grid layouts for name fields, cleaner labels, and placeholder-based hints instead of verbose descriptions.

### Files Modified

**User Forms:**
- `src/pages/users/user-form.tsx` - Complete redesign with:
  - Card wrapper with brand-gradient header
  - Two-column grid for First Name + Last Name
  - Organized sections: Personal Info, Contact, Access & Permissions
  - Smaller labels (`text-xs font-medium`)
  - Placeholders instead of FormDescription
  - Centered layout with max-width constraint

- `src/pages/users/EditUserForm.tsx` - Same redesign pattern with:
  - Clean header with title and description
  - Two-column grid for name fields
  - Lock icon indicator for disabled email field
  - Conditional role profile section
  - Bottom border separator for action buttons

### Design Patterns Applied

**Card Layout (Create Form):**
```tsx
<Card className="border shadow-sm">
  <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5">
    <CardTitle>Create New User</CardTitle>
    <CardDescription>Add a new team member</CardDescription>
  </CardHeader>
  <CardContent>...</CardContent>
  <CardFooter className="border-t bg-gray-50/50">...</CardFooter>
</Card>
```

**Two-Column Grid:**
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  {/* First Name */}
  {/* Last Name */}
</div>
```

**Disabled Field with Lock Icon:**
```tsx
<div className="relative">
  <Input disabled className="bg-gray-50 pr-10" {...field} />
  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
</div>
```

---

## 2026-01-09: Added HR Executive Role with User Management Access

### Summary
Added `Nirmaan HR Executive Profile` as a new role focused on user management. HR Executive has access to Users page and all user management actions (create, edit, delete, reset password, assign projects).

### Files Created
- `src/components/layout/dashboards/dashboard-hr.tsx` - HR Executive dashboard with:
  - Total Users count card (links to /users)
  - Role Distribution section with clickable pills
  - Each role pill filters users table via URL params

### Files Modified

**Role Colors & Config:**
- `src/utils/roleColors.ts` - Added HR Executive with lime color scheme + ROLE_OPTIONS entry

**Navigation & Layout:**
- `src/components/layout/NewSidebar.tsx`:
  - Added standalone "Users" menu item for HR Executive (line 228-236)
  - Added "Users" to direct link labels whitelist (line 631)

**Dashboard Routing:**
- `src/pages/dashboard.tsx`:
  - Added HRDashboard import and rendering (line 76)
  - Added HR Executive to project requirement exemption list (line 57)

**User Management Access:**
- `src/components/helpers/renderRightActionButton.tsx` - HR can see "New User" in dashboard dropdown
- `src/pages/users/user-profile.tsx` - HR added to `isAdmin` check (line 33)
- `src/pages/users/EditUserForm.tsx` - HR can edit role profiles (line 230)
- `src/pages/users/components/UserRowActions.tsx` - HR added to `isAdmin` check (line 37)
- `src/pages/users/components/UserProjectsTab.tsx` - Fixed ReactSelect portal issue for assign project dialog

**User Form Enhancement:**
- `src/pages/users/user-form.tsx` - Role Profile field now uses ReactSelect (searchable)
- `src/pages/users/EditUserForm.tsx` - Role Profile field now uses ReactSelect (searchable)

**Backend:**
- `nirmaan_stack/api/users.py` - `get_user_role_counts()` now dynamically fetches all Nirmaan roles from Role Profile doctype

### Documentation Updated
- `.claude/context/role-access.md` - Added HR Executive to all access matrices
- `CLAUDE.md` - Updated role count to 10, added HR Executive special note

### Key Patterns

**Role Distribution with Filtered Navigation:**
```typescript
const navigateToFilteredUsers = (roleProfile: string) => {
  const filter = [{ id: "role_profile", value: [roleProfile] }];
  const encodedFilter = btoa(JSON.stringify(filter));
  navigate(`/users?users_list_filters=${encodedFilter}`);
};
```

**ReactSelect in Dialog (portal fix):**
```typescript
<ReactSelect
  menuPortalTarget={document.body}
  menuPosition="fixed"
  styles={{
    menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  }}
/>
```

---

## 2026-01-09: Added PMO Executive Profile with Admin Access

**Commit:** `2372410d` - feat: added PMO Executive role and matched access with Admin role

### Summary
Added `Nirmaan PMO Executive Profile` as a new role that mirrors all access permissions of `Nirmaan Admin Profile` across the frontend.

### Files Modified (49 total)

**Core Infrastructure:**
- `src/utils/roleColors.ts` - Added PMO role with teal color scheme
- `src/utils/auth/ProtectedRoute.tsx` - Updated AdminRoute to include PMO

**Navigation & Layout:**
- `src/components/layout/NewSidebar.tsx` - 14 role checks updated for menu visibility
- `src/components/helpers/renderRightActionButton.tsx` - 3 role checks updated

**Dashboard & Role Selection:**
- `src/pages/dashboard.tsx` - PMO shows DefaultDashboard
- `src/components/updates/RoleSelector.tsx` - PMO can access role selector
- `src/components/updates/RoleDashboard.tsx` - PMO exempt from project requirement

**User Management (5 files):**
- `user-profile.tsx`, `EditUserForm.tsx`, `UserProfileActions.tsx`, `UserRowActions.tsx`, `UserProjectsTab.tsx`

**Financial Pages (8 files):**
- `AllPayments.tsx`, `RenderProjectPaymentsComponent.tsx`, `ProjectExpensesList.tsx`, `NonProjectExpensesPage.tsx`, `AllProjectInvoices.tsx`, `ProjectInvoiceTable.tsx`, `InFlowPayments.tsx`, `InvoiceReconciliationContainer.tsx`

**Procurement (7 files):**
- `procurement-requests.tsx`, `ApprovePRView.tsx`, `ItemSelectorControls.tsx`, `NewItemDialog.tsx`, `release-po-select.tsx`, `PODetails.tsx`, `POPaymentTermsCard.tsx`

**Service Requests (7 files):**
- `ServiceRequestsTabs.tsx`, `ApprovedSRView.tsx`, `SRPaymentsSection.tsx`, `approved-sr.tsx`, `select-service-vendor-list.tsx`, `sr-summary.tsx`, `new-service-request.tsx`

**Projects & Design (6 files):**
- `project.tsx`, `ProjectOverviewTab.tsx`, `ProjectWorkReportTab.tsx`, `CustomerPODeatilsCard.tsx`, `design-tracker-list.tsx`, `project-design-tracker-details.tsx`

**Reports & Other (8 files):**
- `ReportsContainer.tsx`, `useReportStore.ts`, `POVendorLedger.tsx`, `sent-back-request.tsx`, `item.tsx`, `itemsPage.tsx`, `pr-summary.tsx`

### Documentation Updated
- `.claude/context/role-access.md` - Added PMO to all access matrices
- `CLAUDE.md` - Updated Role-Based Access Control section (9 roles, PMO mirrors Admin)

### Pattern Used
```typescript
// Before
["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role)

// After
["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role)
```
