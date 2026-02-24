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
