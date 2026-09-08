"""Header-text vocabulary + the column-mapping guess for a Snag List worksheet.

PURE: openpyxl is not even needed here — stdlib only. Nothing in this module
touches frappe, the database or request context.

This module also owns the shared text helpers (`cell_text`, `normalize_label`)
and the header vocabulary, because "what does this header word mean" is one
concept with one home (ADR-0010 B1/B2): `reader.py` (header-row detection) and
`parser.py` (repeated-header detection) both read them from here.
"""

from __future__ import annotations

import datetime
import re

# ---------------------------------------------------------------------------
# Text normalisation
# ---------------------------------------------------------------------------

_WS_RE = re.compile(r"\s+")
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def cell_text(value) -> str:
    """Render a raw openpyxl cell value as trimmed display text.

    Leading/trailing whitespace is stripped; INTERNAL spacing is preserved
    verbatim (ADR-0016: a user's Area / Category text is stored as written).
    """
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float):
        # 1.0 -> "1"; a genuine decimal keeps its digits.
        if value.is_integer():
            return str(int(value))
        return repr(value)
    if isinstance(value, datetime.datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S") if (value.hour or value.minute or value.second) else value.strftime("%Y-%m-%d")
    if isinstance(value, datetime.date):
        return value.strftime("%Y-%m-%d")
    return str(value).strip()


def normalize_label(text: str) -> str:
    """Case-fold + collapse whitespace, for comparing a header label.

    "  Area /  Location " -> "area / location". A single trailing colon is
    dropped so "Remarks:" still reads as "remarks".
    """
    out = _WS_RE.sub(" ", (text or "").strip().lower())
    return out[:-1].strip() if out.endswith(":") else out


def _tokens(text: str) -> list[str]:
    return _TOKEN_RE.findall((text or "").lower())


# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------

#: Role -> synonyms, MOST SPECIFIC FIRST. Role order is the claim order:
#: description first, then area, category, remarks, and serial LAST. A column
#: letter can only ever be claimed once.
ROLE_SYNONYMS: "dict[str, tuple[str, ...]]" = {
    "description": ("snag description", "description", "observation", "defect", "snag"),
    "area": ("area / location", "area", "location", "zone"),
    "category": ("category", "discipline", "trade", "system", "work header"),
    "remarks": ("remarks", "remark", "comment", "comments", "action"),
    #: The consultant's OWN numbering, kept verbatim when present. Claimed last so
    #: it can never take a column one of the four content roles wanted.
    "serial": ("s.no", "s. no", "sr.no", "sr. no", "sl.no", "sl no", "serial no", "serial number"),
}

ROLE_ORDER: "tuple[str, ...]" = ("description", "area", "category", "remarks", "serial")

#: The roles that carry a snag's CONTENT. `serial` is deliberately absent -- see
#: `_HEADER_WORDS`, which is derived from these and these only.
_CONTENT_ROLES: "tuple[str, ...]" = ("description", "area", "category", "remarks")

#: Header labels that are NOT mapped to a role but still mark a row as a header
#: (they are what a repeated header row is full of). The S.No spellings USED to
#: live here; they moved up into the `serial` role and reach this set through
#: `KNOWN_HEADER_LABELS` instead, so the set is unchanged.
_EXTRA_HEADER_LABELS: "tuple[str, ...]" = (
    "risk level",
    "risk",
    "status",
    "priority",
    "photo",
    "image",
)

#: Every label that reads as a header cell, normalised.
KNOWN_HEADER_LABELS: "frozenset[str]" = frozenset(
    [s for syns in ROLE_SYNONYMS.values() for s in syns] + list(_EXTRA_HEADER_LABELS)
)

#: Single words that, standing as a whole token inside a label, mark it as a
#: header word ("Snag Description" -> description). Deliberately does NOT
#: include plurals like "snags", so a title row reading "Total Snags:124" is
#: not mistaken for a header.
#: ⚠️ DERIVED FROM `_CONTENT_ROLES`, NEVER FROM ALL OF `ROLE_SYNONYMS`. The serial
#: synonyms tokenise to `s` / `no` / `sr` / `sl` / `serial` / `number`, and this set
#: is a WHOLE-TOKEN test -- feeding them in would make any label containing the word
#: "no" ("Not Applicable", "No.") read as a header, and header detection drives which
#: rows are data at all.
_HEADER_WORDS: "frozenset[str]" = frozenset(
    w for role in _CONTENT_ROLES for s in ROLE_SYNONYMS[role] for w in _tokens(s)
)


def is_known_header_label(text: str) -> bool:
    """True when the label IS a header label (exact, case-insensitive)."""
    return normalize_label(text) in KNOWN_HEADER_LABELS


def looks_like_header_label(text: str) -> bool:
    """True when the label is a header label OR contains a header word.

    Whole-token matching only: "Snag Description" hits (token "description"),
    "Total Snags:124" does not (its tokens are total / snags / 124).
    """
    label = normalize_label(text)
    if not label:
        return False
    if label in KNOWN_HEADER_LABELS:
        return True
    return any(tok in _HEADER_WORDS for tok in _tokens(label))


# ---------------------------------------------------------------------------
# The guess
# ---------------------------------------------------------------------------


def _find_letter(columns, synonym: str, taken) -> "str | None":
    """First unclaimed column whose label equals `synonym`, else contains it
    as a whole-word phrase."""
    exact = None
    loose = None
    phrase = re.compile(r"(?<![a-z0-9])" + re.escape(synonym) + r"(?![a-z0-9])")
    for col in columns:
        letter = col.get("letter")
        if not letter or letter in taken:
            continue
        label = normalize_label(col.get("label") or "")
        if not label:
            continue
        if label == synonym and exact is None:
            exact = letter
        elif loose is None and phrase.search(label):
            loose = letter
    return exact or loose


def guess_mapping(columns) -> "dict | None":
    """Guess {area, category, description, remarks, serial} -> Excel column letters.

    `columns` is the `WorkbookColumn[]` shape: [{"letter": "B", "label": "Area"}].
    Returns None when no description column can be found — description is the
    one REQUIRED mapping, because row detection keys on it. `serial` is the
    consultant's own S.No; a sheet without one simply maps it to None and the
    import numbers those rows itself.
    """
    mapping = {role: None for role in ROLE_ORDER}
    taken: "set[str]" = set()

    for role in ROLE_ORDER:
        for synonym in ROLE_SYNONYMS[role]:
            letter = _find_letter(columns, synonym, taken)
            if letter:
                mapping[role] = letter
                taken.add(letter)
                break

    if not mapping["description"]:
        return None
    return mapping
