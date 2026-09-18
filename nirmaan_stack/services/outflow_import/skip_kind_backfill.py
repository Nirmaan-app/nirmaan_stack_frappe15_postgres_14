# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What kind of skip a line was, for lines skipped BEFORE `Outflow Import Row.skip_kind` existed.

PURE: no `frappe`, no database. The back-fill patch (`patches/v3_0/backfill_outflow_skip_kind.py`)
reads the facts and writes the answer; this decides it. Same split as `skip_origin.classify_skip_origin`.

⚠️ THIS IS THE ONE PLACE A KIND IS READ BACK OUT OF A SENTENCE, AND ONLY FOR HISTORY. Every skip made
from this change on stores its kind beside the sentence, from the same branch (`skip_kinds`). The
sentence templates are imported, never re-typed, so a template reworded later cannot silently stop
matching here -- the pinned test formats every template and expects a kind back.

HOW A LINE IS READ
  1. `skip_origin = Manual` -> Skipped by hand. That field is the stored marker (#1273), not a guess.
  2. Otherwise `skip_reason`, then `outcome_note`: the first that reads as a system skip sentence
     decides. An upload skip keeps its sentence in `skip_reason`, a match-time skip in `outcome_note`;
     a system skip later re-skipped by hand (before #1273) has typed text in `skip_reason` and its
     sentence still in `outcome_note`, which is why both are tried.
  3. Nothing recognisable -> `None`. The patch refuses to guess and names the lines.

⚠️ A LINE BOTH REFUSED BY THE BANK AND ALREADY IMPORTED reads "Already imported" (owner ruling): the
sentence is what the software decided, and upload staging tests the repeat before the bank status.
"""

from __future__ import annotations

import re

from nirmaan_stack.services.outflow_import import cashbook, status
from nirmaan_stack.services.outflow_import.skip_kinds import (
    SKIP_KIND_ALREADY_IMPORTED,
    SKIP_KIND_BANK_REFUSED,
    SKIP_KIND_BY_EXCLUSION_CATEGORY,
    SKIP_KIND_BY_HAND,
    SKIP_KIND_CASHBOOK_INTERNAL,
    SKIP_KIND_INFLOW_RECORDED,
    SKIP_KIND_NO_AMOUNT,
    SKIP_KIND_OUTFLOW_RECORDED,
    SKIP_KIND_REPEATED_IN_FILE,
)

__all__ = ["classify_stored_skip_kind", "kind_of_skip_sentence"]


def _prefix(template: str) -> str:
    """The fixed text before a template's first placeholder."""
    return template.split("{", 1)[0]


# The mixed "Already recorded on" group has no kind of its own: it follows the line's direction.
_MIXED_RECORDED = object()

# (prefix, kind) -- every template the software has ever written when it skips a line. Longest first,
# so a shorter prefix can never claim a sentence that a longer one names more precisely.
_PREFIX_KINDS = sorted(
    (
        (_prefix(status.SKIP_REASON_ALREADY_IMPORTED), SKIP_KIND_ALREADY_IMPORTED),
        (_prefix(status.SKIP_REASON_DUPLICATE_IN_FILE), SKIP_KIND_REPEATED_IN_FILE),
        (_prefix(status.SKIP_REASON_NOT_SUCCESSFUL), SKIP_KIND_BANK_REFUSED),
        (_prefix(status.SKIP_REASON_ALREADY_PAID), SKIP_KIND_OUTFLOW_RECORDED),
        (_prefix(status.SKIP_REASON_ALREADY_RECEIVED), SKIP_KIND_INFLOW_RECORDED),
        (_prefix(status._SKIP_REASON_ALREADY_RECORDED), _MIXED_RECORDED),
        (_prefix(cashbook.SKIP_NOT_A_SPEND), SKIP_KIND_CASHBOOK_INTERNAL),
        (_prefix(cashbook.SKIP_NOT_SUCCESSFUL), SKIP_KIND_BANK_REFUSED),
        (_prefix(cashbook.SKIP_NO_AMOUNT), SKIP_KIND_NO_AMOUNT),
        (_prefix(cashbook.SKIP_ALREADY_IMPORTED), SKIP_KIND_ALREADY_IMPORTED),
        (_prefix(cashbook.SKIP_ALREADY_BOOKED), SKIP_KIND_OUTFLOW_RECORDED),
        (_prefix(cashbook.SKIP_REPEATED_IN_FILE), SKIP_KIND_REPEATED_IN_FILE),
    ),
    key=lambda pair: -len(pair[0]),
)

_EXCLUSION_PREFIX = _prefix(status.SKIP_REASON_EXCLUDED_AT_INGEST)
_EXCLUSION_CATEGORY = re.compile(r"rule '([^']+)'")


def kind_of_skip_sentence(text: str | None, direction: str | None = None) -> str | None:
    """The kind a system skip sentence names, or `None` when `text` is not one."""
    text = (text or "").strip()
    if not text:
        return None
    if text.startswith(_EXCLUSION_PREFIX):
        found = _EXCLUSION_CATEGORY.search(text)
        return SKIP_KIND_BY_EXCLUSION_CATEGORY.get(found.group(1)) if found else None
    for prefix, kind in _PREFIX_KINDS:
        if text.startswith(prefix):
            if kind is _MIXED_RECORDED:
                return (
                    SKIP_KIND_INFLOW_RECORDED
                    if status.is_received_direction(direction)
                    else SKIP_KIND_OUTFLOW_RECORDED
                )
            return kind
    return None


def classify_stored_skip_kind(
    *,
    skip_origin: str | None,
    skip_reason: str | None,
    outcome_note: str | None,
    direction: str | None,
) -> str | None:
    """The kind for one stored Skipped line, or `None` when nothing on it says (see module docstring)."""
    if (skip_origin or "").strip() == status.SKIP_ORIGIN_MANUAL:
        return SKIP_KIND_BY_HAND
    for text in (skip_reason, outcome_note):
        kind = kind_of_skip_sentence(text, direction)
        if kind:
            return kind
    return None
