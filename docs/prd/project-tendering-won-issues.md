# Issues Checklist: Project Tendering / Won

**Status:** Local checklist — not published to any tracker.
**Source:** `docs/prd/project-tendering-won.md` · `docs/adr/0001-project-tendering-status.md` · `CONTEXT.md`
**Date:** 2026-05-29

Tracer-bullet vertical slices. Each slice is a thin end-to-end path that is demoable/verifiable on its own.

**Wave ordering:** 1 → {2, 6} → {3, 4, 5} → 7

- [x] **Slice 1** — Retire `Created`, rename to `Won` (+ migration) · `HITL`
- [x] **Slice 2** — Create & list a Tendering stub · `AFK`
- [x] **Slice 3** — Tendering stub: detail view, edit, delete · `AFK`
- [x] **Slice 4** — Hide Tendering from project pickers (UI isolation) · `AFK`
- [x] **Slice 5** — Backend operational guard (data isolation) · `AFK`
- [x] **Slice 6** — Extract `apply_full_project_details` (refactor + tests) · `AFK`
- [x] **Slice 7** — Convert Tendering → Won · `AFK`

---

## Slice 1 — Retire `Created`, rename to `Won` (+ migration) · `HITL`

### What to build
Introduce `Won` as the initial lifecycle status of a real project and retire `Created`. Existing projects at `Created` are migrated to `Won`; the full-wizard creation path now writes `Won` as the starting status. The project status vocabulary (values, badge colors, the manually-selectable subset) is centralized, with `Won` rendered and the entry-only statuses kept out of the manual status dropdown.

### Acceptance criteria
- [ ] Migration patch rewrites every project at `status = "Created"` to `"Won"`; projects at other statuses are untouched.
- [ ] A project created through the existing 6-step wizard starts at `status = "Won"`.
- [ ] A `Won` status badge renders on the projects list and detail page.
- [ ] `Won` does not appear in the manual status-change dropdown.
- [ ] Migration verification test (B1) passes: no project remains at `Created` post-migration.

### Blocked by
- None — can start immediately.

---

## Slice 2 — Create & list a Tendering stub · `AFK`

### What to build
End-to-end creation of a Tendering stub. The new-project route first presents a "Won or Tendering" choice; choosing Tendering opens a minimal single-screen form capturing Project Name, City and State (via cascading State→City dropdowns sourced from the Pincodes master), and optional Customer. On submit, a backend endpoint creates a Projects record with `status = "Tendering"` and no Address or child tables; the `after_insert` milestone generation no-ops for stubs. The stub appears in a dedicated "Tendering" tab on the projects list and is excluded from the other tabs and the Total Projects count.

### Acceptance criteria
- [ ] Choosing "Tendering" on the new-project route opens the minimal form; choosing "Won" opens the existing 6-step wizard unchanged.
- [ ] Submitting the minimal form creates a project with `status = "Tendering"` storing only Name/City/State/optional Customer.
- [ ] No Address doc, work-package/work-header child rows, or Project Work Milestones are created for the stub.
- [ ] City is chosen via State→City cascading dropdowns from the Pincodes master; the project ID uses the chosen City (`{city}-PROJ-#####`).
- [ ] The stub appears only in the new "Tendering" tab, not in other status tabs, and is excluded from the Total Projects count; a Tendering badge renders.
- [ ] Only Nirmaan Admin and PMO Executive can reach the Tendering creation flow.

### Blocked by
- Slice 1.

---

## Slice 3 — Tendering stub: detail view, edit, delete · `AFK`

### What to build
A dedicated lightweight detail view for a Tendering stub: the project detail page early-returns this view (no operational tabs) when the status is `Tendering`, showing the four stub fields, a prominent "Convert to Won" call-to-action, and inline edit + delete. Editing is limited to Name/City/State/Customer; the full edit-project form is not available for a stub. A stub can be deleted outright.

### Acceptance criteria
- [ ] Opening a Tendering project shows the lightweight view with no operational tabs (Procurement, Financials, DC/MIR, etc.).
- [ ] The four stub fields can be edited inline; Customer can be linked after creation.
- [ ] The full edit-project form is not reachable for a Tendering project.
- [ ] A Tendering stub can be deleted.
- [ ] Editing City does not change the frozen project ID.
- [ ] Edit and delete are restricted to Nirmaan Admin and PMO Executive.

### Blocked by
- Slice 2.

---

## Slice 4 — Hide Tendering from project pickers (UI isolation) · `AFK`

### What to build
Exclude Tendering stubs from every project-selection control. A shared `status != "Tendering"` filter is applied to the shared project-select components, and the direct project-list queries used by operational pages are audited and patched to apply the same exclusion.

### Acceptance criteria
- [ ] A Tendering stub does not appear in project pickers for PR, PO, SR/WO, payments, inflows, invoices, DC/MIR, inventory, or reports.
- [ ] Won and other operational-status projects continue to appear in those pickers.
- [ ] No Tendering project can be set as the active/selected operational project through a picker.

### Blocked by
- Slice 2.

---

## Slice 5 — Backend operational guard (data isolation) · `AFK`

### What to build
A backend guard that prevents operational documents from being created against a Tendering project, as a server-side backstop behind the UI filtering. A small, isolated module exposes an `is_tendering` predicate and a `validate_not_tendering` helper that raises a clear validation error; it is wired into the validate/before-insert path of the operational doctypes.

### Acceptance criteria
- [ ] Attempting to create a Procurement Request, Procurement Order, Service Request/Work Order, Project Payment, Project Inflow, Project Invoice, or PO Delivery Document against a Tendering project raises a clear error naming the project.
- [ ] The guard passes for projects at Won/WIP/Completed/Halted/Handover/CEO Hold.
- [ ] Unit tests (B5) cover the predicate across the full status set and the raising behavior.

### Blocked by
- Slice 2.

---

## Slice 6 — Extract `apply_full_project_details` (refactor + tests) · `AFK`

### What to build
A behavior-preserving refactor that extracts the "full project" population logic (Address creation, work-package/category/make child rows, work-header child rows) out of the existing creation API into a single shared module, and routes the existing create path through it. No user-facing change; this sets up reuse by the convert flow.

### Acceptance criteria
- [ ] Creating a project through the existing 6-step wizard behaves exactly as before (same Address, child tables, downstream setup).
- [ ] The population logic lives in one shared function callable against either a freshly created project or an existing one.
- [ ] Unit tests (B3) cover correct population of Address, work-package/category/make rows, and work-header rows from a representative payload.

### Blocked by
- Slice 1.

---

## Slice 7 — Convert Tendering → Won · `AFK`

### What to build
The one-way "Convert to Won" action. A backend endpoint loads an existing Tendering project, runs the shared population module, and sets `status = "Won"` in place (identity/ID preserved), rejecting the call if the project is not currently Tendering. The existing 6-step wizard gains a convert mode that pre-fills the stub's known fields and, on submit, updates the existing project instead of creating a new one; the subsequent client-side setup (permissions, daily progress, design tracker, critical PO) runs against the converted project as today. If the real address's pincode resolves to a different city, the displayed city updates while the project ID stays frozen.

### Acceptance criteria
- [ ] "Convert to Won" opens the 6-step wizard pre-filled with the stub's Name/City/State/Customer.
- [ ] Submitting updates the same project (same ID) to `status = "Won"`, fully operational (Address, work packages, milestones present; appears in operational pickers).
- [ ] Converting a project that is not currently Tendering is rejected (one-way invariant enforced server-side).
- [ ] There is no UI path to revert a Won project to Tendering.
- [ ] A pincode that resolves to a different city updates the displayed city but not the project ID.
- [ ] Convert is restricted to Nirmaan Admin and PMO Executive.

### Blocked by
- Slice 2, Slice 6.
