# Project Action Items are a materialized, recompute-from-truth projection

**Status:** accepted (2026-06-22)

## Context

Project **Action Items** (the "what's outstanding on this project" work-queue — starting with
DN Pending and DC Pending) were first shipped (v1, `feature/project-action-items`) as a
**derive-on-read** computation: the project page computed the pending DC/DN counts live in the
browser on every visit, via `useDNDCQuantityData`. That made the obligation **ephemeral** — it
exists only while someone is looking at the page, so it cannot drive a reminder, a badge, a
notification, or a cross-project worklist, and it is recomputed on every view.

We want a **durable, role-targeted, lifecycle-driven** work-queue that persists independent of
page views and can power both the project page and a Project-Manager dashboard.

## Decision

Action Items are stored as a **materialized projection** in a dedicated **`Project Action Item`**
doctype, one row per **(Procurement Order, action_type)** obligation. The projection is kept
current by **recompute-from-truth**: a `reconcile_project_action_items(project)` rebuilds the
project's entire pending set from current document state and **idempotently upserts** rows (keyed
by a stable `dedup_key`), run by **enqueued event hooks** (PO / Delivery Note / PO Delivery
Documents) for timeliness **plus a nightly sweep** as the self-healing backstop.

## Considered options

- **Derive-on-read (the v1 approach).** Rejected: ephemeral; cannot notify, badge, aggregate
  cross-project, or persist; recomputes every view.
- **Delta event-log (create a row on event X, delete on event Y).** Rejected: it drifts into
  *phantom tasks* on PO revert, DN deletion, partial delivery, return notes, or any missed hook —
  the classic cache-invalidation trap. It is not foolproof.
- **Extend `Nirmaan Notifications`.** Rejected: that doctype is a per-recipient, immutable
  *event log*; forcing a per-PO, mutable, recompute-to-truth *state projection* into it conflicts
  with its grain and muddies the documented Action-Item vs Notification distinction.

## Consequences

- The DN/DC "pending" predicate must be computable in **Python** (v1 deliberately kept it
  frontend-only). This is cheap here: **DN Pending** becomes a PO-status check
  (`Dispatched` / `Partially Dispatched` / `Partially Delivered`, Billable), and **DC Pending** is
  a coarse PO-level "delivered Billable PO with no Delivery Challan document."
- **DN Pending is redefined** from the reconcile-report sense ("a Delivery Challan exists but no
  Delivery Note") to the worklist sense ("dispatched, not yet fully delivered"). See `CONTEXT.md`.
- Reverts, deletions, partial/return flows, and missed events all **self-heal** at the next
  reconcile (event or nightly), because rows are rebuilt to match truth, never deltated.
- The projection is **rebuildable from scratch** at any time (truncate + reconcile-all), which is
  also how existing POs are backfilled.
- It reuses existing materialization precedent (Approved-Quotations-on-dispatch), assignee
  resolution (`Nirmaan User Permissions` + `role_profile`), and the scheduler idiom
  (`pmo_task_renewal`).
