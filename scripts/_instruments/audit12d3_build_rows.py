#!/usr/bin/env python3
"""SLICE 12d-3 -- THE INSULATION AUDIT, STAGE 1-3 CAPTURE (read-only; run in the container).

Joins, for every Insulation row the audit run extracted, the three server-side stages:
  payload  -> the capture log's `payload_items` entry for the row (what the model was shown);
  answer   -> the model's RAW reply element for the row (parsed out of `response_text` with the shared
              parser) AND the parsed/coerced items the run document stored (`items`), with the text-check
              and second-opinion flags (`item_flags`) and the batch's `drops` (verdicts, failures);
  context  -> the row's unit, its headings (the payload's ancestor chain, root-first, sheet excluded), the
              hand-typed current rate cells, the sheet's gate status, the run's id / status / active.
Writes ONE JSON list (the fixture the pricing instrument `audit12d3_pricing.ts` prices through BOTH real
paths). Nothing is written to the database; the session is rolled back and destroyed.

Usage (container):  env/bin/python apps/nirmaan_stack/scripts/_instruments/audit12d3_build_rows.py \
                        <run_progress.jsonl> <since 'YYYY-MM-DD HH:MM:SS'> <hand_rates.json> <digest.json> <out.json>
"""
import json
import os
import sys

os.chdir('/workspace/development/frappe-bench/sites')
import frappe  # noqa: E402

frappe.init(site='localhost'); frappe.connect()
from nirmaan_stack.services.boq_category.ai_voter import _extract_json_array  # noqa: E402

LOG = '/workspace/development/frappe-bench/logs/boq_rate_extraction_capture.jsonl'
prog_path, since, hand_path, digest_path, out_path = sys.argv[1:6]
hand = json.load(open(hand_path))
gates = json.load(open(digest_path)).get("gates", {})

prog = [json.loads(l) for l in open(prog_path) if l.strip()]
caps = {}   # (boq, sheet) -> [capture records since, hvac_insulation]
for line in open(LOG, encoding='utf-8'):
    try:
        r = json.loads(line)
    except ValueError:
        continue
    if r.get("kind") not in ("batch", "attempt_failed", "ceiling_cut"):
        continue
    if str(r.get("ts") or "") < since or r.get("category_id") != "hvac_insulation":
        continue
    caps.setdefault((r.get("boq"), r.get("sheet_name")), []).append(r)

out = []
for p in prog:
    boq, sheet = p["key"]
    if not p.get("attempts"):
        continue
    run = p["attempts"][-1]["run"]
    doc = frappe.get_all("BoQ Rate Suggestion Run", filters={"name": run["name"]},
                         fields=["name", "run_id", "status", "active", "results", "committed_version", "ai_status", "halt_reason"], limit=1)[0]
    results = doc["results"] if isinstance(doc["results"], list) else json.loads(doc["results"] or "[]")
    by_row = {int(r["excel_row"]): r for r in results}
    recs = caps.get((boq, sheet), [])
    batches = [r for r in recs if r["kind"] == "batch"]
    # the row's unit: BOQ Nodes keys the Excel row as `source_row_number` and the sheet as `sheet` (its link);
    # read at the run's committed version, current nodes only
    units = {int(n["source_row_number"]): n.get("unit") for n in frappe.db.sql(
        """select n.source_row_number, n.unit from "tabBOQ Nodes" n join "tabBoQ Sheet" s on s.name = n.sheet
           where n.boq = %s and s.sheet_name = %s and n.commit_version = %s and n.is_current = 1 and n.source_row_number in %s""",
        (boq, sheet, doc["committed_version"], tuple(int(x) for x in p["ins_rows"])), as_dict=True)}
    for er in p["ins_rows"]:
        er = int(er)
        res = by_row.get(er)
        rec = next((b for b in batches if er in (b.get("excel_rows") or [])), None)
        payload = None
        raw = None
        drops = {}
        if rec:
            payload = next((pi for pi in rec.get("payload_items") or [] if pi.get("id") == er), None)
            drops = rec.get("drops") or {}
            try:
                arr = _extract_json_array(rec.get("response_text") or "")
                raw = next((el for el in arr if isinstance(el, dict) and str(el.get("id")) == str(er)), None)
            except Exception as exc:  # the parse failing IS a finding; record it
                raw = {"_parse_error": repr(exc)[:200]}
        headings = [a.get("description") for a in ((payload or {}).get("ancestor_chain") or []) if a.get("relation") != "sheet"]
        out.append({
            "id": f"{boq}|{sheet}#{er}", "boq": boq, "sheet": sheet, "excel_row": er,
            "committed_version": doc["committed_version"], "run_id": doc["run_id"], "run_status": doc["status"], "run_active": doc["active"],
            "run_ai_status": doc["ai_status"], "halt_reason": doc["halt_reason"],
            "unit": units.get(er), "description": (res or {}).get("description") or (payload or {}).get("description") or "",
            "headings": headings, "payload": payload,
            "answer": {"items": (res or {}).get("items")} if res and res.get("items") is not None else None,
            "answer_note": "REAL model answer from the 12d-3 audit run",
            "raw_answer": raw, "item_flags": (res or {}).get("item_flags"),
            "so_verdict": (drops.get("second_opinion_verdicts") or {}).get(str(er)),
            "so_failed": [f for f in (drops.get("second_opinion_failed") or []) if str(f.get("excel_row")) == str(er)],
            "text_flags": (drops.get("items_not_in_row_text") or {}).get(str(er)),
            "row_omitted": er in (drops.get("rows_omitted") or []),
            "batch_ts": (rec or {}).get("ts"), "batch_rows": len((rec or {}).get("excel_rows") or []), "batch_usage": (rec or {}).get("usage"),
            "batch_attempt": (rec or {}).get("attempt"),
            "failed_attempts": sum(1 for r in recs if r["kind"] == "attempt_failed" and er in (r.get("excel_rows") or [])),
            "hand_rates": hand.get(f"{boq}|{sheet}|{er}"), "gate": gates.get(f"{boq}|{sheet}"),
            "row_attributes": {},
        })
json.dump(out, open(out_path, "w"), indent=1, ensure_ascii=False, default=str)
print("rows written:", len(out), "with payload:", sum(1 for o in out if o["payload"]), "with items:", sum(1 for o in out if o["answer"]),
      "raw parsed:", sum(1 for o in out if isinstance(o["raw_answer"], dict) and "_parse_error" not in o["raw_answer"]))
frappe.db.rollback(); frappe.destroy()
