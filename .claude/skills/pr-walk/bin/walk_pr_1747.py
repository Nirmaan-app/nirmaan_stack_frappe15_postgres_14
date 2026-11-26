"""Walk PR #1747 (eight small fixes found in the #1736 / #1737 / #1738 walks) on its env and its base env.

    python3 -I walk_pr_1747.py <out dir> setup              # both envs: raise one GST request, read facts (DB only)
    python3 -I walk_pr_1747.py <out dir> before|after       # the served env's side (serve it first, one at a time)
    python3 -I walk_pr_1747.py <out dir> finish             # roll each change up from its checks and pins

Run from the pr-1747 worktree root (drive.py finds the bench from the current folder). Each side appends to the same
walk.json, so the base side runs first, its env is stopped, then the head side runs. Records are picked by query:
a Pending GST request raised by `setup` (a new one whenever none is Pending), the newest paid Project Expense of
FY 26-27 for the Audit View search, the vendor with the most cheques, the Reconciliation Pending expenses and claims.
`setup` also moves one Approved claim's raised date to last month on each env, the same claim on both, so the
Reimbursements month bar has two months to switch between.

Where Playwright is installed only in the user's site-packages, run with plain `python3` (`-I` hides user
site-packages). The second run (walk2) served the head with one uncommitted fix to GstRequestsTab.tsx, copied into the
pr-1747 worktree; gst_width there reads every column of GST Requests › All and › Approved for words broken across lines.
walk3 is walk2 with only the head's gst_fit rerun (`after gst_fit`), after a second fix narrowed Vendor 190→140px so the
table fits 1440px again; its other head screens are walk2's, taken with Vendor at 190px.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "verify" / "bin"))
sys.path.insert(0, str(HERE))
import os  # noqa: E402

DEVENV = "/Users/nirmaan001/nirmaan/frappe_docker/development/frappe-bench/apps/nirmaan_stack/scripts/devenv/devenv.sh"
AFTER, BEFORE = "pr-1747", "pr-1747-base"
PW = "WalkPw-1747"
PRESET = "FY 26-27"

out = Path(sys.argv[1]).expanduser()
out.mkdir(parents=True, exist_ok=True)
os.environ["VERIFY_OUT"] = str(out / "drive")
MODE = sys.argv[2] if len(sys.argv) > 2 else ""
ONLY = set(sys.argv[3:])

from drive import session, sidebar  # noqa: E402
from feature_walk import PRELUDE  # noqa: E402
from record import Walk, inr, pin  # noqa: E402

STATE = out / "state.json"
state: dict = json.loads(STATE.read_text()) if STATE.exists() else {}


def keep() -> None:
    STATE.write_text(json.dumps(state, indent=1, default=str))


w = Walk(out, pr={"number": 1747, "title": "Fixes/24 11",
                  "url": "https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/pull/1747",
                  "author": "madhubalan17js", "head": "52f34a5c1", "base": "91bb9c3dd"},
         envs={"after": AFTER, "before": BEFORE},
         data_note="head = the PR head 52f34a5c1 plus uncommitted fixes in GstRequestsTab.tsx found by walking this PR: "
                   "the Work Order ID and the payment ID under Status kept on one line (Work Order 140→160px, Status "
                   "100→120px), then Vendor 190→140px so the table fits a 1440px window again. The last GST Requests › "
                   "All fit screens (head) were re-shot with all three; the other head screens have Vendor at 190px. Data: a test copy of the production backup in template nirmaan_tpl (built "
                   "2026-11-19), plus one GST "
                   "request the walk raised and one approved claim moved to last month, on each env")
if (out / "walk.json").exists():
    old = json.loads((out / "walk.json").read_text())
    w.data["steps"], w.data["checks"] = old["steps"], old["checks"]
    w.data["errors"] = old.get("errors", [])

w.change("bell", "GST Payment Approved bell: shorter text",
         "The \"GST Payment Approved\" bell drops its last sentence, \"Ready to pay: no L1 or CEO.\" It now reads "
         "\"GST payment <name> approved by <user> from GPR-….\" Who gets it is unchanged: every Admin, the CEO included.")
w.change("gst_width", "GST Requests › Reviewed column keeps its width",
         "GST Requests: the Reviewed column keeps its width when you switch pills (Pending → All → Approved). Names no "
         "longer break mid-word. (Walked with the follow-up fix: the Work Order ID and the payment ID under Status "
         "also stay on one line.)")
w.change("audit_card", "Audit View › Non Project card named by its tab",
         "Audit View, Non Project View: the expense-type card is headed by its tab name (\"Invoices\" / \"Payments\") "
         "instead of \"Top expense types\".")
w.change("audit_keep", "Audit View keeps its Report Type",
         "Audit View keeps its Report Type when you leave the tab and come back. Before, Non Project View → Vendors → "
         "Audit View opened Projects Data's Invoices with steps 1 and 2 already done.")
w.change("audit_search", "Audit View › search by an expense's record name",
         "Audit View search finds an expense by its record name again (contains, any case), next to the shared fuzzy "
         "search, whose results can only grow.")
w.change("cheque_width", "Cheque/Payment Date sort arrow inside its cell",
         "Cheque Tracker and the vendor Cheques tab: the Cheque/Payment Date column is 185px (was 160px), so its sort "
         "arrow stays inside its cell and no longer reaches Issue Date's filter.")
w.change("reimb_badge", "Reimbursements › open tab's badge follows its list",
         "The open tab's badge follows its month, column filters and search. Closed tabs keep the server's all-months "
         "count (accepted).")
w.change("pay_dialog", "Expense pay dialog says Mark as Reconciled",
         "The Project / Non-Project Expense pay dialog is titled \"Record Payment & Mark as Reconciled\", with a "
         "\"Mark as Reconciled\" button. The WO dialog (Fulfil Payment) is unchanged.")
w.change("docs", "Domain docs",
         "expenses.md: the expense list pages are not in use; reimbursements.md: the open-tab-only badge rule is "
         "accepted.")


# ---------------------------------------------------------------- helpers
def db(task: str, name: str, code: str, *args: str) -> dict:
    """Run a snippet on the env DB (feature_walk's PRELUDE first); it must emit() one JSON line. Kept under db/."""
    src = out / "db" / f"{task}-{name}.py"
    src.parent.mkdir(exist_ok=True)
    src.write_text(PRELUDE + code)
    res = subprocess.run([DEVENV, "script", task, str(src), *args], capture_output=True, text=True, timeout=600)
    (out / "db" / f"{task}-{name}.txt").write_text(res.stdout + res.stderr)
    line = next((ln for ln in res.stdout.splitlines() if ln.startswith("JSON ")), None)
    if line is None:
        raise RuntimeError(f"db {name} on {task}: no JSON line; see db/{task}-{name}.txt")
    return json.loads(line[5:])


def settle(page, ms: int = 1500) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def sidebar_ready(page) -> None:
    menu = page.locator('[data-sidebar="menu-button"]')
    menu.get_by_text("Dashboard", exact=True).wait_for(timeout=30_000)
    last = -1
    for _ in range(40):
        n = menu.count()
        if n == last and n > 3:
            return
        last = n
        page.wait_for_timeout(750)


def table_total(page) -> int | None:
    m = re.search(r"Page \d+ of \d+ \(\d+-\d+ of (\d+)\)", page.locator("body").inner_text())
    if m:
        return int(m.group(1))
    if re.search(r"No results|No data|No records", page.locator("body").inner_text(), re.I):
        return 0
    return None


def guarded(cid: str, fn, *args) -> None:
    w.data["errors"] = [e for e in w.data.get("errors", [])
                        if not (e["fn"] == fn.__name__ and e["args"] == [str(a) for a in args])]
    steps, checks = len(w.data["steps"]), len(w.data["checks"])
    try:
        fn(*args)
    except Exception as e:
        traceback.print_exc()
        del w.data["steps"][steps:], w.data["checks"][checks:]
        w.data.setdefault("errors", []).append({"fn": fn.__name__, "args": [str(a) for a in args], "change": cid,
                                               "error": f"{type(e).__name__}: {str(e).splitlines()[0][:200]}"})
    w.save()


# ---------------------------------------------------------------- setup (DB only, both envs)
SETUP = r'''
from nirmaan_stack.services.order_payments import work_order_summary
from nirmaan_stack.services.work_order_lifecycle import payment_request_problem
from nirmaan_stack.api.payments.gst_payment_requests import request_gst_payment
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from frappe.utils import add_months, nowdate
q = lambda s, *a: frappe.db.sql(s, a, as_dict=True)

# A Pending GST request to approve on screen: the newest Pending one, else raise one (₹1,000) on the Approved Work
# Order with the most GST left whose invoice check passes, as Administrator (setup, not a claim of the PR).
pend = q("""select name, work_order, amount from "tabGST Payment Request" where status='Pending' order by creation desc limit 1""")
if not pend:
    best = ("", 0.0)
    for name in frappe.get_all("Service Requests", filters={"status": "Approved"}, pluck="name"):
        sr = frappe.get_doc("Service Requests", name)
        if payment_request_problem(sr.name, sr.status):
            continue
        lim = work_order_summary(sr)["limit"]
        if lim["invoice_check"]["passes"] and lim["gst_left"] > best[1]:
            best = (name, lim["gst_left"])
    if best[1] < 1000:
        raise SystemExit("no Work Order with ₹1,000 GST left")
    frappe.set_user("Administrator")
    request_gst_payment(best[0], 1000)
    frappe.db.commit()
    pend = q("""select name, work_order, amount from "tabGST Payment Request" where status='Pending' order by creation desc limit 1""")

# One Approved claim raised last month (the same claim on both envs: the oldest-named Approved claim).
this_m = nowdate()[:7]
last_m = add_months(nowdate(), -1)[:7]
appr = q("""select name, title, to_char(creation,'YYYY-MM') m from "tabReimbursement" where status='Approved' order by name""")
if appr and not any(r.m == last_m for r in appr):
    frappe.db.sql("""update "tabReimbursement" set creation = %s where name = %s""", (f"{last_m}-15 11:00:00", appr[0].name))
    frappe.db.commit()
appr = q("""select name, title, to_char(creation,'YYYY-MM') m from "tabReimbursement" where status='Approved' order by name""")

exp = q("""select name, description from "tabProject Expenses" where payment_date between '2026-04-01' and '2027-03-31'
           and status='Paid' and coalesce(description,'') != '' order by payment_date desc, name limit 1""")
cheq = q("""select vendor, count(*) n from "tabCheques" where coalesce(vendor,'')!='' group by vendor order by n desc, vendor limit 1""")
admins = [u for u in candidates("Nirmaan Admin Profile")]
emit({
    "gpr": pend[0],
    "reimb": {"this_month": this_m, "last_month": last_m, "approved": appr},
    "expense": exp[0] if exp else None,
    "vendor": cheq[0].vendor, "vendor_name": frappe.db.get_value("Vendors", cheq[0].vendor, "vendor_name"),
    "ceo": CEO_AUTHORIZED_USER,
    "admin_profile_users": admins,
    "users": {"Admin": [u for u in admins if u != CEO_AUTHORIZED_USER],
              "Accountant": candidates("Nirmaan Accountant Profile"),
              "Accountant Lead": candidates("Nirmaan Accountant Lead Profile")},
    "recon": {
        "pe": [r.name for r in q("""select name from "tabProject Expenses" where status='Reconciliation Pending' order by modified desc limit 3""")],
        "npe": [r.name for r in q("""select name from "tabNon Project Expenses" where status='Reconciliation Pending' and coalesce(reimbursement,'')='' order by modified desc limit 3""")],
        "pp": [r.name for r in q("""select name from "tabProject Payments" where status='Reconciliation Pending' order by modified desc limit 3""")],
        "claims": [r.name for r in q("""select name from "tabReimbursement" where status='Reconciliation Pending' order by name""")],
    },
})
'''


def setup() -> None:
    for task in (BEFORE, AFTER):
        state[task] = db(task, "setup", SETUP)
        keep()
        print(task, json.dumps(state[task], default=str)[:1500])



USERS = {"Admin": "admins@nirmaan.app", "Accountant": "swathi@nirmaan.app", "Accountant Lead": "deepa@nirmaan.app",
         "CEO": "nitesh@nirmaan.app"}
OLD_LINE = "Ready to pay: no L1 or CEO."


def task_of(side: str) -> str:
    return AFTER if side == "after" else BEFORE


def open_payments(page) -> None:
    sidebar_ready(page)
    sidebar(page, "Project Payment & Expense")
    settle(page, 2500)


def gst_tab(page):
    return page.get_by_role("button", name=re.compile(r"^GST Requests \d+$"))


def pill(page, name: str):
    return page.get_by_role("tablist", name="GST requests by status").get_by_role("tab", name=name, exact=True)




import contextlib  # noqa: E402


@contextlib.contextmanager
def _nothing():
    yield None, None


# Every column's words that break across two lines, by header.
BROKEN_ALL = """() => {
  const ths = [...document.querySelectorAll('thead th')];
  const out = {};
  ths.forEach((th, i) => {
    const head = th.innerText.trim() || ('#' + i); const words = new Set();
    for (const tr of document.querySelectorAll('tbody tr')) {
      const td = tr.querySelectorAll('td')[i]; if (!td) continue;
      const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT); let n;
      while ((n = walker.nextNode())) {
        const re = /\\S+/g; let m;
        while ((m = re.exec(n.textContent))) {
          const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
          if (new Set([...r.getClientRects()].map(b => Math.round(b.top))).size > 1) words.add(m[0]);
        }
      }
    }
    out[head] = {width: Math.round(th.getBoundingClientRect().width), broken: [...words]};
  });
  return out;
}"""


# ---------------------------------------------------------------- bell + GST Requests widths
def gst(side: str) -> None:
    task = task_of(side)
    f = state[task]
    gpr = f["gpr"]["name"]
    role, user = "Accountant", USERS["Accountant"]
    pending = db(task, f"gpr-status-{side}", 'emit(frappe.db.get_value("GST Payment Request", sys.argv[1], "status"))', gpr)
    if pending != "Pending":
        print(f"{gpr} is {pending}: the approve steps ran in an earlier try; reading its bell")
    with session(task, user, PW) if pending == "Pending" else _nothing() as (page, _):
      if page is not None:
        open_payments(page)
        w.step(page, "bell", side, role, user, "Project Payment & Expense as the Accountant. Open GST Requests.",
               click=gst_tab(page))
        settle(page, 2500)
        w.step(page, "bell", side, role, user, f"The Pending request {gpr} (₹1,000 GST, raised for the walk). Approve it.",
               click=page.get_by_role("button", name=f"Approve {gpr}"))
        settle(page, 1200)
        dlg = page.get_by_role("alertdialog")
        w.step(page, "bell", side, role, user, "Confirm the approval.",
               click=dlg.get_by_role("button", name=re.compile(r"^Approve ₹")))
        settle(page, 3500)
    bell = db(task, f"bell-{side}", r'''
gpr = sys.argv[1]
pay = frappe.db.get_value("GST Payment Request", gpr, ["status", "project_payment"], as_dict=True)
notes = frappe.get_all("Nirmaan Notifications", filters={"docname": pay.project_payment or "-"},
                       fields=["recipient", "title", "description"], order_by="recipient")
emit({"req": pay, "status": frappe.db.get_value("Project Payments", pay.project_payment, "status"), "notes": notes})
''', gpr)
    state[task]["bell"] = bell
    keep()
    notes = [n for n in bell["notes"] if n["title"] == "GST Payment Approved"]
    texts = sorted({n["description"] for n in notes})
    recips = sorted(n["recipient"] for n in notes)
    want = sorted(f["admin_profile_users"])
    w.check("bell", "DB", f"{gpr} approved; its payment {bell['req']['project_payment']} is Approved",
            f"request {bell['req']['status']}, payment {bell['status']}", bell["status"] == "Approved")
    if side == "after":
        w.check("bell", "Admins", f"the bell text no longer says \"{OLD_LINE}\"", " / ".join(texts) or "no note",
                bool(texts) and all(OLD_LINE not in t and "no L1" not in t for t in texts))
        w.check("bell", "Admins", "the text is \"GST payment <name> approved by <user> from GPR-….\" and fits 140 "
                "characters", " / ".join(f"{len(t)} chars" for t in texts) or "no note",
                bool(texts) and all(re.fullmatch(rf"GST payment {re.escape(bell['req']['project_payment'])} approved by "
                                                 rf".+ from {re.escape(gpr)}\.", t) and len(t) <= 140 for t in texts))
        before = state.get(BEFORE, {}).get("bell", {})
        b_recips = sorted(n["recipient"] for n in before.get("notes", []) if n["title"] == "GST Payment Approved")
        w.check("bell", "Admins", f"the same people get it as before ({len(b_recips)} on the base env: every Admin, the "
                "CEO included)", f"{len(recips)}: {', '.join(recips)}", recips == b_recips == want)
    else:
        w.check("bell", "Admins", f"(before) the bell ends \"{OLD_LINE}\"", " / ".join(texts) or "no note",
                bool(texts) and all(t.endswith(OLD_LINE) for t in texts), kind="info")
        w.check("bell", "Admins", "(before) every Admin-profile user gets it", f"{len(recips)}: {', '.join(recips)}",
                recips == want, kind="info")

    role, user = "Admin", USERS["Admin"]
    pay_name = bell["req"]["project_payment"]
    with session(task, user, PW) as (page, _):
        sidebar_ready(page)
        w.step(page, "bell", side, role, user, "As an Admin, open the Notifications bell.",
               click=page.locator('[data-sidebar="menu-button"]').get_by_text("Notifications", exact=True))
        settle(page, 3000)
        note = page.get_by_text(re.compile(rf"GST payment {re.escape(pay_name)} approved by")).first
        seen = note.inner_text().strip() if note.count() else ""
        w.check("bell", role, "the note shows in the Admin's Notifications" + (" without the old line" if side == "after"
                else ""), seen or "not found",
                bool(seen) and (OLD_LINE not in seen if side == "after" else True), kind="must" if side == "after" else "info")
        w.step(page, "bell", side, role, user, f"The GST Payment Approved note for {pay_name}.",
               pins=[pin(note, f"\"{seen}\"" + ("" if side == "after" else f" Ends \"{OLD_LINE}\"."), "info")]
               if seen else [pin(page.locator("main"), "The note is not listed.", "must" if side == "after" else "info")])

        page.keyboard.press("Escape")
        settle(page, 800)

        # GST Requests widths: Pending (Actions shown, no Reviewed) → All → Approved.
        open_payments(page)
        w.step(page, "gst_width", side, role, user, "Admin: Project Payment & Expense › GST Requests.", click=gst_tab(page))
        settle(page, 2500)
        heads = [h.strip() for h in page.locator("thead th").all_inner_texts()]
        w.step(page, "gst_width", side, role, user, f"Pending opens first: columns {', '.join(h for h in heads if h)}. "
               "Open All.", click=pill(page, "All"))
        settle(page, 2500)
        for name, nxt in (("All", "Approved"), ("Approved", None)):
            cols = page.evaluate(BROKEN_ALL)
            heads = list(cols)
            if "Reviewed" not in cols:
                w.check("gst_width", role, f"{name}: a Reviewed column", "none", False)
                continue
            state.setdefault("gst_width", {})[f"{side}-{name}"] = cols
            keep()
            widths = ", ".join(f"{h} {c['width']}px" for h, c in cols.items())
            rows = page.locator("tbody tr")

            def cell_of(head: str):
                b = cols[head]["broken"]
                return (rows.filter(has_text=b[0]) if b else rows).first.locator("td").nth(heads.index(head))

            # Reviewed: its own 155px (wider when the table stretches, as on Approved), no name broken.
            rv = cols["Reviewed"]
            ok_rv = rv["width"] >= 153 and not rv["broken"]
            seen_rv = f"Reviewed {rv['width']}px; broken: {', '.join(rv['broken']) or 'none'} (columns: {widths})"
            # Work Order and the payment id under Status: one line each.
            wo, st = cols.get("Work Order", {"width": 0, "broken": []}), cols.get("Status", {"width": 0, "broken": []})
            ok_ids = not wo["broken"] and not st["broken"]
            seen_ids = (f"Work Order {wo['width']}px, broken: {', '.join(wo['broken'][:3]) or 'none'}; Status "
                        f"{st['width']}px, broken: {', '.join(st['broken'][:3]) or 'none'}")
            if side == "after":
                w.check("gst_width", role, f"Pending → {name} (1440px window): Reviewed is at least its own 155px and no "
                        "name breaks mid-word", seen_rv, ok_rv)
                w.check("gst_width", role, f"Pending → {name} (1440px window): each Work Order ID and each payment ID "
                        "under Status sits on one line", seen_ids, ok_ids)
            else:
                w.check("gst_width", role, f"(before) Pending → {name}: Reviewed width and broken names", seen_rv, True,
                        kind="info")
                w.check("gst_width", role, f"(before) Pending → {name}: Work Order and Status IDs", seen_ids, True,
                        kind="info")
            bad = "info" if side == "before" else "must"
            pins = [pin(page.locator("thead th").nth(heads.index("Reviewed")), f"Reviewed: {rv['width']}px wide.",
                        "info" if ok_rv or side == "before" else "must"),
                    pin(cell_of("Reviewed"), (f"Names broken mid-word: {', '.join(rv['broken'][:4])}." if rv["broken"]
                                              else "Each name on whole words."), "info" if not rv["broken"] else bad)]
            for head, what in (("Work Order", "Work Order ID"), ("Status", "payment ID")):
                if head not in cols:
                    continue
                b = cols[head]["broken"]
                pins.append(pin(cell_of(head), (f"{head} ({cols[head]['width']}px): the {what} \"{b[0]}\" breaks across "
                                                "two lines." if b else f"{head} ({cols[head]['width']}px): the {what} on "
                                                "one line."), "info" if not b else bad))
            w.step(page, "gst_width", side, role, user,
                   f"Pending → {name}: Reviewed {rv['width']}px, Work Order {wo['width']}px, Status {st['width']}px."
                   + (f" Open {nxt}." if nxt else ""), click=pill(page, nxt) if nxt else None, pins=pins)
            settle(page, 2500)


# The table's scroll box: how much of the table is hidden sideways, and where the last header ends.
FIT = """() => {
  const t = document.querySelector('table'); if (!t) return null;
  let el = t.parentElement;
  while (el && getComputedStyle(el).overflowX === 'visible') el = el.parentElement;
  const box = (el || t).getBoundingClientRect(); const ths = [...t.querySelectorAll('thead th')];
  const last = ths[ths.length - 1];
  return {hidden: el ? el.scrollWidth - el.clientWidth : 0, boxRight: Math.round(box.right),
          lastHead: last ? last.innerText.trim() : '', lastRight: last ? Math.round(last.getBoundingClientRect().right) : 0,
          lastBox: last ? (() => { const r = last.getBoundingClientRect(); const x1 = Math.min(r.right, box.right);
            return {x: Math.round(r.left), y: Math.round(r.top), w: Math.round(x1 - r.left), h: Math.round(r.height)}; })() : null};
}"""


def gst_fit(side: str) -> None:
    """GST Requests › All at 1440px: does the whole table fit, or is its last column (Actions) cut off and reached only
    by scrolling the table sideways? Added after walk2's head screenshot showed "Actio" cut at the right edge."""
    task = task_of(side)
    role, user = "Admin", USERS["Admin"]
    # A rerun replaces this side's earlier gst_fit steps when they are the walk's last ones (ids stay in order).
    mine = [i for i, st in enumerate(w.data["steps"]) if st["side"] == side and st["change"] == "gst_width"
            and st["caption"].startswith(("GST Requests on Pending. Open All, to see", "Pending → All, the right edge"))]
    if mine and mine == list(range(len(w.data["steps"]) - len(mine), len(w.data["steps"]))):
        del w.data["steps"][mine[0]:]
        tag = "(before) All at 1440px" if side == "before" else "All at 1440px"
        w.data["checks"] = [c for c in w.data["checks"] if not c["expect"].startswith(tag)]
    with session(task, user, PW) as (page, _):
        open_payments(page)
        gst_tab(page).click()
        settle(page, 2500)
        w.step(page, "gst_width", side, role, user, "GST Requests on Pending. Open All, to see whether the whole table "
               "fits the 1440px window.", click=pill(page, "All"))
        settle(page, 2500)
        f = page.evaluate(FIT)
        state.setdefault("gst_fit", {})[side] = f
        keep()
        cut = f["hidden"] > 0
        seen = (f"{f['hidden']}px of the table hidden sideways; the last column ({f['lastHead']}) ends at "
                f"{f['lastRight']}px, the table's box at {f['boxRight']}px")
        if side == "after":
            w.check("gst_width", role, "All at 1440px: the whole table fits, no column cut off", seen, not cut, kind="nit")
        else:
            w.check("gst_width", role, "(before) All at 1440px: does the table fit?", seen, True, kind="info")
        # The pin is the header's box as it shows now, clipped to the table: a locator would scroll the table
        # sideways to show the whole header and hide the cut the step is about.
        last = f["lastBox"]
        w.step(page, "gst_width", side, role, user, f"Pending → All, the right edge: {seen}.",
               pins=[pin(last, (f"{f['lastHead']} is cut off: {f['hidden']}px of the table sits past the right edge. On "
                                "All, a Pending or Rejected row's Approve / Reject buttons are reached only by scrolling "
                                "the table sideways." if cut else f"{f['lastHead']} fits inside the table's box."),
                         ("nit" if side == "after" else "info") if cut else "info")])


# ---------------------------------------------------------------- Audit View
def report_type(page):
    return page.locator("main").get_by_role("combobox").first


def date_box(page):
    return page.locator("button").filter(has_text=re.compile(r"^(Pick a date range|ALL|FY \d\d-\d\d|.*\d{4}.*)$")).first


def open_tab(page) -> str | None:
    sel = page.locator('[role="tab"][aria-selected="true"]')
    return sel.first.inner_text().split("\n")[0].strip() if sel.count() else None


def pick_range(page, preset: str) -> None:
    date_box(page).click()
    settle(page, 600)
    page.get_by_role("button", name=preset, exact=True).click()
    settle(page, 800)
    page.keyboard.press("Escape")
    settle(page, 3000)


def card_label(page):
    """The non-project type card's heading inside the open tab's panel."""
    return page.locator('[role="tabpanel"]').get_by_text(re.compile(r"^(Top expense types|Invoices|Payments|Orders)$")).first


def audit(side: str) -> None:
    task = task_of(side)
    role, user = "Admin", USERS["Admin"]
    exp = state[task]["expense"]
    with session(task, user, PW) as (page, _):
        sidebar_ready(page)
        w.step(page, "audit_card", side, role, user, "Open Reports from the sidebar.",
               click=page.locator('[data-sidebar="menu-button"]').get_by_text("Reports", exact=True))
        settle(page, 2000)
        w.step(page, "audit_card", side, role, user, "Open the Audit View tab.",
               click=page.get_by_role("button", name="Audit View", exact=True))
        settle(page, 2000)
        w.step(page, "audit_card", side, role, user, "Report Type: switch to Non Projects Data.", click=report_type(page))
        page.get_by_role("option", name="Non Projects Data", exact=True).click()
        settle(page, 2000)
        pick_range(page, PRESET)
        for t in ("Invoices", "Payments"):
            page.get_by_role("tab", name=re.compile(rf"^{t}")).first.click()
            settle(page, 3000)
            lab = card_label(page)
            txt = lab.inner_text().strip() if lab.count() else ""
            if side == "after":
                # The heading is upper-cased by CSS, so inner_text reads "INVOICES".
                w.check("audit_card", role, f"Non Projects Data › {t}: the type card is headed \"{t}\" (shown in "
                        "capitals)", txt or "no card", txt.lower() == t.lower())
            else:
                w.check("audit_card", role, f"(before) Non Projects Data › {t}: the card's heading", txt or "no card",
                        True, kind="info")
            w.step(page, "audit_card", side, role, user, f"Non Projects Data, {PRESET}, {t}: the expense-type card.",
                   pins=[pin(lab, f"Headed \"{txt}\".", "info" if (txt.lower() == t.lower() or side == "before") else "must")]
                   if txt else [pin(page.locator('[role="tabpanel"]').first, "No type card found.", "must")])

        # Keep the Report Type: Non Projects Data, Payments open → Vendors → back to Audit View.
        w.step(page, "audit_keep", side, role, user, f"Non Projects Data, {PRESET}, Payments open. Open the Vendors "
               "report tab.", click=page.get_by_role("button", name="Vendors", exact=True).first)
        settle(page, 2500)
        w.step(page, "audit_keep", side, role, user, "Come back to Audit View.",
               click=page.get_by_role("button", name="Audit View", exact=True))
        settle(page, 3500)
        rt, box, tab = report_type(page).inner_text().strip(), date_box(page).inner_text().strip(), open_tab(page)
        state.setdefault("audit_keep", {})[side] = [rt, box, tab]
        keep()
        if side == "after":
            w.check("audit_keep", role, "Report Type is still Non Projects Data", f"{rt}; date box {box}; tab {tab or 'none'}",
                    rt == "Non Projects Data")
        else:
            w.check("audit_keep", role, "(before) what Audit View reopens on", f"{rt}; date box {box}; tab {tab or 'none'}",
                    True, kind="info")
        lost = rt != "Non Projects Data"
        w.step(page, "audit_keep", side, role, user, f"Back on Audit View: Report Type {rt}, date box \"{box}\", "
               f"{tab or 'no tab'} open.",
               pins=[pin(report_type(page), f"Report Type: {rt}." + (" The Non Projects Data pick was lost." if lost else ""),
                         ("must" if side == "after" else "info") if lost else "info"),
                     pin(date_box(page), f"Date box: {box}.", "info")])

        # Search by record name: Projects Data, FY, Payments.
        if not exp:
            return
        report_type(page).click()
        page.get_by_role("option", name="Projects Data", exact=True).click()
        settle(page, 2000)
        if date_box(page).inner_text().strip() != PRESET:
            pick_range(page, PRESET)
        page.get_by_role("tab", name=re.compile(r"^Payments")).first.click()
        settle(page, 3000)
        search = page.get_by_placeholder(re.compile(r"^Search by", re.I)).first
        results = {}
        for label, term in (("record name", exp["name"]), ("part of it, in capitals", exp["name"][:7].upper()),
                            ("a word of its description (fuzzy search)", exp["description"].split()[0])):
            search.fill(term)
            settle(page, 2000)
            n = table_total(page)
            if n is None:
                n = page.locator("tbody tr").filter(has_text=re.compile("₹")).count()
            hit = page.locator("tbody tr").filter(has_text=exp["description"][:30]).first
            results[label] = n
            if label != "a word of its description (fuzzy search)":
                found = hit.count() > 0
                if side == "after":
                    w.check("audit_search", role, f"searching its {label} \"{term}\" finds expense {exp['name']}",
                            f"{n} rows; {'its row listed' if found else 'its row not listed'}", found)
                else:
                    w.check("audit_search", role, f"(before) searching its {label} \"{term}\"", f"{n} rows", True, kind="info")
                w.step(page, "audit_search", side, role, user,
                       f"Projects Data, {PRESET}, Payments: search \"{term}\" ({label} of {exp['name']}): {n} rows.",
                       pins=[pin(hit, f"{exp['name']}: its Against shows the description, not the name.", "info")]
                       if found else [pin(search, f"{n} rows: the expense is not found by its {label}.",
                                          "must" if side == "after" else "info")])
            else:
                state.setdefault("audit_fuzzy", {})[side] = [term, n]
                keep()
                if side == "after":
                    b = state.get("audit_fuzzy", {}).get("before")
                    w.check("audit_search", role, f"the fuzzy search \"{term}\" finds at least as many rows as before"
                            + (f" ({b[1]})" if b else ""), f"{n} rows", b is not None and n >= b[1])
                w.step(page, "audit_search", side, role, user, f"The shared fuzzy search still works: \"{term}\" finds "
                       f"{n} rows.", pins=[pin(search, f"\"{term}\": {n} rows.", "info")])
        search.fill("")
        settle(page)


# ---------------------------------------------------------------- Cheque/Payment Date width
MEASURE = """th => { const r = th.getBoundingClientRect(); const btn = th.querySelector('button');
  const next = th.nextElementSibling; const icon = next ? next.querySelector('svg') : null;
  const arrows = btn ? [...btn.querySelectorAll('svg')] : [];
  const arrowRight = arrows.length ? Math.max(...arrows.map(a => a.getBoundingClientRect().right)) : null;
  return {cell: Math.round(r.right), width: Math.round(r.width),
          button: btn ? Math.round(btn.getBoundingClientRect().right) : null,
          arrow: arrowRight === null ? null : Math.round(arrowRight),
          nextIcon: icon ? Math.round(icon.getBoundingClientRect().left) : null}; }"""


def cheque_measure(page, side: str, where: str, role: str, user: str) -> None:
    hdr = page.locator("thead th").filter(has_text=re.compile(r"Cheque.Payment Date")).first
    hdr.scroll_into_view_if_needed()
    m = hdr.evaluate(MEASURE)
    state.setdefault("cheque", {})[f"{side}-{where}"] = m
    keep()
    end = m["arrow"] if m["arrow"] is not None else (m["button"] or m["cell"])
    inside = end <= m["cell"]
    clear = m["nextIcon"] is None or end <= m["nextIcon"]
    if side == "after":
        w.check("cheque_width", role, f"{where}: Cheque/Payment Date is 185px", f"{m['width']}px", abs(m["width"] - 185) <= 1)
        w.check("cheque_width", role, f"{where}: its sort arrow ends inside its cell, clear of Issue Date's filter",
                f"arrow ends {end - m['cell']:+d}px from the cell's edge; Issue Date's filter icon "
                f"{'at ' + str(m['nextIcon'] - end) + 'px past it' if m['nextIcon'] is not None else 'not found'}",
                inside and clear)
    else:
        w.check("cheque_width", role, f"(before) {where}: Cheque/Payment Date width and arrow",
                f"{m['width']}px; arrow ends {end - m['cell']:+d}px from the cell's edge", True, kind="info")
    w.step(page, "cheque_width", side, role, user,
           f"{where}: the Cheque/Payment Date header is {m['width']}px; its sort arrow ends {abs(end - m['cell'])}px "
           f"{'inside' if inside else 'past'} its right edge.",
           pins=[pin(hdr, f"{m['width']}px. Arrow {'inside' if inside else 'over the edge'}.",
                     "info" if inside or side == "before" else "must")])


def cheques(side: str) -> None:
    task = task_of(side)
    f = state[task]
    role, user = "Admin", USERS["Admin"]
    with session(task, user, PW) as (page, _):
        sidebar_ready(page)
        w.step(page, "cheque_width", side, role, user, "Open Cheque Tracker from the sidebar.",
               click=page.locator('[data-sidebar="menu-button"]').get_by_text("Cheque Tracker", exact=True))
        settle(page, 3000)
        cheque_measure(page, side, "Cheque Tracker", role, user)
        menu = page.locator('[data-sidebar="menu-button"]')
        sub = page.locator('[data-sidebar="menu-sub-button"]').get_by_text("Vendors", exact=True)
        if not sub.first.is_visible():
            menu.get_by_text("Admin Options", exact=True).click()
            settle(page, 600)
        w.step(page, "cheque_width", side, role, user, "Open Vendors under Admin Options.", click=sub)
        settle(page, 2000)
        page.get_by_placeholder("Search by name...").first.fill(f["vendor_name"])
        settle(page, 2000)
        w.step(page, "cheque_width", side, role, user, f"Find {f['vendor_name']} (the vendor with the most cheques) and "
               "open it.", click=page.locator(f'tbody a[href$="/vendors/{f["vendor"]}"]'))
        page.get_by_role("button", name="Overview", exact=True).first.wait_for(timeout=30_000)
        settle(page, 2000)
        w.step(page, "cheque_width", side, role, user, "Open its Cheques tab.",
               click=page.get_by_role("button", name="Cheques", exact=True))
        settle(page, 3000)
        cheque_measure(page, side, "Vendor › Cheques", role, user)


# ---------------------------------------------------------------- Reimbursements badge
def r_tab(page, label: str):
    words = r"\s*".join(re.escape(p).replace("/", ".") for p in label.split())
    return page.get_by_role("tab", name=re.compile(rf"^{words}(\s*\d+)?$")).first


def badge(page, label: str) -> int | None:
    m = re.search(r"(\d+)\s*$", r_tab(page, label).inner_text().strip())
    return int(m.group(1)) if m else None


def reimb(side: str) -> None:
    task = task_of(side)
    f = state[task]
    role, user = "Accountant", USERS["Accountant"]
    T = "Payment need to be paid"
    with session(task, user, PW) as (page, _):
        sidebar_ready(page)
        w.step(page, "reimb_badge", side, role, user, "Open Reimbursements from the sidebar.",
               click=page.locator('[data-sidebar="menu-button"]').get_by_text("Reimbursements", exact=True))
        settle(page, 3000)
        all0 = badge(page, "All")

        def look(what: str, click=None, nxt: str = "") -> None:
            b, n = badge(page, T), table_total(page)
            if n is None:
                n = page.locator("tbody tr").filter(has_text=re.compile("₹")).count()
            state.setdefault("reimb", {})[f"{side}-{what}"] = [b, n]
            keep()
            if side == "after":
                w.check("reimb_badge", role, f"{what}: the {T} badge = the rows its list shows", f"badge {b}, list {n}",
                        b == n)
            else:
                w.check("reimb_badge", role, f"(before) {what}: badge vs list", f"badge {b}, list {n}", True, kind="info")
            w.step(page, "reimb_badge", side, role, user, f"{what}: badge {b}, list {n}." + (f" {nxt}" if nxt else ""),
                   click=click, pins=[pin(r_tab(page, T), f"Badge {b}; the list shows {n}.",
                                          "info" if b == n or side == "before" else "must")])
            settle(page, 2500)

        look("Opens on this month", page.get_by_role("button", name=re.compile(r"^Last month")), "Pick Last month.")
        look("Last month", page.get_by_role("button", name="All", exact=True), "Pick All months.")
        title = next((r["title"] for r in f["reimb"]["approved"] if r["m"] == f["reimb"]["this_month"]), "Trip")
        page.get_by_placeholder(re.compile(r"^Search by Title", re.I)).first.fill(title)
        settle(page, 2500)
        look(f"All months, searched \"{title}\"")
        all1 = badge(page, "All")
        w.check("reimb_badge", role, "a closed tab (All) keeps the server's count (accepted)", f"All {all0} → {all1}",
                all0 == all1, kind="info")
        w.step(page, "reimb_badge", side, role, user, f"The closed tab All still shows {all1}: closed tabs keep the "
               "server's all-months count (owner accepted).", pins=[pin(r_tab(page, "All"), f"All {all1}.", "info")])


# ---------------------------------------------------------------- pay dialog titles
def dialog_steps(page, side: str, role: str, user: str, what: str, cid: str = "pay_dialog") -> None:
    page.wait_for_timeout(1500)
    dlg = page.get_by_role("alertdialog").first
    dlg.wait_for(timeout=30_000)
    title = dlg.get_by_role("heading").first
    t = title.inner_text().strip()
    act = dlg.get_by_role("button", name=re.compile(r"^(Mark as Reconciled|Mark as Paid|Save Changes)$")).first
    a = act.inner_text().strip() if act.count() else ""
    state.setdefault("dialogs", {})[f"{side}-{what}"] = [t, a]
    keep()
    if side == "after":
        w.check(cid, role, f"{what}: title \"Record Payment & Mark as Reconciled\", button \"Mark as Reconciled\"",
                f"\"{t}\" / \"{a}\"", t == "Record Payment & Mark as Reconciled" and a == "Mark as Reconciled")
    else:
        w.check(cid, role, f"(before) {what}: title / button", f"\"{t}\" / \"{a}\"", True, kind="info")
    ok_t = t == "Record Payment & Mark as Reconciled"
    w.step(page, cid, side, role, user, f"{what}: the dialog is titled \"{t}\".",
           pins=[pin(title, f"\"{t}\"", "info" if ok_t or side == "before" else "must")])
    ok_a = a == "Mark as Reconciled"
    w.step(page, cid, side, role, user, f"Its button says \"{a}\". Cancel: nothing is saved.",
           click=dlg.get_by_role("button", name="Cancel"),
           pins=[pin(act, f"\"{a}\"", "info" if ok_a or side == "before" else "must")] if a else [])
    settle(page, 1500)


def pay_dialog(side: str) -> None:
    task = task_of(side)
    role, user = "Accountant Lead", USERS["Accountant Lead"]
    with session(task, user, PW) as (page, _):
        open_payments(page)
        w.step(page, "pay_dialog", side, role, user, "Accountant Lead: Project Payment & Expense. Open Payment Done / "
               "Reconciliation Pending.",
               click=page.get_by_role("button", name=re.compile(r"^Payment Done . Reconciliation Pending \d+$")))
        settle(page, 3000)
        rows = page.locator("tbody tr")
        pe = rows.filter(has_text="Project Expense").filter(has_not_text="Non Project Expense").first
        w.step(page, "pay_dialog", side, role, user, "Mark Reconciled on a Project Expense row.",
               click=pe.get_by_role("button", name="Mark Reconciled"))
        dialog_steps(page, side, role, user, "Project Expense")
        npe = rows.filter(has_text="Non Project Expense").filter(has_not_text="Reimbursements").first
        w.step(page, "pay_dialog", side, role, user, "Mark Reconciled on a Non-Project Expense row.",
               click=npe.get_by_role("button", name="Mark Reconciled"))
        dialog_steps(page, side, role, user, "Non-Project Expense")
        wo = rows.filter(has_text=re.compile(r"WO Payment|PO Payment")).filter(
            has=page.get_by_role("button", name="Mark Reconciled")).first
        if wo.count():
            w.step(page, "pay_dialog", side, role, user, "Mark Reconciled on a WO / PO payment row.",
                   click=wo.get_by_role("button", name="Mark Reconciled"))
            page.wait_for_timeout(1800)
            d = page.get_by_role("dialog").or_(page.get_by_role("alertdialog")).first
            h = d.get_by_role("heading").first
            t = h.inner_text().strip() if h.count() else ""
            w.check("pay_dialog", role, "the WO / PO payment dialog is unchanged (not \"Mark as Reconciled\")", t or "none",
                    "Mark as Reconciled" not in d.inner_text(), kind="should")
            w.step(page, "pay_dialog", side, role, user, f"The order payment's own dialog: \"{t}\". Escape.",
                   pins=[pin(h, f"\"{t}\"", "info")] if t else [])
            page.keyboard.press("Escape")
            settle(page, 1000)
        else:
            w.check("pay_dialog", role, "a WO / PO payment row to open", "none listed on Reconciliation Pending here",
                    True, kind="info")

        # Reimbursements › Reconciliation Pending opens the same Non-Project Expense dialog.
        sidebar(page, "Reimbursements")
        settle(page, 3000)
        w.step(page, "pay_dialog", side, role, user, "Reimbursements › Reconciliation Pending.",
               click=r_tab(page, "Reconciliation Pending"))
        settle(page, 3000)
        claim = page.locator("tbody tr").filter(has=page.get_by_role("button", name="Mark Reconciled")).first
        w.step(page, "pay_dialog", side, role, user, "Mark Reconciled on a claim.",
               click=claim.get_by_role("button", name="Mark Reconciled"))
        dialog_steps(page, side, role, user, "Reimbursement claim")


PLAN = [("bell", gst), ("gst_width", gst_fit), ("audit_card", audit), ("cheque_width", cheques), ("reimb_badge", reimb),
        ("pay_dialog", pay_dialog)]


def finish() -> None:
    w.status("docs", "not_walked", "Docs only (expenses.md, reimbursements.md, ADR-0030, feature files and two walk "
             "scripts): no screen changes. The two rules they record (the expense list pages are not in use; closed "
             "Reimbursements tabs keep the server count) were accepted by the owner and are shown, not flagged.")
    for c in w.data["changes"]:
        if c["status"] == "not_walked" and c["reason"]:
            continue
        if not any(x["change"] == c["id"] for x in w.data["steps"] + w.data["checks"]):
            continue
        bad = [k for k in w.data["checks"] if k["change"] == c["id"] and not k["ok"] and k["kind"] == "must"]
        musts = [q for s in w.data["steps"] if s["change"] == c["id"] for q in s["pins"] if q["kind"] == "must"]
        errs = [e for e in w.data.get("errors", []) if e["change"] == c["id"]]
        w.status(c["id"], "failed" if bad or musts or errs else "seen",
                 "; ".join([f"{k['role']}: expected {k['expect']}, saw {k['seen']}" for k in bad]
                           + [f"walk stopped in {e['fn']}({', '.join(e['args'])}): {e['error']}" for e in errs]))


if MODE == "setup":
    setup()
elif MODE in ("before", "after"):
    for cid, fn in PLAN:
        if not ONLY or fn.__name__ in ONLY:
            guarded(cid, fn, MODE)
    print(w.save())
    print(json.dumps(w.data.get("errors", []), indent=1))
elif MODE == "finish":
    finish()
    print(w.save())
    for c in w.data["changes"]:
        print(c["id"], c["status"], c["reason"][:200])
