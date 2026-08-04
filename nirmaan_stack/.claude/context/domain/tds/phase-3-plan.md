# Phase 3 — Item-side TDS linking (N:1, item-owned membership)

> Implements **ADR-0004**. Membership flips from M:N owned by the TDS Item (a
> `members` child table) to **N:1 owned by the Item** (a single `linked_tds_item`
> Link on `Items`). Stakeholders tag an item with its one TDS group from the
> **Items side**; the TDS-side dialog stays as a second writer into the same store.
> Grilled 2026-06-17. Glossary updated in `CONTEXT.md`; ADR-0001 membership clause
> superseded.

---

## Execution Strategy

Execute via the Plan-to-Parallel workflow (see CLAUDE.md):

- **Wave 1 (foundational, single task):** Task 1 — adds the `linked_tds_item`
  field everything else references.
- **Wave 2 (parallel, after Wave 1):** Tasks 2, 3, 4 — all backend, each depends
  only on the field from Wave 1, independent of one another.
- **Wave 3 (parallel, after Wave 2):** Tasks 5, 6, 7, 8 — all frontend, depend on
  the backend field + endpoints from Waves 1–2.

Create all tasks with `TaskCreate`, set dependencies with `TaskUpdate`
(`addBlockedBy`/`addBlocks`), then launch each wave's tasks as parallel subagents
(`Task`, `subagent_type=general-purpose`). Every subagent prompt must include the
**why** (this file + ADR-0004), the exact files, and the locked constraints below.

```
Wave 1:  Task 1 (Items field + controller + dead-code cleanup)
              │
Wave 2:  ┌────┼─────────┬──────────────┐
         Task 2       Task 3         Task 4
       (readers)   (endpoints)    (migration)
              │        │              │
Wave 3:  ┌────┴───┬────┴────┬─────────┴──┐
         Task 5  Task 6   Task 7       Task 8
      (Items list)(EditDlg)(TDS dialog)(project picker)
```

---

## Locked decisions (do not re-litigate — see ADR-0004)

1. **Source of truth = `Items.linked_tds_item`** (single `Link → TDS Items`,
   optional). Members of a group = `Items WHERE linked_tds_item = <group>`,
   derived live. **N:1** — one TDS Item per item.
2. **Two writers, one store (A3):** the Items list/edit form AND the TDS Item
   detail page's member dialog (repurposed to set `linked_tds_item`).
3. **Reassignment = warn + confirm move.** Both UIs show the current linkage
   *inline in the picker option* (amber "linked to <group>" tag) and confirm
   before overwriting. Remove = clear the link.
4. **WP invariant hard-enforced.** `Items.category → Category.work_package` must
   equal the target group's `work_package`. Item-side group dropdown filtered to
   matching-WP groups; link field **disabled** when the item has no resolvable WP.
   Backend `validate` re-checks (defense behind the UI filter).
5. **Permissions:** Items-side field = **Admin + PMO Executive**; TDS-side dialog
   stays **Admin-only**. (Relaxes ADR-0003 for membership only; PMO still cannot
   approve TDS.)
6. **Project picker searches group name only.** Member-SKU search archived behind
   a default-off `include_member_matches` flag, ported to N:1.
7. **`TDS Items Child Table` retired as a writer**, left physically **dormant**
   this cycle (no drop). Orphan `tds_item_id`/`tds_item_name`/`category` columns on
   `tabTDS Repository` **are** dropped in this migration.

---

## Tasks

### Task 1 — Items field + controller + dead-code cleanup  *(Wave 1)*
- `doctype/items/items.json`: add `linked_tds_item` (`Link`, options `TDS Items`,
  optional, in an existing section).
- `doctype/items/items.py` (`Items` class):
  - `validate`: if `linked_tds_item` set, derive the item's WP
    (`category → Category.work_package`) and **throw** if it ≠ the linked group's
    `work_package`. Throw if the item has no resolvable WP.
  - **Delete** the dead TDS-Repository sync block (lines ~38–65, the
    `tds_item_id` filter + the trailing NOTE that lies about it being removed).
    Keep `_propagate_billing_status`.
- `integrations/controllers/items.py`: retire the now-vestigial `on_update`
  child-row sync (members are derived from `Items` → always live). Keep
  `after_insert`. Adjust `hooks.py` if the hook is unregistered.
- `types/NirmaanStack/Items.ts`: add `linked_tds_item?: string`.

### Task 2 — Re-point readers to derive from `Items`  *(Wave 2, dep: T1)*
- `api/tds/members.py`: `get_tds_item_members`, `get_group_category`,
  `get_tds_member_index` → query `Items` by `linked_tds_item` instead of the child
  table. Counts/categories derived from the matching Items.
- `api/tds/picker.py`: `search_tds_items` active path = `tds_item_name` (+ WP)
  only; keep the member-matching branch behind `include_member_matches=False`,
  **ported to N:1** (search Items by code/name where `linked_tds_item` set, group
  by `linked_tds_item`), with a header comment citing ADR-0004.

### Task 3 — Endpoints for the item-side UI  *(Wave 2, dep: T1)*
- WP-filtered TDS-Item search for the link dropdown: reuse
  `search_tds_items(query, work_package, ...)` (group-name path) — confirm it
  serves the dropdown; add a thin wrapper only if needed.
- **Batched current-linkage lookup**: given a set of item ids (or a WP), return
  `{item: {linked_tds_item, group_name}}` in one query, for the amber "linked to X"
  option tags (avoid N+1 — mirror `get_tds_member_index`).

### Task 4 — Migration patch  *(Wave 2, dep: T1)*
- `patches/v3_0/backfill_item_linked_tds_item.py` (register in `patches.txt`):
  - For each member child row, set `Items.linked_tds_item = parent` (one per item).
  - **Tie-break the 2 multi-group items** (`ITEM-000134`, `ITEM-001177`): keep the
    specific self-named group, drop the "Raceway & Cable Tray" membership.
  - **Drop orphan columns** `tds_item_id`, `tds_item_name`, `category` from
    `tabTDS Repository` (raw SQL, double-quoted table name; PostgreSQL).
  - Do **not** drop `TDS Items Child Table` (dormant).

### Task 5 — Items list: column + facet  *(Wave 3, dep: T2/T3)*
- `pages/Items/itemsPage.tsx`: add **"Linked TDS Item"** column (group name or
  "—") + a **facet filter** (Linked / Unlinked / by specific group). Inline link
  affordance Admin+PMO.

### Task 6 — EditItemDialog link field  *(Wave 3, dep: T2/T3)*
- `pages/Items/components/EditItemDialog.tsx`: optional `linked_tds_item` field —
  group dropdown filtered to the item's WP, shows current linkage, **disabled** if
  no resolvable WP, editable Admin+PMO. Warn+confirm inline notice on reassignment.

### Task 7 — TDS detail member dialog repoint  *(Wave 3, dep: T2/T3)*
- `pages/tds/components/MultiAddMembersDialog.tsx` + `pages/tds/TDSItemDetail.tsx`
  (+ `hooks/useTDSItemOptions.ts`): commit **sets `linked_tds_item`** on staged
  items (Admin-only); options carry the current-linkage tag; **warn+confirm** on
  move; remove = clear the link; the "Linked Item SKUs" list becomes derived.

### Task 8 — Project picker group-name-only  *(Wave 3, dep: T2)*
- `pages/projects/TDSRepository/components/TdsCreateForm.tsx` +
  `RequestTdsItemDialog.tsx`: group-name-only search; drop the "contains [member]"
  subtitle / `matched_member` usage.

---

## Verification
- `bench --site localhost migrate` clean (fresh DB + this DB); backfill counts
  match the audit (404 distinct member items → 404 linked items; 2 tie-broken).
- **Test as a real non-superuser Admin AND a PMO** (ADR-0003 caveat: admin check
  is by `role_profile`, not `get_roles`). Confirm PMO can link from Items, cannot
  from the TDS master page; cannot approve TDS.
- `tsc` clean (esbuild skips type-check); browser E2E: link from Items list + edit
  dialog, reassign warning, WP filtering, disabled-when-no-WP, derived members on
  the TDS detail page, project picker returns groups by name.

## Risks / watch-items
- The WP-derivation join (`Items → Category → work_package`) must handle items with
  a null/legacy category gracefully (→ field disabled, never a crash).
- Two writers + N:1: confirm reassignment from one surface is reflected on the
  other (no caching staleness) — both derive from `Items`, so invalidate the
  relevant SWR keys after a link write.
- Orphan-column drop is irreversible; verify nothing reads them first (audit
  confirmed only the dead `on_update` block did, removed in Task 1).

---

## AS BUILT — `feature/tds-phase-3`, 2026-08-03

Re-implemented on `develop` (NOT cherry-picked — see ADR-0004 Amendment A for
why, and for the two owner rulings and the architectural re-expression).

### What shipped, by file

**Backend**
- `doctype/items/items.json` — `linked_tds_item` Link → `TDS Items`
- `doctype/items/items.py` — `_validate_linked_tds_item()` (WP invariant); dead
  `on_update` TDS-Repository block **and** its self-contradicting NOTE deleted
- `integrations/controllers/items.py` + `hooks.py` — `on_update` retired/unregistered
- `api/tds/members.py` — all three readers derive from `Items.linked_tds_item`
- `api/tds/picker.py` — group-name-only; member search archived behind
  default-off `include_member_matches`, ported to N:1
- `api/tds/tds_report.py` — **added to scope mid-slice**: a live child-table
  reader the original task list missed
- `api/tds/linking.py` — NEW: `get_items_linkage` / `set_items_tds_link` /
  `clear_items_tds_link`
- `api/data-table.py`, `api/data_table/facets.py`, `api/data_table/utils.py` —
  blank-bucket support (`include_blank_bucket` → `NOT_SET_FACET_VALUE` → rewritten
  to `is not set`)
- `api/data_table/constants.py` — `LINK_FIELD_MAP` entry so group ids resolve to
  names server-side
- `patches/v3_0/backfill_item_linked_tds_item.py` + `patches.txt` (lands in
  `[post_model_sync]`, so the column exists when it runs)

**Frontend**
- `facetConfig.ts` — `NOT_SET_FACET_VALUE` + `includeBlankBucket` / `blankLabel`
- `SelfFetchingFacetFilter.tsx` — threads the flag; maps the sentinel to `blankLabel`
- `useFacetValues.ts` — `includeBlankBucket` → payload **and the debounce dep array**
- `itemsPage.tsx` — Linked TDS Item column + "Not Linked" facet (every existing
  `meta.facet` preserved)
- `Items/components/EditItemDialog.tsx` — `canLinkTds` link field, WP-filtered,
  disabled without a resolvable WP, inline move/unlink warnings
- `tds/components/ItemsSKUTab.tsx` — NEW third tab, on the self-fetching path
- `tds/TDSRepositoryMaster.tsx` — `skus` tab
- `tds/TDSItemDetail.tsx` — members DERIVED via `get_tds_item_members`; add/remove
  go through `linking.py` with partial-outcome reporting
- `TdsCreateForm.tsx` / `RequestTdsItemDialog.tsx` — `matched_member` subtitle gone

### Verification actually run
- `python3 -m py_compile` clean on every touched module
- **Read-only dry run of the patch against the live dev DB**: 354 membership rows
  → 353 linked, 1 WP violation skipped (`ITEM-001431`), gate not triggered
- `npx tsc --noEmit`: 3769 errors before and after — **zero new**, none in any
  touched file (the repo has a large pre-existing tsc debt; the build is esbuild)
- `yarn build` ✓ 55s · `yarn test` ✓ **1549/1549** across 57 files

### NOT done — deliberately
- **`bench migrate` has NOT been run.** The column does not exist in any DB yet.
- **Browser E2E not run** (see the Verification section above for the journeys).
- **Production audits owed** before the patch runs there.
- Two out-of-scope files still read the now-always-null `matched_member`
  (`ProjectEditTDSItemModal.tsx`, `EditRequestItemModal.tsx`). They degrade to an
  empty string — harmless, but they are residue worth a follow-up.

---

## AS BUILT — `tds/phase3-fixs`, 2026-08-04

Six commits on top of the Phase-3 as-built above. Decision-level changes are in
**ADR-0004 Amendment B**; this is the file-level record.

| Commit | What |
|---|---|
| `eb7e15f3` | Repository Entries: facet by TDS Item NAME; label the text search "TDS Item ID" |
| `c9faaa24` | Wizard members land on the real store; picker warns before a move; case-insensitive group names |
| `053a7702` | Move confirmation before members are taken from another group |
| `e0152184` | Show the real failure reason; name the request modes fully |
| `70fbb44e` | Delete TDS Item unlinks members first, and says why when it cannot |
| `3d6542a7` | `members` display mirror + read indexes + two patches |

### The bug that started it

`AddTDSItemWizard` posted `payload.members` into `TDS Items Child Table` — retired
as a writer at ADR-0004 and read by NOTHING. The save succeeded, the toast said
success, and the members were invisible forever. **Four groups created that way on
2026-08-03** (`TDS-ITEM-00004 / 00297 / 00301 / 00333`) had child rows and zero
real members. Members now go through `linking.set_items_tds_link`.

`ITEM-002184` ('DX Inverter (3 Star) - 1.5TR Hi-Wall', from `TDS-ITEM-00333`) is
**still unlinked** — the one stranded item never resolved.

### Membership moves are disclosed, not silent

Membership is N:1, so adding an already-linked SKU MOVES it. Three surfaces now
say so: amber `· linked to <group>` in the picker, `will move out of <group>` on
the staged row, and a **blocking confirmation** listing each mover as
`from → to` (red losing, green gaining). Both `AddTDSItemWizard` and
`MultiAddMembersDialog` — the latter needed a new `groupName` prop, because it
only received `workPackage` and literally could not say where items were going.

⚠️ The move is **unrecorded**: `set_items_tds_link` writes with
`update_modified=False`, so no Version row and no `modified` bump. That is *why*
a confirmation is warranted rather than a passive label — afterwards there is no
trail back.

### Group names are unique case- and whitespace-insensitively

`validate_unique_group` used `frappe.db.exists` with `=`, and PostgreSQL `=` on
varchar is case-sensitive, so `'Y Strainer'`, `'Y strainer'` and `'y strainer'`
coexisted under one WP. Now raw SQL on `lower(trim(...))` (the ORM cannot express
it), plus `normalize_name` to strip padding. **Case is preserved** — this is a
human display label, and rewriting it would desync every project's frozen
`tds_item_name` snapshot. The one existing duplicate (`TDS-ITEM-00353`, 0
members / 0 entries / 0 project rows) was deleted first; without that, the next
save of either twin would have started failing. All 352 existing groups dry-ran
the new check with 0 failures.

It catches case and spacing only — **not typos**. `'Y Startiner'` still creates a
separate group.

### Delete TDS Item

Frappe refuses to delete a Link target, so a group with members failed with a raw
`LinkExistsError`. Delete now unlinks members itself, then deletes, after saying
so in the confirm dialog. Repository Entries still hard-block (they hold the
signed datasheets); the disabled button's tooltip names the blocker and count.

### `validate_no_duplicate_members` removed

It guarded a many-to-many store that no longer exists. Under N:1 a duplicate is
impossible by construction, and the mirror derives from a distinct set. Left in
place it read as a live guard over real membership — the same misreading that let
the retired child table keep being written.

### Verification actually run

- **20 tests**, `api/tds/test_members_mirror.py` — rebuild/diff/idempotency,
  every trigger, recursion guard (counted, not reasoned), `read_only`, index
  presence, and the store-not-mirror read. ⚠️ Runs against the LIVE site DB
  (endpoints commit, so per-test rollback does not isolate) — fixtures are
  hash-named `ZZTEST…` and purged; verified 0 residue afterwards.
- **Real `bench migrate`** from a production-like state (mirror empty, both
  indexes dropped): 345 rows across 353 groups in 0.7s, 0 missing, 0 unbacked,
  0 mismatched, both patches in Patch Log, `read_only` applied by doctype sync.
- Index plan flip verified: `Seq Scan` (cost 131.20) → `Index Scan` (cost 19.80);
  all five TDS read surfaces returned byte-identical payloads with and without.

### NOT done — deliberately

- **`patches.txt` is wired, but production has not migrated.** Run `dry_run()`
  there first: read `mirror rows MISSING` and `legacy rows to DISCARD`.
- The four stranded groups' orphan child rows were **consumed by the dev
  backfill** — that evidence now exists only in ADR-0004 Amendment B and here.
- ~8 other TDS dialogs still surface `e?.message` rather than `getFrappeError`.
- `Items.item_name`'s declared index still does not exist (name collision).
