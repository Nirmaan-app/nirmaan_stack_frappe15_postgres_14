# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cashbook import: preview, confirm, and the job that writes (Cashbook slice 5).

A petty-cash wallet statement becomes Project and Non-Project Expenses. THIS IS THE ONE PLACE IN
THE FEATURE THAT CREATES RECORDS NOBODY APPROVED -- an owner ruling, and narrower than it sounds
because `Project Expenses` already auto-approves anything under Rs 5,000 on creation, which on a
measured statement was 113 of 115 rows.

THREE PHASES, AND NOTHING IS WRITTEN UNTIL THE THIRD
----------------------------------------------------
    read     `preview_cashbook_statement`   parse, plan, return the rollup.   WRITES NOTHING
    confirm  `confirm_cashbook_import`      refuse, save the file, stage,     batch + rows only
                                            enqueue.
    write    `_cashbook_worker`             create the expenses.              one row at a time

An abandoned import therefore leaves no trace at all, which is what the Cashfree preview already
guarantees and worth keeping.

⚠️ IT DOES NOT RUN `match_batch`, AND MUST NOT. The tier ladder looks for an approved record by
UTR, by bank account and by amount -- a wallet statement carries no reference and no account, so
the ladder can find nothing, and the one thing it COULD find is a real approved payment that
happens to share an amount. Running it here would risk settling a vendor payment against somebody's
lunch.

⚠️ THE PLAN IS STORED ON THE ROW, NOT RECOMPUTED BY THE JOB. `suggested_doctype`,
`resolved_project` and `suggested_expense_type` are written at confirm time and read back by the
worker. Re-planning in the worker would be a SECOND computation of the same decision, free to
disagree with the one a person just approved -- somebody editing an alias in the seconds between
is all it would take. It also means the row itself says what was decided, which is the only place a
reviewer can see it after the fact.

WHY A BACKGROUND JOB (owner ruling). 115 expense inserts, each with its own document lifecycle and
its own commit, is minutes rather than seconds, and a gateway timeout mid-run is the worst state to
be in. The worker commits PER ROW, so a run that dies at row 60 leaves 59 durable expenses and 56
rows still pending -- and re-running it picks up exactly where it stopped, because each line is
re-read under its row lock and written only while still `Pending match run` (#1586). (`Outflow Row
Match`'s unique key is no help here: a Cashbook line CREATES its target, so the key is never contended.)

⚠️ THE STATEMENT IS NOT ATTACHED PER ROW (owner ruling). `link_statement_file_to_target` is
deliberately NOT called here: the expense's `payment_attachment` carries the statement's URL, but no
second `File` row is created for it. The consequence was measured and accepted -- Frappe authorises
a private file through the document it is attached to, and the statement stays attached to the
batch, which 3 roles can read while 19 can read the expenses. So the attachment opens for
accountants and administrators and returns 403 for everyone else. Reversing it is one call.
"""

import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import frappe
from frappe.utils.background_jobs import is_job_enqueued

from nirmaan_stack.api.outflow_import.expenses import (
    MATCH_DOCTYPE,
    _statement_file_url,
    already_imported_sentence,
)
from nirmaan_stack.api.outflow_import.cashbook_bills import (
    attach_late_bills,
    bill_work,
    bills_not_copied,
    bills_waiting,
    copy_created_line_bills,
    new_bill_work,
    save_bill_work,
    store_collect_bills,
)
from nirmaan_stack.api.outflow_import.cashbook_lines import (
    BATCH_DOCTYPE,
    MATCH_BASIS,
    ROW_DOCTYPE,
    line_values,
    lock_line_if,
)
from nirmaan_stack.api.outflow_import.cashbook_reopen import claim_reopens, reopen_lines, wrong_skips
from nirmaan_stack.api.outflow_import import internal_transfers as internal_transfer_records
from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.api.outflow_import.review import StagedRow
from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.bill_links import expired_links_refusal
from nirmaan_stack.services.outflow_import.candidates import (
    load_expense_rules,
    load_project_aliases,
    prior_import_sightings,
)
from nirmaan_stack.services.outflow_import.cashbook import CashbookPlan, plan_statement
from nirmaan_stack.services.outflow_import.cashbook_collect import COLLECT_ROW_KIND
from nirmaan_stack.services.outflow_import.cashbook_late_bills import LateBill, late_bills
from nirmaan_stack.services.outflow_import.cashbook_review import preview_payload
from nirmaan_stack.services.outflow_import.concurrency import is_concurrent_writer_refusal
from nirmaan_stack.services.outflow_import.duplicates import (
    DuplicateVerdict,
    assess_duplicates,
    find_prior_sighting,
    index_prior_sightings,
)
from nirmaan_stack.services.outflow_import.import_comment import import_comment
from nirmaan_stack.services.outflow_import.import_created_expense import is_import_created_expense_refusal
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.parser import (
    StatementFormatError,
    parse_statement,
    stored_money,
)
from nirmaan_stack.services.outflow_import.project_match import build_project_index
from nirmaan_stack.services.outflow_import.settle import create_expense_from_row
from nirmaan_stack.services.outflow_import.status import (
    ROW_ERROR,
    ROW_INTERNAL_TRANSFER,
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
    SKIP_ORIGIN_SYSTEM,
)
from nirmaan_stack.services.outflow_import.row_settlement import refresh_batch_rollup
from nirmaan_stack.services.outflow_import.skip_kinds import SKIP_KIND_ALREADY_IMPORTED

SOURCE = "Cashbook"

_WORKER = "nirmaan_stack.api.outflow_import.cashbook._cashbook_worker"

# Spec #1585 story 1 and code review S4: only the Cashbook Statement as downloaded, whose bill links are cell
# hyperlinks. A CSV cannot carry a hyperlink, so a .csv is refused before it is read.
_ALLOWED_EXTENSIONS = frozenset({".xlsx"})
_MAX_FILE_BYTES = 5 * 1024 * 1024

# Only Won projects are offered. A petty-cash spend is booked against live work; a tendering or
# lost project cannot be receiving materials.
_WON = "Won"


@frappe.whitelist(methods=["POST"])
def preview_cashbook_statement():
    """Parse a wallet statement and report exactly what confirming it would create. WRITES NOTHING.

    Multipart form: `file` (the Cashbook Statement, .xlsx).
    URL: /api/method/nirmaan_stack.api.outflow_import.cashbook.preview_cashbook_statement

    The browser re-posts the same file on confirm, as the Cashfree preview already does and for the
    same reason: holding a parse between two requests would mean session state, an expiry, and a
    way for confirm to act on a file that is no longer the one on screen.
    """
    _, filename, _, parsed = _read_and_parse()
    plan = _build_plan(parsed)
    late = _late_bills(parsed, plan)
    fills = internal_transfer_records.zero_records_to_fill(parsed.rows)
    verdict = _assess(parsed, plan, filename, late, fills)
    return preview_payload(parsed, plan, filename, verdict, [_late_bill_preview(b) for b in late], len(fills))


@frappe.whitelist(methods=["POST"])
def confirm_cashbook_import():
    """Stage the statement and start writing. Returns the batch to watch.

    Multipart form: `file` (the Cashbook Statement, .xlsx).
    URL: /api/method/nirmaan_stack.api.outflow_import.cashbook.confirm_cashbook_import

    ⚠️ IT RE-PLANS FROM THE RE-POSTED FILE rather than trusting anything the browser computed. The
    preview is a rendering of the server's decision, never an input to it -- a client that could
    submit its own placement could book a spend to any project it liked.
    """
    user, filename, content, parsed = _read_and_parse()
    plan = _plan_claiming_reopens(parsed)
    late = _late_bills(parsed, plan)

    # ⚠️ THE REFUSAL COMES BEFORE `save_file`, the only place it can (ADR-0031, as on the Cashfree
    # path): `save_file` commits inside this request, so a refusal after it would leave an orphan File
    # for a statement we declined. A file of nothing but exact repeats writes NOTHING AT ALL -- unless some of
    # them bring a bill for an Expense still waiting for one (#1593).
    fills = internal_transfer_records.zero_records_to_fill(parsed.rows)
    verdict = _assess(parsed, plan, filename, late, fills)
    if verdict.refuse:
        frappe.throw(verdict.message, title="Already imported")

    from frappe.utils.file_manager import save_file

    # Saved BEFORE the batch because `save_file` is not rollback-able -- the cloud attachment hook
    # commits inside this request -- and the URL is read off the returned doc because that same
    # hook rewrites it during insert.
    saved = save_file(fname=filename, content=content, dt=None, dn=None, is_private=1)
    # ⚠️ CLAIMED AGAIN (code review S6): `save_file`'s commit released the claim's row locks, so another import could
    # have re-opened one of the lines since. This claim holds to the commit below, through `_stage`'s re-open.
    if plan.reopening:
        plan = _plan_claiming_reopens(parsed)
        late = _late_bills(parsed, plan)

    batch = _stage(
        parsed,
        plan,
        file_url=saved.file_url,
        filename=filename,
        user=user,
        late_bill_jobs=[_late_bill_job(bill) for bill in late],
    )
    internal_transfer_records.fill_zero_records(fills)
    # Raw (`set_value`): the File's own hooks run before insert only, and these pointer fields feed nothing of ours.
    frappe.db.set_value(
        "File",
        saved.name,
        {
            "attached_to_doctype": BATCH_DOCTYPE,
            "attached_to_name": batch.name,
            "attached_to_field": "source_file",
        },
        update_modified=False,
    )
    frappe.db.commit()

    _enqueue_worker(batch.name, user)
    return {
        "batch": batch.name,
        "creating": len(plan.creating),
        "skipping": len(plan.skipping),
        "opening": len(plan.opening),
        # #1623: Cashbook's own moves, staged as Internal Transfer lines.
        "internal_transfers": len(plan.internal),
        "repeats_not_saved": plan.split.repeats_not_saved,
        # #1593: the existing Expenses the job will give a bill.
        "late_bills": len(late),
        # #1596: the earlier lines this import re-opened in place.
        "reopened": len(plan.reopening),
        # Owner decision 2 (#1619): the ₹0 Internal Transfer records this file gave their money.
        "records_filled": len(fills),
    }


@frappe.whitelist()
def get_cashbook_status(batch: str):
    """How far the job has got. Counted from the ROWS, which are the durable record.

    ⚠️ NO REDIS MARKER FOR THE COUNTS, deliberately. The rows already carry the answer, they survive a
    worker restart, and a marker would be a second account of the same fact -- free to disagree with the
    table the screen reads next. Progress is simply how many rows have stopped being pending.

    ⚠️ `running` IS THE JOB, NOT THE PENDING COUNT (#1589, spec #1585 gap F). A job that died part-way
    leaves its remaining lines `Pending match run` with no job to write them, so "pending > 0" would say
    "running" for ever. `running` asks the queue whether the batch's job is queued or started;
    `stopped` is the state Resume answers: lines still waiting and no job to write them. (A worker
    killed outright stays "started" in RQ until RQ marks the job abandoned, so `stopped` can lag a hard
    kill by RQ's own clean-up interval; it never shows while a job really runs.)

    ⚠️ BILLS STILL TO COPY STOP A BATCH TOO (code review S1, S2). The job copies its open Collect payments' bills
    and its late bills after its lines, so a job that dies after the last line leaves no pending line and work
    still undone. `bills_waiting` counts it (`cashbook_bills.bills_waiting`), and `stopped` covers it.
    """
    require_outflow_access()
    counts = dict(
        frappe.db.sql(
            """
            SELECT row_status, COUNT(*)
            FROM "tabOutflow Import Row"
            WHERE import_batch = %s
            GROUP BY row_status
            """,
            (batch,),
        )
    )
    pending = counts.get(ROW_PENDING_MATCH, 0)
    running = is_job_enqueued(_job_id(batch))
    waiting_bills = bills_waiting(batch)
    return {
        "batch": batch,
        "created": counts.get(ROW_SETTLED, 0),
        "failed": counts.get(ROW_ERROR, 0),
        "skipped": counts.get(ROW_SKIPPED, 0),
        # #1623: Cashbook's own moves, staged as Internal Transfer lines.
        "internal_transfers": counts.get(ROW_INTERNAL_TRANSFER, 0),
        # #1594: the open lines (unpaired wallet refunds, wallet credits, and any line a person reopened).
        "open": counts.get(ROW_MISMATCHED, 0),
        "pending": pending,
        # #1595 / #1593: open Collect payments' bills and late bills the job has still to copy.
        "bills_waiting": waiting_bills,
        "running": running,
        "stopped": (pending > 0 or waiting_bills > 0) and not running,
        "batch_status": frappe.db.get_value(BATCH_DOCTYPE, batch, "status"),
        # #1591: every created spend whose bills were not copied onto its Expense, and why; #1595: an open Collect
        # payment's (no Expense); #1593: a late bill's, which has no line of its own (code review S2).
        "bills_not_copied": bills_not_copied(batch),
    }


@frappe.whitelist(methods=["POST"])
def resume_cashbook_import(batch: str):
    """Start the job again on a Cashbook import that stopped part-way. Returns `get_cashbook_status`.

    URL: /api/method/nirmaan_stack.api.outflow_import.cashbook.resume_cashbook_import  (POST `batch`)

    Admin, Accountant Lead and Accountant (the Bulk Import gate). Card Create's "Run Create again"
    (`card_create.create_card_expenses`) is the model. Re-queues the SAME job under the SAME job id as
    confirm did, so the queue's de-duplication keeps one job per batch; it is refused, with a sentence,
    while that job is queued or running, and once no line and no bill copy is left waiting (`bills_waiting`).

    ⚠️ PRESSING IT IS ALWAYS SAFE. The job takes only `Pending match run` lines, and each is re-read
    under its row lock and written only while still pending (`_lock_pending_line`, #1586); the
    one-Expense-per-Txn-Id index (#1588) refuses a second Expense for one wallet spend whatever path
    tries. A Resume racing a live job, or pressed twice, creates nothing twice.
    """
    user = require_outflow_access()
    if frappe.db.get_value(BATCH_DOCTYPE, batch, "source") != SOURCE:
        frappe.throw(f"{batch} is not a {SOURCE} import.", title="Not a Cashbook import")
    if is_job_enqueued(_job_id(batch)):
        frappe.throw(
            f"The Cashbook import {batch} is still creating its expenses. Wait for it to finish.",
            title="Still running",
        )
    if not frappe.db.exists(ROW_DOCTYPE, {"import_batch": batch, "row_status": ROW_PENDING_MATCH}) and not bills_waiting(
        batch
    ):
        frappe.throw(
            f"No line of {batch} is waiting to be created, and no bill is waiting to be copied.",
            title="Nothing waiting",
        )
    _enqueue_worker(batch, user)
    return get_cashbook_status(batch)


def _job_id(batch: str) -> str:
    """The batch's ONE job id: confirm and Resume both queue under it, so de-duplication sees one job."""
    return f"cashbook-import-{batch}"


def _enqueue_worker(batch: str, actor: str) -> None:
    frappe.enqueue(
        _WORKER,
        queue="long",
        timeout=3600,
        batch=batch,
        actor=actor,
        job_id=_job_id(batch),
        deduplicate=True,
    )


def _cashbook_worker(
    batch: str, actor: str, late_bills: list[dict] | None = None, reopened: list[str] | None = None
):
    """Create one expense per planned row. ONE TRANSACTION PER ROW.

    ⚠️ COMMIT PER ROW, NOT PER BATCH, and that is what makes a partial run safe. A worker killed at
    row 60 leaves 59 durable expenses and the rest still pending; re-running processes only what is
    still pending.

    ⚠️ A FAILING ROW MARKS ITSELF AND THE RUN CONTINUES. One unresolvable row must not strand the
    other hundred -- the reviewer has already approved the whole batch, and stopping would leave
    them with no way to tell which rows went through.

    ⚠️ A CREATED LINE'S BILLS ARE COPIED AFTER ITS COMMIT, NEVER INSIDE IT (#1591). `save_file` commits
    mid-save, so the download and the save run between the line's transaction and a short second one that
    attaches the invoice (`cashbook_bills.copy_created_line_bills`). A bill that cannot be copied never fails the line.

    ⚠️ THE LIST BELOW IS A SNAPSHOT, NOT A CLAIM (#1586, spec #1585 gap A). Another run, a Resume or a
    person may take a listed line before this run reaches it, so `_write_one` re-reads each line under
    its row lock and writes nothing unless it is still `Pending match run`; a line it did not write is
    rolled back, not marked. The rollup at the end reads the rows in a fresh transaction (every line
    ends its own), so it counts what they really say.

    After the lines, the bills outside them (code review S1, S2, R1): the late bills (#1593) and the Collect
    payment lines whose bills this import copies (#1595, and the earlier ones it re-opened, #1596) are read from the
    batch (`cashbook_bills.bill_work`), not from the job's arguments, so Resume redoes whatever a dead job left.
    `late_bills` / `reopened` are accepted only from a job queued before that change, and kept on the batch first.
    """
    if (late_bills or reopened) and not bill_work(batch):
        save_bill_work(batch, new_bill_work(list(late_bills or ()), list(reopened or ())))
    statement_file_url = _statement_file_url(batch)
    rows = frappe.db.sql(
        """
        SELECT name FROM "tabOutflow Import Row"
        WHERE import_batch = %s AND row_status = %s AND suggested_doctype IS NOT NULL
        ORDER BY name
        """,
        (batch, ROW_PENDING_MATCH),
        pluck=True,
    )

    for row_name in rows:
        try:
            written = _write_one(row_name, batch, actor, statement_file_url)
        except Exception as exc:
            frappe.db.rollback()
            _write_failed(row_name, batch, exc)
            continue
        if written:
            frappe.db.commit()
            copy_created_line_bills(row_name, actor)
        else:
            # Another run or a person took the line: nothing of ours to keep, and nothing to mark.
            frappe.db.rollback()

    attach_late_bills(batch, actor)

    # #1595: each open Collect payment's bills are copied onto its line now, while the links still work.
    store_collect_bills(batch)

    refresh_batch_rollup(batch)
    frappe.db.commit()


def _write_failed(row_name: str, batch: str, exc: Exception) -> None:
    """THE JOB'S ONE ERROR PATH, run after the failed line's rollback: log it, then mark the line.

    ⚠️ THE MARK IS CONDITIONAL (`_mark_if_still_pending`). Between the rollback and the mark the line is
    unlocked, and another transaction may have Settled it; a blind write would turn that Settled line to
    Error. Every outcome of a failed write goes through this one function: a database refusal that
    means something other than "could not create" (spec #1585 C's index, #1588) is told apart here, by
    `exc`, and written through the same conditional mark -- nowhere else.

    ⚠️ AN INDEX REFUSAL IS NOT AN ERROR (spec #1585 C). Another line already created this Txn Id's Expense
    -- an overlapping batch, a person -- and the one-Expense-per-Txn-Id index refused this one. The line
    becomes the "Already imported" system skip naming that Expense, which is read HERE, after the rollback:
    the failed transaction's snapshot could not see it. No error is logged for it.
    """
    if is_import_created_expense_refusal(exc):
        sentence = already_imported_sentence(frappe.db.get_value(ROW_DOCTYPE, row_name, "transfer_id"))
        if sentence:
            _mark_if_still_pending(
                row_name,
                {
                    "row_status": ROW_SKIPPED,
                    "skip_reason": sentence,
                    "outcome_note": sentence,
                    "skip_origin": SKIP_ORIGIN_SYSTEM,
                    "skip_kind": SKIP_KIND_ALREADY_IMPORTED,
                },
            )
            return
        # `None`: the holder was Unreconciled between the refusal and this read. Nothing holds the Txn Id any
        # more, so it is an ordinary failure and the line can be retried.
    frappe.log_error(
        title="Cashbook import: could not create an expense",
        message=f"{batch} / {row_name}\n\n{frappe.get_traceback()}",
    )
    # The log is kept even if the mark below is refused: it is the only trace of why the write failed.
    frappe.db.commit()
    _mark_if_still_pending(
        row_name, {"row_status": ROW_ERROR, "outcome_note": "Could not create this expense."}
    )


def _mark_if_still_pending(row_name: str, values: dict) -> bool:
    """Write `values` onto the line ONLY while it is still `Pending match run`, and commit. Returns whether
    it wrote.

    A line another run or a person took meanwhile is left exactly as they left it: the `WHERE` matches
    nothing, or -- when they committed after this statement's snapshot -- Postgres refuses the update with
    a serialization failure (REPEATABLE READ), which means the same thing and is rolled back.

    Raw: `Outflow Import Row` has no doc_events, and the batch rollup is recomputed from the rows at the
    end of the run.
    """
    assignments = ", ".join(f'"{field}" = %({field})s' for field in values)
    try:
        written = bool(
            frappe.db.sql(
                f"""
                UPDATE "tabOutflow Import Row" SET {assignments}
                WHERE name = %(_row)s AND row_status = %(_pending)s
                RETURNING name
                """,
                {**values, "_row": row_name, "_pending": ROW_PENDING_MATCH},
            )
        )
    except Exception as exc:
        frappe.db.rollback()
        if not is_concurrent_writer_refusal(exc):
            raise
        return False
    frappe.db.commit()
    return written


def _lock_pending_line(row_name: str):
    """The line, read under its row lock -- or `None` when it is no longer this job's to write.

    `None` means another run or a person took it: it is no longer `Pending match run`, or it changed
    after this transaction's snapshot and the lock read raised a serialization failure. The caller rolls
    back either way. Card Create's per-line read (`card_create._create_one`) is the model.

    ⚠️ BOTH ISOLATION LEVELS END HERE, AND THE JOB MEETS BOTH. Only a connection's FIRST transaction runs
    at REPEATABLE READ (psycopg2's own `BEGIN ISOLATION LEVEL ...`); every one after a `frappe.db.commit()`
    is Frappe's plain `START TRANSACTION`, at the server default READ COMMITTED (measured on the dev env).
    At REPEATABLE READ a line changed after the snapshot raises the serialization failure; at READ
    COMMITTED the lock read waits for the other writer and returns the line as it left it, which the
    status check then refuses.
    """
    try:
        return lock_line_if(row_name, lambda line: line.row_status == ROW_PENDING_MATCH)
    except Exception as exc:
        if not is_concurrent_writer_refusal(exc):
            raise
        return None


def _write_one(row_name: str, batch: str, actor: str, statement_file_url: str | None) -> bool:
    """One row -> one expense -> one match record -> the row flips to Settled. Returns whether it wrote:
    `False` -- nothing written -- when the line is no longer this job's (`_lock_pending_line`)."""
    doc = _lock_pending_line(row_name)
    if doc is None:
        return False

    # ⚠️ THE ADAPTER, NOT A RAW `frappe.get_doc`. `create_expense_from_row` reads its argument BY
    # ATTRIBUTE, and two of the attributes it wants are DERIVED rather than stored: `added_on_date`
    # (from the `added_on` datetime) and a `Decimal` amount. `StagedRow` computes both; a
    # `Document` has neither, and `getattr(doc, "added_on_date", None)` returns None in silence.
    #
    # It cost 115 expenses with a BLANK `payment_date` on the first production import -- every
    # figure else correct, nothing raised, and no test could see it because the fixtures asserted
    # the fields the writer sets rather than the ones it derives. Found by reading the records back
    # out of the database after a real run. `expenses.create_expense` has always used this adapter;
    # this path simply did not, which is the whole of the defect.
    staged = StagedRow(doc)
    result = create_expense_from_row(
        staged,
        doctype=doc["suggested_doctype"],
        expense_type=doc["suggested_expense_type"],
        actor=actor,
        project=doc.get("resolved_project"),
        # Description is left to `settle._default_description`, which composes the payee with the
        # remark. Deciding it here would be a second definition of the same sentence.
        description=None,
        comment=import_comment(None, batch),
        statement_file_url=statement_file_url,
        # ⚠️ WHO SPENT IT, from the statement's own `From` column -- not the accountant importing it.
        payment_by=(doc.get("added_by_raw") or "").strip() or None,
        # #1592: the marker that makes this wallet spend wait in Pending Invoices Upload -> Cashbook.
        cashbook_batch=batch,
        # ⚠️ NO `payment_ref` OVERRIDE ANY MORE, AND THAT IS THE SLICE (ADR-0020 B9). It used to
        # pass the wallet's transaction id here, because there is no UTR -- a per-path remedy that
        # fixed THIS write site and left the payment one blank for this source. `_stage` now
        # resolves the same value into `settlement_reference` at ingest, so `staged` carries it and
        # every write site reads the one field.
    )

    match = frappe.new_doc(MATCH_DOCTYPE)
    match.update(
        {
            "import_row": row_name,
            "import_batch": batch,
            "transfer_id": doc["transfer_id"],
            # #1601: the one-Expense-per-Txn-Id index reads it; this writer only ever writes Cashbook lines.
            "source": SOURCE,
            "target_doctype": result.doctype,
            "target_name": result.name,
            "target_amount": float(result.amount),
            "match_kind": "Settled",
            "match_basis": MATCH_BASIS,
            "settlement_origin": "Suggestion accepted",
            # #1278: the Cashbook writer only ever creates (`create_expense_from_row` above).
            "created_by_import": 1 if result.created else 0,
            "matched_at": frappe.utils.now_datetime(),
            "matched_by": actor,
        }
    )
    match.insert(ignore_permissions=True)

    frappe.db.set_value(
        ROW_DOCTYPE,
        row_name,
        {
            "row_status": ROW_SETTLED,
            "suggested_name": result.name,
            "outcome_note": f"Created {result.doctype} {result.name}.",
            "decided_at": frappe.utils.now_datetime(),
            "decided_by": actor,
            "settlement_origin": "Suggestion accepted",
        },
        update_modified=False,
    )
    return True


def _late_bill_preview(bill: LateBill) -> dict:
    """One late bill as Review lists it (#1593): the repeat line, and the existing Expense it gives a bill."""
    doctype, expense = _booked_record(bill.record)
    return {
        "row_number": bill.row_number,
        "transfer_id": bill.transfer_id,
        "amount": float(bill.amount),
        "remarks": bill.remarks,
        "expense_doctype": doctype,
        "expense": expense,
        "bills": len(bill.links),
    }


def _late_bill_job(bill: LateBill) -> dict:
    """What the job needs of one late bill: plain values, because the queue stores its arguments."""
    doctype, expense = _booked_record(bill.record)
    return {"transfer_id": bill.transfer_id, "doctype": doctype, "expense": expense, "links": list(bill.links)}


# --- shared between the three phases -------------------------------------------------------------


def _read_and_parse():
    """authorize -> validate -> read the stream once -> parse. WRITES NOTHING.

    Shared by the preview and the confirm so the two can never disagree about what they accept. A
    preview accepting a file the confirm then rejects is worse than no preview, because it moves
    the failure to after the reader has committed to it.
    """
    user = require_outflow_access()

    files = getattr(frappe.request, "files", None) or {}
    if "file" not in files:
        frappe.throw("No file uploaded.", title="Missing file")

    uploaded = files["file"]
    filename = uploaded.filename or ""
    _, ext = os.path.splitext(filename)
    if ext.lower() not in _ALLOWED_EXTENSIONS:
        frappe.throw(
            "The Cashbook import takes the Cashbook Statement as downloaded, an .xlsx file. "
            f"You uploaded a '{ext or 'file with no extension'}'.",
            title="Unsupported file type",
        )

    content = uploaded.read()
    if len(content) > _MAX_FILE_BYTES:
        frappe.throw(
            f"This file is {len(content) / (1024 * 1024):.1f} MB. Maximum is "
            f"{_MAX_FILE_BYTES // (1024 * 1024)} MB.",
            title="File too large",
        )

    try:
        parsed = parse_statement(content, source=SOURCE)
    except StatementFormatError as exc:
        frappe.throw(str(exc), title="Could not read this statement")

    # ADR-0015 Amendment B decision 2: the job must still be able to fetch every bill, so a statement
    # whose earliest link is dead, or dies within the hour, is refused here -- before confirm's
    # `save_file`, so a refusal saves nothing.
    expired = expired_links_refusal(
        parsed.rows, now=_utc_now(), tz=ZoneInfo(frappe.utils.get_system_timezone())
    )
    if expired:
        frappe.throw(expired, title="Links expired")

    return user, filename, content, parsed


def _utc_now() -> datetime:
    """The upload's clock for the bill-link expiry check. One function so a test can set it."""
    return datetime.now(timezone.utc)


def _plan_claiming_reopens(parsed) -> CashbookPlan:
    """Confirm's plan, with every earlier line it re-opens locked until confirm commits (code review S6).

    The plan read the own-balances skips in one statement and `reopen_lines` writes them later; in between another
    import or a person may change one. So each is claimed here, under its row lock, before anything is saved
    (`cashbook_reopen.claim_reopens`). One that is no longer an own-balances skip is left out and the statement is
    planned again without it, so its line takes what the plan gives it without the re-open (a repeat, or a new
    line) and is never dropped. A serialization failure (the line changed after this transaction's snapshot) is
    rolled back and the plan read again, in a fresh snapshot that sees the change.
    """
    lost: set[str] = set()
    for _ in range(3):
        plan = _build_plan(parsed, not_reopening=lost)
        try:
            gone = claim_reopens(plan)
        except Exception as exc:
            if not is_concurrent_writer_refusal(exc):
                raise
            frappe.db.rollback()
            continue
        if not gone:
            return plan
        lost |= gone
    frappe.throw(
        "Another import is re-opening the same lines right now. Confirm this statement again in a moment.",
        title="Lines changed",
    )


def _build_plan(parsed, not_reopening=frozenset()) -> CashbookPlan:
    """Read the two lookup tables and decide. The ONE place the plan is computed. `not_reopening`: earlier lines
    confirm found taken meanwhile (`_plan_claiming_reopens`), planned as if they were not own-balances skips."""
    won = frappe.db.sql(
        """SELECT name, project_name FROM "tabProjects" WHERE tendering_status = %s""",
        (_WON,),
        as_dict=True,
    )
    index = build_project_index(
        [(row["name"], row.get("project_name") or "") for row in won],
        aliases=load_project_aliases(),
    )
    return plan_statement(
        parsed.rows,
        index,
        load_expense_rules(),
        already_imported=_already_imported(parsed),
        already_booked=_already_booked(parsed),
        wrong_skips=[
            skip for skip in wrong_skips(_statement_transfer_ids(parsed)) if skip.line not in not_reopening
        ],
    )


def _already_imported(parsed) -> dict:
    """Which of these transfers a previous BATCH already holds, and which batch that was.

    ⚠️ ONE IMPLEMENTATION, SHARED WITH CASHFREE (slice CB-DUP-2). This used to be a hand-written
    copy of `candidates.find_earlier_sightings_for_rows` -- same identity, same terminal-status
    clause, both reading the ONE `Outflow Import Row` table -- and the copies had already drifted:
    this one could not apply `duplicates.dates_agree`, so an unreadable `Added On` on either side
    meant a wallet statement **imported a second time, silently**. Both now go through
    `candidates.prior_import_sightings`; only the argument below differs.

    ⚠️ NO PERIOD IS PASSED, AND THAT IS THE DELIBERATE DIFFERENCE -- **do not "make it consistent"
    with the Cashfree caller.** Period narrowing is ergonomics, and its licence is that a miss
    cannot cause double payment because the `Outflow Row Match` unique constraint catches it. That
    licence does not exist here: a Cashbook row CREATES its target, so `target_name` is new every
    time and the constraint can never fire. A miss costs Cashfree a worse message and costs
    Cashbook a SECOND EXPENSE. The full reasoning is on `prior_import_sightings`.

    In-flight rows are included (#1359) so an identical REFUNDED copy is an exact repeat; they are
    never the basis of a status change (`duplicates.match_repeat`).
    """
    return prior_import_sightings(_statement_transfer_ids(parsed), in_flight=True)


def _already_booked(parsed) -> dict:
    """Which of these transfers an EXPENSE already exists for, and which record that is.

    Asked of a whole statement at preview/confirm; `booked_elsewhere` asks the SAME question of one
    line (#1314) through the same `_booked_index`, so the two can never disagree.

    ⚠️ A DIFFERENT QUESTION FROM `_already_imported`, AND THE GAP BETWEEN THEM WAS THE HOLE. That
    one asks whether an earlier BATCH staged the transfer. This asks whether the money is already
    booked AT ALL -- which it can be without this import ever having seen it. Measured 2026-08-21:
    **17 live `Non Project Expenses` carry a wallet transfer id in `payment_ref` that nobody
    imported**, keyed in by hand. Without this lookup, a statement covering those dates creates
    17 duplicate expenses and nothing anywhere says so.

    ⚠️ THE `Outflow Row Match` UNIQUE CONSTRAINT IS NOT THE BACKSTOP HERE, whatever the notes on
    the Cashfree path say. That key is `(transfer_id, target_doctype, target_name)` and a Cashbook
    row CREATES its target, so `target_name` is new every time and the constraint is never
    contended. On this path THIS function is the guard.

    IDENTITY IS `payment_ref` + amount + `payment_date`, the same three axes as a staged row's, so
    the two lookups cannot come to disagree. The import writes exactly that triple on create
    (`settle.create_expense_from_row`), which is what makes the check self-consistent on its own
    output. It holds on HAND-KEYED rows too: all 17 carry a `payment_date`, and every one of them
    equals the date encoded in the wallet id's own epoch prefix (17/17, measured).

    ⚠️ NARROWED BY REFERENCE IN SQL, NOT IN PYTHON. The `IN` list is this statement's own transfer
    ids -- at most a few hundred -- so the scan returns almost nothing instead of the 701 expenses
    that carry any reference at all. `payment_ref` is UNINDEXED on both doctypes; at 2,594 + 718
    rows the sequential scan is free. Revisit if `Non Project Expenses` passes ~100k.

    ⚠️ NO STATUS FILTER, DELIBERATELY. Measured: zero `Approved` and zero `Requested` expenses carry
    any `payment_ref`, so `status = 'Paid'` narrows nothing today -- and an unpaid expense holding
    the reference is still a booking, so creating a second one is still a duplicate. A filter that
    buys nothing now and hides a real duplicate later is not worth having.

    ⚠️ TWO QUERIES, NOT ONE, BECAUSE THE TWO DOCTYPES DISAGREE ABOUT STORAGE. `Project Expenses.amount`
    is a `Data` column holding numeric STRINGS and must be CAST; `Non Project Expenses.amount` is a
    real `Currency`. Same asymmetry `candidates.load_expense_targets` carries, and folding them into
    one parametrised query would hide it. The `btrim(amount) <> ''` guard mirrors that function's;
    verified 2026-08-21 that no `Project Expenses.amount` would break the cast.
    """
    return _booked_index(_statement_transfer_ids(parsed))


def _booked_record(label: str) -> tuple[str, str]:
    """`(doctype, name)` of a `_booked_index` label, which `_booked_index` composes as `"<doctype> <name>"`.
    Matched against the two ledger names rather than split, so a record name holding a space survives."""
    doctype = next(dt for dt in EXPENSE_DOCTYPES if label.startswith(f"{dt} "))
    return doctype, label[len(doctype) + 1 :]


def _late_bills(parsed, plan: CashbookPlan) -> tuple[LateBill, ...]:
    """The repeat lines whose bills go to an existing Expense still waiting for one (#1593). READ-ONLY.

    Every Expense carrying one of the statement's Txn Ids, through `_booked_index` (the "already booked" check's
    own identity), and of those the ones still waiting: no `invoice_attachment` and no No invoice mark. The job
    asks the waiting question again under the Expense's lock (`cashbook_bills._attach_invoice`).
    """
    ids = sorted({raw.transfer_id for raw in plan.split.earlier_exact if raw.transfer_id and raw.bill_links})
    if not ids:
        return ()
    placeholders = ", ".join(["%s"] * len(ids))
    waiting = set()
    for doctype in EXPENSE_DOCTYPES:
        waiting.update(
            f"{doctype} {name}"
            for name in frappe.db.sql(
                f"""
                SELECT name FROM "tab{doctype}"
                WHERE BTRIM(COALESCE(payment_ref, '')) IN ({placeholders})
                  AND COALESCE(invoice_attachment, '') = '' AND COALESCE(no_invoice_by, '') = ''
                """,
                tuple(ids),
                pluck=True,
            )
        )
    return late_bills(plan.split, _booked_index(ids), waiting)


def _booked_index(ids) -> dict:
    """The `index_prior_sightings` index of every expense whose `payment_ref` is one of `ids`. See
    `_already_booked` for every rule the query follows."""
    if not ids:
        return {}
    placeholders = ", ".join(["%s"] * len(ids))

    entries: list[tuple] = []
    for doctype in EXPENSE_DOCTYPES:
        # ⚠️ `ORDER BY creation ASC` for the same reason `_already_imported` needs it: the message
        # names the FIRST agreeing sighting, and the first booking is the one worth naming.
        # Both ledgers store `amount` as Currency since 16 Sep 2026, so one expression serves
        # both. The loop stays because they are still two tables with two name sets.
        rows = frappe.db.sql(
            f"""
            SELECT name, BTRIM(payment_ref) AS payment_ref,
                   amount, payment_date
            FROM "tab{doctype}"
            WHERE BTRIM(COALESCE(payment_ref, '')) IN ({placeholders})
            ORDER BY creation ASC
            """,
            tuple(ids),
            as_dict=True,
        )
        entries.extend(
            (
                row["payment_ref"],
                normalize_amount(row["amount"]),
                row["payment_date"],
                # The label the skip message prints. Composed HERE because this is the layer that
                # knows which ledger it just queried; `find_prior_sighting` returns one opaque
                # string and must not be asked to carry structure.
                f"{doctype} {row['name']}",
            )
            for row in rows
        )
    return index_prior_sightings(entries)


def booked_elsewhere(row: str) -> str | None:
    """Where this Cashbook line's money is already booked, as the label the skip sentence names -- or
    `None`. The unskip re-check for a Cashbook line (#1314, owner Q5; trap 3).

    ⚠️ NOT THE MATCHER. `review.match_line` refuses Cashbook by design (#1272) and must keep doing so,
    so a Cashbook unskip asks the question the Cashbook import itself asks before it creates anything:

      1. an expense carrying this wallet transaction id -- `_already_booked`'s identity, `payment_ref` +
         amount + `payment_date`, through the one `_booked_index`;
      2. a live (Settled) leg on ANOTHER import line for the same transaction id. It catches money that
         was booked through this feature on a record whose reference was since changed by hand, which
         (1) cannot see. This line's own legs are excluded -- it has none while Skipped, but the
         exclusion keeps the answer honest if that ever changes.
    """
    line = frappe.db.get_value(
        ROW_DOCTYPE, row, ["name", "transfer_id", "amount", "added_on"], as_dict=True
    )
    transfer_id = (line.transfer_id or "").strip()
    if not transfer_id:
        return None
    staged = StagedRow(line)
    label = find_prior_sighting(
        _booked_index([transfer_id]), transfer_id, staged.amount, staged.added_on_date
    )
    if label:
        return label
    leg = frappe.db.get_value(
        MATCH_DOCTYPE,
        {"transfer_id": transfer_id, "match_kind": MATCH_SETTLED, "import_row": ["!=", line.name]},
        ["target_doctype", "target_name"],
        as_dict=True,
        order_by="matched_at asc",
    )
    return f"{leg.target_doctype} {leg.target_name}" if leg else None


def _assess(parsed, plan: CashbookPlan, filename: str, late: tuple = (), fills: tuple = ()) -> DuplicateVerdict:
    """Refuse / warn / proceed, counted from THE plan `_stage` writes from (ADR-0031). READ-ONLY.

    The same `duplicates.assess_duplicates` the Cashfree path asks, so both sources refuse a file of
    nothing but exact repeats and warn at the same 90%. Shared by the preview and the confirm, so
    what the preview promised is what the confirm enforces. A repeat bringing a late bill (`late`, #1593) is work,
    and so is one giving a ₹0 Internal Transfer record its money (`fills`, owner decision 2, #1619): a file of
    nothing but repeats is accepted when some of them bring either.
    """
    return assess_duplicates(
        total=len(parsed.rows),
        duplicates=plan.split.repeats_not_saved,
        earliest_batch=plan.split.repeat_of_batch,
        filename=filename,
        repeated_in_file=plan.split.repeated_in_file,
        earlier_batches=plan.split.repeats_by_batch,
        repeats_with_work=len(late) + len(fills),
    )


def _statement_transfer_ids(parsed) -> list[str]:
    """The distinct, non-blank transfer ids in this statement -- the narrowing both lookups use.

    ⚠️ AN EMPTY LIST MUST SHORT-CIRCUIT AT THE CALLER, not build `IN ()` -- which is a syntax error
    in Postgres, not an empty result.
    """
    return sorted({row.transfer_id for row in parsed.rows if row.transfer_id})


def _stage(parsed, plan: CashbookPlan, file_url: str, filename: str, user: str, late_bill_jobs: list[dict] = ()):
    """Create the batch and one row per PLANNED transfer, carrying the plan's decision.

    ⚠️ AN EXACT REPEAT IS NOT STAGED (ADR-0031). `plan_statement` leaves it out of `plan.rows` and
    counts it; the batch keeps only `repeats_not_saved`, the one trace such a line leaves. Every other
    parsed line is staged -- a status-changed repeat included, skipped with both statuses named.

    ⚠️ THE MONEY TOTALS ARE THE STORED LINES', NOT THE FILE'S -- `parser.stored_money`, the one
    helper every import's money goes through. A file with no repeats gives exactly the figures it
    gave before.
    """
    all_kept = [line.row for line in plan.split.kept]
    # A line that re-opens an earlier one (#1596) is stored in that line's import, so its money is too.
    stored = [raw for raw, planned in zip(all_kept, plan.rows, strict=True) if not planned.reopens]
    gross, charges = stored_money(stored)

    batch = frappe.new_doc(BATCH_DOCTYPE)
    batch.update(
        {
            "source": SOURCE,
            "source_file": file_url,
            "original_filename": filename,
            "period_from": parsed.period_from,
            "period_to": parsed.period_to,
            "gross_amount": float(gross),
            "charges_amount": float(charges),
            # Written ONCE, here, and never recomputed: the rows it counts do not exist (ADR-0031).
            "repeats_not_saved": plan.split.repeats_not_saved,
            "uploaded_by": user,
            "uploaded_at": frappe.utils.now_datetime(),
            "status": "Draft",
        }
    )
    batch.insert(ignore_permissions=True)

    # The Collect payment lines whose bills this import's job copies (#1595): its own, and the earlier ones it
    # re-opens (#1596), which stay in their own import but are this import's work (code review R1).
    collect_lines: list[str] = []
    # `plan.rows` and `plan.split.kept` are the same lines in the same order -- see `CashbookPlan`.
    for raw, planned in zip(all_kept, plan.rows, strict=True):
        if planned.reopens:
            if _copies_a_collect_bill(raw, planned):
                collect_lines.append(planned.reopens.line)
            continue
        doc = frappe.new_doc(ROW_DOCTYPE)
        doc.update({"import_batch": batch.name, **line_values(raw, planned)})
        doc.insert(ignore_permissions=True)
        # #1623: one of Cashbook's own moves gets its Internal Transfer record, with the money it moved (a top-up
        # carries it in its Credit, so the line's own `amount` may be 0). Only a line that says SUCCESS is one (owner
        # decision 3, #1619), so each Internal Transfer line holds exactly one record.
        if planned.move:
            internal_transfer_records.record_cashbook_move(doc, planned.move)
        if _copies_a_collect_bill(raw, planned):
            collect_lines.append(doc.name)

    # #1596: each line that re-opens an earlier own-balances skip is written onto THAT line, never staged anew.
    reopen_lines(plan, all_kept, batch.name, user)
    # Code review S1, S2: the bill copies outside the job's own Pending lines, kept so Resume can finish them.
    # Not committed: confirm commits once, holding the re-open claims to the end.
    save_bill_work(batch.name, new_bill_work(list(late_bill_jobs), collect_lines), commit=False)
    return batch


def _copies_a_collect_bill(raw, planned) -> bool:
    """Whether the job copies this line's bills onto it: an open Collect payment with bill links (#1595)."""
    return planned.opens and planned.row_kind == COLLECT_ROW_KIND and bool(raw.bill_links)
