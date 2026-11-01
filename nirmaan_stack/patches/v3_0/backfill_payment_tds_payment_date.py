# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Copy each Paid Project Payment's or Non-Project Expense's `payment_date` onto its
`Payment TDS Deduction.payment_date` (owner 2026-10-29).

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not the Technical Data Sheet family.

From now on `payment_tds.sync_payment_date` (a payment) and `expense_tds.sync_expense_payment_date` (an
Office Rent expense) keep the field in step from the record's `on_update`; this
fills the rows whose payment was already Paid before the field existed. Same rule as the live path: only a
Paid record's date is copied, so a row whose payment or expense is not Paid stays empty. Only an empty field is
filled, so a re-run changes nothing and a date the live path already wrote is left alone.

⚠️ RAW `UPDATE`, NO HOOKS, NO RECOUNT, ON PURPOSE. It copies a date: no amount, Amount Paid, `total_tds`
or challan figure reads `payment_date`, so there is nothing to recompute. Skipping the deduction's hooks
also skips its challan lock, which is right -- a deposited row's payment date is still its payment date.
`modified` is not touched: no one edited these rows.
"""

import frappe

from nirmaan_stack.services.expense_statuses import EXPENSE_PAID
from nirmaan_stack.services.outflow_import.ledgers import NON_PROJECT_EXPENSE_DOCTYPE
from nirmaan_stack.services.payment_tds import PAID, PAYMENT_DOCTYPE, TDS_DOCTYPE


def execute():
	# (source doctype, the deduction's link to it, that source's Paid status)
	for source, link, paid in (
		(PAYMENT_DOCTYPE, "project_payment", PAID),
		(NON_PROJECT_EXPENSE_DOCTYPE, "non_project_expense", EXPENSE_PAID),
	):
		frappe.db.sql(
			f"""
			UPDATE "tab{TDS_DOCTYPE}" d
			SET payment_date = s.payment_date
			FROM "tab{source}" s
			WHERE s.name = d.{link}
			  AND s.status = %s
			  AND s.payment_date IS NOT NULL
			  AND d.payment_date IS NULL
			""",
			(paid,),
		)
