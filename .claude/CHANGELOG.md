# Changelog

Changes made by Claude Code sessions.

---

### 2026-01-23: Vendor Invoices Doctype with Approval Workflow

**Summary:** Created centralized Vendor Invoices doctype to replace embedded invoice data in delivery notes. Includes approval/rejection workflow, duplicate detection, and migration from legacy data.

**Doctype Created:**
- `Vendor Invoices` - Centralized invoice storage with:
  - Dynamic link to PO or SR (document_type + document_name)
  - Project and Vendor links
  - Invoice details (no, date, amount, attachment)
  - Approval workflow (Pending/Approved/Rejected with audit trail)
  - Reconciliation fields (status, date, amount, proof)
  - Autoname: `VI-.YYYY.-.#####`

**Backend Files Created:**
- `nirmaan_stack/nirmaan_stack/doctype/vendor_invoices/` - Doctype definition
- `nirmaan_stack/api/invoices/approve_vendor_invoice.py` - Approval/rejection API with audit trail
- `nirmaan_stack/api/invoices/check_duplicate_invoice.py` - Duplicate detection by vendor+invoice_no
- `nirmaan_stack/api/invoices/get_vendor_invoice_totals.py` - Aggregation API for document totals
- `nirmaan_stack/patches/v3_0/migrate_invoices_to_vendor_invoices.py` - Data migration patch

**Backend Files Modified:**
- `nirmaan_stack/api/delivery_notes/update_invoice_data.py` - Refactored to create/update Vendor Invoices
- `nirmaan_stack/api/invoices/po_wise_invoice_data.py` - Updated to query Vendor Invoices
- `nirmaan_stack/api/invoices/sr_wise_invoice_data.py` - Updated to query Vendor Invoices
- `nirmaan_stack/api/invoices/update_invoice_reconciliation.py` - Updated to work with Vendor Invoices
- `nirmaan_stack/api/projects/project_wise_invoice_data.py` - Updated data source
- `nirmaan_stack/api/vendor/get_vendor_po_invoices.py` - Updated data source

**Key Patterns:**
- Dynamic link pattern for polymorphic document reference (PO or SR)
- Approval workflow with status, approved_by, approved_on, rejection_reason fields
- Invoice ID resolution uses Vendor Invoice docname (e.g., `VI-2026-00001`), not composite key

---

### 2026-01-21: Invoice Reconciliation N/A Status

**Summary:** Added "Not Applicable" (N/A) as a fourth reconciliation status for invoices where GST 2B matching is not required (e.g., unregistered vendors, exempt supplies).

**Backend Files Modified:**
- `nirmaan_stack/api/invoices/update_invoice_reconciliation.py` - Added "na" to RECONCILIATION_STATUS_VALUES

**Key Behavior:**
- N/A status clears reconciliation fields (reconciled_amount = 0)
- N/A is NOT considered reconciled - excluded from reconciliation metrics
- N/A invoices don't count toward "pending" reconciliation totals

---

### 2026-01-20: Credits API Refactoring with Row-Level Filtering

**Summary:** Created custom Credits API that filters PO Payment Terms at the child row level (not parent level), removed deprecated "Scheduled" status, and implemented date-based "Due" logic.

**Backend Files Created:**
- `nirmaan_stack/api/credits/__init__.py` - Credits API module
- `nirmaan_stack/api/credits/get_credits_list.py` - Custom API with row-level filtering
- `nirmaan_stack/patches/v2_9/remove_scheduled_status_and_cleanup.py` - Migration patch

**Backend Files Modified:**
- `nirmaan_stack/api/approve_amend_po.py` - Updated payment term status handling
- `nirmaan_stack/api/approve_vendor_quotes.py` - Updated payment term creation
- `nirmaan_stack/api/payments/project_payments.py` - Removed scheduled status logic
- `nirmaan_stack/api/sidebar_counts.py` - Updated "due" count calculation using date logic
- `nirmaan_stack/integrations/controllers/project_payments.py` - Simplified status handling
- `nirmaan_stack/hooks.py` - Removed scheduled task reference
- `po_payment_terms.json` - Removed "Scheduled" from status options

**Backend Files Deleted:**
- `nirmaan_stack/tasks/payment_term_worker.py` - No longer needed (scheduled status removed)

**Frontend Files Modified:**
- `frontend/src/pages/credits/hooks/useCredits.ts` - Rewritten to use custom API
- `frontend/src/pages/credits/CreditsPage.tsx` - Updated for new hook interface
- `frontend/src/pages/credits/components/CreditsTableColumns.tsx` - Added display_status column
- `frontend/src/pages/credits/credits.constant.ts` - Updated status options (Due/Requested/Approved/Paid)
- `frontend/src/types/NirmaanStack/POPaymentTerms.ts` - Added display_status field
- `frontend/src/pages/projects/hooks/useProjectAllCredits.ts` - Updated with date-based due logic
- `frontend/src/pages/reports/hooks/useProjectReportCalculations.ts` - Updated CreditDueAmount calculation
- `frontend/src/zustand/useDocCountStore.ts` - Track due/created counts
- `frontend/src/pages/ProcurementOrders/purchase-order/components/POPaymentTermsCard.tsx` - UI updates

**Key Technical Details:**
- Custom SQL API filters at CHILD ROW level, not parent document level
- "Due" tab shows: Created terms (due_date <= today) + Requested + Approved
- Computed `display_status` field: Shows "Due" for eligible Created terms
- Permission-aware based on user's project access
- TanStack filter support with special handling for "Due" status

**Credits API Endpoint:**
```
nirmaan_stack.api.credits.get_credits_list.get_credits_list
```

---

### 2026-01-19: SR Finalization Workflow

**Summary:** Implemented finalization feature for approved Service Requests (Work Orders) that locks editing, amendments, and deletion. Includes system-generated audit comments that are undeletable.

**Backend Files Created:**
- `nirmaan_stack/api/sr_finalize.py` - Finalize/revert APIs with permission checks:
  - `finalize_sr()` - Locks SR, records who/when
  - `revert_finalize_sr()` - Admin-only unlock
  - `check_finalize_permissions()` - Permission checks for UI

**Backend Files Modified:**
- `nirmaan_stack/nirmaan_stack/doctype/service_requests/service_requests.json` - Added fields:
  - `is_finalized` (Check)
  - `finalized_by` (Data)
  - `finalized_on` (Datetime)
- `nirmaan_stack/nirmaan_stack/doctype/nirmaan_comments/nirmaan_comments.json` - Added `is_system_generated` (Check) field
- `nirmaan_stack/api/sr_remarks.py` - Block deletion of system-generated comments

**Frontend Files Created:**
- `frontend/src/pages/ServiceRequests/components/SRFinalizeDialog.tsx` - Confirmation dialogs for finalize/revert
- `frontend/src/pages/ServiceRequests/hooks/useSRFinalize.ts` - Hooks for finalize permissions and actions

**Frontend Files Modified:**
- `approved-sr.tsx` - Integrated finalize button, permission-based action disabling
- `SRDetailsCard.tsx` - Accept finalization state for UI
- `SRComments.tsx` - System comments undeletable, shows "Auto" badge
- `useSRRemarks.ts` - Added `is_system_generated` to interface

**Features:**
- Finalize locks: Amend, Delete, Edit Terms & Notes
- System-generated audit comments marked with `is_system_generated=1`
- System comments cannot be deleted (backend blocks, frontend hides button)
- Finalized by stores full name (not email) for display

**Permission Model:**
| Action | Who Can Perform |
|--------|-----------------|
| Finalize | Admin, PMO, PL, Procurement Executive, OR owner |
| Revert | Admin, PMO, PL, Procurement Executive only |

---

### 2026-01-17: 3-State Invoice Reconciliation Model

**Summary:** Migrated from binary reconciliation (Reconciled/Pending) to 3-state model (Full/Partial/None) with reconciled amount tracking. Updated both invoices tab and reports view for consistency.

**Backend Files Modified:**
- `nirmaan_stack/patches/v2_9/migrate_invoice_reconciliation_status.py` - Migrate is_2b_activated to reconciliation_status
- `nirmaan_stack/patches/v2_9/add_reconciled_amount_field.py` - Add reconciled_amount field to PO/SR invoices
- `nirmaan_stack/api/invoices/po_wise_invoice_data.py` - Return reconciliation_status, reconciled_amount, proof attachment
- `nirmaan_stack/api/invoices/sr_wise_invoice_data.py` - Same changes for SR invoices
- `nirmaan_stack/api/invoices/update_invoice_reconciliation.py` - Support partial reconciliation with amount input

**Frontend Invoices Tab Files:**
- `frontend/src/pages/tasks/invoices/components/PoInvoices.tsx` - 3-state status, reconciled amount column, summary breakdown
- `frontend/src/pages/tasks/invoices/components/SrInvoices.tsx` - Same changes for SR invoices
- `frontend/src/pages/tasks/invoices/components/ReconciliationDialog.tsx` - Partial reconciliation UI with amount input
- `frontend/src/pages/tasks/invoices/hooks/useInvoiceReconciliation.ts` - Updated hook for new model
- `frontend/src/pages/tasks/invoices/config/*.config.ts` - Added Partial to filter options
- `frontend/src/pages/tasks/invoices/constants.ts` - ReconciliationStatus type

**Frontend Reports Files:**
- `frontend/src/pages/reports/components/PO2BReconcileReport.tsx` - Summary cards with partial breakdown
- `frontend/src/pages/reports/components/SR2BReconcileReport.tsx` - Same changes
- `frontend/src/pages/reports/components/columns/po2BReconcileColumns.tsx` - Reconciled amount column, 3-state badges
- `frontend/src/pages/reports/components/columns/sr2BReconcileColumns.tsx` - Same changes
- `frontend/src/pages/reports/hooks/usePO2BReconcileData.ts` - New fields in interface and mapping
- `frontend/src/pages/reports/hooks/useSR2BReconcileData.ts` - Same changes
- `frontend/src/pages/reports/config/*.config.ts` - Partial filter option

**UI Component:**
- `frontend/src/components/data-table/data-table-column-header.tsx` - Allow ReactNode for title prop

**Features:**
- 3-state reconciliation: Full (green), Partial (yellow), None (gray outline)
- Reconciled amount column with color coding based on comparison to invoice amount
- Summary cards show Partial sub-metric with both invoice amount AND actual reconciled amount
- Proof attachment support for reconciliation documentation
- Backward compatible with legacy is_2b_activated field

---

### 2026-01-16: Design Tracker UI Harmonization with Progress Visualization

**Summary:** Enhanced Design Tracker list and detail pages with progress visualization, summary statistics, and hide/unhide functionality.

**Files Modified:**
- `frontend/src/pages/ProjectDesignTracker/components/ProjectWiseCard.tsx` - Added progress circle and task breakdown display
- `frontend/src/pages/ProjectDesignTracker/design-tracker-list.tsx` - Added structured header with summary stats, hide/unhide functionality
- `frontend/src/pages/ProjectDesignTracker/project-design-tracker-details.tsx` - Added ProgressCircle, completion counter, status breakdown
- `frontend/src/pages/ProjectDesignTracker/types/index.ts` - Added `hide_design_tracker` field to types
- `nirmaan_stack/api/design_tracker/get_task_wise_list.py` - Updated metrics calculation
- `nirmaan_stack/api/design_tracker/get_tracker_list.py` - Added hide_design_tracker field and role-based visibility filtering
- `nirmaan_stack/nirmaan_stack/doctype/project_design_tracker/project_design_tracker.json` - Added hide_design_tracker field

**Features:**
- List page summary header showing project count, completion stats, hidden trackers count
- Hide/unhide functionality with collapsible section for hidden trackers
- Progress circle visualization on detail page header (desktop and mobile)
- Status breakdown showing task counts by status (excluding Not Applicable)
- Metrics exclude "Not Applicable" tasks to match backend calculation

**Access Control:**
- Hidden trackers visible only to: Admin, PMO Executive, Design Lead
- Design Executives and Project Managers cannot see hidden trackers

---

### 2026-01-14: PO Details Section Redesign

**Summary:** Reorganized PO Details card into logical sections with enterprise-minimal design, added PO Amount Delivered field.

**Files Modified:**
- `frontend/src/pages/ProcurementOrders/purchase-order/components/PODetails.tsx` - Complete layout restructure

**Layout Changes:**
- **Header Section**: Title "PO Details" with validation warning + Approved By (right-aligned)
- **Info Section**: Vendor, Package, Status, Critical PO Tag (horizontal flow with separators)
- **Amounts Section**: PO Amount (Incl/Excl GST), Total Invoiced Amount, Total Amount Paid (green), PO Amount Delivered (blue)
- **Timeline Section**: Created, Dispatched, Latest Delivery, Latest Payment dates
- **Actions Section**: All buttons grouped at end, horizontal scroll on mobile

**New Features:**
- Added PO Amount Delivered field (blue color) to amounts section
- Subtle section dividers (borders) instead of heavy card borders
- Uppercase tracking-wide labels for section headers (10px font)

**Code Improvements:**
- Reduced file from ~1900 lines to ~1300 lines by removing duplicates
- Moved all dialogs/sheets outside main content flow
- Removed commented-out legacy code
- Improved responsive layout for mobile devices

---

### 2026-01-12: Work Plan Tracker Module

**Summary:** Created Work Plan Tracker module for Project Leads and Project Managers to track work plan activities across all projects. Also added PO Tracker cards to PM and PL dashboards.

**Files Created:**
- `nirmaan_stack/api/seven_days_planning/get_projects_with_stats.py` - Backend API for project work plan statistics with role-based filtering
- `frontend/src/pages/WorkPlanTracker/types/index.ts` - TypeScript interfaces for work plan stats
- `frontend/src/pages/WorkPlanTracker/utils.ts` - Status styling helpers and constants
- `frontend/src/pages/WorkPlanTracker/components/WorkPlanProjectCard.tsx` - Project card with progress circle and status breakdown
- `frontend/src/pages/WorkPlanTracker/work-plan-tracker-list.tsx` - List view with search and project cards grid
- `frontend/src/pages/WorkPlanTracker/work-plan-tracker-detail.tsx` - Detail view reusing SevendaysWorkPlan component

**Files Modified:**
- `frontend/src/components/helpers/routesConfig.tsx` - Added routes for /work-plan-tracker and /work-plan-tracker/:projectId
- `frontend/src/components/layout/NewSidebar.tsx` - Added Work Plan Tracker sidebar item with Calendar icon
- `frontend/src/components/layout/dashboards/dashboard-pm.tsx` - Added PO Tracker and Work Plan Tracker cards
- `frontend/src/components/layout/dashboards/dashboard-pl.tsx` - Added PO Tracker and Work Plan Tracker cards

**Features:**
- Project list view showing all projects with milestone tracking enabled
- Progress circle showing overall work plan completion percentage
- Status breakdown: Pending, In Progress, Completed activity counts
- Role-based filtering: PM/PL see only assigned projects; Admin/PMO see all
- Detail view shows SevendaysWorkPlan component without date filters
- Dashboard cards on both PM and PL dashboards for quick access
- Search by project name in list view

**Access Control:**
- Sidebar: Admin, PMO Executive, Project Lead, Project Manager
- Data filtering: Uses Nirmaan User Permissions for PM/PL roles

---

### 2026-01-10: Multi-Select Project Assignees with User Permission Creation

**Summary:** Replaced single-select assignees with react-select multi-select, creating User Permissions after project creation instead of storing in Project document.

**Files Created:**
- `frontend/src/components/ui/project-creation-dialog.tsx` - Two-stage progress dialog

**Files Modified:**
- `frontend/src/pages/projects/project-form/schema.ts` - New assignees structure with label/value arrays
- `frontend/src/pages/projects/project-form/index.tsx` - Multi-stage submission with User Permission creation
- `frontend/src/pages/projects/project-form/steps/ProjectAssigneesStep.tsx` - React-select multi-select UI
- `frontend/src/pages/projects/project-form/steps/ReviewStep.tsx` - Multi-select assignees display
- `frontend/src/pages/projects/project-form/steps/ProjectAddressStep.tsx` - City/state draft resume fix
- `frontend/src/pages/projects/project-form/steps/*.tsx` - Standardized navigation buttons
- `frontend/src/zustand/useProjectDraftStore.ts` - Updated for new assignees schema

**Features:**
- Multi-select for Project Leads, Project Managers, Procurement Executives
- Removed Accountant selection (accountants now see all projects)
- User Permissions created after project (not stored in Project document)
- Two-stage progress dialog: "Creating project..." → "Assigning team members..."
- Standardized navigation: "← Previous" / "Continue →" across all steps
- Fixed city/state reset bug when resuming drafts

---

### 2026-01-10: Customer Validation and Dialog Redesign

**Summary:** Added customer validation across project forms and financial dialogs, with enterprise minimalist UI redesign.

**Files Modified:**
- `frontend/src/pages/projects/project-form/steps/ProjectDetailsStep.tsx` - Added conditional customer message (success/warning)
- `frontend/src/pages/projects/edit-project-form.tsx` - Made customer optional, added validation message
- `frontend/src/pages/projects/ProjectOverviewTab.tsx` - Added warning banner when project has no customer
- `frontend/src/pages/inflow-payments/components/NewInflowPayment.tsx` - Full UI redesign with emerald theme
- `frontend/src/pages/inflow-payments/components/EditInflowPayment.tsx` - Full UI redesign with amber theme
- `frontend/src/pages/ProjectInvoices/components/NewProjectInvoiceDialog.tsx` - Full UI redesign with customer validation
- `frontend/src/pages/ProjectInvoices/components/EditProjectInvoiceDialog.tsx` - Full UI redesign with customer validation

**Features:**
- Customer validation: prevents invoice/inflow creation when project has no customer
- Conditional messages: green success when customer selected, amber warning when missing
- Enterprise minimalist design: dark gradient headers, badge-style context displays
- Color-coded themes: emerald for create dialogs, amber for edit dialogs
- Filename truncation (25 chars) for attachment displays
- Removed sessionStorage dependency from invoice dialog project selector

---

### 2026-01-10: Project Creation Wizard - Modular Architecture with Draft System

**Summary:** Refactored 1900+ line monolithic project form into modular step-based architecture with localStorage draft persistence.

**Files Created:**
- `frontend/src/pages/projects/project-form/index.tsx` - Main orchestrator component
- `frontend/src/pages/projects/project-form/schema.ts` - Zod schema and types
- `frontend/src/pages/projects/project-form/constants.ts` - Wizard config, GST options
- `frontend/src/pages/projects/project-form/hooks/useProjectFormData.ts` - Data fetching hook
- `frontend/src/pages/projects/project-form/steps/ProjectDetailsStep.tsx`
- `frontend/src/pages/projects/project-form/steps/ProjectAddressStep.tsx`
- `frontend/src/pages/projects/project-form/steps/ProjectTimelineStep.tsx`
- `frontend/src/pages/projects/project-form/steps/ProjectAssigneesStep.tsx`
- `frontend/src/pages/projects/project-form/steps/PackageSelectionStep.tsx`
- `frontend/src/pages/projects/project-form/steps/ReviewStep.tsx`
- `frontend/src/pages/projects/project-form/steps/index.ts` - Barrel export
- `frontend/src/zustand/useProjectDraftStore.ts` - Draft persistence store
- `frontend/src/hooks/useProjectDraftManager.ts` - Draft management hook
- `frontend/src/components/ui/wizard-steps.tsx` - Reusable wizard progress component
- `frontend/src/components/ui/form-field-row.tsx` - Form layout helpers
- `frontend/src/components/ui/review-section.tsx` - Review step components
- `frontend/src/components/ui/package-review-card.tsx` - Package display card
- `frontend/src/components/ui/draft-indicator.tsx` - Save status indicator
- `frontend/src/components/ui/draft-cancel-dialog.tsx` - Cancel confirmation dialog
- `frontend/src/components/ui/draft-resume-dialog.tsx` - Resume draft dialog

**Features:**
- 6-step wizard: Details → Address → Timeline → Assignees → Packages → Review
- Auto-save drafts to localStorage with 1.5s debounce
- 30-day draft expiry with resume/discard options
- Each step ~150-250 lines (down from 1900+ monolith)
- Reusable UI components for other wizards

**Files Retired:**
- `frontend/src/pages/Retired Components/project-form.tsx` - Original monolith (kept for reference)

---

### 2026-01-10: Remarks Functionality for PO and Work Orders (SR)

**Summary:** Added role-based remarks system for Purchase Orders and Service Requests (Work Orders), allowing Accountant, Procurement, and Admin users to add categorized remarks with full audit trail.

**Backend Files Created:**
- `nirmaan_stack/api/po_remarks.py` - PO remarks API (add, get, delete, count, recent)
- `nirmaan_stack/api/sr_remarks.py` - SR remarks API (add, get, delete, count, recent)

**Frontend Files Created:**
- `frontend/src/pages/ProcurementOrders/purchase-order/hooks/usePORemarks.ts` - PO remarks hooks
- `frontend/src/pages/ProcurementOrders/purchase-order/components/PORemarks.tsx` - Full remarks section for PO summary
- `frontend/src/pages/ProcurementOrders/purchase-order/components/PORemarksPopover.tsx` - Inline popover for PO tables
- `frontend/src/pages/reports/components/columns/PORemarksHoverCard.tsx` - Hover card for PO reports
- `frontend/src/pages/ServiceRequests/approved-sr/hooks/useSRRemarks.ts` - SR remarks hooks
- `frontend/src/pages/ServiceRequests/approved-sr/components/SRRemarks.tsx` - Full remarks section for SR summary
- `frontend/src/pages/ServiceRequests/approved-sr/components/SRRemarksPopover.tsx` - Inline popover for SR tables
- `frontend/src/pages/reports/components/columns/SRRemarksHoverCard.tsx` - Hover card for SR reports

**Frontend Files Modified:**
- `PurchaseOrder.tsx` - Integrated PORemarks section
- `release-po-select.tsx` - Added remarks column with popover
- `poColumns.tsx` - Added remarks column (last) to PO reports
- `ApprovedSRView.tsx` - Integrated SRRemarks section
- `approved-sr-list.tsx` - Added remarks column with popover
- `srColumns.tsx` - Added remarks column (last) to SR reports

**Features:**
- Role-based categorization (Accountant, Procurement, Admin remarks)
- Reuses existing `Nirmaan Comments` doctype with `comment_type: "po_remark"` or `"sr_remark"`
- Tab filtering by remark category
- Users can only delete their own remarks
- Hover cards in reports show last 3 remarks
- Ctrl+Enter keyboard shortcut to submit remarks

**Data Model:**
```
Nirmaan Comments:
  comment_type: "po_remark" | "sr_remark"
  reference_doctype: "Procurement Orders" | "Service Requests"
  reference_name: <document ID>
  subject: "accountant_remark" | "procurement_remark" | "admin_remark"
  content: <remark text>
  comment_by: <user email>
```

---

### 2026-01-10: UI Refactoring and Mobile View Enhancements

**Summary:** Refactored InFlowPayments component and added Progress UI component.

**Files Created:**
- `frontend/src/components/ui/progress.tsx` - New shadcn/ui Progress component

**Files Modified:**
- `frontend/src/pages/inflow-payments/InFlowPayments.tsx` - Refactored to use extracted InflowSummaryCard component, removed unused code
- `frontend/src/pages/projects/projects.tsx` - Updated hook import (useCredits → useProjectAllCredits)

---

### 2026-01-09: Asset Management Frontend - Full UI Implementation

**Summary:** Built complete frontend for asset management including dashboard, asset lists, assignment workflow, and detail pages.

**Files Created (Frontend):**
- `frontend/src/pages/Assets/AssetsPage.tsx` - Main dashboard with tabs (Categories, All Assets, Assigned, Unassigned, Pending Declaration)
- `frontend/src/pages/Assets/AssetOverview.tsx` - Individual asset detail page with assignment controls
- `frontend/src/pages/Assets/assets.constants.ts` - Constants for asset conditions, doctypes, fields
- `frontend/src/pages/Assets/components/` - 10 component files:
  - `AddAssetDialog.tsx`, `AddAssetCategoryDialog.tsx` - Creation dialogs
  - `AssetCategoriesList.tsx`, `AssetMasterList.tsx` - Data table views
  - `AssignedAssetsList.tsx`, `UnassignedAssetsList.tsx`, `PendingActionsList.tsx` - Filtered asset views
  - `AssignAssetDialog.tsx`, `UnassignAssetDialog.tsx` - Assignment workflow dialogs
  - `AssetsSummaryCard.tsx` - Dashboard summary cards

**Files Modified:**
- `frontend/src/components/helpers/routesConfig.tsx` - Added `/asset-management` routes (avoiding Frappe's `/assets` static path)
- `frontend/src/components/layout/NewSidebar.tsx` - Added Assets menu item for Admin/HR/PMO roles
- `frontend/src/index.css` - Added `.scrollbar-hide` utility class

**Backend Field Added:**
- `nirmaan_stack/doctype/asset_master/asset_master.json` - Added `asset_value` (Currency) field

**Features:**
- Role-based access (Admin, HR, PMO get full CRUD; others read-only)
- IT credential visibility restricted to assigned user or admin roles
- Assignment workflow with declaration attachment upload
- Pending declaration tracking with upload action
- Responsive design with mobile-optimized views

---

### 2026-01-09: Asset Management - Security & Sync Improvements

**Summary:** Fixed security issues, added assignment sync, and improved field naming.

**Changes:**

1. **Security Fix** (Asset Master):
   - `asset_email_password` → Password fieldtype (encrypted)
   - `asset_pin` → Password fieldtype (encrypted)

2. **New Field** (Asset Master):
   - `current_assignee` (Link to Nirmaan Users, read-only) - Auto-synced from Asset Management

3. **Field Naming Fix** (Asset Management):
   - `asset_name` → `asset` (fieldname) with label "Asset"
   - `asset_assigned_to` label → "Assigned To"
   - Both fields now required and visible in list view

4. **Sync Hooks** (Asset Management):
   - `after_insert`: Sets `current_assignee` on Asset Master
   - `on_update`: Updates `current_assignee` on Asset Master
   - `on_trash`: Clears `current_assignee` on Asset Master

**Files Created:**
- `integrations/controllers/asset_management.py` - Sync hooks

**Files Modified:**
- `hooks.py` - Added Asset Management doc_events
- `asset_master.json` - Password fields, new current_assignee field
- `asset_management.json` - Fixed field naming, added required constraints

---

### 2026-01-09: Asset Management Doctypes - Permissions & Autoname

**Summary:** Added Nirmaan role permissions to all Asset doctypes and implemented custom autoname for Asset Master.

**Changes:**

1. **Role Permissions Added** (all 3 doctypes):
   - Full CRUD: System Manager, Nirmaan HR Executive, Nirmaan PMO Executive
   - Read-only: All other Nirmaan roles (Project Lead, Project Manager, Procurement Executive, Accountant, Estimates Executive, Design Lead, Design Executive)

2. **Asset Master Autoname**:
   - Format: `ASSET-<first 3 letters of category>-###`
   - Examples: `ASSET-LAP-001` (Laptop), `ASSET-MOB-001` (Mobile Phone)
   - Implemented in `asset_master.py` using `make_autoname()`

3. **Field Updates** (Asset Master):
   - `asset_name` - Now required, visible in list view
   - `asset_category` - Now required, visible in list view

---

### 2026-01-09: Asset Management Doctypes Added

**Summary:** Three new doctypes created for tracking company assets and their assignment to users.

**Doctypes Created:**
- `Asset Category` - Master list of asset categories (autonamed by `asset_category` field)
- `Asset Master` - Asset inventory with details, serial numbers, and IT credentials
- `Asset Management` - Tracks asset assignments to Nirmaan Users with declaration attachments

**Relationships:**
- Asset Master links to Asset Category
- Asset Management links to Asset Master and Nirmaan Users

---

### 2026-01-09: User Management Improvements

**Summary:** Added user creation and password reset APIs with graceful email failure handling. Improved error handling and logging throughout Nirmaan Users sync and lifecycle operations.

**Files Modified:**
- `api/users.py` - Added `create_user()` and `reset_password()` APIs
- `nirmaan_stack/doctype/nirmaan_users/nirmaan_users.py` - Improved sync logic with robust error handling
- `integrations/controllers/nirmaan_users.py` - Enhanced `on_trash` with granular error handling
- `frontend/src/hooks/useUserSubmitHandlers.ts` - Updated handlers for new APIs
- `frontend/src/pages/users/components/UserRowActions.tsx` - Updated password reset flow
- `frontend/src/pages/users/user-form.tsx` - Updated to use new create_user API

**Features:**
- Graceful email failure handling (user created even if welcome email fails)
- Detailed error logging for sync and email failures
- Defensive checks in on_trash for missing Frappe User
- User-friendly error messages for email configuration issues

---

### 2025-01-08: User Email Rename Feature

**Summary:** Added ability for admins to rename user email addresses with cascading updates across all linked records.

**Files Modified:**
- `api/users.py` - Added `rename_user_email()` API endpoint
- `integrations/controllers/nirmaan_users.py` - Added `after_rename()` hook
- `hooks.py` - Registered `after_rename` hook for Nirmaan Users
- `frontend/src/hooks/useUserSubmitHandlers.ts` - Added `handleRenameEmail()` handler
- `frontend/src/pages/users/user-profile.tsx` - Added Rename Email button and dialog

**Features:**
- Admin-only email rename with cascading updates
- Automatic Link field updates via Frappe's `rename_doc()`
- Manual update for Data fields (`Nirmaan User Permissions.user`)
- Force logout of renamed user
- PostgreSQL-compatible SQL queries
