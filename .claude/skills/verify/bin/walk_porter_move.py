#!/usr/bin/env python3
"""Walk #1759: an Accountant Lead opens Move on a Porter line and sees the label rule and the delivery's details. It
reads the env's own data, writes nothing, and asserts each step on screen against a DB read; it exits 1 when one is
not seen (it walks on past a miss, and lists every miss at the end).

    python3 .claude/skills/verify/bin/walk_porter_move.py --task <task> --lead <email> --password <pw>

The user needs the password on the env DB (`devenv.sh run <task> set-password <email> <pw>`). The lines are the env's
own Porter lines, one per ledger, picked by `porter_move_db.py` (Settled, its expense created by the import, Move
not refused, an invoice PDF first). Every dialog is cancelled, so nothing moves.

For a Non Project line, then a Project line:
 1. Sidebar Bulk Import Transactions -> Matched / Settled – Outflow -> searched to its CRN: the line's button reads
    "Move to a project" (Non Project) or "Change project" (Project).
 2. Click it: the dialog is titled the same, shows `Now: <placement> (<expense>)` and the details row: From → To, City,
    Fare, Reverse-charge GST, Invoice <number> and the Invoice PDF link, each as the Porter Order and Invoice hold it.
    The run button reads the same words. Cancel.
 3. Dashboard -> the expense list -> Paid -> searched by Amount, the row holding its CRN -> Edit (when the row offers it): the locked Project
    row's link reads the same words; following it opens the dialog with that title. Cancel.
"""

import argparse
import json
import re
import subprocess

from cashbook_walk import search
from drive import save, session, sidebar

BIN = ".claude/skills/verify/bin"
SETTLED_TAB = re.compile(r"^Matched \/ Settled – Outflow")
WORDS = {"Non Project Expenses": "Move to a project", "Project Expenses": "Change project"}
CARD = {"Non Project Expenses": "Non-Project Expenses", "Project Expenses": "Project Expenses"}

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--lead", required=True)
ap.add_argument("--password", required=True)
a = ap.parse_args()

MISSES: list[str] = []


def devenv(*args: str) -> str:
    return subprocess.run(["scripts/devenv/devenv.sh", *args], capture_output=True, text=True, check=True).stdout


def check(ok: bool, what: str) -> bool:
    print(f"{'seen' if ok else 'NOT SEEN'}: {what}")
    if not ok:
        MISSES.append(what)
    return ok


def inr(value: float) -> str:
    """`formatToIndianRupee` for the figures a Porter order holds (two decimals, Indian grouping)."""
    whole, frac = f"{float(value):.2f}".split(".")
    head, tail = whole[:-3], whole[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    return "₹" + ",".join(([head] if head else []) + groups + [tail]) + "." + frac


out_db = devenv("script", a.task, f"{BIN}/porter_move_db.py")
LINES = json.loads(next(line for line in out_db.splitlines() if line.startswith("JSON:"))[5:])


def details_of(dialog, line: dict, step: str) -> None:
    details = dialog.get_by_test_id("move-details").first
    details.wait_for(timeout=30_000)
    text = " ".join(details.inner_text().split())
    dash = lambda v: " ".join((v or "").split()) or "--"  # noqa: E731  # the browser collapses runs of spaces
    for words, what in (
        (f"From → To: {dash(line['from_address'])} → {dash(line['to_address'])}", "from and to addresses"),
        (f"City: {dash(line['city'])}", "city"),
        (f"Fare: {inr(line['fare'])}", "fare"),
        (f"Reverse-charge GST: {inr(line['rcm_gst'] or 0)}", "RCM GST"),
        (f"Invoice: {dash(line['invoice_number'])}", "invoice number"),
    ):
        check(words in text, f"1759-41 {step}: the details show the {what} as the DB holds it ({words!r})")
    pdf = details.get_by_role("link", name="Invoice PDF")
    if line["has_pdf"]:
        check(pdf.count() == 1 and "porter_invoice_pdf" in (pdf.get_attribute("href") or ""),
              f"1759-41 {step}: the details link the invoice PDF through the expense")
    else:
        check(pdf.count() == 0, f"1759-41 {step}: no PDF link on an expense with no invoice attachment")


def open_line(page, line: dict):
    sidebar(page, "Bulk Import Transactions")
    page.get_by_role("heading", name="Bulk Import Transactions").wait_for()
    page.get_by_role("button", name=SETTLED_TAB).click()
    search(page, line["crn"])
    row = page.get_by_role("row").filter(has_text=line["crn"][-6:])
    row.first.wait_for(timeout=30_000)
    return row.first


with session(a.task, a.lead, a.password) as (page, out):
    (out / "lines.json").write_text(json.dumps(LINES, indent=2, default=str))
    for n, (doctype, line) in enumerate(LINES.items()):
        words = WORDS[doctype]
        step = f"{doctype} {line['crn'] if line else '-'}"
        if not check(line is not None, f"the env holds a movable Porter line on {doctype}"):
            continue
        row = open_line(page, line)
        button = row.get_by_role("button", name=words, exact=True)
        check(button.count() == 1, f"1759-{37 if n == 0 else 38} {step}: the line's button reads {words!r}")
        save(page, out, f"{n}1-line")
        button.click()
        page.get_by_role("dialog").wait_for(timeout=30_000)
        dialog = page.get_by_role("dialog", name=words, exact=True)
        page.wait_for_timeout(1500)  # the title is "Move" until the plan arrives
        if not check(dialog.count() == 1, f"1759-39 {step}: the dialog is titled {words!r}"):
            save(page, out, f"{n}2-dialog-title")
            page.keyboard.press("Escape")
            continue
        details_of(dialog, line, step)
        placement = "Non-Project Expense" if doctype == "Non Project Expenses" else f"Project Expense on {line['project_name']}"
        check(f"Now: {placement} ({line['expense']})" in dialog.inner_text(),
              f"1759-46 {step}: the dialog shows where the expense is now")
        check(dialog.get_by_role("button", name=words, exact=True).count() == 1,
              f"1759-39 {step}: the dialog's run button reads {words!r}")
        save(page, out, f"{n}2-dialog")
        dialog.get_by_role("button", name="Cancel").click()
        dialog.wait_for(state="hidden")

        # 3: the expense's edit dialog.
        sidebar(page, "Dashboard")
        page.get_by_text(CARD[doctype], exact=True).first.click()
        page.wait_for_load_state("networkidle")
        page.get_by_role("button", name=re.compile(r"^Paid \d+$")).click()
        page.wait_for_load_state("networkidle")
        # The Project list has no Payment Ref search: search by Amount, then take the row holding the CRN.
        page.get_by_role("combobox").filter(has_text="Description").first.click()
        page.get_by_role("option", name="Amount", exact=True).click()
        search(page, f"{float(line['amount']):g}")
        listed = page.get_by_role("row").filter(has_text=line["crn"])
        listed.first.wait_for(timeout=30_000)
        pencil = listed.first.locator("button:has(svg.lucide-pencil)")
        if not pencil.count():
            print(f"not walked: {step}: the Paid row offers this user no Edit, so no edit dialog hint")
            save(page, out, f"{n}3-no-edit")
            continue
        pencil.first.click()
        edit = page.get_by_role("alertdialog")
        edit.wait_for()
        link = edit.get_by_role("link", name=words, exact=True)
        link.wait_for(timeout=30_000)
        check(link.count() == 1, f"1759 {step}: the edit dialog's locked Project row links {words!r}")
        save(page, out, f"{n}3-edit-dialog")
        link.click()
        dialog = page.get_by_role("dialog", name=words, exact=True)
        dialog.wait_for(timeout=30_000)
        details_of(dialog, line, f"{step} from the edit dialog")
        save(page, out, f"{n}4-dialog-from-edit")
        dialog.get_by_role("button", name="Cancel").click()

    after = json.loads(next(ln for ln in devenv("script", a.task, f"{BIN}/porter_move_db.py").splitlines()
                            if ln.startswith("JSON:"))[5:])
    check(all((after[d] or {}).get("expense") == (LINES[d] or {}).get("expense") for d in LINES),
          "DB: each walked line still points at the same expense (nothing moved)")
    print(f"evidence: {out}")

print(f"misses: {len(MISSES)}")
for miss in MISSES:
    print(f"  NOT SEEN: {miss}")
raise SystemExit(1 if MISSES else 0)
