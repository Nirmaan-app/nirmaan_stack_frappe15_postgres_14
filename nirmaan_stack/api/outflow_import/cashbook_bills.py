# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cashbook job's bill copies: every bill link the import downloads goes through here (spec #1585, #1591,
#1593, ADR-0015 Amendment B decisions 3 and 5).

Two kinds of copy, one downloader path (`download_and_save_bills`) and one step-3 frame (`store_or_discard`):

  * **a created line's bills** (`copy_created_line_bills`, #1591) become its new Expense's invoice, an Expense bill
    with its Bill check (`expense_bills.receive_bill`, #1641; 2 or more links merged are Not checked);
  * **a late bill** (`attach_late_bills`, #1593): a repeat line's bills reach the existing Expense still waiting
    for one.

A Collect payment is created like any wallet spend since #1708 (ADR-0015 Amendment C), so its bills are a created
line's. (Before, an open Collect payment's bills were kept on its line as `stored_bill`; the patch
`v3_0.create_open_collect_payment_expenses` files any such bill as its new Expense's invoice.)

⚠️ EVERY COPY RUNS OUTSIDE A LINE'S TRANSACTION (spec #1585 "Where downloads run"). `store_file` commits mid-save,
so a download or save inside the line's transaction would commit half a line. Step 2 downloads every bill (no
lock held), merges 2 or more into one PDF and saves one private File, which commits. Step 3 locks the target
(the Expense), re-checks it still waits, and only then attaches the File; when it no longer waits,
a person decided meanwhile, their choice stands and the copied File is deleted.

⚠️ A BILL THAT CANNOT BE COPIED NEVER FAILS ITS LINE. The reason is written on the line's `bill_problem` (a late
bill's, which has no line, on the batch's `cashbook_bill_work`), which the import summary
(`cashbook.get_cashbook_status` -> `bills_not_copied`) lists.

⚠️ RESUME FINISHES WHAT A STOPPED JOB LEFT (spec #1585 "Pressing Resume is always safe", code review S1, S2, R1-R3).
The work outside the job's own Pending lines is kept on the batch (`Outflow Import Batch.cashbook_bill_work`, written
at confirm, `new_bill_work`'s shape): its late bills. Each is marked done once the job dealt with it; a transient database refusal (`is_retried_by_resume`) leaves it owed. `bills_waiting` counts what is
left; `cashbook.get_cashbook_status` says the batch stopped while any is, and `resume_cashbook_import` re-queues the
job, which copies only what is still owed. A link past its expiry is never requested (`fetch_bill`).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from psycopg2.errors import LockNotAvailable, TransactionRollbackError

import frappe

from nirmaan_stack.api.outflow_import.cashbook_lines import BATCH_DOCTYPE, ROW_DOCTYPE
from nirmaan_stack.services.expense_bills.receive import receive_bill
from nirmaan_stack.services.outflow_import.bill_download import BillFile, BillRefused, download_bill
from nirmaan_stack.services.outflow_import.bill_links import expired_link_reason
from nirmaan_stack.services.reimbursements.receipts import merge_to_pdf
from nirmaan_stack.services.stored_files import delete_files
from nirmaan_stack.services.stored_files import store_file

BILLS_NOT_STORED = "the bills could not be stored"
BILLS_NOT_MERGED = "the bills could not be merged into one PDF"
PROBLEM_NOT_RECORDED = "Cashbook import: could not record a bill not copied"


def fetch_bill(url: str) -> BillFile | BillRefused:
    """THE SEAM tests replace: one bill link through the guard (`bill_download.download_bill`).

    ⚠️ AN EXPIRED LINK IS NEVER TRIED (code review R2). Its expiry is in its own query string; past it, the copy is
    refused with the date, which becomes the line's `bill_problem`, so a Resume days later asks nothing of the
    storage. (The upload refused any statement whose links were already dying, so only a late Resume meets this.)

    ⚠️ NO NETWORK UNDER TESTS. A test that runs the job without replacing this gets a refusal, never a
    request: every Cashbook fixture carries real-looking links to the production bucket. It is checked first, so
    that refusal does not change once the fixture's links have expired.
    """
    if frappe.flags.in_test:
        return BillRefused("bill downloads are off under tests")
    expired = expired_link_reason(url, _utc_now(), ZoneInfo(frappe.utils.get_system_timezone()))
    if expired:
        return BillRefused(expired)
    return download_bill(url)


def _utc_now() -> datetime:
    """The job's clock for a link's expiry. One function so a test can set it."""
    return datetime.now(timezone.utc)


def links_of(line) -> list[str]:
    """A staged line's bill links, in the statement's order (`Outflow Import Row.bill_links`, #1590)."""
    return (frappe.parse_json(line.bill_links) or {}).get("links") or [] if line.bill_links else []


def is_retried_by_resume(exc: BaseException) -> bool:
    """Whether a failed copy is the database's transient refusal, which leaves the copy owed for Resume (code review
    R3): a serialization failure or deadlock (`TransactionRollbackError`), a lock not granted, or Frappe's own
    deadlock / timeout errors. Anything else is the bill's own failure and becomes a permanent `bill_problem`.

    Broader than `concurrency.is_concurrent_writer_refusal` on purpose: that one picks the sentence a person is
    told; this only decides whether trying again later can succeed, which it can after any of these.
    """
    return isinstance(
        exc, (TransactionRollbackError, LockNotAvailable, frappe.QueryDeadlockError, frappe.QueryTimeoutError)
    )


def not_copied(count: int, clause: str) -> str:
    """The `bill_problem` sentence for a failure of the whole copy, not of one link."""
    return f"{'Bills' if count > 1 else 'Bill'} not copied: {clause}."


# --- a created line (#1591) ------------------------------------------------------------------------------


def copy_created_line_bills(row_name: str, actor: str) -> None:
    """Copy a just-created line's bills onto its Expense as the invoice, after the line's commit. Never raises.

    Step 3 (`_attach_invoice`) locks the Expense and attaches the File only while it still has no invoice and no
    No invoice mark; the Expense otherwise simply has no invoice yet and waits in Pending Invoices Upload.
    """
    line = frappe.db.get_value(
        ROW_DOCTYPE,
        row_name,
        ["transfer_id", "suggested_doctype", "suggested_name", "bill_links"],
        as_dict=True,
    )
    links = links_of(line)
    dealt_with = _copy_onto(
        row_name,
        line.transfer_id,
        links,
        attach=lambda saved: _attach_invoice(line.suggested_doctype, line.suggested_name, saved, actor, len(links)),
        failure=("Cashbook import: could not copy a bill", f"{row_name} / {line.suggested_name}"),
    )
    if not dealt_with:
        # Nothing retries a created line's copy (its Expense waits in Pending Invoices Upload), so even a transient
        # refusal is named in the summary; should that write be refused again, only the Error Log records it.
        problem = not_copied(len(links), BILLS_NOT_STORED)
        if not _record_bill_problem(row_name, problem):
            frappe.log_error(
                title=PROBLEM_NOT_RECORDED,
                message=f"{row_name}: {problem} (the database refused the write twice)",
            )
            frappe.db.commit()


# --- a late bill (#1593) ----------------------------------------------------------------------------------


def attach_late_bills(batch: str, actor: str) -> None:
    """Attach each late bill of `batch` not yet done (#1593, spec #1585 "A late attach uses the same step 3"):
    `_store_and_attach` downloads outside any transaction, then locks the Expense and re-checks `invoice_attachment`
    and `no_invoice_by` before attaching. An Expense a person gave an invoice or a No invoice mark since confirm is
    left as they left it.

    The bills are the batch's `cashbook_bill_work["late_bills"]`, written at confirm. Each is marked `done` once
    tried, with its `problem` when it was not copied: a repeat line is not saved, so the batch carries what a line
    would (`bills_not_copied`). A job that dies part-way leaves the rest undone, and Resume does them.
    """
    work = bill_work(batch)
    for bill in work.get("late_bills") or []:
        if bill.get("done"):
            continue
        try:
            problem = _store_and_attach(bill["doctype"], bill["expense"], bill["transfer_id"], bill["links"], actor)
        except Exception as exc:
            frappe.db.rollback()
            if is_retried_by_resume(exc):
                continue  # still owed, for Resume (code review R3)
            frappe.log_error(
                title="Cashbook import: a late bill was not copied",
                message=f"{batch} / {bill['transfer_id']} / {bill['doctype']} {bill['expense']}\n\n{frappe.get_traceback()}",
            )
            problem = not_copied(len(bill["links"]), BILLS_NOT_STORED)
        bill.update({"done": True, "problem": problem})
        save_bill_work(batch, work)


def new_bill_work(late_bills: list[dict]) -> dict | None:
    """THE ONE SHAPE of `Outflow Import Batch.cashbook_bill_work`, or `None` when the import owes no such copy.

    `late_bills`: `{"transfer_id", "doctype", "expense", "links"}` each, marked `done` (with its `problem`) by
    `attach_late_bills`. (A batch confirmed before #1708 may also hold `collect`, the open Collect payment lines
    whose bills its job copied onto the line; nothing reads it any more.)
    """
    return {"late_bills": [dict(bill) for bill in late_bills]} if late_bills else None


def bill_work(batch: str) -> dict:
    """The batch's `cashbook_bill_work` (`new_bill_work`'s shape), or `{}` (a batch with no such work)."""
    stored = frappe.db.get_value(BATCH_DOCTYPE, batch, "cashbook_bill_work")
    return (frappe.parse_json(stored) if stored else None) or {}


def save_bill_work(batch: str, work: dict | None, commit: bool = True) -> None:
    """THE ONE WRITER of `cashbook_bill_work`. `commit=False` inside confirm's transaction (`cashbook._stage`).

    Raw (`set_value`): `Outflow Import Batch` has no doc_events, only confirm and the batch's one job write this
    field, and nothing is derived from it.
    """
    frappe.db.set_value(
        BATCH_DOCTYPE, batch, "cashbook_bill_work", frappe.as_json(work) if work else None, update_modified=False
    )
    if commit:
        frappe.db.commit()


def bills_waiting(batch: str) -> int:
    """How many bill copies of `batch` the job still owes: its late bills not yet done."""
    return len([bill for bill in bill_work(batch).get("late_bills") or [] if not bill.get("done")])


def bills_not_copied(batch: str) -> list[dict]:
    """Every bill `batch`'s job could not copy, as the import summary lists it (`get_cashbook_status`): its lines'
    (the Expense named; blank on a line still without one) and its late bills'."""
    lines = frappe.db.sql(
        """
        SELECT transfer_id, suggested_name, bill_problem FROM "tabOutflow Import Row"
        WHERE COALESCE(bill_problem, '') <> '' AND import_batch = %(batch)s
        ORDER BY name
        """,
        {"batch": batch},
        as_dict=True,
    )
    return [
        {"transfer_id": line.transfer_id, "expense": line.suggested_name, "reason": line.bill_problem}
        for line in lines
    ] + [
        {"transfer_id": bill["transfer_id"], "expense": bill["expense"], "reason": bill["problem"]}
        for bill in bill_work(batch).get("late_bills") or []
        if bill.get("problem")
    ]


def _store_and_attach(doctype: str, expense: str, transfer_id: str, links: list[str], actor: str) -> str | None:
    """Steps 2 and 3 for one Expense. Returns the `bill_problem` sentence, or `None` when nothing went wrong (the
    bills were attached, or a person had already set the invoice or No invoice)."""
    saved, problem = download_and_save_bills(transfer_id, links)
    if saved is None:
        return problem
    store_or_discard(saved, lambda: _attach_invoice(doctype, expense, saved, actor, len(links)))
    return None


# --- the shared steps ---------------------------------------------------------------------------------------


def _copy_onto(
    row_name: str, transfer_id: str, links: list[str], attach: Callable, failure: tuple[str, str]
) -> bool:
    """Steps 2 and 3 for one line's bills, with `attach(saved)` as step 3. Never raises. Returns whether the line
    was dealt with: `False` only when the database refused it transiently (`is_retried_by_resume`), so nothing is
    written and the copy can be tried again. Anything else that stops the copy is written on the line's
    `bill_problem` (`_record_bill_problem`), and an unexpected error is also logged (`failure` is the Error Log's
    title and subject)."""
    if not links:
        return True
    try:
        saved, problem = download_and_save_bills(transfer_id, links)
        if saved is not None:
            store_or_discard(saved, lambda: attach(saved))
    except Exception as exc:
        frappe.db.rollback()
        if is_retried_by_resume(exc):
            return False
        title, subject = failure
        frappe.log_error(title=title, message=f"{subject}\n\n{frappe.get_traceback()}")
        problem = not_copied(len(links), BILLS_NOT_STORED)
    if problem and not _record_bill_problem(row_name, problem):
        return False
    frappe.db.commit()
    return True


def _record_bill_problem(row_name: str, problem: str) -> bool:
    """Write the line's `bill_problem`. Never raises. Returns `False` when the database refused the write
    transiently (`is_retried_by_resume`), so the copy is still owed; any other failure is logged, and the line is
    dealt with all the same (the Error Log is then the only record of its reason)."""
    try:
        _write_bill_problem(row_name, problem)
    except Exception as exc:
        frappe.db.rollback()
        if is_retried_by_resume(exc):
            return False
        frappe.log_error(
            title=PROBLEM_NOT_RECORDED,
            message=f"{row_name}: {problem}\n\n{frappe.get_traceback()}",
        )
        frappe.db.commit()
    return True


def _write_bill_problem(row_name: str, problem: str) -> None:
    """Raw: `Outflow Import Row` has no doc_events, and only the job writes this field."""
    frappe.db.sql("""UPDATE "tabOutflow Import Row" SET bill_problem = %s WHERE name = %s""", (problem, row_name))
    frappe.db.commit()


def download_and_save_bills(transfer_id: str, links: list[str]):
    """Step 2: download every bill (no lock held), merge 2 or more into one PDF, and save ONE private File,
    unattached, which commits. Returns `(saved File, None)`, or `(None, the bill_problem sentence)`."""
    bills = []
    for number, link in enumerate(links, start=1):
        got = fetch_bill(link)
        if isinstance(got, BillRefused):
            which = f"Bill {number} of {len(links)}" if len(links) > 1 else "Bill"
            return None, f"{which} not copied: {got.reason}."
        bills.append(got)

    if len(bills) == 1:
        content, fname = bills[0].content, f"{transfer_id}.{bills[0].kind}"
    else:
        try:
            content = merge_to_pdf([(f"bill {n}", bill.content) for n, bill in enumerate(bills, start=1)])
        except ValueError:
            return None, not_copied(len(bills), BILLS_NOT_MERGED)
        fname = f"{transfer_id}-bills.pdf"

    # Saved unattached: it is attached in step 3, under the target's lock. The URL is read off the returned
    # doc because the cloud attachment hook rewrites it during insert.
    saved = store_file(fname=fname, content=content, dt=None, dn=None, is_private=1)
    frappe.db.commit()
    return saved, None


def store_or_discard(saved, attach) -> None:
    """Step 3's frame: `attach()` locks its target, re-checks it and attaches `saved`, returning whether it did.
    When it did not (a person decided meanwhile) or it raised, the copied File is deleted; a raise propagates."""
    try:
        attached = attach()
    except Exception:
        frappe.db.rollback()
        delete_files({"name": saved.name})
        frappe.db.commit()
        raise
    if not attached:
        # A person decided meanwhile: their choice stands, our copy goes.
        frappe.db.rollback()
        delete_files({"name": saved.name})
        frappe.db.commit()


def _attach_invoice(doctype: str, expense: str, saved, actor: str, bill_count: int) -> bool:
    """Step 3: lock the Expense, re-check it still waits for an invoice, and only then file `saved` as its bill
    through the one entry point (`expense_bills.receive_bill`, #1641): an Expense bill attached by `actor`, the one
    who confirmed the import, approved on arrival by the system (#1755: the Cashbook approval tab holds only bills a
    person uploaded; the Bill check still records its verdict), its reading queued once this commits; `saved` merged
    from `bill_count` > 1 links is recorded Not checked and never read. Returns whether it attached (and then
    commits); when it did not, the caller discards the File (`store_or_discard`). A number or date a person already
    typed on the Expense is kept."""
    doc = frappe.get_doc(doctype, expense, for_update=True)
    if doc.invoice_attachment or _marked_no_invoice(doc):
        return False
    # The File first, so Frappe's attach-on-save hook finds it and mints no second one.
    _attach_file(saved, doctype, expense, "invoice_attachment")
    receive_bill(doc, saved.file_url, doc.invoice_ref, doc.invoice_date, actor, bill_count, system_approve=True)
    frappe.db.commit()
    return True


def _attach_file(saved, doctype: str, name: str, field: str) -> None:
    """Point the copied File at the record it now belongs to.

    Raw (`set_value`, no doc_events): the only `File` hooks of ours run `before_insert` (hooks.py), which this
    File is already past, and a `File` save would re-run Frappe's own validation on a file the cloud hook already
    stored. Only these three pointer fields change, and nothing derived from them is ours to recompute.
    """
    frappe.db.set_value(
        "File",
        saved.name,
        {"attached_to_doctype": doctype, "attached_to_name": name, "attached_to_field": field},
        update_modified=False,
    )


def _marked_no_invoice(doc) -> bool:
    """Whether a person marked this Expense No invoice (`no_invoice_by`, on both Expense doctypes since #1592)."""
    return bool(doc.get("no_invoice_by"))
