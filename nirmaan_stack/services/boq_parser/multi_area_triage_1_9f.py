#!/usr/bin/env python3
"""
Phase 1.9f Stage 1 — multi-area triage diagnostic.

Parses 3 target sheets at BOTH header_row_count=1 AND header_row_count=2.
Captures per-row detail: pattern detection, areas, header row, first 3 L1
preambles, first L2 preamble, first 10 line items with parent + per-area
qty / rate / amount.

Empirical input to §17.13 wizard-load decision: is parser-side "try both"
auto-detect heuristic for header_row_count viable, keeping it out of the
wizard?

Targets (hardcoded from Step 0 discovery — see sheet_names_discovered below):
  1. Raheja Commerzone Chennai BOQ — "Electrical " sheet  (header_row=3)
  2. Raheja Commerzone Chennai BOQ — "HVAC " sheet        (header_row=3)
  3. Snitch fixture              — "6. Electrical" sheet  (header_row=1)

No parser code changes. No Frappe imports. No test assertions.

References:
  Phase 1.9e chore commit: 5cd4f580
  Phase 1.9e docs commit:  5cb9907b

Run from repo root:
  python -m nirmaan_stack.services.boq_parser.multi_area_triage_1_9f
"""
from __future__ import annotations

import json
import subprocess
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Path bootstrap — same convention as real_fixture_stress_test.py (1.9e)
# ---------------------------------------------------------------------------
_SCRIPT_DIR = Path(__file__).parent
_APP_ROOT = _SCRIPT_DIR.parent.parent.parent  # .../apps/nirmaan_stack/
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from nirmaan_stack.services.boq_parser._auto_guess import (  # noqa: E402
    auto_guess_sheet_config,
)
from nirmaan_stack.services.boq_parser.classifier import (  # noqa: E402
    RowClassification,
)
from nirmaan_stack.services.boq_parser.config import (  # noqa: E402
    GlobalSettings,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.multi_area_detection import (  # noqa: E402
    MultiAreaPattern,
)
from nirmaan_stack.services.boq_parser.orchestrator import parse_boq  # noqa: E402
from nirmaan_stack.services.boq_parser.reader import BoqReader  # noqa: E402

FIXTURES_DIR = _SCRIPT_DIR / "tests" / "fixtures"

RAHEJA_PATH = FIXTURES_DIR / "RAHEJA Commerzone  Chennai BOQ.xlsx"
SNITCH_PATH = FIXTURES_DIR / "snitch_electrical.xlsx"

# Hardcoded from Step 0 discovery (1.9e stress test output + verbatim sheet names):
#   Raheja total_sheets=22; Electrical (trailing space, header_row=3),
#   HVAC (trailing space, header_row=3); Snitch total_sheets=5, 6. Electrical (header_row=1).
TARGETS: list[dict] = [
    {
        "label": "Raheja Electrical",
        "workbook_path": RAHEJA_PATH,
        "sheet_name": "Electrical ",   # trailing space — verbatim from Step 0
        "discovered_header_row": 3,
    },
    {
        "label": "Raheja HVAC",
        "workbook_path": RAHEJA_PATH,
        "sheet_name": "HVAC ",         # trailing space — verbatim from Step 0
        "discovered_header_row": 3,
    },
    {
        "label": "Snitch Electrical",
        "workbook_path": SNITCH_PATH,
        "sheet_name": "6. Electrical",
        "discovered_header_row": 1,
    },
]

# ---------------------------------------------------------------------------
# Build per-hrc SheetConfig via shared auto_guess_sheet_config module
# ---------------------------------------------------------------------------

def _build_sheet_config(reader: BoqReader, sheet_name: str, header_row: int, header_row_count: int) -> SheetConfig:
    return auto_guess_sheet_config(
        reader, sheet_name, header_row, header_row_count,
        GlobalSettings().multi_area_reserved_keywords,
    )

# ---------------------------------------------------------------------------
# Detection routing description (best-effort, from source analysis)
# ---------------------------------------------------------------------------

def _routing_description(header_row_count: int, pattern_str: str | None) -> str:
    if header_row_count == 1:
        tried = "1-row mode — priority: Pattern 3 → Pattern 1 (bottom row) → None"
    else:
        tried = (
            "2-row mode — priority: Pattern 2-rate → Pattern 2 → "
            "Pattern 3 (bottom) → Pattern 1 (bottom) → Pattern 1 (top) → None"
        )
    return f"{tried}. Final winner: {pattern_str or 'None (single-area)'}"


# ---------------------------------------------------------------------------
# Per-row helpers
# ---------------------------------------------------------------------------

def _pattern_str(mp: MultiAreaPattern | None) -> str | None:
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
    """Coerce None / '' to JSON null; keep 0 as 0."""
    if v is None:
        return None
    if isinstance(v, str) and v.strip() == "":
        return None
    return v


def _best_rate(cr) -> float | None:
    """Single-area best available rate: combined > supply > install."""
    for attr in ("rate_combined", "rate_supply", "rate_install"):
        val = getattr(cr, attr, None)
        if val is not None:
            return val
    return None


def _best_area_rate(rates_dict: dict) -> float | None:
    """Extract best rate from a per-area rates dict {kind: value}."""
    for key in ("combined_rate", "supply_rate", "install_rate"):
        val = rates_dict.get(key)
        if val is not None:
            return val
    return None


def _ancestor_chain(resolved_rows: list, parent_index: int | None) -> str:
    """Build 'root > ... > immediate parent' description string."""
    chain: list[str] = []
    idx = parent_index
    while idx is not None:
        rr = resolved_rows[idx]
        desc = (rr.classified_row.description or "").strip()
        chain.append(desc if desc else "(no description)")
        idx = rr.parent_index
    chain.reverse()
    return " > ".join(chain) if chain else ""


# ---------------------------------------------------------------------------
# Diagnostic block extraction
# ---------------------------------------------------------------------------

def _extract_diagnostic(
    parse_result,  # None if exception
    exc_tb: str | None,
    sheet_config: SheetConfig,
    header_row_count: int,
) -> dict:
    if exc_tb is not None:
        return {
            "parse_status": "exception",
            "exception_traceback": exc_tb,
            "classification": None,
            "pattern": None,
            "detection_routing": _routing_description(header_row_count, None),
            "areas": None,
            "header_row_excel": sheet_config.header_row,
            "first_3_l1_preambles": [],
            "first_l2_preamble": None,
            "first_10_line_items": [],
        }

    # parse_result is (parsed_boq, parsed_sheet)
    parsed_boq, parsed_sheet = parse_result

    mp = parsed_sheet.multi_area_pattern
    pat_str = _pattern_str(mp)
    resolved_rows: list = parsed_sheet.resolved_rows

    # First 3 L1 preambles (level == 1)
    first_3_l1: list[dict] = []
    first_l2: dict | None = None
    for rr in resolved_rows:
        if rr.classified_row.classification != RowClassification.PREAMBLE:
            continue
        row_num = rr.classified_row.raw_row.row_number
        desc = _null_if_blank(rr.classified_row.description)
        if rr.level == 1 and len(first_3_l1) < 3:
            first_3_l1.append({"excel_row": row_num, "description": desc})
        if rr.level == 2 and first_l2 is None:
            first_l2 = {"excel_row": row_num, "description": desc}

    # First 10 line items
    first_10: list[dict] = []
    for rr in resolved_rows:
        if rr.classified_row.classification != RowClassification.LINE_ITEM:
            continue
        if len(first_10) >= 10:
            break

        cr = rr.classified_row
        row_num = cr.raw_row.row_number

        parent_desc = None
        if rr.parent_index is not None and rr.parent_index < len(resolved_rows):
            parent_cr = resolved_rows[rr.parent_index].classified_row
            parent_desc = _null_if_blank(parent_cr.description)

        anc_chain = _ancestor_chain(resolved_rows, rr.parent_index)
        anc_chain = anc_chain if anc_chain else None

        item: dict = {
            "excel_row": row_num,
            "sl_no": _null_if_blank(cr.sl_no_value),
            "description": _null_if_blank(cr.description),
            "unit": _null_if_blank(cr.unit),
            "parent_description": parent_desc,
            "ancestor_chain": anc_chain,
        }

        if mp is not None:
            # Multi-area
            areas = mp.areas
            per_area: dict = {}
            for area in areas:
                area_qty = rr.qty_by_area.get(area)
                area_rate = _best_area_rate(rr.rate_by_area.get(area, {}))
                area_amt = rr.amount_by_area.get(area)
                per_area[area] = {
                    "qty": area_qty,
                    "rate": area_rate,
                    "amount": area_amt,
                }
            totals_rate = _best_rate(cr)
            item["multi_area_data"] = {
                "per_area": per_area,
                "totals": {
                    "qty": rr.qty_total,
                    "rate": totals_rate,
                    "amount": rr.amount_total,
                },
            }
        else:
            # Single-area
            item["single_area_data"] = {
                "qty": _null_if_blank(cr.qty),
                "rate": _best_rate(cr),
                "amount": _null_if_blank(cr.amount_total),
            }

        first_10.append(item)

    return {
        "parse_status": "success",
        "exception_traceback": None,
        "classification": "multi_area" if mp is not None else "single_area",
        "pattern": pat_str,
        "detection_routing": _routing_description(header_row_count, pat_str),
        "areas": mp.areas if mp is not None else None,
        "header_row_excel": sheet_config.header_row,
        "first_3_l1_preambles": first_3_l1,
        "first_l2_preamble": first_l2,
        "first_10_line_items": first_10,
    }


# ---------------------------------------------------------------------------
# Per-target runner
# ---------------------------------------------------------------------------

def _run_target(target: dict) -> dict:
    label = target["label"]
    wp: Path = target["workbook_path"]
    sheet_name: str = target["sheet_name"]
    discovered_hr: int = target["discovered_header_row"]

    result: dict = {
        "target_label": label,
        "workbook_filename": wp.name,
        "sheet_name_exact": sheet_name,
        "header_row_count_1": {},
        "header_row_count_2": {},
    }

    try:
        reader = BoqReader(str(wp))
    except Exception:
        tb = traceback.format_exc()
        for key in ("header_row_count_1", "header_row_count_2"):
            result[key] = {
                "parse_status": "exception",
                "exception_traceback": f"BoqReader open failed:\n{tb}",
                "classification": None,
                "pattern": None,
                "detection_routing": "N/A — workbook could not be opened",
                "areas": None,
                "header_row_excel": discovered_hr,
                "first_3_l1_preambles": [],
                "first_l2_preamble": None,
                "first_10_line_items": [],
            }
        return result

    for hrc in (1, 2):
        key = f"header_row_count_{hrc}"
        try:
            sc = _build_sheet_config(reader, sheet_name, discovered_hr, hrc)
            config = MappingConfig(
                project="triage-1-9f",
                master_boq=MasterBoqMetadata(boq_name=wp.name),
                global_settings=GlobalSettings(),
                sheets=[sc],
            )
            parsed_boq = parse_boq(str(wp), config)
            parsed_sheet = next((s for s in parsed_boq.sheets if s.sheet_name == sheet_name), None)
            if parsed_sheet is None:
                raise ValueError(f"Sheet '{sheet_name}' absent from ParsedBoq output")
            result[key] = _extract_diagnostic((parsed_boq, parsed_sheet), None, sc, hrc)
        except Exception:
            tb = traceback.format_exc()
            sc_fallback = SheetConfig(sheet_name=sheet_name, header_row=discovered_hr)
            result[key] = _extract_diagnostic(None, tb, sc_fallback, hrc)

    return result


# ---------------------------------------------------------------------------
# TXT renderer
# ---------------------------------------------------------------------------

def _trunc(s: object, n: int) -> str:
    if s is None:
        return "None"
    t = str(s)
    return t[:n] + "…" if len(t) > n else t


def _render_txt(output: dict) -> str:
    lines: list[str] = []
    lines.append("=" * 80)
    lines.append("Phase 1.9f Stage 1 — Multi-Area Triage Diagnostic")
    lines.append(f"Generated: {output['_metadata']['generated_at']}")
    lines.append(f"Branch tip: {output['_metadata']['branch_tip_at_generation']}")
    lines.append("=" * 80)

    for target_result in output["results"]:
        label = target_result["target_label"]
        wb = target_result["workbook_filename"]
        sn = target_result["sheet_name_exact"]
        lines.append("")
        lines.append("=" * 80)
        lines.append(f"TARGET: {label}")
        lines.append(f"  Workbook : {wb}")
        lines.append(f"  Sheet    : {repr(sn)}")
        lines.append("=" * 80)

        for hrc in (1, 2):
            key = f"header_row_count_{hrc}"
            d = target_result[key]
            lines.append("")
            lines.append(f"  --- header_row_count={hrc} ---")
            lines.append(f"  parse_status      : {d['parse_status']}")
            if d["parse_status"] == "exception":
                lines.append("  exception_traceback:")
                for ln in (d.get("exception_traceback") or "").splitlines():
                    lines.append(f"    {ln}")
                continue
            lines.append(f"  classification    : {d['classification']}")
            lines.append(f"  pattern           : {d['pattern']}")
            lines.append(f"  detection_routing : {d['detection_routing']}")
            lines.append(f"  areas             : {d['areas']}")
            lines.append(f"  header_row_excel  : {d['header_row_excel']}")

            # Preambles
            l1s = d["first_3_l1_preambles"]
            lines.append(f"  first_3_l1_preambles ({len(l1s)}):")
            for p in l1s:
                lines.append(f"    row={p['excel_row']}  desc={_trunc(p['description'], 70)}")
            l2 = d["first_l2_preamble"]
            lines.append(f"  first_l2_preamble : row={l2['excel_row']} desc={_trunc(l2['description'], 70)}" if l2 else "  first_l2_preamble : None")

            # Line items
            items = d["first_10_line_items"]
            lines.append(f"  first_10_line_items ({len(items)}):")
            if not items:
                lines.append("    (none)")
            else:
                hdr = f"    {'row':>5} | {'sl_no':12} | {'desc':60} | {'unit':8} | {'parent':40} | data"
                lines.append(hdr)
                lines.append("    " + "-" * (len(hdr) - 4))
                for it in items:
                    sl = _trunc(it["sl_no"], 12)
                    desc = _trunc(it["description"], 60)
                    unit = _trunc(it["unit"], 8)
                    parent = _trunc(it["parent_description"], 40)
                    if "multi_area_data" in it:
                        mad = it["multi_area_data"]
                        parts = []
                        for area, av in mad["per_area"].items():
                            parts.append(f"{area}: qty={av['qty']} rate={av['rate']} amt={av['amount']}")
                        tot = mad["totals"]
                        parts.append(f"totals: qty={tot['qty']} rate={tot['rate']} amt={tot['amount']}")
                        data_str = " | ".join(parts)
                    else:
                        sad = it.get("single_area_data", {})
                        data_str = f"qty={sad.get('qty')} rate={sad.get('rate')} amt={sad.get('amount')}"
                    lines.append(f"    {it['excel_row']:>5} | {sl:12} | {desc:60} | {unit:8} | {parent:40} | {data_str}")

    lines.append("")
    lines.append("=" * 80)
    lines.append("END OF REPORT")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Phase 1.9f Stage 1 — starting triage", flush=True)

    # Step 0 diagnostic: list all sheets in both workbooks
    for wb_path in (RAHEJA_PATH, SNITCH_PATH):
        try:
            r = BoqReader(str(wb_path))
            sheets = r.list_sheets()
            print(f"\nSheets in {wb_path.name} ({len(sheets)} total):")
            for i, s in enumerate(sheets, 1):
                print(f"  {i:2d}. {repr(s)}")
        except Exception as exc:
            print(f"  ERROR opening {wb_path.name}: {exc}")

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
        print(f"\nProcessing: {target['label']} ...", flush=True)
        results.append(_run_target(target))

    output = {
        "_metadata": {
            "phase": "1.9f Stage 1",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "script_version": "1.0",
            "branch_tip_at_generation": branch_tip,
            "targets_attempted": len(TARGETS),
            "raheja_workbook_path": str(RAHEJA_PATH),
            "snitch_workbook_path": str(SNITCH_PATH),
        },
        "_amount_provenance_note": (
            "Per-area amounts are populated at parse time via _apply_multi_area_post_pass: "
            "direct cell values from amount_by_area ColumnRoles, OR computed as qty × rate "
            "when rate columns present (Pattern 2-rate) and no direct amount. "
            "Single-area amount_total comes from the classified_row.amount_total cell value. "
            "All amount fields may still be null for sheets where the parser finds no amount "
            "columns or no numeric values."
        ),
        "results": results,
    }

    json_path = _SCRIPT_DIR / "multi_area_triage_1_9f_output.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nJSON output: {json_path} ({json_path.stat().st_size} bytes)")

    txt_path = _SCRIPT_DIR / "multi_area_triage_1_9f_output.txt"
    txt_content = _render_txt(output)
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(txt_content)
    print(f"TXT output : {txt_path} ({txt_path.stat().st_size} bytes)")

    print("\nDone — STOP at Step 3. Awaiting chat-Claude review before commit.")


if __name__ == "__main__":
    main()
