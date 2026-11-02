# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cashbook job's bill copies: every bill link the import downloads goes through here (spec #1585, #1591,
#1593, #1595, ADR-0015 Amendment B decisions 3, 5 and 6).

Three kinds of copy, one downloader path (`download_and_save_bills`) and one step-3 frame (`store_or_discard`):

  * **a created line's bills** (`copy_created_line_bills`, #1591) become its new Expense's invoice;
  * **a late bill** (`attach_late_bills`, #1593): a repeat line's bills reach the existing Expense still waiting
    for one;
  * **an open Collect payment's bills** (`store_collect_bills`, #1595) are kept on its line (`stored_bill`) for
    whoever decides it, because the links die 7 days after export.

⚠️ EVERY COPY RUNS OUTSIDE A LINE'S TRANSACTION (spec #1585 "Where downloads run"). `save_file` commits mid-save,
so a download or save inside the line's transaction would commit half a line. Step 2 downloads every bill (no
lock held), merges 2 or more into one PDF and saves one private File, which commits. Step 3 locks the target
(the Expense, or the line), re-checks it still waits, and only then attaches the File; when it no longer waits,
a person decided meanwhile, their choice stands and the copied File is deleted.

⚠️ A BILL THAT CANNOT BE COPIED NEVER FAILS ITS LINE. The reason is written on the line's `bill_problem` (a late
bill's, which has no line, on the batch's `cashbook_bill_work`), which the import summary
(`cashbook.get_cashbook_status` -> `bills_not_copied`) lists.

⚠️ RESUME FINISHES WHAT A STOPPED JOB LEFT (spec #1585 "Pressing Resume is always safe", code review S1, S2, R1-R3).
The work outside the job's own Pending lines is kept on the batch (`Outflow Import Batch.cashbook_bill_work`, written
at confirm, `new_bill_work`'s shape): its late bills, and the Collect payment lines whose bills it copies (its own and
the earlier ones it re-opened, which it owns though they stay in their own import). Each is marked done once the job
dealt with it; a transient database refusal (`is_retried_by_resume`) leaves it owed. `bills_waiting` counts what is
left; `cashbook.get_cashbook_status` says the batch stopped while any is, and `resume_cashbook_import` re-queues the
job, which copies only what is still owed. A link past its expiry is never requested (`fetch_bill`).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import frappe
from frappe.utils.file_manager import save_file
from psycopg2.errors import LockNotAvailable, TransactionRollbackError

from nirmaan_stack.api.outflow_import.cashbook_lines import BATCH_DOCTYPE, ROW_DOCTYPE, lock_line_if
from nirmaan_stack.services.outflow_import.bill_download import BillFile, BillRefused, download_bill
from nirmaan_stack.services.outflow_import.bill_links import link_expires_at
from nirmaan_stack.services.outflow_import.cashbook_collect import COLLECT_ROW_KIND
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED
from nirmaan_stack.services.reimbursements.receipts import merge_to_pdf
from nirmaan_stack.services.stored_files import delete_files

BILLS_NOT_STORED = "the bills could not be stored"
BILLS_NOT_MERGED = "the bills could not be merged into one PDF"


def fetch_bill(url: str) -> BillFile | BillRefused:
    """THE SEAM tests replace: one bill link through the guard (`bill_download.download_bill`).

    ⚠️ AN EXPIRED LINK IS NEVER TRIED (code review R2). Its expiry is in its own query string; past it, the copy is
    refused with the date, which becomes the line's `bill_problem`, so a Resume days later asks nothing of the
    storage. (The upload refused any statement whose links were already dying, so only a late Resume meets this.)

    ⚠️ NO NETWORK UNDER TESTS. A test that runs the job without replacing this gets a refusal, never a
    request: every Cashbook fixture carries real-looking links to the production bucket.
    """
    expires = link_expires_at(url)
    if expires is not None and expires <= _utc_now():
        local = expires.astimezone(ZoneInfo(frappe.utils.get_system_timezone()))
        return BillRefused(f"its link expired on {local.strftime('%d-%b-%Y %H:%M')}")
    if frappe.flags.in_test:
        return BillRefused("bill downloads are off under tests")
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


def copy_created_line_bills(row_name: str) -> None:
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
    copied = _copy_onto(
        row_name,
        line.transfer_id,
        links_of(line),
        attach=lambda saved: _attach_invoice(line.suggested_doctype, line.suggested_name, saved),
        failure=("Cashbook import: could not copy a bill", f"{row_name} / {line.suggested_name}"),
    )
    if not copied:
        # Nothing retries a created line's copy (its Expense waits in Pending Invoices Upload), so even a transient
        # refusal is named in the summary.
        _write_bill_problem(row_name, not_copied(len(links_of(line)), BILLS_NOT_STORED))


# --- an open Collect payment (#1595) ----------------------------------------------------------------------


def store_collect_bills(batch: str) -> None:
    """Copy the bills of each Collect payment line `batch` still owes a copy onto its line as `stored_bill`, and
    mark each `done` once dealt with. Never raises, never fails a line.

    A line whose copy fails stays open with no stored bill, and the reason is written on its `bill_problem`. A
    line a person already decided (or that has a stored bill or a problem) is marked done with nothing copied, so
    an Unskip or Unreconcile later does not make the batch owe it again (code review R2).
    """
    work = bill_work(batch)
    waiting = {line.name: line for line in waiting_collect_lines(batch)}
    for entry in work.get("collect") or []:
        if entry.get("done"):
            continue
        line = waiting.get(entry["line"])
        if line is not None and not _copy_onto(
            line.name,
            line.transfer_id,
            links_of(line),
            attach=lambda saved, name=line.name: _set_stored_bill(name, saved),
            failure=("Cashbook import: could not copy a Collect payment's bill", line.name),
        ):
            continue  # a transient refusal: still owed, for Resume (code review R3)
        entry["done"] = True
        save_bill_work(batch, work)


def waiting_collect_lines(batch: str) -> list:
    """The Collect payment lines `batch` still owes a bill copy (not yet `done`), still open with no stored bill and
    no `bill_problem`. THE ONE DEFINITION the job copies from and Resume counts.

    ⚠️ OWED BY THE IMPORT, NOT BY THE LINE'S `import_batch` (code review R1). A line re-opened by a later import
    (#1596) stays in its earlier import, but the copy is the later import's work: only that import says it stopped
    with the bill still to copy, and only it lists the bill when it was not copied (`bills_not_copied`).

    ⚠️ ONLY WHAT THE JOB HAS NOT DEALT WITH (code review R2). An open Collect line with links and no bill is not
    by itself waiting: once the job marked it done, a line opened again by Unskip days later is a person's to
    decide, not a copy for Resume to try.
    """
    owed = tuple(_collect_lines(batch, undone_only=True))
    if not owed:
        # `IN ()` is a syntax error in Postgres.
        return []
    return frappe.db.sql(
        """
        SELECT name, transfer_id, bill_links FROM "tabOutflow Import Row"
        WHERE name IN %(owed)s
          AND row_kind = %(kind)s AND row_status = %(open)s AND bill_links IS NOT NULL
          AND COALESCE(stored_bill, '') = '' AND COALESCE(bill_problem, '') = ''
        ORDER BY name
        """,
        {"owed": owed, "kind": COLLECT_ROW_KIND, "open": ROW_MISMATCHED},
        as_dict=True,
    )


def _collect_lines(batch: str, undone_only: bool = False) -> list[str]:
    """The Collect payment lines whose bills `batch`'s job copies: its own open Collect payments with bill links,
    and the earlier ones it re-opened (`cashbook_bill_work["collect"]`, written at confirm)."""
    return [
        entry["line"]
        for entry in bill_work(batch).get("collect") or ()
        if not (undone_only and entry.get("done"))
    ]


def _set_stored_bill(row_name: str, saved) -> bool:
    """Lock the line and set `saved` as its stored bill, only while it is still an open line with none. Returns
    whether it did; the caller discards the File when it did not (a person Created or Skipped it meanwhile, and
    an Expense created without the bill simply waits for its invoice in the Cashbook tab)."""
    line = lock_line_if(
        row_name,
        lambda row: row.row_status == ROW_MISMATCHED and not row.stored_bill,
        columns="row_status, stored_bill",
    )
    if line is None:
        return False
    _attach_file(saved, ROW_DOCTYPE, row_name, "stored_bill")
    # Raw: no doc_events on the line, and this field has no reader that a hook would owe a recompute.
    frappe.db.sql(
        """UPDATE "tabOutflow Import Row" SET stored_bill = %s WHERE name = %s""", (saved.file_url, row_name)
    )
    frappe.db.commit()
    return True


# --- a late bill (#1593) ----------------------------------------------------------------------------------


def attach_late_bills(batch: str) -> None:
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
            problem = _store_and_attach(bill["doctype"], bill["expense"], bill["transfer_id"], bill["links"])
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


def new_bill_work(late_bills: list[dict], collect_lines: list[str]) -> dict | None:
    """THE ONE SHAPE of `Outflow Import Batch.cashbook_bill_work`, or `None` when the import owes no such copy.

    `late_bills`: `{"transfer_id", "doctype", "expense", "links"}` each, marked `done` (with its `problem`) by
    `attach_late_bills`. `collect`: `{"line"}` each, the Collect payment lines whose bills the job copies onto the
    line, each marked `done` by `store_collect_bills`.
    """
    work = {
        "late_bills": [dict(bill) for bill in late_bills],
        "collect": [{"line": line} for line in collect_lines],
    }
    return work if any(work.values()) else None


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
    """How many bill copies of `batch` the job still owes: its Collect payment lines' (`waiting_collect_lines`) and
    its late bills not yet done."""
    late = [bill for bill in bill_work(batch).get("late_bills") or [] if not bill.get("done")]
    return len(late) + len(waiting_collect_lines(batch))


def bills_not_copied(batch: str) -> list[dict]:
    """Every bill `batch`'s job could not copy, as the import summary lists it (`get_cashbook_status`): its created
    lines' (the Expense named), the Collect payment lines it owes a copy (no Expense; code review R1: a re-opened
    one is listed by the import that re-opened it, not by its earlier import), and its late bills'."""
    owned = tuple(_collect_lines(batch))
    # `IN ()` is a syntax error in Postgres.
    also = "OR name IN %(owned)s" if owned else ""
    lines = frappe.db.sql(
        f"""
        SELECT transfer_id, suggested_name, bill_problem FROM "tabOutflow Import Row"
        WHERE COALESCE(bill_problem, '') <> ''
          AND ((import_batch = %(batch)s AND COALESCE(row_kind, '') <> %(kind)s) {also})
        ORDER BY name
        """,
        {"batch": batch, "kind": COLLECT_ROW_KIND, "owned": owned},
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


def _store_and_attach(doctype: str, expense: str, transfer_id: str, links: list[str]) -> str | None:
    """Steps 2 and 3 for one Expense. Returns the `bill_problem` sentence, or `None` when nothing went wrong (the
    bills were attached, or a person had already set the invoice or No invoice)."""
    saved, problem = download_and_save_bills(transfer_id, links)
    if saved is None:
        return problem
    store_or_discard(saved, lambda: _attach_invoice(doctype, expense, saved))
    return None


# --- the shared steps ---------------------------------------------------------------------------------------


def _copy_onto(
    row_name: str, transfer_id: str, links: list[str], attach: Callable, failure: tuple[str, str]
) -> bool:
    """Steps 2 and 3 for one line's bills, with `attach(saved)` as step 3. Never raises. Returns `False` only when
    the database refused it transiently (`is_retried_by_resume`): nothing is written, and the copy can be tried
    again. Anything else that stops the copy is written on the line's `bill_problem`, and an unexpected error is
    also logged (`failure` is the Error Log's title and subject)."""
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
    if problem:
        _write_bill_problem(row_name, problem)
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
    saved = save_file(fname=fname, content=content, dt=None, dn=None, is_private=1)
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


def _attach_invoice(doctype: str, expense: str, saved) -> bool:
    """Step 3: lock the Expense, re-check it still waits for an invoice, and only then attach `saved` as
    its `invoice_attachment`. Returns whether it attached; the caller commits or discards. The Credit Card
    queue's attach (`api/expenses/card_invoices.attach_card_invoice`) is the model: `FOR UPDATE`, then a
    save through the document layer, so `doc_events` run and `track_changes` keeps a Version."""
    doc = frappe.get_doc(doctype, expense, for_update=True)
    if doc.invoice_attachment or _marked_no_invoice(doc):
        return False
    # The File first, so Frappe's attach-on-save hook finds it and mints no second one.
    _attach_file(saved, doctype, expense, "invoice_attachment")
    doc.invoice_attachment = saved.file_url
    doc.save(ignore_permissions=True)
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
