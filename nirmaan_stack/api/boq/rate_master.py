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
import re

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
from nirmaan_stack.services.boq_rate_master import loader  # noqa: E402  (RM-4a: reuse _canonicalize_attributes)
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


# ── RM-4a: rate-master EDITING (admin-only; owner option (a) -- Estimates is READ-ONLY) ──────────
# Four POST-whitelisted write endpoints. Every one gates on the IMPORTED pricing._is_nirmaan_admin
# (never a third copy), with the admin gate BEFORE any target resolution or write (PermissionError on
# failure). PARAM VALUES ONLY: editing pipeline STRUCTURE, conditions, or attribute definitions is
# RM-4b -- a mis-addressed / non-existent path is a validation error, NOT a create. The AUDITED write
# recipe is doc.save (get_doc -> mutate the parsed dict -> json.dumps -> doc.save -> commit): both
# doctypes carry track_changes:1 and DICT-valued JSON only (config / attributes / rates -- no
# BoQ-Sheet-style list-valued field), so doc.save is safe AND records a Version diff. set_value is
# FORBIDDEN for these edits -- it bypasses the doc lifecycle, so it would skip the Version audit.
_MANUAL_BATCH_PREFIX = "manual-"
_MANUAL_SOURCE_SHEET = "Manual entry"


def _require_rate_admin():
    """Admin gate for the RM-4a editors -- BEFORE any resolution/write. Reuses the wizard's
    pricing._is_nirmaan_admin (Administrator OR Nirmaan Admin Profile); never a re-minted copy."""
    user = frappe.session.user
    if not pricing._is_nirmaan_admin(user):
        frappe.throw(
            "Only an admin may edit the rate master.",
            frappe.PermissionError,
            title="Not permitted",
        )
    return user


def _finite_number(value, label):
    """Parse value to a finite float (int/float/numeric-string). Rejects None/bool/NaN/Inf and
    non-numeric strings -- numeric-only param/rate values (RM-4a edits values, never types)."""
    if isinstance(value, bool) or value is None:
        frappe.throw(f"{label} must be a number.", title="Invalid value")
    try:
        num = float(value)
    except (TypeError, ValueError):
        frappe.throw(f"{label} must be a number (got {value!r}).", title="Invalid value")
    if num != num or num in (float("inf"), float("-inf")):
        frappe.throw(f"{label} must be a finite number.", title="Invalid value")
    return num


def _active_config_attr_ids(discipline):
    """Union of attribute-definition ids across the ACTIVE category config(s) for a discipline, or
    None when no active config exists (attribute-key validation is skipped 'where determinable')."""
    rows = frappe.get_all(
        CONFIG_DOCTYPE, filters={"discipline": discipline, "active": 1}, fields=["config"]
    )
    if not rows:
        return None
    ids = set()
    for r in rows:
        cfg = _parse_json(r["config"], {})
        for d in cfg.get("attribute_definitions", []) or []:
            if isinstance(d, dict) and d.get("id"):
                ids.add(d["id"])
    return ids


@frappe.whitelist(methods=["POST"])
def update_rate_config_param(
    name=None, pipeline_id=None, step_index=None, param_key=None, new_value=None,
    condition_index=None,
):
    """ADMIN-ONLY: set ONE existing numeric parameter on a stored pipeline step (or a step's
    condition branch). PARAM VALUES ONLY -- the addressed path MUST already exist; creating/removing
    params or steps is RM-4b (validation error, no write). Audited (doc.save -> Version diff).
    Path: config.pipelines[pipeline_id].steps[step_index].params[param_key], or
          ...steps[step_index].conditions[condition_index].params[param_key].
    Returns {ok, config}. URL: .../rate_master.update_rate_config_param"""
    _require_rate_admin()  # BEFORE resolution/write
    if not name:
        frappe.throw("name is required.", title="Missing field: name")
    if not pipeline_id:
        frappe.throw("pipeline_id is required.", title="Missing field: pipeline_id")
    if step_index is None or step_index == "":
        frappe.throw("step_index is required.", title="Missing field: step_index")
    if not param_key:
        frappe.throw("param_key is required.", title="Missing field: param_key")
    num = _finite_number(new_value, "new_value")
    try:
        step_index = int(step_index)
    except (TypeError, ValueError):
        frappe.throw("step_index must be an integer.", title="Invalid value")
    has_cond = condition_index is not None and condition_index != ""
    if has_cond:
        try:
            condition_index = int(condition_index)
        except (TypeError, ValueError):
            frappe.throw("condition_index must be an integer.", title="Invalid value")

    doc = frappe.get_doc(CONFIG_DOCTYPE, name)  # 404s cleanly if missing
    cfg = _parse_json(doc.config, {})
    pipelines = cfg.get("pipelines") or {}
    if pipeline_id not in pipelines:
        frappe.throw(f"Pipeline '{pipeline_id}' not found in this config.", title="Path not found")
    steps = pipelines[pipeline_id].get("steps") or []
    if not (0 <= step_index < len(steps)):
        frappe.throw(f"step_index {step_index} out of range.", title="Path not found")
    step = steps[step_index]
    if has_cond:
        conditions = step.get("conditions") or []
        if not (0 <= condition_index < len(conditions)):
            frappe.throw(
                f"condition_index {condition_index} out of range.", title="Path not found"
            )
        params = conditions[condition_index].get("params")
    else:
        params = step.get("params")
    if not isinstance(params, dict) or param_key not in params:
        # The param must ALREADY exist -- creating a param is structure editing (RM-4b).
        frappe.throw(
            f"Parameter '{param_key}' does not exist at this path -- adding parameters is not "
            "supported here.",
            title="Path not found",
        )
    params[param_key] = num
    doc.config = json.dumps(cfg)
    doc.save(ignore_permissions=True, ignore_version=False)  # AUDITED (track_changes -> Version diff)
    frappe.db.commit()
    return {"ok": True, "config": cfg}


@frappe.whitelist(methods=["POST"])
def update_rate_master_item(name=None, rates_patch=None, attributes_patch=None):
    """ADMIN-ONLY: merge a rates_patch and/or attributes_patch onto an item's existing JSON dicts.
    Rate values numeric-or-null; attribute keys validated against the discipline's active config
    attribute-definitions where determinable, and material/insulation canonicalised to UPPERCASE.
    Audited (doc.save). Returns {ok, item}. URL: .../rate_master.update_rate_master_item"""
    _require_rate_admin()  # BEFORE resolution/write
    if not name:
        frappe.throw("name is required.", title="Missing field: name")
    rates_patch = _parse_json(rates_patch, None)
    attributes_patch = _parse_json(attributes_patch, None)
    if not rates_patch and not attributes_patch:
        frappe.throw(
            "Provide a rates_patch and/or attributes_patch.", title="Nothing to update"
        )
    if rates_patch is not None and not isinstance(rates_patch, dict):
        frappe.throw("rates_patch must be an object.", title="Invalid value")
    if attributes_patch is not None and not isinstance(attributes_patch, dict):
        frappe.throw("attributes_patch must be an object.", title="Invalid value")

    doc = frappe.get_doc(ITEM_DOCTYPE, name)  # 404s cleanly if missing
    rates = _parse_json(doc.rates, {}) or {}
    attributes = _parse_json(doc.attributes, {}) or {}

    if rates_patch:
        for k, v in rates_patch.items():
            if v is None:
                rates[k] = None  # numeric-OR-NULL
            else:
                rates[k] = _finite_number(v, f"rates.{k}")
    if attributes_patch:
        known = _active_config_attr_ids(doc.discipline)
        merged = dict(attributes)
        for k, v in attributes_patch.items():
            if known is not None and k not in known:
                frappe.throw(
                    f"Unknown attribute '{k}' for discipline '{doc.discipline}'.",
                    title="Invalid attribute",
                )
            merged[k] = v
        attributes = loader._canonicalize_attributes(merged)  # material/insulation -> UPPERCASE

    doc.rates = json.dumps(rates)
    doc.attributes = json.dumps(attributes)
    doc.save(ignore_permissions=True, ignore_version=False)  # AUDITED
    frappe.db.commit()
    return {
        "ok": True,
        "item": {
            "name": doc.name,
            "discipline": doc.discipline,
            "kind": doc.kind,
            "brand": doc.brand,
            "unit": doc.unit,
            "attributes": _parse_json(doc.attributes, {}),
            "rates": _parse_json(doc.rates, {}),
            "active": doc.active,
        },
    }


@frappe.whitelist(methods=["POST"])
def create_rate_master_item(
    discipline=None, kind=None, brand=None, unit=None, attributes=None, rates=None
):
    """ADMIN-ONLY: insert a new ACTIVE item row with MANUAL provenance (import_batch='manual-'+hash,
    source_sheet='Manual entry', source_row=0). Attribute keys validated against the discipline's
    active config where determinable; material/insulation canonicalised to UPPERCASE; rate values
    numeric-or-null. Audited on insert. Returns {ok, item}.
    URL: .../rate_master.create_rate_master_item"""
    _require_rate_admin()  # BEFORE resolution/write
    if not discipline:
        frappe.throw("discipline is required.", title="Missing field: discipline")
    if not kind:
        frappe.throw("kind is required.", title="Missing field: kind")
    attributes = _parse_json(attributes, {}) or {}
    rates = _parse_json(rates, {}) or {}
    if not isinstance(attributes, dict):
        frappe.throw("attributes must be an object.", title="Invalid value")
    if not isinstance(rates, dict):
        frappe.throw("rates must be an object.", title="Invalid value")
    known = _active_config_attr_ids(discipline)
    if known is not None:
        for k in attributes:
            if k not in known:
                frappe.throw(
                    f"Unknown attribute '{k}' for discipline '{discipline}'.",
                    title="Invalid attribute",
                )
    clean_rates = {}
    for k, v in rates.items():
        clean_rates[k] = None if v is None else _finite_number(v, f"rates.{k}")
    attrs = loader._canonicalize_attributes(attributes)  # material/insulation -> UPPERCASE

    doc = frappe.get_doc(
        {
            "doctype": ITEM_DOCTYPE,
            "discipline": discipline,
            "kind": kind.strip(),
            "brand": brand,
            "unit": unit,
            "attributes": json.dumps(attrs),
            "rates": json.dumps(clean_rates),
            "source_sheet": _MANUAL_SOURCE_SHEET,
            "source_row": 0,
            "import_batch": _MANUAL_BATCH_PREFIX + frappe.generate_hash(length=12),
            "active": 1,
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {
        "ok": True,
        "item": {
            "name": doc.name,
            "discipline": doc.discipline,
            "kind": doc.kind,
            "brand": doc.brand,
            "unit": doc.unit,
            "attributes": _parse_json(doc.attributes, {}),
            "rates": _parse_json(doc.rates, {}),
            "source_sheet": doc.source_sheet,
            "source_row": doc.source_row,
            "import_batch": doc.import_batch,
            "active": doc.active,
        },
    }


@frappe.whitelist(methods=["POST"])
def deactivate_rate_master_item(name=None):
    """ADMIN-ONLY: set active=0 on an item (freeze-and-supersede -- the row is RETAINED, NEVER
    deleted). Idempotent. Audited (doc.save). Returns {ok, active:0}.
    URL: .../rate_master.deactivate_rate_master_item"""
    _require_rate_admin()  # BEFORE resolution/write
    if not name:
        frappe.throw("name is required.", title="Missing field: name")
    doc = frappe.get_doc(ITEM_DOCTYPE, name)  # 404s cleanly if missing
    if doc.active:
        doc.active = 0
        doc.save(ignore_permissions=True, ignore_version=False)  # AUDITED
        frappe.db.commit()
    return {"ok": True, "active": 0}


# ── RM-4b: rate-master STRUCTURE EDITING (admin-only) ─────────────────────────────────────────────
# ONE whole-config replace endpoint: update_rate_config(name, config). This LIFTS the RM-4a
# "PARAM VALUES ONLY" boundary -- creating/deleting params, steps, conditions, and attribute
# definitions is now in scope. The submitted config is STRUCTURALLY VALIDATED server-side BEFORE any
# write (admin gate first): known step types only (the interpreter vocabulary); params dicts of finite
# numbers; conditions + component_band bands well-formed; attribute_definitions well-formed; a
# REFERENCE GUARD rejects removing a definition any pipeline references; no unknown top-level keys.
# The interpreter's EXECUTION semantics are OUT OF SCOPE and untouched -- validation accepts exactly the
# shapes the pure interpreter (ratePipelineInterpreter.ts) executes: a condition `when` is
# {attribute: scalar} EXACT-match (the only stored + executable shape -- range/in predicate OBJECTS are
# rejected, since the interpreter would silently never match them), and component_band bands are
# comparator strings ('<35' / '>=35'). Valid -> the audited doc.save recipe (Version diff). Invalid ->
# a named validation error, NO write. GOLDENS live in the config as a "goldens" array (attrs + expected
# finals per pipeline); the frontend preview gate computes them against a draft before save.
_KNOWN_STEP_TYPES = {
    "match_master_row", "apply_effective_multiplier", "scale", "roundup",
    "component", "component_ref", "component_band", "sum_components", "install_as_ratio",
}
_KNOWN_CONFIG_KEYS = {
    "discipline", "category_id", "category_display", "pairing_rule",
    "attribute_definitions", "pipelines", "bcs_surfacing", "normalization_rule", "goldens",
    "item_kinds",  # EA-1c: the category's master-item kinds (Data-tab scoping); pass-through, not validated
    # EA-2 pass-through keys (stored VERBATIM, NOT structurally validated -- exactly like item_kinds).
    # An item-identity config carries identity_attribute_id + matching_mode + notes, and the helper
    # reads pipeline_labels; the RM-4b editor resubmits the WHOLE config, so these must be accepted or
    # editing/authoring an EA-2 config would be rejected as an unknown key.
    "identity_attribute_id", "matching_mode", "notes", "pipeline_labels",
    # EA-DIFF: synonyms = {attr_id: {variant: canonical}} (e.g. conduit_type GI->MS). Pass-through;
    # consumed by the extraction injection + coercion, never structurally validated here.
    "synonyms",
}
_BAND_WHEN_RE = re.compile(r"^(<=|>=|<|>)\s*-?\d+(\.\d+)?$")


def _is_finite_number(v):
    """True only for a real finite int/float (rejects bool, None, NaN, +/-Inf, strings)."""
    if isinstance(v, bool) or v is None or not isinstance(v, (int, float)):
        return False
    return v == v and v not in (float("inf"), float("-inf"))


def _vthrow(msg):
    frappe.throw(msg, title="Invalid config")


def _validate_params(params, where):
    if not isinstance(params, dict):
        _vthrow(f"{where}: params must be an object.")
    for k, v in params.items():
        if not _is_finite_number(v):
            _vthrow(f"{where}: parameter '{k}' must be a finite number.")


def _validate_config(cfg):
    """Full structural validation of a whole category config. Returns the map of attribute id ->
    referencing-locations (for the reference guard). Raises a named frappe.ValidationError on the first
    problem; the caller writes NOTHING on a raise."""
    if not isinstance(cfg, dict):
        _vthrow("config must be an object.")
    unknown = set(cfg.keys()) - _KNOWN_CONFIG_KEYS
    if unknown:
        _vthrow(f"Unknown top-level config key(s): {', '.join(sorted(unknown))}.")

    # attribute_definitions ------------------------------------------------------------------
    defs = cfg.get("attribute_definitions")
    if not isinstance(defs, list):
        _vthrow("attribute_definitions must be a list.")
    def_ids = set()
    for i, d in enumerate(defs):
        if not isinstance(d, dict):
            _vthrow(f"attribute_definitions[{i}] must be an object.")
        did = d.get("id")
        if not isinstance(did, str) or not did.strip():
            _vthrow(f"attribute_definitions[{i}] needs a non-empty string id.")
        if did in def_ids:
            _vthrow(f"Duplicate attribute definition id '{did}'.")
        def_ids.add(did)
        if not isinstance(d.get("label"), str) or not d.get("label"):
            _vthrow(f"attribute definition '{did}' needs a label.")
        if d.get("type") not in ("choice", "number"):
            _vthrow(f"attribute definition '{did}' type must be 'choice' or 'number'.")
        if d.get("type") == "choice" and (not isinstance(d.get("values"), list) or not d.get("values")):
            _vthrow(f"choice attribute '{did}' needs a non-empty values list.")

    # pipelines ------------------------------------------------------------------------------
    # EA-2: an EMPTY pipelines dict is ACCEPTED -- a DATA-ONLY config (definitions + items, no
    # derivation yet), the owner's in-system authoring path (e.g. lighting_mgmt_system). A NON-empty
    # pipelines object is still validated fully, pipeline by pipeline, below.
    pipelines = cfg.get("pipelines")
    if not isinstance(pipelines, dict):
        _vthrow("pipelines must be an object.")
    referenced = {}  # attr id -> [locations] (for the reference guard's named error)

    def _ref(attr, loc):
        referenced.setdefault(attr, []).append(loc)

    for pid, p in pipelines.items():
        if not isinstance(p, dict):
            _vthrow(f"pipeline '{pid}' must be an object.")
        if not isinstance(p.get("output"), list) or not all(isinstance(o, str) for o in p["output"]):
            _vthrow(f"pipeline '{pid}': output must be a list of strings.")
        steps = p.get("steps")
        if not isinstance(steps, list) or not steps:
            _vthrow(f"pipeline '{pid}': steps must be a non-empty list.")
        for si, s in enumerate(steps):
            where = f"pipeline '{pid}' step {si}"
            if not isinstance(s, dict):
                _vthrow(f"{where}: must be an object.")
            st = s.get("step")
            if st not in _KNOWN_STEP_TYPES:
                _vthrow(f"{where}: unknown step type '{st}'.")
            if st == "match_master_row":
                params = s.get("params")
                if not isinstance(params, dict) or not isinstance(params.get("kind"), str) or not params.get("kind"):
                    _vthrow(f"{where}: match_master_row needs params.kind (a string).")
            elif st == "apply_effective_multiplier":
                for key in ("target", "result", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: apply_effective_multiplier needs a string '{key}'.")
                conds = s.get("conditions")
                if not isinstance(conds, list) or not conds:
                    _vthrow(f"{where}: needs a non-empty conditions list.")
                for ci, c in enumerate(conds):
                    if not isinstance(c, dict):
                        _vthrow(f"{where} condition {ci}: must be an object.")
                    when = c.get("when")
                    if not isinstance(when, dict) or not when:
                        _vthrow(f"{where} condition {ci}: 'when' must be a non-empty object of attribute = value.")
                    for wk, wv in when.items():
                        if isinstance(wv, (dict, list)):
                            _vthrow(
                                f"{where} condition {ci}: predicate '{wk}' must be an exact value "
                                "(attribute = value); range/in predicates are not executable."
                            )
                        _ref(wk, f"{where} condition {ci}")
                    _validate_params(c.get("params"), f"{where} condition {ci}")
            elif st == "scale":
                for key in ("target", "result", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: scale needs a string '{key}'.")
                _validate_params(s.get("params"), where)
            elif st == "roundup":
                if not isinstance(s.get("target"), str) or not s.get("target"):
                    _vthrow(f"{where}: roundup needs a string 'target'.")
                params = s.get("params")
                if not isinstance(params, dict) or not _is_finite_number(params.get("digits")):
                    _vthrow(f"{where}: roundup needs params.digits (a finite number).")
            elif st == "component":
                for key in ("name", "target", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: component needs a string '{key}'.")
                _validate_params(s.get("params"), where)
            elif st == "component_ref":
                # EA-2c: base from a referenced master row (ref.kind + optional ref.attributes), else
                # the component contract. Top-level params OPTIONAL (a conditional ref carries none).
                for key in ("name", "target", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: component_ref needs a string '{key}'.")
                ref = s.get("ref")
                if not isinstance(ref, dict) or not isinstance(ref.get("kind"), str) or not ref.get("kind"):
                    _vthrow(f"{where}: component_ref needs ref.kind (a string).")
                ref_attrs = ref.get("attributes")
                if ref_attrs is not None:
                    if not isinstance(ref_attrs, dict):
                        _vthrow(f"{where}: component_ref ref.attributes must be an object of attribute = value.")
                    for ak, av in ref_attrs.items():
                        if isinstance(av, (dict, list)):
                            _vthrow(f"{where}: component_ref ref.attributes['{ak}'] must be an exact value.")
                if s.get("params") is not None:
                    _validate_params(s.get("params"), where)
                conds = s.get("conditions")
                if conds is not None:
                    if not isinstance(conds, list):
                        _vthrow(f"{where}: component_ref conditions must be a list.")
                    for ci, c in enumerate(conds):
                        if not isinstance(c, dict):
                            _vthrow(f"{where} condition {ci}: must be an object.")
                        when = c.get("when")
                        if not isinstance(when, dict) or not when:
                            _vthrow(f"{where} condition {ci}: 'when' must be a non-empty object of attribute = value.")
                        for wk, wv in when.items():
                            if isinstance(wv, (dict, list)):
                                _vthrow(
                                    f"{where} condition {ci}: predicate '{wk}' must be an exact value "
                                    "(attribute = value); range/in predicates are not executable."
                                )
                            _ref(wk, f"{where} condition {ci}")
                        _validate_params(c.get("params"), f"{where} condition {ci}")
            elif st == "component_band":
                for key in ("name", "band_on", "formula"):
                    if not isinstance(s.get(key), str) or not s.get(key):
                        _vthrow(f"{where}: component_band needs a string '{key}'.")
                _ref(s["band_on"], f"{where} (band_on)")
                bands = s.get("bands")
                if not isinstance(bands, list) or not bands:
                    _vthrow(f"{where}: component_band needs a non-empty bands list.")
                for bi, b in enumerate(bands):
                    if not isinstance(b, dict):
                        _vthrow(f"{where} band {bi}: must be an object.")
                    if not isinstance(b.get("when"), str) or not _BAND_WHEN_RE.match(b["when"].strip()):
                        _vthrow(f"{where} band {bi}: 'when' must be a comparator like '<35' or '>=35'.")
                    if not isinstance(b.get("target"), str) or not b.get("target"):
                        _vthrow(f"{where} band {bi}: needs a string 'target'.")
                _validate_params(s.get("params"), where)
            elif st == "sum_components":
                if not isinstance(s.get("result"), str) or not s.get("result"):
                    _vthrow(f"{where}: sum_components needs a string 'result'.")
            elif st == "install_as_ratio":
                if not isinstance(s.get("result"), str) or not s.get("result"):
                    _vthrow(f"{where}: install_as_ratio needs a string 'result'.")
                params = s.get("params")
                if not isinstance(params, dict) or not _is_finite_number(params.get("ratio")):
                    _vthrow(f"{where}: install_as_ratio needs params.ratio (a finite number).")

    # REFERENCE GUARD: every attr a pipeline references must be defined (names where each is used) ----
    missing = {a: locs for a, locs in referenced.items() if a not in def_ids}
    if missing:
        parts = [f"'{a}' (referenced by {', '.join(locs)})" for a, locs in sorted(missing.items())]
        _vthrow(
            "These attributes are referenced by a pipeline but not defined: "
            + "; ".join(parts)
            + ". Add the definition, or remove the references first."
        )

    # goldens (optional) ---------------------------------------------------------------------
    goldens = cfg.get("goldens")
    if goldens is not None:
        if not isinstance(goldens, list):
            _vthrow("goldens must be a list.")
        for gi, g in enumerate(goldens):
            if not isinstance(g, dict):
                _vthrow(f"goldens[{gi}] must be an object.")
            if not isinstance(g.get("attrs"), dict) or not g.get("attrs"):
                _vthrow(f"goldens[{gi}] needs a non-empty attrs object.")
            expect = g.get("expect")
            if not isinstance(expect, dict) or not expect:
                _vthrow(f"goldens[{gi}] needs a non-empty expect object.")
            for epid, emap in expect.items():
                if epid not in pipelines:
                    _vthrow(f"goldens[{gi}] expects unknown pipeline '{epid}'.")
                if not isinstance(emap, dict) or not emap:
                    _vthrow(f"goldens[{gi}] expect['{epid}'] must be a non-empty object.")
                for ek, ev in emap.items():
                    if not _is_finite_number(ev):
                        _vthrow(f"goldens[{gi}] expect['{epid}']['{ek}'] must be a finite number.")

    return referenced


@frappe.whitelist(methods=["POST"])
def update_rate_config(name=None, config=None):
    """ADMIN-ONLY (RM-4b): replace a category config's WHOLE config JSON after full server-side
    structural validation. Lifts the RM-4a param-values-only boundary -- add/remove params, steps,
    conditions, and attribute definitions. The submitted config.discipline/category_id must match the
    stored doc's (no identity repoint). Audited (doc.save -> Version diff). Returns {ok, config}.
    URL: .../rate_master.update_rate_config"""
    _require_rate_admin()  # BEFORE resolution/write
    if not name:
        frappe.throw("name is required.", title="Missing field: name")
    cfg = _parse_json(config, None)
    if not isinstance(cfg, dict):
        frappe.throw("config must be an object.", title="Invalid value")

    doc = frappe.get_doc(CONFIG_DOCTYPE, name)  # 404s cleanly if missing
    # identity guard: the submitted config must not repoint discipline/category_id
    if cfg.get("discipline") != doc.discipline:
        frappe.throw(
            f"config.discipline '{cfg.get('discipline')}' does not match this config's discipline "
            f"'{doc.discipline}'.",
            title="Invalid config",
        )
    if cfg.get("category_id") != doc.category_id:
        frappe.throw(
            f"config.category_id '{cfg.get('category_id')}' does not match this config's category_id "
            f"'{doc.category_id}'.",
            title="Invalid config",
        )

    _validate_config(cfg)  # raises a named ValidationError on any problem -- NO write on raise

    doc.config = json.dumps(cfg)
    doc.save(ignore_permissions=True, ignore_version=False)  # AUDITED (track_changes -> Version diff)
    frappe.db.commit()
    return {"ok": True, "config": cfg}
