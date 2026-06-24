# Loss Justification for High-Loss Items (PR & SB Approval) — Plan

**Status:** SHIPPED / as-built 2026-06-23 (branch `prsb-loss-reason`). Migrated (column verified in DB),
tsc clean (zero new errors, 3181→3181), 7/7 backend calc scenarios pass. Production bundle: build in the
CONTAINER (host rollup native binary is Linux/container-only). Terms in `CONTEXT.md`; scope ADR
`docs/adr/0002-loss-justification-scope.md`; gotchas in root + frontend CLAUDE.md.
**Date:** 2026-06-23

## Validation findings (fixed before commit)

Two real defects an adversarial review caught and we fixed + re-verified:

1. **Backend L1 lookup used the wrong key (would have made the server gate a no-op for L1-only items).**
   `rfq_data.details` is keyed by **`item_id`**, not the `order_list` child-row `name` — verified against
   live PRs (every sampled PR: `match_name=0`, `match_item_id=N`). `compute_item_loss_percent` now reads
   `item.get("item_id")`. Also made the Target Rates lookup deterministic (`order_by="modified desc"`) to
   match the UI.
2. **Benchmark divergence between capture and approval (narrow approve-side deadlock).** Capture uses a
   Target-prioritized benchmark; the approval hooks computed Loss % off `min(Target, L1)`, so an item the
   capture screen didn't flag could be blocked at approval with no way for the read-only approver to add a
   reason. Fixed by computing the approval-side **Loss %** with the Target-prioritized benchmark (the ₹
   "Savings/Loss" column is left on `min(Target, L1)` to avoid regressing existing display — recorded as a
   gotcha, see CLAUDE.md GOTCHA 2).

## Goal

Require a **Loss Justification** for any approval line item whose **Loss % > 10%**, capture it at
procurement Send-for-Approval time, show Loss % + justification on the approval tables, and block
sending/approving until every high-loss item is justified.

## Locked decisions

| Decision | Choice |
|---|---|
| Loss % basis | Keep current benchmark: **Target Rate ×0.98 if available, else Lowest Quoted (L1)**. `lossPercent = (Amount − benchmark) ÷ benchmark × 100`; required when **strictly > 10%**. |
| Capture point | **Procurement enters** the justification at Send-for-Approval; **approvers are read-only** + a backstop gate. |
| Retention scope | **PR/SB approval surfaces only.** No `Purchase Order Item` field, no stored Loss % snapshot, no PO-print / report propagation. Loss % computed live everywhere. |

## Current structure (as-built)

- **Shared item child table:** `Procurement Request Item Detail` (`istable=1`) backs **both**
  `Procurement Requests.order_list` **and** `Sent Back Category.order_list`. Fields today:
  `item_id, item_name, unit, quantity, category, procurement_package, make, status, tax, comment,
  vendor, quote, billing_status`. No loss / justification field exists anywhere.
- **Loss is computed live, never stored.** In
  `VendorsSelectionSummary.tsx` (`generateActionSummary`, ~L299-365):
  - `baseItemTotal = quote × quantity`
  - `pureTargetRate = rawTargetRate × 0.98`; `targetAmount = pureTargetRate × quantity`
  - `lowestQuotedAmount = min(all vendor quotes for item) × quantity` (L1)
  - `benchmark = targetAmount > 0 ? targetAmount : lowestQuotedAmount`
  - `savingLoss = benchmark − baseItemTotal` (skipped for `category === "Additional Charges"`),
    negative ⇒ Loss, shown as `₹-818.00 (L)` (absolute ₹, **no %** today).
- **Four surfaces, two of which capture, two of which display:**
  - PR capture/send: `pages/ProcurementRequests/VendorQuotesSelection/VendorsSelectionSummary.tsx`
    → POSTs `nirmaan_stack.api.send_vendor_quotes.handle_delayed_items`.
  - SB capture/send: `pages/Sent Back Requests/SBQuotesSelectionReview.tsx`.
  - PR approval display: `pages/ProcurementRequests/ApproveVendorQuotes/` (`VendorApprovalTable.tsx`
    + `useApproveRejectLogic.ts`) → `approve_vendor_quotes`.
  - SB approval display: `pages/Sent Back Requests/ApproveSBSQuotesView.tsx` (reuses
    `VendorApprovalTable.tsx`) → `approve_reject_sb_vendor_quotes`.
- On approval, `approve_vendor_quotes.py:45-68` copies `order_list` rows into new `Purchase Order
  Item` rows. **Out of scope here** (retention = PR/SB only), so this file is untouched.

## Shared definition (single source of truth)

Add a pure helper (e.g. `frontend/src/utils/lossPercent.ts`) used by all four surfaces so the rule
never drifts:

```
LOSS_THRESHOLD_PERCENT = 10
benchmark   = targetAmount > 0 ? targetAmount : (lowestQuotedAmount > 0 ? lowestQuotedAmount : 0)
savingLoss  = benchmark > 0 && category !== "Additional Charges" ? benchmark − baseItemTotal : 0
lossPercent = (benchmark > 0 && savingLoss < 0) ? (-savingLoss / benchmark) * 100 : 0
isHighLoss  = lossPercent > LOSS_THRESHOLD_PERCENT
```

Edge cases (documented behaviour):
- No benchmark (no target rate **and** no L1) ⇒ `lossPercent = 0`, never flagged (cannot require a
  justification we can't compute).
- `Additional Charges` ⇒ excluded (matches existing savingLoss behaviour).
- Delayed items (no vendor/quote) ⇒ not in the approval set ⇒ excluded.
- Boundary: exactly 10% does **not** require a justification (strictly `> 10`).

## Work breakdown

### Phase 0 — Schema (one field)
- Add to `Procurement Request Item Detail`: `loss_justification` — **Small Text**, label
  "Loss Justification", **not** `reqd` at the DB level (gating is app-logic, since most items don't
  need it). Place in `field_order` near `comment` / `billing_status`.
- Both PR and SB inherit it automatically (shared child table).
- Apply as a deliberate, reviewed JSON edit (the sanctioned `bench migrate` exception in CLAUDE.md),
  isolated to this one field. Then `bench --site localhost migrate` and verify
  `frappe.db.has_column("Procurement Request Item Detail", "loss_justification")`. No patch guard
  needed (new envs restore from backup; adding a column is safe).
- Add `loss_justification?: string` to the `ProcurementRequestItemDetail` TS interface in
  `types/NirmaanStack/ProcurementRequests.ts`.

### Phase 1 — Capture + Loss % + gate on the procurement send screens
Applies to **`VendorsSelectionSummary.tsx`** (PR) and **`SBQuotesSelectionReview.tsx`** (SB):
1. Compute `lossPercent` via the shared helper alongside the existing `savingLoss`.
2. Show **Loss %** in the item table. Recommendation: render it inside the existing Savings/Loss
   cell (e.g. `₹-818.00 (L · 92.7%)`) to avoid a 12th column; red when `> 10%`. (Exact UI tweakable.)
3. For each `isHighLoss` item, render an inline **Loss Justification** textarea (local state keyed by
   child-row name), seeded from any existing `loss_justification`.
4. Gate: `allHighLossJustified = every isHighLoss item has a non-empty justification`. Disable
   "Send for Approval" (alongside the existing `allVendorsHaveTerms`) until satisfied, with a clear
   "* Provide a loss justification for all items over 10% loss" message; also enforce in the confirm
   dialog.
5. Persist on submit: extend the send flow to write `loss_justification` onto the `order_list` rows
   (mirror how `payment_terms` is saved before `sendForApprCall`), or pass a
   `{childRowName: text}` map into the `handle_delayed_items` payload.

### Phase 2 — Backend persistence + backstop (`send_vendor_quotes.py`)
- Accept and store `loss_justification` per `order_list` row.
- Backstop validation: for any item the client flagged high-loss, reject if justification is blank.
  - **True server-side hard gate is feasible (preferred).** Both benchmark inputs are
    server-accessible: Target Amount via the existing `Target Rates` doctype query
    (`api/target_rates/get_target_rates_for_item_list.py` — `Target Rates.rate` ×0.98 per
    `item_id::unit::make`), and L1 from the PR's stored `rfq_data.details[item_id].vendorQuotes`.
    So the backend can recompute the exact same `benchmark`/`lossPercent` from `order_list` +
    `rfq_data` + `Target Rates` and independently require a justification for any `> 10%` item.
  - Fallback (only if we choose to skip the recompute): enforce non-empty justification for
    client-flagged items. Document whichever level we ship.

### Phase 3 — Display + backstop on the approval screens (PR + SB)
Applies to **`VendorApprovalTable.tsx`** (shared) + `useApproveRejectLogic.ts` /
`useApproveSBSLogic.ts`:
1. `loss_justification` rides along on the row type (extends `ProcurementRequestItemDetail`) once it
   is on the schema + fetched.
2. Compute `lossPercent` (shared helper) and display **Loss % + the stored justification read-only**
   in the table (e.g. % in the Savings/Loss cell, justification as a sub-line / tooltip).
3. Backstop gate in `handleApproveConfirm`: block approval if any high-loss selected item has no
   justification (covers legacy/in-flight docs created before this feature). Approvers cannot edit
   the justification (read-only by decision).

### Phase 4 — Tests + verification
- Unit-test the pure `lossPercent` helper: target-benchmark case, L1 fallback, Additional Charges
  exclusion, no-benchmark case, exact-10% boundary, savings (positive) case.
- Manual: high-loss PR blocks send until justified → approver sees Loss % + justification read-only;
  same path for SB.

## Risks / call-outs
- **Heavy flagging:** because Target is prioritized and targets are often optimistic, many items can
  exceed 10% (the Duct Tape example = 92.7% even though the chosen vendor was the cheapest quote).
  If this proves noisy in practice, revisit basis (L1-only) or threshold — not a code risk, a policy
  one.
- **No-benchmark gap:** items with neither a target rate nor an L1 cannot be flagged (documented).
- **Backstop strength:** a true server-side hard gate is feasible — both benchmark inputs are
  server-accessible (`Target Rates` doctype + the PR's stored `rfq_data`) — and is preferred over
  trusting the client's flag.
- **Untouched by design:** PO creation (`approve_vendor_quotes.py` item copy), `Purchase Order Item`
  schema, print formats, reports — all out of scope per the retention decision.

## Files in scope
- Schema: `doctype/procurement_request_item_detail/procurement_request_item_detail.json`
- Backend: `api/send_vendor_quotes.py` (+ SB send path if separate)
- Types/util: `types/NirmaanStack/ProcurementRequests.ts`, new `utils/lossPercent.ts`
- PR capture: `pages/ProcurementRequests/VendorQuotesSelection/VendorsSelectionSummary.tsx`
- SB capture: `pages/Sent Back Requests/SBQuotesSelectionReview.tsx`
- Approval (shared): `pages/ProcurementRequests/ApproveVendorQuotes/components/VendorApprovalTable.tsx`,
  `.../hooks/useApproveRejectLogic.ts`, `pages/Sent Back Requests/hooks/useApproveSBSLogic.ts`
