# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Editing a Cheque from the Cheque Tracker (#1418, #1486, spec #1477; spec #1514). Pure: no `frappe.db`.
`writer.edit_cheque` asks it.

The Tracker makes no cheque (spec #1514, ADR-0035 Amendment A): a Payment cheque is made with its payment on
the PO page, and its Edit corrects only what was written wrongly on the paper, never what it pays.

Each `*_problem` function returns the refusal a user reads, or None.
"""

from nirmaan_stack.services.cheques.rules import (
    CHEQUE_TYPE_PAYMENT,
    CHEQUE_TYPE_SECURITY_DEPOSIT,
    ISSUED,
    PENDING,
    ChequeHeader,
    ChequeLineInput,
    join_words,
)


#: The header fields an edit compares. The photo (`attachment`) is apart: it may always be replaced.
EDITABLE_HEADER_FIELDS = (
    "bank", "bank_name", "cheque_no", "cheque_date", "amount", "vendor", "payee_name", "description",
)
#: What an Approval Pending Payment cheque's edit may change besides its photo: what is written on the paper
#: (spec #1514). Its amount, payee, note and lines are what it pays, and stay as made.
PAYMENT_CHEQUE_EDITABLE_FIELDS = ("bank", "bank_name", "cheque_no", "cheque_date")
#: Each fixed header field as a refusal names it.
FIXED_FIELD_WORDS = {"amount": "amount", "vendor": "Vendor", "payee_name": "payee", "description": "note"}
#: The statuses at which a Payment cheque may change more than its photo: Approval Pending, before its payments
#: are approved (#1482). Once Issued its payments and the bank line follow it as it is.
EDITABLE_STATUSES = (PENDING,)
#: A Security Deposit cheque is Issued from the start and changes while it is (#1486, story 79); once
#: Cancelled only its photo can change.
DEPOSIT_EDITABLE_STATUSES = (ISSUED,)


def editable_statuses(cheque_type: str) -> tuple:
    """The statuses at which a Cheque of `cheque_type` may change more than its photo."""
    return DEPOSIT_EDITABLE_STATUSES if cheque_type == CHEQUE_TYPE_SECURITY_DEPOSIT else EDITABLE_STATUSES


def edit_access_problem(
    *, status: str, owner: str, user: str, any_cheque: bool, cheque_type: str = CHEQUE_TYPE_PAYMENT
) -> str | None:
    """Why `user` may not edit this Cheque, or None. `any_cheque` is True for Admin, Accountant and
    Accountant Lead; anyone else who may use cheques (Procurement) edits only the Cheques they created,
    a Payment cheque while Pending (C6), a Security Deposit cheque while Issued (`editable_statuses`)."""
    if any_cheque or (status in editable_statuses(cheque_type) and owner == user):
        return None
    if cheque_type == CHEQUE_TYPE_SECURITY_DEPOSIT:
        return "You can edit only the Issued Security Deposit cheques you created."
    return f"You can edit only the {PENDING} cheques you created."


def edit_problem(
    before: ChequeHeader,
    after: ChequeHeader,
    *,
    status: str,
    lines_before: list[ChequeLineInput],
    lines_after: list[ChequeLineInput],
    old_type: bool = False,
    cheque_type: str = CHEQUE_TYPE_PAYMENT,
) -> str | None:
    """Why this edit of a Cheque cannot be saved, or None. The rules are the ones the editor sees:

    * the photo can be replaced, never removed;
    * an Old-type cheque (spec #1477) can change only its photo, whatever its status;
    * an Approval Pending Payment cheque can change its number, bank, date and photo (`PAYMENT_CHEQUE_EDITABLE_FIELDS`),
      never its amount, payee, note or lines (spec #1514): it pays what it was made for, and a cheque that
      already pays several POs stays as it is;
    * an Issued, Cleared or Cancelled Payment cheque can change only its photo (`EDITABLE_STATUSES`);
    * a Security Deposit cheque changes in full while Issued and only its photo once Cancelled (#1486).

    The header and line rules every save runs (one payee, a live Cheque per payment, ...) are the
    `validate` controller's, not repeated here.
    """
    if before.attachment and not after.attachment:
        return "The cheque's photo can be replaced, not removed."
    changed = [f for f in EDITABLE_HEADER_FIELDS if getattr(before, f) != getattr(after, f)]
    lines_changed = lines_before != lines_after
    if old_type and (changed or lines_changed):
        return f"Cheque {before.cheque_no} is an Old-type cheque: only its photo can change."
    if status not in editable_statuses(cheque_type):
        if changed or lines_changed:
            return f"Cheque {before.cheque_no} is {status}: only its photo can change."
        return None
    if cheque_type == CHEQUE_TYPE_SECURITY_DEPOSIT:
        return None
    fixed = [FIXED_FIELD_WORDS[f] for f in changed if f not in PAYMENT_CHEQUE_EDITABLE_FIELDS]
    if fixed:
        return f"Cheque {before.cheque_no} can change only its number, bank, date and photo, not its {join_words(fixed)}."
    if lines_changed:
        return (
            f"Cheque {before.cheque_no}'s lines cannot change: it pays what it was made for. To pay something "
            "else, cancel it and raise the payment again from the PO."
        )
    return None
