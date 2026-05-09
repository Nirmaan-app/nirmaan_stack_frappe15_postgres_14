"""
BoQ hierarchy resolver — pure-function, no Frappe imports.

Processes a list of ClassifiedRows (output of classifier.py) and builds
the tree structure: parent_index, level, path, and note attachments.

Out of scope (deferred to later phases):
  - Multi-area qty splitting into qty_by_area child rows  → Phase 2b.2
  - parse_boq() entry point wiring                        → Phase 2b.2
  - DB commit / parent_node assignment                    → Phase 2c
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from nirmaan_stack.services.boq_parser.classifier import ClassifiedRow, RowClassification
from nirmaan_stack.services.boq_parser.config import GlobalSettings, SheetConfig


# ------------------------------------------------------------------
# Public types
# ------------------------------------------------------------------

@dataclass
class ResolvedRow:
    classified_row: ClassifiedRow
    parent_index: int | None = None
    level: int | None = None
    path: str | None = None
    # For NOTE rows: which preamble they attached to (None if pre-preamble)
    attached_to_index: int | None = None
    # For PREAMBLE rows: notes collected from following NOTE rows
    attached_notes: list[str] = field(default_factory=list)


@dataclass
class ResolvedSheet:
    rows: list[ResolvedRow]
    # Notes that appear before any preamble on the sheet
    master_preamble_notes: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------

# Mid-sheet section-reset: "TOTAL ITEM NO. 5" clears the preamble stack.
_MID_SHEET_RESET_RE = re.compile(
    r"^\s*total\s+item\s+no\.?\s+\d+", re.IGNORECASE
)

# Patterns for preamble level determination (applied to normalized sl_no,
# after stripping leading/trailing whitespace and a trailing dot).
_PURE_DIGITS_RE      = re.compile(r"^\d+$")
_DOTTED_DECIMAL_RE   = re.compile(r"^\d+(\.\d+)+$")
_SINGLE_LETTER_RE    = re.compile(r"^[A-Za-z]$")
_PART_A_RE           = re.compile(r"^PART-[A-Za-z]+$", re.IGNORECASE)
_ROMAN_RE            = re.compile(r"^[IVXLCDMivxlcdm]+$")
_LETTER_UNDER_NUM_RE = re.compile(r"^\d+[A-Za-z]$")
_DECIMAL_LETTER_RE   = re.compile(r"^\d+\.\d+[A-Za-z]$")


# ------------------------------------------------------------------
# Private helpers
# ------------------------------------------------------------------

def _determine_preamble_level(
    classified_row: ClassifiedRow,
    stack_depth: int,
    sheet_config: SheetConfig,
) -> tuple[int, list[str]]:
    """
    Infer hierarchy level (1-indexed) from a PREAMBLE row's sl_no and formatting.

    Falls back to cell indent, then stack_depth+1. Records a warning for each
    fallback used. Emits a soft warning for level > 5.
    """
    row_num = classified_row.raw_row.row_number
    warns: list[str] = []

    sl_no = classified_row.sl_no_value
    if not sl_no or not sl_no.strip():
        level = stack_depth + 1
        warns.append(f"Row {row_num}: empty sl_no, defaulting to level {level}")
        if level > 5:
            warns.append(
                f"Row {row_num}: deep preamble nesting (level {level}); "
                f"verify this is intentional"
            )
        return level, warns

    normalized = sl_no.strip().rstrip(".")

    # --- Pattern 1: pure integer (e.g. "1", "12") ---
    if _PURE_DIGITS_RE.match(normalized):
        return 1, warns

    # --- Pattern 2: dotted-decimal with at least one dot (e.g. "1.0", "1.1.4") ---
    if _DOTTED_DECIMAL_RE.match(normalized):
        parts = normalized.split(".")
        trailing_zeros = 0
        for part in reversed(parts):
            if part == "0":
                trailing_zeros += 1
            else:
                break
        if trailing_zeros == 1:
            parts = parts[:-1]
        elif trailing_zeros > 1:
            # Ambiguous (e.g. "1.0.0") — treat as level 1
            return 1, warns
        level = len(parts)
        if level > 5:
            warns.append(
                f"Row {row_num}: deep preamble nesting (level {level}); "
                f"verify this is intentional"
            )
        return level, warns

    # --- Pattern 3: single letter (e.g. "A", "B") ---
    if _SINGLE_LETTER_RE.match(normalized):
        return 1, warns

    # --- Pattern 4: PART-X (e.g. "PART-A", "PART-B") ---
    if _PART_A_RE.match(normalized):
        return 1, warns

    # --- Pattern 5: Roman numeral (e.g. "I", "II", "IV") ---
    if _ROMAN_RE.match(normalized):
        return 1, warns

    # --- Pattern 6: digit + letter (e.g. "1a", "2B") → level 2 ---
    if _LETTER_UNDER_NUM_RE.match(normalized):
        return 2, warns

    # --- Pattern 7: digit.digit + letter (e.g. "1.1a") → level 3 ---
    if _DECIMAL_LETTER_RE.match(normalized):
        return 3, warns

    # --- Fallback 1: cell indent on the sl_no column ---
    sl_no_indent = _get_sl_no_indent(classified_row, sheet_config)
    if sl_no_indent > 0:
        level = sl_no_indent + 1
        warns.append(
            f"Row {row_num}: sl_no '{sl_no}' did not match known pattern; "
            f"level inferred from indent = {level}"
        )
        if level > 5:
            warns.append(
                f"Row {row_num}: deep preamble nesting (level {level}); "
                f"verify this is intentional"
            )
        return level, warns

    # --- Fallback 2: stack depth + 1 ---
    level = stack_depth + 1
    warns.append(
        f"Row {row_num}: level could not be determined; "
        f"defaulted to current depth + 1"
    )
    if level > 5:
        warns.append(
            f"Row {row_num}: deep preamble nesting (level {level}); "
            f"verify this is intentional"
        )
    return level, warns


def _get_sl_no_indent(
    classified_row: ClassifiedRow,
    sheet_config: SheetConfig,
) -> int:
    """Return the indent value of the sl_no cell, or 0 if not found."""
    for col_letter, col_role in sheet_config.column_role_map.items():
        if col_role.role == "sl_no":
            cell = classified_row.raw_row.get_cell(col_letter)
            if cell is not None:
                return cell.indent
            return 0
    return 0


def _top_non_none(stack: list[int | None]) -> int | None:
    """Return the topmost non-None entry in the stack, or None."""
    for entry in reversed(stack):
        if entry is not None:
            return entry
    return None


# ------------------------------------------------------------------
# resolve_hierarchy()
# ------------------------------------------------------------------

def resolve_hierarchy(
    classified_rows: list[ClassifiedRow],
    sheet_config: SheetConfig,
    global_settings: GlobalSettings,
) -> ResolvedSheet:
    """
    Walk classified rows in order and build the preamble/line-item tree.

    Uses a stack-walk algorithm with an in-memory path cache.
    Does NOT write to the database (deferred to Phase 2c).

    Stack invariant: stack[i] holds the resolved-row index of the most
    recently seen preamble at level (i+1). stack entries may be None when
    a higher-level preamble arrived before a lower-level one.
    """
    resolved: list[ResolvedRow] = []
    # resolved-row-index → path string (populated as we build)
    path_cache: dict[int, str] = {}
    # stack[i] = resolved-row index of most recent preamble at level (i+1)
    stack: list[int | None] = []
    # preamble resolved-row-index → accumulated note texts
    notes_to_attach: dict[int, list[str]] = {}
    master_preamble_notes: list[str] = []
    sheet_warnings: list[str] = []

    for classified_row in classified_rows:
        idx = len(resolved)  # this row's position in the output list
        cls = classified_row.classification

        # ---------------------------------------------------------- #
        # SPACER / HEADER_REPEAT — append with no tree fields         #
        # ---------------------------------------------------------- #
        if cls in (RowClassification.SPACER, RowClassification.HEADER_REPEAT):
            resolved.append(ResolvedRow(classified_row=classified_row))
            continue

        # ---------------------------------------------------------- #
        # SUBTOTAL_MARKER                                              #
        # ---------------------------------------------------------- #
        if cls == RowClassification.SUBTOTAL_MARKER:
            desc = classified_row.description or ""
            if _MID_SHEET_RESET_RE.match(desc):
                stack.clear()
            resolved.append(ResolvedRow(classified_row=classified_row))
            continue

        # ---------------------------------------------------------- #
        # PREAMBLE                                                     #
        # ---------------------------------------------------------- #
        if cls == RowClassification.PREAMBLE:
            level, row_warns = _determine_preamble_level(
                classified_row, len(stack), sheet_config
            )
            sheet_warnings.extend(row_warns)

            # Truncate stack to keep only ancestors (levels 1 .. level-1)
            stack = stack[:level - 1]
            # Pad with None if stack was shorter than level-1
            while len(stack) < level - 1:
                stack.append(None)

            parent_index = stack[-1] if stack and stack[-1] is not None else None

            path = str(idx) if parent_index is None else path_cache[parent_index] + "/" + str(idx)

            # Extend stack to hold this level, then place this row
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

        # ---------------------------------------------------------- #
        # LINE_ITEM                                                    #
        # ---------------------------------------------------------- #
        if cls == RowClassification.LINE_ITEM:
            parent_index = _top_non_none(stack)
            if parent_index is None:
                sheet_warnings.append(
                    f"Row {classified_row.raw_row.row_number}: "
                    f"standalone line item with no preamble parent"
                )
            path = str(idx) if parent_index is None else path_cache[parent_index] + "/" + str(idx)
            path_cache[idx] = path
            resolved.append(ResolvedRow(
                classified_row=classified_row,
                parent_index=parent_index,
                path=path,
            ))
            continue

        # ---------------------------------------------------------- #
        # NOTE                                                         #
        # ---------------------------------------------------------- #
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

        # Fallback for any future classification values
        resolved.append(ResolvedRow(classified_row=classified_row))

    # Post-walk: copy accumulated notes into their respective preamble rows
    for preamble_idx, notes in notes_to_attach.items():
        resolved[preamble_idx].attached_notes = list(notes)

    return ResolvedSheet(
        rows=resolved,
        master_preamble_notes=master_preamble_notes,
        warnings=sheet_warnings,
    )
