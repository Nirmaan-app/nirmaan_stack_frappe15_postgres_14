# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Regenerate `docs/outflow-import/cashbook-expense-rules.md` from the live lookup tables.

    docker cp scripts/generate_cashbook_rules_doc.py <container>:/tmp/gen.py
    docker exec -w /workspace/development/frappe-bench <container> env/bin/python /tmp/gen.py

⚠️ THE DOC IS GENERATED, AND THAT IS THE WHOLE POINT. The owner asked for a readable record of the
keyword mapping so it can be revised when the expense-type list changes. A hand-written one would
describe what the rules were on the day somebody wrote it down, and the failure mode of a stale
mapping doc is worse than having none: it is the document a person consults BEFORE editing, so it
would talk them out of a change the table actually needs.

Run it after editing the rules in Desk, and commit the result beside them.
"""

import os
import sys
from collections import defaultdict

BENCH_SITES = "/workspace/development/frappe-bench/sites"
OUT = (
    "/workspace/development/frappe-bench/apps/nirmaan_stack/"
    "docs/outflow-import/cashbook-expense-rules.md"
)

os.chdir(BENCH_SITES)
import frappe  # noqa: E402  -- must follow the chdir, per the app's documented recipe

frappe.init(site=os.environ.get("SITE", "localhost"))
frappe.connect()

rules = frappe.get_all(
    "Outflow Import Expense Rule",
    fields=["keyword", "ledger", "expense_type", "active"],
    order_by="expense_type asc, keyword asc",
)
aliases = frappe.get_all(
    "Outflow Import Project Alias",
    fields=["keyword", "project", "active"],
    order_by="keyword asc",
)
project_names = {
    row.name: row.project_name for row in frappe.get_all("Projects", fields=["name", "project_name"])
}

by_type = defaultdict(lambda: defaultdict(list))
for rule in rules:
    if rule.active:
        by_type[rule.ledger][rule.expense_type].append(rule.keyword)

lines = [
    "# Cashbook import — expense type and project rules",
    "",
    "**Generated from the live tables by `scripts/generate_cashbook_rules_doc.py`. Do not edit by "
    "hand** — edit the records in Desk and re-run it.",
    "",
    "A Cashbook statement carries no expense type and no project, so both are read from the "
    "remark text (`Remark` joined with `Note`).",
    "",
    "## How a rule is chosen",
    "",
    "1. The remark is matched against the project rules first. A project found means the row "
    "becomes a **Project Expense**; none found means a **Non-Project Expense**.",
    "2. The expense type is then read from the keywords **for that ledger only**.",
    "3. **The longest matching keyword wins.**",
    "4. Two different types matching, or none, gives **Petty Cash**.",
    "",
    "> The two ledgers have almost separate vocabularies — most expense types carry only one of "
    "the `project` / `non_project` flags — so the same words deliberately resolve differently on "
    "either side. `Courier charges veeva project` is Material Transportation Charges; "
    "`Courier charges` alone is Postage & Courier.",
    "",
]

for ledger in ("Project", "Non Project"):
    lines += [f"## {ledger} Expenses", ""]
    if not by_type.get(ledger):
        lines += ["_No active rules._", ""]
        continue
    lines += ["| Expense type | Keywords |", "|---|---|"]
    for expense_type in sorted(by_type[ledger]):
        words = ", ".join(f"`{w}`" for w in sorted(by_type[ledger][expense_type], key=len))
        lines.append(f"| {expense_type} | {words} |")
    lines += ["", "Anything else on this side falls back to **Petty Cash**.", ""]

lines += [
    "## Project aliases",
    "",
    "What people write for a project that no rule over the project master can reach — a shorter "
    "name, an initialism below three letters, or a habitual misspelling. Matched as a whole "
    "phrase on word boundaries.",
    "",
    "| Alias | Project |",
    "|---|---|",
]
for alias in aliases:
    if alias.active:
        lines.append(f"| `{alias.keyword}` | {project_names.get(alias.project, alias.project)} |")

retired = [r for r in rules if not r.active] + [a for a in aliases if not a.active]
lines += ["", f"_{len(retired)} retired (inactive) entr{'y' if len(retired) == 1 else 'ies'} not "
          "shown._", ""]

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines))

sys.stdout.write(
    f"wrote {OUT}\n  {sum(len(v) for v in by_type.get('Project', {}).values())} project rules, "
    f"{sum(len(v) for v in by_type.get('Non Project', {}).values())} non-project rules, "
    f"{len([a for a in aliases if a.active])} aliases\n"
)
frappe.destroy()
