#!/usr/bin/env python3
"""SLICE 12d-4b -- THE RE-CHECK ANALYSIS (host; pure; no AI, no DB).

Compares, row by row, the 12d-3 audit's STORED answers (priced under the current v32 rules) with the re-check's
FRESH answers (priced under the same rules), for the stated set, and writes item 4's analysis a-f plus the
Review Pack's P1 / P2 / P4 numbers.

Inputs:
  set.json            the stated set (recheck12d4b_build_set.py): rows, tags, by_sheet
  audit_rows.json     the 12d-3 capture (466 rows, the stored answers)
  before_pricing.json the 12d-3 answers priced through BOTH paths under the CURRENT rules (sweep dump, kind "audit")
  recheck_rows.json   the re-check capture (audit12d3_build_rows.py over the re-check run)
  recheck_pricing.json the fresh answers priced through BOTH paths (audit12d3_pricing.ts)
  merged_pricing.json all 466 rows priced through BOTH paths, the fresh answer replacing the stored one where re-checked
  hand_review.json    the 12d-3 hand review (rows -> field verdicts + note)
  out_dir
Outputs: recheck_analysis.json, recheck_analysis.md (the a-f tables + P1 / P2 / P4), Recheck_Rows.xlsx.
"""
import collections
import json
import re
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

(set_path, rows_path, before_pricing_path, recheck_rows_path, recheck_pricing_path, merged_pricing_path, hand_path, out_dir) = sys.argv[1:9]
SET = json.load(open(set_path, encoding="utf-8"))
ROWS = {r["id"]: r for r in json.load(open(rows_path, encoding="utf-8"))}
BEFORE = {p["id"]: p for p in json.load(open(before_pricing_path, encoding="utf-8")) if p.get("kind", "audit") == "audit"}
RROWS = {r["id"]: r for r in json.load(open(recheck_rows_path, encoding="utf-8"))}
RPRICE = {p["id"]: p for p in json.load(open(recheck_pricing_path, encoding="utf-8"))}
MERGED = {p["id"]: p for p in json.load(open(merged_pricing_path, encoding="utf-8"))}
HAND = json.load(open(hand_path, encoding="utf-8"))
TAGS = {x["id"]: x["tags"] for x in SET["set"]}

GI = "GI Framework with perforated Al sheet"
FG = " Fiberglass Rigid Board Insulation, Density 48Kg/m3"


def attrs(row):
    """{attr: value} of the FIRST item the model returned, '' when none."""
    it = ((row or {}).get("answer") or {}).get("items") or []
    if not it:
        return {}
    return {k: (v or {}).get("value") for k, v in (it[0].get("attributes") or {}).items()}


def outcome(p, path="panel"):
    """('priced', 'supply/install') | ('refused', reason) | ('declined', reason) | ('skipped'|'error', text)."""
    if not p:
        return ("missing", "")
    if p.get("skipped"):
        return ("skipped", p["skipped"])
    if p.get("error"):
        return ("error", p["error"][:120])
    d = p.get(path) or {}
    if d.get("declined"):
        return ("declined", str(d.get("reason") or "")[:140])
    # two record shapes: the audit instrument's (`rowPriced`) and the sweep dump's (`priced`); both carry `totals`
    flag = d.get("rowPriced") if d.get("rowPriced") is not None else d.get("priced")
    if flag is not None:
        if flag:
            t = d.get("totals") or {}
            return ("priced", "%s/%s" % (t.get("supply_rate"), t.get("install_rate")))
        return ("refused", str(d.get("reason") or "")[:140])
    return ("priced", json.dumps(d.get("values"))[:60])


def reason_class(reason):
    """A refusal reason mapped to its plain-English class (P4)."""
    r = (reason or "").lower()
    rules = [
        ("above the largest size", "pipe above the largest stocked size (R9)"),
        ("no sku in the catalogue for", "a named material the catalogue does not stock (D7 / T5)"),
        ("cladding named in this row but not read", "cladding named in the row but not read (D3)"),
        ("glass cloth is not offered on sheet", "glass cloth on a sheet family (D9b)"),
        ("no unit on this row", "no unit on the row (R12)"),
        ("is not a count, area or length unit", "a unit the catalogue cannot price (R12)"),
        ("no pipe size", "no pipe size stated"),
        ("could not tell cladding", "the model could not tell the cladding"),
        ("could not tell", "the model could not tell a needed fact"),
        ("no sku for this combination", "no SKU for the stated combination"),
        ("no insulation material could be told", "no insulation material could be told (R18)"),
        ("thickness", "a thickness the reader cannot use"),
    ]
    for needle, label in rules:
        if needle in r:
            return label
    return "other: " + (reason or "")[:60]


analysis = {"a_changed": [], "b_instr": {}, "c_wrong": [], "d_controls": [], "e_s3": {}, "f_second_opinion": {}}

# ── (a) changed rows: expected behaviour = the 12d-4a/4aF outcome on the stored answer; seen = the fresh answer's outcome
for i, tags in TAGS.items():
    if not any(t.startswith("changed") for t in tags):
        continue
    exp = outcome(BEFORE.get(i))
    seen = outcome(RPRICE.get(i))
    a0, a1 = attrs(ROWS.get(i)), attrs(RROWS.get(i))
    diff_attrs = {k: (a0.get(k), a1.get(k)) for k in set(a0) | set(a1) if (a0.get(k) or None) != (a1.get(k) or None)}
    same = exp == seen
    analysis["a_changed"].append({"id": i, "tags": tags, "expected": exp, "seen": seen, "as_ruled": same, "answer_diff": diff_attrs})

# ── (b) instruction rows
def expect_d5(a):
    return a.get("thickness_mm"), a.get("pipe_size_mm")
for key, label in (("instr-D5", "D5"), ("instr-D8", "D8"), ("instr-D9a", "D9a"), ("instr-D13", "D13")):
    rows = []
    for i, tags in TAGS.items():
        if key not in tags:
            continue
        a0, a1 = attrs(ROWS.get(i)), attrs(RROWS.get(i))
        if label == "D5":
            m = re.search(r"(\d+(?:\.\d+)?)\s*mm\s*\+\s*(\d+(?:\.\d+)?)\s*mm", ROWS[i].get("description") or "", re.I)
            want = (m.group(2), m.group(1)) if m else (None, None)
            got = (str(a1.get("thickness_mm") or ""), str(a1.get("pipe_size_mm") or ""))
            ok = bool(m) and got[0].replace(" mm", "").strip().startswith(want[0]) and got[1].replace(" mm", "").strip().startswith(want[1])
            rows.append({"id": i, "before": {"thickness": a0.get("thickness_mm"), "pipe": a0.get("pipe_size_mm")}, "after": {"thickness": a1.get("thickness_mm"), "pipe": a1.get("pipe_size_mm")}, "want": {"thickness": want[0], "pipe": want[1]}, "ok": ok})
        elif label == "D8":
            d = (ROWS[i].get("description") or "").lower()
            applies = bool(re.search(r"fibre\s*glass|fiber\s*glass|glass\s*wool|fibreglass|fiberglass", d))
            ok = (a1.get("item") == FG) if applies else None
            rows.append({"id": i, "applies": applies, "before": a0.get("item"), "after": a1.get("item"), "ok": ok, "desc": (ROWS[i].get("description") or "")[:100]})
        elif label == "D9a":
            d = (ROWS[i].get("description") or "").lower()
            alu = bool(re.search(r"alumin", d))
            want = "Aluminium with Glass Cloth" if alu else "Glass Cloth with paint"
            ok = want in str(a1.get("cladding") or "")
            rows.append({"id": i, "before": a0.get("cladding"), "after": a1.get("cladding"), "want": want, "ok": ok, "desc": (ROWS[i].get("description") or "")[:100]})
        else:
            d = (ROWS[i].get("description") or "").lower()
            applies = "perforated" in d and not re.search(r"frame\s*work|framework|gi frame", d)
            ok = (a1.get("cladding") == GI)
            rows.append({"id": i, "no_frame_named": applies, "before": a0.get("cladding"), "after": a1.get("cladding"), "ok": ok, "desc": (ROWS[i].get("description") or "")[:100]})
    analysis["b_instr"][label] = rows

# ── (c) hand-review WRONG rows
for i, tags in TAGS.items():
    if "hand-WRONG" not in tags:
        continue
    h = HAND["rows"].get(i, {})
    a0, a1 = attrs(ROWS.get(i)), attrs(RROWS.get(i))
    wrong_fields = [k for k, v in h.items() if str(v).upper() == "WRONG"]
    fmap = {"item": "item", "cladding": "cladding", "thickness": "thickness_mm", "pipe_size": "pipe_size_mm"}
    changed = {k: (a0.get(fmap[k]), a1.get(fmap[k])) for k in wrong_fields if k in fmap}
    analysis["c_wrong"].append({"id": i, "wrong_fields": wrong_fields, "note": h.get("note"), "before_after": changed, "before_outcome": outcome(BEFORE.get(i)), "after_outcome": outcome(RPRICE.get(i)),
                                "answer_changed": any((a0.get(fmap[k]) or None) != (a1.get(fmap[k]) or None) for k in changed)})

# ── (d) controls
for i, tags in TAGS.items():
    if "control" not in tags:
        continue
    exp, seen = outcome(BEFORE.get(i)), outcome(RPRICE.get(i))
    a0, a1 = attrs(ROWS.get(i)), attrs(RROWS.get(i))
    diff_attrs = {k: (a0.get(k), a1.get(k)) for k in set(a0) | set(a1) if (a0.get(k) or None) != (a1.get(k) or None)}
    analysis["d_controls"].append({"id": i, "before": exp, "after": seen, "identical": exp == seen, "answer_diff": diff_attrs,
                                   "cause": ("identical" if exp == seen else ("a model difference: " + ", ".join(sorted(diff_attrs)) if diff_attrs else "same answer, different outcome -- a RULES difference (investigate)"))})

# ── (e) S3 thickness priority: a row whose OWN text states a thickness must get that thickness, even under a heading schedule
viol = []
checked = 0
for i in TAGS:
    r = RROWS.get(i)
    if not r:
        continue
    d = r.get("description") or ""
    m = re.search(r"(\d+(?:\.\d+)?)\s*mm\s*(?:thk|thick|thickness)?", d, re.I)
    if not m or re.search(r"mm\s*\+\s*\d", d):
        continue
    stated = m.group(1)
    got = str(attrs(r).get("thickness_mm") or "")
    checked += 1
    if got and not got.replace(" mm", "").strip().startswith(stated) and " + " not in got and " x " not in got.lower() and "layer" not in got.lower():
        viol.append({"id": i, "stated": stated, "got": got, "desc": d[:100]})
analysis["e_s3"] = {"checked": checked, "violations": viol}

# ── (f) second opinion on the set
so = collections.Counter()
disagree = []
for i in TAGS:
    r = RROWS.get(i)
    if not r:
        continue
    v = r.get("so_verdict")
    so[str(v)] += 1
    if v and str(v).lower() not in ("agree", "none"):
        disagree.append({"id": i, "verdict": v, "flags": r.get("item_flags"), "answer": attrs(r), "outcome": outcome(RPRICE.get(i))})
analysis["f_second_opinion"] = {"verdicts": dict(so), "disagreements": disagree, "failed": sum(1 for i in TAGS if (RROWS.get(i) or {}).get("so_failed"))}

# ── P1 headline over 466 (merged), P4 refusals by reason, P2 hand comparison
def fam_of(i):
    src = RROWS.get(i) if i in RROWS else ROWS.get(i)
    return attrs(src).get("item") or "(none)"
p1 = {"priced": 0, "refused": 0, "other": 0, "by_family": collections.defaultdict(lambda: collections.Counter()), "by_reason": collections.defaultdict(list)}
for i in ROWS:
    o = outcome(MERGED.get(i))
    fam = fam_of(i)
    if o[0] == "priced":
        p1["priced"] += 1; p1["by_family"][fam]["priced"] += 1
    elif o[0] in ("refused", "declined"):
        p1["refused"] += 1; p1["by_family"][fam]["refused"] += 1; p1["by_reason"][reason_class(o[1])].append((i, o[1]))
    else:
        p1["other"] += 1; p1["by_family"][fam]["other"] += 1
p1["by_family"] = {k: dict(v) for k, v in p1["by_family"].items()}
p1["by_reason"] = {k: {"count": len(v), "examples": v[:2]} for k, v in sorted(p1["by_reason"].items(), key=lambda kv: -len(kv[1]))}
analysis["p1"] = p1
hand_cmp = []
for i, r in ROWS.items():
    hr = r.get("hand_rates")
    if not hr:
        continue
    o = outcome(MERGED.get(i))
    if o[0] != "priced":
        continue
    sup = next((x["rate"] for x in hr if x.get("kind") == "supply_rate"), None)
    ins = next((x["rate"] for x in hr if x.get("kind") == "install_rate"), None)
    ms, mi = o[1].split("/")
    try:
        ms, mi = float(ms), float(mi)
    except ValueError:
        continue
    if sup:
        hand_cmp.append({"id": i, "family": fam_of(i), "hand_supply": sup, "model_supply": ms, "ratio": round(ms / sup, 2) if sup else None, "hand_install": ins, "model_install": mi, "desc": (r.get("description") or "")[:90]})
hand_cmp.sort(key=lambda x: -abs((x["ratio"] or 1) - 1))
analysis["p2"] = {"rows_with_hand_rate_and_price": len(hand_cmp), "largest": hand_cmp[:25], "within_20pct": sum(1 for x in hand_cmp if x["ratio"] and 0.8 <= x["ratio"] <= 1.2)}

json.dump(analysis, open(out_dir + "/recheck_analysis.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False, default=str)

# ── markdown
md = []
A = analysis["a_changed"]
md.append("### (a) changed rows -- %d; as ruled with the fresh answer: %d; not: %d" % (len(A), sum(1 for x in A if x["as_ruled"]), sum(1 for x in A if not x["as_ruled"])))
md.append("| row | tags | expected (stored answer, v32) | seen (fresh answer, v32) | answer differences |\n|---|---|---|---|---|")
for x in A:
    md.append("| %s | %s | %s %s | %s %s | %s |" % (x["id"].replace("|", " / "), " ".join(t.replace("changed-", "") for t in x["tags"]), x["expected"][0], x["expected"][1], x["seen"][0], x["seen"][1], "; ".join("%s: %s -> %s" % (k, v[0], v[1]) for k, v in x["answer_diff"].items()) or "none"))
for label, rows in analysis["b_instr"].items():
    ok = sum(1 for r in rows if r.get("ok") is True); n_app = sum(1 for r in rows if r.get("ok") is not None)
    md.append("\n### (b) %s -- %d rows (%d where the instruction applies), %d read as instructed" % (label, len(rows), n_app, ok))
    hdr = {"D5": "| row | before (thk / pipe) | after (thk / pipe) | wanted | ok |", "D8": "| row | applies | before item | after item | ok | text |", "D9a": "| row | before cladding | after cladding | wanted | ok | text |", "D13": "| row | no frame named | before cladding | after cladding | ok | text |"}[label]
    md.append(hdr + "\n|" + "---|" * (hdr.count("|") - 1))
    for r in rows:
        if label == "D5":
            md.append("| %s | %s / %s | %s / %s | %s / %s | %s |" % (r["id"].replace("|", " / "), r["before"]["thickness"], r["before"]["pipe"], r["after"]["thickness"], r["after"]["pipe"], r["want"]["thickness"], r["want"]["pipe"], r["ok"]))
        elif label == "D8":
            md.append("| %s | %s | %s | %s | %s | %s |" % (r["id"].replace("|", " / "), r["applies"], r["before"], r["after"], r["ok"], r["desc"].replace("|", "/")))
        elif label == "D9a":
            md.append("| %s | %s | %s | %s | %s | %s |" % (r["id"].replace("|", " / "), r["before"], r["after"], r["want"], r["ok"], r["desc"].replace("|", "/")))
        else:
            md.append("| %s | %s | %s | %s | %s | %s |" % (r["id"].replace("|", " / "), r["no_frame_named"], r["before"], r["after"], r["ok"], r["desc"].replace("|", "/")))
C = analysis["c_wrong"]
md.append("\n### (c) the 12d-3 hand-review WRONG rows -- %d" % len(C))
md.append("| row | wrong field(s) | before -> after | outcome before -> after | 12d-3 note |\n|---|---|---|---|---|")
for x in C:
    md.append("| %s | %s | %s | %s %s -> %s %s | %s |" % (x["id"].replace("|", " / "), ", ".join(x["wrong_fields"]), "; ".join("%s: %s -> %s" % (k, v[0], v[1]) for k, v in x["before_after"].items()), x["before_outcome"][0], x["before_outcome"][1], x["after_outcome"][0], x["after_outcome"][1], (x["note"] or "").replace("|", "/")[:120]))
D = analysis["d_controls"]
md.append("\n### (d) controls -- %d; identical outcome and figures: %d; different: %d" % (len(D), sum(1 for x in D if x["identical"]), sum(1 for x in D if not x["identical"])))
md.append("| row | 12d-3 answer, v32 | fresh answer, v32 | cause |\n|---|---|---|---|")
for x in D:
    md.append("| %s | %s %s | %s %s | %s |" % (x["id"].replace("|", " / "), x["before"][0], x["before"][1], x["after"][0], x["after"][1], x["cause"] + ("" if x["identical"] else " -- " + "; ".join("%s: %s -> %s" % (k, v[0], v[1]) for k, v in x["answer_diff"].items()))))
E = analysis["e_s3"]
md.append("\n### (e) S3 thickness priority on the set -- %d rows with an own-text thickness checked, %d violations" % (E["checked"], len(E["violations"])))
for v in E["violations"]:
    md.append("- %s: stated %s mm, model wrote %s -- %s" % (v["id"], v["stated"], v["got"], v["desc"]))
F = analysis["f_second_opinion"]
md.append("\n### (f) the second opinion on the set -- verdicts %s; failed calls %d; disagreements %d" % (json.dumps(F["verdicts"]), F["failed"], len(F["disagreements"])))
for d in F["disagreements"]:
    md.append("- %s: verdict %s; flags %s; answer %s; outcome %s %s" % (d["id"], d["verdict"], json.dumps(d["flags"], ensure_ascii=False)[:160], json.dumps({k: v for k, v in d["answer"].items() if k in ("item", "cladding", "thickness_mm", "pipe_size_mm")}, ensure_ascii=False), d["outcome"][0], d["outcome"][1]))
P = analysis["p1"]
md.append("\n### P1 headline, all 466 rows (fresh answers where re-checked, v32 rules): priced %d, refused %d, other %d" % (P["priced"], P["refused"], P["other"]))
md.append("| family | priced | refused | other |\n|---|---|---|---|")
for fam, c in sorted(P["by_family"].items(), key=lambda kv: -(kv[1].get("priced", 0) + kv[1].get("refused", 0))):
    md.append("| %s | %d | %d | %d |" % (fam.replace("|", "/"), c.get("priced", 0), c.get("refused", 0), c.get("other", 0)))
md.append("\n### P4 refusals by reason\n| reason | count | two examples |\n|---|---|---|")
for k, v in P["by_reason"].items():
    md.append("| %s | %d | %s |" % (k, v["count"], "; ".join("%s (%s)" % (e[0].replace("|", " / "), e[1][:60].replace("|", "/")) for e in v["examples"])))
P2 = analysis["p2"]
md.append("\n### P2 hand-priced comparison (INDICATIVE) -- %d priced rows carry a hand rate; %d within +/-20%% on supply" % (P2["rows_with_hand_rate_and_price"], P2["within_20pct"]))
md.append("| row | family | hand supply | model supply | ratio | hand install | model install | text |\n|---|---|---|---|---|---|---|---|")
for x in P2["largest"]:
    md.append("| %s | %s | %s | %s | %s | %s | %s | %s |" % (x["id"].replace("|", " / "), x["family"], x["hand_supply"], x["model_supply"], x["ratio"], x["hand_install"], x["model_install"], x["desc"].replace("|", "/")))
open(out_dir + "/recheck_analysis.md", "w", encoding="utf-8", newline="\n").write("\n".join(md) + "\n")

# ── Excel: one line per set row
wb = Workbook(); ws = wb.active; ws.title = "Recheck rows"
hdr = ["id", "boq", "sheet", "excel_row", "tags", "unit", "description", "12d-3 item", "12d-3 cladding", "12d-3 thickness", "12d-3 pipe", "fresh item", "fresh cladding", "fresh thickness", "fresh pipe",
       "12d-3 answer under v32: outcome", "12d-3 answer under v32: figures/reason", "fresh answer under v32: outcome", "fresh answer under v32: figures/reason", "calculator (fresh)", "SO verdict (fresh)", "item_flags (fresh)", "hand supply", "hand install", "12d-3 hand-review note"]
ws.append(hdr)
for c in range(1, len(hdr) + 1):
    ws.cell(row=1, column=c).font = Font(bold=True); ws.cell(row=1, column=c).fill = PatternFill("solid", start_color="DDDDDD")
for i in sorted(TAGS):
    r0, r1 = ROWS.get(i, {}), RROWS.get(i, {}); a0, a1 = attrs(r0), attrs(r1)
    bo, ao, co = outcome(BEFORE.get(i)), outcome(RPRICE.get(i)), outcome(RPRICE.get(i), "calculator")
    hr = r0.get("hand_rates") or []
    ws.append([i, r0.get("boq"), r0.get("sheet"), r0.get("excel_row"), ", ".join(TAGS[i]), r0.get("unit"), (r0.get("description") or "")[:300],
               a0.get("item"), a0.get("cladding"), a0.get("thickness_mm"), a0.get("pipe_size_mm"), a1.get("item"), a1.get("cladding"), a1.get("thickness_mm"), a1.get("pipe_size_mm"),
               bo[0], bo[1], ao[0], ao[1], co[0] + " " + co[1], str(r1.get("so_verdict")), json.dumps(r1.get("item_flags"), ensure_ascii=False)[:200],
               next((x["rate"] for x in hr if x.get("kind") == "supply_rate"), None), next((x["rate"] for x in hr if x.get("kind") == "install_rate"), None), (HAND["rows"].get(i) or {}).get("note")])
for col in range(1, len(hdr) + 1):
    ws.column_dimensions[get_column_letter(col)].width = 18
ws.column_dimensions["G"].width = 60
ws.freeze_panes = "B2"; ws.auto_filter.ref = ws.dimensions
wb.save(out_dir + "/2026-10-12_12d4b_Recheck_Rows.xlsx")
print("analysis written:", out_dir, "| a", len(A), "b", {k: len(v) for k, v in analysis["b_instr"].items()}, "c", len(C), "d", len(D), "e", E["checked"], len(E["violations"]), "f", F["verdicts"])
