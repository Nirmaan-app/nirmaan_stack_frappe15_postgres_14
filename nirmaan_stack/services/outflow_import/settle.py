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
RUNG of a ladder somebody else already climbed. It cannot approve. It cannot create a payment --
"create a new entry" is expenses-only, because a `Project Payment` is born from a PO or SR request.
And nothing settles without a per-row human confirmation. If a future change lets this import
approve something, that is the invariant breaking, not a feature.

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
"""

from __future__ import annotations

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
from nirmaan_stack.services.outflow_import.amounts import amounts_match
from nirmaan_stack.services.outflow_import.ledgers import PAYMENT_DOCTYPE
from nirmaan_stack.services.outflow_import.ledgers import (
    SETTLEABLE_STATUSES,
    is_expense_doctype,
    settleable_statuses,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_amount

__all__ = [
    "PROJECT_EXPENSE",
    "NON_PROJECT_EXPENSE",
    "SETTLEABLE_STATUSES",
    "ExpenseSettlementError",
    "AlreadyPaidError",
    "WrongStatusError",
    "AmountMismatchError",
    "ExpenseTypeScopeError",
    "DuplicateReferenceError",
    "SettleResult",
    "settle_existing_expense",
    "settle_payment",
    "create_expense_from_row",
    "format_amount_for",
]


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


@dataclass(frozen=True)
class SettleResult:
    doctype: str
    name: str
    amount: Decimal
    created: bool


def format_amount_for(doctype: str, amount: Decimal):
    """Format money the way the target doctype actually stores it.

    `Project Expenses.amount` is a Data column: 2,574 live rows hold bare numeric strings, no
    commas, no symbol. Handing it a float would store `5000.0` where every neighbour holds `5000`,
    and the numeric CAST the candidate query relies on would still work but the column would stop
    being self-consistent. `Non Project Expenses.amount` is a real Currency column and wants a
    number.
    """
    if doctype == PROJECT_EXPENSE:
        normalized = amount.normalize()
        if normalized == normalized.to_integral_value():
            return str(int(normalized))
        return format(normalized, "f")
    return float(amount)


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
) -> SettleResult:
    """Mark an already-approved expense `Paid` from a bank row.

    ⚠️ EXPENSES ONLY, still. `Project Payments` is in `SETTLEABLE_STATUSES` from V1 on, so this
    guard tests `is_expense_doctype` rather than map membership -- the map answers "what status may
    I settle this from", not "may THIS module settle it". V2 adds the payment path beside this one.
    """
    if not is_expense_doctype(target_doctype):
        frappe.throw(
            f"'{target_doctype}' is not an expense doctype.",
            WrongStatusError,
            title="Not an expense",
        )

    bank_amount = normalize_amount(getattr(row, "amount", 0))
    amount = _lock_and_assert_settleable(target_doctype, target_name, bank_amount)

    values = {
        "status": _PAID,
        "payment_date": getattr(row, "added_on_date", None),
        "payment_ref": getattr(row, "bank_reference_no", "") or None,
    }
    # payment_by exists ONLY on Project Expenses, and it is the finalising user -- deliberately NOT
    # the statement's "Added by", which the gateway truncates to 15 characters (owner ruling).
    if target_doctype == PROJECT_EXPENSE:
        values["payment_by"] = actor

    frappe.db.set_value(target_doctype, target_name, values, update_modified=True)
    return SettleResult(
        doctype=target_doctype, name=target_name, amount=amount, created=False
    )


def settle_payment(row, target_name: str, actor: str) -> SettleResult:
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
      3. THE AMOUNT MUST MATCH EXACTLY, as it must for an expense. A TDS payment therefore cannot
         be settled here at all -- the bank sends `amount - tds` -- which is the accepted cost of
         deferring the tolerance pass (Q11). Those rows stay `Unmatched` and go through the
         existing screen, which is unchanged and always available (Q12).
      4. NO TDS IS EVER WRITTEN. `tds` is recorded at fulfilment by a human who knows the
         deduction; this import does not know it and must not invent one. The field is left alone.

    THE UTR GUARD IS KEPT AS-IS (owner ruling Q4). It refuses a reference already sitting on
    another payment, which would throw on the second payment of a fan-out group -- and fan-out is
    report-only, settled by hand, so the guard is never legitimately challenged.

    THE CALLER OWNS THE TRANSACTION. `doc.save()` here fires the payment's own `on_update` and the
    controller's, and the `from_outflow_import` flag stops both from committing mid-save. Nothing
    in this function commits.
    """
    bank_amount = normalize_amount(getattr(row, "amount", 0))
    reference = (getattr(row, "bank_reference_no", "") or "").strip()
    current = _lock_and_assert_payment_settleable(target_name, bank_amount)
    if reference:
        _assert_reference_is_free(reference, target_name)

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

    # ⚠️ SET BEFORE SAVE -- the hooks read it during the save, not after. This is what keeps the
    # per-row savepoint intact; see the comments at both hook sites.
    doc.flags.from_outflow_import = True
    doc.save(ignore_permissions=True)

    _advance_po_latest_payment_date(doc, payment_date)

    return SettleResult(
        doctype=PAYMENT_DOCTYPE, name=target_name, amount=current, created=False
    )


def _lock_and_assert_payment_settleable(name: str, bank_amount: Decimal) -> Decimal:
    """Re-read the payment UNDER A ROW LOCK and re-assert everything the reviewer saw.

    ⚠️ `for_update=True` WITHOUT `cache=True`, for the reason in the module docstring: a cached
    read takes no lock and this whole guard becomes decorative.
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
    # charges; it CANNOT reach a TDS deduction, which is thousands, and must not be widened to.
    if not amounts_match(amount, bank_amount):
        frappe.throw(
            f"{name} is for {amount} but {bank_amount} left the bank, a difference of "
            f"{abs(amount - bank_amount)}. "
            f"A deduction such as TDS looks like this; settle it in the payments screen.",
            AmountMismatchError,
            title="Amounts differ",
        )
    return amount


def _assert_reference_is_free(reference: str, target_name: str) -> None:
    """Refuse a bank reference already recorded on a DIFFERENT payment (owner ruling Q4).

    Mirrors the canonical fulfil's guard. The comparison is on the stored value as-is, exactly as
    that path does it -- this is not the normalised matcher key, and widening it here would change
    the behaviour of a guard the owner explicitly chose to leave alone.
    """
    existing = frappe.db.get_value(PAYMENT_DOCTYPE, {"utr": reference}, "name")
    if existing and existing != target_name:
        frappe.throw(
            f"Bank reference {reference} is already recorded on payment {existing}. "
            f"One transfer covering several payments is settled by hand in the payments screen.",
            DuplicateReferenceError,
            title="Reference already used",
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
            "payment_ref": getattr(row, "bank_reference_no", "") or None,
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
        doc.payment_by = actor

    doc.insert(ignore_permissions=True)
    return SettleResult(doctype=doctype, name=doc.name, amount=amount, created=True)


def _default_description(doctype: str, beneficiary: str, remarks: str) -> str:
    """Compose a description when the reviewer does not type one.

    The beneficiary name is included deliberately: `Non Project Expenses` has NO vendor column, so
    without it the record loses who was actually paid (owner ruling). On the project side it is
    still worth keeping -- `vendor` is optional there and populated on 0.58% of live rows.
    """
    parts = [p for p in (beneficiary, remarks) if p]
    return " - ".join(parts) if parts else "Imported from bank statement"
