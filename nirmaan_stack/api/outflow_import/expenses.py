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

from contextlib import contextmanager
from typing import NamedTuple

import frappe

from nirmaan_stack.api.outflow_import.permissions import (
    require_outflow_access,
    require_outflow_undo_access,
)
from nirmaan_stack.api.outflow_import.review import (
    BATCH_DOCTYPE,
    MATCH_DOCTYPE,
    ROW_DOCTYPE,
    _StagedRow,
    _recorded_money_group,
    _refresh_batch_rollup,
    derive_batch_status,
)
from nirmaan_stack.services.outflow_import.ledgers import PAYMENT_DOCTYPE, TARGET_SNAPSHOT_FIELDS
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.amounts import to_decimal
from nirmaan_stack.services.outflow_import.concurrency import is_concurrent_writer_refusal
# ⚠️ THE SPLIT LIVES IN `services/payment_split.py`, THE SAME MODULE THE CEO PARTIAL APPROVAL USES,
# and this import is the whole reason it was generalised rather than copied (ADR-0010 B1, slice
# PS-1). Two implementations of the sum invariant and the PO-term surgery, one on either side of
# the app, would drift -- and the drift shows up as a PO whose terms stopped adding up, months
# later, with no way to tell which copy wrote it.
from nirmaan_stack.services.payment_split import split_payment
from nirmaan_stack.services.outflow_import.partial_settle import (
    REFUSAL_NOT_APPROVED,
    REFUSAL_NOT_A_PAYMENT,
    REFUSAL_NOT_POSITIVE,
    REFUSAL_NOT_SHORT,
    REFUSAL_WITHIN_WINDOW,
    VALID_INTENTS,
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
    RECORDED_DUPLICATE,
    derive_recorded_money_verdict,
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


# ⚠️ OWNER'S WORDING (issue #1246, 2026-09-11): "just put a message about some other user might
# have resolved this". It says what happened and what is now true -- and NOTHING about reopening or
# retrying, because re-reading the transfer and carrying ticks over were both DEFERRED by the same
# ruling. Do not grow it into instructions without that decision.
#
# ONE SENTENCE FOR BOTH WRITE PATHS (#1250). It says "transfer", never "allocation" or "split", so
# it reads true on `settle_row`'s single tick too -- which writes an allocation leg of its own.
CONCURRENT_ALLOCATION_MESSAGE = (
    "Another user may have already resolved this transfer, so nothing you selected was saved."
)


class MoneyAlreadyRecordedError(frappe.ValidationError):
    """This line's money is already recorded, so the match run would SKIP it (#1260). Nothing written."""


class RecordedMoneyNeedsConfirmationError(frappe.ValidationError):
    """A record carries this line's reference but the match run would leave it MISMATCHED (#1260).

    ⚠️ THE SCREEN KEYS ON THIS CLASS NAME (`exc_type`) to offer "... anyway?" and re-call with
    `confirm_mismatch`. Renaming it silently turns the confirmation into a plain refusal.
    """


class ConcurrentAllocationError(frappe.ValidationError):
    """Another reviewer's write on the same transfer committed first (issues #1246, #1250).

    A `ValidationError` so it reaches the screen through `_server_messages` like every other
    deliberate refusal here -- a bare exception arrives as raw `exception` text, which is the defect.
    """


@contextmanager
def _concurrent_writer_refusal_as_sentence(endpoint: str, row: str):
    """Turn a concurrent writer's refusal -- and ONLY that -- into `CONCURRENT_ALLOCATION_MESSAGE`.

    The one shared boundary for `allocate_row` (#1246) and `settle_row` (#1250), so the two
    endpoints cannot drift into two wordings, two log lines or two definitions of "a race".

    ⚠️ WRAP ONLY THE WORK UP TO AND INCLUDING THE COMMIT. The sentence says nothing was saved;
    after the commit everything was, so a failure in the post-commit steps must stay itself.

    ⚠️ EVERY OTHER FAILURE PROPAGATES UNCHANGED. `is_concurrent_writer_refusal` says no to
    everything else, so a genuinely different fault is never reported as a harmless race.
    """
    try:
        yield
    except Exception as exc:
        if not is_concurrent_writer_refusal(exc):
            raise
        # The refusal is now a sentence the screen shows and Frappe does not log, so this line is
        # the only server-side trace that two reviewers raced on this transfer. ⚠️ `.error`, NOT
        # `.warning`: outside the dev server Frappe's logger level defaults to ERROR
        # (`frappe/utils/logger.py`), so a warning here would be dropped in production -- measured,
        # the first draft's warning wrote nothing from a plain bench process.
        frappe.logger("outflow_import").error(
            f"{endpoint}: concurrent writer on import row {row}, refused: {exc}"
        )
        # The loser's transaction is already aborted by Postgres; roll it back explicitly so nothing
        # after this point runs inside a dead transaction. Nothing of the loser's was written.
        frappe.db.rollback()
        frappe.throw(
            CONCURRENT_ALLOCATION_MESSAGE,
            title="Changed elsewhere",
            exc=ConcurrentAllocationError,
        )


@frappe.whitelist(methods=["POST"])
def settle_row(row: str, target_doctype: str, target_name: str, confirm_mismatch=False):
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

    ⚠️ THE SAME ONE DATABASE FAILURE IS TRANSLATED HERE AS ON `allocate_row` (issue #1250), through
    the same `_concurrent_writer_refusal_as_sentence`. Two reviewers on one transfer, and this one
    commits second: Postgres refuses it with a `SerializationFailure`, and it now reads "another
    user may have already resolved this transfer". In a bulk confirm that sentence lands on the ONE
    row that lost, prefixed with its name; each row is its own request and its own transaction, so
    the translation's full rollback can never reach another row's outcome.

    ⚠️ NO ROW LOCK WAS ADDED, ON PURPOSE. This path locks the PAYMENT first and `allocate_row` locks
    the ROW first; taking the row here too would invert that order and invite deadlocks. That is
    its own decision, not a message fix. So the refusal lands LATE (measured, ADR-0020 B4a), and
    where both payments sit on one PO it reaches this boundary as the untranslatable
    `InFailedSqlTransaction` instead -- `update_parent_amount_paid` swallows the 40001 first.
    """
    with _concurrent_writer_refusal_as_sentence("settle_row", row):
        done = _settle_and_commit(row, target_doctype, target_name, confirm_mismatch)
    _link_statement_file_to_target(done.statement_file_url, done.result)
    return _summary(row, done.result, done.batch, done.batch_statuses)


class _CommittedSettle(NamedTuple):
    """What `_settle_and_commit` hands back for the post-commit steps `settle_row` runs."""

    result: object
    statement_file_url: str | None
    batch: str
    batch_statuses: list


def _settle_and_commit(
    row: str, target_doctype: str, target_name: str, confirm_mismatch=False
) -> _CommittedSettle:
    """The settle itself, up to and including the commit. `settle_row` above is its whitelisted
    boundary and the one place a concurrent writer's refusal is turned into a sentence."""
    actor = require_outflow_access()
    staged, doc = _load_settleable_row(row)
    # ⚠️ BEFORE THE SAVEPOINT, NOT INSIDE IT. Nothing here needs rolling back -- the point is that
    # a credit never reaches a write at all, in any of the three ledgers this endpoint dispatches
    # across. The same guard sits on `create_expense`; every path in this module that moves money
    # OUT carries it.
    _guard_is_a_debit(doc)
    _guard_money_not_recorded(
        staged, doc, confirm_mismatch, writing=[(target_doctype, target_name)]
    )
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
        #
        # ⚠️ `result` IS PASSED (review F2) SO THE NOTE CAN STILL DISCLOSE AN AMOUNT CORRECTION.
        # This is the ONE path that rewrites an approved figure to the bank's (slice X1), and the
        # note is the only place on this screen that fact survives.
        _refresh_row_allocation(staged.name, actor, result)
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
    return _CommittedSettle(
        result=result,
        statement_file_url=statement_file_url,
        batch=doc["import_batch"],
        batch_statuses=statuses,
    )


@frappe.whitelist(methods=["POST"])
def allocate_row(row: str, targets, confirm_mismatch=False):
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

    ⚠️ ONE DATABASE FAILURE IS TRANSLATED AT THIS BOUNDARY, AND ONLY ONE (issue #1246). When two
    reviewers allocate against the same transfer, the loser is refused by Postgres with a
    `SerializationFailure` (ADR-0020 Amendment B2). That refusal is correct and is NOT relaxed here --
    only its wording changes, to `CONCURRENT_ALLOCATION_MESSAGE`. Every other failure, database or
    not, propagates exactly as before: `is_concurrent_writer_refusal` says no to everything else, so
    a genuinely different fault can never be reported as a harmless race.

    ⚠️ THE TRANSLATION ENDS AT THE COMMIT (code review, #1246). The sentence says nothing was saved;
    after the commit everything was, so a failure in the post-commit linking stays itself. Both
    rules live in `_concurrent_writer_refusal_as_sentence`, shared with `settle_row` (#1250).
    """
    with _concurrent_writer_refusal_as_sentence("allocate_row", row):
        done = _allocate_and_commit(row, targets, confirm_mismatch)

    # After the commit and outside the savepoint, same reasoning as every other call site of this
    # function: it never raises, so looping over every leg's result is safe.
    for result in done.results:
        _link_statement_file_to_target(done.statement_file_url, result)
    legs = _live_legs(row)
    return {
        "row": row,
        "row_status": done.row_status,
        "allocated": float(allocated_of(legs)),
        "remaining": float(remaining_of(done.amount, legs)),
        "legs": legs,
        "batch_status": derive_batch_status(done.batch_statuses),
    }


class _CommittedAllocation(NamedTuple):
    """What `_allocate_and_commit` hands back for the post-commit steps `allocate_row` runs."""

    amount: object
    results: list
    statement_file_url: str
    row_status: str
    batch_statuses: list


def _allocate_and_commit(row: str, targets, confirm_mismatch=False) -> _CommittedAllocation:
    """The allocation itself, up to and including the commit. `allocate_row` above is its
    whitelisted boundary and the one place a concurrent writer's refusal is turned into a sentence."""
    actor = require_outflow_access()
    targets = _parse_targets(targets)
    # ⚠️ THIS TAKES A `FOR UPDATE` ROW LOCK, AND IT SERIALISES ALLOCATION AGAINST ONE TRANSFER
    # (review F1). The per-leg `allocation_fits` below cannot: `_live_legs` reads this
    # transaction's SNAPSHOT and is blind to another transaction's legs, so two reviewers on the
    # same transfer each fit against a picture missing the other's. Held to the commit; see
    # `_load_allocatable_row`'s docstring for the isolation level this actually runs at (MEASURED,
    # and not the one the first draft of this note named), the lock order, and what the lock does
    # and does not buy.
    staged, doc = _load_allocatable_row(row)
    _guard_is_a_debit(doc)
    # Under the row lock `_load_allocatable_row` just took, so the verdict is read on a row nobody
    # else can be allocating against.
    _guard_money_not_recorded(
        staged,
        doc,
        confirm_mismatch,
        writing=[(PAYMENT_DOCTYPE, t["target_name"]) for t in targets],
    )
    statement_file_url = _statement_file_url(doc["import_batch"])

    savepoint = f"ofi_alloc_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    # ⚠️ EVERY LEG'S RESULT, NOT JUST THE LAST ONE (fixed at review, Task 4). `settle_payment`
    # calls `apply_statement_attachment` on EVERY leg, so all N payments end up POINTING at the
    # private statement file -- but only a `File` row per target actually lets that link OPEN for
    # someone who cannot read the import batch (see `_link_statement_file_to_target`'s own
    # docstring). Linking off a single post-loop `result` gave N-1 of N allocated payments a link
    # that 403s: visibly attached, refuses to open.
    results = []
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
            results.append(result)
            _record_settlement(staged, doc, result, actor)
            legs = _live_legs(staged.name)
        # ⚠️ A BACKSTOP THAT THE ROW LOCK MAKES UNREACHABLE SINGLE-THREADED, AND IT STAYS (review
        # F1). With the lock held, every `allocation_fits` above was judged against legs nobody else
        # could be adding to, so the sum cannot end this loop negative. It is kept because it is the
        # only assertion here that reads the FINAL sum rather than a per-leg fit -- it is what would
        # catch a change to `allocation_fits`'s arithmetic, or a lock that later gets weakened or
        # dropped. Do not delete it as dead code.
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
    return _CommittedAllocation(
        amount=doc["amount"],
        results=results,
        statement_file_url=statement_file_url,
        row_status=new_status,
        batch_statuses=statuses,
    )


@frappe.whitelist(methods=["POST"])
def reverse_allocation(match: str, reason: str):
    """Undo one leg of an allocation. The match record is KEPT and stamped.

    URL: /api/method/nirmaan_stack.api.outflow_import.expenses.reverse_allocation

    ⚠️ A WRAPPER SINCE #1271. The decision ("can this leg be undone?") lives in the pure
    `services/outflow_import/unreconcile.py`, and the write in `api/outflow_import/unreconcile.py`'s
    `unreconcile_row`, called here with ONE leg -- so there is one write path for a reversal. This
    keeps the endpoint's arguments, response and every refusal sentence exactly as they were; what
    changed underneath is that the verdict is now read under a row lock as well as the payment
    lock, and a concurrent writer's refusal arrives as `CONCURRENT_ALLOCATION_MESSAGE` instead of
    raw database text.

    ⚠️ SOFT, NOT A DELETE (ADR-0020 D3). A deleted record loses the fact that this was tried and
    undone. The reversed leg stops contributing to `allocated_of` and stops holding the partial
    unique key, so the same payment can be allocated again.

    ⚠️ A REASON IS REQUIRED. A decision that moves money has to say why.

    ⚠️ RULING O: ANY settle path's Project-Payments leg reaches this, including `settle_row`'s, which
    may have rewritten the payment's amount to the bank's figure (slice X1). That is undetectable
    after the fact and ACCEPTED -- the corrected figure survives -- so `reversed_amount` (the leg's
    own figure) is returned for a human to compare against the payment's Version log. The two cases
    that are NOT accepted, a `tds` figure and either half of a split, are refused by the decision
    module; its docstring says why.
    """
    # ⚠️ A FUNCTION-LOCAL IMPORT, BECAUSE `api/outflow_import/unreconcile.py` IMPORTS THIS MODULE
    # (the shared row-allocation and concurrency helpers live here). Moving it to the top is a cycle.
    from nirmaan_stack.api.outflow_import.unreconcile import REASON_REQUIRED, unreconcile_row

    # ⚠️ ADMIN + ACCOUNTANT LEAD SINCE #1273 (parent #1270 Q1). A plain Accountant matches and
    # confirms; undoing money is not theirs. `unreconcile_row` checks the same gate again.
    require_outflow_undo_access()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw(REASON_REQUIRED, title="Missing reason")

    row = frappe.db.get_value(MATCH_DOCTYPE, match, "import_row")
    if not row:
        frappe.throw(f"Match record '{match}' not found.", title="Not found")

    done = unreconcile_row(row=row, legs=[match], reason=reason)
    leg = done["reversed"][0]
    return {
        "match": leg["match"],
        "row": done["row"],
        "row_status": done["row_status"],
        "allocated": done["allocated"],
        "remaining": done["remaining"],
        "reversed_amount": leg["reversed_amount"],
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


# ⚠️ ONE SENTENCE FOR BOTH REFUSALS (`_load_allocatable_row`, `_load_settleable_row`), AND IT MUST
# NOT PROMISE A REMEDY THAT DOES NOT EXIST (#1253). It used to say "Re-run the match to reconsider
# it" -- but `Skipped` is in `review._FROZEN_ROW_STATUSES`, so a re-run never revisits the row, and
# there is no unskip action on the screen. The only way back is an admin editing the row in Desk.
SKIPPED_ROW_REFUSAL = (
    "This row was skipped, and a skip is final: re-running the match does not reopen it. "
    "If it was skipped by mistake, an admin must correct it in Desk."
)


def _load_allocatable_row(row: str):
    """Like `_load_settleable_row`, but a `Partially Allocated` row is ALLOWED through.

    ⚠️ THAT IS THE ONE DIFFERENCE, AND IT IS WHY THIS IS A SECOND FUNCTION RATHER THAN A FLAG ON
    THE FIRST. `_load_settleable_row` guards the ordinary settle, which must stay unable to reach a
    row that has already written money.

    ⚠️ `for_update=True` -- THIS READ TAKES THE ROW LOCK THAT SERIALISES ALLOCATION AGAINST ONE
    TRANSFER (whole-branch review, F1). The per-leg `allocation_fits` check cannot do it, and the
    reason is isolation, not arithmetic: `_live_legs` re-reads this transaction's SNAPSHOT and
    cannot see another transaction's legs. Two reviewers ticking DIFFERENT payments on the same
    transfer therefore each measure the remainder against a picture with the other's legs missing,
    and the `is_over_allocated` backstop after the loop is per-transaction and equally blind.
    Nothing else in place covers that: `settle_payment`'s own `FOR UPDATE` stops the SAME payment
    being settled twice and the partial unique index stops the same (transfer, target) pair twice;
    neither sees two DIFFERENT payments racing onto one transfer.

    ⚠️ THE ISOLATION LEVEL IS **REPEATABLE READ**, NOT READ COMMITTED, AND THIS NOTE SAID
    OTHERWISE UNTIL IT WAS MEASURED (ADR-0020 Amendment B, 2026-09-10). Frappe sets it on the
    SESSION: `SHOW transaction_isolation` returns `repeatable read` from a bench connection while
    the server's `default_transaction_isolation` is `read committed`, so reading the server
    setting -- or assuming Postgres's default -- gets it wrong. The blindness above is real either
    way; the CONSEQUENCE is not.

    ⚠️ SO THE LOCK IS NOT WHAT STANDS BETWEEN THIS FEATURE AND A SILENT OVER-ALLOCATION HERE --
    SNAPSHOT ISOLATION IS -- AND THE LOCK IS KEPT ANYWAY. Measured with two processes racing one
    Rs 100 transfer, a different Rs 60 payment in each, the first holding its transaction open
    (Amendment B): with the lock, the second BLOCKS at this read and then fails
    `SerializationFailure`, and the row is left at 60 of 100. With `for_update` REMOVED, the second
    still writes nothing -- Postgres refuses its UPDATE of a row the winner has already updated --
    but it discovers this LATE, after doing its work, and surfaces as `InFailedSqlTransaction:
    current transaction is aborted`, which names nothing a reader could act on. What the lock buys
    is the SHAPE of the loss: early, at the one read that decides eligibility, before any payment
    is touched. It is also the only guard that would survive a move to READ COMMITTED, where the
    original silent over-allocation WOULD be reachable. Do not remove it on the grounds that the
    database already refuses.

    ⚠️ THE `SerializationFailure` IS NOW A SENTENCE; THE LOCKLESS `InFailedSqlTransaction` IS NOT,
    ON PURPOSE (issue #1246, closing Amendment B4). `allocate_row` translates the refusal THIS read
    raises into "another user may have already resolved this transfer". The lockless shape stays raw
    because it carries no cause -- any earlier swallowed error produces it too -- which is one more
    reason the lock must stay: it is what makes the race fail as the one error that CAN be named.

    ⚠️ THE LOCK IS TAKEN IN THE SAME READ THAT DECIDES ELIGIBILITY, not before or after it -- a
    status read outside the lock is a stale status -- and it is held to the request's commit, since
    `allocate_row` opens only a savepoint after this. LOCK ORDER IS ROW THEN PAYMENT here; if a
    concurrent `settle_row` (which takes the payment first) ever contends for the same pair,
    Postgres aborts one, loudly and rolled back.
    """
    doc = frappe.db.get_value(ROW_DOCTYPE, row, "*", as_dict=True, for_update=True)
    if not doc:
        frappe.throw(f"Import row '{row}' not found.", title="Not found")
    if doc.get("row_status") == ROW_SETTLED:
        frappe.throw(
            "This transfer is fully allocated. Reverse an allocation to change it.",
            title="Fully allocated",
        )
    if doc.get("row_status") == ROW_SKIPPED:
        frappe.throw(SKIPPED_ROW_REFUSAL, title="Row skipped")
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
def settle_row_partial(row: str, target_name: str, intent: str, confirm_mismatch=False):
    """Settle PART of an approved payment from this transfer; carry the balance forward (slice PS).

    URL: /api/method/nirmaan_stack.api.outflow_import.expenses.settle_row_partial

    THE CASE IT EXISTS FOR. One approved payment of Rs 5,00,000, paid by the bank as Rs 2,00,000 and
    Rs 3,00,000. Before this, BOTH transfers were unresolvable: `settle_row` refuses each with
    `AmountMismatchError` because the gap is far outside the settle window, and the dialog's only
    other exits are switched off. The record is split first, so each transfer then settles an
    ordinary exact-amount payment through `settle_payment`, UNCHANGED.

    ⚠️ `intent` IS REQUIRED AND HAS NO DEFAULT, AND IT SURVIVES SLICE TD'S REMOVAL WITH ONE LEGAL
    VALUE. A shortfall is EITHER a part payment (the balance is still owed) OR a deduction such as
    TDS (nothing more is owed). Nothing in this system can tell them apart -- `Project Payments.tds`
    is blank until a human writes it at fulfilment -- so the reviewer declares it. Guess it wrong in
    the part-payment direction and this creates an approved payment that will never be paid,
    inflating what the PO thinks it still owes, forever: worse than the dead end it replaces. A
    missing or unrecognised intent throws rather than assuming.

    ⚠️ THIS ENDPOINT NO LONGER RECORDS TDS, AND MUST NOT LEARN TO AGAIN. Slice TD's deduction branch
    is gone: SR tax withheld is recorded once, at approval, by `services/payment_tds.py`, which nets
    `Project Payments.amount` -- so an approved SR payment now matches its transfer outright. A
    `deduction` intent falls through to the `VALID_INTENTS` throw, which is the regression fence.

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
        # ⚠️ THIS IS WHERE A `deduction` INTENT NOW LANDS, AND THE MESSAGE HAS TO SAY SO. A caller
        # still sending the removed intent -- a cached bundle, a saved request -- must be told the
        # answer moved rather than that it typed nonsense, or it will retry the same call.
        frappe.throw(
            "Declare that this is a part payment before settling part of a payment. Tax withheld is "
            "no longer recorded from a statement -- it is deducted when the payment is approved.",
            frappe.ValidationError,
            title="No intent given",
        )
    staged, doc = _guard_partial_preconditions(row, target_name, confirm_mismatch)
    statement_file_url = _statement_file_url(doc["import_batch"])
    bank_amount = normalize_amount(doc.get("amount"))

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
        # ⚠️ INSIDE THE SAVEPOINT -- see `settle_row`'s call site for why, including why `result`
        # rides along (review F2: the `Recorded`/`Settled` verb and the X1 amount correction).
        _refresh_row_allocation(staged.name, actor, result)
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


@frappe.whitelist(methods=["POST"])
def check_partial_settle(row: str, target_name: str):
    """Would `settle_row_partial` refuse this line outright? Read-only; returns `{"ok": True}` (#1269).

    URL: /api/method/nirmaan_stack.api.outflow_import.expenses.check_partial_settle

    The screen asks this BEFORE it opens "This record is larger than the transfer -- settle and carry
    the rest?". Without it, a line whose money was already recorded got that question first, and the
    refusal only came after the reviewer answered it -- a question about a split that could never
    happen.

    ⚠️ IT CALLS `_guard_partial_preconditions`, THE ONE HELPER `settle_row_partial` RUNS BEFORE ITS
    SAVEPOINT, so the check cannot pass a line the write then refuses on those guards. It does NOT
    run `_assert_partially_settleable` (that takes a row lock, inside the write's savepoint); the
    screen's `partialOffer` mirrors that gate and the write re-asserts it.

    ⚠️ AN AMOUNT-OFF HIT PASSES (`confirm_mismatch=True`). That is a question the reviewer may answer
    yes to, and `settle_row_partial` still asks it when the split is sent. Only the refusals nobody
    can overrule go first.

    ⚠️ IT IS NOT THE AUTHORITY. `settle_row_partial` re-asserts everything; this only changes the
    ORDER the reviewer hears things in.
    """
    require_outflow_access()
    _guard_partial_preconditions(row, target_name, confirm_mismatch=True)
    return {"ok": True}


def _guard_partial_preconditions(row: str, target_name: str, confirm_mismatch):
    """The read-only guards a partial settle runs before its savepoint. Returns `(staged, doc)`.

    Shared by `settle_row_partial` and `check_partial_settle` (#1269), so the check and the write can
    never ask them in a different order or skip one.
    """
    staged, doc = _load_settleable_row(row)
    # ⚠️ THE THIRD MONEY-OUT DOOR, AND IT HAD THE SAME HOLE AS THE OTHER TWO. This one both settles
    # a payment AND performs surgery on a PO's terms, so an unguarded credit would leave a split
    # sanction behind it as well as a wrongly-Paid record. Guarded above the spend, not inside it.
    _guard_is_a_debit(doc)
    # ⚠️ A SIXTH CALLER, beyond the five #1260 names, because this is Link too: a line already Paid on
    # an expense could otherwise be part-settled onto a larger Approved payment from the same dialog,
    # and `settle_payment`'s UTR guard sees only references on OTHER PAYMENTS.
    _guard_money_not_recorded(
        staged, doc, confirm_mismatch, writing=[(PAYMENT_DOCTYPE, target_name)]
    )
    return staged, doc


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
#
# ⚠️ A SECOND DICT USED TO READ THIS ONE AT MODULE LOAD (`_DEDUCTION_REFUSALS`, slice TD), which
# forced this declaration to sit above it regardless of narrative order. That dependency is gone
# with the deduction path, so this dict is now free-standing -- there is no longer a placement
# constraint here to preserve, and nothing should reintroduce one.
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
def settle_expense(row: str, target_doctype: str, target_name: str, confirm_mismatch=False):
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
    return settle_row(row, target_doctype, target_name, confirm_mismatch)


@frappe.whitelist(methods=["POST"])
def create_expense(
    row: str,
    doctype: str,
    expense_type: str,
    project: str = None,
    description: str = None,
    vendor: str = None,
    comment: str = None,
    confirm_mismatch=False,
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
    _guard_money_not_recorded(staged, doc, confirm_mismatch)
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
        # ⚠️ INSIDE THE SAVEPOINT -- see `settle_row`'s call site for why, including why `result`
        # rides along (review F2: the `Recorded`/`Settled` verb and the X1 amount correction).
        _refresh_row_allocation(staged.name, actor, result)
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
    """The guard shared by every WHOLE-TRANSFER write (`settle_row`, `settle_row_partial`,
    `create_expense`).

    ⚠️ REFUSES `ROW_PARTIALLY_ALLOCATED` (Task 6 review fix A, ADR-0020). None of the three
    whole-transfer paths above consults `_live_legs` or `is_over_allocated` -- `settle_row`'s own
    guard is that the record settled equals the WHOLE transfer, which is already false the moment
    anything has been allocated against it. Left open, a row carrying a Rs 60 allocation against a
    Rs 100 transfer could still take a Rs 100 `settle_row` on top of it -- Rs 160 against a Rs 100
    transfer, through the UI, with no guard anywhere. Once a transfer is partly allocated the only
    correct entry is `allocate_row`, whose guard bounds a leg against the REMAINDER
    (`allocation.allocation_fits`) -- so the refusal names that route.

    ⚠️ THE SECOND EFFECT: with this in place, a row can acquire legs in only ONE ledger --
    `allocate_row` is Project-Payments-only, and once a leg lands there this guard blocks every
    other ledger's whole-transfer entry for the rest of that row's life. So the composite
    `'Project Payments|Project Expenses'`-shaped string `ledgers.SETTLED_LEDGER_SQL` can produce is
    UNREACHABLE through any endpoint today -- `SETTLED_LEDGER_SQL` is still correct for whatever
    the table actually holds (a future ledger fanning across books, or data written outside this
    guard), but nothing currently in this module can create the case it guards against.
    """
    doc = frappe.db.get_value(ROW_DOCTYPE, row, "*", as_dict=True)
    if not doc:
        frappe.throw(f"Import row '{row}' not found.", title="Not found")
    if doc.get("row_status") == ROW_SETTLED:
        frappe.throw(
            "This row has already settled an expense.", title="Already settled"
        )
    if doc.get("row_status") == ROW_PARTIALLY_ALLOCATED:
        frappe.throw(
            "This transfer is already partly allocated. Use Allocate to add another payment "
            "against the remainder -- this action would settle the whole transfer again.",
            title="Partly allocated",
        )
    if doc.get("row_status") == ROW_SKIPPED:
        frappe.throw(SKIPPED_ROW_REFUSAL, title="Row skipped")
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
        "non-project inflow instead.",
        ExpenseSettlementError,
        title="Not a debit",
    )


def _guard_money_not_recorded(staged, doc, confirm_mismatch=False, writing=()) -> None:
    """Refuse a line whose money is already recorded, BEFORE anything is written (#1260).

    Shared by every endpoint that records money from a line: `settle_row` (and its `settle_expense`
    alias), `settle_row_partial`, `allocate_row`, `create_expense`, and `inflows.create_inflow` /
    `create_non_project_inflow`. It asks the match
    run's own question for the line's source (`review._recorded_money_group`) and follows the run's
    own verdict (`status.derive_recorded_money_verdict`), so it holds even if no match run ever ran:

      * the run would SKIP the line -> `MoneyAlreadyRecordedError`, always;
      * the run would leave it MISMATCHED naming a record -> `RecordedMoneyNeedsConfirmationError`,
        unless `confirm_mismatch` -- the screen's "... anyway?" answer;
      * otherwise it returns and the write proceeds exactly as before.

    The refusal carries the run's own note, so it names every record and its ledger. `writing` are the
    `(doctype, name)` records this call is about to settle; see `review._recorded_money_group` for why
    they are never the duplicate.

    ⚠️ IT RUNS BEFORE THE SAVEPOINT AND READS ONLY, so a refusal leaves nothing behind. Only
    `allocate_row` holds a row lock, and the guard runs under it. The others take none, and a
    concurrent second write on the SAME row still fails at the row update.

    ⚠️ ACCEPTED RACE (owner ruling, #1262): two reviewers recording two DIFFERENT lines that describe
    the same money, at the same moment, can both read "not yet recorded" and both write. A ROW lock
    would NOT close this -- each line takes its own lock, so neither waits for the other; that is why
    `allocate_row`'s lock does not close it either. Closing it needs ONE lock shared by all six
    callers (e.g. a transaction-scoped advisory lock taken before any other lock). Deferred, not
    forgotten: do not add a per-row lock here believing it fixes this.
    """
    verdict = derive_recorded_money_verdict(
        staged, _recorded_money_group(staged, doc["import_batch"], writing)
    )
    if verdict is None:
        return
    if verdict.kind == RECORDED_DUPLICATE:
        frappe.throw(
            f"{verdict.note} Nothing has been recorded again.",
            MoneyAlreadyRecordedError,
            title="Already recorded",
        )
    if frappe.utils.sbool(confirm_mismatch):
        return
    frappe.throw(
        f"{verdict.note} Nothing has been recorded yet -- confirm to record it anyway.",
        RecordedMoneyNeedsConfirmationError,
        title="Check before recording",
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
            # `target_amount` means "how much of THIS TRANSFER went to this target". Since the import
            # records no tax (ADR-0021) every settle path writes the payment's own settled figure, so
            # `result.amount` IS that share -- there is no withheld part to subtract. ⚠️ Do not
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


def _refresh_row_allocation(row_name: str, actor: str, result=None) -> str:
    """Recompute a row's allocation from its legs and write the derived status. Returns it.

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
            # X1: what the record held before, and whether we changed it. `None` on a created
            # expense, which had no previous amount to correct.
            #
            # ⚠️ NOTHING IN `frontend/src/` READS EITHER KEY -- CORRECTED AT THE WHOLE-BRANCH REVIEW
            # (F2). This comment used to say "the screen shows the delta on the bulk-confirm
            # surface". It never did: grepping both names finds zero readers. They stay as a
            # response contract -- a caller MAY read them, and the endpoint should not stop saying
            # what it did -- but they are NOT the disclosure. The disclosure is the PERSISTED
            # `outcome_note`, written through `allocation_note`'s `correction` suffix, which is what
            # a reviewer actually reads on the row. Do not "restore" the delta here and drop it
            # there: a payload nobody renders is exactly how this fact got lost the first time.
            "original_amount": (
                None if result.original_amount is None else float(result.original_amount)
            ),
            "amount_changed": result.amount_changed,
        },
        "batch_status": derive_batch_status(statuses),
        "counters": derive_batch_counters(statuses),
    }
