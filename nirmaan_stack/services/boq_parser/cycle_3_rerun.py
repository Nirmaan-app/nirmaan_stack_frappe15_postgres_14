"""
cycle_3_rerun.py -- Cycle 3 post-Bug-19 validation runner for the BoQ parser.

Purpose:
    Replay the BoQ parser against the 8 locked cycle 3 fixtures and write
    per-project JSON + CSV outputs plus an aggregate _run_summary.json.
    Used to validate parser state after Bug-19 + Bug-19-ext landing
    (feat fbc1d845, docs f6b5d8b7).

    multi_area_merged_header_v1 was DROPPED from the locked fixture set per
    v5.26a decision (2026-05-27). The runner skips any config file whose
    project name is not in PROJECT_TO_FIXTURE (8 entries, no multi_v1).

Inputs:
    --configs-dir   Directory containing *_sheetconfig.py files.
    --fixtures-dir  Directory containing .xlsx fixture files.
    --output-dir    Directory to write outputs (created if absent).
    --projects      Optional comma-separated project name filter.
                    Omit to run all 8 locked projects.
    --self-test     Smoke test on safron_hvac_2026_04_11 only,
                    writing to /tmp/cycle_3_test_output/. Does not
                    overwrite the real output directory.

Outputs (per project):
    {project}_parsed.json   Full parse tree (2-space JSON indent).
    {project}_rows.csv      Per-row CSV with # preamble + column map.
    _run_summary.json       Aggregate array of per-project stats.

Cross-references:
    Plan doc:     frontend/.claude/plans/boq-upload-plan.md sec 17.44
    Handover doc: cycle 3 deep dive section
    Configs:      nirmaan_stack/services/boq_parser/cycle_3_configs/

Run context (post-Bug-19 + 19-ext):
    Baseline commit: fbc1d845 (feat) + f6b5d8b7 (docs).
    Parser tests:    565 passing at time of last verification.
    Verified for post-Bug-19 reuse on 2026-05-27.

Usage:
    python -m nirmaan_stack.services.boq_parser.cycle_3_rerun \\
      --configs-dir nirmaan_stack/services/boq_parser/cycle_3_configs \\
      --fixtures-dir nirmaan_stack/services/boq_parser/tests/fixtures \\
      --output-dir /workspace/Users/nites/OneDrive/Desktop/cycle_3_outputs_post_bug19_2026-05-27 \\
      [--projects safron_hvac_2026_04_11,alorica_pri_tech_hvac_1row_header]
"""

import argparse
import csv
import dataclasses
import json
import traceback
from enum import Enum
from pathlib import Path

from nirmaan_stack.services.boq_parser.orchestrator import parse_boq
from nirmaan_stack.services.boq_parser.config import (
    ColumnRole,
    GlobalSettings,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)

# ---------------------------------------------------------------------------
# Locked fixture set -- multi_area_merged_header_v1 DROPPED per v5.26a
# ---------------------------------------------------------------------------

PROJECT_TO_FIXTURE: dict[str, str] = {
    "sg_hvac": "RFQ_Societe Generale_Bangalore_HVAC_BOQ-26-02-2026 (1).xlsx",
    "safron_hvac_2026_04_11": "safron_hvac_2026-04-11.xlsx",
    "inovalon": "Inovalon HVAC Unpriced BOQ-21.01.2026.xlsx",
    "bill_of_quantities": "Bill of Quantities.xlsx",
    "alorica_pri_tech_hvac_2row_header": "alorica_pri_tech_hvac.xlsx",
    "alorica_pri_tech_hvac_1row_header": "alorica_pri_tech_hvac.xlsx",
    "snitch": "snitch_electrical.xlsx",
    "raheja_commerzone_hvac": "RAHEJA Commerzone  Chennai BOQ.xlsx",
}

# ---------------------------------------------------------------------------
# Config loader
# ---------------------------------------------------------------------------

def load_mapping_config(config_path: Path) -> MappingConfig:
    """Load MappingConfig from a *_sheetconfig.py file.

    File format:
        # Auto-generated from cycle 3 runner
        # Project: <name>

        MappingConfig(...)

    Strips leading # comment lines, then evals the MappingConfig expression
    with a controlled namespace containing all needed config classes.
    """
    text = config_path.read_text(encoding="utf-8")
    code_lines = [ln for ln in text.splitlines() if not ln.startswith("#") and ln.strip()]
    code = "\n".join(code_lines).strip()
    if not code:
        raise ValueError(f"No evaluable code found in {config_path}")
    ns = {
        "MappingConfig": MappingConfig,
        "MasterBoqMetadata": MasterBoqMetadata,
        "GlobalSettings": GlobalSettings,
        "SheetConfig": SheetConfig,
        "ColumnRole": ColumnRole,
    }
    result = eval(code, ns)  # noqa: S307
    if not isinstance(result, MappingConfig):
        raise TypeError(f"Expected MappingConfig, got {type(result)} from {config_path}")
    return result


# ---------------------------------------------------------------------------
# JSON serialization
# ---------------------------------------------------------------------------

class _EnumEncoder(json.JSONEncoder):
    """Serialize Enum values as their .value string."""
    def default(self, obj):
        if isinstance(obj, Enum):
            return obj.value
        return super().default(obj)


def _serialize_boq(boq) -> dict:
    """Convert ParsedBoq to a JSON-safe dict.

    ParsedBoq and ParsedSheet are Pydantic models; ResolvedRow and
    ClassifiedRow are dataclasses. Uses dataclasses.asdict() for the
    dataclass tree and for MultiAreaPattern.
    """
    sheets = []
    for sheet in boq.sheets:
        multi = None
        if sheet.multi_area_pattern is not None:
            multi = dataclasses.asdict(sheet.multi_area_pattern)  # MultiAreaPattern is a dataclass, not a Pydantic model
        rows = [dataclasses.asdict(rr) for rr in sheet.resolved_rows]
        sheets.append({
            "sheet_name": sheet.sheet_name,
            "multi_area_pattern": multi,
            "resolved_rows": rows,
        })
    return {
        "file_path": boq.file_path,
        "master_preamble": boq.master_preamble,
        "sheets": sheets,
    }


# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------

_CSV_PREFIX_COLS = [
    "sheet_name", "excel_row", "classification", "review_reason",
    "hierarchy_level", "parent_excel_row", "resolved_path",
]
_CSV_SUFFIX_COLS = [
    "sl_no_resolved", "description_resolved", "unit_resolved",
    "qty_resolved", "qty_total_resolved",
    "rate_supply_resolved", "rate_install_resolved", "rate_combined_resolved",
    "amount_supply_resolved", "amount_install_resolved", "amount_total_resolved",
    "row_notes_resolved",
    "qty_by_area", "amount_by_area", "rate_by_area",
    "append_notes_raw", "validation_warnings", "needs_review",
]


def _active_sheets(config: MappingConfig) -> list:
    return [s for s in config.sheets if not s.skip]


def _col_letters(sheet_config) -> list[str]:
    """Column letters from column_role_map, sorted by Excel column order."""
    cols = list(sheet_config.column_role_map.keys())
    cols.sort(key=lambda c: (len(c), c))
    return cols


def _role_label(col: str, role_obj) -> str:
    """Format a column role for the # COLUMN MAPPING block."""
    role = role_obj.role if hasattr(role_obj, "role") else str(role_obj)
    area = getattr(role_obj, "area", None)
    if area:
        return f"{role} (area={area})"
    return role


def _build_preamble(project: str, fixture_name: str, first_sheet) -> list[str]:
    """Build the # comment lines written before the CSV data header."""
    hr = first_sheet.header_row
    hrc = getattr(first_sheet, "header_row_count", 1) or 1
    areas = getattr(first_sheet, "area_dimensions", []) or []
    cols = _col_letters(first_sheet)

    lines = [
        "# CYCLE 3 PER-ROW CSV",
        f"# Project: {project}",
        f"# Fixture: {fixture_name}",
        f'# Sheet: "{first_sheet.sheet_name}"',
        f"# Header config: header_row={hr}, header_row_count={hrc}",
    ]
    if areas:
        lines.append(f"# Areas: {areas!r}")
    lines.append("# COLUMN MAPPING:")
    for col in cols:
        role_obj = first_sheet.column_role_map[col]
        lines.append(f"#   {col} = {_role_label(col, role_obj)}")
    lines.append("#")
    lines.append("# Per-row data follows. Use skiprows to skip preamble in pandas.")
    return lines


def _cell_val(rr, col: str) -> str:
    ci = rr.classified_row.raw_row.cells.get(col)
    if ci is None:
        return ""
    v = ci["value"] if isinstance(ci, dict) else ci.value
    return "" if v is None else str(v)


def _fmt(v) -> str:
    return "" if v is None else str(v)


def _fmt_dict(d: dict) -> str:
    return "" if not d else json.dumps(d, separators=(",", ":"))


def _fmt_list(lst: list) -> str:
    return "" if not lst else json.dumps(lst, separators=(",", ":"))


def _write_csv(
    output_path: Path,
    project: str,
    fixture_name: str,
    config: MappingConfig,
    boq,
) -> None:
    active = _active_sheets(config)
    if not active:
        return

    first = active[0]
    cols = _col_letters(first)
    preamble = _build_preamble(project, fixture_name, first)
    header = _CSV_PREFIX_COLS + [f"raw_{c}" for c in cols] + _CSV_SUFFIX_COLS

    # Build index: resolved_row list position -> excel row number, per sheet name
    # (needed for parent_excel_row lookup)
    sheet_row_index: dict[str, dict[int, int]] = {}
    for sheet in boq.sheets:
        sheet_row_index[sheet.sheet_name] = {
            i: rr.classified_row.raw_row.row_number
            for i, rr in enumerate(sheet.resolved_rows)
        }

    with output_path.open("w", encoding="utf-8", newline="") as fh:
        # Preamble: LF line endings (matching reference format)
        for line in preamble:
            fh.write(line + "\n")

        # CSV header + data: CRLF line endings via csv.writer
        writer = csv.writer(fh, lineterminator="\r\n")
        writer.writerow(header)

        for sheet in boq.sheets:
            cfg_sheet = next(
                (s for s in config.sheets if s.sheet_name == sheet.sheet_name),
                None,
            )
            if cfg_sheet is None or cfg_sheet.skip:
                continue

            row_map = sheet_row_index[sheet.sheet_name]

            for rr in sheet.resolved_rows:
                cr = rr.classified_row

                parent_excel = ""
                if rr.parent_index is not None:
                    parent_excel = str(row_map.get(rr.parent_index, ""))

                raw_vals = [_cell_val(rr, c) for c in cols]

                row = (
                    [
                        sheet.sheet_name,
                        str(cr.raw_row.row_number),
                        cr.classification.value,
                        _fmt(rr.review_reason),
                        _fmt(rr.level),
                        parent_excel,
                        _fmt(rr.path),
                    ]
                    + raw_vals
                    + [
                        _fmt(cr.sl_no_value),
                        _fmt(cr.description),
                        _fmt(cr.unit),
                        _fmt(cr.qty),
                        _fmt(cr.qty_total_raw),
                        _fmt(cr.rate_supply),
                        _fmt(cr.rate_install),
                        _fmt(cr.rate_combined),
                        _fmt(cr.amount_supply),
                        _fmt(cr.amount_install),
                        _fmt(cr.amount_total),
                        _fmt(cr.row_notes),
                        _fmt_dict(rr.qty_by_area),
                        _fmt_dict(rr.amount_by_area),
                        _fmt_dict(rr.rate_by_area),
                        _fmt_dict(cr.append_notes_raw),
                        _fmt_list(rr.validation_warnings),
                        "True" if rr.needs_classification_review else "",
                    ]
                )
                writer.writerow(row)


# ---------------------------------------------------------------------------
# Per-project runner
# ---------------------------------------------------------------------------

def _run_project(
    project: str,
    config: MappingConfig,
    fixture_path: Path,
    output_dir: Path,
) -> dict:
    fixture_name = fixture_path.name
    print(f"  Parsing {project}...", flush=True)

    boq = parse_boq(str(fixture_path), config)

    total_rows = sum(len(s.resolved_rows) for s in boq.sheets)
    classifications: dict[str, int] = {}
    for sheet in boq.sheets:
        for rr in sheet.resolved_rows:
            label = rr.classified_row.classification.value
            classifications[label] = classifications.get(label, 0) + 1

    json_path = output_dir / f"{project}_parsed.json"
    serialized = _serialize_boq(boq)
    json_path.write_text(
        json.dumps(serialized, indent=2, cls=_EnumEncoder, ensure_ascii=False),
        encoding="utf-8",
    )

    csv_path = output_dir / f"{project}_rows.csv"
    _write_csv(csv_path, project, fixture_name, config, boq)

    print(
        f"  Done {project}: {total_rows} rows -- "
        + ", ".join(f"{k}={v}" for k, v in sorted(classifications.items())),
        flush=True,
    )

    return {
        "project": project,
        "fixture": fixture_name,
        "status": "OK",
        "total_rows": total_rows,
        "classifications": classifications,
    }


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

def _run_self_test(configs_dir: Path, fixtures_dir: Path) -> None:
    project = "safron_hvac_2026_04_11"
    output_dir = Path("/tmp/cycle_3_test_output")
    output_dir.mkdir(parents=True, exist_ok=True)
    config_file = configs_dir / f"{project}_sheetconfig.py"
    fixture_path = fixtures_dir / PROJECT_TO_FIXTURE[project]
    config = load_mapping_config(config_file)
    result = _run_project(project, config, fixture_path, output_dir)
    print(f"\nSelf-test PASS: {result['total_rows']} rows, {result['classifications']}")
    print(f"Output: {output_dir}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv=None) -> None:
    parser = argparse.ArgumentParser(
        description="Cycle 3 post-Bug-19 BoQ parser validation runner.",
    )
    parser.add_argument("--configs-dir", required=True)
    parser.add_argument("--fixtures-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--projects", default="",
                        help="Comma-separated project names. Omit for all 8.")
    parser.add_argument("--self-test", action="store_true",
                        help="Smoke test on safron only; writes to /tmp/.")
    args = parser.parse_args(argv)

    if args.self_test:
        _run_self_test(Path(args.configs_dir), Path(args.fixtures_dir))
        return

    configs_dir = Path(args.configs_dir)
    fixtures_dir = Path(args.fixtures_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    project_filter: set[str] | None = None
    if args.projects.strip():
        project_filter = {p.strip() for p in args.projects.split(",")}

    project_order = [
        p for p in PROJECT_TO_FIXTURE
        if project_filter is None or p in project_filter
    ]

    summary: list[dict] = []

    for project in project_order:
        config_file = configs_dir / f"{project}_sheetconfig.py"
        fixture_name = PROJECT_TO_FIXTURE[project]
        fixture_path = fixtures_dir / fixture_name

        if not config_file.exists():
            print(f"  SKIP {project}: config not found ({config_file})", flush=True)
            summary.append({
                "project": project, "fixture": fixture_name, "status": "SKIP",
                "total_rows": 0, "classifications": {},
                "error": "config file not found",
            })
            continue

        if not fixture_path.exists():
            print(f"  SKIP {project}: fixture not found ({fixture_path})", flush=True)
            summary.append({
                "project": project, "fixture": fixture_name, "status": "SKIP",
                "total_rows": 0, "classifications": {},
                "error": "fixture file not found",
            })
            continue

        try:
            config = load_mapping_config(config_file)
            result = _run_project(project, config, fixture_path, output_dir)
            summary.append(result)
        except Exception as exc:
            print(f"  FAIL {project}: {type(exc).__name__}: {exc}", flush=True)
            traceback.print_exc()
            summary.append({
                "project": project, "fixture": fixture_name, "status": "FAIL",
                "total_rows": 0, "classifications": {},
                "error": f"{type(exc).__name__}: {exc}",
            })

    summary_path = output_dir / "_run_summary.json"
    summary_path.write_text(
        json.dumps(summary, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\nSummary written to {summary_path}", flush=True)


if __name__ == "__main__":
    main()
