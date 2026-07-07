#!/usr/bin/env python
"""
electrical_classification_harness.py -- THE committed-tree classification harness (tracked).

Version-controlled move of the scratch rerun_harness_committed.py (behaviour identical). Sources
rows from the COMMITTED tier (BOQ Nodes is_current=1), walks parent_node->root, and feeds each
row's description + full ancestor chain + attached_notes + append_notes_raw + sheet_name to BOTH
engines: the rule runner (classify_line) and the Option-B AI voter (the tracked prompt at
../prompts/electrical_ai_category_prompt.md). Emits the locked 20-column CSVs (one per committed
labelled sheet). Electrical-specific for now (BOQS + prompt hardcoded); other disciplines reuse
the SAME mechanism later (discipline-parameterisation DEFERRED).

Run artifacts stay LOCAL, never in the repo: OUTPUT is the required CLI arg; INPUT is env
BOQ_HARNESS_INPUT (folder of labelled *.xlsx), default outside the repo tree.
Usage: BOQ_HARNESS_INPUT=<labelled_xlsx_dir> env/bin/python \\
         nirmaan_stack/services/boq_category/harness/electrical_classification_harness.py <OUTPUT_FOLDER>
"""
import csv, json, os, sys, time, collections

HERE = os.path.dirname(os.path.abspath(__file__))
# The canonical AI category prompt is version-controlled beside this module
# (services/boq_category/prompts/), resolved relative to THIS file's location.
PROMPT_PATH = os.path.abspath(os.path.join(HERE, "..", "prompts", "electrical_ai_category_prompt.md"))
# Labelled INPUT + run OUTPUT stay LOCAL and are NEVER written into the repo tree.
# INPUT is env-overridable and defaults OUTSIDE the repo; OUTPUT is the required CLI arg.
# Before running, point BOQ_HARNESS_INPUT at the folder of labelled *.xlsx.
INPUT_LABELLED = os.environ.get(
    "BOQ_HARNESS_INPUT", os.path.expanduser("~/boq_classification_runs/labelled_input"))
SITES_DIR = os.environ.get("BOQ_HARNESS_SITES_DIR", "/workspace/development/frappe-bench/sites")
SITE = os.environ.get("BOQ_HARNESS_SITE", "localhost")
BATCH = 20
AI_MAX_TOKENS = 8000
BOQS = ["BOQ-26-00007", "BOQ-26-00016", "BOQ-26-00019", "BOQ-26-00022", "BOQ-26-00024"]

LOCKED_COLS = ["project_name","boq_name","sheet_name","excel_row","sl_no","parent_excel_row",
    "classification","level","node_type","description","notes","rule_category","rule_score",
    "rule_band","rule_reason","ai_category","ai_confidence","ai_reason","rules_ai_agree","node_id"]
CLASSIFY_NT = {"Line Item", "Preamble"}


def _cell(v):
    if v is None: return ""
    if isinstance(v, float) and v.is_integer(): return int(v)
    return v


def _notes_text(node):
    """Combine a node's own notes + attached_notes (list) + append_notes_raw (dict) -> readable str."""
    parts = []
    if node.get("notes"): parts.append(str(node["notes"]).strip())
    an = node.get("attached_notes")
    if an:
        try:
            v = json.loads(an) if isinstance(an, str) else an
        except Exception:
            v = an
        if isinstance(v, list): parts += [str(x).strip() for x in v if str(x).strip()]
        elif isinstance(v, dict): parts += [str(x).strip() for x in v.values() if str(x).strip()]
        elif v: parts.append(str(v).strip())
    ap = node.get("append_notes_raw")
    if ap:
        try:
            v = json.loads(ap) if isinstance(ap, str) else ap
        except Exception:
            v = ap
        if isinstance(v, dict):
            for val in v.values():
                if isinstance(val, list): parts += [str(x).strip() for x in val if str(x).strip()]
                elif str(val).strip(): parts.append(str(val).strip())
        elif isinstance(v, list): parts += [str(x).strip() for x in v if str(x).strip()]
        elif v: parts.append(str(v).strip())
    return " | ".join(p for p in parts if p)


def _extract_json_array(text):
    s = text.find("["); e = text.rfind("]")
    if s == -1 or e == -1 or e < s: raise ValueError("no JSON array")
    return json.loads(text[s:e + 1])


def _ai_batch(client, model, prompt_text, items, valid_ids):
    payload = prompt_text + "\n" + json.dumps(items, ensure_ascii=False)
    last = None
    for attempt in range(1, 4):
        try:
            resp = client.messages.create(model=model, max_tokens=AI_MAX_TOKENS,
                messages=[{"role": "user", "content": payload}], timeout=300)
            text = "".join(getattr(b, "text", "") for b in resp.content)
            out = {}
            for el in _extract_json_array(text):
                rid = int(el["id"]); cat = el.get("category_id") or ""
                cat = cat if cat in valid_ids else ""
                try: conf = float(el.get("confidence"))
                except (TypeError, ValueError): conf = 0.0
                out[rid] = (cat, max(0.0, min(1.0, conf)), str(el.get("brief_reason") or "").strip())
            return out
        except Exception as exc:
            last = exc; time.sleep(2 * attempt)
    raise RuntimeError(f"AI batch failed: {last!r}")


def main():
    output_folder = os.path.abspath(sys.argv[1])
    os.makedirs(output_folder, exist_ok=True)
    os.chdir(SITES_DIR)
    import frappe
    frappe.init(site=SITE); frappe.connect()
    from nirmaan_stack.api.boq.wizard.ai_settings import get_boq_ai_settings, get_boq_ai_api_key
    from nirmaan_stack.services.boq_category.runner import classify_line, load_ruleset
    import anthropic
    settings = get_boq_ai_settings(); api_key = get_boq_ai_api_key()
    if not api_key:
        print("STOP: AI key not configured"); sys.exit(3)
    model = settings.get("model") or "claude-opus-4-8"
    valid_ids = {c["category_id"] for c in load_ruleset()["categories"]}
    client = anthropic.Anthropic(api_key=api_key)
    prompt_text = open(PROMPT_PATH, encoding="utf-8").read()

    # labelled sheets set (trim-normalized) -- restrict processing to these
    import glob, openpyxl
    labelled_sheets = set()
    for f in glob.glob(INPUT_LABELLED + "/*.xlsx"):
        boq = os.path.basename(f).split("__")[0]
        if boq not in BOQS: continue
        wb = openpyxl.load_workbook(f, read_only=True, data_only=True); ws = wb.active
        it = ws.iter_rows(values_only=True); hdr = list(next(it)); idx = {h: i for i, h in enumerate(hdr) if h}
        if "User Category" not in idx: wb.close(); continue
        for r in it:
            if all(v is None for v in r): continue
            uc = r[idx["User Category"]] if idx["User Category"] < len(r) else None
            if uc in (None, ""): continue
            sn = r[idx["sheet_name"]] if "sheet_name" in idx else None
            if sn is not None: labelled_sheets.add((boq, str(sn).strip()))
        wb.close()

    NF = ["name","source_row_number","sort_order","parent_node","node_type","row_class",
          "description","notes","attached_notes","append_notes_raw","level","code"]
    stats = collections.Counter(); total_ai_calls = 0
    for boq in BOQS:
        proj = frappe.db.get_value("BOQs", boq, "project")
        project_name = frappe.db.get_value("Projects", proj, "project_name") if proj else ""
        boq_name = frappe.db.get_value("BOQs", boq, "boq_name")
        sheets = frappe.db.sql("""SELECT DISTINCT n.sheet, s.sheet_name, s.commit_version
            FROM "tabBOQ Nodes" n JOIN "tabBoQ Sheet" s ON s.name=n.sheet
            WHERE n.boq=%s AND n.is_current=1 AND s.is_current=1""", (boq,), as_dict=True)
        for sh in sheets:
            sdn = sh["sheet"]; sn = sh["sheet_name"]
            if (boq, str(sn).strip()) not in labelled_sheets: continue
            nodes = frappe.db.get_all("BOQ Nodes", filters={"boq": boq, "sheet": sdn, "is_current": 1},
                                      fields=NF, order_by="sort_order asc")
            by_name = {n["name"]: n for n in nodes}
            src_by_name = {n["name"]: n["source_row_number"] for n in nodes}

            def ancestors(node):
                chain = []; seen = set(); cur = node.get("parent_node"); hops = 0
                while cur and cur in by_name and cur not in seen and hops < 80:
                    seen.add(cur); hops += 1; a = by_name[cur]
                    chain.append(a); cur = a.get("parent_node")
                chain.reverse()  # root-first
                return chain

            rule_out = {}; ai_items = []
            for n in nodes:
                if (n["node_type"] or "").strip() not in CLASSIFY_NT: continue
                desc = str(n["description"] or "")
                own_notes = _notes_text(n)
                anc = ancestors(n)
                # RULES: ancestor_texts = [sheet_name] + each ancestor (desc + its notes); notes = own
                anc_texts = [str(sn)] + [f"{a['description'] or ''} {_notes_text(a)}".strip() for a in anc]
                # v2.1 tuning2: ancestor HEADERS (descriptions only, NO notes) so headers_only rules
                # (EARTH-ANC) match a real section header, not an incidental keyword in an ancestor note.
                anc_headers = [str(sn)] + [str(a["description"] or "") for a in anc]
                notes_list = [own_notes] if own_notes else []
                res = classify_line(desc, anc_texts, notes_list, discipline="Electrical",
                                    ancestor_headers=anc_headers)
                rule_out[n["name"]] = res
                # AI: structured nested tree (root-first, indented, notes per node) + sheet_name
                chain_strs = [f"[sheet] {sn}"]
                for i, a in enumerate(anc):
                    line = f"{'  '*(i+1)}{a['node_type']}: {a['description'] or ''}"
                    an = _notes_text(a)
                    if an: line += f"  (notes: {an})"
                    chain_strs.append(line)
                ai_items.append({"id": n["source_row_number"], "description": desc,
                                 "ancestor_chain": chain_strs, "notes": own_notes})

            ai_out = {}
            for b in range(0, len(ai_items), BATCH):
                ai_out.update(_ai_batch(client, model, prompt_text, ai_items[b:b+BATCH], valid_ids))
                total_ai_calls += 1

            out_path = os.path.join(output_folder, f"{boq}__{str(sn).strip()}.csv")
            with open(out_path, "w", encoding="utf-8-sig", newline="") as fh:
                w = csv.writer(fh); w.writerow(LOCKED_COLS)
                for n in nodes:
                    stats["rows"] += 1
                    nt = (n["node_type"] or "").strip()
                    stats[nt if nt in ("Line Item","Preamble") else "Other"] += 1
                    prow = {"project_name": project_name, "boq_name": boq_name, "sheet_name": sn,
                        "excel_row": _cell(n["source_row_number"]), "sl_no": _cell(n["code"]),
                        "parent_excel_row": _cell(src_by_name.get(n["parent_node"])),
                        "classification": n["row_class"], "level": _cell(n["level"]),
                        "node_type": n["node_type"], "description": n["description"],
                        "notes": _notes_text(n), "node_id": n["name"]}
                    if n["name"] in rule_out:
                        res = rule_out[n["name"]]; ai = ai_out.get(n["source_row_number"], ("", 0.0, "AI_MISSING"))
                        prow.update({"rule_category": res["category_id"], "rule_score": res["score"],
                            "rule_band": res["band"], "rule_reason": res["reason"],
                            "ai_category": ai[0], "ai_confidence": ai[1], "ai_reason": ai[2],
                            "rules_ai_agree": (res["category_id"] == ai[0])})
                    else:
                        for c in ("rule_category","rule_score","rule_band","rule_reason",
                                  "ai_category","ai_confidence","ai_reason","rules_ai_agree"): prow[c] = ""
                    w.writerow([prow.get(c, "") for c in LOCKED_COLS])
            print(f"[{boq}] {str(sn).strip()}: nodes={len(nodes)} classified={len(rule_out)} -> {os.path.basename(out_path)}")
    print(f"DONE rows={stats['rows']} LineItem={stats['Line Item']} Preamble={stats['Preamble']} "
          f"Other={stats['Other']} ai_calls={total_ai_calls}")
    frappe.destroy()


if __name__ == "__main__":
    main()
