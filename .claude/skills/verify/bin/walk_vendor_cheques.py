"""Walk a vendor's Cheques tab (PR #1732): the Cheque Tracker narrowed to one vendor, its tab badges and summary strip
held to the env DB, each row's buttons held to the role (Admin, Accountant and Accountant Lead edit and cancel;
Procurement edits only its own open cheques; PMO only views), PMO reading cheques without the Cheque Tracker, and the
Cheque Tracker's "Cheque/Payment Date" header staying inside its column (PR #1736).

    python3 -I .claude/skills/verify/bin/walk_vendor_cheques.py <env> <out dir> [function ...]

The vendor is the one with the most cheques that still have a Cancel to offer, read from the env DB (db/).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from feature_walk import FeatureWalk, num, pin, settle, table_total  # noqa: E402

from record import inr  # noqa: E402

ROLES = ["Admin", "Accountant", "Accountant Lead", "Procurement Lead", "PMO"]
STATUSES = ["Approval Pending", "Issued", "Cleared", "Cancelled"]
TABS = ["All Cheques", "Cheque Issued – Reconciliation Pending", "Security Deposits"]

FACTS_SQL = r'''
open_ = """(status = 'Issued' OR (cheque_type != 'Security Deposit' AND status = 'Approval Pending'))"""
vendor = frappe.db.sql(f"""
    SELECT vendor FROM "tabCheques" WHERE COALESCE(vendor, '') != '' GROUP BY vendor
    ORDER BY MAX({open_}::int) DESC, COUNT(*) DESC, vendor LIMIT 1""")[0][0]
rows = frappe.db.sql("""SELECT name, cheque_no, status, cheque_type, owner, amount FROM "tabCheques" WHERE vendor = %s""",
                     vendor, as_dict=True)
emit({"vendor": vendor, "vendor_name": frappe.db.get_value("Vendors", vendor, "vendor_name"),
      "rows": [dict(r, amount=float(r.amount or 0)) for r in rows]})
'''

fw = FeatureWalk("Vendor › Cheques tab", "vendors.md")
w = fw.w
w.change("cheques", "Vendor › Cheques tab",
         "A Cheques tab on the vendor page: the Cheque Tracker narrowed to this vendor. Accountants can Edit and "
         "Cancel; Procurement and PMO can only view.")
w.change("pmo", "PMO may view cheques",
         "The cheque read endpoints let PMO in (view only). PMO gets no Cheque Tracker in the sidebar, and saving and "
         "cancelling stay closed to it.")
w.change("cheque_header", "Cheque Tracker › date header",
         "The \"Cheque/Payment Date\" header's words stay inside their column (width 160, two lines).")
users = fw.pick(ROLES)
facts = fw.db("facts", FACTS_SQL)
VENDOR, VENDOR_NAME, ROWS = facts["vendor"], facts["vendor_name"], facts["rows"]
ACCOUNTS = {"Admin", "Accountant", "Accountant Lead"}
ACCESS = ACCOUNTS | {"Procurement Lead"}


def tab_want() -> dict:
    return {TABS[0]: len(ROWS),
            TABS[1]: sum(r["status"] == "Issued" and r["cheque_type"] == "Payment" for r in ROWS),
            TABS[2]: sum(r["cheque_type"] == "Security Deposit" for r in ROWS)}


def row_buttons(role: str, row: dict) -> list[str]:
    """The buttons a row offers this role (frontend/src/utils/cheques/chequeRowActions.ts, chequeEdit.canEditCheque):
    Edit for Admin and the Accountants, or for Procurement on its own Approval Pending Payment cheque or Issued
    deposit; Cancel (a deposit's "Mark returned") for Admin and the Accountants on an Issued cheque or an Approval
    Pending Payment cheque."""
    deposit = row["cheque_type"] == "Security Deposit"
    own_open = row["owner"] == users[role] and row["status"] == ("Issued" if deposit else "Approval Pending")
    buttons = ["View"]
    if role in ACCOUNTS or (role in ACCESS and own_open):
        buttons.append("Edit")
    if role in ACCOUNTS and (row["status"] == "Issued" or (not deposit and row["status"] == "Approval Pending")):
        buttons.append("Mark returned" if deposit else "Cancel")
    return buttons


def seen_buttons(page) -> dict[str, list[str]]:
    labels = page.locator("tbody button[aria-label]").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")
    out: dict[str, list[str]] = {}
    for label in labels:
        if m := re.fullmatch(r"(View|Edit|Cancel|Mark returned) cheque (.+)", label or ""):
            out.setdefault(m.group(2), []).append(m.group(1))
    return out


def tab_counts(page) -> dict:
    counts = {}
    for t in page.get_by_role("navigation", name="Cheque Tracker tabs").get_by_role("button").all_inner_texts():
        if m := re.match(r"\s*(.+?)\s+(\d+)\s*$", t.replace("\n", " ")):
            counts[m.group(1).strip()] = int(m.group(2))
    return counts


def check_list(page, cid: str, role: str) -> None:
    """The tab badges and every row's buttons, against the DB and the role's rule."""
    settle(page, 1500)
    want, seen = tab_want(), tab_counts(page)
    w.check(cid, role, "tab badges = DB: " + " / ".join(f"{k} {v}" for k, v in want.items()),
            " / ".join(f"{k} {v}" for k, v in seen.items()) or "no badges read", seen == want)
    want_rows = {r["cheque_no"]: row_buttons(role, r) for r in ROWS}
    shown = seen_buttons(page)
    if len(ROWS) > 50:
        want_rows = {k: v for k, v in want_rows.items() if k in shown}
    w.check(cid, role, "each row's buttons: " + "; ".join(f"{k} {'/'.join(v)}" for k, v in sorted(want_rows.items())),
            "; ".join(f"{k} {'/'.join(v)}" for k, v in sorted(shown.items())) or "no row buttons",
            {k: sorted(v) for k, v in shown.items()} == {k: sorted(v) for k, v in want_rows.items()})


def strip_figures(page) -> dict:
    text = page.locator("body").inner_text()
    out = {}
    for label in ["All", *STATUSES]:
        if m := re.search(rf"(?m)^{label}\n₹([\d,]+)\n(\d+) cheques?$", text):
            out[label] = (int(m.group(2)), int(num(m.group(1))))
    return out


def open_cheques_tab(page, cid: str, role: str, caption: str):
    tab = page.get_by_role("button", name="Cheques", exact=True)
    w.check(cid, role, "sees the vendor's Cheques tab", "sees it" if tab.count() else "no Cheques tab",
            tab.count() > 0)
    if not tab.count():
        w.step(page, cid, "after", role, users[role], f"Vendor page as {role}: no Cheques tab.")
        return False
    w.step(page, cid, "after", role, users[role], caption, click=tab)
    settle(page, 2500)
    return True


def cheques_admin() -> None:
    role = "Admin"
    with fw.session(users[role]) as page:
        fw.open_vendor(page, "cheques", role, VENDOR, VENDOR_NAME)
        if not open_cheques_tab(page, "cheques", role, f"{VENDOR_NAME}: open its Cheques tab."):
            return
        check_list(page, "cheques", role)
        want = {"All": (len(ROWS), round(sum(r["amount"] for r in ROWS)))}
        for s in STATUSES:
            mine = [r for r in ROWS if r["status"] == s]
            want[s] = (len(mine), round(sum(r["amount"] for r in mine)))
        seen = strip_figures(page)
        w.check("cheques", role, "summary strip = DB: " + "; ".join(f"{k} {n} ₹{inr(a)}" for k, (n, a) in want.items()),
                "; ".join(f"{k} {n} ₹{inr(a)}" for k, (n, a) in seen.items()) or "no strip read",
                seen.keys() == want.keys() and all(seen[k][0] == want[k][0] and abs(seen[k][1] - want[k][1]) <= 1
                                                    for k in want))
        w.step(page, "cheques", "after", role, users[role],
               "All Cheques: only this vendor's cheques, with the summary strip. Admin can Edit and Cancel.",
               pins=[pin(page.get_by_role("navigation", name="Cheque Tracker tabs"), "Tab badges, held to the DB.",
                         "info")])
        issued = tab_want()[TABS[1]]
        w.step(page, "cheques", "after", role, users[role], "Open Cheque Issued – Reconciliation Pending.",
               click=page.get_by_role("button", name=re.compile(r"^Cheque Issued")))
        settle(page, 2500)
        rows = table_total(page) or 0
        w.check("cheques", role, f"the Issued tab lists the vendor's {issued} Issued payment cheques", f"{rows} rows",
                rows == issued)
        w.step(page, "cheques", "after", role, users[role], f"Cheque Issued – Reconciliation Pending: {rows} cheques.")


def cheques_roles() -> None:
    for role in ("Accountant", "Accountant Lead", "Procurement Lead"):
        with fw.session(users[role]) as page:
            fw.open_vendor(page, "cheques", role, VENDOR, VENDOR_NAME, record=False)
            if not open_cheques_tab(page, "cheques", role, f"Vendor page as {role}: open the Cheques tab."):
                continue
            check_list(page, "cheques", role)
            verbs = sorted({v for vs in seen_buttons(page).values() for v in vs})
            w.step(page, "cheques", "after", role, users[role],
                   f"Cheques as {role}. Row buttons: {', '.join(verbs) or 'none'}.")


def pmo_view() -> None:
    role = "PMO"
    with fw.session(users[role]) as page:
        settle(page, 1500)
        in_sidebar = page.locator('[data-sidebar="menu-button"], [data-sidebar="menu-sub-button"]').get_by_text(
            "Cheque Tracker", exact=True).count() > 0
        w.check("pmo", role, "no Cheque Tracker in the sidebar", "in the sidebar" if in_sidebar else "not there",
                not in_sidebar)
        fw.open_vendor(page, "pmo", role, VENDOR, VENDOR_NAME)
        if not open_cheques_tab(page, "pmo", role, f"{VENDOR_NAME}: PMO opens its Cheques tab."):
            return
        check_list(page, "pmo", role)
        first = ROWS[0]["cheque_no"] if ROWS else None
        view = page.get_by_role("button", name=f"View cheque {first}", exact=True)
        w.step(page, "pmo", "after", role, users[role],
               "PMO sees the vendor's cheques, each with View only. Open one.", click=view)
        settle(page, 2000)
        dialog = page.get_by_role("dialog")
        acts = dialog.get_by_role("button", name=re.compile(r"^(Edit|Cancel|Mark returned)\b")).all_inner_texts() \
            if dialog.count() else []
        w.check("pmo", role, f"View opens cheque {first}'s details (the read endpoint lets PMO in)",
                "opened" if dialog.count() and first in dialog.first.inner_text() else "not opened",
                dialog.count() > 0 and first in dialog.first.inner_text())
        w.check("pmo", role, "the details offer no Edit or Cancel", ", ".join(acts) or "none", not acts)
        w.step(page, "pmo", "after", role, users[role], f"Cheque {first}'s details, read-only for PMO.")


# The header cell's right edge, where its words end, and where its sort button ends, in screen pixels.
MEASURE = """th => { const r = th.getBoundingClientRect(), rng = document.createRange(); let right = -1e9, n;
  const walker = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
  while ((n = walker.nextNode())) { if (!n.textContent.trim()) continue; rng.selectNodeContents(n);
    for (const b of rng.getClientRects()) right = Math.max(right, b.right); }
  const btn = th.querySelector('button');
  return {cell: Math.round(r.right), width: Math.round(r.width), text: Math.round(right),
          button: btn ? Math.round(btn.getBoundingClientRect().right) : null}; }"""


def cheque_header() -> None:
    role = "Accountant"
    with fw.session(users[role]) as page:
        w.step(page, "cheque_header", "after", role, users[role], "Open Cheque Tracker from the sidebar.",
               click=page.locator('[data-sidebar="menu-button"]').get_by_text("Cheque Tracker", exact=True))
        settle(page, 2500)
        hdr = page.get_by_role("columnheader", name=re.compile(r"Cheque.Payment"))
        m = hdr.first.evaluate(MEASURE)
        w.check("cheque_header", role, "the header's words end inside its cell", f"{m['text'] - m['cell']:+d} px",
                m["text"] <= m["cell"])
        over = (m["button"] or m["cell"]) - m["cell"]
        w.check("cheque_header", role, "its sort arrow stays inside the cell too", f"{over:+d} px", over <= 0,
                kind="nit")
        w.step(page, "cheque_header", "after", role, users[role],
               f"The Cheque/Payment Date header: {m['width']} px wide, its words {m['cell'] - m['text']} px inside "
               "its right edge.", pins=[pin(hdr, "Cheque/Payment Date", "info")])


fw.run([("cheques", cheques_admin), ("cheques", cheques_roles), ("pmo", pmo_view),
        ("cheque_header", cheque_header)])
fw.finish()
