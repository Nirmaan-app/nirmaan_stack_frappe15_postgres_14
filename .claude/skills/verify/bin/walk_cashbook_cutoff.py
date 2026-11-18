#!/usr/bin/env python3
"""Walk #1715: the Cashbook import period and its ₹0-record fills read only the lines the 1 Apr 2026 cutoff keeps, and
the Review refunds heading says where a refund goes. Each step is asserted on screen and by a DB read; it exits 1 when
one is not seen (it walks on past a miss, and lists every miss at the end).

    python3 .claude/skills/verify/bin/walk_cashbook_cutoff.py --task <task> --accountant <email> --password <pw>

The user needs the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). It uploads two made-up
statements (`cashbook_cutoff_seed.py`; every spend's Txn Id carries a stamp, so every run is a new import). The
import stays. As the Accountant:
 1. Sidebar Bulk Import Transactions -> Import statement -> Source Cashbook -> the statement -> Read statement. Review
    shows the period "2026-04-01 to 2026-11-17" (its first line is 25 Mar 2026), says "2 lines before 1 Apr 2026 left
    out", does not say an old Internal Transfer record gets its amount (the 25 Mar Bank → VA line repeats a ₹0
    record), and heads the refund "1 wallet refund will be booked as a minus expense: where its spend is booked, or
    else where its remark says".
 2. Create (the walk drains the job's queue) -> Close. DB: the import's period is 1 Apr to 17 Nov 2026,
    `lines_before_cutoff` is 2, neither early line is stored, and the ₹0 record still holds ₹0.
 3. Import statement -> the early file (the same Bank → VA line and a March spend): refused, with why, and no Create;
    DB: the ₹0 record still holds ₹0.
"""

import argparse
import datetime
import json
import re
import subprocess

from cashbook_walk import open_import
from drive import save, session

BIN = ".claude/skills/verify/bin"

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--accountant", required=True)
ap.add_argument("--password", required=True)
a = ap.parse_args()

STAMP = datetime.datetime.now(datetime.timezone.utc).strftime("%m%d%H%M%S")
MISSES: list[str] = []


def devenv(*args: str) -> str:
    return subprocess.run(["scripts/devenv/devenv.sh", *args], capture_output=True, text=True, check=True).stdout


def check(ok: bool, what: str) -> bool:
    print(f"{'seen' if ok else 'NOT SEEN'}: {what}")
    if not ok:
        MISSES.append(what)
    return ok


seeded = dict(re.findall(r"^(\w+): (.*)$", devenv("script", a.task, f"{BIN}/cashbook_cutoff_seed.py", STAMP), re.M))


def db(*extra: str) -> dict:
    out = devenv("script", a.task, f"{BIN}/cashbook_cutoff_db.py", seeded["record"], *extra)
    return json.loads(next(line for line in out.splitlines() if line.startswith("JSON:"))[5:])


with session(a.task, a.accountant, a.password) as (page, out):
    (out / "seeded.json").write_text(json.dumps(seeded, indent=2))

    # 1. Review.
    dialog = open_import(page, seeded["statement"])
    dialog.get_by_text("2 lines before 1 Apr 2026 left out").first.wait_for(timeout=60_000)
    text = dialog.inner_text()
    check("2026-04-01 to 2026-11-17" in text and "2026-03-25" not in text,
          "1715-1: Review's period starts at the first kept line, 2026-04-01 to 2026-11-17 (the file starts 25 Mar)")
    check("old Internal Transfer record" not in text,
          "1715-2: Review does not say the 25 Mar Bank → VA line gives an old ₹0 record its amount")
    heading = "1 wallet refund will be booked as a minus expense: where its spend is booked, or else where its remark says"
    check(heading in text, f"1715-3: Review heads the refund {heading!r}")
    save(page, out, "01-review")

    # 2. Create.
    dialog.get_by_role("button", name=re.compile(r"^Create \d+ record")).click()
    page.wait_for_timeout(2000)
    # An env runs no RQ worker: drain the `long` queue, as `walk_cashbook_refunds.py` does.
    devenv("run", a.task, "worker", "--queue", "long", "--burst")
    page.wait_for_timeout(4000)
    save(page, out, "02-created")
    state = db("--txn", seeded["KEPT1"])
    (out / "02-db.json").write_text(json.dumps(state, indent=2))
    batch = state.get("batch") or {}
    check((batch.get("period_from"), batch.get("period_to")) == ("2026-04-01", "2026-11-17"),
          f"1715-1: DB the import's period is 2026-04-01 to 2026-11-17 ({batch})")
    check(batch.get("lines_before_cutoff") == 2 and seeded["EARLY"] not in state["stored"]
          and seeded["TOPUP"] not in state["stored"],
          f"1715-2: DB lines_before_cutoff is 2 and neither early line is stored ({state['stored']})")
    check(state["record_amount"] == 0.0, f"1715-2: DB the ₹0 record {seeded['record']} still holds ₹0")
    dialog.get_by_role("button", name="Close").last.click()
    dialog.wait_for(state="hidden")

    # 3. A file of only early lines, one of them the Bank → VA repeat.
    dialog = open_import(page, seeded["early"])
    refusal = dialog.get_by_text(re.compile(r"^Not imported\. All 2 lines in .* are dated before 1 Apr 2026"))
    refusal.wait_for(timeout=60_000)
    create = dialog.get_by_role("button", name=re.compile(r"^Create \d+ record"))
    check(create.filter(visible=True).count() == 0 or not create.first.is_enabled(),
          "1715-2: a file of only early lines is refused, saying why, even with a Bank → VA repeat in it")
    save(page, out, "03-only-early-refused")
    after = db()
    (out / "03-db.json").write_text(json.dumps(after, indent=2))
    check(after["record_amount"] == 0.0, f"1715-2: DB the ₹0 record {seeded['record']} still holds ₹0")
    print(f"evidence: {out}")

if MISSES:
    print(f"{len(MISSES)} NOT SEEN:")
    for miss in MISSES:
        print(f"  - {miss}")
    raise SystemExit(1)
print("all seen")
