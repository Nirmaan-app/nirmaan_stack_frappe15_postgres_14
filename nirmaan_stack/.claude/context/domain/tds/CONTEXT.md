# TDS — Context Glossary

> Bounded context: Technical Data Sheets (TDS). Covers the global master
> catalog (**TDS Repository**) and per-project consumption (**Project TDS**).
> This file is a glossary only — no implementation details. Decisions with
> trade-offs live in `docs/adr/`.

## Terms

- **TDS Item** *("TDS SKU")* — The **grouping entity** (new doctype). Holds a
  **set of Items SKUs** — "which catalog items does this spec group cover." A TDS
  Item has **no Make and no datasheet of its own**. It is **scoped to a single
  Work Package**, but its members **may span multiple Categories** within that WP
  (so `work_package` lives on the TDS Item; `category` is per-member, not a single
  group attribute — the TDS Item itself has no category field). **Members are
  optional**: a TDS Item with **zero members** represents a *custom item* (no
  Items SKU) — see Custom Item. "TDS SKU" is an informal synonym; the canonical
  noun is **TDS Item**. One TDS Item is referenced by **many TDS Repository
  Entries — one per Make**.

- **TDS Repository Entry** *(the datasheet record)* — One row in the **TDS
  Repository**, now keyed by the combination **(TDS Item, Make, attachment)**.
  The Make and the `tds_attachment` (datasheet PDF) live here, not on the TDS
  Item. Replaces the pre-change unit, which was keyed by **(Items SKU, Make,
  attachment)** — the direct `Items` link is replaced by a `TDS Item` link.

- **Items SKU** — A row from the **Items** master catalog (the company-wide item
  master: item code + name + category). An Items SKU is *mapped into one or more
  TDS Items* (the mapping is **many-to-many** — the same Items SKU may belong to
  several TDS Items). It is no longer referenced directly by a Repository Entry.

- **TDS Repository** — The global master catalog of **TDS Repository Entries**
  (and, transitively, **TDS Items**). Not project-scoped. Admin-maintained.

- **Project TDS** — The per-project workflow that consumes TDS Items: selecting
  them for a project, sending for approval, and exporting a merged project TDS
  report PDF.

- **Project TDS Item List** — The doctype holding per-project consumption rows.
  A project assembles its TDS by **selecting a TDS Item + Make** (i.e. one
  Repository Entry); each row is a snapshot of that **group + make + datasheet**,
  with its own approval status. The member Items SKUs travel as *coverage*
  (informational), not as the selection key.

- **Project TDS Setting** — Per-project branding/signatory config (client,
  architect, consultant, GC/MEP contractor names + logos) used to render the
  project TDS report.

- **Custom Item** — An item with **no Items-master SKU**. In the new model a
  custom item is modeled as a **member-less TDS Item** (zero members) carrying
  just a label + Work Package — **no Items-master row is created** (the Items
  master is never polluted). Custom is **inferred from 0 members** (no `is_custom`
  flag); custom TDS Items carry **no category**. Legacy repository `CUS-NNNNNN`
  rows migrate to member-less TDS Items. **Phase 2 retires project-only customs:**
  the old `PCUS-NNNNNN` (project-scoped, never-shared) concept is removed — every
  approved custom is a **shared** member-less TDS Item (one custom model; see
  ADR-0003).

- **Verified / Not Verified** — Status on a **Repository Entry** (per TDS Item +
  Make) indicating whether that datasheet has been vetted. Set to Verified when an
  approver signs off on a consuming project request.

- **Approval-time promotion** — A second authoring path into the Repository.
  Approving a project's *New* request writes the master: a missing make → a new
  `(TDS Item, Make)` Repository Entry; a brand-new group → a new **member-less TDS
  Item** + entry; both **born Verified**. In Phase 2 this promotion is
  **Admin-only** and **group-aware**, and there is no longer a project-only
  (`PCUS-`) escape hatch — every approved custom enters the shared master (see
  ADR-0003).

- **Coverage** — The member Items SKUs that ride along with a consumed TDS Item,
  shown read-only/informational on the project row and report. It is **derived
  live** from the selected TDS Item (never the selection key, never frozen on the
  snapshot) — only the datasheet is the signed, frozen artifact.
