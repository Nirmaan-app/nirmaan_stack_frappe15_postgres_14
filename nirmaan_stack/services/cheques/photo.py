# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What a cheque photo says, as the cheque forms need it (spec #1407, #1409). Pure: no `frappe.db`.

The photo reader (`api/payment_autofill.extract_payment_fields(mode="cheque")`) asks Gemini to copy
what is printed on the cheque. This module turns those copies into form values. A value it cannot
trust comes back empty, so the user types it: a blank field is never a wrong one.
"""

import re
from datetime import date

from frappe.utils import flt

from nirmaan_stack.services.cheques.rules import ICICI_BANK, OTHER_BANK, squash_spaces

#: The cheque number is the first group of the MICR line, and it is always six digits.
_CHEQUE_NO_DIGITS = 6


def cheque_no_from_micr(micr_line: str | None) -> str:
    """The cheque number: the first group of the MICR line at the cheque's foot.

    `⑈004521⑈ 400229012⑆ 000123⑈ 29` gives `004521`. The later groups are the bank and branch
    code, the account and the transaction code, never the number. A first group that is not six
    digits means the line was misread, so the number is left empty.
    """
    groups = re.findall(r"\d+", str(micr_line or ""))
    if groups and len(groups[0]) == _CHEQUE_NO_DIGITS:
        return groups[0]
    return ""


def cheque_date_from_boxes(boxes: str | None) -> str:
    """The cheque date as YYYY-MM-DD, from the eight DD-MM-YYYY boxes; empty unless it is a real day.

    The boxes are always day, month, year, so `05-06-2026` is 5 June, never 6 May.
    """
    digits = re.sub(r"\D", "", str(boxes or ""))
    if len(digits) != 8:
        return ""
    try:
        return date(int(digits[4:]), int(digits[2:4]), int(digits[:2])).isoformat()
    except ValueError:
        return ""


def bank_from_printed_name(printed: str | None) -> tuple[str, str]:
    """`(bank, bank_name)` for the form: ICICI Bank when the printed name is ICICI's, else Others with
    the printed name. `("", "")` when no name was read."""
    name = squash_spaces(printed)
    if not name:
        return "", ""
    if "icici" in name.casefold():
        return ICICI_BANK, ""
    return OTHER_BANK, name


def amount_from_figures(figures) -> float | None:
    """The cheque amount from the figures box; None unless it is a positive number.

    Only the figures are read. The amount in words is never a fallback: a misread there is not
    checkable against anything on the form.
    """
    amount = flt(re.sub(r"[^\d.]", "", str(figures or "")), 2)
    return amount if amount > 0 else None


def cheque_photo_fields(*, bank_name, micr_line, cheque_date, amount_in_figures, payee) -> dict:
    """A cheque form's values from what the model copied off the photo. Unsure is empty."""
    bank, other_bank_name = bank_from_printed_name(bank_name)
    return {
        "bank": bank,
        "bank_name": other_bank_name,
        "cheque_no": cheque_no_from_micr(micr_line),
        "cheque_date": cheque_date_from_boxes(cheque_date),
        "amount": amount_from_figures(amount_in_figures),
        "payee_name": squash_spaces(payee),
    }
