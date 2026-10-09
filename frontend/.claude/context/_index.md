# Frontend Context Documentation Index

This directory contains reference documentation for the Nirmaan Stack frontend. Load these files on-demand when working on related tasks.
How frontend code is written (data access, state, forms, tables, effects, dates, RBAC, F1–F5, tests): `../../CODING_STANDARDS.md` (`frontend/CODING_STANDARDS.md`).

---

## Active Plans

| Plan | Feature | Status |
|------|---------|--------|
| [boq-upload-plan.md](../plans/boq-upload-plan.md) | BoQ Upload & Management | Phases 1.x + 3 + 4 complete; Phase 5 (commit + pricing editor) active. Live status + full per-slice as-built detail. |

---

## Available Context Files

| File | Domain | When to Load |
|------|--------|--------------|
| [domain/boq-frontend.md](./domain/boq-frontend.md) | BoQ frontend | Wizard + review-screen load-bearing invariants (top), pricing-editor component contracts, full per-slice as-built detail (relocated from frontend/CLAUDE.md 2026-06-25). Backend: `../../.claude/context/domain/boq-backend.md` |
| [domain/boq-pricing-editor-frontend.md](./domain/boq-pricing-editor-frontend.md) | BoQ pricing editor (frontend) | Before editing `PricingGrid.tsx` / `SheetPricingPage.tsx`: load-bearing invariants (gates, formulas, Category column, rate-helper chassis, virtualization, BCS block, view filters). Backend: `../../.claude/context/domain/boq-pricing-editor.md` |
| [domain/pricing-rate-master-frontend.md](./domain/pricing-rate-master-frontend.md) | Pricing Module + Rate Master (frontend) | Rate-helper panel attribute semantics, the HVAC/Electrical/ELV workbook pages, and the Rate Master (RM-2) screens incl. RM-4a/RM-4b admin editing. Relocated from frontend/CLAUDE.md 2026-08-19 |
| [data-tables.md](./data-tables.md) | DataTable System | useServerDataTable hook, DataTable component, export, backend API, search strategies |
| [role-access.md](./role-access.md) | Access Control | Role checks, sidebar visibility, page permissions |
| [testing.md](./testing.md) | Feature Testing | After implementing forms, dialogs, persistence, multi-step workflows |
| [websocket.md](./websocket.md) | Real-time | Socket.IO events, notifications, publish_realtime, proxy config |
| [domain/customers.md](./domain/customers.md) | Customers | Customer CRUD, financials, inflows, project relationships |
| [domain/invoices.md](./domain/invoices.md) | Invoices | PO/SR invoices, 2B reconciliation, date filters |
| [domain/milestones.md](./domain/milestones.md) | Milestones | Daily progress reports, zone tracking, work headers |
| [domain/projects.md](./domain/projects.md) | Projects | Project status lifecycle, ProjectSelect component, status restrictions |
| [domain/po-revisions.md](./domain/po-revisions.md) | PO Revisions | PO revision lifecycle, revision commits and carry behaviour |
| [domain/po-merge.md](./domain/po-merge.md) | PO Merge | Merging purchase orders, merge constraints and side effects |
| [domain/vendor-hold.md](./domain/vendor-hold.md) | Vendor Hold | Vendor hold status, blocked operations, guard hooks |
| [domain/commissioning-report-templates.md](./domain/commissioning-report-templates.md) | Commissioning Reports | Commissioning report templates and generation |
| [domain/ceo-hold.md](./domain/ceo-hold.md) | CEO Hold | Project hold status, blocked operations, guard hooks |
| [domain/delivery-notes.md](./domain/delivery-notes.md) | Delivery Notes | DN doctype, DN Item child table, APIs, received_quantity, 51-point linkage map |
| [domain/po-status-map.md](./domain/po-status-map.md) | PO Status | Full PO status lifecycle, all codebase usage (28 frontend + 19 backend files), cross-module linkages, DataTable/API call map |
| [domain/po-adjustments.md](./domain/po-adjustments.md) | PO Adjustments | PO payment adjustment system, double-entry accounting, manual resolution dialog |

### Module References (in-code)

| Module | Location | Key Files |
|--------|----------|-----------|
| Assets | `src/pages/Assets/` | `assets.constants.ts` for doctypes/fields |
| Customers | `src/pages/customers/` | `customers.constants.ts`, `CustomerFinancials.tsx`, `CustomerOverview.tsx` |
| Critical PO Tracker | `src/pages/CriticalPOTracker/` | `types/index.ts` for interfaces, `utils.ts` for styling |
| Critical PO Tasks (project view) | `src/pages/projects/CriticalPOTasks/` | `utils.tsx` — `filterPOsByPackage` / `buildPRPackageMap`, the ONE PO→PR-tag package rule shared by `components/LinkPODialog.tsx` + `components/EditTaskDialog.tsx`; data layer in `src/pages/projects/data/critical-po/` (`useCriticalPOQueries.ts` — `useProjectPOTaskLinks` / `useAllPOTaskLinks` read the PO's `Critical PO Task Child Table` and attach `task.linked_pos`; `useCriticalPOMutations.ts` — `useUpdatePOTaskLinks`, the only link writer). Badge = stored `linked_po_count` |
| Critical PO Linking | `src/pages/ProcurementOrders/purchase-order/` | `hooks/useCriticalPOTaskLinking.ts`, `components/CriticalPOTaskLinkingSection.tsx` (Dispatch sheet only), `components/LinkedCriticalPOTag.tsx` — the always-visible chips on PO detail, with per-task edit / unlink and a `+ Add Task` multi-select. All three write through `useUpdatePOTaskLinks` (Change = one remove+add call) |
| Invoices | `src/pages/tasks/invoices/` | `config/*.config.ts` for table config |
| Milestones | `src/pages/Manpower-and-WorkMilestones/` | `hooks/useMilestoneReportData.ts`, `utils/milestoneHelpers.ts` |
| PO Remarks | `src/pages/purchase-order/` | `hooks/usePORemarks.ts`, `components/PORemarks.tsx` |
| PR Approve/Edit | `src/pages/ProcurementRequests/ApproveNewPR/` | `hooks/useEditingLock.ts`, `hooks/useApprovePRLogic.ts`, `useApproveNewPRDraftStore.ts` |
| SR Form Wizard | `src/pages/ServiceRequests/sr-form/` | Step-based wizard: `schema.ts`, `constants.ts`, `steps/`, `amend/` |
| SR Remarks | `src/pages/ServiceRequests/approved-sr/` | `hooks/useSRRemarks.ts`, `components/SRRemarks.tsx` |
| DC/MIR Module | `src/pages/DeliveryChallansAndMirs/` | `components/UploadDCMIRDialog.tsx`, `ViewAttachmentsDialog.tsx`, `DCMIRItemSelector.tsx`, `hooks/usePODeliveryDocuments.ts` |
| Delivery Notes (DN) | `src/pages/DeliveryNotes/` | `deliverynotes.tsx` (hub: dashboard/create/view), `deliverynote.tsx` (detail, `?mode=` support), `components/pivot-table/` (pivot subsystem), `components/DNDetailDialog.tsx`, `hooks/useProjectDeliveryNotes.ts`, `hooks/useReturnSubmit.ts` (return notes) |
| Design Tracker | `src/pages/ProjectDesignTracker/` | `types/index.ts` for interfaces, `utils.tsx` for styling, `config/taskTableColumns.tsx` for table, `components/FilesCell.tsx` for file/proof icons. Onboarding and Handover phases, filterable in the task-wise and team-summary views; a task needs an approval proof (file attachment) before its status can be set to Approved |
| Team Performance | `src/pages/ProjectDesignTracker/` | `components/TeamPerformanceSummary.tsx`, inline edit with TaskEditModal, InlineTaskList drill-down |
| Vendor Attachment for PR | `src/pages/ProcurementRequests/` | `components/VendorAttachmentForPR.tsx` for vendor quote attachments |
| Bulk Download Wizard | `src/pages/BulkDownload/` | `BulkDownloadPage.tsx` wizard, `FilterBar.tsx` for vendor/date, step components in `steps/` (PO, WO, Invoice, DC, MIR, DN, MTCs, Client Invoices, Payment Vouchers), downloaded as merged PDFs. ONE module serves the project page's tab and the vendor page's: it takes a `scope` (`project` | `vendor`), and `utils/bulkDownload/bulkDownloadTypes.ts` `allowedBulkTypes(scope, role)` decides the cards, the Quick menu and the voucher and MTC queries (vendor tab: gated by `vendor_type`, no Client Invoices, no Critical POs tab; a vendor's tables facet on Project instead of Vendor via `forScope`). How the two tabs share it: `.claude/context/domain/bulk-download.md`. `useBulkDownloadWizard.ts` hands each step its full eligible list; every step selects through ONE client-side table, `steps/BulkSelectTable.tsx` (the app's in-header facet + date filters; per-type columns in `steps/bulkTableColumns.tsx`). Changing any filter CLEARS the selection, so a download never carries a row the filters hide. PO rate visibility is restricted for Project Managers |
| Bulk PDF Button | `src/components/common/BulkPdfDownloadButton.tsx` | Reusable button with `useBulkPdfDownload.ts` hook |
| Remaining Items (Inventory update page) | `src/pages/remaining-items/` | `index.tsx`, `components/RemainingItemsForm.tsx`, `hooks/useRemainingItemsForm.ts`, cooldown + declaration |
| Inventory Item-Wise | `src/pages/inventory/` | `InventoryItemWisePage.tsx`, `hooks/useInventoryItemWise.ts`, `inventory.types.ts` — cross-project aggregation of the latest submitted Remaining Items Reports, estimated cost from max PO quote rates; virtualized expandable table with category/unit facet filters and CSV export. Sidebar access: Admin, PMO, PL, PM, Procurement |
| Reports | `src/pages/reports/` | `hooks/usePO*.ts` for data, `components/columns/*.tsx` for columns, `config/*.config.ts` for table config |
| Reports: DCs & MIRs | `src/pages/reports/` | `DCMIRReports.tsx`, `InventoryReport.tsx` sub-types with facet filters, HoverCard item popover, Critical PO column |
| PO Adjustments | `src/pages/POAdjustment/` | `POAdjustmentButton.tsx`, `POAdjustmentDialog.tsx`, `POAdjustmentHistory.tsx`, `hooks/usePOAdjustment.ts`, `data/usePOAdjustmentQueries.ts` |
| Vendor Data Hooks | `src/pages/vendors/data/` | `useVendorQueries.ts`, `useVendorMutations.ts` — centralized vendor CRUD with Sentry error capturing |
| Vendor Financial Dialogs | `src/pages/vendors/` | Vendor WO / Material Orders tables show an Amount Due column; the Total Invoiced and Amount Paid cells open `InvoiceDataDialog` / `PaymentsDataDialog` |
| Help Repository | `src/pages/help-repository/` | `types.ts` for schema, `utils/loom-embed.ts` for URL conversion |
| Work Headers | `src/components/` | `workHeaderMilestones.tsx` (config component) |

---

## Quick Reference

### Role Profiles (11 total; full list in `role-access.md`)
- Admin, PMO Executive, Project Lead, Project Manager
- Procurement Executive, Accountant, Estimates Executive, Billing Executive
- Design Lead, Design Executive, HR Executive

### Procurement flow

1. **New PR** → 2. **Approve PR** → 3. **Select Vendors** → 4. **Vendor Quotes** → 5. **Approve Quotes** → 6. **Release PO** → 7. **Delivery Notes** → 8. **Invoices** → 9. **Payments** (`pages/ProcurementRequests/`, `pages/ProcurementOrders/`)

### Key Frontend Patterns

**Role check pattern:**
```typescript
["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile"].includes(role)
```

**User context:**
```typescript
const { role, user_id } = useUserData();
```

**Protected routes:** See `src/utils/auth/ProtectedRoute.tsx`

---

## Directory Structure

```
.claude/
├── CHANGELOG.md          # Session change audit trail
├── settings.local.json   # Local Claude settings
└── context/
    ├── _index.md           # This file
    ├── data-tables.md      # DataTable system: hook, component, export, backend API
    ├── role-access.md      # Role-based access control reference
    ├── testing.md          # Playwright browser testing guide
    ├── websocket.md        # Socket.IO real-time events & notifications
    └── domain/
        ├── boq-frontend.md    # BoQ wizard + review screen invariants, component contracts
        ├── boq-pricing-editor-frontend.md  # BoQ pricing editor invariants
        ├── customers.md       # Customer management & financials
        ├── delivery-notes.md  # DN doctype + child table, APIs, linkage map
        ├── invoices.md        # Invoice management & 2B reconciliation
        ├── milestones.md      # Daily progress reports & zone tracking
        ├── projects.md        # Project status lifecycle & frontend behavior
        ├── ceo-hold.md        # CEO Hold status & blocked operations
        ├── po-status-map.md   # PO status lifecycle & full codebase usage map
        └── po-adjustments.md  # PO payment adjustment system & dialog
```

---

## Related Backend Context

The backend (`nirmaan_stack/`) has additional context files:
- `.claude/context/doctypes.md` - Doctype definitions
- `.claude/context/apis.md` - API endpoints
- `.claude/context/integrations.md` - Frontend-backend integration
- `.claude/context/workflows.md` - Business logic flows
- `.claude/context/patterns.md` - Code examples (the rules are in root `CODING_STANDARDS.md`)

---

## Adding New Context Files

When creating new context files:
1. Keep each file under 300 lines
2. Focus on one domain per file
3. Include file:line references for code locations
4. Update this index with the new file
