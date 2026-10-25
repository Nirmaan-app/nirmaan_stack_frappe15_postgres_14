# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Judge every Failed Porter Invoice again under the fare-and-date rule (#1562, spec #1554 story 28).

Before #1559 a Porter Invoice Failed when the PDF read its invoice number, a GSTIN or the tax
differently, and a Failed invoice could not be retried, so imports stuck on a GSTIN misreading stayed
stuck. Now only the Porter fare and the invoice date can fail one. This re-judges each Failed invoice
from what Gemini ALREADY READ (`porter_validation.rejudge_from_stored`): no download, no Gemini call.
A GSTIN-only failure becomes Passed with a warning; a fare failure stays Failed, in the new wording; an
invoice whose date was never read becomes Error, which Retry now takes.

Imports Create has written to (`porter_records.created_imports`) are left untouched: what they created
stands, and their invoices are history.

⚠️ RAW `set_value`, NO HOOKS, NO RECOUNT, ON PURPOSE. `Porter Invoice` carries no `doc_events`, and
nothing is stored from its status: the import's state is derived from its invoices on every read
(`porter_state.import_state`), so there is nothing to recompute. The writes go through the validation
job's own `_move`, the one writer of a verdict.
"""

import frappe

from nirmaan_stack.api.outflow_import.porter_records import created_imports
from nirmaan_stack.api.outflow_import.porter_validation import rejudge_from_stored
from nirmaan_stack.services.outflow_import.porter import INVOICE_DOCTYPE
from nirmaan_stack.services.outflow_import.porter_state import INVOICE_FAILED


def execute():
	rejudge()


def rejudge(invoices=None) -> dict:
	"""Re-judge the Failed ones among `invoices`, or every Failed Porter Invoice when None. Commits each
	invoice (`_move`). Returns how many ended in each status."""
	filters = {"validation_status": INVOICE_FAILED}
	if invoices is not None:
		if not invoices:
			return {}
		filters["name"] = ["in", list(invoices)]
	failed = frappe.get_all(INVOICE_DOCTYPE, filters=filters, fields=["name", "import_batch"], order_by="name asc")
	created = created_imports(sorted({invoice.import_batch for invoice in failed}))
	outcome: dict = {}
	for invoice in failed:
		if invoice.import_batch in created:
			continue
		status = rejudge_from_stored(invoice.name)
		outcome[status] = outcome.get(status, 0) + 1
	if outcome:
		print(f"Porter invoices re-judged: {outcome}")
	return outcome
