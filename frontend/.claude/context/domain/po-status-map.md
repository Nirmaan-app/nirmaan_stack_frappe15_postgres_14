# PO Status — Full Codebase Usage Map

## Status Values
| Status | Type | Description |
|--------|------|-------------|
| PO Approved | Normal progression | Initial approved state |
| Partially Dispatched | Normal progression | Some items dispatched to vendor (manual, item-level) |
| Dispatched | Normal progression | All items dispatched to vendor (manual) |
| Partially Delivered | Normal progression | Some items received (auto-calc) |
| Delivered | Normal progression | All items received (auto-calc) |
| PO Amendment | Side-track | Under revision review |
| Merged | Side-track | Consolidated into master PO |
| Inactive | Side-track | Archived (rarely used for POs) |
| Cancelled | Terminal | Voided |

## Frontend — Files That MODIFY PO Status

### 1. PODetails.tsx
**Path:** `src/pages/ProcurementOrders/purchase-order/components/PODetails.tsx`
| Action | Function | Transition | API | Lines |
|--------|----------|------------|-----|-------|
| Mark Dispatched Items | handleDispatchPO() | PO Approved → Partially Dispatched / Dispatched | useFrappeUpdateDoc | ~267-328 |
| Revert PO | handleRevertPO() | Dispatched/Partially Dispatched → PO Approved | useFrappeUpdateDoc | ~336-384 |
| Mark as Inactive | handleInactivePO() | Any → Inactive | useFrappeUpdateDoc | ~446-471 |

Side effects: invalidateSidebarCounts(), toast, navigation redirect

### 2. PurchaseOrder.tsx
**Path:** `src/pages/ProcurementOrders/purchase-order/PurchaseOrder.tsx`
| Action | Function | Transition | API | Lines |
|--------|----------|------------|-----|-------|
| Amend PO | handleAmendPo() | PO Approved → PO Amendment | useFrappeUpdateDoc | ~738-852 |
| Merge POs | handleMergePOs() | Multiple → Merged (backend) | po_merge_and_unmerge.handle_merge_pos | ~645-696 |
| Unmerge POs | handleUnmergePOs() | Merged → PO Approved (backend) | po_merge_and_unmerge.handle_unmerge_pos | ~698-735 |
| Cancel PO | handleCancelPo() | Any → Cancelled (backend) | handle_cancel_po.handle_cancel_po | ~854-884 |

### 3. approve-amend-po.tsx
**Path:** `src/pages/ProcurementOrders/amend-po/approve-amend-po.tsx`
| Action | Function | Transition | API | Lines |
|--------|----------|------------|-----|-------|
| Approve Amendment | handleAction('approve') | PO Amendment → PO Approved | approve_amend_po.approve_amend_po_with_payment_terms | ~176-190 |
| Revert to Original | handleAction('revert') | PO Amendment → PO Approved | approve_amend_po.revert_from_amend_po | ~191-218 |

## Frontend — Files That DISPLAY/FILTER by PO Status

### Tab & Config Files
| File | What | Lines |
|------|------|-------|
| `config/poTabs.constants.ts` | Tab definitions + count keys (po.PO Approved, po.Partially Dispatched, po.Dispatched, etc.) | 10-36 |
| `config/purchaseOrdersTable.config.ts` | Status filter options, tab-based query filters, base exclusion of Merged/PO Amendment/Inactive | 27-63 |

### Dashboards & Counts
| File | What | Statuses |
|------|------|----------|
| `components/layout/dashboards/procurement-dashboard.tsx` | Dashboard cards with counts + links | PO Approved, Partially Dispatched, Dispatched, Partially Delivered, Delivered |
| `components/layout/dashboards/dashboard-pl.tsx` | PL dashboard PO Amendment count | PO Amendment |
| `components/layout/dashboards/estimates-executive-dashboard.tsx` | Excludes Merged, PO Amendment from count | Merged, PO Amendment |
| `zustand/useDocCountStore.ts` | Sidebar badge counts store (interface + defaults) | All 8 statuses |

### PO List & Detail Pages
| File | What | Statuses Used |
|------|------|---------------|
| `release-po-select.tsx` | Status badge colors (gray/blue/green/red), tab filtering | All |
| `PurchaseOrder.tsx` | DN accordion visibility, merge eligibility filter | Partially Dispatched, Dispatched, Partially Delivered, Delivered, PO Approved |
| `PODetails.tsx` | Badge colors, conditional UI (dispatch/revert buttons, payment terms, delivery metrics) | All |
| `POAttachments.tsx` | Invoice/MIR section visibility | Delivered, Partially Delivered |
| `approve-select-amend-po.tsx` | Fetches POs with status=PO Amendment | PO Amendment |

### Reports
| File | What | Statuses |
|------|------|----------|
| `reports/components/POReports.tsx` | Pending Invoices (PD/D), Excess Payments (PD/D), Dispatched 1+ days | Partially Delivered, Delivered, Dispatched |
| `reports/hooks/usePOAttachmentReconcileData.ts` | Attachment reconciliation | Delivered, Partially Delivered |
| `reports/hooks/useDNDCQuantityData.ts` | DN > DC quantity report | Delivered, Partially Delivered |
| `reports/config/poAttachmentReconcileTable.config.ts` | Filter dropdown options | Delivered, Partially Delivered |
| `reports/store/useReportStore.ts` | Report type definitions | Dispatched |

### Delivery Notes
| File | What | Statuses |
|------|------|----------|
| `pages/DeliveryNotes/constants.ts` | Badge color mapping (orange/green) | Partially Dispatched, Dispatched, Partially Delivered, Delivered |

### Bulk Download
| File | What | Statuses |
|------|------|----------|
| `pages/BulkDownload/useBulkDownloadWizard.ts` | Excludes Merged/Inactive/PO Amendment/Cancelled; DN list uses PD/D | All |
| `pages/BulkDownload/steps/POSteps.tsx` | Color map for status badges | Partially Delivered, Dispatched, Delivered |

### Vendor & Other
| File | What | Statuses |
|------|------|----------|
| `vendors/components/VendorMaterialOrdersTable.tsx` | Excludes Merged/Inactive/PO Amendment; delivery info for PD/D | Merged, Inactive, PO Amendment, Partially Delivered, Delivered |
| `components/pr-summary.tsx` | DN section filters | Dispatched, Delivered, Partially Delivered |
| `config/queryKeys.ts` | getPOReportListOptions, getPOForProjectInvoiceOptions | Dispatched, PD, D; excludes Merged/Cancelled/PO Amendment/Inactive |
| `pages/PORevision/components/Step2/Step2NegativeFlow.tsx` | Status color badges for revision candidates | PO Approved, Dispatched, Partially Delivered |
| `ProcurementRequests/.../HistoricalQuotesHoverCard.tsx` | Navigation link to Dispatched PO tab | Dispatched |
| `tasks/invoices/components/columns.tsx` | Invoice PO link | Dispatched |

## Backend — Files That SET/TRANSITION PO Status

### 1. approve_amend_po.py
**Path:** `nirmaan_stack/api/approve_amend_po.py`
- Line 149: `po_doc.status = "PO Approved"` — approve_amend_po_with_payment_terms()
- Line 232: `po_doc.status = status` — revert_from_amend_po() (usually "PO Approved")

### 2. po_merge_and_unmerge.py
**Path:** `nirmaan_stack/api/po_merge_and_unmerge.py`
- Line 36: `new_po_doc.status = "PO Approved"` — new master PO
- Line 98: `set_value(..., "status", "Merged")` — mark source POs
- Line 161: `set_value(..., "status", "PO Approved")` — unmerge restores

### 3. handle_cancel_po.py
**Path:** `nirmaan_stack/api/handle_cancel_po.py`
- Line 76: `po_doc.status = "Cancelled"` — creates Sent Back Category, then cancels

### 4. delivery_notes controller
**Path:** `nirmaan_stack/integrations/controllers/delivery_notes.py`
- Lines 61-64: If undispatched items remain → status stays "Partially Dispatched" (sticky); otherwise `calculate_order_status()` — auto-calc on DN on_update/on_trash

### 5. update_delivery_note.py
**Path:** `nirmaan_stack/api/delivery_notes/update_delivery_note.py`
- Lines 203-240: `calculate_order_status()` — returns Delivered/Partially Delivered based on received vs ordered qty

### 6. revision_logic.py
**Path:** `nirmaan_stack/api/po_revisions/revision_logic.py`
- Line 388: `original_po.status = calculate_order_status(updated_items)` — recalc after revision sync

### 7. procurement_orders controller (on_update hook)
**Path:** `nirmaan_stack/integrations/controllers/procurement_orders.py`
- Line 88: Reads status=="PO Approved" → deletes old Approved Quotations
- Line 80: `validate()` — prevents reverting Partially Dispatched/Dispatched → PO Approved if DNs exist
- Line 102-109: Detects Partially Dispatched → PO Approved → clears all is_dispatched flags
- Line 112-114: Detects PO Approved/Partially Dispatched → Dispatched/PD/D → creates AQs if all items dispatched
- Line 116: Detects status=="Cancelled" → deletes PO document
- Line 119: Detects PO Approved → PO Amendment → sends notifications, emits po:amended

## Backend — Files That READ/FILTER PO Status

| File | Filter | Purpose |
|------|--------|---------|
| `api/procurement_orders.py:18` | not in [Merged, Inactive, PO Amendment] | PO summary per project |
| `api/sidebar_counts.py:27-35` | GROUP BY status | Sidebar badge counts |
| `api/sidebar_counts.py:152` | not in [Merged, Inactive, PO Amendment] | Credit calculations |
| `api/credits/get_credits_list.py:68,127,287` | NOT IN (Merged, Inactive, PO Amendment) | Credit term queries |
| `api/delivery_challans_data.py:24,157` | in [Partially Dispatched, Partially Delivered, Delivered] | DC creation eligibility |
| `api/pdf_helper/bulk_download.py:23` | not in [Merged, Cancelled, PO Amendment, Inactive] | Bulk PDF download |
| `api/pdf_helper/bulk_download.py:158` | in [Partially Dispatched, Delivered, Partially Delivered] | DN PDF download |
| `api/projects/project_aggregates.py:452` | not in [Cancelled, Merged, PO Amendment, Inactive] | Project financial aggregates |
| `api/seven_days_planning/material_plan_api.py:11,286` | not in [Cancelled, Merged, Inactive, PO Amendment] | Material planning |
| `api/vendor/get_vendor_po_invoices.py:23` | not in [Merged, Inactive, PO Amendment] | Vendor PO list |
| `api/customer/customer_financials.py` | not in [Cancelled, Merged, PO Amendment, Inactive] | Customer financials |
| `api/po_revisions/revision_logic.py` | in [PO Approved, Dispatched, Partially Delivered, Delivered] | Revision eligibility |

## Socket.IO Events
- `po:new` — after PO creation (after_insert hook)
- `po:amended` — on PO Approved → Dispatched or PO Approved → PO Amendment transitions
- `po:delete` — on PO trash

## Common Exclusion Patterns
Most queries that show "active" POs use: `status NOT IN (Merged, Inactive, PO Amendment, Cancelled)`
Delivery-specific queries use: `status IN (Partially Delivered, Delivered)` or `status IN (Partially Dispatched, Dispatched, Partially Delivered, Delivered)`
DC/MIR queries use: `status IN (Partially Dispatched, Partially Delivered, Delivered)`

---

## Cross-Module PO Status Linkages

### Projects Module
| Linkage Point | File | What it does |
|---------------|------|-------------|
| Project PO Summary Table | `pages/projects/components/ProjectPOSummaryTable.tsx` | Filters POs excluding Cancelled/Merged/Inactive/PO Amendment; shows status badge per PO |
| Project Overview Tab | `pages/projects/ProjectOverviewTab.tsx` | Displays `totalPOAmountWithGST` (derived from active POs only) |
| Project Financials Tab | `pages/projects/ProjectFinancialsTab.tsx` | Shows PO Amount Incl GST, PO Delivered Amount, advance vs delivery payment breakdown |
| Project Spends Tab | `pages/projects/ProjectSpendsTab.tsx` | PO amounts by work package (active POs only) |
| Material Usage Tab | `pages/projects/components/ProjectMaterialUsageTab.tsx` + `hooks/useMaterialUsageData.ts` | Per-item delivery status (Fully/Partially Delivered/Pending), per-PO payment status |
| Critical PO Tasks | `pages/projects/CriticalPOTasks/` + `LinkPODialog.tsx` | Links active POs to planning tasks |
| 7-Day Material Plan | Backend `api/seven_days_planning/material_plan_api.py` | Excludes Cancelled/Merged/Inactive/PO Amendment |
| Project Aggregates API | Backend `api/projects/project_aggregates.py` | `total_po_value_inc_gst`, `total_amount_paid_for_pos`, excludes inactive statuses |
| CEO Hold | Projects with CEO Hold block ALL PO operations (dispatch, amend, delivery, payment) |
| Project Status | Halted/Completed projects: no hard API guards on PO ops, but hidden from ProjectSelect |
| Project Payments | Backend `api/payments/project_payments.py` | Validates PO balance before creating payment |
| Project-wise Invoice Data | Backend `api/projects/project_wise_invoice_data.py` | Aggregates invoices linked to POs per project |
| Project Credits | `pages/projects/hooks/useProjectAllCredits.ts` | Excludes Merged/Inactive/PO Amendment POs |

### Vendors Module
| Linkage Point | File | What it does |
|---------------|------|-------------|
| Vendor Material Orders | `pages/vendors/components/VendorMaterialOrdersTable.tsx` | Excludes Merged/Inactive/PO Amendment; shows delivery info for PD/D; status facet filter |
| Vendor Ledger | `pages/vendors/components/POVendorLedger.tsx` | PO amount balance from active POs; transaction types: PO Created, Invoice Recorded, Payment Made |
| Vendor Approved Quotes | `pages/vendors/components/VendorApprovedQuotesTable.tsx` | Shows quotes only from Dispatched POs (AQ created on dispatch) |
| Vendor Invoices | `pages/vendors/data/useVendorQueries.ts` | Only approved invoices for active POs |
| Vendor Payments | `pages/vendors/components/VendorPaymentsTable.tsx` | Payments linked to specific POs |
| Vendor PO Invoices API | Backend `api/vendor/get_vendor_po_invoices.py` | Excludes Merged/Inactive/PO Amendment; builds ledger entries |
| AQ Creation on Dispatch | Backend `integrations/controllers/procurement_orders.py` | PO Approved→Dispatched creates Approved Quotation records for vendor |
| PO Generation from Quotes | Backend `api/approve_vendor_quotes.py` | Creates PO with vendor assigned; initial status Draft→PO Approved |
| Send Back Items | Backend `api/send_back_items.py` | Rejected vendor quotes do NOT create POs |

### Items Module
| Linkage Point | File | What it does |
|---------------|------|-------------|
| Item Status Update Task | Backend `tasks/item_status_update.py` | Item "Active" if AQ→PO created <6 months ago; "Inactive" if no recent PO |
| Target Rates | Backend `populate_target_rates.py` | Queries AQs (which link to POs) for rate calculation; no PO status filter |
| PO Item received_quantity | `purchase_order_item` child table | Core field for delivery tracking per item |
| calculate_order_status() | Backend `api/delivery_notes/update_delivery_note.py` | Loops items, skips "Additional Charges", 2.5% float tolerance |
| Additional Charges | Special handling: always use full `quantity` for amount, skip from status calc |
| Remaining Items Report | `pages/remaining-items/hooks/useEligibleItems.ts` + backend `api/remaining_items_report.py` | Tracks dn_quantity vs remaining; excludes Additional Charges and Tool & Equipment categories |
| Material Usage Data | `pages/projects/hooks/useMaterialUsageData.ts` | Per-item deliveredQuantity, deliveryStatus, PO payment status aggregation |
| PO Revision Item Constraints | Backend `api/po_revisions/revision_logic.py` | Cannot delete items with received_quantity > 0; recalculates status after revision |
| PO Merge Item Consolidation | Backend `api/po_merge_and_unmerge.py` | Items from source POs consolidated into master; received_quantity inherited |

### Other Cross-Cutting Modules
| Module | Linkage Point | What it does |
|--------|---------------|-------------|
| **Invoices** | `pages/ProcurementOrders/invoices-and-dcs/DocumentAttachments.tsx` | Invoice creation only for Delivered/Partially Delivered POs |
| **Invoices** | `config/queryKeys.ts:getPOForProjectInvoiceOptions` | Excludes Merged/Cancelled/PO Amendment/Inactive |
| **Payments/Credits** | Backend `api/credits/get_credits_list.py` | Credit term queries exclude Merged/Inactive/PO Amendment |
| **Payments** | `pages/ProjectPayments/project-payments-list.tsx` | Only shows active POs for payment workflows |
| **Payment Terms** | `POPaymentTermsCard.tsx` | "Inactive" POs disable payment term editing |
| **DC/MIR** | Backend `api/delivery_challans_data.py` | Partially Dispatched/Partially Delivered/Delivered POs eligible for DC creation |
| **DN Hub** | `pages/DeliveryNotes/deliverynotes.tsx` | DN creation for Partially Dispatched/Dispatched/PD POs; DN viewing for PD/D POs |
| **PR Summary** | `components/pr-summary.tsx` | Shows POs in Partially Dispatched/Dispatched/PD/D for DN section |
| **Notifications** | Backend controller `procurement_orders.py` | Push notifications on PO Amendment; AQ creation on full dispatch from PO Approved/Partially Dispatched |
| **Socket.IO** | `services/socketListeners.ts` | po:new, po:amended, po:delete events trigger refetches |
| **Sidebar** | `zustand/useDocCountStore.ts` + backend `sidebar_counts.py` | Badge counts per status (8 statuses incl Partially Dispatched); GROUP BY status query |
| **Customer Financials** | Backend `api/customers/customer_financials.py` | Excludes Cancelled/Merged/PO Amendment/Inactive from customer totals |
| **Bulk PDF** | Backend `api/pdf_helper/bulk_download.py` | Active POs for PO PDFs; PD/D POs for DN PDFs |
| **Historical Quotes** | `HistoricalQuotesHoverCard.tsx` | Links to PO with Dispatched tab |
| **PO Revision Flow** | `pages/PORevision/` + backend `revision_logic.py` | Only PO Approved/Dispatched/PD/D eligible for revision; recalculates status post-revision |

### Patches (Historical Migrations)
| Patch | What it did |
|-------|-------------|
| `v1_9/change_generated_to_po_approved.py` | Renamed "Generated" → "PO Approved" |
| `v1_9/delete_cancelled_pos.py` | Cleaned up Cancelled POs |
| `v1_10/set_po_dispatched_from_sent.py` | Renamed "PO Sent" → "Dispatched" |
| `v1_10/rebuild_merged_pos.py` | Rebuilt merge relationships |
| `v1_10/merge_po_patch2.py` | Batch migration of merged PO status |
| `v2_3/po_delivery_data_patch.py` | Migrated delivery data for PD/D POs |
| `v2_4/po_dispatch_date.py` | Added dispatch_date for Dispatched/PD/D POs |
| `v3_0/migrate_delivery_data_to_delivery_notes.py` | Migrated delivery_data JSON → standalone DN doctype for PD/D POs |

---

## DataTable Components & Summary Functions — Backend Calls with PO Status Filters

### Frontend Hooks/Components Making PO-Status-Filtered Backend Calls

| # | Hook/Component | File | Backend Call | PO Status Filter | Data Use |
|---|----------------|------|-------------|-----------------|----------|
| 1 | `useServerDataTable` (PO tabs) | `release-po-select.tsx` | `useFrappeGetDocList("Procurement Orders")` | Base: NOT IN [Merged, PO Amendment, Inactive]; per-tab: exact status match | Main PO DataTable with tabs |
| 2 | `useOrderTotals()` | `src/hooks/useOrderTotals.ts` | `useFrappeGetDocList("Procurement Orders")` | NOT IN [Cancelled, Merged] | Global hook: getTotalAmount(), getDeliveredAmount(), getVendorName() per PO |
| 3 | `useSidebarCounts()` | `src/hooks/useSidebarCounts.ts` | `useFrappeGetCall("sidebar_counts")` | Server-side GROUP BY status | Sidebar badge counts for all 7 statuses |
| 4 | `useCredits()` | `pages/credits/hooks/useCredits.ts` | `useFrappePostCall("get_credits_list")` | Server-side NOT IN [Merged, Inactive, PO Amendment] + term_status | Credits DataTable with tabs (Due/Requested/Approved/Paid) |
| 5 | Estimates Dashboard | `dashboards/estimates-executive-dashboard.tsx` | `useFrappeGetDocList("Procurement Orders")` | NOT IN [Merged, PO Amendment] | Summary card: total PO count |
| 6 | Project Payments List | `pages/ProjectPayments/project-payments-list.tsx` | `useFrappeGetDocList("Procurement Orders")` | NOT IN [Cancelled, Merged, Inactive, PO Amendment] | DataTable with invoice/payment details |
| 7 | DN Hub (Create) | `pages/DeliveryNotes/deliverynotes.tsx` | `useFrappeGetCall("get_project_pos_with_items")` | IN [Partially Dispatched, Dispatched, Partially Delivered] (server param) | PO accordion for DN creation |
| 8 | DN Hub (View Existing) | `pages/DeliveryNotes/deliverynotes.tsx` | `useFrappeGetDocList("Procurement Orders")` | IN [Delivered, Partially Delivered] | Accordion list of POs with DNs |
| 9 | Project PO Summary | `pages/projects/components/ProjectPOSummaryTable.tsx` | `useServerDataTable` + `useFrappePostCall("get_project_po_summary_aggregates")` | NOT IN [Cancelled, Merged, Inactive, PO Amendment] | DataTable + financial summary cards |
| 10 | Material Usage | `pages/projects/hooks/useMaterialUsageData.ts` | `useFrappeGetCall("generate_po_summary")` + `useFrappeGetDocList` | Summary: NOT IN [Merged, Inactive, PO Amendment]; DN list: IN [Delivered, PD] | Per-item delivery status + PO payment status |
| 11 | PO Attachment Reconcile | `pages/reports/hooks/usePOAttachmentReconcileData.ts` | `useFrappeGetDocList("Procurement Orders")` | IN [Delivered, Partially Delivered] | Reconciliation report table |
| 12 | DN > DC Quantity Report | `pages/reports/hooks/useDNDCQuantityData.ts` | `useFrappeGetDocList("Procurement Orders")` | IN [Delivered, Partially Delivered] | Quantity comparison report |
| 13 | PO Reports | Uses `getPOReportListOptions()` from `config/queryKeys.ts` | `useFrappeGetDocList("Procurement Orders")` | IN [Partially Dispatched, Dispatched, Partially Delivered, Delivered] | Pending Invoices, Excess Payments, Dispatched 1+ days reports |
| 14 | Project Invoice Options | Uses `getPOForProjectInvoiceOptions()` from `config/queryKeys.ts` | `useFrappeGetDocList("Procurement Orders")` | NOT IN [Merged, Cancelled, PO Amendment, Inactive] | Financial summary aggregation |
| 15 | PR Summary | `components/pr-summary.tsx` | `useFrappeGetDocList("Procurement Orders")` | Filter by procurement_request (no status filter in query, but UI filters by Dispatched/PD/D) | Shows all POs linked to a PR |
| 16 | Vendor Material Orders | `pages/vendors/components/VendorMaterialOrdersTable.tsx` | `useServerDataTable("Procurement Orders")` | NOT IN [Merged, Inactive, PO Amendment] | Vendor's PO DataTable with status facet |
| 17 | Vendor Ledger | `pages/vendors/components/POVendorLedger.tsx` | `useFrappeGetCall("get_po_ledger_data")` | Server-side NOT IN [Merged, Inactive, PO Amendment] | Ledger transactions: PO Created → Invoice → Payment |

### Backend APIs Called by Above (with exact PO status filters)

| # | API Path | Function | PO Status Filter | Returns |
|---|----------|----------|-----------------|---------|
| 1 | `nirmaan_stack.api.sidebar_counts.sidebar_counts` | `sidebar_counts(user)` | GROUP BY status (all) + NOT IN [Merged, Inactive, PO Amendment] for credits | Status→count map, credit term aggregates |
| 2 | `nirmaan_stack.api.procurement_orders.generate_po_summary` | `generate_po_summary(project_id)` | NOT IN [Merged, Inactive, PO Amendment] | po_items + custom_items lists (redis cached) |
| 3 | `nirmaan_stack.api.projects.project_aggregates.get_project_po_summary_aggregates` | `get_project_po_summary_aggregates(project_id)` | NOT IN [Cancelled, Merged, PO Amendment, Inactive] | total_po_value_inc_gst, total_po_value_excl_gst, total_amount_paid (redis cached) |
| 4 | `nirmaan_stack.api.projects.project_aggregates.get_project_pr_status_counts` | `get_project_pr_status_counts(project_id)` | NOT IN [Cancelled] (includes Merged for item coverage) | PR derived status counts (redis cached) |
| 5 | `nirmaan_stack.api.credits.get_credits_list.get_credits_list` | `get_credits_list(...)` | NOT IN [Merged, Inactive, PO Amendment] + term_status filters | Payment term rows + aggregates (total_credit/due/paid) |
| 6 | `nirmaan_stack.api.credits.get_credits_list.get_credits_facets` | `get_credits_facets(...)` | NOT IN [Merged, Inactive, PO Amendment] | Facet value counts |
| 7 | `nirmaan_stack.api.delivery_challans_data.get_delivery_challan_pos_with_categories` | `get_delivery_challan_pos_with_categories(project_id)` | IN [Partially Delivered, Delivered] | POs + unique_categories + category_counts |
| 8 | `nirmaan_stack.api.vendor.get_vendor_po_invoices.get_po_ledger_data` | `get_po_ledger_data(vendor_id)` | NOT IN [Merged, Inactive, PO Amendment] | Chronological ledger transactions |
| 9 | `nirmaan_stack.api.customers.customer_financials.get_customer_financial_details_api` | `get_customer_financial_details(customer_id)` | NOT IN [Cancelled, Merged, PO Amendment, Inactive] | total_po_amount_with_gst, total_amount_due (redis cached) |
| 10 | `nirmaan_stack.api.pdf_helper.bulk_download.download_all_pos` | `download_all_pos(project)` | NOT IN [Merged, Cancelled, PO Amendment, Inactive] | Merged PDF binary |
| 11 | `nirmaan_stack.api.seven_days_planning.material_plan_api.get_material_plan_data` | `get_material_plan_data(project, ...)` | NOT IN [Cancelled, Merged, Inactive, PO Amendment] | POs grouped by procurement package |
| 12 | `nirmaan_stack.api.data_table.get_list_with_count_enhanced` | Generic | Filters passed from frontend (supports PO child table search) | List + count + aggregates |
| 13 | `nirmaan_stack.api.delivery_notes.get_project_pos.get_project_pos_with_items` | `get_project_pos_with_items(project_id, statuses)` | Statuses passed as parameter (typically [Dispatched, PD]) | POs with item details for DN creation |
