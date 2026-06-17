"""
§7.28 orphan-children audit — Snitch '6. Electrical'.

READ-ONLY diagnostic. No parser source files are modified.

Question answered: when §7.28 (_apply_unit_based_demotion_post_pass in
classifier.py) demotes PREAMBLE rows on Snitch '6. Electrical', how many
of those demoted rows had descendants in the resolved tree that would have
been orphaned (i.e. descendants NOT themselves in the §7.28 target set)?

Pipeline replicated (in order):
  1. reader.iter_rows() → RawRow list
  2. classify_row() per row → ClassifiedRow list
  [§7.28 SKIPPED — _apply_unit_based_demotion_post_pass NOT called]
  3. resolve_hierarchy() → ResolvedSheet
  [§7.29 / §7.30 / multi-area post-passes also skipped]

Phase 0 divergences from prompt assumptions (documented, not improvised):
  - resolve_hierarchy() takes 3 args: (classified_rows, sheet_config,
    global_settings). Prompt stated 2 args. Actual signature verified in
    hierarchy.py:355-359.
  - No "sheet config derivation function" in orchestrator.py. Config is
    provided via MappingConfig; replicated inline from test_orchestrator
    (same approach as preamble_with_children_audit.py).

Follows preamble_with_children_audit.py precedent (feat 1ad12a7b).
Script: nirmaan_stack/services/boq_parser/unit_demotion_orphan_audit.py
Generated: 2026-05-23
"""
from __future__ import annotations

import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).parent
_APP_ROOT = _SCRIPT_DIR.parent.parent.parent  # .../apps/nirmaan_stack/ — makes nirmaan_stack importable
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from nirmaan_stack.services.boq_parser.classifier import RowClassification, classify_row
from nirmaan_stack.services.boq_parser.config import (
    ColumnRole,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow, resolve_hierarchy
from nirmaan_stack.services.boq_parser.reader import BoqReader

# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------

FIXTURES_DIR = _SCRIPT_DIR / "tests" / "fixtures"
FIXTURE_FILE = "snitch_electrical.xlsx"
SHEET_NAME = "6. Electrical"


# ------------------------------------------------------------------
# Config — replicated from test_orchestrator._snitch_config()
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


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _trunc(s: str | None, n: int = 60) -> str:
    if not s:
        return ""
    return s if len(s) <= n else s[:n] + "..."


def _all_descendants(tri_path: str, resolved_rows: list[ResolvedRow]) -> list[int]:
    """Return resolved indices of every descendant of the row whose path is tri_path."""
    prefix = tri_path + "/"
    return [
        i for i, rr in enumerate(resolved_rows)
        if rr.path is not None and rr.path.startswith(prefix)
    ]


# ------------------------------------------------------------------
# Main audit logic
# ------------------------------------------------------------------

def run_audit() -> None:
    fixture_path = str(FIXTURES_DIR / FIXTURE_FILE)
    mapping_config = _snitch_config()

    sheet_config = next(
        sc for sc in mapping_config.sheets if sc.sheet_name == SHEET_NAME
    )
    global_settings = mapping_config.global_settings
    header_row = sheet_config.header_row  # 1

    # Step 1: Collect rows — identical skip logic to orchestrator.parse_boq()
    reader = BoqReader(fixture_path)
    skip_rows: set[int] = set()
    if header_row is not None:
        skip_rows.add(header_row)
        if sheet_config.header_row_count == 2:
            skip_rows.add(header_row + 1)
    skip_rows.update(sheet_config.skip_top_rows_after_header)

    raw_rows = [
        rr for rr in reader.iter_rows(SHEET_NAME)
        if rr.row_number not in skip_rows
        and (header_row is None or rr.row_number >= header_row)
    ]

    # Step 2: Classify rows
    classified_rows = [
        classify_row(rr, sheet_config, global_settings)
        for rr in raw_rows
    ]
    # §7.28 intentionally SKIPPED:
    #   _apply_unit_based_demotion_post_pass(classified_rows)  ← NOT called
    # populate_preamble_candidate_scores() also skipped (not relevant to this question).

    # Step 3: Resolve hierarchy
    # NOTE: actual signature is 3-arg, not 2-arg as prompt assumed.
    resolved_sheet = resolve_hierarchy(classified_rows, sheet_config, global_settings)
    resolved_rows = resolved_sheet.rows
    # §7.29, §7.30, and multi-area post-passes intentionally SKIPPED.

    # ------------------------------------------------------------------
    # Target set: PREAMBLE rows §7.28 WOULD demote
    # ------------------------------------------------------------------
    line_item_units: set[str] = {
        cr.unit
        for cr in classified_rows
        if cr.classification == RowClassification.LINE_ITEM
        and cr.unit is not None
    }

    target_classified_indices: set[int] = {
        i
        for i, cr in enumerate(classified_rows)
        if (
            cr.classification == RowClassification.PREAMBLE
            and cr.qty is None
            and cr.unit is not None
            and cr.unit in line_item_units
        )
    }

    target_size = len(target_classified_indices)

    # ------------------------------------------------------------------
    # Map classified indices → resolved indices via object identity
    # ------------------------------------------------------------------
    cr_id_to_classified_idx: dict[int, int] = {
        id(cr): i for i, cr in enumerate(classified_rows)
    }
    classified_to_resolved: dict[int, int] = {}
    for res_idx, rr in enumerate(resolved_rows):
        ci = cr_id_to_classified_idx.get(id(rr.classified_row))
        if ci is not None:
            classified_to_resolved[ci] = res_idx

    target_resolved_indices: set[int] = {
        classified_to_resolved[ci]
        for ci in target_classified_indices
        if ci in classified_to_resolved
    }

    missing_from_resolved = len(target_classified_indices) - len(target_resolved_indices)

    # ------------------------------------------------------------------
    # Per-target descendant walk
    # ------------------------------------------------------------------
    records: list[dict] = []
    all_bucket_b_pairs: list[tuple[int, int]] = []  # (parent_tri, child_res_idx)

    for tri in sorted(target_resolved_indices):
        rr = resolved_rows[tri]
        cr = rr.classified_row
        tri_path = rr.path
        if tri_path is None:
            continue  # defensive; PREAMBLE rows always have a path

        desc_all = _all_descendants(tri_path, resolved_rows)
        bucket_a = [di for di in desc_all if di in target_resolved_indices]
        bucket_b = [di for di in desc_all if di not in target_resolved_indices]

        for di in bucket_b:
            all_bucket_b_pairs.append((tri, di))

        records.append({
            "resolved_idx": tri,
            "xlsx_row": cr.raw_row.row_number,
            "sl_no": cr.sl_no_value or "",
            "desc": _trunc(cr.description, 60),
            "total_desc": len(desc_all),
            "bucket_a": len(bucket_a),
            "bucket_b": len(bucket_b),
        })

    # Sort: bucket_b descending, then total_desc descending
    records.sort(key=lambda r: (-r["bucket_b"], -r["total_desc"]))

    # ------------------------------------------------------------------
    # Bucket B distribution
    # ------------------------------------------------------------------
    dist: dict[str, int] = {"0": 0, "1": 0, "2": 0, "3-5": 0, "6-10": 0, "11+": 0}
    for rec in records:
        b = rec["bucket_b"]
        if b == 0:
            dist["0"] += 1
        elif b == 1:
            dist["1"] += 1
        elif b == 2:
            dist["2"] += 1
        elif 3 <= b <= 5:
            dist["3-5"] += 1
        elif 6 <= b <= 10:
            dist["6-10"] += 1
        else:
            dist["11+"] += 1

    # ------------------------------------------------------------------
    # Aggregate
    # ------------------------------------------------------------------
    total_target = len(records)
    zero_orphan = sum(1 for r in records if r["bucket_b"] == 0)
    nonzero_orphan = total_target - zero_orphan
    sum_orphan = sum(r["bucket_b"] for r in records)
    max_orphan = max((r["bucket_b"] for r in records), default=0)
    pct_zero = 100.0 * zero_orphan / total_target if total_target else 0.0
    pct_nonzero = 100.0 * nonzero_orphan / total_target if total_target else 0.0

    # ------------------------------------------------------------------
    # Print output
    # ------------------------------------------------------------------
    print("=== §7.28 Orphan-Children Audit — Snitch '6. Electrical' ===")
    print(f"Fixture: tests/fixtures/{FIXTURE_FILE}")
    print(f"Sheet: {SHEET_NAME}")
    print("Pipeline: classify_row → (skip §7.28) → resolve_hierarchy → (skip §7.29/§7.30/multi-area)")
    print()

    drift_note = ""
    if target_size != 82:
        drift_note = f"  *** DRIFT WARNING: expected 82, got {target_size} ***"
    print(f"Target set size: {target_size}  (expected 82 per handover doc; deviation = drift warning){drift_note}")
    if missing_from_resolved:
        print(f"WARNING: {missing_from_resolved} target classified rows not found in resolved_rows")
    print()

    # Per-target breakdown
    print("--- Per-target breakdown ---")
    print(
        f"{'resolved_idx':<13} | {'xlsx_row':<10} | {'sl_no':<13} | "
        f"{'total_desc':<12} | {'bucket_a (in-target)':<22} | "
        f"{'bucket_b (real-orphan)':<24} | desc(first 60 chars)"
    )
    for rec in records:
        print(
            f"{rec['resolved_idx']:<13} | {rec['xlsx_row']:<10} | {rec['sl_no']:<13} | "
            f"{rec['total_desc']:<12} | {rec['bucket_a']:<22} | "
            f"{rec['bucket_b']:<24} | {rec['desc']}"
        )

    print()
    print('--- Bucket B distribution (the "real orphan" signal) ---')
    print(f"{'real_orphan_count':<20} | num_target_rows")
    for k in ["0", "1", "2", "3-5", "6-10", "11+"]:
        print(f"{k:<20} | {dist[k]}")

    print()
    print("--- Aggregate ---")
    print(f"Total target rows:                {total_target}")
    print(f"Target rows with zero real orphans:    {zero_orphan}  ({pct_zero:.1f}%)")
    print(f"Target rows with >=1 real orphan:      {nonzero_orphan}  ({pct_nonzero:.1f}%)")
    print(f"Sum of real-orphan descendants:        {sum_orphan}")
    print(f"Max real-orphan count on a single row: {max_orphan}")

    print()
    print("--- Bucket B sample (first 10 real-orphan descendants if any) ---")
    print(
        f"{'parent_resolved_idx':<21} | {'child_resolved_idx':<20} | "
        f"{'child_classification':<22} | {'child_sl_no':<14} | child_desc(first 60)"
    )
    for tri, di in all_bucket_b_pairs[:10]:
        child_rr = resolved_rows[di]
        child_cr = child_rr.classified_row
        print(
            f"{tri:<21} | {di:<20} | "
            f"{child_cr.classification.value:<22} | {(child_cr.sl_no_value or ''):<14} | "
            f"{_trunc(child_cr.description, 60)}"
        )


def main() -> None:
    run_audit()


if __name__ == "__main__":
    main()
