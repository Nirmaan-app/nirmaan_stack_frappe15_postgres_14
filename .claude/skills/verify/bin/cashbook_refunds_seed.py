"""Two made-up Cashbook Statements for `walk_cashbook_refunds.py` (spec #1711: #1708, #1707, #1709). Every Txn Id and
remark carries `<stamp>`, so every run is a new import; no line has a bill link (the env cannot reach the bill storage).

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_refunds_seed.py <stamp>

The main statement (17 Nov 2026, and one line of 25 Mar 2026):
  * COLLECT   a Collect Payment of ₹480                          -> its Expense is created (#1708)
  * SPEND     a Wallet Spend of ₹70                              -> its Expense is created
  * CPAIR     a Collect Payment of ₹215, and REF-CPAIR ₹215      -> a Paired wallet refund, both skipped (#1708)
  * SPAIR     a Wallet Spend of ₹333, and REF-SPAIR ₹333         -> a Paired wallet refund, both skipped (#1709)
  * PREF      REF-<an existing Cashbook spend's Txn Id> ₹PART    -> a minus Project Expense on that spend's project
              and type (#1709). The spend is the env's latest Cashbook spend booked on a Project Expense above ₹500
              that no refund line names yet, so each run takes a new one.
  * NREF      REF-<a Txn Id no Expense has> ₹45                  -> a minus Non Project Expense (#1709)
  * EARLY     a Wallet Spend of ₹90 on 25 Mar 2026               -> left out and counted (#1707)
The early statement: two Wallet Spends of March 2026 only        -> refused, nothing created (#1707).

Prints `statement:` and `early:` (paths under the bench's `tmp/`, which the host sees at `benches/<task>/tmp/`), each
Txn Id by its name above, `spend_expense:` / `spend_project:` / `spend_project_name:` / `spend_type:` /
`spend_amount:` for PREF's spend, `part:` (PREF's Credit) and `card_refund:` (a card refund Expense, for the Payment
Done check; blank when the env has none). Writes nothing to the DB.
"""

import csv
import io
import os
import sys

import frappe

from nirmaan_stack.api.outflow_import.test_cashbook_import import FIXTURE
from nirmaan_stack.services.outflow_import.tests.cashbook_xlsx import as_statement_xlsx

STAMP = sys.argv[1]
lines = FIXTURE.read_text().splitlines()
header, footer = lines[0], lines[12:]
WIDTH = len(next(csv.reader([header])))

spend = frappe.db.sql(
    """SELECT m.transfer_id, pe.name, pe.projects, p.project_name, pe.type, pe.amount
       FROM "tabOutflow Row Match" m
       JOIN "tabProject Expenses" pe ON pe.name = m.target_name
       JOIN "tabProjects" p ON p.name = pe.projects
       WHERE m.target_doctype = 'Project Expenses' AND m.match_kind = 'Settled' AND m.transfer_id LIKE 'OBO%%'
         AND pe.amount > 500
         AND NOT EXISTS (SELECT 1 FROM "tabOutflow Import Row" r WHERE r.transfer_id = 'REF-' || m.transfer_id)
       ORDER BY pe.payment_date DESC, pe.creation DESC LIMIT 1""",
    as_dict=True,
)[0]
part = int(spend.amount // 3)

CODES = {"COLLECT": "C", "SPEND": "S", "CPAIR": "CP", "SPAIR": "SP", "EARLY": "E", "E1": "E1", "E2": "E2", "NSPEND": "N"}
ids = {name: f"OBO1711{code}X{STAMP}" for name, code in CODES.items()}
ids["PREF"] = f"REF-{spend.transfer_id}"
ids["NREF"] = f"REF-{ids.pop('NSPEND')}"
ids["CPAIR_REF"] = f"REF-{ids['CPAIR']}"
ids["SPAIR_REF"] = f"REF-{ids['SPAIR']}"


def line(day, time, kind, frm, to, debit, credit, remark, status, txn) -> list[str]:
    cells = [day, time, kind, frm, to, debit, credit, "", "", remark, "", "", "", "", status, txn]
    # `Bill Attached` is the 25th column ("No"); the 4 link columns after it stay blank.
    return cells + [""] * (24 - len(cells)) + ["No"] + [""] * (WIDTH - 25)


DAY = "17/11/2026"
main = [
    line(DAY, "09:00 AM", "Collect Payment", "Asha Menon", "Testshop Collect", "480", "", f"Walk 1711 collect {STAMP}", "SUCCESS", ids["COLLECT"]),
    line(DAY, "09:05 AM", "Wallet Spend", "Asha Menon", "Testvendor Beta", "70", "", f"Walk 1711 spend {STAMP}", "SUCCESS", ids["SPEND"]),
    line(DAY, "09:10 AM", "Collect Payment", "Asha Menon", "Testshop Paired", "215", "", f"Walk 1711 collect paired {STAMP}", "SUCCESS", ids["CPAIR"]),
    line(DAY, "09:15 AM", "Refund to Wallet", "Testshop Paired", "Asha Menon", "", "215", f"Walk 1711 collect refund {STAMP}", "REFUNDED", ids["CPAIR_REF"]),
    line(DAY, "09:20 AM", "Wallet Spend", "Asha Menon", "Testvendor Paired", "333", "", f"Walk 1711 spend paired {STAMP}", "SUCCESS", ids["SPAIR"]),
    line(DAY, "09:25 AM", "Credit Adjustment", "Testvendor Paired", "Asha Menon", "", "333", f"Walk 1711 spend refund {STAMP}", "SUCCESS", ids["SPAIR_REF"]),
    line(DAY, "09:30 AM", "Credit Adjustment", "Testvendor Project", "Asha Menon", "", str(part), f"Walk 1711 part refund {STAMP}", "SUCCESS", ids["PREF"]),
    line(DAY, "09:35 AM", "Refund to Wallet", "Testvendor Nobooked", "Asha Menon", "", "45", f"Walk 1711 orphan refund {STAMP}", "REFUNDED", ids["NREF"]),
    line("25/03/2026", "10:00 AM", "Wallet Spend", "Asha Menon", "Testvendor Early", "90", "", f"Walk 1711 early {STAMP}", "SUCCESS", ids["EARLY"]),
]
early = [
    line("20/03/2026", "10:00 AM", "Wallet Spend", "Asha Menon", "Testvendor Early", "120", "", f"Walk 1711 early one {STAMP}", "SUCCESS", ids["E1"]),
    line("28/03/2026", "11:00 AM", "Wallet Spend", "Asha Menon", "Testvendor Early", "60", "", f"Walk 1711 early two {STAMP}", "SUCCESS", ids["E2"]),
]


def workbook(rows: list[list[str]]) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out, quoting=csv.QUOTE_ALL, lineterminator="\n")
    writer.writerows(rows)
    return as_statement_xlsx("\n".join([header, out.getvalue().rstrip("\n"), *footer]).encode())


tmp = os.path.abspath(os.path.join(frappe.get_site_path(), "..", "..", "tmp"))
paths = {}
for name, rows in (("statement", main), ("early", early)):
    paths[name] = os.path.join(tmp, f"walk-cashbook-1711-{name}-{STAMP}.xlsx")
    with open(paths[name], "wb") as handle:
        handle.write(workbook(rows))
    print(f"{name}: {paths[name]}")
for name, txn in ids.items():
    print(f"{name}: {txn}")
print(f"spend_expense: {spend.name}")
print(f"spend_project: {spend.projects}")
print(f"spend_project_name: {spend.project_name}")
print(f"spend_type: {spend.type}")
print(f"spend_amount: {spend.amount}")
print(f"part: {part}")
card = frappe.db.sql(
    """SELECT name FROM "tabNon Project Expenses" WHERE amount < 0 AND COALESCE(credit_card_statement, '') != ''
       ORDER BY creation DESC LIMIT 1"""
)
print(f"card_refund: {card[0][0] if card else ''}")
