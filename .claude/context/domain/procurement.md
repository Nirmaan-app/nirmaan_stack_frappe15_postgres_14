# Procurement Domain

Detailed documentation for PR/PO/RFQ/Quotation workflows.

## Residence — concept → owner (ADR-0010)

This manifest names the **one owning module** for each procurement concept (per [ADR-0010](../../../docs/adr/0010-module-residence-rules.md)). **No-new-scatter rule:** an edit that touches one of these concepts must route through its owner — or, at minimum, must not create a *new* copy of the rule/shape/state (enforced by `scripts/residence_check.py`'s ratchet baselines). An **UNASSIGNED** owner means no single home exists yet — do **not** pick one ad-hoc; ask.

| Concept | Owner (module) | Nothing else may… |
|---|---|---|
| Awaiting-approval predicate (PR/SB in `{Vendor Selected, Partially Approved}` with a pending item) | `nirmaan_stack/services/procurement_approval.py` (`AWAITING_APPROVAL_STATES`, `is_awaiting_approval`) | hardcode those state literals or re-implement the pending-item check (~9 legacy files still hardcode `"Vendor Selected"` — ratchet-baselined) |
| Loss % / benchmark rule (>10% needs justification; Target-prioritized benchmark) | FE `frontend/src/utils/lossPercent.ts` + BE `compute_item_loss_percent` (`nirmaan_stack/api/send_vendor_quotes.py`) — a FE↔BE parity pair | re-derive the 10% threshold or the benchmark choice inline |
| PR/SB `workflow_state` transitions | **UNASSIGNED** — ADR-0010 deferred Candidate 6 (future `deriveState(items, linkedSBs)`); ~39 scattered writers across ~8 files today | add a **new** writer (ratchet-enforced) |
| `order_list` child-row shape (`Procurement Request Item Detail` parse/key) | **UNASSIGNED** — no single accessor yet (B2 candidate) | add new inline parses; key gotcha: `rfq_data.details` is keyed by `item_id`, **not** the child-row `name` (root CLAUDE.md) |
| Counts/aggregates over PR/PO/SB rows | the **database** — GROUP BY / EXISTS, `nirmaan_stack/api/sidebar_counts.py`-style (ADR-0010 first proof) | tally rows in a Python/JS loop |
| Faceted filter fetching | `frontend/src/components/data-table/SelfFetchingFacetFilter.tsx` + `getColumnFacet` (`meta.facet` in `*.config.ts`) | hand-roll `useFacetValues` in a page (legacy islands in ADR-0010) |
| Concurrent-edit safety for PR approval | `frontend/src/pages/ProcurementRequests/ApproveNewPR/hooks/useEditingLock.ts` (the F5 write seam — extend it) | invent a second lock mechanism |
| Vendor credit status transitions | `nirmaan_stack/api/vendor_credit.py` (`recalculate_vendor_credit`) | set `vendor_status` ad-hoc; the asymmetry (On-Hold→Active realtime, Active→On-Hold cron-only) is owner-locked |

Template note: copy this section shape into other domain docs as they're touched; keep rows verified, not aspirational.

## Workflow Overview

```
PR Created → RFQ Sent → Quotes Received → Quote Selected → PO Generated → Delivery → Invoice → Payment
```

## Key APIs

| API | Purpose |
|-----|---------|
| `custom_pr_api.new_custom_pr()` | Create custom procurement requests |
| `custom_pr_api.resolve_custom_pr()` | Update/resolve custom PRs |
| `approve_vendor_quotes.generate_pos_from_selection()` | PO generation from selected quotes |
| `send_vendor_quotes` | RFQ distribution to vendors |
| `approve_reject_sb_vendor_quotes` | Sent-back quote handling |
| `reject_vendor_quotes` | Quote rejection logic |
| `approve_amend_po` | PO amendment approval |
| `handle_cancel_po` | PO cancellation |
| `po_merge_and_unmerge` | PO consolidation |

## Auto-Approval Rules

1. **PR < ₹5,000:** Immediate auto-approve
2. **PO < ₹20,000 (with vendors):**
   - Auto-approve + generate PO
   - Unless 8th consecutive (forces manual review)

## Doctype Relationships

```
Procurement Request
  ├─→ Quotation Request (RFQ)
  │     └─→ Approved Quotation
  │           └─→ Selected Quotation
  │
  └─→ Procurement Order (PO)
        ├─→ PO Payment Terms
        ├─→ PO Delivery Documents (DCs & MIRs, with DC Item child table)
        ├─→ Delivery Notes
        ├─→ Project Invoice (Vendor Invoices)
        └─→ Project Payment
```

## Sent Back Categories

When a PR category is rejected, it creates a `Sent Back Category` requiring:
- Revision by the requestor
- Re-submission for approval
- Separate approval flow

## PO Generation Logic

`approve_vendor_quotes.generate_pos_from_selection()`:
1. Groups selected quotes by vendor
2. Aggregates items across quotes
3. Creates payment terms
4. Generates PO with proper linking
5. Updates PR status

## State Transitions

### PR States
- `Pending` - Awaiting approval
- `Approved` - Ready for RFQ
- `Vendor Selected` - Quotes selected, awaiting vendor approval
- `Vendor Approved` - PO generated
- `Partially Approved` - Some categories approved
- `Rejected` - Declined
- `Cancelled` - Withdrawn
- `Closed` - Completed

### PO States
- `Draft` - Not yet submitted
- `Submitted` - Active PO
- `Amended` - Modified after submission
- `Cancelled` - Voided
