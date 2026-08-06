# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Comparable forms for bank-statement values (Bulk Import Outflow, slice S1).

PURE MODULE -- no `frappe`, no database, no request context. It is imported by the matcher, which
is itself pure; api -> service is the one legal direction and nothing here may reach back.

WHY THIS EXISTS AT ALL. Raw equality fails on real data in every field the matcher depends on. Each
rule below was derived from an observed failure against the live vendor master and payment ledger,
and the failing case is named in the function that fixes it. Nothing here is defensive
generalisation; if a rule has no observed failure behind it, it should not be here.

THE IDENTITY / SCORING SPLIT is load-bearing and the most important thing to understand before
changing anything:

  * `normalize_account`, `normalize_reference` produce IDENTITY forms. Two values that normalize
    equal are treated as the same account or the same bank reference. They must never merge things
    that are genuinely different.
  * `normalize_name`, `name_tokens` produce SCORING forms. They feed a ranked suggestion that a
    human confirms. They are allowed to be lossy -- `name_tokens` deliberately singularises, which
    is a heuristic and would be indefensible as an identity rule.

A normalized NAME must never be used as an identity key, and a normalized ACCOUNT must never be
treated as a vendor identity even though it is an identity form: one account number maps to three
legally distinct D.S. Ductofab companies with different GSTs, and to two separate Siemens entities.
An account narrows a candidate set; a human picks from it.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

__all__ = [
    "normalize_account",
    "normalize_reference",
    "normalize_name",
    "name_tokens",
    "normalize_amount",
    "NAME_NOISE_TOKENS",
]

_WHITESPACE = re.compile(r"\s+")
_ACCOUNT_SEPARATORS = re.compile(r"[\s\-]+")
_NON_ALNUM = re.compile(r"[^0-9a-z]+")

# Legal-form and connective words that carry no discriminating signal between two Indian trade
# names. Exported so the matcher can weight them down; deliberately NOT removed here, so a caller
# that wants the full token list still gets it.
#
# `and` is in this set because of a real pair: the statement writes
# "RIDDHI SIDDHI FASTENERS INDUSTRIAL NEEDS" while the vendor master holds
# "RIDDHI SIDDHI FASTENERS & INDUSTRIAL NEEDS". Treating the connective as noise is what lets those
# two meet.
#
# Trade words like "enterprise", "roadlines" or "hardware" are deliberately ABSENT: they are exactly
# what separates "Sri Sai Enterprises" from "Sri Sai Roadlines", two different live vendors.
NAME_NOISE_TOKENS = frozenset(
    {
        "and",
        "the",
        "private",
        "limited",
        "company",
        "corporation",
        "incorporated",
        "llp",
        "llc",
    }
)

# Expanded so that "Pvt Ltd" and "Private Limited" yield the same tokens.
_ABBREVIATIONS = {
    "pvt": "private",
    "pvtltd": "private",
    "ltd": "limited",
    "ltd.": "limited",
    "co": "company",
    "corp": "corporation",
    "inc": "incorporated",
}


def normalize_account(value: object) -> str:
    """Identity form of a bank account number.

    Strips whitespace and internal separators, then LEADING ZEROS.

    The leading-zero rule is not cosmetic. A live statement carries account `0869102000002783`
    while the vendor master stores the same account as `869102000002783`; a raw string compare
    misses it and the vendor looks unknown. Trailing whitespace is the mirror case -- the master
    holds `'50200023578202 '` with a trailing space on one of the Keywest records.

    An all-zero value normalizes to `"0"` rather than the empty string, so a genuinely zero account
    stays distinguishable from a missing one.
    """
    if value is None:
        return ""
    cleaned = _ACCOUNT_SEPARATORS.sub("", str(value)).strip()
    if not cleaned:
        return ""
    stripped = cleaned.lstrip("0")
    return stripped or "0"


def normalize_reference(value: object) -> str:
    """Identity form of a bank reference number / UTR.

    Strips all whitespace and upper-cases. Leading zeros are PRESERVED -- unlike an account number,
    a bank reference is an opaque token and its first character is significant.

    The whitespace rule is what makes this match at all: 226 live `Project Payments.utr` values are
    whitespace-padded (e.g. `' 504918114686'`). The existing guard in `_fulfil_payment` strips the
    incoming value but compares it against unstripped storage, so those rows are invisible to it.
    Normalising BOTH sides is the fix, and it is the reason this function exists rather than a bare
    `.strip()` at the call site.

    Upper-casing costs nothing on the numeric majority and covers the mixed-form values that do
    occur, e.g. `043572728741/BULD67453750`.
    """
    if value is None:
        return ""
    return _WHITESPACE.sub("", str(value)).strip().upper()


def normalize_name(value: object) -> str:
    """Canonical comparable form of a party name. SCORING ONLY -- never an identity key.

    Case-folds, turns `&` into the word `and`, reduces every non-alphanumeric run to a single space,
    and collapses whitespace.

    Observed failures this resolves, all against the live vendor master:
      * `'Sri Sai Enterprises '`      -- trailing space
      * `Hakimi Hardware`             -- case differs from the statement's `HAKIMI HARDWARE`
      * `RAJ MARKETING e-Hub`         -- hyphen, against the statement's `RAJ MARKETING eHub`
      * `RIDDHI SIDDHI FASTENERS & INDUSTRIAL NEEDS` -- ampersand

    Note `e-Hub` becomes `e hub` while the statement's `eHub` becomes `ehub`; the two are NOT equal
    as strings. That case is resolved at the token level by the matcher, not here -- which is
    exactly why the canonical string and the token set are separate functions.
    """
    if value is None:
        return ""
    folded = str(value).casefold().replace("&", " and ")
    spaced = _NON_ALNUM.sub(" ", folded)
    return _WHITESPACE.sub(" ", spaced).strip()


def name_tokens(value: object) -> tuple[str, ...]:
    """Token sequence for fuzzy name scoring. SCORING ONLY -- never an identity key.

    Expands legal-form abbreviations (`pvt` -> `private`, `ltd` -> `limited`) so
    `Dhatri Networks Pvt Ltd` and `Dhatri Networks Private Limited` agree, then singularises.

    Singularisation exists for one observed pair: the statement's `Absolute Air Solutions` against
    the master's `Absolute Air Solution`. It is a HEURISTIC and that is why it lives on the scoring
    side of this module -- it is only ever allowed to raise a suggestion a person then confirms.

    Order is preserved and duplicates are kept; the caller decides whether it wants a set, a
    containment ratio, or an ordered comparison.
    """
    out: list[str] = []
    for token in normalize_name(value).split():
        expanded = _ABBREVIATIONS.get(token, token)
        out.append(_singularize(expanded))
    return tuple(out)


def _singularize(token: str) -> str:
    """Drop one trailing `s` from a token of 4+ characters that does not already end in `ss`.

    Deliberately crude. The `ss` guard keeps `express` (a live vendor word, `Mark Express`) intact,
    and the length floor keeps short tokens like `gas` untouched. It is applied per token rather
    than to the whole string so a single plural never changes the shape of the rest of the name.
    """
    if len(token) >= 4 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def normalize_amount(value: object) -> Decimal:
    """Money to `Decimal`, tolerating the shapes a statement and this database actually contain.

    Accepts thousands separators, a leading currency symbol, whitespace, and parenthesised
    negatives. Returns `Decimal("0")` for a blank or unparseable value rather than raising -- a bad
    amount is a row-level finding the caller reports, not a reason to abandon a whole file.

    `Decimal`, not `float`, because this figure is compared against a stored amount for exact
    equality and then differenced; binary floating point makes both of those unreliable at the paisa
    level. Conversion to `float` happens only at the persistence boundary, where Frappe's Currency
    fields require it.

    Note the two target doctypes disagree about storage and this function is the shared entry point
    for both: `Project Expenses.amount` is a Data field holding bare numeric strings, while
    `Non Project Expenses.amount` is a real Currency column.
    """
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))

    text = str(value).strip()
    if not text:
        return Decimal("0")

    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]

    cleaned = re.sub(r"[^0-9.\-]", "", text)
    if not cleaned or cleaned in {"-", ".", "-."}:
        return Decimal("0")

    try:
        amount = Decimal(cleaned)
    except InvalidOperation:
        return Decimal("0")
    return -amount if negative else amount
