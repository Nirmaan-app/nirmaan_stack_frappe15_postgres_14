"""VP-4 THE VALVE PAYLOAD LIBRARY (owner 2026-11-13 23:41) - build / verify / rebuild-pack. READ-ONLY on every source; makes no
model call and never writes the database.

The library keeps, for every priceable valve row, the payload AS SENT and the RAW REPLY behind the row's CURRENT stored answer.
Both are CUT from a real capture log by offset, never rebuilt:
  rows/<BOQ>__<sheet-slug>__r<row>.json   current record + pointers (part, capture file + line, offsets, model, shas, spec)
  history/<same name>.json                 every OTHER archived payload / reply of that row (pointer + copy)
  specs/items_spec_<category>_<sha12>.json each distinct items spec (the questions asked) once
  capture_logs/<part>__capture_run.jsonl   sha-equal copies of every capture file a row points into (+ the laptop's live generations)
  INDEX.tsv, MANIFEST.tsv, README.md

Sources ("parts") are the paid runs' payload_archive folders: each holds capture_run.jsonl (the run's capture records, byte for
byte from the live capture log) and rows/*.txt whose header names the capture line, the payload offset/length inside the logged
prompt and the reply offset inside response_text.

  build   --parts <label=dir> ... --pages <page fetch dir> --valve-keys <tsv> --out <library dir> [--live-capture <dir>]
  verify  --lib <library dir> [--pages <page fetch dir>]          (LIB2)
  rebuild-pack --lib <library dir> --rows <keys file> --out <dir> (LIB3; reads the M6 pack outputs, see rebuild_pack)

Run with the host Python (files only): python -I scripts/valve_library.py verify --lib "<...>/Valve_Payload_Library"
"""
import argparse
import collections
import hashlib
import json
import os
import re
import shutil
import sys

CATEGORY = "hvac_valve_package"
HDR_ROW = re.compile(r"row (BOQ-[\d-]+)\|(.*)#(\d+)\s*$")
HDR_RUN = re.compile(r"\brun ([0-9a-f]{32})")
HDR_CAP = re.compile(r"capture log line capture_run:(\d+)")
HDR_TS = re.compile(r"batch ts (\S+ \S+) attempt (\d+)")
HDR_CAT = re.compile(r"category (\S+)")
HDR_PAY = re.compile(r"payload block: bytes (\d+)\.\.\+(\d+) of the logged prompt")
HDR_REP = re.compile(r"--- RAW REPLY \(cut from response_text at byte (\d+)\) ---")


def sha(text):
    return hashlib.sha256(text.encode("utf-8") if isinstance(text, str) else text).hexdigest()


def file_sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")


def row_file_name(boq, sheet, row):
    return "%s__%s__r%s.json" % (boq, slug(sheet), row)


def vals(items):
    """The value-level answer the pricer reads: (section, attribute values) per item, blanks dropped."""
    out = []
    for it in items or []:
        a = {k: (v or {}).get("value") if isinstance(v, dict) else v for k, v in sorted((it.get("attributes") or {}).items())}
        a = {k: v for k, v in a.items() if v not in (None, "None", "")}
        out.append((it.get("section") or "", json.dumps(a, sort_keys=True)))
    return out


def _canon(o):
    """Canonical form for the stored-answer sha: a whole-number float is its int (Python writes 0.0 where JavaScript writes 0)."""
    if isinstance(o, float) and o.is_integer():
        return int(o)
    if isinstance(o, dict):
        return {k: _canon(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_canon(v) for v in o]
    return o


def stored_sha(items):
    return sha(json.dumps(_canon(items), sort_keys=True, separators=(",", ":")))


def capture_name(label):
    return slug(label) + "__capture_run.jsonl"


def _capture_file(part_dir):
    for n in ("capture_run.jsonl", "_run_capture_run.jsonl"):
        if os.path.exists(os.path.join(part_dir, n)):
            return os.path.join(part_dir, n)
    raise SystemExit("no capture_run.jsonl in " + part_dir)


def cut(record, pay_off, pay_len, rep_off):
    """Payload and raw reply CUT from one capture record. The offsets are UTF-8 BYTE offsets into prompt / response_text (as the
    archive headers say); a text with no multi-byte character cuts the same either way."""
    payload = record["prompt"].encode("utf-8")[pay_off:pay_off + pay_len].decode("utf-8")
    tail = record["response_text"].encode("utf-8")[rep_off:].decode("utf-8")
    obj, end = json.JSONDecoder().raw_decode(tail)
    return payload, tail[:end], obj


def read_part(label, part_dir, specs):
    """Every archived valve row record of one part, each re-cut from the part's capture file and checked against the row file."""
    cap_path = _capture_file(part_dir)
    lines = open(cap_path, encoding="utf-8", newline="").read().split("\n")
    out = []
    for f in sorted(os.listdir(os.path.join(part_dir, "rows"))):
        t = open(os.path.join(part_dir, "rows", f), encoding="utf-8", newline="").read()
        head = t.split("\n", 3)
        cat = HDR_CAT.search(head[1])
        if not cat or cat.group(1) != CATEGORY:
            continue
        m = HDR_ROW.search(head[0])
        boq, sheet, row = m.group(1), m.group(2), int(m.group(3))
        cap = int(HDR_CAP.search(head[1]).group(1))
        pay = HDR_PAY.search(head[2])
        rep = HDR_REP.search(t)
        ts = HDR_TS.search(head[1])
        rec = json.loads(lines[cap - 1])
        payload, raw, obj = cut(rec, int(pay.group(1)), int(pay.group(2)), int(rep.group(1)))
        archived_payload = t.split("--- PAYLOAD AS SENT ---\n", 1)[1].split("\n\n--- RAW REPLY", 1)[0].strip("\n")
        archived_reply = t.split(rep.group(0) + "\n", 1)[1].strip("\n")      # a reply may span several lines
        spec_sha = next((s for s, txt in specs.items() if txt.strip() in rec["prompt"]), None)
        out.append({
            "key": "%s|%s|%s" % (boq, sheet, row), "boq": boq, "sheet": sheet, "excel_row": row,
            "part": label, "archive_row_file": os.path.join(part_dir, "rows", f),
            "run_id": HDR_RUN.search(head[1]).group(1), "batch_ts": ts.group(1) if ts else rec.get("ts"),
            "attempt": int(ts.group(2)) if ts else rec.get("attempt"),
            "capture_file": capture_name(label), "capture_line": cap, "capture_record_sha": sha(lines[cap - 1]),
            "payload_offset": int(pay.group(1)), "payload_length": int(pay.group(2)), "reply_offset": int(rep.group(1)),
            "model": rec.get("model"), "request_sha": sha(payload), "reply_sha": sha(raw), "spec_sha": spec_sha,
            "payload": payload, "raw_reply": raw, "reply_items": obj.get("items"),
            "archive_payload_equal": payload == archived_payload, "archive_reply_equal": raw == archived_reply,
            "reply_id_equal": obj.get("id") == row,
        })
    return out, cap_path


def page_rows(pages_dir):
    """The page's own current stored answer per valve row (the active run's results) + the node id from the priced rows."""
    cur = {}
    for sh in json.load(open(os.path.join(pages_dir, "sheets.json"), encoding="utf-8")):
        pg = json.load(open(os.path.join(pages_dir, "%d.json" % sh["n"]), encoding="utf-8"))
        run = ((pg.get("run") or {}).get("run")) or {}
        res = run.get("results") or []
        res = json.loads(res) if isinstance(res, str) else res
        rows = res if isinstance(res, list) else res.get("rows", [])
        nodes = {r.get("source_row_number"): r for r in (pg.get("priced") or {}).get("rows") or []}
        for x in rows:
            k = "%s|%s|%s" % (sh["boq"], sh["sheet"], x.get("excel_row"))
            nd = nodes.get(x.get("excel_row")) or {}
            cur[k] = {"items": x.get("items") or [], "category": x.get("category_id"), "active_run": run.get("run_id"),
                      "node_id": nd.get("name"), "description": x.get("description")}
    return cur


def valve_keys(tsv):
    keys = set()
    for line in open(tsv, encoding="utf-8"):
        f = line.rstrip("\n").split("\t")
        if f[0] != "group" and len(f) > 6 and f[6] == CATEGORY:
            keys.add("%s|%s|%s" % (f[2], f[3], f[4]))
    return keys


def dump(path, obj):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        json.dump(obj, fh, indent=1, ensure_ascii=False, sort_keys=False)
        fh.write("\n")


def write_text(path, text):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def build(a):
    out = a.out
    for d in ("rows", "history", "specs", "capture_logs"):
        os.makedirs(os.path.join(out, d), exist_ok=True)
    parts = [p.split("=", 1) for p in a.parts]          # newest first
    specs = {}
    for _, pdir in parts:
        sd = os.path.join(pdir, "specs")
        for f in os.listdir(sd) if os.path.isdir(sd) else []:
            m = re.match(r"items_spec_(.+)_([0-9a-f]{12})\.json$", f)
            if m and m.group(1) == CATEGORY:
                specs[m.group(2)] = open(os.path.join(sd, f), encoding="utf-8", newline="").read()
    recs = collections.defaultdict(list)
    for rank, (label, pdir) in enumerate(parts):
        got, cap_path = read_part(label, pdir, specs)
        shutil.copyfile(cap_path, os.path.join(out, "capture_logs", capture_name(label)))
        for r in got:
            r["rank"] = rank
            recs[r["key"]].append(r)
    if a.live_capture:
        ld = os.path.join(out, "capture_logs", "laptop_live_after_VP-4L")
        os.makedirs(ld, exist_ok=True)
        for f in sorted(os.listdir(a.live_capture)):
            shutil.copyfile(os.path.join(a.live_capture, f), os.path.join(ld, f))
    used_specs = set()
    cur = page_rows(a.pages)
    keys = valve_keys(a.valve_keys)
    index, problems = [], collections.Counter()
    for k in sorted(keys, key=lambda s: (s.split("|")[0], s.split("|")[1], int(s.split("|")[2]))):
        boq, sheet, row = k.split("|")
        c = cur.get(k)
        if c is None:
            problems["not_on_page"] += 1
            continue
        # newest part first; inside a part the latest batch first (stable sort on rank after the ts sort)
        cand = sorted(recs.get(k, []), key=lambda r: r["batch_ts"] or "", reverse=True)
        cand.sort(key=lambda r: r["rank"])
        hit = next((r for r in cand if vals(r["reply_items"]) == vals(c["items"])), None)
        if hit is None:
            problems["no_current_record"] += 1
            continue
        name = row_file_name(boq, sheet, row)
        used_specs.add(hit["spec_sha"])
        body = {k2: hit[k2] for k2 in ("key", "boq", "sheet", "excel_row")}
        body.update({
            "node_id": c["node_id"], "category": c["category"], "active_run_now": c["active_run"],
            "stored_answer_sha": stored_sha(c["items"]), "stored_items": c["items"],
            "current": {k2: hit[k2] for k2 in ("part", "run_id", "batch_ts", "attempt", "capture_file", "capture_line",
                                               "capture_record_sha", "payload_offset", "payload_length", "reply_offset", "model",
                                               "request_sha", "reply_sha", "spec_sha")},
            "payload": hit["payload"], "raw_reply": hit["raw_reply"],
            "history_file": None,
        })
        body["current"]["archive_row_file"] = os.path.basename(hit["archive_row_file"])
        hist = [r for r in cand if r is not hit]
        if hist:
            body["history_file"] = "history/" + name
            dump(os.path.join(out, "history", name), {"key": k, "earlier_records": [
                {k2: r[k2] for k2 in ("part", "run_id", "batch_ts", "attempt", "capture_file", "capture_line", "capture_record_sha",
                                      "payload_offset", "payload_length", "reply_offset", "model", "request_sha", "reply_sha",
                                      "spec_sha", "payload", "raw_reply")} for r in hist]})
            used_specs.update(r["spec_sha"] for r in hist)
        dump(os.path.join(out, "rows", name), body)
        index.append([k, boq, sheet, row, c["node_id"] or "", c["category"] or "", hit["part"], hit["run_id"], hit["batch_ts"] or "",
                      hit["capture_file"], str(hit["capture_line"]), str(hit["payload_offset"]), str(hit["reply_offset"]),
                      hit["request_sha"], hit["reply_sha"], hit["spec_sha"] or "", body["stored_answer_sha"], "rows/" + name,
                      body["history_file"] or "", str(len(hist))])
    for s in sorted(x for x in used_specs if x):
        write_text(os.path.join(out, "specs", "items_spec_%s_%s.json" % (CATEGORY, s)), specs[s])
    hdr = ["key", "boq", "sheet", "excel_row", "node_id", "category", "part", "run_id", "batch_ts", "capture_file", "capture_line",
           "payload_offset", "reply_offset", "request_sha", "reply_sha", "spec_sha", "stored_answer_sha", "row_file", "history_file",
           "earlier_records"]
    write_text(os.path.join(out, "INDEX.tsv"), "\t".join(hdr) + "\n" + "".join("\t".join(r) + "\n" for r in index))
    allr = [r for rs in recs.values() for r in rs]
    print("archived valve records", len(allr), "| re-cut == archive payload", sum(r["archive_payload_equal"] for r in allr),
          "| == archive reply", sum(r["archive_reply_equal"] for r in allr), "| reply id == row", sum(r["reply_id_equal"] for r in allr),
          "| spec found", sum(1 for r in allr if r["spec_sha"]))
    by_part = collections.Counter(r[6] for r in index)
    print("rows", len(index), "of", len(keys), dict(by_part), "problems", dict(problems),
          "history files", sum(1 for r in index if r[18]), "specs", len([s for s in used_specs if s]))
    return 0 if not problems and len(index) == len(keys) else 1


def manifest(lib):
    rows = []
    for root, _, files in os.walk(lib):
        for f in files:
            p = os.path.join(root, f)
            rel = os.path.relpath(p, lib).replace(os.sep, "/")
            if rel == "MANIFEST.tsv":
                continue
            rows.append((rel, os.path.getsize(p), file_sha(p)))
    rows.sort()
    write_text(os.path.join(lib, "MANIFEST.tsv"), "path\tsize\tsha256\n" + "".join("%s\t%d\t%s\n" % r for r in rows))
    print("MANIFEST files", len(rows), "bytes", sum(r[1] for r in rows), "sha", file_sha(os.path.join(lib, "MANIFEST.tsv")))


def verify(a):
    """LIB2: every row has a current payload + reply; each re-cut from the library's own capture copy is byte-equal; the reply's
    answer equals the stored answer (value level, and the stored sha against the page when --pages is given); 0 orphans; MANIFEST
    re-hashed equal."""
    lib = a.lib
    idx = [l.rstrip("\n").split("\t") for l in open(os.path.join(lib, "INDEX.tsv"), encoding="utf-8")][1:]
    caps = {}
    cur = page_rows(a.pages) if a.pages else None
    c = collections.Counter()
    listed = set()
    for r in idx:
        body = json.load(open(os.path.join(lib, r[17]), encoding="utf-8"))
        listed.add(r[17])
        cu = body["current"]
        if cu["capture_file"] not in caps:
            caps[cu["capture_file"]] = open(os.path.join(lib, "capture_logs", cu["capture_file"]), encoding="utf-8", newline="").read().split("\n")
        line = caps[cu["capture_file"]][cu["capture_line"] - 1]
        rec = json.loads(line)
        payload, raw, obj = cut(rec, cu["payload_offset"], cu["payload_length"], cu["reply_offset"])
        c["has_payload_reply"] += bool(body["payload"]) and bool(body["raw_reply"])
        c["payload_byte_equal"] += payload == body["payload"] and sha(payload) == cu["request_sha"]
        c["reply_byte_equal"] += raw == body["raw_reply"] and sha(raw) == cu["reply_sha"]
        c["record_sha_equal"] += sha(line) == cu["capture_record_sha"]
        c["ea7_payload_in_items"] += any(json.dumps(p, ensure_ascii=False) == payload or json.dumps(p) == payload
                                         for p in [x for x in _payload_items(rec) if x.get("id") == body["excel_row"]])
        c["reply_id_equal"] += obj.get("id") == body["excel_row"]
        c["answer_equal_stored"] += vals(obj.get("items")) == vals(body["stored_items"])
        c["spec_present"] += os.path.exists(os.path.join(lib, "specs", "items_spec_%s_%s.json" % (CATEGORY, cu["spec_sha"])))
        if cur is not None:
            p = cur.get(body["key"])
            c["stored_sha_equal_page"] += bool(p) and stored_sha(p["items"]) == body["stored_answer_sha"]
        if body.get("history_file"):
            c["history_present"] += os.path.exists(os.path.join(lib, body["history_file"]))
    on_disk = {"rows/" + f for f in os.listdir(os.path.join(lib, "rows"))}
    c["orphans"] = len(on_disk - listed)
    man = [l.rstrip("\n").split("\t") for l in open(os.path.join(lib, "MANIFEST.tsv"), encoding="utf-8")][1:]
    c["manifest_files"] = len(man)
    c["manifest_equal"] = sum(1 for p, s, h in man if os.path.exists(os.path.join(lib, p)) and os.path.getsize(os.path.join(lib, p)) == int(s)
                              and file_sha(os.path.join(lib, p)) == h)
    files_now = sum(len(fs) for _, _, fs in os.walk(lib)) - 1
    c["files_on_disk_not_manifest"] = files_now - len(man)
    n = len(idx)
    print("LIB2 rows", n)
    for k in ("has_payload_reply", "payload_byte_equal", "reply_byte_equal", "record_sha_equal", "ea7_payload_in_items",
              "reply_id_equal", "answer_equal_stored", "spec_present", "stored_sha_equal_page", "history_present"):
        if k in c or k != "stored_sha_equal_page":
            print("  %-26s %d" % (k, c[k]))
    print("  orphans %d | MANIFEST %d / %d equal | files not in MANIFEST %d" % (c["orphans"], c["manifest_equal"], c["manifest_files"],
                                                                           c["files_on_disk_not_manifest"]))
    ok = all(c[k] == n for k in ("has_payload_reply", "payload_byte_equal", "reply_byte_equal", "record_sha_equal",
                                 "ea7_payload_in_items", "reply_id_equal", "answer_equal_stored", "spec_present"))
    ok = ok and (cur is None or c["stored_sha_equal_page"] == n) and c["orphans"] == 0
    ok = ok and c["manifest_equal"] == c["manifest_files"] and c["files_on_disk_not_manifest"] == 0
    print("LIB2", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def _payload_items(rec):
    """The batch's payload items as logged (a JSON list, or the Python repr the capture writer used)."""
    p = rec.get("payload_items")
    if isinstance(p, list):
        return p
    try:
        return json.loads(p)
    except Exception:
        import ast
        return ast.literal_eval(p)


CONTAINER = "frappe_docker_devcontainer-frappe-1"
APP = "/workspace/development/frappe-bench/apps/nirmaan_stack"
ASSETS = [APP + "/nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v68.json",
          APP + "/nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v72.json"]
CHUNK_BYTES = 300_000


def _docker(*args, cwd=None):
    import subprocess
    e = dict(os.environ, MSYS_NO_PATHCONV="1")
    cmd = ["docker"] + list(args)
    r = subprocess.run(cmd, env=e, capture_output=True, text=True, encoding="utf-8", cwd=cwd)
    if r.returncode != 0:
        raise SystemExit("docker %s failed: %s %s" % (args[0], r.stdout[-2000:], r.stderr[-2000:]))
    return r.stdout


def _fig(f):
    return "-" if not f else "supply %s / install %s / total %s" % (f.get("supply"), f.get("install"), f.get("total"))


def row_block(lib_row, pk):
    """One "######## ROW" block: payload, raw reply, items after the rules, PANEL lines, CALCULATOR lines, DIFF, figures, unit, qty.
    NO verdicts and NO review notes."""
    out = ["######## ROW %s" % pk["key"],
           "node %s | %s | category %s | unit %r | qty %s | library %s" % (pk["node_id"], pk["node_type"], pk["category"], pk["unit"],
                                                                          pk["qty"], lib_row["_file"]),
           "row text: %s" % pk["description"],
           "--- PAYLOAD AS SENT (%s, capture %s:%s, request sha %s)" % (lib_row["current"]["part"], lib_row["current"]["capture_file"],
                                                                       lib_row["current"]["capture_line"], lib_row["current"]["request_sha"][:12]),
           lib_row["payload"],
           "--- RAW REPLY (reply sha %s)" % lib_row["current"]["reply_sha"][:12],
           lib_row["raw_reply"],
           "--- ITEMS AFTER THE RULES (stored answer sha %s)" % lib_row["stored_answer_sha"][:12]]
    for i, it in enumerate(pk.get("ext_items") or [], 1):
        a = {k: (v or {}).get("value") for k, v in (it.get("attributes") or {}).items()}
        out.append("  item %d: %s" % (i, json.dumps({k: v for k, v in a.items() if v not in (None, "None", "")}, ensure_ascii=False)))
    for side, label in (("panel", "PANEL"), ("calculator", "CALCULATOR")):
        s = pk[side] or {}
        out.append("--- %s: %s | row priced %s | unit %s (%s) | per unit %s" % (label, s.get("kind"), s.get("rowPriced"), s.get("unit"),
                                                                              s.get("unitClass"), _fig(s.get("totals"))))
        if s.get("reason"):
            out.append("  refusal / reason: %s" % s["reason"])
        for k in ("unitNote", "split", "scope"):
            if s.get(k):
                out.append("  %s: %s" % (k, s[k]))
        for i, b in enumerate(s.get("items") or [], 1):
            out.append("  item %d: %s | %s | sku %s | qty %s | %s%s" % (i, b.get("family"), b.get("state"), b.get("sku"), b.get("qty"),
                                                                      _fig(b.get("figures")), (" | " + b["reason"]) if b.get("reason") else ""))
            for w in b.get("working") or []:
                out.append("      %s" % w)
        for nline in s.get("notes") or []:
            out.append("  note: %s" % nline)
    out.append("--- DIFF calculator vs panel: %s%s" % (pk["diff"], (" (" + pk["diff_why"] + ")") if pk.get("diff_why") else ""))
    for f in pk.get("resolved_fields") or []:
        out.append("  calculator fed the panel's resolved %s" % f)
    t = pk.get("calculator_as_typed") or {}
    if t.get("diff") and t.get("diff") != pk["diff"]:
        out.append("  as typed (the model's own words in the Other box): %s (%s) | %s" % (t["diff"], t.get("diff_why"), (t.get("result") or {}).get("reason")))
    p = (pk["panel"] or {}).get("totals") or {}
    out.append("supply %s | install %s | total %s | unit %r | qty %s" % (p.get("supply"), p.get("install"), p.get("total"), pk["unit"], pk["qty"]))
    return "\n".join(out) + "\n"


def rebuild_pack(a):
    """LIB3: the three-layer pack and review chunks for any row list, FROM THE LIBRARY + THE DATABASE (a read-only page fetch, then
    the product's own panel and calculator through valve_pack_harness.ts). No model call; the capture log is never touched."""
    lib, out = a.lib, a.out
    os.makedirs(out, exist_ok=True)
    idx = {l.split("\t", 1)[0]: l.rstrip("\n").split("\t") for l in open(os.path.join(lib, "INDEX.tsv"), encoding="utf-8")}
    idx.pop("key", None)
    keys = [k.rstrip("\r\n") for k in open(a.rows, encoding="utf-8") if k.strip()] if a.rows != "ALL" else list(idx)
    missing = [k for k in keys if k not in idx]
    if missing:
        raise SystemExit("rows not in the library: %d (first %s)" % (len(missing), missing[:3]))
    tmp = "/tmp/valve_library_%s" % os.getpid()
    sheets = []
    for k in keys:
        b, s, _ = k.split("|")
        if (b, s) not in sheets:
            sheets.append((b, s))
    in_tsv = os.path.join(out, "_fetch_in.tsv")
    write_text(in_tsv, "boq\tsheet\trows\n" + "".join("%s\t%s\tALL\n" % x for x in sheets))
    write_text(os.path.join(out, "_keys.txt"), "".join(k + "\n" for k in keys))
    here = os.path.dirname(os.path.abspath(__file__))
    _docker("exec", CONTAINER, "mkdir", "-p", tmp)
    for src, dst in ((in_tsv, "in.tsv"), (os.path.join(out, "_keys.txt"), "keys.txt"),
                     (os.path.join(here, "_instruments", "valve_page_fetch.py"), "fetch.py")):
        # Docker on Windows reads a "C:\..." source as container:path -- copy from the file's own folder as ./name
        _docker("cp", "./" + os.path.basename(src), "%s:%s/%s" % (CONTAINER, tmp, dst), cwd=os.path.dirname(os.path.abspath(src)))
    print(_docker("exec", "-e", "PGOPTIONS=-c default_transaction_read_only=on", "-w", "/workspace/development/frappe-bench", CONTAINER,
                  "env/bin/python", "-I", tmp + "/fetch.py", tmp + "/in.tsv", tmp + "/pages").strip().splitlines()[-1])
    print(_docker("exec", "-w", APP + "/frontend", "-e", "VPK_DIR=%s/pages" % tmp, "-e", "VPK_KEYS=%s/keys.txt" % tmp,
                  "-e", "VPK_OUT=%s/pack.jsonl" % tmp, "-e", "VPK_ASSET=" + ",".join(ASSETS), CONTAINER, "bash", "-c",
                  "export PATH=/home/frappe/.nvm/versions/node/v24.13.0/bin:$PATH; node_modules/.bin/esbuild ../scripts/_instruments/valve_pack_harness.ts"
                  " --bundle --platform=node --format=esm --outfile=%s/h.mjs --loader:.css=empty --log-level=error && node %s/h.mjs" % (tmp, tmp)).strip())
    _docker("cp", "%s:%s/pack.jsonl" % (CONTAINER, tmp), "./pack_harness.jsonl", cwd=os.path.abspath(out))
    _docker("exec", CONTAINER, "rm", "-rf", tmp)
    pk = {}
    for line in open(os.path.join(out, "pack_harness.jsonl"), encoding="utf-8"):
        if line.strip():
            r = json.loads(line)
            pk[r["key"]] = r
    order = sorted(keys, key=lambda k: (k.split("|")[0], k.split("|")[1], int(k.split("|")[2])))
    chunks, cur, size, rows_out = [], [], 0, []
    for k in order:
        lr = json.load(open(os.path.join(lib, idx[k][17]), encoding="utf-8"))
        lr["_file"] = idx[k][17]
        p = pk.get(k)
        if p is None:
            raise SystemExit("row not priced by the harness: " + k)
        if stored_sha(p.get("ext_items") or []) != lr["stored_answer_sha"]:
            print("NOTE stored answer moved since the library build:", k)
        blk = row_block(lr, p)
        if cur and size + len(blk.encode("utf-8")) > CHUNK_BYTES:
            chunks.append(cur)
            cur, size = [], 0
        cur.append(blk)
        size += len(blk.encode("utf-8"))
        pt, ct = (p["panel"] or {}).get("totals") or {}, (p["calculator"] or {}).get("totals") or {}
        rows_out.append({"key": k, "node_id": p["node_id"], "node_type": p["node_type"], "category": p["category"], "unit": p["unit"],
                         "qty": p["qty"], "panel_family": " + ".join(str(b.get("family")) for b in (p["panel"] or {}).get("items") or []),
                         "panel_priced": (p["panel"] or {}).get("rowPriced"), "panel_reason": (p["panel"] or {}).get("reason"),
                         "panel_supply": pt.get("supply"), "panel_install": pt.get("install"), "panel_total": pt.get("total"),
                         "calc_priced": (p["calculator"] or {}).get("rowPriced"), "calc_reason": (p["calculator"] or {}).get("reason"),
                         "calc_supply": ct.get("supply"), "calc_install": ct.get("install"), "calc_total": ct.get("total"),
                         "diff": p["diff"], "diff_why": p["diff_why"], "as_typed_diff": (p.get("calculator_as_typed") or {}).get("diff"),
                         "as_typed_why": (p.get("calculator_as_typed") or {}).get("diff_why"),
                         "as_typed_reason": ((p.get("calculator_as_typed") or {}).get("result") or {}).get("reason"),
                         "resolved_fields": "; ".join(p.get("resolved_fields") or []),
                         "value": (pt.get("total") * p["qty"]) if isinstance(pt.get("total"), (int, float)) and isinstance(p["qty"], (int, float)) else None,
                         "stored_answer_sha": lr["stored_answer_sha"], "library_file": idx[k][17], "block_sha": sha(blk)})
    if cur:
        chunks.append(cur)
    cd = os.path.join(out, "review_chunks")
    os.makedirs(cd, exist_ok=True)
    for i, c in enumerate(chunks, 1):
        write_text(os.path.join(cd, "chunk_%03d.txt" % i), "".join(c))
    with open(os.path.join(out, "pack_rows.jsonl"), "w", encoding="utf-8", newline="") as fh:
        for r in rows_out:
            fh.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
    print("rebuild-pack rows", len(rows_out), "chunks", len(chunks), "diff", dict(collections.Counter(r["diff"] for r in rows_out)),
          "as typed", dict(collections.Counter(r["as_typed_diff"] for r in rows_out)))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    b = sp.add_parser("build")
    b.add_argument("--parts", nargs="+", required=True, help="label=dir, newest first")
    b.add_argument("--pages", required=True)
    b.add_argument("--valve-keys", required=True)
    b.add_argument("--out", required=True)
    b.add_argument("--live-capture")
    v = sp.add_parser("verify")
    v.add_argument("--lib", required=True)
    v.add_argument("--pages")
    m = sp.add_parser("manifest")
    m.add_argument("--lib", required=True)
    r = sp.add_parser("rebuild-pack")
    r.add_argument("--lib", required=True)
    r.add_argument("--rows", required=True, help="a file of BOQ|sheet|row keys, or ALL")
    r.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "rebuild-pack":
        return rebuild_pack(a)
    if a.cmd == "build":
        return build(a)
    if a.cmd == "manifest":
        return manifest(a.lib) or 0
    return verify(a)


if __name__ == "__main__":
    sys.exit(main())
