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

ACTIVE = "Active"
INACTIVE = "Inactive"
#: Pinned to the doctype's `status` options by test.
PAYEE_STATUSES = (ACTIVE, INACTIVE)

#: A Project Payment or an Expense at one of these has paid its Payee: the money has left Approved.
#: The same set as "settled" (`services/settlement.SETTLED_STATUSES`), so paid means one thing: a
#: Payee is Locked, an expense's Payee is fixed and "last paid" is read at exactly these statuses.
PAID_STATUSES = SETTLED_STATUSES

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


def locked_change_problem(name: str, before: PayeeDetails, after: PayeeDetails) -> str | None:
    """The refusal when a save would change a Locked Payee's account number or IFSC, or None.

    Only asked of a Payee that has been paid (`links.is_paid`): once money has gone to an account,
    the record of where it went never changes. The holder name is not locked.
    """
    if (before.account_number, before.ifsc) == (after.account_number, after.ifsc):
        return None
    return (
        f"{name}'s account number and IFSC are locked because money has been paid to it. "
        "If the holder has moved banks, add a new payee and mark this one inactive."
    )


#: The holder-name edit is Accounts' (`role_profiles.PAYEE_MANAGE_PROFILES`).
HOLDER_NAME_ROLE_PROBLEM = "Only Accounts and Admins can change a payee's holder name."


def status_change_problem(name: str, current: str, wanted: str) -> str | None:
    """Why Payee `name` can't move from `current` to `wanted`, or None."""
    if wanted not in PAYEE_STATUSES:
        return f"A payee is Active or Inactive, not {wanted}."
    if current == wanted:
        return f"{name} is already {wanted}."
    return None


def inactive_pick_problem(name: str) -> str:
    """The refusal when a vendor, an expense or an expense request newly picks Inactive Payee `name`."""
    return f"{name} is Inactive, so it can't be picked any more. Pick an active payee, or add a new one."


def pick_problem(name: str, status: str | None) -> str | None:
    """Why Payee `name`, at `status` (None: no such Payee), can't be newly picked, or None. Only an
    Active Payee can be; a record already pointing at an Inactive one keeps it (the callers ask this
    of a new pick only). One predicate for the screens' early refusal (`choosing.assert_pickable`)
    and the every-save one (`guard.check_payee_pick`)."""
    if status is None:
        return f"Payee {name} does not exist."
    if status != ACTIVE:
        return inactive_pick_problem(name)
    return None


def already_linked_problem(vendor: str, payee: str) -> str:
    """The refusal when Change account picks the Payee vendor `vendor` is already paid into."""
    return f"{vendor} is already paid into {payee}. Pick another payee, or enter new bank details."
