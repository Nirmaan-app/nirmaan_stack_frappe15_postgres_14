"""Walk a vendor's Payments tab: its three sub-tabs Paid, Cheque Pending and Other Pending Payments (PR #1732), each
count and total held to the env DB under the same user's filter, as Admin, Accountant, Procurement Lead and PMO.

    python3 -I .claude/skills/verify/bin/walk_vendor_payments.py <env> <out dir> [function ...]

The vendor is the one whose payments fill all three sub-tabs, read from the env DB at the start (db/).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from feature_walk import FeatureWalk, num, pin, settle, table_total  # noqa: E402

from record import inr  # noqa: E402

ROLES = ["Admin", "Accountant", "Procurement Lead", "PMO"]
GROUPS = {"paid": "Paid", "cheque": "Cheque Pending", "others": "Other Pending Payments"}

# The sub-tab rule (frontend/src/utils/vendorPayments/paymentGroups.ts): Paid is status Paid; Cheque Pending is a
# Cheque payment at Reconciliation Pending; Other is the rest, its total leaving out Rejected. Counted per user
# through frappe.get_list, the read the page's own count query makes, so each user's project filter applies.
FACTS_SQL = r'''
users = json.loads(sys.argv[1])
vendor = frappe.db.sql("""
    SELECT vendor FROM "tabProject Payments" WHERE COALESCE(vendor, '') != '' GROUP BY vendor
    ORDER BY (MAX((status = 'Paid')::int) + MAX((mode_of_payment = 'Cheque' AND status = 'Reconciliation Pending')::int)
              + MAX((status != 'Paid' AND NOT (mode_of_payment = 'Cheque' AND status = 'Reconciliation Pending'))::int))
             DESC, COUNT(*), vendor
    LIMIT 1""")[0][0]

def groups(user):
    frappe.set_user(user)
    rows = frappe.get_list("Project Payments", filters={"vendor": vendor},
                           fields=["status", "mode_of_payment", "count(name) as count", "sum(amount) as amount"],
                           group_by="status, mode_of_payment", limit_page_length=0)
    frappe.set_user("Administrator")
    g = {k: {"count": 0, "amount": 0.0} for k in ("paid", "cheque", "others")}
    g["paid"]["cheque"] = 0
    for r in rows:
        n, amt = int(r["count"]), float(r["amount"] or 0)
        if r["status"] == "Paid":
            key = "paid"
            g["paid"]["cheque"] += n if r["mode_of_payment"] == "Cheque" else 0
        elif r["mode_of_payment"] == "Cheque" and r["status"] == "Reconciliation Pending":
            key = "cheque"
        else:
            key = "others"
        g[key]["count"] += n
        g[key]["amount"] += 0 if r["status"] == "Rejected" else amt
    return g

emit({"vendor": vendor, "vendor_name": frappe.db.get_value("Vendors", vendor, "vendor_name"),
      "by_user": {u: groups(u) for u in users}})
'''

fw = FeatureWalk("Vendor › Payments sub-tabs", "vendors.md")
w = fw.w
w.change("payments", "Vendor › Payments sub-tabs",
         "One mixed table becomes three sub-tabs: Paid, Cheque Pending, Other Pending Payments. Each tab's count and "
         "₹ total cover all of the vendor's payments the user may see.")
users = fw.pick(ROLES)
facts = fw.db("facts", FACTS_SQL, json.dumps(list(users.values())))
VENDOR, VENDOR_NAME = facts["vendor"], facts["vendor_name"]


def tab_counts(page) -> dict:
    counts = {}
    for t in page.get_by_role("tablist", name="Payment groups").get_by_role("tab").all_inner_texts():
        m = re.match(r"\s*(.+?)\s+(\d+)\s*$", t.replace("\n", " "))
        if m:
            counts[m.group(1).strip()] = int(m.group(2))
    return counts


def expected(role: str) -> dict:
    g = facts["by_user"][users[role]]
    return {GROUPS[k]: g[k]["count"] for k in GROUPS}


def check_counts(page, role: str) -> None:
    want, seen = expected(role), tab_counts(page)
    w.check("payments", role, "sub-tab counts = DB under this user's filter: "
            + " / ".join(f"{k} {v}" for k, v in want.items()),
            " / ".join(f"{k} {v}" for k, v in seen.items()) or "no counts read", seen == want)


def summary_amount(page) -> int | None:
    """The ₹ total under the tab bar, in whole rupees."""
    line =page.get_by_role("tablist", name="Payment groups").locator("xpath=following-sibling::div[1]")
    m = re.match(r"\s*₹([\d,]+)", line.inner_text()) if line.count() else None
    return int(num(m.group(1))) if m else None


def open_group(page, role: str, key: str, caption: str, first: bool = False) -> None:
    tab = page.get_by_role("tab", name=re.compile(rf"^{re.escape(GROUPS[key])} \d+$"))
    if not first:
        w.step(page, "payments", "after", role, users[role], f"Open {GROUPS[key]}.", click=tab)
        settle(page, 2000)
    g = facts["by_user"][users[role]][key]
    shown = summary_amount(page)
    w.check("payments", role, f"{GROUPS[key]} total = DB ₹{inr(round(g['amount']))}",
            f"₹{inr(shown)}" if shown is not None else "no total read",
            shown is not None and abs(shown - g["amount"]) <= 1)
    rows = table_total(page) or 0
    w.check("payments", role, f"{GROUPS[key]} table lists the {g['count']} payments its tab counts",
            f"{rows} rows", rows == g["count"])
    pins = []
    if key == "paid":
        sub = page.get_by_text(re.compile(r"^\d+ payments? \(\d+ online, \d+ cheque\)$"))
        m = re.match(r"(\d+) payments? \((\d+) online, (\d+) cheque\)", sub.first.inner_text()) if sub.count() else None
        want = (g["count"], g["count"] - g["cheque"], g["cheque"])
        w.check("payments", role, f"Paid splits into {want[1]} online + {want[2]} cheque (DB)",
                sub.first.inner_text() if m else "no split read", bool(m) and tuple(map(int, m.groups())) == want)
        pins = [pin(sub, "The total and its online / cheque split.", "info")] if sub.count() else []
    w.step(page, "payments", "after", role, users[role], caption, pins=pins)


def payments_admin() -> None:
    role = "Admin"
    with fw.session(users[role]) as page:
        fw.open_vendor(page, "payments", role, VENDOR, VENDOR_NAME)
        w.step(page, "payments", "after", role, users[role], f"{VENDOR_NAME}: open its Payments tab.",
               click=page.get_by_role("button", name="Payments", exact=True))
        settle(page, 2500)
        check_counts(page, role)
        open_group(page, role, "paid", "Paid opens first: only bank-confirmed payments, with a total.", first=True)
        open_group(page, role, "cheque", "Cheque Pending: a cheque handed to the vendor, not cleared yet.")
        open_group(page, role, "others", "Other Pending Payments: everything still in progress, Rejected not counted "
                                         "in the total.")


def payments_roles() -> None:
    for role in ROLES[1:]:
        with fw.session(users[role]) as page:
            fw.open_vendor(page, "payments", role, VENDOR, VENDOR_NAME, record=False)
            page.get_by_role("button", name="Payments", exact=True).first.click()
            settle(page, 2500)
            check_counts(page, role)
            w.step(page, "payments", "after", role, users[role],
                   f"Payments as {role}: " + " / ".join(f"{k} {v}" for k, v in tab_counts(page).items()) + ".")


fw.run([("payments", payments_admin), ("payments", payments_roles)])
fw.finish()
