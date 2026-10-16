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
#: Pinned to the `Cheque Line.line_type` Select options by test.
LINE_TYPES = (LINE_PO_WO_PAYMENT, LINE_PROJECT_EXPENSE, LINE_NON_PROJECT_EXPENSE)


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
    header: ChequeHeader, *, line_count: int, photo_required: bool, cancelled: bool = False
) -> str | None:
    """Why this header cannot be saved, or None.

    `line_count` is how many Cheque lines it carries: a live Cheque with none is an Ad-hoc cheque
    and needs a description. A `cancelled` one may have neither: its last payment dropped off
    (#1413). `photo_required` is True for every new Cheque except a backfilled one.
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
    if line_count == 0 and not header.description and not cancelled:
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
    expense line has a PO / Work Order. A line of an unknown kind keeps what was sent, to be refused.
    """
    def text(key):
        return squash_spaces(values.get(key)) or None

    line_type = text("line_type")
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


def line_kind_problem(line: ChequeLineInput) -> str | None:
    """Why the line's kind is not one a Cheque takes, or None."""
    if line.line_type not in LINE_TYPES:
        return f"choose the kind of line: {', '.join(LINE_TYPES)}."
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
#: Payment on a PO / Work Order (#1414), or Convert to Cheque / Link a new cheque (#1416).
NEW_CHEQUE_FROM_REQUEST = "request"
NEW_CHEQUE_FROM_PAYMENT = "payment"
#: Per place: what it does, and how the user puts the payment on the recorded cheque instead.
_TAKEN_NUMBER_WORDING = {
    NEW_CHEQUE_FROM_REQUEST: ("A payment made here gets its own new cheque.", "request it as Online, then add it"),
    NEW_CHEQUE_FROM_PAYMENT: ("This makes a new cheque for the payment.", "add it"),
}


def payment_duplicate_problem(header: ChequeHeader, *, made_from: str) -> str:
    """The refusal when a payment's new Cheque names a bank + cheque number already recorded.
    `made_from` is NEW_CHEQUE_FROM_REQUEST or NEW_CHEQUE_FROM_PAYMENT. Either way a new Cheque is
    made; joining an existing one is done from the report."""
    label = bank_label(header.bank or "", header.bank_name)
    what, how = _TAKEN_NUMBER_WORDING[made_from]
    return (
        f"Cheque {header.cheque_no} ({label}) already exists. {what} To put this payment on "
        f"{header.cheque_no}, {how} to the cheque in Reports, Cheque Payments."
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
#: Pending joined Issued with #1479, so a Request Payment cheque waiting for approval stays editable.
#: ⚠️ Spec #1477 makes a Payment cheque photo-only once Issued: #1482 drops ISSUED from here.
EDITABLE_STATUSES = (PENDING, ISSUED)


def edit_access_problem(*, status: str, owner: str, user: str, any_cheque: bool) -> str | None:
    """Why `user` may not edit this Cheque, or None. `any_cheque` is True for Admin, Accountant and
    Accountant Lead; anyone else who may use cheques (Procurement) edits only the Pending or Issued
    Cheques they created (`EDITABLE_STATUSES`)."""
    if any_cheque or (status in EDITABLE_STATUSES and owner == user):
        return None
    return "You can edit only the Pending or Issued cheques you created."


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
) -> str | None:
    """Why this edit of a Cheque cannot be saved, or None. The rules are the ones the editor sees:

    * the photo can be replaced, never removed;
    * a Cleared or Cancelled Cheque can change only its photo; a Pending one edits like an Issued one
      (`EDITABLE_STATUSES`);
    * an Issued Cheque made from the PO/WO page keeps its number, date and amount while it still has a
      Project Payment line (they stay in step with the payment), but its other fields and its lines can
      change. With no Project Payment line left (removed, swapped out, or dropped by a payee change) it
      edits like a report-made Cheque;
    * an Issued Cheque made on the report can change everything;
    * any line can come off an Issued Cheque. A Project Payment taken off switches back to Online
      (`payments_taken_off`), whatever its status, and its status stays as it is.

    The header and line rules every save runs (one payee, a live Cheque per payment, ...) are the
    `validate` controller's, not repeated here.
    """
    if before.attachment and not after.attachment:
        return "The cheque's photo can be replaced, not removed."
    changed = [f for f in EDITABLE_HEADER_FIELDS if getattr(before, f) != getattr(after, f)]
    if status not in EDITABLE_STATUSES:
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
    off an Issued Cheque switches back to Online (owner ruling, spec #1407 story 82)."""
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


def _cheque_text(cheque_no: str | None, cheque_status: str | None) -> str:
    return f"cheque {cheque_no} ({cheque_status})"


def _is_rejected(status: str | None) -> bool:
    return (status or "").strip() == PAYMENT_REJECTED


def new_payment_cheque_problem(
    payment: str,
    *,
    is_cheque: bool,
    status: str | None,
    cheque_no: str | None = None,
    cheque_status: str | None = None,
) -> str | None:
    """Why `payment` cannot be put on a new one-line Cheque from the PO / Work Order page, or None (#1416).

    An Online payment converts (Convert to Cheque). A Cheque payment gets a new Cheque (Link a new
    cheque) once its Cheque is Cancelled, the old one staying as history, or when it is on no Cheque
    at all. A Rejected payment is never put on a cheque. `cheque_status` is the status of the Cheque
    the payment names, None when it names none.
    """
    if _is_rejected(status):
        return f"Payment {payment} is Rejected and cannot be put on a cheque."
    if is_cheque and cheque_status not in _RELEASED_CHEQUE_STATUSES:
        return (
            f"Payment {payment} is on {_cheque_text(cheque_no, cheque_status)}. A new cheque can be "
            "linked only once that cheque is Cancelled."
        )
    return None


def switch_to_online_problem(
    payment: str,
    *,
    is_cheque: bool,
    status: str | None = None,
    cheque_no: str | None = None,
    cheque_status: str | None = None,
) -> str | None:
    """Why a payment cannot be switched back to Online, or None (#1416). A Cheque payment goes back once
    its Cheque is Cancelled, or, not Rejected, when it is on no Cheque at all."""
    if not is_cheque:
        return f"Payment {payment} is already Online."
    if cheque_status is None and _is_rejected(status):
        return f"Payment {payment} is Rejected."
    if cheque_status not in _RELEASED_CHEQUE_STATUSES:
        return (
            f"Payment {payment} goes back to Online only once its cheque is Cancelled; it is on "
            f"{_cheque_text(cheque_no, cheque_status)}."
        )
    return None


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
