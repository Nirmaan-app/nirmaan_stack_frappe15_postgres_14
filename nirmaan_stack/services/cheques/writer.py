# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""THE cheques service: the only code that writes a Cheque (spec #1407).

Whitelisted endpoints (`api/cheques/`) check who is asking, call one function here, then commit and
publish. Nothing here commits: a caller may run it inside its own transaction or savepoint (the
Request Payment endpoints and the backfill patch do).

Built so far:

* `create_cheque` -- a new Payment cheque with its "created" history row. It starts Approval Pending and is
  Issued by its payments' approval (#1479, spec #1477; at once when they have already moved on).
* `add_deposit_cheque` -- THE "create deposit cheque" operation (#1486): a Security Deposit cheque,
  Issued at once on its typed issue date, made out to a Vendor or a typed name, its lines naming the
  Vendor's POs it secures. It pays nothing, so no payment is touched.
* `backfill_cheque` -- the backfill patch's Cheque for old cheque payments (#1419): no photo, made
  from the PO/WO page, straight at its status, created by the earliest payment's requester.
* `existing_cheque` -- the Cheque already recorded for a bank + cheque number, if any. The `validate`
  controller refuses a duplicate with it, so the rule holds on every write path; a Request Payment
  endpoint can ask it before inserting a payment.
* `link_payments` -- puts each line's Project Payment on the Cheque: link, mode Cheque, number and
  date (#1410). `create_cheque` calls it; the caller then moves the payments on after its commit.
  An expense line's expense (#1411) is never written: linking an expense changes nothing on it.
* `payment_cheque_problem` and `create_payment_cheque` -- the one-line Cheque for one payment, made
  from the PO/WO page (#1414 Request Payment). Ask the first BEFORE the
  payment is inserted: a Project Payment's `after_insert` commits, so a refusal after it is too late.

* `edit_cheque` -- the Tracker's Edit (#1418): an Approval Pending Payment cheque's number, bank, date and photo,
  never its lines (spec #1514); a Security Deposit cheque's fields, lines and issue date while Issued
  (#1486); who may is `edit_rules.edit_access_problem`, what may change `edit_rules.edit_problem`.
* `reshape_old_cheque` -- the cheque-types patch's write (#1478, spec #1477): an existing Cheque made a
  Payment cheque, Old-type or not, at the status and dates worked out from its payments.

The Tracker makes no Payment cheque (spec #1514): each is made with its one payment on the PO page
(`create_payment_cheque`). Every status move is a named operation in `status.py`; a deleted payment's line
comes off in `detach.py`. The deposit picker is `pickers.py`; the line rules that read the database,
`lines.py`.

A Cheque moves no money figure: amounts paid, amounts owed, TDS and vendor credit come from payments.
Becoming Issued is `services/cheques/status.issue`, the only code that issues a Payment cheque, or, for an
Old-type cheque its bank line clears, `old_type_clear.issue`; both write it through `mark_issued`.
"""

from dataclasses import asdict

import frappe
from frappe import _
from frappe.utils import now_datetime, nowdate

from nirmaan_stack.services.cheque_payments import MODE_CHEQUE
from nirmaan_stack.services.cheques.clear_rules import issue_date_problem
from nirmaan_stack.services.cheques.edit_rules import (
    EDITABLE_STATUSES,
    edit_access_problem,
    edit_problem,
    editable_statuses,
)
from nirmaan_stack.services.cheques.lines import with_record_projects
from nirmaan_stack.services.cheques.rules import (
    CHEQUE_TYPE_PAYMENT,
    CHEQUE_TYPE_SECURITY_DEPOSIT,
    ISSUED,
    LINE_PO_WO_PAYMENT,
    MADE_FROM,
    MADE_FROM_PO_WO_PAGE,
    MADE_FROM_REPORT,
    NEW_CHEQUE_FROM_REQUEST,
    PAYMENT_DOCTYPE,
    PENDING,
    ChequeHeader,
    ChequeLineInput,
    bank_key,
    header_problem,
    normalise_cheque_no,
    parse_header,
    parse_line,
    payment_duplicate_problem,
)

CHEQUES = "Cheques"

#: Published by every endpoint after a Cheque write commits; the Cheque Payments report refetches on it.
CHEQUES_CHANGED_EVENT = "cheques:changed"

class DuplicateChequeError(frappe.ValidationError):
    """A one-line Cheque for a payment names a bank + cheque number already recorded (#1414).

    Raised on Submit, before anything is created. The Request Payment dialog shows the same refusal
    earlier, with a link to that Cheque, from `api/cheques/find_cheque` (its `exc_type` is free for a
    caller that wants to tell this refusal apart).
    """


def history_row(from_status: str | None, to_status: str, user: str, note: str | None = None) -> dict:
    """One `Cheque Status History` row: who moved the Cheque from what to what, when, and why."""
    return {
        "from_status": from_status or None,
        "to_status": to_status,
        "changed_by": user,
        "changed_at": now_datetime(),
        "note": (note or "").strip() or None,
    }


def mark_issued(doc, *, user: str, note: str | None, issue_date) -> None:
    """THE Approval Pending -> Issued write on Payment cheque `doc`, read under its row lock by the caller,
    which has checked it may move (`status.issue`, `old_type_clear.issue`): one history row by `user`
    saying `note`, the status, and its issue date. Never commits."""
    doc.append("status_history", history_row(PENDING, ISSUED, user, note))
    doc.status = ISSUED
    doc.issue_date = issue_date
    doc.save(ignore_permissions=True)


def existing_cheque(bank: str, bank_name: str | None, cheque_no: str, *, exclude: str | None = None) -> str | None:
    """The name of the Cheque already recorded with this bank + cheque number, at any status, or None.

    An Others bank's name matches ignoring case and repeated spaces (`rules.bank_key`).
    """
    filters = {"bank_key": bank_key(bank, bank_name), "cheque_no": normalise_cheque_no(cheque_no)}
    if exclude:
        filters["name"] = ["!=", exclude]
    return frappe.db.get_value(CHEQUES, filters, "name")


def create_cheque(header: ChequeHeader, *, user: str, made_from: str, lines: list[ChequeLineInput] = ()):
    """Insert a new Payment cheque from `header` and `lines`, at Approval Pending, with one "created" history row,
    and put each line's payment on it (`link_payments`). Returns it.

    It is issued at once (`status.issue`) when its payments have already moved on to Reconciliation
    Pending; otherwise the approval route's move (or, for Approved ones, the caller's move after its
    commit) issues it.

    Every rule on the header and lines (the photo, one payee, the description of an Ad-hoc cheque,
    the bank + number uniqueness, a payment on one live Cheque only) is enforced by the `validate`
    controller, so it holds for every writer. Writes with `ignore_permissions`: the endpoint's
    role-profile check is the boundary.

    ⚠️ THE CALLER MOVES THE PAYMENTS ON, AFTER ITS COMMIT. A linked payment that is Approved and not
    on hold goes to Reconciliation Pending through `cheque_payments.move_to_reconciliation`, which
    must run only once the link is on disk (the same rule as every approval route).
    """
    if made_from not in MADE_FROM:
        raise ValueError(f"unknown made_from {made_from!r}")
    doc = _new_cheque(header, made_from=made_from, lines=lines, status=PENDING, history=history_row(None, PENDING, user))
    doc.insert(ignore_permissions=True)
    link_payments(doc)
    # Local: `status` imports this module.
    from nirmaan_stack.services.cheques.status import issue

    return issue(doc.name, user=user) or doc


def add_deposit_cheque(
    header: ChequeHeader, lines: list[ChequeLineInput], *, issue_date, user: str, made_from: str = MADE_FROM_REPORT
):
    """THE "create deposit cheque" operation (#1486, spec #1477, ADR-0035): a Security Deposit cheque, Issued
    as it is recorded, on `issue_date` (the day it was handed over; required, never after today), with one
    "created" history row. Returns it.

    It is made out to a Vendor or a typed name and needs its photo (`rules.header_problem`); its `lines` are
    Secured PO/WO lines naming the Vendor's POs, zero or more (never a Work Order, spec #1514). The `validate` controller
    refuses any other line kind on it (`rules.line_kind_problem`): it pays nothing, so no payment is linked,
    nothing waits for approval and the bank import never matches it. Never commits.
    """
    if made_from not in MADE_FROM:
        raise ValueError(f"unknown made_from {made_from!r}")
    problem = issue_date_problem(issue_date, today=nowdate())
    if problem:
        frappe.throw(_(problem))
    doc = _new_cheque(
        header, made_from=made_from, lines=lines, status=ISSUED, history=history_row(None, ISSUED, user),
        cheque_type=CHEQUE_TYPE_SECURITY_DEPOSIT,
    )
    doc.issue_date = str(issue_date)[:10]
    doc.insert(ignore_permissions=True)
    return doc


def backfill_cheque(
    header: ChequeHeader,
    lines: list[ChequeLineInput],
    *,
    status: str,
    owner: str,
    note: str,
    left_off: list[str] = (),
):
    """A Cheque for old cheque payments that had none (#1419): made from the PO/WO page, with no photo,
    straight at `status` (one history row, by `owner`, saying why), created by `owner`. Each line's
    payment is put on it (`link_payments`), and each payment in `left_off` (a Rejected payment kept off
    the lines) gets the link only, so every Cheque payment names its Cheque. Returns it.

    The `validate` controller still runs every other rule. Only the backfill patch calls this.
    """
    doc = _new_cheque(
        header, made_from=MADE_FROM_PO_WO_PAGE, lines=lines, status=status, history=history_row(None, status, owner, note)
    )
    doc.flags.cheque_without_photo = True
    doc.insert(ignore_permissions=True)
    # Frappe stamps the session user as owner outside a migrate. Raw on purpose: `owner` is metadata
    # no rule or hook reads, and a Cheque moves no money figure.
    doc.db_set("owner", owner, update_modified=False)
    link_payments(doc)
    for name in left_off:
        pay = frappe.get_doc(PAYMENT_DOCTYPE, name)
        pay.cheque = doc.name
        pay.save(ignore_permissions=True)
    return doc


def edit_cheque(
    name: str,
    header: ChequeHeader,
    lines: list[ChequeLineInput] | None,
    *,
    user: str,
    any_cheque: bool,
    issue_date=None,
):
    """Save the Cheque Tracker's Edit of Cheque `name`: its new `header`, and its `lines` (None keeps
    them). Returns it.

    Re-reads the Cheque under its row lock, then refuses with `frappe.PermissionError` a user who may
    not edit it (`any_cheque` is False for Procurement: only their own Approval Pending Payment cheques and Issued
    Security Deposit cheques), and with a validation error an edit the rules forbid (`edit_rules.edit_problem`:
    an Approval Pending Payment cheque changes only its number, bank, date and photo, never its lines; a deposit
    changes while Issued; an Old-type cheque changes only its photo). A Security Deposit cheque's
    `issue_date` (None keeps it) changes with the rest while Issued (#1486). The `validate` controller still
    runs every header and line rule.

    A new number or date on an Approval Pending Payment cheque is copied onto its payments (`link_payments`). No
    payment comes on or off a Cheque here, so none moves on. ⚠️ THE CALLER COMMITS.
    """
    doc = frappe.get_doc(CHEQUES, name, for_update=True)
    problem = edit_access_problem(
        status=doc.status, owner=doc.owner, user=user, any_cheque=any_cheque, cheque_type=doc.cheque_type
    )
    if problem:
        frappe.throw(_(problem), frappe.PermissionError)

    lines_before = [parse_line(row.as_dict()) for row in doc.get("lines") or []]
    lines_after = lines_before if lines is None else with_record_projects(list(lines))
    problem = edit_problem(
        parse_header(doc.as_dict()),
        header,
        status=doc.status,
        lines_before=lines_before,
        lines_after=lines_after,
        old_type=bool(doc.get("old_type")),
        cheque_type=doc.cheque_type,
    ) or _issue_date_edit_problem(doc, issue_date)
    if problem:
        frappe.throw(_(problem))

    copies_to_payments = doc.cheque_type == CHEQUE_TYPE_PAYMENT and doc.status in EDITABLE_STATUSES
    if copies_to_payments:
        _lock_payments(line_payments(doc))
    doc.update({
        "bank": header.bank,
        "bank_name": header.bank_name,
        "cheque_no": header.cheque_no,
        "cheque_date": header.cheque_date,
        "amount": header.amount,
        "vendor": header.vendor,
        "payee_name": header.payee_name,
        "description": header.description,
        "attachment": header.attachment,
    })
    if issue_date and doc.cheque_type == CHEQUE_TYPE_SECURITY_DEPOSIT:
        doc.issue_date = str(issue_date)[:10]
    if lines_after != lines_before:  # a deposit's: a Payment cheque's lines never change here
        doc.set("lines", [asdict(line) for line in lines_after])
    doc.save(ignore_permissions=True)
    # An Issued, Cleared or Cancelled Cheque's payments have moved on with it and keep its number as it was.
    if copies_to_payments:
        link_payments(doc)
    return doc


def _issue_date_edit_problem(doc, issue_date) -> str | None:
    """Why an edit may not set a Security Deposit cheque's issue date to `issue_date`, or None. It changes
    only while the deposit is Issued (`edit_rules.editable_statuses`), and is then required, never after today.
    A Payment cheque's issue date is its payments' approval, never typed: the argument is ignored."""
    if doc.cheque_type != CHEQUE_TYPE_SECURITY_DEPOSIT or issue_date is None:
        return None
    if str(issue_date)[:10] == str(doc.issue_date or "")[:10]:
        return None
    if doc.status not in editable_statuses(doc.cheque_type):
        return f"Cheque {doc.cheque_no} is {doc.status}: only its photo can change."
    return issue_date_problem(issue_date, today=nowdate())


def reshape_old_cheque(
    name: str,
    *,
    status: str,
    old_type: bool,
    issue_date: str | None,
    clearance_date: str | None,
    user: str,
    note: str | None = None,
):
    """Bring a Cheque recorded before spec #1477 into its shape (#1478): a Payment cheque, flagged
    `old_type` or not, at `status` with its issue and clearance dates. A status move writes one history
    row by `user`, saying why (`note`). Returns the saved Cheque.

    Since #1520 a Cleared cheque's Cheque/Payment Date (`cheque_date`) is the day the bank paid it, so
    `clearance_date`, when given, is written there; the hidden `clearance_date` field is not written. The
    keyword keeps its name because the patch `v3_0.cheque_types_pending_and_dates` passes it.

    Only the cheque-types patch calls this; it works the values out from the Cheque's payments
    (`rules.status_from_payments`, `rules.old_type_reason`). Saved through the document, so the `validate`
    controller runs every header and line rule. No payment is written: the status follows the payments,
    it does not move them, so nothing is recomputed.
    """
    doc = frappe.get_doc(CHEQUES, name, for_update=True)
    if doc.status != status:
        doc.append("status_history", history_row(doc.status, status, user, note))
        doc.status = status
    doc.update({
        "cheque_type": CHEQUE_TYPE_PAYMENT,
        "old_type": 1 if old_type else 0,
        "issue_date": issue_date,
    })
    if clearance_date:
        doc.cheque_date = clearance_date
    doc.save(ignore_permissions=True)
    return doc


def _new_cheque(
    header: ChequeHeader, *, made_from: str, lines, status: str, history: dict, cheque_type: str = CHEQUE_TYPE_PAYMENT
):
    """An unsaved Cheque; the caller inserts it. Row-locks the payments its lines name first."""
    _lock_payments([line.payment_name for line in lines if line.payment_doctype == PAYMENT_DOCTYPE])
    return frappe.get_doc({
        "doctype": CHEQUES,
        "bank": header.bank,
        "bank_name": header.bank_name,
        "cheque_no": header.cheque_no,
        "cheque_date": header.cheque_date,
        "amount": header.amount,
        "vendor": header.vendor,
        "payee_name": header.payee_name,
        "description": header.description,
        "attachment": header.attachment,
        "cheque_type": cheque_type,
        "status": status,
        "made_from": made_from,
        "status_history": [history],
        "lines": [asdict(line) for line in lines],
    })


def payment_cheque_problem(
    header: ChequeHeader, *, made_from: str = NEW_CHEQUE_FROM_REQUEST
) -> tuple[str | None, str | None]:
    """Why a one-line Cheque for a payment cannot be made from `header`: `(refusal, existing)`.

    `existing` is the Cheque already recorded with this bank + cheque number (then the refusal is
    `payment_duplicate_problem` in the wording of `made_from`, Request Payment by default), else None.
    `(None, None)` when it can be made. The line itself cannot fail: its PO / Work Order, project and
    Vendor are the payment's own.
    """
    problem = header_problem(header, line_count=1, photo_required=True)
    if problem:
        return problem, None
    existing = existing_cheque(header.bank, header.bank_name, header.cheque_no)
    if existing:
        return payment_duplicate_problem(header, made_from=made_from), existing
    return None, None


def create_payment_cheque(header: ChequeHeader, payment_name: str, *, user: str):
    """A new Cheque, made from the PO/WO page, with one line for `payment_name` (#1414).

    The line names the payment's PO / Work Order and that record's project, for the whole cheque
    amount: the cheque pays this one payment. `header.vendor` must be the record's Vendor. The
    payment is put on the Cheque (`link_payments`); THE CALLER commits, then moves it on.
    """
    record_doctype, record_name = frappe.db.get_value(
        PAYMENT_DOCTYPE, payment_name, ["document_type", "document_name"]
    )
    line = ChequeLineInput(
        line_type=LINE_PO_WO_PAYMENT,
        project=frappe.db.get_value(record_doctype, record_name, "project"),
        record_doctype=record_doctype,
        record_name=record_name,
        payment_doctype=PAYMENT_DOCTYPE,
        payment_name=payment_name,
        amount=header.amount,
    )
    return create_cheque(header, user=user, made_from=MADE_FROM_PO_WO_PAGE, lines=[line])


def line_payments(doc) -> list[str]:
    """The Project Payments the Cheque's lines name, in line order."""
    return [
        row.payment_name
        for row in doc.get("lines") or []
        if row.payment_doctype == PAYMENT_DOCTYPE and row.payment_name
    ]


#: Set by `link_payments` on each payment it puts on a Cheque: the one way an Online payment becomes a
#: Cheque payment (`payment_rules.mode_change_problem`). Only server code sets it.
PUTTING_ON_CHEQUE = "putting_on_cheque"


def link_payments(doc) -> None:
    """Put each Project Payment on the Cheque's lines on it (spec #1407): link it, make it a Cheque
    payment (an Online one converts) and copy the cheque number and date onto it.

    Its status is left alone here; the caller's move after commit does the rest. Saved through the
    document so its `validate` (the mode rule, the hold) and `track_changes` run. A payment already
    in step (an edit that left it alone) is not saved again. A Cheque moves no money figure, so
    nothing is recomputed.
    """
    values = {
        "cheque": doc.name,
        "mode_of_payment": MODE_CHEQUE,
        "cheque_no": doc.cheque_no,
        "cheque_date": doc.cheque_date,
    }
    for name in line_payments(doc):
        pay = frappe.get_doc(PAYMENT_DOCTYPE, name)
        if all(str(pay.get(field) or "") == str(value or "") for field, value in values.items()):
            continue
        pay.update(values)
        pay.flags[PUTTING_ON_CHEQUE] = True
        pay.save(ignore_permissions=True)


def _lock_payments(names: list[str]) -> None:
    """Row-lock the payments about to be put on a Cheque, in name order, so two Cheques saved at
    once cannot both take one payment: the second waits, then its `validate` sees the first."""
    names = sorted({n for n in names if n})
    if names:
        frappe.db.sql(
            'SELECT name FROM "tabProject Payments" WHERE name IN %(names)s ORDER BY name FOR UPDATE',
            {"names": tuple(names)},
        )
