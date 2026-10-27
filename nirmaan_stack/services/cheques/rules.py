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

The rest of the Cheque's pure rules sit beside it, one concern each: `edit_rules` (editing, and what the
Tracker's Add and Edit take), `payment_rules` (what a cheque payment refuses), `approval_rules` (one
cheque, one decision), `clear_rules` (clear, cancel, a deposit's moves) and `bank_import_rules` (the
bank import's cheque pass).

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
PENDING = "Approval Pending"
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
#: A Security Deposit cheque's line (#1486, spec #1477): a PO the deposit secures (never a Work Order, spec
#: #1514). A record only: no payment, no amount.
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
    drawn_anew: bool = True,
) -> str | None:
    """Why this header cannot be saved, or None.

    `line_count` is how many Cheque lines it carries: a live Payment cheque with none is an Ad-hoc
    cheque and needs a description. A `cancelled` one may have neither: its last payment dropped off
    (#1413). A Security Deposit cheque pays nothing, so it needs no line and no description (#1486).
    `photo_required` is True for every new Cheque except a backfilled one.
    A post-dated cheque date is allowed.

    A Payment cheque is drawn on ICICI Bank, the only bank whose statement the import reads, so nothing
    else can clear it (#1516, ADR-0035 Amendment A). `drawn_anew` is True for a new Cheque and for a save
    that changes its bank or number; a Payment cheque on Others made before the rule keeps saving while
    both stay, since cancelling it, the only way to close it, saves it. A Security Deposit cheque is never
    cleared, so it may be on any bank.
    """
    if header.bank not in BANKS:
        return "Choose the bank the cheque is drawn on: ICICI Bank or Others."
    if cheque_type == CHEQUE_TYPE_PAYMENT and header.bank != ICICI_BANK and drawn_anew:
        return "A Payment cheque is drawn on ICICI Bank, the only bank whose statement clears it."
    if header.bank == OTHER_BANK and not header.bank_name:
        return "Type the name of the bank the cheque is drawn on."
    if not header.cheque_no:
        return "Enter the cheque number."
    if not header.cheque_date:
        return "Enter the Cheque/Payment Date."
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
        return "a Security Deposit cheque pays nothing: its lines only name the POs it secures."
    if cheque_type != CHEQUE_TYPE_SECURITY_DEPOSIT and line.line_type == LINE_SECURED_RECORD:
        return "only a Security Deposit cheque names a PO it secures."
    return None


def secured_line_problem(line: ChequeLineInput, *, cheque_vendor: str | None, record: dict | None) -> str | None:
    """Why a Secured PO/WO line cannot be saved, or None. The caller prefixes "Line N: " (#1486).

    `record` is the PO's `{project, vendor}` (None when it does not exist). The line names one of the
    cheque's Vendor's POs, so a cheque made out to a typed payee names none, and never a Work Order: Work
    Orders are never paid by cheque (spec #1514, ADR-0035 Amendment A). Its project is the record's own (the
    caller fills it in when the form sent none).
    """
    if not cheque_vendor:
        return "a cheque made out to a typed payee names no PO."
    if line.record_doctype == WORK_ORDER_DOCTYPE and line.record_name:
        return f"{line.record_name} is a Work Order: a Security Deposit cheque secures POs only."
    if line.record_doctype != PO_DOCTYPE or not line.record_name:
        return "pick the PO."
    if record is None:
        return f"{line.record_name} was not found."
    if record.get("vendor") != cheque_vendor:
        return f"{line.record_name} is not a PO of this cheque's Vendor."
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


# -- a Payment cheque follows its payments (spec #1477, ADR-0035) --------------------------------
#: The payment statuses each cheque status stands for. A Rejected payment is apart: it counts only when
#: every payment on the cheque is Rejected (`status_from_payments`).
WAITING_STATUSES = (STATUS_REQUESTED, STATUS_CEO_PENDING)
_APPROVED = (STATUS_APPROVED, STATUS_RECONCILIATION_PENDING)
_KNOWN_PAYMENT_STATUSES = WAITING_STATUSES + _APPROVED + (STATUS_PAID, STATUS_REJECTED)


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
    if any(s is None or s in WAITING_STATUSES for s in statuses):
        return PENDING
    live = [s for s in statuses if s != STATUS_REJECTED]
    if not live:
        return CANCELLED
    return CLEARED if all(s == STATUS_PAID for s in live) else ISSUED


def ready_to_issue(payment_statuses: Sequence[str | None]) -> bool:
    """May an Approval Pending Payment cheque be Issued now? Pure. One entry per line, as `status_from_payments`.

    Only once EVERY line's payment has been approved and moved on to Reconciliation Pending (#1479): a
    payment still at Approved holds the cheque at Approval Pending, because the move that follows the approval
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
    (GLOSSARY.md). An Old-type cheque keeps its status; it is cleared by its bank line like any other
    (#1516, every line paid in full) and may be cancelled by hand.
    """
    if any(t in EXPENSE_LINE_TYPES for t in line_types):
        return "pays expenses"
    if not line_types:
        return "has no lines"
    if payee_name and not vendor:
        return "is made out to a typed payee"
    return None


# -- amounts, numbers and dates, as every rules module words them ------------------------------
#: How far a Payment cheque's lines may be from its amount and still be approved (C2): the bank line
#: that clears the cheque is matched within the same ₹5 (`outflow_import/amounts.AMOUNT_TOLERANCE`).
LINES_TOLERANCE = 5.0


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


def join_words(words: list[str]) -> str:
    """`words` as a refusal lists them: "a", "a and b", "a, b and c"."""
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"


def day_text(day: str) -> str:
    """A `YYYY-MM-DD` day as a refusal or note writes it: `DD-MM-YYYY`."""
    year, month, date = day[:10].split("-")
    return f"{date}-{month}-{year}"


