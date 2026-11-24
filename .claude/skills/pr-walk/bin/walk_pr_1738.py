"""Walk PR #1738 (an approved GST Payment Request's payment is born Approved, no L1 / CEO) on its env and its base env.

    python3 -I walk_pr_1738.py <out dir> [after|before ...]   # from the checkout root

Only one walk lane may be free, so the script serves the envs itself, one after the other: it serves pr-1738, walks
the after side, stops it, serves pr-1738-base and walks the before side. The Work Order and every amount are read
from the env's own data at the start of each side, so a rerun on the same env picks amounts that still fit.
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
from drive import session, sidebar  # noqa: E402
from record import Walk, inr, pin  # noqa: E402

DEVENV = "/Users/abhishek/work/nirmaan/deploy_setup/frappe_docker/development/devenv.sh"
AFTER, BEFORE = "pr-1738", "pr-1738-base"
PW = "WalkPw-1738"
WO = ""  # picked per side by pick_wo(): the Work Order the Procurement Lead sees with the most GST left
USERS = {
    "Procurement Lead": "sowmya@nirmaan.app",   # the only user who sees this Work Order's project
    "Accountant": "swathi@nirmaan.app",
    "Accountant Lead": "deepa@nirmaan.app",
    "Admin (L1)": "admins@nirmaan.app",
    "CEO": "nitesh@nirmaan.app",
}
UTR_TAKEN_SQL = """select utr, name from "tabProject Payments" where status='Paid' and coalesce(utr,'')<>''
                   order by creation desc limit 1"""

out = Path(sys.argv[1])
SIDES = [s for s in sys.argv[2:] if s in ("after", "before")] or ["after", "before"]
w = Walk(out, pr={"number": 1738, "title": "Gst/request direct",
                  "url": "https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/pull/1738",
                  "author": "madhubalan17js", "head": "eeef9097c", "base": "de49cf3c0"},
         envs={"after": AFTER, "before": BEFORE},
         data_note="a test copy of the production backup of 2026-11-17 (it has no GST requests yet; the walk raises them)")
w.change("approve", "Approved GST request → payment Approved",
         "An Accountant approving a GST Payment Request creates its GST payment already Approved, at any amount: it "
         "goes to Payment need to paid (28 → 29 in the PR's walk), not to L1 or the CEO.")
w.change("lead", "Accountant Lead approves too",
         "₹25,000 approved by the Accountant Lead is also born Approved (B1).")
w.change("base", "Base payments keep the amount rule",
         "An ordinary ₹20,000 base payment on the same WO is still Requested and waits in L1's queue.")
w.change("tab", "GST Requests tab",
         "'Ready to pay' wording; vendor card on the Vendor name; no id / 'No GSTIN' flash; Actions only on Pending / "
         "Rejected ('—' on All); a Reviewed column, also in the CSV.")
w.change("reject", "Reject needs a reason; over GST left is blocked",
         "Reject needs a reason and frees the GST. A request over GST left is blocked.")
w.change("errors", "Dialogs show the server's own reason",
         "Request / Update / Delete Payment dialogs show the server's refusal (e.g. a duplicate UTR on Mark as Paid) "
         "instead of 'Failed'.")
w.change("summary", "Payment Summary current at once",
         "After a GST decision the Payment Summary is read again, so its cards are current on first view.")
w.change("bell", "Admins' note: for information",
         "Admins get 'GST payment PAY-… approved by <decider> from GPR-…' for information; cut to 140 characters. "
         "Open question in the PR: the CEO, an Admin-profile user, gets it too.")
w.change("patch", "One-time patch B2",
         "GST payments at Requested / CEO Pending with an Approved, reviewed request move to Approved; both dates = "
         "the review day; `modified` untouched; one comment; base payments and others skipped; has a dry run.")
w.change("live", "Live badge across windows",
         "The GST badge and list update live across windows.")


# ---------------------------------------------------------------- helpers
def db(task: str, name: str, code: str) -> dict:
    """Run a snippet on the env DB; it must print one 'JSON {...}' line. Script and output are kept under db/."""
    src = out / "db" / f"{task}-{name}.py"
    src.parent.mkdir(exist_ok=True)
    src.write_text("import json\nimport frappe\n" + code)
    res = subprocess.run([DEVENV, "script", task, str(src)], capture_output=True, text=True, timeout=300)
    (out / "db" / f"{task}-{name}.txt").write_text(res.stdout + res.stderr)
    line = next((l for l in res.stdout.splitlines() if l.startswith("JSON ")), None)
    if line is None:
        raise RuntimeError(f"db {name}: no JSON line; see db/{task}-{name}.txt")
    return json.loads(line[5:])


def pick_wo(task: str) -> tuple[str, float]:
    d = db(task, "pick-wo", f"""
from nirmaan_stack.services.order_payments import work_order_summary
from nirmaan_stack.services.work_order_lifecycle import payment_request_problem
seen = set(frappe.get_all("User Permission", filters={{"user": "{USERS['Procurement Lead']}", "allow": "Projects"}}, pluck="for_value"))
best = ("", 0.0)
for name in frappe.get_all("Service Requests", filters={{"status": "Approved"}}, pluck="name"):
    sr = frappe.get_doc("Service Requests", name)
    if sr.project not in seen or payment_request_problem(sr.name, sr.status):
        continue
    lim = work_order_summary(sr)["limit"]
    if lim["invoice_check"]["passes"] and lim["gst_left"] > best[1]:
        best = (name, lim["gst_left"])
print("JSON " + json.dumps({{"wo": best[0], "left": best[1]}}))
""")
    return d["wo"], d["left"]


def facts(task: str, tag: str) -> dict:
    return db(task, f"facts-{tag}", f"""
from nirmaan_stack.services.order_payments import work_order_summary
lim = work_order_summary(frappe.get_doc("Service Requests", "{WO}"))["limit"]
counts = {{s: frappe.db.count("Project Payments", {{"status": s}}) for s in ("Approved", "Requested", "CEO Pending")}}
utr = frappe.db.sql('''{UTR_TAKEN_SQL}''', as_dict=True)[0]
print("JSON " + json.dumps({{"gst_left": lim["gst_left"], "counts": counts, "utr": utr.utr, "utr_on": utr.name}}))
""")


def request_of(task: str, amount: float, tag: str) -> dict:
    """The newest GST request of `amount` on WO, with its payment's status, dates and the admins' notes."""
    return db(task, f"req-{tag}", f"""
r = frappe.get_all("GST Payment Request", filters={{"work_order": "{WO}", "amount": {amount}}},
                   fields=["name", "status", "project_payment", "review_comment", "reviewed_by"], order_by="creation desc", limit=1)
r = r[0] if r else {{}}
p = frappe.db.get_value("Project Payments", r.get("project_payment"), ["status", "approval_date", "ceo_approval_date",
                         "auto_approved"], as_dict=True) if r.get("project_payment") else {{}}
bells = frappe.get_all("Nirmaan Notifications", filters={{"docname": r.get("project_payment") or "-"}},
                       fields=["recipient", "title", "description"])
print("JSON " + json.dumps({{"req": r, "pay": p, "bells": bells}}, default=str))
""")


def settle(page, ms: int = 1500) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def tab_count(page, label: str) -> int | None:
    b = page.get_by_role("button", name=re.compile(rf"^{re.escape(label)} \d+$"))
    if not b.count():
        return None
    return int(re.search(r"(\d+)$", b.first.inner_text().strip()).group(1))


def open_payments(page) -> None:
    sidebar(page, "Project Payment & Expense")
    settle(page)


def custom_input(page):
    """The Custom amount box: the number input in the row of the #custom radio."""
    return page.locator("#custom").locator("xpath=..").locator("input[type=number]")


def gst_tab(page):
    return page.get_by_role("button", name=re.compile(r"^GST Requests \d+$"))


def guarded(cid: str, fn, *args) -> None:
    steps, checks = len(w.data["steps"]), len(w.data["checks"])
    try:
        fn(*args)
    except Exception as e:
        traceback.print_exc()
        w.status(cid, "failed", f"walk stopped: {type(e).__name__}: {str(e).splitlines()[0][:160]}")


def serve(task: str) -> None:
    for _ in range(6):
        res = subprocess.run([DEVENV, "serve", task, "--wait"], capture_output=True, text=True, timeout=600)
        if (f"t-{task}.localhost" in res.stdout and "serving" in res.stdout) or "already serving" in res.stdout + res.stderr:
            return
    sys.exit(f"no walk lane for {task}")


# ---------------------------------------------------------------- raise (Procurement Lead)
def open_wo(page, side: str, user: str, role: str, record: bool) -> None:
    """Work Orders › All WO › Approved WO › search by WO ID › the WO."""
    step = (lambda *a, **k: w.step(page, "approve", side, role, user, *a, **k)) if record else \
        (lambda caption, click=None, pins=(): click.first.click() if click is not None else None)
    sidebar(page, "Work Orders")
    settle(page)
    page.get_by_text(re.compile(r"^All WO")).first.click()
    settle(page, 800)
    page.get_by_text(re.compile(r"^Approved WO")).first.click()
    settle(page, 800)
    page.get_by_role("combobox").first.click()
    page.get_by_role("option", name="WO ID").click()
    page.get_by_placeholder(re.compile("Search", re.I)).first.fill(WO)
    settle(page, 2000)
    step(f"Work Orders › All WO › Approved WO, searched by WO ID. Open {WO}.",
         click=page.get_by_role("link", name=re.compile(WO[-5:])))
    settle(page, 2000)


def raise_gst(page, side: str, amount: float, record: bool) -> None:
    role, user = "Procurement Lead", USERS["Procurement Lead"]
    open_wo(page, side, user, role, record)
    btn = page.get_by_role("button", name="Request Payment").last
    if record:
        w.step(page, "approve", side, role, user, "Request Payment on the Work Order.", click=btn)
    else:
        btn.click()
    settle(page, 1500)
    page.get_by_role("radio", name=re.compile("GST")).first.click()
    settle(page, 800)
    page.locator("#custom").click()
    custom_input(page).fill(str(int(amount)))
    settle(page, 1200)
    send = page.get_by_role("button", name=re.compile(r"^Send to Accountant$|^Confirm$"))
    note = page.get_by_text(re.compile(r"Goes to the Accountant first"))
    if record:
        want_new = side == "after"
        txt = note.first.inner_text() if note.count() else ""
        ok = ("no L1 or CEO" in txt) == want_new
        w.check("approve", role, "note says 'ready to pay: no L1 or CEO approval'" if want_new
                else "note says 'follows the usual approval by amount'", txt or "no note", ok)
        w.step(page, "approve", side, role, user,
               f"Pay for GST, Custom ₹{inr(int(amount))}. The note under the amount says where it goes. Send to Accountant.",
               click=send, pins=[pin(note, txt, "info")] if note.count() else [])
    else:
        send.first.click()
    settle(page, 2500)


# ---------------------------------------------------------------- the after / before walk
def walk_side(side: str) -> None:
    global WO
    task = AFTER if side == "after" else BEFORE
    WO, _left = pick_wo(task)
    f0 = facts(task, f"{side}-start")
    left = f0["gst_left"]
    if left < 100_000:
        sys.exit(f"{task}: only ₹{left} GST left on {WO}; the walk needs ₹1,00,000. Reset the env.")
    BIG, LEAD, REJ = 60_000, 25_000, 10_000

    # Procurement Lead raises three requests: ₹60,000 (recorded), ₹25,000 and ₹10,000 (setup through the same screen).
    with session(task, USERS["Procurement Lead"], PW) as (page, _):
        raise_gst(page, side, BIG, record=True)
    with session(task, USERS["Procurement Lead"], PW) as (page, _):
        raise_gst(page, side, LEAD, record=False)
    with session(task, USERS["Procurement Lead"], PW) as (page, _):
        raise_gst(page, side, REJ, record=False)
    reqs = {a: request_of(task, a, f"{side}-raised-{a}")["req"] for a in (BIG, LEAD, REJ)}
    for a, r in reqs.items():
        if r.get("status") != "Pending":
            raise RuntimeError(f"the ₹{a} request was not raised: {r}")

    # Accountant approves ₹60,000.
    role, user = "Accountant", USERS["Accountant"]
    with session(task, user, PW) as (page, _):
        open_payments(page)
        page.get_by_role("button", name=re.compile(r"^Payment need to paid \d+$")).first.click()
        settle(page, 2500)
        need0 = tab_count(page, "Payment need to paid")
        summary0 = re.search(r"Approved But not Paid\s*\(\s*(\d+)\s*\)", page.locator("body").inner_text())
        w.step(page, "approve", side, role, user, f"Payment need to paid shows {need0}. Open GST Requests.",
               click=gst_tab(page))
        settle(page, 2500)
        row = page.locator("tbody tr").filter(has_text=f"₹{inr(BIG)}")
        approve = page.get_by_role("button", name=f"Approve {reqs[BIG]['name']}")
        desc = page.get_by_text(re.compile(r"^GST payments on Work Orders wait here"))
        w.check("tab", role, "intro says it goes straight to Payment need to paid" if side == "after" else "old intro",
                desc.first.inner_text() if desc.count() else "no intro",
                desc.count() > 0 and (("no L1 or CEO" in desc.first.inner_text()) == (side == "after")), kind="should")
        w.step(page, "approve", side, role, user, f"The Pending request {reqs[BIG]['name']} for ₹{inr(BIG)}. Approve it.",
               click=approve, pins=[pin(desc, "The tab's intro: where an approved request's payment goes.", "info")])
        settle(page, 1500)
        dlg = page.get_by_role("alertdialog")
        note = dlg.get_by_text(re.compile(r"straight to Payment need to paid"))
        if side == "after":
            w.check("approve", role, "approve dialog says no L1 or CEO", "shown" if note.count() else "not shown",
                    note.count() > 0, kind="should")
        w.step(page, "approve", side, role, user, "The approve dialog. Confirm.",
               click=dlg.get_by_role("button", name=re.compile(r"^Approve ₹")),
               pins=[pin(note, "New line: the payment goes straight to Payment need to paid.", "info")] if note.count() else [])
        settle(page, 3000)
        need1 = tab_count(page, "Payment need to paid")
        pay = request_of(task, BIG, f"{side}-approved-{BIG}")
        status = pay["pay"].get("status")
        want = "Approved" if side == "after" else "Requested"
        w.check("approve", role, f"₹{inr(BIG)} payment is {want}", f"{pay['req'].get('project_payment')} is {status}",
                status == want)
        w.check("approve", role, f"Payment need to paid {need0} → {need0 + 1 if side == 'after' else need0}",
                f"{need0} → {need1}", need1 == (need0 + 1 if side == "after" else need0))
        pay_name = pay["req"].get("project_payment")
        w.step(page, "approve", side, role, user,
               f"After approving: Payment need to paid shows {need1} (was {need0}). The payment {pay_name} is {status}.",
               pins=[pin(page.get_by_role("button", name=re.compile(r"^Payment need to paid \d+$")),
                         f"{need0} → {need1}", "info")])
        if side == "after":
            bell = pay["bells"]
            ceo = [b for b in bell if b["recipient"] == USERS["CEO"]]
            w.check("bell", "Admins", "for-information note, 140 characters or fewer",
                    f"{len(bell)} notes, longest {max((len(b['description'] or '') for b in bell), default=0)} chars",
                    bool(bell) and all(len(b["description"] or "") <= 140 for b in bell))
            w.check("bell", "CEO", "the CEO is told nothing (the design)", f"the CEO got: {ceo[0]['description']}" if ceo
                    else "nothing", not ceo, kind="should")

        # Payment Summary on first view: the Payment need to paid tab carries the cards.
        page.get_by_role("button", name=re.compile(r"^Payment need to paid \d+$")).first.click()
        page.wait_for_timeout(700)
        summary1 = re.search(r"Approved But not Paid\s*\(\s*(\d+)\s*\)", page.locator("body").inner_text())
        if summary0 and summary1:
            a0, a1 = int(summary0.group(1)), int(summary1.group(1))
            exp = a0 + 1 if side == "after" else a0
            w.check("summary", role, f"Approved But not Paid {a0} → {exp} at first view", f"{a0} → {a1} at 0.7 s", a1 == exp)
            w.step(page, "summary", side, role, user, f"Back on Payment need to paid at once: Approved But not Paid "
                   f"shows {a1} (was {a0}).", pins=[pin(page.get_by_text(re.compile(r"^Approved But not Paid")),
                                                       f"{a0} → {a1}", "info")])
            if side == "after":
                l1 = page.get_by_text(re.compile(r"^L1 Approval Today"))
                w.step(page, "summary", side, role, user, "The Approved & Settled card counts the Accountant's GST "
                       "approval under L1 and CEO Approval Today.",
                       pins=[pin(l1, "GST approvals by the Accountant count here as L1 / CEO approvals. The PR says "
                                     "the owner accepted this on 18 Nov.", "info")])

        # Mark as Paid with a UTR already used: the server's reason must show.
        if True:
            page.locator("tbody tr").first.wait_for()
            row = page.locator("tbody tr").filter(has_text=WO).filter(has_text=f"{inr(BIG)}").first \
                if side == "after" else page.locator("tbody tr").filter(has_text=re.compile(r"(WO|PO) Payment")).filter(
                    has=page.get_by_role("button", name=re.compile("Mark as Paid"))).first
            doc = re.search(r"(SR-\d{5}-\d{6}|PO.\d+.\d+.\d+-\d+)", row.inner_text()).group(1)
            w.step(page, "errors", side, role, user, "Mark as Paid on the approved payment.",
                   click=row.get_by_role("button", name=re.compile("Mark as Paid")))
            settle(page, 1000)
            w.step(page, "errors", side, role, user, "Confirm: it moves to Reconciliation Pending, where the UTR goes.",
                   click=page.get_by_role("button", name="Yes, mark as Paid"))
            settle(page, 2500)
            recon = page.get_by_role("button", name=re.compile(r"^Payment Done . Reconciliation Pending \d+$"))
            w.step(page, "errors", side, role, user, "Open Payment Done / Reconciliation Pending.", click=recon)
            settle(page, 3000)
            rrow = page.locator("tbody tr").filter(has_text=doc).filter(
                has=page.get_by_role("button", name="Mark Reconciled")).first
            w.step(page, "errors", side, role, user, "Mark Reconciled on that payment.",
                   click=rrow.get_by_role("button", name="Mark Reconciled"))
            settle(page, 1500)
            dlg = page.get_by_role("alertdialog")
            receipt = out / f"receipt-{side}.png"
            from PIL import Image, ImageDraw
            img = Image.new("RGB", (600, 300), "white")
            ImageDraw.Draw(img).text((20, 20), "PR walk fixture receipt, not a real bank receipt", fill="black")
            img.save(receipt)
            dlg.locator("input[type=file]").first.set_input_files(str(receipt))
            page.wait_for_timeout(6000)
            toast = page.get_by_text(re.compile(r"Auto-fill failed|Please enter details"))
            if toast.count():
                w.step(page, "errors", side, role, user, "The receipt read fails here (no Gemini key on a test env).",
                       pins=[pin(toast.first, "Expected on a test env: it has no Gemini key.", "info")])
            page.locator("#utr").fill(f0["utr"])
            page.locator("#payDate").fill("2026-11-24")
            w.step(page, "errors", side, role, user, f"UTR {f0['utr']} is already on {f0['utr_on']}. Confirm Payment.",
                   click=page.get_by_role("button", name="Confirm Payment"))
            page.wait_for_timeout(2500)
            body = page.locator("body").inner_text()
            good = "already recorded on payment" in body
            err = page.get_by_text(re.compile(r"already recorded on payment|^Failed$")).first
            w.check("errors", role, "the toast gives the server's reason" if side == "after" else "(before: what shows)",
                    "server's reason" if good else ("'Failed'" if re.search(r"\bFailed\b", body) else "neither"),
                    good if side == "after" else True)
            w.step(page, "errors", side, role, user, "The refusal as the Accountant sees it.",
                   pins=[pin(err, "The server's own reason." if good else "A bare 'Failed': no reason given.",
                             "info" if good else "should")] if err.count() else [])
            page.keyboard.press("Escape")

    # Accountant Lead approves ₹25,000.
    role, user = "Accountant Lead", USERS["Accountant Lead"]
    with session(task, user, PW) as (page, _):
        open_payments(page)
        w.step(page, "lead", side, role, user, "GST Requests as the Accountant Lead.", click=gst_tab(page))
        settle(page, 2500)
        w.step(page, "lead", side, role, user, f"Approve {reqs[LEAD]['name']} for ₹{inr(LEAD)}.",
               click=page.get_by_role("button", name=f"Approve {reqs[LEAD]['name']}"))
        settle(page, 1200)
        page.get_by_role("alertdialog").get_by_role("button", name=re.compile(r"^Approve ₹")).click()
        settle(page, 3000)
        p = request_of(task, LEAD, f"{side}-approved-{LEAD}")
        want = "Approved" if side == "after" else "Requested"
        w.check("lead", role, f"₹{inr(LEAD)} payment is {want}", f"{p['req'].get('project_payment')} is {p['pay'].get('status')}",
                p["pay"].get("status") == want)
        if side == "after":
            w.check("lead", role, "both approval dates stamped, not auto_approved",
                    f"approval {p['pay'].get('approval_date')}, CEO {p['pay'].get('ceo_approval_date')}, "
                    f"auto {p['pay'].get('auto_approved')}",
                    bool(p["pay"].get("approval_date")) and bool(p["pay"].get("ceo_approval_date"))
                    and str(p["pay"].get("auto_approved")) == "0")

        # Reject: needs a reason; frees the GST.
        left_before = facts(task, f"{side}-before-reject")["gst_left"]
        w.step(page, "reject", side, role, user, f"Reject {reqs[REJ]['name']} for ₹{inr(REJ)}.",
               click=page.get_by_role("button", name=f"Reject {reqs[REJ]['name']}"))
        settle(page, 1200)
        dlg = page.get_by_role("alertdialog")
        rej = dlg.get_by_role("button", name="Reject", exact=True)
        w.check("reject", role, "Reject is disabled with no reason", "disabled" if rej.is_disabled() else "enabled",
                rej.is_disabled())
        w.step(page, "reject", side, role, user, "With no reason, Reject is greyed out.",
               pins=[pin(rej, "Disabled until a reason is typed." if rej.is_disabled() else "Enabled with no reason.",
                         "info" if rej.is_disabled() else "must")])
        dlg.locator("#gst-reject-reason").fill("PR walk: amount does not match the GST invoice.")
        w.step(page, "reject", side, role, user, "A reason typed. Reject.", click=rej)
        settle(page, 2500)
        left_after = facts(task, f"{side}-after-reject")["gst_left"]
        w.check("reject", role, f"GST left goes up by ₹{inr(REJ)}", f"₹{left_before:,.2f} → ₹{left_after:,.2f}",
                round(left_after - left_before, 2) == REJ)

        # The tab's pills: Pending has no Reviewed; Approved has no Actions; All shows both, '—' where no button.
        for pill in ("Pending", "Approved", "All"):
            page.get_by_role("tab", name=pill, exact=True).click()
            settle(page, 2000)
            heads = [h.strip() for h in page.get_by_role("columnheader").all_inner_texts()]
            has_rev, has_act = "Reviewed" in heads, "Actions" in heads
            if side == "after":
                want_rev, want_act = pill != "Pending", pill != "Approved"
                w.check("tab", role, f"{pill}: Reviewed {'shown' if want_rev else 'hidden'}, Actions "
                        f"{'shown' if want_act else 'hidden'}", f"Reviewed {'shown' if has_rev else 'hidden'}, Actions "
                        f"{'shown' if has_act else 'hidden'}", (has_rev, has_act) == (want_rev, want_act))
            pins = []
            if pill == "All":
                rrow = page.locator("tbody tr").filter(has_text="Rejected").first
                vend = page.locator("tbody tr").first.locator("td").nth(2)
                pins = [pin(page.get_by_role("columnheader", name="Reviewed"), "New: who decided it, and when.", "info")] \
                    if has_rev else []
                if rrow.count():
                    pins.append(pin(rrow, "Rejected: the reason sits behind the speech-bubble icon.", "info"))
                if side == "after" and vend.count():
                    pins.append(pin(vend, "The vendor name opens the vendor card.", "info"))
            w.step(page, "tab", side, role, user, f"GST Requests › {pill}. Columns: {', '.join(h for h in heads if h)}.",
                   pins=pins)
        if side == "after":
            vend_btn = page.locator("tbody tr").first.locator("td").nth(2).get_by_text(re.compile(r"\w")).first
            w.step(page, "tab", side, role, user, "Open the vendor card from the vendor name.", click=vend_btn)
            settle(page, 1200)
            card = page.locator("[data-radix-popper-content-wrapper]").first
            w.step(page, "tab", side, role, user, "The vendor card (contact, bank account).",
                   pins=[pin(card, "Vendor card", "info")] if card.count() else [])
            page.keyboard.press("Escape")
            with page.expect_download(timeout=60_000) as d:
                page.get_by_role("button", name="Export").first.click()
                settle(page, 800)
                csv_btn = page.get_by_role("menuitem", name=re.compile("CSV", re.I))
                if csv_btn.count():
                    csv_btn.first.click()
            csv = Path(d.value.path()).read_text(encoding="utf-8-sig", errors="replace").splitlines()
            (out / "gst-requests.csv").write_text("\n".join(csv[:20]))
            w.check("tab", role, "CSV has a Reviewed column", csv[0][:160] if csv else "empty", bool(csv) and "Reviewed" in csv[0])

        # Over GST left: blocked in Request Payment.
    with session(task, USERS["Procurement Lead"], PW) as (page, _):
        role, user = "Procurement Lead", USERS["Procurement Lead"]
        left = facts(task, f"{side}-over")["gst_left"]
        open_wo(page, side, user, role, record=False)
        page.get_by_role("button", name="Request Payment").last.click()
        settle(page, 1500)
        page.get_by_role("radio", name=re.compile("GST")).first.click()
        page.locator("#custom").click()
        too_much = int(left) + 5_000
        custom_input(page).fill(str(too_much))
        settle(page, 1500)
        send = page.get_by_role("button", name=re.compile(r"^Send to Accountant$"))
        warn = page.get_by_text(re.compile(r"^Request exceeds"))
        blocked = send.count() > 0 and send.first.is_disabled()
        w.check("reject", role, f"₹{inr(too_much)} over ₹{left:,.2f} GST left is blocked",
                "Send is disabled" if blocked else "Send is enabled", blocked)
        w.step(page, "reject", side, role, user, f"Asking ₹{inr(too_much)} when ₹{left:,.2f} GST is left.",
               pins=[pin(send, "Send to Accountant stays disabled." if blocked else "Send is enabled.",
                         "info" if blocked else "must")] + ([pin(warn, "The reason shown.", "info")] if warn.count() else []))

    # L1 (Admin) and the CEO: the approved GST payment is not in their queues; the base payment is in L1's.
    base_pay = db(task, f"{side}-basepay", f"""
from nirmaan_stack.api.payments.project_payments import insert_requested_payment
frappe.set_user("{USERS['Procurement Lead']}")
pay, _c, _s = insert_requested_payment(frappe.get_doc("Service Requests", "{WO}"), 20000, False, {{}})
frappe.db.commit()
print("JSON " + json.dumps({{"name": pay.name, "status": frappe.db.get_value("Project Payments", pay.name, "status")}}))
""")
    w.check("base", "Procurement Lead", "a ₹20,000 base payment is Requested (L1)", f"{base_pay['name']} is {base_pay['status']}",
            base_pay["status"] == "Requested")
    big_pay = request_of(task, BIG, f"{side}-final-{BIG}")["req"]["project_payment"]
    for role, label in (("Admin (L1)", "Payment Pending Approval"), ("CEO", "Payment Pending CEO Approval")):
        user = USERS[role]
        with session(task, user, PW) as (page, _):
            open_payments(page)
            tab = page.get_by_role("button", name=re.compile(rf"^{label} \d+$"))
            w.step(page, "approve", side, role, user, f"{label} as {role}.", click=tab)
            settle(page, 2500)
            srch = page.get_by_placeholder(re.compile("Search", re.I)).first
            srch.fill(WO)
            settle(page, 2500)
            rows = page.locator("tbody tr").filter(has_text=WO)
            texts = rows.all_inner_texts()
            gst_60 = [t for t in texts if "GST" in t and inr(BIG) in t]
            base_20 = [t for t in texts if "GST" not in t and "20,000" in t]
            if role == "Admin (L1)":
                exp60 = side == "before"
                w.check("approve", role, f"the ₹{inr(BIG)} GST payment {'is' if exp60 else 'is not'} in L1's queue",
                        "in the queue" if gst_60 else "not in the queue", bool(gst_60) == exp60)
                w.check("base", role, "the ₹20,000 base payment is in L1's queue", "in the queue" if base_20 else
                        "not in the queue", bool(base_20))
                pins = [pin(rows.filter(has_text="20,000").first, "The ₹20,000 base payment: still waits for L1.", "info")] \
                    if base_20 else []
                if gst_60:
                    pins.append(pin(rows.filter(has_text=inr(BIG)).first, f"The ₹{inr(BIG)} GST payment waits for L1.",
                                    "info"))
                w.step(page, "base", side, role, user, f"L1's queue for {WO}.", pins=pins)
            else:
                w.check("approve", role, f"the ₹{inr(BIG)} GST payment is not in the CEO's queue",
                        "in the queue" if gst_60 else "not in the queue", not gst_60)
                w.step(page, "approve", side, role, user, f"The CEO's queue for {WO}: {len(texts)} rows.")
            if role == "CEO" and side == "after":
                sidebar(page, "Notifications")
                settle(page, 2500)
                note = page.get_by_text(re.compile(rf"GST payment {big_pay} approved by")).first
                w.step(page, "bell", side, role, user, "The CEO's notifications.",
                       pins=[pin(note, "The CEO gets the admins' for-information note. The design says the CEO is "
                                       "told nothing; the PR leaves this open.", "should")] if note.count() else [])


def patch_checks() -> None:
    """The B2 patch has no screen. It was run on the BEFORE env (real GST payments the old code left at Requested),
    in one transaction that was then rolled back; see verify/pr-1738/db/patch_check.txt."""
    src = Path.home() / "claude-artifacts/verify/pr-1738/db/patch_check.txt"
    line = next(l for l in src.read_text().splitlines() if l.startswith("JSON "))
    d = json.loads(line[5:])
    (out / "db" / "patch_check.txt").write_text(src.read_text())
    b, r = d["before"], d["after_real"]
    gst = [n for n in r if r[n]["is_gst_payment"] == "1"]
    w.check("patch", "migrate", "dry run saves nothing", "unchanged" if d["after_dry"] == b else "changed",
            d["after_dry"] == b)
    w.check("patch", "migrate", "waiting GST payments → Approved, both dates = review day",
            "; ".join(f"{n}: {r[n]['status']} {r[n]['approval_date']} / {r[n]['ceo_approval_date']}" for n in gst),
            all(r[n]["status"] == "Approved" and r[n]["approval_date"] != "None" for n in gst))
    w.check("patch", "migrate", "`modified` untouched", "same" if all(r[n]["modified"] == b[n]["modified"] for n in r)
            else "moved", all(r[n]["modified"] == b[n]["modified"] for n in r))
    others = [n for n in r if n not in gst]
    w.check("patch", "migrate", "base payment left alone", "; ".join(f"{n}: {r[n]['status']}" for n in others),
            all(r[n]["status"] == b[n]["status"] for n in others))
    w.check("patch", "migrate", "one comment per moved payment",
            ", ".join(f"{n}: {len(c)}" for n, c in d["comments"].items()), all(len(d["comments"][n]) == 1 for n in gst))
    w.check("patch", "migrate", "re-run moves nothing", f"moved {len(d['rerun']['moved'])}", not d["rerun"]["moved"])
    w.status("patch", "seen", "checked in the DB, not on a screen: run on the before env, then rolled back")


for side in SIDES:
    task = AFTER if side == "after" else BEFORE
    other = BEFORE if side == "after" else AFTER
    subprocess.run([DEVENV, "stop", other], capture_output=True, text=True)
    serve(task)
    guarded("approve", walk_side, side)
    w.save()
patch_checks()
w.status("live", "not_walked", "the test env serves no realtime (Socket.IO), so a live update across windows cannot "
                               "be seen here")
for c in w.data["changes"]:
    if c["status"] == "failed" or c["reason"]:
        continue
    if not any(x["change"] == c["id"] for x in w.data["steps"] + w.data["checks"]):
        continue
    bad = [k for k in w.data["checks"] if k["change"] == c["id"] and not k["ok"] and k["kind"] == "must"]
    musts = [q for s in w.data["steps"] if s["change"] == c["id"] for q in s["pins"] if q["kind"] == "must"]
    w.status(c["id"], "failed" if bad or musts else "seen",
             "; ".join(f"{k['role']}: expected {k['expect']}, saw {k['seen']}" for k in bad))
print(w.save())
