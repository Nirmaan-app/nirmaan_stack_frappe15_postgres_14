# Claude Code Session Changelog

This file tracks significant changes made by Claude Code sessions.

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
