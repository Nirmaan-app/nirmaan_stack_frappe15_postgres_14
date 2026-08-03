# CEO Hold is a multi-source projection: a reasons table behind one status

**Status:** accepted (2026-06-23) — implementation pending (see `docs/ceo_hold_delivery_pending_plan.md`)

## Context

A project's **CEO Hold** is today a single free-text `status` value plus a single `ceo_hold_by` marker.
It can be set two ways:

- **Manually**, only by `nitesh@nirmaan.app`, via the project status dropdown. Enforced in
  `projects.py` `_validate_ceo_hold_status()`; stamps `ceo_hold_by = nitesh`.
- **Automatically**, by the cashflow-gap engine (`integrations/controllers/project_cashflow_hold_update.py`),
  when a project's computed cashflow gap exceeds its `cashflow_gap_limit`. It writes
  `status="CEO Hold"` + `ceo_hold_by="System (Cashflow Cron)"` via `frappe.db.set_value(update_modified=False)`,
  deliberately **bypassing** the manual-only `validate()` guard. It auto-releases (only its own
  `System`-marked holds) when the gap recovers, reverting to the last user-set status found in Version history.

So the documented "only nitesh can set/unset CEO Hold" invariant is **already** false for automatic holds.

We now need a **second** automatic hold: place a project on CEO Hold when it has **more than 4 Purchase Orders
awaiting delivery** (the `DN_PENDING` obligation already tracked by the Project Action Item projection), with a
**stored, human-readable reason** — and the **existing** cashflow auto-hold must also start persisting a reason
(today it logs the "why" only to a transient log line).

The blocking problem: **one `status` + one `ceo_hold_by` + one reason field cannot represent a project held by
two independent system conditions at once.** Whichever engine writes last wins the slot, and that engine's
auto-release then clears a project the *other* condition still wants held. The cashflow release path keys solely
on `ceo_hold_by == "System (Cashflow Cron)"` and checks **only** the gap — so a delivery-driven hold sharing that
marker would be wrongly released the instant the cashflow gap is healthy.

## Decision

Model the automatic holds as a **recompute-from-truth projection**, exactly like Project Action Items (ADR-0002):

- Each automatic (**system**) hold condition is one row in a new standalone, project-linked **`CEO Hold Reason`**
  doctype: `{project, source ∈ {cashflow, dn_pending}, reason_text, set_at}`, unique per `(project, source)`.
- A project is on **CEO Hold** while a **manual hold is active OR ≥1 `CEO Hold Reason` row exists**. It leaves
  CEO Hold only when there is **no manual hold AND zero reason rows**.
- `status` and `ceo_hold_by` become **derived mirrors**, maintained by a single serialized owner —
  `recompute_ceo_hold(project)` — which takes the Projects row `FOR UPDATE` lock, reads the reason rows, and
  writes the mirror via `set_value(update_modified=False)`. **Every** CEO-Hold write funnels through it, so the
  cashflow engine and the action-item reconcile can never race on the slot.
- **Each engine owns only its own source's rows.** It adds / refreshes / removes its row, then calls
  `recompute`. No engine touches another source's row → no clobber.
- The **delivery-pending** reason auto-releases **symmetrically** (count ≤ 4 → remove its row). When the last
  hold lifts, the project reverts to its prior status via the existing Version-history walk (`WIP` fallback).
- The **manual** hold stays exactly as today (single-slot, nitesh-only gate) — it is **not** moved into the
  table. It is already clobber-safe (it never auto-releases, and release paths skip non-system holds). The only
  manual-path change: a manual move **off** CEO Hold is **rejected** while any reason row is active.
- `ceo_hold_by` becomes a generic "held by system" marker (the existing `System (Cashflow Cron)` sentinel)
  whenever a system reason holds the project and no manual hold is in effect; the per-source *why* lives in the
  reason rows. No constant rename — the banner's System/Manual badge still keys off the sentinel.

## Considered options

- **Single slot, last-writer-wins (one `status` + one reason).** Rejected: the clobber above — one source's
  auto-release un-holds a project the other still wants held.
- **Single slot, but every auto-release re-checks all conditions.** Rejected: each releaser must know every
  hold rule (coupling grows with each future source), and a single reason string still can't show two reasons.
- **Universal reasons table (manual holds too).** Rejected *for now*: it would refactor the tested nitesh-only
  authorization path (dropdown → endpoint) for **no correctness gain** — a manual hold never auto-releases, so
  it is already clobber-safe. Auto-only keeps the audited manual gate untouched.
- **A `child table` on `Projects` (`istable=1`).** Rejected in favour of a **standalone** linked doctype:
  background reconcile / cashflow writes would otherwise have to `save()` the parent `Projects` doc, re-tripping
  its `validate()` (the CEO-Hold gate) and `on_update` (recursion). A standalone doctype is CRUD-managed by
  direct DB ops exactly like the `Project Action Item` projection it sits beside.
- **Store the count / source on the `Project Action Item` rows.** Rejected: those rows are the trigger *input*,
  not hold *state*. The hold decision + reason belong on the project side.

## Consequences

- A new `CEO Hold Reason` doctype + a small `services/ceo_hold/core.py` module (`set_reason` / `clear_reason` /
  `recompute_ceo_hold`) become the **single owner** of `status`/`ceo_hold_by`. `recompute`'s `FOR UPDATE` lock
  removes the existing cashflow-vs-reconcile race.
- The cashflow engine is **refactored** to manage a `cashflow` reason row (with templated text) instead of
  writing `status` directly — this *is* the requested "existing automatic workflow gains a reason".
- The action-item reconcile evaluates the delivery-pending reason **in place** (the `DN_PENDING` count is already
  computed in its `desired` set, under the lock it already holds) and must **not** suppress action items under
  CEO Hold (it already doesn't), so the count stays truthful and the reason can't self-erase — closing the
  hold→quiet→release→re-hold **oscillation** trap.
- `set_at` on each reason row gives the "held since" the data model never had.
- Existing CEO-Hold projects are reconciled into the table by a one-time patch (cashflow-held → seed a `cashflow`
  reason; manual holds need no row); delivery reasons land on the next reconcile.
- The `projects.py` manual gate gains one clause (reject release while reasons active); its nitesh-only set/revert
  logic is otherwise untouched, and the ~50 read-side CEO-Hold consumers (which key off `status == "CEO Hold"`)
  are **unchanged** because `status` is still maintained as the mirror.
