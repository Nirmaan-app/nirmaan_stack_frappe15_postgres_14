#!/usr/bin/env python3
"""Walk #1628: the 8 retired Skip Types are gone from the Skipped popup's Skip Type filter and from the Unskip warning,
and Failed payment bounced back and Card payment received work as before. Each step is asserted on screen and by a DB
read; it exits 1 when one is not seen (it walks on past a miss, and lists every miss at the end).

    python3 .claude/skills/verify/bin/walk_skip_types.py --task <task> --lead <email> --password <pw>

The user needs the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). The seed
(`skip_types_seed.py`) adds one made-up ICICI line Skipped as Failed payment bounced back; nothing is unskipped. The
2026-11-17 template still holds 295 old Cashbook lines Skipped as "Cashbook internal movement" (pre-reset data;
production holds none), which is what makes step 1 a real check. As the Accountant Lead:
 1. Sidebar Bulk Import Transactions -> the `N Skipped` chip -> the Skipped transfers popup -> Filter Skip Type: the
    funnel offers none of the 8 retired kinds, though the DB still holds lines of one; it offers Failed payment
    bounced back and Card payment received.
 2. Tick Card payment received: its rows' Unskip is disabled with "A payment into the card is never a spend or a
    receipt." (as before).
 3. Untick it, search the seeded line -> Unskip: the box warns that a bank rule read it as money moving between our
    own accounts (Failed payment bounced back), as before. Cancel; DB: the line is still Skipped.
"""

import argparse
import datetime
import json
import re
import subprocess

from drive import save, session, sidebar

BIN = ".claude/skills/verify/bin"

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


seeded = dict(re.findall(r"^(\w+): (.*)$", devenv("script", a.task, f"{BIN}/skip_types_seed.py", STAMP), re.M))


def db() -> dict:
    out = devenv("script", a.task, f"{BIN}/skip_types_db.py", seeded["line"])
    return json.loads(next(line for line in out.splitlines() if line.startswith("JSON:"))[5:])


def funnel(page, popup):
    """Open the Skip Type funnel; its option labels."""
    popup.get_by_role("button", name="Filter Skip Type").click()
    options = page.locator("[data-radix-popper-content-wrapper] label")
    options.first.wait_for(timeout=30_000)
    page.wait_for_timeout(1000)
    return options


with session(a.task, a.lead, a.password) as (page, out):
    (out / "seeded.json").write_text(json.dumps(seeded, indent=2))
    before = db()
    (out / "01-db.json").write_text(json.dumps(before, indent=2))

    # 1. The funnel.
    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    page.get_by_role("button", name=re.compile(r"^\d+\s+Skipped$")).click()
    popup = page.get_by_role("dialog", name="Skipped transfers")
    popup.wait_for()
    page.wait_for_timeout(2500)
    options = funnel(page, popup)
    offered = [t.strip() for t in options.all_inner_texts()]
    (out / "01-offered.txt").write_text("\n".join(offered) + "\n")
    save(page, out, "01-skip-type-funnel")
    # The retired kinds as the server names them (`skip_kinds.RETIRED_SKIP_KINDS`, read by the DB helper).
    check(len(before["retired"]) == 8 and not set(before["retired"]) & set(offered) and bool(before["retired_held"]),
          f"1628-3: the funnel offers no retired kind, though the DB holds {before['retired_held']}")
    check("Failed payment bounced back" in offered and "Card payment received" in offered,
          "1628-4: the funnel still offers Failed payment bounced back and Card payment received")

    # 2. Card payment received stays locked.
    options.filter(has_text="Card payment received").first.click()
    page.keyboard.press("Escape")
    page.wait_for_timeout(2500)
    card_row = popup.get_by_role("row").filter(has_text="Card payment received").first
    card_row.wait_for(timeout=30_000)
    locked = "A payment into the card is never a spend or a receipt."
    check(card_row.get_by_role("button", name="Unskip").is_disabled() and locked in card_row.inner_text(),
          f"1628-4: a Card payment received line's Unskip is disabled: {locked!r}")
    save(page, out, "02-card-payment-locked")
    funnel(page, popup).filter(has_text="Card payment received").first.click()
    page.keyboard.press("Escape")
    page.wait_for_timeout(1500)

    # 3. The Unskip warning on the bank-rule kind that stays.
    popup.get_by_placeholder(re.compile("search", re.I)).first.fill(seeded["remark"])
    page.wait_for_timeout(2500)
    row = popup.get_by_role("row").filter(has_text=seeded["remark"]).first
    row.wait_for(timeout=30_000)
    row.get_by_role("button", name="Unskip").click()
    box = page.get_by_role("dialog", name="Unskip this transfer?")
    box.wait_for()
    page.wait_for_timeout(700)
    warning = box.get_by_role("alert").inner_text() if box.get_by_role("alert").count() else ""
    check("A bank rule read this line" in warning and "Failed payment bounced back" in warning,
          f"1628-3/4: Unskip on Failed payment bounced back warns, naming the kind ({warning!r})")
    save(page, out, "03-unskip-warning")
    box.get_by_role("button", name="Cancel").click()
    after = db()
    (out / "03-db.json").write_text(json.dumps(after, indent=2))
    check(after["line"] == {"row_status": "Skipped", "skip_kind": "Failed payment bounced back"},
          f"1628-4: DB the seeded line is still Skipped as Failed payment bounced back ({after['line']})")
    print(f"evidence: {out}")

if MISSES:
    print(f"{len(MISSES)} NOT SEEN:")
    for miss in MISSES:
        print(f"  - {miss}")
    raise SystemExit(1)
print("all seen")
