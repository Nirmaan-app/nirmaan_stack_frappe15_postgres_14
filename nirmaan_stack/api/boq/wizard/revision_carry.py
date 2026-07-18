"""S4 config column-diff CARRY -- the impure reader/orchestrator (ADR-0014 D5, #1101).

Split out of `revision.py` (which stays the entry + mapping owner) so each module changes
for one reason. The PURE decision lives in `services/boq_revision/column_diff.py`; this
module reads the committed tiers + the revised workbook and hands the primitives to it.

At seeding, a matched DATA sheet's columns are diffed against the original's committed grid.
A structurally clean sheet lands `Config Done` carrying the original's rectified role map;
anything unsafe lands `Pending` (the human confirms the config once). The SEED is ALWAYS the
original's rectified role map for BOTH dispositions -- never a fresh auto-guess -- so only
`wizard_status` differs. The per-sheet diagnostics (dangling roles / description-set change /
reasons) are RETURNED so the caller can surface them; they are deliberately NOT persisted
(D5: no new schema -- the disposition rides `wizard_status` + the seeded `sheet_config`).
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
    status: str               # "Config Done" (clean) | "Pending" (unsafe / unreadable)
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
