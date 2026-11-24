"""Walk PR #1737 (Reimbursements: every step of a claim on the Reimbursements page) on its env and its base env.

    python3 -I walk_pr_1737.py <out dir> [function ...]   # from the checkout root, with pr-1737 and pr-1737-base served

The env data (backup of 2026-11-17) holds 2 Pending claims and no claim-linked expense, so the walk raises its own
claims first (setup, through the app's own raise / approve calls, as the claimant and HR would), then drives every
step on screen. Each run tags its claims' titles with a fresh stamp, so a rerun walks fresh claims. Facts each
function needs are read from the env DB and kept in `<out>/db/`. State between functions is kept in `<out>/state.json`,
so one function can be rerun alone.
"""

from __future__ import annotations

import datetime
import json
import re
import subprocess
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "verify" / "bin"))
sys.path.insert(0, str(HERE))
from drive import session, sidebar  # noqa: E402
from record import Walk, pin  # noqa: E402

AFTER, BEFORE = "pr-1737", "pr-1737-base"
PW = "WalkPw-1737"
DEVENV = "/Users/abhishek/work/nirmaan/deploy_setup/frappe_docker/development/devenv.sh"
USERS = {
    "Admin": "admins@nirmaan.app",
    "CEO": "nitesh@nirmaan.app",
    "HR": "parulsagar18@gmail.com",
    "Accountant": "swathi@nirmaan.app",
    "Project Manager": "bittukumarara802204@gmail.com",
    "Claimant (PMO)": "pmo@nirmaan.app",
}

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
STATE = out / "state.json"
state: dict = json.loads(STATE.read_text()) if STATE.exists() else {}


def keep() -> None:
    STATE.write_text(json.dumps(state, indent=1))


w = Walk(out, pr={"number": 1737, "title": "Reimb/own tabs",
                  "url": "https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/pull/1737",
                  "author": "madhubalan17js", "head": "15dd8df22", "base": "de49cf3c0"},
         envs={"after": AFTER, "before": BEFORE},
         data_note="a test copy of the production backup of 2026-11-17, plus claims the walk raised itself")
if (out / "walk.json").exists():
    old = json.loads((out / "walk.json").read_text())
    w.data["steps"], w.data["checks"] = old["steps"], old["checks"]

w.change("tabs", "Reimbursements › one tab per step, per role",
         "CEO sees all 8 tabs; Admin all but Pending CEO Approval; HR 4 (Pending Approval, Reconciliation Done / Paid, "
         "Raised By Me, All); Accountant 5 (Payment need to be paid, Reconciliation Pending, Reconciliation Done / Paid, "
         "Raised By Me, All); anyone else only Raised By Me.")
w.change("hr", "Pending Approval › HR bulk approve / reject",
         "HR (and Admin) decide on Pending Approval, one claim or many at once (at most 100). A claim whose month reaches "
         "the ₹2,000 limit goes to Pending L1 Approval.")
w.change("payments", "Project Payments & Expenses › claim expenses leave",
         "A claim's Non-Project Expense no longer shows in Project Payments & Expenses: not in its tabs, counts, Type "
         "facet or export, and there is no \"Reimbursement\" type.")
w.change("l1", "Pending L1 Approval › Admin decides",
         "Admin (and the CEO) approve or reject on Pending L1 Approval, the same decision as Payments' L1. Above ₹50,000 "
         "the claim goes on to Pending CEO Approval.")
w.change("ceo", "Pending CEO Approval › the CEO only",
         "Only the CEO sees Pending CEO Approval and decides there; the claim then waits in Payment need to be paid.")
w.change("pay", "Payment need to be paid › Mark as Paid, Export for Payment",
         "Accounts marks claims Paid (they move to Reconciliation Pending) and exports the bank file. Export for Payment "
         "reads the same ICICI debit account as Project Payments (ICICI XXXX3327).")
w.change("reconcile", "Reconciliation Pending › Mark Reconciled",
         "Mark Reconciled takes the UTR and proof; the claim becomes Paid and shows in Reconciliation Done / Paid.")
w.change("month", "Month bar on every tab",
         "Every tab has a month bar: month tiles with counts and totals, and the totals by type (Travel, Food, Others).")
w.change("status", "The claim carries its expense's status",
         "Pending Approval → Requested → CEO Pending → Approved → Reconciliation Pending → Paid, or Rejected; the claim and "
         "its expense never disagree.")
w.change("cap", "Project Manager › ₹2,000 monthly cap",
         "A PM can't raise more than ₹2,000 of claims in a calendar month, checked at raise and at edit.")
w.change("delete", "Admin deletes a Rejected claim",
         "An Admin may delete anyone's claim once it is Rejected (from All).")
w.change("action", "Action Center › reimbursement item",
         "The Action Center's reimbursement item opens Reimbursements → Payment need to be paid, searched to the claim.")
w.change("patch", "Patch moves approved claims to their expense's status",
         "v3_0.reimbursement_status_from_expense moves Approved claims whose expense is Requested, CEO Pending or "
         "Reconciliation Pending to that status; a rerun moves nothing.")
w.change("race", "Race-safe claim lock",
         "lock_claim turns a simultaneous approve or reject into a clear message instead of a 500 error.")


# --- helpers -----------------------------------------------------------------------------------------------------

def db(task: str, name: str, code: str, *args: str) -> str:
    src = out / "db" / f"{name}.py"
    src.parent.mkdir(exist_ok=True)
    src.write_text("import json, sys\nimport frappe\n" + code)
    res = subprocess.run([DEVENV, "script", task, str(src), *args], capture_output=True, text=True, timeout=300)
    (out / "db" / f"{name}.txt").write_text(res.stdout + res.stderr)
    return res.stdout + res.stderr


def db_json(task: str, name: str, code: str, *args: str) -> dict:
    text = db(task, name, code, *args)
    line = next((l for l in text.splitlines() if l.startswith("JSON ")), None)
    if line is None:
        raise RuntimeError(f"db {name}: no JSON line; tail: {text[-600:]}")
    return json.loads(line[5:])


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
                w.data.setdefault("errors", []).append({"fn": fn.__name__, "change": cid,
                                                       "error": f"{type(e).__name__}: {str(e).splitlines()[0][:200]}"})


def tab(page, label: str):
    """A tab of the bar by its label; the label is on two lines with the count beside it."""
    # A "/" in a regex passed to Playwright breaks the selector (skill gotcha): match any character there.
    words = r"\s*".join(re.escape(p).replace("/", ".") for p in label.split())
    return page.get_by_role("tab", name=re.compile(rf"^{words}(\s*\d+)?$"))


def tab_names(page) -> list[str]:
    bar = page.get_by_role("tablist", name="Reimbursement tabs").first
    return [re.sub(r"\s+", " ", t).strip() for t in bar.get_by_role("tab").all_inner_texts()]


def label_of(text: str) -> str:
    return re.sub(r"\s*\d+$", "", text).strip()


def count_of(text: str) -> int | None:
    m = re.search(r"(\d+)$", text.strip())
    return int(m.group(1)) if m else None


def row(page, claim: str):
    return page.locator("tbody tr").filter(has_text=claim).first


def open_reimbursements(page) -> None:
    sidebar(page, "Reimbursements")
    settle(page, 2500)


def search(page, text: str) -> None:
    box = page.get_by_placeholder(re.compile(r"^Search", re.I)).first
    box.fill(text)
    settle(page, 2000)


def toast_text(page) -> str:
    t = page.locator("li[role=status], [data-sonner-toast], ol li").filter(has_text=re.compile(r"\w"))
    try:
        return " | ".join(x.strip() for x in t.all_inner_texts() if x.strip())[:400]
    except Exception:
        return ""


def claim_rows(task: str, name: str, claims: list[str]) -> dict:
    return db_json(task, name, r'''
names = json.loads(sys.argv[1])
rows = {}
for n in names:
    c = frappe.db.get_value("Reimbursement", n, ["name", "status", "amount", "creation"], as_dict=1)
    e = frappe.db.get_value("Non Project Expenses", {"reimbursement": n}, ["name", "status", "payment_date"], as_dict=1)
    rows[n] = {"claim": c.status if c else None, "expense": e.name if e else None, "expense_status": e.status if e else None,
               "paid_on": str(e.payment_date) if e and e.payment_date else None}
print("JSON " + json.dumps(rows, default=str))
''', json.dumps(claims))


# --- setup -------------------------------------------------------------------------------------------------------

SEED = r'''
import io, datetime
from PIL import Image, ImageDraw
from nirmaan_stack.services.payees.own_accounts import add_own_account, my_account
from nirmaan_stack.api.reimbursements.claims import raise_reimbursement
a = json.loads(sys.argv[1])

def receipt(key):
    img = Image.new("RGB", (600, 400), "white")
    ImageDraw.Draw(img).text((30, 30), f"PR walk test receipt {key} (made up)", fill="black")
    buf = io.BytesIO(); img.save(buf, "JPEG")
    return frappe.get_doc({"doctype": "File", "file_name": f"walk-{key}.jpg", "content": buf.getvalue(),
                           "is_private": 1}).insert(ignore_permissions=True).file_url

made = {}
for user, acct in a["accounts"].items():
    frappe.set_user(user)
    mine = my_account(user)
    made["payee:" + user] = mine.name if mine else add_own_account(user, *acct)[0]
frappe.set_user(a["claimant"])
payee = made["payee:" + a["claimant"]]
for key, title, amount, kind in a["claims"]:
    r = raise_reimbursement(title, amount, payee, json.dumps([receipt(key)]),
                            "PR walk test claim, made up for the walk.", kind)
    made[key] = r["name"]
frappe.db.commit()
for key, user in a.get("approve_as", {}).items():
    frappe.set_user(user)
    from nirmaan_stack.api.reimbursements.review import approve_reimbursement
    approve_reimbursement(made[key], acknowledged=1)
    frappe.db.commit()
for key, when in a.get("backdate", {}).items():
    frappe.db.sql('UPDATE "tabReimbursement" SET creation = %s WHERE name = %s', (when, made[key]))
    frappe.db.commit()
print("JSON " + json.dumps(made))
'''


def stamp() -> str:
    return datetime.datetime.now().strftime("%d%H%M")


def seed_after() -> None:
    s = stamp()
    made = db_json(AFTER, "seed_after", SEED, json.dumps({
        "accounts": {USERS["Claimant (PMO)"]: ["PMO Walk Test", "50100123450001", "HDFC0000001"],
                     USERS["Project Manager"]: ["Bittu Walk Test", "50100123450003", "HDFC0000001"]},
        "claimant": USERS["Claimant (PMO)"],
        "claims": [["big", f"Walk {s} site visit flights", 60000, "Travel"],
                   ["mid", f"Walk {s} team lunch", 2500, "Food"],
                   ["rej", f"Walk {s} courier", 700, "Others"],
                   ["oct", f"Walk {s} October taxi", 900, "Travel"]],
        "approve_as": {"oct": USERS["Admin"]},
        "backdate": {"oct": "2026-10-28 11:00:00"},
    }))
    state.update(stamp=s, after=made)
    keep()


def seed_before() -> None:
    s = stamp()
    made = db_json(BEFORE, "seed_before", SEED, json.dumps({
        "accounts": {USERS["Claimant (PMO)"]: ["PMO Walk Test", "50100123450001", "HDFC0000001"]},
        "claimant": USERS["Claimant (PMO)"],
        "claims": [["big", f"Walk {s} site visit flights", 60000, "Travel"],
                   ["mid", f"Walk {s} team lunch", 2500, "Food"]],
        "approve_as": {"big": USERS["HR"], "mid": USERS["HR"]},
    }))
    state.update(before=made)
    keep()


def unlock_hr(task: str) -> None:
    """Setup: HR holds an asset, and the app's access gate locks a holder until the declaration is signed and the
    month's audit is sent. Do both as HR, the way the gate's card asks (Open my assets, then Sign / Submit audit)."""
    with session(task, USERS["HR"], PW) as (page, _):
        for _ in range(3):
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
                page.keyboard.down("Space")
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


def setup_after() -> None:
    seed_after()
    unlock_hr(AFTER)


def setup_before() -> None:
    seed_before()
    unlock_hr(BEFORE)


# --- after: roles and tabs ---------------------------------------------------------------------------------------

EXPECT_TABS = {
    "CEO": ["Pending Approval", "Pending L1 Approval", "Pending CEO Approval", "Payment need to be paid",
            "Reconciliation Pending", "Reconciliation Done / Paid", "All", "Reimbursement Raised By Me"],
    "Admin": ["Pending Approval", "Pending L1 Approval", "Payment need to be paid", "Reconciliation Pending",
              "Reconciliation Done / Paid", "All", "Reimbursement Raised By Me"],
    "HR": ["Pending Approval", "Reconciliation Done / Paid", "All", "Reimbursement Raised By Me"],
    "Accountant": ["Payment need to be paid", "Reconciliation Pending", "Reconciliation Done / Paid", "All",
                   "Reimbursement Raised By Me"],
    "Project Manager": ["Reimbursement Raised By Me"],
}


def tabs_roles() -> None:
    for role in ("CEO", "Admin", "HR", "Accountant", "Project Manager"):
        user = USERS[role]
        with session(AFTER, user, PW) as (page, _):
            settle(page, 1500)
            w.step(page, "tabs", "after", role, user, f"{role}: open Reimbursements from the sidebar.",
                   click=page.locator('[data-sidebar="menu-button"]').get_by_text("Reimbursements", exact=True))
            settle(page, 2500)
            names = tab_names(page)
            labels = sorted(label_of(n) for n in names)
            ok = labels == sorted(EXPECT_TABS[role])
            w.check("tabs", role, f"{len(EXPECT_TABS[role])} tabs: " + ", ".join(EXPECT_TABS[role]),
                    f"{len(names)} tabs: " + ", ".join(label_of(n) for n in names), ok)
            bar = page.get_by_role("tablist", name="Reimbursement tabs").first
            sel = bar.get_by_role("tab", selected=True)
            w.step(page, "tabs", "after", role, user,
                   f"{role} sees {len(names)} tabs and opens on \"{label_of(sel.first.inner_text()) if sel.count() else '?'}\".",
                   pins=[pin(bar, f"{len(names)} tabs: " + ", ".join(label_of(n) for n in names) + ".",
                             "info" if ok else "must")])


# --- after: Project Manager cap ----------------------------------------------------------------------------------

def make_receipt() -> Path:
    from PIL import Image, ImageDraw
    p = out / "files" / "walk-receipt.jpg"
    p.parent.mkdir(exist_ok=True)
    img = Image.new("RGB", (600, 400), "white")
    ImageDraw.Draw(img).text((30, 30), "PR walk test receipt (made up)", fill="black")
    img.save(p, "JPEG")
    return p


def pm_cap() -> None:
    role = "Project Manager"; user = USERS[role]
    used = db_json(AFTER, "pm_month", r'''
from nirmaan_stack.services.reimbursements.month_total import month_used
from frappe.utils import now_datetime
print("JSON " + json.dumps({"used": float(month_used(sys.argv[1], now_datetime(), None))}))
''', user)["used"]
    first = float(int((2000 - used) * 0.75))
    receipt = make_receipt()
    with session(AFTER, user, PW) as (page, _):
        open_reimbursements(page)
        w.step(page, "cap", "after", role, user,
               f"A Project Manager ({user}) raises a claim. Claims already counted this month: ₹{used:,.0f}.",
               click=page.get_by_role("button", name="Raise Reimbursement"))
        page.wait_for_timeout(1500)
        d = page.get_by_role("dialog")
        d.get_by_role("radio", name="Food").click()
        d.locator("#reimb-title").fill(f"Walk {state['stamp']} PM site tea")
        hint = d.locator("#reimb-amount").locator("xpath=../..").locator("p").first
        page.wait_for_timeout(1500)
        hint_text = hint.inner_text() if hint.count() else ""
        w.check("cap", role, f"the dialog says how much is left: ₹{2000 - used:,.2f}", hint_text,
                f"{2000 - used:,.2f}" in hint_text.replace("₹", ""), "should")
        d.locator("#reimb-amount").fill(str(int(first)))
        d.locator("input[type=file]").set_input_files(str(receipt))
        page.wait_for_timeout(1500)
        w.step(page, "cap", "after", role, user, f"₹{first:,.0f} is inside the cap, so Raise is enabled.",
               click=d.get_by_role("button", name="Raise Reimbursement"),
               pins=[pin(hint, hint_text or "(no hint shown)", "info")])
        settle(page, 3500)
        w.step(page, "cap", "after", role, user, "The claim is raised and listed under Raised By Me.")
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
        left = 2000 - used - first
        w.check("cap", role, f"₹600 more is refused: \"You can claim up to ₹{left:,.2f} more this month\", Raise disabled",
                f"{err_text!r}, Raise {'disabled' if disabled else 'enabled'}",
                f"{left:,.2f}" in err_text and disabled)
        w.step(page, "cap", "after", role, user, f"₹600 more would pass ₹2,000: the dialog refuses it.",
               pins=[pin(err if err.count() else d, err_text or "no refusal shown", "info" if err_text else "must"),
                     pin(btn, "Raise is disabled." if disabled else "Raise is still enabled.",
                         "info" if disabled else "must")])
    srv = db_json(AFTER, "pm_cap_server", r'''
from nirmaan_stack.services.payees.own_accounts import my_account
from nirmaan_stack.api.reimbursements.claims import raise_reimbursement
user = sys.argv[1]
frappe.set_user(user)
import io
from PIL import Image
buf = io.BytesIO(); Image.new("RGB", (60, 40), "white").save(buf, "JPEG")
f = frappe.get_doc({"doctype": "File", "file_name": "walk-cap.jpg", "content": buf.getvalue(), "is_private": 1}).insert(ignore_permissions=True)
try:
    raise_reimbursement("Walk cap probe", 600, my_account(user).name, json.dumps([f.file_url]), None, "Travel")
    res = "accepted"
except Exception as e:
    res = f"{type(e).__name__}: {e}"
frappe.db.rollback()
print("JSON " + json.dumps({"res": res}))
''', user)["res"]
    w.check("cap", role, "server refuses the same ₹600 raise (raise_reimbursement, rolled back)", srv,
            "Project Managers can claim up to" in srv)


# --- after: HR ---------------------------------------------------------------------------------------------------

def hr_decide() -> None:
    role = "HR"; user = USERS[role]
    big, mid, rej = state["after"]["big"], state["after"]["mid"], state["after"]["rej"]
    with session(AFTER, user, PW) as (page, _):
        open_reimbursements(page)
        search(page, f"Walk {state['stamp']}")
        w.step(page, "hr", "after", role, user, f"HR on Pending Approval: tick {big} (₹60,000) and {mid} (₹2,500).",
               click=row(page, big).get_by_role("checkbox"))
        row(page, mid).get_by_role("checkbox").click()
        page.wait_for_timeout(600)
        bar = page.get_by_role("group", name="Selected claims")
        w.step(page, "hr", "after", role, user, "The bar shows the amount of the ticked claims; Approve them together.",
               click=bar.get_by_role("button", name="Approve", exact=True),
               pins=[pin(bar, bar.inner_text().replace("\n", " "), "info")])
        page.wait_for_timeout(1500)
        dlg = page.get_by_role("alertdialog")
        text = dlg.inner_text()
        w.check("hr", role, "bulk dialog says both go to Pending L1 Approval (the month passes ₹2,000)",
                re.sub(r"\s+", " ", text)[:400], "goes to pending l1 approval · 2" in re.sub(r"\s+", " ", text).lower(), "should")
        for cb in dlg.locator("[role=checkbox]").all():
            cb.click()
        w.step(page, "hr", "after", role, user, "Approve 2 claims.",
               click=dlg.get_by_role("button", name=re.compile(r"^Approve 2 claims")))
        settle(page, 3000)
        w.step(page, "hr", "after", role, user, "Both have left Pending Approval.")
        st = claim_rows(AFTER, "hr_after_approve", [big, mid])
        for n in (big, mid):
            w.check("status", role, f"{n}: claim Requested, expense Requested",
                    f"claim {st[n]['claim']}, expense {st[n]['expense_status']}",
                    st[n]["claim"] == "Requested" and st[n]["expense_status"] == "Requested")
        state["exp"] = {n: st[n]["expense"] for n in (big, mid)}
        keep()
        w.step(page, "hr", "after", role, user, f"Reject {rej} (₹700) with a reason.",
               click=row(page, rej).get_by_role("button", name=f"Reject {rej}"))
        page.wait_for_timeout(1000)
        dlg = page.get_by_role("alertdialog")
        dlg.locator("textarea").fill("PR walk: duplicate of another claim.")
        w.step(page, "hr", "after", role, user, "Reason written; Reject claim.",
               click=dlg.get_by_role("button", name="Reject claim"))
        settle(page, 2500)
        st = claim_rows(AFTER, "hr_after_reject", [rej])
        w.check("hr", role, f"{rej} Rejected", st[rej]["claim"] or "gone", st[rej]["claim"] == "Rejected")


# --- after: Payments page ----------------------------------------------------------------------------------------

def payments_walk(task: str, side: str, claims: list[str]) -> None:
    """Admin on Project Payment & Expense › All Payments: search each claim's ID (its expense's description ends in
    [<claim>]) and read the Type facet. After this PR they are gone; before it they were listed, typed Reimbursement."""
    role = "Admin"; user = USERS[role]
    after = side == "after"
    with session(task, user, PW) as (page, _):
        settle(page, 1000)
        w.step(page, "payments", side, role, user,
               ("" if after else "Before this PR: ") + "Admin opens Project Payment & Expense.",
               click=page.locator('[data-sidebar="menu-button"]').get_by_text("Project Payment & Expense", exact=True))
        settle(page, 3000)
        all_tab = page.get_by_role("button", name=re.compile(r"^All Payments")).or_(
            page.get_by_role("tab", name=re.compile(r"^All Payments"))).first
        w.step(page, "payments", side, role, user, "Open All Payments.", click=all_tab)
        settle(page, 3000)
        for k, c in enumerate(claims):
            search(page, c)
            r = page.locator("tbody tr").filter(has_text=re.compile(r"\w")).filter(has_not_text="No results")
            found = r.count()
            if after:
                w.check("payments", role, f"{c}'s expense not listed in All Payments", f"{found} rows", found == 0)
            else:
                w.check("payments", role, f"before this PR: {c}'s expense listed", f"{found} rows", found > 0, "info")
            if k == 0:
                box = page.get_by_placeholder(re.compile(r"^Search", re.I)).first
                if after:
                    w.step(page, "payments", side, role, user,
                           f"Search the claim {c}: no expense. It is paid on the Reimbursements page now.",
                           pins=[pin(box, f"{c}: {found} rows.", "info" if not found else "must")])
                else:
                    w.step(page, "payments", side, role, user,
                           f"Before: the claim {c}'s expense is listed here, where L1, CEO and Mark as Paid happened.",
                           pins=[pin(r.first, re.sub(r"\s+", " ", r.first.inner_text())[:160], "info")] if found
                           else [pin(box, "not found", "info")])
        search(page, "")
        head = page.get_by_role("columnheader").filter(has_text=re.compile(r"^\s*Type")).first
        head.locator("svg").first.click()
        page.wait_for_timeout(1500)
        pop = page.locator("[data-radix-popper-content-wrapper]").first
        opts = re.sub(r"\s+", " ", pop.inner_text()) if pop.count() else ""
        has_reimb = "Non Project – Reimbursement (" in opts
        npe = re.search(r"Non Project Expense \((\d+)\)", opts)
        facts = db_json(task, f"npe_counts_{side}", r'''
print("JSON " + json.dumps({"npe": frappe.db.count("Non Project Expenses"),
  "linked": frappe.db.sql("""select count(*) from "tabNon Project Expenses" where coalesce(reimbursement,'')<>''""")[0][0]}))
''')
        want = facts["npe"] - facts["linked"] if after else facts["npe"]
        w.check("payments", role, f"Type facet Non Project Expense = {want:,} ({facts['npe']:,} in the DB"
                + (f" − {facts['linked']} claim-linked)" if after else ", claim-linked included)"),
                npe.group(0) if npe else "no Non Project Expense option", bool(npe) and int(npe.group(1)) == want,
                "must" if after else "info")
        if after:
            w.check("payments", role, "Type facet has no \"Non Project – Reimbursement\" option", opts[:300], not has_reimb)
        else:
            w.check("payments", role, "before this PR: Type facet has a \"Reimbursement\" option", opts[:300], has_reimb, "info")
        w.step(page, "payments", side, role, user,
               ("Type facet: " if after else "Before: Type facet: ") + ("no \"Reimbursement\" option." if not has_reimb
                                                                        else "a \"Reimbursement\" option."),
               pins=[pin(pop, opts[:220], "info" if has_reimb != after else "must")] if pop.count() else [])
        page.keyboard.press("Escape")
        if not after:
            open_reimbursements(page)
            names = tab_names(page)
            w.step(page, "tabs", "before", role, user,
                   f"Before: Admin's Reimbursements has {len(names)} tabs: " + ", ".join(label_of(n) for n in names) + ".",
                   pins=[pin(page.get_by_role("tablist").first, "No L1, CEO or reconcile tabs.", "info")])


def payments_after() -> None:
    payments_walk(AFTER, "after", [state["after"]["big"], state["after"]["mid"]])


def payments_before() -> None:
    payments_walk(BEFORE, "before", [state["before"]["big"], state["before"]["mid"]])


# --- after: Admin L1 and delete ----------------------------------------------------------------------------------

def admin_l1() -> None:
    role = "Admin"; user = USERS[role]
    big, mid = state["after"]["big"], state["after"]["mid"]
    with session(AFTER, user, PW) as (page, _):
        open_reimbursements(page)
        t = tab(page, "Pending L1 Approval").first
        w.step(page, "l1", "after", role, user, "Admin opens on Pending L1 Approval; HR's two approvals wait here.",
               pins=[pin(t, f"Badge: {count_of(t.inner_text())}.", "info")])
        search(page, f"Walk {state['stamp']}")
        w.step(page, "l1", "after", role, user, f"Approve {big} (₹60,000).",
               click=row(page, big).get_by_role("button", name=f"Approve {big}"))
        page.wait_for_timeout(1500)
        dlg = page.get_by_role("alertdialog")
        land = re.sub(r"\s+", " ", dlg.inner_text())
        for cb in dlg.locator("[role=checkbox]").all():
            cb.click()
        w.step(page, "l1", "after", role, user, "The dialog says where it goes next.",
               click=dlg.get_by_role("button", name=re.compile(r"^Approve")),
               pins=[pin(dlg.locator("p").filter(has_text=re.compile("Goes|goes|Pending CEO|Payment need")).first
                         if dlg.locator("p").filter(has_text=re.compile("Goes|goes|Pending CEO|Payment need")).count() else dlg,
                         land[-200:], "info")])
        settle(page, 3000)
        w.step(page, "l1", "after", role, user, f"Approve {mid} (₹2,500).",
               click=row(page, mid).get_by_role("button", name=f"Approve {mid}"))
        page.wait_for_timeout(1500)
        dlg = page.get_by_role("alertdialog")
        for cb in dlg.locator("[role=checkbox]").all():
            cb.click()
        dlg.get_by_role("button", name=re.compile(r"^Approve")).click()
        settle(page, 3000)
        st = claim_rows(AFTER, "after_l1", [big, mid])
        w.check("l1", role, f"{big} (₹60,000 > ₹50,000): CEO Pending", f"claim {st[big]['claim']}, expense {st[big]['expense_status']}",
                st[big]["claim"] == "CEO Pending" == st[big]["expense_status"])
        w.check("l1", role, f"{mid} (₹2,500): Approved", f"claim {st[mid]['claim']}, expense {st[mid]['expense_status']}",
                st[mid]["claim"] == "Approved" == st[mid]["expense_status"])
        w.check("status", role, "claim status = expense status after L1",
                json.dumps({k: [v["claim"], v["expense_status"]] for k, v in st.items()}),
                all(v["claim"] == v["expense_status"] for v in st.values()))
        has_ceo = tab(page, "Pending CEO Approval").count()
        w.check("ceo", role, "Admin (not the CEO) has no Pending CEO Approval tab", "present" if has_ceo else "absent",
                not has_ceo)
        w.step(page, "l1", "after", role, user, "Both left Pending L1 Approval; Admin has no Pending CEO Approval tab.")


def admin_delete() -> None:
    role = "Admin"; user = USERS[role]
    rej = state["after"]["rej"]
    with session(AFTER, user, PW) as (page, _):
        open_reimbursements(page)
        w.step(page, "delete", "after", role, user, "Open All.", click=tab(page, "All").first)
        settle(page, 2000)
        search(page, f"Walk {state['stamp']}")
        w.step(page, "delete", "after", role, user, f"{rej} is Rejected: Admin gets a Delete button on it.",
               click=row(page, rej).get_by_role("button", name=f"Delete {rej}"))
        page.wait_for_timeout(1000)
        dlg = page.get_by_role("alertdialog")
        w.step(page, "delete", "after", role, user, "Confirm.", click=dlg.get_by_role("button", name="Delete claim"))
        settle(page, 2500)
        gone = db_json(AFTER, "after_delete", 'print("JSON " + json.dumps({"exists": bool(frappe.db.exists("Reimbursement", sys.argv[1]))}))', rej)
        w.check("delete", role, f"{rej} deleted", "still there" if gone["exists"] else "deleted", not gone["exists"])
        others = [n for k, n in state["after"].items() if k in ("big", "mid")]
        btns = sum(row(page, n).get_by_role("button", name=f"Delete {n}").count() for n in others)
        w.check("delete", role, "no Delete on claims that are not Rejected", f"{btns} Delete buttons", btns == 0)
        w.step(page, "delete", "after", role, user, f"{rej} is gone; the other claims have no Delete.")


# --- after: CEO --------------------------------------------------------------------------------------------------

def ceo() -> None:
    role = "CEO"; user = USERS[role]
    big = state["after"]["big"]
    with session(AFTER, user, PW) as (page, _):
        open_reimbursements(page)
        search(page, f"Walk {state['stamp']}")
        w.step(page, "ceo", "after", role, user, f"The CEO opens on Pending CEO Approval: {big} waits. Approve it.",
               click=row(page, big).get_by_role("button", name=f"Approve {big}"))
        page.wait_for_timeout(1500)
        dlg = page.get_by_role("alertdialog")
        for cb in dlg.locator("[role=checkbox]").all():
            cb.click()
        w.step(page, "ceo", "after", role, user, "Confirm.", click=dlg.get_by_role("button", name=re.compile(r"^Approve")))
        settle(page, 3000)
        st = claim_rows(AFTER, "after_ceo", [big])
        w.check("ceo", role, f"{big}: Approved (Payment need to be paid)",
                f"claim {st[big]['claim']}, expense {st[big]['expense_status']}",
                st[big]["claim"] == "Approved" == st[big]["expense_status"])
        w.step(page, "ceo", "after", role, user, "It has left Pending CEO Approval.")


# --- after: Accounts ---------------------------------------------------------------------------------------------

def acct_pay() -> None:
    role = "Accountant"; user = USERS[role]
    big, mid, octc = state["after"]["big"], state["after"]["mid"], state["after"]["oct"]
    approved = db_json(AFTER, "approved_claims", r'''
rows = frappe.db.sql("""select name, to_char(creation,'YYYY-MM') m from "tabReimbursement" where status='Approved'""", as_dict=1)
print("JSON " + json.dumps({"all": [r.name for r in rows], "nov": [r.name for r in rows if r.m == '2026-11']}))
''')
    with session(AFTER, user, PW) as (page, _):
        open_reimbursements(page)
        t = tab(page, "Payment need to be paid").first
        badge = count_of(t.inner_text())
        listed = page.locator("tbody tr").filter(has_text=re.compile(r"REIMB|RMB|-")).count()
        total = page.get_by_text(re.compile(r"Page \d+ of \d+ \(\d+-\d+ of (\d+)\)")).first.inner_text()
        shown = int(re.search(r"of (\d+)\)", total).group(1))
        w.check("month", role, f"badge = rows the tab shows (all Approved claims: {len(approved['all'])})",
                f"badge {badge}, list {shown} (current month only)", badge == shown, "should")
        oct_listed = row(page, octc).count()
        w.step(page, "month", "after", role, user,
               f"Accounts opens on Payment need to be paid: badge {badge}, but the list shows {shown}. "
               f"{octc} (raised 28 Oct, approved, unpaid) is hidden by the default month.",
               pins=[pin(t, f"Badge {badge}: counts every month.", "info"),
                     pin(page.get_by_text(re.compile(r"raised in")).first,
                         f"Payment need to be paid opens on this month only, but its badge counts every month (badge "
                         f"{badge}, list {shown}). {octc}, raised 28 Oct, approved and unpaid, is "
                         f"{'listed' if oct_listed else 'hidden until Accounts picks All'}. An unpaid claim from last "
                         "month is easy to miss. Fix: the badge counts the month shown, or the tab opens on All.",
                         "should" if badge != shown else "info")])
        w.step(page, "month", "after", role, user, "Open the month picker.",
               click=page.get_by_role("button", name="Pick a month").or_(page.get_by_label("Pick a month")).first)
        page.wait_for_timeout(1200)
        pop = page.locator("[data-radix-popper-content-wrapper]").first
        w.step(page, "month", "after", role, user, "Month tiles with each month's count and total.",
               pins=[pin(pop, re.sub(r"\s+", " ", pop.inner_text())[:200], "info")] if pop.count() else [])
        page.keyboard.press("Escape")
        page.get_by_role("button", name=re.compile(r"^All$")).first.click()
        settle(page, 2000)
        w.check("month", role, f"All months lists {octc} too", "listed" if row(page, octc).count() else "missing",
                row(page, octc).count() > 0)
        search(page, f"Walk {state['stamp']}")
        row(page, big).get_by_role("checkbox").click()
        row(page, mid).get_by_role("checkbox").click()
        page.wait_for_timeout(600)
        bar = page.get_by_role("group", name="Selected claims")
        w.step(page, "pay", "after", role, user, f"Tick {big} and {mid}, then Export for Payment.",
               click=bar.get_by_role("button", name="Export for Payment"))
        page.wait_for_timeout(1500)
        dlg = page.get_by_role("dialog")
        icici = dlg.get_by_text(re.compile(r"ICICI - XXXX\d{4}")).first
        icici_text = icici.inner_text() if icici.count() else ""
        w.check("pay", role, "Export for Payment reads ICICI - XXXX3327", icici_text or "none", "XXXX3327" in icici_text)
        w.step(page, "pay", "after", role, user, "The debit account is the shared ICICI one.",
               pins=[pin(icici if icici.count() else dlg, icici_text or "no ICICI option", "info" if icici_text else "must")])
        page.keyboard.press("Escape")
        page.wait_for_timeout(800)
        w.step(page, "pay", "after", role, user, f"Mark {mid} as Paid.",
               click=row(page, mid).get_by_role("button", name="Mark as Paid"))
        page.wait_for_timeout(1200)
        dlg = page.get_by_role("alertdialog")
        w.step(page, "pay", "after", role, user, "Confirm.", click=dlg.get_by_role("button", name="Mark as Paid"))
        settle(page, 3000)
        st = claim_rows(AFTER, "after_paid", [mid])
        w.check("pay", role, f"{mid}: Reconciliation Pending", f"claim {st[mid]['claim']}, expense {st[mid]['expense_status']}",
                st[mid]["claim"] == "Reconciliation Pending" == st[mid]["expense_status"])
        w.check("status", role, "claim status = expense status after Mark as Paid",
                f"{st[mid]['claim']} / {st[mid]['expense_status']}", st[mid]["claim"] == st[mid]["expense_status"])
        w.step(page, "reconcile", "after", role, user, "Open Reconciliation Pending.",
               click=tab(page, "Reconciliation Pending").first)
        settle(page, 2000)
        search(page, f"Walk {state['stamp']}")
        w.step(page, "reconcile", "after", role, user, f"Mark {mid} Reconciled.",
               click=row(page, mid).get_by_role("button", name="Mark Reconciled"))
        page.wait_for_timeout(1500)
        dlg = page.get_by_role("alertdialog")
        title = dlg.get_by_text("Record Payment & Mark as Paid").first
        w.step(page, "reconcile", "after", role, user,
               "Mark Reconciled opens the Non-Project Expense pay dialog: payment date, UTR (Payment Ref) and proof.",
               pins=[pin(title if title.count() else dlg,
                         "The row button says Mark Reconciled, but the dialog is titled \"Record Payment & Mark as "
                         "Paid\" and its button says Mark as Paid: the claim was already marked Paid one step earlier.",
                         "nit")])


def acct_reconcile() -> None:
    role = "Accountant"; user = USERS[role]
    # The run's own claim, else (a rerun after it was reconciled) any walk claim still in Reconciliation Pending.
    mid = db_json(AFTER, "reconcile_pick", r'''
want = sys.argv[1]
if frappe.db.get_value("Reimbursement", want, "status") != "Reconciliation Pending":
    want = frappe.db.get_value("Reimbursement", {"status": "Reconciliation Pending", "title": ["like", "Walk %"]}, "name")
print("JSON " + json.dumps({"name": want}))
''', state["after"]["mid"])["name"]
    receipt = make_receipt()
    with session(AFTER, user, PW) as (page, _):
        open_reimbursements(page)
        tab(page, "Reconciliation Pending").first.click()
        settle(page, 2000)
        search(page, "Walk")
        row(page, mid).get_by_role("button", name="Mark Reconciled").click()
        page.wait_for_timeout(1500)
        dlg = page.get_by_role("alertdialog")
        # The dialog asks for the receipt first (it tries to read it); the date and ref fields show after.
        dlg.locator("input[type=file]").first.set_input_files(str(receipt))
        dlg.locator("#payment_ref_update_pd").wait_for(timeout=60000)
        page.wait_for_timeout(1000)
        dlg.locator("#payment_ref_update_pd").fill(f"WALKUTR{state['stamp']}")
        if not dlg.locator("#payment_date_update_pd").input_value():
            dlg.locator("#payment_date_update_pd").fill(datetime.date.today().isoformat())
        page.wait_for_timeout(800)
        btn = dlg.get_by_role("button", name="Mark as Paid")
        w.step(page, "reconcile", "after", role, user, "UTR and proof filled; Mark as Paid.", click=btn)
        settle(page, 3500)
        st = claim_rows(AFTER, "after_reconcile", [mid])
        w.check("reconcile", role, f"{mid}: Paid", f"claim {st[mid]['claim']}, expense {st[mid]['expense_status']}, "
                f"paid on {st[mid]['paid_on']}", st[mid]["claim"] == "Paid" == st[mid]["expense_status"])
        w.check("status", role, "claim status = expense status after reconcile",
                f"{st[mid]['claim']} / {st[mid]['expense_status']}", st[mid]["claim"] == st[mid]["expense_status"])
        w.step(page, "reconcile", "after", role, user, "Open Reconciliation Done / Paid.",
               click=tab(page, "Reconciliation Done / Paid").first)
        settle(page, 2000)
        search(page, "Walk")
        r = row(page, mid)
        w.check("reconcile", role, f"{mid} listed on Reconciliation Done / Paid", "listed" if r.count() else "missing",
                r.count() > 0)
        w.step(page, "reconcile", "after", role, user, f"{mid} is on Reconciliation Done / Paid.",
               pins=[pin(r, "Paid.", "info")] if r.count() else [])


# --- after: Action Center ----------------------------------------------------------------------------------------

def action_center() -> None:
    """The Accountant's Dashboard Action Center lists Approved Non-Project Expenses; a claim's one is tagged
    Reimbursement and opens Reimbursements › Payment need to be paid, searched to the claim, on all months."""
    role = "Accountant"; user = USERS[role]
    big = state["after"]["big"]
    with session(AFTER, user, PW) as (page, _):
        settle(page, 2500)
        exp_tab = page.get_by_role("button", name=re.compile(r"^\d+\s*Expenses$")).first
        w.step(page, "action", "after", role, user, "Accountant's Dashboard: Action Center › Expenses.", click=exp_tab)
        settle(page, 1500)
        group = page.get_by_role("button").filter(has=page.get_by_role("heading", name="Non-Project", exact=True)).first
        if group.get_attribute("aria-expanded") != "true":
            group.click()
            page.wait_for_timeout(800)
        item = page.get_by_role("button").filter(has_text=big).first
        tag = item.inner_text() if item.count() else ""
        w.check("action", role, f"{big}'s expense is listed, tagged Reimbursement", re.sub(r"\s+", " ", tag)[:200] or "not listed",
                "reimbursement" in tag.lower())
        w.step(page, "action", "after", role, user, f"The item for {big} is tagged Reimbursement. Open it.", click=item)
        settle(page, 3000)
        url = page.url
        listed = row(page, big).count()
        w.check("action", role, "lands on Reimbursements › Payment need to be paid, searched to the claim, all months",
                url, "/reimbursements" in url and "tab=approved" in url and listed > 0)
        sel = page.get_by_role("tablist", name="Reimbursement tabs").first.get_by_role("tab", selected=True)
        w.step(page, "action", "after", role, user, f"It opens Payment need to be paid with {big} found.",
               pins=[pin(sel.first, "The tab it opened.", "info"),
                     pin(row(page, big) if listed else page.locator("tbody").first,
                         f"{big} {'listed' if listed else 'not listed'}.", "info" if listed else "must")])


# --- patch -------------------------------------------------------------------------------------------------------

def patch_check() -> None:
    log = (Path("/Users/abhishek/work/nirmaan/deploy_setup/frappe_docker/development/benches") / AFTER / "logs"
           / "migrate.log")
    text = log.read_text() if log.exists() else ""
    m = re.search(r"reimbursement_status_from_expense: moved (\d+)", text)
    w.check("patch", "migrate", "the patch ran on migrate", m.group(0) if m else "no line in migrate.log", bool(m), "should")
    res = db_json(AFTER, "patch_dry", r'''
from nirmaan_stack.patches.v3_0 import reimbursement_status_from_expense as p
# A claim the walk left at Approved / Reconciliation Pending / CEO Pending: put it back to the old "Approved" as the
# pre-PR code did, run the patch, read, and roll it all back.
rows = frappe.db.sql("""select r.name, r.status, e.status from "tabReimbursement" r join "tabNon Project Expenses" e
   on e.reimbursement = r.name where e.status in ('Requested','CEO Pending','Reconciliation Pending')""")
names = [r[0] for r in rows]
if names:
    frappe.db.sql('update "tabReimbursement" set status = %s where name in %s', ("Approved", tuple(names)))
p.execute()
after1 = dict(frappe.db.sql('select name, status from "tabReimbursement" where name in %s', (tuple(names) or ("",),)))
again = p.execute()
frappe.db.rollback()
print("JSON " + json.dumps({"rows": rows, "after": after1}))
''')
    ok = res["rows"] and all(res["after"].get(n) == es for n, _, es in res["rows"])
    w.check("patch", "DB (rolled back)", "each Approved claim whose expense is Requested / CEO Pending / Reconciliation "
            "Pending takes that status; a second run moves nothing",
            json.dumps(res), bool(ok))


def race() -> None:
    w.status("race", "not_walked", "Two people pressing Approve at the same moment can't be driven from one screen. "
             "The PR's test_reimbursements has the simultaneous-decision tests; they ran green on this env (see tests).")


PLAN = [("setup", setup_after), ("setup", setup_before), ("tabs", tabs_roles), ("cap", pm_cap), ("hr", hr_decide), ("payments", payments_after),
        ("payments", payments_before), ("l1", admin_l1), ("delete", admin_delete), ("ceo", ceo),
        ("pay", acct_pay), ("reconcile", acct_reconcile), ("action", action_center), ("patch", patch_check),
        ("race", race)]

only = set(sys.argv[2:])
for cid, fn in PLAN:
    if not only or fn.__name__ in only:
        guarded(cid, fn)
race()
for c in w.data["changes"]:
    if c["id"] == "race":
        continue
    bad = [k for k in w.data["checks"] if k["change"] == c["id"] and not k["ok"] and k["kind"] == "must"]
    musts = [p for st in w.data["steps"] if st["change"] == c["id"] for p in st["pins"] if p["kind"] == "must"]
    walked = any(x["change"] == c["id"] for x in w.data["steps"] + w.data["checks"])
    if not walked:
        continue
    w.status(c["id"], "failed" if bad or musts else "seen",
             "; ".join(f"{k['role']}: expected {k['expect']}, saw {k['seen']}" for k in bad))
print(w.save())
print(json.dumps(w.data.get("errors", []), indent=1))
