# Procurement Domain

Detailed documentation for PR/PO/RFQ/Quotation workflows.

## Load-bearing invariants (owner-locked)

_Moved verbatim from root `CLAUDE.md` when it was cut down to material every task needs (CLAUDE.md restructure, pass 2). CLAUDE.md now carries a one-line pointer here._

- **`Procurement Requests.work_package` is the PR TYPE, not the package.** Since the v3.0 patch `migrate_work_package_to_pr_tags` (`patches/v3_0/`, `patches.txt` #11) the real procurement package lives on the PR's `PR Tag Child Table` rows (`tag_package` → Procurement Packages; `tag_header` is retired, see the next bullet), and `work_package` was overwritten to `"Normal"` (a legacy package name was recognised and migrated to a tag) or `"Custom"` (package derived from the PR's first item / the project's category mapping, or unmappable). A few pre-patch PRs still hold one real name (`Electrical Work`). **A PR's package is a SET, not a field** — a PR may carry more than one distinct `tag_package`, or no tag row at all. So: resolve a PR's package(s) from its tags, honour a `work_package` that is neither `Normal` nor `Custom` only as a legacy fallback, and never compare `work_package` against a Procurement Packages value. Scoped to Procurement Requests — `work_package` on Projects / Categories / Scopes of Work / Project Work Milestones is still a real package name. Reference implementation: `filterPOsByPackage` / `buildPRPackageMap` in `frontend/src/pages/projects/CriticalPOTasks/utils.tsx`.
- **A PR's packages are written from its ITEMS by the server; nobody picks them (2026-10, PR headers retired).** The PR `validate` hook (`integrations/controllers/procurement_request_packages.sync_pr_packages`) owns `pr_tag_list`: one row per package, sorted, `tag_header` empty. The rule is the pure module `services/pr_packages.py` (FE display mirror `frontend/src/utils/prPackages.ts`, pinned by its parity test): **every** `order_list` row counts whatever its status (Deleted included -- PRs whose items are all Deleted still have live POs), its own `procurement_package` if real else its category's package, never `Additional Charges`. **Only the PR's own items count: a PO's items never add or keep a package** (owner, 2026-10-14) -- a merged PO holds two PRs' items but points to one PR, and shows under that PR's packages only. It rebuilds on create and when the item packages or the tag rows change; any other save only collapses repeated rows, so old PRs keep their packages until their items change. No code reads or writes `tag_header` outside the two clean-up patches. The PR tables show them as a "Packages" column (`id: "PR Tag Child Table.tag_package"`, facet + filter through the shared data table's child-table JOIN) and search them with the option `value: "pr_tag_list", is_json: true`, which runs the existing child-table search in `api/data_table/constants.CHILD_TABLE_ITEM_SEARCH_MAP` -- a dotted `"PR Tag Child Table.tag_package"` search value fails ("Invalid filter"); the shared data-table code is not changed for packages. Do not write `pr_tag_list` from a client or an endpoint (it is rebuilt), and do not read `tag_header`. The 15 `PR Tag Headers` records stay only so an old cached frontend that still posts header names passes Frappe's link check (`_validate_links` runs BEFORE `validate`).
- **The PR Tracker is computed live from `pr_tag_list`, never stored.** `api/critical_pr_tasks/get_projects_with_pr_stats.py` (`get_projects_with_critical_pr_stats`, `get_project_pr_packages`) groups the tag rows by project + package in SQL. The `Critical PR Tags` doctype is no longer read or written: a stored copy cannot be kept right under Frappe's PostgreSQL REPEATABLE READ (two saves at once cannot both see each other's commit, so one lost the update or hit a duplicate name -- reproduced 2026-10-13), and deleted PRs were never removed from it (240 stale references on 2026-10-13).
- **Critical PO Task ↔ PO links live on the PO, not the task.** Each link is one `Critical PO Task Child Table` row under `Procurement Orders.critical_po_tasks` (`critical_po_task`, `task_name` = display label `item_name (sub_category)`, `critical_po_category`, `sub_category`). The ONLY writer is `api/critical_po_tasks/po_links.update_po_task_links(add, remove)`: it checks task write permission + same project, then inserts/deletes child rows directly, so the PO is never saved (no PO hooks fire, PO `modified` is untouched). `Critical PO Tasks.linked_po_count` is a stored count **recomputed from the child table** (`refresh_task_po_counts`) on every path that changes rows — the endpoint, PO `on_update` (Desk edits), PO `after_delete`, the migration — never +1/−1. `task_name` / `sub_category` are kept in step by the task `on_update` hook and the Critical PO Items rename cascade; they deliberately have **no `fetch_from`** (adding a fetch field to a table with rows makes Frappe backfill with an unqualified `UPDATE … JOIN` that Postgres rejects as ambiguous, and a fetch only refreshes on a PO save, which link writes never do). The old `Critical PO Tasks.associated_pos` JSON is **kept in the schema but read/written by nothing** except the one-time patch `v3_0.migrate_critical_po_links_to_po_child` — do not revive it; the owner will drop it later.
- **Loss Justification (PR/SB):** a written reason is required for any approval item whose **Loss % > 10%** (strict). One field `loss_justification` (Small Text) on the SHARED child `Procurement Request Item Detail` covers both PR and SB. Terms in `GLOSSARY.md`; scope/rationale in `docs/adr/0002-loss-justification-scope.md` (PR/SB approval surfaces ONLY — NOT on `Purchase Order Item`, no Loss% snapshot, no PO/print). Loss % = `(-savingLoss / benchmark) * 100`, **benchmark = Target Amount (target rate ×0.98) if available else Lowest Quoted L1 (Target-prioritized)**. Gate is server-authoritative: `send_vendor_quotes.handle_delayed_items` accepts `loss_justifications`, writes them onto `order_list`, and re-computes Loss % (`compute_item_loss_percent`) to `frappe.throw` on a blank >10% reason. **GOTCHA 1 — `rfq_data.details` is keyed by `item_id`, NOT the order_list child-row `name`** (verified against live data); the L1 lookup must use `item.item_id`. **GOTCHA 2 — dual benchmark on the approval screen:** the existing ₹ "Savings/Loss" column keeps its `min(Target, L1)` benchmark (unchanged), but the new Loss % uses the Target-prioritized benchmark to match capture and keep the >10% gate identical end-to-end — so the ₹ and the % on that one screen can come from different benchmarks; don't "fix" it.
- **PO Delivery Documents** are polymorphic: `parent_doctype` = `"Procurement Orders"` or `"Internal Transfer Memo"`. Always filter by `parent_doctype`; use `parent_docname` (not legacy `procurement_order` field).
- **Stored `amount_paid` is the one paid figure of a PO / Work Order (ADR-0034), and the system recounts it.** Source: the order's *Paid* Project Payments, plus the TDS withheld from the vendor on them (`Vendor` deductions, ADR-0034 Amendment A; a PO's recorded tax too, Amendment B, except on a payment still stored gross with its legacy `tds` box, `payment_tds.md` § which orders take tax; tax the company paid on top is not part of it), less its *Received* Vendor Refunds (`services/amount_paid.amount_paid_of`); a WO's Amount Due is `total − amount_paid` (a PO's `invoiced − amount_paid`); one writer stores it with `amount_due` (and a WO's `total_tds`): `amount_paid.write_amount_paid`, also called when a Paid payment's deduction is created or restated (`payment_tds.md` § who bore the tax). Never add `total_tds` onto `amount_paid` (ratchet `p1_tds_added_to_amount_paid`). **Watched fields** that recount it: on a Project Payment, `status` (into or out of Paid), `amount`, `document_type` and `document_name` (`orders_moved_by`), recounting BOTH the order it leaves and the order it joins, a PO's vendor credit with it ("Payment Changed" when it stays Paid), and on delete; on a Vendor Refund, `status` (Received or not), `amount`, `document_type` and `document_name` (`controllers/vendor_refunds._money_fields`; a PO goes through the refund sync step). A path that writes payments with `from_adjustment` (PO Adjustments) recounts itself and then calls `_recheck_cashflow_after_recount`. **The CEO Hold cashflow check runs after the recount, never before**: the payment controller's `on_update` recounts first (`integrations/controllers/project_payments.recount_orders`) and the cashflow hook runs after it, and `after_delete` (not `on_trash`). **The judge** of "is this order right" is `services/amount_paid_drift.mismatches` (PO and WO, Amount Paid and Amount Due, and a WO's `total_tds` read against its deduction rows, ₹1 threshold, one set-based query); its `recount` sets one order from source. The **Amount Paid Mismatch** report (Reports → PO and → WO) reads it live through `api/reports/amount_paid_mismatch` (`get_amount_paid_mismatches`, `recount_amount_paid`), for Admin and Accountant Lead only, checked on the server (`role_profiles.AMOUNT_PAID_MISMATCH_PROFILES`). Every integrity test asserts it finds nothing on the orders it touched (`services/test_amount_paid_integrity`). **Nobody types it:** `amount_paid` and `amount_due` are read-only on both doctypes (#1454; read-only takes the Desk input away, the system writers still write). **A merge never strands money:** `api/po_merge_and_unmerge.handle_merge_pos` refuses, before any write, when the main PO or a PO to merge has a Project Payment at any status but Rejected, or a Vendor Refund at any status, naming the PO and pointing to a PO Revision (a merge moves no payment, and a Merged PO counts toward no Amount Paid). The PO screen's filter (no payment of any status) stays in front of it.
- **A dated paid figure is the same rule applied to dated rows, on the server.** `amount_paid` carries no date, so a figure for a period (the Vendor report's Total Paid in a range, Current FY Paid, and the paid side of Balance Payable since the ledger start, 2025-04-01) comes from `services/vendor_paid.vendors_paid(from_date, to_date)` (endpoint `api/vendor/vendor_paid.get_vendors_paid`): a vendor's Paid PO / WO payments by payment date, plus the TDS withheld from the vendor on them on the same date (ADR-0034 Amendments A and B, #1512, #1534), less its Received refunds by the refund's own date. A report's all-time paid figure adds up the orders' `amount_paid`; a project's dated outflow is `services/project_money`. No report adds up payments in the browser (ratchet P1).
- **Vendor credit status:** `recalculate_vendor_credit()` never sets `vendor_status` to On-Hold. Only the daily 10 AM cron does that. The function can auto-clear On-Hold → Active.

### Frontend

_Moved verbatim from `frontend/CLAUDE.md` (CLAUDE.md restructure, pass 2), with each pointer to the retired root "Domain Gotchas" section repointed to the backend bullet above; paths are relative to `frontend/`._

- **Loss Justification (high-loss items, PR + SB)**: a per-item reason required when **Loss % > 10%** (strict). Shared helper `src/utils/lossPercent.ts` (`computeLossPercent(savingLoss, benchmark)` + `isHighLoss` + `LOSS_THRESHOLD_PERCENT = 10`) is the SINGLE source of the rule — use it on every surface; never re-derive the threshold inline. **Capture (procurement enters + gate):** `VendorsSelectionSummary.tsx` (PR) + `Sent Back Requests/SBQuotesSelectionReview.tsx` (SB) — a "Reason (required)" textarea on each >10% item keyed by the `order_list` child-row `name`; Send-for-Approval disabled until all high-loss items are justified. PR sends `loss_justifications` in the `send_vendor_quotes` postcall; SB has no send endpoint so it persists the FULL `order_list` (justifications merged) via `updateDoc("Sent Back Category", ...)` — must send the whole child array (replace-all; omitting rows deletes them). **Approval (read-only display + backstop):** shared `ApproveVendorQuotes/components/VendorApprovalTable.tsx` shows Loss % in the Savings/Loss column + a light-red "Reason:" chip under the item name; both approve hooks (`useApproveRejectLogic.ts`, `useApproveSBSLogic.ts`) compute `lossPercent` with the **Target-prioritized** benchmark (NOT the `min(Target,L1)` used by the existing ₹ Savings/Loss column — see GOTCHA 2 in the backend Loss Justification bullet above) and block approval of a selected >10% item with no reason (Send Back is the escape hatch). `loss_justification` rides PR rows via `...prItem` spread but is mapped EXPLICITLY in the SB hook (it builds the display item field-by-field). Scope/rationale: `docs/adr/0002-loss-justification-scope.md`; terms: root `GLOSSARY.md`.
- **Critical PO Tasks — a PO's package comes from its PR's TAGS, not `work_package`**: the "Link New POs" / "Edit Task" pickers map a PO → PR → procurement package to filter the dropdown. Since the v3.0 `migrate_work_package_to_pr_tags` patch `Procurement Requests.work_package` only carries the PR type (`"Normal"` / `"Custom"`), so comparing `pr.work_package` to a package matches nothing (every package shows "Available POs (0)"). The rule lives in ONE pure helper — `filterPOsByPackage` (+ `buildPRPackageMap`) in `src/pages/projects/CriticalPOTasks/utils.tsx` — consumed by both `LinkPODialog.tsx` and `EditTaskDialog.tsx` (ADR-0010 F1/F4); do not re-derive it in a third place. `useCriticalPOProcurementRequests` fetches the child field as ``"`tabPR Tag Child Table`.tag_package as tag_package"`` — a **LEFT JOIN**, so a PR with two tags comes back as **two rows** (fold with `buildPRPackageMap`) and an untagged PR comes back once with `tag_package: null`. The "Select Package" options are the project's enabled packages **plus every package its PRs carry**, sorted, then `"Custom"` (`buildPackageOptions`, same file): a PR's packages come from its items, so a tools-only PR carries "Tool & Equipments" in a project that never enabled it, and enabled-only options would leave its PO with no option to show under. The `"Custom"` dropdown entry is **not** a Procurement Package: it keeps custom-flow PRs *and* every PO whose package cannot be resolved (untagged PR, or no PR at all) reachable. Selecting the child field needs a cast — it is valid for Frappe's list API but sits outside the SDK's `keyof`-based `fields` type. See the backend `work_package` bullet above.
- **Critical PO links: read `task.linked_pos`, write ONLY through `useUpdatePOTaskLinks`**: links live on the PO as `Critical PO Task Child Table` rows, not in `Critical PO Tasks.associated_pos` (still in the DB, unused — never read it or `updateDoc` it). **Read:** `useProjectPOTaskLinks(projectId)` / `useAllPOTaskLinks()` (`src/pages/projects/data/critical-po/useCriticalPOQueries.ts`) fetch child rows through the Procurement Orders parent join (``"`tabCritical PO Task Child Table`.critical_po_task as critical_po_task"`` — same `keyof` cast as the PR-tag join), and `buildTaskPOMap` / `attachLinkedPOs` (`CriticalPOTasks/utils.tsx`) put a sorted `linked_pos: string[]` on each task. The tracker's PO badge shows the stored `linked_po_count`; clicking it lists `linked_pos`. **Write:** `useUpdatePOTaskLinks().updateLinks(projectId, { add, remove })` → `update_po_task_links` (atomic; a "Change" is ONE call carrying both `remove` and `add`), which invalidates the link + task SWR caches — used by the tracker dialogs, `LinkedCriticalPOTag` and the dispatch hook `useCriticalPOTaskLinking`. The material-plan API returns `linked_pos` / `linked_pos_count` (not `associated_pos*`). PO Summary's Critical PO filter is a server-side column facet on the child field (column `id: "Critical PO Task Child Table.task_name"`, `meta.facet.field: "task_name"`; `get_facet_values` auto-detects child-table fields). See the backend Critical PO Task links bullet above.

---

## Residence — concept → owner (ADR-0010)

This manifest names the **one owning module** for each procurement concept (per [ADR-0010](../../../docs/adr/0010-module-residence-rules.md)). **No-new-scatter rule:** an edit that touches one of these concepts must route through its owner — or, at minimum, must not create a *new* copy of the rule/shape/state (enforced by `scripts/residence_check.py`'s ratchet baselines). An **UNASSIGNED** owner means no single home exists yet — do **not** pick one ad-hoc; ask.

| Concept | Owner (module) | Nothing else may… |
|---|---|---|
| Awaiting-approval predicate (PR/SB in `{Vendor Selected, Partially Approved}` with a pending item) | `nirmaan_stack/services/procurement_approval.py` (`AWAITING_APPROVAL_STATES`, `is_awaiting_approval`) | hardcode those state literals or re-implement the pending-item check (~9 legacy files still hardcode `"Vendor Selected"` — ratchet-baselined) |
| A PR's procurement packages (`pr_tag_list`, from its items) | BE `nirmaan_stack/services/pr_packages.py` (rule) + `integrations/controllers/procurement_request_packages.py` (the only writer, from the PR `validate`) + FE `frontend/src/utils/prPackages.ts` (display mirror) — a FE↔BE parity pair | write `pr_tag_list` from a client or an endpoint, read `tag_header`, or re-derive a PR's packages inline (use `uniqueTagPackages` / `derivePRPackages`) |
| PR Tracker (packages per project) | `nirmaan_stack/api/critical_pr_tasks/get_projects_with_pr_stats.py` — computed live from `pr_tag_list` | store it again (`Critical PR Tags` is retired) |
| Loss % / benchmark rule (>10% needs justification; Target-prioritized benchmark) | FE `frontend/src/utils/lossPercent.ts` + BE `compute_item_loss_percent` (`nirmaan_stack/api/send_vendor_quotes.py`) — a FE↔BE parity pair | re-derive the 10% threshold or the benchmark choice inline |
| PR/SB `workflow_state` transitions | **UNASSIGNED** — ADR-0010 deferred Candidate 6 (future `deriveState(items, linkedSBs)`); ~39 scattered writers across ~8 files today | add a **new** writer (ratchet-enforced) |
| `order_list` child-row shape (`Procurement Request Item Detail` parse/key) | **UNASSIGNED** — no single accessor yet (B2 candidate) | add new inline parses; key gotcha: `rfq_data.details` is keyed by `item_id`, **not** the child-row `name` (GOTCHA 1, Load-bearing invariants above) |
| Counts/aggregates over PR/PO/SB rows | the **database** — GROUP BY / EXISTS, `nirmaan_stack/api/sidebar_counts.py`-style (ADR-0010 first proof) | tally rows in a Python/JS loop |
| Faceted filter fetching | `frontend/src/components/data-table/SelfFetchingFacetFilter.tsx` + `getColumnFacet` (`meta.facet` in `*.config.ts`) | hand-roll `useFacetValues` in a page (legacy islands in ADR-0010) |
| Concurrent-edit safety for PR approval | `frontend/src/pages/ProcurementRequests/ApproveNewPR/hooks/useEditingLock.ts` (the F5 write seam — extend it) | invent a second lock mechanism |
| Vendor credit status transitions | `nirmaan_stack/api/vendor_credit.py` (`recalculate_vendor_credit`) | set `vendor_status` ad-hoc; the asymmetry (On-Hold→Active realtime, Active→On-Hold cron-only) is owner-locked |
| Critical PO Task ↔ PO link (`Critical PO Task Child Table` rows on Procurement Orders) + `Critical PO Tasks.linked_po_count` | BE `nirmaan_stack/api/critical_po_tasks/po_links.py` (`update_po_task_links` = the only writer; `refresh_task_po_counts`; readers `get_task_pos` / `get_project_task_pos`) + FE `frontend/src/pages/projects/data/critical-po/` (`useUpdatePOTaskLinks`, `useProjectPOTaskLinks` / `useAllPOTaskLinks`) | `updateDoc` the PO's child table or a task's `associated_pos` (legacy, unused); +1/−1 `linked_po_count` instead of recounting from the rows |
| PO status → PO list tab (`PO Approved` → `Approved PO`, …) | `frontend/src/pages/ProcurementOrders/purchase-order/config/poTabs.constants.ts` (`PO_STATUS_TAB`) | keep a second status→tab map (two used to exist and disagreed) |
| Where a PO / WO link in a shared report table goes (Reports → `/reports/po/<PO>`, project → `/projects/<id>/po/<PO>`, elsewhere → `/project-payments/<id>`) | `frontend/src/pages/ProjectPayments/components/poRoute.ts` (`orderDetailPath`) + `OrderDetailLink.tsx` | hardcode `/project-payments/…` in a report / project table |

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
| `tag_header` | `PR Tag Child Table` | **Retired 2026-10.** Was a Link → `PR Tag Headers` (one package could map to several headers, so one legacy package name minted several tag rows). Patch `v3_0.pr_tags_one_row_per_package` keeps one row per package and blanks every header; then `v3_0.pr_tags_add_item_packages` adds (never removes) the packages a PR's items carry that its rows miss. The field and column are dropped later (`.claude/plans/pr-tag-table-cleanup-plan.md`). Until then nothing reads it, and the save hook ignores it: a header that a stale cached frontend or a Desk edit sends on a save that keeps the same packages is stored but never shown. |

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
