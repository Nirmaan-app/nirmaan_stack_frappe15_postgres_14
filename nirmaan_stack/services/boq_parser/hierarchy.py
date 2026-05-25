"""
BoQ hierarchy resolver — pure-function, no Frappe imports.

Processes a list of ClassifiedRows (output of classifier.py) and builds
the tree structure: parent_index, level, path, and note attachments.

Out of scope (deferred to later phases):
  - Multi-area qty splitting into qty_by_area child rows  → Phase 2b.2
  - parse_boq() entry point wiring                        → Phase 2b.2
  - DB commit / parent_node assignment                    → Phase 2c
  - Pattern Y multi-dot disambiguation (per-row prompt)   → Phase 3 wizard
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

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
    # Reserved for Phase 3 wizard: True on preambles created by the user with
    # no source row in the BoQ file. Parser never sets this to True.
    is_synthetic: bool = False
    # Per-row validation warnings populated by the sum-validation post-pass (B2).
    # Parser never sets a non-empty value in B1.
    validation_warnings: list[str] = field(default_factory=list)
    # Per-area raw data passed through from ClassifiedRow for LINE_ITEM rows.
    # Populated by resolve_hierarchy(); defaults {} for all other row types.
    qty_by_area_raw: dict[str, float] = field(default_factory=dict)
    amount_by_area_raw: dict[str, float] = field(default_factory=dict)
    # File-declared totals from ClassifiedRow (LINE_ITEM rows only).
    # qty_total comes from qty_total_raw (the qty_total column cell specifically).
    # amount_total comes from classified_row.amount_total.
    # Both may be None; post-pass computes from per-area sum when None (fallback).
    qty_total: float | None = None
    amount_total: float | None = None
    # Post-pass resolved per-area dicts (populated by _apply_multi_area_post_pass).
    qty_by_area: dict[str, float] = field(default_factory=dict)
    amount_by_area: dict[str, float] = field(default_factory=dict)
    # Per-area rates (populated by _apply_multi_area_post_pass for Phase 1.9a rate columns).
    # Outer keys: area names. Inner keys: rate kind ("supply_rate", "install_rate", "combined_rate").
    rate_by_area: dict[str, dict[str, float | None]] = field(default_factory=dict)
    # §9 #45 review flag — set by _apply_priced_preamble_with_children_review_flag_post_pass.
    # True when a PREAMBLE has tree children AND carries a price signal (unit or rate).
    # Phase 3 wizard reads review_reason to select the re-classification UI flow.
    needs_classification_review: bool = False
    review_reason: str = ""


@dataclass
class ResolvedSheet:
    rows: list[ResolvedRow]
    # Notes that appear before any preamble on the sheet
    master_preamble_notes: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------

# Preserved for in-repo audit-script imports (approach_a_reframed_audit.py
# sec 9 #99 feat 16647958, boq_electrical_elv_rows_4_22_audit.py
# sec 9 #98 feat 3b0790f0). NO LONGER used by resolve_hierarchy (sec 9
# #101 universal subtotal-reset, feat <this commit>). Both audit scripts
# are committed reference artifacts; do not delete this constant without
# also archiving or updating those scripts.
_MID_SHEET_RESET_RE = re.compile(
    r"^\s*total\s+item\s+no\.?\s+\d+", re.IGNORECASE
)

# Patterns for _categorize_sl_no_style (pre-compiled for performance).
# All applied AFTER strip() + rstrip(".") normalization.
_RE_PART    = re.compile(r"^PART-[A-Za-z]+$", re.IGNORECASE)
_RE_ROMAN   = re.compile(r"^[IVXLCDM]+$")          # uppercase-only Roman
_RE_UPPER   = re.compile(r"^[A-Z]$")                # single uppercase letter
_RE_LOWER   = re.compile(r"^[a-z]$")                # single lowercase letter
_RE_MULTI1  = re.compile(r"^\d+\.\d+(\.\d+)+$")    # e.g. "1.1.4"
_RE_MULTI2  = re.compile(r"^\d+\.\d+$")             # e.g. "1.1"
_RE_NUMERIC = re.compile(r"^\d+(\.0)?$")             # e.g. "1", "1.0", "30"

_L1_STYLES = frozenset(("letter", "roman", "numeric", "part"))
_ALPHANUMERIC_RE = re.compile(r"[A-Za-z0-9]")

# SUB HEAD section-marker pattern (sec 9 #100 / Phase 2c bug-fix close).
# Matches: "SUB HEAD A", "SUB HEAD K1", "SUB\nHEAD F" (embedded newline),
# "sub head b" (case-insensitive). Trailing identifier is single letter +
# optional digit (covers BoQ ELV A-V plus K1 variants observed in corpus).
_SUB_HEAD_RE = re.compile(
    r"^\s*sub\s+head\s+[a-z][0-9]?\s*$",
    re.IGNORECASE,
)


def pattern_signature(sl_no: str) -> str:
    """
    Map each character of sl_no to a type token:
      digit -> 'D', uppercase -> 'U', lowercase -> 'l', other -> literal char.
    Then collapse consecutive same-class runs to a single token (Bug 22, v5.26a):
      '10.0' -> 'D.D' (not 'DD.D'); '100' -> 'D' (not 'DDD').
    This allows Rule A2-reframed signature equality to fire across single-digit /
    multi-digit boundaries (e.g. sl_no '9.0' and '10.0' are signature-equal).
    Examples: "1.0"->"D.D", "a."->"l.", "10.3"->"D.D", "1a"->"Dl", "A."->"U.".
    """
    result = []
    for ch in sl_no:
        if ch.isdigit():
            result.append("D")
        elif ch.isupper():
            result.append("U")
        elif ch.islower():
            result.append("l")
        else:
            result.append(ch)
    signature = "".join(result)
    return re.sub(r"D+", "D", signature)


def first_numeric_token(sl_no: str) -> int | None:
    """
    Return the longest digit-only prefix of sl_no after stripping leading
    whitespace, as an int.  Returns None if no leading digit exists.
    Examples: "1.0"->1, "10.3"->10, "a."->None, "1a"->1, "  2.0"->2.
    """
    prefix = ""
    for ch in sl_no.lstrip():
        if ch.isdigit():
            prefix += ch
        else:
            break
    return int(prefix) if prefix else None


def _is_sub_head_marker(sl_no: str) -> bool:
    """Return True if sl_no matches the SUB HEAD section-marker pattern.
    Tolerates embedded whitespace (incl. newlines)."""
    if not sl_no:
        return False
    return bool(_SUB_HEAD_RE.match(sl_no))


# ------------------------------------------------------------------
# Private helpers
# ------------------------------------------------------------------

def _categorize_sl_no_style(sl_no_value: str | None) -> str | None:
    """
    Categorize a preamble sl_no code into one of:
      'letter', 'roman', 'numeric', 'part', 'lowercase_letter',
      'multi_dot_numeric', or None if uncategorizable.

    Only 'letter', 'roman', 'numeric', and 'part' are level-1-eligible.
    'lowercase_letter' and 'multi_dot_numeric' are inherently sub-codes.
    """
    if not sl_no_value:
        return None
    sl_no = sl_no_value.strip().rstrip(".")
    if not sl_no:
        return None
    if _RE_PART.match(sl_no):
        return "part"
    if _RE_ROMAN.match(sl_no):
        return "roman"
    if _RE_UPPER.match(sl_no):
        return "letter"
    if _RE_LOWER.match(sl_no):
        return "lowercase_letter"
    # Check numeric (catches "1.0" decoration) BEFORE multi-dot checks
    # so that "1.0" → "numeric" rather than "multi_dot_numeric".
    if _RE_NUMERIC.match(sl_no):
        return "numeric"
    if _RE_MULTI1.match(sl_no):
        return "multi_dot_numeric"
    if _RE_MULTI2.match(sl_no):
        return "multi_dot_numeric"
    return None


def _collect_first_two_preambles_for_detection(
    classified_rows: list[ClassifiedRow],
    start_index: int = 0,
) -> tuple[str | None, str | None]:
    """
    Scan forward from start_index. Return the normalized sl_no of the first two
    PREAMBLE rows whose categorized style is level-1-eligible
    (letter, roman, numeric, or part — NOT lowercase_letter or multi_dot_numeric).
    Returns (first, second) where either may be None if not enough preambles found.
    """
    found: list[str] = []
    for i in range(start_index, len(classified_rows)):
        c = classified_rows[i]
        if c.classification != RowClassification.PREAMBLE:
            continue
        style = _categorize_sl_no_style(c.sl_no_value)
        if style not in _L1_STYLES:
            continue
        sl_no = (c.sl_no_value or "").strip().rstrip(".")
        if sl_no:
            found.append(sl_no)
        if len(found) >= 2:
            break
    first = found[0] if len(found) >= 1 else None
    second = found[1] if len(found) >= 2 else None
    return first, second


def _detect_level_1_style(
    classified_rows: list[ClassifiedRow],
    start_index: int = 0,
) -> Literal["letter", "roman", "numeric", "part"] | None:
    """
    Detect the sheet's level_1_style by examining the first one or two
    level-1-eligible preambles.

    Single-character codes that are ambiguous (I, V, X, L, C, D, M can be
    either alphabetic letters OR Roman numerals) are disambiguated by
    looking at the next preamble's pattern:
      - Unambiguous single letter (A, B, E, F, G, ... — NOT in [IVXLCDM]):
        _categorize_sl_no_style returns "letter" → return "letter" immediately.
      - Multi-char Roman (II, III, IV...) → "roman" immediately.
      - Numeric or part → return directly (unambiguous).
      - Single ambiguous char (I, V, X, L, C, D, M) — check second:
          - second is multi-char Roman (II, III...) → "roman"  (e.g. Paytm I./II./III.)
          - second is single char alphabetically near (abs(ord) ≤ 3) → "letter"
            (e.g. JSW C./D. where C and D are adjacent)
          - second is single char, both in [IVXLCDM], far apart → "roman"
          - second absent or other style → "letter" (alphabetic codes are far more
            common; user can override via SheetConfig.level_1_style_override="roman")
    """
    first, second = _collect_first_two_preambles_for_detection(classified_rows, start_index)

    if first is None:
        return None

    first_style = _categorize_sl_no_style(first)

    # Unambiguous: numeric and part need no lookahead
    if first_style == "numeric":
        return "numeric"
    if first_style == "part":
        return "part"

    # Unambiguous: single uppercase letter that is NOT a Roman character
    # (A, B, E, F, G, H, J, K, N, O, P, Q, R, S, T, U, W, Y, Z).
    # _categorize_sl_no_style returns "letter" for these because they don't
    # match _RE_ROMAN (^[IVXLCDM]+$).
    if first_style == "letter":
        return "letter"

    # Unambiguous: multi-character Roman string (II, III, IV, XII, ...)
    if first_style == "roman" and len(first) >= 2:
        return "roman"

    # Ambiguous: single char in [IVXLCDM] — categorizer says "roman" but it
    # might really be an alphabetic section label (C=100, D=500, etc.).
    # Disambiguate using the second eligible preamble.
    if second is None:
        # Only one eligible preamble; default to letter (alphabetic section
        # codes are far more common in real BoQs than single Roman numerals
        # used as standalone section headers).
        return "letter"

    second_style = _categorize_sl_no_style(second)

    # Second is multi-char Roman → first is also Roman (Paytm I./II./III. pattern)
    if second_style == "roman" and len(second) >= 2:
        return "roman"

    # Both are single characters — distinguish by alphabetic proximity
    if second_style in ("letter", "roman") and len(second) == 1:
        if abs(ord(second) - ord(first)) <= 3:
            # Consecutive or near-consecutive alphabet (C→D, C→E, C→F) →
            # almost certainly alphabetic section labels, not Roman numerals.
            return "letter"
        if all(c in "IVXLCDM" for c in first + second):
            # Both are Roman chars and far apart alphabetically (e.g. I→V=13 apart)
            # — consistent with a Roman numeral sequence but not alphabetic order.
            return "roman"
        return "letter"

    # Second is numeric, multi-dot, or unrecognized — treat first as letter
    return "letter"


def _determine_preamble_level(
    classified_row: ClassifiedRow,
    level_1_style: Literal["letter", "roman", "numeric", "part"] | None,
    stack_depth: int,
    stack_top_index: int | None,
    classified_rows: list[ClassifiedRow],
    raw_row: object,  # RawRow — typed as object to avoid circular complexity
    sheet_config: SheetConfig,
    *,
    approach_a_enabled: bool = True,
    stack: list[int | None] | None = None,
    resolved: list[ResolvedRow] | None = None,
) -> tuple[int, list[str]]:
    """
    Determine the level of a PREAMBLE row given the sheet's level_1_style
    and current stack state. Returns (level, warnings_for_this_row).

    Decision table (first match wins):
      0. SUB HEAD section marker  → 1                (force level 1; sec 9 #100)
      1. Rule A1 (approach_a_enabled): all-lowercase code after strip → anchor.level + 1
      2. empty sl_no              → stack_depth + 1  (with warning)
      3. lowercase_letter         → stack_depth + 1  (inherently sub-code)
      4. multi_dot_numeric        → 1 + dot_count    (emit Pattern Y warning if ambiguous)
      5. style == level_1_style   → 1                (matches sheet's top-level convention)
      6. other recognized style   → 2                (different top-level style → sub-level)
      7. unknown                  → indent fallback, then stack_depth + 1
    """
    from nirmaan_stack.services.boq_parser.reader import RawRow as _RawRow  # local to avoid top-level cycle
    rr: _RawRow = raw_row  # type: ignore[assignment]

    sl_no = (classified_row.sl_no_value or "").strip()
    row_num = rr.row_number
    warns: list[str] = []

    # SUB HEAD section marker (sec 9 #100): force level=1 unconditionally.
    # Section markers like "SUB HEAD A" / "SUB HEAD K1" / "SUB\nHEAD F" are
    # always section roots, regardless of stack state.
    if sl_no and _is_sub_head_marker(sl_no):
        return 1, []

    # Rule A1: lowercase-letter cascade fix.
    # Fires only when the sl_no (after stripping trailing punctuation) consists
    # ENTIRELY of lowercase characters — e.g. "a", "b.", "c.", "iv." — which
    # are genuine section-letter codes.  Multi-char codes containing digits or
    # special characters (e.g. "a1", "custom-code-xyz") fall through to the
    # standard unknown-sl_no warning path instead.
    if approach_a_enabled and sl_no and stack is not None and resolved is not None:
        stripped = sl_no.rstrip(".,):;]")
        sig_stripped = pattern_signature(stripped)
        if sig_stripped and all(c == "l" for c in sig_stripped):
            for entry_idx in reversed(stack):
                if entry_idx is None:
                    continue
                entry_row = resolved[entry_idx]
                entry_sl = (entry_row.classified_row.sl_no_value or "").strip()
                if not pattern_signature(entry_sl).startswith("l"):
                    return entry_row.level + 1, []
            # No non-lowercase ancestor found — fall through to standard logic.

    if not sl_no:
        level = stack_depth + 1
        return level, [
            f"Row {row_num}: empty sl_no for preamble; defaulted to depth + 1 = {level}"
        ]

    style = _categorize_sl_no_style(sl_no)

    # 1. Single lowercase letter — always one deeper than current stack
    if style == "lowercase_letter":
        return stack_depth + 1, warns

    # 2. Multi-dot numeric — depth derived from dot count
    if style == "multi_dot_numeric":
        normalized = sl_no.rstrip(".")
        depth = 1 + normalized.count(".")
        # Pattern Y ambiguity: level_1_style is "numeric" but parent is a non-numeric style
        if level_1_style == "numeric" and stack_top_index is not None:
            top_style = _categorize_sl_no_style(
                classified_rows[stack_top_index].sl_no_value
            )
            if top_style and top_style not in ("numeric", "multi_dot_numeric"):
                warns.append(
                    f"Row {row_num}: ambiguous level for code {sl_no!r} under "
                    f"{top_style!r} parent (Pattern Y BoQ); used default depth "
                    f"{depth}; category=ambiguous_level_pattern_y"
                )
        return depth, warns

    # 3. Style matches the sheet's established level-1 convention → level 1
    if style is not None and style == level_1_style:
        return 1, warns

    # 3a. Single-char codes that are ambiguous between letter and roman
    # (I, V, X, L, C, D, M) categorize as "roman" but may be alphabetic
    # section labels in a letter-style sheet. Accept them at level 1 when
    # the sheet is letter-coded and the code is exactly one character.
    if (
        level_1_style == "letter"
        and style == "roman"
        and len(sl_no.rstrip(".")) == 1
    ):
        return 1, warns

    # 4. A recognized level-1-eligible style, but DIFFERENT from level_1_style → level 2
    if style in _L1_STYLES:
        return 2, warns

    # 5. Unknown style — fallback chain
    # Try sl_no cell indent first
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
                f"Row {row_num}: sl_no {sl_no!r} did not match known pattern; "
                f"level inferred from cell indent = {level}"
            )
            return level, warns

    # Final fallback: stack depth + 1
    level = stack_depth + 1
    warns.append(
        f"Row {row_num}: sl_no {sl_no!r} could not be categorized; "
        f"defaulted to stack depth + 1 = {level}"
    )
    return level, warns


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
    *,
    approach_a_enabled: bool = True,
) -> ResolvedSheet:
    """
    Walk classified rows in order and build the preamble/line-item tree.

    Uses a stack-walk algorithm with an in-memory path cache.
    Does NOT write to the database (deferred to Phase 2c).

    Stack invariant: stack[i] holds the resolved-row index of the most
    recently seen preamble at level (i+1). stack entries may be None when
    a higher-level preamble arrived before a lower-level one.

    level_1_style is detected from the first level-1-eligible preamble and
    re-detected after each mid-sheet numbering reset. An override can be
    supplied via SheetConfig.level_1_style_override for Phase 3/4 use.
    """
    resolved: list[ResolvedRow] = []
    path_cache: dict[int, str] = {}
    stack: list[int | None] = []
    notes_to_attach: dict[int, list[str]] = {}
    master_preamble_notes: list[str] = []
    sheet_warnings: list[str] = []

    # Determine level_1_style: use the override if provided, else auto-detect.
    if sheet_config.level_1_style_override is not None:
        level_1_style: Literal["letter", "roman", "numeric", "part"] | None = (
            sheet_config.level_1_style_override
        )
    else:
        level_1_style = _detect_level_1_style(classified_rows, 0)

    for current_index, classified_row in enumerate(classified_rows):
        idx = len(resolved)
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
            # Universal stack reset (sec 9 #101). Drops the _MID_SHEET_RESET_RE
            # regex guard. Cross-fixture audit (6 fixtures, 46 subtotals: BoQ ELV
            # 21, Snitch 9, Inovalon 11, SG HVAC 4, Raheja 0, D-Tech 1) confirmed
            # zero mid-section subtotals — universal reset is safe.
            stack.clear()
            # Re-detect level_1_style from the next section's first preamble.
            # Only re-detect if no override is in effect.
            if sheet_config.level_1_style_override is None:
                new_style = _detect_level_1_style(classified_rows, current_index + 1)
                if new_style is not None:
                    level_1_style = new_style
            resolved.append(ResolvedRow(classified_row=classified_row))
            continue

        # ---------------------------------------------------------- #
        # PREAMBLE                                                     #
        # ---------------------------------------------------------- #
        if cls == RowClassification.PREAMBLE:
            stack_top_index = _top_non_none(stack)
            level, row_warns = _determine_preamble_level(
                classified_row,
                level_1_style,
                len(stack),
                stack_top_index,
                classified_rows,
                classified_row.raw_row,
                sheet_config,
                approach_a_enabled=approach_a_enabled,
                stack=stack,
                resolved=resolved,
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
            # Rule A2-reframed: if the LINE_ITEM's sl_no has the same pattern
            # signature as the stack top and a different leading numeric token,
            # they are siblings (not parent/child) — attach to the top's parent.
            a2_handled = False
            if approach_a_enabled and stack:
                top_idx = stack[-1]
                if top_idx is not None:
                    li_sl = (classified_row.sl_no_value or "").strip()
                    top_sl = (resolved[top_idx].classified_row.sl_no_value or "").strip()
                    if li_sl and top_sl:
                        li_sig = pattern_signature(li_sl)
                        top_sig = pattern_signature(top_sl)
                        li_fnt = first_numeric_token(li_sl)
                        top_fnt = first_numeric_token(top_sl)
                        if (li_sig == top_sig
                                and li_fnt is not None and top_fnt is not None
                                and li_fnt != top_fnt):
                            parent_index = resolved[top_idx].parent_index
                            a2_handled = True
            if not a2_handled:
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
                qty_by_area_raw=classified_row.qty_by_area_raw,
                amount_by_area_raw=classified_row.amount_by_area_raw,
                qty_total=classified_row.qty_total_raw,
                amount_total=classified_row.amount_total,
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


def _apply_zero_children_preamble_demotion_post_pass(resolved_rows: list[ResolvedRow]) -> None:
    """
    Demote PREAMBLE rows that have zero tree children AND carry a unit or rate.
    Real section-header preambles never have a unit or rate; if one does and it is
    a leaf node in the resolved tree it was mis-classified and belongs as a
    rate-only line item.
    Must be called AFTER resolve_hierarchy() (needs path data) and BEFORE
    _apply_multi_area_post_pass().
    Demoted rows: classification → LINE_ITEM, qty → 0.0, is_rate_only → True.
    """
    # Step A: collect every path that is an ancestor of at least one other row
    paths_with_descendants: set[str] = set()
    for row in resolved_rows:
        p = row.path
        if not p:
            continue
        segments = p.split("/")
        for i in range(1, len(segments)):
            paths_with_descendants.add("/".join(segments[:i]))

    # Step B: demote leaf PREAMBLEs that have a unit or non-zero rate
    for row in resolved_rows:
        cr = row.classified_row
        if cr.classification != RowClassification.PREAMBLE:
            continue
        if row.path in paths_with_descendants:
            continue
        has_unit = cr.unit is not None and cr.unit.strip() != ""
        has_rate = (
            (cr.rate_supply is not None and cr.rate_supply > 0)
            or (cr.rate_install is not None and cr.rate_install > 0)
            or (cr.rate_combined is not None and cr.rate_combined > 0)
        )
        if not (has_unit or has_rate):
            continue
        cr.classification = RowClassification.LINE_ITEM
        cr.qty = 0.0
        cr.is_rate_only = True
        row.level = None


def _is_priced_for_review(
    unit: str | None,
    rate_combined: float | None,
    rate_supply: float | None,
    rate_install: float | None,
) -> bool:
    if unit is not None and _ALPHANUMERIC_RE.search(unit.strip()):
        return True
    if rate_combined is not None and rate_combined > 0:
        return True
    if rate_supply is not None and rate_supply > 0:
        return True
    if rate_install is not None and rate_install > 0:
        return True
    return False


def _apply_priced_preamble_with_children_review_flag_post_pass(resolved_rows: list[ResolvedRow]) -> None:
    """
    Flag PREAMBLE rows that have tree children AND carry a price signal.
    Flagged rows: needs_classification_review=True, review_reason="priced_preamble_with_children".
    Must run AFTER _apply_zero_children_preamble_demotion_post_pass() so demoted leaf
    PREAMBLEs are already LINE_ITEMs and cannot be double-flagged.
    Must run BEFORE _apply_multi_area_post_pass().
    The Phase 3 wizard uses review_reason to select the re-classification UI flow.
    """
    paths_with_descendants: set[str] = set()
    for row in resolved_rows:
        if not row.path:
            continue
        segments = row.path.split("/")
        for i in range(1, len(segments)):
            paths_with_descendants.add("/".join(segments[:i]))

    for row in resolved_rows:
        cr = row.classified_row
        if cr.classification != RowClassification.PREAMBLE:
            continue
        if row.path not in paths_with_descendants:
            continue
        if not _is_priced_for_review(cr.unit, cr.rate_combined, cr.rate_supply, cr.rate_install):
            continue
        row.needs_classification_review = True
        row.review_reason = "priced_preamble_with_children"
