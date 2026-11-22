#!/usr/bin/env python3
"""Walk the screens that follow a background operation (spec #1654, tickets #1662-#1669), as each screen's role.

    python3 .claude/skills/verify/bin/walk_background_operation_screens.py --task <task> --part <part> \
        --user <email> --password <pw> [--project <id> --project-name <name>] \
        [--project2 <id> --project2-name <name>] [--other-user <email> --other-password <pw>] \
        [--sheet '<BoQ title>::<sheet>' ...]

The N-worker check (N workers, the flows at N-way overlap, no browser) is `walk_background_operations.py`.

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
- `clone`      Create a BoQ from the master template (Upload BoQ -> a project -> Create from Template -> Create BoQ):
               "Waiting in the queue..." with no worker, then "Building your BoQ...", then the BoQ's hub (#1669).
               An Estimates Executive; the env needs its active master BoQ Template. No project argument.
- `snag`       Snag List tab -> Download -> the dialog's Download: the toast says "Waiting for the server to start on
               it..." with no worker, then the file saves (#1669). A Project Manager on a project with snags.
               `--other-user` (any other user) must be refused the operation's status and its file.
- `commission-second`  A commission bulk download left queued, then a second one from `--project2`'s Commission
               Report tab in a second browser tab: refused with a toast naming the first (#1664). Then a worker
               finishes the first. A Project Manager on both projects, each with Submitted Field reports.
- `binder-second`  A handover binder left queued, then a second one in a second browser tab: refused with a toast
               naming the first (#1663). Then a worker finishes the first. The `handover` part's user and project.
- `document-beside-binder`  A handover binder left queued, then one document's row Download in the same tab: open,
               not refused, its own `hod_document` operation queues, and both end in their own files (#1671). The
               `handover` part's user and project; `--document` (default commissioning_report) is set Done with its
               first record selected first (`bgops_hod_document.py`, env DB only).

- `classify`   A committed sheet's pricing page -> Classify sheet -> both engines: one boq_classify operation per
               engine, queued with no worker, then a summary naming both engines' outcome. One --sheet.
- `suggest`    Suggest rates on two sheets (two BoQs) at once in two tabs, on one worker: each tab its own
               boq_rate_suggest and its own sheet's run; each match (boq_rate_match) queued, then its outcome.
- `hub`        The BoQ hub -> a sheet's Re-parse: "Waiting in the queue...", then the parse's end dialog says what
               its own record says (complete, or failed in the server's words) and the BoQ is freed. One --sheet.
               The re-parse is real: on an env that can read the workbook it rebuilds the sheet's rows (env DB).
- `review`     That sheet's review screen opened while the hub's re-parse waits: the "being parsed" banner, cleared
               when the parse ends. One --sheet.
               The four BoQ parts walk as an Estimates Executive and switch the BoQ AI setting off for the walk
               (`bgops_boq_state.py`), as the N-worker flows do. With it off a parse starts no AI check, so the
               check (hub chip, review screen) is printed as NOT WALKED with the reason.

`bulk` also asserts the window's "You can leave this page" note (and no "Keep this page open"), and that leaving the
page and coming back in the same tab picks the download up again (#1664).

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
ap.add_argument("--part", required=True, choices=["tds", "handover", "commission", "bulk", "boq", "template", "clone",
                                                  "snag", "commission-second", "binder-second",
                                                  "document-beside-binder",
                                                  "classify", "suggest", "hub", "review"])
ap.add_argument("--user", required=True)
ap.add_argument("--password", required=True)
ap.add_argument("--project", help="the project id (tds, handover, commission, bulk)")
ap.add_argument("--project-name", help="the project's name, as the Projects list searches it")
ap.add_argument("--project2", help="commission-second: the second project's id")
ap.add_argument("--project2-name", help="commission-second: the second project's name")
ap.add_argument("--other-user", help="snag: a different user, who must be refused the operation")
ap.add_argument("--other-password")
ap.add_argument("--hod-system", default="HVAC",
                help="binder-second, document-beside-binder: the system whose binder the card builds")
ap.add_argument("--document", default="commissioning_report",
                help="document-beside-binder: the from-app document whose row Download runs beside the binder")
ap.add_argument("--sheet", action="append", default=[], metavar="BOQ TITLE::SHEET",
                help="a BoQ of the project (its title, as its BOQs tab lists it) and one of its sheets, verbatim "
                     "(classify, hub, review: one; suggest: two, on two BoQs)")
a = ap.parse_args()
PROJECT_PARTS = ("tds", "handover", "commission", "bulk", "snag", "commission-second", "binder-second",
                 "document-beside-binder",
                 "classify", "suggest", "hub", "review")
if a.part in PROJECT_PARTS and not (a.project and a.project_name):
    ap.error(f"--part {a.part} needs --project and --project-name")
if a.part == "commission-second" and not (a.project2 and a.project2_name):
    ap.error("--part commission-second needs --project2 and --project2-name")
if a.part == "snag" and not (a.other_user and a.other_password):
    ap.error("--part snag needs --other-user and --other-password")
SHEETS_NEEDED = {"classify": 1, "suggest": 2, "hub": 1, "review": 1}
if a.part in SHEETS_NEEDED and (len(a.sheet) != SHEETS_NEEDED[a.part] or not all("::" in x for x in a.sheet)):
    ap.error(f"--part {a.part} needs {SHEETS_NEEDED[a.part]} --sheet 'BoQ title::sheet name'")
SHEETS = [tuple(x.split("::", 1)) for x in a.sheet]

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


def env_script(name, *args, out=None):
    """Run a `bin/` script in the env (`devenv.sh script`) and return what it printed after `BGOPS `; with `out`,
    also append it to `db.txt` there."""
    run = subprocess.run([DEVENV, "script", a.task, os.path.join(HERE, name), *args],
                         cwd=APP, capture_output=True, text=True)
    line = next((ln for ln in run.stdout.splitlines() if ln.startswith("BGOPS ")), None)
    if not line:
        sys.exit(f"{name} printed nothing:\n{run.stdout}\n{run.stderr}")
    found = json.loads(line[len("BGOPS "):])
    if out is not None:
        with open(out / "db.txt", "a") as f:
            f.write(f"# {name} {' '.join(args)}\n" + json.dumps(found, indent=1, default=str) + "\n")
    return found


def records(op_ids, out):
    return env_script("bgops_db.py", *op_ids, out=out)


def collect_downloads(page, into):
    page.on("download", lambda d: into.append(d))


def wait_until(predicate, timeout_s, step_ms=2000, page=None):
    end = time.time() + timeout_s
    while time.time() < end:
        if predicate():
            return True
        (page.wait_for_timeout(step_ms) if page else time.sleep(step_ms / 1000))
    return predicate()


def start_ops(page):
    """The operation ids this tab's start requests carry (a refused start never polls, so follow_ops misses it)."""
    ops = []

    def on_request(request):
        if request.method == "POST" and ".start_" in request.url:
            m = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", request.post_data or "")
            if m and m.group(0) not in ops:
                ops.append(m.group(0))

    page.on("request", on_request)
    return ops


def open_project(page, tab, project=None, project_name=None):
    """Sidebar Projects -> search the project's name (Won Projects, else Tendering Projects) -> its link -> a tab of
    the project page."""
    project, project_name = project or a.project, project_name or a.project_name
    sidebar(page, "Projects")
    link = page.get_by_role("link", name=project_name, exact=True).first
    page.get_by_placeholder(re.compile("Search", re.I)).first.fill(project_name)
    if not wait_until(lambda: link.count() > 0, 8, step_ms=500, page=page):
        page.get_by_role("tab", name=re.compile(r"^Tendering Projects \d+$")).click()
        page.get_by_placeholder(re.compile("Search", re.I)).first.fill(project_name)
    link.click()
    page.wait_for_url(re.compile(re.escape(project)))
    # The project page's tab, never the sidebar entry of the same name ("Snag List"), which is there first.
    page.get_by_role("button", name=tab, exact=True).and_(
        page.locator(':not([data-sidebar="menu-button"])')).click()
    page.wait_for_timeout(3000)


POLL_S = 3  # with no socket the hook reads the status about every 3 s


def check_running(seen, record, text):
    """The running state shows only if a status read lands while the work runs: work that runs under about two
    reads (a small clone, one batch's snag PDF) can go from queued to finished on screen. Then say so, not MISS."""
    ran = record and record.get("started_at") and record.get("ended_at") and record["ended_at"] - record["started_at"]
    if seen or not ran or ran >= 2 * POLL_S:
        check(seen, f"shows '{text}' once a worker runs it")
    else:
        print(f"note '{text}' not on screen: the work ran {ran:.1f} s, under two status reads", flush=True)


def check_record(tab, record, kind, state="finished"):
    check(record is not None, f"{tab}: the status record exists")
    if not record:
        return False
    check(record["owner"] == a.user, f"{tab}: the record's owner is {a.user} (it is {record['owner']})")
    check(record["kind"] == kind, f"{tab}: the record's kind is {kind} (it is {record['kind']})")
    check(record["state"] == state, f"{tab}: the record reads {state} (it reads {record['state']})")
    return True


def check_file(tab, record, download, out, kind):
    if not check_record(tab, record, kind):
        return
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


QUEUED_ANY = re.compile("Waiting in the queue|Waiting for the server to start|Queued")


def one_download(page, out, kind, start, timeout_s=600, while_queued=None, running_text=None):
    """Start one download with no worker, show it queued, run `while_queued(page)`, then let a worker finish it
    (seeing `running_text` on the screen on the way, when given). Returns the record (None when none followed)."""
    ops, dls = follow_ops(page), []
    collect_downloads(page, dls)
    start(page)
    check(wait_until(lambda: page.get_by_text(QUEUED_ANY).count() > 0, 30, page=page),
          "shows the operation queued while no worker runs")
    save(page, out, "02-queued")
    if while_queued:
        while_queued(page)
    seen_running = []

    def done():
        if running_text and not seen_running and page.get_by_text(running_text).count():
            seen_running.append(True)
            save(page, out, "02d-running")
        return bool(dls)

    with long_workers(a.task, 1):
        wait_until(done, timeout_s, step_ms=500, page=page)
    save(page, out, "03-done")
    check(bool(ops), "the screen followed an operation")
    if while_queued:
        check(len(ops) == 1, f"the screen followed one operation throughout, after coming back too ({len(ops)} followed)")
    if not ops:
        return None
    record = records([ops[-1]], out)[ops[-1]]
    if running_text:
        # Unescape the dots only, so `\d+` still reads as a number.
        check_running(bool(seen_running), record, running_text.pattern.replace("\\.", "."))
    check_file("download", record, dls[0] if dls else None, out, kind)
    return record


def part_commission(page, out):
    open_project(page, "Commission Report")
    save(page, out, "01-commission-tab")

    def start(p):
        p.get_by_role("button", name="Bulk Approved Reports").click()
        d = p.get_by_role("dialog")
        d.get_by_text(re.compile(r"^Select all")).click()
        d.get_by_role("button", name="Export").click()

    one_download(page, out, "commission_bulk_download", start)


LEAVE_NOTE = "You can leave this page. The download carries on and picks up again when you come back."


def part_bulk(page, out):
    open_project(page, "Bulk Download")
    save(page, out, "01-bulk-tab")
    tab_url = page.url

    def start(p):
        p.get_by_role("button", name=re.compile("Delivery Challans")).click()
        p.wait_for_timeout(3000)
        rows = p.get_by_role("row").filter(has=p.get_by_role("checkbox"))
        for i in (1, 2):
            rows.nth(i).get_by_role("checkbox").click(force=True)
        p.get_by_role("button", name=re.compile(r"^Download 2 ")).first.click()

    def leave_and_return(p):
        check(p.get_by_text(LEAVE_NOTE).count() > 0, f"the working window says '{LEAVE_NOTE}'")
        check(p.get_by_text("Keep this page open").count() == 0, "the window no longer says 'Keep this page open'")
        p.goto(tab_url.split("/projects/")[0] + "/")  # leave: the app's home page, in the same browser tab
        p.wait_for_load_state("networkidle")
        check(p.get_by_text(LEAVE_NOTE).count() == 0, "the window is gone once the user has left the page")
        save(p, out, "02b-left")
        p.go_back()  # come back, as the browser's Back button does
        check(wait_until(lambda: p.get_by_text(QUEUED_ANY).count() > 0 and p.get_by_text(LEAVE_NOTE).count() > 0,
                         30, page=p),
              "back on the page, the window picks the same download up again (still queued, the note shown)")
        save(p, out, "02c-back")

    one_download(page, out, "bulk_pdf_download", start, while_queued=leave_and_return)


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

# ── The BoQ pricing, hub and review screens (#1666, #1667, #1668) ───────────────────────────────────────────────────
NOT_WALKED = []


def not_walked(what, why):
    print(f"NOT WALKED {what}: {why}", flush=True)
    NOT_WALKED.append(what)


class AiOff:
    """The BoQ AI setting switched off for the walk, and put back as it was (also on Ctrl-C): the env holds a real AI
    key, and no walk calls a provider. Classify then writes rule categories (all flagged for review), a suggest
    writes blank attributes, and a match asks no model."""

    def __enter__(self):
        self.before = env_script("bgops_boq_state.py", "ai-off")["before"]
        print(f"BoQ AI setting switched off (it was {self.before})", flush=True)

    def __exit__(self, *exc):
        env_script("bgops_boq_state.py", "ai-set", str(int(self.before or 0)))
        print(f"BoQ AI setting put back to {self.before}", flush=True)


def open_hub(page, boq_title):
    """Projects -> the project -> its BOQs tab -> the BoQ's row: the BoQ hub (a pre-Won project's row click opens the
    hub; a Won project's list opens it with the row's Edit icon)."""
    open_project(page, "BOQs")
    row = page.get_by_role("row", name=re.compile(re.escape(boq_title))).first
    edit = row.get_by_role("button", name=re.compile("edit", re.I))
    (edit.first if edit.count() else row).click()
    page.wait_for_url(re.compile(r"/upload-boq/hub/[^/]+$"))
    page.get_by_role("button", name="Tendering", exact=True).wait_for()
    page.wait_for_timeout(2000)
    return page.url.rsplit("/", 1)[-1]


def open_pricing(page, boq_title, sheet):
    """The BoQ's hub -> Tendering (the first committed sheet's pricing page) -> the sheet's tab."""
    boq = open_hub(page, boq_title)
    page.get_by_role("button", name="Tendering", exact=True).click()
    page.wait_for_url(re.compile("/pricing/"))
    tab = page.get_by_role("tab", name=sheet.strip(), exact=True)
    tab.wait_for()
    if tab.get_attribute("aria-selected") != "true":
        tab.click()
    page.wait_for_url(re.compile(re.escape("/pricing/") + ".*"))
    page.get_by_role("button", name="Classify sheet").wait_for()
    page.wait_for_timeout(3000)
    return boq


def sheet_container(page, sheet, button):
    """A block on the hub that names the sheet and holds exactly one `button` (its card, or its review-list row)."""
    blocks = page.locator("div").filter(has=page.get_by_text(sheet.strip(), exact=True)).filter(
        has=page.get_by_role("button", name=button, exact=True))
    own = [b for b in blocks.all() if b.get_by_role("button", name=button, exact=True).count() == 1]
    if not own:
        raise SystemExit(f"no block on the hub names {sheet!r} with one {button!r} button")
    return own[-1]


def part_classify(page, out):
    """A Classify click on a committed sheet with both engines: one boq_classify operation per engine, each queued
    with no worker, then each engine's outcome in the summary (#1666)."""
    boq_title, sheet = SHEETS[0]
    with AiOff():
        boq = open_pricing(page, boq_title, sheet)
        save(page, out, "01-pricing-page")
        ops = follow_ops(page)
        page.get_by_role("button", name="Classify sheet").click()
        d = page.get_by_role("dialog")
        for engine in ("Electrical", "HVAC"):
            box = d.get_by_role("checkbox", name=f"Classify with {engine}")
            if box.get_attribute("aria-checked") != "true":
                box.click()
        save(page, out, "01b-classify-dialog")
        d.get_by_role("button", name="Classify 2 engines").click()
        check(wait_until(lambda: page.get_by_text(QUEUED).count() > 0, 30, page=page),
              f"the modal shows '{QUEUED}' while no worker runs")
        wait_until(lambda: len(ops) >= 2, 15, page=page)
        save(page, out, "02-classify-queued")
        done = re.compile("Classification complete|Classification failed")
        with long_workers(a.task, 2):
            check(wait_until(lambda: page.get_by_text(done).count() > 0, 600, page=page),
                  "the modal ends (complete or failed)")
        save(page, out, "03-classify-ended")
        found = records(ops, out)
        mine = {op: r for op, r in found.items() if r and r["kind"] == "boq_classify"}
        check(len(mine) == 2, f"the click started two boq_classify operations (found {len(mine)})")
        engines = sorted((r.get("result") or {}).get("discipline") or "" for r in mine.values())
        check(engines == ["Electrical", "HVAC"], f"one operation per engine (results name {engines})")
        for op, r in mine.items():
            eng = (r.get("result") or {}).get("discipline") or op
            check(r["owner"] == a.user, f"{eng}: the record's owner is {a.user} (it is {r['owner']})")
            check(r["state"] == "finished" and (r.get("result") or {}).get("sheet_name") == sheet
                  and (r.get("result") or {}).get("boq_name") == boq,
                  f"{eng}: the record reads finished for {boq} {sheet!r} (it reads {r['state']})")
        text = page.locator("body").inner_text()
        check("Classification complete" in text, "the modal says Classification complete")
        check(re.search(r"\d+ of \d+ classified", text) is not None, "the summary gives the classified count")
        check("AI voter was OFF for Electrical and HVAC" in text,
              "the summary names both engines' outcome (AI voter OFF for Electrical and HVAC)")
        page.get_by_role("button", name="Done").click()
        page.wait_for_timeout(1500)
        save(page, out, "04-classify-strip")
        check(re.search(r"\d+ of \d+ classified", page.locator("body").inner_text()) is not None,
              "after closing, the strip keeps the run's summary")


def start_suggest(p):
    p.get_by_role("button", name="Suggest rates").click()
    d = p.get_by_role("alertdialog")
    d.get_by_role("button", name=re.compile(r"^(Run all|Re-extract all) \d+ rows$")).click()


def part_suggest(page, out):
    """Two sheets suggested at once in two tabs, on one worker: each tab follows its own boq_rate_suggest operation
    and shows its own sheet's run; each suggest's match (boq_rate_match) waits in the queue behind the other
    suggest and a sleep RQ job, then ends (#1667)."""
    with AiOff():
        page_b = page.context.new_page()
        page_b.goto(page.url)
        tabs = [(page, *SHEETS[0]), (page_b, *SHEETS[1])]
        boqs, opss = [], []
        for i, (p, boq_title, sheet) in enumerate(tabs):
            boqs.append(open_pricing(p, boq_title, sheet))
            save(p, out, f"01-tab-{i}-pricing")
            opss.append(follow_ops(p))
        for p, *_ in tabs:
            start_suggest(p)
        # Both suggests are queued (each in its request's commit). A 20 s sleep RQ job queued behind them keeps the
        # first suggest's match waiting in the queue long enough for the screen's ~3 s poll to show it; without it
        # a suggest with the AI off takes about 1.5 s, and the match waits only that long.
        for p, *_ in tabs:
            wait_until(lambda p=p: p.get_by_test_id("suggest-queued").count() > 0, 30, page=p)
        env_script("bgops_boq_state.py", "hold-queue", "20")
        for i, (p, *_rest) in enumerate(tabs):
            check(wait_until(lambda p=p: p.get_by_test_id("suggest-queued").count() > 0, 30, page=p),
                  f"tab {i}: the modal shows '{QUEUED}' while no worker runs")
            save(p, out, f"02-tab-{i}-queued")
        match_queued = [False, False]

        def ended(i, p):
            if p.get_by_test_id("match-queued").count() > 0:
                match_queued[i] = True
            return (p.get_by_test_id("match-done").count() + p.get_by_test_id("match-failed").count()
                    + p.get_by_text("Suggestion run failed").count()) > 0

        with long_workers(a.task, 1):
            ends = [False, False]

            def both_ended():
                for i, (p, *_rest) in enumerate(tabs):
                    ends[i] = ends[i] or ended(i, p)
                return all(ends)

            wait_until(both_ended, 900, step_ms=1000, page=page)
            for i in (0, 1):
                check(ends[i], f"tab {i}: the suggest and its match end")
        for i, (p, *_rest) in enumerate(tabs):
            save(p, out, f"03-tab-{i}-ended")
        for i in (0, 1):
            check(match_queued[i], f"tab {i}: showed its match 'waiting in the queue' before it ran")
        found = records([op for ops in opss for op in ops], out)
        suggests = []
        for i, (p, boq_title, sheet) in enumerate(tabs):
            mine = [op for op in opss[i] if found.get(op) and found[op]["kind"] == "boq_rate_suggest"]
            check(len(mine) == 1, f"tab {i}: followed one boq_rate_suggest operation (found {len(mine)})")
            if not mine:
                suggests.append(None)
                continue
            r = found[mine[0]]
            suggests.append(mine[0])
            res = r.get("result") or {}
            check(r["owner"] == a.user, f"tab {i}: the suggest's owner is {a.user} (it is {r['owner']})")
            check(r["state"] == "finished" and res.get("status") == "success",
                  f"tab {i}: the suggest finished with success (it reads {r['state']} {res.get('status')})")
            check((res.get("boq"), res.get("sheet_name")) == (boqs[i], sheet),
                  f"tab {i}: the suggest's result is its own sheet's ({res.get('boq')} {res.get('sheet_name')!r})")
            check(p.get_by_text("Suggestions ready").count() > 0, f"tab {i}: the modal says Suggestions ready")
            match = res.get("match")
            if match is None:
                not_walked(f"tab {i} match", "the match switch is off on this env")
                continue
            m = found.get(match.get("op_id")) if match.get("op_id") in found else \
                records([match["op_id"]], out)[match["op_id"]]
            check(match.get("op_id") in opss[i], f"tab {i}: the tab followed the match operation its suggest names")
            check(m is not None and m["kind"] == "boq_rate_match" and m["owner"] == a.user and m["state"] == "finished"
                  and (m.get("result") or {}).get("run") == match.get("run"),
                  f"tab {i}: its match record is {a.user}'s boq_rate_match, finished, for run {match.get('run')} "
                  f"(it is {m and (m['owner'], m['kind'], m['state'], (m.get('result') or {}).get('run'))})")
            shown = "match-done" if (m and (m.get("result") or {}).get("run_status") == "complete") else "match-failed"
            run_status = ((m or {}).get("result") or {}).get("run_status")
            check(p.get_by_test_id(shown).count() > 0, f"tab {i}: shows its match's outcome ({shown}, {run_status})")
        check(None not in suggests and len(set(suggests)) == 2, "the two tabs followed two different suggests")


def start_reparse(page, sheet):
    """The sheet's card -> Re-parse Sheet -> Re-parse 1 sheet -> (the discard warning) Re-parse anyway."""
    sheet_container(page, sheet, "Re-parse Sheet").get_by_role("button", name="Re-parse Sheet").click()
    d = page.get_by_role("dialog")
    d.get_by_role("button", name="Re-parse 1 sheet").click()
    anyway = page.get_by_role("dialog").get_by_role("button", name="Re-parse anyway")
    if wait_until(lambda: anyway.count() > 0, 5, step_ms=500, page=page):
        anyway.click()


PARSE_ENDED = re.compile("^(Parse complete|Parse error)$")


def hub_button(page, text):
    """A hub footer button by its words. While the parse dialog is open the hub sits under a modal (aria-hidden),
    so this matches the element and its text, not its accessible role."""
    return page.locator("button").filter(has_text=re.compile(f"^{re.escape(text)}$"))


def check_parse_ended(page, ops, boq, sheet, out, tab="hub"):
    """The parse's end dialog says what its own record says: Parse complete for a finished parse that names the
    sheet, Parse error with the record's words for a failed one. Then the BoQ's and the sheet's flags are released."""
    found = records(ops, out)
    mine = [op for op in ops if found.get(op) and found[op]["kind"] == "boq_parse"]
    check(len(mine) == 1, f"{tab}: followed one boq_parse operation (found {len(mine)})")
    if not mine:
        return
    r = found[mine[0]]
    res = r.get("result") or {}
    check(r["owner"] == a.user, f"{tab}: its record's owner is {a.user} (it is {r['owner']})")
    dialog = page.get_by_role("alertdialog")
    if r["state"] == "finished":
        parsed = res.get("parsed_sheets") or []
        check(res.get("status") == "success" and sheet in parsed and res.get("boq_name") == boq,
              f"{tab}: its record finished with {sheet!r} of {boq} parsed ({res.get('status')}, {parsed})")
        check(dialog.get_by_text("Parse complete", exact=True).count() > 0, f"{tab}: shows Parse complete")
    else:
        err = (r.get("error") or "").strip()
        check(r["state"] == "failed" and bool(err), f"{tab}: its record failed with words ({r['state']}: {err[:70]!r})")
        check(dialog.get_by_text("Parse error", exact=True).count() > 0 and dialog.get_by_text(err[:60]).count() > 0,
              f"{tab}: shows Parse error in its record's words")
    flags = env_script("bgops_boq_state.py", "parse-flags", boq, sheet, out=out)
    check(not int((flags["boq"] or {}).get("parse_in_progress") or 0)
          and not (flags.get("sheet") or {}).get("parse_in_progress"),
          f"the BoQ's and the sheet's parse flags are released ({flags})")
    return r


def wait_parse_end(page, timeout_s=300):
    return wait_until(lambda: page.get_by_role("alertdialog").get_by_role("heading", name=PARSE_ENDED).count() > 0,
                      timeout_s, page=page)


def part_hub(page, out):
    """Hub -> a sheet's Re-parse -> confirm, with no worker: "Waiting in the queue..."; then a worker: the parse ends
    (complete, or failed where the env cannot read the workbook), the hub's wait ends in its own outcome and the
    parse buttons come back (#1668). The re-parse dialog stays open while the parse waits: its button must not say
    the parse runs."""
    boq_title, sheet = SHEETS[0]
    with AiOff():
        boq = open_hub(page, boq_title)
        save(page, out, "01-hub")
        ops = follow_ops(page)
        start_reparse(page, sheet)
        queued = hub_button(page, "Waiting in the queue...")
        check(wait_until(lambda: queued.count() > 0, 30, page=page),
              "the hub's Parse button reads 'Waiting in the queue...' while no worker runs")
        check(queued.count() > 0 and queued.first.is_disabled() and hub_button(page, "Re-parse").first.is_disabled(),
              "Parse and Re-parse are disabled while the parse waits")
        confirm = page.get_by_role("dialog").get_by_role("button", name=re.compile("Parsing|Waiting in the queue"))
        if confirm.count():
            check("Parsing" not in confirm.first.inner_text(),
                  f"the open re-parse dialog says the parse waits, not that it runs (its button reads "
                  f"{confirm.first.inner_text().strip()!r})")
        save(page, out, "02-hub-queued")
        with long_workers(a.task, 1):
            check(wait_parse_end(page), "the hub's wait ends (Parse complete or Parse error)")
        save(page, out, "03-hub-parse-ended")
        r = check_parse_ended(page, ops, boq, sheet, out)
        page.get_by_role("alertdialog").get_by_role("button", name="OK").click()
        page.wait_for_timeout(1500)
        check(hub_button(page, "Re-parse").first.is_enabled(), "Re-parse is enabled again")
        check(hub_button(page, "Waiting in the queue...").count() == 0 and hub_button(page, "Parsing...").count() == 0,
              "the Parse button no longer waits")
        save(page, out, "04-hub-after")
        checks = ((r or {}).get("result") or {}).get("checks")
        not_walked("hub: the per-sheet AI check chip ('Waiting to check rows…' / 'Checking rows…')",
                   f"the parse started no check (its result's checks: {checks}): the check runs only with the BoQ AI "
                   "setting on, which calls a real AI provider, so the walk keeps it off")


def part_review(page, out):
    """The review screen of a sheet while its re-parse waits (started from the hub in another tab): the "being
    parsed" banner shows, and clears when the parse ends (#1668). The re-parse rebuilds the sheet's rows on the env."""
    boq_title, sheet = SHEETS[0]
    banner = "This sheet is being parsed"
    with AiOff():
        boq = open_hub(page, boq_title)
        page_b = page.context.new_page()
        page_b.goto(page.url)
        page_b.get_by_role("button", name="Tendering", exact=True).wait_for()
        sheet_container(page_b, sheet, "Review").get_by_role("button", name="Review", exact=True).click()
        page_b.wait_for_url(re.compile("/review/"))
        page_b.wait_for_timeout(3000)
        save(page_b, out, "01-review")
        check(page_b.get_by_text(banner).count() == 0, "the review screen loads with no parse banner")
        ops = follow_ops(page)
        start_reparse(page, sheet)
        check(wait_until(lambda: hub_button(page, "Waiting in the queue...").count() > 0, 30, page=page),
              "the hub's parse waits in the queue")
        # A dev env serves no realtime, so the review tab learns of a parse started elsewhere when it is opened
        # again (as a user opening it now would): reload it.
        page_b.reload()
        check(wait_until(lambda: page_b.get_by_text(banner).count() > 0, 60, page=page_b),
              "the review screen, opened while the parse waits, shows the 'being parsed' banner (read-only)")
        save(page_b, out, "02-review-parsing")
        with long_workers(a.task, 1):
            check(wait_parse_end(page), "the hub's parse ends")
            check(wait_until(lambda: page_b.get_by_text(banner).count() == 0, 120, page=page_b),
                  "the review screen's banner clears when the parse ends")
        save(page_b, out, "03-review-after")
        check_parse_ended(page, ops, boq, sheet, out)
        not_walked("review: the AI check chip ('Waiting to check rows…' while queued) and get_check_operation",
                   "a parse starts no check while the BoQ AI setting is off, and on it would call a real AI provider")



def part_clone(page, out):
    sidebar(page, "Upload BoQ")
    page.get_by_role("combobox").first.click()
    page.get_by_role("option").first.click()
    page.get_by_role("button", name="Continue").click()
    page.get_by_role("button", name="Create from Template").click()
    create = page.get_by_role("button", name="Create BoQ")
    create.wait_for()
    save(page, out, "01-template-picker")
    ops = follow_ops(page)
    create.click()
    check(wait_until(lambda: page.get_by_text("Waiting in the queue…").count() > 0, 30, page=page),
          "shows 'Waiting in the queue…' while no worker runs")
    save(page, out, "02-queued")
    seen_building = []
    with long_workers(a.task, 1):
        def building_or_hub():
            if page.get_by_text("Building your BoQ…").count() and not seen_building:
                seen_building.append(True)
                save(page, out, "03-building")
            return "/upload-boq/hub/" in page.url
        hub = wait_until(building_or_hub, 600, step_ms=500, page=page)
    check(hub, f"the BoQ's hub opens ({page.url})")
    page.wait_for_timeout(3000)
    save(page, out, "04-hub")
    check(bool(ops), "the screen followed an operation")
    if ops:
        record = records([ops[-1]], out)[ops[-1]]
        check_running(bool(seen_building), record, "Building your BoQ…")
        if check_record("clone", record, "boq_template_clone"):
            boq = (record.get("result") or {}).get("boq_name") or ""
            check(bool(boq) and page.url.rstrip("/").endswith(boq), f"the hub is the record's BoQ ({boq})")


def refused_to(page, other_user, other_password, op_id, out):
    """A different user, logged in in a browser of their own, is refused this operation's status and its file."""
    from drive import base_url, login
    ctx = None
    try:
        ctx = page.context.browser.new_context()
        p = ctx.new_page()
        base = base_url(a.task)
        login(p, base, other_user, other_password)
        for method in ("get_status", "collect_result"):
            r = p.request.get(f"{base}/api/method/nirmaan_stack.api.background_ops.{method}?op_id={op_id}")
            with open(out / "db.txt", "a") as f:
                f.write(f"{other_user} {method}: HTTP {r.status} {r.text()[:300]}\n")
            check(r.status == 403, f"{other_user} is refused {method} of the operation (HTTP {r.status})")
    finally:
        if ctx:
            ctx.close()


def part_snag(page, out):
    open_project(page, "Snag List")
    # Download is hidden on the "All" tab (Download All covers it there): pick the first batch's tab.
    page.get_by_role("tablist", name="Snag batches").get_by_role("tab").nth(1).click()
    page.get_by_role("button", name="Download", exact=True).first.wait_for()
    save(page, out, "01-snag-tab")

    def start(p):
        p.get_by_role("button", name="Download", exact=True).first.click()
        p.get_by_role("dialog").get_by_role("button", name="Download", exact=True).click()

    def toast_queued(p):
        check(p.get_by_text("Waiting for the server to start on it...").count() > 0,
              "the 'Generating PDF...' toast says 'Waiting for the server to start on it...'")

    record = one_download(page, out, "snag_pdf", start, timeout_s=900, while_queued=toast_queued,
                          running_text=re.compile(r"Building the PDF\.\.\.|Built \d+ of \d+ sections"))
    check(wait_until(lambda: page.get_by_text(re.compile("downloaded successfully")).count() > 0, 30, page=page),
          "a Success toast says the snag list was downloaded")
    save(page, out, "04-toast")
    if record:
        refused_to(page, a.other_user, a.other_password, record["op_id"], out)


def second_start_refused(page, out, kind, open_screen, start, refused_text, timeout_s=600):
    """Start one with no worker in this tab, then a second in another browser tab: refused with the first's sentence
    and nothing queued for it. Then a worker finishes the first, which ends in its own file."""
    ops_a, starts_b, dls = follow_ops(page), None, []
    collect_downloads(page, dls)
    open_screen(page, first=True)
    save(page, out, "01-screen")
    start(page)
    check(wait_until(lambda: page.get_by_text(QUEUED_ANY).count() > 0, 30, page=page),
          "the first start shows queued while no worker runs")
    save(page, out, "02-first-queued")
    page_b = page.context.new_page()
    starts_b = start_ops(page_b)
    page_b.goto(page.url.split("?")[0].rsplit("/projects/", 1)[0] + "/")
    open_screen(page_b, first=False)
    start(page_b)
    check(wait_until(lambda: page_b.get_by_text(refused_text).count() > 0, 30, page=page_b),
          f"the second start shows '{refused_text}'")
    save(page_b, out, "03-second-refused")
    with long_workers(a.task, 1):
        wait_until(lambda: dls, timeout_s, page=page)
    save(page, out, "04-first-done")
    check(bool(ops_a) and bool(starts_b), "both starts carried an operation id")
    if not (ops_a and starts_b):
        return
    check(starts_b[-1] != ops_a[-1], "the second start was a different operation")
    found = records([ops_a[-1], starts_b[-1]], out)
    check_file("first", found[ops_a[-1]], dls[0] if dls else None, out, kind)
    second = found[starts_b[-1]]
    check(second is None or (second["state"] == "failed" and not second.get("started_at")),
          f"the second operation never ran (its record: {second and (second['state'], second.get('started_at'))})")


def part_commission_second(page, out):
    def open_screen(p, first):
        if first:
            open_project(p, "Commission Report")
        else:
            open_project(p, "Commission Report", a.project2, a.project2_name)

    def start(p):
        p.get_by_role("button", name="Bulk Approved Reports").click()
        d = p.get_by_role("dialog")
        d.get_by_text(re.compile(r"^Select all")).click()
        d.get_by_role("button", name=re.compile(r"^Export")).click()

    second_start_refused(page, out, "commission_bulk_download", open_screen, start,
                         f"Your commission reports download for {a.project_name} is still being prepared. "
                         "Wait for it to finish, then try again.")


def part_binder_second(page, out):
    def open_screen(p, first):
        open_project(p, "Handover Documents")

    def start(p):
        p.get_by_role("button", name="Download binder").click()
        p.get_by_role("dialog").get_by_role("button", name="Download binder").click()

    second_start_refused(page, out, "hod_binder", open_screen, start,
                         f"Your handover binder for {a.project_name} ({a.hod_system}) is still being prepared. "
                         "Wait for it to finish, then try again.", timeout_s=900)


def part_document_beside_binder(page, out):
    seeded = env_script("bgops_hod_document.py", a.project, a.hod_system, a.document, out=out)
    open_project(page, "Handover Documents")
    save(page, out, "01-handover-tab")
    starts, dls = start_ops(page), []
    collect_downloads(page, dls)
    page.get_by_role("button", name="Download binder").click()
    page.get_by_role("dialog").get_by_role("button", name="Download binder").click()
    check(wait_until(lambda: page.get_by_text(QUEUED).count() > 0, 30, page=page),
          "the binder shows queued while no worker runs")
    check(page.get_by_text("is still being prepared").count() == 0,
          "the binder is not refused (no earlier binder of this user still waits)")
    save(page, out, "02-binder-queued")
    page.keyboard.press("Escape")
    download = page.get_by_role("row", name=re.compile(re.escape(seeded["title"]))).get_by_role(
        "button", name="Download")
    check(download.is_enabled(), f"the {seeded['title']} row's Download is open while the binder waits")
    download.click()
    page.wait_for_timeout(8000)
    check(page.get_by_text("is still being prepared").count() == 0,
          f"the {seeded['title']} download is not refused while the binder waits")
    save(page, out, "03-document-started")
    check(len(starts) == 2, f"the tab started two operations, the binder and the document ({len(starts)} started)")
    if len(starts) < 2:
        return
    binder_op, document_op = starts[0], starts[-1]
    check_record("the document while the binder waits", records([document_op], out)[document_op], "hod_document",
                 state="queued")
    with long_workers(a.task, 2):
        wait_until(lambda: len(dls) >= 2, 900, page=page)
    save(page, out, "04-both-done")
    found = records([binder_op, document_op], out)
    saved = {d.suggested_filename: d for d in dls}
    for name, op, kind in (("binder", binder_op, "hod_binder"), ("document", document_op, "hod_document")):
        made = ((found[op] or {}).get("result") or {}).get("file") or {}
        check_file(name, found[op], saved.get(made.get("filename")), out, kind)


PARTS = {"tds": part_tds, "handover": part_handover, "commission": part_commission, "bulk": part_bulk,
         "boq": part_boq, "template": part_template, "clone": part_clone, "snag": part_snag,
         "commission-second": part_commission_second, "binder-second": part_binder_second,
         "document-beside-binder": part_document_beside_binder,
         "classify": part_classify, "suggest": part_suggest, "hub": part_hub, "review": part_review}

with session(a.task, a.user, a.password) as (page, out):
    PARTS[a.part](page, out)
    print(f"evidence: {out}")
    if NOT_WALKED:
        print(f"{len(NOT_WALKED)} part(s) not walked: " + "; ".join(NOT_WALKED))
    if misses:
        raise SystemExit(f"{len(misses)} miss(es): " + "; ".join(misses))
