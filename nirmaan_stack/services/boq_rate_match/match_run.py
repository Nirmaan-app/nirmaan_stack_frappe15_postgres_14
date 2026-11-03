# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""THE MATCH RUN (DEV2-B4 S2): one historical-match pass over a sheet, after its COMPLETE Suggest run.

    run_match(run_name, *, only_rows=None, resume=False, client=None, card_client=None, progress=None) -> summary

Called by the match job (api/boq/rate_match._match_worker). Steps, each timed:
  1. job_pool       THE POOL RULE (DEV2-B6 S1, below): a cached pool file is always USED - a stale one too, noted
                    "pool stale" in usage.pool with the stamp it used, and ONE background rebuild queued; built
                    inline only when no usable file exists (the 06:00 IST rebuild keeps it fresh);
  2. targets        the Suggest run's own rows: every row of the run, or `only_rows` (a selected-row Suggest), or on
                    a resume the rows the previous match run at the same committed version has not matched;
  3. cards          cards.card_sheet for the target rows -- REUSE FIRST (a stored ok card is never re-asked); paid
                    card calls only for rows missing one (card settings);
  4. lanes          match_targets.lanes_forked on `match_lane_workers` forked processes sharing the one loaded pool;
                    a BoQ's identical rows are judged once (lanes.dedupe_targets);
  5. judge          judge.prepare + judge.judge_items (J10h's request, the judge settings, N1b), through the safe call
                    runner (calls at once, retry / stop rule, size guard; NO cost cap -- spend is recorded);
  6. store          the results, IN DISPLAY ORDER (owner 2026-11-03 11:06): green, then amber, then red; within a
                    colour the judge's own order; DIFFERENT never shown. Each match carries its candidate key
                    (boq / sheet / excel_row), verdict, colour, N1b note, the pool row's supply / install / total
                    rate as stored (BoQ Cell Pricing), unit and date priced; plus the judge's raw order.
A selected-row pass CARRIES every other row's entry from the previous ACTIVE match run at the same committed version
(marked carried). COMPLETE -> active=1 and the prior active run retired (kept); a stop of the call runner (429, usage
limit, ...) -> halted with the reason, active stays 0; any error -> the caller marks the run failed. The Suggest run
is only ever READ here.
"""
import json
import os
import time

import frappe

MATCH_DOCTYPE = "BoQ Rate Match Run"
SUGGEST_DOCTYPE = "BoQ Rate Suggestion Run"
JUDGE_SEED = 20262022            # J10h's shuffle seed (DEV2-S8 / the bench manifest); recorded in usage
DISPLAY_RANK = {"green": 0, "amber": 1, "red": 2}


class MatchRefused(Exception):
    """The run cannot proceed; str(exc) is the plain reason stored on the match run."""


def display_order(vmap):
    """The shown matches in DISPLAY ORDER: green, amber, red; within a colour the judge's own order (its reply's
    "order" position, before N1b). DIFFERENT is never shown (judge.matches drops it)."""
    from nirmaan_stack.services.boq_rate_match import judge as J
    return sorted(J.matches(vmap), key=lambda m: (DISPLAY_RANK[m["colour"]], vmap[m["key"]]["pos"]))


def judge_raw_order(x):
    """The judge's own order, before N1b: [{key, verdict}] by its reply's position."""
    raw = x.get("raw_verdicts") or {}
    return [{"key": k, "verdict": raw[k]["v"]} for k in sorted(raw, key=lambda k: raw[k]["pos"])]


def match_entry(m, pool):
    """One shown match with the candidate pool row's identity and its rates AS STORED (no price logic here)."""
    r = pool.rows[pool.byk[m["key"]]]
    rates, at = r.get("rates") or {}, r.get("rate_at") or {}
    return {**m, "boq": r["boq"], "sheet_name": r["sheet"], "excel_row": r["row"],
            "supply_rate": rates.get("supply_rate"), "install_rate": rates.get("install_rate"),
            "total_rate": rates.get("combined_rate"), "unit": r.get("unit_raw"),
            "priced_at": max(at.values()) if at else None}


def row_entry(t, x, pool, first_row=None):
    """A target row's stored entry from its judge outcome `x` (None = no candidate list, nothing was asked)."""
    out = {"excel_row": t["excel_row"], "target_key": t["key"], "matches": [], "judge_order": [], "no_verdict": None,
           "same_as_row": first_row, "carried": False}
    if x is None:
        out["status"] = "no candidates"
        return out
    if x.get("no_verdict"):
        out.update(status="no verdict", no_verdict=x["no_verdict"])
        return out
    shown = display_order(x["verdicts"])
    out.update(matches=[match_entry(m, pool) for m in shown], judge_order=judge_raw_order(x),
               status="matched" if shown else "no match shown")
    return out


class _Progress:
    """Wraps the judge's client: each landed reply marks its target's rows done (a BoQ's identical rows count as
    one call). The content -> rows map is built from the requests; no model call happens here.

    ⚠️ It only COUNTS. It runs on the call runner's own threads, where frappe.local (frappe.db, the cache, realtime)
    is not bound: touching it there raised "object is not bound", which the runner read as a connection error and
    stopped the run (DEV2-B4 S4 attempt 1). The job's main thread reads `done` and reports it (_judge_with_progress)."""

    def __init__(self, client, rows_by_content, done_before):
        import threading
        self.client, self.rows_by_content, self.done = client, rows_by_content, done_before
        self.lock = threading.Lock()
        self.messages = self

    def create(self, **kw):
        resp = self.client.messages.create(**kw)
        with self.lock:
            self.done += self.rows_by_content.get(kw["messages"][0]["content"], 1)
        return resp


def _judge_with_progress(judge, wrapped, report, every_s=2.0):
    """Run `judge()` (which touches no frappe state) on its own thread; the CALLER's thread - the one frappe is bound
    to - reports wrapped.done as it moves. Re-raises the judge's error."""
    import threading
    box = {}

    def go():
        try:
            box["out"] = judge()
        except BaseException as exc:  # noqa: BLE001 -- re-raised on the caller's thread below
            box["err"] = exc

    th = threading.Thread(target=go, daemon=True)
    th.start()
    last = None
    while th.is_alive():
        th.join(every_s)
        if wrapped is not None and wrapped.done != last:
            last = wrapped.done
            report("judge", last)
    if "err" in box:
        raise box["err"]
    return box["out"]


def job_pool(path=None, builder=None, queue_rebuild=None):
    """THE POOL RULE for a user's match run (DEV2-B6 S1; DEV2-B5 A11: 440 s of pass 2's 481.8 s was an inline rebuild
    after the pricing stamp moved). A run never waits for a rebuild while a cached pool file exists:
      fresh and current   used as is; nothing queued.
      STALE               its pricing stamp is no longer current, or the file is older than 24 h: USED as it is; the
                          run notes "pool stale" and the stamp it used (usage.pool - no new field); ONE background
                          rebuild is queued (rate_match.queue_pool_rebuild: long, the 06:00 job's id, never a twin).
      no usable file      missing, unreadable or another format: built inline as before (pool.ensure_pool, under its
                          one lock); a lock wait that times out -> MatchRefused "pool not ready: ...".
    The 06:00 job and pool.rebuild_pool are unchanged. `path` / `builder` / `queue_rebuild` are seams (tests).
    -> (pool, {"rebuilt", "stale", "stamp_used", "stamp_current", "rebuild_queued"})."""
    from filelock import Timeout
    from nirmaan_stack.services.boq_rate_match import pool as P

    path = path or P.pool_path()
    stamp = P._current_stamp()
    cached = None
    if os.path.exists(path):
        try:
            cached = P.load_pool(path)
        except Exception as exc:  # noqa: BLE001 -- unusable: built inline below
            frappe.logger("boq_rate_match").warning("match pool file unreadable: %s: %s", type(exc).__name__, exc)
        if cached is not None and getattr(cached, "format", None) != P.POOL_FORMAT:
            cached = None
    if cached is not None:
        used = (cached.pricing or {}).get("stamp")
        why = [w for w, bad in (("pricing stamp changed", used != stamp), ("older than 24 h", not P.is_fresh(path))) if bad]
        info = {"rebuilt": False, "stale": None, "stamp_used": used, "stamp_current": stamp, "rebuild_queued": False}
        if why:
            if queue_rebuild is None:
                from nirmaan_stack.api.boq.rate_match import queue_pool_rebuild as queue_rebuild
            info.update(stale="pool stale: " + ", ".join(why), rebuild_queued=bool(queue_rebuild()))
        return cached, info
    try:
        pool, rebuilt = P.ensure_pool(path=path, builder=builder)
    except Timeout:
        raise MatchRefused("pool not ready: the earlier-BoQ pool is being built by another job")
    return pool, {"rebuilt": rebuilt, "stale": None, "stamp_used": (pool.pricing or {}).get("stamp"),
                  "stamp_current": stamp, "rebuild_queued": False}


def _previous_active(boq, sheet_name, cv, exclude):
    rows = frappe.get_all(MATCH_DOCTYPE, filters={"boq": boq, "sheet_name": sheet_name, "active": 1,
                                                  "status": "complete", "name": ["!=", exclude]},
                          fields=["name", "commit_version", "results"], order_by="creation desc", limit=1)
    if not rows or rows[0]["commit_version"] != cv:
        return None, {}
    res = rows[0]["results"]
    res = json.loads(res) if isinstance(res, str) else (res or {})
    return rows[0]["name"], {int(e["excel_row"]): e for e in res.get("rows") or []}


def run_match(run_name, *, only_rows=None, resume=False, client=None, card_client=None, progress=None,
              settings=None, card_settings=None, workers=None):
    """Run one match pass into the match run `run_name` (status queued -> running -> complete / halted). Raises on
    an error (the caller marks the run failed). -> {"status", "rows_total", "rows_done", "halt_reason", "usage"}."""
    from nirmaan_stack.api.boq.wizard import ai_settings as AS
    from nirmaan_stack.services.boq_rate_match import call_runner, cards as C, judge as J, lanes as L
    from nirmaan_stack.services.boq_rate_match import match_targets as MTG, pricing_step as PS

    report = progress or (lambda phase, done: None)
    secs, t0 = {}, time.time()
    run = frappe.db.get_value(MATCH_DOCTYPE, run_name, ["boq", "sheet_name", "commit_version", "suggest_run"], as_dict=True)
    boq, sheet = run["boq"], run["sheet_name"]
    if not AS.get_boq_match_settings().get("match_enabled"):
        raise MatchRefused("Historical matching is switched off (match_enabled).")
    js = settings or AS.require_match_settings("judge")
    cs = card_settings or AS.require_match_settings("card")
    nw = workers or AS.match_lane_workers()
    srun = frappe.db.get_value(SUGGEST_DOCTYPE, run["suggest_run"], ["name", "active", "status", "committed_version",
                                                                      "results", "boq", "sheet_name"], as_dict=True)
    if not srun or srun["status"] != "complete" or not srun["active"] or (srun["boq"], srun["sheet_name"]) != (boq, sheet):
        raise MatchRefused("The Suggest run this match follows is no longer the sheet's active complete run.")
    cv = srun["committed_version"]
    frappe.db.set_value(MATCH_DOCTYPE, run_name, {"status": "running", "commit_version": cv})
    frappe.db.commit()

    report("pool", 0)
    tp = time.time()
    pool, pool_info = job_pool()
    secs["pool"] = round(time.time() - tp, 1)

    res_rows = srun["results"]
    res_rows = json.loads(res_rows) if isinstance(res_rows, str) else (res_rows or [])
    all_rows = sorted({int(x["excel_row"]) for x in res_rows})
    prev_name, prev = _previous_active(boq, sheet, cv, run_name)
    if only_rows:
        scope = sorted(set(int(r) for r in only_rows) & set(all_rows))
    elif resume:
        scope = [r for r in all_rows if r not in prev]
    else:
        scope = all_rows
    carried = {er: {**e, "carried": True} for er, e in prev.items() if er in set(all_rows) - set(scope)} if (only_rows or resume) else {}
    frappe.db.set_value(MATCH_DOCTYPE, run_name, {"rows_total": len(scope), "rows_done": 0}, update_modified=False)
    frappe.db.commit()

    report("cards", 0)
    tc = time.time()
    card_sum = C.card_sheet(boq, sheet, excel_rows=scope, client=card_client, settings=cs) if scope else {}
    secs["cards"] = round(time.time() - tc, 1)

    tt = time.time()
    asset = PS.load_asset()
    targets, tinfo = MTG.build_targets(boq, sheet, scope, pool, asset)
    groups = L.dedupe_targets(targets, pool)
    firsts = [g[0] for g in groups.values()]
    secs["targets"] = round(time.time() - tt, 1)

    report("lanes", 0)
    tl = time.time()
    lists = list(zip(firsts, MTG.lanes_forked(firsts, pool, nw)))
    secs["lanes"] = round(time.time() - tl, 1)

    tpr = time.time()
    items, pinfo = J.prepare(lists, pool, asset=asset)
    secs["prepare"] = round(time.time() - tpr, 1)
    reqs, _calls = J.requests_for(items, JUDGE_SEED, js)
    size = {g[0]["id"]: len(g) for g in groups.values()}
    asked = {r["id"] for r in reqs}
    done0 = sum(size[f["id"]] for f in firsts if f["id"] not in asked)      # rows with nothing to judge
    by_content = {r["content"]: size[r["id"]] for r in reqs}
    report("judge", done0)
    tj = time.time()
    wrapped = _Progress(client or call_runner.make_client(), by_content, done0) if reqs else None
    jr = (_judge_with_progress(lambda: J.judge_items(items, seed=JUDGE_SEED, settings=js, client=wrapped), wrapped, report)
          if reqs else {"targets": {}, "run": {}})
    secs["judge"] = round(time.time() - tj, 1)

    report("storing", len(scope))
    entries = dict(carried)
    for members in groups.values():
        x = jr["targets"].get(members[0]["id"])
        for m in members:
            entries[m["excel_row"]] = row_entry(m, x, pool, None if m is members[0] else members[0]["excel_row"])
    for er in tinfo["not_in_run"]:
        entries[er] = {"excel_row": er, "target_key": f"{boq}|{sheet}|{er}", "matches": [], "judge_order": [],
                       "no_verdict": None, "same_as_row": None, "carried": False, "status": "not in the Suggest run"}
    run_r = jr.get("run") or {}
    stop = run_r.get("stop_reason")
    usage = {
        "cards": {k: card_sum.get(k) for k in ("reused", "batches", "ok", "malformed", "failed", "spent_usd", "tokens_in",
                                              "tokens_out", "stop_reason", "refused", "not_sent")},
        "judge": {"calls": len(reqs), "tokens_in": run_r.get("tokens_in", 0), "tokens_out": run_r.get("tokens_out", 0),
                  "spent_usd": run_r.get("spent_usd", 0.0), "stop_reason": stop, "refused": run_r.get("refused", []),
                  "not_sent": run_r.get("not_sent", []), "max_in_flight": run_r.get("max_in_flight"),
                  "seed": JUDGE_SEED, "model": js["model"]},
        "seconds": {**secs, "total": round(time.time() - t0, 1)},
        "lane_workers": nw, "pool": {"as_of": pool.as_of, "rows": len(pool.rows), **pool_info},
        "rows": {"targets": len(targets), "judged_once": len(firsts), "carried": len(carried), "with_card": tinfo["with_card"]},
        "scope": scope if (only_rows or resume) else None, "carried_from": prev_name if carried else None,
        "pricing": {**{k: tinfo[k] for k in ("pricing_available", "pricing_reason")}, "prepare": pinfo},
    }
    status = "halted" if stop else "complete"
    halt = f"The call runner stopped: {stop} ({run_r.get('stop_detail')})" if stop else None
    values = {"results": json.dumps({"rows": [entries[k] for k in sorted(entries)]}, ensure_ascii=False, default=str),
              "usage": json.dumps(usage, default=str), "status": status, "halt_reason": halt, "rows_done": len(scope),
              "run_at": frappe.utils.now()}
    if status == "complete":
        values["active"] = 1
        for prior in frappe.get_all(MATCH_DOCTYPE, filters={"boq": boq, "sheet_name": sheet, "active": 1}, pluck="name"):
            if prior != run_name:
                frappe.db.set_value(MATCH_DOCTYPE, prior, "active", 0, update_modified=False)
    frappe.db.set_value(MATCH_DOCTYPE, run_name, values)
    frappe.db.commit()
    return {"status": status, "rows_total": len(scope), "rows_done": len(scope), "halt_reason": halt, "usage": usage}
