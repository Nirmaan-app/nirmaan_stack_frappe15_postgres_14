# PRD: Project Tendering / Won / Lost (dual-field model)

**Status:** Draft (local — not yet published to the issue tracker)
**Date:** 2026-05-29 (v3 — dual-field model)
**Authoritative decision record:** `docs/adr/0001-project-tendering-status.md` (v3)
**Vocabulary:** `CONTEXT.md` → "Project lifecycle & tendering"

## Problem Statement

The business pursues construction projects that are still being bid/tendered for, but
Nirmaan Stack can only record a *fully-specified* project. Creating one means going
through a 6-step wizard that hard-requires an address (via a pincode lookup), a
timeline with an end date, and at least one work package — and on submit it
immediately spins up work milestones, a design tracker, critical-PO tasks, and team
permissions.

There is no way to register a *prospect* cheaply, before the bid is won and before
the scope is known. As a result prospects live outside the system (spreadsheets,
memory) until they are awarded, and there is no single place to see the pipeline of
bids vs. awarded jobs — or to record bids that are **lost** so that pipeline analytics
have a denominator.

## Solution

Let an authorized user register a lightweight **Tendering** project capturing only
the essentials — **Project Name, City, State, and (if known) the linked Customer** —
with none of the operational machinery. A Tendering project is an isolated stub: it
never appears in operational pickers, and no procurement, payment, invoice,
service-request, or design work can happen against it.

When a bid is awarded, the user runs **Convert to Won**, which completes the full
project information through the existing wizard and updates the *same* project in
place — its identity is preserved — after which it proceeds through the normal
lifecycle (`status = "Created"` → `WIP` → …).

When a bid is **lost**, the user runs **Mark as Lost**. The project stays in the
system as a permanent pipeline record but is read-only and excluded from every
operational surface.

The bid lifecycle and the execution lifecycle live in **two separate fields** so
that `Won` can be recorded permanently (not lost when execution advances past
`Created`), and `Lost` has a place to live without polluting the execution states.

## Data model (the only schema change)

- **NEW field on Projects:** `tendering_status` — Select, options
  `Tendering` / `Won` / `Lost`.
- **EXISTING field `status` (free-form `Data`, not Select) keeps its original
  value set:** `Created` / `WIP` / `Completed` / `Halted` / `Handover` /
  `CEO Hold`. The valid values are enforced in the frontend vocabulary
  (`src/components/common/projectStatus.ts`), not by a doctype Select option
  list. v2 was never deployed, so `status="Tendering"` and `status="Won"`
  never existed in prod and nothing has to be removed.

| State | `tendering_status` | `status` |
|---|---|---|
| Stub (prospect) | `Tendering` | `""` (null) |
| Lost bid (terminal) | `Lost` | `""` (null) |
| Awarded, just converted / just created | `Won` | `Created` |
| Awarded, in execution | `Won` | `WIP` / `Completed` / `Halted` / `Handover` / `CEO Hold` |

## User Stories

### Stub creation, edit, delete (unchanged from v2)
1. As an Admin/PMO Executive, I want to choose "Won or Tendering" when starting a new project, so that I can register a prospect without filling the full project form.
2. As an Admin/PMO Executive, I want to create a Tendering project with only Name, City, State, and optional Customer, so that I can capture a bid quickly.
3. As an Admin/PMO Executive, I want to pick City by first selecting State and then City from the Pincodes master, so that the city is valid and consistent for the project ID.
4. As an Admin/PMO Executive, I want to create a Tendering project without a pincode, address, timeline, or work packages, so that I am not blocked by information I do not have yet.
5. As an Admin/PMO Executive, I want a real (awarded) project to start at `tendering_status = "Won"` and `status = "Created"` through the existing 6-step wizard unchanged, so that my current workflow is preserved.
6. As an Admin/PMO Executive, I want a Tendering project to skip all automatic setup (work milestones, design tracker, critical-PO tasks, team permissions, address), so that stubs stay cheap and clean.
7. As an Admin/PMO Executive, I want to edit a Tendering project's Name, City, State, and Customer, so that I can fix typos and link the Customer once it is confirmed.
8. As an Admin/PMO Executive, I do not want the full edit-project form available for a Tendering or Lost project, so that I cannot accidentally add operational detail to a non-Won record.
9. As an Admin/PMO Executive, I want to delete a Tendering or Lost project, so that I can remove a duplicate prospect or clean up old records.

### Convert (Tendering → Won)
10. As an Admin/PMO Executive, I want to convert a Tendering project to Won via the existing 6-step wizard pre-filled with the stub's known fields, so that I complete it without re-keying.
11. As an Admin/PMO Executive, I want conversion to update the same project in place (keeping its ID), so that its identity and any references are preserved.
12. As an Admin/PMO Executive, I want conversion to run all the normal setup (address, work packages, milestones, design tracker, critical-PO tasks, permissions) **and** set `tendering_status = "Won"` and `status = "Created"`, so that the won project is fully operational and the bid outcome is permanently recorded.
13. As an Admin/PMO Executive, I want conversion to be one-way with no revert to Tendering, so that a project carrying real operational data can never be downgraded.
14. As an Admin/PMO Executive, if the real address's pincode resolves to a different city during conversion, I want the displayed city to update while the project ID stays frozen, consistent with existing pincode behavior.

### Lost (new in v3)
15. As an Admin/PMO Executive, I want to mark a Tendering project as Lost from its detail view (and from the Tendering tab row actions), so that I can close out a dead bid without losing the historical record.
16. As an Admin/PMO Executive, I want a Lost project to be read-only (no Edit, no Convert), so that nobody can resurrect a closed bid by editing it.
17. As an Admin/PMO Executive, I want Lost to be terminal — no revert to Tendering, no convert to Won, so that the closeout is final.
18. As an Admin/PMO Executive, I want a Lost sub-toggle on the Tendering tab, so that I can browse my Lost pipeline separately without polluting the active prospect list.
19. As any operational user, I do not want Lost projects to appear in any project picker or operational list, so that I cannot accidentally raise a PR/PO/etc. against them.

### Operational isolation (predicate flips Tendering → non-Won)
20. As a Procurement Executive / Project Manager / Project Lead / Accountant, I do not want Tendering or Lost projects to appear in any project picker, so that I cannot accidentally raise a PR, PO, SR, payment, invoice, or DC against a non-Won record.
21. As any operational user, I want the system to refuse creating operational documents against a non-Won project (Tendering or Lost) even if one slips through a picker, so that prospect / dead records never accumulate operational data.
22. As an Admin/PMO Executive, I do not want Tendering or Lost projects counted in "Total Projects", so that pipeline records do not distort real-project metrics.

### List & detail surfacing
23. As an Admin/PMO Executive, I want a dedicated "Tendering" tab on the Projects list with a slim table (Name/City/State/Customer) + a Tendering/Lost sub-toggle, so that I can manage my bid pipeline in one place.
24. As an Admin/PMO Executive, I want Tendering / Lost projects excluded from the Created / WIP / Completed / Halted / Handover / CEO Hold tabs, so that operational lists stay relevant.
25. As an Admin/PMO Executive, I want a Tendering project's detail page to show only its stub fields plus prominent "Convert to Won" and "Mark as Lost" actions and no operational tabs, so that the view matches the stub's reality.
26. As an Admin/PMO Executive, I want a Lost project's detail page to show the same stub fields but read-only (no Convert, no Edit, no Mark-as-Lost — only Delete for cleanup), so that it stays a historical record.
27. As any user viewing the projects list, I want distinct status badges for Tendering, Won, and Lost, so that I can tell pipeline from awarded from dead at a glance.
28. As an Admin/PMO Executive, I do not want `Tendering`, `Won`, or `Lost` to appear in the manual `status` dropdown, so that I cannot bypass the one-way Convert/Mark-as-Lost rules or manually flip a live project. (`tendering_status` is never user-editable through a dropdown — only through the dedicated Create / Convert / Mark-as-Lost flows.)

### Migration
29. As a maintainer, I want every existing project row to be stamped with `tendering_status = "Won"` (and `status` left untouched) by a one-shot idempotent patch, so the dual-field model is consistent across all pre-v3 rows. (v2 was never deployed, so no v2 leftovers need cleanup.)

### Authorization
30. As the business, I want only Nirmaan Admin and PMO Executive to create, edit, convert, mark-as-lost, and delete Tendering / Lost projects, so that pipeline management mirrors existing project-creation permissions.

## Implementation Decisions

### Status modeling (v3)
- **`tendering_status`** is a NEW Select field on `Projects` with options `Tendering`, `Won`, `Lost`. Single source of truth for the bid dimension. Never user-editable through a dropdown.
- **`status`** stays a pure execution-lifecycle field (free-form `Data`, valid set enforced in `src/components/common/projectStatus.ts`): `Created`, `WIP`, `Completed`, `Halted`, `Handover`, `CEO Hold`. v2 never reached prod, so `status="Tendering"`/`"Won"` never existed and there's nothing to remove.
- `Created` is the post-convert / post-direct-create initial execution stage (same as pre-v2).
- A stub (Tendering or Lost) has `status = ""` (null) — it has no execution stage yet.
- One-way transitions: `Tendering → Won` (via Convert), `Tendering → Lost` (via Mark-as-Lost). No reverse.

### Backend modules
- **B0 — Projects schema change.** Add the `tendering_status` Select field (options `\nTendering\nWon\nLost`, no default at the doctype level — set by APIs). The existing `status` field stays as-is (free-form `Data`) — there's nothing to remove because v2 was never deployed.
- **B1 — v3 migration patch.** [`backfill_tendering_status_for_old_projects.py`](../../nirmaan_stack/patches/v3_0/backfill_tendering_status_for_old_projects.py) — stamps `tendering_status = "Won"` on every existing Projects row, leaving `status` untouched. Idempotent (skips rows where `tendering_status` is already set).
- **B2 — `create_tendering_project` API.** Unchanged signature. Sets `tendering_status = "Tendering"` and `status = ""` instead of `status = "Tendering"`.
- **B3 — `apply_full_project_details`.** Unchanged (still the shared population helper); only its callers change the status-write semantics.
- **B4 — `convert_tendering_to_won` API.** Now enforces `tendering_status == "Tendering"` (was `status == "Tendering"`). On success sets `tendering_status = "Won"` AND `status = "Created"` (was `status = "Won"`).
- **B4b — `mark_tendering_project_lost` API (NEW).** Whitelisted endpoint that flips `tendering_status` from `Tendering` to `Lost`. Rejects unless currently `Tendering`. Does NOT touch `status` (stays null). No other side effects.
- **B5 — Operational guard.** Rename `is_tendering` → `is_pre_won`; rename `validate_not_tendering` → `validate_won`. Predicate flips from `status == "Tendering"` to `tendering_status != "Won"`. All seven wired callers (PR / PO / SR / payments / inflows / invoices / PDD) update to the new helper name.
- **B6 — `generate_pwm` guard.** Predicate flips from `status == "Tendering"` to `tendering_status != "Won"`.
- **B7 — `update_tendering_project` API.** Predicate flips from `status == "Tendering"` to `tendering_status == "Tendering"`. Lost projects cannot be edited.
- **B8 — `delete_tendering_project` API.** Predicate flips from `status == "Tendering"` to `tendering_status IN ("Tendering","Lost")`. Both stub states are deletable.
- **B9 — Direct full-create path.** `create_project_with_address` (existing full-create API) now writes `tendering_status = "Won"` and `status = "Created"` in one shot (was writing `status = "Won"`).

### Frontend modules
- **F1 — Project status vocabulary.** Split into two: an execution-status vocab (`Created`/`WIP`/`Completed`/`Halted`/`Handover`/`CEO Hold`, with the manual-dropdown subset = all of these) and a tendering-status vocab (`Tendering`/`Won`/`Lost`, never user-editable). Badge-color map covers both fields. Helpers: `isTenderingStub()` (`tendering_status === "Tendering"`), `isLost()` (`tendering_status === "Lost"`), `isOperational()` (`tendering_status === "Won"`).
- **F2 — Cascading State→City selector.** Unchanged.
- **F3 — "Won or Tendering" choice screen.** Unchanged — but the "Won" branch's submit now writes `tendering_status = "Won"` + `status = "Created"` (via B9), and the "Tendering" branch's submit writes `tendering_status = "Tendering"`.
- **F4 — Tendering minimal create/edit form.** Submit semantics unchanged at the form level (calls B2/B7); only the success/failure shapes are unchanged.
- **F5 — Convert mode for the 6-step wizard.** Calls B4 unchanged at the form level; the success contract now guarantees `tendering_status = "Won"` + `status = "Created"`.
- **F5b — Mark-as-Lost action (NEW).** A button on `TenderingProjectView` (and the Tendering tab row actions) that calls B4b behind a confirm dialog. Visible only when `tendering_status === "Tendering"` and the user is Admin/PMO.
- **F6 — `TenderingProjectView`.** Triggered when `tendering_status !== "Won"`. For `Tendering`: renders Convert + Edit + Mark-as-Lost + Delete (Admin/PMO). For `Lost`: renders the same stub fields read-only, plus Delete only — no Convert / Edit / Mark-as-Lost.
- **F7 — Tendering list tab.** Tab filter changes to `tendering_status IN ("Tendering","Lost")`. Sub-toggle inside the tab switches between `Tendering` (default) and `Lost`. All other tabs (`Created`/`WIP`/…) filter by `tendering_status = "Won"` AND the corresponding execution `status`. "Total Projects" filters `tendering_status = "Won"`.
- **F8 — Project-picker filter (cross-cutting).** All shared project-picker components switch from `status != "Tendering"` to `tendering_status = "Won"`. Audit-and-patch direct list queries in operational pages.

### Authorization
- Nirmaan Admin + PMO Executive (plus the `Administrator` user) on both UI entry points and backend APIs, mirroring today's project-creation permission. v3 adds a server-side `_ensure_tendering_manager()` role check at the top of every whitelisted tendering endpoint — closing the pre-v3 gap where `ignore_permissions=True` would have let any authenticated user call those APIs directly.

## Testing Decisions

Three test files cover the backend end-to-end (**29 tests total, all green**):

- **[`test_tendering_guard.py`](../../nirmaan_stack/api/projects/test_tendering_guard.py)** (11 tests) — `is_pre_won` returns True for `tendering_status ∈ {Tendering, Lost}` and False for `Won` at every execution stage (Created / WIP / Completed / Halted / Handover / CEO Hold); `validate_won` raises ValidationError naming the project + doctype label for pre-Won and is a no-op for Won; empty/None/non-existent project names handled gracefully.
- **[`test_convert_tendering.py`](../../nirmaan_stack/api/projects/test_convert_tendering.py)** (4 tests) — convert in place sets `tendering_status="Won"` + `status="Created"`, populates Address + work-package child rows, freezes the docname even when city changes via pincode, rejects a second convert (one-way), rejects missing project.
- **[`test_tendering_api.py`](../../nirmaan_stack/api/projects/test_tendering_api.py)** (14 tests) — B2/B7/B4b/B8/B9:
  - Create stub writes `tendering_status="Tendering"` + empty `status`, no Address, no PWMs, autoname uses city prefix, rejects missing required fields.
  - Update changes the four stub fields, freezes the docname even when city changes, rejects Lost/Won/missing projects.
  - Mark-as-Lost flips `tendering_status` to `Lost` without touching `status`, is terminal (cannot re-mark), rejects Won projects.
  - Delete allows Tendering and Lost, permanently protects Won.
  - Direct full-create writes both fields (`Won` + `Created`) in one shot, populates Address + child rows.

Not covered by automation: frontend modules (manual + deferred Cypress). Frontend test coverage is intentionally deferred — there is no Cypress harness around the project flows yet, and the backend tests pin the contracts that the frontend submits against.

Run all three:
```bash
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
  bench --site localhost run-tests \
    --module nirmaan_stack.api.projects.test_tendering_guard \
    --module nirmaan_stack.api.projects.test_convert_tendering \
    --module nirmaan_stack.api.projects.test_tendering_api
```

## Out of Scope

- Any UI to manually edit `tendering_status` (only the Create / Convert / Mark-as-Lost flows touch it).
- Reverting `Won → Tendering` or `Lost → Tendering`.
- Capturing partial operational data (packages, team, timeline) on a Tendering or Lost stub.
- Bulk import of Tendering prospects.
- Tendering/Lost-specific notifications or real-time events.
- Changes to the `Created → WIP → …` execution lifecycle or to the manual `status` dropdown beyond restoring `Created`.
- An `Address` doc for Tendering / Lost stubs.
- Redesigning the project pickers beyond applying the `tendering_status = "Won"` filter.

## Further Notes

- `autoname` uses the Tendering-stage City and is frozen; after a convert that changes City via pincode, the displayed City may differ from the name prefix — consistent with the existing "changing pincode won't change the project id" behavior.
- v2's `generate_pwm` guard predicate becomes `tendering_status != "Won"` — also covers the Lost case for free.
- Suggested build order: (1) B0 doctype schema; (2) B1 migration patch; (3) B5 guard rename + all 7 caller updates; (4) B2/B4/B7/B8/B9 API updates + B4b new endpoint; (5) F1 vocab split + F3/F4/F5 small contract updates; (6) F5b Mark-as-Lost UI; (7) F6 view branches (Lost read-only); (8) F7 tab filter + sub-toggle; (9) F8 picker filter audit.
