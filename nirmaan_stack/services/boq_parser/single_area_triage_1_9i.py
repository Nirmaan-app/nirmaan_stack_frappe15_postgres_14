#!/usr/bin/env python3
"""
Phase 1.9i — single-area-targeted diagnostic on 11 sheets at hrc=1.

Targets (11 sheets across 9 real fixtures):
  1.  ES-CW-MS HVAC Modification       : VRF System
  2.  ES-CW-MS Electrical Modification : LT WORKS
  3.  Bill of Quantities                : ELECTRICAL & ELV BOQ
  4a. Paytm                             : ELEC  BOQ  (double-space — confirmed)
  4b. Paytm                             : HVAC BOQ
  5.  Electrical BoQ                    : BOQ_ELECTRICAL
  6.  Electrical Unpriced               : Electrical  (trailing space — confirmed)
  7.  Inovalon                          : BOQ
  8.  K Mall                            : HVAC BOQ
  9a. Kohler                            : Electrical
  9b. Kohler                            : HVAC

Rationale: Nitesh's 2026-05-18 framing — nail single-area first →
~60-70% real-world coverage.

Observability-only — no parser source touched. No test assertions.
No Frappe imports. No xlsx writes.

Run from repo root:
  python -m nirmaan_stack.services.boq_parser.single_area_triage_1_9i
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
        "line_items_with_non_none_qty_count": 0,
        "total_line_items_count": 0,
    }


# ---------------------------------------------------------------------------
# Per-target runner
# ---------------------------------------------------------------------------

def _run_target(target: dict) -> dict:
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
        base["diagnostic"] = _load_exception_result(fname, sheet_name, tb)
        return base

    # Step 2: Detect header row
    try:
        header_row = reader.detect_header_row(sheet_name)
    except Exception:
        tb = traceback.format_exc()
        base["diagnostic"] = _load_exception_result(fname, sheet_name, tb)
        return base

    if header_row is None:
        base["diagnostic"] = _load_exception_result(
            fname, sheet_name,
            "detect_header_row() returned None — no header row found in sheet",
        )
        return base

    # Step 3: Capture header cells + build SheetConfig + parse
    hcells: dict = {}
    role_map_display: dict = {}
    try:
        hcells = _header_cells_by_column(reader, sheet_name, header_row)
        sc = auto_guess_sheet_config(
            reader, sheet_name, header_row, 1,
            GlobalSettings().multi_area_reserved_keywords,
        )
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
        base["diagnostic"] = _load_exception_result(
            fname, sheet_name, tb,
            header_row=header_row,
            header_cells=hcells,
            role_map=role_map_display,
        )
        return base

    # Step 4: Extract results
    mp = parsed_sheet.multi_area_pattern
    pat_str = _pattern_str(mp)
    classification = "multi-area" if mp is not None else "single-area"
    resolved_rows: list = parsed_sheet.resolved_rows

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
    qty_non_none = 0
    for i, rr in enumerate(resolved_rows):
        if rr.classified_row.classification != RowClassification.LINE_ITEM:
            continue
        total_items += 1
        if _null_if_blank(rr.classified_row.qty) is not None:
            qty_non_none += 1
        if len(first_10) < 10:
            first_10.append(_line_item_entry(rr, i, resolved_rows, mp))

    base["diagnostic"] = {
        "header_row_count_used": 1,
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
        "line_items_with_non_none_qty_count": qty_non_none,
        "total_line_items_count": total_items,
    }
    return base


# ---------------------------------------------------------------------------
# TXT renderer
# ---------------------------------------------------------------------------

def _trunc(s: object, n: int) -> str:
    if s is None:
        return "None"
    t = str(s)
    return (t[:n] + "…") if len(t) > n else t


def _render_txt(output: dict) -> str:
    lines: list[str] = []
    lines.append("=" * 80)
    lines.append("Phase 1.9i — Single-Area-Targeted Diagnostic (11 sheets at hrc=1)")
    lines.append(f"Generated      : {output['generated_at']}")
    lines.append(f"Policy         : {output['header_row_count_policy']}")
    lines.append(f"Branch tip     : {output.get('branch_tip_at_generation', 'unknown')}")
    lines.append("=" * 80)

    for t in output["targets"]:
        rough = t["rough_name_input"]
        fname = t["resolved_file"]
        sname = t["resolved_sheet"]
        d = t["diagnostic"]

        lines.append("")
        lines.append("=" * 80)
        lines.append(f"TARGET: {rough}")
        lines.append(f"  resolved_file  : {fname}")
        lines.append(f"  resolved_sheet : {repr(sname)}")
        lines.append("=" * 80)

        if d.get("load_exception"):
            lines.append(f"  load_exception : (non-null)")
            lines.append(f"  classification : {d['classification']}")
            lines.append(f"  header_row_excel: {d['header_row_excel']}")
            lines.append("  --- exception excerpt (first 10 lines) ---")
            for ln in (d["load_exception"] or "").splitlines()[:10]:
                lines.append(f"    {ln}")
            lines.append("")
            continue

        lines.append(f"  classification        : {d['classification']}")
        lines.append(f"  pattern               : {d['pattern']}")
        lines.append(f"  areas                 : {d['areas']}")
        lines.append(f"  header_row_excel      : {d['header_row_excel']}")
        lines.append(f"  header_row_count_used : {d['header_row_count_used']}")
        lines.append("")

        # Table 1: header_cells_by_column + auto_guessed_column_role_map
        lines.append("  [Table 1] header_cells_by_column + auto_guessed_column_role_map")
        hcells = d.get("header_cells_by_column", {})
        rmap = d.get("auto_guessed_column_role_map", {})
        all_cols = sorted(
            set(hcells.keys()) | set(rmap.keys()),
            key=column_index_from_string,
        )
        lines.append(f"  {'Col':>4} | {'Header text (exact)':42} | Role")
        lines.append("  " + "-" * 72)
        for col in all_cols:
            cell_text = hcells.get(col)
            role = rmap.get(col)
            ct_display = _trunc(cell_text, 42)
            lines.append(f"  {col:>4} | {ct_display:42} | {role or 'null'}")
        lines.append("")

        # Table 2: first 3 L1 preambles
        l1s = d.get("first_3_l1_preambles", [])
        lines.append(f"  [Table 2] first_3_l1_preambles ({len(l1s)})")
        if l1s:
            lines.append(f"  {'ridx':>5} | {'row':>5} | {'description':50} | path")
            lines.append("  " + "-" * 100)
            for p in l1s:
                desc = _trunc(p.get("description"), 50)
                path = _trunc(p.get("path"), 50)
                lines.append(f"  {p['resolved_idx']:>5} | {p['excel_row']:>5} | {desc:50} | {path}")
        else:
            lines.append("  (none)")
        lines.append("")

        # Table 3: first L2 preamble
        l2 = d.get("first_l2_preamble")
        lines.append("  [Table 3] first_l2_preamble")
        if l2:
            desc = _trunc(l2.get("description"), 55)
            path = _trunc(l2.get("path"), 55)
            lines.append(f"  ridx={l2['resolved_idx']}  row={l2['excel_row']}  desc={desc}")
            lines.append(f"  path={path}")
        else:
            lines.append("  null")
        lines.append("")

        # Table 4: first 10 line items
        items = d.get("first_10_line_items", [])
        lines.append(f"  [Table 4] first_10_line_items ({len(items)})")
        if items:
            hdr = f"  {'ridx':>5} | {'row':>5} | {'description':44} | {'qty':>9} | {'rate':>11} | {'amount':>11} | parent_path"
            lines.append(hdr)
            lines.append("  " + "-" * 130)
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
                    f"  {it['resolved_idx']:>5} | {it['excel_row']:>5} | {desc:44} | "
                    f"{qty_s:>9} | {rate_s:>11} | {amt_s:>11} | {pp}"
                )
        else:
            lines.append("  (none)")
        lines.append("")

        nq = d.get("line_items_with_non_none_qty_count", 0)
        tot = d.get("total_line_items_count", 0)
        lines.append(f"  Line items with non-None qty: {nq} / {tot}")
        lines.append("")

    # Aggregate summary
    lines.append("=" * 80)
    lines.append("AGGREGATE SUMMARY")
    lines.append("=" * 80)
    all_targets = output["targets"]
    total_count = len(all_targets)
    classification_counts: dict[str, int] = {}
    total_null_roles = 0
    total_load_exceptions = 0
    non_none_qty_ratios: list[tuple[int, int]] = []

    for t in all_targets:
        d = t["diagnostic"]
        cls = d.get("classification", "none")
        classification_counts[cls] = classification_counts.get(cls, 0) + 1

        if d.get("load_exception"):
            total_load_exceptions += 1

        rmap = d.get("auto_guessed_column_role_map", {})
        for v in rmap.values():
            if v is None:
                total_null_roles += 1

        nq = d.get("line_items_with_non_none_qty_count", 0)
        tot = d.get("total_line_items_count", 0)
        non_none_qty_ratios.append((nq, tot))

    lines.append(f"  Total target count          : {total_count}")
    for cls_name in sorted(classification_counts.keys()):
        cnt = classification_counts[cls_name]
        lines.append(f"  Classification [{cls_name:12s}]: {cnt}")
    lines.append(f"  Total null role assignments : {total_null_roles}")
    lines.append(f"  Total load exceptions       : {total_load_exceptions}")

    if non_none_qty_ratios:
        # Sort by ratio (nq/tot), handling tot=0
        def _ratio(pair: tuple[int, int]) -> float:
            nq, tot = pair
            return nq / tot if tot > 0 else 0.0

        sorted_ratios = sorted(non_none_qty_ratios, key=_ratio)
        min_r = sorted_ratios[0]
        max_r = sorted_ratios[-1]
        mid_r = sorted_ratios[len(sorted_ratios) // 2]
        lines.append(
            f"  Non-None-qty ratio range    : "
            f"min={min_r[0]}/{min_r[1]}  "
            f"median={mid_r[0]}/{mid_r[1]}  "
            f"max={max_r[0]}/{max_r[1]}"
        )

    lines.append("")
    lines.append("END OF REPORT")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Phase 1.9i — single-area-targeted diagnostic starting...", flush=True)
    print(f"  Targets: {len(TARGETS)} sheets across 9 fixtures", flush=True)

    try:
        branch_tip = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=str(_SCRIPT_DIR),
            text=True,
        ).strip()
    except Exception:
        branch_tip = "unknown"

    results: list[dict] = []
    for target in TARGETS:
        print(f"  Processing: {target['rough']} ...", flush=True)
        results.append(_run_target(target))

    output = {
        "phase": "1.9i",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "header_row_count_policy": "hrc=1 only (single-area natural mode)",
        "branch_tip_at_generation": branch_tip,
        "targets": results,
    }

    json_path = _SCRIPT_DIR / "single_area_triage_1_9i_output.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nJSON output: {json_path} ({json_path.stat().st_size:,} bytes)")

    txt_path = _SCRIPT_DIR / "single_area_triage_1_9i_output.txt"
    txt_content = _render_txt(output)
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(txt_content)
    print(f"TXT output : {txt_path} ({txt_path.stat().st_size:,} bytes)")

    print("\nDone.")


if __name__ == "__main__":
    main()
