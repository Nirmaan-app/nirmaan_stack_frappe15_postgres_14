# Technical Data Sheets (TDS): the TDS Repository and Project TDS

⚠️ **"TDS" HERE IS A TECHNICAL DATA SHEET**, a manufacturer's datasheet PDF. Tax deducted at source is a
separate family with its own doc (`payment-tds.md`). A grep for `tds` lands on both.

Vocabulary: root `GLOSSARY.md` § Technical Data Sheets (TDS Item, Repository Entry, Unlinked TDS Item,
Project Custom Item, Request Type). Decisions: `docs/adr/0023`–`0026`; ADR-0025 Amendment A covers Project
Custom Items. The `tds/phase-*.md` plans are build history, not current behaviour.

## Load-bearing invariants

- **Catalogue shape.** An Items SKU names its group in `Items.linked_tds_item`, the only membership store.
  A `TDS Items` group has one Repository Entry (`TDS Repository`) per make, unique on `(tds_item, make)`.
  The `members` child table is a display mirror written only by `api/tds/members.rebuild_group_members`.
- **Project rows are snapshots linked by value.** `Project TDS Item List.tds_item_id` and `tds_make` are
  Data fields. Approval and duplicate checks match them exactly against an entry's `(tds_item, make)`.
  Rows from before August 2026 hold legacy ids (`ITEM-`, `CUS-`) that match nothing; they render from
  their own frozen fields.
- **Stored `tds_status` has one meaning per value.** It is a Data field, so the convention is the only
  guard:
  - `New`: a New Make. Approval adds a Repository Entry.
  - `Pending`: every other waiting row: a pick, or a Project Custom Item (a `PCUS-` id).
  - `Approved`, `Rejected`.
  Request Type (From Repository / New Make / Project Custom) is derived, never stored, and holds only
  while a row waits.
- **One owner per rule.** The frontend reads every TDS request rule from `utils/tdsRequestRules.ts`
  (Request Type, Item Status, History status, the rejected-row match, the datasheet choice). The backend
  owns the stored values in `api/tds/submit.py` (`STATUS_*`, `PROJECT_CUSTOM_ID_PREFIX`) and
  `api/tds/approve.py` (`DATASHEET_CHOICES`, `WAITING_STATUSES`). A parity block in
  `tdsRequestRules.test.ts` pins the two together. Pages call these helpers; they never compare status
  literals.
- **Writes go through the endpoints**, each re-checking on the server:
  - `submit.submit_tds_request`: the send. All rows or none, under the project's advisory lock, which also
    issues the request id and `PCUS-` ids.
  - `approve.approve_tds_items` / `reject_tds_items`: Admin only.
  - `edit_request.edit_tds_request`: Admin edits of New Make and Project Custom rows, row-locked inside
    the project lock.
- **Datasheet ownership.** A pick borrows its entry's File. A request owns its upload. Approving a New
  Make moves the File to the new entry; keeping the repository's sheet deletes the row's own upload
  through `submit.delete_row_datasheet`, which respects shared stored bytes (`CODING_STANDARDS.md`
  § Deleting an uploaded File).

## Known gaps

- Every role holds write and delete on `Project TDS Item List`, so the REST API bypasses the Admin-only
  approval and the delete rules.
- `reject_tds_items` has no from-status check.
- The PDF export prints the rows the browser sends; the Handover binder reads rows without a status
  filter.
- Request ids are `RQ-<last 3 chars of project>-NN`, so they collide from project #1000 on.

## Testing

Backend: `api/tds/test_submit.py`, `test_approve.py`, `test_edit_request.py`, `test_tds_report.py`.
Frontend: `utils/tdsRequestRules.test.ts`. Browser: `scripts/tds_walk/` (see its README).
