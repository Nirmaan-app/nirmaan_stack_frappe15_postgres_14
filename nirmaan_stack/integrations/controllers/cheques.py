# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Lifecycle controller for the Cheques doctype (spec #1407).

`validate` holds the Cheque's own rules on EVERY write path (the cheques service, a patch, Desk):
the header rules in `services/cheques/rules.header_problem`, the line rules in
`services/cheques/lines.lines_problem` (a payment or expense on one live Cheque only, each PO/WO the
Vendor's so a typed payee takes expense lines only, a Project Expense in its line's project, a
Security Deposit cheque's Secured PO/WO lines and no other kind, #1486), and the bank + cheque number
uniqueness.
It also keeps the stored identity in step: `cheque_no` without spaces, `bank_key` derived from the
bank, and no bank name on an ICICI Bank cheque. The unique constraint on `bank_key` + `cheque_no`
(`Cheques.on_doctype_update`) backs this up against two saves racing.

A backfilled Cheque (#1419) has no photo: its writer sets `doc.flags.cheque_without_photo`.

`drop_off_cheques_of` is the hook side of #1413: a deleted payment or expense drops off every Cheque
that lists it (`services/cheques/detach.py`). The payment controller calls it from `on_trash`;
`on_expense_trash` is registered on both expense doctypes. A Rejected payment goes through
`on_payment_rejected` (#1481): on a live Payment cheque it rejects every payment and cancels the
cheque; only an Old-type cheque still drops the line.
"""

import frappe
from frappe import _

from nirmaan_stack.services.cheques.decide import DECIDING_FLAG, live_cheque_of, reject_cheque, rejected_alone_note
from nirmaan_stack.services.cheques.detach import DELETED, drop_off_cheques
from nirmaan_stack.services.cheques.lines import lines_problem, normalise_lines
from nirmaan_stack.services.cheques.rules import (
    CANCELLED,
    CHEQUE_TYPE_PAYMENT,
    PAYMENT_REJECTED,
    duplicate_problem,
    header_problem,
    parse_header,
)
from nirmaan_stack.services.cheques.writer import CHEQUES_CHANGED_EVENT, existing_cheque


def validate(doc, method=None):
    header = parse_header(doc.as_dict())
    doc.cheque_no = header.cheque_no
    doc.bank_name = header.bank_name
    doc.bank_key = header.bank_key

    problem = header_problem(
        header,
        line_count=len(doc.get("lines") or []),
        photo_required=doc.is_new() and not doc.flags.cheque_without_photo,
        cancelled=doc.status == CANCELLED,
        cheque_type=doc.get("cheque_type") or CHEQUE_TYPE_PAYMENT,
        drawn_anew=_drawn_anew(doc, header),
    )
    if problem:
        frappe.throw(_(problem))

    normalise_lines(doc)
    problem = lines_problem(doc)
    if problem:
        frappe.throw(_(problem))

    existing = existing_cheque(header.bank, header.bank_name, header.cheque_no, exclude=None if doc.is_new() else doc.name)
    if existing:
        frappe.throw(_(duplicate_problem(header, existing)))


def _drawn_anew(doc, header) -> bool:
    """Is this save a new paper cheque: a new Cheque, or one whose bank or number changes? The ICICI-only
    rule for a Payment cheque (#1516) asks it, so a status move on an older Cheque on Others still saves."""
    before = None if doc.is_new() else doc.get_doc_before_save()
    if before is None:
        return True
    was = parse_header(before.as_dict())
    return (was.bank_key, was.cheque_no) != (header.bank_key, header.cheque_no)


def drop_off_cheques_of(doc, why: str, *, old_type_only: bool = False, keep_on: str | None = None) -> None:
    """Take `doc` (a payment or an expense) off every Cheque that lists it (only Old-type ones when
    `old_type_only`), except `keep_on`, as the user acting, and tell open reports once the request commits.
    Never commits."""
    changed = drop_off_cheques(doc.doctype, doc.name, why=why, user=frappe.session.user, old_type_only=old_type_only,
                               keep_on=keep_on)
    if changed:
        frappe.publish_realtime(CHEQUES_CHANGED_EVENT, {"cheques": changed}, after_commit=True)


def on_payment_rejected(doc) -> None:
    """A Project Payment was saved to Rejected (#1481, spec #1477). Called from the payment's `on_update`.

    On a live (Pending or Issued) Payment cheque, every other payment on it is rejected too and the cheque
    is Cancelled (`decide.reject_cheque`), however this one was rejected: the approval dialog and bulk
    reject go through `decide.reject` and carry `DECIDING_FLAG`, so their saves land here and stop; a
    save made any other way (REST, Desk) starts the cascade, with a note naming this payment. An Old-type
    cheque still drops the line (#1413), except the one whose own cancel is rejecting it (`DECIDING_FLAG`,
    spec #1514) and any already Cancelled (`detach.drop_off_cheques`): a cancelled cheque keeps its lines. Any other cheque keeps it. Inside the caller's
    savepoint; never commits.
    """
    cheque = live_cheque_of(doc.name)
    if cheque:
        if doc.flags.get(DECIDING_FLAG) != cheque:
            reject_cheque(cheque, reason=rejected_alone_note(doc.name), user=frappe.session.user)
        return
    drop_off_cheques_of(doc, PAYMENT_REJECTED, old_type_only=True, keep_on=doc.flags.get(DECIDING_FLAG))


def on_expense_trash(doc, method=None):
    """A deleted Project Expense or Non Project Expense drops off its Cheque (#1413).

    ⚠️ `on_trash`, not `after_delete`: Frappe checks links after `on_trash`, and a Cheque Line still
    naming the expense would refuse the delete ("linked with Cheques").
    """
    drop_off_cheques_of(doc, DELETED)
