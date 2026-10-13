# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cheque's rules that need no database (spec #1407, ADR-0010 B1). Pure: no `frappe.db`.

A **Cheque** is one paper cheque the company writes (GLOSSARY.md). This module names its statuses,
banks, line kinds and where it was made, turns the values a form sends into a `ChequeHeader`, and
says why a header cannot be saved. `services/cheques/writer.py` is the only code that writes a Cheque;
it and the `validate` controller both ask this module.

Each `*_problem` function returns the refusal a user reads, or None.
"""

from dataclasses import dataclass

from frappe.utils import flt

# -- statuses ------------------------------------------------------------------------------------
ISSUED = "Issued"
CLEARED = "Cleared"
CANCELLED = "Cancelled"
#: Pinned to the `Cheques.status` Select options by test.
CHEQUE_STATUSES = (ISSUED, CLEARED, CANCELLED)

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


def _text(value) -> str:
    return " ".join(str(value or "").split())


def bank_key(bank: str, bank_name: str | None = None) -> str:
    """The bank's identity for the uniqueness rule: an Others bank's typed name, else the fixed bank,
    lower-cased with repeated spaces collapsed. "HDFC Bank" and "hdfc  bank" are the same bank."""
    name = bank_name if bank == OTHER_BANK else bank
    return _text(name).casefold()


def bank_label(bank: str, bank_name: str | None = None) -> str:
    """The bank as a user reads it: the typed name for Others."""
    return _text(bank_name) if bank == OTHER_BANK and _text(bank_name) else _text(bank)


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
        return _text(values.get(key)) or None

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
        return _text(values.get(key)) or None

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
