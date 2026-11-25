#!/usr/bin/env python3
"""Walk: a bill the Cashbook import copies in is approved on arrival; a person's upload still waits (#1755, spec #1753
stories 60-66), as an Accountant (an approver profile).

    devenv.sh script <task> .claude/skills/verify/bin/office_rent_seed.py      # once per env: the free Accountant
    devenv.sh run <task> set-password walk-accountant@example.com <pw>
    python3 .claude/skills/verify/bin/walk_cashbook_bill_approval.py --task <task> --password <pw>

1. `cashbook_bills_seed.py` confirms two made-up Cashbook imports as the Accountant through the real endpoint and
   runs their job (downloads and reader stood in: ONE Matched, TWO two links Not checked, LATE a later statement's
   late bill read Mismatched). DB: all three bills Approved, auto-approved, by System; LATE keeps Mismatched and its
   remark; ONE's number fills its Expense's Invoice Ref.
2. `expense_bills_seed.py` makes a made-up wallet spend. Vendor Invoice Recon -> Pending Invoices Upload -> Cashbook
   -> Attach invoice -> a made-up PDF -> Save Invoice; the spend leaves the list. DB: its bill Pending, not approved.
3. A one-shot worker on the env's `long` queue reads it (the env's reader key is refused, so Not read).
4. Pending Invoice Approvals -> Cashbook: the person's upload is listed, with its Bill check; none of the three import
   bills is; the pill's rows are the DB's waiting bills, one for one (`cashbook_bill_approval_db.py`).
5. All Invoices -> Cashbook, searched by the LATE spend: its import bill reads Mismatched and Auto-approved.

It asserts each screen's text and its DB row, and exits 1 on any miss.
"""

import argparse
import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

from drive import save, session, sidebar

ROOT = Path(__file__).resolve().parents[4]
DEVENV = str(ROOT / "scripts/devenv/devenv.sh")
BIN = ROOT / ".claude/skills/verify/bin"

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--password", required=True)
ap.add_argument("--accountant", default="walk-accountant@example.com")
a = ap.parse_args()

STAMP = datetime.datetime.now(datetime.timezone.utc).strftime("%m%d%H%M%S")


def expect(ok: bool, what: str) -> None:
    if not ok:
        raise AssertionError(f"MISS: {what}")
    print(f"ok   {what}")


def script(name: str, *args: str) -> str:
    res = subprocess.run([DEVENV, "script", a.task, str(BIN / name), *args], capture_output=True, text=True)
    if res.returncode:
        raise RuntimeError(f"{name} failed:\n{res.stdout[-2000:]}\n{res.stderr[-2000:]}")
    return res.stdout


def answer(stdout: str, tag: str) -> dict:
    return json.loads(next(l for l in stdout.splitlines() if l.startswith(f"{tag} ")).removeprefix(f"{tag} "))


def db_of(out: Path, name: str, pairs: list[str]) -> dict:
    """Each (doctype, name)'s invoice fields and Expense bills, saved as `<name>.db.json`."""
    got = answer(script("expense_bills_db.py", *pairs), "EXPENSE_BILLS_DB")
    (out / f"{name}.db.json").write_text(json.dumps(got, indent=2))
    return got


def waiting(out: Path, name: str) -> list[dict]:
    got = answer(script("cashbook_bill_approval_db.py"), "CASHBOOK_BILL_APPROVAL_DB")
    (out / f"{name}.db.json").write_text(json.dumps(got, indent=2))
    return got["waiting"]


def bill_pdf(path: Path, number: str) -> Path:
    """A one-page made-up bill with bytes of its own (the binary marker line every real PDF has)."""
    text = f"BT /F1 14 Tf 1 0 0 1 60 760 Tm (Walk Tea Stall - Invoice {number} - Rs 2,500.00) Tj ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(text)} >>\nstream\n{text}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    body, offsets = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(body))
        body += f"{i} 0 obj\n{obj}\nendobj\n"
    xref = len(body)
    body += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
    body += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    path.write_bytes(body.encode("latin-1"))
    return path


def pill(page, label: str) -> None:
    page.get_by_role("button", name=label, exact=True).click()
    page.wait_for_load_state("networkidle")


def file_name_of(bill_file: str) -> str:
    """The name a bill's URL carries: the cloud app's `file_name=`, else the path's last part."""
    m = re.search(r"[?&]file_name=([^&]+)", bill_file)
    return m.group(1) if m else bill_file.rsplit("/", 1)[-1]


# 1. The import's bills, approved on arrival.
seeded = answer(script("cashbook_bills_seed.py", STAMP, a.accountant), "CASHBOOK_BILLS_SEED")
print(f"seeded Cashbook imports: {seeded}")
spends = answer(script("expense_bills_seed.py", STAMP), "EXPENSE_BILLS_SEED")
print(f"seeded wallet spend: {spends['wallet']}")

with session(a.task, a.accountant, a.password) as (page, out):
    state = db_of(out, "01-import-bills", [part for key in ("ONE", "TWO", "LATE") for part in seeded[key][:2]])
    imports = {}
    for key in ("ONE", "TWO", "LATE"):
        spend = state[seeded[key][1]]
        expect(len(spend["bills"]) == 1, f"{key}: one Expense bill")
        bill = imports[key] = spend["bills"][0]
        expect((bill["status"], bill["auto_approved"], bill["approved_by"]) == ("Approved", 1, "System"),
               f"{key}: the import's bill landed Approved, auto-approved, by System")
        expect(bill["uploaded_by"] == a.accountant, f"{key}: attached by the Accountant who confirmed the import")
    expect(imports["ONE"]["bill_check"] == "Matched", "ONE: Matched")
    expect(state[seeded["ONE"][1]]["expense"]["invoice_ref"] == f"WALK-ONE-{STAMP}",
           "ONE: a Matched import bill still fills its Expense's Invoice Ref")
    expect(imports["TWO"]["bill_check"] == "Not checked", "TWO (two links): Not checked")
    late = imports["LATE"]
    expect(late["bill_check"] == "Mismatched" and "The bill's total is" in (late["bill_check_reason"] or ""),
           f"LATE (a later statement's bill): Mismatched kept, with its remark: {late['bill_check_reason']!r}")
    expect(not state[seeded["LATE"][1]]["expense"]["invoice_ref"], "LATE: nothing written to its Invoice Ref")

    # 2. A person's upload through Pending Invoices Upload -> Cashbook.
    pdf = bill_pdf(out / f"walk-person-upload-{STAMP}.pdf", f"WP-{STAMP}")
    search = f"Walk site tea {STAMP}"
    sidebar(page, "Vendor Invoice Recon")
    page.get_by_role("button", name="Pending Invoices Upload").click()
    page.wait_for_load_state("networkidle")
    pill(page, "Cashbook")
    page.get_by_placeholder(re.compile("search", re.I)).first.fill(search)
    row = page.get_by_role("row").filter(has_text=search)
    row.first.wait_for(timeout=30_000)
    expect(row.count() == 1, f"Pending Invoices Upload -> Cashbook: the wallet spend '{search}' waits for its invoice")
    save(page, out, "02a-upload-waiting")
    row.get_by_role("button", name="Attach invoice").click()
    page.get_by_text("Upload Invoice").wait_for()
    page.locator('input[type="file"]').last.set_input_files(str(pdf))
    page.wait_for_timeout(500)
    save(page, out, "02b-upload-dialog")
    page.get_by_role("button", name="Save Invoice").click()
    page.get_by_text("Upload Invoice").wait_for(state="hidden", timeout=60_000)
    page.get_by_role("row").filter(has_text=search).first.wait_for(state="detached", timeout=30_000)
    expect(page.get_by_role("row").filter(has_text=search).count() == 0, "the spend left Pending Invoices Upload")
    save(page, out, "02c-upload-attached")
    [upload] = db_of(out, "02-after-upload", ["Project Expenses", spends["wallet"]])[spends["wallet"]]["bills"]
    expect((upload["status"], upload["auto_approved"], upload["approved_by"]) == ("Pending", 0, None),
           "DB: a person's upload lands Pending, not approved")
    expect(upload["uploaded_by"] == a.accountant, "DB: uploaded by the Accountant")

    # 3. Its reading, on the `long` queue.
    worker = subprocess.run([DEVENV, "run", a.task, "worker", "--queue", "long", "--burst"],
                            capture_output=True, text=True)
    (out / "03-worker.txt").write_text(worker.stdout + worker.stderr)
    [upload] = db_of(out, "03-after-reading", ["Project Expenses", spends["wallet"]])[spends["wallet"]]["bills"]
    expect(upload["bill_check"] != "Checking" and upload["status"] == "Pending",
           f"DB: the upload was read ({upload['bill_check']}: {upload['bill_check_reason']}) and still waits")

    # 4. Pending Invoice Approvals -> Cashbook.
    sidebar(page, "Vendor Invoice Recon")
    page.get_by_role("button", name="Pending Invoice Approvals").click()
    page.wait_for_load_state("networkidle")
    pill(page, "Cashbook")
    mine = page.get_by_role("row").filter(has=page.locator(f'a[href*="{pdf.name}"]'))
    mine.first.wait_for(timeout=30_000)
    expect(mine.count() == 1, "Pending Invoice Approvals -> Cashbook lists the person's upload")
    expect(upload["bill_check"] in mine.first.inner_text(), f"its row shows its Bill check {upload['bill_check']!r}")
    for key, bill in imports.items():
        name = file_name_of(bill["bill_file"])
        expect(page.locator(f'a[href*="{name}"]').count() == 0, f"{key}'s import bill ({name}) is not listed")
    db_waiting = waiting(out, "04-cashbook-pill")
    expect(upload["name"] in {w["name"] for w in db_waiting}, "DB: the person's upload waits")
    expect(not {b["name"] for b in imports.values()} & {w["name"] for w in db_waiting}, "DB: no import bill waits")
    shown = page.get_by_role("row").filter(has=page.get_by_role("link", name="View")).count()
    expect(shown == len(db_waiting), f"the pill's rows ({shown}) are the DB's waiting bills ({len(db_waiting)})")
    mine.first.scroll_into_view_if_needed()
    save(page, out, "04-pending-approval-cashbook")

    # 5. All Invoices -> Cashbook: the LATE import bill, Mismatched and Auto-approved.
    page.get_by_role("button", name="All Invoices").click()
    page.wait_for_load_state("networkidle")
    pill(page, "Cashbook")
    page.get_by_placeholder(re.compile("search", re.I)).first.fill(seeded["LATE"][1])
    page.wait_for_load_state("networkidle")
    late_row = page.get_by_role("row").filter(has=page.locator(f'a[href*="{file_name_of(late["bill_file"])}"]'))
    late_row.first.wait_for(timeout=30_000)
    cells = late_row.first.inner_text()
    expect("Mismatched" in cells and "Auto-approved" in cells,
           "All Invoices -> Cashbook: the LATE import bill reads Mismatched and Auto-approved")
    save(page, out, "05-all-invoices-cashbook")
    print(f"evidence: {out}")
