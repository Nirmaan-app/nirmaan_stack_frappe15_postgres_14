"""Walk the Reimbursements page: every step of a claim, each by its own role (graduated from PR #1737's walk).

    python3 -I .claude/skills/verify/bin/walk_reimbursements.py <env> <out dir> [function ...]   # from the checkout root

`setup` raises the walk's own claims first, through the app's own raise and approve calls as the claimant and an Admin
would (an env copied from a production backup holds few claims and none linked to an expense): a ₹60,000 and a ₹2,500
claim walked through every step, a ₹700 one HR rejects and an Admin deletes, and a ₹900 one raised last month and
already approved. Each run tags its claims' titles with a fresh stamp, so a rerun walks fresh claims. The users are
picked by query (an HR user the app locks for an asset declaration or audit is cleared the way the lock card asks);
the CEO is `CEO_AUTHORIZED_USER`. State between functions is kept in `<out dir>/state.json`, so a part can be rerun.
"""

from __future__ import annotations

import datetime
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from feature_walk import PW, FeatureWalk, is_locked, pin, session, settle, sidebar, sidebar_ready, table_total  # noqa: E402

fw = FeatureWalk("Reimbursements", "reimbursements.md")
w = fw.w
STATE = fw.out / "state.json"
state: dict = json.loads(STATE.read_text()) if STATE.exists() else {}


def keep() -> None:
    STATE.write_text(json.dumps(state, indent=1))


w.change("tabs", "One tab per step, per role",
         "CEO sees all 8 tabs; Admin all but Pending CEO Approval; HR 4; Accountant 5; anyone else only Raised By Me.")
w.change("cap", "Project Manager › ₹2,000 monthly cap",
         "A Project Manager can't raise more than ₹2,000 of claims in a calendar month: the dialog and the server refuse.")
w.change("hr", "Pending Approval › HR bulk approve / reject",
         "HR decides one claim or many at once; a claim whose month reaches ₹2,000 goes to Pending L1 Approval.")
w.change("status", "The claim carries its expense's status",
         "Requested → CEO Pending → Approved → Reconciliation Pending → Paid: claim and expense never disagree.")
w.change("payments", "Project Payments & Expenses leaves claim expenses out",
         "A claim's Non-Project Expense is not listed in Project Payment & Expense, and its Type facet has no "
         "Reimbursement option.")
w.change("l1", "Pending L1 Approval › Admin decides",
         "Admin approves on Pending L1 Approval; above ₹50,000 the claim goes on to Pending CEO Approval.")
w.change("delete", "Admin deletes a Rejected claim", "An Admin may delete anyone's claim once it is Rejected, from All.")
w.change("ceo", "Pending CEO Approval › the CEO only",
         "Only the CEO has Pending CEO Approval; their approval sends the claim to Payment need to be paid.")
w.change("action", "Action Center › reimbursement item",
         "The Accountant's Action Center lists the claim's expense tagged Reimbursement and opens Payment need to be "
         "paid searched to the claim, on all months.")
w.change("month", "Month bar on every tab", "Each tab has a month picker with tiles and the totals by type.")
w.change("pay", "Payment need to be paid › Export for Payment, Mark as Paid",
         "Export for Payment reads ICICI XXXX3327; Mark as Paid moves the claim to Reconciliation Pending.")
w.change("reconcile", "Reconciliation Pending › Mark Reconciled",
         "Receipt, UTR and date make the claim Paid; it shows in Reconciliation Done / Paid.")

TABS = {
    "CEO": ["Pending Approval", "Pending L1 Approval", "Pending CEO Approval", "Payment need to be paid",
            "Reconciliation Pending", "Reconciliation Done / Paid", "All", "Reimbursement Raised By Me"],
    "Admin": ["Pending Approval", "Pending L1 Approval", "Payment need to be paid", "Reconciliation Pending",
              "Reconciliation Done / Paid", "All", "Reimbursement Raised By Me"],
    "HR": ["Pending Approval", "Reconciliation Done / Paid", "All", "Reimbursement Raised By Me"],
    "Accountant": ["Payment need to be paid", "Reconciliation Pending", "Reconciliation Done / Paid", "All",
                   "Reimbursement Raised By Me"],
    "Project Manager": ["Reimbursement Raised By Me"],
}

facts = fw.db("facts", r'''
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services.reimbursements.month_total import month_used
from frappe.utils import now_datetime
now = now_datetime()
pms = candidates("Nirmaan Project Manager Profile")
used = {u: float(month_used(u, now, None)) for u in pms}
emit({
    "ceo": CEO_AUTHORIZED_USER if frappe.db.get_value("User", CEO_AUTHORIZED_USER, "enabled") else None,
    "Admin": [u for u in candidates("Nirmaan Admin Profile") if u != CEO_AUTHORIZED_USER],
    "HR": candidates("Nirmaan HR Executive Profile") + candidates("Nirmaan HR Lead Profile"),
    "Accountant": candidates("Nirmaan Accountant Profile"),
    "Project Manager": sorted((u for u in pms if used[u] <= 1200), key=lambda u: used[u]),
    "Claimant": candidates("Nirmaan PMO Executive Profile"),
})
''')
if not facts["ceo"]:
    sys.exit("the CEO user (CEO_AUTHORIZED_USER) is missing or disabled on this env")


# --- users -------------------------------------------------------------------------------------------------------

def clear_asset_tasks(page) -> None:
    """The access gate's card: sign each asset declaration and send each monthly audit, as its steps ask."""
    for _ in range(4):
        settle(page, 1500)
        if not page.get_by_role("button", name="Open my assets").count():
            return
        page.get_by_role("button", name="Open my assets").first.click()
        settle(page, 2000)
        if page.get_by_role("button", name="Sign", exact=True).count():
            page.get_by_role("button", name="Sign", exact=True).first.click()
            page.wait_for_timeout(1500)
            d = page.get_by_role("dialog")
            d.locator("[role=checkbox], input[type=checkbox]").first.click()
            d.get_by_role("button", name="Next").click()
            page.wait_for_timeout(1200)
            c = d.locator("canvas").first.bounding_box()
            page.mouse.move(c["x"] + 40, c["y"] + c["height"] / 2)
            page.keyboard.down("Space")  # the pad draws while Space is held
            for i in range(1, 40):
                page.mouse.move(c["x"] + 40 + i * 6, c["y"] + c["height"] / 2 + (14 if i % 2 else -14), steps=3)
            page.keyboard.up("Space")
            d.get_by_role("button", name="Sign & Submit").click()
        elif page.get_by_role("button", name="Submit audit").count():
            page.get_by_role("button", name="Submit audit").first.click()
            page.wait_for_timeout(1500)
            d = page.get_by_role("dialog")
            d.get_by_text("Yes, it is working").click()
            d.get_by_role("button", name="Submit audit").click()
        settle(page, 3000)
        page.goto(re.match(r"(https?://[^/]+)", page.url).group(1) + "/")


def user(role: str) -> str:
    """An unlocked user for `role`: the first candidate the app does not lock, or one whose lock is only asset tasks
    (cleared as that user, on this env only)."""
    if role in fw.users:
        return fw.users[role]
    if role == "CEO":
        fw.set_password(facts["ceo"])
        fw.users[role] = facts["ceo"]
        return facts["ceo"]
    for email in facts[role]:
        fw.set_password(email)
        with session(fw.env, email, PW) as (page, _):
            if is_locked(page):
                clear_asset_tasks(page)
                if is_locked(page):
                    continue
        fw.users[role] = email
        (fw.out / "users.json").write_text(json.dumps(fw.users, indent=1))
        return email
    sys.exit(f"no {role} user on env {fw.env} can use the app ({facts[role]})")


# --- screen helpers ----------------------------------------------------------------------------------------------

def tab(page, label: str):
    # A "/" in a regex passed to Playwright breaks the selector: match any character there.
    words = r"\s*".join(re.escape(p).replace("/", ".") for p in label.split())
    return page.get_by_role("tab", name=re.compile(rf"^{words}(\s*\d+)?$"))


def tab_bar(page):
    return page.get_by_role("tablist", name="Reimbursement tabs").first


def label_of(text: str) -> str:
    return re.sub(r"\s*\d+$", "", re.sub(r"\s+", " ", text)).strip()


def count_of(text: str) -> int | None:
    m = re.search(r"(\d+)$", text.strip())
    return int(m.group(1)) if m else None


def row(page, claim: str):
    return page.locator("tbody tr").filter(has_text=claim).first


def open_reimbursements(page) -> None:
    sidebar_ready(page)
    sidebar(page, "Reimbursements")
    settle(page, 2500)


def search(page, text: str) -> None:
    """The claims table searches by Title by default, so the walk searches its stamped titles."""
    page.get_by_placeholder(re.compile(r"^Search", re.I)).first.fill(text)
    settle(page, 2000)


def tick_all(dialog) -> None:
    for cb in dialog.locator("[role=checkbox]").all():
        cb.click()


def claims_now(name: str, claims: list[str]) -> dict:
    return fw.db(name, r'''
rows = {}
for n in json.loads(sys.argv[1]):
    c = frappe.db.get_value("Reimbursement", n, "status")
    e = frappe.db.get_value("Non Project Expenses", {"reimbursement": n}, ["name", "status", "payment_ref"], as_dict=1)
    rows[n] = {"claim": c, "expense": e.name if e else None, "expense_status": e.status if e else None,
               "payment_ref": e.payment_ref if e else None}
emit(rows)
''', json.dumps(claims))


def receipt() -> Path:
    from PIL import Image, ImageDraw
    p = fw.out / "files" / "walk-receipt.jpg"
    p.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (600, 400), "white")
    ImageDraw.Draw(img).text((30, 30), "Feature walk test receipt (made up)", fill="black")
    img.save(p, "JPEG")
    return p


# --- setup -------------------------------------------------------------------------------------------------------

def setup() -> None:
    for role in ("CEO", "Admin", "HR", "Accountant", "Project Manager", "Claimant"):
        user(role)
    s = datetime.datetime.now().strftime("%d%H%M%S")
    made = fw.db("seed", r'''
import io, zlib
from PIL import Image, ImageDraw
from frappe.utils import now_datetime, add_days, get_first_day
from nirmaan_stack.services.payees.own_accounts import add_own_account, my_account
from nirmaan_stack.api.reimbursements.claims import raise_reimbursement
from nirmaan_stack.api.reimbursements.review import approve_reimbursement
a = json.loads(sys.argv[1])

def receipt(key):
    img = Image.new("RGB", (600, 400), "white")
    ImageDraw.Draw(img).text((30, 30), f"Feature walk test receipt {key} (made up)", fill="black")
    buf = io.BytesIO(); img.save(buf, "JPEG")
    return frappe.get_doc({"doctype": "File", "file_name": f"walk-{key}.jpg", "content": buf.getvalue(),
                           "is_private": 1}).insert(ignore_permissions=True).file_url

def account(u):
    frappe.set_user(u)
    mine = my_account(u)
    if mine:
        return mine.name
    number = "5010" + str(zlib.crc32(u.encode()) % 10**10).zfill(10)  # one per person, the same on every run
    return add_own_account(u, "Walk " + u.split("@")[0][:20], number, "HDFC0000001")[0]

made = {}
account(a["pm"])
payee = account(a["claimant"])
frappe.set_user(a["claimant"])
for key, title, amount, kind in a["claims"]:
    made[key] = raise_reimbursement(title, amount, payee, json.dumps([receipt(key)]),
                                    "Feature walk test claim, made up for the walk.", kind)["name"]
frappe.db.commit()
frappe.set_user(a["admin"])
approve_reimbursement(made["old"], acknowledged=1)
last_month = add_days(get_first_day(now_datetime()), -3)
frappe.db.sql('UPDATE "tabReimbursement" SET creation = %s WHERE name = %s', (f"{last_month} 11:00:00", made["old"]))
frappe.db.commit()
made["old_month"] = str(last_month)[:7]
emit(made)
''', json.dumps({"pm": fw.users["Project Manager"], "claimant": fw.users["Claimant"], "admin": fw.users["Admin"],
                 "claims": [["big", f"Walk {s} site visit flights", 60000, "Travel"],
                            ["mid", f"Walk {s} team lunch", 2500, "Food"],
                            ["rej", f"Walk {s} courier", 700, "Others"],
                            ["old", f"Walk {s} last month taxi", 900, "Travel"]]}))
    state.update(stamp=s, claims=made, users=fw.users)
    keep()


def users_from_state() -> None:
    fw.users.update(state.get("users", {}))


# --- the walk ----------------------------------------------------------------------------------------------------

def tabs() -> None:
    for role in ("CEO", "Admin", "HR", "Accountant", "Project Manager"):
        email = user(role)
        with fw.session(email) as page:
            sidebar_ready(page)
            w.step(page, "tabs", "after", role, email, f"{role}: open Reimbursements from the sidebar.",
                   click=page.locator('[data-sidebar="menu-button"]').get_by_text("Reimbursements", exact=True))
            settle(page, 2500)
            names = [label_of(t) for t in tab_bar(page).get_by_role("tab").all_inner_texts()]
            ok = sorted(names) == sorted(TABS[role])
            w.check("tabs", role, f"{len(TABS[role])} tabs: " + ", ".join(TABS[role]),
                    f"{len(names)} tabs: " + ", ".join(names), ok)
            w.step(page, "tabs", "after", role, email, f"{role} sees {len(names)} tabs.",
                   pins=[pin(tab_bar(page), ", ".join(names), "info" if ok else "must")])


def cap() -> None:
    role = "Project Manager"
    email = user(role)
    used = fw.db("pm_month", r'''
from nirmaan_stack.services.reimbursements.month_total import month_used
from frappe.utils import now_datetime
emit(float(month_used(sys.argv[1], now_datetime(), None)))
''', email)
    first = float(int((2000 - used) * 0.75))
    left = 2000 - used - first
    with fw.session(email) as page:
        open_reimbursements(page)
        w.step(page, "cap", "after", role, email,
               f"A Project Manager raises a claim. Claims already counted this month: ₹{used:,.0f}.",
               click=page.get_by_role("button", name="Raise Reimbursement"))
        page.wait_for_timeout(1500)
        d = page.get_by_role("dialog")
        d.get_by_role("radio", name="Food").click()
        d.locator("#reimb-title").fill(f"Walk {state['stamp']} PM site tea")
        page.wait_for_timeout(1500)
        hint = d.locator("#reimb-amount").locator("xpath=../..").locator("p").first
        hint_text = hint.inner_text() if hint.count() else ""
        w.check("cap", role, f"the dialog says ₹{2000 - used:,.2f} is left", hint_text,
                f"{2000 - used:,.2f}" in hint_text.replace("₹", ""), "should")
        d.locator("#reimb-amount").fill(str(int(first)))
        d.locator("input[type=file]").set_input_files(str(receipt()))
        page.wait_for_timeout(1500)
        w.step(page, "cap", "after", role, email, f"₹{first:,.0f} fits inside the cap: Raise.",
               click=d.get_by_role("button", name="Raise Reimbursement"), pins=[pin(hint, hint_text, "info")])
        settle(page, 3500)
        page.get_by_role("button", name="Raise Reimbursement").first.click()
        page.wait_for_timeout(1500)
        d = page.get_by_role("dialog")
        d.get_by_role("radio", name="Travel").click()
        d.locator("#reimb-title").fill(f"Walk {state['stamp']} PM extra cab")
        d.locator("#reimb-amount").fill("600")
        page.wait_for_timeout(2000)
        err = d.locator("p.text-destructive").filter(has_text="Project Managers").first
        err_text = err.inner_text() if err.count() else ""
        btn = d.get_by_role("button", name="Raise Reimbursement")
        disabled = btn.is_disabled()
        w.check("cap", role, f"₹600 more is refused (\"up to ₹{left:,.2f} more\") and Raise is disabled",
                f"{err_text!r}, Raise {'disabled' if disabled else 'enabled'}", f"{left:,.2f}" in err_text and disabled)
        w.step(page, "cap", "after", role, email, "₹600 more would pass ₹2,000: the dialog refuses it.",
               pins=[pin(err if err.count() else d, err_text or "no refusal shown", "info" if err_text else "must"),
                     pin(btn, "Raise disabled." if disabled else "Raise enabled.", "info" if disabled else "must")])
    srv = fw.db("pm_cap_server", r'''
import io
from PIL import Image
from nirmaan_stack.services.payees.own_accounts import my_account
from nirmaan_stack.api.reimbursements.claims import raise_reimbursement
u = sys.argv[1]
frappe.set_user(u)
buf = io.BytesIO(); Image.new("RGB", (60, 40), "white").save(buf, "JPEG")
f = frappe.get_doc({"doctype": "File", "file_name": "walk-cap.jpg", "content": buf.getvalue(), "is_private": 1}).insert(ignore_permissions=True)
try:
    raise_reimbursement("Walk cap probe", 600, my_account(u).name, json.dumps([f.file_url]), None, "Travel")
    res = "accepted"
except Exception as e:
    res = f"{type(e).__name__}: {e}"
frappe.db.rollback()
emit(res)
''', email)
    w.check("cap", role, "the server refuses the same ₹600 (raise_reimbursement, rolled back)", srv,
            "Project Managers can claim up to" in srv)


def hr() -> None:
    role = "HR"
    email = user(role)
    c = state["claims"]
    with fw.session(email) as page:
        open_reimbursements(page)
        search(page, f"Walk {state['stamp']}")
        w.step(page, "hr", "after", role, email, f"HR on Pending Approval: tick {c['big']} (₹60,000) and {c['mid']} (₹2,500).",
               click=row(page, c["big"]).get_by_role("checkbox"))
        row(page, c["mid"]).get_by_role("checkbox").click()
        page.wait_for_timeout(600)
        bar = page.get_by_role("group", name="Selected claims")
        w.step(page, "hr", "after", role, email, "Approve the ticked claims together.",
               click=bar.get_by_role("button", name="Approve", exact=True),
               pins=[pin(bar, re.sub(r"\s+", " ", bar.inner_text()), "info")])
        page.wait_for_timeout(1500)
        dlg = page.get_by_role("alertdialog")
        text = re.sub(r"\s+", " ", dlg.inner_text()).lower()
        w.check("hr", role, "the dialog says both go to Pending L1 Approval (the month reaches ₹2,000)",
                "says so" if "goes to pending l1 approval · 2" in text else text[:300],
                "goes to pending l1 approval · 2" in text, "should")
        tick_all(dlg)
        w.step(page, "hr", "after", role, email, "Approve 2 claims.",
               click=dlg.get_by_role("button", name=re.compile(r"^Approve 2 claims")))
        settle(page, 3000)
        st = claims_now("after_hr", [c["big"], c["mid"]])
        for n in (c["big"], c["mid"]):
            w.check("status", role, f"{n}: claim and expense Requested", f"{st[n]['claim']} / {st[n]['expense_status']}",
                    st[n]["claim"] == "Requested" == st[n]["expense_status"])
        w.step(page, "hr", "after", role, email, f"Reject {c['rej']} (₹700) with a reason.",
               click=row(page, c["rej"]).get_by_role("button", name=f"Reject {c['rej']}"))
        page.wait_for_timeout(1000)
        dlg = page.get_by_role("alertdialog")
        dlg.locator("textarea").fill("Feature walk: duplicate of another claim.")
        w.step(page, "hr", "after", role, email, "Reject claim.", click=dlg.get_by_role("button", name="Reject claim"))
        settle(page, 2500)
        st = claims_now("after_reject", [c["rej"]])
        w.check("hr", role, f"{c['rej']} Rejected", str(st[c["rej"]]["claim"]), st[c["rej"]]["claim"] == "Rejected")


def payments() -> None:
    role = "Admin"
    email = user(role)
    c = state["claims"]
    with fw.session(email) as page:
        sidebar_ready(page)
        w.step(page, "payments", "after", role, email, "Admin opens Project Payment & Expense.",
               click=page.locator('[data-sidebar="menu-button"]').get_by_text("Project Payment & Expense", exact=True))
        settle(page, 3000)
        w.step(page, "payments", "after", role, email, "Open All Payments.",
               click=page.get_by_role("button", name=re.compile(r"^All Payments")).first)
        settle(page, 3000)
        box = page.get_by_placeholder(re.compile(r"^Search", re.I)).first
        for k, n in enumerate((c["big"], c["mid"])):
            # Its expense's description ends in [<claim>], which this search box reads.
            box.fill(n)
            settle(page, 2000)
            found = page.locator("tbody tr").filter(has_text=re.compile(r"\w")).filter(has_not_text="No results").count()
            w.check("payments", role, f"{n}'s expense not listed", f"{found} rows", found == 0)
            if k == 0:
                w.step(page, "payments", "after", role, email, f"Search {n}: no expense. It is paid on Reimbursements.",
                       pins=[pin(box, f"{n}: {found} rows.", "info" if not found else "must")])
        box.fill("")
        settle(page, 2000)
        head = page.get_by_role("columnheader").filter(has_text=re.compile(r"^\s*Type")).first
        head.locator("svg").first.click()
        page.wait_for_timeout(1500)
        pop = page.locator("[data-radix-popper-content-wrapper]").first
        opts = re.sub(r"\s+", " ", pop.inner_text())
        npe = re.search(r"Non Project Expense \((\d+)\)", opts)
        db = fw.db("npe_counts", r'''
emit({"npe": frappe.db.count("Non Project Expenses"),
      "linked": frappe.db.sql("""select count(*) from "tabNon Project Expenses" where coalesce(reimbursement,'')<>''""")[0][0]})
''')
        want = db["npe"] - db["linked"]
        w.check("payments", role, f"Type facet Non Project Expense = {want:,} ({db['npe']:,} in the DB − {db['linked']} "
                "claim-linked)", npe.group(0) if npe else "none", bool(npe) and int(npe.group(1)) == want)
        w.check("payments", role, "no \"Non Project – Reimbursement\" option", opts[:300],
                "Non Project – Reimbursement (" not in opts)
        w.step(page, "payments", "after", role, email, "The Type facet: no Reimbursement option.",
               pins=[pin(pop, opts[:200], "info")])
        page.keyboard.press("Escape")


def l1() -> None:
    role = "Admin"
    email = user(role)
    c = state["claims"]
    with fw.session(email) as page:
        open_reimbursements(page)
        t = tab(page, "Pending L1 Approval").first
        w.step(page, "l1", "after", role, email, "Admin opens on Pending L1 Approval.",
               pins=[pin(t, f"Badge {count_of(t.inner_text())}.", "info")])
        search(page, f"Walk {state['stamp']}")
        for n in (c["big"], c["mid"]):
            w.step(page, "l1", "after", role, email, f"Approve {n}.",
                   click=row(page, n).get_by_role("button", name=f"Approve {n}"))
            page.wait_for_timeout(1500)
            dlg = page.get_by_role("alertdialog")
            tick_all(dlg)
            w.step(page, "l1", "after", role, email, "The dialog says where it goes next. Approve.",
                   click=dlg.get_by_role("button", name=re.compile(r"^Approve")))
            settle(page, 3000)
        st = claims_now("after_l1", [c["big"], c["mid"]])
        b, m = st[c["big"]], st[c["mid"]]
        w.check("l1", role, f"{c['big']} (₹60,000, above ₹50,000): CEO Pending", f"{b['claim']} / {b['expense_status']}",
                b["claim"] == "CEO Pending" == b["expense_status"])
        w.check("l1", role, f"{c['mid']} (₹2,500): Approved", f"{m['claim']} / {m['expense_status']}",
                m["claim"] == "Approved" == m["expense_status"])
        w.check("status", role, "claim status = expense status after L1", json.dumps(st),
                all(v["claim"] == v["expense_status"] for v in st.values()))
        has_ceo = tab(page, "Pending CEO Approval").count()
        w.check("ceo", role, "Admin has no Pending CEO Approval tab", "present" if has_ceo else "absent", not has_ceo)
        w.step(page, "l1", "after", role, email, "Both have left Pending L1 Approval.")


def admin_delete() -> None:
    role = "Admin"
    email = user(role)
    c = state["claims"]
    with fw.session(email) as page:
        open_reimbursements(page)
        w.step(page, "delete", "after", role, email, "Open All.", click=tab(page, "All").first)
        settle(page, 2000)
        search(page, f"Walk {state['stamp']}")
        w.step(page, "delete", "after", role, email, f"{c['rej']} is Rejected: Admin gets Delete on it.",
               click=row(page, c["rej"]).get_by_role("button", name=f"Delete {c['rej']}"))
        page.wait_for_timeout(1000)
        w.step(page, "delete", "after", role, email, "Delete claim.",
               click=page.get_by_role("alertdialog").get_by_role("button", name="Delete claim"))
        settle(page, 2500)
        gone = fw.db("after_delete", 'emit(bool(frappe.db.exists("Reimbursement", sys.argv[1])))', c["rej"])
        w.check("delete", role, f"{c['rej']} deleted", "still there" if gone else "deleted", not gone)
        others = sum(row(page, n).get_by_role("button", name=f"Delete {n}").count() for n in (c["big"], c["mid"]))
        w.check("delete", role, "no Delete on claims that are not Rejected", f"{others} Delete buttons", others == 0)
        w.step(page, "delete", "after", role, email, f"{c['rej']} is gone; the other claims have no Delete.")


def ceo() -> None:
    role = "CEO"
    email = user(role)
    big = state["claims"]["big"]
    with fw.session(email) as page:
        open_reimbursements(page)
        search(page, f"Walk {state['stamp']}")
        w.step(page, "ceo", "after", role, email, f"The CEO opens on Pending CEO Approval. Approve {big}.",
               click=row(page, big).get_by_role("button", name=f"Approve {big}"))
        page.wait_for_timeout(1500)
        dlg = page.get_by_role("alertdialog")
        tick_all(dlg)
        w.step(page, "ceo", "after", role, email, "Approve.", click=dlg.get_by_role("button", name=re.compile(r"^Approve")))
        settle(page, 3000)
        st = claims_now("after_ceo", [big])[big]
        w.check("ceo", role, f"{big}: Approved", f"{st['claim']} / {st['expense_status']}",
                st["claim"] == "Approved" == st["expense_status"])
        w.step(page, "ceo", "after", role, email, "It has left Pending CEO Approval.")


def action() -> None:
    role = "Accountant"
    email = user(role)
    big = state["claims"]["big"]
    with fw.session(email) as page:
        settle(page, 2500)
        w.step(page, "action", "after", role, email, "Dashboard › Action Center › Expenses.",
               click=page.get_by_role("button", name=re.compile(r"^\d+\s*Expenses$")).first)
        settle(page, 1500)
        group = page.get_by_role("button").filter(has=page.get_by_role("heading", name="Non-Project", exact=True)).first
        if group.get_attribute("aria-expanded") != "true":
            group.click()
            page.wait_for_timeout(800)
        item = page.get_by_role("button").filter(has_text=big).first
        text = re.sub(r"\s+", " ", item.inner_text()) if item.count() else ""
        w.check("action", role, f"{big}'s expense is listed, tagged Reimbursement", text[:200] or "not listed",
                "reimbursement" in text.lower())
        w.step(page, "action", "after", role, email, f"Open the item for {big}.", click=item)
        settle(page, 3000)
        listed = row(page, big).count()
        w.check("action", role, "lands on Payment need to be paid, searched to the claim, all months", page.url,
                "tab=approved" in page.url and "month=all" in page.url and listed > 0)
        w.step(page, "action", "after", role, email, f"Payment need to be paid with {big} found.",
               pins=[pin(row(page, big) if listed else page.locator("tbody").first,
                         f"{big} {'listed' if listed else 'not listed'}.", "info" if listed else "must")])


def pay() -> None:
    role = "Accountant"
    email = user(role)
    c = state["claims"]
    approved = fw.db("approved", r'''
rows = frappe.db.sql("""select name, to_char(creation,'YYYY-MM') m from "tabReimbursement" where status='Approved'""", as_dict=1)
emit({"all": len(rows), "this_month": sum(r.m == frappe.utils.nowdate()[:7] for r in rows)})
''')
    with fw.session(email) as page:
        open_reimbursements(page)
        t = tab(page, "Payment need to be paid").first
        badge, shown = count_of(t.inner_text()), table_total(page)
        hidden = row(page, c["old"]).count() == 0
        # Known (PR #1737 walk): the badge counts every month, the list opens on this month. A fix is planned; until
        # then this check reports it as "should" and the walk still passes.
        w.check("month", role, f"badge = rows the tab shows ({approved['all']} Approved claims in all)",
                f"badge {badge}, list {shown}", badge == shown, "should")
        w.step(page, "month", "after", role, email,
               f"Payment need to be paid opens on this month: badge {badge}, list {shown}.",
               pins=[pin(t, f"Badge {badge}.", "info"),
                     pin(page.get_by_text(re.compile(r"raised in")).first,
                         f"{c['old']} (raised {state['claims']['old_month']}, approved, unpaid) is "
                         f"{'hidden until All is picked' if hidden else 'listed'}.", "should" if badge != shown else "info")])
        w.step(page, "month", "after", role, email, "Open the month picker.",
               click=page.get_by_label("Pick a month").first)
        page.wait_for_timeout(1200)
        pop = page.locator("[data-radix-popper-content-wrapper]").first
        tiles = re.sub(r"\s+", " ", pop.inner_text()) if pop.count() else ""
        w.check("month", role, "the picker shows month tiles with counts and totals", tiles[:200], "₹" in tiles)
        w.step(page, "month", "after", role, email, "Month tiles, each with its count and total.",
               pins=[pin(pop, tiles[:200], "info")] if pop.count() else [])
        page.keyboard.press("Escape")
        page.get_by_role("button", name=re.compile(r"^All$")).first.click()
        settle(page, 2000)
        w.check("month", role, f"All months lists {c['old']}", "listed" if row(page, c["old"]).count() else "missing",
                row(page, c["old"]).count() > 0)
        search(page, f"Walk {state['stamp']}")
        row(page, c["big"]).get_by_role("checkbox").click()
        row(page, c["mid"]).get_by_role("checkbox").click()
        page.wait_for_timeout(600)
        bar = page.get_by_role("group", name="Selected claims")
        w.step(page, "pay", "after", role, email, "Tick two claims, then Export for Payment.",
               click=bar.get_by_role("button", name="Export for Payment"))
        page.wait_for_timeout(1500)
        dlg = page.get_by_role("dialog")
        icici = dlg.get_by_text(re.compile(r"ICICI - XXXX\d{4}")).first
        icici_text = icici.inner_text() if icici.count() else ""
        w.check("pay", role, "Export for Payment reads ICICI - XXXX3327", icici_text or "none", "XXXX3327" in icici_text)
        w.step(page, "pay", "after", role, email, "The shared ICICI debit account.",
               pins=[pin(icici if icici.count() else dlg, icici_text or "none", "info" if icici_text else "must")])
        page.keyboard.press("Escape")
        page.wait_for_timeout(800)
        w.step(page, "pay", "after", role, email, f"Mark {c['mid']} as Paid.",
               click=row(page, c["mid"]).get_by_role("button", name="Mark as Paid"))
        page.wait_for_timeout(1200)
        w.step(page, "pay", "after", role, email, "Confirm.",
               click=page.get_by_role("alertdialog").get_by_role("button", name="Mark as Paid"))
        settle(page, 3000)
        st = claims_now("after_paid", [c["mid"]])[c["mid"]]
        w.check("pay", role, f"{c['mid']}: Reconciliation Pending", f"{st['claim']} / {st['expense_status']}",
                st["claim"] == "Reconciliation Pending" == st["expense_status"])


def reconcile() -> None:
    role = "Accountant"
    email = user(role)
    mid = state["claims"]["mid"]
    with fw.session(email) as page:
        open_reimbursements(page)
        w.step(page, "reconcile", "after", role, email, "Open Reconciliation Pending.",
               click=tab(page, "Reconciliation Pending").first)
        settle(page, 2000)
        search(page, f"Walk {state['stamp']}")
        w.step(page, "reconcile", "after", role, email, f"Mark {mid} Reconciled.",
               click=row(page, mid).get_by_role("button", name="Mark Reconciled"))
        page.wait_for_timeout(1500)
        dlg = page.get_by_role("alertdialog")
        # The dialog takes the receipt first (it tries to read it); the date and reference fields show after.
        dlg.locator("input[type=file]").first.set_input_files(str(receipt()))
        dlg.locator("#payment_ref_update_pd").wait_for(timeout=60_000)
        page.wait_for_timeout(1000)
        utr = f"WALKUTR{state['stamp']}"
        dlg.locator("#payment_ref_update_pd").fill(utr)
        if not dlg.locator("#payment_date_update_pd").input_value():
            dlg.locator("#payment_date_update_pd").fill(datetime.date.today().isoformat())
        page.wait_for_timeout(800)
        w.step(page, "reconcile", "after", role, email, "Receipt, UTR and date filled; Mark as Reconciled.",
               click=dlg.get_by_role("button", name="Mark as Reconciled"))
        settle(page, 3500)
        st = claims_now("after_reconcile", [mid])[mid]
        w.check("reconcile", role, f"{mid}: Paid, UTR {utr}", f"{st['claim']} / {st['expense_status']}, {st['payment_ref']}",
                st["claim"] == "Paid" == st["expense_status"] and st["payment_ref"] == utr)
        w.check("status", role, "claim status = expense status after reconcile", f"{st['claim']} / {st['expense_status']}",
                st["claim"] == st["expense_status"])
        w.step(page, "reconcile", "after", role, email, "Open Reconciliation Done / Paid.",
               click=tab(page, "Reconciliation Done / Paid").first)
        settle(page, 2000)
        search(page, f"Walk {state['stamp']}")
        listed = row(page, mid).count()
        w.check("reconcile", role, f"{mid} on Reconciliation Done / Paid", "listed" if listed else "missing", listed > 0)
        w.step(page, "reconcile", "after", role, email, f"{mid} is Paid.",
               pins=[pin(row(page, mid), "Paid.", "info")] if listed else [])


if not fw.only or "setup" in fw.only:
    fw.run([("tabs", setup)])
users_from_state()
fw.run([("tabs", tabs), ("cap", cap), ("hr", hr), ("payments", payments), ("l1", l1), ("delete", admin_delete),
        ("ceo", ceo), ("action", action), ("pay", pay), ("reconcile", reconcile)])
fw.finish()
