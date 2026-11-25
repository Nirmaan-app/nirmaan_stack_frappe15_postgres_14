#!/usr/bin/env python3
"""Walk #1758: an Accountant Lead moves a Cashbook Non Project spend to a project with the phrase box ticked; the alias
is saved, and the next Cashbook import places the phrase on that project. Each step is asserted on screen and by a DB
read; it exits 1 when one is not seen (it walks on past a miss, and lists every miss at the end).

    python3 .claude/skills/verify/bin/walk_cashbook_phrase.py --task <task> --lead <email> --password <pw>

The lead needs the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). It seeds
(`cashbook_phrase_seed.py`; every run stamps new projects and Txn Ids) two made-up Won projects sharing one word,
`QX Walkmall<n> Court` and `Walkmall<n> Annexe`, and a Cashbook import whose courier spend (Rs 2,380) reads "Courier
charges for QX Walkmall<n> site": that shared word names neither project, so the spend is booked Non Project.

As the Accountant Lead:
 1. Sidebar Bulk Import Transactions -> Matched / Settled – Outflow -> the spend's line -> "Move to a project": the
    dialog shows no phrase box before a destination is chosen.
 2. Choose No project: no phrase box (Non Project learns nothing).
 3. Choose `QX Walkmall<n> Court`: the box "Next time, put spends that mention “QX Walkmall<n>” on this project",
    ticked, the phrase pre-filled "QX Walkmall<n>" (the remark's words that name the project). Untick: the phrase
    field goes; tick again: it is back.
 4. The type Petty Cash (the env's rules type a courier remark one a project does not take), a reason; Move -> "1 expense moved to <project>." and "Next time, spends that mention “QX Walkmall<n>” go to
    <project>." DB: one active alias "QX Walkmall<n>" -> the project, made by the lead; the expense on the project.
 5. The next Cashbook import of the same remark (seeded: `cashbook_phrase_seed.py again`). DB: its line is placed on
    the project, a Project Expense on it.
"""

import argparse
import datetime
import json
import re
import subprocess

from cashbook_walk import search
from drive import save, session, sidebar

BIN = ".claude/skills/verify/bin"
REASON = "Walk 1758: the remark names the project by its nickname"
SETTLED_TAB = re.compile(r"^Matched \/ Settled – Outflow")

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--lead", required=True)
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


def seed(*args: str) -> dict:
    return dict(re.findall(r"^(\w+): (.*)$", devenv("script", a.task, f"{BIN}/cashbook_phrase_seed.py", *args), re.M))


seeded = seed("seed", STAMP)
TXN, PROJECT, PROJECT_NAME, PHRASE = seeded["txn"], seeded["project"], seeded["project_name"], seeded["phrase"]


def db(txn: str) -> dict:
    out = devenv("script", a.task, f"{BIN}/cashbook_phrase_db.py", PHRASE, txn)
    return json.loads(next(line for line in out.splitlines() if line.startswith("JSON:"))[5:])


def choose(page, dialog, label: str, value: str):
    """A FuzzySearchSelect in the dialog: open it by its label's sibling, type, take the option."""
    dialog.get_by_text(label, exact=True).locator("xpath=following-sibling::*[1]").click()
    page.keyboard.type(value)
    page.wait_for_timeout(600)
    page.get_by_role("option", name=value, exact=True).first.click()
    page.wait_for_timeout(500)


before = db(TXN)
check(before["expense"] and before["expense"]["doctype"] == "Non Project Expenses" and not before["aliases"],
      f"seed: the spend {TXN} is a Non Project Expense and no alias reads as {PHRASE!r}")

with session(a.task, a.lead, a.password) as (page, out):
    (out / "seeded.json").write_text(json.dumps({**seeded, "before": before}, indent=2, default=str))
    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    page.get_by_role("button", name=SETTLED_TAB).click()
    search(page, TXN)
    row = page.get_by_role("row").filter(has_text=seeded["remark"])
    row.first.wait_for(timeout=30_000)
    check(row.count() == 1, f"the search finds the one line of {TXN}")
    save(page, out, "01-settled-line")
    row.first.get_by_role("button", name="Move to a project").click()
    dialog = page.get_by_role("dialog", name="Move to a project")
    dialog.get_by_test_id("move-details").first.wait_for(timeout=30_000)
    box = dialog.get_by_test_id("learn-phrase")
    check(box.count() == 0, "1758: no phrase box before a destination is chosen")

    choose(page, dialog, "Move to", "No project (Non-Project expense)")
    check(box.count() == 0, "1758 story 52: no phrase box for a move to Non Project")
    save(page, out, "02-non-project-no-box")

    choose(page, dialog, "Move to", PROJECT_NAME)
    box.wait_for(timeout=10_000)
    tick = box.get_by_role("checkbox")
    field = box.get_by_label("Phrase")
    check(tick.get_attribute("aria-checked") == "true", "1758 story 47: the box is ticked by default")
    check(f"Next time, put spends that mention “{PHRASE}” on this project" in box.inner_text(),
          "1758 story 47: the box reads the sentence with the phrase")
    check(field.input_value() == PHRASE, f"1758 story 48: the phrase is pre-filled from the remark ({PHRASE!r})")
    save(page, out, "03-project-box-ticked")
    tick.click()
    check(tick.get_attribute("aria-checked") == "false" and field.count() == 0,
          "1758 story 49: unticked, the phrase field goes")
    save(page, out, "04-unticked")
    tick.click()
    check(tick.get_attribute("aria-checked") == "true" and field.input_value() == PHRASE,
          "1758: ticked again, the phrase is back")

    # The env's own expense rules type a courier remark "Postage & Courier", which a project does not take.
    choose(page, dialog, "Expense type", "Petty Cash")
    dialog.get_by_placeholder("Why does it belong there?").fill(REASON)
    page.wait_for_timeout(300)
    save(page, out, "05-ready")
    dialog.get_by_role("button", name="Move to a project").click()
    dialog.get_by_text(f"1 expense moved to {PROJECT_NAME}.").wait_for(timeout=60_000)
    check(True, f"1758: the dialog says 1 expense moved to {PROJECT_NAME}")
    check(f"Next time, spends that mention “{PHRASE}” go to {PROJECT_NAME}." in dialog.inner_text(),
          "1758: the outcome says what was learned")
    save(page, out, "06-moved-and-learned")
    dialog.get_by_role("button", name="Done").click()

    after = db(TXN)
    (out / "06-db.json").write_text(json.dumps(after, indent=2, default=str))
    check([(r["keyword"], r["project"], r["active"], r["owner"]) for r in after["aliases"]]
          == [(PHRASE, PROJECT, 1, a.lead)],
          f"1758 AC1/AC4: DB one active alias {PHRASE!r} -> {PROJECT}, made by the lead")
    check((after["expense"] or {}).get("projects") == PROJECT, f"1758: DB the moved expense is on {PROJECT}")
    print(f"evidence: {out}")

    again = seed("again", STAMP, STAMP + "N")
    nxt = db(again["txn"])
    (out / "07-next-import-db.json").write_text(json.dumps({**again, **nxt}, indent=2, default=str))
    check(nxt["line"]["resolved_project"] == PROJECT and (nxt["expense"] or {}).get("doctype") == "Project Expenses"
          and nxt["expense"].get("projects") == PROJECT,
          f"1758 AC3: DB the next import ({again['batch']}) places {again['txn']} on {PROJECT}")

print(f"misses: {len(MISSES)}")
for miss in MISSES:
    print(f"  NOT SEEN: {miss}")
raise SystemExit(1 if MISSES else 0)
