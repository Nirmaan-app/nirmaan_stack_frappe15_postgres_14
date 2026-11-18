"""VP-4 (valve_library.py rebuild-pack): the PAGE's own data for a list of sheets, read-only -- the three reads SheetPricingPage
makes: pricing.get_priced_rows, classify.get_sheet_categories_resolved, rate_master.get_active_suggestion_run (VP-3 vp3_fetch.py).

The session is read only twice over: the caller exports PGOPTIONS='-c default_transaction_read_only=on', and the script SETs and
COMMITs the session read only before the first read (asserted), then rolls back at the end. It writes nothing to the database.

Usage (in the frappe container, from the bench directory):
  PGOPTIONS='-c default_transaction_read_only=on' env/bin/python -I <this file> <in.tsv: boq<TAB>sheet<TAB>ALL> <outdir>
"""
import json
import os
import sys

IN, OUT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.chdir("/workspace/development/frappe-bench/sites")
import frappe  # noqa: E402

frappe.init(site="localhost")
frappe.connect()
frappe.db.sql("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
frappe.db.commit()
assert frappe.db.sql("SHOW transaction_read_only")[0][0] == "on", "read-only session not on"
from nirmaan_stack.api.boq import rate_master  # noqa: E402
from nirmaan_stack.api.boq.wizard import classify, pricing  # noqa: E402

frappe.set_user("Administrator")
os.makedirs(OUT, exist_ok=True)
want = []
for line in open(IN, encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    if len(f) >= 2 and f[0] != "boq" and (f[0], f[1]) not in want:
        want.append((f[0], f[1]))
idx = []
try:
    for n, (b, s) in enumerate(want):
        rec = {"n": n, "boq": b, "sheet": s, "rows_wanted": None}
        try:
            pr = pricing.get_priced_rows(boq_name=b, sheet_name=s)
            cats = classify.get_sheet_categories_resolved(boq=b, sheet_name=s)
            run = rate_master.get_active_suggestion_run(boq=b, sheet_name=s)
            with open(os.path.join(OUT, "%d.json" % n), "w") as fh:
                json.dump({"priced": pr, "cats": cats, "run": run}, fh, default=str)
            rr = (run or {}).get("run") or {}
            rec.update(rows=len(pr.get("rows") or []), commit_version=pr.get("commit_version"), run_id=rr.get("run_id"),
                       run_cv=rr.get("committed_version"))
        except Exception as e:  # recorded per sheet, never a reason to write
            rec["error"] = "%s: %s" % (type(e).__name__, str(e)[:300])
            frappe.db.rollback()
        idx.append(rec)
    with open(os.path.join(OUT, "sheets.json"), "w") as fh:
        json.dump(idx, fh, indent=1, default=str)
    print("sheets", len(idx), "errors", sum(1 for x in idx if x.get("error")), "with run", sum(1 for x in idx if x.get("run_id")))
finally:
    frappe.db.rollback()
    frappe.destroy()
