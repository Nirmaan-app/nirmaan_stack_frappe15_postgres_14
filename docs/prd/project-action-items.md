# Project Action Items (v2) — Implementation Plan

**Status:** PLAN (not yet built). Design locked 2026-06-22 (grilling session); **hardened 2026-06-22
after adversarial red-team — see §14**.
**Branch (proposed):** `feature/project-action-items-v2` off the current `feature/project-action-items`.
**See also:** [ADR-0002](../adr/0002-project-action-items-materialized-projection.md) ·
[CONTEXT.md → Action Center](../../CONTEXT.md#action-center) ·
[domain/action-center.md → v2](../../.claude/context/domain/action-center.md).

## 1. Goal

Turn Project Action Items from an ephemeral, derive-on-read browser computation into a **durable,
event-driven, recompute-from-truth projection** that persists per (PO, obligation), is role-targeted,
self-heals against every reverse/partial/missed-event path, and powers both the project page
(Surface B) and a Project-Manager dashboard (Surface A).

**v1 obligations:** `DN_PENDING` ("dispatched, not fully delivered") and `DC_PENDING` ("delivered,
no Delivery Challan filed"). PO-only. Assignee = Project Manager. (Full locked decision table + the
**exact predicates**: see `action-center.md` v2 section — the predicates are the corrected,
red-teamed versions.)

## 2. Non-negotiable invariants (the "foolproof" core)

1. **Recompute-from-truth, never delta.** Every reconcile rebuilds a project's *entire* pending set
   from current state and upserts to match. No code path increments/decrements or creates/deletes a
   single row in isolation.
2. **Idempotent + concurrency-safe.** Running the reconciler N times — even concurrently for the same
   project — yields the same rows and never aborts on a UNIQUE violation. Keyed by
   `dedup_key = "{project}::{reference_name}::{action_type}"`. (See §4 for the savepoint/lock guard.)
3. **Rebuildable.** `reconcile_all()` can regenerate the whole table from scratch. This is also the
   backfill.
4. **Self-healing.** The nightly sweep makes a missed event eventually correct. Event hooks are a
   latency optimisation, not a correctness dependency.
5. **System-owned in v1.** No human-mutable fields; `status` is derived. (Future ack/snooze must be
   stored keyed by `dedup_key` so a recompute can't wipe it.)
6. **Never breaks a host save.** Every event hook's enqueue is wrapped in `try/except` + `log_error`
   and returns — a missing/broken reconciler can never fail a PO/DN/DC save.

## 3. Data model — `Project Action Item` doctype

New top-level doctype (`istable=0`), module "Nirmaan Stack". Autoname `PAI-.YYYY.-.#####`.

| Field | Type | Notes |
|---|---|---|
| `project` | Link → Projects | reqd, `search_index`, `in_standard_filter` |
| `action_type` | Select | `DN_PENDING`, `DC_PENDING` (enum grows later); reqd, `in_standard_filter` |
| `reference_doctype` | Link → DocType | v1 always "Procurement Orders" (future-proofs ITM) |
| `reference_name` | Dynamic Link (`reference_doctype`) | the PO docname, reqd, `search_index`. **May reference a since-deleted PO on a Resolved row — readers must tolerate that.** |
| `status` | Select | `Open`, `Resolved`; default `Open`; `in_standard_filter` |
| `assigned_role` | Data | v1 = `"Nirmaan Project Manager Profile"` (the **`role_profile` field value** — NOT the Frappe Role `"Nirmaan Project Manager"`, which has no "Profile" suffix). Hardcode as `ASSIGNED_ROLE_PM`. |
| `dedup_key` | Data | **unique index**; `"{project}::{reference_name}::{action_type}"` |
| `title` | Data | denormalized display, e.g. "Record Delivery Note — PO/123" |
| `action_url` | Data | deep-link (project page DC&MIR tab, or PO detail) |
| `first_opened_at` | Datetime | set on create; never overwritten |
| `last_opened_at` | Datetime | set on each open/re-open (drives aging) |
| `resolved_at` | Datetime | set on resolve; cleared on re-open |
| `source` | Data | `"reconcile"` (audit; future: `"manual"`) |

- **Permissions:** read for the role profiles that can see projects; **no create/write/delete in the
  Desk UI** — only the reconciler writes (`ignore_permissions=True`). System-owned.
- **Controller:** bare stub — all logic lives in the reconciler (no lifecycle hooks on this doctype →
  no recursion when the reconciler writes rows).
- `bench --site localhost migrate`; verify columns + the unique index on `dedup_key`.

## 4. The reconciler — `nirmaan_stack/services/action_items/reconcile.py`

```
reconcile_project_action_items(project_name) -> dict   # {opened, resolved, reopened, scanned}
```

Algorithm (recompute-from-truth, **bulk queries, no N+1**):

1. **Per-project serialization lock.** Acquire a project-scoped lock to serialize a hook-triggered
   reconcile against the nightly sweep (e.g. `frappe.db.get_value("Projects", project_name, "name",
   for_update=True)`, or a named lock). Combined with the savepoint guard in step 3, this prevents
   the concurrent-insert race.
2. **Gate on project status.** If `Projects.status ∈ {Completed, Halted}` → resolve **all** open
   action items for the project and return. Else continue. (Active set: WIP / Won / Handover / CEO
   Hold — **and blank/NULL status, which is active**.) **PostgreSQL trap (found in Phase 1):** never
   filter active projects with SQL `status NOT IN (Completed, Halted)` — `NULL NOT IN (...)` is NULL,
   not TRUE, so blank-status projects (common) would be silently dropped. `reconcile_all` fetches all
   projects and filters the suppress-set in **Python**.
3. **Compute the desired open set — three BULK queries, then pure-Python evaluation:**
   - `frappe.get_all("Procurement Orders", filters={project, status ∈ live-set}, fields=[name,
     status, billing_status], limit_page_length=0)` — **explicitly filter status to the live-delivery
     set** `{Dispatched, Partially Dispatched, Partially Delivered, Delivered}` (excludes PO Approved,
     **Merged, Cancelled, Inactive**).
   - `frappe.get_all("Purchase Order Item", filters={parent ∈ PO names}, fields=[parent, category,
     is_dispatched, quantity, received_quantity], limit_page_length=0)` → `items_by_po` dict.
   - `frappe.get_all("PO Delivery Documents", filters={parent_doctype="Procurement Orders",
     parent_docname ∈ PO names, type="Delivery Challan", is_stub=0}, ...)` → `has_dc` set.
   - Evaluate the two **pure predicates** (`predicates.py`, the corrected versions in
     `action-center.md`) against these dicts. Desired = set of `dedup_key`s that should be Open.
4. **Reconcile** existing rows vs Desired (idempotent upsert; each create in a **savepoint**):
   - desired ∧ existing-Open → no-op (refresh `title`/`action_url` if changed).
   - desired ∧ existing-Resolved → **re-open** (Open, `last_opened_at=now`, clear `resolved_at`).
   - desired ∧ no row → **create** Open inside `with frappe.db.savepoint(...)`; on a duplicate-key
     violation (a concurrent reconcile won the race) → **fall back to re-open the existing row**
     (get-or-create). **Catch BOTH `frappe.exceptions.UniqueValidationError` (Frappe's in-app
     pre-check) AND `frappe.exceptions.DuplicateEntryError` (DB-level)** — empirically a dup
     `dedup_key` surfaces as either depending on cache/timing (verified in Phase 0 testing). They are
     unrelated classes (ValidationError vs NameError MRO), so a single-class catch leaks.
   - existing-Open ∧ not desired → **resolve** (`resolved_at=now`). This is also how a
     deleted/Merged/Cancelled PO's rows close — it simply isn't in Desired.
5. `frappe.db.commit()` once; return counts.

- **Reuse, don't duplicate:** predicate inputs mirror what `generate_po_summary` /
  `get_project_po_delivery_documents` expose; predicates are pure functions unit-tested against the
  same scenarios so the definition can't silently drift.
- **`reconcile_all()`** loops active projects → `reconcile_project_action_items` per project, with
  **per-project** `try/except` + `frappe.db.rollback()` + `frappe.log_error()` + commit (the
  `pmo_task_renewal` idiom). The inner function commits once per project; `reconcile_all` does **not**
  double-commit — it only catches/logs and continues. Optional global sweep-lock (a last-run marker)
  to avoid an accidental manual + cron overlap. This is both the nightly sweep body and the one-time
  backfill.

## 5. Event hooks (timeliness) — enqueued, non-blocking, defensive

Each hook resolves the affected `project`, then:
```
try:
    if not project: return                       # blank/legacy link → no-op, never raise
    frappe.enqueue("nirmaan_stack.services.action_items.reconcile.reconcile_project_action_items",
                   project_name=project, queue="short", deduplicate=True,
                   job_id=f"pai::{project}", enqueue_after_commit=True)   # <-- after_commit is REQUIRED
except Exception:
    frappe.log_error(title="action-item enqueue failed")   # never break the host save
```
`enqueue_after_commit=True` is **mandatory** — without it the job can run before the triggering write
commits and read stale state (Frappe default is `False`).

| Trigger | Hook | File | New? |
|---|---|---|---|
| PO dispatch / revert / status change | `Procurement Orders.on_update` | `integrations/controllers/procurement_orders.py` (already runs AQ + cashflow hooks — **append**, don't disturb) | extend existing |
| DN created / edited | `Delivery Notes.on_update` | `integrations/controllers/delivery_notes.py` | extend existing |
| DN deleted | `Delivery Notes.after_delete` | same — **must add the enqueue** (today it only recalcs PO + vendor credit) | extend existing |
| DC created | `PO Delivery Documents.after_insert` | `integrations/controllers/po_delivery_documents.py` + register in `hooks.py` | **NEW hook** |
| DC deleted | `PO Delivery Documents.on_trash` | same | **NEW hook** |

Hook rules (all verified necessary by the red-team):
- **Skip `parent_doctype != "Procurement Orders"`** on DN/DC hooks (ITM is out of v1).
- **Guard blank/legacy links** (`procurement_order` / `parent_docname` may be unset on old rows) →
  return, never query-then-crash.
- PO Cancelled is deleted in `on_update`; that's fine — the reconcile (this enqueue + nightly) finds
  the PO gone and resolves its rows.

## 6. Nightly sweep + backfill

- **`hooks.py` scheduler:** add `reconcile_all` to `scheduler_events` (`cron "0 2 * * *"`), file
  `nirmaan_stack/tasks/action_item_reconcile.py` (mirrors `vendor_credit_update` / `pmo_task_renewal`).
- **Backfill:** the same `reconcile_all()` run once (manual `bench execute`) on first deploy. No
  separate backfill code.

## 7. Read endpoints — `nirmaan_stack/api/action_items/read.py` (permission-scoped)

**Both endpoints MUST enforce project access** — bare whitelist would leak cross-project data
(the existing `generate_po_summary` is bare; do NOT copy that). Reuse the
`critical_po_tasks._get_allowed_projects(frappe.session.user)` pattern (Full-access roles
Admin/PMO see all; filtered roles scoped via `Nirmaan User Permissions` `for_value=project`).

- `get_project_action_items(project_name)` → verify the caller may access `project_name`; else throw.
  Return Open rows. Drives Surface B.
- `get_my_action_items()` → resolve the caller's **accessible** projects first, then return Open rows
  for **only those projects**, grouped by project. **Not** filtered by `assigned_role` (so Admin/PMO
  see everything incl. no-PM projects; a PM sees their assigned projects). `assigned_role` is a
  display label in v1. Drives Surface A.
- Both read-only; never write.

## 8. Frontend

- **Surface B rewire** (`frontend/src/pages/projects/components/ProjectActionItems.tsx`): swap
  `useDNDCQuantityData` for `get_project_action_items(projectId)`; counts = group Open rows by
  `action_type`; tiles deep-link via `action_url`. `getLandingTab` gating + mount point unchanged.
  This **retires** the old report-tile definition of "DN Pending" (the intended redefinition — no
  dual-source divergence once rewired).
- **Surface A** (`frontend/src/pages/.../dashboard-pm.tsx` — the existing **ProjectManager** page at
  route `/prs&milestones`, which today is a nav-card grid): add an **"Action Items" panel/section**
  to that page consuming `get_my_action_items`, grouped by project, each row a deep-link. (Red-team
  confirmed there is **no** pre-existing data panel here — Surface A is a new panel on an existing
  route, not a new route. shadcn/ui only; no new libs.)

## 9. Test matrix (backend — the foolproof proof)

Pure-predicate + reconciler unit tests (`FrappeTestCase`, Projects-row fixture pattern):

- **DN_PENDING:** Dispatched-no-DN → open; Partially Delivered (qty remaining) → open;
  Delivered → resolved; **tolerance-delivered (97.5/100 float) → Delivered → resolved** (not open);
  Non-Billable → never; Additional-Charges-only → never; Partially Dispatched with a dispatched-and-
  undelivered item → open; Partially Dispatched with the dispatched item fully delivered → not open.
- **DC_PENDING:** delivered + no DC → open; delivered + a DC → resolved; delivered + only a **stub**
  DC → open; **Partially Dispatched WITH a DN (item received>0) + no DC → open** (the sticky-status
  false-negative the red-team caught); delivered + only an **MIR** (no DC) → open; Non-Billable → never.
- **Co-existence:** one PO yields **both** a DN and a DC row independently.
- **Idempotency / concurrency:** reconcile ×3 → identical rows; **two concurrent reconciles for the
  same project → no `DuplicateError` escapes** (savepoint get-or-create proven).
- **Self-heal / reverse paths:** DN deleted → DN row re-opens; PO reverted (where allowed) → resolve;
  DC deleted → DC row re-opens; **PO Merged/Cancelled/deleted → its rows resolve** (drop from desired
  set).
- **Exclusions:** Merged/Cancelled/Inactive/PO-Approved POs → never generate rows.
- **Project gating:** Completed/Halted → all rows resolved; CEO Hold → DN_PENDING kept.
- **Hooks:** ITM-parented DN/DC change → no PO rows; **blank/legacy `procurement_order`/`parent_docname`
  → hook no-ops, does not crash the save**.
- **Read security:** a user without access to project X → `get_project_action_items("X")` throws;
  `get_my_action_items()` returns only the caller's accessible projects.
- **Orphan:** a project with pending rows but no assigned PM → rows still visible to Admin/PMO via
  Surface A; nightly logs a warning naming such projects.

## 10. Rollout

1. Doctype + migrate (no behaviour).
2. Reconciler + predicates + tests (run manually via `bench execute`; verify rows). **Create the
   reconcile module/stub BEFORE wiring any hook** so a hook can never import-fail a save.
3. Hooks (incl. the two new PDD hooks) + nightly + backfill run.
4. Read endpoints (permission-scoped).
5. Surface B rewire (now persistent + correctly-defined).
6. Surface A panel on the ProjectManager dashboard.

Safety: the engine is additive + idempotent; Surface B keeps the old derive-on-read path until step 5.
Backfill is re-runnable.

## 11. Execution Strategy

Execute via the Plan-to-Parallel workflow (CLAUDE.md):

- **Wave 1:** Phase 0 (doctype + migrate). *Blocks everything.*
- **Wave 2:** Phase 1 (predicates + reconciler + savepoint/lock guard + unit tests + manual backfill).
  *Depends on W1.*
- **Wave 3 (parallel):** Phase 2 (event hooks + 2 new PDD hooks + nightly) ‖ Phase 3 (permission-scoped
  read endpoints). *Both depend on W2.*
- **Wave 4 (parallel):** Phase 4 (Surface B rewire) ‖ Phase 5 (Surface A panel). *Both depend on
  Phase 3.*

Create tasks with TaskCreate, set dependencies with TaskUpdate (`addBlockedBy`), launch each wave's
tasks as parallel subagents (`subagent_type=general-purpose`), each prompt carrying the *why* + exact
files + the §2 invariants + the corrected predicates.

## 12. Deferred (explicitly out of v1)

`DISPATCH_PENDING` (admin) · ITM action items · MIR-pending + cadence/SLA items (DPR, inventory) ·
acknowledge/snooze · time-buckets (Overdue/Due-Today) · notification-triage (demoting DC/DN pushes to
this queue) · item-level DC_PENDING precision (partial-DC gaps).

## 13. Open questions to confirm while building

- **Dispatch ownership** (for the deferred `DISPATCH_PENDING`): verify whether dispatch is an Admin or
  Procurement action before building that type.
- **Surface A layout:** panel-in-ProjectManager (recommended, §8) vs a dedicated `/action-center`
  route — confirm with the owner during Phase 5.
- **Orphan policy:** is "Admin/PMO see no-PM projects + a nightly warning" sufficient, or should an
  unassigned project hard-block go-live until a PM is assigned?

## 14. Red-team defect ledger (2026-06-22)

Six adversarial attackers vs the live code. Accepted fixes (folded into §3–§9 above):

| Sev | Defect | Fix |
|---|---|---|
| **High** | DC_PENDING keyed on PO status **misses sticky `Partially Dispatched` POs that have deliveries** (false negative — PM never told to file the DC) | DC_PENDING now item-level: "a DN exists" = ∃ item `received_quantity>0`, status-independent |
| **High** | DN_PENDING `received < quantity` ignores the **2.5% / integer tolerance** `calculate_order_status` uses → could disagree with PO status | "fully delivered" now uses the same tolerance rule |
| **High** | DN_PENDING "dispatched qty" ambiguous (`is_dispatched` is a **boolean**, not a qty) | predicate states `is_dispatched==1 AND received < quantity` explicitly |
| **Critical** | **Merged/Cancelled** POs not excluded → phantom rows (esp. via item-level DC test) | explicit live-status allow-list at the PO-load query |
| **Critical** | `frappe.enqueue` without `enqueue_after_commit=True` → reconcile reads **stale, uncommitted** PO state | add `enqueue_after_commit=True` to every hook enqueue |
| **Critical** | Concurrent reconciles (event + nightly) both INSERT same `dedup_key` → **`IntegrityError` aborts** the project | per-project lock + savepoint get-or-create (DuplicateError → re-open) |
| **Critical** | Read endpoints bare whitelist → **cross-project data leak** | permission-scope both via `_get_allowed_projects` |
| **High** | DN `after_delete` recalcs PO status but (today) **doesn't enqueue** reconcile | add the enqueue to `after_delete` |
| **High** | Hooks crash on **blank/legacy** `procurement_order`/`parent_docname` | guard + `try/except` + log; never raise in a save |
| **High** | Cancelled PO is **deleted** in `on_update` → rows reference a gone PO | recompute resolves them (not in desired set); readers tolerate dangling `reference_name` |
| **High** | **Surface A route is a nav-card grid, not a data panel** — scope underestimated | Surface A = a new panel on the existing ProjectManager page |
| **High** | **Orphan**: projects with no assigned PM → rows unseen in Surface A | Surface A is project-access-scoped (Admin/PMO see all) + nightly orphan-warning log |
| **High** | Reconcile **N+1** (per-PO `get_doc`) → nightly timeout at scale | three bulk `get_all` queries + pure-Python predicate eval |
| **High** | Hooks wired before reconciler exists → import-fail saves | build the reconcile module/stub first; enqueue in `try/except` |
| **Med** | `assigned_role` string: `role_profile` value has the **"Profile"** suffix (`"Nirmaan Project Manager Profile"`), the Frappe Role does not | hardcode `ASSIGNED_ROLE_PM = "Nirmaan Project Manager Profile"`; unit-test the filter match |
| **Med** | Test matrix missed merged-PO / ITM-isolation / tolerance / concurrency / orphan cases | §9 expanded |
| **Low** | `deduplicate` only collapses QUEUED/STARTED jobs (post-finish bursts re-enqueue) | accepted — idempotent re-run; "burst collapse" applies to overlapping bursts only |

**Rejected as a defect:** "v2 DN_PENDING contradicts the frontend report's `pending_dn`." This is the
*intended* redefinition (grill decision #7); Surface B is rewired (rollout step 5) to the new table,
retiring the old report-tile meaning. No post-rollout divergence.
