# Implementation Plan — Auto CEO Hold on >4 Pending Delivery Notes (+ reasons for auto-holds)

**Status:** plan for review (2026-06-23). No code written yet.
**Design of record:** `docs/adr/0004-multi-source-ceo-hold.md` · **Glossary:** `docs/CONTEXT.md`
**Builds on:** the Project Action Item projection (ADR-0002) + the cashflow auto-hold engine.

---

## 1. Decisions (from the grill)

| # | Decision |
|---|---|
| Metric | `> 4` **POs awaiting delivery** = `> 4` Open `DN_PENDING` rows (per-PO grain). Threshold strict `> 4` (5+ trips). |
| Scope | `DN_PENDING` only (not `DC_PENDING`). |
| Model | **Multi-source** reasons projection; **auto-only** (manual hold untouched). |
| Lifecycle | **Symmetric auto-release** (≤4 → drop reason). Revert via existing `_find_previous_status` (`WIP` fallback). |
| Reason | `source` tag **+** live templated human text. |
| Trigger | Evaluate inside the action-item reconcile; write via `set_value(update_modified=False)`; **never suppress** `DN_PENDING` under hold. |
| Retrofit | Cashflow engine rewired to manage a `cashflow` reason row. |
| Visibility | Project Detail banner + PMO dashboard banner + blocked-action toast. |
| Manual boundary | **Block** a manual move off CEO Hold while any reason row is active. |
| Storage | Standalone `CEO Hold Reason` doctype (Link → Projects), **not** an `istable` child (avoids parent-save hook recursion). |

---

## 2. Architecture — one serialized owner behind one status

```
PO / DN / DC save ──enqueue──▶ reconcile_project_action_items(project)
                                  │ holds Projects row FOR UPDATE
                                  │ dn_count = count DN_PENDING in `desired`  (free)
                                  └─▶ ceo_hold.sync_delivery_pending(project, dn_count)
Payment/Expense/Inflow/PO save ─▶ trigger_check(project)
                                  └─▶ ceo_hold.sync_cashflow_reason(project)
                                                     │
        both engines ───────────────────────────────┘
                          set_reason / clear_reason  (own source only)
                                     │
                          recompute_ceo_hold(project)   ◀── THE single serialized owner
                            • SELECT Projects … FOR UPDATE   (serializes the two engines)
                            • should_hold = manual_active OR ≥1 reason row
                            • set_value(status, ceo_hold_by, update_modified=False)
                            • release (revert via Version walk) only when neither holds
```

`recompute` is the **only** writer of `status`/`ceo_hold_by` for system holds. `status == "CEO Hold"` is kept
as the mirror, so all ~50 existing read-side consumers are unchanged.

**`ceo_hold_by` semantics after this change:** real user email = a manual (nitesh) hold is in effect (preserved
verbatim); `"System (Cashflow Cron)"` = held by ≥1 system reason, no manual hold; `None` = not held. The *why*
for system holds lives in the reason rows, not in this field.

---

## 3. Build sequence (waves)

- **Wave 1 (parallel, no deps):** [B1] new `CEO Hold Reason` doctype · [B2] `services/ceo_hold/core.py`.
- **Wave 2 (after Wave 1):** [B3] cashflow-engine retrofit · [B4] reconcile hook · [B5] `projects.py` manual-gate clause · [B6] backfill patch. (All depend on `core.py`.)
- **Wave 3 (parallel, after B1–B5):** [F1] frontend type · [F2] guard hook + banner + detail/PMO wiring · [B7] backend test suites · [D1] docs refresh.

> Per the repo's plan-to-parallel rule: create one `TaskCreate` per item below, set `addBlockedBy` for Wave-2/3
> deps, then launch each wave as parallel `general-purpose` subagents.

---

## 4. Backend — file by file

### [B1] NEW doctype `CEO Hold Reason`  (standalone, `istable=0`, Link → Projects)
Path: `nirmaan_stack/nirmaan_stack/doctype/ceo_hold_reason/` → `ceo_hold_reason.json`, `ceo_hold_reason.py`
(stub `class CEOHoldReason(Document): pass`), `__init__.py`, `test_ceo_hold_reason.py`.

Fields:
- `project` — Link → Projects, `reqd=1`, `search_index=1`, `in_standard_filter=1`.
- `source` — Select, options `cashflow\ndn_pending`, `reqd=1`.
- `reason_text` — Small Text.
- `set_at` — Datetime.
- `dedup_key` — Data, `unique=1` (= `"{project}::{source}"`, the one-row-per-source guard; mirrors the
  `Project Action Item` dedup_key pattern so a double-insert can't create two rows for the same source).

`module="Nirmaan Stack"`, `engine="InnoDB"`, permissions block mirroring `Project Action Item`. `track_changes=0`
(it's a derived projection; the Projects Version trail still records human status changes).
Run `bench --site localhost migrate`; verify the table + `dedup_key` unique index via `frappe.db`.

### [B2] NEW module `nirmaan_stack/services/ceo_hold/core.py` — the serialized owner
New package `services/ceo_hold/` (`__init__.py` + `core.py` + `test_core.py`). Constants:
`DN_PENDING_HOLD_THRESHOLD = 4`, `SOURCE_CASHFLOW = "cashflow"`, `SOURCE_DN = "dn_pending"`.
Import `CEO_AUTHORIZED_USER`, `CEO_HOLD_SYSTEM_USER` from `constants/authorized_users`.

**Relocate** `_find_previous_status` + `FALLBACK_REVERT_STATUS` here from `project_cashflow_hold_update.py`
(single home; the cashflow module imports them back from here). Functions:

- `_dedup_key(project, source)` → `f"{project}::{source}"`.
- `set_reason(project, source, text)` — get-or-create by `dedup_key`; on **create** set `reason_text` + `set_at`;
  on an **existing** row refresh `reason_text` **in place** but leave `set_at` untouched (stable "held since").
  Uses the same `savepoint(catch=_DUP_ERRORS)` get-or-create idiom as `reconcile._create_or_reopen` (defends the
  unique index under concurrency). **No commit.**
- `clear_reason(project, source)` — `frappe.db.delete("CEO Hold Reason", {"dedup_key": _dedup_key(...)})`. **No commit.**
- `active_sources(project)` → `set[str]`; `active_reasons(project)` → list of `{source, reason_text}` (for the banner).
- `recompute_ceo_hold(project)` — **the owner**:
  1. `frappe.db.get_value("Projects", project, "name", for_update=True)` (lock; `None` → return).
  2. read `status`, `ceo_hold_by`; `manual_active = status == "CEO Hold" and ceo_hold_by and "@" in ceo_hold_by`.
  3. `has_system = bool(active_sources(project))`; `should_hold = manual_active or has_system`.
  4. if `should_hold` and `status != "CEO Hold"` → `set_value(status="CEO Hold", ceo_hold_by=(ceo_hold_by if manual_active else CEO_HOLD_SYSTEM_USER), update_modified=False)`.
     if `should_hold` and already held and not manual → ensure `ceo_hold_by = CEO_HOLD_SYSTEM_USER` (in case a stale value).
  5. elif not `should_hold` and `status == "CEO Hold"` → `set_value(status=_find_previous_status(project), ceo_hold_by=None, update_modified=False)`.
  6. **No commit** (the caller — reconcile, or the host save txn — owns the commit).
- `sync_delivery_pending(project, dn_count)` — `dn_count > DN_PENDING_HOLD_THRESHOLD` → `set_reason(project, SOURCE_DN, dn_reason_text(dn_count))` else `clear_reason(project, SOURCE_DN)`; then `recompute_ceo_hold(project)`.
- `sync_cashflow_reason(project)` — compute gap (calls back into the cashflow module's `_compute_cashflow_gap` + limit/Completed guards); gap > limit → `set_reason(project, SOURCE_CASHFLOW, cashflow_reason_text(gap, limit))` else `clear_reason(project, SOURCE_CASHFLOW)`; then `recompute`.
- text builders: `dn_reason_text(n)` → `f"{n} purchase orders awaiting delivery (limit {DN_PENDING_HOLD_THRESHOLD})"`; `cashflow_reason_text(gap, limit)` → `f"Cashflow gap ₹{gap:,.0f} exceeds limit ₹{limit:,.0f}"`.

> Import direction to avoid a cycle: `core.py` is the leaf (owns `recompute` + `_find_previous_status`);
> `project_cashflow_hold_update.py` imports from `core`; `core.sync_cashflow_reason` calls the cashflow module's
> gap helper — put `sync_cashflow_reason` **in the cashflow module** (it needs `_compute_cashflow_gap`) and have
> it call `core.set_reason/clear_reason/recompute`. That keeps `core` dependency-free of the cashflow module.

### [B3] EDIT `integrations/controllers/project_cashflow_hold_update.py` — retrofit to reason rows
- Replace `evaluate_project_ceo_hold` + `evaluate_project_ceo_release` (lines 14–161) with a single
  `sync_cashflow_reason(project)`: guard `status == "Completed"` → `clear_reason(cashflow)`; `cashflow_gap_limit <= 0` → `clear_reason(cashflow)`; else compute gap; `gap > limit` → `set_reason(cashflow, text)` else `clear_reason(cashflow)`; then `core.recompute_ceo_hold(project)`. **No direct `status`/`ceo_hold_by` writes remain.**
- `trigger_check` (285–311): keep the dedup-flag + skip-in-bulk guard + try/except; body becomes `sync_cashflow_reason(project)` (drop the hold-then-release pair).
- Keep `_compute_cashflow_gap` (352–388) here. Move `_find_previous_status` + `FALLBACK_REVERT_STATUS` to `core` (import back if referenced).
- `_notify_manual_hold_releasable` (164–247): **keep**. Call it from `recompute`/`sync_cashflow_reason` when `manual_active` and the gap has recovered (preserves the existing "your manual hold is releasable" nudge).
- `update_projects_cashflow_hold` (250–279) bulk evaluator: re-point to `sync_cashflow_reason` per project (still commented-out in cron; leave wiring as-is). `on_project_payment/expense/inflow/procurement_order` (313–349) unchanged (they call `trigger_check`).
- The four `doc_events` in `hooks.py` (Payments/Expenses/Inflows/POs → cashflow handlers) are **unchanged**.

### [B4] EDIT `services/action_items/reconcile.py` — evaluate the delivery reason in place
- Import `from nirmaan_stack.services.ceo_hold import core as ceo_hold`, `ACTION_DN_PENDING` (already imported).
- In `reconcile_project_action_items`, **suppress branch** (lines 266–269): before its `commit`, also
  `ceo_hold.clear_reason(project_name, ceo_hold.SOURCE_DN); ceo_hold.recompute_ceo_hold(project_name)`
  (a Completed/Halted project must not carry a delivery hold).
- After `counts["scanned"] = len(desired)` (line 273): `dn_count = sum(1 for p in desired.values() if p["action_type"] == ACTION_DN_PENDING)`; **after the reconcile loop, before the final `commit` (line 307):** `ceo_hold.sync_delivery_pending(project_name, dn_count)`.
- `_SUPPRESS_PROJECT_STATUSES` stays `{Completed, Halted}` — **do not** add `CEO Hold` (anti-oscillation; FORK 8).
  The reconcile already holds the Projects `FOR UPDATE` lock (line 252), and `recompute` re-locking the same row
  in the same txn is a no-op → no extra lock, no deadlock.

### [B5] EDIT `nirmaan_stack/doctype/projects/projects.py` — manual-boundary clause (FORK 9)
In `_validate_ceo_hold_status`, the `elif old_status == "CEO Hold"` branch (lines 53–66), **before** the
`can_revert` logic: if `frappe.db.exists("CEO Hold Reason", {"project": self.name})` → collect the reason texts and
`frappe.throw(f"Cannot release CEO Hold while active system conditions hold this project: {', '.join(texts)}. They clear automatically when resolved.", frappe.PermissionError)`. The set/revert nitesh-only logic is otherwise
untouched. (recompute releases via `set_value`, which bypasses `validate`, so auto-release is unaffected.)

### [B6] NEW patch `patches/v3_0/seed_ceo_hold_reasons.py` (+ register in `patches.txt`)
For each project `status == "CEO Hold" AND ceo_hold_by == CEO_HOLD_SYSTEM_USER`: seed a `cashflow` reason row
(recompute its gap text via the cashflow module; idempotent get-or-create). Manual holds (`ceo_hold_by` a real
email) get no row. Delivery reasons are seeded by the next reconcile (event or nightly) — no heavy full-sweep in
the patch. Mirrors `patches/v3_0/backfill_ceo_hold_by.py`.

---

## 5. Frontend — file by file (FORK 6 scope only)

### [F1] NEW `frontend/src/types/NirmaanStack/CEOHoldReason.ts`
`export interface CEOHoldReason { name: string; project: string; source: "cashflow" | "dn_pending"; reason_text?: string; set_at?: string }`.

### [F2] Guard hook + banner + detail/PMO wiring
- `src/hooks/useCEOHoldGuard.ts`: add `frappe.db.get_all`/`useFrappeGetDocList("CEO Hold Reason", {project})` →
  return `holdReasons: CEOHoldReason[]`. Extend `showBlockedToast` to append the reason texts.
- `src/components/ui/ceo-hold-banner.tsx`: new optional `reasons?: {source; reason_text}[]` → render the list in
  the full banner body (and compact tooltip). `heldBy` System/Manual badge unchanged.
- `src/pages/projects/project.tsx` (banner ~`:1720`) + PMO `pmo-project-detail.tsx` (~`:511`): pass `reasons`
  through. The manual-release **block** (FORK 9) surfaces via the existing `getFrappeError` path in
  `handleConfirmStatus`; optionally pre-disable the off-hold option when `holdReasons.length > 0` (backend is the
  gate; this is cosmetic).
- The ~22 generic `CEOHoldBanner` mounts and `useCEOHoldProjects` (list tint) are **unchanged** this slice.

---

## 6. Test surface

- **`test_ceo_hold_reason.py`** (new doctype): create; `(project, source)` uniqueness via `dedup_key`; `set_at` persists.
- **`services/ceo_hold/test_core.py`** (the heart):
  - `recompute`: system-only → `status="CEO Hold"` + `ceo_hold_by=System`; clearing the **last** reason →
    revert via `_find_previous_status`; **manual + system coexist** → stays held, `ceo_hold_by` stays the user;
    clearing system while a manual hold is present → stays held.
  - **two reasons coexist; releasing one keeps the project held** (the anti-clobber keystone).
  - `set_reason`/`clear_reason` idempotent; `sync_delivery_pending` boundary (4 → no hold, 5 → hold, 5→4 → release);
    `sync_cashflow_reason` (gap>limit → hold, recover → release, limit=0 → clear, Completed → clear).
- **`test_projects.py`** (extend): FORK 9 — manual move off CEO Hold **blocked** while a reason row exists,
  **allowed** when none; existing nitesh-only set/revert tests stay green.
- **Cashflow controller tests** (locate `test_project_cashflow_hold_update*`): retarget hold/release assertions to
  the **reason-row** model (hold → a `cashflow` reason exists; release → it's gone; manual hold never auto-released).
- **Reconcile / action-item tests** (locate `services/action_items/test_*`): the reconcile sets/clears the
  `dn_pending` reason at the `>4` boundary; Completed/Halted clears it; **a CEO-Hold project still generates its
  `DN_PENDING` action items** (no suppression — the oscillation regression guard).
- **Patch**: `seed_ceo_hold_reasons` idempotent on a cashflow-held fixture; manual hold gets no row.

Run: `bench --site localhost migrate` then `bench run-tests --app nirmaan_stack` (or the targeted modules).
Frontend: in-container `tsc` (0 new errors) + `yarn build` exit 0.

---

## 7. Docs to update **with the code** (DOCS-UPDATE discipline)
- `docs/ceo_hold_auto_management.md` — extend for the multi-source reasons model + the delivery-pending source.
- `frontend/.claude/context/domain/ceo-hold.md` — replace the stale "manual-only" section; document both
  automatic sources + the reasons table + the manual-release block.
- `docs/CONTEXT.md` — already updated during the grill.

---

## 8. Execution Strategy
Execute via the Plan-to-Parallel workflow (see `~/.claude/CLAUDE.md`):
- **Wave 1 (parallel):** B1, B2 (no deps).
- **Wave 2 (after Wave 1):** B3, B4, B5, B6 (depend on B2/B1).
- **Wave 3 (parallel, after Wave 2):** F1, F2, B7 (tests), D1 (docs).
Create all tasks with `TaskCreate`, set deps with `TaskUpdate` (`addBlockedBy`), then launch each wave as parallel
`general-purpose` subagents. Each subagent prompt must carry the **why** (this plan + ADR-0004 as context).

## 9. Risks / watch-items
- **Lock ordering:** `recompute` re-locks the Projects row the reconcile already holds (same txn = no-op); the
  cashflow path locks in its own txn and *waits* (no cycle → no deadlock). Verify no third path locks Projects +
  another row in the opposite order.
- **`ceo_hold_by` "@" heuristic** for manual-active: matches the existing `_is_user_owned` convention. Confirm no
  system marker ever contains "@".
- **Reason text refresh churn:** `set_reason` rewrites `set_at` each reconcile only if we choose to; keep `set_at`
  as **first-seen** (don't bump on text-only refresh) so "held since" is stable — refresh `reason_text` in place,
  set `set_at` only on create.
