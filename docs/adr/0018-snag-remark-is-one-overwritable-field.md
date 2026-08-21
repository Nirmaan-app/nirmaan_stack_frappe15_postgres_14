---
status: accepted
supersedes: the two-field split recorded in the Snag List plan §3 (2026-08-21, same day)
---

# A Snag carries ONE remark field, and editing it overwrites the imported text

The Snag List first shipped with the remark split in two: `source_remarks` (imported, `read_only: 1`,
the consultant's own words) and `comments` (our team's write-back). The owner has reversed that: there
is now a single field, `remark`, which arrives holding the imported text and is editable by anyone who
may change the Snag's Status, in the same action.

## Why the split existed, and why it goes

The split protected evidence: a snag list gets disputed, and "what did the consultant actually write"
is the question that settles it. Two fields answered it structurally — the imported text could not be
overwritten because nothing in the UI could write to it.

Against that: two free-text fields on one row is two columns of table width, two edit affordances, and
a distinction that reads as pedantic to the person actually closing snags. The owner's judgement is
that the working note is what the screen is for. Recorded here rather than argued again.

## Consequences — state these plainly, they are the cost

- **The imported text is destroyed on first edit.** It survives in exactly two places, neither of them
  this screen: the batch's stored `source_file` (the original workbook, still downloadable), and
  Frappe's `Version` log — reachable from the Desk or a bench console, not from the Snag List tab.
  ⚠️ **The Version log does NOT hold the imported value itself.** Versions record *changes*, and the
  import writes the field on `.insert()`, which produces no Version row. The first edit's Version row
  carries the imported text as its `old_value` — so the original is recoverable only *because* it was
  overwritten at least once. The source file is the reliable answer.
- **The field is no longer `read_only: 1`.** Every comment in the codebase asserting the remark is
  "READ-ONLY forever" is now false and must go with the change, not after it.
- **`update_snag_comments` is deleted.** It was the only write path on this doctype that did NOT touch
  `status`, and `test_update_snag_status_stamps_attribution_and_a_later_save_does_not_move_it` used it
  as the probe proving the `before_save` controller leaves the status stamp alone on an unrelated save.
  **That test must be given a new non-status save or its guard becomes vacuous** — it would still pass
  while testing nothing. See the plan's Revision 2 for the replacement.
- **The status stamp now under-describes what happened.** `status_changed_by` / `status_changed_on`
  answer "who last moved the STATUS". Because a remark edit is always bundled with a status change,
  the two coincide today — but the "Not Applicable takes no remark" carve-out means the reverse is not
  true, and any future standalone remark edit would silently break the reading. Do not relabel that
  column as generic "last edited" attribution.

## The name is SINGULAR, deliberately

`remark`, not `remarks`. The import mapping already has a key called `remarks` whose value is an Excel
COLUMN LETTER (`"G"`), and in `services/snag_parser/parser.py` the mapping lookup and the row value sit
about six lines apart. Two different things sharing one name in one function is how a wrong column ends
up in a snag. The UI label may still read "Remarks" — users never see the fieldname.

## The rename is a patch, not a JSON edit

`source_remarks` -> `remark` uses `frappe.model.utils.rename_field` (an `ALTER TABLE ... RENAME COLUMN`,
data preserved), following this repo's precedent in `patches/v3_0/rename_cashflow_gap_limited.py` —
**including its "both columns exist" recovery branch**, which is required because `patches.txt` runs
only `[post_model_sync]`, so a migrate will already have created the new column before the patch runs.
Dropping `comments` needs its own `ALTER TABLE ... DROP COLUMN` patch as well: `bench migrate` syncs the
doctype definition but leaves the physical column behind (precedent:
`patches/v3_0/remove_commission_report_zones.py`).
