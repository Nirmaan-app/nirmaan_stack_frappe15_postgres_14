---
status: accepted
---

# A Snag's Category is free text, not a link to Work Headers

The requirement was phrased as "the user selects the Work Header column", which reads as a link to
the existing `Work Headers` master. Measured against the first real file (*Food Box MEP Snags list*,
124 snags), only **~29 of 124 rows** could resolve: the master holds 9 Work Headers, the file holds 11
categories, and the largest single category — *Fire & Life Safety*, **79 rows** — has no Work Header at
all, alongside *Lighting*, *CCTV*, *HVAC - CSU*, *Documentation* and *HVAC - Mechanical*. We therefore
store the source author's category **verbatim as Data**, and name the field **Category** rather than
Work Header so the two vocabularies are not confused.

## Considered options

- **Link to `Work Headers`** — rejected. It fails on 3 rows in 4, and the only way to make it succeed is
  to add snag-taxonomy terms (*Fire & Life Safety*, *Documentation*) to a master that Procurement, BoQ
  and Work Package flows all read. A snag taxonomy and a procurement work-package taxonomy are
  different things that happen to share some words.
- **Link, with an unmatched-value mapping step at import** — rejected for v1. It makes every import a
  reconciliation exercise for a benefit (rolling snags up by work package) nobody has asked for.
- **Free text** — chosen.

## Consequences

- Snags cannot be rolled up by Work Package or Work Header. If that is ever wanted, it is a new mapping
  layer, not a change to this field.
- Near-duplicate categories from typos are possible and are **not** auto-merged. The import preview
  shows the distinct Area and Category values it found so the importer can spot them before ingest;
  correcting a typo is the author's call, never the system's.
- The same reasoning applies to **Area**, which is free text for the same reason and has no master at all.
