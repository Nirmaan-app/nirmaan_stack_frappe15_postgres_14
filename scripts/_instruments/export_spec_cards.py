"""EXPORT SPEC CARDS - write a site's ok `BoQ Row Spec Card` rows as the keyed cards file load_spec_cards.py reads
(DEV2-B6 S1, for go-live: dev2's cards are exported here and loaded in production under R-H2W).

ONE LINE A CARD ROW (JSON lines; status "ok" only - a malformed or failed card is never exported):
  {"key": "<boq>|<sheet>|<excel_row>", "payload_sha256": ..., "prompt_version": ..., "model": ..., "card": {...}}
exactly the shape load_spec_cards.read_cards / classify take. `card` is the stored card_json parsed (the loader stores
json.dumps(card, ensure_ascii=False) again, so a round trip gives the stored text back). The key is where the card was
made (the row's boq / sheet / excel_row); the loader compares the payload sha with that row's CURRENT one, so a row
changed since is a skip-mismatch there, never a wrong load. Lines are ordered by boq, sheet, excel_row, name.

THE FILE HOLDS CLIENT BoQ TEXT (the cards describe the rows): write it to the site's private folder or a slice
folder, NEVER into the repo.

THE SUMMARY (printed, and written beside the file as <out>.summary.json): rows, distinct keys, distinct payload shas,
prompt versions and models with their counts, cards a BoQ, bytes and the sha256 of the file.

usage (in the bench container, from frappe-bench):
  env/bin/python -I apps/nirmaan_stack/scripts/_instruments/export_spec_cards.py --site <site> --out <file.jsonl>
The database connection is made READ ONLY: the export writes nothing to the site.
"""
import argparse
import collections
import hashlib
import json
import os
import sys

FIELDS = ["name", "boq", "sheet", "excel_row", "payload_sha256", "prompt_version", "model", "card_json"]


def card_line(row):
    """PURE. One stored card row -> the loader's line (dict)."""
    card = row["card_json"]
    if isinstance(card, (str, bytes)):
        card = json.loads(card)
    return {"key": f"{row['boq']}|{row['sheet']}|{int(row['excel_row'])}", "payload_sha256": row["payload_sha256"],
            "prompt_version": row["prompt_version"], "model": row["model"], "card": card}


def export_lines(rows):
    """PURE. The file's lines (text, no newline) in the file's order: boq, sheet, excel_row, name."""
    order = sorted(rows, key=lambda r: (r["boq"] or "", r["sheet"] or "", int(r["excel_row"] or 0), r.get("name") or ""))
    return [json.dumps(card_line(r), ensure_ascii=False) for r in order]


def summary(lines, data):
    """PURE. The export's summary from its lines and the file's bytes."""
    objs = [json.loads(x) for x in lines]
    return {"rows": len(objs), "distinct_keys": len({o["key"] for o in objs}),
            "distinct_payload_sha256": len({o["payload_sha256"] for o in objs}),
            "prompt_versions": dict(collections.Counter(o["prompt_version"] for o in objs)),
            "models": dict(collections.Counter(o["model"] for o in objs)),
            "by_boq": dict(sorted(collections.Counter(o["key"].split("|", 1)[0] for o in objs).items())),
            "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def file_bytes(lines):
    return ("\n".join(lines) + "\n").encode("utf-8") if lines else b""


def read_rows():
    """Every ok card row of the connected site (read only)."""
    import frappe
    from nirmaan_stack.services.boq_rate_match import cards as C

    return frappe.get_all(C.CARD_DOCTYPE, filters={"status": C.STATUS_OK}, fields=FIELDS,
                          order_by="boq asc, sheet asc, excel_row asc, name asc", limit_page_length=0)


def write_export(rows, out_path):
    """Write the file and its summary. -> the summary."""
    lines = export_lines(rows)
    data = file_bytes(lines)
    with open(out_path, "wb") as f:
        f.write(data)
    rep = summary(lines, data)
    rep["file"] = out_path
    with open(out_path + ".summary.json", "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1, ensure_ascii=False)
    return rep


def main():
    ap = argparse.ArgumentParser(description="Export ok spec cards as the keyed file load_spec_cards.py reads.")
    ap.add_argument("--site", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out_path = os.path.abspath(a.out)
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "sites"))
    import frappe

    frappe.init(site=a.site)
    frappe.connect()
    try:
        frappe.db.sql("select 1")
        frappe.db._conn.rollback()
        frappe.db._conn.set_session(readonly=True)      # the export writes nothing: Postgres refuses any write
        rows = read_rows()
    finally:
        frappe.db.rollback()
        frappe.destroy()
    rep = write_export(rows, out_path)
    print(json.dumps({k: v for k, v in rep.items() if k != "by_boq"}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
