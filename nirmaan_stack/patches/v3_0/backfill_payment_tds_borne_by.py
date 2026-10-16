# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Fill `Payment TDS Deduction.borne_by` on every row written before the field existed (#1451).

From here on `payment_tds.record_deduction` stores who bears each deduction's tax when it creates the
row. The rows already there are read ONCE off their own payment, the only record of what the approval
did:

  * the payment still equals the row's `gross_amount`: it was KEPT WHOLE, the company paid the tax on
    top -> "Company";
  * it equals `gross_amount - tds_amount`: the tax was WITHHELD from the vendor -> "Vendor".

Nearer wins, so the outflow import's few rupees of bank rounding do not flip a row. Only a Work Order
whose categories are company-borne (`payment_tds.categories_are_company_borne`) ever had a payment
kept whole, so every other row is "Vendor" whatever its figures: an ordinary Work Order whose
deduction was restated off its payment (SR-00190-001007) can sit nearer its gross. The Misc /
Transport Work Orders paid before the 2026-09-17 rule had their tax withheld (SR-00041-000138:
24,800 -> 24,552 + 248) and read "Vendor" here (owner ruling 2026-10-16).

⚠️ RAW `UPDATE`, NO HOOKS, AND NO RECOUNT, ON PURPOSE. `Payment TDS Deduction` carries no
`doc_events`. The figure built on the field, a Work Order's Amount Due, is not recomputed: this
records the same answer the Amount Due writer and the mismatch judge already read off the amounts
(`e8e7ef3ce`), so no correct Amount Due moves. A Work Order whose stored Amount Due is already wrong
stays for the Amount Paid Mismatch report, which reports drift and never fixes it silently.
"""

import frappe

from nirmaan_stack.services.payment_tds import (
	BORNE_BY_COMPANY,
	BORNE_BY_VENDOR,
	DEDUCTIBLE_PARENTS,
	PAYMENT_DOCTYPE,
	TDS_DOCTYPE,
	categories_are_company_borne,
)


def execute():
	backfill()


def backfill(deductions=None) -> None:
	"""Set `borne_by` on the given deduction rows, or on every row when `deductions` is None.
	Commits nothing."""
	if deductions is not None and not deductions:
		return
	only = "AND d.name IN %(names)s" if deductions is not None else ""
	params = {"names": tuple(deductions or ()), "parents": tuple(DEDUCTIBLE_PARENTS)}

	# Kept whole: its payment sits nearer the row's gross than its net, on a deductible parent.
	kept_whole = frappe.db.sql(
		f"""
		SELECT d.name, sr.service_category_list
		FROM "tab{TDS_DOCTYPE}" d
		INNER JOIN "tab{PAYMENT_DOCTYPE}" p ON p.name = d.project_payment
		INNER JOIN "tabService Requests" sr ON sr.name = p.document_name
		WHERE p.document_type IN %(parents)s
		  AND ABS(p.amount - d.gross_amount) < ABS(p.amount - (d.gross_amount - d.tds_amount))
		  {only}
		""",
		params,
		as_dict=True,
	)
	company = [row.name for row in kept_whole if categories_are_company_borne(row.service_category_list)]

	frappe.db.sql(
		f"""UPDATE "tab{TDS_DOCTYPE}" d SET borne_by = %(vendor)s WHERE TRUE {only}""",
		{**params, "vendor": BORNE_BY_VENDOR},
	)
	# In chunks: a long `IN` list trips the Postgres driver path's sqlparse token ceiling.
	for start in range(0, len(company), 200):
		frappe.db.sql(
			f"""UPDATE "tab{TDS_DOCTYPE}" SET borne_by = %(company)s WHERE name IN %(company_rows)s""",
			{"company": BORNE_BY_COMPANY, "company_rows": tuple(company[start : start + 200])},
		)
