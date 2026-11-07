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

A Matched bill is auto-approved (`approved_by` "System", as an auto-approved Vendor Invoice) and fills the bill's and
the Expense's number and date where they are empty (a typed one stands) -- the Expense's only while it is still its
latest bill. Every other result stays Pending and writes nothing to the Expense. A bill a person approved before it
was read (an approver's replace on Payment Done, #1643) keeps its approval and the number and date they typed; the
result is recorded beside them.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation

import frappe
from frappe.utils import add_to_date, get_datetime, getdate, now_datetime

from nirmaan_stack.services.expense_bills import APPROVED, BILL_DOCTYPE, PENDING, REJECTED, SYSTEM_APPROVER
from nirmaan_stack.services.expense_bills.bill_check import (
    CHECKING,
    NOT_READ,
    BillRead,
    BillVerdict,
    ReadFailed,
    check_bill,
    money,
)

_JOB = "nirmaan_stack.services.expense_bills.reading.check_expense_bill"

#: The reader takes 30 s to several minutes per bill; past this the worker gives up on the job.
JOB_TIMEOUT_SECONDS = 15 * 60

READING_OFF = "Reading is switched off in Document AI Settings."
NOT_QUEUED = "The reading could not be queued."

#: A bill claimed longer ago than this is still Checking only because its worker was killed (the job limit, plus a
#: margin for a job still saving its result and for clocks a little apart): it shows as Not read with this reason,
#: and Read again reaches it (#1645).
STOPPED_AFTER_SECONDS = JOB_TIMEOUT_SECONDS + 5 * 60

READING_STOPPED = "The reading stopped."


@dataclass(frozen=True)
class Reading:
    """What `read_bill` gives back: the figures the verdict needs, and the reader's full output to keep with the
    bill (an object, never a bare list: a JSON field) -- None when it gave none."""

    read: BillRead | ReadFailed
    output: dict | None = None


def reading_job_id(bill: str) -> str:
    """One job id per bill, so queuing it twice before it runs queues one job."""
    return f"expense-bill-check-{bill}"


def queue_reading(bill: str, job_id: str | None = None) -> None:
    """Queue `bill`'s reading on the `long` queue, once the caller's transaction commits (so the job finds the
    bill), de-duplicated by its job id (`reading_job_id`, unless `job_id` is given).

    ⚠️ A QUEUE THAT REFUSES NEVER UNDOES THE BILL (#1641). The enqueue runs inside the caller's `commit()`, after
    the bill is saved; were it to raise there, the caller would take the commit for failed (the Cashbook import
    then deletes the bill file it just attached). So a refusal is caught: the bill ends Not read with the reason,
    for a person to read again, and the error is logged."""
    queue_after_commit(_JOB, job_id or reading_job_id(bill), BILL_DOCTYPE, bill, bill=bill)


def queue_after_commit(job: str, job_id: str, doctype: str, name: str, **kwargs) -> None:
    """Queue a reading `job` on the `long` queue once the caller's transaction commits, de-duplicated by `job_id`.
    A queue that refuses leaves record `doctype` `name` (an Expense bill, or a Collect payment line, #1642) Not read
    with `NOT_QUEUED`, and the error logged."""
    frappe.db.after_commit.add(lambda: _enqueue(job, job_id, doctype, name, kwargs))


def _enqueue(job: str, job_id: str, doctype: str, name: str, kwargs: dict) -> None:
    try:
        frappe.enqueue(
            job,
            queue="long",
            timeout=JOB_TIMEOUT_SECONDS,
            job_id=job_id,
            deduplicate=True,
            **kwargs,
        )
    except Exception:
        # Runs inside the caller's commit, after its data landed: nothing here may raise into it.
        try:
            frappe.log_error(title=f"{doctype} {name}: its reading could not be queued", message=frappe.get_traceback())
            # Raw: neither `Expense Bill` nor `Outflow Import Row` has doc_events; a bill no job will read must not
            # stay Checking.
            frappe.db.set_value(
                doctype, name, {"bill_check": NOT_READ, "bill_check_reason": NOT_QUEUED}, update_modified=False
            )
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()


def stopped_before() -> datetime:
    """A Checking bill claimed before this moment is one whose reading stopped: no job can still be reading it."""
    return add_to_date(now_datetime(), seconds=-STOPPED_AFTER_SECONDS)


def reading_stopped(bill_check: str, read_claimed_at: datetime | str | None) -> bool:
    """True for a bill left Checking by a reading that stopped (claimed before `stopped_before`)."""
    return bill_check == CHECKING and bool(read_claimed_at) and get_datetime(read_claimed_at) < stopped_before()


def read_again(bill: str) -> None:
    """Read again (#1645): put bill `bill` (its Expense's latest; Pending, or Approved by a person before it was
    read, #1643), Not read or left Checking by a reading that stopped, back to Checking, unclaimed, and queue its
    reading. A bill Checking for any other reason is left alone, so pressing twice reads it once. A Rejected bill,
    and one with a result (a bill the system approved is Matched), are refused. Does not commit; the reading is
    queued once the caller's transaction commits.

    The reading is queued under a job id of its own: a worker killed outright can leave the stopped reading's job
    registered as started under the bill's usual id, and a duplicate of it would be dropped. The claim, not the job
    id, is what reads the bill once."""
    doc = frappe.get_doc(BILL_DOCTYPE, bill, for_update=True)
    if doc.status == REJECTED:
        frappe.throw(f"Expense bill {bill} is already {doc.status}; a rejected bill is not read again.")
    if not doc.is_latest:
        frappe.throw(f"Expense bill {bill} is no longer the latest bill of {doc.expense}.")
    if doc.bill_check == CHECKING and not reading_stopped(doc.bill_check, doc.read_claimed_at):
        return  # pressed twice: the first press's reading is queued or running
    if doc.bill_check not in (NOT_READ, CHECKING):
        frappe.throw(f"Expense bill {bill} is {doc.bill_check}; only a Not read bill can be read again.")
    doc.bill_check = CHECKING
    doc.bill_check_reason = None
    doc.read_claimed_at = None
    doc.save(ignore_permissions=True)
    queue_reading(bill, job_id=f"{reading_job_id(bill)}-again-{frappe.generate_hash(length=8)}")


def check_expense_bill(bill: str) -> None:
    """THE JOB: read one Checking Expense bill and record its Bill check. Does nothing for a bill another job
    claimed or one already decided."""
    claimed = claim(BILL_DOCTYPE, bill, "bill_file, line_amount")
    if claimed is None:
        return
    reading = read_or_fail(claimed.bill_file, f"Expense bill {bill}")
    verdict = check_bill(reading.read, money(claimed.line_amount))
    try:
        record_check(bill, reading, verdict)
        frappe.db.commit()
    except Exception as exc:
        frappe.db.rollback()
        frappe.local.message_log = []
        frappe.log_error(title=f"Expense bill {bill}: the Bill check could not be saved", message=frappe.get_traceback())
        # Raw: `Expense Bill` has no doc_events; a claimed bill must not stay Checking.
        frappe.db.set_value(
            BILL_DOCTYPE,
            bill,
            {"bill_check": NOT_READ, "bill_check_reason": f"The Bill check could not be saved ({type(exc).__name__})."},
            update_modified=False,
        )
        frappe.db.commit()


def read_or_fail(file_url: str, what: str) -> Reading:
    """`read_bill`, with a reader that raises taken as Not read (its reason kept, the error logged under `what`):
    a claimed bill must end with a result, since one left Checking is never read again."""
    try:
        return read_bill(file_url)
    except Exception as exc:
        frappe.db.rollback()
        frappe.log_error(title=f"{what}: the reader raised", message=frappe.get_traceback())
        return Reading(ReadFailed(_failure_reason(exc)))


def claim(doctype: str, name: str, columns: str, still_open=None) -> frappe._dict | None:
    """THE ONE CLAIM, so one record is read once: take record `name` of `doctype` (an Expense bill, or a Collect
    payment line, `line_check`) under its row lock while it is Checking, unclaimed and `still_open(row)` (when
    given), mark it claimed (raw, committed) and give back its row with `columns`. None otherwise, the lock
    released."""
    rows = frappe.db.sql(
        f"""SELECT name, {columns}, bill_check, read_claimed_at FROM "tab{doctype}" WHERE name = %s FOR UPDATE""",
        (name,),
        as_dict=True,
    )
    row = rows[0] if rows else None
    if row is None or row.bill_check != CHECKING or row.read_claimed_at or (still_open and not still_open(row)):
        frappe.db.rollback()
        return None
    # Raw: neither `Expense Bill` nor `Outflow Import Row` has doc_events, and the claim is a marker nothing is
    # derived from.
    frappe.db.set_value(doctype, name, "read_claimed_at", now_datetime(), update_modified=False)
    frappe.db.commit()
    return row


def record_check(bill: str, reading: Reading, verdict: BillVerdict) -> None:
    """The verdict on the bill (through the document layer, so a Version is kept), and a Matched one's number and
    date on the bill and on its Expense, each only where empty (what a person typed wins, as on the Expense).

    Approval moves only a Pending bill: one a person approved or rejected while it was read keeps that decision, its
    number and date, and its Expense is left alone."""
    head = frappe.db.get_value(BILL_DOCTYPE, bill, ["expense_doctype", "expense", "is_latest"], as_dict=True)
    # The Expense before the bill: THE ONE LOCK ORDER (the package docstring). Taken only when a Matched result
    # may fill the Expense; a retired bill's Expense may be gone (`receive.retire_bills`).
    expense = (
        frappe.get_doc(head.expense_doctype, head.expense, for_update=True)
        if verdict.auto_approves and head.is_latest
        else None
    )
    doc = frappe.get_doc(BILL_DOCTYPE, bill, for_update=True)
    auto_approve = verdict.auto_approves and doc.status == PENDING
    doc.update(read_fields(reading))
    doc.bill_check = verdict.result
    doc.bill_check_reason = verdict.reason or None
    if doc.status == PENDING:
        doc.invoice_no = doc.invoice_no or verdict.invoice_no or None
        doc.invoice_date = doc.invoice_date or verdict.invoice_date
    doc.invoice_amount = verdict.total
    if auto_approve:
        doc.status = APPROVED
        doc.auto_approved = 1
        doc.approved_by = SYSTEM_APPROVER
        doc.approved_on = now_datetime()
    doc.save(ignore_permissions=True)
    if auto_approve and doc.is_latest and expense is not None:
        _fill_expense(expense, doc, verdict)


def read_fields(reading: Reading) -> dict:
    """What the reader found, as the fields an Expense bill keeps it in (`read_total`, `read_invoice_no`,
    `read_invoice_date`, `reader_output`), the same names a Collect payment line keeps it in (#1642,
    `line_check`). A failed reading gives only its (empty) output."""
    fields = {"reader_output": frappe.as_json(reading.output) if reading.output else None}
    if isinstance(reading.read, BillRead):
        fields.update(
            read_total=reading.read.total,
            read_invoice_no=(reading.read.invoice_no or "").strip() or None,
            read_invoice_date=reading.read.invoice_date,
        )
    return fields


def _fill_expense(expense, bill, verdict: BillVerdict) -> None:
    """A Matched bill's number and date onto its Expense (`expense`, locked before the bill by `record_check`), only
    where empty (a person's entry wins), and only while the Expense still carries this bill's file."""
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
