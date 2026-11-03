"""LOAD SPEC CARDS - put cards made elsewhere into `BoQ Row Spec Card`, under R-H2W (DEV2-B5 S1; B6 reuses it for
production).

R-H2W (owner 2026-11-01): "dev cards are reused in production only when the row's text, headings and card prompt
version are unchanged; otherwise production makes them". So a card is LOADED only when all three hold:
  * its payload_sha256 == the row's CURRENT payload sha (cards.payload_sha256 over the live `extraction._ai_item`
    block, built by cards.sheet_items - the same builder the card job and the pool use);
  * its prompt_version == the card prompt's current version (cards.prompt_version());
  * its model == the card model in the AI settings (match_card_model; never a model name in code).
Anything else is SKIPPED and counted, never loaded:
  skip-mismatch  sha / prompt / model differs, the key names no current row, or the sheet has no current version;
  skip-exists    a card is already stored for (payload_sha256, prompt_version, model) - whatever its status, it is
                 NEVER overwritten - or an earlier line of the same file already loads that sha.
A loaded card is stored exactly as the card job stores one (cards._store's values): status "ok",
card_json = json.dumps(card, ensure_ascii=False), the CURRENT row's boq / sheet / excel_row / commit_version, and
tokens / cost 0 (the spend belongs to the run that made it, not to this load).

THE CARDS FILE (JSON lines), one card a line:
  {"key": "<boq>|<sheet>|<excel_row>", "payload_sha256": ..., "prompt_version": ..., "model": ..., "card": {...}}
Other fields (source, proof) are carried in the report only. The key's sheet may itself contain "|": the BoQ is
before the first "|", the excel row after the last.

usage (in the bench container, from frappe-bench):
  env/bin/python -I apps/nirmaan_stack/scripts/_instruments/load_spec_cards.py --site <site> --cards <file>
      --out <report.json> [--dry]
--dry prints the counts (load / skip-mismatch / skip-exists) and writes NOTHING (the database connection is made read
only). Without it, the cards counted "load" are inserted, one commit a sheet; the report names every loaded key.
"""
import argparse
import collections
import json
import os
import sys

LOAD, SKIP_MISMATCH, SKIP_EXISTS = "load", "skip-mismatch", "skip-exists"


def parse_key(key):
    """(boq, sheet, excel_row) or None. The sheet may contain '|'."""
    parts = str(key or "").split("|")
    if len(parts) < 3:
        return None
    try:
        er = int(parts[-1])
    except ValueError:
        return None
    return parts[0], "|".join(parts[1:-1]), er


def classify(cards, current, existing, prompt_version, model):
    """PURE. cards: [card line dict]; current: {key: (commit_version, payload_sha256)} for the rows that exist now;
    existing: set of stored (payload_sha256, prompt_version, model). -> [(card, verdict, reason)] in file order."""
    out, taken = [], set()
    for c in cards:
        k = c.get("key")
        cur = current.get(k)
        if cur is None:
            out.append((c, SKIP_MISMATCH, "no current row for the key"))
        elif c.get("payload_sha256") != cur[1]:
            out.append((c, SKIP_MISMATCH, "payload sha differs from the current row"))
        elif c.get("prompt_version") != prompt_version:
            out.append((c, SKIP_MISMATCH, "prompt version differs"))
        elif c.get("model") != model:
            out.append((c, SKIP_MISMATCH, "model differs from the settings' card model"))
        else:
            ident = (c["payload_sha256"], c["prompt_version"], c["model"])
            if ident in existing:
                out.append((c, SKIP_EXISTS, "a card is already stored for this payload, prompt and model"))
            elif ident in taken:
                out.append((c, SKIP_EXISTS, "an earlier line of this file loads the same payload"))
            else:
                taken.add(ident)
                out.append((c, LOAD, None))
    return out


def counts(classified):
    by = collections.Counter(v for _, v, _ in classified)
    reasons = collections.Counter(f"{v}: {r}" for _, v, r in classified if r)
    return {LOAD: by[LOAD], SKIP_MISMATCH: by[SKIP_MISMATCH], SKIP_EXISTS: by[SKIP_EXISTS], "reasons": dict(reasons)}


def read_cards(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def current_rows(cards):
    """{key: (commit_version, payload_sha256)} for every key that names a row of a current committed sheet (one
    context build a sheet, through cards.sheet_items)."""
    from nirmaan_stack.services.boq_rate_match import cards as C

    by_sheet = collections.defaultdict(set)
    for c in cards:
        p = parse_key(c.get("key"))
        if p:
            by_sheet[(p[0], p[1])].add(p[2])
    out = {}
    for (boq, sheet), rows in sorted(by_sheet.items()):
        try:
            cv, items, _missing = C.sheet_items(boq, sheet, excel_rows=sorted(rows))
        except Exception:  # noqa: BLE001 -- a sheet that cannot be read is a mismatch, never a load
            cv, items = None, []
        if cv is None:
            continue
        for er, it in items:
            out[f"{boq}|{sheet}|{er}"] = (cv, C.payload_sha256(it))
    return out


def stored_idents(cards):
    import frappe
    from nirmaan_stack.services.boq_rate_match import cards as C

    shas = sorted({c.get("payload_sha256") for c in cards if c.get("payload_sha256")})
    out = set()
    for i in range(0, len(shas), 500):
        for r in frappe.get_all(C.CARD_DOCTYPE, filters={"payload_sha256": ["in", shas[i:i + 500]]},
                                fields=["payload_sha256", "prompt_version", "model"]):
            out.add((r["payload_sha256"], r["prompt_version"], r["model"]))
    return out


def insert_cards(classified, current):
    """Insert every LOAD card; one commit a sheet. -> [loaded {key, name}]."""
    import frappe
    from nirmaan_stack.services.boq_rate_match import cards as C

    loaded, last_sheet = [], None
    for c, verdict, _ in classified:
        if verdict != LOAD:
            continue
        boq, sheet, er = parse_key(c["key"])
        if last_sheet is not None and (boq, sheet) != last_sheet:
            frappe.db.commit()
        last_sheet = (boq, sheet)
        doc = frappe.get_doc({
            "doctype": C.CARD_DOCTYPE, "boq": boq, "sheet": sheet, "excel_row": er,
            "commit_version": current[c["key"]][0], "payload_sha256": c["payload_sha256"],
            "prompt_version": c["prompt_version"], "model": c["model"], "status": C.STATUS_OK,
            "card_json": json.dumps(c["card"], ensure_ascii=False), "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0,
        })
        doc.insert(ignore_permissions=True)
        loaded.append({"key": c["key"], "name": doc.name})
    frappe.db.commit()
    return loaded


def run(cards, dry):
    """Classify (and, unless dry, load) `cards` against the live site. -> the report dict."""
    from nirmaan_stack.api.boq.wizard import ai_settings
    from nirmaan_stack.services.boq_rate_match import cards as C

    model = ai_settings.get_boq_match_settings().get("match_card_model")
    if not model:
        raise SystemExit("The AI settings hold no card model (match_card_model): nothing can be loaded.")
    pv = C.prompt_version()
    current = current_rows(cards)
    classified = classify(cards, current, stored_idents(cards), pv, model)
    rep = {"dry": dry, "cards_in_file": len(cards), "prompt_version": pv, "model": model,
           "rows_found": len(current), **counts(classified),
           "by_boq": dict(collections.Counter(parse_key(c["key"])[0] for c, v, _ in classified if v == LOAD))}
    rep["loaded"] = [] if dry else insert_cards(classified, current)
    return rep


def main():
    ap = argparse.ArgumentParser(description="Load spec cards under R-H2W.")
    ap.add_argument("--site", required=True)
    ap.add_argument("--cards", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    cards_path, out_path = os.path.abspath(a.cards), os.path.abspath(a.out)
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "sites"))
    import frappe

    frappe.init(site=a.site)
    frappe.connect()
    frappe.set_user("Administrator")
    try:
        if a.dry:
            frappe.db.sql("select 1")
            frappe.db._conn.rollback()
            frappe.db._conn.set_session(readonly=True)   # --dry writes nothing: Postgres refuses any write
        rep = run(read_cards(cards_path), a.dry)
    finally:
        frappe.db.rollback()
        frappe.destroy()
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in rep.items() if k != "loaded"}, indent=1, ensure_ascii=False))
    print("loaded:", len(rep["loaded"]))


if __name__ == "__main__":
    sys.exit(main())
