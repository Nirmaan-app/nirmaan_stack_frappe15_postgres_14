# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Classifier endpoints + long worker + job plumbing (Classifier CL-1b).

Five whitelisted endpoints (list_engines / start_classify / get_classify_status /
get_sheet_categories / set_row_category) + the background worker, following the wizard's
canonical long-job pattern (parse_run.py): a raw 32-char job_id, an in-progress marker, a
commit BEFORE publish_realtime, a Redis fallback for a client that missed the socket, and a
self-heal reader with a stale-seconds cap.

DIVERGENCE from parse_run (disclosed): the in-progress marker + terminal payload live in
REDIS keyed by (boq, sheet_name, discipline), NOT in doctype fields. parse_run stores its
markers on BOQs / BoQ Sheet Draft columns; ai_assist stores ai_in_progress on BoQ Sheet
Draft. Classify runs on the COMMITTED tier (a committed sheet may have no live draft row) and
CL-1b adds NO doctype fields, so a per-sheet Redis marker is the schema-free equivalent that
still honours "per-sheet, not a single global flag".
"""

import json

import frappe
from frappe.utils.background_jobs import get_job_status

from nirmaan_stack.services.boq_category import engines, orchestrator, persist
from nirmaan_stack.services.boq_category.runner import load_ruleset

_ROW_CATEGORY = "BoQ Row Category"

_STATUS_PREFIX = "boq_classify_status"
_MARKER_PREFIX = "boq_classify_marker"
_STATUS_TTL_SEC = 3600  # 1h -- ample for a client to poll the fallback
_MARKER_TTL_SEC = 3600
_STALE_CLASSIFY_SECONDS = 1200  # mirrors parse_run._STALE_PARSE_SECONDS


# ── Redis key + marker helpers ───────────────────────────────────────────────────
def _status_key(boq, sheet_name, discipline):
    return f"{_STATUS_PREFIX}::{boq}::{sheet_name}::{discipline}"


def _marker_key(boq, sheet_name, discipline):
    return f"{_MARKER_PREFIX}::{boq}::{sheet_name}::{discipline}"


def _set_marker(boq, sheet_name, discipline, job_id, user):
    frappe.cache().set_value(
        _marker_key(boq, sheet_name, discipline),
        {"job_id": job_id, "enqueued_at": frappe.utils.now(), "user": user},
        expires_in_sec=_MARKER_TTL_SEC,
    )


def _get_marker(boq, sheet_name, discipline):
    return frappe.cache().get_value(_marker_key(boq, sheet_name, discipline))


def _clear_marker(boq, sheet_name, discipline):
    frappe.cache().delete_value(_marker_key(boq, sheet_name, discipline))


def _update_marker_progress(boq, sheet_name, discipline, done, total):
    """Merge per-batch done/total into the EXISTING in-progress marker, preserving
    job_id/enqueued_at/user and the marker TTL. A SIBLING of _set_marker (kept separate so the
    start-write signature stays minimal and the two sites don't drift). RE-READS the marker each
    call; if it is gone (expired or the run was already cleared) it SKIPS SILENTLY -- never
    re-creates a marker for a terminated job. done/total are ints (stored as-is)."""
    marker = _get_marker(boq, sheet_name, discipline)
    if not marker:
        return
    marker["done"] = done
    marker["total"] = total
    frappe.cache().set_value(
        _marker_key(boq, sheet_name, discipline),
        marker,
        expires_in_sec=_MARKER_TTL_SEC,
    )


def _maybe_self_heal(boq, sheet_name, discipline, marker):
    """Given a present marker, return 'running' | 'cleared' | 'cleared_stale'. Clears the marker
    when the RQ job is terminal (finished/failed/unknown) or the enqueue is older than the stale
    cap. Mirrors parse_run._maybe_self_heal_parse_state."""
    job_id = marker.get("job_id")
    status = None
    if job_id:
        try:
            status = get_job_status(job_id)
        except Exception:
            status = None
    if status in ("finished", "failed") or status is None:
        _clear_marker(boq, sheet_name, discipline)
        return "cleared"
    enqueued_at = marker.get("enqueued_at")
    if enqueued_at:
        try:
            age = frappe.utils.time_diff_in_seconds(frappe.utils.now(), enqueued_at)
        except Exception:
            age = 0
        if age > _STALE_CLASSIFY_SECONDS:
            _clear_marker(boq, sheet_name, discipline)
            return "cleared_stale"
    return "running"


def _resolve_committed_version(boq, sheet_name):
    """The current committed sheet's commit_version, or None when the sheet is not committed."""
    sheets = frappe.get_all(
        "BoQ Sheet",
        filters={"boq": boq, "sheet_name": sheet_name, "is_current": 1},
        fields=["commit_version"],
    )
    return sheets[0]["commit_version"] if sheets else None


# ── Endpoints ────────────────────────────────────────────────────────────────────
@frappe.whitelist()
def list_engines():
    """The engine registry the picker reads (the single source; nothing hardcodes names)."""
    return engines.list_available_engines()


@frappe.whitelist(methods=["POST"])
def start_classify(boq=None, sheet_name=None, discipline="Electrical", scope=None):
    """Enqueue a background classification run for one committed sheet. Returns immediately.

    scope = {"mode":"sheet"} or {"mode":"range","start":<int>,"end":<int>} (Excel rows).
    Validates: engine available (registry), the sheet is committed, and start<=end for a range.
    Sets a per-(boq,sheet,discipline) Redis in-progress marker AFTER a successful enqueue, then
    commits. URL: /api/method/nirmaan_stack.api.boq.wizard.classify.start_classify
    """
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not frappe.db.exists("BOQs", boq):
        frappe.throw(f"BOQs '{boq}' not found.", title="Not found")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    # Engine gate -- read through the registry, never a hardcoded name.
    if not engines.is_discipline_available(discipline):
        frappe.throw(
            f"Classification engine '{discipline}' is not available yet.", title="Engine unavailable"
        )

    if _resolve_committed_version(boq, sheet_name) is None:
        frappe.throw(
            f"No current committed sheet '{sheet_name}' for this BoQ.", title="Sheet not committed"
        )

    # scope may arrive as a JSON string from the HTTP POST body.
    if isinstance(scope, str):
        try:
            scope = json.loads(scope)
        except json.JSONDecodeError:
            scope = None
    scope = scope or {"mode": "sheet"}
    mode = scope.get("mode", "sheet")
    if mode == "range":
        try:
            start = int(scope["start"])
            end = int(scope["end"])
        except (KeyError, TypeError, ValueError):
            frappe.throw("A range scope needs integer 'start' and 'end' Excel rows.", title="Bad range")
        if start > end:
            frappe.throw(f"Range start ({start}) is after end ({end}).", title="Bad range")
        norm_scope = {"mode": "range", "start": start, "end": end}
    elif mode == "sheet":
        norm_scope = {"mode": "sheet"}
    else:
        frappe.throw(f"Unknown scope mode {mode!r}.", title="Bad scope")

    # Double-fire guard + self-heal.
    marker = _get_marker(boq, sheet_name, discipline)
    if marker and _maybe_self_heal(boq, sheet_name, discipline, marker) == "running":
        frappe.throw(
            "A classification run is already in progress for this sheet. "
            "Wait for it to finish before starting another.",
            title="Classify in progress",
        )

    # Raw (un-namespaced) job id -- frappe.enqueue namespaces internally; get_job_status
    # re-namespaces on read, so the RAW id is what we store (parse_run convention).
    raw_job_id = frappe.generate_hash(length=32)
    user = frappe.session.user
    frappe.enqueue(
        "nirmaan_stack.api.boq.wizard.classify._classify_worker",
        queue="long",
        timeout=600,
        job_id=raw_job_id,
        user=user,
        boq=boq,
        sheet_name=sheet_name,
        discipline=discipline,
        scope=norm_scope,
    )
    # Clear any stale terminal payload from a prior run, set the marker, commit -- all AFTER a
    # successful enqueue so a failed enqueue never leaves state stuck.
    frappe.cache().delete_value(_status_key(boq, sheet_name, discipline))
    _set_marker(boq, sheet_name, discipline, raw_job_id, user)
    frappe.db.commit()
    return {"status": "queued", "job_id": raw_job_id}


def _classify_worker(boq=None, sheet_name=None, discipline="Electrical", scope=None, user=None):
    """Background worker: orchestrate the run, commit, then record + publish the terminal payload.
    On any failure, records a terminal error payload and clears the marker (never left stuck)."""
    row_filter = None
    if scope and scope.get("mode") == "range":
        row_filter = (int(scope["start"]), int(scope["end"]))

    def _progress(done, total):
        # Incremental progress, emitted once per 20-row AI batch. No DB dependency (transient
        # counts only), so no commit-before-publish is needed. The terminal boq:classify_sheet_done
        # is unchanged. TWO sinks now: (1) the marker carries done/total so the get_classify_status
        # poll can drive the progress bar (the socket is unreliable in some deployments); (2) the
        # additive realtime event stays as-is.
        _update_marker_progress(boq, sheet_name, discipline, done, total)
        _publish_classify_progress(boq, sheet_name, discipline, user, done, total)

    try:
        summary = orchestrator.classify_sheet_rows(
            boq, sheet_name, discipline, row_filter=row_filter, progress_cb=_progress
        )
        frappe.db.commit()  # commit BEFORE publish (CLAUDE.md rule)
        payload = {
            "status": "success",
            "boq_name": boq,
            "sheet_name": sheet_name,
            "discipline": discipline,
            **summary,
        }
    except Exception:
        frappe.db.rollback()
        frappe.log_error(title="BoQ classify worker failed", message=frappe.get_traceback())
        payload = {
            "status": "error",
            "boq_name": boq,
            "sheet_name": sheet_name,
            "discipline": discipline,
            "error_code": "classify_failed",
        }
    _publish_classify_event(boq, sheet_name, discipline, user, payload)


def _publish_classify_progress(boq, sheet_name, discipline, user, done, total):
    """Emit incremental classify progress (once per 20-row AI batch). NEW event, additive -- the
    terminal boq:classify_sheet_done + get_classify_status poll are unchanged. Payload is keyed
    by (boq, sheet_name, discipline) so the client gates it to the active sheet."""
    payload = {"boq": boq, "sheet_name": sheet_name, "discipline": discipline,
               "done": done, "total": total}
    publish_kwargs = {"user": user} if user else {}
    frappe.publish_realtime("boq:classify_sheet_progress", payload, **publish_kwargs)


def _publish_classify_event(boq, sheet_name, discipline, user, payload):
    """Choke-point: record the terminal payload (Redis fallback), clear the marker, THEN publish.
    Redis writes live outside the DB transaction, so they survive a worker rollback."""
    frappe.cache().set_value(
        _status_key(boq, sheet_name, discipline), payload, expires_in_sec=_STATUS_TTL_SEC
    )
    _clear_marker(boq, sheet_name, discipline)
    publish_kwargs = {}
    if user:
        publish_kwargs["user"] = user
    frappe.publish_realtime("boq:classify_sheet_done", payload, **publish_kwargs)


@frappe.whitelist()
def get_classify_status(boq=None, sheet_name=None, discipline="Electrical"):
    """Polling fallback for a classify run, keyed by (boq, sheet_name, discipline). Same payload
    shape as the boq:classify_sheet_done socket event so one frontend handler serves both.

    States: {"state":"done", **payload} | {"state":"running"} | {"state":"idle"}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.classify.get_classify_status
    """
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    term = frappe.cache().get_value(_status_key(boq, sheet_name, discipline))
    if term:
        return {"state": "done", **term}
    marker = _get_marker(boq, sheet_name, discipline)
    if marker and _maybe_self_heal(boq, sheet_name, discipline, marker) == "running":
        out = {"state": "running"}
        # Carry done/total ONLY once a batch has written them (a run before its first batch has
        # none -> bare running; the TS side reads done?/total? guarded by typeof === "number").
        if isinstance(marker.get("done"), int) and isinstance(marker.get("total"), int):
            out["done"] = marker["done"]
            out["total"] = marker["total"]
        return out
    return {"state": "idle"}


@frappe.whitelist()
def get_sheet_categories(boq=None, sheet_name=None, discipline="Electrical"):
    """Read the CURRENT BoQ Row Category rows for the current committed version. Read-only.

    Returns {committed_version, categories:[{excel_row, rule_category_id, ai_category_id,
    final_category_id, routing, routing_reason, human_category_id, effective_category_id}]}
    where effective = human_category_id if set else final_category_id.
    """
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    cv = _resolve_committed_version(boq, sheet_name)
    if cv is None:
        return {"committed_version": None, "categories": []}

    rows = frappe.get_all(
        _ROW_CATEGORY,
        filters={
            "boq": boq,
            "sheet_name": sheet_name,
            "committed_version": cv,
            "discipline": discipline,
            "is_current": 1,
        },
        fields=[
            "excel_row", "rule_category_id", "ai_category_id", "final_category_id",
            "routing", "routing_reason", "human_category_id",
        ],
        order_by="excel_row asc",
    )
    out = []
    for r in rows:
        human = (r.get("human_category_id") or "").strip()
        r["effective_category_id"] = human if human else (r.get("final_category_id") or "")
        out.append(r)
    return {"committed_version": cv, "categories": out}


@frappe.whitelist(methods=["POST"])
def set_row_category(boq=None, sheet_name=None, excel_row=None, human_category_id=None, discipline="Electrical"):
    """Record a reviewer's chosen category on one classified row (persist.set_human_verdict).

    human_category_id must be a valid frozen category id for the discipline, OR "" to CLEAR the
    human verdict (the row then reads its machine verdict -- final_category_id -- again). Returns
    {excel_row, effective_category_id}.
    """
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if excel_row is None or excel_row == "":
        frappe.throw("excel_row is required.", title="Missing field: excel_row")
    if not engines.is_discipline_available(discipline):
        frappe.throw(
            f"Classification engine '{discipline}' is not available yet.", title="Engine unavailable"
        )
    excel_row = int(excel_row)

    cv = _resolve_committed_version(boq, sheet_name)
    if cv is None:
        frappe.throw(
            f"No current committed sheet '{sheet_name}' for this BoQ.", title="Sheet not committed"
        )

    # Validate against the frozen category set (allow "" -> clear back to the machine verdict).
    val = (human_category_id or "").strip()
    if val:
        valid_ids = {c["category_id"] for c in load_ruleset(discipline=discipline)["categories"]}
        if val not in valid_ids:
            frappe.throw(f"Unknown category id {val!r} for engine {discipline}.", title="Invalid category")

    persist.set_human_verdict(boq, sheet_name, excel_row, cv, discipline, val)

    cur = frappe.get_all(
        _ROW_CATEGORY,
        filters={
            "boq": boq, "sheet_name": sheet_name, "excel_row": excel_row,
            "committed_version": cv, "discipline": discipline, "is_current": 1,
        },
        fields=["human_category_id", "final_category_id"],
    )
    if not cur:
        return {"excel_row": excel_row, "effective_category_id": val}
    human = (cur[0].get("human_category_id") or "").strip()
    effective = human if human else (cur[0].get("final_category_id") or "")
    return {"excel_row": excel_row, "effective_category_id": effective}


@frappe.whitelist()
def get_category_catalog(discipline="Electrical"):
    """Read-only: one engine's category catalog (id -> display label), from the ruleset
    (categories_<disc>.json via load_ruleset). Drives the CL-3 verdict picker + the Category
    column's human-readable label. ENGINE-SCOPED -- only an AVAILABLE engine has a catalog
    (load_ruleset raises for others), so an unavailable discipline throws. The label falls back
    to the id if a category has no name. Returns {discipline, categories:[{id, label}]}.
    """
    if not engines.is_discipline_available(discipline):
        frappe.throw(
            f"Classification engine '{discipline}' is not available yet.", title="Engine unavailable"
        )
    cats = load_ruleset(discipline=discipline)["categories"]
    return {
        "discipline": discipline,
        "categories": [
            {"id": c["category_id"], "label": (c.get("name") or c["category_id"])} for c in cats
        ],
    }
