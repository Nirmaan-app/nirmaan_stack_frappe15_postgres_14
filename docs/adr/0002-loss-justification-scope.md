# 2. Loss Justification — PR/SB approval only

Date: 2026-06-23

## Status

Accepted.

## Context

Approvers can see an item's Savings/Loss but had no way to capture *why* a high-loss
item was chosen. The requirement: force a written **Loss Justification** for any item
whose **Loss %** exceeds 10% (see `CONTEXT.md` for the terms), captured by the
Procurement Executive at Send-for-Approval and shown read-only to approvers, on both
the Procurement Request and Sent Back paths.

The open question was how far the justification should travel: stay on the approval
surfaces, or follow the item into the Purchase Order, print formats, and reports
(which would need the field copied onto `Purchase Order Item` and a snapshot of the
Loss % so prints stay stable as target rates drift).

## Decision

Scope the feature to the **PR/SB approval surfaces only**.

1. **One field, on the shared item child table** `Procurement Request Item Detail`
   (`loss_justification`, Small Text). It backs both `Procurement Requests.order_list`
   and `Sent Back Category.order_list`, so PR and SB share it from a single column.
2. **No propagation to the Purchase Order.** `Purchase Order Item` gets no field and
   the PO-creation path (`approve_vendor_quotes.py`) is untouched — so the
   justification does **not** appear on the PO or its print format/reports.
3. **No Loss % snapshot.** Loss % is recomputed live everywhere from quote / quantity /
   target rate / RFQ quotes; nothing is stored. (A snapshot would only be needed to
   keep prints stable, which #2 puts out of scope.)
4. **Threshold is a fixed business constant: 10%** (strictly greater). Not per-project
   or configurable.
5. **Gate enforced at both ends, server-authoritative.** The capture screen disables
   Send-for-Approval until every >10% item has a reason; the backend
   (`send_vendor_quotes.handle_delayed_items`) re-computes Loss % and rejects a send
   that leaves one blank. Approvers are read-only and the approve action is a backstop
   that blocks a >10% item with no reason; **Send Back** is the recovery path for a
   legacy item that arrived without one.

## Consequences

- Minimal footprint: a single child-table column, no PO/print migration, no snapshot
  schema. Easy to extend later — adding PO propagation + a snapshot is additive.
- The reason is **not** visible once a PO is cut (only on the PR/SB approval surfaces
  and the underlying item rows). If the business later wants it on the PO/print, that
  is a deliberate follow-up, not an accident — this ADR is why it's absent.
- Loss % is always live, so a justified item whose target rate later changes will show
  a different Loss % on re-open; acceptable because the justification text is what's
  retained, not the number.
