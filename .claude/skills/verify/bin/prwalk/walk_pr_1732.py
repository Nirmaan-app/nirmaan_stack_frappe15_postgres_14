"""Walk PR #1732 (Audit View, Vendor Payments sub-tabs, Vendor Cheques tab, PMO cheque view) on its env and its base env.
The worked example for a PR walk page: copy it for the next PR and change the users, claims and steps.

    python3 -I walk_pr_1732.py <out dir>     # from the checkout root, with envs pr-1732 and pr-1732-base served
"""

from __future__ import annotations

import re
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from drive import session  # noqa: E402
from record import Walk, inr, pin  # noqa: E402

AFTER, BEFORE = "pr-1732", "pr-1732-base"
PW = "WalkPw-1732"
VENDOR = "VEN-Material-0241"
USERS = {
    "Admin": "admins@nirmaan.app",
    "Accountant": "swathi@nirmaan.app",
    "Accountant Lead": "deepa@nirmaan.app",
    "Procurement Lead": "sowmya@nirmaan.app",
    "PMO": "deven@nirmaan.app",
}
CLAIM_GROUPS = {"Paid": 23, "Cheque Pending": 1, "Other Pending Payments": 3}

out = Path(sys.argv[1])
w = Walk(out, pr={"number": 1732, "title": "Audit view + vendors payments and cheques tabs and tables modifield",
                  "url": "https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/pull/1732",
                  "author": "madhubalan17js", "head": "249d86b2f", "base": "42313959a"},
         envs={"after": AFTER, "before": BEFORE},
         data_note="a test copy of the production backup of 2026-11-17")
w.change("audit", "Reports › Audit View",
         "A new Audit View report for Admin, Accountant and Accountant Lead: pick dates, then Orders, Invoices or "
         "Payments. Net Paid = Amount Paid + TDS.")
w.change("payments", "Vendor › Payments sub-tabs",
         "One mixed table becomes three sub-tabs: Paid, Cheque Pending, Other Pending Payments. The PR's walk saw "
         "Paid 23 / Cheque Pending 1 / Other 3 for MARUTHI AIRCON.")
w.change("cheques", "Vendor › Cheques tab",
         "A new Cheques tab on the vendor page: the Cheque Tracker narrowed to this vendor. Accountants can Edit and "
         "Cancel; Procurement and PMO can only view.")
w.change("pmo", "PMO may view cheques",
         "The cheque read endpoints now let PMO in (view only). Saving and cancelling are unchanged.")


def base_of(page) -> str:
    return re.match(r"(https?://[^/]+)", page.url).group(1)


def settle(page, ms: int = 1500) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def rupees(s: str) -> int:
    return int(s.replace(",", ""))


def tab_counts(page) -> dict:
    counts = {}
    for t in page.get_by_role("tab").all_inner_texts():
        m = re.match(r"\s*(.+?)\s+(\d+)\s*$", t.replace("\n", " "))
        if m:
            counts[m.group(1).strip()] = int(m.group(2))
    return counts


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
                w.status(cid, "failed", f"walk stopped: {type(e).__name__}: {str(e).splitlines()[0][:160]}")


def open_vendor(page, tab_label: str) -> None:
    page.goto(f"{base_of(page)}/vendors/{VENDOR}?tab=overview")
    settle(page)


def audit_admin() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(AFTER, user, PW) as (page, _):
        menu = page.locator('[data-sidebar="menu-button"]').get_by_text("Reports", exact=True)
        w.step(page, "audit", "after", role, user, "Open Reports from the sidebar.", click=menu)
        settle(page)
        w.step(page, "audit", "after", role, user, "Open the new Audit View tab.",
               click=page.get_by_role("button", name="Audit View", exact=True))
        settle(page)
        date = page.get_by_role("button", name="ALL", exact=True)
        w.step(page, "audit", "after", role, user, "Step 1 asks for a date range. Open the date box.", click=date,
               pins=[pin(date, "The date box already says ALL, which reads as a range that is picked. Yet the tabs "
                               "stay locked and the page says to pick a range.", "should")])
        settle(page, 600)
        w.step(page, "audit", "after", role, user, "Pick a preset. This walk uses FY 26-27.",
               click=page.get_by_role("button", name="FY 26-27", exact=True))
        settle(page, 800)
        apply = page.get_by_role("button", name="Apply", exact=True)
        if apply.count() and apply.first.is_visible():
            if apply.first.is_enabled():
                apply.first.click()
            else:
                page.keyboard.press("Escape")
        settle(page)

        page.get_by_role("tab", name="Orders").first.click()
        settle(page)
        pins = []
        for row in page.locator("tbody tr").all()[:50]:
            cells = [c.strip() for c in row.locator("td").all_inner_texts()]
            nums = [c for c in cells if re.fullmatch(r"₹[\d,]+", c)]
            if len(nums) >= 4:
                incl, invoiced = rupees(nums[-2][1:]), rupees(nums[-1][1:])
                if invoiced > incl:
                    pins.append(pin(row, f"Total Invoiced ₹{inr(invoiced)} is more than the order's ₹{inr(incl)} incl. GST "
                                         f"(by ₹{inr(invoiced - incl)}). Likely rounding, but it reads as over-invoiced.",
                                    "nit" if invoiced - incl <= 1 else "should"))
                    break
        w.step(page, "audit", "after", role, user, "Orders: POs and WOs by created date, with value and amount invoiced.",
               pins=pins)

        page.get_by_role("tab", name="Invoices").first.click()
        settle(page)
        w.step(page, "audit", "after", role, user, "Invoices: approved vendor invoices and paid expenses, by invoice date.")

        page.get_by_role("tab", name="Payments").first.click()
        settle(page)
        body = page.locator("body").inner_text()
        m = re.search(r"AMOUNT PAID\s*₹([\d,]+)[\s+]*TDS\s*₹([\d,]+)[\s=]*NET PAID\s*₹([\d,]+)", body)
        pins = []
        if m:
            paid, tds, net = (rupees(g) for g in m.groups())
            ok = w.check("audit", role, "Net Paid = Amount Paid + TDS", f"₹{inr(paid)} + ₹{inr(tds)} = ₹{inr(paid + tds)}; "
                         f"page shows ₹{inr(net)}", paid + tds == net, kind="nit")
            if not ok:
                pins.append(pin(page.get_by_text(f"₹{m.group(3)}", exact=True),
                                f"Net Paid shows ₹{inr(net)}, but ₹{inr(paid)} + ₹{inr(tds)} = ₹{inr(paid + tds)}. "
                                f"Off by ₹{inr(abs(net - paid - tds))}, likely paise rounded per row.", "nit"))
        exp = page.locator("tbody tr").filter(has_text="Project Expense").first
        if exp.count():
            code = exp.locator("td").nth(1).inner_text().strip()
            pins.append(pin(exp.locator("td").nth(1), f"A Project Expense row shows its internal code ({code}). A "
                                                       "reader cannot tell which expense it is from this.", "nit"))
        w.step(page, "audit", "after", role, user, "Payments: paid project payments and paid expenses, by payment date.",
               pins=pins)
        w.step(page, "audit", "after", role, user, "Show details opens the three totals side by side.",
               click=page.get_by_role("button", name="Show details"))
        settle(page)
        w.step(page, "audit", "after", role, user, "The details strip: Orders, Invoices and Payments for the range.")


def audit_roles() -> None:
    for role in ("Accountant", "Accountant Lead", "Procurement Lead", "PMO"):
        user = USERS[role]
        expect = role in ("Accountant", "Accountant Lead")
        with session(AFTER, user, PW) as (page, _):
            page.goto(f"{base_of(page)}/reports")
            settle(page, 2500)
            has = page.get_by_role("button", name="Audit View", exact=True).count() > 0
            w.check("audit", role, "sees Audit View" if expect else "does not see Audit View",
                    "sees it" if has else "does not see it", has == expect)
            tabs = page.get_by_role("button", name="Audit View", exact=True)
            w.step(page, "audit", "after", role, user,
                   f"Reports as {role}: Audit View is {'there' if has else 'not there'}.",
                   pins=[pin(tabs, "Audit View tab", "info")] if has else [])


def audit_before() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(BEFORE, user, PW) as (page, _):
        page.goto(f"{base_of(page)}/reports")
        settle(page, 2500)
        w.step(page, "audit", "before", role, user, "Before this PR: Reports has no Audit View tab.")


def payments_after() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(AFTER, user, PW) as (page, _):
        open_vendor(page, "Payments")
        w.step(page, "payments", "after", role, user, "Open the vendor, then its Payments tab.",
               click=page.get_by_role("button", name="Payments", exact=True))
        settle(page, 2500)
        counts = tab_counts(page)
        ok = w.check("payments", role, "Paid 23 / Cheque Pending 1 / Other 3 (the PR's walk)",
                     " / ".join(f"{k} {v}" for k, v in counts.items()) or "no counts read",
                     all(counts.get(k) == v for k, v in CLAIM_GROUPS.items()))
        w.step(page, "payments", "after", role, user, "Paid: only bank-confirmed payments, newest first, with a total.",
               pins=[] if ok else [pin(page.get_by_role("tablist").first, f"Counts differ from the PR: {counts}",
                                       "should")])
        clip = page.locator("tbody tr").filter(has_text="CLG/").first.locator("button, svg").first
        if clip.count():
            w.step(page, "payments", "after", role, user, "The paperclip next to a UTR opens the receipt upload.",
                   click=clip)
            settle(page)
            w.step(page, "payments", "after", role, user, "The receipt dialog.")
            page.keyboard.press("Escape")
            settle(page, 600)
        w.step(page, "payments", "after", role, user, "Open Cheque Pending.",
               click=page.get_by_role("tab", name=re.compile("Cheque Pending")))
        settle(page)
        w.step(page, "payments", "after", role, user, "Cheque Pending: a cheque that is issued but not cleared yet.",
               click=page.get_by_role("tab", name=re.compile("Other Pending")))
        settle(page)
        sr = page.get_by_text(re.compile(r"^SR-\d")).first
        w.step(page, "payments", "after", role, user, "Other Pending Payments: everything still in progress.",
               pins=[pin(sr.locator(".."), "This service request is now labelled (WO). Before this PR it said (SR). "
                                           "Probably the new name for service orders; confirm it is meant.",
                         "info", "guess")] if sr.count() else [])


def payments_roles() -> None:
    for role in ("Accountant", "Procurement Lead", "PMO"):
        user = USERS[role]
        with session(AFTER, user, PW) as (page, _):
            page.goto(f"{base_of(page)}/vendors/{VENDOR}?tab=vendorPayments")
            settle(page, 3000)
            counts = tab_counts(page)
            w.check("payments", role, "Paid 23 / Cheque Pending 1 / Other 3",
                    " / ".join(f"{k} {v}" for k, v in counts.items()) or "no counts read",
                    all(counts.get(k) == v for k, v in CLAIM_GROUPS.items()))
            w.step(page, "payments", "after", role, user, f"Payments as {role}.")


def payments_before() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(BEFORE, user, PW) as (page, _):
        page.goto(f"{base_of(page)}/vendors/{VENDOR}?tab=vendorPayments")
        settle(page, 3000)
        w.step(page, "payments", "before", role, user,
               "Before this PR: one table with Paid, CEO Pending and cheque rows mixed. No Cheques tab.",
               pins=[pin(page.get_by_role("columnheader", name=re.compile("Status")), "Status was the only way to tell "
                                                                                     "rows apart.", "info")])
        w.step(page, "cheques", "before", role, user, "Before this PR: the vendor page has no Cheques tab.")


def cheques_roles() -> None:
    expect_edit = {"Admin": None, "Accountant": True, "Accountant Lead": True, "Procurement Lead": False, "PMO": False}
    for role in ("Accountant", "Accountant Lead", "Procurement Lead", "PMO", "Admin"):
        user = USERS[role]
        with session(AFTER, user, PW) as (page, _):
            open_vendor(page, "Cheques")
            tab = page.get_by_role("button", name="Cheques", exact=True)
            if not tab.count():
                w.check("cheques", role, "sees the Cheques tab", "no Cheques tab", False)
                w.step(page, "cheques", "after", role, user, f"Vendor page as {role}: no Cheques tab.")
                continue
            tab.click()
            settle(page, 2500)
            actions = sorted({t.strip() for t in page.locator("tbody").get_by_role("button").all_inner_texts()
                              if t.strip()} | {a for a in (page.locator("tbody button[aria-label]").evaluate_all(
                                  "els => els.map(e => e.getAttribute('aria-label'))")) if a})
            can_change = any(re.search(r"edit|cancel", a, re.I) for a in actions)
            want = expect_edit[role]
            if want is not None:
                w.check("cheques", role, "Edit and Cancel" if want else "view only",
                        ", ".join(actions) or "no row actions", can_change == want)
            pins = []
            hdr = page.get_by_role("columnheader", name=re.compile(r"Cheque.Payment"))
            if role == "Accountant" and hdr.count():
                pins.append(pin(hdr, "The Issue Date filter icon sits on top of the words 'Cheque/Payment Date'.",
                                "nit"))
            verbs = sorted({m.group(0).title() for a in actions for m in [re.match(r"(edit|cancel|view)", a, re.I)] if m})
            w.step(page, "cheques", "after", role, user,
                   f"Cheques as {role}. Row actions: {', '.join(verbs) or 'none'}.", pins=pins)


def pmo_tracker() -> None:
    user = USERS["PMO"]
    for side, task in (("before", BEFORE), ("after", AFTER)):
        with session(task, user, PW) as (page, _):
            in_sidebar = page.locator('[data-sidebar="menu-button"]').get_by_text("Cheque Tracker", exact=True).count() > 0
            open_vendor(page, "Cheques")
            tab = page.get_by_role("button", name="Cheques", exact=True)
            if side == "after":
                w.check("pmo", "PMO", "Cheque Tracker stays out of the sidebar",
                        "in the sidebar" if in_sidebar else "not in the sidebar", not in_sidebar)
                w.check("pmo", "PMO", "sees the vendor's Cheques tab", "sees it" if tab.count() else "no tab",
                        tab.count() > 0)
            if side == "before" or not tab.count():
                w.step(page, "pmo", side, "PMO", user, ("Before this PR" if side == "before" else "With this PR") +
                       f": PMO on the vendor page. Cheques tab {'shown' if tab.count() else 'not shown'}.")
                continue
            w.step(page, "pmo", side, "PMO", user, "With this PR: PMO opens the vendor's Cheques tab.", click=tab)
            settle(page, 2500)
            w.step(page, "pmo", side, "PMO", user, "PMO sees the cheques. The row menu offers no Edit or Cancel.")


PLAN = [("audit", audit_admin), ("audit", audit_roles), ("audit", audit_before), ("payments", payments_after),
        ("payments", payments_roles), ("payments", payments_before), ("cheques", cheques_roles), ("pmo", pmo_tracker)]
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
