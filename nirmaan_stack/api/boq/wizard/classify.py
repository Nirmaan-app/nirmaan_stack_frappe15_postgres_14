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
from nirmaan_stack.api.boq.wizard import pricing  # G2d: re-classify clears the category-gate override

_ROW_CATEGORY = "BoQ Row Category"
_BOQ_SHEET = "BoQ Sheet"
_TRUTH_SNAPSHOT = "BoQ Category Truth Snapshot"
_FROZEN_SNAPSHOT_SOURCE = "Frozen in product"

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


def _current_sheet_name(boq, sheet_name, committed_version):
    """The docname of the is_current=1 BoQ Sheet for (boq, sheet_name, committed_version), or
    None. sheet_name VERBATIM (#152)."""
    return frappe.db.get_value(
        _BOQ_SHEET,
        {"boq": boq, "sheet_name": sheet_name, "commit_version": committed_version, "is_current": 1},
        "name",
    )


def _guard_classification_not_frozen(boq, sheet_name, committed_version):
    """Block a category verdict write / re-classify on a classification-frozen sheet. Mirrors
    pricing._guard_sheet_not_locked: called AFTER the target resolve and BEFORE any write / enqueue,
    so a frozen sheet short-circuits and mutates NOTHING (reject-mutates-nothing). PURELY ADDITIVE:
    an unfrozen sheet passes through byte-for-byte. The single frozen-state read lives in
    persist.is_sheet_classification_frozen (service layer). sheet_name VERBATIM (#152)."""
    if persist.is_sheet_classification_frozen(boq, sheet_name, committed_version):
        frappe.throw(persist._FROZEN_WRITE_MESSAGE, title="Classification frozen")


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

    _cv_for_guard = _resolve_committed_version(boq, sheet_name)
    if _cv_for_guard is None:
        frappe.throw(
            f"No current committed sheet '{sheet_name}' for this BoQ.", title="Sheet not committed"
        )

    # A classification-frozen sheet rejects a re-classify BEFORE the enqueue (reject-mutates-
    # nothing). Unfreeze to re-classify. The orchestrator carries a defence-in-depth copy.
    _guard_classification_not_frozen(boq, sheet_name, _cv_for_guard)

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
        # G2d: on a SUCCESSFUL WHOLE-SHEET re-classify, clear the category-gate override for this
        # sheet. Placed AFTER the classify commit, never fails the run (see helper). Per-engine by
        # design -- each engine's worker clears independently (there is no single all-engines
        # completion point); a range/partial run leaves the override intact.
        override_cleared = _clear_override_after_reclassify(boq, sheet_name, scope)
        payload = {
            "status": "success",
            "boq_name": boq,
            "sheet_name": sheet_name,
            "discipline": discipline,
            **summary,
            "category_override_cleared": override_cleared,  # additive; after **summary so it wins
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


def _clear_override_after_reclassify(boq, sheet_name, scope) -> bool:
    """G2d: clear the category-gate override after a SUCCESSFUL WHOLE-SHEET re-classify.

    RATIONALE: re-classification changes which rows have categories, so an override granted against
    the OLD category picture must not silently carry forward -- the admin re-asserts against the new
    state.

    - Only a WHOLE-SHEET run clears (scope mode 'sheet'); a partial row-range run leaves the override
      INTACT (it only touched some rows).
    - IDEMPOTENT: a sheet with no override is a clean no-op (returns False).
    - MUST NOT fail the classify run: on ANY error, log and return False so the classification result
      stands. The gate fails SAFE -- an uncleared override only leaves rate editing unlocked, which the
      admin already chose.

    Returns True iff an override was actually present and has now been cleared. PER-ENGINE by design:
    each engine's worker calls this independently (there is no single all-engines completion point),
    so a multi-engine whole-sheet re-classify clears once per engine and an override re-set between two
    engines' completions is wiped by the later one.
    """
    try:
        if not (scope and scope.get("mode") == "sheet"):
            return False
        committed_version = _resolve_committed_version(boq, sheet_name)
        if committed_version is None:
            return False
        return bool(
            pricing.reset_category_gate_override_on_reclassify(boq, sheet_name, committed_version)
        )
    except Exception:
        frappe.log_error(
            title="BoQ re-classify override clear failed", message=frappe.get_traceback()
        )
        return False


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
            "routing", "routing_reason", "review_priority", "human_category_id",
        ],
        order_by="excel_row asc",
    )
    out = []
    for r in rows:
        human = (r.get("human_category_id") or "").strip()
        r["effective_category_id"] = human if human else (r.get("final_category_id") or "")
        out.append(r)
    return {"committed_version": cv, "categories": out}


# ---------------------------------------------------------------------------
# HV-10 multi-engine per-row resolution. get_sheet_categories (above) is the
# SINGLE-DISCIPLINE reader and is BYTE-UNTOUCHED -- it now backs ONLY the tests'
# regression pin (Slice ST-1 repointed freeze_classification onto the resolved
# read, and get_freeze_summary already reads the resolved ladder). This
# endpoint is the MERGED reader the pricing editor consumes: it reads every
# discipline's current rows in ONE index-covered query and resolves an effective
# verdict PER ROW via the owner-locked ladder.
#
# N-ENGINE GENERIC: no discipline is named anywhere below. A future engine that
# flips available in the registry flows through with ZERO code changes here --
# it is just another key in the per-row `votes` map.
# ---------------------------------------------------------------------------

_RESOLVED_VOTE_FIELDS = (
    "rule_category_id", "ai_category_id", "ai_confidence",
    "final_category_id", "routing", "review_priority",
)


# The per-row resolution ladder (resolve_row_ladder + _conf + _neg_key) was RELOCATED to the
# service layer (persist.resolve_row_ladder, Slice 1a) so both this endpoint AND the shared
# blank-category helper (persist.blank_category_eligible_rows) resolve rows through ONE ladder
# without a service->api import. Behaviour is byte-identical; get_sheet_categories_resolved below
# calls persist.resolve_row_ladder.


@frappe.whitelist()
def get_sheet_categories_resolved(boq=None, sheet_name=None):
    """Per-row multi-engine resolution across ALL disciplines with current rows. Read-only.

    Returns {committed_version, disciplines:[present, sorted], categories:[ per excel_row:
      excel_row, effective_category_id, effective_source ("human"|"auto"|"blank"),
      resolved_discipline (of the effective verdict; None when blank),
      cross_engine_conflict (bool, COMPUTED, telemetry-only, never rendered),
      human_category_id, human_discipline (when a human verdict resolved the row),
      votes: {discipline: {rule_category_id, ai_category_id, ai_confidence, final_category_id,
              routing, review_priority}} ]}

    ONE index-covered query (the composite index leads with boq, sheet_name, committed_version;
    dropping the discipline filter is still covered -- recon-measured 0.4ms). sheet_name is
    whitespace-VERBATIM (#152), exactly as get_sheet_categories resolves it.
    """
    if not boq:
        frappe.throw("boq is required.", title="Missing field: boq")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    cv = _resolve_committed_version(boq, sheet_name)
    if cv is None:
        return {"committed_version": None, "disciplines": [], "categories": []}

    rows = frappe.get_all(
        _ROW_CATEGORY,
        filters={"boq": boq, "sheet_name": sheet_name, "committed_version": cv, "is_current": 1},
        fields=[
            "excel_row", "discipline", "rule_category_id", "ai_category_id", "ai_confidence",
            "final_category_id", "routing", "routing_reason", "review_priority",
            "human_category_id", "human_verdict_at",
        ],
        order_by="excel_row asc",
    )

    # Group per excel_row -> {discipline: vote}
    by_row = {}
    disciplines = set()
    for r in rows:
        d = r.get("discipline")
        disciplines.add(d)
        by_row.setdefault(r["excel_row"], {})[d] = r

    categories = []
    for excel_row in sorted(by_row):
        votes = by_row[excel_row]
        eff, source, rdisc, conflict, human_cat, human_disc = persist.resolve_row_ladder(votes)
        categories.append({
            "excel_row": excel_row,
            "effective_category_id": eff,
            "effective_source": source,
            "resolved_discipline": rdisc,
            "cross_engine_conflict": conflict,
            "human_category_id": human_cat,
            "human_discipline": human_disc,
            "votes": {
                d: {f: v.get(f) for f in _RESOLVED_VOTE_FIELDS}
                for d, v in votes.items()
            },
        })

    return {
        "committed_version": cv,
        "disciplines": sorted(disciplines),
        "categories": categories,
    }


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

    # A classification-frozen sheet rejects a verdict write BEFORE any DML (reject-mutates-nothing).
    # persist.set_human_verdict carries a defence-in-depth copy of this same guard.
    _guard_classification_not_frozen(boq, sheet_name, cv)

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


# ── Freeze / Unfreeze classification ───────────────────────────────────────────────
# (The former _eligible_nodes reader was folded into persist.blank_category_eligible_rows,
#  Slice 1a -- the eligible-node read + the multi-engine blank resolution now live together in
#  ONE shared service helper so get_freeze_summary and a future rate-edit gate cannot drift.)


@frappe.whitelist(methods=["POST"])
def freeze_classification(boq_name=None, sheet_name=None, discipline="Electrical"):
    """FREEZE a committed sheet's classification. THREE effects, all in ONE atomic transaction:
      1. stamp every eligible row whose RESOLVED effective category is non-blank into
         human_category_id IN PLACE (persist.stamp_human_verdicts_bulk, the set_human_verdict
         idiom -- NOT freeze-and-supersede), ON THE RESOLVING DISCIPLINE'S is_current row;
      2. bank one BoQ Category Truth Snapshot row per stamped row (source 'Frozen in product', ONE
         shared snapshot_batch for the event), carrying that row's RESOLVING discipline;
      3. set classification_frozen / frozen_by / frozen_at on the is_current=1 BoQ Sheet.

    Slice ST-1 (owner Option A, 2026-07-26): the stamp SOURCE is the MULTI-ENGINE resolved read
    (persist.resolved_category_stamp_targets -- the same resolve_row_ladder the freeze COUNT and
    get_sheet_categories_resolved use), NOT the single-discipline get_sheet_categories. So a sheet
    classified under two disciplines stamps rows from BOTH vocabularies in one freeze, each on the
    ladder winner's identity; and snapshot_count == the resolved non-blank eligible count ==
    get_freeze_summary's number (ONE fifth-surface number). On a single-discipline sheet this is
    equivalent to the old path. The `discipline` parameter is now used ONLY for the availability
    guard below (mirrors get_freeze_summary's accepted-but-unused disposition); it no longer selects
    which rows are stamped -- the freeze is whole-sheet by construction. get_sheet_categories is left
    BYTE-UNTOUCHED.

    Rows WITHOUT a non-blank resolved category are skipped from stamping + banking (by design;
    get_freeze_summary reports how many). While frozen, set_row_category AND start_classify are
    rejected; PRICING is untouched. ATOMIC: one commit at the end; any failure rolls back so NOTHING
    is written. Returns {rows_stamped, snapshots_banked, snapshot_batch, committed_version}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.classify.freeze_classification
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if not engines.is_discipline_available(discipline):
        frappe.throw(
            f"Classification engine '{discipline}' is not available yet.", title="Engine unavailable"
        )

    cv = _resolve_committed_version(boq_name, sheet_name)
    if cv is None:
        frappe.throw(
            f"No current committed sheet '{sheet_name}' for this BoQ.", title="Sheet not committed"
        )
    if persist.is_sheet_classification_frozen(boq_name, sheet_name, cv):
        frappe.throw(
            "Classification is already frozen for this sheet.", title="Already frozen"
        )

    # Resolved effective category per eligible row across ALL disciplines (Slice ST-1). Only rows
    # with a non-blank resolved category are stamped + banked; each carries the RESOLVING discipline
    # (the ladder winner's identity), so a multi-trade sheet stamps both vocabularies in one freeze.
    targets = persist.resolved_category_stamp_targets(boq_name, sheet_name, cv)

    batch = "gtfreeze-" + frappe.generate_hash(length=12)
    user = frappe.session.user
    now = frappe.utils.now()

    try:
        # (1) stamp human verdicts in place -- NO commit (the helper defers commit to us). Group the
        # targets by their resolving discipline and reuse stamp_human_verdicts_bulk once per group,
        # so each stamp lands on the ladder winner's is_current row identity.
        by_disc = {}
        for t in targets:
            by_disc.setdefault(t["resolved_discipline"], []).append(
                {"excel_row": t["excel_row"], "human_category_id": t["effective_category_id"]}
            )
        rows_stamped = 0
        for disc, stamps in by_disc.items():
            stamp_res = persist.stamp_human_verdicts_bulk(
                boq_name, sheet_name, cv, disc, stamps, user=user
            )
            rows_stamped += stamp_res["stamped"]
        # (2) bank one snapshot per stamped row -- source 'Frozen in product', shared batch, on the
        # row's RESOLVING discipline.
        for t in targets:
            doc = frappe.new_doc(_TRUTH_SNAPSHOT)
            doc.boq = boq_name
            doc.sheet_name = sheet_name  # VERBATIM (#152)
            doc.excel_row = t["excel_row"]
            doc.discipline = t["resolved_discipline"]
            doc.committed_version = cv
            doc.label_category_id = t["effective_category_id"]
            doc.snapshot_batch = batch
            doc.source = _FROZEN_SNAPSHOT_SOURCE
            doc.snapshot_at = now
            doc.snapshot_by = user
            doc.insert(ignore_permissions=True)
        # (3) set the freeze flag on the committed BoQ Sheet (set_value, NOT doc.save -- the
        # list-valued area_dimensions JSON throws on a full save).
        bs_name = _current_sheet_name(boq_name, sheet_name, cv)
        frappe.db.set_value(
            _BOQ_SHEET,
            bs_name,
            {"classification_frozen": 1, "frozen_by": user, "frozen_at": now},
            update_modified=False,
        )
        frappe.db.commit()  # single end-commit -- the whole freeze lands or nothing does.
    except Exception:
        frappe.db.rollback()
        raise

    return {
        "rows_stamped": rows_stamped,
        "snapshots_banked": len(targets),
        "snapshot_batch": batch,
        "committed_version": cv,
    }


@frappe.whitelist(methods=["POST"])
def unfreeze_classification(boq_name=None, sheet_name=None):
    """UNFREEZE a committed sheet's classification: clear classification_frozen / frozen_by /
    frozen_at ONLY. The banked snapshots stay permanent + the human stamps stay (unfreeze does NOT
    revert them). Rejects if the sheet is not currently frozen. Returns {ok, committed_version}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.classify.unfreeze_classification
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    cv = _resolve_committed_version(boq_name, sheet_name)
    if cv is None:
        frappe.throw(
            f"No current committed sheet '{sheet_name}' for this BoQ.", title="Sheet not committed"
        )
    if not persist.is_sheet_classification_frozen(boq_name, sheet_name, cv):
        frappe.throw("Classification is not frozen for this sheet.", title="Not frozen")

    bs_name = _current_sheet_name(boq_name, sheet_name, cv)
    frappe.db.set_value(
        _BOQ_SHEET,
        bs_name,
        {"classification_frozen": 0, "frozen_by": None, "frozen_at": None},
        update_modified=False,
    )
    frappe.db.commit()
    return {"ok": True, "committed_version": cv}


@frappe.whitelist()
def get_freeze_summary(boq_name=None, sheet_name=None, discipline="Electrical"):
    """Read-only pre-freeze summary. Counts eligible rows (node_type in {Line Item, Preamble})
    whose RESOLVED effective category is blank, split by node_type, and reports the current freeze
    state. Returns {uncategorised_preambles, uncategorised_line_items, frozen, frozen_by, frozen_at,
    committed_version}. Graceful zeros for an uncommitted sheet.

    Slice 1a: the blank counts read the MULTI-ENGINE resolved ladder via the shared
    persist.blank_category_eligible_rows -- so a row categorised under ANOTHER discipline is NOT
    counted blank (the single-discipline get_sheet_categories over-counted it), and a row with NO
    BoQ Row Category record at all IS counted blank (the fail-open guard). The `discipline`
    parameter is ACCEPTED for backward compatibility but is NO LONGER USED (the count resolves
    across every discipline); on a single-discipline sheet the counts are unchanged.
    URL: /api/method/nirmaan_stack.api.boq.wizard.classify.get_freeze_summary
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")

    cv = _resolve_committed_version(boq_name, sheet_name)
    if cv is None:
        return {
            "uncategorised_preambles": 0, "uncategorised_line_items": 0,
            "frozen": False, "frozen_by": None, "frozen_at": None, "committed_version": None,
        }

    # Eligible rows whose RESOLVED effective category is blank (all disciplines; no-record = blank).
    blanks = persist.blank_category_eligible_rows(boq_name, sheet_name, cv)
    preambles = sum(1 for b in blanks if b["node_type"] == "Preamble")
    line_items = sum(1 for b in blanks if b["node_type"] == "Line Item")

    bs_name = _current_sheet_name(boq_name, sheet_name, cv)
    fields = frappe.db.get_value(
        _BOQ_SHEET, bs_name, ["classification_frozen", "frozen_by", "frozen_at"], as_dict=True
    ) or {}
    return {
        "uncategorised_preambles": preambles,
        "uncategorised_line_items": line_items,
        "frozen": bool(fields.get("classification_frozen")),
        "frozen_by": fields.get("frozen_by"),
        "frozen_at": fields.get("frozen_at"),
        "committed_version": cv,
    }
