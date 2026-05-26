"""
BoQ parser orchestrator — top-level entry point for Phase 2b.2.

ParsedBoq and ParsedSheet are the return-shape Pydantic models.
parse_boq() wires all parser stages in the correct order:
  reader → classifier → populate_preamble_candidate_scores
  → resolve_hierarchy → detect_multi_area_pattern

Out of scope in B2a (deferred to later phases):
  - DB writes (Phase 2c)
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from nirmaan_stack.services.boq_parser.classifier import (
    RowClassification,
    _apply_unit_based_demotion_post_pass,
    classify_row,
    populate_preamble_candidate_scores,
)
from nirmaan_stack.services.boq_parser.config import MappingConfig
from nirmaan_stack.services.boq_parser.hierarchy import (
    ResolvedRow,
    _apply_priced_preamble_with_children_review_flag_post_pass,
    _apply_zero_children_preamble_demotion_post_pass,
    resolve_hierarchy,
)
from nirmaan_stack.services.boq_parser.multi_area_detection import MultiAreaPattern, detect_multi_area_pattern
from nirmaan_stack.services.boq_parser.reader import BoqReader

# Column roles whose values are text visible to the user — numeric cell values
# in these columns should be formatted as the author saw them on screen (Bug 17).
TEXT_ROLE_ROLES: frozenset[str] = frozenset({
    "sl_no", "description", "unit", "make_model", "append_to_notes"
})


# ------------------------------------------------------------------
# Return-shape models
# ------------------------------------------------------------------

class ParsedSheet(BaseModel):
    sheet_name: str
    multi_area_pattern: MultiAreaPattern | None = None
    resolved_rows: list[Any] = []  # list[ResolvedRow] — Any avoids dataclass serialization issues
    validation_warnings: list[str] = []

    class Config:
        arbitrary_types_allowed = True


class ParsedBoq(BaseModel):
    file_path: str
    master_preamble: str | None = None
    sheets: list[ParsedSheet] = []
    validation_warnings: list[str] = []

    class Config:
        arbitrary_types_allowed = True


# ------------------------------------------------------------------
# Multi-area post-pass
# ------------------------------------------------------------------

def _apply_multi_area_post_pass(resolved_rows: list[ResolvedRow]) -> None:
    """
    Mutate LINE_ITEM ResolvedRows in place to populate resolved per-area dicts,
    apply empty-total fallback (§7.24 amendment), and append sum-validation
    warnings (§7.24).

    Policy X (§7.25): zeros are preserved in per-area dicts — a key with 0.0
    means "explicitly zero in this area", distinct from a missing key.

    Empty-total fallback: when qty_total or amount_total is None and the
    corresponding per-area dict is populated, compute the total from the
    per-area sum. No warning is emitted for the fallback case.

    Sum validation: soft warning at ±1 absolute tolerance, appended to
    ResolvedRow.validation_warnings.
    """
    for row in resolved_rows:
        if row.classified_row.classification != RowClassification.LINE_ITEM:
            continue

        # Policy X: straight copy, zeros preserved
        row.qty_by_area = dict(row.qty_by_area_raw)
        row.amount_by_area = dict(row.amount_by_area_raw)

        # Per-area rates (Phase 1.9a) — read from ClassifiedRow.rate_by_area_raw
        rate_by_area_raw = row.classified_row.rate_by_area_raw
        if rate_by_area_raw:
            row.rate_by_area = {area: dict(rates) for area, rates in rate_by_area_raw.items()}

            # Compute per-area amounts for areas that have a rate but no direct amount.
            # Priority: combined_rate → supply_rate → install_rate.
            for area, rates in row.rate_by_area.items():
                if area not in row.amount_by_area:
                    area_qty = row.qty_by_area.get(area)
                    area_rate = rates.get("combined_rate")
                    if area_rate is None:
                        area_rate = rates.get("supply_rate")
                    if area_rate is None:
                        area_rate = rates.get("install_rate")
                    if area_qty is not None and area_rate is not None:
                        row.amount_by_area[area] = area_qty * area_rate

            # Soft validation: combined_rate should equal supply_rate + install_rate.
            for area, rates in row.rate_by_area.items():
                supply = rates.get("supply_rate")
                install = rates.get("install_rate")
                combined = rates.get("combined_rate")
                if supply is not None and install is not None and combined is not None:
                    expected = supply + install
                    if abs(combined - expected) > 0.01:
                        row.validation_warnings.append(
                            f"area '{area}': combined_rate {combined:.4g} != "
                            f"supply_rate {supply:.4g} + install_rate {install:.4g} "
                            f"({expected:.4g})"
                        )

        # Empty-total fallback (no warning)
        if row.qty_total is None and row.qty_by_area:
            row.qty_total = sum(row.qty_by_area.values())
        if row.amount_total is None and row.amount_by_area:
            row.amount_total = sum(row.amount_by_area.values())

        # Sum validation — qty
        if row.qty_by_area and row.qty_total is not None:
            per_area_sum = sum(row.qty_by_area.values())
            if abs(per_area_sum - row.qty_total) > 1.0:
                row.validation_warnings.append(
                    f"qty per-area sum {per_area_sum:.2f} differs from "
                    f"qty_total {row.qty_total:.2f} (outside ±1 tolerance)"
                )

        # Sum validation — amount
        if row.amount_by_area and row.amount_total is not None:
            per_area_sum = sum(row.amount_by_area.values())
            if abs(per_area_sum - row.amount_total) > 1.0:
                row.validation_warnings.append(
                    f"amount per-area sum {per_area_sum:.2f} differs from "
                    f"amount_total {row.amount_total:.2f} (outside ±1 tolerance)"
                )


# ------------------------------------------------------------------
# Orchestrator
# ------------------------------------------------------------------

def parse_boq(file_path: str, config: MappingConfig) -> ParsedBoq:
    """
    Parse a BoQ workbook using the given MappingConfig.

    Per-sheet pipeline:
      1. iter_rows() → RawRow list
      2. classify_row() per row → ClassifiedRow list
      2b. _apply_unit_based_demotion_post_pass() (mutates in place)
      3. populate_preamble_candidate_scores() post-pass (mutates in place)
      4. resolve_hierarchy() → ResolvedSheet
      5. detect_multi_area_pattern() on header row(s)
      6. Assemble ParsedSheet

    Master preamble text is extracted from sheets with treat_as="master_preamble".
    """
    reader = BoqReader(file_path)
    global_settings = config.global_settings

    master_preamble: str | None = None
    parsed_sheets: list[ParsedSheet] = []

    for sheet_config in config.sheets:
        # Master preamble sheet — extract text, do not parse as data
        if sheet_config.treat_as == "master_preamble":
            master_preamble = reader.get_master_preamble_text(sheet_config.sheet_name)
            continue

        # Skipped sheet — exclude from output
        if sheet_config.skip:
            continue

        sheet_name = sheet_config.sheet_name
        header_row = sheet_config.header_row  # always set for non-skipped data sheets

        # Step 1: Collect rows (skip header row(s) and any declared skip rows)
        skip_rows: set[int] = set()
        if header_row is not None:
            skip_rows.add(header_row)
            if sheet_config.header_row_count == 2:
                skip_rows.add(header_row + 1)
        skip_rows.update(sheet_config.skip_top_rows_after_header)

        # Bug 17: derive text-role column letters for display-string formatting
        text_role_columns: set[str] | None = None
        if sheet_config.column_role_map:
            cols = {
                col for col, cr in sheet_config.column_role_map.items()
                if cr.role in TEXT_ROLE_ROLES
            }
            if cols:
                text_role_columns = cols

        raw_rows = [
            rr for rr in reader.iter_rows(sheet_name, text_role_columns=text_role_columns)
            if rr.row_number not in skip_rows
            and (header_row is None or rr.row_number >= header_row)
        ]

        # Step 2: Classify each row
        classified_rows = [
            classify_row(rr, sheet_config, global_settings)
            for rr in raw_rows
        ]

        # Step 2b: Unit-based PREAMBLE demotion post-pass (must precede scoring)
        _apply_unit_based_demotion_post_pass(classified_rows)

        # Step 3: Preamble candidate scoring post-pass (mutates in place)
        populate_preamble_candidate_scores(classified_rows, sheet_config)

        # Step 4: Hierarchy resolution
        resolved_sheet = resolve_hierarchy(classified_rows, sheet_config, global_settings)

        # Step 4a: Zero-children PREAMBLE demotion post-pass (needs tree data, before multi-area)
        _apply_zero_children_preamble_demotion_post_pass(resolved_sheet.rows)

        # Step 4a.5: Priced-PREAMBLE-with-children review-flag post-pass (§9 #45)
        _apply_priced_preamble_with_children_review_flag_post_pass(resolved_sheet.rows)

        # Step 4b: Multi-area post-pass — Policy X copy + sum validation + fallback
        _apply_multi_area_post_pass(resolved_sheet.rows)

        # Step 5: Multi-area pattern detection from header row(s)
        multi_area_pattern: MultiAreaPattern | None = None
        if header_row is not None:
            bottom_rows = list(reader.iter_rows(sheet_name, start_row=header_row, end_row=header_row))
            bottom_header_row = bottom_rows[0] if bottom_rows else None

            top_header_row = None
            if sheet_config.header_row_count == 2:
                # F5-b (§9 #63): use sheet_config override when set, else fall back to header_row - 1.
                # Phase 1.9d single-element list only; multi-element Pattern 6 case deferred.
                if sheet_config.top_header_rows_override:
                    top_row_idx = sheet_config.top_header_rows_override[0]
                    top_rows = list(reader.iter_rows(sheet_name, start_row=top_row_idx, end_row=top_row_idx))
                else:
                    top_rows = list(reader.iter_rows(sheet_name, start_row=header_row - 1, end_row=header_row - 1))
                top_header_row = top_rows[0] if top_rows else None

            if bottom_header_row is not None:
                multi_area_pattern = detect_multi_area_pattern(
                    bottom_header_row=bottom_header_row,
                    reserved_keywords=global_settings.multi_area_reserved_keywords,
                    top_header_row=top_header_row,
                )

        # Step 6: Assemble ParsedSheet
        parsed_sheets.append(ParsedSheet(
            sheet_name=sheet_name,
            multi_area_pattern=multi_area_pattern,
            resolved_rows=resolved_sheet.rows,
            validation_warnings=[],
        ))

    return ParsedBoq(
        file_path=file_path,
        master_preamble=master_preamble,
        sheets=parsed_sheets,
        validation_warnings=[],
    )
