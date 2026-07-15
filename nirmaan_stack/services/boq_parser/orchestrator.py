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
    _apply_priced_preamble_promotion,
    _apply_section_header_note_promotion_post_pass,
    _apply_unit_based_demotion_post_pass,
    _sum_area_amounts,
    classify_row,
    populate_preamble_candidate_scores,
)
from nirmaan_stack.services.boq_parser.config import MappingConfig, SheetConfig
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

    class Config:
        arbitrary_types_allowed = True


class ParsedBoq(BaseModel):
    file_path: str
    master_preambles: dict[str, str] = {}
    sheets: list[ParsedSheet] = []

    class Config:
        arbitrary_types_allowed = True


# ------------------------------------------------------------------
# Multi-area post-pass
# ------------------------------------------------------------------

def _apply_multi_area_post_pass(resolved_rows: list[ResolvedRow]) -> None:
    """
    Mutate LINE_ITEM ResolvedRows in place to populate resolved per-area dicts
    and apply empty-total fallback (§7.24 amendment).

    Policy X (§7.25): zeros are preserved in per-area dicts — a key with 0.0
    means "explicitly zero in this area", distinct from a missing key.

    Empty-total fallback: when qty_total or amount_total is None and the
    corresponding per-area dict is populated, compute the total from the
    per-area sum.
    """
    # No-attribute-loss (Option B): PREAMBLE, NOTE and SUBTOTAL_MARKER rows are
    # processed identically to LINE_ITEM so a row that carries source quantities/amounts
    # gets its per-area output dicts + empty-total fallback populated rather than dropped.
    # Genuine section headers / text notes / label subtotals have empty per-area raw
    # dicts, so every operation below is a no-op for them; only rows that actually carry
    # cells are affected. SPACER / HEADER_REPEAT stay skipped (a blank / repeated-header
    # row has no cells to carry). None of these become priceable nodes (note / subtotal /
    # header_repeat are grid-only at commit), so rollups are unaffected — this only
    # enriches the review row.
    for row in resolved_rows:
        if row.classified_row.classification not in (
            RowClassification.LINE_ITEM,
            RowClassification.PREAMBLE,
            RowClassification.NOTE,
            RowClassification.SUBTOTAL_MARKER,
        ):
            continue

        # Policy X: straight copy, zeros preserved
        row.qty_by_area = dict(row.qty_by_area_raw)
        # amount_by_area is NESTED dict[area][kind] (field-set Slice 2a) — deep-copy the
        # inner kind dicts, mirroring the rate_by_area copy below.
        row.amount_by_area = {area: dict(kinds) for area, kinds in row.amount_by_area_raw.items()}

        # Per-area rates (Phase 1.9a) — read from ClassifiedRow.rate_by_area_raw
        rate_by_area_raw = row.classified_row.rate_by_area_raw
        if rate_by_area_raw:
            row.rate_by_area = {area: dict(rates) for area, rates in rate_by_area_raw.items()}

            # Compute per-area amounts for areas that have a rate but no direct amount.
            # Priority: combined_rate → supply_rate → install_rate. The computed value is
            # the area's combined/total amount, so it lands in the nested "total" kind
            # (field-set Slice 2a); only fired for areas with no amount column at all.
            for area, rates in row.rate_by_area.items():
                if area not in row.amount_by_area:
                    area_qty = row.qty_by_area.get(area)
                    area_rate = rates.get("combined_rate")
                    if area_rate is None:
                        area_rate = rates.get("supply_rate")
                    if area_rate is None:
                        area_rate = rates.get("install_rate")
                    if area_qty is not None and area_rate is not None:
                        row.amount_by_area[area] = {"total": area_qty * area_rate}

        # Empty-total fallback (no warning). amount_total derivation rule (field-set
        # Slice 2a): explicit total column already won upstream (cr.amount_total); only
        # when it is None do we derive = sum over areas of (per-area total, else
        # supply + install) via _sum_area_amounts.
        if row.qty_total is None and row.qty_by_area:
            row.qty_total = sum(row.qty_by_area.values())
        if row.amount_total is None and row.amount_by_area:
            row.amount_total = _sum_area_amounts(row.amount_by_area)


# ------------------------------------------------------------------
# Header-label capture (MC-3b)
# ------------------------------------------------------------------

def _enrich_column_headers(reader: "BoqReader", sheet_config: SheetConfig) -> None:
    """Fill sheet_config.column_headers from the header_row cell text (MC-3b).

    SheetConfig.column_headers has no production writer, so header-label lookups
    (description_parts_raw triples, append_notes_raw keys) fall back to the bare
    column letter. Here, at parse time, we read the authoritative header_row and
    capture each mapped column's header text.

    Rules:
      - STORED WINS: a column whose column_headers entry is already non-empty is
        left untouched (user/future-UI authored labels are never overwritten).
      - BLANK -> ABSENT: a blank/whitespace header cell leaves the column absent
        from column_headers (the .get(col, col) letter fallback stays); never
        store an empty string.
      - TWO-ROW HEADERS: header_row is the single declared header row -- the
        bottom sub-header row (the second tier sits ABOVE it, excluded from data);
        so its cells are the real per-column labels.

    IN-MEMORY ONLY: mutates the parser-input SheetConfig (built by
    assemble_mapping_config from the stored blob). The stored
    BoQ Sheet Draft.sheet_config is never written back -- the captured labels
    reach downstream (MC-4/5) via the persisted description_parts_raw triples.
    """
    header_row = sheet_config.header_row
    if header_row is None or not sheet_config.column_role_map:
        return
    hr = next(
        reader.iter_rows(sheet_config.sheet_name, start_row=header_row, end_row=header_row),
        None,
    )
    if hr is None:
        return
    for col in sheet_config.column_role_map:
        existing = sheet_config.column_headers.get(col)
        if existing and existing.strip():
            continue  # STORED WINS
        cell = hr.get_cell(col)
        text = str(cell.value).strip() if cell and cell.value is not None else ""
        if text:  # BLANK -> ABSENT (never store "")
            sheet_config.column_headers[col] = text


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

    master_preambles: dict[str, str] = {}
    parsed_sheets: list[ParsedSheet] = []

    for sheet_config in config.sheets:
        # Master preamble sheet -- extract text, do not parse as data
        if sheet_config.treat_as == "master_preamble":
            text = reader.get_master_preamble_text(sheet_config.sheet_name)
            master_preambles[sheet_config.sheet_name] = text or ""
            continue

        # Skipped sheet — exclude from output
        if sheet_config.skip:
            continue

        sheet_name = sheet_config.sheet_name
        header_row = sheet_config.header_row  # always set for non-skipped data sheets

        # MC-3b: capture real per-column header labels from the header_row before
        # classification (classify_row reads sheet_config.column_headers for both
        # description_parts_raw triples and append_notes_raw keys). In-memory only.
        _enrich_column_headers(reader, sheet_config)

        # Step 1: Collect rows (skip header row(s) and any declared skip rows)
        skip_rows: set[int] = set()
        if header_row is not None:
            skip_rows.add(header_row)
            # The header band is the single declared header_row; any SECOND header tier
            # sits ABOVE it (named via top_header_rows_override / read by area-detection)
            # and is excluded by the `row >= header_row` guard below. Data therefore starts
            # at header_row + 1. Extra header tiers BELOW header_row are removed by the user
            # via skip_top_rows_after_header. (Was: also skipped header_row+1 for count==2 —
            # that wrongly removed the first data row. See ADR 0008.)
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

        # Step 3b: Section-header NOTE promotion post-pass — Bug 20 anchors 1+2
        # (sec 9 #108). Promotes NOTE rows at positional anchors (sheet start and
        # after each SUBTOTAL_MARKER) to PREAMBLE level=0. Must run after all
        # classifier passes (classifications are settled) and before resolve_hierarchy.
        _apply_section_header_note_promotion_post_pass(classified_rows)

        # Step 3c: Priced-preamble promotion post-pass — Bug 19 (sec 9 #106).
        # Promotes LINE_ITEM rows whose sl_no extends the PREAMBLE section sequence
        # monotonically (fnt > max preamble fnt in ±20-row window with same sig).
        # Must run after Bug 20 (so anchor-promoted PREAMBLEs are visible) and
        # before resolve_hierarchy (classifications must be settled at hierarchy time).
        _apply_priced_preamble_promotion(classified_rows)

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
        ))

    return ParsedBoq(
        file_path=file_path,
        master_preambles=master_preambles,
        sheets=parsed_sheets,
    )
