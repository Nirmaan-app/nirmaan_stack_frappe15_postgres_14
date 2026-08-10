# Membership is N:1, owned by the Item (supersedes ADR-0001's M:N)

Status: accepted (supersedes ADR-0001)

ADR-0001 chose **many-to-many** membership owned by the TDS Item (a `members`
child table on `TDS Items`), on the rationale that "a generic catalog item can
legitimately belong to several spec groups." A live-data audit (2026-06-17)
contradicts that premise: of **414** TDS Items and **404** distinct member items,
the ratio is **~1.007 members per group**, and only **2** items belong to more
than one group — both data-entry noise (an item in a group named after itself
*and* a catch-all "Raceway & Cable Tray"). The M:N capability was speculative
generality carrying no real data.

Stakeholders now want to associate items **from the Items side** — open an item,
tag it with its one TDS group ("this item's datasheet group") — with **one TDS
Item per item**. That is N:1 membership owned by the *item*, expressed as a single
`linked_tds_item` Link on `Items`, not a child table on the group.

## Considered options

- **Keep the M:N child table as the store; add the item-side field as a mirror** —
  rejected: two writable representations of one relationship drift; a single Link
  can't even represent the M:N it mirrors.
- **`Items.linked_tds_item` (single Link) as the sole store; derive members** —
  chosen: one source of truth, enforces "one TDS Item per item" in the data model
  (not by convention), and collapses the picker's member fan-out.
- **Add an independent field with no sync** — rejected: consumption would ignore
  the new field entirely.

## Decision

- `Items.linked_tds_item` (Link → `TDS Items`) is the **sole** membership store.
  A group's members = `Items WHERE linked_tds_item = <group>` (derived live).
- **Two writer surfaces, one store** (A3): the Items list/edit form *and* the TDS
  Item detail page. The detail page's existing "Add Member Items" dialog is
  repurposed to **set `linked_tds_item`** on the staged items rather than write a
  child table; removing a member **clears** the link. Both surfaces can reassign.
- **WP invariant hard-enforced.** An item's WP (`Items.category → Category.
  work_package`) must equal the target group's `work_package`; the item-side group
  dropdown is filtered to matching-WP groups, and the link field is **disabled**
  for an item with no resolvable WP. (Mirrors the TDS-side dialog, which already
  scopes candidate items to the group's WP.)
- **Reassignment is a warn-and-confirm move.** Tagging an already-linked item
  moves it; both UIs surface the current linkage *inline in the picker option*
  (an amber "linked to <group>" tag) and confirm before overwriting. No silent
  member theft — important precisely because there are two entry points.
- **Permissions are asymmetric by surface.** The **Items-side** link field is
  **Admin + PMO Executive** (matching who can already edit Items). The **TDS-side**
  member dialog stays **Admin-only** (it lives on the Admin-only TDS master page).
  This deliberately **relaxes ADR-0003's "all TDS master authoring is Admin-only"**
  for the membership dimension only — justified because PMO already "mirrors Admin
  except *approvals*," and membership authoring is not approval. PMO still cannot
  approve TDS or author groups/entries.
- **Project picker searches group name only** (stakeholder request); the member-SKU
  search is preserved behind a default-off `include_member_matches` flag, ported to
  the N:1 model so it works if revived.

## Consequences

- The picker's M:N member fan-out (ADR-0003: "one item surfaces each parent group
  as its own result row") **collapses to one group per item** — a simplification.
- `api/tds/members.py` (`get_tds_item_members`, `get_group_category`,
  `get_tds_member_index`) and `api/tds/picker.py` (`search_tds_items`) re-point
  from the `TDS Items Child Table` rows to querying `Items.linked_tds_item`.
- A migration backfills `Items.linked_tds_item` from the existing member child
  rows; the 2 multi-group items keep their specific (self-named) group and drop
  the catch-all membership.
- The `TDS Items Child Table` doctype/data is **retired as a writer** but left
  physically dormant this cycle (dropped in a later cleanup) — no destructive DB
  change now.
- Adjacent cleanup: the dead `Items.on_update` block in `doctype/items/items.py`
  (writes the removed `tds_item_id`/`tds_item_name`/`category` columns on
  `TDS Repository`) and those orphan columns are removed — they survive today only
  because Frappe never dropped the columns on migrate.
- Member-less ("custom") TDS Items are unaffected — a custom is simply a group
  with zero items linked to it.

---

## Amendment A — as built on `develop` (2026-08-03)

ADR-0004 was authored on the abandoned `tds-changes` branch and never merged;
`develop` moved ~2,900 commits in the meantime. It was re-implemented (not
cherry-picked) on `feature/tds-phase-3`. The DECISIONS above are unchanged. What
follows is what the re-implementation had to do differently, and two owner
rulings added at build time.

**Re-expressed on the self-fetching facet architecture.** `develop` migrated the
Items page and the TDS master to ADR-0010 Option 2 (`meta.facet` +
`facetDoctype` + `SelfFetchingFacetFilter`) after this ADR was written. The
original frontend used the legacy page-level `useFacetValues` +
`facetFilterOptions` path and would have silently REVERTED that migration. The
blank-bucket capability therefore travels through the declaration instead:
`FacetDeclaration.includeBlankBucket` / `.blankLabel` → `SelfFetchingFacetFilter`
→ `useFacetValues`. It sits on the DECLARATION, not `FacetOverride`, because a
field either has a meaningful "unset" state or it does not — every page
rendering that column wants the same answer.

**Group labels resolve server-side.** `TDS Items.get_title_field()` returns
`"name"`, which `facets.py` deliberately treats as unresolvable, so the facet
would have shown raw `TDS-ITEM-#####` ids. Rather than re-map ids client-side
per surface (the original did, and had to regex the count suffix back out of the
label), one `LINK_FIELD_MAP` entry for `linked_tds_item` fixes every surface at
once.

**The facet cache is gone.** `develop` removed the `facet_5.x` cache from
`facets.py`; the original's cache-key bump was dropped as obsolete rather than
re-introducing a cache the codebase had deliberately deleted.

**Owner ruling 1 — the Items-side write is Admin + PMO Executive.** Confirmed
2026-08-03 against `develop`'s newer role model (`1abe1992`), which had drawn the
line at "master authoring is Admin-only, PMO is project-level". Membership
authoring is not approval, and `itemsPage`'s existing `canManageItems` was
already exactly this pair. The TDS master member dialog stays Admin-only.

**Owner ruling 2 — the backfill patch GATES and enforces the WP invariant.** Two
defects in the original patch, both invisible until production:

1. It logged multi-group tie-breaks and proceeded. The ladder ends in
   `sorted(candidates)[0]` — "lowest group id", deterministic but arbitrary as a
   business decision — and the discarded membership is invisible afterwards. The
   patch now ABORTS above `_MAX_EXPECTED_MULTI_GROUP`.
2. It wrote links with `frappe.db.set_value`, which **bypasses
   `Items.validate`** — so it could plant a WP-violating link that would not fail
   at migrate time but would make the item **unsaveable** the next time anyone
   edited it. Violations are now SKIPPED and reported; the item is left unlinked
   and is re-taggable from the Items page in seconds.

**Missed-reader correction.** `api/tds/tds_report.py` was a live reader of the
child table (deriving the PDF's member categories) that the original task list
did not name. Left alone it would have served a frozen snapshot of the old model
the moment the writer was retired.

**Audit numbers are re-measured, and the June figures are stale.** Dev bench
2026-08-03: 380 groups, 354 membership rows, 354 distinct member items, **0
multi-group**, **1 WP violation**. The June 2026 audit (414 / 404 / 2) describes
a different dataset. ⚠️ **Neither says anything about production — re-run both
audits there before the patch runs.**

---

## Amendment B — the `members` child table returns as a DISPLAY MIRROR (2026-08-04)

**Owner decision.** The Desk `Members` grid on `TDS Items` had been empty since
this ADR retired the child table as a writer, and a group with eight linked SKUs
showed "No Data". The owner asked for it to show members again, **without**
moving membership back off `Items.linked_tds_item`.

**The decision above is UNCHANGED.** `Items.linked_tds_item` remains the sole
source of truth; every product read still derives from it. What changes is one
line of the Consequences section: the child table is no longer "retired as a
writer, to be dropped in a later cleanup". It is now **written by exactly one
function, read by nothing, and must not be dropped.**

### The mirror is one-way, and that is load-bearing

- **One writer.** `api/tds/members.rebuild_group_members(group, full=False)`.
  Nothing else may write those rows.
- **Zero readers in the product.** `get_tds_item_members`, `get_tds_member_index`,
  `get_group_category`, `tds_report._enrich_model_no` and `picker.search_tds_items`
  all still query `Items`. Pinned by
  `test_get_tds_item_members_reads_the_store_not_the_mirror`, which empties the
  mirror and asserts the endpoint still answers correctly.
- **The field is `read_only`.** A Desk edit would be silently discarded on the
  next rebuild — worse than the empty grid it replaces, because it looks like it
  worked.

**Why the product must not read it, even though it now holds the same rows.**
The TDS master list shows a member COUNT for every group at once
(`get_tds_member_index`, one aggregate over `Items`). That cannot come from child
tables without an N+1 or shipping every group's rows, so it stays on the store
permanently. If the detail page read the mirror, the two screens would have
different sources for "who is in this group" and could disagree — the same class
of defect as the stale-count bug, made structural. The mirror is cosmetic; keep
it that way.

### `Items.on_update` comes back — this reverses an Amendment-A cleanup

This ADR retired `Items.on_update` on the grounds that "there is no denormalized
copy left to go stale". A mirror row stores COPIES of `item_name`/`category`, so
that premise no longer holds and the hook returns with it, now covering **two**
triggers: a linkage change (rebuild both ends) and an `item_name`/`category`
change (refresh the stale copies). `after_delete` and `after_insert` cover the
other two doc paths. Rebuild failures are logged and swallowed — an item edit
must never fail because a display mirror could not refresh.

⚠️ The `linking.py` endpoints do **not** reach those hooks: they write with
`frappe.db.set_value(update_modified=False)`, which fires no doc lifecycle at
all. Their explicit rebuild calls are the only thing keeping the grid in step,
and `set_items_tds_link` must rebuild **both** ends of a move. Correctness holds
only while every write to `linked_tds_item` calls the rebuild — which is true
today because `set_value` on that field exists nowhere but `linking.py`.

### Diff by default, `full=True` for the backfill

The rebuild writes only what changed (a rename is one UPDATE, an unchanged group
writes nothing), which also removes the O(n²) shape a bulk item edit would
otherwise have. `full=True` clears and re-derives, and is kept because it
**normalises `idx`** alphabetically. Both paths converge on membership from a
corrupted mirror — an assumption that the diff would propagate drift was tested
and proved false, and the docstring says so rather than the guess.

### Read indexes, and a Frappe/PostgreSQL trap

`Items.linked_tds_item` and `TDS Items Child Table.parent` were both UNINDEXED —
a membership lookup Seq-Scanned 3,536 rows to return 8. Both are now declared in
their controllers' `on_doctype_update()` and applied by a patch that CALLS those
hooks, following the BoQ precedent (`boq_row_category`,
`boq_committed_sheet_grid_row`, `patches/v3_0/add_boq_read_indexes`).

⚠️ **A single-field index MUST be given an explicit `index_name`.** Frappe's
default is `<field>_index`, and PostgreSQL index names are unique per SCHEMA, not
per table. `parent_index` was already owned by `tabBoQ Committed Sheet Grid Row`,
so the default-named call matched it, `IF NOT EXISTS` skipped, and it silently
created nothing. **The same trap has already cost this codebase the declared
`Items.item_name` index** — that name was taken by `tabTarget Rates`, so the
index `items.json` asks for does not exist. Unfixed; noted here so it is not
rediscovered as a mystery.

### Backfill is mandatory, not optional

The hooks only fire on changes made after they ship, so every pre-existing link
would stay invisible. `patches/v3_0/backfill_tds_member_mirror` materialises the
mirror once. It carries a `dry_run()` that writes nothing, prints its plan before
and after, and **names every legacy child row it is about to discard** — those
rows are the only surviving record of pre-ADR-0004 membership that never reached
the store (the four groups the old Add-TDS-Item wizard stranded were exactly
this). It warns rather than aborts on a mismatch: the mirror is cosmetic, and
failing a migration over a display table is the wrong trade.
