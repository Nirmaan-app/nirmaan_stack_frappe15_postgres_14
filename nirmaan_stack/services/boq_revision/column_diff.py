"""D5 config column-diff -- pure, no Frappe imports (ADR-0010 B1).

At revision seeding a matched sheet's columns are diffed against the original's
committed grid. A structurally clean sheet may land `Config Done` carrying the
original's rectified role map; anything unsafe lands `Pending` (so the human
confirms the config once). This module is the pure decision -- it takes already
-extracted primitives (the caller reads the committed grid + the revised
workbook) and returns the disposition; it never touches the DB or openpyxl.

The rule (ADR-0014 D5 / issue #1101):

  * BASELINE = the committed GRID header row (column universe + REAL header text)
    + the committed `column_role_map` for roles. `column_headers` is DEAD DATA
    (548/554 empty, structurally -- no writer exists) and is NEVER read.

  * Match key = the Excel LETTER. Header text is a GUARD, never a key -- the T3
    symmetry INVERTS: columns rarely move but have poor content (blank/duplicate
    headers), so position is the good key and text only confirms it. Comparing
    text positionally ("does the label at C still agree?") makes the duplicate
    hazard irrelevant and blank headers merely reduce COVERAGE, never correctness.

  * Guard scope = the FULL header row (mapped AND unmapped), blanks silent, N2
    verbatim (the single `normalize.normalize_n2` home -- one normalization for
    sheets, rows and columns). A renamed *unmapped* column is an accepted false
    positive (one config screen the human confirms) -- cheap vs a missed shift.

  Dispositions (all unsafe branches converge on `Pending` + seed):
    | guard mismatch (shift / mid-sheet insert or delete) | unsafe          |
    | new column (appended, non-blank header)             | unsafe          |
    | removed MAPPED column                               | unsafe + dangling|
    | removed UNMAPPED column                             | silent no-op    |
    | structurally clean                                  | clean           |

  The seed is ALWAYS the original's rectified role map (the caller reconstructs
  it) -- never a fresh auto-guess (`_auto_guess` cannot reproduce a rectified
  config; its own `_SINGLETON_ROLES` copy wrongly includes `description`, so it
  can never map a 2-description sheet). Removed-mapped FLAGS, never auto-clears.

  Role change on a matched column is UNDETECTABLE by construction (same letter +
  same text = zero signal) -> user-initiated only, no prompt on a clean sheet.
"""

from dataclasses import dataclass, field

from nirmaan_stack.services.boq_revision.normalize import normalize_n2

DISPOSITION_CLEAN = "clean"
DISPOSITION_UNSAFE = "unsafe"

_DESCRIPTION_ROLE = "description"


@dataclass(frozen=True)
class ColumnDiffResult:
    """The column-diff decision for one matched sheet.

    disposition -- DISPOSITION_CLEAN (-> `Config Done`) or DISPOSITION_UNSAFE
                   (-> `Pending`). The SEED is identical either way; only the
                   wizard_status differs.
    reasons     -- human-readable one-liners (logging / tests); empty iff clean.
    dangling_roles -- mapped col letters absent from the revised sheet's column
                   universe (removed-mapped). FLAG, never auto-clear -- the seed
                   keeps the role so the human resolves it on the config screen.
    description_set_changed -- a description-mapped column was removed or its
                   header changed (the T3-coupling config-time warning). Always
                   coincides with an unsafe disposition; surfaced for the warning.
    """

    disposition: str
    reasons: list[str] = field(default_factory=list)
    dangling_roles: list[str] = field(default_factory=list)
    description_set_changed: bool = False

    @property
    def is_clean(self) -> bool:
        return self.disposition == DISPOSITION_CLEAN


def summarize_columns(rows, header_row_numbers) -> tuple[dict[str, str], set[str]]:
    """PURE: reduce a list of grid rows to (header_cells, column universe).

    Shared by BOTH sides of the D5 diff so the header/universe extraction never forks:
    the original committed grid rows and the revised workbook rows are both lists of
    `{"row_number": int, "cells": {col_letter: value}}` (the revised side reuses the
    certified `sheet_preview._extract_grid_rows` transform, so the skip logic is not
    re-implemented). The caller decides WHICH rows to pass -- the original passes only the
    committed header rows (universe = the header extent), the revised passes the whole sheet
    (universe = header extent + every column that holds data).

    Returns:
      header_cells -- {col_letter: joined non-blank header text} for the header rows; a
                      column present as a header cell is kept even if its text is blank
                      (value ""), so the KEYS carry the header extent.
      universe     -- every column letter that holds data OR is a real header cell.
    """
    header_set = set(header_row_numbers or ())
    header_parts: dict[str, list[str]] = {}
    universe: set[str] = set()
    for row in rows or ():
        rnum = row.get("row_number")
        in_header = rnum in header_set
        for col, value in (row.get("cells") or {}).items():
            txt = "" if value is None else str(value).strip()
            # PRESENT if it holds data anywhere OR is a real header cell (even blank) -- the
            # header extent, not data alone, so a blank-but-present column never reads as gone.
            if txt or in_header:
                universe.add(col)
            if in_header:
                header_parts.setdefault(col, [])
                if txt:
                    header_parts[col].append(txt)
    header_cells = {col: " ".join(parts) for col, parts in header_parts.items()}
    return header_cells, universe


def _header_text_by_col(header_cells: dict) -> dict[str, str]:
    """N2-normalized header text per column, NON-BLANK entries only (blanks silent)."""
    out: dict[str, str] = {}
    for col, value in (header_cells or {}).items():
        key = normalize_n2(value)
        if key:
            out[col] = key
    return out


def diff_columns(
    role_map: dict,
    original_header_cells: dict,
    original_universe,
    revised_header_cells: dict,
    revised_universe,
) -> ColumnDiffResult:
    """Diff a revised sheet's columns against the original's committed baseline.

    Args (all col letters are Excel letters, e.g. "A", "B", ..., "AA"):
      role_map              -- committed column_role_map: {col_letter: {"role", "area"}}.
      original_header_cells -- {col_letter: raw header text} from the committed grid header
                               row(s) (blank cells allowed; keys give the header extent).
      original_universe     -- the column letters that exist in the original sheet (header
                               extent UNION role-map keys). An iterable; coerced to a set.
      revised_header_cells  -- {col_letter: raw header text} from the revised workbook header
                               row(s).
      revised_universe      -- the column letters that hold data anywhere in the revised sheet.

    Returns a ColumnDiffResult. A sheet with NO original header baseline (an empty
    original_header_cells -- e.g. a template-origin original whose committed grid was inverted
    from the role map and carries no header row) cannot be certified clean, so it degrades to
    UNSAFE (the safe branch) -- never a false `Config Done`.
    """
    original_universe = set(original_universe or ())
    revised_universe = set(revised_universe or ())
    role_map = role_map or {}

    original_text = _header_text_by_col(original_header_cells)
    revised_text = _header_text_by_col(revised_header_cells)

    reasons: list[str] = []
    guard_mismatched: set[str] = set()

    # No baseline header text to guard against -> cannot certify clean (conservative).
    if not original_text:
        reasons.append(
            "No committed header baseline for this sheet; carrying config for review."
        )

    # 1. Full-row header GUARD: wherever BOTH sides have a non-blank header, the N2 text must
    #    agree. A shift / mid-sheet insert or delete lands different text under the same letter.
    for col in original_text.keys() & revised_text.keys():
        if original_text[col] != revised_text[col]:
            guard_mismatched.add(col)
            reasons.append(
                f"Header at column {col} changed "
                f"('{original_text[col]}' -> '{revised_text[col]}')."
            )

    # 2. NEW column: a revised column with a NON-BLANK header that the original never had.
    #    (A blank-header new column is silent -- blanks degrade coverage, not correctness.)
    for col in revised_text.keys():
        if col not in original_universe:
            reasons.append(f"New column {col} ('{revised_text[col]}') appeared.")

    # 3. REMOVED MAPPED column: a role-mapped column gone from the revised universe. Dangling
    #    role -> FLAG (never auto-clear); the seed keeps the mapping for the human to resolve.
    #    A removed UNMAPPED column is a silent no-op (not in role_map -> not iterated here).
    dangling_roles: list[str] = []
    for col in role_map.keys():
        if col not in revised_universe:
            dangling_roles.append(col)
            role = (role_map.get(col) or {}).get("role") or "unmapped"
            reasons.append(f"Mapped column {col} ('{role}') was removed.")

    # T3-coupling config-time warning: did the description-column SET change? (A removed or
    # header-changed description column changes the joined description the whole pipeline keys
    # on.) Always coincides with an unsafe disposition; surfaced for the warning copy.
    description_cols = {
        col for col, spec in role_map.items()
        if (spec or {}).get("role") == _DESCRIPTION_ROLE
    }
    description_set_changed = bool(
        description_cols & (set(dangling_roles) | guard_mismatched)
    )

    disposition = DISPOSITION_UNSAFE if reasons else DISPOSITION_CLEAN
    return ColumnDiffResult(
        disposition=disposition,
        reasons=reasons,
        dangling_roles=dangling_roles,
        description_set_changed=description_set_changed,
    )
