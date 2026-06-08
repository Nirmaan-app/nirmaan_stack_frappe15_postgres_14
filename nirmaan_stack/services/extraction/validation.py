# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Deterministic verification layer — trust is computed, not model-reported.

A generative model self-reports ~100% confidence, so we don't trust model
confidence. Instead we verify what is verifiable without the model: GSTIN
checksum, arithmetic reconciliation, and date sanity. Results drive (a) soft
warnings in the autofill UI and (b) auto-approve eligibility.

Every check returns one of three states — VALID / INVALID / ABSENT — and the
caller must never conflate INVALID (a real problem) with ABSENT (nothing to
check). This mirrors the gstin_match None-not-False discipline in
api/invoices/_validation.py.
"""
from __future__ import annotations

import re
from datetime import date, datetime

VALID = "valid"
INVALID = "invalid"
ABSENT = "absent"

# 15-char GSTIN: 2 state digits, 5 PAN letters, 4 PAN digits, 1 PAN letter,
# 1 entity char, 'Z', 1 checksum char.
_GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_MOD = len(_ALPHABET)  # 36

# Strings a generative model may emit for a field it couldn't find.
_ABSENT_TOKENS = {"", "null", "none", "n/a", "na", "-", "--", "nil"}

# ₹ tolerance for net + tax (+ additive charges) == total. Data-driven: across
# 40 real invoices the worst rounding gap was ₹2.03, so ₹5 passes every
# legitimate invoice while still catching real arithmetic errors / hallucinations.
RECONCILE_TOLERANCE = 5.0


def is_absent(value) -> bool:
    return value is None or str(value).strip().lower() in _ABSENT_TOKENS


def _num(value) -> float:
    """Coerce a possibly-absent value to float; absent → 0.0."""
    if is_absent(value):
        return 0.0
    return float(value)


def _gstin_check_digit(base14: str) -> str:
    """Standard GSTIN mod-36 check digit over the first 14 characters."""
    factor, total = 2, 0
    for ch in reversed(base14):  # rightmost char first; factor alternates 2,1,2,1...
        prod = _ALPHABET.index(ch) * factor
        total += prod // _MOD + prod % _MOD
        factor = 1 if factor == 2 else 2
    return _ALPHABET[(_MOD - (total % _MOD)) % _MOD]


def validate_gstin(value) -> dict:
    """Format regex + checksum. {state, value}."""
    if is_absent(value):
        return {"state": ABSENT, "value": ""}
    g = str(value).strip().upper()
    try:
        ok = bool(_GSTIN_RE.match(g)) and g[14] == _gstin_check_digit(g[:14])
    except (ValueError, IndexError):
        ok = False
    return {"state": VALID if ok else INVALID, "value": g}


def reconcile_amounts(
    net, tax, total, *, round_off=0, other_charges=0, tcs=0, tol: float = RECONCILE_TOLERANCE
) -> dict:
    """net + tax + (round_off + other_charges + tcs) ≈ total.

    ABSENT (skip, can't verify) if net/tax/total are missing. The additive
    charges default to 0 when absent so a plain net+tax=total invoice still
    reconciles, while a TCS/freight/round-off invoice reconciles once those
    fields are extracted. An unexplained gap → INVALID.
    """
    if is_absent(net) or is_absent(tax) or is_absent(total):
        return {"state": ABSENT}
    try:
        expected = _num(net) + _num(tax) + _num(other_charges) + _num(tcs) + _num(round_off)
        gap = abs(expected - _num(total))
    except (TypeError, ValueError):
        return {"state": ABSENT}
    return {
        "state": VALID if gap <= tol else INVALID,
        "gap": round(gap, 2),
        "tolerance": tol,
    }


def validate_date(value, to_iso, *, min_year: int = 2018) -> dict:
    """parseable + not in the future + not absurdly old. `to_iso` is the shared
    helpers.normalize_date (returns '' on failure)."""
    if is_absent(value):
        return {"state": ABSENT, "value": ""}
    iso = to_iso(str(value))
    if not iso:
        return {"state": INVALID, "value": str(value).strip()}
    try:
        d = datetime.strptime(iso, "%Y-%m-%d").date()
    except ValueError:
        return {"state": INVALID, "value": iso}
    if d > date.today() or d.year < min_year:
        return {"state": INVALID, "value": iso}
    return {"state": VALID, "value": iso}
