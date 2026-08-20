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
    confirm  `confirm_cashbook_import`      save the file, stage, enqueue.    batch + rows only
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
rows still pending -- and re-running it picks up exactly where it stopped, because
`Outflow Row Match`'s unique constraint refuses a second settlement of the same transfer.

⚠️ THE STATEMENT IS NOT ATTACHED PER ROW (owner ruling). `_link_statement_file_to_target` is
deliberately NOT called here: the expense's `payment_attachment` carries the statement's URL, but no
second `File` row is created for it. The consequence was measured and accepted -- Frappe authorises
a private file through the document it is attached to, and the statement stays attached to the
batch, which 3 roles can read while 19 can read the expenses. So the attachment opens for
accountants and administrators and returns 403 for everyone else. Reversing it is one call.
"""

import os

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    MATCH_DOCTYPE,
    _refresh_batch_rollup,
    _statement_file_url,
)
from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.api.outflow_import.review import _StagedRow
from nirmaan_stack.services.outflow_import.candidates import (
    load_expense_rules,
    load_project_aliases,
)
from nirmaan_stack.services.outflow_import.cashbook import (
    ACTION_CREATE,
    CashbookPlan,
    group_plan,
    plan_statement,
)
from nirmaan_stack.services.outflow_import.duplicates import row_identity
from nirmaan_stack.services.outflow_import.ledgers import PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.outflow_import.parser import (
    BANK_TERMINAL_STATUSES,
    StatementFormatError,
    parse_statement,
)
from nirmaan_stack.services.outflow_import.project_match import build_project_index
from nirmaan_stack.services.outflow_import.settle import create_expense_from_row
from nirmaan_stack.services.outflow_import.status import (
    ROW_ERROR,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
)

BATCH_DOCTYPE = "Outflow Import Batch"
ROW_DOCTYPE = "Outflow Import Row"
SOURCE = "Cashbook"

# The tier this source matches on, in `Outflow Row Match.match_basis`'s own vocabulary. NOT
# "Manual" -- no person chose these -- and not "project in remark", which belongs to the settlement
# matcher's tier 2 and would make a created expense look like a settled one in every report.
MATCH_BASIS = "cashbook remark"

_ALLOWED_EXTENSIONS = frozenset({".csv", ".xlsx"})
_MAX_FILE_BYTES = 5 * 1024 * 1024

# Only Won projects are offered. A petty-cash spend is booked against live work; a tendering or
# lost project cannot be receiving materials.
_WON = "Won"


@frappe.whitelist(methods=["POST"])
def preview_cashbook_statement():
    """Parse a wallet statement and report exactly what confirming it would create. WRITES NOTHING.

    Multipart form: `file` (.csv or .xlsx).
    URL: /api/method/nirmaan_stack.api.outflow_import.cashbook.preview_cashbook_statement

    The browser re-posts the same file on confirm, as the Cashfree preview already does and for the
    same reason: holding a parse between two requests would mean session state, an expiry, and a
    way for confirm to act on a file that is no longer the one on screen.
    """
    _, filename, _, parsed = _read_and_parse()
    plan = _build_plan(parsed)
    return _preview_payload(parsed, plan, filename)


@frappe.whitelist(methods=["POST"])
def confirm_cashbook_import():
    """Stage the statement and start writing. Returns the batch to watch.

    Multipart form: `file` (.csv or .xlsx).
    URL: /api/method/nirmaan_stack.api.outflow_import.cashbook.confirm_cashbook_import

    ⚠️ IT RE-PLANS FROM THE RE-POSTED FILE rather than trusting anything the browser computed. The
    preview is a rendering of the server's decision, never an input to it -- a client that could
    submit its own placement could book a spend to any project it liked.
    """
    user, filename, content, parsed = _read_and_parse()
    plan = _build_plan(parsed)

    from frappe.utils.file_manager import save_file

    # Saved BEFORE the batch because `save_file` is not rollback-able -- the cloud attachment hook
    # commits inside this request -- and the URL is read off the returned doc because that same
    # hook rewrites it during insert.
    saved = save_file(fname=filename, content=content, dt=None, dn=None, is_private=1)

    batch = _stage(parsed, plan, file_url=saved.file_url, filename=filename, user=user)
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

    frappe.enqueue(
        "nirmaan_stack.api.outflow_import.cashbook._cashbook_worker",
        queue="long",
        timeout=3600,
        batch=batch.name,
        actor=user,
        job_id=f"cashbook-import-{batch.name}",
        deduplicate=True,
    )
    return {"batch": batch.name, "creating": len(plan.creating), "skipping": len(plan.skipping)}


@frappe.whitelist()
def get_cashbook_status(batch: str):
    """How far the job has got. Counted from the ROWS, which are the durable record.

    ⚠️ NO REDIS MARKER, deliberately. The rows already carry the answer, they survive a worker
    restart, and a marker would be a second account of the same fact -- free to disagree with the
    table the screen reads next. Progress is simply how many rows have stopped being pending.
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
    return {
        "batch": batch,
        "created": counts.get(ROW_SETTLED, 0),
        "failed": counts.get(ROW_ERROR, 0),
        "skipped": counts.get(ROW_SKIPPED, 0),
        "pending": pending,
        "running": pending > 0,
        "batch_status": frappe.db.get_value(BATCH_DOCTYPE, batch, "status"),
    }


def _cashbook_worker(batch: str, actor: str):
    """Create one expense per planned row. ONE TRANSACTION PER ROW.

    ⚠️ COMMIT PER ROW, NOT PER BATCH, and that is what makes a partial run safe. A worker killed at
    row 60 leaves 59 durable expenses and the rest still pending; re-running processes only what is
    still pending, and `Outflow Row Match`'s unique constraint on
    (transfer_id, target_doctype, target_name) refuses a second settlement even if it did not.

    ⚠️ A FAILING ROW MARKS ITSELF AND THE RUN CONTINUES. One unresolvable row must not strand the
    other hundred -- the reviewer has already approved the whole batch, and stopping would leave
    them with no way to tell which rows went through.
    """
    statement_file_url = _statement_file_url(batch)
    rows = frappe.db.sql(
        """
        SELECT name FROM "tabOutflow Import Row"
        WHERE import_batch = %s AND row_status = %s AND suggested_doctype IS NOT NULL
        ORDER BY name
        """,
        (batch, ROW_PENDING_MATCH),
        as_dict=True,
    )

    for entry in rows:
        try:
            _write_one(entry["name"], batch, actor, statement_file_url)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            frappe.log_error(
                title="Cashbook import: could not create an expense",
                message=f"{batch} / {entry['name']}\n\n{frappe.get_traceback()}",
            )
            frappe.db.set_value(
                ROW_DOCTYPE,
                entry["name"],
                {"row_status": ROW_ERROR, "outcome_note": "Could not create this expense."},
                update_modified=False,
            )
            frappe.db.commit()

    _refresh_batch_rollup(batch)
    frappe.db.commit()


def _write_one(row_name: str, batch: str, actor: str, statement_file_url: str | None):
    """One row -> one expense -> one match record -> the row flips to Settled."""
    doc = frappe.db.get_value(ROW_DOCTYPE, row_name, "*", as_dict=True)

    # ⚠️ THE ADAPTER, NOT A RAW `frappe.get_doc`. `create_expense_from_row` reads its argument BY
    # ATTRIBUTE, and two of the attributes it wants are DERIVED rather than stored: `added_on_date`
    # (from the `added_on` datetime) and a `Decimal` amount. `_StagedRow` computes both; a
    # `Document` has neither, and `getattr(doc, "added_on_date", None)` returns None in silence.
    #
    # It cost 115 expenses with a BLANK `payment_date` on the first production import -- every
    # figure else correct, nothing raised, and no test could see it because the fixtures asserted
    # the fields the writer sets rather than the ones it derives. Found by reading the records back
    # out of the database after a real run. `expenses.create_expense` has always used this adapter;
    # this path simply did not, which is the whole of the defect.
    staged = _StagedRow(doc)
    result = create_expense_from_row(
        staged,
        doctype=doc["suggested_doctype"],
        expense_type=doc["suggested_expense_type"],
        actor=actor,
        project=doc.get("resolved_project"),
        # Description is left to `settle._default_description`, which composes the payee with the
        # remark. Deciding it here would be a second definition of the same sentence.
        description=None,
        comment=f"Imported from {batch}",
        statement_file_url=statement_file_url,
        # ⚠️ WHO SPENT IT, from the statement's own `From` column -- not the accountant importing it.
        payment_by=(doc.get("added_by_raw") or "").strip() or None,
        # ⚠️ THE WALLET'S TRANSACTION ID, because there is no UTR. It is the only value that will
        # find this spend again in the wallet's own records.
        payment_ref=(doc.get("transfer_id") or "").strip() or None,
    )

    match = frappe.new_doc(MATCH_DOCTYPE)
    match.update(
        {
            "import_row": row_name,
            "import_batch": batch,
            "transfer_id": doc["transfer_id"],
            "target_doctype": result.doctype,
            "target_name": result.name,
            "target_amount": float(result.amount),
            "match_kind": "Settled",
            "match_basis": MATCH_BASIS,
            "settlement_origin": "Suggestion accepted",
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
            f"We support .csv and .xlsx statements. "
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

    return user, filename, content, parsed


def _build_plan(parsed) -> CashbookPlan:
    """Read the two lookup tables and decide. The ONE place the plan is computed."""
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
        parsed.rows, index, load_expense_rules(), already_imported=_already_imported(parsed)
    )


def _already_imported(parsed) -> dict:
    """Which of these transfers a previous batch already holds, and which batch that was.

    Keyed on `duplicates.row_identity`, the same key the parser's in-file check and the Cashfree
    staging path use -- so all three can never call one pair of rows duplicates while another calls
    them distinct, about the same file.

    ⚠️ ONLY A **TERMINAL** STORED ROW COUNTS, AND THIS IS A SECOND COPY OF THE CASHFREE CLAUSE.
    A spend that had not gone through when the last statement was exported stages here and settles
    nothing; when the next export carries it completed, the triple matches and it was skipped as
    "already imported" -- money silently lost, permanently, because `Skipped` is frozen against
    re-matching. Both sources write to the ONE `Outflow Import Row` table, so fixing only the
    Cashfree lookup would leave the identical defect live for wallet statements.

    TERMINAL, not successful: a spend that definitively failed is final too, and must keep counting
    as a duplicate or a re-uploaded statement stops reading as fully imported. See the longer note
    on `candidates.find_earlier_batches_for_rows`, which explains what that costs.

    The vocabulary is bound, never spelled -- `parser.BANK_TERMINAL_STATUSES` -- and `UPPER(BTRIM(...))`
    mirrors `parser.is_terminal_status` exactly, so this and `candidates.find_earlier_batches_for_rows`
    cannot come to disagree about the same stored cell.

    ⚠️ THIS IS THE SECOND COPY OF ONE QUESTION, AND IT IS KNOWN. `candidates.find_earlier_batches_for_rows`
    asks the same thing, but it also narrows by period and applies `dates_agree`'s missing-date
    fallback, neither of which this does -- so collapsing the two is a BEHAVIOUR change for Cashbook
    and belongs in its own slice, not smuggled into a defect fix. Until then, a change to either
    must be made to both.
    """
    ids = [row.transfer_id for row in parsed.rows if row.transfer_id]
    if not ids:
        return {}
    placeholders = ", ".join(["%s"] * len(ids))
    terminal = sorted(BANK_TERMINAL_STATUSES)
    terminal_placeholders = ", ".join(["%s"] * len(terminal))
    rows = frappe.db.sql(
        f"""
        SELECT transfer_id, amount, added_on, import_batch
        FROM "tabOutflow Import Row"
        WHERE transfer_id IN ({placeholders})
          AND UPPER(BTRIM(COALESCE(status_raw, ''))) IN ({terminal_placeholders})
        """,
        (*ids, *terminal),
        as_dict=True,
    )
    found = {}
    for row in rows:
        added_on = row["added_on"]
        identity = row_identity(
            row["transfer_id"], row["amount"], added_on.date() if added_on else None
        )
        found.setdefault(identity, row["import_batch"])
    return found


def _stage(parsed, plan: CashbookPlan, file_url: str, filename: str, user: str):
    """Create the batch and one row per parsed transfer, carrying the plan's decision."""
    batch = frappe.new_doc(BATCH_DOCTYPE)
    batch.update(
        {
            "source": SOURCE,
            "source_file": file_url,
            "original_filename": filename,
            "period_from": parsed.period_from,
            "period_to": parsed.period_to,
            "gross_amount": float(parsed.gross_amount),
            "charges_amount": float(parsed.charges_amount),
            "uploaded_by": user,
            "uploaded_at": frappe.utils.now_datetime(),
            "status": "Draft",
        }
    )
    batch.insert(ignore_permissions=True)

    by_row = {row.row_number: row for row in plan.rows}
    for raw in parsed.rows:
        planned = by_row.get(raw.row_number)
        creating = planned is not None and planned.action == ACTION_CREATE
        doc = frappe.new_doc(ROW_DOCTYPE)
        doc.update(
            {
                "import_batch": batch.name,
                "source": SOURCE,
                "transfer_id": raw.transfer_id,
                "added_on": raw.added_on,
                "amount": float(raw.amount),
                "status_raw": raw.status_raw,
                "beneficiary_name": raw.beneficiary_name,
                "remarks": raw.remarks,
                "added_by_raw": raw.added_by_raw,
                "row_status": ROW_PENDING_MATCH if creating else ROW_SKIPPED,
                "skip_reason": None if creating else planned.reason,
                "suggested_doctype": planned.ledger if creating else None,
                "suggested_expense_type": planned.expense_type if creating else None,
                "resolved_project": (
                    planned.project
                    if creating and planned.ledger == PROJECT_EXPENSE_DOCTYPE
                    else None
                ),
                "match_basis": MATCH_BASIS if creating else None,
                "auto_matched": 1 if creating else 0,
            }
        )
        doc.insert(ignore_permissions=True)

    return batch


def _preview_payload(parsed, plan: CashbookPlan, filename: str) -> dict:
    groups = group_plan(plan)
    return {
        "preview": True,
        "source": SOURCE,
        "original_filename": filename,
        "period_from": str(parsed.period_from) if parsed.period_from else None,
        "period_to": str(parsed.period_to) if parsed.period_to else None,
        "total_rows": len(parsed.rows),
        "creating": len(plan.creating),
        "skipping": len(plan.skipping),
        "total_value": float(plan.total_value),
        "warnings": list(parsed.warnings),
        "groups": [
            {
                "ledger": group.ledger,
                "key": group.key,
                "label": group.label,
                "count": group.count,
                "value": float(group.value),
                "rows": [
                    {
                        "row_number": row.row_number,
                        "transfer_id": row.transfer_id,
                        "amount": float(row.amount),
                        "remarks": row.remarks,
                        "beneficiary_name": row.beneficiary_name,
                        "spent_by": row.spent_by,
                        "expense_type": row.expense_type,
                        "matched_keyword": row.matched_keyword,
                        "is_fallback_type": row.is_fallback_type,
                    }
                    for row in group.rows
                ],
            }
            for group in groups
        ],
        "skipped": [
            {
                "row_number": row.row_number,
                "transfer_id": row.transfer_id,
                "amount": float(row.amount),
                "remarks": row.remarks,
                "reason": row.reason,
            }
            for row in plan.skipping
        ],
    }
