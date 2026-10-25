# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A vendor's TDS rate, read off its PAN (Section 194C). "TDS" here is tax, not Technical Data Sheets.

The 4th character of a PAN is the holder type (owner, 2026-10-16):

    PAN valid, 4th char P (Individual) or H (HUF) -> always 1%, whatever was entered
    PAN valid, any other 4th char                 -> 2% by default; any rate the user sets is kept
    PAN blank or not a valid PAN                  -> rate kept as entered

A blank or unreadable rate ("2%", "abc") counts as not entered, so a valid PAN gives it the 2%
default instead of it being stored as 0 (no tax withheld).

`Vendors.validate` applies this when a vendor is created or its PAN or rate is edited (the new-vendor
and edit screens, Desk, Data Import, a stale browser tab); every other save, such as the 04:30 credit
job's, leaves the rate alone. The forms show and lock the rate before saving:
`frontend/src/pages/vendors/utils/vendorTaxIds.ts` is this module's twin, and both read the shared
`vendor_tds_cases.json`. `patches/v3_0/set_vendor_tds_rate_from_pan.py` moved the existing
Individual / HUF vendors from 2% to 1%.

⚠️ Only future approvals see a changed rate: each `Payment TDS Deduction` snapshots the vendor's
rate the day its payment is approved (`services/payment_tds.vendor_rate`).

Pure: no `frappe.db`.
"""

import math
import re

# Same pattern as frontend/src/constants/vendorFormRegex.ts
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
# A rate as typed: a plain decimal. Hex, exponents, "%" and words are not rates.
DECIMAL_RE = re.compile(r"^\s*-?(\d+(\.\d*)?|\.\d+)\s*$")

INDIVIDUAL_HUF_HOLDER_TYPES = {"P", "H"}  # P = Individual, H = HUF
INDIVIDUAL_HUF_RATE = 1.0
DEFAULT_RATE = 2.0


def clean_pan(pan) -> str:
	"""A PAN as stored: trimmed and uppercased. Also used for a request form's PAN answers
	(`api/expense_requests/pan_answers`)."""
	return str(pan or "").strip().upper()


def is_valid_pan(pan) -> bool:
	return bool(PAN_RE.match(clean_pan(pan)))


def is_individual_huf_pan(pan) -> bool:
	"""True for a valid PAN whose 4th character is P or H: its rate is always 1%."""
	pan = clean_pan(pan)
	return bool(PAN_RE.match(pan)) and pan[3] in INDIVIDUAL_HUF_HOLDER_TYPES


def is_readable_rate(rate) -> bool:
	"""True for a number or a plain decimal string; blank, `True`, "2%" and "abc" are not rates."""
	if isinstance(rate, bool):
		return False
	if isinstance(rate, (int, float)):
		return math.isfinite(rate)
	return isinstance(rate, str) and bool(DECIMAL_RE.match(rate))


def rate_to_store(pan, rate):
	"""The rate a vendor save stores (see the module docstring)."""
	if is_individual_huf_pan(pan):
		return INDIVIDUAL_HUF_RATE
	if is_valid_pan(pan) and not is_readable_rate(rate):
		return DEFAULT_RATE
	return rate
