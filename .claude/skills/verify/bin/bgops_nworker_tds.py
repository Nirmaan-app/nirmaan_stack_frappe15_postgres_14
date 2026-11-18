"""The TDS-export part of the N-worker check (spec #1654, testing decision 4), run inside a dev env.

    devenv.sh script <task> .claude/skills/verify/bin/bgops_nworker_tds.py <n> [owner] [heavy_rows]

Do not run it by hand: `bgops_nworker_check.py` starts the env's `long` workers first and stops them after.

One user starts <n> TDS exports back to back, as <n> tabs of one screen would: heavy (<heavy_rows> rows) and light
(1 row) alternate, heavy first. Every row of export i carries the marker `NWC<run>X<i>`, so the PDF a tab receives
says whose it is. Each tab must receive its own PDF; any failed, lost, missing or mixed-up export exits 1.

Two modes, picked by what the code offers:
- **operation** (`tds_report.start_tds_export` exists): each tab makes its own operation id, starts the export,
  reads its status record as the owner until it ends, then collects the file and reads the marker in the PDF.
- **realtime** (today's code before #1662): each tab takes the first `tds_export_ready` / `tds_export_failed`
  message the user's room receives after its own start, exactly as the screen's `socket.on` listener does, and
  is judged by the file name that message names. Messages are read off the Redis `events` channel that Socket.IO
  relays to the browser.

Nothing is written to the DB. Finished PDFs stay in the private folder until the module's expiry sweep.
"""

import io
import json
import sys
import time
import uuid

import frappe

n = int(sys.argv[1]) if len(sys.argv) > 1 else 2
owner = sys.argv[2] if len(sys.argv) > 2 else "Administrator"
heavy_rows = int(sys.argv[3]) if len(sys.argv) > 3 else 200
TIMEOUT_S = 900
TERMINAL = ("finished", "failed", "lost")

run = frappe.generate_hash(length=6).upper()


def marker(i):
    return f"NWC{run}X{i}"


def items(i):
    rows = heavy_rows if i % 2 == 0 else 1
    return [
        {
            "tds_item_name": f"{marker(i)} row {k}",
            "tds_category": "Check Category",
            "tds_description": "check row " * 20,
            "tds_make": "Check Make",
            "tds_item_id": f"NWC-{k}",
            "tds_attachment": None,
        }
        for k in range(rows)
    ]


def label(i):
    return f"{marker(i)} {'heavy' if i % 2 == 0 else 'light'}"


def operation_mode(tds_report):
    from nirmaan_stack.api import background_ops

    frappe.set_user(owner)
    tabs = []
    for i in range(n):
        op_id = str(uuid.uuid4())
        tds_report.start_tds_export(
            op_id=op_id, settings_json="{}", items_json=json.dumps(items(i)), project_name=marker(i)
        )
        frappe.db.commit()  # the request's own commit, which queues the operation
        tabs.append({"i": i, "op_id": op_id, "t0": time.time()})
        print(f"tab {i} ({label(i)}) started operation {op_id}", flush=True)

    t_start = time.time()
    open_tabs = list(tabs)
    while open_tabs and time.time() - t_start < TIMEOUT_S:
        for tab in list(open_tabs):
            status = background_ops.get_status(op_id=tab["op_id"])
            if status["state"] != tab.get("state"):
                tab["state"] = status["state"]
                print(f"+{time.time() - t_start:6.1f}s tab {tab['i']} {status['state']}", flush=True)
            if status["state"] in TERMINAL:
                tab["status"] = status
                open_tabs.remove(tab)
        time.sleep(0.5)

    bad = 0
    for tab in tabs:
        if tab.get("state") != "finished":
            print(f"FAIL tab {tab['i']} ({label(tab['i'])}): ended {tab.get('state') or 'never'} "
                  f"{(tab.get('status') or {}).get('error') or ''}")
            bad += 1
            continue
        frappe.local.response = frappe._dict()
        background_ops.collect_result(op_id=tab["op_id"])
        found = _markers_in(frappe.local.response.filecontent)
        if found != {tab["i"]}:
            print(f"FAIL tab {tab['i']} ({label(tab['i'])}): its PDF holds exports {sorted(found)}")
            bad += 1
        else:
            print(f"ok   tab {tab['i']} ({label(tab['i'])}): its own PDF")
    return bad


def _markers_in(pdf_bytes):
    from pypdf import PdfReader

    text = "".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf_bytes)).pages)
    return {i for i in range(n) if marker(i) in text}


def realtime_mode(tds_report):
    from frappe.utils.background_jobs import get_redis_connection_without_auth

    pubsub = get_redis_connection_without_auth().pubsub(ignore_subscribe_messages=True)
    pubsub.subscribe("events")
    frappe.set_user(owner)
    tabs = []
    for i in range(n):
        tabs.append({"i": i, "t0": time.time()})
        tds_report.export_tds_report(settings_json="{}", items_json=json.dumps(items(i)), project_name=marker(i))
        print(f"tab {i} ({label(i)}) queued its export", flush=True)

    t_start = time.time()
    ended = 0
    while ended < n and time.time() - t_start < TIMEOUT_S:
        msg = pubsub.get_message(timeout=1.0)
        if not msg or msg.get("type") != "message":
            continue
        event = json.loads(msg["data"])
        if event.get("namespace") != frappe.local.site or event.get("room") != f"user:{owner}":
            continue
        if event.get("event") not in ("tds_export_ready", "tds_export_failed"):
            continue
        ended += 1
        now = time.time()
        print(f"+{now - t_start:6.1f}s message {event['event']} {event['message'].get('filename', '')}", flush=True)
        for tab in tabs:
            # The screen's listener takes the first message after its own start, then removes itself.
            if "taken" not in tab and tab["t0"] <= now:
                tab["taken"] = event

    bad = 0
    for tab in tabs:
        taken = tab.get("taken")
        if not taken:
            print(f"FAIL tab {tab['i']} ({label(tab['i'])}): no message reached it")
            bad += 1
        elif taken["event"] != "tds_export_ready":
            print(f"FAIL tab {tab['i']} ({label(tab['i'])}): took a failure: {taken['message']}")
            bad += 1
        elif marker(tab["i"]).lower() not in taken["message"].get("filename", "").lower():
            print(f"FAIL tab {tab['i']} ({label(tab['i'])}): took {taken['message'].get('filename')}")
            bad += 1
        else:
            print(f"ok   tab {tab['i']} ({label(tab['i'])}): its own PDF")
    return bad


from nirmaan_stack.api.tds import tds_report  # noqa: E402

mode = "operation" if hasattr(tds_report, "start_tds_export") else "realtime"
print(f"N-worker TDS check: {n} exports by {owner}, heavy {heavy_rows} rows / light 1 row, mode {mode}, run {run}")
failures = operation_mode(tds_report) if mode == "operation" else realtime_mode(tds_report)
print(f"RESULT tds_exports={n} failed_or_mixed={failures}")
sys.exit(1 if failures else 0)
