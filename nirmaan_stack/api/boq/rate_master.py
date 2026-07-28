# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rate-master READ endpoints (RM-1).

Two login-required, active-only read endpoints over the RM-1 doctypes:
  - get_rate_master_items(discipline, kind=None) -> active items for the discipline (+kind).
  - get_rate_category_config(discipline, category_id) -> the active per-category config.

RM-1 ships NO write endpoint -- the import runs service-side (services/boq_rate_master/loader.py)
and the editors are RM-4. (Deliberately avoids `from frappe import _` to sidestep translator
shadowing; user-facing strings are passed plain.)
"""

import json

import frappe

ITEM_DOCTYPE = "BoQ Rate Master Item"
CONFIG_DOCTYPE = "BoQ Rate Category Config"


def _require_login():
    """Reject unauthenticated (Guest) callers. The HTTP layer already blocks Guest for a
    non-allow_guest whitelist method; this makes the guard explicit + unit-testable."""
    if frappe.session.user in (None, "", "Guest"):
        frappe.throw("Login required.", frappe.PermissionError)


def _parse_json(value, default):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


@frappe.whitelist()
def get_rate_master_items(discipline=None, kind=None):
    """Active rate-master items for a discipline, optionally narrowed to a kind. Attributes +
    rates are returned as parsed objects."""
    _require_login()
    if not discipline:
        frappe.throw("discipline is required.")

    filters = {"discipline": discipline, "active": 1}
    if kind:
        filters["kind"] = kind

    rows = frappe.get_all(
        ITEM_DOCTYPE,
        filters=filters,
        fields=[
            "name",
            "discipline",
            "kind",
            "brand",
            "unit",
            "attributes",
            "rates",
            "source_sheet",
            "source_row",
            "import_batch",
        ],
        order_by="kind asc, source_row asc",
    )
    for r in rows:
        r["attributes"] = _parse_json(r.get("attributes"), {})
        r["rates"] = _parse_json(r.get("rates"), {})

    return {
        "discipline": discipline,
        "kind": kind,
        "count": len(rows),
        "items": rows,
    }


@frappe.whitelist()
def get_rate_category_config(discipline=None, category_id=None):
    """The active per-category config for (discipline, category_id). config is parsed. Returns
    config=None when no active config exists."""
    _require_login()
    if not discipline or not category_id:
        frappe.throw("discipline and category_id are required.")

    rows = frappe.get_all(
        CONFIG_DOCTYPE,
        filters={"discipline": discipline, "category_id": category_id, "active": 1},
        fields=["name", "discipline", "category_id", "config", "source_workbook", "import_batch"],
        order_by="modified desc",
        limit=1,
    )
    if not rows:
        return {"discipline": discipline, "category_id": category_id, "config": None}

    row = rows[0]
    row["config"] = _parse_json(row.get("config"), None)
    return row


# ══════════════════════════════════════════════════════════════════════════════════════
# RM-3: the suggest-run skeleton (CLONED from api/boq/wizard/classify.py) + run read +
# telemetry write. The extraction itself lives in services/boq_rate_master/extraction.py;
# this file is the thin orchestration (enqueue -> worker -> Redis marker/terminal -> realtime),
# the active-run read, and the fire-and-forget Use-telemetry insert.
# ══════════════════════════════════════════════════════════════════════════════════════

from frappe.utils.background_jobs import get_job_status  # noqa: E402

from nirmaan_stack.services.boq_rate_master import extraction  # noqa: E402
from nirmaan_stack.api.boq.wizard import pricing  # noqa: E402  (D8 gate reuse; import UP api->api)

RUN_DOCTYPE = "BoQ Rate Suggestion Run"
EVENT_DOCTYPE = "BoQ Rate Suggestion Event"
_BOQ_SHEET = "BoQ Sheet"

_S_STATUS_PREFIX = "boq_suggest_status"
_S_MARKER_PREFIX = "boq_suggest_marker"
_S_STATUS_TTL_SEC = 3600
_S_MARKER_TTL_SEC = 3600
_STALE_SUGGEST_SECONDS = 1200  # mirrors classify._STALE_CLASSIFY_SECONDS


# ── Redis key + marker helpers (per (boq, sheet_name)) ──────────────────────────────
def _s_status_key(boq, sheet_name):
    return f"{_S_STATUS_PREFIX}::{boq}::{sheet_name}"


def _s_marker_key(boq, sheet_name):
    return f"{_S_MARKER_PREFIX}::{boq}::{sheet_name}"


def _s_set_marker(boq, sheet_name, job_id, user):
    frappe.cache().set_value(
        _s_marker_key(boq, sheet_name),
        {"job_id": job_id, "enqueued_at": frappe.utils.now(), "user": user},
        expires_in_sec=_S_MARKER_TTL_SEC,
    )


def _s_get_marker(boq, sheet_name):
    return frappe.cache().get_value(_s_marker_key(boq, sheet_name))


def _s_clear_marker(boq, sheet_name):
    frappe.cache().delete_value(_s_marker_key(boq, sheet_name))


def _s_update_marker_progress(boq, sheet_name, done, total):
    marker = _s_get_marker(boq, sheet_name)
    if not marker:
        return
    marker["done"] = done
    marker["total"] = total
    frappe.cache().set_value(_s_marker_key(boq, sheet_name), marker, expires_in_sec=_S_MARKER_TTL_SEC)


def _s_maybe_self_heal(boq, sheet_name, marker):
    """'running' | 'cleared' | 'cleared_stale' -- mirrors classify._maybe_self_heal."""
    job_id = marker.get("job_id")
    status = None
    if job_id:
        try:
            status = get_job_status(job_id)
        except Exception:
            status = None
    if status in ("finished", "failed") or status is None:
        _s_clear_marker(boq, sheet_name)
        return "cleared"
    enqueued_at = marker.get("enqueued_at")
    if enqueued_at:
        try:
            age = frappe.utils.time_diff_in_seconds(frappe.utils.now(), enqueued_at)
        except Exception:
            age = 0
        if age > _STALE_SUGGEST_SECONDS:
            _s_clear_marker(boq, sheet_name)
            return "cleared_stale"
    return "running"


def _resolve_committed_version(boq, sheet_name):
    """Current committed sheet's commit_version, or None when not committed. sheet_name VERBATIM #152."""
    rows = frappe.get_all(
        _BOQ_SHEET,
        filters={"boq": boq, "sheet_name": sheet_name, "is_current": 1},
        fields=["commit_version"],
    )
    return rows[0]["commit_version"] if rows else None


def _guard_suggest_gate(boq, sheet_name, committed_version):
    """The D8 chain, re-checked SERVER-SIDE at the endpoint (the client mirror is UX only):
    committed + not locked + formulas complete + category gate open. Throws on any failure so a
    direct API call cannot bypass the same gate rate writes obey."""
    if pricing._get_sheet_is_locked(boq, sheet_name, committed_version):
        frappe.throw("Sheet is locked / read-only.", title="Locked")
    if not pricing._sheet_formulas_complete(boq, sheet_name, committed_version):
        frappe.throw("Declare amount formulas first.", title="Formulas incomplete")
    if not pricing._categories_gate_ok(boq, sheet_name, committed_version):
        frappe.throw("Every eligible row needs a category first.", title="Category gate")


# ── Run skeleton ────────────────────────────────────────────────────────────────────
@frappe.whitelist(methods=["POST"])
def start_suggest(boq=None, sheet_name=None):
    """Enqueue a background rate-suggestion (attribute extraction) run for one committed sheet.
    Returns immediately. Re-checks the D8 gate server-side. URL:
    /api/method/nirmaan_stack.api.boq.rate_master.start_suggest"""
    _require_login()
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not frappe.db.exists("BOQs", boq):
        frappe.throw(f"BOQs '{boq}' not found.", title="Not found")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    cv = _resolve_committed_version(boq, sheet_name)
    if cv is None:
        frappe.throw(f"No current committed sheet '{sheet_name}' for this BoQ.", title="Sheet not committed")
    _guard_suggest_gate(boq, sheet_name, cv)

    marker = _s_get_marker(boq, sheet_name)
    if marker and _s_maybe_self_heal(boq, sheet_name, marker) == "running":
        frappe.throw(
            "A suggestion run is already in progress for this sheet. Wait for it to finish.",
            title="Suggest in progress",
        )

    raw_job_id = frappe.generate_hash(length=32)
    user = frappe.session.user
    frappe.enqueue(
        "nirmaan_stack.api.boq.rate_master._suggest_worker",
        queue="long",
        timeout=600,
        job_id=raw_job_id,
        user=user,
        boq=boq,
        sheet_name=sheet_name,
    )
    frappe.cache().delete_value(_s_status_key(boq, sheet_name))
    _s_set_marker(boq, sheet_name, raw_job_id, user)
    frappe.db.commit()
    return {"status": "queued", "job_id": raw_job_id}


def _suggest_worker(boq=None, sheet_name=None, user=None):
    """Background worker: run extraction, WRITE the Suggestion Run doc (prior active -> active=0) at
    terminal SUCCESS, commit BEFORE publish, record + publish the terminal payload. On failure,
    records a terminal error payload and clears the marker (never left stuck)."""
    job_id = None
    marker = _s_get_marker(boq, sheet_name)
    if marker:
        job_id = marker.get("job_id")

    def _progress(done, total):
        _s_update_marker_progress(boq, sheet_name, done, total)
        frappe.publish_realtime(
            "boq:suggest_sheet_progress",
            {"boq": boq, "sheet_name": sheet_name, "done": done, "total": total},
            **({"user": user} if user else {}),
        )

    try:
        env = extraction.run_extraction(boq, sheet_name, progress_cb=_progress)
        cv = env["committed_version"]
        ai_status = env["ai_status"]
        run_id = job_id or frappe.generate_hash(length=32)

        # Freeze-and-supersede: deactivate the prior active run(s) for this sheet, then insert.
        for prior in frappe.get_all(
            RUN_DOCTYPE, filters={"boq": boq, "sheet_name": sheet_name, "active": 1}, pluck="name"
        ):
            frappe.db.set_value(RUN_DOCTYPE, prior, "active", 0, update_modified=False)
        run = frappe.new_doc(RUN_DOCTYPE)
        run.boq = boq
        run.sheet_name = sheet_name  # VERBATIM (#152)
        run.committed_version = cv
        run.run_id = run_id
        run.ai_status = ai_status
        run.results = json.dumps(env["results"])
        run.run_by = user
        run.run_at = frappe.utils.now()
        run.active = 1
        run.insert(ignore_permissions=True)

        frappe.db.commit()  # commit BEFORE publish (CLAUDE.md rule)
        payload = {
            "status": "success",
            "boq": boq,
            "sheet_name": sheet_name,
            "committed_version": cv,
            "run_id": run_id,
            "ai_status": ai_status,
            "results": env["results"],
        }
    except Exception:
        frappe.db.rollback()
        frappe.log_error(title="BoQ suggest worker failed", message=frappe.get_traceback())
        payload = {
            "status": "error",
            "boq": boq,
            "sheet_name": sheet_name,
            "error_code": "suggest_failed",
        }
    frappe.cache().set_value(_s_status_key(boq, sheet_name), payload, expires_in_sec=_S_STATUS_TTL_SEC)
    _s_clear_marker(boq, sheet_name)
    frappe.publish_realtime(
        "boq:suggest_sheet_done", payload, **({"user": user} if user else {})
    )


@frappe.whitelist()
def get_suggest_status(boq=None, sheet_name=None):
    """Polling fallback for a suggest run, keyed by (boq, sheet_name). Same payload shape as the
    boq:suggest_sheet_done socket event. States: done | running(+done/total) | idle."""
    _require_login()
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    term = frappe.cache().get_value(_s_status_key(boq, sheet_name))
    if term:
        return {"state": "done", **term}
    marker = _s_get_marker(boq, sheet_name)
    if marker and _s_maybe_self_heal(boq, sheet_name, marker) == "running":
        out = {"state": "running"}
        if isinstance(marker.get("done"), int) and isinstance(marker.get("total"), int):
            out["done"] = marker["done"]
            out["total"] = marker["total"]
        return out
    return {"state": "idle"}


@frappe.whitelist()
def get_active_suggestion_run(boq=None, sheet_name=None):
    """The active BoQ Rate Suggestion Run for (boq, sheet_name), or run=None. Read-only, login
    required. Returns {run: {run_id, committed_version, ai_status, results, run_at} | None}. Version
    keying (does committed_version match the CURRENT sheet) is the CALLER's decision (the frontend
    compares against get_priced_rows' committed version); this returns the active run as-is."""
    _require_login()
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    rows = frappe.get_all(
        RUN_DOCTYPE,
        filters={"boq": boq, "sheet_name": sheet_name, "active": 1},
        fields=["run_id", "committed_version", "ai_status", "results", "run_at"],
        order_by="creation desc",
        limit=1,
    )
    if not rows:
        return {"run": None}
    r = rows[0]
    r["results"] = _parse_json(r.get("results"), [])
    return {"run": r}


@frappe.whitelist(methods=["POST"])
def record_rate_suggestion_event(
    boq=None, sheet_name=None, excel_row=None, col=None, kind=None, helper_id=None,
    category_id=None, run_id=None, extracted_attributes=None, extracted_confidences=None,
    corrected_attributes=None, computed_value=None, used_value=None,
):
    """Insert one immutable BoQ Rate Suggestion Event (the Use telemetry). Login required, fields
    validated. Fire-and-forget: the frontend logs a failure and NEVER blocks the save. Returns
    {ok, name}."""
    _require_login()
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if excel_row is None or excel_row == "":
        frappe.throw("excel_row is required.", title="Missing field: excel_row")

    def _as_text(v):
        if v is None:
            return None
        return v if isinstance(v, str) else json.dumps(v)

    doc = frappe.new_doc(EVENT_DOCTYPE)
    doc.boq = boq
    doc.sheet_name = sheet_name  # VERBATIM (#152)
    doc.excel_row = int(excel_row)
    doc.col = col
    doc.kind = kind
    doc.helper_id = helper_id
    doc.category_id = category_id
    doc.run_id = run_id
    doc.extracted_attributes = _as_text(extracted_attributes)
    doc.extracted_confidences = _as_text(extracted_confidences)
    doc.corrected_attributes = _as_text(corrected_attributes)
    if computed_value not in (None, ""):
        doc.computed_value = float(computed_value)
    if used_value not in (None, ""):
        doc.used_value = float(used_value)
    doc.event_user = frappe.session.user
    doc.used_at = frappe.utils.now()
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True, "name": doc.name}


@frappe.whitelist()
def get_suggestion_events(boq=None, sheet_name=None, run_id=None):
    """Used-state restore: the Use events for (boq, sheet_name), optionally pinned to a run_id.
    Read-only, login required. Returns {events:[{excel_row, col, kind, run_id}]} -- the (row, col)
    pairs the client marks 'used'."""
    _require_login()
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    filters = {"boq": boq, "sheet_name": sheet_name}
    if run_id:
        filters["run_id"] = run_id
    events = frappe.get_all(
        EVENT_DOCTYPE, filters=filters, fields=["excel_row", "col", "kind", "run_id"],
        order_by="creation asc",
    )
    return {"events": events}
