"""Hold an Approve Payments CSV export's Tier column to the DB (#1710), for `walk_cashbook_refunds.py --part tier-export`.

    devenv.sh script <task> .claude/skills/verify/bin/approval_tier_export_db.py <export.csv (container path)>

For every Expense row of the file (Ledger Project Expenses / Non Project Expenses), the tier the DB says it should
show: SYSTEM when it carries an import marker (`cashbook_batch`; `credit_card_statement` on Non Project), else the
amount rule (`approval_tiers.required_tier`, the expense CEO line). Prints one line `JSON:{...}`:
`rows` (Expense rows read), `mismatches` (up to 20 rows whose Tier differs), and `kinds`: per kind (cashbook_spend,
cashbook_refund, card_spend, card_refund, imported_above_50k, person_AUTO / person_L1 / person_L1+L2) how many rows
and one example `[id, amount, tier in the file]`. Reads only.
"""

import csv
import json
import sys

import frappe

from nirmaan_stack.services.approval_tiers import TIER_L2_ABOVE_EXPENSES, required_tier

LABEL = {"auto": "AUTO", "l1": "L1", "l1_l2": "L1+L2"}
LEDGERS = ("Project Expenses", "Non Project Expenses")

with open(sys.argv[1], encoding="utf-8-sig", newline="") as handle:
    rows = [row for row in csv.DictReader(handle) if row.get("Ledger") in LEDGERS]

facts = {}
for doctype in LEDGERS:
    names = [row["ID"] for row in rows if row["Ledger"] == doctype]
    card = ", credit_card_statement" if doctype == "Non Project Expenses" else ", NULL AS credit_card_statement"
    for chunk in range(0, len(names), 2000):
        for f in frappe.db.sql(
            f"""SELECT name, amount, cashbook_batch{card} FROM "tab{doctype}" WHERE name IN %(names)s""",
            {"names": tuple(names[chunk:chunk + 2000])},
            as_dict=True,
        ):
            facts[(doctype, f.name)] = f

kinds, mismatches = {}, []
for row in rows:
    f = facts.get((row["Ledger"], row["ID"]))
    if f is None:
        mismatches.append({"id": row["ID"], "why": "not in the DB"})
        continue
    amount = float(f.amount or 0)
    if f.cashbook_batch or f.credit_card_statement:
        expected = "SYSTEM"
        kind = ("cashbook" if f.cashbook_batch else "card") + ("_refund" if amount < 0 else "_spend")
    else:
        expected = LABEL[required_tier(amount, TIER_L2_ABOVE_EXPENSES)]
        kind = f"person_{expected}"
    if row["Tier"] != expected:
        mismatches.append({"id": row["ID"], "amount": amount, "file": row["Tier"], "expected": expected})
    for k in (kind, "imported_above_50k" if expected == "SYSTEM" and amount > TIER_L2_ABOVE_EXPENSES else None):
        if k:
            entry = kinds.setdefault(k, {"rows": 0, "example": [row["ID"], amount, row["Tier"]]})
            entry["rows"] += 1

print("JSON:" + json.dumps({"rows": len(rows), "mismatches": mismatches[:20], "mismatch_count": len(mismatches),
                            "kinds": kinds}, default=str))
