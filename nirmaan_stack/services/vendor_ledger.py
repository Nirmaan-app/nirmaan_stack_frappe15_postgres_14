"""Vendor ledger statement — the "Invoices Ledger" rule.

One view of a vendor's ledger = opening balance, rows with a running balance,
totals and closing balance. The Vendor page's Ledger tab and the "Vendor Ledger"
print format both show this. The frontend mirror is
``frontend/src/pages/vendors/utils/vendorLedgerStatement.ts``; keep the two in step.

Pure: no ``frappe.db``, no request context. Rows come from
``api.vendor.get_vendor_po_invoices.get_po_ledger_data``: dicts with
``type, date ('YYYY-MM-DD HH:MM:SS'), project, details, amount, payment``,
already sorted by date.
"""

from datetime import date, timedelta

# get_po_ledger_data drops every row dated before LEDGER_START. The Vendors
# balancing fields (invoice_balance / payment_balance) hold the balance as on BASE_AS_ON.
LEDGER_START = "2025-04-01"
BASE_AS_ON = "2025-03-31"

# Order-creation rows. The invoices ledger shows invoices, credit notes,
# payments and refunds only.
ORDER_ROW_TYPES = ("PO Created", "SR Created")


def invoice_ledger_rows(rows):
	return [r for r in rows if r.get("type") not in ORDER_ROW_TYPES]


def _day(value):
	"""'YYYY-MM-DD[ HH:MM:SS]' -> 'YYYY-MM-DD'; '' when empty."""
	return str(value or "")[:10]


def _day_before(day):
	return (date.fromisoformat(day) - timedelta(days=1)).isoformat()


def build_ledger_statement(
	rows, opening_invoice=0, opening_payment=0, from_date=None, to_date=None, projects=None
):
	"""Statement for one view: project filter, then the date range.

	Rows dated before ``from_date`` (after the project filter) are folded into the
	opening balance, so a period's statement opens at the real balance on the day
	before it and closes at the real balance on ``to_date``. Dates are inclusive days.
	"""
	project_set = set(projects or [])
	scoped = [r for r in rows if not project_set or r.get("project") in project_set]
	from_day = _day(from_date)
	to_day = _day(to_date)

	carried = [r for r in scoped if from_day and _day(r.get("date")) < from_day]
	shown = [
		r
		for r in scoped
		if (not from_day or _day(r.get("date")) >= from_day) and (not to_day or _day(r.get("date")) <= to_day)
	]

	opening_inv = float(opening_invoice or 0) + sum(float(r.get("amount") or 0) for r in carried)
	opening_pay = float(opening_payment or 0) + sum(float(r.get("payment") or 0) for r in carried)
	as_on = _day_before(from_day) if from_day > LEDGER_START else BASE_AS_ON

	balance = opening_inv - opening_pay
	out_rows = []
	for r in shown:
		balance += float(r.get("amount") or 0) - float(r.get("payment") or 0)
		out_rows.append({**r, "balance": balance})

	return {
		"opening": {
			"as_on": as_on,
			"invoice": opening_inv,
			"payment": opening_pay,
			"balance": opening_inv - opening_pay,
			# True when the opening row IS the editable Vendors balancing figure.
			"is_base": as_on == BASE_AS_ON,
		},
		"rows": out_rows,
		"totals": {
			"invoice": sum(float(r.get("amount") or 0) for r in shown),
			"payment": sum(float(r.get("payment") or 0) for r in shown),
		},
		"closing": balance,
		"period": {"from": max(from_day, LEDGER_START) if from_day else LEDGER_START, "to": to_day or None},
		"projects": sorted(project_set),
	}
