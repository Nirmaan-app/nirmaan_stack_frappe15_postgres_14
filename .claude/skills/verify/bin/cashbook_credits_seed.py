"""A made-up Cashbook Statement for `walk_cashbook_credits.py` (#1720). Every Txn Id and remark carries `<stamp>`, so
every run is a new import; no line has a bill link.

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_credits_seed.py <stamp>

The statement (17 Nov 2026):
  * SPEND  a Wallet Spend of ₹70                                     -> its Expense is created (the headline's 1 record)
  * CPROJ  a Wallet Credit of ₹600 whose remark names one project    -> a minus Project Expense on that project
  * CNON   a Wallet Credit of ₹250 whose remark names none           -> a minus Non Project Expense, Petty Cash
  * NREF   REF-<a Txn Id no Expense has> ₹45, remark naming the project -> a minus Project Expense there (decision 3)

The project is the first Won project, not on CEO Hold, whose name the import's own project match reads as the only
project in the remark. Prints `statement:` (a path under the bench's `tmp/`), each Txn Id by its name above,
`project:` and `project_name:`. Its only write: the two made-up users the walk drives, which the app access gate
leaves open (every Accountant copied from production holds an asset): `walk-accountant@example.com` (Nirmaan
Accountant) and `walk-accountant-lead@example.com` (Nirmaan Accountant Lead), made once.
"""

import csv
import io
import os
import sys

import frappe

from nirmaan_stack.api.outflow_import.cashbook import project_index
from nirmaan_stack.api.outflow_import.test_cashbook_import import FIXTURE
from nirmaan_stack.services.outflow_import.tests.cashbook_xlsx import as_statement_xlsx

STAMP = sys.argv[1]
lines = FIXTURE.read_text().splitlines()
header, footer = lines[0], lines[12:]
WIDTH = len(next(csv.reader([header])))

for email, name, role in (
    ("walk-accountant@example.com", "Walk Accountant", "Nirmaan Accountant"),
    ("walk-accountant-lead@example.com", "Walk Accountant Lead", "Nirmaan Accountant Lead"),
):
    if not frappe.db.exists("User", email):
        user = frappe.new_doc("User")
        user.update({"email": email, "first_name": name, "send_welcome_email": 0})
        user.flags.no_welcome_mail = True
        user.insert(ignore_permissions=True)
    frappe.get_doc("User", email).add_roles(role)
    # Raw: `Nirmaan Users` is the app's user mirror; the walk only needs its profile, which feeds no recompute.
    frappe.db.set_value("Nirmaan Users", email, "role_profile", f"{role} Profile", update_modified=False)
    print(f"user_{'lead' if 'Lead' in role else 'accountant'}: {email}")
frappe.db.commit()

index = project_index()
candidates = frappe.get_all(
    "Projects",
    filters={"tendering_status": "Won", "status": ["!=", "CEO Hold"]},
    fields=["name", "project_name"],
    order_by="creation asc",
)
project = next(
    p for p in candidates
    if p.project_name and index.sole_project(f"Walk 1720 scrap sold at {p.project_name} {STAMP}") == p.name
)

ids = {name: f"OBO1720{code}X{STAMP}" for name, code in {"SPEND": "S", "CPROJ": "CP", "CNON": "CN", "NSPEND": "N"}.items()}
ids["NREF"] = f"REF-{ids.pop('NSPEND')}"
REMARKS = {
    "SPEND": f"Walk 1720 spend {STAMP}",
    "CPROJ": f"Walk 1720 scrap sold at {project.project_name} {STAMP}",
    "CNON": f"Walk 1720 credit UPI {STAMP}",
    "NREF": f"Walk 1720 refund for {project.project_name} {STAMP}",
}


def line(time, kind, frm, to, debit, credit, key, status="SUCCESS") -> list[str]:
    cells = ["17/11/2026", time, kind, frm, to, debit, credit, "", "", REMARKS[key], "", "", "", "", status, ids[key]]
    # `Bill Attached` is the 25th column ("No"); the 4 link columns after it stay blank.
    return cells + [""] * (24 - len(cells)) + ["No"] + [""] * (WIDTH - 25)


rows = [
    line("09:00 AM", "Wallet Spend", "Asha Menon", "Testvendor Walk", "70", "", "SPEND"),
    line("09:05 AM", "Wallet Credit", f"Testpayer Project {STAMP}", "Asha Menon", "", "600", "CPROJ"),
    line("09:10 AM", "Wallet Credit", f"Testpayer Upi {STAMP}", "Asha Menon", "", "250", "CNON"),
    line("09:15 AM", "Refund to Wallet", "Testshop Refund", "Asha Menon", "", "45", "NREF", status="REFUNDED"),
]
out = io.StringIO()
csv.writer(out, quoting=csv.QUOTE_ALL, lineterminator="\n").writerows(rows)
data = as_statement_xlsx("\n".join([header, out.getvalue().rstrip("\n"), *footer]).encode())

tmp = os.path.abspath(os.path.join(frappe.get_site_path(), "..", "..", "tmp"))
path = os.path.join(tmp, f"walk-cashbook-1720-{STAMP}.xlsx")
with open(path, "wb") as handle:
    handle.write(data)
print(f"statement: {path}")
for name, txn in ids.items():
    print(f"{name}: {txn}")
print(f"project: {project.name}")
print(f"project_name: {project.project_name}")
