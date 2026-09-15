"""
One-time: record a `Payment TDS Deduction` for every PO payment that already carries a stored `tds`.

86 Paid `Procurement Orders` payments hold a legacy figure in `Project Payments.tds`, totalling
Rs 1,39,503.49, and none of them has a deduction row. This gives those figures a ledger entry so the
tax withheld on PO payments is visible beside the SR ones.

⚠️ IT WRITES THE DEDUCTION ROW AND NOTHING ELSE (owner ruling 2026-09-15). In particular:

  * `Project Payments.amount` IS NOT RE-NETTED. This is the one decision that makes the patch safe.
    The SR backfill nets the amount because an SR payment's `amount` IS the net figure and
    `Service Requests.amount_due` subtracts `total_tds`. A PO payment stores the GROSS amount with
    `tds` beside it, so netting these 86 would move `amount_paid` on their POs by Rs 1,39,503.49 and
    carry that into vendor credit, PO reports and payment reconciliation -- restating history that
    was settled years ago. The SR patch's own docstring names this hazard: a payment left with a net
    `amount` AND a populated `tds` shows the tax subtracted twice wherever `amount - tds` is drawn.
  * `Project Payments.tds` IS LEFT POPULATED. It is the only record of what was actually withheld,
    and every existing read of it keeps working.
  * NO PARENT TOTAL IS TOUCHED. `Procurement Orders` has no `total_tds` field (Service Requests
    does), so there is nothing to sync -- `sync_total_tds` already no-ops for this ledger.

⚠️ THE RATE IS DERIVED BACKWARDS, `tds / amount * 100`, NEVER READ FROM THE VENDOR. The stored
figure is the only record of what happened, and the implied rates are all over the place -- 0.08%,
0.11%, 0.12%, 4.53% on the first four rows -- so these are assorted manual entries, not a 2%
deduction. Reading today's vendor rate would invent a number nobody withheld.

⚠️ THE RESULT IS A DELIBERATE ASYMMETRY, worth knowing before reading the table: an SR deduction's
`gross_amount` sits beside a NETTED payment, a PO deduction's sits beside a GROSS one whose `tds`
column is still filled in. Both are faithful to how their era recorded the tax.

IDEMPOTENT: only payments with no deduction row are selected, so a re-run writes nothing.

REHEARSE FIRST -- writes nothing:

    bench --site <site> execute nirmaan_stack.patches.v3_0.backfill_po_payment_tds_deductions.dry_run
"""

import frappe
from frappe.utils import flt

PAYMENT = "Project Payments"
TDS_DOCTYPE = "Payment TDS Deduction"
PO = "Procurement Orders"
MIRROR = "payment_tds"

#: Rows below this are noise rather than a withholding (owner scope: "tds >= 1").
MIN_TDS = 1.0


def _candidates() -> list[dict]:
	"""PO payments carrying a stored tds and no deduction row yet.

	⚠️ `amount` IS A DATA COLUMN, AND IT IS NOT CAST IN SQL. Casting it blew up on real rows --
	`invalid input syntax for type numeric` -- because a free-text column holds values Postgres
	cannot read as a number. `tds` casts safely (every value there is numeric), so it filters here;
	the amount is validated in Python by `_figures`, where `flt` tolerates whatever the column
	actually contains and an unusable pair is skipped and reported rather than crashing the patch.
	"""
	return frappe.db.sql(
		"""
		SELECT p.name, p.amount, p.tds, p.document_name, p.vendor, p.project,
		       COALESCE(p.ceo_approval_date, p.approval_date, p.payment_date, p.creation::date)
		           AS approved_on
		FROM "tabProject Payments" p
		LEFT JOIN "tabPayment TDS Deduction" d ON d.project_payment = p.name
		WHERE p.document_type = %s
		  AND d.name IS NULL
		  AND COALESCE(NULLIF(TRIM(p.tds), '')::numeric, 0) >= %s
		ORDER BY p.name
		""",
		(PO, MIN_TDS),
		as_dict=True,
	)


def _figures(row: dict):
	"""(gross, tds, percent) for a row, or None when the stored pair cannot be a withholding."""
	gross, tds = flt(row["amount"]), flt(row["tds"])
	if gross <= 0 or tds <= 0 or tds >= gross:
		# A deduction that swallows the whole payment is bad data, not a deduction.
		return None
	return gross, tds, flt(tds / gross * 100.0, 2)


def _write(row: dict, figures: tuple) -> str:
	"""Figures are passed IN, already validated. `_figures` can answer None, and unpacking that
	here would crash on the one row the patch is supposed to skip -- so the caller decides."""
	gross, tds, pct = figures
	doc = frappe.get_doc(
		{
			"doctype": TDS_DOCTYPE,
			"project_payment": row["name"],
			"document_type": PO,
			"document_name": row["document_name"],
			"vendor": row["vendor"],
			"project": row["project"],
			"gross_amount": gross,
			"tds_percentage": pct,
			"tds_amount": tds,
			"payment_approved_on": row["approved_on"],
		}
	).insert(ignore_permissions=True)

	# Keep the payment-side mirror in step, exactly as the live path does. Guarded: the column only
	# exists once `backfill_payment_tds_deduction_link`'s doctype change has been migrated.
	if MIRROR in (frappe.db.get_table_columns(PAYMENT) or []):
		# `update_modified=False`: a backfill records no human editor and must not push 86 payments
		# to the top of every list sorted by `modified`.
		frappe.db.set_value(PAYMENT, row["name"], MIRROR, doc.name, update_modified=False)
	return doc.name


def execute():
	rows = _candidates()
	if not rows:
		print("PO TDS backfill: nothing to do.")
		return

	written, skipped, total = 0, [], 0.0
	for row in rows:
		figures = _figures(row)
		if not figures:
			skipped.append(row["name"])
			continue
		_write(row, figures)
		written += 1
		total += figures[1]

	frappe.db.commit()
	print(f"PO TDS backfill: {written} deduction(s) written, Rs {total:,.2f} recorded.")
	if skipped:
		print(f"  skipped {len(skipped)} unusable row(s): {', '.join(skipped[:10])}")


def dry_run():
	"""Rehearse. Writes NOTHING."""
	rows = _candidates()
	print(f"PO TDS backfill -- {len(rows)} candidate payment(s)\n")
	total, skipped = 0.0, []
	print(f"  {'payment':<18}{'gross':>14}{'tds':>12}{'rate':>8}  approved on")
	for row in rows:
		figures = _figures(row)
		if not figures:
			skipped.append(row["name"])
			continue
		gross, tds, pct = figures
		total += tds
		print(f"  {row['name']:<18}{gross:>14,.2f}{tds:>12,.2f}{pct:>7.2f}%  {row['approved_on']}")

	print(f"\n  would write {len(rows) - len(skipped)} row(s), Rs {total:,.2f} of tax")
	if skipped:
		print(f"  would SKIP {len(skipped)} unusable row(s): {', '.join(skipped[:10])}")
	print("  amount / tds / parent totals: untouched by design")
