#!/usr/bin/env python3
"""Walk the screens that follow a background operation (spec #1654, tickets #1662-#1665), as each screen's role.

    python3 .claude/skills/verify/bin/walk_background_operations.py --task <task> --part <part> \
        --user <email> --password <pw> [--project <id> --project-name <name>]

Parts (each run as the role that uses the screen; pick an unlocked user with `free_users.py "<profile>"`):
- `tds`        TDS export from a project's TDS tab, in two tabs at once: each tab downloads its own PDF.
               A project user with TDS access (e.g. a Project Manager on the project).
- `handover`   The handover binder and the Handover TDS export, in two tabs at once: each ends in its own file.
               The same project user, on a project whose HVAC handover has Done documents.
- `commission` Commission bulk download (Commission Report tab -> Bulk Approved Reports). A Project Manager on a
               project with Submitted Field reports.
- `bulk`       Bulk PDF download (Bulk Download tab -> Delivery Challans). A Procurement Executive on the project.
- `boq`        BoQ upload in two tabs at once (failure path: a dev env's worker cannot read the production bucket):
               each tab shows its own outcome, and the 30 s "taking a little longer" note waits for the parse to
               start running. An Estimates Executive. No project argument: the first project in the picker.
- `template`   BoQ template seed (Admin Options -> BoQ Templates), failure path as above. An Estimates Executive.

Each part starts its operations with no worker running, saves the screen showing "Waiting in the queue", then starts
the `long` worker(s) it needs (`bgops_workers.py`) and stops them at the end. A dev env serves no realtime
(Socket.IO), so every screen here finishes by polling alone: that is also the dropped-socket case.

It asserts, for each tab, the screen's text and the operation's status record (`bgops_db.py`; the record lives in
the cache Redis, not the DB): the record's owner is the walking user, its kind and end state are the flow's, the two
tabs followed two different operations, and a downloaded file is byte for byte the size the tab's own record names.
It saves the records as `db.txt` beside the screenshots and exits 1 on any miss.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bgops_workers import in_container, long_workers  # noqa: E402
from drive import save, session, sidebar  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.getcwd()  # run from the checkout's root, as every verify command is
DEVENV = os.path.join(APP, "scripts", "devenv", "devenv.sh")
QUEUED = "Waiting in the queue"

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--part", required=True, choices=["tds", "handover", "commission", "bulk", "boq", "template"])
ap.add_argument("--user", required=True)
ap.add_argument("--password", required=True)
ap.add_argument("--project", help="the project id (tds, handover, commission, bulk)")
ap.add_argument("--project-name", help="the project's name, as the Projects list searches it")
a = ap.parse_args()
if a.part in ("tds", "handover", "commission", "bulk") and not (a.project and a.project_name):
    ap.error(f"--part {a.part} needs --project and --project-name")

misses = []


def check(ok, what):
    print(f"{'ok  ' if ok else 'MISS'} {what}", flush=True)
    if not ok:
        misses.append(what)


def follow_ops(page):
    """The operation ids this tab reads the status of, in order (the hook polls get_status?op_id=...)."""
    ops = []

    def on_request(request):
        m = re.search(r"get_status\?op_id=([0-9a-f-]{36})", request.url)
        if m and m.group(1) not in ops:
            ops.append(m.group(1))

    page.on("request", on_request)
    return ops


def records(op_ids, out):
    run = subprocess.run([DEVENV, "script", a.task, os.path.join(HERE, "bgops_db.py"), *op_ids],
                         cwd=APP, capture_output=True, text=True)
    line = next((ln for ln in run.stdout.splitlines() if ln.startswith("BGOPS ")), None)
    if not line:
        sys.exit(f"bgops_db.py printed no records:\n{run.stdout}\n{run.stderr}")
    found = json.loads(line[len("BGOPS "):])
    with open(out / "db.txt", "a") as f:
        f.write(json.dumps(found, indent=1, default=str) + "\n")
    return found


def collect_downloads(page, into):
    page.on("download", lambda d: into.append(d))


def wait_until(predicate, timeout_s, step_ms=2000, page=None):
    end = time.time() + timeout_s
    while time.time() < end:
        if predicate():
            return True
        (page.wait_for_timeout(step_ms) if page else time.sleep(step_ms / 1000))
    return predicate()


def open_project(page, tab):
    """Sidebar Projects -> search the project's name -> its link -> a tab of the project page."""
    sidebar(page, "Projects")
    page.get_by_placeholder(re.compile("Search", re.I)).first.fill(a.project_name)
    page.get_by_role("link", name=a.project_name, exact=True).first.click()
    page.wait_for_url(re.compile(re.escape(a.project)))
    page.get_by_role("button", name=tab, exact=True).click()
    page.wait_for_timeout(3000)


def check_file(tab, record, download, out, kind):
    check(record is not None, f"{tab}: the status record exists")
    if not record:
        return
    check(record["owner"] == a.user, f"{tab}: the record's owner is {a.user} (it is {record['owner']})")
    check(record["kind"] == kind, f"{tab}: the record's kind is {kind} (it is {record['kind']})")
    check(record["state"] == "finished", f"{tab}: the record reads finished (it reads {record['state']})")
    if download is None:
        check(False, f"{tab}: the tab downloaded a file")
        return
    path = out / f"{tab}-{download.suggested_filename}"
    download.save_as(path)
    want = ((record.get("result") or {}).get("file") or {}).get("size_bytes")
    check(path.stat().st_size == want,
          f"{tab}: the downloaded file is its own operation's ({path.stat().st_size} bytes, record says {want})")


def two_tab_downloads(page, out, kind_a, kind_b, start_a, start_b, timeout_s=600, queued_b=QUEUED):
    """Start an operation in each of two tabs with no worker, show both queued, then run them on two workers.

    `queued_b` is what tab b shows while its operation waits (the Handover TDS export says only "Exporting...")."""
    page_b = page.context.new_page()
    page_b.goto(page.url.split("?")[0])
    ops_a, ops_b, dl_a, dl_b = follow_ops(page), follow_ops(page_b), [], []
    collect_downloads(page, dl_a)
    collect_downloads(page_b, dl_b)
    start_a(page)
    start_b(page_b)
    for name, p, text in (("a", page, QUEUED), ("b", page_b, queued_b)):
        check(wait_until(lambda p=p, text=text: p.get_by_text(text).count() > 0, 30, page=p),
              f"tab {name}: shows '{text}' while no worker runs")
        save(p, out, f"02-tab-{name}-queued")
    with long_workers(a.task, 2):
        wait_until(lambda: dl_a and dl_b, timeout_s, page=page)
    save(page, out, "03-tab-a-done")
    save(page_b, out, "03-tab-b-done")
    check(bool(ops_a) and bool(ops_b) and ops_a[-1] != ops_b[-1], "the two tabs followed two different operations")
    if not (ops_a and ops_b):
        return
    found = records([ops_a[-1], ops_b[-1]], out)
    check_file("tab-a", found[ops_a[-1]], dl_a[0] if dl_a else None, out, kind_a)
    check_file("tab-b", found[ops_b[-1]], dl_b[0] if dl_b else None, out, kind_b)


def tick_one(dialog, nth):
    dialog.get_by_role("checkbox", name="Include in PDF").nth(nth).click(force=True)


def part_tds(page, out):
    open_project(page, "TDS")
    save(page, out, "01-tds-tab")

    def start(nth):
        def go(p):
            if p.url.split("?")[0] != page.url.split("?")[0] or "tdsrepository" not in p.url:
                p.goto(page.url)
            p.get_by_role("button", name="Download TDS PDF").click()
            d = p.get_by_role("dialog")
            d.get_by_role("button", name="Deselect all").click()
            tick_one(d, nth)
            d.get_by_role("button", name=re.compile(r"^Download PDF \(1\)")).click()
        return go

    two_tab_downloads(page, out, "tds_export", "tds_export", start(0), start(1))


def part_handover(page, out):
    open_project(page, "Handover Documents")
    save(page, out, "01-handover-tab")
    url = page.url

    def binder(p):
        p.get_by_role("button", name="Download binder").click()
        p.get_by_role("dialog").get_by_role("button", name="Download binder").click()

    def tds(p):
        p.goto(url)
        p.get_by_role("row", name=re.compile("Material Technical Data Sheet")).get_by_role(
            "button", name="Edit").click()
        d = p.get_by_role("dialog")
        if not d.get_by_role("checkbox", name="Include in PDF", checked=True).count():
            tick_one(d, 0)  # a first export ticks one; a later one keeps the ticks the last export saved
        d.get_by_role("button", name=re.compile(r"^Download PDF \([1-9]\d*\)")).click()

    two_tab_downloads(page, out, "hod_binder", "tds_export", binder, tds, timeout_s=900, queued_b="Exporting...")


def one_download(page, out, kind, start, timeout_s=600):
    ops, dls = follow_ops(page), []
    collect_downloads(page, dls)
    start(page)
    check(wait_until(lambda: page.get_by_text(re.compile("Waiting in the queue|Waiting for the server to start|Queued")).count() > 0, 30, page=page),
          "shows the operation queued while no worker runs")
    save(page, out, "02-queued")
    with long_workers(a.task, 1):
        wait_until(lambda: dls, timeout_s, page=page)
    save(page, out, "03-done")
    check(bool(ops), "the screen followed an operation")
    if ops:
        check_file("download", records([ops[-1]], out)[ops[-1]], dls[0] if dls else None, out, kind)


def part_commission(page, out):
    open_project(page, "Commission Report")
    save(page, out, "01-commission-tab")

    def start(p):
        p.get_by_role("button", name="Bulk Approved Reports").click()
        d = p.get_by_role("dialog")
        d.get_by_text(re.compile(r"^Select all")).click()
        d.get_by_role("button", name="Export").click()

    one_download(page, out, "commission_bulk_download", start)


def part_bulk(page, out):
    open_project(page, "Bulk Download")
    save(page, out, "01-bulk-tab")

    def start(p):
        p.get_by_role("button", name=re.compile("Delivery Challans")).click()
        p.wait_for_timeout(3000)
        rows = p.get_by_role("row").filter(has=p.get_by_role("checkbox"))
        for i in (1, 2):
            rows.nth(i).get_by_role("checkbox").click(force=True)
        p.get_by_role("button", name=re.compile(r"^Download 2 ")).first.click()

    one_download(page, out, "bulk_pdf_download", start)


def made_up_workbook(out):
    """A small made-up .xlsx (one sheet, two rows), written by the bench's openpyxl and copied to the host."""
    in_container("cd /tmp && /workspace/development/frappe-bench/env/bin/python -I -c \""
                 "import openpyxl; wb=openpyxl.Workbook(); ws=wb.active; ws.title='Walk Sheet'; "
                 "ws.append(['Sl','Description','Unit','Qty']); ws.append([1,'Walk test duct','sqm',10]); "
                 "wb.save('/tmp/bgops_walk.xlsx')\"")
    path = out / "bgops_walk.xlsx"
    subprocess.run(["docker", "cp", "frappe_docker_devcontainer-frappe-1:/tmp/bgops_walk.xlsx", str(path)], check=True)
    return path


def upload_failure_path(pages, out, kind, failed_text, upload):
    """Upload in each tab with no worker: queued, no early timer note; then a worker: each tab its own failure."""
    workbook = made_up_workbook(out)
    opss = [follow_ops(p) for p in pages]
    for p in pages:
        upload(p, workbook)
    for i, p in enumerate(pages):
        check(wait_until(lambda p=p: p.get_by_text(QUEUED).count() > 0, 30, page=p),
              f"tab {i}: shows '{QUEUED}' while no worker runs")
    pages[0].wait_for_timeout(35_000)
    for i, p in enumerate(pages):
        check(p.get_by_text(re.compile("taking a little longer", re.I)).count() == 0,
              f"tab {i}: no 'taking a little longer' note after 35 s in the queue")
        save(p, out, f"02-tab-{i}-queued-35s")
    with long_workers(a.task, 1):
        for i, p in enumerate(pages):
            check(wait_until(lambda p=p: p.get_by_text(failed_text).count() > 0, 300, page=p),
                  f"tab {i}: shows '{failed_text}'")
    for i, p in enumerate(pages):
        save(p, out, f"03-tab-{i}-ended")
    ids = [ops[-1] for ops in opss if ops]
    check(len(ids) == len(pages) and len(set(ids)) == len(ids), "each tab followed its own operation")
    found = records(ids, out)
    for i, op_id in enumerate(ids):
        r = found[op_id]
        check(r is not None and r["owner"] == a.user and r["kind"] == kind and r["state"] == "failed",
              f"tab {i}: its record is {a.user}'s {kind}, failed (it is {r and (r['owner'], r['kind'], r['state'])})")
        if r and r.get("error"):
            check(pages[i].get_by_text(r["error"]).count() > 0, f"tab {i}: shows its own record's error")


def part_boq(page, out):
    sidebar(page, "Upload BoQ")
    page.get_by_role("combobox").first.click()
    page.get_by_role("option").first.click()
    page.get_by_role("button", name="Continue").click()
    page.locator("input[type=file]").first.wait_for(state="attached")
    save(page, out, "01-upload-screen")
    page_b = page.context.new_page()
    page_b.goto(page.url)
    page_b.locator("input[type=file]").first.wait_for(state="attached")
    upload_failure_path([page, page_b], out, "boq_upload", "Upload failed",
                        lambda p, wb: p.locator("input[type=file]").first.set_input_files(str(wb)))


def part_template(page, out):
    sidebar(page, "Admin Options")
    page.get_by_text("BoQ Templates", exact=True).click()
    page.wait_for_timeout(3000)
    save(page, out, "01-templates")

    def upload(p, wb):
        p.get_by_role("button", name=re.compile("Seed the master template|Re-seed", re.I)).first.click()
        p.get_by_role("alertdialog").get_by_role("button", name="Continue").click()
        with p.expect_file_chooser() as fc:
            p.get_by_role("dialog").get_by_role("button", name=re.compile("Drop a .xlsx")).click()
        fc.value.set_files(str(wb))

    upload_failure_path([page], out, "boq_template_seed", "Seeding failed", upload)


PARTS = {"tds": part_tds, "handover": part_handover, "commission": part_commission, "bulk": part_bulk,
         "boq": part_boq, "template": part_template}

with session(a.task, a.user, a.password) as (page, out):
    PARTS[a.part](page, out)
    print(f"evidence: {out}")
    if misses:
        raise SystemExit(f"{len(misses)} miss(es): " + "; ".join(misses))
