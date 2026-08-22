"""Snag import wizard endpoints -- inspect / preview / ingest.

Thin orchestrators only (ADR-0010 B4): every parsing decision lives in the pure
`nirmaan_stack.services.snag_parser` package. This module fetches bytes, calls the
parser, adds the things the parser cannot know (duplicates against the database),
and persists.

Wire contract: `frontend/src/pages/SnagList/types.ts`
  inspect_workbook  -> InspectWorkbookResponse
  get_sheet_columns -> GetSheetColumnsResponse
  parse_preview     -> ParsePreviewResponse
  ingest_batches    -> IngestBatchesResponse
"""

from __future__ import annotations

import json
import os
import re

import frappe
from frappe.utils import now
from frappe.utils.file_manager import save_file

from nirmaan_stack.api.snags import require_import_access
from nirmaan_stack.api.snags import file_io

_WHITESPACE = re.compile(r"\s+")

_MAPPING_KEYS = ("area", "category", "description", "remarks")


# ---------------------------------------------------------------------------
# Parser seam
# ---------------------------------------------------------------------------
# The parser package is imported LAZILY through these accessors, never at module import.
# Two reasons: (1) an import-time dependency would make every whitelisted method in
# this file unresolvable if the parser package is mid-build, and (2) together with
# `_load_grid` they are the seams the API tests stub, so the API layer can be tested
# without spending a real workbook parse. Do not inline these imports back into the
# endpoints.


def _reader():
    from nirmaan_stack.services.snag_parser import reader  # noqa: PLC0415

    return reader


def _parser():
    from nirmaan_stack.services.snag_parser import parser  # noqa: PLC0415

    return parser


def _guess():
    from nirmaan_stack.services.snag_parser import guess  # noqa: PLC0415

    return guess


def _load_grid(path, sheet_name):
    """Read ONE sheet's cell grid. The only openpyxl touch in this module.

    `parse_preview` has to answer "what are the column labels AT the header row the user
    settled on", and those labels are literally that row's cells -- so an override changes
    them. The grid is the input `reader.columns_for_header_row` needs, and going through
    this one function keeps the workbook-open out of the endpoint body and gives the API
    tests a fourth stub seam beside `_reader` / `_parser` / `_guess` (they never open a real
    workbook). It is a SECOND read of the same file -- `parse_sheet` takes a path, not a
    grid -- which is accepted: the file is already on local disk by here, and the
    alternative is a parser entry point that returns both, owned by another module.
    """
    import openpyxl  # noqa: PLC0415

    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        if sheet_name not in workbook.sheetnames:
            frappe.throw(
                f"Sheet '{sheet_name}' is not in this workbook.",
                title="Sheet not found",
            )
        return _reader().read_grid(workbook[sheet_name])
    finally:
        try:
            workbook.close()
        except Exception:  # noqa: BLE001 - closing a read-only workbook must never mask a parse error
            pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _assert_project(project):
    if not project:
        frappe.throw("project is required.", title="Missing field: project")
    if not frappe.db.exists("Projects", project):
        frappe.throw(f"Project '{project}' not found.", title="Not found")


def _coerce_mapping(mapping):
    """Accept a dict or a JSON string; return a SnagColumnMapping-shaped dict.

    `description` is the only REQUIRED mapping -- row detection keys on it (plan section 4).
    """
    parsed = frappe.parse_json(mapping) if isinstance(mapping, str) else mapping
    if not isinstance(parsed, dict):
        frappe.throw("mapping must be an object.", title="Bad mapping")

    out = {key: (parsed.get(key) or None) for key in _MAPPING_KEYS}
    if not out["description"]:
        frappe.throw(
            "A Description column must be mapped -- row detection keys on it.",
            title="Description column not mapped",
        )
    return out


def _dup_key(area, description):
    """Normalised duplicate identity: case-insensitive, internal whitespace collapsed."""
    area = _WHITESPACE.sub(" ", (area or "").strip()).lower()
    description = _WHITESPACE.sub(" ", (description or "").strip()).lower()
    return (area, description)


def _existing_dup_keys(project):
    """Every (area, description) pair already recorded for this project, normalised.

    ONE query for the whole sheet -- a per-row `db.exists` would be N round trips on a
    preview the user re-triggers on every mapping change.
    """
    rows = frappe.get_all(
        "Project Snag",
        filters={"project": project},
        fields=["area", "description"],
        limit_page_length=0,
    )
    return {_dup_key(r.get("area"), r.get("description")) for r in rows}


def _coerce_header_row(header_row):
    """Accept None / "" / a numeric string; return a positive int or None.

    None means "the caller did not override it" -- the parser then auto-guesses. A value
    that is not a positive integer is a client bug, not a user choice, so it is refused
    loudly rather than silently falling back to the guess (a silent fallback would parse a
    different sheet region than the one the preview showed).
    """
    if header_row is None or header_row == "":
        return None
    try:
        value = int(header_row)
    except (TypeError, ValueError):
        frappe.throw(
            f"header_row must be a whole number, got {header_row!r}.",
            title="Bad header row",
        )
    if value < 1:
        frappe.throw(
            f"header_row must be a 1-based Excel row number, got {value}.",
            title="Bad header row",
        )
    return value


def _shape_row(row, is_duplicate):
    """Project a parser row onto ParsedSnagRow, key for key.

    ONE merged list: `skipped_reason` (None for an accepted row) is what tells the two
    apart on the wire. A skipped row carries its area/category/description too, because
    the user may re-tick it and the preview must show what it would import.
    """
    return {
        "source_row": row.get("source_row"),
        "area": row.get("area") or "",
        "category": row.get("category") or "",
        "description": row.get("description") or "",
        "remark": row.get("remark") or "",
        "is_duplicate": bool(is_duplicate),
        "skipped_reason": row.get("skipped_reason") or None,
        # `tickable` is the parser's answer to "does this row have a description" --
        # False iff it does not. Never re-derived here; one owner.
        # ⚠️ ADR-0019: it GATES NOTHING any more, on either side of the wire. It survives
        # only to drive the row's explanation in the preview. Do not reintroduce a
        # server-side refusal keyed on it.
        "tickable": bool(row.get("tickable")),
        "preview_text": row.get("preview_text") or "",
    }


def _description_for(row):
    """The text a ticked row imports as. NEVER invented (ADR-0019).

    A human tick is authoritative, so a row with no MAPPED description still imports. Its
    description falls back to `preview_text` -- the row's first non-empty cell, which the
    parser already computes and the preview already shows the user. On the certified
    fixture that turns a ticked tally row into a snag reading `RISK SUMMARY`, which is what
    that row actually says.

    When there is nothing anywhere the description is BLANK, and that is the correct
    outcome: a placeholder like "(no description)" was rejected because a reader cannot
    tell our words from the consultant's, and a blank box is honest where a manufactured
    sentence is not. `Project Snag.description` lost `reqd` for exactly this.

    The value is returned VERBATIM -- only the emptiness TEST strips, so a description of
    whitespace still yields the fallback while a real value keeps its own formatting.
    """
    description = row.get("description") or ""
    if description.strip():
        return description
    return row.get("preview_text") or ""


# ---------------------------------------------------------------------------
# Step 1 -- upload + inspect
# ---------------------------------------------------------------------------


@frappe.whitelist(methods=["POST"])
def inspect_workbook():
    """multipart POST: file, project -> InspectWorkbookResponse.

    S3 safety (root CLAUDE.md, "BoQ File Reading"): the bytes are captured HERE, written
    to a NamedTemporaryFile and parsed from that. The stored File's `file_url` is an API
    redirect the moment the attachment plugin has run, so a local path built from it does
    not exist. The upload is persisted only AFTER the workbook reads cleanly, so a
    rejected file leaves no attachment behind.
    """
    project = frappe.form_dict.get("project")
    _assert_project(project)
    require_import_access("import a snag list")

    files = frappe.request.files if frappe.request else None
    if not files or "file" not in files:
        frappe.throw("No file uploaded.", title="Missing file")

    uploaded = files["file"]
    file_name = uploaded.filename or ""
    file_bytes = uploaded.read()
    file_io.validate_upload(file_name, file_bytes)

    tmp_path = file_io.write_bytes_to_tempfile(file_bytes, file_name)
    try:
        sheets = _reader().inspect_workbook(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    stored = save_file(
        fname=file_name,
        content=file_bytes,
        dt="Projects",
        dn=project,
        is_private=1,
    )
    frappe.db.commit()

    return {
        "file_url": stored.file_url,
        "file_name": file_name,
        "sheets": sheets,
    }


# ---------------------------------------------------------------------------
# Step 1b -- columns for a header row (writes NOTHING, needs NO mapping)
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_sheet_columns(file_url=None, sheet_name=None, header_row=None):
    """Column labels AT one header row -> GetSheetColumnsResponse. Writes nothing.

    THIS ENDPOINT EXISTS TO BREAK A DEADLOCK (Revision 3, R3.1). `parse_preview` also
    returns `columns`, but it hard-refuses without a mapped Description (`_coerce_mapping`),
    so it can never be the call that hands you the columns you need IN ORDER TO PICK a
    Description. The circle was: new labels come only from `parse_preview` -> `parse_preview`
    needs a Description -> you cannot choose one without the labels. A sheet whose header
    auto-detection failed came back with `columns: []`, the UI told the user to type the
    Excel row number, and every keystroke was swallowed by the client's mapping-valid gate.
    Forever.

    So this call REQUIRES NO MAPPING, and that is the entire point -- do not add one, and
    do not "unify" it back into `parse_preview`.

    `header_row=None` is resolved exactly as the parser resolves it (`reader.find_header_row`),
    and the row ACTUALLY USED is returned -- never a bare echo of the argument, so the client
    can show which row the labels came from even when it sent nothing.

    Same permission tier as `parse_preview`: this reads a project's uploaded workbook.
    """
    if not file_url:
        frappe.throw("file_url is required.", title="Missing field: file_url")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    require_import_access("preview a snag import")
    # The SAME coercion `parse_preview` applies: a non-positive or non-numeric row is a
    # client bug, refused loudly rather than silently falling back to the auto-guess (a
    # silent fallback would show labels from a row the user did not name).
    header_row = _coerce_header_row(header_row)

    tmp_path = file_io._fetch_file_to_tempfile(file_url)
    try:
        grid = _load_grid(tmp_path, sheet_name)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    used_header_row = header_row if header_row is not None else _reader().find_header_row(grid)
    columns = _reader().columns_for_header_row(grid, used_header_row) or []

    return {
        "header_row": used_header_row,
        "columns": columns,
        # `None` when nothing matched -- the client must NOT treat that as "no columns".
        # That conflation is half of the defect this endpoint fixes.
        "mapping_guess": _guess().guess_mapping(columns),
    }


# ---------------------------------------------------------------------------
# Step 2 -- preview (writes NOTHING)
# ---------------------------------------------------------------------------


@frappe.whitelist()
def parse_preview(project=None, file_url=None, sheet_name=None, mapping=None, header_row=None):
    """Parse one sheet under one mapping + header row, and flag duplicates. Writes nothing.

    `is_duplicate` is the one thing the pure parser cannot know: it compares each parsed
    row against the Snags ALREADY in this project on (area + description), case-insensitively
    with internal whitespace collapsed. It is a warning, never a block -- a defect can
    genuinely recur (plan section 4).

    `header_row` is the user's override, or None to take the parser's guess. The response
    carries `columns` RECOMPUTED for the header row actually used, plus a `mapping_guess`
    re-guessed against them: a header-row change moves which cells the labels come from, so
    the mapping selects have to re-render from THIS list. Carrying them here is why there is
    no second "re-inspect" endpoint -- and why the preview and the mapping UI can never
    disagree about which row the labels came from.
    """
    _assert_project(project)
    require_import_access("preview a snag import")
    mapping = _coerce_mapping(mapping)
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    header_row = _coerce_header_row(header_row)

    tmp_path = file_io._fetch_file_to_tempfile(file_url)
    try:
        parsed = _parser().parse_sheet(tmp_path, sheet_name, mapping, header_row=header_row)
        # The header row ACTUALLY used -- the override, or the parser's own guess. The
        # columns are recomputed against THAT, never against the caller's argument, so a
        # None override still returns the labels the preview was built from.
        used_header_row = parsed.get("header_row")
        grid = _load_grid(tmp_path, sheet_name)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    columns = _reader().columns_for_header_row(grid, used_header_row) or []

    existing = _existing_dup_keys(project)

    rows = []
    duplicate_count = 0
    for row in parsed.get("rows") or []:
        is_duplicate = _dup_key(row.get("area"), row.get("description")) in existing
        shaped = _shape_row(row, is_duplicate)
        # `duplicate_count` counts ACCEPTED rows only -- unchanged meaning from before the
        # lists were merged. A skipped row is not being imported, so counting it would
        # inflate a warning about work the user is not about to do. The FLAG is still set
        # on every row, so a re-ticked skipped row shows its duplicate badge immediately.
        if is_duplicate and shaped["skipped_reason"] is None:
            duplicate_count += 1
        rows.append(shaped)

    return {
        "sheet_name": parsed.get("sheet_name") or sheet_name,
        "header_row": used_header_row,
        "columns": columns,
        "mapping_guess": _guess().guess_mapping(columns),
        "rows": rows,
        "accepted_count": parsed.get("accepted_count") or 0,
        "skipped_count": parsed.get("skipped_count") or 0,
        "distinct_areas": parsed.get("distinct_areas") or [],
        "distinct_categories": parsed.get("distinct_categories") or [],
        "duplicate_count": duplicate_count,
    }


# ---------------------------------------------------------------------------
# Step 3 -- ingest
# ---------------------------------------------------------------------------


def _ingest_one_sheet(project, file_url, entry):
    """Create ONE `Project Snag Batch` plus its Snags. Returns a SheetIngestResult body.

    Caller owns the savepoint -- this raises on any failure so the caller can roll THIS
    sheet back and leave the others standing.
    """
    sheet_name = entry.get("sheet_name")
    if not sheet_name:
        raise ValueError("sheet_name is required for every batch entry.")

    batch_name = (entry.get("batch_name") or "").strip() or sheet_name
    mapping = _coerce_mapping(entry.get("mapping"))
    accepted = {int(r) for r in (entry.get("accepted_rows") or [])}
    # The SAME header row the preview was computed with. Without it the re-parse silently
    # reads a different region of the sheet than the one the user approved, and the ticked
    # row numbers then address rows nobody looked at.
    header_row = _coerce_header_row(entry.get("header_row"))

    tmp_path = file_io._fetch_file_to_tempfile(file_url)
    try:
        parsed = _parser().parse_sheet(tmp_path, sheet_name, mapping, header_row=header_row)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    # The server re-parses and filters to the rows the user left TICKED -- the client
    # never sends row CONTENT, so a tampered payload cannot invent a snag.
    #
    # `parsed["rows"]` is ONE merged list, accepted and skipped interleaved in Excel row
    # order, and the filter runs over ALL of it. That is the whole point: the preview lets
    # the user re-tick a row the parser skipped, and this is where that promise is kept.
    # Filtering the accepted rows alone is exactly the bug this replaced -- a re-ticked row
    # was not in the list being filtered, so it vanished with no error and `imported` came
    # back lower than the footer promised.
    # EVERY ticked row that exists in the parse is imported (ADR-0019). There is no
    # importability filter here any more: the tick is the human's decision and this layer
    # does not overrule it. A row with no description takes `_description_for`'s fallback.
    rows = [r for r in (parsed.get("rows") or []) if r.get("source_row") in accepted]

    if not rows:
        # TWO genuinely different failures, two different messages. The single
        # "No accepted rows were found" this replaced read like a parser crash whichever
        # one had actually happened.
        #
        # There used to be a THIRD -- "everything you ticked has no description". ADR-0019
        # made it unreachable, so it is gone rather than left as a message that can never
        # fire (a dead branch reads as a live rule to the next person here).
        if not accepted:
            raise ValueError(
                f"No rows were ticked for sheet '{sheet_name}'. Nothing was imported."
            )
        raise ValueError(
            f"None of the {len(accepted)} ticked row(s) exist in sheet '{sheet_name}' as it "
            f"parses now. Nothing was imported -- re-check the header row and re-preview."
        )

    batch = frappe.get_doc(
        {
            "doctype": "Project Snag Batch",
            "project": project,
            "batch_name": batch_name,
            "source_sheet": sheet_name,
            "source_file": file_url,
            "uploaded_by": frappe.session.user,
            "uploaded_on": now(),
            "snag_count": len(rows),
            "column_mapping": json.dumps(mapping),
        }
    )
    batch.insert(ignore_permissions=True)

    for row in rows:
        frappe.get_doc(
            {
                "doctype": "Project Snag",
                "project": project,
                "batch": batch.name,
                "area": row.get("area") or "",
                "category": row.get("category") or "",
                # ADR-0019: the mapped text, else the row's first non-empty cell, else
                # blank. Never an invented placeholder.
                "description": _description_for(row),
                # The source file's own Status vocabulary is not ours -- every imported
                # snag starts at Pending (plan section 2).
                "status": "Pending",
                # ONE remark field (ADR-0018). It arrives holding the source author's
                # text and is overwritten by whoever next changes this snag's status.
                "remark": row.get("remark") or "",
                "source_row": row.get("source_row"),
            }
        ).insert(ignore_permissions=True)

    return {
        "sheet_name": sheet_name,
        "ok": True,
        "batch": batch.name,
        "batch_name": batch.batch_name,
        "imported": len(rows),
        # ADR-0019-DEAD: structurally always 0 -- nothing is refused any more. RETAINED on
        # the wire rather than deleted, deliberately: it is the counter that proved
        # Revision 2's silent-drop bug fixed, and a result payload that can still SAY
        # "nothing was refused" is worth more than one that cannot express the question.
        "refused_no_description": 0,
    }


@frappe.whitelist(methods=["POST"])
def ingest_batches(project=None, file_url=None, file_name=None, batches=None):
    """Create one Batch per entry, with PER-SHEET FAILURE ISOLATION.

    Each sheet runs inside its own savepoint: a sheet that raises is rolled back to that
    savepoint and reported with its error, and every OTHER sheet still imports. A silent
    partial success is a defect, so each failure is also written to the Error Log.

    `file_name` is accepted for provenance/logging; the batch's durable pointer to the
    workbook is `source_file = file_url`.
    """
    _assert_project(project)
    require_import_access("import a snag list")

    batches = frappe.parse_json(batches) if isinstance(batches, str) else batches
    if not isinstance(batches, list) or not batches:
        frappe.throw("No sheets were selected for import.", title="Nothing to import")

    results = []
    for index, entry in enumerate(batches):
        sheet_name = (entry or {}).get("sheet_name") or f"sheet #{index + 1}"
        save_point = f"snag_ingest_{index}"
        frappe.db.savepoint(save_point)
        try:
            results.append(_ingest_one_sheet(project, file_url, entry or {}))
        except Exception as exc:
            frappe.db.rollback(save_point=save_point)
            frappe.log_error(
                title="Snag ingest failed for one sheet",
                message=(
                    f"project={project!r} file_name={file_name!r} file_url={file_url!r}\n"
                    f"sheet={sheet_name!r}\n\n{frappe.get_traceback()}"
                ),
            )
            results.append({"sheet_name": sheet_name, "ok": False, "error": str(exc)})

    frappe.db.commit()

    return {
        "results": results,
        "total_imported": sum(r.get("imported") or 0 for r in results if r.get("ok")),
        "failed_count": sum(1 for r in results if not r.get("ok")),
    }
