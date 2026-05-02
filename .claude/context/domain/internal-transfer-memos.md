# Internal Transfer Memos (ITM) — Complete Reference

## Overview

Internal Transfer Memo (ITM) is a **cost-neutral, inter-project material transfer workflow** that mirrors the PO + DN dispatch/delivery pattern but involves no vendor and no payment. A source project with surplus material (per its latest submitted Remaining Items Report) transfers items to a target project that needs them, subject to Admin approval.

ITMs are created from the **Inventory Item-Wise** page via a global item/source picker. A single creation session always targets one destination project but may span multiple source projects — the backend groups selections by `source_project` and creates **N ITMs, one per unique source**. Each ITM carries its own approval lifecycle.

**Financial model:** No PO, no payment, no vendor credit impact. `estimated_rate` on each ITM item is a display-only snapshot of the source project's Inventory Item-Wise unit rate at create time.

---

## Phase Roadmap

| Phase | Status | Scope |
|-------|--------|-------|
| **Phase 1** | ✅ Implemented | Doctype + create flow + approval/rejection + pre-dispatch delete |
| **Phase 2** | ✅ Implemented | Dispatch action; DN polymorphism (`parent_doctype`/`parent_docname`); DN creation against ITM; status machine Dispatched → Partially Delivered → Delivered |
| **Phase 3** | ✅ Implemented (partial) | Transferred Out / Transferred In aggregates via `get_transfer_summary` |
| **Phase 4** | ✅ Implemented | Socket.IO events on dispatch/delivery; PO Delivery Documents polymorphism; ITM DC & MIR upload + reporting |

---

## Phase 4 — DC & MIR for ITM (recent delivery)

**Schema**: `PO Delivery Documents` doctype now polymorphic — added `parent_doctype` (Select: `Procurement Orders` / `Internal Transfer Memo`) + `parent_docname` (Dynamic Link). `procurement_order` field made optional (set for PO rows, NULL for ITM rows). Migration patch `patches/v3_0/backfill_pdd_parent_doctype.py` backfills legacy PO rows. `parent_doctype="Internal Transfer Memo"` rows are validated on create — ITM status must be `Partially Delivered` or `Delivered`.

**Backend APIs** (`api/po_delivery_documentss.py` + `api/delivery_challans_data.py`):
- `create_po_delivery_documents` — accepts optional `parent_doctype` + `parent_docname`. For ITM: copies `target_project` to `project`, sets `vendor=None`, `procurement_order=None`. Validates status.
- `get_po_delivery_documents` — split-path: PO uses legacy `procurement_order` filter (back-compat with un-backfilled rows); ITM uses `parent_doctype` + `parent_docname`.
- `get_project_po_delivery_documents` — **PO-only** by design (filter `procurement_order ["is", "set"]`). Used by Material Usage + DN > DC PO report.
- `get_all_delivery_documents(doc_type, parent_doctype)` — returns all rows; report layer filters client-side.
- `get_delivery_challan_itms_with_categories(project_id)` — new ITM picker analog to the PO endpoint. Filters ITMs by `target_project` + status in {Partially Delivered, Delivered}.
- `_enrich_delivery_docs` — batch-fetches `source_project` for ITM-parented rows in one extra SQL query.
- `get_project_itms` — extended to also include child items (`transfer_quantity`, `received_quantity`) for the DN > DC ITM report.

**Frontend surfaces**:
- **Hub** `/prs&milestones/delivery-challans-and-mirs` — top-level PO / ITM toggle (URL param `parent`). Renders `POListTable`+`POListCards` for PO mode, `ITMListTable`+`ITMListCards` for ITM mode (mobile cards exist for both).
- **ITM detail page** — `ITMAttachmentSection` (mirror of PO `DocumentAttachments`'s DC/MIR card). Card always renders when `canView`; upload buttons gated on `canUpload` (status in delivered states). Historical DCs/MIRs never hide.
- **Project DC & MIR tab** — outer 3 tabs (DN > DC Report / DC / MIR), inner PO/ITM toggle (URL param `dcmir_parent`). Counts split by parent.
- **Reports `DCs & MIRs` tab** — PO/ITM toggle (URL param `dcmir_parent`) on its own row below the tabs. Shared `DCMIRReports` component: ITM mode replaces Vendor / PO / Critical PO columns with ITM No. + Source Project; replaces Vendor facet with Source Project facet; replaces PO No. searchable with ITM No. + Source Project searchable.
- **DN > DC ITM report** — `ITMDNDCQuantityReport.tsx`. Mirrors PO `DNDCQuantityReport` exactly: parent ITM rows expand to item sub-rows, status rollup, sortable totals (`SortableHeader` with Asc/Desc/Clear dropdown), source-project + status facets, status filter defaults to hide Matched, search across ITM/source project/item/category, CSV export with PO-equivalent columns, info banner, error state, row tinting via `getReconcileRowClasses` + `getItemRowClasses`.
- **Generalized `UploadDCMIRDialog`** — accepts optional `parentDoctype` prop. Defaults to "Procurement Orders" for back-compat. ITM mode skips vendor link in `Nirmaan Attachments`.
- **Bulk PDF Download** — **PO-only** by design (filter `procurement_order ["is", "set"]` at [useBulkDownloadWizard.ts:148](frontend/src/pages/BulkDownload/useBulkDownloadWizard.ts#L148)). The wizard's vendor-centric UX would not handle ITM rows cleanly.

**UX conventions**:
- PO/ITM segmented toggle uses red-active pill (`bg-red-600 text-white shadow-sm`) on muted track, with full labels "Purchase Orders" / "Transfer Memos". Black text for inactive (not muted). Same styling on project tab + reports hub.
- Status semantics align with PO: `dnQty===0 && dcQty>0` → Pending DN; `dcQty>=dnQty` → Matched; `dnQty>0 && dcQty===0` → No DC Update; else → Mismatch.
- Activity filter (drop `dnQty===0 && dcQty===0`) and orphan-DC handling mirror PO.

**Permission parity**: ITM detail is gated by `ITM_VIEW_ROLES` (Admin/PMO/Procurement/PL/PM). Estimates Executive cannot reach ITM detail page (functionally equivalent to PO's `!isEstimatesExecutive` upload gate). Hub is unprotected at the route level for both PO and ITM (existing PO behavior).

Every Phase 2+ item below is prefixed with 🚧 only if it remains unimplemented; otherwise treated as live.

---

## Data Model

### `Internal Transfer Memo` (parent)

- **autoname:** `ITM-.YYYY.-.#####`
- **module:** Nirmaan Stack
- **track_changes:** 1

| Field | Type | Phase | Notes |
|---|---|---|---|
| source_project | Link → Projects | 1 | Required |
| target_project | Link → Projects | 1 | Required; must `≠ source_project` |
| source_rir | Link → Remaining Items Report | 1 | **Latest submitted RIR of source at create time** |
| status | Select | 1 (first 3) / 🚧 2 (rest) | `Pending Approval` / `Approved` / `Rejected` / `Dispatched` / `Partially Delivered` / `Delivered` |
| estimated_value | Currency (read-only) | 1 | Σ `items.transfer_quantity × estimated_rate` |
| total_items, total_quantity | Int / Float (read-only) | 1 | Derived in validate |
| requested_by | Link → User (read-only) | 1 | |
| approved_by, approved_on | Link → User, Datetime | 1 | Stamped on Approve |
| rejection_reason | Small Text | 1 | Required on Reject |
| 🚧 dispatched_by, dispatched_on, latest_delivery_date | User / Datetime / Date | 2 | Schema already reserved in Phase 1 |
| items | Table → Internal Transfer Memo Item | 1 | |

### `Internal Transfer Memo Item` (child, `istable: 1`)

| Field | Type | Notes |
|---|---|---|
| item_id | Link → Items | Same link target as Purchase Order Item |
| item_name, unit, category, make | Data | Denormalized for display |
| transfer_quantity | Float | Required |
| estimated_rate | Currency | **Snapshot at create time — no retroactive revaluation** |
| 🚧 received_quantity | Float (read-only) | 🚧 Phase 2 — defaults to 0 in Phase 1 |

---

## State Machine

```
                           ┌──────────────────────────────────────────────┐
                           │  Phase 1 (implemented)                       │
                           ▼                                              │
   ┌──────────────────┐  Admin  ┌───────────┐
   │ Pending Approval │ ──────► │ Approved  │ ──► 🚧 Dispatched (Phase 2)
   └────────┬─────────┘         └───────────┘            │
            │ Admin                                      ▼
            ▼                                  🚧 Partially Delivered
   ┌──────────────────┐                                  │
   │     Rejected     │   (terminal; reason required)    ▼
   └──────────────────┘                         🚧 Delivered
```

All Phase 1 transitions are Admin-only. Rejected is terminal — the creator resubmits a fresh ITM. 🚧 Dispatched onward is driven by Phase 2 actions (Dispatch button + DN recalc against ITM).

---

## Deletion Rules

| Status | Deletable? | By Whom |
|---|---|---|
| Pending Approval, Approved, Rejected | ✅ Yes | Creator or Admin |
| 🚧 Dispatched, Partially Delivered, Delivered | ❌ No (Phase 2) | — |

The `before_delete` hook enforces the block. The terminal-state block is schema-ready in Phase 1 even though those statuses aren't reachable yet.

---

## Invariants

1. `source_project != target_project`
2. `source_rir` must equal the **latest submitted** RIR of `source_project` at the moment of creation — *not* merely any submitted RIR.
3. `transfer_quantity ≤ available(item, source_project)` for every item (see Concurrency Guard).
4. `available(item, source_project) = latest_rir.remaining_qty − Σ transfer_qty of non-terminal ITMs (same source, same item)` where **non-terminal ∈ {Pending Approval, Approved}** (and 🚧 Dispatched/Partially Delivered in Phase 2 until superseded by the receiver's next RIR).
5. **Cost-neutral:** no financial impact on either project's ledger. No PO, no payment, no vendor credit recalculation.
6. 🚧 **Phase 3 audit invariant** (per project, per item): `Received + TransferredIn − TransferredOut = Remaining + Consumed`

---

## Concurrency Guard

Availability is re-checked at **both** create-time AND approve-time. Rationale: an Admin may approve ITM-A after ITM-B has already reserved the same item/source pool. The validator lists conflicting ITM names in its error so the Admin can resolve manually.

```python
def available(item_id, source_project):
    latest_rir_qty = <latest submitted RIR's remaining_quantity for item_id>
    reserved = SUM(transfer_quantity) FROM non_terminal ITMs
               WHERE source_project = source_project
                 AND item_id = item_id
                 AND status IN ('Pending Approval', 'Approved')
                 AND name != self.name  # exclude current doc on update
    return latest_rir_qty - reserved
```

🚧 **Phase 3 refinement:** once dispatch exists, reserved-qty summation must *exclude* ITMs whose `dispatched_on > latest_rir.report_date`, because their quantities are already reflected as consumed in the source's next-Monday RIR. Without this, the quantity gets subtracted twice.

---

## Creation Flow (Phase 1)

1. **CTA** — Procurement Exec / PMO / Admin opens **Inventory Item-Wise** page → clicks **"Create Internal Transfer Memo"** (top-right, beside the export button).
2. **Picker** — full-page expandable tree backed by `get_inventory_picker_data`. Parent row per item; sub-rows per `source_project` with checkbox + qty input. A single top dropdown selects the **target project**. The picker subtracts reserved qty from non-terminal ITMs so users see **live available**, not stale RIR qty.
3. **Preview → Submit** — Continue opens `TransferRequestPreviewDialog`, which groups selections by `source_project` into N cards and shows *"This will generate N formal transfer documents"*. Confirm calls `create_itms_from_inventory`, which atomically (savepoint + rollback-on-error) creates N ITMs in status `Pending Approval`.

Admin opens an ITM from the new **Internal Transfer Memos** sidebar (6 tabs: Pending Approval, Rejected, All Requests, Approved, 🚧 Dispatched, 🚧 Delivered) and Approves or Rejects. Rejection requires a non-empty `rejection_reason`.

---

## API Surface

All endpoints under `nirmaan_stack/api/internal_transfers/`.

| API | Phase | Purpose |
|---|---|---|
| `get_inventory_picker_data` | 1 | Tree-shaped inventory for the Create picker. Reuses `api/inventory_item_wise.py` SQL + subtracts reserved qty from non-terminal ITMs. |
| `create_itms_from_inventory` | 1 | Atomic N-ITM creation grouped by `source_project`. Savepoint rollback on any failure. |
| `lifecycle.approve_itm(name)` | 1 | Admin-only. Re-runs availability guard. Stamps `approved_by`/`approved_on`. |
| `lifecycle.reject_itm(name, reason)` | 1 | Admin-only. Requires non-empty reason. Terminal. |
| `lifecycle.delete_itm(name)` | 1 | Creator or Admin. Enforced via `before_delete` hook. |
| `get_itm(name)` | 1 | Single-doc fetch with joined project names + creator full name. |
| `get_itms_list` | 1 | DataTable-backed list for the 6 sidebar tabs. Supports `for_export=true`. |
| 🚧 `get_transfer_summary` | 3 (planned) | Aggregates DN-delivered qty per `(project, item)` for Material Usage columns. |
| 🚧 `get_transferred_in_items` | 3 (planned) | Powers receiver RIR eligibility + pre-fill. |

Controller hooks (`integrations/controllers/internal_transfer_memo.py`): `validate`, `before_delete`, `on_update` (Phase 4 extension point for socket events).

---

## Role Matrix

| Action | Admin | PMO Executive | Procurement Executive | Project Lead | Project Manager |
|---|:-:|:-:|:-:|:-:|:-:|
| **Create ITM** | ✓ | ✓ | ✓ | — | — |
| **Approve / Reject** | ✓ | — | — | — | — |
| **Delete pre-dispatch** | ✓ (any) | — | creator only | — | — |
| **View** | ✓ | ✓ | ✓ | ✓ (read-only) | ✓ (read-only) |

Approval is restricted to Admin — PMO does **not** inherit approval authority here (unlike most procurement flows). The `Administrator` user is treated as Admin per existing `useUserData` convention. Constants live in `frontend/src/constants/itm.ts` (`ITM_CREATE_ROLES`, `ITM_APPROVE_ROLES`, `ITM_VIEW_ROLES`).

---

## Gotchas

1. **Chain transfers out of scope (v1):** items received via ITM cannot be re-transferred until they appear in the receiver's next submitted RIR. There is no intermediate "transferred-in, not yet counted" availability source.
2. **`estimated_rate` frozen at create time:** snapshot from Inventory Item-Wise display rate. It does not revalue if PO quote rates change later. Used only for display / `estimated_value` — never for financial posting.
3. **`source_rir` Link becomes stale** when the source project submits its next-Monday RIR. By that time a Phase 1 ITM is typically already Approved/Rejected; 🚧 Phase 2 Dispatched ITMs must handle this (see Concurrency Guard refinement).
4. 🚧 **DN polymorphism (Phase 2 risk):** `Delivery Notes` currently Links directly to `Procurement Orders` via `procurement_order`. Phase 2 adds `parent_doctype` + `parent_docname` (Dynamic Link) and migrates ~51 consumer sites. **Do NOT touch DN schema in Phase 1.** See `frontend/.claude/context/domain/delivery-notes.md` for the full consumer map.
5. **Picker must subtract reserved qty** (non-terminal ITMs) from the latest RIR remaining — otherwise two users race and both see full availability. This is the single hardest concurrency contract in the system.
6. **Cost-neutral:** no PO, no vendor credit, no payment. `recalculate_vendor_credit()` must **not** fire for DN events whose parent is an ITM (🚧 Phase 2 branch in the shared DN helper).
7. **PMO is not an approver:** re-read the role matrix; this is intentional and differs from most approval flows in the stack.
8. **Approval re-runs availability:** approving a Pending Approval ITM can fail if a peer ITM exhausted the pool between create and approve. Expose the conflicting ITM names in the toast.

---

## Related Docs

- [`.claude/context/domain/procurement.md`](procurement.md) — PR/PO/RFQ/DN flow this system mirrors (cost-bearing path)
- [`frontend/.claude/context/domain/delivery-notes.md`](../../../frontend/.claude/context/domain/delivery-notes.md) — DN structure + 51-point consumer map (critical before 🚧 Phase 2 polymorphism work)
- [`.claude/context/domain/projects.md`](projects.md) — Project status lifecycle (CEO Hold / Halted / Completed gating on source + target)
- `frontend/.claude/context/domain/po-revisions.md` — parallel lock-pattern reference for approval workflows
