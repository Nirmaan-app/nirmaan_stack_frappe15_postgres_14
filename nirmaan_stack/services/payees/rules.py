# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Payee rules that need no database (spec #1420, ADR-0033).

PURE MODULE -- no `frappe`, no database, no request context. The rest of the Payee module
(`services/payees/`) and the Payee `validate` controller read these; nothing else re-states them.

A Payee is one bank account with its holder's name. Two Payees never share an account number and
IFSC, compared on the account's identity form: spaces, dashes and leading zeros ignored, exactly as
Bulk Import compares a bank line's account (`services/outflow_import/normalize.normalize_account`,
which owns that rule).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from nirmaan_stack.services.outflow_import.normalize import normalize_account
from nirmaan_stack.services.settlement import SETTLED_STATUSES

PAYEE_DOCTYPE = "Payee"

#: What a person types for a Payee's account: the bank and branch are looked up from the IFSC.
ENTERED_FIELDS = ("account_name", "account_number", "ifsc")
#: A Payee's account fields: THE list every copy (`pay_to.PAY_TO_FIELDS`) and every vendor read
#: (`vendor_account.VENDOR_ACCOUNT_FIELDS`) is derived from.
ACCOUNT_FIELDS = (*ENTERED_FIELDS, "bank_name", "bank_branch")

#: A Project Payment or an Expense at one of these is paid: the money has left Approved. The same set
#: as "settled" (`services/settlement.SETTLED_STATUSES`), so paid means one thing.
PAID_STATUSES = SETTLED_STATUSES

#: A Payee's type: where it was CREATED (owner, 2026-10-23), set once and never changed (`set_only_once`).
#: Users -- a person's own bank account, added from Raise Reimbursement (`own_accounts.add_own_account`);
#: Vendors -- a vendor's bank details (`choosing.choose_payee`, the #1424 vendor patch); Others -- anywhere
#: else (the Payees page, an expense's Add new payee). In the doctype's option order; pinned by test.
PAYEE_TYPE_USERS = "Users"
PAYEE_TYPE_VENDORS = "Vendors"
PAYEE_TYPE_OTHERS = "Others"
PAYEE_TYPES = (PAYEE_TYPE_USERS, PAYEE_TYPE_VENDORS, PAYEE_TYPE_OTHERS)

_SEPARATORS = re.compile(r"[\s\-]+")
_SPACES = re.compile(r"\s+")
_ACCOUNT_CHARS = re.compile(r"^[A-Z0-9]+$")
_IFSC = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")


@dataclass(frozen=True)
class PayeeDetails:
    """A Payee's bank account as typed, cleaned: the holder name with its spaces collapsed, the account
    number without spaces or dashes and upper-cased, and the IFSC upper-cased."""

    account_name: str
    account_number: str
    ifsc: str

    @property
    def normalized_account(self) -> str:
        """The account's identity form: no leading zeros either. Unique together with the IFSC."""
        return normalize_account(self.account_number)


def parse_details(account_name, account_number, ifsc) -> PayeeDetails:
    """Clean what was typed into a `PayeeDetails`. Refuses nothing: ask `details_problem`."""
    return PayeeDetails(
        account_name=_SPACES.sub(" ", str(account_name or "")).strip(),
        account_number=_SEPARATORS.sub("", str(account_number or "")).upper(),
        ifsc=str(ifsc or "").strip().upper(),
    )


def details_problem(details: PayeeDetails) -> str | None:
    """Why these details can't be a Payee, or None. Every field is required."""
    if not details.account_name:
        return "Enter the account holder name."
    if not details.account_number or details.normalized_account == "0":
        return "Enter the account number."
    if not _ACCOUNT_CHARS.match(details.account_number):
        return "An account number holds only letters and digits."
    if not details.ifsc:
        return "Enter the IFSC."
    if not _IFSC.match(details.ifsc):
        return "An IFSC is 11 characters: four letters, a zero, then six letters or digits (e.g. SBIN0005943)."
    return None


def duplicate_problem(existing: str, existing_account_name: str | None) -> str:
    """The refusal for details whose account number and IFSC already belong to Payee `existing`."""
    holder = f", {existing_account_name}," if existing_account_name else ""
    return (
        f"This account is already a payee: {existing}{holder} has the same account number and IFSC. "
        "Pick that payee instead of adding a new one."
    )


def payee_in_use_problem(payee: str, vendors: list[tuple[str, str | None]]) -> str:
    """The refusal to delete Payee `payee` while `vendors` (`(name, vendor_name)`) are paid into it."""
    named = "; ".join(f"{vendor_name} ({name})" if vendor_name else name for name, vendor_name in vendors)
    one = len(vendors) == 1
    return (
        f"{payee} can't be deleted: {len(vendors)} vendor{'' if one else 's'} {'is' if one else 'are'} "
        f"paid into it ({named}). Point {'it' if one else 'them'} at another payee first."
    )


def already_linked_problem(vendor: str, payee: str) -> str:
    """The refusal when Use a different payee picks the Payee vendor `vendor` is already paid into."""
    return f"{vendor} is already paid into {payee}. Pick another payee, or enter new bank details."


def payee_type_from_links(is_own_account: bool, vendor_count: int) -> str:
    """The type a Payee created before `payee_type` existed is given, from what links to it now: a person's own
    account -> Users, else any vendor -> Vendors, else Others. For the one-time backfill only
    (`patches/v3_0/backfill_payee_type`); every Payee created since is typed by its creator and never changes."""
    if is_own_account:
        return PAYEE_TYPE_USERS
    if vendor_count > 0:
        return PAYEE_TYPE_VENDORS
    return PAYEE_TYPE_OTHERS
