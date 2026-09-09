# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Settlement -- THE ONLY WRITE IN THIS FEATURE (Bulk Import Outflow, slices S5 + V2).

Everything else in Bulk Import Outflow reads and reports. This module is where a bank row actually
changes something outside the import's own staging: an approved record becomes `Paid`, or a new
expense is created already `Paid`.

⚠️ THE PARAGRAPH THAT STOOD HERE SAID THE OPPOSITE, AND IT WAS RIGHT AT THE TIME. Under v2 this
module could not touch `Project Payments`, `PO Payment Terms` or a Procurement Order's
`amount_paid`, and that held "by this module simply not knowing how". The owner reversed that spine
on 2026-08-06. It now settles all three ledgers, and `settle_payment` is the reversal.

WHAT DID NOT CHANGE, and it is where the safety now lives: this module only ever writes the LAST
RUNG of a ladder somebody else already climbed. It cannot approve. And nothing settles without a
per-row human confirmation. If a future change lets this import approve something, that is the
invariant breaking, not a feature.

⚠️ THE SENTENCE "IT CANNOT CREATE A PAYMENT" WAS NARROWED AT SLICE PS (owner ruling R2, 2026-08-12),
and the narrowing is worth stating precisely because the old wording is quoted elsewhere in this
repo. `api/outflow_import/expenses.settle_row_partial` splits an approved `Project Payments` record
into a half the bank actually paid and a balance that stays approved -- which DOES insert a payment
document. The invariant it must not break is not "no payment document is ever created"; it is:

    THIS IMPORT NEVER APPROVES, AND NEVER INCREASES WHAT IS SANCTIONED.

A split re-partitions an existing sanction. The two halves sum EXACTLY to the original, both come
out `Approved` because the money already was, and the balance inherits the original's
`document_type` / `document_name` / `project` / `vendor` / `approval_date` -- it is the same request,
recorded in two rows. What remains forbidden is unchanged: this module cannot move anything INTO
`Approved`, and "create a new entry" is still expenses-only, because a `Project Payment` is born
from a PO or SR request and nothing here may originate one.

⚠️ SLICE B6 ADDS A FOURTH DOCTYPE THIS MODULE MAY WRITE, AND IT IS NOT AN OUTFLOW AT ALL.
`create_inflow_from_row` records a bank CREDIT as a `Project Inflow`. It changes none of the spine
above: it settles nothing, approves nothing, and creates only from a row a person confirmed. What it
DOES do that nothing else here does is write a record with NO status and NO approval workflow --
every consumer sums `Project Inflows` unfiltered, so the row is live the instant it commits and can
release a CEO Cashflow Hold. The bank row is the review gate (owner ruling Q8, option c). Read that
function's docstring before touching it.

⚠️ SLICE B7 ADDS THE ONE PLACE IN THIS MODULE WHERE A STORED AMOUNT IS **NEGATIVE**, AND IT IS THE
SENTENCE TO READ BEFORE TOUCHING ANY AMOUNT IN THIS FILE. `create_non_project_receipt_from_row`
records a bank CREDIT that belongs to no project as a `Non Project Expense` with a NEGATIVE amount
(ADR-0016 decision 3, owner ruling Q3). There is no non-project inflow doctype in this app and none
is being created; a negative non-project expense is the app's own existing construct for money
coming back, is rendered green by the list screen, and is deliberately excluded from auto-approval.

The signed path is opened as NARROWLY as it can be, and every part of the narrowing is structural
rather than promised:
  * it is a SEPARATE function, not a mode flag on `create_expense_from_row` -- whose `amount <= 0`
    guard is therefore untouched and still refuses every debit, which is correct for a debit;
  * it takes NO `doctype` parameter at all, so a credit can never become a negative
    `Project Expense` (a Data column, with project/vendor/payment_by fields that mean nothing on a
    receipt) -- there is no argument by which a caller could ask for one;
  * `direction` is REQUIRED and must be `Credit`. The sibling `create_inflow_from_row` tolerates
    `None`; this one does not, because there the direction merely selects a ledger and here it
    selects a SIGN;
  * the bank row's own `amount` is read as a POSITIVE MAGNITUDE, exactly as on every other path,
    and the negation happens HERE. Nothing trusts a sign arriving from a row or a client.

⚠️ THE COST IS REAL AND IS NOT OURS TO RE-LITIGATE: money coming IN now lives in a doctype called
*Expenses*. Anyone reading or summing a Non-Project Expenses list meets a negative row. That was
weighed against a new doctype with new permissions, list views and reports, and the owner chose
this; ADR-0016 records it as accepted risk R3. The new `non_project=1` Expense Types (Q19) are what
make such a row say what it is.

NO REQUEST CONTEXT. The actor is passed IN rather than read from `frappe.session`, so this stays a
service the api layer drives (ADR-0010: api -> service is the one legal direction). DB writes here
are fine; reaching for the request is not.

WHY THIS EXISTS AT ALL, given that expenses have no whitelisted endpoint in this app: every expense
write today is a raw SDK `updateDoc`, which lands on `frappe/api/v1.py` as
`get_doc(for_update=True) -> update() -> save()`. Because the doc is re-read server-side there,
`check_if_latest` can never fire -- there is ZERO optimistic-concurrency protection. Two accountants
working overlapping statements would both succeed, and the second would silently overwrite the
first's payment reference with no Version row to show it (both expense doctypes had
`track_changes` unset until this feature turned it on). The status re-assertion under `for_update`
below is the whole point of routing settlement through here.

THE THREE DOCTYPE ASYMMETRIES THAT WILL BITE ANYONE WHO ASSUMES THE TWO EXPENSE KINDS ARE TWINS:
  1. `Project Expenses.amount` is a **Data** field -- PG varchar(140) holding bare numeric strings
     like '2935' / '351.72'. `Non Project Expenses.amount` is a real **Currency** column.
  2. `payment_by` exists ONLY on `Project Expenses`, and is a Data field, not a Link.
  3. `Non Project Expenses` has **no vendor column at all**, which is why a beneficiary name has to
     land in its description (owner ruling).

CREATING AT `Paid` DELIBERATELY BYPASSES AUTO-APPROVAL. Both doctypes' `validate()` returns early
via `if self.status and self.status != 'Requested': return`, so the `< Rs 5,000` auto-approve rule
never evaluates. That is intended -- approving a spend that has already left the bank is theatre --
and it is recorded here so a later reader does not "fix" it.

⚠️ SLICE X1 (owner ruling 2026-08-09): THIS MODULE NOW WRITES MONEY, AND THE SPINE HAS TO BE
RESTATED PRECISELY. Until X1 a settlement wrote `status`, `payment_date`, a reference and
`payment_by` -- never an amount. It now also writes the BANK's amount onto the record whenever the
two differ, in either direction, on all three ledgers (`amounts.rewrite_amount`). The spine is
unchanged in what matters and NARROWER than "never touches money": this import never approves and
never creates a payment; it settles the last rung of a ladder somebody else climbed, and it now
records that rung at the figure the bank actually moved. Anything in this repo still reading "the
import does not touch amounts" is history from X1 on.

Two guarantees make that safe to say, and both are structural rather than promised:
  * THE WINDOW STILL GATES THE WRITE. `_lock_and_assert_settleable` /
    `_lock_and_assert_payment_settleable` run FIRST and still refuse anything outside +-Rs 5. The
    rewrite corrects what is written; it never widens what may be written.
  * EVERY AMOUNT CHANGE IS AUDITED. All three doctypes carry `track_changes: 1`, and BOTH write
    paths now go through `doc.save(..., ignore_version=False)`, so each change lands in the Version
    log with its user and timestamp. ⚠️ THAT IS WHY THE EXPENSE PATH STOPPED USING
    `frappe.db.set_value` -- see `settle_existing_expense`. `set_value` skips the document lifecycle
    entirely, so an amount rewritten through it would be an unaudited edit to a financial figure.

    ⚠️ THE EXPLICIT `ignore_version=False` IS LOAD-BEARING AND WAS ADDED BECAUSE A TEST CAUGHT ITS
    ABSENCE. Frappe defaults `ignore_version = frappe.flags.in_test`, so a bare `doc.save()` records
    the Version in production and SILENTLY SKIPS IT under `bench run-tests` -- which meant the audit
    this whole slice rests on was unprovable exactly where it was being asserted. Passing it
    explicitly makes the guarantee STRUCTURAL rather than a default somebody else's flag can turn
    off. The repo hit this once before, on the Rate Master write endpoints; the note there says the
    same thing.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

import frappe

from nirmaan_stack.services.outflow_import.ledgers import (
    NON_PROJECT_EXPENSE_DOCTYPE as NON_PROJECT_EXPENSE,
)
from nirmaan_stack.services.outflow_import.ledgers import (
    PROJECT_EXPENSE_DOCTYPE as PROJECT_EXPENSE,
)
from nirmaan_stack.services.outflow_import.amounts import (
    amounts_match,
    rewrite_amount,
    to_decimal,
)
from nirmaan_stack.services.outflow_import.ledgers import PAYMENT_DOCTYPE
from nirmaan_stack.services.outflow_import.ledgers import (
    SETTLEABLE_STATUSES,
    is_expense_doctype,
    settleable_statuses,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.reference_guard import (
    assert_reference_is_free,
)

__all__ = [
    "PROJECT_EXPENSE",
    "NON_PROJECT_EXPENSE",
    "INFLOW_DOCTYPE",
    "DIRECTION_CREDIT",
    "SETTLEABLE_STATUSES",
    "ExpenseSettlementError",
    "AlreadyPaidError",
    "WrongStatusError",
    "AmountMismatchError",
    "ExpenseTypeScopeError",
    "DuplicateReferenceError",
    "InflowNotRecordableError",
    "SettleResult",
    "settle_existing_expense",
    "settle_payment",
    "create_expense_from_row",
    "create_inflow_from_row",
    "create_non_project_receipt_from_row",
    "format_amount_for",
    "statement_attachment_field",
]

#: The one ledger this module writes that is NOT an outflow (slice B6).
#:
#: ⚠️ DELIBERATELY NOT IN `ledgers.py`. That module is the vocabulary of the three ledgers this
#: import SETTLES, and `LEDGER_DOCTYPES` is read as a DISPLAY ORDER by
#: `status.derive_settled_ledger_split` -- adding a fourth name there would grow a column in the
#: settled-by-ledger panel for a ledger that is never settled, only created. An inflow is not a
#: settlement candidate and can never become one: there is no approved inflow waiting to be paid.
INFLOW_DOCTYPE = "Project Inflows"

#: The direction an `Outflow Import Row` must carry before it may become an inflow (slice B6).
#: Spelled here rather than imported from `parser`, which is not otherwise a dependency of this
#: module; `test_inflows` pins the two spellings against each other so a rename cannot reach only
#: one of them.
DIRECTION_CREDIT = "Credit"


# ⚠️ THE SETTLEABLE-STATUS MAP MOVED TO `ledgers.py` AT V1, and the names above are re-exports so
# existing callers are unaffected. It used to be defined here AND in `candidates.py`, with the two
# copies disagreeing about `Non Project Expenses` -- this file accepted `Requested` there and so did
# the read side, which is exactly the sort of agreement-by-coincidence that survives until one of
# them is tightened. The owner then ruled Approved-only on all three ledgers (Q3), and one map is
# what makes that ruling enforceable in one edit.
#
# ⚠️ THE MAP INCLUDES `Project Payments` FROM V1 ON, so membership of `SETTLEABLE_STATUSES` is NOT
# a valid "is this an expense?" test -- use `is_expense_doctype`. The distinction is live, not
# pedantic: a payment may be SETTLED (`settle_payment`) and may never be CREATED, so the two
# expense functions still refuse one by name.

_PAID = "Paid"


class ExpenseSettlementError(frappe.ValidationError):
    """Base for every refusal in this module.

    Subclassed rather than thrown as one type so the caller can tell the cases apart WITHOUT
    matching on message text -- the mistake `_fulfil_payment` made, where one sentence covers
    CEO Pending, Requested, Rejected and already-Paid, leaving no way to react differently to any
    of them.
    """


class AlreadyPaidError(ExpenseSettlementError):
    """Someone settled this expense between the reviewer seeing it and confirming."""


class WrongStatusError(ExpenseSettlementError):
    """The target is in a status that was never settleable."""


class AmountMismatchError(ExpenseSettlementError):
    """The expense's amount is not the amount that left the bank."""


class ExpenseTypeScopeError(ExpenseSettlementError):
    """A project-only type on a non-project expense, or the reverse."""


class DuplicateReferenceError(ExpenseSettlementError):
    """This bank reference is already recorded on a different payment.

    Two genuinely different situations reach this, and the message distinguishes them:
      * a FAN-OUT -- one transfer covering several payments. Owner ruling Q4 makes those
        report-only, settled by hand in the payments screen, which is precisely why the existing
        UTR guard is never challenged and stays exactly as it is.
      * a real double-settle attempt from a re-uploaded or overlapping statement.
    """


class InflowNotRecordableError(ExpenseSettlementError):
    """This bank CREDIT cannot be recorded as a `Project Inflow` (slice B6).

    ⚠️ ITS OWN TYPE, NOT `WrongStatusError`, BECAUSE NOTHING ABOUT IT IS A STATUS. `Project Inflows`
    has no status field and no approval workflow at all -- an inflow is recorded as fact -- so every
    refusal on this path is about the SHAPE of the request: the row is a debit, the project is
    missing, or the project has no customer to receive money from. Reusing the status error would
    tell a caller to look for a workflow that does not exist.

    ⚠️ SLICE B7 WIDENS IT ONE STEP, TO "MONEY IN CANNOT BE RECORDED", AND NO TWIN TYPE WAS MINTED.
    `create_non_project_receipt_from_row` records a credit that belongs to no project as a NEGATIVE
    `Non Project Expense`, and its only shape refusal is the SAME fact this type already names: the
    row's direction forbids treating it as money that arrived. Its other two refusals already have
    owners -- `ExpenseTypeScopeError` for the type and `AmountMismatchError` for the figure -- so a
    second class would have exactly one member and would differ from this one in name only.
    """


@dataclass(frozen=True)
class SettleResult:
    """What a settlement wrote.

    ⚠️ `amount` IS THE AMOUNT WRITTEN, NOT THE AMOUNT FOUND (changed at X1). It used to report the
    record's pre-settle figure, which was the same number until X1 made a settle able to change it.
    Leaving it as the old value would have made the one screen that most needs the truth -- the
    bulk confirm, which shows the delta per row -- quietly report the figure it just replaced.

    `original_amount` is what the record held BEFORE the settle, so a caller can show
    `18,678.69 -> 18,679.00` without re-reading the record. It is `None` for a created expense,
    which had no previous amount.
    """

    doctype: str
    name: str
    amount: Decimal
    created: bool
    original_amount: Decimal | None = None

    tds_written: Decimal | None = None
    """The deduction recorded, or `None` when this was an ordinary settle (slice TD).

    ⚠️ SEPARATE FROM `amount`, WHICH IS UNCHANGED ON A DEDUCTION SETTLE. A caller reporting "what
    did this write" needs both numbers: the record still says what was invoiced, and this says what
    the bank withheld. Folding the deduction into `amount` is exactly the destruction the write path
    refuses to do.
    """

    @property
    def amount_changed(self) -> bool:
        """Whether this settlement rewrote the record's amount."""
        return self.original_amount is not None and self.original_amount != self.amount


@contextmanager
def _outflow_import_write():
    """Mark the request as an outflow-import settlement for the duration of one `doc.save()`.

    ⚠️ A REQUEST-LEVEL FLAG, WHERE THE OTHER TWO SUPPRESSIONS USE `doc.flags`, AND THE DIFFERENCE IS
    FORCED. `update_parent_amount_paid` and the notification cascade read `doc.flags` because they
    are handed the document. The third committer -- `project_cashflow_hold_update`, wired to
    `Project Payments` AND `Project Expenses` `on_update` -- reaches its `frappe.db.commit()` from
    an INNER helper that never sees the doc, so a doc flag cannot reach it. `frappe.flags` can, and
    it is the same mechanism that module's own `in_import` / `in_patch` guards already use.

    ⚠️ THE PREVIOUS VALUE IS RESTORED, NOT BLINDLY CLEARED. A request-level flag that leaks would
    suppress a commit for unrelated later work in the same request; one that resets to False would
    break a nesting caller. `finally` covers the raise path, which is the one that matters -- a
    settlement that throws is exactly when the caller is about to roll back to its savepoint.
    """
    previous = frappe.flags.get("outflow_import_settling")
    frappe.flags.outflow_import_settling = True
    try:
        yield
    finally:
        frappe.flags.outflow_import_settling = previous


# Every one of the three ledgers happens to spell it the same way. Named once so a fourth ledger
# that does not is a change in one place rather than a grep.
PAYMENT_ATTACHMENT_FIELD = "payment_attachment"

#: ⚠️ THE FOURTH LEDGER THE LINE ABOVE ANTICIPATED ARRIVED AT B6, AND IT SPELLS IT DIFFERENTLY.
#: `Project Inflows` calls the same field `inflow_attachment`. This map is the "change in one place"
#: that note promised: everything outside it keeps `payment_attachment`, so the three settle ledgers
#: are byte-unchanged, and NOTHING else in the feature has to know that a ledger disagrees.
_STATEMENT_ATTACHMENT_FIELDS = {INFLOW_DOCTYPE: "inflow_attachment"}


def statement_attachment_field(doctype: str) -> str:
    """Where THIS doctype keeps the proof of the transfer.

    ⚠️ IT IS ALSO WHAT `api/outflow_import` MUST WRITE INTO A `File` ROW'S `attached_to_field`.
    A `File` naming a field the doctype does not have is a link Frappe cannot authorise back to the
    record, which surfaces as an attachment that is visibly present and refuses to open -- exactly
    the failure `_link_statement_file_to_target` exists to prevent. One resolver, both writers.
    """
    return _STATEMENT_ATTACHMENT_FIELDS.get(doctype, PAYMENT_ATTACHMENT_FIELD)


def apply_statement_attachment(doc, statement_file_url: str | None) -> bool:
    """Point the record's `payment_attachment` at the bank statement it was settled from.

    Returns whether it wrote. Call BEFORE `doc.save()` -- it mutates the document and nothing else,
    so the attachment rides the same save, the same audit Version and the same savepoint as the
    settlement itself. A separate write afterwards could survive a rolled-back settlement.

    ⚠️ IT ONLY EVER WRITES INTO A BLANK (owner ruling 2026-08-10), and this is the same rule the
    `utr` write follows two functions down for the same reason. `payment_attachment` is where an
    accountant puts the proof of THIS payment -- a signed receipt, a screenshot of the transfer.
    Overwriting that with a 1,000-row statement would destroy specific evidence and replace it with
    general evidence, on a field nobody asked us to touch. A record that already has a proof keeps
    it; the statement is still reachable from the import.

    ⚠️ THE FILE IS PRIVATE AND ATTACHED TO THE IMPORT BATCH, NOT TO THIS RECORD. Copying the URL
    copies a link, not a permission. `expenses._link_statement_file_to_target` creates the second
    `File` row that makes it openable from here -- deliberately AFTER the commit, because a `File`
    insert wakes the cloud-attachment hook and that hook commits, which inside the caller's
    savepoint would make the per-row rollback a silent no-op. See the call site.
    """
    if not statement_file_url:
        return False
    field = statement_attachment_field(doc.doctype)
    if not doc.meta.has_field(field):
        return False
    if (doc.get(field) or "").strip():
        return False
    doc.set(field, statement_file_url)
    return True


#: The doctypes whose `amount` is a **Data** column holding a bare numeric STRING.
#:
#: ⚠️ A SET, NOT AN `==`, SINCE B6 -- and the second member was MEASURED, not assumed. All 463 live
#: `Project Inflows` hold `'1500000'` / `'2402'`-shaped strings and NONE of them would break a
#: numeric cast, exactly as `Project Expenses` does. `Non Project Expenses` and `Project Payments`
#: are real Currency columns and are unchanged by this widening.
_DATA_AMOUNT_DOCTYPES = frozenset({PROJECT_EXPENSE, INFLOW_DOCTYPE})


def format_amount_for(doctype: str, amount: Decimal):
    """Format money the way the target doctype actually stores it.

    `Project Expenses.amount` is a Data column: 2,574 live rows hold bare numeric strings, no
    commas, no symbol. Handing it a float would store `5000.0` where every neighbour holds `5000`,
    and the numeric CAST the candidate query relies on would still work but the column would stop
    being self-consistent. `Non Project Expenses.amount` is a real Currency column and wants a
    number.

    ⚠️ `Project Inflows.amount` IS THE SAME DATA-COLUMN SHAPE (B6), which is why the test below is
    membership rather than an equality against one name. Writing a float there would put `44275.0`
    beside 463 rows that all read `44275`, and every consumer sums that column with no filter.
    """
    if doctype in _DATA_AMOUNT_DOCTYPES:
        normalized = amount.normalize()
        if normalized == normalized.to_integral_value():
            return str(int(normalized))
        return format(normalized, "f")
    return float(amount)


def format_tds(value: Decimal) -> float:
    """Format a TDS figure the way `Project Payments.tds` is already stored (slice TD).

    ⚠️ A SEPARATE FUNCTION FROM `format_amount_for`, DELIBERATELY. That one keys on the DOCTYPE and
    would return the right thing here only by coincidence -- it is about `amount`, a real Currency
    column, while `tds` on the same doctype is a **Data** column holding a stringified number. Two
    fields, two column types, one doctype; reusing the amount formatter would read as intentional
    and be accidental.

    ⚠️ IT MATCHES `api/payments/project_payments._fulfil_payment` EXACTLY, which does
    `pay.tds = flt(args.get("tds") or 0)` -- a float, which Frappe stores as `'1000.0'`. The live
    column holds both `'1000.0'` and `'1000'` because two writers over the years disagreed; this
    path must not add a THIRD shape. `flt()` returns a float, so `float()` is the same value by the
    same route.
    """
    return float(value)


def _assert_type_scope(doctype: str, expense_type: str) -> None:
    """A Project Expense needs a `project=1` type; a Non-Project one needs `non_project=1`.

    Nothing in the app enforces this today -- the two create dialogs simply query different lists --
    so an endpoint that accepts a type name has to check it itself.
    """
    if not expense_type:
        frappe.throw("An expense type is required.", ExpenseTypeScopeError, title="Missing type")
    field = "project" if doctype == PROJECT_EXPENSE else "non_project"
    allowed = frappe.db.get_value("Expense Type", expense_type, field)
    if not allowed:
        frappe.throw(
            f"'{expense_type}' is not an expense type available for {doctype}.",
            ExpenseTypeScopeError,
            title="Wrong expense type",
        )


def _lock_and_assert_settleable(doctype: str, name: str, bank_amount: Decimal) -> Decimal:
    """Re-read the target UNDER A ROW LOCK and re-assert everything the reviewer saw.

    ⚠️ `for_update=True` WITHOUT `cache=True`. Frappe's `get_value` silently skips the lock when the
    value comes from cache (`frappe/database/database.py`), so a cached read would take no lock at
    all and this whole guard would be decorative.

    The reviewer's screen is a snapshot; between it and this call another accountant may have
    settled the same expense. Re-asserting here, inside the lock, is the only place that can be
    caught.
    """
    current = frappe.db.get_value(
        doctype, name, ["status", "amount"], as_dict=True, for_update=True
    )
    if not current:
        frappe.throw(f"{doctype} '{name}' not found.", WrongStatusError, title="Not found")

    status = (current.get("status") or "").strip()
    if status == _PAID:
        frappe.throw(
            f"{name} was already marked Paid. Refresh to see who settled it.",
            AlreadyPaidError,
            title="Already settled",
        )
    if status not in settleable_statuses(doctype):
        frappe.throw(
            f"{name} is '{status}' and cannot be settled from a bank statement.",
            WrongStatusError,
            title="Not settleable",
        )

    amount = normalize_amount(current.get("amount"))
    # ⚠️ THE SAME WINDOW THE MATCHER USES, and it must stay the same: a pool wider than this guard
    # offers a record the confirm then refuses, and a guard wider than the pool permits a
    # settlement the screen never proposed. See `amounts.py`.
    if not amounts_match(amount, bank_amount):
        frappe.throw(
            f"{name} is for {amount} but {bank_amount} left the bank, a difference of "
            f"{abs(amount - bank_amount)}. "
            f"Settle it against the transfer that matches, or record a new expense.",
            AmountMismatchError,
            title="Amounts differ",
        )
    return amount


def settle_existing_expense(
    row,
    target_doctype: str,
    target_name: str,
    actor: str,
    statement_file_url: str | None = None,
) -> SettleResult:
    """Mark an already-approved expense `Paid` from a bank row.

    ⚠️ EXPENSES ONLY, still. `Project Payments` is in `SETTLEABLE_STATUSES` from V1 on, so this
    guard tests `is_expense_doctype` rather than map membership -- the map answers "what status may
    I settle this from", not "may THIS module settle it". V2 adds the payment path beside this one.

    ⚠️ THIS WRITES THROUGH `doc.save()` AS OF X1. IT USED TO USE `frappe.db.set_value`, AND THE
    SWITCH IS THE LOAD-BEARING PART OF THIS SLICE -- three consequences, in order of how badly each
    would bite:

    1. THE AMOUNT REWRITE IS AUDITED. `set_value` writes past the document lifecycle, so it fires
       no `validate`, no `on_update`, and -- the reason this had to change -- NO VERSION. Both
       expense doctypes carry `track_changes: 1`, but that setting is inert for a `set_value`
       write. Rewriting a financial figure through it would have left no record of who changed the
       amount or what it had been, on the exact write X1 exists to make.

    2. IT FIXES A SILENT BUG THAT PREDATES THIS SLICE. `hooks.py` wires
       `project_cashflow_hold_update.on_project_expense` to `Project Expenses` `on_update`, which
       recomputes the project's CEO-Hold cashflow gap whenever a row enters or leaves `Paid`.
       Because this function used `set_value`, THAT HOOK HAS NEVER RUN when this feature settled an
       expense -- so settling one has never moved the CEO-Hold gap. The docstring on
       `api/outflow_import/expenses.py` explaining that the CEO-Hold hook is "deliberately NOT
       suppressed" was sound for `create_expense`, which genuinely inserts a document, and had
       simply never applied to this path. It applies now.

    3. IT WAKES A COMMITTER, WHICH `_outflow_import_write` HOLDS SHUT. That same cashflow module
       can reach a `frappe.db.commit()` -- in its manual-hold-releasable notification branch -- and
       a commit inside the caller's savepoint makes the per-row rollback a silent no-op. The flag
       suppresses that ONE branch; the gap recomputation itself still runs, in our transaction. See
       both `_outflow_import_write` and the guard at the hook site.

    ⚠️ `payment_date` AND `payment_ref` ARE STILL ASSIGNED UNCONDITIONALLY, INCLUDING AS `None`,
    which is exactly what the `set_value` dict did. It looks careless beside `settle_payment`'s
    guarded writes and is kept deliberately: changing it here would be an unrelated behaviour change
    riding a slice about amounts. In practice the field is always blank -- the record is `Approved`,
    and both are written at settlement.
    """
    if not is_expense_doctype(target_doctype):
        frappe.throw(
            f"'{target_doctype}' is not an expense doctype.",
            WrongStatusError,
            title="Not an expense",
        )

    bank_amount = normalize_amount(getattr(row, "amount", 0))
    amount = _lock_and_assert_settleable(target_doctype, target_name, bank_amount)

    doc = frappe.get_doc(target_doctype, target_name)
    doc.status = _PAID
    doc.payment_date = getattr(row, "added_on_date", None)
    doc.payment_ref = (getattr(row, "bank_reference_no", "") or "") or None
    # payment_by exists ONLY on Project Expenses, and it is the finalising user -- deliberately NOT
    # the statement's "Added by", which the gateway truncates to 15 characters (owner ruling).
    if target_doctype == PROJECT_EXPENSE:
        doc.payment_by = actor

    # X1: the record takes the amount the bank actually moved. `format_amount_for` is what keeps
    # `Project Expenses.amount` a bare numeric STRING and `Non Project Expenses.amount` a number --
    # the two are not twins and writing one shape into the other is how the Data column stops being
    # self-consistent.
    written = amount
    exact = rewrite_amount(amount, bank_amount)
    if exact is not None:
        doc.amount = format_amount_for(target_doctype, exact)
        written = exact

    apply_statement_attachment(doc, statement_file_url)

    with _outflow_import_write():
        doc.save(ignore_permissions=True, ignore_version=False)

    return SettleResult(
        doctype=target_doctype,
        name=target_name,
        amount=written,
        created=False,
        original_amount=amount,
    )


def settle_payment(
    row,
    target_name: str,
    actor: str,
    statement_file_url: str | None = None,
    tds: Decimal | None = None,
    transfer_id: str | None = None,
    rewrite_amount_to_bank: bool = True,
    expected_amount: Decimal | None = None,
) -> SettleResult:
    """Mark an already-APPROVED `Project Payments` record `Paid` from a bank row (slice V2).

    ⚠️ THIS IS THE HALF v2 DELETED. v2's spine was "the payment branch never writes"; the owner
    reversed it, and this function is the reversal. It still cannot approve anything and it still
    cannot create a payment -- it writes the LAST rung of a ladder somebody else already climbed.

    IT MIRRORS THE CANONICAL FULFIL (`api/payments/project_payments._fulfil_payment`) rather than
    inventing a second way to pay a payment, and diverges in four places, each deliberate:

      1. THE STATUS RE-ASSERTION HAPPENS UNDER A ROW LOCK. The canonical path does
         `get_doc -> check -> save`, which is a read-check-write race: two accountants working
         overlapping statements both read `Approved` and both write. `for_update=True`, WITHOUT
         `cache=True`, is the only thing that closes it -- Frappe skips the lock entirely when the
         value comes from cache, which would make this guard decorative.
      2. DISTINCT ERRORS. The canonical path throws one sentence for CEO Pending, Requested,
         Rejected and already-Paid alike, leaving the caller no way to react differently. A bulk
         confirm needs to tell "somebody beat me to it" from "this was never settleable".
      3. THE AMOUNT MUST MATCH WITHIN THE SETTLE WINDOW, as it must for an expense, and X1 then
         WRITES THE BANK'S FIGURE onto the payment when the two differ. A TDS payment still cannot
         be settled here at all -- the bank sends `amount - tds`, thousands out, which no window
         reaches -- the accepted cost of deferring the tolerance pass (Q11). Those rows stay
         `Unmatched` and go through the existing screen (Q12).
      4. ⚠️ TDS IS WRITTEN ONLY WHEN THE CALLER PASSES ONE (slice TD, owner ruling 2026-08-12).
         This REVERSES the flat "NO TDS IS EVER WRITTEN" that stood here, and the reversal is
         narrow. The rule that survives is the one that mattered: **this import does not INVENT a
         deduction.** What it may now do, in one measured case, is DERIVE one -- `tds = amount -
         bank`, forced by arithmetic, on a `Service Requests` payment whose shortfall lands in the
         0.95-2.05% band that 584 of 671 real deductions occupy -- and only after a person has said
         in so many words that this is a deduction rather than a part payment.

         `tds=None` is the ordinary settle and is BYTE-IDENTICAL to before: the amount window
         applies to `amount` itself, `rewrite_amount` runs, and nothing touches `tds`.

         ⚠️ THE WINDOW IS NOT WIDENED FOR THIS -- IT IS POINTED AT THE RIGHT NUMBER. With a `tds`
         the assertion becomes `|amount - tds - bank| <= AMOUNT_TOLERANCE`, because `amount - tds`
         is what the bank was expected to move. Widening the window itself, or skipping the
         assertion, is the thing that must never happen: it gates every write on all three ledgers.

         ⚠️ AND THE AMOUNT IS LEFT ALONE. `rewrite_amount` is skipped entirely on this path. X1's
         rule ("the record takes the bank's figure") is about a record that should EQUAL the
         transfer; here the record is deliberately larger, by exactly the withholding, and
         overwriting it would destroy the invoiced figure the deduction is computed from.

    ⚠️ THE UTR GUARD IS NARROWED, NOT REMOVED (ADR-0020 D2, reversing owner ruling Q4). It used to
    refuse a reference already sitting on another payment outright -- fan-out was report-only,
    settled by hand. It now delegates to `reference_guard.assert_reference_is_free`, which allows a
    SIBLING settled from THIS SAME `transfer_id` and still refuses everything else, including a
    payment settled from a different transfer.

    `transfer_id` -- the row's transfer, threaded through so the guard can tell a fan-out sibling
    from a genuine collision. `None` (the default) reproduces the old strict rule exactly, which is
    what `settle_row` passes: an ordinary settle has no fan-out context to widen the guard with.

    `rewrite_amount_to_bank=False` is REQUIRED on an allocation leg and must never be defaulted
    away. X1's rule -- the record takes the bank's figure -- is about a record that should EQUAL
    the transfer. On a fan-out the bank's figure is the WHOLE TRANSFER, so applying it to leg 1
    rewrites a Rs 55,819 payment to Rs 2,13,396: a silent, catastrophic corruption that every
    existing test stays green through, because no existing test allocates. Paise gaps land in
    `allocation.is_fully_allocated`'s tolerance instead.

    `expected_amount` REPLACES THE BANK'S FIGURE IN THE WINDOW CHECK, FOR AN ALLOCATION LEG ONLY.
    `settle_row` passes nothing and the assertion is byte-identical to before: the record must equal
    the whole transfer. An allocation leg passes the payment's own amount, because a leg is by
    definition smaller than the transfer -- `allocation.allocation_fits` is what bounded it against
    the REMAINDER, and it has already run under this row's lock.

    THE CALLER OWNS THE TRANSACTION. `doc.save()` here fires the payment's own `on_update` and the
    controller's, and the `from_outflow_import` flag stops both from committing mid-save. Nothing
    in this function commits.
    """
    bank_amount = normalize_amount(getattr(row, "amount", 0))
    reference = (getattr(row, "bank_reference_no", "") or "").strip()
    # ⚠️ `expected_amount` REPLACES THE BANK'S FIGURE IN THE WINDOW CHECK, FOR AN ALLOCATION LEG
    # ONLY. `settle_row` passes nothing and the assertion is byte-identical to before: the record
    # must equal the whole transfer. An allocation leg passes the payment's own amount, because a
    # leg is by definition smaller than the transfer -- `allocation.allocation_fits` is what
    # bounded it against the REMAINDER, and it has already run under this row's lock.
    current = _lock_and_assert_payment_settleable(
        target_name, expected_amount if expected_amount is not None else bank_amount, tds=tds
    )
    if reference:
        _assert_reference_is_free(reference, target_name, transfer_id=transfer_id)

    doc = frappe.get_doc(PAYMENT_DOCTYPE, target_name)
    doc.status = _PAID
    # Q5b: the reference is only ever WRITTEN INTO A BLANK, never compared. Every non-Paid payment
    # in the database has an empty `utr` -- it is written at fulfilment -- so this always lands in
    # an empty field. Guarded anyway rather than trusting that to stay true.
    if reference and not (doc.utr or "").strip():
        doc.utr = reference
    payment_date = getattr(row, "added_on_date", None)
    if payment_date:
        doc.payment_date = payment_date

    written = current
    if tds is None:
        # ⚠️ THE REWRITE ITSELF IS GATED SEPARATELY (`rewrite_amount_to_bank`), NOT FOLDED INTO
        # THIS `tds is None` CHECK. An allocation leg also has `tds is None` -- it is not a
        # deduction settle -- so collapsing the two conditions into one `and` sent an allocation
        # leg straight into the `else` branch below and crashed on `format_tds(None)`. The `tds`
        # axis picks ordinary-settle vs deduction-settle; the `rewrite_amount_to_bank` axis picks
        # whether an ordinary settle may touch the amount at all.
        if rewrite_amount_to_bank:
            # X1: the payment takes the amount the bank actually moved, in either direction.
            # `current` was proven inside the settle window under the row lock a few lines up, so
            # the gap here is at most Rs 5 and is rounding, not a deduction.
            # `update_parent_amount_paid` SUMS the paid payments rather than incrementing, so the
            # PO's `amount_paid` picks this up on its own -- inside this same transaction, since
            # that hook's commit is suppressed for this path.
            exact = rewrite_amount(current, bank_amount)
            if exact is not None:
                doc.amount = format_amount_for(PAYMENT_DOCTYPE, exact)
                written = exact
        # ⚠️ ELSE: `rewrite_amount_to_bank=False` (an allocation leg). `bank_amount` here is the
        # WHOLE TRANSFER, not this leg's share of it -- rewriting to it would turn a Rs 55,819
        # payment into Rs 2,13,396. The amount stays exactly what it was; `written` stays `current`.
    else:
        # ⚠️ THE AMOUNT IS DELIBERATELY UNTOUCHED. The record is larger than the transfer by exactly
        # the withholding, and that is the point of it: `bank = amount - tds` is the relation the
        # whole ledger reads, and `_fulfil_payment` keeps it the same way. Rewriting `amount` to the
        # bank figure would destroy the invoiced number the deduction was computed from and leave a
        # `tds` describing a gap that no longer exists.
        #
        # ⚠️ `update_parent_amount_paid` SUMS `amount`, NOT `amount - tds`, so the parent records the
        # full approved figure as paid. That is what the manual fulfil path already does; it is
        # carried over unchanged and is not a decision made here.
        doc.tds = format_tds(tds)

    apply_statement_attachment(doc, statement_file_url)

    # ⚠️ SET BEFORE SAVE -- the hooks read it during the save, not after. This is what keeps the
    # per-row savepoint intact; see the comments at both hook sites.
    doc.flags.from_outflow_import = True
    # ⚠️ AND THE REQUEST FLAG BESIDE IT, for the THIRD committer -- the CEO-Hold cashflow hook,
    # which is wired to this doctype's `on_update` too and reaches its commit from a helper that
    # never sees `doc`. It was exposed to that commit before X1; the doc flag could never have
    # reached it. See `_outflow_import_write`.
    with _outflow_import_write():
        doc.save(ignore_permissions=True, ignore_version=False)

    _advance_po_latest_payment_date(doc, payment_date)

    return SettleResult(
        doctype=PAYMENT_DOCTYPE,
        name=target_name,
        amount=written,
        created=False,
        original_amount=current,
        tds_written=tds,
    )


def _lock_and_assert_payment_settleable(
    name: str, bank_amount: Decimal, tds: Decimal | None = None
) -> Decimal:
    """Re-read the payment UNDER A ROW LOCK and re-assert everything the reviewer saw.

    ⚠️ `for_update=True` WITHOUT `cache=True`, for the reason in the module docstring: a cached
    read takes no lock and this whole guard becomes decorative.

    ⚠️ `tds` DOES NOT RELAX THE WINDOW, IT CORRECTS WHAT THE WINDOW IS COMPARED AGAINST (slice TD).
    An ordinary settle expects the bank to have moved `amount`; a deduction settle expects it to
    have moved `amount - tds`. Both are held to the SAME `AMOUNT_TOLERANCE`. Anyone tempted to widen
    the tolerance so a TDS gap "fits" is about to break every write on all three ledgers -- that is
    the number `amounts.py` exists to keep in one place.
    """
    current = frappe.db.get_value(
        PAYMENT_DOCTYPE, name, ["status", "amount"], as_dict=True, for_update=True
    )
    if not current:
        frappe.throw(f"Payment '{name}' not found.", WrongStatusError, title="Not found")

    status = (current.get("status") or "").strip()
    if status == _PAID:
        frappe.throw(
            f"{name} was already marked Paid. Refresh to see who settled it.",
            AlreadyPaidError,
            title="Already settled",
        )
    if status not in settleable_statuses(PAYMENT_DOCTYPE):
        # Requested and CEO Pending land here. There is deliberately NO approval link and no nudge
        # -- nothing that cannot be settled is offered (owner ruling), and such a row should have
        # arrived as `Unmatched` rather than reaching this function at all.
        frappe.throw(
            f"{name} is '{status}', not Approved, and cannot be settled from a bank statement.",
            WrongStatusError,
            title="Not approved",
        )

    amount = normalize_amount(current.get("amount"))
    # ⚠️ THE SAME WINDOW THE MATCHER USES -- see `amounts.py`. It absorbs bank rounding and small
    # charges. Without a `tds` it CANNOT reach a deduction, which is thousands, and must not be
    # widened to; WITH one, the expected figure is `amount - tds` and the window is unchanged.
    expected = amount if tds is None else amount - to_decimal(tds)
    if not amounts_match(expected, bank_amount):
        if tds is None:
            frappe.throw(
                f"{name} is for {amount} but {bank_amount} left the bank, a difference of "
                f"{abs(amount - bank_amount)}. "
                f"A deduction such as TDS looks like this; settle it in the payments screen.",
                AmountMismatchError,
                title="Amounts differ",
            )
        # A deduction settle that does not reconcile: the caller derived `tds` from this very
        # transfer, so reaching here means the payment changed under the reviewer between the screen
        # and the lock. Say that, rather than repeating the TDS advice they have already taken.
        frappe.throw(
            f"{name} is for {amount} and a deduction of {to_decimal(tds)} would leave {expected}, "
            f"but {bank_amount} left the bank. The payment changed while this was being decided.",
            AmountMismatchError,
            title="Amounts differ",
        )
    return amount


def _assert_reference_is_free(
    reference: str, target_name: str, transfer_id: str | None = None
) -> None:
    """Delegates to the ONE definition in `services/outflow_import/reference_guard.py`.

    ⚠️ THIS USED TO HOLD THE RULE, AND ITS ERROR TEXT SAID "One transfer covering several payments
    is settled by hand in the payments screen." That sentence described owner ruling Q4, which
    ADR-0020 reverses -- the import can do it now. The guard is not removed, it is NARROWED: a
    payment already carrying this reference is still refused unless it is a sibling settled from
    THIS SAME TRANSFER.

    ⚠️ THE TAIL SENTENCE IS THIS CALLER'S OWN (fixed at review, Task 4). The import HAS a transfer
    in front of it, so it says so; the manual fulfil (`project_payments._fulfil_payment`) has none
    and supplies its own guidance instead -- see that call site.
    """
    assert_reference_is_free(
        reference,
        target_name,
        transfer_id=transfer_id,
        error_class=DuplicateReferenceError,
        tail="It was not settled from this transfer.",
    )


def _advance_po_latest_payment_date(doc, payment_date) -> None:
    """Keep the parent's `latest_payment_date` in step, the way the canonical fulfil does.

    ⚠️ ADVANCE-ONLY, which the canonical path is not -- it overwrites unconditionally. That is
    harmless when a human is fulfilling today's payment and wrong here, because a statement can be
    uploaded weeks late and would drag the parent's latest payment date BACKWARDS.

    Written with `set_value` rather than `po_doc.save()` to avoid firing the whole Procurement
    Order lifecycle once per settled row.
    """
    if not payment_date or not doc.document_type or not doc.document_name:
        return
    if not frappe.db.has_column(doc.document_type, "latest_payment_date"):
        return
    current = frappe.db.get_value(doc.document_type, doc.document_name, "latest_payment_date")
    # ⚠️ THE STORED VALUE IS A DATETIME AND THE BANK ROW'S IS A DATE, and comparing the two raises
    # rather than returning False -- so an unguarded `>=` here does not silently mis-order dates,
    # it aborts the settlement. Found by the V2 suite, which is the only reason it is not a
    # production 500 on the first payment settled against a PO that already had a payment date.
    if current is not None and _as_date(current) >= payment_date:
        return
    frappe.db.set_value(
        doc.document_type, doc.document_name, "latest_payment_date", payment_date
    )


def _as_date(value):
    """A `date` from either a `date` or a `datetime`. `datetime` subclasses `date`, so the
    isinstance order matters: check the subclass first."""
    if isinstance(value, datetime):
        return value.date()
    return value


def create_expense_from_row(
    row,
    doctype: str,
    expense_type: str,
    actor: str,
    project: str | None = None,
    description: str | None = None,
    vendor: str | None = None,
    comment: str | None = None,
    statement_file_url: str | None = None,
    payment_by: str | None = None,
    payment_ref: str | None = None,
) -> SettleResult:
    """Create a new expense, already `Paid`, from a bank row that matched nothing.

    This is the productive path for the ~13 of 43 rows in a real statement that are site rent,
    accommodation, utilities and sundries -- spend that never had a PO and so has no payment to
    reconcile against.
    """
    # "Create a new entry" can only ever be an expense. A `Project Payment` is born from a PO or SR
    # request and the import must NEVER mint one -- that is half the v3 spine.
    if not is_expense_doctype(doctype):
        frappe.throw(f"'{doctype}' is not an expense doctype.", WrongStatusError, title="Not an expense")
    _assert_type_scope(doctype, expense_type)

    amount = normalize_amount(getattr(row, "amount", 0))
    if amount <= 0:
        frappe.throw(
            "A transfer of zero or less cannot be recorded as an expense.",
            AmountMismatchError,
            title="Nothing to record",
        )

    beneficiary = (getattr(row, "beneficiary_name", "") or "").strip()
    remarks = (getattr(row, "remarks", "") or "").strip()

    doc = frappe.new_doc(doctype)
    doc.update(
        {
            "type": expense_type,
            # Set explicitly, and it is what bypasses auto-approval -- see the module docstring.
            "status": _PAID,
            "amount": format_amount_for(doctype, amount),
            "payment_date": getattr(row, "added_on_date", None),
            # ⚠️ WHAT IDENTIFIES THIS PAYMENT AT THE OTHER END, WHICH IS NOT THE SAME FIELD ON
            # EVERY SOURCE. A bank transfer is identified by its UTR and that stays the default. A
            # petty-cash wallet issues no UTR at all -- its own transaction id is the only thing
            # that will find the spend in the wallet's records -- so the caller names it. Leaving
            # this blank on 115 rows would make every one of them unverifiable against the wallet.
            "payment_ref": payment_ref or getattr(row, "bank_reference_no", "") or None,
            "description": description or _default_description(doctype, beneficiary, remarks),
            "comment": comment or None,
        }
    )
    if doctype == PROJECT_EXPENSE:
        if not project:
            frappe.throw(
                "A project is required for a project expense.",
                WrongStatusError,
                title="Missing project",
            )
        doc.projects = project
        doc.vendor = vendor or None
        # ⚠️ WHO SPENT IT, WHICH IS NOT ALWAYS WHO RECORDED IT. On a Cashfree settlement the two
        # are the same person -- an accountant reconciling a transfer -- and `actor` stays the
        # right default. A petty-cash wallet statement names the actual spender in its own `From`
        # column, and writing the importer's name over 115 rows would claim one accountant made
        # every purchase on the sheet. The caller passes it when the statement knows.
        doc.payment_by = payment_by or actor

    # A brand-new expense has no proof of its own, so the blank-only rule always lets this land --
    # which is the point: a record created FROM a statement should carry that statement.
    apply_statement_attachment(doc, statement_file_url)

    # ⚠️ THE INSERT IS WRAPPED, AND IT WAS NOT UNTIL B6a. `project_cashflow_hold_update.
    # on_project_expense` is wired to `Project Expenses` `after_insert`, it fires on an insert made
    # at `Paid`, and its manual-hold-releasable branch inserts a notification and calls
    # `frappe.db.commit()`. A commit inside `expenses.create_expense`'s per-row savepoint makes that
    # rollback A SILENT NO-OP -- a later failure would leave the expense standing while the caller
    # believed it had undone everything.
    #
    # It was harmless only because the path was DARK: `SHOW_CREATE_NEW_EXPENSE` was `false` from
    # slice R2 until B5 turned it on for the create-only bank-statement source. Enabling a path is
    # what made a latent transaction bug live, which is the general lesson worth keeping.
    #
    # The flag suppresses that ONE notification branch. The gap recomputation and the CEO-Hold
    # mirror still run, inside our transaction -- see `_outflow_import_write` for why this is a
    # request-level flag rather than a `doc.flags` one (the committer is an inner helper that never
    # sees the doc). `create_inflow_from_row` has always wrapped its insert for the same reason.
    with _outflow_import_write():
        doc.insert(ignore_permissions=True)
    return SettleResult(doctype=doctype, name=doc.name, amount=amount, created=True)


def create_inflow_from_row(
    row,
    actor: str,
    project: str,
    customer: str | None = None,
    invoice: str | None = None,
    utr: str | None = None,
    payment_date=None,
    statement_file_url: str | None = None,
    direction: str | None = None,
) -> SettleResult:
    """Record a bank CREDIT as a new `Project Inflow` (slice B6).

    ⚠️ A SIBLING OF `create_expense_from_row`, NEVER A WIDENING OF IT. That function opens with a
    hard `is_expense_doctype` guard and its whole contract is expense-shaped -- a `type`, a
    `status`, a `payment_by`, an auto-approval rule it deliberately bypasses. An inflow has none of
    those. What the two DO share is the machinery, and every bit of it is reused rather than
    re-typed: `apply_statement_attachment`, `format_amount_for`, `_outflow_import_write`.

    ⚠️ THIS IS THE ONE WRITE IN THIS FEATURE WITH NO DRAFT STATE ANYWHERE BEHIND IT, and that is an
    owner ruling (Q8, option c), not an oversight. `Project Inflows` has no `status` field, and
    EVERY consumer sums it unfiltered -- `api/projects/project_aggregates`,
    `api/payments/get_project_payment_summary`, `api/customers/customer_financials`, and
    `integrations/controllers/project_cashflow_hold_update`, which computes
    `cashflow_gap = outflow + liabilities - inflow` and drives CEO Cashflow Hold. So a row created
    here is LIVE the instant it commits and can RELEASE a CEO Hold. The review gate is the bank row
    itself: a person confirms the transfer, and confirming creates. Do NOT add a status field to
    this doctype to give this path a draft -- that is a migration across every financial screen and
    ~4,000 existing rows, and it is not what the owner asked for.

    ⚠️ THE `tendering_status == "Won"` GUARD IS INHERITED, NOT REPEATED.
    `integrations/controllers/project_inflows.validate` enforces it on every new inflow, which is
    why this path writes through `doc.insert()` -- a `frappe.db.set_value`-style write would skip
    the document lifecycle and the guard with it. Duplicating the check here would be a second copy
    of a rule that already has an owner.

    ⚠️ THE CUSTOMER REQUIREMENT IS ENFORCED HERE, AND DELIBERATELY NOT ON THE DOCTYPE (owner ruling
    Q13). Today it lives only in `NewInflowPayment.tsx` -- client-side, on a screen nobody asked to
    change. Moving it onto `Project Inflows.validate` would start refusing writes from that existing
    dialog and from every legacy edit, which is a behaviour change to a working screen riding a
    slice about bank statements. Enforcing it on the path that writes SERVER-SIDE is what closes the
    hole this endpoint opens without touching anything else.

    ⚠️ THE CUSTOMER IS READ FROM THE PROJECT, NEVER TAKEN ON TRUST. It is a FACT about the project,
    not a free choice -- the existing dialog derives it exactly this way. A `customer` argument that
    disagrees is a screen that has gone stale, and is refused rather than silently overruled.
    """
    # A DEBIT recorded as an inflow would book money that LEFT the account as money that arrived.
    # The direction is passed in because `_StagedRow` does not carry it (`__slots__`), and it is
    # checked here rather than in the endpoint so the rule sits with the write it governs.
    if direction is not None and (direction or "").strip() != DIRECTION_CREDIT:
        frappe.throw(
            "Only a credit can be recorded as a project inflow. This transfer is a "
            f"{(direction or '').strip() or 'transfer with no stated direction'}.",
            InflowNotRecordableError,
            title="Not a credit",
        )

    amount = normalize_amount(getattr(row, "amount", 0))
    if amount <= 0:
        # Mirrors `create_expense_from_row`'s guard, in the inflow's own voice. `AmountMismatchError`
        # rather than the inflow error because the fault is the FIGURE, which is the one thing on
        # this path the reviewer cannot correct.
        frappe.throw(
            "A credit of zero or less cannot be recorded as a project inflow.",
            AmountMismatchError,
            title="Nothing to record",
        )

    if not project:
        frappe.throw(
            "A project is required to record a project inflow.",
            InflowNotRecordableError,
            title="Missing project",
        )
    on_project = frappe.db.get_value("Projects", project, ["name", "customer"], as_dict=True)
    if not on_project:
        frappe.throw(
            f"Project '{project}' not found.", InflowNotRecordableError, title="Missing project"
        )

    on_record = (on_project.get("customer") or "").strip()
    if not on_record:
        frappe.throw(
            f"{project} has no customer, so money received against it cannot be recorded. "
            f"Add the customer to the project first.",
            InflowNotRecordableError,
            title="Project has no customer",
        )
    supplied = (customer or "").strip()
    if supplied and supplied != on_record:
        frappe.throw(
            f"{project}'s customer is {on_record}, not {supplied}. Reopen this row and try again.",
            InflowNotRecordableError,
            title="Customer changed",
        )

    linked_invoice = (invoice or "").strip() or None
    if linked_invoice:
        # ⚠️ THE INVOICE MUST BELONG TO THE PROJECT. Nothing on `Project Inflows` enforces it, and a
        # cross-project link would silently credit one project's receipt against another's bill.
        invoice_project = frappe.db.get_value("Project Invoices", linked_invoice, "project")
        if not invoice_project:
            frappe.throw(
                f"Invoice '{linked_invoice}' not found.",
                InflowNotRecordableError,
                title="Missing invoice",
            )
        if invoice_project != project:
            frappe.throw(
                f"Invoice {linked_invoice} belongs to {invoice_project}, not {project}.",
                InflowNotRecordableError,
                title="Invoice is on another project",
            )

    doc = frappe.new_doc(INFLOW_DOCTYPE)
    doc.update(
        {
            "project": project,
            "customer": on_record,
            "invoice": linked_invoice,
            # WHAT FINDS THIS RECEIPT AT THE OTHER END, and the axis the duplicate guard keys on.
            # Defaulted from the row's own bank reference; the caller may name a different field for
            # a source whose reference lives elsewhere, exactly as `create_expense_from_row` allows.
            "utr": (utr or "").strip() or (getattr(row, "bank_reference_no", "") or "") or None,
            # `Project Inflows.amount` is a Data column -- see `format_amount_for`.
            "amount": format_amount_for(INFLOW_DOCTYPE, amount),
            "payment_date": payment_date or getattr(row, "added_on_date", None),
        }
    )
    # ⚠️ `actor` IS NOT WRITTEN ONTO THE RECORD, AND THAT IS NOT AN OVERSIGHT -- IT IS UNWRITEABLE.
    # This ledger has no `payment_by` counterpart (the `Project Expenses` asymmetry, one field
    # further), and `owner` cannot carry it either: `frappe.model.document.set_user_and_timestamp`
    # OVERWRITES `owner` with `frappe.session.user` on every new doc, unconditionally. Assigning it
    # here would read as deliberate and be a silent no-op -- so it is left to Frappe, which lands the
    # same value because `require_outflow_access` returns the session user. The DURABLE answer to
    # "who recorded this" is the `Outflow Row Match`'s `matched_by`, written by the caller.
    #
    # The parameter stays because it is part of this family's signature and a future ledger, or a
    # background caller running as someone else, will need it.

    # A brand-new inflow has no proof of its own, so the blank-only rule always lets this land.
    # ⚠️ IT WRITES `inflow_attachment`, NOT `payment_attachment` -- see `statement_attachment_field`.
    apply_statement_attachment(doc, statement_file_url)

    # ⚠️ THE REQUEST FLAG IS REQUIRED HERE, AND `create_expense_from_row` NOT HAVING ONE IS NOT
    # EVIDENCE THAT IT IS OPTIONAL. `hooks.py` wires `project_cashflow_hold_update.on_project_inflow`
    # to this doctype's `after_insert` AND `on_update`, and that module reaches a `frappe.db.commit()`
    # in ONE branch -- notifying the holder of a MANUAL CEO Hold that has become releasable. An
    # inflow is the single largest thing that can move a cashflow gap the right way, so that branch
    # is not hypothetical here. A commit inside the caller's per-row savepoint makes its rollback a
    # silent no-op. The flag suppresses the NOTIFY only; `sync_cashflow_reason` still recomputes the
    # gap and still mirrors the CEO-Hold state, inside our transaction, which is what the owner
    # ruling requires -- an inflow recorded here is live immediately.
    with _outflow_import_write():
        doc.insert(ignore_permissions=True)

    return SettleResult(doctype=INFLOW_DOCTYPE, name=doc.name, amount=amount, created=True)


def create_non_project_receipt_from_row(
    row,
    actor: str,
    expense_type: str,
    direction: str,
    description: str | None = None,
    comment: str | None = None,
    statement_file_url: str | None = None,
) -> SettleResult:
    """Record a bank CREDIT that belongs to no project, as a NEGATIVE `Non Project Expense` (B7).

    The second disposition a credit can take. `create_inflow_from_row` handles a receipt that has a
    project and a customer behind it -- a client payment against an invoice. This one handles the
    rest: FD and RD interest, an FD closing and returning its principal, a loan drawdown landing,
    a site advance coming back. None of those name a project, so none of them can be an inflow.

    ⚠️ THERE IS NO NON-PROJECT INFLOW DOCTYPE IN THIS APP AND NONE IS BEING CREATED (owner ruling
    Q3, ADR-0016 decision 3). A negative `Non Project Expense` is not a hack invented here -- it is
    the construct the app already has for money coming back, and three separate places already know
    about it: `NewNonProjectExpense.tsx` tells the user "use negative for refunds",
    `nonProjectExpensesColumns.tsx` renders a negative amount GREEN, and `utils/expenseApproval.ts`
    (mirrored by this doctype's own controller) excludes a negative amount from auto-approval.

    ⚠️ THE COST, STATED HONESTLY BECAUSE IT IS INHERENT TO THE RULING AND NOT OURS TO SOFTEN: money
    ARRIVING is now stored in a doctype called *Expenses*, and anyone summing that table meets a
    negative row. The alternative -- a new doctype with new permissions, list views and reports --
    was weighed and rejected; ADR-0016 carries it as accepted risk R3. The new `non_project=1`
    Expense Types (Q19) are what make such a row say what it is on the screen it lands in.

    ⚠️ THIS IS THE ONE SIGNED WRITE IN THIS MODULE, AND EVERY PART OF HOW IT IS FENCED IS
    STRUCTURAL. Read all four before changing anything here:

      1. **It is a separate function, never a widening of `create_expense_from_row`.** That one's
         `amount <= 0` guard is CORRECT for a debit -- a transfer out of zero or less is not a
         spend -- and it is on a live path. A `signed=True` flag would have put two opposite rules
         inside one body, where the wrong branch is one boolean away and reads as a typo.
      2. **There is no `doctype` parameter.** `NON_PROJECT_EXPENSE` is spelled once, below, and
         cannot be overridden by any caller. That is what makes "a credit never becomes a negative
         `Project Expense`" a property of the signature rather than a guard someone could forget:
         that ledger's `amount` is a **Data** column holding bare numeric strings, and its
         `projects` / `vendor` / `payment_by` fields mean nothing on a receipt.
      3. **`direction` is REQUIRED and must be `Credit`**, where the sibling
         `create_inflow_from_row` tolerates `None`. The difference is deliberate: there the
         direction picks a LEDGER and a wrong one is refused downstream by the project/customer
         rules; here it picks a SIGN, and a missing direction defaulting open would let a DEBIT be
         booked as income -- the books wrong by twice the transfer, with nothing on screen looking
         odd. Silence is not consent on this path.
      4. **The negation happens HERE, from the direction, never from the row.** `row.amount` is the
         positive magnitude every source stores and every other guard in this feature assumes
         (ADR-0016 rejected a signed amount column for exactly that reason). Nothing trusts a sign
         arriving from a staged row or from a client.

    ⚠️ IT IS CREATED AT `Paid`, LIKE ITS DEBIT SIBLING, AND THAT DELIBERATELY BYPASSES THE
    APPROVAL LADDER. `validate()` returns early for any status other than `Requested`, so the
    negative-amount exclusion from auto-approval never evaluates -- which is the right outcome, not
    a way around it: the money has already arrived, and asking somebody to *approve* a receipt the
    bank has already credited is theatre. The review gate is the bank row itself (owner ruling Q8),
    exactly as for an inflow.
    """
    # (3) above. Checked before anything else is read, because everything after it is signed.
    if (direction or "").strip() != DIRECTION_CREDIT:
        frappe.throw(
            "Only a credit can be recorded as a non-project receipt. This transfer is a "
            f"{(direction or '').strip().lower() or 'transfer with no stated direction'}, so it "
            f"took money out.",
            InflowNotRecordableError,
            title="Not a credit",
        )

    _assert_type_scope(NON_PROJECT_EXPENSE, expense_type)

    # THE MAGNITUDE, exactly as every other path reads it. The guard is on the magnitude and reads
    # the same way `create_expense_from_row`'s does -- a credit of nothing is nothing to record.
    magnitude = normalize_amount(getattr(row, "amount", 0))
    if magnitude <= 0:
        frappe.throw(
            "A credit of zero or less cannot be recorded as a non-project receipt.",
            AmountMismatchError,
            title="Nothing to record",
        )

    # (4) above: the sign is applied here, once, from the direction already asserted.
    received = -magnitude

    beneficiary = (getattr(row, "beneficiary_name", "") or "").strip()
    remarks = (getattr(row, "remarks", "") or "").strip()

    doc = frappe.new_doc(NON_PROJECT_EXPENSE)
    doc.update(
        {
            "type": expense_type,
            # See the docstring: explicit, and it is what bypasses the approval ladder.
            "status": _PAID,
            # `Non Project Expenses.amount` is a real Currency column, so this is a float -- and it
            # is the ONE place in this module where that float is below zero.
            "amount": format_amount_for(NON_PROJECT_EXPENSE, received),
            "payment_date": getattr(row, "added_on_date", None),
            # WHAT FINDS THIS RECEIPT AT THE OTHER END. The same field the debit path writes, from
            # the same place on the row -- a receipt is reconciled against the statement exactly as
            # a payment is.
            "payment_ref": getattr(row, "bank_reference_no", "") or None,
            # ⚠️ THE PAYER LANDS IN THE DESCRIPTION, and on this ledger there is nowhere else for
            # them to go: `Non Project Expenses` has NO vendor column. `_default_description` is
            # shared with the debit path for that same reason.
            "description": description or _default_description(
                NON_PROJECT_EXPENSE, beneficiary, remarks
            ),
            "comment": comment or None,
        }
    )

    # A brand-new record has no proof of its own, so the blank-only rule always lets this land.
    apply_statement_attachment(doc, statement_file_url)

    # ⚠️ WRAPPED EVEN THOUGH `Non Project Expenses` CARRIES NO COMMITTING HOOK TODAY -- its only
    # `doc_events` entry is `on_trash`. The flag costs nothing, restores the previous value, and is
    # what the other two create paths do; the alternative is a bare insert that becomes a
    # savepoint-corrupting hazard the day somebody wires an `after_insert` here, with nothing at
    # this call site to say so. `create_expense_from_row` learned that at B6a, on a path that had
    # been dark.
    with _outflow_import_write():
        doc.insert(ignore_permissions=True)

    # ⚠️ `amount` IS THE NEGATIVE FIGURE THAT WAS WRITTEN, not the bank's magnitude, because that is
    # what `SettleResult.amount` means ("the amount written, not the amount found"). It reaches the
    # `Outflow Row Match`'s `target_amount` and the export's `settled_target_amount`, where a
    # negative is the truth about what this settlement recorded. ⚠️ It is NOT summed anywhere: the
    # batch totals read the ROW's own `amount` (`review.py` says so in its own note), so a negative
    # here cannot net anything off.
    return SettleResult(
        doctype=NON_PROJECT_EXPENSE, name=doc.name, amount=received, created=True
    )


def _default_description(doctype: str, beneficiary: str, remarks: str) -> str:
    """Compose a description when the reviewer does not type one.

    The beneficiary name is included deliberately: `Non Project Expenses` has NO vendor column, so
    without it the record loses who was actually paid (owner ruling). On the project side it is
    still worth keeping -- `vendor` is optional there and populated on 0.58% of live rows.
    """
    parts = [p for p in (beneficiary, remarks) if p]
    return " - ".join(parts) if parts else "Imported from bank statement"
