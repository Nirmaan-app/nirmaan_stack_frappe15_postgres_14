#!/usr/bin/env python3
"""SLICE 12d-4b item 1 -- THE SET, stated before any call (host; pure; no AI, no DB).

Sources: the two 12d-4a sweep diffs (every audit row whose outcome changed in 12d-4a / 12d-4aF), the audit rows'
own text (the rows the new model instructions D5 / D8 / D9a / D13 bear on), the 12d-3 hand review (every row a
field was marked WRONG on), and a stratified draw of 20 CONTROL rows untouched by 12d-4a (family x outcome under
the current rules, at most 2 per sheet, fixed seed). Writes the set with its tags, the per-sheet row lists the
runner consumes, and the call / token estimate.

Usage: python recheck12d4b_build_set.py <audit_rows.json> <sweep_diff_12d4a.txt> <sweep_diff_12d4aF.txt> <current_pricing_sweep.json> <hand_review.json> <out set.json>
"""
import json, re, random, sys
from collections import Counter, defaultdict
rows_path, diff_a, diff_f, after_path, hand_path, out_path = sys.argv[1:7]
rows = {r["id"]: r for r in json.load(open(rows_path, encoding="utf-8"))}
afterF = {o["id"]: o for o in json.load(open(after_path, encoding="utf-8")) if o.get("kind") == "audit"}
hand = json.load(open(hand_path, encoding="utf-8"))["rows"]

def changed_ids(path):
    ids = []
    for line in open(path, encoding="utf-8"):
        m = re.match(r"^\[audit\] \[[^\]]*\] \[[^\]]*\] (.+)$", line.strip())
        if m: ids.append(m.group(1).strip())
    return ids
a_changed = changed_ids(diff_a)
f_changed = changed_ids(diff_f)
changed = []
for i in a_changed + f_changed:
    if i not in changed: changed.append(i)
assert all(i in rows for i in changed), [i for i in changed if i not in rows]

def text_of(r):
    return (r.get("description") or "") + " || " + " | ".join(r.get("headings") or [])
D5 = re.compile(r"\d+(?:\.\d+)?\s*mm\s*\+\s*\d+(?:\.\d+)?\s*mm", re.I)
D8 = re.compile(r"\b32\s*kg|\b24\s*kg|(?:fibre|fiber)\s*glass[^|]{0,60}(?:density|kg)|glass\s*wool[^|]{0,60}(?:density|kg)", re.I)
D9A = re.compile(r"(?:paint|coat)[^|]{0,80}(?:glass\s*(?:wool\s*)?cloth|cloth)|(?:glass\s*(?:wool\s*)?cloth|cloth)[^|]{0,80}(?:paint|coat)", re.I)
D13 = re.compile(r"perforated", re.I)
instr = defaultdict(list)
for i, r in rows.items():
    t = text_of(r); d = r.get("description") or ""
    if D5.search(d): instr["D5"].append(i)
    if D8.search(d): instr["D8"].append(i)
    if D9A.search(d): instr["D9a"].append(i)
    if D13.search(d): instr["D13"].append(i)
wrong = sorted(i for i, v in hand.items() if any(str(x).upper() == "WRONG" for x in v.values()) and i in rows)

core = set(changed) | {i for v in instr.values() for i in v} | set(wrong)
# controls: 20 rows NOT in core, stratified by (family, outcome under v32), spread over families and sheets
def fam(r):
    it = (r.get("answer") or {}).get("items") or []
    return ((it[0].get("attributes") or {}).get("item") or {}).get("value") if it else None
def outcome(i):
    p = afterF[i]["panel"]; return "priced" if p.get("priced") else "refused"
pool = [i for i in rows if i not in core and rows[i].get("answer") and i in afterF]
strata = defaultdict(list)
for i in pool: strata[(fam(rows[i]) or "none", outcome(i))].append(i)
rng = random.Random(12404)
controls, seen_sheets = [], Counter()
keys = sorted(strata, key=lambda k: -len(strata[k]))
while len(controls) < 20:
    progressed = False
    for k in keys:
        cands = [i for i in strata[k] if i not in controls and seen_sheets[(rows[i]["boq"], rows[i]["sheet"])] < 2]
        if cands and len(controls) < 20:
            pick = rng.choice(cands); controls.append(pick); seen_sheets[(rows[pick]["boq"], rows[pick]["sheet"])] += 1; progressed = True
    if not progressed: break
tags = defaultdict(list)
for i in changed: tags[i].append("changed-12d4a" if i in a_changed else "changed-12d4aF")
for k, v in instr.items():
    for i in v: tags[i].append("instr-" + k)
for i in wrong: tags[i].append("hand-WRONG")
for i in controls: tags[i].append("control")
the_set = sorted(tags)
by_sheet = defaultdict(list)
for i in the_set: by_sheet[(rows[i]["boq"], rows[i]["sheet"])].append(int(rows[i]["excel_row"]))
sheets = len(by_sheet); n = len(the_set)
# tokens: 12d-3 measured 648,893 batch-input + 1,174,280 so-input over 466 rows / 92 batches
est = {"rows": n, "sheets": sheets, "batch_calls": sheets, "so_calls": n, "total_calls": sheets + n,
       "input_tokens_est": round(n * (648893 + 1174280) / 466), "output_tokens_est": round(n * 96544 / 466)}
out = {"set": [{"id": i, "boq": rows[i]["boq"], "sheet": rows[i]["sheet"], "excel_row": int(rows[i]["excel_row"]), "tags": tags[i],
                "family_12d3": fam(rows[i]), "outcome_v32": outcome(i) if i in afterF else None, "description": (rows[i].get("description") or "")[:140]} for i in the_set],
       "by_sheet": {"%s|%s" % k: sorted(v) for k, v in sorted(by_sheet.items())}, "estimate": est,
       "counts": {"changed": len(changed), "changed_12d4a": len(a_changed), "changed_12d4aF": len(f_changed), **{"instr_" + k: len(v) for k, v in instr.items()}, "hand_wrong": len(wrong), "controls": len(controls)},
       "controls_strata": ["%s / %s" % (fam(rows[i]), outcome(i)) for i in controls]}
json.dump(out, open(out_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(json.dumps(out["counts"]), json.dumps(est))
print("instr rows:", {k: v for k, v in instr.items()})
print("hand WRONG:", wrong)
print("controls:", list(zip(controls, out["controls_strata"])))
