# TDS Item grouping model

Status: accepted

A TDS datasheet typically covers a whole manufacturer product family (several
catalog item codes at once), so the old "one TDS Repository row = one Items SKU ×
one Make × one datasheet" shape forced the same PDF to be duplicated across many
rows. We introduce a three-level model: an **Items SKU** (Items-master row) is a
member of a **TDS Item** (a new grouping doctype, "TDS SKU"), and the **TDS
Repository Entry** becomes `(TDS Item, Make, attachment, status)` — the Make and
datasheet live on the entry, the TDS Item carries no make/attachment. One TDS Item
has many entries (one per Make).

## Considered options

- **Keep flat (status quo)** — rejected: forces datasheet duplication and makes
  multi-item datasheets unmanageable, which is the whole motivation.
- **TDS Item owns make + attachment (2 levels)** — rejected: a second make would
  require duplicating the whole group; make belongs on the per-datasheet entry.
- **1:1 Items↔TDS Item membership** — rejected in favour of **many-to-many**: a
  generic catalog item can legitimately belong to several spec groups.

## Consequences

- Membership is **many-to-many**, so "which datasheet applies to item X?" is
  ambiguous *by item*. We resolve this by making consumption **group-driven**:
  a project selects a **TDS Item + Make**, never a bare item — the ambiguity never
  arises at selection time.
- TDS Item is scoped to a **single Work Package**; members may span **Categories**
  within it (so `work_package` is a group attribute, `category` is per-member).
- Repository Entry uniqueness collapses from `(wp, category, item, make)` to
  `(TDS Item, Make)`. Verified/Not-Verified status is per entry.
- Members are **Items-master rows only when present, but optional**: a TDS Item
  with **zero members** represents a **custom item** (no Items SKU). The Items
  master is **never** written to for customs — legacy `CUS-` rows migrate to
  member-less TDS Items. Custom is inferred from 0 members (no `is_custom` flag),
  and custom TDS Items carry no category.
