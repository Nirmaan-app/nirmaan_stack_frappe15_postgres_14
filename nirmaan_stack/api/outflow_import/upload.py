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
from nirmaan_stack.services.outflow_import.bank_exclusions import should_skip
from nirmaan_stack.services.outflow_import.candidates import find_earlier_batches_for_rows
from nirmaan_stack.services.outflow_import.duplicates import assess_duplicates, row_identity_of
from nirmaan_stack.services.outflow_import.parser import (
    DIRECTION_CREDIT,
    DIRECTION_DEBIT,
    SUPPORTED_SOURCES,
    StatementFormatError,
    describe_mapped_columns,
    is_terminal_status,
    parse_statement,
)
from nirmaan_stack.services.outflow_import.sources import (
    BANK_STATEMENT_SOURCES,
    source_has_settlement_path,
)
from nirmaan_stack.services.outflow_import.status import (
    ROW_SKIPPED,
    derive_batch_counters,
    derive_batch_status,
    derive_staged_row_outcome,
)

BATCH_DOCTYPE = "Outflow Import Batch"
ROW_DOCTYPE = "Outflow Import Row"

# Sources that are a BANK PASSBOOK rather than a payout gateway (slice B3).
#
# ⚠️ THE SET ITSELF MOVED TO `services/outflow_import/sources.py` AT SLICE B4, AND THE NAME HERE IS
# NOW AN ALIAS RATHER THAN A SECOND DEFINITION. `review.match_batch` has to ask the same question --
# an `api` module may not import another `api` module's private constant, so the choice was a second
# literal frozenset (free to drift the day a source is added) or one owner both may import. Read the
# capability rules, the measurement behind them and the "unknown source has a settlement path"
# default there; this line exists only so every call site below reads unchanged.
_BANK_STATEMENT_SOURCES = BANK_STATEMENT_SOURCES

# Q10: .xlsx alongside .csv, so the sheet format stops being something the accountant thinks about.
# The parser sniffs the actual format from the bytes -- this set only decides what we accept by
# name, and a renamed export still parses correctly.
_ALLOWED_EXTENSIONS = frozenset({".csv", ".xlsx"})

# Well under `save_file`'s own 10 MB cap. A statement is kilobytes; anything approaching this is a
# wrong file, and refusing it here gives a better message than the framework's.
_MAX_FILE_BYTES = 5 * 1024 * 1024

# --- the `sheet` preview block (slice C5) ---------------------------------------------------------
#
# A statement whose table is wrapped in a preamble gets a look at its own first rows, so a person can
# confirm which row was read as the header and re-pick it when auto-detection was wrong. These
# numbers shape that display and nothing else -- no parsing decision reads them.

#: How many sheet rows the preview shows: enough to reach the header row with a few rows of the
#: table under it, and never fewer than 60.
#:
#: ⚠️ THE GRID ALWAYS CONTAINS THE HEADER ROW, AND THAT IS THE INVARIANT THE PICKER IS BUILT ON.
#: There is deliberately NO upper bound other than the sheet's own length: a fixed cap is exactly
#: how the ONE row the whole screen is about goes missing from it -- a header at row 70 under a
#: 60-row cap would leave nothing to see and nothing to re-pick, on precisely the sheet that needed
#: the picker. It is bounded in practice by where headers actually sit (row 17 on both real exports).
_SHEET_GRID_MIN_ROWS = 60
_SHEET_GRID_ROWS_AFTER_HEADER = 5

#: Columns and characters are capped, because those two ARE bounded by what a person can read. A
#: cell longer than this is truncated with an ellipsis, so the display never claims a cell is
#: shorter than it is.
_SHEET_GRID_MAX_COLUMNS = 12
_SHEET_GRID_MAX_CELL_CHARS = 80


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

    payload = {
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

    # ⚠️ PRESENT ONLY WHERE THERE IS SOMETHING TO PICK. `parser` fills `bounds` for a source that
    # answers `sources.source_has_preamble` and leaves it `None` for every other -- so the key is
    # simply ABSENT for Cashfree and Cashbook and their preview payload is byte-identical to before.
    # A block full of trivially-true numbers would put a header picker on a screen with no question
    # on it.
    sheet = _sheet_payload(parsed)
    if sheet is not None:
        payload["sheet"] = sheet
    return payload


def _sheet_payload(parsed) -> dict | None:
    """What the Check step shows about the SHEET: where the table was found, and the rows above it.

    `None` for a source whose table is the whole file -- see the note at the call site.

    ⚠️ EVERY ROW NUMBER HERE IS 1-BASED AND `grid[0]` IS ALWAYS SHEET ROW 1. There is no offset
    field and one must never be added: the client's whole job is to map a row it can see to a row
    number it can post back, and a second convention is how a picker ends up selecting the row above
    the one the user clicked.
    """
    bounds = parsed.bounds
    if bounds is None:
        return None

    # Enough rows to reach the header with a few of the table under it, never fewer than the
    # minimum, and never more than the sheet has. See `_SHEET_GRID_MIN_ROWS` for why there is no cap.
    shown = min(
        bounds.total_rows,
        max(_SHEET_GRID_MIN_ROWS, bounds.header_row + _SHEET_GRID_ROWS_AFTER_HEADER),
    )
    rows = parsed.grid[:shown]
    width = min(_SHEET_GRID_MAX_COLUMNS, max((len(row) for row in rows), default=0))

    return {
        "detected_header_row": bounds.detected_header_row,
        "header_row_used": bounds.header_row,
        "was_overridden": bounds.was_overridden,
        "total_sheet_rows": bounds.total_rows,
        "table_start_row": bounds.first_data_row,
        "table_end_row": bounds.last_data_row,
        "trailing_rows_ignored": bounds.trailing_non_blank_rows,
        "grid_truncated": shown < bounds.total_rows,
        # Every row the same length, every cell a string, never null: the client renders this
        # straight into a table, and a ragged grid there is an off-by-one column on the short rows.
        "grid": [
            [_grid_cell(row[index] if index < len(row) else "") for index in range(width)]
            for row in rows
        ],
        # ⚠️ DERIVED FROM THE ADAPTER'S OWN COLUMN MAP, NEVER A SECOND HAND-WRITTEN LIST. This is
        # the screen's claim about what the parser will read, so a list maintained here would be
        # free to keep saying `Value Date` on the day the map started preferring `Transaction Date`
        # -- and the person would be confirming something that is not happening.
        "columns_read": describe_mapped_columns(
            parsed.source, parsed.grid[bounds.header_row - 1]
        ),
    }


def _grid_cell(value) -> str:
    """One preview cell: a trimmed string, truncated visibly rather than silently."""
    text = ("" if value is None else str(value)).strip()
    if len(text) > _SHEET_GRID_MAX_CELL_CHARS:
        return text[: _SHEET_GRID_MAX_CELL_CHARS - 1] + "…"
    return text


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

    header_row = _posted_header_row()

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
        parsed = parse_statement(file_content, source=source, header_row=header_row)
    except StatementFormatError as exc:
        frappe.throw(str(exc), title="Could not read this statement")

    return user, source, filename, file_content, parsed


def _posted_header_row() -> int | None:
    """The optional 1-based `header_row` multipart field, or `None` to auto-detect.

    ⚠️ IT IS READ HERE, INSIDE THE SHARED READ, AND THAT IS THE SAFETY PROPERTY OF THE WHOLE SLICE.
    The preview and the upload are two separate requests over the same bytes, and the person
    confirming has looked at a grid the preview rendered from ONE header row. Reading the field in
    each endpoint would let them diverge -- an upload that silently auto-detected while the preview
    had been overridden would stage a different table from the one that was approved, and every
    count on the confirm screen would be about rows nobody imported. Sharing the read makes that
    impossible rather than unlikely.

    ⚠️ ABSENT AND EMPTY BOTH MEAN AUTO-DETECT. A form field that is present but blank is what a
    browser sends for "I did not pick one", and treating it as junk would refuse the ordinary case.

    Anything else that is not a positive whole number is REFUSED by name rather than coerced: a
    silent `int()` failure would fall back to auto-detection, which is the one outcome a caller who
    bothered to send a row number did not ask for.
    """
    raw = (frappe.form_dict.get("header_row") or "").strip()
    if not raw:
        return None
    if not raw.isdigit() or int(raw) < 1:
        frappe.throw(
            f"'{raw}' is not a header row. Give the row number the table's headings are on, "
            "counting from 1.",
            title="Unreadable header row",
        )
    return int(raw)


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
    duplicates = sum(
        1 for row in parsed.rows if _row_identity(row, parsed.source) in already_imported
    )
    earliest = next(
        (already_imported[_row_identity(row, parsed.source)] for row in parsed.rows
         if _row_identity(row, parsed.source) in already_imported),
        None,
    )
    verdict = assess_duplicates(
        total=len(parsed.rows),
        duplicates=duplicates,
        earliest_batch=earliest,
        filename=filename,
    )
    return verdict, _find_overlapping_batch(parsed.period_from, parsed.period_to)


def _row_identity(row, source: str):
    """This row's duplicate identity, from the ONE definition -- now SOURCE-AWARE (slice B3).

    A one-line shim so the call sites in this file cannot each remember the tuple's shape
    differently. It exists because the identity WIDENED at slice D3, and widened again per source at
    B3; adding a further axis should be an edit to `duplicates.row_identity` and this line, not a
    hunt through the module.

    ⚠️ `source` IS REQUIRED RATHER THAN DEFAULTED, DELIBERATELY. A default would let a call site be
    added that forgets it and silently gets the narrow triple, which does not fail -- it stages an
    ICICI statement's SGST/CGST and general-ledger pairs as repeats of each other and loses five
    rows per file, with nothing on screen to say so. The parameter costs a word; the default would
    cost the whole reason this widened.
    """
    return row_identity_of(row, source)


def _exclusion_category(row, source: str) -> str:
    """The `bank_exclusions` category that says this line is not spending, or `""` to ingest it.

    THE ADAPTER BETWEEN THE PARSED ROW AND THE PURE RULESET, and it exists because the two describe
    the same fact differently: the statement has a Withdrawal column and a Deposit column,
    `bank_exclusions.should_skip` still reads them that way (its design rule (b) -- every rule leads
    with a direction), while the parser has already collapsed the pair into one positive `amount`
    plus a `direction` label. This puts the pair back together for the length of one call.

    ⚠️ IT RE-EXPANDS THE PAIR; IT DOES NOT RE-DERIVE IT. `parser` resolved the two columns ONCE, up
    front, precisely so nothing downstream gets a second chance to disagree about which one was
    populated. This reads that verdict and must never reach for the raw cells again.

    ⚠️ EXCLUSIONS ARE GATED ON THE SOURCE, and the gate is not decoration. Cashfree and Cashbook
    carry live settled data and no direction at all, and the ten rules were fitted to ONE bank
    account's narrations -- `CASHFREEID` and `cash\\s*free` appear in this ruleset as the names of
    WALLET TOP-UPS seen from the bank's side, so running it over a Cashfree payout export would
    match its own rows and skip real disbursements.

    ⚠️ A BLANK DIRECTION FAILS OPEN -- the row is INGESTED and no rule is even tried. That is
    `bank_exclusions` design rule (a) applied one layer up: a blank direction means the parser found
    a figure in BOTH money columns, refused to guess which one was the transaction, and warned. With
    no direction there is no honest way to evaluate a rule that leads with one, and a wrongly
    ingested row is visible on the staging list while a wrongly dropped one is invisible forever.
    """
    if source not in _BANK_STATEMENT_SOURCES:
        return ""
    direction = getattr(row, "direction", "") or ""
    if direction == DIRECTION_DEBIT:
        withdrawal, deposit = row.amount, None
    elif direction == DIRECTION_CREDIT:
        withdrawal, deposit = None, row.amount
    else:
        return ""
    skip, category = should_skip(row.remarks, withdrawal, deposit)
    return category if skip else ""


def _already_imported(parsed, exclude_batch: str | None = None) -> dict:
    """The duplicate lookup, NARROWED BY PERIOD FIRST (owner-directed, slice V3).

    One call site's worth of policy, kept in one place so the preview, the staging pass and any
    later caller all narrow identically -- a preview that searched wider than the import would
    report duplicates the import then staged anyway.

    ⚠️ IT HANDS OVER THE ROWS, NOT THEIR IDS (slice D3). Identity starts at
    `(transfer_id, amount, date)`, so the amount and the date have to travel with the question; the
    returned map is keyed by that same tuple, which is why every caller here looks up through
    `_row_identity`.

    ⚠️ AND IT HANDS OVER THE SOURCE (slice B3), BECAUSE THE SOURCE CHOOSES THE KEY. The map this
    returns is keyed by the identity and the callers look up by recomputing it, so the two have to
    be computing the same shape. Drop `source` here and every ICICI lookup misses -- which does not
    raise, it just reports a re-uploaded statement as entirely new and stages all 1,274 rows again.
    """
    return find_earlier_batches_for_rows(
        parsed.rows,
        exclude_batch=exclude_batch,
        period_from=parsed.period_from,
        period_to=parsed.period_to,
        source=parsed.source,
    )


def _stage_batch(parsed, file_url: str, filename: str, user: str):
    """Create the batch and one row per parsed transfer. No matching happens here -- that is S4.

    ⚠️ EVERY PARSED ROW IS STAGED, INCLUDING THE ONES WE HAVE ALREADY DECIDED ARE NOT WORK (slice
    B3). A bank statement carries hundreds of lines that are not spending at all -- wallet top-ups,
    the bank's own ledger shuffles, failed payments bouncing home -- and 405 of the real 1,274 match
    a `bank_exclusions` rule. They are staged `Skipped`, carrying the id of the rule that decided
    it, rather than dropped at the door. The rows are cheap and the alternative is not: a dropped
    row is an absence, and nobody can review, count or argue with an absence. It is the same
    contract the parser already keeps for a FAILED transfer, for the same reason.
    """
    overlaps = _find_overlapping_batch(parsed.period_from, parsed.period_to)
    already_imported = _already_imported(parsed)
    # Resolved ONCE per batch rather than per row: it is a fact about the statement, and asking it
    # 1,274 times invites a call site that asks it differently.
    #
    # ⚠️ THROUGH THE NAMED PREDICATE, NOT A MEMBERSHIP TEST (slice B4). `review.match_batch` reads
    # the SAME question to decide whether to offer this statement a settlement candidate at all, and
    # a staging decision that said `Mismatched` while the match run still ran the tier ladder would
    # be the two halves of one ruling disagreeing.
    no_settlement_path = not source_has_settlement_path(parsed.source)

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
        identity = _row_identity(row, parsed.source)
        outcome = derive_staged_row_outcome(
            row,
            already_imported.get(identity),
            duplicate_in_file=identity in seen_in_file,
            excluded_category=_exclusion_category(row, parsed.source),
            no_settlement_path=no_settlement_path,
        )
        # ⚠️ ONLY A TERMINAL ROW JOINS THE SET, matching the rule the CROSS-BATCH lookup now applies
        # (`candidates.find_earlier_batches_for_rows`). The two ask the same question of different
        # populations, so a row that could block a later import from an earlier BATCH but not from
        # an earlier LINE would be the two-answers-about-one-file split the comment above exists to
        # prevent. An export is a snapshot and should never list one transfer twice, so this is
        # closing the shape rather than a case seen in the wild.
        if is_terminal_status(row.status_raw):
            seen_in_file.add(identity)
        statuses.append(outcome.status)

        doc = frappe.new_doc(ROW_DOCTYPE)
        doc.update(
            {
                "import_batch": batch.name,
                # Denormalised from the batch so the master table can filter by source without a
                # join -- see `review._FACET_COLUMNS`.
                "source": parsed.source,
                "transfer_id": row.transfer_id,
                "reference_id": row.reference_id,
                "added_on": row.added_on,
                "amount": float(row.amount),
                # ⚠️ THE DIRECTION IS A FIELD, NEVER A SIGN ON THE AMOUNT (slice B3). `amount` stays
                # the positive magnitude the statement printed, on every source. `amounts_match`,
                # both SQL pool queries, the settle guard and every summary sum assume a positive
                # magnitude -- a negative would pass all of them and do the wrong thing quietly.
                # Blank where the statement did not say, and blank is NOT "Debit by default".
                "direction": row.direction,
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
                # ONE note on the outcome, TWO fields to land it in, and the split is the doctype's:
                # `skip_reason` says why nothing will be done, `outcome_note` says what was found.
                # Written from the same `outcome.note` so they can never disagree, and exactly one
                # of them is ever non-null. `or None` rather than the bare note so an EMPTY note
                # stays NULL instead of becoming `''`: `Pending match run` carries no note, and
                # before B3 this field was not written at all on a staged row. Cashfree and Cashbook
                # therefore land byte-identically to before.
                "skip_reason": outcome.note if outcome.status == ROW_SKIPPED else None,
                "outcome_note": (outcome.note or None) if outcome.status != ROW_SKIPPED else None,
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
