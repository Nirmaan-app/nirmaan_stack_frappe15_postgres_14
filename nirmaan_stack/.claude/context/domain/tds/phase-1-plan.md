# TDS Repository Restructure — Phase 1 Implementation Plan

> Scope: master-side restructure only. Project consumption + approval are frozen
> (new assembly only) until Phase 2. See `docs/adr/0001`, `docs/adr/0002`, and
> `CONTEXT.md` for the model and decisions.

## Execution Strategy

Execute via the Plan-to-Parallel workflow (see `~/.claude/CLAUDE.md`):
- **Wave 1 (parallel):** T1 doctypes (TDS Item + TDS Item Member), T2 TDS
  Repository schema change, T3 TS types scaffold. *(no deps)*
- **Wave 2 (after Wave 1):** T4 migration patch (deps T1, T2), T5 Flow ① wizard
  (deps T1), T6 Flow ② Add-Entry (deps T1, T2).
- **Wave 3 (after Wave 2):** T7 two-tab Repository master (deps T5, T6), T8 TDS
  Item detail page (deps T1, T2, T6), T9 freeze project consumption (deps T2).
- **Wave 4 (after Wave 3):** T10 migration dry-run + manual flow verification.

Create tasks with TaskCreate, set deps with TaskUpdate, launch each wave as
parallel general-purpose subagents.

---

## Backend

### T1 — New doctypes
**`TDS Item`** (grouping, `nirmaan_stack/nirmaan_stack/doctype/tds_item/`)
- `tds_item_name` (Data, reqd) — human label, e.g. "Modular Switches".
- `work_package` (Link → Procurement Packages, reqd).
- `description` (Text, optional) — group-level note.
- `members` (Table → TDS Item Member) — **optional**.
- autoname: `TDS-ITEM-.#####`.
- `validate`: enforce unique `(work_package, tds_item_name)`; reject duplicate
  `item` rows within `members` (M:N *across* TDS Items is allowed — no cross-parent
  uniqueness check).
- **Custom items**: a TDS Item with **zero members** *is* a custom item. **No
  `is_custom` flag** (inferred from member count) and **no `category` field** on
  the doctype (custom = WP + label only; normal-group category derives from
  members). The Items master is **never** written to for customs.

**`TDS Item Member`** (child, `is_child_table: 1`)
- `item` (Link → Items, reqd), `item_name` (fetch `item.item_name`),
  `category` (fetch `item.category`).

### T2 — Restructure `TDS Repository`
- Add `tds_item` (Link → TDS Item, reqd).
- Add `work_package` as `fetch_from: tds_item.work_package` (keeps WP filtering).
- Keep `make` (Data/Makelist), `tds_attachment` (Attach), `status`
  (Select Verified/Not Verified), `description` (optional make-specific note).
- Remove item-level fields: `tds_item_id`, `tds_item_name`, `category`.
- `validate`: replace old `(wp, category, item, make)` check with unique
  `(tds_item, make)`.
- Remove `before_insert` `CUS-` generation (custom items now live in Items master).
- **Discovered during build — `Items.on_update()` hook removed.** The Items
  controller had an `on_update` hook whose *only* job was to sync
  `item_name`/`category` into TDS Repository rows (filtering on `tds_item_id`,
  writing `tds_item_name`/`category`). All three are removed fields now, so the
  hook would raise on every Items rename/recategorize. It was deleted (those
  display values now live on `TDS Item Member` rows via `fetch_from`). Keeping
  member display fields fresh on Items edits is **Phase 2** (see P2-6).

### T4 — Migration patch (`patches/v3_x/restructure_tds_repository_to_tds_items.py`)
Idempotent / re-run safe. Expand-contract within the patch. Group existing repo
rows by their `tds_item_id`; for each distinct item create one `TDS Item`:
- **Standard item** (`tds_item_id` is an Items-master row) → single-member TDS
  Item (label = `tds_item_name`, `work_package` from Items truth, member = the
  item).
- **`CUS-` item** → **member-less** TDS Item (label = `tds_item_name`,
  `work_package` from the row). **No Items-master row created**, no marker, no
  category carried (custom TDS Items have no category).
- Dedupe TDS Items by `(work_package, tds_item_name)`.

Then, for each old row → create/repoint a `TDS Repository` entry (`tds_item`,
`make`, `tds_attachment`, `status`); dedupe `(tds_item, make)`. Finally clear the
removed legacy fields. Register in `patches.txt`; supersede
`sync_items_to_tds_repository` + `backfill_tds_repository_status`.

---

## Frontend

### T5 — Flow ① wizard "Add New TDS Item" (Admin-only)
- Mode toggle: **Normal** | **Custom**.
- **Normal**: Step 1 `tds_item_name` + `work_package`; Step 2 members —
  `FuzzySearchSelect` over Items scoped to the WP (cross-category), multi-add into
  a members table (add/remove); Step 3 review → create `TDS Item`.
- **Custom**: `tds_item_name` + `work_package` only, **no member step, no
  category** → creates a member-less TDS Item.
- Reuses patterns from `useTDSItemOptions` (WP→categories→items).

### T6 — Flow ② "Add Entry" (Admin-only)
- Dialog: pick `TDS Item` (fuzzy) → `make` (**full Makelist; do NOT allow
  creating new makes — remove the "+ Others" custom-make path**) +
  `tds_attachment` (reqd PDF) + `status` → create `TDS Repository` entry.
  Mirrors today's `AddTDSItemDialog` minus the item link.

### T7 — Two-tab Repository master (`TDSRepositoryMaster.tsx`)
- **TDS Items** tab: groups (label, WP, member count, entry count, member
  categories); row → detail; "Add New TDS Item" (T5).
- **Entries** tab: entries (TDS Item label, WP, make, status, doc); **Category
  facet derived from members**; "Add Entry" (T6).

### T8 — TDS Item detail page (Admin-gated actions)
- Header: label, WP, id, member/entry counts.
- Members section: table + add/remove.
- Entries section: table (make, attachment, status) + add (T6) / edit / delete.
- Delete TDS Item: blocked while entries exist. Consolidation is manual.

### T9 — Freeze project consumption
- **Pre-migration ops step**: drain all in-flight pending requests (approve/reject)
  under the OLD flow *before* running T4.
- Disable `TdsCreateForm` "Add item" + "Send for approval" + "Request New Item".
- Make `TDSApprovalDetail` **read-only** during the freeze (no approve/reject; the
  approval-time repo-promotion that writes removed fields is fully gated off).
- **Keep** `TDSRepositoryView` history view + report export working.
- Info banner: "TDS assembly temporarily disabled during migration."

### T3 — Types
- New TS types: `TDSItem` (group) + `TDSItemMember`; update Repository-entry type.

---

## Verification (T10)
- Migration dry-run on a DB copy: entries preserved, statuses carried, `CUS-`
  promoted with marker, single-member groups created, no `(tds_item, make)` dupes.
- Manual: wizard, add-entry, detail edit/delete, two-tab facets, freeze banner,
  existing report export still works.

---

## Phase 2 (deferred — not built in Phase 1, listed here for one source of truth)

Unblocks project consumption against the new group structure once Phase 1 ships.

- **P2-1 — Group-driven picker.** Rework `TdsCreateForm` so a project selects a
  **TDS Item + Make** (one Repository Entry), not a bare item. Member Items SKUs
  ride along as coverage (informational).
- **P2-2 — `Project TDS Item List` schema.** Add a `tds_item` reference (the
  selected group) + capture coverage; reconcile with the existing denormalized
  snapshot fields. Decide what the snapshot stores vs. references.
- **P2-3 — Group-aware approval / promotion.** Replace the old item-level
  promotion in `TDSApprovalDetail.handleApprove`. Project-only customs become
  **member-less TDS Items** (consistent with Phase 1's custom model); standard
  selections link to existing Repository entries. Re-enable approve/reject.
- **P2-4 — Report / print format.** Update `Project TDS Report` (and
  `tds_report.py` interleave-merge) to render **group + coverage items**, one
  datasheet per selected TDS Item + Make.
- **P2-5 — Verification automation.** Re-introduce auto-verify-on-approval at the
  entry level (set during Phase 1 manually).
- **P2-6 — TDS Item Member display-field sync.** Optionally re-introduce an
  `Items.on_update`-style sync (removed in Phase 1) that refreshes
  `item_name`/`category` on `TDS Item Member` rows when the underlying Items SKU
  is renamed/recategorized. Members carry these as `fetch_from`, which only
  repopulates on parent save — so existing member rows go stale until edited.

## Resolved during grilling (no longer open)
- Make source = full Makelist; **no new-make creation** (T6).
- Custom items = **member-less TDS Items**; **no Items-master promotion**, no
  marker, no category (T1/T4).
- Approval during freeze = **drain pending first, then read-only** (T9).
