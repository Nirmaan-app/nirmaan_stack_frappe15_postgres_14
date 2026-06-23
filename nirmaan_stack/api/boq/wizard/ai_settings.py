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
from frappe.utils import cint

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
