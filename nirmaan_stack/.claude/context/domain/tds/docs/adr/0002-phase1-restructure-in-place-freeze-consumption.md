# Phase 1 restructures the Repository in place and freezes project consumption

Status: accepted

The grouping model (ADR-0001) changes the TDS Repository entry shape from a flat
`(item, make)` to a nested `(TDS Item → members) × make`, which the existing
project-side consumer (item-driven picker, approval-time promotion, report) cannot
read as-is. We split the work into **Phase 1 = master restructure only** (new TDS
Item doctype + member child table, restructured TDS Repository entries, the
two authoring flows, the two-tab Repository UI, the TDS Item detail page, and the
data migration) and **Phase 2 = the group-driven consumption + approval rework**.
For Phase 1 we **restructure the TDS Repository in place** and **freeze new project
TDS assembly** until Phase 2 ships.

## Considered options

- **Flatten read-shim** (expand entries × members back to old flat rows so the
  existing picker keeps working and new TDS Items are immediately consumable) —
  rejected: extra surface to build and the M:N flattening reintroduces the
  item-level ambiguity in the legacy picker.
- **Parallel coexistence** (leave old Repository untouched, build the new
  structure alongside) — rejected: two sources of truth and authored TDS Items
  sit idle/unusable until Phase 2.
- **Restructure in place + freeze** — chosen: one source of truth, no shim,
  smallest Phase 1 surface; acceptable because no project is mid-assembly.

## Consequences

- **New** project TDS assembly is disabled during Phase 1: the project item
  picker (`TdsCreateForm`), the "request new item" path, and the **approval-time
  promotion** that writes old-shape Repository rows (`TDSApprovalDetail`) are all
  gated off (the promotion path would otherwise write to removed fields).
- **Existing** already-approved project TDS stays fully usable: `Project TDS Item
  List` snapshots are self-contained (their own `tds_attachment`), so view and
  report export keep working — only new assembly + approval promotion are frozen.
- The old status/sync patches (`sync_items_to_tds_repository`,
  `backfill_tds_repository_status`) are superseded by the Phase 1 migration.
- Phase 2 owns: group-driven picker (TDS Item + Make), `Project TDS Item List`
  schema changes, group-aware approval/promotion, and the report/print format.

## Addendum — Phase 1 master-UI revision (2026-06)

After the first Phase 1 build (pre-migration), the master-side UX was revised.
Because the migration had **not** yet run, the doctypes existed only as code, so
the renames below are pure code renames (no `rename_doc` patch).

### Doctype renames

- `TDS Item` → **`TDS Items`** (folder `tds_item/` → `tds_items/`, class
  `TDSItem` → `TDSItems`).
- `TDS Item Member` → **`TDS Items Child Table`** (matches the repo's existing
  `… Child Table` convention, e.g. *Commission Report Task Child Table*).
- Unchanged: the `tds_item` Link **fieldname** on `TDS Repository`, and the
  TDS Items autoname `TDS-ITEM-.#####` (cosmetic id prefix kept).

### Grilled UI decisions

- **Detail-page tables are client-side.** The shared server-side DataTable
  backend treats child tables only as *searchable fields of a parent*; a child
  doctype (`TDS Items Child Table`) is not a queryable primary. Per-item member
  and entry sets are small, so both detail tabs use the **client-side** DataTable
  (`data-table.tsx`) fed from the already-loaded doc / one filtered list. The two
  *master* tabs stay server-side (`useServerDataTable`) — they span all items.
- **Clickable counts open quick-peek dialogs**, not navigation. In the master
  "TDS Items" tab the Linked-Item-SKU and Repository-Entries counts each open a
  read-only dialog listing those rows (with an "Open TDS Item →" link). A zero
  count is non-interactive.
- **Work Package is editable even with members.** Editing a TDS Item allows
  changing its WP while keeping members (members carry their own `category` via
  `fetch_from` on the Items master, so they still render). **Consequence:** the
  edit handler must **propagate the new WP to the linked Repository Entries**,
  because `TDS Repository.work_package` is a denormalized `fetch_from` that would
  otherwise stay stale until each entry is re-saved.
- **Members are added via a multi-select staging dialog** (search → stage many →
  commit once), replacing the inline single-select on the detail page.

### Master / detail surface

- Master "TDS Items" tab columns: TDS Item Name (link) · Work Package · **Linked
  Item SKU** (clickable count) · **Repository Entries** (clickable count) ·
  Actions (Edit). The **Categories** column is removed.
- Master tab "Entries" → **"Repository Entries"**; its "Add Entry" button →
  **"Add New Repository Entry"**; the TDS Item column shows the **name only**
  (the `TDS-ITEM-#####` id subtext is dropped); the **"Doc"** column →
  **"Datasheet"**; per-row **Edit** action added (reuses the entry edit dialog).
- Detail page: inline **Edit** (name + WP) in the header; **tabbed** Linked Item
  SKUs / Repository Entries; "Add Entry" → **"Add Repository Entry"**.

### Bug fix

- Work Package was not mouse-selectable in "Add New TDS Item": Radix `Dialog`
  sets `pointer-events: none` on `document.body`, and the `react-select` menu
  portaled to `document.body` inherited it (keyboard worked, mouse did not). Fix:
  add `pointerEvents: "auto"` to the `menuPortal` style on every portaled select
  in these dialogs.
