# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Generated invoices on a GST-off Work Order (#1546, spec #1528; GLOSSARY *Generated invoice*,
*RA number*).

A GST-off vendor cannot issue a tax invoice, so the company drafts one for them to sign: a
**WO Generated Invoice** record. Its life:

    Generated --upload signed copy--> Signed --Vendor Invoice approved--> Approved
        |                               |                                    |
        +--void (with a reason)--> Voided <--Vendor Invoice rejected---------+

Generate, void and the signed upload are `api/service_requests/generated_invoices.py` (#1546, #1547).
The upload creates the record's Pending Vendor Invoice; that invoice's approval or rejection moves the
record (`vendor_invoice_move`, applied by the Vendor Invoices `on_update` hook
`controllers/vendor_invoices.follow_generated_invoice`), so every approval path moves it.

Rules:

* The **RA number** is the system's, per Work Order: 1, 2, 3, ... in order, never typed, never reused
  (a void burns its number), not restarted by a new financial year. A FINAL takes the next one too,
  so one sequence covers every record and the record name `WGI-<WO>-<n>` keeps a pair unique. An
  older Work Order starts after the highest "RA-n" already used on its saved invoice number or its
  Vendor Invoices (`next_ra_number`).
* The **amount** may not pass `billable_left`: the smaller of the Work Order's amount and its Amount
  Paid (incl. TDS), less what is already billed or waiting -- Approved and Pending Vendor Invoices,
  and generated invoices not yet uploaded (status Generated; a Signed one is its Pending invoice).
* At most one **FINAL** (not Voided): it bills what is left, only once the Work Order is fully paid,
  and nothing is generated after it.
* A record is **never edited**: only the moves in `MOVES`, each writing only its own fields
  (`change_problem`, run by the doctype's `validate`).

PURE -- no database, no request context.
"""

import re

from frappe.utils import cint, cstr, flt, getdate

DOCTYPE = "WO Generated Invoice"

RA = "RA"
FINAL = "FINAL"
INVOICE_TYPES = (RA, FINAL)

GENERATED = "Generated"
SIGNED = "Signed"
APPROVED = "Approved"
VOIDED = "Voided"
STATUSES = (GENERATED, SIGNED, APPROVED, VOIDED)

#: Billed but not yet a Vendor Invoice: counts against the amount limit by its own amount.
NOT_UPLOADED = (GENERATED,)
#: Vendor Invoice statuses that count as billed or waiting.
BILLED_INVOICE_STATUSES = ("Pending", "Approved")

#: status -> {status it may move to: the fields that move writes, each required}.
MOVES = {
	GENERATED: {SIGNED: ("vendor_invoice", "signed_attachment"), VOIDED: ("void_reason",)},
	SIGNED: {APPROVED: (), VOIDED: ("void_reason",)},
	# An Approved Work Order invoice may still be rejected (#1531, ADR-0014 Amendment A): its record follows.
	APPROVED: {VOIDED: ("void_reason",)},
}

#: Vendor Invoice status -> what it makes of the generated invoice it came from (`vendor_invoice_move`).
_INVOICE_MOVES = {"Approved": APPROVED, "Rejected": VOIDED}

#: What the vendor signs for. Set once by Generate, never changed.
FIXED_FIELDS = ("work_order", "project", "vendor", "ra_number", "invoice_type", "amount", "invoice_date", "invoice_no")
#: Written only by a move in `MOVES`.
MOVE_FIELDS = ("void_reason", "vendor_invoice", "signed_attachment")

#: Rupees of Amount Due still counted as fully paid: the Work Order payment request cap's tolerance
#: (`services/work_order_payment_limit.TOLERANCE`), so a WO paid to that cap can take its FINAL.
FULLY_PAID_TOLERANCE = 10

_RA_IN_TEXT = re.compile(r"\bRA\s*[-–]?\s*(\d+)", re.IGNORECASE)


def next_ra_number(used_ra_numbers, invoice_numbers) -> int:
	"""The RA number the next generated invoice gets: one above the highest of `used_ra_numbers`
	(every record's, Voided included) and every "RA-n" written in `invoice_numbers` (the Work Order's
	saved invoice number and its Vendor Invoices' numbers, from before invoices were generated)."""
	highest = max((cint(n) for n in used_ra_numbers), default=0)
	for text in invoice_numbers:
		for found in _RA_IN_TEXT.findall(cstr(text)):
			highest = max(highest, int(found))
	return highest + 1


def financial_year_code(invoice_date) -> str:
	"""The April-March financial year of a date, as "26-27"."""
	d = getdate(invoice_date)
	start = d.year if d.month >= 4 else d.year - 1
	return f"{start % 100:02d}-{(start + 1) % 100:02d}"


def invoice_number(invoice_date, project, work_order, invoice_type, ra_number, final_number: int = 1) -> str:
	"""INV-<FY>-<project last 5>-<WO last 5>-<RA-n | FINAL>, the format the WO page has printed since
	#1405; the year is the invoice date's. A FINAL generated after a voided one prints its own number,
	FINAL-2, FINAL-3 (`final_number`, counting every FINAL the WO has had), so a voided number is never
	printed again."""
	if invoice_type == FINAL:
		suffix = FINAL if cint(final_number) <= 1 else f"{FINAL}-{cint(final_number)}"
	else:
		suffix = f"RA-{cint(ra_number)}"
	return f"INV-{financial_year_code(invoice_date)}-{cstr(project)[-5:]}-{cstr(work_order)[-5:]}-{suffix}"


def billable_left(total_amount, amount_paid, billed) -> float:
	"""The most a new generated invoice may bill: min(Work Order amount, Amount Paid incl. TDS) less
	`billed` (Approved and Pending Vendor Invoices plus generated invoices not yet uploaded), never
	below 0."""
	return max(0.0, round(min(flt(total_amount), flt(amount_paid)) - flt(billed), 2))


def is_fully_paid(total_amount, amount_paid) -> bool:
	"""Amount Paid (incl. TDS) has reached the Work Order's amount, to within ₹10."""
	return flt(amount_paid) >= flt(total_amount) - FULLY_PAID_TOLERANCE


def change_problem(before, after) -> str | None:
	"""Why `after` may not be saved over `before` (two mappings of one record), or None.

	Only a move in `MOVES` changes a record, and it writes only its own fields, each of them filled.
	"""
	for field in FIXED_FIELDS:
		if _value(field, before.get(field)) != _value(field, after.get(field)):
			return "A generated invoice is never edited. Void it and generate a new one."

	old, new = cstr(before.get("status")), cstr(after.get("status"))
	changed = {f for f in MOVE_FIELDS if cstr(before.get(f)).strip() != cstr(after.get(f)).strip()}
	if old == new:
		return "A generated invoice is never edited. Void it and generate a new one." if changed else None

	writes = MOVES.get(old, {}).get(new)
	if writes is None:
		return f"A generated invoice can't go from {old} to {new}."
	if changed - set(writes):
		return "A generated invoice is never edited. Void it and generate a new one."
	missing = [f for f in writes if not cstr(after.get(f)).strip()]
	if missing:
		return f"{new} needs {', '.join(_LABELS[f] for f in missing)}."
	return None


def vendor_invoice_move(record_status, invoice_status, rejection_reason=None, invoice_name="") -> dict | None:
	"""The change a generated invoice at `record_status` takes when its Vendor Invoice is saved at
	`invoice_status` (approved: Approved; rejected: Voided, the rejection as its reason), or None."""
	target = _INVOICE_MOVES.get(cstr(invoice_status))
	if target is None or target == record_status or target not in MOVES.get(record_status, {}):
		return None
	if target == VOIDED:
		reason = cstr(rejection_reason).strip()
		return {"status": VOIDED, "void_reason": f"Vendor Invoice {invoice_name} rejected" + (f": {reason}" if reason else ".")}
	return {"status": target}


_LABELS = {"void_reason": "a reason", "vendor_invoice": "its Vendor Invoice", "signed_attachment": "the signed copy"}


def _value(field, value):
	if field == "amount":
		return round(flt(value), 2)
	if field == "ra_number":
		return cint(value)
	if field == "invoice_date":
		return getdate(value) if value else None
	return cstr(value).strip()
