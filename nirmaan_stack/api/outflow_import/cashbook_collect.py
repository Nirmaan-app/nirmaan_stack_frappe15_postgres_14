# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A person decides each Collect payment (#1595, spec #1585, ADR-0015 Amendment B decision 6).

A *Collect payment* is a wallet line where a shop asked for money and the employee approved it. It may not be
a company spend, so the import never records it on its own: the plan stages it as an open line at
`Mismatched` (`services/outflow_import/cashbook_collect`), which the job never takes, and a person picks
Create expense or Skip by hand on the main table. This module holds the two import-side halves of that:

  * **its bill, copied at import** (`store_collect_bills`, run by the Cashbook job). The links die 7 days after
    export, and the decision may come later. The bills go through the job's one downloader path
    (`cashbook.download_and_save_bills`), outside any line transaction, and the stored File is set on the line
    under the line's row lock (`_set_stored_bill`), only while it is still open and has no stored bill;
  * **what a Create from such a line adds** (`statement_line_create_extras`, read by `expenses.create_expense`):
    the Cashbook marker, so the Expense waits in Pending Invoices Upload -> Cashbook, and the stored bill as its
    invoice.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.outflow_import.cashbook_collect import COLLECT_ROW_KIND
from nirmaan_stack.services.outflow_import.settle import ExpenseInvoice
from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED

ROW_DOCTYPE = "Outflow Import Row"


def store_collect_bills(batch: str, also=()) -> None:
    """Copy each open Collect payment's bills of `batch`, and of the lines named in `also` (earlier lines this import
    re-opened, #1596), onto its line. Never raises, never fails a line.

    A line whose copy fails stays open with no stored bill, and the reason is written on its `bill_problem`, which
    the import summary (`cashbook.get_cashbook_status` -> `bills_not_copied`) lists.
    """
    waiting = {
        "row_kind": COLLECT_ROW_KIND,
        "row_status": ROW_MISMATCHED,
        "stored_bill": ["is", "not set"],
        "bill_problem": ["is", "not set"],
    }
    scopes = [{"import_batch": batch}] + ([{"name": ["in", list(also)]}] if also else [])
    for scope in scopes:
        for line in frappe.get_all(
            ROW_DOCTYPE, filters={**waiting, **scope}, fields=["name", "transfer_id", "bill_links"], order_by="name asc"
        ):
            _copy_one(line)


def _copy_one(line) -> None:
    from nirmaan_stack.api.outflow_import import cashbook

    links = cashbook._links_of(line)
    if not links:
        return
    try:
        saved, problem = cashbook.download_and_save_bills(line.transfer_id, links)
        if saved is not None:
            cashbook.store_or_discard(saved, lambda: _set_stored_bill(line.name, saved))
    except Exception:
        frappe.db.rollback()
        frappe.log_error(
            title="Cashbook import: could not copy a Collect payment's bill",
            message=f"{line.name}\n\n{frappe.get_traceback()}",
        )
        problem = cashbook._not_copied(len(links), cashbook._BILLS_NOT_STORED)
    if problem:
        # Raw: `Outflow Import Row` has no doc_events, and the line stays open whatever this says.
        frappe.db.sql(
            """UPDATE "tabOutflow Import Row" SET bill_problem = %s WHERE name = %s""", (problem, line.name)
        )
    frappe.db.commit()


def _set_stored_bill(row_name: str, saved) -> bool:
    """Lock the line and set `saved` as its stored bill, only while it is still an open line with none. Returns
    whether it did; the caller discards the File when it did not (a person Created or Skipped it meanwhile, and
    an Expense created without the bill simply waits for its invoice in the Cashbook tab)."""
    rows = frappe.db.sql(
        """SELECT row_status, stored_bill FROM "tabOutflow Import Row" WHERE name = %s FOR UPDATE""",
        (row_name,),
        as_dict=True,
    )
    if not rows or rows[0].row_status != ROW_MISMATCHED or rows[0].stored_bill:
        return False
    frappe.db.set_value(
        "File",
        saved.name,
        {"attached_to_doctype": ROW_DOCTYPE, "attached_to_name": row_name, "attached_to_field": "stored_bill"},
        update_modified=False,
    )
    # Raw: no doc_events on the line, and this field has no reader that a hook would owe a recompute.
    frappe.db.sql(
        """UPDATE "tabOutflow Import Row" SET stored_bill = %s WHERE name = %s""", (saved.file_url, row_name)
    )
    frappe.db.commit()
    return True


def statement_line_create_extras(doc, source: str | None) -> dict:
    """What a Create on the main table adds for a line staged by the Cashbook Statement import (#1595): the
    Cashbook marker (`cashbook_batch`), so the new Expense waits in the Cashbook tab while it has no invoice, and
    the line's stored bill as its invoice. Empty for any other line.

    Such a line is told apart by its stored statement Type (`row_kind`), which only that import writes: an older
    Cashbook line has none, and its Expense must never wait (spec #1585 "Which Expenses wait").

    The stored bill's URL is copied, never a second File made: its one File stays attached to the line, as the
    Porter import's invoice stays attached to its Porter Invoice (`settle.ExpenseInvoice`).
    """
    if source != CASHBOOK_SOURCE or not (doc.get("row_kind") or "").strip():
        return {}
    extras: dict = {"cashbook_batch": doc["import_batch"]}
    if doc.get("stored_bill"):
        extras["invoice"] = ExpenseInvoice(number="", file_url=doc["stored_bill"])
    return extras
