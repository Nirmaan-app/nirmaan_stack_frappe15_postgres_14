"""Walk GST Payment Requests: raise, approve straight to Approved, reject, the GST Requests tab (graduated from PR #1738).

    python3 -I .claude/skills/verify/bin/walk_gst_requests.py <env> <out dir> [function ...]   # from the checkout root

`setup` picks the Work Order with the most GST left that a Procurement Lead can see (it needs ₹1,00,000), and raises
the walk's other records through the app's own calls, as their roles would: a ₹25,000 and a ₹10,000 GST request and a
₹20,000 base payment, all as the Procurement Lead. The ₹60,000 request is raised on screen. Each run uses up about
₹85,000 of that Work Order's GST, so a rerun picks the next Work Order with enough left. The CEO is
`CEO_AUTHORIZED_USER`; L1 is another Admin-profile user. State between functions is kept in `<out dir>/state.json`.
"""

from __future__ import annotations

import datetime
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from feature_walk import FeatureWalk, pin, settle, sidebar  # noqa: E402
from record import inr  # noqa: E402

fw = FeatureWalk("GST Payment Requests", "gst-requests.md")
# How many of the matched elements have a word split across two lines (a word's text range with rects on more than
# one row). Wrapping between words, as "Speedtest Accountant" does, is not counted.
BROKEN = ("els => els.filter(e => [...e.childNodes].filter(n => n.nodeType === 3).some(n => { "
          "const re = /\\S+/g; let m; while ((m = re.exec(n.data))) { const r = document.createRange(); "
          "r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); "
          "if (new Set([...r.getClientRects()].map(x => Math.round(x.top))).size > 1) return true; } "
          "return false; })).length")
w = fw.w
STATE = fw.out / "state.json"
state: dict = json.loads(STATE.read_text()) if STATE.exists() else {}
BIG, LEAD, REJ, BASE = 60_000, 25_000, 10_000, 20_000
CEO = "nitesh@nirmaan.app"  # constants/authorized_users.CEO_AUTHORIZED_USER


def keep() -> None:
    STATE.write_text(json.dumps(state, indent=1))


w.change("approve", "Approved GST request → payment Approved",
         "An Accountant approving a GST Payment Request creates its GST payment already Approved, at any amount: it "
         "goes to Payment need to paid, not to L1 or the CEO.")
w.change("lead", "Accountant Lead approves too", "₹25,000 approved by the Accountant Lead is born Approved, both "
         "approval dates stamped, not auto-approved.")
w.change("base", "Base payments keep the amount rule", "A ₹20,000 base payment on the same WO is Requested and waits "
         "in L1's queue.")
w.change("tab", "GST Requests tab", "Ready-to-pay wording; vendor card on the vendor name; Reviewed column (also in "
         "the CSV) except on Pending; Actions except on Approved. On All and Approved, Reviewed keeps at least 155px "
         "with no reviewer name broken, and every Work Order ID and payment ID sits on one line (#1747).")
w.change("reject", "Reject needs a reason; over GST left is blocked",
         "Reject is disabled until a reason is typed and frees the GST. A request over GST left cannot be sent.")
w.change("errors", "Dialogs show the server's own reason",
         "A UTR already used on another payment is refused in Mark Reconciled with the server's reason.")
w.change("summary", "Payment Summary current at once",
         "Right after a GST approval, Approved But not Paid already counts the new payment.")
w.change("bell", "Admins' note: for information",
         "Admin-profile users, the CEO included (owner, 2026-11-24), get 'GST payment PAY-… approved by <decider> from "
         "GPR-….', with no 'Ready to pay: no L1 or CEO' line (#1747), 140 characters at most.")


# ---------------------------------------------------------------- reads
def request_of(name: str) -> dict:
    return fw.db(f"req_{name}", '''
r = frappe.db.get_value("GST Payment Request", sys.argv[1], ["name", "status", "project_payment", "reviewed_by"], as_dict=True)
p = frappe.db.get_value("Project Payments", r.project_payment, ["status", "approval_date", "ceo_approval_date",
                         "auto_approved"], as_dict=True) if r.project_payment else {}
bells = frappe.get_all("Nirmaan Notifications", filters={"docname": r.project_payment or "-"}, fields=["recipient", "description"])
emit({"req": r, "pay": p, "bells": bells})
''', name)


def gst_left(tag: str) -> float:
    return fw.db(f"left_{tag}", '''
from nirmaan_stack.services.order_payments import work_order_summary
emit(work_order_summary(frappe.get_doc("Service Requests", sys.argv[1]))["limit"]["gst_left"])
''', state["wo"])


def newest_request(amount: int) -> str:
    return fw.db(f"newest_{amount}", '''
emit(frappe.get_all("GST Payment Request", filters={"work_order": sys.argv[1], "amount": float(sys.argv[2]),
                    "status": "Pending"}, pluck="name", order_by="creation desc", limit=1)[0])
''', state["wo"], str(amount))


# ---------------------------------------------------------------- screen helpers
def tab_count(page, label: str) -> int | None:
    b = page.get_by_role("button", name=re.compile(rf"^{re.escape(label)} \d+$"))
    return int(re.search(r"(\d+)$", b.first.inner_text().strip()).group(1)) if b.count() else None


def open_payments(page) -> None:
    sidebar(page, "Project Payment & Expense")
    settle(page)


def gst_tab(page):
    return page.get_by_role("button", name=re.compile(r"^GST Requests \d+$"))


def custom_input(page):
    return page.locator("#custom").locator("xpath=..").locator("input[type=number]")


def approved_count(page) -> int | None:
    m = re.search(r"Approved But not Paid\s*\(\s*(\d+)\s*\)", page.locator("body").inner_text())
    return int(m.group(1)) if m else None


def open_wo(page, role: str, user: str, record: bool) -> None:
    """Work Orders › All WO › Approved WO › search by WO ID › the Work Order › Request Payment › GST."""
    wo = state["wo"]
    sidebar(page, "Work Orders")
    settle(page)
    page.get_by_text(re.compile(r"^All WO")).first.click()
    settle(page, 800)
    page.get_by_text(re.compile(r"^Approved WO")).first.click()
    settle(page, 800)
    page.get_by_role("combobox").first.click()
    page.get_by_role("option", name="WO ID").click()
    page.get_by_placeholder(re.compile("Search", re.I)).first.fill(wo)
    settle(page, 2000)
    link = page.get_by_role("link", name=re.compile(wo[-5:]))
    if record:
        w.step(page, "approve", "after", role, user, f"Work Orders › All WO › Approved WO, searched by WO ID. Open {wo}.",
               click=link)
    else:
        link.first.click()
    settle(page, 2000)
    btn = page.get_by_role("button", name="Request Payment").last
    if record:
        w.step(page, "approve", "after", role, user, "Request Payment on the Work Order.", click=btn)
    else:
        btn.click()
    settle(page, 1500)
    page.get_by_role("radio", name=re.compile("GST")).first.click()
    settle(page, 800)
    page.locator("#custom").click()


# ---------------------------------------------------------------- functions
def setup() -> None:
    found = fw.db("setup_wo", '''
from nirmaan_stack.services.order_payments import work_order_summary
from nirmaan_stack.services.work_order_lifecycle import payment_request_problem
pls = candidates("Nirmaan Procurement Lead Profile")
best = None
for name in frappe.get_all("Service Requests", filters={"status": "Approved"}, pluck="name"):
    sr = frappe.get_doc("Service Requests", name)
    if payment_request_problem(sr.name, sr.status):
        continue
    lim = work_order_summary(sr)["limit"]
    if not lim["invoice_check"]["passes"] or lim["gst_left"] < 100000 or (best and lim["gst_left"] <= best["left"]):
        continue
    seers = [u for u in pls if frappe.db.exists("User Permission", {"user": u, "allow": "Projects", "for_value": sr.project})]
    if seers:
        best = {"wo": name, "left": lim["gst_left"], "pls": seers}
emit({"best": best, "utr": frappe.db.sql("""select utr, name from "tabProject Payments" where status='Paid'
      and coalesce(utr,'')<>'' order by creation desc limit 1""", as_dict=True)[0],
      "acc": candidates("Nirmaan Accountant Profile"), "lead": candidates("Nirmaan Accountant Lead Profile"),
      "admin": [u for u in candidates("Nirmaan Admin Profile") if u != sys.argv[1]]})
''', CEO)
    if not found["best"]:
        sys.exit(f"no Approved Work Order on {fw.env} has ₹1,00,000 GST left and a Procurement Lead who sees it")
    state.update(wo=found["best"]["wo"], utr=found["utr"]["utr"], utr_on=found["utr"]["name"])
    state["users"] = {"Procurement Lead": fw.user("Procurement Lead", found["best"]["pls"]),
                      "Accountant": fw.user("Accountant", found["acc"]),
                      "Accountant Lead": fw.user("Accountant Lead", found["lead"]),
                      "Admin (L1)": fw.user("Admin (L1)", found["admin"]), "CEO": fw.user("CEO", [CEO])}
    made = fw.db("setup_records", '''
from nirmaan_stack.api.payments import gst_payment_requests as api
from nirmaan_stack.api.payments.project_payments import insert_requested_payment
a = json.loads(sys.argv[1])
frappe.set_user(a["pl"])
lead = api.request_gst_payment(a["wo"], a["lead"])["name"]
rej = api.request_gst_payment(a["wo"], a["rej"])["name"]
pay, _c, _s = insert_requested_payment(frappe.get_doc("Service Requests", a["wo"]), a["base"], False, {})
frappe.db.commit()
emit({"lead": lead, "rej": rej, "base": pay.name, "base_status": frappe.db.get_value("Project Payments", pay.name, "status")})
''', json.dumps({"pl": state["users"]["Procurement Lead"], "wo": state["wo"], "lead": LEAD, "rej": REJ, "base": BASE}))
    state.update(lead=made["lead"], rej=made["rej"], base=made["base"])
    w.check("base", "Procurement Lead", f"a ₹{inr(BASE)} base payment is Requested (L1)", f"{made['base']} is "
            f"{made['base_status']}", made["base_status"] == "Requested")
    keep()


def raise_big() -> None:
    role = "Procurement Lead"
    user = state["users"][role]
    with fw.session(user) as page:
        open_wo(page, role, user, record=True)
        custom_input(page).fill(str(BIG))
        settle(page, 1200)
        note = page.get_by_text(re.compile(r"Goes to the Accountant first"))
        txt = note.first.inner_text() if note.count() else ""
        w.check("approve", role, "note says 'ready to pay: no L1 or CEO approval'", txt or "no note", "no L1 or CEO" in txt)
        w.step(page, "approve", "after", role, user, f"Pay for GST, Custom ₹{inr(BIG)}. Send to Accountant.",
               click=page.get_by_role("button", name="Send to Accountant"),
               pins=[pin(note, txt, "info")] if note.count() else [])
        settle(page, 2500)
    state["big"] = newest_request(BIG)
    keep()


def approve() -> None:
    role = "Accountant"
    user = state["users"][role]
    big = state["big"]
    with fw.session(user) as page:
        open_payments(page)
        page.get_by_role("button", name=re.compile(r"^Payment need to paid \d+$")).first.click()
        settle(page, 2500)
        need0, sum0 = tab_count(page, "Payment need to paid"), approved_count(page)
        w.step(page, "approve", "after", role, user, f"Payment need to paid shows {need0}. Open GST Requests.",
               click=gst_tab(page))
        settle(page, 2500)
        intro = page.get_by_text(re.compile(r"^GST payments on Work Orders wait here"))
        w.check("tab", role, "intro says it goes straight to Payment need to paid",
                intro.first.inner_text() if intro.count() else "no intro",
                intro.count() > 0 and "no L1 or CEO" in intro.first.inner_text())
        w.step(page, "approve", "after", role, user, f"The Pending request {big} for ₹{inr(BIG)}. Approve it.",
               click=page.get_by_role("button", name=f"Approve {big}"),
               pins=[pin(intro, "Where an approved request's payment goes.", "info")] if intro.count() else [])
        settle(page, 1500)
        dlg = page.get_by_role("alertdialog")
        note = dlg.get_by_text(re.compile(r"straight to Payment need to paid"))
        w.check("approve", role, "approve dialog says no L1 or CEO", "shown" if note.count() else "not shown", note.count() > 0)
        w.step(page, "approve", "after", role, user, "The approve dialog. Confirm.",
               click=dlg.get_by_role("button", name=re.compile(r"^Approve ₹")),
               pins=[pin(note, "No L1 or CEO approval.", "info")] if note.count() else [])
        settle(page, 3000)
        need1 = tab_count(page, "Payment need to paid")
        r = request_of(big)
        state["big_pay"] = r["req"]["project_payment"]
        w.check("approve", role, f"₹{inr(BIG)} payment is Approved", f"{state['big_pay']} is {r['pay'].get('status')}",
                r["pay"].get("status") == "Approved")
        w.check("approve", role, f"Payment need to paid {need0} → {need0 + 1}", f"{need0} → {need1}", need1 == need0 + 1)
        w.step(page, "approve", "after", role, user, f"Payment need to paid shows {need1} (was {need0}); "
               f"{state['big_pay']} is {r['pay'].get('status')}.",
               pins=[pin(page.get_by_role("button", name=re.compile(r"^Payment need to paid \d+$")), f"{need0} → {need1}",
                         "info")])
        longest = max((len(b["description"] or "") for b in r["bells"]), default=0)
        w.check("bell", "Admins", "for-information note, 140 characters or fewer", f"{len(r['bells'])} notes, longest "
                f"{longest} chars", bool(r["bells"]) and longest <= 140)
        noisy = [b["description"] for b in r["bells"] if "no L1 or CEO" in (b["description"] or "")]
        w.check("bell", "Admins", "the note has no 'Ready to pay: no L1 or CEO' line (#1747)",
                noisy[0][:140] if noisy else "no such line", not noisy)
        w.check("bell", "CEO", "the CEO gets the note too (owner, 2026-11-24)",
                "the CEO got it" if any(b["recipient"] == CEO for b in r["bells"]) else "nothing",
                any(b["recipient"] == CEO for b in r["bells"]))
        page.get_by_role("button", name=re.compile(r"^Payment need to paid \d+$")).first.click()
        page.wait_for_timeout(700)
        sum1 = approved_count(page)
        w.check("summary", role, f"Approved But not Paid {sum0} → {(sum0 or 0) + 1} at first view", f"{sum0} → {sum1} at 0.7 s",
                sum0 is not None and sum1 == sum0 + 1)
        w.step(page, "summary", "after", role, user, f"Back on Payment need to paid at once: Approved But not Paid shows "
               f"{sum1} (was {sum0}).", pins=[pin(page.get_by_text(re.compile(r"^Approved But not Paid")), f"{sum0} → {sum1}",
                                                   "info")])
    keep()


def errors() -> None:
    role = "Accountant"
    user = state["users"][role]
    wo = state["wo"]
    with fw.session(user) as page:
        open_payments(page)
        page.get_by_role("button", name=re.compile(r"^Payment need to paid \d+$")).first.click()
        settle(page, 2500)
        row = page.locator("tbody tr").filter(has_text=wo).filter(has_text=inr(BIG)).first
        w.step(page, "errors", "after", role, user, "Mark as Paid on the approved GST payment.",
               click=row.get_by_role("button", name=re.compile("Mark as Paid")))
        settle(page, 1000)
        w.step(page, "errors", "after", role, user, "Confirm: it moves to Reconciliation Pending, where the UTR goes.",
               click=page.get_by_role("button", name="Yes, mark as Paid"))
        settle(page, 2500)
        w.step(page, "errors", "after", role, user, "Open Payment Done / Reconciliation Pending.",
               click=page.get_by_role("button", name=re.compile(r"^Payment Done . Reconciliation Pending \d+$")))
        settle(page, 3000)
        rrow = page.locator("tbody tr").filter(has_text=wo).filter(has=page.get_by_role("button", name="Mark Reconciled")).first
        w.step(page, "errors", "after", role, user, "Mark Reconciled on that payment.",
               click=rrow.get_by_role("button", name="Mark Reconciled"))
        settle(page, 1500)
        receipt = fw.out / "receipt.png"
        from PIL import Image, ImageDraw
        img = Image.new("RGB", (600, 300), "white")
        ImageDraw.Draw(img).text((20, 20), "Feature walk fixture receipt, not a real bank receipt", fill="black")
        img.save(receipt)
        page.get_by_role("alertdialog").locator("input[type=file]").first.set_input_files(str(receipt))
        page.locator("#utr").wait_for(timeout=60_000)
        page.wait_for_timeout(1000)
        page.locator("#utr").fill(state["utr"])
        page.locator("#payDate").fill(datetime.date.today().isoformat())
        w.step(page, "errors", "after", role, user, f"UTR {state['utr']} is already on {state['utr_on']}. Confirm Payment.",
               click=page.get_by_role("button", name="Confirm Payment"))
        page.wait_for_timeout(2500)
        good = "already recorded on payment" in page.locator("body").inner_text()
        w.check("errors", role, "the toast gives the server's reason", "server's reason" if good else "no reason", good)
        err = page.get_by_text(re.compile(r"already recorded on payment")).first
        w.step(page, "errors", "after", role, user, "The refusal as the Accountant sees it.",
               pins=[pin(err, "The server's own reason.", "info")] if err.count() else [])
        page.keyboard.press("Escape")


def lead_and_reject() -> None:
    role = "Accountant Lead"
    user = state["users"][role]
    with fw.session(user) as page:
        open_payments(page)
        w.step(page, "lead", "after", role, user, "GST Requests as the Accountant Lead.", click=gst_tab(page))
        settle(page, 2500)
        w.step(page, "lead", "after", role, user, f"Approve {state['lead']} for ₹{inr(LEAD)}.",
               click=page.get_by_role("button", name=f"Approve {state['lead']}"))
        settle(page, 1200)
        page.get_by_role("alertdialog").get_by_role("button", name=re.compile(r"^Approve ₹")).click()
        settle(page, 3000)
        p = request_of(state["lead"])["pay"]
        w.check("lead", role, f"₹{inr(LEAD)} payment is Approved", f"{p.get('status')}", p.get("status") == "Approved")
        w.check("lead", role, "both approval dates stamped, not auto_approved", f"approval {p.get('approval_date')}, CEO "
                f"{p.get('ceo_approval_date')}, auto {p.get('auto_approved')}",
                bool(p.get("approval_date")) and bool(p.get("ceo_approval_date")) and str(p.get("auto_approved")) == "0")
        left0 = gst_left("before_reject")
        w.step(page, "reject", "after", role, user, f"Reject {state['rej']} for ₹{inr(REJ)}.",
               click=page.get_by_role("button", name=f"Reject {state['rej']}"))
        settle(page, 1200)
        dlg = page.get_by_role("alertdialog")
        rej = dlg.get_by_role("button", name="Reject", exact=True)
        off = rej.is_disabled()
        w.check("reject", role, "Reject is disabled with no reason", "disabled" if off else "enabled", off)
        w.step(page, "reject", "after", role, user, "With no reason, Reject is greyed out.",
               pins=[pin(rej, "Disabled until a reason is typed." if off else "Enabled with no reason.",
                         "info" if off else "must")])
        dlg.locator("#gst-reject-reason").fill("Feature walk: amount does not match the GST invoice.")
        w.step(page, "reject", "after", role, user, "A reason typed. Reject.", click=rej)
        settle(page, 2500)
        left1 = gst_left("after_reject")
        w.check("reject", role, f"GST left goes up by ₹{inr(REJ)}", f"₹{left0:,.2f} → ₹{left1:,.2f}", round(left1 - left0, 2) == REJ)


def tab() -> None:
    role = "Accountant Lead"
    user = state["users"][role]
    with fw.session(user) as page:
        open_payments(page)
        gst_tab(page).first.click()
        settle(page, 2500)
        for pill in ("Pending", "Approved", "All"):
            page.get_by_role("tab", name=pill, exact=True).click()
            settle(page, 2000)
            heads = [h.strip() for h in page.locator("thead th").all_inner_texts()]
            has_rev, has_act = "Reviewed" in heads, "Actions" in heads
            want_rev, want_act = pill != "Pending", pill != "Approved"
            w.check("tab", role, f"{pill}: Reviewed {'shown' if want_rev else 'hidden'}, Actions {'shown' if want_act else 'hidden'}",
                    f"Reviewed {'shown' if has_rev else 'hidden'}, Actions {'shown' if has_act else 'hidden'}",
                    (has_rev, has_act) == (want_rev, want_act))
            if pill in ("All", "Approved") and has_rev:
                # #1747: Reviewed keeps its width across pills, and IDs never break mid-word.
                rev_w = round(page.locator("thead th").filter(has_text=re.compile(r"^\s*Reviewed\s*$")).bounding_box()["width"])
                col = heads.index("Reviewed") + 1
                rev_broken = page.locator(f"tbody tr td:nth-child({col}) span.break-words").evaluate_all(BROKEN)
                wo_broken = page.locator("tbody tr a[href*='/service-requests/']").evaluate_all(BROKEN)
                pay_broken = page.locator("tbody tr span.font-mono").evaluate_all(BROKEN)
                w.check("tab", role, f"{pill}: Reviewed at least 155px, no reviewer name broken mid-word",
                        f"{rev_w}px, {rev_broken} broken", rev_w >= 155 and rev_broken == 0)
                w.check("tab", role, f"{pill}: every Work Order ID and payment ID on one line",
                        f"Work Order broken {wo_broken}, payment ID broken {pay_broken}", wo_broken == 0 and pay_broken == 0)
            pins = [pin(page.locator("thead th").filter(has_text=re.compile(r"^\s*Reviewed\s*$")), "Who decided it, and when.", "info")] \
                if pill == "All" and has_rev else []
            w.step(page, "tab", "after", role, user, f"GST Requests › {pill}. Columns: {', '.join(h for h in heads if h)}.",
                   pins=pins)
        vend = page.locator("tbody tr").first.locator("td").nth(2).get_by_text(re.compile(r"\w")).first
        w.step(page, "tab", "after", role, user, "Open the vendor card from the vendor name.", click=vend)
        settle(page, 1200)
        card = page.locator("[data-radix-popper-content-wrapper]").first
        w.check("tab", role, "the vendor name opens the vendor card", "opened" if card.count() else "nothing", card.count() > 0)
        w.step(page, "tab", "after", role, user, "The vendor card.", pins=[pin(card, "Vendor card", "info")] if card.count() else [])
        page.keyboard.press("Escape")
        with page.expect_download(timeout=60_000) as d:
            page.get_by_role("button", name="Export").first.click()
            settle(page, 800)
            csv_btn = page.get_by_role("menuitem", name=re.compile("CSV", re.I))
            if csv_btn.count():
                csv_btn.first.click()
        head = Path(d.value.path()).read_text(encoding="utf-8-sig", errors="replace").splitlines()[:1]
        w.check("tab", role, "CSV has a Reviewed column", head[0][:160] if head else "empty", bool(head) and "Reviewed" in head[0])


def over_limit() -> None:
    role = "Procurement Lead"
    user = state["users"][role]
    left = gst_left("over")
    with fw.session(user) as page:
        open_wo(page, role, user, record=False)
        too_much = int(left) + 5_000
        custom_input(page).fill(str(too_much))
        settle(page, 1500)
        send = page.get_by_role("button", name="Send to Accountant")
        warn = page.get_by_text(re.compile(r"^Request exceeds"))
        blocked = send.count() > 0 and send.first.is_disabled()
        w.check("reject", role, f"₹{inr(too_much)} over ₹{left:,.2f} GST left is blocked",
                "Send is disabled" if blocked else "Send is enabled", blocked)
        w.step(page, "reject", "after", role, user, f"Asking ₹{inr(too_much)} when ₹{left:,.2f} GST is left.",
               pins=[pin(send, "Send to Accountant stays disabled." if blocked else "Send is enabled.",
                         "info" if blocked else "must")] + ([pin(warn, "The reason shown.", "info")] if warn.count() else []))


def queues() -> None:
    wo = state["wo"]
    for role, label in (("Admin (L1)", "Payment Pending Approval"), ("CEO", "Payment Pending CEO Approval")):
        user = state["users"][role]
        with fw.session(user) as page:
            open_payments(page)
            w.step(page, "approve", "after", role, user, f"{label} as {role}.",
                   click=page.get_by_role("button", name=re.compile(rf"^{label} \d+$")))
            settle(page, 2500)
            page.get_by_placeholder(re.compile("Search", re.I)).first.fill(wo)
            settle(page, 2500)
            rows = page.locator("tbody tr").filter(has_text=wo)
            texts = rows.all_inner_texts()
            gst_big = [t for t in texts if "GST" in t and inr(BIG) in t]
            w.check("approve", role, f"the ₹{inr(BIG)} GST payment is not in the {label} queue",
                    "in the queue" if gst_big else "not in the queue", not gst_big)
            if role == "Admin (L1)":
                base = [t for t in texts if "GST" not in t and inr(BASE) in t]
                w.check("base", role, f"the ₹{inr(BASE)} base payment is in L1's queue", "in the queue" if base else
                        "not in the queue", bool(base))
                w.step(page, "base", "after", role, user, f"L1's queue for {wo}.",
                       pins=[pin(rows.filter(has_text=inr(BASE)).first, "The base payment still waits for L1.", "info")]
                       if base else [])
            else:
                w.step(page, "approve", "after", role, user, f"The CEO's queue for {wo}: {len(texts)} rows.")
                sidebar(page, "Notifications")
                settle(page, 2500)
                note = page.get_by_text(re.compile(rf"GST payment {state['big_pay']} approved by")).first
                w.step(page, "bell", "after", role, user, "The CEO's notifications.",
                       pins=[pin(note, "The CEO gets the admins' for-information note (owner, 2026-11-24).", "info")]
                       if note.count() else [])


fw.run([("approve", setup), ("approve", raise_big), ("approve", approve), ("errors", errors),
        ("lead", lead_and_reject), ("tab", tab), ("reject", over_limit), ("approve", queues)])
fw.finish()
