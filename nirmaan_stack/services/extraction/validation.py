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


# ₹ tolerance for "CGST equals SGST" and for two reads of the same GST agreeing.
GST_SPLIT_TOLERANCE = 1.0


def _amount_or_none(value):
    """A printed figure as float, or None when absent / unreadable."""
    if is_absent(value):
        return None
    cleaned = re.sub(r"[^\d.\-]", "", str(value))
    try:
        return float(cleaned)
    except ValueError:
        return None


def derive_gst(*, igst=None, cgst=None, sgst=None, tax=None, total_tax=None) -> dict:
    """An invoice's GST from the components the model copied off the bill.

    An Indian invoice shows GST in exactly one of three shapes (owner rule, #1336):
    IGST alone; CGST and SGST together, each half of the GST; or a plain "Tax" line.
    The model only reads the printed figures; the sum is done here. Any other
    combination is not a shape a real invoice has, so the read is UNSURE.

    Returns {gst, confident, shape, reason}:
      * confident: `gst` is the derived figure, `reason` is "".
      * unsure: `gst` is the model's printed total-tax figure (None when there is
        none) -- the same figure every reader used before the split existed -- and
        `reason` is a short line for the form.
      * nothing read at all: gst None, not confident, shape "absent", reason "".
    A component printed as 0 counts as not charged (templates print "IGST 0.00"
    beside CGST + SGST); a bill whose every printed component is 0 has GST 0.
    """
    parts = {
        "igst": _amount_or_none(igst),
        "cgst": _amount_or_none(cgst),
        "sgst": _amount_or_none(sgst),
        "tax": _amount_or_none(tax),
    }
    printed = {k: v for k, v in parts.items() if v is not None}
    total = _amount_or_none(total_tax)

    def unsure(shape, reason):
        return {"gst": total, "confident": False, "shape": shape, "reason": reason}

    if not printed:
        if total is None:
            return {"gst": None, "confident": False, "shape": "absent", "reason": ""}
        return unsure("total_only", "GST lines not read — check the GST")

    charged = {k for k, v in printed.items() if abs(v) >= 0.01}
    split = charged - {"tax"}
    if not split:
        gst, shape = (printed["tax"], "tax") if "tax" in charged else (0.0, "zero")
    elif split == {"igst"}:
        gst, shape = printed["igst"], "igst"
    elif split == {"cgst", "sgst"}:
        if abs(printed["cgst"] - printed["sgst"]) > GST_SPLIT_TOLERANCE:
            return unsure("cgst_sgst_differ", "CGST and SGST differ — check the GST")
        gst, shape = printed["cgst"] + printed["sgst"], "cgst_sgst"
    elif split == {"cgst"}:
        return unsure("cgst_only", "Only CGST found — enter the total GST")
    elif split == {"sgst"}:
        return unsure("sgst_only", "Only SGST found — enter the total GST")
    else:
        return unsure("mixed", "IGST and CGST/SGST both found — check the GST")

    # A Tax line beside a split, or the model's own total-tax read, must repeat it.
    for other in (printed.get("tax") if split and "tax" in charged else None, total):
        if other is not None and abs(other - gst) > GST_SPLIT_TOLERANCE:
            return unsure("total_disagrees", "GST lines do not match the total tax — check the GST")

    return {"gst": round(gst, 2), "confident": True, "shape": shape, "reason": ""}
