"""Walk branch feat/planning-and-projects-info (search on the planning screens, Link / Change PO-WO from Edit, Plan N
as on develop, All Time that sticks; the Projects list / Cash Sheet money-column ⓘ as bullet points and the credit
totals leaving out Cancelled POs) on its env and on an env of develop, before vs after. The branch has no PR: its
claims are its 10 commits (1434d6262..6611ad5aa).

    python3 .claude/skills/pr-walk/bin/walk_branch_planning_and_projects_info.py <out dir> --after <env> --before <env> \
        --admin <email> --pmo <email> --pe <email> [--password <pw>] [--one-lane] [function ...]

Run it from the checkout root with the users' passwords set on both envs. Both envs carry the same 11 Cashflow rows on
CTS Chennai, seeded by `walk_branch_planning_and_projects_info_seed.py` (`devenv.sh script <env> <it>`, remarks end
"(walk data)"); the template has none. Every figure is read
from the env's DB at the start of each side (FACTS, saved under db/). The after side writes: Admin changes one
material plan's PO, Admin links the New PO cashflow entry, PMO links the New WO entry; each write is read back from
the DB. --one-lane walks every before screen first with only that env served, then the after env.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import subprocess
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parents[1] / "verify" / "bin"))
sys.path.insert(0, str(HERE))
from drive import base_url, session, sidebar  # noqa: E402
from record import Walk, pin  # noqa: E402

DEVENV = str(ROOT / "scripts/devenv/devenv.sh")
P, PNAME = "KANCHIPURAM-PROJ-00107", "CTS Chennai"
CONTAINER = "frappe_docker_devcontainer-frappe-1"
PEN = "button:has(svg.lucide-pen), button:has(svg.lucide-edit-2)"
OPTION = "[id*='-option-']"

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("only", nargs="*")
ap.add_argument("--after", required=True)
ap.add_argument("--before", required=True)
ap.add_argument("--admin", required=True)
ap.add_argument("--pmo", required=True)
ap.add_argument("--pe", required=True, help="a Procurement Executive who sees CTS Chennai")
ap.add_argument("--password", default="WalkPw-Planning")
ap.add_argument("--one-lane", action="store_true")
a = ap.parse_args()
ENVS = {"after": a.after, "before": a.before}
ADMIN, PMO, PE = "Admin", "PMO Executive", "Procurement Executive"
USERS = {ADMIN: a.admin, PMO: a.pmo, PE: a.pe}
SHOWN_USER = {ADMIN: a.admin, PMO: a.pmo, PE: "a Procurement Executive (test login)"}
out = Path(a.out)

w = Walk(out, pr={"number": "feat/planning-and-projects-info", "title": "Planning search, Link / Change PO-WO, Plan N "
                  "as on develop, All Time that sticks, Projects ⓘ as points, credit totals without Cancelled POs",
                  "url": "", "author": "", "head": "6611ad5aa", "base": "1434d6262"},
         envs=ENVS, data_note="a copy of the dev database (template of 2026-11-19), plus 11 made-up Cashflow rows on "
                              "CTS Chennai marked \"(walk data)\", the same on both envs")

w.change("mp_search", "1 · Material Plan: search",
         "A search box beside the date and status filters. Every word typed must appear in the plan (item name, PO, "
         "task, category, remarks); plans keep their Plan N; a plan matched by an item opens with the item highlighted.")
w.change("wp_search", "2 · Work Plan: search and Collapse all",
         "Planned Activities get a search box (task, milestone, note) and a Collapse all / Expand all button.")
w.change("cf_search", "3 · Cashflow: search",
         "One search box over the Cashflow tabs (PO / WO, vendor, item, remarks); the matched entry keeps its Plan N.")
w.change("mp_link", "4 · Material Plan Edit: Change PO, Admin and PMO only",
         "In Edit, the PO badge in the header carries a pencil for Admin and PMO only. It opens a picker with the "
         "plan's task POs and \"See all project POs\"; picking a PO swaps the item list to that PO's items; Confirm "
         "saves the plan on the new PO with the ticked items. Other roles that can edit a plan get no pencil.")
w.change("cf_po_link", "5 · Cashflow PO Edit: Link PO",
         "A New PO cashflow entry's \"PO ID\" badge has a pencil (Admin, PMO). Picking a PO fills its vendor and "
         "items; Confirm makes the entry Existing PO on that PO.")
w.change("cf_wo_link", "6 · Cashflow WO Edit: Link WO, found by its description",
         "A New WO entry's \"WO ID\" badge has a pencil (Admin, PMO). The WO picker also searches the WO's "
         "descriptions (\"unloading\" finds the forklift WO) and shows the first one in the option; Confirm makes "
         "the entry Existing WO.")
w.change("numbers", "7 · Plan N: 1, 2, 3 newest first, as on develop and in the PDF",
         "Material Plan numbers its plans by position, newest first, exactly as develop. Cashflow lists are now sorted "
         "newest first (develop asked for no order, so Postgres' storage order showed), so the WO tab's Plan N matches "
         "its PDF.")
w.change("all_time", "8 · All Time sticks after switching planning tab",
         "Open the planning tabs with a custom range in the link, pick All Time, switch tab: develop shows the old "
         "Custom Range again and picking All Time does nothing; the branch keeps All Time.")
w.change("guard", "9 · Server refuses a PO / WO change by other roles",
         "MaterialDeliveryPlan.validate and CashflowPlan.validate refuse a change of po_link / id_link by anyone but "
         "Admin and PMO. The app shows those users no pencil, so the walk sends the change the only way they can: a "
         "request to the API from their own logged-in browser session (they have write permission and no Desk).")
w.change("proj_info", "10 · Projects list and Cash Sheet: column ⓘ as bullet points",
         "The ⓘ of the money columns (Notional GST, Inflow, Project Outflow, Current Liabilities, Cashflow Gap) shows "
         "short bullet points instead of one sentence, on the Projects list and the Cash Sheet (Reports > Projects); "
         "Total Purchase Over Credit gets an ⓘ. Wording only, no figure changes.")
w.change("credit_cancel", "11 · Credit totals leave out Cancelled POs",
         "Total Purchase Over Credit on the Cash Sheet, the project's Financials tab and its PO Summary card leaves out "
         "Cancelled POs, as the Projects list already did. (Setup: one PO with a credit term is set Cancelled on both "
         "envs, since the copied data has none.)")


# ---------------------------------------------------------------- DB


def db(task: str, name: str, code: str, *args: str) -> str:
    src = out / "db" / f"{name}.py"
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_text("import json, sys\nimport frappe\n" + code)
    res = subprocess.run([DEVENV, "script", task, str(src), *args], capture_output=True, text=True, timeout=300)
    (out / "db" / f"{name}.txt").write_text(res.stdout + res.stderr)
    return res.stdout


def db_json(task: str, name: str, code: str, *args: str) -> dict:
    line = next(l for l in db(task, name, code, *args).splitlines() if l.startswith("JSON "))
    return json.loads(line[5:])


FACTS_CODE = r'''
P = sys.argv[1]
mp = frappe.get_all("Material Delivery Plan", filters={"project": P}, fields=["name", "po_link", "po_type",
     "critical_po_task", "mp_items"], order_by="creation desc")
by_po = {}
for i, m in enumerate(mp, 1):
    if m.po_link:
        by_po.setdefault(m.po_link, []).append(i)
shared = sorted(((po, n) for po, n in by_po.items() if len(n) > 1), key=lambda x: (-len(x[1]), x[0]))
target = next(m for m in mp if m.po_type == "Existing PO" and m.critical_po_task)
cf = frappe.get_all("Cashflow Plan", filters={"project": P}, fields=["name", "type", "id_link", "vendor_name",
     "items", "remarks"], order_by="creation desc")
wo = [c for c in cf if c.type in ("New WO", "Existing WO")]
po = [c for c in cf if c.type in ("New PO", "Existing PO")]
fork = [c for c in wo if "forklift" in ((c.vendor_name or "") + json.dumps(c["items"] or "")).lower()]
print("JSON " + json.dumps({
    "mp": [{"name": m.name, "po": m.po_link, "type": m.po_type} for m in mp],
    "mp_search_po": shared[0][0] if shared else None, "mp_search_labels": shared[0][1] if shared else [],
    "mp_target": {"name": target.name, "po": target.po_link, "task": target.critical_po_task,
                  "label": [m.name for m in mp].index(target.name) + 1},
    "wo": [{"name": c.name, "id": c.id_link or "", "type": c.type, "vendor": c.vendor_name} for c in wo],
    "po": [{"name": c.name, "id": c.id_link or "", "type": c.type, "vendor": c.vendor_name} for c in po],
    "new_po": next((c.name for c in po if c.type == "New PO"), None),
    "new_wo": next((c.name for c in wo if c.type == "New WO"), None),
    "fork_labels": [i for i, c in enumerate(wo, 1) if c in fork],
    "wp_rows": frappe.db.count("Work Plan", {"project": P}),
}, default=str))
'''

READ_CODE = r'''
d = frappe.get_doc(sys.argv[1], sys.argv[2])
print("JSON " + json.dumps({k: d.get(k) for k in sys.argv[3].split(",")}, default=str))
'''

GUARD_CODE = r'''
import frappe
out = {}
for dt, field, name, user in json.loads(sys.argv[1]):
    frappe.set_user(user)
    d = frappe.get_doc(dt, name)
    d.set(field, "WALK-GUARD-CHECK")
    try:
        d.run_method("validate")
        out[dt] = "allowed"
    except frappe.PermissionError as e:
        out[dt] = "refused: " + str(e)[:140]
    except Exception as e:
        out[dt] = "error: " + type(e).__name__ + " " + str(e)[:120]
    frappe.db.rollback()
print("JSON " + json.dumps(out))
'''

CREDIT_CODE = r'''
# Setup (env DB only): pick a project whose biggest open-credit PO can be Cancelled, cancel it, and report the
# credit figures each rule gives. Re-runs find the PO already Cancelled and report the same.
row = frappe.db.sql("""
    select po.name, po.project, sum(t.amount) amt from "tabPO Payment Terms" t join "tabProcurement Orders" po
      on po.name = t.parent where t.payment_type = 'Credit' and po.status in ('Delivered', 'Cancelled')
      group by po.name, po.project
    having sum(t.amount) >= 100000 order by (po.status = 'Cancelled') desc, sum(t.amount) desc limit 1""", as_dict=1)[0]
if frappe.db.get_value("Procurement Orders", row.name, "status") != "Cancelled":
    frappe.db.set_value("Procurement Orders", row.name, "status", "Cancelled", update_modified=False)
    frappe.db.commit()
def credit(excl):
    return float(frappe.db.sql("""select coalesce(sum(t.amount), 0) from "tabPO Payment Terms" t join
        "tabProcurement Orders" po on po.name = t.parent where t.payment_type = 'Credit' and po.project = %s
        and po.status not in %s""", (row.project, tuple(excl)))[0][0])
print("JSON " + json.dumps({"po": row.name, "project": row.project, "project_name":
      frappe.db.get_value("Projects", row.project, "project_name"), "po_credit": float(row.amt),
      "with_cancelled": credit(["Merged", "Inactive"]), "without_cancelled": credit(["Merged", "Cancelled", "Inactive"])}))
'''

GUARD_API_CODE = r'''
P = sys.argv[1]
mp = frappe.get_all("Material Delivery Plan", filters={"project": P, "po_type": "Existing PO"}, fields=["name", "po_link"],
                    order_by="creation desc", limit=2)[-1]
cf = frappe.get_all("Cashflow Plan", filters={"project": P, "type": "Existing PO"}, fields=["name", "id_link"],
                    order_by="creation asc", limit=1)[0]
pos = frappe.get_all("Procurement Orders", filters={"project": P, "status": ["not in", ["Merged", "Cancelled", "Inactive"]]},
                     pluck="name", order_by="name")
other = lambda cur: next(x for x in pos if x != cur)
print("JSON " + json.dumps({"mp": mp.name, "mp_po": mp.po_link, "mp_new": other(mp.po_link),
                            "cf": cf.name, "cf_po": cf.id_link, "cf_new": other(cf.id_link)}))
'''

FACTS = {}


def facts(side: str) -> dict:
    if side not in FACTS:
        FACTS[side] = db_json(ENVS[side], f"facts_{side}", FACTS_CODE, P)
    return FACTS[side]


# ---------------------------------------------------------------- screen helpers


def settle(page, ms: int = 1500) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def tracker(page, label: str) -> None:
    sidebar(page, label)
    settle(page, 2500)
    page.get_by_text(PNAME, exact=True).first.click()
    settle(page, 3500)


def main_text(page) -> str:
    return page.locator("main").first.inner_text()


def mp_labels(page) -> list[tuple[int, str | None]]:
    """(Plan N, its PO or None) for every material plan card on screen, top to bottom."""
    segs = re.split(r"\n(?=Plan \d+\n)", main_text(page))
    res = []
    for s in segs:
        m = re.match(r"Plan (\d+)\n", s)
        if m:
            po = re.search(r"PO/\d{3}/\d{5}/\d\d-\d\d", s)
            res.append((int(m.group(1)), po.group(0) if po else None))
    return res


def cf_labels(page) -> list[tuple[int, str]]:
    """(Plan N, its SR / PO or "new") for every cashflow card on the active tab."""
    segs = re.split(r"\n(?=PLAN \d+\n)", main_text(page), flags=re.I)
    res = []
    for s in segs:
        m = re.match(r"PLAN (\d+)\n", s, re.I)
        if m:
            idm = re.search(r"SR-\d{5}-\d{6}|PO/\d{3}/\d{5}/\d\d-\d\d", s)
            res.append((int(m.group(1)), idm.group(0) if idm else "new"))
    return res


def card_of(page, text: str):
    """The cashflow / plan card that holds `text` and an edit pencil."""
    return page.get_by_text(text, exact=False).first.locator(
        f"xpath=ancestor::div[.//button[.//*[contains(@class,'lucide-pen') or contains(@class,'lucide-edit-2')]]][1]")


def date_button(page):
    return page.get_by_role("button", name=re.compile(r"^(All Time|Custom Range|Next \d+ Days)$")).first


def search_box(page, label: str):
    return page.get_by_label(label)


def pdf_view(page, pdf: Path):
    """Page 1 of a PDF as an image in a new tab (macOS sips renders it), its text read with the container's pypdf."""
    img = pdf.with_suffix(".p1.jpg")
    subprocess.run(["sips", "-s", "format", "jpeg", "-Z", "1300", str(pdf), "--out", str(img)], capture_output=True,
                   check=True)
    subprocess.run(["docker", "cp", str(pdf), f"{CONTAINER}:/tmp/walk_planning.pdf"], check=True)
    text = subprocess.run(["docker", "exec", "-w", "/workspace/development/frappe-bench", CONTAINER, "env/bin/python",
                           "-I", "-c", "from pypdf import PdfReader;r=PdfReader('/tmp/walk_planning.pdf');"
                           "print('\\n'.join(p.extract_text() or '' for p in r.pages))"],
                          capture_output=True, text=True, check=True).stdout
    view = page.context.new_page()
    view.set_viewport_size(page.viewport_size)
    view.set_content('<body style="margin:0;background:#e5e7eb"><img style="display:block;margin:auto" '
                     f'src="data:image/jpeg;base64,{base64.b64encode(img.read_bytes()).decode()}"></body>')
    return view, text


def picker(page):
    """The PO / WO picker's box in the open dialog (react-select's control); its placeholder text sits under the
    input, so a click on the text never lands."""
    return page.get_by_role("combobox", name=re.compile(r"^Pick the (PO|WO)")).first.locator(
        "xpath=ancestor::div[contains(@class,'-control')][1]")


def visible(page, label: str):
    """The visible element with this aria-label (the Cashflow search renders twice, one hidden by layout)."""
    return page.locator(f"[aria-label='{label}']:visible").first


def step(page, cid, side, role, caption, **kw):
    return w.step(page, cid, side, role, SHOWN_USER[role], caption, **kw)


# ---------------------------------------------------------------- before (develop)


def mp_before() -> None:
    f = facts("before")
    with session(ENVS["before"], USERS[ADMIN], a.password) as (page, _):
        settle(page)
        sidebar(page, "Material Plan Tracker")
        settle(page, 2500)
        step(page, "mp_search", "before", ADMIN, "Develop: Material Plan Tracker lists the projects; open CTS Chennai.",
             click=page.get_by_text(PNAME, exact=True))
        settle(page, 3500)
        has = page.get_by_label("Search material plans").count()
        w.check("mp_search", ADMIN, "develop has no Material Plan search", "search box" if has else "none", not has,
                kind="info")
        shown = mp_labels(page)
        exp = [(i, m["po"] or None) for i, m in enumerate(f["mp"], 1)]  # a New PO plan stores '' 
        w.check("numbers", ADMIN, f"develop numbers the {len(exp)} plans 1..{len(exp)} newest first (DB order)",
                f"{shown} (DB: {exp})" if shown != exp else str(shown), shown == exp)
        FACTS["before_mp_screen"] = shown
        step(page, "numbers", "before", ADMIN, f"Develop: Plan 1 is the newest plan ({exp[0][1]}); no search box "
             "beside the date and status filters.",
             pins=[pin(page.get_by_text("Plan 1", exact=True).first, "Plan 1 = newest, as the PDF prints it.", "info"),
                   pin(date_button(page), "No search box beside the filters on develop.", "info")])
        page.get_by_title("Edit Plan").first.click()
        settle(page)
        has_pen = page.get_by_role("button", name=re.compile(r"Change PO|Link PO")).count()
        w.check("mp_link", ADMIN, "develop: no Change PO in the Edit dialog", "present" if has_pen else "absent",
                not has_pen, kind="info")
        step(page, "mp_link", "before", ADMIN, "Develop: the Edit dialog shows the PO as plain text; it cannot be changed.",
             pins=[pin(page.get_by_text(re.compile(r"PO/\d{3}/\d{5}/\d\d-\d\d")).first, "PO is plain text, no pencil.",
                       "info")])


def wp_before() -> None:
    with session(ENVS["before"], USERS[ADMIN], a.password) as (page, _):
        settle(page)
        tracker(page, "Work Plan Tracker")
        has = page.get_by_label("Search planned activities").count() + page.get_by_role("button", name="Collapse all").count()
        w.check("wp_search", ADMIN, "develop: no Work Plan search, no Collapse all", "present" if has else "absent",
                not has, kind="info")
        step(page, "wp_search", "before", ADMIN, "Develop: Planned Activities has only the date and Status filters.",
             pins=[pin(date_button(page), "No search, no Collapse all on develop.", "info")])


def cf_before() -> None:
    f = facts("before")
    with session(ENVS["before"], USERS[ADMIN], a.password) as (page, _):
        settle(page)
        tracker(page, "Cashflow Plan Tracker")
        has = page.get_by_label("Search cashflow plans").count()
        w.check("cf_search", ADMIN, "develop: no Cashflow search", "present" if has else "absent", not has, kind="info")
        step(page, "cf_search", "before", ADMIN, "Develop: Cashflow tabs, with the date filter and Export only.",
             click=page.get_by_text("WO Cashflow", exact=True))
        settle(page, 2500)
        shown = cf_labels(page)
        dbo = [x["id"] or "new" for x in f["wo"]]
        w.check("numbers", ADMIN, "develop's WO tab is NOT newest first (no sort asked)",
                f"screen order {[s[1] for s in shown]}, newest first would be {dbo}",
                [s[1] for s in shown] != dbo, kind="info")
        step(page, "numbers", "before", ADMIN, "Develop: the WO tab in storage order, not newest first, so Plan N "
             "differs from the PDF (newest first).",
             pins=[pin(page.get_by_text(re.compile(r"^Plan 1$", re.I)).first,
                       f"Plan 1 here is {shown[0][1] if shown else '?'}; the PDF's Plan 1 is the newest ({dbo[0]}).",
                       "info")])
        page.locator(PEN).first.click()
        settle(page)
        has_pen = page.get_by_role("button", name=re.compile(r"Link WO|Change WO")).count()
        w.check("cf_wo_link", ADMIN, "develop: the WO entry cannot be linked from Edit", "present" if has_pen else "absent",
                not has_pen, kind="info")
        step(page, "cf_wo_link", "before", ADMIN, "Develop: Edit WO Cashflow Plan has no way to link a WO.",
             pins=[pin(page.get_by_text("Edit WO Cashflow Plan", exact=False).first,
                       "No WO ID pencil on develop.", "info")])


def all_time(side: str) -> None:
    with session(ENVS[side], USERS[ADMIN], a.password) as (page, _):
        settle(page)
        # Setup: open the project's planning tabs from a link that holds a custom range (a bookmark, a shared link).
        page.goto(base_url(ENVS[side]) + f"/projects/{P}?page=7dayplanning&planningTab=Material%20Plan"
                  "&planningDuration=custom&startDate=2026-10-01&endDate=2026-10-31")
        settle(page, 4000)
        step(page, "all_time", side, ADMIN, "The planning tabs opened from a link with a custom range (1–31 Oct). "
             "Open the date filter.", click=date_button(page))
        step(page, "all_time", side, ADMIN, "Pick All Time.", click=page.get_by_role("menuitem", name="All Time"))
        settle(page)
        step(page, "all_time", side, ADMIN, "All Time is set. Switch to the Work Plan tab.",
             click=page.get_by_role("button", name="Work Plan", exact=True))
        settle(page, 3000)
        label = date_button(page).inner_text().strip()
        ok = label == "All Time"
        w.check("all_time", ADMIN, "after the tab switch the filter still reads All Time", label,
                ok if side == "after" else True, kind="must" if side == "after" else "info")
        step(page, "all_time", side, ADMIN, f"Work Plan tab: the date filter reads \"{label}\". Pick All Time again.",
             click=date_button(page),
             pins=[] if ok else [pin(date_button(page), "The old Custom Range came back although All Time was picked.",
                                     "info" if side == "before" else "must")])
        step(page, "all_time", side, ADMIN, "Pick All Time.", click=page.get_by_role("menuitem", name="All Time"))
        settle(page)
        label2 = date_button(page).inner_text().strip()
        w.check("all_time", ADMIN, "picking All Time again shows All Time", label2,
                label2 == "All Time" if side == "after" else True, kind="must" if side == "after" else "info")
        step(page, "all_time", side, ADMIN, f"After picking All Time again the filter reads \"{label2}\".",
             pins=[pin(date_button(page), "Stuck: the click changed nothing." if label2 != "All Time" else
                       "All Time.", "info" if side == "before" or label2 == "All Time" else "must")])


def all_time_before() -> None:
    all_time("before")


# ---------------------------------------------------------------- after (branch)


def mp_after() -> None:
    f = facts("after")
    with session(ENVS["after"], USERS[ADMIN], a.password) as (page, _):
        settle(page)
        sidebar(page, "Material Plan Tracker")
        settle(page, 2500)
        step(page, "mp_search", "after", ADMIN, "Material Plan Tracker: open CTS Chennai.",
             click=page.get_by_text(PNAME, exact=True))
        settle(page, 3500)
        shown = mp_labels(page)
        exp = [(i, m["po"] or None) for i, m in enumerate(f["mp"], 1)]  # a New PO plan stores '' 
        w.check("numbers", ADMIN, f"Plan 1..{len(exp)} newest first (DB order), as develop", f"{shown} (DB: {exp})" if shown != exp else str(shown),
                shown == exp)
        if "before_mp_screen" in FACTS:
            w.check("numbers", ADMIN, "the same Plan N for every plan as on develop", "same" if
                    shown == FACTS["before_mp_screen"] else "different", shown == FACTS["before_mp_screen"])
        box = page.get_by_label("Search material plans")
        step(page, "numbers", "after", ADMIN, f"Plan 1 is the newest plan ({exp[0][1]}), as on develop and in the PDF. "
             "A search box sits beside the filters.", click=box,
             pins=[pin(page.get_by_text("Plan 1", exact=True).first, "Plan 1 = newest, as develop.", "info")])
        po = f["mp_search_po"]
        box.fill(po)
        settle(page, 1500)
        found = mp_labels(page)
        w.check("mp_search", ADMIN, f"searching {po} shows exactly Plans {f['mp_search_labels']}",
                str([n for n, _ in found]), [n for n, _ in found] == f["mp_search_labels"])
        w.check("mp_search", ADMIN, "every plan shown is on that PO", str({p for _, p in found}),
                all(p == po for _, p in found))
        step(page, "mp_search", "after", ADMIN, f"Searching \"{po}\": only its {len(found)} plans, each keeping its "
             "Plan N.", pins=[pin(page.get_by_text(f"Plan {found[0][0]}", exact=True).first if found else box,
                                  f"Plan {found[0][0] if found else '?'} keeps its number while searching.", "info")])
        page.get_by_label("Clear search").first.click()
        settle(page)
        # Change PO on the newest plan with a task.
        t = f["mp_target"]
        page.get_by_title("Edit Plan").nth(t["label"] - 1).click()
        settle(page)
        badge = page.get_by_role("button", name=re.compile(r"Change PO"))
        step(page, "mp_link", "after", ADMIN, f"Edit Plan {t['label']} ({t['po']}, task {t['task']}): the PO badge "
             "in the header carries a pencil.", click=badge)
        settle(page)
        summary = page.get_by_text(re.compile(r"POs? linked to this plan's task"))
        stext = summary.first.inner_text() if summary.count() else ""
        step(page, "mp_link", "after", ADMIN, f"Change PO: \"{stext}\" by default. See all project POs widens it.",
             click=page.get_by_role("button", name="See all project POs"),
             pins=[pin(summary.first, "Only this task's POs at first, as Add Material Plan.", "info")])
        settle(page)
        allsum = page.get_by_text(re.compile(r"^All \d+ project POs"))
        step(page, "mp_link", "after", ADMIN, "All project POs, this task's first. Back to this task's POs and open "
             "the list.", click=page.get_by_role("button", name="Show only this task's POs"),
             pins=[pin(allsum.first, allsum.first.inner_text() if allsum.count() else "All project POs", "info")])
        settle(page)
        picker(page).click()
        settle(page, 1000)
        opts = page.locator(OPTION)
        pick = next(i for i in range(opts.count()) if not opts.nth(i).inner_text().startswith(t["po"]))
        new_po = opts.nth(pick).inner_text().split(" · ")[0]
        step(page, "mp_link", "after", ADMIN, f"The task's POs; pick {new_po}.", click=opts.nth(pick))
        settle(page)
        boxes = page.locator("[role='checkbox']:visible")
        step(page, "mp_link", "after", ADMIN, f"The item list is now {new_po}'s items, unticked. Tick the first.",
             click=boxes.first)
        settle(page, 800)
        step(page, "mp_link", "after", ADMIN, "Confirm.", click=page.get_by_role("button", name="Confirm"))
        settle(page, 2500)
        d = db_json(ENVS["after"], "mp_after_save", READ_CODE, "Material Delivery Plan", t["name"], "po_link,po_type")
        w.check("mp_link", ADMIN, f"the plan is saved on {new_po}", str(d), d["po_link"] == new_po)
        step(page, "mp_link", "after", ADMIN, f"Saved: Plan {t['label']} now reads {new_po}.",
             pins=[pin(page.get_by_text(new_po).first, f"Plan {t['label']} on {new_po} (DB: {d['po_link']}).", "info")])


def mp_role(role: str) -> None:
    with session(ENVS["after"], USERS[role], a.password) as (page, _):
        settle(page)
        tracker(page, "Material Plan Tracker")
        page.get_by_title("Edit Plan").first.click()
        settle(page)
        n = page.get_by_role("button", name=re.compile(r"Change PO|Link PO")).count()
        allowed = role == PMO
        w.check("mp_link", role, "pencil on the PO badge" if allowed else "no pencil on the PO badge",
                "pencil" if n else "no pencil", bool(n) == allowed)
        po_text = page.get_by_text(re.compile(r"^PO: PO/")).first
        step(page, "mp_link", "after", role, f"{role} opens Edit: the PO badge "
             + ("carries the pencil." if n else "is plain text (no pencil)."),
             pins=[pin(page.get_by_role("button", name=re.compile(r"Change PO")).first if n else po_text,
                       "Pencil: may change the PO." if n else "No pencil: only Admin and PMO change a plan's PO.",
                       "info")])


def mp_pmo_after() -> None:
    mp_role(PMO)


def mp_pe_after() -> None:
    mp_role(PE)


def wp_after() -> None:
    with session(ENVS["after"], USERS[ADMIN], a.password) as (page, _):
        settle(page)
        tracker(page, "Work Plan Tracker")
        box = page.get_by_label("Search planned activities")
        all_cards = len(re.findall(r"\nTASK\n", "\n" + main_text(page), re.I))
        step(page, "wp_search", "after", ADMIN, f"Planned Activities ({all_cards} cards shown): a search box and "
             "Collapse all beside the filters. Collapse all.", click=page.get_by_role("button", name="Collapse all"),
             pins=[pin(box, "Search task, milestone, note.", "info")])
        settle(page)
        exp_all = page.get_by_role("button", name="Expand all")
        w.check("wp_search", ADMIN, "Collapse all folds the groups and turns into Expand all",
                "Expand all" if exp_all.count() else "no Expand all", exp_all.count() > 0)
        step(page, "wp_search", "after", ADMIN, "Collapsed: only the group headers; the button reads Expand all.",
             click=exp_all)
        settle(page)
        step(page, "wp_search", "after", ADMIN, "Expanded again. Search a word.", click=box)
        word = "Grill"
        box.fill(word)
        settle(page, 1500)
        cards = re.split(r"\nTASK\n", "\n" + main_text(page), flags=re.I)[1:]
        w.check("wp_search", ADMIN, f"every activity shown mentions \"{word}\"", f"{len(cards)} of {all_cards} shown",
                bool(cards) and len(cards) < all_cards and all(word.lower() in c.split("\nUpdate")[0].lower()
                                                               or word.lower() in c.lower() for c in cards))
        step(page, "wp_search", "after", ADMIN, f"Searching \"{word}\": {len(cards)} activities. Collapse all hides "
             "while searching (the search opens what it finds).", pins=[pin(box, f"\"{word}\"", "info")])


def cf_after() -> None:
    f = facts("after")
    with session(ENVS["after"], USERS[ADMIN], a.password) as (page, _):
        settle(page)
        tracker(page, "Cashflow Plan Tracker")
        step(page, "numbers", "after", ADMIN, "Cashflow: open the WO tab.", click=page.get_by_text("WO Cashflow", exact=True))
        settle(page, 2500)
        shown = cf_labels(page)
        dbo = [x["id"] or "new" for x in f["wo"]]
        w.check("numbers", ADMIN, f"WO tab newest first: {dbo}", str([s[1] for s in shown]), [s[1] for s in shown] == dbo)
        exp = page.get_by_role("button", name="Export")
        step(page, "numbers", "after", ADMIN, "The WO tab newest first (Plan 1 = newest). Export this tab's PDF.",
             click=exp, pins=[pin(page.get_by_text(re.compile(r"^Plan 1$", re.I)).first, f"Plan 1 = {dbo[0]}", "info")])
        item = page.get_by_role("menuitem", name=re.compile(r"Export WO Cashflow"))
        with page.expect_download(timeout=180_000) as dl:
            step(page, "numbers", "after", ADMIN, "Export WO Cashflow (PDF).", click=item)
        pdf = out / "files" / "wo-cashflow.pdf"
        pdf.parent.mkdir(exist_ok=True)
        dl.value.save_as(str(pdf))
        view, text = pdf_view(page, pdf)
        flat = re.sub(r"\s+", "", text)
        pdf_ids = list(dict.fromkeys(re.findall(r"SR-\d{5}-\d{6}", flat)))
        pdf_nums = [int(x) for x in re.findall(r"Plan(\d+)", flat)]
        scr_ids = [s[1] for s in shown if s[1] != "new"]
        w.check("numbers", ADMIN, "the PDF numbers the same entries the same way", f"PDF {pdf_nums} {pdf_ids}, "
                f"screen {[s[0] for s in shown]} {scr_ids}", pdf_ids == scr_ids and pdf_nums == [s[0] for s in shown])
        step(view, "numbers", "after", ADMIN, f"Page 1 of the downloaded PDF: Plan {pdf_nums} in the screen's order.")
        view.close()
        # Search
        box = visible(page, "Search cashflow plans")
        box.fill("forklift")
        settle(page, 1500)
        found = cf_labels(page)
        w.check("cf_search", ADMIN, f"\"forklift\" finds Plan(s) {f['fork_labels']}", str([n for n, _ in found]),
                [n for n, _ in found] == f["fork_labels"])
        step(page, "cf_search", "after", ADMIN, f"Search \"forklift\" on the WO tab: the forklift WO, still Plan "
             f"{found[0][0] if found else '?'}.", pins=[pin(box, "Searches PO/WO, vendor, item, remarks.", "info")])
        visible(page, "Clear search").click()
        settle(page)
        # Link PO on the New PO entry.
        page.get_by_text("PO Cashflow", exact=True).first.click()
        settle(page, 2500)
        new_po = next(x for x in f["po"] if x["type"] == "New PO")
        card = card_of(page, new_po["vendor"])
        step(page, "cf_po_link", "after", ADMIN, f"PO tab: edit the New PO entry ({new_po['vendor']}).",
             click=card.locator(PEN))
        settle(page)
        step(page, "cf_po_link", "after", ADMIN, "The \"PO ID: N/A\" badge carries a pencil: Link PO.",
             click=page.get_by_role("button", name=re.compile(r"Link PO")))
        settle(page)
        if page.get_by_text(re.compile(r"No POs are linked")).count():
            step(page, "cf_po_link", "after", ADMIN, "No PO is linked to this entry's task: See all project POs.",
                 click=page.get_by_role("button", name="See all project POs"))
            settle(page)
        picker(page).click()
        settle(page, 1000)
        opt = page.locator(OPTION).first
        po_name = opt.inner_text().split(" · ")[0]
        step(page, "cf_po_link", "after", ADMIN, f"Pick {po_name}.", click=opt)
        settle(page)
        step(page, "cf_po_link", "after", ADMIN, f"{po_name}'s vendor and items fill in. Tick the first item.",
             click=page.locator("[role='checkbox']:visible").first)
        settle(page, 800)
        step(page, "cf_po_link", "after", ADMIN, "Confirm.", click=page.get_by_role("button", name="Confirm"))
        settle(page, 2500)
        d = db_json(ENVS["after"], "cf_po_after_save", READ_CODE, "Cashflow Plan", new_po["name"], "type,id_link,estimated_price")
        w.check("cf_po_link", ADMIN, f"the entry is Existing PO on {po_name}, estimated price cleared", str(d),
                d["type"] == "Existing PO" and d["id_link"] == po_name and not d["estimated_price"])
        step(page, "cf_po_link", "after", ADMIN, f"Saved: the entry is Existing PO on {po_name}.",
             pins=[pin(page.get_by_text(po_name).first, f"DB: {d['type']} {d['id_link']}", "info")])


def cf_wo_pmo_after() -> None:
    f = facts("after")
    with session(ENVS["after"], USERS[PMO], a.password) as (page, _):
        settle(page)
        tracker(page, "Cashflow Plan Tracker")
        page.get_by_text("WO Cashflow", exact=True).first.click()
        settle(page, 2500)
        new_wo = next(x for x in f["wo"] if x["type"] == "New WO")
        step(page, "cf_wo_link", "after", PMO, f"PMO, WO tab: edit the New WO entry ({new_wo['vendor']}).",
             click=card_of(page, new_wo["vendor"]).locator(PEN))
        settle(page)
        step(page, "cf_wo_link", "after", PMO, "The \"WO ID: N/A\" badge carries a pencil: Link WO.",
             click=page.get_by_role("button", name=re.compile(r"Link WO")))
        settle(page)
        step(page, "cf_wo_link", "after", PMO, "Type \"unloading\": a word of a WO's description, not its number "
             "or vendor.", click=picker(page))
        page.keyboard.type("unloading")
        settle(page, 1200)
        opts = page.locator(OPTION)
        texts = [opts.nth(i).inner_text() for i in range(opts.count())]
        w.check("cf_wo_link", PMO, "\"unloading\" finds WOs by description; each option shows it",
                f"{len(texts)} options: {texts[:2]}", bool(texts) and all("—" in t for t in texts))
        fork = next((i for i, t in enumerate(texts) if "FORKLIFT" in t.upper()), 0)
        wo_name = texts[fork].split(" · ")[0] if texts else "?"
        step(page, "cf_wo_link", "after", PMO, f"Each option ends with its first description. Pick {wo_name}.",
             click=opts.nth(fork))
        settle(page)
        step(page, "cf_wo_link", "after", PMO, f"{wo_name}'s vendor and descriptions fill in. Confirm.",
             click=page.get_by_role("button", name="Confirm"))
        settle(page, 2500)
        d = db_json(ENVS["after"], "cf_wo_after_save", READ_CODE, "Cashflow Plan", new_wo["name"], "type,id_link,estimated_price")
        w.check("cf_wo_link", PMO, f"the entry is Existing WO on {wo_name}, estimated price cleared", str(d),
                d["type"] == "Existing WO" and d["id_link"] == wo_name and not d["estimated_price"])
        step(page, "cf_wo_link", "after", PMO, f"Saved: the entry is Existing WO on {wo_name}.",
             pins=[pin(page.get_by_text(wo_name).first, f"DB: {d['type']} {d['id_link']}", "info")])


def all_time_after() -> None:
    all_time("after")


def guard_after() -> None:
    f = facts("after")
    cf_any = (f["po"] + f["wo"])[0]["name"]
    res = db_json(ENVS["after"], "guard", GUARD_CODE, json.dumps([
        ["Material Delivery Plan", "po_link", f["mp"][0]["name"], USERS[PE]],
        ["Cashflow Plan", "id_link", cf_any, USERS[PE]],
    ]))
    for dt, r in res.items():
        w.check("guard", PE, f"{dt}: a Procurement Executive's PO change is refused", r, r.startswith("refused"))
    w.status("guard", "not_walked", "No screen: the UI shows these users no pencil. Checked on the env with validate run "
             f"as the user (rolled back): {res}. Unit tests: test_material_delivery_plan, test_cashflow_plan.")


# ---------------------------------------------------------------- Projects ⓘ and credit totals (both sides)


def rupees(n: float) -> str:
    from record import inr
    return "₹" + inr(round(n))


def open_projects(page) -> None:
    page.get_by_role("link", name=re.compile("^Projects Active construction")).first.click()
    settle(page, 5000)


def proj_info(side: str) -> None:
    with session(ENVS[side], USERS[ADMIN], a.password) as (page, _):
        settle(page)
        step(page, "proj_info", side, ADMIN, "Dashboard: open Projects.",
             click=page.get_by_role("link", name=re.compile("^Projects Active construction")))
        settle(page, 5000)
        icon = page.locator("th").filter(has_text="Project Outflow").first.get_by_role("button", name="Column definition")
        icon.hover()
        page.wait_for_timeout(1200)
        tip = page.locator("[data-radix-popper-content-wrapper]").first
        items = tip.locator("li").count()
        text = tip.inner_text().replace("\n", " / ")
        credit_icon = page.locator("th").filter(has_text="Total Purchase Over Credit").get_by_role(
            "button", name="Column definition").count()
        if side == "after":
            w.check("proj_info", ADMIN, "Projects list: Project Outflow ⓘ shows bullet points", f"{items} list items: "
                    f"{text[:120]}", items >= 5)
            w.check("proj_info", ADMIN, "Projects list: Total Purchase Over Credit has an ⓘ", f"{credit_icon} ⓘ",
                    credit_icon == 1)
        else:
            w.check("proj_info", ADMIN, "develop: one sentence, no bullet points", f"{items} list items: {text[:120]}",
                    items == 0, kind="info")
            w.check("proj_info", ADMIN, "develop: Total Purchase Over Credit has no ⓘ", f"{credit_icon} ⓘ",
                    credit_icon == 0, kind="info")
        step(page, "proj_info", side, ADMIN, "Projects list: hover the ⓘ beside Project Outflow."
             + (" Bullet points." if items else " One sentence."),
             pins=[pin(tip, "Bullet points, Project Outflow's parts nested." if items else "One long sentence.", "info")])
        sidebar(page, "Reports")
        settle(page, 3000)
        step(page, "proj_info", side, ADMIN, "Reports: the Projects tab opens the Cash Sheet.",
             click=page.get_by_role("button", name="Projects", exact=True))
        settle(page, 5000)
        icon2 = page.locator("th").filter(has_text="Project Outflow").first.get_by_role("button", name="Column definition")
        icon2.hover()
        page.wait_for_timeout(1200)
        tip2 = page.locator("[data-radix-popper-content-wrapper]").first
        items2 = tip2.locator("li").count()
        if side == "after":
            w.check("proj_info", ADMIN, "Cash Sheet: the same bullet points", f"{items2} list items", items2 == items)
        step(page, "proj_info", side, ADMIN, "Cash Sheet: the same ⓘ" + (" as bullet points." if items2 else
             ", one sentence."), pins=[pin(tip2, "Same text as the Projects list.", "info")])


def credit_cancel(side: str) -> None:
    c = db_json(ENVS[side], f"credit_{side}", CREDIT_CODE)
    expect = c["without_cancelled"] if side == "after" else c["with_cancelled"]
    with session(ENVS[side], USERS[ADMIN], a.password) as (page, _):
        settle(page)
        open_projects(page)
        box = page.get_by_placeholder("Search by Project Name...")
        box.fill(c["project_name"])
        settle(page, 3000)
        step(page, "credit_cancel", side, ADMIN, f"Projects: find {c['project_name']}. Its {c['po']} "
             f"({rupees(c['po_credit'])} on credit) was set Cancelled for this walk.",
             click=page.locator("tbody a", has_text=c["project_name"]))
        settle(page, 5000)
        step(page, "credit_cancel", side, ADMIN, "Open the Financials tab.",
             click=page.get_by_text("Financials", exact=True))
        settle(page, 5000)
        label = page.get_by_text("Total Purchase Over Credit", exact=True).first
        card = label.locator("xpath=ancestor::div[contains(., '₹')][1]")
        shown = re.search(r"₹[\d,]+", card.inner_text())
        shown = shown.group(0) if shown else "?"
        ok = shown == rupees(expect)
        if side == "after":
            w.check("credit_cancel", ADMIN, f"Financials: Total Purchase Over Credit leaves out the Cancelled PO = "
                    f"{rupees(expect)}", shown, ok)
        else:
            w.check("credit_cancel", ADMIN, f"develop: it counts the Cancelled PO = {rupees(expect)}", shown, ok,
                    kind="info")
        step(page, "credit_cancel", side, ADMIN, f"Financials: Total Purchase Over Credit reads {shown}.",
             pins=[pin(card, (f"Cancelled {c['po']} left out ({rupees(c['with_cancelled'])} − "
                              f"{rupees(c['po_credit'])})." if side == "after" else
                              f"Counts the Cancelled {c['po']}: {rupees(c['po_credit'])} too much."),
                       "info")])


def proj_info_before() -> None:
    proj_info("before")


def credit_cancel_before() -> None:
    credit_cancel("before")


def proj_info_after() -> None:
    proj_info("after")


def credit_cancel_after() -> None:
    credit_cancel("after")


def api_put(page, doctype: str, name: str, body: dict) -> dict:
    """The change sent from the user's own logged-in browser session, as a crafted request would be."""
    return page.evaluate("""async ([url, body]) => {
        const r = await fetch(url, {method: 'PUT', credentials: 'include',
            headers: {'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': window.csrf_token || ''},
            body: JSON.stringify(body)});
        const t = await r.text(); let msg = t;
        try { const j = JSON.parse(t); msg = j.exception || (j.data ? 'saved: ' + JSON.stringify(
            {name: j.data.name, po_link: j.data.po_link, id_link: j.data.id_link}) : t); } catch (e) {}
        return {status: r.status, message: String(msg).slice(0, 300)};
    }""", [f"/api/resource/{doctype}/{name}", body])


def response_view(page, title: str, req: str, res: dict):
    import html
    view = page.context.new_page()
    view.set_viewport_size(page.viewport_size)
    ok = res["status"] == 200
    view.set_content(f"""<body style="font:15px/1.5 -apple-system,sans-serif;margin:40px;background:#f6f7f9;color:#1b1f27">
      <h2 style="margin:0 0 6px">{html.escape(title)}</h2>
      <p style="color:#5b6372;margin:0 0 18px">Sent from the Procurement Executive's own logged-in session (their browser),
      not from the app's screens, which give them no pencil.</p>
      <pre style="background:#fff;border:1px solid #dfe3ea;border-radius:8px;padding:14px;white-space:pre-wrap">{html.escape(req)}</pre>
      <div id="res" style="margin-top:16px;padding:14px;border-radius:8px;background:{'#fff4e5' if ok else '#e9f7ef'};
        border:1px solid {'#f1c77a' if ok else '#9fd8b5'}"><b>Server answered {res['status']}</b><br>
        {html.escape(res['message'])}</div></body>""")
    return view


def guard_api(side: str) -> None:
    g = db_json(ENVS[side], f"guard_api_{side}", GUARD_API_CODE, P)
    with session(ENVS[side], USERS[PE], a.password) as (page, _):
        settle(page)
        tracker(page, "Material Plan Tracker")
        for dt, name, field, cur, new, label in [
            ("Material Delivery Plan", g["mp"], "po_link", g["mp_po"], g["mp_new"], "a material plan's PO"),
            ("Cashflow Plan", g["cf"], "id_link", g["cf_po"], g["cf_new"], "a cashflow entry's PO"),
        ]:
            res = api_put(page, dt, name, {field: new})
            after = db_json(ENVS[side], f"guard_api_{side}_{field}", READ_CODE, dt, name, field)[field]
            req = f'PUT /api/resource/{dt}/{name}\n{{"{field}": "{new}"}}   (was {cur})'
            view = response_view(page, f"{'Develop' if side == 'before' else 'Branch'}: a Procurement Executive "
                                       f"changes {label}", req, res)
            refused = res["status"] != 200 and "Only Admin and PMO" in res["message"]
            if side == "after":
                w.check("guard", PE, f"{dt}: the change is refused with the Admin / PMO message", f"{res['status']} "
                        f"{res['message'][:120]}", refused)
                w.check("guard", PE, f"{dt}: {field} stays {cur}", str(after), after == cur)
            else:
                w.check("guard", PE, f"develop: {dt} accepts the change (the gap)", f"{res['status']}, now {after}",
                        res["status"] == 200 and after == new, kind="info")
            step(view, "guard", side, PE, f"{'Refused' if refused else 'Accepted'}: {res['status']}."
                 + (f" {field} stays {after}." if refused else f" {field} is now {after}."),
                 pins=[pin(view.locator("#res"), "Refused by the server; nothing saved." if refused else
                           "Develop saves it: anyone with write permission could move the PO.",
                           "info")])
            view.close()


def guard_api_before() -> None:
    guard_api("before")


def guard_api_after() -> None:
    guard_api("after")


PLAN = [("mp_search", mp_before), ("wp_search", wp_before), ("cf_search", cf_before), ("all_time", all_time_before),
        ("proj_info", proj_info_before), ("credit_cancel", credit_cancel_before), ("guard", guard_api_before),
        ("mp_search", mp_after), ("mp_link", mp_pmo_after), ("mp_link", mp_pe_after), ("wp_search", wp_after),
        ("cf_search", cf_after), ("cf_wo_link", cf_wo_pmo_after), ("all_time", all_time_after), ("guard", guard_api_after),
        ("proj_info", proj_info_after), ("credit_cancel", credit_cancel_after)]


def guarded(cid: str, fn, tries: int = 2) -> None:
    for attempt in range(1, tries + 1):
        steps, checks = len(w.data["steps"]), len(w.data["checks"])
        try:
            fn()
            return
        except Exception as e:
            traceback.print_exc()
            del w.data["steps"][steps:], w.data["checks"][checks:]
            if attempt == tries:
                w.status(cid, "failed", f"walk stopped in {fn.__name__}: {type(e).__name__}: "
                         f"{(str(e).splitlines() or [''])[0][:160]}")


SERVED = {"side": None}


def side_of(fn) -> str:
    return "before" if fn.__name__.endswith("_before") else "after"


def serve_only(side: str) -> None:
    if SERVED["side"] == side:
        return
    # Stop both (a crashed earlier run can leave either served), then serve this side.
    for env in ENVS.values():
        subprocess.run([DEVENV, "stop", env], capture_output=True, text=True, timeout=300)
    res = subprocess.run([DEVENV, "serve", ENVS[side], "--wait"], capture_output=True, text=True, timeout=900)
    if res.returncode != 0:
        sys.exit(f"walk: could not serve {ENVS[side]}:\n{res.stdout[-800:]}\n{res.stderr[-800:]}")
    SERVED["side"] = side
    warm(side)


def warm(side: str) -> None:
    """Load the env's login page once with a long wait: vite compiles on the first visit, which timed out the first
    walk step on a cold env."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        for _ in range(3):
            try:
                pg.goto(base_url(ENVS[side]) + "/login", timeout=180_000)
                pg.wait_for_selector("#email", timeout=180_000)
                break
            except Exception:
                pg.wait_for_timeout(5000)
        b.close()


for cid, fn in PLAN:
    if not a.only or fn.__name__ in a.only:
        if a.one_lane:
            serve_only(side_of(fn))
        guarded(cid, fn)
        w.save()

for c in w.data["changes"]:
    if c["status"] in ("failed", "not_walked") and c["reason"]:
        continue
    if not any(x["change"] == c["id"] for x in w.data["steps"] + w.data["checks"]):
        continue
    bad = [k for k in w.data["checks"] if k["change"] == c["id"] and not k["ok"] and k["kind"] == "must"]
    musts = [p for s in w.data["steps"] if s["change"] == c["id"] for p in s["pins"] if p["kind"] == "must"]
    w.status(c["id"], "failed" if bad or musts else "seen",
             "; ".join(f"{k['role']}: expected {k['expect']}, saw {k['seen']}" for k in bad))
print(w.save())
