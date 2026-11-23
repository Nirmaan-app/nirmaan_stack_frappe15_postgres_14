"""Walk Reports › Audit View for each role (graduated from PR #1732's walk).

    python3 -I .claude/skills/verify/bin/walk_audit_view.py <env> <out dir> [audit_admin | audit_roles ...]

The expected counts and totals for the FY 26-27 preset are read at the start from the report's own summary
endpoint on the env DB (db/facts.txt), so the screen is held to the rows the server selects for that range.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from feature_walk import FeatureWalk, pin, settle, sidebar, sidebar_ready  # noqa: E402

PRESET, FROM, TO = "FY 26-27", "2026-04-01", "2027-03-31"

fw = FeatureWalk("Reports › Audit View", "audit-view.md")
w = fw.w
w.change("audit", "Reports › Audit View",
         "An Audit View report for Admin, Accountant and Accountant Lead: pick dates, then Orders, Invoices or "
         "Payments. Net Paid = Amount Paid + TDS.")

facts = fw.db("facts", r'''
from nirmaan_stack.api.reports.audit_view import get_audit_view_summary
frappe.set_user("Administrator")
emit({"summary": get_audit_view_summary("project", sys.argv[1], sys.argv[2]),
      "users": {"Admin": candidates("Nirmaan Admin Profile"),
                "Accountant": candidates("Nirmaan Accountant Profile"),
                "Accountant Lead": candidates("Nirmaan Accountant Lead Profile"),
                "Procurement Lead": candidates("Nirmaan Procurement Lead Profile"),
                "PMO": candidates("Nirmaan PMO Executive Profile")}})
''', FROM, TO)
SUMMARY = facts["summary"]


def rupees(s: str) -> int:
    return int(s.replace(",", ""))


def tab_counts(page) -> dict:
    counts = {}
    for t in page.get_by_role("tab").all_inner_texts():
        m = re.match(r"\s*(Orders|Invoices|Payments)\s+([\d,]+)\s*$", t.replace("\n", " "))
        if m:
            counts[m.group(1).lower()] = rupees(m.group(2))
    return counts


def open_reports(page) -> None:
    sidebar_ready(page)
    sidebar(page, "Reports")
    settle(page, 2000)


def audit_admin() -> None:
    role = "Admin"
    user = fw.user(role, facts["users"][role])
    with fw.session(user) as page:
        sidebar_ready(page)
        w.step(page, "audit", "after", role, user, "Open Reports from the sidebar.",
               click=page.locator('[data-sidebar="menu-button"]').get_by_text("Reports", exact=True))
        settle(page)
        w.step(page, "audit", "after", role, user, "Open the Audit View tab.",
               click=page.get_by_role("button", name="Audit View", exact=True))
        settle(page)
        w.step(page, "audit", "after", role, user, "Step 1 asks for a date range. Open the date box.",
               click=page.get_by_role("button", name="ALL", exact=True))
        settle(page, 600)
        w.step(page, "audit", "after", role, user, f"Pick the {PRESET} preset.",
               click=page.get_by_role("button", name=PRESET, exact=True))
        settle(page, 800)
        page.keyboard.press("Escape")
        settle(page, 2500)

        counts = tab_counts(page)
        want = {k: SUMMARY[k]["count"] for k in ("orders", "invoices", "payments")}
        w.check("audit", role, f"tab counts = the server's rows for {PRESET} {want}", str(counts), counts == want)
        page.get_by_role("tab", name=re.compile("^Orders")).first.click()
        settle(page)
        w.step(page, "audit", "after", role, user,
               f"Orders: POs and WOs by created date. The tabs count {counts}.",
               pins=[pin(page.get_by_role("tablist").first, "Counts for the range", "info")])
        page.get_by_role("tab", name=re.compile("^Invoices")).first.click()
        settle(page)
        w.step(page, "audit", "after", role, user, "Invoices: approved vendor invoices and paid expenses, by invoice date.")

        page.get_by_role("tab", name=re.compile("^Payments")).first.click()
        settle(page)
        body = page.locator("body").inner_text()
        m = re.search(r"AMOUNT PAID\s*₹([\d,]+)[\s+]*TDS\s*₹([\d,]+)[\s=]*NET PAID\s*₹([\d,]+)", body)
        paid, tds, net = (rupees(g) for g in m.groups()) if m else (None, None, None)
        want = SUMMARY["payments"]
        shown = {"amount_paid": paid, "tds": tds, "net_paid": net}
        w.check("audit", role, "Amount Paid, TDS and Net Paid = the server's, to the rupee "
                + ", ".join(f"{k} ₹{v:,.2f}" for k, v in want.items() if k in shown), str(shown),
                m is not None and all(abs(shown[k] - want[k]) <= 1 for k in shown))
        w.check("audit", role, "Net Paid = Amount Paid + TDS (in paise; the screen rounds each figure on its own)",
                f"₹{want['amount_paid']:,.2f} + ₹{want['tds']:,.2f} = ₹{want['net_paid']:,.2f}",
                abs(want["amount_paid"] + want["tds"] - want["net_paid"]) < 0.01)
        w.step(page, "audit", "after", role, user, "Payments: paid project payments and paid expenses, by payment date. "
               "Amount Paid + TDS = Net Paid.",
               pins=[pin(page.get_by_text(re.compile(r"^NET PAID$")).first.locator(".."), "Net Paid", "info")]
               if m else [])


def audit_roles() -> None:
    for role in ("Accountant", "Accountant Lead", "Procurement Lead", "PMO"):
        expect = role in ("Accountant", "Accountant Lead")
        user = fw.user(role, facts["users"][role])
        with fw.session(user) as page:
            open_reports(page)
            tab = page.get_by_role("button", name="Audit View", exact=True)
            has = tab.count() > 0
            w.check("audit", role, "sees Audit View" if expect else "does not see Audit View",
                    "sees it" if has else "does not see it", has == expect)
            w.step(page, "audit", "after", role, user,
                   f"Reports as {role}: Audit View is {'there' if has else 'not there'}.",
                   pins=[pin(tab, "Audit View tab", "info")] if has else [])


fw.run([("audit", audit_admin), ("audit", audit_roles)])
fw.finish()
