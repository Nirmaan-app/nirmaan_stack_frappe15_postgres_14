# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Expense settlement -- THE ONLY WRITE IN THIS FEATURE (Bulk Import Outflow, slice S5).

Everything else in Bulk Import Outflow reads and reports. This module is where a bank row actually
changes something outside the import's own staging: an approved expense becomes `Paid`, or a new
expense is created already `Paid`. Nothing here may ever touch `Project Payments`, `PO Payment
Terms`, or a Procurement Order's `amount_paid` -- that is the payment branch's contract (owner
decision R1), and it holds by this module simply not knowing how.

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
from decimal import Decimal

import frappe

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
    "SettleResult",
    "settle_existing_expense",
    "create_expense_from_row",
    "format_amount_for",
]

PROJECT_EXPENSE = "Project Expenses"
NON_PROJECT_EXPENSE = "Non Project Expenses"

# Mirrors `candidates.load_expense_targets`. The non-project side includes `Requested` because it
# has no separate approval step in practice; a settleable pool of `Approved` only would be empty.
SETTLEABLE_STATUSES = {
    PROJECT_EXPENSE: ("Approved",),
    NON_PROJECT_EXPENSE: ("Approved", "Requested"),
}

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
    if status not in SETTLEABLE_STATUSES[doctype]:
        frappe.throw(
            f"{name} is '{status}' and cannot be settled from a bank statement.",
            WrongStatusError,
            title="Not settleable",
        )

    amount = normalize_amount(current.get("amount"))
    if amount != bank_amount:
        frappe.throw(
            f"{name} is for {amount} but {bank_amount} left the bank. "
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
    """Mark an already-approved expense `Paid` from a bank row."""
    if target_doctype not in SETTLEABLE_STATUSES:
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
    if doctype not in SETTLEABLE_STATUSES:
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
