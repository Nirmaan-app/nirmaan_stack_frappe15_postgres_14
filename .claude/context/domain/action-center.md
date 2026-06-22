# Action Center — Domain Context

**Status:** v1 IMPLEMENTED (Surface B / Project Action Items) on branch `feature/project-action-items`.
v1 scope frozen via grilling session 2026-06-18; implemented 2026-06-19.
**Purpose:** Replace the high-volume Firebase/in-app notification flood with a *derived* work-queue
of pending action items, shown per-user (dashboard) and per-project (project overview).

**Implementation (v1):** Frontend-only. New component
`frontend/src/pages/projects/components/ProjectActionItems.tsx` (consumes
`useDNDCQuantityData(projectId).summary.{noDCUpdatePOs,pendingDNPOs}` verbatim — no re-filtering).
Mounted ONCE in `frontend/src/pages/projects/project.tsx` above the active tab's content, gated to
`role !== "Loading"/"Error" && activePage === getLandingTab(role)`. `getLandingTab(role)` is a new
module-scope single-source-of-truth for each role's landing tab; the project page's "Redirect users
to allowed tab" effect now routes its redirect targets through it too (so the gate and the redirect
can never drift). Tiles deep-link to the DC & MIR tab via `setActivePage(PROJECT_PAGE_TABS.DC_MIR)`.
Surface A (PM dashboard) remains deferred to v1.1. No backend / doctype / migration.

---

## Glossary (canonical terms)

| Term | Definition |
|---|---|
| **Action Item** | A *current outstanding obligation* derived from live document state (e.g. "this PO has no Delivery Challan yet"). It is a **state projection**, not an event: it self-resolves the moment the underlying condition clears — no "mark as read". This is the core distinction from a **Notification**. |
| **Notification** | An *event-log entry* (`Nirmaan Notifications` doctype): immutable, time-stamped, decays in relevance ("PR-123 was approved at 14:32"). The existing fan-out engine. Action Items do **not** replace payment/CEO notifications — those stay as push. |
| **Action Tile** | One task-type summary rendered in a surface — a label + count (e.g. "Delivery Challans — 5 Pending"). v1 has two tiles: **DC pending**, **DN pending**. |
| **Action Center** | **Surface A** — the right-hand panel on the **Project Manager dashboard**. Scope = aggregated across *the user's assigned projects*. User-scoped, cross-project. |
| **Project Action Items** | **Surface B** — a section mounted on each role's **effective landing tab** of the project detail page (Overview for Admin/PMO/Accountant; Work Report for PM/PL/Estimates; Critical POs for Procurement). Scope = *one project*. Project-centric / role-agnostic in v1. |
| **Scheduled / cadence action item** | A pending item that cannot be derived from a current document's status alone because it is defined by an *expected schedule* and the *absence* of a periodic submission (daily/weekly). Requires a schedule/SLA model + a generator. **Deferred from v1** (see below). |

---

## v1 scope (frozen)

- **Two tiles only — DC pending and DN pending** — because they are the only candidates with a
  **canonical, live source of truth** (the DN→DC reconcile report), are role-agnostic project facts,
  and need **zero new schema, zero migration, zero cadence model**.
- **Source of truth = the existing report, reused, never reinvented.** Both tile counts ARE the
  DN→DC report's own summary-card values:
  - DC pending = `summary.noDCUpdatePOs` (PO rolled up to `no_dc_update` = `dnQty>0 && dcQty===0`)
  - DN pending = `summary.pendingDNPOs` (PO rolled up to `pending_dn` = `dnQty===0 && dcQty>0`)
  - Both **Billable-only**, **per-PO**, over POs in `{Dispatched, Partially Dispatched, Delivered,
    Partially Delivered}`, excluding *Additional Charges* items, zero-activity items, and (for
    Partially-Dispatched POs) non-dispatched items. `mismatch` is **not** surfaced as a v1 tile.
  - Logic lives in `frontend/src/pages/reports/hooks/useDNDCQuantityData.ts` (a frontend `useMemo`
    over `generate_po_summary` + `get_project_po_delivery_documents` + a `Procurement Orders` list).
- **Architecture = frontend orchestration that reuses `useDNDCQuantityData`** — NOT a Python port.
  Rationale: the report logic is non-trivial and **actively evolving** (the Billable-only filter was
  added in commit `9510ef1e`); a Python copy would have already drifted. Reuse keeps one source of truth.
- **Two surfaces, one derivation:** Surface B passes `[one project]`; Surface A passes the PM's
  project list. No role branching anywhere in v1 (project-centric).

---

## Deferred — the "scheduled / cadence action item" class (one coherent fast-follow)

These were each removed from v1 because none has a canonical "pending" source and all share the same
missing mechanism — an *expected schedule* + *absence detection* + an SLA/due-date model:

- **MIR pending** — no predicate exists anywhere; defining one would create a second source of truth
  outside the report. (If built later: "Billable dispatched PO with a DC but no MIR for the same
  `parent_docname`", and mirror it into the DC/MIR report.)
- **Inventory update (Remaining Items Report)** — the only concrete signal is `status === "Draft"`
  (narrow); the *valuable* nudge ("project overdue for inventory") is a weekly staleness/cadence
  concept. The 3-day rule in `remaining_items_report.py` is a submission *guard*, not a pending def.
- **Daily Progress Report (DPR)** — "due today" is a daily cadence; no row exists to query for "missing".
- **Weekly Inventory Update** — weekly cadence; same shape as above.

**To resolve this class in a future update:** introduce a cadence/schedule definition (per project or
global: which recurring submissions apply, frequency, cutoff/SLA) + a generator or anti-join of
`(owned projects × expected periods)` against submitted reports, plus the Overdue / Due Today /
Upcoming due-date overlay (also deferred from v1 — v1 ships flat counts, no time buckets).

---

## Surfaces & mounting (audience reality)

The Project Overview tab renders **only for Admin / PMO / Accountant / Accountant Lead**
(`project.tsx:404–743`). Operational roles (PM, PL, Procurement, Estimates) never see it. Therefore
Surface B mounts a shared `<ProjectActionItems projectId=…>` component on **each role's effective
landing tab**, not literally on "Overview" — so it actually reaches "the rest of the users."
There is **no client-side per-project access gate**; any data path the section uses must be
project-scoped and rely on the backend permission layer for visibility.

## Existing notification system (what this augments)

- `Nirmaan Notifications` doctype: single `recipient` (Link), `seen` string, `action_url`, `event_id`.
- Fan-out: every state transition loops all eligible recipients → 1 record + 1 FCM push + 1 socket
  event each. ~22 event types, no dedup/aggregation/rate-limit — the "flood".
- Recipient resolution: `Nirmaan User Permissions` (`for_value=project`) + `role_profile`
  (`integrations/Notifications/pr_notifications.py`).
- **Notification triage (later):** keep payment/CEO pushes; demote DC/DN (+ future tiles) to the
  Action Center; the existing per-user socket events can become silent cache-invalidation signals.
