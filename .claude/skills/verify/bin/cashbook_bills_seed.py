"""Seed two made-up Cashbook imports whose bills get the Bill check (#1641), for `walk_cashbook_bills` in
`walk_expense_bills.py`. Run on an env, never on site `localhost`:

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_bills_seed.py <stamp> <accountant email>

Import 1, confirmed as the Accountant through the real endpoint (`cashbook.confirm_cashbook_import`) and its job run
inline: three made-up wallet spends from the test fixture (`cashbook_sample.csv`), their Txn Ids and remarks carrying
`<stamp>`.
  * ONE   -- one bill link    -> its Expense bill is read: Matched (the stand-in reader gives the line amount).
  * TWO   -- two bill links   -> merged, Not checked, total = line amount, never read.
  * LATE  -- no bill link     -> waits for a bill.
Import 2: the same statement, LATE now with one bill link -> the late bill reaches its Expense and is read:
Mismatched (the stand-in reader gives the line amount + ₹50).

⚠️ WHAT IS SEEDED, NOT LIVE. The env is cut off from the wallet's bill storage and its reader key is refused, so the
download (`cashbook_bills.fetch_bill`) answers made-up files and the reader (`expense_bills.reading.read_bill`) is a
stand-in; the readings run inline (the reading jobs the import queues are held back, never reach the queue). Every
other step is the app's own code.

Prints `CASHBOOK_BILLS_SEED {"ONE": [doctype, name, description], ...}`.
"""

import io
import json
import sys
from decimal import Decimal
from unittest.mock import patch

import frappe
from werkzeug.datastructures import FileStorage, MultiDict

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import cashbook_bills as bills
from nirmaan_stack.api.outflow_import.test_cashbook_import import FIXTURE
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE, reading
from nirmaan_stack.services.expense_bills.bill_check import BillRead
from nirmaan_stack.services.outflow_import.bill_download import BillFile
from nirmaan_stack.services.outflow_import.tests.cashbook_xlsx import as_statement_xlsx

STAMP, ACCOUNTANT = sys.argv[1], sys.argv[2]
JOB = "nirmaan_stack.services.expense_bills.reading.check_expense_bill"
ONE_ID, LATE_ID, TWO_ID = "OBO1700000000001AAAAAA", "OBO1700000000002BBBBBB", "OBO1700000000003CCCCCC"
NO_LINK = '"No","","","",""'

lines = FIXTURE.read_text().splitlines()
header, data, footer = lines[0], lines[1:4], lines[12:]
link = next(part for part in data[0].split('"') if part.startswith("https://"))
assert data[1].endswith(NO_LINK) and data[2].endswith(NO_LINK)


def with_links(line: str, txn: str, names: list[str]) -> str:
    # One link per column: `Attachments` and the 3 unnamed columns after it.
    cells = [f'"{link.replace(ONE_ID, txn).replace("1.jpeg", name)}"' for name in names] + ['""'] * (4 - len(names))
    return line[: -len(NO_LINK)] + '"Yes",' + ",".join(cells)


def stamped(rows: list[str]) -> bytes:
    text = "\n".join([header, *rows, *footer])
    for txn in (ONE_ID, LATE_ID, TWO_ID):
        text = text.replace(txn, f"{txn}W{STAMP}")
    text = text.replace('"Transport charges alpha project"', f'"Walk wallet one bill {STAMP}"')
    text = text.replace('"Printout charges beta site"', f'"Walk wallet late bill {STAMP}"')
    return text.encode()


# The third spend has no remark: it gets one, so its row can be found.
two_bills = with_links(data[2], TWO_ID, ["1.jpeg", "2.pdf"]).replace(
    '"6000","","","","",""', f'"6000","","","","Walk wallet two bills {STAMP}",""', 1
)
assert STAMP in two_bills
first = stamped([data[0], data[1], two_bills])
second = stamped([data[0], with_links(data[1], LATE_ID, ["1.jpeg"]), two_bills])


# ⚠️ EACH FILE'S BYTES ARE THIS RUN'S OWN. Frappe gives a saved file the URL of any File with the same content, and
# a private one another user owns is then refused to the Accountant ("You do not have permission to access this
# file"): a plain white image is byte-for-byte a test's leftover.
def pdf(txn: str) -> bytes:
    from pypdf import PdfWriter

    writer, out = PdfWriter(), io.BytesIO()
    writer.add_blank_page(width=595, height=842)
    writer.add_metadata({"/Title": f"walk bill {txn}W{STAMP}"})
    writer.write(out)
    return out.getvalue()


def jpeg(txn: str) -> bytes:
    from PIL import Image, ImageDraw

    out, image = io.BytesIO(), Image.new("RGB", (300, 400), "white")
    ImageDraw.Draw(image).text((20, 20), f"walk bill {txn}W{STAMP}", fill="black")
    image.save(out, format="JPEG")
    return out.getvalue()


def fetch(url: str) -> BillFile:
    txn, name = url.split("?")[0].rsplit("/", 2)[-2:]
    return BillFile(pdf(txn), "pdf") if name.endswith(".pdf") else BillFile(jpeg(txn), "jpeg")
held: list[str] = []
real_enqueue = frappe.enqueue


def enqueue(method, **kwargs):
    if method == JOB:
        held.append(kwargs["bill"])
        return None
    return real_enqueue(method, **kwargs)


def confirm(content: bytes) -> str:
    class _Request:
        files = MultiDict({"file": FileStorage(stream=io.BytesIO(as_statement_xlsx(content)), filename="walk-cashbook.xlsx")})
        host = None
        headers: dict = {}

    frappe.local.request = _Request()
    with patch.object(bills, "fetch_bill", fetch), patch.object(
        cb, "_enqueue_worker", side_effect=lambda batch, actor, **kw: cb._cashbook_worker(batch, actor, **kw)
    ), patch.object(frappe, "enqueue", side_effect=enqueue):
        return cb.confirm_cashbook_import()["batch"]


def spend(txn: str):
    for doctype in ("Project Expenses", "Non Project Expenses"):
        row = frappe.db.get_value(doctype, {"payment_ref": f"{txn}W{STAMP}"}, ["name", "amount", "description"], as_dict=True)
        if row:
            return doctype, row
    raise AssertionError(f"no Expense for {txn}")


def read_held(answer) -> None:
    for bill in list(held):
        held.remove(bill)
        expense = frappe.db.get_value(BILL_DOCTYPE, bill, ["expense_doctype", "expense", "line_amount"], as_dict=True)
        with patch.object(reading, "read_bill", lambda url: reading.Reading(answer(expense), {"stand_in": True})):
            reading.check_expense_bill(bill=bill)


frappe.set_user(ACCOUNTANT)
confirm(first)
read_held(lambda bill: BillRead(total=Decimal(str(bill.line_amount)), invoice_no=f"WALK-ONE-{STAMP}"))
confirm(second)
read_held(lambda bill: BillRead(total=Decimal(str(bill.line_amount)) + 50, invoice_no=f"WALK-LATE-{STAMP}"))
frappe.db.commit()

answer = {}
for key, txn in (("ONE", ONE_ID), ("TWO", TWO_ID), ("LATE", LATE_ID)):
    doctype, row = spend(txn)
    answer[key] = [doctype, row.name, row.description]
print("CASHBOOK_BILLS_SEED " + json.dumps(answer))
