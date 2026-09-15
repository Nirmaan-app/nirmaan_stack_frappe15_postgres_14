"""
Backfill `Project Payments.payment_tds` from the deductions that already exist.

The field is a MIRROR. `Payment TDS Deduction.project_payment` remains the authoritative side: it
is UNIQUE, and that uniqueness is the idempotency guarantee behind the whole deduction flow (only
the first Approved transition can write a row, which is also what stops a payment being netted
twice). This column exists only so the link can be read from the payment side.

Every deduction recorded from now on sets it at write time (`services/payment_tds.write_deduction`),
and a blank one is repaired on the next save (`existing_deduction`'s early-return branch). This
patch covers the rows written before the field existed.

IDEMPOTENT: it fills only payments whose link is still empty and never clears one, so re-running
is a no-op.

⚠️ RAW UPDATE, SO NO `doc_events` FIRE ON `Project Payments` -- deliberate, and stated here because
this doctype DOES carry hooks. Nothing derived depends on this column (`amount_paid`, the PO term
status and the vendor-credit recalculation all key off `status`/`amount`), so skipping the
lifecycle changes no computed value -- while firing `on_update` across 626 payments would cascade
notifications and recalculations for a field none of them reads.
"""

import frappe

PAYMENT_TABLE = "tabProject Payments"
DEDUCTION_TABLE = "tabPayment TDS Deduction"
COLUMN = "payment_tds"


def execute():
	if not frappe.db.table_exists("Payment TDS Deduction"):
		return

	# The doctype sync owns creating the column; with no target there is nothing to fill.
	if COLUMN not in (frappe.db.get_table_columns("Project Payments") or []):
		return

	frappe.db.sql(
		f"""
		UPDATE "{PAYMENT_TABLE}" p
		SET {COLUMN} = d.name
		FROM "{DEDUCTION_TABLE}" d
		WHERE d.project_payment = p.name
		  AND (p.{COLUMN} IS NULL OR p.{COLUMN} = '')
		"""
	)
	frappe.db.commit()
