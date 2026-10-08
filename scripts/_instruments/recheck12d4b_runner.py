#!/usr/bin/env python3
"""SLICE 12d-4b PHASE 1 STEP 3 -- THE RE-CHECK RUN (container; spends AI calls; writes run records ONLY).

Usage (container): env/bin/python apps/nirmaan_stack/scripts/_instruments/recheck12d4b_runner.py <set.json> <progress.jsonl>
"""
# THE RE-CHECK RUN. The stated set only (recheck_set.json: by_sheet -> excel rows), sheet by
# sheet, through the SAME server function the "Suggest rates" button enqueues (`rate_master._suggest_worker`) with
# only_rows = that sheet's SET rows (Insulation rows only, by construction of the set). Run docs are written exactly as
# the worker writes them; nothing else is written. Sequential. One retry on a halt/failure (a RESUME of the same run doc);
# a second failure is recorded, not retried. Progress is appended per sheet so the run is resumable.
import os, sys, json, time, traceback
os.chdir('/workspace/development/frappe-bench/sites')
import frappe
frappe.init(site='localhost'); frappe.connect()
from nirmaan_stack.api.boq import rate_master
USER = "techadmin@nirmaan.app"
if not frappe.db.exists("User", USER):
    USER = "Administrator"
frappe.set_user(USER)
st = json.load(open(sys.argv[1]))
work = [(k.split("|", 1)[0], k.split("|", 1)[1], v) for k, v in st["by_sheet"].items()]
work.sort()
PROG = sys.argv[2]
done_keys = set()
if os.path.exists(PROG):
    for line in open(PROG):
        try: done_keys.add(tuple(json.loads(line)["key"]))
        except Exception: pass
CAP = 300
def latest_run(boq, sheet, since):
    rows = frappe.get_all("BoQ Rate Suggestion Run", filters={"boq": boq, "sheet_name": sheet, "creation": [">=", since]},
                          fields=["name","run_id","status","active","halt_reason","attempted_rows","scope_rows","ai_status","creation","run_at"], order_by="creation desc", limit=1)
    return rows[0] if rows else None
calls_so_far = sum(1 + len(v) for (b, s, v) in work if (b, s) in done_keys)
print(f"runner start {frappe.utils.now()} user={USER} sheets={len(work)} rows={sum(len(v) for _,_,v in work)} already_done={len(done_keys)} est_calls={sum(1+len(v) for _,_,v in work)}", flush=True)
for boq, sheet, ins_rows in work:
    key = (boq, sheet)
    if key in done_keys: continue
    if calls_so_far + 1 + len(ins_rows) > CAP:
        print(f"CAP: {calls_so_far} calls so far + {1+len(ins_rows)} would exceed {CAP} -- STOP before {key}", flush=True); break
    t0 = time.time(); since = frappe.utils.now()
    rec = {"key": list(key), "ins_rows": ins_rows, "started": since, "attempts": []}
    try:
        rate_master._suggest_worker(boq=boq, sheet_name=sheet, user=USER, only_rows=ins_rows)
        frappe.db.commit()
        run = latest_run(boq, sheet, since)
        rec["attempts"].append({"kind": "first", "run": {k: (str(v) if k in ("creation","run_at") else v) for k, v in (run or {}).items()}})
        if run and (run["status"] == "failed" or (run["status"] == "partial" and run.get("halt_reason"))):
            frappe.db.commit()
            rate_master._suggest_worker(boq=boq, sheet_name=sheet, user=USER, resume_run_id=run["run_id"])
            frappe.db.commit()
            run2 = latest_run(boq, sheet, since)
            rec["attempts"].append({"kind": "retry_resume", "run": {k: (str(v) if k in ("creation","run_at") else v) for k, v in (run2 or {}).items()}})
    except Exception:
        frappe.db.rollback()
        rec["error"] = traceback.format_exc()[-2000:]
    rec["seconds"] = round(time.time() - t0, 1)
    calls_so_far += 1 + len(ins_rows)
    with open(PROG, "a") as fh:
        fh.write(json.dumps(rec) + "\n")
    last = rec["attempts"][-1]["run"] if rec["attempts"] else {}
    print(f"{frappe.utils.now()} {key} rows={len(ins_rows)} status={last.get('status')} active={last.get('active')} halt={last.get('halt_reason')} ai={last.get('ai_status')} {rec['seconds']}s err={'yes' if rec.get('error') else 'no'} calls~{calls_so_far}", flush=True)
print(f"runner end {frappe.utils.now()} calls~{calls_so_far}", flush=True)
frappe.destroy()
