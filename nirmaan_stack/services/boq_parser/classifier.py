"""
BoQ row classifier — pure-function, no Frappe imports.

Examines ONE RawRow in isolation and returns a ClassifiedRow with a
RowClassification label and normalized extracted fields.

Out of scope (deferred to later phases):
  - Hierarchy resolution / parent_index / path computation  → Phase 2b.1b
  - Note attachment to parent preambles                     → Phase 2b.1b
  - Mid-sheet numbering reset detection                     → Phase 2b.1b
  - Multi-area qty → qty_by_area child rows                 → Phase 2b.2
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from nirmaan_stack.services.boq_parser.config import GlobalSettings, SheetConfig
from nirmaan_stack.services.boq_parser.reader import CellInfo, RawRow


# ------------------------------------------------------------------
# Public types
# ------------------------------------------------------------------

class RowClassification(str, Enum):
    PREAMBLE = "preamble"
    LINE_ITEM = "line_item"
    NOTE = "note"
    SUBTOTAL_MARKER = "subtotal_marker"
    SPACER = "spacer"
    HEADER_REPEAT = "header_repeat"


@dataclass
class ClassifiedRow:
    raw_row: RawRow
    classification: RowClassification

    sl_no_value: str | None = None
    description: str | None = None
    unit: str | None = None
    qty: float | None = None
    is_rate_only: bool = False
    rate_supply: float | None = None
    rate_install: float | None = None
    rate_combined: float | None = None
    amount_supply: float | None = None
    amount_install: float | None = None
    amount_total: float | None = None
    make_model: str | None = None
    row_notes: str | None = None

    warnings: list[str] = field(default_factory=list)

    # Per-area raw qty captured but NOT yet split into qty_by_area child rows
    # (splitting is deferred to Phase 2b.2).  Keys = area_name, values = float.
    qty_by_area_raw: dict[str, float] = field(default_factory=dict)


# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------

# Header-keyword sets keyed by column role, used for HEADER_REPEAT detection.
_HEADER_KW: dict[str, frozenset[str]] = {
    "sl_no":     frozenset({"sl.no", "s.no", "sno", "sr.no"}),
    "description": frozenset({"description"}),
    "unit":      frozenset({"unit"}),
    "qty":       frozenset({"qty", "quantity", "nos"}),
    "qty_total": frozenset({"qty", "quantity", "nos"}),
}

# Subtotal row text patterns (applied to the description cell, case-insensitive).
_SUBTOTAL_RE: list[re.Pattern] = [
    re.compile(r"^total\s+carried\s+over", re.IGNORECASE),
    re.compile(r"^total\s+item\s+no\.?\s+\d+", re.IGNORECASE),
    re.compile(r"^total\s*$", re.IGNORECASE),
    re.compile(r"^subtotal", re.IGNORECASE),
    re.compile(r"^grand\s+total", re.IGNORECASE),
]

_AMOUNT_ROLES = frozenset({"amount_supply", "amount_install", "amount_total"})


# ------------------------------------------------------------------
# Private helpers
# ------------------------------------------------------------------

def _to_float(value: Any) -> float | None:
    """Return float for numeric/string-numeric input; None otherwise."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return float(stripped)
        except ValueError:
            return None
    return None


def _to_str(value: Any) -> str:
    """Return a stripped string.  None → empty string."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _norm_desc(text: str) -> str:
    """Strip and collapse internal whitespace runs to a single space."""
    return re.sub(r"\s+", " ", text.strip())


# ------------------------------------------------------------------
# classify_row()
# ------------------------------------------------------------------

def classify_row(
    raw_row: RawRow,
    sheet_config: SheetConfig,
    global_settings: GlobalSettings,
) -> ClassifiedRow:
    """
    Classify a single RawRow in isolation and extract normalized fields.

    Evaluation order (first match wins):
      1. Spacer        — blank row
      2. Header repeat — 3+ mapped columns contain their role's header keywords
      3. Subtotal      — description matches known total patterns OR any amount
                         column carries a =SUM( formula
      4. Qty extraction — decides LINE_ITEM / PREAMBLE / NOTE
    """

    # ---------------------------------------------------------------- #
    # Step 1: Spacer                                                     #
    # ---------------------------------------------------------------- #
    if raw_row.is_blank():
        return ClassifiedRow(raw_row=raw_row, classification=RowClassification.SPACER)

    # ---------------------------------------------------------------- #
    # Precompute role → [col_letter] lookup                             #
    # ---------------------------------------------------------------- #
    col_map = sheet_config.column_role_map

    role_to_cols: dict[str, list[str]] = {}
    for col_letter, col_role in col_map.items():
        role_to_cols.setdefault(col_role.role, []).append(col_letter)

    def _first_col(role: str) -> str | None:
        cols = role_to_cols.get(role, [])
        return cols[0] if cols else None

    def _cell(col: str | None) -> CellInfo | None:
        return raw_row.get_cell(col) if col else None

    def _cell_float(role: str) -> float | None:
        c = _cell(_first_col(role))
        return _to_float(c.value) if c else None

    def _cell_str_val(role: str) -> str | None:
        c = _cell(_first_col(role))
        s = _to_str(c.value) if c else ""
        return s if s else None

    # ---------------------------------------------------------------- #
    # Step 2: Header repeat                                              #
    # ---------------------------------------------------------------- #
    kw_hits = 0
    for col_letter, col_role in col_map.items():
        kws = _HEADER_KW.get(col_role.role)
        if not kws:
            continue
        c = raw_row.get_cell(col_letter)
        if c is None or c.value is None:
            continue
        cell_text = _to_str(c.value).lower()
        if any(kw in cell_text for kw in kws):
            kw_hits += 1

    if kw_hits >= 3:
        return ClassifiedRow(
            raw_row=raw_row,
            classification=RowClassification.HEADER_REPEAT,
        )

    # ---------------------------------------------------------------- #
    # Step 3: Subtotal marker                                            #
    # ---------------------------------------------------------------- #
    desc_cell = _cell(_first_col("description"))
    desc_raw = _to_str(desc_cell.value) if desc_cell else ""

    is_subtotal = False
    if desc_raw:
        for pat in _SUBTOTAL_RE:
            if pat.search(desc_raw):
                is_subtotal = True
                break

    if not is_subtotal:
        for col_letter, col_role in col_map.items():
            if col_role.role not in _AMOUNT_ROLES:
                continue
            c = raw_row.get_cell(col_letter)
            if c and c.is_formula and c.formula:
                if c.formula.lstrip("+").upper().startswith("=SUM("):
                    is_subtotal = True
                    break

    if is_subtotal:
        sl_c = _cell(_first_col("sl_no"))
        return ClassifiedRow(
            raw_row=raw_row,
            classification=RowClassification.SUBTOTAL_MARKER,
            sl_no_value=_to_str(sl_c.value) if sl_c else None,
            description=_norm_desc(desc_raw) if desc_raw else None,
        )

    # ---------------------------------------------------------------- #
    # Step 4: Rates (needed before qty finalization)                    #
    # ---------------------------------------------------------------- #
    rate_supply = _cell_float("rate_supply")
    rate_install = _cell_float("rate_install")
    rate_combined = _cell_float("rate_combined")
    has_nonzero_rate = any(
        r is not None and r != 0
        for r in (rate_supply, rate_install, rate_combined)
    )

    # ---------------------------------------------------------------- #
    # Step 4 (cont): Qty extraction                                     #
    # ---------------------------------------------------------------- #
    warnings: list[str] = []
    qty_by_area_raw: dict[str, float] = {}
    is_rate_only = False

    ro_markers = (
        sheet_config.rate_only_markers_override
        if sheet_config.rate_only_markers_override is not None
        else global_settings.rate_only_markers
    )
    ro_upper = {m.upper() for m in ro_markers}

    def _parse_qty_cell(col_letter: str) -> tuple[float | None, bool, list[str]]:
        """
        Parse a qty cell value.

        Returns (qty_value, is_rate_only_from_marker, warnings).
        Returns (None, False, []) for a missing column or a blank cell —
        the blank-qty rule (qty=0 when rates present) is applied afterwards.
        """
        c = raw_row.get_cell(col_letter)
        if c is None:
            return None, False, []  # column absent from this row

        val = c.value
        if val is None:
            return None, False, []  # cell present but blank

        if isinstance(val, str):
            stripped = val.strip()
            if not stripped:
                return None, False, []  # empty string = blank
            su = stripped.upper()
            if su in ro_upper:
                return 0.0, True, []
            try:
                return float(stripped), False, []
            except ValueError:
                return (
                    0.0,
                    True,
                    [
                        f"Row {raw_row.row_number}: qty cell value '{val}' is not numeric "
                        f"and not a known rate-only marker — treated as rate-only."
                    ],
                )

        fval = _to_float(val)
        if fval is not None:
            return fval, False, []
        return None, False, []

    # Partition qty-role columns into single vs multi-area
    qty_single_col: str | None = None
    qty_area_cols: list[tuple[str, str]] = []  # (col_letter, area_name)
    for col_letter, col_role in col_map.items():
        if col_role.role == "qty":
            if col_role.area:
                qty_area_cols.append((col_letter, col_role.area))
            else:
                qty_single_col = col_letter
    qty_total_col = _first_col("qty_total")

    qty: float | None = None

    if qty_area_cols:
        # Multi-area sheet — collect per-area qtys, then sum
        for col_letter, area_name in qty_area_cols:
            area_qty, area_ro, area_warns = _parse_qty_cell(col_letter)
            warnings.extend(area_warns)
            if area_ro:
                is_rate_only = True
            if area_qty is not None and area_qty != 0:
                qty_by_area_raw[area_name] = area_qty
        qty = sum(qty_by_area_raw.values()) if qty_by_area_raw else None

    elif qty_single_col is not None:
        raw_qty, ro_flag, col_warns = _parse_qty_cell(qty_single_col)
        warnings.extend(col_warns)
        if ro_flag:
            is_rate_only = True
        qty = raw_qty  # may still be None for a blank cell

    # qty_total column overrides if it has a valid value
    if qty_total_col:
        tc = _cell(qty_total_col)
        if tc and tc.value is not None:
            tv = _to_float(tc.value)
            if tv is not None:
                qty = tv

    # Blank-qty rule: blank qty + non-zero rate → rate-only line item
    if qty is None and has_nonzero_rate:
        qty = 0.0
        is_rate_only = True

    # qty=0 with any non-zero rate also means rate-only
    if qty is not None and qty == 0 and has_nonzero_rate:
        is_rate_only = True

    # ---------------------------------------------------------------- #
    # Step 5: Remaining fields                                          #
    # ---------------------------------------------------------------- #
    sl_c = _cell(_first_col("sl_no"))
    sl_no_value = _to_str(sl_c.value) if sl_c else ""

    # TODO (Phase 2b.2): concatenate description_specs column (role not yet in
    # config.py) with ' — ' separator when both columns have content.
    desc_text = _norm_desc(desc_raw) if desc_raw else ""

    unit_c = _cell(_first_col("unit"))
    unit = _to_str(unit_c.value) if unit_c else None
    if not unit:
        unit = None

    amount_supply = _cell_float("amount_supply")
    amount_install = _cell_float("amount_install")
    amount_total = _cell_float("amount_total")

    make_model = _cell_str_val("make_model")
    row_notes = _cell_str_val("row_notes")

    # ---------------------------------------------------------------- #
    # Step 5 (cont): Classification decision                            #
    # ---------------------------------------------------------------- #
    if qty is not None:
        # Any resolved qty value (including 0 from RO/blank) → line item
        classification = RowClassification.LINE_ITEM
    elif sl_no_value and desc_text:
        # sl_no + description but no qty → preamble / section header
        classification = RowClassification.PREAMBLE
    elif desc_text and not sl_no_value and not has_nonzero_rate:
        # Description only, no sl_no, no rates → continuation note
        classification = RowClassification.NOTE
    else:
        classification = RowClassification.NOTE
        warnings.append(
            f"Row {raw_row.row_number}: has unclear classification — defaulted to note."
        )

    return ClassifiedRow(
        raw_row=raw_row,
        classification=classification,
        sl_no_value=sl_no_value or None,
        description=desc_text or None,
        unit=unit,
        qty=qty,
        is_rate_only=is_rate_only,
        rate_supply=rate_supply,
        rate_install=rate_install,
        rate_combined=rate_combined,
        amount_supply=amount_supply,
        amount_install=amount_install,
        amount_total=amount_total,
        make_model=make_model,
        row_notes=row_notes,
        warnings=warnings,
        qty_by_area_raw=qty_by_area_raw,
    )
