#!/usr/bin/env python3
"""Walk the "Invoice Added By" column of Vendor Invoice Recon as an Accountant (#1647).

    devenv.sh run <task> set-password walk-accountant@example.com <pw>     # after the seed's first run
    python3 .claude/skills/verify/bin/walk_vendor_invoice_recon.py --task <task> --password <pw> [--shots <dir>]

It runs `vendor_invoice_recon_seed.py` first (idempotent): two Pending invoices get a made-up uploader each, one
with a long full name, one with no name (the column shows the email). Then, as the Accountant, for each tab that
shows the column (sidebar Vendor Invoice Recon -> Pending Invoice Approvals, then All Invoices, its search box
narrowed to the PO):

- the cell shows the uploader's full name (or the email), one line, cut with "…" (`text-overflow: ellipsis` and
  the text wider than its box), ending inside its own cell, never under the Vendor column;
- a hover opens a tooltip with the whole text;
- the DB row: the invoice's `uploaded_by`, and the Nirmaan Users full name (none for the email row).

Every check prints `ok …`; a miss raises, saves `FAIL.*` and exits 1. Evidence: `$VERIFY_OUT`, else
~/claude-artifacts/verify/<task>/<UTC time>/. With `--shots`, each hovered cell is also saved there at half scale.
"""

import argparse
import json
import re
import subprocess
from pathlib import Path

from drive import save, session, sidebar
from playwright.sync_api import Page

ROOT = Path(__file__).resolve().parents[4]
BIN = ROOT / ".claude/skills/verify/bin"
ACCOUNTANT = "walk-accountant@example.com"
LONG_NAME = "Walkerton Fairweather-Longbottom Montgomery"
NO_NAME_EMAIL = "walk-no-name-uploader.for-recon@example-builders.test"

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--password", required=True)
ap.add_argument("--shots", type=Path)
a = ap.parse_args()


def expect(ok: bool, what: str) -> None:
    if not ok:
        raise AssertionError(f"MISS: {what}")
    print(f"ok   {what}")


def env_script(name: str, *args: str) -> str:
    res = subprocess.run([str(ROOT / "scripts/devenv/devenv.sh"), "script", a.task, str(BIN / name), *args],
                         capture_output=True, text=True, check=True)
    return res.stdout.strip().splitlines()[-1]


picked = json.loads(env_script("vendor_invoice_recon_seed.py"))
db = json.loads(env_script("vendor_invoice_recon_db.py", picked["long_name"], picked["email"]))
CASES = [(db[picked["long_name"]], LONG_NAME, "full-name"), (db[picked["email"]], NO_NAME_EMAIL, "email")]

expect(db[picked["long_name"]]["uploaded_by"] == "walk-long-name@example.com"
       and db[picked["long_name"]]["full_name"] == LONG_NAME, f"DB: {picked['long_name']} uploaded by {LONG_NAME}")
expect(db[picked["email"]]["uploaded_by"] == NO_NAME_EMAIL and db[picked["email"]]["full_name"] is None,
       f"DB: {picked['email']} uploaded by {NO_NAME_EMAIL}, who has no Nirmaan Users name")


def check_cell(page: Page, out: Path, tab: str, row_db: dict, shown: str, slug: str) -> None:
    row = page.get_by_role("row").filter(has=page.get_by_role("link", name=row_db["document_name"], exact=True))
    cell = row.get_by_role("cell", name=shown, exact=True)
    cell.wait_for(timeout=30_000)
    text = cell.get_by_text(shown, exact=True)
    m = text.evaluate("""el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(),
        c = el.closest('td').getBoundingClientRect();
        return {ellipsis: s.textOverflow, nowrap: s.whiteSpace, scroll: el.scrollWidth, client: el.clientWidth,
                right: r.right, cellRight: c.right}; }""")
    where = f"{tab}, {row_db['document_name']}"
    expect(m["ellipsis"] == "ellipsis" and m["nowrap"] == "nowrap", f"{where}: {shown!r} is one line, cut with an ellipsis")
    expect(m["scroll"] > m["client"], f"{where}: the text is wider than its box, so the ellipsis shows")
    expect(m["right"] <= m["cellRight"], f"{where}: the text ends inside its own cell ({m['right']:.0f} <= {m['cellRight']:.0f})")

    text.hover()
    tip = page.get_by_role("tooltip")
    tip.wait_for(timeout=5_000)
    expect(tip.inner_text().strip() == shown, f"{where}: hover shows the whole text {shown!r}")
    save(page, out, f"{tab.lower().replace(' ', '-')}-{slug}")
    if a.shots:
        a.shots.mkdir(parents=True, exist_ok=True)
        box = row.bounding_box()
        page.screenshot(path=str(a.shots / f"_{tab}-{slug}.png"), scale="css",
                        clip={"x": 0, "y": max(box["y"] - 120, 0), "width": 1440, "height": box["height"] + 240})
    page.keyboard.press("Escape")
    tip.wait_for(state="hidden", timeout=5_000)


with session(a.task, ACCOUNTANT, a.password) as (page, out):
    (out / "db.json").write_text(json.dumps(db, indent=2))
    sidebar(page, "Vendor Invoice Recon")
    page.get_by_role("button", name="Pending Invoice Approvals", exact=True).click()
    page.wait_for_url(re.compile(r"tab=pending(&|$)"))
    page.wait_for_load_state("networkidle")
    for row_db, shown, slug in CASES:
        check_cell(page, out, "Pending Invoice Approvals", row_db, shown, slug)

    page.get_by_role("button", name="All Invoices", exact=True).click()
    page.wait_for_url(re.compile(r"tab=history(&|$)"))
    page.wait_for_load_state("networkidle")
    search = page.get_by_role("textbox", name=re.compile(r"^Search by PO"))
    for row_db, shown, slug in CASES:
        search.fill(row_db["document_name"])
        # The search is debounced: wait until every row is the PO's, or the redraw closes the hover's tooltip.
        page.wait_for_function("""doc => { const rows = [...document.querySelectorAll('tbody tr')]
            .filter(r => r.querySelector('a')); return rows.length > 0 && rows.every(r => r.textContent.includes(doc)); }""",
                               arg=row_db["document_name"], timeout=30_000)
        page.wait_for_load_state("networkidle")
        check_cell(page, out, "All Invoices", row_db, shown, slug)
    print(f"evidence: {out}")
