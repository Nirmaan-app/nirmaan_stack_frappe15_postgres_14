# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Bill check's reading job (#1639, spec #1637): one Checking Expense bill, read and judged.

Copies the Porter import's Validate step (`api/outflow_import/porter_validation.py`): a pure verdict
(`bill_check.check_bill`), a claim under a row lock, a committed result.

    Checking --claim (row lock, `read_claimed_at` set, committed)--> read_bill (no transaction held, 30 s to
    minutes) --> check_bill --> Matched / Mismatched / Not read, committed

⚠️ A BILL IS CLAIMED BEFORE IT IS READ. Only a Checking bill nobody has claimed is read, and the claim is taken
under its row lock and committed before the reader is called. A second job for the same bill (queued twice, or
started while the first still reads) finds it claimed and does nothing, so one bill is read once.

A Matched bill is auto-approved (`approved_by` "System", as an auto-approved Vendor Invoice) and fills the
Expense's `invoice_ref` and `invoice_date` where they are empty -- only while it is still the Expense's latest bill.
Every other result stays Pending and writes nothing to the Expense.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

import frappe
from frappe.utils import getdate, now_datetime

from nirmaan_stack.services.expense_bills import APPROVED, BILL_DOCTYPE, SYSTEM_APPROVER
from nirmaan_stack.services.expense_bills.bill_check import (
    CHECKING,
    MATCHED,
    BillRead,
    ReadFailed,
    check_bill,
)

_JOB = "nirmaan_stack.services.expense_bills.reading.check_expense_bill"

#: The reader takes 30 s to several minutes per bill; past this the worker gives up on the job.
JOB_TIMEOUT_SECONDS = 15 * 60

READING_OFF = "Reading is switched off in Document AI Settings."


@dataclass(frozen=True)
class Reading:
    """What `read_bill` gives back: the figures the verdict needs, and the reader's full output to keep with the
    bill (an object, never a bare list: a JSON field) -- None when it gave none."""

    read: BillRead | ReadFailed
    output: dict | None = None


def reading_job_id(bill: str) -> str:
    """One job id per bill, so queuing it twice before it runs queues one job."""
    return f"expense-bill-check-{bill}"


def queue_reading(bill: str) -> None:
    """Queue `bill`'s reading on the `long` queue, once the caller's transaction commits (so the job finds the
    bill), de-duplicated by its job id."""
    frappe.enqueue(
        _JOB,
        queue="long",
        timeout=JOB_TIMEOUT_SECONDS,
        job_id=reading_job_id(bill),
        deduplicate=True,
        enqueue_after_commit=True,
        bill=bill,
    )


def check_expense_bill(bill: str) -> None:
    """THE JOB: read one Checking Expense bill and record its Bill check. Does nothing for a bill another job
    claimed or one already decided."""
    claimed = _claim(bill)
    if claimed is None:
        return
    try:
        reading = read_bill(claimed.bill_file)
    except Exception as exc:
        # A claimed bill must end with a result: one left Checking is never read again.
        frappe.db.rollback()
        frappe.log_error(title=f"Expense bill {bill}: the reader raised", message=frappe.get_traceback())
        reading = Reading(ReadFailed(_failure_reason(exc)))
    verdict = check_bill(reading.read, Decimal(str(claimed.line_amount or 0)))
    try:
        _record(bill, reading, verdict)
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        frappe.log_error(title=f"Expense bill {bill}: the Bill check could not be saved", message=frappe.get_traceback())
        raise


def _claim(bill: str) -> frappe._dict | None:
    """Take a Checking, unclaimed bill under its row lock and mark it claimed, committed. None otherwise."""
    rows = frappe.db.sql(
        f"""SELECT name, bill_file, line_amount, bill_check, read_claimed_at
            FROM "tab{BILL_DOCTYPE}" WHERE name = %s FOR UPDATE""",
        (bill,),
        as_dict=True,
    )
    if not rows or rows[0].bill_check != CHECKING or rows[0].read_claimed_at:
        frappe.db.rollback()
        return None
    # Raw: `Expense Bill` has no doc_events, and the claim is a marker nothing is derived from.
    frappe.db.set_value(BILL_DOCTYPE, bill, "read_claimed_at", now_datetime(), update_modified=False)
    frappe.db.commit()
    return rows[0]


def _record(bill: str, reading: Reading, verdict) -> None:
    """The verdict on the bill (through the document layer, so a Version is kept), and a Matched one's number and
    date on its Expense where empty."""
    doc = frappe.get_doc(BILL_DOCTYPE, bill, for_update=True)
    if isinstance(reading.read, BillRead):
        doc.read_total = reading.read.total
        doc.read_invoice_no = (reading.read.invoice_no or "").strip() or None
        doc.read_invoice_date = reading.read.invoice_date
    doc.reader_output = frappe.as_json(reading.output) if reading.output else None
    doc.bill_check = verdict.result
    doc.bill_check_reason = verdict.reason or None
    doc.invoice_no = verdict.invoice_no or None
    doc.invoice_date = verdict.invoice_date
    doc.invoice_amount = verdict.total
    if verdict.result == MATCHED:
        doc.status = APPROVED
        doc.auto_approved = 1
        doc.approved_by = SYSTEM_APPROVER
        doc.approved_on = now_datetime()
    doc.save(ignore_permissions=True)
    if verdict.result == MATCHED and doc.is_latest:
        _fill_expense(doc, verdict)


def _fill_expense(bill, verdict) -> None:
    """A Matched bill's number and date onto its Expense, only where empty (a person's entry wins), and only while
    the Expense still carries this bill's file."""
    expense = frappe.get_doc(bill.expense_doctype, bill.expense, for_update=True)
    if expense.invoice_attachment != bill.bill_file:
        return
    changed = False
    if verdict.invoice_no and not expense.invoice_ref:
        expense.invoice_ref = verdict.invoice_no
        changed = True
    if verdict.invoice_date and not expense.invoice_date:
        expense.invoice_date = verdict.invoice_date
        changed = True
    if changed:
        expense.save(ignore_permissions=True)


def read_bill(file_url: str) -> Reading:
    """Read one bill with the shared invoice reader. THE SEAM tests replace.

    Never raises: reading switched off, a file it cannot fetch or read, and a reader error or timeout each come
    back as `ReadFailed` with the reason. ⚠️ NO NETWORK UNDER TESTS: a test that does not replace this gets a
    refusal, never a request (the switched-off check comes first, so a test can still see it).
    """
    from nirmaan_stack.api.invoice_autofill import AMOUNT_KEYS, INVOICE_DATE_KEYS, INVOICE_NO_KEYS
    from nirmaan_stack.services.extraction import extract
    from nirmaan_stack.services.extraction.base import INVOICE
    from nirmaan_stack.services.extraction.files import SUPPORTED_EXTS, fetch_file_content, get_extraction_settings
    from nirmaan_stack.services.extraction.helpers import get_file_doc_by_url, normalize_date, pick_entity

    settings = get_extraction_settings()
    if not settings.get("enabled"):
        return Reading(ReadFailed(READING_OFF))
    if frappe.flags.in_test:
        return Reading(ReadFailed("Bill reading is off under tests."))
    file_doc = get_file_doc_by_url(file_url)
    if not file_doc:
        return Reading(ReadFailed("The bill file was not found."))
    ext = (file_doc.file_name or file_url).rsplit(".", 1)[-1].lower()
    if ext not in SUPPORTED_EXTS:
        return Reading(ReadFailed(f"A .{ext} file cannot be read; only PDF, PNG and JPG bills can."))
    content = fetch_file_content(file_doc, file_doc.name)
    if not content:
        return Reading(ReadFailed("The bill file could not be fetched from storage."))
    try:
        _, entities, line_items = extract(content, ext, settings, doc_kind=INVOICE)
    except Exception as exc:
        frappe.local.message_log = []
        return Reading(ReadFailed(_failure_reason(exc)))

    def _pick(keys, normalized=False):
        return pick_entity(entities, keys, prefer_normalized=normalized)[0]

    read_date = normalize_date(_pick(INVOICE_DATE_KEYS, True))
    return Reading(
        BillRead(
            total=_decimal(_pick(AMOUNT_KEYS, True)),
            invoice_no=(_pick(INVOICE_NO_KEYS) or "").strip(),
            invoice_date=getdate(read_date) if read_date else None,
        ),
        {"entities": entities, "line_items": line_items},
    )


def _failure_reason(exc: Exception) -> str:
    """A reader failure as a person reads it. The Gemini reader logs its error and raises its own message, so the
    cause is the exception it was handling."""
    chain = f"{exc} {exc.__context__ or ''}".upper()
    if "DEADLINE" in chain or "TIMEOUT" in chain or "TIMED OUT" in chain:
        return "The reader timed out."
    cause = exc.__context__ or exc
    return f"The reader failed ({cause.__class__.__name__})."


def _decimal(value) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value).replace(",", "")).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None
