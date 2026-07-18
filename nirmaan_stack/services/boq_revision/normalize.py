"""The N2 normalizer -- pure, no Frappe imports (ADR-0010 B1).

N2 (ADR-0014 D3/D5/D6) is the SINGLE normalization shared by three carry axes:
sheet-name pairing (D3), column-header guarding (D5) and row-description matching
(D6). It absorbs the noise that separately-uploaded, hand-typed Excel carries --
stray leading/trailing whitespace (12.1% of live sheet names), casing, and
Unicode whitespace including nbsp -- WITHOUT ever merging content that differs by
a real character (`'Electrical'` vs `'Electrical 2'` stay distinct).

**One home, no fork.** Every revision consumer imports THIS function; do not
reimplement the rule anywhere else (a second copy that drifts would make sheets
pair one way while rows/columns match another). Mirrors the parser's existing
`_auto_guess._normalize` byte-for-byte so a description keyed here matches the
same text keyed there.

Rule: trim ends + lowercase + collapse every internal whitespace run (incl. nbsp
and tabs, via `str.split()`) to one space. NO punctuation or synonym folding --
`1:4:8` and `100mm` are semantic and preserved.
"""


def normalize_n2(text) -> str:
    """Return the N2-normalized key for `text` (see module docstring).

    None / empty / whitespace-only all normalize to "". Non-strings are coerced
    via `str()` so a stray Int cell never raises.
    """
    if text is None:
        return ""
    return " ".join(str(text).strip().lower().split())
