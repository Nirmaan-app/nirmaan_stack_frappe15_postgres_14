---
status: accepted
---

# Snags are standalone documents, not a child table on a per-project parent

The Snag List UI is modelled on the Project Design Tracker, which stores its tasks as a **child table**
on one `Project Design Tracker` doc per project. We deliberately did **not** copy that storage shape:
each Snag is its own document linked to a Project and a Snag Batch. The UI pattern is what we are
reusing, not the persistence.

## Why

- **Filtering.** `frappe.get_all()` filters child tables at the *parent* level on PostgreSQL — if any
  child row matches, every row of that parent comes back. Faceted filtering by Area / Category / Status
  / Batch is the core interaction of this screen, and it cannot be done server-side against a child table
  without hand-written SQL joins.
- **Write cost.** A child-table status change re-saves the whole parent document. One project accumulating
  several batches over a job easily reaches four figures of rows; every single-row status tick would
  rewrite all of them.
- **Audit.** `track_changes` on a standalone doctype gives per-Snag version history for free. Child-row
  history is recorded against the parent and is painful to read back per row.
- **Deletion.** `frappe.delete_doc` writes a `Deleted Document` row holding the full JSON of each deleted
  Snag. That recovery path is what makes hard-deleting a Batch acceptable (see Consequences), and it does
  not exist for child rows.

## Consequences

- Deleting a Batch must go through the **document layer** (`frappe.delete_doc`), never raw SQL or a bulk
  DB write — raw deletion skips `Deleted Document` and destroys the only recovery path. This is the
  standing raw-SQL-bypasses-the-lifecycle trap recorded in `CLAUDE.md`.
- Batch deletion is **not guarded** by a "some rows have been worked" check (owner decision). An admin can
  delete a Batch whose team has been closing snags for a month; recovery is a developer pulling JSON out of
  `Deleted Document` in a bench console. The confirm dialog states the row count and how many rows are no
  longer *Pending*, so the number is on screen before the click — but nothing blocks it.
- More rows in the database than the child-table shape would produce. This is the intended trade.
