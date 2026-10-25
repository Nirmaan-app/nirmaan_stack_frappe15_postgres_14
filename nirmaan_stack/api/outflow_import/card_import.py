# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Credit Card Statement import: its own pipeline, beside Cashbook's and Porter's (ADR-0037, spec #1565).

A company card's monthly ICICI PDF becomes one *Paid* Non-Project Expense per card spend. The pure reader
is `services/outflow_import/card_statement.py`; the upload's steps are `card_upload`'s. This module holds
the endpoints.

THE STEPS
---------
    upload    `upload_card_statement`   read, gate, refuse, save the PDF, stage   batch + lines +
                                                                                 Credit Card Statement
    review    `get_card_import`         the statement's header, totals and lines   reads only
    suggest   (#1568)  expense type per spend, in the background
    create    (#1569)  one Non-Project Expense per spend
    discard   `discard_card_import`     an import Create has not written to; Admin and Accountant Lead

⚠️ IT NEVER RUNS THE MATCHER (`sources.NEVER_MATCHED_SOURCES`). The generic upload refuses this source.

⚠️ NOTHING IS SAVED BEFORE THE WHOLE FILE IS READ. `save_file` commits inside the request (the cloud
attachment hook), so every refusal -- a locked PDF, another company, the totals gate, a cash advance, the
same holder and period, nothing new -- happens before it.

⚠️ ITS SPENDS ARE NOT BANK LINES. Until Create settles them they are outside the main table's population
(`sources.line_waits_for_its_own_create`, `review._row_filters`): in no tab, not in *Total Unreconciled
Outflow*. An unpaired card CREDIT is decided on the main table, like a bank credit (#1567).
"""

import frappe
from frappe.utils.background_jobs import is_job_enqueued
from frappe.utils.file_manager import save_file

from nirmaan_stack.api.outflow_import.card_upload import (
    BATCH_DOCTYPE,
    ROW_DOCTYPE,
    SOURCE,
    STATEMENT_DOCTYPE,
    leave_out_repeats,
    read_statement,
    read_upload,
    refuse_same_period,
    stage,
)
from nirmaan_stack.api.outflow_import.permissions import has_outflow_undo_access, require_outflow_access
from nirmaan_stack.services.stored_files import delete_files


def job_ids(batch: str) -> list[str]:
    """The background jobs a card import may have queued: the type suggestion (#1568) and Create (#1569).
    Discard waits for both. One id per import, so a second press queues nothing."""
    return [f"card-suggest-{batch}", f"card-create-{batch}"]


@frappe.whitelist(methods=["POST"])
def upload_card_statement():
    """Read a Credit Card Statement PDF and stage it. Returns the import as `get_card_import` reports it.

    Multipart form: `file`, the bank's .pdf, unlocked.
    URL: /api/method/nirmaan_stack.api.outflow_import.card_import.upload_card_statement

    Refused, with the reason, and with NOTHING saved: a file that is not a .pdf; a password-locked PDF; a
    statement that is not this layout; a statement not issued to Stratos Infra Technologies; a non-zero
    Cash Advances; spends that do not equal Purchases / Charges or credits that do not equal Payments /
    Credits, to the paisa (both figures shown); a second statement for the same holder and billing period
    (naming the earlier import); a file whose every SerNo is already imported. A line whose SerNo is already
    imported is LEFT OUT and counted in the batch's `repeats_not_saved`.

    Saves: the PDF (private, one File, attached to the Credit Card Statement); the batch over the statement's
    billing period; the Credit Card Statement (header, totals); one line per new statement line -- a spend
    waiting for Create (`Pending match run`); a credit sorted (#1567, `card_credits`): a payment into the card,
    cashback and both lines of a refund pair skipped by rule, any other credit open (`Mismatched`).
    """
    user = require_outflow_access()
    filename, content = read_upload()
    statement = read_statement(content)
    refuse_same_period(statement)
    new = leave_out_repeats(statement)

    # ⚠️ THE FIRST WRITE, AND IT CANNOT BE ROLLED BACK: everything that can refuse has run above.
    saved = save_file(fname=filename, content=content, dt=None, dn=None, is_private=1)
    batch, record = stage(statement, new, file_url=saved.file_url, filename=filename, user=user)
    frappe.db.set_value(
        "File",
        saved.name,
        {
            "attached_to_doctype": STATEMENT_DOCTYPE,
            "attached_to_name": record,
            "attached_to_field": "statement_file",
        },
        update_modified=False,
    )
    frappe.db.commit()
    return card_import(batch)


@frappe.whitelist()
def get_card_import(batch: str):
    """The card import, for Review: the statement's header and totals, and every line. READS ONLY.

    URL: /api/method/nirmaan_stack.api.outflow_import.card_import.get_card_import?batch=OFI-...
    """
    require_outflow_access()
    _refuse_unless_card_import(batch)
    return card_import(batch)


@frappe.whitelist(methods=["POST"])
def discard_card_import(batch: str):
    """Delete a card import Create has not written to: its batch, lines, Credit Card Statement and PDF.

    URL: /api/method/nirmaan_stack.api.outflow_import.card_import.discard_card_import  (POST `batch`)

    Admin and Accountant Lead only. Returns `{"batch": <name>}`. Refused, with nothing deleted: not a card
    import; Create has created anything; a job of the import is queued or running.

    ⚠️ RAW DELETES, ON PURPOSE. None of these doctypes has `doc_events` and nothing is derived from them
    elsewhere. The File goes last, through `stored_files.delete_files`, because no rollback restores storage.
    """
    user = require_outflow_access()
    if not has_outflow_undo_access(user):
        frappe.throw(
            "Only an Admin or an Accountant Lead can discard a Credit Card Statement import.",
            frappe.PermissionError,
            title="Not permitted",
        )
    # The batch row lock serialises two Discards; the line locks wait for a Create line in flight.
    _refuse_unless_card_import(batch, for_update=True)
    rows = frappe.db.sql(
        """SELECT name FROM "tabOutflow Import Row" WHERE import_batch = %s FOR UPDATE""", (batch,), pluck=True
    )
    if created_anything(batch):
        frappe.throw(
            f"{batch} cannot be discarded: Create has already started on it. Correct its lines with Unreconcile "
            "instead.",
            title="Cannot discard",
        )
    running = [job for job in job_ids(batch) if is_job_enqueued(job)]
    if running:
        frappe.throw(
            f"{batch} is still being worked on in the background ({', '.join(running)}). Wait for it to finish, "
            "then discard it.",
            title="Cannot discard yet",
        )

    statements = frappe.get_all(STATEMENT_DOCTYPE, filters={"import_batch": batch}, pluck="name")
    for doctype, names in ((ROW_DOCTYPE, rows), (STATEMENT_DOCTYPE, statements), (BATCH_DOCTYPE, [batch])):
        if not names:
            continue
        frappe.db.delete("Version", {"ref_doctype": doctype, "docname": ["in", names]})
        frappe.db.delete("Comment", {"reference_doctype": doctype, "reference_name": ["in", names]})
        frappe.db.delete(doctype, {"name": ["in", names]})
    # LAST: no rollback restores a stored object.
    delete_files({"attached_to_doctype": STATEMENT_DOCTYPE, "attached_to_name": ["in", statements or [""]]})
    frappe.db.commit()
    return {"batch": batch}


def created_anything(batch: str) -> bool:
    """Create has written to this import: any match record (Settled, or Reversed by Unreconcile) outlives
    every correction, so an import that has created once stays created. Discard is refused from here on."""
    return bool(frappe.db.exists("Outflow Row Match", {"import_batch": batch}))


def _refuse_unless_card_import(batch: str, *, for_update: bool = False) -> None:
    if frappe.db.get_value(BATCH_DOCTYPE, batch, "source", for_update=for_update) != SOURCE:
        frappe.throw(f"{batch} is not an {SOURCE} import.", title="Not a card import")


def card_import(batch: str) -> dict:
    """The import as Review shows it: the statement's header and totals, the counts, and every line in
    statement order (by SerNo, which the bank issues in order of posting)."""
    meta = frappe.db.get_value(
        BATCH_DOCTYPE, batch, ["name", "original_filename", "repeats_not_saved", "gross_amount"], as_dict=True
    )
    statement = frappe.db.get_value(
        STATEMENT_DOCTYPE,
        {"import_batch": batch},
        [
            "name",
            "holder",
            "company",
            "statement_date",
            "period_from",
            "period_to",
            "statement_file",
            "previous_balance",
            "purchases_charges",
            "cash_advances",
            "payments_credits",
            "total_amount_due",
        ],
        as_dict=True,
    ) or frappe._dict()
    lines = frappe.db.sql(
        """
        SELECT name, transfer_id, added_on, remarks, amount, direction, row_status, skip_kind, skip_reason
        FROM "tabOutflow Import Row" WHERE import_batch = %s
        ORDER BY creation ASC, name ASC
        """,
        (batch,),
        as_dict=True,
    )
    spends = [line for line in lines if line.direction != "Credit"]

    def _date(value):
        return str(value)[:10] if value else None

    return {
        "batch": meta.name,
        "source": SOURCE,
        "statement": statement.name,
        "original_filename": meta.original_filename,
        "holder": statement.holder,
        "company": statement.company,
        "statement_date": _date(statement.statement_date),
        "period_from": _date(statement.period_from),
        "period_to": _date(statement.period_to),
        "statement_file": statement.statement_file,
        "totals": {
            key: float(statement.get(key) or 0)
            for key in (
                "previous_balance",
                "purchases_charges",
                "cash_advances",
                "payments_credits",
                "total_amount_due",
            )
        },
        "spends": len(spends),
        "credits": len(lines) - len(spends),
        "spends_total": float(sum(line.amount or 0 for line in spends)),
        # Lines already imported by an earlier statement, left out of this one.
        "repeats_not_saved": int(meta.repeats_not_saved or 0),
        # Discard is still possible: Create has written nothing. Who may discard is not asked here.
        "discardable": not created_anything(batch),
        "lines": [
            {
                "name": line.name,
                "serno": line.transfer_id,
                "date": _date(line.added_on),
                "details": line.remarks,
                "amount": float(line.amount or 0),
                "is_credit": line.direction == "Credit",
                "row_status": line.row_status,
                # A skipped line's kind and reason, for Review's skipped list (#1567); blank otherwise.
                "skip_kind": line.skip_kind or None,
                "skip_reason": line.skip_reason or None,
            }
            for line in lines
        ],
    }
