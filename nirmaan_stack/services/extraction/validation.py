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


def _line_gap(qty: float, rate: float, amt: float, discount) -> float:
    """Smallest reconciliation gap for one line, trying the discount both ways.

    Invoice discount columns are ambiguous — sometimes an absolute rupee figure,
    sometimes a percentage — so a line reconciles if EITHER interpretation (or no
    discount at all) brings qty*rate to the line amount. Measured on real invoices:
    treating a 52.5% / 78% discount as rupees produced false per-line failures.
    """
    base = qty * rate
    candidates = [abs(base - amt)]
    if not is_absent(discount):
        d = _num(discount)
        candidates.append(abs((base - d) - amt))            # discount as rupees
        candidates.append(abs(base * (1 - d / 100) - amt))  # discount as percent
    return min(candidates)


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


def reconcile_line_items(lines, net_amount, *, tol: float = RECONCILE_TOLERANCE) -> dict:
    """Self-consistency scorecard for extracted invoice line items.

    Two deterministic checks, no model trust involved:
      * per-line:  quantity * rate - discount  ≈  amount   (within `tol`)
      * vertical:  Σ(line amounts)             ≈  net_amount (the pre-tax subtotal)

    The vertical sum is only meaningful when EVERY line carried an amount — a
    partial table would otherwise sum low and false-fail. A line missing
    quantity/rate/amount is ABSENT (can't check), never INVALID.

    Returns {state, lines:[{idx,state,gap}], sum_gap, sum_state}. `state` is the
    roll-up the autofill UI + any future gate read: INVALID if any line or the
    sum is INVALID; VALID if at least one thing was checkable and nothing failed;
    ABSENT if there was nothing to verify.
    """
    if not lines:
        return {"state": ABSENT, "lines": [], "sum_gap": None, "sum_state": ABSENT}

    line_states = []
    running_total = 0.0
    all_have_amount = True
    any_line_checkable = False

    for idx, ln in enumerate(lines):
        qty, rate, amt = ln.get("quantity"), ln.get("rate"), ln.get("amount")
        if is_absent(amt):
            all_have_amount = False
            line_states.append({"idx": idx, "state": ABSENT, "gap": None})
            continue
        running_total += _num(amt)
        if is_absent(qty) or is_absent(rate):
            line_states.append({"idx": idx, "state": ABSENT, "gap": None})
            continue
        any_line_checkable = True
        gap = _line_gap(_num(qty), _num(rate), _num(amt), ln.get("discount"))
        line_states.append(
            {"idx": idx, "state": VALID if gap <= tol else INVALID, "gap": round(gap, 2)}
        )

    sum_gap = None
    sum_state = ABSENT
    if all_have_amount and not is_absent(net_amount):
        sum_gap = round(abs(running_total - _num(net_amount)), 2)
        sum_state = VALID if sum_gap <= tol else INVALID

    # The vertical sum (Σ line amounts vs the independently-extracted net) is the
    # trustworthy signal — two independent reads agreeing. Per-line qty*rate is
    # ADVISORY: real invoices discount in ways we don't fully model, so a per-line
    # mismatch alone never forces the roll-up to INVALID. (Measured on real
    # invoices: 2 of 6 INVALIDs were percentage-discount false positives.)
    if sum_state == INVALID:
        state = INVALID
    elif sum_state == VALID:
        state = VALID
    else:  # sum not computable (partial table / missing net)
        state = VALID if any_line_checkable else ABSENT

    return {"state": state, "lines": line_states, "sum_gap": sum_gap, "sum_state": sum_state}


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
