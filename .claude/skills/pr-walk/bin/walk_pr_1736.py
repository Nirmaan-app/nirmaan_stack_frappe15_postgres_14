"""Walk PR #1736 (Audit View follow-ups, Material Usage ITM docs, MSME on Update, Cheque Tracker header) on its env
and its base env.

    python3 -I walk_pr_1736.py <out dir> [fn ...]   # from the checkout root, with envs pr-1736 and pr-1736-base served
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
from drive import session  # noqa: E402
from record import Walk, inr, pin  # noqa: E402

DEVENV = "/Users/abhishek/work/nirmaan/deploy_setup/frappe_docker/development/devenv.sh"
AFTER, BEFORE = "pr-1736", "pr-1736-base"
PW = "WalkPw-1736"
USERS = {
    "Admin": "admins@nirmaan.app",
    "Accountant": "swathi@nirmaan.app",
    "Accountant Lead": "deepa@nirmaan.app",
    "Procurement Executive": "smounika1107@gmail.com",
}
FY = "FY 26-27"

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
w = Walk(out, pr={"number": 1736, "title": "Fix/vendor wo audit view review",
                  "url": "https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/pull/1736",
                  "author": "madhubalan17js", "head": "e65cc94c0", "base": "de49cf3c0"},
         envs={"after": AFTER, "before": BEFORE},
         data_note="a test copy of the production backup of 2026-11-17")
w.change("labels", "Audit View › Report Type names",
         "Report Type reads \"Projects Data\" / \"Non Projects Data\". Only the labels change; the values stay, so "
         "saved links keep working.")
w.change("datebox", "Audit View › date box",
         "The date box reads \"Pick a date range\" until a range is chosen, not \"ALL\" while the tabs are locked. "
         "Switching Report Type starts again from the date range.")
w.change("refresh", "Audit View › refresh",
         "A refresh keeps the report type, the date range and the open tab.")
w.change("cards", "Audit View › summary cards",
         "\"Show details\" and its cards are gone. The summary above the table is separate cards; the first is "
         "named after the tab and shows each type's amount. No count badges, bars or percentages.")
w.change("columns", "Audit View › table columns",
         "Type = PO / WO / Project Expense (plus the expense type). Against = the PO/WO number or the expense "
         "description, not an internal code. On Invoices, Invoice No. is the second column.")
w.change("reimb", "Audit View › Reimbursement type",
         "A non-project expense with no type but a reimbursement link shows \"Reimbursement\".")
w.change("mu_itm", "Material Usage › DC Wise / MIR Wise list ITMs",
         "DC Wise and MIR Wise list ITM documents as well as POs: a new Type column (PO / ITM, filterable), "
         "\"PO Number\" renamed \"PO/ITM No.\", and DN Qty per ITM.")
w.change("mu_source", "Material Usage › ITM from a warehouse",
         "A warehouse ITM reads \"From Warehouse\" instead of \"-\".")
w.change("msme", "Vendors › MSME certificate on Update only",
         "The MSME certificate is attached to the vendor only on Update, so Cancel no longer leaves the file on the "
         "vendor.")
w.change("cheque", "Cheque Tracker › date header",
         "The \"Cheque/Payment Date\" header no longer runs under the next column (width 160, two-line header).")


# ------------------------------------------------------------------------------------------------ helpers

def base_of(page) -> str:
    return re.match(r"(https?://[^/]+)", page.url).group(1)


def settle(page, ms: int = 1500) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def db(task: str, name: str, code: str, *args: str) -> str:
    """Run a Python snippet on the env DB (devenv script) and keep it and its output beside the screenshots."""
    src = out / "db" / f"{name}.py"
    src.parent.mkdir(exist_ok=True)
    src.write_text("import json, sys\nimport frappe\n" + code)
    res = subprocess.run([DEVENV, "script", task, str(src), *args], capture_output=True, text=True, timeout=300)
    (out / "db" / f"{name}.txt").write_text(res.stdout + res.stderr)
    return res.stdout


def db_json(task: str, name: str, code: str, *args: str) -> dict:
    line = next(l for l in db(task, name, code, *args).splitlines() if l.startswith("JSON "))
    return json.loads(line[5:])


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


def date_box(page):
    return page.locator("button").filter(has_text=re.compile(r"^(Pick a date range|ALL|FY \d\d-\d\d|.*\d{4}.*)$")).first


def report_type(page):
    return page.get_by_role("combobox").first


def open_audit(page, role: str, user: str, side: str, cid: str) -> None:
    menu = page.locator('[data-sidebar="menu-button"]').get_by_text("Reports", exact=True)
    w.step(page, cid, side, role, user, "Open Reports from the sidebar.", click=menu)
    settle(page)
    w.step(page, cid, side, role, user, "Open the Audit View tab.",
           click=page.get_by_role("button", name="Audit View", exact=True))
    settle(page, 2000)


def pick_preset(page, name: str) -> None:
    date_box(page).click()
    settle(page, 600)
    page.get_by_role("button", name=name, exact=True).click()
    settle(page, 600)
    page.keyboard.press("Escape")
    settle(page)


def choose_type(page, label: str) -> None:
    report_type(page).click()
    settle(page, 500)
    page.get_by_role("option", name=label, exact=True).click()
    settle(page, 2000)


def open_tab_name(page) -> str | None:
    sel = page.locator('[role="tab"][aria-selected="true"]')
    return sel.first.inner_text().split("\n")[0].strip() if sel.count() else None


# ------------------------------------------------------------------------------------------------ facts

FACTS = r'''
P_DC, P_MIR = "THRISSUR-PROJ-00105", "KANCHIPURAM-PROJ-00107"
def itm_docs(p, kind):
    return frappe.db.sql("""SELECT p.parent_docname itm, itm.source_type, COUNT(*) n FROM "tabPO Delivery Documents" p
        JOIN "tabInternal Transfer Memo" itm ON itm.name = p.parent_docname
        WHERE p.parent_doctype = 'Internal Transfer Memo' AND p.project = %s AND p.type = %s
        GROUP BY 1, 2 ORDER BY 1""", (p, kind), as_dict=1)
def dn_per_doc(itm, kind):
    """Each DC / MIR of the ITM: the ITM's received qty summed over that document's own items (its DN Qty)."""
    rows = frappe.db.sql("""SELECT p.name, COALESCE(SUM(r.recv), 0) dn FROM "tabPO Delivery Documents" p
        JOIN "tabDC Item" d ON d.parent = p.name
        LEFT JOIN (SELECT item_id, SUM(received_quantity) recv FROM "tabInternal Transfer Memo Item" WHERE parent = %s
                   GROUP BY item_id) r ON r.item_id = d.item_id
        WHERE p.parent_docname = %s AND p.type = %s GROUP BY p.name ORDER BY p.name""", (itm, itm, kind), as_dict=1)
    return sorted(round(float(r.dn), 3) for r in rows)
dc, mir = itm_docs(P_DC, "Delivery Challan"), itm_docs(P_MIR, "Material Inspection Report")
wh_dc = next(r for r in dc if r.source_type == "Warehouse")
wh_mir = next(r for r in mir if r.source_type == "Warehouse")
# A paid Project Expense of FY 26-27, by name, to search for on the Audit View.
pe = frappe.db.sql("""SELECT name, description FROM "tabProject Expenses" WHERE payment_date BETWEEN '2026-04-01' AND '2027-03-31'
    AND COALESCE(description, '') != '' ORDER BY payment_date DESC, name LIMIT 1""", as_dict=1)[0]
reimb = frappe.db.sql("""SELECT COUNT(*) FROM "tabNon Project Expenses" WHERE COALESCE(type, '') = ''
    AND COALESCE(reimbursement, '') != ''""")[0][0]
# A vendor still in the starting state for the MSME walk: no MSME fields, no file attached to it.
ven = frappe.db.sql("""SELECT v.name, v.vendor_name FROM "tabVendors" v WHERE v.vendor_type = 'Material'
    AND COALESCE(v.msme_id, '') = '' AND COALESCE(v.msme_attachment, '') = ''
    AND NOT EXISTS (SELECT 1 FROM "tabFile" f WHERE f.attached_to_doctype = 'Vendors' AND f.attached_to_name = v.name)
    ORDER BY v.creation DESC LIMIT 1""", as_dict=1)[0]
print("JSON " + json.dumps({
    "p_dc": P_DC, "p_dc_name": frappe.db.get_value("Projects", P_DC, "project_name"),
    "p_mir": P_MIR, "p_mir_name": frappe.db.get_value("Projects", P_MIR, "project_name"),
    "dc_itm_docs": sum(r.n for r in dc), "mir_itm_docs": sum(r.n for r in mir),
    "wh_dc": wh_dc.itm, "wh_dc_dn": dn_per_doc(wh_dc.itm, "Delivery Challan"),
    "wh_mir": wh_mir.itm, "wh_mir_dn": dn_per_doc(wh_mir.itm, "Material Inspection Report"),
    "pe": pe.name, "pe_first_line": pe.description.split("\n")[0].strip(),
    "reimb_rows": reimb, "vendor": ven.name, "vendor_name": ven.vendor_name,
}, default=str))
'''

facts = {AFTER: db_json(AFTER, "facts_after", FACTS), BEFORE: db_json(BEFORE, "facts_before", FACTS)}
F = facts[AFTER]

FILES_SQL = r'''
v = sys.argv[1]
rows = frappe.db.sql("""SELECT name, file_name, attached_to_doctype, attached_to_name, attached_to_field FROM "tabFile"
    WHERE attached_to_doctype = 'Vendors' AND attached_to_name = %s""", v, as_dict=1)
print("JSON " + json.dumps({"vendor": frappe.db.get_value("Vendors", v, ["msme_id", "msme_attachment"], as_dict=1),
                            "attached": [dict(r) for r in rows]}, default=str))
'''


# ------------------------------------------------------------------------------------------------ Audit View

def search_id(page, name: str) -> int:
    box = page.get_by_placeholder(re.compile(r"^Search by", re.I)).first
    box.fill(name)
    settle(page, 1800)
    n = page.locator("tbody tr").filter(has_text=re.compile(r"₹")).count()
    return n


def audit_after() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(AFTER, user, PW) as (page, _):
        open_audit(page, role, user, "after", "labels")
        rt = report_type(page)
        w.check("labels", role, "Report Type shows \"Projects Data\"", rt.inner_text().strip(),
                rt.inner_text().strip() == "Projects Data")
        w.step(page, "labels", "after", role, user, "Report Type now says \"Projects Data\". Open it.", click=rt)
        settle(page, 600)
        opts = [o.strip() for o in page.get_by_role("option").all_inner_texts()]
        w.check("labels", role, "options \"Projects Data\", \"Non Projects Data\"", ", ".join(opts),
                opts == ["Projects Data", "Non Projects Data"])
        w.step(page, "labels", "after", role, user, f"The two options: {' / '.join(opts)}.",
               pins=[pin(page.get_by_role("listbox").first, "New labels; the values behind them are unchanged "
                                                            "(read in ReportsContainer.tsx).", "info")])
        page.keyboard.press("Escape")
        settle(page, 500)

        box = date_box(page)
        txt = box.inner_text().strip()
        w.check("datebox", role, "date box reads \"Pick a date range\" before a pick", txt, txt == "Pick a date range")
        w.step(page, "datebox", "after", role, user, "Step 1: the date box says \"Pick a date range\". The tabs are "
                                                     "locked. Open the date box.", click=box,
               pins=[pin(page.get_by_role("tab", name=re.compile("Orders")).first, "Tabs locked until a range is "
                                                                                    "picked.", "info")])
        settle(page, 600)
        w.step(page, "datebox", "after", role, user, f"Pick {FY}.",
               click=page.get_by_role("button", name=FY, exact=True))
        settle(page, 600)
        page.keyboard.press("Escape")
        settle(page)

        pay = page.get_by_role("tab", name=re.compile("Payments")).first
        w.step(page, "cards", "after", role, user, f"The box now shows {FY} and the tabs unlock. Open Payments.",
               click=pay)
        settle(page, 3500)
        show = page.get_by_role("button", name="Show details").count()
        w.check("cards", role, "no \"Show details\" button", "present" if show else "absent", show == 0)
        first = page.locator('[role="tabpanel"]').locator("div.rounded-lg.border").first
        first_label = first.inner_text().split("\n")[0].strip()
        w.check("cards", role, "first card named after the tab (Payments)", first_label,
                first_label.lower() == "payments")
        strip_text = first.locator("..").inner_text()
        pct = re.findall(r"\d+(?:\.\d)?%", strip_text)
        w.check("cards", role, "no percentages on the cards", ", ".join(pct) or "none", not pct)
        w.step(page, "cards", "after", role, user,
               "Payments: separate cards. The first is named Payments and splits net paid by type; no badges, bars "
               "or %.", pins=[pin(first, f"First card: \"{first_label}\", one amount per type.", "info")])

        row = page.locator("tbody tr").filter(has_text="Project Expense").first
        type_cell, against = row.locator("td").nth(0), row.locator("td").nth(1)
        a_txt = against.inner_text().strip()
        coded = bool(re.fullmatch(r"[A-Z]+-[\w-]*\d+", a_txt))
        w.check("columns", role, "Against shows a description, not a record code", a_txt[:60], not coded)
        w.check("columns", role, "Type shows the pill and the expense type under it",
                type_cell.inner_text().replace("\n", " / "), "\n" in type_cell.inner_text().strip())
        w.step(page, "columns", "after", role, user,
               "Payments table: Type shows the pill with the expense type under it; Against shows the expense's "
               "description.",
               pins=[pin(type_cell, "Pill + expense type.", "info"),
                     pin(against, f"Description (first line), not the record name.", "info")])

        n = search_id(page, F["pe"])
        w.check("columns", role, f"search by ID finds expense {F['pe']} (paid in {FY})", f"{n} rows", n > 0,
                kind="should")
        w.step(page, "columns", "after", role, user,
               f"Search by ID for the Project Expense {F['pe']}, which was paid in {FY}.",
               pins=[] if n else [pin(page.get_by_placeholder(re.compile(r"^Search by", re.I)).first,
                                      f"0 rows. The ID column now holds the description, so an expense can no "
                                      f"longer be found by its record name. Before this PR the same search "
                                      f"finds it.", "should")])
        page.get_by_placeholder(re.compile(r"^Search by", re.I)).first.fill("")
        settle(page)

        inv = page.get_by_role("tab", name=re.compile("Invoices")).first
        inv.click()
        settle(page, 3500)
        heads = [h.strip() for h in page.get_by_role("columnheader").all_inner_texts()]
        w.check("columns", role, "Invoices: Invoice No. is the second column", " | ".join(heads[:4]),
                len(heads) > 1 and heads[1] == "Invoice No.")
        w.step(page, "columns", "after", role, user, "Invoices tab: Invoice No. is the second column.",
               pins=[pin(page.get_by_role("columnheader", name="Invoice No.").first, "Second column.", "info")])

        # Report Type switch: back to step 1.
        w.step(page, "datebox", "after", role, user, "Switch Report Type to Non Projects Data.", click=report_type(page))
        page.get_by_role("option", name="Non Projects Data", exact=True).click()
        settle(page, 2500)
        txt = date_box(page).inner_text().strip()
        w.check("datebox", role, "after a type switch the date box is back to \"Pick a date range\"", txt,
                txt == "Pick a date range")
        w.check("datebox", role, "after a type switch no tab is open", open_tab_name(page) or "none",
                open_tab_name(page) is None)
        w.step(page, "datebox", "after", role, user, "Non Projects Data starts again from step 1: \"Pick a date "
                                                     "range\", no tab open.",
               pins=[pin(date_box(page), f"Back to \"{txt}\".", "info")])

        # Refresh with ALL picked (the case the PR fixes) in Non Projects Data.
        pick_preset(page, "ALL")
        page.get_by_role("tab", name=re.compile("Payments")).first.click()
        settle(page, 3500)
        first = page.locator('[role="tabpanel"]').locator("div.rounded-lg.border").first
        first_label = first.inner_text().split("\n")[0].strip()
        w.step(page, "refresh", "after", role, user, "Non Projects Data, ALL, Payments. Now refresh the page.",
               pins=[pin(first, f"In Non Projects Data the first card is \"{first_label}\", not the tab's name. "
                                f"The PR's \"first card is named after the tab\" holds for Projects Data only.",
                         "info")])
        page.reload()
        settle(page, 4500)
        rt, box, tab = report_type(page).inner_text().strip(), date_box(page).inner_text().strip(), open_tab_name(page)
        w.check("refresh", role, "after refresh: Non Projects Data", rt, rt == "Non Projects Data")
        w.check("refresh", role, "after refresh: ALL", box, box == "ALL")
        w.check("refresh", role, "after refresh: Payments open", tab or "none", tab == "Payments")
        w.step(page, "refresh", "after", role, user,
               f"After the refresh: {rt}, {box}, {tab or 'no tab'} open.",
               pins=[pin(report_type(page), rt, "info"), pin(date_box(page), box, "info")])

        nrow = page.locator("tbody tr").filter(has_text="Non-Project Expense").first
        if nrow.count():
            w.step(page, "columns", "after", role, user,
                   "Non Projects Data, Payments: every row is a Non-Project Expense, with its expense type under the "
                   "pill and its description in Against.",
                   pins=[pin(nrow.locator("td").nth(0), "Type + expense type.", "info"),
                         pin(nrow.locator("td").nth(1), "Description.", "info")])

        # Leave the Audit View and come back: is step 1 asked again?
        page.get_by_role("button", name="Projects", exact=True).first.click()
        settle(page, 2000)
        back = page.get_by_role("button", name="Audit View", exact=True)
        w.step(page, "refresh", "after", role, user, "Open another report (Projects), then come back to Audit View.",
               click=back)
        settle(page, 3000)
        box, tab = date_box(page).inner_text().strip(), open_tab_name(page)
        stale = tab is not None and box == "ALL"
        w.check("refresh", role, "coming back from another report asks for the range again",
                f"date box {box}, tab {tab or 'none'}", not stale, kind="should")
        w.step(page, "refresh", "after", role, user,
               f"Back on Audit View: date box \"{box}\", tab {tab or 'none'} open.",
               pins=[pin(date_box(page), "A leftover audit_range=1 in the URL marks step 1 done, so steps 1 and 2 are "
                                         "skipped. Before this PR an ALL pick was asked again here.", "should")]
               if stale else [])


def audit_roles() -> None:
    for role in ("Accountant", "Accountant Lead"):
        user = USERS[role]
        with session(AFTER, user, PW) as (page, _):
            open_audit(page, role, user, "after", "labels")
            rt, box = report_type(page).inner_text().strip(), date_box(page).inner_text().strip()
            w.check("labels", role, "Report Type \"Projects Data\"", rt, rt == "Projects Data")
            w.check("datebox", role, "date box \"Pick a date range\"", box, box == "Pick a date range")
            pick_preset(page, FY)
            page.get_by_role("tab", name=re.compile("Orders")).first.click()
            settle(page, 3500)
            show = page.get_by_role("button", name="Show details").count()
            first = page.locator('[role="tabpanel"]').locator("div.rounded-lg.border").first
            label = first.inner_text().split("\n")[0].strip()
            w.check("cards", role, "Orders: no Show details; first card \"Orders\"",
                    f"Show details {'present' if show else 'absent'}; first card {label}",
                    not show and label.lower() == "orders")
            w.step(page, "cards", "after", role, user, f"Audit View as {role}: {FY}, Orders. First card \"{label}\".",
                   pins=[pin(first, "Order value incl. GST by type.", "info")])


def audit_before() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(BEFORE, user, PW) as (page, _):
        open_audit(page, role, user, "before", "labels")
        rt, box = report_type(page).inner_text().strip(), date_box(page).inner_text().strip()
        w.step(page, "labels", "before", role, user, f"Before: Report Type says \"{rt}\".",
               pins=[pin(report_type(page), f"Old label \"{rt}\".", "info")])
        w.step(page, "datebox", "before", role, user, f"Before: the date box says \"{box}\" while the tabs are "
                                                      "locked.",
               pins=[pin(date_box(page), f"\"{box}\" reads as picked, yet the tabs stay locked.", "info")])
        pick_preset(page, FY)
        page.get_by_role("tab", name=re.compile("Payments")).first.click()
        settle(page, 3500)
        show = page.get_by_role("button", name="Show details")
        row = page.locator("tbody tr").filter(has_text="Project Expense").first
        w.step(page, "cards", "before", role, user, f"Before: {FY}, Payments. A \"Show details\" button and one strip "
                                                    "with bars and %.",
               pins=[pin(show, "Show details", "info")] if show.count() else [])
        w.step(page, "columns", "before", role, user, "Before: Against shows the expense's record name.",
               pins=[pin(row.locator("td").nth(1), "Record name, not the description.", "info")] if row.count() else [])
        n = search_id(page, facts[BEFORE]["pe"])
        w.step(page, "columns", "before", role, user,
               f"Before: search by ID for {facts[BEFORE]['pe']} finds {n} row{'s' if n != 1 else ''}.",
               pins=[pin(page.get_by_placeholder(re.compile(r"^Search by", re.I)).first, f"{n} rows found.", "info")])
        page.get_by_placeholder(re.compile(r"^Search by", re.I)).first.fill("")
        settle(page)

        choose_type(page, "Non Project View")
        pick_preset(page, "ALL")
        page.get_by_role("tab", name=re.compile("Payments")).first.click()
        settle(page, 3500)
        page.reload()
        settle(page, 4500)
        rt, box, tab = report_type(page).inner_text().strip(), date_box(page).inner_text().strip(), open_tab_name(page)
        w.step(page, "refresh", "before", role, user,
               f"Before: Non Project View, ALL, Payments, then refresh: {rt}, \"{box}\", {tab or 'no tab'} open.",
               pins=[pin(report_type(page), rt, "info")])


def reimb() -> None:
    n = F["reimb_rows"]
    w.status("reimb", "not_walked",
             f"This backup has {n} non-project expenses with no type and a reimbursement link, so no row can show it. "
             f"The backend test in test_audit_view.py covers it (the PR says 33 backend tests pass).")


# ------------------------------------------------------------------------------------------------ Material Usage

def open_usage(page, project: str, view: str, role: str, user: str, side: str, cid: str, name: str) -> None:
    page.goto(f"{base_of(page)}/projects/{project}?page=overview")
    settle(page, 2500)
    w.step(page, cid, side, role, user, f"Open {name}'s Material Usage tab.",
           click=page.get_by_role("button", name="Material Usage", exact=True))
    settle(page, 3000)
    w.step(page, cid, side, role, user, f"Switch to {view}.", click=page.get_by_role("button", name=view, exact=True))
    settle(page, 3000)


def doc_rows(page, itm: str):
    return page.locator("tbody tr").filter(has=page.locator("td", has_text=re.compile(rf"^{itm}$")))


def mu_dc_after() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(AFTER, user, PW) as (page, _):
        open_usage(page, F["p_dc"], "DC Wise", role, user, "after", "mu_itm", F["p_dc_name"])
        heads = [h.strip() for h in page.get_by_role("columnheader").all_inner_texts()]
        w.check("mu_itm", role, "headers include Type and \"PO/ITM No.\"", " | ".join(h for h in heads if h)[:120],
                "Type" in heads and "PO/ITM No." in heads and "PO Number" not in heads)
        row = doc_rows(page, F["wh_dc"]).first
        cells = [c.strip() for c in row.locator("td").all_inner_texts()]
        i = heads.index("DN Qty")
        dn = float(cells[i].replace(",", ""))
        w.check("mu_itm", role, f"{F['wh_dc']} DN Qty = the ITM's received qty of the DC's items, "
                                f"{' / '.join(f'{x:g}' for x in F['wh_dc_dn'])} in the DB", f"{dn:g}",
                any(abs(dn - x) < 0.005 for x in F["wh_dc_dn"]))
        w.check("mu_source", role, f"{F['wh_dc']} (warehouse) reads \"From Warehouse\"", cells[heads.index("Vendor")],
                cells[heads.index("Vendor")] == "From Warehouse")
        w.step(page, "mu_itm", "after", role, user,
               f"DC Wise now lists ITM DCs. {F['wh_dc']}: Type ITM, DN Qty {dn:g} (the DB: the ITM received "
               f"{dn:g} of this DC's items).",
               pins=[pin(row.locator("td").nth(heads.index("Type")), "Type ITM", "info"),
                     pin(row.locator("td").nth(heads.index("Vendor")), "From Warehouse", "info"),
                     pin(row.locator("td").nth(i), f"DN Qty {dn:g}, as the DB says", "info")])
        funnel = page.get_by_role("columnheader", name="Type").locator("button, svg").first
        w.step(page, "mu_itm", "after", role, user, "Filter Type: open its funnel.", click=funnel)
        settle(page, 600)
        opt = page.get_by_role("option", name=re.compile(r"^ITM")).first
        w.step(page, "mu_itm", "after", role, user, "Pick ITM.", click=opt)
        page.keyboard.press("Escape")
        settle(page, 1200)
        types = [c.strip() for c in page.locator("tbody tr").locator("td:nth-child(3)").all_inner_texts() if c.strip()]
        types = [t for t in types if t in ("PO", "ITM")]
        w.check("mu_itm", role, f"ITM filter: only ITM rows, {F['dc_itm_docs']} as in the DB",
                f"{len(types)} rows, {sorted(set(types))}", set(types) == {"ITM"} and len(types) == F["dc_itm_docs"])
        w.step(page, "mu_itm", "after", role, user, f"Only ITM DCs: {len(types)} (the DB has {F['dc_itm_docs']}).")


def mu_mir_after() -> None:
    role, user = "Procurement Executive", USERS["Procurement Executive"]
    with session(AFTER, user, PW) as (page, _):
        open_usage(page, F["p_mir"], "MIR Wise", role, user, "after", "mu_itm", F["p_mir_name"])
        heads = [h.strip() for h in page.get_by_role("columnheader").all_inner_texts()]
        rows = doc_rows(page, F["wh_mir"])
        n = rows.count()
        w.check("mu_itm", role, f"MIR Wise lists {F['wh_mir']}'s {F['mir_itm_docs']} MIRs", f"{n} rows",
                n == F["mir_itm_docs"])
        cells = [c.strip() for c in rows.first.locator("td").all_inner_texts()] if n else []
        dns = sorted(round(float(r.locator("td").nth(heads.index("DN Qty")).inner_text().replace(",", "")), 3)
                     for r in rows.all())
        w.check("mu_itm", role, f"DN Qty per MIR = the DB's {' / '.join(f'{x:g}' for x in F['wh_mir_dn'])}",
                " / ".join(f"{x:g}" for x in dns), dns == F["wh_mir_dn"])
        w.check("mu_source", role, "warehouse ITM reads \"From Warehouse\"",
                cells[heads.index("Vendor")] if n else "no row", bool(n) and cells[heads.index("Vendor")] == "From Warehouse")
        w.step(page, "mu_itm", "after", role, user,
               f"As {role}: MIR Wise lists {F['wh_mir']}'s MIRs from the warehouse, DN Qty "
               f"{' / '.join(f'{x:g}' for x in dns)}.",
               pins=[pin(rows.first.locator("td").nth(heads.index("PO/ITM No.")), f"{n} ITM MIRs", "info")] if n else [])


def mu_po_itm_wise(task: str, side: str) -> None:
    role, user = "Admin", USERS["Admin"]
    f = facts[task]
    with session(task, user, PW) as (page, _):
        open_usage(page, f["p_dc"], "PO/ITM Wise" if side == "after" else "PO Wise", role, user, side, "mu_source",
                   f["p_dc_name"]) if side == "after" else None
        if side == "before":
            page.goto(f"{base_of(page)}/projects/{f['p_dc']}?page=overview")
            settle(page, 2500)
            w.step(page, "mu_source", side, role, user, f"Before: open {f['p_dc_name']}'s Material Usage tab.",
                   click=page.get_by_role("button", name="Material Usage", exact=True))
            settle(page, 3000)
            tab = page.get_by_role("button", name=re.compile(r"^PO(.ITM)? Wise$")).first
            w.step(page, "mu_source", side, role, user, f"Switch to {tab.inner_text().strip()}.", click=tab)
            settle(page, 3000)
        row = page.locator("tbody tr").filter(has_text=f["wh_dc"]).first
        txt = row.inner_text().replace("\n", " | ") if row.count() else ""
        has_from = "From Warehouse" in txt or "Warehouse" in txt
        if side == "after":
            w.check("mu_source", role, f"{f['wh_dc']} names the warehouse", txt[:120], has_from)
        w.step(page, "mu_source", side, role, user,
               f"{'Before' if side == 'before' else 'After'}: the warehouse ITM {f['wh_dc']} in the order list.",
               pins=[pin(row, "Names the warehouse." if has_from else "No source shown for the warehouse ITM.", "info")]
               if row.count() else [])


def mu_dc_before() -> None:
    role, user = "Admin", USERS["Admin"]
    f = facts[BEFORE]
    with session(BEFORE, user, PW) as (page, _):
        open_usage(page, f["p_dc"], "DC Wise", role, user, "before", "mu_itm", f["p_dc_name"])
        heads = [h.strip() for h in page.get_by_role("columnheader").all_inner_texts()]
        n = doc_rows(page, f["wh_dc"]).count()
        hdr = page.get_by_role("columnheader", name=re.compile(r"^PO Number")).first
        w.step(page, "mu_itm", "before", role, user,
               f"Before: DC Wise has no Type column and lists no ITM DC ({f['wh_dc']}: {n} rows).",
               pins=[pin(hdr, "\"PO Number\": POs only.", "info")] if hdr.count() else [])


# ------------------------------------------------------------------------------------------------ MSME

def msme(task: str, side: str) -> None:
    role, user = "Admin", USERS["Admin"]
    f = facts[task]
    ven = f["vendor"]
    cert = out / "cert.png"
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (850, 1100), "white")
    ImageDraw.Draw(img).text((60, 60), "TEST CERTIFICATE (PR walk fixture, not a real Udyam certificate)", fill="black")
    img.save(cert)
    with session(task, user, PW) as (page, _):
        page.goto(f"{base_of(page)}/vendors/{ven}?tab=overview")
        settle(page, 2500)
        w.step(page, "msme", side, role, user, f"{f['vendor_name']} has no MSME details. Open Edit.",
               click=page.get_by_role("button", name="Edit Vendor Details"))
        settle(page, 1500)
        d = page.get_by_role("dialog")
        d.locator("input[type=file]").first.set_input_files(str(cert))
        page.wait_for_timeout(9000)
        d.get_by_text("MSME Details", exact=True).scroll_into_view_if_needed()
        w.step(page, "msme", side, role, user, "Pick a certificate file, then Cancel instead of Update.",
               click=d.get_by_role("button", name="Cancel"),
               pins=[pin(d.get_by_role("link", name="View Certificate"), "Uploaded.", "info")])
        settle(page, 1500)
        got = db_json(task, f"msme_cancel_{side}", FILES_SQL, ven)
        n = len(got["attached"])
        if side == "after":
            w.check("msme", role, "DB after Cancel: no file attached to the vendor", f"{n} attached files", n == 0)
        page.reload()
        settle(page, 2500)
        w.step(page, "msme", side, role, user,
               f"{'Before' if side == 'before' else 'After'} Cancel: the DB has {n} file{'s' if n != 1 else ''} "
               f"attached to {ven}.",
               pins=[pin(page.get_by_role("button", name="Edit Vendor Details"),
                         f"{n} attached: " + (", ".join(a["file_name"] for a in got["attached"]) or "none")
                         + (" (Cancel left it on the vendor)" if n else ""), "info")])
        if side == "before":
            return
        page.get_by_role("button", name="Edit Vendor Details").click()
        settle(page, 1500)
        d = page.get_by_role("dialog")
        d.locator("input[type=file]").first.set_input_files(str(cert))
        page.wait_for_timeout(9000)
        msme_id = f"UDYAM-KR-03-{int(ven.rsplit('-', 1)[-1]):07d}"
        d.get_by_label("MSME ID").fill(msme_id)
        w.step(page, "msme", side, role, user, f"Edit again: certificate and MSME ID {msme_id}, then Update.",
               click=d.get_by_role("button", name="Update"))
        settle(page, 3000)
        got = db_json(task, "msme_update_after", FILES_SQL, ven)
        ok = got["vendor"]["msme_id"] == msme_id and bool(got["vendor"]["msme_attachment"]) and len(got["attached"]) == 1
        w.check("msme", role, "DB after Update: ID saved, certificate attached to the vendor",
                f"msme_id {got['vendor']['msme_id']}, attachment {'set' if got['vendor']['msme_attachment'] else 'empty'}, "
                f"{len(got['attached'])} attached file", ok)
        if page.get_by_role("dialog").count():
            page.keyboard.press("Escape")
        page.reload()
        settle(page, 2500)
        link = page.get_by_role("link", name=re.compile(msme_id))
        w.step(page, "msme", side, role, user, "Saved: the MSME ID links to the certificate.",
               pins=[pin(link, "Attached on Update.", "info")] if link.count() else [])


# ------------------------------------------------------------------------------------------------ Cheque Tracker

MEASURE = """th => { const r = th.getBoundingClientRect(); const rng = document.createRange();
  const btn = th.querySelector('button'); let text = null;
  const walker = document.createTreeWalker(th, NodeFilter.SHOW_TEXT); let n, x1 = -1e9;
  while ((n = walker.nextNode())) { if (!n.textContent.trim()) continue; rng.selectNodeContents(n);
    for (const b of rng.getClientRects()) x1 = Math.max(x1, b.right); }
  const next = th.nextElementSibling ? th.nextElementSibling.getBoundingClientRect() : null;
  return {cell_w: Math.round(r.width), cell_right: Math.round(r.right), text_right: Math.round(x1),
          btn_right: btn ? Math.round(btn.getBoundingClientRect().right) : null, lines: Math.round(r.height)}; }"""


def cheque(task: str, side: str) -> None:
    role, user = "Accountant", USERS["Accountant"]
    with session(task, user, PW) as (page, _):
        menu = page.locator('[data-sidebar="menu-button"]').get_by_text("Cheque Tracker", exact=True)
        w.step(page, "cheque", side, role, user, "Open Cheque Tracker from the sidebar.", click=menu)
        settle(page, 3000)
        hdr = page.get_by_role("columnheader", name=re.compile(r"Cheque.Payment")).first
        m = hdr.evaluate(MEASURE)
        text_over = m["text_right"] - m["cell_right"]
        btn_over = (m["btn_right"] or m["cell_right"]) - m["cell_right"]
        pins = [pin(hdr, f"Cell {m['cell_w']} px wide. The words end {abs(text_over)} px "
                         f"{'past' if text_over > 0 else 'inside'} its right edge.", "info")]
        if side == "after":
            w.check("cheque", role, "the header words stay inside their cell", f"{text_over:+d} px", text_over <= 0)
            if btn_over > 0:
                w.check("cheque", role, "the header's sort control stays inside its cell", f"{btn_over:+d} px",
                        btn_over <= 0, kind="nit")
                pins.append(pin({"x": m["cell_right"] - 6, "y": round(hdr.bounding_box()["y"]) + 8, "w": btn_over + 12,
                                 "h": 40}, f"The sort arrow still pokes {btn_over} px into the Issue Date cell, "
                                           "next to its filter funnel.", "nit"))
        w.step(page, "cheque", side, role, user,
               f"{'Before' if side == 'before' else 'After'}: the Cheque/Payment Date header.", pins=pins)


# ------------------------------------------------------------------------------------------------ run

def serve_only(task: str) -> None:
    """Only one walk lane is free on this machine: stop the other env of this walk, then serve `task`."""
    other = BEFORE if task == AFTER else AFTER
    subprocess.run([DEVENV, "stop", other], capture_output=True, text=True, timeout=120)
    res = subprocess.run([DEVENV, "serve", task, "--wait"], capture_output=True, text=True, timeout=900)
    (out / f"serve-{task}.log").write_text(res.stdout + res.stderr)
    if "serving" not in res.stdout + res.stderr:
        sys.exit(f"could not serve {task}; see {out}/serve-{task}.log")
    # Warm up: vite compiles on the first load, which can outlast a 30 s screenshot or goto.
    with session(task, USERS["Admin"], PW) as (page, _):
        for path in ("/reports?tab=audit_view", "/projects", "/vendors", "/cheque-tracker"):
            page.goto(base_of(page) + path, timeout=180000)
            page.wait_for_load_state("networkidle", timeout=180000)
            page.screenshot(timeout=120000)


PLAN = {
    BEFORE: [("labels", audit_before), ("mu_itm", mu_dc_before), ("mu_source", lambda: mu_po_itm_wise(BEFORE, "before")),
             ("msme", lambda: msme(BEFORE, "before")), ("cheque", lambda: cheque(BEFORE, "before"))],
    AFTER: [("labels", audit_after), ("labels", audit_roles), ("reimb", reimb), ("mu_itm", mu_dc_after),
            ("mu_itm", mu_mir_after), ("mu_source", lambda: mu_po_itm_wise(AFTER, "after")),
            ("msme", lambda: msme(AFTER, "after")), ("cheque", lambda: cheque(AFTER, "after"))],
}
only = set(sys.argv[2:])
for task, part in PLAN.items():
    serve_only(task)
    for cid, fn in part:
        if not only or getattr(fn, "__name__", "") in only:
            guarded(cid, fn, tries=1 if cid == "msme" else 2)

for c in w.data["changes"]:
    if c["status"] in ("failed", "not_walked") and c["reason"]:
        continue
    bad = [k for k in w.data["checks"] if k["change"] == c["id"] and not k["ok"] and k["kind"] == "must"]
    musts = [p for s in w.data["steps"] if s["change"] == c["id"] for p in s["pins"] if p["kind"] == "must"]
    if not any(s["change"] == c["id"] for s in w.data["steps"]):
        continue
    w.status(c["id"], "failed" if bad or musts else "seen",
             "; ".join(f"{k['role']}: expected {k['expect']}, saw {k['seen']}" for k in bad))
print(w.save())
