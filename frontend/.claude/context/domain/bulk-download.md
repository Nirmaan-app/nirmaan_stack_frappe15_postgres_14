# Bulk Download: one set of components for the Project tab and the Vendor tab

## 1. The idea

The project page and the vendor page show **the same Bulk Download screen**. Nothing is copied. Each page tells
the screen **who it is for**, a project or a vendor, and the screen adapts. That "who" is the **scope**.

```tsx
// project.tsx
<BulkDownloadPage scope={{ kind: "project", id: projectId, name: data?.project_name }} />

// vendor.tsx — every value comes from the vendor that is open; nothing is hardcoded
<BulkDownloadPage key={vendorId} scope={{ kind: "vendor", id: vendorId, name: vendor?.vendor_name, vendorType: vendor?.vendor_type }} />
// e.g. for VEN-Material-0241: { kind: "vendor", id: "VEN-Material-0241", name: "MARUTHI AIRCON ENGINEERS", vendorType: "Material & Service" }
```

**Why the vendor tab passes `vendorType`:** the vendor page already decides its own tabs by vendor type (Material
Orders only for Material vendors, Work Orders only for Service vendors). Bulk Download follows the same rule for its
cards and invoice choices. The vendor page has the vendor loaded already, so it hands the type over instead of the
screen fetching the vendor a second time. The project tab has no vendor type: a project can have every kind of
document.

| Field | Meaning |
|---|---|
| `kind` | which page: `"project"` or `"vendor"` |
| `id` | which project or vendor |
| `name` | its display name |
| `vendorType` | vendor only: `Material`, `Service` or `Material & Service` |

## 2. Where the scope goes

```
                 scope + user's role
                        │
     ┌──────────────────┼────────────────────────┬────────────────────────────┐
     ▼                  ▼                        ▼                            ▼
allowedBulkTypes   useBulkDownloadWizard     Step tables                 Download request
(which cards and   (every list filtered      (Vendor column on a         (sends project=ID
 menu items)        by [kind, "=", id])       project, Project column     or vendor=ID)
                                              on a vendor)                       │
                                                                                 ▼
                                                              bulk_download.py: _scope()
                                                              decides the filter field and the
                                                              name used in the file name
                                                                                 ▼
                                                              "{project or vendor name}_Selected_POs.pdf"
```

## 3. Example: download 2 POs from the vendor tab

1. The vendor page passes `scope = { kind: "vendor", id: "VEN-Material-0241", vendorType: "Material & Service" }`.
2. `allowedBulkTypes` sees a Material & Service vendor, so it shows all 9 cards.
3. The user opens **Procurement Orders**. The wizard has fetched POs **where `vendor = VEN-Material-0241`**.
4. The table shows a **Project** column (a vendor's POs span many projects), and there is no Critical POs tab.
5. The user filters by project, ticks 2 POs and clicks **Download 2 POs**.
6. The browser posts `download_selected_pos` with `vendor=VEN-Material-0241` and the 2 PO names.
7. The server's `_scope()` reads the vendor's name. The job builds the PDF: `MARUTHI AIRCON ENGINEERS_Selected_POs.pdf`.

On the project tab the same 7 steps run, with `project` in place of `vendor`.

## 4. What differs between the two tabs

| | Project tab | Vendor tab |
|---|---|---|
| Rows shown | `project = id` | `vendor = id` |
| Facet column in the tables | Vendor | Project |
| Critical POs tab (PO, DN steps) | shown | hidden (Critical PO Tasks live inside a project) |
| Client Invoices | shown (not PM, not PMO) | never (Project Invoices have no vendor) |
| Cards | by role | by role **and** vendor type: Material → PO, DC, MIR, DN, MTC, PO Payment Vouchers · Service → WO, WO Payment Vouchers · both → all · Vendor Invoices always |
| Invoice choices | All / PO / WO | a single-type vendor loses the choice it cannot have |
| Who sees the tab | the project page's tab rules | Admin, PMO, Accountant (+ Lead), procurement profiles only |
| File name | `{project name}_…pdf` | `{vendor name}_…pdf` |

Role rules shared by both tabs: a Project Manager gets no rates, no vendor invoices and no vouchers. PMO loses
Client Invoices only.

## 5. Why the vendor tab is safe

The backend reads data **differently per scope**:

- **Project scope:** `frappe.get_all`, exactly as before this change.
- **Vendor scope:** `frappe.get_list` **as the logged-in user**. A vendor works across many projects, and fetching
  an attachment checks nothing, so this read is what stops a user limited to some projects from downloading the
  other projects' files.

## 6. Payment Vouchers: one card for PO payments, one for WO payments (both tabs)

| | **PO Payment Vouchers** | **WO Payment Vouchers** |
|---|---|---|
| The voucher | **generated** by the server: PO payments have no uploaded voucher | the **uploaded** `voucher_attachment` |
| Listed | only **Paid** PO payments (owner 2026-10-09) — a voucher is the proof of a payment made | only paid WO payments that **have** an uploaded voucher (no "Missing" rows) |
| Can be ticked | every listed row | every listed row |
| Download | each payment rendered with print format **"SR Payment"**, no letterhead — exactly the PO page's voucher button, which is also Paid-only | each payment's uploaded file |
| Card count | Paid PO payments | payments with a voucher |
| Vendor tab | Material, Material & Service vendors (the PO side) | Service, Material & Service vendors (the WO side) |

Both: the browser sends **payment names**, never files; the server re-reads them in scope (`_po_voucher_payments`,
`_wo_voucher_files`, `get_list` in both scopes) and drops anything out of scope or no longer eligible. Neither card
for a **Project Manager** (no money documents). Same columns for both: PO / WO ID, Vendor (Project on the vendor
tab), Amount, UTR, Paid On. Every row can be ticked, so neither card greys rows out.

**Size and time limit (PO):** one generated voucher takes ~1.6 s; the biggest vendor has 335 paid PO payments
(~9 min), the biggest project 451 (~12 min). PO voucher jobs therefore get a **1-hour** limit
(`JOB_TIMEOUT_SECONDS`) instead of the `long` queue's 25 minutes: a job killed at the limit publishes nothing, and
the progress window would spin. Every other type keeps the queue's default.

`localhost:8000` serves the last `yarn build`, which may predate these cards; use `:8080`.

## 6b. Material Test Certificates (both tabs)

**One row per certificate, like a DC**, oldest **certificate date** first (the merged PDF keeps that order). A row
is told apart by the items it covers, because MTC ids are never shown — not even to a screen reader: the row
checkboxes are labelled by their items (`rowLabel={mtcItemsText}` on `BulkSelectTable`). The card follows the **Delivery Challans
rule** exactly (owner): every role, Material and Material & Service vendors — pinned by a test over every role,
tab and vendor type. The list comes from the MTC module's own read, `mtc_api.get_mtcs(project | vendor)`; the
browser sends **MTC names**, and `bulk_download._mtc_files` reads the files back with `get_list` plus the MTC
page's project rule (`mtc_allowed_projects`: a PM / PL sees only assigned projects, none assigned = nothing).

## 7. Where the code is

| What | File |
|---|---|
| The scope type and the rules (which cards, invoice choices, facet column) | `src/utils/bulkDownload/bulkDownloadTypes.ts` |
| Who sees the vendor tab | `src/constants/roles.ts` → `canBulkDownloadVendor` |
| The screen | `src/pages/BulkDownload/BulkDownloadPage.tsx` |
| The lists (queries) | `src/pages/BulkDownload/useBulkDownloadWizard.ts` |
| The step tables, and the Vendor ⇄ Project column swap (`forScope`) | `src/pages/BulkDownload/steps/*` |
| The "All … / Critical POs" tabs shared by the PO and DN steps | `src/pages/BulkDownload/steps/CriticalTasksTab.tsx` |
| Every type's names; the invoice choices; the vendor-type rule (also used by the vendor page's tabs) | `TYPE_INFO`, `INVOICE_SUB_TYPES`, `vendorHandlesMaterial` / `vendorHandlesService` in `bulkDownloadTypes.ts` |
| Quick Download menu | `src/components/common/BulkPdfDownloadButton.tsx`, `src/hooks/useBulkPdfDownload.ts` |
| The progress window (one, for Quick Download and the wizard), and what it shows per event | `src/components/common/BulkDownloadProgressDialog.tsx`, `src/utils/bulkDownload/bulkDownloadRun.ts` |
| Each type's icon and colour (cards and the window's icon tile) | `TYPE_STYLE` in `src/utils/bulkDownload/bulkDownloadStyle.ts` |
| Backend endpoints and job | `nirmaan_stack/api/pdf_helper/bulk_download.py` (`_scope`, `_reader`, `_po_voucher_payments`, `_wo_voucher_files`, `_mtc_files`) |
| Tests | `bulkDownloadTypes.test.ts`, `bulkDownloadRun.test.ts`, `BulkDownloadProgressDialog.dom.test.tsx`, `steps/bulkTableColumns.test.ts`, `useBulkDownloadWizard.dom.test.tsx`, `steps/MTCSteps.dom.test.tsx`, `steps/PaymentVoucherSteps.dom.test.tsx`, `src/utils/frappeErrors.test.ts`, `api/pdf_helper/test_bulk_download_scope.py`, `test_bulk_download_job.py`, `test_bulk_download_mtc.py`, `test_bulk_download_po_vouchers.py` |

## 8. Rules not to break

- The project tab must behave exactly as it did. Its queries do not change; vendor-only fields are added only in
  vendor scope.
- The vendor scope keeps `get_list`. Never switch it to `get_all`.
- Every endpoint takes **exactly one** of `project=` or `vendor=`. `_scope` refuses both or neither.
- Cards, the Quick menu and the voucher query all come from `allowedBulkTypes`. Do not add a second role check
  somewhere else.
- **Every download has its own id.** The browser makes it (`newDownloadId`) and sends it as `download_id`; every
  event the job publishes carries it; each tab listens only for its own (`listenForDownload` in
  `utils/bulkDownload/bulkDownloadEvents.ts`) and removes only its own listeners — never `socket.off(event)`.
  Never call it `job_id`: `frappe.enqueue` takes that keyword for itself.
- **An empty selection is refused** by the "Selected" endpoints, and the job reads an explicit empty list as
  nothing. Only a "Download All" leaves the list out.
- **The job never ends silently:** any failure publishes `bulk_download_failed` (and writes an Error Log). The
  progress window's **Cancel download** calls `cancel_bulk_download`; the job checks a per-user Redis flag
  (`frappe.cache.exists`, never `get_value`, which caches per process) before each document.
- **Only a delivered file reaches the wizard's Done step** (the `bulk_download_all_ready` token). A failure keeps
  the selection and leaves the window open on the server's reason (no toast); a cancel closes the window and keeps
  the selection. Never decide "done" from `progress`: the previous download leaves it at 100, and the failure
  listener holds the values of the render in which Download was clicked.
- **The window counts FINISHED documents.** The job publishes `bulk_download_progress` before each document with
  `done` (finished so far), `total` and `current` (the PO / WO number, for PO, WO and DN only), then once with
  `stage: "merging"` while it writes the file; `bulk_download_all_ready` carries `included` / `total`, so a
  document that failed shows as missing instead of vanishing. The window reads these only through
  `bulkDownloadRun.ts`, which also accepts an older worker's events (no counts). It cannot be dismissed while the
  job runs (leaving the page cancels the job); there is deliberately no "run in background".
- **A refused start shows Frappe's own reason.** Read it with `readFrappeError(response, fallback)`
  (`src/utils/frappeErrors.ts`, which wraps `getFrappeError`), never `res.json().message`: Frappe puts the reason in
  `_server_messages` / `exception`, and an HTML error page is not JSON.
- **The DN step's Critical POs tab uses `dnCriticalTasks`**: each task's links narrowed to POs with deliveries, so
  a task's chips, its count and what ticking it queues all agree. Ticking selects from the current step's own list.

## 9. Adding a new document type

1. Add it to `BulkDocType` / `BULK_DOC_TYPES`, give it a rule in `allowedBulkTypes`, and add a test.
2. Give it its names in `TYPE_INFO` (card, description, progress text) — the build fails until you do — a
   section in `MENU_GROUPS` (a test fails until you do),
   then a look in `TYPE_STYLE` (`utils/bulkDownload/bulkDownloadStyle.ts`), a click handler in `onMenuClick`
   (`BulkPdfDownloadButton.tsx`), and a step in `steps/`. An invoice choice goes in `INVOICE_SUB_TYPES` only.
3. Add its query to the wizard, filtered by the scope, with columns through `forScope`.
4. Backend: build its "download all" list with `_reader(field)`, so the vendor scope stays permission-checked.
