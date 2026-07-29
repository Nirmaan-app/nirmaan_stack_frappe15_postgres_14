# Frontend Context Documentation Index

This directory contains reference documentation for the Nirmaan Stack frontend. Load these files on-demand when working on related tasks.

---

## Active Plans

| Plan | Feature | Status |
|------|---------|--------|
| [boq/README.md](../plans/boq/README.md) | BoQ Upload & Management — **design spec** (§1–16). Start here. | Phases 1.x + 3 + 4 complete; Phase 5 (commit + pricing editor) active. |
| [boq/_slices.md](../plans/boq/_slices.md) | BoQ **slice index** — 167 as-built records, one row each. Find a slice here, then open its fragment. | Rotated 2026-07-29 from the former single-file plan doc. |
| [boq/phasing.md](../plans/boq/phasing.md) | BoQ phase plan + per-phase status. Grep, don't load. | — |
| [boq/known-issues.md](../plans/boq/known-issues.md) | BoQ known parser issues register (17.1–17.53). Grep, don't load. | — |
| [boq/decisions/](../plans/boq/decisions/) | BoQ decisions log, chunked by month. Grep, don't load. | — |

---

## Available Context Files

### BoQ frontend — split by surface (2026-07-29)

Load only the surface you are working on. Backend: `../../.claude/context/domain/boq-backend.md`

| File | Surface | When to Load |
|------|---------|--------------|
| [domain/boq-frontend-wizard-upload.md](./domain/boq-frontend-wizard-upload.md) | Upload wizard | Entry points, project picker, upload screen, drop zone, `uploadStatus` lifecycle, socket listeners, parse-completion modal, on-mount + reconnect recovery |
| [domain/boq-frontend-hub.md](./domain/boq-frontend-hub.md) | Hub | Hub route, back-navigation, cards, button set, general-specs derivation, ParseRunDialog, dirty markers, visual conventions |
| [domain/boq-frontend-sheet-config.md](./domain/boq-frontend-sheet-config.md) | Sheet config / spoke | SheetConfigPanel, spoke shell, SheetDataGrid, column-role mapping, SheetSearchView, RestructureModal, `confirmedFields` keys |
| [domain/boq-frontend-review-screen.md](./domain/boq-frontend-review-screen.md) | Review screen | ReviewTree contract, `wizard_status` + Finalized freeze, exports, C-flag dismissal, find-&-filter, detail-panel layout, Force Re-parse |
| [domain/boq-frontend-pricing-grid.md](./domain/boq-frontend-pricing-grid.md) | Pricing — grid contract | Keyboard-nav matrix, row memoization, read-only gating, asymmetric rate-edit gate, Esc-to-exit, annotation rendering |
| [domain/boq-frontend-pricing-rollup.md](./domain/boq-frontend-pricing-rollup.md) | Pricing — rollup & reconciliation | `pricingRollup` + SummaryPanel, `priceability.ts`, incomplete subtotals, Cluster B store, DOC-0 flip |
| [domain/boq-frontend-pricing-layout.md](./domain/boq-frontend-pricing-layout.md) | Pricing — layout & nav | SheetPricingPage, parent click-to-jump, frozen-left panes, two-pane split, scroll/jump retarget |
| [domain/boq-frontend-pricing-controls.md](./domain/boq-frontend-pricing-controls.md) | Pricing — controls & commit | Collapse/expand all, per-sheet lock/unlock, `pricingRowPropsAreEqual`, hub footer toolbar, CommitDialog preflight, Review S2 / ADR-0008 |
| [domain/boq-frontend-revised-boq.md](./domain/boq-frontend-revised-boq.md) | Revised BoQ / ADR-0014 | Hub card redesign, header two-row refactor, Revised BoQ S2–S4, Amendments B–E, template review + quantity keyboard nav |
| [domain/boq-frontend-as-built-log.md](./domain/boq-frontend-as-built-log.md) | ⚠️ HISTORICAL | Quarantined rolling as-built narrative. **Do not load, do not extend.** Per-slice detail belongs in `plans/boq/slices/`; pending a duplication check |

### Other domains

| File | Domain | When to Load |
|------|--------|--------------|
| [data-tables.md](./data-tables.md) | DataTable System | useServerDataTable hook, DataTable component, export, backend API, search strategies |
| [coding-standards.md](./coding-standards.md) | Standards | Date formats, react-select patterns, Radix dialog fixes |
| [react-patterns.md](./react-patterns.md) | React | useEffect anti-patterns, TanStack Table deps, Vercel best practices |
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
| Critical PO Linking | `src/pages/ProcurementOrders/purchase-order/` | `hooks/useCriticalPOTaskLinking.ts`, `components/CriticalPOTaskLinkingSection.tsx` |
| Invoices | `src/pages/tasks/invoices/` | `config/*.config.ts` for table config |
| Milestones | `src/pages/Manpower-and-WorkMilestones/` | `hooks/useMilestoneReportData.ts`, `utils/milestoneHelpers.ts` |
| PO Remarks | `src/pages/purchase-order/` | `hooks/usePORemarks.ts`, `components/PORemarks.tsx` |
| PR Approve/Edit | `src/pages/ProcurementRequests/ApproveNewPR/` | `hooks/useEditingLock.ts`, `hooks/useApprovePRLogic.ts`, `useApproveNewPRDraftStore.ts` |
| SR Form Wizard | `src/pages/ServiceRequests/sr-form/` | Step-based wizard: `schema.ts`, `constants.ts`, `steps/`, `amend/` |
| SR Remarks | `src/pages/ServiceRequests/approved-sr/` | `hooks/useSRRemarks.ts`, `components/SRRemarks.tsx` |
| DC/MIR Module | `src/pages/DeliveryChallansAndMirs/` | `components/UploadDCMIRDialog.tsx`, `ViewAttachmentsDialog.tsx`, `DCMIRItemSelector.tsx`, `hooks/usePODeliveryDocuments.ts` |
| Delivery Notes (DN) | `src/pages/DeliveryNotes/` | `deliverynotes.tsx` (hub: dashboard/create/view), `deliverynote.tsx` (detail, `?mode=` support), `components/pivot-table/` (pivot subsystem), `components/DNDetailDialog.tsx`, `hooks/useProjectDeliveryNotes.ts`, `hooks/useReturnSubmit.ts` (return notes) |
| Design Tracker | `src/pages/ProjectDesignTracker/` | `types/index.ts` for interfaces, `utils.tsx` for styling, `config/taskTableColumns.tsx` for table, `components/FilesCell.tsx` for file/proof icons |
| Team Performance | `src/pages/ProjectDesignTracker/` | `components/TeamPerformanceSummary.tsx`, inline edit with TaskEditModal, InlineTaskList drill-down |
| Vendor Attachment for PR | `src/pages/ProcurementRequests/` | `components/VendorAttachmentForPR.tsx` for vendor quote attachments |
| Bulk Download Wizard | `src/pages/BulkDownload/` | `BulkDownloadPage.tsx` wizard, `FilterBar.tsx` for vendor/date, step components in `steps/` (PO, WO, Invoice, DC, MIR, DN) |
| Bulk PDF Button | `src/components/common/BulkPdfDownloadButton.tsx` | Reusable button with `useBulkPdfDownload.ts` hook |
| Remaining Items (Inventory) | `src/pages/remaining-items/` | `index.tsx`, `components/RemainingItemsForm.tsx`, `hooks/useRemainingItemsForm.ts`, cooldown + declaration |
| Inventory Item-Wise | `src/pages/inventory/` | `InventoryItemWisePage.tsx`, `hooks/useInventoryItemWise.ts`, `inventory.types.ts` — cross-project aggregation with estimated cost |
| Reports | `src/pages/reports/` | `hooks/usePO*.ts` for data, `components/columns/*.tsx` for columns, `config/*.config.ts` for table config |
| Reports: DCs & MIRs | `src/pages/reports/` | `DCMIRReports.tsx`, `InventoryReport.tsx` sub-types with facet filters, HoverCard item popover, Critical PO column |
| PO Adjustments | `src/pages/POAdjustment/` | `POAdjustmentButton.tsx`, `POAdjustmentDialog.tsx`, `POAdjustmentHistory.tsx`, `hooks/usePOAdjustment.ts`, `data/usePOAdjustmentQueries.ts` |
| Vendor Data Hooks | `src/pages/vendors/data/` | `useVendorQueries.ts`, `useVendorMutations.ts` — centralized vendor CRUD with Sentry error capturing |
| Help Repository | `src/pages/help-repository/` | `types.ts` for schema, `utils/loom-embed.ts` for URL conversion |
| Work Headers | `src/components/` | `workHeaderMilestones.tsx` (config component) |

---

## Quick Reference

### Role Profiles (10 total)
- Admin, PMO Executive, Project Lead, Project Manager
- Procurement Executive, Accountant, Estimates Executive
- Design Lead, Design Executive, HR Executive

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
    ├── coding-standards.md # Date formats, react-select, Radix dialog patterns
    ├── react-patterns.md   # useEffect anti-patterns, Vercel best practices
    ├── role-access.md      # Role-based access control reference
    ├── testing.md          # Playwright browser testing guide
    ├── websocket.md        # Socket.IO real-time events & notifications
    └── domain/
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
- `.claude/context/patterns.md` - Code conventions

---

## Adding New Context Files

When creating new context files:
1. Keep each file under 300 lines
2. Focus on one domain per file
3. Include file:line references for code locations
4. Update this index with the new file
