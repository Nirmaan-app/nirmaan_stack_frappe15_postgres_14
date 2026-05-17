#!/usr/bin/env python
"""Phase 1.9e real-fixture stress test. Observability only — no assertions."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import traceback
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# Path bootstrap — same convention as classifier_audit.py
_SCRIPT_DIR = Path(__file__).parent
_APP_ROOT = _SCRIPT_DIR.parent.parent.parent  # .../apps/nirmaan_stack/
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from openpyxl.utils import column_index_from_string  # noqa: E402

from nirmaan_stack.services.boq_parser.classifier import (  # noqa: E402
    RowClassification,
    _HEADER_KW,
)
from nirmaan_stack.services.boq_parser.config import (  # noqa: E402
    ColumnRole,
    GlobalSettings,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.multi_area_detection import (  # noqa: E402
    MultiAreaPattern,
    _RATE_CELL_PATTERN,
)
from nirmaan_stack.services.boq_parser.orchestrator import parse_boq  # noqa: E402
from nirmaan_stack.services.boq_parser.reader import BoqReader  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FIXTURES_DIR = _SCRIPT_DIR / "tests" / "fixtures"

# Step 1 — sheet-name exclusion substrings (case-insensitive, space-normalized)
SKIP_NAME_SUBSTRINGS = [
    # Mandatory
    "summary", "makelist", "make list", "make-list",
    # Additional
    "overall", "cover", "index", "instructions", "notes", "abbreviations",
    "legend", "toc", "table of contents", "change log", "revision history",
    "boq summary", "mep summary",
]

# Step 3 — synonym lists for rate-column-label variation detection
RATE_SYNONYMS = [
    "rate", "rates", "supply rate", "install rate", "installation rate",
    "total rate", "combined rate", "all-in rate", "all in rate",
    "rate per unit", "per unit rate", "unit rate", "rate (inr)", "rate(inr)",
    "rate inr", "rate / unit", "rate/unit",
]
COST_SYNONYMS = [
    "cost", "costs", "unit cost", "per unit cost", "total cost",
    "supply cost", "install cost", "installation cost", "material cost",
    "labour cost", "labor cost",
]
PRICE_SYNONYMS = [
    "price", "prices", "unit price", "per unit price", "total price",
]
ALL_SYNONYMS = RATE_SYNONYMS + COST_SYNONYMS + PRICE_SYNONYMS

# Step 0.4 — explicit list of 24 real BoQ fixture names (no glob; synthetic and
# snitch files are excluded here; 4 untracked synthetics must not be picked up)
REAL_FIXTURE_NAMES: list[str] = [
    "Unpriced BOQ.xlsx",
    "BOQ MEP_PAYTM BANGALORE.xlsx",
    "R0 WORKING-JSW  -MEP Priced BOQ- 29.04.2026.xlsx",
    "R0_MEP_HYBE_MUMBAI_FINAL_v4.xlsx",
    "Unpriced BOQ (1).xlsx",
    "Electrical BOQ.xlsx",
    "Electrical Unpriced BOQ-03.02.2026 R1.xlsx",
    "Inovalon HVAC Unpriced BOQ-21.01.2026.xlsx",
    "R0_CIVIL INTERIOR & MEP_TABLESPACE_PUNETH WORKING FILE_06.05.2026 (2).xlsx",
    "RAHEJA Commerzone  Chennai BOQ.xlsx",
    "RFQ for D-Tech Electrical BOQ - 05.05.2026 (2).xlsx",
    "Bill of Quantities.xlsx",
    "Unpriced_DHL Chennai_MEP_15 April_V2..xlsx",
    "Terranova_ GC- Cost comparison  20-04-2026 -MEP BOQ.xlsx",
    "(Unpriced_R1)ES-EL-CW-MS-6A-L1  L2-ELECTRICAL MODIFICATION PRICED BOQ-10.03.2026-R1.xlsx",
    "(Unpriced_R1)ES-CW-MS -6A-L1  L2-HVAC MODIFICATION 09.03.2026.xlsx",
    "(Unpriced_R1)ES-CW-MS-6A-L1  L2-FLS MODIFICATION PRICED BOQ-10.03.26.xlsx",
    "RFQ_Societe Generale_Bangalore_Electrical works_BOQ-26022026 (1).xlsx",
    "RFQ_Societe Generale_Bangalore_HVAC_BOQ-26-02-2026 (1).xlsx",
    "Kohler-BOQ- 06-04-26.xlsx",
    "K-Mall Jodhpur BOQ Combined.xlsx",
    "KSM 66_Internal Electrical BOQ R1 Final.xlsx",
    "TS T2 WEX BANGLORE- HVAC UNPRICED BOQ-30.04.2026 R0.xlsx",
    "TS-UNPRICED ELECTRICAL BOQ-01.05.2026.xlsx",
]

SNITCH_FIXTURE = "snitch_electrical.xlsx"

# Singleton roles (must appear at most once in column_role_map per SheetConfig validator)
_SINGLETON_ROLES = frozenset({
    "sl_no", "description", "unit", "qty_total",
    "rate_supply", "rate_install", "rate_combined",
    "amount_total", "amount_combined", "make_model", "row_notes", "reference_images",
})


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _normalize(s: str) -> str:
    """Lowercase + collapse internal whitespace."""
    return " ".join(str(s).strip().lower().split())


def _matches_skip(sheet_name: str) -> tuple[bool, str]:
    norm = _normalize(sheet_name)
    for sub in SKIP_NAME_SUBSTRINGS:
        if sub in norm:
            return True, sub
    return False, ""


def _format_pattern(mp: MultiAreaPattern | None) -> str | None:
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


# ---------------------------------------------------------------------------
# Step 1 — Sheet selection
# ---------------------------------------------------------------------------

def select_sheets(reader: BoqReader) -> tuple[list[str], list[dict]]:
    """Return (selected_names, excluded_list). Selected: top-4 by data-row count."""
    states = reader.list_sheet_states()
    candidates: list[tuple[str, int]] = []
    excluded: list[dict] = []

    for sheet_name, state in states.items():
        # Rule 1: visibility
        if state != "visible":
            excluded.append({"name": sheet_name, "reason": state})
            continue

        # Rule 2: name exclusion patterns
        skip, matched = _matches_skip(sheet_name)
        if skip:
            excluded.append({"name": sheet_name, "reason": f"skip-name-match:{matched}"})
            continue

        # Rule 3: header row detectable within first 50 rows
        try:
            header_row = reader.detect_header_row(sheet_name, scan_top_n=50)
        except Exception:
            header_row = None

        if header_row is None or header_row > 50:
            excluded.append({"name": sheet_name, "reason": "no-header"})
            continue

        # Rule 4: at least 10 data rows below header
        try:
            last_row, _ = reader.get_sheet_dimensions(sheet_name)
        except Exception:
            excluded.append({"name": sheet_name, "reason": "no-header"})
            continue

        data_row_count = max(0, last_row - header_row)
        if data_row_count < 10:
            excluded.append({"name": sheet_name, "reason": "too-few-data-rows"})
            continue

        candidates.append((sheet_name, data_row_count))

    # Top-4 by data-row count (descending); rest excluded as "not-in-top-4"
    candidates.sort(key=lambda x: x[1], reverse=True)
    top4 = candidates[:4]
    for name, _ in candidates[4:]:
        excluded.append({"name": name, "reason": "not-in-top-4"})

    return [name for name, _ in top4], excluded


# ---------------------------------------------------------------------------
# Step 2 — Auto-guess MappingConfig (zero user declaration)
# ---------------------------------------------------------------------------

def _auto_guess_sheet_config(reader: BoqReader, sheet_name: str) -> SheetConfig:
    header_row = reader.detect_header_row(sheet_name, scan_top_n=50)
    assert header_row is not None

    header_rows = list(reader.iter_rows(sheet_name, start_row=header_row, end_row=header_row))
    if not header_rows:
        return SheetConfig(sheet_name=sheet_name, header_row=header_row)

    header_raw = header_rows[0]
    column_role_map: dict[str, ColumnRole] = {}
    assigned_singletons: set[str] = set()

    sorted_cells = sorted(
        header_raw.cells.items(),
        key=lambda kv: column_index_from_string(kv[0]),
    )

    for col_letter, ci in sorted_cells:
        if ci.value is None:
            continue
        cell_text = _normalize(str(ci.value))
        if not cell_text:
            continue

        # Substring match against _HEADER_KW (same logic as classifier.py)
        matched_role: str | None = None
        for role_key, kw_set in _HEADER_KW.items():
            if any(kw in cell_text for kw in kw_set):
                matched_role = role_key
                break

        if matched_role is None:
            continue

        # Skip if singleton already assigned (avoid MappingConfig validation error)
        if matched_role in _SINGLETON_ROLES and matched_role in assigned_singletons:
            continue

        # amount_by_area requires area= — skip it (not in _HEADER_KW anyway, but guard)
        if matched_role in {"amount_by_area", "rate_supply_by_area", "rate_install_by_area", "rate_combined_by_area"}:
            continue

        column_role_map[col_letter] = ColumnRole(role=matched_role)  # type: ignore[arg-type]
        if matched_role in _SINGLETON_ROLES:
            assigned_singletons.add(matched_role)

    return SheetConfig(
        sheet_name=sheet_name,
        header_row=header_row,
        column_role_map=column_role_map,
    )


def _build_mapping_config(reader: BoqReader, fixture_name: str, selected: list[str]) -> MappingConfig:
    """MappingConfig with zero user declaration — auto-guessed from header rows."""
    sheet_configs = [_auto_guess_sheet_config(reader, s) for s in selected]
    # MappingConfig requires project + master_boq fields (actual class shape).
    # Adaptation from Step 2 spec: spec described a dict-based shape; actual shape is
    # list[SheetConfig] with mandatory project + master_boq. See self-report item 16.
    return MappingConfig(
        project="stress-test-auto",
        master_boq=MasterBoqMetadata(boq_name=fixture_name),
        global_settings=GlobalSettings(),
        sheets=sheet_configs,
    )


# ---------------------------------------------------------------------------
# Step 3 — Rate-column-label variation detection
# ---------------------------------------------------------------------------

def _detect_rate_variations(reader: BoqReader, sheet_name: str, header_row: int) -> list[dict]:
    rows = list(reader.iter_rows(sheet_name, start_row=header_row, end_row=header_row))
    if not rows:
        return []

    variations: list[dict] = []
    header_raw = rows[0]
    sorted_cells = sorted(
        header_raw.cells.items(),
        key=lambda kv: column_index_from_string(kv[0]),
    )

    for col_letter, ci in sorted_cells:
        if ci.value is None:
            continue
        original = str(ci.value)
        norm = _normalize(original)
        if not norm:
            continue

        matched_synonym: str | None = None
        for syn in ALL_SYNONYMS:
            if syn in norm:
                matched_synonym = syn
                break

        if matched_synonym is None:
            continue

        # Only report cells NOT already matched by _RATE_CELL_PATTERN
        if _RATE_CELL_PATTERN.match(norm):
            continue

        variations.append({
            "column": col_letter,
            "header_text": original,
            "matched_synonym": matched_synonym,
            "matches_RATE_CELL_PATTERN": False,
        })

    return variations


# ---------------------------------------------------------------------------
# Per-workbook parsing
# ---------------------------------------------------------------------------

def _first_n_line_items(resolved_rows: list, n: int = 3) -> list[dict]:
    result = []
    for rr in resolved_rows:
        if rr.classified_row.classification == RowClassification.LINE_ITEM:
            cr = rr.classified_row
            result.append({
                "sl_no": cr.sl_no_value,
                "description": (cr.description[:80] if cr.description else None),
                "unit": cr.unit,
                "qty": cr.qty,
            })
            if len(result) >= n:
                break
    return result


def parse_one_workbook(filepath: Path) -> dict:
    fixture_name = filepath.name
    result: dict = {
        "load_status": "success",
        "load_exception": None,
        "total_sheets": 0,
        "selected_sheets": [],
        "excluded_sheets": [],
        "per_sheet": {},
    }

    try:
        reader = BoqReader(str(filepath))
    except Exception as exc:
        result["load_status"] = "failed"
        result["load_exception"] = {
            "type": type(exc).__name__,
            "message": str(exc),
            "traceback": traceback.format_exc(),
        }
        return result

    result["total_sheets"] = len(reader.list_sheets())

    try:
        selected, excluded = select_sheets(reader)
    except Exception as exc:
        result["load_status"] = "failed"
        result["load_exception"] = {
            "type": type(exc).__name__,
            "message": f"sheet selection failed: {exc}",
            "traceback": traceback.format_exc(),
        }
        return result

    result["selected_sheets"] = selected
    result["excluded_sheets"] = excluded

    if not selected:
        result["no_qualifying_sheets"] = True
        return result

    # Build zero-declaration MappingConfig for all selected sheets
    try:
        config = _build_mapping_config(reader, fixture_name, selected)
    except Exception as exc:
        result["load_status"] = "failed"
        result["load_exception"] = {
            "type": type(exc).__name__,
            "message": f"auto-guess config build failed: {exc}",
            "traceback": traceback.format_exc(),
        }
        return result

    # Build lookup for header_row per sheet (needed for Step 3 and data_row_count)
    config_map: dict[str, SheetConfig] = {sc.sheet_name: sc for sc in config.sheets}

    # Run parse_boq once for the whole workbook (performance: one BoqReader load
    # inside parse_boq instead of N loads for N sheets).  If it raises, mark all
    # selected sheets as exception and return.
    try:
        parsed_boq = parse_boq(str(filepath), config)
    except Exception as exc:
        tb = traceback.format_exc()
        exc_entry = {"type": type(exc).__name__, "message": str(exc), "traceback": tb}
        for sheet_name in selected:
            sc = config_map.get(sheet_name)
            sheet_result: dict = {
                "parse_status": "exception",
                "exception": exc_entry,
                "header_row": sc.header_row if sc else None,
                "data_row_count": 0,
                "multi_area_pattern": None,
                "areas": None,
                "max_preamble_level": 0,
                "classification_counts": {},
                "first_3_line_items": [],
                "validation_warnings_count": 0,
                "first_3_warnings": [],
                "review_flagged_count": 0,
                "rate_column_variations": [],
            }
            result["per_sheet"][sheet_name] = sheet_result
        return result

    parsed_map: dict[str, object] = {ps.sheet_name: ps for ps in parsed_boq.sheets}

    for sheet_name in selected:
        sc = config_map.get(sheet_name)
        ps = parsed_map.get(sheet_name)

        sheet_result = {
            "parse_status": "success",
            "exception": None,
            "header_row": sc.header_row if sc else None,
            "data_row_count": 0,
            "multi_area_pattern": None,
            "areas": None,
            "max_preamble_level": 0,
            "classification_counts": {},
            "first_3_line_items": [],
            "validation_warnings_count": 0,
            "first_3_warnings": [],
            "review_flagged_count": 0,
            "rate_column_variations": [],
        }

        if sc and sc.header_row:
            try:
                last_row, _ = reader.get_sheet_dimensions(sheet_name)
                sheet_result["data_row_count"] = max(0, last_row - sc.header_row)
            except Exception:
                pass

        if ps is None:
            sheet_result["parse_status"] = "exception"
            sheet_result["exception"] = {
                "type": "MissingSheet",
                "message": "Sheet absent from ParsedBoq output",
                "traceback": "",
            }
            result["per_sheet"][sheet_name] = sheet_result
            continue

        counts: dict[str, int] = {}
        max_level = 0
        all_warnings: list[str] = []
        review_flagged = 0

        for rr in ps.resolved_rows:
            cls_key = rr.classified_row.classification.value.upper()
            counts[cls_key] = counts.get(cls_key, 0) + 1
            if rr.level is not None and rr.level > max_level:
                max_level = rr.level
            all_warnings.extend(rr.validation_warnings)
            if rr.needs_classification_review:
                review_flagged += 1

        sheet_result["classification_counts"] = counts
        sheet_result["max_preamble_level"] = max_level
        sheet_result["first_3_line_items"] = _first_n_line_items(ps.resolved_rows)
        sheet_result["validation_warnings_count"] = len(all_warnings)
        sheet_result["first_3_warnings"] = all_warnings[:3]
        sheet_result["review_flagged_count"] = review_flagged

        if ps.multi_area_pattern is not None:
            sheet_result["multi_area_pattern"] = _format_pattern(ps.multi_area_pattern)
            sheet_result["areas"] = ps.multi_area_pattern.areas

        # Step 3: rate-column-label variations
        if sc and sc.header_row:
            try:
                sheet_result["rate_column_variations"] = _detect_rate_variations(
                    reader, sheet_name, sc.header_row
                )
            except Exception:
                pass

        result["per_sheet"][sheet_name] = sheet_result

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    all_fixtures = (
        [(FIXTURES_DIR / n, n) for n in REAL_FIXTURE_NAMES]
        + [(FIXTURES_DIR / SNITCH_FIXTURE, SNITCH_FIXTURE)]
    )

    try:
        branch_tip = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=str(_SCRIPT_DIR),
            text=True,
        ).strip()
    except Exception:
        branch_tip = "unknown"

    per_fixture_results: dict[str, dict] = {}
    rate_per_fixture: dict[str, dict[str, list]] = {}
    aggregate_by_synonym: dict[str, list] = defaultdict(list)

    workbooks_attempted = 0
    workbooks_load_failed = 0
    workbooks_no_qualifying = 0
    sheets_selected_total = 0
    sheets_with_exception = 0
    pattern_dist: dict[str, int] = {
        "Pattern 1": 0, "Pattern 2-area": 0, "Pattern 2-rate": 0, "Pattern 3": 0, "None": 0,
    }
    classification_totals: dict[str, int] = {
        "LINE_ITEM": 0, "PREAMBLE": 0, "NOTE": 0, "SPACER": 0,
        "SUBTOTAL_MARKER": 0, "HEADER_REPEAT": 0,
    }
    exception_types: dict[str, int] = {}
    rate_variations_total = 0

    for filepath, fixture_name in all_fixtures:
        workbooks_attempted += 1
        print(f"  [{workbooks_attempted:2d}/{len(all_fixtures)}] {fixture_name}", flush=True)

        result = parse_one_workbook(filepath)
        per_fixture_results[fixture_name] = result

        if result["load_status"] == "failed":
            workbooks_load_failed += 1
            exc_type = (result.get("load_exception") or {}).get("type", "Unknown")
            exception_types[exc_type] = exception_types.get(exc_type, 0) + 1
            continue

        if result.get("no_qualifying_sheets"):
            workbooks_no_qualifying += 1
            continue

        selected = result.get("selected_sheets", [])
        sheets_selected_total += len(selected)

        fixture_variations: dict[str, list] = {}

        for sheet_name, sd in result.get("per_sheet", {}).items():
            if sd.get("parse_status") == "exception":
                sheets_with_exception += 1
                exc_type = (sd.get("exception") or {}).get("type", "Unknown")
                exception_types[exc_type] = exception_types.get(exc_type, 0) + 1

            pat = sd.get("multi_area_pattern")
            pat_key = pat if pat in pattern_dist else "None"
            pattern_dist[pat_key] += 1

            for cls, cnt in sd.get("classification_counts", {}).items():
                if cls in classification_totals:
                    classification_totals[cls] += cnt

            variations = sd.get("rate_column_variations", [])
            if variations:
                fixture_variations[sheet_name] = variations
                for v in variations:
                    syn = v["matched_synonym"]
                    aggregate_by_synonym[syn].append({
                        "fixture": fixture_name,
                        "sheet": sheet_name,
                        "column": v["column"],
                    })
                    rate_variations_total += 1

        if fixture_variations:
            rate_per_fixture[fixture_name] = fixture_variations

    output = {
        "_metadata": {
            "phase": "1.9e",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "script_version": "1.0",
            "branch_tip_at_generation": branch_tip,
            "fixture_count_total": 25,
            "fixture_count_real": 24,
            "fixture_count_snitch": 1,
        },
        "_summary": {
            "workbooks_attempted": workbooks_attempted,
            "workbooks_load_failed": workbooks_load_failed,
            "workbooks_no_qualifying_sheets": workbooks_no_qualifying,
            "sheets_selected_total": sheets_selected_total,
            "sheets_with_exception_during_parse": sheets_with_exception,
            "pattern_distribution": pattern_dist,
            "classification_totals_across_corpus": classification_totals,
            "exception_types_frequency": exception_types,
            "rate_synonym_variations_total_unique": rate_variations_total,
        },
        "rate_column_label_variations": {
            "aggregate_by_synonym": dict(aggregate_by_synonym),
            "per_fixture": rate_per_fixture,
        },
        "per_fixture_results": per_fixture_results,
    }

    output_path = _SCRIPT_DIR / "real_fixture_stress_test_output.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False, default=str)

    print(
        f"\nWorkbooks: {workbooks_attempted} | "
        f"Sheets parsed: {sheets_selected_total} | "
        f"Exceptions: {workbooks_load_failed + sheets_with_exception} | "
        f"Rate synonym variations: {rate_variations_total} | "
        f"Output: {output_path}"
    )


if __name__ == "__main__":
    main()
