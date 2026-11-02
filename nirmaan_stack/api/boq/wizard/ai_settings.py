# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Settings/secret access for the BoQ review AI pass (Slice AI-2a).

Mirrors nirmaan_stack/services/extraction/files.py: the non-secret settings are
read with perm-bypassing `frappe.db.get_single_value` so non-admin roles can run
the AI pass, while the doctype stays write-restricted to System Manager; the
encrypted Anthropic key is read via `get_decrypted_password`. Both readers fail
CLOSED (disabled / None) on any error so a transient DB issue never raises into
the AI flow. No caching -- fresh read each call (mirrors the reference).
"""
from __future__ import annotations

import frappe
from frappe.utils import cint, flt

SETTINGS_DOCTYPE = "BOQ Upload Review AI Settings"


def get_boq_ai_settings():
    """Read the BoQ AI settings singleton (perm-bypassing, non-secret fields only).

    On any error returns a degraded {enabled: False} so a transient DB issue
    fails closed rather than raising into the AI flow. Never reads the secret key
    (that is the sole job of get_boq_ai_api_key).
    """
    try:
        get = lambda field: frappe.db.get_single_value(SETTINGS_DOCTYPE, field)
        return {
            "enabled": bool(cint(get("enabled"))),
            "provider": (get("provider") or "Anthropic").strip(),
            "model": (get("model") or "claude-sonnet-4-6").strip(),
            "max_tokens": int(get("max_tokens") or 8000),
            "request_timeout_seconds": int(get("request_timeout_seconds") or 120),
        }
    except Exception:
        frappe.log_error(
            title="BoQ AI settings load failed",
            message=frappe.get_traceback(),
        )
        return {"enabled": False, "request_timeout_seconds": 120}


def get_boq_ai_api_key():
    """Read the encrypted Anthropic API key (fail-closed)."""
    from frappe.utils.password import get_decrypted_password

    try:
        value = get_decrypted_password(
            SETTINGS_DOCTYPE, SETTINGS_DOCTYPE, "anthropic_api_key", raise_exception=False
        )
        return (value or "").strip() or None
    except Exception:
        frappe.log_error(
            title="BoQ AI API key read failed", message=frappe.get_traceback()
        )
        return None


# --- Historical matching (DEV2-B1, owner G8 / R-H2AJ) ------------------------------------------------------------
#
# The match-only fields of the same Single. The `model` field above, its fallback and every reader of
# get_boq_ai_settings are untouched: matching reads its own fields through the functions below.
#
# NO CODE DEFAULT FOR A MODEL OR A PRICE (BUILD REQUIREMENTS: "model names in ONE setting, never in code"). The
# model and price fields declare no default in the doctype, so an empty one stays empty and every matching entry
# point refuses with a plain message naming it. The numeric limits DO declare defaults in the doctype (calls at once
# 50, reply cap 1024, ...); a Single whose stored row is missing reads the doctype's own default, because a migrate
# adds the field without writing a value to tabSingles and a plain read would cast the gap to 0.

MATCH_SWITCH_FIELDS = ("match_enabled", "match_cards_at_commit")
MATCH_LIMIT_FIELDS = (
    "match_calls_at_once", "match_reply_max_tokens", "match_card_reply_max_tokens", "match_retry_wait_s",
    "match_burst_failures", "match_burst_window_s", "match_cost_cap_usd",
)
# The reply-length cap per kind (owner answer Q2 (b), 16:51): 20-row card replies need far more than the judge's
# short reply (DEV2-S8 C3: p50 8,943, max 27,300 output tokens a card batch).
MATCH_REPLY_CAP_FIELDS = {"card": "match_card_reply_max_tokens", "judge": "match_reply_max_tokens"}
MATCH_MODEL_FIELDS = {"card": "match_card_model", "judge": "match_judge_model"}
MATCH_PRICE_FIELDS = {
    "card": ("match_card_price_in", "match_card_price_out"),
    "judge": ("match_judge_price_in", "match_judge_price_out"),
}
MATCH_FIELDS = (
    MATCH_SWITCH_FIELDS + MATCH_LIMIT_FIELDS + tuple(MATCH_MODEL_FIELDS.values())
    + tuple(f for pair in MATCH_PRICE_FIELDS.values() for f in pair)
)


class MatchSettingsIncomplete(frappe.ValidationError):
    """A matching entry point refused: a model, a price or a limit is empty or not usable."""


def get_boq_match_settings():
    """The historical-matching fields, typed. A field with nothing stored reads the doctype's declared default
    (none for the models and prices, so those read None). Never reads the API key. Raises on a read error: the
    callers decide (the commit gate below fails closed, an entry point refuses)."""
    meta = frappe.get_meta(SETTINGS_DOCTYPE)
    stored = frappe.db.get_singles_dict(SETTINGS_DOCTYPE)
    out = {}
    for field in MATCH_FIELDS:
        df = meta.get_field(field)
        raw = stored.get(field)
        if raw is None or str(raw).strip() == "":
            raw = df.default if df else None
        if raw is None or str(raw).strip() == "":
            out[field] = None
        elif df.fieldtype == "Check" or df.fieldtype == "Int":
            out[field] = cint(raw)
        elif df.fieldtype == "Float":
            out[field] = flt(raw)
        else:
            out[field] = str(raw).strip()
    out["match_enabled"] = bool(out["match_enabled"])
    out["match_cards_at_commit"] = bool(out["match_cards_at_commit"])
    return out


def match_cards_at_commit_on():
    """True only when BOTH match_enabled and match_cards_at_commit are ON. Fails closed (False) on any error, so a
    settings read can never fail or change a commit. Reads the two switches only."""
    try:
        get = lambda field: frappe.db.get_single_value(SETTINGS_DOCTYPE, field, cache=False)
        return bool(cint(get("match_enabled"))) and bool(cint(get("match_cards_at_commit")))
    except Exception:
        return False


def require_match_settings(kind):
    """The settings one matching entry point needs (`kind` "card" or "judge"), or MatchSettingsIncomplete with a
    plain message naming every empty or unusable field. NO code default: an empty model or price refuses.

    Returns {model, price_in, price_out, reply_max_tokens (the kind's own cap), calls_at_once, retry_wait_s, burst_failures,
    burst_window_s, cost_cap_usd, request_timeout_seconds}; the timeout is the existing AI settings field, read
    through get_boq_ai_settings unchanged."""
    if kind not in MATCH_MODEL_FIELDS:
        raise ValueError(f"unknown matching kind {kind!r}")
    s = get_boq_match_settings()
    meta = frappe.get_meta(SETTINGS_DOCTYPE)
    label = lambda f: (meta.get_field(f).label if meta.get_field(f) else f)
    model_f = MATCH_MODEL_FIELDS[kind]
    price_in_f, price_out_f = MATCH_PRICE_FIELDS[kind]
    problems = []
    for f in (model_f, price_in_f, price_out_f):
        if s.get(f) is None:
            problems.append(f"{label(f)} is empty")
    for f in (price_in_f, price_out_f):
        if s.get(f) is not None and s[f] < 0:
            problems.append(f"{label(f)} is below 0")
    cap_f = MATCH_REPLY_CAP_FIELDS[kind]
    for f in ("match_calls_at_once", cap_f, "match_burst_failures", "match_burst_window_s"):
        if not s.get(f) or s[f] < 1:
            problems.append(f"{label(f)} must be 1 or more")
    if s.get("match_retry_wait_s") is None or s["match_retry_wait_s"] < 0:
        problems.append(f"{label('match_retry_wait_s')} must be 0 or more")
    if not s.get("match_cost_cap_usd") or s["match_cost_cap_usd"] <= 0:
        problems.append(f"{label('match_cost_cap_usd')} must be above 0")
    if problems:
        raise MatchSettingsIncomplete(
            "Historical matching cannot run until these are set in BOQ Upload Review AI Settings: "
            + "; ".join(problems) + "."
        )
    return {
        "model": s[model_f],
        "price_in": s[price_in_f],
        "price_out": s[price_out_f],
        "reply_max_tokens": s[cap_f],
        "calls_at_once": s["match_calls_at_once"],
        "retry_wait_s": s["match_retry_wait_s"],
        "burst_failures": s["match_burst_failures"],
        "burst_window_s": s["match_burst_window_s"],
        "cost_cap_usd": s["match_cost_cap_usd"],
        "request_timeout_seconds": get_boq_ai_settings().get("request_timeout_seconds"),
    }
