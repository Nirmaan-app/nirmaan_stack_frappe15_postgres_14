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
    retype    `card_review.set_card_expense_type`   a spend's expense type, on Review (#1568)
    suggest   `card_suggest.suggest_card_types`   expense type per spend, in the background after
                                                    upload (#1569); Review polls while it runs
    create    `card_create.create_card_expenses`    one Paid Non-Project Expense per spend, in the
                                                    background (#1568)
    discard   `discard_card_import`     an import Create has not written to; Admin and Accountant Lead

⚠️ IT NEVER RUNS THE MATCHER (`sources.NEVER_MATCHED_SOURCES`). The generic upload refuses this source.

⚠️ NOTHING IS SAVED BEFORE THE WHOLE FILE IS READ. `save_file` commits inside the request (the cloud
attachment hook), so every refusal -- a locked PDF, another company, the totals gate, a cash advance, the
same holder and period, nothing new -- happens before it.

⚠️ ITS LINES ARE NOT BANK LINES. Until Create settles them they are outside the main table's population
(`sources.CREATE_GATED_SOURCES`, `review._row_filters`): in no tab, not in *Still open*, not in *Total
Unreconciled Outflow*.
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
from nirmaan_stack.services.outflow_import.card_statement import merchant_key
from nirmaan_stack.services.outflow_import.card_types import CREATE_LINE_STATUSES, needs_check
from nirmaan_stack.services.outflow_import.status import ROW_ERROR, ROW_SETTLED
from nirmaan_stack.services.stored_files import delete_files


def suggest_job_id(batch: str) -> str:
    """The type suggestion job's id (#1569): one per import."""
    return f"card-suggest-{batch}"


def create_job_id(batch: str) -> str:
    """The Create job's id (#1568): one per import, so pressing Create twice queues it once."""
    return f"card-create-{batch}"


_SUGGEST_JOB = "nirmaan_stack.api.outflow_import.card_suggest.suggest_card_types"


def suggest_running(batch: str) -> bool:
    """The type suggestion job is queued or running: Review polls, and Create waits."""
    return is_job_enqueued(suggest_job_id(batch))


def job_ids(batch: str) -> list[str]:
    """The background jobs a card import may have queued: the type suggestion (#1569) and Create (#1568).
    Discard waits for both."""
    return [suggest_job_id(batch), create_job_id(batch)]


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
    waiting for Create (`Pending match run`), a credit open (`Mismatched`). Then queues the type suggestion
    (`card_suggest`, #1569), de-duplicated per import.
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
    # After the commit: the job reads the lines this request staged.
    frappe.enqueue(
        _SUGGEST_JOB, queue="long", timeout=1800, batch=batch, job_id=suggest_job_id(batch), deduplicate=True
    )
    return card_import(batch)


@frappe.whitelist()
def get_card_import(batch: str):
    """The card import, for Review: the statement's header and totals, and every line. READS ONLY.

    URL: /api/method/nirmaan_stack.api.outflow_import.card_import.get_card_import?batch=OFI-...
    """
    require_outflow_access()
    refuse_unless_card_import(batch)
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
    refuse_unless_card_import(batch, for_update=True)
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


def refuse_unless_card_import(batch: str, *, for_update: bool = False) -> None:
    """Refuse a batch that does not exist or is not a card import. `for_update` locks the batch row."""
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
        SELECT name, transfer_id, added_on, remarks, amount, direction, row_status, suggested_expense_type,
               type_source, suggested_name, outcome_note
        FROM "tabOutflow Import Row" WHERE import_batch = %s
        ORDER BY creation ASC, name ASC
        """,
        (batch,),
        as_dict=True,
    )
    spends = [line for line in lines if line.direction != "Credit"]
    statuses = [line.row_status for line in spends]

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
        # Create (#1568): spends created, failed on the last run, and still to create (waiting, failed, or
        # reopened by Unreconcile); whether its job is queued or running.
        "created": statuses.count(ROW_SETTLED),
        "failed": statuses.count(ROW_ERROR),
        "to_create": sum(1 for status in statuses if status in CREATE_LINE_STATUSES),
        "create_running": is_job_enqueued(create_job_id(batch)),
        # The type suggestion (#1569) is queued or running: Review polls until it is done, Create waits.
        "suggest_running": suggest_running(batch),
        # The live Non-Project types: the only ones Review offers and Create accepts.
        "expense_types": non_project_expense_types(),
        "lines": [_line(line, _date(line.added_on)) for line in lines],
    }


def _line(line, date: str | None) -> dict:
    """One statement line as Review lists it."""
    is_credit = line.direction == "Credit"
    return {
        "name": line.name,
        "serno": line.transfer_id,
        "date": date,
        "details": line.remarks,
        # The cleaned merchant name: Review retypes every spend of one merchant at once (#1569).
        "merchant": None if is_credit else merchant_key(line.remarks),
        "amount": float(line.amount or 0),
        "is_credit": is_credit,
        "row_status": line.row_status,
        # A spend's type and where it came from; "Check" while nobody has chosen it. Blank on a credit.
        "expense_type": None if is_credit else line.suggested_expense_type or None,
        "type_source": None if is_credit else line.type_source or None,
        "check": not is_credit and needs_check(line.type_source),
        # Review may still retype it: a spend Create would still write.
        "editable": not is_credit and line.row_status in CREATE_LINE_STATUSES,
        "expense": line.suggested_name if line.row_status == ROW_SETTLED else None,
        "outcome_note": line.outcome_note or None,
    }


def non_project_expense_types() -> list[str]:
    """Every live Expense Type a Non-Project Expense may take, by name."""
    return frappe.get_all("Expense Type", filters={"non_project": 1}, pluck="name", order_by="name asc")
