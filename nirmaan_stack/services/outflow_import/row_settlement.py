# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The import's row-settlement writers: what every settle of a bank line writes beside the record it paid
(ADR-0020). Moved out of `api/outflow_import/expenses.py` and `review.py` so a service (the cheques
service's clear, spec #1477) writes a bank line exactly as the import's own settles do, without
importing from `api/`.

* `record_settlement` -- one `Outflow Row Match` (the match record) per settled target.
* `refresh_row_allocation` -- the line's status, worked out again from its match records.
* `refresh_batch_rollup` -- the batch's counters and status from its rows.
* `link_statement_file_to_target` -- the statement's `File` row on the settled record, AFTER the commit.

Never commits, except `link_statement_file_to_target`, which runs after the caller's commit by design.
"""

import frappe

from nirmaan_stack.services.outflow_import.allocation import (
    MATCH_SETTLED,
    allocation_note,
    status_for_allocation,
)
from nirmaan_stack.services.outflow_import.ledgers import TARGET_SNAPSHOT_FIELDS
from nirmaan_stack.services.outflow_import.settle import statement_attachment_field
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
    derive_batch_counters,
    derive_batch_status,
    settlement_origin,
)

BATCH_DOCTYPE = "Outflow Import Batch"
ROW_DOCTYPE = "Outflow Import Row"
MATCH_DOCTYPE = "Outflow Row Match"


def record_settlement(staged, doc, result, actor) -> None:
    """The import-side half: the match record. THE ROW'S OWN STATUS IS NO LONGER WRITTEN HERE.

    ⚠️ THE FLIP MOVED TO `refresh_row_allocation` (ADR-0020). It used to set `row_status` to
    `Settled` unconditionally, plus `outcome_note` / `decided_at` / `decided_by` /
    `settlement_origin`. Under incremental allocation this function runs once PER LEG, so the last
    leg would overwrite every earlier leg's facts and a 10%-allocated transfer would read `Settled`
    on the master table. The status is now DERIVED from the legs, which is the only form that can
    be right for both one leg and six.

    The match record carries the (transfer_id, target) unique constraint, so it is what stops the
    same transfer settling the same expense twice -- from a re-upload, an overlapping export, or a
    double-clicked button. It is written BEFORE the row's allocation is recomputed so a constraint
    violation aborts the settlement rather than leaving a row claiming money that was never written.

    ⚠️ `match_basis` USED TO BE THE LITERAL "Manual", ON EVERY SETTLEMENT (fixed at slice Q1). It
    was not merely lazy: the field's Select options were `Bank reference / Vendor+amount+date /
    Manual`, which named no tier the matcher actually produces, so "Manual" was the only value that
    would validate. The result was that the record meaning MONEY WAS WRITTEN claimed a person had
    found every one of 849 settlements, when the machine had found 843 of them. The options are now
    the matcher's own vocabulary and the tier is copied from the row, which has carried it all
    along.

    ⚠️ `target_project` / `target_vendor` ARE SET HERE, IN THE SAME `match.update()` CALL THAT
    INSERTS THE RECORD, AND MUST STAY THAT WAY. `Outflow Row Match.validate()` (Task 2) freezes
    every non-reversal field once a record exists, so a later write to either would be refused.
    """
    origin = settlement_origin(doc.get("suggested_name"), result.name)
    match = frappe.new_doc(MATCH_DOCTYPE)
    match.update(
        {
            "import_row": staged.name,
            "import_batch": doc["import_batch"],
            "transfer_id": staged.transfer_id,
            "target_doctype": result.doctype,
            "target_name": result.name,
            # `target_amount` means "how much of THIS TRANSFER went to this target". Since the import
            # records no tax (ADR-0021) every settle path writes the payment's own settled figure, so
            # `result.amount` IS that share -- there is no withheld part to subtract. On a slip of a
            # many-line expense (ADR-0027, #1298) `settle.link_lines_to_expense` hands the LINE's own
            # amount instead, so an expense's linked total is a plain SUM of its slips. ⚠️ Do not
            # reintroduce a net/gross split here: SR tax is withheld at approval by
            # `services/payment_tds.py`, which rewrites `amount` to the net figure before this runs.
            "target_amount": float(result.amount),
            "match_kind": MATCH_SETTLED,
            # The tier that FOUND the counterpart, or "Manual" when the matcher found nothing and
            # the person went looking. ⚠️ Two DIFFERENT questions live side by side here -- this one
            # is "how was it found", `settlement_origin` is "did a person accept that". A row can be
            # `account+IFSC` + `Suggestion overridden`: the matcher found something on a strong
            # tier and the reviewer still chose otherwise.
            "match_basis": (doc.get("match_basis") or "").strip() or "Manual",
            "settlement_origin": origin,
            # #1278: whether this settle BROUGHT THE RECORD INTO EXISTENCE. Unreconcile deletes such a
            # record rather than putting it back to Approved; frozen after insert like the rest.
            "created_by_import": 1 if result.created else 0,
            "matched_at": frappe.utils.now_datetime(),
            "matched_by": actor,
            # SNAPSHOTS at allocation time -- never recomputed. See the field descriptions.
            **target_snapshot(result.doctype, result.name),
        }
    )
    match.insert(ignore_permissions=True)


def target_snapshot(doctype: str, name: str) -> dict:
    """Reads the DB, so it stays here -- `ledgers.TARGET_SNAPSHOT_FIELDS` (the map itself, moved
    there at review since a per-ledger field map is the same kind of fact `SETTLEABLE_STATUSES`
    already owns) is pure; this function is not."""
    project_field, vendor_field = TARGET_SNAPSHOT_FIELDS.get(doctype, (None, None))
    fields = [f for f in (project_field, vendor_field) if f]
    if not fields:
        return {"target_project": None, "target_vendor": None}
    values = frappe.db.get_value(doctype, name, fields, as_dict=True) or {}
    return {
        "target_project": values.get(project_field) if project_field else None,
        "target_vendor": values.get(vendor_field) if vendor_field else None,
    }


def refresh_row_allocation(
    row_name: str, actor: str, result=None, *, confirm_by_hand: bool = False
) -> str:
    """Recompute a row's allocation from its legs and write the derived status. Returns it.

    ⚠️ `confirm_by_hand` IS WRITTEN ON EVERY CALL, AND ITS DEFAULT CLEARS IT (#1280). Every settle path
    -- `settle_row`, `settle_row_partial`, `allocate_row`, `create_expense` and both inflow creates --
    ends here, so "any successful settle clears the marker" holds without each path remembering to.
    `unreconcile.unreconcile_row` is the one caller that passes `True`. Inside the caller's savepoint
    either way, so a settle that rolls back leaves the marker as it was.

    ⚠️ `result` IS THE JUST-WRITTEN `SettleResult`, AND IT EXISTS ONLY TO FEED THE NOTE (review F2).
    It carries the two facts the sentence cannot derive from a leg -- whether the record was
    CREATED by this import (`Recorded` rather than `Settled`) and whether slice X1's rewrite
    CORRECTED an approved amount to the bank's. Task 3 deleted `_settled_note` and with it both,
    so a created expense read `Settled ...` and a 31-paise correction disappeared from the only
    surface a reviewer actually reads. `allocation_note` stays PURE: it is handed the two unpacked
    values, never the result object.
    ⚠️ `None` IS THE HONEST DEFAULT AND MUST STAY. `allocate_row` passes nothing -- it writes N legs
    and there is no single result, and it cannot produce either fact anyway (payments are never
    created, and `rewrite_amount_to_bank=False` means nothing is ever corrected). `reverse_allocation`
    passes nothing for the same reason: it writes no record at all.

    ⚠️ THE SUM IS ALWAYS FRESH. Nothing is incremented, so a reversal, a re-allocation and an
    ordinary settle all repair the row exactly, and a reconcile pass can prove the figure at any
    time.

    ⚠️ THE FALLBACK IS THE CALLER'S DECISION IN `allocation.py` AND IS MADE HERE: a row whose last
    leg was reversed returns to `Matched` if its suggestion survived and `Mismatched` otherwise.
    Both are ACTIVE and neither is frozen, so a later re-match can reconsider the row -- which is
    exactly right, because nothing is written against it any more.

    ⚠️ RULING B (Task 3) -- `settlement_origin` IS WRITTEN HERE, ONLY WHEN THE ROW REACHES
    `ROW_SETTLED`, AND CLEARED OTHERWISE. It answers "did the settlement take the machine's pick",
    which is meaningless while a row is still `Partially Allocated` -- more legs may still land, and
    none of them has to agree with the others. It is DERIVED here (from the most recent LIVE leg),
    never threaded from the caller, so it stays correct however many call sites eventually write a
    leg -- `allocate_row` (Task 4) will be a fifth. `get_outflow_summary`'s `from_suggestion`
    aggregate and `_FACET_COLUMNS["settlement_origin"]` (`review.py`) both read this column off the
    row; leaving it unset here would silently zero both once a row reaches `Settled` through this
    path.

    ⚠️ `decided_at` / `decided_by` ARE ALSO WRITTEN ONLY WHILE SOMETHING IS ACTUALLY ALLOCATED
    (`Settled` or `Partially Allocated`), AND CLEARED TO `None` ON THE FALLBACK -- fixed at review
    (Task 3), same shape as `settlement_origin` and for the same class of reason. Unreachable today
    (nothing yet reverses a leg), but the moment Task 5's reversal drives a row back to `Matched` or
    `Mismatched`, a stale `decided_by` would drop that row out of `review.py`'s
    `undecided_by_a_person` bucket while the screen shows it as undecided -- a decision that has
    been fully reversed has been undone, and the row honestly has no decider any more.

    ⚠️ `frappe.db.set_value` bypasses the document lifecycle, and that is correct here: this row
    carries no `doc_events`, and the batch rollup it feeds is invoked explicitly by the caller.
    """
    row = frappe.db.get_value(
        ROW_DOCTYPE, row_name, ["name", "amount", "suggested_name"], as_dict=True
    )
    legs = frappe.db.get_all(
        MATCH_DOCTYPE,
        filters={"import_row": row_name},
        fields=["name", "target_doctype", "target_name", "target_amount", "match_kind"],
        order_by="matched_at asc, name asc",
    )
    fallback = ROW_MATCHED if (row.get("suggested_name") or "").strip() else ROW_MISMATCHED
    new_status = status_for_allocation(row.get("amount"), legs, fallback=fallback)
    something_allocated = new_status in (ROW_SETTLED, ROW_PARTIALLY_ALLOCATED)

    live_legs = [leg for leg in legs if (leg.get("match_kind") or "") == MATCH_SETTLED]
    origin = (
        settlement_origin(row.get("suggested_name"), live_legs[-1]["target_name"])
        if live_legs
        else None
    )

    # See the docstring: the two facts a leg cannot carry, unpacked here so `allocation_note` stays
    # pure. `amount_changed` is what X1 already computes; `original_amount` is `None` on a created
    # record, which had no previous amount to correct.
    created = bool(getattr(result, "created", False))
    correction = (
        (result.original_amount, result.amount)
        if result is not None and getattr(result, "amount_changed", False)
        else None
    )

    frappe.db.set_value(
        ROW_DOCTYPE,
        row_name,
        {
            "row_status": new_status,
            "outcome_note": allocation_note(
                row.get("amount"), legs, new_status, created=created, correction=correction
            ),
            # See the docstring: a fully-reversed row has no decider any more.
            "decided_at": frappe.utils.now_datetime() if something_allocated else None,
            "decided_by": actor if something_allocated else None,
            # See the docstring: only meaningful -- and only written -- once the row is Settled.
            "settlement_origin": origin if new_status == ROW_SETTLED else None,
            # See the docstring: set only by unreconcile, cleared by every settle.
            "confirm_by_hand": 1 if confirm_by_hand else 0,
        },
        update_modified=False,
    )
    return new_status


def link_statement_file_to_target(statement_file_url: str | None, result) -> None:
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
                # ⚠️ RESOLVED, NOT SPELLED (B6). Three ledgers call this field `payment_attachment`
                # and `Project Inflows` calls it `inflow_attachment`; a `File` naming a field the
                # doctype does not have is a link Frappe cannot authorise back to the record --
                # visibly attached, 403 on click, which is the exact failure this function exists to
                # prevent. `settle.statement_attachment_field` is the one answer, shared with
                # `apply_statement_attachment` so the doc field and the File row can never disagree.
                # Byte-identical for the three settle ledgers.
                "attached_to_field": statement_attachment_field(result.doctype),
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


def refresh_batch_rollup(batch: str) -> list:
    """Recompute the batch's counters and status from its rows. `status.py` is the only deriver.

    ⚠️ THERE IS NO CLOSE ANY MORE. `closed_at` was already excluded from the status derivation when
    `Completed with exceptions` was retired; the close ACTION itself went at the 2026-08-10 owner
    ruling (see the note where its endpoints used to be). The field survives on the doctype holding
    the history of batches closed before then, and nothing writes or reads it.
    """
    statuses = row_statuses(batch)
    values = dict(derive_batch_counters(statuses))
    values["status"] = derive_batch_status(statuses)
    frappe.db.set_value(BATCH_DOCTYPE, batch, values, update_modified=False)
    return statuses


def row_statuses(batch: str) -> list:
    """Every row's status in `batch` -- the one input the rollup deriver reads. Reads only."""
    return [
        r["row_status"] or ""
        for r in frappe.db.sql(
            """SELECT row_status FROM "tabOutflow Import Row" WHERE import_batch = %s""",
            (batch,),
            as_dict=True,
        )
    ]
