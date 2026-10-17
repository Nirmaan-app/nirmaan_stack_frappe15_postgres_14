# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cheque's rules that need no database (spec #1407, ADR-0010 B1). Pure: no `frappe.db`.

A **Cheque** is one paper cheque the company writes (GLOSSARY.md). This module names its statuses,
types (spec #1477), banks, line kinds and where it was made, turns the values a form sends into a
`ChequeHeader`, and says why a header cannot be saved. A Payment cheque's status follows its payments:
`status_from_payments` is that mapping, `ready_to_issue` and `issue_date_from` say when and on what day
its payments' approval issues it (#1479), and `old_type_reason` says which pre-#1477 Cheques are
Old-type. `services/cheques/writer.py` is the only code that writes a Cheque;
it and the `validate` controller both ask this module.

Each `*_problem` function returns the refusal a user reads, or None.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from frappe.utils import flt

from nirmaan_stack.services.approval_tiers import status_after_l1
from nirmaan_stack.services.settlement import (
    STATUS_APPROVED,
    STATUS_CEO_PENDING,
    STATUS_PAID,
    STATUS_RECONCILIATION_PENDING,
    STATUS_REJECTED,
    STATUS_REQUESTED,
)

# -- statuses ------------------------------------------------------------------------------------
#: A Payment cheque whose payments still wait for approval (spec #1477).
PENDING = "Pending"
ISSUED = "Issued"
CLEARED = "Cleared"
CANCELLED = "Cancelled"
#: Pinned to the `Cheques.status` Select options by test.
CHEQUE_STATUSES = (PENDING, ISSUED, CLEARED, CANCELLED)

# -- cheque types (spec #1477, ADR-0035) ---------------------------------------------------------
#: Cashed by the bank; pays PO payments.
CHEQUE_TYPE_PAYMENT = "Payment"
#: Held as a guarantee; pays nothing and is never matched to a bank line.
CHEQUE_TYPE_SECURITY_DEPOSIT = "Security Deposit"
#: Pinned to the `Cheques.cheque_type` Select options by test.
CHEQUE_TYPES = (CHEQUE_TYPE_PAYMENT, CHEQUE_TYPE_SECURITY_DEPOSIT)

# -- how a Payment cheque was cleared (spec #1477) -----------------------------------------------
CLEARED_BY_HAND = "By hand"
CLEARED_BY_BANK_IMPORT = "Bank import"
#: Pinned to the `Cheques.cleared_by` Select options (after its blank first option) by test.
CLEARED_BY = (CLEARED_BY_HAND, CLEARED_BY_BANK_IMPORT)

# -- banks ---------------------------------------------------------------------------------------
ICICI_BANK = "ICICI Bank"
OTHER_BANK = "Others"
#: Pinned to the `Cheques.bank` Select options by test.
BANKS = (ICICI_BANK, OTHER_BANK)

# -- where a Cheque was made (drives which fields are locked, #1418) ------------------------------
MADE_FROM_REPORT = "Report"
MADE_FROM_PO_WO_PAGE = "PO/WO Page"
#: Pinned to the `Cheques.made_from` Select options by test.
MADE_FROM = (MADE_FROM_REPORT, MADE_FROM_PO_WO_PAGE)

# -- Cheque line kinds (#1410, #1411) ------------------------------------------------------------
LINE_PO_WO_PAYMENT = "PO/WO Payment"
LINE_PROJECT_EXPENSE = "Project Expense"
LINE_NON_PROJECT_EXPENSE = "Non-project Expense"
#: A Security Deposit cheque's line (#1486, spec #1477): a PO or Work Order the deposit secures. A record
#: only: no payment, no amount.
LINE_SECURED_RECORD = "Secured PO/WO"
#: Pinned to the `Cheque Line.line_type` Select options by test.
LINE_TYPES = (LINE_PO_WO_PAYMENT, LINE_PROJECT_EXPENSE, LINE_NON_PROJECT_EXPENSE, LINE_SECURED_RECORD)


def squash_spaces(value) -> str:
    """`value` as text, trimmed, with each run of spaces made one. None is ""."""
    return " ".join(str(value or "").split())


def bank_key(bank: str, bank_name: str | None = None) -> str:
    """The bank's identity for the uniqueness rule: an Others bank's typed name, else the fixed bank,
    lower-cased with repeated spaces collapsed. "HDFC Bank" and "hdfc  bank" are the same bank."""
    name = bank_name if bank == OTHER_BANK else bank
    return squash_spaces(name).casefold()


def bank_label(bank: str, bank_name: str | None = None) -> str:
    """The bank as a user reads it: the typed name for Others."""
    return squash_spaces(bank_name) if bank == OTHER_BANK and squash_spaces(bank_name) else squash_spaces(bank)


def normalise_cheque_no(cheque_no) -> str:
    """The cheque number with every space removed ("004 521" is 004521). Leading zeros are kept."""
    return "".join(str(cheque_no or "").split())


@dataclass(frozen=True)
class ChequeHeader:
    """A Cheque's own values, as a form sends them, trimmed. Empty text is None."""

    bank: str | None
    bank_name: str | None
    cheque_no: str | None
    cheque_date: str | None
    amount: float
    vendor: str | None
    payee_name: str | None
    description: str | None
    attachment: str | None

    @property
    def bank_key(self) -> str:
        return bank_key(self.bank or "", self.bank_name)


def parse_header(values: dict) -> ChequeHeader:
    """Read a Cheque header out of `values` (an endpoint's arguments or a document's fields).

    The bank name is kept only for an Others bank; the description is kept as written, trimmed.
    """
    def text(key):
        return squash_spaces(values.get(key)) or None

    bank = text("bank")
    description = str(values.get("description") or "").strip() or None
    return ChequeHeader(
        bank=bank,
        bank_name=text("bank_name") if bank == OTHER_BANK else None,
        cheque_no=normalise_cheque_no(values.get("cheque_no")) or None,
        cheque_date=text("cheque_date"),
        amount=flt(values.get("amount"), 2),
        vendor=text("vendor"),
        payee_name=text("payee_name"),
        description=description,
        attachment=str(values.get("attachment") or "").strip() or None,
    )


def header_problem(
    header: ChequeHeader,
    *,
    line_count: int,
    photo_required: bool,
    cancelled: bool = False,
    cheque_type: str = CHEQUE_TYPE_PAYMENT,
) -> str | None:
    """Why this header cannot be saved, or None.

    `line_count` is how many Cheque lines it carries: a live Payment cheque with none is an Ad-hoc
    cheque and needs a description. A `cancelled` one may have neither: its last payment dropped off
    (#1413). A Security Deposit cheque pays nothing, so it needs no line and no description (#1486).
    `photo_required` is True for every new Cheque except a backfilled one.
    A post-dated cheque date is allowed.
    """
    if header.bank not in BANKS:
        return "Choose the bank the cheque is drawn on: ICICI Bank or Others."
    if header.bank == OTHER_BANK and not header.bank_name:
        return "Type the name of the bank the cheque is drawn on."
    if not header.cheque_no:
        return "Enter the cheque number."
    if not header.cheque_date:
        return "Enter the cheque date."
    if header.amount <= 0:
        return "Enter a cheque amount greater than 0."
    if header.vendor and header.payee_name:
        return "A cheque is made out to one payee: pick a Vendor or type a payee name, not both."
    if not header.vendor and not header.payee_name:
        return "Pick the Vendor the cheque is made out to, or type the payee's name."
    if photo_required and not header.attachment:
        return "Upload the photo of the cheque."
    if line_count == 0 and not header.description and not cancelled and cheque_type == CHEQUE_TYPE_PAYMENT:
        return "A cheque with no lines is an Ad-hoc cheque: write a description of what it pays for."
    return None


#: What a PO/WO Payment line's record is: a PO, or a Work Order (doctype `Service Requests`).
PO_DOCTYPE = "Procurement Orders"
WORK_ORDER_DOCTYPE = "Service Requests"
RECORD_DOCTYPES = (PO_DOCTYPE, WORK_ORDER_DOCTYPE)
#: The payment a PO/WO Payment line names.
PAYMENT_DOCTYPE = "Project Payments"
PAYMENT_REJECTED = "Rejected"
#: The expense an expense line names (#1411). Linking one changes nothing on it.
PROJECT_EXPENSE_DOCTYPE = "Project Expenses"
NON_PROJECT_EXPENSE_DOCTYPE = "Non Project Expenses"

#: What each line kind's `payment_name` is a name of.
LINE_PAYMENT_DOCTYPES = {
    LINE_PO_WO_PAYMENT: PAYMENT_DOCTYPE,
    LINE_PROJECT_EXPENSE: PROJECT_EXPENSE_DOCTYPE,
    LINE_NON_PROJECT_EXPENSE: NON_PROJECT_EXPENSE_DOCTYPE,
}
EXPENSE_LINE_TYPES = (LINE_PROJECT_EXPENSE, LINE_NON_PROJECT_EXPENSE)
#: The expense as a user names it, in a refusal.
EXPENSE_LABELS = {LINE_PROJECT_EXPENSE: "Project Expense", LINE_NON_PROJECT_EXPENSE: "Non-Project Expense"}


@dataclass(frozen=True)
class LineNeeds:
    """Whether a line kind asks for a project and a PO / Work Order. Mirrored by the dialog's
    `utils/cheques/chequeLines.LINE_NEEDS`. A PO/WO line's payment is optional; an expense line's
    expense is required."""

    project: bool
    record: bool


LINE_NEEDS = {
    LINE_PO_WO_PAYMENT: LineNeeds(project=True, record=True),
    LINE_PROJECT_EXPENSE: LineNeeds(project=True, record=False),
    LINE_NON_PROJECT_EXPENSE: LineNeeds(project=False, record=False),
    LINE_SECURED_RECORD: LineNeeds(project=True, record=True),
}


@dataclass(frozen=True)
class ChequeLineInput:
    """One Cheque line as a form sends it, trimmed. Empty text is None; an untyped amount is 0."""

    line_type: str | None
    project: str | None
    record_doctype: str | None
    record_name: str | None
    payment_doctype: str | None
    payment_name: str | None
    amount: float


def parse_line(values: dict) -> ChequeLineInput:
    """Read one line out of `values`, keeping only the boxes its kind asks for (`LINE_NEEDS`).

    The payment doctype follows from the kind: a PO/WO Payment line names a Project Payment (when it
    names one), an expense line its kind's expense. A Non-project Expense line has no project, and no
    expense line has a PO / Work Order. A Secured PO/WO line is a record only: it keeps no payment and
    no amount. A line of an unknown kind keeps what was sent, to be refused.
    """
    def text(key):
        return squash_spaces(values.get(key)) or None

    line_type = text("line_type")
    if line_type == LINE_SECURED_RECORD:
        return ChequeLineInput(
            line_type=line_type, project=text("project"), record_doctype=text("record_doctype"),
            record_name=text("record_name"), payment_doctype=None, payment_name=None, amount=0.0,
        )
    payment_name = text("payment_name")
    needs = LINE_NEEDS.get(line_type, LineNeeds(project=True, record=True))
    return ChequeLineInput(
        line_type=line_type,
        project=text("project") if needs.project else None,
        record_doctype=text("record_doctype") if needs.record else None,
        record_name=text("record_name") if needs.record else None,
        payment_doctype=LINE_PAYMENT_DOCTYPES.get(line_type) if payment_name else None,
        payment_name=payment_name,
        amount=flt(values.get("amount"), 2),
    )


def po_wo_line_problem(
    line: ChequeLineInput,
    *,
    cheque_vendor: str | None,
    record: dict | None,
    payment: dict | None,
    newly_linked: bool = True,
) -> str | None:
    """Why a PO/WO Payment line cannot be saved, or None. The caller prefixes "Line N: ".

    `record` is the PO / Work Order's `{project, vendor}` (None when it does not exist); `payment`
    is the payment's `{document_type, document_name, status}` (None when the line names none). Only
    a payment `newly_linked` by this save is refused for being Rejected: one Rejected later, while
    already on the Cheque, drops off by itself (#1413) and must not block the Cheque's other saves.
    """
    if not cheque_vendor:
        return "a PO or Work Order payment needs a cheque made out to a Vendor, not a typed payee."
    if not line.project:
        return "pick the project."
    if line.record_doctype not in RECORD_DOCTYPES or not line.record_name:
        return "pick the PO or Work Order."
    if record is None:
        return f"{line.record_name} was not found."
    if record.get("vendor") != cheque_vendor:
        return f"{line.record_name} is not a PO or Work Order of this cheque's Vendor."
    if record.get("project") != line.project:
        return f"{line.record_name} is not in project {line.project}."
    if line.payment_name:
        if payment is None:
            return f"payment {line.payment_name} was not found."
        if (payment.get("document_type"), payment.get("document_name")) != (line.record_doctype, line.record_name):
            return f"payment {line.payment_name} is not a payment of {line.record_name}."
        if (payment.get("status") or "").strip() == PAYMENT_REJECTED and newly_linked:
            return f"payment {line.payment_name} is Rejected and cannot be put on a cheque."
    if line.amount <= 0:
        return "enter the amount, greater than 0."
    return None


def line_kind_problem(line: ChequeLineInput, *, cheque_type: str = CHEQUE_TYPE_PAYMENT) -> str | None:
    """Why the line's kind is not one a Cheque of `cheque_type` takes, or None. A Security Deposit cheque
    takes Secured PO/WO lines only, and only it does (#1486): it pays nothing."""
    if line.line_type not in LINE_TYPES:
        return f"choose the kind of line: {', '.join(LINE_TYPES)}."
    if cheque_type == CHEQUE_TYPE_SECURITY_DEPOSIT and line.line_type != LINE_SECURED_RECORD:
        return "a Security Deposit cheque pays nothing: its lines only name the POs and Work Orders it secures."
    if cheque_type != CHEQUE_TYPE_SECURITY_DEPOSIT and line.line_type == LINE_SECURED_RECORD:
        return "only a Security Deposit cheque names a PO or Work Order it secures."
    return None


def secured_line_problem(line: ChequeLineInput, *, cheque_vendor: str | None, record: dict | None) -> str | None:
    """Why a Secured PO/WO line cannot be saved, or None. The caller prefixes "Line N: " (#1486).

    `record` is the PO / Work Order's `{project, vendor}` (None when it does not exist). The line names one
    of the cheque's Vendor's POs or Work Orders, so a cheque made out to a typed payee names none. Its
    project is the record's own (the caller fills it in when the form sent none).
    """
    if not cheque_vendor:
        return "a cheque made out to a typed payee names no PO or Work Order."
    if line.record_doctype not in RECORD_DOCTYPES or not line.record_name:
        return "pick the PO or Work Order."
    if record is None:
        return f"{line.record_name} was not found."
    if record.get("vendor") != cheque_vendor:
        return f"{line.record_name} is not a PO or Work Order of this cheque's Vendor."
    if line.project and record.get("project") != line.project:
        return f"{line.record_name} is not in project {line.project}."
    return None


def expense_line_problem(line: ChequeLineInput, *, expense: dict | None) -> str | None:
    """Why a Project Expense or Non-project Expense line cannot be saved, or None. The caller
    prefixes "Line N: ".

    `expense` is the named expense's `{project}` (`{}` for a Non Project Expense, which has no
    project), or None when it does not exist. The expense is required: what a cheque pays beyond its
    lines is covered by its description. Any payee, a typed one included, may carry expense lines.
    """
    if LINE_NEEDS[line.line_type].project and not line.project:
        return "pick the project."
    if not line.payment_name:
        return f"pick the {EXPENSE_LABELS[line.line_type]}."
    if expense is None:
        return f"expense {line.payment_name} was not found."
    if line.line_type == LINE_PROJECT_EXPENSE and expense.get("project") != line.project:
        return f"expense {line.payment_name} is not in project {line.project}."
    if line.amount <= 0:
        return "enter the amount, greater than 0."
    return None


def duplicate_problem(header: ChequeHeader, existing: str) -> str:
    """The refusal for a bank + cheque number already recorded, naming the Cheque that has it."""
    return (
        f"Cheque {header.cheque_no} on {bank_label(header.bank or '', header.bank_name)} is already "
        f"recorded as {existing}."
    )


#: Where a payment's own new Cheque is made, for the refusal when its bank + number is taken: Request
#: Payment on a PO (#1414). Convert to Cheque / Link a new cheque (#1416) were removed by #1487.
NEW_CHEQUE_FROM_REQUEST = "request"
#: Per place: what it does, and how the user puts the payment on the recorded cheque instead.
_TAKEN_NUMBER_WORDING = {
    NEW_CHEQUE_FROM_REQUEST: ("A payment made here gets its own new cheque.", "request it as Online, then add it"),
}


def payment_duplicate_problem(header: ChequeHeader, *, made_from: str) -> str:
    """The refusal when a payment's new Cheque names a bank + cheque number already recorded.
    `made_from` is NEW_CHEQUE_FROM_REQUEST. A new Cheque is made; joining an existing one is done
    from the Cheque Tracker."""
    label = bank_label(header.bank or "", header.bank_name)
    what, how = _TAKEN_NUMBER_WORDING[made_from]
    return (
        f"Cheque {header.cheque_no} ({label}) already exists. {what} To put this payment on "
        f"{header.cheque_no}, {how} to the cheque in the Cheque Tracker."
    )


# -- editing a Cheque (#1418) --------------------------------------------------------------------
#: The header fields an edit compares. The photo (`attachment`) is apart: it may always be replaced.
EDITABLE_HEADER_FIELDS = (
    "bank", "bank_name", "cheque_no", "cheque_date", "amount", "vendor", "payee_name", "description",
)
#: What a Cheque made from the PO/WO page keeps, so it stays in step with the payment it came from,
#: while a Project Payment is still on it (`edit_problem`).
LOCKED_ON_PO_WO_PAGE = {"cheque_no": "number", "cheque_date": "date", "amount": "amount"}
#: The statuses at which a Cheque's fields and lines may still be edited; any other status is photo only.
#: A Payment cheque's lines change only while Pending (#1482, spec #1477): once its payments are approved
#: it is Issued, and its payments and the bank line follow it as it is.
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
    return "You can edit only the Pending cheques you created."


def _join(words: list[str]) -> str:
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"


def edit_problem(
    before: ChequeHeader,
    after: ChequeHeader,
    *,
    status: str,
    made_from: str,
    lines_before: list[ChequeLineInput],
    lines_after: list[ChequeLineInput],
    old_type: bool = False,
    cheque_type: str = CHEQUE_TYPE_PAYMENT,
) -> str | None:
    """Why this edit of a Cheque cannot be saved, or None. The rules are the ones the editor sees:

    * the photo can be replaced, never removed;
    * an Old-type cheque (spec #1477) can change only its photo, whatever its status;
    * an Issued, Cleared or Cancelled Payment cheque can change only its photo (`EDITABLE_STATUSES`); a
      Security Deposit cheque changes in full while Issued and only its photo once Cancelled (#1486);
    * a Pending Cheque made from the PO/WO page keeps its number, date and amount while it still has a
      Project Payment line (they stay in step with the payment), but its other fields and its lines can
      change. With no Project Payment line left (removed or swapped out) it edits like a Tracker-made
      Cheque;
    * a Pending Cheque made in the Tracker can change everything;
    * any line can come off a Pending Cheque. A Project Payment taken off switches back to Online
      (`payments_taken_off`), and its status stays as it is.

    What a Payment cheque's header and lines may hold is `tracker_payment_cheque_problem`.

    The header and line rules every save runs (one payee, a live Cheque per payment, ...) are the
    `validate` controller's, not repeated here.
    """
    if before.attachment and not after.attachment:
        return "The cheque's photo can be replaced, not removed."
    changed = [f for f in EDITABLE_HEADER_FIELDS if getattr(before, f) != getattr(after, f)]
    if old_type and (changed or lines_before != lines_after):
        return f"Cheque {before.cheque_no} is an Old-type cheque: only its photo can change."
    if status not in editable_statuses(cheque_type):
        if changed or lines_before != lines_after:
            return f"Cheque {before.cheque_no} is {status}: only its photo can change."
        return None
    if made_from == MADE_FROM_PO_WO_PAGE and any(line.payment_doctype == PAYMENT_DOCTYPE for line in lines_before):
        locked = [LOCKED_ON_PO_WO_PAGE[f] for f in changed if f in LOCKED_ON_PO_WO_PAGE]
        if locked:
            return (
                f"Cheque {before.cheque_no} was made from the PO/WO page, so its {_join(locked)} cannot "
                f"change here: change {'it' if len(locked) == 1 else 'them'} on the payment."
            )
    return None


def payments_taken_off(lines_before: list[ChequeLineInput], lines_after: list[ChequeLineInput]) -> list[str]:
    """The Project Payments `lines_before` hold and `lines_after` do not, in line order. A payment taken
    off a Pending Cheque switches back to Online at its own step (owner ruling, spec #1407 story 82)."""
    kept = {line.payment_name for line in lines_after if line.payment_doctype == PAYMENT_DOCTYPE}
    return [
        line.payment_name
        for line in lines_before
        if line.payment_doctype == PAYMENT_DOCTYPE and line.payment_name and line.payment_name not in kept
    ]


def taken_off_note(payment: str) -> str:
    """The Cheque's history note for a payment an edit took off it."""
    return f"Payment {payment} was taken off the cheque, so it switched back to Online."


#: A Cheque payment's Cheque that no longer holds it to the cheque: Cancelled, or none at all (a
#: payment the backfill could not give a Cheque, its number refused). `None` is "no Cheque".
_RELEASED_CHEQUE_STATUSES = (CANCELLED, None)


def mode_change_problem(
    *,
    was_cheque: bool,
    now_cheque: bool,
    cheque: str | None,
    old_cheque_status: str | None,
    on_old_cheque_lines: bool,
) -> str | None:
    """Why a payment's Mode of Payment may not change this way, or None (spec #1407). The Project
    Payments `validate` asks it on every save.

    Online -> Cheque happens when the cheques service puts the payment on a Cheque, which sets the
    `cheque` link in the same save. Cheque -> Online only once nothing holds the payment to its Cheque:
    that Cheque (`old_cheque_status`) is Cancelled, or it was on none, or its line has come off it
    (`on_old_cheque_lines` False: an edit took it off, #1418).
    """
    if was_cheque == now_cheque:
        return None
    if now_cheque:
        return None if cheque else "An Online payment becomes a Cheque payment by putting it on a Cheque."
    if old_cheque_status not in _RELEASED_CHEQUE_STATUSES and on_old_cheque_lines:
        return "A Cheque payment goes back to Online only once its Cheque is Cancelled."
    return None


# -- a Payment cheque made or edited in the Cheque Tracker (#1482, spec #1477) ------------------
#: The steps a payment may be at to be put on a Payment cheque: waiting for approval, or approved and
#: not yet moved on (the cheque is then Issued at once). A cheque's payments are approved together, so
#: they are all at one step.
PICKABLE_STEPS = (STATUS_REQUESTED, STATUS_CEO_PENDING, STATUS_APPROVED)


@dataclass(frozen=True)
class TrackerLine:
    """One line of a Payment cheque the Tracker saves, with what its rules need to know."""

    line: ChequeLineInput
    #: New on this save: every line of a new cheque; on an edit, a line the cheque did not hold.
    added: bool
    #: The status of the payment the line names; None while it names none.
    payment_status: str | None = None
    on_hold: bool = False


def line_identity(line: ChequeLineInput) -> tuple:
    """What a line pays, to tell an edit's added lines from the ones it kept: its kind, record and
    payment. The same line with another amount typed is not added."""
    return (line.line_type, line.record_doctype, line.record_name, line.payment_name)


def tracker_payment_cheque_problem(header: ChequeHeader, lines: Sequence[TrackerLine]) -> str | None:
    """Why the Cheque Tracker cannot save this Payment cheque, new or edited, or None. Pure.

    * It is made out to a Vendor: no typed payee (spec #1477 Q17).
    * It has at least one line: no Ad-hoc Payment cheque.
    * Each added line is a PO payment: no Work Order line (Work Order payments are paid Online) and no
      expense line (Q11). A Work Order line already on a cheque from before stays.
    * Each added payment is at Requested, CEO Pending or Approved (`PICKABLE_STEPS`) and not on hold.
    * When a payment is added, every payment on the cheque is at the same step, since they are
      approved together (C1). Otherwise the payments already on it are not judged again.

    The rules every save runs (the Vendor's PO in the line's project, one live cheque per payment, ...)
    are the `validate` controller's (`lines.lines_problem`).
    """
    if not header.vendor:
        return "A Payment cheque is made out to a Vendor: pick the Vendor, not a typed payee."
    if not lines:
        return "Add at least one PO payment: a Payment cheque pays the PO payments on its lines."
    for n, tracker in enumerate(lines, 1):
        line = tracker.line
        if tracker.added and (line.line_type != LINE_PO_WO_PAYMENT or line.record_doctype != PO_DOCTYPE):
            return (
                f"Line {n}: a Payment cheque pays PO payments only. Work Order payments are paid Online, "
                "and expenses are not paid by cheque."
            )
    picked = [(n, t) for n, t in enumerate(lines, 1) if t.added and t.line.payment_name]
    for n, tracker in picked:
        status = (tracker.payment_status or "").strip()
        if status not in PICKABLE_STEPS:
            return (
                f"Line {n}: payment {tracker.line.payment_name} is {status or 'not found'}: only a Requested, "
                "CEO Pending or Approved payment can be put on a cheque."
            )
        if tracker.on_hold:
            return f"Line {n}: payment {tracker.line.payment_name} is on hold: release the hold first."
    if picked:
        named = [t for t in lines if t.line.payment_name]
        if len({(t.payment_status or "").strip() for t in named}) > 1:
            steps = ", ".join(f"{t.line.payment_name} is {t.payment_status}" for t in named)
            return f"A cheque's payments are approved together, so they must be at the same step: {steps}."
    if any((t.payment_status or "").strip() == STATUS_APPROVED for t in lines if t.line.payment_name):
        return _approved_cheque_problem(header, lines)
    return None


def _approved_cheque_problem(header: ChequeHeader, lines: Sequence[TrackerLine]) -> str | None:
    """Approved payments issue their cheque at once, so it must already meet the approval conditions
    (`approval_problem`): every line names a payment and the lines add up to the cheque amount."""
    for n, tracker in enumerate(lines, 1):
        if not tracker.line.payment_name:
            return (
                f"Line {n} has no payment yet, but the cheque's payments are Approved, so it is Issued at once. "
                "Pick that line's payment, or take the line off."
            )
    return approval_problem(
        cheque_no=header.cheque_no or "",
        amount=header.amount,
        lines=[ApprovalLine(payment=t.line.payment_name, record=t.line.record_name, amount=t.line.amount)
               for t in lines],
    )


# -- what a cheque payment refuses (spec #1477, ADR-0035, #1487) ---------------------------------
def cheque_mode_problem(document_type: str | None) -> str | None:
    """Why a payment of a `document_type` record cannot be paid by cheque, or None. Only a PO payment can:
    Work Order payments are paid Online. The Project Payments `validate` asks it when a payment becomes
    a Cheque payment; a Work Order cheque payment already in flight finishes as it is."""
    if document_type == PO_DOCTYPE:
        return None
    return "A Work Order payment is paid Online: only a PO payment can be paid by cheque."


#: The one-payment actions a cheque payment refuses. A cheque's payments are approved, paid or rejected
#: together (one cheque, one decision), so none of them may move alone; cancelling the cheque is the undo.
CHEQUE_REFUSES_HOLD = "hold"
CHEQUE_REFUSES_REVERT = "revert"
#: CEO part-approval and the bank import's part-settlement, both `payment_split.split_payment`.
CHEQUE_REFUSES_SPLIT = "split"
#: A hand settle from the import's decision dialog, and the payments screen's fulfil: clearing pays them.
CHEQUE_REFUSES_PAY = "pay"
_CANCEL_INSTEAD = "a cheque's payments move together. Cancel the cheque in the Cheque Tracker instead."
_CHEQUE_REFUSALS = {
    CHEQUE_REFUSES_HOLD: f"cannot be put on hold: {_CANCEL_INSTEAD}",
    CHEQUE_REFUSES_REVERT: f"cannot go back to Approved: {_CANCEL_INSTEAD}",
    CHEQUE_REFUSES_SPLIT: "cannot be split: a cheque pays its payments in full or not at all.",
    CHEQUE_REFUSES_PAY: (
        "cannot be paid on its own: a cheque's payments are paid when the cheque is cleared. Clear it in the "
        "Cheque Tracker, where its bank line can be linked."
    ),
}
CHEQUE_PAYMENT_ACTIONS = tuple(_CHEQUE_REFUSALS)


def cheque_payment_problem(payment: str, action: str, *, is_cheque: bool, cheque_no: str | None = None) -> str | None:
    """Why `action` (a `CHEQUE_REFUSES_*`) is refused on `payment`, or None for an Online payment.
    `cheque_no` names the cheque in the refusal when known."""
    refusal = _CHEQUE_REFUSALS[action]
    if not is_cheque:
        return None
    cheque = f"cheque {cheque_no}" if cheque_no else "cheque"
    return f"{payment} is paid by {cheque}, so it {refusal}"


# -- a Payment cheque follows its payments (spec #1477, ADR-0035) --------------------------------
#: The payment statuses each cheque status stands for. A Rejected payment is apart: it counts only when
#: every payment on the cheque is Rejected (`status_from_payments`).
_WAITING = (STATUS_REQUESTED, STATUS_CEO_PENDING)
_APPROVED = (STATUS_APPROVED, STATUS_RECONCILIATION_PENDING)
_KNOWN_PAYMENT_STATUSES = _WAITING + _APPROVED + (STATUS_PAID, STATUS_REJECTED)


def status_from_payments(payment_statuses: Sequence[str | None]) -> str | None:
    """A Payment cheque's status, worked out from its lines' payments. Pure.

    `payment_statuses` has one entry per line: the status of the payment the line names, or None for a
    line with no payment yet. The cheque is

    * Pending while a line has no payment yet or a payment waits for approval (Requested, CEO Pending);
    * Cancelled when every payment is Rejected;
    * otherwise, the Rejected ones aside, Cleared when every payment is Paid, else Issued (Approved or
      Reconciliation Pending: approved, not yet paid by the bank).

    None when it cannot be worked out: no lines, or a payment status this rule does not know.
    """
    if not payment_statuses:
        return None
    statuses = [None if s is None else s.strip() for s in payment_statuses]
    if any(s is not None and s not in _KNOWN_PAYMENT_STATUSES for s in statuses):
        return None
    if any(s is None or s in _WAITING for s in statuses):
        return PENDING
    live = [s for s in statuses if s != STATUS_REJECTED]
    if not live:
        return CANCELLED
    return CLEARED if all(s == STATUS_PAID for s in live) else ISSUED


def ready_to_issue(payment_statuses: Sequence[str | None]) -> bool:
    """May a Pending Payment cheque be Issued now? Pure. One entry per line, as `status_from_payments`.

    Only once EVERY line's payment has been approved and moved on to Reconciliation Pending (#1479): a
    payment still at Approved holds the cheque at Pending, because the move that follows the approval
    can still fail, and the cheque and its payments must never disagree. A line with no payment yet, a
    payment waiting for approval or a Rejected one holds it too.
    """
    statuses = [None if s is None else s.strip() for s in payment_statuses]
    return bool(statuses) and all(s == STATUS_RECONCILIATION_PENDING for s in statuses)


def issue_date_from(approval_dates: Sequence) -> str | None:
    """The issue date of a cheque its payments' approvals issue: the day of the last one, as
    `YYYY-MM-DD`. Pure. `approval_dates` holds every L1 and CEO approval date of its payments (dates
    or text; blanks are skipped), so a payment the CEO approved counts the CEO's day. None when none."""
    days = [str(d)[:10] for d in approval_dates if d]
    return max(days) if days else None


def old_type_reason(*, vendor: str | None, payee_name: str | None, line_types: Sequence[str]) -> str | None:
    """Why a Cheque recorded before spec #1477 is an Old-type cheque, or None. Pure.

    It is one when it pays Expenses, has no lines (an Ad-hoc cheque), or is made out to a typed payee
    (GLOSSARY.md). An Old-type cheque keeps its status; it is cleared or cancelled by hand only.
    """
    if any(t in EXPENSE_LINE_TYPES for t in line_types):
        return "pays expenses"
    if not line_types:
        return "has no lines"
    if payee_name and not vendor:
        return "is made out to a typed payee"
    return None


# -- approving a Payment cheque's payments: one cheque, one decision (#1480, spec #1477) ----------
#: How far a Payment cheque's lines may be from its amount and still be approved (C2): the bank line
#: that clears the cheque is matched within the same ₹5 (`outflow_import/amounts.AMOUNT_TOLERANCE`).
LINES_TOLERANCE = 5.0
#: The payment steps that wait for an approval, and where an approval can land a payment.
_APPROVAL_TARGETS = (STATUS_CEO_PENDING, STATUS_APPROVED)


def rupees(amount) -> str:
    """`amount` as a user reads it in a refusal: ₹ and Indian digit grouping, paise only when there are
    any ("₹12,50,000", "₹1,234.50"). Pure: Frappe's `fmt_money` reads the site's number format."""
    value = round(flt(amount), 2)
    sign = "-" if value < 0 else ""
    whole, paise = divmod(round(abs(value) * 100), 100)
    digits = str(int(whole))
    head, tail = digits[:-3], digits[-3:]
    groups = []
    while head:
        groups.insert(0, head[-2:])
        head = head[:-2]
    text = ",".join(groups + [tail])
    return f"{sign}₹{text}" + (f".{int(paise):02d}" if paise else "")


@dataclass(frozen=True)
class ApprovalLine:
    """One Cheque line as the approval rules read it: the payment it names (None: "No payment yet"),
    its PO (to name the line in a refusal) and its amount."""

    payment: str | None
    record: str | None
    amount: float


def approval_problem(*, cheque_no: str, amount, lines: Sequence[ApprovalLine]) -> str | None:
    """Why a Payment cheque's payments cannot be approved yet, or None. Pure.

    Approving needs every line to name a payment (a "No payment yet" line is named, story 12) and the
    lines to add up to the cheque amount within `LINES_TOLERANCE` (C2, story 13): the bank line that
    clears the cheque equals the cheque amount and pays the payments, so a gap leaves money unexplained.
    """
    if not lines:
        return f"Cheque {cheque_no} has no lines, so it has no payments to approve."
    for n, line in enumerate(lines, 1):
        if not line.payment:
            return (
                f"Line {n} of cheque {cheque_no} has no payment yet ({line.record}, {rupees(line.amount)}). "
                "Pick its payment in the Cheque Tracker first; then all payments on the cheque are approved "
                "together."
            )
    # `round`, not `flt(x, 2)`: Frappe's rounding reads the site's settings, and this module needs none.
    total = round(sum(flt(line.amount) for line in lines), 2)
    if abs(total - round(flt(amount), 2)) > LINES_TOLERANCE:
        return (
            f"The lines of cheque {cheque_no} add up to {rupees(total)}, but the cheque is for {rupees(amount)}. "
            f"Correct them in the Cheque Tracker first: they must agree within {rupees(LINES_TOLERANCE)}."
        )
    return None


def decision_step_problem(payment_statuses: Sequence[tuple[str, str | None]], *, expected: str) -> str | None:
    """Why a cheque's payments are not all at the `expected` step, naming each one that is not, or None.
    Pure. `payment_statuses` holds `(payment, status)` for every line. One cheque moves as one."""
    off = [f"{name} is {(status or '').strip() or 'blank'}" for name, status in payment_statuses
           if (status or "").strip() != expected]
    if off:
        return f"Every payment on the cheque must be {expected} to approve it together: {_join(off)}."
    return None


def is_approval(from_status: str | None, to_status: str | None) -> bool:
    """Is this payment save an approval: a move out of a step that waits (Requested, CEO Pending) on to
    the next one (CEO Pending, Approved)? Pure. Born approved (no `from_status`), Revert to Approved and
    Unreconcile's Paid -> Approved are not."""
    before, after = (from_status or "").strip(), (to_status or "").strip()
    return before in _WAITING and after in _APPROVAL_TARGETS and before != after


def lone_approval_problem(
    *,
    cheque_no: str,
    payment_lines: int,
    deciding: bool,
    from_status: str,
    to_status: str,
    cheque_amount,
) -> str | None:
    """Why this approval of one payment on a Payment cheque is refused, or None (story 32). Pure.

    The payment's own `validate` asks it, so no path approves a cheque payment apart from its cheque:
    a save made by the cheque's decision (`deciding`, `services/cheques/decide.py`) passes; any other
    is refused while the cheque has other lines (`payment_lines` counts them all, "No payment yet" ones
    included), or when it lands where the cheque amount does not (C3: L1 forwards to the CEO above
    ₹50,000 of CHEQUE, whatever the payment's own amount).
    """
    if deciding:
        return None
    if payment_lines > 1:
        return (
            f"This payment is on cheque {cheque_no} with {payment_lines - 1} other line(s). A cheque is approved "
            f"as one: approve all {payment_lines} together from the payment's approval dialog."
        )
    expected = status_after_l1(cheque_amount) if (from_status or "").strip() == STATUS_REQUESTED else STATUS_APPROVED
    if (to_status or "").strip() != expected:
        needs = "CEO approval as well" if expected == STATUS_CEO_PENDING else "L1 approval only"
        return f"Cheque {cheque_no} is for {rupees(cheque_amount)}, so its payments need {needs}."
    return None


# -- clearing and cancelling a cheque (#1484, spec #1477, ADR-0035) -------------------------------
#: The statuses each way of clearing may start from. By hand: Issued only (Q34). The bank import (#1485)
#: clears at any live status, because the bank has already paid: from Pending its payments are approved
#: by the import first, from Cancelled its Rejected payments are revived (`status.clear` does both).
CLEARABLE_FROM = {
    CLEARED_BY_HAND: (ISSUED,),
    CLEARED_BY_BANK_IMPORT: (ISSUED, PENDING, CANCELLED),
}
#: The starts the bank import brings to Reconciliation Pending itself before it pays (`status.clear`).
BANK_BRINGS_FORWARD = (PENDING, CANCELLED)
#: Why a cheque at a status no clear starts from cannot be cleared.
_NOT_CLEARABLE = {
    PENDING: "it is Pending: its payments are not approved yet",
    CANCELLED: "it is Cancelled: its payments are Rejected",
}
#: The bank-statement source whose lines clear cheques, and the direction that spends money
#: (`outflow_import/sources.BANK_STATEMENT_SOURCES`, `outflow_import/parser.DIRECTION_DEBIT`).
ICICI_STATEMENT_SOURCE = "ICICI Bank Statement"
DIRECTION_DEBIT = "Debit"
#: An imported line nobody has matched yet (`api/outflow_import/review._NOT_MATCHED_STATUSES`).
UNMATCHED_LINE_STATUSES = ("Pending match run", "Mismatched", "Error")


def cheque_no_key(value) -> str:
    """The form a cheque number is compared in, against a bank statement: spaces removed, a spreadsheet's
    trailing ".0" dropped and leading zeros stripped ("000747", "747" and "747.0" are all "747"). Blank
    stays blank; all zeros is "0". The Cheque keeps the number as written (`normalise_cheque_no`)."""
    text = normalise_cheque_no(value)
    if text.endswith(".0"):
        text = text[:-2]
    if not text:
        return ""
    return text.lstrip("0") or "0"


def clear_problem(
    *,
    status: str,
    cheque_type: str,
    old_type: bool,
    cleared_by: str,
    payments: Sequence[tuple[str, str | None]],
    bank_line: bool,
) -> str | None:
    """Why this cheque cannot be cleared, as a short reason ("already Cleared"), or None. Pure.

    `payments` holds `(payment, status)` for every Project Payment its lines name. Clearing pays them,
    so each must be waiting for the bank (Reconciliation Pending); one already Paid is left as it is,
    unless a bank line is being linked (that line would then pay it twice). The bank import starting
    from Pending or Cancelled (`BANK_BRINGS_FORWARD`) takes any unpaid payment: it approves or revives
    it first. An Old-type cheque is cleared by hand only, and with no bank line: its lines may pay
    expenses the line cannot be split across.
    """
    if cheque_type != CHEQUE_TYPE_PAYMENT:
        return "a Security Deposit cheque is never cashed"
    if status == CLEARED:
        return "already Cleared"
    if old_type and (bank_line or cleared_by != CLEARED_BY_HAND):
        return "an Old-type cheque is cleared by hand, without a bank line"
    if status not in CLEARABLE_FROM.get(cleared_by, ()):
        return _NOT_CLEARABLE.get(status, f"it is {status}")
    for name, payment_status in payments:
        payment_status = (payment_status or "").strip()
        if payment_status == STATUS_PAID:
            if bank_line:
                return f"payment {name} is already Paid"
        elif status in BANK_BRINGS_FORWARD and payment_status:
            continue
        elif payment_status != STATUS_RECONCILIATION_PENDING:
            return f"payment {name} is {payment_status or 'blank'}"
    return None


def _day_text(day: str) -> str:
    year, month, date = day[:10].split("-")
    return f"{date}-{month}-{year}"


def clearance_date_problem(clearance_date, *, issue_date, today) -> str | None:
    """Why `clearance_date` cannot be a cheque's clearance date, or None. Pure. It becomes each payment's
    payment date, so it is required, never after `today` and never before the cheque was issued."""
    if not clearance_date:
        return "Choose the clearance date."
    day = str(clearance_date)[:10]
    if day > str(today)[:10]:
        return "The clearance date cannot be after today."
    if issue_date and day < str(issue_date)[:10]:
        return f"The clearance date cannot be before the cheque was issued ({_day_text(str(issue_date))})."
    return None


def cancel_problem(*, status: str) -> str | None:
    """Why a cheque at `status` cannot be cancelled by hand, as a short reason, or None. Pure. Pending and
    Issued cheques may be (their payments are Rejected); a Cleared one has no undo (ADR-0035 §5)."""
    if status == CLEARED:
        return "it is Cleared: a cleared cheque cannot be cancelled"
    if status == CANCELLED:
        return "already Cancelled"
    return None


def cancel_note_problem(note: str | None) -> str | None:
    """Cancelling rejects every payment on the cheque, with the note as their reason: it is required."""
    if not (note or "").strip():
        return "Write a note saying why the cheque is cancelled."
    return None


# -- a Security Deposit cheque (#1486, spec #1477, ADR-0035) ---------------------------------------
def issue_date_problem(issue_date, *, today) -> str | None:
    """Why `issue_date` cannot be a Security Deposit cheque's issue date (the day it was handed over), or
    None. Pure. It is typed (today by default), so it is required and never after `today`. It may be before
    or after the cheque date: a deposit cheque is often post-dated."""
    if not issue_date:
        return "Enter the issue date: the day it was handed over."
    if str(issue_date)[:10] > str(today)[:10]:
        return "The issue date cannot be after today."
    return None


def deposit_cancel_problem(*, status: str, cheque_type: str) -> str | None:
    """Why this cheque cannot be cancelled as a Security Deposit, as a short reason, or None. Pure. A deposit
    is Issued from the start and Cancelled when it comes back (story 64); no other move exists."""
    if cheque_type != CHEQUE_TYPE_SECURITY_DEPOSIT:
        return "it is a Payment cheque, not a Security Deposit"
    if status == CANCELLED:
        return "already Cancelled"
    if status != ISSUED:
        return f"it is {status}"
    return None


@dataclass(frozen=True)
class BankLine:
    """An imported bank-statement line (`Outflow Import Row`) as the clearing rules read it."""

    name: str
    source: str | None
    direction: str | None
    row_status: str | None
    reference_id: str | None
    amount: float


def bank_line_matches(line: BankLine, *, cheque_no: str, amount) -> bool:
    """Does `line` carry this cheque's number (leading zeros ignored) and amount (within ₹5)? Pure."""
    key = cheque_no_key(line.reference_id)
    return (
        bool(key)
        and key == cheque_no_key(cheque_no)
        and abs(round(flt(line.amount), 2) - round(flt(amount), 2)) <= LINES_TOLERANCE
    )


def bank_line_problem(line: BankLine, *, bank: str, cheque_no: str, amount) -> str | None:
    """Why `line` cannot clear this cheque, as a short reason, or None. Pure.

    The bank match rule (spec #1477): an ICICI Bank cheque only, an ICICI statement DEBIT nobody has
    matched yet, the same number with leading zeros ignored, the amount within ₹5.
    """
    if bank != ICICI_BANK:
        return "only an ICICI Bank cheque is matched to a bank line"
    if line.source != ICICI_STATEMENT_SOURCE:
        return f"line {line.name} is not from an ICICI bank statement"
    if line.direction != DIRECTION_DEBIT:
        return f"line {line.name} is a credit, not a debit"
    if line.row_status not in UNMATCHED_LINE_STATUSES:
        return f"line {line.name} is already {line.row_status}"
    if cheque_no_key(line.reference_id) != cheque_no_key(cheque_no):
        number = (line.reference_id or "").strip() or "none"
        return f"line {line.name} carries cheque number {number}, not {cheque_no}"
    if not bank_line_matches(line, cheque_no=cheque_no, amount=amount):
        return f"line {line.name} is for {rupees(line.amount)}, but the cheque is for {rupees(amount)}"
    return None


# -- the bank import clears Payment cheques (#1485, spec #1477, ADR-0035) -------------------------
#: The note on the history row when the bank import approves a Pending cheque's payments.
BANK_APPROVAL_NOTE = "approved by bank import"
#: The note on the history row when the bank import clears a Cancelled cheque.
BANK_REVIVAL_NOTE = "cancelled, but the bank paid it"
#: `Outflow Row Match.match_basis` of a payment a cheque line settled (pinned to the doctype by test).
BANK_MATCH_BASIS = "cheque number"


def bank_cheque_key(*, source: str | None, direction: str | None, reference_id) -> str:
    """The cheque number an imported bank line carries, in the compared form (`cheque_no_key`), or "".
    Pure. Only an ICICI statement DEBIT with its cheque column filled is a cheque line (whatever its
    remark says: CLG/, TRF/, TRFR TO:); a credit is money coming in and never clears our cheque."""
    if source != ICICI_STATEMENT_SOURCE or direction != DIRECTION_DEBIT:
        return ""
    return cheque_no_key(reference_id)


@dataclass(frozen=True)
class FoundCheque:
    """A Payment cheque on ICICI Bank (not Old-type) carrying a bank line's number."""

    name: str
    cheque_no: str
    status: str
    amount: float
    bank_line: str | None = None


def _fits(amount, other) -> bool:
    return abs(round(flt(amount), 2) - round(flt(other), 2)) <= LINES_TOLERANCE


def pick_bank_cheque(found: Sequence[FoundCheque], *, amount) -> tuple[FoundCheque | None, str | None]:
    """Which of the Payment cheques carrying a bank line's number that line clears. Pure.

    `(cheque, None)`: the one whose amount is within ₹5 of the line. `(None, hint)`: the number was found
    but no single cheque fits, so nothing is settled and the line says why. `(None, None)`: no Payment
    cheque carries the number, so the line is not the cheque pass's (a Security Deposit is never found).
    """
    if not found:
        return None, None
    fits = [c for c in found if _fits(c.amount, amount)]
    if len(fits) == 1:
        return fits[0], None
    if fits:
        return None, (
            f"Cheques {_join([c.cheque_no for c in fits])} both carry this number and amount. Nothing was "
            "settled. Clear the right one by hand from the Cheque Tracker."
        )
    if len(found) == 1:
        return None, (
            f"Cheque {found[0].cheque_no} found, but its amount is {rupees(found[0].amount)}, not "
            f"{rupees(amount)}. Nothing was settled. Check the cheque, or match this line by hand."
        )
    return None, (
        f"Cheques {_join([c.cheque_no for c in found])} carry this number, but none is for {rupees(amount)}. "
        "Nothing was settled. Check the cheques, or match this line by hand."
    )


@dataclass(frozen=True)
class DoublePayment:
    """A payment on a cancelled cheque's PO raised after the cancel: the PO may now be paid twice."""

    payment: str
    record: str
    amount: float
    status: str


def _payments(n: int) -> str:
    return f"{n} payment" if n == 1 else f"{n} payments"


def bank_cleared_note(*, cheque_no: str, started: str, payments: int, day, suspects: Sequence[DoublePayment] = ()) -> str:
    """What the import review says about a line that cleared cheque `cheque_no`, by the status the cheque
    was at (`started`; Cleared means it was cleared by hand and the line is only linked). Pure."""
    when = _day_text(str(day))
    if started == CLEARED:
        return (
            f"Cheque {cheque_no} was already cleared by hand: this line is linked to it and its "
            f"{_payments(payments)}; nothing was paid again."
        )
    if started == PENDING:
        verb = "was" if payments == 1 else "were"
        return (
            f"Cheque {cheque_no} was Pending: the bank paid it before approval. Its {_payments(payments)} {verb} "
            f"approved by bank import (approval date {when}), then Paid."
        )
    if started == CANCELLED:
        note = (
            f"Cheque {cheque_no} was cancelled, but the bank paid it: {_payments(payments)} Rejected → Paid, "
            f"payment date {when}."
        )
        if suspects:
            named = _join([f"{s.record} has {s.payment} ({rupees(s.amount)}, {s.status})" for s in suspects])
            note += f" Check for double payment: {named}, raised after the cheque was cancelled."
        return note
    return f"Cheque {cheque_no} cleared: {_payments(payments)} Reconciliation Pending → Paid, payment date {when}."


def already_linked_note(*, cheque_no: str, bank_line: str) -> str:
    """A Cleared cheque that another bank line already clears: this line settles nothing. Pure."""
    return (
        f"Cheque {cheque_no} is already cleared with bank line {bank_line}. Nothing was settled. Match this "
        "line by hand if it is a different payment."
    )


def bank_clear_failed_note(*, cheque_no: str, reason: str) -> str:
    """A line that matches a cheque the cheques service refused to clear: nothing is settled. Pure."""
    return f"Cheque {cheque_no} matches this line but could not be cleared: {reason}. Nothing was settled."


def no_payment_cheque_note(number: str) -> str:
    """A cheque line whose number names no Payment cheque on ICICI Bank. Pure."""
    return (
        f"No Payment cheque {number} on ICICI Bank. A Security Deposit cheque is never matched. Match this "
        "line by hand."
    )


def bank_start(*, cleared_by: str | None, history: Sequence[tuple[str | None, str, str | None]]) -> str:
    """Where a Cleared cheque that records a bank line stood before that line, for the import review. Pure.

    `history` holds `(from, to, note)` per history row, oldest first. Cleared (by hand, the line only
    linked) unless the bank import cleared it; then the status its clear started from, Pending when the
    import approved it on the way (`BANK_APPROVAL_NOTE`)."""
    if cleared_by != CLEARED_BY_BANK_IMPORT:
        return CLEARED
    rows = list(history)
    for i in range(len(rows) - 1, -1, -1):
        before, after, _note = rows[i]
        if after != CLEARED:
            continue
        if before == ISSUED and i > 0 and rows[i - 1][:2] == (PENDING, ISSUED) and rows[i - 1][2] == BANK_APPROVAL_NOTE:
            return PENDING
        return before or ISSUED
    return ISSUED
