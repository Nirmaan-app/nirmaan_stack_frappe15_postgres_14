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

⚠️ RESUME FINISHES WHAT A STOPPED JOB LEFT (spec #1585 "Pressing Resume is always safe", code review S1, S2). The
work outside the job's own lines is durable: an open Collect payment still waiting for its bill is found again from
its line (`waiting_collect_lines`), and the late bills and the earlier lines this import re-opened are kept on the
batch (`Outflow Import Batch.cashbook_bill_work`, written at confirm), each late bill marked done as it is copied.
`bills_waiting` counts what is left; `cashbook.get_cashbook_status` says the batch stopped while any is, and
`resume_cashbook_import` re-queues the job, which copies only what is still waiting.
"""

from __future__ import annotations

from collections.abc import Callable

import frappe

BATCH_DOCTYPE = "Outflow Import Batch"

from nirmaan_stack.api.outflow_import.cashbook_lines import ROW_DOCTYPE, lock_line_if
from nirmaan_stack.services.outflow_import.bill_download import BillFile, BillRefused, download_bill
from nirmaan_stack.services.outflow_import.cashbook_collect import COLLECT_ROW_KIND
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED
from nirmaan_stack.services.reimbursements.receipts import merge_to_pdf
from nirmaan_stack.services.stored_files import delete_files

BILLS_NOT_STORED = "the bills could not be stored"
BILLS_NOT_MERGED = "the bills could not be merged into one PDF"


def fetch_bill(url: str) -> BillFile | BillRefused:
    """THE SEAM tests replace: one bill link through the guard (`bill_download.download_bill`).

    ⚠️ NO NETWORK UNDER TESTS. A test that runs the job without replacing this gets a refusal, never a
    request: every Cashbook fixture carries real-looking links to the production bucket.
    """
    if frappe.flags.in_test:
        return BillRefused("bill downloads are off under tests")
    return download_bill(url)


def links_of(line) -> list[str]:
    """A staged line's bill links, in the statement's order (`Outflow Import Row.bill_links`, #1590)."""
    return (frappe.parse_json(line.bill_links) or {}).get("links") or [] if line.bill_links else []


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
    _copy_onto(
        row_name,
        line.transfer_id,
        links_of(line),
        attach=lambda saved: _attach_invoice(line.suggested_doctype, line.suggested_name, saved),
        failure=("Cashbook import: could not copy a bill", f"{row_name} / {line.suggested_name}"),
    )


# --- an open Collect payment (#1595) ----------------------------------------------------------------------


def store_collect_bills(batch: str) -> None:
    """Copy the bills of each open Collect payment of `batch`, and of the earlier lines this import re-opened (#1596),
    onto its line as `stored_bill`. Never raises, never fails a line.

    A line whose copy fails stays open with no stored bill, and the reason is written on its `bill_problem`.
    """
    for line in waiting_collect_lines(batch):
        _copy_onto(
            line.name,
            line.transfer_id,
            links_of(line),
            attach=lambda saved, name=line.name: _set_stored_bill(name, saved),
            failure=("Cashbook import: could not copy a Collect payment's bill", line.name),
        )


def waiting_collect_lines(batch: str) -> list:
    """The open Collect payments of `batch`, and the earlier lines it re-opened, whose bills are still to be copied:
    bill links, no stored bill and no `bill_problem`. THE ONE DEFINITION the job copies from and Resume counts."""
    reopened = tuple(bill_work(batch).get("reopened") or ())
    # ⚠️ `IN %(reopened)s` only when there are some: an empty tuple renders `IN ()`, a syntax error in Postgres.
    also = "OR name IN %(reopened)s" if reopened else ""
    return frappe.db.sql(
        f"""
        SELECT name, transfer_id, bill_links FROM "tabOutflow Import Row"
        WHERE (import_batch = %(batch)s {also})
          AND row_kind = %(kind)s AND row_status = %(open)s AND bill_links IS NOT NULL
          AND COALESCE(stored_bill, '') = '' AND COALESCE(bill_problem, '') = ''
        ORDER BY name
        """,
        {"batch": batch, "reopened": reopened, "kind": COLLECT_ROW_KIND, "open": ROW_MISMATCHED},
        as_dict=True,
    )


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
    would (`late_bills_not_copied`). A job that dies part-way leaves the rest undone, and Resume does them.
    """
    work = bill_work(batch)
    for bill in work.get("late_bills") or []:
        if bill.get("done"):
            continue
        try:
            problem = _store_and_attach(bill["doctype"], bill["expense"], bill["transfer_id"], bill["links"])
        except Exception:
            frappe.db.rollback()
            frappe.log_error(
                title="Cashbook import: a late bill was not copied",
                message=f"{batch} / {bill['transfer_id']} / {bill['doctype']} {bill['expense']}\n\n{frappe.get_traceback()}",
            )
            problem = not_copied(len(bill["links"]), BILLS_NOT_STORED)
        bill.update({"done": True, "problem": problem})
        _save_bill_work(batch, work)


def bill_work(batch: str) -> dict:
    """The batch's `cashbook_bill_work`: `{"late_bills": [...], "reopened": [...]}`, or `{}` (a batch from before it,
    or one with no such work)."""
    stored = frappe.db.get_value(BATCH_DOCTYPE, batch, "cashbook_bill_work")
    return (frappe.parse_json(stored) if stored else None) or {}


def _save_bill_work(batch: str, work: dict) -> None:
    """Raw (`set_value`): `Outflow Import Batch` has no doc_events, only the batch's one job writes this field after
    confirm, and nothing is derived from it."""
    frappe.db.set_value(BATCH_DOCTYPE, batch, "cashbook_bill_work", frappe.as_json(work), update_modified=False)
    frappe.db.commit()


def bills_waiting(batch: str) -> int:
    """How many bill copies of `batch` the job has still to make: its open Collect payments' and its late bills."""
    late = [bill for bill in bill_work(batch).get("late_bills") or [] if not bill.get("done")]
    return len(late) + len(waiting_collect_lines(batch))


def late_bills_not_copied(batch: str) -> list[dict]:
    """The late bills of `batch` that could not be copied, as the import summary lists a line's (`bills_not_copied`)."""
    return [
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


def _copy_onto(row_name: str, transfer_id: str, links: list[str], attach: Callable, failure: tuple[str, str]) -> None:
    """Steps 2 and 3 for one line's bills, with `attach(saved)` as step 3. Never raises: anything that stops the
    copy is written on the line's `bill_problem`, and an unexpected error is also logged (`failure` is the Error
    Log's title and subject)."""
    if not links:
        return
    try:
        saved, problem = download_and_save_bills(transfer_id, links)
        if saved is not None:
            store_or_discard(saved, lambda: attach(saved))
    except Exception:
        frappe.db.rollback()
        title, subject = failure
        frappe.log_error(title=title, message=f"{subject}\n\n{frappe.get_traceback()}")
        problem = not_copied(len(links), BILLS_NOT_STORED)
    if problem:
        # Raw: `Outflow Import Row` has no doc_events, and only the job writes this field.
        frappe.db.sql(
            """UPDATE "tabOutflow Import Row" SET bill_problem = %s WHERE name = %s""", (problem, row_name)
        )
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

    from frappe.utils.file_manager import save_file

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
    """Whether a person marked this Expense No invoice. Read only where the doctype has the field (both Expense
    doctypes have it since #1592)."""
    return bool(frappe.get_meta(doc.doctype).has_field("no_invoice_by") and doc.get("no_invoice_by"))
