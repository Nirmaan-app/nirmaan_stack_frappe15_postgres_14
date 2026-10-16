# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The IFSC lookup: an IFSC's bank and branch, from Razorpay's public IFSC service.

The only outside bank service the app calls. `fetch_ifsc` is the one HTTP call (the vendor forms'
`api/bank_details.generate_bank_details` uses it too); `lookup_ifsc` is what the Payee module asks,
and it refuses an IFSC the service does not know. Tests patch `fetch_ifsc` (`api/payees/payee_fixture`).
"""

from __future__ import annotations

from dataclasses import dataclass

import frappe
import requests
from frappe import _

IFSC_SERVICE = "https://ifsc.razorpay.com/{}"
TIMEOUT_SECONDS = 10


class IfscLookupError(frappe.ValidationError):
    """The IFSC lookup found no bank for an IFSC, or could not be reached."""


@dataclass(frozen=True)
class BankBranch:
    """The bank and branch an IFSC belongs to, as the lookup names them."""

    bank_name: str
    bank_branch: str


def fetch_ifsc(ifsc: str) -> dict | None:
    """Razorpay's record for `ifsc` (`BANK`, `BRANCH`, `ADDRESS`, ...), or None when it has none.
    Raises `requests.RequestException` when the service can't be reached."""
    response = requests.get(IFSC_SERVICE.format(ifsc), timeout=TIMEOUT_SECONDS)
    return response.json() if response.ok else None


def lookup_ifsc(ifsc: str) -> BankBranch:
    """The bank and branch of `ifsc`. Raises `IfscLookupError` when the lookup finds none or fails."""
    try:
        record = fetch_ifsc(ifsc)
    except requests.RequestException:
        frappe.throw(_("Couldn't reach the IFSC lookup. Try again in a minute."), IfscLookupError)
    if not record or not record.get("BANK"):
        frappe.throw(_("IFSC {0} was not found. Check it and try again.").format(ifsc), IfscLookupError)
    return BankBranch(bank_name=record["BANK"], bank_branch=record.get("BRANCH") or "")
