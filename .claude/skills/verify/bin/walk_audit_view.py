"""Walk Reports › Audit View for each role (graduated from PR #1732's and PR #1736's walks).

    python3 -I .claude/skills/verify/bin/walk_audit_view.py <env> <out dir> [audit_admin | audit_steps | audit_roles ...]

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
NO_RANGE = "Pick a date range"
TYPES = ["Projects Data", "Non Projects Data"]

fw = FeatureWalk("Reports › Audit View", "audit-view.md")
w = fw.w
w.change("audit", "Reports › Audit View",
         "An Audit View report for Admin, Accountant and Accountant Lead: pick dates, then Orders, Invoices or "
         "Payments. Net Paid = Amount Paid + TDS.")
w.change("labels", "Audit View › Report Type names",
         "Report Type offers \"Projects Data\" and \"Non Projects Data\".")
w.change("datebox", "Audit View › date box",
         "The date box reads \"Pick a date range\" until a range is picked, and again after Report Type changes.")
w.change("refresh", "Audit View › refresh",
         "A refresh keeps the report type, the date range (ALL included) and the open tab.")
w.change("cards", "Audit View › summary cards",
         "No \"Show details\". Separate cards above the table; in Projects Data the first is named after the tab and "
         "splits its amount by type, with no percentages.")
w.change("columns", "Audit View › table columns",
         "Type shows the pill with the expense type under it; Against shows an expense's description, not its record "
         "name; on Invoices, Invoice No. is the second column.")

facts = fw.db("facts", r'''
from nirmaan_stack.api.reports.audit_view import get_audit_view_summary
frappe.set_user("Administrator")
pe = frappe.db.sql("""SELECT name, description FROM "tabProject Expenses" WHERE payment_date BETWEEN %s AND %s
    AND COALESCE(description, '') != '' ORDER BY payment_date DESC, name LIMIT 1""", (sys.argv[1], sys.argv[2]),
    as_dict=True)
emit({"summary": get_audit_view_summary("project", sys.argv[1], sys.argv[2]),
      "expense": pe[0] if pe else None,
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


def date_box(page):
    """The Audit View's own date box: it reads "Pick a date range", "ALL", a preset or a range."""
    return page.locator("button").filter(has_text=re.compile(r"^(Pick a date range|ALL|FY \d\d-\d\d|.*\d{4}.*)$")).first


def report_type(page):
    return page.locator("main").get_by_role("combobox").first


def open_tab(page) -> str | None:
    sel = page.locator('[role="tab"][aria-selected="true"]')
    return sel.first.inner_text().split("\n")[0].strip() if sel.count() else None


def first_card(page):
    return page.locator('[role="tabpanel"]').locator("div.rounded-lg.border").first


def pick(page, preset: str) -> None:
    date_box(page).click()
    settle(page, 600)
    page.get_by_role("button", name=preset, exact=True).click()
    settle(page, 800)
    page.keyboard.press("Escape")
    settle(page, 2500)


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
        rt = report_type(page).inner_text().strip()
        w.check("labels", role, f"Report Type shows \"{TYPES[0]}\"", rt, rt == TYPES[0])
        w.step(page, "labels", "after", role, user, f"Report Type reads \"{rt}\". Open it.", click=report_type(page))
        settle(page, 500)
        opts = [o.strip() for o in page.get_by_role("option").all_inner_texts()]
        w.check("labels", role, f"options {' / '.join(TYPES)}", " / ".join(opts), opts == TYPES)
        w.step(page, "labels", "after", role, user, f"Its options: {' / '.join(opts)}.",
               pins=[pin(page.get_by_role("listbox").first, "The two report types.", "info")])
        page.keyboard.press("Escape")
        settle(page, 500)

        box = date_box(page).inner_text().strip()
        w.check("datebox", role, f"before a pick the date box reads \"{NO_RANGE}\"", box, box == NO_RANGE)
        w.step(page, "audit", "after", role, user, f"Step 1 asks for a date range; the box reads \"{box}\". Open it.",
               click=date_box(page))
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
        label = first_card(page).inner_text().split("\n")[0].strip()
        w.check("cards", role, "Orders: the first card is named Orders", label, label.lower() == "orders")
        w.step(page, "audit", "after", role, user,
               f"Orders: POs and WOs by created date. The tabs count {counts}.",
               pins=[pin(page.get_by_role("tablist").first, "Counts for the range", "info")])
        page.get_by_role("tab", name=re.compile("^Invoices")).first.click()
        settle(page)
        heads = [h.strip() for h in page.get_by_role("columnheader").all_inner_texts()]
        w.check("columns", role, "Invoices: Invoice No. is the second column", " | ".join(heads[:3]),
                len(heads) > 1 and heads[1] == "Invoice No.")
        w.step(page, "audit", "after", role, user, "Invoices: approved vendor invoices and paid expenses, by invoice "
               "date. Invoice No. is the second column.",
               pins=[pin(page.get_by_role("columnheader", name="Invoice No.").first, "Second column.", "info")])

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
        card = first_card(page)
        label = card.inner_text().split("\n")[0].strip()
        pct = re.findall(r"\d+(?:\.\d)?%", card.locator("..").inner_text())
        details = page.get_by_role("button", name="Show details").count()
        w.check("cards", role, "Payments: the first card is named Payments", label, label.lower() == "payments")
        w.check("cards", role, "no percentages on the cards", ", ".join(pct) or "none", not pct)
        w.check("cards", role, "no \"Show details\" button", "present" if details else "absent", not details)
        w.step(page, "audit", "after", role, user, "Payments: paid project payments and paid expenses, by payment date. "
               "Amount Paid + TDS = Net Paid.",
               pins=[pin(page.get_by_text(re.compile(r"^NET PAID$")).first.locator(".."), "Net Paid", "info"),
                     pin(card, f"First card \"{label}\": net paid by type.", "info")] if m else [])

        row = page.locator("tbody tr").filter(has_text="Project Expense").first
        typ, against = row.locator("td").nth(0), row.locator("td").nth(1)
        a_txt = against.inner_text().strip()
        w.check("columns", role, "Type: the pill with the expense type under it", typ.inner_text().replace("\n", " / "),
                "\n" in typ.inner_text().strip())
        w.check("columns", role, "Against: an expense's description, not a record name", a_txt[:60],
                not re.fullmatch(r"[a-z0-9]{10}|[A-Z]+-[\w-]*\d+", a_txt))
        w.step(page, "columns", "after", role, user, "Payments table: Type with the expense type under it; Against "
               "with the expense's description.",
               pins=[pin(typ, "Pill + expense type.", "info"), pin(against, "Description.", "info")])

        exp = facts["expense"]
        if exp:
            search = page.get_by_placeholder(re.compile(r"^Search by", re.I)).first
            search.fill(exp["name"])
            settle(page, 1800)
            n = page.locator("tbody tr").filter(has_text=re.compile("₹")).count()
            w.check("columns", role, f"search by ID finds expense {exp['name']}", f"{n} rows", n > 0, kind="should")
            w.step(page, "columns", "after", role, user, f"Search by ID for the expense {exp['name']}: {n} rows.",
                   pins=[] if n else [pin(search, "No rows: an expense is not found by its record name (known since "
                                                  "#1736; a follow-up PR fixes it).", "should")])
            search.fill("")
            settle(page)


def audit_steps() -> None:
    """Report Type switch, refresh with ALL picked, and coming back from another report."""
    role = "Admin"
    user = fw.user(role, facts["users"][role])
    with fw.session(user) as page:
        open_reports(page)
        page.get_by_role("button", name="Audit View", exact=True).click()
        settle(page)
        pick(page, PRESET)
        page.get_by_role("tab", name=re.compile("^Payments")).first.click()
        settle(page, 2500)
        w.step(page, "datebox", "after", role, user, f"{TYPES[0]}, {PRESET}, Payments. Switch Report Type.",
               click=report_type(page))
        page.get_by_role("option", name=TYPES[1], exact=True).click()
        settle(page, 2500)
        box, tab = date_box(page).inner_text().strip(), open_tab(page)
        w.check("datebox", role, f"after a type switch: \"{NO_RANGE}\", no tab open", f"\"{box}\", {tab or 'no tab'}",
                box == NO_RANGE and tab is None)
        w.step(page, "datebox", "after", role, user, f"{TYPES[1]} starts again from step 1: \"{box}\".",
               pins=[pin(date_box(page), "Back to step 1.", "info")])

        pick(page, "ALL")
        page.get_by_role("tab", name=re.compile("^Payments")).first.click()
        settle(page, 2500)
        w.step(page, "refresh", "after", role, user, f"{TYPES[1]}, ALL, Payments. Refresh the page.")
        page.reload()
        settle(page, 4000)
        rt, box, tab = report_type(page).inner_text().strip(), date_box(page).inner_text().strip(), open_tab(page)
        w.check("refresh", role, f"after a refresh: {TYPES[1]}, ALL, Payments open", f"{rt}, {box}, {tab or 'no tab'}",
                (rt, box, tab) == (TYPES[1], "ALL", "Payments"))
        w.step(page, "refresh", "after", role, user, f"After the refresh: {rt}, {box}, {tab or 'no tab'} open.",
               pins=[pin(report_type(page), rt, "info"), pin(date_box(page), box, "info")])

        page.get_by_role("button", name="Projects", exact=True).first.click()
        settle(page, 2000)
        w.step(page, "refresh", "after", role, user, "Open another report, then come back to Audit View.",
               click=page.get_by_role("button", name="Audit View", exact=True))
        settle(page, 3000)
        box, tab = date_box(page).inner_text().strip(), open_tab(page)
        stale = tab is not None and box == "ALL"
        w.check("refresh", role, "coming back from another report asks for the range again",
                f"date box {box}, tab {tab or 'none'}", not stale, kind="should")
        w.step(page, "refresh", "after", role, user, f"Back on Audit View: \"{box}\", {tab or 'no tab'} open.",
               pins=[pin(date_box(page), "Steps 1 and 2 skipped: a leftover audit_range=1 in the URL (known since "
                                         "#1736; a follow-up PR fixes it).", "should")] if stale else [])


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
            if has:
                tab.click()
                settle(page)
                rt, box = report_type(page).inner_text().strip(), date_box(page).inner_text().strip()
                w.check("labels", role, f"Report Type \"{TYPES[0]}\"", rt, rt == TYPES[0])
                w.check("datebox", role, f"date box \"{NO_RANGE}\"", box, box == NO_RANGE)
            w.step(page, "audit", "after", role, user,
                   f"Reports as {role}: Audit View is {'there' if has else 'not there'}.",
                   pins=[pin(tab, "Audit View tab", "info")] if has else [])


fw.run([("audit", audit_admin), ("datebox", audit_steps), ("audit", audit_roles)])
fw.finish()
