# 7. Vendor-scoped, cross-project adjustment credit application

Date: 2026-06-29

## Status

Accepted. Built on branch `vendor-wise-adjust`. Adds a "pull" flow to the existing PO
Adjustments system; the "push" flow (`execute_adjustment` / "Adjust Payments") is otherwise
unchanged. Terms in [CONTEXT.md](../../CONTEXT.md) ("Vendor credit & adjustment application");
mechanics in `frontend/.claude/context/domain/po-adjustments.md`.

## Context

A PO's overpaid credit (created when a Revision lowers a PO below what was already paid, held
as a negative `remaining_impact` on its `PO Adjustments` doc) could only be resolved from the
**overpaid PO itself** — open it, click "Adjust Payments", and push the credit out to other
POs / write it off / refund it. The "Against PO" candidate query already filtered by vendor,
but the **entry point was always the overpaid PO**, and the destination payment leg was tagged
with the *source* PO's project — so in practice credit was bound to its origin and there was no
way to start from a PO that *owes* money and draw a vendor's credit toward it, nor any
vendor-level view of how much credit a vendor held across its POs.

The owner wanted: from **any** PO that still owes money, see the vendor's total overpaid credit
across all its POs and apply it to the current PO — **regardless of project**.

## Decision

Adjustment credit application is scoped to the **Vendor**, across **Projects**.

1. A new **pull flow** ("Apply to this PO") lets any owing PO pull a vendor's overpaid credit
   in. The current PO is the destination; the vendor's other overpaid POs are the sources.
2. The credit **pool** is vendor-wide: the sum of `max(0, -remaining_impact)` over the vendor's
   `PO Adjustments` (excluding the current PO and any source in a pending Revision).
3. **Each payment leg is tagged with its own PO's project** — so when source and destination
   are in different projects, each project's financials stay correctly attributed (the source
   records a Return in its project; the destination records the credit in its project).

## Considered options

- **Keep it source-PO / project-bound (status quo)** — rejected; it didn't meet the need (no
  way to settle an owing PO from another project's overpayment to the same vendor).
- **Vendor-scoped but same-project only** — rejected; the owner explicitly wanted credit to
  cross project boundaries within a vendor.
- **Vendor-scoped, cross-project (chosen)** — credit follows the vendor relationship, not the
  project boundary.

## Consequences

- Within a single vendor, a project's payable can be settled by **another project's**
  overpayment. This is intentional accounting behaviour, hard to unwind once cross-project
  payments exist — a future reader seeing project-money cross a project boundary should read
  this ADR before "fixing" it.
- Because the same credit / PO is now reachable from **two** flows (push from the source,
  pull into a destination) — and the same PO can be filled from both — both flows take
  `FOR UPDATE` row locks on the source credit and the destination PO to serialize concurrent
  or stale attempts (no double-spend, no over-pay). Detail in `po-adjustments.md`.
- The **old push flow** (`execute_adjustment`) still tags *both* legs with the source PO's
  project — a pre-existing cross-project mis-tag, left as an optional follow-up. The new pull
  flow does per-leg tagging correctly; the two are intentionally not unified yet (sharing the
  transfer code would re-introduce a double-save hazard in `execute_adjustment`).
- No new doctype or schema change — reuses `PO Adjustments`, `Project Payments`, and
  `PO Payment Terms`.
