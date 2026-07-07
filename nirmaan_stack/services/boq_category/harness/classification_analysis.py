#!/usr/bin/env python
"""
classification_analysis.py -- calibration report over harness output CSVs (tracked).

Version-controlled move of the scratch analyze_rerun.py (behaviour identical). Reads the per-file
output CSVs, maps the human display-name verdict -> frozen-15 category_id, and prints the accuracy
/ calibration sections (a-i). Scope for scoring: Line Item rows with a non-blank verdict that MAPS
to one of the 15 ids (CROSS + UNMAPPED verdicts are reported separately). Pure stdlib; no frappe,
no AI. CATEGORIES_JSON defaults to the sibling module's categories_electrical.json; OUT defaults
to a LOCAL non-repo path.

Usage:
    env/bin/python .../harness/classification_analysis.py <OUTPUT_FOLDER> [CATEGORIES_JSON]

NOTE (format coupling): this analyser reads the human verdict from a "User Category" column IN the
CSV (the earlier starved-run output carried it). The current tracked harness emits the LOCKED
20-column CSV WITHOUT verdict columns, and the tree-fed measurement re-joins verdicts to the
labelled files by durable address (boq, TRIM(sheet_name), source_row_number). Point this at a
verdict-bearing CSV, or extend it with the durable-address re-join, before scoring the 20-col
output. Moved as-is (behaviour-preserving) -- the re-join variant is deferred.
"""
import csv
import glob
import json
import os
import sys
import collections

_HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.expanduser(
    "~/boq_classification_runs/output")
CATS_JSON = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
    _HERE, "..", "categories_electrical.json")

OLD_RULE_ACC = 0.677
RECOVERED = ["light_fixtures", "miscellaneous", "junction_box_raceway",
             "lighting_mgmt_system", "popup_boxes"]
CROSS_KW = ["networking", "rack", "snmp", "bms", "camera", "wifi", "coax",
            "cat6", "cat 6", "rj45", "ethernet"]

cats = json.load(open(CATS_JSON, encoding="utf-8"))["categories"]
ID_SET = {c["category_id"] for c in cats}
NAME2ID = {c["name"].strip().lower(): c["category_id"] for c in cats}


def map_verdict(v):
    """Return a frozen-15 id, 'CROSS', or None (UNMAPPED)."""
    if v is None:
        return None
    raw = str(v).strip()
    if raw == "":
        return None
    if raw in ID_SET:
        return raw
    n = raw.lower()
    if n in NAME2ID:
        return NAME2ID[n]
    if any(k in n for k in CROSS_KW):
        return "CROSS"
    if n.startswith("misc"):
        return "miscellaneous"
    if n == "lms":
        return "lighting_mgmt_system"
    if n in ("point wiring", "point_wiring", "point_wiring description") or \
       ("point" in n and ("wiring" in n or "controlled" in n)) or "first point" in n:
        return "point_wiring"
    if any(k in n for k in ("floor box", "flip flop", "flip-flop", "pop up", "popup", "flip flop box")):
        return "popup_boxes"
    if "ups" in n:
        return "ups"
    if "conduit" in n:
        return "conduit_piping"
    if "light fixture" in n:
        return "light_fixtures"
    if "panel" in n:  # after light-fixture check
        return "panels"
    if "industrial" in n:
        return "industrial_sockets"
    return None


def load_rows(folder):
    rows = []
    for f in sorted(glob.glob(os.path.join(folder, "*.csv"))):
        for r in csv.DictReader(open(f, encoding="utf-8-sig")):
            r["_file"] = os.path.basename(f)
            rows.append(r)
    return rows


def pct(a, b):
    return f"{(100.0*a/b):5.1f}%" if b else "  n/a"


rows = load_rows(OUT)
line_items = [r for r in rows if (r.get("node_type") or "").strip() == "Line Item"]
preambles = [r for r in rows if (r.get("node_type") or "").strip() == "Preamble"]

# map verdicts, collect unmapped
unmapped = collections.Counter()
scorable, cross_rows = [], []
for r in line_items:
    v = r.get("User Category")
    m = map_verdict(v)
    r["_mapped"] = m
    if v in (None, ""):
        continue
    if m is None:
        unmapped[str(v).strip()] += 1
    elif m == "CROSS":
        cross_rows.append(r)
    else:
        scorable.append(r)

print("=" * 78)
print(f"CALIBRATION REPORT  (in-sample / training)  output={OUT}")
print("=" * 78)
print(f"rows total={len(rows)}  line_items={len(line_items)}  preambles={len(preambles)}")
print(f"scorable line-items (verdict -> one of 15)={len(scorable)}  "
      f"cross-verdict={len(cross_rows)}  unmapped={sum(unmapped.values())}")

# --- UNMAPPED
print("\n--- UNMAPPED verdict values (Line Items) ---")
if unmapped:
    for k, c in unmapped.most_common():
        ex = next((r for r in line_items if str(r.get("User Category")).strip() == k), None)
        exd = (ex.get("description") or "")[:50] if ex else ""
        print(f"  {c:3d}  {k!r:45s} e.g. {exd!r}")
else:
    print("  (none)")

# --- (a)(b) overall
rule_ok = sum(1 for r in scorable if r.get("rule_category", "") == r["_mapped"])
ai_ok = sum(1 for r in scorable if r.get("ai_category", "") == r["_mapped"])
print("\n--- (a) RULE overall accuracy ---")
print(f"  {rule_ok}/{len(scorable)} = {pct(rule_ok, len(scorable))}   "
      f"(old 67.7%; delta {100.0*rule_ok/len(scorable)-100*OLD_RULE_ACC:+.1f} pts)")
print("--- (b) AI overall accuracy ---")
print(f"  {ai_ok}/{len(scorable)} = {pct(ai_ok, len(scorable))}")

# --- (c) per-category
print("\n--- (c) PER-CATEGORY accuracy (verdict count | rule-correct | AI-correct) ---")
print(f"  {'category':22s} {'N':>4} {'ruleOK':>7} {'rule%':>7} {'aiOK':>6} {'ai%':>7}")
bycat = collections.defaultdict(list)
for r in scorable:
    bycat[r["_mapped"]].append(r)
for cid in [c["category_id"] for c in cats]:
    grp = bycat.get(cid, [])
    n = len(grp)
    ro = sum(1 for r in grp if r.get("rule_category", "") == cid)
    ao = sum(1 for r in grp if r.get("ai_category", "") == cid)
    tag = "  <-- recovered" if cid in RECOVERED else ""
    print(f"  {cid:22s} {n:4d} {ro:7d} {pct(ro,n):>7} {ao:6d} {pct(ao,n):>7}{tag}")

# --- (d) rule band staircase
print("\n--- (d) RULE band staircase (accuracy by rule_band, over scorable) ---")
band = collections.defaultdict(lambda: [0, 0])
for r in scorable:
    b = r.get("rule_band", "") or "BLANK"
    band[b][1] += 1
    if r.get("rule_category", "") == r["_mapped"]:
        band[b][0] += 1
for b in ["HIGH", "MED", "LOW", "ABSTAIN", "BLANK"]:
    if b in band:
        ok, n = band[b]
        flag = ""
        if b == "HIGH" and n and (ok / n) < 0.90:
            flag = "   *** GUARDRAIL: HIGH < 90% ***"
        print(f"  {b:8s} {ok:4d}/{n:4d} = {pct(ok,n)}{flag}")

# --- (e) AI confidence calibration
print("\n--- (e) AI confidence calibration (accuracy by ai_confidence bucket) ---")
buckets = [(0.0, 0.5), (0.5, 0.7), (0.7, 0.85), (0.85, 1.01)]
bk = {b: [0, 0] for b in buckets}
for r in scorable:
    try:
        c = float(r.get("ai_confidence") or 0)
    except ValueError:
        c = 0.0
    for b in buckets:
        if b[0] <= c < b[1]:
            bk[b][1] += 1
            if r.get("ai_category", "") == r["_mapped"]:
                bk[b][0] += 1
            break
for b in buckets:
    ok, n = bk[b]
    print(f"  [{b[0]:.2f}-{b[1] if b[1]<=1 else 1.0:.2f})  {ok:4d}/{n:4d} = {pct(ok,n)}")

# --- (f) rule vs AI agreement
agree = sum(1 for r in scorable if r.get("rule_category", "") == r.get("ai_category", ""))
disagree = [r for r in scorable if r.get("rule_category", "") != r.get("ai_category", "")]
r_wins = sum(1 for r in disagree if r.get("rule_category", "") == r["_mapped"])
a_wins = sum(1 for r in disagree if r.get("ai_category", "") == r["_mapped"])
print("\n--- (f) RULE vs AI ---")
print(f"  agreement over scorable: {agree}/{len(scorable)} = {pct(agree,len(scorable))}")
print(f"  on {len(disagree)} disagreements: rule-correct {r_wins} | AI-correct {a_wins} | "
      f"neither {len(disagree)-r_wins-a_wins}")

# --- (g) cross-discipline
print("\n--- (g) CROSS-DISCIPLINE (team-marked cross; engine should blank) ---")
rblank = sum(1 for r in cross_rows if (r.get("rule_category", "") or "") == "")
ablank = sum(1 for r in cross_rows if (r.get("ai_category", "") or "") == "")
print(f"  cross rows={len(cross_rows)}  rule left blank={rblank} ({pct(rblank,len(cross_rows))})  "
      f"AI left blank={ablank} ({pct(ablank,len(cross_rows))})")

# --- (h) review seam / punt
seam = [r for r in scorable if (r.get("rule_category", "") or "") == ""]
dbfp = [r for r in seam if "to first point" in (r.get("description") or "").lower()]
print("\n--- (h) REVIEW SEAM (scorable rows the RULE left blank/ABSTAIN) ---")
print(f"  routed-to-review={len(seam)}  (of {len(scorable)} scorable = {pct(len(seam),len(scorable))})")
print(f"  of those, human-context 'to first point' rows (correct-to-review)={len(dbfp)}")
print(f"  net punt (verdict placeable but rule blank, excl. to-first-point)={len(seam)-len(dbfp)}")

# --- (i) top disagreement buckets (rule_result -> verdict)
print("\n--- (i) TOP 10 RULE-vs-VERDICT disagreement buckets (rule -> verdict) ---")
mism = collections.defaultdict(list)
for r in scorable:
    rc = r.get("rule_category", "") or "(blank)"
    if rc != r["_mapped"]:
        mism[(rc, r["_mapped"])].append(r)
for (rc, ver), grp in sorted(mism.items(), key=lambda kv: -len(kv[1]))[:10]:
    print(f"  [{len(grp):3d}] rule={rc:20s} -> verdict={ver}")
    for r in grp[:3]:
        print(f"         e.g. {(r.get('description') or '')[:66]!r}")
