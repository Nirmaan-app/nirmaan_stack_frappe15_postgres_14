"""FILL SPEC CARDS - the ONE-TIME spec-card fill-in for the BoQs that exist before go-live (DEV2-B7).

WHY (owner 2026-11-04 12:40 - 12:45: "how can we build the spec cards of existing BoQs at once without triggering its
suggest rates ... so that the recent BoQs are also considered properly for matching"; "this is a one time exercise which
we will do after deployment"). Cards at commit (match_cards_at_commit, go-live checklist step 3.10) card every BoQ
committed after go-live; this tool cards every EARLIER PRICED row that still has no valid card. It runs once on
production after go-live, outside working hours. Card calls only: NO Suggest run, NO matching run, no setting written.

THE ROW SET is the pool's own corpus (pool._corpus: every current committed sheet's PRICED, RATE-EDITABLE rows - the
rows the matching pool is built from and reads cards for), minus test projects (pool.is_test_project: a test project's
row is never offered to a target).

VALID (R-H2W): a card is valid only for the row's CURRENT payload sha, the card prompt's current version and the AI
settings' card model, with status ok - exactly the pool's own lookup (match_index.StoredCards). Each row is one of:
  valid    it has a valid card                                                    -> skipped
  stale    no valid card, but an older card at its address (another payload /
           prompt / model)                                                        -> carded; the old card STAYS
  failed   its current key holds a malformed / failed card                       -> carded again (that row is updated)
  none     no card at all                                                         -> carded
An existing ok card is NEVER overwritten: a row with one is never sent, and cards.card_sheet only ever updates a stored
row of the SAME key that is not ok. A row whose payload equals an earlier row's in this run is left to that row's card
(cards are shared by payload sha).

HOW: per sheet, cards.card_sheet(boq, sheet, excel_rows=<that sheet's rows to card>) - the commit job's own function:
the same payload block, sha, prompt, batching (at most 20 rows, one sheet a request), call runner (its calls-at-once,
retry, 429 / burst stop and size guard), parse and store. This file adds no card logic.

ORDER: --newest-first (the default): BoQs by their latest sheet commit, newest first, so a run that is stopped early
has done the recent BoQs (the owner's reason); then sheet name, then Excel row. --no-newest-first: oldest first.

SAFE TO STOP AND RE-RUN: a sheet's cards are stored and committed as soon as that sheet's calls come back; a re-run
skips every row that is valid by then. A malformed, failed or refused row is listed in the report with its reason and
is not retried in this run (a later run tries it once more). A 429, a usage limit, a burst of failures, any error or
Ctrl+C stops the run cleanly: nothing more is sent and the summary is written.

WRITES: only `BoQ Row Spec Card` rows (through card_sheet; their tokens / USD are the spend record). --dry writes
nothing: the database connection is made read only and no model client is built.

usage (in the bench container, from frappe-bench):
  env/bin/python -I apps/nirmaan_stack/scripts/_instruments/fill_spec_cards.py --site <site> --dry [--report <f.json>]
  env/bin/python -I apps/nirmaan_stack/scripts/_instruments/fill_spec_cards.py --site <site> [--limit N]
      [--boq <name>]... [--no-newest-first] [--report <f.json>]
--limit N cards at most N rows; --boq (repeatable) only those BoQs. At the end it prints the one command that rebuilds
the pool (the pool reads cards when it is built); it never rebuilds by itself.
"""
import argparse
import collections
import json
import math
import os
import sys
import time

VALID, STALE, FAILED, NONE = "valid", "stale", "failed", "none"

# Projection inputs, MEASURED in DEV2-B7 P0 (d): output tokens a carded row = 495 (dev2's 1,338 cards made by real
# calls; the 61 archived DEV2-B4 card calls give 469); seconds a card call = 31.6 (mean of those 61 calls; p90 48.2).
# Input tokens are projected as the runner's own estimate, request chars / 2 (the real count measured ~0.8 of it).
OUT_TOKENS_PER_ROW = 495
SECS_PER_CALL = 31.6
TOP_BOQS = 20


def rebuild_command(site):
    """The one command that rebuilds the pool after a fill-in (printed, never run here)."""
    return f"bench --site {site} execute nirmaan_stack.services.boq_rate_match.pool.rebuild_pool"


# --- the rows (read only) ----------------------------------------------------------------------------------------

def load_rows():
    """(rows, test rows skipped, {boq: latest commit}) from the pool's corpus. A row: key, boq, sheet, row, disc,
    project_name and sha (cards.payload_sha256 of its payload block, as the pool and the card job compute it)."""
    import frappe
    from nirmaan_stack.services.boq_rate_match import cards as C, pool as P

    boqs, _sheets, _cells, _last, _desc, raw = P._corpus()
    rows, test = [], 0
    for r in raw:
        name = (boqs.get(r["boq"]) or {}).get("project_name")
        if P.is_test_project(name):
            test += 1
            continue
        rows.append({"key": f"{r['boq']}|{r['sheet']}|{r['row']}", "boq": r["boq"], "sheet": r["sheet"],
                     "row": r["row"], "disc": r.get("disc"), "project_name": name,
                     "sha": C.payload_sha256(r["payload"])})
    commits = {b: str(t or c) for b, t, c in frappe.db.sql(
        'select boq, max(committed_at), max(creation) from "tabBoQ Sheet" where is_current = 1 group by boq')}
    return rows, test, commits


def card_states(rows, version, model):
    """({payload sha: status under this prompt + model; ok wins}, {(boq, sheet, row) holding a card under another
    key}). Read only."""
    import frappe
    from nirmaan_stack.services.boq_rate_match import cards as C

    status = {}
    shas = sorted({r["sha"] for r in rows})
    for i in range(0, len(shas), 500):
        for c in frappe.get_all(C.CARD_DOCTYPE, fields=["payload_sha256", "status"],
                                filters={"payload_sha256": ["in", shas[i:i + 500]], "prompt_version": version,
                                         "model": model}):
            if status.get(c["payload_sha256"]) != C.STATUS_OK:
                status[c["payload_sha256"]] = c["status"]
    mine = {(r["boq"], r["sheet"], r["row"]): r["sha"] for r in rows}
    other = set()
    boq_names = sorted({r["boq"] for r in rows})
    for i in range(0, len(boq_names), 200):
        for c in frappe.get_all(C.CARD_DOCTYPE, fields=["boq", "sheet", "excel_row", "payload_sha256",
                                                         "prompt_version", "model"],
                                filters={"boq": ["in", boq_names[i:i + 200]]}):
            addr = (c["boq"], c["sheet"], c["excel_row"])
            if addr in mine and (c["payload_sha256"], c["prompt_version"], c["model"]) != (mine[addr], version, model):
                other.add(addr)
    return status, other


# --- pure: classify, order, select, project -----------------------------------------------------------------------

def classify(row, status, other):
    """valid / failed / stale / none for one row (see the module docstring)."""
    st = status.get(row["sha"])
    if st == "ok":
        return VALID
    if st:
        return FAILED
    if (row["boq"], row["sheet"], row["row"]) in other:
        return STALE
    return NONE


def order_rows(rows, commits, newest_first=True):
    """BoQs by latest commit (newest first by default; name breaks a tie the same way), then sheet, then row."""
    by_boq = sorted({r["boq"] for r in rows}, key=lambda b: (commits.get(b) or "", b), reverse=newest_first)
    rank = {b: i for i, b in enumerate(by_boq)}
    return sorted(rows, key=lambda r: (rank[r["boq"]], r["sheet"], r["row"]))


def select(rows, limit=None, boqs=None):
    """(groups [(boq, sheet, [excel_row])] in order, the rows chosen, rows left to an earlier row's equal payload,
    rows left out by --limit). `rows` are ordered and carry `cls`; only non-valid rows are chosen."""
    groups, chosen, seen = [], [], set()
    dup = over = 0
    for r in rows:
        if r["cls"] == VALID or (boqs and r["boq"] not in boqs):
            continue
        if r["sha"] in seen:
            dup += 1
            continue
        if limit is not None and len(chosen) >= limit:
            over += 1
            continue
        seen.add(r["sha"])
        chosen.append(r)
        if groups and groups[-1][0] == r["boq"] and groups[-1][1] == r["sheet"]:
            groups[-1][2].append(r["row"])
        else:
            groups.append((r["boq"], r["sheet"], [r["row"]]))
    return groups, chosen, dup, over


def project(plans, s):
    """The dry run's projection from the real plans: calls, rows, tokens (in = chars / 2; out = rows x the measured
    out-per-row), USD at the settings' prices, minutes (sheets run one after another; a sheet's calls run up to
    calls_at_once together, each wave ~SECS_PER_CALL)."""
    calls = sum(p["calls"] for p in plans)
    rows = sum(p["rows"] for p in plans)
    tin = int(sum(p["chars"] for p in plans) / 2)
    tout = rows * OUT_TOKENS_PER_ROW
    waves = sum(math.ceil(p["calls"] / max(1, int(s["calls_at_once"]))) for p in plans if p["calls"])
    return {"sheets": sum(1 for p in plans if p["calls"]), "calls": calls, "rows": rows, "tokens_in": tin,
            "tokens_out": tout, "tokens": tin + tout,
            "usd": round((tin * s["price_in"] + tout * s["price_out"]) / 1e6, 4),
            "minutes": round(waves * SECS_PER_CALL / 60, 1)}


def gap_tables(rows):
    """Counts by class, by discipline and the top BoQs by rows without a valid card."""
    by_cls = collections.Counter(r["cls"] for r in rows)
    disc = collections.defaultdict(collections.Counter)
    boq = collections.defaultdict(collections.Counter)
    names = {}
    for r in rows:
        k = VALID if r["cls"] == VALID else "missing"
        disc[r["disc"] or "(none)"][k] += 1
        boq[r["boq"]][k] += 1
        names[r["boq"]] = r.get("project_name")
    top = sorted((b for b in boq if boq[b]["missing"]), key=lambda b: (-boq[b]["missing"], b))[:TOP_BOQS]
    return ({c: by_cls[c] for c in (VALID, STALE, FAILED, NONE)},
            {d: {"valid": c[VALID], "missing": c["missing"]} for d, c in sorted(disc.items())},
            [{"boq": b, "project": names[b], "missing": boq[b]["missing"], "valid": boq[b][VALID]} for b in top])


# --- the run --------------------------------------------------------------------------------------------------------

def plan_groups(groups, model):
    """For --dry: cards.plan_sheet (the card job's own plan, read only) per sheet -> calls, rows, request chars."""
    from nirmaan_stack.services.boq_rate_match import cards as C

    out = []
    for boq, sheet, ers in groups:
        p = C.plan_sheet(boq, sheet, model, ers)
        out.append({"boq": boq, "sheet": sheet, "calls": len(p["batches"]),
                    "rows": sum(len(b["rows"]) for b in p["batches"]),
                    "chars": sum(len(b["content"]) for b in p["batches"]), "reused_since": len(p["reused"]),
                    "not_in_context": p["not_in_context"]})
    return out


def _row_outcomes(boq, sheet, ers, sha_of, summary, version, model):
    """After one sheet: each chosen row carded / failed (with the stored error) / not sent (with the reason)."""
    import frappe
    from nirmaan_stack.services.boq_rate_match import cards as C

    keys = [sha_of[er] for er in ers]
    got = {}
    for c in frappe.get_all(C.CARD_DOCTYPE, fields=["payload_sha256", "status", "card_json"],
                            filters={"payload_sha256": ["in", keys], "prompt_version": version, "model": model}):
        if (got.get(c["payload_sha256"]) or {}).get("status") != C.STATUS_OK:
            got[c["payload_sha256"]] = c
    why = "; ".join([f"refused {x.get('reason')}" + (f" ({x.get('detail')})" if x.get("detail") else "")
                     for x in summary.get("refused") or []]
                    + ([f"the run stopped: {summary['stop_reason']}"] if summary.get("stop_reason") else [])) or "not sent"
    carded, failed, not_sent = [], [], []
    for er in ers:
        key, c = f"{boq}|{sheet}|{er}", got.get(sha_of[er])
        if c and c["status"] == C.STATUS_OK:
            carded.append(key)
        elif c:
            body = json.loads(c["card_json"]) if isinstance(c["card_json"], str) else (c["card_json"] or {})
            failed.append({"key": key, "status": c["status"], "reason": str(body.get("error") or "")[:300]})
        elif er in (summary.get("not_in_context") or []):
            not_sent.append({"key": key, "reason": "the row is no longer in the sheet's committed context"})
        else:
            not_sent.append({"key": key, "reason": why})
    return carded, failed, not_sent


def card_groups(groups, chosen, s, client, progress=print):
    """The real run: cards.card_sheet per sheet, in order; stops at the first stop reason or error (or Ctrl+C)."""
    from nirmaan_stack.services.boq_rate_match import cards as C

    version = C.prompt_version()
    sha_of = {(r["boq"], r["sheet"], r["row"]): r["sha"] for r in chosen}
    res = {"sheets_done": 0, "calls": 0, "carded": [], "failed": [], "not_sent": [], "stop_reason": None,
           "stop_detail": None, "tokens_in": 0, "tokens_out": 0, "spent_usd": 0.0}
    for i, (boq, sheet, ers) in enumerate(groups):
        try:
            summary = C.card_sheet(boq, sheet, excel_rows=ers, client=client, settings=s)
        except KeyboardInterrupt:
            res["stop_reason"], res["stop_detail"] = "interrupted", "Ctrl+C during this sheet"
            summary = None
        except Exception as e:  # noqa: BLE001 -- a clean stop with the summary written, never a half-written run
            import frappe
            frappe.db.rollback()
            res["stop_reason"], res["stop_detail"] = "error", f"{boq}|{sheet}: {type(e).__name__}: {str(e)[:300]}"
            summary = None
        if summary is None:
            for b, sh, rs in groups[i:]:
                res["not_sent"] += [{"key": f"{b}|{sh}|{er}", "reason": f"the run stopped: {res['stop_reason']}"}
                                    for er in rs]
            break
        sent = summary["batches"] - len(summary.get("refused") or []) - len(summary.get("not_sent") or [])
        res["calls"] += max(0, sent)
        res["tokens_in"] += summary.get("tokens_in") or 0
        res["tokens_out"] += summary.get("tokens_out") or 0
        res["spent_usd"] = round(res["spent_usd"] + (summary.get("spent_usd") or 0), 6)
        carded, failed, not_sent = _row_outcomes(boq, sheet, ers, {er: sha_of[(boq, sheet, er)] for er in ers},
                                                 summary, version, s["model"])
        res["carded"] += carded
        res["failed"] += failed
        res["not_sent"] += not_sent
        res["sheets_done"] += 1
        progress(f"[{i + 1}/{len(groups)}] {boq} | {sheet}: {len(ers)} rows -> ok {len(carded)}, failed "
                 f"{len(failed)}, not sent {len(not_sent)}; spent ${res['spent_usd']:.4f}", flush=True)
        if summary.get("stop_reason"):
            res["stop_reason"], res["stop_detail"] = summary["stop_reason"], summary.get("stop_detail")
            for b, sh, rs in groups[i + 1:]:
                res["not_sent"] += [{"key": f"{b}|{sh}|{er}", "reason": f"the run stopped: {res['stop_reason']}"}
                                    for er in rs]
            break
    return res


def fill(*, dry, limit=None, boqs=None, newest_first=True, client=None, settings=None, loader=None,
         progress=print):
    """Select, then plan (dry) or card (real). -> the report dict. `loader` and `client` are seams for tests."""
    from nirmaan_stack.api.boq.wizard.ai_settings import require_match_settings
    from nirmaan_stack.services.boq_rate_match import call_runner, cards as C

    t0 = time.time()
    s = settings or require_match_settings("card")       # refuses an empty card model or price before any read
    version = C.prompt_version()
    rows, test, commits = (loader or load_rows)()
    status, other = card_states(rows, version, s["model"])
    for r in rows:
        r["cls"] = classify(r, status, other)
    rows = order_rows(rows, commits, newest_first)
    groups, chosen, dup, over = select(rows, limit, set(boqs) if boqs else None)
    by_cls, by_disc, top = gap_tables(rows)
    rep = {"dry": dry, "model": s["model"], "prompt_version": version,
           "options": {"limit": limit, "boqs": sorted(boqs) if boqs else None, "newest_first": newest_first},
           "settings": {k: s.get(k) for k in ("calls_at_once", "retry_wait_s", "burst_failures", "burst_window_s",
                                              "max_request_tokens", "reply_max_tokens", "price_in", "price_out")},
           "rows": {"pool_rows": len(rows) + test, "test_rows_skipped": test, "considered": len(rows), **by_cls,
                    "to_card": len(chosen), "left_to_an_equal_payload": dup, "left_by_limit": over},
           "by_discipline": by_disc, "top_boqs": top,
           "first_boqs": [g[0] for g in groups[:5]], "sheets": len(groups)}
    if dry:
        plans = plan_groups(groups, s["model"])
        rep["projection"] = project(plans, s)
        rep["projection"]["reused_since_selection"] = sum(p["reused_since"] for p in plans)
    else:
        if groups and client is None:
            client = call_runner.make_client()      # refuses when the AI settings are off or no key is set
        rep["result"] = card_groups(groups, chosen, s, client, progress)
        rep["result"]["rows_per_call"] = (round(len(rep["result"]["carded"]) / rep["result"]["calls"], 2)
                                          if rep["result"]["calls"] else None)
    rep["seconds"] = round(time.time() - t0, 1)
    return rep


def _print(rep, site):
    r = rep["rows"]
    print(f"rows: pool {r['pool_rows']} (test projects skipped {r['test_rows_skipped']}); valid {r['valid']}, "
          f"stale {r['stale']}, failed {r['failed']}, none {r['none']}; to card {r['to_card']} (left to an equal "
          f"payload {r['left_to_an_equal_payload']}, left by --limit {r['left_by_limit']}); sheets {rep['sheets']}")
    for d, c in rep["by_discipline"].items():
        print(f"  discipline {d}: valid {c['valid']}, missing {c['missing']}")
    for b in rep["top_boqs"]:
        print(f"  {b['boq']} ({b['project']}): missing {b['missing']}, valid {b['valid']}")
    if "projection" in rep:
        p = rep["projection"]
        print(f"DRY - nothing written. Would send {p['calls']} calls for {p['rows']} rows over {p['sheets']} sheets: "
              f"~{p['tokens']} tokens (in {p['tokens_in']}, out {p['tokens_out']}), ~${p['usd']}, ~{p['minutes']} min")
    if "result" in rep:
        x = rep["result"]
        print(f"CARDED {len(x['carded'])} rows in {x['calls']} calls; failed {len(x['failed'])}; not sent "
              f"{len(x['not_sent'])}; tokens {x['tokens_in']} + {x['tokens_out']}; ${x['spent_usd']}; stop "
              f"{x['stop_reason'] or 'none'}" + (f" ({x['stop_detail']})" if x["stop_detail"] else ""))
        for f in x["failed"][:20]:
            print(f"  failed {f['key']}: {f['status']} - {f['reason']}")
        print("Re-run the same command to continue; rows now valid are skipped.")
    print(f"seconds {rep['seconds']}")
    print(f"NEXT - rebuild the pool once, so matching reads the new cards: {rebuild_command(site)}")


def main():
    ap = argparse.ArgumentParser(description="The one-time spec-card fill-in for earlier priced rows (no Suggest).")
    ap.add_argument("--site", required=True)
    ap.add_argument("--dry", action="store_true", help="count and project only; write nothing")
    ap.add_argument("--limit", type=int, default=None, help="card at most N rows")
    ap.add_argument("--boq", action="append", default=None, help="only this BoQ (repeatable)")
    ap.add_argument("--newest-first", action=argparse.BooleanOptionalAction, default=True)
    ap.add_argument("--report", default=None, help="write the JSON summary here")
    a = ap.parse_args()
    out_path = os.path.abspath(a.report) if a.report else None
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "sites"))
    import frappe

    frappe.init(site=a.site)
    frappe.connect()
    frappe.set_user("Administrator")
    rep = None
    try:
        if a.dry:
            frappe.db.sql("select 1")
            frappe.db._conn.rollback()
            frappe.db._conn.set_session(readonly=True)   # --dry writes nothing: Postgres refuses any write
        rep = fill(dry=a.dry, limit=a.limit, boqs=a.boq, newest_first=a.newest_first)
    finally:
        frappe.db.rollback()
        frappe.destroy()
        if rep is not None:
            rep["next"] = rebuild_command(a.site)
        if rep is not None and out_path:
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(rep, f, indent=1, ensure_ascii=False, default=str)
    _print(rep, a.site)
    return 1 if (rep.get("result") or {}).get("stop_reason") else 0


if __name__ == "__main__":
    sys.exit(main())
