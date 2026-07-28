"""S4 config column-diff CARRY -- the impure reader/orchestrator (ADR-0014 D5, #1101).

Split out of `revision.py` (which stays the entry + mapping owner) so each module changes
for one reason. The PURE decision lives in `services/boq_revision/column_diff.py`; this
module reads the committed tiers + the revised workbook and hands the primitives to it.

At seeding, a matched DATA sheet's columns are diffed against the original's committed grid.
The SEED is ALWAYS the original's rectified role map -- never a fresh auto-guess. The per-sheet
diagnostics (dangling roles / description-set change / reasons) are RETURNED so the caller can
surface them; they are deliberately NOT persisted (D5: no new schema -- the disposition rides
`wizard_status` + the seeded `sheet_config`).

⚠️ AMENDED (Amendment B W4 / A2, 2026-07-21): `SheetCarry.status` is now purely a DIAGNOSIS.
It used to be written straight to `wizard_status`, so a structurally clean sheet landed
`Config Done` and was never seen by a human. The owner's call: a revision's config is attested
ONCE per sheet regardless -- a clean diff is evidence, not consent -- so `revision.py` now
persists `Pending` unconditionally and reports this `status` only in its `dispositions[]`
payload. The diff logic below is UNCHANGED; only its consumer moved.

`carry_work_packages` ships WITH that change and is not optional: an attestable sheet needs at
least one work package (`SheetConfigPanel`'s Config-Done checkbox is disabled without one), so
landing every sheet at `Pending` without carrying the original's work packages would leave the
button we now depend on permanently unclickable.
"""

import os
from dataclasses import dataclass, field

import frappe

from nirmaan_stack.services.boq_revision.column_diff import (
    diff_columns,
    summarize_columns,
)


@dataclass(frozen=True)
class CommittedDataSheet:
    """The original's committed DATA config, ready to seed + diff.

    Bundles the header-row locator (`header_row` + `header_row_count` -- they always travel
    together) with the seed `config` blob and its `role_map`, so the pieces move as one value.
    """

    config: dict          # the 6-key seed sheet_config blob (inverts the commit snapshot)
    role_map: dict        # committed column_role_map: {col_letter: {"role", "area"}}
    header_row: int
    header_row_count: int


@dataclass(frozen=True)
class SheetCarry:
    """One mapped data sheet's carry outcome."""

    config_json: str          # the seed sheet_config, JSON-encoded
    status: str               # DIAGNOSIS only (W4): "Config Done" (clean) | "Pending" (unsafe).
                              # NOT the persisted wizard_status -- see the module docstring.
    reasons: list[str] = field(default_factory=list)
    dangling_roles: list[str] = field(default_factory=list)
    description_set_changed: bool = False


def _as_dict(val) -> dict:
    """A Frappe JSON field arrives as a dict or a JSON string; coerce to a dict."""
    if not val:
        return {}
    if isinstance(val, str):
        try:
            parsed = frappe.parse_json(val)
        except (ValueError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return val if isinstance(val, dict) else {}


def _as_list(val) -> list:
    """A Frappe JSON field arrives as a list or a JSON string; coerce to a list."""
    if not val:
        return []
    if isinstance(val, str):
        try:
            parsed = frappe.parse_json(val)
        except (ValueError, TypeError):
            return []
        return parsed if isinstance(parsed, list) else []
    return val if isinstance(val, list) else []


def current_committed_sheets(source_boq: str, sheet_names=None, fields=None) -> list:
    """A BoQ's CURRENT committed `BoQ Sheet` rows, optionally restricted to `sheet_names`.

    ⚠️ THE RESTRICTION IS APPLIED IN PYTHON, NEVER THROUGH A FRAPPE `["in", [...]]` FILTER.
    `DatabaseQuery.prepare_filter_condition` STRIPS every value of an `in` list --
    `frappe/model/db_query.py`: `[escape((cstr(v) or "").strip()) for v in values]` -- so a real
    sheet name carrying leading/trailing whitespace matches NOTHING and drops out of the result
    with no error. Sheet names DO carry whitespace in production data (#152 exists for exactly
    this), so an `in`-filtered read here is a silent data loss, not a theoretical one: it dropped
    'FDA ' / 'PA ' / 'ACCESS ' / 'CCTV  ' from the work-package carry on live revisions.

    An `=` comparison is NOT stripped, which is why the single-sheet readers
    (`_committed_data_sheet`, `cross_boq_carry._resolve_sheet_carry`) were never affected -- and
    why the mapping screen could report zero carryable rates for a sheet the carry then landed.

    ONE home for both callers (`read_committed_work_packages` here + `revision._carry_counts`), so
    the count and the carry cannot diverge again. Same shape as
    `cross_boq_carry._dest_committed_sheets`, which already filtered in Python and was correct.
    sheet_name VERBATIM (#152).
    """
    rows = frappe.get_all(
        "BoQ Sheet",
        filters={"boq": source_boq, "is_current": 1},
        fields=fields or ["name", "sheet_name"],
    )
    if sheet_names is None:
        return rows
    wanted = set(sheet_names)
    return [r for r in rows if r.sheet_name in wanted]


def _committed_data_sheet(source_boq: str, source_sheet: str) -> CommittedDataSheet | None:
    """The original's CURRENT committed DATA config, or None when nothing is carryable.

    None for: no `BoQ Sheet` row, a general-specs sheet (`treat_as == "master_preamble"`,
    handled separately), or a data sheet with no header_row (a data sheet always has one --
    defensive). The seed blob INVERTS the commit snapshot (`commit_pipeline.
    _write_committed_boq_sheet` pins exactly these 6 keys from the draft's sheet_config):
    header_row / header_row_count / treat_as + the JSON column_role_map / column_headers /
    area_dimensions. `sheet_name` is deliberately OMITTED -- production blobs omit it and the
    parser injects it at validation time (`parse_run._validate_sheet_blob`).
    """
    row = frappe.db.get_value(
        "BoQ Sheet",
        {"boq": source_boq, "sheet_name": source_sheet, "is_current": 1},
        ["header_row", "header_row_count", "treat_as",
         "column_role_map", "column_headers", "area_dimensions"],
        as_dict=True,
    )
    if not row or row.treat_as != "data" or not row.header_row:
        return None
    role_map = _as_dict(row.column_role_map)
    header_row_count = row.header_row_count or 1
    config = {
        "header_row": row.header_row,
        "header_row_count": header_row_count,
        "treat_as": "data",
        "column_role_map": role_map,
        "column_headers": _as_dict(row.column_headers),  # dead data ({}), carried verbatim
        "area_dimensions": _as_list(row.area_dimensions),
    }
    return CommittedDataSheet(
        config=config, role_map=role_map,
        header_row=row.header_row, header_row_count=header_row_count,
    )


def _original_header_cells(
    source_boq: str, source_sheet: str, header_row: int, header_row_count: int
) -> dict[str, str]:
    """The original's committed header row(s) as {col_letter: header text} (D5 baseline).

    Read from the committed GRID (`BoQ Committed Sheet Grid Row.cells` at row_number ==
    header_row .. header_row + count - 1) -- NEVER `column_headers` (dead data). Returns {}
    when there is no header row in the grid (a template-origin original whose grid was
    inverted from the role map) -- the diff then degrades that sheet to the safe branch.
    """
    grid = frappe.db.get_value(
        "BoQ Committed Sheet Grid",
        {"boq": source_boq, "source_sheet_name": source_sheet, "is_current": 1},
        "name",
    )
    if not grid:
        return {}
    header_row_numbers = list(range(header_row, header_row + header_row_count))
    grid_rows = frappe.get_all(
        "BoQ Committed Sheet Grid Row",
        filters={"parent": grid, "row_number": ["in", header_row_numbers]},
        fields=["row_number", "cells"],
    )
    rows = [{"row_number": r.row_number, "cells": _as_dict(r.cells)} for r in grid_rows]
    header_cells, _universe = summarize_columns(rows, header_row_numbers)
    return header_cells


def _read_revised_columns(source_file_url: str, sheet_specs: dict) -> dict:
    """Read the revised workbook's header text + column universe for the given sheets (D5).

    `sheet_specs`: {tab_name (VERBATIM #152): (header_row, header_row_count)}. Returns
    {tab_name: {"header_cells": {col: text}, "universe": {col letters}}} -- one worksheet pass
    per requested sheet via the certified `sheet_preview._extract_grid_rows` transform (so the
    read never diverges from the previewed/committed grid). Tabs absent from the workbook are
    omitted (the caller degrades them to Pending).

    Module-level (like `_read_revised_tab_names`) so tests can stub the whole workbook read.
    S3-safety: bytes via `_fetch_boq_file_to_tempfile`, NEVER a local path from `file_url`.
    """
    import openpyxl  # noqa: PLC0415

    from nirmaan_stack.api.boq.wizard.sheet_preview import (  # noqa: PLC0415
        _extract_grid_rows,
        _fetch_boq_file_to_tempfile,
    )

    if not source_file_url or not sheet_specs:
        return {}
    tmp = _fetch_boq_file_to_tempfile(source_file_url)
    wb = None
    out: dict = {}
    try:
        wb = openpyxl.load_workbook(tmp, read_only=True, data_only=True)
        by_title = {ws.title: ws for ws in wb.worksheets}
        for tab, (header_row, header_row_count) in sheet_specs.items():
            ws = by_title.get(tab)
            if ws is None:
                continue
            rows = _extract_grid_rows(ws)  # certified worksheet -> [{row_number, cells}]
            header_row_numbers = range(header_row, header_row + (header_row_count or 1))
            header_cells, universe = summarize_columns(rows, header_row_numbers)
            out[tab] = {"header_cells": header_cells, "universe": universe}
    finally:
        if wb is not None:
            wb.close()
        try:
            os.remove(tmp)
        except OSError:
            pass
    return out


def carry_config_dispositions(
    source_boq: str, source_file_url: str, source_by_tab: dict
) -> dict:
    """Decide the config carry + disposition per mapped DATA tab (D5).

    `source_by_tab`: {revised_tab: original committed DATA sheet_name} -- NON-general-specs
    mapped tabs only. Returns {tab: SheetCarry}; a tab with no carryable committed data config
    is absent (the caller leaves it Pending with no config, as in S3).

    The SEED is the original's rectified role map for BOTH dispositions; only the status
    differs (clean -> Config Done, unsafe -> Pending). A workbook read failure degrades every
    matched sheet to Pending WHILE STILL carrying the map (logged, not silent) -- the human
    resolves it on the config screen.
    """
    committed: dict[str, CommittedDataSheet] = {}
    sheet_specs: dict[str, tuple] = {}
    for tab, src in source_by_tab.items():
        cd = _committed_data_sheet(source_boq, src)
        if cd is None:
            continue
        committed[tab] = cd
        sheet_specs[tab] = (cd.header_row, cd.header_row_count)
    if not committed:
        return {}

    try:
        revised_cols = _read_revised_columns(source_file_url, sheet_specs)
    except Exception:
        frappe.logger("boq_revision").warning(
            f"revised-BoQ {source_boq}: could not read revised workbook columns; "
            "seeding matched sheets Pending",
            exc_info=True,
        )
        revised_cols = {}

    result: dict[str, SheetCarry] = {}
    for tab, cd in committed.items():
        config_json = frappe.as_json(cd.config)
        rc = revised_cols.get(tab)
        if rc is None:
            # Sheet unreadable -> conservative Pending, but STILL carry the rectified map.
            result[tab] = SheetCarry(
                config_json=config_json, status="Pending",
                reasons=["Revised sheet could not be read; carrying config for review."],
            )
            continue
        orig_header = _original_header_cells(
            source_boq, source_by_tab[tab], cd.header_row, cd.header_row_count
        )
        orig_universe = set(orig_header.keys()) | set(cd.role_map.keys())
        diff = diff_columns(
            cd.role_map, orig_header, orig_universe,
            rc["header_cells"], rc["universe"],
        )
        result[tab] = SheetCarry(
            config_json=config_json,
            status="Config Done" if diff.is_clean else "Pending",
            reasons=diff.reasons,
            dangling_roles=diff.dangling_roles,
            description_set_changed=diff.description_set_changed,
        )
    return result


# ---------------------------------------------------------------------------
# Work-package carry (Amendment B W4 / A2)
# ---------------------------------------------------------------------------

def read_committed_work_packages(source_boq: str, source_sheets) -> dict:
    """{source sheet_name -> [work_header, ...]} off the original's CURRENT committed sheets.

    Work packages live on `BoQ Sheet.work_packages`, a GRANDCHILD table (child of a child), which
    `frappe.get_doc` never hydrates -- so this is a direct `BoQ Sheet Work Package` read keyed by
    the committed sheet's docname, the same shape `review_screen.get_committed_rows` already uses.

    A general-specs source has no `BoQ Sheet` row at all and simply drops out. sheet_name VERBATIM
    (#152) -- resolved through `current_committed_sheets`, which filters the names in PYTHON; a
    Frappe `["in", [...]]` filter strips them and silently loses every whitespace-bearing sheet
    (see that function's note). Sheets with no assignments are OMITTED (not returned as []),
    mirroring `update_sheet_draft.get_boq_work_packages`.
    """
    names = list(source_sheets or [])
    if not names:
        return {}

    sheets = current_committed_sheets(source_boq, names)
    if not sheets:
        return {}
    sheet_by_docname = {s.name: s.sheet_name for s in sheets}

    rows = frappe.get_all(
        "BoQ Sheet Work Package",
        filters={"parent": ["in", list(sheet_by_docname)], "parenttype": "BoQ Sheet"},
        fields=["parent", "work_header"],
        order_by="idx asc",
    )
    result: dict = {}
    for r in rows:
        sheet_name = sheet_by_docname.get(r.parent)
        if sheet_name is None or not r.work_header:
            continue
        result.setdefault(sheet_name, []).append(r.work_header)
    return result


def carry_work_packages(draft_row_name: str, work_headers) -> int:
    """Stamp `work_headers` onto one seeded `BoQ Sheet Draft` row. Returns the count written.

    ⚠️ MUST be called AFTER the parent `BOQs` doc is saved -- `draft_row_name` is the child row's
    real docname, which does not exist until then. This is why the carry cannot ride
    `boq_doc.append("sheet_drafts", {... "work_packages": [...]})`: a grandchild Table-of-Table
    does not cascade through the parent's save the way a flat field does.

    Writes each row directly (`frappe.new_doc` + explicit parent/parenttype/parentfield), which is
    exactly what `update_sheet_draft.set_sheet_work_packages` does -- and deliberately so: it never
    touches a doc holding a list-valued JSON field, sidestepping the `doc.save()`/`delete_doc` wall.
    No commit here; the caller owns the transaction.
    """
    written = 0
    for work_header in work_headers or []:
        pkg = frappe.new_doc("BoQ Sheet Work Package")
        pkg.parent = draft_row_name
        pkg.parenttype = "BoQ Sheet Draft"
        pkg.parentfield = "work_packages"
        pkg.work_header = work_header
        pkg.insert(ignore_permissions=True)
        written += 1
    return written
