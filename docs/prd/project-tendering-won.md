# PRD: Project Tendering / Won

**Status:** Draft (local — not yet published to the issue tracker)
**Date:** 2026-05-29
**Authoritative decision record:** `docs/adr/0001-project-tendering-status.md` (revised single-field model)
**Vocabulary:** `CONTEXT.md` → "Project lifecycle & tendering"

## Problem Statement

The business pursues construction projects that are still being bid/tendered for, but
Nirmaan Stack can only record a *fully-specified* project. Creating one means going
through a 6-step wizard that hard-requires an address (via a pincode lookup), a timeline
with an end date, and at least one work package — and on submit it immediately spins up
work milestones, a design tracker, critical-PO tasks, and team permissions.

There is no way to register a *prospect* cheaply, before the bid is won and before the
scope is known. As a result prospects live outside the system (spreadsheets, memory)
until they are awarded, and there is no single place to see the pipeline of bids versus
awarded jobs.

## Solution

Let an authorized user register a lightweight **Tendering** project capturing only the
essentials — **Project Name, City, State, and (if known) the linked Customer** — with
none of the operational machinery. A Tendering project is an isolated stub: it never
appears in operational pickers, and no procurement, payment, invoice, service-request, or
design work can happen against it.

When a bid is awarded, the user runs **Convert to Won**, which completes the full project
information through the existing wizard and updates the *same* project in place — its
identity is preserved — after which it proceeds through the normal lifecycle. **Won**
replaces the retired **Created** status as the initial stage of every real project, and
is transient (it advances to WIP and beyond as work begins).

## User Stories

1. As an Admin/PMO Executive, I want to choose "Won or Tendering" when starting a new project, so that I can register a prospect without filling the full project form.
2. As an Admin/PMO Executive, I want to create a Tendering project with only Name, City, State, and optional Customer, so that I can capture a bid quickly.
3. As an Admin/PMO Executive, I want to pick City by first selecting State and then City from the Pincodes master, so that the city is valid and consistent for the project ID.
4. As an Admin/PMO Executive, I want to create a Tendering project without a pincode, address, timeline, or work packages, so that I am not blocked by information I do not have yet.
5. As an Admin/PMO Executive, I want a real (awarded) project to start at status "Won" through the existing 6-step wizard unchanged, so that my current workflow is preserved.
6. As an Admin/PMO Executive, I want a Tendering project to skip all automatic setup (work milestones, design tracker, critical-PO tasks, team permissions, address), so that stubs stay cheap and clean.
7. As a Procurement Executive / Project Manager / Project Lead / Accountant, I do not want Tendering projects to appear in any project picker, so that I cannot accidentally raise a PR, PO, SR, payment, invoice, or DC against a prospect.
8. As any operational user, I want the system to refuse creating operational documents against a Tendering project even if one slips through a picker, so that prospect records never accumulate operational data.
9. As an Admin/PMO Executive, I do not want Tendering projects counted in "Total Projects", so that pipeline stubs do not distort real-project metrics.
10. As an Admin/PMO Executive, I want to edit a Tendering project's Name, City, State, and Customer, so that I can fix typos and link the Customer once it is confirmed.
11. As an Admin/PMO Executive, I do not want the full edit-project form available for a Tendering project, so that I cannot accidentally add operational detail to a stub.
12. As an Admin/PMO Executive, I want to delete a Tendering project, so that I can remove a lost or duplicate prospect.
13. As an Admin/PMO Executive, I want to convert a Tendering project to Won via the existing 6-step wizard pre-filled with the stub's known fields, so that I complete it without re-keying.
14. As an Admin/PMO Executive, I want conversion to update the same project in place (keeping its ID), so that its identity and any references are preserved.
15. As an Admin/PMO Executive, I want conversion to run all the normal setup (address, work packages, milestones, design tracker, critical-PO tasks, permissions), so that the won project is fully operational.
16. As an Admin/PMO Executive, I want conversion to be one-way with no revert to Tendering, so that a project carrying real operational data can never be downgraded.
17. As an Admin/PMO Executive, if the real address's pincode resolves to a different city during conversion, I want the displayed city to update while the project ID stays frozen, consistent with existing pincode behavior.
18. As an Admin/PMO Executive, I want a dedicated "Tendering" tab on the Projects list with a slim table (Name/City/State/Customer) plus Convert and Edit actions, so that I can manage my pipeline.
19. As an Admin/PMO Executive, I want Tendering projects excluded from the Won and other status tabs, so that operational lists stay relevant.
20. As an Admin/PMO Executive, I want a Tendering project's detail page to show only its stub fields plus a prominent "Convert to Won" action and no operational tabs, so that the view matches the stub's reality.
21. As any user viewing the projects list, I want distinct status badges for Tendering and Won, so that I can tell pipeline from awarded at a glance.
22. As an Admin/PMO Executive, I do not want "Tendering" or "Won" to appear in the manual status-change dropdown, so that I cannot bypass the one-way convert rule or manually flip a live project.
23. As a maintainer, I want every project that existed before this feature migrated to "Won", so that the retired "Created" status disappears cleanly.
24. As the business, I want only Nirmaan Admin and PMO Executive to create, edit, convert, and delete Tendering projects, so that pipeline management mirrors existing project-creation permissions.

## Implementation Decisions

### Status modeling
- `Tendering` and `Won` are added as values of the existing single-valued, free-form project `status` field; `Created` is retired. The field remains free-form (no Select enum / doctype JSON migration).
- `Won` is the transient initial state of a real project (renamed `Created`); once execution begins, status advances to `WIP` and beyond. There is no permanent "was-won" marker — acceptable because any status other than `Tendering` denotes a real project.
- A migration patch rewrites every existing `status = "Created"` to `"Won"`; projects already at `WIP`/`Completed`/`Halted`/`Handover`/`CEO Hold` are untouched.
- `Tendering` and `Won` are **entry/convert-only** — neither is offered in the manual status-change dropdown (mirrors how `Created` behaved).

### Backend modules
- **B3 — `apply_full_project_details` (deep module).** Extract the "Won workflow" population logic (Address creation, `project_wp_category_makes`, `project_work_header_entries`) out of the existing project-creation API into one function consumed by **both** creation and conversion. Interface: accepts the target project plus the validated wizard payload, performs population, and leaves the `status` decision to the caller.
- **B2 — `create_tendering_project` API.** Whitelisted endpoint accepting Project Name, State, City, and optional Customer; creates a Projects doc with `status = "Tendering"`, no Address, no child tables; autoname stays `{city}-PROJ-#####`.
- **B4 — `convert_tendering_to_won` API.** Whitelisted endpoint that loads an existing Tendering project, invokes B3 with the full payload, sets `status = "Won"`, and saves in place. Rejects the call if the project is not currently `Tendering` (enforces the one-way invariant server-side).
- **B5 — Tendering operational guard (deep module).** An `is_tendering(project)` predicate and a `validate_not_tendering(project)` helper that raises a ValidationError naming the project. Wired into the validate/before_insert path of operational doctypes: Procurement Requests, Procurement Orders, Service Requests / Work Orders, Project Payments, Project Inflows, Project Invoices, PO Delivery Documents.
- **B6 — `generate_pwm` guard.** The Projects `after_insert` hook returns early when `status = "Tendering"` (stubs have no scopes), so no Project Work Milestones are generated. Behavior for Won projects is unchanged.

### Frontend modules
- **F1 — Project status vocabulary (deep-ish module).** A single source exposing the status values, the badge-color map, the manually-selectable subset (excludes Tendering/Won), and an `isTendering()` helper; consumed by the list page, detail page, and status dropdown (replacing today's scattered literals).
- **F2 — Cascading State→City selector (deep module).** A hook + component reading the Pincodes master to present distinct States then Cities within a State; emits `{ project_state, project_city }`. Reusable and unit-testable.
- **F3 — "Won or Tendering" choice screen.** The new-project route first presents the choice, routing to the existing 6-step wizard (Won) or the minimal stub form (Tendering).
- **F4 — Tendering minimal create/edit form.** Captures the four stub fields using F2; calls B2 on create and a minimal update on edit. The full edit-project form is disabled for stubs.
- **F5 — Convert mode for the 6-step wizard.** The existing wizard gains a convert mode that pre-fills the stub's known fields and, on submit, calls B4 (update-in-place) instead of the create API; the subsequent client-side setup steps (permissions, daily progress, design tracker, critical PO) run against the converted project exactly as today.
- **F6 — `TenderingProjectView`.** The project detail page early-returns a lightweight view (stub fields + Convert + minimal Edit + Delete) when `status = "Tendering"`, so the heavy role-based operational-tab machinery never runs for a stub.
- **F7 — Tendering list tab.** A dedicated tab + slim-table config on the Projects list; Won is the default tab; Tendering is excluded from all other tabs and from the "Total Projects" count.
- **F8 — Project-picker Tendering filter (cross-cutting).** A shared `status != "Tendering"` exclusion applied to the shared project-select components, plus an audit-and-patch of direct project-list queries in operational pages.

### Authorization
- Create / edit / convert / delete of Tendering projects is gated to **Nirmaan Admin + PMO Executive** on both the UI entry points and the backend APIs, mirroring today's project-creation permission.

## Testing Decisions

A good test exercises observable, external behavior through a module's public interface
— never its internals — and uses fixtures to set up realistic inputs. Per CLAUDE.md,
logic-bearing backend modules get real unit tests (no stubs); frontend coverage here is
immature (Cypress configured but largely unimplemented) and is handled by manual
verification this round.

Modules under test this round (confirmed scope):
- **B3 — `apply_full_project_details`:** given a payload, it creates the Address, correctly populates `project_wp_category_makes` and `project_work_header_entries`, and produces the same populated result whether the project was freshly created or is an existing Tendering stub being converted.
- **B5 — Tendering operational guard:** `is_tendering` returns correctly across the status set; `validate_not_tendering` raises for `Tendering` and passes for `Won`/`WIP`/etc.
- **B1 — Status migration:** post-migration, no project remains at `status = "Created"`, all former-`Created` projects are `"Won"`, and projects at other statuses are unchanged.

Prior art: co-located `test_<name>.py` `FrappeTestCase` doctype tests, and the
`boq_parser` real-fixture unit tests (the established pattern for logic-bearing modules).

Not tested by automation this round: B2/B4 create/convert APIs beyond the coverage B3
gives them, and all frontend modules (manual + deferred Cypress).

## Out of Scope

- Any permanent "was-won" marker or conversion-history reporting (the single-field model makes `Won` transient — accepted).
- Reverting `Won` → `Tendering`.
- Capturing partial operational data (packages, team, timeline) on a Tendering stub.
- Bulk import of Tendering prospects.
- Tendering-specific notifications or real-time events.
- Changes to the existing `Won` (formerly `Created`) → `WIP` → … lifecycle, or to the manual status dropdown beyond excluding `Tendering`/`Won`.
- An `Address` doc for Tendering stubs.
- Redesigning the project pickers beyond applying the exclusion filter.

## Further Notes

- `autoname` uses the Tendering-stage City and is frozen; after a convert that changes City via pincode, the displayed City may differ from the name prefix — consistent with the existing "changing pincode won't change the project id" behavior.
- `generate_pwm` already no-ops on empty scopes; the B6 guard makes the intent explicit and robust.
- Suggested build order for the issue breakdown: (1) migration + status vocabulary; (2) B3 extraction + tests; (3) Tendering create API + minimal form + choice screen; (4) operational guard + picker filter; (5) convert mode + B4; (6) list tab + stub detail view.
