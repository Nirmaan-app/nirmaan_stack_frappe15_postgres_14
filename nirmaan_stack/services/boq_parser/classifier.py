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
    # Raw value from the qty_total column cell specifically (None if blank/absent).
    # Separate from `qty` because classify_row() may override `qty` from per-area sum.
    # ResolvedRow.qty_total is initialized from this so post-pass fallback logic works.
    qty_total_raw: float | None = None
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

    # Per-area raw amount captured from amount_by_area ColumnRoles.
    # Parallel structure to qty_by_area_raw.  Keys = area_name, values = float.
    amount_by_area_raw: dict[str, float] = field(default_factory=dict)

    # Per-area raw rate captured from rate_*_by_area ColumnRoles (Phase 1.9a).
    # Outer keys: area names. Inner keys: rate kind ("supply_rate", "install_rate",
    # "combined_rate"). Policy X: explicit 0.0 preserved; blank produces no inner key.
    rate_by_area_raw: dict[str, dict[str, float | None]] = field(default_factory=dict)

    # Per-column notes to be appended (Phase 1.9b). Keys are source column header
    # strings (from SheetConfig.column_headers, else column letter). Values are
    # cell text coerced to str. Empty cells produce no key.
    append_notes_raw: dict[str, str] = field(default_factory=dict)

    # Preamble candidate metadata — populated by populate_preamble_candidate_scores()
    # (a separate post-classification pass, not by classify_row). Always 0 / []
    # when rows are classified individually. Phase 3 wizard reads these to surface
    # NOTE rows that look like unnumbered section headers.
    preamble_candidate_score: int = 0
    preamble_candidate_signals: list[str] = field(default_factory=list)


# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------

# Header-keyword sets keyed by column role, used for HEADER_REPEAT detection.
_HEADER_KW: dict[str, frozenset[str]] = {
    # ===== EXISTING 5 KEYS — extended with audit-derived synonyms =====
    "sl_no": frozenset({
        "sl.no", "s.no", "sno", "sr.no",
        "sl. no", "s. no", "sr. no", "si no", "si.no",
        "serial no", "item no", "s.l",
    }),
    "description": frozenset({
        "description",
        "particulars", "item description", "discription", "desciption",
        "description of item", "description of work",
        "specs", "specifications",
    }),
    "unit": frozenset({
        "unit",
        "uom", "u.o.m",
    }),
    "qty": frozenset({
        "qty", "quantity", "nos",
        "qnty", "boq qty", "boq quantity",
    }),
    "qty_total": frozenset({
        "qty", "quantity", "nos",
        "total qty", "total quantity",
    }),
    # ===== NEW 9 KEYS =====
    "rate_combined": frozenset({
        "rate", "rates", "rate in", "rate (",
        "sitc rate", "sitc",
        "s&i rate", "s+i rate",
        "supply & installation rate", "supply and installation rate",
        "supply, install & commissioning rate",
        "combined rate", "total rate",
    }),
    "rate_supply": frozenset({
        "supply rate", "material rate", "dsr rate",
        "rate (supply)",
    }),
    "rate_install": frozenset({
        "installation rate", "install rate", "erection rate",
        "labour rate", "labor rate",
        "ndsr rate", "non-dsr rate", "non dsr rate",
        "rate (install)", "rate (installation)",
    }),
    "amount_total": frozenset({
        "amount", "total amount", "amount in", "amount (", "amt",
        "as per boq total amount",
    }),
    "amount_combined": frozenset({
        "sitc amount",
        "s&i amount", "s+i amount",
        "supply & installation amount", "supply and installation amount",
        "combined amount",
    }),
    "amount_supply": frozenset({
        "supply amount", "material amount", "dsr amount",
        "amount (supply)", "as per boq total supply",
    }),
    "amount_install": frozenset({
        "installation amount", "install amount", "erection amount",
        "labour amount", "labor amount",
        "non-dsr amount", "non dsr amount",
        "amount (install)", "amount (installation)",
        "as per boq total erection", "as per boq total installation",
    }),
    "make_model": frozenset({
        "make", "model", "brand", "manufacturer", "manufacturers",
        "approved make", "approved makes",
        "make/model", "make/manufacturer",
        "details of materials", "material code", "part code",
        "model no",
    }),
    "row_notes": frozenset({
        "remark", "remarks", "note", "notes",
        "comment", "comments",
    }),
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

# Maps rate_*_by_area ColumnRole → inner dict key used in rate_by_area_raw
_RATE_ROLE_TO_KIND: dict[str, str] = {
    "rate_supply_by_area": "supply_rate",
    "rate_install_by_area": "install_rate",
    "rate_combined_by_area": "combined_rate",
}


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
# Preamble candidate scoring (separate post-classification pass)
# ------------------------------------------------------------------

def _compute_preamble_candidate_score(
    raw_row: RawRow,
    description: str | None,
    is_first_note_in_block: bool,
    block_ends_with_line_item: bool,
    sheet_config: SheetConfig,
) -> tuple[int, list[str]]:
    """
    Score a NOTE row on how "preamble-like" it looks. Used by Phase 3 wizard
    to surface promotion candidates. NOT used by parser classification logic.

    Score breakdown (0-5):
      - Bold formatting on description cell: +2
      - First note in a contiguous note-block (allowing spacers) that ends
        at a LINE_ITEM: +2
      - Description short (< 80 chars after strip): +1

    Returns (score, signals_list).
    """
    score = 0
    signals: list[str] = []

    # Find the description column letter from sheet config
    desc_col: str | None = None
    for col_letter, col_role in sheet_config.column_role_map.items():
        if col_role.role == "description":
            desc_col = col_letter
            break

    # Signal 1: bold (+2)
    if desc_col:
        desc_cell = raw_row.cells.get(desc_col)
        if desc_cell and desc_cell.font_bold:
            score += 2
            signals.append("bold")

    # Signal 2: first note in a block ending at a LINE_ITEM (+2)
    if is_first_note_in_block and block_ends_with_line_item:
        score += 2
        signals.append("precedes_line_item_block")

    # Signal 3: short description (+1)
    if description and len(description.strip()) < 80:
        score += 1
        signals.append("short_description")

    return score, signals


def populate_preamble_candidate_scores(
    classified_rows: list[ClassifiedRow],
    sheet_config: SheetConfig,
) -> None:
    """
    Walk the classified rows and populate preamble_candidate_score +
    preamble_candidate_signals on every NOTE row. Mutates rows in place.

    Detects "note blocks" — contiguous sequences of NOTE (allowing SPACER
    between) — and identifies the first NOTE in each block plus whether
    the block terminates at a LINE_ITEM.

    Must be called ONCE PER SHEET after all rows have been individually
    classified via classify_row(). The parse_boq() orchestrator (Phase 2b.2)
    will call this automatically; callers that invoke classify_row() directly
    must call this manually if they need scoring.
    """
    n = len(classified_rows)
    i = 0
    while i < n:
        c = classified_rows[i]
        if c.classification != RowClassification.NOTE:
            i += 1
            continue

        # Found the start of a note block. Walk forward to find the end
        # of the contiguous note-or-spacer sequence and what terminates it.
        block_start = i
        j = i + 1
        while j < n and classified_rows[j].classification in (
            RowClassification.NOTE,
            RowClassification.SPACER,
        ):
            j += 1
        # j is now either out of bounds or pointing at the first non-note/spacer row
        block_ends_with_line_item = (
            j < n and classified_rows[j].classification == RowClassification.LINE_ITEM
        )

        # Score every NOTE in the block
        for k in range(block_start, j):
            row_k = classified_rows[k]
            if row_k.classification != RowClassification.NOTE:
                continue  # skip spacers within the block
            is_first = (k == block_start)
            score, signals = _compute_preamble_candidate_score(
                row_k.raw_row,
                row_k.description,
                is_first_note_in_block=is_first,
                block_ends_with_line_item=block_ends_with_line_item,
                sheet_config=sheet_config,
            )
            row_k.preamble_candidate_score = score
            row_k.preamble_candidate_signals = signals

        i = j  # skip past the processed block


# ------------------------------------------------------------------
# Unit-based PREAMBLE demotion (separate post-classification pass)
# ------------------------------------------------------------------

def _apply_unit_based_demotion_post_pass(classified_rows: list[ClassifiedRow]) -> None:
    """
    Demote PREAMBLE rows that carry a unit value matching any LINE_ITEM unit
    on the same sheet.

    Real preambles never have a unit; a unit on a blank-qty row means the row is
    a rate-only line item whose qty was left blank. Root cause in real BoQs:
    deeply-nested lowercase-letter sl_no sequences increment hierarchy stack depth
    on every letter transition, mislabelling the deepest rows as PREAMBLEs.

    Match is case-sensitive. Must be called BEFORE populate_preamble_candidate_scores().
    Demoted rows: classification → LINE_ITEM, qty → 0.0, is_rate_only → True.
    """
    line_item_units: set[str] = {
        row.unit
        for row in classified_rows
        if row.classification == RowClassification.LINE_ITEM
        and row.unit is not None
    }

    for row in classified_rows:
        if (
            row.classification == RowClassification.PREAMBLE
            and row.qty is None
            and row.unit is not None
            and row.unit in line_item_units
        ):
            row.classification = RowClassification.LINE_ITEM
            row.qty = 0.0
            row.is_rate_only = True


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
    amount_by_area_raw: dict[str, float] = {}
    qty_total_raw: float | None = None
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
            if area_qty is not None:  # Policy X: preserve explicit zeros
                qty_by_area_raw[area_name] = area_qty
        qty = sum(qty_by_area_raw.values()) if qty_by_area_raw else None

    elif qty_single_col is not None:
        raw_qty, ro_flag, col_warns = _parse_qty_cell(qty_single_col)
        warnings.extend(col_warns)
        if ro_flag:
            is_rate_only = True
        qty = raw_qty  # may still be None for a blank cell

    # Per-area amount extraction — parallel to qty_by_area_raw
    amount_area_cols: list[tuple[str, str]] = []  # (col_letter, area_name)
    for col_letter, col_role in col_map.items():
        if col_role.role == "amount_by_area" and col_role.area:
            amount_area_cols.append((col_letter, col_role.area))

    for col_letter, area_name in amount_area_cols:
        amt_val = _to_float(raw_row.get_cell(col_letter).value if raw_row.get_cell(col_letter) else None)
        if amt_val is not None:  # Policy X: preserve explicit zeros
            amount_by_area_raw[area_name] = amt_val

    # Per-area rate extraction — parallel to amount_by_area_raw (Phase 1.9a)
    rate_by_area_raw: dict[str, dict[str, float | None]] = {}
    for col_letter, col_role in col_map.items():
        kind = _RATE_ROLE_TO_KIND.get(col_role.role)
        if kind is None or not col_role.area:
            continue
        area_name = col_role.area
        cell = raw_row.get_cell(col_letter)
        if cell is None or cell.value is None:
            continue  # blank — Policy X: no entry
        rate_val = _to_float(cell.value)
        if rate_val is not None:  # Policy X: explicit 0.0 preserved
            rate_by_area_raw.setdefault(area_name, {})[kind] = rate_val

    # Per-column notes extraction (append_to_notes role, Phase 1.9b)
    append_notes_raw: dict[str, str] = {}
    for col_letter, col_role in col_map.items():
        if col_role.role != "append_to_notes":
            continue
        cell = raw_row.get_cell(col_letter)
        if cell is None or cell.value is None:
            continue
        value_str = str(cell.value).strip()
        if not value_str:
            continue
        header_label = sheet_config.column_headers.get(col_letter, col_letter)
        append_notes_raw[header_label] = value_str

    # qty_total column overrides if it has a valid value
    if qty_total_col:
        tc = _cell(qty_total_col)
        if tc and tc.value is not None:
            tv = _to_float(tc.value)
            if tv is not None:
                qty = tv
                qty_total_raw = tv  # Policy X: record separately for ResolvedRow

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

    # ---------------------------------------------------------------- #
    # Post-extraction emptiness guard                                    #
    # ---------------------------------------------------------------- #
    # A row classified as NOTE that has no meaningful extracted content is
    # a "ghost note" — typically a template row whose only non-None cell is
    # a computed-zero formula (e.g. =N($D17)*N(E17) with blank qty/rate).
    # JSW Elect B1 has ~70 such rows.  Override to SPACER so they are
    # silently skipped by the hierarchy resolver.
    if classification == RowClassification.NOTE:
        has_any_content = (
            bool(sl_no_value and sl_no_value.strip())
            or bool(desc_text and desc_text.strip())
            or bool(unit and unit.strip())
            or qty is not None
            or rate_supply is not None
            or rate_install is not None
            or rate_combined is not None
            or bool(make_model and make_model.strip())
            or bool(row_notes and row_notes.strip())
        )
        if not has_any_content:
            classification = RowClassification.SPACER
            warnings = []

    return ClassifiedRow(
        raw_row=raw_row,
        classification=classification,
        sl_no_value=sl_no_value or None,
        description=desc_text or None,
        unit=unit,
        qty=qty,
        qty_total_raw=qty_total_raw,
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
        amount_by_area_raw=amount_by_area_raw,
        rate_by_area_raw=rate_by_area_raw,
        append_notes_raw=append_notes_raw,
    )
