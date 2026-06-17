"""
Bill Of Quantities -- Electrical & ELV BoQ rows 4-22 comparison audit.

READ-ONLY diagnostic. No parser source files are modified.

Compares two hierarchy resolution strategies side-by-side for xlsx rows 4-22
of the ELECTRICAL & ELV BOQ sheet in Bill of Quantities.xlsx:

  Current (Pipeline X): production resolve_hierarchy() with §7.28 unit-based
    demotion applied (as in parse_boq()).
  Approach A (Pipeline Y): inline resolver with Rule A1 (lowercase-letter
    cascade fix, Bug 11b) and Rule A2 (numeric peer signature match, Bug 11a).
    §7.28 is intentionally skipped.

Output: per-row tables (classification, level, qty, parent_sl_no, path, desc),
differences summary, Bug 12 section-heading candidates, Approach A limitation.

Follows unit_demotion_orphan_audit.py precedent (feat 8a126846).
Script: nirmaan_stack/services/boq_parser/boq_electrical_elv_rows_4_22_audit.py
Generated: 2026-05-23
"""
from __future__ import annotations

import copy
import sys
from pathlib import Path
from typing import Literal

_SCRIPT_DIR = Path(__file__).parent
_APP_ROOT = _SCRIPT_DIR.parent.parent.parent
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from nirmaan_stack.services.boq_parser.classifier import (
    ClassifiedRow,
    RowClassification,
    _apply_unit_based_demotion_post_pass,
    classify_row,
)
from nirmaan_stack.services.boq_parser.config import (
    ColumnRole,
    GlobalSettings,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.hierarchy import (
    ResolvedRow,
    ResolvedSheet,
    _MID_SHEET_RESET_RE,
    _categorize_sl_no_style,
    _detect_level_1_style,
    _top_non_none,
    resolve_hierarchy,
)
from nirmaan_stack.services.boq_parser.reader import BoqReader

# ------------------------------------------------------------------
# Constants (Phase 0a resolved)
# ------------------------------------------------------------------

FIXTURES_DIR = _SCRIPT_DIR / "tests" / "fixtures"
FIXTURE_FILE = "Bill of Quantities.xlsx"
SHEET_NAME = "ELECTRICAL & ELV BOQ"
ROW_START = 4
ROW_END = 22

# Level-1-eligible styles (mirrored from hierarchy._L1_STYLES without import)
_L1_STYLES_AUDIT = frozenset(("letter", "roman", "numeric", "part"))


# ------------------------------------------------------------------
# Inline MappingConfig for ELECTRICAL & ELV BOQ
# (derived from Phase 0a header row inspection)
# ------------------------------------------------------------------

def _boq_config() -> MappingConfig:
    """
    Column layout (verified from rows 1-2 of ELECTRICAL & ELV BOQ):
      A: ITEM NO.           -> sl_no
      B: DSR / NDSR (MR)   -> append_to_notes  (reference codes)
      C: ITEM DESCRIPTIONS  -> description
      D: Unit               -> unit
      E: QTY.               -> qty
      F: Supply Rate        -> rate_supply
      G: Installation Rate  -> rate_install
      H: Supply Amount      -> amount_supply
      I: Installation Amount-> amount_install

    Header: row 1 (merged) + row 2 (sub-labels) -> header_row=2, header_row_count=2.
    Row 3 is blank (confirmed) and is skipped as the second header row.
    Data starts at row 4.
    """
    _cols = {
        "A": ColumnRole(role="sl_no"),
        "B": ColumnRole(role="append_to_notes"),
        "C": ColumnRole(role="description"),
        "D": ColumnRole(role="unit"),
        "E": ColumnRole(role="qty"),
        "F": ColumnRole(role="rate_supply"),
        "G": ColumnRole(role="rate_install"),
        "H": ColumnRole(role="amount_supply"),
        "I": ColumnRole(role="amount_install"),
    }
    return MappingConfig(
        project="bill_of_quantities_audit",
        master_boq=MasterBoqMetadata(boq_name="Bill Of Quantities Audit"),
        sheets=[
            SheetConfig(
                sheet_name=SHEET_NAME,
                header_row=2,
                header_row_count=2,
                column_role_map=_cols,
            ),
        ],
    )


# ------------------------------------------------------------------
# Pattern signature algorithm (Approach A, per prompt spec)
# ------------------------------------------------------------------

def _compute_pattern_signature(sl_no: str) -> str:
    """
    Map each character to D (digit), U (uppercase), l (lowercase), or literal.
    Examples: "1.0"->"D.D", "1.1.4"->"D.D.D", "a."->"l.", "4.1"->"D.D".
    """
    sig = []
    for ch in sl_no:
        if ch.isdigit():
            sig.append("D")
        elif ch.isupper():
            sig.append("U")
        elif ch.islower():
            sig.append("l")
        else:
            sig.append(ch)
    return "".join(sig)


# ------------------------------------------------------------------
# Approach A level determination
# ------------------------------------------------------------------

def _determine_preamble_level_approach_a(
    classified_row: ClassifiedRow,
    level_1_style: Literal["letter", "roman", "numeric", "part"] | None,
    stack: list[int | None],
    stack_top_index: int | None,
    classified_rows: list[ClassifiedRow],
    raw_row: object,
    sheet_config: SheetConfig,
    resolved: list[ResolvedRow],
) -> tuple[int, list[str]]:
    """
    Approach A preamble level determination.
    Incorporates Rule A1 (lowercase-letter cascade fix) and Rule A2 (numeric
    peer sibling signature match). Standard priorities otherwise identical to
    production _determine_preamble_level().

    Returns (level, warnings_for_this_row).
    """
    rr = raw_row
    sl_no = (classified_row.sl_no_value or "").strip()
    stack_depth = len(stack)
    warns: list[str] = []

    if not sl_no:
        level = stack_depth + 1
        warns.append(
            f"Row {rr.row_number}: empty sl_no for preamble; defaulted to depth+1={level}"
        )
        return level, warns

    style = _categorize_sl_no_style(sl_no)

    # Rule A1 -- Lowercase-letter cascade fix (Bug 11b)
    # Production: level = stack_depth + 1 (cascades with every letter transition)
    # Approach A: find deepest non-lowercase ancestor on stack; level = anchor.level + 1
    if style == "lowercase_letter":
        anchor_level: int | None = None
        for stack_idx in reversed(stack):
            if stack_idx is None:
                continue
            entry = resolved[stack_idx]
            entry_sl_no = (entry.classified_row.sl_no_value or "").strip()
            entry_style = _categorize_sl_no_style(entry_sl_no)
            if entry_style != "lowercase_letter":
                anchor_level = entry.level
                break
        if anchor_level is not None:
            level = anchor_level + 1
            warns.append(
                f"Row {rr.row_number}: Rule A1 fired; "
                f"anchor.level={anchor_level} -> level={level}"
            )
            return level, warns
        # No non-lowercase ancestor: fall back to production behaviour
        return stack_depth + 1, warns

    # Standard priority chain (identical to production)
    if style == "multi_dot_numeric":
        normalized = sl_no.rstrip(".")
        level = 1 + normalized.count(".")
        if level_1_style == "numeric" and stack_top_index is not None:
            top_style = _categorize_sl_no_style(classified_rows[stack_top_index].sl_no_value)
            if top_style and top_style not in ("numeric", "multi_dot_numeric"):
                warns.append(
                    f"Row {rr.row_number}: ambiguous level for {sl_no!r} under "
                    f"{top_style!r} parent (Pattern Y); depth={level}"
                )
    elif style is not None and style == level_1_style:
        level = 1
    elif (
        level_1_style == "letter"
        and style == "roman"
        and len(sl_no.rstrip(".")) == 1
    ):
        level = 1
    elif style in _L1_STYLES_AUDIT:
        level = 2
    else:
        # Unknown style -- indent fallback then stack_depth + 1
        sl_no_col: str | None = None
        for col_letter, col_role in sheet_config.column_role_map.items():
            if col_role.role == "sl_no":
                sl_no_col = col_letter
                break
        if sl_no_col:
            sl_no_cell = rr.cells.get(sl_no_col)
            if sl_no_cell and sl_no_cell.indent > 0:
                level = sl_no_cell.indent + 1
                warns.append(
                    f"Row {rr.row_number}: sl_no {sl_no!r} unknown; indent -> level={level}"
                )
            else:
                level = stack_depth + 1
                warns.append(
                    f"Row {rr.row_number}: sl_no {sl_no!r} unknown; depth+1={level}"
                )
        else:
            level = stack_depth + 1
            warns.append(
                f"Row {rr.row_number}: sl_no {sl_no!r} unknown; depth+1={level}"
            )

    # Rule A2 -- Numeric peer sibling fix (Bug 11a)
    # If any stack entry has the same pattern signature, set level = that entry's level.
    sig = _compute_pattern_signature(sl_no.rstrip("."))
    for stack_idx in reversed(stack):
        if stack_idx is None:
            continue
        entry = resolved[stack_idx]
        entry_sl_no = (entry.classified_row.sl_no_value or "").strip().rstrip(".")
        entry_sig = _compute_pattern_signature(entry_sl_no)
        if entry_sig == sig and entry.level is not None:
            if entry.level != level:
                warns.append(
                    f"Row {rr.row_number}: Rule A2 fired; sig={sig!r} matches "
                    f"stack entry (sl_no={entry_sl_no!r}, level={entry.level}) "
                    f"-> level {level} -> {entry.level}"
                )
                level = entry.level
            break

    return level, warns


# ------------------------------------------------------------------
# Approach A resolver (inline duplicate of resolve_hierarchy)
# ------------------------------------------------------------------

def _resolve_hierarchy_approach_a(
    classified_rows: list[ClassifiedRow],
    sheet_config: SheetConfig,
    global_settings: GlobalSettings,
) -> ResolvedSheet:
    """
    Inline replica of resolve_hierarchy() with _determine_preamble_level replaced
    by _determine_preamble_level_approach_a (Rule A1 + Rule A2).

    Stack walk, push/pop rules, parent assignment, path construction, NOTE
    attachment, SUBTOTAL_MARKER stack-clear, and SPACER/HEADER_REPEAT handling
    are all identical to production. §7.28 is NOT applied before this call.
    """
    resolved: list[ResolvedRow] = []
    path_cache: dict[int, str] = {}
    stack: list[int | None] = []
    notes_to_attach: dict[int, list[str]] = {}
    master_preamble_notes: list[str] = []
    sheet_warnings: list[str] = []

    if sheet_config.level_1_style_override is not None:
        level_1_style = sheet_config.level_1_style_override
    else:
        level_1_style = _detect_level_1_style(classified_rows, 0)

    for current_index, classified_row in enumerate(classified_rows):
        idx = len(resolved)
        cls = classified_row.classification

        # SPACER / HEADER_REPEAT -- identical to production
        if cls in (RowClassification.SPACER, RowClassification.HEADER_REPEAT):
            resolved.append(ResolvedRow(classified_row=classified_row))
            continue

        # SUBTOTAL_MARKER -- identical to production
        if cls == RowClassification.SUBTOTAL_MARKER:
            desc = classified_row.description or ""
            if _MID_SHEET_RESET_RE.match(desc):
                stack.clear()
                if sheet_config.level_1_style_override is None:
                    new_style = _detect_level_1_style(classified_rows, current_index + 1)
                    if new_style is not None:
                        level_1_style = new_style
            resolved.append(ResolvedRow(classified_row=classified_row))
            continue

        # PREAMBLE -- same stack walk but calls Approach A level determination
        if cls == RowClassification.PREAMBLE:
            stack_top_index = _top_non_none(stack)
            level, row_warns = _determine_preamble_level_approach_a(
                classified_row,
                level_1_style,
                stack,          # full stack list
                stack_top_index,
                classified_rows,
                classified_row.raw_row,
                sheet_config,
                resolved,       # current resolved list for stack entry lookup
            )
            sheet_warnings.extend(row_warns)

            stack = stack[: level - 1]
            while len(stack) < level - 1:
                stack.append(None)

            parent_index = stack[-1] if stack and stack[-1] is not None else None
            path = (
                str(idx)
                if parent_index is None
                else path_cache[parent_index] + "/" + str(idx)
            )

            while len(stack) < level:
                stack.append(None)
            stack[level - 1] = idx

            path_cache[idx] = path
            resolved.append(ResolvedRow(
                classified_row=classified_row,
                parent_index=parent_index,
                level=level,
                path=path,
            ))
            continue

        # LINE_ITEM -- identical to production
        if cls == RowClassification.LINE_ITEM:
            parent_index = _top_non_none(stack)
            if parent_index is None:
                sheet_warnings.append(
                    f"Row {classified_row.raw_row.row_number}: "
                    f"standalone line item with no preamble parent"
                )
            path = (
                str(idx)
                if parent_index is None
                else path_cache[parent_index] + "/" + str(idx)
            )
            path_cache[idx] = path
            resolved.append(ResolvedRow(
                classified_row=classified_row,
                parent_index=parent_index,
                path=path,
                qty_by_area_raw=classified_row.qty_by_area_raw,
                amount_by_area_raw=classified_row.amount_by_area_raw,
                qty_total=classified_row.qty_total_raw,
                amount_total=classified_row.amount_total,
            ))
            continue

        # NOTE -- identical to production
        if cls == RowClassification.NOTE:
            preamble_index = _top_non_none(stack)
            note_text = classified_row.description or ""
            if preamble_index is not None:
                notes_to_attach.setdefault(preamble_index, []).append(note_text)
                attached_to_index = preamble_index
            else:
                master_preamble_notes.append(note_text)
                attached_to_index = None
            resolved.append(ResolvedRow(
                classified_row=classified_row,
                attached_to_index=attached_to_index,
            ))
            continue

        # Fallback for unknown future classifications
        resolved.append(ResolvedRow(classified_row=classified_row))

    for preamble_idx, notes in notes_to_attach.items():
        resolved[preamble_idx].attached_notes = list(notes)

    return ResolvedSheet(
        rows=resolved,
        master_preamble_notes=master_preamble_notes,
        warnings=sheet_warnings,
    )


# ------------------------------------------------------------------
# Helpers for per-row display
# ------------------------------------------------------------------

def _trunc(s: str | None, n: int = 80) -> str:
    if not s:
        return ""
    return s if len(s) <= n else s[:n] + "..."


def _build_row_lookup(
    resolved_rows: list[ResolvedRow],
) -> dict[int, ResolvedRow]:
    """Map xlsx_row_number -> ResolvedRow."""
    return {
        rr.classified_row.raw_row.row_number: rr
        for rr in resolved_rows
    }


def _parent_sl_no(rr: ResolvedRow, resolved_rows: list[ResolvedRow]) -> str:
    if rr.classified_row.classification in (
        RowClassification.SPACER, RowClassification.HEADER_REPEAT
    ):
        return ""
    if rr.parent_index is None and rr.classified_row.classification not in (
        RowClassification.NOTE, RowClassification.SUBTOTAL_MARKER
    ):
        return "(root)"
    if rr.parent_index is not None:
        parent = resolved_rows[rr.parent_index]
        return parent.classified_row.sl_no_value or "(no sl_no)"
    return ""


def _fmt_qty(qty: float | None) -> str:
    if qty is None:
        return ""
    return f"{qty:.2f}"


def _fmt_level(rr: ResolvedRow) -> str:
    if rr.level is not None:
        return str(rr.level)
    return ""


def _fmt_path(rr: ResolvedRow) -> str:
    cls = rr.classified_row.classification
    if cls in (RowClassification.SPACER, RowClassification.HEADER_REPEAT):
        return f"({cls.value})"
    return rr.path or ""


def _print_table(
    resolved_rows: list[ResolvedRow],
    row_start: int,
    row_end: int,
    classified_rows_for_range: list[ClassifiedRow],
) -> None:
    """Print a per-row table for xlsx rows row_start..row_end (inclusive)."""
    lookup = _build_row_lookup(resolved_rows)
    # Build a set of xlsx_row_numbers that appear in classified_rows
    classified_row_numbers = {cr.raw_row.row_number for cr in classified_rows_for_range}

    hdr = (
        f"{'xlsx_row':<9}| {'sl_no':<13}| {'classification':<18}| "
        f"{'level':<6}| {'qty':<12}| {'parent_sl_no':<18}| {'path':<22}| desc(80)"
    )
    print(hdr)
    print("-" * len(hdr))

    for xlsx_row in range(row_start, row_end + 1):
        rr = lookup.get(xlsx_row)
        if rr is None:
            if xlsx_row in classified_row_numbers:
                print(f"{xlsx_row:<9}| {'(in classified)':<13}| {'???':<18}| {'':6}| {'':12}| {'(not in resolved)':<18}| {'':22}| ")
            else:
                print(f"{xlsx_row:<9}| {'(not in data)':<13}| {'(skipped/not in raw)':<18}| {'':6}| {'':12}| {'':18}| {'':22}| ")
            continue

        cr = rr.classified_row
        sl_no = cr.sl_no_value or ""
        cls_name = cr.classification.value
        level_str = _fmt_level(rr)
        qty_str = _fmt_qty(cr.qty)
        parent_str = _parent_sl_no(rr, resolved_rows)
        path_str = _fmt_path(rr)
        desc_str = _trunc(cr.description, 80)

        print(
            f"{xlsx_row:<9}| {sl_no:<13}| {cls_name:<18}| "
            f"{level_str:<6}| {qty_str:<12}| {parent_str:<18}| {path_str:<22}| {desc_str}"
        )


# ------------------------------------------------------------------
# Bug 12 candidate detection
# ------------------------------------------------------------------

def _is_text_only_sl_no(sl_no: str | None) -> bool:
    """True if sl_no is blank or matches a text-only pattern (no digits)."""
    if not sl_no or not sl_no.strip():
        return True
    stripped = sl_no.strip()
    import re
    return bool(re.match(r"^[A-Za-z\s:.\-]+$", stripped))


def _find_bug12_candidates(
    resolved_rows: list[ResolvedRow],
    row_start: int,
    row_end: int,
) -> list[ResolvedRow]:
    """
    Bug 12 candidates in the target xlsx row range:
      - PREAMBLE AND level == 1
      - sl_no_value is empty OR text-only (no digits)
      - At least one OTHER row in range is PREAMBLE, level 1, with a dotted-decimal sl_no
    """
    lookup = _build_row_lookup(resolved_rows)
    in_range_rows = [
        lookup[n] for n in range(row_start, row_end + 1) if n in lookup
    ]

    # Collect dotted-decimal level-1 PREAMBLEs for anchor check
    has_dotted_l1 = any(
        rr.classified_row.classification == RowClassification.PREAMBLE
        and rr.level == 1
        and not _is_text_only_sl_no(rr.classified_row.sl_no_value)
        for rr in in_range_rows
    )

    if not has_dotted_l1:
        return []

    return [
        rr
        for rr in in_range_rows
        if rr.classified_row.classification == RowClassification.PREAMBLE
        and rr.level == 1
        and _is_text_only_sl_no(rr.classified_row.sl_no_value)
    ]


# ------------------------------------------------------------------
# Differences detector
# ------------------------------------------------------------------

def _collect_differences(
    resolved_current: list[ResolvedRow],
    resolved_approach_a: list[ResolvedRow],
    row_start: int,
    row_end: int,
) -> list[dict]:
    """Compare per-field for each row in range. Return list of difference records."""
    lookup_c = _build_row_lookup(resolved_current)
    lookup_a = _build_row_lookup(resolved_approach_a)
    diffs = []

    for xlsx_row in range(row_start, row_end + 1):
        rr_c = lookup_c.get(xlsx_row)
        rr_a = lookup_a.get(xlsx_row)
        if rr_c is None and rr_a is None:
            continue

        fields_to_compare = [
            ("classification",
             rr_c.classified_row.classification.value if rr_c else "N/A",
             rr_a.classified_row.classification.value if rr_a else "N/A"),
            ("level",
             _fmt_level(rr_c) if rr_c else "N/A",
             _fmt_level(rr_a) if rr_a else "N/A"),
            ("qty",
             _fmt_qty(rr_c.classified_row.qty) if rr_c else "N/A",
             _fmt_qty(rr_a.classified_row.qty) if rr_a else "N/A"),
            ("parent_sl_no",
             _parent_sl_no(rr_c, resolved_current) if rr_c else "N/A",
             _parent_sl_no(rr_a, resolved_approach_a) if rr_a else "N/A"),
            ("path",
             _fmt_path(rr_c) if rr_c else "N/A",
             _fmt_path(rr_a) if rr_a else "N/A"),
        ]

        for field_name, val_c, val_a in fields_to_compare:
            if val_c != val_a:
                diffs.append({
                    "xlsx_row": xlsx_row,
                    "field": field_name,
                    "current": val_c,
                    "approach_a": val_a,
                })

    return diffs


# ------------------------------------------------------------------
# Main audit logic
# ------------------------------------------------------------------

def run_audit() -> None:
    fixture_path = str(FIXTURES_DIR / FIXTURE_FILE)
    mapping_config = _boq_config()

    sheet_config = next(
        sc for sc in mapping_config.sheets if sc.sheet_name == SHEET_NAME
    )
    global_settings = mapping_config.global_settings
    header_row = sheet_config.header_row  # 2

    # Step 1: Read raw rows (replicate orchestrator skip logic)
    reader = BoqReader(fixture_path)
    skip_rows: set[int] = set()
    if header_row is not None:
        skip_rows.add(header_row)
        if sheet_config.header_row_count == 2:
            skip_rows.add(header_row + 1)
    skip_rows.update(sheet_config.skip_top_rows_after_header)

    raw_rows = [
        rr
        for rr in reader.iter_rows(SHEET_NAME)
        if rr.row_number not in skip_rows
        and (header_row is None or rr.row_number >= header_row)
    ]

    # Step 2: Classify all rows
    classified_rows_base = [
        classify_row(rr, sheet_config, global_settings)
        for rr in raw_rows
    ]

    # Deep-copy BEFORE §7.28 mutates for Approach A
    classified_rows_copy_a = copy.deepcopy(classified_rows_base)

    # ------------------------------------------------------------------
    # Pipeline X (Current production) -- apply §7.28 then production resolver
    # ------------------------------------------------------------------
    classified_rows_x = classified_rows_base
    _apply_unit_based_demotion_post_pass(classified_rows_x)
    resolved_x = resolve_hierarchy(classified_rows_x, sheet_config, global_settings)
    resolved_current = resolved_x.rows

    # ------------------------------------------------------------------
    # Pipeline Y (Approach A) -- skip §7.28, use inline Approach A resolver
    # ------------------------------------------------------------------
    # classified_rows_copy_a: §7.28 NOT applied
    resolved_y = _resolve_hierarchy_approach_a(
        classified_rows_copy_a, sheet_config, global_settings
    )
    resolved_approach_a = resolved_y.rows

    # ------------------------------------------------------------------
    # Classify rows in target range (for display context)
    # ------------------------------------------------------------------
    classified_in_range_x = [
        cr for cr in classified_rows_x
        if ROW_START <= cr.raw_row.row_number <= ROW_END
    ]
    classified_in_range_a = [
        cr for cr in classified_rows_copy_a
        if ROW_START <= cr.raw_row.row_number <= ROW_END
    ]

    # ------------------------------------------------------------------
    # Print header
    # ------------------------------------------------------------------
    print("=== Bill Of Quantities -- Electrical & ELV BoQ -- Rows 4-22 Comparison ===")
    print(f"Fixture:    tests/fixtures/{FIXTURE_FILE}")
    print(f"Sheet:      {SHEET_NAME}")
    print(f"Row range:  xlsx rows {ROW_START} to {ROW_END} (inclusive)")
    print("Pipeline:   classify_row -> resolve_hierarchy (+ §7.28 on current side only)")
    print()

    # ------------------------------------------------------------------
    # Current production table
    # ------------------------------------------------------------------
    print("--- CURRENT PRODUCTION (with §7.28) ---")
    _print_table(resolved_current, ROW_START, ROW_END, classified_in_range_x)
    print()

    # ------------------------------------------------------------------
    # Approach A table
    # ------------------------------------------------------------------
    print("--- APPROACH A (no §7.28, Rule A1 + Rule A2) ---")
    _print_table(resolved_approach_a, ROW_START, ROW_END, classified_in_range_a)
    print()

    # ------------------------------------------------------------------
    # Differences
    # ------------------------------------------------------------------
    diffs = _collect_differences(
        resolved_current, resolved_approach_a, ROW_START, ROW_END
    )
    differing_rows = sorted({d["xlsx_row"] for d in diffs})

    print("--- DIFFERENCES (rows where current vs Approach A differ) ---")
    print(f"{'xlsx_row':<10}| {'field_changed':<26}| {'current_value':<30}| approach_a_value")
    print("-" * 90)
    if diffs:
        for d in diffs:
            print(
                f"{d['xlsx_row']:<10}| {d['field']:<26}| {str(d['current']):<30}| {d['approach_a']}"
            )
    else:
        print("  (no differences)")
    print()

    # ------------------------------------------------------------------
    # Bug 12 candidates
    # ------------------------------------------------------------------
    print("--- BUG 12 CANDIDATES ---")
    print(
        "A Bug 12 candidate is a PREAMBLE row at level 1 whose sl_no is empty or "
        "text-only (no digits),\n"
        "co-existing with at least one dotted-decimal level-1 PREAMBLE in rows 4-22."
    )
    print()

    candidates_c = _find_bug12_candidates(resolved_current, ROW_START, ROW_END)
    print(f"Current pipeline ({len(candidates_c)} candidate(s)):")
    if candidates_c:
        for rr in candidates_c:
            cr = rr.classified_row
            print(
                f"  xlsx_row: {cr.raw_row.row_number}, "
                f"sl_no: {cr.sl_no_value!r}, "
                f"level: {rr.level}, "
                f"desc: {_trunc(cr.description, 80)}"
            )
    else:
        print("  No Bug 12 candidates in rows 4-22 under current pipeline.")
    print()

    candidates_a = _find_bug12_candidates(resolved_approach_a, ROW_START, ROW_END)
    print(f"Approach A ({len(candidates_a)} candidate(s)):")
    if candidates_a:
        for rr in candidates_a:
            cr = rr.classified_row
            print(
                f"  xlsx_row: {cr.raw_row.row_number}, "
                f"sl_no: {cr.sl_no_value!r}, "
                f"level: {rr.level}, "
                f"desc: {_trunc(cr.description, 80)}"
            )
    else:
        print("  No Bug 12 candidates in rows 4-22 under Approach A.")
    print()

    # ------------------------------------------------------------------
    # Approach A limitation footer
    # ------------------------------------------------------------------
    print("--- KNOWN APPROACH A LIMITATION ---")
    print(
        "Rule A2 (numeric peer signature match) only fires on rows that go through\n"
        "_determine_preamble_level_approach_a, which in both the production resolver\n"
        "and this inline replica is called exclusively for PREAMBLE rows. LINE_ITEM\n"
        "rows bypass level determination entirely and use _top_non_none(stack) for\n"
        "their parent. Consequently, Bug 11a's canonical case -- a LINE_ITEM with a\n"
        "dotted-decimal sl_no like '2.0' appearing after a PREAMBLE '1.0' of the same\n"
        "pattern signature -- is NOT corrected by Rule A2 alone. The LINE_ITEM's\n"
        "parent is set to the topmost non-None stack entry (typically the '1.0'\n"
        "PREAMBLE), making it a child of 1.0 rather than a sibling. Fixing Bug 11a\n"
        "for LINE_ITEMs requires changes to the LINE_ITEM branch of the resolver,\n"
        "which is outside this audit's scope. This audit surfaces the level-hierarchy\n"
        "impact of Rule A1 on PREAMBLE rows and provides the parent_sl_no column to\n"
        "let the reader assess parenting correctness manually."
    )
    print()

    # ------------------------------------------------------------------
    # Summary stats
    # ------------------------------------------------------------------
    print("--- SUMMARY ---")
    print(f"Rows in range 4-22 with at least one field difference: {len(differing_rows)}/19")
    print(f"Bug 12 candidate count, current pipeline:  {len(candidates_c)}")
    print(f"Bug 12 candidate count, Approach A:        {len(candidates_a)}")
    print()

    # Rule A1/A2 fire counts (from warnings)
    rule_a1_rows: set[int] = set()
    rule_a2_rows: set[int] = set()
    for rr in resolved_approach_a:
        cr = rr.classified_row
        if cr.raw_row.row_number < ROW_START or cr.raw_row.row_number > ROW_END:
            continue
        # Check if Approach A resolver emitted Rule A1/A2 warnings
        # (we can detect via path differences or re-derive via warnings stored in sheet)
    # Derive counts from sheet_warnings (stored in resolved_y.warnings)
    for w in resolved_y.warnings:
        m_row = None
        try:
            import re
            m = re.match(r"Row (\d+):", w)
            if m:
                m_row = int(m.group(1))
        except Exception:
            pass
        if m_row is not None and ROW_START <= m_row <= ROW_END:
            if "Rule A1 fired" in w:
                rule_a1_rows.add(m_row)
            if "Rule A2 fired" in w:
                rule_a2_rows.add(m_row)

    print(f"Rule A1 fires in rows 4-22: {len(rule_a1_rows)} row(s): {sorted(rule_a1_rows) or 'none'}")
    print(f"Rule A2 fires in rows 4-22: {len(rule_a2_rows)} row(s): {sorted(rule_a2_rows) or 'none'}")
    print()

    print("=== END ===")


def main() -> None:
    run_audit()


if __name__ == "__main__":
    main()
