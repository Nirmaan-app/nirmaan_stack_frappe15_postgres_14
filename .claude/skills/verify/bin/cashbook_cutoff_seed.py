"""Two made-up Cashbook Statements for `walk_cashbook_cutoff.py` (#1715). Every spend's Txn Id and remark carries
`<stamp>`, so every run is a new import; no line has a bill link.

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_cutoff_seed.py <stamp>

The main statement:
  * EARLY     a Wallet Spend of ₹90 on 25 Mar 2026                  -> left out and counted
  * TOPUP     a Bank → VA line of 25 Mar 2026 repeating an old ₹0    -> left out and counted; fills NO record
              Internal Transfer record's Txn Id (the env's first one)
  * KEPT1     a Wallet Spend of ₹70 on 1 Apr 2026                   -> the period starts here
  * KEPT2     a Wallet Spend of ₹55 on 17 Nov 2026                  -> the period ends here
  * NREF      REF-<a Txn Id no Expense has> ₹45 on 17 Nov 2026      -> the refunds heading
The early statement: the same Bank → VA line and one March spend   -> refused, nothing created, nothing filled.

Prints `statement:` and `early:` (paths under the bench's `tmp/`), each Txn Id by its name above, and `record:` (the ₹0
Internal Transfer record TOPUP repeats). Writes nothing to the DB.
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

(record, topup_txn), *_ = frappe.db.sql(
    """SELECT it.name, r.transfer_id FROM "tabInternal Transfer" it
       JOIN "tabOutflow Import Row" r ON r.name = it.import_row
       WHERE r.source = 'Cashbook' AND it.amount = 0 AND r.amount = 0 AND r.transfer_id LIKE 'VALOAD-%%'
       ORDER BY it.name LIMIT 1"""
)

ids = {name: f"OBO1715{code}X{STAMP}" for name, code in {"EARLY": "E", "KEPT1": "K1", "KEPT2": "K2", "E2": "E2"}.items()}
ids["NREF"] = f"REF-OBO1715NX{STAMP}"
ids["TOPUP"] = topup_txn


def line(day, time, kind, frm, to, debit, credit, remark, status, txn) -> list[str]:
    cells = [day, time, kind, frm, to, debit, credit, "", "", remark, "", "", "", "", status, txn]
    return cells + [""] * (24 - len(cells)) + ["No"] + [""] * (WIDTH - 25)


TOPUP = line("25/03/2026", "09:00 AM", "Bank → VA", "Test Company", "Virtual Account", "", "700", "", "SUCCESS", topup_txn)
main = [
    line("25/03/2026", "10:00 AM", "Wallet Spend", "Asha Menon", "Testvendor Early", "90", "", f"Walk 1715 early {STAMP}", "SUCCESS", ids["EARLY"]),
    TOPUP,
    line("01/04/2026", "10:00 AM", "Wallet Spend", "Asha Menon", "Testvendor April", "70", "", f"Walk 1715 april {STAMP}", "SUCCESS", ids["KEPT1"]),
    line("17/11/2026", "10:00 AM", "Wallet Spend", "Asha Menon", "Testvendor November", "55", "", f"Walk 1715 november {STAMP}", "SUCCESS", ids["KEPT2"]),
    line("17/11/2026", "11:00 AM", "Refund to Wallet", "Testvendor Nobooked", "Asha Menon", "", "45", f"Walk 1715 refund {STAMP}", "REFUNDED", ids["NREF"]),
]
early = [
    TOPUP,
    line("28/03/2026", "11:00 AM", "Wallet Spend", "Asha Menon", "Testvendor Early", "60", "", f"Walk 1715 early two {STAMP}", "SUCCESS", ids["E2"]),
]


def workbook(rows: list[list[str]]) -> bytes:
    out = io.StringIO()
    csv.writer(out, quoting=csv.QUOTE_ALL, lineterminator="\n").writerows(rows)
    return as_statement_xlsx("\n".join([header, out.getvalue().rstrip("\n"), *footer]).encode())


tmp = os.path.abspath(os.path.join(frappe.get_site_path(), "..", "..", "tmp"))
for name, rows in (("statement", main), ("early", early)):
    path = os.path.join(tmp, f"walk-cashbook-1715-{name}-{STAMP}.xlsx")
    with open(path, "wb") as handle:
        handle.write(workbook(rows))
    print(f"{name}: {path}")
for name, txn in ids.items():
    print(f"{name}: {txn}")
print(f"record: {record}")
