#!/usr/bin/env python3
"""
Diagnostic --- two-mode triage on 11 sheets (multi-area-aware as of
diagnostic metric repair, Chore #1 + #2).

Targets (11 sheets across 9 real fixtures):
  1.  ES-CW-MS HVAC Modification       : VRF System
  2.  ES-CW-MS Electrical Modification : LT WORKS
  3.  Bill of Quantities                : ELECTRICAL & ELV BOQ
  4a. Paytm                             : ELEC  BOQ  (double-space --- confirmed)
  4b. Paytm                             : HVAC BOQ
  5.  Electrical BoQ                    : BOQ_ELECTRICAL
  6.  Electrical Unpriced               : Electrical  (trailing space --- confirmed)
  7.  Inovalon                          : BOQ
  8.  K Mall                            : HVAC BOQ
  9a. Kohler                            : Electrical
  9b. Kohler                            : HVAC

Two modes per target, side-by-side in output:

  Mode 1 (auto_detect, hrc=None):  Production-like behavior. The wizard
                                   will use hrc=None in production so
                                   this is what the user will actually
                                   experience. Headline numbers.

  Mode 2 (hrc_1, debug):           hrc=1 forced. Debugging signal for
                                   isolating auto-detect bugs from
                                   parser bugs. When Mode 1 and Mode 2
                                   disagree on a target, the delta tells
                                   us auto-detect changed the outcome.
                                   Multi-row-header shapes (Tier
                                   A-merged etc.) will show large
                                   Mode 1 vs Mode 2 deltas.

Four-bucket metric per role family (qty / rate / amount):

  real                          --- parsed field is non-None (data captured).
  zero_default                  --- parser produced None (legitimate
                                    blank, e.g. unpriced BoQ, OR
                                    parser-dropped data).
  role_unassigned               --- no column in family has any role
                                    assigned to it.
  source_present_but_unparsed   --- sub-counter on zero_default;
                                    signals rows where the source cell
                                    had a value but the parser produced
                                    None (parser bug --- investigate).

Sum invariant: real + zero_default + role_unassigned == total LINE_ITEM
count per sheet. source_present_but_unparsed is tracked separately
(a sub-count of zero_default).

Family frozensets include per-area role names (rate_*_by_area,
amount_by_area) so multi-area sheets register role_assigned=True
correctly. The "qty" entry covers both single-area and per-area
(role="qty" with area= set, per section 9 hash 42).

Observability-only --- no parser source touched. No test assertions.
No Frappe imports. No xlsx writes. Working agreement 27 strict mode.

Run from repo root (Option B file-redirect form per section 9 hash 76):

  docker exec frappe_docker_devcontainer-frappe-1 bash -c \\
    'cd /workspace/development/frappe-bench && \\
     env/bin/python -m \\
     nirmaan_stack.services.boq_parser.single_area_triage_1_9i \\
     > /tmp/diag_output.log 2>&1'
  docker exec frappe_docker_devcontainer-frappe-1 bash -c \\
    'tail -120 /tmp/diag_output.log'

NEVER pipe through PowerShell Select-Object --- deadlocks 15+ min per
section 9 hash 76. Use the file-redirect form above.

Self-test (covers metric logic without touching real fixtures):

  docker exec frappe_docker_devcontainer-frappe-1 bash -c \\
    'cd /workspace/development/frappe-bench && \\
     env/bin/python -m \\
     nirmaan_stack.services.boq_parser.single_area_triage_1_9i --self-test'

History:
  Phase 1.9i               --- initial diagnostic at hrc=1 (3-bucket metric)
  Phase 1.9j               --- 3-bucket metric formalized
  Phase 1.9n               --- subset re-run + qty_total inclusion
  Diagnostic Chore #1      --- source_present_but_unparsed signal +
                               multi-area frozensets
  Diagnostic Chore #2      --- two-mode output (auto_detect + hrc_1)
                               + Option B test command pattern
"""
from __future__ import annotations

import json
import subprocess
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Path bootstrap — same convention as multi_area_triage_1_9f.py
# ---------------------------------------------------------------------------
_SCRIPT_DIR = Path(__file__).parent
_APP_ROOT = _SCRIPT_DIR.parent.parent.parent  # .../apps/nirmaan_stack/
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from openpyxl.utils import column_index_from_string  # noqa: E402

from nirmaan_stack.services.boq_parser._auto_guess import (  # noqa: E402
    auto_guess_sheet_config,
)
from nirmaan_stack.services.boq_parser.classifier import RowClassification  # noqa: E402
from nirmaan_stack.services.boq_parser.config import (  # noqa: E402
    GlobalSettings,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,  # noqa: F401 — required by spec import list
)
from nirmaan_stack.services.boq_parser.multi_area_detection import (  # noqa: E402
    detect_multi_area_pattern,  # noqa: F401 — required by spec import list; called internally by auto_guess
)
from nirmaan_stack.services.boq_parser.orchestrator import parse_boq  # noqa: E402
from nirmaan_stack.services.boq_parser.reader import BoqReader  # noqa: E402

FIXTURES_DIR = _SCRIPT_DIR / "tests" / "fixtures"

# Hardcoded from Step 0 discovery — exact filenames and sheet names, no runtime fuzzy matching.
# Confirmed by Nitesh 2026-05-18.
TARGETS: list[dict] = [
    {
        "rough": "ES-CW-MS HVAC Modification - VRF System",
        "file": "(Unpriced_R1)ES-CW-MS -6A-L1  L2-HVAC MODIFICATION 09.03.2026.xlsx",
        "sheet": "VRF System",
    },
    {
        "rough": "ES-CW-MS Electrical Modification - LT WORKS",
        "file": "(Unpriced_R1)ES-EL-CW-MS-6A-L1  L2-ELECTRICAL MODIFICATION PRICED BOQ-10.03.2026-R1.xlsx",
        "sheet": "LT WORKS",
    },
    {
        "rough": "Bill of Quantities - ELECTRICAL & ELV BOQ",
        "file": "Bill of Quantities.xlsx",
        "sheet": "ELECTRICAL & ELV BOQ",
    },
    {
        "rough": "Paytm - ELEC  BOQ",
        "file": "BOQ MEP_PAYTM BANGALORE.xlsx",
        "sheet": "ELEC  BOQ",  # two spaces — confirmed by Nitesh
    },
    {
        "rough": "Paytm - HVAC BOQ",
        "file": "BOQ MEP_PAYTM BANGALORE.xlsx",
        "sheet": "HVAC BOQ",
    },
    {
        "rough": "Electrical BoQ - BOQ_ELECTRICAL",
        "file": "Electrical BOQ.xlsx",
        "sheet": "BOQ_ELECTRICAL",
    },
    {
        "rough": "Electrical Unpriced - Electrical",
        "file": "Electrical Unpriced BOQ-03.02.2026 R1.xlsx",
        "sheet": "Electrical ",  # trailing space — confirmed by Nitesh
    },
    {
        "rough": "Inovalon - BOQ",
        "file": "Inovalon HVAC Unpriced BOQ-21.01.2026.xlsx",
        "sheet": "BOQ",
    },
    {
        "rough": "K Mall - HVAC BOQ",
        "file": "K-Mall Jodhpur BOQ Combined.xlsx",
        "sheet": "HVAC BOQ",
    },
    {
        "rough": "Kohler - Electrical",
        "file": "Kohler-BOQ- 06-04-26.xlsx",
        "sheet": "Electrical",
    },
    {
        "rough": "Kohler - HVAC",
        "file": "Kohler-BOQ- 06-04-26.xlsx",
        "sheet": "HVAC",
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Role-family membership sets used by Phase 1.9j three-count metric.
# Phase 1.9n correction: qty_total added — Phase 1.9l Mode D's longest-match-wins now
# correctly classifies "Total Qty" headers as qty_total, which is a qty-family role for
# diagnostic counting purposes.
_QTY_FAMILY_ROLES = frozenset({
    "qty", "qty_total",
    # Per-area qty uses role="qty" with area= set (section 9 hash 42
    # deprecated qty_by_area in favor of qty+area pattern). The "qty"
    # entry already covers both single-area and per-area cases.
})

_RATE_FAMILY_ROLES = frozenset({
    "rate_combined", "rate_supply", "rate_install",
    # Per-area rate role names (Phase 1.9a). Without these, multi-area
    # sheets register rate_role_assigned=False even when rate columns
    # exist per area --- causing the metric to report role_unassigned
    # when in fact roles ARE assigned (just under per-area names).
    "rate_combined_by_area", "rate_supply_by_area", "rate_install_by_area",
})

_AMOUNT_FAMILY_ROLES = frozenset({
    "amount_total", "amount_combined", "amount_supply", "amount_install",
    # Per-area amount role name (Phase 2b.2 Part B1). Same rationale as
    # rate per-area entries above.
    "amount_by_area",
})


def _source_present_for_family(cr, sc, family_roles: frozenset) -> bool:
    """True if any column mapped to a role in family_roles has a non-blank raw source cell."""
    for col_letter, col_role in sc.column_role_map.items():
        if col_role.role not in family_roles:
            continue
        cell_info = cr.raw_row.cells.get(col_letter)
        if cell_info is None:
            continue
        val = cell_info.value
        if val is not None and str(val).strip() != "":
            return True
    return False


def _role_metric(
    role_assigned: bool,
    real_flags: list[bool],
    source_present_flags: list[bool],
) -> dict[str, int]:
    """Three mutually-exclusive counts + source_present_but_unparsed for one role family.

    role_assigned: True if at least one column in the sheet carries a role from the family.
    real_flags: one entry per LINE_ITEM row — True = parser captured a non-None value.
    source_present_flags: one entry per LINE_ITEM row — True = at least one source cell in
        the family had a non-blank raw value (regardless of whether the parser captured it).

    Invariant (asserted by caller): real + zero_default + role_unassigned == len(real_flags).
    source_present_but_unparsed is a sub-count of zero_default (not part of the invariant sum).
    """
    total = len(real_flags)
    if not role_assigned:
        return {"real": 0, "zero_default": 0, "role_unassigned": total, "source_present_but_unparsed": 0}
    real = sum(1 for f in real_flags if f)
    source_present_but_unparsed = sum(
        1 for rf, spf in zip(real_flags, source_present_flags) if not rf and spf
    )
    return {
        "real": real,
        "zero_default": total - real,
        "role_unassigned": 0,
        "source_present_but_unparsed": source_present_but_unparsed,
    }


def _pattern_str(mp) -> str | None:
    if mp is None:
        return None
    p = mp.pattern
    if p == 1:
        return "Pattern 1"
    if p == 2:
        return "Pattern 2-area"
    if p == "pattern_2_rate":
        return "Pattern 2-rate"
    if p == 3:
        return "Pattern 3"
    return f"Pattern {p}"


def _null_if_blank(v: object) -> object:
    if v is None:
        return None
    if isinstance(v, str) and v.strip() == "":
        return None
    return v


def _best_rate(cr) -> float | None:
    for attr in ("rate_combined", "rate_supply", "rate_install"):
        val = getattr(cr, attr, None)
        if val is not None:
            return val
    return None


def _role_str(col_letter: str, column_role_map: dict) -> str | None:
    cr = column_role_map.get(col_letter)
    if cr is None:
        return None
    if cr.area:
        return f"{cr.role}[{cr.area}]"
    return cr.role


def _header_cells_by_column(
    reader: BoqReader, sheet_name: str, header_row: int
) -> dict[str, str | None]:
    """
    Capture raw cell values from the header row exactly as stored.
    No strip / upper / lower — exact whitespace and casing preserved.
    """
    rows = list(reader.iter_rows(sheet_name, start_row=header_row, end_row=header_row))
    if not rows:
        return {}
    raw = rows[0]
    return {
        col: (str(ci.value) if ci.value is not None else None)
        for col, ci in sorted(
            raw.cells.items(),
            key=lambda kv: column_index_from_string(kv[0]),
        )
    }


def _auto_role_map_display(
    header_cells: dict[str, str | None],
    sc: SheetConfig,
) -> dict[str, str | None]:
    """
    Build {column_letter: role_string_or_null} for all relevant columns.
    Union of header_cells keys + column_role_map keys, sorted by column index.
    """
    all_cols = set(header_cells.keys()) | set(sc.column_role_map.keys())
    sorted_cols = sorted(all_cols, key=column_index_from_string)
    return {col: _role_str(col, sc.column_role_map) for col in sorted_cols}


def _preamble_entry(rr, resolved_idx: int) -> dict:
    cr = rr.classified_row
    return {
        "resolved_idx": resolved_idx,
        "excel_row": cr.raw_row.row_number,
        "description": _null_if_blank(cr.description),
        "path": rr.path,
    }


def _line_item_entry(
    rr, resolved_idx: int, resolved_rows: list, mp
) -> dict:
    cr = rr.classified_row

    parent_path: str | None = None
    if rr.parent_index is not None and rr.parent_index < len(resolved_rows):
        parent_path = resolved_rows[rr.parent_index].path

    entry: dict = {
        "resolved_idx": resolved_idx,
        "excel_row": cr.raw_row.row_number,
        "parent_path": parent_path,
        "description": _null_if_blank(cr.description),
        "qty": _null_if_blank(cr.qty),
        "rate": _best_rate(cr),
        "amount": _null_if_blank(cr.amount_total),
        "per_area_qty": {},
        "per_area_rate": {},
        "per_area_amount": {},
    }

    if mp is not None:
        for area in mp.areas:
            entry["per_area_qty"][area] = rr.qty_by_area.get(area)
            rate_dict = rr.rate_by_area.get(area, {})
            rate_val = (
                rate_dict.get("combined_rate")
                or rate_dict.get("supply_rate")
                or rate_dict.get("install_rate")
            )
            entry["per_area_rate"][area] = rate_val
            entry["per_area_amount"][area] = rr.amount_by_area.get(area)

    return entry


def _load_exception_result(
    fname: str,
    sheet_name: str,
    exc_text: str,
    header_row: int | None = None,
    header_cells: dict | None = None,
    role_map: dict | None = None,
) -> dict:
    return {
        "header_row_count_used": 1,
        "load_exception": exc_text,
        "header_row_excel": header_row,
        "classification": "none",
        "pattern": None,
        "areas": None,
        "header_cells_by_column": header_cells or {},
        "auto_guessed_column_role_map": role_map or {},
        "first_3_l1_preambles": [],
        "first_l2_preamble": None,
        "first_10_line_items": [],
        "line_items_with_non_none_qty_count": 0,  # DEPRECATED — see line_items_with_real_qty_count etc. for accurate measurement (Phase 1.9j)
        "total_line_items_count": 0,
        "line_items_with_real_qty_count": 0,
        "line_items_with_qty_zero_default_count": 0,
        "line_items_with_qty_role_unassigned_count": 0,
        "line_items_with_qty_source_present_but_unparsed_count": 0,
        "line_items_with_real_rate_count": 0,
        "line_items_with_rate_zero_default_count": 0,
        "line_items_with_rate_role_unassigned_count": 0,
        "line_items_with_rate_source_present_but_unparsed_count": 0,
        "line_items_with_real_amount_count": 0,
        "line_items_with_amount_zero_default_count": 0,
        "line_items_with_amount_role_unassigned_count": 0,
        "line_items_with_amount_source_present_but_unparsed_count": 0,
    }


# ---------------------------------------------------------------------------
# Per-mode runner (extracted from _run_target for two-mode output)
# ---------------------------------------------------------------------------

def _run_mode(
    reader,
    wp: Path,
    fname: str,
    sheet_name: str,
    header_row: int,
    hrc,  # int | None — None = auto_detect (production-like); 1 = forced debug
    hcells: dict,
) -> dict:
    """Build SheetConfig + parse + collect metrics for one hrc mode.

    Returns the full diagnostic sub-dict. Catches load exceptions and
    returns _load_exception_result instead, so one failing mode does not
    suppress the other.
    """
    role_map_display: dict = {}
    try:
        sc = auto_guess_sheet_config(
            reader, sheet_name, header_row, hrc,
            GlobalSettings().multi_area_reserved_keywords,
        )
        actual_hrc = sc.header_row_count
        role_map_display = _auto_role_map_display(hcells, sc)

        config = MappingConfig(
            project="triage-1-9i",
            master_boq=MasterBoqMetadata(boq_name=fname),
            global_settings=GlobalSettings(),
            sheets=[sc],
        )
        parsed_boq = parse_boq(str(wp), config)
        parsed_sheet = next(
            (s for s in parsed_boq.sheets if s.sheet_name == sheet_name),
            None,
        )
        if parsed_sheet is None:
            raise ValueError(f"Sheet '{sheet_name}' absent from ParsedBoq output")

    except Exception:
        tb = traceback.format_exc()
        return _load_exception_result(
            fname, sheet_name, tb,
            header_row=header_row,
            header_cells=hcells,
            role_map=role_map_display,
        )

    # Extract results
    mp = parsed_sheet.multi_area_pattern
    pat_str = _pattern_str(mp)
    classification = "multi-area" if mp is not None else "single-area"
    resolved_rows: list = parsed_sheet.resolved_rows

    # Per-family role assignment from SheetConfig.
    qty_role_assigned = any(cr.role in _QTY_FAMILY_ROLES for cr in sc.column_role_map.values())
    rate_role_assigned = any(cr.role in _RATE_FAMILY_ROLES for cr in sc.column_role_map.values())
    amount_role_assigned = any(cr.role in _AMOUNT_FAMILY_ROLES for cr in sc.column_role_map.values())

    first_3_l1: list[dict] = []
    first_l2: dict | None = None
    for i, rr in enumerate(resolved_rows):
        if rr.classified_row.classification != RowClassification.PREAMBLE:
            continue
        if rr.level == 1 and len(first_3_l1) < 3:
            first_3_l1.append(_preamble_entry(rr, i))
        if rr.level == 2 and first_l2 is None:
            first_l2 = _preamble_entry(rr, i)

    first_10: list[dict] = []
    total_items = 0
    qty_non_none = 0  # DEPRECATED — retained for one transition cycle (Phase 1.9j)
    qty_real_flags: list[bool] = []
    qty_source_present_flags: list[bool] = []
    rate_real_flags: list[bool] = []
    rate_source_present_flags: list[bool] = []
    amount_real_flags: list[bool] = []
    amount_source_present_flags: list[bool] = []

    for i, rr in enumerate(resolved_rows):
        if rr.classified_row.classification != RowClassification.LINE_ITEM:
            continue
        total_items += 1
        cr = rr.classified_row
        if _null_if_blank(cr.qty) is not None:  # DEPRECATED metric
            qty_non_none += 1

        qty_real_flags.append(cr.qty is not None and not cr.is_rate_only)
        qty_source_present_flags.append(
            _source_present_for_family(cr, sc, _QTY_FAMILY_ROLES)
        )

        # Rate: include rate_combined + rate_by_area_raw (multi-area).
        rate_real_flags.append(
            cr.rate_combined is not None
            or cr.rate_supply is not None
            or cr.rate_install is not None
            or bool(cr.rate_by_area_raw)
        )
        rate_source_present_flags.append(
            _source_present_for_family(cr, sc, _RATE_FAMILY_ROLES)
        )

        # Amount: include amount_by_area_raw (multi-area).
        # NOTE: cr.amount_combined is intentionally NOT in this OR clause
        # because the parser today does NOT have an amount_combined field
        # on ClassifiedRow --- per section 7.14, amount_combined and
        # amount_total are interchangeable by design at the output level,
        # but classify_row() does not currently read amount_combined column
        # cells into any field. The family frozenset still includes
        # amount_combined as a valid role string for source-present detection;
        # when a target has amount_combined columns mapped, the new
        # source_present_but_unparsed signal will correctly surface that the
        # source cells had data but no parser field captured it. This is the
        # expected behavior of the repaired diagnostic and a useful finding for
        # a future small parser-side alias sub-phase.
        amount_real_flags.append(
            cr.amount_total is not None
            or cr.amount_supply is not None
            or cr.amount_install is not None
            or bool(cr.amount_by_area_raw)
        )
        amount_source_present_flags.append(
            _source_present_for_family(cr, sc, _AMOUNT_FAMILY_ROLES)
        )

        if len(first_10) < 10:
            first_10.append(_line_item_entry(rr, i, resolved_rows, mp))

    qty_metric = _role_metric(qty_role_assigned, qty_real_flags, qty_source_present_flags)
    rate_metric = _role_metric(rate_role_assigned, rate_real_flags, rate_source_present_flags)
    amount_metric = _role_metric(amount_role_assigned, amount_real_flags, amount_source_present_flags)

    # Sum invariant: three counts must equal total_items for every role family.
    for _fam, _metric in [("qty", qty_metric), ("rate", rate_metric), ("amount", amount_metric)]:
        _s = _metric["real"] + _metric["zero_default"] + _metric["role_unassigned"]
        if _s != total_items:
            raise ValueError(
                f"[{fname}/{sheet_name}/hrc={hrc}] Sum invariant violation for family='{_fam}': "
                f"real={_metric['real']} + zero_default={_metric['zero_default']} + "
                f"role_unassigned={_metric['role_unassigned']} = {_s}, "
                f"expected total_items={total_items}"
            )

    return {
        "header_row_count_used": actual_hrc,
        "load_exception": None,
        "header_row_excel": header_row,
        "classification": classification,
        "pattern": pat_str,
        "areas": list(mp.areas) if mp is not None else [],
        "header_cells_by_column": hcells,
        "auto_guessed_column_role_map": role_map_display,
        "first_3_l1_preambles": first_3_l1,
        "first_l2_preamble": first_l2,
        "first_10_line_items": first_10,
        "line_items_with_non_none_qty_count": qty_non_none,  # DEPRECATED
        "total_line_items_count": total_items,
        "line_items_with_real_qty_count": qty_metric["real"],
        "line_items_with_qty_zero_default_count": qty_metric["zero_default"],
        "line_items_with_qty_role_unassigned_count": qty_metric["role_unassigned"],
        "line_items_with_qty_source_present_but_unparsed_count": qty_metric["source_present_but_unparsed"],
        "line_items_with_real_rate_count": rate_metric["real"],
        "line_items_with_rate_zero_default_count": rate_metric["zero_default"],
        "line_items_with_rate_role_unassigned_count": rate_metric["role_unassigned"],
        "line_items_with_rate_source_present_but_unparsed_count": rate_metric["source_present_but_unparsed"],
        "line_items_with_real_amount_count": amount_metric["real"],
        "line_items_with_amount_zero_default_count": amount_metric["zero_default"],
        "line_items_with_amount_role_unassigned_count": amount_metric["role_unassigned"],
        "line_items_with_amount_source_present_but_unparsed_count": amount_metric["source_present_but_unparsed"],
    }


# ---------------------------------------------------------------------------
# Per-target runner
# ---------------------------------------------------------------------------

def _run_target(target: dict) -> dict:
    """Per-target diagnostic. Calls _run_mode TWICE for two-mode output."""
    rough = target["rough"]
    fname = target["file"]
    sheet_name = target["sheet"]
    wp = FIXTURES_DIR / fname

    base: dict = {
        "rough_name_input": rough,
        "resolved_file": fname,
        "resolved_sheet": sheet_name,
        "diagnostic": {},
    }

    # Step 1: Open workbook
    try:
        reader = BoqReader(str(wp))
    except Exception:
        tb = traceback.format_exc()
        err = _load_exception_result(fname, sheet_name, tb)
        base["diagnostic"] = {"mode_1_auto_detect": err, "mode_2_hrc_1": err}
        return base

    # Step 2: Detect header row
    try:
        header_row = reader.detect_header_row(sheet_name)
    except Exception:
        tb = traceback.format_exc()
        err = _load_exception_result(fname, sheet_name, tb)
        base["diagnostic"] = {"mode_1_auto_detect": err, "mode_2_hrc_1": err}
        return base

    if header_row is None:
        err = _load_exception_result(
            fname, sheet_name,
            "detect_header_row() returned None --- no header row found in sheet",
        )
        base["diagnostic"] = {"mode_1_auto_detect": err, "mode_2_hrc_1": err}
        return base

    # Step 3: Capture header cells (shared across both modes; hrc-independent)
    hcells: dict = {}
    try:
        hcells = _header_cells_by_column(reader, sheet_name, header_row)
    except Exception:
        tb = traceback.format_exc()
        err = _load_exception_result(fname, sheet_name, tb, header_row=header_row, header_cells={}, role_map={})
        base["diagnostic"] = {"mode_1_auto_detect": err, "mode_2_hrc_1": err}
        return base

    # Step 4: Run both modes side-by-side
    mode_1 = _run_mode(reader, wp, fname, sheet_name, header_row, hrc=None, hcells=hcells)
    mode_2 = _run_mode(reader, wp, fname, sheet_name, header_row, hrc=1, hcells=hcells)
    base["diagnostic"] = {"mode_1_auto_detect": mode_1, "mode_2_hrc_1": mode_2}
    return base


# ---------------------------------------------------------------------------
# TXT renderer
# ---------------------------------------------------------------------------

def _trunc(s: object, n: int) -> str:
    if s is None:
        return "None"
    t = str(s)
    return (t[:n] + "…") if len(t) > n else t


def _render_mode_block(lines: list, d: dict, label: str) -> None:
    """Render one mode sub-block into lines. label e.g. 'Mode 1 (auto_detect, hrc=None)'."""
    lines.append(f"  --- {label} ---")

    if d.get("load_exception"):
        lines.append(f"    load_exception : (non-null)")
        lines.append(f"    classification : {d['classification']}")
        lines.append(f"    header_row_excel: {d['header_row_excel']}")
        lines.append("    --- exception excerpt (first 10 lines) ---")
        for ln in (d["load_exception"] or "").splitlines()[:10]:
            lines.append(f"      {ln}")
        lines.append("")
        return

    lines.append(f"    classification        : {d['classification']}")
    lines.append(f"    pattern               : {d['pattern']}")
    lines.append(f"    areas                 : {d['areas']}")
    lines.append(f"    header_row_excel      : {d['header_row_excel']}")
    lines.append(f"    header_row_count_used : {d['header_row_count_used']}")
    lines.append("")

    # Table 1: header_cells_by_column + auto_guessed_column_role_map
    lines.append("    [Table 1] header_cells_by_column + auto_guessed_column_role_map")
    hcells = d.get("header_cells_by_column", {})
    rmap = d.get("auto_guessed_column_role_map", {})
    all_cols = sorted(
        set(hcells.keys()) | set(rmap.keys()),
        key=column_index_from_string,
    )
    lines.append(f"    {'Col':>4} | {'Header text (exact)':42} | Role")
    lines.append("    " + "-" * 72)
    for col in all_cols:
        cell_text = hcells.get(col)
        role = rmap.get(col)
        ct_display = _trunc(cell_text, 42)
        lines.append(f"    {col:>4} | {ct_display:42} | {role or 'null'}")
    lines.append("")

    # Table 2: first 3 L1 preambles
    l1s = d.get("first_3_l1_preambles", [])
    lines.append(f"    [Table 2] first_3_l1_preambles ({len(l1s)})")
    if l1s:
        lines.append(f"    {'ridx':>5} | {'row':>5} | {'description':50} | path")
        lines.append("    " + "-" * 100)
        for p in l1s:
            desc = _trunc(p.get("description"), 50)
            path = _trunc(p.get("path"), 50)
            lines.append(f"    {p['resolved_idx']:>5} | {p['excel_row']:>5} | {desc:50} | {path}")
    else:
        lines.append("    (none)")
    lines.append("")

    # Table 3: first L2 preamble
    l2 = d.get("first_l2_preamble")
    lines.append("    [Table 3] first_l2_preamble")
    if l2:
        desc = _trunc(l2.get("description"), 55)
        path = _trunc(l2.get("path"), 55)
        lines.append(f"    ridx={l2['resolved_idx']}  row={l2['excel_row']}  desc={desc}")
        lines.append(f"    path={path}")
    else:
        lines.append("    null")
    lines.append("")

    # Table 4: first 10 line items
    items = d.get("first_10_line_items", [])
    lines.append(f"    [Table 4] first_10_line_items ({len(items)})")
    if items:
        hdr = f"    {'ridx':>5} | {'row':>5} | {'description':44} | {'qty':>9} | {'rate':>11} | {'amount':>11} | parent_path"
        lines.append(hdr)
        lines.append("    " + "-" * 130)
        for it in items:
            desc = _trunc(it.get("description"), 44)
            qty_v = it.get("qty")
            rate_v = it.get("rate")
            amt_v = it.get("amount")
            qty_s = f"{qty_v}" if qty_v is not None else "null"
            rate_s = f"{rate_v}" if rate_v is not None else "null"
            amt_s = f"{amt_v}" if amt_v is not None else "null"
            pp = _trunc(it.get("parent_path"), 40)
            lines.append(
                f"    {it['resolved_idx']:>5} | {it['excel_row']:>5} | {desc:44} | "
                f"{qty_s:>9} | {rate_s:>11} | {amt_s:>11} | {pp}"
            )
    else:
        lines.append("    (none)")
    lines.append("")

    # Metrics
    tot = d.get("total_line_items_count", 0)
    rq = d.get("line_items_with_real_qty_count", 0)
    zq = d.get("line_items_with_qty_zero_default_count", 0)
    uq = d.get("line_items_with_qty_role_unassigned_count", 0)
    spq = d.get("line_items_with_qty_source_present_but_unparsed_count", 0)
    rr_ = d.get("line_items_with_real_rate_count", 0)
    zr = d.get("line_items_with_rate_zero_default_count", 0)
    ur = d.get("line_items_with_rate_role_unassigned_count", 0)
    spr = d.get("line_items_with_rate_source_present_but_unparsed_count", 0)
    ra = d.get("line_items_with_real_amount_count", 0)
    za = d.get("line_items_with_amount_zero_default_count", 0)
    ua = d.get("line_items_with_amount_role_unassigned_count", 0)
    spa = d.get("line_items_with_amount_source_present_but_unparsed_count", 0)
    lines.append(f"    qty   : real={rq:>5}  zero_default={zq:>5}  role_unassigned={uq:>5}  total={tot}  [src_present_unparsed={spq}]")
    lines.append(f"    rate  : real={rr_:>5}  zero_default={zr:>5}  role_unassigned={ur:>5}  total={tot}  [src_present_unparsed={spr}]")
    lines.append(f"    amount: real={ra:>5}  zero_default={za:>5}  role_unassigned={ua:>5}  total={tot}  [src_present_unparsed={spa}]")
    lines.append("")


def _render_txt(output: dict) -> str:
    lines: list[str] = []
    lines.append("=" * 80)
    lines.append("Diagnostic --- Two-Mode Triage (auto_detect + hrc_1 debug)")
    lines.append(f"Generated      : {output['generated_at']}")
    lines.append(f"Policy         : {output['header_row_count_policy']}")
    lines.append(f"Branch tip     : {output.get('branch_tip_at_generation', 'unknown')}")
    lines.append("=" * 80)

    for t in output["targets"]:
        rough = t["rough_name_input"]
        fname = t["resolved_file"]
        sname = t["resolved_sheet"]
        diag = t["diagnostic"]

        lines.append("")
        lines.append("=" * 80)
        lines.append(f"TARGET: {rough}")
        lines.append(f"  resolved_file  : {fname}")
        lines.append(f"  resolved_sheet : {repr(sname)}")
        lines.append("=" * 80)

        m1 = diag.get("mode_1_auto_detect", {})
        m2 = diag.get("mode_2_hrc_1", {})
        _render_mode_block(lines, m1, "Mode 1 (auto_detect, hrc=None)")
        _render_mode_block(lines, m2, "Mode 2 (hrc_1, debug)")

    # Aggregate summary --- Mode 1 is the headline (production-like)
    lines.append("=" * 80)
    lines.append("AGGREGATE SUMMARY")
    lines.append("=" * 80)
    all_targets = output["targets"]
    total_count = len(all_targets)

    # Mode 1 aggregates (headline)
    m1_classification_counts: dict[str, int] = {}
    m1_total_null_roles = 0
    m1_total_load_exceptions = 0
    m1_non_none_qty_ratios: list[tuple[int, int]] = []
    m1_agg_real_qty = m1_agg_zero_qty = m1_agg_unassigned_qty = m1_agg_sp_qty = 0
    m1_agg_real_rate = m1_agg_zero_rate = m1_agg_unassigned_rate = m1_agg_sp_rate = 0
    m1_agg_real_amt = m1_agg_zero_amt = m1_agg_unassigned_amt = m1_agg_sp_amt = 0
    m1_agg_total_items = 0

    # Mode 2 aggregates (debug)
    m2_total_load_exceptions = 0
    m2_agg_real_qty = m2_agg_zero_qty = m2_agg_unassigned_qty = m2_agg_sp_qty = 0
    m2_agg_real_rate = m2_agg_zero_rate = m2_agg_unassigned_rate = m2_agg_sp_rate = 0
    m2_agg_real_amt = m2_agg_zero_amt = m2_agg_unassigned_amt = m2_agg_sp_amt = 0
    m2_agg_total_items = 0

    for t in all_targets:
        m1 = t["diagnostic"].get("mode_1_auto_detect", {})
        m2 = t["diagnostic"].get("mode_2_hrc_1", {})

        # Mode 1
        cls = m1.get("classification", "none")
        m1_classification_counts[cls] = m1_classification_counts.get(cls, 0) + 1
        if m1.get("load_exception"):
            m1_total_load_exceptions += 1
        for v in m1.get("auto_guessed_column_role_map", {}).values():
            if v is None:
                m1_total_null_roles += 1
        nq = m1.get("line_items_with_non_none_qty_count", 0)
        tot = m1.get("total_line_items_count", 0)
        m1_non_none_qty_ratios.append((nq, tot))
        m1_agg_total_items += tot
        m1_agg_real_qty += m1.get("line_items_with_real_qty_count", 0)
        m1_agg_zero_qty += m1.get("line_items_with_qty_zero_default_count", 0)
        m1_agg_unassigned_qty += m1.get("line_items_with_qty_role_unassigned_count", 0)
        m1_agg_sp_qty += m1.get("line_items_with_qty_source_present_but_unparsed_count", 0)
        m1_agg_real_rate += m1.get("line_items_with_real_rate_count", 0)
        m1_agg_zero_rate += m1.get("line_items_with_rate_zero_default_count", 0)
        m1_agg_unassigned_rate += m1.get("line_items_with_rate_role_unassigned_count", 0)
        m1_agg_sp_rate += m1.get("line_items_with_rate_source_present_but_unparsed_count", 0)
        m1_agg_real_amt += m1.get("line_items_with_real_amount_count", 0)
        m1_agg_zero_amt += m1.get("line_items_with_amount_zero_default_count", 0)
        m1_agg_unassigned_amt += m1.get("line_items_with_amount_role_unassigned_count", 0)
        m1_agg_sp_amt += m1.get("line_items_with_amount_source_present_but_unparsed_count", 0)

        # Mode 2
        if m2.get("load_exception"):
            m2_total_load_exceptions += 1
        tot2 = m2.get("total_line_items_count", 0)
        m2_agg_total_items += tot2
        m2_agg_real_qty += m2.get("line_items_with_real_qty_count", 0)
        m2_agg_zero_qty += m2.get("line_items_with_qty_zero_default_count", 0)
        m2_agg_unassigned_qty += m2.get("line_items_with_qty_role_unassigned_count", 0)
        m2_agg_sp_qty += m2.get("line_items_with_qty_source_present_but_unparsed_count", 0)
        m2_agg_real_rate += m2.get("line_items_with_real_rate_count", 0)
        m2_agg_zero_rate += m2.get("line_items_with_rate_zero_default_count", 0)
        m2_agg_unassigned_rate += m2.get("line_items_with_rate_role_unassigned_count", 0)
        m2_agg_sp_rate += m2.get("line_items_with_rate_source_present_but_unparsed_count", 0)
        m2_agg_real_amt += m2.get("line_items_with_real_amount_count", 0)
        m2_agg_zero_amt += m2.get("line_items_with_amount_zero_default_count", 0)
        m2_agg_unassigned_amt += m2.get("line_items_with_amount_role_unassigned_count", 0)
        m2_agg_sp_amt += m2.get("line_items_with_amount_source_present_but_unparsed_count", 0)

    lines.append(f"  Total target count          : {total_count}")

    lines.append("")
    lines.append("  === Mode 1 (auto_detect, hrc=None) --- headline numbers ===")
    for cls_name in sorted(m1_classification_counts.keys()):
        lines.append(f"  Classification [{cls_name:12s}]: {m1_classification_counts[cls_name]}")
    lines.append(f"  Total null role assignments : {m1_total_null_roles}")
    lines.append(f"  Total load exceptions       : {m1_total_load_exceptions}")

    if m1_non_none_qty_ratios:
        def _ratio(pair: tuple[int, int]) -> float:
            nq, tot = pair
            return nq / tot if tot > 0 else 0.0

        sorted_ratios = sorted(m1_non_none_qty_ratios, key=_ratio)
        min_r = sorted_ratios[0]
        max_r = sorted_ratios[-1]
        mid_r = sorted_ratios[len(sorted_ratios) // 2]
        lines.append(
            f"  Non-None-qty ratio range    : "
            f"min={min_r[0]}/{min_r[1]}  "
            f"median={mid_r[0]}/{mid_r[1]}  "
            f"max={max_r[0]}/{max_r[1]}"
        )

    lines.append(f"  Total line items            : {m1_agg_total_items}")
    lines.append(
        f"  qty   : real={m1_agg_real_qty:>6}  zero_default={m1_agg_zero_qty:>6}  role_unassigned={m1_agg_unassigned_qty:>6}  [src_present_unparsed={m1_agg_sp_qty}]"
    )
    lines.append(
        f"  rate  : real={m1_agg_real_rate:>6}  zero_default={m1_agg_zero_rate:>6}  role_unassigned={m1_agg_unassigned_rate:>6}  [src_present_unparsed={m1_agg_sp_rate}]"
    )
    lines.append(
        f"  amount: real={m1_agg_real_amt:>6}  zero_default={m1_agg_zero_amt:>6}  role_unassigned={m1_agg_unassigned_amt:>6}  [src_present_unparsed={m1_agg_sp_amt}]"
    )

    lines.append("")
    lines.append("  === Mode 2 (hrc_1, debug) ===")
    lines.append(f"  Total load exceptions       : {m2_total_load_exceptions}")
    lines.append(f"  Total line items            : {m2_agg_total_items}")
    lines.append(
        f"  qty   : real={m2_agg_real_qty:>6}  zero_default={m2_agg_zero_qty:>6}  role_unassigned={m2_agg_unassigned_qty:>6}  [src_present_unparsed={m2_agg_sp_qty}]"
    )
    lines.append(
        f"  rate  : real={m2_agg_real_rate:>6}  zero_default={m2_agg_zero_rate:>6}  role_unassigned={m2_agg_unassigned_rate:>6}  [src_present_unparsed={m2_agg_sp_rate}]"
    )
    lines.append(
        f"  amount: real={m2_agg_real_amt:>6}  zero_default={m2_agg_zero_amt:>6}  role_unassigned={m2_agg_unassigned_amt:>6}  [src_present_unparsed={m2_agg_sp_amt}]"
    )

    lines.append("")
    lines.append("END OF REPORT")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(subset: str | None = None) -> None:
    # Phase 1.9n --- --subset 1_9n: re-run on targets 3-11 (drops 1-2 as not-single-area-candidate per 1.9i rationale)
    if subset == "1_9n":
        targets = TARGETS[2:]
        phase_label = "1.9n"
        output_suffix = "1_9n"
        print(f"Phase 1.9n re-run — single-area-targeted diagnostic on {len(targets)} targets (3-11) ...", flush=True)
    else:
        targets = TARGETS
        phase_label = "1.9i"
        output_suffix = "1_9j"
        print("Phase 1.9i — single-area-targeted diagnostic starting...", flush=True)
    print(f"  Targets: {len(targets)} sheets", flush=True)

    try:
        branch_tip = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=str(_SCRIPT_DIR),
            text=True,
        ).strip()
    except Exception:
        branch_tip = "unknown"

    results: list[dict] = []
    for target in targets:
        print(f"  Processing: {target['rough']} ...", flush=True)
        results.append(_run_target(target))

    output = {
        "phase": phase_label,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "header_row_count_policy": "two-mode: Mode 1 hrc=None (auto_detect) + Mode 2 hrc=1 (debug)",
        "branch_tip_at_generation": branch_tip,
        "targets": results,
    }

    json_path = _SCRIPT_DIR / f"single_area_triage_{output_suffix}_output.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nJSON output: {json_path} ({json_path.stat().st_size:,} bytes)")

    txt_path = _SCRIPT_DIR / f"single_area_triage_{output_suffix}_output.txt"
    txt_content = _render_txt(output)
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(txt_content)
    print(f"TXT output : {txt_path} ({txt_path.stat().st_size:,} bytes)")

    print("\nDone.")


def _self_test() -> None:
    """7 synthetic cases verifying _role_metric.

    Kept in-script (not under tests/) so parser test count stays at 375.
    Run via: python -m nirmaan_stack.services.boq_parser.single_area_triage_1_9i --self-test
    """
    # Case 1: role assigned, all real → all real, source_present_but_unparsed=0
    r = _role_metric(True, [True, True, True], [True, True, True])
    assert r == {"real": 3, "zero_default": 0, "role_unassigned": 0, "source_present_but_unparsed": 0}, f"Case 1 FAIL: {r}"
    print("  Case 1 (all-real): PASS")

    # Case 2: role assigned, all zero-default, source present for 2 of 3 → source_present_but_unparsed=2
    r = _role_metric(True, [False, False, False], [True, True, False])
    assert r == {"real": 0, "zero_default": 3, "role_unassigned": 0, "source_present_but_unparsed": 2}, f"Case 2 FAIL: {r}"
    print("  Case 2 (all-zero-default, 2 source-present): PASS")

    # Case 3: no column has the role → all role-unassigned, source_present_but_unparsed=0
    r = _role_metric(False, [False, False, False], [False, False, False])
    assert r == {"real": 0, "zero_default": 0, "role_unassigned": 3, "source_present_but_unparsed": 0}, f"Case 3 FAIL: {r}"
    print("  Case 3 (role-unassigned): PASS")

    # Case 4: role assigned, 5 line items, all source cells blank
    # → real=0, zero_default=5, role_unassigned=0,
    #   source_present_but_unparsed=0 (nothing in source to surface).
    r = _role_metric(
        True,
        [False, False, False, False, False],  # real_flags: all None
        [False, False, False, False, False],  # source_present_flags: all blank
    )
    assert r == {
        "real": 0, "zero_default": 5, "role_unassigned": 0,
        "source_present_but_unparsed": 0,
    }, f"Case 4 FAIL: {r}"
    print("  Case 4 (all-source-blank, unpriced BoQ): PASS")

    # Case 5: role assigned, 5 line items, all source cells had data,
    # parser captured all 5.
    # → real=5, zero_default=0, role_unassigned=0,
    #   source_present_but_unparsed=0.
    r = _role_metric(
        True,
        [True, True, True, True, True],
        [True, True, True, True, True],
    )
    assert r == {
        "real": 5, "zero_default": 0, "role_unassigned": 0,
        "source_present_but_unparsed": 0,
    }, f"Case 5 FAIL: {r}"
    print("  Case 5 (all-source-present-and-parsed, priced clean): PASS")

    # Case 6: Role assigned, 5 line items:
    # - 2 parsed cleanly (real_flag=True, source_present=True)
    # - 2 legitimately blank (real_flag=False, source_present=False)
    # - 1 PARSER BUG: source cell had data but parser produced None
    #   (real_flag=False, source_present=True)
    # Expected: real=2, zero_default=3, role_unassigned=0,
    #           source_present_but_unparsed=1.
    r = _role_metric(
        True,
        [True, True, False, False, False],
        [True, True, False, False, True],   # last entry: present but unparsed
    )
    assert r == {
        "real": 2, "zero_default": 3, "role_unassigned": 0,
        "source_present_but_unparsed": 1,
    }, f"Case 6 FAIL: {r}"
    print("  Case 6 (mixed with 1 parser bug): PASS")

    # Case 7: no role assigned. source_present_flags are technically
    # meaningless in this case but the function should still return
    # source_present_but_unparsed=0 because role_unassigned wins.
    # This locks in the precedence behavior.
    r = _role_metric(
        False,
        [False, False, False],
        [True, True, True],  # phantom values --- should be ignored
    )
    assert r == {
        "real": 0, "zero_default": 0, "role_unassigned": 3,
        "source_present_but_unparsed": 0,
    }, f"Case 7 FAIL: {r}"
    print("  Case 7 (role-unassigned, ignore phantom source_present): PASS")

    print("_self_test: all 7 cases PASS")


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        _self_test()
    elif "--subset" in sys.argv:
        _idx = sys.argv.index("--subset")
        main(subset=sys.argv[_idx + 1])
    else:
        main()
