# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read-only preview of the duplicate verdicts a match run would write (#1261).

Before the first match run on production, the owner runs this and reads every open statement line the
duplicate guards would now SKIP -- or leave Mismatched naming a record. A skip cannot be undone from the
screen, so it is seen first.

    bench --site <site> execute nirmaan_stack.api.outflow_import.duplicate_preview.run
    bench --site <site> execute nirmaan_stack.api.outflow_import.duplicate_preview.run --kwargs "{'batch': 'OFI-26-00001'}"

⚠️ IT WRITES NOTHING, AND THE DATABASE ENFORCES IT. `run` reads inside a PostgreSQL `READ ONLY`
transaction and rolls it back, so a write anywhere below fails with "read-only transaction" instead of
landing. `bench execute` commits after the call; the rollback leaves it nothing to commit.

⚠️ IT ASKS THE RUN'S OWN QUESTIONS, NOT A COPY OF THEM. A bank statement goes through
`review._contains_guard_outcomes` -- the very loop `_guard_duplicates_only` persists from -- and every
other source through `review._paid_duplicate_for` over `review._paid_duplicate_pools`, the pools the
gateway run loads. The verdict is `status.derive_guard_verdict`: rules 2 and 3, which both match-time
derivers apply before anything else. Rows and batches are those `match_batch` / `match_period` take:
every unfrozen row, batches oldest-uploaded first (`review._match_order`).

⚠️ ONE CROSS-BATCH EFFECT IS SIMULATED. A real run persists each ICICI skip's basis, and a LATER batch's
run reads it as a claim (#1258: one record justifies one line). The preview persists nothing, so it
carries those claims forward itself. The order is "Match all"'s; matching batches one by one in another
order can move which of two lines in different batches keeps a shared record.

Not reported: a gateway row's later passes (stack pairing) can rewrite the note of a row left Mismatched
by the guard. They never touch a skip -- a Skipped row is frozen.
"""

import os
from decimal import Decimal

import frappe

from nirmaan_stack.api.outflow_import.review import (
    BATCH_DOCTYPE,
    _FROZEN_ROW_STATUSES,
    _StagedRow,
    _assert_batch,
    _batch_source,
    _contains_guard_outcomes,
    _load_rows,
    _match_order,
    _paid_duplicate_for,
    _paid_duplicate_pools,
)
from nirmaan_stack.services.outflow_import.contains_guard import claims_of_skip
from nirmaan_stack.services.outflow_import.sources import (
    BANK_STATEMENT_SOURCES,
    source_has_settlement_path,
    source_runs_the_matcher,
)
from nirmaan_stack.services.outflow_import.status import (
    ROW_MISMATCHED,
    ROW_SKIPPED,
    SKIP_REASON_ALREADY_PAID,
    SKIP_REASON_ALREADY_RECEIVED,
    derive_guard_verdict,
)

_NARRATION_WIDTH = 60

# Every duplicate-skip sentence starts with this ("Already recorded as Paid on ...", "... as received on ...").
_ALREADY_RECORDED_PREFIX = os.path.commonprefix([SKIP_REASON_ALREADY_PAID, SKIP_REASON_ALREADY_RECEIVED])


def run(batch: str | None = None) -> None:
    """The `bench execute` entry point: build the preview read-only, then print it.

    Returns `None` on purpose -- `bench execute` json-dumps a truthy return value after the text.
    """
    frappe.db.rollback()
    frappe.db.begin(read_only=True)
    try:
        if frappe.db.sql("SHOW transaction_read_only")[0][0] != "on":
            frappe.throw("Could not open a read-only transaction; the preview did not run.")
        report = build_preview(batch=batch)
    finally:
        frappe.db.rollback()
    print(format_preview(report))


def build_preview(batch: str | None = None) -> dict:
    """The preview as data: `{batches: [...], totals: {...}, unclaimed_skips: [...]}`. Reads only."""
    blocks = []
    carried = []  # claims the ICICI skips of earlier batches would have persisted (#1258)
    for meta in _batches_to_preview(batch):
        name = meta["name"]
        loaded = _load_rows(name)
        notes = {r["name"]: r.get("outcome_note") or "" for r in loaded}
        rows = [_StagedRow(r) for r in loaded]
        matchable = [r for r in rows if r.row_status not in _FROZEN_ROW_STATUSES]
        entries = []
        for row, group, verdict in _guard_verdicts(name, matchable, carried):
            if verdict is not None:
                entries.append(_entry(name, row, group, verdict, notes[row.name]))
        blocks.append({
            "batch": name,
            "source": meta.get("source") or "",
            "filename": meta.get("original_filename") or "",
            "uploaded_at": meta.get("uploaded_at"),
            "examined": len(matchable),
            "rows": entries,
        })

    unclaimed = _unclaimed_bank_skips(batch)
    entries = [e for b in blocks for e in b["rows"]]
    return {
        "batches": blocks,
        "totals": {
            "batches": len(blocks),
            "examined": sum(b["examined"] for b in blocks),
            "skip": sum(1 for e in entries if e["verdict"] == ROW_SKIPPED),
            "mismatched": sum(1 for e in entries if e["verdict"] == ROW_MISMATCHED),
            "unchanged": sum(1 for e in entries if e["unchanged"]),
            "unclaimed_skips": len(unclaimed),
        },
        "unclaimed_skips": unclaimed,
    }


def _batches_to_preview(batch: str | None) -> list:
    """Every batch holding an unfrozen row (or just `batch`), in the order `match_period` matches them."""
    if batch:
        # A mistyped name must fail loudly: an empty report reads as "nothing will skip".
        _assert_batch(batch)
        names = [batch]
    else:
        placeholders = ", ".join(["%s"] * len(_FROZEN_ROW_STATUSES))
        names = [
            r[0] for r in frappe.db.sql(
                f"""SELECT DISTINCT import_batch FROM "tabOutflow Import Row"
                    WHERE COALESCE(row_status, '') NOT IN ({placeholders})""",
                _FROZEN_ROW_STATUSES,
            )
        ]
    metas = frappe.get_all(
        BATCH_DOCTYPE,
        filters={"name": ["in", names]},
        fields=["name", "source", "original_filename", "uploaded_at"],
    ) if names else []
    by_name = {m["name"]: m for m in metas}
    return [by_name[n] for n in _match_order(metas)]


def _guard_verdicts(batch: str, matchable, carried: list):
    """Yield `(row, group, verdict)` per unfrozen row, through the fork `match_batch` takes."""
    # The run writes nothing to a Cashbook batch (#1272), so the preview reports nothing for one.
    if not source_runs_the_matcher(_batch_source(batch)):
        return
    if not source_has_settlement_path(_batch_source(batch)):
        for row, group, outcome, basis in _contains_guard_outcomes(batch, matchable, carried):
            if basis:
                carried.extend(claims_of_skip(row, batch, group))
            yield row, group, derive_guard_verdict(row, group)
        return
    if not matchable:
        return
    pools = _paid_duplicate_pools([r.normalized_reference for r in matchable])
    for row in matchable:
        group = _paid_duplicate_for(row, pools)
        yield row, group, derive_guard_verdict(row, group)


def _entry(batch: str, row, group, verdict, current_note: str) -> dict:
    return {
        "batch": batch,
        "row": row.name,
        "transfer_id": row.transfer_id,
        "date": row.added_on_date,
        "amount": row.amount,
        "narration": _narration(row),
        "current_status": row.row_status,
        "verdict": verdict.status,
        "note": verdict.note,
        "records": [
            {"doctype": t.doctype, "name": t.name, "amount": t.amount}
            for t in (getattr(group, "targets", None) or ())
        ],
        # The row already reads exactly this -- the run would change nothing on it.
        "unchanged": row.row_status == verdict.status and current_note == (verdict.note or ""),
    }


def _narration(row) -> str:
    text = " ".join((row.remarks or " ".join(filter(None, (row.beneficiary_name, row.bank_reference_no)))).split())
    return text if len(text) <= _NARRATION_WIDTH else text[: _NARRATION_WIDTH - 3] + "..."


def _unclaimed_bank_skips(batch: str | None) -> list:
    """Bank-statement duplicate skips that stored NO basis, so they claim no record (#1258's known gap).

    A skip made before #1258 names its record in the note but never wrote `duplicate_basis`, so that record
    can still justify skipping a second line. Counted so the owner knows how many before the first run.
    """
    sources = tuple(BANK_STATEMENT_SOURCES)
    source_ph = ", ".join(["%s"] * len(sources))
    batch_clause = "AND r.import_batch = %s" if batch else ""
    return frappe.db.sql(
        f"""
        SELECT r.import_batch AS batch, r.name AS row, r.added_on AS date, r.amount, r.outcome_note AS note
        FROM "tabOutflow Import Row" r
        JOIN "tabOutflow Import Batch" b ON b.name = r.import_batch
        WHERE r.row_status = %s
          AND b.source IN ({source_ph})
          AND COALESCE(r.duplicate_basis::text, '') IN ('', 'null', '[]')
          AND r.outcome_note LIKE %s
          {batch_clause}
        ORDER BY r.import_batch, r.added_on, r.name
        """,
        (ROW_SKIPPED, *sources, _ALREADY_RECORDED_PREFIX + "%", *([batch] if batch else [])),
        as_dict=True,
    )


def format_preview(report: dict) -> str:
    """Plain text for a terminal: one block per batch, then the counts."""
    out = [
        "Bulk Import Transactions -- duplicate-skip preview (#1261)",
        "READ ONLY: this preview WROTE NOTHING. A real match run would write the verdicts below.",
        "",
    ]
    for block in report["batches"]:
        if not block["rows"]:
            continue
        out.append(
            f"Batch {block['batch']}  [{block['source'] or 'no source'}]  {block['filename']}  "
            f"-- {len(block['rows'])} of {block['examined']} open rows"
        )
        for e in block["rows"]:
            verdict = "SKIP" if e["verdict"] == ROW_SKIPPED else "MISMATCHED"
            if e["unchanged"]:
                verdict += " (unchanged)"
            records = "; ".join(
                f"{r['doctype']} {r['name']} ({_money(r['amount'])})" for r in e["records"]
            ) or "-"
            out += [
                f"  {e['row']}  {e['date'] or '-'}  {_money(e['amount']):>14}  {e['narration']}",
                f"      {verdict}: {e['note']}",
                f"      records: {records}",
            ]
        out.append("")

    t = report["totals"]
    out += [
        "Summary",
        f"  Batches examined:              {t['batches']}",
        f"  Open rows examined:            {t['examined']}",
        f"  Would skip:                    {t['skip']}",
        f"  Would stay Mismatched (named): {t['mismatched']}",
        f"  ...of these, already reading so: {t['unchanged']}",
        f"  Older ICICI skips with no stored basis (claim no record): {t['unclaimed_skips']}",
    ]
    for s in report["unclaimed_skips"]:
        out.append(f"    {s['batch']}  {s['row']}  {s['note']}")
    return "\n".join(out)


def _money(value) -> str:
    return f"{Decimal(str(value or 0)):,.2f}"
