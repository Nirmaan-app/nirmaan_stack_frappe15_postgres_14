# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""What an unreconcile puts right AROUND the records it reverted (#1276, parent #1270).

`unreconcile.unreconcile_row` calls `restore_derived_state` once, inside its savepoint, after every
leg is written. Nothing here commits; a failure rolls every leg back with it.

Each figure is RECOMPUTED FROM SOURCE, never rolled back from memory (root `CLAUDE.md`), and each is
here because the payment's own hooks do not get it right on a `Paid -> Approved` save:

  * VENDOR CREDIT -- `controllers/project_payments.on_update` recalculates only on `Approved -> Paid`.
    The shared helper lives in `vendor_credit_refresh.py` from #1289, because the SETTLE side needs
    the same repair now that it writes `Reconciliation Pending -> Paid`, which that branch misses too.
  * CEO HOLD -- `project_cashflow_hold_update.trigger_check` claims a per-request, per-project flag,
    so the SECOND payment of one project in a Reverse all is never evaluated: the gap it leaves
    counts every payment but the first.
  * LATEST PAYMENT DATE -- the settle only ever ADVANCES it (`settle._advance_po_latest_payment_date`);
    its recompute twin `settle.recompute_latest_payment_date` lives beside it.
  * THE STATEMENT `File` ROW -- minted after the settle's commit by
    `expenses._link_statement_file_to_target`, outside any save.

AN EXPENSE (#1277) has no parent, no vendor credit and no latest payment date, so only two of these
apply to it: its statement `File` row, and -- for a `Project Expenses` record -- its project's CEO Hold,
whose hook (`on_project_expense`) claims the same per-request flag.

A DELETED RECORD (#1278) -- an inflow or expense the import created -- needs only its project's CEO
Hold. Its statement `File` rows came off BEFORE the delete (`unreconcile_created.delete_created`), and its
project was read before it too, because nothing can be read about it now. `Project Inflows`' trash
hook evaluates the gap BEFORE the row is gone, so without this re-sync the deleted inflow would still
count.
"""

import frappe

from nirmaan_stack.api.outflow_import.vendor_credit_refresh import recompute_vendor_credit
from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import (
    sync_cashflow_reason,
)
from nirmaan_stack.services.outflow_import.ledgers import (
    PAYMENT_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
)
from nirmaan_stack.services.outflow_import.settle import (
    _outflow_import_write,
    recompute_latest_payment_date,
)

PO_DOCTYPE = "Procurement Orders"
LEDGER_ENTRY_TYPE = "Payment Unreconciled"


def restore_derived_state(carried, statement_file_url: str | None) -> None:
    """Put right everything derived from `carried` -- `unreconcile.CarriedOut` per leg: records already
    back to Approved, and records already deleted."""
    projects = {leg.project for leg in carried if leg.deleted and leg.project}
    by_doctype = {}
    unlinked = {}
    for leg in carried:
        if not leg.deleted:
            by_doctype.setdefault(leg.doctype, set()).add(leg.name)
            # #1300: a line off a many-line expense whose statement is still attached keeps its link.
            if not leg.statement_held_by_another_line:
                unlinked.setdefault(leg.doctype, set()).add(leg.name)
    for doctype, names in sorted(unlinked.items()):
        delete_statement_file_links(doctype, sorted(names), statement_file_url)

    payment_names = sorted(by_doctype.get(PAYMENT_DOCTYPE, ()))
    if payment_names:
        payments = frappe.get_all(
            PAYMENT_DOCTYPE,
            filters={"name": ["in", payment_names]},
            fields=["name", "project", "document_type", "document_name"],
        )
        parents = sorted(
            {(p.document_type, p.document_name) for p in payments if p.document_type and p.document_name}
        )
        for doctype, name in parents:
            recompute_latest_payment_date(doctype, name)
        recompute_vendor_credit(
            [name for doctype, name in parents if doctype == PO_DOCTYPE], LEDGER_ENTRY_TYPE
        )
        projects |= {p.project for p in payments if p.project}

    expense_names = sorted(by_doctype.get(PROJECT_EXPENSE_DOCTYPE, ()))
    if expense_names:
        projects |= set(
            frappe.get_all(
                PROJECT_EXPENSE_DOCTYPE,
                filters={"name": ["in", expense_names], "projects": ["is", "set"]},
                pluck="projects",
            )
        )
    # LAST: the gap reads the PO `amount_paid` the saves recomputed and every record's status.
    for project in sorted(projects):
        _resync_cashflow_hold(project)


def delete_statement_file_links(doctype: str, names, statement_file_url: str | None) -> None:
    """Delete the `File` row that made the statement openable from each record.

    ⚠️ A RAW DELETE, SO NO `File` HOOK FIRES -- AND THAT IS THE POINT. The row is only a permission
    link; the blob it points at is the IMPORT BATCH's statement, shared by every record that batch
    settled. `frappe_gcp_attachment`'s `on_trash` deletes the blob by the row's `content_hash`: on a
    link row that is NULL (every one on the local site, 2026-09-15), which throws when cloud deletes
    are on, and on a row carrying the key it would delete the statement out from under the import.
    Frappe's own `on_trash` adds only an "Attachment Removed" comment. The batch's own `File` row is
    attached to the batch, so the filter below cannot reach it.
    """
    if not statement_file_url:
        return
    frappe.db.delete(
        "File",
        {
            "file_url": statement_file_url,
            "attached_to_doctype": doctype,
            "attached_to_name": ["in", list(names)],
        },
    )


def _resync_cashflow_hold(project: str) -> None:
    """Re-evaluate the project's cashflow-gap hold on the state after EVERY write.

    Called directly rather than through `trigger_check`, whose per-request flag is exactly what left
    the gap stale. `_outflow_import_write` holds shut the one branch that commits (the manual-hold
    releasable notice), as it does for the settle. Unlike `trigger_check` it does not swallow a
    failure: a hold left stale is the defect this slice exists to prevent, so the reversal rolls back.
    """
    with _outflow_import_write():
        sync_cashflow_reason(project)
