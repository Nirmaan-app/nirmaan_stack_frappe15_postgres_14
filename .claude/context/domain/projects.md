# Projects Domain - Status Lifecycle

## Project Statuses

| Status | Set By | When |
|--------|--------|------|
| **Created** | System | Automatically on project creation (`api/projects/new_project.py:193`) |
| **WIP** | Admin/PMO | Manually via UI; legacy patch set for old projects (`patches/v1_9/add_project_status.py`) |
| **Completed** | Admin/PMO | Manually via UI |
| **Halted** | Admin/PMO | Manually via UI |
| **CEO Hold** | `nitesh@nirmaan.app` only | Blocks ALL operations. Backend validation in `projects.py` enforces user restriction |

**Field definition:** Simple `Data` field in `projects.json:160-163` (not a `Select` with constrained options).

**No automatic transitions** exist. All status changes are manual. CEO Hold restricted to one authorized user (not role-based).

---

## Backend Effects by Status

### Halted & Completed

| Area | Effect | File:Line |
|------|--------|-----------|
| Design Tracker | Cannot create trackers for Halted/Completed/On Hold projects | `api/design_tracker/tracker_options.py:25` |
| Progress Reports | Completed projects excluded from active project queries | `api/projects/get_full_project_list.py:12` |

### No Backend Guards On

- PR creation (`api/custom_pr_api.py`) — no project status check
- SR/WO creation — no project status check
- PO creation — no project status check
- Payment processing — no project status check

---

## Frontend Effects by Status

See `frontend/.claude/context/domain/projects.md` for full frontend details.

### ProjectSelect Component (`components/custom-select/project-select.tsx`)

The `ProjectSelect` dropdown filters out Halted/Completed projects by default (line 34):
```typescript
const projectFilters = [["status", "not in", ["Completed", "Halted"]]];
```

This is bypassed when `all={true}` prop is passed.

**Impact:** Pages using `ProjectSelect` without `all={true}` cannot filter/select Halted or Completed projects.

### Status Change UI (`pages/projects/project.tsx:1215-1258`)

- Only Admin and PMO Executive roles see the status change popover
- Available transitions: WIP, Completed, Halted, CEO Hold (cannot go back to "Created")
- Uses `updateDoc("Projects", projectId, { status: newStatus })` with confirmation dialog

---

## Key Gotchas

1. **No hard backend validation** — Project status does not prevent document creation at the API level. The `ProjectSelect` dropdown hides projects from the UI, but direct API calls or other entry points can still create documents for Halted/Completed projects.
2. **PR/SR creation pages don't use ProjectSelect** — They have their own project selection logic, so project status does not restrict new PR or SR creation at all.
3. **Financial operations intentionally bypass** — `NewInflowPayment` and `NewProjectInvoiceDialog` pass `all={true}` to allow recording payments/invoices for completed projects.
4. **"Created" is a one-way status** — Set only by system on project creation. The UI only offers WIP, Completed, and Halted as changeable statuses.

---

## Notional GST (Work Orders raised with GST off)

Term: `CONTEXT.md` § Work-order GST. Shipped 2026-09-11 (`1b67d01b`).

**Rule:** `Σ Service Requests.total_amount × 0.18` over **Approved** SRs with `gst != "true"`.
`calculate_total_amount` (`doctype/service_requests/service_requests.py`) adds 18% only when `gst` is
truthy, so a GST-off WO's `total_amount` is the bare subtotal and ×0.18 is exactly the GST it never
charged. Live data holds only `"true"` / `"false"` in `gst`. The `!= "true"` test matches
`_calculate_sr_totals` in the same aggregates module.

**Status scope — Approved only (owner ruling 2026-09-11).** It mirrors the WO side of "PO + WO Amount"
(`get_projects_financial_rollup` filters SRs on `status = "Approved"`), so an *Amendment* WO drops out of
BOTH until re-approved. Widen the two together or neither — widening one alone makes them disagree about
which WOs they count.

| Surface | Source | Visibility / notes |
|---|---|---|
| Projects list — "Notional GST" column, after "PO + WO Amount" (`pages/projects/projects.tsx`) | `get_projects_financial_rollup` → `notional_gst` (`api/projects/project_aggregates.py`) | Same as PO + WO Amount: `FINANCIAL_COLUMNS_ROLES`, PMO included (not in `PMO_HIDDEN_FINANCIAL_COLUMNS`) |
| Project → WO Summary tab — per-WO column after "Incl. GST" + card line (`pages/projects/components/ProjectSRSummaryTable.tsx`) | Row: `notionalGstFor(sr)` on the fetched `gst` / `total_amount` (`--` for GST-on). Card: `get_project_sr_summary_aggregates` → `total_notional_gst` | Column and card line both hidden where `hideFinancialColumns` (Project Manager). Column is **not sortable** — it is computed, and `useServerDataTable` sends a column id straight to the server as `order_by` |
| Reports → Cash Sheet — column after "Total PO+SR Value" + "Total Notional GST" summary box (`pages/reports/`) | `useProjectReportCalculations` → `notionalGst` | Same **date-filtered** WO set as Total PO+SR Value (WO `creation` in range); every Cash Sheet viewer; in the CSV export |

**Consistency:** one rule on every surface. The two backend figures are pinned by `TestProjectNotionalGst`
(`api/projects/test_project_aggregates.py`); on 2026-09-11 the card total, the rollup and a direct SQL sum
agreed on all 85 projects with Approved WOs.
