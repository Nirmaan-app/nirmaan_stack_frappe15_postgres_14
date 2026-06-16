"""
Phase 2c §9 #45 observability audit: priced PREAMBLE rows with tree children.

Finds PREAMBLE rows that (1) are ancestor nodes in the resolved tree AND (2) carry
a price signal (alphanumeric unit string, or any rate field > 0). These rows are
the fix surface for the §9 #45 implementation sub-phase.

Scope: snitch_electrical.xlsx (committed real fixture) + synthetic_simple.xlsx
(committed synthetic). Real BoQ fixtures excluded — no committed MappingConfigs
available. Configs replicated inline from test_orchestrator to keep this script
self-contained (test_orchestrator pulls in generate_synthetic at module level,
making the import chain non-trivial for a standalone audit tool).

References: §9 #45 (handover doc / decisions log), Phase 2c audit sub-phase.
Script: nirmaan_stack/services/boq_parser/preamble_with_children_audit.py
Generated: 2026-05-16
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).parent
_APP_ROOT = _SCRIPT_DIR.parent.parent.parent  # .../apps/nirmaan_stack/ — makes nirmaan_stack importable
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from nirmaan_stack.services.boq_parser.classifier import RowClassification
from nirmaan_stack.services.boq_parser.config import (
    ColumnRole,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow
from nirmaan_stack.services.boq_parser.orchestrator import parse_boq

FIXTURES_DIR = _SCRIPT_DIR / "tests" / "fixtures"
ALPHANUMERIC_RE = re.compile(r"[A-Za-z0-9]")


# ------------------------------------------------------------------
# MappingConfig definitions — replicated from test_orchestrator.py
# Source functions: test_orchestrator._snitch_config() and _simple_config()
# ------------------------------------------------------------------

def _snitch_config() -> MappingConfig:
    _elec_cols = {
        "A": ColumnRole(role="sl_no"),
        "B": ColumnRole(role="description"),
        "C": ColumnRole(role="unit"),
        "D": ColumnRole(role="qty"),
        "E": ColumnRole(role="rate_supply"),
        "F": ColumnRole(role="rate_install"),
        "G": ColumnRole(role="rate_combined"),
        "I": ColumnRole(role="amount_total"),
    }
    return MappingConfig(
        project="snitch",
        master_boq=MasterBoqMetadata(boq_name="Snitch Electrical"),
        sheets=[
            SheetConfig(sheet_name="OVERALL SUMMARY", skip=True, column_role_map={}),
            SheetConfig(sheet_name="SUMMARY MEP", skip=True, column_role_map={}),
            SheetConfig(sheet_name="6. Electrical", header_row=1, column_role_map=_elec_cols),
            SheetConfig(sheet_name="7. Light Fixtures", header_row=2, column_role_map=_elec_cols),
            SheetConfig(sheet_name="MAKE LIST (to be updated)", skip=True, column_role_map={}),
        ],
    )


def _simple_config() -> MappingConfig:
    return MappingConfig(
        project="test",
        master_boq=MasterBoqMetadata(boq_name="test_boq"),
        sheets=[SheetConfig(
            sheet_name="Sheet1",
            header_row=1,
            column_role_map={
                "A": ColumnRole(role="sl_no"),
                "B": ColumnRole(role="description"),
                "C": ColumnRole(role="unit"),
                "D": ColumnRole(role="qty"),
                "E": ColumnRole(role="rate_supply"),
                "F": ColumnRole(role="amount_supply"),
            },
        )],
    )


FIXTURE_CONFIGS: list[dict] = [
    {
        "fixture_filename": "snitch_electrical.xlsx",
        "mapping_config": _snitch_config(),
        "source_note": "config replicated from test_orchestrator._snitch_config()",
    },
    {
        "fixture_filename": "synthetic_simple.xlsx",
        "mapping_config": _simple_config(),
        "source_note": "config replicated from test_orchestrator._simple_config()",
    },
]


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def is_priced(
    unit: str | None,
    rate_combined: float | None,
    rate_supply: float | None,
    rate_install: float | None,
) -> bool:
    if unit is not None and ALPHANUMERIC_RE.search(unit.strip()):
        return True
    if rate_combined is not None and rate_combined > 0:
        return True
    if rate_supply is not None and rate_supply > 0:
        return True
    if rate_install is not None and rate_install > 0:
        return True
    return False


def classify_children_shape(children: list[ResolvedRow]) -> str:
    if not children:
        return "no-children"
    priced_count = sum(
        1 for r in children
        if is_priced(
            r.classified_row.unit,
            r.classified_row.rate_combined,
            r.classified_row.rate_supply,
            r.classified_row.rate_install,
        )
    )
    if priced_count == len(children):
        return "siblings"
    if priced_count == 0:
        return "sub-bullets"
    return "mixed"


def truncate(s: str | None, limit: int = 200) -> str:
    if s is None:
        return ""
    return s if len(s) <= limit else s[:limit] + "..."


def direct_children(candidate: ResolvedRow, all_rows: list[ResolvedRow]) -> list[ResolvedRow]:
    if candidate.path is None:
        return []
    prefix = candidate.path + "/"
    return [
        r for r in all_rows
        if r.path is not None
        and r.path.startswith(prefix)
        and "/" not in r.path[len(prefix):]
    ]


def _child_record(row: ResolvedRow) -> dict:
    cr = row.classified_row
    rec: dict = {"sl_no": cr.sl_no_value or "", "description": truncate(cr.description)}
    if cr.unit:
        rec["unit"] = cr.unit
    if cr.rate_combined is not None and cr.rate_combined > 0:
        rec["rate_combined"] = cr.rate_combined
    if cr.rate_supply is not None and cr.rate_supply > 0:
        rec["rate_supply"] = cr.rate_supply
    if cr.rate_install is not None and cr.rate_install > 0:
        rec["rate_install"] = cr.rate_install
    return rec


# ------------------------------------------------------------------
# Per-fixture audit
# ------------------------------------------------------------------

def audit_fixture(fixture_path: str, mapping_config: MappingConfig) -> dict:
    result = parse_boq(fixture_path, mapping_config)
    sheets_scanned = 0
    candidates = []

    for sheet in result.sheets:
        sheets_scanned += 1

        # Ancestor-path set mirrors _apply_zero_children_preamble_demotion_post_pass
        paths_with_descendants: set[str] = set()
        for row in sheet.resolved_rows:
            if not row.path:
                continue
            segments = row.path.split("/")
            for i in range(1, len(segments)):
                paths_with_descendants.add("/".join(segments[:i]))

        for resolved_idx, row in enumerate(sheet.resolved_rows):
            cr = row.classified_row
            if cr.classification != RowClassification.PREAMBLE:
                continue
            if row.path not in paths_with_descendants:
                continue
            if not is_priced(cr.unit, cr.rate_combined, cr.rate_supply, cr.rate_install):
                continue

            children = direct_children(row, sheet.resolved_rows)
            shape = classify_children_shape(children)

            rec: dict = {
                "fixture": Path(fixture_path).name,
                "sheet_name": sheet.sheet_name,
                "resolved_idx": resolved_idx,
                "xlsx_row": cr.raw_row.row_number,
                "sl_no": cr.sl_no_value or "",
                "path": row.path or "",
                "description": truncate(cr.description),
            }
            if cr.unit:
                rec["unit"] = cr.unit
            if cr.rate_combined is not None and cr.rate_combined > 0:
                rec["rate_combined"] = cr.rate_combined
            if cr.rate_supply is not None and cr.rate_supply > 0:
                rec["rate_supply"] = cr.rate_supply
            if cr.rate_install is not None and cr.rate_install > 0:
                rec["rate_install"] = cr.rate_install
            rec["child_count"] = len(children)
            rec["children_shape"] = shape
            rec["children"] = [_child_record(c) for c in children]
            candidates.append(rec)

    return {"sheets_scanned": sheets_scanned, "candidates": candidates}


# ------------------------------------------------------------------
# Entry point
# ------------------------------------------------------------------

def main() -> None:
    output_path = _SCRIPT_DIR / "preamble_with_children_audit_output.json"

    all_candidates: list[dict] = []
    fixture_failures: list[dict] = []
    fixtures_succeeded = 0
    total_sheets_scanned = 0

    for entry in FIXTURE_CONFIGS:
        fname = entry["fixture_filename"]
        try:
            res = audit_fixture(str(FIXTURES_DIR / fname), entry["mapping_config"])
            fixtures_succeeded += 1
            total_sheets_scanned += res["sheets_scanned"]
            all_candidates.extend(res["candidates"])
        except Exception as exc:
            fixture_failures.append({
                "fixture": fname,
                "error_type": type(exc).__name__,
                "error_message": str(exc),
            })

    candidates_by_fixture: dict[str, int] = {}
    candidates_by_shape: dict[str, int] = {}
    for c in all_candidates:
        candidates_by_fixture[c["fixture"]] = candidates_by_fixture.get(c["fixture"], 0) + 1
        candidates_by_shape[c["children_shape"]] = candidates_by_shape.get(c["children_shape"], 0) + 1

    summary = {
        "total_fixtures_attempted": len(FIXTURE_CONFIGS),
        "fixtures_succeeded": fixtures_succeeded,
        "fixtures_failed_count": len(fixture_failures),
        "total_sheets_scanned": total_sheets_scanned,
        "total_candidates": len(all_candidates),
        "candidates_by_fixture": candidates_by_fixture,
        "candidates_by_shape": candidates_by_shape,
    }

    payload = {
        "summary": summary,
        "fixture_failures": fixture_failures,
        "candidates": all_candidates,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(payload, indent=2, default=str))

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
