"""Walk branch roles/software-developer (ADR-0051: the Software Developer profile mirrors Admin) on its env and on
an env of develop, before vs after. The branch has no PR.

    python3 .claude/skills/pr-walk/bin/walk_branch_software_developer.py <out dir> --after <env> --before <env> \
        --admin <admin email> [--password <pw>] [screen ...]

Run it from the checkout root with both envs served. `--admin` is an enabled Admin-profile user the app does not lock
(`free_users.py "Nirmaan Admin Profile"`). The after env is seeded with the verify skill's
`software_developer_seed.py` (the made-up developer `dev.walker@example.com` and the made-up Accountant
`rename.target@example.com`) and with one made-up Reminder Schedule that targets only the developer profile, with a
Pending reminder raised for it. The before env is seeded with nothing: it has no developer profile.

Three viewers walk the same screens the way they reach them (sidebar, tabs, row links): the Admin on the before env,
the Admin on the after env, and the developer on the after env. Each screen records what it shows (its control names,
its counts), and the walk then checks developer = Admin on the after env and Admin before = Admin after (claim 10),
each figure against the env's own DB, read by `DB_SCRIPT` at the start of the run. Records are picked by query, never by
a fixed id. Every walk password is set on the env DB only. `screen ...` runs only the named screens (a probe); the page
needs a full run.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
VERIFY = ROOT / ".claude/skills/verify/bin"
sys.path.insert(0, str(VERIFY))
sys.path.insert(0, str(HERE))
from drive import session  # noqa: E402
from record import Walk, box_of, on_screen, pin  # noqa: E402

DEVENV = str(ROOT / "scripts/devenv/devenv.sh")
DEVELOPER = "dev.walker@example.com"
TARGET = "rename.target@example.com"
SD_PROFILE = "Nirmaan Software Developer Profile"
REMINDER_TITLE = "Walk check: developer-only reminder"
MENU = '[data-sidebar="menu-button"]'
ADMIN, DEV = "Admin", "Software Developer"

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("only", nargs="*")
ap.add_argument("--after", required=True, help="the env on the branch")
ap.add_argument("--before", required=True, help="the env on develop at the branch's base")
ap.add_argument("--admin", required=True)
ap.add_argument("--password", default="WalkPw-SwDev")
a = ap.parse_args()
out = Path(a.out)
head = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short=9", "HEAD"], capture_output=True, text=True,
                      check=True).stdout.strip()

w = Walk(out, pr={"number": "roles/software-developer", "title": "The Software Developer profile mirrors Admin "
                  "(ADR-0051)", "url": "", "author": "", "head": head, "base": "1434d6262"},
         envs={"after": a.after, "before": a.before},
         data_note="a test copy of the production backup of 2026-11-25 00:30")

w.change("c1", "1 · Create User offers the Software Developer profile",
         "Admin Options › Users › Add New User: the Role Profile picker offers \"Nirmaan Software Developer Profile\" "
         "on this branch; develop does not.")
w.change("c2", "2 · The developer's badge is orange",
         "In the Users list and on the user's profile, a developer shows the \"Software Developer\" badge in its own "
         "orange colour.")
w.change("c3", "3 · Same sidebar as Admin",
         "The developer sees exactly Admin's sidebar items, in the same order. Admin's own sidebar is unchanged.")
w.change("c4", "4 · Admin Dashboard, never locked",
         "The developer lands on the Admin Dashboard with the same cards and counts as Admin. The access gate never "
         "locks the developer for having no project.")
w.change("c5", "5 · Admin's actions, for the developer too",
         "Payments, Expenses and Invoice approvals, PR approval, the PO page, Snag bulk edit, Rate Master and BoQ "
         "Templates, the Commission Report, and Assets › Departments: the developer gets what Admin gets.")
w.change("c6", "6 · Rename Email",
         "A developer may rename another user's email. A developer account cannot be renamed, like an Admin account.")
w.change("c7", "7 · Reminders are one-way",
         "The developer sees the reminders of schedules that target the Admin profile. An Admin does not see a "
         "schedule that targets only the developer profile.")
w.change("c8", "8 · Expense Request review queue",
         "A request whose type has no reviewer of its own shows in the developer's review queue as in Admin's.")
w.change("c9", "9 · All projects, none assigned",
         "The developer sees every project (Won Projects as Admin and the DB) with no project assigned.")
w.change("c10", "10 · Admin unchanged",
         "On every screen walked, Admin sees the same thing before and after this branch.")
w.change("c11", "11 · TDS approval",
         "TDS Approval: the approve control an Admin has on a pending TDS request is there for the developer too (the "
         "list's read-only banner for non-approvers does not show).")
w.change("c12", "12 · An Approved PO invoice's Edit and Delete",
         "Vendor Invoice Recon › PO Invoices 2B Recon: the Edit and Delete an Admin has on an Approved PO invoice are "
         "there for the developer too. Opened, never saved or deleted.")
w.change("c13", "13 · The department Technology",
         "After migrate, Assets › Departments lists Technology, active; develop's list has no Technology.")
w.change("c14", "Not on a screen",
         "Push notification recipients, the L1 raiser of a developer's own expense, Desk access.")
w.status("c14", "not_walked", "No screen shows these to a reviewer. Pinned by services/test_software_developer_reach.py "
         "(notification recipients, L1 raiser, review routing, renames, reminders) and "
         "services/test_software_developer_profile.py (the profile's 7 Roles, so Desk access through System Manager).")


# ---------------------------------------------------------------- DB side

DB_SCRIPT = r'''
import json, sys
import frappe
from frappe.utils import getdate, today

admin, developer, seed = sys.argv[1], sys.argv[2], sys.argv[3] == "seed"
SD = "Nirmaan Software Developer Profile"
TITLE = "Walk check: developer-only reminder"

if seed:
    from nirmaan_stack.services import reminders as svc
    from nirmaan_stack.tasks.reminders import _ensure_log
    name = frappe.db.get_value("Reminder Schedule", {"title": TITLE})
    if not name:
        doc = frappe.get_doc({"doctype": "Reminder Schedule", "title": TITLE, "enabled": 1,
                              "role_profiles": [{"role_profile": SD}], "schedule_type": "Monthly",
                              "due_day": 28, "notify_before_days": 31,
                              "message": "Made-up schedule for the walk."}).insert(ignore_permissions=True)
        name = doc.name
    doc = frappe.get_doc("Reminder Schedule", name)
    _ensure_log(doc, getdate(svc.next_due_date(doc.schedule_type, doc.due_day, doc.due_dates, getdate(today()))),
                None, None)
    frappe.db.commit()

from nirmaan_stack.api.reminders.read import _my_schedule_names
from nirmaan_stack.services.expense_request_routing import reviewer_role_for_type


def pending_titles(email):
    names = _my_schedule_names(email)
    logs = frappe.get_all("Reminder Schedule Log", filters={"reminder_schedule": ["in", names or [""]],
                          "status": "Pending"}, pluck="reminder_schedule")
    return sorted({frappe.db.get_value("Reminder Schedule", n, "title") for n in logs})


def sees(email):
    frappe.set_user(email)
    got = {
        "projects": len(frappe.get_list("Projects", pluck="name", limit=0)),
        "requested_payments": len(frappe.get_list("Project Payments", {"status": "Requested"}, pluck="name", limit=0)),
        "pending_expense_requests": len(frappe.get_list("Expense Request", {"status": "Pending Approval"}, pluck="name", limit=0)),
        "pending_po_invoices": len(frappe.get_list("Vendor Invoices", {"status": "Pending", "document_type": "Procurement Orders"}, pluck="name", limit=0)),
        "pending_prs": len(frappe.get_list("Procurement Requests", {"workflow_state": "Pending"}, pluck="name", limit=0)),
        "approved_pos": len(frappe.get_list("Procurement Orders", {"status": "PO Approved"}, pluck="name", limit=0)),
    }
    frappe.set_user("Administrator")
    return got


def person(email):
    if not frappe.db.exists("Nirmaan Users", email):
        return None
    return {"role_profile": frappe.db.get_value("Nirmaan Users", email, "role_profile"),
            "roles": sorted(frappe.get_roles(email)),
            "project_permissions": frappe.db.count("User Permission", {"user": email, "allow": "Projects"}),
            "pending_reminders": pending_titles(email), "sees": sees(email)}


pr = frappe.get_all("Procurement Requests", {"workflow_state": "Pending"}, ["name", "project"], order_by="creation desc", limit=1)
po = frappe.get_all("Procurement Orders", {"status": "PO Approved"}, ["name"], order_by="modified desc", limit=1)
exr = frappe.get_all("Expense Request", {"status": "Pending Approval"}, ["name", "type"], order_by="creation desc")
exr = [dict(r, reviewer=reviewer_role_for_type(r["type"])) for r in exr]
snag = frappe.db.sql("""select s.project, p.project_name, count(*) n from "tabProject Snag" s
    join "tabProjects" p on p.name = s.project where s.status = 'Pending' group by s.project, p.project_name
    order by n desc, s.project limit 1""", as_dict=True)
tds = frappe.db.sql("""select tds_request_id from "tabProject TDS Item List" where docstatus != 2
    group by tds_request_id having sum(case when tds_status in ('Pending', 'New') or tds_status is null
    or tds_status = '' then 1 else 0 end) > 0 order by min(creation) desc""", pluck=True)
inv = frappe.get_all("Vendor Invoices", {"status": "Approved", "document_type": "Procurement Orders"},
                     ["name", "invoice_no", "document_name"], order_by="modified desc", limit=1)
other_admin = frappe.get_all("Nirmaan Users", {"role_profile": "Nirmaan Admin Profile", "name": ["!=", admin]},
                             pluck="name", order_by="name", limit=1)
print("JSON " + json.dumps({
    "profiles": sorted(frappe.get_all("Role Profile", pluck="name")),
    "admin": person(admin), "developer": person(developer), "target": person("rename.target@example.com"),
    "other_admin": other_admin[0] if other_admin else None,
    "cards": {"Projects": frappe.db.count("Projects"), "Users": frappe.db.count("Nirmaan Users"),
              "Products": frappe.db.count("Items"), "Vendors": frappe.db.count("Vendors"),
              "Customers": frappe.db.count("Customers"), "Assets": frappe.db.count("Asset Master"),
              "Work Order Rate Card": frappe.db.count("WO Service Category")},
    "won_projects": frappe.db.count("Projects", {"tendering_status": "Won"}),
    "requested_payments": frappe.db.count("Project Payments", {"status": "Requested"}),
    "pending_expense_requests": len(exr), "exr_pick": exr[0] if exr else None,
    "exr_admin_routed": sum(1 for r in exr if r["reviewer"] == "Nirmaan Admin Profile"),
    "pending_po_invoices": frappe.db.count("Vendor Invoices", {"status": "Pending", "document_type": "Procurement Orders"}),
    "pending_prs": frappe.db.count("Procurement Requests", {"workflow_state": "Pending"}), "pr_pick": pr[0] if pr else None,
    "approved_pos": frappe.db.count("Procurement Orders", {"status": "PO Approved"}), "po_pick": po[0]["name"] if po else None,
    "snag_pick": snag[0] if snag else None,
    "commission_reports": frappe.db.count("Project Commission Report"),
    "departments": frappe.db.count("Nirmaan Department"),
    "technology_active": frappe.db.get_value("Nirmaan Department", "Technology", "is_active"),
    "pending_tds_requests": len(tds), "tds_pick": tds[0] if tds else None,
    "inv_pick": inv[0] if inv else None,
}, default=str))
'''


def db(task: str, seed: bool = False) -> dict:
    """Run DB_SCRIPT on the env (seeding the developer-only reminder first when `seed`); keep script and output."""
    d = out / "db"
    d.mkdir(exist_ok=True)
    src = d / "walk_db.py"
    src.write_text(DB_SCRIPT)
    res = subprocess.run([DEVENV, "script", task, str(src), a.admin, DEVELOPER, "seed" if seed else "read"],
                         capture_output=True, text=True, timeout=600)
    (d / f"{task}{'-seed' if seed else ''}.txt").write_text(res.stdout + res.stderr)
    line = next((ln for ln in res.stdout.splitlines() if ln.startswith("JSON ")), None)
    if line is None:
        raise RuntimeError(f"walk_db.py on {task} printed no JSON:\n{res.stdout[-800:]}\n{res.stderr[-800:]}")
    return json.loads(line[5:])


def devenv(*args: str) -> str:
    res = subprocess.run([DEVENV, *args], capture_output=True, text=True, timeout=600)
    if res.returncode:
        sys.exit(f"devenv {' '.join(args[:3])} failed:\n{(res.stdout + res.stderr)[-800:]}")
    return res.stdout


# ---------------------------------------------------------------- screen helpers

def settle(page, ms: int = 2500) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def menu_item(page, label: str):
    return page.locator(MENU).get_by_text(label, exact=True).first


def sub_item(page, label: str):
    return page.locator('[data-sidebar="menu-sub"]').get_by_text(label, exact=True).first


def main_box(page) -> dict | None:
    b = box_of(page.locator("main"), scroll=False)
    return on_screen(b, page.viewport_size) if b else None


def controls(page) -> list[str]:
    """The names of the buttons, tabs, checkboxes and switches inside <main>: what this viewer may press here."""
    names = page.locator("main").evaluate("""m => [...m.querySelectorAll(
        'button, [role=tab], [role=checkbox], input[type=checkbox], [role=switch]')].map(e =>
        (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.getAttribute('role') || e.tagName)
        .replace(/\\s+/g, ' ').trim()).filter(Boolean)""")
    # A "... By Me N" tab counts the viewer's own records, which differ between any two people: keep its name only.
    return sorted({re.sub(r"(By Me)\s+\d+$", r"\1", n) for n in names})


def tab_count(page, label: str, role: str = "button") -> int:
    button = page.get_by_role(role, name=re.compile(rf"^{re.escape(label)}\s+\d+$")).first
    button.wait_for(timeout=60_000)

    def read() -> int:
        return int(re.split(r"\s+", button.inner_text().strip())[-1].replace(",", ""))

    last = read()
    for _ in range(20):  # a tab shows 0 until its count arrives: read until two reads 1.5 s apart agree
        page.wait_for_timeout(1500)
        now = read()
        if now == last:
            return now
        last = now
    return last


def sidebar_labels(page) -> list[str]:
    menu = page.locator(MENU)
    menu.get_by_text("Dashboard", exact=True).wait_for(timeout=30_000)
    last = -1
    for _ in range(40):
        if menu.count() == last and last > 3:
            break
        last = menu.count()
        page.wait_for_timeout(750)
    labels = [menu.nth(i).inner_text().strip() for i in range(menu.count())]
    return [label for label in labels if "\n" not in label and "@" not in label]


# ---------------------------------------------------------------- the screens
# Each takes (page, ctx) and returns the facts it saw. ctx: side, role, user, task, db (that env's DB facts).

def s_dashboard(page, c) -> dict:
    page.get_by_text("Action Center").first.wait_for(timeout=30_000)
    settle(page, 4000)
    text = page.locator("main").inner_text()
    cards = {}
    for title in c["db"]["cards"]:
        m = re.search(rf"(?m)^{re.escape(title)}\n+[^\n]+\n+([\d,]+)$", text)
        cards[title] = int(m.group(1).replace(",", "")) if m else None
    heading = page.get_by_text("Admin Dashboard", exact=True)
    f = {"url_path": re.sub(r"^https?://[^/]+", "", page.url).split("?")[0], "admin_dashboard": heading.count() > 0,
         "cards": cards}
    pins = []
    wrong = {k: (v, c["db"]["cards"][k]) for k, v in cards.items() if v != c["db"]["cards"][k]}
    if c["role"] == DEV:
        pins.append(pin(heading if heading.count() else page.locator("main"),
                        "The developer lands on the Admin Dashboard." if heading.count() else
                        "The developer did not land on the Admin Dashboard.", "info" if heading.count() else "must"))
    if wrong:
        pins.append(pin(page.locator("main"), "Card counts differ from the DB: " +
                        "; ".join(f"{k} shows {v} vs DB {d}" for k, (v, d) in wrong.items()), "must"))
    f["_step"] = w.step(page, "c4", c["side"], c["role"], c["user"],
                        "The landing page after login: dashboard cards with their counts.", pins=pins)
    f["_box"] = main_box(page)
    # The Reminders section of the Action Center: the <aside>'s child block whose header reads "Reminders" (shown
    # upper-case by CSS only).
    panel = page.locator("aside").get_by_text("Reminders", exact=True).first.locator("xpath=ancestor::div[parent::aside][1]")
    if not panel.count():
        f["reminders"] = None  # read nothing: the check below fails rather than compare an empty list
        f["_rstep"] = w.step(page, "c7", c["side"], c["role"], c["user"], "No Reminders panel found in the Action Center.",
                             pins=[pin(page.locator("main"), "No Reminders panel on the dashboard.", "must")])
        return f
    ptext = panel.inner_text()
    f["reminders"] = sorted(t for t in set(c["all_titles"]) if t in ptext)
    own = panel.get_by_text(REMINDER_TITLE).first
    pins = [pin(panel, "The Reminders panel.", "info")]
    if own.count():
        pins.append(pin(own, "The developer-only schedule's reminder.", "info"))
    f["_rstep"] = w.step(page, "c7", c["side"], c["role"], c["user"],
                         f"Action Center › Reminders: {', '.join(f['reminders']) or 'none of the known reminders'}.",
                         pins=pins)
    return f


def s_sidebar(page, c) -> dict:
    labels = sidebar_labels(page)
    w.step(page, "c3", c["side"], c["role"], c["user"], f"The sidebar: {len(labels)} entries. Open Admin Options.",
           click=menu_item(page, "Admin Options"))
    settle(page, 800)
    subs = page.locator('[data-sidebar="menu-sub"] [data-sidebar="menu-sub-button"]')
    sub = [subs.nth(i).inner_text().strip() for i in range(subs.count())]
    step = w.step(page, "c3", c["side"], c["role"], c["user"], f"Admin Options lists {len(sub)} pages.",
                  pins=[pin(page.locator('[data-sidebar="menu-sub"]').first, "Admin Options' pages.", "info")])
    return {"labels": labels, "admin_options": sub, "_step": step,
            "_box": on_screen(box_of(page.locator('[data-sidebar="sidebar"]').first, scroll=False) or
                              {"x": 0, "y": 0, "w": 250, "h": 900}, page.viewport_size)}


def open_admin_option(page, c, cid: str, label: str, caption: str) -> None:
    if not sub_item(page, label).is_visible():
        w.step(page, cid, c["side"], c["role"], c["user"], "Open Admin Options.", click=menu_item(page, "Admin Options"))
        page.wait_for_timeout(600)
    w.step(page, cid, c["side"], c["role"], c["user"], caption, click=sub_item(page, label))
    settle(page)


def s_new_user(page, c) -> dict:
    open_admin_option(page, c, "c1", "Users", "Admin Options › Users.")
    w.step(page, "c1", c["side"], c["role"], c["user"], "Add New User.",
           click=page.get_by_role("button", name="Add New User"))
    settle(page)
    page.get_by_text("Role Profile", exact=False).first.wait_for(timeout=30_000)
    picker = page.get_by_role("combobox").first  # Role Profile, then Department
    w.step(page, "c1", c["side"], c["role"], c["user"], "Open the Role Profile picker.", click=picker)
    settle(page, 800)
    options = sorted(t.strip() for t in page.get_by_role("option").all_inner_texts())
    sd = page.get_by_role("option").filter(has_text=re.compile("Software Developer"))
    has = sd.count() > 0
    want = SD_PROFILE in c["db"]["profiles"]
    step = w.step(page, "c1", c["side"], c["role"], c["user"],
                  f"The picker offers {len(options)} profiles; Software Developer is {'there' if has else 'not there'}.",
                  pins=[pin(sd, "The new profile.", "info" if want else "must")] if has else
                  ([pin(page.get_by_role("listbox").first, "No Software Developer profile offered, though the DB has "
                        "the profile.", "must")] if want else []))
    w.check("c1", c["role"], f"{c['side']}: the picker offers the profile = the DB has it ({want})",
            f"offered: {has}", has == want)
    page.keyboard.press("Escape")
    return {"options": options, "_step": step, "_box": main_box(page)}


def find_user(page, c, cid: str, email: str, caption: str):
    open_admin_option(page, c, cid, "Users", "Admin Options › Users.")
    page.locator("main input[placeholder^='Search']").first.fill(email)
    settle(page)
    row = page.get_by_role("row").filter(has_text=email).first
    row.wait_for(timeout=30_000)
    return row


def badge_is_orange(badge) -> bool:
    cls = badge.evaluate("e => [e, e.parentElement].map(x => x.className || '').join(' ')")
    return "orange" in cls


def rename_state(page, c, email: str, who: str) -> str:
    row = find_user(page, c, "c6", email, "Admin Options › Users.")
    w.step(page, "c6", c["side"], c["role"], c["user"], f"Search the users for {who}, then open their profile.",
           click=row.get_by_role("link").first)
    page.wait_for_url(re.compile(rf"/users/{re.escape(email)}$"))
    settle(page)
    w.step(page, "c6", c["side"], c["role"], c["user"], "Open Actions.",
           click=page.get_by_role("button", name=re.compile("Actions")).first)
    item = page.get_by_role("menuitem", name=re.compile("Rename Email"))
    item.wait_for()
    state = "disabled" if item.get_attribute("data-disabled") is not None else "enabled"
    w.step(page, "c6", c["side"], c["role"], c["user"], f"Rename Email on {who}: {state}.",
           pins=[pin(item, f"Rename Email is {state}.", "info")])
    page.keyboard.press("Escape")
    return state


def s_users(page, c) -> dict:
    f: dict = {}
    if c["side"] == "after":
        row = find_user(page, c, "c2", DEVELOPER, "Admin Options › Users.")
        badge = row.get_by_text("Software Developer", exact=True).first
        f["list_badge"] = badge.count() > 0
        f["list_orange"] = f["list_badge"] and badge_is_orange(badge)
        w.step(page, "c2", c["side"], c["role"], c["user"], "Users, searched for the developer. Open their profile.",
               click=row.get_by_role("link").first,
               pins=[pin(badge if f["list_badge"] else row, "Software Developer badge, orange." if f["list_orange"]
                         else "The badge is missing or not orange.", "info" if f["list_orange"] else "must")])
        page.wait_for_url(re.compile(rf"/users/{re.escape(DEVELOPER)}$"))
        settle(page)
        badge = page.locator("main").get_by_text("Software Developer", exact=True).first
        f["profile_badge"] = badge.count() > 0
        f["profile_orange"] = f["profile_badge"] and badge_is_orange(badge)
        w.step(page, "c2", c["side"], c["role"], c["user"], "The developer's profile page.",
               pins=[pin(badge if f["profile_badge"] else page.locator("main"), "Software Developer badge, orange."
                         if f["profile_orange"] else "The badge is missing or not orange.",
                         "info" if f["profile_orange"] else "must")])
        for k in ("list_badge", "list_orange", "profile_badge", "profile_orange"):
            w.check("c2", c["role"], f"{k.replace('_', ' ')}: yes", "yes" if f[k] else "no", f[k])
    # Rename Email (claim 6). The developer renames the made-up Accountant; an Admin tries the developer; both try an
    # Admin-profile account (the before env walks that one only, the baseline).
    other = c["db"]["other_admin"]
    if c["side"] == "after" and c["role"] == DEV:
        f["rename_target"] = rename_state(page, c, TARGET, "the made-up Accountant")
        w.check("c6", DEV, "Rename Email enabled on another user", f["rename_target"], f["rename_target"] == "enabled")
    if c["side"] == "after" and c["role"] == ADMIN:
        f["rename_developer"] = rename_state(page, c, DEVELOPER, "the developer")
        w.check("c6", ADMIN, "Rename Email disabled on the developer's account", f["rename_developer"],
                f["rename_developer"] == "disabled")
    if other:
        f["rename_admin"] = rename_state(page, c, other, "another Admin account")
        w.check("c6", c["role"], f"{c['side']}: Rename Email disabled on an Admin account", f["rename_admin"],
                f["rename_admin"] == "disabled")
    return f


def s_payments(page, c) -> dict:
    w.step(page, "c5", c["side"], c["role"], c["user"], "Payments: Project Payment & Expense.",
           click=menu_item(page, "Project Payment & Expense"))
    tab = page.get_by_role("button", name=re.compile(r"^Payment Pending Approval \d+$"))
    n = tab_count(page, "Payment Pending Approval")
    w.step(page, "c5", c["side"], c["role"], c["user"], f"Payment Pending Approval ({n}).", click=tab)
    settle(page)
    approve = page.locator("main tbody").get_by_role("button", name="Approve", exact=True).first
    boxes = page.locator("main tbody").get_by_role("checkbox")
    ok = n == c["db"]["requested_payments"]
    w.check("c5", c["role"], f"{c['side']}: Payment Pending Approval = DB Requested ({c['db']['requested_payments']})",
            str(n), ok)
    pins = [pin(approve, "Approve and Reject on each row.", "info")] if approve.count() else []
    if boxes.count():
        pins.append(pin(boxes.first, "The approve checkbox.", "info"))
    f = {"pending": n, "approve_buttons": page.locator("main tbody").get_by_role("button", name="Approve", exact=True).count(),
         "reject_buttons": page.locator("main tbody").get_by_role("button", name="Reject", exact=True).count(),
         "checkboxes": boxes.count(), "controls": controls(page)}
    f["_step"] = w.step(page, "c5", c["side"], c["role"], c["user"],
                        f"Payments waiting for approval: {f['approve_buttons']} Approve, {f['checkboxes']} checkboxes.",
                        pins=pins or [pin(page.locator("main"), "No approve controls.", "must")])
    f["_box"] = main_box(page)
    return f


def s_expenses(page, c) -> dict:
    w.step(page, "c8", c["side"], c["role"], c["user"], "Expenses.", click=menu_item(page, "Expenses"))
    tab = page.get_by_role("button", name=re.compile(r"^Pending Approval \d+$"))
    n = tab_count(page, "Pending Approval")
    w.step(page, "c8", c["side"], c["role"], c["user"], f"The review queue: Pending Approval ({n}).", click=tab)
    settle(page)
    pick = c["db"]["exr_pick"]
    f = {"pending": n, "controls": controls(page)}
    w.check("c8", c["role"], f"{c['side']}: Pending Approval = DB pending requests ({c['db']['pending_expense_requests']})",
            str(n), n == c["db"]["pending_expense_requests"])
    if pick is None:
        f["_step"] = w.step(page, "c8", c["side"], c["role"], c["user"], "No pending Expense Request in the data.")
        return f
    row = page.locator("main tbody tr").filter(has_text=pick["name"]).first
    f["pick_in_queue"] = row.count() > 0
    f["pick_actions"] = sorted({b for b in (row.get_by_role("button").evaluate_all(
        "els => els.map(e => e.getAttribute('aria-label') || e.innerText.trim())") if row.count() else []) if b})
    w.check("c8", c["role"], f"{c['side']}: {pick['name']} (type {pick['type']}, routed to {pick['reviewer']}) is in "
            "the queue with Approve and Reject", f"in queue: {f['pick_in_queue']}; actions: "
            f"{', '.join(f['pick_actions']) or 'none'}",
            f["pick_in_queue"] and {"Approve request", "Reject request"} <= set(f["pick_actions"]))
    approve = row.get_by_role("button", name="Approve request")
    f["_step"] = w.step(page, "c8", c["side"], c["role"], c["user"],
                        f"{pick['name']} ({pick['type']}): its type has no reviewer of its own, so it routes to Admin.",
                        pins=[pin(approve if approve.count() else (row if row.count() else page.locator("main")),
                                  "Approve / Reject request." if approve.count() else
                                  f"{pick['name']} is not in this queue.", "info" if approve.count() else "must")])
    f["_box"] = main_box(page)
    return f


def s_invoices(page, c) -> dict:
    w.step(page, "c5", c["side"], c["role"], c["user"], "Vendor Invoice Recon.",
           click=menu_item(page, "Vendor Invoice Recon"))
    w.step(page, "c5", c["side"], c["role"], c["user"], "Pending Invoice Approvals.",
           click=page.get_by_role("button", name="Pending Invoice Approvals"))
    settle(page)
    po = page.get_by_role("button", name="PO", exact=True)
    if po.get_attribute("aria-pressed") != "true":
        w.step(page, "c5", c["side"], c["role"], c["user"], "Pick the PO invoices.", click=po)
        settle(page)
    settle(page, 3000)
    m = re.search(r"Page \d+ of \d+ \(\d+-\d+ of (\d+)\)", page.locator("main").inner_text())
    n = int(m.group(1)) if m else None  # no pager text read: the count check below fails, never passes on 0
    rows = page.locator("main tbody tr")
    f = {"pending": n, "approve_icons": rows.locator("button.text-green-600").count(),
         "reject_icons": rows.locator("button.text-red-600").count(),
         "recheck": page.get_by_role("button", name="Re-check").count() > 0, "controls": controls(page)}
    w.check("c5", c["role"], f"{c['side']}: Pending Invoice Approvals › PO = DB pending PO invoices "
            f"({c['db']['pending_po_invoices']})", "no pager text read" if n is None else str(n),
            n == c["db"]["pending_po_invoices"])
    pins = [pin(page.get_by_role("button", name="Re-check"), "Re-check.", "info")] if f["recheck"] else []
    f["_step"] = w.step(page, "c5", c["side"], c["role"], c["user"],
                        f"PO invoices waiting: {n}; {f['approve_icons']} Approve and {f['reject_icons']} Reject icons.",
                        pins=pins)
    if f["approve_icons"]:
        w.step(page, "c5", c["side"], c["role"], c["user"], "Each row's Approve (tick) and Reject (cross).",
               pins=[pin(rows.locator("button.text-green-600").first, "Approve Invoice.", "info"),
                     pin(rows.locator("button.text-red-600").first, "Reject Invoice.", "info")])
    f["_box"] = main_box(page)
    return f


def s_pr(page, c) -> dict:
    pick = c["db"]["pr_pick"]
    w.step(page, "c5", c["side"], c["role"], c["user"], "Procurement Requests.",
           click=menu_item(page, "Procurement Requests"))
    n = tab_count(page, "Approve PR")
    w.check("c5", c["role"], f"{c['side']}: Approve PR = DB Pending PRs ({c['db']['pending_prs']})", str(n),
            n == c["db"]["pending_prs"])
    w.step(page, "c5", c["side"], c["role"], c["user"], f"Approve PR ({n}).",
           click=page.get_by_role("button", name=re.compile(r"^Approve PR \d+$")))
    settle(page)
    if pick is None:
        return {"pending": n, "_step": w.step(page, "c5", c["side"], c["role"], c["user"], "No Pending PR in the data.")}
    w.step(page, "c5", c["side"], c["role"], c["user"], f"Open {pick['name']}.",
           click=page.locator(f"main tbody a[href*='/procurement-requests/{pick['name']}']"))
    settle(page, 4000)
    acts = page.locator("main")
    f = {"pending": n, "controls": controls(page)}
    approve = acts.get_by_role("button", name="Approve", exact=True)
    f["_step"] = w.step(page, "c5", c["side"], c["role"], c["user"], f"The approve view of {pick['name']}.",
                        pins=[pin(approve, "Delete / Reject / Approve.", "info")] if approve.count() else
                        [pin(acts, "No Approve on the approve view.", "must")])
    f["_box"] = main_box(page)
    return f


def s_po(page, c) -> dict:
    pick = c["db"]["po_pick"]
    w.step(page, "c5", c["side"], c["role"], c["user"], "Purchase Orders.", click=menu_item(page, "Purchase Orders"))
    n = tab_count(page, "Approved PO")
    w.check("c5", c["role"], f"{c['side']}: Approved PO = DB PO Approved ({c['db']['approved_pos']})", str(n),
            n == c["db"]["approved_pos"])
    w.step(page, "c5", c["side"], c["role"], c["user"], f"Approved PO ({n}).",
           click=page.get_by_role("button", name=re.compile(r"^Approved PO \d+$")))
    settle(page)
    if pick is None:
        w.check("c5", c["role"], f"{c['side']}: an Approved PO to open", "the DB has none", False)
        return {"approved": n, "_step": w.step(page, "c5", c["side"], c["role"], c["user"], "No Approved PO to open.",
                                               pins=[pin(page.locator("main"), "No PO picked.", "must")])}
    w.step(page, "c5", c["side"], c["role"], c["user"], f"Open {pick}, the most recently changed Approved PO.",
           click=page.locator("main tbody").get_by_role("link", name=pick, exact=True).first)
    settle(page, 5000)
    f = {"controls": controls(page)}
    f["_step"] = w.step(page, "c5", c["side"], c["role"], c["user"], f"The page of {pick}: its tabs and actions.",
                        pins=[pin(page.locator("main [role=tablist], main button").first, "Tabs and actions.", "info")])
    f["_box"] = main_box(page)
    return f


def s_snag(page, c) -> dict:
    pick = c["db"]["snag_pick"]
    w.step(page, "c5", c["side"], c["role"], c["user"], "Snag List.", click=menu_item(page, "Snag List"))
    settle(page, 3000)
    if pick is None:
        return {"_step": w.step(page, "c5", c["side"], c["role"], c["user"], "No project has a Pending snag.")}
    card = page.get_by_role("heading", name=pick["project_name"], exact=True).locator(
        "xpath=ancestor::*[.//text()[contains(., 'View Details')]][1]")
    w.step(page, "c5", c["side"], c["role"], c["user"],
           f"The project with most Pending snags ({pick['n']}). View Details.",
           click=card.get_by_text("View Details", exact=True))
    settle(page, 5000)
    bulk = page.get_by_role("button", name=re.compile(r"^Set status"))
    rowboxes = page.locator("main tbody").get_by_role("checkbox")
    f = {"bulk": bulk.count() > 0, "row_checkboxes": rowboxes.count() > 0, "controls": controls(page)}
    f["_step"] = w.step(page, "c5", c["side"], c["role"], c["user"], "The snag list: bulk Set status and row ticks.",
                        pins=[pin(bulk, "Set status (bulk edit, Admin only).", "info")] if f["bulk"] else
                        [pin(page.locator("main"), "No bulk Set status.", "must")])
    f["_box"] = main_box(page)
    return f


def s_rate_master(page, c) -> dict:
    w.step(page, "c5", c["side"], c["role"], c["user"], "Rate Master.", click=menu_item(page, "Rate Master"))
    settle(page, 4000)
    f = {"controls": controls(page)}
    freeze = page.get_by_text("Freeze for deployment").first
    f["_step"] = w.step(page, "c5", c["side"], c["role"], c["user"], "Rate Master as this viewer.",
                        pins=[pin(freeze, "Admin's Freeze for deployment.", "info")] if freeze.count() else [])
    f["_box"] = main_box(page)
    return f


def s_boq_templates(page, c) -> dict:
    open_admin_option(page, c, "c5", "BoQ Templates", "Admin Options › BoQ Templates.")
    settle(page, 3000)
    f = {"controls": controls(page)}
    seed = page.get_by_role("button", name=re.compile("Seed"))
    f["_step"] = w.step(page, "c5", c["side"], c["role"], c["user"], "BoQ Templates: the master template's admin.",
                        pins=[pin(seed, "Seed / Re-seed and the sheet controls.", "info")] if seed.count() else [])
    f["_box"] = main_box(page)
    return f


def s_commission(page, c) -> dict:
    w.step(page, "c5", c["side"], c["role"], c["user"], "Commission Report Tracker.",
           click=menu_item(page, "Commission Report Tracker"))
    settle(page, 4000)
    m = re.search(r"(\d+) of (\d+) projects", page.locator("main").inner_text())
    total = int(m.group(2)) if m else None
    w.check("c5", c["role"], f"{c['side']}: Commission Report total = DB reports ({c['db']['commission_reports']})",
            str(total), total == c["db"]["commission_reports"])
    f = {"of_total": total, "controls": controls(page)}
    pa = page.get_by_role("button", name="Pending Approval", exact=True)
    pins = [pin(pa, "Pending Approval tab (approvers).", "info")] if pa.count() else []
    st = page.get_by_role("button", name=re.compile(r"^Status"))
    if st.count():
        pins.append(pin(st.first, "Status filter (Admin).", "info"))
    f["_step"] = w.step(page, "c5", c["side"], c["role"], c["user"], "Commission Report: Admin's controls.", pins=pins)
    f["_box"] = main_box(page)
    return f


def s_departments(page, c) -> dict:
    open_admin_option(page, c, "c5", "Assets", "Admin Options › Assets.")
    tab = page.get_by_role("tab", name="Departments")
    if not tab.count():
        f = {"tab": False}
        f["_step"] = w.step(page, "c5", c["side"], c["role"], c["user"], "Assets: no Departments tab.")
        f["_box"] = main_box(page)
        return f
    w.step(page, "c5", c["side"], c["role"], c["user"], "Assets › Departments.", click=tab)
    settle(page)
    panel = page.get_by_role("tabpanel", name="Departments")
    rows = panel.locator("tbody tr")
    f = {"tab": True, "rows": rows.count(), "add": panel.get_by_role("button", name="Add Department").count() > 0,
         "rename": panel.get_by_role("button", name="Rename").count(), "controls": controls(page)}
    w.check("c5", c["role"], f"{c['side']}: Departments rows = DB departments ({c['db']['departments']})",
            str(f["rows"]), f["rows"] == c["db"]["departments"])
    add = panel.get_by_role("button", name="Add Department")
    f["_step"] = w.step(page, "c5", c["side"], c["role"], c["user"],
                        f"Departments: {f['rows']} rows, {f['rename']} Rename.",
                        pins=[pin(add, "Add Department / Rename (Admin and HR).", "info")] if f["add"] else
                        [pin(panel, "No Add Department.", "must")])
    f["_box"] = main_box(page)
    # Claim 13: the patch's department. An active row's name is dark (text-gray-900); a switched-off one is grey.
    tech = panel.locator("tbody tr").filter(has=page.get_by_text("Technology", exact=True))
    name = tech.get_by_text("Technology", exact=True).first
    f["technology"] = ("active" if "text-gray-900" in (name.locator("xpath=ancestor-or-self::span[1]")
                                                     .get_attribute("class") or "") else "inactive") \
        if tech.count() else "absent"
    want = {1: "active", 0: "inactive", None: "absent"}[c["db"]["technology_active"]]
    w.check("c13", c["role"], f"{c['side']}: Technology on the list = the DB ({want})", f["technology"],
            f["technology"] == want)
    if c["side"] == "after":
        w.check("c13", c["role"], "after: Technology is listed and active", f["technology"], f["technology"] == "active")
    else:
        w.check("c13", c["role"], "before: develop lists no Technology", f["technology"], f["technology"] == "absent")
    ok = f["technology"] == ("active" if c["side"] == "after" else "absent")
    w.step(page, "c13", c["side"], c["role"], c["user"], f"Departments: Technology is {f['technology']}.",
           pins=[pin(tech if tech.count() else panel, f"Technology: {f['technology']}.", "info" if ok else "must")])
    return f


READ_ONLY_BANNER = "These TDS items are pending approval from an admin"
DIALOG = "[role=dialog]:visible, [role=alertdialog]:visible"


def s_tds(page, c) -> dict:
    w.step(page, "c11", c["side"], c["role"], c["user"], "TDS Approval.", click=menu_item(page, "TDS Approval"))
    settle(page, 4000)
    # The Pending tab reads "Pending" with no number when it holds none.
    tab = page.locator("main").get_by_role("button", name=re.compile(r"^Pending(\s+\d+)?$")).first
    label = tab.inner_text().strip() if tab.count() else None
    n = None if label is None else int((re.findall(r"\d+", label) or ["0"])[-1])
    banner = page.get_by_text(READ_ONLY_BANNER)
    f = {"pending": n, "read_only_banner": banner.count() > 0, "controls": controls(page)}
    w.check("c11", c["role"], f"{c['side']}: Pending = DB pending TDS requests ({c['db']['pending_tds_requests']})",
            "no Pending tab read" if n is None else str(n), n == c["db"]["pending_tds_requests"])
    w.check("c11", c["role"], f"{c['side']}: no read-only banner (the viewer is an approver)",
            "banner shown" if f["read_only_banner"] else "no banner", not f["read_only_banner"])
    pick = c["db"]["tds_pick"]
    f["_step"] = w.step(page, "c11", c["side"], c["role"], c["user"],
                        f"TDS Approval › Pending: {n} requests, "
                        f"{'the read-only banner shows' if f['read_only_banner'] else 'no read-only banner'}.",
                        pins=[pin(banner, "Read-only banner: this viewer may not approve.", "must")]
                        if f["read_only_banner"] else [pin(tab if tab.count() else page.locator("main"),
                                                           f"Pending: {n}. No read-only banner.", "info")])
    f["_box"] = main_box(page)
    if pick is None:
        return f
    w.step(page, "c11", c["side"], c["role"], c["user"], f"Open {pick}, the newest pending TDS request.",
           click=page.locator("main tbody").get_by_text(pick, exact=True).first)
    settle(page, 4000)
    approve = page.get_by_role("button", name=re.compile("Approve Selected"))
    f["approve_selected"] = approve.count() > 0
    w.check("c11", c["role"], f"{c['side']}: Approve Selected on {pick}", "shown" if f["approve_selected"] else "missing",
            f["approve_selected"])
    w.step(page, "c11", c["side"], c["role"], c["user"], f"{pick}: the approve footer. Not pressed.",
           pins=[pin(approve, "Approve Selected / Reject Selected.", "info")] if f["approve_selected"] else
           [pin(page.locator("main"), "No Approve Selected.", "must")])
    return f


def s_po_invoice(page, c) -> dict:
    pick = c["db"]["inv_pick"]
    w.step(page, "c12", c["side"], c["role"], c["user"], "Vendor Invoice Recon.",
           click=menu_item(page, "Vendor Invoice Recon"))
    w.step(page, "c12", c["side"], c["role"], c["user"], "PO Invoices 2B Recon: the Approved PO invoices.",
           click=page.get_by_role("button", name="PO Invoices 2B Recon"))
    settle(page, 5000)
    if pick is None:
        w.check("c12", c["role"], f"{c['side']}: an Approved PO invoice to open", "the DB has none", False)
        return {"_step": w.step(page, "c12", c["side"], c["role"], c["user"], "No Approved PO invoice in the data.",
                                pins=[pin(page.locator("main"), "No invoice picked.", "must")])}
    page.locator("main input[placeholder^='Search by Invoice No']").first.fill(pick["invoice_no"])
    settle(page, 2500)
    row = page.locator("main tbody tr").filter(has_text=pick["invoice_no"]).first
    edit = row.locator(f"button[title='Edit Invoice {pick['invoice_no']}']")
    delete = row.locator(f"button[title='Delete Invoice {pick['invoice_no']}']")
    f = {"row": row.count() > 0, "edit": edit.count() > 0, "delete": delete.count() > 0}
    w.check("c12", c["role"], f"{c['side']}: {pick['invoice_no']} ({pick['document_name']}) has Edit and Delete",
            f"row {f['row']}, Edit {f['edit']}, Delete {f['delete']}", f["row"] and f["edit"] and f["delete"])
    if not (f["edit"] and f["delete"]):
        f["_step"] = w.step(page, "c12", c["side"], c["role"], c["user"], f"Searched {pick['invoice_no']}.",
                            pins=[pin(row if f["row"] else page.locator("main"), "No Edit / Delete on this invoice.",
                                      "must")])
        f["_box"] = main_box(page)
        return f
    f["_step"] = w.step(page, "c12", c["side"], c["role"], c["user"],
                        f"Searched {pick['invoice_no']}, the most recently changed Approved PO invoice. Open Edit.",
                        click=edit, pins=[pin(delete, "Delete Invoice.", "info")])
    f["_box"] = main_box(page)
    # The edit form is an alertdialog; the page also holds hidden dialogs, so take the visible one by its title.
    dialog = page.locator(DIALOG).filter(has_text="Edit Invoice").first
    dialog.wait_for(timeout=30_000)
    settle(page, 1500)
    f["edit_dialog"] = dialog.locator("h2, [role=heading]").first.inner_text().strip() if \
        dialog.locator("h2, [role=heading]").count() else "(no title)"
    w.step(page, "c12", c["side"], c["role"], c["user"], f"The edit dialog: {f['edit_dialog']}. Cancel, nothing saved.",
           click=dialog.get_by_role("button", name="Cancel", exact=True),
           pins=[pin(dialog.locator("h2").first, "Edit Invoice, with Update Invoice (not pressed).", "info")])
    dialog.wait_for(state="hidden", timeout=15_000)
    w.step(page, "c12", c["side"], c["role"], c["user"], "Open Delete.", click=delete)
    dialog = page.locator(DIALOG).filter(has_text=re.compile("Delete invoice", re.I)).first
    dialog.wait_for(timeout=15_000)
    cancel = dialog.get_by_role("button", name="Cancel", exact=True)
    f["delete_confirm"] = dialog.get_by_role("button", name="Confirm", exact=True).count() > 0
    w.check("c12", c["role"], f"{c['side']}: Delete asks to confirm", str(f["delete_confirm"]), f["delete_confirm"])
    w.step(page, "c12", c["side"], c["role"], c["user"], "The delete confirmation. Cancel: nothing is deleted.",
           click=cancel, pins=[pin(dialog.get_by_role("button", name="Confirm", exact=True), "Confirm (not pressed).",
                                   "info")])
    return f


def s_projects(page, c) -> dict:
    open_admin_option(page, c, "c9", "Projects", "Admin Options › Projects.")
    settle(page, 3000)
    n = tab_count(page, "Won Projects", role="tab")
    w.check("c9", c["role"], f"{c['side']}: Won Projects = DB Won ({c['db']['won_projects']})", str(n),
            n == c["db"]["won_projects"])
    f = {"won": n}
    f["_step"] = w.step(page, "c9", c["side"], c["role"], c["user"], f"Projects: Won Projects {n}.",
                        pins=[pin(page.get_by_role("tab", name=re.compile(r"^Won Projects")), f"DB: "
                                  f"{c['db']['won_projects']} Won.", "info")])
    f["_box"] = main_box(page)
    return f


SCREENS = [("dashboard", s_dashboard), ("sidebar", s_sidebar), ("new_user", s_new_user), ("users", s_users),
           ("payments", s_payments), ("expenses", s_expenses), ("invoices", s_invoices), ("pr", s_pr), ("po", s_po),
           ("snag", s_snag), ("rate_master", s_rate_master), ("boq_templates", s_boq_templates),
           ("commission", s_commission), ("departments", s_departments), ("projects", s_projects), ("tds", s_tds),
           ("po_invoice", s_po_invoice)]
CID = {"dashboard": "c4", "sidebar": "c3", "new_user": "c1", "users": "c6", "payments": "c5", "expenses": "c8",
       "invoices": "c5", "pr": "c5", "po": "c5", "snag": "c5", "rate_master": "c5", "boq_templates": "c5",
       "commission": "c5", "departments": "c5", "projects": "c9", "tds": "c11", "po_invoice": "c12"}
# A screen that errors fails its claim, and these claims as well: the Users screen also carries claim 2's badges,
# the dashboard claim 7's Reminders panel, Departments claim 13's Technology row.
ALSO_FAILS = {"users": ("c2",), "dashboard": ("c7",), "departments": ("c13",)}


# ---------------------------------------------------------------- run

print(devenv("script", a.after, str(VERIFY / "software_developer_seed.py")).strip().splitlines()[-2:])
for task, emails in ((a.after, (a.admin, DEVELOPER)), (a.before, (a.admin,))):
    for email in emails:
        devenv("run", task, "set-password", email, a.password)
DB = {"after": db(a.after, seed=True), "before": db(a.before)}
(out / "db" / "facts.json").write_text(json.dumps(DB, indent=1))
ALL_TITLES = sorted(set(DB["before"]["admin"]["pending_reminders"]) | set(DB["after"]["admin"]["pending_reminders"])
                    | set(DB["after"]["developer"]["pending_reminders"]))

# The data side of the claims, read before any screen.
dv, ad = DB["after"]["developer"], DB["after"]["admin"]
w.check("c1", "DB", "after: the profile exists; before: it does not",
        f"after {SD_PROFILE in DB['after']['profiles']}, before {SD_PROFILE in DB['before']['profiles']}",
        SD_PROFILE in DB["after"]["profiles"] and SD_PROFILE not in DB["before"]["profiles"])
w.check("c4", "DB", "the developer has exactly Admin's Roles", f"{len(dv['roles'])} vs {len(ad['roles'])} roles; "
        f"differ: {sorted(set(dv['roles']) ^ set(ad['roles'])) or 'none'}", dv["roles"] == ad["roles"])
w.check("c9", "DB", "the developer has no project permission", str(dv["project_permissions"]),
        dv["project_permissions"] == 0)
w.check("c9", "DB", "the developer sees every record the walk uses, as Admin", json.dumps(dv["sees"]),
        dv["sees"] == ad["sees"])
w.check("c10", "DB", "the Admin sees the same records before and after", json.dumps(DB["before"]["admin"]["sees"]),
        DB["before"]["admin"]["sees"] == ad["sees"])
w.check("c7", "DB", f"the developer's pending reminders = Admin's + {REMINDER_TITLE!r}", ", ".join(dv["pending_reminders"]),
        set(dv["pending_reminders"]) == set(ad["pending_reminders"]) | {REMINDER_TITLE})
w.check("c7", "DB", "the Admin's pending reminders do not include the developer-only one",
        ", ".join(ad["pending_reminders"]), REMINDER_TITLE not in ad["pending_reminders"])
w.check("c8", "DB", "every pending Expense Request routes to the Admin profile (no type has a reviewer of its own)",
        f"{DB['after']['exr_admin_routed']} of {DB['after']['pending_expense_requests']}",
        DB["after"]["exr_admin_routed"] == DB["after"]["pending_expense_requests"])

VIEWERS = [("before", a.before, ADMIN, a.admin), ("after", a.after, ADMIN, a.admin), ("after", a.after, DEV, DEVELOPER)]
seen: dict = {}
for side, task, role, user in VIEWERS:
    ctx = {"side": side, "role": role, "user": user, "task": task, "db": DB[side], "all_titles": ALL_TITLES}
    facts: dict = {}
    with session(task, user, a.password) as (page, _):
        home = page.url
        for name, fn in SCREENS:
            if a.only and name not in a.only:
                continue
            n_steps = len(w.data["steps"])
            try:
                facts[name] = fn(page, ctx)
            except Exception as e:
                traceback.print_exc()
                why = f"{type(e).__name__}: {str(e).splitlines()[0][:200]}"
                facts[name] = {"error": why}
                for cid in (CID[name], *ALSO_FAILS.get(name, ())):
                    w.check(cid, role, f"{side}: the {name} screen walks without an error", why, False)
                try:
                    w.step(page, CID[name], side, role, user, f"The walk stopped on {name}: {why}",
                        pins=[pin(page.locator("body"), f"Walk stopped here ({name}): {why}", "must")])
                except Exception:
                    traceback.print_exc()
                print(f"screen {name} as {role} on {side}: {why} (after {len(w.data['steps']) - n_steps} steps)")
            page.goto(home)
            settle(page, 2000)
    seen[(side, role)] = facts


# ---------------------------------------------------------------- compare the three views



def public(f: dict) -> dict:
    return {k: v for k, v in f.items() if not k.startswith("_")}


def describe(x, y) -> str:
    if isinstance(x, list) and isinstance(y, list):
        return f"only in first: {sorted(set(x) - set(y)) or 'none'}; only in second: {sorted(set(y) - set(x)) or 'none'}"
    if isinstance(x, dict) and isinstance(y, dict):
        return "; ".join(f"{k}: {x.get(k)!r} vs {y.get(k)!r}" for k in sorted(set(x) | set(y)) if x.get(k) != y.get(k))
    return f"{x!r} vs {y!r}"


def pin_pair(f1: dict, f2: dict, text: str) -> None:
    """Pin a difference on both screens of the pair (the screenshots the reviewer compares)."""
    for f in (f1, f2):
        st, box = f.get("_step"), f.get("_box")
        if st is not None and box:
            st["pins"].append({"box": box, "text": text, "kind": "must", "evidence": "seen"})


def compare(name: str, cid: str, first: tuple, second: tuple, role: str, label: str, skip: tuple = ()) -> None:
    f1, f2 = seen.get(first, {}).get(name), seen.get(second, {}).get(name)
    if f1 is None or f2 is None:
        return
    p1 = {k: v for k, v in public(f1).items() if k not in skip}
    p2 = {k: v for k, v in public(f2).items() if k not in skip}
    if "error" in p1 or "error" in p2:
        # Not compared: an error on either side is a failure, even when both sides fail the same way.
        w.check(cid, role, f"{name}: {label}", f"not compared, the screen errored: {p1.get('error') or p2.get('error')}",
                False)
        return
    for k in sorted(set(p1) & set(p2)):
        same = p1.get(k) == p2.get(k)
        w.check(cid, role, f"{name}.{k}: {label}", "same" if same else describe(p1.get(k), p2.get(k)), same)
        if not same:
            pin_pair(f1, f2, f"{label}: {name}.{k} differs. {describe(p1.get(k), p2.get(k))}"[:400])


for name, _ in SCREENS:
    # Developer = Admin on the after env. The dashboard's reminders differ by design (claim 7): checked below.
    compare(name, CID[name], (("after", ADMIN)), ("after", DEV), DEV, "developer = Admin (after)",
            skip=("reminders",) if name == "dashboard" else ("list_badge", "list_orange", "profile_badge",
                                                             "profile_orange", "rename_target", "rename_developer")
            if name == "users" else ())
    # Admin before = Admin after (claim 10). The Users card counts the two made-up users seeded on the after env.
    compare(name, "c10", ("before", ADMIN), ("after", ADMIN), ADMIN, "Admin before = after",
            skip=("cards",) if name == "dashboard" else ("list_badge", "list_orange", "profile_badge", "profile_orange",
                                                         "rename_developer") if name == "users" else
            ("options",) if name == "new_user" else
            # Technology is the patch's new row (claim 13, checked against each env's DB on the screen itself).
            ("rows", "rename", "technology") if name == "departments" else ())

# Claim 4: each card against its env's DB, for all three views; the landing page; claim 7: the Reminders panel.
for (side, role), facts in seen.items():
    d = facts.get("dashboard")
    if not d or "error" in d:
        continue
    w.check("c4", role, f"{side}: lands on the Admin Dashboard, not locked", f"{d['url_path']}; Admin Dashboard: "
            f"{d['admin_dashboard']}", d["admin_dashboard"] and "lock" not in d["url_path"])
    w.check("c4", role, f"{side}: every card = its DB count", describe(d["cards"], DB[side]["cards"]) or "all equal",
            d["cards"] == DB[side]["cards"])
    want = DB[side]["developer" if role == DEV else "admin"]["pending_reminders"]
    w.check("c7", role, f"{side}: Reminders panel = the DB's pending reminders ({', '.join(want) or 'none'})",
            "no Reminders panel read" if d["reminders"] is None else ", ".join(d["reminders"]) or "none",
            d["reminders"] == sorted(want))
d_dev = seen.get(("after", DEV), {}).get("dashboard", {})
d_adm = seen.get(("after", ADMIN), {}).get("dashboard", {})
if d_dev.get("reminders") is not None and d_adm.get("reminders") is not None:
    w.check("c7", DEV, "the developer sees the developer-only reminder", ", ".join(d_dev["reminders"]),
            REMINDER_TITLE in d_dev["reminders"])
    w.check("c7", ADMIN, "the Admin does not see the developer-only reminder", ", ".join(d_adm["reminders"]),
            REMINDER_TITLE not in d_adm["reminders"])
nu_b, nu_a = seen.get(("before", ADMIN), {}).get("new_user", {}), seen.get(("after", ADMIN), {}).get("new_user", {})
if "options" in nu_b and "options" in nu_a:
    extra = sorted(set(nu_a["options"]) - set(nu_b["options"]))
    gone = sorted(set(nu_b["options"]) - set(nu_a["options"]))
    w.check("c1", ADMIN, "after offers exactly develop's profiles plus Software Developer",
            f"added: {extra or 'none'}; removed: {gone or 'none'}",
            not gone and len(extra) == 1 and "Software Developer" in extra[0])
cb, ca = seen.get(("before", ADMIN), {}).get("dashboard", {}), seen.get(("after", ADMIN), {}).get("dashboard", {})
if "cards" in cb and "cards" in ca:
    moved = {k for k in cb["cards"] if cb["cards"][k] != ca["cards"].get(k)}
    seeded = DB["after"]["cards"]["Users"] - DB["before"]["cards"]["Users"]
    w.check("c10", ADMIN, f"dashboard cards before = after, but Users (+{seeded}: the made-up users seeded on the after env)",
            describe(cb["cards"], ca["cards"]) or "all equal", moved <= {"Users"} and
            ca["cards"]["Users"] - cb["cards"]["Users"] == seeded)

# Roll each change up from its checks and pins.
for c in w.data["changes"]:
    if c["status"] == "not_walked" and c["reason"]:
        continue
    if not any(x["change"] == c["id"] for x in w.data["steps"] + w.data["checks"]):
        continue
    bad = [k for k in w.data["checks"] if k["change"] == c["id"] and not k["ok"] and k["kind"] == "must"]
    musts = [p for s in w.data["steps"] if s["change"] == c["id"] for p in s["pins"] if p["kind"] == "must"]
    w.status(c["id"], "failed" if bad or musts else "seen",
             "; ".join(f"{k['role']}: expected {k['expect']}, saw {k['seen']}" for k in bad)[:1500])
# Claim 11 with no pending TDS request: the approver gate on the list was walked, the approve footer could not be.
if DB["after"]["tds_pick"] is None and w._change("c11")["status"] == "seen":
    w.status("c11", "not_walked", "No pending TDS request in the data, so no request's approve footer (Approve Selected) "
             "could be opened. Walked instead: TDS Approval › Pending shows the DB's count and no read-only banner for "
             "the developer, as for Admin (the banner shows only to a viewer who may not approve). Pinned by "
             "services/test_software_developer_reach.py (TDS approve).")
(out / "seen.json").write_text(json.dumps({f"{s}/{r}": {n: public(f) for n, f in v.items()} for (s, r), v in
                                          seen.items()}, indent=1, default=str))
print(w.save())
print(", ".join(f"{c['id']} {c['status']}" for c in w.data["changes"]))
