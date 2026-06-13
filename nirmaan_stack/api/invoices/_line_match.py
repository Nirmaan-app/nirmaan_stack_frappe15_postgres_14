# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Match extracted invoice line items to a Procurement Order's `items` rows.

Design (decided with the user): fuzzy-match LOCALLY first — deterministic, pure,
auditable scoring over (lines, po_items) with NO model call. Whatever the fuzzy
pass can't confidently place becomes the "residue", which the caller hands to a
targeted Gemini mapper (services.extraction.mapping); every Gemini suggestion is
re-verified numerically here before it is trusted. The model proposes only on the
hard leftovers; Python always has the final, auditable say.

The mapping is decision-support: it powers a reviewer's verification table + a
soft over-billing flag. It never blocks submit and is not an auto-approve gate.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

# --- Tunable knobs (DOMAIN INPUTS — to be refined with the user) -------------
MATCH_THRESHOLD = 0.55       # composite score required to accept a fuzzy match
RATE_TOLERANCE_PCT = 0.02    # |inv_rate - po_quote| within 2% is a clean rate hit
RATE_DECAY_LIMIT = 0.25      # beyond 25% rate difference, rate score is 0
OVERBILL_TOLERANCE = 10.0    # ₹ slack before flagging a matched line as over-billed
# Weights: name dominant, rate a strong corroborator, unit a light tiebreaker.
W_NAME, W_RATE, W_UNIT = 0.55, 0.35, 0.10

# Charge-like lines that are NOT PO items and must never be force-matched.
_NON_ITEM_RE = re.compile(
    r"\b(freight|transport|packing|forwarding|loading|unloading|insurance|"
    r"round\s*off|p\s*&\s*f|cartage|delivery\s*charges?|handling|gst|cgst|sgst|igst)\b",
    re.I,
)

# UOM synonyms → canonical form. DOMAIN INPUT: extend with the user's vocabulary.
UOM_NORMALIZATION = {
    "nos": "nos", "no": "nos", "no.": "nos", "nos.": "nos", "pcs": "nos", "pc": "nos",
    "piece": "nos", "pieces": "nos", "unit": "nos", "units": "nos", "ea": "nos", "each": "nos",
    "sqm": "sqm", "sq.m": "sqm", "sq m": "sqm", "sqmt": "sqm", "m2": "sqm", "sq.mtr": "sqm",
    "sqft": "sqft", "sq.ft": "sqft", "sft": "sqft", "sq ft": "sqft",
    "rmt": "rmt", "rm": "rmt", "rft": "rft", "r.ft": "rft", "rft.": "rft",
    "kg": "kg", "kgs": "kg", "kilogram": "kg", "mt": "mt", "ton": "mt", "tonne": "mt",
    "ltr": "ltr", "litre": "ltr", "liter": "ltr", "l": "ltr",
    "bag": "bag", "bags": "bag", "box": "box", "boxes": "box", "set": "set", "sets": "set",
    "roll": "roll", "rolls": "roll", "ls": "ls", "ls.": "ls", "lump sum": "ls", "lumpsum": "ls",
    "cum": "cum", "cu.m": "cum", "m3": "cum", "brass": "brass", "quintal": "quintal",
}

_TOKEN_RE = re.compile(r"[a-z0-9]+")


# --- Scoring (pure) ----------------------------------------------------------
def _norm_unit(u) -> str:
    if not u:
        return ""
    s = str(u).strip().lower()
    return UOM_NORMALIZATION.get(s, s.replace(".", "").replace(" ", ""))


def _tokens(s) -> set:
    return set(_TOKEN_RE.findall((s or "").lower()))


def _name_score(desc, item_name) -> float:
    d, n = (desc or "").strip().lower(), (item_name or "").strip().lower()
    if not d or not n:
        return 0.0
    ratio = SequenceMatcher(None, d, n).ratio()
    dt, nt = _tokens(d), _tokens(n)
    overlap = len(dt & nt) / min(len(dt), len(nt)) if dt and nt else 0.0
    # Token overlap rescues verbose descriptions / word-order differences.
    return max(ratio, 0.5 * ratio + 0.5 * overlap)


def _num_or_none(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _rate_score(inv_rate, po_quote) -> float:
    r, q = _num_or_none(inv_rate), _num_or_none(po_quote)
    if r is None or not q:
        return 0.0
    diff = abs(r - q) / max(abs(q), 1.0)
    if diff <= RATE_TOLERANCE_PCT:
        return 1.0
    if diff >= RATE_DECAY_LIMIT:
        return 0.0
    return 1.0 - diff / RATE_DECAY_LIMIT


def _unit_score(inv_unit, po_unit) -> float:
    a, b = _norm_unit(inv_unit), _norm_unit(po_unit)
    if not a or not b:
        return 0.5  # unknown → neutral, don't penalise
    return 1.0 if a == b else 0.0


def _pair_score(line, po) -> float:
    return round(
        W_NAME * _name_score(line.get("description"), po.get("item_name"))
        + W_RATE * _rate_score(line.get("rate"), po.get("quote"))
        + W_UNIT * _unit_score(line.get("unit"), po.get("unit")),
        4,
    )


def _verify_match(line, po) -> bool:
    """Backend ratification of a model-proposed match: accept only if the numbers
    OR the name independently corroborate it, so Gemini can't map arbitrarily."""
    return (
        _rate_score(line.get("rate"), po.get("quote")) >= 0.5
        or _name_score(line.get("description"), po.get("item_name")) >= 0.4
    )


def _overbill(line, po) -> dict:
    inv_amt, po_amt = _num_or_none(line.get("amount")), _num_or_none(po.get("amount"))
    inv_qty, po_qty = _num_or_none(line.get("quantity")), _num_or_none(po.get("quantity"))
    amt_exceed = inv_amt is not None and po_amt is not None and inv_amt > po_amt + OVERBILL_TOLERANCE
    qty_exceed = inv_qty is not None and po_qty is not None and inv_qty > po_qty + 0.001
    return {
        "would_exceed": bool(amt_exceed or qty_exceed),
        "amount_exceeded": bool(amt_exceed),
        "qty_exceeded": bool(qty_exceed),
        "invoice_amount": inv_amt, "po_amount": po_amt,
        "invoice_qty": inv_qty, "po_qty": po_qty,
    }


def _po_view(po, row) -> dict:
    return {
        "row": row, "item_id": po.get("item_id"), "item_name": po.get("item_name"),
        "unit": po.get("unit"), "quantity": po.get("quantity"),
        "received_quantity": po.get("received_quantity"),
        "quote": po.get("quote"), "amount": po.get("amount"),
    }


# --- Orchestration -----------------------------------------------------------
def match_invoice_lines_to_po(line_items, po_items, residue_mapper=None) -> dict:
    """Fuzzy-match `line_items` to `po_items`; optionally resolve the residue via
    `residue_mapper` (a callable taking (residue_line_dicts, candidate_po_views)
    and returning [{invoice_line_index, po_item_id}]).

    Returns {mappings, unmatched_po_items, summary}. Each mapping carries status
    ∈ {matched, unmatched, non_item}, source ∈ {fuzzy, gemini, None}, score, the
    chosen po_item_id/po_item_name, and an over_billing block for matched rows.
    """
    lines = list(line_items or [])
    pos = list(po_items or [])

    non_item_idx = {
        i for i, ln in enumerate(lines)
        if _NON_ITEM_RE.search(ln.get("description") or "")
    }

    # Greedy one-to-one over all scored pairs, best first.
    pairs = sorted(
        (
            (_pair_score(ln, po), i, j)
            for i, ln in enumerate(lines) if i not in non_item_idx
            for j, po in enumerate(pos)
        ),
        reverse=True,
    )
    chosen, used_line, used_po, source = {}, set(), set(), {}
    for score, i, j in pairs:
        if score < MATCH_THRESHOLD or i in used_line or j in used_po:
            continue
        chosen[i] = (j, score); used_line.add(i); used_po.add(j); source[i] = "fuzzy"

    # Residue (unmatched, non-charge lines) → optional Gemini fallback, re-verified.
    residue = [i for i in range(len(lines)) if i not in used_line and i not in non_item_idx]
    cand_rows = [j for j in range(len(pos)) if j not in used_po]
    if residue_mapper and residue and cand_rows:
        suggestions = residue_mapper(
            [{**lines[i], "invoice_line_index": i} for i in residue],
            [_po_view(pos[j], j) for j in cand_rows],
        ) or []
        for sug in suggestions:
            i, pid = sug.get("invoice_line_index"), sug.get("po_item_id")
            if i not in residue or i in used_line or not pid:
                continue
            j = next((j for j in cand_rows if j not in used_po and pos[j].get("item_id") == pid), None)
            if j is None or not _verify_match(lines[i], pos[j]):
                continue  # model proposed it, but the numbers/name don't corroborate
            chosen[i] = (j, _pair_score(lines[i], pos[j])); used_line.add(i); used_po.add(j)
            source[i] = "gemini"

    mappings = []
    for i, ln in enumerate(lines):
        row = {
            "invoice_line_index": i,
            "description": ln.get("description"), "unit": ln.get("unit"),
            "quantity": ln.get("quantity"), "rate": ln.get("rate"), "amount": ln.get("amount"),
            "po_item_id": None, "po_item_name": None, "po_row": None,
            "score": None, "source": None, "status": "unmatched", "over_billing": None,
        }
        if i in non_item_idx:
            row["status"] = "non_item"
        elif i in chosen:
            j, score = chosen[i]
            po = pos[j]
            row.update({
                "status": "matched", "source": source[i], "score": score,
                "po_item_id": po.get("item_id"), "po_item_name": po.get("item_name"),
                "po_row": j, "over_billing": _overbill(ln, po),
            })
        mappings.append(row)

    unmatched_po = [_po_view(pos[j], j) for j in range(len(pos)) if j not in used_po]
    summary = {
        "matched": sum(1 for m in mappings if m["status"] == "matched"),
        "matched_fuzzy": sum(1 for m in mappings if m["source"] == "fuzzy"),
        "matched_gemini": sum(1 for m in mappings if m["source"] == "gemini"),
        "unmatched": sum(1 for m in mappings if m["status"] == "unmatched"),
        "non_item": sum(1 for m in mappings if m["status"] == "non_item"),
        "po_rows": len(pos), "po_unmatched": len(unmatched_po),
        "over_billed": sum(1 for m in mappings if m.get("over_billing", {}) and m["over_billing"]["would_exceed"]),
    }
    return {"mappings": mappings, "unmatched_po_items": unmatched_po, "summary": summary}
