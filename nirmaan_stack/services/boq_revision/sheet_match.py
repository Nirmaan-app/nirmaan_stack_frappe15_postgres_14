"""D3 sheet-pairing proposal -- pure, no Frappe imports (ADR-0010 B1).

Given the revised workbook's tab names and the original's committed sheet names,
propose a 1:1 pairing to PRE-FILL the mapping screen. This is not the authority --
the human confirms every pairing on the always-shown screen -- it is noise
control: fold whitespace/case drift (F1) into a confident pre-fill, and refuse to
guess wherever a key is ambiguous.

The rule (ADR-0014 D3):
  * Key = N2-normalized name (the single home, `normalize.normalize_n2`).
  * PER-SIDE, PER-KEY count-guard. A key that maps to >= 2 raw names on EITHER
    side is ambiguous and routes to human (blank -> hard stop on the screen):
      - incoming side self-collides (BOQ-26-00006 holds both 'SUMMARY ' and
        'Summary' as distinct tabs) -> can't 1:1 them;
      - committed side collides -> can't tell which original to point at.
    The guard is PER-KEY: a one-key collision never blocks the other sheets.
  * A clean key present on exactly one raw name per side -> matched (pre-filled
    with the ORIGINAL's VERBATIM name, #152).
  * A key with no committed candidate -> unmatched (a New-sheet candidate).

Strict 1:1 falls out for free: a clean committed side has unique N2 keys, so two
distinct revised sheets can never auto-claim the same original. (Confirm-side
validation re-checks 1:1 against the HUMAN's edited mapping -- see revision.py.)
"""

from collections import defaultdict
from dataclasses import dataclass

from nirmaan_stack.services.boq_revision.normalize import normalize_n2

STATUS_MATCHED = "matched"
STATUS_UNMATCHED = "unmatched"


@dataclass(frozen=True)
class SheetPairing:
    """One revised tab's proposed pairing."""

    sheet_name: str  # revised verbatim tab name (#152)
    proposed_source: str | None  # original's verbatim committed sheet_name, or None
    status: str  # STATUS_MATCHED | STATUS_UNMATCHED


@dataclass(frozen=True)
class PairingProposal:
    pairings: list[SheetPairing]
    self_collision: bool  # True iff the INCOMING workbook has >= 1 N2 self-colliding key


def _by_key(names) -> dict[str, list[str]]:
    """Map each N2 key -> the raw names (order preserved) that normalize to it."""
    out: dict[str, list[str]] = defaultdict(list)
    for name in names:
        out[normalize_n2(name)].append(name)
    return out


def propose_pairing(revised_names, committed_names) -> PairingProposal:
    """Propose a 1:1 pairing of revised tabs to committed sheets (see module docstring)."""
    rev_by_key = _by_key(revised_names)
    com_by_key = _by_key(committed_names)

    pairings: list[SheetPairing] = []
    for name in revised_names:
        key = normalize_n2(name)
        if len(rev_by_key[key]) > 1:
            # Incoming side self-collides on this key -> can't 1:1 it.
            pairings.append(SheetPairing(name, None, STATUS_UNMATCHED))
        elif len(com_by_key.get(key, [])) > 1:
            # Committed side is ambiguous on this key -> can't tell which original.
            pairings.append(SheetPairing(name, None, STATUS_UNMATCHED))
        elif key in com_by_key:
            # Exactly one raw name per side -> confident, name-identical pre-fill.
            pairings.append(SheetPairing(name, com_by_key[key][0], STATUS_MATCHED))
        else:
            # No committed candidate -> a New-sheet candidate (human declares).
            pairings.append(SheetPairing(name, None, STATUS_UNMATCHED))

    self_collision = any(len(raws) > 1 for raws in rev_by_key.values())
    return PairingProposal(pairings=pairings, self_collision=self_collision)
