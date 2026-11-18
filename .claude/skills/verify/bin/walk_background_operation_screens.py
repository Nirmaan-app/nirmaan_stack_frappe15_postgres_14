#!/usr/bin/env python3
"""Walk the screens that follow a background operation (spec #1654, tickets #1662-#1666, #1667, #1668), as each
screen's role.

    python3 .claude/skills/verify/bin/walk_background_operation_screens.py --task <task> --part <part> \
        --user <email> --password <pw> [--project <id> --project-name <name>] [--sheet '<BoQ title>::<sheet>' ...]

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
ap.add_argument("--part", required=True, choices=["tds", "handover", "commission", "bulk", "boq", "template",
                                                  "classify", "suggest", "hub", "review"])
ap.add_argument("--user", required=True)
ap.add_argument("--password", required=True)
ap.add_argument("--project", help="the project id (tds, handover, commission, bulk)")
ap.add_argument("--project-name", help="the project's name, as the Projects list searches it")
ap.add_argument("--sheet", action="append", default=[], metavar="BOQ TITLE::SHEET",
                help="a BoQ of the project (its title, as its BOQs tab lists it) and one of its sheets, verbatim "
                     "(classify, hub, review: one; suggest: two, on two BoQs)")
a = ap.parse_args()
PROJECT_PARTS = ("tds", "handover", "commission", "bulk", "classify", "suggest", "hub", "review")
if a.part in PROJECT_PARTS and not (a.project and a.project_name):
    ap.error(f"--part {a.part} needs --project and --project-name")
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


def open_project(page, tab):
    """Sidebar Projects -> search the project's name (Won Projects, else Tendering Projects) -> its link -> a tab of
    the project page."""
    sidebar(page, "Projects")
    link = page.get_by_role("link", name=a.project_name, exact=True).first
    page.get_by_placeholder(re.compile("Search", re.I)).first.fill(a.project_name)
    if not wait_until(lambda: link.count() > 0, 8, step_ms=500, page=page):
        page.get_by_role("tab", name=re.compile(r"^Tendering Projects \d+$")).click()
        page.get_by_placeholder(re.compile("Search", re.I)).first.fill(a.project_name)
    link.click()
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
    suggest and a sleep job, then ends (#1667)."""
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
        # Both suggests are queued (each in its request's commit). A 20 s sleep job queued behind them keeps the
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



PARTS = {"tds": part_tds, "handover": part_handover, "commission": part_commission, "bulk": part_bulk,
         "boq": part_boq, "template": part_template, "classify": part_classify, "suggest": part_suggest,
         "hub": part_hub, "review": part_review}

with session(a.task, a.user, a.password) as (page, out):
    PARTS[a.part](page, out)
    print(f"evidence: {out}")
    if NOT_WALKED:
        print(f"{len(NOT_WALKED)} part(s) not walked: " + "; ".join(NOT_WALKED))
    if misses:
        raise SystemExit(f"{len(misses)} miss(es): " + "; ".join(misses))
