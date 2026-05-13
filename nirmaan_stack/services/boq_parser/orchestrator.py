"""
BoQ parser orchestrator — top-level entry point for Phase 2b.2.

ParsedBoq and ParsedSheet are the return-shape Pydantic models.
parse_boq() wires all parser stages in the correct order:
  reader → classifier → populate_preamble_candidate_scores
  → resolve_hierarchy → detect_multi_area_pattern

Out of scope in B1 (deferred to B2):
  - Multi-area splitting post-pass
  - Sum validation against TOTAL QTY
  - Populating any validation_warnings
  - DB writes (Phase 2c)
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from nirmaan_stack.services.boq_parser.classifier import classify_row, populate_preamble_candidate_scores
from nirmaan_stack.services.boq_parser.config import MappingConfig
from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow, resolve_hierarchy
from nirmaan_stack.services.boq_parser.multi_area_detection import MultiAreaPattern, detect_multi_area_pattern
from nirmaan_stack.services.boq_parser.reader import BoqReader


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
# Orchestrator
# ------------------------------------------------------------------

def parse_boq(file_path: str, config: MappingConfig) -> ParsedBoq:
    """
    Parse a BoQ workbook using the given MappingConfig.

    Per-sheet pipeline:
      1. iter_rows() → RawRow list
      2. classify_row() per row → ClassifiedRow list
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

        raw_rows = [
            rr for rr in reader.iter_rows(sheet_name)
            if rr.row_number not in skip_rows
        ]

        # Step 2: Classify each row
        classified_rows = [
            classify_row(rr, sheet_config, global_settings)
            for rr in raw_rows
        ]

        # Step 3: Preamble candidate scoring post-pass (mutates in place)
        populate_preamble_candidate_scores(classified_rows, sheet_config)

        # Step 4: Hierarchy resolution
        resolved_sheet = resolve_hierarchy(classified_rows, sheet_config, global_settings)

        # Step 5: Multi-area pattern detection from header row(s)
        multi_area_pattern: MultiAreaPattern | None = None
        if header_row is not None:
            bottom_rows = list(reader.iter_rows(sheet_name, start_row=header_row, end_row=header_row))
            bottom_header_row = bottom_rows[0] if bottom_rows else None

            top_header_row = None
            if sheet_config.header_row_count == 2:
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
