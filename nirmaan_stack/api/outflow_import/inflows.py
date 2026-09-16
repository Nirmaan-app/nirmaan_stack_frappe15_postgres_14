# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Record a bank CREDIT -- money that ARRIVED (Bulk Import Outflow, slice B6 + #1266).

Thin orchestrators (ADR-0010 B4): authorize -> load -> guard -> call the service -> record -> commit.
The rules live in `services/outflow_import/settle.py`; this module owns the
import-side bookkeeping around them, and it reuses `expenses.py`'s helpers for that bookkeeping
rather than restating it -- the match record, the row flip, the batch rollup and the statement-file
link are the same four facts whatever was written, and a second copy is how two paths come to
disagree about what a settled row looks like.

THE TWO DISPOSITIONS A CREDIT CAN TAKE, AND THEY DIVIDE ON WHETHER A PROJECT IS BEHIND THE MONEY:
  * `create_inflow` (B6) -- a client receipt, against a project and its customer, written as a
    `Project Inflow`.
  * `create_non_project_inflow` (#1266) -- everything else: FD/RD interest, an FD closing, a loan
    drawdown landing, a refund coming back. Written as a `Non Project Inflow` with an Inflow Type
    (ADR-0016 Amendment A). It replaced the B7 `create_non_project_receipt`, which wrote a NEGATIVE
    `Non Project Expense` -- that endpoint, its service and its tests are REMOVED, not just hidden:
    a live endpoint nobody calls can still write negative expenses (A-D2).

The axis this module splits on is DIRECTION: `expenses.py` holds every endpoint that writes an
OUTFLOW, and this one holds the two a reviewer may take with a credit row, sharing
`_guard_is_a_credit` rather than a second copy of it.

⚠️ THE THING TO UNDERSTAND BEFORE EDITING ANYTHING HERE: A CREATED INFLOW IS LIVE IMMEDIATELY AND
THERE IS NO DRAFT STATE. `Project Inflows` has no `status` field, and every consumer sums it with
no filter -- `api/projects/project_aggregates`, `api/payments/get_project_payment_summary`,
`api/customers/customer_financials`, and `integrations/controllers/project_cashflow_hold_update`,
which computes `cashflow_gap = outflow + liabilities - inflow` and drives CEO Cashflow Hold. So this
endpoint can RELEASE a CEO Hold on the click that creates the record. The review gate is the bank
row: a person confirms the transfer, and confirming creates (owner ruling Q8, option c). Adding a
status field to `Project Inflows` to give this path a draft is explicitly NOT the answer -- that is
a migration touching every financial screen and ~4,000 existing rows.

⚠️ ONE ACCESS GATE, `require_outflow_access` (owner ruling Q26). NOT the wider role set that may
read or write `Project Inflows` from the app's own screens. Reaching this endpoint means using the
bank-statement import, and the import's own gate is what governs it; layering the inflow roles on
top would let somebody who may record a receipt by hand record one from a statement they may not
open.

⚠️ THE `Outflow Row Match` UNIQUE KEY CANNOT GUARD THIS PATH, AND THAT IS THE WHOLE REASON THE
LOOKUPS BELOW EXIST. The constraint is `(transfer_id, target_doctype, target_name)` and a created
record has a NEW `target_name` every time, so it never contends -- the identical hole the Cashbook
slice hit, whose second lookup then caught 17 live expenses carrying a wallet id nobody had
imported.

⚠️ BOTH ENDPOINTS RUN `expenses._guard_money_not_recorded` (#1260), the same guard `create_expense`,
`settle_row` and `allocate_row` run: the match run's own already-recorded question for the line's
source, refusing a line the run would skip and asking for confirmation on one it would leave
Mismatched naming a record. So whether a duplicate is caught never depends on which card the
reviewer clicked.

⚠️ WHAT A CREDIT IS CHECKED AGAINST IS THE OWNER'S RULING, NOT A GAP: a deposit reads BOTH inflow
books -- `Project Inflows` (#1252) and `Non Project Inflows` (#1268, ADR-0016 A-D2) -- and nothing
else, so a receipt booked earlier as a NEGATIVE Non Project Expense is not found. A re-upload of the
same statement line is still caught at upload by the cross-batch identity.

Both endpoints also run `_guard_not_already_recorded` first, keyed through the ONE identity rule in
`services/outflow_import/duplicates.py`: an inflow of EITHER kind THIS import created for the same
transfer id, which names the batch it came from.
"""

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    _guard_money_not_recorded,
    _link_statement_file_to_target,
    _load_settleable_row,
    _record_settlement,
    _refresh_row_allocation,
    _statement_file_url,
    _summary,
)
from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.api.outflow_import.review import (
    MATCH_DOCTYPE,
    ROW_DOCTYPE,
    _refresh_batch_rollup,
)
from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.duplicates import (
    find_prior_sighting,
    index_prior_sightings,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.settle import (
    DIRECTION_CREDIT,
    INFLOW_DOCTYPE,
    NON_PROJECT_INFLOW,
    InflowNotRecordableError,
    create_inflow_from_row,
    create_non_project_inflow_from_row,
)

__all__ = ["create_inflow", "create_non_project_inflow", "get_inflow_context"]


@frappe.whitelist(methods=["POST"])
def create_inflow(
    row: str, project: str, customer: str = None, invoice: str = None, confirm_mismatch=False
):
    """Record a NEW `Project Inflow`, for a bank credit that this import cannot settle.

    URL: /api/method/nirmaan_stack.api.outflow_import.inflows.create_inflow

    ⚠️ THE CLIENT SENDS WHO THE MONEY IS FOR; IT NEVER SENDS A FIGURE. The amount, the payment date
    and the reference are all read SERVER-SIDE off the staged bank row, exactly as `create_expense`
    does it. The statement is the source of truth for all three, and a client that could name them
    could record a receipt the bank never sent.

    ⚠️ ONE ROW PER CALL, its own savepoint, its own commit -- the isolation `settle_row` documents
    at length. A failure on one row leaves the others written and the rest still attemptable.

    ⚠️ `customer` IS A CROSS-CHECK, NOT AN INPUT. The service reads the customer off the project and
    refuses a supplied one that disagrees; passing it is how a stale screen is caught rather than
    silently overruled.
    """
    actor = require_outflow_access()
    staged, doc = _load_settleable_row(row)
    _guard_is_a_credit(doc)
    _guard_not_already_recorded(staged, doc)
    _guard_money_not_recorded(staged, doc, confirm_mismatch)
    statement_file_url = _statement_file_url(doc["import_batch"])

    savepoint = f"ofi_inflow_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        result = create_inflow_from_row(
            staged,
            actor=actor,
            project=project,
            customer=customer,
            invoice=invoice,
            statement_file_url=statement_file_url,
            direction=doc.get("direction"),
        )
        _record_settlement(staged, doc, result, actor)
        # ⚠️ INSIDE THE SAVEPOINT, AND IT IS WHAT MARKS THE ROW DONE. `_record_settlement` writes
        # the leg; the row's own status is DERIVED from its legs (ADR-0020) and written here. This
        # call is the port that was missed when the flip moved out of `_record_settlement` -- this
        # module never referenced either name, so a recorded credit sat at `Mismatched` and the
        # per-row guard both endpoints lean on never engaged.
        #
        # ⚠️ `result` IS PASSED SO THE NOTE READS "Recorded", NOT "Settled". Both credit paths
        # CREATE their record, and `allocation_note` distinguishes a record this import brought into
        # existence from one that was already sitting there approved.
        _refresh_row_allocation(staged.name, actor, result)
    except Exception:
        # Roll back to the savepoint rather than the whole request, for the reason `settle_row`
        # gives: the caller gets the real error and the database is exactly as it was.
        #
        # ⚠️ THIS ONLY WORKS BECAUSE NOTHING INSIDE COMMITS. An inflow insert wakes
        # `project_cashflow_hold_update.on_project_inflow`, whose manual-hold-releasable branch
        # commits; `create_inflow_from_row` holds it shut with `frappe.flags.outflow_import_settling`
        # while the gap recomputation itself still runs in this transaction.
        frappe.db.rollback(save_point=savepoint)
        raise
    frappe.db.release_savepoint(savepoint)

    statuses = _refresh_batch_rollup(doc["import_batch"])
    frappe.db.commit()
    # ⚠️ AFTER THE COMMIT, because a `File` insert wakes the cloud-attachment hook and that hook
    # commits -- inside the savepoint above it would make the rollback a silent no-op.
    _link_statement_file_to_target(statement_file_url, result)
    return _summary(row, result, doc["import_batch"], statuses)


@frappe.whitelist(methods=["POST"])
def create_non_project_inflow(
    row: str, inflow_type: str = None, description: str = None, confirm_mismatch=False
):
    """Record a bank CREDIT that belongs to no project, as a new `Non Project Inflow` (#1266).

    URL: /api/method/nirmaan_stack.api.outflow_import.inflows.create_non_project_inflow

    The second disposition a credit can take, beside `create_inflow`: FD/RD interest, an FD
    closing, a loan drawdown, a refund coming back (ADR-0016 Amendment A-D2). It replaced the B7
    `create_non_project_receipt`, which wrote a NEGATIVE `Non Project Expense`.

    ⚠️ THE CLIENT SENDS WHAT KIND OF MONEY IT IS, AND NEVER A FIGURE. Amount, payment date and
    reference are read SERVER-SIDE off the staged bank row, exactly as `create_inflow` reads them.

    ⚠️ `inflow_type` DEFAULTS TO None ONLY SO A MISSING ONE REACHES THE SERVICE'S OWN REFUSAL, which
    names the four types, rather than a bare missing-argument error.

    ⚠️ THE SAME PRELUDE AS `create_inflow` (#1268): the import's own earlier inflow of EITHER kind,
    then the recorded-money guard (#1260), which reads both inflow books. So a credit an earlier
    import -- or a person -- already recorded is refused whichever card the reviewer clicks.

    ⚠️ ONE ROW PER CALL, its own savepoint, its own commit -- the isolation `settle_row` documents
    at length. A refusal writes nothing.
    """
    actor = require_outflow_access()
    staged, doc = _load_settleable_row(row)
    # ⚠️ CHECKED HERE **AND** IN THE SERVICE, AND THEY ARE NOT REDUNDANT -- the pairing
    # `create_inflow` uses. This one reads the STORED column and fails fast with the row in hand;
    # the service re-checks the value it is handed, because it is a service anything may call.
    _guard_is_a_credit(doc)
    _guard_not_already_recorded(staged, doc)
    _guard_money_not_recorded(staged, doc, confirm_mismatch)
    statement_file_url = _statement_file_url(doc["import_batch"])

    savepoint = f"ofi_np_inflow_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        result = create_non_project_inflow_from_row(
            staged,
            actor=actor,
            inflow_type=inflow_type,
            # ⚠️ FROM THE STORED ROW, NEVER FROM THE PAYLOAD. The endpoint has no `direction`
            # parameter and must never grow one: it is what stands between a debit and a record of
            # money received.
            direction=doc.get("direction"),
            description=description,
            statement_file_url=statement_file_url,
        )
        _record_settlement(staged, doc, result, actor)
        # INSIDE THE SAVEPOINT, AND IT IS WHAT MARKS THE ROW DONE -- see `create_inflow`. `result`
        # is passed so the note reads "Recorded", not "Settled".
        _refresh_row_allocation(staged.name, actor, result)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    frappe.db.release_savepoint(savepoint)

    statuses = _refresh_batch_rollup(doc["import_batch"])
    frappe.db.commit()
    # ⚠️ AFTER THE COMMIT, because a `File` insert wakes the cloud-attachment hook and that hook
    # commits -- inside the savepoint above it would make the rollback a silent no-op.
    _link_statement_file_to_target(statement_file_url, result)
    return _summary(row, result, doc["import_batch"], statuses)


@frappe.whitelist()
def get_inflow_context(project: str):
    """The customer a project's receipts belong to, and the invoices they may be set against.

    ⚠️ THE CUSTOMER IS A FACT ABOUT THE PROJECT, NOT A CHOICE, which is why this returns it rather
    than offering a list. `NewInflowPayment.tsx` derives it the same way; the difference is that
    THIS answer is the one the write path will also read, so the screen cannot show a customer the
    server then disagrees with.

    ⚠️ IT REPORTS A MISSING CUSTOMER RATHER THAN HIDING THE PROJECT. A project with none cannot
    receive money (owner ruling Q13, enforced in `create_inflow_from_row`), and a reviewer who
    cannot see why is left with a control that does nothing -- the dead-button complaint this
    feature has already answered once.
    """
    require_outflow_access()
    on_project = frappe.db.get_value(
        "Projects", project, ["name", "project_name", "customer", "tendering_status"], as_dict=True
    )
    if not on_project:
        return {"project": project, "customer": None, "customer_name": "", "invoices": []}

    customer = (on_project.get("customer") or "").strip() or None
    return {
        "project": on_project["name"],
        "project_name": on_project.get("project_name") or on_project["name"],
        "tendering_status": on_project.get("tendering_status") or "",
        "customer": customer,
        "customer_name": (
            frappe.db.get_value("Customers", customer, "company_name") or customer or ""
        )
        if customer
        else "",
        "invoices": frappe.get_all(
            "Project Invoices",
            filters={"project": on_project["name"]},
            fields=["name", "invoice_no", "amount", "invoice_date"],
            order_by="invoice_date desc",
            limit_page_length=0,
        ),
    }


# --- guards ------------------------------------------------------------------------------------


def _guard_is_a_credit(doc) -> None:
    """Refuse a row that is not a bank credit, before anything else is read.

    ⚠️ IT IS CHECKED IN TWO PLACES ON PURPOSE, AND THEY ARE NOT REDUNDANT. This one reads the STORED
    column and fails fast with the row in hand; the service re-checks the value it is
    handed, because it is a service anything may call and a rule with no owner in the service layer
    is a rule an endpoint can forget. Neither is the other's backstop for a race -- direction is
    written once at staging and never changes.

    ⚠️ SHARED BY BOTH CREDIT ENDPOINTS, WHICH IS WHY THE MESSAGE NO LONGER SAYS
    "project inflow". The same fact refuses both dispositions -- this transfer took money OUT -- and
    a message naming only one of them would be wrong half the time it is read. The service-side
    twins each speak in their own voice, where the disposition IS known.
    """
    direction = (doc.get("direction") or "").strip()
    if direction == DIRECTION_CREDIT:
        return
    frappe.throw(
        "Only a credit can be recorded as money received. This transfer is a "
        f"{direction.lower() or 'transfer with no stated direction'}, so it took money out.",
        InflowNotRecordableError,
        title="Not a credit",
    )


def _guard_not_already_recorded(staged, doc) -> None:
    """Refuse a credit that THIS IMPORT has already turned into an inflow -- of either kind (#1268).

    ⚠️ IT RUNS BEFORE `expenses._guard_money_not_recorded`, AND THE ORDER IS THE MESSAGE, exactly as
    `cashbook.plan_statement` orders its own tests: the import's OWN earlier work first, because that
    names a batch the reader can go and look at; then a record booked by anyone, which names only the
    record. The two ask different questions on different columns -- an `Outflow Row Match` carries
    the `transfer_id`, a `Project Inflow` carries a REFERENCE in `utr` -- and that is not an
    inconsistency.
    """
    prior = find_prior_sighting(
        _already_created_by_import(staged),
        staged.transfer_id,
        staged.amount,
        staged.added_on_date,
    )
    if prior:
        frappe.throw(
            f"This credit has already been recorded as {prior}. Nothing has been recorded again.",
            InflowNotRecordableError,
            title="Already recorded",
        )


def _already_created_by_import(staged) -> dict:
    """Every inflow THIS FEATURE has already created for this transfer, in either book.

    ⚠️ BOTH `Project Inflows` AND `Non Project Inflows` (#1268). A credit becomes one or the other, and
    the same money recorded once in each is still recorded twice.

    ⚠️ THIS IS THE GUARD THE UNIQUE CONSTRAINT CANNOT BE. `Outflow Row Match`'s key is
    `(transfer_id, target_doctype, target_name)`, and a created record's name is new every time, so
    two imports of the same credit contend on nothing and both succeed. The Cashbook slice met this
    exactly and its notes say the same sentence; on THIS path this function is the guard.

    ⚠️ IT SEARCHES EVERY BATCH, WITH NO PERIOD NARROWING AND NO `exclude_batch`. Period narrowing is
    ergonomics and its licence is that the constraint catches a miss -- a licence that does not
    exist here. And excluding the current batch would be wrong in the other direction: a match
    record in ANY batch means an inflow EXISTS, whichever staging row minted it.

    ⚠️ DELIBERATELY NOT `candidates.prior_import_sightings`, WHICH ASKS A DIFFERENT QUESTION. That
    one finds earlier STAGED rows -- staged, not settled -- which is the right test at UPLOAD time,
    where "earlier" is true by construction. Called from a per-row endpoint it has no such ordering:
    a LATER batch holding a staged copy would refuse the EARLIER row, blocking a reviewer from
    recording a receipt because a duplicate of it exists somewhere ahead of them. A match record
    means a record exists; a staged row means nothing has happened yet.

    The identity is settled by `duplicates.find_prior_sighting`, so the date obeys the missing-date
    fallback rather than SQL's `NULL = NULL`, and the amount is compared as a `Decimal`.
    `ORDER BY creation ASC` names the FIRST inflow, which is the one worth pointing at.

    ⚠️ SETTLED LEGS ONLY (#1278). Unreconciling an import-created inflow DELETES it and keeps its leg,
    stamped Reversed. That leg names a record that no longer exists; counting it would refuse the
    very re-record the unreconcile was done to allow, naming an inflow nobody can open.
    """
    if not staged.transfer_id:
        return {}
    rows = frappe.db.sql(
        f"""
        SELECT m.transfer_id, m.target_amount, m.target_doctype, m.target_name, m.import_batch,
               r.added_on
        FROM "tab{MATCH_DOCTYPE}" m
        LEFT JOIN "tab{ROW_DOCTYPE}" r ON r.name = m.import_row
        WHERE m.transfer_id = %s AND m.target_doctype IN (%s, %s) AND m.match_kind = %s
        ORDER BY m.creation ASC
        """,
        (staged.transfer_id, INFLOW_DOCTYPE, NON_PROJECT_INFLOW, MATCH_SETTLED),
        as_dict=True,
    )
    return index_prior_sightings(
        (
            r["transfer_id"],
            normalize_amount(r.get("target_amount")),
            _date_of(r.get("added_on")),
            f"{r['target_doctype']} {r['target_name']} (from import {r['import_batch']})",
        )
        for r in rows
    )


def _date_of(value):
    """The DATE of a stored `added_on`, tolerating the shapes the DB layer hands back.

    Mirrors `candidates._stored_date`; kept local rather than imported because that one is private
    to a module this file does not otherwise depend on, and the whole rule is two lines.
    """
    if value is None:
        return None
    return value.date() if hasattr(value, "date") else value
