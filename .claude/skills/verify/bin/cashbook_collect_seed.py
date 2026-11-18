"""A made-up Cashbook Statement for `walk_cashbook_collect.py` (#1708): one Collect Payment (₹480) and one Wallet
Spend (₹70), neither with a bill link (the env cannot reach the bill storage, and a link would expire), their Txn Ids
and remarks carrying `<stamp>`, so every run is a new import. Built from the test fixture `cashbook_sample.csv`.

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_collect_seed.py <stamp>

Prints `statement: <path>` (under the bench's `tmp/`, which the host sees at `benches/<task>/tmp/`), `collect: <Txn Id>`
and `spend: <Txn Id>`. Writes nothing to the DB.
"""

import os
import sys

import frappe

from nirmaan_stack.api.outflow_import.test_cashbook_import import FIXTURE
from nirmaan_stack.services.outflow_import.tests.cashbook_xlsx import as_statement_xlsx

STAMP = sys.argv[1]
FIXTURE_TXN = "OBO1700000000002BBBBBB"  # the fixture's ₹70 spend, no bill link

lines = FIXTURE.read_text().splitlines()
header, spend_line, footer = lines[0], lines[2], lines[12:]
assert FIXTURE_TXN in spend_line and '"Pay to merchant"' in spend_line

collect, spend = f"OBO1708C{STAMP}", f"OBO1708S{STAMP}"
collect_line = (
    spend_line.replace('"Wallet Spend"', '"Collect Payment"', 1)
    .replace('"70"', '"480"', 1)
    .replace('"Pay to merchant"', f'"Walk collect {STAMP}"', 1)
    .replace(FIXTURE_TXN, collect)
)
spend_line = spend_line.replace('"Pay to merchant"', f'"Walk spend {STAMP}"', 1).replace(FIXTURE_TXN, spend)

path = os.path.abspath(os.path.join(frappe.get_site_path(), "..", "..", "tmp", f"walk-cashbook-collect-{STAMP}.xlsx"))
with open(path, "wb") as handle:
    handle.write(as_statement_xlsx("\n".join([header, collect_line, spend_line, *footer]).encode()))
print(f"statement: {path}")
print(f"collect: {collect}")
print(f"spend: {spend}")
