#!/usr/bin/env python3
"""Browser walk of Project TDS (Technical Data Sheet) requests: spec #1373, tickets #1374-#1380, and #1384 (case 22).

Seeds a throwaway catalogue and project rows through the backend, drives the running app with a
headless Playwright browser, checks each case against the spec, and always cleans up. See README.md.

    python3 scripts/tds_walk/walk.py                    # every case, no uploads
    python3 scripts/tds_walk/walk.py --case 13,16       # a subset (setup and cleanup still run)
    python3 scripts/tds_walk/walk.py --allow-uploads    # also the cases that upload real PDFs

Uploads land in the production GCS bucket, which never deletes. The default run blocks every upload
request in the browser and fails a case that tries one.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"
CONTAINER = "frappe_docker_devcontainer-frappe-1"
BENCH = "/workspace/development/frappe-bench"
PROJECT = "TestCity-PROJ-00001"
USER, PASSWORD = "playwright@claude.ai", "adminclaude1234"

ITEM_NAME = "TDS WALK Test Valve"  # the seeded TDS Item (Electrical Work, no linked SKUs)
CUSTOM_LAMP = "TDS WALK Custom Lamp"
CUSTOM_FAN = "TDS WALK Custom Fan"
WP, CATEGORY = "Electrical Work", "Lighting"
DRAFTS_KEY = "nirmaan-tds-request-drafts"

NEW_MAKE_LABEL = "Add New Make to an Existing TDS Item"
CUSTOM_LABEL = "Create a Project Specific Custom TDS Item"
NEW_MAKE_HELP = "The item is in the repository but this make has no datasheet yet. Approving adds it to the repository."
CUSTOM_HELP = "Only for this project. It never goes into the TDS Repository."
SWITCH_NOTE_CUSTOM = "This row becomes a Project Custom item for this project only. It never goes into the TDS Repository, even when approved."
SWITCH_NOTE_NEW_MAKE = "This row becomes a New Make. Approving it adds the datasheet to the TDS Repository, under the TDS Item you pick."
CUSTOM_NAME_INPUT = 'input[placeholder="e.g. Facade Linear Light 24W"]'


# ─── backend ─────────────────────────────────────────────────────────────────────────────────────
# Each call runs a fresh Python in the bench container as Administrator. `P` holds the call's params,
# the script fills `R`, and the host gets `R` back as JSON.

PRELUDE = r'''
import os, json
os.chdir("/workspace/development/frappe-bench/sites")
import frappe
frappe.init(site="localhost")
frappe.connect()
P = json.loads(__PARAMS__)
R = {}
PROJECT = P["_project"]
T = P.get("_item")
ROW = "Project TDS Item List"

def fake(key):
    return f"/api/method/frappe_gcp_attachment.controller.generate_file?key={key}&file_name={key}"

def file_record(url, dt, dn, key):
    # A File row that only points at a fake URL. db_insert skips the storage app's hooks, so no
    # bucket call happens; cleanup removes it with frappe.db.delete for the same reason.
    f = frappe.get_doc({"doctype": "File", "file_name": key, "file_url": url, "attached_to_doctype": dt,
        "attached_to_name": dn, "attached_to_field": "tds_attachment", "is_private": 1,
        "content_hash": "tds-walk-fake/" + key})
    f.name = frappe.generate_hash(length=10)
    f.db_insert()
    return f.name

def entry(make, status, key, with_file=False):
    url = fake(key)
    e = frappe.get_doc({"doctype": "TDS Repository", "tds_item": T, "work_package": "Electrical Work",
        "make": make, "status": status, "tds_attachment": url}).insert(ignore_permissions=True)
    out = {"name": e.name, "url": url}
    if with_file:
        out["file"] = file_record(url, "TDS Repository", e.name, key)
    return out

def seed_row(request_id, s):
    kind, make = s["kind"], s["make"]
    key = "tds-walk-fake-%s-%s.pdf" % (request_id.lower(), make.lower().replace(" ", "-"))
    doc = {"doctype": ROW, "tdsi_project_id": PROJECT, "tds_request_id": request_id, "tds_make": make,
        "tds_work_package": s.get("package", "Electrical Work"), "tds_description": s.get("description", "")}
    if kind == "pick":
        url = frappe.db.get_value("TDS Repository", {"tds_item": T, "make": make}, "tds_attachment") or fake(key)
        doc.update(tds_item_id=T, tds_item_name=P["_item_name"], tds_status="Pending", tds_attachment=url)
    elif kind == "new_make":
        doc.update(tds_item_id=T, tds_item_name=P["_item_name"], tds_status="New", tds_attachment=fake(key))
    elif kind == "custom":
        doc.update(tds_item_id=s["pcus"], tds_item_name=s["name"], tds_status="Pending",
            tds_category="Lighting", tds_attachment=fake(key))
    elif kind == "legacy":
        doc.update(tds_item_id="", tds_item_name=s["name"], tds_status="New", tds_attachment=fake(key))
    if s.get("status"):
        doc["tds_status"] = s["status"]
    if s.get("reason"):
        doc["tds_rejection_reason"] = s["reason"]
    if s.get("client_status"):  # the client's answer; only meaningful on an Approved row
        doc.update(client_status=s["client_status"], client_status_by=s.get("client_status_by", "Administrator"),
            client_status_on=s.get("client_status_on", frappe.utils.now()),
            client_rejection_reason=s.get("client_reason", ""))
    d = frappe.get_doc(doc).insert(ignore_permissions=True)
    out = {"name": d.name, "url": d.tds_attachment, "make": make, "kind": kind}
    if s.get("with_file"):
        out["file"] = file_record(d.tds_attachment, ROW, d.name, key)
    return out

def project_rows(since=None):
    filters = {"tdsi_project_id": PROJECT}
    if since:
        filters["creation"] = [">", since]
    return frappe.get_all(ROW, filters=filters, fields=["name", "tds_request_id", "tds_item_id",
        "tds_item_name", "tds_make", "tds_status", "tds_category", "tds_attachment", "tds_description",
        "tds_rejection_reason", "client_status", "client_status_by", "client_status_on",
        "client_rejection_reason"], order_by="creation asc")
'''

EPILOGUE = '''
print("__R__" + json.dumps(R, default=str))
frappe.destroy()
'''


class BackendError(RuntimeError):
    pass


def backend(code: str, **params) -> dict:
    script = PRELUDE.replace("__PARAMS__", repr(json.dumps(params))) + "\n" + code + "\n" + EPILOGUE
    proc = subprocess.run(
        ["docker", "exec", "-i", "-w", BENCH, CONTAINER, "env/bin/python", "-"],
        input=script, capture_output=True, text=True, timeout=300,
    )
    for line in proc.stdout.splitlines():
        if line.startswith("__R__"):
            return json.loads(line[len("__R__"):])
    tail = "\n".join((proc.stdout + proc.stderr).strip().splitlines()[-15:])
    raise BackendError(f"backend script failed (exit {proc.returncode}):\n{tail}")


# ─── results ─────────────────────────────────────────────────────────────────────────────────────

class CaseSkipped(Exception):
    pass


@dataclass
class Checks:
    failures: list = field(default_factory=list)
    passed: int = 0
    notes: list = field(default_factory=list)

    def check(self, cond, label, got=None):
        if cond:
            self.passed += 1
        else:
            self.failures.append(label + ("" if got is None else f" (got: {str(got)[:300]})"))
        print(("    ok   " if cond else "    FAIL ") + label + ("" if cond or got is None else f" -> {str(got)[:300]}"))
        return bool(cond)

    def eq(self, got, want, label):
        return self.check(got == want, f"{label} == {want!r}", got)

    def note(self, text):
        self.notes.append(text)
        print("    note " + text)


@dataclass
class Case:
    n: int
    title: str
    fn: Callable
    uploads_only: bool  # the whole case needs a real browser upload


CASES: dict[int, Case] = {}


def case(n, title, uploads_only=False):
    def deco(fn):
        CASES[n] = Case(n, title, fn, uploads_only)
        return fn
    return deco


# ─── page helpers ────────────────────────────────────────────────────────────────────────────────

def settle(page, s=1.0):
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    time.sleep(s)


def wait_for(fn, timeout=15.0, interval=0.3):
    end = time.time() + timeout
    while True:
        try:
            v = fn()
        except Exception:
            v = None
        if v or time.time() > end:
            return v
        time.sleep(interval)


def toasts(page):
    try:
        return " | ".join(t.replace("\n", " ") for t in page.locator('li[role="status"]').all_inner_texts())
    except Exception:
        return ""


def wait_toast(page, text, timeout=20.0):
    """The toast text once it contains `text` (case-insensitive), else the last toast seen."""
    got = wait_for(lambda: (lambda t: t if text.lower() in t.lower() else None)(toasts(page)), timeout)
    return got or toasts(page)


def dismiss_toasts(page):
    for btn in page.locator('li[role="status"] button').all():
        try:
            btn.click(timeout=1000)
        except Exception:
            pass
    time.sleep(0.5)


def rs_input(page, placeholder, scope=None):
    """The input of the react-select whose placeholder reads `placeholder`."""
    root = scope or page
    ph = root.locator(f'div[id$="-placeholder"]:text-is("{placeholder}")').first
    ph.wait_for(timeout=10000)
    return page.locator("#" + ph.get_attribute("id").replace("-placeholder", "-input"))


def options(page):
    return page.locator('div[id*="-option-"]')


def menu_text(page):
    return " | ".join(options(page).all_inner_texts())


def rs_pick(page, placeholder, text, option_text=None, scope=None, wait=1.2):
    inp = rs_input(page, placeholder, scope)
    inp.click(force=True)
    inp.fill(text)
    time.sleep(wait)
    options(page).filter(has_text=option_text or text).first.click()
    time.sleep(0.5)


def open_new_request(page):
    page.goto(f"{BASE}/projects/{PROJECT}?page=tdsrepository")
    settle(page, 2)
    if page.get_by_text("Continue your saved TDS request?").count():
        page.get_by_role("button", name="Start Fresh").click()
        time.sleep(1)
    page.get_by_role("button", name="Create New Request").click()
    settle(page, 1)


def open_request_dialog(page):
    page.get_by_role("button", name="Request New").click()
    dlg = page.get_by_role("dialog")
    dlg.wait_for(timeout=10000)
    time.sleep(0.8)
    return dlg


def dialog_mode(dlg):
    return [r.inner_text().split("\n")[0] for r in dlg.get_by_role("radio").all() if r.get_attribute("aria-checked") == "true"]


def dialog_make(dlg):
    """The Make the dialog shows: its value, or '' while the placeholder shows."""
    item = dlg.locator("label").filter(has_text=re.compile(r"^Make")).first.locator("xpath=..")
    sv = item.locator('div[class*="singleValue"]')
    return sv.inner_text().strip() if sv.count() else ""


def cart_rows(page):
    return page.locator("table:has(th:text-is('Doc.')) tbody tr")


def add_pick(page, make):
    rs_pick(page, "Search TDS item...", ITEM_NAME)
    rs_pick(page, "Select Make", make)
    page.get_by_role("button", name="Add item").click()
    time.sleep(1)


def pending_table(page):
    return page.locator("div.hidden.md\\:block table").first


def row_by(page, item, make):
    return pending_table(page).locator("tbody tr").filter(has_text=item).filter(
        has=page.locator(f"span:text-is('{make}')"))


def headers_of(table):
    """Header texts, upper-cased: some tables upper-case them in CSS, which inner text reports."""
    return [h.strip().upper() for h in table.locator("thead th").all_inner_texts()]


def column_values(table, row, *headers):
    """The cell text under each header (matched ignoring case), for one row of `table`."""
    names = headers_of(table)
    cells = row.locator("td").all_inner_texts()
    out = []
    for h in headers:
        i = names.index(h.upper()) if h.upper() in names else -1
        out.append(cells[i].strip().replace("\n", " / ") if 0 <= i < len(cells) else None)
    return out


def select_row(page, item, make):
    row_by(page, item, make).first.get_by_role("checkbox").click()
    time.sleep(0.3)


def open_edit(page, item, make):
    row_by(page, item, make).first.locator("td").last.get_by_role("button").click()
    dlg = page.get_by_role("dialog")
    dlg.wait_for(timeout=10000)
    time.sleep(1.2)
    return dlg


def open_approval(page, request_id, status="Pending"):
    page.goto(f"{BASE}/tds-approval/{request_id}?status={status}")
    settle(page, 2)
    wait_for(lambda: pending_table(page).locator("tbody tr").count() > 0 if status != "All" else True, 15)


def chooser(page):
    return page.get_by_role("dialog").filter(has_text="Choose the correct datasheet")


def radio_checked(page, element_id):
    return page.locator(f'[id="{element_id}"]').get_attribute("data-state") == "checked"


# ─── the walk ────────────────────────────────────────────────────────────────────────────────────

class Walk:
    def __init__(self, args):
        self.args = args
        self.out = args.out
        self.allow_uploads = args.allow_uploads
        self.start = None
        self.item = None  # seeded TDS Item name
        self.entries = {}  # make -> {"name", "url"} for the seeded Repository Entries
        self.baseline = None
        self.uploads = []  # upload requests that went through
        self.blocked_uploads = []  # upload requests the default run refused
        self.pdf_seq = 0
        self.seen_names = set()  # every doc name a reset removed, for Version cleanup
        self.ctx = None

    # backend with the walk's constants filled in
    def be(self, code, **params):
        return backend(code, _project=PROJECT, _item=self.item, _item_name=ITEM_NAME, **params)

    # ── setup / reset / cleanup ──
    def snapshot(self):
        return self.be('''
R["rows"] = sorted(frappe.get_all(ROW, filters={"tdsi_project_id": PROJECT}, pluck="name"))
R["tds_items"] = frappe.db.count("TDS Items")
R["tds_repository"] = frappe.db.count("TDS Repository")
R["files"] = frappe.db.count("File")
R["walk_files"] = frappe.db.count("File", {"file_name": ["like", "tds-walk%"]})
R["walk_items"] = frappe.db.count("TDS Items", {"tds_item_name": ["like", "TDS WALK%"]})
R["now"] = str(frappe.utils.now())
''')

    def setup(self):
        snap = self.snapshot()
        if snap["walk_items"] or snap["walk_files"]:
            raise RuntimeError("leftovers from an earlier walk (a 'TDS WALK%' TDS Item or 'tds-walk%' File). "
                               "Clean them up before running again.")
        self.baseline = snap
        self.start = snap["now"]
        res = self.be('''
t = frappe.get_doc({"doctype": "TDS Items", "tds_item_name": P["_item_name"], "work_package": "Electrical Work"}).insert(ignore_permissions=True)
T = t.name
R["item"] = T
R["entries"] = {"Locel": entry("Locel", "Verified", "tds-walk-a.pdf"), "Tapariya": entry("Tapariya", "Not Verified", "tds-walk-b.pdf")}
frappe.db.commit()
''')
        self.item = res["item"]
        self.entries = res["entries"]
        print(f"setup: start={self.start} item={self.item} entries={ {k: v['name'] for k, v in self.entries.items()} }")

    def reset(self, since):
        """Put the test data back to the seeded catalogue: drop project rows created after `since`,
        Repository Entries for the test item other than the two seeded ones, test File records, and
        restore the seeded entries' fields."""
        # Raw deletes and set_value on purpose: these are throwaway walk records with no dependents, and
        # the doc-layer File delete would run the storage app's trash hook against the production bucket.
        # The raw row delete also skips the Client Status lock (`on_trash`, #1387), so rows a case marked
        # still go. Nothing derived reads them, so there is nothing to recompute.
        res = self.be('''
keep = [v["name"] for v in P["entries"].values()]
rows = frappe.get_all(ROW, filters={"tdsi_project_id": PROJECT, "creation": [">", P["since"]]}, pluck="name")
ents = frappe.get_all("TDS Repository", filters={"tds_item": T, "name": ["not in", keep]}, pluck="name") if T else []
files = frappe.get_all("File", filters={"file_name": ["like", "tds-walk%"], "creation": [">", P["start"]]}, pluck="name")
for n in files: frappe.db.delete("File", n)
for n in rows: frappe.db.delete(ROW, n)
for n in ents: frappe.db.delete("TDS Repository", n)
for make, v in P["entries"].items():
    frappe.db.set_value("TDS Repository", v["name"], {"status": "Verified" if make == "Locel" else "Not Verified",
        "tds_attachment": v["url"]}, update_modified=False)
frappe.db.commit()
R = {"rows": rows, "entries": ents, "files": files}
''', since=since, start=self.start, entries=self.entries)
        self.seen_names.update(res["rows"] + res["entries"])
        return res

    def cleanup(self):
        if not self.start:
            return None
        if self.item:
            self.reset(self.start)
        names = sorted(self.seen_names | {v["name"] for v in self.entries.values()} | ({self.item} if self.item else set()))
        return self.be('''
for v in P["entries"].values(): frappe.db.delete("TDS Repository", v["name"])
if T: frappe.db.delete("TDS Items", T)
# Raw deletes (see reset): no hooks, nothing derived.
versions = frappe.get_all("Version", filters={"docname": ["in", P["names"] or ["-"]],
    "ref_doctype": ["in", ["TDS Items", "TDS Repository", ROW]], "creation": [">", P["start"]]}, pluck="name")
deleted = frappe.get_all("Deleted Document", filters={"creation": [">", P["start"]],
    "deleted_doctype": ["in", [ROW, "File", "TDS Repository", "TDS Items"]]}, fields=["name", "deleted_doctype", "data"])
ours = [d.name for d in deleted if PROJECT in (d.data or "") or "tds-walk" in (d.data or "") or "TDS WALK" in (d.data or "")]
for n in versions: frappe.db.delete("Version", n)
for n in ours: frappe.db.delete("Deleted Document", n)
frappe.db.commit()
R = {"versions": len(versions), "deleted_documents": len(ours)}
''', start=self.start, entries=self.entries, names=names)

    def verify_cleanup(self):
        after = self.snapshot()
        leftovers = self.be('''
R["versions"] = frappe.db.count("Version", {"docname": ["in", P["names"] or ["-"]], "creation": [">", P["start"]]})
dd = frappe.get_all("Deleted Document", filters={"creation": [">", P["start"]]}, fields=["data"])
R["deleted_documents"] = sum(1 for d in dd if PROJECT in (d.data or "") or "tds-walk" in (d.data or "") or "TDS WALK" in (d.data or ""))
R["error_logs"] = frappe.get_all("Error Log", filters={"creation": [">", P["start"]]}, fields=["name", "method"], limit=20)
''', start=self.start, names=sorted(self.seen_names | ({self.item} if self.item else set())))
        problems = []
        b = self.baseline
        if after["rows"] != b["rows"]:
            problems.append(f"project rows {len(b['rows'])} -> {len(after['rows'])} "
                            f"(extra {sorted(set(after['rows']) - set(b['rows']))}, missing {sorted(set(b['rows']) - set(after['rows']))})")
        for k in ("tds_items", "tds_repository", "files", "walk_files", "walk_items"):
            if after[k] != b[k]:
                problems.append(f"{k} {b[k]} -> {after[k]}")
        if leftovers["versions"]:
            problems.append(f"{leftovers['versions']} Version rows left")
        if leftovers["deleted_documents"]:
            problems.append(f"{leftovers['deleted_documents']} Deleted Document rows left")
        return after, leftovers, problems

    # ── browser ──
    def make_pdf(self):
        self.pdf_seq += 1
        path = os.path.join(self.out, f"tds-walk-test-{self.pdf_seq}.pdf")
        body = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
                b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")
        with open(path, "wb") as fh:
            fh.write(body + f"% tds walk test {self.pdf_seq} {time.time()}\n".encode())
        return path

    def attach(self, dlg):
        dlg.locator("input[type=file]").set_input_files(self.make_pdf())
        time.sleep(0.5)

    def _route_upload(self, route):
        url = route.request.url
        if self.allow_uploads:
            self.uploads.append(url)
            route.continue_()
        else:
            self.blocked_uploads.append(url)
            route.abort()

    def login(self, browser):
        self.ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        # A saved New Request draft would pop "Continue your saved TDS request?" in the next case.
        self.ctx.add_init_script(f"try {{ localStorage.removeItem('{DRAFTS_KEY}') }} catch (e) {{}}")
        self.ctx.route(re.compile(r".*upload_file.*"), self._route_upload)
        page = self.ctx.new_page()
        page.goto(BASE)
        settle(page, 1)
        page.fill('input[placeholder*="you@company.com"]', USER)
        page.fill('input[placeholder*="Enter your password"]', PASSWORD)
        page.click('button:has-text("Sign in")')
        settle(page, 2)
        if "login" in page.url.lower() and page.locator('input[placeholder*="Enter your password"]').count():
            raise RuntimeError(f"login as {USER} failed")
        page.close()

    def shot(self, page, name, full=False):
        path = os.path.join(self.out, f"{name}.png")
        try:
            page.screenshot(path=path, full_page=full)
        except Exception as e:
            print(f"    (screenshot {name} failed: {e})")
        return path

    def run_case(self, c: Case):
        print(f"\n== case {c.n}: {c.title}")
        if c.uploads_only and not self.allow_uploads:
            print("    SKIPPED (needs --allow-uploads)")
            return "SKIPPED", "needs --allow-uploads"
        checks = Checks()
        case_start = self.be('R["now"] = str(frappe.utils.now())')["now"]
        blocked_before = len(self.blocked_uploads)
        page = self.ctx.new_page()
        status = None
        try:
            c.fn(self, page, checks)
        except CaseSkipped as e:
            status, detail = "SKIPPED", str(e)
        except Exception as e:
            checks.failures.append(f"error: {type(e).__name__}: {str(e).splitlines()[0][:300]}")
            traceback.print_exc()
        finally:
            if checks.failures:
                self.shot(page, f"c{c.n}_FAIL", full=True)
            page.close()
            try:
                self.reset(case_start)
            except Exception as e:
                checks.failures.append(f"case reset failed: {e}")
        if len(self.blocked_uploads) > blocked_before:
            checks.failures.append(f"tried {len(self.blocked_uploads) - blocked_before} upload(s); blocked")
        if status == "SKIPPED" and not checks.failures:
            return status, detail
        if checks.failures:
            return "FAIL", "; ".join(checks.failures)
        return "PASS", "; ".join([f"{checks.passed} checks"] + checks.notes)


# ─── cases ───────────────────────────────────────────────────────────────────────────────────────
# Each case seeds the rows it needs, so any subset runs alone. The walk resets the test data after
# every case. Request ids `RQ-001-WALK<n>` don't parse as numbers, so they never shift the project's
# real `RQ-001-NN` series.

@case(1, "repository wording: Unlinked / No linked SKUs, never Custom")
def c01(w: Walk, page, c: Checks):
    page.goto(f"{BASE}/tds-repository")
    settle(page, 2)
    page.locator('input[placeholder*="earch"]').first.fill("TDS WALK")
    settle(page, 2)
    row = page.locator("table tbody tr").filter(has_text=ITEM_NAME).first
    wait_for(lambda: row.count(), 10)
    c.check("No linked SKUs" in (row.inner_text() if row.count() else ""), "master row shows 'No linked SKUs'",
            row.inner_text() if row.count() else "no row")
    body = page.locator("body").inner_text()
    c.check(not re.search(r"\bCustom\b", body), "master screen has no 'Custom' wording",
            [l for l in body.splitlines() if re.search(r"\bCustom\b", l)][:5])
    w.shot(page, "c1_repo_master")

    page.goto(f"{BASE}/tds-repository/item/{w.item}")
    settle(page, 2)
    body = page.locator("body").inner_text()
    c.check("Unlinked TDS Item" in body, "item detail shows 'Unlinked TDS Item'")
    c.check(not re.search(r"\bcustom\b", body, re.I), "item detail has no 'custom' wording",
            [l for l in body.splitlines() if re.search(r"\bcustom\b", l, re.I)][:5])
    w.shot(page, "c1_item_detail", full=True)

    open_new_request(page)
    inp = rs_input(page, "Search TDS item...")
    inp.click(force=True)
    inp.fill("TDS WALK")
    menu = wait_for(lambda: (lambda m: m if ITEM_NAME in m else None)(menu_text(page)), 10) or menu_text(page)
    c.check(ITEM_NAME in menu and "no linked skus" in menu.lower(), "New Request picker tags it 'No linked SKUs'", menu)
    c.check("custom" not in menu.lower(), "picker tag never says 'custom'", menu)
    w.shot(page, "c1_picker_tag")


@case(2, "Request New dialog: Type first, two stacked choices with help text")
def c02(w: Walk, page, c: Checks):
    open_new_request(page)
    dlg = open_request_dialog(page)
    w.shot(page, "c2_dialog_default")
    c.eq(dlg.get_by_role("heading").first.inner_text().strip(), "Request New TDS Item", "dialog title")
    c.eq(dlg.locator("legend").first.inner_text().strip(), "Type", "first field label")
    radios = dlg.get_by_role("radio").all()
    c.eq([r.inner_text().split("\n")[0] for r in radios], [NEW_MAKE_LABEL, CUSTOM_LABEL], "Type choices")
    c.eq([r.inner_text().split("\n")[1] if "\n" in r.inner_text() else "" for r in radios], [NEW_MAKE_HELP, CUSTOM_HELP], "help text")
    c.eq([r.get_attribute("aria-checked") for r in radios], ["true", "false"], "default choice")
    text = dlg.inner_text()
    c.check(not any(s in text for s in ("New Item", "Existing Item", "Create New TDS Item")), "no old 'New Item'/'Existing Item' wording")
    labels = " | ".join(dlg.locator("label").all_inner_texts())
    for want in ("TDS Item", "Make", "TDS BOQ Line Item", "Item Description", "Attach Datasheet"):
        c.check(want in labels, f"New Make field '{want}'", labels)
    # makes that already have a datasheet are greyed out
    rs_pick(page, "Search TDS item...", ITEM_NAME, scope=dlg)
    mi = rs_input(page, "Select Make", dlg)
    mi.click(force=True)
    mi.fill("Locel")
    time.sleep(1)
    opt = options(page).filter(has_text="Locel").first
    c.eq(opt.get_attribute("aria-disabled"), "true", "make with a datasheet (Locel) is disabled")
    c.check("datasheet already exists" in opt.inner_text().lower(), "disabled make says the datasheet exists", opt.inner_text())
    w.shot(page, "c2_taken_make")
    page.keyboard.press("Escape")


@case(3, "Project Custom form: fields, required, Category scoped to Work Package, PDF required")
def c03(w: Walk, page, c: Checks):
    open_new_request(page)
    dlg = open_request_dialog(page)
    dlg.get_by_role("radio", name=CUSTOM_LABEL).click()
    time.sleep(0.5)
    labels = " | ".join(dlg.locator("label").all_inner_texts())
    for want in ("Item Name", "Work Package", "Category", "Make", "TDS BOQ Line Item", "Item Description", "Attach Datasheet"):
        c.check(want in labels, f"field '{want}'", labels)
    c.check("Pick a Work Package first" in dlg.inner_text(), "Category waits for a Work Package")
    dlg.get_by_role("button", name="Save").click()
    time.sleep(0.8)
    errs = " | ".join(t for t in dlg.locator("p").all_inner_texts() if "required" in t.lower())
    for want in ("Item Name is required", "Work Package is required", "Category is required", "Make is required"):
        c.check(want in errs, f"empty save says '{want}'", errs)
    c.eq(page.get_by_role("dialog").count(), 1, "dialog stays open on an empty save")
    w.shot(page, "c3_empty_save")

    rs_pick(page, "Select Work Package", WP, scope=dlg)
    time.sleep(1.5)
    ci = rs_input(page, "Select Category", dlg)
    ci.click(force=True)
    cats = (wait_for(lambda: menu_text(page), 8) or "").split(" | ")
    c.check(CATEGORY in cats, f"{WP} offers {CATEGORY}", cats[:15])
    options(page).filter(has_text=CATEGORY).first.click()
    time.sleep(0.5)
    dlg.locator(f'div[class*="singleValue"]:text-is("{WP}")').first.click(force=True)
    page.keyboard.type("HVAC System")
    time.sleep(1)
    options(page).filter(has_text="HVAC System").first.click()
    time.sleep(1.5)
    c.eq(dlg.locator(f'div[class*="singleValue"]:text-is("{CATEGORY}")').count(), 0, "changing Work Package clears the Category")
    ci = rs_input(page, "Select Category", dlg)
    ci.click(force=True)
    hvac = (wait_for(lambda: menu_text(page), 8) or "").split(" | ")
    c.check(hvac and CATEGORY not in hvac, f"HVAC System's list has no {CATEGORY}", hvac[:15])
    w.shot(page, "c3_cats_hvac")
    options(page).first.click()
    time.sleep(0.3)
    mi = rs_input(page, "Select Make", dlg)
    mi.click(force=True)
    time.sleep(0.8)
    c.check(options(page).count() > 50, "Make comes from the full Makelist", options(page).count())
    options(page).filter(has_text="Locel").first.click()
    dlg.locator(CUSTOM_NAME_INPUT).fill("TDS WALK Custom Lamp")
    dlg.get_by_role("button", name="Save").click()
    time.sleep(0.8)
    c.check("Attachment is required" in dlg.inner_text(), "save without a PDF says 'Attachment is required'")
    c.eq(page.get_by_role("dialog").count(), 1, "dialog stays open without a PDF")
    w.shot(page, "c3_no_pdf_save")


@case(4, "name-clash warning, Add New Make switch, and the Make round trip (830f3cd27)")
def c04(w: Walk, page, c: Checks):
    open_new_request(page)
    dlg = open_request_dialog(page)
    dlg.get_by_role("radio", name=CUSTOM_LABEL).click()
    time.sleep(0.5)
    rs_pick(page, "Select Make", "Locel", scope=dlg)  # Locel has a datasheet under the clashing item
    dlg.locator(CUSTOM_NAME_INPUT).fill("tds WALK test VALVE")
    warn = wait_for(lambda: " ".join(dlg.locator("div.bg-amber-50").all_inner_texts()), 8) or ""
    c.check(f'"{ITEM_NAME}" already exists in the TDS Repository.' in warn, "warning names the repository item (ignoring case)", warn)
    c.check("You can still create it as a Project Custom item." in warn, "warning lets the user carry on", warn)
    w.shot(page, "c4_clash_warning")

    dlg.get_by_role("button", name="Add New Make").click()
    time.sleep(1.5)
    c.eq(dialog_mode(dlg), [NEW_MAKE_LABEL], "one click switches to Add New Make")
    c.check(ITEM_NAME in " ".join(dlg.locator('div[class*="singleValue"]').all_inner_texts()), "the clashing TDS Item is picked",
            dlg.locator('div[class*="singleValue"]').all_inner_texts())
    c.eq(dialog_make(dlg), "", "a make that already has a datasheet is cleared")
    w.shot(page, "c4_switched_new_make")

    dlg.get_by_role("radio", name=CUSTOM_LABEL).click()
    time.sleep(1)
    c.eq(dialog_mode(dlg), [CUSTOM_LABEL], "back to Project Custom")
    c.eq(dialog_make(dlg), "Locel", "the Make comes back after the round trip")
    c.eq(dlg.locator(CUSTOM_NAME_INPUT).input_value(), "tds WALK test VALVE", "the name is kept")
    c.check(dlg.locator("div.bg-amber-50").count() > 0, "the warning shows again")
    w.shot(page, "c4_back_to_custom")

    # advisory only: it still saves as a Project Custom row
    rs_pick(page, "Select Work Package", WP, scope=dlg)
    time.sleep(1.5)
    rs_pick(page, "Select Category", CATEGORY, scope=dlg)
    w.attach(dlg)
    dlg.get_by_role("button", name="Save").click()
    wait_for(lambda: page.get_by_role("dialog").count() == 0, 5)
    c.eq(page.get_by_role("dialog").count(), 0, "saving despite the warning closes the dialog")
    rows = cart_rows(page).all_inner_texts()
    c.check(any("tds WALK test VALVE" in r and "project custom" in r.lower() for r in rows), "cart holds it as Project Custom", rows)

    # a make that no pick took survives the round trip both ways
    dlg = open_request_dialog(page)
    dlg.get_by_role("radio", name=CUSTOM_LABEL).click()
    time.sleep(0.5)
    rs_pick(page, "Select Make", "Jogger", scope=dlg)
    dlg.get_by_role("radio", name=NEW_MAKE_LABEL).click()
    time.sleep(1)
    c.eq(dialog_make(dlg), "Jogger", "Make kept on switching to New Make with no item")
    dlg.get_by_role("radio", name=CUSTOM_LABEL).click()
    time.sleep(1)
    c.eq(dialog_make(dlg), "Jogger", "Make kept on switching back")
    dlg.get_by_role("button", name="Cancel").click()
    time.sleep(1)
    dlg = open_request_dialog(page)
    c.eq(dialog_mode(dlg), [NEW_MAKE_LABEL], "a fresh dialog opens on New Make")
    c.eq(dialog_make(dlg), "", "a fresh dialog has no Make")
    dlg.get_by_role("radio", name=CUSTOM_LABEL).click()
    time.sleep(0.5)
    c.eq(dialog_make(dlg), "", "a fresh dialog's Project Custom has no Make")
    dlg.get_by_role("button", name="Cancel").click()


@case(5, "cart badges, duplicate refused, same name in another make allowed")
def c05(w: Walk, page, c: Checks):
    open_new_request(page)
    add_pick(page, "Locel")
    dlg = open_request_dialog(page)
    rs_pick(page, "Search TDS item...", ITEM_NAME, scope=dlg)
    rs_pick(page, "Select Make", "NR", scope=dlg)
    w.attach(dlg)
    dlg.get_by_role("button", name="Save").click()
    time.sleep(1)
    add_custom(w, page, CUSTOM_LAMP, "Locel")
    rows = cart_rows(page).all()
    c.eq(len(rows), 3, "cart rows")
    info = {}
    for r in rows:
        cell = r.locator("td").nth(1)
        spans = cell.locator("span")
        badge = (spans.first.inner_text().strip().lower(), spans.first.get_attribute("class") or "") if spans.count() else ("", "")
        info[(cell.inner_text().split("\n")[0].strip(), r.locator("td").nth(3).inner_text().strip())] = badge
    print("    cart:", info)
    pick = next((b for (name, make), b in info.items() if make == "Locel" and name.startswith(ITEM_NAME)), None)
    c.eq(pick, ("", ""), "a pick has no badge")
    nm = next((b for (name, make), b in info.items() if make == "NR"), ("", ""))
    c.check(nm[0] == "new make" and "sky" in nm[1], "New Make badge is blue", nm)
    pc = next((b for (name, make), b in info.items() if name.startswith(CUSTOM_LAMP)), ("", ""))
    c.check(pc[0] == "project custom" and "amber" in pc[1], "Project Custom badge is amber", pc)
    w.shot(page, "c5_cart_badges", full=True)

    add_custom(w, page, "tds walk CUSTOM lamp ", "Locel")
    t = wait_toast(page, "Duplicate in Cart", 5)
    c.check("duplicate in cart" in t.lower(), "same custom name (ignoring case) + make is refused", t)
    c.eq(cart_rows(page).count(), 3, "cart rows after the duplicate")
    w.shot(page, "c5_dup_refused", full=True)
    dismiss_toasts(page)
    add_custom(w, page, CUSTOM_LAMP, "Jogger")
    c.eq(cart_rows(page).count(), 4, "same custom name in another make is a second row")


def add_custom(w: Walk, page, name, make):
    dlg = open_request_dialog(page)
    dlg.get_by_role("radio", name=CUSTOM_LABEL).click()
    time.sleep(0.5)
    dlg.locator(CUSTOM_NAME_INPUT).fill(name)
    rs_pick(page, "Select Work Package", WP, scope=dlg)
    time.sleep(1.5)
    rs_pick(page, "Select Category", CATEGORY, scope=dlg)
    rs_pick(page, "Select Make", make, scope=dlg)
    w.attach(dlg)
    dlg.get_by_role("button", name="Save").click()
    time.sleep(1)


@case(6, "Send For Approval saves on the server under one request id")
def c06(w: Walk, page, c: Checks):
    since = w.be('R["now"] = str(frappe.utils.now())')["now"]
    uploads0 = len(w.uploads)
    open_new_request(page)
    add_pick(page, "Locel")
    add_pick(page, "Tapariya")
    if w.allow_uploads:
        dlg = open_request_dialog(page)
        rs_pick(page, "Search TDS item...", ITEM_NAME, scope=dlg)
        rs_pick(page, "Select Make", "NR", scope=dlg)
        w.attach(dlg)
        dlg.get_by_role("button", name="Save").click()
        time.sleep(1)
        add_custom(w, page, CUSTOM_LAMP, "Locel")
    n = cart_rows(page).count()
    w.shot(page, "c6_cart_before_send", full=True)
    page.get_by_role("button", name="Send For Approval").click()
    wait_for(lambda: cart_rows(page).count() == 0, 30)
    settle(page, 1)
    w.shot(page, "c6_after_send", full=True)
    rows = w.be('R["rows"] = project_rows(P["since"])', since=since)["rows"]
    c.eq(len(rows), n, "rows saved")
    ids = {r["tds_request_id"] for r in rows}
    c.check(len(ids) == 1 and re.fullmatch(r"RQ-001-\d{2,}", next(iter(ids), "")), "one server-issued RQ-001-NN id", ids)
    by_make = {(r["tds_item_name"], r["tds_make"]): r for r in rows}
    for make in ("Locel", "Tapariya"):
        r = by_make.get((ITEM_NAME, make), {})
        c.eq(r.get("tds_status"), "Pending", f"pick {make} status")
        c.eq(r.get("tds_attachment"), w.entries[make]["url"], f"pick {make} borrows the entry's datasheet")
    if w.allow_uploads:
        nm = by_make.get((ITEM_NAME, "NR"), {})
        c.eq(nm.get("tds_status"), "New", "New Make status")
        pc = by_make.get((CUSTOM_LAMP, "Locel"), {})
        c.check((pc.get("tds_item_id") or "").startswith("PCUS-"), "Project Custom gets a PCUS- id", pc.get("tds_item_id"))
        c.eq((pc.get("tds_status"), pc.get("tds_category")), ("Pending", CATEGORY), "Project Custom status/category")
        files = w.be('R["f"] = frappe.get_all("File", filters={"attached_to_name": ["in", P["names"]], "file_name": ["like", "tds-walk-test-%"]}, pluck="attached_to_name")',
                     names=[nm.get("name", "-"), pc.get("name", "-")])["f"]
        c.eq(len(files), 2, "each request's upload is attached to its row")
        c.eq(len(w.uploads) - uploads0, 2, "uploads this send")
    else:
        c.note("picks only; New Make / Project Custom send needs --allow-uploads")


@case(7, "a refused send keeps its uploads; the retry reuses them", uploads_only=True)
def c07(w: Walk, page, c: Checks):
    since = w.be('R["now"] = str(frappe.utils.now())')["now"]
    open_new_request(page)
    dlg = open_request_dialog(page)
    rs_pick(page, "Search TDS item...", ITEM_NAME, scope=dlg)
    rs_pick(page, "Select Make", "NR", scope=dlg)
    w.attach(dlg)
    dlg.get_by_role("button", name="Save").click()
    time.sleep(1)
    add_custom(w, page, CUSTOM_LAMP, "Locel")
    conflict = w.be('R = seed_row("RQ-001-WALK7C", {"kind": "custom", "name": P["name"], "make": "Locel", "pcus": "PCUS-WALK7"}); frappe.db.commit()',
                    name=CUSTOM_LAMP)
    send = page.get_by_role("button", name="Send For Approval")
    for i in (1, 2):
        u0 = len(w.uploads)
        send.click()
        t = wait_toast(page, "Submission Failed", 30)
        c.check("submission failed" in t.lower() and "already on this project" in t.lower(), f"send {i} refused by the live duplicate", t)
        c.eq(len(w.uploads) - u0, 2 if i == 1 else 0, f"uploads on send {i}")
        c.eq(cart_rows(page).count(), 2, f"cart kept after send {i}")
        dismiss_toasts(page)
    w.be('frappe.db.delete(ROW, P["n"]); frappe.db.commit()', n=conflict["name"])  # raw: test row, no hooks
    u0 = len(w.uploads)
    send.click()
    wait_for(lambda: cart_rows(page).count() == 0, 30)
    c.eq(len(w.uploads) - u0, 0, "uploads on the successful retry")
    rows = w.be('R["rows"] = [r for r in project_rows(P["since"]) if r.tds_request_id != "RQ-001-WALK7C"]', since=since)["rows"]
    c.eq(len(rows), 2, "rows saved by the retry")
    files = w.be('R["f"] = frappe.get_all("File", filters={"file_name": ["like", "tds-walk-test-%"], "creation": [">", P["since"]]}, fields=["attached_to_name"])',
                 since=since)["f"]
    c.eq(len(files), 2, "File records for the two uploads (no extra copies)")
    c.check(all(f["attached_to_name"] in {r["name"] for r in rows} for f in files), "both uploads attached to the saved rows", files)


@case(8, "TDS History: only Pending / Approved by Admin / Rejected, Project Custom tag")
def c08(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK8"
    seeded = w.be('''
R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]
frappe.db.commit()''', rid=rid, specs=[
        {"kind": "new_make", "make": "NR"},
        {"kind": "pick", "make": "Locel"},
        {"kind": "custom", "name": CUSTOM_LAMP, "make": "Locel", "pcus": "PCUS-WALK8"},
        {"kind": "pick", "make": "Tapariya", "status": "Approved"},
        {"kind": "new_make", "make": "Jogger", "status": "Rejected", "reason": "walk"},
    ])["rows"]
    page.goto(f"{BASE}/projects/{PROJECT}?page=tdsrepository")
    settle(page, 3)
    if page.get_by_text("Continue your saved TDS request?").count():
        page.get_by_role("button", name="Start Fresh").click()
    table = page.locator("table").filter(has=page.locator("th", has_text="Status")).first
    wait_for(lambda: table.locator("tbody tr").filter(has_text="TDS WALK").count() >= 5, 15)
    headers = headers_of(table)
    c.check("REQUEST TYPE" not in headers, "no Request Type column in History", headers)
    want = {"NR": "Pending", "Locel": "Pending", "Tapariya": "Approved by Admin", "Jogger": "Rejected"}
    for r in table.locator("tbody tr").filter(has_text="TDS WALK").all():
        name, status = column_values(table, r, "Item Name", "Status")
        text = r.inner_text()
        if CUSTOM_LAMP in (name or ""):
            c.check("project custom" in name.lower(), "Project Custom row carries the tag", name)
            c.eq(status, "Pending", "Project Custom row status")
            continue
        make = next((m for m in want if re.search(rf"\b{m}\b", text)), None)
        if make:
            c.eq(status, want[make], f"{make} row status")
            c.check("project custom" not in (name or "").lower(), f"{make} row has no Project Custom tag", name)
    statuses = [column_values(table, r, "Status")[0] for r in table.locator("tbody tr").all()]
    c.check("New" not in statuses, "no row shows status New", statuses)
    w.shot(page, "c8_history", full=True)
    th = table.locator("thead th").filter(has_text="Status").first
    th.locator("div.cursor-pointer").first.click()
    time.sleep(1)
    opts = [o.strip() for o in page.locator("[cmdk-item]").all_inner_texts()]
    c.check([re.sub(r"\s*\d+$", "", o) for o in opts] == ["Pending", "Approved by Admin", "Rejected"],
            "Status filter offers Pending, Approved by Admin, Rejected", opts)
    page.locator("[cmdk-item]").filter(has_text="Pending").first.click()
    time.sleep(2)
    page.keyboard.press("Escape")
    settle(page, 1)
    rows = table.locator("tbody tr").filter(has_text="TDS WALK").all_inner_texts()
    c.check(any(re.search(r"\bNR\b", r) for r in rows), "Pending filter includes the New Make row", rows)
    c.check(not any(re.search(r"\b(Tapariya|Jogger)\b", r) for r in rows), "Pending filter drops Approved/Rejected", rows)
    w.shot(page, "c8_pending_filtered", full=True)


@case(9, "Pending Review: Request Type and Item Status columns, Request Type facet")
def c09(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK9"
    w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid=rid, specs=[
        {"kind": "pick", "make": "Locel"},
        {"kind": "pick", "make": "Tapariya"},
        {"kind": "new_make", "make": "NR"},
        {"kind": "custom", "name": CUSTOM_LAMP, "make": "Locel", "pcus": "PCUS-WALK9"},
        {"kind": "pick", "make": "Jogger"},  # From Repository whose entry is missing
    ])
    open_approval(page, rid)
    table = pending_table(page)
    headers = headers_of(table)
    c.check("REQUEST TYPE" in headers and "ITEM STATUS" in headers, "Request Type and Item Status columns", headers)
    want = [
        (ITEM_NAME, "Locel", "From Repository", "Verified"),
        (ITEM_NAME, "Tapariya", "From Repository", "Not Verified"),
        (ITEM_NAME, "NR", "New Make", "Not Verified"),
        (CUSTOM_LAMP, "Locel", "Project Custom", "--"),
        (ITEM_NAME, "Jogger", "From Repository", "--"),
    ]
    for item, make, rtype, istatus in want:
        r = row_by(page, item, make)
        if not c.check(r.count() == 1, f"row {item}/{make} shown", r.count()):
            continue
        got = column_values(table, r.first, "Request Type", "Item Status")
        c.eq([g.upper() if g else g for g in got], [rtype.upper(), istatus.upper()], f"{make} {rtype}")
    w.shot(page, "c9_pending_review", full=True)
    th = table.locator("thead th").filter(has_text="Request Type").first
    th.locator("button").first.click()
    time.sleep(1)
    opts = sorted(re.sub(r"\s*\d+$", "", o.strip()) for o in page.locator("[cmdk-item]").all_inner_texts())
    c.eq(opts, ["From Repository", "New Make", "Project Custom"], "Request Type facet options")
    w.shot(page, "c9_request_type_facet")
    page.keyboard.press("Escape")


@case(10, "legacy New row with no TDS Item id: reads New Make, opens the request edit, approval refused")
def c10(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK10"
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid=rid, specs=[
        {"kind": "legacy", "name": "TDS WALK Legacy Item", "make": "Jogger"},
        {"kind": "pick", "make": "Locel"},
    ])["rows"]
    open_approval(page, rid)
    r = row_by(page, "TDS WALK Legacy Item", "Jogger").first
    rtype, _ = column_values(pending_table(page), r, "Request Type", "Item Status")
    c.eq((rtype or "").upper(), "NEW MAKE", "legacy row's Request Type")
    dlg = open_edit(page, "TDS WALK Legacy Item", "Jogger")
    c.eq(dlg.get_by_role("heading").first.inner_text().strip(), "Edit Request Item", "pencil opens the request edit")
    c.eq([x.inner_text().split("\n")[0] for x in dlg.get_by_role("radio").all()], [NEW_MAKE_LABEL, CUSTOM_LABEL], "edit offers both Types")
    w.shot(page, "c10_legacy_edit_dialog")
    dlg.get_by_role("button", name="Cancel").click()
    time.sleep(1)
    select_row(page, "TDS WALK Legacy Item", "Jogger")
    page.get_by_role("button", name="Approve Selected").click()
    t = wait_toast(page, "Approval failed", 20)
    c.check("approval failed" in t.lower() and "has no TDS Item in the repository" in t, "approval refused with a clear message", t)
    w.shot(page, "c10_legacy_approve_refused", full=True)
    st = w.be('R["s"] = frappe.db.get_value(ROW, P["n"], "tds_status")', n=rows[0]["name"])["s"]
    c.eq(st, "New", "legacy row still waiting")


@case(11, "approve Project Custom: Approved, the TDS Repository untouched")
def c11(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK11"
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid=rid, specs=[
        {"kind": "custom", "name": CUSTOM_LAMP, "make": "Locel", "pcus": "PCUS-WALK11"},
        {"kind": "new_make", "make": "NR"},
    ])["rows"]
    before = w.snapshot()
    open_approval(page, rid)
    select_row(page, CUSTOM_LAMP, "Locel")
    page.get_by_role("button", name="Approve Selected").click()
    t = wait_toast(page, "Approved", 20)
    c.check("1 item(s) approved." in t, "toast says 1 approved, nothing added", t)
    w.shot(page, "c11_after_approve_custom", full=True)
    after = w.snapshot()
    row = w.be('R["r"] = frappe.db.get_value(ROW, P["n"], ["tds_status", "tds_attachment", "tds_category", "tds_item_id"], as_dict=True)',
               n=rows[0]["name"])["r"]
    c.eq(row["tds_status"], "Approved", "Project Custom row status")
    c.eq(row["tds_attachment"], rows[0]["url"], "datasheet stays on the row")
    c.eq((row["tds_item_id"], row["tds_category"]), ("PCUS-WALK11", CATEGORY), "id and Category kept")
    c.eq((after["tds_repository"], after["tds_items"]), (before["tds_repository"], before["tds_items"]), "TDS Repository / TDS Items counts")


@case(12, "approve New Make with no entry: a Verified entry owns the uploaded datasheet")
def c12(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK12"
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid=rid, specs=[
        {"kind": "new_make", "make": "NR", "with_file": True},
        {"kind": "pick", "make": "Locel"},
    ])["rows"]
    nm = rows[0]
    open_approval(page, rid)
    select_row(page, ITEM_NAME, "NR")
    page.get_by_role("button", name="Approve Selected").click()
    t = wait_toast(page, "Approved", 20)
    c.eq(chooser(page).count(), 0, "no datasheet chooser")
    c.check("1 new datasheet entr(ies) added" in t, "toast says an entry was added", t)
    w.shot(page, "c12_after_approve_new_make", full=True)
    res = w.be('''
R["row"] = frappe.db.get_value(ROW, P["n"], ["tds_status", "tds_attachment"], as_dict=True)
R["entry"] = frappe.db.get_value("TDS Repository", {"tds_item": T, "make": "NR"}, ["name", "status", "tds_attachment"], as_dict=True)
R["file"] = frappe.db.get_value("File", P["f"], ["attached_to_doctype", "attached_to_name"], as_dict=True)''', n=nm["name"], f=nm["file"])
    c.eq(res["row"]["tds_status"], "Approved", "New Make row status")
    e = res["entry"] or {}
    c.eq((e.get("status"), e.get("tds_attachment")), ("Verified", nm["url"]), "new entry is Verified with the uploaded sheet")
    c.eq((res["file"] or {}).get("attached_to_doctype"), "TDS Repository", "the upload moves to the entry")
    c.eq((res["file"] or {}).get("attached_to_name"), e.get("name"), "the upload is owned by the new entry")


def seed_conflicts(w: Walk, rid, makes, with_files=False, other_pick=True):
    """New Make rows for `makes`, then their Repository Entries, created after the request."""
    specs = [{"kind": "new_make", "make": m, "with_file": with_files} for m in makes]
    if other_pick:
        specs.append({"kind": "pick", "make": "Locel"})
    return w.be('''
R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]
R["entries"] = {m: entry(m, "Not Verified", "tds-walk-fake-entry-%s.pdf" % m.lower().replace(" ", "-"), with_file=P["with_files"]) for m in P["makes"]}
frappe.db.commit()''', rid=rid, specs=specs, makes=makes, with_files=with_files)


@case(13, "datasheet chooser opens up front, repository pre-selected; keep the repository's sheet")
def c13(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK13"
    s = seed_conflicts(w, rid, ["KM Enterprises"])
    row, ent = s["rows"][0], s["entries"]["KM Enterprises"]
    posts = []
    page.on("request", lambda r: posts.append(r.post_data) if "approve_tds_items" in r.url else None)
    open_approval(page, rid)
    r = row_by(page, ITEM_NAME, "KM Enterprises").first
    _, istatus = column_values(pending_table(page), r, "Request Type", "Item Status")
    c.check("NOT VERIFIED" in (istatus or "").upper() and "entry added since request" in (istatus or "").lower(),
            "row shows the entry's status and 'entry added since request'", istatus)
    w.shot(page, "c13_entry_added_note", full=True)
    select_row(page, ITEM_NAME, "KM Enterprises")
    page.get_by_role("button", name="Approve Selected").click()
    d = chooser(page)
    c.check(wait_for(lambda: d.count(), 8), "chooser opens")
    c.eq(len(posts), 0, "nothing sent to the server before the choice")
    text = d.inner_text()
    c.check("1 of your selected items already has a repository datasheet" in text, "chooser explains why", text[:200])
    c.check("Keep the repository's datasheet" in text and "Use the datasheet sent with this request" in text, "both choices offered")
    c.check(d.get_by_role("link", name="Preview").count() == 2, "each choice has a Preview", d.get_by_role("link", name="Preview").count())
    c.check(radio_checked(page, f"{row['name']}-repository"), "repository's sheet pre-selected")
    time.sleep(0.6)  # let the dialog finish animating in
    w.shot(page, "c13_chooser")
    d.get_by_role("button", name="Approve 1 item").click()
    wait_for(lambda: chooser(page).count() == 0, 15)
    wait_toast(page, "Approved", 15)
    res = w.be('''
R["row"] = frappe.db.get_value(ROW, P["n"], ["tds_status", "tds_attachment"], as_dict=True)
R["entry"] = frappe.db.get_value("TDS Repository", P["e"], ["status", "tds_attachment"], as_dict=True)''', n=row["name"], e=ent["name"])
    c.eq(res["row"]["tds_status"], "Approved", "row status")
    c.eq(res["row"]["tds_attachment"], ent["url"], "row now points at the repository's sheet")
    c.eq((res["entry"]["status"], res["entry"]["tds_attachment"]), ("Verified", ent["url"]), "entry verified, sheet unchanged")
    c.check(posts and "repository" in (posts[-1] or ""), "approve call carried the 'repository' choice", posts[-1:] if posts else posts)


@case(14, "datasheet chooser: use the request's sheet; the entry's old file is kept")
def c14(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK14"
    s = seed_conflicts(w, rid, ["Aditya Steel"], with_files=True)
    row, ent = s["rows"][0], s["entries"]["Aditya Steel"]
    open_approval(page, rid)
    select_row(page, ITEM_NAME, "Aditya Steel")
    page.get_by_role("button", name="Approve Selected").click()
    d = chooser(page)
    wait_for(lambda: d.count(), 8)
    page.locator(f'[id="{row["name"]}-request"]').click()
    time.sleep(0.4)
    c.check(radio_checked(page, f"{row['name']}-request"), "request's sheet chosen")
    c.check("Replaces the repository's datasheet for every project from now on." in d.inner_text(), "the choice says what it replaces")
    time.sleep(0.6)  # let the dialog finish animating in
    w.shot(page, "c14_choose_request")
    d.get_by_role("button", name="Approve 1 item").click()
    wait_for(lambda: chooser(page).count() == 0, 15)
    t = wait_toast(page, "Approved", 15)
    c.check("1 repository datasheet(s) replaced" in t, "toast says the sheet was replaced", t)
    res = w.be('''
R["row"] = frappe.db.get_value(ROW, P["n"], ["tds_status", "tds_attachment"], as_dict=True)
R["entry"] = frappe.db.get_value("TDS Repository", P["e"], ["status", "tds_attachment"], as_dict=True)
R["old_file"] = frappe.db.get_value("File", P["ef"], ["attached_to_doctype", "attached_to_name"], as_dict=True)
R["row_file"] = frappe.db.get_value("File", P["rf"], ["attached_to_doctype", "attached_to_name"], as_dict=True)''',
               n=row["name"], e=ent["name"], ef=ent["file"], rf=row["file"])
    c.eq(res["row"]["tds_status"], "Approved", "row status")
    c.eq(res["row"]["tds_attachment"], row["url"], "row keeps its own sheet")
    c.eq((res["entry"]["status"], res["entry"]["tds_attachment"]), ("Verified", row["url"]), "entry now carries the request's sheet")
    c.check(res["old_file"] is not None, "the entry's previous File still exists")
    c.eq((res["row_file"] or {}).get("attached_to_name"), ent["name"], "the request's upload is owned by the entry")


@case(15, "multi-row datasheet chooser: one choice per row, the rest approved alongside, Cancel approves nothing")
def c15(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK15"
    s = seed_conflicts(w, rid, ["KM Enterprises", "Aditya Steel"])
    km, ad, pick = s["rows"]
    posts = []
    page.on("request", lambda r: posts.append(r.post_data) if "approve_tds_items" in r.url else None)
    open_approval(page, rid)
    page.get_by_role("button", name="Select All").click()
    time.sleep(0.5)
    page.get_by_role("button", name="Approve Selected").click()
    d = chooser(page)
    wait_for(lambda: d.count(), 8)
    text = d.inner_text()
    c.check("2 of your selected items already have a repository datasheet" in text, "chooser lists both rows", text[:200])
    c.check("KM Enterprises" in text and "Aditya Steel" in text, "both makes named")
    c.eq(d.get_by_role("radio").count(), 4, "two choices per row")
    c.check(radio_checked(page, f"{km['name']}-repository") and radio_checked(page, f"{ad['name']}-repository"), "repository pre-selected for each")
    c.check("The other 1 selected item is approved as usual." in text, "says the other row is approved alongside")
    c.check(d.get_by_role("button", name="Approve 3 items").count() == 1, "button approves all 3")
    time.sleep(0.6)  # let the dialog finish animating in
    w.shot(page, "c15_chooser_two_rows")
    d.get_by_role("button", name="Cancel").click()
    time.sleep(1.5)
    c.eq(len(posts), 0, "Cancel sends nothing")
    st = w.be('R["s"] = [frappe.db.get_value(ROW, n, "tds_status") for n in P["names"]]', names=[km["name"], ad["name"], pick["name"]])["s"]
    c.eq(st, ["New", "New", "Pending"], "nothing approved after Cancel")
    page.get_by_role("button", name="Approve Selected").click()
    wait_for(lambda: chooser(page).count(), 8)
    page.locator(f'[id="{ad["name"]}-request"]').click()
    time.sleep(0.4)
    chooser(page).get_by_role("button", name="Approve 3 items").click()
    wait_for(lambda: chooser(page).count() == 0, 15)
    time.sleep(2)
    res = w.be('''
R["rows"] = {n: frappe.db.get_value(ROW, n, ["tds_status", "tds_attachment"], as_dict=True) for n in P["names"]}
R["entries"] = {m: frappe.db.get_value("TDS Repository", v["name"], ["status", "tds_attachment"], as_dict=True) for m, v in P["ents"].items()}''',
                 names=[km["name"], ad["name"], pick["name"]], ents=s["entries"])
    c.eq([res["rows"][n]["tds_status"] for n in (km["name"], ad["name"], pick["name"])], ["Approved"] * 3, "all three approved in one go")
    c.eq(res["rows"][km["name"]]["tds_attachment"], s["entries"]["KM Enterprises"]["url"], "KM row took the repository's sheet")
    c.eq(res["entries"]["Aditya Steel"]["tds_attachment"], ad["url"], "Aditya entry took the request's sheet")


@case(16, "chooser opened from the server's reply when the entry appears after the page loaded")
def c16(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK16"
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid=rid, specs=[
        {"kind": "new_make", "make": "Indiana"},
        {"kind": "pick", "make": "Locel"},
    ])["rows"]
    posts = []
    page.on("request", lambda r: posts.append(r.post_data) if "approve_tds_items" in r.url else None)
    open_approval(page, rid)
    r = row_by(page, ITEM_NAME, "Indiana").first
    _, istatus = column_values(pending_table(page), r, "Request Type", "Item Status")
    c.check("entry added" not in (istatus or "").lower(), "no entry when the page loaded", istatus)
    ent = w.be('R = entry("Indiana", "Not Verified", "tds-walk-fake-entry-e16.pdf"); frappe.db.commit()')
    select_row(page, ITEM_NAME, "Indiana")
    page.get_by_role("button", name="Approve Selected").click()
    t = wait_toast(page, "Choose a datasheet", 20)
    c.check("choose a datasheet" in t.lower(), "server reply asks for a choice", t)
    d = chooser(page)
    c.check(wait_for(lambda: d.count(), 10), "chooser opens from the reply")
    c.eq(len(posts), 1, "one approve call before the chooser")
    c.check(radio_checked(page, f"{rows[0]['name']}-repository"), "repository's sheet pre-selected")
    c.check("tds-walk-fake-entry-e16.pdf" in d.inner_text(), "chooser shows the sheet the server sent", d.inner_text()[:300])
    time.sleep(0.6)  # let the dialog finish animating in
    w.shot(page, "c16_chooser_from_server_reply")
    d.get_by_role("button", name="Approve 1 item").click()
    wait_for(lambda: chooser(page).count() == 0, 15)
    time.sleep(1.5)
    row = w.be('R["r"] = frappe.db.get_value(ROW, P["n"], ["tds_status", "tds_attachment"], as_dict=True)', n=rows[0]["name"])["r"]
    c.eq((row["tds_status"], row["tds_attachment"]), ("Approved", ent["url"]), "row approved on the repository's sheet")


@case(17, "Admin edit switches a request New Make -> Project Custom -> New Make")
def c17(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK17"
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid=rid, specs=[
        {"kind": "new_make", "make": "NR"},
        {"kind": "pick", "make": "Locel"},
    ])["rows"]
    nm = rows[0]
    get = lambda: w.be('R["r"] = frappe.db.get_value(ROW, P["n"], ["tds_status", "tds_item_id", "tds_category", "tds_attachment"], as_dict=True)', n=nm["name"])["r"]
    open_approval(page, rid)
    dlg = open_edit(page, ITEM_NAME, "NR")
    c.eq(dlg.locator("legend").first.inner_text().strip(), "Type", "edit's first field")
    radios = dlg.get_by_role("radio").all()
    c.eq([x.inner_text().split("\n")[0] for x in radios], [NEW_MAKE_LABEL, CUSTOM_LABEL], "same Type labels as Request New")
    c.eq(dialog_mode(dlg), [NEW_MAKE_LABEL], "opens on the row's Type")
    dlg.get_by_role("radio", name=CUSTOM_LABEL).click()
    time.sleep(1)
    c.eq(" ".join(dlg.locator("p.bg-amber-50").all_inner_texts()).strip(), SWITCH_NOTE_CUSTOM, "switch note (to Project Custom)")
    c.check("Category" in " | ".join(dlg.locator("label").all_inner_texts()), "asks for a Category")
    rs_pick(page, "Select Category", CATEGORY, scope=dlg)
    w.shot(page, "c17_switch_to_custom")
    dlg.get_by_role("button", name="Save Changes").click()
    t = wait_toast(page, "Updated", 20)
    c.check("request updated" in t.lower(), "saved", t)
    r = get()
    c.check((r["tds_item_id"] or "").startswith("PCUS-"), "row got a PCUS- id", r["tds_item_id"])
    c.eq((r["tds_status"], r["tds_category"], r["tds_attachment"]), ("Pending", CATEGORY, nm["url"]), "status / Category / sheet")
    settle(page, 2)
    rt = wait_for(lambda: (lambda v: v if v and "CUSTOM" in v.upper() else None)(
        column_values(pending_table(page), row_by(page, ITEM_NAME, "NR").first, "Request Type")[0]), 10)
    c.check(rt, "row now reads Project Custom", rt)
    w.shot(page, "c17_after_switch_custom", full=True)
    dismiss_toasts(page)

    dlg = open_edit(page, ITEM_NAME, "NR")
    c.eq(dialog_mode(dlg), [CUSTOM_LABEL], "reopens on Project Custom")
    dlg.get_by_role("radio", name=NEW_MAKE_LABEL).click()
    time.sleep(1.5)
    c.eq(" ".join(dlg.locator("p.bg-amber-50").all_inner_texts()).strip(), SWITCH_NOTE_NEW_MAKE, "switch note (to New Make)")
    inp = rs_input(page, "Search TDS Item or member item...", dlg)
    inp.click(force=True)
    inp.fill("TDS WALK")
    time.sleep(2.5)
    options(page).filter(has_text=ITEM_NAME).first.click()
    time.sleep(0.5)
    if w.allow_uploads:
        w.attach(dlg)
    w.shot(page, "c17_switch_back_new_make")
    dlg.get_by_role("button", name="Save Changes").click()
    t = wait_toast(page, "Updated", 20)
    c.check("request updated" in t.lower(), "saved again", t)
    r = get()
    c.eq((r["tds_item_id"], r["tds_status"]), (w.item, "New"), "PCUS- id dropped, back to New")
    if w.allow_uploads:
        c.check("tds-walk-test" in (r["tds_attachment"] or "") or r["tds_attachment"] != nm["url"], "new sheet stored", r["tds_attachment"])
    else:
        c.eq(r["tds_attachment"], nm["url"], "current sheet kept (no new upload)")
    settle(page, 2)
    w.shot(page, "c17_after_switch_back", full=True)


@case(18, "Admin edit racing an approval is refused, the approval stands")
def c18(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK18"
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid=rid, specs=[
        {"kind": "new_make", "make": "Sphere"},
        {"kind": "pick", "make": "Locel"},
    ])["rows"]
    open_approval(page, rid)
    dlg = open_edit(page, ITEM_NAME, "Sphere")
    dlg.locator("textarea").fill("walk race edit")
    res = w.be('''
from nirmaan_stack.api.tds.approve import approve_tds_items
R = approve_tds_items([P["n"]])''', n=rows[0]["name"])
    c.eq(res.get("summary", {}).get("approved"), 1, "another Admin approves first")
    dlg.get_by_role("button", name="Save Changes").click()
    t = wait_toast(page, "Not saved", 20)
    c.check("not saved" in t.lower() and "Only a waiting New Make or Project Custom request can be edited here." in t, "edit refused", t)
    w.shot(page, "c18_edit_race_refused")
    r = w.be('R["r"] = frappe.db.get_value(ROW, P["n"], ["tds_status", "tds_description"], as_dict=True)', n=rows[0]["name"])["r"]
    c.eq(r["tds_status"], "Approved", "row stays Approved")
    c.check(r["tds_description"] != "walk race edit", "edit not written", r["tds_description"])


@case(19, "reject, then resubmit a pick, a New Make and a Project Custom row")
def c19(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK19"
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid=rid, specs=[
        {"kind": "new_make", "make": "Value"},
        {"kind": "custom", "name": CUSTOM_FAN, "make": "Nerolac", "pcus": "PCUS-WALK19"},
        {"kind": "pick", "make": "Tapariya"},
    ])["rows"]
    reason = "walk: datasheet unreadable"
    open_approval(page, rid)
    page.get_by_role("button", name="Select All").click()
    time.sleep(0.5)
    page.get_by_role("button", name="Reject Selected").click()
    d = page.get_by_role("dialog")
    d.wait_for(timeout=8000)
    d.locator("textarea").fill(reason)
    d.get_by_role("button", name="Reject", exact=True).click()
    wait_toast(page, "Rejected", 15)
    st = w.be('R["s"] = [frappe.db.get_value(ROW, r["name"], ["tds_status", "tds_rejection_reason"]) for r in P["rows"]]', rows=rows)["s"]
    c.eq([tuple(x) for x in st], [("Rejected", reason)] * 3, "all three rejected with the reason")

    def popup(label, item, make):
        ad = page.get_by_role("alertdialog")
        if not c.check(wait_for(lambda: ad.count(), 8), f"{label}: 'Resubmit Rejected Item?' opens"):
            return
        text = ad.inner_text()
        c.check(all(s in text for s in ("Resubmit Rejected Item?", item, make, rid, reason)),
                f"{label}: popup names the item, make, request id and reason", text.replace("\n", " / ")[:300])
        w.shot(page, f"c19_popup_{label}")
        ad.locator("input").fill("1")
        ad.get_by_role("button", name="Confirm").click()
        time.sleep(1)

    # a pick resubmit needs no upload: send it on its own
    since = w.be('R["now"] = str(frappe.utils.now())')["now"]
    open_new_request(page)
    add_pick(page, "Tapariya")
    popup("pick", ITEM_NAME, "Tapariya")
    c.eq(cart_rows(page).count(), 1, "pick resubmit in the cart")
    page.get_by_role("button", name="Send For Approval").click()
    wait_for(lambda: cart_rows(page).count() == 0, 30)
    res = w.be('''
R["old"] = frappe.db.exists(ROW, P["old"])
R["new"] = [r for r in project_rows(P["since"]) if r.tds_make == "Tapariya"]''', old=rows[2]["name"], since=since)
    c.check(not res["old"], "the rejected pick row is replaced on send", res["old"])
    c.check(len(res["new"]) == 1 and res["new"][0]["tds_status"] == "Pending", "its replacement is Pending", res["new"])

    open_new_request(page)
    dlg = open_request_dialog(page)
    rs_pick(page, "Search TDS item...", ITEM_NAME, scope=dlg)
    rs_pick(page, "Select Make", "Value", scope=dlg)
    w.attach(dlg)
    dlg.get_by_role("button", name="Save").click()
    time.sleep(1)
    popup("new_make", ITEM_NAME, "Value")
    add_custom(w, page, "tds walk custom FAN", "Nerolac")
    popup("project_custom", CUSTOM_FAN, "Nerolac")
    c.eq(cart_rows(page).count(), 2, "both request resubmits in the cart")
    w.shot(page, "c19_cart", full=True)
    if not w.allow_uploads:
        c.note("New Make / Project Custom resubmit send needs --allow-uploads")
        return
    since = w.be('R["now"] = str(frappe.utils.now())')["now"]
    u0 = len(w.uploads)
    page.get_by_role("button", name="Send For Approval").click()
    wait_for(lambda: cart_rows(page).count() == 0, 30)
    res = w.be('''
R["old"] = [frappe.db.exists(ROW, n) for n in P["old"]]
R["new"] = project_rows(P["since"])''', old=[rows[0]["name"], rows[1]["name"]], since=since)
    c.check(not any(res["old"]), "rejected request rows replaced on send", res["old"])
    new = {r["tds_make"]: r for r in res["new"]}
    c.eq(new.get("Value", {}).get("tds_status"), "New", "New Make resubmit status")
    c.eq((new.get("Nerolac", {}).get("tds_item_id"), new.get("Nerolac", {}).get("tds_status")), ("PCUS-WALK19", "Pending"),
         "Project Custom resubmit keeps the name's PCUS- id")
    c.eq(len(w.uploads) - u0, 2, "uploads this send")


@case(20, "export dialog: approved Project Custom rows export like any approved row")
def c20(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK20"
    w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid=rid, specs=[
        {"kind": "custom", "name": CUSTOM_LAMP, "make": "Locel", "pcus": "PCUS-WALK20", "status": "Approved"},
        {"kind": "pick", "make": "Locel", "status": "Approved"},
        {"kind": "new_make", "make": "NR"},
        {"kind": "pick", "make": "Tapariya"},
        {"kind": "new_make", "make": "Jogger", "status": "Rejected", "reason": "walk"},
    ])
    counts = pdf_db_counts(w)
    d = open_pdf_dialog(page)
    c.eq(d.get_by_role("heading").first.inner_text().strip(), "Download TDS PDF", "export dialog")
    c.eq({s: pdf_status_count(d, s) for s in PDF_STATUSES}, counts,
         "status counts match the database (Approved by Admin excludes client-answered rows; Pending includes New)")
    pdf_toggle_status(d, PDF_ADMIN)
    approved = pdf_row_texts(d)
    lamp = [r for r in approved if CUSTOM_LAMP in r]
    c.check(len(lamp) == 1, "approved Project Custom row is in the export list", approved)
    c.check(lamp and CATEGORY in lamp[0], "it carries its chosen Category", lamp)
    c.check(not any("Jogger" in r for r in approved), "rejected row not offered", approved)
    w.shot(page, "c20_export_approved")
    pdf_toggle_status(d, PDF_PENDING)
    pending = pdf_row_texts(d)
    c.check(any(re.search(r"\bNR\b", r) for r in pending), "Pending list includes the New Make row", pending)
    c.check(any("Tapariya" in r for r in pending), "Pending list includes the pick", pending)
    w.shot(page, "c20_export_pending")


@case(21, "Approved / Rejected rows are not selectable, and approve refuses a Rejected row")
def c21(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK21"
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid=rid, specs=[
        {"kind": "pick", "make": "Locel"},
        {"kind": "pick", "make": "Tapariya", "status": "Approved"},
        {"kind": "new_make", "make": "Value", "status": "Rejected", "reason": "walk: wrong sheet"},
        {"kind": "custom", "name": CUSTOM_FAN, "make": "Nerolac", "pcus": "PCUS-WALK21", "status": "Rejected", "reason": "walk"},
    ])["rows"]
    for status in ("Pending", "Approved", "Rejected"):
        open_approval(page, rid, status)
        table = pending_table(page)
        wait_for(lambda: table.locator("tbody tr").count(), 10)
        headers = headers_of(table)
        boxes = table.get_by_role("checkbox").count()
        if status == "Pending":
            c.check(boxes > 0, "Pending Review rows have checkboxes", boxes)
            c.check("REQUEST TYPE" in headers, "Pending Review shows Request Type", headers)
        else:
            c.eq(boxes, 0, f"{status} rows have no checkboxes")
            c.check("REQUEST TYPE" not in headers and "ITEM STATUS" not in headers, f"{status} shows no Request Type / Item Status", headers)
            c.eq(page.get_by_role("button", name="Approve Selected").count(), 0, f"no Approve Selected in {status} view")
        w.shot(page, f"c21_{status.lower()}", full=True)
    res = w.be('''
from nirmaan_stack.api.tds.approve import approve_tds_items
R["reply"] = approve_tds_items([P["n"]])
R["status"] = frappe.db.get_value(ROW, P["n"], "tds_status")''', n=rows[2]["name"])
    errs = " ".join(e.get("error", "") for e in res["reply"].get("errors", []))
    c.check("Only a row waiting for approval can be approved." in errs, "approve refuses a Rejected row", errs)
    c.eq(res["status"], "Rejected", "Rejected row unchanged")


ITEM_PAGE = "/tds-repository/item/"
GO_BACK = 'button[aria-label="Go back"]'  # the app header's back arrow


def open_tds_item_from_table(page, label=None):
    """Click a TDS Item link in the repository table (the one reading `label`, else the first) and
    wait for the item page to load."""
    links = page.locator("table tbody tr td button[title]")
    (links.filter(has_text=label) if label else links).first.click()
    wait_for(lambda: ITEM_PAGE in page.url, 10)
    settle(page, 2)


def delete_tds_item(page):
    """Delete the open TDS Item through its confirm dialog; returns once the page has left the item."""
    page.get_by_role("button", name="Delete TDS Item").click()
    dlg = page.locator('[role="alertdialog"]')
    dlg.wait_for(timeout=5000)
    dlg.get_by_role("button", name="Delete", exact=True).click()
    wait_for(lambda: ITEM_PAGE not in page.url, 15)
    settle(page, 2)


@case(22, "Repository item page: no Back button; header back and delete keep the table view (#1384)")
def c22(w: Walk, page, c: Checks):
    # Two throwaway TDS Items with no entries, so Delete is enabled on them.
    names = w.be('''
R["names"] = [frappe.get_doc({"doctype": "TDS Items", "tds_item_name": n, "work_package": P["wp"]}).insert(ignore_permissions=True).name
              for n in P["labels"]]
frappe.db.commit()''', labels=["TDS WALK Delete A", "TDS WALK Delete B"], wp=WP)["names"]
    w.seen_names.update(names)
    try:
        # ── header back keeps the view: tab, column filter, search, page ──
        page.goto(f"{BASE}/tds-repository")
        settle(page, 2)
        page.get_by_role("button", name="Repository Entries", exact=True).click()
        settle(page, 2)
        table = page.locator("table").first
        th = table.locator("thead th").filter(has_text="Work Package").first
        th.locator("div.cursor-pointer").first.click()
        time.sleep(1.5)
        page.locator("[cmdk-item]").filter(has_text=WP).first.click()
        time.sleep(1.5)
        page.keyboard.press("Escape")
        settle(page, 2)
        search = page.locator('input[placeholder^="Search by"]').first
        search.fill("a")
        settle(page, 2)
        nxt = page.get_by_role("button", name="Go to next page")
        if nxt.count() and nxt.first.is_enabled():
            nxt.first.click()
            settle(page, 2)
        else:
            c.note("one page of matches only; the page step was not exercised")
        before_url = page.url
        before_rows = table.locator("tbody tr").all_inner_texts()
        c.check(all(k in before_url for k in ("tab=entries", "tds_entries_master_filters", "tds_entries_master_q")),
                "the view is in the URL before opening an item", before_url)
        w.shot(page, "c22_entries_view", full=True)
        open_tds_item_from_table(page)
        body = page.locator("body").inner_text()
        c.check("Back to TDS Repository" not in body, "item page has no 'Back to TDS Repository' button")
        w.shot(page, "c22_item_no_back")
        page.locator(GO_BACK).click()
        wait_for(lambda: ITEM_PAGE not in page.url, 10)
        settle(page, 3)
        c.eq(page.url, before_url, "header back returns to the same URL")
        c.eq(page.locator('input[placeholder^="Search by"]').first.input_value(), "a", "search term kept")
        c.eq(page.locator("table").first.locator("tbody tr").all_inner_texts(), before_rows, "same rows shown")
        w.shot(page, "c22_back_view", full=True)

        # ── delete from a searched table lands back on that view ──
        page.goto(f"{BASE}/tds-repository")
        settle(page, 2)
        page.locator('input[placeholder^="Search by"]').first.fill("TDS WALK Delete")
        settle(page, 3)
        before_url = page.url
        c.check("tds_items_master_q" in before_url, "TDS Items search is in the URL", before_url)
        open_tds_item_from_table(page, "TDS WALK Delete A")
        delete_tds_item(page)
        c.eq(page.url, before_url, "delete from the table returns to the searched view")
        rows = page.locator("table").first.locator("tbody tr").all_inner_texts()
        c.check(not any("TDS WALK Delete A" in r for r in rows), "the deleted item is gone from the table", rows)
        w.shot(page, "c22_after_delete_from_table", full=True)

        # ── delete from a direct URL lands on the plain repository page ──
        page.goto(f"{BASE}{ITEM_PAGE}{names[1]}")
        settle(page, 3)
        delete_tds_item(page)
        c.eq(page.url.split("?")[0].rstrip("/"), f"{BASE}/tds-repository", "direct-URL delete lands on the repository")
        c.check("?" not in page.url, "and with no saved view", page.url)
        gone = w.be('R["left"] = frappe.get_all("TDS Items", filters={"name": ["in", P["names"]]}, pluck="name")', names=names)
        c.eq(gone["left"], [], "both throwaway items deleted on the server")

        # ── not found keeps a plain link to the repository ──
        page.goto(f"{BASE}{ITEM_PAGE}TDS-ITEM-WALK-MISSING")
        settle(page, 3)
        body = page.locator("body").inner_text()
        c.check("Back to TDS Repository" not in body, "not-found page has no Back button")
        link = page.get_by_role("link", name="Go to TDS Repository")
        c.check(link.count() == 1 and (link.get_attribute("href") or "").endswith("/tds-repository"),
                "not-found page links to the repository", link.count() and link.get_attribute("href"))
        w.shot(page, "c22_not_found")
    finally:
        # Raw delete of whatever the case did not delete itself: throwaway walk items with no
        # dependents, so there is no hook or derived field to recompute.
        w.be('for n in P["names"]: frappe.db.delete("TDS Items", n)\nfrappe.db.commit()', names=names)


def history_table(page):
    return page.locator("table").filter(has=page.locator("th", has_text="Status")).first


@case(23, "Create New Request is a button: the form replaces the tables, Back keeps the table's filter, a send returns to History")
def c23(w: Walk, page, c: Checks):
    w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid="RQ-001-WALK23", specs=[
        {"kind": "pick", "make": "Tapariya", "status": "Approved"},
        {"kind": "new_make", "make": "NR"},
    ])
    page.goto(f"{BASE}/projects/{PROJECT}?page=tdsrepository")
    settle(page, 3)
    if page.get_by_text("Continue your saved TDS request?").count():
        page.get_by_role("button", name="Start Fresh").click()
    tabs = [t.strip() for t in page.get_by_role("tab").all_inner_texts()]
    c.eq(tabs, ["TDS History"], "the tab row holds TDS History only")
    create = page.get_by_role("button", name="Create New Request")
    c.check(create.is_visible(), "Create New Request button on the tab row")
    table = history_table(page)
    wait_for(lambda: table.locator("tbody tr").filter(has_text="TDS WALK").count() >= 2, 15)

    # Filter to Pending, so the table has state worth keeping.
    th = table.locator("thead th").filter(has_text="Status").first
    th.locator("div.cursor-pointer").first.click()
    time.sleep(1)
    page.locator("[cmdk-item]").filter(has_text="Pending").first.click()
    time.sleep(2)
    page.keyboard.press("Escape")
    settle(page, 1)
    walk_rows = lambda: table.locator("tbody tr").filter(has_text="TDS WALK").all_inner_texts()
    before = walk_rows()
    c.check(not any("Tapariya" in r for r in before), "Pending filter drops the Approved row", before)

    create.click()
    settle(page, 1)
    back = page.get_by_role("button", name="Back to TDS History")
    c.check(back.is_visible(), "the form shows a Back control")
    c.check(page.get_by_role("button", name="Send For Approval").is_visible(), "the request form is shown")
    c.check(not table.is_visible() and not create.is_visible(), "the tab row and table are hidden while the form is open")
    w.shot(page, "c23_form", full=True)

    back.click()
    settle(page, 1)
    c.check(table.is_visible() and create.is_visible(), "Back returns to the table")
    c.eq(walk_rows(), before, "the table keeps its Pending filter")

    since = w.be('R["now"] = str(frappe.utils.now())')["now"]
    create.click()
    settle(page, 1)
    add_pick(page, "Locel")
    page.get_by_role("button", name="Send For Approval").click()
    c.check(wait_for(lambda: create.is_visible(), 30), "a send returns to TDS History")
    c.check(not back.is_visible(), "the form is hidden after the send")
    rows = w.be('R["rows"] = project_rows(P["since"])', since=since)["rows"]
    c.eq([(r["tds_make"], r["tds_status"]) for r in rows], [("Locel", "Pending")], "the send saved the pick")
    c.check(wait_for(lambda: any(re.search(r"\bLocel\b", r) for r in walk_rows()), 15),
            "the new row appears in TDS History", walk_rows())
    w.shot(page, "c23_after_send", full=True)


@case(24, "a saved draft answered from TDS History opens the request form")
def c24(w: Walk, page, c: Checks):
    # The walk's own context clears drafts on every load, so this case runs in a second context that
    # shares the login but not that script.
    ctx = w.ctx.browser.new_context(viewport={"width": 1440, "height": 900}, storage_state=w.ctx.storage_state())
    ctx.route(re.compile(r".*upload_file.*"), w._route_upload)
    p2 = ctx.new_page()
    try:
        open_new_request(p2)
        add_pick(p2, "Locel")
        c.eq(cart_rows(p2).count(), 1, "pick in the cart")
        c.check(wait_for(lambda: p2.evaluate(f"localStorage.getItem('{DRAFTS_KEY}')"), 10), "the cart is saved as a draft")
        p2.reload()
        settle(p2, 3)
        prompt = p2.get_by_text("Continue your saved TDS request?")
        c.check(wait_for(lambda: prompt.count(), 10), "the draft prompt opens on TDS History")
        c.check(p2.get_by_role("button", name="Create New Request").is_visible(), "the prompt is answered from TDS History")
        w.shot(p2, "c24_prompt")
        p2.get_by_role("button", name="Continue").click()
        settle(p2, 1)
        c.check(p2.get_by_role("button", name="Back to TDS History").is_visible(), "resuming shows the request form")
        c.eq(cart_rows(p2).count(), 1, "the resumed cart holds the saved pick")
        w.shot(p2, "c24_resumed", full=True)
    finally:
        try:
            p2.evaluate(f"localStorage.removeItem('{DRAFTS_KEY}')")
        except Exception:
            pass
        ctx.close()


# ─── Client Status (#1385) ───────────────────────────────────────────────────────────────────────

CLIENT_APPROVED, CLIENT_REJECTED = "Approved by Client", "Rejected by Client"
TAB_LABELS = {"history": "TDS History", "approvedByClient": CLIENT_APPROVED, "rejectedByClient": CLIENT_REJECTED}


def open_history_page(page):
    page.goto(f"{BASE}/projects/{PROJECT}?page=tdsrepository")
    settle(page, 2)
    if page.get_by_text("Continue your saved TDS request?").count():
        page.get_by_role("button", name="Start Fresh").click()
        time.sleep(1)


def open_history_tab(page, tab):
    page.get_by_role("tab", name=re.compile("^" + re.escape(TAB_LABELS[tab]))).click()
    settle(page, 1.5)


def history_table(page):
    return page.locator("table").filter(has=page.locator("th", has_text="Status")).first


def walk_row(page, make):
    """The active tab's row for the walk's TDS Item in `make`."""
    return history_table(page).locator("tbody tr").filter(has_text=ITEM_NAME).filter(
        has=page.locator(f"span:text-is('{make}')")).first


def walk_makes(page):
    return [m for r in history_table(page).locator("tbody tr").filter(has_text=ITEM_NAME).all()
            for m in [r.locator("span.inline-flex").first.inner_text().strip()]]


def ui_tab_counts(page):
    return {t: int(page.get_by_test_id(f"tds-tab-count-{t}").inner_text().strip() or -1) for t in TAB_LABELS}


def db_tab_counts(w):
    return w.be('''
base = {"tdsi_project_id": PROJECT}
R["history"] = frappe.db.count(ROW, {**base, "client_status": ["is", "not set"]})
R["approvedByClient"] = frappe.db.count(ROW, {**base, "client_status": "Approved by Client"})
R["rejectedByClient"] = frappe.db.count(ROW, {**base, "client_status": "Rejected by Client"})
R["total"] = frappe.db.count(ROW, base)''')


def client_fields(w, names):
    return w.be('''
R["rows"] = {n: frappe.db.get_value(ROW, n, ["tds_status", "client_status", "client_status_by", "client_status_on",
    "client_rejection_reason"], as_dict=True) for n in P["names"]}''', names=names)["rows"]


def tick(page, make):
    walk_row(page, make).get_by_role("checkbox").click()
    time.sleep(0.3)


@case(27, "Client Status tabs: counts match the database, every row in one tab, ticks only on Admin-approved rows")
def c27(w: Walk, page, c: Checks):
    w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid="RQ-001-WALK27", specs=[
        {"kind": "pick", "make": "Locel"},
        {"kind": "pick", "make": "Tapariya", "status": "Approved"},
        {"kind": "new_make", "make": "Jogger", "status": "Rejected", "reason": "walk"},
        {"kind": "new_make", "make": "Value", "status": "Approved", "client_status": CLIENT_APPROVED},
        {"kind": "new_make", "make": "Nerolac", "status": "Approved", "client_status": CLIENT_REJECTED,
         "client_reason": "walk: wrong colour"},
    ])
    open_history_page(page)
    tabs = [t.strip() for t in page.get_by_role("tab").all_inner_texts()]
    c.check([re.sub(r"\s*\d+$", "", t) for t in tabs] == list(TAB_LABELS.values()),
            "tabs read TDS History | Approved by Client | Rejected by Client", tabs)
    db = db_tab_counts(w)
    ui = wait_for(lambda: (lambda u: u if u == {t: db[t] for t in TAB_LABELS} else None)(ui_tab_counts(page)), 10) \
        or ui_tab_counts(page)
    c.eq(ui, {t: db[t] for t in TAB_LABELS}, "each tab's count matches the database")
    c.eq(sum(db[t] for t in TAB_LABELS), db["total"], "every project row is in exactly one tab")

    wait_for(lambda: len(walk_makes(page)) >= 3, 15)
    c.eq(sorted(walk_makes(page)), ["Jogger", "Locel", "Tapariya"], "TDS History holds the rows the client hasn't answered")
    for make, enabled in (("Tapariya", True), ("Locel", False), ("Jogger", False)):
        box = walk_row(page, make).get_by_role("checkbox")
        c.eq(box.is_enabled(), enabled, f"{make} tick box enabled")
    c.check(page.get_by_role("button", name="Export", exact=True).is_disabled(), "Export is disabled with nothing ticked")
    headers = headers_of(history_table(page))
    c.check("CLIENT STATUS" not in headers, "TDS History hides the Client Status columns", headers)
    w.shot(page, "c27_history", full=True)

    open_history_tab(page, "approvedByClient")
    wait_for(lambda: walk_makes(page), 10)
    c.eq(walk_makes(page), ["Value"], "Approved by Client tab holds the client-approved row")
    table = history_table(page)
    headers = headers_of(table)
    c.check({"CLIENT STATUS", "MARKED BY", "MARKED ON"} <= set(headers), "client tab shows Client Status, Marked By, Marked On", headers)
    c.check("CLIENT'S REASON" not in headers, "Approved by Client tab has no reason column", headers)
    status, by, on = column_values(table, walk_row(page, "Value"), "Client Status", "Marked By", "Marked On")
    c.eq(status, CLIENT_APPROVED, "Value row's Client Status")
    c.check(by and by != "-", "Marked By is filled", by)
    c.check(on and re.match(r"\d{2}-[A-Z][a-z]{2}-\d{4}", on), "Marked On reads dd-MMM-yyyy", on)
    w.shot(page, "c27_approved_by_client", full=True)

    open_history_tab(page, "rejectedByClient")
    wait_for(lambda: walk_makes(page), 10)
    c.eq(walk_makes(page), ["Nerolac"], "Rejected by Client tab holds the client-rejected row")
    table = history_table(page)
    status, reason = column_values(table, walk_row(page, "Nerolac"), "Client Status", "Client's Reason")
    c.eq(status, CLIENT_REJECTED, "Nerolac row's Client Status")
    c.eq(reason, "walk: wrong colour", "Rejected by Client tab shows the client's reason")
    w.shot(page, "c27_rejected_by_client", full=True)


@case(28, "mark ticked rows Approved by Client: toolbar, stamps, the rows move tab; Pending refused on the server")
def c28(w: Walk, page, c: Checks):
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid="RQ-001-WALK28", specs=[
        {"kind": "pick", "make": "Tapariya", "status": "Approved"},
        {"kind": "pick", "make": "Locel", "status": "Approved"},
        {"kind": "new_make", "make": "Jogger"},
    ])["rows"]
    names = {r["make"]: r["name"] for r in rows}
    open_history_page(page)
    wait_for(lambda: len(walk_makes(page)) >= 3, 15)
    before = ui_tab_counts(page)
    tick(page, "Tapariya")
    tick(page, "Locel")
    bar = page.get_by_test_id("tds-selection-toolbar")
    c.check("2 selected" in bar.inner_text(), "toolbar reads 2 selected", bar.inner_text())
    c.check(bar.get_by_role("button", name="Clear").is_visible(), "toolbar has a Clear link")
    c.check(page.get_by_role("button", name="Export", exact=True).is_enabled(), "Export is enabled with ticks")
    w.shot(page, "c28_ticked")
    bar.get_by_role("button", name="Mark Approved by Client").click()
    c.check("marked" in wait_toast(page, "marked").lower(), "a toast confirms the mark", toasts(page))
    settle(page, 1.5)

    stored = client_fields(w, [names["Tapariya"], names["Locel"], names["Jogger"]])
    for make in ("Tapariya", "Locel"):
        row = stored[names[make]]
        c.eq(row["client_status"], CLIENT_APPROVED, f"{make} stored Client Status")
        c.eq(row["client_status_by"], USER, f"{make} marked by the walk user")
        c.check(row["client_status_on"], f"{make} carries a Marked On", row)
        c.eq(row["tds_status"], "Approved", f"{make} tds_status unchanged")
    c.check(not stored[names["Jogger"]]["client_status"], "the Pending row was not marked", stored[names["Jogger"]])
    wait_for(lambda: walk_makes(page) == ["Jogger"], 10)
    c.eq(walk_makes(page), ["Jogger"], "the marked rows left TDS History")
    after = wait_for(lambda: (lambda u: u if u["approvedByClient"] == before["approvedByClient"] + 2 else None)(ui_tab_counts(page)), 10) \
        or ui_tab_counts(page)
    c.eq(after["approvedByClient"], before["approvedByClient"] + 2, "Approved by Client count went up by 2")
    c.eq(after["history"], before["history"] - 2, "TDS History count went down by 2")
    open_history_tab(page, "approvedByClient")
    wait_for(lambda: len(walk_makes(page)) >= 2, 10)
    c.eq(sorted(walk_makes(page)), ["Locel", "Tapariya"], "both rows are in the Approved by Client tab")
    w.shot(page, "c28_approved_tab", full=True)

    res = w.be('''
from nirmaan_stack.api.tds.client_status import set_client_status
R["reply"] = set_client_status([P["n"]], "mark_approved")
frappe.db.rollback()''', n=names["Jogger"])
    c.eq(res["reply"]["updated"], 0, "the server marks no Pending row")
    c.check(any("Admin-approved" in e["error"] for e in res["reply"]["errors"]), "the server names the refusal",
            res["reply"]["errors"])


@case(29, "mark ticked rows Rejected by Client: the popup lists them, the reason lands on every row")
def c29(w: Walk, page, c: Checks):
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid="RQ-001-WALK29", specs=[
        {"kind": "pick", "make": "Tapariya", "status": "Approved"},
        {"kind": "pick", "make": "Locel", "status": "Approved"},
    ])["rows"]
    names = {r["make"]: r["name"] for r in rows}
    open_history_page(page)
    wait_for(lambda: len(walk_makes(page)) >= 2, 15)
    tick(page, "Tapariya")
    bar = page.get_by_test_id("tds-selection-toolbar")
    bar.get_by_role("button", name="Clear").click()
    time.sleep(0.5)
    c.eq(page.get_by_test_id("tds-selection-toolbar").count(), 0, "Clear unticks every row")

    tick(page, "Tapariya")
    tick(page, "Locel")
    page.get_by_test_id("tds-selection-toolbar").get_by_role("button", name="Mark Rejected by Client").click()
    dlg = page.get_by_role("dialog")
    dlg.wait_for(timeout=5000)
    listed = dlg.get_by_test_id("client-reject-rows").inner_text()
    c.check("Tapariya" in listed and "Locel" in listed, "the popup lists both rows", listed)
    c.check("can't be deleted" in dlg.inner_text(), "the popup warns the rows can't be deleted", dlg.inner_text())
    dlg.get_by_label("Client's reason (optional)").fill("walk: client wants a UL-listed make")
    w.shot(page, "c29_popup")
    dlg.get_by_role("button", name="Mark Rejected by Client").click()
    c.check("marked" in wait_toast(page, "marked").lower(), "a toast confirms the mark", toasts(page))
    settle(page, 1.5)

    stored = client_fields(w, list(names.values()))
    for make, n in names.items():
        c.eq(stored[n]["client_status"], CLIENT_REJECTED, f"{make} stored Client Status")
        c.eq(stored[n]["client_rejection_reason"], "walk: client wants a UL-listed make", f"{make} stored reason")
        c.eq(stored[n]["client_status_by"], USER, f"{make} marked by the walk user")
    open_history_tab(page, "rejectedByClient")
    wait_for(lambda: len(walk_makes(page)) >= 2, 10)
    c.eq(sorted(walk_makes(page)), ["Locel", "Tapariya"], "both rows are in the Rejected by Client tab")
    reason = column_values(history_table(page), walk_row(page, "Locel"), "Client's Reason")[0]
    c.eq(reason, "walk: client wants a UL-listed make", "the tab shows the client's reason")
    db = db_tab_counts(w)
    c.eq(ui_tab_counts(page), {t: db[t] for t in TAB_LABELS}, "tab counts match the database after the mark")
    w.shot(page, "c29_rejected_tab", full=True)


OLD_STAMP = "2026-01-01 10:00:00"


@case(30, "switch ticked rows between Approved and Rejected by Client: fresh stamps, the reason popup, the reason blanked (#1386)")
def c30(w: Walk, page, c: Checks):
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid="RQ-001-WALK30", specs=[
        {"kind": "pick", "make": "Tapariya", "status": "Approved", "client_status": CLIENT_APPROVED,
         "client_status_on": OLD_STAMP},
        {"kind": "pick", "make": "Locel", "status": "Approved", "client_status": CLIENT_REJECTED,
         "client_status_on": OLD_STAMP, "client_reason": "walk: old reason"},
    ])["rows"]
    names = {r["make"]: r["name"] for r in rows}
    open_history_page(page)

    open_history_tab(page, "approvedByClient")
    wait_for(lambda: "Tapariya" in walk_makes(page), 10)
    tick(page, "Tapariya")
    bar = page.get_by_test_id("tds-selection-toolbar")
    switch = bar.get_by_role("button", name="Switch to Rejected by Client", exact=True)
    c.check(switch.is_visible(), "Approved by Client tab offers Switch to Rejected by Client", bar.inner_text())
    c.eq(bar.get_by_role("button", name=re.compile("^Mark ")).count(), 0, "no Mark buttons on a client tab")
    w.shot(page, "c30_switch_toolbar")
    switch.click()
    dlg = page.get_by_role("dialog")
    dlg.wait_for(timeout=5000)
    c.check("Tapariya" in dlg.get_by_test_id("client-reject-rows").inner_text(), "the same reason popup lists the row")
    dlg.get_by_label("Client's reason (optional)").fill("walk: client changed their mind")
    dlg.get_by_role("button", name="Mark Rejected by Client").click()
    c.check("marked" in wait_toast(page, "marked").lower(), "a toast confirms the switch", toasts(page))
    settle(page, 1.5)
    dismiss_toasts(page)

    open_history_tab(page, "rejectedByClient")
    wait_for(lambda: "Locel" in walk_makes(page), 10)
    tick(page, "Locel")
    bar = page.get_by_test_id("tds-selection-toolbar")
    switch = bar.get_by_role("button", name="Switch to Approved by Client", exact=True)
    c.check(switch.is_visible(), "Rejected by Client tab offers Switch to Approved by Client", bar.inner_text())
    switch.click()
    c.check("marked" in wait_toast(page, "marked").lower(), "a toast confirms the switch", toasts(page))
    settle(page, 1.5)

    stored = client_fields(w, list(names.values()))
    tap, loc = stored[names["Tapariya"]], stored[names["Locel"]]
    c.eq(tap["client_status"], CLIENT_REJECTED, "Tapariya switched to Rejected by Client")
    c.eq(tap["client_rejection_reason"], "walk: client changed their mind", "Tapariya stores the new reason")
    c.eq(loc["client_status"], CLIENT_APPROVED, "Locel switched to Approved by Client")
    c.check(not loc["client_rejection_reason"], "the switch to Approved by Client blanked the reason", loc)
    for make, row in (("Tapariya", tap), ("Locel", loc)):
        c.eq(row["client_status_by"], USER, f"{make} Marked By is the walk user")
        c.check(str(row["client_status_on"]) > OLD_STAMP, f"{make} Marked On is fresh", row["client_status_on"])
        c.eq(row["tds_status"], "Approved", f"{make} tds_status unchanged")

    wait_for(lambda: walk_makes(page) == ["Tapariya"], 10)
    c.eq(walk_makes(page), ["Tapariya"], "Rejected by Client tab now holds Tapariya only")
    open_history_tab(page, "approvedByClient")
    wait_for(lambda: walk_makes(page) == ["Locel"], 10)
    c.eq(walk_makes(page), ["Locel"], "Approved by Client tab now holds Locel only")
    db = db_tab_counts(w)
    c.eq(ui_tab_counts(page), {t: db[t] for t in TAB_LABELS}, "tab counts match the database after the switch")
    w.shot(page, "c30_switched", full=True)


@case(31, "an Admin clears Client Status: all four fields blank, the rows back in TDS History; a PMO is refused (#1386)")
def c31(w: Walk, page, c: Checks):
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid="RQ-001-WALK31", specs=[
        {"kind": "pick", "make": "Tapariya", "status": "Approved", "client_status": CLIENT_APPROVED},
        {"kind": "pick", "make": "Locel", "status": "Approved", "client_status": CLIENT_REJECTED,
         "client_reason": "walk: wrong colour"},
    ])["rows"]
    names = {r["make"]: r["name"] for r in rows}

    # The walk user is an Admin, so the PMO's missing Clear button is pinned by vitest
    # (clientStatusActionsFor); the server's refusal is checked here as a real PMO user.
    res = w.be('''
from nirmaan_stack.api.tds.client_status import set_client_status
pmo = frappe.db.get_value("User", {"role_profile_name": "Nirmaan PMO Executive Profile", "enabled": 1}, "name")
R["pmo"] = pmo
if pmo:
    frappe.set_user(pmo)
    try:
        set_client_status([P["n"]], "clear")
        R["refused"] = False
    except frappe.PermissionError as e:
        R["refused"] = str(e)
    frappe.set_user("Administrator")
    frappe.db.rollback()''', n=names["Locel"])
    if res["pmo"]:
        c.check(res["refused"], f"the server refuses Clear from a PMO Executive ({res['pmo']})", res["refused"])
        c.eq(client_fields(w, [names["Locel"]])[names["Locel"]]["client_status"], CLIENT_REJECTED,
             "the refused Clear changed nothing")
    else:
        c.note("no enabled PMO Executive user on this site; the server's Clear refusal is covered by test_client_status")

    open_history_page(page)
    for tab, make in (("approvedByClient", "Tapariya"), ("rejectedByClient", "Locel")):
        open_history_tab(page, tab)
        wait_for(lambda: make in walk_makes(page), 10)
        tick(page, make)
        bar = page.get_by_test_id("tds-selection-toolbar")
        clear = bar.get_by_role("button", name="Clear Client Status", exact=True)
        c.check(clear.is_visible(), f"{TAB_LABELS[tab]} tab offers an Admin Clear Client Status", bar.inner_text())
        w.shot(page, f"c31_{tab}_toolbar")
        clear.click()
        c.check("cleared" in wait_toast(page, "cleared").lower(), f"a toast confirms the clear on {TAB_LABELS[tab]}",
                toasts(page))
        settle(page, 1.5)
        wait_for(lambda: make not in walk_makes(page), 10)
        c.check(make not in walk_makes(page), f"{make} left the {TAB_LABELS[tab]} tab", walk_makes(page))
        dismiss_toasts(page)

    stored = client_fields(w, list(names.values()))
    for make, n in names.items():
        row = stored[n]
        c.check(not any(row[f] for f in ("client_status", "client_status_by", "client_status_on", "client_rejection_reason")),
                f"{make}: all four client fields blank", row)
        c.eq(row["tds_status"], "Approved", f"{make} tds_status unchanged")

    open_history_tab(page, "history")
    wait_for(lambda: {"Tapariya", "Locel"} <= set(walk_makes(page)), 10)
    c.check({"Tapariya", "Locel"} <= set(walk_makes(page)), "both rows are back in TDS History", walk_makes(page))
    table = history_table(page)
    for make in ("Tapariya", "Locel"):
        c.eq(column_values(table, walk_row(page, make), "Status")[0], "Approved by Admin", f"{make} reads Approved by Admin")
    db = db_tab_counts(w)
    c.eq(ui_tab_counts(page), {t: db[t] for t in TAB_LABELS}, "tab counts match the database after the clear")
    w.shot(page, "c31_cleared", full=True)


# ─── #1389: a Make the client rejected ─────────────────────────────────────────────────────────

CLIENT_REJECTED_TAG = "tds-make-client-rejected-tag"
CLIENT_REJECTED_POPUP = "tds-client-rejected-make-dialog"


def seed_client_rejected(w: Walk, rid, extra=(), reason="walk: client wants another brand"):
    """Locel Admin-approved and Rejected by Client (marked by the walk user), plus `extra` specs."""
    return w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid=rid, specs=[
        {"kind": "pick", "make": "Locel", "status": "Approved", "client_status": CLIENT_REJECTED,
         "client_status_by": USER, "client_reason": reason},
        *extra,
    ])["rows"]


def open_make_menu(page):
    rs_pick(page, "Search TDS item...", ITEM_NAME)
    rs_input(page, "Select Make").click(force=True)
    time.sleep(0.8)


def make_placeholder_shows(page):
    return page.locator('div[id$="-placeholder"]:text-is("Select Make")').count() == 1


def server_refusal(w: Walk, make):
    """What `submit_tds_request` says to a direct call sending a pick of the walk item in `make`."""
    return w.be('''
from nirmaan_stack.api.tds.submit import submit_tds_request
try:
    submit_tds_request(PROJECT, json.dumps([{"tds_item_id": T, "make": P["make"], "tds_boq_line_item": ""}]))
    R["error"] = None
except frappe.ValidationError as e:
    R["error"] = str(e)
frappe.db.rollback()''', make=make)["error"]


@case(38, "a Make the client rejected reads Rejected by Client in the Make list, not (already submitted)")
def c38(w: Walk, page, c: Checks):
    rows = seed_client_rejected(w, "RQ-001-WALK38", extra=[{"kind": "pick", "make": "Tapariya"}])
    stored = client_fields(w, [rows[0]["name"]])[rows[0]["name"]]
    c.eq((stored["tds_status"], stored["client_status"]), ("Approved", CLIENT_REJECTED),
         "seeded Locel row is Admin-approved and Rejected by Client")
    open_new_request(page)
    open_make_menu(page)
    menu = menu_text(page)
    locel = options(page).filter(has_text="Locel").first
    tapariya = options(page).filter(has_text="Tapariya").first
    c.check(locel.get_by_test_id(CLIENT_REJECTED_TAG).count() == 1 and "Rejected by Client" in locel.inner_text(),
            "Locel shows the Rejected by Client tag", menu)
    c.check("already submitted" not in locel.inner_text().lower(), "Locel does not read (already submitted)", menu)
    c.check(tapariya.get_by_test_id(CLIENT_REJECTED_TAG).count() == 0 and "already submitted" in tapariya.inner_text().lower(),
            "a Pending make still reads (already submitted), with no tag", menu)
    w.shot(page, "c38_make_list")
    page.keyboard.press("Escape")


@case(39, "picking a Make the client rejected opens the popup; another make is added and sent; the server refuses the same make")
def c39(w: Walk, page, c: Checks):
    rid = "RQ-001-WALK39"
    reason = "walk: client wants Legrand on every floor"
    rows = seed_client_rejected(w, rid, reason=reason, extra=[
        {"kind": "custom", "name": CUSTOM_LAMP, "make": "Locel", "pcus": "PCUS-WALK39", "status": "Approved",
         "client_status": CLIENT_REJECTED, "client_status_by": USER, "client_reason": reason},
    ])
    full_name = w.be('R["n"] = frappe.db.get_value("Nirmaan Users", P["u"], "full_name")', u=USER)["n"] or USER

    open_new_request(page)
    rs_pick(page, "Search TDS item...", ITEM_NAME)
    rs_pick(page, "Select Make", "Locel")
    dlg = page.get_by_test_id(CLIENT_REJECTED_POPUP)
    if c.check(wait_for(lambda: dlg.count(), 8), "picking Locel opens the Rejected by Client popup"):
        text = dlg.inner_text()
        flat = text.replace("\n", " / ")[:400]
        c.check(all(s in text for s in (ITEM_NAME, "Locel", rid, reason, full_name)),
                "popup names the item, make, request id, who marked it and the client's reason", flat)
        c.check(re.search(r"\d{2}-[A-Z][a-z]{2}-\d{4}", text), "popup shows when it was marked (dd-MMM-yyyy)", flat)
        c.check("Pick a different make" in text and "switch that row to Approved by Client" in text,
                "popup explains the two ways out", flat)
        c.check(dlg.get_by_role("button", name="Open Rejected by Client tab").count() == 1,
                "popup offers Open Rejected by Client tab")
        w.shot(page, "c39_popup")
        dlg.get_by_role("button", name="Pick another make").click()
        time.sleep(0.5)
    c.eq(dlg.count(), 0, "Pick another make closes the popup")
    c.check(make_placeholder_shows(page), "the rejected make is not selected")
    c.eq(cart_rows(page).count(), 0, "nothing reached the cart")

    add_custom(w, page, "tds walk CUSTOM lamp ", "Locel")
    c.check(wait_for(lambda: dlg.count(), 8), "a Project Custom name + make the client rejected opens the popup too")
    if dlg.count():
        c.check(CUSTOM_LAMP in dlg.inner_text(), "the popup names the Project Custom row", dlg.inner_text()[:200])
        w.shot(page, "c39_popup_custom")
        dlg.get_by_role("button", name="Pick another make").click()
        time.sleep(0.5)
    c.eq(cart_rows(page).count(), 0, "the Project Custom clash did not reach the cart")

    since = w.be('R["now"] = str(frappe.utils.now())')["now"]
    rs_pick(page, "Select Make", "Tapariya")
    page.get_by_role("button", name="Add item").click()
    time.sleep(1)
    c.eq(cart_rows(page).count(), 1, "another make of the item is added")
    page.get_by_role("button", name="Send For Approval").click()
    wait_for(lambda: cart_rows(page).count() == 0, 30)
    new = w.be('R["new"] = project_rows(P["since"])', since=since)["new"]
    c.eq([(r["tds_make"], r["tds_status"]) for r in new], [("Tapariya", "Pending")], "the other make is sent and saved Pending")
    stored = client_fields(w, [r["name"] for r in rows])
    c.check(all(s["client_status"] == CLIENT_REJECTED and s["tds_status"] == "Approved" for s in stored.values()),
            "the Rejected by Client rows are untouched", stored)

    error = server_refusal(w, "Locel")
    c.check(error and "Rejected by Client" in error and rid in error and "Pick another make" in error,
            "a direct submit of the same item + make is refused with the Rejected by Client message", error)


@case(40, "the popup's Open Rejected by Client tab leaves the form for that tab")
def c40(w: Walk, page, c: Checks):
    seed_client_rejected(w, "RQ-001-WALK40")
    open_new_request(page)
    rs_pick(page, "Search TDS item...", ITEM_NAME)
    rs_pick(page, "Select Make", "Locel")
    dlg = page.get_by_test_id(CLIENT_REJECTED_POPUP)
    if not c.check(wait_for(lambda: dlg.count(), 8), "picking Locel opens the popup"):
        return
    dlg.get_by_role("button", name="Open Rejected by Client tab").click()
    settle(page, 1.5)
    c.eq(dlg.count(), 0, "the popup closes")
    c.check(not page.get_by_role("button", name="Back to TDS History").is_visible(), "the request form is hidden")
    tab = page.get_by_role("tab", name=re.compile("^" + re.escape(CLIENT_REJECTED)))
    c.eq(tab.get_attribute("aria-selected"), "true", "the Rejected by Client tab is the active tab")
    wait_for(lambda: walk_makes(page), 10)
    c.eq(walk_makes(page), ["Locel"], "the tab lists the client-rejected row")
    db = db_tab_counts(w)
    c.eq(ui_tab_counts(page), {t: db[t] for t in TAB_LABELS}, "tab counts match the database")
    w.shot(page, "c40_rejected_tab", full=True)


# ─── #1387: a row the client has answered is locked against delete ───────────────────────────────

LOCKED_MARKER = "tds-row-locked"
DELETE_BUTTON = "tds-row-delete"

# A direct REST delete from the logged-in browser, the path the Locked marker can't stop.
REST_DELETE_JS = """async (name) => {
  const r = await fetch(`/api/resource/Project TDS Item List/${encodeURIComponent(name)}`,
    {method: "DELETE", headers: {"X-Frappe-CSRF-Token": window.csrf_token || ""}});
  return {status: r.status, body: await r.text()};
}"""


def seed_answered(w: Walk, rid):
    """Value Approved by Client, Nerolac Rejected by Client (with a reason), Tapariya Admin-approved only."""
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid=rid, specs=[
        {"kind": "new_make", "make": "Value", "status": "Approved", "client_status": CLIENT_APPROVED},
        {"kind": "new_make", "make": "Nerolac", "status": "Approved", "client_status": CLIENT_REJECTED,
         "client_reason": "walk: wrong colour"},
        {"kind": "pick", "make": "Tapariya", "status": "Approved"},
    ])["rows"]
    return {r["make"]: r["name"] for r in rows}


@case(32, "client tabs show Locked instead of a delete button; a direct REST delete is refused and the row is unchanged")
def c32(w: Walk, page, c: Checks):
    names = seed_answered(w, "RQ-001-WALK32")
    answered = [names["Value"], names["Nerolac"]]
    before = client_fields(w, answered)
    open_history_page(page)
    wait_for(lambda: "Tapariya" in walk_makes(page), 15)
    row = walk_row(page, "Tapariya")
    c.eq(row.get_by_test_id(DELETE_BUTTON).count(), 1, "an unanswered row keeps its delete button")
    c.eq(row.get_by_test_id(LOCKED_MARKER).count(), 0, "an unanswered row shows no Locked marker")

    for tab, make in (("approvedByClient", "Value"), ("rejectedByClient", "Nerolac")):
        open_history_tab(page, tab)
        wait_for(lambda: make in walk_makes(page), 10)
        row = walk_row(page, make)
        marker = row.get_by_test_id(LOCKED_MARKER)
        c.eq(row.get_by_test_id(DELETE_BUTTON).count(), 0, f"{TAB_LABELS[tab]}: {make} has no delete button")
        if c.check(marker.count() == 1, f"{TAB_LABELS[tab]}: {make} shows the Locked marker"):
            c.eq(marker.inner_text().strip(), "Locked", f"{make} marker text")
            marker.hover()
            tip = wait_for(lambda: page.get_by_role("tooltip").count() and page.get_by_role("tooltip").first.inner_text(), 5)
            c.check(tip and "Admin must clear its Client Status" in tip, f"{make} tooltip explains the lock", tip)
        w.shot(page, f"c32_{tab}_locked", full=True)

    for make in ("Value", "Nerolac"):
        res = page.evaluate(REST_DELETE_JS, names[make])
        c.check(res["status"] >= 400, f"REST delete of {make} is refused", res["status"])
        c.check("Client Status" in res["body"], f"the refusal for {make} names the Client Status", res["body"][:300])
    c.eq(client_fields(w, answered), before, "both answered rows are unchanged in the database")

    res = w.be('''
from nirmaan_stack.api.tds.approve import reject_tds_items
R["reply"] = reject_tds_items([P["n"]], reason="walk")
R["status"] = frappe.db.get_value(ROW, P["n"], "tds_status")
frappe.db.rollback()''', n=names["Value"])
    c.eq(res["reply"]["rejected"], 0, "an Admin reject of the client-approved row rejects nothing")
    c.check(any("waiting for approval" in e["error"] for e in res["reply"]["errors"]), "the reject refusal says why",
            res["reply"]["errors"])
    c.eq(res["status"], "Approved", "the client-approved row stays Approved")


@case(33, "after an Admin clears the Client Status, the row is back in TDS History and its delete works")
def c33(w: Walk, page, c: Checks):
    names = seed_answered(w, "RQ-001-WALK33")
    res = w.be('''
from nirmaan_stack.api.tds.client_status import set_client_status
frappe.set_user("Administrator")
R["reply"] = set_client_status([P["n"]], "clear")''', n=names["Nerolac"])
    c.eq(res["reply"]["updated"], 1, "the Admin clear lands")
    open_history_page(page)
    wait_for(lambda: "Nerolac" in walk_makes(page), 15)
    row = walk_row(page, "Nerolac")
    c.eq(row.get_by_test_id(LOCKED_MARKER).count(), 0, "the cleared row is no longer Locked")
    button = row.get_by_test_id(DELETE_BUTTON)
    if not c.check(button.count() == 1, "the cleared row has its delete button back"):
        return
    button.click()
    page.get_by_role("alertdialog").get_by_role("button", name="Delete").click()
    c.check("deleted" in wait_toast(page, "Deleted").lower(), "a toast confirms the delete", toasts(page))
    settle(page, 1.5)
    gone = w.be('R["exists"] = bool(frappe.db.exists(ROW, P["n"]))', n=names["Nerolac"])
    c.eq(gone["exists"], False, "the cleared row is deleted on the server")
    c.check("Nerolac" not in walk_makes(page), "the row left TDS History", walk_makes(page))
    c.eq(client_fields(w, [names["Value"]])[names["Value"]]["client_status"], CLIENT_APPROVED,
         "the other answered row is untouched")
    w.shot(page, "c33_after_delete", full=True)


# ─── Download TDS PDF dialog (#1388) ─────────────────────────────────────────────────────────────

PDF_CLIENT, PDF_ADMIN, PDF_PENDING = "Approved by Client", "Approved by Admin", "Pending"
PDF_STATUSES = (PDF_CLIENT, PDF_ADMIN, PDF_PENDING)
PREVIEW_NOTE = "Pending is ticked, so you can preview this PDF but only an Admin can download it."
PMO_PROFILE = "Nirmaan PMO Executive Profile"

# The dialog's item list as [status band, package band, row name] per <tr>, in screen order.
PDF_LIST_JS = """t => [...t.querySelectorAll('tbody tr')].map(r =>
    [r.dataset.pdfGroup || '', r.dataset.pdfGroupPackage || '', r.dataset.pdfRow || ''])"""

# The PDF status each stored row prints under, worked out in SQL terms, the way `pdfStatusOf` does.
PDF_BUCKET_PY = '''
def bucket(r):
    if r.client_status == "Approved by Client": return "Approved by Client"
    if r.client_status == "Rejected by Client": return None
    if r.tds_status == "Approved": return "Approved by Admin"
    if r.tds_status in ("Pending", "New"): return "Pending"
    return None
'''


def open_pdf_dialog(page):
    open_history_page(page)
    page.get_by_role("button", name="Download TDS PDF").click()
    d = page.get_by_role("dialog")
    d.wait_for(timeout=10000)
    time.sleep(2)
    return d


def pdf_db_counts(w):
    """How many project rows each PDF status holds, from the database."""
    return w.be(PDF_BUCKET_PY + '''
R = {"Approved by Client": 0, "Approved by Admin": 0, "Pending": 0}
for r in project_rows():
    b = bucket(r)
    if b: R[b] += 1''')


def pdf_buckets(w, names):
    return w.be(PDF_BUCKET_PY + '''
R["b"] = {r.name: bucket(r) for r in project_rows() if r.name in P["names"]}''', names=names)["b"]


def pdf_ticks(d, kind):
    """{choice: its tick number, or "" when unticked} for `status` or `package` options."""
    attr = f"data-pdf-{kind}"
    return {o.get_attribute(attr): o.get_attribute("data-tick") for o in d.locator(f"[{attr}]").all()}


def pdf_status_count(d, status):
    text = d.locator(f'[data-pdf-status="{status}"]').inner_text()
    m = re.search(r"(\d+) items", text)
    return int(m.group(1)) if m else -1


def pdf_toggle_status(d, status):
    d.locator(f'[data-pdf-status="{status}"]').click()
    time.sleep(0.5)


def pdf_toggle_package(d, pkg):
    d.locator(f'[data-pdf-package="{pkg}"]').click()
    time.sleep(0.5)


def pdf_list(d):
    """The item list as (status, package, row name), in screen order."""
    table = d.get_by_test_id("pdf-items")
    if not table.count():
        return []
    out, status, pkg = [], None, None
    for group, package, row in table.evaluate(PDF_LIST_JS):
        if group:
            status, pkg = group, None
        elif package:
            pkg = package
        elif row:
            out.append((status, pkg, row))
    return out


def pdf_row_texts(d):
    return [" | ".join(x.strip() for x in r.locator("td").all_inner_texts())
            for r in d.locator("tr[data-pdf-row]").all()]


def pdf_summary(d):
    """The print-order summary as (status, packages text), in order."""
    return [(line.get_attribute("data-print-line"), line.locator("span").last.inner_text().strip())
            for line in d.get_by_test_id("pdf-print-order").locator("[data-print-line]").all()]


def pdf_row_ticked(d, name):
    return d.locator(f'tr[data-pdf-row="{name}"] button[role="checkbox"]').get_attribute("data-state") == "checked"


def pdf_primary(d):
    """The footer's PDF button label, without its count."""
    for label in ("Preview PDF", "Download PDF"):
        if d.get_by_role("button", name=re.compile("^" + label)).count():
            return label
    return None


def seed(w, rid, specs):
    rows = w.be('R["rows"] = [seed_row(P["rid"], s) for s in P["specs"]]; frappe.db.commit()', rid=rid, specs=specs)["rows"]
    return {r["make"]: r["name"] for r in rows}


@case(34, "PDF dialog tick order: numbered Status and Package checklists, unticking renumbers, the list follows the ticks")
def c34(w: Walk, page, c: Checks):
    names = seed(w, "RQ-001-WALK34", [
        {"kind": "pick", "make": "Locel", "status": "Approved", "client_status": CLIENT_APPROVED},
        {"kind": "new_make", "make": "Jogger", "status": "Approved", "client_status": CLIENT_APPROVED, "package": "Plumbing"},
        {"kind": "new_make", "make": "Value", "status": "Approved", "package": "Plumbing"},
        {"kind": "pick", "make": "Tapariya", "package": "HVAC"},
        {"kind": "new_make", "make": "Nerolac", "status": "Approved", "client_status": CLIENT_REJECTED},
    ])
    ours = set(names.values())
    make_of = {n: m for m, n in names.items()}
    buckets = pdf_buckets(w, list(ours))
    c.eq(buckets[names["Nerolac"]], None, "the database row the client rejected has no PDF status")

    d = open_pdf_dialog(page)
    c.eq(pdf_ticks(d, "status"), {PDF_CLIENT: "1", PDF_ADMIN: "", PDF_PENDING: ""}, "the TDS page opens with only Approved by Client ticked")
    c.eq({s: pdf_status_count(d, s) for s in PDF_STATUSES}, pdf_db_counts(w), "each status's item count matches the database")

    pdf_toggle_status(d, PDF_PENDING)
    pdf_toggle_status(d, PDF_ADMIN)
    c.eq(pdf_ticks(d, "status"), {PDF_CLIENT: "1", PDF_ADMIN: "3", PDF_PENDING: "2"}, "statuses number in tick order")
    pdf_toggle_status(d, PDF_CLIENT)
    c.eq(pdf_ticks(d, "status"), {PDF_CLIENT: "", PDF_ADMIN: "2", PDF_PENDING: "1"}, "unticking renumbers the rest")

    offered = pdf_ticks(d, "package")
    c.check({"Plumbing", "HVAC"} <= set(offered), "the ticked statuses' packages are offered", offered)
    c.eq(list(offered), sorted(offered), "packages are offered A to Z")
    c.check("A to Z" in d.get_by_test_id("pdf-package-options").inner_text(), "the hint says none ticked means every package, A to Z")
    pdf_toggle_package(d, "Plumbing")
    pdf_toggle_package(d, "HVAC")
    ticks = pdf_ticks(d, "package")
    c.eq((ticks["Plumbing"], ticks["HVAC"]), ("1", "2"), "packages number in tick order")
    pdf_toggle_package(d, "Plumbing")
    pdf_toggle_package(d, "Plumbing")
    ticks = pdf_ticks(d, "package")
    c.eq((ticks["HVAC"], ticks["Plumbing"]), ("1", "2"), "unticking and re-ticking moves Plumbing last")
    w.shot(page, "c34_ticks")

    pdf_toggle_status(d, PDF_CLIENT)
    listed = [(s, p, make_of[n]) for s, p, n in pdf_list(d) if n in ours]
    c.eq(listed, [(PDF_PENDING, "HVAC", "Tapariya"), (PDF_ADMIN, "Plumbing", "Value"), (PDF_CLIENT, "Plumbing", "Jogger")],
         "the list runs status by tick order, then the ticked packages in tick order")
    for s, _, make in listed:
        c.eq(buckets[names[make]], s, f"{make} sits under the status its database row has")
    groups = [s for s, _, _ in pdf_list(d)]
    c.eq(list(dict.fromkeys(groups)), [s for s in (PDF_PENDING, PDF_ADMIN, PDF_CLIENT) if s in groups],
         "status bands appear once each, in tick order")

    d.get_by_role("button", name="Clear, use all packages").click()
    time.sleep(0.5)
    c.check(all(v == "" for v in pdf_ticks(d, "package").values()), "Clear unticks every package")
    rows = [n for _, _, n in pdf_list(d)]
    c.check(names["Locel"] in rows, "with no package ticked the Electrical Work row is back")
    c.check(names["Nerolac"] not in rows, "the Rejected by Client row is never listed")
    c.eq(len(rows), len(set(rows)), "no row is listed twice")
    w.shot(page, "c34_list", full=True)


@case(35, "PDF dialog print-order summary: matches the list and the export payload; the empty state ticks Approved by Admin")
def c35(w: Walk, page, c: Checks):
    if pdf_db_counts(w)[PDF_CLIENT]:
        c.note("the project already has Approved by Client rows, so the empty state is not reachable; skipped that part")
    else:
        seed(w, "RQ-001-WALK35A", [{"kind": "pick", "make": "Tapariya", "status": "Approved"}])
        d = open_pdf_dialog(page)
        empty = d.get_by_test_id("pdf-empty-client")
        c.check(empty.count() and "hasn't approved any items" in empty.inner_text(), "the empty state explains why the list is empty")
        w.shot(page, "c35_empty")
        empty.get_by_role("button", name="Tick Approved by Admin").click()
        time.sleep(0.5)
        c.eq(pdf_ticks(d, "status")[PDF_ADMIN], "2", "one click ticks Approved by Admin, second")
        c.check(d.get_by_test_id("pdf-items").count() > 0, "the Admin-approved items are listed")
        page.keyboard.press("Escape")
        time.sleep(0.5)

    names = seed(w, "RQ-001-WALK35", [
        {"kind": "pick", "make": "Locel", "status": "Approved", "client_status": CLIENT_APPROVED, "package": "HVAC"},
        {"kind": "new_make", "make": "Jogger", "status": "Approved", "client_status": CLIENT_APPROVED, "package": "Plumbing"},
        {"kind": "new_make", "make": "Value", "status": "Approved", "package": "Plumbing"},
        {"kind": "new_make", "make": "NR", "package": "HVAC"},
        {"kind": "new_make", "make": "Nerolac", "status": "Approved", "client_status": CLIENT_REJECTED, "package": "Plumbing"},
    ])
    ours = set(names.values())
    d = open_pdf_dialog(page)
    pdf_toggle_status(d, PDF_PENDING)
    pdf_toggle_status(d, PDF_ADMIN)
    summary = pdf_summary(d)
    c.eq([s for s, _ in summary], [PDF_CLIENT, PDF_PENDING, PDF_ADMIN], "the summary lists the statuses in tick order")
    listed = pdf_list(d)
    for status, text in summary:
        pkgs = list(dict.fromkeys(p for s, p, _ in listed if s == status))
        c.eq(text, ", ".join(pkgs), f"{status}: the summary names the list's packages in order")
        c.eq(pkgs, sorted(pkgs), f"{status}: packages run A to Z with none ticked")
    w.shot(page, "c35_summary", full=True)

    pdf_toggle_package(d, "Plumbing")
    pdf_toggle_package(d, "HVAC")
    summary = dict(pdf_summary(d))
    c.eq(summary.get(PDF_CLIENT), "Plumbing, HVAC", "ticked packages print in tick order in the summary")
    expected = [n for _, _, n in pdf_list(d) if n in ours]

    sent = {}

    def capture(route):
        body = json.loads(route.request.post_data or "{}")
        sent["items"] = json.loads(body.get("items_json") or "[]")
        route.abort()  # no PDF job: the payload is what is checked

    page.route(re.compile(r".*tds_report\.export_tds_report.*"), capture)
    d.get_by_role("button", name=re.compile("^Download PDF")).click()
    wait_for(lambda: "items" in sent, 10)
    page.unroute(re.compile(r".*tds_report\.export_tds_report.*"))
    payload = [i["name"] for i in sent.get("items", [])]
    c.check(payload, "the export was posted", sent)
    c.eq([n for n in payload if n in ours], expected, "the export payload runs in the list's order")
    c.eq(len(payload), len(set(payload)), "no row is sent twice")
    c.check(names["Nerolac"] not in payload, "the Rejected by Client row is never sent")
    buckets = pdf_buckets(w, payload)
    order = list(dict.fromkeys(buckets[n] for n in payload))
    c.eq(order, [s for s in (PDF_CLIENT, PDF_PENDING, PDF_ADMIN) if s in order],
         "the sent rows' database statuses run in tick order")
    c.check(None not in order, "every sent row has a PDF status in the database", order)


@case(36, "PDF dialog Select all / Deselect all act on the shown items only")
def c36(w: Walk, page, c: Checks):
    names = seed(w, "RQ-001-WALK36", [
        {"kind": "custom", "name": CUSTOM_LAMP, "make": "Locel", "pcus": "PCUS-WALK36A", "status": "Approved"},
        {"kind": "custom", "name": CUSTOM_FAN, "make": "Havells", "pcus": "PCUS-WALK36B", "status": "Approved"},
        {"kind": "pick", "make": "Tapariya", "status": "Approved"},
    ])
    lamp, fan, valve = names["Locel"], names["Havells"], names["Tapariya"]
    db = pdf_db_counts(w)
    d = open_pdf_dialog(page)
    pdf_toggle_status(d, PDF_ADMIN)
    scope = db[PDF_CLIENT] + db[PDF_ADMIN]
    count = d.get_by_test_id("pdf-ticked-count")
    c.eq(count.inner_text().strip(), f"{scope} of {scope} ticked", "every listed item starts ticked; the count matches the database")
    d.get_by_role("button", name="Deselect all", exact=True).click()
    time.sleep(0.5)
    c.eq(count.inner_text().strip(), f"0 of {scope} ticked", "Deselect all with no search unticks everything")
    d.locator(f'tr[data-pdf-row="{valve}"] button[role="checkbox"]').click()
    time.sleep(0.3)

    search = d.get_by_placeholder("Search item name...")
    search.fill(CUSTOM_LAMP)
    time.sleep(0.5)
    shown = [n for _, _, n in pdf_list(d)]
    c.eq(shown, [lamp], "the search shows only the matching item")
    d.get_by_role("button", name="Select all", exact=True).click()
    time.sleep(0.5)
    search.fill("")
    time.sleep(0.5)
    c.eq((pdf_row_ticked(d, lamp), pdf_row_ticked(d, fan), pdf_row_ticked(d, valve)), (True, False, True),
         "Select all ticked only the match; the other ticks are untouched")
    c.eq(count.inner_text().strip(), f"2 of {scope} ticked", "the count follows")

    search.fill("TDS WALK Custom")
    time.sleep(0.5)
    c.eq(sorted(n for _, _, n in pdf_list(d)), sorted([lamp, fan]), "a wider search shows both custom items")
    d.get_by_role("button", name="Select all", exact=True).click()
    time.sleep(0.5)
    c.check(d.get_by_role("button", name="Deselect all", exact=True).count(), "with every shown item ticked the button reads Deselect all")
    w.shot(page, "c36_search")
    d.get_by_role("button", name="Deselect all", exact=True).click()
    time.sleep(0.5)
    search.fill("")
    time.sleep(0.5)
    c.eq((pdf_row_ticked(d, lamp), pdf_row_ticked(d, fan), pdf_row_ticked(d, valve)), (False, False, True),
         "Deselect all unticked only the shown items")


@case(37, "PDF dialog preview-only: a non-Admin with Pending ticked gets Preview PDF and the reason; an Admin gets Download")
def c37(w: Walk, page, c: Checks):
    seed(w, "RQ-001-WALK37", [
        {"kind": "pick", "make": "Tapariya"},
        {"kind": "pick", "make": "Locel", "status": "Approved", "client_status": CLIENT_APPROVED},
    ])
    db = pdf_db_counts(w)
    d = open_pdf_dialog(page)
    c.eq(pdf_status_count(d, PDF_PENDING), db[PDF_PENDING], "Pending's item count matches the database")
    pdf_toggle_status(d, PDF_PENDING)
    c.eq(pdf_primary(d), "Download PDF", "an Admin with Pending ticked can download")
    c.eq(d.get_by_test_id("pdf-preview-note").inner_text().strip(), "", "an Admin sees no preview-only note")
    page.keyboard.press("Escape")

    # The walk user is an Admin. The rule is the screen's, so the browser is told this user is a PMO
    # Executive: its own Nirmaan Users read comes back with that role profile. The server is untouched.
    def as_pmo(route):
        resp = route.fetch()
        body = resp.json()
        body.setdefault("data", {})["role_profile"] = PMO_PROFILE
        route.fulfill(response=resp, json=body)

    page.route(re.compile(r".*/api/resource/Nirmaan(%20| )Users/.*"), as_pmo)
    d = open_pdf_dialog(page)
    c.eq(pdf_primary(d), "Download PDF", "a non-Admin without Pending ticked can download")
    pdf_toggle_status(d, PDF_PENDING)
    c.eq(pdf_primary(d), "Preview PDF", "a non-Admin with Pending ticked gets Preview PDF")
    c.eq(d.get_by_test_id("pdf-preview-note").inner_text().strip(), PREVIEW_NOTE, "the footer says why")
    w.shot(page, "c37_preview_only")
    pdf_toggle_status(d, PDF_CLIENT)
    c.eq(pdf_primary(d), "Preview PDF", "Pending anywhere in the order keeps it preview-only")
    pdf_toggle_status(d, PDF_PENDING)
    pdf_toggle_status(d, PDF_ADMIN)
    c.eq(pdf_primary(d), "Download PDF", "unticking Pending gives Download back")
    c.eq(d.get_by_test_id("pdf-preview-note").inner_text().strip(), "", "and the note goes")
    page.unroute(re.compile(r".*/api/resource/Nirmaan(%20| )Users/.*"))


# ─── main ────────────────────────────────────────────────────────────────────────────────────────

def parse_cases(spec):
    if not spec:
        return sorted(CASES)
    picked = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            picked += range(int(a), int(b) + 1)
        elif part:
            picked.append(int(part))
    unknown = [n for n in picked if n not in CASES]
    if unknown:
        raise SystemExit(f"unknown case(s): {unknown}; known: 1-{max(CASES)}")
    return sorted(set(picked))


def main():
    ap = argparse.ArgumentParser(description="Browser walk of Project TDS requests (#1373).")
    ap.add_argument("--case", help="cases to run, e.g. 13 or 13,16 or 9-12 (default: all)")
    ap.add_argument("--allow-uploads", action="store_true",
                    help="also run the steps that upload PDFs (they land in the production bucket for good)")
    ap.add_argument("--out", default=os.path.join(tempfile.gettempdir(), "tds-walk-" + datetime.now().strftime("%Y%m%d-%H%M%S")),
                    help="screenshot / scratch directory (default: under the system temp dir)")
    ap.add_argument("--headed", action="store_true", help="show the browser")
    args = ap.parse_args()
    selected = parse_cases(args.case)
    os.makedirs(args.out, exist_ok=True)
    print(f"cases {selected}; uploads {'ALLOWED' if args.allow_uploads else 'blocked'}; screenshots in {args.out}")

    w = Walk(args)
    results = []
    cleanup_problems = ["cleanup did not run"]
    try:
        w.setup()
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not args.headed)
            try:
                w.login(browser)
                for n in selected:
                    status, detail = w.run_case(CASES[n])
                    results.append((n, CASES[n].title, status, detail))
            finally:
                browser.close()
    except Exception as e:
        traceback.print_exc()
        results.append((0, "walk setup / browser", "FAIL", f"{type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}"))
    finally:
        try:
            removed = w.cleanup()
            if removed is not None:
                after, leftovers, cleanup_problems = w.verify_cleanup()
                print(f"\ncleanup: removed {removed}; project rows {len(w.baseline['rows'])} -> {len(after['rows'])}, "
                      f"TDS Items {w.baseline['tds_items']} -> {after['tds_items']}, TDS Repository {w.baseline['tds_repository']} -> "
                      f"{after['tds_repository']}, File {w.baseline['files']} -> {after['files']}")
                if leftovers["error_logs"]:
                    print(f"  note: Error Log rows since start (not removed): {leftovers['error_logs']}")
            else:
                cleanup_problems = []
        except Exception as e:
            traceback.print_exc()
            cleanup_problems = [f"cleanup failed: {e}"]

    width = max([len(r[1]) for r in results] + [10])
    print("\n" + "=" * (width + 30))
    for n, title, status, detail in results:
        print(f"{n:>3}  {status:<8} {title:<{width}}  {detail[:160] if status != 'PASS' else detail[:80]}")
    print("=" * (width + 30))
    counts = {s: sum(1 for r in results if r[2] == s) for s in ("PASS", "FAIL", "SKIPPED")}
    print(f"PASS {counts['PASS']}  FAIL {counts['FAIL']}  SKIPPED {counts['SKIPPED']}")
    print(f"uploads: {len(w.uploads)} made" + (f"; {len(w.blocked_uploads)} BLOCKED" if w.blocked_uploads else ""))
    if cleanup_problems:
        print("CLEANUP MISMATCH: " + "; ".join(cleanup_problems))
    else:
        print("cleanup: counts back to baseline")
    print(f"screenshots: {args.out}")
    sys.exit(1 if counts["FAIL"] or cleanup_problems else 0)


if __name__ == "__main__":
    main()
