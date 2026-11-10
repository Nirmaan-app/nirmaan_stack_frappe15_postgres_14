#!/usr/bin/env python3
"""Walk the five pasted-link fields of #1680: a made-up link of 200+ characters is saved whole, shown, and opens.

    python3 .claude/skills/verify/bin/walk_link_fields.py --task <task> --part <part> --user <email> --password <pw>

Parts, each as the role that uses that screen:
  drive       Admin: Admin Options > Projects > a project > Project Drive Links > Add File.
  cpo         PMO Executive: Admin Options > Projects > a project > Customer PO Details > Add Customer PO (Link).
  design      Design Executive: Design Tracker > a project > a task assigned to them > Edit > Design File Link.
  commission  PMO Executive: HOD Tracker > a project > Commissioning Report > Edit > the task's Uploaded file >
              View. No screen writes this field and the Commission Report Tracker never shows it, so the seed
              stores the link and the walk proves the one screen that shows it shows and opens it whole.
  billing     Billing Executive: Billing Tracker > View Bills > Add Bill (Link).

For each it saves the link, opens the screen again the way the user does, asserts that a link with the whole value
as its href is on the page, that clicking it opens a tab at that exact address (Google is stubbed, so nothing leaves
the machine), that the edit form shows the whole value back (where the screen has one), and that the env DB holds
it whole (`link_fields_db.py`, saved as `<part>-db.txt`). Exits 1 on any miss.
"""

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

from drive import save, session, sidebar

ROOT = Path(__file__).resolve().parents[4]
BIN = ".claude/skills/verify/bin"


def made_up_link(part: str) -> str:
    """A made-up Drive link of 200+ characters, unique to this run, so the DB read finds this walk's row."""
    stamp = time.strftime("%Y%m%d%H%M%S")
    link = (
        f"https://drive.google.com/drive/folders/1Walk1680{part.capitalize()}{stamp}AbCdEfGhIjKlMnOpQrStUv"
        "?resourcekey=0-ZyXwVuTsRqPoNmLkJiHgFe&usp=sharing&authuser=0&ouid=000000000000000000000"
        f"&rtpof=true&sd=true&made_up=walk_link_fields_{part}"
    )
    assert len(link) > 200, len(link)
    return link


def devenv_script(task: str, *args: str) -> dict:
    run = subprocess.run(
        [str(ROOT / "scripts/devenv/devenv.sh"), "script", task, *args], cwd=ROOT, capture_output=True, text=True
    )
    lines = [ln for ln in run.stdout.splitlines() if ln.startswith("{")]
    if run.returncode or not lines:
        sys.exit(f"walk: {' '.join(args)} failed:\n{run.stdout}\n{run.stderr}")
    return json.loads(lines[-1])


def check(ok: bool, what: str, misses: list) -> None:
    print(("seen   " if ok else "FAILED ") + what)
    if not ok:
        misses.append(what)


def link_opens(page, link: str, misses: list) -> None:
    """The link on the page carries the whole value and opens a new tab at exactly that address."""
    anchors = page.locator(f'a[href="{link}"]')
    check(anchors.count() >= 1, "a link with the whole value is shown", misses)
    if not anchors.count():
        return
    with page.context.expect_page() as new_tab:
        anchors.first.click()
    tab = new_tab.value
    tab.wait_for_load_state()
    check(tab.url == link, f"clicking it opens the whole link ({len(tab.url)} of {len(link)} characters)", misses)
    tab.close()


def db_holds(task: str, part: str, doctype: str, field: str, link: str, out: Path, misses: list) -> None:
    row = devenv_script(task, f"{BIN}/link_fields_db.py", doctype, field, link)
    (out / f"{part}-db.txt").write_text(json.dumps(row, indent=1) + "\n")
    check(len(row["rows"]) == 1, f"the DB holds the whole link once in {doctype}.{field} ({row['rows']})", misses)


def open_project(page, name: str, via_admin: bool) -> None:
    if via_admin:
        page.locator('[data-sidebar="menu-button"]').get_by_text("Admin Options", exact=True).click()
        page.locator('[data-sidebar="menu-sub-button"]').get_by_text("Projects", exact=True).click()
        page.wait_for_load_state("networkidle")
    else:
        sidebar(page, "Projects")
    page.get_by_role("link", name=name, exact=True).first.click()
    page.get_by_text("Loading data...").wait_for(state="hidden", timeout=60_000)


def walk_drive(page, a, out, misses):
    link, project = made_up_link("drive"), "Telus GIFT City"
    name = f"Walk 1680 {time.strftime('%H%M%S')}"
    open_project(page, project, via_admin=True)
    page.get_by_role("button", name="Add File").click()
    page.locator("#drive_name").fill(name)
    page.locator("#drive_link").fill(link)
    save(page, out, "drive-01-pasted")
    page.get_by_role("button", name="Add Link").click()
    page.get_by_role("dialog").wait_for(state="hidden")

    page.reload()
    page.get_by_text("Loading data...").wait_for(state="hidden", timeout=60_000)
    row = page.get_by_role("row", name=re.compile(re.escape(name)))
    row.wait_for()
    row.scroll_into_view_if_needed()
    save(page, out, "drive-02-reopened")
    check(link in row.inner_text(), "the row shows the whole link as text", misses)
    link_opens(page, link, misses)
    row.locator('button[title="Edit Link"]').click()
    check(page.locator("#drive_link").input_value() == link, "the edit dialog shows the whole link", misses)
    save(page, out, "drive-03-edit-dialog")
    page.keyboard.press("Escape")
    db_holds(a.task, "drive", "Project Drive Link Child Table", "drive_link", link, out, misses)


def walk_cpo(page, a, out, misses):
    link, project = made_up_link("cpo"), "Telus GIFT City"
    po = f"WALK-1680-{time.strftime('%H%M%S')}"
    open_project(page, project, via_admin=True)  # PMO reaches Projects under Admin Options too
    page.get_by_role("button", name="Add Customer PO").click()
    dialog = page.get_by_role("dialog")
    # The source starts on Attachment; the PO fields show once a source is picked.
    dialog.get_by_role("radio", name="Link").click()
    dialog.locator("#customer_po_link").fill(link)
    dialog.locator("#customer_po_number").fill(po)
    dialog.locator("#customer_po_creation_date").fill(time.strftime("%Y-%m-%d"))
    dialog.locator("#customer_po_value_inctax").fill("1180")
    dialog.locator("#customer_po_value_exctax").fill("1000")
    save(page, out, "cpo-01-pasted")
    dialog.get_by_role("button", name=re.compile(r"^(Create Customer PO|Continue)$")).click()
    # A project whose value is entered by hand asks a second step before it creates the PO.
    if dialog.get_by_role("button", name="Create Customer PO").is_visible():
        dialog.get_by_role("button", name="Create Customer PO").click()
    dialog.wait_for(state="hidden")

    page.reload()
    page.get_by_text("Loading data...").wait_for(state="hidden", timeout=60_000)
    row = page.get_by_role("row", name=re.compile(re.escape(po)))
    row.wait_for()
    row.scroll_into_view_if_needed()
    save(page, out, "cpo-02-reopened")
    link_opens(page, link, misses)
    row.get_by_role("button", name="Edit PO").click()
    check(page.locator("#customer_po_link").input_value() == link, "the edit dialog shows the whole link", misses)
    save(page, out, "cpo-03-edit-dialog")
    page.keyboard.press("Escape")
    db_holds(a.task, "cpo", "Customer PO Child Table", "customer_po_link", link, out, misses)


def design_task_row(page, seed):
    """The seeded task's row: its phase, My Tasks, then the task search. A task cell starts with its zone ("7F ")."""
    page.get_by_role("button", name=seed["task_phase"], exact=True).click()
    page.get_by_role("button", name=re.compile(r"^My Tasks \d+$")).click()
    page.get_by_role("textbox", name="Search by Task Name").fill(seed["task_name"])
    cell = page.get_by_role("cell", name=re.compile(re.escape(seed["task_name"]) + "$"))
    return page.get_by_role("row").filter(has=cell).first


def open_design_tracker(page, project):
    sidebar(page, "Design Tracker")
    page.get_by_role("textbox", name="Search by project name or ID...").fill(project)
    page.get_by_role("heading", name=project, exact=True).first.click()
    page.wait_for_url(re.compile(r"/design-tracker/"))
    page.wait_for_load_state("networkidle")


def walk_design(page, a, out, misses):
    link = made_up_link("design")
    seed = devenv_script(a.task, f"{BIN}/link_fields_seed.py", "design", a.user)
    open_design_tracker(page, seed["project_name"])
    row = design_task_row(page, seed)
    row.wait_for()
    row.locator("td").last.get_by_role("button").click()
    dialog = page.get_by_role("dialog")
    dialog.locator("#file_link").fill(link)
    save(page, out, "design-01-pasted")
    dialog.get_by_role("button", name="Save Changes").click()
    dialog.wait_for(state="hidden")

    page.reload()
    page.wait_for_load_state("networkidle")
    row = design_task_row(page, seed)
    row.wait_for()
    row.scroll_into_view_if_needed()
    save(page, out, "design-02-reopened")
    link_opens(page, link, misses)
    row.locator("td").last.get_by_role("button").click()
    check(page.locator("#file_link").input_value() == link, "the edit dialog shows the whole link", misses)
    save(page, out, "design-03-edit-dialog")
    page.keyboard.press("Escape")
    db_holds(a.task, "design", "Design Tracker Task Child Table", "file_link", link, out, misses)


def walk_commission(page, a, out, misses):
    link = made_up_link("commission")
    seed = devenv_script(a.task, f"{BIN}/link_fields_seed.py", "commission", link)
    (out / "commission-seed.txt").write_text(json.dumps(seed) + "\n")
    sidebar(page, "HOD Tracker")
    page.get_by_role("heading", name=seed["project_name"], exact=True).first.click()
    page.wait_for_url(re.compile(r"/hod-tracker/"))
    page.wait_for_load_state("networkidle")
    page.get_by_role("row", name=re.compile(r"Commissioning Report")).first.get_by_role("button", name="Edit").click()
    dialog = page.get_by_role("dialog")
    row = dialog.get_by_role("row").filter(has=page.get_by_role("cell", name=seed["task_name"], exact=True)).first
    row.wait_for()
    row.scroll_into_view_if_needed()
    check("Uploaded file" in row.inner_text(), "the task offers its Uploaded file", misses)
    save(page, out, "commission-01-sources")
    row.get_by_role("button", name="View").click()
    frame = page.get_by_title("Report preview")
    frame.wait_for()
    check(
        (frame.get_attribute("src") or "").startswith(link + "#"),
        "the preview shows the whole link",
        misses,
    )
    save(page, out, "commission-02-preview")
    link_opens(page, link, misses)
    db_holds(a.task, "commission", "Commission Report Task Child Table", "file_link", link, out, misses)


def walk_billing(page, a, out, misses):
    link = made_up_link("billing")
    seed = devenv_script(a.task, f"{BIN}/link_fields_seed.py", "billing", a.user)
    sidebar(page, "Billing Tracker")
    page.get_by_role("row", name=re.compile(re.escape(seed["project_name"]))).get_by_role("button", name="View Bills").click()
    page.wait_for_url(re.compile(r"/billing-tracker/"))
    page.get_by_role("button", name="Add Bill").click()
    dialog = page.get_by_role("dialog", name="Add a bill")
    dialog.get_by_role("combobox").filter(has_text="Select a package").click()
    page.get_by_role("option", name=seed["package"], exact=True).click()
    dialog.get_by_role("combobox").filter(has_text="Select…").click()
    page.get_by_role("option", name="NA", exact=True).click()
    dialog.get_by_role("textbox", name="Bill document link").fill(link)
    save(page, out, "billing-01-pasted")
    dialog.get_by_role("button", name="Add bill").click()
    dialog.wait_for(state="hidden")

    page.reload()
    page.wait_for_load_state("networkidle")
    anchor = page.get_by_role("link", name=f"Open bill link for {seed['package']} NA")
    anchor.first.wait_for()
    save(page, out, "billing-02-reopened")
    link_opens(page, link, misses)
    page.get_by_role("row").filter(has=page.locator(f'a[href="{link}"]')).get_by_role("button", name="Edit bill").click()
    check(
        page.get_by_role("textbox", name="Bill document link").input_value() == link,
        "the edit drawer shows the whole link",
        misses,
    )
    save(page, out, "billing-03-edit-drawer")
    page.keyboard.press("Escape")
    db_holds(a.task, "billing", "Project Billing", "bill_document_link", link, out, misses)


PARTS = {
    "drive": walk_drive,
    "cpo": walk_cpo,
    "design": walk_design,
    "commission": walk_commission,
    "billing": walk_billing,
}

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--part", required=True, choices=PARTS)
ap.add_argument("--user", required=True)
ap.add_argument("--password", required=True)
a = ap.parse_args()

misses: list = []
with session(a.task, a.user, a.password) as (page, out):
    # The made-up links point at Google: answer them here, so a click opens a tab and nothing leaves the machine.
    page.context.route(
        re.compile(r"^https://drive\.google\.com/"),
        lambda route: route.fulfill(status=200, content_type="text/html", body="<p>made-up link, stubbed</p>"),
    )
    PARTS[a.part](page, a, out, misses)
    print(f"evidence: {out}")
    if misses:
        raise SystemExit(f"walk_link_fields {a.part}: {len(misses)} not seen: {misses}")
