# 1. Project Tendering Status

Date: 2026-05-28

## Status

Accepted. **Revised 2026-05-29** — the model changed from a separate, orthogonal
`tendering_status` field to **two new values on the existing `status` field**
(`Tendering`, `Won`), with `Created` retired. This revision supersedes the
original orthogonal-field proposal, which was never implemented.

## Context

The business needs to track projects that are still being bid/tendered for,
separately from projects that have been awarded. Until now every record in
`Projects` represented a real, awarded job and carried the full set of
information (address, timeline, work packages, team). There was no way to
register a prospect cheaply, before the bid is won and before the full scope is
known.

`Projects` already has a free-form `status` field describing the operational
lifecycle of an awarded job: `Created`, `WIP`, `Completed`, `Halted`,
`Handover`, `CEO Hold`. Creation goes through a 6-step wizard
(`frontend/.../project-form`) and a backend API
(`api/projects/new_project.create_project_with_address`) that hard-requires an
end date, at least one work package, and a valid city/state (derived from a
Pincode lookup), and always creates an `Address` doc. City/State feed the
project `autoname` (`{city}-PROJ-#####`).

## Decision

Add **`Tendering`** and **`Won`** as two new values of the existing free-form
`status` field and retire **`Created`**. `status` stays single-valued.

1. **Status values, not a separate field.** `Tendering` = a bid/prospect stub;
   `Won` = the initial stage of a real/awarded job (the renamed `Created`).
   `Won` is **transient** — once execution begins the status advances to `WIP`
   and beyond, so there is no permanent "was-won" marker (acceptable, because
   `Tendering` is the only special case: any status ≠ `Tendering` is a real
   project). A migration patch rewrites every existing `status = "Created"` to
   `"Won"`; projects already at `WIP`/`Completed`/etc. are untouched.

2. **Tendering projects are isolated stubs.** A Tendering project stores only
   Project Name, City, State, and (optional) Customer. No `Address` doc, no
   pincode, no work packages, no team, no timeline. It is hidden from every
   project-selection dropdown and excluded from all operational modules
   (PR/PO/SR/payments/invoices/design). It appears only on a dedicated
   `Tendering` tab on the Projects list and on a dedicated lightweight detail
   view.

3. **City/State via cascading State→City dropdowns** sourced from the existing
   `Pincodes` master. Stored directly on the Projects doc
   (`project_city`/`project_state`); `autoname` uses City (`{city}-PROJ-#####`)
   and is frozen at creation.

4. **Creation via a pre-wizard choice screen.** `/projects/new-project` first
   asks "Won or Tendering". Won → the existing 6-step wizard (unchanged, status
   `Won`). Tendering → a minimal single-screen form (status `Tendering`).

5. **Stubs are minimally editable and deletable.** A stub's four fields
   (Name/City/State/Customer) can be edited inline (Customer is commonly linked
   after the prospect is entered); the full edit-project-form is disabled for
   stubs. A stub may be deleted outright (no downstream data exists).

6. **Conversion reuses the creation wizard in "convert" mode.** "Convert to Won"
   opens the same 6-step wizard, pre-filled with the stub's fields; on submit it
   **updates the existing project in place** (creates the Address doc, populates
   work packages, runs all creation side-effects, sets `status = "Won"`) — the
   project identity (docname) is preserved. During convert the pincode lookup
   may set a new `project_city`/`project_state`, but the frozen docname does not
   change.

7. **One-way transition.** `Tendering → Won` is permanent; there is no reverse.
   `Tendering` and `Won` are **entry/convert-only** — neither appears in the
   manual status-change dropdown (exactly how `Created` behaved).

8. **Operational blocking is defense-in-depth.** The UI filters
   `status ≠ "Tendering"` from project pickers and list queries, **and** a
   backend guard rejects creation of operational docs (PR/PO/SR/payment/
   invoice/DC) against a `Tendering` project.

9. **Authorization** mirrors today's project-creation permission: Nirmaan Admin
   and PMO Executive may create, edit, convert, and delete Tendering projects.

10. **List & detail surfacing.** The Projects list gets a `Tendering` tab (slim
    table + Convert/Edit actions); Tendering stubs are excluded from all other
    tabs and from "Total Projects" counts. The detail page (`project.tsx`)
    early-returns a dedicated `TenderingProjectView` for stubs rather than
    gating each operational tab.

## Consequences

- `status` now carries a non-lifecycle prospect concept (`Tendering`); readers
  must treat `status = "Tendering"` as "not a real project yet." Any query that
  lists projects without constraining `status` will include stubs unless
  explicitly excluded. The glossary in `CONTEXT.md` defines the value set.
- A `Projects` record can now legitimately exist with no work packages, no
  address, and (optionally) no customer. Code that assumes a fully-populated
  project must be guarded against Tendering stubs (dropdown filters, the
  dedicated stub detail view, operational entry points).
- `generate_pwm` (the `after_insert` hook) must no-op for Tendering stubs — they
  have no scopes, so it should be guarded to skip when `status = "Tendering"`.
- The one-way invariant keeps reasoning simple and protects operational data
  (a Won project may already have POs/payments); the cost is that a mistaken
  conversion cannot be undone through the UI.
- `autoname` uses the Tendering-stage City and is frozen thereafter; after a
  convert that changes City via pincode, the displayed City may differ from the
  name prefix — consistent with the existing "changing pincode won't change the
  project id" behaviour.
- Because `Won` is transient and `status` is single-valued, there is no stored
  flag distinguishing "entered directly as Won" from "converted from Tendering"
  once work begins. This is accepted.
