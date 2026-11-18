#!/usr/bin/env python3
"""Walk a Cashbook Collect payment created like any wallet spend (#1708, ADR-0015 Amendment C), as an Accountant.
Exits 1 on the first screen or DB read that is not as expected.

    python3 .claude/skills/verify/bin/walk_cashbook_collect.py --task <task> --accountant <email> --password <pw>

The Accountant needs the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). It uploads a
made-up statement (`cashbook_collect_seed.py`: one Collect Payment of ₹480, one Wallet Spend of ₹70, no bill links)
through the import dialog, so every run is a new import. An env runs no RQ worker, so the walk drains the `long`
queue itself after Create.

1. Sidebar Bulk Import Transactions -> Import statement -> Source "Cashbook (petty cash)" -> the file -> Read statement.
   Review says "2 expense records" and ₹550, and shows no "shop-requested payments" box.
2. Its Non-Project group, opened, lists the Collect payment's remark among the spends to create.
3. Create 2 records -> the job runs -> DB: the Collect payment's line is Settled, its Expense ₹480 carries the
   Cashbook marker (this import) and its Txn Id as `payment_ref`, as the Wallet Spend's does.
"""

import argparse
import datetime
import json
import re
import subprocess
from pathlib import Path

from drive import save, session, sidebar

BIN = ".claude/skills/verify/bin"

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--accountant", required=True)
ap.add_argument("--password", required=True)
a = ap.parse_args()

STAMP = datetime.datetime.now(datetime.timezone.utc).strftime("%m%d%H%M%S")


def devenv(*args: str) -> str:
    return subprocess.run(["scripts/devenv/devenv.sh", *args], capture_output=True, text=True, check=True).stdout


def check(ok: bool, what: str) -> None:
    if not ok:
        raise AssertionError(what)
    print(f"seen: {what}")


seeded = dict(re.findall(r"^(\w+): (.+)$", devenv("script", a.task, f"{BIN}/cashbook_collect_seed.py", STAMP), re.M))
# The container's /workspace/development is the host's `development` folder, above this checkout or worktree.
DEVELOPMENT = next(p for p in Path(__file__).resolve().parents if p.name == "development")
statement = DEVELOPMENT / seeded["statement"].removeprefix("/workspace/development/")


def db() -> dict:
    out = devenv("script", a.task, f"{BIN}/cashbook_collect_db.py", seeded["collect"], seeded["spend"])
    return json.loads(next(line for line in out.splitlines() if line.startswith("JSON:"))[5:])


with session(a.task, a.accountant, a.password) as (page, out):
    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    page.get_by_role("button", name="Import statement").click()
    dialog = page.get_by_role("dialog", name="Import a bank statement")
    dialog.wait_for()
    dialog.get_by_role("combobox", name="Source").click()
    page.get_by_role("option", name=re.compile(r"^Cashbook")).click()
    dialog = page.get_by_role("dialog", name="Import a petty cash statement")
    dialog.locator("input[type=file]").set_input_files(str(statement))
    dialog.get_by_role("button", name="Read statement").click()
    dialog.get_by_text(re.compile(r"^2 expense records")).wait_for(timeout=60_000)

    text = dialog.inner_text()
    check("₹550" in text, "Review totals both spends, the Collect payment included (₹550)")
    check("shop-requested" not in text.lower(), "Review shows no 'shop-requested payments' box")
    save(page, out, "01-review")

    groups = dialog.get_by_role("button", name=re.compile(r"Petty Cash"))
    groups.first.click()
    dialog.get_by_text(f"Walk collect {STAMP}").wait_for(timeout=10_000)
    check(True, "the Collect payment is listed among the spends to create")
    save(page, out, "02-collect-in-its-group")

    dialog.get_by_role("button", name="Create 2 records").click()
    page.wait_for_timeout(2000)
    devenv("run", a.task, "worker", "--queue", "long", "--burst")
    page.wait_for_timeout(4000)
    save(page, out, "03-created")

    state = db()
    (out / "03-db.json").write_text(json.dumps(state, indent=2))
    for key, amount in (("collect", 480.0), ("spend", 70.0)):
        got = state[seeded[key]]
        line, expense = got["line"], got["expense"]
        check(line and line["row_status"] == "Settled", f"DB: the {key} line is Settled ({line and line['row_status']})")
        check(expense is not None and float(expense["amount"]) == amount
              and expense["cashbook_batch"] == line["import_batch"] and expense["payment_ref"] == seeded[key],
              f"DB: the {key}'s Expense {expense and expense['name']} is ₹{amount}, marked with its import, "
              f"payment_ref its Txn Id")
    check(state[seeded["collect"]]["line"]["row_kind"] == "Collect Payment", "DB: the line keeps its Type")
    print(f"evidence: {out}")
