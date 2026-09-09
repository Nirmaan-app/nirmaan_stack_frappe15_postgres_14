# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Record a bank CREDIT -- money that ARRIVED (Bulk Import Outflow, slices B6 + B7).

Thin orchestrators (ADR-0010 B4): authorize -> load -> guard -> call the service -> record -> commit.
The rules live in `services/outflow_import/settle.py`; this module owns the
import-side bookkeeping around them, and it reuses `expenses.py`'s helpers for that bookkeeping
rather than restating it -- the match record, the row flip, the batch rollup and the statement-file
link are the same four facts whatever was written, and a second copy is how two paths come to
disagree about what a settled row looks like.

THE TWO DISPOSITIONS A CREDIT CAN TAKE, AND THEY DIVIDE ON WHETHER A PROJECT IS BEHIND THE MONEY:
  * `create_inflow` (B6) -- a client receipt, against a project and its customer, written as a
    `Project Inflow`.
  * `create_non_project_receipt` (B7) -- everything else: FD/RD interest, an FD closing and
    returning its principal, a loan drawdown landing, a site advance coming back. None of those
    name a project, so none can be an inflow. Written as a NEGATIVE `Non Project Expense`, because
    THERE IS NO NON-PROJECT INFLOW DOCTYPE IN THIS APP AND NONE IS BEING CREATED (owner ruling Q3,
    ADR-0016 decision 3).

⚠️ WHY IS THE SECOND ONE IN A MODULE CALLED `inflows.py` WHEN IT WRITES AN EXPENSE DOCTYPE? BECAUSE
THE AXIS THIS MODULE SPLITS ON IS DIRECTION, NOT DOCTYPE, and that is the sentence to weigh before
moving it. `expenses.py` states as its own header property that EVERY endpoint in it writes an
OUTFLOW -- it settles money that left, or records a spend that had no PO -- and its guards are read
against that property (`create_expense_from_row` refuses `amount <= 0`, which is right only for a
debit). Putting a money-IN write there would quietly falsify that header and sit a signed write
beside an unsigned one under a shared name. Here it sits beside its actual sibling: the other thing
a reviewer may do with a credit row, sharing `_guard_is_a_credit` rather than a second copy of it.

⚠️ AND THE COST OF THE OWNER'S RULING, STATED HONESTLY RATHER THAN HIDDEN BY THE FILE NAME: money
arriving is recorded in a doctype called *Expenses*. Anyone reading or summing a Non-Project
Expenses list meets a negative row. That was weighed against a new doctype with new permissions,
list views and reports; ADR-0016 carries it as accepted risk R3. It is not this module's to
re-litigate -- what it can do, and does, is make the record say what it is: the new `non_project=1`
Expense Types (Q19) name the income kinds, and `payment_ref` carries the bank reference.

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

⚠️ THE `Outflow Row Match` UNIQUE KEY CANNOT GUARD THIS PATH, AND THAT IS THE WHOLE REASON THE TWO
LOOKUPS BELOW EXIST. The constraint is `(transfer_id, target_doctype, target_name)` and a created
record has a NEW `target_name` every time, so it never contends -- the identical hole the Cashbook
slice hit, whose second lookup then caught 17 live expenses carrying a wallet id nobody had
imported. Same shape here: `_already_created_by_import` and `_already_booked`, both keyed through
the ONE identity rule in `services/outflow_import/duplicates.py`.

⚠️ THOSE TWO LOOKUPS GUARD `create_inflow` ONLY, AND `create_non_project_receipt` DELIBERATELY HAS
NO EQUIVALENT -- A KNOWN GAP, RECORDED HERE RATHER THAN DISCOVERED LATER. It writes the same ledger
`expenses.create_expense` writes, and THAT path has no cross-batch duplicate guard either. Adding
one to this endpoint alone would produce the worse state: two endpoints writing
`Non Project Expenses` from the same statement, one refusing a repeat and one accepting it, so
whether a duplicate is caught would depend on which card the reviewer clicked. Closing it means
closing it on both, keyed on `payment_ref`, and that is its own slice. What DOES hold today is the
per-row guard: `_load_settleable_row` refuses a row that is already `Settled` or `Skipped`, so no
single staged row can write twice.
"""

import frappe

from nirmaan_stack.api.outflow_import.expenses import (
    _link_statement_file_to_target,
    _load_settleable_row,
    _record_settlement,
    _statement_file_url,
    _summary,
)
from nirmaan_stack.api.outflow_import.permissions import require_outflow_access
from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE, ROW_DOCTYPE, _refresh_batch_rollup
from nirmaan_stack.services.outflow_import.duplicates import (
    find_prior_sighting,
    index_prior_sightings,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.settle import (
    DIRECTION_CREDIT,
    INFLOW_DOCTYPE,
    InflowNotRecordableError,
    create_inflow_from_row,
    create_non_project_receipt_from_row,
)

#: ⚠️ THERE IS NO `get_non_project_receipt_types` HERE, AND THERE MUST NOT BE. The receipt form's
#: type list is the EXISTING `expenses.get_expense_types("Non Project Expenses")` -- the same
#: `non_project = 1` query the create-expense form already uses, behind the same access gate. A
#: second endpoint answering the same question is how the two lists come to disagree about which
#: types exist, and it would be the list the SERVER's `_assert_type_scope` does not read.
__all__ = ["create_inflow", "create_non_project_receipt", "get_inflow_context"]


@frappe.whitelist(methods=["POST"])
def create_inflow(row: str, project: str, customer: str = None, invoice: str = None):
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
def create_non_project_receipt(row: str, expense_type: str, description: str = None):
    """Record a bank CREDIT that belongs to no project, as a NEGATIVE `Non Project Expense` (B7).

    URL: /api/method/nirmaan_stack.api.outflow_import.inflows.create_non_project_receipt

    The second disposition a credit can take, beside `create_inflow`. It is the answer for the
    receipts that name no project -- FD/RD interest, an FD closing and returning its principal, a
    loan drawdown landing, a site advance coming back -- and there is no non-project inflow doctype
    in this app to put them in (owner ruling Q3; ADR-0016 decision 3, accepted risk R3).

    ⚠️ THE CLIENT SENDS WHAT KIND OF RECEIPT IT IS, AND NEVER A FIGURE -- LEAST OF ALL A SIGN. The
    amount, the payment date and the reference are read SERVER-SIDE off the staged bank row, exactly
    as `create_expense` and `create_inflow` read them, and the NEGATION is applied inside
    `create_non_project_receipt_from_row` from the row's own `direction`. A client that could post a
    negative number could book a debit as income, and the books would be wrong by twice the
    transfer with nothing on screen looking odd.

    ⚠️ THE SAME THREE-LINE PRELUDE AS `create_inflow`, MINUS THE DUPLICATE GUARD, and the module
    header says why that omission is deliberate rather than forgotten. `_load_settleable_row` still
    refuses a row that is already `Settled` or `Skipped`, so one staged row can never write twice.

    ⚠️ ONE ROW PER CALL, its own savepoint, its own commit -- the isolation `settle_row` documents
    at length. A failure on one row leaves the others written and the rest still attemptable.
    """
    actor = require_outflow_access()
    staged, doc = _load_settleable_row(row)
    # ⚠️ CHECKED HERE **AND** IN THE SERVICE, AND THEY ARE NOT REDUNDANT -- the same pairing
    # `create_inflow` uses, and it matters more on this path because the direction chooses a SIGN.
    # This one reads the STORED column and fails fast with the row in hand; the service re-checks
    # the value it is handed, because it is a service anything may call.
    _guard_is_a_credit(doc)
    statement_file_url = _statement_file_url(doc["import_batch"])

    savepoint = f"ofi_receipt_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        result = create_non_project_receipt_from_row(
            staged,
            actor=actor,
            expense_type=expense_type,
            # ⚠️ FROM THE STORED ROW, NEVER FROM THE PAYLOAD. The endpoint has no `direction`
            # parameter and must never grow one: it is the only thing standing between a debit and
            # a receipt, so a caller must not be able to state it.
            direction=doc.get("direction"),
            description=description,
            # Visible provenance on the record itself. The `Outflow Row Match` is the durable link,
            # but nobody opening a Non-Project Expense form sees that -- and on THIS ledger the
            # explanation matters more than usual, because the row they are looking at is negative.
            comment=f"Imported from {doc['import_batch']}",
            statement_file_url=statement_file_url,
        )
        _record_settlement(staged, doc, result, actor)
    except Exception:
        # Roll back to the savepoint rather than the whole request, for the reason `settle_row`
        # gives: the caller gets the real error and the database is exactly as it was.
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

    ⚠️ SHARED BY BOTH CREDIT ENDPOINTS SINCE B7, WHICH IS WHY THE MESSAGE NO LONGER SAYS
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
    """Refuse a credit that has already produced an inflow -- by this import, or by hand.

    ⚠️ THE ORDER IS THE MESSAGE, exactly as `cashbook.plan_statement` orders its own three tests:
    the import's OWN earlier work first, because that names a batch and a row the reader can go and
    look at, then a record booked outside this feature, which names only the record.

    ⚠️ THE TWO LOOKUPS KEY ON DIFFERENT COLUMNS, AND THAT IS NOT AN INCONSISTENCY. An
    `Outflow Row Match` carries the `transfer_id`; a `Project Inflow` carries the bank REFERENCE, in
    `utr`, because that is what `create_inflow_from_row` writes there. Cashbook's pair happens to
    use one value for both only because a wallet's transfer id IS its payment reference. Keying the
    second lookup on `transfer_id` here would compare a bank tran-id against a NEFT/RTGS reference
    and match nothing, silently -- a guard that always passes.
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

    reference = (getattr(staged, "bank_reference_no", "") or "").strip()
    booked = find_prior_sighting(
        _already_booked(reference), reference, staged.amount, staged.added_on_date
    )
    if booked:
        frappe.throw(
            f"{booked} already carries this bank reference. It was recorded outside this import; "
            f"nothing has been recorded again.",
            InflowNotRecordableError,
            title="Already booked",
        )


def _already_created_by_import(staged) -> dict:
    """Every `Project Inflow` THIS FEATURE has already created for this transfer.

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
    """
    if not staged.transfer_id:
        return {}
    rows = frappe.db.sql(
        f"""
        SELECT m.transfer_id, m.target_amount, m.target_name, m.import_batch, r.added_on
        FROM "tab{MATCH_DOCTYPE}" m
        LEFT JOIN "tab{ROW_DOCTYPE}" r ON r.name = m.import_row
        WHERE m.transfer_id = %s AND m.target_doctype = %s
        ORDER BY m.creation ASC
        """,
        (staged.transfer_id, INFLOW_DOCTYPE),
        as_dict=True,
    )
    return index_prior_sightings(
        (
            r["transfer_id"],
            normalize_amount(r.get("target_amount")),
            _date_of(r.get("added_on")),
            f"{INFLOW_DOCTYPE} {r['target_name']} (from import {r['import_batch']})",
        )
        for r in rows
    )


def _already_booked(reference: str) -> dict:
    """Every `Project Inflow` already carrying this bank reference, whoever recorded it.

    ⚠️ A DIFFERENT QUESTION FROM `_already_created_by_import`, AND THE GAP BETWEEN THEM IS THE HOLE.
    That one asks whether THIS import created a record. This asks whether the receipt is booked AT
    ALL -- which it can be without this import ever having seen it, because recording an inflow by
    hand is the ordinary way it is done today. Measured 2026-09-07: **330 of 463 live
    `Project Inflows` carry a `utr`**, every one of them keyed in by hand -- `Outflow Row Match`
    holds zero `Project Inflows` targets, so nothing in this feature has ever created one. All 463
    carry a `payment_date`, so the date axis is populated on every row of the corpus this scans.

    ⚠️ NARROWED BY REFERENCE IN SQL, NOT IN PYTHON, and by ONE reference because this endpoint is
    per-row. `utr` is unindexed; at 463 rows the sequential scan is free. Revisit past ~100k.

    ⚠️ NO STATUS FILTER, because there is no status to filter on -- `Project Inflows` has none, which
    is the fact this whole slice turns on.

    ⚠️ THE AMOUNT COLUMN IS **Data** AND MUST BE CAST, the same asymmetry `Project Expenses` carries.
    Measured 2026-09-07: 0 of 463 rows would break the cast; the `BTRIM <> ''` guard mirrors
    `cashbook._already_booked`'s.

    A BLANK REFERENCE FAILS OPEN -- `index_prior_sightings` drops blank keys and
    `find_prior_sighting` returns `None` for one, so such a row is never recognised as a repeat.
    That is the recoverable direction: a duplicate somebody can see beats a real receipt silently
    refused. (Measured: 0 of the ICICI credits in the corpus lack a reference.)
    """
    if not reference:
        return {}
    rows = frappe.db.sql(
        f"""
        SELECT BTRIM(utr) AS utr,
               CAST(NULLIF(BTRIM(amount), '') AS numeric) AS amount,
               payment_date, name
        FROM "tab{INFLOW_DOCTYPE}"
        WHERE BTRIM(COALESCE(utr, '')) = %s
          AND COALESCE(BTRIM(amount), '') <> ''
        ORDER BY creation ASC
        """,
        (reference,),
        as_dict=True,
    )
    return index_prior_sightings(
        (
            r["utr"],
            normalize_amount(r.get("amount")),
            r.get("payment_date"),
            f"{INFLOW_DOCTYPE} {r['name']}",
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
