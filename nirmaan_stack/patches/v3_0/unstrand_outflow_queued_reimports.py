# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Re-open the rows the QUEUED-then-SUCCESS duplicate defect stranded.

THE DEFECT
    The duplicate lookup asked only "have we staged this transfer id, at this amount, on this date,
    before?" -- never "did that earlier row record anything?". A transfer still QUEUED when the
    previous statement was exported stages with no bank reference and settles nothing. The next
    export carries the SAME transfer id, now SUCCESS and with a UTR, and none of the three identity
    axes changed when it completed. So it matched, and was skipped as "Already imported in batch X".

    The money then never reached a record and could not: `Skipped` is in
    `review._FROZEN_ROW_STATUSES`, so re-running the match never revisits the row, and there is no
    unskip endpoint. Every later export repeats the same collision, so the transfer is lost
    permanently rather than merely late.

    Fixed forward in `candidates.find_earlier_batches_for_rows` and
    `api.outflow_import.cashbook._already_imported`, which now count only a TERMINAL stored row --
    one whose story is over, successfully or not -- as evidence of an import.

WHY THE CODE FIX IS NOT ENOUGH ON ITS OWN
    Re-uploading the statement does NOT recover these rows, and it is worth being exact about why,
    because it is the obvious move and it fails. The stranded row is itself stored with
    `status_raw = 'SUCCESS'` -- it was skipped for being a duplicate, not for failing. Under the
    corrected rule it is therefore a perfectly valid duplicate of itself, so a re-upload finds every
    row already imported, `new == 0`, and `duplicates.assess_duplicates` REFUSES the file outright.
    A newer statement hits the same wall. Only re-opening the stored row recovers it.

WHAT IT MATCHES -- deliberately narrow
    A row skipped as already-imported, which itself reached a TERMINAL state, whose named earlier
    batch holds the same transfer id in a state that was still IN FLIGHT. All three conditions
    together describe only rows this defect created. A row skipped as a genuine repeat of an earlier
    terminal transfer fails the third condition and is left exactly as it is -- which is what stops
    this re-opening the ~34 correct duplicates sitting beside the 2 broken ones on the owner's
    database. It mirrors the corrected forward rule exactly: terminal, not merely successful, so a
    transfer that queued and then FAILED is not dragged back open either.

    It reads the batch name back out of `skip_reason` rather than guessing, because that string is
    the only record of WHICH batch the row was skipped against, and re-deriving it would be a fourth
    place that has to agree about duplicate identity.

WHAT IT DELIBERATELY DOES NOT DO
    It does not re-run the matcher and it does not settle anything. A patch that wrote money would
    be doing the reviewer's job unasked, at migrate time, with no screen showing what it chose. It
    restores the rows to `Pending match run` -- the status they should have had at staging -- and
    stops. Pressing "Run match" on the batch does the rest, and refreshes the batch counters through
    `review._refresh_batch_rollup`, which is why this does not touch them either: they are DERIVED,
    and a patch computing them a second way is how the two come to disagree.

RAW SQL, NOT `set_value` PER ROW
    `row_status` is derived (`services/outflow_import/status.py` is the only deriver), so there is
    no business event here to audit -- this restores a value the deriver would itself have produced
    from the same inputs had the lookup been right. Same reasoning as
    `merge_outflow_unmatched_status`.

IDEMPOTENT
    The `WHERE` clause requires the already-imported skip reason, which the update clears, so a
    second run matches nothing. Safe on a fresh site, safe on an already-migrated one, safe by hand.

The corresponding patches.txt wiring
(`nirmaan_stack.patches.v3_0.unstrand_outflow_queued_reimports` under [post_model_sync]) is added
separately by the maintainer -- intentionally not part of this patch, matching
`merge_outflow_unmatched_status` and `add_outflow_master_index`.
"""

import frappe

# ⚠️ IMPORTED, NEVER SPELLED. Unlike `merge_outflow_unmatched_status`, which had to hardcode the
# string it was erasing, every value this patch reads is still live vocabulary -- so importing is
# what keeps the patch honest if any of it is ever reworded.
from nirmaan_stack.services.outflow_import.parser import BANK_TERMINAL_STATUSES
from nirmaan_stack.services.outflow_import.status import (
    ROW_PENDING_MATCH,
    ROW_SKIPPED,
    SKIP_REASON_ALREADY_IMPORTED,
)

#: `Already imported in batch %` -- the LIKE form of the reason, built from the template rather than
#: retyped so a change to the sentence cannot silently stop this matching.
_ALREADY_IMPORTED_LIKE = SKIP_REASON_ALREADY_IMPORTED.format(batch="%")

#: The batch name sits between the template's fixed prefix and its trailing full stop. Taken by
#: LENGTH of the prefix, so the two stay tied to the one template.
_REASON_PREFIX_LEN = len(SKIP_REASON_ALREADY_IMPORTED.split("{batch}")[0])


def execute():
    if not frappe.db.table_exists("Outflow Import Row"):
        return

    terminal = tuple(sorted(BANK_TERMINAL_STATUSES))
    frappe.db.sql(
        """
        UPDATE "tabOutflow Import Row" AS stranded
        SET row_status = %(pending)s, skip_reason = NULL
        WHERE stranded.row_status = %(skipped)s
          AND stranded.skip_reason LIKE %(reason_like)s
          AND UPPER(BTRIM(COALESCE(stranded.status_raw, ''))) IN %(terminal)s
          AND EXISTS (
                SELECT 1
                FROM "tabOutflow Import Row" AS earlier
                WHERE earlier.transfer_id = stranded.transfer_id
                  AND earlier.import_batch = BTRIM(
                        TRIM(TRAILING '.' FROM
                             SUBSTRING(stranded.skip_reason FROM %(prefix_len)s::integer))
                      )
                  AND UPPER(BTRIM(COALESCE(earlier.status_raw, ''))) NOT IN %(terminal)s
              )
        """,
        {
            "pending": ROW_PENDING_MATCH,
            "skipped": ROW_SKIPPED,
            "reason_like": _ALREADY_IMPORTED_LIKE,
            # A tuple binds as a SQL list for `IN` / `NOT IN`, so the set is spelled once here and
            # read twice in the statement above rather than being duplicated into two placeholder
            # runs that could drift apart.
            "terminal": terminal,
            # SQL `SUBSTRING ... FROM n` is 1-indexed, so the first character AFTER the prefix is
            # at `len(prefix) + 1`.
            #
            # ⚠️ THE `::integer` CAST IN THE STATEMENT IS LOAD-BEARING, AND ITS ABSENCE FAILS
            # SILENTLY. Postgres overloads `SUBSTRING(string FROM x)`: with an INTEGER it is the
            # positional form, but with TEXT it is the POSIX-REGEX form. A bound parameter arrives
            # typed as text, so without the cast `FROM 27` was read as the pattern /27/ and matched
            # the "27" inside `OFI-26-00271`, yielding the batch name `27`. Nothing errored -- the
            # EXISTS simply never matched, the UPDATE touched 0 rows, and the patch reported success
            # while repairing nothing. Caught only because `TestUnstrandPatch` builds a row it is
            # supposed to fix and then checks that it did.
            "prefix_len": _REASON_PREFIX_LEN + 1,
        },
    )
    frappe.db.commit()
