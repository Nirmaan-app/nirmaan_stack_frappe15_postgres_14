# Action Center — Domain Context

**Purpose:** Replace the high-volume Firebase/in-app notification flood with a *derived* work-queue
of pending action items, shown per-user (dashboard panel) and per-project (project overview).

**Status:** IMPLEMENTED. The dashboard panel now carries **three tiles — DN, DC, DPR — fed by TWO
different data sources.** The DN/DC-vs-DPR split below is load-bearing; read it before touching either.

## The panel & its three tiles (DN / DC / DPR)

`frontend/src/components/action-center/ActionCenter.tsx` is the **Surface-A** panel (LIVE badge, four
tabs **All / DPR / DN / DC**, project-grouped pending list), mounted on the PM dashboard
(`components/layout/dashboards/dashboard-pm.tsx`). It reads **two endpoints**, both in
`nirmaan_stack/api/action_items/read.py`:

- **DN / DC** ← `get_my_action_items` → the **materialized `Project Action Item` projection**.
- **DPR** ← `get_my_pending_dprs` → a **LIVE query** over `Projects` + `Project Progress Reports`
  (nothing stored).

`All` = DN + DC + DPR. DN/DC counts = `rows.filter(action_type === "DN_PENDING" | "DC_PENDING")`;
DPR count = the live items-array length. DPR rows render as compact **zone chips** grouped per project
(blue-themed); DN/DC rows stay detailed (red-themed).

## DN / DC vs DPR — two obligation KINDS, two sources (load-bearing)

**DPR is deliberately NOT stored in `Project Action Item`.** This is the core design decision — do not
"unify" them.

| | DN / DC | DPR |
|---|---|---|
| Kind | **STATE** obligation | **TIME** obligation |
| "Pending" changes when… | a document event fires (PO dispatched, DN/challan filed) | the calendar rolls to a new day (no doc event) |
| Keyed by | a **PO** (`reference_name`) | a **(project, zone, date)** — not a PO |
| Resets | only when the underlying state clears | **every day** |
| Storage | **materialized** in `Project Action Item`, maintained by the reconcile engine (doc hooks + nightly sweep) | **computed live on read** — nothing stored |
| Endpoint | `get_my_action_items` | `get_my_pending_dprs` (same module, separate logic + storage) |
| Project-status gate | suppress `Completed` + `Halted` (**keeps** CEO Hold, so the DN count can drive a CEO Hold) | suppress `Completed` + `CEO Hold` + `Halted` |

**Why DPR is live, not materialized:** a DPR "becomes due" purely because a new day started — there is
no document event for the reconcile engine to hook, and the obligation is per-zone-per-day, not per-PO.
Materializing it would mean regenerating (active projects × zones) rows every midnight, unbounded
Resolved-row growth, and a `dedup_key` / `reference_doctype` mismatch (projection rows are PO-keyed). So
it stays a cheap live read (3 bulk queries + a Python join). It *lives* in the action_items module (it
feeds the same Action Center) but shares **no storage** with the projection.

**DPR "pending" definition (`get_my_pending_dprs`):** for each active project the caller can access
(`status` set & not in {Completed, CEO Hold, Halted}, `disabled_dpr` off), enumerate its zones
(`Projects.project_zones` → `Project Zone Child Table.zone_name`) and subtract the zones that already
have TODAY's `report_status == "Completed"` `Project Progress Reports` row. Each remaining (project,
zone) is one pending item → `/prs&milestones/milestone-report/{project}?zone={zone}`. A Draft (not
Completed) still counts as pending; a zoneless project yields nothing (zones must be defined first).

> **⚠️ Current data gotcha:** the `Project Action Item` table is EMPTY in the prod-restored DB
> (`total = 0`) — the reconcile backfill (`reconcile_all()`) has never run and the scheduler/hooks may
> be off — so DN/DC read 0 despite real pending work (a live recompute found DN = 2, DC = 877). DPR is
> unaffected (it's live). Fix: run `reconcile_all()` once + confirm the scheduler is enabled.

---

### History (superseded)

v1 (frozen via grilling 2026-06-18, implemented 2026-06-19) shipped **Surface B only**, frontend-only:
`frontend/src/pages/projects/components/ProjectActionItems.tsx` reusing
`useDNDCQuantityData(projectId).summary.{noDCUpdatePOs,pendingDNPOs}` verbatim, mounted on each role's
landing tab; Surface A was deferred. That was superseded by Abhishek's **materialized projection**
(`Project Action Item` doctype + reconcile engine + read API, commit `4f36ab21`), which now backs
Surface A's DN/DC. The frontend-reuse notes below describe that older Surface-B path.

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
- **Daily Progress Report (DPR)** — ✅ **NOW IMPLEMENTED** as a LIVE tile (`get_my_pending_dprs`) at
  zone/day granularity (see "DN / DC vs DPR" above). It did NOT need the cadence/schedule model below —
  "missing today" is derivable live by anti-joining active projects' zones against today's Completed
  reports. Only the remaining cadence items still need it.
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
