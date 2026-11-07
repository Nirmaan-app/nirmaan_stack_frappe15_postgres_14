"""Seed one made-up Cashbook import with five open Collect payments whose stored bills were checked at import
(#1642), for `walk_collect` in `walk_expense_bills.py`. Run on an env, never on site `localhost`:

    devenv.sh script <task> .claude/skills/verify/bin/collect_bills_seed.py <stamp> <accountant email>

The real-file fixture's Collect payment with a bill link (₹480) is copied five times, each with a Txn Id and a remark
carrying `<stamp>`, staged as the Accountant (`cashbook._stage`) and its job run inline (`_cashbook_worker`):
  * M  -- one bill, read: Matched (the stand-in reader gives the line amount)    -> "Will be auto-approved"
  * X  -- one bill, read: Mismatched (the line amount + ₹50)                      -> "Will go to Pending Approval"
  * N  -- two bill links, merged: Not checked, never read                         -> "Will go to Pending Approval"
  * K  -- one bill, its reading not yet run: Checking                             -> "Checking"
  * S  -- one bill, read: Matched; the walk skips it (no Expense bill)

⚠️ WHAT IS SEEDED, NOT LIVE. The env is cut off from the wallet's bill storage and its reader key is refused, so the
download (`cashbook_bills.fetch_bill`) answers made-up files and the line readings run inline with a stand-in reader
(`expense_bills.reading.read_bill`); the reading jobs the import queues are held back, never reach the queue. Every
other step is the app's own code.

Prints `COLLECT_BILLS_SEED {"M": {"line": ..., "remarks": ..., "amount": ...}, ...}`.
"""

import dataclasses
import io
import json
import sys
from decimal import Decimal
from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import cashbook_bills as bills
from nirmaan_stack.api.outflow_import.test_cashbook_bills import STATEMENT
from nirmaan_stack.api.outflow_import.test_cashbook_collect_payments import COLLECT_WITH_LINK
from nirmaan_stack.services.expense_bills import line_check, reading
from nirmaan_stack.services.expense_bills.bill_check import BillRead
from nirmaan_stack.services.outflow_import.bill_download import BillFile
from nirmaan_stack.services.outflow_import.parser import parse_statement

STAMP, ACCOUNTANT = sys.argv[1], sys.argv[2]
JOB = "nirmaan_stack.services.expense_bills.line_check.check_collect_line"
KEYS = ("M", "X", "N", "K", "S")

parsed = parse_statement(STATEMENT.read_bytes(), source="Cashbook")
(collect,) = [row for row in parsed.rows if row.transfer_id == COLLECT_WITH_LINK]
rows = []
for key in KEYS:
    links = collect.bill_links
    if key == "N":
        links = (links[0], links[0].replace("1.jpeg", "2.pdf"))
    rows.append(dataclasses.replace(
        collect,
        transfer_id=f"WALKCP{key}{STAMP}",
        remarks=f"Walk collect {key} {STAMP}",
        bill_links=links,
    ))
parsed = dataclasses.replace(parsed, rows=rows)


# ⚠️ EACH FILE'S BYTES ARE THIS RUN'S OWN: Frappe gives a saved file the URL of any File with the same content.
def pdf(tag: str) -> bytes:
    from pypdf import PdfWriter

    writer, out = PdfWriter(), io.BytesIO()
    writer.add_blank_page(width=595, height=842)
    writer.add_metadata({"/Title": f"walk collect bill {tag}"})
    writer.write(out)
    return out.getvalue()


def jpeg(tag: str) -> bytes:
    from PIL import Image, ImageDraw

    out, image = io.BytesIO(), Image.new("RGB", (300, 400), "white")
    ImageDraw.Draw(image).text((20, 20), f"walk collect bill {tag}", fill="black")
    image.save(out, format="JPEG")
    return out.getvalue()


calls = {"n": 0}


def fetch(url: str) -> BillFile:
    calls["n"] += 1
    tag = f"{STAMP}-{calls['n']}"
    return BillFile(pdf(tag), "pdf") if url.split("?")[0].endswith(".pdf") else BillFile(jpeg(tag), "jpeg")


held: list[str] = []
real_enqueue = frappe.enqueue


def enqueue(method, **kwargs):
    if method == JOB:
        held.append(kwargs["line"])
        return None
    return real_enqueue(method, **kwargs)


# The made-up Accountant Lead who skips S (the access gate leaves a new user open), as `expense_bill_approval_seed.py`.
LEAD = "walk-accountant-lead@example.com"
if not frappe.db.exists("User", LEAD):
    user = frappe.new_doc("User")
    user.update({"email": LEAD, "first_name": "Walk Accountant Lead", "send_welcome_email": 0})
    user.flags.no_welcome_mail = True
    user.insert(ignore_permissions=True)
frappe.get_doc("User", LEAD).add_roles("Nirmaan Accountant Lead")
frappe.db.set_value("Nirmaan Users", LEAD, "role_profile", "Nirmaan Accountant Lead Profile", update_modified=False)
frappe.db.commit()

frappe.set_user(ACCOUNTANT)
batch = cb._stage(
    parsed, cb._build_plan(parsed), file_url=f"/private/files/walk-collect-{STAMP}.xlsx",
    filename=f"walk-collect-{STAMP}.xlsx", user=ACCOUNTANT,
).name
frappe.db.commit()
with patch.object(bills, "fetch_bill", fetch), patch.object(frappe, "enqueue", side_effect=enqueue):
    cb._cashbook_worker(batch, ACCOUNTANT)

answer = {}
for key in KEYS:
    line = frappe.db.get_value(
        "Outflow Import Row", {"import_batch": batch, "transfer_id": f"WALKCP{key}{STAMP}"},
        ["name", "amount", "remarks"], as_dict=True,
    )
    answer[key] = {"line": line.name, "remarks": line.remarks, "amount": float(line.amount)}

answers = {
    "M": BillRead(total=Decimal(str(answer["M"]["amount"])), invoice_no=f"WALK-CP-M-{STAMP}"),
    "X": BillRead(total=Decimal(str(answer["X"]["amount"])) + 50, invoice_no=f"WALK-CP-X-{STAMP}"),
    "S": BillRead(total=Decimal(str(answer["S"]["amount"])), invoice_no=f"WALK-CP-S-{STAMP}"),
}
for key, read in answers.items():
    with patch.object(reading, "read_bill", lambda url, read=read: reading.Reading(read, {"stand_in": True})):
        line_check.check_collect_line(line=answer[key]["line"])
frappe.db.commit()
answer["batch"] = batch
print("COLLECT_BILLS_SEED " + json.dumps(answer))
