# PO Merge & Unmerge System

## Overview

The merge system consolidates multiple **PO Approved** Purchase Orders (same vendor + same project) into a single "master PO". Source POs get status `"Merged"` and become read-only. The master PO progresses through the normal PO lifecycle (dispatch, delivery, payments).

---

## Key Fields

### `merged` field on Procurement Orders (Data type)
| Scenario | Value | Status |
|----------|-------|--------|
| Normal PO (never merged) | `null`/empty | Any |
| Source PO (part of merge) | `"PO-2024-XXXXX"` (master PO name) | `"Merged"` |
| Master PO (result of merge) | `"true"` (literal string) | `"PO Approved"` → progresses normally |

### `po` field on Purchase Order Item (Link → Procurement Orders)
- On master PO items: stores source PO name (traceability)
- On normal PO items: null
- Set during merge from `item.parent` (the source PO's name)

### `custom` field on Procurement Orders (Data type)
- `"true"` for POs created from custom PRs (outside normal flow)
- Custom POs **cannot be merged** (excluded from both merge UI and eligibility)

---

## Merge Eligibility Criteria

All must be true for a PO to appear in the merge list:

| Condition | Enforced By | Location |
|-----------|-------------|----------|
| Same project as base PO | Backend DB query | `PurchaseOrder.tsx:311` |
| Same vendor as base PO | Backend DB query | `PurchaseOrder.tsx:313` |
| Status = `"PO Approved"` | Backend DB query | `PurchaseOrder.tsx:314` |
| Not the current PO | Backend DB query | `PurchaseOrder.tsx:316` |
| Not a custom PO | Frontend filter | `PurchaseOrder.tsx:392` |
| No payments exist against it | Frontend filter | `PurchaseOrder.tsx:393` |
| Not locked by PO Revision | Frontend filter | `PurchaseOrder.tsx:394` |
| Payment type matches base PO | Frontend filter (after full fetch) | `PurchaseOrder.tsx:418-424` |
| Base PO must have payment terms | Frontend filter | `PurchaseOrder.tsx:411` |

### Base PO validation (to show merge UI at all)
```typescript
MERGEPOVALIDATIONS =
  !summaryPage && !accountsPage &&
  PO?.custom != "true" &&
  !estimatesViewing && !isAccountant &&
  PO?.status === "PO Approved" &&
  PO?.merged !== "true" &&
  !(poPayments?.length > 0) &&
  mergeablePOs.length > 0
```

---

## Merge Flow

### Frontend (PurchaseOrder.tsx)
1. User on PO with status `"PO Approved"` → sees "Heads Up - PO Merging Available" alert
2. Opens merge sheet → sees compatible POs with item details
3. Clicks "Merge" on individual POs → items tagged with `po: <source_po_name>`
4. Payment terms recalculated via `calculateMergedTerms()`:
   - Combined by label, amounts summed
   - Credit terms take the latest due_date
5. Clicks "Confirm" → `mergePOCall` API

### Backend (`api/po_merge_and_unmerge.py` → `handle_merge_pos`)
```
1. frappe.db.begin()
2. Fetch base PO → copy header fields (project, vendor, addresses, GST)
3. Create new master PO in memory:
   - merged = "true", status = "PO Approved"
   - payment_type = first term's payment_type
4. Calculate totals manually (qty × rate + tax per item)
5. Append items: item_dict["po"] = item_dict.get('parent')
6. Append payment terms: recalculate percentages against grand_total
   - term_status = "Created" (default)
   - term_status = "Scheduled" (if Credit AND due_date <= today)
7. new_po_doc.insert()  ← triggers after_insert hook
8. For each source PO (including base):
   - frappe.db.set_value(status="Merged", merged=master_po_name)  ← NO hooks triggered
9. frappe.db.commit()
```

---

## Unmerge Flow

### Eligibility
```typescript
UNMERGEPOVALIDATIONS =
  !summaryPage && !accountsPage &&
  !PO?.custom && !estimatesViewing && !isAccountant &&
  PO?.merged === "true"
```
Plus backend guard: no `Project Payments` against master PO.

### Backend (`handle_unmerge_pos`)
```
1. frappe.db.begin()
2. Safety check: block if Project Payments exist for master PO
3. Find all source POs where merged = master_po_id (backend discovers, doesn't trust frontend)
4. For each source PO:
   - frappe.db.set_value(status="PO Approved", merged=None)  ← NO hooks triggered
5. frappe.delete_doc("Procurement Orders", master_po_id)  ← triggers on_trash hook
6. frappe.db.commit()
```

---

## Events & Hooks Triggered

### On Merge (master PO `.insert()`)

| Hook | File | Actions |
|------|------|---------|
| `after_insert` | `integrations/controllers/procurement_orders.py:6-77` | Creates `Nirmaan Notifications` for Admin/Procurement/Accountant users; sends FCM push notifications (up to 3 retries); publishes `po:new` Socket.IO event |

**Source PO status change** (`frappe.db.set_value`): **NO hooks fire.** Direct DB update only — no `validate`, `on_update`, `before_save`, or Socket.IO events.

### On Unmerge (master PO `frappe.delete_doc()`)

| Hook | File | Actions |
|------|------|---------|
| `on_trash` | `integrations/controllers/procurement_orders.py:119-147` | Deletes `Nirmaan Comments` for PO; deletes `Approved Quotations` for PO; publishes `po:delete` Socket.IO event per notification recipient; deletes `Nirmaan Notifications` for PO |
| `delete_doc_versions` | `integrations/controllers/delete_doc_versions.py` | Creates `Version` audit record |

**Source PO restoration** (`frappe.db.set_value`): **NO hooks fire.** Silent DB update.

### Frontend Socket Listeners

| Event | Handler | Effect |
|-------|---------|--------|
| `po:new` | `socketListeners.ts` → `handlePONewEvent()` | Fetches notification doc, adds to Zustand notification store |
| `po:delete` | `socketListeners.ts` → `handlePRDeleteEvent()` | Removes notification from store |

### What Does NOT Fire

- **No Socket.IO event** for source PO status → "Merged" (silent `set_value`)
- **No Socket.IO event** for source PO restoration → "PO Approved" (silent `set_value`)
- **No sidebar count invalidation** — relies on `window.location.reload()` after redirect
- **No AQ creation** at merge time (AQs only created on dispatch transition)
- **No DN side effects** — DN hooks are PO↔DN only, not merge-aware

### FCM Push Details
- Sent to: Admin, Procurement, Accountant users with `push_notification == "true"`
- Title: `"New Custom PO for Project {name}"` or `"New PO for Project {name}"`
- Click URL: `/frontend/purchase-orders?tab=Approved%20PO` (or payments tab for accountants)
- Retry: 3 attempts, 2s delay between

---

## Data Flow Diagram

```
Before Merge:
  PO-001 (Vendor A, Project X, PO Approved) → Items: [A, B], Terms: [Advance 50%, MR 50%]
  PO-002 (Vendor A, Project X, PO Approved) → Items: [C, D], Terms: [Advance 50%, MR 50%]

After Merge (base = PO-001):
  PO-001 → status: "Merged", merged: "PO-003"
  PO-002 → status: "Merged", merged: "PO-003"
  PO-003 → status: "PO Approved", merged: "true"
           Items: [A(po=PO-001), B(po=PO-001), C(po=PO-002), D(po=PO-002)]
           Terms: [Advance summed, MR summed]

After Unmerge of PO-003:
  PO-001 → status: "PO Approved", merged: null  (original items/terms intact)
  PO-002 → status: "PO Approved", merged: null  (original items/terms intact)
  PO-003 → DELETED (+ comments, AQs, notifications cleaned up)
```

---

## Downstream Operations

| Operation | On Master PO | On Source POs (Merged) |
|-----------|-------------|------------------------|
| Dispatch | Yes (normal flow) | No |
| Delivery Notes | Yes | No |
| Invoices | Yes | No |
| Payments | Yes | No |
| PO Revision | Yes (after status progression) | No |
| Cancel | No (`merged !== "true"` guard) | No |
| AQ Creation | Yes (on dispatch transition) | Frozen |
| View | Yes | Yes (read-only, "Merged POs" tab) |
| Re-merge | No (master has `merged="true"`) | No (status not "PO Approved") |

### Exclusions from System-Wide Queries
Merged POs (`status = "Merged"`) are filtered out of:
- PO summary APIs: `status NOT IN ["Merged", "Inactive", "PO Amendment"]`
- Credits calculations (`get_credits_list.py`)
- Inventory item-wise aggregation (`inventory_item_wise.py`)
- Vendor PO/invoice lists (`get_vendor_po_invoices.py`)

### Merged POs Tab
- Dedicated tab in PO list showing `status = "Merged"` POs
- Columns: PO name (not clickable), Master PO (clickable link), Merged By
- Source: `poTabs.constants.ts` → `PO_TABS.MERGED_POS`

---

## Impact on Related Systems

### Procurement Requests
- **No direct impact.** PR items already have `status = "PO Generated"` before merge.
- `procurement_request` on master PO copied from **base PO only** — link to non-base PRs is lost at header level (items still traceable via `po` field → source PO → PR).

### Sent Back Items
- **No impact.** SBC documents created during PR approval flow, before POs exist.

### Custom POs
- Cannot be merged (hard exclusion in UI + eligibility filter)
- Cannot be the base PO for a merge

### PO Revision System
- Locked POs (active revision target/original) excluded from merge eligibility via `allLockedPOs` check
- Master PO can be revised after progressing to eligible statuses

### Payment Terms
- Combined by label during merge, amounts summed
- Credit terms: latest due_date wins
- No automatic background job triggers from term creation
- Percentages recalculated: `(term_amount / grand_total) * 100`

---

## Known Issues & Risks

### Architectural
1. **`merged` field dual semantics** — stores master PO name on sources, literal `"true"` on master. Should be two fields: `is_master_merge` (Check) + `merged_into` (Link).
2. **`procurement_request` is lossy** — master PO links to single PR from base PO; items from other PRs lose header-level traceability.
3. **No backend validation on merge** — no check for existing DNs/invoices/AQs on source POs. All guards are frontend-only. Direct API call could corrupt data.
4. **`frappe.db.set_value` bypasses hooks** — source PO status changes are silent (no notifications, no socket events, no `on_update` side effects).

### Operational
5. **No partial unmerge** — all-or-nothing; can't extract one PO from a merge group.
6. **No DN/invoice guard on unmerge beyond payments** — only checks `Project Payments`, not `Delivery Notes` or `Vendor Invoices`.
7. **Race condition** — between frontend eligibility check and backend merge execution, another user could modify candidate POs.
8. **Item origin stripped before API call** — `po` field removed from items (line 573), backend re-derives from `parent`. Fragile if `parent` not populated.

### Code Quality
9. **Debug prints in production** — `po_merge_and_unmerge.py` has ~15 `print(f"DEBUGMERGE...")` statements.
10. **`window.location.reload()`** after both operations — should use SWR cache invalidation instead.
11. **Sidebar counts stale** — no explicit `invalidateSidebarCounts()` call after merge/unmerge; relies on page reload.

### Fixed (April 2026)
12. **~~`tax_amount` stale on merged items~~** — `buildResolvedOrderData()` spread `...template` leaked stale `tax_amount` from first source item. Fixed: frontend now explicitly sets `tax_amount` in all merge paths; backend recalculates per-item financials before `.append()`.

---

## File Reference

### Backend
| File | Purpose |
|------|---------|
| `api/po_merge_and_unmerge.py` | Core merge/unmerge/get_full_po_details APIs |
| `integrations/controllers/procurement_orders.py` | `after_insert` (notifications), `on_update` (AQ lifecycle), `on_trash` (cleanup) |
| `integrations/Notifications/pr_notifications.py` | FCM push notification sending |
| `api/procurement_orders.py` | PO summary (excludes Merged status) |
| `patches/v1_10/merge_po_patch2.py` | Migration: rebuild merged POs |
| `patches/v1_10/rebuild_merged_pos.py` | Migration: reconstruct from item `po` field |

### Frontend
| File | Purpose |
|------|---------|
| `pages/ProcurementOrders/purchase-order/PurchaseOrder.tsx` | Merge/unmerge UI, state, API calls (lines 241-716) |
| `pages/ProcurementOrders/purchase-order/release-po-select.tsx` | Merged POs tab, PO list queries |
| `pages/ProcurementOrders/purchase-order/config/poTabs.constants.ts` | Tab definitions including Merged POs |
| `services/socketListeners.ts` | `po:new`, `po:delete` event handlers |
| `zustand/eventListeners.ts` | Notification store handlers |
| `zustand/useDocCountStore.ts` | Sidebar counts (includes Merged status) |
