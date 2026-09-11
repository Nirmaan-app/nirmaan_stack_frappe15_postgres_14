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
| Critical PO Task ↔ PO link (`Critical PO Task Child Table` rows on Procurement Orders) + `Critical PO Tasks.linked_po_count` | BE `nirmaan_stack/api/critical_po_tasks/po_links.py` (`update_po_task_links` = the only writer; `refresh_task_po_counts`; readers `get_task_pos` / `get_project_task_pos`) + FE `frontend/src/pages/projects/data/critical-po/` (`useUpdatePOTaskLinks`, `useProjectPOTaskLinks` / `useAllPOTaskLinks`) | `updateDoc` the PO's child table or a task's `associated_pos` (legacy, unused); +1/−1 `linked_po_count` instead of recounting from the rows |

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

## PR Package Tagging (post-v3.0)

**`Procurement Requests.work_package` no longer holds the procurement package.** The v3.0 patch
`nirmaan_stack.patches.v3_0.migrate_work_package_to_pr_tags` (`patches.txt` #11) moved packages onto the
PR's `PR Tag Child Table` rows and rewrote `work_package` to the PR **type**.

| Field | Doctype | Meaning now |
|---|---|---|
| `work_package` | `Procurement Requests` | PR type — `"Normal"` (had a legacy package name, migrated to a tag) or `"Custom"` (package derived from the first item / the project's category mapping, or unmappable). A value that is neither is a pre-patch survivor still carrying a real package name. |
| `tag_package` | `PR Tag Child Table` | **The package.** Link → `Procurement Packages`. |
| `tag_header` | `PR Tag Child Table` | Link → `PR Tag Headers`; one package can map to several headers, so one legacy package name can mint several tag rows. |

How the patch decided (see its module docstring for the full flow):

1. `work_package` held a legacy package name → validate against `PR Tag Headers`, mint a tag row per matching
   header, set `work_package = "Normal"`.
2. `work_package` was empty → fall back to the PR's first `Procurement Request Item Detail`:
   `Additional Charges` is skipped entirely; `DX System` and `HVAC Hardware & Accessories` are hardcoded
   overrides; otherwise the item's `procurement_package`, else the project's
   `Project Work Package Category Make` category mapping. **Every item-fallback path — hit or miss — sets
   `work_package = "Custom"`.**
3. The patch is all-or-nothing: a single unmapped PR raises and rolls the whole migration back.

**Consequences for any code resolving a PO's or PR's package:**

- Read the tags, not the field. A non-`Normal`/`Custom` `work_package` is a legacy fallback only.
- **A PR's package is a SET.** One PR can carry several tag rows, so a join against
  `tabPR Tag Child Table` returns one row per tag and a tag-less PR returns once with `tag_package` NULL.
- Some PRs resolve to no package at all — keep them reachable (the frontend folds them into the
  `"Custom"` bucket) rather than dropping them.

Measured on the live DB 2026-09-09: 5062 `Normal`, 191 `Custom`, 2 survivors (`Electrical Work`);
9196 tag rows; 14 PRs with more than one distinct `tag_package`; 3 PRs with no tag row.

Frontend reference implementation: `filterPOsByPackage` / `buildPRPackageMap` in
`frontend/src/pages/projects/CriticalPOTasks/utils.tsx`.

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
