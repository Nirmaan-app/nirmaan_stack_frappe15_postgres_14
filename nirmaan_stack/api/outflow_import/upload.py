# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Upload + stage a bank-outflow statement (Bulk Import Outflow, slice S3).

Thin orchestrator (ADR-0010 B4): authorize -> read -> PARSE -> persist -> commit. Every rule lives
in `services/outflow_import`; this module owns none of them.

THE ORDER OF OPERATIONS IS THE DESIGN, and it differs deliberately from the BoQ upload it is
otherwise modelled on:

    authorize -> read bytes -> **parse in memory** -> save_file -> create batch + rows -> commit

Parsing BEFORE `save_file` means a malformed statement writes NOTHING AT ALL -- no File, no batch,
no rows. That matters here specifically because `save_file` is not rollback-able: the
`frappe_gcp_attachment` File `after_insert` hook uploads to cloud storage, rewrites `file_url`,
deletes the local copy and calls `frappe.db.commit()` INSIDE this request. Anything written before
that point is committed mid-flight. Parsing first sidesteps the whole hazard.

It is also why this endpoint is SYNCHRONOUS while the BoQ one enqueues a worker: the BoQ path
re-fetches a multi-megabyte workbook from cloud storage into a tempfile because the local copy is
gone by then. A statement is a few kilobytes and we already hold its bytes, so there is nothing to
re-fetch and no worker to coordinate. Do not "align" this with the BoQ flow.

⚠️ THE ROOT CLAUDE.md "BoQ File Reading (S3 safety)" SECTION IS STALE about the BoQ worker (it
describes a tempfile written from in-memory bytes; the code re-fetches by URL instead). The one
invariant that IS still true, and that this module honours, is: read the werkzeug stream exactly
ONCE -- it is consumed on read.
"""

import os

import frappe
from frappe.utils.file_manager import save_file

from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.services.outflow_import.candidates import find_earlier_batches_for_rows
from nirmaan_stack.services.outflow_import.duplicates import assess_duplicates, row_identity
from nirmaan_stack.services.outflow_import.parser import (
    SUPPORTED_SOURCES,
    StatementFormatError,
    parse_statement,
)
from nirmaan_stack.services.outflow_import.status import (
    derive_batch_counters,
    derive_batch_status,
    derive_staged_row_outcome,
)

BATCH_DOCTYPE = "Outflow Import Batch"
ROW_DOCTYPE = "Outflow Import Row"

# Q10: .xlsx alongside .csv, so the sheet format stops being something the accountant thinks about.
# The parser sniffs the actual format from the bytes -- this set only decides what we accept by
# name, and a renamed export still parses correctly.
_ALLOWED_EXTENSIONS = frozenset({".csv", ".xlsx"})

# Well under `save_file`'s own 10 MB cap. A statement is kilobytes; anything approaching this is a
# wrong file, and refusing it here gives a better message than the framework's.
_MAX_FILE_BYTES = 5 * 1024 * 1024


@frappe.whitelist(methods=["POST"])
def preview_outflow_statement():
    """Parse a statement and report what importing it WOULD do. WRITES NOTHING (slice V3).

    Multipart form: `file` (.csv or .xlsx) plus a text field `source`.
    URL: /api/method/nirmaan_stack.api.outflow_import.upload.preview_outflow_statement

    ⚠️ THE BROWSER RE-POSTS THE SAME FILE ON CONFIRM, and that is the design, not a shortcoming.
    The server holding a parse between two requests would mean session state, an expiry, and a way
    for confirm to act on a file that is no longer the one on screen. A statement is a few
    kilobytes; sending it twice is cheaper than any of that.

    The period was ALWAYS captured -- `period_from`/`period_to` are derived from the sheet's own
    earliest and latest Added On -- it just happened silently, after the commit, where nobody could
    see it. This endpoint is where it becomes visible BEFORE anything is written.
    """
    _, source, filename, _, parsed = _read_and_parse()
    verdict, overlaps = _assess_statement(parsed, filename)

    return {
        "preview": True,
        "source": source,
        "original_filename": filename,
        "period_from": str(parsed.period_from) if parsed.period_from else None,
        "period_to": str(parsed.period_to) if parsed.period_to else None,
        "total_rows": len(parsed.rows),
        "successful_rows": parsed.success_count,
        "failed_rows": len(parsed.rows) - parsed.success_count,
        "gross_amount": float(parsed.gross_amount),
        "charges_amount": float(parsed.charges_amount),
        "duplicate_rows": verdict.duplicates,
        "new_rows": verdict.new,
        "duplicate_message": verdict.message,
        # Two DIFFERENT outcomes, never collapsed into one flag: `refused` means the confirm button
        # must not be offered at all, `warn` means it must be offered anyway (owner ruling Q2 --
        # a warning never blocks).
        "refused": verdict.refuse,
        "warn": verdict.warn,
        "duplicate_of_batch": verdict.earliest_batch,
        "overlaps_batch": overlaps,
        "warnings": list(parsed.warnings),
        "duplicate_transfer_ids": list(parsed.duplicate_transfer_ids),
    }


@frappe.whitelist(methods=["POST"])
def upload_outflow_statement():
    """Upload a statement, parse it, and stage its rows. Returns the batch summary.

    Multipart form: `file` (.csv or .xlsx) plus a text field `source`.
    URL: /api/method/nirmaan_stack.api.outflow_import.upload.upload_outflow_statement
    """
    user, source, filename, file_content, parsed = _read_and_parse()

    # ⚠️ THE REFUSAL HAPPENS BEFORE `save_file`, WHICH IS THE ONLY PLACE IT CAN. `save_file` is not
    # rollback-able -- the cloud attachment hook commits inside this request -- so a refusal after
    # it would leave an orphan File behind for a statement we declined. Owner ruling Q2: a wholly
    # duplicated sheet writes NOTHING AT ALL.
    verdict, _ = _assess_statement(parsed, filename)
    if verdict.refuse:
        frappe.throw(verdict.message, title="Already imported")

    ret = save_file(fname=filename, content=file_content, dt=None, dn=None, is_private=1)
    # Read file_url OFF THE RETURNED DOC: the cloud hook rewrites it on this same object during
    # insert, so any URL computed beforehand is already wrong.
    file_url = ret.file_url

    batch = _stage_batch(parsed, file_url=file_url, filename=filename, user=user)

    # Link the File to the batch so the CSV appears under its attachments. Done after the batch
    # exists, because the File is created first (see the module docstring).
    frappe.db.set_value(
        "File",
        ret.name,
        {
            "attached_to_doctype": BATCH_DOCTYPE,
            "attached_to_name": batch.name,
            "attached_to_field": "source_file",
        },
        update_modified=False,
    )

    frappe.db.commit()
    return _summarize(batch, parsed)


def _read_and_parse():
    """authorize -> validate -> read the stream -> parse. WRITES NOTHING.

    Shared verbatim by the preview and the upload, so the two can never disagree about what they
    accept. That matters more than the saved lines: a preview that accepts a file the upload then
    rejects is worse than having no preview, because it moves the failure to after the reader
    committed to it.
    """
    user = require_outflow_access()

    source = (frappe.form_dict.get("source") or "Cashfree").strip()
    if source not in SUPPORTED_SOURCES:
        frappe.throw(
            f"Unknown source '{source}'. Supported: {', '.join(SUPPORTED_SOURCES)}.",
            title="Unsupported source",
        )

    files = frappe.request.files
    if "file" not in files:
        frappe.throw("No file uploaded.", title="Missing file")

    uploaded = files["file"]
    filename = uploaded.filename or ""
    _, ext = os.path.splitext(filename)
    if ext.lower() not in _ALLOWED_EXTENSIONS:
        frappe.throw(
            f"We support .csv and .xlsx statements. "
            f"You uploaded a '{ext or 'file with no extension'}'.",
            title="Unsupported file type",
        )

    # Read the werkzeug stream exactly once -- it is consumed on read.
    file_content = uploaded.read()
    if len(file_content) > _MAX_FILE_BYTES:
        mb = len(file_content) / (1024 * 1024)
        frappe.throw(
            f"This file is {mb:.1f} MB. Maximum is "
            f"{_MAX_FILE_BYTES // (1024 * 1024)} MB.",
            title="File too large",
        )

    # PARSE BEFORE ANY WRITE. A bad statement leaves no trace.
    try:
        parsed = parse_statement(file_content, source=source)
    except StatementFormatError as exc:
        frappe.throw(str(exc), title="Could not read this statement")

    return user, source, filename, file_content, parsed


def _assess_statement(parsed, filename: str):
    """How much of this statement is already imported, and the overlap warning. READ-ONLY.

    Returns `(DuplicateVerdict, overlapping_batch_name)`. Called by BOTH the preview and the
    upload, so what the preview promised is what the upload enforces.
    """
    already_imported = _already_imported(parsed)

    # ⚠️ COUNT ROWS, NOT KEYS. `already_imported` is keyed by row IDENTITY, and a statement may
    # carry the same transfer TWICE -- the fixture does, deliberately. Using `len()` of the map
    # against a row count compares two different populations, and the arithmetic is off by exactly
    # the number of in-file repeats: a fully duplicated 11-row sheet with one repeat reported 10 of
    # 11 and warned instead of refusing. Both numbers must count the same thing.
    duplicates = sum(1 for row in parsed.rows if _row_identity(row) in already_imported)
    earliest = next(
        (already_imported[_row_identity(row)] for row in parsed.rows
         if _row_identity(row) in already_imported),
        None,
    )
    verdict = assess_duplicates(
        total=len(parsed.rows),
        duplicates=duplicates,
        earliest_batch=earliest,
        filename=filename,
    )
    return verdict, _find_overlapping_batch(parsed.period_from, parsed.period_to)


def _row_identity(row):
    """This row's duplicate identity -- `(transfer_id, amount, date)`, from the ONE definition.

    A one-line shim so the three call sites in this file cannot each remember the tuple's shape
    differently. It exists because the identity WIDENED at slice D3 and adding a fourth axis later
    should be an edit to `duplicates.row_identity` and this line, not a hunt through the module.
    """
    return row_identity(row.transfer_id, row.amount, row.added_on_date)


def _already_imported(parsed, exclude_batch: str | None = None) -> dict:
    """The duplicate lookup, NARROWED BY PERIOD FIRST (owner-directed, slice V3).

    One call site's worth of policy, kept in one place so the preview, the staging pass and any
    later caller all narrow identically -- a preview that searched wider than the import would
    report duplicates the import then staged anyway.

    ⚠️ IT HANDS OVER THE ROWS, NOT THEIR IDS (slice D3). Identity is `(transfer_id, amount, date)`,
    so the amount and the date have to travel with the question; the returned map is keyed by that
    same triple, which is why every caller here looks up through `_row_identity`.
    """
    return find_earlier_batches_for_rows(
        parsed.rows,
        exclude_batch=exclude_batch,
        period_from=parsed.period_from,
        period_to=parsed.period_to,
    )


def _stage_batch(parsed, file_url: str, filename: str, user: str):
    """Create the batch and one row per parsed transfer. No matching happens here -- that is S4."""
    overlaps = _find_overlapping_batch(parsed.period_from, parsed.period_to)
    already_imported = _already_imported(parsed)

    batch = frappe.new_doc(BATCH_DOCTYPE)
    batch.update(
        {
            "source": parsed.source,
            "source_file": file_url,
            "original_filename": filename,
            "period_from": parsed.period_from,
            "period_to": parsed.period_to,
            "overlaps_batch": overlaps,
            "gross_amount": float(parsed.gross_amount),
            "charges_amount": float(parsed.charges_amount),
            "uploaded_by": user,
            "uploaded_at": frappe.utils.now_datetime(),
            "status": "Draft",
        }
    )
    batch.insert(ignore_permissions=True)

    statuses = []
    # ⚠️ THE IN-FILE CHECK WIDENED WITH THE CROSS-BATCH ONE (slice D3), AND HAD TO. These two ask
    # the same question -- "is this the same transfer?" -- about different populations, so a key
    # that differed between them would let one call a pair of rows duplicates while the other
    # called them distinct, on one screen, about the same two lines. Both read `_row_identity`.
    seen_in_file: set = set()
    for row in parsed.rows:
        identity = _row_identity(row)
        outcome = derive_staged_row_outcome(
            row,
            already_imported.get(identity),
            duplicate_in_file=identity in seen_in_file,
        )
        seen_in_file.add(identity)
        statuses.append(outcome.status)

        doc = frappe.new_doc(ROW_DOCTYPE)
        doc.update(
            {
                "import_batch": batch.name,
                "transfer_id": row.transfer_id,
                "reference_id": row.reference_id,
                "added_on": row.added_on,
                "amount": float(row.amount),
                "status_raw": row.status_raw,
                "beneficiary_name": row.beneficiary_name,
                "beneficiary_id": row.beneficiary_id,
                "bank_account": row.bank_account,
                "ifsc": row.ifsc,
                "remarks": row.remarks,
                "bank_reference_no": row.bank_reference_no,
                "service_charge": float(row.service_charge),
                "service_tax": float(row.service_tax),
                "added_by_raw": row.added_by_raw,
                "normalized_account": row.normalized_account,
                "normalized_reference": row.normalized_reference,
                "row_status": outcome.status,
                "skip_reason": outcome.note if outcome.status == "Skipped" else None,
            }
        )
        doc.insert(ignore_permissions=True)

    _apply_batch_rollup(batch, statuses)
    return batch


def _apply_batch_rollup(batch, statuses):
    """Write the derived counters and status. Both come from `status.py` -- the single deriver."""
    values = dict(derive_batch_counters(statuses))
    values["status"] = derive_batch_status(statuses)
    frappe.db.set_value(BATCH_DOCTYPE, batch.name, values, update_modified=False)
    batch.reload()


def _find_overlapping_batch(period_from, period_to):
    """The most recent earlier batch whose period overlaps this one.

    A WARNING ONLY (owner ruling) -- it never blocks. It is also NOT the duplicate guard: two
    exports can carry the same transfer with periods that do not overlap at all, and different
    transfers with periods that do. The precise guard is per-row on `transfer_id`.
    """
    if not period_from or not period_to:
        return None
    rows = frappe.db.sql(
        """
        SELECT name FROM "tabOutflow Import Batch"
        WHERE period_from IS NOT NULL AND period_to IS NOT NULL
          AND period_from <= %s AND period_to >= %s
        ORDER BY creation DESC
        LIMIT 1
        """,
        (period_to, period_from),
        as_dict=True,
    )
    return rows[0]["name"] if rows else None


def _summarize(batch, parsed):
    return {
        "batch": batch.name,
        "source": batch.source,
        "period_from": str(batch.period_from) if batch.period_from else None,
        "period_to": str(batch.period_to) if batch.period_to else None,
        "status": batch.status,
        "total_rows": batch.total_rows,
        "skipped_rows": batch.skipped_rows,
        "gross_amount": float(parsed.gross_amount),
        "charges_amount": float(parsed.charges_amount),
        "overlaps_batch": batch.overlaps_batch,
        "warnings": list(parsed.warnings),
        "duplicate_transfer_ids": list(parsed.duplicate_transfer_ids),
    }
