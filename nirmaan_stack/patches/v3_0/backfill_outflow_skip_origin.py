# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Say who skipped every line that was skipped before `Outflow Import Row.skip_origin` existed (#1273).

WHY THIS PATCH EXISTS
    `skip_origin` (blank / System / Manual) is what decides whether a Skipped line may be unskipped:
    only a Manual one may (parent #1270 Q8). Every skip made from #1273 on writes it. Lines skipped
    before carry a blank, so without this none of the existing hand skips could ever be brought back
    (Q17) -- and a blank must not be read as either answer.

WHAT IT DECIDES, AND WHERE
    The rule is `services/outflow_import/skip_origin.classify_skip_origin`, IMPORTED rather than
    re-written here: Manual only when a person is on the line, neither the outcome note nor the skip
    reason is a sentence the software writes when it skips, the line is not Cashbook, and the bank
    says the transfer succeeded. Everything else is System. Read that module's docstring before
    changing anything -- every doubt resolves to System on purpose, because a system skip called
    Manual can be unskipped into a duplicate.

IDEMPOTENT
    Only Skipped lines whose `skip_origin` is blank are read, and each is written a non-blank value,
    so a second run reads nothing and writes nothing. A skip written by the new code is never touched.

RAW UPDATE, NOT `doc.save` -- AND WHY SKIPPING THE LIFECYCLE IS CORRECT HERE (root CLAUDE.md rule 1)
    `Outflow Import Row` has no `doc_events` and its controller only validates two identity fields;
    `skip_origin` feeds no derived value anywhere. Re-saving ~2,000 historical lines would stamp a
    Version row and `modified` on each, making every old skip read as edited today. `modified` is left
    alone.

The `patches.txt` wiring (`nirmaan_stack.patches.v3_0.backfill_outflow_skip_origin` under
[post_model_sync], after the doctype sync that adds the column) is added by the maintainer, as for
every other outflow patch.
"""

import frappe

from nirmaan_stack.services.outflow_import.skip_origin import classify_skip_origin
from nirmaan_stack.services.outflow_import.status import ROW_SKIPPED

ROW_DOCTYPE = "Outflow Import Row"


def execute():
    if not frappe.db.has_column(ROW_DOCTYPE, "skip_origin"):
        # The column ships in the same commit; a migrate that has not synced it yet must not half-apply.
        print("backfill_outflow_skip_origin: skip_origin column absent, skipping")
        return
    counts = backfill_skip_origin()
    frappe.db.commit()
    message = f"backfill_outflow_skip_origin: {counts}"
    print(message)
    frappe.logger("outflow_import").info(message)


def backfill_skip_origin(rows: list[str] | None = None) -> dict:
    """Classify and write every blank-origin Skipped line -- or only `rows`, which is what the tests
    pass so they never touch a line they did not create. Returns `{origin: count}`. Commits nothing."""
    scope = ""
    params: dict = {"skipped": ROW_SKIPPED}
    if rows is not None:
        if not rows:
            return {}
        scope = "AND r.name IN %(rows)s"
        params["rows"] = tuple(rows)

    lines = frappe.db.sql(
        f"""
        SELECT r.name, r.decided_by, r.outcome_note, r.skip_reason, r.status_raw,
               COALESCE(NULLIF(TRIM(b.source), ''), r.source) AS source
        FROM "tabOutflow Import Row" r
        LEFT JOIN "tabOutflow Import Batch" b ON b.name = r.import_batch
        WHERE r.row_status = %(skipped)s
          AND COALESCE(r.skip_origin, '') = ''
          {scope}
        """,
        params,
        as_dict=True,
    )

    by_origin: dict[str, list[str]] = {}
    for line in lines:
        origin = classify_skip_origin(
            decided_by=line.decided_by,
            outcome_note=line.outcome_note,
            skip_reason=line.skip_reason,
            source=line.source,
            status_raw=line.status_raw,
        )
        by_origin.setdefault(origin, []).append(line.name)

    for origin, names in by_origin.items():
        # Raw UPDATE on purpose; see the module docstring for why no lifecycle is skipped that matters.
        frappe.db.sql(
            """UPDATE "tabOutflow Import Row" SET skip_origin = %(origin)s
               WHERE name IN %(names)s AND COALESCE(skip_origin, '') = ''""",
            {"origin": origin, "names": tuple(names)},
        )
    return {origin: len(names) for origin, names in sorted(by_origin.items())}
