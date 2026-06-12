# Phase 2 group-driven project consumption

Status: accepted

Phase 1 (ADR-0002) restructured the TDS Repository master into the grouping model
(ADR-0001) and **froze** project consumption + approval behind
`TDS_ASSEMBLY_FROZEN=true`, because the project side still spoke the old flat shape
and the approval path wrote now-removed fields. Phase 2 re-enables consumption
against the new `(TDS Item → members) × make` shape. The decisions below were
grilled on 2026-06-10 and supersede the open questions listed in `phase-1-plan.md`
§P2-1…P2-6.

## Decisions

### Selection unit & picker (P2-1)

- A project consumes by selecting a **TDS Item (group) + Make**. One
  `Project TDS Item List` row = one `(TDS Item, Make)`. The group's member Items
  SKUs ride along as **coverage** (informational), **never** the selection key.
- The picker is a **TDS Item picker** whose fuzzy search matches **both** the TDS
  Item name **and** the member Items SKUs (item name + code). A member-item hit
  **resolves to its parent TDS Item** and adds the *group*, not the bare item.
- Because membership is **many-to-many**, an item that belongs to several groups
  **surfaces each parent group as its own result row**; the user picks the
  intended one. No silent guess, no extra disambiguation dialog.
- The **Make** dropdown lists **only makes that already have a Repository Entry
  (datasheet)** for the chosen group; the row's datasheet = that entry's
  attachment. A needed make with no entry is handled by the request path below.

### Snapshot model — `Project TDS Item List` (P2-2)

- Rows are a **pure, immutable snapshot** — **no live Link** into the master.
  This matches the doctype's existing design (its `tds_item_id`/`tds_item_name`
  are plain `Data`, not Links) and ADR-0002's self-contained-snapshot guarantee
  (an already-approved project TDS report must not mutate when an admin later
  edits/deletes master rows).
- The existing `tds_item_id` Data column is **repurposed to hold the frozen TDS
  Item id** (e.g. `TDS-ITEM-42`) instead of the old Items-SKU id. `tds_item_name`
  (group name), `tds_make`, `tds_attachment`, `tds_work_package` are frozen too.
  **Dedup / approval key = `(tds_item_id, tds_make)`** — exact id match, not the
  fragile name matching Phase 1 set out to kill.
- **Coverage is NOT stored.** It is derived **live** from the frozen `tds_item_id`
  (via `api/tds/members.get_tds_item_members`) only where a requirement asks for
  it. Coverage is informational, not the signed artifact, so live derivation
  (which reflects current master) is acceptable; the *datasheet* stays frozen.
- The report's **"Model No." cell = distinct member categories, comma-joined**
  (derived live), since a group spans categories; a member-less group shows
  nothing there.

### Requests & approval-time promotion (P2-3)

- The project-side **request + approval-time promotion path survives**, made
  group-aware (rejected: a fully Admin-curated master that blocks project teams,
  who hold the vendor datasheets, behind admin authoring).
- A project files a **"New" request** proposing: group (an **existing** TDS Item
  OR a **new** group label) + make (**full Makelist, no custom-make creation**) +
  datasheet PDF (+ optional description / BOQ line item).
- On approval the master is **written/promoted**:
  - existing group, missing make → new `(TDS Item, Make)` Repository Entry;
  - brand-new group → new **member-less TDS Item** + its entry;
  - both **born Verified**; the project row snapshots the promoted id/name/make/
    attachment.
- **Project-only customs (`PCUS-`) are RETIRED.** Every approved new-group request
  enters the **shared** master as a member-less TDS Item — **one** custom model
  (rejected: keeping a project-only escape hatch + the PCUS allocator + two custom
  concepts). Admins may later enrich a promoted custom group with members in the
  master UI. *Consequence:* genuine project one-offs do land in the shared master;
  the Admin-only approval gate (below) is the control against pollution.

### Status & verification (P2-5)

- Project row statuses are unchanged: `New | Pending | Approved | Rejected`.
  Picking an existing entry → `Pending`; filing a request → `New`.
- Approval sets the row `Approved` **and** the master entry `Verified`
  (verification-on-approval, keyed on the entry). Master `status`
  (Verified / Not Verified) remains distinct from the per-project submittal status:
  every project selection needs project-level approval regardless of the master
  entry's verification state.
- **All TDS approval is Admin-only** (both pick-only and promoting approvals),
  consistent with Phase 1's Admin-only master authoring. **Project Lead loses the
  pre-freeze approve right** (rejected: split PL-pick / Admin-promote authority —
  too much nuance; rejected: keep Admin+PL for all — lets PL write the shared
  master indirectly).

### Migration & display-field sync

- **Existing `Project TDS Item List` rows are left untouched.** They are immutable
  snapshots carrying their own name/make/attachment/category and render from those
  fields; only **new** rows use the new `tds_item_id` (= TDS Item id) semantics.
  No project-row migration (rejected: backfilling old `tds_item_id` →
  TDS Item id — M:N has no single target, retired `PCUS-` has no target, and the
  rows are terminal snapshots that already render correctly). Assumes the
  Phase 1 freeze drained in-flight Pending/New rows before the master migration.
- **P2-6 re-introduced now:** an `Items.on_update` hook refreshes
  `item_name`/`category` on `TDS Items Child Table` rows when the underlying Items
  SKU is renamed/recategorized (the old hook was deleted in Phase 1 because it
  wrote removed TDS Repository columns; the new one targets the member child rows).

### Editing

- **Two reworked edit modals**, matched to row kind: the picked-row editor re-runs
  the group+make picker (swap TDS Item / Make); the "New"-request editor edits the
  proposed label / make / datasheet / BOQ. (Rejected: one unified dialog — more
  internal branching for two genuinely different shapes.)

## Consequences

- `TDS_ASSEMBLY_FROZEN` flips to **`false`** — the single switch that re-enables
  both gated screens (`TdsCreateForm`, `TDSApprovalDetail`).
- The frozen approval code's writes of removed fields (`tds_item_id` /
  `tds_item_name` / `category` on `TDS Repository`) are replaced by writes keyed on
  `tds_item` (Link) + `make`, matching the restructured entry shape and its
  `(tds_item, make)` uniqueness validate.
- `allocate_pcus` and the project-only-custom code paths are removed.
- The print format (`"Project TDS Report"`) keeps its 1-page-per-row +
  interleaved-attachment structure; only the per-row field bindings change
  (Submittal Name = group name, Model No. = joined categories).
- A new whitelisted picker API is needed: search over TDS Items + their member
  SKUs returning group results (the member-name → parent-group resolution and the
  M:N fan-out happen server-side, perm-safe via `frappe.get_all` like
  `api/tds/members.py`).
- **Admin-gate detection (implementation note):** the server-side Admin-only check
  in `api/tds/approve.py` identifies admins by **role profile** —
  `frappe.db.get_value("Nirmaan Users", user, "role_profile") == "Nirmaan Admin
  Profile"` (or the Administrator superuser) — **NOT** `"Nirmaan Admin Profile" in
  frappe.get_roles(user)`. "Nirmaan Admin Profile" is a Role *Profile* bundling
  roles (System Manager, Nirmaan Project Lead, …); its name never appears in
  `get_roles()`, so a get_roles check rejects every real non-superuser admin. This
  matches the frontend `useUserData().role` and the canonical backend pattern
  (`api/sidebar_counts.py`, `delivery_notes/_permission_utils.py`). Caught only by
  testing as a real non-superuser admin. (Note: `api/design_tracker/
  bulk_update_task_status.py` carries the same latent get_roles bug.)
