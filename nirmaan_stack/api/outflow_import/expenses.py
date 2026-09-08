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
    derive_batch_status,
)
from nirmaan_stack.services.outflow_import.ledgers import PAYMENT_DOCTYPE, TARGET_SNAPSHOT_FIELDS
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.amounts import to_decimal
# ⚠️ THE SPLIT LIVES IN `services/payment_split.py`, THE SAME MODULE THE CEO PARTIAL APPROVAL USES,
# and this import is the whole reason it was generalised rather than copied (ADR-0010 B1, slice
# PS-1). Two implementations of the sum invariant and the PO-term surgery, one on either side of
# the app, would drift -- and the drift shows up as a PO whose terms stopped adding up, months
# later, with no way to tell which copy wrote it.
from nirmaan_stack.services.payment_split import split_payment
from nirmaan_stack.services.outflow_import.partial_settle import (
    INTENT_DEDUCTION,
    REFUSAL_NOT_APPROVED,
    REFUSAL_NOT_A_PAYMENT,
    REFUSAL_NOT_POSITIVE,
    REFUSAL_NOT_SERVICE,
    REFUSAL_NOT_SHORT,
    REFUSAL_RATE_OUT_OF_BAND,
    REFUSAL_WITHIN_WINDOW,
    VALID_INTENTS,
    deduction_eligibility,
    partial_eligibility,
)
from nirmaan_stack.services.outflow_import.settle import (
    NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE,
    ExpenseSettlementError,
    create_expense_from_row,
    settle_existing_expense,
    settle_payment,
    statement_attachment_field,
)
from nirmaan_stack.services.outflow_import.status import (
    ORIGIN_ACCEPTED,
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
    ROW_SKIPPED,
    # ⚠️ THE ONE DEFINITION OF THE DIRECTION AXIS, REUSED RATHER THAN RE-SPELLED (ADR-0010 B1).
    # `_guard_is_a_debit` is the exact NEGATION of the receipt side's rule, so it must read the
    # same predicate `status.derive_settled_direction_blocks` sorts settled rows with. A second
    # copy of `direction == "Credit"` here could disagree with that one, and the disagreement
    # would present as money settled on the debit side but reported under `Received`.
    is_received_direction,
    settlement_origin,
)
# ADR-0020 (Task 3): the row's status is now DERIVED from its `Outflow Row Match` legs, never
# written directly by `_record_settlement`. See `_refresh_row_allocation`. `allocation_note` moved
# here from a private `expenses.py` helper at review -- it is pure arithmetic-plus-wording over
# legs, which is this module's job, not `api/`'s.
from nirmaan_stack.services.outflow_import.allocation import (
    MATCH_REVERSED,
    MATCH_SETTLED,
    allocated_of,
    allocation_fits,
    allocation_note,
    is_over_allocated,
    remaining_of,
    status_for_allocation,
)

# The one status a partial settlement reads or writes. Both halves are Approved: the money was
# already sanctioned, and this import re-partitions a sanction rather than creating one.
_APPROVED = "Approved"


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
    # ⚠️ BEFORE THE SAVEPOINT, NOT INSIDE IT. Nothing here needs rolling back -- the point is that
    # a credit never reaches a write at all, in any of the three ledgers this endpoint dispatches
    # across. The same guard sits on `create_expense`; every path in this module that moves money
    # OUT carries it.
    _guard_is_a_debit(doc)
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
        # ⚠️ INSIDE THE SAVEPOINT. The status is derived from the legs, so it must be recomputed in
        # the same transaction that added one -- otherwise a rolled-back settle leaves a row
        # claiming money that was never written.
        _refresh_row_allocation(staged.name, actor)
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
def allocate_row(row: str, targets):
    """Allocate part or all of one bank transfer across several approved Project Payments.

    URL: /api/method/nirmaan_stack.api.outflow_import.expenses.allocate_row

    ⚠️ ONE CALL, N TARGETS, ONE SAVEPOINT -- and that is the opposite of `settle_row`'s
    one-row-per-call rule, deliberately. There, N rows were each DECIDED separately, so partial
    success is the honest shape. Here the N legs are one decision about one transfer: a half-landed
    tick-set leaves a remaining balance nobody can explain, and the reviewer cannot tell which half
    landed without re-reading the match table.

    ⚠️ IT DOES NOT REPLACE `settle_row`, AND THE SCREEN STILL CALLS THAT ONE FOR A SINGLE TICK.
    `settle_row`'s amount guard is STRICT (the record must equal the whole transfer); this one is
    bounded against the REMAINDER, which is necessarily weaker. Keeping both means every settle
    that worked before ADR-0020 takes the identical code path, and the weaker guard is reachable
    only on the new shape.

    ⚠️ WHAT CATCHES A WILDLY WRONG PICK IS NOT A GUARD. A small, wrong payment fits the remainder
    and is allowed. What stops it disappearing is that the row never reaches `Settled` -- it sits
    at `Partially Allocated` with a visible leftover balance, forever, on its own tab. Visible, not
    silent, is the trade this endpoint makes.

    PROJECT PAYMENTS ONLY. Neither expense doctype is offered: `Non Project Expenses` has no
    project column and cannot be corroborated, and an expense fan-out has never been observed.
    Widening it is a separate decision with its own evidence.
    """
    actor = require_outflow_access()
    targets = _parse_targets(targets)
    staged, doc = _load_allocatable_row(row)
    _guard_is_a_debit(doc)
    statement_file_url = _statement_file_url(doc["import_batch"])

    savepoint = f"ofi_alloc_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        legs = _live_legs(staged.name)
        for target in targets:
            amount = _approved_payment_amount(target["target_name"])
            if not allocation_fits(doc["amount"], legs, amount):
                frappe.throw(
                    f"{target['target_name']} is for {amount}, but only "
                    f"{remaining_of(doc['amount'], legs)} of this transfer is unallocated.",
                    title="More than is left",
                )
            result = settle_payment(
                staged,
                target["target_name"],
                actor,
                statement_file_url=statement_file_url,
                transfer_id=staged.transfer_id,
                # ⚠️ THE TWO SWITCHES THAT MAKE A LEG A LEG. See settle_payment's docstring: the
                # bank's figure is the WHOLE transfer, so it must not reach this payment's amount,
                # and the window must be checked against the payment's own figure.
                rewrite_amount_to_bank=False,
                expected_amount=amount,
            )
            _record_settlement(staged, doc, result, actor)
            legs = _live_legs(staged.name)
        if is_over_allocated(doc["amount"], legs):
            frappe.throw(
                f"Those records come to {allocated_of(legs)}, more than the "
                f"{to_decimal(doc['amount'])} this transfer moved.",
                title="More than the transfer",
            )
        new_status = _refresh_row_allocation(staged.name, actor)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    frappe.db.release_savepoint(savepoint)

    statuses = _refresh_batch_rollup(doc["import_batch"])
    frappe.db.commit()
    _link_statement_file_to_target(statement_file_url, result)
    legs = _live_legs(staged.name)
    return {
        "row": row,
        "row_status": new_status,
        "allocated": float(allocated_of(legs)),
        "remaining": float(remaining_of(doc["amount"], legs)),
        "legs": legs,
        "batch_status": derive_batch_status(statuses),
    }


def _parse_targets(targets) -> list:
    """A JSON array of {target_doctype, target_name}. Refuses an empty list and a repeat.

    ⚠️ THE DUPLICATE CHECK IS HERE AS WELL AS IN THE DATABASE. The partial unique index would catch
    it, but as an IntegrityError after the first leg has already written money -- and the savepoint
    would then roll back a settlement the reviewer had every reason to expect.
    """
    if isinstance(targets, str):
        targets = frappe.parse_json(targets)
    if not targets:
        frappe.throw("Select at least one approved payment to allocate.", title="Nothing selected")
    parsed, seen = [], set()
    for target in targets:
        doctype = (target.get("target_doctype") or "").strip()
        name = (target.get("target_name") or "").strip()
        if doctype != PAYMENT_DOCTYPE:
            frappe.throw(
                f"Only {PAYMENT_DOCTYPE} can be allocated from one transfer. "
                f"Settle a '{doctype}' on its own.",
                title="Not a payment",
            )
        if not name:
            frappe.throw("A target payment is required.", title="Missing target")
        if name in seen:
            frappe.throw(f"{name} is selected twice.", title="Repeated record")
        seen.add(name)
        parsed.append({"target_doctype": doctype, "target_name": name})
    return parsed


def _load_allocatable_row(row: str):
    """Like `_load_settleable_row`, but a `Partially Allocated` row is ALLOWED through.

    ⚠️ THAT IS THE ONE DIFFERENCE, AND IT IS WHY THIS IS A SECOND FUNCTION RATHER THAN A FLAG ON
    THE FIRST. `_load_settleable_row` guards the ordinary settle, which must stay unable to reach a
    row that has already written money.
    """
    doc = frappe.db.get_value(ROW_DOCTYPE, row, "*", as_dict=True)
    if not doc:
        frappe.throw(f"Import row '{row}' not found.", title="Not found")
    if doc.get("row_status") == ROW_SETTLED:
        frappe.throw(
            "This transfer is fully allocated. Reverse an allocation to change it.",
            title="Fully allocated",
        )
    if doc.get("row_status") == ROW_SKIPPED:
        frappe.throw(
            "This row was skipped. Re-run the match to reconsider it.", title="Row skipped"
        )
    return _StagedRow(doc), doc


def _live_legs(row_name: str) -> list:
    """This row's Settled match records, oldest first. Always re-read, never cached across a leg."""
    return frappe.db.get_all(
        MATCH_DOCTYPE,
        filters={"import_row": row_name, "match_kind": MATCH_SETTLED},
        fields=["name", "target_doctype", "target_name", "target_amount", "match_kind"],
        order_by="matched_at asc, name asc",
    )


def _approved_payment_amount(name: str):
    """The payment's own figure, read BEFORE the lock so the fit can be judged.

    ⚠️ THIS IS NOT THE AUTHORITY. `settle_payment` re-reads it under `FOR UPDATE` and re-asserts
    everything; this read only decides whether to attempt the leg at all.
    """
    amount = frappe.db.get_value(PAYMENT_DOCTYPE, name, "amount")
    if amount is None:
        frappe.throw(f"Payment '{name}' not found.", title="Not found")
    return normalize_amount(amount)


@frappe.whitelist(methods=["POST"])
def settle_row_partial(row: str, target_name: str, intent: str):
    """Settle PART of an approved payment from this transfer; carry the balance forward (slice PS).

    URL: /api/method/nirmaan_stack.api.outflow_import.expenses.settle_row_partial

    THE CASE IT EXISTS FOR. One approved payment of Rs 5,00,000, paid by the bank as Rs 2,00,000 and
    Rs 3,00,000. Before this, BOTH transfers were unresolvable: `settle_row` refuses each with
    `AmountMismatchError` because the gap is far outside the settle window, and the dialog's only
    other exits are switched off. The record is split first, so each transfer then settles an
    ordinary exact-amount payment through `settle_payment`, UNCHANGED.

    ⚠️ `intent` IS REQUIRED AND HAS NO DEFAULT, AND THAT IS THE PRODUCT OF THIS SLICE. A shortfall
    is EITHER a part payment (the balance is still owed) OR a deduction such as TDS (nothing more is
    owed). Nothing in this system can tell them apart -- `Project Payments.tds` is blank until a
    human writes it at fulfilment -- so the reviewer declares it. Guess it wrong in the part-payment
    direction and this creates an approved payment that will never be paid, inflating what the PO
    thinks it still owes, forever: worse than the dead end it replaces. A missing or unrecognised
    intent throws rather than assuming.

    ⚠️ THERE IS NO `amount` PARAMETER, AND THAT IS THE BIGGEST SAFETY DIFFERENCE FROM THE CEO SPLIT.
    The kept amount IS the bank amount, so the reviewer types no figure -- there is no typo to make
    and no way to keep a number nobody sanctioned.

    ⚠️ THE SPLIT AND THE SETTLE SHARE ONE SAVEPOINT. A split that succeeded with a settle that
    failed would leave a payment partitioned for a settlement that never happened -- recoverable,
    but a document nobody asked for. One savepoint makes that state unreachable.

    ⚠️ THE ELIGIBILITY IS RE-ASSERTED HERE UNDER A ROW LOCK, whatever the screen decided. That is
    the whole reason settlement is routed through this module at all: an expense write in this app
    has zero optimistic-concurrency protection, so a read-check-write across a request boundary is a
    race. `partial_eligibility` is pure and cheap; running it again costs nothing and closes it.

    ⚠️ IT NEVER APPROVES, AND THE TOTAL SANCTIONED AMOUNT IS UNCHANGED. Both halves come out
    `Approved` because the money already was -- the split re-partitions a sanction, it does not
    create one. That is the narrow sense in which the spine "this import never approves" still holds
    (owner ruling R2, 2026-08-12); `settle.py`'s docstring carries the restatement.

    ⚠️ THE BULK CONFIRM CANNOT REACH THIS. It is a different endpoint name that the confirm tree
    never calls, and `get_confirmable_rows` only offers rows carrying a `suggested_name` -- which a
    partial, by construction, does not have. `settle_row` still refuses an out-of-window payment.
    """
    actor = require_outflow_access()

    declared = (intent or "").strip()
    if declared not in VALID_INTENTS:
        frappe.throw(
            "Say whether this is a part payment or a deduction before settling part of a payment.",
            frappe.ValidationError,
            title="No intent given",
        )
    staged, doc = _load_settleable_row(row)
    # ⚠️ THE THIRD MONEY-OUT DOOR, AND IT HAD THE SAME HOLE AS THE OTHER TWO. This one both settles
    # a payment AND performs surgery on a PO's terms, so an unguarded credit would leave a split
    # sanction behind it as well as a wrongly-Paid record. Guarded here rather than only in the two
    # branches below, because both of them spend.
    _guard_is_a_debit(doc)
    statement_file_url = _statement_file_url(doc["import_batch"])
    bank_amount = normalize_amount(doc.get("amount"))

    if declared == INTENT_DEDUCTION:
        return _settle_as_deduction(
            row, staged, doc, target_name, bank_amount, actor, statement_file_url
        )

    savepoint = f"ofi_partial_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        eligibility = _assert_partially_settleable(target_name, bank_amount)
        split = split_payment(
            target_name,
            float(eligibility.keep),
            # The payment is ALREADY Approved -- that is what makes it settleable at all -- and the
            # balance stays Approved because the money stays sanctioned.
            expect_status=_APPROVED,
            remainder_status=_APPROVED,
            # ⚠️ FALSE, AND LOAD-BEARING. `ceo_approval_date` records when the CEO approved this
            # money; `ledgers.DECIDED_ON_SQL` reads exactly that column to decide which record a
            # later transfer was nearest to. Stamping today's date would overwrite an approval fact
            # with a bank fact and quietly re-order every future match against this vendor.
            stamp_ceo_approval=False,
        )
        result = settle_payment(
            staged, target_name, actor, statement_file_url=statement_file_url
        )
        _record_settlement(staged, doc, result, actor)
        # ⚠️ INSIDE THE SAVEPOINT -- see `settle_row`'s call site for why.
        _refresh_row_allocation(staged.name, actor)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    frappe.db.release_savepoint(savepoint)

    statuses = _refresh_batch_rollup(doc["import_batch"])
    frappe.db.commit()
    _link_statement_file_to_target(statement_file_url, result)
    _record_partial_provenance(staged, split, declared)

    summary = _summary(row, result, doc["import_batch"], statuses)
    summary["partial"] = {
        "remainder_payment": split["remainder_payment"],
        "remainder_amount": float(split["remainder_amount"]),
        "original_amount": float(split["original_amount"]),
    }
    return summary


def _settle_as_deduction(
    row: str, staged, doc, target_name: str, bank_amount, actor: str, statement_file_url
):
    """Record the shortfall as TDS on the payment and settle it in full (slice TD).

    ⚠️ THIS BRANCH USED TO THROW, and the throw was right until the owner ruled otherwise on
    2026-08-12. What changed is narrow: on a `Service Requests` payment whose shortfall lands in the
    0.95-2.05% band, the deduction is DERIVED (`amount - bank`, forced by arithmetic) and written.
    Everywhere else this still routes to the payments screen, because a figure this import cannot
    derive is one it must not invent.

    ⚠️ NO SPLIT HAPPENS HERE. A deduction means the payment was settled IN FULL and something was
    withheld -- there is no balance and nothing is owed. Creating one would be the phantom the whole
    partial-settlement slice exists to avoid, pointed the other way.

    ⚠️ THE AMOUNT IS UNTOUCHED. `settle_payment` skips `rewrite_amount` on this path; the record
    keeps the invoiced figure and `tds` carries the withholding, exactly as `_fulfil_payment` does
    it. That is what keeps `bank = amount - tds` true for every reader of this ledger.
    """
    savepoint = f"ofi_tds_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        eligibility = _assert_deduction_recordable(target_name, bank_amount)
        result = settle_payment(
            staged,
            target_name,
            actor,
            statement_file_url=statement_file_url,
            tds=eligibility.tds,
        )
        _record_settlement(staged, doc, result, actor)
        # ⚠️ INSIDE THE SAVEPOINT -- see `settle_row`'s call site for why.
        _refresh_row_allocation(staged.name, actor)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    frappe.db.release_savepoint(savepoint)

    statuses = _refresh_batch_rollup(doc["import_batch"])
    frappe.db.commit()
    _link_statement_file_to_target(statement_file_url, result)
    _record_deduction_provenance(staged, result, eligibility)

    summary = _summary(row, result, doc["import_batch"], statuses)
    summary["deduction"] = {
        "tds": float(eligibility.tds),
        "implied_pct": float(eligibility.implied_pct),
    }
    return summary


def _assert_deduction_recordable(target_name: str, bank_amount):
    """Re-read the payment UNDER A ROW LOCK and re-assert the whole deduction gate.

    ⚠️ THE PARENT DOCTYPE IS READ HERE, NOT TAKEN FROM THE CLIENT. The service rule is the only
    thing standing between this path and a materials PO, and a payload field is not evidence -- the
    screen mirrors the gate for UX and the server decides.

    ⚠️ `tds` IS NOT READ. It is empty on an approved payment by rule, and the rows that carry one are
    residue from an un-fulfil that bypassed the document lifecycle. The figure is derived from this
    transfer, every time -- see `partial_settle.deduction_eligibility`.
    """
    current = frappe.db.get_value(
        PAYMENT_DOCTYPE,
        target_name,
        ["status", "amount", "document_type"],
        as_dict=True,
        for_update=True,
    )
    if not current:
        frappe.throw(f"Payment '{target_name}' not found.", title="Not found")

    eligibility = deduction_eligibility(
        current.get("amount"),
        bank_amount,
        PAYMENT_DOCTYPE,
        current.get("status") or "",
        current.get("document_type") or "",
    )
    if not eligibility.eligible:
        frappe.throw(
            _DEDUCTION_REFUSALS.get(
                eligibility.refusal,
                "This shortfall cannot be recorded as TDS from a bank statement.",
            ),
            frappe.ValidationError,
            title="Not recordable here",
        )
    return eligibility


def _record_deduction_provenance(staged, result, eligibility) -> None:
    """Say on the payment what was recorded and on whose say-so. After the commit.

    ⚠️ THE DECLARED INTENT IS WRITTEN DOWN. The alternative reading of the same shortfall -- a part
    payment -- would have produced a balance carried forward, so someone reading this payment later
    needs to see that a person asserted the money was WITHHELD, not still owed.

    ⚠️ IT ALSO NAMES THE RATE. That is what makes the figure checkable at a glance against the
    contract, and it is the number the gate turned on.

    Best effort, never fatal, and after the commit -- same reasoning as
    `_link_statement_file_to_target`: the money is written and the row is `Settled` by the time this
    runs, so a failure here must not report a successful settlement as an error.
    """
    tds = frappe.format_value(float(eligibility.tds), "Currency")
    amount = frappe.format_value(float(result.amount), "Currency")
    reference = (getattr(staged, "bank_reference_no", "") or "").strip() or "a bank transfer"
    try:
        frappe.get_doc(PAYMENT_DOCTYPE, result.name).add_comment(
            "Comment",
            text=(
                f"Settled from a bank statement ({reference}). The reviewer recorded the shortfall "
                f"as a DEDUCTION of {tds} — {eligibility.implied_pct:.2f}% of the payment — so the "
                f"amount stays {amount} and nothing further is owed."
            ),
        )
    except Exception:
        frappe.log_error(
            title=f"Outflow import: could not comment on a TDS settle ({result.name})",
            message=frappe.get_traceback(),
        )


def _assert_partially_settleable(target_name: str, bank_amount):
    """Re-read the payment UNDER A ROW LOCK and re-assert the whole gate. Returns the eligibility.

    ⚠️ `for_update=True` WITHOUT `cache=True`, for the reason `settle.py` gives at length: Frappe
    skips the lock entirely when the value comes from cache, which would make this decorative. The
    lock is taken here and `split_payment` takes it again a moment later inside the same
    transaction -- a re-entrant lock on the same row, which PostgreSQL grants immediately.
    """
    current = frappe.db.get_value(
        PAYMENT_DOCTYPE, target_name, ["status", "amount"], as_dict=True, for_update=True
    )
    if not current:
        frappe.throw(f"Payment '{target_name}' not found.", title="Not found")

    eligibility = partial_eligibility(
        current.get("amount"), bank_amount, PAYMENT_DOCTYPE, current.get("status") or ""
    )
    if not eligibility.eligible:
        frappe.throw(
            _PARTIAL_REFUSALS.get(
                eligibility.refusal,
                "This record cannot be partially settled from a bank statement.",
            ),
            frappe.ValidationError,
            title="Cannot be split",
        )
    return eligibility


# One sentence per named refusal, so a reviewer is told which rule stopped them rather than a
# single message covering five different situations -- the mistake `_fulfil_payment` makes.
_PARTIAL_REFUSALS = {
    REFUSAL_NOT_A_PAYMENT: (
        "Only an approved payment can be settled in parts. An expense has no balance to carry."
    ),
    REFUSAL_NOT_APPROVED: (
        "This payment is not Approved, so nothing about it can be settled from a statement."
    ),
    REFUSAL_NOT_SHORT: (
        "This transfer is not smaller than the record, so there is no balance to carry forward."
    ),
    REFUSAL_WITHIN_WINDOW: (
        "These amounts are close enough to settle outright. Use Confirm rather than splitting."
    ),
    REFUSAL_NOT_POSITIVE: (
        "A refund or a zero-value payment cannot be settled in parts."
    ),
}

# The deduction path's refusals: every shape refusal above, plus the two that are its own.
#
# ⚠️ DEFINED AFTER `_PARTIAL_REFUSALS`, AND THAT IS NOT COSMETIC. It reads that dict at MODULE LOAD,
# so declaring it beside `_settle_as_deduction` -- where it belongs by topic -- raises `NameError`
# on import and takes the whole endpoint module down with it. Placement follows the dependency here,
# not the narrative.
#
# ⚠️ THE TWO TD-SPECIFIC SENTENCES BOTH NAME THE RULE AND POINT SOMEWHERE ELSE. A reviewer meets
# both often -- a materials PO, or a 40% gap -- and can do nothing about either from this screen,
# so a bare "not allowed" would strand them.
_DEDUCTION_REFUSALS = dict(
    _PARTIAL_REFUSALS,
    **{
        REFUSAL_NOT_SERVICE: (
            "TDS is recorded here only on service payments. Record this one in the payments "
            "screen. Nothing has been recorded."
        ),
        REFUSAL_RATE_OUT_OF_BAND: (
            "Only a shortfall of about 1-2% can be recorded as TDS here. Record this one in the "
            "payments screen. Nothing has been recorded."
        ),
    },
)


def _record_partial_provenance(staged, split: dict, declared_intent: str) -> None:
    """Say on BOTH halves what happened and what the reviewer declared. After the commit.

    ⚠️ THE DECLARED INTENT IS WRITTEN DOWN, not merely implied by a balance existing. Someone
    reading this payment in six months needs to know a person asserted "the rest is still owed" --
    that is the judgement the whole slice rests on, and the alternative reading (a deduction) would
    have produced no balance at all.

    ⚠️ BEST EFFORT, NEVER FATAL, and after the commit for the same reason
    `_link_statement_file_to_target` is: the money is written and the row is `Settled` by the time
    we get here. Failing now would report a settlement that succeeded as an error, and the caller
    would retry it against a payment that is already Paid. Modelled on
    `api/payments/project_payments._post_split_side_effects`, which treats its comments the same way.
    """
    kept = frappe.format_value(split["approved_amount"], "Currency")
    balance = frappe.format_value(split["remainder_amount"], "Currency")
    original = frappe.format_value(split["original_amount"], "Currency")
    reference = (getattr(staged, "bank_reference_no", "") or "").strip() or "a bank transfer"

    for name, text in (
        (split["approved_payment"], (
            f"Partially settled from a bank statement: {kept} of {original} left the bank "
            f"({reference}). The reviewer recorded this as a PART PAYMENT, so the balance of "
            f"{balance} was carried forward as {split['remainder_payment']} and stays approved."
        )),
        (split["remainder_payment"], (
            f"Balance of {balance} carried forward from {split['approved_payment']}, of which "
            f"{kept} was settled by {reference}. Still approved and still owed."
        )),
    ):
        try:
            frappe.get_doc(PAYMENT_DOCTYPE, name).add_comment("Comment", text=text)
        except Exception:
            frappe.log_error(
                title=f"Outflow import: could not comment on a partial settle ({name})",
                message=frappe.get_traceback(),
            )


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
    # ⚠️ THE SAME GUARD `settle_row` CARRIES, AND IT MATTERS AT LEAST AS MUCH HERE. A settle at
    # least has an approved record in front of it that somebody sanctioned; this path CREATES a
    # `Paid` expense out of the bank row alone, so an unguarded credit would mint a brand-new
    # payment-out document for money that arrived.
    _guard_is_a_debit(doc)
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
        # ⚠️ INSIDE THE SAVEPOINT -- see `settle_row`'s call site for why.
        _refresh_row_allocation(staged.name, actor)
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


def _guard_is_a_debit(doc) -> None:
    """Refuse a bank CREDIT on a path that spends money, before anything else is read.

    ⚠️ THE MIRROR OF `inflows._guard_is_a_credit`, AND IT CLOSES THE SAME HOLE FROM THE OTHER SIDE.
    Until this existed, `_load_settleable_row` checked only `row_status`, so a Credit row -- money
    the bank put INTO the account -- could be settled against an approved `Project Payment` or
    turned into a Paid expense. That is not a mismatch anybody would notice: the payment goes Paid,
    the transfer goes Settled, and both figures agree. Only the DIRECTION is wrong, and nothing on
    either screen states it.

    ⚠️ IT IS THE EXACT NEGATION OF ONE PREDICATE, NOT A SECOND RULE. `is_received_direction` is the
    single POSITIVE test that partitions every settled row into Received and Paid; asking it here is
    what keeps the write and the reporting on one definition. Re-spelling `direction == "Credit"`
    would be a second copy free to drift from the block the row is later counted in.

    ⚠️ A BLANK DIRECTION PASSES, AND THAT IS THE WHOLE REASON THE TEST IS POSITIVE. Cashfree and
    Cashbook state no direction at all -- blank means "the statement did not say", never "this is a
    receipt" -- so refusing a blank would refuse every gateway row this feature was built for.
    `is_received_direction` reads a blank as Paid for the same reason, and the two agree by
    construction rather than by two functions happening to make the same choice.

    ⚠️ THERE IS NO SERVICE TWIN ON THIS SIDE, AND THAT IS A STATEMENT OF FACT RATHER THAN A CLAIM OF
    SYMMETRY. `settle_payment`, `settle_existing_expense` and `create_expense_from_row` take no
    `direction` argument at all, so there is nothing in the service layer for the value to be
    re-checked against -- unlike the credit paths, where the direction chooses a SIGN and the
    service therefore has to see it.
    """
    if not is_received_direction(doc.get("direction")):
        return
    # ⚠️ THE REFUSAL NAMES THE RULE IT BROKE AND THE ROUTE THAT IS RIGHT (the D1 register). A bare
    # "invalid direction" would leave a reviewer with a row they cannot dispose of and no idea that
    # the two credit dispositions exist one tab away.
    frappe.throw(
        "Only a debit can settle an approved record or be recorded as an expense. This transfer "
        "is a credit, so it brought money IN -- record it as a project inflow or as a "
        "non-project receipt instead.",
        ExpenseSettlementError,
        title="Not a debit",
    )


def _record_settlement(staged, doc, result, actor) -> None:
    """The import-side half: the match record. THE ROW'S OWN STATUS IS NO LONGER WRITTEN HERE.

    ⚠️ THE FLIP MOVED TO `_refresh_row_allocation` (ADR-0020). It used to set `row_status` to
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
            # ⚠️ NET, NOT `result.amount`, AND THIS IS WHY THE SUBTRACTION EXISTS. On the TDS-
            # deduction path (`settle.py:_settle_as_deduction` / `settle_payment(..., tds=...)`)
            # `result.amount` is deliberately the GROSS approved figure -- the record itself is
            # never rewritten, and `result.tds_written` carries the withheld part separately (see
            # `SettleResult`'s own docstring). `target_amount` means "how much of THIS TRANSFER went
            # to this target", and the bank only ever moved `amount - tds`. Writing the gross here
            # would claim the transfer covered money it never sent: `remaining_of` would read
            # negative and `is_over_allocated` would read permanently true for every TDS-touched
            # row, invisible only as long as nothing downstream (Task 4's `allocation_fits`, the
            # partial branch of `allocation.allocation_note`) actually reads the balance. The gross stays
            # fully auditable on the payment itself (`amount` plus `tds`); nothing needs a second
            # field for it here.
            "target_amount": float(result.amount - (result.tds_written or 0)),
            "match_kind": MATCH_SETTLED,
            # The tier that FOUND the counterpart, or "Manual" when the matcher found nothing and
            # the person went looking. ⚠️ Two DIFFERENT questions live side by side here -- this one
            # is "how was it found", `settlement_origin` is "did a person accept that". A row can be
            # `account+IFSC` + `Suggestion overridden`: the matcher found something on a strong
            # tier and the reviewer still chose otherwise.
            "match_basis": (doc.get("match_basis") or "").strip() or "Manual",
            "settlement_origin": origin,
            "matched_at": frappe.utils.now_datetime(),
            "matched_by": actor,
            # SNAPSHOTS at allocation time -- never recomputed. See the field descriptions.
            **_target_snapshot(result.doctype, result.name),
        }
    )
    match.insert(ignore_permissions=True)


def _target_snapshot(doctype: str, name: str) -> dict:
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


def _refresh_row_allocation(row_name: str, actor: str) -> str:
    """Recompute a row's allocation from its legs and write the derived status. Returns it.

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

    frappe.db.set_value(
        ROW_DOCTYPE,
        row_name,
        {
            "row_status": new_status,
            "outcome_note": allocation_note(row.get("amount"), legs, new_status),
            # See the docstring: a fully-reversed row has no decider any more.
            "decided_at": frappe.utils.now_datetime() if something_allocated else None,
            "decided_by": actor if something_allocated else None,
            # See the docstring: only meaningful -- and only written -- once the row is Settled.
            "settlement_origin": origin if new_status == ROW_SETTLED else None,
        },
        update_modified=False,
    )
    return new_status


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
