# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Say what KIND of skip every line was that was skipped before `Outflow Import Row.skip_kind` existed.

WHY THIS PATCH EXISTS
    `skip_kind` drives the Skipped popup's Skip Type column and filter. Every skip made from this change
    on writes it beside its sentence. Lines skipped before carry a blank, and a blank would sit under no
    filter value at all -- the popup would quietly lose them the moment a Skip Type was picked.

WHAT IT DECIDES, AND WHERE
    The rule is `services/outflow_import/skip_kind_backfill.classify_stored_skip_kind`, IMPORTED rather
    than re-written here: Manual origin -> Skipped by hand; otherwise the system skip sentence already
    stored on the line (skip_reason, then outcome_note) names the kind.

⚠️ IT REFUSES RATHER THAN GUESSES
    A Skipped line whose text names no known kind stops the patch BEFORE ANY WRITE, naming the lines.
    Filing it under a wrong kind would hide it behind a filter value that says something untrue. Fix
    the line (or teach the classifier its sentence) and re-run.

IDEMPOTENT
    Only Skipped lines with a blank `skip_kind` are read, and each is written a non-blank value, so a
    second run reads nothing and writes nothing. A kind written by the new code is never touched.

RAW UPDATE, NOT `doc.save` -- AND WHY SKIPPING THE LIFECYCLE IS CORRECT HERE (root CLAUDE.md rule 1)
    `Outflow Import Row` has no `doc_events` and its controller only validates two identity fields;
    `skip_kind` feeds no derived value anywhere. Re-saving thousands of historical lines would stamp a
    Version row and `modified` on each, making every old skip read as edited today. `modified` is left
    alone. Same disposition as `backfill_outflow_skip_origin`.
"""

import frappe

from nirmaan_stack.services.outflow_import.skip_kind_backfill import classify_stored_skip_kind
from nirmaan_stack.services.outflow_import.status import ROW_SKIPPED

ROW_DOCTYPE = "Outflow Import Row"

# How many unclassifiable line names the refusal prints before summarising the rest.
_NAMES_SHOWN = 20


class UnclassifiableSkipError(Exception):
    """A Skipped line whose stored text names no known skip kind."""


def execute():
    if not frappe.db.has_column(ROW_DOCTYPE, "skip_kind"):
        # The column ships in the same commit; a migrate that has not synced it yet must not half-apply.
        print("backfill_outflow_skip_kind: skip_kind column absent, skipping")
        return
    counts = backfill_skip_kind()
    frappe.db.commit()
    message = f"backfill_outflow_skip_kind: {counts}"
    print(message)
    frappe.logger("outflow_import").info(message)


def backfill_skip_kind(rows: list[str] | None = None) -> dict:
    """Classify and write every blank-kind Skipped line -- or only `rows`, which is what the tests pass
    so they never touch a line they did not create. Returns `{kind: count}`. Commits nothing.

    Raises `UnclassifiableSkipError` -- having written nothing -- when any line cannot be classified.
    """
    scope = ""
    params: dict = {"skipped": ROW_SKIPPED}
    if rows is not None:
        if not rows:
            return {}
        scope = "AND r.name IN %(rows)s"
        params["rows"] = tuple(rows)

    lines = frappe.db.sql(
        f"""
        SELECT r.name, r.skip_origin, r.skip_reason, r.outcome_note, r.direction
        FROM "tabOutflow Import Row" r
        WHERE r.row_status = %(skipped)s
          AND COALESCE(r.skip_kind, '') = ''
          {scope}
        ORDER BY r.name
        """,
        params,
        as_dict=True,
    )

    by_kind: dict[str, list[str]] = {}
    unclassified: list[str] = []
    for line in lines:
        kind = classify_stored_skip_kind(
            skip_origin=line.skip_origin,
            skip_reason=line.skip_reason,
            outcome_note=line.outcome_note,
            direction=line.direction,
        )
        if kind:
            by_kind.setdefault(kind, []).append(line.name)
        else:
            unclassified.append(line.name)

    if unclassified:
        shown = ", ".join(unclassified[:_NAMES_SHOWN])
        more = len(unclassified) - _NAMES_SHOWN
        raise UnclassifiableSkipError(
            f"backfill_outflow_skip_kind: {len(unclassified)} Skipped line(s) name no known skip kind, "
            f"so nothing was written: {shown}" + (f" and {more} more" if more > 0 else "")
        )

    for kind, names in by_kind.items():
        # Raw UPDATE on purpose; see the module docstring for why no lifecycle is skipped that matters.
        frappe.db.sql(
            """UPDATE "tabOutflow Import Row" SET skip_kind = %(kind)s
               WHERE name IN %(names)s AND COALESCE(skip_kind, '') = ''""",
            {"kind": kind, "names": tuple(names)},
        )
    return {kind: len(names) for kind, names in sorted(by_kind.items())}
