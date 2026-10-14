# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which Payees look like a vendor (spec #1420, ADR-0033): the ranking behind "Payees that look like
this vendor" on the new-vendor form and the vendor page's Change account.

PURE MODULE -- no `frappe`, no database. `services/payees/choosing.suggest_for_vendor` loads the
candidates and calls `rank_payees`.

* **Strong match**: a vendor already linked to the Payee has the same PAN. One company listed once
  per branch or state carries one PAN, so this is the company itself, whatever its names say.
* **Name only**: no PAN agrees, but the vendor's name reads like the Payee's holder name or one of
  its linked vendors' names (`name_similarity` >= `NAME_MATCH_THRESHOLD`).

Strong matches come first, then by how alike the names are.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

STRONG = "strong"
NAME_ONLY = "name_only"

#: Two names this alike (0..1) make a Name-only suggestion.
NAME_MATCH_THRESHOLD = 0.6
#: Two words this alike count as the same word (a typo), when both have at least `_FUZZY_MIN_LEN` letters.
_WORD_MATCH = 0.8
_FUZZY_MIN_LEN = 4

#: Words that say what kind of firm it is, not which firm.
_NOISE = frozenset({
    "pvt", "private", "ltd", "limited", "llp", "opc", "co", "company", "the", "and", "of", "ms",
    "inc", "corp", "corporation", "india",
})
_BRACKETED = re.compile(r"\([^)]*\)")
_NON_WORD = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class LinkedVendor:
    vendor_name: str | None
    vendor_pan: str | None


@dataclass(frozen=True)
class Candidate:
    """An Active Payee as the ranking sees it: its holder name and the vendors linked to it now."""

    payee: str
    account_name: str | None
    vendors: tuple[LinkedVendor, ...] = ()


@dataclass(frozen=True)
class Suggestion:
    payee: str
    match: str  # STRONG | NAME_ONLY
    score: float


def _words(name: str | None) -> list[str]:
    """The words that name the firm: lower case, no bracketed branch ("(Pune)"), no punctuation,
    no single letters, no "Pvt Ltd"-style words. Kept in order, without repeats."""
    text = _BRACKETED.sub(" ", str(name or "").lower())
    words = [w for w in _NON_WORD.split(text) if len(w) > 1 and w not in _NOISE]
    return list(dict.fromkeys(words))


def _same_word(a: str, b: str) -> bool:
    if a == b:
        return True
    if min(len(a), len(b)) < _FUZZY_MIN_LEN:
        return False
    return SequenceMatcher(None, a, b).ratio() >= _WORD_MATCH


def name_similarity(a: str | None, b: str | None) -> float:
    """How alike two firm names read, 0..1: the share of words they have in common (typos allowed),
    averaged over both names and over the shorter one, so "Kaveri" still reads like "Kaveri Ductfab
    Systems" while "Sharma Traders" does not read like "Gupta Traders"."""
    left, right = _words(a), _words(b)
    if not left or not right:
        return 0.0
    unused = list(right)
    shared = 0
    for word in left:
        hit = next((other for other in unused if _same_word(word, other)), None)
        if hit is not None:
            unused.remove(hit)
            shared += 1
    dice = 2 * shared / (len(left) + len(right))
    containment = shared / min(len(left), len(right))
    return (dice + containment) / 2


def _pan(value: str | None) -> str:
    return str(value or "").strip().upper()


def rank_payees(vendor_name: str | None, vendor_pan: str | None, candidates, *, limit: int = 5) -> list[Suggestion]:
    """The Payees that look like a vendor with this name and PAN, best first, at most `limit`."""
    pan = _pan(vendor_pan)
    suggestions = []
    for c in candidates:
        names = [c.account_name, *(v.vendor_name for v in c.vendors)]
        score = max(name_similarity(vendor_name, n) for n in names)
        if pan and any(_pan(v.vendor_pan) == pan for v in c.vendors):
            suggestions.append(Suggestion(c.payee, STRONG, score))
        elif score >= NAME_MATCH_THRESHOLD:
            suggestions.append(Suggestion(c.payee, NAME_ONLY, score))
    suggestions.sort(key=lambda s: (s.match != STRONG, -s.score, s.payee))
    return suggestions[:limit]
