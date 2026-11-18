"""The flows of the N-worker check (spec #1654), run inside a dev env by `walk_background_operations.py`.

    devenv.sh script <task> .claude/skills/verify/bin/background_operations_flows.py --workers N [--runs R]
        [--flows clone,classify,suggest] [--round-timeout 300]

It waits until N workers listen on the env's `long` queue, then runs each flow `--runs` times (default: the flow's
own count, 10 for clone and classify, 5 for suggest). One run of a flow
starts its operations at once, as Administrator through the same endpoints the screens call, and waits for each
operation's outcome where the screen reads it (the status the polling fallback returns):

- clone: N template clones at once (`create_from_template`, the active master's largest data sheet each). An
  operation is ok when its clone status is success and the new BoQ holds one Review Row per template row.
- classify: ceil(N/2) Classify clicks at once, each on its own committed sheet with Electrical and HVAC rows, and
  each click starts both engines (`start_classify` per engine, as `ClassifySheetDialog` does). An operation (one
  engine) is ok when its classify status is success.
- suggest: N rate suggests at once, each on its own committed sheet that passes the suggest gate (`start_suggest`,
  whole sheet, as the Suggest rates dialog does). An operation is ok when its suggest status is success for that
  sheet and, when the suggest started a historical match run (the match switch is on), that match run ends without
  an error. A suggest whose status falls back to idle with no outcome (the screen would spin) is a failure.

Every flow runs with the BoQ AI setting switched off (the env holds a real key): the setting is read first, switched
off, and put back to what it was when the flows end. With it off, classify still writes every row's category (the
rule category, flagged for review), a suggest still writes its run (every row's attributes blank, `ai_status`
disabled), and a match run asks no model (the match client refuses while the setting is off). A classify or suggest
reply that says the AI ran counts as a failure.

Prints one line per run and, last, `JSON: {...}` with every operation's outcome. A later ticket adds a flow as one
more function in FLOWS. Writes stay in the env DB: a made-up project ("Background operations check") holds the
cloned BoQs, and the classified sheets get new current category rows.
"""

import argparse
import json
import math
import signal
import sys
import threading
import time

import frappe
from frappe.utils.background_jobs import get_queue
from rq import Worker

from nirmaan_stack.api.boq import rate_master, rate_match
from nirmaan_stack.api.boq.wizard import classify, create_from_template, pricing
from nirmaan_stack.api.boq.wizard.ai_settings import SETTINGS_DOCTYPE
from nirmaan_stack.services.boq_category import persist
from nirmaan_stack.services.boq_rate_master import extraction
from nirmaan_stack.services.series_lock import boq_series, recent_waits

ENGINES = ("Electrical", "HVAC")
PROJECT_NAME = "Background operations check"


def wait_for_workers(n, timeout=90):
    """Block until n workers listen on this env's long queue; refuse a different count."""
    queue = get_queue("long")
    deadline = time.monotonic() + timeout
    while True:
        alive = [w for w in Worker.all(queue=queue) if w.state != "suspended"]
        if len(alive) == n:
            print(f"workers: {n} listening on {queue.name}", flush=True)
            return
        if time.monotonic() > deadline:
            raise SystemExit(f"expected {n} workers on {queue.name}, found {len(alive)}")
        time.sleep(1)


def wait_until(pending, read, timeout):
    """Poll `read(op)` for every op until each returns an outcome (not None) or the timeout passes."""
    deadline = time.monotonic() + timeout
    out = {}
    while pending and time.monotonic() < deadline:
        frappe.local.cache.clear()  # Frappe keeps a cache read (even a miss) for the life of the process
        for op in list(pending):
            got = read(op)
            if got is not None:
                out[op] = got
                pending.remove(op)
        if pending:
            time.sleep(0.5)
    for op in pending:
        out[op] = {"ok": False, "detail": f"no outcome after {timeout} s"}
    return out


# ── clone ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def check_project():
    name = frappe.db.get_value("Projects", {"project_name": PROJECT_NAME}, "name")
    if name:
        return name
    proj = frappe.new_doc("Projects")
    proj.project_name = PROJECT_NAME
    proj.project_start_date = frappe.utils.now()[:19]
    proj.project_end_date = frappe.utils.add_to_date(frappe.utils.now()[:19], years=1)[:19]
    proj.project_scopes = {"scopes": []}
    proj.insert(ignore_permissions=True)
    frappe.db.commit()
    return proj.name


def clone_setup(workers):
    master = create_from_template._get_active_master()
    if not master:
        raise SystemExit("clone: no active master template on this env")
    rows = frappe.db.sql(
        """select r.sheet_name, count(*) from `tabBoQ Template Row` r
           join `tabBoQ Template Sheet` s on s.parent = r.template and s.sheet_name = r.sheet_name
           where r.template = %s and s.disposition = 'data' group by r.sheet_name order by count(*) desc limit 1""",
        master.name,
    )
    sheet, expected = rows[0]
    print(f"clone: {workers} at once of template sheet {sheet!r} ({expected} rows each)", flush=True)
    return {"project": check_project(), "sheet": sheet, "expected": expected, "at_once": workers}


def at_once(calls):
    """Run each call on its own thread and DB connection, all released together (N users clicking at once), as
    Administrator; return their replies, or raise the first error."""
    site, sites_path = frappe.local.site, frappe.local.sites_path
    gate = threading.Barrier(len(calls))
    replies = [None] * len(calls)

    def one(i, call):
        frappe.init(site=site, sites_path=sites_path)
        frappe.connect()
        try:
            frappe.set_user("Administrator")
            gate.wait()
            replies[i] = call()
            frappe.db.commit()
        except Exception as e:
            replies[i] = e
        finally:
            frappe.destroy()

    threads = [threading.Thread(target=one, args=(i, c)) for i, c in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    for reply in replies:
        if isinstance(reply, Exception):
            raise reply
    return replies


def clone_run(ctx, run, timeout):
    """The N creates start at once, so their BoQ number inserts overlap on the BoQ series lock (#1659)."""
    replies = at_once([
        lambda i=i: create_from_template.create_from_template(
            project=ctx["project"], boq_name=f"Background operations check {run}-{i + 1}", sheet_names=[ctx["sheet"]]
        )
        for i in range(ctx["at_once"])
    ])
    started = {reply["job_id"]: reply["boq_id"] for reply in replies}

    def read(job_id):
        status = create_from_template.get_clone_status(job_id)
        if status.get("state") != "done":
            return None
        boq = started[job_id]
        if status.get("status") != "success":
            return {"ok": False, "detail": f"clone of {boq}: {status.get('status')} {status.get('error_code')}"}
        frappe.db.rollback()  # a fresh snapshot: the worker committed after this transaction began
        rows = frappe.db.count("BoQ Review Row", {"boq": boq})
        if rows != ctx["expected"]:
            return {"ok": False, "detail": f"clone of {boq}: {rows} review rows, expected {ctx['expected']}"}
        return {"ok": True, "detail": f"clone of {boq}: {rows} rows"}

    return wait_until(set(started), read, timeout)


# ── classify ──────────────────────────────────────────────────────────────────────────────────────────────────────
def classify_sheets(count):
    """`count` committed current sheets, not classification-frozen, that hold Electrical and HVAC categories."""
    rows = frappe.db.sql(
        """select c.boq, c.sheet_name, s.commit_version from `tabBoQ Row Category` c
           join `tabBoQ Sheet` s on s.boq = c.boq and s.sheet_name = c.sheet_name and s.is_current = 1
                and s.commit_version = c.committed_version
           where c.is_current = 1 and c.discipline in %s
           group by c.boq, c.sheet_name, s.commit_version
           having count(distinct c.discipline) = 2 and count(*) between 150 and 500
           order by c.boq desc, c.sheet_name""",
        (ENGINES,),
    )
    picked = [(b, s) for b, s, cv in rows if not persist.is_sheet_classification_frozen(b, s, cv)][:count]
    if len(picked) < count:
        raise SystemExit(f"classify: needs {count} sheets with both engines' rows, found {len(picked)}")
    return picked


def classify_setup(workers):
    clicks = math.ceil(workers / 2)
    sheets = classify_sheets(clicks)
    print(f"classify: {clicks} two-engine clicks at once, on {sheets}", flush=True)
    return {"sheets": sheets}


def classify_run(ctx, run, timeout):
    started = []
    for boq, sheet in ctx["sheets"]:
        for engine in ENGINES:
            classify.start_classify(boq=boq, sheet_name=sheet, discipline=engine, scope={"mode": "sheet"})
            started.append((boq, sheet, engine))

    def read(op):
        status = classify.get_classify_status(*op)
        if status.get("state") != "done":
            return None
        what = f"classify {op[2]} on {op[0]} {op[1]!r}"
        if status.get("status") != "success":
            return {"ok": False, "detail": f"{what}: {status.get('status')} {status.get('error_code')}"}
        if status.get("ai_status") not in ("disabled", "no_key"):
            return {"ok": False, "detail": f"{what}: the AI voter ran ({status.get('ai_status')})"}
        return {"ok": True, "detail": f"{what}: {status.get('eligible_classified')} rows"}

    return wait_until(set(started), read, timeout)


# ── suggest ───────────────────────────────────────────────────────────────────────────────────────────────────────
def suggest_sheets(count):
    """`count` committed current sheets on `count` different BoQs, newest BoQ first, that pass the suggest gate
    (unlocked, formulas declared, every eligible row categorised) and hold 20 to 300 rate-editable rows."""
    rows = frappe.db.sql(
        """select boq, sheet_name, commit_version from `tabBoQ Sheet` where is_current = 1 and commit_version > 0
           order by boq desc, sheet_name"""
    )
    picked, boqs = [], set()
    for boq, sheet, cv in rows:
        if boq in boqs:
            continue
        if (pricing._get_sheet_is_locked(boq, sheet, cv) or not pricing._sheet_formulas_complete(boq, sheet, cv)
                or not pricing._categories_gate_ok(boq, sheet, cv)):
            continue
        if not 20 <= len(extraction.assemble_population(boq, sheet)[1]) <= 300:
            continue
        picked.append((boq, sheet))
        boqs.add(boq)
        if len(picked) == count:
            return picked
    raise SystemExit(f"suggest: needs {count} sheets that pass the suggest gate, found {len(picked)}")


def suggest_setup(workers):
    sheets = suggest_sheets(workers)
    print(f"suggest: {workers} at once, on {sheets}", flush=True)
    return {"sheets": sheets}


def suggest_run(ctx, run, timeout):
    for boq, sheet in ctx["sheets"]:
        rate_master.start_suggest(boq=boq, sheet_name=sheet)

    def read(op):
        boq, sheet = op
        what = f"suggest on {boq} {sheet!r}"
        status = rate_master.get_suggest_status(boq=boq, sheet_name=sheet)
        if status.get("state") == "running":
            return None
        if status.get("state") != "done":
            return {"ok": False, "detail": f"{what}: no outcome, the status reads {status.get('state')}"}
        if (status.get("boq"), status.get("sheet_name")) != op:
            return {"ok": False, "detail": f"{what}: the status holds another sheet's run"}
        if status.get("status") != "success":
            return {"ok": False, "detail": f"{what}: {status.get('status')} {status.get('error_code')}"}
        if status.get("ai_status") != "disabled":
            return {"ok": False, "detail": f"{what}: the AI ran ({status.get('ai_status')})"}
        match = status.get("match")
        if match is None:
            return {"ok": True, "detail": f"{what}: {status.get('attempted_count')} rows, no match (switch off)"}
        if not match.get("queued"):
            return {"ok": False, "detail": f"{what}: its match run did not start: {match.get('reason')}"}
        m = rate_match.get_match_status(boq=boq, sheet_name=sheet)
        if m.get("state") == "running":
            return None
        if m.get("state") != "done":
            return {"ok": False, "detail": f"{what}: match run {match['run']} has no outcome ({m.get('state')})"}
        if m.get("run") != match["run"]:
            return {"ok": False, "detail": f"{what}: the match status holds run {m.get('run')}, not {match['run']}"}
        if m.get("status") == "error":
            return {"ok": False, "detail": f"{what}: match run {match['run']} failed: {m.get('halt_reason')}"}
        return {"ok": True, "detail": f"{what}: {status.get('attempted_count')} rows, match {m.get('run_status')}"}

    return wait_until(set(ctx["sheets"]), read, timeout)




class VoterOff:
    """Switch the BoQ AI setting off for the flows (classify's voter, suggest's extraction, match's client), and put
    it back as it was."""

    def __enter__(self):
        self.before = frappe.db.get_single_value(SETTINGS_DOCTYPE, "enabled")
        frappe.db.set_single_value(SETTINGS_DOCTYPE, "enabled", 0)
        frappe.db.commit()
        frappe.clear_cache(doctype=SETTINGS_DOCTYPE)

    def __exit__(self, *exc):
        frappe.db.rollback()
        frappe.db.set_single_value(SETTINGS_DOCTYPE, "enabled", self.before)
        frappe.db.commit()
        frappe.clear_cache(doctype=SETTINGS_DOCTYPE)


FLOWS = {  # name -> (setup, one run, default runs)
    "clone": (clone_setup, clone_run, 10),
    "classify": (classify_setup, classify_run, 10),
    "suggest": (suggest_setup, suggest_run, 5),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--runs", type=int, default=None, help="runs of every flow (default: each flow's own count)")
    ap.add_argument("--flows", default=",".join(FLOWS))
    ap.add_argument("--round-timeout", type=float, default=300)
    a = ap.parse_args()
    flows = [f for f in a.flows.split(",") if f]
    unknown = set(flows) - set(FLOWS)
    if unknown:
        raise SystemExit(f"unknown flows {sorted(unknown)}; known: {sorted(FLOWS)}")

    # Stopped from outside (the walk's clean-up), still put the AI setting back: SystemExit runs VoterOff.__exit__.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    frappe.set_user("Administrator")
    wait_for_workers(a.workers)
    result = {"workers": a.workers, "flows": {}}
    started_at = time.time()
    with VoterOff():
        for flow in flows:
            setup, run_once, default_runs = FLOWS[flow]
            runs = a.runs or default_runs
            ctx = setup(a.workers)
            ops = []
            for run in range(1, runs + 1):
                t0 = time.monotonic()
                outcomes = run_once(ctx, run, a.round_timeout)
                bad = [o["detail"] for o in outcomes.values() if not o["ok"]]
                print(f"{flow} run {run}/{runs}: {len(outcomes) - len(bad)} ok, {len(bad)} failed "
                      f"({time.monotonic() - t0:.1f} s)" + "".join(f"\n    FAILED {d}" for d in bad), flush=True)
                ops += [{"run": run, **o} for o in outcomes.values()]
            result["flows"][flow] = {
                "runs": runs, "ok": sum(o["ok"] for o in ops), "failed": sum(not o["ok"] for o in ops), "operations": ops,
            }
    waits = recent_waits(boq_series(), started_at)  # web requests' and workers' waits alike
    result["boq_lock"] = {"waits": len(waits), "longest_wait_s": max(waits, default=0.0)}
    print(f"BoQ series lock: {len(waits)} waits, the longest {max(waits, default=0.0):.3f} s", flush=True)
    print("JSON: " + json.dumps(result), flush=True)


main()
