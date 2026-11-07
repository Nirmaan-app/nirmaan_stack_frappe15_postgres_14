# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Bill check's verdict: does an expense bill's total agree with its statement line? (#1639, spec #1637)

PURE MODULE -- no `frappe`, no database, in the shape of the Porter verdict (`outflow_import.porter_verdict`).
The reading job (`expense_bills.reading`) hands it what the reader found and the line's amount. GLOSSARY
*Bill check* names the results.

THE READER'S OWN CONFIDENCE IS NOT USED. The Gemini reader scores every field it returns 1.0, so it tells
nothing; only the total's agreement with the line decides.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from nirmaan_stack.services.outflow_import.amounts import rupees

CHECKING = "Checking"
MATCHED = "Matched"
MISMATCHED = "Mismatched"
NOT_READ = "Not read"
NOT_CHECKED = "Not checked"

#: A total within this of the line amount is Matched, both ends included: paisa round-off on a bill is not a
#: difference (spec story 3).
TOLERANCE = Decimal("1")


def paise(value) -> Decimal:
    """`value` (a Currency column, a float, a string; None as 0) as a Decimal of whole paise, the one shape every
    amount takes before it meets `check_bill`."""
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


@dataclass(frozen=True)
class BillRead:
    """What the reader found on the bill. `total` (incl. GST) is None when it read none."""

    total: Decimal | None
    invoice_no: str = ""
    invoice_date: date | None = None


@dataclass(frozen=True)
class ReadFailed:
    """The reader gave nothing back: an error, a timeout, reading switched off. `reason` says why, as a person
    reads it."""

    reason: str


@dataclass(frozen=True)
class BillVerdict:
    """`result` and its `reason` (blank on Matched); `invoice_no`, `invoice_date` and `total` are what to fill,
    empty unless the result allows it."""

    result: str
    reason: str = ""
    invoice_no: str = ""
    invoice_date: date | None = None
    total: Decimal | None = None

    @property
    def auto_approves(self) -> bool:
        """A Matched bill is approved by the system (GLOSSARY *Expense bill approval*); every other result waits for
        a person."""
        return self.result == MATCHED


def check_bill(read: BillRead | ReadFailed, line_amount: Decimal, bill_count: int = 1) -> BillVerdict:
    """The Bill check of one bill against `line_amount`, the amount of the statement line that recorded the spend.

    * Not checked -- the spend carries several bills (`bill_count` > 1): a merged file gives one guessed total, so
      the line amount is taken as its total and no number or date is filled. The reader's output is ignored.
    * Not read -- the reader failed (`ReadFailed`, its reason kept), or read no total.
    * Matched -- the total is within `TOLERANCE` of the line. Its number, date and total are the ones to fill.
    * Mismatched -- further off, a credit note's negative total included. Nothing is filled.
    """
    if bill_count > 1:
        return BillVerdict(
            NOT_CHECKED,
            f"The spend carries {bill_count} bills; its total is taken as the line amount.",
            total=line_amount,
        )
    if isinstance(read, ReadFailed):
        return BillVerdict(NOT_READ, read.reason)
    if read.total is None:
        return BillVerdict(NOT_READ, "No total was read on the bill.")
    if abs(read.total - line_amount) > TOLERANCE:
        return BillVerdict(
            MISMATCHED,
            f"The bill's total is {rupees(read.total, paise=True)}; the statement line is "
            f"{rupees(line_amount, paise=True)}.",
        )
    return BillVerdict(MATCHED, "", (read.invoice_no or "").strip(), read.invoice_date, read.total)
