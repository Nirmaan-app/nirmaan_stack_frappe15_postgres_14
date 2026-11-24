"""Walk PR #1717 (BOQ Estimates: the Estimates tab, its three views, who may edit, copy after a re-commit) on its env
and its base env.

    python3 -I walk_pr_1717.py <out dir> [fn ...]   # from the checkout root, with envs pr-1717 and pr-1717-base served
    python3 -I walk_pr_1717.py <copy of a run> append description   # add the description screen to a finished run

It writes on the after env: material estimates on three BOQ line items, and two re-commits of one sheet. Each run
picks lines that have no estimate yet, so a rerun works on fresh lines. The env runs no job worker of its own; the
walk starts one (and stops it) around the second re-commit, so the after-commit copy is seen running for real.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "verify" / "bin"))
sys.path.insert(0, str(HERE))
from drive import session, sidebar  # noqa: E402
from record import Walk, pin  # noqa: E402

AFTER, BEFORE = "pr-1717", "pr-1717-base"
DEVENV = "/Users/abhishek/work/nirmaan/deploy_setup/frappe_docker/development/devenv.sh"
CONTAINER = "frappe_docker_devcontainer-frappe-1"
PW = "WalkPw-1717"
PROJECT, PROJECT_NAME = "Hyderabad-PROJ-00286", "SHI Hyderabad"
DONE_PROJECT_NAME = "Drools Bangalore"  # Completed: estimates read-only (decision I)
BOQ_B, BOQ_A = "BOQ-26-00382", "BOQ-26-00383"  # PART B (1 sheet, re-committed by the walk) and PART A
SHEET_A = "VAV "  # verbatim, with its trailing space
ITEM_ID, ITEM_NAME = "ITEM-003967", "DIFFUSER NECK SIZE 225X225 OUTER 595X595 WITH DAMPER"
QTY = {"line": 4, "grid": 6, "other": 3}
USERS = {
    "Estimates Executive": "niranjankori02@gmail.com",
    "Admin": "admins@nirmaan.app",
    "PMO": "pmo@nirmaan.app",
    "Project Manager": "abdullah@nirmaan.app",
    "Accountant": "swathi@nirmaan.app",
}
EE = "Estimates Executive"

out = Path(sys.argv[1])
w = Walk(out, pr={"number": 1717, "title": "Boq/estimates items",
                  "url": "https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/pull/1717",
                  "author": "madhubalan17js", "head": "3ec7eb84f", "base": "42313959a"},
         envs={"after": AFTER, "before": BEFORE},
         data_note="a test copy of the production backup of 2026-11-17")
w.change("tab", "Project page › Estimates tab",
         "A new Estimates tab on the project page, shown wherever the BoQ tab is shown. It reads the BOQ tables and "
         "never writes them.")
w.change("boqview", "Estimates › BOQ View",
         "BOQ View lists the project's Selected BOQs, then a sheet's rows with a new Estimate Items column, and "
         "Expand all / Collapse all.")
w.change("lineview", "Estimates › Line Item View and the Material estimate form",
         "Line Item View opens one line's estimate in the Material estimate form. Picking an item fills in its "
         "category. Whole-number units refuse decimals.")
w.change("items", "Estimates › Estimate Items",
         "Material totals add the same item + make + unit across All BOQs and all sheets.")
w.change("roles", "Who may edit",
         "Admin, PMO and Estimates Executive may add, change or delete estimates. Everyone else who can open the "
         "tab only views. Estimates are read-only on a Completed or Handover project.")
w.change("recommit", "Copy after a BOQ re-commit; Re-attach",
         "After every BOQ commit a background job copies each estimate to the new version, keeping its original "
         "owner, and marks the older copy settled. The commit itself is unchanged. Re-attach copies by hand what the "
         "job left behind.")
w.change("delete", "A BOQ delete is never blocked by its estimates",
         "ignore_links_on_delete gains BOQ Line Estimate, so deleting a BOQ is never blocked by its estimates.")
w.change("description", "PR description",
         "The PR description is ready for reviewers.")
if "append" in sys.argv[2:]:
    # Add steps to an existing run folder (a copy of a finished run), keeping its steps, checks and statuses.
    w.data = json.loads((out / "walk.json").read_text())


# ---------------------------------------------------------------- helpers

def db(task: str, name: str, code: str, *args: str) -> str:
    """Run a Python snippet on the env DB (devenv script) and keep it and its output beside the screenshots."""
    src = out / "db" / f"{name}.py"
    src.parent.mkdir(exist_ok=True)
    src.write_text("import json, sys\nimport frappe\n" + code)
    res = subprocess.run([DEVENV, "script", task, str(src), *args], capture_output=True, text=True, timeout=300)
    (out / "db" / f"{name}.txt").write_text(res.stdout + res.stderr)
    return res.stdout


def db_json(task: str, name: str, code: str, *args: str) -> dict:
    text = db(task, name, code, *args)
    line = next((l for l in text.splitlines() if l.startswith("JSON ")), None)
    if line is None:
        raise RuntimeError(f"db {name}: no JSON line; see {out / 'db' / (name + '.txt')}")
    return json.loads(line[5:])


FACTS = r'''
a = json.loads(sys.argv[1])
def sheets(boq):
    return frappe.db.sql("""select name, sheet_name, commit_version from "tabBoQ Sheet" where boq=%s and is_current=1
        and coalesce(treat_as,'data')='data' order by sheet_order, name""", boq, as_dict=True)
def free_lines(sheet, n):
    return frappe.db.sql("""select n.name, n.source_row_number as row, n.description from "tabBOQ Nodes" n
        where n.sheet=%s and n.is_current=1 and n.node_type='Line Item'
          and not exists (select 1 from "tabBOQ Line Estimate" e where e.boq_node=n.name)
        order by n.sort_order limit %s""", (sheet, n), as_dict=True)
sb = sheets(a["boq_b"])[0]
sa = next(s for s in sheets(a["boq_a"]) if s.sheet_name == a["sheet_a"])
boqs = frappe.get_all("BOQs", filters={"project": a["project"], "status": "Selected"}, fields=["name"], order_by="creation asc")
over = {}
for b in boqs:
    ss = sheets(b.name)
    names = tuple(s.name for s in ss) or ("",)
    lines = frappe.db.sql("""select count(*) from "tabBOQ Nodes" where sheet in %s and is_current=1 and node_type='Line Item'""", (names,))[0][0]
    est = frappe.db.sql("""select count(*) from "tabBOQ Line Estimate" e join "tabBOQ Nodes" n on n.name=e.boq_node
        where n.sheet in %s and n.is_current=1 and coalesce(e.item_count,0)>0""", (names,))[0][0]
    over[b.name] = {"sheets": len(ss), "lines": lines, "estimated": est}
b_lines = frappe.db.sql("""select count(*) from "tabBOQ Nodes" where sheet=%s and is_current=1 and node_type='Line Item'""", sb.name)[0][0]
item = frappe.db.get_value("Items", a["item"], ["item_name", "unit_name", "category"], as_dict=True)
print("JSON " + json.dumps({"sheet_b": sb, "sheet_a": sa, "lines_b": free_lines(sb.name, 2), "line_a": free_lines(sa.name, 1),
    "overview": over, "b_lines": b_lines, "item": item}, default=str))
'''

TOTALS = r'''
a = json.loads(sys.argv[1])
rows = frappe.db.sql("""select e.boq, e.boq_node, i.quantity from "tabBOQ Line Estimate" e
    join "tabBOQ Line Estimate Item" i on i.parent=e.name and i.parenttype='BOQ Line Estimate'
    join "tabBOQ Nodes" n on n.name=e.boq_node join "tabBOQs" b on b.name=e.boq
    where b.project=%s and b.status='Selected' and n.is_current=1 and i.item_id=%s and coalesce(i.make,'')=''""",
    (a["project"], a["item"]), as_dict=True)
print("JSON " + json.dumps({"qty": float(sum(r.quantity for r in rows)), "lines": len({r.boq_node for r in rows}),
    "boqs": len({r.boq for r in rows})}))
'''

ESTIMATE = r'''
a = json.loads(sys.argv[1])
name = frappe.db.get_value("BOQ Line Estimate", {"boq_node": a["node"]}, "name")
doc = frappe.get_doc("BOQ Line Estimate", name) if name else None
print("JSON " + json.dumps(None if not doc else {"name": doc.name, "owner": doc.owner, "settled": doc.settled,
    "items": [{"item_id": i.item_id, "item_name": i.item_name, "unit": i.unit, "category": i.category,
               "package": i.procurement_package, "quantity": i.quantity} for i in doc.items]}, default=str))
'''

SHEET_STATE = r'''
a = json.loads(sys.argv[1])
cur = frappe.db.get_value("BoQ Sheet", {"boq": a["boq"], "is_current": 1, "treat_as": "data"}, ["name", "commit_version"], as_dict=True)
on_cur = frappe.db.sql("""select e.name, e.owner, e.settled, n.source_row_number as row from "tabBOQ Line Estimate" e
    join "tabBOQ Nodes" n on n.name=e.boq_node where n.sheet=%s order by n.source_row_number""", cur.name, as_dict=True)
older = frappe.db.sql("""select e.name, e.owner, e.settled, n.source_row_number as row, s.commit_version as v
    from "tabBOQ Line Estimate" e join "tabBOQ Nodes" n on n.name=e.boq_node join "tabBoQ Sheet" s on s.name=n.sheet
    where e.boq=%s and n.sheet != %s order by s.commit_version, n.source_row_number""", (a["boq"], cur.name), as_dict=True)
logs = frappe.db.count("Error Log", {"method": ["like", "%BOQ estimates%"]})
print("JSON " + json.dumps({"sheet": cur, "current": on_cur, "older": older, "error_logs": logs}, default=str))
'''


def base_of(page) -> str:
    return re.match(r"(https?://[^/]+)", page.url).group(1)


def settle(page, ms: int = 1500) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def guarded(cid: str, fn, tries: int = 1) -> None:
    for attempt in range(1, tries + 1):
        steps, checks = len(w.data["steps"]), len(w.data["checks"])
        try:
            fn()
            return
        except Exception as e:
            traceback.print_exc()
            del w.data["steps"][steps:], w.data["checks"][checks:]
            if attempt == tries:
                w.status(cid, "failed", f"walk stopped: {type(e).__name__}: {str(e).splitlines()[0][:160]}")


def project_tab(page, label: str):
    """A tab button of the project page (Work Report … Estimates), by its exact text."""
    return page.get_by_text(label, exact=True)


def open_project(cid: str, page, side: str, role: str, user: str, name: str = PROJECT_NAME) -> None:
    page.locator('[data-sidebar="menu-button"]').get_by_text("Dashboard", exact=True).wait_for(timeout=30000)
    page.wait_for_timeout(500)
    if page.locator('[data-sidebar="menu-button"]').get_by_text("Projects", exact=True).count():
        sidebar(page, "Projects")
    else:  # PMO: no Projects in the sidebar; the dashboard's Projects card is the way in
        w.step(page, cid, side, role, user, "This role has no Projects link in the sidebar. Open the dashboard's Projects card.",
               click=page.locator("main").get_by_text("Projects", exact=True))
    settle(page)
    page.get_by_placeholder("Search by Project Name...").fill(name)
    page.get_by_text(name, exact=True).first.wait_for(timeout=30000)
    w.step(page, cid, side, role, user, f"In Projects, search {name} and open it.",
           click=page.get_by_text(name, exact=True))
    page.get_by_text("Bulk Download", exact=True).first.wait_for(timeout=40000)
    settle(page, 2000)


def est_subtab(page, label: str):
    return page.get_by_role("tab", name=label, exact=True)


def boq_row(page, boq: str):
    return page.locator("tr", has=page.get_by_text(boq, exact=True))


def wait_text(page, text: str, timeout: int = 30000) -> None:
    page.get_by_text(text, exact=False).first.wait_for(timeout=timeout)


def dialog_add_item(page, cid: str, role: str, user: str, qty_good: int, bad_qty: str | None) -> None:
    """In an open Material estimate form: + Add item, pick the walk's item, (try a bad qty), add it, Save."""
    dlg = page.get_by_role("dialog")
    w.step(page, cid, "after", role, user, "The Material estimate form opens on the line. Add an item from the Items list.",
           click=dlg.get_by_role("button", name="+ Add item"))
    settle(page, 1500)
    search = dlg.locator("input[id^=react-select]").nth(1)
    search.focus()
    page.keyboard.type(ITEM_NAME)
    page.wait_for_timeout(1200)
    page.keyboard.press("Enter")
    page.wait_for_timeout(800)
    picked = dlg.get_by_text("Picked:", exact=False)
    cat_text = facts["item"]["category"]
    cat_shown = dlg.get_by_text(cat_text, exact=True).first
    w.check(cid, role, f"picking the item fills its category ({cat_text})",
            "filled" if cat_shown.count() else "category box still empty", cat_shown.count() > 0)
    qty = dlg.get_by_label("Quantity")
    if bad_qty:
        qty.fill(bad_qty)
        w.step(page, cid, "after", role, user,
               f"Search the item: the category box fills in by itself with {cat_text}. Try {bad_qty} {facts['item']['unit_name']}.",
               click=dlg.get_by_role("button", name="Add", exact=True),
               pins=[pin(cat_shown, "Category filled from the picked item.", "info"),
                     pin(picked, "The picked item, its unit and category.", "info")])
        settle(page, 600)
        alert = dlg.get_by_role("alert")
        msg = alert.first.inner_text() if alert.count() else ""
        ok = "whole numbers" in msg
        w.check(cid, role, f"{bad_qty} on a {facts['item']['unit_name']} item is refused", msg or "no message", ok)
        w.step(page, cid, "after", role, user, "The form refuses a decimal on a unit counted in pieces.",
               pins=[pin(alert, f"Refused: {msg}" if msg else "No message shown.", "info" if ok else "must")])
    qty.fill(str(qty_good))
    w.step(page, cid, "after", role, user, f"Enter {qty_good} and add the row.",
           click=dlg.get_by_role("button", name="Add", exact=True))
    settle(page, 600)
    w.step(page, cid, "after", role, user, "The row is in the form. Save.",
           click=dlg.get_by_role("button", name="Save", exact=True))
    settle(page, 2000)


def check_saved(cid: str, role: str, node: str, qty: int, owner: str) -> None:
    e = db_json(AFTER, f"estimate-{node}", ESTIMATE, json.dumps({"node": node}))
    if not e:
        w.check(cid, role, f"an estimate is saved on {node}", "none in the DB", False)
        return
    it = e["items"][0] if e["items"] else {}
    w.check(cid, role, f"DB: {node} holds {ITEM_ID} × {qty}, category {facts['item']['category']}, owner {owner}",
            f"{it.get('item_id')} × {it.get('quantity')}, category {it.get('category')}, package {it.get('package')}, owner {e['owner']}",
            it.get("item_id") == ITEM_ID and float(it.get("quantity") or 0) == qty
            and it.get("category") == facts["item"]["category"] and e["owner"] == owner)


facts = db_json(AFTER, "facts", FACTS, json.dumps({"project": PROJECT, "boq_b": BOQ_B, "boq_a": BOQ_A,
                                                   "sheet_a": SHEET_A, "item": ITEM_ID}))
LINE_GRID, LINE_VIEW = facts["lines_b"][0], facts["lines_b"][1]
LINE_OTHER = facts["line_a"][0]


# ---------------------------------------------------------------- the tab

def tab_before() -> None:
    role, user = EE, USERS[EE]
    with session(BEFORE, user, PW) as (page, _):
        open_project("tab", page, "before", role, user)
        has = project_tab(page, "Estimates").count()
        w.check("tab", role, "before this PR: no Estimates tab", "Estimates tab shown" if has else "no Estimates tab", not has)
        w.step(page, "tab", "before", role, user, "Before this PR: the project page has a BoQ tab and no Estimates tab.",
               pins=[pin(project_tab(page, "BoQ"), "BoQ is here; no Estimates tab beside it.", "info")])


def boq_view() -> None:
    role, user = EE, USERS[EE]
    with session(AFTER, user, PW) as (page, _):
        open_project("tab", page, "after", role, user)
        tab = project_tab(page, "Estimates")
        w.check("tab", role, "Estimates tab next to BoQ", "shown" if tab.count() else "missing", tab.count() > 0)
        w.step(page, "tab", "after", role, user, "With this PR: an Estimates tab sits next to BoQ. Open it.", click=tab)
        wait_text(page, "With materials")
        settle(page, 1500)
        seen = {}
        for b, o in facts["overview"].items():
            cells = [c.strip() for c in boq_row(page, b).first.locator("td").all_inner_texts()]
            seen[b] = cells
            w.check("boqview", role, f"{b}: {o['sheets']} sheets, {o['lines']} line items, {o['estimated']}/{o['lines']} with materials",
                    " | ".join(cells[1:4]),
                    cells[1:4] == [str(o["sheets"]), str(o["lines"]), f"{o['estimated']}/{o['lines']}"])
        w.step(page, "boqview", "after", role, user,
               f"BOQ View lists the project's {len(facts['overview'])} Selected BOQs with their sheets and line items. Open PART B ({BOQ_B}).",
               click=boq_row(page, BOQ_B).get_by_role("button", name="Open"),
               pins=[pin(page.get_by_text("With materials", exact=True), "Lines with materials / all line items, read from the DB and matched.", "info")])
        page.get_by_text("Estimate Items", exact=True).nth(1).wait_for(timeout=30000)
        settle(page, 2000)
        head = page.locator("th", has_text="Estimate Items")
        row = page.locator(f"#est-row-{LINE_GRID['name']}")
        w.step(page, "boqview", "after", role, user,
               "The sheet opens with the new Estimate Items column after Row type: '+ Add' on each line item.",
               pins=[pin(head, "New column; the rest of the grid is the BOQ sheet as before.", "info")])
        w.step(page, "boqview", "after", role, user, f"Add materials to Excel row {LINE_GRID['row']}.",
               click=row.get_by_role("button", name="+ Add"))
        settle(page, 1200)
        dialog_add_item(page, "boqview", role, user, QTY["grid"], bad_qty="2.5")
        check_saved("boqview", role, LINE_GRID["name"], QTY["grid"], user)
        row = page.locator(f"#est-row-{LINE_GRID['name']}")
        count_btn = row.get_by_role("button", name=re.compile(r"1 item"))
        w.check("boqview", role, f"row {LINE_GRID['row']} shows '1 item' after the save",
                "shown" if count_btn.count() else "not shown", count_btn.count() > 0)
        strip = page.get_by_role("tab", name=re.compile(re.escape(facts["sheet_b"]["sheet_name"])))
        strip_text = strip.first.inner_text().replace("\n", " ") if strip.count() else ""
        want = f"{facts['overview'][BOQ_B]['estimated'] + 1}/{facts['b_lines']}"
        w.check("boqview", role, f"sheet strip counts {want} after one save", strip_text, want in strip_text)
        expand = page.get_by_role("button", name=re.compile("Expand all"))
        collapse = page.get_by_role("button", name=re.compile("Collapse all"))
        w.step(page, "boqview", "after", role, user,
               f"Saved: row {LINE_GRID['row']} now reads '▾ 1 item', with its materials open below it.",
               pins=[pin(count_btn, "1 item on this line.", "info")])
        if expand.count():
            # Other lines of the sheet also hold materials (earlier runs) and are closed, so the toggle offers Expand all.
            w.step(page, "boqview", "after", role, user,
                   "Other lines with materials are closed, so the toggle offers Expand all.",
                   click=expand, pins=[pin(strip, f"Sheet strip: {strip_text}.", "info")])
            settle(page, 1000)
            opened = page.get_by_role("button", name=re.compile(r"^▾ \d+ items?$")).count()
            closed = page.get_by_role("button", name=re.compile(r"^▸ \d+ items?$")).count()
            w.check("boqview", role, "Expand all opens every line with materials", f"{opened} open, {closed} closed",
                    opened > 0 and closed == 0)
            w.step(page, "boqview", "after", role, user,
                   f"Expand all opened every line's materials ({opened} open). The toggle now offers Collapse all.",
                   click=collapse)
        else:
            w.step(page, "boqview", "after", role, user,
                   "Try Collapse all.", click=collapse, pins=[pin(strip, f"Sheet strip: {strip_text}.", "info")])
        settle(page, 1000)
        folded = page.get_by_text(re.compile(r"\(\+\d+ lines?\)"))
        w.check("boqview", role, "Collapse all folds headings, with '+N lines' on each",
                f"{folded.count()} folded headings", folded.count() > 0)
        if folded.count():
            w.step(page, "boqview", "after", role, user, "Collapse all folds every heading and shows how many lines sit under it.",
                   pins=[pin(folded, "Folded heading with its hidden line count.", "info")])
        w.step(page, "boqview", "after", role, user, "Expand all brings every row back.", click=expand)
        settle(page, 1000)


# ---------------------------------------------------------------- Line Item View

def line_view() -> None:
    role, user = EE, USERS[EE]
    with session(AFTER, user, PW) as (page, _):
        open_project("lineview", page, "after", role, user)
        project_tab(page, "Estimates").first.click()
        wait_text(page, "With materials")
        w.step(page, "lineview", "after", role, user, "In Estimates, open Line Item View.",
               click=est_subtab(page, "Line Item View"))
        settle(page, 2500)
        page.locator("select").first.select_option(BOQ_B)
        settle(page, 3000)
        row = page.locator(f"#est-row-{LINE_VIEW['name']}")
        w.step(page, "lineview", "after", role, user,
               "Pick BOQ PART B in the BOQ box. Line Item View lists only line items, under their headings.",
               pins=[pin(page.locator("select").first, "BOQ picker (the project has 4 Selected BOQs).", "info")])
        w.step(page, "lineview", "after", role, user, f"Add materials to row {LINE_VIEW['row']}.",
               click=row.get_by_role("button", name="+ Add"))
        settle(page, 1200)
        dialog_add_item(page, "lineview", role, user, QTY["line"], bad_qty=None)
        check_saved("lineview", role, LINE_VIEW["name"], QTY["line"], user)
        # A line on another BOQ, with a sheet whose name ends in a space, so Estimate Items has two BOQs to add up.
        page.locator("select").first.select_option(BOQ_A)
        settle(page, 2500)
        page.get_by_role("tab", name=re.compile(r"^VAV\s")).first.click()
        settle(page, 2500)
        row = page.locator(f"#est-row-{LINE_OTHER['name']}")
        w.step(page, "lineview", "after", role, user,
               f"Switch to PART A ({BOQ_A}), sheet 'VAV ' (its name ends in a space), and add the same item to row {LINE_OTHER['row']}.",
               click=row.get_by_role("button", name="+ Add"))
        settle(page, 1200)
        dlg = page.get_by_role("dialog")
        dlg.get_by_role("button", name="+ Add item").click()
        settle(page, 1200)
        dlg.locator("input[id^=react-select]").nth(1).focus()
        page.keyboard.type(ITEM_NAME)
        page.wait_for_timeout(1200)
        page.keyboard.press("Enter")
        dlg.get_by_label("Quantity").fill(str(QTY["other"]))
        dlg.get_by_role("button", name="Add", exact=True).click()
        settle(page, 600)
        w.step(page, "lineview", "after", role, user, f"Item picked, qty {QTY['other']}, row added. Save.",
               click=dlg.get_by_role("button", name="Save", exact=True))
        settle(page, 2000)
        check_saved("lineview", role, LINE_OTHER["name"], QTY["other"], user)
        row = page.locator(f"#est-row-{LINE_OTHER['name']}")
        w.step(page, "lineview", "after", role, user, "Saved on the 'VAV ' sheet: the line shows its material.",
               pins=[pin(row.get_by_role("button", name=re.compile(r"1 item")), "1 item.", "info")])


# ---------------------------------------------------------------- Estimate Items

def estimate_items() -> None:
    role, user = EE, USERS[EE]
    t = db_json(AFTER, "totals", TOTALS, json.dumps({"project": PROJECT, "item": ITEM_ID}))
    with session(AFTER, user, PW) as (page, _):
        open_project("items", page, "after", role, user)
        project_tab(page, "Estimates").first.click()
        wait_text(page, "With materials")
        w.step(page, "items", "after", role, user, "In Estimates, open Estimate Items.",
               click=est_subtab(page, "Estimate Items"))
        settle(page, 3000)
        sel = page.locator("select").first
        if sel.input_value() != "all":
            sel.select_option("all")
            settle(page, 3000)
        row = page.locator("tr", has=page.get_by_text(ITEM_NAME, exact=True)).first
        cells = [c.strip() for c in row.locator("td").all_inner_texts()]
        want = [str(int(t["qty"])), str(t["lines"]), str(t["boqs"])]
        got = [cells[5], cells[6], cells[7]] if len(cells) >= 8 else cells
        w.check("items", role, f"Material totals, All BOQs: total {want[0]}, used in {want[1]} lines, {want[2]} BOQs (DB)",
                " | ".join(got), got == want)
        w.step(page, "items", "after", role, user,
               f"Material totals over All BOQs: the item from both BOQs is one row. The DB sum is {want[0]} NOS on {want[1]} lines in {want[2]} BOQs.",
               pins=[pin(row, f"Screen: total {got[0] if got else '?'}, lines {got[1] if len(got) > 1 else '?'}, BOQs {got[2] if len(got) > 2 else '?'}.",
                         "info" if got == want else "must"),
                     pin(sel, "All BOQs (4): every Selected BOQ and every sheet.", "info")])


# ---------------------------------------------------------------- roles

def roles() -> None:
    role, user = "Project Manager", USERS["Project Manager"]
    with session(AFTER, user, PW) as (page, _):
        open_project("roles", page, "after", role, user)
        tab = project_tab(page, "Estimates")
        w.check("roles", role, "sees the Estimates tab (it sees BoQ)", "shown" if tab.count() else "missing", tab.count() > 0)
        w.step(page, "roles", "after", role, user, "Project Manager: the Estimates tab shows, as BoQ does. Open it.", click=tab)
        wait_text(page, "With materials")
        settle(page)
        boq_row(page, BOQ_B).get_by_role("button", name="Open").click()
        page.locator(f"#est-row-{LINE_GRID['name']}").wait_for(timeout=30000)
        settle(page, 2000)
        adds = page.get_by_role("button", name="+ Add").count()
        edits = page.get_by_role("button", name=re.compile(r"^Edit")).count()
        row = page.locator(f"#est-row-{LINE_GRID['name']}")
        w.check("roles", role, "views only: no + Add and no Edit", f"{adds} + Add, {edits} Edit", adds == 0 and edits == 0)
        w.step(page, "roles", "after", role, user,
               "Project Manager sees the material count but no + Add and no Edit anywhere on the sheet.",
               pins=[pin(row.get_by_role("button", name=re.compile(r"1 item")), f"View only: {adds} + Add and {edits} Edit buttons on the sheet.",
                         "info" if adds == edits == 0 else "must")])

    role, user = "PMO", USERS["PMO"]
    with session(AFTER, user, PW) as (page, _):
        base = base_of(page)
        open_project("roles", page, "after", role, user)
        project_tab(page, "Estimates").first.click()
        wait_text(page, "With materials")
        boq_row(page, BOQ_B).get_by_role("button", name="Open").click()
        page.locator(f"#est-row-{LINE_GRID['name']}").wait_for(timeout=30000)
        settle(page, 2000)
        adds = page.get_by_role("button", name="+ Add").count()
        row = page.locator(f"#est-row-{LINE_GRID['name']}")
        w.check("roles", role, "may edit: + Add and Edit show", f"{adds} + Add", adds > 0)
        w.step(page, "roles", "after", role, user, "PMO on the same sheet: + Add on each line, and Edit on the line with materials.",
               pins=[pin(row.get_by_role("button", name="Edit", exact=True), "PMO may edit.", "info")])

    role, user = "Accountant", USERS["Accountant"]
    with session(AFTER, user, PW) as (page, _):
        open_project("roles", page, "after", role, user)
        est, boq = project_tab(page, "Estimates").count(), project_tab(page, "BoQ").count()
        w.check("roles", role, "no Estimates tab, as no BoQ tab", f"Estimates {'shown' if est else 'hidden'}, BoQ {'shown' if boq else 'hidden'}",
                est == 0 and boq == 0)
        w.step(page, "roles", "after", role, user, "Accountant: neither BoQ nor Estimates is on the project page.",
               pins=[pin(project_tab(page, "Bulk Download"),
                         "BoQ and Estimates would sit before Bulk Download; both are hidden.", "info")])

    role, user = EE, USERS[EE]
    with session(AFTER, user, PW) as (page, _):
        open_project("roles", page, "after", role, user, DONE_PROJECT_NAME)
        project_tab(page, "Estimates").first.click()
        wait_text(page, "read-only", 30000)
        settle(page)
        page.get_by_role("button", name="Open").first.click()
        settle(page, 4000)
        note = page.get_by_text(re.compile("Material estimates are read-only on a Completed project"))
        adds = page.get_by_role("button", name="+ Add").count()
        w.check("roles", role, "Completed project: read-only notice, no + Add",
                f"notice {'shown' if note.count() else 'missing'}, {adds} + Add", note.count() > 0 and adds == 0)
        w.step(page, "roles", "after", role, user,
               f"Estimates Executive on {DONE_PROJECT_NAME}, a Completed project: a read-only notice and no + Add.",
               pins=[pin(note, "Read-only on Completed and Handover projects.", "info")])


# ---------------------------------------------------------------- re-commit

def worker(start: bool) -> None:
    # The env's own code: devenv.sh start_web sets the same two variables, or Python imports the master checkout.
    bench = f"/workspace/development/benches/{AFTER}"
    py = f"{bench}/env/bin/python"
    if start:
        subprocess.run(["docker", "exec", "-d", "-w", f"/workspace/development/benches/{AFTER}/sites", CONTAINER, "bash", "-c",
                        f"FRAPPE_BENCH_ROOT={bench} PYTHONPATH={bench}/apps/nirmaan_stack "
                        f"exec {py} -m frappe.utils.bench_helper frappe worker >> ../logs/walk-worker.log 2>&1"], check=True)
        time.sleep(6)
    else:
        subprocess.run(["docker", "exec", CONTAINER, "pkill", "-f", f"{py} -m frappe.utils.bench_helper frappe worker"])
        time.sleep(2)


def recommit(label: str) -> None:
    role, user = "Admin", USERS["Admin"]
    v_new = db_json(AFTER, "recommit-version", SHEET_STATE, json.dumps({"boq": BOQ_B}))["sheet"]["commit_version"] + 1
    with session(AFTER, user, PW) as (page, _):
        open_project("recommit", page, "after", role, user)
        w.step(page, "recommit", "after", role, user, f"{label}: Admin opens the BoQ tab.", click=project_tab(page, "BoQ"))
        settle(page, 2500)
        row = page.locator("tr", has=page.get_by_text("(PART B)-HVAC", exact=False))
        w.step(page, "recommit", "after", role, user, "Open PART B's BOQ page with its edit (pencil) button.",
               click=row.locator("button, a").last)
        page.get_by_role("button", name="Commit", exact=True).wait_for(timeout=40000)
        settle(page, 2000)
        w.step(page, "recommit", "after", role, user, "Commit, as before this PR.",
               click=page.get_by_role("button", name="Commit", exact=True))
        settle(page, 1200)
        dlg = page.get_by_role("dialog")
        for cb in dlg.locator("button[role=checkbox]").all():
            want = facts["sheet_b"]["sheet_name"] in (cb.get_attribute("id") or "")
            if (cb.get_attribute("aria-checked") == "true") != want:
                cb.click()
        commit_btn = dlg.get_by_role("button", name=re.compile(r"^Commit \(1\)"))
        w.step(page, "recommit", "after", role, user, f"Tick only the sheet '{facts['sheet_b']['sheet_name']}' and commit it again.",
               click=commit_btn)
        settle(page, 3000)
        again = page.get_by_role("button", name=re.compile("Re-commit anyway|Commit anyway"))
        if again.count():
            w.step(page, "recommit", "after", role, user, "The app's own priced-rows warning (unchanged by this PR). Re-commit anyway.",
                   click=again)
        # The app answers with its own "Commit results" dialog naming the new version.
        # Lower-case "committed vN" is only the results line; the page's own chip says "Committed vN".
        done = page.get_by_text(re.compile(rf"— committed v{v_new}\b")).first
        done.wait_for(timeout=120000)
        settle(page, 2000)
        w.step(page, "recommit", "after", role, user, f"{label}: the commit goes through as before; nothing new to answer.",
               pins=[pin(done, f"New version v{v_new} committed.", "info")])


def open_sheet_b(page) -> None:
    project_tab(page, "Estimates").first.click()
    wait_text(page, "With materials")
    boq_row(page, BOQ_B).get_by_role("button", name="Open").click()
    page.get_by_text("Estimate Items", exact=True).nth(1).wait_for(timeout=30000)
    settle(page, 2500)


def clear_leftovers() -> None:
    """Setup, not evidence: an earlier run's estimates still waiting on an older version are re-attached first, so
    this run starts with every estimate on the current version."""
    with session(AFTER, USERS[EE], PW) as (page, _):
        page.goto(f"{base_of(page)}/projects/{PROJECT}?page=estimates&estTab=boq-view&estBoq={BOQ_B}")
        page.get_by_text("Estimate Items", exact=True).nth(1).wait_for(timeout=40000)
        settle(page, 2500)
        btn = page.get_by_role("button", name=re.compile(r"^Re-attach \(\d+\)"))
        if btn.count():
            print("setup: re-attaching leftovers:", btn.first.inner_text())
            btn.first.click()
            settle(page, 4000)


def recommit_flow() -> None:
    clear_leftovers()
    before = db_json(AFTER, "recommit-0", SHEET_STATE, json.dumps({"boq": BOQ_B}))
    n0 = len(before["current"])
    w.check("recommit", "setup", "PART B holds the walk's estimates before the re-commit",
            f"{n0} estimates on v{before['sheet']['commit_version']}", n0 >= 2, "info")

    # 1. No worker: the job is queued and waits, so the screen shows what Re-attach is for.
    worker(False)
    recommit("Re-commit 1 (no job worker running)")
    s1 = db_json(AFTER, "recommit-1", SHEET_STATE, json.dumps({"boq": BOQ_B}))
    w.check("recommit", "Admin", "the commit made a new version", f"v{before['sheet']['commit_version']} → v{s1['sheet']['commit_version']}",
            s1["sheet"]["commit_version"] > before["sheet"]["commit_version"])
    role, user = EE, USERS[EE]
    with session(AFTER, user, PW) as (page, _):
        open_project("recommit", page, "after", role, user)
        open_sheet_b(page)
        notice = page.get_by_text(re.compile(r"from an older version of this sheet"))
        btn = page.get_by_role("button", name=re.compile(r"^Re-attach \(\d+\)"))
        label = btn.first.inner_text() if btn.count() else "no Re-attach button"
        w.check("recommit", role, f"notice offers Re-attach ({n0})", label, label == f"Re-attach ({n0})")
        w.step(page, "recommit", "after", role, user,
               "With no job run yet, the sheet says its estimates sit on the older version. Re-attach copies them.",
               click=btn, pins=[pin(notice, "Older-version notice: lists what is not on the new version.", "info")])
        settle(page, 3000)
        strip = page.get_by_role("tab", name=re.compile(re.escape(facts["sheet_b"]["sheet_name"])))
        text = strip.first.inner_text().replace("\n", " ")
        w.step(page, "recommit", "after", role, user, "Re-attach copied them: the notice is gone and the sheet counts them again.",
               pins=[pin(strip, f"Sheet strip: {text}.", "info")])
    s1b = db_json(AFTER, "recommit-1b", SHEET_STATE, json.dumps({"boq": BOQ_B}))
    w.check("recommit", role, f"DB: {n0} estimates on v{s1b['sheet']['commit_version']}, owner kept ({user})",
            f"{len(s1b['current'])} on the new version, owners {sorted({e['owner'] for e in s1b['current']})}",
            len(s1b["current"]) == n0 and all(e["owner"] == user for e in s1b["current"]))

    # 2. Worker on: the after-commit job copies them by itself.
    worker(True)
    try:
        time.sleep(8)  # the job queued by re-commit 1 runs first and finds nothing left to copy
        recommit("Re-commit 2 (job worker running)")
        deadline = time.time() + 90
        s2 = {}
        while time.time() < deadline:
            s2 = db_json(AFTER, "recommit-2", SHEET_STATE, json.dumps({"boq": BOQ_B}))
            if len(s2["current"]) >= n0:
                break
            time.sleep(5)
    finally:
        worker(False)
    took = round(90 - (deadline - time.time()))
    w.check("recommit", "background job", f"copies the {n0} estimates to v{s2['sheet']['commit_version']} within 90 s",
            f"{len(s2['current'])} copied (about {took} s)", len(s2["current"]) == n0)
    w.check("recommit", "background job", f"each copy keeps its original owner ({user}), not Administrator",
            f"owners {sorted({e['owner'] for e in s2['current']})}", all(e["owner"] == user for e in s2["current"]))
    prev = [e for e in s2["older"] if e["v"] == s1b["sheet"]["commit_version"]]
    w.check("recommit", "background job", "the older copies are kept and marked settled",
            f"{len(prev)} kept on v{s1b['sheet']['commit_version']}, settled {sorted({e['settled'] for e in prev})}",
            len(prev) == n0 and all(e["settled"] for e in prev))
    with session(AFTER, user, PW) as (page, _):
        open_project("recommit", page, "after", role, user)
        open_sheet_b(page)
        notice = page.get_by_text(re.compile(r"from an older version of this sheet"))
        strip = page.get_by_role("tab", name=re.compile(re.escape(facts["sheet_b"]["sheet_name"])))
        text = strip.first.inner_text().replace("\n", " ")
        w.check("recommit", role, "no older-version notice after the job ran", "notice shown" if notice.count() else "no notice",
                notice.count() == 0)
        w.step(page, "recommit", "after", role, user,
               f"After re-commit 2 the job copied the estimates by itself: no notice, and the sheet still counts them ({text}).",
               pins=[pin(strip, f"Sheet strip: {text}.", "info")])
    w.status("delete", "not_walked", "No screen deletes a Selected BOQ with estimates; the walk does not delete env data. "
                                     "The PR's tests cover it.")


def description() -> None:
    """The PR description as GitHub returns it (gh pr view), set as plain text, with what is not for reviewers pinned.
    How GitHub renders it was read with GitHub's own markdown API (`gh api markdown`), saved under db/."""
    import html

    from playwright.sync_api import sync_playwright

    gh = ["gh", "pr", "view", "1717", "--repo", "Nirmaan-app/nirmaan_stack_frappe15_postgres_14", "--json", "body", "-q", ".body"]
    body = subprocess.run(gh, capture_output=True, text=True, check=True).stdout
    (out / "db").mkdir(exist_ok=True)
    (out / "db" / "pr-body.md").write_text(body)
    rendered = subprocess.run(["gh", "api", "markdown", "-f", "mode=gfm", "-F", f"text=@{out / 'db' / 'pr-body.md'}"],
                              capture_output=True, text=True, check=True).stdout
    (out / "db" / "pr-body.rendered.html").write_text(rendered)
    # GitHub colours code inside <pre> with <span>s, so strip tags before looking for the heading's raw text.
    summary_as_code = any("## Summary" in html.unescape(re.sub(r"<[^>]+>", "", block))
                          for block in re.findall(r"<pre.*?</pre>", rendered, re.S))
    fence = body.find("```markdown")
    leftover = body.find("Before you open the PR")
    plan = body.find("`frontend/.claude/plans/boq-upload-plan.md` is also staged")
    if leftover < 0:
        w.check("description", "Reviewer", "the description holds only text for reviewers", "clean", True, "should")
        return
    cut_head = body.find("\n", fence) + 1 if fence >= 0 else 0
    parts = [("intro", body[:cut_head]), ("middle", body[cut_head:leftover]),
             ("tail", body[leftover:plan] if plan > 0 else body[leftover:]), ("plan", body[plan:] if plan > 0 else "")]
    pre = "<pre id='{}' style='white-space:pre-wrap;margin:0'>{}</pre>"
    page_html = ("<body style='font:15px/1.5 system-ui;margin:32px 120px'><h2>PR #1717 description, as text (gh pr view)</h2>"
                 + "".join(pre.format(k, html.escape(v)) for k, v in parts if v) + "</body>")
    w.check("description", "Reviewer", "the description holds only text for reviewers",
            "starts with a drafting header and a ```markdown fence; ends with notes to the author about staged files", False, "should")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.set_content(page_html)
        if fence >= 0:
            w.step(page, "description", "after", "Reviewer", "GitHub",
                   "The PR description is a pasted draft: it opens with a note on who it is for and a ```markdown fence.",
                   pins=[pin(page.locator("#intro"),
                             "Drafting wrapper. GitHub's own renderer (gh api markdown) shows the Summary that follows as "
                             f"{'raw code, with the ** marks visible' if summary_as_code else 'text'}. Ask the author to paste "
                             "only the text inside the fence.", "should")])
        page.locator("#tail").scroll_into_view_if_needed()
        pins = [pin(page.locator("#tail"),
                    "Notes to the author, not reviewers: it says some files were only staged. All five files it names are in "
                    "the PR's file list. Ask the author to remove these lines.", "should")]
        if plan > 0:
            pins.append(pin(page.locator("#plan"),
                            "The PR adds 26 lines to frontend/.claude/plans/boq-upload-plan.md. Fine under develop's CLAUDE.md; "
                            "the laptop's master CLAUDE.md (since 2026-11-22, 10a823665) calls that file a closed record "
                            "that takes no new text, so it clashes on a merge into master.", "info"))
        w.step(page, "description", "after", "Reviewer", "GitHub",
               "It ends with notes meant for the author: commit the staged files, and a list of them.", pins=pins)
        browser.close()


PLAN = [("tab", tab_before), ("boqview", boq_view), ("lineview", line_view), ("items", estimate_items),
        ("roles", roles), ("recommit", recommit_flow), ("description", description)]
only = set(sys.argv[2:])
for cid, fn in PLAN:
    if not only or fn.__name__ in only:
        guarded(cid, fn)

for c in w.data["changes"]:
    if c["status"] == "failed":
        continue
    bad = [k for k in w.data["checks"] if k["change"] == c["id"] and not k["ok"] and k["kind"] == "must"]
    musts = [p for s in w.data["steps"] if s["change"] == c["id"] for p in s["pins"] if p["kind"] == "must"]
    if not any(s["change"] == c["id"] for s in w.data["steps"]):
        continue
    w.status(c["id"], "failed" if bad or musts else "seen",
             "; ".join(f"{k['role']}: expected {k['expect']}, saw {k['seen']}" for k in bad))
print(w.save())
