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


def header_problem(header: ChequeHeader, *, line_count: int, photo_required: bool) -> str | None:
    """Why this header cannot be saved, or None.

    `line_count` is how many Cheque lines it carries: a Cheque with none is an Ad-hoc cheque and
    needs a description. `photo_required` is True for every new Cheque except a backfilled one.
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
    if line_count == 0 and not header.description:
        return "A cheque with no lines is an Ad-hoc cheque: write a description of what it pays for."
    return None


def duplicate_problem(header: ChequeHeader, existing: str) -> str:
    """The refusal for a bank + cheque number already recorded, naming the Cheque that has it."""
    return (
        f"Cheque {header.cheque_no} on {bank_label(header.bank or '', header.bank_name)} is already "
        f"recorded as {existing}."
    )
