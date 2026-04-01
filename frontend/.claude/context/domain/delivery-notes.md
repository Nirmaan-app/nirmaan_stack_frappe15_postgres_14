# Delivery Notes (DN) Domain — Full-Stack Reference

Reference documentation for the Delivery Note system on Purchase Orders. Load when working on delivery tracking, PO status transitions, inventory, material usage, or any feature that reads DN records or `received_quantity`.

---

## Overview

Delivery Notes are a **standalone Frappe doctype** (`Delivery Notes` with `Delivery Note Item` child table). Each delivery event creates a DN record.

**Denormalized PO fields** (kept for 37 unchanged consumers):

| PO Field | Type | Purpose |
|----------|------|---------|
| `po_amount_delivered` | Currency | Running total of delivered value (incl. tax) |
| `latest_delivery_date` | DateTime | Most recent delivery update timestamp |
| Child item → `received_quantity` | Float | Per-item running total of received qty |

**Legacy:** `delivery_data` JSON field on PO still exists (not pruned) but is no longer written to by the API. New code should read from DN records.

**Separate system:** DC (Delivery Challans) and MIR (Material Inspection Reports) use the `PO Delivery Documents` doctype — see `domain/procurement.md`.

---

## Core Data Model

### Delivery Notes Doctype

**Autoname:** Python `autoname()` — derives from PO name: `DN/<series>/<project>/<fin_year>/<note_no>` (e.g., PO `PO/001/PROJ-123/24-25` → DN `DN/001/PROJ-123/24-25/1`)

| Field | Type | Purpose |
|-------|------|---------|
| `procurement_order` | Link → Procurement Orders | FK to PO (search_index) |
| `project` | Link → Projects | Denormalized from PO |
| `vendor` | Link → Vendors | Denormalized from PO |
| `note_no` | Int | Sequential per PO (1, 2, 3...) |
| `delivery_date` | Date | When delivery occurred |
| `updated_by_user` | Data | Email of who recorded this (frontend resolves to full_name via Nirmaan Users) |
| `nirmaan_attachment` | Link → Nirmaan Attachments | DC file attachment |
| `notes` | Small Text | Optional comments |
| `items` | Table → Delivery Note Item | Child table |
| `is_stub` | Check | Migration flag (default 0) |

### Delivery Note Item (child table)

| Field | Type | Purpose |
|-------|------|---------|
| `item_id` | Data | Matches PO item's `item_id` |
| `item_name` | Text | Display name |
| `make` | Data | Brand/manufacturer |
| `unit` | Data | UOM |
| `category` | Data | Item category |
| `procurement_package` | Data | Procurement package from PO Item |
| `delivered_quantity` | Float | Qty delivered IN THIS event (delta) |

### TypeScript Interfaces

**File:** `src/types/NirmaanStack/DeliveryNotes.ts`

```typescript
interface DeliveryNoteItem {
  name?: string; item_id: string; item_name: string; make?: string; unit: string;
  category?: string; procurement_package?: string; delivered_quantity: number;
}
interface DeliveryNote {
  name: string; procurement_order: string; project: string; vendor?: string;
  note_no: number; delivery_date: string; updated_by_user?: string;
  nirmaan_attachment?: string; notes?: string; items: DeliveryNoteItem[];
  is_stub: 0 | 1; creation: string; modified: string;
}
```

---

## PO Eligibility & Status Transitions

| PO Status | Can Record DN? | Visible in DN List? |
|-----------|---------------|-------------------|
| Drafted / PO Approved | No | No |
| **Partially Dispatched** | Yes | "Create" view (with DN count badge) |
| **Dispatched** | Yes (first delivery) | "Create" view (with DN count badge) |
| **Partially Delivered** | Yes (subsequent) | Both views (Create + View Existing) |
| **Delivered** | Yes (corrections) | "View Existing" only |
| Cancelled | No | No |

**Status auto-calculation** (backend `calculate_order_status()`):
- Integer quantities: exact match (`received_qty >= quantity`)
- Float quantities: **2.5% tolerance** (`received_qty >= quantity - (quantity * 0.025)`)
- ALL items fully received → "Delivered"; otherwise → "Partially Delivered"

**Delivered amount formula:** `po_amount_delivered = Σ(quote × received_qty × (1 + tax%/100))`

---

## Role Access

**5 roles can record deliveries** (no read-only mode):
- Admin, PMO Executive, Project Manager, Project Lead, Procurement Executive

Check in `PODetails.tsx`:
```typescript
["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile",
 "Nirmaan Project Manager Profile", "Nirmaan Project Lead Profile",
 "Nirmaan Procurement Executive Profile"].includes(role)
```

## CEO Hold Exemption

DN operations are **exempt** from CEO Hold blocking. When a project is on CEO Hold, users can still create, edit, and return delivery notes. The CEO Hold banner is shown as informational only. This is because deliveries represent fulfillment of already-approved POs — recording them should not be blocked.

- **PO Overview accordion**: `canEdit` and `canReturn` do NOT check CEO Hold
- **DN detail page** (`deliverynote.tsx`): `canEdit` does NOT check CEO Hold; banner is informational
- **Backend**: No CEO Hold validation in DN APIs
- **DC/MIR**: Also NOT blocked by CEO Hold (separate system)

## Return Notes

Return Notes record items returned to vendor. They use the same `Delivery Notes` doctype with `is_return = 1`.

**Key differences from regular DNs:**
- `delivered_quantity` stored as **negative** values
- No attachment upload (date picker only)
- Shared `note_no` sequence with regular DNs (DN-1, DN-2, RN-3)
- Visual: red-tinted columns, "RN-" prefix, `RotateCcw` icon

**Roles (RETURN_NOTE_ROLES):** Admin, PMO Executive, Project Lead, Procurement Executive (PM excluded)

**Access:** Return button only appears in PO accordion (not standalone DN page), requires ≥1 existing DN

**Max return qty:** Capped at current `received_quantity` per item

**Status reversion:** Automatic — returning items from "Delivered" PO reverts to "Partially Delivered"

**Editing:** Same rules as regular DN edits (ALWAYS_EDIT_ROLES — Admin, PMO, Project Lead; PM conditional)

**Frontend files:**
- `hooks/useReturnSubmit.ts` — Return submission hook
- `pivot-table/DeliveryPivotTable.tsx` — Return button, confirmation dialog
- `pivot-table/types.ts` — `RETURN_NOTE_ROLES` constant

**Backend:** `update_delivery_note.py` accepts `is_return` parameter, validates roles, stores negative deltas

---

## Frontend Entry Points

| Entry Point | Route/Location | UX Pattern |
|-------------|---------------|------------|
| PMO Dashboard card | `dashboards/dashboard-pm.tsx:121-125` → `/prs&milestones/delivery-notes` | Dashboard card (Truck icon) |
| DN Hub — Create view | `/prs&milestones/delivery-notes?view=create` | Full-page PO list (Dispatched/Partially Delivered) |
| DN Hub — View Existing | `/prs&milestones/delivery-notes?view=view_existing` | Full-page PO list (Delivered/Partially Delivered) |
| DN Detail page | `/prs&milestones/delivery-notes/:dnId` | Full detail + recording form |
| PO Detail → "Update Delivery" | `PODetails.tsx` button | Sheet overlay on PO page |
| PR-scoped DN | `/:prId/dn/:dnId` | DN accessed from PR context |
| Project-scoped DN | `/projects/:projectId/:prId/dn/:dnId` | DN accessed from project context |

**No sidebar menu item** — access only via dashboard card, PO detail button, report links, or direct URL.

---

## Core Files

### Frontend — DN Pages

| File | Purpose |
|------|---------|
| `src/pages/DeliveryNotes/deliverynotes.tsx` | DN hub (3 views: dashboard, create, view existing). Dashboard cards → project select → PO list |
| `src/pages/DeliveryNotes/deliverynote.tsx` | Individual DN detail page. Supports `?mode=create\|view\|full` via query param |
| `src/pages/DeliveryNotes/constants.ts` | `encodeFrappeId`, `decodeFrappeId`, `deriveDnIdFromPoId`, `STATUS_BADGE_VARIANT`, route helpers |
| `src/pages/DeliveryNotes/components/DNDetailDialog.tsx` | Dialog showing DN items table (used in View Existing accordion) |
| `src/pages/DeliveryNotes/components/pivot-table/` | Pivot table subsystem (see below) |

**Pivot Table Components** (`components/pivot-table/`):

| File | Purpose |
|------|---------|
| `DeliveryPivotTable.tsx` | Main orchestrator: create/edit modes, confirmation dialogs, viewMode support |
| `PivotTableHeader.tsx` | Column headers with DN metadata, edit/print buttons, user name resolution |
| `PivotTableBody.tsx` | Item rows with DN qty columns, inline edit inputs, fully-delivered highlighting |
| `PivotTableMetadataBar.tsx` | PO metadata bar (PO/PR nav links, vendor, project, status badge, delivery contact) |
| `types.ts` | `PivotRow`, `DNColumn`, `PivotData`, `DeliveryPivotTableProps`, `DELIVERY_EDIT_ROLES` |

**Hooks** (`hooks/`):

| File | Purpose |
|------|---------|
| `useDeliveryNoteData.ts` | Decodes DN ID from URL, derives PO ID, fetches PO doc + DN records |
| `useDeliveryPivotData.ts` | Transforms PO items + DN records into pivot table rows/columns |
| `useDeliverySubmit.ts` | New DN creation: quantity tracking, date, attachment, submit logic |
| `useDeliveryEdit.ts` | Existing DN editing: init from column, quantity changes, submit edits |
| `useDownloadDN.ts` | DN PDF download by delivery date |
| `useProjectDeliveryNotes.ts` | Fetches all DNs for a project, groups by PO (`dnsByPO` map) |

### Backend — Core API

| File | Purpose |
|------|---------|
| `nirmaan_stack/api/delivery_notes/update_delivery_note.py` | Main endpoint: updates PO `received_quantity`, calculates status/amount, creates DN record |
| `nirmaan_stack/api/delivery_notes/edit_delivery_note.py` | Edit existing DN quantities with role-based permissions |
| `nirmaan_stack/api/delivery_notes/get_delivery_notes.py` | Read APIs: `get_delivery_notes(po)`, `get_project_delivery_notes(project)` |
| `nirmaan_stack/api/delivery_notes/get_project_pos.py` | `get_project_pos_with_items()`: POs for a project with child items (for search in Create view) |
| `nirmaan_stack/api/delivery_notes/update_invoice_data.py` | Creates/deletes Vendor Invoices (shares `delivery_notes/` package) |
| `nirmaan_stack/integrations/controllers/delivery_notes.py` | `on_update` + `on_trash` hooks: recalculate PO delivery fields when DN updated or deleted |

---

## Complete Linkage Map (51 points)

### A. Navigation & Routing

| # | Location | File |
|---|----------|------|
| 1 | PMO Dashboard card | `src/components/layout/dashboards/dashboard-pm.tsx:121-125` |
| 2 | Route: DN hub + detail | `src/components/helpers/routesConfig.tsx:172-188` |
| 3 | Route: PR-scoped DN | `routesConfig.tsx:161-166` |
| 4 | Route: Project-scoped DN | `routesConfig.tsx:408-412` |
| 5 | PO Detail "Update Delivery" button | `src/pages/ProcurementOrders/purchase-order/components/PODetails.tsx` |

### B. PO Detail Page — Embedded DN

| # | Feature | File |
|---|---------|------|
| 6 | Delivery History accordion | `PurchaseOrder.tsx:522-523, 1619` |
| 7 | "Delivered Qty" column in items table | `PurchaseOrder.tsx:1788-1815` |
| 8 | DN component imports | `PurchaseOrder.tsx:117-118, 128-129` |
| 9 | `po_amount_delivered` display | `PODetails.tsx:690` |
| 10 | `latest_delivery_date` display | `PODetails.tsx:718` |
| 11 | DN print layout integration | `PODetails.tsx:102-104` |

### C. Reports

| # | Report | File | DN Fields |
|---|--------|------|-----------|
| 12 | DN > DC Quantity Report | `reports/components/DNDCQuantityReport.tsx` | `received_quantity` vs DC |
| 13 | DN > DC data hook | `reports/hooks/useDNDCQuantityData.ts` | `received_quantity` |
| 14 | PO Reports — delivery date column | `reports/components/columns/poColumns.tsx:53-79` | `latest_delivery_date` |
| 15 | PO Reports — DN link icon | `poColumns.tsx:254-260` | Links to DN page |
| 16 | PO Reports — status filters | `reports/components/POReports.tsx:86, 140-141` | Delivered/Partially Delivered |
| 17 | PO Reports — CSV export | `POReports.tsx:357-369` | `latest_delivery_date` |
| 18 | PO Attachment Reconciliation | `reports/hooks/usePOAttachmentReconcileData.ts:72-77` | `latest_delivery_date`, `po_amount_delivered` |
| 19 | Attachment Reconciliation display | `reports/components/POAttachmentReconcileReport.tsx:251` | Delivery date format |
| 20 | Report table config | `reports/config/poReportsTable.config.ts:11` | Date filter column |
| 21 | Project Financial Report | `reports/hooks/useProjectReportCalculations.ts:393-396` | `po_amount_delivered` sum |

### D. Projects

| # | Feature | File | DN Fields |
|---|---------|------|-----------|
| 22 | Project detail financials | `projects/project.tsx:751, 822, 835, 851` | `po_amount_delivered` |
| 23 | Projects list summary | `projects/projects.tsx:230, 365, 370` | `po_amount_delivered` |
| 24 | PO Summary Table | `projects/components/ProjectPOSummaryTable.tsx` | `po_amount_delivered` column + aggregates |
| 25 | Material Usage Tab types | `projects/components/ProjectMaterialUsageTab.tsx:31, 51, 80` | `deliveredQuantity`, `totalDeliveryNoteQty` |
| 26 | Material Usage data hook | `projects/hooks/useMaterialUsageData.ts:219-325` | `received_quantity` → `deliveredQuantity` |
| 27 | Material Usage helpers | `projects/config/materialUsageHelpers.ts:15-19` | `determineDeliveryStatus()` |

### E. Remaining Items / Inventory

| # | Feature | File | DN Fields |
|---|---------|------|-----------|
| 28 | Eligible items for inventory | `remaining-items/hooks/useEligibleItems.ts` | `dnQuantity` (from `received_quantity`) |

### F. Invoices

| # | Feature | File | DN Fields |
|---|---------|------|-----------|
| 29 | Invoice creation eligibility | `ProcurementOrders/invoices-and-dcs/DocumentAttachments.tsx:396-399` | Status gate: Delivered/Partially Delivered |

### G. Bulk Download

| # | Feature | File | DN Fields |
|---|---------|------|-----------|
| 30 | DN as download type | `BulkDownload/BulkDownloadStep1.tsx` | DN card in wizard |
| 31 | DN step UI | `BulkDownload/steps/DNSteps.tsx` | Vendor/date filtering |
| 32 | DN eligibility filter | `BulkDownload/useBulkDownloadWizard.ts:278, 349` | Status filter |
| 33 | Status color map | `BulkDownload/steps/POSteps.tsx:54-56` | Amber/emerald badges |

### H. Vendors

| # | Feature | File | DN Fields |
|---|---------|------|-----------|
| 34 | Vendor material orders | `vendors/components/VendorMaterialOrdersTable.tsx:184` | Status badge |

### I. DC/MIR Pages (date display only)

| # | Feature | File | DN Fields |
|---|---------|------|-----------|
| 35 | DC PO list table | `DeliveryChallansAndMirs/components/POListTable.tsx:48` | `latest_delivery_date` |
| 36 | DC PO list cards | `DeliveryChallansAndMirs/components/POListCards.tsx:41` | `latest_delivery_date` |

### J. Shared Config & Types

| # | Item | File |
|---|------|------|
| 37 | Query key fields | `src/config/queryKeys.ts:57, 239` |
| 38 | PO type — delivery fields | `src/types/NirmaanStack/ProcurementOrders.ts:125, 149` |
| 39 | DeliveryDataType interfaces | `src/types/NirmaanStack/ProcurementOrders.ts` |
| 40 | DN attachment type (legacy) | `src/types/NirmaanStack/DeliveryNoteAttachments.ts` |

### K. Backend Linkages

| # | Component | File |
|---|-----------|------|
| 41 | PO Summary API (returns `received_quantity`) | `api/procurement_orders.py` |
| 42 | Delivery Challans Data API (status filter, sort) | `api/delivery_challans_data.py` |
| 43 | Material Plan API (maps delivery date) | `api/seven_days_planning/material_plan_api.py` |
| 44 | Material Plan Stats (aggregates by status) | `api/seven_days_planning/get_projects_material_plan_stats.py` |
| 45 | Bulk Download PDF (`download_all_dns()`) | `api/pdf_helper/bulk_download.py` |
| 46 | PO on_update hook (Dispatched transition) | `integrations/controllers/procurement_orders.py` |
| 47 | Print format "PO Delivery Histroy" | `fixtures/print_format.json` |
| 48-51 | Migration patches (v2_3, v2_7) | `patches/v2_3/`, `patches/v2_7/` |

---

## Extensibility Assessment

**Easy to extend:**
- New fields on DN doctype (standard Frappe field addition)
- New roles (extend the role check array)
- New report views (`useDNDCQuantityData` pattern is reusable)
- New print formats (Frappe print format system)
- DN deletion/correction (`on_trash` hook recalculates PO fields)
- Querying DN records (standard `frappe.get_all` with filters)

**Harder to extend:**
- Delivery validation rules — single Python function, no plugin hooks
- Per-item approval — no approval workflow on deliveries
- Multi-warehouse — no delivery location tracking
- Partial rejection — no "rejected quantity" field

---

## Related Context Files

- Backend procurement: `.claude/context/domain/procurement.md` (DC/MIR, PO lifecycle)
- Backend APIs: `.claude/context/apis.md` (all endpoints)
- Frontend invoices: `frontend/.claude/context/domain/invoices.md` (invoice eligibility)
- Frontend role access: `frontend/.claude/context/role-access.md` (role definitions)
