# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""HISTORICAL MATCHING BEHIND "SUGGEST RATES" (DEV2-B4 S2): the trigger, the match job, its status and its results.

THE SEQUENCE (owner 2026-11-02 16:13, G1): "i would prefer to do it after the suggest run is done...it adds only 2-3
minutes to the overall run, so runningit after is ok. the only thing is that the wait time should be adequately
dsiclosed to the user and the progress shown properly as we do for the suggest rate run currently".
  * `start_after_suggest` is THE TRIGGER. `rate_master._suggest_worker` calls it only for a COMPLETE Suggest run, AFTER
    the Suggest run's own commit and before its done payload is published, and only when match_enabled is ON. A
    halted / failed Suggest run starts no match. With the switch OFF it reads one setting and returns None: Suggest
    is byte for byte as before. It never raises: a failure to start matching never touches the Suggest run.
  * ONE MATCH RUN PER SHEET: its own job id, marker and status keys (`boq_match_marker` / `boq_match_status` per
    (boq, sheet)), as Suggest's. A trigger that finds a live match run for the sheet starts none (logged).
  * The job (`_match_worker`, queue long) runs services/boq_rate_match/match_run.run_match; a failure FAILS CLOSED:
    the match run says why; the Suggest run is never touched or rolled back.
  * `get_match_status` / `get_match_results` (login only, as get_active_suggestion_run); publish_realtime
    "boq:match_sheet_progress" / "boq:match_sheet_done".

THE THREE CLOCKS MOVE TOGETHER, as Suggest's (rate_master.py): job timeout < stale threshold < marker TTL; the stale
threshold clears the job timeout AND rq's 60 s kill grace (pinned by test). tasks/match_run_healer.py marks a run whose
clocks passed `halted` ("stale - worker gone").

THE 06:00 IST REBUILD (owner 2026-11-02 21:41): hooks.py cron "0 6 * * *" -> `daily_pool_rebuild`, which enqueues
pool.rebuild_pool on `long` (timeout 3600 s). It is not the cron target itself: Frappe runs a "Cron" job on the
`default` queue with a 300 s timeout (frappe 15 scheduled_job_type.get_queue_name / background_jobs
get_queues_timeout), and a pool build takes ~310 s. Frappe's cron reads the SYSTEM time zone (now_datetime ->
System Settings time_zone): production must hold Asia/Kolkata for 06:00 to be IST.

THE WAIT ESTIMATE (owner 2026-11-03 11:11: "it should give total estinmate _ suggest rate + historical rates -- with
splits -- give a safe number"): PACES below, measured in dev2 at p90; the dialog adds the two phases, each rounded UP
to whole minutes (RateSuggestProgressModal.matchWaitEstimate).
"""
import json

import frappe
from frappe.utils.background_jobs import get_job_status

MATCH_DOCTYPE = "BoQ Rate Match Run"
SUGGEST_DOCTYPE = "BoQ Rate Suggestion Run"
WORKER = "nirmaan_stack.api.boq.rate_match._match_worker"
_M_STATUS_PREFIX = "boq_match_status"
_M_MARKER_PREFIX = "boq_match_marker"

# ⚠️ THE THREE MUST MOVE TOGETHER (job timeout < stale threshold < marker TTL), derived as Suggest's are.
_MATCH_JOB_TIMEOUT_SEC = 1800
_RQ_KILL_GRACE_SEC = 60
_STALE_MATCH_SECONDS = _MATCH_JOB_TIMEOUT_SEC + _RQ_KILL_GRACE_SEC + 240
_M_MARKER_TTL_SEC = _MATCH_JOB_TIMEOUT_SEC * 2
_M_STATUS_TTL_SEC = 3600
POOL_REBUILD_TIMEOUT_SEC = 3600

# THE PACES (seconds; measured in dev2, p90).
# SUGGEST (DEV2-B5 S2, the SAFE estimate; B4's 3.12 s a row under-ran small passes - the cert's 20 rows took 203 s):
#   seconds = fixed + batches x per_batch, batches = ceil(rows / 20) (extraction._BATCH). Fitted on 189 stored
#   complete runs (run_at - creation; a completed selected-row pass sized from the capture log, two unsized ones left
#   out) by a p90 quantile fit: fixed 13 s, per batch 48 s; the >300-row band then covered 8 / 9 (< 90 %), so the
#   per-batch part was raised ONCE to the smallest whole second covering >= 90 % of the runs in every size band:
#   53 s -> 1-20 rows 30/31, 21-100 70/74, 101-300 74/75, >300 9/9 (the dialog rounds each phase UP to minutes).
# MATCHING: DEV2-B4 S4's 9 sheets of 4 BoQs, seconds = fixed + rows x per-row: fixed = p90 of the four <= 30-row
#   sheets' wall (26.6 / 60.1 / 63.7 / 65.4 s) = 64.9 -> 65; per-row = p90 of (wall - 64.9) / rows over the five
#   >= 90-row sheets (0.284 .. 0.444) = 0.443 -> 0.45. Re-checked in DEV2-B5 on B4 S4 + B5 S1.
PACES = {
    "suggest_fixed_seconds": 13.0,
    "suggest_seconds_per_batch": 53.0,
    "suggest_batch_rows": 20,
    "match_fixed_seconds": 65.0,
    "match_seconds_per_row": 0.45,
}


def _require_login():
    if frappe.session.user == "Guest":
        frappe.throw("Login required.", frappe.PermissionError)


def match_enabled():
    """The switch, read straight from the stored value (as ai_settings.match_cards_at_commit_on reads its two):
    no meta and no cache, so nothing cached or mocked can turn it on. Nothing stored = the doctype's default 0.
    Fails closed (False) on any read error."""
    try:
        from nirmaan_stack.api.boq.wizard.ai_settings import SETTINGS_DOCTYPE
        return bool(frappe.utils.cint(frappe.db.get_single_value(SETTINGS_DOCTYPE, "match_enabled", cache=False)))
    except Exception:  # noqa: BLE001
        return False


def _status_key(boq, sheet_name):
    return f"{_M_STATUS_PREFIX}::{boq}::{sheet_name}"


def _marker_key(boq, sheet_name):
    return f"{_M_MARKER_PREFIX}::{boq}::{sheet_name}"


def _get_marker(boq, sheet_name):
    return frappe.cache().get_value(_marker_key(boq, sheet_name))


def _set_marker(boq, sheet_name, marker):
    frappe.cache().set_value(_marker_key(boq, sheet_name), marker, expires_in_sec=_M_MARKER_TTL_SEC)


def _maybe_self_heal(boq, sheet_name, marker):
    """'running' | 'cleared' | 'cleared_stale' -- rate_master._s_maybe_self_heal's rule for the match marker."""
    status = None
    if marker.get("job_id"):
        try:
            status = get_job_status(marker["job_id"])
        except Exception:  # noqa: BLE001
            status = None
    if status in ("finished", "failed") or status is None:
        frappe.cache().delete_value(_marker_key(boq, sheet_name))
        return "cleared"
    try:
        age = frappe.utils.time_diff_in_seconds(frappe.utils.now(), marker.get("enqueued_at"))
    except Exception:  # noqa: BLE001
        age = 0
    if age > _STALE_MATCH_SECONDS:
        frappe.cache().delete_value(_marker_key(boq, sheet_name))
        return "cleared_stale"
    return "running"


def start_after_suggest(boq, sheet_name, suggest_run_id, only_rows=None, resume_run_id=None, user=None):
    """THE TRIGGER (see the module docstring). -> None (switch OFF), {"queued": True, "run": name} or
    {"queued": False, "reason": ...}. Never raises."""
    if not match_enabled():
        return None
    try:
        marker = _get_marker(boq, sheet_name)
        if marker and _maybe_self_heal(boq, sheet_name, marker) == "running":
            frappe.log_error(title="BoQ match not started: a match run is in progress",
                             message=f"boq={boq} sheet={sheet_name} suggest run_id={suggest_run_id} live={marker}")
            return {"queued": False, "reason": "a match run is already in progress for this sheet"}
        srun = frappe.db.get_value(SUGGEST_DOCTYPE, {"boq": boq, "sheet_name": sheet_name, "run_id": suggest_run_id},
                                   ["name", "committed_version"], as_dict=True)
        if not srun:
            return {"queued": False, "reason": "the Suggest run was not found"}
        job_id = frappe.generate_hash(length=32)
        doc = frappe.get_doc({"doctype": MATCH_DOCTYPE, "boq": boq, "sheet_name": sheet_name, "job_id": job_id,
                              "commit_version": srun["committed_version"], "suggest_run": srun["name"],
                              "status": "queued", "active": 0, "rows_total": 0, "rows_done": 0,
                              "usage": json.dumps({"only_rows": only_rows, "resume": bool(resume_run_id)})})
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        frappe.enqueue(WORKER, queue="long", timeout=_MATCH_JOB_TIMEOUT_SEC, job_id=job_id, run_name=doc.name,
                       boq=boq, sheet_name=sheet_name, suggest_run_id=suggest_run_id, user=user,
                       only_rows=list(only_rows) if only_rows else None, resume=bool(resume_run_id))
        frappe.cache().delete_value(_status_key(boq, sheet_name))
        _set_marker(boq, sheet_name, {"job_id": job_id, "run": doc.name, "suggest_run_id": suggest_run_id,
                                      "enqueued_at": frappe.utils.now(), "user": user, "phase": "queued",
                                      "done": 0, "total": 0})
        return {"queued": True, "run": doc.name}
    except Exception:  # noqa: BLE001 -- never fail or change the Suggest run
        frappe.db.rollback()
        frappe.log_error(title="BoQ match trigger failed", message=frappe.get_traceback())
        return {"queued": False, "reason": "matching could not be started"}


def _match_worker(run_name=None, boq=None, sheet_name=None, suggest_run_id=None, user=None, only_rows=None,
                  resume=False, client=None, card_client=None):
    """The match job. Progress -> marker + rows_done + "boq:match_sheet_progress"; the end -> the status cache +
    "boq:match_sheet_done". `client` / `card_client` are seams (tests, the slice's timed runs)."""
    from nirmaan_stack.services.boq_rate_match import match_run

    rt = {"user": user} if user else {}

    def progress(phase, done):
        m = _get_marker(boq, sheet_name) or {}
        total = frappe.db.get_value(MATCH_DOCTYPE, run_name, "rows_total") or 0
        m.update(phase=phase, done=int(done), total=int(total), run=run_name, suggest_run_id=suggest_run_id)
        _set_marker(boq, sheet_name, m)
        frappe.publish_realtime("boq:match_sheet_progress", {"boq": boq, "sheet_name": sheet_name, "phase": phase,
                                                            "done": int(done), "total": int(total)}, **rt)

    try:
        out = match_run.run_match(run_name, only_rows=only_rows, resume=resume, client=client,
                                  card_client=card_client, progress=progress)
        payload = {"status": "success" if out["status"] == "complete" else "halted", "run_status": out["status"],
                   "halt_reason": out["halt_reason"], "rows_total": out["rows_total"], "rows_done": out["rows_done"]}
    except Exception as exc:  # noqa: BLE001 -- fail closed; the Suggest run is never touched
        frappe.db.rollback()
        frappe.log_error(title="BoQ match worker failed", message=frappe.get_traceback())
        reason = str(exc) if isinstance(exc, match_run.MatchRefused) else "The match run stopped unexpectedly."
        frappe.db.set_value(MATCH_DOCTYPE, run_name, {"status": "failed", "halt_reason": reason})
        frappe.db.commit()
        payload = {"status": "error", "run_status": "failed", "halt_reason": reason}
    payload.update(boq=boq, sheet_name=sheet_name, run=run_name, suggest_run_id=suggest_run_id)
    frappe.cache().set_value(_status_key(boq, sheet_name), payload, expires_in_sec=_M_STATUS_TTL_SEC)
    frappe.cache().delete_value(_marker_key(boq, sheet_name))
    frappe.publish_realtime("boq:match_sheet_done", payload, **rt)
    return payload


def suggest_estimate_minutes(rows, paces=None):
    """The Suggest part of the dialog's estimate, as RateSuggestProgressModal.matchWaitEstimate computes it (the two are
    pinned equal): ceil((fixed + ceil(rows / batch_rows) x per_batch) / 60), at least 1 minute."""
    import math
    p = paces or PACES
    batches = math.ceil(max(0, int(rows or 0)) / max(1, int(p["suggest_batch_rows"])))
    return max(1, math.ceil((p["suggest_fixed_seconds"] + batches * p["suggest_seconds_per_batch"]) / 60))


SIZE_BANDS = ((1, 20), (21, 100), (101, 300), (301, None))


def estimate_coverage(runs, paces=None):
    """{band: (covered, runs)} for stored runs [(rows, seconds)]: a run is covered when the estimate's whole minutes
    x 60 >= its real seconds. The S2 proof: every band >= 90 % (owner 2026-11-03 11:11, "give a safe number")."""
    out = {}
    for lo, hi in SIZE_BANDS:
        rs = [(n, s) for n, s in runs if n >= lo and (hi is None or n <= hi)]
        out[(lo, hi)] = (sum(1 for n, s in rs if suggest_estimate_minutes(n, paces) * 60 >= s), len(rs))
    return out


def estimate_left_seconds(rows_total, seconds_so_far):
    """The time left the modal shows: the p90 total for the pass (PACES) minus what has passed, never below 0."""
    total = PACES["match_fixed_seconds"] + PACES["match_seconds_per_row"] * max(0, int(rows_total or 0))
    return max(0, int(round(total - max(0.0, float(seconds_so_far or 0)))))


@frappe.whitelist()
def get_match_status(boq=None, sheet_name=None):
    """The match phase for one sheet. Switch OFF -> {"match_enabled": False} and nothing else. ON -> the paces and
    {state: running (phase, done, total, seconds, estimate_left_s) | done (the terminal payload) | idle}."""
    _require_login()
    if not boq or not sheet_name:
        frappe.throw("boq and sheet_name are required.", title="Missing field")
    if not match_enabled():
        return {"match_enabled": False}
    out = {"match_enabled": True, "paces": dict(PACES)}
    term = frappe.cache().get_value(_status_key(boq, sheet_name))
    if term:
        return {**out, "state": "done", **term}
    marker = _get_marker(boq, sheet_name)
    if marker and _maybe_self_heal(boq, sheet_name, marker) == "running":
        secs = max(0, int(frappe.utils.time_diff_in_seconds(frappe.utils.now(), marker.get("enqueued_at"))))
        return {**out, "state": "running", "phase": marker.get("phase"), "done": marker.get("done", 0),
                "total": marker.get("total", 0), "seconds": secs, "run": marker.get("run"),
                "suggest_run_id": marker.get("suggest_run_id"),
                "estimate_left_s": estimate_left_seconds(marker.get("total"), secs)}
    return {**out, "state": "idle"}


@frappe.whitelist()
def get_match_results(boq=None, sheet_name=None):
    """The sheet's ACTIVE match run: {run: {name, status, commit_version, suggest_run, run_at, rows, usage} | None}.
    Version keying is the caller's, as for get_active_suggestion_run."""
    _require_login()
    if not boq or not sheet_name:
        frappe.throw("boq and sheet_name are required.", title="Missing field")
    rows = frappe.get_all(MATCH_DOCTYPE, filters={"boq": boq, "sheet_name": sheet_name, "active": 1},
                          fields=["name", "status", "commit_version", "suggest_run", "run_at", "results", "usage"],
                          order_by="creation desc", limit=1)
    if not rows:
        return {"run": None}
    r = rows[0]
    res = json.loads(r["results"]) if isinstance(r["results"], str) else (r["results"] or {})
    use = json.loads(r["usage"]) if isinstance(r["usage"], str) else (r["usage"] or {})
    out_rows = res.get("rows") or []
    _attach_flags(boq, sheet_name, r["commit_version"], out_rows)
    _attach_texts(out_rows)
    return {"run": {"name": r["name"], "status": r["status"], "commit_version": r["commit_version"],
                    "suggest_run": r["suggest_run"], "run_at": r["run_at"], "rows": out_rows,
                    "usage": use}}


# ── "NOT A MATCH" (DEV2-B5 S3; owner R-H2AI: "Not a match" with an optional reason and note, CAPTURED and stored to
# improve matching later, with Undo; a match marked not a match is struck through and left out of the range) ──────
FEEDBACK_DOCTYPE = "BoQ Rate Match Feedback"
NOT_A_MATCH, UNDO = "not_a_match", "undo"
FEEDBACK_REASONS = ("Different spec", "Different item", "Different unit", "Different scope", "Other")
NOTE_MAX_CHARS = 1000


def _match_key(boq, sheet_name, excel_row):
    return f"{boq}|{sheet_name}|{int(excel_row)}"


def current_flags(boq, sheet_name, commit_version):
    """{(excel_row, match key): latest feedback row} for one sheet at one committed version. APPEND-ONLY store: the
    LATEST row (by creation, then name) for a (row, match) wins; an "undo" as the latest means not flagged."""
    rows = frappe.get_all(FEEDBACK_DOCTYPE, filters={"boq": boq, "sheet_name": sheet_name, "commit_version": commit_version},
                          fields=["name", "excel_row", "match_boq", "match_sheet_name", "match_excel_row", "action",
                                  "reason", "note", "user", "marked_at", "creation"],
                          order_by="creation asc, name asc")
    latest = {}
    for f in rows:
        latest[(int(f["excel_row"]), _match_key(f["match_boq"], f["match_sheet_name"], f["match_excel_row"]))] = f
    return latest


def _attach_flags(boq, sheet_name, commit_version, rows):
    """Each shown match gets `flag`: {action, reason, note, user, marked_at} when its latest feedback is not_a_match,
    else None. Only read; the stored results are never changed."""
    latest = current_flags(boq, sheet_name, commit_version) if rows else {}
    for row in rows:
        for m in row.get("matches") or []:
            f = (latest.get((int(row["excel_row"]), _match_key(m.get("boq"), m.get("sheet_name"), m.get("excel_row"))))
                 if m.get("excel_row") is not None else None)
            m["flag"] = ({k: f[k] for k in ("action", "reason", "note", "user", "marked_at")}
                         if f and f["action"] == NOT_A_MATCH else None)


def _attach_texts(rows):
    """Each shown match gets `description`: the matched row's own text from its CURRENT committed node (one read for
    the whole sheet) - the card's short label; the pop-up shows the full payload (get_match_detail). None if gone."""
    keys = sorted({(m.get("boq"), m.get("sheet_name"), int(m.get("excel_row"))) for r in rows for m in r.get("matches") or []
                   if m.get("boq") and m.get("excel_row") is not None})
    texts = {}
    for i in range(0, len(keys), 500):
        chunk = keys[i:i + 500]
        cond = " or ".join(["(s.boq = %s and s.sheet_name = %s and n.source_row_number = %s)"] * len(chunk))
        vals = [v for k in chunk for v in k]
        for b, sn, er, d in frappe.db.sql(f'''select s.boq, s.sheet_name, n.source_row_number, n.description
                from "tabBOQ Nodes" n join "tabBoQ Sheet" s on s.name = n.sheet
                where s.is_current = 1 and n.is_current = 1 and ({cond})''', vals):
            texts[(b, sn, int(er))] = d
    for r in rows:
        for m in r.get("matches") or []:
            m["description"] = texts.get((m.get("boq"), m.get("sheet_name"), int(m.get("excel_row") or 0)))


def _shown_match(match_run, boq, sheet_name, excel_row, match_boq, match_sheet_name, match_excel_row):
    """The run doc (as_dict) when `match_run` is a match run of (boq, sheet_name) whose stored row `excel_row` SHOWS the
    match (match_boq, match_sheet_name, match_excel_row); otherwise refused - an unknown match is never recorded."""
    run = frappe.db.get_value(MATCH_DOCTYPE, match_run, ["name", "boq", "sheet_name", "commit_version", "results"],
                              as_dict=True) if match_run else None
    if not run or (run["boq"], run["sheet_name"]) != (boq, sheet_name):
        frappe.throw("This match run does not belong to this sheet.", title="Unknown match")
    res = json.loads(run["results"]) if isinstance(run["results"], str) else (run["results"] or {})
    key = _match_key(match_boq, match_sheet_name, match_excel_row)
    for row in res.get("rows") or []:
        if int(row.get("excel_row")) == int(excel_row):
            if any(_match_key(m.get("boq"), m.get("sheet_name"), m.get("excel_row")) == key for m in row.get("matches") or []):
                return run
            break
    frappe.throw("That row is not a match shown for this row.", title="Unknown match")


def _guard_can_price(boq, sheet_name, commit_version):
    """A user may mark only on a sheet they can price, as the pricing page decides it: the sheet's CURRENT committed
    version is the run's, it is not deliberately locked, and its single-editor lock is free, theirs or stale (read
    only - the lock is never taken here)."""
    from frappe.utils import now_datetime
    from nirmaan_stack.api.boq.wizard.pricing import _get_sheet_is_locked
    from nirmaan_stack.api.boq.wizard.pricing_lock import read_lock_info

    cur = frappe.db.get_value("BoQ Sheet", {"boq": boq, "sheet_name": sheet_name, "is_current": 1}, "commit_version")
    if cur is None or int(cur) != int(commit_version or 0):
        frappe.throw("The sheet has been committed again since these matches were made.", title="Sheet changed")
    if _get_sheet_is_locked(boq, sheet_name, cur):
        frappe.throw("The sheet is locked, so its matches cannot be marked.", frappe.PermissionError, title="Sheet is locked")
    info = read_lock_info(boq, sheet_name, cur, frappe.session.user, now_datetime())
    if info is not None and not (info["is_locked_by_me"] or info["is_stale"]):
        frappe.throw("Someone else is pricing this sheet right now.", frappe.PermissionError, title="Sheet in use")


def _write_feedback(action, boq, sheet_name, excel_row, match_run, match_boq, match_sheet_name, match_excel_row,
                    reason=None, note=None):
    _require_login()
    if not boq or not sheet_name or excel_row in (None, "") or match_excel_row in (None, ""):
        frappe.throw("boq, sheet_name, excel_row and the match are required.", title="Missing field")
    excel_row, match_excel_row = int(excel_row), int(match_excel_row)
    run = _shown_match(match_run, boq, sheet_name, excel_row, match_boq, match_sheet_name, match_excel_row)
    _guard_can_price(boq, sheet_name, run["commit_version"])
    latest = current_flags(boq, sheet_name, run["commit_version"]).get(
        (excel_row, _match_key(match_boq, match_sheet_name, match_excel_row)))
    flagged = bool(latest and latest["action"] == NOT_A_MATCH)
    if action == NOT_A_MATCH and flagged:
        frappe.throw("This match is already marked not a match.", title="Already marked")
    if action == UNDO and not flagged:
        frappe.throw("This match is not marked not a match, so there is nothing to undo.", title="Nothing to undo")
    reason = (reason or "").strip() or None
    if reason and reason not in FEEDBACK_REASONS:
        frappe.throw(f"Reason must be one of: {', '.join(FEEDBACK_REASONS)}.", title="Invalid reason")
    note = (note or "").strip() or None
    if note and len(note) > NOTE_MAX_CHARS:
        frappe.throw(f"The note is longer than {NOTE_MAX_CHARS} characters.", title="Note too long")
    doc = frappe.get_doc({"doctype": FEEDBACK_DOCTYPE, "boq": boq, "sheet_name": sheet_name, "excel_row": excel_row,
                          "commit_version": run["commit_version"], "match_boq": match_boq,
                          "match_sheet_name": match_sheet_name, "match_excel_row": match_excel_row,
                          "match_run": run["name"], "action": action,
                          "reason": reason if action == NOT_A_MATCH else None,
                          "note": note if action == NOT_A_MATCH else None,
                          "user": frappe.session.user, "marked_at": frappe.utils.now()})
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True, "name": doc.name, "action": action,
            "flag": ({"action": NOT_A_MATCH, "reason": doc.reason, "note": doc.note, "user": doc.user,
                      "marked_at": doc.marked_at} if action == NOT_A_MATCH else None)}


@frappe.whitelist(methods=["POST"])
def mark_not_a_match(boq=None, sheet_name=None, excel_row=None, match_run=None, match_boq=None, match_sheet_name=None,
                     match_excel_row=None, reason=None, note=None):
    """Mark a shown match "not a match" (optional reason from FEEDBACK_REASONS, optional note). Appends one row."""
    return _write_feedback(NOT_A_MATCH, boq, sheet_name, excel_row, match_run, match_boq, match_sheet_name,
                           match_excel_row, reason, note)


@frappe.whitelist(methods=["POST"])
def undo_not_a_match(boq=None, sheet_name=None, excel_row=None, match_run=None, match_boq=None, match_sheet_name=None,
                     match_excel_row=None):
    """Undo the latest "not a match" on a shown match. Appends one "undo" row; nothing is deleted."""
    return _write_feedback(UNDO, boq, sheet_name, excel_row, match_run, match_boq, match_sheet_name, match_excel_row)


@frappe.whitelist()
def get_match_detail(boq=None, sheet_name=None, excel_row=None, match_run=None, match_boq=None, match_sheet_name=None,
                     match_excel_row=None):
    """THE POP-UP's read for one SHOWN match: the matched BoQ's project and name, and the matched row's payload block -
    rebuilt by the builder the pool used (extraction._ai_item over context_builder.build_sheet_context, through
    cards.sheet_items), i.e. what the judge read - with its payload sha; `can_open` = the user may open that BoQ
    (frappe read permission). Refused for a match the run does not show."""
    _require_login()
    from nirmaan_stack.services.boq_rate_match import cards as C

    if match_excel_row in (None, "") or excel_row in (None, ""):
        frappe.throw("excel_row and match_excel_row are required.", title="Missing field")
    _shown_match(match_run, boq, sheet_name, int(excel_row), match_boq, match_sheet_name, int(match_excel_row))
    b = frappe.db.get_value("BOQs", match_boq, ["name", "boq_name", "project"], as_dict=True) or {}
    project_name = frappe.db.get_value("Projects", b.get("project"), "project_name") if b.get("project") else None
    cv, items, _missing = C.sheet_items(match_boq, match_sheet_name, excel_rows=[int(match_excel_row)])
    item = items[0][1] if items else None
    return {"boq": match_boq, "boq_name": b.get("boq_name"), "project": b.get("project"), "project_name": project_name,
            "sheet_name": match_sheet_name, "excel_row": int(match_excel_row), "committed_version": cv,
            "payload": item, "payload_sha256": C.payload_sha256(item) if item else None,
            "can_open": bool(b) and bool(frappe.has_permission("BOQs", "read", doc=match_boq))}


def daily_pool_rebuild():
    """THE 06:00 IST ENTRY (hooks.py cron "0 6 * * *"): enqueue pool.rebuild_pool on long with its own timeout (a
    Cron job itself runs on `default` at 300 s). One at a time (deduplicated job id). -> True when enqueued."""
    frappe.enqueue("nirmaan_stack.services.boq_rate_match.pool.rebuild_pool", queue="long",
                   timeout=POOL_REBUILD_TIMEOUT_SEC, job_id="boq_match_pool_daily_rebuild", deduplicate=True)
    return True


# DEV2-B6 S1: the job id every pool rebuild is queued under - the 06:00 job's own (above), so a stale run's request,
# a second stale run and the 06:00 job never queue a twin while one is queued or running (frappe's deduplicate).
POOL_REBUILD_JOB_ID = "boq_match_pool_daily_rebuild"


def queue_pool_rebuild():
    """THE ONE BACKGROUND REBUILD a user's match run asks for when it used a STALE cached pool (DEV2-B6 S1; the pool
    rule in match_run.job_pool): pool.rebuild_pool on `long` with its own timeout, under POOL_REBUILD_JOB_ID.
    -> True when this call queued it; False when a rebuild under that id is already queued or running (nothing
    queued). Never raises: a failure to queue is logged and the run goes on with the pool it has."""
    from frappe.utils.background_jobs import is_job_enqueued
    try:
        if is_job_enqueued(POOL_REBUILD_JOB_ID):
            return False
        frappe.enqueue("nirmaan_stack.services.boq_rate_match.pool.rebuild_pool", queue="long",
                       timeout=POOL_REBUILD_TIMEOUT_SEC, job_id=POOL_REBUILD_JOB_ID, deduplicate=True)
        return True
    except Exception:  # noqa: BLE001 -- the run keeps the stale pool; the 06:00 job is the fallback
        frappe.log_error(title="BoQ match pool rebuild not queued", message=frappe.get_traceback())
        return False
