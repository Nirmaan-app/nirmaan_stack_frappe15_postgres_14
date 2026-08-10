# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Settle a bank row (Bulk Import Outflow, slices S5 + V2).

Thin orchestrator (ADR-0010 B4): authorize -> load -> call the service -> record -> commit. The
settlement RULES live in `services/outflow_import/settle.py`; this module owns the import-side
bookkeeping around them.

THE ONLY ENDPOINTS IN THIS FEATURE THAT MUTATE ANYTHING OUTSIDE THE IMPORT'S OWN DOCTYPES.

⚠️ v3: `settle_row` DISPATCHES ACROSS ALL THREE LEDGERS. The line that stood here said neither
endpoint could reach a payment, "because `settle.py` has no code path to one" -- true under v2's
spine and reversed by the owner on 2026-08-06. `settle.py` now has exactly that path. What still
holds is narrower and is where the safety lives: this import writes the LAST rung of a ladder
somebody else already climbed. It never approves, it never creates a payment, and nothing settles
without a per-row human confirmation.

ONE TRANSACTION, ONE SAVEPOINT, ONE COMMIT. A settlement is: write the record, record the
`Outflow Row Match` (which is also the idempotency constraint), flip the import row to `Settled`,
refresh the batch rollup. Those four are one fact and must not half-happen -- a match record
without its expense would claim a settlement that never occurred, and an expense without its match
record could be settled a second time by the next statement.

WHY THE CEO-HOLD RECOMPUTE IS DELIBERATELY *NOT* SUPPRESSED HERE. `hooks.py` fires
`project_cashflow_hold_update.on_project_expense` on Project Expenses insert/update, and
`frappe.flags.in_import` would switch it off wholesale. The BoQ-style bulk loaders set that flag
because they write hundreds of rows and recompute once at the end. Settlement is one expense per
reviewer action, and the cashflow gap SHOULD move when a Paid expense appears -- suppressing it
would leave a project's CEO-Hold state stale for no gain. If a settle-everything action ever ships,
that is when the wholesale flag becomes right: suppress per row, recompute once.

⚠️ THAT PARAGRAPH DESCRIBED AN INTENT THE SETTLE PATH DID NOT ACTUALLY HAVE UNTIL X1, and the
correction is worth reading before trusting any hook claim in this module. It was true of
`create_expense`, which inserts a document. It was NOT true of `settle_expense`, which wrote with
`frappe.db.set_value` -- a write that skips the document lifecycle, so that hook never fired and a
settled expense never moved the cashflow gap at all. X1 moved the expense write onto `doc.save()`
(it had to, to audit the amount rewrite), which is what finally makes the intent above real.

⚠️ AND IT WOKE A THIRD COMMITTER, WHICH IS SUPPRESSED -- NARROWLY. The cashflow module can reach a
`frappe.db.commit()` in ONE branch: notifying the holder of a manual CEO Hold that has become
releasable. A commit there would break the savepoint below exactly as the other two would.
`services/outflow_import/settle.py` sets `frappe.flags.outflow_import_settling` around its saves
and that branch bails on it. The RECOMPUTE still runs; only the notify, its commit and its realtime
publish are skipped. Note this hook is wired to `Project Payments` too, so the payment path had
been exposed to that same commit since V2 -- a hole X1 closes rather than opens.

WHY THE PAYMENT HOOKS *ARE* SUPPRESSED, which reads like the opposite decision and is not. Read
side by side: the CEO-Hold recompute above holds NO commit, so leaving it on costs nothing. The two
payment hooks -- `update_parent_amount_paid` and the Approved->Paid notification cascade -- each
call `frappe.db.commit()` mid-save, and a commit inside the savepoint below makes the rollback a
silent no-op. The test is not "is this side effect wanted" but "does it commit"; where the answer
is yes, it has to move outside the savepoint or be suppressed. `amount_paid` is still recomputed,
inside the same transaction, exactly once. Only the commit and the notifications go.
"""

import frappe

from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.api.outflow_import.review import (
    BATCH_DOCTYPE,
    MATCH_DOCTYPE,
    ROW_DOCTYPE,
    _StagedRow,
    _refresh_batch_rollup,
)
from nirmaan_stack.services.outflow_import.ledgers import PAYMENT_DOCTYPE
from nirmaan_stack.services.outflow_import.settle import (
    NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE,
    create_expense_from_row,
    settle_existing_expense,
    settle_payment,
)
from nirmaan_stack.services.outflow_import.status import ROW_SETTLED, ROW_SKIPPED


@frappe.whitelist(methods=["POST"])
def settle_row(row: str, target_doctype: str, target_name: str):
    """Settle a bank row against an approved record in ANY of the three ledgers (slice V2).

    URL: /api/method/nirmaan_stack.api.outflow_import.expenses.settle_row

    ⚠️ ONE ENDPOINT FOR ALL THREE LEDGERS, ON PURPOSE. The access gate, the savepoint, the match
    record and the row flip are identical whatever was settled, and only the ledger-specific write
    differs. Three endpoints would mean three places to keep those four things in step, and the one
    that drifts is the one nobody re-reads.

    ⚠️ ONE ROW PER CALL, AND THE ISOLATION IS WHAT MAKES BULK SAFE. "Confirm 8" is eight calls, each
    its own savepoint and its own commit. A failure on the third leaves the first two written, the
    third untouched, and the rest still attemptable -- which is the honest shape for a screen whose
    rows were each decided separately. It is NOT all-or-nothing, and it must not become so: one
    unsettleable row would then discard seven good decisions.
    """
    actor = require_outflow_access()
    staged, doc = _load_settleable_row(row)
    statement_file_url = _statement_file_url(doc["import_batch"])

    savepoint = f"ofi_settle_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        if target_doctype == PAYMENT_DOCTYPE:
            result = settle_payment(
                staged, target_name, actor, statement_file_url=statement_file_url
            )
        else:
            result = settle_existing_expense(
                staged,
                target_doctype,
                target_name,
                actor,
                statement_file_url=statement_file_url,
            )
        _record_settlement(staged, doc, result, actor)
    except Exception:
        # Roll back to the savepoint rather than the whole request: the caller gets the real error
        # and the database is exactly as it was before this row was attempted.
        #
        # ⚠️ THIS ONLY WORKS BECAUSE NOTHING INSIDE COMMITS. A payment save fires two hooks that
        # each committed mid-save until V2 -- `update_parent_amount_paid` and the notification
        # cascade -- and a commit here would make the rollback silently a no-op, leaving a
        # half-written settlement behind. Both are suppressed via `doc.flags.from_outflow_import`;
        # see the comments at the two hook sites.
        frappe.db.rollback(save_point=savepoint)
        raise
    frappe.db.release_savepoint(savepoint)

    statuses = _refresh_batch_rollup(doc["import_batch"])
    frappe.db.commit()
    _link_statement_file_to_target(statement_file_url, result)
    return _summary(row, result, doc["import_batch"], statuses)


@frappe.whitelist(methods=["POST"])
def settle_expense(row: str, target_doctype: str, target_name: str):
    """Deprecated alias for `settle_row`, kept so an in-flight client keeps working.

    Removed at V5 once the new screen ships. It cannot settle a payment -- a caller reaching this
    name predates the payment path existing, and silently widening what it can write is exactly the
    surprise this feature must not produce.
    """
    if target_doctype == PAYMENT_DOCTYPE:
        frappe.throw(
            "Use settle_row to settle a payment.",
            frappe.ValidationError,
            title="Wrong endpoint",
        )
    return settle_row(row, target_doctype, target_name)


@frappe.whitelist(methods=["POST"])
def create_expense(
    row: str,
    doctype: str,
    expense_type: str,
    project: str = None,
    description: str = None,
    vendor: str = None,
    comment: str = None,
):
    """Record a NEW expense, already Paid, for a bank row that matched nothing.

    URL: /api/method/nirmaan_stack.api.outflow_import.expenses.create_expense
    """
    actor = require_outflow_access()
    staged, doc = _load_settleable_row(row)
    statement_file_url = _statement_file_url(doc["import_batch"])

    savepoint = f"ofi_create_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        result = create_expense_from_row(
            staged,
            doctype=doctype,
            expense_type=expense_type,
            actor=actor,
            project=project,
            description=description,
            vendor=vendor,
            # Visible provenance on the expense itself. The Outflow Row Match record is the durable
            # link, but nobody opening an expense form sees that -- this line is what tells them.
            comment=comment or f"Imported from {doc['import_batch']}",
            statement_file_url=statement_file_url,
        )
        _record_settlement(staged, doc, result, actor)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    frappe.db.release_savepoint(savepoint)

    statuses = _refresh_batch_rollup(doc["import_batch"])
    frappe.db.commit()
    _link_statement_file_to_target(statement_file_url, result)
    return _summary(row, result, doc["import_batch"], statuses)


@frappe.whitelist()
def get_expense_types(doctype: str):
    """Expense types valid for one expense kind, so the create form cannot offer a wrong one."""
    require_outflow_access()
    if doctype not in (PROJECT_EXPENSE, NON_PROJECT_EXPENSE):
        frappe.throw(f"'{doctype}' is not an expense doctype.", title="Not an expense")
    field = "project" if doctype == PROJECT_EXPENSE else "non_project"
    return frappe.db.sql(
        f"""SELECT name FROM "tabExpense Type" WHERE {field} = 1 ORDER BY name""",
        as_dict=True,
    )


# --- helpers -----------------------------------------------------------------------------------


def _statement_file_url(batch: str) -> str | None:
    """The uploaded statement's file URL, for the settled record's `payment_attachment`.

    One cheap read per settlement rather than one per import held in memory: "Confirm 40" is 40
    calls to `settle_row`, each its own request, so there is no batch-level place to cache it.
    """
    return frappe.db.get_value(BATCH_DOCTYPE, batch, "source_file") or None


def _link_statement_file_to_target(statement_file_url: str | None, result) -> None:
    """Give the settled record its own `File` row for the statement, so the link actually opens.

    ⚠️ COPYING A URL COPIES A LINK, NOT A PERMISSION. The statement is uploaded `is_private=1` and
    attached to the `Outflow Import Batch`; Frappe authorises a private file through the document it
    is attached to. Without a second `File` row pointing at the same URL from the payment or expense,
    somebody who may read that record but not the import batch clicks the attachment we just set and
    gets a 403 -- an attachment that is visibly there and refuses to open.

    ⚠️ AFTER THE COMMIT, ON PURPOSE, AND NOT INSIDE THE CALLER'S SAVEPOINT. A `File` insert fires the
    `frappe_gcp_attachment` `after_insert` hook, which uploads and calls `frappe.db.commit()` inside
    this request. A commit within the savepoint would make the per-row rollback a silent no-op --
    the exact hazard `api/outflow_import/upload.py` documents at length -- so this runs once the
    settlement is already durable and there is no longer a savepoint to corrupt.

    ⚠️ IT MUST NEVER RAISE. The money is written and the row is `Settled` by the time we get here;
    failing the request now would report a settlement that actually succeeded as an error, and the
    caller would retry it against a record that is already Paid. A missing `File` row degrades to
    "the attachment may 403", which is the smaller failure by a wide margin.
    """
    if not statement_file_url:
        return
    try:
        exists = frappe.db.exists(
            "File",
            {
                "file_url": statement_file_url,
                "attached_to_doctype": result.doctype,
                "attached_to_name": result.name,
            },
        )
        if exists:
            return
        frappe.get_doc(
            {
                "doctype": "File",
                "file_url": statement_file_url,
                "file_name": statement_file_url.rsplit("/", 1)[-1],
                "attached_to_doctype": result.doctype,
                "attached_to_name": result.name,
                "attached_to_field": "payment_attachment",
                "is_private": 1,
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
    except Exception:
        frappe.log_error(
            title="Outflow import: could not link statement file",
            message=f"{result.doctype} {result.name} -> {statement_file_url}\n\n"
            + frappe.get_traceback(),
        )


def _load_settleable_row(row: str):
    doc = frappe.db.get_value(ROW_DOCTYPE, row, "*", as_dict=True)
    if not doc:
        frappe.throw(f"Import row '{row}' not found.", title="Not found")
    if doc.get("row_status") == ROW_SETTLED:
        frappe.throw(
            "This row has already settled an expense.", title="Already settled"
        )
    if doc.get("row_status") == ROW_SKIPPED:
        frappe.throw(
            "This row was skipped. Re-run the match to reconsider it.", title="Row skipped"
        )
    return _StagedRow(doc), doc


def _record_settlement(staged, doc, result, actor) -> None:
    """The import-side half: the match record, then the row's own status.

    The match record carries the (transfer_id, target) unique constraint, so it is what stops the
    same transfer settling the same expense twice -- from a re-upload, an overlapping export, or a
    double-clicked button. It is written BEFORE the row flips so a constraint violation aborts the
    settlement rather than leaving a Settled row with nothing behind it.
    """
    match = frappe.new_doc(MATCH_DOCTYPE)
    match.update(
        {
            "import_row": staged.name,
            "import_batch": doc["import_batch"],
            "transfer_id": staged.transfer_id,
            "target_doctype": result.doctype,
            "target_name": result.name,
            "target_amount": float(result.amount),
            "match_kind": "Settled",
            "match_basis": "Manual",
            "matched_at": frappe.utils.now_datetime(),
            "matched_by": actor,
        }
    )
    match.insert(ignore_permissions=True)

    frappe.db.set_value(
        ROW_DOCTYPE,
        staged.name,
        {
            "row_status": ROW_SETTLED,
            "outcome_note": _settled_note(result),
            "decided_at": frappe.utils.now_datetime(),
            "decided_by": actor,
        },
        update_modified=False,
    )


def _settled_note(result) -> str:
    """The sentence a reviewer reads on a settled row.

    ⚠️ IT NAMES AN AMOUNT CORRECTION WHEN THERE WAS ONE (X1). The rewrite edits an approved figure,
    and the note is the only place that fact survives on the import's own screen -- the Version log
    holds it durably, but nobody opens a Version log to answer "why is this payment 31 paise
    different from what I approved". Silent by design when nothing changed: a note that said
    "amount unchanged" on every ordinary row would train people to stop reading it.
    """
    verb = "Recorded" if result.created else "Settled"
    note = f"{verb} {result.doctype} {result.name}."
    if result.amount_changed:
        note += (
            f" Amount corrected from {result.original_amount} to {result.amount} "
            f"to match the transfer."
        )
    return note


def _summary(row: str, result, batch: str, statuses) -> dict:
    from nirmaan_stack.services.outflow_import.status import (
        derive_batch_counters,
        derive_batch_status,
    )

    return {
        "row": row,
        "batch": batch,
        "settled": {
            "doctype": result.doctype,
            "name": result.name,
            "amount": float(result.amount),
            "created": result.created,
            # X1: what the record held before, and whether we changed it. The screen shows the
            # delta on the bulk-confirm surface; `None` on a created expense, which had no
            # previous amount to correct.
            "original_amount": (
                None if result.original_amount is None else float(result.original_amount)
            ),
            "amount_changed": result.amount_changed,
        },
        "batch_status": derive_batch_status(statuses),
        "counters": derive_batch_counters(statuses),
    }
